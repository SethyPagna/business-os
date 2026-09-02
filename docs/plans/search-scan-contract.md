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
| Products (main list search + scanner) | **done**, `rc/p2-4-pages` commit `cd9d3143`. NOT switched onto `useProductLookup` — `load()` already debounces via `useDebouncedValue(search, 180)` (matches the 180ms convention) and Products' 17-param query (filters/initials/promotion_rules metadata) is wider than the hook's surface; forking the hook or dropping functionality was judged worse than reading `exact_barcode_hit_id` off the existing response directly. `useBarcodeScan` is wired for the keyboard-wedge path only (`wedge.onKeyDown` on the search input) | `GET /api/products/search` | Yes — `data-exact-hit="true"` on both the desktop `<tr>` and the mobile card, resolved via the shared `resolveExactBarcodeHit` helper (never a re-implementation), and the server now resolves an ALIAS-barcode scan to a real `exact_barcode_hit_id` too (`resolveAliasExactBarcodeHitId`, `cloudflare/src/routes/products.ts`), so no client-side guessing is needed — P2-4 Part 1b deleted the old "a scan that left exactly one row highlights that row" fallback | Yes — `ScanSearchButton` (camera) is unchanged/already correct; both paths funnel through one `handleScanDetected` that only calls `setSearch`, never selects | Yes — both the highlighted row's own `onClick` and its Confirm pill require an explicit click calling `setDetailProduct`; nothing auto-opens on scan or on an exact-match query |
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

## P2-4 findings (Products, `rc/p2-4-pages`)

- **Alias-barcode highlight gap — FIXED in P2-4 Part 1b** (`rc/p2-4b-products`). The rule is now:
  `exact_barcode_hit_id` = the primary-barcode hit if there is one, otherwise the single row on
  THIS page that carries the scanned value in `barcode_aliases`, otherwise null.
  `computeExactBarcodeHitId` (`cloudflare/src/lib/searchMatch.ts`) is unchanged — it stays pure,
  synchronous and in byte-for-byte parity with the client mirror — and the alias half runs as an
  async fallback in `resolveAliasExactBarcodeHitId` (`cloudflare/src/routes/products.ts`), gated by
  the SAME three decision-9 gates (digits-only, length >= 4, never the shared "0" placeholder) and
  by the same "more than one match on the page is ambiguous, not a pick" rule. Scoped to the ids
  already on the page: highlighting a row that is not on screen would be meaningless. Pinned by
  `cloudflare/scripts/test-alias-exact-hit-pure.cjs` (real SQLite, all migrations, the real sliced
  function — not a re-implementation).
  A SECOND, separate half of the same report ("alias search returns ZERO rows") turned out not to
  be a search bug at all: the server returned the row, and the Products page threw it away in its
  own client-side re-filter, whose free-text haystack (name/sku/barcode/tag_label) can never see an
  alias. Fixed by `resolveClientSearchTerms`
  (`frontend/src/components/products/helpers/productFilterHelpers.ts`): the free-text client pass
  stands down once the server page for THAT exact query has landed — the server is the search
  authority — while facet filters keep re-filtering instantly. Pinned by
  `frontend/tests/productFilterHelpers.test.ts`.
- *(historical, for the record)* **Alias-barcode highlight gap (P2-3 boundary, not fixed in Part 1)**: `computeExactBarcodeHitId`
  (`cloudflare/src/lib/searchMatch.ts:1410`) and its client mirror
  (`frontend/src/utils/productLookup.ts`'s `findExactBarcodeHit`) only compare `products.barcode`
  — never a `barcode_aliases` row — even though `buildAliasExactClause`
  (`cloudflare/src/lib/barcodeAliases.ts`) already widens the *search* `WHERE` so scanning an
  alias barcode DOES return the product in the list. Net effect: scanning an alias barcode
  narrows Products to the right row (search works), but that row is only highlighted+offered a
  Confirm pill when it is the *sole* result on the page (Products' own client-side single-result
  fallback, see the table row above) — a multi-result list with an alias hit among several rows
  gets no highlight at all. The real fix (teaching `computeExactBarcodeHitId` to also match
  `barcode_aliases`) touches `searchMatch.ts`, which the file's own comments mark as P2-3-owned;
  left as a handoff rather than edited out-of-lane.
- **`barcode_aliases` has no read API yet**: `listAliases(db, productId)`
  (`cloudflare/src/lib/barcodeAliases.ts:110`) is exported but never called from any route —
  grepped `cloudflare/src/routes/*.ts` and found zero call sites. No product read/search response
  (list, detail, or otherwise) currently returns a product's aliases, so "aliases shown read-only
  in the fold" (P2-4 brief step 7) could not be implemented against live data — there is nothing
  to display. Adding a `barcode_aliases` (or similar) field to a products route response would be
  the backend half of this and belongs to whichever lane owns `barcodeAliases.ts`/`products.ts`
  next.
- **Client-side import review does not silently drop a `barcode_aliases` CSV column**:
  `productImportPlanner.ts`'s `normalizeProductImportRow` copies every `Object.entries(row)` key
  through via `normalizeCsvKey`, not a fixed whitelist — an uploaded `barcode_aliases` column
  survives client-side review/preview untouched. Whether the *server* (`importEngine.ts`, the
  file the actual uploaded CSV/zip is parsed by — also P2-3-owned per its own comments) persists
  that column into the `barcode_aliases` table on apply was not verified here, since that is a
  server-side parsing concern outside this worker's file-ownership scope, not a client-side gap.
