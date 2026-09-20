# Active request and verification ledger — September 20

This supplements, not replaces, earlier issue ledgers and screenshots/video evidence.
Recorded means tracked; implemented does not mean verified or deployed.

LATEST: online-only/cost/account safety checkpoint6a31689f deployed as
Worker3f5ad76d-5be1-468b-876d-6151239c61d9 with0184 applied once. See
2026-09-20-online-only-release.md. This supersedes older NOTdeployed/blocker
entries for that slice only. Other admin/public/Freecapacity items stay open.

## Latest owner priority and release truth

### Active completion goal and next wave

Next integrated local source29a93f46 adds Dashboard timestamp preservation and
continuous backend bounds, with stale-response masking/fences. Root reruns:
275 actual SQL/handler checks and frontend executed-loader/state checks pass.
This postdates the501-file broad run below and is NOT covered by that whole run.
Returns browser commit9431dc47:12/12 on pinned a789e527 build (3 responsive/time
cases plus9 native-service-worker auth cases). Synthetic Returns GETs verify UI
and request contracts, not D1 filtering; desktop/Android/iOS engines, no hardware.

Statement helpers integrated403d2010 include verified supported-year parity;
endpoint remains unwired. Proposed transfer migration0185/store stays in isolated
branch233d604d: independent review reproduced a matching child receipt committed
outside the run wrapper without advancing progress. Fix required before integration;
backup/restore/reset integration and remote approval also remain blockers.
Shift candidate01f9a833 remains held: admin visibility passes, but report dates
were ignored by selected-shift loading. Writer correcting this. Reports partial
clock silently broadening date ranges is another bounded fix in progress.
Transfer preliminary lot read is NOT wholly dead: Telegram consumes its takes;
safe removal must reuse authoritative planner metadata rather than drop details.

Integrated local checkpoint a789e527: frontend test:utils501/501 files, zero skips;
frontend and Worker typechecks pass; EN/KM5892-key check passes; build269chunks,
zero cycles, public preload excludes admin/file/import code. This covers Returns
time parity, compiler-gate hardening and the standalone transfer planner, NOT the
unintegrated statement-export/Dashboard/shift candidates. No deployment of this
checkpoint. Browser verification assigned separately; hardware remains unverified.

New bounded findings: derived shift cash reconciliation is returned to staff via
current/history/close/replay despite admin-view requirement; fix in isolation,
preserving operational entered counts and nonblocking mismatch close. Dashboard
currently strips times in persistence and backend; end-to-end parity fix assigned.
Statement export guards lack customer anonymity/replacement-item coverage and a
durable non-restored epoch. D1 bookmarks are not pinned snapshots. Additive
tracking authority requested; no new migration applied. Partial helper candidate
passes21001-row traversal but endpoint/UI remain unwired, not a completed export.

Owner export decision: allow custom start/end date ranges with at most one year
per download. Monthly, three-month, six-month and one-year statement presets are
convenience shortcuts, not required calendar blocks. Longer history requires multiple
downloads. Apply first to the open Returns export-completeness work; do not cap
the downloaded data at the currently loaded 500/1000 rows. Backend must enforce
the range bound, with bounded sequential reads and original-account fences.
Calendar/business-timezone boundaries (including leap years), full matching-row
coverage, and visible failure rather than partial-success files are acceptance
criteria. This is a requested design, not yet implemented/deployed. A period cap
alone does not establish Free-tier capacity or freeze concurrent record edits.

The completion goal is ACTIVE following the owner's instruction to continue until
finished. Earlier blocked-goal wording below is historical, not current state.
The latest online-only release above supersedes older undeployed status only for
its documented scope; remaining work is not implicitly complete.

- Returns time-range parity: implementation and independent verification in progress.
  Newly confirmed separate issue: loaded lists cap at 500 by default / 1000 maximum;
  client pagination and exports can therefore omit rows while statistics cover all.
  This completeness issue remains OPEN and must not be hidden by the time-range fix.
- Transfer budgets: standalone local planner/reader candidate 285f54ad awaits
  independent review. No route integration or production-capacity claim. Durable
  transfer-run/chunk tracking requires separately approved additive migration.
- Compiler cleanup gates: hardening startup/error detection with negative controls
  in progress; unchanged unused-declaration budgets are not a deletion allowlist.
- Remaining date hosts, shift visibility, historical evidence, device checks,
  maintainability, Free capacity, archive consolidation and public work stay open.

