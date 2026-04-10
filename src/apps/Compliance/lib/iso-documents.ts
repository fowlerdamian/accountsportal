export interface ISODocument {
  id: string;
  title: string;
  clause: string;
  description: string;
  category: 'plan' | 'do' | 'check' | 'act';
  status: 'not_started' | 'in_progress' | 'complete';
  progress: number;
  messages: ChatMessage[];
  generatedContent?: string;
  answers?: Record<number, string>;
}

export interface ChatMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  timestamp: Date;
}

export interface AuditResult {
  documentId: string;
  documentTitle: string;
  clause: string;
  status: 'pass' | 'fail' | 'observation';
  finding: string;
  recommendation: string;
}

export interface DocumentQuestion {
  question: string;
  hint?: string;
}

export const ISO_DOCUMENTS: Omit<ISODocument, 'status' | 'progress' | 'messages' | 'generatedContent' | 'answers'>[] = [
  {
    id: 'quality-policy',
    title: 'Quality Policy',
    clause: '5.2',
    description: 'Strategic commitment to quality, customer satisfaction, and continual improvement.',
    category: 'plan',
  },
  {
    id: 'qms-scope',
    title: 'QMS Scope Statement',
    clause: '4.3',
    description: 'Defines the boundaries and applicability of the quality management system.',
    category: 'plan',
  },
  {
    id: 'context-analysis',
    title: 'Context of Organisation Analysis',
    clause: '4.1 / 4.2',
    description: 'SWOT/PESTLE analysis of internal and external issues and interested parties.',
    category: 'plan',
  },
  {
    id: 'risk-register',
    title: 'Risk & Opportunity Register',
    clause: '6.1',
    description: 'Documented risks and opportunities with planned actions and evaluation.',
    category: 'plan',
  },
  {
    id: 'quality-objectives',
    title: 'Quality Objectives & KPIs',
    clause: '6.2',
    description: 'Measurable objectives at relevant functions, levels, and processes.',
    category: 'plan',
  },
  {
    id: 'org-chart',
    title: 'Organisation Chart & Responsibilities',
    clause: '5.3',
    description: 'Roles, responsibilities, and authorities relevant to the QMS.',
    category: 'plan',
  },
  {
    id: 'process-map',
    title: 'Process Map & Interactions',
    clause: '4.4',
    description: 'Visual representation of QMS processes and their interactions.',
    category: 'do',
  },
  {
    id: 'competence-training',
    title: 'Competence & Training Records',
    clause: '7.2',
    description: 'Evidence of employee competence based on education, training, and experience.',
    category: 'do',
  },
  {
    id: 'document-control',
    title: 'Document Control Procedure',
    clause: '7.5',
    description: 'Creation, approval, distribution, and control of documented information.',
    category: 'do',
  },
  {
    id: 'supplier-management',
    title: 'Supplier Evaluation & Approved List',
    clause: '8.4',
    description: 'Criteria for selection, evaluation, and monitoring of external providers.',
    category: 'do',
  },
  {
    id: 'control-plans',
    title: 'Control Plans',
    clause: '8.5',
    description: 'Pre-launch and production control plans for products and processes.',
    category: 'do',
  },
  {
    id: 'nonconforming-product',
    title: 'Nonconforming Product Procedure',
    clause: '8.7',
    description: 'Identification, segregation, disposition, and documentation of nonconformities.',
    category: 'do',
  },
  {
    id: 'calibration-records',
    title: 'Calibration Schedule & Records',
    clause: '7.1.5',
    description: 'Monitoring and measuring equipment calibration traceable to national standards.',
    category: 'do',
  },
  {
    id: 'customer-satisfaction',
    title: 'Customer Satisfaction Monitoring',
    clause: '9.1.2',
    description: 'Methods for monitoring customer perception of requirement fulfilment.',
    category: 'check',
  },
  {
    id: 'internal-audit',
    title: 'Internal Audit Programme & Reports',
    clause: '9.2',
    description: 'Planned audit programme, criteria, scope, and documented results.',
    category: 'check',
  },
  {
    id: 'management-review',
    title: 'Management Review Minutes',
    clause: '9.3',
    description: 'Top management review of QMS performance with required inputs and outputs.',
    category: 'check',
  },
  {
    id: 'corrective-action',
    title: 'Corrective Action Procedure',
    clause: '10.2',
    description: 'Root cause analysis, corrective actions, and effectiveness verification.',
    category: 'act',
  },
  {
    id: 'continual-improvement',
    title: 'Continual Improvement Plan',
    clause: '10.3',
    description: 'Ongoing improvement activities based on data analysis and review outputs.',
    category: 'act',
  },
];

