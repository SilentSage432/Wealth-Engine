import "server-only";

import {
  CLOUD_VAULT_SCHEMA_VERSION,
  parseCloudVaultData,
} from "@/lib/babylon/cloud-vault";
import {
  civilDateInTimeZone,
  decideAttentionDelivery,
  deliveryRetentionCutoff,
  type AttentionDeliveryDecision,
  type SenderConfig,
} from "@/lib/babylon/notification-delivery";
import { sendGenericPush } from "@/lib/babylon/notification-sender";
import type { BabylonServerSupabase } from "@/lib/supabase/server";

function logOperational(action: string, code?: string): void {
  console.error(`[notifications] ${action}`, code ?? "skipped");
}

export interface EvaluationSummary {
  stewards: number;
  sent: number;
}

export async function runDailyEvaluation(
  client: BabylonServerSupabase,
  config: SenderConfig,
  now: Date
): Promise<EvaluationSummary> {
  const preferences = await client
    .from("notification_preferences")
    .select("user_id, enabled, iana_timezone")
    .eq("enabled", true);
  if (preferences.error || !preferences.data) {
    logOperational("list preferences", preferences.error?.code);
    return { stewards: 0, sent: 0 };
  }

  let sent = 0;
  for (const preference of preferences.data) {
    if (preference.enabled !== true) continue;
    const outcome = await evaluateOneSteward(
      client,
      config,
      preference.user_id,
      preference.iana_timezone,
      now
    );
    if (outcome === "sent") sent += 1;
  }
  return { stewards: preferences.data.length, sent };
}

async function evaluateOneSteward(
  client: BabylonServerSupabase,
  config: SenderConfig,
  userId: string,
  timeZone: string,
  now: Date
): Promise<"sent" | "skipped"> {
  const vault = await client
    .from("wealth_engine_vaults")
    .select("schema_version, vault_data")
    .eq("user_id", userId)
    .maybeSingle();
  if (vault.error || !vault.data) {
    logOperational("read vault", vault.error?.code);
    return "skipped";
  }
  if (vault.data.schema_version !== CLOUD_VAULT_SCHEMA_VERSION) {
    logOperational("read vault", "schema");
    return "skipped";
  }
  const state = parseCloudVaultData(vault.data.vault_data);
  if (!state) {
    logOperational("read vault", "parse");
    return "skipped";
  }

  const civilDate = civilDateInTimeZone(now, timeZone);
  if (!civilDate) {
    logOperational("civil date");
    return "skipped";
  }

  const cutoff = deliveryRetentionCutoff(civilDate);
  if (cutoff) {
    const removed = await client
      .from("notification_deliveries")
      .delete()
      .eq("user_id", userId)
      .lt("civil_date", cutoff);
    if (removed.error) logOperational("retain deliveries", removed.error.code);
  }

  const prior = await client
    .from("notification_deliveries")
    .select("attention_key")
    .eq("user_id", userId)
    .eq("civil_date", civilDate)
    .eq("status", "succeeded");
  if (prior.error || !prior.data) {
    logOperational("read deliveries", prior.error?.code);
    return "skipped";
  }

  const subscriptions = await client
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (subscriptions.error || !subscriptions.data) {
    logOperational("read subscriptions", subscriptions.error?.code);
    return "skipped";
  }

  const decision = await decideAttentionDelivery({
    now,
    timeZone,
    state,
    succeededToday: new Set(prior.data.map((row) => row.attention_key)),
    endpoints: subscriptions.data.map((row) => ({ id: row.id })),
    send: async (endpointId) => {
      const row = subscriptions.data.find((item) => item.id === endpointId);
      if (!row) return { ok: false, permanent: false };
      return sendGenericPush(
        { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
        config
      );
    },
  });

  for (const endpointId of decision.removeEndpointIds) {
    const removed = await client
      .from("push_subscriptions")
      .delete()
      .eq("id", endpointId)
      .eq("user_id", userId);
    if (removed.error) logOperational("remove subscription", removed.error.code);
  }

  await persistDecision(client, userId, decision);
  return decision.sent ? "sent" : "skipped";
}

async function persistDecision(
  client: BabylonServerSupabase,
  userId: string,
  decision: AttentionDeliveryDecision
): Promise<void> {
  if (!decision.civilDate || decision.eligibleKeys.length === 0) return;
  if (decision.sent) {
    const inserted = await client.from("notification_deliveries").insert(
      decision.coveredKeys.map((attentionKey) => ({
        user_id: userId,
        attention_key: attentionKey,
        civil_date: decision.civilDate as string,
        status: "succeeded",
        failure_code: null,
      }))
    );
    if (inserted.error) logOperational("record delivery", inserted.error.code);
    return;
  }
  if (!decision.failureCode) return;
  const inserted = await client.from("notification_deliveries").insert(
    decision.eligibleKeys.map((attentionKey) => ({
      user_id: userId,
      attention_key: attentionKey,
      civil_date: decision.civilDate as string,
      status: "failed",
      failure_code: decision.failureCode,
    }))
  );
  if (inserted.error) logOperational("record delivery failure", inserted.error.code);
}

export async function sendOwnedTransportTest(
  client: BabylonServerSupabase,
  config: SenderConfig,
  userId: string
): Promise<{ delivered: number; removed: number } | null> {
  const subscriptions = await client
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (subscriptions.error || !subscriptions.data) {
    logOperational("read subscriptions", subscriptions.error?.code);
    return null;
  }

  let delivered = 0;
  let removed = 0;
  for (const row of subscriptions.data) {
    const result = await sendGenericPush(
      { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
      config
    );
    if (result.ok) {
      delivered += 1;
      continue;
    }
    if (!result.permanent) continue;
    const deleted = await client
      .from("push_subscriptions")
      .delete()
      .eq("id", row.id)
      .eq("user_id", userId);
    if (deleted.error) logOperational("remove subscription", deleted.error.code);
    else removed += 1;
  }
  return { delivered, removed };
}
