-- WE-BALANCE-FRESHNESS-005: real-time balance provenance.
-- Repository source only. Do not apply this file with supabase db push.
-- One current observation row remains. balance_get may replace accounts_get.
-- accounts_get must not replace, supersede, downgrade, or restamp balance_get.

ALTER TABLE public.plaid_balance_observations
  DROP CONSTRAINT plaid_balance_observations_source;

ALTER TABLE public.plaid_balance_observations
  ADD CONSTRAINT plaid_balance_observations_source
  CHECK (source IN ('accounts_get', 'balance_get'));

COMMENT ON TABLE public.plaid_balance_observations IS
  'Plaid current and available balances for depository checking and savings. source accounts_get is a cached /accounts/get reading. source balance_get is an institution-refreshed /accounts/balance/get reading. At most one current row and one superseded predecessor per owner and account. This is not Financial Position.';

CREATE OR REPLACE FUNCTION public.apply_plaid_balance_observations(
  actor_user_id uuid,
  observations jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  obs record;
  acct_id text;
  acct_type text;
  acct_subtype text;
  next_source text;
  next_current integer;
  next_available integer;
  next_iso text;
  next_unofficial text;
  existing public.plaid_balance_observations%ROWTYPE;
  incoming_eligible boolean;
  existing_eligible boolean;
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  IF actor_user_id IS NULL OR observations IS NULL OR jsonb_typeof(observations) <> 'array' THEN
    RETURN jsonb_build_object('status', 'rejected');
  END IF;

  -- Normalize source before any write. Missing or JSON-null source defaults to
  -- accounts_get because the legacy deployed recorder omitted source and only
  -- called /accounts/get. Unknown explicit values, including '', still reject.
  FOR obs IN
    SELECT value
    FROM jsonb_array_elements(observations)
  LOOP
    acct_type := lower(btrim(obs.value->>'account_type'));
    acct_subtype := lower(btrim(obs.value->>'subtype'));
    IF acct_type IS DISTINCT FROM 'depository'
      OR acct_subtype NOT IN ('checking', 'savings') THEN
      CONTINUE;
    END IF;

    acct_id := nullif(btrim(obs.value->>'plaid_account_id'), '');
    IF acct_id IS NULL THEN
      CONTINUE;
    END IF;

    next_source := obs.value->>'source';
    IF next_source IS NULL THEN
      next_source := 'accounts_get';
    ELSIF next_source NOT IN ('accounts_get', 'balance_get') THEN
      RETURN jsonb_build_object('status', 'rejected');
    END IF;
  END LOOP;

  FOR obs IN
    SELECT value
    FROM jsonb_array_elements(observations)
  LOOP
    acct_type := lower(btrim(obs.value->>'account_type'));
    acct_subtype := lower(btrim(obs.value->>'subtype'));
    IF acct_type IS DISTINCT FROM 'depository'
      OR acct_subtype NOT IN ('checking', 'savings') THEN
      CONTINUE;
    END IF;

    acct_id := nullif(btrim(obs.value->>'plaid_account_id'), '');
    IF acct_id IS NULL THEN
      CONTINUE;
    END IF;

    next_source := obs.value->>'source';
    IF next_source IS NULL THEN
      next_source := 'accounts_get';
    ELSIF next_source NOT IN ('accounts_get', 'balance_get') THEN
      RETURN jsonb_build_object('status', 'rejected');
    END IF;

    IF jsonb_typeof(obs.value->'current_cents') = 'number' THEN
      next_current := (obs.value->>'current_cents')::integer;
    ELSIF obs.value->'current_cents' IS NULL
      OR jsonb_typeof(obs.value->'current_cents') = 'null' THEN
      next_current := NULL;
    ELSE
      CONTINUE;
    END IF;

    IF jsonb_typeof(obs.value->'available_cents') = 'number' THEN
      next_available := (obs.value->>'available_cents')::integer;
    ELSIF obs.value->'available_cents' IS NULL
      OR jsonb_typeof(obs.value->'available_cents') = 'null' THEN
      next_available := NULL;
    ELSE
      CONTINUE;
    END IF;

    IF jsonb_typeof(obs.value->'iso_currency_code') = 'string' THEN
      next_iso := nullif(btrim(obs.value->>'iso_currency_code'), '');
    ELSIF obs.value->'iso_currency_code' IS NULL
      OR jsonb_typeof(obs.value->'iso_currency_code') = 'null' THEN
      next_iso := NULL;
    ELSE
      CONTINUE;
    END IF;

    IF jsonb_typeof(obs.value->'unofficial_currency_code') = 'string' THEN
      next_unofficial := nullif(btrim(obs.value->>'unofficial_currency_code'), '');
    ELSIF obs.value->'unofficial_currency_code' IS NULL
      OR jsonb_typeof(obs.value->'unofficial_currency_code') = 'null' THEN
      next_unofficial := NULL;
    ELSE
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.plaid_balance_observations
      WHERE plaid_account_id = acct_id
        AND user_id IS DISTINCT FROM actor_user_id
    ) OR EXISTS (
      SELECT 1
      FROM public.plaid_accounts
      WHERE plaid_account_id = acct_id
        AND user_id IS DISTINCT FROM actor_user_id
    ) THEN
      RAISE EXCEPTION 'plaid_account_owner_conflict';
    END IF;

    SELECT *
    INTO existing
    FROM public.plaid_balance_observations
    WHERE user_id = actor_user_id
      AND plaid_account_id = acct_id
      AND state = 'current'
    FOR UPDATE;

    incoming_eligible := next_current IS NOT NULL
      AND next_iso = 'USD'
      AND next_unofficial IS NULL;
    IF FOUND THEN
      existing_eligible := existing.current_cents IS NOT NULL
        AND existing.iso_currency_code = 'USD'
        AND existing.unofficial_currency_code IS NULL;
    ELSE
      existing_eligible := false;
    END IF;

    IF next_source = 'accounts_get' AND FOUND AND existing.source = 'balance_get' THEN
      CONTINUE;
    END IF;

    IF next_source = 'balance_get'
      AND NOT incoming_eligible
      AND existing_eligible THEN
      CONTINUE;
    END IF;

    IF FOUND
      AND existing.current_cents IS NOT DISTINCT FROM next_current
      AND existing.available_cents IS NOT DISTINCT FROM next_available
      AND existing.iso_currency_code IS NOT DISTINCT FROM next_iso
      AND existing.unofficial_currency_code IS NOT DISTINCT FROM next_unofficial THEN
      UPDATE public.plaid_balance_observations
      SET observed_at = now(),
          source = next_source
      WHERE id = existing.id
        AND user_id = actor_user_id
        AND state = 'current';
      CONTINUE;
    END IF;

    IF FOUND THEN
      DELETE FROM public.plaid_balance_observations
      WHERE user_id = actor_user_id
        AND plaid_account_id = acct_id
        AND state = 'superseded';

      UPDATE public.plaid_balance_observations
      SET state = 'superseded'
      WHERE id = existing.id
        AND user_id = actor_user_id
        AND state = 'current';
    END IF;

    INSERT INTO public.plaid_balance_observations (
      user_id,
      plaid_account_id,
      current_cents,
      available_cents,
      iso_currency_code,
      unofficial_currency_code,
      observed_at,
      source,
      state
    )
    VALUES (
      actor_user_id,
      acct_id,
      next_current,
      next_available,
      next_iso,
      next_unofficial,
      now(),
      next_source,
      'current'
    );
  END LOOP;

  RETURN jsonb_build_object('status', 'applied');
END;
$$;

REVOKE ALL ON FUNCTION public.apply_plaid_balance_observations(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_plaid_balance_observations(uuid, jsonb)
  TO service_role;
