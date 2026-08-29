# Deploying Business OS (Frontend + Cloudflare)

Business OS has two parts you deploy together:

1. **Frontend** (`frontend/`) — builds to static files.
2. **Cloudflare Worker** (`cloudflare/`) — serves the API *and* the built
   frontend files, backed by D1 (database), R2 (files), Queues (jobs), and
   KV (cache).

There's nothing else to deploy — no Docker image, no separate server process.

## Prerequisites (one-time)

- Node.js 20+ and npm.
- A Cloudflare account with Workers, D1, R2, Queues, and KV enabled.
- `npx wrangler login` (or a Cloudflare API token with Workers/D1/R2/KV/Queues
  edit permissions + zone permission for the two Worker routes) — done once
  per machine/CI runner.
- The resources already exist for this project (see `cloudflare/wrangler.toml`
  for the current `account_id`, `database_id`, KV `id`, R2 bucket, and queue
  names). If you're standing this up somewhere new, create them first:

  ```sh
  wrangler d1 create business-os
  wrangler kv namespace create CACHE
  wrangler r2 bucket create business-os-assets
  wrangler queues create business-os-import
  wrangler queues create business-os-media
  ```

  then copy the returned IDs into `cloudflare/wrangler.toml`.

## Fresh install (new machine / new checkout)

```sh
# 1. Install dependencies for both projects
cd frontend && npm install && cd ..
cd cloudflare && npm install && cd ..

# 2. Apply D1 migrations to the remote database
cd cloudflare
npm run migrate:remote

# 3. Build the frontend and deploy the Worker
cd ../frontend && npm run build && cd ../cloudflare
npm run deploy
```

Then confirm it's live:

```sh
curl https://admin.leangbeauty.com/health
# {"status":"ok","version":"...","time":"..."}
```

## Redeploying after any code change

Whenever you change anything in `frontend/` or `cloudflare/`, reinstall (only
needed if `package.json` changed) and redeploy:

```sh
# Only if dependencies changed:
cd frontend && npm install && cd ../cloudflare && npm install && cd ..

# Every time you deploy:
cd cloudflare
npm run deploy:full
```

`npm run deploy:full` (defined in `cloudflare/package.json`) runs, in order:
typecheck the Worker → build the frontend → apply remote D1 migrations →
`wrangler deploy`. This is the command to run for a normal "I changed some
code, ship it" redeploy.

### One-command release (Windows)

Double-click `run\full-automation.bat`, or run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ops\scripts\powershell\full-automation.ps1
```

This does the same steps as `deploy:full`, plus a live polling health check
against the real `https://admin.leangbeauty.com/health` URL after
deploying, so you get a clear pass/fail instead of just "wrangler said OK."

### Just checking a change locally, not releasing it

Double-click `run\verify-local.bat`, or run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ops\scripts\powershell\verify-local.ps1
```

Same install/typecheck/build steps as `full-automation.ps1`, plus the
pure-logic test suites (`frontend`'s `tests\*.test.ts` and
`cloudflare\scripts\test-*.cjs`), but it never calls `wrangler`, never
touches D1, never pushes secrets, and never deploys. Use this after
pulling in a change to confirm it actually installs, typechecks, passes
its tests, and builds, before deciding to cut a release.

## Database migrations

Migrations live in `cloudflare/migrations/`. To add one, create the next
numbered `NNNN_description.sql` file, then:

```sh
cd cloudflare
npm run migrate:local    # test against local D1 first
npm run migrate:remote   # apply to the real remote database
```

**If a migration fails with "table/index already exists":** this means the
remote database already has that object but wrangler's migration-tracking
table (`d1_migrations`) doesn't know it was applied — usually from an earlier
run that was interrupted between creating the object and recording it as
applied. As of this repo's migrations, `CREATE TABLE`/`CREATE INDEX`
statements use `IF NOT EXISTS`, so simply re-running `npm run migrate:remote`
will skip the already-existing object and correctly record the migration as
applied, then continue to the next one. If you write a new migration, keep
using `IF NOT EXISTS` for the same reason.

If you ever need to manually inspect or fix migration state:

```sh
npm run d1:shell:remote -- "SELECT * FROM d1_migrations ORDER BY id DESC LIMIT 5"
```

## Rolling back

Cloudflare Workers keeps previous deployments. From the Cloudflare dashboard
(Workers & Pages → business-os → Deployments) you can roll back to a prior
Worker version instantly. D1 migrations are forward-only — write a
compensating migration rather than trying to "undo" one.

## Secrets

Never put real credentials in tracked files. Set them with:

```sh
wrangler secret put SOME_SECRET_NAME
```

or via the Cloudflare dashboard (Workers & Pages → business-os → Settings →
Variables). If a secret was ever pasted into chat, a screenshot, or a commit,
rotate it immediately.
