# Security Policy

## Scope

Idempotency Lab is an educational portfolio demo. It stores idempotency records and simulated charges **in process memory only**. Nothing is persisted to disk or a remote database.

## What this is not

- Not a production payment processor
- Not a substitute for Stripe/Adyen-style idempotency infrastructure
- Not hardened against abuse, multi-instance races, or key exhaustion

## Reporting a vulnerability

If you discover a security issue in this demo (for example, unsafe handling of request bodies that could affect a host running the lab), email **saeed.rumaneh@example.com** with:

1. A short description of the issue
2. Steps to reproduce
3. Impact assessment (demo-only vs. reusable pattern)

Please allow a reasonable response window before public disclosure.

## Safe usage

- Do not feed real card numbers, secrets, or production customer data into the lab
- Run locally or behind trusted networks only
- Treat API responses as synthetic fixtures
