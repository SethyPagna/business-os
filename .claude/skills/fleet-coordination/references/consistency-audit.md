# Consistency audits: logic, buttons, pages, sibling surfaces

The user's binding rule: **a capability that exists on one surface exists on every sibling surface
that plausibly needs it, in the same unit of work** — "it has to be consistent, cannot have one
place not the other". Flagging an asymmetry in the log does not substitute for parity; if parity
genuinely makes no sense somewhere, ask *before* shipping the asymmetric version. The same holds
for logic: one rule, one canonical implementation, identical results on every layer that applies it.

## Method (the same four steps every time)

1. **Enumerate, don't sample.** Find every surface of the pattern mechanically — grep the component
   name, the route, the field, the helper — and list them. Sibling entry points hide in modals,
   bulk flows, import paths, the storefront, and the permission editor.
2. **Matrix.** Surface × capability (or layer × rule), one verdict per cell, expected vs actual.
   Blank cells are findings until filled.
3. **Confirm each finding from two angles** before it enters a report: source read + rendered
   check, or frontend rule + backend rule, or code + a pure test running the real code of both
   sides on one dataset. A single grep is a lead, not a finding.
4. **Fix parity in the same commit as the feature**, then re-run the matrix. A parity fix that
   lands later is a second bug report waiting.

Record large matrices as a dated doc in `docs/` (shape: `docs/nested-ui-action-audit-2026-09-01.md`);
small ones go straight into the session-log **Verified** section.

## Mechanical checks first

Several conventions already have locks. Run them before auditing by eye, and add a lock for any new
convention you find yourself checking by hand twice.

| Convention | Lock / check |
|---|---|
| Every referenced translation key exists in **both** packs, via every wrapper shape (`t`, `T`, `tr`, `safeT`, `copy`, `translate(t,·)`, `tKey:`) | `cd frontend && npm run verify:i18n`; `tests/langKeyIntegrity.test.ts` |
| Every real button in a review-tier section has a `PERMISSION_ACTIONS` row (`frontend/src/utils/permissionActions.ts`), a unique `perm_act_<section>_<action>` tKey, pack entries, and a backend `getActionTier`/`isActionBlocked` gate at the route | `tests/permissionActions.test.ts`, `tests/permissionEditor.test.ts`, `cloudflare/scripts/test-route-permissions-pure.cjs` |
| Mutation success never gated on a bare `result.success` for entity-returning endpoints; no optimistic "done" | `tests/mutationSuccessContract.test.ts`, `tests/stockMutationSafetyContract.test.ts` |
| Filters float in the shared body-level portal, never insert a row; chosen filters show only inside `FilterMenu` | `tests/floatingFilterMenus.test.ts` |
| Page root owns its scroll (`.page-scroll`), one scroll root per page | `tests/pageScrollRoots.test.ts`, `tests/globalScroll*.test.ts` |
| Section chips are one bounded row, no nested sub-tabs, folded actions reachable | `tests/sectionNavigation.test.ts`, `tests/nestedUiIntegrity.test.ts` |
| Dense excel-style tables on desktop with `ColumnChooser`, purpose-built cards below 768px | `tests/denseTableSurfaces.test.ts`, `tests/productsResponsiveSurface.test.ts`, `tests/salesPolishSurface.test.ts` |
| Frontend ↔ backend rule parity (product identity; revenue kernel vs `/stats`) | `tests/productDetailRuleParity.test.ts`, `cloudflare/scripts/test-sales-revenue-convergence-pure.cjs` |
| Source parses; public runtime scripts are current | `npm run check:source`, `npm run verify:public-runtime` |

Note: a script name in `package.json` is not evidence that a check exists. `verify:ui` and
`verify:performance` pointed at files deleted with the old `backend/` architecture (commit
`9ba4e843`) and stayed as dead entries through 20+ Part entries that "could not run them" until
Part 580 removed them. Before citing any lock, confirm its file is present (`ls ops/scripts/frontend`
/ `frontend/tests`) and run it — a claimed check must be observed, not assumed (Golden Rule 6).

## The convention checklist (audit by grep, confirm by eye)

Each line names the rule, then how to find violations. These are the user's standing decisions;
they are not stylistic preferences to be re-litigated per surface.

**Buttons and actions**
- Every mutating control confirms through the shared `components/shared/ConfirmDialog.tsx`. A
  native popup is a violation — lead: grep `window.confirm`, bare `confirm(`, `alert(` in
  `frontend/src` tsx files.
