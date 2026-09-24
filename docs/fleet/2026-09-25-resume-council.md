# Resume, organization and debloat council — 25 September 2026

## Scope and evidence

The owner requested one organized project home, removal of obsolete local
versions, a private Khmer Shop GitHub repository, continued unfinished Business
OS work, validation and an AI council. Five independent agents gave first-pass
opinions and then cross-critiqued anonymized A–E summaries. The chairman is the
executing root agent. This record distinguishes decisions from completed work.

The deployed source is 7e7cc7dcebd18f016ca732589acd52ed1133bc85, not main. The
standalone latest clone is the canonical Source. The previous shared checkout
has unique dirty/untracked/ignored content and 36 registered worktrees; deletion
would lose work or break dependencies. N1–N4 and N6 exist on separate remote WIP
branches based on bfa464f06038c46943b266ccf1aaae52038bf4b9. A fresh reports baseline
passes all three targeted test files; the float test's 16 assertions include
negative controls. The old failure note therefore does not justify a repair.

## Independent views and cross-critique

| View | First-pass position | Cross-critique and resulting constraint |
| --- | --- | --- |
| Skeptic (A) | Preserve unique data and Git dependencies; reconcile deployment before resuming. | A duplicate hash proves equal bytes, not absence of operational dependencies. Archive contents must be compared before recycling. |
| Engineer (B) | One canonical Source and verified recovery; N1–N4 before N6. | Keep server authorization and stale-state fencing independent of UI behavior; do not infer readiness from layouts. |
| Expansionist (C) | Establish stable project homes; finish WIP before Report Center. | Restrict debloat to proven dead code; shared report/document parity remains a later product opportunity. |
| Outsider (D) | Use understandable categories; preserve business records and active paths. | Compatibility junctions are a transition, not another physical project copy; record restoration paths. |
| Executor (E) | Reproduce reportsDetailFloatClose before selecting feature work. | Fresh green tests retire that proposed repair. Proceed with N1–N4; block integration on the demonstrated multi-member cost discrepancy and unknown-outcome retry hole. |

The backlog explorer preferred N6 first because it was the smaller lane. The
chairman chose N1–N4 first: it resolves the contact authorization decision and is
already the active isolated integration. N6 follows sequentially because their
undo and language files overlap. This is a sequencing judgment, not unanimous
agreement or evidence that N1–N4 was initially safe.

Execution refinement: N6's seven stock-in-specific files and Report Center 0b's
two Worker files can be prepared in isolated worktrees concurrently, without
ownership of the shared undo/language files. Integration and certification still
proceed N1–N4, then N6, then 0b. The parent owns shared conflict resolution.

## Chairman decisions

1. Use `C:/Users/mrkl6/Projects`, with a visible Downloads/Projects junction.
   Preserve locked active checkouts through project links and retain hidden old
   paths where tasks depend on them. Preserve the old dirty Business OS checkout
   in Recovery; record hashes/manifests before recycling verified duplicates.
2. Keep the deployed GitHub ZIP and deployment evidence. Preserve business-data
   archives and private configuration; do not publish them as source backups.
3. Create the Khmer Shop repository privately through its existing idle task.
   Its task reports tests/type checks and a clean GitHub clone validation.
4. Integrate N1–N4 only after keeper-selection reload, multi-member economics,
   unknown-outcome retries, permission enforcement, audit and undo are verified.
   Keep the complete WIP history; do not cherry-pick the obsolete manual-contact
   bypass. Contacts may merge only system-detected duplicate clusters.
5. Resume N6 afterward. Quantity/batch guards alone do not detect concurrent
   cost/supplier/date edits; add server conflict fencing and discriminating tests.
6. Keep Report Center and the held website-posts lane distinct. No unverified
   feature or new remote migration is part of the already completed deployment.

## Debloat blast-radius matrix

| Candidate | Callers and siblings checked | Other surfaces and decision |
| --- | --- | --- |
| shared/PageSizeSelect.tsx | No source import, export or dynamic loader; PaginationControls already renders a plain range and no per-page selector. | Remove dead component, obsolete Vite chunk branch, its obsolete assertion and iOS allowlist entry. Preserve all live pager assertions and keyboard/localized controls. No API/offline/permission/undo path changes. |
| products/import/productReplaceImportPlan.ts | Only its own orphan test imports it; no import.meta.glob or require.context loader. | Remove planner and orphan test. Live BulkImportModal still sends import_mode/replace_columns to Worker importEngine. Preserve productImportPlanner and direct/review import tests. |
| CurrentShiftSummary | The scope-review harness still imports/renders it. | Retain; absence from the production entry graph is insufficient to erase a harness dependency. |

No package or lockfile change is needed. Test discovery is automatic. Expected
benefit is less maintenance code; no bundle-size reduction is claimed for modules
that were already unreachable. Focused checks: paginationRangeControl,
iosLayoutGuards, productImportPlanner, productImportDirectApply,
productImportReviewSurfaces, testChainCoverage; then frontend typecheck/i18n/build.
Integration must retain the newer release's promotions-order fix and docs.

