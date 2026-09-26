import { NextResponse } from "next/server";
import { runDailyEvaluation } from "@/lib/babylon/notification-evaluator";
import {
  authorizeCronRequest,
  isCanonicalSupabaseUrl,
} from "@/lib/babylon/notification-delivery";
import { readSenderConfig } from "@/lib/babylon/notification-delivery";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

/**
 * GET /api/notifications/evaluate
 * Daily Attention delivery. Vercel Cron sends Authorization: Bearer CRON_SECRET.
 * The request cannot choose a user or supply financial state.
 */
export async function GET(request: Request) {
  if (
    !authorizeCronRequest(
      request.headers.get("authorization"),
      process.env.CRON_SECRET
    )
  ) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isCanonicalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    return NextResponse.json(
      { error: "Notification evaluation is unavailable." },
      { status: 503 }
    );
  }
  const config = readSenderConfig();
  const client = getSupabaseServiceClient();
  if (!config || !client) {
    return NextResponse.json(
      { error: "Notification evaluation is unavailable." },
      { status: 503 }
    );
  }

  const summary = await runDailyEvaluation(client, config, new Date());
  return NextResponse.json(summary);
}
