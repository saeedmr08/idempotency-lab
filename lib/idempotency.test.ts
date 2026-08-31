import { describe, expect, it, beforeEach } from "vitest";
import {
  IdempotencyEngine,
  fingerprintBody,
  type ChargeRequest,
} from "./idempotency";

const baseBody: ChargeRequest = {
  amountCents: 2500,
  currency: "usd",
  description: "lab probe",
};

describe("fingerprintBody", () => {
  it("normalizes currency case and trims description", () => {
    expect(
      fingerprintBody({
        amountCents: 100,
        currency: "Usd",
        description: "  hello  ",
      }),
    ).toBe(
      fingerprintBody({
        amountCents: 100,
        currency: "USD",
        description: "hello",
      }),
    );
  });
});

describe("IdempotencyEngine", () => {
  let engine: IdempotencyEngine;
  let idCounter: number;

  beforeEach(() => {
    idCounter = 0;
    engine = new IdempotencyEngine(() => `fixed_${++idCounter}`);
  });

  it("replays the same resource when key and body match", () => {
    const first = engine.createCharge("key-alpha", baseBody);
    const second = engine.createCharge("key-alpha", {
      ...baseBody,
      currency: "USD",
    });

    expect(first.kind).toBe("created");
    expect(second.kind).toBe("replayed");
    if (first.kind === "created" && second.kind === "replayed") {
      expect(second.resource.id).toBe(first.resource.id);
      expect(second.status).toBe(200);
      expect(second.replayed).toBe(true);
    }
    expect(engine.listKeys()).toHaveLength(1);
  });

  it("returns conflict when the same key is reused with a different body", () => {
    const first = engine.createCharge("key-beta", baseBody);
    const conflict = engine.createCharge("key-beta", {
      ...baseBody,
      amountCents: 9999,
    });

    expect(first.kind).toBe("created");
    expect(conflict.kind).toBe("conflict");
    if (conflict.kind === "conflict") {
      expect(conflict.status).toBe(409);
      expect(conflict.attemptedFingerprint).not.toBe(
        conflict.existingFingerprint,
      );
    }
    if (first.kind === "created") {
      expect(engine.listKeys()[0]?.resourceId).toBe(first.resource.id);
    }
  });

  it("creates unique resources when the Idempotency-Key is missing", () => {
    const a = engine.createCharge(undefined, baseBody);
    const b = engine.createCharge(null, baseBody);
    const c = engine.createCharge("   ", baseBody);

    expect(a.kind).toBe("created");
    expect(b.kind).toBe("created");
    expect(c.kind).toBe("created");
    if (a.kind === "created" && b.kind === "created" && c.kind === "created") {
      expect(new Set([a.resource.id, b.resource.id, c.resource.id]).size).toBe(
        3,
      );
    }
    expect(engine.listKeys()).toHaveLength(0);
  });

  it("creates distinct resources for distinct keys even with identical bodies", () => {
    const a = engine.createCharge("k1", baseBody);
    const b = engine.createCharge("k2", baseBody);

    expect(a.kind).toBe("created");
    expect(b.kind).toBe("created");
    if (a.kind === "created" && b.kind === "created") {
      expect(a.resource.id).not.toBe(b.resource.id);
    }
    expect(engine.listKeys()).toHaveLength(2);
  });
});