Admin work precedes public work. Preserve four-decimal calculations, cost rules,
existing historical records and original-account recovery throughout this wave.

### Approved online-first goal refinement

Owner explicitly approved online-only business writes with account isolation.
Disable new offline sales/stock/action admission and automatic mutation replay;
retain cached reads and drafts within actor boundaries. Keep exact request IDs,
timestamps, audit/provenance, conflict checks and safe lost-response retries.
Existing sales queue recovery must be explicit, original-account scoped, and
limited to the reviewed records. Ownerless/mismatched work is retained without
exposing another account's payload; generic encrypted/file work is retained but
not replayable until ownership is verifiable. Do not fabricate ownership.

Candidate66c6a48a implements this sales/generic-queue slice. Server requires owner
metadata before sale admission/duplicate lookup; old clients fail closed with
recovery/update guidance. Actor-scoped preview and CAS prevent stale deletion.
Independent review found25visible/26discarded mismatch;134d26da fixes visible-set
tokens, with26/40-row tests. No new deployment yet. Full integrated gates running.
Same-origin database replacement with reused actor/org IDs is a remaining identity
epoch limitation; authorized admin private receipt reads remain intentionally
available, distinct from original-owner queued-write recovery.

Free/Paid transfer audit re-confirmed actual planner work exceeds tier budgets:
200products/3lots yields1017batch statements before planning/auth overhead.
Tier-aware resumable budgeting remains open; no no-impact downgrade claim.

- Complete remaining admin work first, then public work; retain all historical tasks.
- Public decision supersedes the temporary hide-all interpretation: retain optional selling-price display and reasonable copy friction. Costs, wholesale prices and internal/personal business data must not reach public responses or the public AI. Visible selling prices cannot be guaranteed uncopiable.
- Completion requires regression evidence, adversarial review, deployment provenance and real Free/Paid capacity assessment, not merely successful bundle builds. Existing goal-tool state remains blocked from earlier archival work; this does not mean the broadened completion goal was achieved.
- Deployed checkpoint: fdcee3fe685d / Worker07362be0-f996-4c89-a5e3-1e551c25b8c6. Older status rows below are historical and superseded where this entry or the release report provides newer evidence.
- Prospective cost candidate through17b610f7 is NOT deployed; migration0184 is NOT remotely applied. Independent bounded review reran20scripts successfully. Final frontend typecheck/i18n/build passed;268emitted chunks, zero cycles. One unused inventory import was removed after the zombie-import gate flagged it; focused rerun follows.
- Next bounded admin slice: Expenses timed-entry versus full-day booked-date parity. Account-owned offline replay, inline queue loss, remaining date hosts, transfer budgets, Free-tier capacity, old audit findings and safe folder consolidation remain open.

## Current acceptance checklist

### Continuation evidence and release challenge

- c409abf7: Expenses timestamp/full-day parity implemented; independent native and boundary checks pass. Other date hosts remain open.
- f26ff13d +1fe5a392: concurrent inline queue roots isolated.20pure checks and7actual workerd D1/R2 cases pass; old implementation fails concurrency controls. Bound queue behavior unchanged.
- Integrated frontend typecheck/i18n/build passes; Worker typecheck and52plan-tier/config/queue/surface checks pass. These are not live Free capacity certification.
- Independent actual-function probes reproduce cross-account offline sale replay in foreground and SW. Fix assigned; mismatched/ownerless records must remain recoverable, not silently submitted or deleted. This blocks the next release.

AI Council release decision (one lead simulating five perspectives, not five independent advisors):
1. Skeptic: a green costing suite does not protect an offline sale from wrong-actor replay; release confidence is overstated without that boundary.
2. Engineer: durable write identity, authorization and queue ownership must agree at dispatch and server admission; cookie identity alone is insufficient.
3. Expansionist: eventually exercise an end-to-end device/account/failure matrix automatically on every release. Aspirational, not current coverage.
4. Outsider: a user changing accounts must not unknowingly inherit another person's pending actions; retained recovery must be understandable.
5. Executor: first make the observed A-to-B replay fail safely in both paths, with tests demonstrating the old failure.
Anonymous cross-critique: A's strongest point is the concrete release risk but does not prescribe recovery; B supplies the invariant but needs legacy treatment; C broadens coverage but cannot delay the minimal repair indefinitely; D protects user comprehension but needs server proof; E is actionable but must include SW as well as foreground.
Chairman: within the next release decision, prioritize ownership enforcement and retained quarantine; biggest risk is silent wrong-account writes or lost queued work. Number-one step is the failing-then-passing replay regression. Keep cost migration/deployment pending this check.

