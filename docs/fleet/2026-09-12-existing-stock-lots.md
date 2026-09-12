# Existing-stock selection and quantity corrections

Base live02febdc976c5, documentation successor2219114e. This change is not deployed.

## User decision

Transfers, Add, Remove and Set must offer existing received-date stock, not silently select newest/new/FIFO. Set offers Selected lot (default) and explicit Branch total. Selected-lot target changes that lot only and adjusts aggregate by delta. Branch target applies aggregate delta to the explicitly chosen lot; other lots remain unchanged and negative outcomes are refused. Existing lot date/supplier stays unchanged. Add also offers explicit New; zero-quantity existing lots are selectable for Add/Set. Remove/transfer require positive availability.

## Findings and implementation

Old Add defaulted New, Remove/Transfer used FIFO and Set compared branch total; no universal latest-date rule was found. Inventory transfer ignored batchId. Branches multi-transfer hid its single-lot picker. Fast/Bulk needed independent per-row scopes and immutable retries; embedding the one-product StockAdjust modal would lose their draft lifecycle.

Backend explicit setScope is durable and atomic; omitted scope preserves old API behavior. Schema-only0157 adds operation receipts, exact history, optimistic concurrency and replay protection. No historical date/quantity backfill. Backend/migration must precede new frontend semantics because old Worker ignores setScope.

Independent native review caught old generic Revert subtracting a downward correction again. Candidate now uses correction_in/correction_out with stock-set operation/generation references; generic Revert refuses these records, exact history handles undo/redo and blocks intervening stock activity. Ledger exposes exact lot/branch before-after values. This blocker must pass independent rerun before release.

## Verification gates

Pending integrated frontend utilities, type/i18n/build and emitted zero-cycle gate, real built-browser scoped selection/preview checks, independent backend counterexamples and native migration preservation. Preserve original draft/retry payloads; never reinterpret legacy Set drafts silently. No remote migration, production stock mutation or deployment performed yet.

## Migration recovery

0157 creates only stock_lot_adjustment_operations. Pre/post counts and stock sums for products, branch_stock, branch_batch_stock, inventory_movements, audit_logs and action_history must be unchanged (account for concurrent legitimate production activity rather than inventing invariance). Roll back application code if necessary, retain schema and durable receipts; never delete unknown-outcome operation records. No other pending remote migration may be swept into this release blindly.
