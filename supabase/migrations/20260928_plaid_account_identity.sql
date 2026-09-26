-- WE-ATTENTION-003D: Item account identity when /transactions/sync
-- returns an empty accounts array.
-- This does not move transactions_cursor, take the sync lock, or write
-- plaid_transactions. It is not a Wealth Engine FinancialAccount and stores
-- no balances. Written here; not applied from the app.

CREATE FUNCTION public.upsert_plaid_account_identity(
  actor_user_id uuid,
  target_item_id uuid,
  accounts jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  found_item public.plaid_items%ROWTYPE;
  obs record;
  acct_id text;
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  SELECT *
  INTO found_item
  FROM public.plaid_items
  WHERE id = target_item_id;

  IF NOT FOUND OR found_item.user_id IS DISTINCT FROM actor_user_id THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF accounts IS NULL OR jsonb_typeof(accounts) <> 'array' THEN
    RETURN jsonb_build_object('status', 'rejected');
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

  RETURN jsonb_build_object('status', 'applied');
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_plaid_account_identity(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_plaid_account_identity(uuid, uuid, jsonb)
  TO service_role;
