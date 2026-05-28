import { Routes, Route, Navigate } from 'react-router-dom';
import { ISOProvider } from './contexts/ISOContext';
import { ActionsProvider } from './contexts/ActionsContext';
import ComplianceDashboard from './pages/ComplianceDashboard';
import ComplianceDocumentChat from './pages/ComplianceDocumentChat';
import ComplianceSelfAudit from './pages/ComplianceSelfAudit';
import ComplianceSupportingDocs from './pages/ComplianceSupportingDocs';
import ComplianceFileManager from './pages/ComplianceFileManager';
import ComplianceKnowledgeBase from './pages/ComplianceKnowledgeBase';
import ComplianceCompanyDetails from './pages/ComplianceCompanyDetails';
// TEMPORARY — remove after the post-2026-05-28 PDF recovery is done.
import ComplianceRecoverPdfs from './pages/ComplianceRecoverPdfs';

function ComplianceRoutes() {
  return (
    <Routes>
      <Route index element={<ComplianceDashboard />} />
      <Route path="document/:docId" element={<ComplianceDocumentChat />} />
      <Route path="audit" element={<ComplianceSelfAudit />} />
      <Route path="supporting-docs" element={<ComplianceSupportingDocs />} />
      <Route path="files" element={<ComplianceFileManager />} />
      <Route path="knowledge-base" element={<ComplianceKnowledgeBase />} />
      <Route path="company-details" element={<ComplianceCompanyDetails />} />
      <Route path="signature" element={<Navigate to="/compliance/company-details" replace />} />
      {/* TEMPORARY — remove after PDF recovery done */}
      <Route path="recover-pdfs" element={<ComplianceRecoverPdfs />} />
      <Route path="*" element={<Navigate to="/compliance" replace />} />
    </Routes>
  );
}

export default function ComplianceApp() {
  return (
    <ISOProvider>
      <ActionsProvider>
        <ComplianceRoutes />
      </ActionsProvider>
    </ISOProvider>
  );
}
