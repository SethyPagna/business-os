# Migrations for more than one client

Decided 22 Oct 2026: one clean codebase deploys uniformly to every client. The first client (Leang) is on
its own Cloudflare account; every later client is on a separate one. A fix to one client's data never goes
through the shared code; it runs per account.

The shared chain (`cloudflare/migrations`, 215 files through 0269) was written for the first client.
Replayed on an empty database it leaves that client's loyalty shutdown behind, and on a populated database
of another client several files rewrite data on first apply. Until 22 Oct 2026 it also left that client's
organization name (0030) and 4,240 of its expense rows (0064), and stopped at 0098 on D1 (see the last section). This page is the rule that stops that growing, and the way a new client avoids it.

## The three classes

Every file is classified in `cloudflare/migrations-manifest.json` with its sha256 and a one-line reason.

| Class | Meaning | Files 0001-0269 |
|---|---|---|
| `SCHEMA` | DDL only: tables, indexes, triggers, views, FTS, guard selects. No INSERT, UPDATE, DELETE, REPLACE. | 137 |
| `GENERIC-DATA` | Writes rows by a rule that is correct on any database: derived-column backfills, table rebuilds that copy rows, schema-invariant reconciliations, defaults inserted only if absent. | 57 |
| `CLIENT-SPECIFIC-DATA` | Carries one client's rows, ids or names, or rewrites a populated database by a decision only that client made. Legacy only. | 21 |

`SCHEMA` means no row is written, and the test checks it both ways: a file that writes rows cannot be
`SCHEMA`, and a file that writes none cannot be `GENERIC-DATA`. The 21 client-specific files are
pinned by number in the test; reclassifying one is an edit to that list.

## Shared migrations from 0270 on

They are `SCHEMA` or `GENERIC-DATA`. `CLIENT-SPECIFIC-DATA` is refused outright from 0270.

To add a migration, add the file and its manifest entry in the same commit. The test prints the exact
entry to paste (name, sha256, class, reason) when one is missing. Once merged, the bytes are frozen:
the sha256 makes editing or deleting an applied migration a red test. Changing an applied file changes
nothing on a database that already applied it (and 0243 and 0258 are also pinned by the deploy kit); add a
new migration instead. The one owner-approved exception is described in the last section.

`cloudflare/scripts/test-migration-client-neutral-pure.cjs` runs the lint on every file numbered 270
or later:

| Rule | Refuses |
|---|---|
| `literal-id` | An integer literal of 1000 or more in a WHERE, ON, HAVING, WHEN, an IN list, a BETWEEN or a VALUES list of a data statement. |
| `pinned-id` | An id column (`id`, `*_id`) compared with `=` or `IN` to a literal id of any size. 0164 and 0183 pin ids below 1000. Added beyond the 1000 threshold: it fires on none of the 191 legacy files that are not client-specific. |
| `literal-rows` | An INSERT whose rows are literals (VALUES, or a FROM-less SELECT), or another write that carries two or more literal rows, also inside a CTE or a UNION ALL. Stricter than "multi-row": 0030 seeds one row, an organization. `settings` and `system_flags` may take several default keys in one insert-if-absent statement. |
| `unconditional-write` | UPDATE or DELETE with no WHERE (or `WHERE 1`), `REPLACE INTO`, `INSERT OR REPLACE`, `ON CONFLICT DO UPDATE` with no WHERE. A backfill needs a real predicate such as `WHERE col IS NULL`. |
| `check-literal-id` | A CHECK in CREATE TABLE or ALTER that names a literal id (`col = 16951`, `col IN (...)`). Bounds such as `<= 65536` are fine. |
| `denylist` | Any literal from the client deny-list anywhere in the file, comments included. |
| `class-understated` | A file declared `SCHEMA` that writes rows. |

Strings, comments and quoted identifiers are skipped, so an id inside a comment or a string is not a
finding. Triggers, views and indexes are schema: only `pinned-id` is checked in them (a guard that names one row is
pinned data), because their bodies legitimately carry large numeric bounds.

