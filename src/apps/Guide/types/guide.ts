export interface Brand {
  id: string;
  key: string;
  name: string;
  domain: string;
  logo_url: string;
  primary_colour: string;
  support_phone: string;
  support_email: string;
  dymo_label_size: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  guide_count?: number;
}

export interface InstructionSet {
  id: string;
  title: string;
  product_code: string;
  short_description: string;
  product_image_url: string;
  tools_required: string[];
  category_id: string;
  estimated_time: string;
  slug: string;
  notice_text?: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface GuidePublication {
  id: string;
  instruction_set_id: string;
  brand_id: string;
  status: 'draft' | 'published';
  published_at?: string;
  dymo_label_url?: string;
}

export interface InstructionStep {
  id: string;
  instruction_set_id: string;
  variant_id?: string;
  step_number: number;
  subtitle: string;
  description: string;
  image_url?: string;
  image_original_url?: string;
  image2_url?: string;
  image2_original_url?: string;
  order_index: number;
}

export interface GuideVariant {
  id: string;
  instruction_set_id: string;
  variant_label: string;
  slug: string;
}

export interface SupportQuestion {
  id: string;
  instruction_set_id: string;
  brand_id: string;
  step_number?: number;
  session_id: string;
  question: string;
  answer?: string;
  escalated: boolean;
  resolved: boolean;
  created_at: string;
}

export interface Feedback {
  id: string;
  instruction_set_id: string;
  brand_id: string;
  variant_id?: string;
  rating?: number;
  comment?: string;
  flagged_step?: number;
  type: 'rating' | 'comment' | 'flag';
  resolved: boolean;
  created_at: string;
  session_id: string;
}

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: 'admin' | 'editor';
  last_active?: string;
}

export interface GuideWithMeta extends InstructionSet {
  category_name?: string;
  publications: GuidePublication[];
  steps: InstructionStep[];
  avg_rating?: number;
  views_30d?: number;
}
