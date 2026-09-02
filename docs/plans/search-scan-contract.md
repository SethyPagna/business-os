# Search + barcode-scan consistency contract

Written by P2-2 (search + barcode scan core), `rc/p2-2-search`. One table, one row per product
search surface: which shared hook/util it should sit on, its debounce, its endpoint, whether it
shows the exact-barcode-hit highlight, whether its scanner auto-closes on detect, and whether
selecting a result still requires an explicit confirm click (decision 9 — binding for every row,
not optional).

The shared pieces this table refers to:
- `frontend/src/hooks/useProductLookup.ts` — debounced, cancellable product search
  (`{ query, setQuery, results, loading, error, page, setPage, hasMore, total, exactBarcodeHit,
  refresh }`), built on `api/http.ts`'s existing `route()`/`apiFetch()`/`searchGroup`
  machinery.
- `frontend/src/hooks/useBarcodeScan.ts` — reusable camera-scan (auto-close on detect) +
  keyboard-wedge burst detection (`{ open, openScanner, closeScanner, handleDetected, wedge: {
  onKeyDown } }`).
- `frontend/src/components/shared/ScanSearchButton.tsx` — the pre-existing camera-icon button
  already used by most of these surfaces; already satisfies decision 9 structurally (auto-close,
  fill search, no auto-select). A surface that already renders `ScanSearchButton` does **not**
  need to additionally adopt `useBarcodeScan` — the two are equivalent for the camera path,
  `useBarcodeScan` is for a surface that doesn't want the button's own UI, or that also needs
  the keyboard-wedge detector.
- `frontend/src/utils/productLookup.ts` — pure helpers (`findExactBarcodeHit`,
  `resolveExactBarcodeHit`) `useProductLookup` uses internally to compute `exactBarcodeHit`.
- The backend contract every adopted endpoint (`products.ts`, `portal.ts`, `branches.ts`, and
  the prepared `inventory.ts` patch, `bos-rc-workers/p2-2-inventory-tail.patch`) now returns:
  `{ items, total, page, pageSize, totalPages, exact_barcode_hit_id }`.

**Exact-hit highlight**: `data-exact-hit="true"` on the row whose id equals
`exactBarcodeHit`/the resolved hit id — highlight only, never a selection. **Confirm required**:
the user must still click/tap the row (or its own explicit action) before anything is
added/selected/navigated to — a scan or an exact-match query only ever narrows the list and
highlights, per decision 9.

