# Deploying Business OS (Frontend + Cloudflare)

Business OS has two parts you deploy together:

1. **Frontend** (`frontend/`) — builds to static files.
2. **Cloudflare Worker** (`cloudflare/`) — serves the API *and* the built
   frontend files, backed by D1 (database), R2 (files), Queues (jobs), and
   KV (cache).

There's nothing else to deploy — no Docker image, no separate server process.

## Prerequisites (one-time)

- Node.js 22+ and npm (`cloudflare/package.json` pins `engines.node >= 22`;
  the frontend test files are also run directly with `node`, which needs
  Node's native TypeScript support).
- A Cloudflare account with Workers, D1, R2, Queues, and KV enabled.
- `npx wrangler login` (or a Cloudflare API token with Workers/D1/R2/KV/Queues
  edit permissions + zone permission for the two Worker routes) — done once
  per machine/CI runner.
- The resources already exist for this project (see `cloudflare/wrangler.toml`
  for the current `account_id`, `database_id`, KV `id`, R2 bucket, and queue
  names). If you're standing this up somewhere new, create them first:

  ```sh
  wrangler d1 create business-os
  wrangler d1 create business-os-import   # import staging (binding IMPORT_DB)
  wrangler kv namespace create CACHE
  wrangler r2 bucket create business-os-assets
  wrangler queues create business-os-import
  wrangler queues create business-os-import-dlq
  wrangler queues create business-os-media
  wrangler queues create business-os-backup-assets
  ```

  then copy the returned IDs into `cloudflare/wrangler.toml`. All four queues
  must exist **before** `wrangler deploy` — the config binds consumers to every
  one of them and deploy fails with "queue not found" otherwise. (Verified
  Aug 31 2026: all four exist on this account, so the current setup deploys.)

## Fresh install (new machine / new checkout)

```sh
# 1. Install dependencies for both projects
cd frontend && npm install && cd ..
cd cloudflare && npm install && cd ..

# 2. Apply D1 migrations to the remote databases (operational + import-staging)
cd cloudflare
npm run migrate:remote
npm run migrate:import:remote

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
typecheck the Worker → build the frontend → apply remote D1 migrations for the
operational DB (`migrate:remote`) → apply them for the import-staging DB
(`migrate:import:remote`) → sync secrets (`cloudflare/.dev.vars` → Cloudflare,
allowlisted keys only) → `wrangler deploy`. This is the command to run for a
normal "I changed some code, ship it" redeploy.

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
numbered `NNNN_description.sql` file — and with parallel sessions active,
**check the highest existing number immediately before committing** (numbers
have collided twice: two sessions both wrote an `0086_*`; the later writer
renamed to `0087` and had to fix `d1_migrations` bookkeeping by hand). One
historical duplicate exists on purpose: `0018_fees.sql` and
`0018_products_fts.sql` share a number, both applied everywhere long ago.
**Do not rename either** — wrangler tracks migrations by FILENAME, so a rename
makes every database think the renamed file is a new pending migration and
re-runs it. The fresh-chain test (`cloudflare/scripts/
test-migration-chain-fresh-pure.cjs`) proves the full chain, duplicates
included, applies cleanly from an empty database. Then:

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

## Deploying while other sessions / dev servers are active

This checkout is often shared by several concurrent Claude/dev sessions with
uncommitted work in the tree. Two hazards, and the chosen answer to both:

- `npm ci` (the pipeline's install step) deletes `node_modules` wholesale and
  dies with a misleading EPERM if a dev server (vite / `wrangler dev`'s
  workerd) still holds a native binary open. `full-automation.ps1` stops
  repo-local dev servers and retries with `npm install`, but peers' servers
  die with them.
- `wrangler deploy` ships the **working tree** — uncommitted peer code would
  go to production unreviewed.

The chosen method when the tree isn't clean: **deploy from committed HEAD via
an isolated git worktree** — `git worktree add --detach <path> HEAD`, copy the
gitignored `cloudflare/.wrangler-auth.local` and `cloudflare/.dev.vars` into
it, run the pipeline there, then `git worktree remove --force <path>` (which
also clears the copied secret files). Peers' local environments are untouched;
just make sure nobody else runs `migrate:remote` or `deploy` concurrently.

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
