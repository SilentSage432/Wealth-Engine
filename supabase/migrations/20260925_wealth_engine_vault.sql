-- =============================================================================
-- Wealth Engine — WE-SYNC-002 versioned per-user vault
-- Migration: 20260925_wealth_engine_vault.sql
--
-- One planning document per authenticated user. This is not a normalized
-- ledger. Plaid tables are untouched. The browser never uses the service role.
-- Apply deliberately. Do not treat this file as already applied.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. One vault row per auth user
-- ---------------------------------------------------------------------------
CREATE TABLE public.wealth_engine_vaults (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  schema_version integer NOT NULL,
  vault_data jsonb NOT NULL,
  revision integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wealth_engine_vaults_schema_version_positive
    CHECK (schema_version > 0),
  CONSTRAINT wealth_engine_vaults_revision_positive
    CHECK (revision > 0),
  CONSTRAINT wealth_engine_vaults_data_object
    CHECK (jsonb_typeof(vault_data) = 'object')
);

COMMENT ON TABLE public.wealth_engine_vaults IS
  'One Wealth Engine planning document per user. vault_data is PersistedState. It is not Plaid data and it does not store PIN, WebAuthn, or derived totals.';

COMMENT ON COLUMN public.wealth_engine_vaults.revision IS
  'Positive integer. A write advances it by one only when expected_revision still matches.';

-- Direct writes would skip compare-and-swap. Owners read and delete through
-- RLS. Insert and revision updates go through the functions below.
REVOKE ALL ON TABLE public.wealth_engine_vaults FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON TABLE public.wealth_engine_vaults TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_wealth_engine_vault_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER wealth_engine_vaults_set_updated_at
  BEFORE UPDATE ON public.wealth_engine_vaults
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_wealth_engine_vault_updated_at();

REVOKE ALL ON FUNCTION public.touch_wealth_engine_vault_updated_at() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Create-only initialization. A second call does not change the row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.initialize_wealth_engine_vault(
  known_schema_version integer,
  next_vault_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted public.wealth_engine_vaults%ROWTYPE;
  existing public.wealth_engine_vaults%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'unauthenticated');
  END IF;

  IF known_schema_version IS NULL OR known_schema_version < 1 THEN
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'invalid_schema');
  END IF;

  IF next_vault_data IS NULL OR jsonb_typeof(next_vault_data) <> 'object' THEN
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'invalid_vault');
  END IF;

  BEGIN
    INSERT INTO public.wealth_engine_vaults (
      user_id,
      schema_version,
      vault_data,
      revision
    )
    VALUES (
      auth.uid(),
      known_schema_version,
      next_vault_data,
      1
    )
    RETURNING * INTO inserted;

    RETURN jsonb_build_object(
      'status', 'created',
      'revision', inserted.revision,
      'schema_version', inserted.schema_version,
      'updated_at', inserted.updated_at
    );
  EXCEPTION
    WHEN unique_violation THEN
      SELECT * INTO existing
      FROM public.wealth_engine_vaults
      WHERE user_id = auth.uid();

      IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'rejected', 'reason', 'unreadable');
      END IF;

      RETURN jsonb_build_object(
        'status', 'already_exists',
        'revision', existing.revision,
        'schema_version', existing.schema_version,
        'updated_at', existing.updated_at
      );
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.initialize_wealth_engine_vault(integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.initialize_wealth_engine_vault(integer, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Atomic revision compare-and-swap.
-- The WHERE clause is the lock. A stale expected revision updates zero rows,
-- so vault_data, schema_version, and updated_at stay as they were.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cas_update_wealth_engine_vault(
  expected_revision integer,
  known_schema_version integer,
  next_vault_data jsonb
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

  IF known_schema_version IS NULL OR known_schema_version < 1 THEN
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'invalid_schema');
  END IF;

  IF next_vault_data IS NULL OR jsonb_typeof(next_vault_data) <> 'object' THEN
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'invalid_vault');
  END IF;

  UPDATE public.wealth_engine_vaults
  SET
    vault_data = next_vault_data,
    schema_version = known_schema_version,
    revision = revision + 1
  WHERE user_id = auth.uid()
    AND revision = expected_revision
    AND schema_version = known_schema_version
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

  IF current_row.schema_version IS DISTINCT FROM known_schema_version THEN
    RETURN jsonb_build_object(
      'status', 'unsupported_schema',
      'schema_version', current_row.schema_version,
      'revision', current_row.revision
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'conflict',
    'stored_revision', current_row.revision,
    'schema_version', current_row.schema_version
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cas_update_wealth_engine_vault(integer, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cas_update_wealth_engine_vault(integer, integer, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Row-Level Security for the grants that remain
-- ---------------------------------------------------------------------------
ALTER TABLE public.wealth_engine_vaults ENABLE ROW LEVEL SECURITY;

CREATE POLICY wealth_engine_vaults_select_own
  ON public.wealth_engine_vaults
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY wealth_engine_vaults_delete_own
  ON public.wealth_engine_vaults
  FOR DELETE
  USING (auth.uid() = user_id);
