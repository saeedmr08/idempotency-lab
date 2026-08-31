/**
 * In-process Idempotency-Key engine for charge / order creation demos.
 *
 * Semantics (inspired by common payment-API conventions):
 * - Missing key  → every call creates a new resource
 * - Same key + same body fingerprint → replay the stored response (no double create)
 * - Same key + different body fingerprint → conflict
 */

export type ChargeRequest = {
  amountCents: number;
  currency: string;
  description?: string;
};

export type ChargeResource = {
  id: string;
  amountCents: number;
  currency: string;
  description: string;
  createdAt: string;
};

export type IdempotencyOutcome =
  | { kind: "created"; status: 201; resource: ChargeResource; replayed: false }
  | { kind: "replayed"; status: 200; resource: ChargeResource; replayed: true }
  | {
      kind: "conflict";
      status: 409;
      message: string;
      existingFingerprint: string;
      attemptedFingerprint: string;
    };

export type StoredRecord = {
  fingerprint: string;
  resource: ChargeResource;
  createdAt: string;
};

export type IdempotencyStoreSnapshot = {
  key: string;
  fingerprint: string;
  resourceId: string;
  createdAt: string;
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** Deterministic fingerprint of a request body (order-independent keys). */
export function fingerprintBody(body: ChargeRequest): string {
  const normalized: ChargeRequest = {
    amountCents: body.amountCents,
    currency: body.currency.trim().toUpperCase(),
    description: (body.description ?? "").trim(),
  };
  return stableStringify(normalized);
}

function assertValidBody(body: ChargeRequest): void {
  if (
    typeof body.amountCents !== "number" ||
    !Number.isFinite(body.amountCents) ||
    body.amountCents <= 0
  ) {
    throw new Error("amountCents must be a positive finite number");
  }
  if (typeof body.currency !== "string" || body.currency.trim().length !== 3) {
    throw new Error("currency must be a 3-letter code");
  }
}

let seq = 0;

function nextId(): string {
  seq += 1;
  return `ch_lab_${seq.toString(36)}_${Date.now().toString(36)}`;
}

export class IdempotencyEngine {
  private readonly records = new Map<string, StoredRecord>();
  private onChange: (() => void) | null = null;

  constructor(private readonly idFactory: () => string = nextId) {}

  /** Optional hook for file persistence (server only). */
  setChangeListener(listener: (() => void) | null): void {
    this.onChange = listener;
  }

  /** Restore records from disk (server hydrate). */
  loadSnapshot(entries: [string, StoredRecord][], nextSeq?: number): void {
    this.records.clear();
    for (const [key, record] of entries) {
      this.records.set(key, record);
    }
    if (typeof nextSeq === "number" && Number.isFinite(nextSeq)) {
      seq = Math.max(seq, nextSeq);
    }
  }

  exportSnapshot(): { seq: number; records: Record<string, StoredRecord> } {
    return {
      seq,
      records: Object.fromEntries(this.records.entries()),
    };
  }

  private notify(): void {
    this.onChange?.();
  }

  /** Wipe all keys — useful for demos and tests. */
  reset(): void {
    this.records.clear();
    this.notify();
  }

  listKeys(): IdempotencyStoreSnapshot[] {
    return [...this.records.entries()].map(([key, record]) => ({
      key,
      fingerprint: record.fingerprint,
      resourceId: record.resource.id,
      createdAt: record.createdAt,
    }));
  }

  createCharge(key: string | undefined | null, body: ChargeRequest): IdempotencyOutcome {
    assertValidBody(body);

    const fingerprint = fingerprintBody(body);
    const normalizedKey = typeof key === "string" ? key.trim() : "";

    if (!normalizedKey) {
      const resource = this.mint(body);
      return { kind: "created", status: 201, resource, replayed: false };
    }

    const existing = this.records.get(normalizedKey);
    if (!existing) {
      const resource = this.mint(body);
      this.records.set(normalizedKey, {
        fingerprint,
        resource,
        createdAt: resource.createdAt,
      });
      this.notify();
      return { kind: "created", status: 201, resource, replayed: false };
    }

    if (existing.fingerprint !== fingerprint) {
      return {
        kind: "conflict",
        status: 409,
        message:
          "Idempotency-Key was reused with a different request body. Keys must map to a single payload.",
        existingFingerprint: existing.fingerprint,
        attemptedFingerprint: fingerprint,
      };
    }

    return {
      kind: "replayed",
      status: 200,
      resource: existing.resource,
      replayed: true,
    };
  }

  private mint(body: ChargeRequest): ChargeResource {
    return {
      id: this.idFactory(),
      amountCents: body.amountCents,
      currency: body.currency.trim().toUpperCase(),
      description: (body.description ?? "").trim() || "untitled charge",
      createdAt: new Date().toISOString(),
    };
  }
}
