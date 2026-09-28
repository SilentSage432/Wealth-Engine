-- =============================================================================
-- Wealth Engine — one schema-5 cloud vault becomes schema 6
-- Migration: 20261003_wealth_engine_vault_schema_5_to_6.sql
--
-- Repository source only. Do not apply this file with supabase db push.
-- Do not run this file from the application. Canonical production application
-- is a later manual step on Wealth_Engine (nklmgzxxdhuvqayhcigp) after the
-- object is confirmed absent. This file does not target a project.
--
-- The only change is vault_data.monthlyPlans = [] and schema_version 5 → 6.
-- No other financial field is rewritten. cas_update_wealth_engine_vault is
-- unchanged, so a schema-5 client still cannot write a schema-6 row.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.upgrade_wealth_engine_vault_schema_5(
  expected_revision integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated public.wealth_engine_vaults%ROWTYPE;
  current_row public.wealth_engine_vaults%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'unauthenticated');
  END IF;

  IF expected_revision IS NULL OR expected_revision < 1 THEN
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'invalid_revision');
  END IF;

  UPDATE public.wealth_engine_vaults
  SET
    vault_data = vault_data || jsonb_build_object('monthlyPlans', jsonb_build_array()),
    schema_version = 6,
    revision = revision + 1
  WHERE user_id = auth.uid()
    AND revision = expected_revision
    AND schema_version = 5
    AND jsonb_typeof(vault_data) = 'object'
    AND NOT (vault_data ? 'monthlyPlans')
  RETURNING * INTO updated;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'updated',
      'revision', updated.revision,
      'schema_version', updated.schema_version,
      'updated_at', updated.updated_at
    );
  END IF;

  SELECT * INTO current_row
  FROM public.wealth_engine_vaults
  WHERE user_id = auth.uid();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'absent');
  END IF;

  IF current_row.schema_version = 6 THEN
    RETURN jsonb_build_object(
      'status', 'already_current',
      'revision', current_row.revision,
      'schema_version', current_row.schema_version
    );
  END IF;

  IF current_row.schema_version IS DISTINCT FROM 5 THEN
    RETURN jsonb_build_object(
      'status', 'unsupported_schema',
      'schema_version', current_row.schema_version,
      'revision', current_row.revision
    );
  END IF;

  IF jsonb_typeof(current_row.vault_data) <> 'object'
     OR current_row.vault_data ? 'monthlyPlans' THEN
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'monthly_plans_present');
  END IF;

  RETURN jsonb_build_object(
    'status', 'conflict',
    'stored_revision', current_row.revision,
    'schema_version', current_row.schema_version
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upgrade_wealth_engine_vault_schema_5(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upgrade_wealth_engine_vault_schema_5(integer) TO authenticated;

COMMENT ON FUNCTION public.upgrade_wealth_engine_vault_schema_5(integer) IS
  'Owner-scoped compare-and-swap from schema 5 to schema 6. Adds monthlyPlans as an empty array and advances revision by one. Does not accept a replacement document.';
