import { NextResponse } from "next/server";
import { sendOwnedTransportTest } from "@/lib/babylon/notification-evaluator";
import { isCanonicalSupabaseUrl } from "@/lib/babylon/notification-delivery";
import { readSenderConfig } from "@/lib/babylon/notification-delivery";
import {
  getSupabaseServiceClient,
  requireAuthenticatedUser,
} from "@/lib/supabase/server";

/**
 * POST /api/notifications/test
 * Sends the fixed generic notification to the signed-in steward's stored
 * subscriptions. It does not read the vault or record Attention deliveries.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.trim()) {
    return NextResponse.json(
      { error: "This test does not accept a message." },
      { status: 400 }
    );
  }

  if (!isCanonicalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    return NextResponse.json(
      { error: "Notification delivery is unavailable." },
      { status: 503 }
    );
  }

  const session = await requireAuthenticatedUser(request);
  if (session instanceof NextResponse) return session;

  const config = readSenderConfig();
  const client = getSupabaseServiceClient();
  if (!config || !client) {
    return NextResponse.json(
      { error: "Notification delivery is unavailable." },
      { status: 503 }
    );
  }

  const result = await sendOwnedTransportTest(client, config, session.user.id);
  if (!result) {
    return NextResponse.json(
      { error: "Notification delivery is unavailable." },
      { status: 503 }
    );
  }
  return NextResponse.json({
    delivered: result.delivered,
    removed: result.removed,
  });
}
