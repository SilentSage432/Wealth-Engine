/**
 * Versioned per-user vault primitives.
 * Ownership: the cloud document boundary only. Does not allocate, hydrate,
 * or upload from the application flow.
 *
 * Writes go through Postgres functions. A revision check in the client
 * before a normal update would race. Do not add that pattern here.
 */

import { isUuid } from "@/lib/babylon/cloud-mappers";
import { EXPENSE_SEMANTICS_VERSION, normalizePersistedState } from "@/lib/babylon/persistence";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Json } from "@/lib/supabase/database.types";
import type { PersistedState } from "@/types/babylon";

/**
 * Financial document generation. This is backup version 5.
 * The localStorage key suffix "v2" is not a schema version.
 */
export const CLOUD_VAULT_SCHEMA_VERSION = 5 as const;

export const CLOUD_VAULT_DATA_KEYS = [
  "incomes",
  "expenses",
  "debts",
  "allocations",
  "budgetTargets",
  "accounts",
  "displayName",
  "activityLog",
  "emergencyShield",
  "periodArchives",
  "lastClosedMonthKey",
  "expenseSemanticsVersion",
  "openingWealthBuilding",
  "openingEmergencyFund",
  "recurringObligations",
] as const satisfies readonly (keyof PersistedState)[];

export type CloudVaultData = Pick<
  PersistedState,
  (typeof CLOUD_VAULT_DATA_KEYS)[number]
>;

export type CloudVaultGetResult =
  | {
      status: "absent";
    }
  | {
      status: "present";
      schemaVersion: number;
      revision: number;
      updatedAt: string;
      vaultData: PersistedState;
    }
  | {
      status: "unsupported_schema";
      schemaVersion: number;
      revision: number;
      updatedAt: string;
    }
  | {
      status: "invalid_vault";
      schemaVersion: number;
      revision: number;
      updatedAt: string;
    }
  | { status: "forbidden" }
  | { status: "unauthenticated" }
  | { status: "unconfigured" }
  | { status: "rejected"; reason: string }
  | { status: "error"; message: string };

export type CloudVaultInitializeResult =
  | {
      status: "created";
      schemaVersion: number;
      revision: 1;
      updatedAt: string;
    }
  | {
      status: "already_exists";
      schemaVersion: number;
      revision: number;
      updatedAt: string;
    }
  | { status: "forbidden" }
  | { status: "unauthenticated" }
  | { status: "unconfigured" }
  | { status: "rejected"; reason: string }
  | { status: "error"; message: string };

export type CloudVaultUpdateResult =
  | {
      status: "updated";
      schemaVersion: number;
      revision: number;
      updatedAt: string;
    }
  | {
      status: "conflict";
      storedRevision: number;
      schemaVersion: number;
    }
  | { status: "absent" }
  | {
      status: "unsupported_schema";
      schemaVersion: number;
      revision: number;
    }
  | { status: "forbidden" }
  | { status: "unauthenticated" }
  | { status: "unconfigured" }
  | { status: "rejected"; reason: string }
  | { status: "error"; message: string };

type VaultRow = {
  schemaVersion: number;
  revision: number;
  updatedAt: string;
  vaultData: unknown;
};

export type CloudVaultGateway = {
  sessionUserId(): Promise<string | null>;
  readVault(
    userId: string
  ): Promise<{ ok: true; row: VaultRow | null } | { ok: false; message: string }>;
  initializeVault(
    schemaVersion: number,
    vaultData: CloudVaultData
  ): Promise<{ ok: true; body: unknown } | { ok: false; message: string }>;
  compareAndSwapVault(
    expectedRevision: number,
    schemaVersion: number,
    vaultData: CloudVaultData
  ): Promise<{ ok: true; body: unknown } | { ok: false; message: string }>;
};

/**
 * Specification for the database write. Not a write, and not safe to use
 * as a client-side check before updating. The SQL function is the writer.
 */