**What the lint cannot see.** A policy rewrite with an honest-looking WHERE passes every rule:
0072, 0099, 0110, 0111, 0117, 0166 and 0178 all do, and the test pins them as the seven the lint is
blind to. The class gate and the review of each reason line are the other half. A `GENERIC-DATA`
reason has to say why the statement is correct on a database that is not the client the file was written for.

**Exemptions.** A file numbered 270 or later may list `exemptions: [{ "rule": "...", "reason": "..." }]`
in its manifest entry, for example the singleton settings row whose id is 1 on every client. The reason
must be at least 20 characters, `denylist` and `class-understated` cannot be exempted, and an exemption
silences only its own rule. There are none today.

**Deny-list.** Names of other clients must never be committed. The lint reads them at run time from
`BOS_CLIENT_DENYLIST` (comma or newline separated) or from `cloudflare/scripts/.client-denylist.local`
(gitignored; one term per line, `#` comments, or point `BOS_CLIENT_DENYLIST_FILE` elsewhere). In CI the
list is empty unless the gate supplies it. Run it locally before proposing a migration.

## Client repairs live outside the shared repo

A one-time repair for one client (merge these suppliers, mark those invoices paid, renumber memberships)
is not a migration. It lives with that client, outside this repository, and runs against that client's
account through the approved ops route, with pre and post assertions and a recorded recovery bookmark.
It is never recorded in `d1_migrations`. Settings that differ per client (loyalty, membership prefix,
branch names, business name) come from the client's configuration, not from a migration.

## Provisioning a new client

The chain is not used for a new client's database. The chain can build one from empty (that is the
disaster-recovery path, `cloudflare/scripts/test-fresh-d1-chain-native.cjs`), but its 21 client-specific
files would still leave the first client's loyalty shutdown behind. A new database gets the schema baseline and
a ledger stamp, and then only the migrations numbered 0270 and later run on it.

1. Create the empty D1 database in the client's own Cloudflare account.
2. Rehearse once on a throwaway D1 database in that account (create, provision, verify, delete). The
   baseline is proven on local SQLite and against the installed wrangler's local runner, not yet on D1.
3. Apply `cloudflare/baseline/schema-0269.sql`: 159 tables (the nine FTS5 virtual tables create their own
   shadow tables), 208 indexes and 220 triggers, then the three seed rows below. It contains no business row.
4. Stamp `d1_migrations` with the 215 file names 0001 to 0269, in file order.
5. Verify the `sqlite_master` fingerprint equals the baseline's, the ledger count is 215, and every
   business table is empty.
6. `wrangler d1 migrations apply` now sees 0270 and later as the only pending files.

Locally, one command does 3 to 5 and refuses anything but an empty database:

```
node ops/scripts/client/provision-database.mjs --local <file.sqlite>
```

For a real D1 database the same script prints the plan and runs nothing:

```
node ops/scripts/client/provision-database.mjs --remote --database <name> [--config <wrangler.toml>]
node ops/scripts/client/provision-database.mjs --emit-stamp-sql          # the stamp as SQL
node ops/scripts/client/provision-database.mjs --verify-schema-json <f>  # compares a saved read-only export
```

Every step it prints is marked READ or WRITE. A WRITE is a production change and needs the owner's explicit
approval in that account. The baseline goes in with `wrangler d1 execute --remote --file`, which uploads the
whole file and lets D1 parse it. Do not apply it with `wrangler d1 execute --local --file`: the local
splitter in wrangler 4.116.0 turns the 590 statements into 353 pieces and strips the comments from 13 objects,
so the stored schema text no longer equals the chain's (the fingerprint check then fails). Locally use the
script above.

**The only seeded rows** are three `system_flags` constants. They are what 0243 and 0250 install on any empty
database, and the stock triggers refuse every stock write without the first:

| Key | Value | Why |
|---|---|---|
| `stock_schema_epoch` | `legacy-separate-pool-v1` | the triggers compare it with the transaction permit; absent, `stock_transaction_required` |
| `stock_schema_receipt_boundary` | `0` | MAX(stock_mutation_receipts.id) on an empty database |
| `multilot_revert_watermark` | `0` | MAX(inventory_movements.id) on an empty database |

