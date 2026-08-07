-- =============================================================================
-- Wealth Engine — Path A entity parity: debts + period archives
-- Migration: 20260807_add_debts_archives_logs.sql
--
-- Adds cloud tables for DebtEntry and PeriodArchive. ActivityEvent already
-- projects to public.activity_logs (20260719_init_babylon_schema.sql).
-- Safe to run after the Path A init migration.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Debts (DebtEntry cloud projection)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.debt_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name text NOT NULL,
  total_balance numeric NOT NULL DEFAULT 0 CHECK (total_balance >= 0),
  minimum_payment numeric NOT NULL DEFAULT 0 CHECK (minimum_payment >= 0),
  interest_rate numeric NOT NULL DEFAULT 0 CHECK (interest_rate >= 0),
  current_balance numeric NOT NULL DEFAULT 0 CHECK (current_balance >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.debt_entries IS
  'DebtEntry rows. Domain maps creditor→name, totalDebt→total_balance, remainingDebt→current_balance, monthlyAllocation→minimum_payment. interest_rate reserved (default 0 until domain owns APR).';

-- ---------------------------------------------------------------------------
-- 2. Period archives (PeriodArchive cloud projection)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.period_archives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  month_key text NOT NULL,
  closed_at timestamptz NOT NULL DEFAULT now(),
  snapshot_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT period_archives_month_key_format
    CHECK (month_key ~ '^\d{4}-\d{2}$')
);

COMMENT ON TABLE public.period_archives IS
  'PeriodArchive rows. snapshot_data holds the full sealed-month payload (income/spend/10-20-70/surplus fields).';

COMMENT ON COLUMN public.period_archives.snapshot_data IS
  'JSONB PeriodArchive body excluding id/user identity; authoritative sealed totals live here.';

-- ---------------------------------------------------------------------------
-- 3. Performance indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_debt_entries_user_id
  ON public.debt_entries (user_id);
CREATE INDEX IF NOT EXISTS idx_debt_entries_user_updated
  ON public.debt_entries (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_period_archives_user_id
  ON public.period_archives (user_id);
CREATE INDEX IF NOT EXISTS idx_period_archives_user_month
  ON public.period_archives (user_id, month_key);
CREATE INDEX IF NOT EXISTS idx_period_archives_user_closed
  ON public.period_archives (user_id, closed_at DESC);

-- ---------------------------------------------------------------------------
-- 4. Row-Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.debt_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.period_archives ENABLE ROW LEVEL SECURITY;

-- debt_entries: owner-scoped CRUD
DROP POLICY IF EXISTS "Users can manage own debts" ON public.debt_entries;
CREATE POLICY "Users can manage own debts"
  ON public.debt_entries
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- period_archives: owner-scoped CRUD
DROP POLICY IF EXISTS "Users can manage own period archives" ON public.period_archives;
CREATE POLICY "Users can manage own period archives"
  ON public.period_archives
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
