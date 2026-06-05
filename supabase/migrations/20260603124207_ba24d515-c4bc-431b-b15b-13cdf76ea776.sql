CREATE TABLE public.login_attempts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  id_zaposlenog text NOT NULL,
  uredaj text,
  ip text,
  success boolean NOT NULL,
  reason text NOT NULL,
  attempted_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT ALL ON public.login_attempts TO service_role;

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "login_attempts_deny_select" ON public.login_attempts FOR SELECT USING (false);
CREATE POLICY "login_attempts_deny_insert" ON public.login_attempts FOR INSERT WITH CHECK (false);
CREATE POLICY "login_attempts_deny_update" ON public.login_attempts FOR UPDATE USING (false);
CREATE POLICY "login_attempts_deny_delete" ON public.login_attempts FOR DELETE USING (false);

CREATE INDEX idx_login_attempts_user_time ON public.login_attempts (id_zaposlenog, attempted_at DESC);
