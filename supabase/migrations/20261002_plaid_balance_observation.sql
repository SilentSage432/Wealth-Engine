-- WE-BALANCE-001: cached depository balance observation and steward association.
-- Repository source only. Do not apply this file with supabase db push.
-- Observations are not vault_data, not plaid_accounts, and not confirmed meaning.
-- Financial Position changes only when the steward accepts a balance in the app.

CREATE TABLE public.plaid_balance_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  plaid_account_id text NOT NULL,
  current_cents integer,
  available_cents integer,
  iso_currency_code text,
  unofficial_currency_code text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  state text NOT NULL,
  CONSTRAINT plaid_balance_observations_source
    CHECK (source = 'accounts_get'),
  CONSTRAINT plaid_balance_observations_state
    CHECK (state IN ('current', 'superseded')),
  CONSTRAINT plaid_balance_observations_account
    CHECK (char_length(btrim(plaid_account_id)) > 0)
);

COMMENT ON TABLE public.plaid_balance_observations IS
  'Cached Plaid current and available balances for depository checking and savings. At most one current row and one superseded predecessor per owner and account. This is not Financial Position.';

CREATE UNIQUE INDEX plaid_balance_observations_one_current
  ON public.plaid_balance_observations (user_id, plaid_account_id)
  WHERE state = 'current';

CREATE UNIQUE INDEX plaid_balance_observations_one_superseded
  ON public.plaid_balance_observations (user_id, plaid_account_id)
  WHERE state = 'superseded';

ALTER TABLE public.plaid_balance_observations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.plaid_balance_observations FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id,
  user_id,
  plaid_account_id,
  current_cents,
  available_cents,
  iso_currency_code,
  unofficial_currency_code,
  observed_at,
  source,
  state
) ON TABLE public.plaid_balance_observations TO authenticated;
GRANT ALL ON TABLE public.plaid_balance_observations TO service_role;

CREATE POLICY plaid_balance_observations_select_own
  ON public.plaid_balance_observations
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE TABLE public.plaid_account_associations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  financial_account_id text NOT NULL,
  plaid_account_id text NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plaid_account_associations_ids
    CHECK (
      char_length(btrim(financial_account_id)) > 0
      AND char_length(btrim(plaid_account_id)) > 0
    ),
  CONSTRAINT plaid_account_associations_financial_unique
    UNIQUE (user_id, financial_account_id),
  CONSTRAINT plaid_account_associations_plaid_unique
    UNIQUE (user_id, plaid_account_id)
);

COMMENT ON TABLE public.plaid_account_associations IS
  'Steward confirmation that one vault FinancialAccount corresponds to one Plaid account. Not inferred. Not vault_data.';

ALTER TABLE public.plaid_account_associations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.plaid_account_associations FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id,
  user_id,
  financial_account_id,
  plaid_account_id,
  confirmed_at
) ON TABLE public.plaid_account_associations TO authenticated;
GRANT ALL ON TABLE public.plaid_account_associations TO service_role;

