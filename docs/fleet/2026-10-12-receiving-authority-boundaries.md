# Receiving session authority and retry boundaries

Source checkpoint: `70e7ec633205d8e380bc82a0357d06d39e5018f0`, based on
production/main `bf7408b492937ddf18813441ea7f75d23ac0b10a`. This continues the
[confirmed-product handoff repair](2026-10-12-receiving-confirmed-product-handoff.md).
Publication and deployment status are recorded separately in `progress.md`.

## Confirmed defects and changes

The original repair lets a confirmed new product reach receiving in the same
session as an existing product. Deeper testing found two additional ways a
delayed operation could lose its original account/server ownership.

A mounted-browser case with two new products also exposed an incomplete part of
the original repair: the second creation persisted the old render's rows,
restoring uncertainty for the first confirmed product. Creation now receives
and persists the commit loop's current rows. The regression captures React's
fixed render snapshot; it fails on the previous source at two new products after
four healthy single-product controls, then passes with the correction. The
original fixture had incorrectly read mutable current rows and missed this bug.

First, the receiving transport started each deferred round with the current
connection. Changing servers while the first answer was pending could send the
remaining original product and branch IDs to a different server. The mounted
session now retains its original authority and draft key. Its creation,
preparation, stock rounds, legacy fallback, result application and completion
check that authority. A stale 404 cannot select the legacy fallback, and stale
autosave cannot write the original lines into another account's draft.

Second, the shared disabled-branch redirect could wait for confirmation and then
resend the original body under a changed account or server. `apiFetch` now checks
its original authority after loading the redirect handler and after receiving
the answer, before any resend. Normal redirects retain the same body, request ID
and confirmed branch header. Ordinary responses and sign-in/sign-out semantics
are unchanged.

There are no Worker, migration, permission, receipt-cost, quantity, locale or
layout changes. These guards retain uncertain outcomes; they do not claim that
an unanswered write failed or automatically repeat product creation.

## Verification and affected surfaces

| Surface | Observed evidence |
| --- | --- |
| New/existing product handoff | Ten controller groups pass with the corrected fixed-render snapshot, covering new-only, existing-only, both mixed orders, multiple new products, pending/unknown refusal and stable request IDs. The mounted multiple-create failure is retained as evidence; its built-browser recheck is required before final acceptance. |
| Receiving modal and deferred transport | Eighteen regression groups pass. The previous source fails sixteen safety assertions while both healthy controls pass. Six deliberately incorrect repairs are rejected. |
| Real account/server scope integration | Twelve independent probes pass: server, account, organization and login changes during success/404; unchanged-authority and ordinary cache-invalidation controls preserve valid deferred rounds. |
| Shared HTTP redirect | Nine actual-API regression groups pass; the previous source fails five stale-authority cases. Existing redirect and HTTP tests pass. Current-owner confirmation, cancellation, successive redirects and a fresh command by the new owner remain functional. |
| Drafts and sibling entry points | Existing Inventory, Products, Stock Changes and Add More callers share the modal. Durability, lifecycle and batched/deferred fixtures retain their original checks with explicit authority wiring. |
| Authenticated backend composition | Thirty-nine local HTTP requests exercise real authentication, routes and SQLite on Free/Paid: creation then mixed receiving, replay without extra stock, changed-body conflict, lost acknowledgement, partial failure, supplier totals, permission revocation, inactive/retiring branch and pending approval. No backend repair was required. |
| Receipt ownership | Authorized actors have separate receipt namespaces. A second actor can legitimately submit the same request ID as its own new command; client authority guards are therefore required to prevent a stale original operation becoming that command. |
| Creation refusal and recovery | Actual controller probes preserve terminal pending/unknown markers through reload, removal and re-addition with the same creation ID. A new explicit creation ID represents a new operation, not an idempotent replay of the old one. |
| Broader stock features | Counted-stock migrations, import authorization, complete restore/compensation and physical-device acceptance remain in their existing open lanes. This patch does not certify them. |

Stale editors retain the original operation's recovery evidence. The application
may hide or lock them during account reconciliation; this report does not claim
that every authority transition automatically remounts the editor. Reopening
under the original authority must retain the saved request IDs and uncertainty.

Local fixture checks do not establish live production behavior or physical
iOS/Android acceptance. The final source still requires the full GitHub release
gate and independent review before main publication, followed by the separate
authorized production release process.