**Not seeded, and why.** The organization (0030) is not needed: the runtime creates the configured organization,
group and branch itself. `user_aliases` (0103) bind the first client's staff names. The
loyalty switch (0179, 0251) is its shutdown: with no `loyalty_points_enabled` setting the triggers and
`loyaltyPointsEnabled()` already read "off", so a new client starts with loyalty off without any row. Whether that
is the right default for a new client is the owner's call. The two shift defaults (0118) equal the code defaults
and need no row. The built-in roles and their permissions (0024, 0172, 0259 only add keys to roles that already
exist) are created by the runtime from `DEFAULT_ROLE_PERMISSIONS`, and 0032 backfills lots for products that do
not exist yet, so none of the five leaves anything for a baseline to carry.

**Residue the baseline keeps on purpose.** The baseline is the schema the chain produces, so a fingerprint
comparison with the first client's database holds. That schema carries two things of the first client's that hold
no data: one trigger (`trg_legacy_inventory_effect_apply`) writes the literal user name `Old system`, and two tables
(`sale_incident_recovery_members`, `sale_not_paid_stock_recovery_members`) have CHECKs naming pinned sale ids.
They are dead on any other client. The test pins this list so it cannot grow unnoticed.

## Why the first client's existing history needs no change

The ledger tracks file names, not content. Its database already holds 0001 to 0269 in `d1_migrations`;
nothing there is re-run or renamed.

Three applied files were edited on 22 Oct 2026, owner-approved, so the chain builds a new D1 again and carries
none of the first client's rows. 0098 lost its seed of that client's cashier nicknames, whose 7-term compound
SELECT stopped every new D1 (D1 allows 5; the seed inserted nothing there anyway, as users is empty while
migrations run). 0064 lost the 4,240 expense rows and keeps a no-op `SELECT 1`. 0030 seeds a neutral
organization that the runtime renames (`leang-cosmetics` joined PREVIOUS_IDENTITIES for databases built
before). The original files are kept byte for byte in that client's private data pack, outside this repository. The manifest and the
baseline are additions. The baseline is the same schema its chain produced (the test replays the chain and
compares the fingerprint), so a new client and the first client differ only in their rows. The first client keeps
applying 0270 and later exactly as before. The 21 remaining client-specific files stay in the chain because removing them
would break the sha pins and every test that reads them.

## Keeping the baseline honest

- `node ops/scripts/client/build-baseline.mjs --check` fails if the file on disk is not what the current chain
  produces. Rebuilding is the same command without `--check`. The baseline is frozen at 0269 and never needs a
  rebuild unless a file numbered 0269 or lower changes, which the sha256 forbids. The 22 Oct 2026 edits
  changed no schema: only the baseline's chain-digest line moved.
- A later baseline (for example `schema-0300.sql`) is cut the same way: set `DEFAULT_THROUGH` in
  `cloudflare/scripts/harness/client_baseline.cjs` and `baselineThrough` in the manifest together, then rebuild.
- The release gate runs four tests: `test-migration-client-neutral-pure.cjs` (manifest, lint, positive controls,
  calibration on the 215 existing files), `test-client-baseline-provision-pure.cjs` (baseline equals the chain minus
  data, provisioning, refusal of non-empty databases, baseline + stamp + a dummy 0270 equals chain + 0270),
  `test-migration-fresh-chain-rows-pure.cjs` (the exact rows the chain leaves on an empty database, and that the
  baseline leaves none of them) and `test-client-baseline-wrangler-native.cjs` (the installed wrangler's own
  `migrations list` and `apply --local` accept the stamp and run only 0270).
- `test-fresh-d1-chain-native.cjs` replays both chains (including `cloudflare/migrations-import`) on workerd,
  which enforces D1's 5-term compound SELECT limit, then boots the real Worker as a new client and as the first
  client's rebuild. `--wrangler` runs the real `wrangler d1 migrations apply --local` instead (5 to 10 minutes).
- The baseline does not cover the import database (`cloudflare/migrations-import`, one staging migration).
