import { Routes, Route, Navigate } from 'react-router-dom';
import { ISOProvider } from './contexts/ISOContext';
import { ActionsProvider } from './contexts/ActionsContext';
import ComplianceDashboard from './pages/ComplianceDashboard';
import ComplianceDocumentChat from './pages/ComplianceDocumentChat';
import ComplianceSelfAudit from './pages/ComplianceSelfAudit';
import ComplianceSupportingDocs from './pages/ComplianceSupportingDocs';
import ComplianceFileManager from './pages/ComplianceFileManager';
import ComplianceKnowledgeBase from './pages/ComplianceKnowledgeBase';
import ComplianceDirectorSignature from './pages/ComplianceDirectorSignature';

function ComplianceRoutes() {
  return (
    <Routes>
      <Route index element={<ComplianceDashboard />} />
      <Route path="document/:docId" element={<ComplianceDocumentChat />} />
      <Route path="audit" element={<ComplianceSelfAudit />} />
      <Route path="supporting-docs" element={<ComplianceSupportingDocs />} />
      <Route path="files" element={<ComplianceFileManager />} />
      <Route path="knowledge-base" element={<ComplianceKnowledgeBase />} />
      <Route path="signature" element={<ComplianceDirectorSignature />} />
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
