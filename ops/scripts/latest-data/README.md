# latest-data ops scripts (P2-3b)

Tools for the "latest data" deep-verification section. Step 0 (this folder's
current scope): keep a read-only, PII-redacted copy of production D1 and
prepare (never execute) the full verification plan.

> **Run `snapshot-d1-readonly.mjs` only with the owner's explicit
> authorization. It reads production.** It never writes to production, but a
> remote read of the live database is still a production action under
> `AGENTS.md`. Planning, review and test agents must not run it; the unit
> tests below never touch the network.

## `snapshot-d1-readonly.mjs` — SELECT-only production D1 snapshot

Dumps every non-FTS table in the `business-os` D1 database (the `DB` binding's
`database_name` in `cloudflare/wrangler.toml`; the test pins that they match)
to newline-delimited JSON, then rebuilds a local SQLite file from the dump.

### Usage

```bash
cd cloudflare
node ../ops/scripts/latest-data/snapshot-d1-readonly.mjs "C:\Users\<you>\Downloads\bos-snapshots\d1-snapshot-<UTC yyyymmdd-hhmmss>"
# opt in to real names/phones/addresses (secrets are still dropped):
node ../ops/scripts/latest-data/snapshot-d1-readonly.mjs --include-pii "<output-dir outside the repo>"
```

Requires `cloudflare/.wrangler-auth.local` (gitignored, per-machine; see
"One-time local setup" in `cloudflare/README.md`) so `scripts/with-wrangler-auth.cjs`
can authenticate `wrangler d1 execute --remote` without an interactive login.

### Output must be outside the repository

`assertOutsideRepo()` resolves the output path (including symlinks/junctions
and not-yet-existing tails) and **refuses, with exit code 2, any path inside
the repository** — and, when run from a linked worktree, any path inside the
main checkout too. It runs before the directory is created and before the
first remote call. The root `.gitignore` also ignores `d1-snapshot-*/` and
`*.snapshot.sqlite` as a second line of defence; only this script, its test
and this README are tracked.

### PII redaction is ON by default

With no flag, personal columns are replaced in both the `.jsonl` files and
the rebuilt `snapshot.sqlite` (which is built only from the redacted `.jsonl`)
by a token `pii_<20 hex>` = first 80 bits of HMAC-SHA256(salt, value):

- **Stable within one snapshot**: equal values give equal tokens in every
  table, so `customers.name` still joins `sales.customer_name`,
  `users.username` still joins `sale_record_events.actor_username`, etc.
- **Salt is random per run and is never written** to the output (not in the
  manifest, not in any file), so tokens cannot be reversed by dictionary from
  the snapshot alone and do not correlate across snapshots.
- `null` stays `null` and `''` stays `''`, so "has no phone" is still visible.
- Ids, amounts, dates, statuses and business names are untouched.

`manifest.json` records `"pii": "redacted"` (or `"included"`) and a
`redaction` block with per-column counts of masked/dropped values and any
column the fallback classifier had to handle.

**Secrets are ALWAYS dropped, in every mode**: a non-null value becomes
`"[dropped]#<row ordinal>"` (the ordinal keeps NOT NULL/UNIQUE constraints
of the captured DDL satisfiable in the rebuilt SQLite; no bit of the secret
survives), and inside JSON payloads the key's value becomes `"[dropped]"`.

`--include-pii` keeps real names/phones/emails/addresses, prints a loud
warning, and records `"pii": "included"`. Keep such a snapshot off shared
drives and delete it when done.

### Column map

The explicit map is `PII_COLUMNS` / `SECRET_COLUMNS` in the script. It was
built by applying every `cloudflare/migrations/*.sql` to an empty SQLite and
sweeping every table's final column list (CREATE TABLE plus later
ALTER TABLE ADD COLUMN) for person names, phones, emails, addresses, notes on
person records, IPs, device names/ids and user agents. The test re-derives
the schema the same way and fails if a column the name classifier flags is
not mapped (or listed in `REVIEWED_NOT_PII` with a reason), if a mapped column
no longer exists, or if a mapped column the classifier cannot infer is
removed.

