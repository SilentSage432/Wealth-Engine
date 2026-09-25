/**
 * Decides how an exchanged Plaid Item may be stored.
 * An existing Item is never moved to a different Wealth Engine user.
 */

import type { PlaidItemPublic } from "@/lib/babylon/plaid-schema";

export type PlaidItemPersistPlan = "insert" | "update" | "reject";

export function planPlaidItemPersist(
  existingUserId: string | null,
  actorUserId: string
): PlaidItemPersistPlan {
  if (existingUserId === null) return "insert";
  if (existingUserId === actorUserId) return "update";
  return "reject";
}

export type PlaidItemWriteGateway = {
  findByPlaidItemId(
    plaidItemId: string
  ): Promise<{ id: string; userId: string } | null>;
  updateOwnedItem(
    rowId: string,
    actorUserId: string,
    accessToken: string,
    institutionName: string
  ): Promise<PlaidItemPublic | null>;
  insertItem(input: {
    actorUserId: string;
    plaidItemId: string;
    accessToken: string;
    institutionName: string;
  }): Promise<
    | { ok: true; item: PlaidItemPublic }
    | { ok: false; conflict: boolean }
  >;
};

export type PersistPlaidItemResult =
  | { status: "saved"; item: PlaidItemPublic }
  | { status: "owned_elsewhere" }
  | { status: "failed" };

export async function persistExchangedPlaidItem(
  gateway: PlaidItemWriteGateway,
  input: {
    actorUserId: string;
    plaidItemId: string;
    accessToken: string;
    institutionName: string;
  }
): Promise<PersistPlaidItemResult> {
  const existing = await gateway.findByPlaidItemId(input.plaidItemId);
  return writePlannedItem(gateway, input, existing);
}

async function writePlannedItem(
  gateway: PlaidItemWriteGateway,
  input: {
    actorUserId: string;
    plaidItemId: string;
    accessToken: string;
    institutionName: string;
  },
  existing: { id: string; userId: string } | null
): Promise<PersistPlaidItemResult> {
  const plan = planPlaidItemPersist(existing?.userId ?? null, input.actorUserId);
  if (plan === "reject") return { status: "owned_elsewhere" };

  if (plan === "update") {
    if (!existing) return { status: "failed" };
    const item = await gateway.updateOwnedItem(
      existing.id,
      input.actorUserId,
      input.accessToken,
      input.institutionName
    );
    return item ? { status: "saved", item } : { status: "failed" };
  }

  const inserted = await gateway.insertItem(input);
  if (inserted.ok) return { status: "saved", item: inserted.item };
  if (!inserted.conflict) return { status: "failed" };

  const raced = await gateway.findByPlaidItemId(input.plaidItemId);
  if (!raced) return { status: "failed" };
  if (planPlaidItemPersist(raced.userId, input.actorUserId) === "reject") {
    return { status: "owned_elsewhere" };
  }
  const item = await gateway.updateOwnedItem(
    raced.id,
    input.actorUserId,
    input.accessToken,
    input.institutionName
  );
  return item ? { status: "saved", item } : { status: "failed" };
}
