-- WE-ATTENTION-003C: observational Plaid account identity.
-- Descriptors arrive on /transactions/sync and are stored with that page.
-- This is not a Wealth Engine FinancialAccount and stores no balances.
-- Observations stay in plaid_transactions. There is no foreign key from
-- those rows to this table, so a missing descriptor cannot delete history.

CREATE TABLE public.plaid_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  plaid_item_id uuid NOT NULL REFERENCES public.plaid_items (id) ON DELETE CASCADE,
  plaid_account_id text NOT NULL,
  name text,
  mask text,
  account_type text,
  subtype text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plaid_accounts_user_account_unique UNIQUE (user_id, plaid_account_id)
);

CREATE INDEX plaid_accounts_item_idx ON public.plaid_accounts (plaid_item_id);

ALTER TABLE public.plaid_accounts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.plaid_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id,
  user_id,
  plaid_item_id,
  plaid_account_id,
  name,
  mask,
  account_type,
  subtype,
  created_at,
  updated_at
) ON TABLE public.plaid_accounts TO authenticated;
GRANT ALL ON TABLE public.plaid_accounts TO service_role;

DROP POLICY IF EXISTS "Users can select own plaid accounts" ON public.plaid_accounts;
CREATE POLICY "Users can select own plaid accounts"
  ON public.plaid_accounts
  FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT / UPDATE / DELETE policies. Sync writes through service_role.

DROP FUNCTION IF EXISTS public.apply_plaid_sync_page(uuid, uuid, uuid, text, text, jsonb, text[]);

