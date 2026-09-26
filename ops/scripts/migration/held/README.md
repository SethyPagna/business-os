# Held migrations

Files here are checked into the repo but deliberately kept OUT of `cloudflare/migrations`, so
`wrangler d1 migrations apply --remote` can never pick them up by accident. Production D1 is at
migration 0184 today (0192 is the next one actually in the chain). Moving a file back into
`cloudflare/migrations` is itself the "apply this" decision, and needs the owner's go, per
migration, at that time -- a peer session or another agent asking for it is not approval.

## Parked files (parked 24 Sep 2026, after a full read-only review)

- **legacy_sep2_3_import_stock_deduction.sql** -- Sep 1-3 legacy-import sales deduction (38
  lines / 107 units). Held, not applied, by owner ruling: legacy sales stay as recorded.
- **0185_transfer_runs.sql** -- reservation tables (`transfer_runs`, `transfer_run_chunks`) for a
  proposed idempotent multi-step transfer-run kernel. Additive only; no route or frontend code
  reads it today. Review verdict: safe to apply in isolation, structurally clean.
- **0186_transfer_run_retirement.sql** -- retirement/generation lifecycle for 0185's run tables
  (`business_dataset_generation`, `transfer_run_retired_keys`, `transfer_run_lifecycle_guard`).
  Depends on 0185. Review verdict: additive and idempotent, structurally clean.
- **0188_transfer_receipt_retirement.sql** -- review verdict: UNSAFE AS WRITTEN. It adds an
  unconditional "retirement evidence required" BEFORE DELETE trigger on the live,
  already-populated `transfer_operation_receipts` / `transfer_operation_members` tables
  (branch-transfer receipts, migration 0151). Confirmed empirically: once 0185+0186+0188 apply,
  the exact delete that succeeds TODAY during restore/reset (with the real maintenance/reset-guard
  flags the app already sets) throws "exact receipt retirement required before delete" instead.
  In the streaming backup restore this aborts non-transactionally after 28 of 85 `BACKUP_TABLES`
  are already wiped and committed, leaving them permanently empty with maintenance mode stuck on;
  in the factory-reset route (one atomic `db.batch`) every reset mode instead fails cleanly with a
  500 -- no data loss, but the feature is fully broken. Depends on 0185 and 0186.
- **0190_dataset_operation_journal.sql** -- additive fenced journal/chunk-receipt tables for a
  general dataset-operation kernel. No destructive statement; the few triggers it adds on
  `users`/`roles` never abort a write. Review verdict: clean, lowest risk of the five, and does not
  need 0185/0186/0188 present to apply (only to be meaningful).
- **0191_dataset_operation_generation_transition.sql** -- generation-transition table plus a
  completeness view that reads 0185/0186/0188's tables directly. Depends on 0185, 0186, 0188 and
  0190 all four. Review verdict: clean on its own SQL, but inert -- and not testable end to end --
  until 0188 is fixed.

None of the five is imported by any Worker route or by the frontend; the whole transfer-run /
dataset-operation lifecycle chain is unwired in production.

## Before any of 0185/0186/0188/0190/0191 can apply

1. **0188 needs an actual fix, not just review sign-off.** Give both of its DELETE triggers
   (`transfer_receipt_retirement_delete`, `transfer_receipt_member_retirement_delete`) the same
   maintenance/reset carve-out the pre-existing `transfer_receipts_immutable_delete` trigger
   (migration 0151) already has, or otherwise make retirement evidence unnecessary during an
   app-driven restore/reset. Re-run `test-backup-replay-coverage-pure.cjs` and a real restore
   rehearsal after the fix -- this is the one place the new lifecycle chain reaches back into
   already-shipped, non-empty production data.
2. **A fresh owner go per migration.** 0185 and 0186 are harmless alone but only meaningful
   applied together; 0188 needs its fix first; 0190 can apply independently; 0191 needs all four
   of the others already applied. Each file gets its own explicit owner approval before it moves
   back into `cloudflare/migrations`, even after 0188 is fixed.
3. **Nobody runs `wrangler d1 migrations apply --remote` for these** while they sit here.

## Numbering

0185 through 0191 stay reserved -- do not reuse them for a new, unrelated migration even though
they are currently absent from `cloudflare/migrations`. The next new migration starts at **0193**.
0192 (`stock_mutation_receipts.sql`) is independent of all five and stays in the normal chain.

## Shop -> Store branch consolidation (lane U-branch, 0198 + held 0199)

0198 is in the normal chain; 0199 is reserved here and is the only one of the three files that
moves stock. Do not reuse 0199 for anything else.

1. **cloudflare/migrations/0198_branch_successor_role.sql** -- additive: `branches.role`,
   `canonical_key`, `successor_branch_id`, the `branch_redirects` table. Inert: every branch stays
   active with no successor, so the successor-aware Worker behaves exactly as today. Ships with an
   ordinary release.
2. **0199_branch_consolidation_shop_into_store.sql** (held) -- the move. Warehouse (id 1) is
   renamed Store (role shop, default); Shop (id 2) is retired with successor 1 and keeps its name.
   Written as one official transfer (receipt + one member per product + per-lot
   `transfer_out`/`transfer_in` movements in the ordinary transfer convention + `stock_transfers`
   rows), then both stock ledgers fold into Store. Open quarantine lots and RFID tags follow the
   goods (recorded in `branch_redirects`), open undo entries are retired, database guards refuse
   new stock at a retired branch, and the D1 `cache_versions` fallback rows are bumped. Preflight
   and postflight are named CHECK constraints, so the file must be applied as ONE migration
   (atomic in D1). It is held because the chain runs on every release and on every fresh
   database: in the chain it would perform the move at whatever release came next.
3. **0199_branch_consolidation_shop_into_store_recovery.sql** (held) -- the reversal,
   delta-based. Byte-identical rows when nothing was written in between; refuses (never goes
   negative) once Store has sold what Shop brought. Records the Worker redirected to Store after
   the move stay at Store. Applied, if ever, under the next free number at that time.

Runbook (owner-run; every step is a production action):

- Release the Worker carrying `lib/branchSuccession.ts` together with 0198 (the Worker is correct
  on both shapes).
- Immediately before the cutover, record a D1 Time Travel bookmark.
- Read `GET /api/branches/consolidation-preview` as an administrator. It runs the same counts as
  the preflight and must say `ready: true`. Blockers: awaiting_payment/awaiting_delivery sales at
  Shop, an open Shop shift, a running import/bulk delete, an open Shop RFID session, a product whose
  Shop lots exceed its Shop branch_stock, a restore window.
- Move 0199 unchanged into `cloudflare/migrations/`, commit, apply. Then make one product or sale
  write, or bump the KV cache versions, so the KV copies of `products`/`sales`/`returns` move as
  well (SQL can only reach the D1 fallback).
- Tested by `cloudflare/scripts/test-migration-0198-0199-branch-consolidation-pure.cjs` (real
  migration chain, all three files, with mutation controls).
