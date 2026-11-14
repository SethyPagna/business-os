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

## Release without Claude

The owner can run a whole release alone. Click-by-click setup (Cloudflare
token, GitHub button, VPN split tunnel):
[docs/setup/release-setup-guide.md](docs/setup/release-setup-guide.md).

**VPN tip.** Cloudflare challenges the VPN's datacenter exit, so neither
wrangler nor the site's `/api` works through it. Set the VPN to "only allow
selected apps" (Claude, ChatGPT, Copilot, Chrome) and run the menu from a
Windows Terminal opened from the Start menu, not from inside Claude or
Chrome: anything those apps start inherits the VPN. Use Edge for the
Cloudflare and GitHub dashboards.

### The menu: `run\release.bat`

```powershell
run\release.bat                     # the menu
run\release.bat release             # the whole release in order
run\release.bat -DryRun             # walk every menu item, print every command, run none
run\release.bat deploy -Plan free   # any single step, with options
```

Implementation: `ops/scripts/deploy-kit/release.cjs` (the steps), `exec.cjs`
(every child process, the prompts, the log) and `lib.cjs` (every production
command with its confirmation gate). Checked offline by
`cloudflare/scripts/test-deploy-kit-pure.cjs`.

1. **Network check.** GETs `https://api.cloudflare.com/client/v4/ips` and
   `/health`. A `cf-mitigated: challenge` header or a "Just a moment..."
   page means this window goes through the VPN. The kit never tries to get
   past a challenge.
2. **Choose version.** Default `claude/urgent-20260925`. The commit is
   checked out into a dedicated clean worktree (`<home>\Worktrees\release`;
   `-Worktree` changes it), with `npm ci` in both packages. It refuses the
   main checkout, the checkout the kit runs from, any worktree with a branch
   and any recovery folder. It stops if the folder is not clean at exactly
   that commit (checked again before the deploy, after the build).
   `<home>` is `BUSINESS_OS_HOME`, else the folder that holds the main checkout.
3. **Tests at that commit.** Cloudflare typecheck plus every
   `scripts/test-*.cjs` in its own process; frontend typecheck,
   `verify:i18n` and build plus every `tests/*.test.ts` and
   `tests/*.test.cjs` in its own process.
   A red file is retried alone up to twice (timeouts, contention). Anything
   still red stops the release and is listed.
   **Skipping the tests** is offered only when Claude has certified the exact
   commit: a file `<home>\Records\Deploys\certs\release-cert-<full 40-character
   sha>.txt` that contains a line `sha: <the same full sha>`. Claude writes it
   after running the full gate on that commit, with the gate results in the
   same file. A short sha or a mismatched line is ignored.