| Request | Current evidence/status | Remaining acceptance |
| --- | --- | --- |
| Separate cost viewing and entry permissions; non-admin defaults off | Implemented frontend and Worker, including imports, exports, supplier totals, audit and revocation surfaces. POS always hides costs. Focused security checks pass. | Integrated broad certification and deployment. |
| Other restrictions previously enforced by design | Inventory in `2026-09-20-permission-candidates.md`. | Review discretionary capabilities individually; do not expose security invariants as bypass switches. |
| POS USD-only products; compact stock/deal and controls | Implemented locally. | Updated visual/browser certification. |
| Preview fixture errors | Dashboard/promotions plus tagged stock/stock-in session synthetic GET routes added. | Restart preview and verify visible pages. This is not production data. |
| Products and Contacts Conflicts menu icons consistent | Both map to Copy; focused mapping test passes. | Rebuild and responsive EN/KM browser verification. Content hubs intentionally unchanged. |
| Range trigger displays dates only; times inside picker | Shared presentation integrated in 1cb0f59b. Six focused suites and five-width browser checks passed in isolated implementation. | Final integrated verification; existing time-aware filtering preserved. |
| Every range has one external preset row with invisible horizontal scrollbar | Shared and Reports preset scrollbar styling integrated in 1cb0f59b; direct hosts inventoried. | Convert remaining direct hosts; remove duplicate internal presets; integrated keyboard/touch and narrow-screen checks. |
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

### Latest owner decisions and full-ledger reconciliation

- Expenses: timed ranges use entry timestamps; full-day ranges retain booked dates, matching Reports. Cross-layer implementation remains pending.
- Shift: optional full cash comparison (opening + additions + cash sales - cash refunds - expenses, with existing courier treatment reviewed separately). Differences never require a match or block closing/returns. Existing close-always and reconciliation tests pass; do not remove refund accounting. Owner describes the comparison as an admin view; authorization/UI review remains tracked.
- Help: concise EN/KM contact/import copy, semantic guide bullets, viewport-constrained scrollable help, long-token wrapping and keyboard/pointer behavior implemented. Responsive native-browser tests pass. Build detected a helper chunk cycle and the helper was relocated; final integrated rebuild pending.
- Frontend broad run: 490/490 pass, no skips. Worker full rerun pending; customer-return cancellation native test intermittently terminates with no diagnostic output, with one full isolated pass. This is unresolved verification instability, not proof of a return logic defect or a green gate.

Older public work explicitly retained:

| Item | Evidence / remaining work |
| --- | --- |
| P9-3 public policy wording | Dirty draft in preserved lane-p9-public-home; verify actual retention before stating definite promises. |
| P9-4 chat-first assistant | Current UI profile-first. Unmerged 551a42ba is backend history only; implement composer/conversation, optional preferences, consent, bounded context and stale-response fencing. |
| P9-5 front-page collections | Featured/trending/bestseller badges exist; requested separate collections absent. |
| P9-6 account recovery | Partial dirty backend/transport draft, no recovery UI. Draft migration0170 conflicts with existing history; requires new append-only migration and security review. |

Preserve all three older lane folders under the Claude scratchpad; no draft is assumed integrated.
Additional omitted issues: old precision refusal/cancellation/null-snapshot cases need reproduction;
logged-in tagged-stock smoke, CPU/expression-depth incident provenance, iOS input-size fixme,
legal identity/markets/image-rights facts and Telegram token rotation require evidence.
Do not reopen already completed supplier settlement0183, Program11 or sales-lineage fixes.

Account-owned offline replay, logout/stale-read cases, reproduced inline queue loss,
Free/Paid transfer budgets and quota checks, maintainability cleanup, ambiguous historical
customer/lot provenance, physical continuous-80mm printing, universal UI consistency,
and final single-folder consolidation remain open unless a later evidence entry closes them.
Primary business-os-v1 dirty work and private recovery archive remain protected.
Recorded production remains de8c72fa9514 / Worker 9d5b1644-9f8f-4826-b6f7-043ddd5cf6c2;
fresh runtime provenance was blocked by HTTP403. Migration0183 is already applied; do not replay it.
