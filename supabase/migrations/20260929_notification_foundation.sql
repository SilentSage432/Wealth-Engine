-- =============================================================================
-- Wealth Engine — WE-NOTIFY-002 notification preference and push subscriptions
-- Migration: 20260929_notification_foundation.sql
--
-- Operational delivery configuration only. Not a financial document.
-- Does not read or write the planning document. Does not store delivery history.
-- Apply deliberately. Do not treat this file as already applied.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. One preference row per auth user. enabled is stored, not inferred.
-- ---------------------------------------------------------------------------
CREATE TABLE public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  enabled boolean NOT NULL,
  iana_timezone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_preferences_timezone_bounds
    CHECK (
      char_length(btrim(iana_timezone)) >= 1
      AND char_length(iana_timezone) <= 100
    )
);

COMMENT ON TABLE public.notification_preferences IS
  'Steward notification switch and IANA timezone. Not the planning document. No balances, bills, or bank observations.';

COMMENT ON COLUMN public.notification_preferences.iana_timezone IS
  'IANA timezone name such as America/Denver. Not a UTC offset. Validity is enforced by the API.';

-- ---------------------------------------------------------------------------
-- 2. One row per push endpoint. Keys are operational credentials.
-- ---------------------------------------------------------------------------
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_subscriptions_endpoint_unique UNIQUE (endpoint),
  CONSTRAINT push_subscriptions_endpoint_https
    CHECK (endpoint LIKE 'https://%' AND char_length(endpoint) <= 2048),
  CONSTRAINT push_subscriptions_p256dh_bounds
    CHECK (char_length(btrim(p256dh)) >= 1 AND char_length(p256dh) <= 256),
  CONSTRAINT push_subscriptions_auth_bounds
    CHECK (char_length(btrim(auth)) >= 1 AND char_length(auth) <= 256)
);

COMMENT ON TABLE public.push_subscriptions IS
  'Web Push endpoints for one steward. endpoint, p256dh, and auth are credentials. Not a ledger and not delivery history.';

COMMENT ON COLUMN public.push_subscriptions.auth IS
  'Web Push auth secret. Not a Supabase session and not a vault PIN.';

CREATE INDEX push_subscriptions_user_idx
  ON public.push_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- 3. updated_at. Authenticated updates fire this trigger.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_notification_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER notification_preferences_set_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_notification_updated_at();

CREATE TRIGGER push_subscriptions_set_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_notification_updated_at();

REVOKE ALL ON FUNCTION public.touch_notification_updated_at() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_notification_updated_at() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Grants. Authenticated owners write their own rows through RLS.
-- service_role keeps table privileges for a later server evaluator.
-- These routes do not use the service role. JWT clients cannot read
-- subscription key material back.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.notification_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.notification_preferences TO authenticated;
GRANT UPDATE (enabled, iana_timezone, updated_at)
  ON TABLE public.notification_preferences TO authenticated;
GRANT ALL ON TABLE public.notification_preferences TO service_role;

REVOKE ALL ON TABLE public.push_subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, user_id, endpoint, created_at, updated_at)
  ON TABLE public.push_subscriptions TO authenticated;
GRANT INSERT ON TABLE public.push_subscriptions TO authenticated;
GRANT UPDATE (p256dh, auth, updated_at)
  ON TABLE public.push_subscriptions TO authenticated;
GRANT DELETE ON TABLE public.push_subscriptions TO authenticated;
GRANT ALL ON TABLE public.push_subscriptions TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Owner RLS. No anonymous policies. No cross-user policies.
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_preferences_select_own
  ON public.notification_preferences
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY notification_preferences_insert_own
  ON public.notification_preferences
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY notification_preferences_update_own
  ON public.notification_preferences
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY notification_preferences_delete_own
  ON public.notification_preferences
  FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY push_subscriptions_select_own
  ON public.push_subscriptions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY push_subscriptions_insert_own
  ON public.push_subscriptions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY push_subscriptions_update_own
  ON public.push_subscriptions
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY push_subscriptions_delete_own
  ON public.push_subscriptions
  FOR DELETE
  USING (auth.uid() = user_id);