4. **Login check.** `wrangler whoami` through
   `cloudflare/scripts/with-wrangler-auth.cjs`. If not logged in, the owner
   runs `npx wrangler login` in the release folder's `cloudflare`. The kit
   uses the saved token of the first checkout that has one (`-AuthFrom`, then
   the kit's own checkout, then the main checkout). It only checks that the
   file exists; the wrapper reads it. The kit never opens or copies it.
5. **Safety snapshot** (asks y). The Time Travel bookmark of both databases,
   the live Worker version, and the row counts of products, branch_stock,
   product_batches, sales, sale_items, inventory_movements, customers and
   returns, saved to `<home>\Records\Deploys\<date>-<sha12>\`. It prints the
   restore commands.
6. **Database updates.** Lists the waiting migrations of BOTH databases
   (`business-os` via `migrate:remote`, `business-os-import` via
   `migrate:import:remote`) with each file's first comment line, asks for
   **YES**, and applies them in that order. On the first error it stops,
   saves `migration-error.txt` and prints the recovery note.
7. **Publish** (asks **YES**). `npm run deploy` (paid, the production plan)
   or `npm run deploy:free`; both stamp the commit into the bundle. Secrets
   are not synced: they already live on Cloudflare.
8. **Live checks.** `/api/runtime/version` must report the commit with a
   clean stamp, and the plan. `/health` must say ok (it carries an app label,
   not the commit). The admin page must load. Then, through the Cloudflare
   API (which the site's bot challenge does not cover), the live Worker
   version must be the one this release published. When the site challenges
   the caller (GitHub's runner always is), that API read is the only proof:
   in CI an unconfirmed version fails the run; at a keyboard it is a warning.
   Any warning ends the step with "passed with N warning(s)", never a bare
   pass. Then the row counts again: a
   table that shrank with no migration touching it fails; tables a migration
   changes, and till tables that only grew during the release, are warnings.
9. **Undo** (each asks YES, then a second word). `wrangler rollback` to the
   saved previous version, or a D1 Time Travel restore to the saved bookmark,
   which loses every write made since.
10. **Also:** the product-list export for official names (the public
   catalogue search, pageSize 100, saved to
   `<home>\Records\OfficialNames\<date>\products.json`); the R2-to-Asia steps
   (printed from the local plan; the kit runs no R2 command); `verify-local.bat`;
   and the old `full-automation.bat`.

Every run writes a full transcript (`release-<time>.log`) and `state.json`
into the deploy record folder, and prints the path at the end.

### The GitHub button: `.github/workflows/deploy.yml`

Manual only (`workflow_dispatch`), with `environment: production` (required
reviewer), `concurrency: production-deploy` and `contents: read`. The
`confirm` input must be `DEPLOY`. It runs the same kit with `-CI`: the same
tests (with no Cloudflare secret in that step), the snapshot, the migrations
(unless `run_migrations` is off), the deploy and the live checks. The
repository is public, so the job summary holds bookmarks, ids and row-count
verdicts only (never table sizes), and the output of the production reads
stays out of the log. Secrets
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are passed through `env:`
only. With no saved token file, `with-wrangler-auth.cjs` passes the
environment token through. To undo, use `.github/workflows/deploy-rollback.yml`
(confirm `ROLLBACK`).

#### Fast path: deploy on a gate run that already passed

The full test sweep is the slow part, so it is run once, in parallel, by
`.github/workflows/gate.yml`, and Deploy can reuse that result instead of
repeating it.

1. Run **Gate** with `ref` set to the **full 40-character commit id** you will
   release (not a branch name). It plans that one commit, runs the typechecks and
   build in a "Static checks" job, splits every test file over 8 parallel Windows
   shards by a stable hash (each file in its own process, retried on timeout as
   before), runs the browser suite, and finishes with a "Verdict" job. The verdict
   job fails unless every shard reported green at that commit and the shards'
   union is the full test file list; it then writes the `gate-verdict` artifact.
   The run title is `Gate <ref>`. The merged log artifact is `gate-records`
   (one folder per job: `Deploys/<date-sha>/release-*.log` and `state.json`).
2. Run **Deploy** with the same full commit id as `ref` and the Gate run's number
   (the digits at the end of its URL) as `gate_run_id`. Deploy then checks, through
   the GitHub API, that the run is `gate.yml` of this repository, was started
   manually from this repository, finished with every job `success` (the browser
   suite included, even when it was report-only), is under 7 days old, tested
   exactly the commit Deploy checked out, ran the same test file set that commit
   has, and ran with a compatible release kit (same kit commit, or a gate workflow
   and `ops/scripts/deploy-kit/` that are byte-identical). Any failed check stops
   the deploy with the reason; nothing falls back to something weaker. If every
   check passes, Deploy skips only the repeat sweep: it still builds the app it
   publishes (without a Cloudflare secret), then runs the snapshot, migrations,
   publish and live checks unchanged, and keeps the gate evidence with the
   encrypted release records.
3. Leave `gate_run_id` empty and Deploy runs the full sweep itself, exactly as it
   always did.

The release kit is the `kit/` checkout of the ref the workflow is run from
("Use workflow from"), so changing `ops/scripts/deploy-kit/` or `gate.yml`
changes every later deploy from that ref. A gate run made from a different kit
commit is accepted only when both are byte-identical, as above.

## Free vs paid deploy

This repo ships **two** wrangler configs for the **same** Worker:

| | config | deploy command | one-command release |
| --- | --- | --- | --- |
| Workers **Paid** (current) | `cloudflare/wrangler.toml` | `npm run deploy` / `npm run deploy:full` | `run\full-automation.bat` |
| Workers **Free** | `cloudflare/wrangler.free.toml` | `npm run deploy:free` / `npm run deploy:full:free` | `run\full-automation.bat -Plan free` |

They are not two environments and not two Workers: same Worker name, same D1
database ids, same R2 bucket, same KV namespace, same queues, same Durable
Objects, same routes, same crons. Exactly one of them is deployed at a time,
and deploying the other one replaces it. Nothing about your data moves.

### What actually differs

Four things, each marked `DIFF n of 4` at its site in `wrangler.free.toml`:

1. **No `[limits]` block.** `cpu_ms` / `subrequests` are Paid-only keys;
   a config carrying them fails a Free deploy outright with error 100328.
   This single incompatibility is the reason the second file exists.
2. **`business-os-import` consumer `max_batch_size` 5 -> 1.**
3. **`business-os-media` consumer `max_batch_size` 5 -> 1.**
   Both consumers do real per-message CPU inside one invocation, and Free
   budgets 10 ms of CPU per *invocation*, so a batch of 5 repacks five
   chunks of work into one budget.
4. **`[vars] PLAN_TIER` `"paid"` -> `"free"`.**

`cloudflare/scripts/test-wrangler-config-drift-pure.cjs` fails if any other
key drifts between the two files, in either direction. Edit `wrangler.toml`
and you edit `wrangler.free.toml` in the same commit; that test is how you
find out you did not.

### What `PLAN_TIER` changes inside the app

`cloudflare/src/lib/planTier.ts` reads `PLAN_TIER` (through
`resolvePlanTier`) and holds a Free table and a Paid table of plan-sized
numbers. It resolves the tier once per isolate and hands each call site its
limit as `getPlanLimits(env).<field>`. The tables hold: import chunk rows,
import preflight rows, stock-action units and rows, historical-sales
concurrency, bulk-delete chunk size, backup asset count, whether the 6-hourly
scheduled backup runs at all, images deleted per reset, import-job retention
depth, ephemeral delete batch, the catalog integrity scan ceiling, stock-in
lines per request, D1 queries per invocation (50 on Free, 1000 on Paid), the
storefront AI chat budgets, and two cache lifetimes. Free is smaller on every
ceiling; the two lifetimes run the other way (Free keeps them longer, to read
fewer rows). The tables also record D1's daily row limits and maximum database
size as reported facts, plus one stock-action concurrency number; no code reads
those four yet, so changing them does nothing.

It is **not** the only place. `lib/branchCutoverOperator.ts` still reads
`PLAN_TIER` itself, and other plan-sized numbers still sit as plain constants
in the files that use them (import windows, report and export page sizes, the
Inventory Check cap, stock-session and merge limits, the quota table in
`lib/quotaGuard.ts`, audit-retention batch sizes, and more). The rule is that
every one of them moves into `planTier.ts`. Until it does,
`cloudflare/scripts/test-plan-literals-pure.cjs` lists the ones it can detect
and fails when a new one appears, or when a cleanup leaves its entry behind. It
cannot see a bare constant with no plan marker, so a clean run is not a
complete inventory.

**To change a limit that is in the table:** edit the Free or Paid table in
`planTier.ts`, update the same number in `scripts/test-plan-tier-pure.cjs` (it
pins both tables), and deploy. For a limit that is not in a table yet, add a
field to both tables with its reader rather than editing the constant.

Two operations are **refused** on free rather than run in a degraded shape,
because a half-done version of either is worse than not starting:

- the automatic 6-hourly **scheduled backup** (retention still runs; manual
  backups still work),
- **reset with images**, which would otherwise delete part of the R2 files
  and stop at the subrequest ceiling.

An unset or unrecognised `PLAN_TIER` resolves to **paid**. That is deliberate:
the default must be the configuration that has been running in production, so
a config that forgot the var does not silently halve every ceiling.

### Where to see which one is live

- `GET /api/runtime/version` -> `tier`
- `GET /api/system/integration-doctor` -> `item.runtime.tier` (and
  `item.runtime.quotas`, whose ceilings are themselves per-plan)
- `GET /api/auth/bootstrap` -> `system.runtime.plan`

### Switching plans

1. Change the account plan in the Cloudflare dashboard first. The config is
   not what puts the account on a plan; it is what survives being on one.
2. Deploy the matching config (`run\full-automation.bat -Plan free`, or
   `npm run deploy:free`). `-Plan` changes **only** the deploy step: the
   gate, the frontend build, both remote D1 migrations and the secret sync
   are identical either way.
3. Confirm with `/api/runtime/version`.

Going back to paid is the same run without `-Plan` (or with `-Plan paid`).

### Known free-plan limits this does NOT solve

- **D1 writes.** Free allows 100k rows written per day. A bulk historical
  re-import is well above that; split it across days or do it on paid.
- **D1 size.** Free caps a database at 500 MB (paid: 10 GB). Check the live
  size before switching.
- **Nothing here is measured on a real free account.** The numbers in
  `planTier.ts` are sized from Cloudflare's published ceilings, deliberately
  conservative, not from a profiled free deployment.

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

The release menu's **Undo a release** (or the GitHub **Deploy rollback**
workflow) does both kinds of undo behind a double confirmation; see
"Release without Claude".

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

### Telegram automation

Telegram automation stores only the destination chat ID and category switches
in Business OS Settings. The bot token remains a Worker secret and is never
sent to the browser:

```sh
cd cloudflare
wrangler secret put TELEGRAM_BOT_TOKEN
```

Create the bot with BotFather, start a direct chat with it (or add it to the
target group), then get the chat ID from Telegram's `getUpdates` response.
After deployment, go to **Settings → Telegram automation**, enter and save the
chat ID and use **Send test message**. Automation, sales/new receipts,
receipt status changes, fees, stock in, and stock out are enabled by default;
each category can still be turned off in Settings.

#### Owner / manager report commands

The bot also answers `/today`, `/sales`, `/fees`, `/inventory`, `/stock`, and
`/help` in the same configured Telegram chat. No second secret, chat ID list,
or command setup is needed: **Send test message** connects the verified
Telegram webhook automatically using a secret derived inside the Worker from
the bot token.

The configured Telegram chat is the command permission boundary. Use a direct
owner chat or a manager-only Telegram group. Do not use a general staff alerts
group as the configured chat, because every member of that group could read a
manager's command response.
