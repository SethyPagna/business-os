# Design spec — multi-select bulk actions: Sales · Returns · Expenses · Reports

**Session:** business-os-v1-4f · **Date:** Sep 3 2026 · **Status:** DESIGN ONLY — no implementation code exists.
**Base:** `c2bb7e6c` (d9's `hotfix/prod-2026-09-03` tip, the post-ChatGPT-batch base every lane works from).
**For:** business-os-v1-d9 — the "Multi-session coordination plan" coordinator — for final verification and reconciliation.

> Written as **reference to re-verify**, not ground truth. Every code fact below carries a file:line lead so
> the reconciler can re-derive it. Facts were read from the tree at `c2bb7e6c` on Sep 3.

---

## 1. The ask

> "the sales, returns, expenses/incomes/report, etc… make multi select actions. especially for sales,
> returns, expenses… so for sales like status change, copy receipt id, etc… returns as well regarding
> edit returns and so on…. i want you to create logics and design it professionally use best practices."

Three surfaces get real multi-select bulk actions (Sales, Returns, Expenses), Reports gets a read-only
variant, and the three near-duplicate selection implementations that exist today are collapsed into one
shared primitive.

---

## 2. What already exists (verified at `c2bb7e6c`)

| Surface | Selection state | Bulk actions today | Gap |
|---|---|---|---|
| **Sales** | yes — `selectedIds: Set<number>`, `sales/Sales.tsx:257` | Export selected (`:1125`), bulk status to completed / awaiting_delivery / cancelled (`:1167`, `:1416-1418`) | No copy-receipt-id, no eligibility preview, no per-row failure reporting, no `updated_at` concurrency guard |
| **Returns** | yes — `selectedIds`, `returns/Returns.tsx:333` | Export selected ONLY (`:1047`) | No bulk edit — the headline ask |
| **Expenses (fees)** | none — `fees/FeesPage.tsx` has no selection at all | none | Entire feature absent |
| **Reports** | none | none | Read-only surface; see §5.4 |

Three separate selection implementations exist and have drifted:
`sales/Sales.tsx:204 countSelectedIds`, `returns/Returns.tsx:233 countSelectedIds` (byte-similar but typed
differently — `Array<number|string>` vs `number[]`), and
`products/helpers/productSelectionHelpers.ts:104-178` (the most complete: `buildSelectedVisibleIds`,
`isSelectionScopeFullySelected`, `isSelectionScopePartiallySelected`).

**The Golden Rule "one rule, one implementation" is already violated here.** Phase 0 fixes that before any
new surface is added, so Expenses does not become a fourth fork.

Existing infrastructure this spec reuses rather than reinvents:

- `frontend/src/utils/bulkOps.ts` — `runConcurrentTasks(items, worker, {concurrency})`, already returns a
  per-item `{ok, item, index, value|error}` result array. **This is exactly the shape a per-row bulk result
  needs**; it is already imported by `Sales.tsx:24`.
- `frontend/src/components/shared/ConfirmDialog.tsx` — the single shared compact review dialog, exports
  `ConfirmReviewItem` (`:24`). Every bulk confirm uses this; never `window.confirm`.
- `cloudflare/src/lib/permissions.ts:238 getActionTier(user, section, action)` — the per-action grant
  registry. Already live: `sales:status`, `sales:customer`, `returns:edit`, `returns:add`,
  `returns:settle_difference`, `fees:add`, `fees:edit`, `fees:delete`, and the destructive-bulk precedents
  `products:bulk_delete`, `contacts:bulk_delete`.
- `cloudflare/src/routes/fees.ts` — `FEE_TYPES` (`:43`) and the label cascade engine
  `/labels/impact`, `/labels/replace`, `/labels/classify` (`:297-346`). Bulk relabel/reclassify drives
  these; it does **not** get a second implementation.
- `assertUpdatedAtMatch` + `WriteConflictError` (used at `sales.ts:1020`, `returns.ts:1758`) — the
  optimistic-concurrency guard. §6.3 makes it mandatory for bulk.
- `ActionHistoryBar` + `cloudflare/src/lib/undoAppliers.ts` — undo/redo. `Sales.tsx:1188` already registers
  a bulk-status undo entry; §6.5 generalises it.

---

## 3. Design principles

1. **A bulk action is the single-row action applied N times — never a second code path.** Every bulk
   endpoint re-validates each row through the *same* helper the single-row route calls. A rule the
   single-row path enforces (status transition guards, settlement gates, restock reversal) is enforced
   identically per row, or the action is not offered in bulk.
2. **Nothing is silently skipped.** Ineligible rows are surfaced by name and reason *before* the user
   confirms, and again in the result.
3. **No silent partial writes.** Every action declares its atomicity (§6.4) and every response carries a
   per-row outcome.
4. **Selection is data, not chrome.** Checkboxes exist only in select mode; the count lives in the bulk
   bar; nothing spills into the toolbar as chips.
5. **Bulk never widens a permission.** A user who cannot change one sale's status cannot change fifty.

---

## 4. Shared primitives (Phase 0 — build first)

### 4.1 `frontend/src/hooks/useRowSelection.ts` (new)

One hook replacing the three forks.

```ts
export function useRowSelection(): {
  selectedIds: Set<number>
  selectionModeActive: boolean        // an explicit mode, NOT merely size > 0
  enterSelectMode(): void
  exitSelectMode(): void              // also clears
  toggle(id: number): void
  toggleGroup(ids: number[]): void    // grouped child tables
  selectVisible(ids: number[]): void  // the header checkbox = current page only
  selectAllMatching(ids: number[]): void
  clear(): void
  isGroupFullySelected(ids: number[]): boolean
  isGroupPartiallySelected(ids: number[]): boolean
  selectedOf<T extends { id: unknown }>(rows: T[]): T[]
  count: number
}
```

Semantics settled here, because today's two implementations disagree:

- **`selectionModeActive` is an explicit mode, not `size > 0`.** `Sales.tsx:264` and `Returns.tsx:338`
  both derive it from `selectedIds.size > 0`, which means deselecting the last row silently drops the
  user out of select mode and the checkbox column vanishes under the cursor. The standing convention is
  "checkboxes only in select mode" — that is a mode the user enters and leaves, not a side effect of
  count. Fixing this is part of Phase 0.
- **Selection persists across filter / date-range / page changes**, keyed by id. It is *not* cleared when
  the list re-queries, because the real workflow is filter, select, filter again, act.
- Because it persists, the bar must always disclose scope: `24 selected · 8 on this page`.

### 4.2 `frontend/src/components/shared/BulkActionBar.tsx` (new)

Replaces the two divergent inline toolbars (`Sales.tsx:1409`, `Returns.tsx:1045`).

```tsx
<BulkActionBar
  count={24} visibleCount={8}
  actions={actions}          // BulkAction[] — see §4.4
  onClear={clear} t={t}
/>
```

- Desktop: sticky row directly **below** the already-sticky search and date rows (both pages already pin
  those — the `Returns.tsx:1110` comment documents the pattern). It must not become a third independently
  sticky element that fights them; it shares their scroll container.
- Mobile (< 640px): the bar docks as a **bottom sheet** over the card list — a float, not an inline block
  that pushes cards down. Primary action full-width, overflow behind a single "More" sheet.
- Contents, left to right: count pill · primary actions · overflow menu · `Clear` (right-aligned).
- Never more than **4** visible actions; the rest collapse into one overflow menu.

### 4.3 `frontend/src/components/shared/BulkResultDialog.tsx` (new)

The partial-failure surface. Per the standing rule that a failed mutating action keeps its dialog open
with values intact and marks failed rows with a reason, a bulk run that is not 100% successful **does not
close and does not toast**. It swaps the confirm dialog's body for a result list:

- `18 changed`
- `3 skipped` — each with row label and reason (ineligible, decided before the write)
- `3 failed` — each with row label, server reason, and a per-row **Retry**, plus **Retry all failed**
- The original selection is **retained**, reduced to the failed rows, so a retry is one click.
- Only an all-success run closes the dialog and emits the single success toast.

### 4.4 The `BulkAction` contract

```ts
type BulkAction<TRow> = {
  key: string
  label: string; tKey: string
  tone?: 'default' | 'danger'
  permission: { section: string; action?: string }   // checked in the BUTTON and in the ROUTE
  atomicity: 'per-row' | 'all-or-nothing'
  eligible(row: TRow): { ok: true } | { ok: false; reason: string; tKey: string }
  confirm(rows: TRow[]): ConfirmReviewItem[]          // shared ConfirmDialog payload
  run(rows: TRow[]): Promise<BulkRunResult>
}
```

`eligible()` is the heart of the design: it runs **client-side for the preview**, and its rule is mirrored
by the same server helper for the write. It is what makes "nothing silently skipped" mechanical rather
than aspirational.

---

## 5. Per-surface actions

### 5.1 Sales — `sales/Sales.tsx`, `sales/SalesListSurface.tsx`

| Action | Permission | Atomicity | Eligibility rule |
|---|---|---|---|
| **Change status** to completed / awaiting_delivery / awaiting_payment | `sales:status` (existing) | per-row | `guardSaleStatusTransition(old, next, status_before_cancel)` — the same guard `sales.ts:1041` calls. Rows failing it are listed as skipped with the guard's own message. |
| **Cancel** | `sales:status` | per-row | Same guard. Opens the existing `CancelSaleModal` in bulk mode — `Sales.tsx:288` already models `{mode:'bulk', count}`; reason, note and cancel fee apply to **every** selected sale, and the dialog says so explicitly. |
| **Copy receipt IDs** | `sales` (view tier suffices — read-only) | n/a | All. Copies **bare `YYYYMMDD-HHMMSS`** ids, newline-joined, in list order. A second overflow item, *Copy as table*, yields `receipt_number<TAB>date<TAB>total` for pasting into a sheet. |
| **Export selected** | `sales` + existing export grant | n/a | All. Already built (`Sales.tsx:1125`) — rehomed into the shared bar unchanged. |

Deliberately **not** offered in bulk, with reasons the reconciler should check rather than assume:

- **Edit customer** (`sales:customer`) — a bulk customer reassignment silently rewrites who owes money on
  N sales and interacts with the receivables ledger. Single-row only until someone specs the ledger
  consequences.
- **Delete** — sales have no delete route in this app; cancel is the reversal.

### 5.2 Returns — `returns/Returns.tsx`, `returns/ReturnsListSurface.tsx`

The headline ask ("returns as well regarding edit returns") needs a careful boundary, because
`PATCH /returns/:id` is not a plain field update: `returns.ts:1711` reverses every previously-restocked
item's batch and re-applies restocking against **live** batch state, and `returns.ts:1780` documents a
settlement gate that had to be hoisted above the stock writes after it corrupted stock once.

**Therefore bulk edit covers metadata only, never items.**

| Action | Permission | Atomicity | Eligibility rule |
|---|---|---|---|
| **Edit selected** — `reason`, `return_type`, `notes` | `returns:edit` (existing) | per-row | Customer-scope only (`returns.ts:1748` refuses supplier returns); review tier refused outright (`returns.ts:1731`). Blank fields in the bulk form mean "leave unchanged" — only fields the user actually filled are sent. |
| **Change reason** | `returns:edit` | all-or-nothing | Drives the existing cascade `POST /returns/reasons/replace` (`returns.ts:650`) rather than N patches — it is already the one implementation of reason rewriting. |
| **Copy return IDs** | `returns` view | n/a | All. Preserves the `RET-` / `SRET-` prefixes (returns keep theirs; only sales went bare). |
| **Export selected** | `returns` | n/a | Already built (`Returns.tsx:1047`) — rehomed unchanged. |

**Items are single-row, permanently.** The bulk edit form states this in one line of InfoHint rather than
inline prose. If a user selects returns and wants item changes, the bar offers *Open first selected* to
step through them.

### 5.3 Expenses — `fees/FeesPage.tsx`

No selection exists today; this surface gets the full Phase-0 primitives.

| Action | Permission | Atomicity | Eligibility rule |
|---|---|---|---|
| **Delete selected** | **NEW `fees:bulk_delete`** | all-or-nothing | Follows the `products:bulk_delete` / `contacts:bulk_delete` precedent — destructive-at-scale gets its own key, so a role can hold `fees:delete` without holding bulk. **Review tier is refused, not queued**: `reviewApply.ts` has a single-fee applier only, and queuing N rows individually would flood the approval queue. The refusal message says exactly that. |
| **Relabel selected** | `fees:edit` | all-or-nothing | Drives `POST /fees/labels/replace` (`fees.ts:312`). Existing label rules stand: reusable saved tags, 6 words / 60 chars max. |
| **Reclassify type** | `fees:edit` | all-or-nothing | Drives `POST /fees/labels/classify` (`fees.ts:346`); target restricted to `FEE_TYPES` (`fees.ts:43` — `tax`, `delivery`, `change`, `expense`, `other`). Note `expense` must stay in that list — 4,240 historical rows carry it. |
| **Set direction** (expense / income) | `fees:edit` | all-or-nothing | **BLOCKED** on 6d's `fees.direction` column (migration 0107+, specified in `docs/rename-linkover-permissions-reasons-expenses-spec-2026-09-03.md` §4). Ships in the same phase as that migration, not before. Incomes never touch the revenue kernel. |
| **Export selected** | `fees` | n/a | All. |

### 5.4 Reports

Reports are **read-only presentation**, and are being rewritten right now by `rc/sec-10-reports`
(`FeesReportSection.tsx`, `ReturnsReportSection.tsx` and `SalesDailyReport.tsx` are deleted there and
replaced by `sales/reports/{Overview,Period,SalesList,Grouped,Returns,Expenses}Report.tsx` plus a rewritten
`ReportsHub.tsx`).

The user's ask named reports, so it is **not dropped** — it is sequenced:

- Reports get select mode with **read-only** actions only: *Copy selected rows*, *Export selected*.
- No mutating bulk action in a report view. A report row is an aggregate, not the record; editing belongs
  on the list surface that owns the record.
- **Targets the new report components, after `rc/sec-10-reports` merges.** Phase 4.

---

## 6. Backend contract

### 6.1 Endpoints (all new)

```
POST /api/sales/bulk-status
POST /api/returns/bulk-update
POST /api/fees/bulk-delete
POST /api/fees/bulk-update
GET  /api/{sales,returns,fees}/ids?<same filters as the list route>
```

### 6.2 Request and response shape

```jsonc
// request
{ "items": [ { "id": 41, "updated_at": "2026-09-03T04:12:09Z" } ],
  "patch":  { "sale_status": "completed" } }

// response — 200 even on partial failure; the per-row array is the truth
{ "applied": 18, "skipped": 3, "failed": 3,
  "results": [ { "id": 41, "ok": true,  "updated_at": "2026-09-03T06:20:01Z" },
               { "id": 42, "ok": false, "code": "WRITE_CONFLICT", "error": "…" },
               { "id": 43, "ok": false, "code": "INELIGIBLE",     "error": "…" } ],
  "action_history_id": 9912 }
```

### 6.3 Optimistic concurrency is mandatory

Every item carries `updated_at`; the route calls the same `assertUpdatedAtMatch` the single-row route uses
and returns `WRITE_CONFLICT` for that row alone. **Without this, a bulk write clobbers a peer's concurrent
edit silently** — precisely the class of bug this checkout has been fighting all week. A bare id list is
rejected with 400.

### 6.4 Atomicity

- `per-row` (sales status, returns metadata edit): each row is its own transaction. One row's failure
  never rolls back another's success — the per-row result array reports each outcome.
- `all-or-nothing` (fees delete, label and type cascades): one D1 batch. Any failure means zero writes,
  and the response names the offending row.

Either way the client sees per-row truth. **A bare success/failure toast is not an acceptable result
surface for a bulk action.**

### 6.5 Limits, chunking, undo

- Hard cap **500 items** per request (413 beyond it). The client chunks at **100** using the existing
  `runConcurrentTasks` with `concurrency: 6`, and merges the chunk results.
- One `action_history` entry per bulk operation carrying every row's before-state, so undo restores the
  whole operation — generalising what `Sales.tsx:1175-1189` already does for bulk status.
- Undo of a bulk operation is itself permission-checked through `applierPermissionTier`
  (`undoAppliers.ts:59`).

### 6.6 The `/ids` endpoints must fail loud

"Select all N matching" needs the ids behind the current filter. Session 16 found that
`GET /api/products/search` **silently ignores unknown query params** (`ids` and `search` are both dead
today), so an ignored filter returns page 1 of everything instead of an error — which in a *bulk* context
would mean acting on the wrong rows at scale.

**Rule for these endpoints: an unrecognised or unparseable query param is a 400, never a default.** An
`/ids` route that cannot prove it applied every filter it was given must refuse. This is a correctness
requirement, not a nicety, and the pure test in §8 asserts it.

---

## 7. UI conventions this design is bound by

Drawn from the project's standing rules, listed so the reconciler can check each mechanically.

- Checkboxes appear **only** in select mode; the checkbox column takes no width outside it
  (`SalesListSurface.tsx:130` already does this — keep it).
- Chosen filters live inside the shared `FilterMenu`; **no chips spilled into the toolbar row**. The
  "Select" entry point is a toolbar button, and the selection count lives in the bulk bar, not as a chip.
- Every mutating bulk action confirms through the **one shared `ConfirmDialog`**, never a native popup.
  The confirm body is a `ConfirmReviewItem[]` listing what will change and what will be skipped.
- The bulk bar is a **float** on mobile (bottom sheet), not an inline block that pushes content down.
- One close affordance per dialog (header X). No duplicate Cancel-and-X pairs.
- Grouped lists: no synthetic "parent" rows; group headers carry a tri-state checkbox driven by
  `isGroupFullySelected` / `isGroupPartiallySelected`.
- Long labels use the shared `TruncatedText`, so a truncated row name in a result list stays revealable.
- Both language packs, every key. Dark mode and 375px verified per surface.

---

## 8. Verification plan

**Layer 1 — source shape**

```
cd frontend && npm run test:utils && npm run verify:i18n && npm run build
cd cloudflare && npx tsc --noEmit && cd scripts && for f in test-*.cjs; do node "$f" >/dev/null 2>&1 || echo "RED $f"; done
```

**New pure tests** (`cloudflare/scripts/`):

- `test-bulk-status-guard-pure.cjs` — the bulk route's per-row guard produces byte-identical verdicts to
  the single-row `PATCH /:id/status` guard across the full status matrix (the "one rule, one
  implementation" lock).
- `test-bulk-concurrency-pure.cjs` — a stale `updated_at` yields `WRITE_CONFLICT` for that row only, and
  the other rows still apply.
- `test-bulk-atomicity-pure.cjs` — an `all-or-nothing` action with one bad row writes **zero** rows.
- `test-bulk-ids-strict-params-pure.cjs` — `/ids` returns 400 on an unknown param instead of returning
  everything.

**Frontend tests**: `useRowSelection` semantics (persistence across a filter change, tri-state group,
select-visible vs select-all-matching), plus a `BulkResultDialog` test asserting that a partial failure
keeps the dialog open with the failed rows still selected.

**Layer 5 — browser ledger**, expected vs actual, per surface × {desktop, 375px} × {light, dark}:
Sales, Returns and Expenses, each covering enter select mode, select across a filter change, confirm
preview lists skipped rows, force a partial failure, dialog stays open with reasons, retry, undo.

---

## 9. Phasing, and what blocks what

| Phase | Content | Blocked by |
|---|---|---|
| **0** | `useRowSelection`, `BulkActionBar`, `BulkResultDialog`; migrate Sales and Returns onto them with **no behaviour change** | nothing |
| **1** | Sales: copy receipt IDs, eligibility preview, `updated_at` guard, `POST /sales/bulk-status` | Phase 0; d9's `sales.ts` receipt-renumber hotfix must land first |
| **2** | Returns: bulk metadata edit + reason cascade, `POST /returns/bulk-update` | Phase 0; d9's `returns.ts` hotfix (replacement-sale accounting + receipt typeahead) must land first |
| **3** | Expenses: select mode + bulk delete / relabel / reclassify | Phase 0. *Set direction* additionally blocked on 6d's `fees.direction` migration 0107+ |
| **4** | Reports: read-only select (copy / export) | `rc/sec-10-reports` merging; targets the new report components |

**i18n**: ~24 new keys. Per the standing rule they are **not** edited on main — they ship as an additive
patch against d9's hotfix tip, both packs, Khmer verified from authoritative sources, folded at RC time:
`select`, `exit_select`, `selected_count`, `selected_on_page`, `select_all_matching`, `apply_to_selected`,
`bulk_change_status`, `copy_receipt_ids`, `copy_as_table`, `copied_n_ids`, `bulk_edit_returns`,
`bulk_change_reason`, `copy_return_ids`, `bulk_delete_expenses`, `bulk_relabel`, `bulk_reclassify`,
`bulk_set_direction`, `bulk_result_changed`, `bulk_result_skipped`, `bulk_result_failed`,
`bulk_retry_failed`, `bulk_reason_ineligible`, `bulk_reason_write_conflict`, `bulk_items_not_editable`.

**New permission key**: `fees:bulk_delete` — must be added to `permissionDefinitions.ts` (Fees block,
`:405`), to `rolePresetDefaults.ts`, and enforced in the route. No other new keys: every other bulk action
reuses the existing per-action grant, so bulk can never exceed single-row authority.

---

## 10. Open questions for the user

1. **Bulk cancel reason** — one reason and note applied to all selected sales, or per sale? This spec
   assumes **one for all**, stated plainly in the dialog. Per-sale would need a different UI.
2. **"Select all matching"** across a filtered set that spans pages — offered here behind an explicit
   second click. Confirm that acting on rows the user has not seen is wanted at all.
3. **Reports (Phase 4)** — read-only copy/export only, per §5.4. If mutating bulk actions were wanted
   *in the report views themselves*, that is a different design and needs saying.

---

## 11. Ownership and collision map (Sep 3, from live peer replies)

| File | Status | Source |
|---|---|---|
| `sales/Sales.tsx`, `SalesListSurface.tsx`, `returns/Returns.tsx`, `ReturnsListSurface.tsx`, `fees/FeesPage.tsx` | clean in main tree, unowned | 80, 6d |
| `cloudflare/src/routes/sales.ts`, `returns.ts` | in ChatGPT's live batch **and** in d9's hotfix today — build on the post-hotfix tip | d9, 80, 58 |
| `cloudflare/src/routes/fees.ts` | committed `3bf58d6c`, clean, unowned | 6d, 80 |
| `frontend/src/lang/{en,km}.json` | hot on both sides — keys delivered as a patch only | 80, d9 |
| `FeesReportSection.tsx`, `ReturnsReportSection.tsx` | **deleted** in `rc/sec-10-reports` | c1/8c |
| `BulkActionBar.tsx`, `hooks/useRowSelection.ts` | do not exist yet | 80 |

Peers confirming they hold none of these files, binding: 80, 58, 14, 16, c1, 6d.

**Path note for the record:** the language packs are at `frontend/src/lang/{en,km}.json` — verified by `ls`
and by the loader at `frontend/src/AppContext.tsx:348` (`await import('./lang/en.json')`). An earlier
`frontend/src/i18n/` report was corrected by its sender; that directory does not exist.
