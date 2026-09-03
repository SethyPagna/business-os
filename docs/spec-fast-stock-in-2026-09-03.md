# SPEC — Lane A: Fast stock-in (preset batch, clearer save split, complete search)

**Status:** implementation spec. Written read-only from the isolated worktree
`C:\Users\mrkl6\Downloads\bos-rc-workers\s58-lanes` at detached HEAD `c2bb7e6c`. No source file was
edited producing this document. Every claim below carries a `file:line` that was actually read; things
that could not be verified are listed under **Could not verify** rather than guessed.

**User's words (verbatim):**
> "the current fast add stock, should have preset add batch like the one by one add stock… also the
> save and add more should be more divided and clear…and make sure the search capability search for
> all products fully, no missing, products when scan barcode."

---

## 0. Files this lane owns

| File | Why |
|---|---|
| `frontend/src/components/inventory/FastStockInModal.tsx` | the whole lane's UI (588 lines) |
| `frontend/src/lang/en.json`, `frontend/src/lang/km.json` | new + missing keys (§5) |
| `cloudflare/src/lib/searchMatch.ts` | barcode-equality clause builder (§4.3) |
| `cloudflare/src/routes/products.ts` | wire the clause into `buildSearchFilters` (§4.3) |
| `cloudflare/scripts/test-*-pure.cjs` | new pure test (§6) |
| `frontend/tests/*.test.ts` | new frontend test (§6) |

Files this lane must **not** touch: `cloudflare/src/routes/branches.ts`,
`frontend/src/components/branches/TransferModal.tsx` (Lane B), and anything under
`outputs/audit-58-20260903/` other than this file.

### 0.1 Two in-flight patches this lane must not clobber

1. **Session 6d i18n patch — 3 lines in `FastStockInModal.tsx`.** It converts the template-literal
   fallbacks inside `tr()` at the confirm/notify call sites to placeholder interpolation. On this
   worktree those three sites are:
   - `FastStockInModal.tsx:318-321` — `window.confirm(tr('confirm_complete_stock_session', \`Receive ${pending.length} product line(s), ${totalQuantity} total unit(s), into ${branchName}? …\`))`
   - `FastStockInModal.tsx:363` — `notify(tr('stock_session_completed', \`Received ${saved} stock-in line(s) successfully.\`))`
   - `FastStockInModal.tsx:364` — `notify(tr('stock_session_partial', \`${failed} line(s) could not be saved. Fix them and complete again.\`), 'error')`

   **Rule for this lane:** §3 replaces `window.confirm` at :318 with `ConfirmDialog`, and §2/§3 move
   the notify calls. Whatever the 6d patch turns those three `tr()` calls into, the *`tr()` calls
   themselves stay intact* — carry the patched key + placeholder form across verbatim into the new
   call sites. Do not revert a placeholder form back to a template literal, and do not drop a key.
   Diff `FastStockInModal.tsx` against the 6d patch immediately before committing.

2. **RC branch `rc/p2-2-search`** adds `frontend/src/hooks/useProductLookup.ts` (188 lines) and
   `frontend/src/hooks/useBarcodeScan.ts` (111 lines), plus `frontend/src/utils/productLookup.ts`.
   `docs/plans/search-scan-contract.md` on that branch lists **FastStockInModal** as a `TODO
   P2-4/P2-5` adopter whose endpoint was never even confirmed by that worker. §4.4 specifies Lane A
   so that adoption is a mechanical swap, not a rewrite.

### 0.2 Rulings received after this spec's first draft (2026-09-03)

This section records decisions handed down **after** the first draft, so a later reader can see they
were settled rather than overlooked. Each is marked with who decided it. The original questions are
kept in §8 with their answers attached, not deleted.

| # | Ruling | Decided by |
|---|---|---|
| R1 | A batch is identified **by its date**, as today (numeric MMDDYYYY). No richer batch selection is to be proposed anywhere. | **USER** |
| R2 | Same name + same details → merge. A **different barcode OR a different cost → a NEW child row.** Barcode and cost are identity fields; a cost mismatch must never auto-merge. | **USER** |
| R3 | Every operation that matches on name must sweep **EVERY** child row under that name, never the first or the visible one. | **USER** |
| R4 | The exact-barcode-equality fix (§4.3) is routed to **hf/search**, which must place an equality probe on the canonical barcode **before** the trigram probes. Lane A converges with it and does not duplicate it. | **d9 (coordinator)** |
| R5 | R2 and R3, plus "lots move lot-by-lot", are owned by **hf/merge**. This spec cross-references that owner rather than restating its scope. | **d9 (coordinator)** |

**USER's ruling, verbatim** (the authority for R1–R3):

> "can just keep batch into the date like currently in to days of batch, . it doesn't have to be
> complicated as currently, we do default all child rows have all branch details… so if we transfer
> it is just a matter of adding the stock from one branch to another…nothing really big deal.. the
> same name same details merge, different barcode or cost makes new child row etc… make sure check
> all child rows if name is same.."

**What R1 means for this lane specifically:** §1.3 stays exactly as written — a chip row of existing
lots plus one `+ New batch` chip, with the received **date** as the only new-lot input and
`dateToBatchCode` previewing the numeric MMDDYYYY code. That *is* "batch into the date". Nothing
richer (lot naming, supplier-keyed lots, expiry-first selection) may be added by this lane.

**What R2/R3 mean for this lane:** Lane A does not itself merge anything, but it feeds the identity
path — a fast stock-in that resolves to the wrong child row writes stock onto the wrong row. §4.5 is
the new section covering the sweep invariant and the one verified place on Lane A's own documented
path where it is violated today.

---

## 1. Requirement 1 — preset batch picker, identical to the one-by-one flow

### 1.1 What the one-by-one flow actually does (the parity target)

