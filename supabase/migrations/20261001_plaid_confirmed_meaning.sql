-- =============================================================================
-- Wealth Engine — steward-confirmed meaning of one Plaid observation
-- Migration: 20261001_plaid_confirmed_meaning.sql
--
-- Repository source only. Do not apply this file with supabase db push.
-- One owner-scoped fact: a current posted observation corresponded to one
-- existing budget category. It is not vault_data, not an expense, and not a
-- classification of any later observation.
-- =============================================================================

CREATE TABLE public.plaid_observation_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  plaid_transaction_id text NOT NULL,
  budget_target_id text NOT NULL,
  category_name text NOT NULL,
  signed_cents integer NOT NULL,
  posted_date date NOT NULL,
  transaction_name text NOT NULL,
  category_text text,
  account_id text NOT NULL,
  pending boolean NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  state text NOT NULL,
  CONSTRAINT plaid_observation_confirmations_pending_false
    CHECK (pending = false),
  CONSTRAINT plaid_observation_confirmations_state
    CHECK (state IN ('current', 'superseded', 'revoked')),
  CONSTRAINT plaid_observation_confirmations_names
    CHECK (
      char_length(btrim(plaid_transaction_id)) > 0
      AND char_length(btrim(budget_target_id)) > 0
      AND char_length(btrim(category_name)) > 0
      AND char_length(btrim(transaction_name)) > 0
      AND char_length(btrim(account_id)) > 0
    )
);

COMMENT ON TABLE public.plaid_observation_confirmations IS
  'Steward confirmation that one Plaid observation corresponded to one budget category. Historical rows stay. This does not create an expense, change a cap, or classify another observation.';

COMMENT ON COLUMN public.plaid_observation_confirmations.category_name IS
  'Budget category name as stored in the vault at confirmation. Later renames do not rewrite it.';

COMMENT ON COLUMN public.plaid_observation_confirmations.signed_cents IS
  'Plaid amount at confirmation, in integer cents. Positive is money out of that account.';

COMMENT ON COLUMN public.plaid_observation_confirmations.state IS
  'current, superseded, or revoked. At most one current row per owner and observation.';

CREATE UNIQUE INDEX plaid_observation_confirmations_one_current
  ON public.plaid_observation_confirmations (user_id, plaid_transaction_id)
  WHERE state = 'current';

CREATE INDEX plaid_observation_confirmations_owner
  ON public.plaid_observation_confirmations (user_id, confirmed_at DESC);

ALTER TABLE public.plaid_observation_confirmations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.plaid_observation_confirmations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.plaid_observation_confirmations TO authenticated;

CREATE POLICY plaid_observation_confirmations_select_own
  ON public.plaid_observation_confirmations
  FOR SELECT
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Confirm or supersede. Owner comes from auth.uid(). Evidence comes from the
-- stored observation. The category name comes from the owner's vault.
-- A same-category repeat does not rewrite the existing snapshot.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_plaid_observation(
  target_plaid_transaction_id text,
  target_budget_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  obs public.plaid_transactions%ROWTYPE;
  category_label text;
  existing public.plaid_observation_confirmations%ROWTYPE;
  inserted public.plaid_observation_confirmations%ROWTYPE;
  outcome text;
BEGIN
  IF actor IS NULL THEN
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'unauthenticated');
  END IF;

  IF target_plaid_transaction_id IS NULL
    OR btrim(target_plaid_transaction_id) = ''
    OR target_budget_id IS NULL
    OR btrim(target_budget_id) = '' THEN
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'invalid');
  END IF;

  SELECT * INTO obs
  FROM public.plaid_transactions
  WHERE user_id = actor
    AND plaid_transaction_id = btrim(target_plaid_transaction_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'not_found');
  END IF;

  IF obs.pending OR obs.removed_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'not_teachable');
  END IF;

  SELECT btrim(elem->>'categoryName') INTO category_label
  FROM public.wealth_engine_vaults AS vault
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(vault.vault_data->'budgetTargets') = 'array'
      THEN vault.vault_data->'budgetTargets'
      ELSE '[]'::jsonb
    END
  ) AS elem
  WHERE vault.user_id = actor
    AND jsonb_typeof(elem) = 'object'
    AND elem->>'id' = btrim(target_budget_id)
  LIMIT 1;

  IF category_label IS NULL OR category_label = '' THEN
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'unknown_category');
  END IF;

  SELECT * INTO existing
  FROM public.plaid_observation_confirmations
  WHERE user_id = actor
    AND plaid_transaction_id = obs.plaid_transaction_id
    AND state = 'current'
  FOR UPDATE;

  IF FOUND AND existing.budget_target_id = btrim(target_budget_id) THEN
    RETURN jsonb_build_object('status', 'unchanged', 'id', existing.id);
  END IF;

  outcome := 'confirmed';
  IF FOUND THEN
    UPDATE public.plaid_observation_confirmations
    SET state = 'superseded'
    WHERE id = existing.id
      AND user_id = actor
      AND state = 'current';
    outcome := 'superseded';
  END IF;

  INSERT INTO public.plaid_observation_confirmations (
    user_id,
    plaid_transaction_id,
    budget_target_id,
    category_name,
    signed_cents,
    posted_date,
    transaction_name,
    category_text,
    account_id,
    pending,
    state
  )
  VALUES (
    actor,
    obs.plaid_transaction_id,
    btrim(target_budget_id),
    category_label,
    ROUND(obs.amount * 100)::integer,
    obs.date,
    obs.name,
    NULLIF(btrim(obs.category), ''),
    obs.account_id,
    false,
    'current'
  )
  RETURNING * INTO inserted;

  RETURN jsonb_build_object(
    'status', outcome,
    'id', inserted.id,
    'confirmed_at', inserted.confirmed_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_plaid_observation(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_plaid_observation(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Revoke the current confirmation. The evidence snapshot stays.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_plaid_observation_confirmation(
  target_plaid_transaction_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  revoked_id uuid;
BEGIN
  IF actor IS NULL THEN
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'unauthenticated');
  END IF;

  IF target_plaid_transaction_id IS NULL OR btrim(target_plaid_transaction_id) = '' THEN
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'invalid');
  END IF;

  UPDATE public.plaid_observation_confirmations
  SET state = 'revoked'
  WHERE user_id = actor
    AND plaid_transaction_id = btrim(target_plaid_transaction_id)
    AND state = 'current'
  RETURNING id INTO revoked_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'absent');
  END IF;

  RETURN jsonb_build_object('status', 'revoked', 'id', revoked_id);
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_plaid_observation_confirmation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_plaid_observation_confirmation(text) TO authenticated;
