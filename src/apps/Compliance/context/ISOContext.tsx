import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { ISODocument, ISO_DOCUMENTS, ChatMessage, AuditResult } from '../lib/iso-documents';
import { CompanyProfile } from '../lib/company-profile';

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

export function ISOProvider({ children }: { children: ReactNode }) {
  const [documents, setDocuments] = useState<ISODocument[]>(() =>
    ISO_DOCUMENTS.map((doc) => ({
      ...doc,
      status: 'not_started' as const,
      progress: 0,
      messages: [],
    }))
  );
  const [auditResults, setAuditResults] = useState<AuditResult[] | null>(null);
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);

  const updateDocument = useCallback((id: string, updates: Partial<ISODocument>) => {
    setDocuments((prev) =>
      prev.map((doc) => (doc.id === id ? { ...doc, ...updates } : doc))
    );
  }, []);

  const addMessage = useCallback((docId: string, message: ChatMessage) => {
    setDocuments((prev) =>
      prev.map((doc) =>
        doc.id === docId ? { ...doc, messages: [...doc.messages, message] } : doc
      )
    );
  }, []);

  const getDocument = useCallback(
    (id: string) => documents.find((d) => d.id === id),
    [documents]
  );

  const completedCount = documents.filter((d) => d.status === 'complete').length;
  const totalCount = documents.length;

  return (
    <ISOContext.Provider
      value={{
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
      }}
    >
      {children}
    </ISOContext.Provider>
  );
}

export function useISO() {
  const context = useContext(ISOContext);
  if (!context) throw new Error('useISO must be used within ISOProvider');
  return context;
}
