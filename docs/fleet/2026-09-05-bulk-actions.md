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

Implementation and verification are in progress; no completion or release claim.
