-- ─────────────────────────────────────────────────────────────────────────────
-- Sales Support Schema
-- Covers TrailBait (wholesale), FleetCraft (fleet/commercial), AGA (bespoke/OEM)
-- ─────────────────────────────────────────────────────────────────────────────

-- Channel enum
DO $$ BEGIN
  CREATE TYPE sales_channel AS ENUM ('trailbait', 'fleetcraft', 'aga');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- sales_leads — discovered/researched leads before they hit HubSpot
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sales_leads (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel                     sales_channel NOT NULL,
  company_name                TEXT NOT NULL,
  website                     TEXT,
  phone                       TEXT,
  email                       TEXT,
  address                     TEXT,
  state                       TEXT,
  postcode                    TEXT,

  -- Enrichment data
  google_rating               NUMERIC(2,1),
  google_review_count         INTEGER,
  google_place_id             TEXT,
  social_facebook             TEXT,
  social_instagram            TEXT,
  social_linkedin             TEXT,
  website_summary             TEXT,
  key_products_services       TEXT[],

  -- Contact info
  recommended_contact_name    TEXT,
  recommended_contact_position TEXT,
  recommended_contact_source  TEXT,

  -- Discovery metadata
  discovery_source            TEXT NOT NULL,  -- google_maps | news_tender | press_release | manual | web_scrape
  discovery_query             TEXT,
  discovery_date              TIMESTAMPTZ DEFAULT now(),
  tender_context              TEXT,           -- FleetCraft: contract/agency/value context

  -- HubSpot sync
  hubspot_company_id          TEXT,
  hubspot_deal_id             TEXT,
  hubspot_synced_at           TIMESTAMPTZ,

  -- Cin7 match
  cin7_customer_id            TEXT,
  cin7_customer_tag           TEXT,           -- D | F | A
  is_existing_customer        BOOLEAN DEFAULT false,

  -- Scoring
  lead_score                  INTEGER DEFAULT 0,
  score_breakdown             JSONB,

  -- Workflow status
  status                      TEXT DEFAULT 'new'
                                CHECK (status IN ('new','researched','enriched','queued','contacted','converted','disqualified')),
  disqualification_reason     TEXT,

  created_at                  TIMESTAMPTZ DEFAULT now(),
  updated_at                  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.sales_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage leads"
  ON public.sales_leads FOR ALL
  USING (auth.role() = 'authenticated');

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.sales_leads_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS sales_leads_updated_at ON public.sales_leads;
CREATE TRIGGER sales_leads_updated_at
  BEFORE UPDATE ON public.sales_leads
  FOR EACH ROW EXECUTE FUNCTION public.sales_leads_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- call_list — daily prioritised call entries
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.call_list (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id                 UUID REFERENCES public.sales_leads(id) ON DELETE CASCADE,
  channel                 sales_channel NOT NULL,
  priority_rank           INTEGER,
  call_reason             TEXT NOT NULL,
  talking_points          TEXT[],
  context_brief           JSONB,

  -- Outcome
  called_at               TIMESTAMPTZ,
  call_outcome            TEXT
                            CHECK (call_outcome IN ('connected','voicemail','no_answer','callback','not_interested') OR call_outcome IS NULL),
  call_notes              TEXT,
  hubspot_note_synced     BOOLEAN DEFAULT false,

  -- Scheduling
  scheduled_date          DATE DEFAULT CURRENT_DATE,
  is_complete             BOOLEAN DEFAULT false,

  created_at              TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.call_list ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage call list"
  ON public.call_list FOR ALL
  USING (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────────────────────────────────────
-- trailbait_order_history — Cin7 order data cache for TrailBait scoring
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.trailbait_order_history (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cin7_customer_id        TEXT NOT NULL,
  lead_id                 UUID REFERENCES public.sales_leads(id),
  last_order_date         TIMESTAMPTZ,
  order_count_30d         INTEGER DEFAULT 0,
  order_count_90d         INTEGER DEFAULT 0,
  total_revenue_90d       NUMERIC(12,2) DEFAULT 0,
  average_order_value     NUMERIC(10,2) DEFAULT 0,
  top_products            JSONB,            -- [{sku, name, qty}]
  days_since_last_order   INTEGER,
  is_winback_candidate    BOOLEAN DEFAULT false,
  last_synced             TIMESTAMPTZ DEFAULT now(),
  UNIQUE(cin7_customer_id)
);

ALTER TABLE public.trailbait_order_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage order history"
  ON public.trailbait_order_history FOR ALL
  USING (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────────────────────────────────────
-- research_jobs — nightly job execution log
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.research_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel         sales_channel NOT NULL,
  job_type        TEXT NOT NULL,    -- discovery | enrichment | scoring | cin7_sync | calllist_gen
  status          TEXT DEFAULT 'pending'
                    CHECK (status IN ('pending','running','completed','failed')),
  leads_found     INTEGER DEFAULT 0,
  leads_enriched  INTEGER DEFAULT 0,
  error_log       TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.research_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view research jobs"
  ON public.research_jobs FOR ALL
  USING (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────────────────────────────────────
-- scoring_config — per-channel scoring weights (adjustable)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.scoring_config (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel        sales_channel NOT NULL,
  factor_name    TEXT NOT NULL,
  weight         INTEGER NOT NULL,
  scoring_rules  JSONB,
  UNIQUE(channel, factor_name)
);

ALTER TABLE public.scoring_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage scoring config"
  ON public.scoring_config FOR ALL
  USING (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_leads_channel      ON public.sales_leads(channel);
CREATE INDEX IF NOT EXISTS idx_leads_status       ON public.sales_leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_score        ON public.sales_leads(lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_hubspot      ON public.sales_leads(hubspot_company_id);
CREATE INDEX IF NOT EXISTS idx_leads_cin7         ON public.sales_leads(cin7_customer_id);
CREATE INDEX IF NOT EXISTS idx_calllist_date      ON public.call_list(scheduled_date, channel);
CREATE INDEX IF NOT EXISTS idx_calllist_priority  ON public.call_list(scheduled_date, priority_rank);
CREATE INDEX IF NOT EXISTS idx_order_winback      ON public.trailbait_order_history(is_winback_candidate);

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: default scoring configuration
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.scoring_config (channel, factor_name, weight, scoring_rules) VALUES

-- TrailBait
('trailbait', 'google_rating',       15, '{"tiers":[{"min":4.5,"max":5.0,"points":15},{"min":4.0,"max":4.49,"points":10},{"min":0,"max":3.99,"points":5},{"missing":true,"points":0}]}'),
('trailbait', 'google_review_count', 10, '{"tiers":[{"min":50,"points":10},{"min":20,"max":49,"points":7},{"min":5,"max":19,"points":4},{"min":1,"max":4,"points":1},{"missing":true,"points":0}]}'),
('trailbait', 'website_quality',     10, '{"tiers":[{"value":"products","points":10},{"value":"basic","points":5},{"value":"none","points":0}]}'),
('trailbait', 'social_presence',     10, '{"tiers":[{"min":2,"points":10},{"min":1,"max":1,"points":5},{"min":0,"max":0,"points":0}]}'),
('trailbait', 'is_existing_customer',10, '{"existing":0,"new":10}'),
('trailbait', 'winback_candidate',   15, '{"winback":15,"not_winback":0}'),
('trailbait', 'order_health',        15, '{"declining":15,"stable":5,"growing":0,"new_lead":8}'),
('trailbait', 'contact_found',       10, '{"name_and_position":10,"name_only":8,"position_only":5,"none":0}'),
('trailbait', 'geography',            5, '{"metro":5,"regional":3,"remote":1}'),

-- FleetCraft
('fleetcraft', 'is_installer',       20, '{"confirmed":20,"likely":10,"unclear":0}'),
('fleetcraft', 'government_contracts',15,'{"tenders_found":15,"none":0}'),
('fleetcraft', 'google_rating',      10, '{"tiers":[{"min":4.5,"max":5.0,"points":10},{"min":4.0,"max":4.49,"points":7},{"min":0,"max":3.99,"points":3},{"missing":true,"points":0}]}'),
('fleetcraft', 'company_size',       15, '{"large":15,"medium":8,"small":3}'),
('fleetcraft', 'website_quality',    10, '{"tiers":[{"value":"products","points":10},{"value":"basic","points":5},{"value":"none","points":0}]}'),
('fleetcraft', 'social_presence',    10, '{"tiers":[{"min":2,"points":10},{"min":1,"max":1,"points":5},{"min":0,"max":0,"points":0}]}'),
('fleetcraft', 'contact_found',      10, '{"name_and_position":10,"name_only":8,"position_only":5,"none":0}'),
('fleetcraft', 'is_existing_customer',10,'{"existing":0,"new":10}'),

-- AGA
('aga', 'has_own_brand',             25, '{"yes":25,"no":0}'),
('aga', 'currently_imports',         15, '{"imports":15,"local_manufacture":5,"unknown":8}'),
('aga', 'company_size',              15, '{"large":15,"medium":10,"small":5}'),
('aga', 'website_quality',           10, '{"tiers":[{"value":"products","points":10},{"value":"basic","points":5},{"value":"none","points":0}]}'),
('aga', 'product_fit',               15, '{"automotive_accessories":15,"adjacent":8,"poor_fit":0}'),
('aga', 'contact_found',             10, '{"name_and_position":10,"name_only":8,"position_only":5,"none":0}'),
('aga', 'is_existing_customer',      10, '{"existing":0,"new":10}')

ON CONFLICT (channel, factor_name) DO NOTHING;
