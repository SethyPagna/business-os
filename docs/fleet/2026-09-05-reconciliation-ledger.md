# Business OS reconciliation ledger — 2026-09-05

Production baseline: `origin/rc/ee-integrate-2026-09-04` at `2bd6675e`.
Integration branch: `codex/business-os-reconcile`.

This ledger is the completion contract for the owner request. A row is complete
only after its focused tests, typecheck, and the final combined verification pass.

| Lane | Scope | Status | Evidence |
|---|---|---|---|
| BASE | Preserve dirty `main`; integrate from deployed lineage | complete | Separate clean worktree created; dirty batch traced to deployed ancestor `7afc8a71` |
| BRANCH | Audit uncontained branches and recovery refs | complete | 113 refs / 84 tips audited; product-merge series is the principal selective harvest candidate |
| MOBILE | Compact two-layer mobile hub and wrapped section controls | reopened | Source audit confirms separate hub grid / section history layer and branded mobile header remain; passing contracts did not prove requested interaction |
| REPORT-UI | Mobile report filters, date presets, density and overflow | partial visual verification | Date/time endpoint wrapping corrected; local real-component EN/KM samples fit 320/375px; full authenticated report matrix remains unverified |
| MONEY | Awaiting-payment, discounts, revenue/profit, labels and convergence | complete | Revenue convergence, waterfall and full Worker suites pass |
| SHIFT-BE | Shift policy, history/amendments, authorization, Telegram, backup | complete | Shop-wide totals include all branch staff; migration 0119 keeps amendments immutable in-app while restore can replace them; fresh-schema and focused tests pass |
| SHIFT-FE | Shift settings, gate cache, profile and transaction summaries | complete | POS, Sales, Expenses and Income share the operational POS branch; visible loading/empty/error states and bilingual non-sensitive summaries are covered by focused tests |
| SALE-UX | POS-style detail picker, batch/options, delivery text, status chooser | complete | POS-parity, stock-safety, full frontend chain and build pass |
| PRODUCT-MERGE | Selectively harvest duplicate merge stock/cost decision flow | complete | Stock disposition, audit/undo and frontend choice tests pass; newer cost-average rule retained |
| DATA | Legacy sale/receivable reconciliation and idempotent stock-safe repair | blocked on production preflight and payment ruling | Unsafe recovered SQL quarantined with matching SHA; 18-row manifest must be re-derived and two partial payments require owner policy |
| SECURITY | Adversarial review of shifts, sale batches and undo boundaries | complete | Foreign batches rejected; shift permissions/branch/lifecycle/race enforced; stale sale/product undo rejected; folded allocations remapped |
| VERIFY | Full frontend/backend suites, build, migration checks, scope/math review | partial; release certification reopened | Earlier suite passes remain historical evidence, not proof of full requirement coverage; scope-review documents corrections and remaining navigation/authenticated checks |
| COMMIT | Commit integrated changes and update progress | complete | Changes committed by concern on `codex/business-os-reconcile` |

The DATA row is intentionally separate from application release
correctness: it concerns a historical production settlement. MOBILE and VERIFY
are also open after the independent reread. No quarantined SQL
is part of the migration chain, and no production database or deployment action
has been performed.

## Reread correction

See `2026-09-05-scope-review.md`. The unfinished transaction-attribution/lifecycle
draft is preserved under evidence, not included in the migration chain. Its
checkout restrictions were not authorized by the daily-registration requirement.
Focused fixes isolate shift caches, guard stale history responses and unsaved
edits, translate history controls, and constrain the mobile date range. These do
not certify every screen, production totals, or the entire original objective.

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
