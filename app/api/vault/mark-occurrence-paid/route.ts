import { NextResponse } from "next/server";
import { createCloudVaultGateway } from "@/lib/babylon/cloud-vault";
import {
  executePaidCommand,
  paidCommandHttp,
  parsePaidCommandBody,
} from "@/lib/babylon/paid-command";
import {
  createUserSupabaseClient,
  requireAuthenticatedUser,
} from "@/lib/supabase/server";

/**
 * POST /api/vault/mark-occurrence-paid
 * Marks one acknowledged occurrence paid for the signed-in owner.
 * The body is the occurrence id and its preimage. It is not a vault document.
 */
export async function POST(request: Request) {
  const auth = await requireAuthenticatedUser(request);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  if ([...url.searchParams.keys()].length > 0) {
    return NextResponse.json(
      { status: "rejected", reason: "invalid_body", error: "Paid could not be read." },
      { status: 400 }
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { status: "rejected", reason: "invalid_body", error: "Paid could not be read." },
      { status: 400 }
    );
  }

  const command = parsePaidCommandBody(raw);
  if (!command) {
    return NextResponse.json(
      { status: "rejected", reason: "invalid_body", error: "Paid could not be read." },
      { status: 400 }
    );
  }

  const client = createUserSupabaseClient(auth.accessToken);
  if (!client) {
    return NextResponse.json(
      { status: "unavailable", error: "Paid could not be confirmed." },
      { status: 503 }
    );
  }

  const result = await executePaidCommand({
    gateway: createCloudVaultGateway(client, async () => auth.user.id),
    userId: auth.user.id,
    occurrenceId: command.occurrenceId,
    preimage: command.preimage,
  });
  const http = paidCommandHttp(result);
  return NextResponse.json(http.body, { status: http.status });
}
