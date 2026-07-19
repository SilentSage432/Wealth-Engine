-- =============================================================================
-- Wealth Engine — Phase 3 Path A: Babylon relational core
-- Migration: 20260719_init_babylon_schema.sql
--
-- Establishes enums, steward tables, cascading FKs, RLS, and query indexes
-- aligned to the cloud-bound ledger model (see types/babylon.ts ownership).
-- Safe to run once on a fresh Supabase project.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- 2. Enums (frontend system bounds)
-- ---------------------------------------------------------------------------
CREATE TYPE public.income_stream_kind AS ENUM (
  'primary',
  'side_hustle',
  'passive',
  'other'
);

CREATE TYPE public.income_interval AS ENUM (
  'one_time',
  'weekly',
  'bi_weekly',
  'semi_monthly',
  'monthly',
  'annually'
);

CREATE TYPE public.budget_category_group AS ENUM (
  'essential',
  'discretionary'
);

-- ---------------------------------------------------------------------------
-- 3. Tables & relationships
-- ---------------------------------------------------------------------------

-- Steward identity (1:1 with auth.users)
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  username text NOT NULL DEFAULT 'Steward',
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.profiles IS
  'Steward display profile; id mirrors auth.users.';

-- Planned caps for Necessary Expenditures (70%) buckets, scoped by month
CREATE TABLE public.budget_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name text NOT NULL,
  cap numeric NOT NULL CHECK (cap >= 0),
  group_kind public.budget_category_group NOT NULL,
  month_key text NOT NULL,
  CONSTRAINT budget_targets_month_key_format
    CHECK (month_key ~ '^\d{4}-\d{2}$')
);

COMMENT ON TABLE public.budget_targets IS
  'Steward-configured budget caps (BudgetTarget) per calendar month_key.';

-- Income ledger rows
CREATE TABLE public.income_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  source text NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 0),
  date date NOT NULL,
  kind public.income_stream_kind NOT NULL DEFAULT 'primary',
  interval public.income_interval NOT NULL DEFAULT 'monthly',
  month_key text NOT NULL,
  CONSTRAINT income_entries_month_key_format
    CHECK (month_key ~ '^\d{4}-\d{2}$')
);

COMMENT ON TABLE public.income_entries IS
  'IncomeEntry rows; allocation shares remain engine-computed, not stored.';

-- Expense ledger rows
CREATE TABLE public.expense_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name text NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 0),
  date date NOT NULL,
  due_date date,
  is_settled boolean NOT NULL DEFAULT false,
  category_id uuid REFERENCES public.budget_targets (id) ON DELETE SET NULL,
  month_key text NOT NULL,
  CONSTRAINT expense_entries_month_key_format
    CHECK (month_key ~ '^\d{4}-\d{2}$')
);

COMMENT ON TABLE public.expense_entries IS
  'ExpenseEntry rows; category_id maps to BudgetTarget (optional / orphanable).';

-- Mutation feed for Recent Activity
CREATE TABLE public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  type text NOT NULL
    CHECK (type IN ('income', 'expense', 'category', 'system')),
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.activity_logs IS
  'Lightweight activity feed (ActivityEvent cloud projection).';

-- ---------------------------------------------------------------------------
-- 4. Performance indexes (dashboard re-render paths)
-- ---------------------------------------------------------------------------
CREATE INDEX idx_budget_targets_user_id
  ON public.budget_targets (user_id);
CREATE INDEX idx_budget_targets_month_key
  ON public.budget_targets (month_key);
CREATE INDEX idx_budget_targets_user_month
  ON public.budget_targets (user_id, month_key);

CREATE INDEX idx_income_entries_user_id
  ON public.income_entries (user_id);
CREATE INDEX idx_income_entries_month_key
  ON public.income_entries (month_key);
CREATE INDEX idx_income_entries_user_month
  ON public.income_entries (user_id, month_key);

CREATE INDEX idx_expense_entries_user_id
  ON public.expense_entries (user_id);
CREATE INDEX idx_expense_entries_month_key
  ON public.expense_entries (month_key);
CREATE INDEX idx_expense_entries_user_month
  ON public.expense_entries (user_id, month_key);
CREATE INDEX idx_expense_entries_category_id
  ON public.expense_entries (category_id);

CREATE INDEX idx_activity_logs_user_id
  ON public.activity_logs (user_id);
CREATE INDEX idx_activity_logs_user_created
  ON public.activity_logs (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 5. Row-Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.income_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- profiles: owner key is id (auth.users mirror), not user_id
CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_delete_own"
  ON public.profiles FOR DELETE
  USING (auth.uid() = id);

-- budget_targets
CREATE POLICY "budget_targets_select_own"
  ON public.budget_targets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "budget_targets_insert_own"
  ON public.budget_targets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "budget_targets_update_own"
  ON public.budget_targets FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "budget_targets_delete_own"
  ON public.budget_targets FOR DELETE
  USING (auth.uid() = user_id);

-- income_entries
CREATE POLICY "income_entries_select_own"
  ON public.income_entries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "income_entries_insert_own"
  ON public.income_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "income_entries_update_own"
  ON public.income_entries FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "income_entries_delete_own"
  ON public.income_entries FOR DELETE
  USING (auth.uid() = user_id);

-- expense_entries
CREATE POLICY "expense_entries_select_own"
  ON public.expense_entries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "expense_entries_insert_own"
  ON public.expense_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "expense_entries_update_own"
  ON public.expense_entries FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "expense_entries_delete_own"
  ON public.expense_entries FOR DELETE
  USING (auth.uid() = user_id);

-- activity_logs
CREATE POLICY "activity_logs_select_own"
  ON public.activity_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "activity_logs_insert_own"
  ON public.activity_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "activity_logs_update_own"
  ON public.activity_logs FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "activity_logs_delete_own"
  ON public.activity_logs FOR DELETE
  USING (auth.uid() = user_id);