| Surface | Hook / debounce | Endpoint | Exact-hit highlight | Scan auto-close | Confirm required |
|---|---|---|---|---|---|
| Promotions (per-product discount search + rule-editor product picker) | `useProductLookup` (300ms) — **done**, `rc/p2-2-search` commit `bc997ad2` | `GET /api/products/search` | Yes — `data-exact-hit="true"` on both dropdowns | Yes — via `ScanSearchButton` (unchanged, already correct) | Yes — unchanged existing click-to-open/click-to-add |
| POS (product search / cart add) | TODO P2-4/P2-5 | `GET /api/products/search` (same endpoint/contract as Promotions — `exact_barcode_hit_id` already in the response) | TODO | TODO — confirm whether POS already auto-closes on a scan-to-add flow, or whether add-to-cart-on-scan needs to change to fill-then-confirm to satisfy decision 9 | TODO — **audit specifically**: POS is the surface most likely to currently auto-add on scan (fast checkout flow); decision 9 still applies — a scan must highlight, not add, unless the existing flow already requires a tap/Enter on the highlighted line |
| Products (main list search + scanner) | TODO P2-4/P2-5 | `GET /api/products/search` | TODO | Already uses `ScanSearchButton` per `tests/barcodeScannerState.test.ts` | TODO — confirm click-through still required, not auto-navigate to detail |
| Inventory (search + scanner) | TODO P2-4/P2-5 | `GET /api/inventory/products` (`searchProductsPayload` in `inventory.ts` — patch prepared, not yet applied, see `bos-rc-workers/p2-2-inventory-tail.patch`) | TODO — patch adds `exact_barcode_hit_id`, null when `metadataOnly` | Already uses `ScanSearchButton` per `tests/barcodeScannerState.test.ts` (branch stock surface) | TODO |
| Branches (per-branch stock search + `TransferModal` product picker) | TODO P2-4/P2-5 | `GET /api/branches/:id/stock` (search tail wired onto `buildProductSearchPlan` in `rc/p2-2-search` commit `1619a18b`; `exact_barcode_hit_id` already in the response) | TODO | Already uses `ScanSearchButton` (`Branches.tsx`, `TransferModal.tsx` — 2 uses, per `tests/barcodeScannerState.test.ts`) | TODO |
| TransferModal (single + multi product search) | TODO P2-4/P2-5 | Same as Branches above | TODO | Already uses `ScanSearchButton` (2 uses) | TODO |
| StockAdjustModal | TODO P2-4/P2-5 | TODO — confirm which endpoint this modal's product picker actually calls (likely `/api/products/search`, not yet confirmed by this worker) | TODO | TODO — confirm scanner presence | TODO |
| FastStockInModal | TODO P2-4/P2-5 | TODO — confirm endpoint | TODO | TODO — confirm scanner presence | TODO |
| Returns — NewReturnModal | TODO P2-4/P2-5 | TODO — confirm endpoint | TODO | TODO — confirm scanner presence | TODO |
| Returns — NewSupplierReturnModal | TODO P2-4/P2-5 | TODO — confirm endpoint | TODO | Already uses `ScanSearchButton` per `tests/barcodeScannerState.test.ts` | TODO |
| Catalog recommended-products picker | TODO P2-4/P2-5 | TODO — confirm endpoint (likely `/api/portal/...` given "catalog" naming, or an admin products endpoint — not yet confirmed) | TODO | TODO — confirm scanner presence | TODO |

## Notes for P2-4/P2-5

- Every "Endpoint" cell already marked with a real path (POS, Products, Inventory, Branches,
  TransferModal) is confirmed to already return `exact_barcode_hit_id` on `rc/p2-2-search`'s
  HEAD (`products.ts`/`branches.ts` committed; `portal.ts` committed for the public storefront
  variant of Products' data; `inventory.ts` prepared as a patch, not yet applied/committed —
  apply `bos-rc-workers/p2-2-inventory-tail.patch` first). Adopting `useProductLookup` on those
  surfaces is mostly a matter of swapping the fetch/debounce plumbing and adding the
  `data-exact-hit` marker to the row-render — see `PromotionsPage.tsx`'s `bc997ad2` diff as the
  reference shape (a page that mirrors hook results into its own existing result state, vs. one
  that can render directly off the hook's `results`/`loading`/`exactBarcodeHit`).
- StockAdjustModal, FastStockInModal, NewReturnModal, and the catalog recommended-products
  picker were **not** inspected by this worker (`p2-2-brief.md`'s explicit file-ownership scope
  only extends to `PromotionsPage.tsx`, plus not editing `inventory.ts`/other page components)
  — their "Endpoint"/scanner-presence cells are genuine unknowns for P2-4/P2-5 to fill in, not
  omissions from a completed audit.
- POS deserves a **specific safety check before adoption**: if its current scan-to-cart flow
  auto-adds a scanned item without an intermediate highlight+confirm step, decision 9 requires
  changing that flow (fill search → narrow → highlight exact hit → explicit confirm), which is a
  bigger behavior change there than on any other surface in this table and should be flagged to
  the user/coordinator before shipping, not treated as a drop-in hook swap.
- Every surface already listed as using `ScanSearchButton` (Products, Inventory's branch-stock
  view, Branches, TransferModal ×2, NewSupplierReturnModal, plus Promotions ×2) can keep using
  it as-is for the camera path — `useBarcodeScan` does not need to replace it there. Adopt
  `useBarcodeScan` only for a new surface without `ScanSearchButton` already wired, or if a
  surface specifically needs the keyboard-wedge burst detector on its search input (no existing
  surface has this yet — the wedge detector is new in this effort).
