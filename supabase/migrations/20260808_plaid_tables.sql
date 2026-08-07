-- =============================================================================
-- Wealth Engine — Plaid bank sync foundation (hardened)
-- Migration: 20260808_plaid_tables.sql
--
-- Schema + RLS. access_token is never selectable by JWT clients.
-- Live Link + token exchange run only via server routes (service role).
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
  'Plaid Link items. access_token is server-only (service role). JWT clients never SELECT it.';

COMMENT ON COLUMN public.plaid_items.access_token IS
  'Plaid Item access_token — write/read exclusively via service role from app/api/plaid/*.';

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

-- ---------------------------------------------------------------------------
-- Privilege isolation: JWT roles cannot touch access_token or insert items
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.plaid_items FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, user_id, item_id, institution_name, created_at)
  ON TABLE public.plaid_items TO authenticated;
GRANT DELETE ON TABLE public.plaid_items TO authenticated;
-- INSERT / UPDATE / SELECT(access_token) remain service_role only (bypasses RLS)

REVOKE ALL ON TABLE public.plaid_transactions FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE (is_processed) ON TABLE public.plaid_transactions TO authenticated;
-- INSERT / DELETE of synced rows remain service_role only

-- ---------------------------------------------------------------------------
-- RLS: every allowed operation still scoped to auth.uid() = user_id
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can manage own plaid items" ON public.plaid_items;
DROP POLICY IF EXISTS "Users can select own plaid item metadata" ON public.plaid_items;
DROP POLICY IF EXISTS "Users can delete own plaid items" ON public.plaid_items;

CREATE POLICY "Users can select own plaid item metadata"
  ON public.plaid_items
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own plaid items"
  ON public.plaid_items
  FOR DELETE
  USING (auth.uid() = user_id);

-- No INSERT / UPDATE policies on plaid_items for authenticated —
-- token exchange inserts exclusively via service role.

DROP POLICY IF EXISTS "Users can manage own plaid transactions" ON public.plaid_transactions;
DROP POLICY IF EXISTS "Users can select own plaid transactions" ON public.plaid_transactions;
DROP POLICY IF EXISTS "Users can update own plaid transactions" ON public.plaid_transactions;

CREATE POLICY "Users can select own plaid transactions"
  ON public.plaid_transactions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own plaid transactions"
  ON public.plaid_transactions
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- No INSERT / DELETE policies on plaid_transactions for authenticated —
-- sync writes exclusively via service role.
