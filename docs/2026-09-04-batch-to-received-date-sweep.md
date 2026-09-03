# batch → received date: the full surface matrix (Sep 4 2026)

Swept by a read-only agent on Sep 4 2026 against `main` at `bc84e5bb`, for the user's instruction
"make sure the renamed batch to received date is updated throughout the system". This file is the
enumeration; the board item is **S4-27** in `progress.md`.

**The finding in one sentence:** the rename landed on *the date input only*. Every surface that
names the thing still says "Batch" — including the `Batch code` preview that sits one line under a
field already labelled "Received date", and the `Batch date` label on the very field the rename was
about.

## Spellings that exist (sweep these, not just `batch`)

`batch` · `batch_number` · `batchNumber` · `batch_key` · `batchKey` · `lot` · `lot_code` ·
`lotCode` · `received_date` · `receivedDate` · `received_at` · `receivedAt` · CSV header
`batch(mm/dd/yyyy)` · Khmer `បាច់` (batch) · Khmer `ឡុត`/`ឡូត` (lot).

**Absent everywhere — do not go looking for them:** `date_received`, and a spaced CSV header
`received date`. Neither is accepted or emitted anywhere.

`ចាំបាច់` ("necessary") is a false positive on `បាច់`: km.json lines 235, 437, 517, 518, 746, 3837,
4683 and the trailing clause of 4821.

## A — user-visible text (the rename target)

### A1 · `frontend/src/lang/en.json`

Still say "batch": 42, 45, 312 (`batch_date` = **"Batch date"**, the field the rename was about),
313, 314, 315, 388, 389, 495, 562, 774, 778, 779 (`batch_code_preview` = "Batch code"), 784, 785,
786, 787, 855, 882, 1393, 1413, 1525, 1526, 2439, 2490, 2493, 2508, 2563, 2604, 2605, 2651, 3383,
3695, 3697, 3791, 3848, 3910, 3913, 4183, 4302, 4823, 4824, 4825, 5058, 5175, 5178.

Already on the new term — **leave alone**: 467, 480, 1792, 3715, 3792, 3793, 3794, 4569, 4873.

A different sense of "batch" (a multi-line review session, not a lot) — **leave alone**: 1242,
2255–2257. Legitimately about a defect rather than a lot — **leave alone**: 5078
`reason_defective_batch`.

### A2 · `frontend/src/lang/km.json`

Both packs hold exactly 5,129 keys, one-to-one; **no key is missing from km.json**, so
`verify:i18n` is green and proves nothing here.

Say `បាច់` in step with English: 45, 312, 313, 314, 315, 388, 389, 495, 562, 774, 778, 779, 784,
785, 786, 1242, 2256, 2439, 2490, 2493, 2508, 2563, 2604, 3791, 4302, 4823, 4824, 4825, 5175, 5178.

**Khmer-only drift — English already moved off "batch" to "lot", Khmer stayed on `បាច់`:** 539, 540,
541, 542, 1270, 4803, 4816, 4820, 4821, 4833, 5174, 5179.

**Half-untranslated — the Latin word `batch` sits inside the Khmer sentence:** **855**, **882**.

The reverse asymmetry (KM says `ឡុត`/`ឡូត` where EN says "batch"): 42, 787, 1525, 1526, 2605, 2651,
3383, 3695, 3697, 3848, 3910, 3913, 5058, 5078, 5137.

### A3 · hard-coded bilingual literals that bypass the packs

| path:line | what |
|---|---|
| `pos/ProductDetailSheet.tsx:103, 685, 700, 803` | `Batch` / `បាច់`, `3. Batch`, `Choose batch` |
| `pos/ProductDetailSheet.tsx:687, 691, 743, 787, 790, 794` | EN says "lot", KM says `បាច់` — drifted apart |
| `products/surfaces/ProductRowParts.tsx:107` | `tr('batch','Batch','Batch')` — **English in the Khmer slot** |
| `pos/POS.tsx:2914-2915` | the identical English sentence in both language slots |
| `products/forms/BranchStockAdjuster.tsx:267, 271, 620` | `Select a batch first`, `Batch code` |
| `inventory/InventoryStockModals.tsx:476` | `Batch code` |

### A4 · labels, headers and placeholders

