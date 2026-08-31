import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  IdempotencyEngine,
  type StoredRecord,
} from "./idempotency";

const DATA_FILE = path.join(process.cwd(), "data", "idempotency.json");

type PersistFile = {
  seq: number;
  records: Record<string, StoredRecord>;
};

function hydrate(engine: IdempotencyEngine): void {
  try {
    const raw = JSON.parse(readFileSync(DATA_FILE, "utf8")) as PersistFile;
    const entries = Object.entries(raw.records ?? {}).filter(
      ([, record]) =>
        record &&
        typeof record.fingerprint === "string" &&
        record.resource &&
        typeof record.resource.id === "string",
    ) as [string, StoredRecord][];
    engine.loadSnapshot(entries, raw.seq);
  } catch {
    // first boot
  }
}

function persist(engine: IdempotencyEngine): void {
  mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const snapshot = engine.exportSnapshot();
  writeFileSync(DATA_FILE, `${JSON.stringify(snapshot, null, 2)}\n`);
}

/** Shared singleton for Next.js route handlers (dev / single process). */
const globalForLab = globalThis as unknown as {
  __idempotencyLabEngine?: IdempotencyEngine;
};

export function getSharedEngine(): IdempotencyEngine {
  if (!globalForLab.__idempotencyLabEngine) {
    const engine = new IdempotencyEngine();
    hydrate(engine);
    engine.setChangeListener(() => persist(engine));
    globalForLab.__idempotencyLabEngine = engine;
  }
  return globalForLab.__idempotencyLabEngine;
}