Masked by default (kept with `--include-pii`):

| Table | Columns |
| --- | --- |
| customers | name, phone, phone_normalized, email, address, company, notes |
| delivery_contacts | name, phone, address, notes |
| suppliers | phone, email, address, contact_person, notes |
| users | username, name, phone, phone_lookup, email, google_email, google_subject |
| portal_accounts | name, phone, email |
| branches | manager |
| verification_codes | target (the phone/email a code was sent to), requester_ip |
| user_sessions | device_name, device_id, user_agent, last_ip |
| portal_sessions | user_agent, last_ip |
| trusted_devices | device_id, device_name, user_agent, first_ip, last_ip, decided_by_name |
| login_lockouts | username |
| portal_auth_lockouts | key (canonical phone) |
| rate_limit_events | client_key |
| sales | customer_name, customer_phone, customer_address, delivery_contact_name, delivery_contact_phone, delivery_contact_address, cashier_name, cancelled_by_name, stock_skipped_by_name, device_name, notes |
| returns | customer_name, cashier_name, device_name, notes |
| customer_receivables | customer_name |
| customer_share_submissions | customer_name, note, reviewed_by_name |
| contact_duplicate_dismissals | cluster_value (a phone or a name), dismissed_by_name |
| legacy_deleted_sale_items | cashier_name, deleted_by |
| audit_logs | user_name, device_name |
| ai_provider_configs | account_email, created_by_name |
| ai_response_logs | actor_user_name, actor_label |
| shift_sessions | user_name, opened_device_name, closed_device_name, closed_by_user_name, reopened_by_user_name, cancelled_by_user_name |
| sale_record_events | actor_username |
| sale_incident_recovery_receipts, sale_not_paid_stock_recovery_receipts, shift_session_amendments | actor_name |
| action_history, bulk_delete_jobs, fees, file_assets, import_jobs, loyalty_point_adjustments, rfid_scan_sessions, undo_snapshots | created_by_name |
| damaged_stock_lots | created_by_user_name |
| pending_actions | requested_by_name, reviewed_by_name |
| product_duplicate_dismissals | dismissed_by_name |
| inventory_movements, product_cost_entries, sale_amendments, stock_row_moves, stock_transfers | user_name |
| settings | value of `pos_address_presets_v1` |

Always dropped (every mode):

| Table | Columns |
| --- | --- |
| users | password, otp_secret, otp_pending_secret |
| portal_accounts | password_hash |
| verification_codes | code_hash |
| user_sessions, portal_sessions, portal_password_resets | token_hash |
| ai_provider_configs | api_key_encrypted |
| google_drive_sync_entries | upload_session_url (a resumable-upload bearer URL) |
| settings | value of any key matching the Worker's secret rule (`cloudflare/src/lib/settingsSensitive.ts`: `_refresh_token`, `_access_token`, `_secret`, `_api_key`, `_password`) or containing token/secret/password/api_key/private_key/credential — e.g. `drive_sync_refresh_token` |

Deliberately kept: `branches.name`/`phone`, `suppliers.name`/`company`
(business identities), `customers.gender`, `trusted_devices.*_country`
(coarse), membership numbers (the business's own pseudonymous card id, needed
for loyalty joins), and coordination nonces (`lease_token`,
`maintenance_token`, lifecycle-guard `token`), which are not credentials.
The brief's `verification_codes.destination` and `code_salt` do not exist in
the migrated schema; `target` is the destination column, and a
`destination`/`code_salt` column appearing in production would still be caught
by the fallback below.

**Fallback (defence in depth).** Any column not in the map — a
production-only table such as `latest_data_source_links`, or a future
migration — is classified by name: `*phone`, `*email`, `*address`,
`*_by_name`, `*user_name`, `*device_name`, `*user_agent`, IP names,
`device_id` are masked; `*password*`, `*secret*`, `*token_hash`, `*code_hash`,
`code_salt`, `*api_key*`, `*refresh_token`, `*access_token` are dropped. The
same rules are applied **key by key inside every JSON-valued column**
(`audit_logs.old_value/new_value/details`, undo/redo payloads, `*_json`
receipts, import source rows...); a bare `name`/`company`/`notes` inside a
JSON object is masked when that object also has a person marker
(phone/email/address/username/membership_number). JSON is re-serialized only
when something in it changed.

