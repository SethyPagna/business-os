# latest-data ops scripts (P2-3b)

Tools for the "latest data" deep-verification section. Step 0 (this folder's
current scope): keep a read-only copy of production D1 and prepare (never
execute) the full verification plan. See
`docs/plans/latest-data-verification-plan.md` for the plan itself.

## `snapshot-d1-readonly.mjs` — SELECT-only production D1 snapshot

Dumps every non-FTS table in the `business-os` D1 database to newline-delimited
JSON, then rebuilds a local SQLite file from the dump for easy querying.
**Every remote statement it issues is asserted to start with `SELECT` before
it is ever sent to wrangler** — `assertSelect()` throws on anything else
(INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/REPLACE/ATTACH/DETACH/PRAGMA/VACUUM/
REINDEX keywords, or a `;` followed by more content). See
`snapshot-d1-readonly.test.mjs` for the guard's unit tests.

### What it does, in order

1. Probes the auth wrapper with a harmless `SELECT 1`.
2. Enumerates tables via `SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`.
3. Splits tables into:
   - **FTS-family** (name contains `_fts`, e.g. `products_fts`, `products_fts_idx`,
     `products_fts_code_data`): **not dumped**. Only `{ name, row_count }` is
     recorded in the manifest, per the brief.
   - **Everything else**: dumped in full — *except* any table the D1 HTTP API
     itself refuses direct reads on (observed for `_cf_KV`, a Cloudflare/D1
     internal table that is enumerated in `sqlite_master` but rejects even
     `SELECT COUNT(*)` with `not authorized: SQLITE_AUTH [code: 7500]`). Such
     tables are recorded in `manifest.json`'s `inaccessible_tables` array
     (`{ name, error }`) and skipped, not treated as a script bug. Every
     other non-FTS table, including the D1-managed `d1_migrations` (104
     rows, confirmed readable), dumps normally.
4. For each dumped table: `COUNT(*)` before, page through `SELECT * FROM
   "<table>" ORDER BY rowid LIMIT 1000 OFFSET n` (falls back to no `ORDER BY`
   only if `rowid` ordering itself fails, e.g. a `WITHOUT ROWID` table),
   `COUNT(*)` after. If the two counts differ, the table is marked in
   `manifest.json`'s `drift` array (it is still fully paged; the note flags a
   possible torn read against a live table).
5. Writes `<table>.jsonl` (one JSON object per line) and a `manifest.json`
   with `captured_at_utc`, `captured_at_ict` (the same instant in the app's
   fixed business timezone, Asia/Phnom_Penh, ICT, UTC+07:00, no DST — decision
   20: "everything is Cambodian" — see `cloudflare/src/lib/businessDateWindow.ts`;
   never call this zone "Bangkok"), `business_timezone`, `wrangler_version`,
   `database_name`, per-table `{ name, columns, count_before, count_after,
   rows_dumped, file, sha256 }`, `fts_family_tables`, `inaccessible_tables`,
   `totals`, and `drift`.
6. Rebuilds `snapshot.sqlite` in the output directory: recreates each dumped
   table from its captured `CREATE TABLE` DDL (from `sqlite_master.sql`) and
   inserts every row from the `.jsonl` file, verifying `COUNT(*)` matches
   `rows_dumped` per table. Uses `better-sqlite3` resolved via the
   `cloudflare/node_modules` junction into the main checkout (read-only use
   of the module; nothing is written back to that junction).
7. Sets `snapshot.sqlite` read-only (`attrib +R` on Windows).
8. Writes `SHA256SUMS` covering every file in the output directory.

Rate limiting: a 260 ms pause after every remote call, comfortably under the
"≤4 requests/second" gentleness rule in the brief; wrangler's own CLI
start-up overhead already dominates in practice.

### Usage

```bash
cd cloudflare
node ../ops/scripts/latest-data/snapshot-d1-readonly.mjs "C:\Users\mrkl6\Downloads\bos-rc-workers\d1-snapshot-<UTC yyyymmdd-hhmmss>"
```

The output directory is created if missing. It is **never** inside the repo
and is **never** committed — only this script, this README, and the
verification plan doc are tracked in git.

Requires `cloudflare/.wrangler-auth.local` (gitignored, per-machine; see
"One-time local setup" in `cloudflare/README.md`) so `scripts/with-wrangler-auth.cjs`
can authenticate `wrangler d1 execute --remote` without an interactive login.

### Guardrails / what it refuses to do

- Only ever issues `SELECT` statements remotely (unit-tested in
  `snapshot-d1-readonly.test.mjs`, run with plain `node`).
- No `--local` execution against shared wrangler state, no `--file`, no
  migrations, no writes of any kind to the remote database.
- Does not touch `frontend/`, `cloudflare/src`, or any tracked data file.
- Output lives entirely outside the repo.

### Verifying a snapshot after the fact

```js
const Database = require('better-sqlite3') // resolve from cloudflare/node_modules
const db = new Database('<output-dir>/snapshot.sqlite', { readonly: true })
db.prepare('SELECT COUNT(*) AS c FROM products').get()
```

Compare `manifest.json` totals against `SHA256SUMS` (recompute and diff) to
confirm the on-disk files were not altered after capture.
