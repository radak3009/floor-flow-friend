-- Remove public read policy on comments; all reads go through supabaseAdmin in server functions
DROP POLICY IF EXISTS comments_read_all ON public.comments;

-- Explicit deny-all SELECT for anon/authenticated (defense in depth)
CREATE POLICY comments_deny_select ON public.comments FOR SELECT USING (false);

-- Remove comments from realtime publication so anon clients cannot subscribe to broadcasts
ALTER PUBLICATION supabase_realtime DROP TABLE public.comments;

-- Also add explicit deny write policies on notifications to match the pattern on other tables
CREATE POLICY notifications_deny_insert ON public.notifications FOR INSERT WITH CHECK (false);
CREATE POLICY notifications_deny_update ON public.notifications FOR UPDATE USING (false);
CREATE POLICY notifications_deny_delete ON public.notifications FOR DELETE USING (false);