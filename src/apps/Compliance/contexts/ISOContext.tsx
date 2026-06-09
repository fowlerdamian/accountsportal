import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { ISODocument, ISO_DOCUMENTS, ChatMessage, AuditResult } from '../lib/iso-documents';
import {
  CompanyProfile, CompanyOverrides,
  deriveCompanyProfile, profileSnapshot, PUSHABLE_FIELDS,
} from '../lib/company-profile';
import { supabase as portalSupabase } from '@portal/lib/supabase';
import { useAuth as usePortalAuth } from '@portal/context/AuthContext';

const DOCS_KEY = 'compliance_documents';
const SIGNATURE_KEY = 'compliance_director_signature';
const OVERRIDES_KEY = 'compliance_company_overrides';
const LOGO_KEY = 'compliance_company_logo';
const AUDITED_KEY = 'compliance_audited_docs';
const BACKUP_KEY_PREFIX = 'compliance_pre_sync_backup_';
const REMOTE_TABLE = 'compliance_app_state';

interface PushResult {
  docsScanned: number;
  docsUpdated: number;
  replacements: number;
}

interface ISOContextType {
  documents: ISODocument[];
  updateDocument: (id: string, updates: Partial<ISODocument>) => void;
  addMessage: (docId: string, message: ChatMessage) => void;
  getDocument: (id: string) => ISODocument | undefined;
  auditResults: AuditResult[] | null;
  setAuditResults: (results: AuditResult[] | null) => void;
  auditedDocIds: Set<string>;
  markDocAudited: (id: string) => void;
  approveDocument: (id: string, approvedBy: string) => void;
  completedCount: number;
  totalCount: number;
  companyProfile: CompanyProfile | null;
  directorSignature: string | null;
  setDirectorSignature: (dataUrl: string | null) => void;
  companyOverrides: CompanyOverrides;
  setCompanyOverrides: (overrides: CompanyOverrides) => void;
  companyLogo: string | null;
  setCompanyLogo: (dataUrl: string | null) => void;
  driveFolderId: string | null;
  setDriveFolderId: (id: string | null) => void;
  snapshotProfileFor: (docId: string) => void;
  pushProfileToDocuments: () => PushResult;
  syncState: 'idle' | 'loading' | 'saving' | 'error';
}

const ISOContext = createContext<ISOContextType | undefined>(undefined);

// ───────── localStorage helpers ─────────
function loadDocuments(): ISODocument[] {
  try {
    const saved = localStorage.getItem(DOCS_KEY);
    if (saved) {
      const parsed: DocStateSlim[] = JSON.parse(saved);
      return ISO_DOCUMENTS.map((doc) => {
        const s = parsed.find((d) => d.id === doc.id);
        return s
          ? { ...doc, status: s.status as ISODocument['status'], progress: s.progress, messages: s.messages ?? [], generatedContent: s.generatedContent, profileSnapshot: s.profileSnapshot, approvedContent: s.approvedContent, approvedAt: s.approvedAt, approvedBy: s.approvedBy }
          : { ...doc, status: 'not_started' as const, progress: 0, messages: [] };
      });
    }
  } catch {}
  return ISO_DOCUMENTS.map((doc) => ({ ...doc, status: 'not_started' as const, progress: 0, messages: [] }));
}

