CREATE TABLE public.downtime_idempotency (
  idempotency_key text PRIMARY KEY,
  monitoring_id text NOT NULL,
  user_id text NOT NULL,
  ongoing boolean NOT NULL,
  kraj timestamptz,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX downtime_idempotency_monitoring_recent_idx
  ON public.downtime_idempotency (monitoring_id, created_at DESC);
GRANT ALL ON public.downtime_idempotency TO service_role;
ALTER TABLE public.downtime_idempotency ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_select" ON public.downtime_idempotency FOR SELECT TO service_role USING (true);