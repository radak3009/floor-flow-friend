CREATE TABLE public.airtable_config (
  id text PRIMARY KEY,
  base_id text NOT NULL,
  pat_encrypted text NOT NULL,
  pat_iv text NOT NULL,
  tables jsonb,
  fields jsonb,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.airtable_config ENABLE ROW LEVEL SECURITY;

-- Deny-all: pristup ide isključivo kroz supabaseAdmin u server funkcijama
CREATE POLICY "deny_all_select" ON public.airtable_config FOR SELECT USING (false);
CREATE POLICY "deny_all_insert" ON public.airtable_config FOR INSERT WITH CHECK (false);
CREATE POLICY "deny_all_update" ON public.airtable_config FOR UPDATE USING (false);
CREATE POLICY "deny_all_delete" ON public.airtable_config FOR DELETE USING (false);