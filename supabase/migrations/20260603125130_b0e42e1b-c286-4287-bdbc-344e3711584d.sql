CREATE TABLE public.wo_status_locks (
  radni_nalog_id text PRIMARY KEY,
  current_status text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

GRANT ALL ON public.wo_status_locks TO service_role;

ALTER TABLE public.wo_status_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wo_status_locks_deny_select" ON public.wo_status_locks FOR SELECT USING (false);
CREATE POLICY "wo_status_locks_deny_insert" ON public.wo_status_locks FOR INSERT WITH CHECK (false);
CREATE POLICY "wo_status_locks_deny_update" ON public.wo_status_locks FOR UPDATE USING (false);
CREATE POLICY "wo_status_locks_deny_delete" ON public.wo_status_locks FOR DELETE USING (false);