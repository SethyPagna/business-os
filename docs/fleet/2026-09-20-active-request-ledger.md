# Active request and verification ledger — September 20

This supplements, not replaces, earlier issue ledgers and screenshots/video evidence.
Recorded means tracked; implemented does not mean verified or deployed.

## Current acceptance checklist

| Request | Current evidence/status | Remaining acceptance |
| --- | --- | --- |
| Separate cost viewing and entry permissions; non-admin defaults off | Implemented frontend and Worker, including imports, exports, supplier totals, audit and revocation surfaces. POS always hides costs. Focused security checks pass. | Integrated broad certification and deployment. |
| Other restrictions previously enforced by design | Inventory in `2026-09-20-permission-candidates.md`. | Review discretionary capabilities individually; do not expose security invariants as bypass switches. |
| POS USD-only products; compact stock/deal and controls | Implemented locally. | Updated visual/browser certification. |
| Preview fixture errors | Dashboard/promotions plus tagged stock/stock-in session synthetic GET routes added. | Restart preview and verify visible pages. This is not production data. |
| Products and Contacts Conflicts menu icons consistent | Both map to Copy; focused mapping test passes. | Rebuild and responsive EN/KM browser verification. Content hubs intentionally unchanged. |
| Range trigger displays dates only; times inside picker | Shared presentation implementation in progress. | Preserve internal time values and filtering; no outside HH:MM labels. |
| Every range has one external preset row with invisible horizontal scrollbar | Shared styling implementation in progress; direct hosts inventoried. | Convert direct hosts; remove duplicate internal presets; keyboard/touch and narrow-screen checks. |
| Time filtering works for all ranges | NOT complete: many consumers currently discard or omit times. | Trace backend, state, persistence, request/cache keys, pagination, totals and export parity per host before enabling controls. |
| Keep complete task history and Claude handoff | This ledger linked at top of progress and handoff. | Append outcomes and deployment provenance, never replace open status with unsupported completion claims. |

## Date-range scope requiring follow-through

Already time-aware: Sales, Reports (except Shift report), Stock Changes, Delivery Contact Report.
Date-only state: AR/AP invoices, Stock-in Invoices, Supplier Purchases, Customer Purchases,
Audit Log, Legacy Deleted Sales, Inventory Movements. Dashboard explicitly strips times.
Inventory, Returns, Expenses and Branches hold range objects but omit times from requests/dependencies.
Sales Export uses separate date inputs and a date-only request contract.
Direct picker hosts needing external presets include Audit Log, Inventory Movements,
Legacy Deleted Sales, Delivery Contact Report and ExportRangeDialog.

Preserve business timezone and existing continuous-endpoint versus recurring-daily-window semantics.
Received/expiry/due dates and promotion scheduling fields are not implicitly changed by range UI work.

## Verification checkpoint

- Frontend initial broad run: 480 passed, 8 failed of 488. All eight were repaired and the integrated focused rerun passed 8/8. Final broad rerun still pending.
- Frontend/Worker typechecks, i18n and build passed before subsequent test-only repairs; final typecheck found a test helper typing issue now being corrected.
- Worker initial broad run: 469 scripts, 46 failures. Repair waves retain real guards and explicit default-denial assertions. Final integrated rerun pending; do not call the suite green yet.
- GitHub main reconciled locally in merge e80624c5; no push/deployment claimed by this checkpoint.

## Earlier open work retained

Account-owned offline replay, logout/stale-read cases, reproduced inline queue loss,
Free/Paid transfer budgets and quota checks, maintainability cleanup, ambiguous historical
customer/lot provenance, physical continuous-80mm printing, universal UI consistency,
and final single-folder consolidation remain open unless a later evidence entry closes them.
Primary business-os-v1 dirty work and private recovery archive remain protected.
Recorded production remains de8c72fa9514 / Worker 9d5b1644-9f8f-4826-b6f7-043ddd5cf6c2;
fresh runtime provenance was blocked by HTTP403. Migration0183 is already applied; do not replay it.