Modal titles and pickers: `inventory/ManageBatchesModal.tsx:244, 316, **326**, 341, 368, 391` (326
is `Batch date` — the rename's own field), plus its toasts at `:160, 168, 201, 214, 217, 228` ·
`inventory/ReceiveBatchModal.tsx:156, 231, 234, 239, 250, 296, 306, 315, 336` ·
`inventory/InventoryStockModals.tsx:420, 432, 442, 446, 454` ·
`inventory/Inventory.tsx:1042, 1043` ·
`inventory/ProductDetailModal.tsx:155, 274, 279, 334, 335, 338` ·
`products/forms/BranchStockAdjuster.tsx:572, 584, 594, 598` ·
`products/forms/StockAdjustModal.tsx:371, 372` ·
`products/forms/BulkAddStockModal.tsx:393, 394, 410`.

**Table column headers** reading `Batch`: `products/StockInSessionsSection.tsx:260, 265` ·
`contacts/SupplierPurchasesModal.tsx:132` · `contacts/StockInInvoicesSection.tsx:392`.

Also: `products/surfaces/ProductDetailModal.tsx:212` (the Batches button) ·
`products/Products.tsx:3389` (badge tooltip) ·
`products/surfaces/ProductDetailReport.tsx:331, 442` ·
`products/ProductsImageOnlyView.tsx:695, 699, 701` ·
`products/MergeDuplicatesReviewModal.tsx:171, 247, 293` ·
`products/DeleteConfirmModal.tsx:169, 170` ·
`products/import/BulkImportModal.tsx:2820, 2824, 2827` ·
`branches/TransferModal.tsx:653, 936, 941, 973, 983` · `branches/Branches.tsx:1564, 1565` ·
`contacts/SupplierPurchasesModal.tsx:108, 121, 125` · `contacts/StockInInvoicesSection.tsx:339` ·
`contacts/SupplierInvoicesSection.tsx:72` · `returns/NewReturnModal.tsx:789` ·
`shared/RenameCascadeModal.tsx:33` · `utils-settings/ResetData.tsx:484, 485, 868` ·
`users/permissionDefinitions.ts:294` · `products/import/unifiedStockImport.ts:169`.

### A4b · defects that are wrong however the rename is ruled

- `products/ProductsImageOnlyView.tsx:707` and `inventory/movementGroups.ts:319` render the raw
  `lot_code` (`08242026`, `Lot 08242026`) instead of decoding it. This is exactly the
  MMDDYYYY-where-a-date-belongs defect that `frontend/src/utils/batchLabel.ts` exists to prevent —
  they bypass `batchDisplayLabel` / `lotCodeAsDate`.
- `products/StockChangeSection.tsx:748` and `products/surfaces/ProductDetailReport.tsx:301` call
  `batchDisplayLabel(...)` with **no `batchWord`**, so its hard-coded English `'Batch'` default
  renders for Khmer users.
- `CreatedDateFilterOptions.tsx:51` is labelled `Created`, but it sends `batchDateFrom`/`batchDateTo`
  and filters on `product_batches.received_at`. It should read "Received date"; today it says
  neither word.
- `inventory/FastStockInModal.tsx:352` shows `lot <raw code>` in its success detail.

### A5 · server-generated text the user reads

`cloudflare/src/routes/batches.ts:160, 195, 231, 318, 374, 399, 416` — including the movement
reasons `Batch receipt (…)` and `Batch quantity correction (Batch #n)`, which land in stock history ·
`lib/productWrites.ts:282` · `routes/inventory.ts:1525, 1533, 1540, 1556` ·
`routes/branches.ts:369, 374, 668, 672` · `routes/sales.ts:310` ·
`lib/productBatches.ts:244, 359, 392` · `lib/stockRevert.ts:139, 152` ·
`lib/stockActionCommit.ts:425, 434, 435` · `lib/stockActionImport.ts:133` ·
`lib/stockActionResolver.ts:275` · `lib/importEngine.ts:148, 1473, 1562` ·
`routes/system.ts:292, 325`.

**Telegram** (`cloudflare/src/lib/telegram.ts:378-397`) emits `lot:` with `pb.lot_code` and no
received date — nothing to rename there, but nothing shows the date either.

**Receipt and print surfaces contain zero batch/lot hits.** The lot a sale drew from is on the cart
line (`CartItem.tsx:193-196`) but is never printed.

## B — CSV input headers: **do not rename**

`batch(mm/dd/yyyy)` is read at `cloudflare/src/lib/importEngine.ts:1242` and `:1433` (a four-way
fallback `batch(mm/dd/yyyy) || batch || date || received_date`), `:2260`, and `:2692`
(`batch_label`); also `frontend/src/components/products/import/unifiedStockImport.ts:17, 64, 143`,
`frontend/src/utils/salesImportContract.ts:10, 96`, `cloudflare/src/lib/stockActionImport.ts:16`.

**`importTemplateRouter.ts:122` counts `batch(mm/dd/yyyy)` as one of seven products-file signals**
and routes on `productSignals.length >= 1`. Verified in source: renaming the header does not break
every file, but it does break any products CSV whose only recognised signal is that column — and it
breaks the import read path at `importEngine.ts:1433` outright, since the four-way fallback there
never looks for a new name.

There is no static products template on disk: it is generated by `frontend/src/api/methods.ts` via
`frontend/src/utils/csvTemplate.ts`. The `products-template-warehouse.csv` / `-shop.csv` names in
`importEngine.ts:5411-5412` appear **only in a comment**; no such files exist. Three real CSVs under
`Migration from old system/` carry the header as column 16. Inventory templates use a third name for
the same idea: a plain `date` column.

So the header stays, and the **label above it** (`csv_info_batch_label`) plus the surrounding prose
move to "Received date", saying that the column is still literally named `batch(mm/dd/yyyy)` for
compatibility with files people already have.

## C — database identifiers: leave alone

Tables `product_batches`, `branch_batch_stock`, `sale_item_batch_allocations`,
`return_item_batch_allocations`; columns `batch_key`, `lot_code`, `batch_number`, `received_at`,
`received_quantity`, `received_branch_id`, `received_cost_usd`, `sale_items.batch_id` /
`batch_label` / `batch_expiry_date`, `return_items.batch_id`, `inventory_movements.batch_id`. 47
migrations mention them, including `0077_batch_received_iso.sql`. A column rename is a migration
with its own risk, not part of a label change.

## D — internal identifiers: leave alone

`batchDisplayLabel`, `formatBatchReceivedDate`, `formatDefaultBatchLabel`, `lotCodeAsDate`,
`dateToBatchCode`, `normalizeToIsoDate`, `nextBatchNumber`, `receiveBatchStock`, `generateBatchKey`,
`attachBatchCounts`, `getVisibleProductBatches`, `buildBatchPreview`, `describeBatchOption`,
`findUnifiedStockCostBatchConflicts`; state and transit keys `selectedBatchId`, `batchChoicesOpen`,
`adjustForm.batch_id`, `draft.receivedAt`, `batchId`, `batchLabel`, `lotCode`, `receivedAt`; the
`/api/batches` path; the `products_image_only_show_batches` permission key.

**A different sense of "batch" entirely** — `setCategoryFilterBatch`, `PRODUCT_RESTORE_BATCH_SIZE`,
`batchDeleteById`, `Sync batch is too large.`, `inventory_batch_session`. Renaming these would be a
mistake.

## E — comments, tests, docs

19 frontend tests and 64 Worker test files mention batch, including
`test-adjust-received-date-pure.cjs`, `test-batches-permission-pure.cjs`,
`test-returns-batch-restock-pure.cjs`, `test-fifo-lot-allocation-pure.cjs` and
`test-lot-ledger-reconcile-pure.cjs`.

**Header comments that are the spec — do not touch:** `cloudflare/src/lib/batchCode.ts:1-17` ("the
batch column is just a translated version of received date"; "replaces the old free-typed
Lot / batch code field"), `frontend/src/utils/batchLabel.ts` (the Z1a display rule), and
`products/surfaces/ProductDetailModal.tsx:175, 340`, which record that the
`Batch: <latest received date>` row was deliberately removed.

## What the sweep could not settle

1. **Does the noun move too?** Renaming the *date field* is unambiguous. Whether the collection noun
   follows — "Manage Batches" → "Manage received dates", the `Batches` button, the `Batch` column
   header — is a product call, not a lookup. Recorded as **S4-27a**.
2. **Is "lot" a synonym or a second rename target?** English has already drifted the `transfer_*`
   keys and the POS empty states from "batch" to "lot" while Khmer stayed on `បាច់`. That is either
   a deliberate half-done second rename or an accident; no decision record was found in either
   `progress.md` or the session log, which record both directions on different dates.
3. **The Khmer noun for "received date" as a label.** Three spellings are in use today —
   `ថ្ងៃទទួលស្តុក` (`received_date`), `បានទទួល` (`received_on`), and `ថ្ងៃទទួល`
   (`stock_in_invoices_hint`). Picking one needs a native speaker.
4. **Runtime reach.** Nothing was run and D1 was not queried, so which of these labels a real
   operator actually sees is unverified — for example whether `ProductsImageOnlyView.tsx:707` is
   live for any current role.
5. **`.claude/worktrees/gallant-curran-a25bb5/`** is a second checkout whose `en.json` differs from
   HEAD by ~30 keys. Only the main tree was inventoried. If that is an in-flight lane, its copies of
   every A-hit need the same treatment and will conflict.
