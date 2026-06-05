-- Lock down notifications: remove public read, server uses admin client
DROP POLICY IF EXISTS notifications_read_all ON public.notifications;

CREATE POLICY notifications_deny_select ON public.notifications
  FOR SELECT USING (false);

-- Remove notifications from Realtime publication to prevent broadcast leakage.
-- Notifications are delivered via polling through authenticated server functions.
ALTER PUBLICATION supabase_realtime DROP TABLE public.notifications;