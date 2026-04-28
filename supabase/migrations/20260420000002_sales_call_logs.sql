-- sales_call_logs: one row per Dialpad call event
CREATE TABLE IF NOT EXISTS sales_call_logs (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id           uuid        REFERENCES sales_leads(id) ON DELETE SET NULL,
  dialpad_call_id   text        UNIQUE,
  direction         text        NOT NULL DEFAULT 'outbound', -- 'inbound' | 'outbound'
  from_number       text,
  to_number         text,
  duration_seconds  integer     NOT NULL DEFAULT 0,
  status            text        NOT NULL DEFAULT 'answered', -- 'answered' | 'missed' | 'voicemail' | 'busy'
  started_at        timestamptz,
  ended_at          timestamptz,
  recording_url     text,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scl_lead_id    ON sales_call_logs(lead_id);
CREATE INDEX IF NOT EXISTS idx_scl_from       ON sales_call_logs(from_number);
CREATE INDEX IF NOT EXISTS idx_scl_to         ON sales_call_logs(to_number);
CREATE INDEX IF NOT EXISTS idx_scl_created_at ON sales_call_logs(created_at DESC);

ALTER TABLE sales_call_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_users" ON sales_call_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