CREATE POLICY plaid_account_associations_select_own
  ON public.plaid_account_associations
  FOR SELECT
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Store cached balances from /accounts/get. Service role only.
-- Does not read or write the transaction cursor or the vault.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.apply_plaid_balance_observations(
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
  next_current integer;
  next_available integer;
  next_iso text;
  next_unofficial text;
  existing public.plaid_balance_observations%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  IF actor_user_id IS NULL OR observations IS NULL OR jsonb_typeof(observations) <> 'array' THEN
    RETURN jsonb_build_object('status', 'rejected');
  END IF;

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

    IF FOUND
      AND existing.current_cents IS NOT DISTINCT FROM next_current
      AND existing.available_cents IS NOT DISTINCT FROM next_available
      AND existing.iso_currency_code IS NOT DISTINCT FROM next_iso
      AND existing.unofficial_currency_code IS NOT DISTINCT FROM next_unofficial THEN
      UPDATE public.plaid_balance_observations
      SET observed_at = now()
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
      'accounts_get',
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

-- ---------------------------------------------------------------------------
-- One steward confirmation. Owner is auth.uid(). Kind is read from the vault.
-- Plaid type is read from plaid_accounts. Names and masks are not consulted.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.associate_plaid_financial_account(
  target_financial_account_id text,
  target_plaid_account_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  financial_id text := nullif(btrim(target_financial_account_id), '');
  plaid_id text := nullif(btrim(target_plaid_account_id), '');
  account_kind text;
  plaid_row public.plaid_accounts%ROWTYPE;
  existing_financial text;
  existing_plaid text;
BEGIN
  IF actor IS NULL THEN
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'unauthenticated');
  END IF;

  IF financial_id IS NULL OR plaid_id IS NULL THEN
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'invalid');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.plaid_accounts
    WHERE plaid_account_id = plaid_id
      AND user_id IS DISTINCT FROM actor
  ) OR EXISTS (
    SELECT 1
    FROM public.plaid_account_associations
    WHERE plaid_account_id = plaid_id
      AND user_id IS DISTINCT FROM actor
  ) OR EXISTS (
    SELECT 1
    FROM public.plaid_balance_observations
    WHERE plaid_account_id = plaid_id
      AND user_id IS DISTINCT FROM actor
  ) THEN
    RAISE EXCEPTION 'plaid_account_owner_conflict';
  END IF;

  SELECT *
  INTO plaid_row
  FROM public.plaid_accounts
  WHERE user_id = actor
    AND plaid_account_id = plaid_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'unknown_account');
  END IF;

  IF lower(btrim(plaid_row.account_type)) IS DISTINCT FROM 'depository'
    OR lower(btrim(plaid_row.subtype)) NOT IN ('checking', 'savings') THEN
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'ineligible_account');
  END IF;

  SELECT btrim(elem->>'kind')
  INTO account_kind
  FROM public.wealth_engine_vaults AS vault
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(vault.vault_data->'accounts') = 'array'
      THEN vault.vault_data->'accounts'
      ELSE '[]'::jsonb
    END
  ) AS elem
  WHERE vault.user_id = actor
    AND jsonb_typeof(elem) = 'object'
    AND elem->>'id' = financial_id
  LIMIT 1;

  IF account_kind IS NULL THEN
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'account_not_in_vault');
  END IF;

  IF account_kind NOT IN ('checking', 'savings') THEN
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'ineligible_account');
  END IF;

  SELECT plaid_account_id
  INTO existing_plaid
  FROM public.plaid_account_associations
  WHERE user_id = actor
    AND financial_account_id = financial_id
  FOR UPDATE;

  IF FOUND AND existing_plaid = plaid_id THEN
    RETURN jsonb_build_object('status', 'unchanged');
  END IF;

  IF FOUND THEN
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'already_associated');
  END IF;

  SELECT financial_account_id
  INTO existing_financial
  FROM public.plaid_account_associations
  WHERE user_id = actor
    AND plaid_account_id = plaid_id
  FOR UPDATE;

  IF FOUND THEN
    IF EXISTS (
      SELECT 1
      FROM public.wealth_engine_vaults AS vault
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(vault.vault_data->'accounts') = 'array'
          THEN vault.vault_data->'accounts'
          ELSE '[]'::jsonb
        END
      ) AS elem
      WHERE vault.user_id = actor
        AND elem->>'id' = existing_financial
    ) THEN
      RETURN jsonb_build_object('status', 'rejected', 'reason', 'already_associated');
    END IF;

    DELETE FROM public.plaid_account_associations
    WHERE user_id = actor
      AND plaid_account_id = plaid_id
      AND financial_account_id = existing_financial;
  END IF;

  INSERT INTO public.plaid_account_associations (
    user_id,
    financial_account_id,
    plaid_account_id
  )
  VALUES (
    actor,
    financial_id,
    plaid_id
  );

  RETURN jsonb_build_object('status', 'associated');
END;
$$;

REVOKE ALL ON FUNCTION public.associate_plaid_financial_account(text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.associate_plaid_financial_account(text, text)
  TO authenticated;

CREATE FUNCTION public.remove_plaid_financial_account_association(
  target_financial_account_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  financial_id text := nullif(btrim(target_financial_account_id), '');
  removed_id uuid;
BEGIN
  IF actor IS NULL THEN
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'unauthenticated');
  END IF;

  IF financial_id IS NULL THEN
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'invalid');
  END IF;

  DELETE FROM public.plaid_account_associations
  WHERE user_id = actor
    AND financial_account_id = financial_id
  RETURNING id INTO removed_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'absent');
  END IF;

  RETURN jsonb_build_object('status', 'removed');
END;
$$;

REVOKE ALL ON FUNCTION public.remove_plaid_financial_account_association(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_plaid_financial_account_association(text)
  TO authenticated;
