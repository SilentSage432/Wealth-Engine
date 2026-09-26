import { NextResponse } from "next/server";
import { saveNotificationPreference } from "@/lib/babylon/notification-records";
import { bindNotificationSession } from "@/lib/babylon/notification-store";

/**
 * PUT /api/notifications/preferences
 * Saves enabled and ianaTimezone for the authenticated steward.
 */
export async function PUT(request: Request) {
  const session = await bindNotificationSession(request);
  if (session instanceof NextResponse) return session;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "enabled and a valid IANA timezone are required." },
      { status: 400 }
    );
  }

  const result = await saveNotificationPreference({
    userId: session.userId,
    body,
    store: session.store,
  });
  return NextResponse.json(result.body, { status: result.status });
}
