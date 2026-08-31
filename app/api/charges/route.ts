import { NextRequest, NextResponse } from "next/server";
import type { ChargeRequest } from "@/lib/idempotency";
import { getSharedEngine } from "@/lib/store";

export const runtime = "nodejs";

function parseBody(raw: unknown): ChargeRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.amountCents !== "number") return null;
  if (typeof obj.currency !== "string") return null;
  return {
    amountCents: obj.amountCents,
    currency: obj.currency,
    description:
      typeof obj.description === "string" ? obj.description : undefined,
  };
}

/** POST /api/charges — create (or replay) a simulated charge. */
export async function POST(request: NextRequest) {
  const engine = getSharedEngine();
  const idempotencyKey = request.headers.get("Idempotency-Key");

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  const body = parseBody(raw);
  if (!body) {
    return NextResponse.json(
      {
        error:
          "Body requires amountCents (number) and currency (3-letter string)",
      },
      { status: 400 },
    );
  }

  try {
    const outcome = engine.createCharge(idempotencyKey, body);

    if (outcome.kind === "conflict") {
      return NextResponse.json(
        {
          error: outcome.message,
          existingFingerprint: outcome.existingFingerprint,
          attemptedFingerprint: outcome.attemptedFingerprint,
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        charge: outcome.resource,
        replayed: outcome.replayed,
        idempotencyKey: idempotencyKey?.trim() || null,
      },
      {
        status: outcome.status,
        headers: {
          "X-Idempotent-Replayed": outcome.replayed ? "true" : "false",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid charge";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** GET /api/charges — inspect persisted idempotency store. */
export async function GET() {
  const engine = getSharedEngine();
  return NextResponse.json({ keys: engine.listKeys() });
}

/** DELETE /api/charges — reset the lab store (clears data/idempotency.json). */
export async function DELETE() {
  const engine = getSharedEngine();
  engine.reset();
  return NextResponse.json({ ok: true, keys: [] });
}