**Known limits.** Person names inside free text (labels, reasons, error
messages, Khmer-keyed import rows) cannot be detected reliably and are not
masked. Digests stored beside a redacted JSON payload (e.g.
`request_digest`) will no longer re-verify against the redacted payload.

### What it does, in order

1. Refuses an in-repo output path (above), then probes with `SELECT 1`.
2. Enumerates tables via `SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`.
3. Splits tables into:
   - **FTS-family** (name contains `_fts`): **not dumped**; only
     `{ name, row_count }` is recorded in the manifest.
   - **Everything else**: dumped in full, except tables the D1 HTTP API
     refuses direct reads on (observed for `_cf_KV`:
     `not authorized: SQLITE_AUTH [code: 7500]`), which are recorded in
     `inaccessible_tables` and skipped.
4. Per table: `COUNT(*)` before, page through `SELECT * FROM "<table>" ORDER BY
   rowid LIMIT 1000 OFFSET n` (no `ORDER BY` only if rowid ordering fails,
   e.g. `WITHOUT ROWID`), `COUNT(*)` after; differing counts go to `drift`.
5. Redacts the rows in memory, then writes `<table>.jsonl` and `manifest.json`
   (`captured_at_utc`, `captured_at_ict` in the fixed business timezone
   Asia/Phnom_Penh, ICT, UTC+07:00, no DST — never "Bangkok" — `pii`,
   `redaction`, `wrangler_version`, `database_name`, per-table
   `{ name, columns, count_before, count_after, rows_dumped, file, sha256 }`,
   `fts_family_tables`, `inaccessible_tables`, `totals`, `drift`).
6. Rebuilds `snapshot.sqlite` from each table's captured `CREATE TABLE` DDL
   and the redacted `.jsonl` rows, verifying `COUNT(*)` per table; records
   orphaned FKs in `manifest.fk_violations` (informational). Uses
   `better-sqlite3` from `cloudflare/node_modules` when present, otherwise the
   built-in `node:sqlite` (Node >= 22.5).
7. Makes `snapshot.sqlite` read-only (`attrib +R` on Windows, `0444` elsewhere).
8. Writes `SHA256SUMS` covering every file in the output directory.

Rate limiting: a 260 ms pause after every remote call (≤4 requests/second).

### Guardrails / what it refuses to do

- Every remote statement goes through `d1()`, which calls `assertSelect()`
  before the runner sees the SQL: anything not starting with `SELECT`, any
  `;` followed by more content, or any INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/
  REPLACE/ATTACH/DETACH/PRAGMA/VACUUM/REINDEX/LOAD_EXTENSION keyword throws.
- No `--local` execution against shared wrangler state, no `--file`, no
  migrations, no writes of any kind to the remote database.
- Output only outside the repo; PII masked unless `--include-pii`; secrets
  always dropped.

### Tests

```bash
node ops/scripts/latest-data/snapshot-d1-readonly.test.mjs
```

Pure node (needs Node >= 22.5 for `node:sqlite`), no network. It imports the
real `assertSelect`, `createD1`, `assertOutsideRepo`, `createRedactor` and
`main()` from the tool, rebuilds the migrated schema locally, and runs the
real `main()` end to end against that local database through a fake runner
(default and `--include-pii`), checking the `.jsonl`, `manifest.json` and
`snapshot.sqlite` for leaked values, leaked secrets and the salt.

### Verifying a snapshot after the fact

```js
const Database = require('better-sqlite3') // resolve from cloudflare/node_modules
const db = new Database('<output-dir>/snapshot.sqlite', { readonly: true })
db.prepare('SELECT COUNT(*) AS c FROM products').get()
```

Recompute and diff `SHA256SUMS` to confirm the on-disk files were not altered
after capture.
