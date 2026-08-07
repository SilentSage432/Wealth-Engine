-- =============================================================================
-- Wealth Engine — Plaid bank sync foundation
-- Migration: 20260808_plaid_tables.sql
--
-- Schema + RLS only. No application sync yet — see lib/babylon/plaid-schema.ts.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.plaid_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  access_token text NOT NULL,
  item_id text NOT NULL,
  institution_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plaid_items_item_id_unique UNIQUE (item_id)
);

COMMENT ON TABLE public.plaid_items IS
  'Plaid Link items. access_token must be treated as a secret (server-side only in production).';

CREATE TABLE IF NOT EXISTS public.plaid_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  plaid_transaction_id text NOT NULL,
  account_id text NOT NULL,
  amount numeric NOT NULL,
  name text NOT NULL,
  category text,
  date date NOT NULL,
  pending boolean NOT NULL DEFAULT false,
  is_processed boolean NOT NULL DEFAULT false,
  CONSTRAINT plaid_transactions_plaid_id_unique UNIQUE (plaid_transaction_id)
);

COMMENT ON TABLE public.plaid_transactions IS
  'Imported Plaid transactions awaiting steward review / is_processed mapping into ledger.';

CREATE INDEX IF NOT EXISTS idx_plaid_items_user_id
  ON public.plaid_items (user_id);

CREATE INDEX IF NOT EXISTS idx_plaid_transactions_user_id
  ON public.plaid_transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_plaid_transactions_user_date
  ON public.plaid_transactions (user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_plaid_transactions_unprocessed
  ON public.plaid_transactions (user_id, is_processed)
  WHERE is_processed = false;

ALTER TABLE public.plaid_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plaid_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own plaid items" ON public.plaid_items;
CREATE POLICY "Users can manage own plaid items"
  ON public.plaid_items
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own plaid transactions" ON public.plaid_transactions;
CREATE POLICY "Users can manage own plaid transactions"
  ON public.plaid_transactions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
