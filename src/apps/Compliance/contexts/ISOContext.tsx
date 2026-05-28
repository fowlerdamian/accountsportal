import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { ISODocument, ISO_DOCUMENTS, ChatMessage, AuditResult } from '../lib/iso-documents';
import { CompanyProfile, deriveCompanyProfile } from '../lib/company-profile';
import { supabase as portalSupabase } from '@portal/lib/supabase';
import { useAuth as usePortalAuth } from '@portal/context/AuthContext';

const DOCS_KEY = 'compliance_documents';

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
}

const ISOContext = createContext<ISOContextType | undefined>(undefined);

function loadDocuments(): ISODocument[] {
  try {
    const saved = localStorage.getItem(DOCS_KEY);
    if (saved) {
      const parsed: Array<{ id: string; status: string; progress: number; messages: ChatMessage[]; generatedContent?: string }> = JSON.parse(saved);
      return ISO_DOCUMENTS.map((doc) => {
        const s = parsed.find((d) => d.id === doc.id);
        return s
          ? { ...doc, status: s.status as ISODocument['status'], progress: s.progress, messages: s.messages ?? [], generatedContent: s.generatedContent }
          : { ...doc, status: 'not_started' as const, progress: 0, messages: [] };
      });
    }
  } catch {}
  return ISO_DOCUMENTS.map((doc) => ({ ...doc, status: 'not_started' as const, progress: 0, messages: [] }));
}

export function ISOProvider({ children }: { children: ReactNode }) {
  const { user } = usePortalAuth();
  const [documents, setDocuments] = useState<ISODocument[]>(loadDocuments);
  const [auditResults, setAuditResults] = useState<AuditResult[] | null>(null);
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);

  // Persist documents whenever they change
  useEffect(() => {
    localStorage.setItem(DOCS_KEY, JSON.stringify(
      documents.map((d) => ({
        id: d.id,
        status: d.status,
        progress: d.progress,
        messages: d.messages,
        generatedContent: d.generatedContent,
      }))
    ));
  }, [documents]);

  // Derive the company profile from portal knowledge: brand matched to the
  // user's email domain, plus the user's auth record + profile.
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
      const brand = brandRows && brandRows[0] ? brandRows[0] : null;
      const fullName = (profileRow as any)?.full_name ?? null;
      setCompanyProfile(deriveCompanyProfile(brand, { email: userEmail, fullName }));
    })();

    return () => { cancelled = true; };
  }, [user?.email, (user as any)?.id]);

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
