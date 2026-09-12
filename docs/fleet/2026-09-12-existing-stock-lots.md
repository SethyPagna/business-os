# Existing-stock selection and quantity corrections

Base live02febdc976c5, documentation successor2219114e. This change is not deployed.

## User decision

Transfers, Add, Remove and Set must offer existing received-date stock, not silently select newest/new/FIFO. Set offers Selected lot (default) and explicit Branch total. Selected-lot target changes that lot only and adjusts aggregate by delta. Branch target applies aggregate delta to the explicitly chosen lot; other lots remain unchanged and negative outcomes are refused. Existing lot date/supplier stays unchanged. Add also offers explicit New; zero-quantity existing lots are selectable for Add/Set. Remove/transfer require positive availability.

## Findings and implementation

Old Add defaulted New, Remove/Transfer used FIFO and Set compared branch total; no universal latest-date rule was found. Inventory transfer ignored batchId. Branches multi-transfer hid its single-lot picker. Fast/Bulk needed independent per-row scopes and immutable retries; embedding the one-product StockAdjust modal would lose their draft lifecycle.

Backend explicit setScope is durable and atomic; omitted scope preserves old API behavior. Schema-only0157 adds operation receipts, exact history, optimistic concurrency and replay protection. No historical date/quantity backfill. Backend/migration must precede new frontend semantics because old Worker ignores setScope.

Independent native review caught old generic Revert subtracting a downward correction again. Candidate now uses correction_in/correction_out with stock-set operation/generation references; generic Revert refuses these records, exact history handles undo/redo and blocks intervening stock activity. Ledger exposes exact lot/branch before-after values. This blocker must pass independent rerun before release.

## Verification gates

Integrated frontend382/382 test files pass plus standalone executable transferExistingLots.test.cjs. Backend358 scripts executed sequentially: first357/358, one stale source assertion was corrected without runtime edits and passed isolated retry; effective358/358. Both typechecks, localization and production build pass. Actual emitted graph252 chunks zero cycles.

Independent native review confirms down4→3 signs−1; generic Revert409 leaves all state unchanged; exact Undo restores4 and Redo3; unauthorized actor and intervening activity are refused. Real Chrome built-e820ba16 tests verify direct/Fast lot3 target5→branch12, branch10 target9→lot2, older/zero Add/Set choice, positive-only transfer selectedbatch71 request, Bulk scoped target and expectedquantity payload, Fast queued Set preserved after next action switched Add. Browser errors were fixture WebSocket errors only. Adversarial late Bulk mutation injection could not be completed under its confirmation overlay; normal payload and unit frozen-retry checks pass, not falsely certified as a completed browser injection. Subsequent commits through12b2a8c1 only update test contracts, not runtime.

Preserve original draft/retry payloads; legacy Set drafts require explicit review and are not reinterpreted. No remote migration, production stock mutation or deployment performed. Release awaits explicit schema-migration/deployment approval; live remains02febdc976c5 as last verified. Browser evidence output/playwright/final-browser-review.md; backend logs cloudflare/output/backend-stock-lot-cert-e820ba16/.

## Migration recovery

0157 creates only stock_lot_adjustment_operations. Pre/post counts and stock sums for products, branch_stock, branch_batch_stock, inventory_movements, audit_logs and action_history must be unchanged (account for concurrent legitimate production activity rather than inventing invariance). Roll back application code if necessary, retain schema and durable receipts; never delete unknown-outcome operation records. No other pending remote migration may be swept into this release blindly.