CREATE FUNCTION public.apply_plaid_sync_page(
  actor_user_id uuid,
  target_item_id uuid,
  lock_token uuid,
  expected_cursor text,
  next_cursor text,
  observations jsonb,
  removed_ids text[],
  accounts jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  found_item public.plaid_items%ROWTYPE;
  obs record;
  txn_id text;
  account_id_value text;
  txn_name text;
  amt numeric;
  txn_date date;
  pending_flag boolean;
  acct_id text;
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  SELECT *
  INTO found_item
  FROM public.plaid_items
  WHERE id = target_item_id
  FOR UPDATE;

  IF NOT FOUND OR found_item.user_id IS DISTINCT FROM actor_user_id THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF found_item.sync_lock_id IS DISTINCT FROM lock_token THEN
    RETURN jsonb_build_object('status', 'lost_lock');
  END IF;

  IF found_item.transactions_cursor IS DISTINCT FROM expected_cursor THEN
    RETURN jsonb_build_object('status', 'cursor_conflict');
  END IF;

  IF next_cursor IS NULL OR btrim(next_cursor) = '' THEN
    RETURN jsonb_build_object('status', 'rejected');
  END IF;

  IF observations IS NULL OR jsonb_typeof(observations) <> 'array' THEN
    RETURN jsonb_build_object('status', 'rejected');
  END IF;

  IF accounts IS NULL OR jsonb_typeof(accounts) <> 'array' THEN
    RETURN jsonb_build_object('status', 'rejected');
  END IF;

  FOR obs IN
    SELECT value
    FROM jsonb_array_elements(observations)
  LOOP
    txn_id := btrim(obs.value->>'plaid_transaction_id');
    IF txn_id IS NULL OR txn_id = '' THEN
      RAISE EXCEPTION 'plaid_observation_invalid';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.plaid_transactions
      WHERE plaid_transaction_id = txn_id
        AND user_id IS DISTINCT FROM actor_user_id
    ) THEN
      RAISE EXCEPTION 'plaid_transaction_owner_conflict';
    END IF;
  END LOOP;

  IF removed_ids IS NOT NULL AND EXISTS (
    SELECT 1
    FROM unnest(removed_ids) AS gone(transaction_id)
    JOIN public.plaid_transactions AS txn
      ON txn.plaid_transaction_id = gone.transaction_id
    WHERE txn.user_id IS DISTINCT FROM actor_user_id
  ) THEN
    RAISE EXCEPTION 'plaid_transaction_owner_conflict';
  END IF;

  FOR obs IN
    SELECT value
    FROM jsonb_array_elements(observations)
  LOOP
    txn_id := btrim(obs.value->>'plaid_transaction_id');
    account_id_value := btrim(obs.value->>'account_id');
    txn_name := btrim(obs.value->>'name');
    IF account_id_value IS NULL OR account_id_value = '' THEN
      RAISE EXCEPTION 'plaid_observation_invalid';
    END IF;
    IF txn_name IS NULL OR txn_name = '' THEN
      txn_name := '(no name)';
    END IF;

    amt := (obs.value->>'amount')::numeric;
    txn_date := (obs.value->>'date')::date;
    pending_flag := (obs.value->>'pending')::boolean;
    IF pending_flag IS NULL THEN
      RAISE EXCEPTION 'plaid_observation_invalid';
    END IF;

    UPDATE public.plaid_transactions
    SET
      pending_transaction_id = nullif(btrim(obs.value->>'pending_transaction_id'), ''),
      account_id = account_id_value,
      amount = amt,
      name = txn_name,
      category = nullif(btrim(obs.value->>'category'), ''),
      date = txn_date,
      pending = pending_flag,
      removed_at = NULL
    WHERE plaid_transaction_id = txn_id
      AND user_id = actor_user_id;

    IF NOT FOUND THEN
      BEGIN
        INSERT INTO public.plaid_transactions (
          user_id,
          plaid_transaction_id,
          pending_transaction_id,
          account_id,
          amount,
          name,
          category,
          date,
          pending
        )
        VALUES (
          actor_user_id,
          txn_id,
          nullif(btrim(obs.value->>'pending_transaction_id'), ''),
          account_id_value,
          amt,
          txn_name,
          nullif(btrim(obs.value->>'category'), ''),
          txn_date,
          pending_flag
        );
      EXCEPTION
        WHEN unique_violation THEN
          UPDATE public.plaid_transactions
          SET
            pending_transaction_id = nullif(btrim(obs.value->>'pending_transaction_id'), ''),
            account_id = account_id_value,
            amount = amt,
            name = txn_name,
            category = nullif(btrim(obs.value->>'category'), ''),
            date = txn_date,
            pending = pending_flag,
            removed_at = NULL
          WHERE plaid_transaction_id = txn_id
            AND user_id = actor_user_id;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'plaid_transaction_owner_conflict';
          END IF;
      END;
    END IF;
  END LOOP;

  IF removed_ids IS NOT NULL THEN
    UPDATE public.plaid_transactions
    SET removed_at = now()
    WHERE user_id = actor_user_id
      AND plaid_transaction_id = ANY (removed_ids)
      AND removed_at IS NULL;
  END IF;

  FOR obs IN
    SELECT value
    FROM jsonb_array_elements(accounts)
  LOOP
    IF jsonb_typeof(obs.value->'plaid_account_id') IS DISTINCT FROM 'string' THEN
      CONTINUE;
    END IF;
    acct_id := nullif(btrim(obs.value->>'plaid_account_id'), '');
    IF acct_id IS NULL THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.plaid_accounts
      WHERE plaid_account_id = acct_id
        AND user_id IS DISTINCT FROM actor_user_id
    ) THEN
      RAISE EXCEPTION 'plaid_account_owner_conflict';
    END IF;

    INSERT INTO public.plaid_accounts (
      user_id,
      plaid_item_id,
      plaid_account_id,
      name,
      mask,
      account_type,
      subtype
    )
    VALUES (
      actor_user_id,
      target_item_id,
      acct_id,
      CASE
        WHEN jsonb_typeof(obs.value->'name') = 'string'
          THEN nullif(btrim(obs.value->>'name'), '')
        ELSE NULL
      END,
      CASE
        WHEN jsonb_typeof(obs.value->'mask') = 'string'
          THEN nullif(btrim(obs.value->>'mask'), '')
        ELSE NULL
      END,
      CASE
        WHEN jsonb_typeof(obs.value->'account_type') = 'string'
          THEN nullif(btrim(obs.value->>'account_type'), '')
        ELSE NULL
      END,
      CASE
        WHEN jsonb_typeof(obs.value->'subtype') = 'string'
          THEN nullif(btrim(obs.value->>'subtype'), '')
        ELSE NULL
      END
    )
    ON CONFLICT (user_id, plaid_account_id) DO UPDATE
    SET
      plaid_item_id = EXCLUDED.plaid_item_id,
      name = EXCLUDED.name,
      mask = EXCLUDED.mask,
      account_type = EXCLUDED.account_type,
      subtype = EXCLUDED.subtype,
      updated_at = now();
  END LOOP;

  UPDATE public.plaid_items
  SET
    transactions_cursor = next_cursor,
    sync_locked_at = now()
  WHERE id = target_item_id
    AND user_id = actor_user_id
    AND sync_lock_id = lock_token
    AND transactions_cursor IS NOT DISTINCT FROM expected_cursor;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'plaid_cursor_lost';
  END IF;

  RETURN jsonb_build_object('status', 'applied');
END;
$$;

REVOKE ALL ON FUNCTION public.apply_plaid_sync_page(uuid, uuid, uuid, text, text, jsonb, text[], jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_plaid_sync_page(uuid, uuid, uuid, text, text, jsonb, text[], jsonb)
  TO service_role;
