export type CaseType = 'warranty_claim' | 'order_error' | 'freight_issue' | 'complaint' | 'general';
export type ErrorOrigin = 'order_entry' | 'warehouse' | 'unknown' | null;
export type CasePriority = 'normal' | 'urgent';
export type CaseStatus = 'open' | 'actioned' | 'in_hand' | 'closed';
export type TeamRole = 'admin' | 'staff' | 'warehouse';
export type TeamStatus = 'invited' | 'active' | 'deactivated';
export type ActionItemStatus = 'todo' | 'in_progress' | 'done';

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  avatar_colour: string;
  status: TeamStatus;
  last_seen_at: string;
  created_at: string;
}

export interface Case {
  id: string;
  case_number: string;
  user_id: string;
  type: CaseType;
  error_origin: ErrorOrigin;
  title: string;
  description: string;
  priority: CasePriority;
  status: CaseStatus;
  order_number: string;
  product_name: string;
  purchase_date: string;
  customer_reference: string | null;
  customer_name: string | null;
  cin7_sale_id: string | null;
  cin7_order_number: string | null;
  is_escalated: boolean;
  escalated_to_id: string | null;
  escalated_at: string | null;
  escalation_note: string | null;
  replacement_tracking_number: string | null;
  replacement_carrier: string | null;
  replacement_ship_date: string | null;
  replacement_tracked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaseUpdate {
  id: string;
  case_id: string;
  author_type: 'staff' | 'system';
  author_name: string;
  message: string;
  created_at: string;
}

export interface CaseAttachment {
  id: string;
  case_id: string;
  file_url: string;
  file_name: string;
  uploaded_at: string;
}

export interface ActionItem {
  id: string;
  case_id: string;
  description: string;
  assigned_to_email: string;
  assigned_to_name: string;
  due_date: string;
  priority: CasePriority;
  status: ActionItemStatus;
  created_by_name: string;
  created_at: string;
  completed_at: string | null;
  is_warehouse_task: boolean;
  is_replacement_pick: boolean;
  warehouse_result: string | null;
  shipstation_order_id: string | null;
  shipstation_order_number: string | null;
  picking_started_at: string | null;
  picked_at: string | null;
  dispatched_at: string | null;
}

export const STATUS_LABELS: Record<CaseStatus, string> = {
  open: 'New',
  actioned: 'Actioned',
  in_hand: 'In hand',
  closed: 'Closed',
};

export const CASE_TYPE_LABELS: Record<CaseType, string> = {
  warranty_claim: 'Warranty Claim',
  order_error: 'Order Error',
  freight_issue: 'Freight Issue',
  complaint: 'Complaint',
  general: 'General Enquiry',
};

export const STATUS_STEPS: CaseStatus[] = ['open', 'actioned', 'in_hand', 'closed'];
