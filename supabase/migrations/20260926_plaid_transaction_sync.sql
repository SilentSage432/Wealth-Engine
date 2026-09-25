-- =============================================================================
-- Wealth Engine — Plaid observational transaction sync
-- Migration: 20260926_plaid_transaction_sync.sql
--
-- Extends plaid_items / plaid_transactions only. Does not touch
-- wealth_engine_vaults. Apply deliberately. Do not treat this file as
-- already applied.
--
-- Access tokens stay plaintext. Service role only. This migration does not
-- add application encryption.
--
-- Cursor semantics live in claim_plaid_transaction_sync,
-- apply_plaid_sync_page, and release_plaid_transaction_sync. They match
-- lib/babylon/plaid-transaction-sync.ts. A page's cursor advances in the
-- same transaction as its observation writes.
-- =============================================================================

ALTER TABLE public.plaid_items
  ADD COLUMN IF NOT EXISTS transactions_cursor text,
  ADD COLUMN IF NOT EXISTS sync_lock_id uuid,
  ADD COLUMN IF NOT EXISTS sync_locked_at timestamptz;

COMMENT ON COLUMN public.plaid_items.access_token IS
  'Plaid Item access_token stored as plaintext. Service role only. Not application-encrypted. Never granted to authenticated.';

COMMENT ON COLUMN public.plaid_items.transactions_cursor IS
  'Last Plaid /transactions/sync cursor whose page was stored. Null means no page has been stored. Server-only.';

COMMENT ON COLUMN public.plaid_items.sync_lock_id IS
  'Holder of the in-flight transaction sync. Server-only. A stale lock can be replaced.';

COMMENT ON COLUMN public.plaid_items.sync_locked_at IS
  'When sync_lock_id was last claimed or refreshed. Server-only.';

ALTER TABLE public.plaid_transactions
  ADD COLUMN IF NOT EXISTS pending_transaction_id text,
  ADD COLUMN IF NOT EXISTS removed_at timestamptz;

COMMENT ON TABLE public.plaid_transactions IS
  'Plaid transaction observations. Not Wealth Engine income, expenses, or vault_data.';

COMMENT ON COLUMN public.plaid_transactions.amount IS
  'Plaid amount. Positive is money out. Negative is money in. Not an income or expense amount.';

COMMENT ON COLUMN public.plaid_transactions.pending_transaction_id IS
  'Plaid pending_transaction_id when this posted observation names the pending id it replaced.';

COMMENT ON COLUMN public.plaid_transactions.removed_at IS
  'Set when Plaid lists this transaction id in removed. Null means the observation is current.';

-- New item columns stay off the authenticated column grant.
-- plaid_transactions SELECT is table-level, so the new columns are readable
-- by the owner. UPDATE remains limited to is_processed.

-- ---------------------------------------------------------------------------
-- Claim the sync lock. Returns the access token only to service_role.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_plaid_transaction_sync(
  actor_user_id uuid,
  target_item_id uuid,
  lock_token uuid,
  stale_before timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  claimed public.plaid_items%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  UPDATE public.plaid_items
  SET
    sync_lock_id = lock_token,
    sync_locked_at = now()
  WHERE id = target_item_id
    AND user_id = actor_user_id
    AND (
      sync_lock_id IS NULL
      OR sync_locked_at IS NULL
      OR sync_locked_at < stale_before
    )
  RETURNING * INTO claimed;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'claimed',
      'cursor', claimed.transactions_cursor,
      'access_token', claimed.access_token,
      'plaid_item_id', claimed.item_id
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.plaid_items
    WHERE id = target_item_id
      AND user_id = actor_user_id
  ) THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  RETURN jsonb_build_object('status', 'busy');
END;
$$;

-- ---------------------------------------------------------------------------
-- Store one sync page and advance the cursor, or change nothing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_plaid_sync_page(
  actor_user_id uuid,
  target_item_id uuid,
  lock_token uuid,
  expected_cursor text,
  next_cursor text,
  observations jsonb,
  removed_ids text[]
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

CREATE OR REPLACE FUNCTION public.release_plaid_transaction_sync(
  actor_user_id uuid,
  target_item_id uuid,
  lock_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  UPDATE public.plaid_items
  SET
    sync_lock_id = NULL,
    sync_locked_at = NULL
  WHERE id = target_item_id
    AND user_id = actor_user_id
    AND sync_lock_id = lock_token;

  RETURN jsonb_build_object('status', 'released');
END;
$$;

REVOKE ALL ON FUNCTION public.claim_plaid_transaction_sync(uuid, uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_plaid_sync_page(uuid, uuid, uuid, text, text, jsonb, text[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_plaid_transaction_sync(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_plaid_transaction_sync(uuid, uuid, uuid, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_plaid_sync_page(uuid, uuid, uuid, text, text, jsonb, text[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.release_plaid_transaction_sync(uuid, uuid, uuid)
  TO service_role;
