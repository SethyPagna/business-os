# Business OS on Cloudflare

This folder runs Business OS on Cloudflare Workers, D1, R2, Queues, KV, and
Worker static assets.

The Worker serves both the API and the built React frontend:

- `https://admin.leangcosmetics.dpdns.org`
- `https://leangcosmetics.dpdns.org`

API, upload, and health routes run Worker code first. All other paths fall
back to the single-page frontend app from `../frontend/dist`.

`cloudflare/` is the only backend — the previous Docker/Postgres app has
been removed. See `../PORTING_STATUS.md` for the historical migration log.

## Quick Start

```sh
cd cloudflare
npm install
npm run build:frontend
npm run migrate:local
npm run dev
```

Then check:

```sh
curl http://localhost:8787/health
```

## Cloudflare Resources

Before the first remote deploy, create or verify:

```sh
wrangler d1 create business-os
wrangler kv namespace create CACHE
wrangler r2 bucket create business-os-assets
wrangler queues create business-os-import
wrangler queues create business-os-media
```

Copy the returned D1 `database_id` and KV namespace `id` into
`wrangler.toml`.

## Deploy

```sh
npm run deploy:full
```

That command typechecks the Worker, rebuilds frontend assets, applies remote
D1 migrations, pushes secrets from `.dev.vars` to Cloudflare, and deploys the
Worker. `run/full-automation.bat` (repo root) runs the same pipeline plus a
live `/health` check afterward.

The Cloudflare token needs account-level Workers, D1, KV, R2, and Queues edit
permissions, plus zone permission for Worker routes on the two hostnames.

### One-time local setup (auth + secrets)

Two files, both gitignored, both already listed in `.gitignore` -- never
commit either:

- **`.wrangler-auth.local`** -- `CLOUDFLARE_API_TOKEN=...` and
  `CLOUDFLARE_ACCOUNT_ID=...`. Every npm script that calls `wrangler`
  (`dev`, `deploy`, `migrate:local`, `migrate:remote`, `d1:shell:*`) is
  wrapped through `scripts/with-wrangler-auth.cjs`, which loads this file
  and sets those two env vars before running wrangler -- so none of those
  commands ever prompt for `wrangler login`, and none of them depend on
  whichever account an OAuth session happens to be cached against. If the
  file is missing, everything still works, it just falls back to
  wrangler's normal login/OAuth flow.
- **`.dev.vars`** -- real secret values (`GOOGLE_LOGIN_CLIENT_SECRET`,
  `GOOGLE_DRIVE_CLIENT_SECRET`, `RESEND_API_KEY`) for local `wrangler dev`
  (Wrangler loads this file automatically -- that part needs no wrapper).
  `npm run secrets:sync` (folded into `deploy:full` automatically) reads
  the same file and pushes those same values to Cloudflare via
  `wrangler secret put`, so production stays in sync with local dev
  without you ever typing that command by hand.

If you rotate the API token, or the Google/Resend secrets, just edit the
values in these two files -- nothing else in the repo needs to change.

## Layout

- `wrangler.toml`: Worker routes and bindings.
- `migrations/`: D1 schema migrations.
- `src/index.ts`: Hono Worker entry point and queue consumer dispatch.
- `src/lib/`: D1, R2, cache, upload, auth, audit, and conflict helpers.
- `src/routes/`: Cloudflare-port API routes.
- `src/queue.ts`: Cloudflare Queues consumers for import and media jobs.