Debloat result: commit `f5ebbc9` removes 555 lines and adds one corrected comment.
All six focused files pass (0 skipped); frontend typecheck, verify:i18n and build
pass. Startup verification reports 269 static chunks with zero cycles and no
admin/file/import code in the public preload closure. The i18n audit reports 994
possibly unreferenced keys as candidates, not proof; none were deleted on that
basis. Build-generated line-ending-only files were restored to the same HEAD.

## Branch export follow-up map (council F2)

The branch stock export converts an omitted acquisition cost into numeric zero.
The actual openBranchExport callback feeds ExportOptionsDialog and its CSV,
XLSX and print projections. Worker branches.ts already applies
acquisitionCostResponses, which removes acquisition fields from paged/unpaged
stock data for users without product_cost_view. The fix must omit hidden columns,
retain an authorized known zero, preserve missing authorized values as blank,
and invalidate in-flight/dialog exports if actor or cost visibility changes.
Transfer exports contain no acquisition columns and keep their ordinary behavior.
No offline queue, write, audit, undo or i18n key changes are required. Pinned
neighbors are branchExportPermissions, branchesDateScope, branchesSelectAllI18n,
permissionActions, exportOptions, and the Worker acquisition-cost middleware test.

The new real-callback test failed before the fix because hidden cost columns were
present. It now passes ten hidden/visible/missing/zero/value scenarios and a cost
revocation race. All seven focused frontend files pass; the real Hono branch
stock endpoint preserves authorized zero and omits denied costs (76 checks in
test-acquisition-cost-access.cjs). Broad integration gates remain pending.

The frontend baseline at fd0a8a8 ran 549 files: 547 passed immediately and two
service-worker upgrade fixtures could not resolve historical Git commits in the
shallow checkout. After fetching the complete branch history from GitHub, both
fixtures passed unchanged (swLateUpgrade and swStaleChunkRecovery). No assertion
was weakened. Logs are under BusinessOS/Records/frontend-full-baseline-20260925.log
and frontend-sw-history-recheck-20260925.log. This baseline precedes WIP integration.

## Complete Sales export follow-up

Explorer and architecture review agree that walking all pages alone is not an
adequate F1 repair. Receipt rows round money before presentation, and the current
maximum-ID ceiling excludes inserts but does not detect edits. The selected
scope is one end-to-end Sales receipt export, using the existing report table,
CSV/Excel/print utilities and endpoint. A report registry and new routing are
outside this slice.

The Worker will derive searched receipt rows and canonical totals from the same
verified scalar snapshot. Its export token covers normalized query, insertion
ceiling, authorization projection, all authorized rows and authoritative totals.
It deliberately excludes hidden raw facts: otherwise the token could reveal
changes in hidden costs. Continuations and a final verification must match the
token. This certifies consistency at verification time, not a freeze on later
business edits. Export work is bounded to 10,000 source receipts before search,
with existing scalar limits retained; oversized ranges fail rather than truncate.

The frontend will freeze query, actor and display settings, validate every page,
and publish only after complete traversal and final verification. CSV, Excel and
Print use the same completed document and server totals. Excel keeps identifiers
as text and dates/money as typed values; print uses a fresh preview action to
avoid popup blocking after asynchronous collection. Permission revocation,
filter changes, navigation and malformed/incomplete responses invalidate output.

Implementation ownership is split between isolated Worker and frontend branches;
the parent owns translations and integration. Required evidence includes real
route cohort/precision/concurrent-edit checks, the actual Sales export action,
permission changes during collection/publication, and an Excel write/read round
trip with Khmer, leading-zero identifiers and business-midnight dates. The
broader Report Center, other capped reports and held website-posts lane remain
open. These five council perspectives use independent runs of the same model;
they are not evidence of model diversity.

## Confidence and limits

Independent follow-up found and reproduced a historical contact receipt allowing
an unrelated edited former cluster member to merge. Commit b653ce8 binds the
issued continuation to the exact pending request and contact/account snapshots;
the parent reviewed it and reran the 23 native test groups successfully. Lost
responses replay the frozen continuation, not a fresh snapshot of changed data.

The N1 product review also found lost-response retries, sequential pair means
disagreeing with the group preview, and missing stale-state fencing. Its repair
uses actor-bound operation receipts, frozen group economics and atomic state
checks. Query counting exposed repeated full graph reads; a single group read
now derives remaining subsets in memory. The existing pair kernel itself exceeds
the Free-plan budget. Free support remains unfinished; the new resolver must
present a translated blocker and refuse before writes. Paid-deployment checks
include the maximum 12-member group and middleware headroom. Platform limits were
checked against [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

Report 0b review corrected the initial proposal to match frontend policy:
Returns export requires Full access; Sales and Fees follow their existing allowed
export tiers. Ordinary report viewing stays separate. A raw non-none tier check
for every domain would have contradicted the existing Returns review restriction.

High confidence in the file organization and sequence; feature readiness depends
on completed tests and independent review, recorded in progress.md. Hidden recovery
content remains intentionally retained. The deployment's HTTP health is still
uncertified because of Cloudflare's challenge, despite confirmed 100% allocation.
