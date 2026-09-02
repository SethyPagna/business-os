# Legacy cashier identity reconciliation — id is the source of truth

**Status: PREPARED + VERIFIED, NOT YET APPLIED to remote D1.** Every D1 call
made while preparing this was read-only (`rows_written: 0`). Applying the
migrations to production is a deliberate, gated step (see *How to apply*).

## The problem

Cashier attribution across the migrated data was broken end to end:

- **0** sales had a non-null `cashier_id` — the id linkage was never populated.
- `importEngine.ts` built its cashier lookup from **active `users.name` only** —
  never `username`, never inactive users, never the legacy nickname — so none of
  Aza / Rath / Sethyka / Dev-Usmart ever linked.
- The Aug-30 import matched the nickname with `username === 'aza'`, but the real
  username is **`Za`**, so all 40 Aug-30 sales landed with `cashier_id = NULL`
  and the raw string `cashier_name = 'Aza'`.
- The first Aug-31 implementation assigned all 14 receipts to Rath. A
  multi-report reconciliation shows `report-user-31st` is a per-user summary:
  its $146 gross sale equals receipts 4377–4381 exactly. Receipts 4382–4390
  have no cashier evidence and remain unlinked as `Old system`.

The fix the user asked for is broader than cashiers: **an account's id is the
source of truth, and renaming a username must propagate through the whole
system automatically** — "this applies to conflict, to everything, not just
users."

## Canonical mapping

| legacy cashier | → user id | resolves via |
|---|---|---|
| Aza | 3 (`Za`) | **alias** `aza → 3` (nickname ≠ username) |
| Sethyka / Pagna | 2 (`james`) | **reviewed aliases**; alias precedence intentionally overrides the inactive `sethyka` username |
| Rout / Routh / Rath | 4 (`Rath`) | reviewed aliases plus direct username |
| Super Admin / Dev-Usmart | 1 (`admin`) | reviewed aliases |

The **display name is the username**; the `cashier_id` FK is the durable link.

## Verified live state (read-only, 2026-09-02; before this correction)

| cohort | finding |
|---|---|
| `sales WHERE cashier_name='Aza'` | **40** rows, **all** `cashier_id IS NULL` (the Aug-30 cohort) |
| `sales` Aug-31 (4377–4390) | **14** exact legacy-request rows exist; all are currently attributed to Rath. Only 4377–4381 are evidenced, so 4382–4390 require guarded reset to `NULL` / `Old system`. |
| Aug-31 sale movements | All 20 movement rows are still `NULL` / `Old system`; the five evidenced receipts require Rath attribution and the remaining nine are already correct. |
| `legacy_deleted_sale_items` | **2,234** rows: Aza 2,220 / Sethyka 7 / Dev-Usmart 5 / Rath 2 |
| `legacy_deleted_sale_items.cashier_id` | column **did not exist** (name only) |

## What changed (committed, not applied)

Code (root cause) — commit `1378e07a`:
- `cloudflare/src/lib/importEngine.ts` — cashier map now keys on **both**
  `lower(username)` and `lower(name)` over **all** users (incl. inactive),
  keeps the ambiguous-key → `null` rule, and falls back to `user_aliases`.
- `cloudflare/src/lib/userIdentity.ts` (new) — `cascadeUserRename(db, id,
  username)` rewrites every **id-linked** denormalized user-name snapshot
  (14 tables: sales/returns cashier, inventory/transfer user, the `created_by`
  family). **Excludes `audit_logs`** (point-in-time history must not change).
- `cloudflare/src/routes/users.ts` — calls the cascade from `PUT /users/:id`
  and `PUT /users/:id/profile` when the username actually changes.
- `cloudflare/migrations/0098_user_aliases.sql` (new) — the alias table, keyed
  by the stable `user_id` so aliases survive renames; environment-safe seed.
- `frontend/src/components/pos/POS.tsx` — new sales send the **username** as
  `cashier_name` (plus the existing `cashier_id`).

