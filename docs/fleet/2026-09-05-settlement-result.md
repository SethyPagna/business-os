# Historical settlement execution — 2026-09-05

## Final result — applied and verified

V6 successfully settled 89 sales (including the seven accidental completions)
and 100 receivables. The owner confirmed that the live-added $370 on sale 16790
was already received and belongs to this one-time old-system reconciliation.
Final settled sale total: **$10,516.60**; payment increase: **$10,472.10**.
Two missing source lines were restored; all 218 resulting relational lines were
verified. Sale 16790's item JSON and change fields were made consistent too.
All 89 full sale rows, 100 full receivable rows, the single recorded global
history action and all 192 audit entries/payloads matched the plan exactly.

No settlement stock writes occurred. The strict snapshot comparison detected
normal concurrent business activity: two +5 receipts, four paired transfers
totaling 18 units, and sale 16891 consuming one unit. Main and the independent
reviewer reconciled every product, branch and batch difference to movements
46272–46282, with zero unexplained residual. Those movements predate V6 planning.
Existing stock metadata was preserved apart from activity-linked timestamps.
This verifies captured differences, not a promise that an operating shop's stock
will stay frozen after verification. The older nine-unit incident remains as-is.

V6 source snapshot SHA-256:
`2b3f6ad40db6e26062511b9aea02a9e272b9ac9e58aa1fb91167e638929baa1a`.
Protected local artifacts: `plan-v6/` and `postflight-v6-live.json` under the
integration worktree's `tmp/settlement-20260905/`.

- Pre-V6 bookmark: `000012d3-00000101-000050dd-9a889b2ec3ffdaf36e5c58875373f782`.
- Successful apply: `000012d3-000002d2-000050dd-9160b6829faeec28f5daf3550e353bb7`.
- Cleanup: `000012d3-00000396-000050dd-a73b803188712526e5ead122561865e0`.

Only temporary staging and its operator triggers were removed after verification.
They can be recreated from the protected V6 artifacts; no business records were
deleted by cleanup. Ordinary future sales are not automatically marked paid.

## Authorization and boundary

Owner requested reconciliation-linked historical sales fully paid and Completed,
without stock changes. Later sales retain ordinary system processing. The intended
source is `latest-data-20260902-v1`; never identify targets by invoice number alone.

## Earlier reviewed V4 plan (not applied; superseded above)

- 89 sales: 82 awaiting payment and seven previously bulk-completed but unpaid.
- 100 exact receivables: 89 corresponding rows and 11 stale balances on paid sales.
- Two source-verified missing lines on sale 16812 / invoice 004434 and sale
  16816 / invoice 004430. Both use source payment method ABA.
- Planned settled total $10,146.60; payment increase $10,102.10. These figures are
  now stale and must not be used for a subsequent write without a fresh plan.
- No stock writes; nine earlier incident deductions would remain unchanged.

Protected local evidence is in `tmp/settlement-20260905/` in the integration
worktree, excluded from Git because it contains customer and transaction data.
Fresh snapshot SHA-256:
`b6462d337528337f19247ed1f6c24a737c0bd006283125bdde40113c1d7b6a31`.
Plan-v4 was independently reviewed and rehearsed, including sealed staging,
source identity, stale-row guards, exact inverse, and seven rollback cases.

## Production attempts and safe stop

Pre-operation Time Travel bookmark:
`000012d1-0000000e-000050dd-36d75fbb7bdaebf97c4d0033421dcdde`.

Only inert staging and validation triggers were installed. First apply failed
with D1 expression depth 100; desktop SQLite had accepted the expression.
The operator now balances the full-row OR predicates logarithmically. Rehearsal
passed again. The second apply failed its stale-sales guard: sale 16790 was
updated at `2026-09-05 04:38:38`, from $694 to $1,064, with a new 20-unit / $370
line. The original plan did not include that change. Neither apply succeeded.

Staging and its triggers were removed using the exact cleanup artifact; business
rows were not deleted. The staging is recoverable from the protected local SQL.
Cleanup bookmark: `000012d3-0000000a-000050dd-0a62e3489d0d67e6f58954820d3b13f2`.
Owner clarification requested for the newly added $370. No stale plan may run.

## Recovery

Do not apply any settlement artifact again. The run ID prevents duplicate apply.
Any recovery requires a fresh impact review against subsequent shop activity.

Preserve V6's exact setup, plan and inverse artifacts.
After cleanup, a guarded inverse requires recreating that exact sealed staging
before installing the inverse trigger. Do not reuse the old unbalanced trigger.
Do not run a database-wide restore over subsequent shop activity merely to undo
this targeted settlement. Coordinate any destructive-admin activity separately.
