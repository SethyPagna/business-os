# Business OS on Cloudflare

This is a separate, in-progress path to run Business OS on Cloudflare
Workers + D1 + R2 + Queues + KV instead of Docker — no local machine,
Docker Desktop, or Cloudflare Tunnel required at all.

**Start here:**

1. **[`PRODUCTION-READINESS.md`](./PRODUCTION-READINESS.md)** — is this
   ready to use for real? A direct, numbers-based answer (short version:
   not yet — 10 of 215 backend endpoints exist here so far).
2. **[`MIGRATION.md`](./MIGRATION.md)** — the full architecture writeup:
   what's built and tested, how D1/R2/KV/Queues map to what Docker/
   Postgres/Redis/BullMQ did, what a full migration would take, and
   answers to specific questions about search, caching, and performance.

## Quick start (local development against real Cloudflare tooling)

```
cd cloudflare
npm install
npm run migrate:local     # applies migrations/0001_init.sql to a local D1 database
npm run dev                # starts wrangler dev
```

Then, in another terminal:

```
curl http://localhost:8787/health
```

`npm run typecheck` runs the TypeScript compiler in check-only mode.
`npm run deploy` runs `wrangler deploy` against your real Cloudflare account
— read `PRODUCTION-READINESS.md` first so you know exactly what will and
won't work if you do this today.

## Folder layout

- `wrangler.toml` — bindings (D1, R2, KV, Queues) and Worker config.
- `migrations/` — D1 schema, applied via `wrangler d1 migrations apply`.
- `src/index.ts` — the Hono app entry point (both the HTTP `fetch` handler
  and the Queues `queue` consumer handler).
- `src/lib/` — the D1 query adapter, R2 helper, KV/Cache-API cache helper,
  and session auth — the reusable foundation every route is built on.
- `src/routes/` — one file per API area, mirroring `backend/src/routes/`.
- `src/queue.ts` — Cloudflare Queues consumers for background jobs
  (imports, media processing).

## This is additive, not a replacement

`backend/` and `frontend/` are untouched by anything in this folder — the
Docker path documented in the root `README.md` is still the real, complete,
working app. Nothing here is wired into the deployed frontend yet.