export function specifiedVaultInitializeOutcome(input: {
  existing: { revision: number; schemaVersion: number } | null;
  knownSchemaVersion: number;
}):
  | { status: "rejected"; reason: "invalid_schema" }
  | { status: "created"; revision: 1; schemaVersion: number }
  | { status: "already_exists"; revision: number; schemaVersion: number } {
  if (
    !Number.isInteger(input.knownSchemaVersion) ||
    input.knownSchemaVersion < 1
  ) {
    return { status: "rejected", reason: "invalid_schema" };
  }
  if (!input.existing) {
    return {
      status: "created",
      revision: 1,
      schemaVersion: input.knownSchemaVersion,
    };
  }
  return {
    status: "already_exists",
    revision: input.existing.revision,
    schemaVersion: input.existing.schemaVersion,
  };
}

/**
 * Specification for one atomic revision write. A conflict result does not
 * describe a changed row. The database applies the same rule in one UPDATE.
 */
export function specifiedVaultWriteOutcome(input: {
  stored: { revision: number; schemaVersion: number } | null;
  expectedRevision: number;
  knownSchemaVersion: number;
}):
  | { status: "rejected"; reason: "invalid_revision" | "invalid_schema" }
  | { status: "absent" }
  | { status: "unsupported_schema"; schemaVersion: number; revision: number }
  | { status: "conflict"; storedRevision: number; schemaVersion: number }
  | { status: "updated"; revision: number; schemaVersion: number } {
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
    return { status: "rejected", reason: "invalid_revision" };
  }
  if (
    !Number.isInteger(input.knownSchemaVersion) ||
    input.knownSchemaVersion < 1
  ) {
    return { status: "rejected", reason: "invalid_schema" };
  }
  if (!input.stored) return { status: "absent" };
  if (input.stored.schemaVersion !== input.knownSchemaVersion) {
    return {
      status: "unsupported_schema",
      schemaVersion: input.stored.schemaVersion,
      revision: input.stored.revision,
    };
  }
  if (input.stored.revision !== input.expectedRevision) {
    return {
      status: "conflict",
      storedRevision: input.stored.revision,
      schemaVersion: input.stored.schemaVersion,
    };
  }
  return {
    status: "updated",
    revision: input.expectedRevision + 1,
    schemaVersion: input.knownSchemaVersion,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isRecord(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortKeys(value[key]);
  }
  return sorted;
}

/** Financial PersistedState only. Extra fields on the input are not copied. */
export function serializeCloudVaultData(state: PersistedState): CloudVaultData {
  return {
    incomes: state.incomes,
    expenses: state.expenses,
    debts: state.debts,
    allocations: state.allocations,
    budgetTargets: state.budgetTargets,
    accounts: state.accounts,
    displayName: state.displayName,
    activityLog: state.activityLog,
    emergencyShield: state.emergencyShield,
    periodArchives: state.periodArchives,
    lastClosedMonthKey: state.lastClosedMonthKey,
    expenseSemanticsVersion: state.expenseSemanticsVersion,
    openingWealthBuilding: state.openingWealthBuilding,
    openingEmergencyFund: state.openingEmergencyFund,
    recurringObligations: state.recurringObligations,
  };
}

/**
 * Accept a schema-5 document only when normalization would not change it.
 * A failure is null. It is not an empty vault.
 */
export function parseCloudVaultData(raw: unknown): PersistedState | null {
  if (!isRecord(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length !== CLOUD_VAULT_DATA_KEYS.length) return null;
  for (const key of CLOUD_VAULT_DATA_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) return null;
  }
  if (raw.expenseSemanticsVersion !== EXPENSE_SEMANTICS_VERSION) return null;

  const normalized = normalizePersistedState(raw);
  for (const key of CLOUD_VAULT_DATA_KEYS) {
    if (canonicalJson(raw[key]) !== canonicalJson(normalized[key])) return null;
  }
  return normalized;
}

