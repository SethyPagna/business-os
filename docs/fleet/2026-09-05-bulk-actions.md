# Conditional bulk actions — September 5, 2026

User request: replace Sales bulk Done/Delivery/Cancel with conditional source to
destination status, payment method, delivery driver and customer changes. Only
matching selected rows change. Cancellation reviews retain individual reasons,
notes and lost fees in scrollable, expandable receipt panels. Returns gains
conditional actions and method changes. Exports move to the desktop section row
and mobile title bar; Expenses behavior stays intact.

Director: task `Update bulk actions and exports`, coordinated with
`Read Codex goal objective`. Base `8f6568610fa2412dd48090413e96792506324d39`;
candidate worktree `business-os-v1-bulk-actions`. Original dirty checkout is
preserved. No production operations are authorized by this request.

## Ownership and acceptance

- Sol high backend: existing sale bulk transaction/history machinery, conditional
  matching, individual cancellation fees, payment/customer/driver reassignment.
- Sol medium Sales UI: conditional selection/review, stable retry body, per-sale
  cancellation questions, transport, focused behavioral tests.
- Sol high Returns: canonical cancellation/reversal parity and method actions,
  Returns UI/transport plus Expenses export placement only.
- Director: mobile export host, integration, independent verification, evidence.

Every writer uses exact path claims in the common Git team-state ledger and an
isolated worktree. Shared Modal and sale detail belong to the coordinating task.
Schema changes require coordination (0123 shift and 0124 stock session reserved).

Verification must cover source mismatches, stale matches, all-or-none writes,
lost-response retry, cancellation fees, stock restoration/reissue, method amount
preservation, customer linked returns, permissions, undo and redo. Frontend gates
and a local synthetic browser pass at desktop/320/375 EN/KM follow integration.

## Current evidence

Discovery confirmed existing bulk cancellation hides individual lost fees and
accepts only a common reason/note. Existing bulk status has atomic revision,
stock and grouped-history guards that must be retained. Mobile title bar is
owned by Sidebar and has no prior section-action slot.

## Implementation checkpoint

Original requested scope is implemented through `c63ae6c2`: conditional Sales
status, payment method, customer and delivery contact actions; per-receipt
cancellation reasons/notes/native USD and KHR lost fees; grouped server history;
Returns status and classification actions; desktop and mobile export placement.
Sol high owned each backend slice and Sol medium owned Sales UI. Independent
director and peer review found and corrected historical contact replay guards,
skipped-return replay guards, cancellation stock provenance, keyboard behavior,
stale searches, and integration test contracts.

Migration 0125 is schema-only and append-only, with LF-only trigger SQL. It
preserves pre-return sale status and durable return replay provenance. Historical
returns without sufficient exact stock/lot or prior-sale-status provenance are
rejected without writes. Return type/settlement changes preserve recorded native
amounts and per-item stock actions. At most 25 selected records are accepted.

Director verification used synthetic data in an isolated local Worker on 8799;
the coordinating task's 8798 runtime and production were not modified:

- Real Worker Sales: conditional source matching, stale matching rejection,
  exact request retry, payment/contact/customer undo and redo, native money and
  stock preservation, cancellation fee/stock reversal without duplicate issue.
- Real Worker Returns: customer type and supplier settlement source/scope
  matching, native money preservation, mixed customer/supplier cancellation,
  exact batch restoration, retry/undo/redo, prior awaiting-delivery sale status.
- Frontend build, both typechecks and i18n passed. The 211-file backend sweep
  found seven test integration failures; all seven passed focused reruns after
  narrow backup-table, bounded-query and test-loader fixes.
- Browser verified desktop export placement for Sales/Returns/Expenses, mobile
  title export at 320/375 widths, selected export in the Sales top menu, Sales
  cancellation review at 375, Returns matching/method review in English and
  Khmer, Escape dismissal, and no horizontal overflow on these views. Screens
  are in the local `output/playwright` directory. Console failures observed were
  local runtime restart/network events, not application exceptions.

The customer-picker follow-up `3ee20eeb` adds a 180ms debounce, an explicit
100-record cap and the checked customer-transport caller contract. Final build
passed after this change. All 202 frontend test files are covered: the final
full chain passed through the customer-picker contract, then the two simple
source/target confirmation dialogs needed explicit guard-policy declarations.
That contract and every remaining test in the chain passed the focused rerun.
Per-sale cancellation remains guarded because it contains editable notes/fees.
The full wrapper was not rerun solely for these test declaration changes.

Original bulk scope is certified for integration. The coordinating task owns
the combined release and its production migration/deployment checkpoint; this
lane has not deployed. New settlement, current-rate-on-update and cashier
visibility requests are separate read-only discovery, not implemented here.