// Simplified, bite-sized questions for each document
export const DOCUMENT_QUESTIONS: Record<string, DocumentQuestion[]> = {
  'quality-policy': [
    { question: "What does your company do in one sentence?", hint: "e.g. We manufacture brake components for passenger vehicles" },
    { question: "Who are your main customers?", hint: "e.g. OEM car manufacturers, aftermarket retailers" },
    { question: "What quality standard do you want to commit to?", hint: "e.g. Zero defects, right first time" },
    { question: "How do you show commitment to customers?", hint: "e.g. On-time delivery, meeting specifications" },
    { question: "Do you have any regulatory requirements?", hint: "e.g. ADRs, REACH, RoHS" },
    { question: "What does improvement look like for you?", hint: "e.g. Reducing scrap, faster turnaround" },
    { question: "Who signs off on the quality policy?", hint: "e.g. Managing Director, CEO" },
  ],
  'qms-scope': [
    { question: "What is your company's full legal name?", hint: "e.g. Acme Manufacturing Pty Ltd" },
    { question: "What site(s) does the QMS cover?", hint: "e.g. Our factory at 42 Industrial Ave, Dandenong" },
    { question: "What products or services are included?", hint: "e.g. CNC machining of aluminium components" },
    { question: "Are any products or services excluded?", hint: "e.g. We don't do design — customers provide drawings" },
    { question: "Do you do any design or development?", hint: "Yes or No" },
    { question: "Are any departments or sites excluded?", hint: "e.g. Our retail showroom is excluded" },
    { question: "Are any ISO 9001 clauses not applicable?", hint: "e.g. Clause 8.3 Design — we manufacture to customer specs" },
  ],
  'context-analysis': [
    { question: "What are you really good at?", hint: "e.g. Fast turnaround, experienced staff" },
    { question: "What could you do better?", hint: "e.g. Documentation, succession planning" },
    { question: "What market opportunities do you see?", hint: "e.g. EV market growth, export potential" },
    { question: "What external risks worry you?", hint: "e.g. Supply chain disruption, rising costs" },
    { question: "Who are your key stakeholders?", hint: "e.g. Customers, staff, regulators, suppliers" },
    { question: "What do your customers expect from you?", hint: "e.g. On-time delivery, consistent quality" },
    { question: "What do your employees expect?", hint: "e.g. Safe workplace, fair pay, training" },
    { question: "Does climate or environment affect your business?", hint: "e.g. Energy costs, waste regulations" },
  ],
  'risk-register': [
    { question: "What could stop you delivering quality products?", hint: "e.g. Machine breakdown, staff shortage" },
    { question: "What could hurt your reputation?", hint: "e.g. Customer complaint, product recall" },
    { question: "What supply chain risks do you face?", hint: "e.g. Single-source supplier, import delays" },
    { question: "What people risks do you have?", hint: "e.g. Key person dependency, skill gaps" },
    { question: "What financial risks affect quality?", hint: "e.g. Cost-cutting on materials" },
    { question: "What opportunities could improve your business?", hint: "e.g. New technology, automation" },
    { question: "Who monitors risks in your company?", hint: "e.g. Quality Manager reviews monthly" },
  ],
  'quality-objectives': [
    { question: "What is your on-time delivery target?", hint: "e.g. 95% on-time delivery" },
    { question: "What is your scrap or rework target?", hint: "e.g. Less than 2% scrap rate" },
    { question: "What is your customer complaint target?", hint: "e.g. Zero major complaints per quarter" },
    { question: "Do you measure customer satisfaction? How?", hint: "e.g. Annual survey, target 8/10" },
    { question: "What other quality KPIs do you track?", hint: "e.g. First-pass yield, audit scores" },
    { question: "How often do you review these targets?", hint: "e.g. Monthly at management meeting" },
    { question: "Who is responsible for achieving them?", hint: "e.g. Each department manager" },
  ],
  'org-chart': [
    { question: "Who is the top person in charge?", hint: "e.g. John Smith, Managing Director" },
    { question: "Who manages quality?", hint: "e.g. Jane Doe, Quality Manager" },
    { question: "What departments do you have?", hint: "e.g. Production, Quality, Sales, Admin" },
    { question: "How many people in each department?", hint: "e.g. Production 20, Quality 3, Sales 5" },
    { question: "Who reports to whom?", hint: "e.g. Quality Manager reports to GM" },
    { question: "Who deals with customer complaints?", hint: "e.g. Quality Manager" },
    { question: "Do you have dedicated quality inspectors?", hint: "Yes or No, how many?" },
  ],
  'process-map': [
    { question: "How do you get new orders?", hint: "e.g. Customer sends RFQ, we quote, they send PO" },
    { question: "What happens after you receive an order?", hint: "e.g. Plan production, order materials" },
    { question: "Describe your main production steps.", hint: "e.g. Cut → Machine → Inspect → Pack" },
    { question: "How do you inspect finished products?", hint: "e.g. CMM check, visual inspection" },
    { question: "How do you ship to customers?", hint: "e.g. Courier, own truck, customer collects" },
    { question: "What support processes do you have?", hint: "e.g. Maintenance, HR, IT, purchasing" },
  ],
  'competence-training': [
    { question: "How many people work here?", hint: "e.g. 45 full-time, 10 casual" },
    { question: "What roles need special qualifications?", hint: "e.g. Welders need AS/NZS cert" },
    { question: "How do you train new staff?", hint: "e.g. Buddy system, on-the-job training" },
    { question: "How do you know training worked?", hint: "e.g. Skills test, supervisor sign-off" },
    { question: "Do you use any agency or temp workers?", hint: "Yes or No — how do you manage their skills?" },
    { question: "Where do you keep training records?", hint: "e.g. Spreadsheet, HR system, paper files" },
  ],
  'document-control': [
    { question: "How do you store documents? Paper or digital?", hint: "e.g. Mostly digital on shared drive" },
    { question: "Do you use any document software?", hint: "e.g. SharePoint, Google Drive, none" },
    { question: "Who approves new documents?", hint: "e.g. Quality Manager signs off" },
    { question: "How do you make sure old versions aren't used?", hint: "e.g. Only latest on server, old ones archived" },
    { question: "How do you handle external documents?", hint: "e.g. Customer drawings kept in project folder" },
    { question: "How long do you keep records?", hint: "e.g. 7 years minimum" },
  ],
  'supplier-management': [
    { question: "Roughly how many suppliers do you use?", hint: "e.g. About 30 active suppliers" },
    { question: "How do you choose a new supplier?", hint: "e.g. Get samples, check quality, compare price" },
    { question: "How do you check if suppliers are performing?", hint: "e.g. Track delivery and quality monthly" },
    { question: "Do you visit or audit your suppliers?", hint: "e.g. Top 5 suppliers audited annually" },
    { question: "What do you do about a poor-performing supplier?", hint: "e.g. Warning, improvement plan, replace" },
    { question: "Do you have an approved supplier list?", hint: "Yes or No" },
  ],
  'control-plans': [
    { question: "What are your main product types?", hint: "e.g. Machined brackets, welded assemblies" },
    { question: "What are the critical dimensions or features?", hint: "e.g. Bore diameter ±0.02mm" },
    { question: "What checks do you do during production?", hint: "e.g. First-off check, every 50th part" },
    { question: "What tools do you use for inspection?", hint: "e.g. CMM, calipers, go/no-go gauges" },
    { question: "What happens if a part fails inspection?", hint: "e.g. Quarantine, re-inspect batch" },
    { question: "Do you have any special processes?", hint: "e.g. Welding, heat treatment, painting" },
  ],
  'nonconforming-product': [
    { question: "How do you identify a bad part?", hint: "e.g. Red tag, quarantine area" },
    { question: "Where do you put nonconforming products?", hint: "e.g. Locked cage, separate shelf" },
    { question: "Who decides what to do with rejected parts?", hint: "e.g. Quality Manager decides scrap/rework" },
    { question: "Do you notify customers about quality issues?", hint: "e.g. Yes, within 24 hours" },
    { question: "How do you record nonconformities?", hint: "e.g. NCR form, spreadsheet, software" },
  ],
  'calibration-records': [
    { question: "What measuring tools do you use?", hint: "e.g. Calipers, micrometers, CMM" },
    { question: "How many items need calibrating?", hint: "e.g. About 50 instruments" },
    { question: "How often do you calibrate?", hint: "e.g. Annually, or every 6 months for critical items" },
    { question: "Who does your calibration?", hint: "e.g. External NATA lab, or in-house" },
    { question: "What do you do if something is out of calibration?", hint: "e.g. Quarantine, re-check affected parts" },
  ],
  'customer-satisfaction': [
    { question: "How do you get feedback from customers?", hint: "e.g. Surveys, phone calls, emails" },
    { question: "Do you run customer surveys?", hint: "e.g. Yes, annually via email" },
    { question: "How do you handle complaints?", hint: "e.g. Log it, investigate, respond within 48 hours" },
    { question: "What is your complaint response target?", hint: "e.g. Acknowledge within 24 hours" },
    { question: "Do you track returns or warranty claims?", hint: "e.g. Yes, in our quality system" },
    { question: "How do you share customer feedback with staff?", hint: "e.g. Monthly team meeting" },
  ],
  'internal-audit': [
    { question: "Do you have trained internal auditors?", hint: "e.g. Yes, 2 people trained" },
    { question: "How often do you plan to audit?", hint: "e.g. Each area once per year" },
    { question: "What areas will be audited?", hint: "e.g. All departments and key processes" },
    { question: "How do you make sure auditors are impartial?", hint: "e.g. They don't audit their own area" },
    { question: "How do you report audit findings?", hint: "e.g. Written report to management" },
  ],
  'management-review': [
    { question: "How often will management reviews happen?", hint: "e.g. Quarterly, twice a year" },
    { question: "Who attends the management review?", hint: "e.g. MD, GM, Quality Manager, department heads" },
    { question: "What information is reviewed?", hint: "e.g. KPIs, complaints, audit results, risks" },
    { question: "How do you record decisions and actions?", hint: "e.g. Meeting minutes with action items" },
    { question: "How do you follow up on action items?", hint: "e.g. Review at next meeting" },
  ],
  'corrective-action': [
    { question: "How do you investigate problems?", hint: "e.g. 5-Why analysis, fishbone diagram" },
    { question: "Who is responsible for investigating?", hint: "e.g. Quality Manager or department head" },
    { question: "How long should a corrective action take?", hint: "e.g. Close within 30 days" },
    { question: "How do you check the fix actually worked?", hint: "e.g. Re-inspect, monitor for recurrence" },
    { question: "Where do you record corrective actions?", hint: "e.g. CAR form, spreadsheet" },
  ],
  'continual-improvement': [
    { question: "Do you use any improvement methods?", hint: "e.g. Lean, Kaizen, suggestions box" },
    { question: "How do staff suggest improvements?", hint: "e.g. Suggestion form, team meetings" },
    { question: "How do you decide which improvements to pursue?", hint: "e.g. Cost-benefit, management review" },
    { question: "How do you measure if an improvement worked?", hint: "e.g. Compare KPIs before and after" },
    { question: "Who drives improvement in your company?", hint: "e.g. Quality Manager, all staff encouraged" },
  ],
};
