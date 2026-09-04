# Business OS reconciliation ledger — 2026-09-05

Production baseline: `origin/rc/ee-integrate-2026-09-04` at `2bd6675e`.
Integration branch: `codex/business-os-reconcile`.

This ledger is the completion contract for the owner request. A row is complete
only after its focused tests, typecheck, and the final combined verification pass.

| Lane | Scope | Status | Evidence |
|---|---|---|---|
| BASE | Preserve dirty `main`; integrate from deployed lineage | complete | Separate clean worktree created; dirty batch traced to deployed ancestor `7afc8a71` |
| BRANCH | Audit uncontained branches and recovery refs | complete | 113 refs / 84 tips audited; product-merge series is the principal selective harvest candidate |
| MOBILE | Compact two-layer mobile hub and wrapped section controls | implemented; combined verification pending | Focused navigation suites and frontend typecheck pass |
| REPORT-UI | Mobile report filters, date presets, density and overflow | implemented; combined verification pending | Focused date/report UI contracts and frontend typecheck pass |
| MONEY | Awaiting-payment, discounts, revenue/profit, labels and convergence | implemented; combined verification pending | Revenue convergence and waterfall suites pass |
| SHIFT-BE | Shift policy, history/amendments, authorization, Telegram, backup | implemented; combined verification pending | Migration, typecheck and focused schema/close tests pass |
| SHIFT-FE | Shift settings, gate cache, profile and transaction summaries | implemented; combined verification pending | Shift gate and management tests pass; POS mount is branch scoped |
| SALE-UX | POS-style detail picker, batch/options, delivery text, status chooser | implemented; combined verification pending | POS-parity, stock-safety and typecheck pass |
| PRODUCT-MERGE | Selectively harvest duplicate merge stock/cost decision flow | implemented; combined verification pending | Stock disposition, audit/undo and frontend choice tests pass; newer cost-average rule retained |
| DATA | Legacy sale/receivable reconciliation and idempotent stock-safe repair | blocked on production preflight and payment ruling | Unsafe recovered SQL quarantined with matching SHA; 18-row manifest must be re-derived and two partial payments require owner policy |
| VERIFY | Full frontend/backend suites, build, migration checks, scope/math review | queued | Final gate |
| COMMIT | Commit integrated changes and update progress | queued | Final gate |

## Accounting contract

- Cancelled sales contribute to neither sales, revenue, COGS nor profit.
- Awaiting-payment sales contribute to total sales, revenue, COGS and profit,
  while their balance remains separately visible as **Not Paid** and does not
  enter cash-on-hand/collected cash.
- Product/line discounts and invoice/membership discounts are each deducted
  once and remain separately visible.
- Dashboard, reports, Telegram and exports must converge for the same filters.
- `Total Profit` is the gross business result before operating expenses;
  `Final Profit` is after operating expenses, avoiding two different numbers
  with the same label.

## Stock and historical-data contract

- Historical reconciled sales may be marked completed without changing stock,
  but must retain `stock_skipped` so later transitions cannot invent stock.
- New sales follow normal branch- and batch-scoped stock transitions.
- Product, batch and branch aggregates must not leak across branches or show a
  false zero when scoped stock exists.
- Receivables attached to completed historical sales require explicit,
  idempotent reconciliation rather than a display-only workaround.
