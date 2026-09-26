-- WE-NOTIFY-004 delivery dedupe.
-- Operational notification state only. Not financial truth.
-- NOT APPLIED. Do not replay with supabase db push.

CREATE TABLE public.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  attention_key text NOT NULL,
  civil_date date NOT NULL,
  status text NOT NULL,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_deliveries_status_check
    CHECK (status IN ('succeeded', 'failed')),
  CONSTRAINT notification_deliveries_failure_check
    CHECK (
      (status = 'succeeded' AND failure_code IS NULL)
      OR (
        status = 'failed'
        AND failure_code IN ('transient', 'no-endpoint')
      )
    ),
  CONSTRAINT notification_deliveries_attention_key_check
    CHECK (
      attention_key ~ '^(due:[A-Za-z0-9_-]{1,80}|due:[A-Za-z0-9_-]{1,80}:[0-9]{4}-[0-9]{2}|month-close:[0-9]{4}-[0-9]{2})$'
    )
);

COMMENT ON TABLE public.notification_deliveries IS
  'Operational Attention delivery dedupe. No vault contents, amounts, or subscription credentials.';

CREATE UNIQUE INDEX notification_deliveries_one_success
  ON public.notification_deliveries (user_id, attention_key, civil_date)
  WHERE status = 'succeeded';

CREATE INDEX notification_deliveries_user_civil_date
  ON public.notification_deliveries (user_id, civil_date);

CREATE TRIGGER notification_deliveries_set_updated_at
  BEFORE UPDATE ON public.notification_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_notification_updated_at();

ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.notification_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.notification_deliveries TO service_role;
