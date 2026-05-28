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
  completedCount: number;
  totalCount: number;
  companyProfile: CompanyProfile | null;
  directorSignature: string | null;
  setDirectorSignature: (dataUrl: string | null) => void;
  companyOverrides: CompanyOverrides;
  setCompanyOverrides: (overrides: CompanyOverrides) => void;
  companyLogo: string | null;
  setCompanyLogo: (dataUrl: string | null) => void;
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
      const parsed: Array<Pick<ISODocument, 'id' | 'status' | 'progress' | 'messages' | 'generatedContent' | 'profileSnapshot'>> = JSON.parse(saved);
      return ISO_DOCUMENTS.map((doc) => {
        const s = parsed.find((d) => d.id === doc.id);
        return s
          ? { ...doc, status: s.status as ISODocument['status'], progress: s.progress, messages: s.messages ?? [], generatedContent: s.generatedContent, profileSnapshot: s.profileSnapshot }
          : { ...doc, status: 'not_started' as const, progress: 0, messages: [] };
      });
    }
  } catch {}
  return ISO_DOCUMENTS.map((doc) => ({ ...doc, status: 'not_started' as const, progress: 0, messages: [] }));
}

function loadSignature(): string | null { try { return localStorage.getItem(SIGNATURE_KEY); } catch { return null; } }
function loadOverrides(): CompanyOverrides { try { const raw = localStorage.getItem(OVERRIDES_KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; } }
function loadLogo(): string | null { try { return localStorage.getItem(LOGO_KEY); } catch { return null; } }

function escapeRegex(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Serializable subset of doc state stored in Supabase + localStorage
type DocStateSlim = Pick<ISODocument, 'id' | 'status' | 'progress' | 'messages' | 'generatedContent' | 'profileSnapshot'>;

interface SharedState {
  documents: DocStateSlim[];
  overrides: CompanyOverrides;
  logo: string | null;
  signature: string | null;
}

function docsToSlim(documents: ISODocument[]): DocStateSlim[] {
  return documents.map((d) => ({
    id: d.id,
    status: d.status,
    progress: d.progress,
    messages: d.messages,
    generatedContent: d.generatedContent,
    profileSnapshot: d.profileSnapshot,
  }));
}

function slimToDocs(slim: DocStateSlim[] | undefined | null): ISODocument[] {
  const list = Array.isArray(slim) ? slim : [];
  return ISO_DOCUMENTS.map((doc) => {
    const s = list.find((d) => d.id === doc.id);
    return s
      ? { ...doc, status: s.status as ISODocument['status'], progress: s.progress ?? 0, messages: s.messages ?? [], generatedContent: s.generatedContent, profileSnapshot: s.profileSnapshot }
      : { ...doc, status: 'not_started' as const, progress: 0, messages: [] };
  });
}

export function ISOProvider({ children }: { children: ReactNode }) {
  const { user } = usePortalAuth();
  const [documents, setDocuments] = useState<ISODocument[]>(loadDocuments);
  const [auditResults, setAuditResults] = useState<AuditResult[] | null>(null);
  const [directorSignature, setDirectorSignatureState] = useState<string | null>(loadSignature);
  const [companyOverrides, setCompanyOverridesState] = useState<CompanyOverrides>(loadOverrides);
  const [companyLogo, setCompanyLogoState] = useState<string | null>(loadLogo);
  const [brand, setBrand] = useState<any>(null);
  const [profileFullName, setProfileFullName] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<ISOContextType['syncState']>('idle');

  const remoteLoadedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // ───────── Apply remote state into local React state ─────────
  const applyRemoteState = useCallback((s: SharedState) => {
    setDocuments(slimToDocs(s.documents));
    setCompanyOverridesState(s.overrides ?? {});
    setCompanyLogoState(s.logo ?? null);
    setDirectorSignatureState(s.signature ?? null);

    // Refresh localStorage caches so next cold load mirrors remote
    try {
      localStorage.setItem(DOCS_KEY, JSON.stringify(s.documents ?? []));
      localStorage.setItem(OVERRIDES_KEY, JSON.stringify(s.overrides ?? {}));
      if (s.logo) localStorage.setItem(LOGO_KEY, s.logo); else localStorage.removeItem(LOGO_KEY);
      if (s.signature) localStorage.setItem(SIGNATURE_KEY, s.signature); else localStorage.removeItem(SIGNATURE_KEY);
    } catch {}
  }, []);

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
        console.warn('[Compliance] sync load failed', error.message);
        setSyncState('error');
        remoteLoadedRef.current = true; // allow saves to proceed even on read failure
        return;
      }

      if (data?.state) {
        applyRemoteState(data.state as SharedState);
      } else {
        // No remote row yet — seed it with whatever we have locally so the next
        // user in the company picks it up.
        const seed: SharedState = {
          documents: docsToSlim(documents),
          overrides: companyOverrides,
          logo: companyLogo,
          signature: directorSignature,
        };
        await portalSupabase
          .from(REMOTE_TABLE)
          .upsert({ company_domain: companyDomain, state: seed as any }, { onConflict: 'company_domain' });
      }

      remoteLoadedRef.current = true;
      setSyncState('idle');
    })();

    // Live updates from other users in the company
    const channel = portalSupabase
      .channel(`compliance-state-${companyDomain}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: REMOTE_TABLE, filter: `company_domain=eq.${companyDomain}` },
        (payload: any) => {
          const next = payload?.new?.state as SharedState | undefined;
          if (next) applyRemoteState(next);
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
    if (!companyDomain || !remoteLoadedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSyncState('saving');
      const next: SharedState = {
        documents: docsToSlim(documents),
        overrides: companyOverrides,
        logo: companyLogo,
        signature: directorSignature,
      };
      const { error } = await portalSupabase
        .from(REMOTE_TABLE)
        .upsert({ company_domain: companyDomain, state: next as any }, { onConflict: 'company_domain' });
      setSyncState(error ? 'error' : 'idle');
      if (error) console.warn('[Compliance] sync save failed', error.message);
    }, 400);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [documents, companyOverrides, companyLogo, directorSignature, companyDomain]);

  // ───────── Derived profile ─────────
  const companyProfile = deriveCompanyProfile(
    brand,
    { email: user?.email ?? '', fullName: profileFullName },
    { signatureDataUrl: directorSignature },
    companyOverrides,
    { logoDataUrl: companyLogo },
  );

  // ───────── Setters (also write localStorage immediately for offline) ─────────
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

  const updateDocument = useCallback((id: string, updates: Partial<ISODocument>) => {
    setDocuments((prev) => prev.map((doc) => (doc.id === id ? { ...doc, ...updates } : doc)));
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

      if (touched) docsUpdated++;
      return { ...doc, generatedContent: content, profileSnapshot: current };
    }));

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
      completedCount,
      totalCount,
      companyProfile,
      directorSignature,
      setDirectorSignature,
      companyOverrides,
      setCompanyOverrides,
      companyLogo,
      setCompanyLogo,
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
