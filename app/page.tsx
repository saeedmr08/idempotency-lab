"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type TimelineKind = "created" | "replayed" | "conflict" | "error";

type TimelineEvent = {
  id: string;
  at: string;
  kind: TimelineKind;
  title: string;
  detail: string;
  status: number;
  attempt: number;
};

type KeyMode = "fixed" | "fresh" | "omit";

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function randomKey(): string {
  const chunk = () => Math.random().toString(36).slice(2, 8);
  return `idem_${chunk()}_${chunk()}`;
}

export default function HomePage() {
  const [amountCents, setAmountCents] = useState(2500);
  const [currency, setCurrency] = useState("USD");
  const [description, setDescription] = useState("bench probe charge");
  const [keyMode, setKeyMode] = useState<KeyMode>("fixed");
  const [fixedKey, setFixedKey] = useState("lab-key-001");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [storedKeys, setStoredKeys] = useState(0);
  const attemptRef = useRef(0);

  const bodyPreview = useMemo(
    () =>
      JSON.stringify(
        { amountCents, currency, description },
        null,
        2,
      ),
    [amountCents, currency, description],
  );

  const refreshStore = useCallback(async () => {
    try {
      const res = await fetch("/api/charges");
      if (!res.ok) {
        setError("Failed to load idempotency store");
        return;
      }
      const data = (await res.json()) as { keys?: unknown[] };
      setStoredKeys(Array.isArray(data.keys) ? data.keys.length : 0);
    } catch {
      setError("Network error loading store");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStore();
  }, [refreshStore]);

  async function fireCharge(
    e?: FormEvent,
    overrides?: {
      keyMode?: KeyMode;
      amountCents?: number;
      fixedKey?: string;
    },
  ) {
    e?.preventDefault();
    setBusy(true);
    setError("");
    attemptRef.current += 1;
    const nextAttempt = attemptRef.current;

    const mode = overrides?.keyMode ?? keyMode;
    const amount = overrides?.amountCents ?? amountCents;
    const keyValue = overrides?.fixedKey ?? fixedKey;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    let usedKey: string | null = null;
    if (mode === "fixed") {
      usedKey = keyValue.trim();
      if (usedKey) headers["Idempotency-Key"] = usedKey;
    } else if (mode === "fresh") {
      usedKey = randomKey();
      headers["Idempotency-Key"] = usedKey;
    }

    try {
      const res = await fetch("/api/charges", {
        method: "POST",
        headers,
        body: JSON.stringify({
          amountCents: amount,
          currency,
          description,
        }),
      });
      const data = (await res.json()) as {
        charge?: {
          id: string;
          amountCents: number;
          currency: string;
          description: string;
        };
        replayed?: boolean;
        error?: string;
        existingFingerprint?: string;
        attemptedFingerprint?: string;
      };

      let kind: TimelineKind = "error";
      let title = `HTTP ${res.status}`;
      let detail = data.error ?? "Unexpected response";

      if (res.status === 201 && data.charge) {
        kind = "created";
        title = "Created charge";
        detail = `${data.charge.id} · ${formatMoney(data.charge.amountCents, data.charge.currency)} · key ${usedKey ?? "(none)"}`;
      } else if (res.status === 200 && data.charge) {
        kind = "replayed";
        title = "Replayed stored charge";
        detail = `${data.charge.id} · same key + body · no double create`;
      } else if (res.status === 409) {
        kind = "conflict";
        title = "Idempotency conflict";
        detail = data.error ?? "Key reused with a different body";
      }

      setEvents((prev) => [
        {
          id: `evt_${Date.now()}_${nextAttempt}`,
          at: new Date().toLocaleTimeString(),
          kind,
          title,
          detail,
          status: res.status,
          attempt: nextAttempt,
        },
        ...prev,
      ]);
      await refreshStore();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
      setEvents((prev) => [
        {
          id: `evt_${Date.now()}_${nextAttempt}`,
          at: new Date().toLocaleTimeString(),
          kind: "error",
          title: "Network failure",
          detail: err instanceof Error ? err.message : "Request failed",
          status: 0,
          attempt: nextAttempt,
        },
        ...prev,
      ]);
    } finally {
      setBusy(false);
    }
  }

  /** Create then replay with the same key + body. */
  async function runReplayScenario() {
    setKeyMode("fixed");
    setFixedKey("lab-key-replay");
    setAmountCents(2500);
    await fireCharge(undefined, {
      keyMode: "fixed",
      fixedKey: "lab-key-replay",
      amountCents: 2500,
    });
    await fireCharge(undefined, {
      keyMode: "fixed",
      fixedKey: "lab-key-replay",
      amountCents: 2500,
    });
  }

  /** Same key, different body → 409. */
  async function runConflictScenario() {
    setKeyMode("fixed");
    setFixedKey("lab-key-conflict");
    await fireCharge(undefined, {
      keyMode: "fixed",
      fixedKey: "lab-key-conflict",
      amountCents: 1000,
    });
    setAmountCents(9999);
    await fireCharge(undefined, {
      keyMode: "fixed",
      fixedKey: "lab-key-conflict",
      amountCents: 9999,
    });
  }

  /** Omit Idempotency-Key → new charge each time. */
  async function runMissingKeyScenario() {
    setKeyMode("omit");
    await fireCharge(undefined, { keyMode: "omit", amountCents });
  }

  async function resetLab() {
    setBusy(true);
    setError("");
    try {
      await fetch("/api/charges", { method: "DELETE" });
      setEvents([]);
      attemptRef.current = 0;
      setStoredKeys(0);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="shell">
        <p className="empty">Loading idempotency store…</p>
      </main>
    );
  }

  return (
    <main className="shell">
      <div className="brand-row">
        <h1 className="brand">
          Idempotency <span>Lab</span>
        </h1>
        <p className="tag">Saeed Rumaneh · bench v1</p>
      </div>
      <p className="lede">
        Fire repeated charge creates against an in-process API. Watch how
        Idempotency-Key turns retries into safe replays — or conflicts when the
        payload diverges. Store holds {storedKeys} key(s).
      </p>

      {error ? (
        <p className="empty" role="alert">
          {error}
        </p>
      ) : null}

      <div className="actions" style={{ marginBottom: "1rem" }}>
        <button
          className="btn"
          type="button"
          disabled={busy}
          onClick={() => void runReplayScenario()}
        >
          Replay
        </button>
        <button
          className="btn ghost"
          type="button"
          disabled={busy}
          onClick={() => void runConflictScenario()}
        >
          Conflict
        </button>
        <button
          className="btn ghost"
          type="button"
          disabled={busy}
          onClick={() => void runMissingKeyScenario()}
        >
          Missing-key
        </button>
      </div>

      <div className="bench">
        <section className="panel" aria-labelledby="controls-heading">
          <h2 id="controls-heading">Instrument panel</h2>
          <p className="hint">
            Same key + same body → replay. Same key + different body → 409.
            Missing key → a new charge every time.
          </p>

          <svg className="trace" viewBox="0 0 320 36" aria-hidden="true">
            <path d="M4 28 C40 28, 48 8, 80 8 S120 28, 160 28 200 8, 240 8 280 28, 316 18" />
          </svg>

          <form onSubmit={(e) => void fireCharge(e)}>
            <div className="row-2">
              <div className="field">
                <label htmlFor="amount">Amount (cents)</label>
                <input
                  id="amount"
                  type="number"
                  min={1}
                  value={amountCents}
                  onChange={(ev) => setAmountCents(Number(ev.target.value))}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="currency">Currency</label>
                <input
                  id="currency"
                  value={currency}
                  maxLength={3}
                  onChange={(ev) => setCurrency(ev.target.value.toUpperCase())}
                  required
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="description">Description</label>
              <input
                id="description"
                value={description}
                onChange={(ev) => setDescription(ev.target.value)}
              />
            </div>

            <div className="field">
              <label>Idempotency-Key mode</label>
              <div className="toggles" role="group" aria-label="Key mode">
                {(
                  [
                    ["fixed", "Reuse fixed key"],
                    ["fresh", "New key each call"],
                    ["omit", "Omit header"],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    className="chip"
                    aria-pressed={keyMode === mode}
                    onClick={() => setKeyMode(mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {keyMode === "fixed" && (
              <div className="field">
                <label htmlFor="fixedKey">Fixed key</label>
                <input
                  id="fixedKey"
                  value={fixedKey}
                  onChange={(ev) => setFixedKey(ev.target.value)}
                  spellCheck={false}
                />
              </div>
            )}

            <div className="field">
              <label htmlFor="preview">Request body</label>
              <textarea
                id="preview"
                rows={5}
                readOnly
                value={bodyPreview}
                spellCheck={false}
              />
            </div>

            <div className="actions">
              <button className="btn" type="submit" disabled={busy}>
                {busy ? "Sending…" : "POST /api/charges"}
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={() => void resetLab()}
                disabled={busy}
              >
                Reset store
              </button>
            </div>
          </form>
        </section>

        <section className="panel" aria-labelledby="timeline-heading">
          <div
            className={`status-lamp${events.length ? " live" : ""}`}
            aria-live="polite"
          >
            <span className="dot" />
            {events.length
              ? `${events.length} attempt${events.length === 1 ? "" : "s"} on tape`
              : "awaiting first pulse"}
          </div>
          <h2 id="timeline-heading">Retry timeline</h2>
          <p className="hint">
            Newest attempts rise to the top. Colors mark create, replay, and
            conflict outcomes. Keys persist to data/idempotency.json.
          </p>

          {events.length === 0 ? (
            <p className="empty">
              Timeline is empty — use Replay, Conflict, or Missing-key to record
              the first pulse.
            </p>
          ) : (
            <ol className="timeline">
              {events.map((evt) => (
                <li key={evt.id} className={`event ${evt.kind}`}>
                  <div className="meta">
                    <span>#{evt.attempt}</span>
                    <span>{evt.at}</span>
                    <span>status {evt.status || "—"}</span>
                    <span>{evt.kind}</span>
                  </div>
                  <p className="title">{evt.title}</p>
                  <p className="detail">{evt.detail}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <p className="footer-note">
        In-memory + file-backed store · MIT 2026 Saeed Rumaneh · educational demo only
      </p>
    </main>
  );
}