Data backfill + import scripts — commit `69673fbc`:
- `cloudflare/migrations/0099_legacy_cashier_identity_backfill.sql` (new) — adds
  `legacy_deleted_sale_items.cashier_id`, backfills all 2,234 audit rows and the
  40 Aug-30 sales, and normalizes `cashier_name` to the username. Idempotent;
  scoped to the identified cohorts only.
- `cloudflare/migrations/0103_cashier_alias_overrides.sql` — brings already-
  migrated databases to the reviewed map, including `Sethyka → James`, and
  corrects the seven existing deleted-item audit rows from user 5 to user 2.
- `import-aug30-legacy-reports.mjs` — canonical username→name→alias resolver;
  fails loud if "Aza" doesn't resolve; writes the username as the display name.
- `import-aug31-legacy-reports.mjs` — attributes only the five evidenced sales
  (4377–4381) to Rath (resolved live from `users`), gates them to $146, and
  keeps the other nine receipts unlinked as `Old system`.

Tests: `test-import-engine-pure.cjs` (alias precedence, username / name / alias /
inactive / ambiguous→null) plus `test-cashier-alias-overrides-pure.cjs` and `test-user-rename-cascade-pure.cjs`
both pass. Migration 0099 validated in local SQLite (11 checks, idempotent
re-run stable).

## Conflicts surface (§5)

No-op for user identity. No conflicts/duplicate route stores a user-name
snapshot; the duplicate-review surface concerns customer/product/contact ids,
not user renames. Any audit/conflict UI that shows a user name reads a column
already covered by `cascadeUserRename` (e.g. `action_history.created_by_name`).

## How to apply (gated — run in this order; the migrations write to prod)

**Prerequisite:** deploy the code commits first (or in the same release), so the
import matching, the POS username, and the rename cascade are live.

1. Apply pending migrations through 0103. Migration 0103 is what corrects an
   already-migrated database whose 0098/0099 ran before the reviewed override:

   ```bash
   cd cloudflare && npx wrangler d1 migrations apply business-os --remote
   ```

2. Dry-run then apply the Aug-31 script. It now accepts the exact existing
   14-row cohort as correction input and fails on a partial or identity-drifted
   cohort; it still needs `user_aliases`/`users`, which step 1 provides:

   ```bash
   node ops/scripts/migration/import-aug31-legacy-reports.mjs          # dry-run: read-only + local SQL
   node ops/scripts/migration/import-aug31-legacy-reports.mjs --apply   # 5 Rath; 9 reset to unknown
   ```

   The Aug-30 script is **already applied**; migration 0099 backfills its 40
   sales, so it does **not** need re-running. If it ever is re-run, it now
   requires `user_aliases` to exist (step 1) and will fail loud otherwise.

## Post-apply verification (expected results)

```sql
-- 40 Aug-30 sales now linked to Za (id 3), displayed as the username
SELECT cashier_id, cashier_name, COUNT(*) FROM sales
WHERE cashier_name IN ('Aza','Za') GROUP BY cashier_id, cashier_name;
--> cashier_id=3, cashier_name='Za', 40   (plus any genuine new POS sales by Za)

-- deleted-items fully linked, no legacy nickname string left
SELECT cashier_name, cashier_id, COUNT(*) FROM legacy_deleted_sale_items
GROUP BY cashier_name, cashier_id;
--> Za/3 = 2220, james/2 = 7, admin/1 = 5, Rath/4 = 2

-- the ~14.9k bulk-import sales still carry no cashier (faithful to source)
SELECT COUNT(*) FROM sales WHERE cashier_id IS NULL AND cashier_name IS NULL;
```

## Notes / rollback

- The migrations are idempotent; re-applying the data statements is a no-op.
- 0099's `ADD COLUMN` relies on the migration runner's apply-once semantics
  (same as 0093). To roll back the column you would rebuild the table; the data
  backfills need no rollback (they only fill/normalize identity fields).
- The rename cascade never touches `audit_logs` — historical entries keep the
  name that was current when they were written.
