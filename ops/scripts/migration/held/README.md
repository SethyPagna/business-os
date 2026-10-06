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

- **0200_sale_cost_on_hand_repair.sql** (parked 26 Sep 2026, lane U-cost) -- repairs past
  `sale_items.cost_price_usd` (and copied `return_items.cost_price_usd`) taken from the buggy
  distinct-cost catalog average (a5a2169f until 0195). Writes only those two cost columns, after
  backup tables; recovery SQL in its header. Needs 0195 applied first. Its header's OWNER-RUN
  AUDIT gives the exact read-only `--command` runs and which numbers to read (lines to repair R,
  cost delta D, ledger_unverified count) before the owner decides. Pinned by
  `cloudflare/scripts/test-held-0200-sale-cost-repair-pure.cjs`, which also fails if the file
  appears in `cloudflare/migrations` without being moved there on purpose (update that check in
  the same commit as the owner-approved move). Moving it in keeps the name 0200.
  Not sorting last is fine: wrangler applies unapplied files by number, and 0201-0203 (auth only) touch none of its tables (the test checks that).

- **0238_return_owed_backfill.sql** (parked 6 Oct 2026, lane RET-A Q1) -- rewrites customer returns
  recorded on a Not Paid sale before 0234 to 0234's model: the refund first lowers what the
  customer owes (`returns.owed_reduction_usd`, `refund_currency` 'USD'), only the rest stays drawer
  cash, and a Returned / Partial return sale that still owes goes back to Not Paid. Owner ruling
  6 Oct 2026 (relayed by the lead): rewrite them; closed shift drawers change. Writes existing rows
  of `returns` and `sales`, plus its own backup table `return_owed_backfill_0238` (the recovery
  reads it). Held for two reasons: moving it in is a production data write that needs the owner's
  go, and the held 0200 repair names both tables, so `test-held-0200-sale-cost-repair-pure.cjs`
  would count 0238 as an ordering dependency (0200 reads neither `owed_reduction_usd`,
  `refund_currency` nor `sale_status`). Verify R2 (6 Oct): that guard now admits 0238 by name
  only, column by column (block "RET-A 0238 admission"): reads `sale_items.{id, sale_id,
  product_id, quantity, returned_quantity}` and `return_items.{return_id, sale_item_id, product_id,
  quantity}`; writes `sales.{sale_status, status_before_return}`, `returns.{owed_reduction_usd,
  refund_currency}` and its own table; one named carve-out, the last statement's recovery-only
  `sale_write_revisions` read. Anything else is still a dependency, and the forward result is
  proved equal in both orders on populated data. Verify R3 (7 Oct): the column check is
  structural -- SQLite's authorizer reports every column each statement reads or writes on
  the chain schema (stars, derived tables, CTEs, renames, quoted names, triggers); NATURAL /
  USING joins, which it cannot see, are refused by name; trigger writes are allowed only to
  the two revision counters. If 0200 lands after 0238 on a sale, 0238's
  recovery leaves that sale for hand review (the revision moved). Apply only
  with 0234 and RET-A's Worker code live. Sizing: `ops/queries/ret-a-notpaid-returns-backfill-sizing.sql`
  (before 0234) and `...-sizing-live.sql` (after). Proof: `cloudflare/scripts/test-held-0238-return-owed-backfill-pure.cjs`.

None of the five transfer-run files is imported by any Worker route or by the frontend; the whole transfer-run /
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
0199 is reserved by lane U-branch (its held Shop -> Store consolidation) and 0200 by the held
sale-cost repair above; do not reuse either.
0192 (`stock_mutation_receipts.sql`) is independent of all five and stays in the normal chain.
