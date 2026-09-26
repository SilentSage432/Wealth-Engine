import { NextResponse } from "next/server";
import {
  registerPushSubscription,
  removePushSubscription,
} from "@/lib/babylon/notification-records";
import { bindNotificationSession } from "@/lib/babylon/notification-store";

async function readBody(request: Request): Promise<unknown | undefined> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/**
 * POST /api/notifications/subscriptions
 * Inserts or updates keys for an endpoint owned by the authenticated steward.
 */
export async function POST(request: Request) {
  const session = await bindNotificationSession(request);
  if (session instanceof NextResponse) return session;

  const body = await readBody(request);
  if (body === undefined) {
    return NextResponse.json(
      { error: "A valid push subscription is required." },
      { status: 400 }
    );
  }

  const result = await registerPushSubscription({
    userId: session.userId,
    body,
    store: session.store,
  });
  return NextResponse.json(result.body, { status: result.status });
}

/**
 * DELETE /api/notifications/subscriptions
 * Removes the authenticated steward's row for the supplied endpoint.
 */
export async function DELETE(request: Request) {
  const session = await bindNotificationSession(request);
  if (session instanceof NextResponse) return session;

  const body = await readBody(request);
  if (body === undefined) {
    return NextResponse.json(
      { error: "A valid push endpoint is required." },
      { status: 400 }
    );
  }

  const result = await removePushSubscription({
    userId: session.userId,
    body,
    store: session.store,
  });
  return NextResponse.json(result.body, { status: result.status });
}
