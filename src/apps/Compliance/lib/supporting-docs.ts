// Required supporting documentation mapped to ISO document IDs
export interface SupportingDocRequirement {
  id: string;
  documentId: string;
  title: string;
  description: string;
  clause: string;
}

export const SUPPORTING_DOC_REQUIREMENTS: SupportingDocRequirement[] = [
  // Competence & Training (7.2)
  { id: 'training-records', documentId: 'competence-training', title: 'Evidence of Training Records', description: 'Training certificates, attendance records, or sign-off sheets for employee training.', clause: '7.2' },
  { id: 'qualification-certs', documentId: 'competence-training', title: 'Qualification Certificates', description: 'Trade certificates, licences, or professional qualifications for relevant roles.', clause: '7.2' },
  { id: 'skills-matrix', documentId: 'competence-training', title: 'Skills Matrix', description: 'A matrix showing employee competencies against required skills for their roles.', clause: '7.2' },

  // Calibration (7.1.5)
  { id: 'calibration-certs', documentId: 'calibration-records', title: 'Calibration Certificates', description: 'Current calibration certificates for measuring and monitoring equipment.', clause: '7.1.5' },
  { id: 'equipment-register', documentId: 'calibration-records', title: 'Equipment Register', description: 'A list of all measuring equipment with calibration due dates and status.', clause: '7.1.5' },

  // Internal Audit (9.2)
  { id: 'audit-schedule', documentId: 'internal-audit', title: 'Internal Audit Schedule', description: 'Planned audit schedule showing areas, dates, and assigned auditors.', clause: '9.2' },
  { id: 'audit-reports', documentId: 'internal-audit', title: 'Audit Reports', description: 'Completed internal audit reports with findings and observations.', clause: '9.2' },
  { id: 'auditor-qualifications', documentId: 'internal-audit', title: 'Auditor Qualifications', description: 'Evidence of auditor training or certification (e.g. ISO 9001 Lead Auditor).', clause: '9.2' },

  // Management Review (9.3)
  { id: 'mgmt-review-minutes', documentId: 'management-review', title: 'Management Review Minutes', description: 'Minutes from management review meetings showing inputs, decisions, and actions.', clause: '9.3' },

  // Supplier Management (8.4)
  { id: 'supplier-evaluations', documentId: 'supplier-management', title: 'Supplier Evaluation Records', description: 'Completed supplier evaluation forms or scorecards.', clause: '8.4' },
  { id: 'approved-supplier-list', documentId: 'supplier-management', title: 'Approved Supplier List', description: 'Current approved supplier list with approval dates and status.', clause: '8.4' },

  // Customer Satisfaction (9.1.2)
  { id: 'customer-surveys', documentId: 'customer-satisfaction', title: 'Customer Satisfaction Surveys', description: 'Completed customer satisfaction surveys or feedback forms.', clause: '9.1.2' },
  { id: 'complaint-log', documentId: 'customer-satisfaction', title: 'Customer Complaint Log', description: 'Register of customer complaints with resolution details.', clause: '9.1.2' },

  // Corrective Action (10.2)
  { id: 'car-records', documentId: 'corrective-action', title: 'Corrective Action Records (CARs)', description: 'Completed corrective action reports showing root cause analysis and verification.', clause: '10.2' },

  // Nonconforming Product (8.7)
  { id: 'ncr-records', documentId: 'nonconforming-product', title: 'Nonconformance Reports (NCRs)', description: 'Records of nonconforming product/service with disposition decisions.', clause: '8.7' },

  // Document Control (7.5)
  { id: 'document-register', documentId: 'document-control', title: 'Document Master List', description: 'Register of all controlled documents with revision status and approval.', clause: '7.5' },

  // Control Plans (8.5)
  { id: 'inspection-records', documentId: 'control-plans', title: 'Inspection & Test Records', description: 'Completed inspection records, test results, or quality check sheets.', clause: '8.5' },
];
