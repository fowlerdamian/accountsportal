import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { ISODocument, ISO_DOCUMENTS, ChatMessage, AuditResult } from '../lib/iso-documents';
import { CompanyProfile } from '../lib/company-profile';

const PROFILE_KEY = 'compliance_company_profile';
const DOCS_KEY    = 'compliance_documents';

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
  setCompanyProfile: (profile: CompanyProfile) => void;
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

function loadProfile(): CompanyProfile | null {
  try {
    const saved = localStorage.getItem(PROFILE_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

export function ISOProvider({ children }: { children: ReactNode }) {
  const [documents, setDocuments] = useState<ISODocument[]>(loadDocuments);
  const [auditResults, setAuditResults] = useState<AuditResult[] | null>(null);
  const [companyProfile, setCompanyProfileState] = useState<CompanyProfile | null>(loadProfile);

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

  const setCompanyProfile = useCallback((profile: CompanyProfile) => {
    setCompanyProfileState(profile);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
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
      setCompanyProfile,
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
