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

## Confidence and limits

High confidence in the file organization and sequence; feature readiness depends
on completed tests and independent review, recorded in progress.md. Hidden recovery
content remains intentionally retained. The deployment's HTTP health is still
uncertified because of Cloudflare's challenge, despite confirmed 100% allocation.
