import { Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { AuditAuthProvider, useAuditAuth } from './context/AuditAuthContext';
import { ISOProvider, useISO } from './context/ISOContext';
import { ActionsProvider } from './context/ActionsContext';
import ComplianceLogin from './pages/ComplianceLogin';
import ComplianceSetup from './pages/ComplianceSetup';
import ComplianceDashboard from './pages/ComplianceDashboard';
import ComplianceDocumentChat from './pages/ComplianceDocumentChat';
import ComplianceSelfAudit from './pages/ComplianceSelfAudit';
import ComplianceSupportingDocs from './pages/ComplianceSupportingDocs';
import ComplianceFileManager from './pages/ComplianceFileManager';

function ComplianceRoutes() {
  const { session, loading } = useAuditAuth();
  const { companyProfile } = useISO();

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<ComplianceLogin />} />
      </Routes>
    );
  }

  if (!companyProfile) {
    return (
      <Routes>
        <Route path="setup" element={<ComplianceSetup />} />
        <Route path="*" element={<ComplianceSetup />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route index element={<ComplianceDashboard />} />
      <Route path="document/:docId" element={<ComplianceDocumentChat />} />
      <Route path="audit" element={<ComplianceSelfAudit />} />
      <Route path="supporting-docs" element={<ComplianceSupportingDocs />} />
      <Route path="files" element={<ComplianceFileManager />} />
      <Route path="setup" element={<ComplianceSetup />} />
      <Route path="*" element={<Navigate to="" replace />} />
    </Routes>
  );
}

function ComplianceWithISO() {
  return (
    <ISOProvider>
      <ActionsProvider>
        <ComplianceRoutes />
      </ActionsProvider>
    </ISOProvider>
  );
}

export default function ComplianceApp() {
  return (
    <AuditAuthProvider>
      <ComplianceWithISO />
    </AuditAuthProvider>
  );
}