function browserGateway(): CloudVaultGateway | null {
  const client = getSupabaseBrowserClient();
  if (!client) return null;

  return {
    async sessionUserId() {
      const { data } = await client.auth.getSession();
      return data.session?.user.id ?? null;
    },
    async readVault(userId) {
      const { data, error } = await client
        .from("wealth_engine_vaults")
        .select("schema_version, vault_data, revision, updated_at")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) return { ok: false, message: error.message };
      if (!data) return { ok: true, row: null };
      return {
        ok: true,
        row: {
          schemaVersion: data.schema_version,
          revision: data.revision,
          updatedAt: data.updated_at,
          vaultData: data.vault_data,
        },
      };
    },
    async initializeVault(schemaVersion, vaultData) {
      const { data, error } = await client.rpc("initialize_wealth_engine_vault", {
        known_schema_version: schemaVersion,
        next_vault_data: vaultData as unknown as Json,
      });
      if (error) return { ok: false, message: error.message };
      return { ok: true, body: data };
    },
    async compareAndSwapVault(expectedRevision, schemaVersion, vaultData) {
      const { data, error } = await client.rpc("cas_update_wealth_engine_vault", {
        expected_revision: expectedRevision,
        known_schema_version: schemaVersion,
        next_vault_data: vaultData as unknown as Json,
      });
      if (error) return { ok: false, message: error.message };
      return { ok: true, body: data };
    },
  };
}

async function requireOwner(
  gateway: CloudVaultGateway,
  userId: string
): Promise<
  | { ok: true }
  | {
      ok: false;
      status:
        | { status: "forbidden" }
        | { status: "unauthenticated" }
        | { status: "rejected"; reason: string };
    }
> {
  if (!isUuid(userId)) {
    return { ok: false, status: { status: "rejected", reason: "invalid_user" } };
  }
  const sessionUserId = await gateway.sessionUserId();
  if (!sessionUserId) {
    return { ok: false, status: { status: "unauthenticated" } };
  }
  if (sessionUserId !== userId) {
    return { ok: false, status: { status: "forbidden" } };
  }
  return { ok: true };
}

function rejectForeignSchema(schemaVersion: number): { status: "rejected"; reason: string } | null {
  if (schemaVersion !== CLOUD_VAULT_SCHEMA_VERSION) {
    return { status: "rejected", reason: "unsupported_schema" };
  }
  return null;
}

function readPositiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function readTimestamp(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export async function getCloudVault(
  userId: string,
  gateway: CloudVaultGateway | null = browserGateway()
): Promise<CloudVaultGetResult> {
  if (!gateway) return { status: "unconfigured" };
  const owner = await requireOwner(gateway, userId);
  if (!owner.ok) return owner.status;

  const read = await gateway.readVault(userId);
  if (!read.ok) return { status: "error", message: read.message };
  if (!read.row) return { status: "absent" };

  const { schemaVersion, revision, updatedAt, vaultData } = read.row;
  if (!readPositiveInt(schemaVersion) || !readPositiveInt(revision) || !updatedAt) {
    return { status: "error", message: "Cloud vault row is incomplete." };
  }
  if (schemaVersion !== CLOUD_VAULT_SCHEMA_VERSION) {
    return { status: "unsupported_schema", schemaVersion, revision, updatedAt };
  }
  const parsed = parseCloudVaultData(vaultData);
  if (!parsed) {
    return { status: "invalid_vault", schemaVersion, revision, updatedAt };
  }
  return {
    status: "present",
    schemaVersion,
    revision,
    updatedAt,
    vaultData: parsed,
  };
}

export async function initializeCloudVault(
  userId: string,
  schemaVersion: number,
  vaultData: PersistedState,
  gateway: CloudVaultGateway | null = browserGateway()
): Promise<CloudVaultInitializeResult> {
  if (!gateway) return { status: "unconfigured" };
  const schema = rejectForeignSchema(schemaVersion);
  if (schema) return schema;
  const owner = await requireOwner(gateway, userId);
  if (!owner.ok) return owner.status;

  const document = serializeCloudVaultData(vaultData);
  if (!parseCloudVaultData(document)) {
    return { status: "rejected", reason: "invalid_vault" };
  }

  const result = await gateway.initializeVault(schemaVersion, document);
  if (!result.ok) return { status: "error", message: result.message };
  if (!isRecord(result.body)) {
    return { status: "error", message: "Cloud initialization returned an unreadable result." };
  }

  const status = result.body.status;
  const revision = readPositiveInt(result.body.revision);
  const returnedSchema = readPositiveInt(result.body.schema_version);
  const updatedAt = readTimestamp(result.body.updated_at);

  if (status === "created") {
    if (revision !== 1 || returnedSchema !== CLOUD_VAULT_SCHEMA_VERSION || !updatedAt) {
      return { status: "error", message: "Cloud initialization did not create revision 1." };
    }
    return { status: "created", schemaVersion: returnedSchema, revision: 1, updatedAt };
  }

  if (status === "already_exists") {
    if (!revision || !returnedSchema || !updatedAt) {
      return { status: "error", message: "Existing cloud vault could not be described." };
    }
    return {
      status: "already_exists",
      schemaVersion: returnedSchema,
      revision,
      updatedAt,
    };
  }

  if (status === "rejected" && typeof result.body.reason === "string") {
    return { status: "rejected", reason: result.body.reason };
  }

  return { status: "error", message: "Cloud initialization returned an unknown result." };
}

export async function updateCloudVault(
  userId: string,
  expectedRevision: number,
  schemaVersion: number,
  vaultData: PersistedState,
  gateway: CloudVaultGateway | null = browserGateway()
): Promise<CloudVaultUpdateResult> {
  if (!gateway) return { status: "unconfigured" };
  const schema = rejectForeignSchema(schemaVersion);
  if (schema) return schema;
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    return { status: "rejected", reason: "invalid_revision" };
  }
  const owner = await requireOwner(gateway, userId);
  if (!owner.ok) return owner.status;

  const document = serializeCloudVaultData(vaultData);
  if (!parseCloudVaultData(document)) {
    return { status: "rejected", reason: "invalid_vault" };
  }

  const result = await gateway.compareAndSwapVault(
    expectedRevision,
    schemaVersion,
    document
  );
  if (!result.ok) return { status: "error", message: result.message };
  if (!isRecord(result.body)) {
    return { status: "error", message: "Cloud update returned an unreadable result." };
  }

  const status = result.body.status;
  if (status === "updated") {
    const revision = readPositiveInt(result.body.revision);
    const returnedSchema = readPositiveInt(result.body.schema_version);
    const updatedAt = readTimestamp(result.body.updated_at);
    if (
      revision !== expectedRevision + 1 ||
      returnedSchema !== CLOUD_VAULT_SCHEMA_VERSION ||
      !updatedAt
    ) {
      return { status: "error", message: "Cloud revision did not advance by one." };
    }
    return { status: "updated", schemaVersion: returnedSchema, revision, updatedAt };
  }

  if (status === "conflict") {
    const storedRevision = readPositiveInt(result.body.stored_revision);
    const returnedSchema = readPositiveInt(result.body.schema_version);
    if (!storedRevision || !returnedSchema) {
      return { status: "error", message: "Cloud conflict did not include the stored revision." };
    }
    return { status: "conflict", storedRevision, schemaVersion: returnedSchema };
  }

  if (status === "absent") return { status: "absent" };

  if (status === "unsupported_schema") {
    const returnedSchema = readPositiveInt(result.body.schema_version);
    const revision = readPositiveInt(result.body.revision);
    if (!returnedSchema || !revision) {
      return { status: "error", message: "Cloud schema mismatch was incomplete." };
    }
    return { status: "unsupported_schema", schemaVersion: returnedSchema, revision };
  }

  if (status === "rejected" && typeof result.body.reason === "string") {
    return { status: "rejected", reason: result.body.reason };
  }

  return { status: "error", message: "Cloud update returned an unknown result." };
}
