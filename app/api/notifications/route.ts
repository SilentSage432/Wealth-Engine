import { NextResponse } from "next/server";
import { endpointQuery, getNotificationConfiguration } from "@/lib/babylon/notification-records";
import { bindNotificationSession } from "@/lib/babylon/notification-store";

/**
 * GET /api/notifications
 * Authenticated preference status. Optional ?endpoint= reports whether
 * that endpoint is already stored for this steward. No subscription secrets.
 */
export async function GET(request: Request) {
  const session = await bindNotificationSession(request);
  if (session instanceof NextResponse) return session;

  const endpoint = endpointQuery(
    new URL(request.url).searchParams.get("endpoint")
  );
  if (endpoint === "invalid") {
    return NextResponse.json(
      { error: "A valid push endpoint is required." },
      { status: 400 }
    );
  }

  const result = await getNotificationConfiguration({
    userId: session.userId,
    endpoint,
    store: session.store,
  });
  return NextResponse.json(result.body, { status: result.status });
}