- A "disabled" feature stays visible but inert with an explanatory notice — never deleted.
- A button that exists on one representation of a record (row, card, detail modal, bulk flow,
  Branches-page section) exists on its siblings. Grep the action label or handler name across
  `components/<domain>/` and list where it is missing.
- Modals and floats have **one** close affordance (the header X). A second Close/Cancel that only
  closes is a violation.

**Text and i18n**
- Truncated text is revealable on hover **and** click via `components/shared/TruncatedText.tsx`;
  a bare `truncate` class on a label that can overflow is a dead end — lead: grep `truncate` in
  `frontend/src/components` tsx files, excluding the shared component itself.
- Explanations live in `InfoHint` tooltips, not inline prose; details fold into rows/expanders;
  controls share rows (the density preference).
- Both packs are updated for every new string; new keys go into a locally-sorted slot
  (prev ≤ new ≤ next), never appended blindly. Khmer is verified from authoritative sources and
  kept concise.
- Public surfaces (storefront, receipts, portal) never show supplier names, facets, admin loading
  splashes or other admin chrome.

**Lists and pages**
- Every list section pins **both** its search row and its Start→End date row while scrolling; the
  one date row scopes the list **and** the stats together; headline counts count only records that
  contribute to the money shown.
- Grouped lists: no synthetic parent rows, excel-style expanded child tables, checkboxes only in
  select mode, Start→End range instead of period presets.
- The stats header row (date row + secondary/add buttons) is laid out identically across all
  Sales-page sections.
- Dashboard cards stay compact — sized to the shortest card in the row, in-card scroll for
  overflow, one legend beside the chart.
- Expansions float above content instead of pushing it down; option chips collapse into one
  dropdown; controls sit on the section title row.
- "Take advantage of space" means grow vertically — never widen into space that text needs.
- Multi-area pages split into top-level section chips shown one at a time — never stacked in one
  scroll, never nested sub-tabs; mini-sections go below the top section row.

**Data and logic**
- Dates render `mm/dd/yyyy` + 24-hour everywhere; batch codes are numeric `MMDDYYYY`; sale receipt
  ids are bare `YYYYMMDD-HHMMSS` (returns keep `RET-`/`SRET-`); all bucketing is the fixed UTC+7
  business day via `cloudflare/src/lib/businessDateWindow.ts`. Leads: raw `toLocaleDateString(` /
  `toLocaleString(` in the frontend, hand-rolled `date(created_at)` in SQL.
- One canonical revenue definition (net sales: tax and delivery excluded, refunds subtracted,
  unpaid credit shown as Pending) on **every** surface that shows revenue — Dashboard, Sales
  `/stats`, the Reports kernel, exports. A new surface joins the shared kernel; it never re-derives.
- Stock keeps batch **and** branch identity end to end (in same batch, out same batch, return same
  batch). Exactly two canonical branches: `shop` sells, `warehouse` never does — verify branch
  state against **production** D1, not the local copy, before treating a stray branch as real.
- Change money uses its own exchange rate; KHR rounds to 100-riel increments.
- A conflict/merge resolution **moves every linked record** (sales, returns, ledgers, every FK)
  onto the survivor — re-audit every resolve path whenever a new FK table appears.
- Permissions are per-function/per-action grants, not only coarse section tiers; user/role
  management is admin-only by design (the `users` key is not a per-role toggle).
- A frontend validation rule has a backend twin, and one pure test runs both on the same data.

**Code hygiene**
- No zombie code: every new symbol has an importer, every removed feature has no dead callers,
  no parallel copy of an existing implementation (`BulkAddStockModal` re-implementing
  `BranchStockAdjuster` is the canonical example). Grep the symbol across both packages before
  and after.
- Before changing a seeded value or default, grep for code that **writes it back** (an
  every-request invariant once undid an org rename). A default expressed as an array index moves
  silently when the array is reordered.

## Reporting a consistency finding

State the rule, the surfaces that comply, the surfaces that don't (file:line), the two angles that
confirmed it, and the fix commit — or, if it is being left, the user decision it is waiting on.
"Products has a batch picker; the bulk-add modal and the Branches stock-add do not (source +
rendered on 8787); fixed in `<hash>`" is a finding. "Some surfaces may lack the picker" is not.
