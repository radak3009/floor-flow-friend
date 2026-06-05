CREATE TABLE public.airtable_cache (
  cache_key text PRIMARY KEY,
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_airtable_cache_expires_at ON public.airtable_cache(expires_at);

GRANT ALL ON public.airtable_cache TO service_role;

ALTER TABLE public.airtable_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY airtable_cache_deny_select ON public.airtable_cache FOR SELECT USING (false);
CREATE POLICY airtable_cache_deny_insert ON public.airtable_cache FOR INSERT WITH CHECK (false);
CREATE POLICY airtable_cache_deny_update ON public.airtable_cache FOR UPDATE USING (false);
CREATE POLICY airtable_cache_deny_delete ON public.airtable_cache FOR DELETE USING (false);

ALTER TABLE public.airtable_config ADD COLUMN IF NOT EXISTS webhooks jsonb NOT NULL DEFAULT '{}'::jsonb;