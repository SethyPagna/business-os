# Shift, reports and delivery follow-up — 2026-09-05

Status: local implementation verified; production execution pending. Base:
`d3445649`, on `codex/business-os-reconcile`, not the dirty original main.
No deploy, remote D1 query/mutation, secret operation or live Telegram message.

## Delivered

- Current shift on Sales/Expenses/Income opens compact read-only history.
  Operational POS branch/user/policy is independent of historical report filters.
  Manager amendment controls are not added to these transaction-page summaries.
- Telegram cash estimates use native USD/KHR cash tender, not bank receipts or
  all-method revenue. Registered and counted amounts retain both currencies.
  Malformed tender, ambiguous change, refunds, delivery transactions or over
  5,000 sales suppress the estimate/difference instead of asserting false accuracy.
  Expenses are explicitly assumed paid from the drawer. Sale-time totals are
  explicitly not a payment-event cash-flow ledger.
- Expense grouping returns eight labels plus a remainder, with complete totals
  calculated before limiting. Per-account scopes by creator; shop-wide scopes
  by branch. Shared half-open shift bounds normalize ISO/SQLite timestamps.
- Telegram sends long reports in multiple nonempty Unicode-code-point-safe
  messages. Close schedules one attempt for the winning close only. This is not
  a durable outbox or a guarantee of successful/exactly-once network delivery.
- Added the three missing report detail readers: Sales, Returns and Expenses.
  Permissions, bounded cursor paging, filters and admin-only cost/profit are
  enforced. Snapshot IDs exclude later inserts, not updates to existing records.
- Report hooks immediately revoke old rows/amounts/cursors on scope changes or
  refresh, reject stale responses, and retain same-scope rows on load-more failure.
- Receipt and statement totals reuse canonical financial expressions. An
  admin-only raw cost field reconciles per-receipt and whole-statement cost floors.
  Database tests compare directly with canonical totals, including missing cost
  snapshots with restocked returns and cancelled receipts with tax/delivery.
- Sales period cards distinguish unavailable/loading/no-range from valid zeros,
  invalidate on user/permission/activity changes, time out and offer retry.
  Labels explain that list search/status/cashier filters do not apply to period
  cards; expense cards remain whole-day when a sales time filter is selected.
- Driver display uses linked contacts only when delivery snapshot fields are
  absent. Existing snapshots and leading-zero phones survive. Conservative
  reversible Latin-1/Windows-1252 text repairs cover Khmer and mixed names.
- EN/KM profit explanations now say delivery fees charged, include Not Paid,
  and distinguish revenue from cash. No debt-settlement rule was introduced.

## Supplied 04/09/2026 cash example

```text
Expected cash                         300,000 KHR
Shortage                              -16,300 KHR
Registered cash                       283,700 KHR
Expenses: 30,000 + 20,000               50,000 KHR
Delivery: 14,000 + 50,000 + 30,000
          + 6,000                      100,000 KHR
Total expenses                        150,000 KHR
Remaining cash                        133,700 KHR
```

Regression fixture only, not a live record. This treats registered cash as the
starting amount for the listed outflows, without additional cash receipts.
Later collections and actual refund/change currency or fee funding accounts are
not fully captured; the estimate is not a certified bank/cash reconciliation.

## Verification and integration

- Driver worker `2d5f4d11` integrated as `8545a27b`.
- Report lifecycle worker `07e6e925` integrated as `6768b4f3`.
- Sales availability worker `d9df45f4` integrated as `c5acc664`.
- Lead reviewed all worker diffs and re-ran integrated gates.
- Full frontend `test:utils`: all 198 files passed, including typecheck, source
  syntax and chain coverage; 21 new stats availability checks.
- Frontend build passed; existing circular-chunk/large-bundle warnings remain.
- I18n: 4,864 EN/KM keys resolve. Worker typecheck passed.
- All 200 backend `test-*.cjs` suites passed. Subsequent sender-test additions
  passed separately with fetch replaced locally; no bot request was transmitted.
- Real Hono/SQLite report tests cover permissions, canonical accounting, filter
  scope, cursor ties and late inserts. Real grouped fee SQL tests cover policy,
  branch, mixed timestamps, exclusive closing and complete remainder totals.
- Shift-close: 20 checks including duplicate/concurrent close (one attempt).
- Two independent final bounded reviews cleared the modified report financial
  and Telegram cash/chunk/window paths after lead fixes. They found the empty
  chunk, zero-tender validation and cost-floor parity edge cases now covered.
- Playwright sample imports real current/history components and CSS. Sample data
  only; `frontend/output/playwright/scope-review.html?current=1` selects this view.
  Default fixture retains the earlier amendment view. EN/KM at320px and Khmer
  at375px were inspected; document scroll width equalled viewport width. These
  samples are not an authenticated full-app or production certification.

## Historical completion: do not run the archived repair

Latest scope includes awaiting-payment sales on BOTH sides of the reconciled
received/adjusted-stock date. Freeze the actual target set at an agreed snapshot;
do not create an automatic future-sales rule or a guessed date-only cutoff.

1. Resolve whether Completed retains unpaid balances or means fully paid.
   Status changes do not settle `customer_receivables`; ordinary completed
   reporting can count a receipt as collected despite short tender. A status-only
   bulk change can therefore misstate cash even when stock is unchanged.
2. Obtain explicit authorization for a fresh read-only production preflight.
   Build primary-key manifests and row fingerprints. Receivables have no sale_id;
   prove source/import identity. Invoice-only matching previously reached 152 AR
   rows for 82 sales, including wrong-year rows. Archived counts and the reported
   partial-payment cases remain unverified, not current production evidence.
3. Prove stock provenance per sale. Awaiting-payment already holds stock, so
   Completed has zero stock delta under the current kernel. Do not blanket-set
   stock_skipped on later sales that already deducted stock: cancellation would
   then fail to restore it. Historical skips require reconciliation evidence.
4. Prepare before/after assertions and an exact inverse plan. Execute only the
   confirmed manifest with separate production authorization. No live updates
   or runnable bulk update were produced in this follow-up.

The full overhaul is not certified: true two-layer/back-title mobile navigation,
the authenticated responsive matrix, payment-event ledger and production
financial/data reconciliation remain open. See the earlier scope review.
