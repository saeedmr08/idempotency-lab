# Idempotency Lab

Interactive portfolio lab by **Saeed Rumaneh** for exploring HTTP `Idempotency-Key` semantics on simulated charge creation.

## How to run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

| Script | Purpose |
|--------|---------|
| `npm run dev` | Dev server |
| `npm test` | Vitest |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Production build |

## Example inputs

1. Mode **Reuse fixed key**, key `lab-key-001`, amount `2500` USD → POST twice → first `201` created, second `200` replayed (same charge id).
2. Keep the same key, change amount to `9999` → POST → `409` conflict.
3. Mode **Omit header** → each POST creates a new charge (`201`).
4. Restart the server and POST again with `lab-key-001` + same body → still replays from `data/idempotency.json`.

## What it demonstrates

| Scenario | Result |
| --- | --- |
| Same key + same body | Replay stored charge (`200`, no double create) |
| Same key + different body | Conflict (`409`) |
| Missing / blank key | Every call creates a new charge (`201`) |

The core engine lives in `lib/idempotency.ts`. Keys with bodies persist to `data/idempotency.json` (gitignored).

## API

### `POST /api/charges`

Headers: `Idempotency-Key` (optional), `Content-Type: application/json`

```json
{
  "amountCents": 2500,
  "currency": "USD",
  "description": "bench probe charge"
}
```

- `201` created · `200` replayed · `409` conflict · `400` invalid body

### `GET /api/charges` — list stored keys

### `DELETE /api/charges` — reset store (clears the JSON file)

## License

MIT © 2026 Saeed Rumaneh — see [LICENSE](./LICENSE).

## Security

See [SECURITY.md](./SECURITY.md). Do not send real payment or customer data into this demo.

## Complete product flows

1. Click **Replay** — first POST creates a charge; the second returns `200` with the same id (persisted key).
2. Click **Conflict** — same key with a different amount returns `409`.
3. Click **Missing-key** — each POST creates a new charge; timeline stays empty until you run a scenario.
