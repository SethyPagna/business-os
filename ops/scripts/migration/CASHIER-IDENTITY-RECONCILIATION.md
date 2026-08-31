# Legacy cashier identity reconciliation — id is the source of truth

**Status: PREPARED + VERIFIED, NOT YET APPLIED to remote D1.** Every D1 call
made while preparing this was read-only (`rows_written: 0`). Applying the two
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
- The Aug-31 import placeheld its 14 sales as `'Old system'` even though
  `report-user-31st` proves **Rath** was the day's sole cashier.

The fix the user asked for is broader than cashiers: **an account's id is the
source of truth, and renaming a username must propagate through the whole
system automatically** — "this applies to conflict, to everything, not just
users."

## Canonical mapping

| legacy cashier | → user id | resolves via |
|---|---|---|
| Aza | 3 (`Za`) | **alias** `aza → 3` (nickname ≠ username) |
| Rath / routh | 4 (`Rath`) | username (+ alias `routh → 4`) |
| Sethyka | 5 (`sethyka`, **inactive**) | username (needs inactive included) |
| pagna | 2 (`james`) | **alias** `pagna → 2` (never appears as a cashier; seeded for completeness) |
| Dev-Usmart | 1 (`admin`) | **alias** `dev-usmart → 1` |

The **display name is the username**; the `cashier_id` FK is the durable link.

## Verified live state (read-only, before any write)

| cohort | finding |
|---|---|
| `sales WHERE cashier_name='Aza'` | **40** rows, **all** `cashier_id IS NULL` (the Aug-30 cohort) |
| `sales` Aug-31 (`43__@2026-08-31`) | **0** rows — Aug-31 not imported yet, no double-count risk |
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
- `import-aug30-legacy-reports.mjs` — canonical username→name→alias resolver;
  fails loud if "Aza" doesn't resolve; writes the username as the display name.
- `import-aug31-legacy-reports.mjs` — attributes its 14 sales to Rath (id4),
  resolved live from `users`.

Tests: `test-import-engine-pure.cjs` (cashier matching: username / name / alias /
inactive / ambiguous→null / Dev-Usmart→1) and `test-user-rename-cascade-pure.cjs`
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

1. Apply the two migrations to production (0098 **before** 0099 — 0099 depends
   on the alias table):

   ```bash
   cd cloudflare && npx wrangler d1 migrations apply business-os --remote
   ```

2. (Optional, only if importing Aug-31) dry-run then apply the Aug-31 script —
   it now needs `user_aliases`/`users`, which step 1 provides:

   ```bash
   node ops/scripts/migration/import-aug31-legacy-reports.mjs          # dry-run: read-only + local SQL
   node ops/scripts/migration/import-aug31-legacy-reports.mjs --apply   # writes 14 sales as Rath
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
--> Za/3 = 2220, sethyka/5 = 7, admin/1 = 5, Rath/4 = 2

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