There are **three** sibling add-stock surfaces and they already agree with each other. The canonical
implementation is `ReceiveBatchModal`; `InventoryStockModals` is the same affordance inside the
Adjust-stock modal; `StockAdjustModal` (Products → Stock Changes) reuses `InventoryStockModals`
verbatim (`frontend/src/components/products/forms/StockAdjustModal.tsx:19-24` — "It REUSES
Inventory's own presentational adjust modal … deliberately NOT the leaner BranchStockAdjuster").

**A. Option source.** One call, refetched whenever product **or branch** changes:

- `frontend/src/components/inventory/ReceiveBatchModal.tsx:79-97` —
  `getProductBatches(productId, parsedBranchId, false)` inside a `useEffect` keyed
  `[product?.id, branchId]`, with `setBatchChoice('new')` reset at :82, `batchLoading` at :85/:95,
  and a real `.catch` that logs and empties (`:90-94`).
- `frontend/src/components/inventory/InventoryStockModals.tsx:193-223` — same call, keyed
  `[showBatchPicker, adjustTargetId, adjustBranchId, adjustForm.type]`, and it **clears the previously
  chosen batch id first** (`:201`) so a stale id from another product/branch can never ride to submit.
- Transport: `frontend/src/api/batchesTransport.ts:96-121` — `GET /api/batches?productId=&branchId=&onlyAvailable=`,
  cache key `batches:list:${productId}:${branchId}:${onlyAvailable?1:0}`, and **deliberately no local
  fallback** (`:113-120`): a failed request must reject, never resolve as "this product has no lots".

  The third argument is `onlyAvailable`. Add-stock passes `false` — every active lot, empty ones
  included, because topping an empty lot back up is a normal receipt
  (`ReceiveBatchModal.tsx:86-88`; `InventoryStockModals.tsx:204-209` passes
  `adjustForm.type === 'remove'`).

**B. The control is a chip row, not a `<select>`.**

- `ReceiveBatchModal.tsx:290-315`: label `tr('batch','Batch')`; while loading, `t('loading')`;
  otherwise `flex flex-wrap gap-1.5` with a leading `+ New batch` chip
  (`tr('new_batch','+ New batch')`, `:296-302`) followed by one chip per lot rendering
  `` `${batchDisplayLabel(batch, tr('batch','Batch'))} (${batch.quantity})` `` (`:303-312`).
- Identical markup in `InventoryStockModals.tsx:417-451` (chip classes
  `rounded-full px-2.5 py-1 text-[11px] font-medium border`, selected =
  `border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300`).
- Label text comes from `frontend/src/utils/batchLabel.ts` → `batchDisplayLabel` (last function in
  that file): a genuine custom lot code renders as the code; an MMDDYYYY code or a stored
  `received_at` renders as `mm/dd/yyyy`; then `"Batch n: mm/dd/yyyy"`; then `"Batch #id"`.

**C. New lot vs existing lot — the state contract.**

- `ReceiveBatchModal.tsx:75` — `const [batchChoice, setBatchChoice] = useState<'new' | number>('new')`.
  `'new'` = create-or-match-by-date; a number = top up that exact lot. Comment at `:69-74` states it is
  deliberately **not** persisted in the localStorage draft (a drafted lot id can go stale between
  sessions; `'new'` is always safe).
- Default for `add` is `'new'` — `InventoryStockModals.tsx:231-235` re-fills `'new'` once per
  target/branch/type combo; `remove` has no default and stays blank.
- Submit mapping — `ReceiveBatchModal.tsx:206-224`:
  ```
  receivedDate: batchChoice === 'new' ? (receivedDate || null) : null,
  batchId:      typeof batchChoice === 'number' ? batchChoice : null,
  ```
  Same rule in `StockAdjustModal.tsx:373-378` (`batchId` only when not unlocking pricing;
  `receivedDate` only when `add` **and** (`unlockPricing` or `batch_id === 'new'`)).

**D. Date field behaviour — visibility mirrors the choice.**

- `batchChoice === 'new'` → a `type="date"` **Received date** input plus a live batch-code preview
  `tr('batch_code_preview','Batch code'): dateToBatchCode(receivedDate)`
  (`ReceiveBatchModal.tsx:316-333`; `InventoryStockModals.tsx:464-479`). The preview matters because
  the date **derives** the lot code, and a matching code tops up that lot instead of creating a twin
  (`InventoryStockModals.tsx:457-463`).
- An existing lot → the input is **replaced by static text**, never disabled-but-present:
  `tr('existing_lot_keeps_date','Tops up the selected lot — its received date stays.')`
  (`ReceiveBatchModal.tsx:334-344`).
- Default received date is today — `ReceiveBatchModal.tsx:13-15,55` (`todayIsoDate()` → `todayStr()`).
- The backend always recomputes the authoritative code; the preview is display only
  (`ReceiveBatchModal.tsx:325-329`, and `frontend/src/utils/batchCode.ts` header).

**E. Supplier locking rides with the chosen lot.** `ReceiveBatchModal.tsx:180-183` computes
`selectedLot` / `lotAttributedName`; `:219-220` sends `null` for both supplier fields when the lot is
already attributed (first attribution sticks, `COALESCE` server-side); an unattributed lot still
offers the picker with hint `tr('supplier_will_fill_lot', …)` (`:363-365`). Mirrored at
`InventoryStockModals.tsx:237-256` and `:483-492`.

### 1.2 What the fast modal has today

**Nothing of the above.** `FastStockInModal.tsx` never imports `getProductBatches` (its imports are
lines 7-19; `batchesTransport` is imported only for `receiveBatchStock` at :15). Grep confirms the
only `getProductBatches` call sites are `TransferModal`, `InventoryStockModals`, `ManageBatchesModal`,
`ReceiveBatchModal`, `ProductDetailSheet`, `BranchStockAdjuster`, `ProductsImageOnlyView`,
`NewReturnModal` — the fast modal is absent.

Consequences, with evidence:

- No `batchId` is ever sent. `FastStockInModal.tsx:339-346` calls `receiveBatchStock({ productId,
  branchId, quantity, receivedDate, expiryDate, supplierId, supplierName, unitCostUsd,
  paymentStatus, creditDueDate, sessionId })` — the `batchId` field that
  `batchesTransport.ts:129-146` sends as `batch_id` is simply never populated.
- The received date is **shipment-level, not lot-level** (`FastStockInModal.tsx:122`, `:499-502`), a
  free-text `mm/dd/yyyy` input with **no batch-code preview** and **no default** (`''`, unlike
  `ReceiveBatchModal`'s `todayIsoDate()`).
- So every fast line silently takes the `'new'` path: create-or-match-by-date against a date the
  operator typed once for the whole shipment. Two lines for the same product in one session collapse
  into the same derived lot; an operator who needs to top up a *specific* existing lot cannot.
- This is a direct violation of the standing sibling-surface rule
  (`.claude/skills/fleet-coordination/…` / memory `cross-surface-consistency`): the capability exists
  on three sibling add-stock surfaces and is carved out of the fourth.

### 1.3 Specification

Add a per-line batch chip row to the "Next product" card, byte-for-byte the same affordance as
`ReceiveBatchModal.tsx:290-344`, scoped to the **currently picked product + the shipment branch**.

**State (add to the component):**

```ts
const [batchChoice, setBatchChoice] = useState<'new' | number>('new')   // NOT persisted in the draft
const [batchOptions, setBatchOptions] = useState<ProductBatch[]>([])
const [batchLoading, setBatchLoading] = useState(false)
const [lineReceivedDate, setLineReceivedDate] = useState('')            // see "Received date", below
```

Import `getProductBatches` and `type ProductBatch` from `../../api/batchesTransport.ts`, and
`batchDisplayLabel` from `../../utils/batchLabel.ts`, `dateToBatchCode` from `../../utils/batchCode.ts`.

**Fetch effect** — mirror `ReceiveBatchModal.tsx:79-97` exactly:

- keyed `[picked?.id, branchId]`;
- `setBatchChoice('new')` first, then bail with `setBatchOptions([])` when either id is missing;
- `getProductBatches(Number(picked.id), Number(branchId), false)` — **`false`**, this is an add;
- `cancelled` guard, `.catch` that `console.error`s and sets `[]` (never swallow silently — the
  transport deliberately rejects rather than resolving empty, `batchesTransport.ts:113-120`);
- `finally` clears `batchLoading`.

**Render** — inside the `{picked ? …}` block (`FastStockInModal.tsx:459-479`), directly **above** the
qty/cost/expiry grid so the lot is chosen before the numbers:

- label `tr('batch','Batch')`;
- `batchLoading` → `t('loading')` text;
- else `flex flex-wrap gap-1.5` with the `+ New batch` chip then one chip per lot,
  `` `${batchDisplayLabel(batch, tr('batch','Batch'))} (${batch.quantity})` ``, reusing the exact chip
  classNames from `ReceiveBatchModal.tsx:298` / `:307`.

**Received date — the one deliberate divergence, and it must be explicit.** The shipment header keeps
its single `received_date` field (`FastStockInModal.tsx:499-502`) because that is the whole point of
the fast flow ("entered ONCE, applies to every line", header comment lines 1-6). Layer the lot rule on
top of it per line:

- `batchChoice === 'new'` → the header date applies. Show, under the chip row, a **read-only** preview
  line: `` `${tr('batch_code_preview','Batch code')}: ${dateToBatchCode(receivedDate) || '--'}` `` —
  same string and same `dateToBatchCode` the siblings use. Also give the header field a today default
  (`todayStr()` from `../../utils/dateHelpers.ts`) so the preview is never `--` on open; today the
  field opens empty (`:122`).
- `batchChoice` is a number → show
  `tr('existing_lot_keeps_date','Tops up the selected lot — its received date stays.')` instead of the
  preview, verbatim from `ReceiveBatchModal.tsx:341`.
- **Optional per-line override** (`lineReceivedDate`): only render an input for it when
  `batchChoice === 'new'`, and only as a collapsed affordance so the compact/low-prose rule holds. If
  the reviewer prefers to keep the fast flow strictly header-only, drop `lineReceivedDate` entirely —
  this is flagged as **Open decision A** in §8.

**Carry the choice onto the queued line.** `ReceivedLine` (`FastStockInModal.tsx:48-58`) gains:

```ts
batchChoice: 'new' | number
batchLabel: string        // frozen at queue time, for the "Received this session" row
```

`addLine` (`:258-285`) writes them; `editLine` (`:287-297`) restores `setBatchChoice(line.batchChoice)`;
`resetLine` (`:207-216`) sets `setBatchChoice('new')`.

**Submit mapping** — in `commitSession` (`:324-359`), for the `receiveBatchStock` arm (`:339-346`) add,
using the same two-line rule as `ReceiveBatchModal.tsx:213-214`:

```ts
batchId:      typeof line.batchChoice === 'number' ? line.batchChoice : null,
receivedDate: line.batchChoice === 'new' ? (receivedDate.trim() || null) : null,
```

The `adjustStock` arm (`:328-338`, the create-price-variant path) must keep sending **no** `batchId`:
unlocked pricing always creates a fresh lot (`InventoryStockModals.tsx:452-456`,
`tr('batch_auto_new_unlocked', …)`). When `createPriceVariant` is on, **hide the chip row entirely**
and show that same `batch_auto_new_unlocked` note — mirroring the sibling's own visibility rule.

**Show the lot in the queued-line row.** `FastStockInModal.tsx:539-550` currently renders
`{productName} × {quantity}`; append `· {line.batchLabel}` so what was chosen is visible before
Complete and after it (the post-write `detail` already shows the server's `lotCode`, `:348-352`).

**Batch identity invariant.** This whole section is the standing rule "stock keeps its batch AND
branch identity end to end" (memory `batch-identity-invariant`). Do not sum across lots anywhere in
this change.

---

## 2. Requirement 2 — "Save" vs "Save and add more", divided and clear

### 2.1 Current layout, exactly

Two *different* actions currently share near-identical affordances, and one of them changes label
under you:

| # | Control | file:line | Label | Disabled when |
|---|---|---|---|---|
| 1 | Queue-the-line button, inside the green "Next product" card, right of the total-cost text | `FastStockInModal.tsx:470` | `` `＋ ${editingKey ? tr('save','Save') : tr('add','Add')}` `` | `saving` |
| 2 | Mobile-only commit button, in the header | `:406-408` | `tr('complete_stock_session','Complete')` | `saving \|\| !received.length` |
| 3 | Desktop commit button, bottom of the scroll body, `ml-auto` | `:555-557` | `` `✓ ${tr('complete_stock_session','Complete stock-in session')}${successCount>0 ? ` — ${successCount} …` : ''}` `` | `saving \|\| !received.length` |

Problems, each evidenced:

- **Button 1 is the "add more" action but is labelled `Save` half the time** (`:470`) — when
  `editingKey` is set it says *Save*, and it means "put this line back in the queue", which writes
  nothing. Button 3 says *Complete stock-in session* and is the only thing that writes. Two controls,
  the word "Save" on the one that does not save. That is precisely the "should be more divided and
  clear" complaint.
- **Two dead i18n keys prove the labels regressed.** `frontend/src/lang/en.json:459`
  `"fast_stockin_add": "Add & next"` and `:461` `"fast_stockin_done": "Done"` exist in **both** packs
  (`km.json:459`, `:461`) but appear nowhere in the component — grep for `fast_stockin_add` in
  `frontend/src/` returns only the lang files.
- **Button 1 sits inside the flow of the grid**, sharing a cell with the total-cost text
  (`:468-471`), so it reads as a field decoration rather than an action.
- **Button 3 scrolls.** It lives inside `<div className="modal-scroll space-y-4 p-4">` (`:422`), not
  in a footer — so on a long queue the primary commit is below the fold. Every sibling modal puts it
  in a real footer: `ReceiveBatchModal.tsx:421-428` (`hidden … sm:flex` footer with
  `border-t`), `TransferModal.tsx:1181-1195`.

### 2.2 Specification

**Rename and relocate, do not add a third button.**

1. **Line action (button 1) becomes the explicit "add more" verb, in its own row.**
   Move it out of the qty/cost grid into a right-aligned action row directly beneath the grid, and
   label it:
   - not editing → `tr('fast_stockin_add', 'Add & next')` — revives the existing, already-translated
     key `en.json:459` / `km.json:459`;
   - editing an existing queued line → `tr('update_line', 'Update line')` (new key, §5).

   Keep the `＋` glyph only on the "Add & next" state; the update state gets no glyph. Keep the
   Enter-key shortcut on the quantity input (`:461`, `onKeyDown` → `addLine`) — it is the fast flow's
   whole reason to exist. Keep `disabled={saving}`.

2. **Commit action (buttons 2 + 3) becomes one primary in a sticky footer.**
   Move button 3 out of `modal-scroll` into a footer element that is a sibling of the scroll body,
   copying `ReceiveBatchModal.tsx:421-428`'s shape:
   `<div className="flex items-center justify-end gap-2 border-t border-gray-200 p-4 dark:border-gray-700">`.
   Because the panel is `flex flex-col` with `modal-panel-safe` (`:402`) and the body carries
   `modal-scroll` (`main.css:591-597`, `flex-1 … min-height:0`), a plain footer after the body is
   already pinned — no `position: sticky` needed. Keep the mobile header button (`:406-408`) **only if**
   the footer is `sm:hidden`-ed on phones as the siblings do; otherwise delete the header duplicate.
   Preference: keep one footer visible at every breakpoint and **delete the mobile header button**, so
   there is exactly one commit control (see Open decision B, §8).

   Footer content, left→right: a terse status span
   `` `${received.length} ${tr('lines_queued','queued')} · $${sessionCostTotal.toFixed(2)}` `` (reusing
   the total already computed at `:370-372`), then the primary
   `tr('complete_stock_session','Complete stock-in session')`.

3. **Explanations go in an `InfoHint`, not inline.** The difference between the two buttons gets a
   tooltip on the footer's info icon, not a sentence on the face of the card — standing rule
   (memory `ui-density-preference`): "Add & next queues this line; nothing is written until Complete."
   Follow the existing tooltip-button pattern at `InventoryStockModals.tsx:344-355`.

4. **One close affordance.** The header keeps exactly the `X` at `:418`. The minimize `−` at
   `:409-417` is a distinct action (park as a chip), not a close, so it stays. Do **not** add a footer
   Cancel — memory `ui-space-and-close-buttons`.

5. **Failed action keeps the form.** `commitSession` already does most of this: each line's failure is
   written back as `status:'error'` with the server message as `detail` (`:354-358`), and the early
   `return` at `:364` keeps the modal open and the draft uncleared on any failure. Two gaps to close:
   - the error `detail` renders in a `text-[10px]` span inside a `flex … gap-1` row (`:545`) with no
     wrap — a long server message is squeezed out. Give the row `flex-wrap` and let the reason wrap to
     a second line (memory `truncated-text-reveal`: never a dead-end ellipsis).
   - `onDone()` is called at `:361` *before* the failure branch, which refreshes the parent list under
     a still-open dialog. Harmless today, but move it after the partial/complete decision so the
     parent refresh cannot race a retry.

---

## 3. Requirement 2b — replace `window.confirm`

`FastStockInModal.tsx:318-321` uses `window.confirm`. The project has a shared compact review dialog
for exactly this (memory `confirm-dialog-preference`), and `ConfirmDialog`'s own header says it exists
to replace "~23 native `window.confirm()` popups (off-brand, untranslatable)"
(`frontend/src/components/shared/ConfirmDialog.tsx:5-12`).

Use it: `import ConfirmDialog, { type ConfirmReviewItem } from '../shared/ConfirmDialog'`. Follow the
park-then-confirm shape `StockAdjustModal` already uses — validate and `setPendingCommit(request)`
(`StockAdjustModal.tsx:405-407`), then a `commitAdjust`-style handler runs the write
(`StockAdjustModal.tsx:409+`).

Review rows (`items: ConfirmReviewItem[]`):

| label | value |
|---|---|
| `tr('branch','Branch')` | branch label from `branchOptions` (already computed, `:317`) |
| `tr('lines','Lines')` | `pending.length` |
| `tr('total_units','Total units')` | `totalQuantity` (already computed, `:316`) |
| `tr('total_cost','Total cost')` | `$${sessionCostTotal.toFixed(2)}` |
| `tr('received_date','Received date')` | the header date, or `tr('today','Today')` |
| `tr('supplier','Supplier')` | `supplier.supplierName` or `—` |
| `tr('payment','Payment')` | Paid / On credit + due date |

`note` = `tr('confirm_complete_stock_session_note','This posts stock movements and creates or updates the related lots.')`.
`working={saving}`. Pass `t` so the dialog translates its own chrome.

**The 6d i18n patch's `confirm_complete_stock_session` key must survive this move** — reuse it as the
dialog's `title`/`message`, do not delete it.

---

## 4. Requirement 3 — search must return ALL products, none missing, on scan

This is the substantive bug. There are **four independent defects** on the path; fixing only the
barcode one leaves products missing.

### 4.1 The path, end to end

1. `FastStockInModal.tsx:160-174` — one debounced (300 ms) effect serves **both** typing and scanning.
   `:163` bails when `picked || text.length < 2`. `:167` calls
   `searchProducts({ query: text, pageSize: 8 })`.
2. `frontend/src/api/methods.ts:522-525` — pass-through to the read transport.
3. `frontend/src/api/productReadTransport.ts:74-87` — builds
   `GET /api/products/search?query=<text>&pageSize=8`, cache key `products:search:<qs>`, abort group
   `'products:search'`.
4. `cloudflare/src/routes/products.ts:1010-1022` — `app.get('/search')`, auth-gated
   (`products.ts:76 app.use('*', requireAuth)`), delegates to `searchProductsWithIndexFallback` →
   `searchProductsPayload` (`:532`).
5. `products.ts:533-534` — `page` clamped 1..100000, **`pageSize = clampInt(query.pageSize, 20, 1, 100)`**
   (verified). `clampInt` (`:100-104`) clamps silently.
6. `products.ts:697` — `splitSearchTermGroups(query.query || query.q || '')`. **Only `query`/`q` are
   read.**
7. `products.ts:758-791` — three index probes are pushed into `matchClauses` and OR'd at `:861`:
   - `p.id IN (SELECT rowid FROM products_fts WHERE products_fts MATCH @ftsQuery)` (`:761-764`)
   - `p.id IN (SELECT rowid FROM products_fts_code WHERE products_fts_code MATCH @codeQuery)` (`:766-769`)
   - `p.id IN (SELECT rowid FROM products_fts_name_trigram WHERE … MATCH @nameCodeQuery)` (`:789-791`)
8. `buildFtsMatchExpression` (`cloudflare/src/lib/searchMatch.ts:620-643`) appends `*` to every word
   (`:632 const prefixed = formWords.map((w) => \`${w}*\`)`), column-scoped to
   `PRODUCT_SEARCH_COLUMNS = ['name','sku','barcode']` (`searchMatch.ts:691`). So for a scan of
   `6923644012345` the expression is `{name sku barcode}:6923644012345*`.
9. `buildTrigramMatchExpression` (`searchMatch.ts:743-750`) emits the bare word — a **substring** probe
   against the trigram tables (`migrations/0019_products_fts_code.sql:31-36`, barcode+sku,
   `tokenize='trigram'`).

### 4.2 Root cause — four defects

**Defect 1 (server, the barcode bug): there is no exact-equality barcode probe anywhere in the read
path, and no barcode normalization.**

- `buildSearchFilters` (`products.ts:685-994`) contains **no** `p.barcode = @x` clause. Barcode is
  reachable only by FTS *prefix* and trigram *substring*.
- The only barcode normalizer in the Worker is `normalizedBarcode` — and it is **not** in
  `productIdentity.ts` as the brief assumed; it lives at
  **`cloudflare/src/lib/productDetailRule.ts:92-94`**:
  ```ts
  function normalizedBarcode(value: unknown): string {
    return String(value ?? '').trim().toLowerCase()
  }
  ```
  **Confirmed: trim + lowercase only — no leading-zero, GTIN-14/EAN-13/UPC-A handling, no check digit.**

  **Correction (2026-09-03, raised by 6d and re-verified here).** The first draft said this helper is
  "not on the read path *and* consumed only by merge/identity work". The first half stands; the second
  half understated how load-bearing it is. `normalizedBarcode` is unexported, but it is reached from
  the identity path through one exported function, and that function is the identity rule for the
  whole app:
  - `productDetailRule.ts:110-116` — `productDetailSignature(row)` = `[normalizedBarcode(row.barcode),
    cents(row.cost_price_usd), cents(row.cost_price_khr)].join(SEP)` — where `SEP` is a literal
    U+0001 control character (verified byte-wise, `productDetailRule.ts:115`) and `cents()` is
    `Math.round(Number(value)*100)` (`:87-89`), so float noise from CSV round-tripping cannot fake a
    cost difference.
  - `productIdentity.ts:3` imports it; it is compared in **three** places:
    `:78` inside `findIdentityMatch` (single-row transfer merge, `branches.ts:380`),
    `:120` inside `findIdentityMatches` (the batched bulk-transfer counterpart, `branches.ts:645`),
    and `:362` as the Conflicts cluster bucket key inside `findDuplicateProductGroups`.
  - `productDetailRule.ts:123` — `productIdentitySignature` = name group + that signature.

  So **changing `normalizedBarcode` changes merge, transfer-merge and Conflicts clustering in one
  place.** (The brief cited `:64`, `:106`, `:306`; on this worktree at `c2bb7e6c` the comparison
  sites are `:78`, `:120`, `:362` — `findIdentityMatch` is *declared* at `:63`. The discrepancy is
  almost certainly line drift from the dirty main checkout; use the numbers above, which were read
  here.)

  **Binding consequence for whoever lands the barcode fix (hf/search, per R4):** either preserve
  `normalizedBarcode`'s current semantics exactly and add the new normalization *beside* it as a
  search-only helper, **or** re-run every identity test — `test-*identity*`, `test-*possibly-same*`,
  `test-*merge-duplicates*`, `test-*exact-duplicate*`, `test-*merge-same-detail*` — and reason
  explicitly about what a widened barcode equivalence does to auto-merge. Widening
  `normalizedBarcode` so that `0123456789012` and `123456789012` compare equal would make the
  Conflicts/auto-merge path start merging rows it deliberately keeps apart today
  (`normalizeLeadingZeroBarcodeForCleanup`'s doc comment at `productIdentity.ts:46-47` says the
  leading-zero fold is *cleanup-only*, and `:362` applies it **only** inside a same-name,
  same-cost bucket). **Recommendation: add a separate search-only normalizer; do not touch
  `normalizedBarcode`.**

  **This also confirms USER ruling R2 in code:** `productDetailSignature` is barcode + cost and
  deliberately excludes selling/special price (`productDetailRule.ts:101-108`, comment: two rows
  sharing a name and this signature "are the same product and must merge"; sharing a name but not it
  "are sibling child rows inside that name's group"). Barcode and cost are already the two child-row
  discriminators the user described. No code change is needed to *establish* R2 — but see §4.5 for
  where the **name** half of that rule leaks.
- The one leading-zero-aware helper is explicitly walled off from live matching:
  `cloudflare/src/lib/productIdentity.ts:48-51`
  `normalizeLeadingZeroBarcodeForCleanup` — doc comment `:46-47` "deliberately not used by ordinary
  create/transfer identity matching". It strips **exactly one** leading zero
  (`/^0[0-9]{4,}$/ … slice(1)`), so it would not cover UPC-A(12) → GTIN-14(14) anyway.
- `migrations/0001_init.sql:776` creates `idx_products_barcode_pg ON products (barcode)` — an index
  the search path never uses, because there is no equality predicate to use it.
- No `barcode_normalized` column exists; the only precomputed search columns are
  `migrations/0037_product_search_compact_columns_01.sql:63-65` (`name_normalized`,
  `unit_normalized`, `brand_compact`).

  **The failure is asymmetric, and the spec must say so precisely rather than repeat "prefix only":**
  - Stored `123456789012` (UPC-A, 12 digits), scanner emits `0123456789012` (EAN-13): prefix fails
    (`0123…` is not a prefix of `123…`) **and** trigram fails (a 13-char query cannot be a substring
    of a 12-char value) → **zero results**. This is the reported bug.
  - Stored `0123456789012`, scanner emits `123456789012`: prefix fails but trigram **succeeds** (the
    12-char query is a substring of the 13-char value) → found by accident.

  So the break is specifically "scanner emits *more* leading zeros than the DB stores", plus any
  encoding difference where neither string contains the other.

**Defect 2 (client, result truncation): `pageSize: 8`.** `FastStockInModal.tsx:167` requests 8, the
server honours it (`products.ts:534`, 8 is inside 1..100), and the modal **ignores `total` /
`totalPages` entirely** — `:169` reads only `payload.items`. The dropdown (`:432-441`) has no "show
more", no count, and no "N of M" line. A common name silently shows 8 rows out of hundreds. This is
literally "search … not all products, missing products" independent of any barcode issue.

Note a subtlety the fix must respect: `pageSize` is a **family** page size, not a row count.
`cloudflare/src/lib/familyPagination.ts:206-221` windows by `family_rank`, and `products.ts:638`/`:646`
(`expandSearchResultsToNameSiblings`, `:481-530`) expand the page to name-siblings — so
`items.length` can already exceed `pageSize`, and `total` counts families, not rows. Do not build UI
that asserts `items.length === pageSize`.

**Defect 3 (client, shared abort group): the fast modal's search can be cancelled by the page behind
it, and the cancellation is swallowed.** `productReadTransport.ts:77-86` puts **every**
`searchProducts` call in one abort group `'products:search'` — the comment at `:82-85` says this is
deliberate because "only ever one of them is being typed into at a time in a single tab". That
assumption is false for this modal: `FastStockInModal` is mounted from four places
(`Inventory.tsx:2433`, `Products.tsx:4260`, `StockChangeSection.tsx:869`,
`StockInSessionsSection.tsx:291`), and the Products page's own search box, a background list refresh,
or `Products.tsx`'s search all share that group. When one wins, the modal's request aborts and
`FastStockInModal.tsx:171` swallows it (`catch { /* suggestions only -- typing again retries */ }`)
leaving the previous `candidates` on screen — stale rows that look like "the product is missing".

**Defect 4 (client, minimum length): `text.length < 2`** (`FastStockInModal.tsx:163`) means a
single-character query returns nothing at all. Minor, but it is a real "no results" case.

### 4.3 Server fix — add an exact + normalized barcode probe

> **Owner: hf/search (d9 ruling R4, §0.2). SETTLED — this is a decision, not a proposal.** The
> equality-probe-before-trigram fix is that lane's, not Lane A's. This section stays in the spec as the *evidence and shape* hf/search should build to —
> Lane A must **not** land a competing implementation in `searchMatch.ts` / `products.ts`. Lane A's
> own work reduces to the client half (§4.4) plus consuming whatever contract hf/search ships. If
> hf/search lands first, Lane A verifies rather than re-implements; if Lane A is ready first, it waits.
> The identity-path caveat in §4.2 travels with this fix — it is hf/search's obligation, recorded here
> so it cannot be lost in the hand-off.
>
> **The shape is also settled (d9, 2026-09-03), not left to the implementer:** hf/search adds a
> **search-only barcode-folding helper**. `normalizedBarcode` (`productDetailRule.ts:92-94`) and
> `productDetailSignature` (`:110-116`) keep their current semantics **untouched**, and the auto-merge
> containment stays exactly as it is — the leading-zero fold remains cleanup-only and applies only
> inside a same-name, same-cost bucket (`productIdentity.ts:362`, doc comment `:46-47`). USER ruling
> R4 (barcode + cost are the child-row discriminators; a cost mismatch never auto-merges) is thereby
> preserved as-is. A reviewer checking this lane should confirm the diff adds a *new* helper and does
> not widen the existing one.

Add to `cloudflare/src/lib/searchMatch.ts`, exported, beside the existing builders:

```ts
export const MIN_REAL_BARCODE_LENGTH = 4

/** Every equivalent encoding of a scanned GTIN: the raw digits, the value with
 *  leading zeros stripped, and zero-padded to 12 / 13 / 14. Deduplicated. */
export function barcodeEquivalents(raw: unknown): string[]

/** `lower(trim(coalesce(p.barcode,''))) IN (@bc0, @bc1, …)` — binds into `params`,
 *  returns undefined when the query is not a plausible barcode. */
export function buildBarcodeEqualityClause(
  groups: readonly string[][],
  params: Record<string, unknown>,
  prefix: string,
): string | undefined
```

Gates (mirroring `frontend/src/utils/productLookup.ts:43-49` on `rc/p2-2-search`, so the two stay in
lockstep): exactly one group with exactly one word; digits only; length ≥ `MIN_REAL_BARCODE_LENGTH`;
not the shared `"0"` placeholder.

Wire it in `cloudflare/src/routes/products.ts` inside the FTS branch, pushed into `matchClauses`
alongside the three existing probes (so it is OR'd at `:861`, never narrowing an existing hit):

```ts
const barcodeMatch = buildBarcodeEqualityClause(searchTermGroups, params, 'bceq')
if (barcodeMatch && !titleOnly) matchClauses.push(barcodeMatch)
```

Insert immediately after the `products_fts_code` clause (`products.ts:766-769`) so the ordering reads
exact → substring → prefix. `lower(trim(coalesce(p.barcode,'')))` will not use
`idx_products_barcode_pg` as written; if EXPLAIN QUERY PLAN shows a scan at catalog scale, the
follow-up is a generated/normalized column + index, **not** dropping the clause — call that out rather
than silently shipping a scan.

**Apply the identical clause to the two sibling search routes** — the standing sibling-surface rule.
Both build structurally identical MATCH clauses today:
- `cloudflare/src/routes/inventory.ts:508` (`GET /api/inventory/products/search`), clauses at
  `inventory.ts:179-190`;
- `cloudflare/src/routes/branches.ts:865-875` (per-branch stock search).

> **Coordination:** `branches.ts` is Lane B's file. Lane A must **not** edit it. Either Lane B folds
> the same clause in, or it is a separate follow-up. Flagged as **Open decision C** (§8).

### 4.4 Client fix — and convergence with `rc/p2-2-search`

The RC branch supersedes this picker's plumbing. Build toward it, not against it.

- `frontend/src/hooks/useProductLookup.ts` (RC, 188 lines) already provides exactly what this modal
  hand-rolls: 180 ms debounce (`:82`), a stale-response guard via `requestIdRef` (`:137`, `:153`),
  `page`/`setPage`/`hasMore`/`total` (`:183`, `:185`), a **per-surface `cancelGroup`** (`:150`,
  `searchGroup: cancelGroup`) — which is the direct cure for Defect 3 — and a server-preferred
  `exactBarcodeHit` (`:163`, via `resolveExactBarcodeHit`).
- `frontend/src/hooks/useBarcodeScan.ts` (RC, 111 lines) generalizes `ScanSearchButton` and adds a
  keyboard-wedge detector. Its header (`:7-13`) restates the binding rule: a scan "must NEVER
  auto-add/auto-pick/auto-open anything"; it only calls `onValue(trimmedValue)`.
- `docs/plans/search-scan-contract.md` on that branch notes `ScanSearchButton` already satisfies the
  camera path, so a surface that renders it does **not** need `useBarcodeScan`.

**Therefore Lane A must:**

1. **Keep `ScanSearchButton`** at `FastStockInModal.tsx:443-449` exactly as-is. Its `onDetected`
   already does the correct thing — closes the camera (`ScanSearchButton.tsx:46 setOpen(false)`),
   trims, fills `query`, clears `picked`, and never selects. **Preserve that.** Standing rule
   `barcode-scan-select-then-confirm`.
2. **Do not** hand-roll a new debounce/abort. Shape the picker's state so the RC swap is mechanical:
   extract the search block (`:160-174`) into a single local `useProductSearch`-shaped call returning
   `{ results, loading, total, hasMore, loadMore }`. When `rc/p2-2-search` merges, replace the body
   with `useProductLookup({ endpoint: '/api/products/search', cancelGroup: 'fast-stockin:search',
   pageSize: 20, minChars: 1, queryParam: 'query' })` and delete nothing else.
3. **Fix Defect 3 now**, before the RC merge, with the smallest change that is forward-compatible: add
   an optional `searchGroup` argument to `productReadTransport.searchProducts` (it already threads one
   into `routeCachedProductQuery`, `:86`) and pass `'fast-stockin:search'` from this modal. Default
   stays `'products:search'`, so no other caller changes.
4. **Fix Defect 2**: raise `pageSize` from 8 to **20** (matching `useProductLookup`'s
   `DEFAULT_PAGE_SIZE`, `:84`), read `total`/`totalPages` off the response, and render two things
   under the dropdown:
   - a terse count line `` `${items.length} / ${total}` ``;
   - a "Show more" row when `page < totalPages`, incrementing `page` and appending — the exact pattern
     `TransferModal.tsx:895-904` already uses (`t('show_more')` exists).
   Cap the visible dropdown height as today (`max-h-48 overflow-y-auto`, `:433`).
5. **Fix Defect 4**: lower the minimum from 2 to **1** character (`:163`). A single digit or letter is
   a legitimate query; the server-side gating already handles short tokens
   (`buildShortWordFallbackClause`, `products.ts:836`).
6. **Exact-hit highlight, never auto-pick.** When the response carries `exact_barcode_hit_id` (present
   after the RC merge; absent today) mark that row `data-exact-hit="true"` and give it the selected
   chip styling — highlight only. The user still clicks it. Do not auto-`pick()`, do not auto-submit,
   do not auto-close. The unmatched-scan "Create product" affordance at `:451-458` keeps its existing
   guard (`scannedBarcode === query.trim() && searchCompleteFor === scannedBarcode && !candidates.length`).
7. **Do not swallow errors.** Replace the bare `catch {}` at `:171` with: ignore `AbortError`
   (name check, as `useProductLookup.ts:171-172` does), otherwise surface a one-line inline error under
   the input. A silent failure is indistinguishable from "no such product" — the exact confusion the
   `batchesTransport.ts:113-120` comment warns about.

---

### 4.5 Invariant — "check all child rows if name is same" (USER ruling R3)

> "make sure check all child rows if name is same.."

**The invariant, stated for implementers:** any lookup keyed on a product **name** must return *every*
active child row under that name and then discriminate by the detail signature (barcode + cost, R2).
It may never take the first row, the visible row, or a positionally-indexed row. This is plausibly the
same defect class as session 16's positional `rows[0]` substitution.

**Where the invariant holds today (verified, no change needed):**

- `productIdentity.ts:63-82` `findIdentityMatch` — selects **all** `name_key = @nameKey AND
  is_active = 1` rows `ORDER BY id ASC` and loops the whole candidate list comparing
  `productDetailSignature`; returns `null` when none match. Correct sweep, deterministic tie-break.
- `productIdentity.ts:87-124` `findIdentityMatches` — same, batched; buckets candidates by
  `name_key` and sweeps each pool. Its own comment (`:96-99`) records that a name_key's rows never
  split across an `selectInChunks` chunk.
- `productIdentity.ts:349-368` — Conflicts bucketing explicitly refuses the shortcut; comment
  `:350-354`: "Within one name_key bucket there can be more than one genuinely distinct item … so
  still bucket by the full identity rule inside the name group, rather than assuming every same-name
  row belongs together."

**Where it leaks — a real, verified defect (logged as F5 in §7).** There are **three** different
normalizations of "the same name" in play, and they do not agree:

| # | Where | Rule | Collapses internal whitespace? |
|---|---|---|---|
| 1 | `productDetailRule.ts:53-55` `normalizeProductGroupName` | `trim().replace(/\s+/g,' ').toLowerCase()` | **yes** |
| 2 | stored column `products.name_key` — trigger `migrations/0010_product_name_grouping.sql:76` (insert) and `:88` (update), backfill `:45` | `lower(trim(name))` | **no** |
| 3 | `products.ts:518` sibling-expansion SQL | `lower(trim(p.name)) IN (…)` compared against JS keys built at `products.ts:490-492` with `trim().replace(/\s+/g,' ').toLowerCase()` | **SQL no, JS yes** |

Consequences, both on paths this spec documents:

- **Identity:** `nameKeyOf` is `normalizeProductGroupName` (`productIdentity.ts:18-20`, rule 1), and
  it is compared against the stored column (rule 2) at `productIdentity.ts:73`
  (`WHERE … name_key = @nameKey`). For any product whose name contains a **doubled internal space**
  (or a tab/newline) — routine after a CSV import — the computed key and the stored key differ, the
  `WHERE` matches nothing, and `findIdentityMatch` returns `null`. The sibling child rows are never
  swept. Exactly the failure R3 forbids.
- **Search:** `expandSearchResultsToNameSiblings` (`products.ts:481-529`) exists precisely to pull in
  same-name siblings — its comment at `:484-487` **claims** it "matches `normalizeProductGroupName`'s
  own normalization exactly … so this can't miss a sibling". The JS side does; the SQL side at `:518`
  does not. A double-spaced sibling is silently dropped from search results. This is a second, smaller
  contributor to the user's own complaint that search shows "missing products".

#### Disposition — DEFERRED to migration 0111, post-deploy (d9, 2026-09-03)

**This is not fixed in the hotfix batch.** The real fix needs a migration that rewrites the stored
`name_key` **and** the two `0010` triggers, and that is too much schema change for a batch going onto
a live production deploy. **Registry slot `0111` is reserved for "name_key whitespace
normalisation"**, as a post-deploy lane. Everything above this line is that lane's brief — keep it
intact; it is the evidence, not commentary.

**What the 0111 lane does when it runs:**

1. Rewrite the two triggers (`migrations/0010_product_name_grouping.sql:76` insert, `:88` update) and
   backfill `name_key` (the `:45` form) to the whitespace-collapsing rule —
   `normalizeProductGroupName`, `productDetailRule.ts:53-55`. SQLite has no regex, so the collapse is
   an iterative `replace(name,'  ',' ')` to a fixed point plus tab/newline handling, or a scripted
   backfill through `ops/scripts/`; decide there, not here.
2. Change `products.ts:518` to compare against the same normalized expression — or, better, against
   `p.name_key` once the column is trustworthy, which also makes the query indexable via
   `idx_products_name_key_pg` (`0010:58`).
3. **Correct the two comments that currently assert something untrue** (they must not be left
   standing — a false comment outlives the bug it describes):
   - `migrations/0010_product_name_grouping.sql:35-36` — "name_key mirrors the frontend's grouping key
     exactly (see frontend/src/utils/productGrouping.ts's resolveGroupKey): lower(trim(name))". It does
     not mirror it exactly once `resolveGroupKey`/`normalizeProductGroupName` collapses internal
     whitespace.
   - `products.ts:484-487` — "Matches normalizeProductGroupName's own normalization exactly (trim +
     collapse internal whitespace + lowercase) so this can't miss a sibling". The JS half does; the
     SQL half at `:518` does not.

**Interim mitigation — hf/merge owns it, and it ships in this batch.** hf/merge's child-row sweep
**compares BOTH forms in JS**: it fetches candidates under both `lower(trim(name))` and the collapsed
`trim + s+→' ' + lower` form and unions them, so the sweep is robust to the mismatch **without a
schema change**. That is a JS-side widening of the candidate read only; it changes no column, no
trigger, and no signature comparison.

> #### ⚠ Known limitation until 0111 lands — USER ruling R5 is only PARTIALLY true in the system
>
> This must stay visible, not buried. The interim mitigation covers **the merge sweep and nothing
> else**. Still mismatched, and therefore still blind to whitespace-differing names:
> - the stored `products.name_key` column itself (triggers `0010:76`, `:88`);
> - the SQL sibling expansion at `products.ts:518`, so search can still drop a double-spaced sibling;
> - **anything else that keys on `name_key`** — at `c2bb7e6c` that is `productIdentity.ts:73`,
>   `products.ts:1854` (rename-scope `group`), and `renameCascade.ts:288`, `:291`, `:339`.
>
> So: "check all child rows if name is same" holds for merge after the interim mitigation; it does
> **not** yet hold system-wide. Do not describe R5 as satisfied until 0111 has landed.

**Until 0111 lands, no lane may add a new name-keyed lookup**; route any need for one through
`findIdentityMatch`/`findIdentityMatches` (which the interim mitigation makes whitespace-robust) —
never through a fresh local name comparison, which would become a fifth disagreeing rule.

**Check to apply wherever a name-keyed lookup appears on the paths this spec documents:** grep
`name_key = ` and `lower(trim(` before committing. At `c2bb7e6c` the full set is
`productIdentity.ts:73`, `products.ts:518`, `products.ts:1854` (rename-scope `group`, which builds
its key as `String(current?.name||'').trim().toLowerCase()` — rule 2, so it agrees with storage but
not with rule 1), and `renameCascade.ts:288`, `:291`, `:339`. The rename ones are a third lane's
(`user-id-source-of-truth-rename-cascade`); flagged, not taken.

---

## 5. i18n — both packs, every key

Verified missing from `frontend/src/lang/en.json` (and therefore from `km.json`), currently living only
as English template-literal fallbacks in code:

| key | used at | note |
|---|---|---|
| `confirm_complete_stock_session` | `FastStockInModal.tsx:319` | **missing in both packs** — needs `{lines}`, `{units}`, `{branch}` placeholders |
| `stock_session_completed` | `:363` | **missing in both packs** — needs `{n}` |
| `stock_session_partial` | `:364` | present (`en.json:5142`) but **has no `{n}`** while the code interpolates a count |
| `product_creation_pending_review` | `:241` | verify presence |
| `product_created_continue_stockin` | `:255` | verify presence |
| `stock_in_session_reason` | `:329` | verify presence |
| `price_variant_received` | `:351` | verify presence |

Keys to **revive** (already translated in both packs, currently unused):
`fast_stockin_add` = "Add & next" (`en.json:459` / `km.json:459`), `fast_stockin_done` (`:461`).

New keys this lane adds (both packs, Khmer verified from an authoritative source, not guessed —
memory `khmer-translations-verify-from-internet`): `update_line`, `lines_queued`,
`confirm_complete_stock_session_note`, `fast_stockin_search_showing` (`"{shown} of {total}"`),
`fast_stockin_search_failed`, `total_units`.

Reused as-is from the siblings — **do not re-mint**: `batch`, `new_batch`, `batch_code_preview`,
`existing_lot_keeps_date`, `batch_auto_new_unlocked`, `no_batches_with_stock`, `show_more`,
`supplier_will_fill_lot`.

Run `cd frontend && npm run verify:i18n`.

---

## 6. Tests

**Pure Worker test** — `cloudflare/scripts/test-barcode-equality-search-pure.cjs`, following the
existing `test-*-pure.cjs` convention in that directory (see the transfer/branch ones for the shape:
`test-branch-transfer-lots-pure.cjs`, `test-migration-chain-fresh-pure.cjs`). Run the **real**
migration chain under `better-sqlite3` so `products_fts` / `products_fts_code` /
`products_fts_name_trigram` and their sync triggers exist. Assert, using the same clause builders the
route uses:

1. stored `123456789012`, query `0123456789012` → **found** (the reported bug; must be red before the
   fix);
2. stored `0123456789012`, query `123456789012` → found (regression guard: this works today via
   trigram, it must keep working);
3. stored `00123456789012` (GTIN-14), query `123456789012` → found;
4. query `0` and query `12` (below `MIN_REAL_BARCODE_LENGTH`) → the equality clause is **not** emitted;
5. query `abc123` (non-digits) → the equality clause is not emitted;
6. two products sharing a barcode → **both** returned (the equality clause must never collapse to a
   single row; ambiguity is the caller's problem);
7. a name query still returns its FTS/trigram hits unchanged — the new clause is OR'd, so it can only
   add rows, never remove any.

**Frontend tests** — `frontend/tests/`:

8. the queued `ReceivedLine` carries `batchChoice`, and the `receiveBatchStock` payload sends
   `batchId` for a numeric choice and `receivedDate` (with `batchId: null`) for `'new'` — the mapping
   from §1.3, asserted as a pure function so it cannot drift from `ReceiveBatchModal.tsx:213-214`;
9. a scan fills the search box and **does not** select a product, mirroring
   `frontend/tests/barcodeScanSelectConfirm.test.ts` on `rc/p2-2-search` (230 lines) — extend that file
   rather than writing a parallel one if the RC has merged by then;
10. `pageSize` is 20 and `total`/`totalPages` are read off the response.

**Must-re-run list — identity tests (added 2026-09-03 per §0.2 R4).** Because the barcode fix touches
the same helper the identity comparison uses (§4.2 correction), whoever lands it re-runs, individually
and green, every pure test whose subject is product identity — at minimum everything matching
`cloudflare/scripts/test-*identity*.cjs`, `test-*possibly-same*.cjs`, `test-*merge-duplicates*.cjs`,
`test-*exact-duplicate*.cjs`, `test-*merge-same-detail*.cjs` — and states in the commit message that
`normalizedBarcode`'s semantics were either unchanged or deliberately changed with those results
attached. A green `for f in test-*.cjs` sweep alone is not sufficient evidence here; name the files.

Full gates: `cd frontend && npm run test:utils && npm run verify:i18n && npm run build`, and
`cd cloudflare && npx tsc --noEmit && cd scripts && for f in test-*.cjs; do node "$f" >/dev/null 2>&1 || echo "RED $f"; done`.

---

## 7. Findings beyond the ask (do NOT silently fold in)

**F1 — `StockAdjustModal`'s product search sends the wrong param name; its search is entirely
inert.** `frontend/src/components/products/forms/StockAdjustModal.tsx:174` calls
`searchProducts({ search: debouncedSearch, pageSize: 20, include: 'branch_stock' })` — **`search:`**.
The Worker reads only `query.query || query.q` (`cloudflare/src/routes/products.ts:697`), so `search`
is dropped and the modal always receives an unfiltered first page of 20. Its barcode scanner
(`StockAdjustModal.tsx:452`) is therefore also a no-op. Every other surface sends `query`. One-word
fix (`search:` → `query:`), but it is a different file and a different lane — raise it as its own item.

**F2 — Fast stock-in's search can 403 for an inventory-only role.** `FastStockInModal` sends no
`surface` param, so `parseProductReadSurface` (`products.ts:197-202`) resolves to `'products'` and
`productSurfaceDenialReason` (`:216-230`) requires the `products` permission. A user holding only
`inventory` — the exact role this fast flow is for — gets a 403 from the picker, which the bare
`catch {}` at `FastStockInModal.tsx:171` renders as "no results". Sending `surface: 'inventory'` (or
routing to `/api/inventory/products/search`) is the likely fix; needs a permission-model decision
first (memory `granular-permission-breakdown`).

**F3 — dead, already-translated i18n keys.** `fast_stockin_add` / `fast_stockin_done` exist in both
packs but are unreferenced. §2.2 revives the first; decide the second's fate rather than leaving it.

**F5 — three disagreeing normalizations of "same product name"; the stored `name_key` column and
`normalizeProductGroupName` differ on internal whitespace.** Full evidence and the specified fix are
in §4.5. Effect: a product name with a doubled internal space is invisible to `findIdentityMatch`
(`productIdentity.ts:73`) and dropped from search sibling expansion (`products.ts:518`, whose comment
at `:484-487` claims the opposite). Directly violates USER ruling R3. **Disposition (d9, 2026-09-03): the
real fix is DEFERRED to reserved migration slot `0111` ("name_key whitespace normalisation"),
post-deploy — too much schema change for a live-deploy batch. hf/merge ships an interim JS-side
mitigation in this batch (its child-row sweep compares BOTH name forms, so the merge sweep is robust
without a schema change), and R5 is therefore only PARTIALLY true system-wide until 0111 lands.**
Full disposition, the 0111 brief, the two false comments to correct, and the explicit limitation box
are in §4.5. Do not hot-patch one call site and leave the others.

**F4 — `getBranchStock` resolves failures as an empty list.** `frontend/src/api/branchTransport.ts:73-80`
passes `() => []` as the local fallback, the exact anti-pattern `batchesTransport.ts:113-120`
documents at length. Not Lane A's file, but it is the same bug class and it bites Lane B directly.

---

## 8. Decisions — all resolved 2026-09-03

The questions below are kept verbatim so a later reader can see each was **settled, not overlooked**.
Each now carries its answer and who gave it.

**A. Per-line received date.** The one-by-one flow puts the received date **next to the lot choice**;
the fast flow's whole premise is one header date for the shipment. §1.3 specifies the header date +
per-lot visibility rule, with an *optional* per-line override. Ship the override, or keep the fast
flow strictly header-only? (Recommendation: header-only, plus the batch-code preview — it preserves
the speed the flow exists for and still makes the derived lot visible before commit.)

**B. Mobile commit button.** Today there are two commit controls: a mobile-only one in the header
(`:406-408`) and one in the body (`:555-557`). §2.2 recommends collapsing to a single sticky footer at
every breakpoint. That diverges from `ReceiveBatchModal` / `TransferModal`, which both keep the
mobile header button. Match the siblings (two controls) or fix all of them together?

**C. Where the barcode-equality clause lands.** It belongs on all three search routes
(`products.ts`, `inventory.ts`, `branches.ts`) for sibling parity, but `branches.ts` is Lane B's file.
Lane B folds it in, or a separate follow-up owns it?

> **DECIDED — d9 (coordinator), 2026-09-03: neither. The whole equality-probe fix is hf/search's**
> (ruling R4, §0.2), with an equality probe on the canonical barcode ordered **before** the trigram
> probes. That single owner lands it across the sibling routes, which also removes the Lane A / Lane B
> file collision this question was about. Lane A and Lane B both converge on it and neither
> implements it. hf/search additionally carries the `normalizedBarcode` identity-path obligation in
> §4.2 and the must-re-run list in §6.

**D. (Lane B's decision, recorded here because it constrains Lane A's batch UI.)** Manual lot choice
in transfer.

> **DECIDED — USER, 2026-09-03: no manual lot choice in transfer at all.** Lot/batch + branch identity
> is preserved **automatically**, never asked about. A batch is identified by its **date**, as today
> (ruling R1). For Lane A this is a *confirmation*, not a change: the fast stock-in batch picker in
> §1.3 stays date-based and must not grow richer selection to "match" transfer. See
> `SPEC-lane-b-transfer.md` §2.6 for the transfer side and its deferred code-removal follow-up.

---

## 9. Could not verify

- **Runtime behaviour.** Everything above is static reading. FTS5 prefix/trigram outcomes are derived
  from the SQL and the in-code documentation (`searchMatch.ts:620-643`, `:743-750`;
  `migrations/0019_products_fts_code.sql:31-36`), not observed against a running SQLite.
- **Production barcode encodings.** Whether real rows actually carry mixed 12-/13-/14-digit encodings
  was not checked — no DB access from this worktree. The asymmetric-failure analysis in §4.2 holds
  regardless of which direction the live data leans, but the *severity* depends on it. Verify against
  **production** D1, not the local dev copy (memory `canonical-branch-model`).
- **The exact 3 lines of the session-6d i18n patch.** They are described in the brief; the main
  checkout was not read (off limits). §0.1 lists the three call sites *as they stand on `c2bb7e6c`* —
  reconcile against the actual patch before committing.
- **`searchMatch.ts:947-1216`** (`buildShortWordFallbackClause`, `buildPartialWordMatchClause`,
  `buildCompactColumnMatchClause` bodies) was not read. Their *gating* is confirmed from the call sites
  (`products.ts:836`, `:858`) and both are inert for a single ≥3-character word, so they cannot affect
  the 13-digit case — but the internals are unread.
- **Whether any real user holds `inventory` without `products`** (F2) — inferred from the permission
  code, not from live role data.
- **EXPLAIN QUERY PLAN for the new equality clause** at catalog scale — not run.