function loadSignature(): string | null { try { return localStorage.getItem(SIGNATURE_KEY); } catch { return null; } }
function loadOverrides(): CompanyOverrides { try { const raw = localStorage.getItem(OVERRIDES_KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; } }
function loadLogo(): string | null { try { return localStorage.getItem(LOGO_KEY); } catch { return null; } }
function loadAuditedDocs(): Set<string> { try { const raw = localStorage.getItem(AUDITED_KEY); return new Set(raw ? JSON.parse(raw) : []); } catch { return new Set(); } }

function escapeRegex(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Serializable subset of doc state stored in Supabase + localStorage
type DocStateSlim = Pick<ISODocument, 'id' | 'status' | 'progress' | 'messages' | 'generatedContent' | 'profileSnapshot' | 'approvedContent' | 'approvedAt' | 'approvedBy'>;

interface SharedState {
  documents: DocStateSlim[];
  overrides: CompanyOverrides;
  logo: string | null;
  signature: string | null;
  driveFolderId?: string | null;
}

function docsToSlim(documents: ISODocument[]): DocStateSlim[] {
  return documents.map((d) => ({
    id: d.id,
    status: d.status,
    progress: d.progress,
    messages: d.messages,
    generatedContent: d.generatedContent,
    profileSnapshot: d.profileSnapshot,
    approvedContent: d.approvedContent,
    approvedAt: d.approvedAt,
    approvedBy: d.approvedBy,
  }));
}

function slimToDocs(slim: DocStateSlim[] | undefined | null): ISODocument[] {
  const list = Array.isArray(slim) ? slim : [];
  return ISO_DOCUMENTS.map((doc) => {
    const s = list.find((d) => d.id === doc.id);
    return s
      ? { ...doc, status: s.status as ISODocument['status'], progress: s.progress ?? 0, messages: s.messages ?? [], generatedContent: s.generatedContent, profileSnapshot: s.profileSnapshot, approvedContent: s.approvedContent, approvedAt: s.approvedAt, approvedBy: s.approvedBy }
      : { ...doc, status: 'not_started' as const, progress: 0, messages: [] };
  });
}

// True iff the state has any user-entered content worth protecting.
function hasMeaningfulData(s: SharedState | null | undefined): boolean {
  if (!s) return false;
  if (s.signature && s.signature.length > 0) return true;
  if (s.logo && s.logo.length > 0) return true;
  if (s.driveFolderId && s.driveFolderId.length > 0) return true;
  if (s.overrides && Object.keys(s.overrides).length > 0) return true;
  if (Array.isArray(s.documents)) {
    for (const d of s.documents) {
      if (d.status && d.status !== 'not_started') return true;
      if (d.messages && d.messages.length > 0) return true;
      if (d.generatedContent && d.generatedContent.length > 0) return true;
    }
  }
  return false;
}

// Cheap deep-equal — used to decide whether realtime is reflecting our own save.
function sameJson(a: unknown, b: unknown): boolean {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

// ───────── Merge logic — never lose work ─────────
// Given two doc states for the same id, return the one with MORE progress.
// Priority: complete > in_progress > not_started; tiebreak by message count,
// then by generatedContent length, then by profileSnapshot key count.
function pickRicherDoc(a: DocStateSlim | undefined, b: DocStateSlim | undefined): DocStateSlim | undefined {
  if (!a) return b;
  if (!b) return a;
  const statusRank = (s: string | undefined) => s === 'complete' ? 2 : s === 'in_progress' ? 1 : 0;
  const aRank = statusRank(a.status);
  const bRank = statusRank(b.status);
  let richer: DocStateSlim;
  if (aRank !== bRank) {
    richer = aRank > bRank ? a : b;
  } else {
    const aMsgs = a.messages?.length ?? 0;
    const bMsgs = b.messages?.length ?? 0;
    const aLen = a.generatedContent?.length ?? 0;
    const bLen = b.generatedContent?.length ?? 0;
    const aSnap = a.profileSnapshot ? Object.keys(a.profileSnapshot).length : 0;
    const bSnap = b.profileSnapshot ? Object.keys(b.profileSnapshot).length : 0;
    if (aMsgs !== bMsgs) richer = aMsgs > bMsgs ? a : b;
    else if (aLen !== bLen) richer = aLen > bLen ? a : b;
    else richer = aSnap >= bSnap ? a : b;
  }
  // Preserve the most recent approval across both sides — approval can live on the
  // less-rich side if someone edited the draft after it was approved elsewhere.
  const latestApproval =
    a.approvedAt && b.approvedAt ? (a.approvedAt >= b.approvedAt ? a : b)
    : a.approvedAt ? a : b.approvedAt ? b : (a.approvedContent ? a : b);
  return {
    ...richer,
    approvedContent: latestApproval.approvedContent,
    approvedAt: latestApproval.approvedAt,
    approvedBy: latestApproval.approvedBy,
  };
}

// Merge two SharedStates field-by-field. NEVER deletes data: for each doc id,
// take the side with more progress; for overrides, union (non-empty wins);
// for logo/signature, take whichever side has data.
function mergeStates(a: SharedState, b: SharedState): SharedState {
  const byId = new Map<string, DocStateSlim>();
  const collect = (list: DocStateSlim[] | undefined) => {
    if (!Array.isArray(list)) return;
    for (const d of list) {
      const existing = byId.get(d.id);
      const winner = pickRicherDoc(existing, d);
      if (winner) byId.set(d.id, winner);
    }
  };
  collect(a.documents);
  collect(b.documents);

  const overrides: CompanyOverrides = { ...(a.overrides ?? {}) };
  for (const [k, v] of Object.entries(b.overrides ?? {})) {
    if (typeof v === 'string' && v.trim().length > 0) {
      // Prefer the non-empty side; if both non-empty, leave the existing one
      // (a was applied first). This avoids one user clobbering another's edits.
      if (!overrides[k as keyof CompanyOverrides]) (overrides as any)[k] = v;
    }
  }

  return {
    documents: Array.from(byId.values()),
    overrides,
    logo: a.logo || b.logo || null,
    signature: a.signature || b.signature || null,
    driveFolderId: a.driveFolderId || b.driveFolderId || null,
  };
}

// Snapshot the current local state to a timestamped backup key. Keep the last 5.
function backupLocal(state: SharedState, reason: string) {
  try {
    const key = `${BACKUP_KEY_PREFIX}${new Date().toISOString()}_${reason}`;
    localStorage.setItem(key, JSON.stringify(state));
    // Trim to most-recent 5 backups
    const keys = Object.keys(localStorage).filter(k => k.startsWith(BACKUP_KEY_PREFIX)).sort();
    while (keys.length > 5) {
      const stale = keys.shift();
      if (stale) localStorage.removeItem(stale);
    }
  } catch {}
}

export function ISOProvider({ children }: { children: ReactNode }) {
  const { user } = usePortalAuth();
  const [documents, setDocuments] = useState<ISODocument[]>(loadDocuments);
  const [auditResults, setAuditResults] = useState<AuditResult[] | null>(null);
  const [auditedDocIds, setAuditedDocIds] = useState<Set<string>>(loadAuditedDocs);
  const [directorSignature, setDirectorSignatureState] = useState<string | null>(loadSignature);
  const [companyOverrides, setCompanyOverridesState] = useState<CompanyOverrides>(loadOverrides);
  const [companyLogo, setCompanyLogoState] = useState<string | null>(loadLogo);
  const [driveFolderId, setDriveFolderIdState] = useState<string | null>(null);
  const [brand, setBrand] = useState<any>(null);
  const [profileFullName, setProfileFullName] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<ISOContextType['syncState']>('idle');

  // ───────── refs for sync state ─────────
  const remoteLoadedRef = useRef(false);    // false until initial fetch succeeds
  const writesEnabledRef = useRef(false);   // false until we know it's safe to write
  const lastPushedRef = useRef<SharedState | null>(null); // dedupe own-echoes from realtime
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest local — exposed to realtime callback via ref so we read fresh values
  const latestRef = useRef<SharedState>({
    documents: docsToSlim(documents),
    overrides: companyOverrides,
    logo: companyLogo,
    signature: directorSignature,
    driveFolderId,
  });

  useEffect(() => {
    latestRef.current = {
      documents: docsToSlim(documents),
      overrides: companyOverrides,
      logo: companyLogo,
      signature: directorSignature,
      driveFolderId,
    };
  }, [documents, companyOverrides, companyLogo, directorSignature, driveFolderId]);

  const companyDomain = (user?.email ?? '').split('@')[1]?.toLowerCase() ?? '';

  // ───────── localStorage caches (offline + first-load) ─────────
  useEffect(() => {
    localStorage.setItem(DOCS_KEY, JSON.stringify(docsToSlim(documents)));
  }, [documents]);

  // ───────── Brand + profile lookup (read-only, portal-wide) ─────────
  useEffect(() => {
    let cancelled = false;
    const userEmail = user?.email ?? '';
    const userId = (user as any)?.id as string | undefined;

    (async () => {
      const domain = userEmail.split('@')[1]?.toLowerCase();
      const [{ data: brandRows }, { data: profileRow }] = await Promise.all([
        domain
          ? portalSupabase.from('brands').select('name, domain, logo_url, support_phone, support_email').ilike('domain', `%${domain}%`).limit(1)
          : Promise.resolve({ data: null as any }),
        userId
          ? portalSupabase.from('profiles').select('full_name').eq('user_id', userId).maybeSingle()
          : Promise.resolve({ data: null as any }),
      ]);
      if (cancelled) return;
      setBrand(brandRows && brandRows[0] ? brandRows[0] : null);
      setProfileFullName((profileRow as any)?.full_name ?? null);
    })();

    return () => { cancelled = true; };
  }, [user?.email, (user as any)?.id]);

  // Replace local state with remote. Always backs up local first.
  const applyRemoteState = useCallback((next: SharedState, reason: string) => {
    backupLocal(latestRef.current, `before_${reason}`);
    setDocuments(slimToDocs(next.documents));
    setCompanyOverridesState(next.overrides ?? {});
    setCompanyLogoState(next.logo ?? null);
    setDirectorSignatureState(next.signature ?? null);
    setDriveFolderIdState(next.driveFolderId ?? null);
    try {
      localStorage.setItem(DOCS_KEY, JSON.stringify(next.documents ?? []));
      localStorage.setItem(OVERRIDES_KEY, JSON.stringify(next.overrides ?? {}));
      if (next.logo) localStorage.setItem(LOGO_KEY, next.logo); else localStorage.removeItem(LOGO_KEY);
      if (next.signature) localStorage.setItem(SIGNATURE_KEY, next.signature); else localStorage.removeItem(SIGNATURE_KEY);
    } catch {}
  }, []);

  const pushLocalToRemote = useCallback(async (snapshot: SharedState, reason: string) => {
    setSyncState('saving');
    const { error } = await portalSupabase
      .from(REMOTE_TABLE)
      .upsert({ company_domain: companyDomain, state: snapshot as any }, { onConflict: 'company_domain' });
    if (error) {
      setSyncState('error');
      console.warn(`[Compliance] sync save failed (${reason})`, error.message);
      return false;
    }
    lastPushedRef.current = snapshot;
    setSyncState('idle');
    return true;
  }, [companyDomain]);

  // ───────── Initial fetch + realtime subscription ─────────
  useEffect(() => {
    if (!companyDomain) return;
    let cancelled = false;
    setSyncState('loading');

    (async () => {
      const { data, error } = await portalSupabase
        .from(REMOTE_TABLE)
        .select('state')
        .eq('company_domain', companyDomain)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        // Fetch failed — we don't know what's on the server, so REFUSE TO WRITE.
        // Local data stays intact; user can keep working offline.
        console.warn('[Compliance] sync load failed — writes disabled until next reload', error.message);
        setSyncState('error');
        remoteLoadedRef.current = true;
        writesEnabledRef.current = false;
        return;
      }

      const remote = (data?.state ?? null) as SharedState | null;
      const local: SharedState = latestRef.current;
      const localHasData = hasMeaningfulData(local);
      const remoteHasData = hasMeaningfulData(remote);

      // MERGE — never replace. Take the richest version of each doc, union
      // overrides, prefer non-empty logo/signature. This way nobody loses
      // work even if a previous buggy build seeded the wrong state.
      const merged = mergeStates(local, remote ?? { documents: [], overrides: {}, logo: null, signature: null });

      if (remoteHasData || localHasData) {
        applyRemoteState(merged, 'merge_on_load');
        // Push merged back up so the server reflects the union immediately.
        if (!sameJson(merged, remote)) {
          await pushLocalToRemote(merged, 'merge_seed');
        } else {
          lastPushedRef.current = merged;
        }
      }
      // else: both empty → nothing to do.

      remoteLoadedRef.current = true;
      writesEnabledRef.current = true;
      setSyncState('idle');
    })();

    // Live updates from other users in the same company.
    const channel = portalSupabase
      .channel(`compliance-state-${companyDomain}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: REMOTE_TABLE, filter: `company_domain=eq.${companyDomain}` },
        (payload: any) => {
          const incoming = payload?.new?.state as SharedState | undefined;
          if (!incoming) return;

          // Ignore the echo of our own most-recent push.
          if (sameJson(incoming, lastPushedRef.current)) return;

          const local = latestRef.current;
          // Merge incoming with our local — never overwrite our own work.
          const merged = mergeStates(local, incoming);
          if (!sameJson(merged, local)) {
            applyRemoteState(merged, 'realtime_merge');
          }
          // If our merge changed anything the remote didn't include, push it back.
          if (!sameJson(merged, incoming)) {
            void pushLocalToRemote(merged, 'realtime_recover');
          } else {
            lastPushedRef.current = incoming;
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      portalSupabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyDomain]);

  // ───────── Debounced save to remote whenever local state changes ─────────
  useEffect(() => {
    if (!companyDomain || !writesEnabledRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void pushLocalToRemote(latestRef.current, 'mutation');
    }, 400);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [documents, companyOverrides, companyLogo, directorSignature, driveFolderId, companyDomain, pushLocalToRemote]);

  // ───────── Derived profile ─────────
  const companyProfile = deriveCompanyProfile(
    brand,
    { email: user?.email ?? '', fullName: profileFullName },
    { signatureDataUrl: directorSignature },
    companyOverrides,
    { logoDataUrl: companyLogo },
  );

  // ───────── Setters ─────────
  const setDirectorSignature = useCallback((dataUrl: string | null) => {
    setDirectorSignatureState(dataUrl);
    try {
      if (dataUrl) localStorage.setItem(SIGNATURE_KEY, dataUrl);
      else localStorage.removeItem(SIGNATURE_KEY);
    } catch {}
  }, []);

  const setCompanyOverrides = useCallback((overrides: CompanyOverrides) => {
    setCompanyOverridesState(overrides);
    try { localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides)); } catch {}
  }, []);

  const setCompanyLogo = useCallback((dataUrl: string | null) => {
    setCompanyLogoState(dataUrl);
    try {
      if (dataUrl) localStorage.setItem(LOGO_KEY, dataUrl);
      else localStorage.removeItem(LOGO_KEY);
    } catch {}
  }, []);

  const setDriveFolderId = useCallback((id: string | null) => {
    setDriveFolderIdState(id);
  }, []);

  const markDocAudited = useCallback((id: string) => {
    setAuditedDocIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev).add(id);
      try { localStorage.setItem(AUDITED_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  const updateDocument = useCallback((id: string, updates: Partial<ISODocument>) => {
    setDocuments((prev) => prev.map((doc) => (doc.id === id ? { ...doc, ...updates } : doc)));
    // A content change invalidates any prior audit — flip the doc back to "needs audit".
    if (updates.generatedContent !== undefined) {
      setAuditedDocIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        try { localStorage.setItem(AUDITED_KEY, JSON.stringify([...next])); } catch {}
        return next;
      });
    }
  }, []);

  const approveDocument = useCallback((id: string, approvedBy: string) => {
    setDocuments((prev) => prev.map((doc) =>
      doc.id === id && doc.generatedContent
        ? { ...doc, approvedContent: doc.generatedContent, approvedAt: new Date().toISOString(), approvedBy }
        : doc
    ));
  }, []);

  const addMessage = useCallback((docId: string, message: ChatMessage) => {
    setDocuments((prev) =>
      prev.map((doc) => doc.id === docId ? { ...doc, messages: [...doc.messages, message] } : doc)
    );
  }, []);

  const getDocument = useCallback(
    (id: string) => documents.find((d) => d.id === id),
    [documents]
  );

  const snapshotProfileFor = useCallback((docId: string) => {
    setDocuments((prev) => prev.map((doc) =>
      doc.id === docId ? { ...doc, profileSnapshot: profileSnapshot(companyProfile) } : doc
    ));
  }, [companyProfile]);

  const pushProfileToDocuments = useCallback((): PushResult => {
    let docsUpdated = 0;
    let replacements = 0;
    let docsScanned = 0;
    const touchedIds: string[] = [];
    const current = profileSnapshot(companyProfile);

    setDocuments((prev) => prev.map((doc) => {
      if (!doc.generatedContent) return doc;
      docsScanned++;
      let content = doc.generatedContent;
      const oldSnap = doc.profileSnapshot ?? {};
      let touched = false;

      for (const key of PUSHABLE_FIELDS) {
        const oldValue = oldSnap[key as string];
        const newValue = current[key as string];
        if (!oldValue || !newValue || oldValue === newValue) continue;
        const re = new RegExp(escapeRegex(oldValue), 'g');
        const before = content;
        content = content.replace(re, newValue);
        if (content !== before) {
          const matches = before.match(re);
          replacements += matches ? matches.length : 0;
          touched = true;
        }
      }

      if (touched) { docsUpdated++; touchedIds.push(doc.id); }
      return { ...doc, generatedContent: content, profileSnapshot: current };
    }));

    // Content changed → those docs need re-auditing.
    if (touchedIds.length > 0) {
      setAuditedDocIds((prev) => {
        if (!touchedIds.some((id) => prev.has(id))) return prev;
        const next = new Set(prev);
        touchedIds.forEach((id) => next.delete(id));
        try { localStorage.setItem(AUDITED_KEY, JSON.stringify([...next])); } catch {}
        return next;
      });
    }

    return { docsScanned, docsUpdated, replacements };
  }, [companyProfile]);

  const completedCount = documents.filter((d) => d.status === 'complete').length;
  const totalCount = documents.length;

  return (
    <ISOContext.Provider value={{
      documents,
      updateDocument,
      addMessage,
      getDocument,
      auditResults,
      setAuditResults,
      auditedDocIds,
      markDocAudited,
      approveDocument,
      completedCount,
      totalCount,
      companyProfile,
      directorSignature,
      setDirectorSignature,
      companyOverrides,
      setCompanyOverrides,
      companyLogo,
      setCompanyLogo,
      driveFolderId,
      setDriveFolderId,
      snapshotProfileFor,
      pushProfileToDocuments,
      syncState,
    }}>
      {children}
    </ISOContext.Provider>
  );
}

export function useISO() {
  const context = useContext(ISOContext);
  if (!context) throw new Error('useISO must be used within ISOProvider');
  return context;
}
