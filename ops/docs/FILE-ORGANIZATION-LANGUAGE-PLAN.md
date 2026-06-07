# File Organization And Language Conversion Plan

> Current whole-plan position: Phase 6 schema audit green; Phase 8.4 loader/action stability sweep active; Phase 26 preserved at 51 completed moves; Phase 28 active with R2 prune follow-up; Phase 29 active as the recurring whole-codebase/schema/cleanup guardrail. Latest recorded cleanup/optimization move: Move 839 in this file.

## Goal

Make the codebase easier to navigate, safer to refactor, and more efficient to run by grouping files around real ownership boundaries and converting code to stronger languages only where the build/test system can prove a gain.

## Current Shape

- Current source extension baseline inside active scan roots and outside
  generated/runtime/vendor wrappers:
  `.js: 0`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 318`,
  `.tsx: 107`.
- Frontend JSX-to-TSX source conversion is complete; remaining first-party
  JavaScript is generated runtime compatibility output for fixed browser,
  backend, and PM2 filenames.
- Backend source conversion is complete under `backend/src` and the root
  backend entry is now TypeScript-authored with generated runtime output.
- TypeScript is strict for converted frontend source and focused converted
  tests. Backend `.ts` source currently uses Node 24 type stripping and
  CommonJS exports until the broader backend build lane is converted.
- End-state target: no first-party `.js`, `.jsx`, `.mjs`, or `.cjs` remains outside generated/runtime/vendor folders. Every conversion slice must update imports, scripts, docs, and verification references before deleting the old path.

## Organization Principles

1. Move files by ownership, not by generic technical buckets.
2. Keep import surfaces small and named; avoid broad barrel files until a folder has stable boundaries.
3. Move one cluster at a time and verify with source tests, build, and live Playwright.
4. Keep public runtime paths stable unless route tests prove the rename is invisible to users.
5. Avoid moving generated, packaged, or persisted data folders unless backup/restore and start scripts are already updated.
6. Record every accepted move in this file and in `ops/docs/OPTIMIZATION-ROADMAP.md`.

## Phase 26: Repository Organization And Folder Rewire

### 26.1 Source Map And Dependency Graph

Targets:
- Generate a repeatable inventory of file counts, large files, import edges, and candidate clusters.
- Add an audit script before moving code so reorganization is measured.

Candidate files:
- Create `ops/scripts/architecture/organization-audit.ts`.
- Create generated report `ops/docs/reference/ORGANIZATION-AUDIT.md`.

Verification:
- `node ops/scripts/architecture/organization-audit.ts`
- `npm.cmd run test:utils` in `frontend`
- `npm.cmd run test:utils` in `backend`

### 26.2 Ops Script Folder Split

Targets:
- Split `ops/scripts/runtime` into clearer groups without changing behavior:
  - `ops/scripts/runtime/audit`
  - `ops/scripts/runtime/live-checks`
  - `ops/scripts/runtime/smoke`
  - `ops/scripts/runtime/deploy`
- Keep compatibility wrappers for scripts referenced by package scripts or docs until all references are updated.

Safety:
- Move one script family at a time.
- Run `node --check` against every moved `.mjs`.
- Run the most recent live Playwright check after updating paths.

### 26.3 Frontend Feature Folder Refinement

Targets:
- Keep existing route-level folders such as `products`, `inventory`, `sales`, `returns`, `catalog`, `files`, and `shared`.
- Inside large feature folders, split by behavior:
  - `components/products/forms`
  - `components/products/lookups`
  - `components/products/import`
  - `components/products/history`
  - `components/products/scanning`
- Update lazy imports and source tests immediately after each move.

First safe candidates:
- Product lookup modals: category, unit, brand.
- Product form submodules: variant form, branch stock adjuster, bulk add stock.
- Product import planner/worker files.

Verification:
- `npm.cmd run check:source` (or the compatibility alias
  `npm.cmd run check:jsx`)
- `node tests/actionStability.test.ts`
- `npm.cmd run build`
- focused Products Playwright checks.

### 26.4 Backend Domain Folder Refinement

Targets:
- Keep `backend/src/routes`, `backend/src/services`, `backend/src/db`, and `backend/src/workers`.
- Group route helpers and SQL helpers near their domain when they currently float in shared areas.
- Do not rename HTTP routes, table names, queue names, uploaded paths, or backup package paths without compatibility aliases.

Verification:
- `npm.cmd run test:utils` in `backend`
- route contract tests
- backup schema tests
- live smoke after any route/data move.

### 26.5 Documentation Folder Cleanup

Targets:
- Keep active plans in `ops/docs`.
- Put generated reference outputs in `ops/docs/reference`.
- Put historical runtime reports only under `ops/runtime/reports`.
- Keep high-level operational entrypoints discoverable from `ops/readme`.

Verification:
- `rg` old paths after every docs move.
- Link/path checks in the organization audit.

## Phase 27: Language Conversion And Runtime Efficiency

### 27.1 TypeScript Expansion Gate

Targets:
- Convert pure frontend utility modules first, because they already sit near the current `tsconfig` include paths.
- Add React type dependencies only before converting `.jsx` to `.tsx`.
- Expand `tsconfig` includes gradually:
  - `src/utils/**/*.ts`
  - `src/types/**/*.ts`
  - selected feature helper folders
  - selected `.tsx` React surfaces after types are installed.

Do first:
- Convert self-contained `.mjs` utilities with strong data contracts.
- Add focused `.test.mjs` checks before and after conversion.

Do later:
- Convert large route components such as Products, Inventory, POS, Catalog, and Dashboard only after their helper logic is split out.

### 27.2 Backend Type Strategy

Targets:
- Keep runtime backend JavaScript until a packaging-safe transpilation path exists.
- Use JSDoc/type boundary guards first for route payloads, database rows, and worker job payloads.
- Consider TypeScript for backend helpers only after `pkg`/release packaging proves compiled output is included.

Do not do yet:
- Rename backend runtime `.js` files to `.ts` without adding a build step, package asset mapping, worker entry changes, and release tests.

### 27.3 Multiple Language Strategy

Allowed when proven better:
- SQL for data integrity, indexing, and set-based transformations.
- DuckDB SQL for large import validation, report generation, backup verification, and analytics snapshots.
- PowerShell for Windows launcher/runtime orchestration where Windows integration matters.
- TypeScript for frontend contracts and shared pure logic.
- JavaScript for current runtime glue where packaging and startup simplicity matter.

Delayed unless benchmarked:
- Rust, Go, or native addons for normal business logic.
- Python in the production runtime.
- WASM except for existing proven scanner/image workloads.

Decision rule:
- Convert only when it improves at least one measurable dimension: correctness, type coverage, runtime latency, memory use, startup cost, package reliability, or security boundary clarity.

## First Execution Slice

1. Add the organization audit script. Done:
   `ops/scripts/architecture/organization-audit.ts`.
2. Generate `ops/docs/reference/ORGANIZATION-AUDIT.md`. Done: latest scan covers
   334 files and separates `ops/scripts/runtime/live-checks`.
3. Add roadmap references to Phase 26 and Phase 27. Done in
   `ops/docs/OPTIMIZATION-ROADMAP.md` and `ops/docs/whole-app-hardening.md`.
4. Pick the first physical move from audit results. Done: Phase 8.4 live-check
   scripts moved from `ops/scripts/runtime` to
   `ops/scripts/runtime/live-checks`, with relative auth/root paths updated.
5. Verify no behavior changed with frontend/backend utility suites and the
   latest focused Playwright check.
6. Move the first frontend feature cluster. Done: product lookup modals and
   `productLookupSnapshots.mjs` now live in
   `frontend/src/components/products/lookups`. Category, Unit, and Brand
   lookup Playwright checks passed on frontend hash `3296f6327bd7aa53`.
7. Move the first product form cluster. Done: `VariantFormModal.tsx` now lives
   in `frontend/src/components/products/forms`. Focused source checks,
   production build, runtime health, and Product variant Playwright verification
   passed on frontend hash `42378a84fc53ab2f`.
8. Continue the product form split. Done: `BulkAddStockModal.tsx` and
   `BranchStockAdjuster.tsx` now live in
   `frontend/src/components/products/forms`. Focused source checks,
   production build, runtime health, and Product stock-helper Playwright
   verification passed on frontend hash `b79c04b453d1b469`.
9. Move the product import cluster. Done: `BulkImportModal.tsx`,
   `productImportPlanner.ts`, and `productImportWorker.ts` now live in
   `frontend/src/components/products/import`. Product import planner tests,
   performance loading source checks, production build, runtime health, and the
   broad Phase 8.4 UI Playwright check passed on frontend hash
   `0028bc915078664f`.
10. Move the product scanning cluster. Done: `BarcodeScannerModal.tsx`,
    `barcodeImageScanner.ts`, `barcodeScannerState.ts`, and
    `scanbotScanner.ts` now live in
    `frontend/src/components/products/scanning`. Scanner unit tests, production
    build, runtime health, and a focused Product scanner Playwright check passed
    on frontend hash `4fdf242042c73694`.
11. Start the product history split. Done: `productHistoryHelpers.mjs` now lives
    in `frontend/src/components/products/history`. Product history helper tests,
    source checks, typecheck, production build, runtime health, and a focused
    Product page Playwright action check passed on frontend hash
    `db2bde8c13de0d64`.
12. Move the product presentation surface cluster. Done: `HeaderActions.tsx`,
    `ProductsListSurface.tsx`, and `ProductDetailModal.tsx` now live in
    `frontend/src/components/products/surfaces`. Product discount and product
    pagination source tests, source checks, typecheck, production build,
    runtime health, and a focused Product page Playwright action check passed
    on frontend hash `e9b985386668bdf9`.
13. Move the product shared primitive cluster. Done: `primitives.tsx` now lives
    in `frontend/src/components/products/shared`, with Products, ProductForm,
    VariantForm, Product surfaces, Catalog, and POS imports rewired. Product,
    POS, and portal catalog source tests, source checks, typecheck, production
    build, runtime health, a focused Product page Playwright action check, and
    the broad Phase 8.4 UI Playwright check passed on frontend hash
    `21bd97f0b6d8a0df`.
14. Move the main product form into the forms cluster. Done:
    `ProductForm.tsx` now lives in `frontend/src/components/products/forms`,
    with lazy imports, source tests, and performance verifier paths rewired.
    Performance/action-stability source tests, source checks, typecheck,
    production build, runtime health, focused Product page Playwright, and
    focused Product scanner Playwright passed on frontend hash
    `d1de3f08c3064e4d`.
15. Split product page config/constants. Done:
    `productPageConfig.mjs` now lives in
    `frontend/src/components/products/config`, holding Products page month
    options, visual defaults, read timeout budgets, and mutation timeout
    budgets. Source tests now read the config module directly, while Products
    imports the same constants. Source checks, typecheck, production build,
    runtime health, focused Product page Playwright, and focused Product scanner
    Playwright passed on frontend hash `e0871873ba445219`.
16. Split product page helpers. Done: `productPageHelpers.mjs` now lives in
    `frontend/src/components/products/helpers`, holding debounce, brand color
    parsing/normalization, and frame scheduling helpers. The dead local
    `multiMatch` helper was removed from `Products.tsx`. Helper source tests,
    source checks, typecheck, production build, runtime health, focused Product
    page Playwright, and focused Product scanner Playwright passed on frontend
    hash `a440b744817036af`.
17. Split product gallery helpers. Done: `productGalleryHelpers.ts` now lives
    in `frontend/src/components/products/helpers`, owning gallery
    normalization, product gallery fallback selection, and public product image
    URL resolution. `Products.tsx` no longer imports `resolvePublicAssetUrl`
    directly or carries local gallery normalization logic. Helper source tests,
    source checks, typecheck, production build, runtime health, focused Product
    page Playwright, and focused Product scanner Playwright passed on frontend
    hash `ff7f953e9b217168`.
18. Move product row presentation parts. Done: `ProductRowParts.tsx` now lives
    in `frontend/src/components/products/surfaces`, owning the product discount
    badge, row action menu wrapper, batch preview chips, and desktop details
    cell. `Products.tsx` no longer defines those presentation helpers inline.
    Source checks, typecheck, production build, runtime health, focused Product
    page Playwright, and focused Product scanner Playwright passed on frontend
    hash `f04520d849d51963`.
19. Split product filter/export helpers. Done: `productFilterHelpers.mjs` now
    lives in `frontend/src/components/products/helpers`, owning search-term
    parsing, branch quantity lookup, filtered product selection, and product
    CSV export row shaping. `Products.tsx` now delegates that data work to the
    helper module, and the moved behavior has focused source tests. Source
    checks, typecheck, production build, runtime health, focused Product page
    Playwright, and focused Product scanner Playwright passed on frontend hash
    `8a33b1bdd672f31c`.
20. Split product selection/pagination helpers. Done:
    `productSelectionHelpers.mjs` now lives in
    `frontend/src/components/products/helpers`, owning visible id extraction,
    selected-visible id resolution, pagination summary math, selected product
    filtering, letter jump targets, and selection-scope predicates. The moved
    behavior has focused source tests. Source checks, typecheck, production
    build, runtime health, focused Product page Playwright, and focused Product
    scanner Playwright passed on frontend hash `f0b69a89f50f0e7f`.
21. Split product group view helpers. Done:
    `productGroupViewHelpers.mjs` now lives in
    `frontend/src/components/products/helpers`, owning grouped product price
    labels and grouped summary chip text. `Products.tsx` now delegates those
    calculations to the helper module while preserving the existing grouped row
    render contract. The moved behavior has focused source tests. Source checks,
    typecheck, production build, runtime health, focused Product page
    Playwright, and focused Product scanner Playwright passed on frontend hash
    `5781a6bf1ff07e16`.
22. Split product display data helpers. Done:
    `productDisplayHelpers.mjs` now lives in
    `frontend/src/components/products/helpers`, owning lookup map construction,
    merged brand filter options, branch id/name maps, branch summary labels, and
    stock-status classification. `Products.tsx` now delegates that display data
    work while keeping the row UI and badges unchanged. The moved behavior has
    focused source tests. Source checks, typecheck, production build, runtime
    health, focused Product page Playwright, and focused Product scanner
    Playwright passed on frontend hash `6039db439c681904`.
23. Split product menu metadata helpers. Done:
    `productMenuHelpers.mjs` now lives in
    `frontend/src/components/products/helpers`, owning export menu item
    construction, supplier filter option normalization, and active filter count
    calculation. `Products.tsx` now delegates that menu metadata work while
    keeping the header and filter menu surfaces unchanged. The moved behavior
    has focused source tests. Source checks, typecheck, production build,
    runtime health, focused Product page Playwright, and focused Product scanner
    Playwright passed on frontend hash `2641f1ce0445f430`.
24. Split product filter menu section builder. Done:
    `productMenuHelpers.mjs` now also owns Product filter menu section and
    option construction, including year/month, branch, group, stock, category,
    brand, and supplier filter toggles. `Products.tsx` now delegates the menu
    data builder while keeping the shared `FilterMenu` UI unchanged. The moved
    behavior has focused source tests for section ordering, active flags, and
    toggle side effects. Source checks, typecheck, production build, runtime
    health, focused Product page Playwright, and focused Product scanner
    Playwright passed on frontend hash `b96c2bf7d1b6c06e`.
25. Split product row display state helpers. Done:
    `productDisplayHelpers.mjs` now also owns row purchase-price fallback,
    margin math, visible stock quantity, promotion calculation, compact
    brand/category metadata, branch labels, and mobile stock badge presentation.
    `Products.tsx` now delegates shared desktop/mobile row display state while
    keeping row rendering and actions unchanged. The moved behavior has focused
    source tests for margins, status labels/classes, compact metadata, and
    promotion pricing. Source checks, typecheck, production build, runtime
    health, focused Product page Playwright, and focused Product scanner
    Playwright passed on frontend hash `8426a118f46c25cc`.
26. Split product lightbox state helper. Done:
    `productGalleryHelpers.ts` now also owns lightbox image URL resolution,
    empty-gallery handling, and start-index clamping. `Products.tsx` now
    delegates lightbox state construction while keeping the lightbox UI and
    navigation actions unchanged. The moved behavior has focused source tests
    for resolved upload URLs, high/negative/invalid index clamping, title
    preservation, and empty galleries. Source checks, typecheck, production
    build, runtime health, focused Product page Playwright, and focused Product
    scanner Playwright passed on frontend hash `3469c4d8b3425629`.
27. Split product lightbox index helpers and remove dead overlay branch. Done:
    `productGalleryHelpers.ts` now also owns reusable lightbox index clamping
    and active lightbox index updates. `Products.tsx` now delegates gallery
    index changes to that helper and no longer carries the disabled legacy
    `false && lightbox` overlay branch. The moved behavior has focused source
    tests for high/low/invalid/empty index clamping, null lightbox state, and
    existing state preservation. Source checks, typecheck, production build,
    runtime health, focused Product page Playwright, and focused Product
    scanner Playwright passed on frontend hash `713180d4d834b1ce`.
28. Split product detail lightbox gallery-input helper. Done:
    `productGalleryHelpers.ts` now also owns the detail-modal lightbox input
    decision: prefer a normalized clicked gallery when present, otherwise fall
    back to the clicked image source. `Products.tsx` now delegates that
    gallery/source fallback before opening the shared lightbox, keeping the
    detail modal UI unchanged. The moved behavior has focused source tests for
    gallery preference, clicked-source fallback, de-duplication, trimming, and
    empty inputs. Source checks, typecheck, production build, runtime health,
    focused Product page Playwright, and focused Product scanner Playwright
    passed on frontend hash `ce63c5f06c94a85e`.
29. Split product thumbnail state helper. Done:
    `productGalleryHelpers.ts` now also owns row thumbnail state construction:
    one normalized gallery, a `hasImage` flag, and the first thumbnail path.
    Desktop and mobile product rows now compute that state once per row and use
    it for both thumbnail display and lightbox open, instead of repeating
    gallery normalization in JSX. A stale removed callback dependency briefly
    crashed the Products page during live verification; debugging traced the
    root cause to the dependency array, removed it, rebuilt, and reran the live
    checks successfully. Focused source checks, typecheck, helper tests,
    production build, performance verification, runtime health, focused Product
    page Playwright, and focused Product scanner Playwright passed on frontend
    hash `3e2b508f0b07839b`.
30. Split product collection index helpers. Done:
    `productSelectionHelpers.mjs` now also owns product id map construction and
    parent-product id set construction. `Products.tsx` now delegates the
    `productsById` and `parentProductIds` indexes used by grouping and
    filtering, keeping the filter/group behavior unchanged while making invalid
    ids and duplicate parent references source-tested. Focused source checks,
    typecheck, helper tests, production build, performance verification,
    runtime health, focused Product page Playwright, and focused Product
    scanner Playwright passed on frontend hash `d225ee10885691f9`.
31. Split product write payload helper. Done:
    `productWriteHelpers.mjs` now owns Products restore/write payload
    construction, including normalized gallery/image fields, price fallbacks,
    stock thresholds, active/group flags, parent ids, and user attribution.
    `Products.tsx` keeps only a small user-context wrapper for undo/redo,
    restore, and deleted-product recreation flows. The moved behavior has
    focused source tests for gallery de-duplication, price fallback, threshold
    normalization, group/variant flags, and user metadata. Focused source
    checks, typecheck, helper tests, production build, performance
    verification, runtime health, focused Product page Playwright, and focused
    Product scanner Playwright passed on frontend hash `87ac9fa332bb6004`.
32. Split product branch-stock restore planner. Done:
    `productWriteHelpers.mjs` now also owns branch-stock restore adjustment
    planning. It compares target snapshot stock with current branch stock,
    filters invalid branch ids, treats invalid quantities as zero, and returns
    only the add/remove deltas needed for restore. `Products.tsx` now keeps the
    API loop focused on executing those planned adjustments instead of mixing
    map/set diffing with mutation calls. Focused source checks, typecheck,
    helper tests, production build, performance verification, runtime health,
    focused Product page Playwright, and focused Product scanner Playwright
    passed on frontend hash `f8c95fdbb7171cff`.
33. Split deleted-product restore planning helpers. Done:
    `productWriteHelpers.mjs` now also owns the smaller deleted-restore
    planning decisions: default branch selection, deleted-id set construction,
    preferred restore branch selection, and parent-id remapping when a deleted
    parent is restored in the same batch. `Products.tsx` now keeps the
    deleted-product restore loop focused on payload creation, API calls, id
    tracking, and branch-stock restoration. Focused source checks, typecheck,
    helper tests, production build, performance verification, runtime health,
    focused Product page Playwright, and focused Product scanner Playwright
    passed on frontend hash `f355894dc1465d5c`.
34. Split product clear-stock adjustment planner. Done:
    `productWriteHelpers.mjs` now also owns bulk out-of-stock branch-row
    planning. It filters invalid branch ids, ignores zero/invalid quantities,
    resolves purchase/cost unit prices once, and returns only valid stock
    removal adjustments. `Products.tsx` now keeps the out-of-stock loop focused
    on executing preplanned branch adjustments. Focused source checks,
    typecheck, helper tests, production build, performance verification,
    runtime health, focused Product page Playwright, and focused Product
    scanner Playwright passed on frontend hash `2fbb7e7e9a4dee2c`.
35. Split product branch-move planner. Done:
    `productWriteHelpers.mjs` now also owns bulk branch-change planning. It
    identifies the first valid positive-stock branch, returns an explicit
    transfer plan when stock must move, returns an initialize plan when the
    product has no valid positive stock, and returns no-op when stock is
    already in the target branch. `Products.tsx` now keeps the branch-change
    mutation loop focused on executing those explicit plans. Focused source
    checks, typecheck, helper tests, production build, performance
    verification, runtime health, focused Product page Playwright, and focused
    Product scanner Playwright passed on frontend hash `749aede9830d88e9`.
36. Split product bulk-run summary helper. Done:
    `productWriteHelpers.mjs` now also owns bulk operation result summaries for
    product workflows. The helper extracts positive finite success and failure
    product ids and returns one stable `{ done, failed, failedIds, updatedIds }`
    shape. Bulk delete, bulk add stock, bulk branch move, and bulk update flows
    now delegate their concurrent-run summaries to that helper instead of
    repeating id extraction inline. A focused helper test caught the
    `Number(null) === 0` edge, so the helper rejects zero ids explicitly.
    Focused source checks, typecheck, helper tests, production build,
    performance verification, runtime health, focused Product page Playwright,
    and focused Product scanner Playwright passed on frontend hash
    `8e1cbcfe93564245`.
37. Split product bulk-update payload helpers. Done:
    `productWriteHelpers.mjs` now also owns defined update filtering and bulk
    update payload construction for product update and redo flows. The helper
    removes only `undefined` fields, preserves intentional `null` and blank
    string updates, attaches user attribution, and selects the current
    optimistic-lock timestamp before falling back to the snapshot timestamp for
    redo. `Products.tsx` now keeps the bulk update loop focused on confirmation,
    concurrent execution, failed-id selection, undo/redo registration, and
    notifications. Focused source checks, typecheck, helper tests, production
    build, performance verification, runtime health, focused Product page
    Playwright, and focused Product scanner Playwright passed on frontend hash
    `b7f08da087125792`.
38. Split product bulk edit update builders. Done:
    `productWriteHelpers.mjs` now also owns bulk info and pricing edit
    form-to-update shaping. The info helper keeps populated category, unit,
    supplier, brand, and valid low-stock threshold values while ignoring blank
    fields and unsafe threshold text. The pricing helper normalizes only
    provided price fields through the shared price normalizer. `Products.tsx`
    no longer imports pricing normalization directly or assembles those update
    objects inside render handlers. Focused source checks, typecheck, helper
    tests, production build, performance verification, runtime health, focused
    Product page Playwright, and focused Product scanner Playwright passed on
    frontend hash `2b36f4913641bbb3`.
39. Split product stock adjustment payload builder. Done:
    `productWriteHelpers.mjs` now also owns shared stock-adjustment payload
    construction for bulk add-stock and clear-stock execution paths. The helper
    normalizes product ids, product names, branch ids, quantities, user
    attribution, reasons, and unit-cost fallback/override behavior in one
    source-tested place. `Products.tsx` now delegates nested clear-stock and
    add-stock `window.api.adjustStock(...)` payload construction while keeping
    the workflow loops responsible for fetching latest products, running
    concurrent tasks, and refreshing state. A diagnostic Playwright probe
    confirmed the Add Product modal opened after one transient live-check wait
    timeout; the focused Product page and scanner checks then passed on the same
    bundle. Focused source checks, typecheck, helper tests, production build,
    performance verification, runtime health, focused Product page Playwright,
    and focused Product scanner Playwright passed on frontend hash
    `48b70424364d4ee8`.
40. Finish product adjust-stock payload delegation. Done:
    `productWriteHelpers.mjs` now covers every `window.api.adjustStock(...)`
    payload in `Products.tsx`: restore branch-stock sync, deleted-product stock
    restore, clear-stock, bulk add-stock, and branch initialization. The helper
    now supports snapshot product-name overrides and zero-quantity branch
    initialization while preserving purchase/cost unit-cost fallback behavior.
    `Products.tsx` no longer carries raw `adjustStock({ ... })` object
    construction; the page keeps ownership of fetches, concurrency, restore
    order, transfer-stock calls, and refresh/notification flow. Focused source
    checks, typecheck, helper tests, production build, performance
    verification, runtime health, focused Product page Playwright, and focused
    Product scanner Playwright passed on frontend hash `543cc58df3c2b094`.
41. Split product transfer-stock payload builder. Done:
    `productWriteHelpers.mjs` now also owns transfer-stock payload construction
    for the bulk branch-move transfer path. The helper maps the branch-move
    plan into `fromBranchId`, `toBranchId`, quantity, product identity, note,
    and user attribution. A focused helper test caught invalid branch-id
    normalization before build verification, so the helper now uses the shared
    finite-number normalizer for transfer branch ids. `Products.tsx` keeps
    ownership of choosing transfer versus branch initialization while delegating
    the transfer payload shape. Focused source checks, typecheck, helper tests,
    production build, performance verification, runtime health, focused Product
    page Playwright, and focused Product scanner Playwright passed on frontend
    hash `875d7a0928f443de`.
42. Add storage-retention cleanup lane. Done:
    `ops/scripts/runtime/storage/prune-storage.ts` owns generated runtime report
    pruning, local datasync backup pruning across root and organization backup
    folders, optional ignored demo artifact removal, and Cloudflare R2 backup
    mirror pruning. Backend backup packages now expose pure retention planning
    and local/remote prune helpers, and final backup creation schedules
    retention after package completion. Full automation runs the retention lane
    before heavy checks so reports and backup versions do not grow without
    bound. Cloudflare Access policy now reads a 720-hour admin session duration
    from automation policy to reduce repeated email-code prompts.
43. Normalize Backup page line endings for whitespace gate stability. Done:
    `frontend/src/components/utils-settings/Backup.tsx` is now LF-normalized
    so `git diff --check` no longer reports every changed line as trailing
    whitespace. Backup UI utility tests, frontend JSX syntax check, frontend
    typecheck, focused `git diff --check`, and full `git diff --check` passed;
    only normal Git CRLF conversion warnings remain.
44. Harden Backup Drive and job action pathways. Done:
    `frontend/src/components/utils-settings/Backup.tsx` now wraps Google Drive
    sync preferences, OAuth start, manual sync queueing, disconnect, credential
    forget, backup export/restore queueing, and system-job cancellation in
    explicit timeout contracts while keeping the existing same-tick action
    locks. `frontend/tests/backupJobs.test.ts` now source-tests those timeout
    wrappers. Backup source tests, JSX check, typecheck, production build,
    focused diff whitespace check, in-app browser Backup action verification,
    and the broad Phase 8.4 Playwright UI live check passed on frontend hash
    `184285cf77ae8c5e`.
45. Harden Files library asset upload/delete actions. Done:
    `frontend/src/components/files/FilesPage.tsx` and
    `frontend/src/components/files/FilePickerModal.tsx` now wrap file asset
    uploads and deletes in explicit timeout contracts while preserving their
    same-tick upload/delete guards. The Files selected-assets toolbar also uses
    the imported `Download` icon instead of an undefined `Save` symbol. Focused
    action stability tests, performance loading UX tests, JSX check, typecheck,
    production build, a live Playwright upload/search/delete cleanup loop, and
    the broad Phase 8.4 Playwright UI live check passed on frontend hash
    `d0e1a511d334b9e4`.
46. Harden Settings and Catalog media upload pathways. Done:
    `frontend/src/components/utils-settings/Settings.tsx` and
    `frontend/src/components/catalog/CatalogPage.tsx` now wrap their
    `uploadFileAsset(...)` media uploads in explicit 30s timeout contracts while
    preserving keyed same-tick guards, abort controllers, progress updates,
    preview rollback, and non-persisted draft behavior. Focused action
    stability tests, performance loading UX tests, JSX check, typecheck,
    production build, broad Phase 8.4 Playwright UI live check, and a targeted
    Settings upload/search/delete cleanup loop passed on frontend hash
    `e0a84171cdaad979`.
47. Harden Product form image upload pathway. Done:
    `frontend/src/components/products/forms/ProductForm.tsx` now wraps the Add
    Product/Edit Product direct `window.api.uploadProductImage(...)` file upload
    path in an explicit 30s timeout contract while preserving the existing
    same-tick upload guard, five-image limit, staged gallery behavior, and
    cache-busted preview handling. Focused action stability tests, performance
    loading UX tests, JSX check, typecheck, production build, focused Product
    page Playwright, a targeted Add Product image upload/render/API cleanup
    loop, broad Phase 8.4 Playwright UI live check, and storage pruning passed
    on frontend hash `5e4397389d09fb6a`.
48. Harden AppContext auth and settings write pathways. Done:
    `frontend/src/AppContext.tsx` now wraps login, logout, Google OAuth link
    completion, server settings save, and session-duration refresh in explicit
    timeout contracts while keeping existing session persistence, bootstrap,
    conflict handling, and local-device setting behavior. Focused loading UX,
    receipt-settings sync, owned Google auth, action stability, JSX, typecheck,
    production build, a targeted fresh-browser login/settings-save Playwright
    loop, broad Phase 8.4 Playwright UI live check, and storage pruning passed
    on frontend hash `f1e8f62676674afa`.
49. Harden POS write pathways. Done:
    `frontend/src/components/pos/POS.tsx` now wraps POS quick-add customer,
    quick-add delivery contact, and checkout sale creation in explicit timeout
    contracts while preserving the existing same-tick customer, delivery, and
    checkout guards plus sale idempotency. Focused action stability tests,
    performance loading UX tests, JSX check, typecheck, production build,
    targeted POS quick-add customer/delivery Playwright create-and-cleanup
    verification, broad Phase 8.4 Playwright UI live check, and storage pruning
    passed on frontend hash `080d514c34776914`.
50. Harden Returns write pathways. Done:
    `frontend/src/components/returns/NewReturnModal.tsx`,
    `frontend/src/components/returns/EditReturnModal.tsx`, and
    `frontend/src/components/returns/NewSupplierReturnModal.tsx` now wrap
    customer return create, customer return update, and supplier return create
    writes in explicit timeout contracts while preserving same-tick submit
    guards, conflict handling, backend idempotency coverage, and
    inventory/sales/returns refresh events. Focused action stability tests,
    performance loading UX tests, JSX check, typecheck, production build, broad
    Phase 8.4 Playwright UI live check, and storage pruning passed on frontend
    hash `0c203e94c6184818`.
51. Add Cloudflare public portal live verification. Done:
    `ops/scripts/runtime/live-checks/phase84-public-portal-cloudflare-check.ts`
    now opens `https://leangcosmetics.dpdns.org/public` through Playwright,
    verifies customer-facing content renders, rejects visible
    `{"success":false}` / internal-server-error output, asserts portal config,
    metadata, product search, and AI status endpoints return HTTP 200, and
    writes a screenshot/report. The first passing run rendered 40 visible
    product/article cards with zero HTTP 5xx responses, zero page errors, and
    zero relevant console messages. Report:
    `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-05-18T13-29-11-716Z/report.json`.
52. Harden Returns history restore writes. Done:
    `frontend/src/components/returns/Returns.tsx` now wraps action-history
    undo/redo return restore `updateReturn(...)` calls in a 15s timeout contract
    and a same-tick restore guard. This prevents rapid repeated undo/redo clicks
    from stacking return rewrites that can affect sales, inventory, stock
    movements, and return accounting. Focused action stability tests,
    performance loading UX tests, JSX check, typecheck, and production build
    passed on frontend hash `c760b6afc8011408`.
53. Harden destructive reset actions. Done:
    `frontend/src/components/utils-settings/ResetData.tsx` now wraps typed-confirm
    business-data reset and factory-reset calls in shared same-tick guards plus
    explicit long-running timeout contracts. This keeps reset/factory-reset
    requests from stacking under repeated clicks and prevents an indefinite
    Working/Resetting state if the destructive backend operation stalls.
    Focused action stability tests, performance loading UX tests, JSX check,
    typecheck, production build, broad Phase 8.4 Playwright UI live check, and
    storage pruning passed on frontend hash `41ba19c6e7f1bb2d`.
54. Harden Server queue and connection actions. Done:
    `frontend/src/components/server/ServerPage.tsx` now wraps pending-sync queue
    retry, pending-sync queue discard, and manual sync-server connection test
    actions in same-tick guards plus explicit 12s timeout contracts. This keeps
    repeated clicks from stacking server queue operations and prevents the
    connection-test spinner from hanging indefinitely. Focused action stability
    tests, performance loading UX tests, JSX check, typecheck, production build,
    and broad Phase 8.4 Playwright UI live check passed on frontend hash
    `baaa4a6c9a19b70f`.
55. Harden Audit Log retention cleanup. Done:
    `frontend/src/components/utils-settings/AuditLog.tsx` now wraps the admin
    "Clear 30d" audit-log retention delete in a shared same-tick guard and a
    12s timeout contract, while disabling the button during cleanup. This keeps
    repeated clicks from stacking destructive retention cleanup calls and avoids
    an indefinite loading state if the delete request stalls. Focused action
    stability tests, performance loading UX tests, JSX check, typecheck,
    production build, and broad Phase 8.4 Playwright UI live check passed on
    frontend hash `f6d54693ea42f9a0`.
56. Harden Catalog portal submission writes. Done:
    `frontend/src/components/catalog/CatalogPage.tsx` now wraps customer portal
    share-proof submission creation and staff submission review actions in
    shared same-tick guards plus explicit 12s timeout contracts. This prevents
    repeated clicks from stacking customer submission writes or duplicate review
    decisions, while preserving the existing membership refresh and portal
    refresh behavior. Focused action stability tests, performance loading UX
    tests, JSX check, typecheck, production build, and broad Phase 8.4
    Playwright UI live check passed on frontend hash `813ec1480c527052`.
57. Harden Products page history and bulk mutation pathways. Done:
    `frontend/src/components/products/Products.tsx` now routes product
    action-history restore/delete, deleted-product restore, bulk product update,
    clear-stock, bulk add-stock, and bulk branch-move stock writes through the
    existing bounded product write/delete runners or a new 12s stock mutation
    runner. This removes remaining direct awaited product/stock mutation calls
    from the main Products page while preserving existing undo/redo, restore,
    reload, and bulk-summary behavior. Focused source tests now assert the
    helper contracts and reject direct awaited product/stock mutation calls.
    Action stability tests, performance loading UX tests, JSX check, typecheck,
    production build, broad Phase 8.4 Playwright UI live check, public
    Cloudflare portal Playwright check, and local storage pruning passed on
    frontend hash `70927cf691f499db`. Reports:
    `ops/runtime/reports/phase84-ui-live-check-2026-05-18T22-45-06-995Z/report.json`
    and
    `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-05-18T22-50-34-125Z/report.json`.
58. Add whole-codebase multi-sweep cleanup/schema/optimization phase. Done:
    Phase 29 now coordinates repeated whole-codebase inventory, generated-bulk
    measurement, relational schema verification, loop/function analysis,
    dead-code/duplication review, folder rewire candidates, language/runtime
    candidates, Cloudflare/runtime pathway checks, cleanup execution reporting,
    and repeat verification. The first cleanup execution removed safe
    ignored/generated bulk (`ops/node_modules`, unpacked `ops/scanbot-web-sdk-*`,
    generated release/output/browser artifacts, root Vite logs, old runtime
    build/demo/migration artifacts, stale prune JSON files, and old
    Docker-release backup packages) while preserving secrets, current runtime
    env files, business uploads, and newest backup packages. Future Phase 26
    folder moves and Phase 27 language conversions must cite Phase 29 inventory
    evidence before changing source structure or runtime language. Schema audit,
    organization audit, generated reference refresh, performance scan refresh,
    backend utility tests, frontend utility tests, typecheck, JSX check,
    production build, broad Phase 8.4 Playwright UI live check, public
    Cloudflare portal live check, and storage pruning passed on frontend hash
    `a6a634e7a29d6a46`.
59. Teach backup retention about Docker-release timestamp packages. Done:
    `backend/src/services/backupPackages.ts` now recognizes timestamped
    Docker-release backup folders such as `20260509-065427` only under
    `ops/runtime/docker-release/backups`, while normal backup roots remain
    limited to `datasync-*` packages. `backend/test/backupRetention.test.ts`
    now proves the retention planner keeps the newest Docker-release timestamp
    packages and leaves unrelated folders untouched. This folds the manual
    Phase 29 cleanup rule into the standard `prune-storage` path.
60. Add recovery-report retention to standard cleanup. Done:
    `ops/scripts/runtime/storage/prune-storage.ts` owns
    `ops/runtime/recovery-reports` retention with a default latest-five policy
    and optional `--recovery-reports-keep` override. The helper can prune both
    recovery-report directories and generated top-level files when explicitly
    requested, while the normal runtime report cleanup remains directory-only.
    The first live prune removed three old recovery artifacts and kept the five
    newest Khmer repair reports.
61. Group storage cleanup runtime script. Done:
    The storage retention implementation moved to
    `ops/scripts/runtime/storage/prune-storage.ts`. `ops/package.json` and
    full automation point at the grouped storage path directly. The temporary
    root runtime compatibility wrapper stayed in place until Move 74, when the
    remaining test and plan references were rewired and the wrapper was
    removed.
62. Group Cloudflare runtime scripts. Done:
    Cloudflare and R2 runtime helpers moved to
    `ops/scripts/runtime/cloudflare/`, while old root-level runtime paths remain
    as compatibility wrappers. `run/cloudflare-origin.bat`,
    `run/docker/rotate-cloudflare.bat`, hardening policy, and full automation
    now point at the grouped Cloudflare implementation path directly. Backend
    automation tests read the grouped implementation and assert the old
    `verify-cloudflare-automation.ts` wrapper still forwards to it.
63. Group deep audit runtime scripts. Done:
    Full-app and deep-live audit implementations plus their shared auth,
    manifest, and HTML-report helpers moved to
    `ops/scripts/runtime/audits/`. The old root-level runtime audit files now
    remain as compatibility wrappers or re-export modules, so Phase 8.4
    live-check imports and older direct commands keep working. `ops/package.json`
    now points `deep-live-audit` at the grouped implementation.
64. Group smoke/runtime probe scripts. Done:
    Public URL checks, route-contract checks, and the live smoke flow moved to
    `ops/scripts/runtime/smoke/`. Root-level runtime smoke paths remain as
    compatibility wrappers. `run/start-server.bat`, `run/sh/start-server.sh`,
    `run/verify-local.bat`, PowerShell runtime/release scripts, and the backend
    `verify:live-smoke` package script now call the grouped smoke paths
    directly.
65. Group ops verification scripts. Done:
    Root-level `verify-*` implementation scripts moved to
    `ops/scripts/verification/`, while old `ops/scripts/verify-*.js` paths
    remain compatibility wrappers. `run/verify-local.bat`, full automation, and
    backend Google-auth tests now read/call the grouped verification
    implementations directly and assert wrapper forwarding where needed.
66. Group docs and reporting generator scripts. Done:
    Documentation reference generation, full project docs generation, and the
    performance scan moved to `ops/scripts/docs/`. The grouped generator
    scripts now import shared filesystem helpers from `../lib/fs-utils`.
    Root-level generator compatibility wrappers stayed in place until Move 75,
    when generated reference headers and inventories were updated to use only
    the grouped commands.
67. Delete obsolete Firebase release env sync helper. Done:
    `ops/scripts/sync-firebase-release-env.ps1` had no first-party callers after
    the release flow moved to owned Google auth and Docker release env handling.
    A reference scan found only generated docs and the file itself, so the
    unused tracked helper was deleted instead of wrapped. Docker release,
    secret hygiene, and backend auth tests remain the verification gates for
    this deletion.
68. Teach organization audit about compatibility wrappers. Done:
    `ops/scripts/architecture/organization-audit.ts` now detects thin root
    wrappers under `ops/scripts` and `ops/scripts/runtime`, reports their
    grouped implementation targets, and flags broken wrapper targets. This keeps
    the intentional wrapper layer visible while future cleanup continues to move
    callers onto grouped implementation paths.
69. Promote compatibility-wrapper audit to a failing gate. Done:
    `ops/scripts/architecture/organization-audit.ts` now exits nonzero when an
    intentional compatibility wrapper points at a missing grouped
    implementation. The report is still written first, then the audit prints
    every broken wrapper mapping to stderr so future folder moves cannot quietly
    strand old commands or automation entrypoints.
70. Add wrapper reference and removal-candidate tracking. Done:
    `ops/scripts/architecture/organization-audit.ts` now scans `run/` plus
    root/package configuration files, separates active wrapper references from
    generated-reference mentions, and lists wrappers that have no active
    first-party callers. The pre-deletion audit reported 22 intact wrappers and
    zero broken targets, while identifying 17 wrapper removal candidates whose
    remaining references were generated docs that could be refreshed after a
    safe deletion slice.
71. Delete generated-only compatibility wrappers. Done:
    Seventeen obsolete root compatibility wrappers with zero active first-party
    callers were removed after the organization audit identified them as
    generated-reference-only paths. The grouped implementations remain under
    `ops/scripts/runtime/audits`, `ops/scripts/runtime/smoke`,
    `ops/scripts/runtime/cloudflare`, and `ops/scripts/verification`; generated
    references were refreshed immediately after this deletion so old wrapper
    paths do not linger as source inventory. Latest organization audit reports
    383 scanned files, 5 remaining compatibility wrappers, zero broken targets,
    and zero wrapper-removal candidates.
72. Expand wrapper audit coverage to test files. Done:
    Backend utility verification exposed that old wrapper references inside
    `backend/test` were outside the organization audit scan roots. The audit now
    includes `backend/test` and `frontend/tests`, and the affected backend tests
    assert the grouped implementation paths plus absence of deleted wrapper
    files. Backend and frontend utility suites, production build, broad Phase
    8.4 Playwright, public Cloudflare portal Playwright, stale-path scan, and
    storage pruning passed on frontend hash `201f436a6618c27e`.
73. Rewire live-check auth helper imports and delete the auth wrapper. Done:
    Phase 8.4 live-check scripts now import the grouped auth helper from
    `ops/scripts/runtime/audits/audit-auth.ts` directly. The old
    `ops/scripts/runtime/audit-auth.ts` compatibility wrapper became
    generated-reference-only and was deleted after the organization audit
    reported zero active references.
74. Delete the storage cleanup compatibility wrapper. Done:
    `ops/package.json`, full automation, and storage-retention tests now rely on
    `ops/scripts/runtime/storage/prune-storage.ts` directly. The old root
    runtime storage wrapper had no remaining command entrypoint responsibility
    and was deleted after its final test assertion was converted into an
    absence check.
75. Delete root documentation generator wrappers. Done:
    Generated reference headers now advertise grouped documentation commands
    only, and the docs inventory no longer self-keeps the old root generator
    wrapper files. The old root doc-reference generator, full-project docs
    generator, and performance-scan wrapper were deleted after reference scans
    showed no first-party callers outside stale generated output.
76. Share docs filesystem scan helpers. Done:
    `ops/scripts/docs/generate-full-project-docs.ts` now uses the shared
    `ops/scripts/lib/fs-utils.ts` helpers for project-root resolution,
    POSIX-relative paths, UTF-8 reads, JSON reads, line counts, root-file
    collection, recursive file/folder collection, and text detection. The
    shared walker now handles excluded directory names case-insensitively, so
    documentation and performance scans follow the same skip behavior.
77. Share function-reference docs scan helpers. Done:
    `ops/scripts/docs/generate-doc-reference.ts` now uses the shared
    filesystem helper library for project-root resolution, POSIX-relative
    paths, UTF-8 reads, JSON reads, root-file collection, and recursive file
    discovery. This removes the second local docs walker and keeps the backend,
    frontend, root-script, translation, and run/release references aligned with
    the same traversal behavior as the full-project and performance docs.
78. Share Phase 8.4 live-check JSON request helpers. Done:
    The Phase 8.4 Playwright live-check scripts now import
    `ops/scripts/runtime/live-checks/live-check-utils.ts` for guarded JSON
    reads instead of carrying identical timeout/fetch/JSON helper functions in
    each action-check file. This keeps the live-check scripts lighter while
    preserving their route-specific assertions, labels, screenshots, and report
    outputs.
79. Harden the public Cloudflare portal live check against CSP false positives.
    Done: `phase84-public-portal-cloudflare-check.ts` now records the main
    document CSP headers, asserts the enforced CSP includes first-party script
    and connect sources, asserts no report-only CSP header is present, and
    ignores browser report-only CSP console chatter only after the real page,
    API, product-rendering, CSP, and page-error checks remain clean.
80. Share Phase 8.4 live-check console, response, and modal helpers. Done:
    `ops/scripts/runtime/live-checks/live-check-utils.ts` now owns the common
    ignored-console filter, latest observed response lookup, guarded
    `waitForRead` helper, and top-modal close helper. Route-specific live-check
    scripts keep their own page flows and assertions, but no longer carry
    duplicate console/status/modal plumbing.
81. Share Phase 8.4 live-check console collector wiring. Done:
    Local Phase 8.4 Playwright checks now call the shared
    `attachConsoleCollector` helper instead of duplicating console and
    page-error event handlers. The public Cloudflare portal checker keeps its
    custom all-console capture so CSP diagnostics remain fully visible.
82. Extend generated cleanup and Docker-ignore hygiene. Done:
    `ops/.playwright-cli` and `run/cv-render-check-word` were deleted as
    generated local artifacts after exact-path scans showed no active
    first-party callers. `.gitignore`, `.dockerignore`, and
    `ops/scripts/powershell/clean-generated.ps1` now cover those paths, and the
    cleanup script also targets root `output`. Docker cleanup was limited to a
    stopped container plus builder cache; volumes and current release images
    were preserved to avoid data loss.
83. Add opt-in Docker-safe prune to storage retention. Done:
    `ops/scripts/runtime/storage/prune-storage.ts` now accepts
    `--docker-safe-prune`, reports `docker system df`, and prunes only stopped
    containers plus builder cache. It never prunes Docker volumes, images, or
    the whole Docker system. `ops/automation/business-os-automation.json`
    enables this through `cleanup.dockerSafePrune`, and full automation passes
    the flag during retention cleanup.
84. Enforce Docker cleanup and release guardrails. Done:
    `ops/scripts/verification/verify-docker-release.ts` now fails if
    `.dockerignore` drops generated/runtime exclusions, `.gitignore` drops the
    local render-artifact cleanup rule, storage retention loses the
    `--docker-safe-prune` lane, or the automation policy/full-automation script
    stop wiring that lane. The verifier also rejects Docker volume, image, and
    full-system prune commands in retention cleanup so future optimization work
    cannot accidentally cross the data-loss boundary.
85. Add repeatable generated-bulk audit. Done:
    `ops/scripts/architecture/generated-bulk-audit.ts` now measures generated,
    runtime, dependency, build, release, and protected data folders without
    parsing them as source. It writes
    `ops/docs/reference/GENERATED-BULK-AUDIT.md`, checks ignore coverage, keeps
    business data/uploads/secrets protected, and documents the cleanup rule for
    each target. `ops/package.json` exposes it as `npm --prefix ops run
    generated-bulk-audit`.
86. Add generated-bulk audit to full automation. Done:
    `ops/scripts/powershell/full-automation.ps1` now runs
    `ops/scripts/architecture/generated-bulk-audit.ts` during the test gate,
    after frontend build and before Docker release verification. Regular
    check/test/release automation now catches generated/runtime ignore drift and
    cleanup-boundary regressions without deleting protected business data.
87. Add policy threshold and JSON output for generated bulk. Done:
    `generated-bulk-audit.ts` now accepts `--policy`, writes
    `ops/docs/reference/GENERATED-BULK-AUDIT.json`, and fails when
    non-protected cleanup candidates exceed
    `cleanup.generatedBulkCandidateMaxBytes`. The automation policy sets that
    cap to 536,870,912 bytes, so real business data can grow normally while
    stale release/build/dependency artifacts cannot silently balloon past the
    regular check gate.
88. Align generated cleanup preview with generated-bulk audit. Done:
    `clean-generated.ps1` now covers root and ops dependency folders in
    addition to frontend/backend dependencies, build output, release kits, and
    browser/render artifacts. Runtime logs were removed from broad generated
    cleanup so active logs stay under runtime/retention handling. The generated
    bulk audit now checks that every non-protected cleanup candidate has a
    matching `clean-generated.ps1` target, and `ops/package.json` exposes
    `clean-generated:preview` for non-mutating cleanup rehearsals.
89. Add one-command Phase 29 audit loop. Done:
    `ops/scripts/architecture/phase29-audit.ts` now runs the generated-bulk
    audit, organization audit, schema audit, and Docker release guardrail as one
    non-mutating sweep. It writes `ops/docs/reference/PHASE29-AUDIT.md` and is
    exposed as `npm --prefix ops run phase29:audit`, giving future sessions one
    stable command for the repeated Phase 29 check loop.
90. Use the combined Phase 29 audit in full automation. Done:
    `ops/scripts/powershell/full-automation.ps1` now runs
    `phase29-audit.ts` as the test-gate cleanup/schema/organization/Docker
    guardrail step after the frontend production build. This replaces separate
    generated-bulk and Docker release verifier calls in the automation script,
    keeping the workflow easier to run while expanding the regular gate to
    include organization and schema audit coverage.
91. Add machine-readable Phase 29 audit summary. Done:
    `phase29-audit.ts` now writes
    `ops/docs/reference/PHASE29-AUDIT.json` alongside the Markdown report. The
    JSON summary records policy path, non-mutating mode, total checks, failures,
    per-check status, duration, command, and report outputs so future automation
    can consume the repeated sweep result without parsing Markdown.
92. Add executable three-pass Phase 29 repeat loop. Done:
    `phase29-audit.ts` now accepts `--repeat`, records cycle numbers in both
    Markdown and JSON reports, and caps repeat count to prevent accidental
    runaway loops. `ops/package.json` exposes
    `npm --prefix ops run phase29:audit:repeat`, which runs the required
    three-pass sweep loop across generated bulk, organization, schema, and
    Docker release guardrails.
93. Add cross-cycle drift checks to Phase 29 repeat audit. Done:
    `phase29-audit.ts` now parses JSON output from child audits and compares
    stable generated-bulk and organization fields across repeat cycles. The
    repeat audit fails if cleanup candidate sizes, ignore/cleanup gaps,
    protected cleanup drift, file counts, or wrapper counts change between
    cycles. Schema and Docker checks remain pass/fail text gates.
94. Add performance/code-flow scan to Phase 29 repeat audit. Done:
    `ops/scripts/docs/performance-scan.ts` now writes
    `ops/docs/reference/PERFORMANCE-SCAN.json` with source file counts, built
    asset counts, total source bytes/lines, largest source/chunk markers, and
    oversized source/chunk candidate lists. `phase29-audit.ts` now runs that
    scan as part of the non-mutating audit loop and compares its structured
    fields across repeat cycles, so loop/function and large-module work has a
    stable machine-readable gate before deeper refactors.
95. Add schema JSON drift checks to Phase 29 repeat audit. Done:
    `ops/scripts/backend/schema-audit.ts` now writes
    `ops/docs/reference/SCHEMA-AUDIT.json` with static/runtime table counts,
    Dexie store counts, backup coverage counts, relationship coverage counts,
    and stable schema entity lists. `phase29-audit.ts` now includes that JSON
    in the report outputs and compares the schema fields across repeated
    cycles, so schema rewires and relationship documentation edits have the
    same deterministic gate as cleanup, organization, and performance work.
96. Add Docker guardrail JSON drift checks to Phase 29 repeat audit. Done:
    `ops/scripts/verification/verify-docker-release.ts` now writes
    `ops/docs/reference/DOCKER-RELEASE-GUARDRAIL.json` with required release
    file counts, missing file lists, wrapper counts, retired artifact lists,
    ignore coverage, Docker-prune safety coverage, and automation policy state.
    `phase29-audit.ts` includes that report and compares its structured fields
    across repeat cycles, so release cleanup guardrails are no longer only a
    pass/fail text check.
97. Persist organization audit JSON reference. Done:
    `ops/scripts/architecture/organization-audit.ts` now writes
    `ops/docs/reference/ORGANIZATION-AUDIT.json` beside the Markdown report.
    The JSON baseline records scanned file counts, large-file counts,
    compatibility-wrapper counts, scan roots/files, large-file paths, largest
    areas, and wrapper lists. Phase 29 now lists that JSON as an audit output,
    keeping folder/compatibility evidence durable for future folder rewires and
    cleanup decisions.
98. Compare full organization inventory in Phase 29 repeat audit. Done:
    `phase29-audit.ts` now compares organization scan roots, root files,
    large-file threshold, largest-area rows, large-file paths, wrapper files,
    broken wrapper files, and removable wrapper files across repeat cycles.
    This makes folder-rewire and cleanup evidence drift visible before future
    source moves, wrapper deletion, or large-module refactors proceed.
99. Persist ranked performance scan rows in Phase 29 repeat audit. Done:
    `ops/scripts/docs/performance-scan.ts` now writes ranked
    `topSourceBySize`, `topSourceByLines`, and `topBuiltChunks` rows into
    `ops/docs/reference/PERFORMANCE-SCAN.json`. `phase29-audit.ts` compares
    those ranked rows across repeat cycles, so large-module and chunk
    optimization candidates cannot drift silently between sweeps.
100. Compact Phase 29 Markdown repeat evidence. Done:
    `phase29-audit.ts` now keeps the complete repeat-consistency values in
    `ops/docs/reference/PHASE29-AUDIT.json` while rendering long Markdown
    values as item/key counts, stable SHA-256 digests, and short previews. This
    keeps the human audit report readable and smaller without losing the exact
    machine-readable schema, organization, performance, or cleanup evidence.
101. Compact Phase 29 console output. Done:
    `phase29-audit.ts` now captures child-check output for JSON parsing but
    prints only concise pass/fail, duration, and report-path lines by default.
    A `--verbose` flag restores full child stdout/stderr streaming for
    debugging. This makes repeated sweeps easier to read and cheaper to review
    without weakening the generated JSON, Markdown, or drift checks.
102. Parallelize generated-bulk target measurement. Done:
    `generated-bulk-audit.ts` now measures independent generated/runtime/data
    targets with `Promise.all` and records `measurementMode:
    parallel-targets` plus `measuredTargetsInParallel: true` in the JSON
    summary. Phase 29 repeat compares those fields so the faster measurement
    pathway cannot silently regress to sequential target walks.
103. Persist ranked generated-bulk target summaries. Done:
    `generated-bulk-audit.ts` now records `largestProtectedTargets` and
    `largestCleanupTargets` in `ops/docs/reference/GENERATED-BULK-AUDIT.json`.
    Phase 29 repeat compares those ranked rows so cleanup decisions can focus
    on the largest safe candidates while protected data/runtime growth remains
    visible and stable across sweeps.
104. Add Phase 29 duration profiling. Done:
    `phase29-audit.ts` now records a `durationSummary` with total child-check
    time, per-check run totals/averages/max values, and ranked `slowestRuns`.
    The Markdown report includes Duration Summary and Slowest Runs tables so
    future workflow optimization can target the actual bottlenecks without
    treating runtime duration as a drift-stable contract.
105. Add bounded parallel organization-audit reads. Done:
    `organization-audit.ts` now walks scan roots in parallel and reads source
    files with a deterministic bounded parallel queue (`fileReadMode:
    bounded-parallel`, `fileReadConcurrency: 24`). Phase 29 repeat compares
    those fields so organization sweeps keep the faster read pathway without
    making output order nondeterministic.
106. Add generated-bulk per-target timing evidence. Done:
    `generated-bulk-audit.ts` now records `measureMs` for every target and a
    ranked `slowestTargetMeasurements` list in
    `ops/docs/reference/GENERATED-BULK-AUDIT.json`. The Markdown target table
    also shows each measurement time, giving future cleanup/resource work a
    concrete target list without making variable disk timings part of the drift
    contract.
107. Add bounded generated-bulk file-stat parallelism. Done:
    `generated-bulk-audit.ts` now stats files within each measured directory
    through a bounded per-directory queue (`fileStatMode:
    bounded-per-directory`, `fileStatConcurrency: 32`). This keeps exact byte
    counts while reducing avoidable sequential stat work in large dependency
    folders. Phase 29 repeat compares the stat mode and concurrency fields.
108. Add overlap-aware generated-bulk totals. Done:
    `generated-bulk-audit.ts` now records `nestedTargetOverlaps`,
    `nestedOverlapBytes`, and adjusted non-overlap estimates for total,
    protected, and cleanup-candidate bytes. Raw totals remain unchanged for
    compatibility, while cleanup planning can now see when a child target such
    as uploads or runtime secrets is also counted by a parent target.
109. Add executable language/runtime audit gate. Done:
    `ops/scripts/architecture/language-runtime-audit.ts` now scans maintained
    frontend, backend, ops, and run source roots and writes
    `ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.md` plus JSON. It records
    language counts, TypeScript utility candidates, Web Worker candidates,
    SQL/DuckDB data-path candidates, explicit runtime policy, and rejected
    Rust/Go/Python/WASM families. `phase29-audit.ts` now runs that audit and
    compares its structured fields across repeat cycles, while full automation
    labels Phase 29 as a schema, organization, cleanup, language, and Docker
    guardrail audit.
110. Add language conversion proof matrix. Done:
    `language-runtime-audit.ts` now writes a stable verification matrix and
    first executable slice list for TypeScript helper conversions, Web Worker
    extraction, and SQL/DuckDB data-path optimization. Each track includes
    required proof commands, rollback expectations, and approval boundaries.
    `phase29-audit.ts` compares `verificationMatrix` and
    `firstExecutableSlices` across repeat cycles so future language conversion
    work starts from measurable, testable slices instead of broad runtime
    rewrites.
111. Verify language proof command coverage. Done:
    `language-runtime-audit.ts` now resolves proof gates against package
    scripts and local script files, records `proofCommandCoverage`, and fails
    with `missingProofCommands` if a command-style proof target disappears.
    Manual proof items remain visible as manual evidence requirements. Phase 29
    repeat compares both fields so future conversion slices cannot keep stale
    verification commands in the plan.
112. Verify focused test coverage for first conversion slices. Done:
    `language-runtime-audit.ts` now records `focusedTestCoverage` for the first
    TypeScript helper, Web Worker, and SQL/DuckDB candidates. It verifies the
    candidate file plus focused test files exist, fails with
    `focusedTestCoverageGaps` when coverage disappears, and adds both fields to
    Phase 29 repeat drift checks.
113. Convert CSV import helper to TypeScript. Done:
    The CSV import implementation moved to
    `frontend/src/utils/csvImport.ts`, while `frontend/src/utils/csvImport.js`
    initially remained as a tiny compatibility wrapper for existing runtime and
    Node test imports, then was retired in Move 480 after callers moved to the
    TypeScript source. The obsolete `frontend/src/utils/pricing.d.ts`
    declaration shim was also removed because `pricing.ts` now owns the typed
    contract. `language-runtime-audit.ts` records
    `convertedTypeScriptSlices` and fails with
    `convertedTypeScriptCoverageGaps` if implementation proof disappears.
114. Convert formatter helper to TypeScript. Done:
    The shared formatter implementation moved to
    `frontend/src/utils/formatters.ts`, while `frontend/src/utils/formatters.js`
    remains as the compatibility wrapper for existing extensionless and legacy
    imports. Added `frontend/tests/formatters.test.ts` to the frontend utility
    suite. `language-runtime-audit.ts` now records the formatter conversion in
    `convertedTypeScriptSlices`, and the next TypeScript utility candidate is
    `frontend/src/utils/groupedRecords.ts`.
115. Convert grouped-record helper to TypeScript. Done:
    The shared time/alphabet grouping implementation moved to
    `frontend/src/utils/groupedRecords.ts`, while
    `frontend/src/utils/groupedRecords.ts` remains as the compatibility wrapper
    for existing component and test imports. Removed duplicated unused Khmer
    initial ordering from the grouping helper and documented the remaining
    `initials.ts` boundary with `frontend/src/utils/initials.ts`.
    `language-runtime-audit.ts` now records the grouped-record conversion in
    `convertedTypeScriptSlices`.
116. Convert initials helper to TypeScript. Done:
    The shared alphabet/Khmer initial classification implementation moved to
    `frontend/src/utils/initials.ts`, while products, POS, inventory, catalog,
    grouping helpers, and tests now import the TypeScript implementation
    directly.
    Added `frontend/tests/initials.test.ts` to cover Latin, Khmer, numeric,
    symbol, aggregation, product-derived options, and sort ordering behavior.
    `frontend/src/utils/initials.ts` now documents the direct TypeScript
    boundary used by converted callers.
117. Convert media upload helper to TypeScript. Done:
    The upload-state and media cache-busting helper moved to
    `frontend/src/utils/mediaUpload.ts`, while
    `frontend/src/utils/mediaUpload.js` initially remained as the compatibility
    wrapper for catalog, settings, product form, and focused test imports, then
    was retired after callers moved to the TypeScript source. Added the existing
    `frontend/tests/mediaUploadHelpers.test.ts` to the frontend utility suite
    and fixed cache-busting so explicit upload versions replace an existing `v`
    query parameter instead of appending a duplicate. Added
    `frontend/src/utils/publicAssetUrls.ts` directly after retiring the JS
    public-asset boundary declaration file.
118. Convert pricing helper to TypeScript. Done:
    The shared pricing and product-discount helper moved to
    `frontend/src/utils/pricing.ts`, while `frontend/src/utils/pricing.js`
    initially remained as the compatibility wrapper for app context, POS,
    products, catalog, inventory, CSV import, and tests, then was retired in
    Move 480 after callers moved to the TypeScript source. The obsolete
    `pricing.d.ts` shim was removed with the wrapper.
    Focused pricing, POS, portal catalog, and product write helper tests passed.
119. Convert product grouping helper to TypeScript. Done:
    The product family/grouping implementation moved to
    `frontend/src/utils/productGrouping.ts`, while
    `frontend/src/utils/productGrouping.ts` remains as the compatibility
    wrapper for Products, Inventory, POS, and existing tests. Added
    `frontend/src/utils/productGrouping.ts` for the stable `.mjs` boundary.
    Focused product grouping, POS core, and product page helper tests passed.
120. Convert product display helper to TypeScript. Done:
    The product row display, stock status, branch label, brand option, and
    lookup helpers moved to
    `frontend/src/components/products/helpers/productDisplayHelpers.ts`, while
    `productDisplayHelpers.mjs` remains as the compatibility wrapper for the
    Products page and focused tests. `frontend/tsconfig.json` now typechecks
    product helper `.ts` files so component-helper conversions are covered by
    the same frontend gate. Focused display helper, product page helper, and
    POS core tests passed.
121. Convert product filter/export helper to TypeScript. Done:
    The product search-term, branch quantity, page filter, and export-row
    helpers moved to
    `frontend/src/components/products/helpers/productFilterHelpers.ts`, while
    `productFilterHelpers.mjs` remains as the compatibility wrapper for the
    Products page and focused tests. Added
    `frontend/src/utils/groupedRecords.ts` so TypeScript component helpers
    can import the stable grouped-record wrapper without losing type coverage.
    Focused filter helper, grouped records, product search pagination, and
    product page helper tests passed.
122. Convert product menu helper to TypeScript. Done:
    The product export menu, supplier option, active filter count, and filter
    section helpers moved to
    `frontend/src/components/products/helpers/productMenuHelpers.ts`, while
    `productMenuHelpers.mjs` remains as the compatibility wrapper for the
    Products page and focused tests. The product search pagination source scan
    now reads the `.ts` implementation so wrapper-only files are not mistaken
    for the behavioral source. Focused menu helper, search pagination, and
    product page helper tests passed.
123. Convert product write helper to TypeScript. Done:
    The product write, restore, branch-stock adjustment, transfer-stock,
    bulk-update, and pricing payload helpers moved to
    `frontend/src/components/products/helpers/productWriteHelpers.ts`, while
    `productWriteHelpers.mjs` remains as the compatibility wrapper for the
    Products page and focused tests. Added
    `frontend/src/components/products/helpers/productGalleryHelpers.ts` so
    the typed write helper can keep using the stable gallery helper boundary.
    Focused write helper, action stability, search pagination, and strict
    frontend typecheck tests passed.
124. Convert product import planner to TypeScript. Done:
    The CSV product import normalization, identifier conflict analysis,
    same-name grouping, blocking barcode/encoding issue checks, and import
    summary planner moved to
    `frontend/src/components/products/import/productImportPlanner.ts`. The
    former product import planner wrapper has been retired; `BulkImportModal`,
    the product import worker, and focused tests now read the TypeScript planner
    directly. The frontend TypeScript project now includes product import `.ts`
    modules.
    Focused product import planner, CSV import, performance loading UX, action
    stability, and strict frontend typecheck tests passed.
125. Convert action guard utility to TypeScript. Done:
    The same-tick single-action, named-action, and keyed-action guard helpers
    moved to `frontend/src/utils/actionGuards.ts`, while `actionGuards.mjs`
    remains as the compatibility wrapper for all existing component imports
    and source-inspection tests. The typed helper preserves the existing
    optional blocked/value behavior while making mutable ref and keyed set
    contracts explicit. Focused action guard, action stability, performance
    loading UX, and strict frontend typecheck tests passed.
126. Convert color contrast utility to TypeScript. Done:
    The hex normalization, relative luminance, and contrasting text color helper
    moved to `frontend/src/utils/color.ts`, while `color.js` remains as the
    compatibility wrapper for Products and ProductDetailModal imports. The
    typed helper preserves invalid-color fallback behavior and keeps product
    chip/detail contrast calculation in one checked module. Focused product
    page helper, product search pagination, and strict frontend typecheck tests
    passed.
127. Convert dashboard date helper to TypeScript. Done:
    The local dashboard date preset helpers moved to
    `frontend/src/utils/dateHelpers.ts`, while `dateHelpers.js` remains as the
    compatibility wrapper for the utils barrel and Dashboard import. A focused
    date helper test now verifies local `YYYY-MM-DD` formatting and positive
    and negative day offsets before broad dashboard and build checks run.
128. Convert client device metadata helper to TypeScript. Done:
    The client device info and meta-header helpers moved to
    `frontend/src/utils/deviceInfo.ts`, while `deviceInfo.js` remains as the
    compatibility wrapper for API, auth, POS, Sales, and app context imports.
    The typed implementation uses `globalThis.navigator` so tests and
    non-browser callers can fall back safely, and focused device/header tests
    cover browser/OS detection and header names.
129. Convert report export package helper to TypeScript. Done:
    The report manifest and package file helpers moved to
    `frontend/src/utils/exportPackage.ts`, while `exportPackage.js` initially
    remained as the compatibility wrapper for Dashboard, Inventory, and tests,
    then was retired in Move 480 after callers moved to the TypeScript source.
    The obsolete `frontend/src/utils/csv.d.ts` shim was removed with the CSV
    wrapper, and focused export package tests cover manifest rows, CSV package
    ordering, and HTML report inclusion.
130. Convert history snapshot helper to TypeScript. Done:
    The shared action-history snapshot cloning, result-id extraction, and
    created-snapshot resolution helpers moved to
    `frontend/src/utils/historyHelpers.ts`, while `historyHelpers.mjs` remains
    as the compatibility wrapper for products, contacts, inventory, branches,
    users, files, custom tables, returns, and tests. Focused history helper and
    product history tests protect undo/redo snapshot resolution.
131. Convert shared utility barrel to TypeScript. Done:
    The shared utility re-export barrel moved to `frontend/src/utils/index.ts`,
    while `index.js` initially remained as the compatibility wrapper for any
    stable `utils` entrypoint imports, then was retired in Move 480 after
    callers moved to the TypeScript source. The barrel now re-exports formatter, CSV
    download, and local date helpers through a checked module boundary.
132. Convert permission parser utility to TypeScript. Done:
    The permission parsing helper moved to `frontend/src/utils/permissions.ts`,
    while `permissions.js` remains as the compatibility wrapper for AppContext
    and permission tests. The typed helper keeps permission payloads
    object-shaped, rejects malformed JSON and array payloads, and preserves the
    existing object identity path for already-normalized permission maps.
133. Convert product batch preview utility to TypeScript. Done:
    The shared product batch visibility and preview helper moved to
    `frontend/src/utils/productBatches.ts`, while `productBatches.mjs` remains
    as the compatibility wrapper for Inventory and Products surfaces. A focused
    test now covers all-branch totals, branch-specific stock totals, invalid
    batch payloads, and preview overflow counts.
134. Convert script typography helper to TypeScript. Done:
    The Khmer script detection and text-prop helper moved to
    `frontend/src/utils/scriptTypography.ts`, while `scriptTypography.js`
    remains as the compatibility wrapper for Catalog, POS, Products, and
    Inventory surfaces. Focused tests now cover Khmer-range detection,
    `khmer-text` class merging, non-Khmer passthrough, and `lang="km"` props.
135. Convert settings refresh routing helper to TypeScript. Done:
    The settings refresh channel mapper moved to
    `frontend/src/utils/settingsRefresh.ts`, while the retired `settingsRefresh.js`
    remains as the compatibility wrapper for API methods and tests. Added
    `frontend/src/utils/appRefresh.ts` as the app refresh utility
    boundary used by this typed module, and focused tests protect setting-rule
    routing plus app refresh channel normalization.
136. Convert product page config constants to TypeScript. Done:
    The product page timeout and month-option constants moved to
    `frontend/src/components/products/config/productPageConfig.ts`, while
    `productPageConfig.mjs` remains as the compatibility wrapper for the
    Products surface. Source-inspection tests now read the typed implementation
    so bounded product action and loading timeout contracts stay visible.
137. Convert product gallery helper to TypeScript. Done:
    The product gallery normalization and lightbox helper moved to
    `frontend/src/components/products/helpers/productGalleryHelpers.ts`, while
    `productGalleryHelpers.ts` remains as the compatibility wrapper for
    Products, product write helpers, and focused tests. The typed helper keeps
    unknown gallery inputs explicit, preserves public asset URL resolution, and
    keeps lightbox index clamping near the gallery state logic.
138. Convert product group view helper to TypeScript. Done:
    The product group price-label and summary-parts helper moved to
    `frontend/src/components/products/helpers/productGroupViewHelpers.ts`,
    while `productGroupViewHelpers.mjs` remains as the compatibility wrapper
    for Products and focused tests. The typed helper makes formatter,
    translator, and group summary inputs explicit and uses a type guard for
    filtered summary parts.
139. Convert product selection and pagination helper to TypeScript. Done:
    The product selection, pagination, product-id map, parent-id set, and
    letter-jump helper moved to
    `frontend/src/components/products/helpers/productSelectionHelpers.ts`,
    while `productSelectionHelpers.mjs` remains as the compatibility wrapper
    for Products and focused tests. The typed helper keeps legacy id coercion
    behavior intact while making pagination state and jump-section shapes
    explicit.
140. Convert product history helper to TypeScript. Done:
    The deleted-product restore ordering and request-id helper moved to
    `frontend/src/components/products/history/productHistoryHelpers.ts`,
    while `productHistoryHelpers.mjs` remains as the compatibility wrapper for
    Products and focused history tests. The typed helper keeps the parent-first
    restore contract explicit without changing the public import path.
141. Convert barcode image scanner helper to TypeScript. Done:
    The photo barcode scanner helper moved to
    `frontend/src/components/products/scanning/barcodeImageScanner.ts` and no
    `.mjs` scanner compatibility wrapper remains. The typed helper keeps
    the native `BarcodeDetector` fast path, zxing fallback, image loader, and
    injected test seams explicit.
142. Convert barcode scanner presentation state helper to TypeScript. Done:
    The scanner presentation-state helper moved to
    `frontend/src/components/products/scanning/barcodeScannerState.ts` and no
    `.mjs` scanner compatibility wrapper remains. The typed helper
    keeps camera permission, scanner status, labels, and state-kind outputs
    explicit.
143. Convert concurrent bulk task helper to TypeScript. Done:
    The shared concurrent task runner moved to `frontend/src/utils/bulkOps.ts`,
    while `bulkOps.mjs` remains as the compatibility wrapper for product,
    inventory, branch, contact, and sales bulk-action surfaces. Added focused
    tests for concurrency bounds, ordered results, per-item failures, and
    non-array inputs.
144. Convert app shell path/navigation helper to TypeScript. Done:
    The route classification, mounted-page limit, warmup, and notification
    helper moved to `frontend/src/app/appShellUtils.ts`. The temporary
    app-shell compatibility wrapper has been retired after `App.tsx`,
    `AppContext.tsx`, startup routing, and focused app-shell tests moved to the
    TypeScript source. The compiler now includes `src/app/**/*.ts`.
145. Convert portal catalog display helper to TypeScript. Done:
    The customer portal grid, branch matching, promotion display, price
    presentation, and highlight-badge helper moved to
    `frontend/src/components/catalog/portalCatalogDisplay.ts`, while
    `portalCatalogDisplay.mjs` remains as the compatibility wrapper for catalog
    admin/public surfaces and focused portal tests. Tailwind content scanning
    now includes `ts` so helper-owned grid classes remain generated.
146. Convert portal content i18n helper to TypeScript. Done:
    The portal translation normalization, config localization, FAQ vocabulary
    fallback, protected public-copy terms, and product localization helper moved
    to `frontend/src/components/catalog/portalContentI18n.ts`, while
    `portalContentI18n.mjs` remains as the compatibility wrapper for catalog
    surfaces and focused portal i18n tests. Added
    `portalLanguagePacks.ts` so the typed helper can import the existing
    language-pack module without forcing a second large conversion in the same
    move.
147. Convert portal editor utility helper to TypeScript. Done:
    The about-block, promotion-item, list-reorder, and Google Maps embed
    normalization helper moved to
    `frontend/src/components/catalog/portalEditorUtils.ts`, while
    `portalEditorUtils.mjs` remains as the compatibility wrapper for
    `CatalogPage.tsx` and focused portal editor tests.
148. Convert portal language pack helper to TypeScript. Done:
    The first-party portal language pack and lookup helper moved to
    `frontend/src/components/catalog/portalLanguagePacks.ts`, while
    `portalLanguagePacks.ts` remains as the compatibility wrapper for
    `CatalogPage.tsx`, portal i18n helpers, and focused portal vocabulary
    tests. `portalLanguagePacks.ts` remains as the small typed wrapper
    declaration needed for TypeScript imports through the stable `.mjs`
    boundary.
149. Convert contact option helper to TypeScript. Done:
    The customer, supplier, and delivery contact-option normalization helper
    moved to `frontend/src/components/contacts/contactOptionUtils.ts`, while
    `contactOptionUtils.js` initially remained as the compatibility wrapper for
    contact forms and focused pricing/contact tests, then was retired in Move
    479 after callers moved to the TypeScript source. The typed helper now
    normalizes unknown import-row and stored JSON values at the boundary.
150. Convert inventory movement group helper to TypeScript. Done:
    The inventory movement timestamp, grouping, totals, pagination, and
    search-haystack helper moved to
    `frontend/src/components/inventory/movementGroups.ts`, while
    `movementGroups.js` initially remained as the compatibility wrapper for
    `Inventory.tsx` and focused movement-group tests, then was retired in Move
    479 after callers moved to the TypeScript source. The existing
    `inventoryMovementGroups.test.ts` is now part of `test:utils` so movement
    grouping stays inside the regular Phase 29 frontend gate.
151. Convert POS core helper to TypeScript. Done:
    The POS product grouping, variant-choice, cart price, cart line identity,
    and matching helper moved to `frontend/src/components/pos/posCore.ts`,
    while `posCore.mjs` remains as the compatibility wrapper for `POS.tsx` and
    focused POS core tests. The typed helper keeps pricing converters,
    promotion metadata, and branch-aware cart-line matching explicit.
    Verification passed for typecheck, focused POS core tests, frontend
    utility suite, frontend build, language/runtime audit, organization audit,
    regenerated references, and Phase 29 repeat. The earlier public Cloudflare
    portal CSP follow-up was superseded by the 2026-05-20 live check, which
    passed with customer content rendered, 40 products loaded, portal APIs
    returning 200, enforced CSP present, no report-only CSP header, and no
    relevant console or page errors.
152. Convert product import worker entrypoint to TypeScript. Done:
    The browser worker logic moved to
    `frontend/src/components/products/import/productImportWorker.ts`, while
    the former product import worker wrapper remained as the stable Vite module-worker wrapper
    until the worker boundary moved fully to TypeScript; the current
    `BulkImportModal.tsx` caller reads `productImportWorker.ts` through the
    typed worker URL. The typed worker boundary now narrows
    incoming worker messages, posts explicit progress/result/error message
    shapes, and keeps the existing import-analysis fallback path unchanged.
153. Convert receipt settings constants to TypeScript. Done:
    The receipt default template and translated field metadata moved to
    `frontend/src/components/receipt-settings/constants.ts`, while
    `constants.js` initially remained as the compatibility wrapper for receipt
    settings, receipt template helpers, and focused receipt tests, then was
    retired in Move 478 after callers moved to the TypeScript source. The
    typed boundary now makes receipt template keys and field item shapes
    explicit.
154. Convert customer membership number helper to TypeScript. Done:
    The customer membership generator moved to
    `frontend/src/components/contacts/customerMembershipNumber.ts`, while
    `customerMembershipNumber.js` initially remained as the compatibility
    wrapper for contacts surfaces and tests, then was retired in Move 479 after
    callers moved to the TypeScript source. The typed boundary now names the
    `LCMN` prefix and generated entropy length explicitly, keeping the existing
    membership-number format stable.
155. Convert dashboard chart barrel to TypeScript. Done:
    The chart export barrel moved to
    `frontend/src/components/dashboard/charts/index.ts`, while `index.js`
    initially remained as the compatibility wrapper for dashboard and
    report-rendering imports, then was retired in Move 479 after callers moved
    to the TypeScript source. The temporary JSX module declaration shim was
    retired once active chart/component imports moved to typed sources and no
    `.jsx` imports remained.
156. Convert receipt template helper to TypeScript. Done:
    The receipt template parser and serializer moved to
    `frontend/src/components/receipt-settings/template.ts`, while
    `template.js` initially remained as the compatibility wrapper for receipt
    settings imports and focused receipt tests, then was retired in Move 478
    after callers moved to the TypeScript source. The typed boundary now treats
    incoming persisted settings as `unknown`, narrows object payloads, and keeps
    corrupt JSON recovery on the default-template path.
157. Convert shared navigation configuration to TypeScript. Done:
    The app navigation item registry, mobile pinned defaults, stored-setting
    parser, and saved-order helper moved to
    `frontend/src/components/shared/navigationConfig.ts`, while
    `navigationConfig.js` initially remained as the stable compatibility
    wrapper for sidebar and settings imports, then was retired in Move 478
    after callers moved to the TypeScript source. The typed boundary now names
    the known permission keys and keeps malformed persisted navigation settings
    on their existing fallback path.
158. Convert utils-settings barrel to TypeScript. Done:
    The admin utility component barrel moved to
    `frontend/src/components/utils-settings/index.ts`, while `index.js`
    initially remained as the stable compatibility wrapper for any importers
    that use the folder public boundary, then was retired in Move 479 after
    callers moved to the TypeScript source. The temporary JSX module
    declaration shim was retired once the utility settings barrel and callers
    used typed source imports only.
159. Convert settings conflict helper to TypeScript. Done:
    The settings stale-write conflict mapper moved to
    `frontend/src/components/utils-settings/settingsConflict.ts`, while
    `settingsConflict.js` initially remained as the stable compatibility
    wrapper for Settings page imports and focused conflict tests, then was
    retired in Move 479 after callers moved to the TypeScript source. The typed
    boundary now accepts `unknown` settings payloads, normalizes object inputs
    once per diff, and keeps the existing JSON comparison behavior for nested
    values.
160. Convert storage policy helper to TypeScript. Done:
    The local mirror and cooldown policy moved to
    `frontend/src/platform/storage/storagePolicy.ts`, while
    `storagePolicy.mjs` remains as the stable compatibility wrapper for API
    methods and focused storage-policy tests. The typed boundary now accepts
    unknown persisted values, preserves live-server sensitive table protection,
    and keeps numeric cooldown parsing on the existing strongest-value path.
161. Move contact import row counting into a Web Worker. Done:
    `frontend/src/components/contacts/contactImportWorker.ts` now handles CSV
    row-count analysis for the contact import modal, with
    `contactImportWorker.mjs` as the Vite worker wrapper and
    `frontend/src/utils/csvRowCounter.ts` as the synchronous fallback and
    correctness oracle.
    The modal keeps the existing background import job upload path, adds a
    bounded worker timeout, and ignores stale worker responses when staff pick a
    newer CSV before an older analysis finishes.
162. Move inventory import row counting into a Web Worker. Done:
    `frontend/src/components/inventory/inventoryImportWorker.ts` now handles
    inventory CSV row-count analysis, with `inventoryImportWorker.mjs` as the
    Vite worker wrapper. Contact and inventory import now share
    `frontend/src/utils/csvRowCounter.ts`, so quoted multiline CSV records are
    counted consistently, and InventoryImportModal keeps a synchronous fallback,
    row-check timeout, stale-result guard, and the existing server-side
    background import job contract.
163. Harden the product import worker fallback path. Done:
    `frontend/src/components/products/import/BulkImportModal.tsx` now treats
    product CSV analysis as a bounded worker-first path with a synchronous
    parser fallback for missing Worker support, worker startup failure,
    postMessage failure, worker error messages, and 60 second timeouts.
    `productImportWorker.ts` remains the worker boundary and
    `productImportPlanner.ts` remains the correctness oracle, so large product
    imports can use the worker without making worker availability a single
    point of failure. The language/runtime audit now records this as a
    completed Web Worker slice and moves future worker candidate ranking past
    the product import cluster.
164. Move sales import row counting into a Web Worker. Done:
    `frontend/src/components/sales/salesImportWorker.ts` now handles sales CSV
    row-count analysis, with `salesImportWorker.mjs` as the Vite worker
    wrapper. `SalesImportModal.tsx` now uses the shared
    `frontend/src/utils/csvRowCounter.ts` parser, so quoted multiline CSV
    records are counted consistently across sales, inventory, and contacts.
    The modal keeps the server-side background import job contract while
    adding a 5 second row-count timeout, synchronous fallback, stale-result
    guard, and disabled import state while row checking is in flight.
165. Reject the background import tracker as a Web Worker candidate. Done:
    Phase 29 inspection found that
    `frontend/src/components/shared/BackgroundImportTracker.tsx` is API
    polling and bounded UI orchestration, not file parsing, media decoding, or
    a CPU-heavy browser loop. `language-runtime-audit.ts` now records it in
    `rejectedWebWorkerCandidates`, removes it from future worker rankings, and
    promotes the next measurable candidates: `frontend/src/utils/csv.ts` for
    browser export/ZIP work and `backend/src/services/backupPackages.ts` for
    SQL/DuckDB data-path optimization.
166. Move CSV/ZIP package building into a Web Worker. Done:
    `frontend/src/utils/csvExportWorker.ts` now builds export ZIP blobs off the
    UI thread, with `csvExportWorker.mjs` as the Vite module-worker wrapper.
    `frontend/src/utils/csv.ts` keeps `buildZip()` as the synchronous fallback
    and correctness oracle, adds `buildZipInWorker()` plus
    `downloadZipFilesAsync()`, and normalizes both `{ name, content }` and
    `{ filename, rows }` descriptors so contacts all-export produces real CSV
    files inside the ZIP. Dashboard, Inventory, and Contacts package exports
    now await the async worker-backed path.
167. Optimize backend backup table streaming. Done:
    `backend/src/services/backupPackages.ts` now pages large backup tables with
    keyset reads (`WHERE id > ? ORDER BY id ASC LIMIT ?`) after the first page
    while keeping the existing `LIMIT ? OFFSET ?` fallback for tables or
    compatibility paths that cannot use `id`. The package format, checksum
    streaming, retention behavior, and remote mirror path stay unchanged.
    `frontend/src/utils/csvImport.ts` is also recorded as an intentional shared
    parser/fallback rather than another worker target because product, contact,
    inventory, and sales import surfaces already run their heavy CSV work
    through focused worker slices.
168. Optimize product import lookup loops. Done:
    `backend/src/services/importJobs.ts` now keeps a per-job product-name cache
    for product import apply work and a supplier lookup cache inside the product
    import context. Repeated same-name rows, variants, and supplier values avoid
    repeated database lookups, while `rememberProductForImport()` keeps the
    in-memory product cache current after new products or updates. The scanner
    photo/camera files are recorded as rejected standalone Worker targets
    because their work is tied to `Image`, `BarcodeDetector`, `getUserMedia`,
    video refs, zxing browser controls, and React permission UI.
169. Clear remaining false-positive Web Worker candidates. Done:
    `frontend/src/components/shared/ImageGalleryLightbox.tsx` is recorded as a
    React presentation component, not an image-processing worker target.
    `frontend/src/utils/importJobRefresh.js` is recorded as a small main-thread
    event dispatcher because it maps import completion statuses to
    `sync:update` `CustomEvent`s on `window`. This keeps the worker backlog
    focused on real transferable CPU/file/media work.
170. Optimize schema-audit primary-key parsing. Done:
    `ops/scripts/backend/schema-audit.ts` now builds one ALTER TABLE
    primary-key map before parsing CREATE TABLE bodies, then uses that map as
    the fallback when a table has no inline primary key. This removes repeated
    whole-schema regex scans from the generated schema audit while preserving
    the same report fields, JSON summary contract, and roadmap verification
    path.
171. Filter import-job lists in the data path. Done:
    `backend/src/routes/importJobs.ts` now derives permitted import types from
    the current user and passes them into `listImportJobs()`. The service keeps
    its old unfiltered default for internal callers, but route reads now add a
    SQL `type IN (...)` clause before job decoration, so lower-permission users
    do not make the backend fetch and decorate job rows that will be discarded.
172. Consolidate backup reliability verification loops. Done:
    `ops/scripts/verification/verify-backup-reliability.ts` now loads its
    source files through one manifest and runs grouped required/forbidden text
    checks through `checkNeedles()`. The guard strings for streaming backup,
    resumable Drive sync, cancellable system jobs, backup UI actions, offline
    pause behavior, and automation wiring remain the same, but future checks can
    be added without another long chain of repeated calls.
173. Gate canonical schema rewires out of the language/runtime queue. Done:
    `backend/src/db/postgresSchema.sql` is now recorded as a rejected data-path
    conversion candidate in `language-runtime-audit.ts`. The file is the
    canonical schema contract, not an executable hot path, so index, primary-key,
    JSONB, and foreign-key work must continue through
    `ops/docs/SCHEMA-RELATIONSHIPS.md`, schema-audit proof, backup/restore
    rehearsal, orphan checks, and rollback SQL before any DDL changes are made.
174. Optimize RFID stock-apply route statement reuse. Done:
    `backend/src/routes/inventory.ts` now prepares the RFID branch lookup,
    product lookup, branch-stock writes, movement insert, product RFID summary
    update, and session-finalization statement once per apply request instead
    of preparing statements inside each confirmed product row. This keeps the
    route in Node.js/SQLite because it is request orchestration with audit and
    stock recalculation side effects, but removes avoidable per-row statement
    setup. `backend/test/rfidRoutes.test.ts` records the source-level guard,
    and `language-runtime-audit.ts` records the completed SQL/data-path slice
    with rollback and proof commands.
175. Consolidate portal catalog product payload assembly. Done:
    `backend/src/routes/portal.ts` now uses `getPortalProductAssets()` and
    `buildPortalProductPayload()` for both the full customer-safe catalog and
    paged catalog search. Image gallery loading, branch-stock grouping, fallback
    image selection, and highlight badge decoration now have one route-local
    implementation instead of two parallel blocks. This keeps the route in
    Node.js while reducing duplicate query/materialization pathways, with
    `backend/test/portalInventoryRegression.test.ts` guarding the shared
    helper contract.
176. Optimize image-only product bulk import matching. Done:
    `backend/src/routes/products.ts` now builds a `productsByImageBaseName` map
    once from active products before processing uploaded image filenames. The
    image-only import path now does one normalized-name lookup per image instead
    of scanning every active product for every uploaded file. The behavior stays
    name-based and route-local, while `backend/test/productSearchPagination.test.ts`
    guards the map-backed path and absence of the repeated `allProducts.find`
    loop.
177. Reuse sale creation movement statements. Done:
    `backend/src/routes/sales.ts` now prepares the sale inventory-movement
    insert and optional imported timestamp update once per sale creation
    transaction instead of rebuilding those statements for each sold item. This
    keeps the existing Node.js batch allocation and audit flow while reducing
    per-item SQL statement setup. `backend/test/productBatchHierarchy.test.ts`
    guards the request-scoped movement statements.
178. Reuse system settings delete statement. Done:
    `backend/src/routes/system/index.ts` now prepares the settings delete
    statement once beside the settings upsert statement inside
    `writeSystemSettings()`. Removing null-valued settings no longer rebuilds
    the same `DELETE FROM settings WHERE key = ?` statement for every entry,
    while preserving the existing transaction and settings behavior.
    `backend/test/routeContracts.test.ts` guards the source shape.
179. Close the self-referential language audit candidate. Done:
    `ops/scripts/architecture/language-runtime-audit.ts` now records itself as
    a rejected SQL/DuckDB conversion candidate. After the backend route and
    service data-path slices were handled, the remaining queue item was the
    meta-audit report generator ranking its own proof strings and completed
    slice metadata. Keeping it in Node.js preserves the Phase 29 bootstrap path
    and removes a noisy false-positive candidate from future sweeps.
180. Delete the generated root `output` folder. Done:
    Phase 29 generated-bulk audit listed `output` as ignored, generated, and
    safe to clean. After exact-path reference checks showed only ignore,
    cleanup, and verification coverage references, the folder was deleted from
    `C:\Users\user\Downloads\business-os\output`, freeing 870,964 bytes.
    `generated-bulk-audit.ts` was rerun and now reports `output` as absent.
181. Run local storage retention after cleanup. Done:
    `npm.cmd --prefix ops run prune-storage -- --skip-remote` pruned old local
    Phase 8.4 report folders while preserving business data, uploads, secrets,
    newest backup packages, Docker volumes, and remote R2 state. The run removed
    four old report directories and freed 817,705 bytes.
182. Speed up generated-bulk measurement. Done:
    `ops/scripts/architecture/generated-bulk-audit.ts` now uses Node's
    recursive directory read as the fast path and falls back to the previous
    stack walker if recursive reads fail. The generated-bulk audit kept the
    same byte/file counts while reducing repeated Phase 29 measurement overhead
    for large generated folders such as `frontend/node_modules`,
    `backend/node_modules`, `frontend/dist`, and `ops/runtime`.
183. Parallelize safe Phase 29 child checks. Done:
    `ops/scripts/architecture/phase29-audit.ts` now runs independent
    reference-producing checks in parallel, then runs `organization-audit.ts`
    afterward so it scans a coherent docs/reference tree. The audit summary
    records `executionMode: parallel-reference-writers-then-organization`, and
    `backend/test/fullAutomation.test.ts` guards the grouped execution path.
184. Preserve performance scan status notes. Done:
    `ops/scripts/docs/performance-scan.ts` now preserves a bounded Phase 29
    manual-notes block when regenerating `ops/docs/reference/PERFORMANCE-SCAN.md`.
    Repeat audit runs can refresh ranked size/chunk metrics without erasing the
    latest performance, cleanup, and orchestration move trail. The JSON summary
    records `manualNotesPreserved` and `manualNotesLines`, and
    `backend/test/fullAutomation.test.ts` guards the preservation path.
185. Compare preserved notes in Phase 29 repeat consistency. Done:
    `ops/scripts/architecture/phase29-audit.ts` now includes
    `manualNotesPreserved` and `manualNotesLines` in the repeated
    `Performance/code-flow scan` consistency table. If future regeneration
    drops or truncates the preserved status block, the three-pass audit reports
    drift instead of silently accepting the loss. `backend/test/fullAutomation.test.ts`
    guards the new consistency fields.
186. Parallelize performance scan file reads. Done:
    `ops/scripts/docs/performance-scan.ts` now reads source files with a bounded
    parallel worker pool and stats built chunks with a separate bounded pool
    instead of synchronously reading each file in sequence. The generated summary
    records `sourceReadMode`, `sourceReadConcurrency`, and
    `chunkStatConcurrency`; `phase29-audit.ts` compares those fields across
    repeat cycles so the faster scanner path remains visible and guarded.
187. Share bounded worker loop helper. Done:
    `ops/scripts/lib/fs-utils.ts` now exports the shared `mapLimit()` worker-pool
    helper used by `performance-scan.ts`, `organization-audit.ts`, and
    `generated-bulk-audit.ts`. This removes three local copies of the same
    bounded async loop while preserving each audit's existing concurrency
    constants and generated summaries. `backend/test/fullAutomation.test.ts`
    guards that the architecture audits import the shared helper instead of
    reintroducing local copies.
188. Share architecture path normalization. Done:
    `generated-bulk-audit.ts`, `organization-audit.ts`,
    `phase29-audit.ts`, and `language-runtime-audit.ts` now use
    `toPosix` from `ops/scripts/lib/fs-utils.ts` as their shared
    `normalizePath` implementation. This removes repeated slash-normalization
    helpers across architecture audits while keeping generated report paths and
    repeat-consistency fields stable. `backend/test/fullAutomation.test.ts`
    guards the shared normalizer import and rejects local `normalizePath`
    redefinitions in those audit scripts.
189. Bound language-runtime audit source reads. Done:
    `ops/scripts/architecture/language-runtime-audit.ts` now uses the shared
    `mapLimit()` helper to read scanned source files with a bounded worker pool
    instead of unbounded `Promise.all(files.map(...))`. The summary records
    `fileReadMode: bounded-parallel` and `fileReadConcurrency: 24`, and
    `phase29-audit.ts` compares those fields across repeat cycles so the
    resource-friendly language/runtime sweep stays guarded.
190. Share audit existence checks. Done:
    `ops/scripts/lib/fs-utils.ts` now exports the shared async `pathExists()`
    helper, and `organization-audit.ts`, `language-runtime-audit.ts`, and
    `phase29-audit.ts` reuse it for path checks instead of carrying local
    `fs.access()` wrappers. This is a Phase 29 cleanup/optimization move: it
    removes duplicated audit helper code without deleting source files,
    changing runtime behavior, or touching business data.
191. Bound generated-bulk target measurement. Done:
    `ops/scripts/architecture/generated-bulk-audit.ts` now measures the
    configured generated/runtime cleanup targets with the shared bounded
    `mapLimit()` helper and `TARGET_MEASURE_CONCURRENCY: 4` instead of an
    unbounded `Promise.all(TARGETS.map(...))` pass. The generated summary now
    records `targetMeasureConcurrency`, and `phase29-audit.ts` compares it
    across repeat cycles so cleanup inventory scans stay resource-friendly.
192. Bound organization audit root discovery. Done:
    `ops/scripts/architecture/organization-audit.ts` now uses shared bounded
    `mapLimit()` workers for both `SCAN_ROOTS` directory walking and
    `SCAN_FILES` root-config existence checks. The summary records
    `rootWalkMode: bounded-parallel` and `rootWalkConcurrency: 3`, and
    `phase29-audit.ts` compares those fields across repeat cycles so the
    file/folder inventory sweep stays stable without launching every root scan
    at once.
193. Bound language/runtime proof sweeps. Done:
    `ops/scripts/architecture/language-runtime-audit.ts` now bounds scan-root
    discovery and proof-matrix existence checks with shared `mapLimit()`
    workers. The audit no longer launches unbounded `Promise.all(...map(...))`
    passes over source roots, focused test coverage, converted TypeScript
    slices, completed Worker slices, or completed data-path slices. The summary
    records `rootWalkMode`, `rootWalkConcurrency`, `matrixCheckMode`, and
    `matrixCheckConcurrency`, and `phase29-audit.ts` compares them across
    repeat cycles.
194. Bound Phase 29 child-check fan-out. Done:
    `ops/scripts/architecture/phase29-audit.ts` now runs independent
    reference-producing child checks with shared bounded `mapLimit()` workers
    and `PARALLEL_CHECK_CONCURRENCY: 3` instead of
    `Promise.all(checks.map(...))`. The organization audit still runs after the
    reference writers so it scans a coherent docs/reference tree, while the
    generated summary records
    `executionMode: bounded-parallel-reference-writers-then-organization` and
    `parallelCheckConcurrency: 3`.
195. Share report-format helpers. Done:
    `ops/scripts/lib/report-utils.ts` now owns the architecture audit Markdown
    table helper plus Phase 29's long-value summary, stable digest, and output
    tail helpers. `generated-bulk-audit.ts`, `organization-audit.ts`,
    `language-runtime-audit.ts`, and `phase29-audit.ts` import the shared
    helper instead of carrying local `markdownTable()` implementations, reducing
    duplicate report code while keeping generated references stable.
196. Share byte formatting. Done:
    `ops/scripts/lib/report-utils.ts` now owns `formatBytes()`, and
    `generated-bulk-audit.ts` imports it instead of carrying a local byte-size
    formatter. This keeps generated-bulk cleanup-size reporting in the shared
    report utility layer and removes another small duplicate report helper.
197. Share async read helpers. Done:
    `ops/scripts/lib/fs-utils.ts` now exports `readUtf8Async()` and
    `readJsonAsync()`, and `generated-bulk-audit.ts` uses them for `.gitignore`,
    `.dockerignore`, `clean-generated.ps1`, and policy JSON reads instead of
    local `readText()` / `readJsonFile()` wrappers. This keeps generated-bulk
    audit file reads aligned with the shared filesystem utility layer.
198. Share verification read helpers. Done:
    `ops/scripts/verification/verify-hardening-policy.ts` now reuses
    `readJson()` and `readUtf8()` from `ops/scripts/lib/fs-utils.ts` for policy,
    service-worker, full-automation, and local import reads. This reduces
    duplicate verification script helpers while preserving the public
    full-automation entrypoint. The hardening policy now also references the
    grouped Cloudflare verifier paths under `ops/scripts/runtime/cloudflare/`
    and accepts non-ignored pending source files during move verification.
199. Share runtime report byte formatting. Done:
    `ops/scripts/runtime/audits/audit-report-html.ts` now reuses
    `formatBytes()` from `ops/scripts/lib/report-utils.ts` instead of carrying
    a local byte formatter. This keeps runtime audit report output aligned with
    the Phase 29 report utility layer.
200. Share runtime dependency JSON reads. Done:
    `ops/scripts/verification/verify-runtime-deps.ts` now reuses `readJson()`
    from `ops/scripts/lib/fs-utils.ts` for package manifest and lockfile reads
    instead of carrying a local JSON reader. The public `run/verify-local.bat`
    verification path remains unchanged.
201. Share frontend UI verifier reads. Done:
    `ops/scripts/frontend/verify-ui.ts` now reuses `readJson()` and
    `readUtf8()` from `ops/scripts/lib/fs-utils.ts` for translation, CSS,
    component, package, and verification-batch reads instead of local reader
    wrappers. The frontend `verify:ui` script remains unchanged.
202. Share language audit JSON reads. Done:
    `ops/scripts/architecture/language-runtime-audit.ts` now reuses
    `readJsonAsync()` from `ops/scripts/lib/fs-utils.ts` for package manifest
    reads instead of carrying a local async JSON helper. This keeps the Phase 29
    language/runtime sweep aligned with the shared filesystem utility layer.
203. Share Cloudflare automation file reads. Done:
    `ops/scripts/runtime/cloudflare/verify-cloudflare-automation.ts` now
    reuses `readJson()` and `readUtf8()` from `ops/scripts/lib/fs-utils.ts` for
    policy, token, and allowed-email file reads. Network request behavior stays
    owned by the Cloudflare verifier.
204. Share backup reliability source reads. Done:
    `ops/scripts/verification/verify-backup-reliability.ts` now reuses
    `readUtf8()` from `ops/scripts/lib/fs-utils.ts` for root-relative source
    manifest reads. The backup, Drive, UI, offline, and automation guard
    strings remain unchanged.
205. Share Docker release guardrail reads. Done:
    `ops/scripts/verification/verify-docker-release.ts` now reuses `readUtf8()`
    from `ops/scripts/lib/fs-utils.ts` for tolerant source/config reads. The
    Docker release guardrail JSON and release boundary checks remain unchanged.
206. Share secret hygiene source reads. Done:
    `ops/scripts/verification/verify-secret-hygiene.ts` now reuses `readUtf8()`
    from `ops/scripts/lib/fs-utils.ts` after its existing tracked-file size
    guard. Secret detection behavior remains unchanged.
207. Share scale-service verifier reads and complete the first Phase 29 baseline. Done:
    `ops/scripts/verification/verify-scale-services.ts` now reuses `readUtf8()`
    from `ops/scripts/lib/fs-utils.ts` for scale Compose reads after the
    existing file-existence check. Docker discovery, secret/license ignore
    checks, and optional service reachability behavior remain unchanged. The
    first Phase 29 baseline is complete; Phase 29 remains active as the
    recurring guardrail for future cleanup, folder, schema, and
    language/runtime rewires, which must cite generated Phase 29 references and
    pass the relevant gates below.
208. Fill final frontend i18n verification gaps. Done:
    `frontend/src/lang/en.json` and `frontend/src/lang/km.json` now define the
    remaining dashboard, contacts, import tracker, and settings labels that
    were still falling back at runtime. This keeps the final verification pass
    clean without changing component structure.
209. Fix scale-runtime R2 wiring and live verification. Done:
    `ops/docker/compose.scale.yml` now receives R2 endpoint, region, bucket,
    access key, secret key, public base URL, Cloudflare account id, and
    Cloudflare API token from the process environment instead of hardcoding the
    app runtime to MinIO while declaring `OBJECT_STORAGE_DRIVER=r2`.
    `ops/scripts/powershell/start-runtime.ps1` bridges those values from the
    ignored Docker release env into the scale Compose run so secrets are not
    stored in `docker-scale.env`. `verify-r2-object-store.ts` now verifies the
    backend's Cloudflare API fallback when direct S3-compatible credentials are
    unauthorized.
210. Reject report utility false-positive from language conversion queue. Done:
    `ops/scripts/architecture/language-runtime-audit.ts` now documents
    `ops/scripts/lib/report-utils.ts` as a shared Node.js reporting helper, not
    a SQL/DuckDB data-path conversion candidate. The Phase 29 language/runtime
    report now has zero remaining conversion candidates, and the three-cycle
    Phase 29 repeat audit passed after regenerating the references.
211. Reconcile roadmap status after R2 prune and first Phase 29 baseline. Done:
    `ops/docs/OPTIMIZATION-ROADMAP.md` now keeps Phase 28 active for follow-on
    storage/access hardening, marks the first Phase 29 baseline complete while
    keeping Phase 29 active as the continuing guardrail, and replaces the stale
    R2 `--skip-remote` follow-up note with the later prune result: remote prune
    executed under the newest package policy and found no remote backup objects
    to delete.
212. Reconcile cleanup reference with latest public/R2 verification. Done:
    `ops/docs/reference/CLEANUP-SWEEP.md` now points at the later 2026-05-20
    public portal pass instead of the old Page Shield/CSP blocker, and records
    that the R2 remote prune path ran with zero remote backup objects to delete.
    The old Move 151 note was also clarified so future sessions do not reopen a
    source-code follow-up that the later Cloudflare live check closed.
213. Refresh preserved performance-scan move trail. Done:
    `ops/docs/reference/PERFORMANCE-SCAN.md` now carries Moves 208-212 in its
    preserved manual notes block and updates the Move 181 R2 wording to point
    at the later Phase 28 prune pass. This keeps future performance scans from
    preserving stale status while still retaining the long optimization trail
    across regeneration.
214. Refresh whole-codebase generated-bulk checkpoint. Done:
    `ops/docs/reference/WHOLE-CODEBASE-SWEEP.md` now uses the latest
    2026-05-20 generated-bulk audit measurements instead of the older
    2026-05-19 cleanup-slice checkpoint. This keeps the whole-codebase map in
    sync with the machine-readable generated-bulk baseline used by Phase 29
    repeat audits.
215. Strengthen runtime hash verification in the run-file path. Done:
    `ops/scripts/verification/verify-runtime-deps.ts`, called by
    `run/verify-local.bat`, now verifies the stale-bundle protection chain in
    addition to package/config dependency manifests: Vite build-manifest
    emission, service-worker build-hash cache keys, frontend runtime mismatch
    dispatch, AppContext listener cleanup, backend `/api/runtime/version`
    wiring, backend frontend build metadata reads, and frontend performance
    build-metadata checks. Existing `frontend/dist/business-os-build.json`
    files are also validated for concrete `revision`, `hash`, and `builtAt`
    fields while still allowing the verifier to run before a fresh frontend
    build.
216. Add post-start diagnostics checklist artifacts. Done:
    `ops/scripts/runtime/smoke/post-start-diagnostics.ts` now checks local
    `/health`, `/api/runtime/version`, `/business-os-build.json`, and `/sw.js`
    after startup and records optional public/admin health in a JSON checklist.
    `ops/scripts/powershell/start-runtime.ps1` writes the report under
    `ops/runtime/logs/` after the route-contract smoke, and
    `ops/scripts/powershell/docker-release.ps1` writes the same checklist in
    the Docker release runtime folder during release health checks. The Docker
    release verifier now requires the script and wiring so the checklist cannot
    quietly drop out of the run/release path.
217. Add post-start diagnostics to local verification. Done:
    `run/verify-local.bat` now runs
    `ops/scripts/runtime/smoke/post-start-diagnostics.ts` after the optional
    route-contract smoke and writes
    `ops/runtime/reports/verify-local-post-start-diagnostics.json` when a local
    app is available. The diagnostics script now has `--skip-if-unavailable`,
    matching the route-contract behavior so cold-workspace verification still
    passes while leaving a structured skipped report. The Docker release
    verifier now guards this local verifier wiring too.
218. Add machine-readable post-start diagnostics coverage. Done:
    `ops/scripts/verification/verify-docker-release.ts` now writes
    `postStartDiagnosticsCoverage` into
    `ops/docs/reference/DOCKER-RELEASE-GUARDRAIL.json`, covering script
    presence, Docker release/start-runtime/local verifier wiring,
    skip-if-unavailable support, and the required health, runtime-version,
    build-manifest, and service-worker probes. `phase29-audit.ts` now compares
    that coverage object across repeat cycles so diagnostics drift fails the
    whole-codebase guardrail.
219. Add machine-readable runtime dependency guardrail. Done:
    `ops/scripts/verification/verify-runtime-deps.ts` now writes
    `ops/docs/reference/RUNTIME-DEPS-GUARDRAIL.json` with package version
    parity, required scanner dependency coverage, forbidden legacy config
    coverage, and `runtimeVersionGuardCoverage` for stale-bundle protection.
    `phase29-audit.ts` now runs that verifier as the seventh Phase 29 check
    and compares package, dependency, config, and runtime-version guard fields
    across repeat cycles.
220. Add machine-readable local verification coverage. Done:
    `ops/scripts/verification/verify-runtime-deps.ts` now also reads
    `run/verify-local.bat` and writes a `localVerificationCoverage` object into
    `ops/docs/reference/RUNTIME-DEPS-GUARDRAIL.json`. The coverage object guards
    the runtime dependency, Docker release, secret hygiene, Docker Doctor,
    route-contract, post-start diagnostics, frontend install/build/test/i18n/UI/
    performance, backend install/test, and backend integrity lanes. Phase 29
    repeat consistency now compares that object so local verification drift is
    caught before cleanup, folder rewires, or runtime changes proceed.
221. Clarify local verification progress lanes. Done:
    `run/verify-local.bat` now prints grouped progress labels for `preflight`,
    `frontend`, and `backend` work instead of stale `1a/6`-style labels. The
    command order and guardrail coverage stay the same, but long local runs are
    easier to read and debug when a dependency, runtime, UI, performance, or
    backend integrity step fails.
222. Guard local verification progress labels. Done:
    `ops/scripts/verification/verify-runtime-deps.ts` now records
    `progressLabelCoverage` inside `localVerificationCoverage`, including the
    `preflight`, `frontend`, and `backend` start/end labels and a
    `staleFractionLabelsAbsent` check. Because Phase 29 repeat consistency
    already compares `localVerificationCoverage`, confusing progress label
    drift is now caught automatically.
223. Fail missing local verification coverage. Done:
    `ops/scripts/verification/verify-runtime-deps.ts` now treats
    `localVerificationCoverage` as a hard source gate: every nested coverage
    flag must be true or the verifier exits with an `is missing coverage`
    message naming the exact missing lane. The runtime build-manifest presence
    flag remains informational because clean workspaces run this verifier before
    the frontend build creates `frontend/dist/business-os-build.json`.
224. Audit dependency topology and delete orphan root dependencies. Done:
    `ops/scripts/architecture/generated-bulk-audit.ts` now records
    `dependencyTopology`, separating active frontend/backend/ops install roots
    from orphan root dependencies. The audit confirmed the root package has no
    install dependencies and root `node_modules` was safe to remove, so the
    ignored generated root `node_modules` folder was deleted while preserving
    `frontend/node_modules` and `backend/node_modules` for local builds/tests
    and Docker release packaging. Bytes removed: 3.30 MB.
225. Add byte accounting to generated cleanup. Done:
    `ops/scripts/powershell/clean-generated.ps1` now measures each exact cleanup
    target before preview or deletion, prints per-target sizes, and reports
    either `Total bytes that would be removed` or `Total bytes removed`. The
    safety boundaries are unchanged: source, `.env`, `business-os-data`,
    runtime secrets, and protected runtime state remain outside this cleanup
    path.
226. Share npm install freshness checks across run files. Done:
    `ops/scripts/powershell/npm-install-mode.ps1` now owns the package-lock,
    package manifest, and `node_modules/.package-lock.json` timestamp check used
    by `run/setup.bat` and `run/verify-local.bat`. This removes duplicated
    inline PowerShell from the run files while preserving the same skip/install
    behavior, and `verify-runtime-deps.ts` now guards the shared helper wiring.
227. Align and guard package versions. Done:
    The ignored local root `package.json` was aligned from `1.0.0` to `6.0.0`
    so local metadata matches the tracked backend, frontend, and ops packages.
    `ops/scripts/verification/verify-runtime-deps.ts` now reads backend,
    frontend, and ops package manifests plus lockfiles, records
    `versionConsistency`, and fails on any app-version drift. Phase 29 repeat
    consistency now compares the version map so stale package or lockfile
    versions cannot quietly linger.
228. Guard Cloudflare runtime cleanup and retention paths. Done:
    `ops/scripts/verification/verify-docker-release.ts` now records
    `cloudflareRuntimeCoverage` in
    `ops/docs/reference/DOCKER-RELEASE-GUARDRAIL.json`. The coverage checks the
    Cloudflare token-rotation script, origin switcher, Access/WAF automation,
    R2 object-store verifier, stable `run/` wrappers, runtime-only token paths,
    long Access session policy, R2 backup retention, local report/backup prune
    paths, and Docker-safe cleanup boundaries. Phase 29 repeat consistency now
    compares this object so Cloudflare cleanup or convenience/security drift is
    caught before release or runtime rewires proceed.
229. Run bounded Cloudflare/runtime retention cleanup. Done:
    `npm --prefix ops run prune-storage -- --reports-keep 20
    --recovery-reports-keep 5 --local-backups-keep 3 --remote-backups-keep 1
    --docker-safe-prune` removed two old Cloudflare public-portal report
    folders from `ops/runtime/reports`, freeing 416,466 bytes. The run kept the
    latest 20 report folders, kept all latest local backup sets, found no R2
    backup objects to delete, and ran Docker-safe prune without touching Docker
    images or volumes.
230. Include standalone report files in runtime retention. Done:
    `ops/scripts/runtime/storage/prune-storage.ts` now prunes generated report
    files and report folders together under the same `--reports-keep` limit.
    The Docker release guardrail checks this with `cloudflareRuntimeCoverage`.
    Running the updated retention command removed three older Cloudflare report
    folders and four stale standalone screenshots from `ops/runtime/reports`,
    freeing 1,199,593 bytes while preserving secrets, uploads, latest backups,
    Docker images, and Docker volumes.
231. Compact generated runtime logs instead of deleting log paths. Done:
    `ops/scripts/runtime/storage/prune-storage.ts` now accepts
    `--log-file-max-bytes` and compacts oversized `.log` files under
    `ops/runtime/logs` and `ops/runtime/pm2` by keeping the newest tail plus a
    compaction header. This preserves expected log paths for PM2, Cloudflare,
    Docker, and startup tooling while preventing stale logs from growing
    unbounded. Running the command with a 1 MiB cap compacted four oversized
    generated logs and freed 12,381,136 bytes without touching secrets, env
    files, uploads, backups, Docker images, or Docker volumes.
232. Centralize runtime cleanup defaults in the automation policy. Done:
    `ops/scripts/runtime/storage/prune-storage.ts` now accepts `--policy` and
    loads report retention, recovery-report retention, local backup retention,
    Cloudflare R2 backup retention, demo cleanup, Docker-safe prune, and
    runtime log cap defaults from `ops/automation/business-os-automation.json`.
    `ops/scripts/powershell/full-automation.ps1` now passes the policy path
    instead of duplicating retention values in PowerShell. The Docker release
    guardrail and Phase 29 repeat audit now check this policy-driven path so
    cleanup strategy changes stay centralized and measurable.
233. Write the latest runtime cleanup ledger from automation. Done:
    `ops/scripts/runtime/storage/prune-storage.ts` now accepts `--output` and
    writes the full retention summary JSON to a workspace-bounded path after
    every run. `ops/scripts/powershell/full-automation.ps1` writes
    `ops/runtime/reports/prune-storage-latest.json`, giving future sessions one
    current status file for report retention, recovery reports, local backups,
    R2 backup pruning status, runtime log compaction, and Docker-safe prune
    planning. The file is generated runtime state and does not copy secrets,
    uploads, env files, protected backups, Docker images, or Docker volumes.
234. Make the latest cleanup ledger machine-checkable. Done:
    `ops/scripts/verification/verify-docker-release.ts` now exposes
    `pruneStorageOutputFlagSupported`,
    `latestCleanupReportWrittenByAutomation`, and
    `latestCleanupReportRuntimeOnly` inside `cloudflareRuntimeCoverage`.
    Because Phase 29 repeat compares that coverage object across cycles, future
    runtime, Cloudflare, or cleanup rewires must preserve the generated cleanup
    ledger, its automation wiring, and its ignored-runtime boundary.
235. Clean accumulated QA/smoke business data and prevent repeat pollution. Done:
    `ops/scripts/runtime/storage/cleanup-test-data.ts` and the
    `ops` package script `cleanup-test-data` now provide a guarded dry-run/apply
    cleanup for `QA Audit ...` smoke data. The cleanup removes matched products,
    product batches, sales, returns, inventory movements, stock transfers,
    import jobs, action history, audit logs, and generated full-audit import
    directories while preserving imported/core catalog data. Before applying to
    the live Docker Postgres database, a local dump was written under
    `ops/runtime/backups/test-data-cleanup`. The applied cleanup removed 2,283
    QA products, 596 sales, 596 returns, 6,444 inventory movements, 610 audit
    import jobs, 752 action-history rows, 752 audit-log rows, and 396 generated
    audit import directories. A postcheck dry-run now reports zero remaining QA
    matches. `ops/scripts/runtime/audits/full-app-audit.ts` calls the cleanup
    in a `finally` block, so future write-heavy audits remove their own test
    records. A live action-history check created a QA row, exercised
    `/undo` and `/redo`, verified the final `undoable` status, and then removed
    that verification row through the same cleanup path.
236. Add machine-readable QA/smoke cleanup guardrails. Done:
    `ops/scripts/verification/verify-docker-release.ts` now records
    `testDataCleanupCoverage` in
    `ops/docs/reference/DOCKER-RELEASE-GUARDRAIL.json`. The coverage checks that
    the cleanup script exists, the package script is wired, dry-run is the
    default, apply is explicit, selectors stay bounded to QA/smoke signatures,
    dependent business rows are included, generated import directory cleanup is
    workspace-bounded, output reports are supported, and full-app audits run the
    cleanup in `finally`. Phase 29 repeat now compares this object across cycles
    so future audit/test rewires cannot silently reintroduce test data buildup.
237. Make live smoke tests self-cleaning by prefix. Done:
    `ops/scripts/runtime/smoke/live-smoke.ts` now calls the guarded
    `cleanup-test-data.ts` path in `finally` with the exact `QA Smoke ...`
    prefix it created, writing
    `ops/runtime/reports/live-smoke-cleanup-latest.json`. The cleanup script now
    also matches prefix-based import job file paths and generated import
    directories, so product/import smoke runs remove their own database rows and
    import files without relying on the broader `--all-qa` full-audit cleanup.
    `testDataCleanupCoverage` now checks this live-smoke wiring, prefix import
    cleanup support, and the runtime-only cleanup report.
238. Add no-leftover QA/smoke postcheck gates. Done:
    `ops/scripts/runtime/storage/cleanup-test-data.ts` now supports
    `--fail-on-match` for dry-run postchecks, returning a failing exit code if
    any matched database rows or generated import directories remain. The `ops`
    package now exposes `cleanup-test-data:check` for `QA Audit ...` data and
    `cleanup-test-data:check-smoke` for `QA Smoke ...` data. Full automation now
    runs both postchecks after the verification gate and writes the latest
    runtime-only ledgers to
    `ops/runtime/reports/test-data-cleanup-postcheck-latest.json` and
    `ops/runtime/reports/live-smoke-cleanup-postcheck-latest.json`. Docker
    release guardrails now verify the postcheck scripts, fail-on-match support,
    and full-automation wiring.
239. Codify action-history undo/redo live verification. Done:
    `ops/scripts/runtime/audits/action-history-undo-redo-check.ts` now logs in,
    creates one reversible `QA Action History ...` row, calls the server
    `/undo` and `/redo` transitions, verifies payload round-trip plus the final
    `undoable` state, then removes its own action-history and audit-log rows via
    `cleanup-test-data.ts` in `finally`. The `ops` package exposes
    `action-history:check`, full automation runs it before the QA/smoke
    postchecks, and the Docker release guardrail verifies the script, package
    entry, cleanup report, and full-automation wiring.
240. Add action-history read-path indexes. Done:
    `backend/src/postgresDatabase.ts` and `backend/src/db/postgresSchema.sql`
    now create `idx_action_history_scope_updated_pg` and
    `idx_action_history_scope_user_updated_pg`, matching the API's
    `scope = ? ORDER BY updated_at DESC, id DESC` and
    `scope = ? AND created_by_id = ? ORDER BY updated_at DESC, id DESC`
    history-bar reads. `backend/test/postgresDatabase.test.ts` guards the
    startup DDL, and `ops/docs/SCHEMA-RELATIONSHIPS.md` now records the
    completed read-path indexes in the schema map.
241. Add unique session-token index. Done:
    A live duplicate check found zero duplicate `user_sessions.token_hash`
    values across 3,459 current sessions. `backend/src/postgresDatabase.ts` and
    `backend/src/db/postgresSchema.sql` now create
    `idx_user_sessions_token_hash_unique_pg`, enforcing the direct
    `WHERE token_hash = ?` session lookup contract. The startup DDL test and
    schema relationship document now mark the session-token uniqueness item as
    completed, with user-session foreign keys still left for a later
    relationship-hardening pass.
242. Harden auth security-flow verification cleanup. Done:
    `backend/test/authSecurityFlow.test.ts` now runs its mutable auth checks
    serially, gives spawned test servers an explicit local Postgres URL fallback,
    captures child-server output for easier failure triage, and uses a
    disposable `bos_auth_security_*` user instead of assuming the live `admin`
    password. The password-change test now proves stale session cookies are
    revoked, restores the temporary password path before cleanup, deletes its
    own sessions, verification codes, audit logs, and user row, and a follow-up
    live database check confirmed zero `bos_auth_security_*` leftovers.
243. Count runtime unique indexes in schema audit. Done:
    `ops/scripts/backend/schema-audit.ts` now parses both
    `CREATE INDEX IF NOT EXISTS` and `CREATE UNIQUE INDEX IF NOT EXISTS`,
    marks unique runtime index rows in the generated report, writes
    `runtimeUniqueIndexes` and `runtimeIndexNames` to
    `ops/docs/reference/SCHEMA-AUDIT.json`, and Phase 29 repeat compares those
    fields. The refreshed schema audit now reports 49 runtime indexes, including
    17 unique indexes, so security and idempotency indexes are no longer hidden
    behind the old plain-index-only count.
244. Add idempotency unique indexes for create replay keys. Done:
    Live duplicate checks found zero duplicate non-empty `client_request_id`
    values in `sales`, `returns`, and `products`. `backend/src/postgresDatabase.ts`
    and `backend/src/db/postgresSchema.sql` now create unique partial indexes for
    `sales(client_request_id)`, `returns(client_request_id)`, and
    `products(client_request_id)` where the request id is present. These indexes
    close the race window behind the existing route-level replay lookup/catchback
    logic and keep accidental double-submit/retry behavior deterministic.
245. Add parent-first detail-read indexes. Done:
    `backend/src/postgresDatabase.ts` and `backend/src/db/postgresSchema.sql`
    now create `sale_items(sale_id, id)`, `return_items(return_id, id)`,
    `product_images(product_id, sort_order, id)`,
    `import_job_files(job_id, kind, id)`, and
    `import_job_errors(job_id, batch_id, id)` indexes. These match common
    detail hydration, gallery ordering, import review, and cleanup paths without
    changing data shape or delete behavior.
246. Make RFID event dedupe authoritative. Done:
    Live RFID event checks found zero rows and zero duplicate non-empty
    `dedupe_key` values. RFID event inserts now use
    `ON CONFLICT (dedupe_key) ... DO NOTHING`, while the existing
    `rfid_session_items` upsert still increments `read_count` for repeated tag
    reads. Runtime DDL and the schema dump now create the unique partial
    `idx_rfid_events_dedupe_key_unique` index, reducing duplicate raw-event
    growth without losing session review counts.
247. Broaden test-data residue guardrails. Done:
    `cleanup-test-data.ts` now treats `QA Audit`, `QA Smoke`, and
    `QA Action History` as generated verification data in its broad QA scan,
    including smoke import files under generated import folders. The ops package
    now exposes `cleanup-test-data:check-action-history`, full automation writes
    `action-history-cleanup-postcheck-latest.json`, and the Docker release
    guardrail verifies the stronger no-leftover postcheck wiring.
248. Make storage-prune previews non-destructive by construction. Done:
    `prune-storage.ts` now refuses to write a preview-named report unless
    `--dry-run` is present, and `ops/package.json` exposes
    `prune-storage:preview` for safe local review. Normal automation keeps using
    the apply path, while ad hoc preview commands cannot accidentally delete old
    reports or backups.
249. Make storage-prune preview wiring machine-checkable. Done:
    The Docker release guardrail now records `previewScriptDryRun` and
    `previewNameRequiresDryRun` inside `cloudflareRuntimeCoverage`, so Phase 29
    repeat catches either a missing `prune-storage:preview` package command or a
    future regression that lets preview-named reports mutate runtime storage.
250. Make live-smoke lookup residue prefix-scoped. Done:
    `ops/scripts/runtime/smoke/live-smoke.ts` now writes the unique `QA Smoke`
    seed into product category and brand fields, including imported smoke CSV
    rows, instead of using generic `Smoke` metadata. `cleanup-test-data.ts`
    now counts and removes empty QA-prefixed category/unit lookup rows in both
    dry-run postchecks and apply mode, so future smoke/import verification does
    not leave hidden lookup residue after product rows are cleaned.
251. Add action-history self-cleanup postcheck. Done:
    `ops/scripts/runtime/audits/action-history-undo-redo-check.ts` now runs a
    dry-run `--fail-on-match` postcheck immediately after its apply cleanup and
    writes `action-history-undo-redo-cleanup-postcheck-latest.json`. The
    standalone undo/redo verifier now proves both the API transition behavior
    and zero leftover rows for its exact `QA Action History` prefix before full
    automation reaches the broader postcheck gate.
252. Add comprehensive relationship-orphan integrity reporting. Done:
    `ops/scripts/backend/verify-data-integrity.ts --comprehensive` now checks
    the FK-candidate backlog from the schema plan for orphaned child rows and
    can write a workspace-bounded JSON report with `--output`. The backend
    package exposes `verify:integrity:comprehensive`, writing
    `ops/runtime/reports/data-integrity-comprehensive-latest.json`. The current
    live report is intentionally non-mutating and records existing cleanup
    backlog: 22 return/sale over-return pairs, 700 product-batch product
    orphans, 4 branch-batch branch orphans, 22 return-item product orphans,
    4 inventory-movement branch orphans, and 20 stock-transfer product orphans.
253. Add bounded live-data integrity samples. Done:
    Comprehensive backend integrity reports now include `overReturned` details
    plus capped sample rows for each relationship orphan bucket. The
    `--sample-limit` option is clamped between 1 and 50, defaulting to 10, so
    future cleanup/relink planning can inspect representative row shapes without
    dumping the database or mutating imported business history.
254. Classify integrity cleanup backlog. Done:
    Comprehensive integrity reports now include `cleanupClassification` rows
    with `total`, `generatedLike`, `unclassified`, and policy hints. The latest
    live report classifies all 22 over-return pairs, all 4 branch-batch branch
    orphans, all 22 return-item product orphans, all 4 inventory-movement branch
    orphans, and all 20 stock-transfer product orphans as generated-like. It
    also shows product-batch product orphans are mixed: 303 generated-like and
    397 unclassified, so product-batch cleanup remains review/relink territory
    rather than automatic deletion.
255. Add bounded integrity cleanup candidate IDs. Done:
    Comprehensive integrity reports now include `candidateIds` under every
    cleanup classification row. Each bucket lists capped generated-like and
    unclassified IDs using the same `--sample-limit`, giving cleanup/relink
    planning exact row handles without dumping full tables or changing data.
    The latest live report shows, for example, product-batch generated-like IDs
    `5506, 5507, 5509, 5510, 5512` and unclassified IDs
    `5505, 5508, 5511, 5514, 5517` at sample limit 5.
256. Add guarded generated-integrity cleanup pathway. Done:
    `ops/scripts/runtime/storage/cleanup-integrity-backlog.ts` now gives ops a
    dry-run-first cleanup path for generated-like integrity residue only. The
    ops package exposes `cleanup-integrity-backlog` for preview reports and
    `cleanup-integrity-backlog:apply` for explicit transaction-backed cleanup.
    A Docker-compatible backup was created at
    `ops/runtime/docker-release/backups/20260521-053131` before apply was
    attempted. After the Docker backup/start cycle, the active release database
    contained only the small QA-looking dataset from that backup, the cleanup
    apply matched zero rows, and the comprehensive integrity report passed with
    zero orphan/over-return backlog. Treat this as a runtime-state finding:
    restore/import decisions must use verified backup packages, not broad
    cleanup assumptions.
257. Apply generated QA runtime cleanup after backup. Done:
    With the backup from Move 256 in place, `cleanup-test-data.ts --all-qa
    --apply` removed the remaining generated QA smoke/deep-audit rows from the
    active release database: 8 products, 14 product batches, 8 branch-stock
    rows, 2 sales, 2 sale items, 2 returns, 2 return items, 17 inventory
    movements, 2 import jobs, 6 action-history rows, 3 audit-log rows, and 1
    empty QA category, plus related batch-allocation rows. Follow-up dry-run
    postchecks for broad QA, `QA Smoke`, and `QA Action History` all returned
    zero matches, and comprehensive integrity still passed. Current product,
    sales, return, batch, branch-stock, movement, and transfer counts are zero,
    so any real imported business dataset should be restored or re-imported from
    a verified backup/source before production use.
258. Add dataset-readiness status to integrity reports. Done:
    `verify-data-integrity.ts --comprehensive` now writes `datasetSummary` with
    product, batch, branch-stock, sales, return, movement, transfer,
    action-history, and audit-log counts. The check passes but explicitly labels
    the runtime dataset as `empty` when transactional business tables have no
    rows, with the note to restore or import verified business data before
    production use. The latest report shows transactional table counts at zero
    after Move 257 while preserving action-history and audit-log counts.
259. Add standalone dataset-readiness gate. Done:
    `ops/scripts/runtime/storage/dataset-readiness.ts` now provides a fast
    Docker/Postgres readiness check that writes
    `ops/runtime/reports/dataset-readiness-latest.json`. The default
    `dataset-readiness` command reports `empty` or `loaded` without failing,
    while `dataset-readiness:loaded` uses `--fail-if-empty` as a production
    gate. On the current cleaned runtime, the default command passes with
    `empty`, and the loaded gate correctly exits nonzero until verified
    business data is restored or re-imported.
260. Add non-mutating restore-candidate scanner. Done:
    `ops/scripts/runtime/storage/restore-candidates.ts` scans local Docker and
    data-sync backup roots, validates required backup files, parses
    `postgres.sql` COPY blocks, and writes
    `ops/runtime/reports/restore-candidates-latest.json`. It reports the newest
    loaded backup separately from the largest loaded backup, then recommends the
    largest valid loaded package so tiny QA backups do not hide the real import
    dataset. The current recommended candidate is
    `ops/runtime/docker-release/backups/20260509-065427`, with 22,050 business
    rows across products, batches, branch stock, sales, returns, inventory
    movements, and stock transfers.
261. Add temporary-database restore rehearsal. Done:
    `ops/scripts/runtime/storage/restore-rehearsal.ts` restores the recommended
    backup into a temporary Postgres database named
    `business_os_restore_rehearsal_<timestamp>`, compares restored table counts
    against the source `postgres.sql` COPY counts, writes
    `ops/runtime/reports/restore-rehearsal-latest.json`, and drops the temporary
    database by default. The rehearsal passed for
    `ops/runtime/docker-release/backups/20260509-065427`; products, batches,
    branch stock, sales, sale items, returns, return items, inventory movements,
    and stock transfers all matched exactly, and no rehearsal database remained
    afterward.
262. Restore verified business dataset and repair generated residue. Done:
    A fresh pre-restore backup was created at
    `ops/runtime/docker-release/backups/20260521-060128`, then the rehearsed
    `20260509-065427` package was restored into the live Docker Postgres
    runtime. The restore exposed two runtime drift issues that are now repaired:
    `docker-release.env` now points at the locally available
    `business-os:v6.0.0-202605151537` image, and the restored Postgres role was
    reset to match the current runtime secret without recording the secret in
    docs. After restart, route contract checks passed, including the public
    portal catalog route. Broad QA cleanup removed 2,368 restored smoke/deep
    audit rows, and `cleanup-integrity-backlog` was tightened to delete only
    detached high-id product batches with no sale/return allocations. The final
    apply removed 397 orphan batches and 606 branch-batch stock rows. Current
    readiness is `loaded`: 5,539 products, 5,491 product batches, 5,539 branch
    stock rows, 29 sales, 29 sale items, 3,941 inventory movements, 495
    action-history rows, and 2,221 audit-log rows. Comprehensive integrity and
    route contract both pass, and generated cleanup postchecks return zero
    matches.
263. Rebuild and restart Docker release on current source. Done:
    The restored live runtime was still serving the older
    `business-os:v6.0.0-202605151537` image, which exposed a stale packaged
    sales-export query during the broad Phase 8.4 UI check. A fresh Docker
    release image was built from the current source as
    `business-os:v6.0.0-202605210625`, the release kit was regenerated under
    `release/business-os`, and `run/docker/start.bat` restarted the app and
    workers on that image without losing the restored Postgres data. The broad
    Phase 8.4 UI live check now passes end-to-end against frontend hash
    `5674b3321890179c`, including dashboard analytics, branch stock/transfer,
    sales export preview, import modals, files, catalog, public portal, POS,
    inventory, contacts, loyalty, users, profile, audit/settings/server, and
    integration doctor paths. The public Cloudflare portal check also passes:
    40 product cards render, portal API calls return 200, restored upload assets
    return 200, enforced CSP is present, no report-only CSP header is present,
    and there are no relevant console/page errors. The branch-transfer portion
    of `phase84-ui-live-check.ts` now falls back to an authenticated direct
    branch-stock read if the modal response arrives before Playwright attaches
    its waiter.
264. Remove regenerated release kit after live image verification. Done:
    The release build generated `release/business-os` for offline copying, but
    the live Docker runtime already had the new
    `business-os:v6.0.0-202605210625` image loaded and running. Keeping the kit
    pushed generated cleanup candidates over the Phase 29 512 MB threshold, so
    the ignored/regenerable `release` folder was deleted after verifying the
    app, public portal, and data integrity. Removed bytes: 378,813,449. The
    release kit can be regenerated later with `run/docker/release.bat`; the
    Docker image and restored Postgres volume were not deleted.
265. Add a reusable post-live hygiene gate. Done:
    `ops/scripts/runtime/storage/post-live-hygiene.ts` is now the standard
    one-command postcheck after smoke, Playwright, and public-portal runs. It
    runs broad QA, `QA Smoke`, and `QA Action History` cleanup postchecks with
    `--fail-on-match`, previews generated-integrity cleanup and fails if any
    residue remains, requires `dataset-readiness` to be `loaded`, and runs the
    comprehensive backend integrity verifier unless `--skip-integrity` is
    passed for a narrow local triage. The ops package keeps
    `post-live-hygiene` and adds the clearer `live-hygiene:check` alias so
    future sessions have one gate to prove test rows, undo/redo residue, and
    orphan cleanup debt were not left behind.
266. Add an ordered Phase 8.4 live-suite runner. Done:
    `ops/scripts/runtime/live-checks/phase84-live-suite.ts` now runs the broad
    UI Playwright check, public Cloudflare portal check, and post-live hygiene
    gate in that order, writing
    `ops/runtime/reports/phase84-live-suite-latest.json`. The ops package adds
    `phase84:live-suite` for the full sequence, with `--skip-ui`,
    `--skip-public`, `--skip-hygiene`, and `--keep-going` switches for focused
    triage. This makes the expected end-to-end verification loop explicit:
    exercise buttons/actions, check the public portal, then prove no QA or
    integrity residue remains.
267. Compact Phase 8.4 live-suite reports. Done:
    `phase84-live-suite.ts` now attaches structured child report paths and
    concise summaries instead of embedding large escaped child JSON output for
    successful steps. Broad UI summaries include frontend hash and signal
    counts, public portal summaries include product/error/CSP signals, and the
    hygiene summary includes failed check names, loaded-dataset status, and
    generated-integrity match count. Failure output tails remain available only
    when a child step fails.
268. Add generated-bulk disposition totals. Done:
    `generated-bulk-audit.ts` now records `dispositionTotals` in the JSON
    summary and renders a Markdown "Disposition Totals" table. Phase 29 repeat
    compares this field across cycles, so cleanup planning can distinguish
    preserved data, retention-managed runtime files, reinstallable
    dependencies, regenerable build output, and safe cleanup targets without
    re-reading every target row manually.
269. Promote schema primary-key gaps into generated evidence. Done:
    `ops/scripts/backend/schema-audit.ts` now emits `staticPrimaryKeyGaps`,
    `staticPrimaryKeyGapTables`, and `staticPrimaryKeyGapDetails`, and renders a
    "Primary Key Gaps" section in `SCHEMA-AUDIT.md`. Phase 29 repeat compares
    those fields across cycles. The current explicit backlog is `import_jobs`
    and `settings`, with `settings.key` already protected by
    `idx_settings_key_unique` and ready for a cautious primary-key migration
    only after duplicate/null checks and rollback SQL.
270. Add read-only primary-key migration preflight. Done:
    `ops/scripts/backend/schema-primary-key-preflight.ts` checks the current
    Docker Postgres data for the `import_jobs.id` and `settings.key` migration
    candidates without applying DDL. It reports row counts, null-key counts,
    duplicate-key groups, duplicate samples, current primary-key state, unique
    indexes, and `readyForPrimaryKey`. Ops scripts now expose
    `schema-pk-preflight` and `schema-pk-preflight:strict`. The latest live run
    reports both tables ready: `import_jobs` has 1 row, 0 null keys, 0 duplicate
    groups; `settings` has 119 rows, 0 null keys, 0 duplicate groups, and
    existing unique index `idx_settings_key_unique`.
271. Add intent-based route chunk warmup. Done:
    The authenticated app shell now listens for `bos:page-intent` events and
    preloads only the exact route chunk the user is about to open, with an
    80 ms debounce, a 7 s chunk timeout, idle scheduling, visibility checks, and
    slow/save-data connection guards. `Sidebar.tsx` publishes that event from
    desktop pointer/focus intent and mobile touch intent before `navigateTo()`,
    improving second-page navigation without returning to broad startup
    prefetches. The frontend performance verifier and UX guard test now enforce
    the bounded intent warmup path.
272. Rebuild, verify, and clean the release generated by Move 271. Done:
    `run/docker/release.bat` built `business-os:v6.0.0-202605211016`, and
    `run/docker/start.bat` restarted the app and workers on that image. The
    full `phase84:live-suite` passed against frontend hash `7c013382f0323c21`:
    72 broad UI signals, zero relevant console messages, public Cloudflare
    portal with 40 product cards and zero failed responses, and post-live
    hygiene with dataset status `loaded` and zero generated-integrity matches.
    After verifying the image was loaded and running, the ignored/regenerable
    `release` folder was deleted again. Removed bytes: 378,824,942.
273. Apply guarded primary-key hardening to live Postgres. Done:
    `backend/src/db/postgresSchema.sql` now declares `import_jobs.id` and
    `settings.key` as primary keys, and `postgresDatabase.ensureRuntimeSchema()`
    applies the same constraints only when live data has no null/blank keys, no
    duplicate groups, and no existing primary key. A rollback file was added at
    `ops/scripts/backend/schema-primary-key-rollback.sql`. Before runtime
    apply, `run/docker/backup.bat` created a Docker-compatible backup at
    `ops/runtime/docker-release/backups/20260521-103142`; then
    `run/docker/release.bat` built `business-os:v6.0.0-202605211031` and
    `run/docker/start.bat` applied the guarded schema update. Strict preflight
    now reports `hasPrimaryKey: true` for both tables. The full
    `phase84:live-suite` passed afterward with frontend hash
    `dba6668a64b6912d`, 72 broad UI signals, public portal success, loaded
    dataset status, and zero generated-integrity matches. The regenerated
    `release` folder was deleted after verification. Removed bytes:
    378,824,942.
274. Run retention cleanup after schema hardening. Done:
    `prune-storage` kept the three latest Docker-compatible backup packages
    (`20260521-103142`, `20260521-060128`, `20260521-053131`), removed the old
    restored package `20260509-065427` after the fresh loaded backup was
    created, and pruned two older Phase 8.4 report folders. Local bytes removed:
    5,971,653 across backups and reports. Remote R2 retention kept the latest
    `datasync-2026-05-20T22-05-48-918Z` package and had no stale remote objects
    to delete. Docker cleanup pruned stopped containers and builder cache only,
    reclaiming 2.503 GB of builder cache while preserving volumes and images.
275. Remove redundant catalog language bundle imports. Done:
    `CatalogPage.tsx` now relies on the scoped portal language pack and the
    existing call-site fallbacks instead of importing full `en.json` and
    `km.json` app translation bundles. The frontend performance verifier and
    performance loading UX test now block direct full-language JSON imports from
    the catalog route. Focused portal language/content tests, frontend
    typecheck, JSX check, and build pass. The built catalog chunk is now about
    166.6 KB, down from the previous 167.2 KB build in this session, with
    public/editor copy still backed by `portalLanguagePacks`.
276. Deploy and verify the lighter catalog bundle. Done:
    `run/docker/release.bat` built `business-os:v6.0.0-202605211053`, and
    `run/docker/start.bat` restarted the live runtime on that image. The full
    `phase84:live-suite` passed against frontend hash `534372c58260ddab`: 72
    broad UI signals, zero relevant console messages, public Cloudflare portal
    with 40 product cards and zero failed responses, and post-live hygiene with
    dataset status `loaded` and zero generated-integrity matches. After
    verification, the ignored/regenerable `release` folder was deleted again.
    Removed bytes: 378,825,966.
277. Remove redundant settings-meta startup waterfall. Done:
    `frontend/src/api/methods.ts` now uses the `updatedAt` value already
    returned by `/api/settings` instead of making a second `/api/settings/meta`
    request during every settings load. The saved local settings metadata path
    is preserved for write-conflict protection, but app startup and later
    settings refreshes now use one authenticated settings request instead of
    two. `performanceLoadingUx.test.ts` and `verify-performance.ts` now guard
    against reintroducing that waterfall. Focused performance guards,
    frontend typecheck, JSX check, full frontend utility tests, and production
    build pass.
278. Deploy and verify the settings-waterfall cleanup. Done:
    `run/docker/release.bat` built `business-os:v6.0.0-202605211116`, and
    `run/docker/start.bat` restarted the live app plus workers on that image.
    The full `phase84:live-suite` passed against frontend hash
    `474a0ea68e73d19f`: 72 broad UI signals, zero relevant console messages,
    public Cloudflare portal with 40 product cards and zero failed responses,
    and post-live hygiene with dataset status `loaded` and zero
    generated-integrity matches. After confirming the image was loaded and the
    app/workers were running, the ignored/regenerable `release` folder was
    deleted again. Removed bytes: 378,825,966.
279. Run retention cleanup after Move 278 deploy. Done:
    `npm.cmd --prefix ops run prune-storage` pruned four older Phase 8.4
    report folders, removing 702,494 local report bytes. R2 retention kept the
    latest remote package `datasync-2026-05-20T22-05-48-918Z` and had no stale
    remote objects to delete. Docker cleanup pruned stopped containers and
    builder cache only, reclaiming 2.754 GB of builder cache while preserving
    images, volumes, uploads, secrets, and retained backup packages.
280. Cache settings schema metadata on the backend settings route. Done:
    `backend/src/routes/settings.ts` now caches the `settings.updated_at`
    column-existence probe for the lifetime of the process, removing a repeated
    `information_schema.columns` query from every settings read and write while
    preserving the fallback for runtimes without that column. The route
    contract test now guards this cache, and backend route contracts, the full
    backend utility suite, and the schema audit pass.
281. Deploy and verify the backend settings metadata cache. Done:
    `run/docker/release.bat` built `business-os:v6.0.0-202605211130`, and
    `run/docker/start.bat` restarted the live app and workers on that image.
    The full `phase84:live-suite` passed against frontend hash
    `add767b15d753fcb`: 72 broad UI signals, zero relevant console messages,
    public Cloudflare portal with 40 product cards and zero failed responses,
    and post-live hygiene with dataset status `loaded` and zero
    generated-integrity matches. The ignored/regenerable `release` folder was
    deleted after confirming the image was loaded and running. Removed bytes:
    378,825,966.
282. Run retention cleanup after Move 281 deploy. Done:
    `prune-storage` pruned two older Phase 8.4 report folders, removing
    362,565 local report bytes. R2 retention again kept the latest remote
    package `datasync-2026-05-20T22-05-48-918Z` with no stale remote objects.
    Docker cleanup pruned stopped containers and builder cache only, reclaiming
    2.503 GB of builder cache while preserving images, volumes, uploads,
    secrets, and retained backup packages.
283. Cache additional backend schema metadata probes. Done:
    `branches.ts` and `inventory.ts` now cache the stock-transfer note-column
    selection used by transfer write paths, and `products.ts` now caches the
    settings `updated_at` column support used by product import brand-setting
    writes. These are process-lifetime schema-shape probes, so the existing
    no-column fallbacks remain while repeated `information_schema.columns`
    reads are removed from common write paths. Route-contract tests guard all
    three caches, and backend route contracts, full backend utility tests,
    schema audit, and frontend performance verification pass.
284. Deploy and verify the additional metadata-cache cleanup. Done:
    `run/docker/release.bat` built `business-os:v6.0.0-202605211148`, and
    `run/docker/start.bat` restarted the live app and workers on that image.
    The full `phase84:live-suite` passed against frontend hash
    `fa19f4440a87c47c`: 72 broad UI signals, zero relevant console messages,
    public Cloudflare portal with 40 product cards and zero failed responses,
    and post-live hygiene with dataset status `loaded` and zero
    generated-integrity matches. The ignored/regenerable `release` folder was
    deleted after confirming the image was loaded and running. Removed bytes:
    378,825,966.
285. Run retention cleanup after Move 284 deploy. Done:
    `prune-storage` pruned two older Phase 8.4 report folders, removing
    450,818 local report bytes. R2 retention again kept the latest remote
    package `datasync-2026-05-20T22-05-48-918Z` with no stale remote objects.
    Docker cleanup pruned stopped containers and builder cache only, reclaiming
    2.503 GB of builder cache while preserving images, volumes, uploads,
    secrets, and retained backup packages.
286. Cache custom-table managed-column metadata. Done:
    `backend/src/routes/customTables.ts` now caches stable custom-table
    `information_schema.columns` probes by table and column name for the
    process lifetime, while refreshing the cache when the route creates a
    managed table or adds the `updated_at` versioning column. This removes
    repeated schema metadata reads from custom-table row write paths without
    weakening the fallback for older or externally managed custom tables. The
    route-contract cache test, full backend utility suite, and schema audit
    pass.
287. Deploy and verify the custom-table metadata cache. Done:
    `run/docker/release.bat` built `business-os:v6.0.0-202605211213`, and
    `run/docker/start.bat` restarted the live app and workers on that image.
    The full `phase84:live-suite` passed against frontend hash
    `a9b3dec481bf1b9f`: 72 broad UI signals, zero relevant console messages,
    public Cloudflare portal success with 40 product cards and zero failed
    responses, and post-live hygiene with dataset status `loaded` and zero
    generated-integrity matches. The ignored/regenerable `release` folder was
    deleted after confirming the image was loaded and running. Removed bytes:
    378,825,454.
288. Run retention cleanup after Move 287 deploy. Done:
    `prune-storage` pruned one older Phase 8.4 report folder plus one stale
    latest preflight report, removing 241,196 local report bytes. R2 retention
    kept the latest remote package `datasync-2026-05-21T04-07-34-742Z` and
    deleted no stale remote objects. Docker cleanup pruned stopped containers
    and builder cache only, reclaiming 2.503 GB of builder cache while
    preserving images, volumes, uploads, secrets, and retained backup packages.
289. Consolidate backend schema metadata caching. Done:
    `backend/src/schemaMetadata.ts` now owns cached table/column metadata
    helpers for `hasColumn`, ordered `firstExistingColumn`, and
    `markColumnPresent`. Settings, product imports, branch transfers, inventory
    transfers, and custom-table managed rows now reuse that helper instead of
    carrying route-local schema cache state or duplicated
    `information_schema.columns` queries. Existing fallback behavior and
    candidate order stay unchanged. Route-contract coverage, full backend
    utility tests, and schema audit pass.
290. Deploy and verify the shared schema metadata helper. Done:
    `run/docker/release.bat` built `business-os:v6.0.0-202605211242`, and
    `run/docker/start.bat` restarted the live app and workers on that image.
    The full `phase84:live-suite` passed against frontend hash
    `b813e9a1b8dbf1df`: 72 broad UI signals, zero relevant console messages,
    public Cloudflare portal success with 40 product cards and zero failed
    responses, and post-live hygiene with dataset status `loaded` and zero
    generated-integrity matches. The ignored/regenerable `release` folder was
    deleted after confirming the image was loaded and running. Removed bytes:
    378,825,966.
291. Run retention cleanup after Move 290 deploy. Done:
    `prune-storage` pruned two older Phase 8.4 report folders, removing
    465,575 local report bytes. R2 retention kept the latest remote package
    `datasync-2026-05-21T04-07-34-742Z` and deleted no stale remote objects.
    Docker cleanup pruned stopped containers and builder cache only, reclaiming
    2.503 GB of builder cache while preserving images, volumes, uploads,
    secrets, and retained backup packages.
292. Add behavioral tests for shared schema metadata caching. Done:
    `backend/test/schemaMetadata.test.ts` now exercises the shared
    `schemaMetadata` helper with a mocked database, covering positive and
    negative cache hits, ordered candidate-column selection, custom-table
    `markColumnPresent` refresh behavior, and safe fallbacks when metadata
    probes fail. `backend/package.json` wires the test into `test:utils`.
    Focused helper tests, full backend utility tests, and schema audit pass.
293. Guard production routes against direct schema metadata probes. Done:
    `backend/test/routeContracts.test.ts` now scans `backend/src/routes/*.js`
    and fails if any production route bypasses `schemaMetadata.ts` with a direct
    `information_schema.columns` query. This keeps the shared process cache as
    the single route-layer pathway for stable schema-shape checks. Focused
    route contracts, full backend utility tests, and schema audit pass.
294. Batch integrity verifier FK orphan counts. Done:
    `ops/scripts/backend/verify-data-integrity.ts` now checks all relationship
    orphan counts with one generated `UNION ALL` query instead of one Docker
    `psql` call per FK candidate, while keeping bounded sample queries only for
    relationships that actually have orphans. The verifier also quotes
    generated identifiers and uses `current_schema()` for metadata coverage.
    Syntax check, focused automation coverage, live comprehensive integrity
    verification, full backend utility tests, and schema audit pass.
295. Tighten and apply generated test-data cleanup. Done:
    `ops/scripts/runtime/storage/cleanup-test-data.ts` now includes
    `QA Deep Audit` in the bounded `--all-qa` selector for products,
    text payloads, lookup names, and import-job JSON. The matching Docker
    release guard now requires that selector coverage. A live cleanup removed
    20 generated QA sales, 20 sale items, 140 inventory movements,
    279 action-history rows, and 279 audit-log rows while deleting zero
    products, uploads, import directories, categories, units, or backup data.
    The zero-residue postcheck, dataset readiness, comprehensive integrity,
    full backend utility suite, and Docker release cleanup guard pass.
296. Make post-live hygiene resource-aware. Done:
    `ops/scripts/runtime/storage/post-live-hygiene.ts` now builds explicit
    hygiene check tasks and runs the Docker/Postgres-backed checks as
    `contention-safe-sequential-checks`. A live fully parallel trial showed
    Docker `psql` contention, so the final scheduler favors predictable
    low-contention execution while still recording the mode in the report.
    Syntax check, focused automation coverage, and live post-hygiene
    verification pass with zero QA residue and dataset readiness `loaded`.
297. Bound catalog submission image reads. Done:
    `frontend/src/components/catalog/CatalogPage.tsx` now uses shared image
    FileReader helpers, caps portal submission screenshots at eight, and reads
    selected/pasted images with `CATALOG_IMAGE_READ_CONCURRENCY = 2` instead of
    eagerly base64-reading every selected file at once. Paste handling now
    reads only the remaining screenshot slots. Frontend utility tests, JSX
    check, performance verifier, production build, Docker release/start on
    `business-os:v6.0.0-202605211541`, and the full Phase 8.4 Playwright live
    suite pass on frontend hash `06a20c2b662bb3e2`.
298. Bound receipt export asset inlining. Done:
    `frontend/src/utils/printReceipt.ts` now uses `mapReceiptAssets()` and
    `RECEIPT_ASSET_INLINE_CONCURRENCY = 3` for receipt image/style asset
    inlining instead of eager `Promise.all(images.map(...))` and
    `Promise.all(nodes.map(...))` work. This preserves printable receipt image
    export while reducing browser memory/network spikes on media-heavy receipts.
    Focused receipt tests, full frontend utility tests, JSX check, performance
    verifier, and production build pass.
299. Make Phase 29 repeat audits contention-safe. Done:
    `ops/scripts/architecture/phase29-audit.ts` now separates report-writing
    checks from small guardrails: generated bulk, schema, performance, and
    language audits run with `REFERENCE_WRITER_CONCURRENCY = 1`; Docker and
    runtime guardrails still run with bounded parallelism; organization audit
    runs last against a settled reference tree. Focused automation coverage and
    a three-cycle `phase29:audit:repeat` pass with 21 checks and zero failures.
300. Bound offline file-sync failure status writes. Done:
    `frontend/src/web-api.ts` now routes failed/pending chunk status updates
    through `mapOfflineFileChunkStatusUpdates()` with
    `OFFLINE_FILE_CHUNK_STATUS_WRITE_CONCURRENCY = 3`, avoiding an unbounded
    IndexedDB write burst when a large offline file upload pauses or fails.
    `frontend/tests/offlineSyncArchitecture.test.ts` guards the bounded
    pathway. Offline sync/security tests, full frontend utility tests, JSX
    check, performance verifier, and production build pass.
301. Bound lookup snapshot name scans. Done:
    `frontend/src/components/products/lookups/productLookupSnapshots.mjs` now
    uses `mapLookupNames()` with `LOOKUP_PRODUCT_NAME_CONCURRENCY = 2` for
    category, unit, and brand undo snapshot reads. Each name still pages in
    order, but large lookup merges can scan two independent names at a time
    instead of serializing the whole name list. Performance guards, full
    frontend utility tests, JSX check, performance verifier, and production
    build pass.
302. Bound stale app-shell cache deletion. Done:
    `frontend/src/App.tsx` now uses `deleteStaleShellCaches()` with
    `STALE_SHELL_CACHE_DELETE_CONCURRENCY = 2` when chunk recovery clears old
    `business-os-app-shell-*` and `business-os-static-*` browser caches. This
    keeps recovery reload cleanup from issuing an unbounded cache deletion
    burst. Performance guards, full frontend utility tests, JSX check,
    performance verifier, and production build pass.
303. Bound full runtime-reset cleanup. Done:
    `frontend/src/platform/runtime/clientRuntime.ts` now routes service-worker
    unregisters and Business OS cache deletion through `mapRuntimeCleanup()`
    with `RUNTIME_CLEANUP_CONCURRENCY = 2`. This preserves the reset pathway
    while preventing runtime recovery from launching every unregister/delete
    operation at once. Admin shell/media guards and frontend utility tests
    cover the change.
304. Serialize runtime cache prefix invalidation. Done:
    `backend/src/runtimeCache.ts` now uses `deletePrefixesInOrder()` when a
    write invalidates several cache namespaces. This keeps Redis invalidation
    from running multiple `SCAN`/`DEL` prefix walks at once during product,
    inventory, settings, sales, returns, or customer write bursts. Backend
    runtime-cache tests guard the pathway.
305. Index lookup-manager bulk delete snapshots. Done:
    `frontend/src/components/products/lookups/ManageCategoriesModal.tsx` and
    `ManageUnitsModal.tsx` now build stable id maps for category/unit rows and
    reuse them for single and bulk delete snapshots. This removes repeated
    `find()` scans from bulk lookup cleanup while preserving undo/redo
    behavior and expected-updated-at guards.
306. Index brand lookup bulk delete impact. Done:
    `frontend/src/components/products/lookups/ManageBrandsModal.tsx` now builds
    `brandsByLookup` once per render and uses it to calculate selected-brand
    usage impact before delete confirmation. This removes repeated full-list
    filtering from bulk brand cleanup and keeps the three lookup managers
    aligned on indexed selection paths.
307. Index POS cart product and branch lookups. Done:
    `frontend/src/components/pos/POS.tsx` now reuses `productsById` for cart
    quantity validation, branch changes, and detail opening, and builds
    `branchesById` for branch-name error messages. This keeps the checkout path
    on stable indexed references without moving POS files or changing cart-line
    identity.
308. Index inventory branch labels and product summary lookups. Done:
    `frontend/src/components/inventory/Inventory.tsx` now builds `branchesById`
    and `summaryById` maps once, then routes RFID labels, export metadata,
    branch comparison rows, adjustment snapshots, and movement product detail
    opening through those indexes. This improves repeated inventory operations
    without moving inventory modules or changing data flows.
309. Index product page branch moves and fresh history snapshots. Done:
    `frontend/src/components/products/Products.tsx` now builds `branchesById`
    for bulk branch-change target resolution and indexes freshly fetched
    product snapshots before save/variant undo history entries are created.
    This keeps product write flows aligned with the id-map strategy used in POS
    and Inventory. The Phase 29 repeat audit was also tightened so generated
    dist-manifest presence stays reported but no longer creates false drift in
    stable runtime-version source-wiring comparisons.
310. Index inventory transfer branch defaults. Done:
    `frontend/src/components/inventory/Inventory.tsx` now precomputes
    `defaultTransferDestinationBySourceId` once per branch list and resolves
    submitted transfer branches through `branchesById`. This keeps single and
    batch transfer setup on the same indexed branch pathway without moving UI
    modules.
311. Make inventory return stats single-pass. Done:
    `frontend/src/components/inventory/Inventory.tsx` now aggregates customer
    returns, supplier returns, refunds, restock count, and returned item
    quantities through one accumulator pass after the bounded stats loader
    resolves. This is a loop cleanup only; no schema, folder, or runtime
    language move was needed.
312. Index inventory adjustment branch stock per submit. Done:
    `frontend/src/components/inventory/Inventory.tsx` now builds
    `selectedBranchStockById` for the selected adjustment product and reuses the
    resolved row for undo quantity capture and remove-stock validation. This is
    another local hot-path cleanup with no module move or language conversion.
313. Make Inventory visible stats single-pass. Done:
    `frontend/src/components/inventory/Inventory.tsx` now builds one memoized
    `visibleInventoryStats` accumulator for visible stock value, stock-state
    counts, sold quantity, revenue, COGS, and discount fallbacks. This keeps the
    stat-card render path linear and local; no folder move, source deletion, or
    language conversion was justified.
314. Index backend inventory active branches per request. Done:
    `backend/src/routes/inventory.ts` now builds one `activeBranchIndex` map
    from loaded active branches and reuses it in inventory adjustment and
    product-row move flows. This removes repeated branch scans from stock write
    pathways while keeping the existing Node/SQL route structure; no folder move
    or runtime conversion was needed.
315. Index product-import branches by normalized name per job. Done:
    `backend/src/services/importJobs.ts` now keeps a `branchesByName` map in the
    product import context and updates it when imported rows create new
    branches. This is a hot-path import optimization only; no schema migration,
    folder move, or language conversion was justified.
316. Make bulk product-import conflict summaries single-pass. Done:
    `frontend/src/components/products/import/BulkImportModal.tsx` now computes
    review badge counts in one `conflictGroups` accumulator loop instead of
    repeatedly filtering the conflict list. This is a local UI workflow
    optimization; no folder move or language conversion was needed.
317. Precompute Inventory visible product IDs. Done:
    `frontend/src/components/inventory/Inventory.tsx` now memoizes
    `visibleInventoryProductIds` once from the visible product list and reuses
    it for selection cleanup, select-all, and the reveal signature. This trims
    repeated list walks in the Inventory selection pathway; no folder move or
    language conversion was needed.
318. Centralize Inventory selection-scope ID normalization. Done:
    `frontend/src/components/inventory/Inventory.tsx` now uses
    `normalizeFiniteIds()` for section/group selection checks and toggles. This
    removes repeated `ids.map(...).filter(...)` normalization in the selection
    workflow; no folder move or language conversion was needed.
319. Remove Inventory active-filter count allocations. Done:
    `frontend/src/components/inventory/Inventory.tsx` now uses
    `countActiveFlags()` for RFID, movement, and product filter badge counts
    instead of allocating short arrays only to call `.filter(Boolean).length`.
    This is a local render-path cleanup; no folder move or language conversion
    was needed.
320. Reuse Inventory selection helpers for partial counts and retries. Done:
    `frontend/src/components/inventory/Inventory.tsx` now shares
    `normalizeFiniteIdsFrom()` and `countSelectedIds()` across selection-scope
    checks, toggles, and batch failure recovery. This removes the remaining
    filtered selected-ID allocation and one-off failed-item ID normalization
    path; no folder move or language conversion was needed.
321. Remove Inventory destination-selector filter allocations. Done:
    `frontend/src/components/inventory/Inventory.tsx` now uses
    `renderDestinationProductOptions()` for single and batch move destination
    dropdowns. The helper skips the excluded product inline while mapping
    options, replacing render-time `summary.filter(...).map(...)` allocation;
    no folder move or language conversion was needed.
322. Harden public Cloudflare portal CSP verification. Done:
    `ops/scripts/runtime/live-checks/phase84-public-portal-cloudflare-check.ts`
    now distinguishes app-origin report-only CSP regressions from Cloudflare's
    intermittent Page Shield `cdn-cgi/script_monitor` diagnostic header.
    `backend/test/fullAutomation.test.ts` guards the behavior; no folder move
    or language conversion was needed.
323. Reuse Sales selection and filter-count helpers. Done:
    `frontend/src/components/sales/Sales.tsx` now precomputes visible sale IDs,
    normalizes grouped selection IDs through one helper, counts selected IDs
    with a direct loop, and counts active filters without a temporary boolean
    array. This is a local render/selection-path cleanup; no folder move or
    language conversion was needed.
324. Compact admin page-title information and reduce Docker worker replicas.
    Done:
    `frontend/src/components/shared/PageHeader.tsx` now places page information
    on the title hover state instead of rendering a separate info button.
    Branches, Audit Log, Receipt Settings, Backup, Settings, Library, and Sync
    Server were verified with Playwright for title-hover information and no
    visible description rows. Docker release/start defaults now run one import
    worker and one media worker by default, so the runtime no longer starts
    duplicate worker pairs. This was a UI/runtime hygiene move only; no schema
    rewrite, source deletion, or language conversion was justified.
325. Stabilize Products/POS mid-width layout and classify browser noise.
    Done:
    Products desktop tables now keep a stable minimum width and scroll
    horizontally inside their table surface instead of collapsing price, stock,
    status, and product-name columns together. POS now keeps the product and
    cart panes at stable desktop widths inside a horizontally scrollable
    workspace, so medium screens can pan instead of forcing cards and cart
    controls to compress. Clean Playwright verification showed no first-party
    console errors; the reported `content.js`/`Grammarly-check.js`/extension
    `vendor.js` noise is extension injection colliding with strict CSP, so no
    source folder move, language conversion, or CSP weakening was justified.
    The Docker release image was rebuilt and restarted, public/admin Cloudflare
    health recovered, and the regenerated ignored `release` kit was deleted as
    reproducible generated bulk.
326. Refine POS product-card responsive breakpoints.
    Done:
    `frontend/src/styles/main.css` now uses larger POS product-card minimum
    widths so small phones and normal phones stay at two readable card columns,
    tablets step up to three or four columns, and the grid does not auto-fit
    cramped three-column phone layouts. This is a CSS layout correction only;
    no component folder move, runtime conversion, or source deletion was
    needed. Playwright verified 360, 390, 430, 640, and 760 px POS widths with
    no first-party console errors and successful product-card interaction.
327. Prune obsolete Docker app versions and reproducible builder cache. Done:
    unused `business-os:v6.0.0-202605261501` and
    `business-os:v6.0.0-202605260636` image tags were removed after confirming
    the running containers and `business-os:latest` use
    `business-os:v6.0.0-202605261656`. Docker builder cache was pruned as
    reproducible generated bulk, reclaiming 4.082 GB. This was a runtime
    cleanup move only; Docker volumes, uploads, runtime secrets, `.env` files,
    backup packages, source folders, and language/runtime choices were not
    changed.
328. Optimize schema primary-key preflight and close the related runtime
    candidate. Done:
    `ops/scripts/backend/schema-primary-key-preflight.ts` now folds repeated
    row/null counts, duplicate-group counts, and unique-index discovery into
    shared CTEs reused by the JSON report. The before/after live report values
    matched exactly, and a same-container timing sample improved from
    832.9475 ms to 771.5196 ms. The language/runtime audit now records this as
    a completed data-path optimization and keeps
    `ops/scripts/backend/schema-primary-key-rollback.sql` as rollback DDL, not
    a conversion target. No folder move or language conversion was needed.
329. Reuse Products positive-ID normalization and direct-loop selection helpers.
    Done:
    `frontend/src/components/products/helpers/productSelectionHelpers.ts` now
    provides `normalizePositiveProductIds()` and replaces chained map/filter
    helper internals with direct loops. `frontend/src/components/products/Products.tsx`
    uses the helper for bulk delete redo, bulk out-of-stock redo, and bulk
    add-stock success/failure ID normalization. This was a localized
    render/action bookkeeping cleanup; no folder move or language conversion
    was needed.
330. Tighten POS core product lookup and visible-card construction. Done:
    `frontend/src/components/pos/posCore.ts` now builds product lookups and
    visible POS cards with direct loops, skipping invalid product IDs and
    avoiding the transient map/filter arrays previously used in these shared
    checkout helpers. `frontend/tests/posCore.test.ts` covers the invalid-ID
    lookup guard. This was a local TypeScript helper cleanup; no folder move or
    runtime conversion was needed.
331. Remove import-service chained normalization allocations. Done:
    `backend/src/services/importJobs.ts` now uses direct loops for import job
    type filtering, duplicate-group counting, image-list parsing, setting
    option parsing, and cancel-wait job ID normalization. This was a backend
    data-flow cleanup only; no folder move, schema migration, or runtime
    conversion was needed.
332. Reuse product-route ID and token normalization helpers. Done:
    `backend/src/routes/products.ts` now shares direct-loop helpers for
    positive ID collection and comma-token normalization across image map
    loading, product search filters, include parsing, branch-stock hydration,
    lookup replacement, and import image reference parsing. This was a
    localized backend route cleanup; no folder move, schema migration, or
    runtime conversion was needed.
333. Reuse settings conflict attempted-payload construction. Done:
    `frontend/src/api/methods.ts` now builds settings conflict attempted values
    through `buildAttemptedSettings()` and a shared conflict metadata-key set
    instead of an inline `Object.entries(...).filter(...)` chain inside
    `saveSettings()`. This is a shared API-path cleanup only; no source folder
    move, schema migration, or runtime conversion was needed.
334. Tighten shared API query and import-image upload loops. Done:
    `frontend/src/api/methods.ts` now builds shared query strings with direct
    key iteration and prepares import image browser-file/relative-path lists
    with direct loops. This keeps API URL and upload payload behavior stable
    while removing small repeated allocation chains from common read and import
    paths. No folder move, schema migration, or runtime conversion was needed.
335. Tighten upload, offline queue, and return conflict API loops. Done:
    `frontend/src/api/methods.ts` now applies XHR upload headers with direct
    key iteration, collects eligible offline sale queue rows in one pass before
    sorting, and builds return conflict attempted-item snapshots through
    `buildAttemptedReturnItems()`. This was a shared API-path cleanup only; no
    folder move, schema migration, or runtime conversion was needed.
336. Centralize shared sync-update and mirror serialization loops. Done:
    `frontend/src/api/methods.ts` now reuses named sync-update channel lists
    through `dispatchSyncUpdates()`, builds pending sync previews through a
    bounded direct-loop serializer, and clones local mirror rows with a direct
    loop before replacing table contents. This was another shared API-path
    cleanup only; no folder move, schema migration, or runtime conversion was
    needed.
337. Reuse backend inventory reason and search normalization loops. Done:
    `backend/src/routes/inventory.ts` now normalizes saved inventory reasons
    through one direct-loop helper and splits inventory search terms with a
    bounded direct loop. This was a backend route cleanup only; no folder move,
    schema migration, or runtime conversion was needed.
338. Make backend inventory product hydration single-pass. Done:
    `backend/src/routes/inventory.ts` now parses inventory product branch-stock
    JSON and collects product IDs in one pass before attaching batch rows. This
    was a backend route cleanup only; no folder move, schema migration, or
    runtime conversion was needed.
339. Consolidate backend stock-adjustment allocation movement loops. Done:
    `backend/src/routes/inventory.ts` now uses
    `appendAllocationMovementEntries()` for remove/set stock allocation
    movement rows and a direct insertion loop for movement persistence. This
    was a backend route cleanup only; no folder move, schema migration, or
    runtime conversion was needed.
340. Tighten backend inventory transfer insertion loops. Done:
    `backend/src/routes/inventory.ts` now applies transferred batch
    allocations and writes transfer movement pairs with direct loops, and
    `buildInsertColumnSql()` builds dynamic insert columns/placeholders in one
    helper. This was a backend route cleanup only; no folder move, schema
    migration, or runtime conversion was needed.
341. Tighten backend inventory row-move movement construction. Done:
    `backend/src/routes/inventory.ts` now writes row-move source and
    destination allocation movement rows with direct loops and precomputed
    source/destination unit-cost fallbacks. This was a backend route cleanup
    only; no folder move, schema migration, or runtime conversion was needed.
342. Tighten backend RFID transaction loops. Done:
    `backend/src/routes/inventory.ts` now records RFID events and applies RFID
    present-row stock updates with direct transaction loops, while precomputing
    purchase-price movement totals per product row. This was a backend route
    cleanup only; no folder move, schema migration, or runtime conversion was
    needed.
343. Tighten backend inventory product list assembly loops. Done:
    `backend/src/routes/inventory.ts` now collects family root IDs, merges
    family/base product rows, sanitizes hydrated rows, and extracts brand
    filters with direct loops. This was a backend route cleanup only; no folder
    move, schema migration, or runtime conversion was needed.
344. Complete backend inventory route array-chain cleanup. Done:
    `backend/src/routes/inventory.ts` now builds product-filter clauses,
    movement-search clauses, and summary branch-stock payloads with direct
    loops instead of array `map()` chains. This was a backend route cleanup
    only; no folder move, schema migration, or runtime conversion was needed.
345. Tighten shared backend product image and branch-stock helper loops. Done:
    `backend/src/routes/products.ts` now seeds branch-stock rows, persists
    product image galleries, loads image maps, and attaches gallery payloads
    with direct loops. This was a backend route cleanup only; no folder move,
    schema migration, or runtime conversion was needed.
346. Tighten backend product lookup metadata assembly loops. Done:
    `backend/src/routes/products.ts` now parses brand options, builds lookup
    usage entries, collects sample products, and prepares brand/category/unit
    rows with direct loops. This was a backend route cleanup only; no folder
    move, schema migration, or runtime conversion was needed.
347. Tighten backend product search filter and branch-stock attachment loops.
    Done: `backend/src/routes/products.ts` now builds product ID bindings,
    search clauses, lookup filters, metadata distinct values, branch-stock
    placeholders, branch-stock groups, and branch-stock response payloads with
    direct loops. This was a backend route cleanup only; no folder move, schema
    migration, or runtime conversion was needed.
348. Tighten backend product family expansion and search response loops. Done:
    `backend/src/routes/products.ts` now filters family sources, scans family
    rows, binds family SQL values, parses paged rows, collects batch IDs, and
    attaches batch payloads with direct loops. This was a backend route cleanup
    only; no folder move, schema migration, or runtime conversion was needed.
349. Tighten backend product lookup replacement and legacy list response
    loops. Done: `backend/src/routes/products.ts` now builds lookup
    replacement placeholders, parses legacy product list rows, collects batch
    lookup IDs, and assembles product/batch payloads with direct loops. This
    was a backend route cleanup only; no folder move, schema migration, or
    runtime conversion was needed.
350. Tighten backend product edit stock adjustment movement loops. Done:
    `backend/src/routes/products.ts` now processes manual stock reduction
    allocations and inventory movement inserts with direct loops and
    precomputed product/cost values. This was a backend route cleanup only; no
    folder move, schema migration, or runtime conversion was needed.
351. Apply guarded runtime report and Docker safe-prune cleanup. Done:
    `ops/scripts/runtime/storage/prune-storage.ts` removed three old Phase
    8.4 report folders after a preview and postcheck, freeing 703,101 bytes.
    Business data, uploads, secrets, backups, Docker images, and Docker volumes
    were preserved. This was a retention cleanup only; no folder move, schema
    migration, or runtime conversion was needed.
352. Tighten backend product bulk-import setup loops. Done:
    `backend/src/routes/products.ts` now counts legacy image payload bytes,
    matches image-only imports, and builds category, unit, and brand lookup
    maps with direct loops instead of allocation-heavy callback chains. This
    was a backend route cleanup only; no folder move, schema migration, or
    runtime conversion was needed.
353. Tighten backend product bulk-import image and batch reset loops. Done:
    `backend/src/routes/products.ts` now builds batch reset placeholders,
    parses import image references, loads current image galleries, collects
    resolved import images, seeds new-product branch stock, and cleans imported
    brand options with direct loops. This was a backend route cleanup only; no
    folder move, schema migration, or runtime conversion was needed.
354. Tighten backend product import signature and sales checkout loops. Done:
    `backend/src/routes/products.ts` now builds product import signatures with
    a direct loop, and `backend/src/routes/sales.ts` now normalizes checkout
    branch context, sale items, product metadata lookup, batch migration, and
    allocation/movement writes with direct loops. This was a backend route
    cleanup only; no folder move, schema migration, or runtime conversion was
    needed.
355. Tighten backend sales status-transition and list-response loops. Done:
    `backend/src/routes/sales.ts` now writes status-transition batch
    allocations/restores and inventory movements with direct loops, and builds
    sales search tokens plus response payloads without callback chains. This
    was a backend route cleanup only; no folder move, schema migration, or
    runtime conversion was needed.
356. Tighten backend sales export/report loops. Done:
    `backend/src/routes/sales.ts` now hydrates export rows, computes item COGS,
    accumulates completed-sale accounting totals, builds sales-detail payloads,
    and writes CSV rows/summary lines with direct loops. This was a backend
    route cleanup only; no folder move, schema migration, or runtime conversion
    was needed.
357. Tighten backend returns stock-flow loops. Done:
    `backend/src/routes/returns.ts` now builds returns search/items payloads,
    product metadata maps, supplier totals/lookups, return allocation
    movements, edit reversals/restocks, and sale return-status recalculation
    with direct loops. This was a backend route cleanup only; no folder move,
    schema migration, or runtime conversion was needed.
358. Tighten backend custom-table dynamic SQL loops. Done:
    `backend/src/routes/customTables.ts` now normalizes schemas, builds custom
    table payloads, DDL columns, insert columns/placeholders/values, and update
    set/value lists with direct loops and one shared ignored-field set. This
    was a backend route cleanup only; no folder move, schema migration, or
    runtime conversion was needed.
359. Tighten backend settings save loops. Done:
    `backend/src/routes/settings.ts` now normalizes brand settings, builds
    settings snapshots, extracts attempted settings, upserts settings, and
    reports audit keys with direct loops plus one shared metadata-key set.
    This was a backend route cleanup only; no folder move, schema migration,
    or runtime conversion was needed.
360. Tighten owned Google OAuth and integration doctor origin loops. Done:
    `backend/src/services/googleOauth.ts` now builds normalized origin and
    callback URI lists with direct loops, and
    `backend/src/services/integrationDoctor.ts` reuses that login callback
    helper while discovering verified release-backup folders with direct
    iteration. This was a backend service cleanup only; no folder move, schema
    migration, or runtime conversion was needed.
361. Tighten public catalog payload loops. Done:
    `backend/src/routes/catalog.ts` now collects product IDs, builds image SQL
    placeholders, groups image rows, and assembles catalog product payloads
    with direct loops and small named helpers. This was a backend route cleanup
    only; no folder move, schema migration, or runtime conversion was needed.
362. Tighten action history and user list response loops. Done:
    `backend/src/routes/actionHistory.ts` and `backend/src/routes/users.ts`
    now serialize action-history rows and sanitize user list rows with
    direct-loop helper functions instead of endpoint `rows.map(...)` calls.
    This was a backend route cleanup only; no folder move, schema migration,
    or runtime conversion was needed.
363. Tighten notification summary loops. Done:
    `backend/src/routes/notifications.ts` now builds notification settings
    placeholders, settings maps, inventory alert items, expiry alert items and
    counts, and unread counts with direct loops and named helpers. Existing
    mojibake summary separator strings were left untouched to avoid accidental
    re-encoding. This was a backend route cleanup only; no folder move, schema
    migration, or runtime conversion was needed.
364. Tighten notification loyalty loops. Done:
    `backend/src/routes/notifications.ts` now builds loyalty customer aggregate
    maps, threshold matches, and capped loyalty item payloads with direct
    loops while preserving point policy math and sorting. This was a backend
    route cleanup only; no folder move, schema migration, or runtime
    conversion was needed.
365. Tighten notification sales and portal item loops. Done:
    `backend/src/routes/notifications.ts` now builds awaiting-payment,
    awaiting-delivery, and pending portal submission notification item payloads
    with direct-loop helpers. This was a backend route cleanup only; no folder
    move, schema migration, or runtime conversion was needed.
366. Tighten notification summary separator loops. Done:
    `backend/src/routes/notifications.ts` now uses one notification separator
    constant and one direct-loop summary join helper for inventory, expiry,
    and sales summaries, and sales/portal metadata use the same separator.
    This was a backend route cleanup only; no folder move, schema migration,
    or runtime conversion was needed.
367. Tighten portal AI candidate and provider loops. Done:
    `backend/src/services/portalAi.ts` now uses direct-loop helpers for token
    parsing, visitor timestamp pruning, candidate filtering/scoring, assistant
    recommendation normalization, provider usage summaries, and provider
    failover selection. This was a backend service cleanup only; no folder
    move, schema migration, or runtime conversion was needed.
368. Tighten Google Drive sync version-retention loops. Done:
    `backend/src/services/googleDriveSync/versioning.ts` now normalizes Drive
    sync version rows and selects date-expired versions with direct-loop
    helpers while preserving timestamp-first retention and version-number
    fallback behavior. This was a backend service cleanup only; no folder move,
    schema migration, or runtime conversion was needed.
369. Tighten main Google Drive sync service loops. Done:
    `backend/src/services/googleDriveSync/index.ts` now uses direct-loop
    helpers for settings reads/writes, sync-entry maps, multi-hash streaming,
    fetch error detail joining, snapshot directory lists, duplicate sibling
    filtering, live path sets, and stale mapping selection. This was a backend
    service cleanup only; no folder move, schema migration, or runtime
    conversion was needed.
370. Tighten backup package retention and listing loops. Done:
    `backend/src/services/backupPackages.ts` now uses direct-loop helpers for
    cache cloning, object manifests, local backup directory discovery,
    retention planning, local/R2 removal summaries, local version listing, R2
    object aggregation, and final version sorting. This was a backend service
    cleanup only; no folder move, schema migration, or runtime conversion was
    needed.
371. Tighten AI provider gateway and route loops. Done:
    `backend/src/services/aiGateway.ts` and `backend/src/routes/ai.ts` now use
    direct-loop helpers for supported-model normalization, Google message
    payloads, Google text joining, provider list serialization, and AI response
    log serialization. This was a backend service/route cleanup only; no
    folder move, schema migration, or runtime conversion was needed.
372. Tighten branch stock integrity and transfer loops. Done:
    `backend/src/routes/branches.ts` now uses direct-loop helpers for stock
    integrity preview payloads, total quantity calculation, repair stock
    updates, touched-product recalculation, and dynamic transfer insert SQL.
    This was a backend route cleanup only; no folder move, schema migration,
    or runtime conversion was needed.
373. Tighten runtime catalog-integrity diagnostics loops. Done:
    `backend/src/routes/runtime.ts` now uses direct-loop helpers for product
    field counting, suspicious product sampling, and bounded brand-option
    suspicious-text sampling. This was a backend route cleanup only; no folder
    move, schema migration, or runtime conversion was needed.
374. Tighten offline sync digest and normalization loops. Done:
    `backend/src/routes/sync.ts` now uses explicit ordered loops for stable
    payload stringification and one direct-loop helper for outbox operation
    normalization. This was a backend route cleanup only; no folder move,
    schema migration, or runtime conversion was needed.
375. Convert import-job refresh helper to TypeScript. Done:
    `frontend/src/utils/importJobRefresh.ts` now owns the typed refresh-channel
    and `sync:update` event dispatch logic, while
    `frontend/src/utils/importJobRefresh.js` stays as the compatibility wrapper
    for existing imports. This was a frontend utility conversion only; no
    folder move, backend runtime change, Python/Rust/Go runtime, or schema
    migration was needed.
376. Add guarded stale host Node process cleanup. Done:
    `ops/scripts/powershell/clear-stale-node-processes.ps1` now previews or
    applies cleanup for known stale external Node runners while protecting the
    Business OS workspace by default. `ops/package.json` exposes
    `cleanup-node-processes:preview`, `cleanup-node-processes`, and
    `cleanup-node-processes:codex`. This was an ops cleanup helper only; no
    source folder move, backend runtime change, schema migration, or Docker
    container deletion was needed.
377. Exclude cleanup launcher Node from stale-process reports. Done:
    `ops/scripts/powershell/clear-stale-node-processes.ps1` now excludes its
    own PowerShell/npm launcher ancestry from external Node counts, so preview
    reports do not show the helper's short-lived npm process as a leftover
    background Node. This was an ops reporting fix only; no source folder move,
    backend runtime change, schema migration, or Docker container deletion was
    needed.
378. Tighten auth bootstrap settings snapshot loop. Done:
    `backend/src/routes/auth.ts` now builds the bootstrap settings snapshot
    with a direct loop instead of a callback chain while preserving the
    sanitized settings payload and existing OAuth callback behavior. This was a
    backend route cleanup only; no folder move, schema migration, or runtime
    conversion was needed.
379. Tighten contacts point-policy settings loop. Done:
    `backend/src/routes/contacts.ts` now builds the point-policy settings map
    with a direct loop instead of a callback chain while preserving customer
    point policy defaults and summary behavior. This was a backend route
    cleanup only; no folder move, schema migration, or runtime conversion was
    needed.
380. Tighten customer portal config normalization loops. Done:
    `backend/src/routes/portal.ts` now normalizes FAQ items, portal translation
    blocks, recommended product IDs, and settings rows with direct loops while
    preserving the public portal config contract. This was a backend route
    cleanup only; no folder move, schema migration, or runtime conversion was
    needed.
381. Tighten customer portal product materialization loops. Done:
    `backend/src/routes/portal.ts` now uses named direct-loop helpers for
    portal product ID collection, SQL placeholder construction, image/branch
    asset maps, and final payload list decoration. This was a backend route and
    regression-test cleanup only; no folder move, schema migration, or runtime
    conversion was needed.
382. Tighten customer portal loyalty point summary loops. Done:
    `backend/src/routes/portal.ts` now summarizes earned, deducted, redeemed,
    and rewarded portal points with direct loops instead of filtered/reduced
    callback chains. This was a backend route cleanup only; no folder move,
    schema migration, or runtime conversion was needed.
383. Tighten customer portal catalog search/filter parsing loops. Done:
    `backend/src/routes/portal.ts` now parses search terms, filter values,
    branch IDs, named placeholders, brand/category filters, and stock states
    with direct-loop helpers while preserving the public catalog query
    contract. This was a backend route cleanup only; no folder move, schema
    migration, or runtime conversion was needed.
384. Tighten customer portal catalog metadata loops. Done:
    `backend/src/routes/portal.ts` now extracts distinct metadata rows,
    normalizes persisted brand options, and de-duplicates merged brands with
    direct-loop helpers while preserving catalog metadata output. This was a
    backend route cleanup only; no folder move, schema migration, or runtime
    conversion was needed.
385. Tighten customer portal membership/submission response loops. Done:
    `backend/src/routes/portal.ts` now wraps membership SQL clauses, normalizes
    share-submission screenshot rows, and summarizes membership totals with
    direct-loop helpers while preserving the public membership and review
    response contracts. This was a backend route and regression-test cleanup
    only; no folder move, schema migration, or runtime conversion was needed.
386. Tighten customer portal screenshot and AI citation loops. Done:
    `backend/src/routes/portal.ts` now sanitizes portal submission screenshots
    and collects AI recommendation citations with bounded direct-loop helpers
    while preserving media safety checks and AI response/log payloads. This was
    a backend route cleanup only; no folder move, schema migration, or runtime
    conversion was needed.
387. Tighten customer portal product signal ranking loops. Done:
    `backend/src/routes/portal.ts` now builds portal product rank maps, net
    sale/return signal rows, new-arrival ranks, and recommended-product ranks
    with named direct-loop helpers while preserving catalog badge behavior.
    This was a backend route cleanup only; no folder move, schema migration, or
    runtime conversion was needed.
388. Tighten import job route wrapper loops. Done:
    `backend/src/routes/importJobs.ts` now resolves permitted import types,
    serializes import job files, and saves multi-image upload records with
    named direct-loop helpers while preserving permission behavior, response
    fields, and upload order. This was a backend route cleanup only; no folder
    move, schema migration, or runtime conversion was needed.
389. Tighten import job service list/update loops. Done:
    `backend/src/services/importJobs.ts` now lists decorated import jobs and
    builds import-job update assignments with direct helper loops while
    preserving type filtering, pagination limits, and allowed patch fields.
    This was a backend service cleanup only; no folder move, schema migration,
    or runtime conversion was needed.
390. Tighten import image-reference and product-gallery loops. Done:
    `backend/src/services/importJobs.ts` now collects incoming image references,
    de-duplicates product galleries, inserts gallery rows, and loads current
    galleries with direct bounded loops while preserving the five-image cap and
    upload path normalization. This was a backend import/media cleanup only; no
    folder move, schema migration, or runtime conversion was needed.
391. Tighten import product review grouping loops. Done:
    `backend/src/services/importJobs.ts` now finalizes duplicate-name import
    review groups and subgroups with direct-loop helpers while preserving row
    ordering, field/issue payloads, existing matches, and suggested actions.
    This was a backend import-review cleanup only; no folder move, schema
    migration, or runtime conversion was needed.
392. Tighten import review decision and label loops. Done:
    `backend/src/services/importJobs.ts` now builds conflict labels, checks
    identifier filters, detects generic empty rows, copies review decision
    fields, applies field overrides, and serializes product signatures with
    named direct-loop helpers. This was a backend import-review cleanup only;
    no folder move, schema migration, or runtime conversion was needed.
393. Tighten import review count and group-decision loops. Done:
    `backend/src/services/importJobs.ts` now accumulates review conflict counts
    and normalizes group decisions with named direct-loop helpers while
    preserving count keys, pagination behavior, merge order, and policy
    persistence. This was a backend import-review cleanup only; no folder move,
    schema migration, or runtime conversion was needed.
394. Tighten import product parent and lookup-map helpers. Done:
    `backend/src/services/importJobs.ts` now picks parent products in one pass,
    builds settings option maps without array-map constructors, and shares a
    direct lookup-map helper for product import category, unit, supplier, and
    branch indexes. This was a backend import/product cleanup only; no folder
    move, schema migration, or runtime conversion was needed.
395. Tighten import product row-cache ordering. Done:
    `backend/src/services/importJobs.ts` now updates same-name product cache
    rows with ordered insertion instead of filter-then-sort, preserving product
    import ordering and cache behavior. This was a backend import/product
    cleanup only; no folder move, schema migration, or runtime conversion was
    needed.
396. Tighten import branch-batch stock cleanup. Done:
    `backend/src/services/importJobs.ts` now shares direct-loop batch ID
    collection and branch-batch stock zeroing for replacement imports while
    preserving stock rollups and batch increase behavior. This was a backend
    import/stock cleanup only; no folder move, schema migration, or runtime
    conversion was needed.
397. Tighten import cancellation placeholder and ID loops. Done:
    `backend/src/services/importJobs.ts` now reuses shared SQL placeholder and
    row-ID helpers for cancellable-job queries, wait polling, cancel-all
    updates, import file cancellation, and delete-all job ID collection. This
    was a backend import-cancellation cleanup only; no folder move, schema
    migration, or runtime conversion was needed.
398. Reconcile stale plan wording and tighten import lookup helpers. Done:
    `ops/docs/OPTIMIZATION-ROADMAP.md`,
    `ops/docs/FILE-ORGANIZATION-LANGUAGE-PLAN.md`, and
    `ops/docs/SCHEMA-RELATIONSHIPS.md` now preserve the current plan position:
    Phase 8.4 active, Phase 26 at 51 completed moves, Phase 28 active with R2
    prune follow-up, and Phase 29 active as the recurring guardrail after its
    first baseline. `backend/src/services/importJobs.ts` now builds image
    lookups and inventory/sales CSV lookup maps with named direct-loop helpers
    instead of temporary arrays and callback chains. This was a documentation
    cleanup plus backend import-service optimization only; no source folder
    move, schema migration, or language conversion was needed.
399. Tighten import error CSV export. Done:
    `backend/src/services/importJobs.ts` now builds error CSV output with a
    direct row helper instead of nested `map()` chains and spread
    materialization. This preserves the export header, UTF-8 BOM, quote
    escaping, row limit, row ordering, and download contract. This was a
    backend import/export cleanup only; no folder move, schema migration, or
    language conversion was needed.
400. Tighten import product signature and ZIP-file selection callbacks. Done:
    `backend/src/services/importJobs.ts` now shares
    `findProductWithSignature()` for same-name product signature matching in
    review, preflight, and apply paths, and `getUnprocessedJobFiles()` for ZIP
    extraction selection. This preserves signature equality, imported
    signature fallback, merge-target validation, conflict classification, ZIP
    processed-file skipping, and queue behavior. This was a backend
    import-service cleanup only; no folder move, schema migration, or language
    conversion was needed.
401. Clear final import-service callback chain. Done:
    `backend/src/services/importJobs.ts` now uses
    `buildSafeCatalogOptionList()` for brand-option cleanup after product
    imports, preserving text normalization, blank filtering, suspicious catalog
    text rejection, and `normalizeOptionList()` de-duplication. A callback
    scan now reports no `map()`, `filter()`, `forEach()`, `reduce()`, `find()`,
    or `Array.from()` hits in the import service. This was a backend
    import-service cleanup only; no folder move, schema migration, or language
    conversion was needed.
402. Tighten product-route branch and sorted-map helpers. Done:
    `backend/src/routes/products.ts` now shares direct-loop helpers for default
    branch selection, branch-by-id lookup, branch-by-name lookup, bounded set
    materialization, sorted map values, and import same-detail product
    matching. A callback scan now reports no `map()`, `filter()`, `forEach()`,
    `reduce()`, `find()`, or `Array.from()` hits in the product route. This
    was a backend product-route cleanup only; no folder move, schema migration,
    or language conversion was needed.
403. Tighten inventory product family expansion helpers. Done:
    `backend/src/routes/inventory.ts` now shares direct-loop helpers for
    family root ID collection, merged family-row sorting, and inventory product
    row comparison. A callback scan now reports no `map()`, `filter()`,
    `forEach()`, `reduce()`, `find()`, or `Array.from()` hits in the inventory
    route. This was a backend inventory-route cleanup only; no folder move,
    schema migration, or language conversion was needed.
404. Tighten sale stock availability sampling. Done:
    `backend/src/routes/sales.ts` now uses `findSaleItemForProduct()` for the
    insufficient-stock error sample instead of an inline `find()` callback.
    A callback scan now reports no `map()`, `filter()`, `forEach()`,
    `reduce()`, `find()`, or `Array.from()` hits in the sales route. This was
    a backend sales-route cleanup only; no folder move, schema migration, or
    language conversion was needed.
405. Tighten contact import, search, scoped-ID, and point-summary helpers.
    Done: `backend/src/routes/contacts.ts` now shares direct-loop helpers for
    provided import row shaping, searchable-field haystacks, scoped customer
    ID parsing, point-summary scope placeholders, customer row maps, point
    summary defaults, and response decoration. A callback scan now reports no
    `map()`, `filter()`, `forEach()`, `reduce()`, `find()`, `flatMap()`, or
    `Array.from()` hits in the contacts route. This was a backend
    contacts-route cleanup only; no folder move, schema migration, or language
    conversion was needed.
406. Tighten auth/user selection helpers. Done: `backend/src/routes/auth.ts`
    now selects the first valid password-reset redirect through
    `findFirstHttpUrl()`, and `backend/src/routes/users.ts` now selects UUID
    candidates and linked provider identities through direct-loop helpers. A
    callback scan now reports no `map()`, `filter()`, `forEach()`, `reduce()`,
    `find()`, `flatMap()`, or `Array.from()` hits in the auth or users routes.
    This was a backend auth/users-route cleanup only; no folder move, schema
    migration, or language conversion was needed.
407. Clear backend route callback-chain scan. Done:
    `backend/src/routes/system/index.ts` now uses named direct-loop helpers for
    import-stop ID messages, migration counts, settings reads/writes, row
    totals, custom-table discovery, reset/factory-reset broadcasts, sync push
    response shaping, integrity repair broadcasts, folder roots, visible
    directories, and picker script assembly. A callback scan now reports no
    `map()`, `filter()`, `forEach()`, `reduce()`, `find()`, `flatMap()`, or
    `Array.from()` hits anywhere under `backend/src/routes`. This was a
    backend system-route cleanup only; no folder move, schema migration, or
    language conversion was needed.
408. Clear backend service callback-chain scan. Done:
    `backend/src/services/backupPackages.ts` now uses direct helpers for
    writable waiters, object-copy worker promises, grouped remote package
    values, and backup-version sorting inputs, while
    `backend/src/services/googleDriveSync/index.ts` uses a direct reusable
    non-folder sibling selector. A callback scan now reports no `map()`,
    `filter()`, `forEach()`, `reduce()`, `find()`, `flatMap()`, or
    `Array.from()` hits anywhere under `backend/src/services`. This was a
    backend service cleanup only; no folder move, schema migration, or language
    conversion was needed.
409. Tighten backup summary and catalog text utility loops. Done:
    `backend/src/backupSchema.ts` now counts backup rows and totals with
    direct loops, and `backend/src/catalogTextIntegrity.js` now detects
    suspicious fields and normalizes option lists with direct loops. Backup
    summary keys, custom-table totals, suspicious-text rules, de-duplication,
    and locale sorting remain unchanged. This was a backend utility cleanup
    only; no folder move, schema migration, or language conversion was needed.
410. Tighten contact option normalization helpers. Done:
    `backend/src/contactOptions.ts` now uses direct-loop helpers for stored
    structured options, legacy string options, fallback options, serialization
    cleanup, primary option selection, and data checks. The three-option cap,
    address-vs-area rules, default labels, legacy migration behavior, and JSON
    shape remain unchanged. This was a backend utility cleanup only; no folder
    move, schema migration, or language conversion was needed.
411. Tighten startup/runtime infrastructure helper loops. Done:
    `backend/src/config/index.ts`, `backend/src/dataPath/index.ts`,
    `backend/src/organizationContext/index.ts`, `backend/src/settingsSnapshot.ts`,
    and `backend/src/runtimeVersion.ts` now use direct loops for env
    candidates, folder creation, settings snapshot sanitizing, first existing
    runtime directory selection, and source-hash file filtering. This was a
    backend infrastructure utility cleanup only; no folder move, schema
    migration, or language conversion was needed.
412. Tighten CSV import parsing loops. Done:
    `backend/src/importCsv.ts` now uses direct-loop helpers for delimiter
    detection, header normalization, parsed row materialization, streaming
    header setup, row-content checks, and CSV value-to-row projection. BOM
    handling, delimiter priority, quote/CRLF parsing, Khmer text and digit
    preservation, row numbers, batch sizing, and empty-row filtering remain
    unchanged. This was a backend parser cleanup only; no folder move, schema
    migration, or language conversion was needed.
413. Tighten product import policy list helpers. Done:
    `backend/src/productImportPolicies.ts` now uses direct-loop helpers for
    array/JSON/string list normalization, lowercase uniqueness set
    construction, and append-unique merging. JSON-array support,
    `|`/`;`/newline splitting, case-insensitive de-duplication, imported item
    ordering, and ` | ` serialization remain unchanged. This was a backend
    import-policy cleanup only; no folder move, schema migration, or language
    conversion was needed.
414. Tighten schema/security/runtime helper loops. Done:
    `backend/src/schemaMetadata.ts`, `backend/src/middleware.ts`,
    `backend/src/security.ts`, `backend/src/netSecurity.ts`, and
    `backend/src/storage/organizationFolders.js` now use direct-loop helpers
    for column candidates, permission keys, any-permission checks,
    rate/abuse timestamp pruning, private IPv4 parsing, blocked host suffixes,
    and organization folder discovery. This was a backend utility cleanup only;
    no folder move, schema migration, or language conversion was needed.
415. Tighten system job lifecycle helpers. Done:
    `backend/src/systemJobs.ts` now uses direct-loop helpers for migration
    statement execution, finished-job collection, old finished job cleanup,
    persisted job row serialization, and in-memory job listing. Stale recovery,
    persistence throttling, completed-job cap, listing order, and public job
    shape remain unchanged. This was a backend runtime utility cleanup only; no
    folder move, schema migration, or language conversion was needed.
416. Tighten file-asset reference and orphan helpers. Done:
    `backend/src/fileAssets.ts` now uses direct-loop helpers for upload
    reference recursion, persisted reference collection, reference backfill
    registration, tracked upload path collection, object/local orphan scans,
    storage-delete key collection, usage map seeding, settings/submission usage
    expansion, and asset row serialization. R2 key normalization, local upload
    deletion rules, backfill metadata, usage labels, `canDelete`, and browser
    public paths remain unchanged. This was a backend media/storage utility
    cleanup only; no folder move, schema migration, or language conversion was
    needed.
417. Tighten product-batch stock hierarchy helpers. Done:
    `backend/src/productBatches.ts` now uses direct-loop helpers for product ID
    normalization, placeholder construction, batch ID extraction, tracked-batch
    detection, product-batch grouping, branch rollup aggregation, legacy batch
    zeroing, branch quantity seeding, force-migration ID listing, and
    availability totals. FEFO ordering, branch rollup math, synthetic legacy
    batches, allocation restore behavior, and public helper exports remain
    unchanged. This was a backend stock-hierarchy utility cleanup only; no
    folder move, schema migration, or language conversion was needed.
418. Tighten shared backend helper loops. Done:
    `backend/src/helpers.ts` now uses direct-loop helpers for CSV non-empty
    line filtering, header normalization, parsed-row construction, backup
    import placeholder/value construction, returned-item quantity maps,
    fully-returned sale detection, integrity success checks, and sale profit
    COGS totals. CSV row numbering, backup import ignore behavior, sale status
    repair semantics, integrity response shape, and profit calculations remain
    unchanged. This was a backend shared-helper cleanup only; no folder move,
    schema migration, or language conversion was needed.
419. Tighten object-store helper loops. Done:
    `backend/src/objectStore.ts` now uses direct-loop helpers for Cloudflare
    R2 API query construction, delete-key normalization and de-duplication,
    bulk delete object descriptors, Cloudflare object-list serialization, and
    S3 object-list serialization. S3/R2 driver selection, R2 API fallback
    conditions, timeout handling, delete chunk sizing, and list payload shape
    remain unchanged. This was a backend storage utility cleanup only; no
    folder move, schema migration, or language conversion was needed.
420. Tighten server utility host and sanitizer helpers. Done:
    `backend/src/serverUtils.ts` now uses direct-loop helpers for configured
    public host collection, customer portal host de-duplication, and recursive
    array key sanitization. Origin allowlist behavior, customer portal host
    precedence, WebSocket origin checks, CSP/cache headers, and
    prototype-pollution key stripping remain unchanged. This was a backend
    security/header utility cleanup only; no folder move, schema migration, or
    language conversion was needed.
421. Tighten portal about-block normalization. Done:
    `backend/src/portalUtils.js` now uses a direct-loop helper for about-block
    creation and meaningful-block filtering. JSON string parsing, fallback
    IDs, supported block types, media/title/body trimming, Google Maps embed
    normalization, and public helper exports remain unchanged. This was a
    backend portal utility cleanup only; no folder move, schema migration, or
    language conversion was needed.
422. Tighten permission definition helpers. Done:
    `backend/src/permissions.ts` now uses direct-loop helpers for permission
    definition expansion and definition lookup. Section labels, sensitivity
    metadata, default role permissions, action-history permission mapping,
    sensitive action detection, and public exports remain unchanged. This was
    a backend permission-policy cleanup only; no folder move, schema migration,
    or language conversion was needed.
423. Tighten initial-key aggregation helpers. Done:
    `backend/src/initials.js` now uses direct-loop helpers for Khmer order map
    construction, row aggregation, sorted entry materialization, and aggregate
    response construction. Khmer collation, Latin/number ordering, symbol
    handling, count accumulation, and public helper exports remain unchanged.
    This was a backend catalog grouping cleanup only; no folder move, schema
    migration, or language conversion was needed.
424. Tighten small security and maintenance predicates. Done:
    `backend/src/accessControl.ts`, `backend/src/maintenanceLock.js`, and
    `backend/src/uploadSecurity.ts` now use direct-loop helpers or named
    predicates for public API allowlist matching, maintenance-lock write
    allowlisting, read-only method checks, and upload magic-byte matching.
    Public route behavior, maintenance 423 responses, upload type detection,
    and security test coverage remain unchanged. This was a backend predicate
    cleanup only; no folder move, schema migration, or language conversion was
    needed.
425. Tighten Postgres compatibility and cutover-readiness scans. Done:
    `backend/src/db/postgresQueryCompat.ts` and
    `backend/src/db/cutoverReadiness.ts` now use direct-loop helpers for
    numeric field matching, row coercion, forbidden-pattern scans, blocker
    counts, summary rows, and multi-file blocker collection. SQL translation,
    numeric coercion exceptions, cutover blockers, packaged-runtime gating,
    and report shapes remain unchanged. This was a backend database-runtime
    cleanup only; no folder move, schema migration, or language conversion was
    needed.
426. Tighten synchronous Postgres runtime bridge helpers. Done:
    `backend/src/postgresDatabase.ts` now uses direct-loop helpers for query
    row coercion, semicolon-split exec statement materialization, runtime
    schema/index statement execution, and default role seeding. Statement
    translation, transaction boundaries, runtime DDL order, default
    organization/bootstrap behavior, and role seed updates remain unchanged.
    This was a backend database-runtime cleanup only; no folder move, schema
    migration, or language conversion was needed.
427. Tighten small route predicate helpers. Done:
    `backend/src/routes/branches.ts`, `backend/src/routes/inventory.ts`,
    `backend/src/routes/portal.ts`, `backend/src/routes/settings.ts`, and
    `backend/src/routes/sync.ts` now use named direct-loop helpers for paged
    branch-stock query detection, inventory stats filters, portal AI profile
    preferences, suspicious brand option checks, sync conflict detection, and
    replay success checks. Route registration, validation messages, conflict
    status codes, and offline replay behavior remain unchanged. This was a
    backend route predicate cleanup only; no folder move, schema migration, or
    language conversion was needed.
428. Tighten upload reference cleanup loops. Done:
    `backend/src/uploadReferenceCleanup.ts` now uses direct row loops for
    settings, product image, product, user avatar, file asset, and
    customer-share screenshot repair passes. Sanitization rules,
    gallery-primary fallback behavior, delete-vs-update decisions, summary
    counters, and public cleanup exports remain unchanged. This was a backend
    media/storage cleanup only; no folder move, schema migration, or language
    conversion was needed.
429. Clear remaining backend source callback-chain scan. Done:
    `backend/src/importCsv.ts`, `backend/src/services/integrationDoctor.ts`,
    and `backend/src/services/googleDriveSync/index.ts` now use named
    direct-loop predicates for CSV row-content checks, integration
    critical-check aggregation, and Google Drive canonical layout detection.
    CSV parsing, Khmer text preservation, integration report shape, Drive
    versioning, mapping reset behavior, and sync retention behavior remain
    unchanged. A backend source scan now reports no callback-chain hits under
    `backend/src`. This was a backend parser/runtime cleanup only; no folder
    move, schema migration, or language conversion was needed.
430. Start frontend test-runner TypeScript conversion. Done:
    `frontend/tests/initials.test.ts`, `groupedRecords.test.ts`,
    `productGrouping.test.ts`, `productGalleryHelpers.test.ts`, and
    `portalLanguagePacks.test.ts` now run directly through Node 24's native
    TypeScript stripping and are included in `frontend/tsconfig.json`.
    `frontend/package.json` now invokes those `.ts` tests, `@types/node` is
    pinned to the Node 24 line for test globals, and the product grouping test
    now uses valid Khmer string literals instead of mojibake fixtures. This is
    the first test-runner slice toward the no-JavaScript end state; the
    remaining `.mjs` tests stay on the old path until each batch is typed and
    script references are updated.
431. Convert a larger frontend utility-test batch to TypeScript. Done:
    Fifteen more focused tests now run as `.ts` and import TypeScript
    implementation files directly where available: `actionGuards`, `bulkOps`,
    `dateHelpers`, `deviceInfo`, `formatters`, `historyHelpers`, `loaders`,
    `navigationConfig`, `permissions`, `settingsConflictHelpers`,
    `settingsRefresh`, `storagePolicy`, `scriptTypography`, `productBatches`,
    and `utilsSettingsBarrel`. The batch also tightens typed test harnesses,
    narrows unknown loader/history error payloads, uses `Date.getTime()` for
    date math, gives keyed-action tests a `Set<string>`, and replaces Khmer
    mojibake fixtures in the script typography test. This intentionally merges
    multiple small prior-style moves into one larger verified conversion slice.
432. Convert the app-shell and portal test cluster to TypeScript. Done:
    Eleven more tests now run as `.ts`: `appShellUtils`,
    `publicErrorRecovery`, `runtimeErrorClassifier`, `sectionNavigation`,
    `dashboardDataReliability`, `assetCompression`,
    `portalTranslateController`, `portalContentI18n`, `portalFaqVocabulary`,
    `portalEditorUtils`, and `portalCatalogDisplay`. The batch keeps the
    conversion strategy larger per session while still scoped to low-risk
    assertion harnesses. It also tightens fake storage, fake DOM, fake event,
    URL path, callback, and portal localization payload types so the converted
    tests are checked by strict TypeScript instead of only being renamed.
433. Convert the product, POS, and scanner helper test cluster to TypeScript. Done:
    Twelve more tests now run as `.ts`: `productFilterHelpers`,
    `productSelectionHelpers`, `productGroupViewHelpers`,
    `productDisplayHelpers`, `productMenuHelpers`, `productWriteHelpers`,
    `productHistoryHelpers`, `productPageHelpers`, `posCore`,
    `barcodeScannerState`, `scanbotScanner`, and `barcodeImageScanner`.
    The batch imports TypeScript helper implementations directly, tightens
    async harness callbacks, narrows fake barcode image/scanner globals, uses
    explicit menu-item and filter-section guards, and keeps intentionally
    malformed normalization fixtures behind `unknown` casts instead of
    weakening TypeScript settings.
434. Convert import, CSV, export, and refresh tests to TypeScript. Done:
    Ten more focused tests now run as `.ts`: `csvImport`,
    `contactImportWorker`, `inventoryImportWorker`, `salesImportWorker`,
    `productImportWorkerFallback`, `mediaUploadHelpers`,
    `productImportPlanner`, `exportPackages`, `importJobRefresh`, and
    `appRefresh`. The batch targets the high-resource import/export paths,
    points tests at TypeScript implementations where wrappers already exist,
    keeps worker fallback assertions intact, narrows fake browser events, and
    leaves malformed product-import fixtures behind explicit `unknown` casts
    so strict TypeScript checks prove the harness without hiding edge cases.
435. Convert layout, receipt, permission, and scroll tests to TypeScript. Done:
    Twelve more focused tests now run as `.ts`: `returnsLayout`,
    `notificationBadge`, `inventoryMobileCardLayout`,
    `inventoryMovementGroups`, `productSearchPagination`,
    `productDiscountUx`, `pricingContacts`, `permissionEditor`,
    `receiptTemplate`, `receiptSettingsSync`, `globalScroll`, and
    `globalScrollControls`. The batch points helper assertions at TypeScript
    implementations for inventory movement grouping, pricing/contact options,
    receipt templates, and global scroll behavior while keeping JSX UI
    contract checks as source inspections. Strict compiler checks now cover
    those fake scroll targets, parsed receipt/template values, and contact
    option round trips.
436. Convert frontend build configuration to TypeScript. Done:
    `frontend/vite.config.ts` and `frontend/tailwind.config.ts` replace the
    remaining frontend-root `.mjs` config files. PostCSS is now owned by the
    typed Vite config instead of a separate config file, avoiding an extra
    `ts-node` loader dependency just to build CSS. The Vite config now has
    explicit plugin/dependency helper types, stale manual chunk references now
    point at the TypeScript helper files, Tailwind scans `js`, `jsx`, `ts`, and
    `tsx` source only, and `frontend/tsconfig.json` includes the typed root
    config files. Runtime dependency and performance guard scripts now validate
    the `.ts` config paths instead of the retired `.mjs` names.
437. Convert schema primary-key preflight entrypoint to TypeScript. Done:
    `ops/scripts/backend/schema-primary-key-preflight.ts` replaces the `.mjs`
    preflight script and keeps the existing `npm --prefix ops run
    schema-pk-preflight` command stable. The script now has typed argument,
    table-result, and summary shapes while preserving the read-only Docker
    `psql` query and workspace-safe output guard. Backend full-automation tests
    and the language/runtime audit now reference the TypeScript path.
438. Convert storage readiness and restore check entrypoints to TypeScript.
    Done: `dataset-readiness.ts`, `restore-candidates.ts`, and
    `restore-rehearsal.ts` replace their `.mjs` entrypoints while preserving
    the existing npm command names. The scripts now carry typed argument,
    count, package, and Docker option shapes, keep workspace path guards, and
    remain directly executable by Node 24 without changing the ops package
    module type. `post-live-hygiene.ts` and full-automation tests now call the
    TypeScript storage readiness path.
439. Convert route contract and post-start diagnostics smoke checks to
    TypeScript. Done: `check-route-contract.ts` and
    `post-start-diagnostics.ts` replace the `.mjs` smoke entrypoints while
    keeping `run/verify-local.bat`, `start-runtime.ps1`, `docker-release.ps1`,
    runtime dependency guards, Docker release guards, and full-automation
    tests aligned. The diagnostics script keeps typed response/report shapes
    and still writes the same JSON report contract.
440. Convert the action-history undo/redo live audit to TypeScript. Done:
    `ops/scripts/runtime/audits/action-history-undo-redo-check.ts` replaces
    the `.mjs` entrypoint while preserving the `action-history:check` npm
    command and full-automation launcher behavior. The script now has typed
    session, API response, cleanup command, and report shapes while keeping
    its reversible action check and prefix-scoped cleanup/postcheck flow.
441. Convert the Phase 29 architecture audit entrypoints to TypeScript. Done:
    `generated-bulk-audit.ts`, `organization-audit.ts`,
    `language-runtime-audit.ts`, and `phase29-audit.ts` replace their `.mjs`
    entrypoints while keeping npm command names stable. The Phase 29
    orchestrator now calls the TypeScript audit paths, and the conversion keeps
    CommonJS-style loading so direct Node execution avoids typeless ESM
    reparsing overhead during repeated audit loops.
442. Convert Cloudflare runtime operations to TypeScript. Done:
    `rotate-cloudflare-tunnel-token.ts`,
    `update-cloudflare-tunnel-origin.ts`,
    `verify-cloudflare-automation.ts`, and `verify-r2-object-store.ts` replace
    the Cloudflare `.mjs` entrypoints. The public run wrappers,
    full-automation launcher, hardening policy, Docker release guardrail, and
    backend automation tests now point at the TypeScript paths while preserving
    direct Node execution for tunnel origin updates, token rotation, Access/WAF
    verification, and R2 object-store checks.
443. Convert storage cleanup and retention entrypoints to TypeScript. Done:
    `cleanup-test-data.ts`, `cleanup-integrity-backlog.ts`,
    `post-live-hygiene.ts`, and `prune-storage.ts` replace the storage `.mjs`
    entrypoints. Ops package scripts, full automation, backend guardrails,
    live-smoke cleanup calls, action-history cleanup calls, and Phase 8.4
    hygiene orchestration now point at the TypeScript paths while preserving
    guarded dry-run defaults, prefix-scoped QA cleanup, report retention, and
    backup prune behavior.
444. Convert runtime smoke entrypoints to TypeScript. Done:
    `check-public-url.ts` and `live-smoke.ts` replace the smoke `.mjs`
    entrypoints. The Windows and shell start-server public URL checks, backend
    `verify:live-smoke` script, Docker release guardrail, and backend
    automation tests now use the TypeScript paths while keeping public ingress
    probing, live sale/return/stock workflows, and smoke-test cleanup behavior.
445. Convert shared live-audit helper modules to TypeScript. Done:
    `audit-auth.ts`, `audit-manifest.ts`, and `audit-report-html.ts` replace
    the shared `.mjs` audit helpers. The conversion adds typed login/session
    contracts, route manifest/profile shapes, report summary rows, and HTML
    report inputs while preserving the existing Phase 8.4 audit import graph.
    Deep audit, full-app audit, browser-action smoke, focused Phase 8.4 live
    checks, action-history dynamic login, and backend automation source checks
    now point at the TypeScript helper modules.
446. Convert Phase 8.4 live-check utility helpers to TypeScript. Done:
    `live-check-utils.ts` replaces the shared `.mjs` utility module for
    focused live checks. The helper now has typed JSON fetch options, observed
    request status records, console collection entries, Playwright-like page
    and locator boundaries, and modal close/read-wait contracts. Route-specific
    Phase 8.4 live checks now import the TypeScript utility helper while their
    entrypoints remain queued for later conversion.
447. Convert the Phase 8.4 live-suite orchestrator to TypeScript. Done:
    `phase84-live-suite.ts` replaces the `.mjs` orchestrator while preserving
    the `phase84:live-suite` package command. The suite now has typed CLI
    options, step definitions, child report summaries, skipped-step records,
    and workspace-safe report output handling while continuing to run the UI
    live check, public Cloudflare portal check, and post-live hygiene gate in
    order.
448. Convert the public Cloudflare portal live check to TypeScript. Done:
    `phase84-public-portal-cloudflare-check.ts` replaces the `.mjs` live
    check and is now called by `phase84-live-suite.ts`. The script preserves
    the remote portal render/API/CSP assertions while adding typed console
    entries, observed request records, portal checks, and report output
    structure.
449. Convert the browser action smoke audit to TypeScript. Done:
    `browser-action-smoke.ts` replaces the `.mjs` browser action audit while
    preserving the `browser-action-smoke` package command. The script now has
    typed profile, route, summary, health, action, finding, navigation, and
    console-entry shapes while continuing to exercise manifest-driven route
    navigation, searches, menus, dialogs, and screenshot/report generation.
450. Convert product lookup focused live checks to TypeScript. Done:
    `phase84-product-categories-actions-live-check.ts`,
    `phase84-product-units-actions-live-check.ts`, and
    `phase84-product-brands-actions-live-check.ts` replace their `.mjs`
    entrypoints. The checks keep the same Manage modal, lookup-usage,
    action-history, row action, console, screenshot, and report assertions
    while adding typed health, console-entry, observed-request, and direct
    request-context boundaries.
451. Convert admin entity focused live checks to TypeScript. Done:
    `phase84-branches-actions-live-check.ts`,
    `phase84-contacts-live-check.ts`, and
    `phase84-users-actions-live-check.ts` replace their `.mjs` entrypoints.
    The checks keep the same Branch, Contacts, and Users modal/tab/action
    browser workflows while adding typed health, console-entry, observed
    request, and user-record boundaries.
452. Convert product action focused live checks to TypeScript. Done:
    `phase84-product-page-actions-live-check.ts`,
    `phase84-product-scanning-actions-live-check.ts`,
    `phase84-product-stock-actions-live-check.ts`, and
    `phase84-product-variant-actions-live-check.ts` replace their `.mjs`
    entrypoints. The checks keep the same add-product, row action,
    non-mutating delete-confirmation, manual barcode scanner, bulk stock,
    branch stock, and add-variant browser workflows while adding typed health,
    console-entry, observed-request, dialog, and Playwright page boundaries.
453. Convert operational focused live checks to TypeScript. Done:
    `phase84-files-providers-actions-live-check.ts`,
    `phase84-inventory-actions-live-check.ts`, and
    `phase84-sales-actions-live-check.ts` replace their `.mjs` entrypoints.
    The checks keep the same Library provider, Inventory adjust/transfer/move
    and batch, and Sales bulk/detail browser workflows while adding typed
    health, console-entry, observed-request, evaluated provider, sale
    candidate, and Playwright page boundaries.
454. Convert the broad Phase 8.4 UI live check to TypeScript. Done:
    `phase84-ui-live-check.ts` replaces the broad route-suite `.mjs`
    entrypoint and `phase84-live-suite.ts` now calls the TypeScript path. The
    conversion keeps the same dashboard, notifications, branch stock, sales,
    product import/search, portal, POS, inventory, contacts, loyalty, users,
    profile, audit/settings, backup, and sync-server browser probes while
    adding typed health, console-entry, and observed-request boundaries.
455. Convert the full app audit to TypeScript. Done:
    `full-app-audit.ts` replaces the `.mjs` full audit entrypoint. Docker
    release verification, backend source assertions, and the deep live audit
    launcher now point at the TypeScript path while the audit keeps its HTML
    route checks, read endpoint checks, FEFO/import/file/backup write flows,
    final cleanup, remote public probes, and HTML report generation.
456. Convert the deep live audit to TypeScript. Done:
    `deep-live-audit.ts` replaces the final runtime audit `.mjs` entrypoint
    and the ops package `deep-live-audit` command now calls the TypeScript
    path. The script keeps the same route profiling, browser interactions,
    remote read-only checks, full app audit launch, Docker log scan, baseline
    comparison, and HTML report generation while adding typed summary, command,
    request, route, collector, and finding boundaries.
457. Convert ops verification guardrails to TypeScript. Done:
    `verify-backup-reliability.ts`, `verify-docker-release.ts`,
    `verify-hardening-policy.ts`, `verify-runtime-deps.ts`,
    `verify-scale-services.ts`, and `verify-secret-hygiene.ts` replace the
    verification `.js` entrypoints. Run wrappers, full automation, Phase 29,
    backend source assertions, and organization/language audits now point at
    the TypeScript paths while preserving the same Docker, runtime dependency,
    hardening, backup, scale-service, and secret hygiene checks.
458. Convert docs and frontend verification utilities to TypeScript. Done:
    `generate-doc-reference.ts`, `generate-full-project-docs.ts`,
    `performance-scan.ts`, `verify-i18n.ts`, `verify-ui.ts`, and
    `verify-performance.ts` replace their `.js` entrypoints. Frontend package
    scripts, Phase 29, runtime dependency guards, docs, and backend source
    assertions now point at the TypeScript paths. The batch also adds the
    missing Khmer branch stat/detail keys found by the converted i18n verifier.
459. Convert shared ops script helpers to TypeScript. Done:
    `ops/scripts/lib/fs-utils.ts` and `ops/scripts/lib/report-utils.ts`
    replace the shared `.js` helper entrypoints. Architecture audits, docs
    generators, frontend verifiers, runtime Cloudflare/audit report helpers,
    backend full automation assertions, and verification guardrails now import
    the TypeScript helper paths. The helpers keep the current direct-Node
    CommonJS execution contract and add JSDoc type boundaries for filesystem
    walking, bounded concurrency, Markdown table generation, byte formatting,
    and stable digest helpers until the ops runner moves to a compiled or
    `tsx`-backed TypeScript path.
460. Convert backend ops audit entrypoints to TypeScript. Done:
    `ops/scripts/backend/schema-audit.ts` and
    `ops/scripts/backend/verify-data-integrity.ts` replace their `.js`
    entrypoints. Phase 29, backend package verification scripts,
    post-live-hygiene, docs, language/runtime audit proof text, and backend
    full automation assertions now reference the TypeScript paths. The scripts
    preserve the direct Node/CommonJS execution contract while removing two
    more `.js` source entrypoints from the schema and data-integrity guardrail
    loop.
461. Convert the first backend utility test tranche to TypeScript. Done:
    Ten short backend regression tests now run as `.ts` entrypoints:
    `backupDefaultDestination`, `productSearchPagination`, `initials`,
    `idempotency`, `permissionPolicy`, `portalUtils`,
    `importJobPerformanceHardening`, `netSecurity`, `analyticsRuntime`, and
    `integrationDoctor`. The backend `test:utils` script, language/runtime
    proof references, and related plan notes now point at the TypeScript test
    paths. This keeps production backend source untouched while shrinking the
    remaining `.js` test surface in a verified slice.
462. Convert the second backend utility test tranche to TypeScript. Done:
    Fifteen more backend tests now run as `.ts` entrypoints:
    `runtimeVersion`, `postgresCutoverReadiness`, `fileAssetStorageReconcile`,
    `uploadSecurity`, `rfidRoutes`, `inventorySettingsMediaContracts`,
    `runtimeCache`, `authOtpGuards`, `productExpiry`,
    `productImportPolicies`, `importScaleSmoke`, `contactOptions`,
    `dataPath`, `importCsv`, and `offlineSecurity`. The backend `test:utils`
    command and language/runtime proof strings now reference the TypeScript
    paths, keeping this conversion on the test surface while backend runtime
    packaging remains unchanged.
463. Convert the third backend utility test tranche to TypeScript. Done:
    Twelve medium backend tests now run as `.ts` entrypoints:
    `backupRetention`, `notificationSummaryCache`, `systemJobs`,
    `postgresQueryCompat`, `portalInventoryRegression`, `ownedGoogleAuth`,
    `productBatchHierarchy`, `backupSchema`, `schemaMetadata`,
    `mediaOptimization`, `postgresDatabase`, and `googleDriveSyncVersioning`.
    The backend `test:utils` command and language/runtime proof references now
    call the TypeScript paths. The batch keeps production runtime files stable
    and continues shrinking backend `.js` from the verified test surface first.
464. Convert the remaining non-fullAutomation backend tests to TypeScript. Done:
    Twelve backend tests now run as `.ts` entrypoints: `fileAssetUsageCache`,
    `accessControl`, `defaultRoles`, `settingsSnapshotObjectStorage`,
    `importDecisionIntegrity`, `backupPerformanceHardening`,
    `fileRouteSecurityFlow`, `routeContracts`, `serverUtils`,
    `branchStockSearch`, `authSecurityFlow`, and `importJobStateMachine`. The
    backend `test:utils` suite passed with the converted tests. The standalone
    live/security/state-machine harnesses still need their pre-existing local
    runtime prerequisites (`DATABASE_URL`, pg-native/libpq, or a live server)
    before they can run assertions; this move only changes their source
    extension and package/doc references.
465. Convert the backend full automation guardrail test to TypeScript. Done:
    `backend/test/fullAutomation.test.ts` replaces the final `.js` file under
    `backend/test`. The backend `test:utils` command, language/runtime audit
    allowlists, and plan references now point at the TypeScript entrypoint.
    This finishes the backend test-directory conversion while preserving the
    direct Node/CommonJS execution contract used by the current lightweight
    test harness.
466. Retire frontend utility TypeScript compatibility wrappers. Done:
    `frontend/src/utils/appRefresh.ts`, `settingsRefresh.ts`,
    `publicAssetUrls.ts`, and `favicon.ts` are imported directly by React,
    API, media upload, product-gallery, and settings callers. The one-line
    `.js` wrappers and the obsolete declaration-only shims for app refresh and
    public asset URLs were deleted after reference scans showed each caller
    could move to the TypeScript source path.
467. Retire leaf frontend utility JavaScript wrappers. Done:
    `color.ts`, `dateHelpers.ts`, `deviceInfo.ts`, `formatters.ts`,
    `mediaUpload.ts`, `permissions.ts`, and `scriptTypography.ts` are now
    imported directly by frontend callers. Their one-line `.js` compatibility
    wrappers were removed after targeted import rewrites, keeping the utility
    behavior in the typed source files and reducing the remaining JavaScript
    surface without touching React component ownership.
478. Retire frontend shared/runtime/config wrappers. Done:
    `globalScroll.ts`, `navigationConfig.ts`, `pageActivity.ts`,
    `constants.ts`, `clientRuntime.ts`, `receipt-settings/constants.ts`, and
    `receipt-settings/template.ts` now serve direct TypeScript imports. The
    previous one-line `.js` wrappers were deleted after exact caller rewrites
    and reference scans, keeping app shell scroll controls, navigation order,
    runtime reset metadata, and receipt template parsing on typed source paths.
479. Retire frontend helper/barrel compatibility wrappers. Done:
    `contactOptionUtils.ts`, `customerMembershipNumber.ts`,
    `movementGroups.ts`, dashboard `charts/index.ts`,
    `utils-settings/index.ts`, and `utils-settings/settingsConflict.ts` now
    serve direct TypeScript imports. The previous one-line `.js` wrappers were
    removed after the Settings conflict import and barrel test moved to typed
    paths, reducing the remaining frontend JavaScript wrapper surface without
    changing component ownership.
480. Retire frontend utility barrel/export wrappers. Done:
    `csv.ts`, `csvImport.ts`, `exportPackage.ts`, `importJobRefresh.ts`,
    `pricing.ts`, `printReceipt.ts`, and `utils/index.ts` now serve direct
    TypeScript imports. Their one-line `.js` wrappers plus obsolete
    `csv.d.ts`/`pricing.d.ts` declaration shims were removed after exact import
    rewrites, keeping CSV parsing, export packaging, import-job refresh events,
    pricing, and receipt printing on typed source paths.
481. Retire frontend API/bootstrap compatibility wrappers. Done:
    `api/http.ts`, `api/websocket.ts`, `api/localDb.ts`, and `web-api.ts` now
    serve direct imports for app context, API methods, runtime reset, public
    asset URLs, background import tracking, and focused API tests. The previous
    one-line `.js` wrappers were removed after exact caller rewrites and the
    runtime dependency guardrail now checks the typed HTTP source directly.
482. Open the TSX conversion lane with small presentational components. Done:
    `ProductImage.tsx`, `CatalogPageContext.tsx`, `DualMoney.tsx`,
    `NoData.tsx`, and receipt-settings `ErrorBoundary.tsx` now compile as
    strict TSX. The old local React hook-only declaration shim was removed in
    favor of real React type packages, and TSX compilation is enabled without
    changing runtime routing or page ownership.
483. Convert the next shared UI component batch to TSX. Done: shared
    `ExportMenu.tsx` and `Modal.tsx`, POS `QuickAddModal.tsx`, sales
    `StatusBadge.tsx`, and dashboard `MiniStat.tsx` now carry explicit prop
    types. The shared modal close control also drops a mojibake glyph for a
    plain accessible `x` while preserving the modal layout contract.
484. Convert shared preference, loader, header, and section controls to TSX.
    Done: `QuickPreferenceToggles.tsx`, `LoadingWatchdog.tsx`,
    `PageHeader.tsx`, and `SectionSwitcher.tsx` now carry explicit prop types,
    storage/value boundary types, typed icon/title/action contracts, and typed
    app preference access while preserving the existing Vite resolver contract.
    Exact `.jsx` extension imports were removed from Inventory, Contacts,
    Loyalty Points, Settings, and Backup callers.
485. Prune generated runtime reports and record framework config guardrails.
    Done: `npm.cmd --prefix ops run prune-storage` removed only generated
    report/check artifacts under `ops/runtime/reports`, freeing 149,507,117
    bytes. Uploads, secrets, local backups, Docker images, Docker volumes, and
    current release data were preserved. The user-provided Next.js guardrail is
    now folded into the language policy as a future-framework rule: if a Next
    app/config ever appears, keep `next.config.mjs` as `.mjs`, keep direct Node
    config files such as PostCSS/Tailwind JavaScript unless proven safe, and do
    not add production runtime TypeScript loaders. This repository remains a
    Vite React frontend plus Node backend, so no Next-specific folder layout is
    introduced.
486. Convert receipt preview, receipt field panel, filter menu, and gallery
    lightbox to TSX. Done: `ReceiptPreview.tsx`, `AllFieldsPanel.tsx`,
    `FilterMenu.tsx`, and `ImageGalleryLightbox.tsx` now carry typed receipt
    settings/template boundaries, typed app translation access, typed filter
    section/option contracts, and typed lightbox labels/index callbacks. Tests
    that inspect receipt preview wiring now read the TSX source. The language
    runtime audit keeps `ImageGalleryLightbox.tsx` classified as React
    presentation/event code, not a Rust/worker candidate, because the browser
    still owns image loading and the component only coordinates state,
    keyboard navigation, and rendering.
487. Convert portal menu, action history bar, and user detail sheet to TSX.
    Done: `PortalMenu.tsx` now owns the typed body-portal trigger, item,
    divider, custom-content, and three-dot action contracts; `ActionHistoryBar`
    now carries typed undo/redo/server-history and admin user-filter shapes;
    `UserDetailSheet.tsx` now has typed role/user/permission boundaries while
    using `PermissionEditor.tsx` as the current permission-definition source.
    Callers no longer import the old ActionHistoryBar JSX path, and TSX menu wrappers now
    import the typed `PortalMenu` directly instead of casting the JSX module.
488. Convert shared pagination, write-conflict, and dashboard chart leaves to
    TSX. Done: `PaginationControls.tsx` now carries typed pagination helpers,
    page-size callbacks, and editable input events; `WriteConflictModal.tsx`
    now types conflict payloads, field rows, and current-value summaries; and
    dashboard `BarChart.tsx`, `LineChart.tsx`, and `DonutChart.tsx` now type
    chart data, hover tooltips, resize refs, and SVG event handlers. Callers no
    longer import the old pagination JSX path, and the chart barrel now exports
    typed chart modules through extensionless imports.
489. Convert POS leaf controls, receipt print/order controls, and product
    primitives to TSX. Done: `CartItem.tsx` now types cart line ids, branch
    options, price-mode labels, and money callbacks; `FilterPanel.tsx` now
    types category/branch/brand/supplier filter options while keeping the
    allocation-free active-filter counter; `FieldOrderManager.tsx` now types
    receipt sections, dividers, drag events, and order updates;
    `PrintSettings.tsx` now types print settings, preview refs, and
    auto-save settings payloads; and `products/shared/primitives.tsx` now
    exposes typed product image, placeholder, margin, dual-price, and numeric
    parsing primitives. Source-reading tests now target the TSX files.
490. Convert utility settings reset, OTP, and font controls to TSX. Done:
    `ResetData.tsx` now types destructive reset modes, action-history payloads,
    confirmation props, API fallbacks, and error boundaries; `OtpModal.tsx`
    now types setup/disable modes, request steps, OTP API payloads, and
    guarded action callbacks; and `FontFamilyPicker.tsx` now types font option
    contracts while replacing stale mojibake triangle glyphs with lucide
    chevrons. The utils-settings barrel now exports these typed modules
    directly and the obsolete named `.jsx` declaration shims were removed.
491. Convert product header actions and row presentation parts to TSX. Done:
    `HeaderActions.tsx` now types product action callbacks, export menu items,
    and translation fallbacks while removing corrupted fallback strings;
    `ProductRowParts.tsx` now types product/promotion/batch preview records,
    row action menu callbacks, money formatting, and detail-pill rendering.
    `ProductDetailsCell` now uses an explicit typed pill accumulator instead
    of relying on loose `filter(Boolean)` inference.
492. Convert product list and detail surfaces to TSX. Done:
    `ProductsListSurface.tsx` now types product sections, grouped rows,
    selection-scope callbacks, desktop select-all refs, and render callbacks
    for desktop rows and mobile cards. `ProductDetailModal.tsx` now types
    product detail records, category/unit/brand color maps, branch stock rows,
    image lightbox callbacks, and formatter/action callbacks. The conversion
    keeps valid Khmer refresh fallback text and normalizes nullable gallery,
    branch quantity, and batch preview values before rendering.
493. Convert product stock form leaves to TSX. Done:
    `BranchStockAdjuster.tsx` now types branch stock rows, stock adjustment
    payloads, product/user inputs, translation fallbacks, and bounded stock
    mutations while replacing corrupted fallback text with valid strings.
    `BulkAddStockModal.tsx` now types selected products, branch choices,
    bulk stock results, and adjust-stock API payloads, and normalizes product
    ids, branch ids, and positive quantities before each mutation.
494. Convert product variant creation to TSX. Done:
    `VariantFormModal.tsx` now types parent product, unit, branch, user,
    translation, mutation response, and completion payload contracts. The
    conversion restores valid Khmer fallback text, routes the variant create
    call through a typed `getProductVariantApi` boundary, preserves the shared
    single-action guard and loader timeout, and keeps numeric form fields
    sanitized before mutation.
495. Convert product unit lookup manager to TSX. Done:
    `ManageUnitsModal.tsx` now types unit rows, usage rows, virtual cleanup
    rows, selected ids, app sync context, lookup snapshot APIs, and unit
    create/update/delete mutation responses. The conversion keeps the direct
    loops for bulk delete and undo/redo paths, routes unit API calls through a
    typed `getUnitApi` boundary, and keeps the action-stability tests pointed
    at the TSX source.
496. Convert product category lookup manager to TSX. Done:
    `ManageCategoriesModal.tsx` now types category rows, usage rows, virtual
    cleanup rows, selected ids, app sync context, lookup snapshot APIs, and
    category create/update/delete mutation responses. The conversion preserves
    the existing bounded product snapshot/restore reads, keeps bulk delete and
    undo/redo loops explicit, and routes category API calls through a typed
    `getCategoryApi` boundary.
497. Convert product brand lookup manager to TSX. Done:
    `ManageBrandsModal.tsx` now types settings-backed brand options, color
    maps, usage rows, review rules, selected-brand sets, lookup snapshot APIs,
    and the settings/product-rewrite mutation surface. The conversion preserves
    the existing indexed delete-impact path, keeps brand undo/redo loops
    explicit, and routes settings plus product brand rewrite calls through a
    typed `getBrandApi` boundary.
498. Convert product barcode scanner modal to TSX. Done:
    `BarcodeScannerModal.tsx` now types modal props, camera permission states,
    media streams, native `BarcodeDetector`, ZXing reader/controls, file input
    events, scanner labels, and state-badge rendering. The conversion keeps the
    camera/manual/photo scan paths in the main browser thread, preserves the
    existing scanner presentation helper, and removes loose optional error
    access from camera and photo failure handling.
499. Convert main product form to TSX. Done: `ProductForm.tsx` now types the
    product form state, save payload, category/unit/branch/group candidates,
    supplier suggestions, product image upload API, file-picker boundary,
    scanner fields, and tab state. The conversion keeps multipart File uploads,
    synchronous image/save in-flight guards, scanner modal behavior, and branch
    stock adjustment wiring intact while replacing loose error-message access
    with a typed helper.
500. Convert bulk product import modal to TSX. Done: `BulkImportModal.tsx`
    now types product-import rows, conflict groups, import jobs, progress
    payloads, server preflight results, image file maps, file-picker assets,
    bulk decisions, and inline edit state. The conversion keeps the worker-first
    planner path, synchronous fallback, image ZIP/browser upload flows,
    review/undo loops, and import-job lifecycle intact while routing `window.api`
    calls through a typed product-import boundary.
501. Convert catalog shared UI primitives to TSX. Done: `catalogUi.tsx` now
    types portal section shells, summary metric tiles, status pills, stock
    status labels, tone names, icon components, actions, and children. The
    conversion keeps the small shared catalog presentation layer intact, updates
    the UI verifier path, and leaves catalog page import paths extensionless.
502. Convert catalog image field to TSX. Done: `CatalogImageField.tsx` now
    types the catalog media field labels, value, callbacks, upload state,
    cancellation hook, progress rendering, processing status, and preview
    image boundary. The conversion keeps data/blob display masking, upload
    progress, optimization status, error display, and extensionless catalog
    editor imports intact.
503. Convert catalog preview surface to TSX. Done:
    `CatalogPreviewSurface.tsx` now types portal tab icons, display config,
    refs, sticky-nav metrics, gallery state, file-picker state, translation
    options, scroll commands, and lazy JSX modal boundaries. The conversion
    keeps the preview shell render path, public sticky navigation, translation
    menu, theme toggle, scroll controls, gallery modals, and Vite catalog
    preview chunk placement intact.
504. Convert branch, return detail, and permission leaves to TSX. Done:
    `BranchForm.tsx` now types branch form rows, mutation payloads, and field
    updates while removing the stale visible default-branch helper text.
    `ReturnDetailModal.tsx` now types return records, line items, scope
    normalization, currency display, and optional edit actions.
    `PermissionEditor.tsx` now types permission sections, definitions,
    sensitivity labels, parsed permission state, and change callbacks while
    `UserDetailSheet.tsx` imports the TSX permission source directly.
505. Convert app entry, inventory RFID, and file response leaves to TSX. Done:
    `index.tsx` now types the React root, service-worker registration,
    form-field accessibility wiring, CSSStyleSheet extension-noise guards,
    runtime-error filters, and JSX app/provider boundaries while `index.html`,
    app-shell tests, and docs read the TSX entry path. `InventoryRfidSurface.tsx`
    now types RFID gateway state, workflow cards, section switcher contracts,
    and requirements. `FilesResponsesTab.tsx` now types AI response rows,
    profile fields, candidate products, recommendations, citations, expansion
    state, and refresh/date callbacks.
506. Convert file picker and branch transfer modals to TSX. Done:
    `FilePickerModal.tsx` now types file asset rows, media-type filters,
    upload/delete API boundaries, selected-path state, file-input events, and
    modal callbacks while keeping the upload/delete in-flight guards intact.
    `TransferModal.tsx` now types branch choices, branch-stock rows, transfer
    mutation payloads, transfer API responses, product selection, quantity
    validation, and tracked branch-stock refreshes. Catalog/product lazy
    imports plus stability/loading tests now read the TSX modal paths.
507. Convert standalone export report renderer to TSX. Done:
    `exportReports.tsx` now types summary cards, metadata groups, chart
    descriptors, table rows, notes, and the public report-build options. The
    conversion keeps the dashboard/inventory dynamic export path extensionless,
    renders existing SVG chart components through typed component boundaries,
    and fixes HTML escaping so ampersands are emitted as `&amp;` in generated
    self-contained reports.
508. Convert shared notification and background import trackers to TSX. Done:
    `BackgroundImportTracker.tsx` now types import jobs, progress labels,
    result summaries, tracker actions, API methods, and list-result
    normalization. `NotificationCenter.tsx` now types notification tone
    dictionaries, section/item payloads, summary state, copy renderers, app
    context access, and notification API calls. The conversion keeps the lazy
    app-shell imports extensionless while reducing dynamic shared-shell state.
509. Convert sales export and import modals to TSX. Done:
    `ExportModal.tsx` now types report periods, date ranges, export summaries,
    status/product rows, CSV fallback rows, and the sales-export API boundary.
    `SalesImportModal.tsx` and `InventoryImportModal.tsx` now type import job
    payloads, CSV dialog results, worker row-count messages, queued results,
    app-context notifications, and unknown-safe error handling. The conversion
    keeps worker-first row counting, loader timeouts, synchronous parser
    fallbacks, import-job queuing, and lazy route imports extensionless.
510. Convert contact form and shared contact surfaces to TSX. Done:
    `CustomerFormModal.tsx` now types customer form state, save payloads,
    membership-number edits, and structured contact options. `shared.tsx`
    now types contact row selection, selected-snapshot cloning, action menus,
    detail fields, pagination props, select-all refs, and generic table/card
    render callbacks used by customer, supplier, and delivery tabs.
511. Convert the contacts page shell to TSX. Done:
    `Contacts.tsx` now types the tab ids, tab icons, import modal state,
    contact import type picker, export rows, ZIP export files, app context
    boundary, lazy supplier/delivery tab modules, and contact export API
    boundary. The conversion keeps the customer tab eager, supplier/delivery
    tabs lazy, export timeout guards, paged API normalization, and import
    picker flow unchanged while removing one more route entry `.jsx` file.
512. Convert the contact import modal to TSX. Done:
    `ContactImportModal.tsx` now types contact import kinds, job types,
    conflict modes, field-rule presets, CSV dialog payloads, worker row-count
    messages, file-picker asset inputs, import job responses, app-context
    notifications, and queued result payloads. The conversion keeps worker
    row counting, synchronous fallback parsing, stale row-count guards,
    bounded create/upload/start import-job calls, and extensionless lazy modal
    imports intact.
513. Convert the inventory product detail modal to TSX. Done:
    `frontend/src/components/inventory/ProductDetailModal.tsx` now types
    inventory product rows, branch stock, batch preview rows, money formatters,
    translation callbacks, and stock action callbacks. The conversion removes
    stale display artifacts in the close control and margin separator, keeps
    stock/price/performance/branch/batch rendering unchanged, and updates the
    Vite manual chunk rule to the current TSX product-detail surfaces.
514. Convert the customer edit return modal to TSX. Done:
    `frontend/src/components/returns/EditReturnModal.tsx` now types editable
    return rows, update payloads, return API access, app user context,
    notification callbacks, and money/quantity normalization. The conversion
    keeps same-tick submit guards, explicit update timeouts, conflict recovery,
    and returns/inventory/sales refresh events intact while moving source-path
    guard tests to the TSX file.
515. Convert the navigation sidebar shell to TSX. Done:
    `frontend/src/components/navigation/Sidebar.tsx` now types app-context
    navigation state, settings-driven color/style overrides, user profile
    fields, navigation permissions, nav items with icon components, and page
    intent events. The conversion keeps desktop/sidebar/mobile drawer layouts,
    route warmup pointer/touch/focus events, sync status dots, and profile
    modal entry intact while moving source-path performance guards to TSX.
516. Convert the sales detail modal to TSX. Done:
    `frontend/src/components/sales/SaleDetailModal.tsx` now types sale detail
    rows, parsed sale line items, status and membership callbacks, formatter
    callbacks, translation fallbacks, and money/quantity normalization. The
    conversion keeps print/status/membership actions, totals, item breakdowns,
    Khmer fallback copy, and extensionless sales-page lazy imports intact.
517. Convert the files AI providers tab to TSX. Done:
    `frontend/src/components/files/FilesProvidersTab.tsx` now types provider
    rows, provider metadata, provider form state, label text, save/test/delete
    callbacks, and provider-form state updates. The conversion keeps the
    provider refresh, edit, test, delete, create, save, and action guard
    behavior unchanged while moving the library lazy import and action
    stability source-path guard to the TSX file.
518. Convert the returns list surface to TSX. Done:
    `frontend/src/components/returns/ReturnsListSurface.tsx` now types return
    records, grouped return sections, selection scopes, checkbox refs,
    viewport-deferred styles, amount renderers, and detail callbacks. The
    conversion keeps the desktop table, mobile cards, breakpoint-gated
    rendering, section collapse, group selection, and returns layout guard test
    intact.
519. Convert the sales list surface to TSX. Done:
    `frontend/src/components/sales/SalesListSurface.tsx` now types sale rows,
    sale items, grouped sales sections, selection scopes, checkbox refs, money
    formatters, status rendering, branch label callbacks, and detail/reprint
    callbacks. The conversion keeps the desktop table, mobile cards,
    collapse/group selection controls, revenue footer, and extensionless sales
    page import intact.
520. Convert the supplier return modal to TSX. Done:
    `frontend/src/components/returns/NewSupplierReturnModal.tsx` now types
    branch rows, supplier rows, inventory product rows, settlement methods,
    selected supplier-return items, app user context, notification callbacks,
    formatter callbacks, and supplier-return API calls. The conversion keeps
    setup/inventory/create timeouts, same-tick submit guards, stale request
    invalidation, branch-stock quantity clamps, compensation/loss math, and
    returns/inventory/products sync updates intact.
521. Convert the customer return modal to TSX. Done:
    `frontend/src/components/returns/NewReturnModal.tsx` now types sale rows,
    sale item rows, selected return items, previous-return rows, create-return
    payloads, return handling methods, app user context, notification
    callbacks, formatter callbacks, and return API calls. The conversion keeps
    sale search/history/create timeouts, same-tick search and submit guards,
    stale request invalidation, quantity clamps, refund totals, partial-return
    indicators, and returns/inventory/sales sync updates intact.
522. Convert the receipt overlay to TSX. Done:
    `frontend/src/components/receipt/Receipt.tsx` now types receipt sale
    payloads, line items, settings, app-context formatters/translations,
    language modes, export modes, row props, section maps, and receipt export
    roots. The conversion keeps POS/Sales extensionless lazy imports,
    ReceiptPreview's bounded dynamic import, PDF/print/image export actions,
    receipt template application, numeric totals, Khmer/bilingual labels, and
    receipt settings sync contracts intact.
523. Convert the receipt settings page to TSX. Done:
    `frontend/src/components/receipt-settings/ReceiptSettings.tsx` now types
    receipt template state, app-context settings, save/load callbacks,
    notification callbacks, auto-save queue options, section ids, local section
    and toggle props, preview refs, and settings save options. The conversion
    keeps silent debounced auto-save, manual save feedback, timeout-bounded
    settings refresh, the field order manager, print settings panel, all-fields
    panel, preview drawer/sidebar, and receipt settings sync contracts intact
    while moving exact source-path guards to TSX.
524. Convert the custom tables page to TSX. Done:
    `frontend/src/components/custom-tables/CustomTables.tsx` now types custom
    table metadata, dynamic column schemas, arbitrary row payloads, app/sync
    context access, typed `window.api` custom-table calls, row modal state,
    row-form values, delete ids, history result ids, and display/input value
    coercion. The conversion keeps bounded table/row reads, same-tick create,
    save, and delete guards, undo/redo row history, active-table refresh,
    dynamic row forms, and horizontal table scrolling intact while moving the
    action-stability source-path guard to TSX.
525. Convert the catalog products section to TSX. Done:
    `frontend/src/components/catalog/CatalogProductsSection.tsx` now types
    portal copy helpers, paged/local product lists, initial filter options,
    category/brand/branch/stock filters, preview config flags, promotion
    cards, stock and price helpers, product metadata chips, gallery callbacks,
    highlight badges, and pagination callbacks. The conversion keeps the
    CatalogPage extensionless lazy import, Vite catalog-preview chunk grouping,
    portal UI verifier coverage, server/local pagination, promotion cards,
    product gallery entry points, and customer-safe catalog rendering intact.
526. Convert the inventory products surface to TSX. Done:
    `frontend/src/components/inventory/InventoryProductsSurface.tsx` now types
    inventory product rows, branch stock chips, grouped inventory sections,
    group summary callbacks, stock quantity callbacks, selection scopes,
    formatter/translator functions, product detail/adjust callbacks, injected
    discount and batch preview components, and loading/reveal gates. The
    conversion keeps the Inventory page extensionless import, desktop grouped
    table, mobile compact product cards, selection indeterminate states,
    low/out-of-stock badges, price/sales metrics, and inventory mobile-card
    layout guard intact.
527. Convert the inventory movements surface to TSX. Done:
    `frontend/src/components/inventory/InventoryMovementsSurface.tsx` now
    types movement records, grouped movement sections, action groups, expanded
    group page state, movement metadata, selected group ids, action history,
    export menu items, date filters, selection scopes, movement detail
    callbacks, and injected pagination controls. The conversion keeps the
    Inventory page extensionless lazy import, mobile movement cards, desktop
    grouped movement table, custom date range controls, selection/export
    actions, product detail callbacks, and RFID movement-source guard intact.
528. Convert the loyalty points page to TSX. Done:
    `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx` now types
    loyalty settings form state, basis/section ids, app-context callbacks,
    `window.api` customer and membership lookup calls, customer point rows,
    lookup result totals, copy fallbacks, error handling, and numeric policy
    coercion helpers. The conversion keeps the app extensionless lazy import,
    section switcher persistence, loading watchdog retry path, bounded customer
    reads, bounded membership lookup, same-tick point-rule save guard,
    customer leaderboard, policy preview, and route guard tests intact while
    moving exact source-path guards to TSX.
529. Convert the sync server page to TSX. Done:
    `frontend/src/components/server/ServerPage.tsx` now types sync-server app
    context access, copy fallback helpers, connection info props, diagnostics
    tab ids, call-log rows, server-log rows, write-error events, pending sync
    queue state, system debug payloads, security config, connection test
    results, and the local `window.api` server boundary. The conversion keeps
    the app extensionless lazy import, queue retry/discard same-tick guards,
    timeout-bounded queue/config/debug/test calls, sync-center copy,
    offline-security guard coverage, and pending offline-work diagnostics
    intact while moving exact source-path guards to TSX.
530. Convert the returns page shell to TSX. Done:
    `frontend/src/components/returns/Returns.tsx` now types return rows,
    return line-item snapshots, history restore payloads, mutation result
    payloads, app/sync context access, local return API gateway calls,
    selection ids, grouped return sections, filter/group/sort state, loading
    watchdog timers, and export/stat calculations. The conversion keeps the
    extensionless app lazy import, return list/detail/snapshot/restore timeout
    contracts, same-tick history restore guard, customer/supplier stat
    single-pass summary, grouped selection helpers, layout guard, and action
    stability source checks intact while moving exact source-path guards to
    TSX.
531. Convert the customers contact tab to TSX. Done:
    `frontend/src/components/contacts/CustomersTab.tsx` now types customer
    rows, customer section rows, modal state, app/sync context access,
    local customer API gateway calls, mutation result payloads, contact-option
    helper exports, grouped customer filters, loading watchdog timers,
    customer history undo/redo payloads, and bulk restore bookkeeping. The
    conversion keeps the Contacts page extensionless import, POS
    `parseContactOptions` import contract, point-balance payload loading,
    grouped selection helpers, same-tick save/delete/bulk guards, CSV export,
    and contact pricing/loading source checks intact.
532. Convert the sales page shell to TSX. Done:
    `frontend/src/components/sales/Sales.tsx` now types sale rows, line items,
    user filter options, app/sync context access, local sales API gateway
    calls, status and membership mutation payloads, grouped sale sections,
    selection ids, export rows, loading watchdog timers, and action-history
    payloads. The conversion keeps the Sales page extensionless lazy import,
    receipt/detail/export/import modal contracts, same-tick status and bulk
    guards, bounded user filter reads, grouped selection helpers, CSV export,
    and sales action/performance source checks intact.
533. Convert the delivery contact tab to TSX. Done:
    `frontend/src/components/contacts/DeliveryTab.tsx` now types delivery
    contact rows, section rows, modal state, contact-option form payloads,
    app/sync context access, local delivery API gateway calls, mutation result
    payloads, grouped filters, loading watchdog timers, undo/redo history
    payloads, and bulk restore bookkeeping. The conversion keeps the Contacts
    page extensionless lazy import, delivery import modal contract, grouped
    selection helpers, same-tick save/delete/bulk guards, CSV export, contact
    option display, and action/performance source checks intact.
534. Convert the suppliers contact tab to TSX. Done:
    `frontend/src/components/contacts/SuppliersTab.tsx` now types supplier
    rows, section rows, modal state, contact-option form payloads, app/sync
    context access, local supplier API gateway calls, mutation result payloads,
    grouped filters, loading watchdog timers, undo/redo history payloads, and
    bulk restore bookkeeping. The conversion keeps the Contacts page
    extensionless lazy import, supplier import modal contract, grouped
    selection helpers, same-tick save/delete/bulk guards, CSV export, supplier
    contact option display, and action/performance source checks intact.
535. Convert the branches page shell to TSX. Done:
    `frontend/src/components/branches/Branches.tsx` now types branch rows,
    branch summaries, branch stock pages, transfer history rows, app/sync
    context access, local branch API gateway calls, mutation result payloads,
    selection ids, modal/tab state, loading watchdog timers, action-history
    payloads, and bulk restore bookkeeping. The conversion keeps the
    extensionless app lazy import, branch list/summary/transfer/stock timeout
    contracts, same-tick save/delete/bulk guards, transfer modal handoff,
    three-per-row mobile stat layout, and action/performance source checks
    intact while removing the old direct `window.api` branch calls from the
    page body.
536. Convert the files/library page shell to TSX. Done:
    `frontend/src/components/files/FilesPage.tsx` now types file assets,
    paged file responses, AI provider metadata, provider forms, provider
    mutation/test results, saved AI responses, app/sync context access, local
    files API gateway calls, active tab state, selected asset ids, loading
    request guards, and upload/delete/provider action guards. The conversion
    keeps the extensionless app lazy import, asset upload/delete timeouts,
    library/provider/response read timeouts, provider undo/redo actions,
    compact mobile asset controls, source-inspection tests, and child tab
    contracts intact while sanitizing stale mojibake fallback text before it
    can render in the Library UI.
537. Convert the login/auth shell to TSX. Done:
    `frontend/src/components/auth/Login.tsx` now types auth users, login
    results, OAuth callback payloads, organization matches, verification
    capability payloads, password reset responses, app context access,
    local auth API gateway calls, OTP pending user ids, DOM refs, form
    submit events, OAuth provider state, and error extraction. The conversion
    keeps the extensionless app import, owned Google OAuth source checks,
    login/bootstrap/OTP/reset/OAuth flows, session duration persistence, and
    organization selector behavior intact while containing the JS AppContext
    boundary behind a typed hook cast.
538. Convert the catalog secondary tabs shell to TSX. Done:
    `frontend/src/components/catalog/CatalogSecondaryTabs.tsx` now types
    portal copy functions, preview config, membership customer/points/totals,
    purchase/return rows, share submission rows, submission draft state,
    business facts, social links, about blocks, FAQ items, assistant profile,
    usage policy, assistant references, assistant recommendations, and
    tab-dispatch props. The conversion keeps the extensionless Catalog page
    lazy import, catalog preview chunking rule, portal UI verifier coverage,
    membership lookup, About, FAQ, and AI assistant surfaces intact.
539. Convert the users administration shell to TSX. Done:
    `frontend/src/components/users/Users.tsx` now types user rows, role rows,
    form state, password state, app/sync context access, the local users API
    gateway, mutation result payloads, modal/tab state, loading watchdog
    timers, permission maps, and undo/redo payload construction. The
    conversion keeps the extensionless app lazy import, users/roles load
    timeout contracts, same-tick user/password/role/delete guards, profile
    modal handoff, user detail sheet handoff, and source-inspection tests
    intact while tightening the shared action-history and user-detail null
    boundaries surfaced by the TSX migration.
540. Convert the user profile modal to TSX. Done:
    `frontend/src/components/users/UserProfileModal.tsx` now types profile
    user rows, settings, verification capability payloads, sign-in method
    state, profile mutation results, the local profile API gateway, avatar
    editor props, file-input events, OTP modal mode, active section state, and
    stored organization fallback parsing. The conversion removes the temporary
    temporary profile modal shim from Move 539, keeps the sidebar/profile
    extensionless import path, preserves profile/OTP/auth-method timeout
    contracts, avatar CORS guardrails, Google OAuth source checks, and
    same-tick profile/password/avatar upload guards.
541. Convert the audit log shell to TSX. Done:
    `frontend/src/components/utils-settings/AuditLog.tsx` now types audit
    log rows, paged audit responses, audit user filters, local audit API
    gateway calls, app context access, detail-row props, export items,
    selected id sets, grouped section ids, sort/group modes, animation-frame
    refs, loader watchdog refs, and error extraction. The conversion keeps the
    extensionless app lazy import, utils-settings barrel export, audit read
    and retention-cleanup timeout contracts, same-tick retention cleanup
    guard, grouped selection helpers, CSV export behavior, and source
    inspection tests intact while preventing React click events from being
    interpreted as the loader's silent flag.
542. Convert the backup shell to TSX. Done:
    `frontend/src/components/utils-settings/Backup.tsx` now types backup
    jobs, job metrics/results, integration doctor payloads, Google Drive sync
    status/forms, app context access, action-history rows, the local backup
    API gateway, section ids, action locks, retry timers, job watcher
    handlers, overview cards, and backup/Drive button props. The conversion
    keeps the extensionless utils-settings barrel export, queued export and
    restore flows, Drive sync action timeouts, cancellable job polling,
    overview-only default section, backup reliability verifier, and source
    inspection tests intact while centralizing `window.api` access behind a
    typed `getBackupApi()` boundary.
543. Convert the settings shell to TSX. Done:
    `frontend/src/components/utils-settings/Settings.tsx` now types the
    settings record boundary, app context access, the local settings API
    gateway, OTP status reads, image upload payloads/progress, upload
    controller maps, conflict state, color swatches, navigation items, section
    ids, payment method state, and favicon sanitization. The conversion keeps
    the extensionless utils-settings barrel export, settings save same-tick
    guard, OTP status timeout, favicon preview timeout, image upload timeout,
    upload cancellation/cleanup behavior, section navigation source checks,
    and admin media guard coverage intact while centralizing direct
    `window.api` settings access behind `getSettingsApi()`. The current source
    extension count is `.js: 95`, `.jsx: 8`, `.mjs: 0`, `.cjs: 0`,
    `.ts: 268`, `.tsx: 99` outside generated/runtime folders.
544. Convert the dashboard shell to TSX. Done:
    `frontend/src/components/dashboard/Dashboard.tsx` now types dashboard
    summary and analytics payloads, period/payment/branch/hour rows, product
    stock alerts, customer/product/sale detail rows, app/sync context access,
    range and granularity state, chart/top mode unions, KPI detail modal
    payloads, export dependency loading, and the local dashboard API gateway.
    The conversion keeps the extensionless app lazy import, summary and
    analytics timeout contracts, stale-data handling, compact range/chart
    controls, stock-alert inventory handoff, dashboard export flows, and
    dashboard source checks intact while centralizing direct `window.api`
    dashboard reads behind `getDashboardApi()`. The current source extension
    count is `.js: 95`, `.jsx: 7`, `.mjs: 0`, `.cjs: 0`, `.ts: 268`,
    `.tsx: 100` outside generated/runtime folders.
545. Convert the app shell to TSX. Done:
    `frontend/src/App.tsx` now types page ids, lazy route importers, app
    context access, notification payloads, sync/offline event details,
    pending-sync state, app-shell API calls, network-information reads,
    page-error boundary props/state, page slot props, route warmup loaders,
    timer/idle handles, scroll direction, and chunk recovery helpers. The
    conversion keeps route chunk retry/reload recovery, bounded stale cache
    deletion, compact mounted-page retention, navigation-intent warmup,
    offline sale notices, global sync banners, public catalog routing, favicon
    shaping, and app-shell source checks intact while moving `index.tsx`,
    focused tests, and performance verification to the TSX shell. The current
    source extension count is `.js: 95`, `.jsx: 6`, `.mjs: 0`, `.cjs: 0`,
    `.ts: 268`, `.tsx: 101` outside generated/runtime folders.
546. Convert the app context provider to TSX. Done:
    `frontend/src/AppContext.tsx` now types global settings, authenticated
    user payloads, bootstrap organization/system payloads, notifications,
    write-conflict details, sync-channel events, the public app/sync context
    values, and the local runtime API gateway used for auth, settings,
    Google OAuth, session duration refreshes, public asset URLs, and sync URL
    updates. The conversion keeps app bootstrap, settings load/save, login,
    logout, OAuth completion, runtime mismatch recovery, websocket polling,
    device-local settings, permission checks, Khmer/English translation
    fallback, and receipt/settings source guards intact while replacing direct
    `window.api` calls with typed `getAppApi()` access. The current source
    extension count is `.js: 95`, `.jsx: 5`, `.mjs: 0`, `.cjs: 0`,
    `.ts: 267`, `.tsx: 102` outside generated/runtime folders.
547. Convert the POS shell to TSX. Done:
    `frontend/src/components/pos/POS.tsx` now types POS products, grouped
    product metadata, cart lines, orders, customer/delivery contacts, membership
    lookups, receipt queue payloads, image lightbox state, app/sync context
    access, and the local POS API gateway for catalog reads, contact reads,
    quick-add creates, membership lookup, and checkout. The conversion keeps
    the extensionless app lazy import, POS product-grid responsiveness, product
    family grouping, timeout contracts, same-tick quick-add/checkout guards,
    cart branch validation, promotion/special price handling, and source
    inspection tests intact while replacing direct `window.api` access with
    typed `getPosApi()` calls. The current source extension count is `.js: 95`,
    `.jsx: 4`, `.mjs: 0`, `.cjs: 0`, `.ts: 268`, `.tsx: 103` outside
    generated/runtime folders.
548. Convert the catalog editor surface to TSX. Done:
    `frontend/src/components/catalog/CatalogEditorSurface.tsx` now types the
    catalog editor context boundary, draft settings payload, editor section
    tuples, recommended-product options, promotion/about/FAQ/review rows,
    upload states, preview config, drag/drop helpers, review status actions,
    and media picker/gallery callbacks. The conversion keeps the extensionless
    catalog lazy import, dedicated `catalog-editor` build chunk, portal grid
    source checks, drag/drop ordering, media upload controls, review queue
    actions, and public portal editor behavior intact while allowing typed
    consumers of `useCatalogPageContext<T>()`. The current source extension
    count is `.js: 95`, `.jsx: 3`, `.mjs: 0`, `.cjs: 0`, `.ts: 268`,
    `.tsx: 104` outside generated/runtime folders.
549. Convert the products page shell to TSX. Done:
    `frontend/src/components/products/Products.tsx` now types product rows,
    lookup rows, branch stock rows, filter metadata, modal state,
    search/sort/bulk-edit unions, lightbox state, app/sync context access,
    action-history restore payloads, and the local product API gateway. The
    conversion keeps the extensionless app lazy import, product grouping and
    pagination helpers, compact controls, product source checks, undo/redo
    product restore paths, image upload, bulk stock actions, and detail/form
    modals intact while centralizing direct product API calls behind
    `getProductApi()`. Product modal boundaries now normalize optional
    database values before they reach stricter TSX child components. The
    current source extension count is `.js: 95`, `.jsx: 2`, `.mjs: 0`,
    `.cjs: 0`, `.ts: 268`, `.tsx: 105` outside generated/runtime folders.
550. Convert the catalog page shell to TSX. Done:
    `frontend/src/components/catalog/CatalogPage.tsx` now types the public and
    editor portal state, catalog product/filter options, portal cache payloads,
    media upload state, file picker state, gallery state, translation globals,
    app/sync context access, and the local catalog API gateway. The conversion
    keeps the extensionless catalog chunk imports, portal timeout contracts,
    bounded image reads, Google Translate fallback, customer membership lookup,
    share-proof submission/review actions, and public portal rendering intact
    while replacing direct catalog `window.api` calls with `getCatalogApi()`.
    The current source extension count is `.js: 95`, `.jsx: 1`, `.mjs: 0`,
    `.cjs: 0`, `.ts: 268`, `.tsx: 106` outside generated/runtime folders.
551. Convert the inventory page shell to TSX. Done:
    `frontend/src/components/inventory/Inventory.tsx` now types inventory
    product rows, branch rows, movement rows, saved reasons, stat-detail
    payloads, batch stock-session rows, filter state, RFID status reads,
    app/sync context access, and the local inventory API gateway. The
    conversion keeps the extensionless app lazy import, inventory surface
    imports, selection helpers, grouped movement behavior, RFID section,
    import modal, undo/redo stock history, loader timeout contracts, and
    same-tick stock mutation guards intact while replacing direct inventory
    `window.api` calls with `getInventoryApi()`. This closes the frontend
    JSX-to-TSX source lane. The current source extension count is `.js: 95`,
    `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 268`, `.tsx: 107` outside
    generated/runtime folders.
552. Convert the frontend API method registry to TypeScript. Done:
    `frontend/src/api/methods.ts` now owns the browser domain API registry path,
    and `frontend/src/web-api.ts`, source-reading tests, and docs point at the
    TypeScript module. This keeps the lazy API bootstrap, offline sync queue,
    backup/import/POS/product routes, local mirror behavior, and Vite chunking
    unchanged while removing the final first-party frontend app `.js` module.
    The file remains a temporary `ts-nocheck` legacy boundary because the
    registry still mixes many dynamic payloads and Dexie table names; future
    moves should extract typed domain sections from it before removing that
    marker. The current source extension count is `.js: 94`, `.jsx: 0`,
    `.mjs: 0`, `.cjs: 0`, `.ts: 269`, `.tsx: 107` outside generated/runtime
    folders.
553. Convert the backend initials helper to a package-safe TypeScript path.
    Done: `backend/src/initials.ts` now owns Khmer initial ordering,
    classifier return unions, row aggregation input, and aggregate output with
    JSDoc types while preserving valid JavaScript syntax and the CommonJS
    export surface used by backend routes. Product, inventory, portal, and
    focused test imports now point at the explicit `.ts` module, and
    `backend/package.json` includes `src/**/*.ts` in the Linux packaging script
    list so the converted helper is not omitted from packaged builds. The
    focused test also uses ASCII Unicode escapes for Khmer assertions to avoid
    terminal encoding drift. The current source extension count is `.js: 93`,
    `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 270`, `.tsx: 107` outside
    generated/runtime folders.
554. Convert backend money and idempotency helpers to package-safe TypeScript
    paths. Done: `backend/src/money.ts` now owns finite-number coercion,
    round-up price normalization, and price-value normalization with JSDoc
    parameter/return contracts, and `backend/src/idempotency.ts` now owns the
    bounded client request id normalizer. Product, inventory, sales, returns,
    import parsing, product discounts, import jobs, and focused tests now
    import the explicit `.ts` helper paths. Focused price/import/idempotency
    tests, backend utility tests, and Linux packaging proof passed; packaging
    still warns that `.ts` files in `pkg.scripts` are parsed as non-JavaScript,
    so larger backend conversions remain blocked on a compile/staging lane.
    The current source extension count is `.js: 91`, `.jsx: 0`, `.mjs: 0`,
    `.cjs: 0`, `.ts: 272`, `.tsx: 107` outside generated/runtime folders.
555. Convert backend OTP and optional Sharp helpers to package-safe TypeScript
    paths. Done: `backend/src/authOtpGuards.ts` now owns OTP target-management
    checks with JSDoc actor/target/password contracts, and
    `backend/src/optionalSharp.ts` now owns optional Sharp resolution with a
    typed cached module boundary. Auth routes, upload security, file-asset
    optimization, and focused auth/upload/media tests now import the explicit
    `.ts` paths. Focused tests, backend utility tests, and Linux packaging proof
    passed; packaging continues to warn for backend `.ts` scripts until the
    future compile/staging lane replaces direct `pkg.scripts` parsing. The
    current source extension count is `.js: 89`, `.jsx: 0`, `.mjs: 0`,
    `.cjs: 0`, `.ts: 274`, `.tsx: 107` outside generated/runtime folders.
556. Convert backend request context and organization folder helpers to
    package-safe TypeScript paths. Done: `backend/src/requestContext.ts` now
    owns request metadata extraction, header cleanup, middleware assignment,
    and per-request metadata reads with JSDoc request/meta contracts, and
    `backend/src/storage/organizationFolders.ts` now owns organization folder
    label/path/public-id helpers with string/path result contracts. Server,
    helper, config, and organization-context imports now target explicit `.ts`
    paths. Focused server/route/data/runtime/automation tests, the full backend
    utility suite, and Linux packaging proof passed; packaging still warns for
    direct `.ts` entries in `pkg.scripts`, so larger backend route/service
    conversions remain blocked on the future compile/staging lane. The current
    source extension count is `.js: 87`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`,
    `.ts: 276`, `.tsx: 107` outside generated/runtime folders.
557. Convert backend catalog text integrity and write-conflict helpers to
    package-safe TypeScript paths. Done: `backend/src/catalogTextIntegrity.ts`
    now owns Khmer-safe catalog text normalization, mojibake/question-mark
    detection, suspicious-field listing, and option-list normalization with
    JSDoc text option and record contracts. `backend/src/conflictControl.ts`
    now owns updated-at conflict detection and structured conflict responses
    with JSDoc conflict record/JSON response contracts. Category, unit,
    product, inventory, settings, runtime, import-job, and write-conflict route
    imports now target explicit `.ts` paths, and the settings/media contract
    source test now reads the converted helper. Focused route/import/product/
    settings tests, the full backend utility suite, and Linux packaging proof
    passed; packaging still warns for direct `.ts` entries in `pkg.scripts`, so
    larger backend route/service conversions remain blocked on the future
    compile/staging lane. The current source extension count is `.js: 85`,
    `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 278`, `.tsx: 107` outside
    generated/runtime folders.
558. Convert backend runtime state, maintenance lock, and portal utilities to
    package-safe TypeScript paths. Done: `backend/src/runtimeState/index.ts`
    now owns runtime storage-version state and runtime descriptor generation
    with JSDoc state/descriptor contracts; `backend/src/maintenanceLock.ts`
    now owns restore/backup maintenance lock acquisition, release, scoped
    execution, and API write guarding with JSDoc lock/request/response
    contracts; and `backend/src/portalUtils.ts` now owns portal about-block and
    Google Maps embed normalization with JSDoc about-block contracts. Server,
    auth, system, portal, Google Drive sync, offline-security, portal utility,
    and backup-reliability verification imports now target explicit `.ts`
    paths. Focused portal/offline/route/runtime/backup-reliability checks, the
    full backend utility suite, and Linux packaging proof passed; packaging
    still warns for direct `.ts` entries in `pkg.scripts`, so larger backend
    route/service conversions remain blocked on the future compile/staging
    lane. The current source extension count is `.js: 82`, `.jsx: 0`,
    `.mjs: 0`, `.cjs: 0`, `.ts: 281`, `.tsx: 107` outside
    generated/runtime folders.
559. Convert backend worker entrypoints and the system filesystem worker to
    package-safe TypeScript paths. Done:
    `backend/src/workers/importWorker.ts` and
    `backend/src/workers/mediaWorker.ts` now own the dedicated background worker
    startup paths with JSDoc start/shutdown contracts, and
    `backend/src/systemFsWorker.ts` now owns child-process export/relocate
    filesystem work with JSDoc payload/response contracts. Backend worker npm
    scripts, server worker-role dispatch, PM2 config, Docker scale health
    checks, Windows run scripts, PowerShell runtime readiness checks, system
    route worker spawning, and performance verification now target explicit
    `.ts` paths. Focused worker-entrypoint loading, system filesystem export
    smoke, route/full-automation/performance checks, the full backend utility
    suite, and Linux packaging proof passed. Packaging still warns for direct
    `.ts` entries in `pkg.scripts`, so larger backend route/service
    conversions remain blocked on the future compile/staging lane. The current
    source extension count is `.js: 79`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`,
    `.ts: 284`, `.tsx: 107` outside generated/runtime folders.
560. Convert backend import/product normalization helpers to package-safe
    TypeScript paths. Done: `backend/src/contactOptions.ts` now owns structured
    contact option normalization with JSDoc mode/source/normalized-option
    contracts; `backend/src/productImportPolicies.ts` now owns numeric, flag,
    field-rule, append-unique, and image-conflict import policy helpers with
    explicit rule-mode contracts; and `backend/src/productDiscounts.ts` now owns
    discount normalization and active-price calculation with JSDoc product
    discount contracts. Contacts routes, product/inventory routes, import-job
    services, and focused backend tests now target explicit `.ts` paths.
    Focused contact/import-policy/route/product/import-decision checks, the full
    backend utility suite, and Linux packaging proof passed. Packaging still
    warns for direct `.ts` entries in `pkg.scripts`, so larger backend
    route/service conversions remain blocked on the future compile/staging lane.
    The current source extension count is `.js: 76`, `.jsx: 0`, `.mjs: 0`,
    `.cjs: 0`, `.ts: 287`, `.tsx: 107` outside generated/runtime folders.
561. Convert the shared backend schema metadata helper to a package-safe
    TypeScript path. Done: `backend/src/schemaMetadata.ts` now owns cached
    table/column probing with JSDoc column-row and cache-key helper contracts.
    Branch, custom-table, inventory, product, and settings routes now target
    explicit `.ts` imports, and the route-contract test now guards
    `schemaMetadata.ts` as the shared probe boundary. Focused schema metadata,
    route-contract, RFID, product-search, and full-automation checks passed, as
    did the full backend utility suite and Linux packaging proof. Packaging
    still warns for direct `.ts` entries in `pkg.scripts`, so larger backend
    route/service conversions remain blocked on the future compile/staging lane.
    The current source extension count is `.js: 75`, `.jsx: 0`, `.mjs: 0`,
    `.cjs: 0`, `.ts: 288`, `.tsx: 107` outside generated/runtime folders.
562. Convert backend runtime version diagnostics to a package-safe TypeScript
    path. Done: `backend/src/runtimeVersion.ts` now owns runtime/build metadata
    with JSDoc runtime and frontend build-info contracts, and its source-hash
    scan now includes `.ts` files so converted backend source participates in
    stale-bundle detection. Server startup, runtime routes, Google Drive sync
    manifests, runtime-version tests, and runtime dependency guardrails now
    target explicit `.ts` paths. Focused runtime, route-contract, Drive sync,
    runtime-dependency, and full-automation checks passed, as did the full
    backend utility suite and Linux packaging proof. Packaging still warns for
    direct `.ts` entries in `pkg.scripts`, so larger backend route/service
    conversions remain blocked on the future compile/staging lane. The current
    source extension count is `.js: 74`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`,
    `.ts: 289`, `.tsx: 107` outside generated/runtime folders.
563. Convert backend runtime cache helper to a package-safe TypeScript path.
    Done: `backend/src/runtimeCache.ts` now owns Redis-backed runtime cache
    helpers with JSDoc cache-status and invalidation contracts. Portal/runtime
    routes, the shared helper invalidation path, and runtime cache tests now
    target explicit `.ts` imports while preserving ordered prefix invalidation.
    Focused runtime-cache, route-contract, portal regression, and
    full-automation checks passed, as did the full backend utility suite and
    Linux packaging proof. Packaging still warns for direct `.ts` entries in
    `pkg.scripts`, so larger backend route/service conversions remain blocked
    on the future compile/staging lane. The current source extension count is
    `.js: 73`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 290`, `.tsx: 107`
    outside generated/runtime folders.
564. Convert backend access-control helper to a package-safe TypeScript path.
    Done: `backend/src/accessControl.ts` now owns request access
    classification, public API allowlist checks, legacy Tailscale identity
    detection, and sync-token presentation helpers with JSDoc request/access
    contracts. Middleware, auth routes, system routes, and access-control tests
    now target explicit `.ts` imports, and the stale unused security import was
    removed from the helper. Focused access-control, auth OTP, route-contract,
    offline-security, and full-automation checks passed, as did the full
    backend utility suite, schema audit, and Linux packaging proof. Packaging
    still warns for direct `.ts` entries in
    `pkg.scripts`, so larger backend route/service conversions remain blocked
    on the future compile/staging lane. The current source extension count is
    `.js: 72`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 291`, `.tsx: 107`
    outside generated/runtime folders.
565. Convert backend backup schema helper to a package-safe TypeScript path.
    Done: `backend/src/backupSchema.ts` now owns backup version, backup table
    coverage, restore clear order, non-backup table exclusions, and backup
    summary counts with JSDoc row/count/upload summary contracts. System backup
    routes, backup package services, backup schema tests, schema relationship
    docs, and the schema audit source map now target explicit `.ts` paths.
    Focused backup-schema, backup-performance, backup-retention,
    route-contract, schema-audit, and full-automation checks passed, as did the
    full backend utility suite and Linux packaging proof. Packaging still warns
    for direct `.ts` entries in `pkg.scripts`, so larger backend route/service
    conversions remain blocked on the future compile/staging lane. The current source
    extension count is `.js: 71`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 292`,
    `.tsx: 107` outside generated/runtime folders.
566. Convert backend business metrics helper to a package-safe TypeScript path.
    Done: `backend/src/businessMetrics.ts` now owns sellable product SQL
    predicates, effective-cost expressions, stock metric aggregation, low/out
    stock alerts, and expiry alert queries with JSDoc metric-row and query
    option contracts. Branch, inventory, notification, product, and sales routes
    now target explicit `.ts` imports, and source-inspection tests now read the
    TypeScript helper. Focused product-expiry, product-batch hierarchy,
    route-contract, notification-cache, portal-regression, and full-automation
    checks passed, as did the full backend utility suite, schema audit, and
    Linux packaging proof. Packaging still
    warns for direct `.ts` entries in `pkg.scripts`, so larger backend
    route/service conversions remain blocked on the future compile/staging
    lane. The current source extension count is `.js: 70`, `.jsx: 0`, `.mjs: 0`,
    `.cjs: 0`, `.ts: 293`, `.tsx: 107` outside generated/runtime folders.
567. Convert backend import CSV and numeric parsing helpers to package-safe
    TypeScript paths. Done: `backend/src/importCsv.ts` now owns delimiter
    detection, row parsing, streaming batch parsing, and CSV key normalization
    with JSDoc CSV option/row contracts, and `backend/src/importParsing.ts`
    now owns localized numeric text and money import normalization with JSDoc
    number option contracts. The duplicated `hasDelimitedRowContent` helper was
    removed while preserving behavior. Import-job services, product import
    policies, import CSV tests, import scale smoke tests, and the performance
    verifier now target explicit `.ts` paths. Focused import CSV,
    import-scale, import-policy, import-decision, route-contract, performance
    verifier, and full-automation checks passed, as did the full backend utility
    suite, schema audit, and Linux packaging proof. Packaging still warns for
    direct `.ts` entries in
    `pkg.scripts`, so larger backend route/service conversions remain blocked
    on the future compile/staging lane. The current source extension count is
    `.js: 68`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 295`, `.tsx: 107`
    outside generated/runtime folders.
568. Convert backend network and upload security helpers to package-safe
    TypeScript paths. Done: `backend/src/netSecurity.ts` now owns outbound URL,
    blocked-host, and safe external image reference checks with JSDoc URL option
    contracts, and `backend/src/uploadSecurity.ts` now owns buffer kind,
    uploaded file-kind, image metadata, and upload validation checks with JSDoc
    uploaded-file contracts. File assets, middleware, AI gateway, import jobs,
    portal/products routes, and focused security tests now target explicit
    `.ts` paths. Focused net-security, upload-security, route-contract,
    offline-security, upload-reference, import-decision, and performance
    verifier checks passed, as did the full backend utility suite, schema
    audit, and Linux packaging proof.
    Packaging still warns for direct `.ts` entries in `pkg.scripts`, so larger
    backend route/service conversions remain blocked on the future
    compile/staging lane. The current source extension count is `.js: 66`,
    `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 297`, `.tsx: 107` outside
    generated/runtime folders.
569. Convert backend permission policy and settings snapshot helpers to
    package-safe TypeScript paths. Done: `backend/src/permissions.ts` now owns
    permission definitions, default role permission maps, action-history
    permission mapping, and sensitive-permission checks with JSDoc permission
    map contracts. `backend/src/settingsSnapshot.ts` now owns upload path
    normalization, object-key projection, media list sanitization, local/object
    existence checks, and settings snapshot sanitization with JSDoc snapshot and
    existence-cache contracts. Middleware, Postgres seeding, action-history,
    auth/catalog/portal/product/settings routes, file assets, upload reference
    cleanup, and focused tests now target explicit `.ts` paths. Focused
    permission-policy, settings snapshot object-storage, portal-regression,
    file asset usage/cache, file asset storage/reconcile, route-contract,
    offline-security, and performance verifier checks passed, as did the full
    backend utility suite, schema audit, and Linux packaging proof. Packaging
    still warns for direct `.ts`
    entries in `pkg.scripts`, so larger backend route/service conversions
    remain blocked on the future compile/staging lane. The current source
    extension count is `.js: 64`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 299`,
    `.tsx: 107` outside generated/runtime folders.
570. Convert backend database adapter entrypoint to a package-safe TypeScript
    path. Done: `backend/src/database.ts` remains a minimal CommonJS
    passthrough to the Postgres adapter, while the backend server, routes,
    services, workers, source-inspection tests, and docs now target explicit
    `.ts` imports. This keeps database behavior unchanged while removing the
    last JavaScript adapter wrapper. Focused database load, schema-metadata,
    file-asset usage/cache, route-contract, Postgres database, Postgres
    cutover-readiness, data-path, and performance verifier checks are the
    required proof slice before this move is accepted, followed by the full
    backend utility suite, schema audit, and Linux packaging proof. Packaging
    still warns for direct `.ts` entries in `pkg.scripts`, so
    larger backend route/service conversions remain blocked on the future
    compile/staging lane. The current source extension count is `.js: 63`,
    `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 300`, `.tsx: 107` outside
    generated/runtime folders.
571. Convert backend DuckDB runtime helper to a package-safe TypeScript path.
    Done: `backend/src/analytics/duckdbRuntime.ts` keeps the existing optional
    package-probe behavior while adding JSDoc option/probe contracts for the
    analytics runtime boundary. The backend server, system routes, integration
    doctor, and focused analytics runtime test now import the explicit `.ts`
    path. Focused helper load, analytics runtime, route-contract, and stale-path
    scans passed, as did the full backend utility suite, schema audit, and
    Linux packaging proof. Packaging still warns for direct `.ts` entries in
    `pkg.scripts`, so larger backend
    route/service conversions remain blocked on the future compile/staging
    lane. The current source extension count is `.js: 62`, `.jsx: 0`,
    `.mjs: 0`, `.cjs: 0`, `.ts: 301`, `.tsx: 107` outside generated/runtime
    folders.
572. Convert Google Drive sync versioning helper to a package-safe TypeScript
    path. Done: `backend/src/services/googleDriveSync/versioning.ts` keeps the
    existing version rotation and retention behavior while adding JSDoc input
    and version item contracts. The main Google Drive sync service and focused
    versioning test now import the explicit `.ts` path, and older roadmap
    references were normalized to avoid stale path drift. Focused helper load,
    Google Drive sync versioning, integration-doctor, and stale-path scans
    passed, as did the full backend utility suite, schema audit, and Linux
    packaging proof. Packaging still warns for direct `.ts` entries in
    `pkg.scripts`, so larger backend route/service
    conversions remain blocked on the future compile/staging lane. The current
    source extension count is `.js: 61`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`,
    `.ts: 302`, `.tsx: 107` outside generated/runtime folders.
573. Convert Postgres cutover-readiness helper to a package-safe TypeScript
    path. Done: `backend/src/db/cutoverReadiness.ts` keeps the existing
    forbidden-pattern and packaged-runtime readiness report shape while adding a
    JSDoc options contract and scanning both `.js` and `.ts` backend source
    files. System routes, the cutover-readiness test, and the Docker release
    PowerShell verifier now import the explicit `.ts` path. Focused helper
    load, Postgres cutover-readiness, route-contract, Docker release guardrail,
    and stale-path scans passed, as did the full backend utility suite, schema
    audit, and Linux packaging proof. Packaging still warns for direct `.ts`
    entries in `pkg.scripts`, so larger
    backend route/service conversions remain blocked on the future
    compile/staging lane. The current source extension count is `.js: 60`,
    `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 303`, `.tsx: 107` outside
    generated/runtime folders.
574. Convert Postgres query compatibility helper to a package-safe TypeScript
    path. Done: `backend/src/db/postgresQueryCompat.ts` keeps SQL parameter
    translation, portable SQL normalization, INSERT OR IGNORE conversion,
    RETURNING behavior, and row coercion unchanged while adding a JSDoc
    translation-options contract. The Postgres adapter and focused query
    compatibility test now import the explicit `.ts` path, and older roadmap
    references were normalized to avoid stale path drift. Focused helper load,
    Postgres query compatibility, Postgres database, route-contract, and
    stale-path scans passed, as did the full backend utility suite, schema
    audit, and Linux packaging proof. Packaging still warns for direct `.ts` entries in
    `pkg.scripts`, so larger backend route/service conversions remain blocked
    on the future compile/staging lane. The current source extension count is
    `.js: 59`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 304`, `.tsx: 107`
    outside generated/runtime folders.
575. Convert backend data-path relocation helper to a package-safe TypeScript
    path. Done: `backend/src/dataPath/index.ts` keeps path comparison,
    data-root layout creation, file walking, summarization, copy, archive, and
    relocation behavior unchanged while adding JSDoc contracts for file
    visitors, summaries, and relocation options. Organization context,
    system routes, Google Drive sync, the system filesystem worker, and the
    focused data-path test now import the explicit `dataPath/index.ts` path so
    directory index resolution is not implicit. Focused helper load, data-path,
    system-jobs, Google Drive sync versioning, route-contract, and stale-path
    scans passed, as did the full backend utility suite, schema audit, and
    Linux packaging proof.
    Packaging still warns for direct `.ts` entries in `pkg.scripts`, so larger
    backend route/service conversions remain blocked on the future
    compile/staging lane. The current source extension count is `.js: 58`,
    `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 305`, `.tsx: 107` outside
    generated/runtime folders.
576. Convert backend security helper to a package-safe TypeScript path. Done:
    `backend/src/security.ts` keeps secret encryption/decryption fallback,
    rate limiting, timing-safe comparison, and abuse-lock behavior unchanged
    while adding JSDoc contracts for rate-limit and abuse-lock result shapes.
    Auth, portal, system, middleware, AI gateway, and Google Drive sync callers
    now import the explicit `.ts` path. `backend/test/security.test.ts` was
    added to the backend utility suite to protect plaintext fallback, rate-limit
    blocking/reset, safe comparison, and abuse-lock clear behavior directly.
    Focused security, route-contract, offline-security, owned-Google-auth,
    integration-doctor, and stale-path scans passed, as did the full backend
    utility suite, schema audit, and Linux packaging proof. Packaging still warns for direct
    `.ts` entries in `pkg.scripts`, so larger backend route/service conversions
    remain blocked on the future compile/staging lane. The current source
    extension count is `.js: 57`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 306`,
    `.tsx: 107` outside generated/runtime folders.
577. Convert organizations route to a package-safe TypeScript path. Done:
    `backend/src/routes/organizations.ts` keeps bootstrap, organization search,
    and current organization context responses unchanged while making the
    route entrypoint explicit for the backend server and route-contract tests.
    `backend/test/routeContracts.test.ts` now asserts the `/bootstrap`,
    `/search`, and `/current` organization routes directly. Focused route
    contracts, organization route load, auth/security-adjacent smoke, and
    stale-path scans passed, as did the full backend utility suite, schema
    audit, and Linux packaging proof. Packaging still warns for direct `.ts` entries in
    `pkg.scripts`, so larger backend route/service conversions remain blocked
    on the future compile/staging lane. The current source extension count is
    `.js: 56`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 307`, `.tsx: 107`
    outside generated/runtime folders.
578. Convert lightweight catalog route to a package-safe TypeScript path. Done:
    `backend/src/routes/catalog.ts` keeps the internal catalog metadata and
    product read API on the existing CommonJS route style while making the
    backend server import the explicit `.ts` entrypoint. Backend route docs,
    the route README, and `backend/test/routeContracts.test.ts` now point at
    the TypeScript route and assert `/meta` plus `/products` registration.
    Focused route-contract, catalog route load, backend utility, schema audit,
    stale-path, and Linux packaging proof passed. Packaging still warns for
    direct `.ts` entries in `pkg.scripts`, so larger backend route/service
    conversions remain blocked on the future compile/staging lane. The
    current source extension count is `.js: 55`, `.jsx: 0`, `.mjs: 0`,
    `.cjs: 0`, `.ts: 308`, `.tsx: 107` outside generated/runtime folders.
579. Convert backend WebSocket entrypoint to a package-safe TypeScript path.
    Done: `backend/src/websocket.ts` keeps the shared `attachWss()` server hook,
    origin/session checks, rate-limit counters, ping/pong behavior, and shared
    `wss_clients` boundary unchanged while `backend/server.js` imports the
    explicit `.ts` entrypoint. `backend/test/websocket.test.ts` now guards the
    exported server hook and is wired into `backend` `test:utils`. Focused
    WebSocket module load, server utility, backend utility, schema audit,
    stale-path, and Linux packaging proof passed. Packaging still warns for
    direct `.ts` entries in `pkg.scripts`, so larger backend route/service
    conversions remain blocked on the future compile/staging lane. The
    current source extension count is `.js: 54`, `.jsx: 0`, `.mjs: 0`,
    `.cjs: 0`, `.ts: 309`, `.tsx: 107` outside generated/runtime folders.
580. Convert runtime diagnostics route to a package-safe TypeScript path.
    Done: `backend/src/routes/runtime.ts` keeps runtime version, queue/cache
    status, and catalog-integrity diagnostics on the existing CommonJS route
    style while `backend/server.js` and runtime dependency guardrails import or
    verify the explicit `.ts` path. `backend/test/routeContracts.test.ts` now
    asserts `/version`, `/queues/status`, and `/catalog-integrity` route
    registration. Focused route-contract, runtime route load, runtime-deps
    guardrail, backend utility, schema audit, stale-path, and Linux packaging
    proof passed. Packaging still warns for direct `.ts` entries in
    `pkg.scripts`, so larger backend route/service conversions remain blocked
    on the future compile/staging lane. The current source extension count is
    `.js: 53`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 310`, `.tsx: 107`
    outside generated/runtime folders.
581. Convert notifications summary route to a package-safe TypeScript path.
    Done: `backend/src/routes/notifications.ts` keeps the notification summary
    sections, effective-permission cache key, inventory/expiry/sales/loyalty/
    portal/system builders, and cache test hook on the existing CommonJS route
    style while `backend/server.js` imports the explicit `.ts` route. The
    notification summary separator now uses a plain ASCII separator so
    generated notification text avoids glyph/encoding drift. The notification
    cache, product-expiry, and route-contract tests now point at or assert the
    TypeScript route. Focused notification cache, product-expiry,
    route-contract, backend utility, schema audit, stale-path, and Linux
    packaging proof passed. Packaging still warns for direct `.ts` entries in
    `pkg.scripts`, so larger backend route/service conversions remain blocked
    on the future compile/staging lane. The current source extension count is
    `.js: 52`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 311`, `.tsx: 107`
    outside generated/runtime folders.
582. Convert files API route to a package-safe TypeScript path.
    Done: `backend/src/routes/files.ts` keeps file listing, upload, media
    optimization enqueueing, write-conflict delete handling, rate limiting,
    synchronous image compression, and upload validation on the existing
    CommonJS route style while `backend/server.js` imports the explicit `.ts`
    route. The hardening policy and media contract tests now point at the
    TypeScript path, and `backend/test/routeContracts.test.ts` asserts the
    list, upload, and delete route registrations. Focused route-contract,
    media-contract, route-load, backend utility, schema audit, stale-path, and
    Linux packaging proof passed. The older temp-server file-route flow remains
    environment-blocked in this shell because the Postgres-only runtime needs
    the native libpq bridge available inside the scaled runtime container.
    Packaging still warns for direct `.ts` entries in `pkg.scripts`, so larger
    backend route/service conversions remain blocked on the future
    compile/staging lane. The current source extension count is `.js: 51`,
    `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 312`, `.tsx: 107` outside
    generated/runtime folders.
583. Convert categories lookup route to a package-safe TypeScript path.
    Done: `backend/src/routes/categories.ts` keeps category list/create/update/
    delete behavior, catalog text integrity checks, merge-on-duplicate rename,
    product category rewrites, write-conflict handling, audit entries, and sync
    broadcasts on the existing CommonJS route style while `backend/server.js`
    imports the explicit `.ts` route. Backend route docs and the route folder
    guide now point at the TypeScript path, and
    `backend/test/routeContracts.test.ts` asserts category CRUD route
    registration. Focused route-contract, category route-load, backend utility,
    schema audit, stale-path, and Linux packaging proof passed. Packaging still
    warns for direct `.ts` entries in `pkg.scripts`, so larger backend
    route/service conversions remain blocked on the future compile/staging
    lane. The current source extension count is `.js: 50`, `.jsx: 0`,
    `.mjs: 0`, `.cjs: 0`, `.ts: 313`, `.tsx: 107` outside generated/runtime
    folders.
584. Convert units lookup route to a package-safe TypeScript path.
    Done: `backend/src/routes/units.ts` keeps unit list/create/update/delete
    behavior, catalog text integrity checks, merge-on-duplicate rename, product
    unit rewrites, write-conflict handling, audit entries, and sync broadcasts
    on the existing CommonJS route style while `backend/server.js` imports the
    explicit `.ts` route. Backend route docs and the route folder guide now
    point at the TypeScript path, and `backend/test/routeContracts.test.ts`
    asserts unit CRUD route registration. Focused route-contract, unit
    route-load, backend utility, schema audit, stale-path, and Linux packaging
    proof passed. Packaging still warns for direct `.ts` entries in
    `pkg.scripts`, so larger backend route/service conversions remain blocked
    on the future compile/staging lane. The generated language audit now
    reports `JavaScript: 38`, `TypeScript: 273`, and `React TSX: 107` across
    the active scan roots.
585. Convert settings route to a package-safe TypeScript path.
    Done: `backend/src/routes/settings.ts` keeps settings read/write, metadata,
    brand option normalization, write-conflict responses, snapshot sanitation,
    audit entries, upload-reference reconcile scheduling, and sync broadcasts on
    the existing CommonJS route style while `backend/server.js` imports the
    explicit `.ts` route. Backend route docs and the route folder guide now
    point at the TypeScript path, and the route-contract and media/settings
    contract tests read the TypeScript source. Focused route-contract,
    settings/media contract, settings route-load, backend utility, schema audit,
    stale-path, and Linux packaging proof passed. Packaging still warns for
    direct `.ts` entries in `pkg.scripts`, so larger backend route/service
    conversions remain blocked on the future compile/staging lane. The
    generated language audit now reports `JavaScript: 37`, `TypeScript: 274`,
    and `React TSX: 107` across the active scan roots.
586. Convert session auth helper to a package-safe TypeScript path.
    Done: `backend/src/sessionAuth.ts` keeps cookie-only session transport,
    session expiry selection, secure-cookie detection, token hashing, presented
    cookie parsing, session lookup, last-seen updates, session revocation, and
    user-session revocation on the existing CommonJS helper style. Middleware,
    WebSocket, auth route, user route, offline security tests, and the hardening
    policy now point at the explicit `.ts` helper. Focused session helper load,
    offline security, WebSocket, route-contract, backend utility, schema audit,
    stale-path, and Linux packaging proof passed. Packaging still warns for
    direct `.ts` entries in `pkg.scripts`, so broader backend conversions remain
    blocked on the future compile/staging lane. The generated language audit now
    reports `JavaScript: 36`, `TypeScript: 275`, and `React TSX: 107` across
    the active scan roots.
587. Convert media queue service to a package-safe TypeScript path.
    Done: `backend/src/services/mediaQueue.ts` keeps BullMQ initialization,
    Redis connection probing, cancellation-aware media optimization, import-file
    status updates, local fallback execution, enqueueing, worker startup, and
    queue status reporting on the existing CommonJS service style. Runtime,
    file upload, import job, media worker, and import job state-machine callers
    now point at the explicit `.ts` service. Focused media queue load, import
    job state-machine, route-contract, backend utility, schema audit,
    stale-path, and Linux packaging proof passed. Packaging still warns for
    direct `.ts` entries in `pkg.scripts`, so broader backend conversions remain
    blocked on the future compile/staging lane. The generated language audit now
    reports `JavaScript: 35`, `TypeScript: 276`, and `React TSX: 107` across
    the active scan roots.
588. Convert organization context helper to a package-safe TypeScript path.
    Done: `backend/src/organizationContext/index.ts` keeps organization lookup,
    search, group lookup, user context joins, portal public path construction,
    organization filesystem layout creation, metadata file writing, and storage
    alignment status reporting on the existing CommonJS helper style. Auth,
    organizations, portal, users, and system routes now require the explicit
    `.ts` index so directory resolution does not depend on the retired
    `index.js` file. Focused organization helper load, route-contract, backend
    utility, schema audit, stale-path, and Linux packaging proof passed.
    Packaging still warns for direct `.ts` entries in `pkg.scripts`, so broader
    backend conversions remain blocked on the future compile/staging lane. The
    generated language audit now reports `JavaScript: 34`, `TypeScript: 277`,
    and `React TSX: 107` across the active scan roots.
589. Convert upload reference cleanup helper to a package-safe TypeScript path.
    Done: `backend/src/uploadReferenceCleanup.ts` keeps sync and async
    settings, product-image, product-primary-image, user-avatar, file-asset,
    and portal-submission media reference repair behavior on the existing
    CommonJS helper style. File asset warmup/reconcile callers and focused
    object-storage/source-contract tests now point at the explicit `.ts`
    helper. Focused upload-reference repair, portal inventory regression,
    upload helper load, backend utility, schema audit, stale-path, and Linux
    packaging proof passed. Packaging still warns for direct `.ts` entries in
    `pkg.scripts`, so broader backend conversions remain blocked on the future
    compile/staging lane. The generated language audit now reports
    `JavaScript: 33`, `TypeScript: 278`, and `React TSX: 107` across the active
    scan roots.
590. Convert verification service to a package-safe TypeScript path.
    Done: `backend/src/services/verification.ts` keeps verification capability
    reporting, email/phone normalization, destination masking, disabled-code
    request responses, and active-code verification helpers on the existing
    CommonJS service style. Auth and users routes now point at the explicit
    `.ts` service, and the backend service index doc names the TypeScript file.
    Focused verification helper load, route-contract, backend utility, schema
    audit, stale-path, and Linux packaging proof passed. Packaging still warns
    for direct `.ts` entries in `pkg.scripts`, so broader backend conversions
    remain blocked on the future compile/staging lane. The generated language
    audit now reports `JavaScript: 32`, `TypeScript: 279`, and `React TSX: 107`
    across the active scan roots.
591. Convert owned Google OAuth service to a package-safe TypeScript path.
    Done: `backend/src/services/googleOauth.ts` keeps Google login public
    config, return-target normalization, OAuth state signing/verification,
    OAuth start URL construction, code exchange, profile fetch, and disabled
    runtime behavior on the existing CommonJS service style. Auth, users,
    integration-doctor, and owned Google auth tests now point at the explicit
    `.ts` service, and the backend service index doc names the TypeScript file.
    Focused OAuth helper load, route-contract, owned Google auth, backend
    utility, schema audit, stale-path, and Linux packaging proof passed.
    Packaging still warns for direct `.ts` entries in `pkg.scripts`, so broader
    backend conversions remain blocked on the future compile/staging lane. The
    generated language audit now reports `JavaScript: 31`, `TypeScript: 280`,
    and `React TSX: 107` across the active scan roots.
592. Convert action-history route to a package-safe TypeScript path.
    Done: `backend/src/routes/actionHistory.ts` keeps action-history list,
    record, status update, server-backed undo/redo, permission checks,
    sensitive payload checks, payload-size guards, and JSON payload
    normalization on the existing CommonJS route style. The server mount,
    route-contract source probe, and backend route docs now point at the
    explicit `.ts` route. Focused route load, route-contract, backend utility,
    schema audit, stale-path, and Linux packaging proof passed. Packaging still
    warns for direct `.ts` entries in `pkg.scripts`, so broader backend
    conversions remain blocked on the future compile/staging lane. The
    generated language audit now reports `JavaScript: 30`, `TypeScript: 281`,
    and `React TSX: 107` across the active scan roots.
593. Convert AI route to a package-safe TypeScript path.
    Done: `backend/src/routes/ai.ts` keeps AI provider listing,
    create/update/delete, provider test status persistence, response-log
    listing, permission checks, write-conflict guards, auditing, broadcasts,
    and response serialization on the existing CommonJS route style. The server
    mount and roadmap docs point at the explicit `.ts` route; Move 599 later
    converts the AI gateway service itself to an explicit `.ts` path. Focused
    route load, route-contract, backend utility,
    schema audit, stale-path, and Linux packaging proof passed. Packaging still
    warns for direct `.ts` entries in `pkg.scripts`, so broader backend
    conversions remain blocked on the future compile/staging lane. The
    generated language audit now reports `JavaScript: 29`, `TypeScript: 282`,
    and `React TSX: 107` across the active scan roots.
594. Convert custom tables route to a package-safe TypeScript path.
    Done: `backend/src/routes/customTables.ts` keeps custom-table listing,
    table creation, dynamic table row-versioning, schema normalization, row
    create/update/delete, write-conflict checks, audit entries, broadcasts, and
    dynamic `ct_*` table documentation on the existing CommonJS route style.
    The server mount, route-contract source probe, backend route docs, route
    folder guide, schema relationship note, and roadmap docs now point at the
    explicit `.ts` route. Focused route load, route-contract, backend utility,
    schema audit, stale-path, and Linux packaging proof passed. Packaging still
    warns for direct `.ts` entries in `pkg.scripts`, so broader backend
    conversions remain blocked on the future compile/staging lane. The
    generated language audit now reports `JavaScript: 28`, `TypeScript: 283`,
    and `React TSX: 107` across the active scan roots.
595. Convert shared backend middleware to a package-safe TypeScript path.
    Done: `backend/src/middleware.ts` keeps session auth binding, public-route
    network guard behavior, upload/file-type filtering, upload compression and
    validation, route rate limits, permission merging, admin-control checks,
    any-permission checks, and audit actor extraction on the existing
    CommonJS middleware style. The server and every route caller now point at
    the explicit `.ts` middleware path so Node/package resolution does not rely
    on extension inference. Focused middleware load, route-contract, backend
    utility, schema audit, stale-path, and Linux packaging proof passed.
    Packaging still warns for direct `.ts` entries in `pkg.scripts`, so broader
    backend conversions remain blocked on the future compile/staging lane. The
    generated language audit now reports `JavaScript: 27`, `TypeScript: 284`,
    and `React TSX: 107` across the active scan roots.
596. Convert integration doctor service to a package-safe TypeScript path.
    Done: `backend/src/services/integrationDoctor.ts` keeps database,
    object-storage, queue, analytics, Google Drive, Google login, backup,
    runtime-data, secret-redaction, OAuth checklist, and restore-needed report
    behavior on the existing CommonJS service style. The system route and
    owned integration tests now point at the explicit `.ts` service path, and
    the owned Google auth source check reads the TypeScript file. Focused
    integration doctor and owned Google auth tests, route-contract, backend
    utility, schema audit, stale-path, and Linux packaging proof passed.
    Packaging still warns for direct `.ts` entries in `pkg.scripts`, so broader
    backend conversions remain blocked on the future compile/staging lane. The
    generated language audit now reports `JavaScript: 26`, `TypeScript: 285`,
    and `React TSX: 107` across the active scan roots.
597. Convert backend runtime config index to a package-safe TypeScript path.
    Done: `backend/src/config/index.ts` keeps dotenv selection, runtime/data
    root discovery, organization folder bootstrapping, upload/import directory
    creation, driver validation, queue/cache/media/import limits, frontend dist
    selection, public/admin URL resolution, Google OAuth secret-file fallback,
    data-location helpers, and exported config names on the existing CommonJS
    style. Every first-party config caller now points at the explicit
    `config/index.ts` path so Node/package resolution does not rely on
    directory `index.js` inference. Focused config load, route-contract,
    backend utility, schema audit, stale-path, and Linux packaging proof
    passed. Packaging still warns for direct `.ts` entries in `pkg.scripts`, so
    broader backend conversions remain blocked on the future compile/staging
    lane. The generated language audit now reports `JavaScript: 25`,
    `TypeScript: 286`, and `React TSX: 107` across the active scan roots.
598. Convert offline sync route to a package-safe TypeScript path.
    Done: `backend/src/routes/sync.ts` keeps outbox digest validation, stable
    payload stringification, allowlisted replay targets, write-conflict
    rejection, Cloudflare Access diagnostics, chunked offline file upload
    manifests, per-chunk hash validation, upload completion assembly, and
    upload-buffer validation on the existing CommonJS route style. The server
    mount and offline-security source assertions now point at the explicit
    `.ts` route. Focused route load, route-contract, offline-security, backend
    utility, schema audit, stale-path, and Linux packaging proof passed.
    Packaging still warns for direct `.ts` entries in `pkg.scripts`, so broader
    backend conversions remain blocked on the future compile/staging lane. The
    generated language audit now reports `JavaScript: 24`, `TypeScript: 287`,
    and `React TSX: 107` across the active scan roots.
599. Convert AI gateway service to a package-safe TypeScript path.
    Done: `backend/src/services/aiGateway.ts` keeps provider metadata,
    provider payload normalization, secret encryption/decryption exports,
    provider row serialization, outbound URL validation, HTTP error shaping,
    Google message conversion, chat provider calls, embedding provider health
    checks, web-research eligibility, and safe JSON parsing on the existing
    CommonJS service style. The AI route and portal AI service now point at
    the explicit `.ts` service path. Focused service load, route-contract,
    backend utility, schema audit, stale-path, and Linux packaging proof
    passed. Packaging still warns for direct `.ts` entries in `pkg.scripts`,
    so broader backend conversions remain blocked on the future
    compile/staging lane. The generated language audit now reports
    `JavaScript: 23`, `TypeScript: 288`, and `React TSX: 107` across the
    active scan roots.
600. Convert legacy Firebase auth service to a package-safe TypeScript path.
    Done: `backend/src/services/firebaseAuth.ts` keeps Firebase Identity
    Toolkit capability checks, service-account JSON/file/base64/env fallback
    loading, Google service JWT signing, OAuth access-token caching, provider
    error normalization, public/admin Firebase request wrappers, email/E.164
    normalization, user create/update, password update, active-state update,
    and password verification on the existing CommonJS service style. The
    services folder guide now points at the explicit `.ts` service path while
    preserving the note that this is legacy rollback/reference code, not the
    active auth route. Focused service load, route-contract, backend utility,
    schema audit, stale-path, and Linux packaging proof passed. Packaging still
    warns for direct `.ts` entries in `pkg.scripts`, so broader backend
    conversions remain blocked on the future compile/staging lane. The
    generated language audit now reports `JavaScript: 22`, `TypeScript: 289`,
    and `React TSX: 107` across the active scan roots.
601. Convert system jobs lifecycle helper to a package-safe TypeScript path.
    Done: `backend/src/systemJobs.ts` keeps job id generation, public job
    serialization, active-job dedupe, runtime table creation/migration, stale
    queued/running/cancelling job recovery, throttled persistence, progress
    persistence steps, cancellation errors, cancellable worker lifecycle,
    queued/running/completed/failed/cancelled status transitions, retention
    cleanup, and database-backed job listing on the existing CommonJS helper
    style. The system route, backend tests, frontend action-stability source
    probe, backup reliability verifier, schema audit, hardening policy,
    schema relationship doc, and roadmap docs now point at the explicit `.ts`
    helper path. Focused helper load, system-jobs, route-contract, backend
    utility, schema audit, stale-path, and Linux packaging proof passed.
    Packaging still warns for direct `.ts` entries in `pkg.scripts`, so
    broader backend conversions remain blocked on the future compile/staging
    lane. The generated language audit now reports `JavaScript: 21`,
    `TypeScript: 290`, and `React TSX: 107` across the active scan roots.
602. Convert object storage helper to a package-safe TypeScript path.
    Done: `backend/src/objectStore.ts` keeps R2/MinIO driver detection, R2 API
    fallback token/account discovery, Cloudflare object URLs, timeout-wrapped
    API calls, S3 client reuse, object-key normalization and dedupe, bucket
    checks, put/read/head/delete/list operations, stream conversion, and the
    object-store doctor test on the existing CommonJS helper style. Server
    upload serving, file asset storage, settings snapshot sanitization, backup
    packages, integration doctor, system route, R2 verifier, backend source
    probes, and backend docs now point at the explicit `.ts` helper path.
    Focused helper load,
    settings object-storage, backup hardening, route-contract, backend utility,
    schema audit, stale-path, and Linux packaging proof passed. Packaging still
    warns for direct `.ts` entries in `pkg.scripts`, so broader backend
    conversions remain blocked on the future compile/staging lane. The
    generated language audit now reports `JavaScript: 20`, `TypeScript: 291`,
    and `React TSX: 107` across the active scan roots.
603. Convert server utility/security helper to a package-safe TypeScript path.
    Done: `backend/src/serverUtils.ts` keeps origin/host normalization,
    configured public/customer portal host detection, CORS policy, WebSocket
    origin checks, Cloudflare Access diagnostics, prototype-pollution key
    cleanup, request string sanitization, SPA fallback eligibility, no-store
    and HTML headers, tunnel CSP/permissions headers, static/upload cache
    headers, customer portal route detection, and server error mapping on the
    existing CommonJS helper style. Server bootstrap, WebSocket setup, sync
    route diagnostics, server/offline security tests, hardening policy, and
    roadmap docs now point at the explicit `.ts` helper path. Focused helper
    load, server-utils, websocket, offline-security, route-contract, backend
    utility, schema audit, stale-path, and Linux packaging proof passed.
    Packaging still warns for direct `.ts` entries in `pkg.scripts`, so
    broader backend conversions remain blocked on the future compile/staging
    lane. The generated language audit now reports `JavaScript: 19`,
    `TypeScript: 292`, and `React TSX: 107` across the active scan roots.
604. Convert import jobs route to a package-safe TypeScript path.
    Done: `backend/src/routes/importJobs.ts` keeps import type permission
    mapping, permitted-type filtering, upload directory safety, CSV/TSV/ZIP/
    image file filtering, policy and relative-path parsing, forced-delete
    parsing, audit event payloads, queue status, job listing, job creation,
    review/decision/preflight routes, CSV/ZIP/image uploads, start/approve/
    cancel/delete/retry flows, and error CSV download on the existing CommonJS
    route style. Server route mounting, import-decision source assertions,
    backend route docs, language runtime audit metadata, and roadmap docs now
    point at the explicit `.ts` route path. Focused route load,
    import-decision, route-contract, backend utility, schema audit, stale-path,
    and Linux packaging proof passed. Packaging still warns for direct `.ts`
    entries in `pkg.scripts`, so broader backend conversions remain blocked on
    the future compile/staging lane. The generated language audit now reports
    `JavaScript: 18`, `TypeScript: 293`, and `React TSX: 107` across the
    active scan roots.
605. Convert branches route to a package-safe TypeScript path.
    Done: `backend/src/routes/branches.ts` keeps branch listing, summary
    metrics, stock-integrity preview and repair, create/update/delete flows,
    default-branch handling, paged branch-stock search, stock transfer listing,
    stock transfer writes, audit payloads, broadcast channels, cached
    stock-transfer note-column selection, and direct-loop SQL helper behavior
    on the existing CommonJS route style. Server route mounting, product-expiry
    and route-contract source assertions, backend route docs, and roadmap docs
    now point at the explicit `.ts` route path. Focused route load,
    branch-stock, product-expiry, route-contract, backend utility, schema
    audit, stale-path, and Linux packaging proof passed. Packaging still warns
    for direct `.ts` entries in `pkg.scripts`, so broader backend conversions
    remain blocked on the future compile/staging lane. The expected generated
    language audit now reports `JavaScript: 17`, `TypeScript: 294`, and
    `React TSX: 107` across the active scan roots.
606. Convert shared backend helpers to a package-safe TypeScript path.
    Done: `backend/src/helpers.ts` keeps HTTP response helpers, audit logging,
    action-history payload safety, WebSocket broadcast fanout, runtime cache and
    Drive sync invalidation hooks, CSV parsing/import helpers, stock/sale/cost
    verification helpers, safe cost lookup, and sale profit calculation on the
    existing CommonJS helper style. All first-party route, service, and
    WebSocket imports now point at the explicit `.ts` helper path. Focused
    helper load, route-contract, backend utility, schema audit, stale-path, and
    Linux packaging proof passed. Packaging still warns for direct `.ts`
    entries in `pkg.scripts`, so broader backend conversions remain blocked on
    the future compile/staging lane. The expected generated language audit now
    reports `JavaScript: 16`, `TypeScript: 295`, and `React TSX: 107` across
    the active scan roots.
607. Convert backend product-batch helpers to a package-safe TypeScript path.
    Done: `backend/src/productBatches.ts` keeps legacy batch backfill
    scheduling, batch-key construction, sellable-product guards, batch stock
    reads/writes, FEFO allocation, sale/return allocation lookup and release
    helpers, branch rollups, clone/restore behavior, and product rollup sync on
    the existing CommonJS helper style. Server startup, import jobs, products,
    inventory, sales, returns, backend source assertions, and roadmap docs now
    point at the explicit `.ts` helper path. Focused helper load,
    product-batch hierarchy, route-contract, backend utility, schema audit,
    stale-path, and Linux packaging proof passed. Packaging still warns for
    direct `.ts` entries in `pkg.scripts`, so broader backend conversions
    remain blocked on the future compile/staging lane. The expected generated
    language audit now reports `JavaScript: 15`, `TypeScript: 296`, and
    `React TSX: 107` across the active scan roots.
608. Convert portal AI service to a package-safe TypeScript path.
    Done: `backend/src/services/portalAi.ts` keeps provider runtime state,
    visitor activity throttling, product scoring/candidate selection, prompt
    assembly, assistant JSON normalization, provider failover/cooldown, usage
    summaries, and portal response policy on the existing CommonJS service
    style. The portal route now points at the explicit `.ts` service path.
    Focused service load, route-contract, backend utility, schema audit,
    stale-path, and Linux packaging proof passed. Packaging still warns for
    direct `.ts` entries in `pkg.scripts`, so broader backend conversions
    remain blocked on the future compile/staging lane. The expected generated
    language audit now reports `JavaScript: 14`, `TypeScript: 297`, and `React
    TSX: 107` across the active scan roots.
609. Convert synchronous Postgres runtime bridge to a package-safe TypeScript path.
    Done: `backend/src/postgresDatabase.ts` keeps the pg-native loader,
    SQLite-like statement bridge, SQL translation boundary, transaction/savepoint
    behavior, runtime schema/index bootstrap, default organization/branch/role
    seeding, lazy database proxy, and maintenance no-op compatibility exports on
    the existing CommonJS module style. The database facade, schema audit, source
    assertions, backend README/map, schema relationship docs, and roadmap docs now
    point at the explicit `.ts` runtime bridge path. Focused Postgres bridge,
    RFID, product-expiry, product-batch, owned-Google-auth, backend utility,
    schema audit, stale-path, and Linux packaging proof passed. Packaging still
    warns for direct `.ts` entries in `pkg.scripts`, so broader backend
    conversions remain blocked on the future compile/staging lane. The expected
    generated language audit now reports `JavaScript: 13`, `TypeScript: 298`,
    and `React TSX: 107` across the active scan roots.
610. Convert backup package service to a package-safe TypeScript path.
    Done: `backend/src/services/backupPackages.ts` keeps local/final backup
    package creation, streaming JSONL table export, checksums, object copy
    concurrency, reusable local package detection, local/R2 version listing,
    retention planning, local/remote pruning, manifest validation, and cache
    invalidation on the existing CommonJS service style. System routes, Drive
    sync, integration doctor, storage prune tooling, reliability policy/tests,
    backup tests, and roadmap docs now point at the explicit `.ts` service path.
    Focused backup retention/schema/performance/reliability checks plus backend
    utilities, schema audit, stale-path, and Linux packaging proof passed.
    Packaging still warns for direct `.ts` entries in `pkg.scripts`, so broader
    backend conversions remain blocked on the future compile/staging lane. The
    expected generated language audit now reports `JavaScript: 12`,
    `TypeScript: 299`, and `React TSX: 107` across the active scan roots.
611. Convert auth route to a package-safe TypeScript path.
    Done: `backend/src/routes/auth.ts` keeps password login, session rotation,
    Google OAuth start/callback flows, OTP setup/verification/disable,
    password-reset helpers, bootstrap payload construction, organization
    context lookup, audit logging, rate limiting, abuse locks, and verification
    capability reporting on the existing CommonJS route style. Server route
    mounting, route/source assertions, hardening policy, route docs, and
    roadmap docs now point at the explicit `.ts` route path. Focused auth,
    route-contract, offline-security, owned-Google-auth, backend utility,
    schema audit, stale-path, and Linux packaging proof passed. Packaging still
    warns for direct `.ts` entries in `pkg.scripts`, so broader backend
    conversions remain blocked on the future compile/staging lane. The expected
    generated language audit now reports `JavaScript: 11`, `TypeScript: 300`,
    and `React TSX: 107` across the active scan roots.
612. Convert returns route to a package-safe TypeScript path.
    Done: `backend/src/routes/returns.ts` keeps customer and supplier return
    creation, item allocation reversal, branch stock deduction/restoration,
    batch rollups, conflict checks, idempotency checks, audit/action history,
    return search, and include-items payload construction on the existing
    CommonJS route style. Server mounting, source-level batch/portal/action
    stability assertions, route docs, generated naming guide, master plan, and
    roadmap docs now point at the explicit `.ts` route path. Focused returns,
    route-contract, portal inventory, product-batch, frontend action-stability,
    backend utility, schema audit, stale-path, and Linux packaging proof passed.
    Packaging still warns for direct `.ts` entries in `pkg.scripts`, so broader
    backend conversions remain blocked on the future compile/staging lane. The
    expected generated language audit now reports `JavaScript: 10`,
    `TypeScript: 301`, and `React TSX: 107` across the active scan roots.

613. Convert contacts route to a package-safe TypeScript path.
    Done: `backend/src/routes/contacts.ts` keeps customer, supplier, delivery
    contact, membership-number, import-policy, point-policy, search, and
    contact-option behavior on the existing CommonJS route style. Server
    mounting, membership-prefix source assertions, route docs, master plan, and
    roadmap docs now point at the explicit `.ts` route path. Focused contacts
    route load, backup hardening, route-contract, backend utility, schema
    audit, stale-path, and Linux packaging proof passed. Packaging still warns
    for direct `.ts` entries in `pkg.scripts`, so broader backend conversions
    remain blocked on the future compile/staging lane. The expected generated
    language audit now reports `JavaScript: 9`, `TypeScript: 302`, and
    `React TSX: 107` across the active scan roots.

614. Convert users route to a package-safe TypeScript path.
    Done: `backend/src/routes/users.ts` keeps user lifecycle, role lifecycle,
    self-service profile/password updates, avatar upload hardening, Google
    linked identity synchronization, admin-control safeguards, and session
    revocation on the existing CommonJS route style. Server mounting,
    hardening policy, route docs, and roadmap docs now point at the explicit
    `.ts` route path. Focused users route load, route-contract, hardening
    policy, backend utility, schema audit, stale-path, and Linux packaging proof
    passed. Packaging still warns for direct `.ts` entries in `pkg.scripts`, so
    broader backend conversions remain blocked on the future compile/staging
    lane. The expected generated language audit now reports `JavaScript: 8`,
    `TypeScript: 303`, and `React TSX: 107` across the active scan roots.

615. Convert file asset service to a package-safe TypeScript path.
    Done: `backend/src/fileAssets.ts` keeps upload naming, media type
    inference, upload security validation, image/video optimization, object
    storage writes, local/R2 reconciliation, usage reference caching, library
    pagination, and deletion guards on the existing CommonJS service style.
    Server prewarm wiring, upload middleware, media queue, file/settings/users/
    product/portal/system routes, import job asset registration, focused file
    asset tests, and roadmap docs now point at the explicit `.ts` service path.
    Focused file asset storage, cache, media, upload security, inventory/media
    contract, portal regression, backend utility, schema audit, stale-path, and
    Linux packaging proof passed. Packaging still warns for direct `.ts`
    entries in `pkg.scripts`, so broader backend conversions remain blocked on
    the future compile/staging lane. The expected generated language audit now
    reports `JavaScript: 7`, `TypeScript: 304`, and `React TSX: 107` across the
    active scan roots.

616. Convert public portal route to a package-safe TypeScript path.
    Done: `backend/src/routes/portal.ts` keeps public portal configuration,
    customer-safe catalog payloads, paged catalog search, recommendation and
    initial filters, membership lookup summaries, points rollups, AI responses,
    submission screenshot materialization, review workflows, rate limiting, and
    object-storage-aware media sanitization on the existing CommonJS route
    style. Server mounting, route contracts, portal regression checks, backup
    hardening checks, backend route docs, language-runtime audit metadata, and
    roadmap docs now point at the explicit `.ts` route path. Focused portal
    route load, route-contract, portal regression, backup performance
    hardening, backend utility, schema audit, stale-path, and Linux packaging
    proof passed. Packaging still warns for direct `.ts` entries in
    `pkg.scripts`, so broader backend conversions remain blocked on the future
    compile/staging lane. The expected generated language audit now reports
    `JavaScript: 6`, `TypeScript: 305`, and `React TSX: 107` across the active
    scan roots.

617. Convert Google Drive sync service to a package-safe TypeScript path.
    Done: `backend/src/services/googleDriveSync/index.ts` keeps Drive OAuth,
    encrypted token storage, sync preference writes, periodic scheduling,
    reusable backup package selection, resumable uploads, folder-id
    revalidation, version-folder rotation, retention pruning, mapping recovery,
    progress state, and status reporting on the existing CommonJS service
    style. Helper scheduling, notification summaries, integration doctor,
    system routes, backup reliability checks, Drive versioning tests, hardening
    policy, master plan, language-runtime audit metadata, and roadmap docs now
    point at the explicit `.ts` service path. Focused Drive sync service load,
    Drive versioning, backup performance hardening, backup reliability,
    backend utility, schema audit, stale-path, and Linux packaging proof passed.
    Packaging still warns for direct `.ts` entries in `pkg.scripts`, so broader
    backend conversions remain blocked on the future compile/staging lane. The
    expected generated language audit now reports `JavaScript: 5`,
    `TypeScript: 306`, and `React TSX: 107` across the active scan roots.

618. Convert sales route to a package-safe TypeScript path.
    Done: `backend/src/routes/sales.ts` keeps sale creation, POS idempotency,
    stock availability checks, batch allocation persistence, status transition
    stock restoration/deduction, customer assignment, dashboard summary and
    analytics caching, product/customer/branch export hydration, COGS
    calculation, and action-history/audit broadcasts on the existing CommonJS
    route style. Server mounting, route contracts, product expiry checks,
    product batch hierarchy checks, portal regression checks, frontend action
    stability checks, backend route docs, master plan, language-runtime audit
    metadata, and roadmap docs now point at the explicit `.ts` route path.
    Focused sales route load, route-contract, product expiry, product batch,
    portal regression, frontend action-stability, backend utility, schema
    audit, stale-path, and Linux packaging proof passed. Packaging still warns
    for direct `.ts` entries in `pkg.scripts`, so broader backend conversions
    remain blocked on the future compile/staging lane. The expected generated
    language audit now reports `JavaScript: 4`, `TypeScript: 307`, and
    `React TSX: 107` across the active scan roots.

619. Convert system route to a package-safe TypeScript path.
    Done: `backend/src/routes/system/index.ts` keeps backup export/restore
    job dispatch, Google Drive sync controls, settings writes, reset/factory
    reset guards, audit-log pagination and retention cleanup, runtime data-path
    status, integration diagnostics, maintenance locks, and queue/cache/storage
    health reporting on the existing CommonJS route style. Server mounting,
    route contracts, offline security checks, backup schema and hardening
    checks, backup default destination checks, backup reliability verification,
    frontend action-stability checks, hardening policy, backend route docs,
    master plan, language-runtime audit metadata, and roadmap docs now point at
    the explicit `.ts` route path. Focused system route load, route-contract,
    offline security, backup schema, backup hardening, backup default
    destination, system job, backup reliability, frontend action-stability,
    stale-path, backend utility, schema audit, Linux packaging, and source-load
    proof passed. Packaging still warns for direct `.ts` entries in
    `pkg.scripts`, so broader backend conversions remain blocked on the future
    compile/staging lane. The expected generated language audit now reports
    `JavaScript: 3`,
    `TypeScript: 308`, and `React TSX: 107` across the active scan roots.

620. Convert inventory route to a package-safe TypeScript path.
    Done: `backend/src/routes/inventory.ts` keeps inventory product search,
    stock adjustments, branch transfers, movement pagination, saved reason
    normalization, batch-aware stock mutations, RFID session review and apply,
    grouped movement history, active-branch indexing, action history, audit
    logging, and broadcasts on the existing CommonJS route style. Server
    mounting, route contracts, RFID route checks, product batch hierarchy
    checks, portal inventory regression checks, inventory/settings/media
    contracts, frontend action-stability checks, backend route docs, master
    plan, language-runtime audit metadata, and roadmap docs now point at the
    explicit `.ts` route path. Focused inventory route load, route-contract,
    RFID, product batch, portal regression, inventory media/settings contract,
    frontend action-stability, stale-path, backend utility, schema audit,
    Linux packaging, and source-load proof passed. Packaging still warns for
    direct `.ts` entries in `pkg.scripts`, so broader backend conversions
    remain blocked on the future compile/staging lane. The expected generated
    language audit now reports `JavaScript: 2`, `TypeScript: 309`, and
    `React TSX: 107` across the active scan roots.

621. Convert products route to a package-safe TypeScript path.
    Done: `backend/src/routes/products.ts` keeps product CRUD, variant
    grouping, product image upload/compression, conflict handling, special and
    promotion price normalization, expiry fields, batch seeding, branch stock
    seeding, bulk import policy checks, lookup replacement, product search,
    pagination, media cleanup, action history, audit logging, and broadcasts on
    the existing CommonJS route style. Server mounting, route contracts,
    product search pagination checks, product expiry checks, product batch
    hierarchy checks, portal inventory regression checks, import decision
    integrity checks, frontend action-stability checks, hardening policy,
    backend route docs, master plan, language-runtime audit metadata, and
    roadmap docs now point at the explicit `.ts` route path. Focused product
    route load, route-contract, product search, product expiry, product batch,
    portal regression, import decision, frontend action-stability, stale-path,
    backend utility, schema audit, Linux packaging, and source-load proof
    passed. Packaging still warns for direct `.ts` entries in `pkg.scripts`,
    so broader backend conversions remain blocked on the future
    compile/staging lane. The expected generated language audit now reports
    `JavaScript: 1`, `TypeScript: 310`, and `React TSX: 107` across the active
    scan roots.

622. Convert import job service to a package-safe TypeScript path.
    Done: `backend/src/services/importJobs.ts` keeps import job creation,
    file registration, CSV/TSV streaming, image ZIP extraction, product review
    grouping, row-decision persistence, preflight checks, apply processing,
    cancellation, retry, deletion, BullMQ/local queue recovery, media wait
    handling, and queue status reporting on the existing CommonJS service
    style. Server startup, import-job routes, runtime/system routes,
    integration doctor, import worker, source-guard tests, performance
    verification, master plan, session log, language-runtime audit metadata,
    and roadmap docs now point at the explicit `.ts` service path. Focused
    service-load, route-contract, import performance hardening, import
    decision integrity, product batch hierarchy, import scale smoke, import
    CSV, product import policy, stale-path, schema audit, language-runtime
    audit, and Linux packaging proof passed. A standalone
    `importJobStateMachine` run still needs a live `DATABASE_URL` test
    environment; without it the existing Postgres guard rejects the direct
    test before exercising service behavior. Packaging still warns for direct
    `.ts` entries in `pkg.scripts`, so the next backend-wide slice remains the
    compile/staging package lane. The expected generated language audit now
    reports `TypeScript: 311`, `React TSX: 107`, and no `JavaScript` entry
    across the active scan roots.

623. Add backend package staging for TypeScript source.
    Done: `ops/scripts/backend/build-package-stage.ts` now prepares an ignored
    `backend/.pkg-stage` release input by copying backend source, renaming
    staged `.ts` files to `.js`, and rewriting staged runtime `.ts` requires
    and path strings to `.js`. `backend/package.json` now runs that stage
    before `@yao-pkg/pkg` and points `pkg` at `.pkg-stage`, so Linux package
    proof no longer emits the previous direct-`.ts` script warnings. The
    Docker release verifier now requires the stage script, ignored generated
    folder, JavaScript-only staged package scripts, guarded stage deletion, and
    runtime require rewriting. Docker release verification and Linux packaging
    proof passed; generated `backend/.pkg-stage` and `dist-bin` are cleanup
    targets after proof and must not be committed.

624. Add TypeScript-authored public runtime browser scripts.
    Done: `frontend/src/public-runtime/` now owns the runtime noise guard,
    theme bootstrap, and offline service worker sources as TypeScript. The
    served browser files stay at `frontend/public/runtime-noise-guard.js`,
    `frontend/public/theme-bootstrap.js`, and `frontend/public/sw.js` because
    `frontend/index.html`, service-worker registration, backend static headers,
    release checks, and offline tests depend on those exact URLs. The new
    `ops/scripts/frontend/build-public-runtime-scripts.ts` transpiles the
    TypeScript sources, frontend `prebuild` regenerates them before Vite, and
    `verify:public-runtime` is part of `test:utils` so generated public JS
    cannot drift from source. Focused public-runtime check, frontend
    typecheck, frontend utility tests, production build, and diff whitespace
    proof passed. Remaining first-party `.js` outside active source roots is
    runtime/compatibility entrypoint material: `backend/server.js`,
    `ops/config/ecosystem.config.js`, generated public runtime JS, and the
    tracked Scanbot vendor bundle.

625. Add TypeScript-authored backend server entry source.
    Done: `backend/server.ts` now owns the backend HTTP entrypoint source while
    `backend/server.js` remains the generated runtime filename required by
    `run/start-server.bat`, PM2 config, shell launchers, spawned backend tests,
    and package metadata. `ops/scripts/backend/build-server-entry.ts` transpiles
    the entry, `verify:server-entry` prevents drift, `test:utils` runs that
    check before backend tests, and `build:linux` regenerates it before
    `.pkg-stage` packaging. The Docker release guardrail now requires the
    server-entry generator, package-script wiring, and build-before-stage
    ordering. Focused server-entry check, route/offline security source checks,
    Docker release verification, full backend utility tests, Linux packaging
    proof, generated package artifact cleanup, and diff whitespace proof
    passed. Remaining first-party `.js` outside active source roots is now
    generated/runtime-compatible: generated `backend/server.js`, generated
    public runtime JS, `ops/config/ecosystem.config.js`, and the tracked
    Scanbot vendor bundle.

626. Add TypeScript-authored PM2 ecosystem config source.
    Done: `ops/config/ecosystem.config.ts` now owns the typed PM2 app/env
    configuration while `ops/config/ecosystem.config.js` remains the generated
    CommonJS file loaded by PM2 and `run/sh/start-server.sh`. The new
    `ops/scripts/runtime/build-ecosystem-config.ts` generator exposes
    `build:ecosystem-config` and `verify:ecosystem-config`, Phase 29 runs that
    drift check as a guardrail, and the language/runtime audit records the
    generated `.js` as a compatibility wrapper instead of active source.
    Remaining first-party `.js` outside active source roots is generated
    runtime output (`backend/server.js`, public runtime JS, PM2 config JS) plus
    the tracked Scanbot vendor bundle.

627. Add a runtime JavaScript inventory guardrail.
    Done: `ops/scripts/architecture/runtime-js-inventory.ts` now scans for
    remaining `.js`, `.jsx`, `.mjs`, and `.cjs` files outside dependency and
    generated bulk folders, classifies generated runtime files and the Scanbot
    vendor bundle, verifies generated files still have TypeScript sources, and
    writes `ops/docs/reference/RUNTIME-JS-INVENTORY.md` plus JSON. `ops`
    exposes `runtime-js-inventory`, and Phase 29 runs it so any new
    unclassified first-party JavaScript file fails the audit instead of
    becoming invisible drift.

628. Strengthen the shared ops report helper with real TypeScript types.
    Done: `ops/scripts/lib/report-utils.ts` now uses TypeScript aliases and
    function annotations for Markdown cells, digest input handling, output-tail
    formatting, byte formatting, and the CommonJS export shape instead of
    relying on JSDoc typedefs. Existing report callers keep their
    `require('../lib/report-utils.ts')` imports. Direct export smoke checks,
    generated-bulk audit, and Phase 29 passed.

629. Strengthen the shared ops filesystem helper with real TypeScript types.
    Done: `ops/scripts/lib/fs-utils.ts` now uses TypeScript aliases and
    function annotations for JSON fallbacks, file-walk options, root-file
    options, collected file/folder results, path helpers, tolerant read helpers,
    text detection, and the CommonJS export shape instead of relying on JSDoc
    typedefs. Existing report, architecture, frontend, runtime, and
    verification scripts keep their `require('../lib/fs-utils.ts')` imports.
    `mapLimit()` now clamps invalid or zero concurrency to one worker rather
    than returning unprocessed slots. Direct export smoke checks, performance
    scan, and Phase 29 passed.

630. Strengthen the Phase 29 performance scan with real TypeScript types.
    Done: `ops/scripts/docs/performance-scan.ts` now declares TypeScript row
    and summary shapes for source files, built chunks, measured rows, sortable
    metrics, and the generated performance summary instead of relying on
    implicit JavaScript objects. The typed `topN()` helper is constrained to
    the known numeric scan metrics, while report/JSON output remains unchanged.
    Direct performance scan proof and Phase 29 passed.

631. Strengthen the Phase 29 organization audit with real TypeScript types.
    Done: `ops/scripts/architecture/organization-audit.ts` now declares source
    record, compatibility wrapper, wrapper reference, summary input, and JSON
    summary shapes. The recursive walker also uses typed path stacks and guards
    empty stack pops, so future folder cleanup and rewire checks have clearer
    boundaries while preserving the current report contract. Direct organization
    audit proof passed.

632. Strengthen the Phase 29 coordinator with real TypeScript types.
    Done: `ops/scripts/architecture/phase29-audit.ts` now declares audit check,
    CLI option, child-process result, parsed-output, check-run, audit-cycle,
    duration-summary, repeat-consistency, and final summary shapes. Parsed child
    JSON is narrowed to object values before repeat verification reads fields,
    keeping the audit non-mutating while making the repeated sweep safer to
    evolve. Direct Phase 29 proof passed.

633. Strengthen the runtime dependency guardrail with real TypeScript types.
    Done: `ops/scripts/verification/verify-runtime-deps.ts` now declares package
    manifest, package lock, version consistency, nested coverage tree,
    runtime-version coverage, and generated summary shapes. Package and lock
    reads now flow through typed helpers, keeping the current dependency,
    version, and local verification assertions intact while making future
    runtime updates easier to validate. Direct guardrail proof passed.

634. Strengthen the secret hygiene verifier with real TypeScript types.
    Done: `ops/scripts/verification/verify-secret-hygiene.ts` now declares
    tracked-file, token-pattern, failure-message, and unsafe-assignment match
    shapes. Secret assignment detection now flows through a typed helper while
    preserving the same tracked-file exclusions, placeholder allowances, and
    leaked token regexes. Direct secret hygiene verification passed.

635. Strengthen the backup reliability verifier with real TypeScript types.
    Done: `ops/scripts/verification/verify-backup-reliability.ts` now declares
    source-key, source-record, expectation-map, and checker-callback shapes.
    The text-contract checker now fails clearly if a future expectation map
    references an unknown source key, while preserving the current streaming
    backup, Drive sync, cancellation, UI, and offline pause assertions. Direct
    backup reliability verification passed.

636. Strengthen the hardening policy verifier and current policy paths.
    Done: `ops/scripts/verification/verify-hardening-policy.ts` now declares
    hardening policy, file-rule, source path, and failure-message shapes, and
    validates that the policy JSON exposes a rules array before scanning. The
    policy file now references current tracked TypeScript sources for backend
    sync and maintenance-lock checks instead of stale `.js` paths. Direct
    hardening policy verification passed.

637. Strengthen the scale-service verifier with real TypeScript types.
    Done: `ops/scripts/verification/verify-scale-services.ts` now declares CLI
    argument, command-result, spawn-option, Docker path, failure, and warning
    shapes. Docker availability handling now flows through one helper that keeps
    the current default warning behavior and only fails when scale services are
    explicitly required. Direct scale-service verification passed with a Docker
    engine reachability warning.

638. Strengthen the backend server-entry build helper with real TypeScript types.
    Done: `ops/scripts/backend/build-server-entry.ts` now declares the
    TypeScript compiler module boundary, diagnostic, project-path, transpile,
    write-if-changed, and main-entry shapes. The generated
    `backend/server.js` contract remains unchanged. Direct server-entry drift
    check and Phase 29 passed.

639. Add an all-pages live control audit for Phase 8.4.
    Done: `ops/scripts/runtime/live-checks/all-pages-control-audit.ts` now
    provides a reusable Playwright gate for every manifest route. The audit
    uses the existing login/session helper, opens fresh pages per route/profile,
    records app-owned console and network issues, exercises search inputs,
    safe select controls, tabs, filters, and other non-destructive buttons,
    captures ready/after-control screenshots, and checks for responsive overflow
    and clipped nowrap text. The ops package exposes
    `phase84:all-pages-control-audit`. Destructive or data-mutating controls are
    intentionally skipped so QA does not change production-like data. Proof:
    `npm.cmd --prefix ops run phase84:all-pages-control-audit -- --profile
    exhaustive` passed with 34 route/profile checks, 328 non-destructive
    control interactions, 68 screenshots, and 0 findings.

640. Harden Windows data-root relocation against transient folder locks.
    Done: `backend/src/dataPath/index.ts` now retries archive-directory renames
    for transient `EBUSY`, `EPERM`, and `EACCES` failures before giving up. This
    keeps data-root cleanup and migration safer on Windows when antivirus or
    the file system briefly holds a temp directory. The change preserves the
    same archive path, copy behavior, nested-path rejection, and data safety
    checks. Focused `node backend\test\dataPath.test.ts` and full backend
    `npm.cmd --prefix backend run test:utils` passed.

641. Expand all-pages live control audit navigation coverage.
    Done: `ops/scripts/runtime/live-checks/all-pages-control-audit.ts` now
    recognizes intentional cross-page workflow buttons instead of treating them
    as route instability. Dashboard buttons such as `Review in inventory` and
    `Open inventory` are verified by confirming the expected inventory route,
    recording `navigated-to-inventory` proof, and returning to the dashboard so
    later controls are still tested. The broad gate remains strict for
    accidental route changes. Proof: `npm.cmd --prefix ops run
    phase84:all-pages-control-audit -- --profile exhaustive` passed with 34
    route/profile checks, 779 non-destructive control interactions, 68
    screenshots, and 0 findings. Browser-action smoke, deep live audit, full
    Phase 8.4 live suite, public Cloudflare portal check, post-live hygiene,
    frontend utility suite, frontend production build, backend utility suite,
    and Phase 29 audit also passed.

642. Record skipped all-pages controls with explicit audit reasons.
    Done: `ops/scripts/runtime/live-checks/all-pages-control-audit.ts` now
    includes skipped button candidates in the summary instead of dropping them
    before reporting. Each skipped control records a reason, including mutating
    or external actions, long data-row labels, empty accessible labels, and
    low-value pagination/alphabet/icon controls. Safe non-destructive buttons
    are still clicked and verified. This gives future sessions a clearer
    coverage ledger: what was tested live, what was intentionally skipped, and
    what needs seeded rollback tests before destructive interaction coverage.
    Proof: focused dashboard audit passed with 142 control records and 0
    findings; full exhaustive all-pages audit passed with 34 route/profile
    checks, 909 control records, 668 tested controls, 241 skipped controls with
    reasons, 68 screenshots, and 0 findings. Post-live hygiene and Phase 29
    audit passed.

643. Add machine-readable all-pages control coverage summary.
    Done: `ops/scripts/runtime/live-checks/all-pages-control-audit.ts` now
    writes a top-level `coverage` block into `summary.json`. The block records
    total, tested, passed, failed, skipped, by-kind counts, skipped-by-reason
    counts, and per-route tested/failed/skipped totals. The console output also
    prints tested, skipped, failed, and skipped-by-reason counts so future
    sessions can quickly tell whether the broad audit was meaningful without
    custom report parsing. Proof: focused dashboard audit passed with 142
    control records, 132 tested controls, 10 skipped controls, and 0 findings;
    full exhaustive all-pages audit passed with 34 route/profile checks, 908
    control records, 667 tested controls, 241 skipped controls, 0 failed
    controls, 68 screenshots, and 0 findings. Post-live hygiene, Phase 29
    audit, and diff whitespace checks passed.

644. Add coverage gates to the all-pages live control audit.
    Done: `ops/scripts/runtime/live-checks/all-pages-control-audit.ts` now
    turns coverage collapse into a priority-0 audit finding. The gate fails
    when tested controls fall below the greater of
    `BOS_ALL_PAGES_MIN_TESTED_CONTROLS` or
    `routes * BOS_ALL_PAGES_MIN_TESTED_PER_ROUTE`, and when the skipped-control
    ratio exceeds `BOS_ALL_PAGES_MAX_SKIPPED_RATIO`. Defaults are conservative
    for broad non-destructive QA: 3 tested controls per route/profile and a
    maximum skipped ratio of 0.75, with environment overrides for future seeded
    rollback suites. Proof: focused dashboard audit passed under the gates with
    142 control records, 132 tested controls, 10 skipped controls, and 0
    findings; full exhaustive all-pages audit passed under the gates with 34
    route/profile checks, 908 control records, 667 tested controls, 241 skipped
    controls, 0 failed controls, 68 screenshots, and 0 findings. Post-live
    hygiene, Phase 29 audit, and diff whitespace checks passed.

645. Make all-pages control coverage gates route-aware.
    Done: `ops/scripts/runtime/live-checks/all-pages-control-audit.ts` now
    checks every individual audited route/profile against
    `BOS_ALL_PAGES_MIN_TESTED_PER_ROUTE`, in addition to the global tested
    control floor. If any route falls below the minimum, the audit emits a
    priority-0 coverage finding with the weak route list, so high-control pages
    cannot hide weak coverage on smaller pages. Proof: focused
    `loyalty_points` audit passed on the current lowest-coverage route with 16
    control records, 7 tested controls, 9 skipped controls, and 0 findings;
    full exhaustive all-pages audit passed with 34 route/profile checks, 908
    control records, 667 tested controls, 241 skipped controls, 0 failed
    controls, 68 screenshots, and 0 findings. Post-live hygiene, Phase 29
    audit, and diff whitespace checks passed.

646. Gate per-route skipped-control ratios and tolerate loader breadcrumbs.
    Done: `ops/scripts/runtime/live-checks/all-pages-control-audit.ts` now
    checks every route/profile against `BOS_ALL_PAGES_MAX_ROUTE_SKIPPED_RATIO`,
    defaulting to 0.8, in addition to the global skipped-control ratio. This
    blocks a page that is mostly skipped even when the whole-app totals look
    healthy. The exact `[PageLoader] Page bundle is still loading...` warning is
    also classified as a non-blocking recovery diagnostic because frontend
    loading UX tests intentionally require that breadcrumb; visible stalls and
    failed route readiness still fail through the route/layout gates. Proof:
    focused `inventory` audit passed on the current highest skipped-ratio route
    with 94 control records, 26 tested controls, 68 skipped controls, and 0
    findings; full exhaustive all-pages audit passed with 34 route/profile
    checks, 909 control records, 668 tested controls, 241 skipped controls, 0
    failed controls, 68 screenshots, and 0 findings. Post-live hygiene, Phase
    29 audit, and diff whitespace checks passed.

647. Write all-pages control coverage Markdown reports.
    Done: `ops/scripts/runtime/live-checks/all-pages-control-audit.ts` now
    writes a per-run `coverage.md` and the latest
    `ops/runtime/reports/all-pages-control-audit-latest.md` beside the existing
    JSON summaries. The JSON artifact list now includes those Markdown report
    paths, making broad Phase 8.4 coverage readable without a custom parser.
    The report summarizes whole-app coverage, controls by kind, skipped
    reasons, lowest-tested routes, highest-skipped routes, findings, and
    screenshot totals. Proof: focused `loyalty_points` audit passed with 16
    controls, 7 tested controls, 9 skipped controls, 4 screenshots, and 0
    findings; full exhaustive all-pages audit passed with 34 route/profile
    checks, 908 control records, 667 tested controls, 241 skipped controls, 0
    failed controls, 68 screenshots, and 0 findings. Post-live hygiene and
    Phase 29 audit passed.

648. Add seeded rollback backlog reports for skipped mutating controls.
    Done: `ops/scripts/runtime/live-checks/all-pages-control-audit.ts` now
    writes per-run and latest JSON/Markdown rollback backlog artifacts for
    controls that the broad non-mutating audit must not click directly. The
    backlog categorizes skipped controls by required harness: data-mutating,
    settings-toggle, print-or-download, file-or-media, external-message, or
    mutation-risk. The skip policy also stopped treating generic `choose`
    wording as a file/media risk, which removed public-catalog FAQ false
    positives and increased tested coverage. Proof: focused `public_catalog`
    audit passed with 136 controls, 116 tested controls, 20 skipped controls,
    and 0 findings; full exhaustive all-pages audit passed with 34
    route/profile checks, 909 control records, 670 tested controls, 239 skipped
    controls, 0 failed controls, 68 screenshots, and 0 findings. The seeded
    rollback latest report lists 28 candidates: 14 data-mutating controls, 12
    settings toggles, and 2 print/download controls. Post-live hygiene and
    Phase 29 audit passed.

649. Harden dynamic receipt-settings control targeting.
    Done: `ops/scripts/runtime/live-checks/all-pages-control-audit.ts` now
    re-finds button candidates by fresh accessible name before clicking, while
    avoiding stale-index fallback on the dynamic receipt settings page. Compact
    receipt preview language buttons (`EN`, `KH`, `Both`) are now classified as
    rollback-harness controls because they change receipt language settings.
    The earlier generic `Hide/Show N fields` skip rule was removed after code
    inspection confirmed those are local section expand/collapse controls, not
    settings writes. Proof: focused `receipt_settings` audit passed with 34
    controls, 15 tested controls, 19 skipped controls, and 0 findings; full
    exhaustive all-pages audit passed with 34 route/profile checks, 908 control
    records, 708 tested controls, 200 skipped controls, 0 failed controls, 68
    screenshots, and 0 findings. The seeded rollback latest report now lists
    19 candidates: 14 data-mutating controls, 3 settings language toggles, and
    2 print/download controls. Post-live hygiene and Phase 29 audit passed.

650. Add receipt-settings rollback live coverage and settings conflict hardening.
    Done: a new `phase84:receipt-settings-rollback` script exercises the
    compact receipt preview language controls with a rollback harness instead
    of leaving them as skipped mutating controls in the broad audit. The check
    snapshots the original receipt template, seeds English, clicks `KH`, `Both`,
    and `EN`, verifies the persisted `receipt_language`, writes a screenshot and
    JSON report, then restores the original template. Frontend settings writes
    now classify `settings_conflict`, retry small writes against newer
    timestamps, keep receipt-settings queued auto-saves pointed at the latest
    template, and can narrowly bypass stale timestamp metadata for this receipt
    template fallback while the old packaged backend remains deployed. The
    backend settings route now scopes optimistic timestamp comparison to the
    attempted keys so unrelated background sync settings do not block compact
    UI writes after the next backend rollout. Docker release packaging was
    adjusted toward the generated `.pkg-stage` Node runtime path because the
    current `pkg` binary path failed to emit an artifact; Docker Desktop still
    hung during replacement-image build, so the live app was updated by placing
    rebuilt frontend assets in `/runtime/frontend/dist` and restarting the app
    container. Proof: frontend utility tests, frontend typecheck, frontend
    build, backend utility tests, and the receipt-settings rollback live check
    passed. Follow-up remains to finish a clean Docker image rebuild.

651. Complete Docker rebuild follow-up and fix supplier returns stack overflow.
    Done: the release Dockerfile now wires `BUILD_COMMIT` into
    `BUSINESS_OS_BUILD_REVISION` for both Vite frontend builds and runtime
    `/health` metadata, eliminating the `dev` revision mismatch in packaged
    Docker releases. The stale runtime frontend override was removed, the stack
    was recreated on a fresh timestamped `business-os` release tag, and older
    unused `business-os` image tags were deleted so only `latest` and the active
    timestamped release remain. The broad live suite then exposed a supplier
    returns crash caused by `clearLoadWatchdog` recursively calling itself in
    `frontend/src/components/returns/Returns.tsx`; it now clears the stored
    timer with `window.clearTimeout`. Proof: frontend typecheck, frontend
    build, focused supplier-returns Playwright interaction, receipt-settings
    rollback live check, post-live hygiene, Phase 29 audit,
    dashboard/products/POS/receipt-settings desktop and mobile control audit,
    full Phase 8.4 live suite, public Cloudflare portal check, and admin
    Cloudflare `/health` check passed.

652. Scope ESM package metadata for runtime audit and live-check scripts.
    Done: local `package.json` files under
    `ops/scripts/runtime/audits` and `ops/scripts/runtime/live-checks` declare
    only those TypeScript script families as ESM, avoiding global package-type
    changes that would break CommonJS storage, Cloudflare, smoke, and release
    orchestration scripts. `action-history-undo-redo-check.ts` was converted to
    native ESM imports with `import.meta.url` path resolution so it remains in
    the audit family and still cleans up its seeded QA rows in `finally`. Proof:
    receipt-settings rollback live check, action-history undo/redo check, and
    post-live hygiene all passed with the scoped package metadata in place.

653. Close the Scanbot Worker false positive and share camera permission helpers.
    Done: `cameraPermission.ts` now centralizes typed camera permission reads
    and watchers for the Scanbot adapter and barcode scanner modal, replacing
    duplicate local normalization in both files. The Phase 29 language/runtime
    audit rejects `scanbotScanner.ts` as a Web Worker candidate because the file
    owns vendor UI script injection, document camera policy checks, browser
    permission reads, and SDK UI startup. Those browser boundaries must stay on
    the main thread; the useful optimization was the shared typed helper and
    stronger focused coverage. Proof: focused Scanbot scanner tests, frontend
    utility suite, frontend typecheck, frontend production build, and regenerated
    language/runtime audit passed.

654. Retire obsolete JSX shim and stale frontend chunk paths.
    Done: `vite.config.ts` now references the converted TypeScript source paths
    for media upload, portal menu, and write-conflict modal chunking. The
    obsolete `frontend/src/types/jsx-modules.d.ts` file was deleted after
    source scans proved there are no active frontend `.jsx` files or imports,
    and `utilsSettingsBarrel.test.ts` now asserts that the shim stays retired.
    The language/runtime audit no longer lists JSX declaration support for
    converted dashboard/settings barrels, and the generated module naming guide
    now uses `.tsx`/`.ts` frontend naming. Proof: stale-path scans, focused
    utils-settings and scanner tests, frontend typecheck, frontend utility
    suite, frontend production build, regenerated references, and Phase 29 audit
    passed.

655. Rename the frontend syntax guard to the TypeScript source contract.
    Done: `frontend/tests/jsxSyntaxCheck.ts` moved to
    `frontend/tests/sourceSyntaxCheck.ts`, and the checker now enforces that
    `frontend/src` contains only `.ts` and `.tsx` source files. Any new
    first-party `.js`, `.jsx`, `.mjs`, or `.cjs` under `frontend/src` now fails
    the guard before it can drift into the active app. `npm run check:source`
    is the primary script, while `npm run check:jsx` remains as a compatibility
    alias so old wrappers do not break. Proof: focused source checker,
    compatibility alias checker, stale `jsxSyntaxCheck` scans, frontend utility
    suite, frontend production build, regenerated references, Phase 29 audit,
    and focused Products desktop/mobile live control audit passed.

656. Align the language/runtime audit with the TypeScript frontend baseline.
    Done: `ops/scripts/architecture/language-runtime-audit.ts` now reports the
    default frontend runtime as `React/TypeScript source with Vite-emitted
    browser JavaScript` instead of the stale React/JavaScript wording. This
    keeps Phase 29 and the generated reference docs synchronized with the
    current end-state: active frontend source is TypeScript/TSX, the backend
    remains Node.js, and the runtime JavaScript inventory separately governs
    generated wrappers and the Scanbot vendor bundle. Proof: regenerated
    language/runtime audit, frontend source guard, Phase 29 audit, and focused
    Products desktop/mobile live control audit passed.

657. Refresh the live optimization status baseline.
    Done: `ops/docs/OPTIMIZATION-STATUS.md` now points future sessions at the
    June 1 state instead of the older May 30 migration snapshot. It records
    Move 656 as the latest completed move, the latest focused Products
    desktop/mobile control-audit report, the latest local production build
    hash, the TypeScript/TSX-only `frontend/src` contract, and the runtime
    JavaScript inventory as the authority for generated wrappers and vendor
    JavaScript. The current working rules and accepted-win proof wording now
    refer to the TypeScript source guard instead of the old JSX scan label.
    Proof: status-doc stale wording scans, frontend source guard, Phase 29
    audit, and focused Products desktop/mobile live control audit passed.

658. Extract typed API query helpers from the large domain registry.
    Done: `frontend/src/api/query.ts` now contains the typed
    `buildQueryString`, `appendQuery`, and `normalizePositiveUniqueIds`
    helpers that were previously embedded inside
    `frontend/src/api/methods.ts`. This is the first executable split toward
    shrinking the remaining `ts-nocheck` API registry: pure request-shaping
    logic now has explicit types, direct tests, and a documented folder
    boundary in `frontend/src/api/README.md`. Proof: focused API HTTP tests,
    frontend source guard, frontend typecheck, frontend utility suite,
    frontend production build, Phase 29 audit, and focused Products
    desktop/mobile live control audit passed.

659. Extract typed API request-id, conflict, and sync-preview helpers.
    Done: `frontend/src/api/requestIds.ts` now owns client request-id creation
    and capping for write idempotency, `frontend/src/api/conflicts.ts` owns
    compact settings and return-item conflict-attempt payload builders, and
    `frontend/src/api/syncPreview.ts` owns the bounded pending-sync queue
    preview serializer. `frontend/src/api/methods.ts` now imports those typed
    helpers instead of keeping the pure logic inside the large `ts-nocheck`
    registry. The API guide documents the new boundaries, and the focused API
    HTTP tests exercise all three helpers directly. Proof: focused API HTTP
    tests, frontend source guard, frontend typecheck, frontend utility suite,
    frontend production build, Phase 29 audit, and focused Products
    desktop/mobile live control audit passed.

660. Extract typed API actor query helpers from the large domain registry.
    Done: `frontend/src/api/actorQuery.ts` now owns the current-user context
    reader and actor query-string appender previously embedded in
    `frontend/src/api/methods.ts`. The helper keeps the existing
    `businessos_user` storage contract, adds explicit `CurrentUserContext` and
    `ActorQueryParams` types, and preserves the low-allocation
    `Object.keys`/`URLSearchParams` loop for extra query values. The API guide
    documents the new boundary and the focused API HTTP test covers stored
    user attribution and existing-query append behavior. The production build
    now reports the `app-api-methods` chunk around 59.54 kB. Proof: focused
    API HTTP tests, frontend source guard, frontend typecheck, frontend utility
    suite, frontend production build, Phase 29 audit, and focused Products
    desktop/mobile live control audit passed.

661. Extract typed portal HTTP helpers from the large domain registry.
    Done: `frontend/src/api/portalHttp.ts` now owns the public portal base URL
    resolver and abortable fetch helper previously embedded in
    `frontend/src/api/methods.ts`. The helper keeps browser origin ahead of
    sync-server fallback, trims a trailing slash, wires an `AbortController`
    signal into each request, and preserves the existing timeout error text.
    Portal catalog, membership, submission, and portal AI calls now share this
    typed timeout path. The API guide documents the boundary and the focused
    API HTTP test covers browser-origin preference plus signal wiring. The
    production build now reports the `app-api-methods` chunk around 59.16 kB.
    Proof: focused API HTTP tests, frontend source guard, frontend typecheck,
    frontend utility suite, frontend production build, Phase 29 audit, and
    focused Products desktop/mobile live control audit passed.

662. Extract typed import multipart transport helpers from the large domain
    registry.
    Done: `frontend/src/api/importTransport.ts` now owns multipart import
    headers, device-info payload enrichment, and live-server form posting
    previously embedded in `frontend/src/api/methods.ts`. The helper keeps the
    same live-write gate, sync-server base URL trimming, device metadata
    headers, cookie credentials, and server error fallback while giving import
    upload/CSV/restore/history/rollback flows one typed transport boundary.
    The API guide documents the split and the focused API HTTP test covers
    headers, payload enrichment, and multipart request wiring. The source guard
    parsed 198 frontend files and the production build now reports the
    `app-api-methods` chunk around 58.47 kB. Proof: focused API HTTP tests,
    frontend source guard, frontend typecheck, frontend utility suite,
    frontend production build, Phase 29 audit, and focused Products
    desktop/mobile live control audit passed.

663. Extract typed notification and Drive cooldown fallback helpers from the
    large domain registry.
    Done: `frontend/src/api/cooldownFallbacks.ts` now owns notification summary
    and Drive sync status fallback payloads, browser storage number helpers,
    notification missing cooldown state, and Drive sync cooldown state
    previously embedded in `frontend/src/api/methods.ts`. The helper keeps the
    existing session/local storage persistence plus memory fallback for
    no-window test/SSR environments, while `methods.ts` now calls named
    mark/read/clear functions instead of reaching into storage-key and TTL
    details. The API guide documents the boundary and the focused API HTTP test
    covers fallback shapes plus mark/read/clear behavior. The source guard
    parsed 199 frontend files and the production build now reports the
    `app-api-methods` chunk around 56.80 kB. Proof: focused API HTTP tests,
    frontend source guard, frontend typecheck, frontend utility suite,
    frontend production build, Phase 29 audit, and focused Products
    desktop/mobile live control audit passed.

664. Extract typed read-query cache helpers from the large domain registry.
    Done: `frontend/src/api/queryCache.ts` now owns read-cache key
    construction, six-hour TTL reads, Dexie settings writes, and prefix-based
    invalidation scans previously embedded in `frontend/src/api/methods.ts`.
    The helper preserves the explicit nested loops used to avoid chained
    map/filter allocations while giving product search/filter/lookup and
    inventory product search flows one typed cache boundary. The API guide
    documents the split and the focused API HTTP test covers cache-key trimming
    plus the typed invalidation loop location. The source guard parsed 200
    frontend files and the production build now reports the `app-api-methods`
    chunk around 55.95 kB. Proof: focused API HTTP tests, frontend source
    guard, frontend typecheck, frontend utility suite, frontend production
    build, Phase 29 audit, and focused Products desktop/mobile live control
    audit passed.

665. Extract typed optimistic updated-at helpers from the large domain registry.
    Done: `frontend/src/api/expectedUpdatedAt.ts` now owns row and settings
    expected-updated-at payload shaping previously embedded in
    `frontend/src/api/methods.ts`. The helper preserves explicit
    `expectedUpdatedAt` and `expected_updated_at` values, promotes row
    `updated_at` into `expectedUpdatedAt`, falls back to Dexie table rows, and
    uses settings metadata for settings saves. The API guide documents the
    boundary and the focused API HTTP test covers explicit and row timestamp
    behavior. The source guard parsed 201 frontend files and the production
    build now reports the `app-api-methods` chunk around 55.46 kB. Proof:
    focused API HTTP tests, frontend source guard, frontend typecheck,
    frontend utility suite, frontend production build, Phase 29 audit, and
    focused Products desktop/mobile live control audit passed.

666. Extract typed local mirror helpers from the large domain registry.
    Done: `frontend/src/api/localMirrors.ts` now owns asynchronous mirror
    fan-out, live-server mirror persistence checks, sensitive mirror purge
    state, and Dexie mirror table replacement previously embedded in
    `frontend/src/api/methods.ts`. The helper keeps the existing policy that
    clears sensitive live-server mirrors while preserving safe offline fallback
    mirrors, and `methods.ts` keeps only the route wrapper that combines server
    reads with local fallbacks. The API guide documents the boundary and the
    focused API HTTP test covers asynchronous mirror return behavior plus source
    placement. The source guard parsed 202 frontend files and the production
    build now reports the `app-api-methods` chunk around 55.09 kB. Proof:
    focused API HTTP tests, frontend source guard, frontend typecheck,
    frontend utility suite, frontend production build, Phase 29 audit, and
    focused Products desktop/mobile live control audit passed.

667. Extract typed sync-runtime helpers shared by the API registry and browser
    bootstrap.
    Done: `frontend/src/api/syncRuntime.ts` now owns sync event fan-out,
    queue-change events, stored-session detection, offline outbox
    background-sync registration, and the shared outbox sync tag. This removes
    duplicate event/service-worker plumbing from `frontend/src/api/methods.ts`
    and `frontend/src/web-api.ts`, keeps `getAppBootstrap` on the moved local
    mirror purge helper, and gives the offline queue path one typed boundary
    before deeper API registry conversion. The API guide documents the split,
    the focused API HTTP test covers compact event emission, and the
    offline-sync architecture test verifies the secure background-sync
    registration moved into the helper. The source guard parsed 203 frontend
    files and the production build now reports the `app-api-methods` chunk
    around 54.22 kB. Proof: focused API HTTP tests, offline-sync architecture
    tests, frontend source guard, frontend typecheck, frontend utility suite,
    and frontend production build passed.

668. Extract typed browser dialog helpers from the large domain registry.
    Done: `frontend/src/api/browserDialogs.ts` now owns the browser CSV picker,
    CSV/TSV text decoding, and image/data-url null fallbacks previously embedded
    in `frontend/src/api/methods.ts`. The public `window.api` surface remains
    stable because `methods.ts` re-exports `openCSVDialog`, `openImageDialog`,
    and `getImageDataUrl`, while the large registry no longer imports
    `decodeTextBuffer` or carries DOM file-input code. The API guide documents
    the split and the focused API HTTP test covers image/data-url fallback
    behavior plus source placement. The source guard parsed 204 frontend files
    and the production build now reports the `app-api-methods` chunk around
    53.85 kB. Proof: focused API HTTP tests, frontend source guard, frontend
    typecheck, frontend utility suite, and frontend production build passed.

669. Extract typed system job and backup queue helpers from the large domain
    registry.
    Done: `frontend/src/api/systemJobs.ts` now owns long-running system job
    polling, cancellation transport, job id validation, backup folder export
    queue payloads, and backup folder restore queue payloads previously
    embedded in `frontend/src/api/methods.ts`. The public wrappers remain in
    `methods.ts` so existing `window.api` calls keep working, while the large
    registry no longer carries the wait loop, poll loop, or backup queue
    assembly. The API guide documents the split, focused API HTTP tests verify
    source placement, and Backup tests verify the queued job methods remain
    exposed. The source guard parsed 205 frontend files and the production
    build now reports the `app-api-methods` chunk around 52.93 kB. Proof:
    focused API HTTP tests, Backup job tests, frontend source guard, frontend
    typecheck, frontend utility suite, and frontend production build passed.

670. Extract typed Google Drive sync helpers from the large domain registry.
    Done: `frontend/src/api/driveSync.ts` now owns Google Drive sync status
    cooldown fallback, shared in-flight status requests, preference saves,
    OAuth start, disconnect, credential forgetting, and queued sync job
    transport previously embedded in `frontend/src/api/methods.ts`. The public
    wrappers remain in `methods.ts` so existing `window.api` calls keep working,
    while the large registry no longer imports Drive-specific cooldown helpers
    or carries Drive sync request promise state. The API guide documents the
    split and focused API HTTP tests verify source placement. The source guard
    parsed 206 frontend files and the production build now reports the
    `app-api-methods` chunk around 51.89 kB. Proof: focused API HTTP tests,
    Backup job tests, frontend source guard, frontend typecheck, frontend
    utility suite, frontend production build, Phase 29 audit, focused Products
    desktop/mobile live control audit, and post-live hygiene passed.

671. Extract typed notification summary helpers from the large domain registry.
    Done: `frontend/src/api/notificationSummary.ts` now owns notification
    summary cooldown fallback, transient gateway handling, and shared in-flight
    request state previously embedded in `frontend/src/api/methods.ts`. The
    public wrapper remains in `methods.ts` so existing `window.api` calls keep
    working, while the large registry no longer imports notification cooldown
    helpers or carries notification request promise state. The API guide
    documents the split and focused API HTTP tests verify source placement. The
    source guard parsed 207 frontend files and the production build now reports
    the `app-api-methods` chunk around 51.38 kB. Proof: focused API HTTP tests,
    frontend source guard, frontend typecheck, frontend utility suite,
    frontend production build, Phase 29 audit, focused Products desktop/mobile
    live control audit, and post-live hygiene passed.

672. Extract typed system runtime transport from the large domain registry.
    Done: `frontend/src/api/systemRuntime.ts` now owns reset/factory-reset
    transport, sync-server health checks, open-path/folder picker transport,
    data-path reads and writes, browse-dir, and scale-migration transport
    previously embedded in `frontend/src/api/methods.ts`. The public wrappers
    remain in `methods.ts`, and runtime cache invalidation intentionally stays
    there so reset/data-path mutations keep the original app-shared chunk edge
    instead of adding a new one from the helper. The API guide documents the
    split and focused API HTTP tests verify source placement. The source guard
    parsed 208 frontend files and the production build now reports the
    `app-api-methods` chunk around 49.90 kB with no circular chunk warning
    after the final helper adjustment. Proof: focused API HTTP tests, frontend
    source guard, frontend typecheck, frontend utility suite, frontend
    production build, Phase 29 audit, focused Products desktop/mobile live
    control audit, and post-live hygiene passed.

673. Extract typed auth and organization transport from the large domain
    registry.
    Done: `frontend/src/api/authTransport.ts` now owns login/logout, password
    reset, session-duration updates, verification capabilities, owned Google
    OAuth, organization bootstrap/search, and current-organization transport
    previously embedded in `frontend/src/api/methods.ts`. The public wrappers
    remain in `methods.ts`, while direct auth endpoint strings, device metadata
    enrichment, OAuth route calls, and organization lookup URLs now live in one
    typed boundary. The API guide documents the split and focused API HTTP
    tests verify source placement plus login device metadata enrichment. The
    source guard parsed 209 frontend files and the production build now reports
    the `app-api-methods` chunk around 48.96 kB with no circular chunk warning.
    Proof: focused API HTTP tests, frontend source guard, frontend typecheck,
    frontend utility suite, frontend production build, Phase 29 audit, focused
    Products desktop/mobile live control audit, and post-live hygiene passed.

674. Extract typed OTP transport into the auth boundary.
    Done: `frontend/src/api/authTransport.ts` now owns OTP setup, confirm,
    disable, verify, and status transport alongside the other auth calls.
    `methods.ts` keeps the public `otpSetup`, `otpConfirm`, `otpDisable`,
    `otpVerify`, and `otpStatus` wrappers for existing `window.api` callers,
    while direct `/api/auth/otp/*` endpoint strings are no longer embedded in
    the large domain registry. OTP status now URL-encodes the user id at the
    transport boundary. The API guide documents OTP/2FA under the auth
    transport split, and focused API HTTP tests verify the source placement.
    The source guard parsed 209 frontend files and the production build now
    reports the `app-api-methods` chunk around 48.85 kB with no circular chunk
    warning. Proof: focused API HTTP tests, frontend source guard, frontend
    typecheck, frontend utility suite, frontend production build, Phase 29
    audit, focused Products desktop/mobile live control audit, and post-live
    hygiene passed.

675. Extract typed system diagnostics transport into the system runtime
    boundary.
    Done: `frontend/src/api/systemRuntime.ts` now owns system config reads,
    system debug-log reads, and the read-only integration doctor route next to
    the existing reset, data-path, sync-server, and scale-migration transport.
    `methods.ts` keeps public `getSystemConfig`, `getSystemDebugLog`, and
    `getIntegrationDoctor` wrappers for existing `window.api` callers, while
    direct system diagnostics endpoint strings and integration-doctor query
    shaping are no longer embedded in the large domain registry. Focused API
    HTTP tests verify the read-only GET body contract and source placement.
    The source guard parsed 209 frontend files and the production build now
    reports the `app-api-methods` chunk around 48.48 kB with no circular chunk
    warning. Proof: focused API HTTP tests, frontend source guard, frontend
    typecheck, frontend utility suite, frontend production build, Phase 29
    audit, focused Products desktop/mobile live control audit, and post-live
    hygiene passed.

676. Extract typed AI provider transport from the large domain registry.
    Done: `frontend/src/api/aiTransport.ts` now owns AI provider list,
    create, update, delete, test, and AI response read transport previously
    embedded in `frontend/src/api/methods.ts`. The helper keeps actor
    attribution on provider and response reads through the shared
    `appendActorQuery` boundary, while `methods.ts` keeps public wrapper names
    for existing `window.api` callers. The API guide documents the new AI
    transport split, and focused API HTTP tests verify source placement plus
    actor-query usage. The source guard parsed 210 frontend files and the
    production build now reports the `app-api-methods` chunk around 48.10 kB
    with no circular chunk warning. Proof: focused API HTTP tests, frontend
    source guard, frontend typecheck, frontend utility suite, frontend
    production build, Phase 29 audit, focused Products desktop/mobile live
    control audit, and post-live hygiene passed.

677. Extract typed customer portal transport from the large domain registry.
    Done: `frontend/src/api/portalTransport.ts` now owns customer portal
    catalog/config reads, portal catalog search, membership lookup, customer
    portal submissions, portal AI status/chat calls, and admin portal
    submission review actions previously embedded in
    `frontend/src/api/methods.ts`. Timeout headers and API-version mismatch
    handling moved beside the portal fetch helper, while `methods.ts` keeps
    public `window.api` wrapper names for compatibility. The API guide
    documents the new portal transport split, and focused API HTTP tests verify
    source placement plus mismatch handling. The source guard parsed 211
    frontend files and the production build now reports the `app-api-methods`
    chunk around 45.75 kB with no circular chunk warning. Proof: focused API
    HTTP tests, frontend source guard, frontend typecheck, frontend utility
    suite, and frontend production build passed; Phase 29 audit and post-live
    hygiene passed; the focused public catalog desktop/mobile live control
    audit passed with 42/42 controls tested and zero findings.

678. Extract typed action history transport from the large domain registry.
    Done: `frontend/src/api/actionHistoryTransport.ts` now owns action
    history reads, create/update mutations, and undo/redo calls previously
    embedded in `frontend/src/api/methods.ts`. The helper keeps shared
    query-builder usage and device-attribution payload shaping in a typed
    boundary, while `methods.ts` keeps public `window.api` wrapper names for
    compatibility. The API guide documents the new action-history transport
    split, and focused API HTTP tests verify source placement plus
    query-builder ownership. The source guard parsed 212 frontend files and
    the production build now reports the `app-api-methods` chunk around
    45.34 kB with no circular chunk warning. Proof: focused API HTTP tests,
    frontend source guard, frontend typecheck, frontend utility suite,
    frontend production build, and focused Audit Log desktop/mobile live
    control audit passed with zero findings; Phase 29 and live hygiene checks
    are rerun after reference refresh.

679. Extract typed inventory core transport from the large domain registry.
    Done: `frontend/src/api/inventoryTransport.ts` now owns stock adjust,
    transfer, row move, inventory summary/stats, inventory product search,
    movement history, and inventory reason read/write transport previously
    embedded in `frontend/src/api/methods.ts`. The shared mirrored-read helper
    moved into `frontend/src/api/localMirrors.ts`, so inventory product search
    keeps cache-backed fallback behavior while `methods.ts` keeps public
    `window.api` wrapper names for compatibility. The API guide documents the
    new inventory transport split, and focused API HTTP tests verify source
    placement plus mirrored query-cache ownership. The source guard parsed 213
    frontend files and the production build now reports the `app-api-methods`
    chunk around 44.19 kB with no circular chunk warning. Proof: focused API
    HTTP tests, frontend source guard, frontend typecheck, frontend utility
    suite, frontend production build, and focused Inventory desktop/mobile live
    control audit passed with zero findings; Phase 29 and live hygiene checks
    are rerun after reference refresh.

680. Extract typed RFID transport from the large domain registry.
    Done: `frontend/src/api/rfidTransport.ts` now owns RFID gateway status,
    tag search/create, session creation, session event recording, review reads,
    and apply writes previously embedded in `frontend/src/api/methods.ts`. The
    helper keeps shared query building, RFID session id encoding, and
    device-attributed write payload shaping in a typed boundary, while
    `methods.ts` keeps public `window.api` wrapper names for compatibility.
    The API guide documents the new RFID transport split, and focused API HTTP
    tests verify source placement plus id encoding. The source guard parsed 214
    frontend files and the production build now reports the `app-api-methods`
    chunk around 43.40 kB with no circular chunk warning. Proof: focused API
    HTTP tests, frontend source guard, frontend typecheck, frontend utility
    suite, frontend production build, and focused Inventory desktop/mobile live
    control audit passed with zero findings; Phase 29 and live hygiene checks
    are rerun after reference refresh.

681. Extract typed category/unit lookup transport from the large domain registry.
    Done: `frontend/src/api/lookupTransport.ts` now owns category and unit
    lookup reads and create/update/delete transport previously embedded in
    `frontend/src/api/methods.ts`. The helper keeps mirrored offline reads and
    expected-updated-at guarded mutations in a typed boundary, while
    `methods.ts` keeps public `window.api` wrapper names and lookup refresh
    side effects for compatibility. The API guide documents the new lookup
    transport split, and focused API HTTP tests verify source placement,
    mirrored reads, expected-updated-at handling, and no direct category/unit
    fetch calls in the large registry. The source guard parsed 215 frontend
    files and the production build now reports the `app-api-methods` chunk
    around 42.83 kB and the main `app-api` chunk around 60.66 kB with no
    circular chunk warning. Proof: focused API HTTP tests, frontend source
    guard, frontend typecheck, frontend utility suite, frontend production
    build, and focused Products desktop/mobile live control audit passed with
    42/42 controls tested and zero findings; Phase 29 and live hygiene checks
    are rerun after reference refresh.

682. Extract typed branch transport from the large domain registry.
    Done: `frontend/src/api/branchTransport.ts` now owns branch list, summary,
    stock lookup, branch create/update/delete, transfer list/write, and branch
    stock-integrity transport previously embedded in
    `frontend/src/api/methods.ts`. The helper keeps mirrored branch reads,
    encoded branch id paths, device-attributed write payloads, transfer
    fallbacks, and expected-updated-at guarded branch mutations in a typed
    boundary, while `methods.ts` keeps public `window.api` wrapper names for
    compatibility. The API guide documents the new branch transport split, and
    focused API HTTP tests verify source placement, mirrored reads, id encoding,
    expected-updated-at handling, and no direct branch fetch calls in the large
    registry. The source guard parsed 216 frontend files and the production
    build now reports the `app-api-methods` chunk around 41.91 kB with no
    circular chunk warning. Proof: focused API HTTP tests, frontend source
    guard, frontend typecheck, frontend utility suite, frontend production
    build, and focused Branch desktop/mobile live control audit passed with
    zero findings; Phase 29 and live hygiene checks are rerun after reference
    refresh.

683. Extract typed product read transport from the large domain registry.
    Done: `frontend/src/api/productReadTransport.ts` now owns product
    list/search reads, bounded product id lookup, product filter metadata,
    lookup usage reads, and lookup replacement transport previously embedded in
    `frontend/src/api/methods.ts`. The helper keeps product query-cache keys,
    mirrored product reads, id normalization, and live-server lookup
    replacement gating in a typed boundary, while `methods.ts` keeps public
    `window.api` wrapper names for compatibility. Lookup replacement now gates
    first and then performs the write, instead of passing the fetch promise as
    an unused gate argument. The API guide documents the new product read
    transport split, and focused API HTTP tests verify source placement,
    query-cache ownership, id normalization, and no direct product read/lookup
    fetch calls in the large registry. The source guard parsed 217 frontend
    files and the production build now reports the `app-api-methods` chunk
    around 41.09 kB with no circular chunk warning. Proof: focused API HTTP
    tests, product search pagination tests, frontend source guard, frontend
    typecheck, frontend utility suite, frontend production build, and focused
    Products desktop/mobile live control audit passed with 42/42 controls
    tested and zero findings; Phase 29 and live hygiene checks are rerun after
    reference refresh.

684. Extract typed product write transport from the large domain registry.
    Done: `frontend/src/api/productWriteTransport.ts` now owns product
    create/update/delete, product variant creation, and product bulk import
    writes previously embedded in `frontend/src/api/methods.ts`. The helper
    keeps supplier auto-create checks, supplier cache invalidation, client
    request ids, device metadata, expected-updated-at product guards, encoded
    product ids, and product mutation route keys in a typed boundary, while
    `methods.ts` keeps public `window.api` wrapper names for compatibility.
    The API guide documents the new product write transport split, and focused
    API HTTP tests verify source placement, supplier auto-create ownership,
    request-id creation, expected-updated-at handling, and no direct product
    mutation fetch calls in the large registry. The source guard parsed 218
    frontend files and the production build now reports the `app-api-methods`
    chunk around 40.23 kB with no circular chunk warning. Proof: focused API
    HTTP tests, frontend source guard, frontend typecheck, frontend utility
    suite, frontend production build, and focused Products desktop/mobile live
    control audit passed with 42/42 controls tested and zero findings; Phase
    29 and live hygiene checks are rerun after reference refresh.

685. Extract typed import job transport from the large domain registry.
    Done: `frontend/src/api/importJobsTransport.ts` now owns import job
    create/list/status/review/action transport, canonical delete with legacy
    POST fallback, queue status, error CSV download, and CSV/ZIP/image uploads
    previously embedded in `frontend/src/api/methods.ts`. The helper keeps
    last-list fallback caching, typed query building, device metadata form
    fields, batched image upload progress, and remove-route compatibility in a
    typed boundary, while `methods.ts` keeps public `window.api` wrapper names
    for compatibility. The API guide documents the new import job split, and
    focused API HTTP tests verify source placement, canonical remove fallback,
    transient list fallback, batched upload ownership, and no direct import job
    fetch calls in the large registry. The source guard parsed 219 frontend
    files and the production build now reports the `app-api-methods` chunk
    around 36.41 kB with no circular chunk warning. Proof: focused API HTTP
    tests, frontend source guard, frontend typecheck, frontend utility suite,
    frontend production build, and focused Products desktop/mobile live control
    audit passed with 42/42 controls tested and zero findings; Phase 29 and
    live hygiene checks are rerun after reference refresh.

686. Extract typed file and upload transport from the large domain registry.
    Done: `frontend/src/api/fileTransport.ts` now owns Library file list/delete
    transport, generic file asset uploads, product image uploads, and user
    avatar uploads previously embedded in `frontend/src/api/methods.ts`. The
    helper keeps file list metadata normalization, XMLHttpRequest upload
    progress, data-url image conversion, actor attribution, upload headers, and
    live-server gating in a typed boundary, while `methods.ts` keeps public
    `window.api` wrapper names for compatibility. The API guide documents the
    new file transport split, and focused API HTTP tests verify source
    placement plus no direct file/upload fetch calls in the large registry.
    Action stability tests now verify Library upload/delete guards against the
    new transport. The source guard parsed 220 frontend files and the
    production build now reports the `app-api-methods` chunk around 32.01 kB
    with no circular chunk warning. Proof: focused API HTTP tests, action
    stability tests, frontend source guard, frontend typecheck, frontend
    utility suite, frontend production build, and focused Library
    desktop/mobile live control audit passed with 16/18 controls tested, 2
    hidden controls skipped, and zero findings; Phase 29 and live hygiene
    checks are rerun after reference refresh.

687. Extract typed contacts transport from the large domain registry.
    Done: `frontend/src/api/contactsTransport.ts` now owns customer, supplier,
    and delivery-contact reads/writes, bulk imports, loyalty point summaries,
    and customer/supplier CSV templates previously embedded in
    `frontend/src/api/methods.ts`. The helper keeps typed entity config,
    mirrored unpaged reads, cached paged customer reads, device-attributed
    creates, expected-updated-at mutations, encoded ids, and shared contact
    mutation/template helpers in a typed boundary, while `methods.ts` keeps
    public `window.api` wrapper names for compatibility. The API guide
    documents the new contacts transport split, and focused API HTTP tests
    verify source placement, cached customer pagination ownership, request-id
    creation, expected-updated-at handling, and no direct contact fetch calls
    in the large registry. The source guard parsed 221 frontend files and the
    production build now reports the `app-api-methods` chunk around 29.42 kB
    with no circular chunk warning. Proof: focused API HTTP tests, frontend
    source guard, frontend typecheck, frontend utility suite, frontend
    production build, and focused Contacts desktop/mobile live control audit
    passed with 24/26 controls tested, 2 controls skipped by visibility/label
    guardrails, and zero findings; Phase 29 and live hygiene checks are rerun
    after reference refresh.

688. Extract typed access-control transport from the large domain registry.
    Done: a dedicated access-control transport owned user, profile,
    auth-method, password, role, and permission-management transport previously
    embedded in `frontend/src/api/methods.ts`. The helper keeps actor-attributed
    user/role reads, mirrored user/role fallbacks, encoded row ids, provider
    disconnect paths, and expected-updated-at user/role security mutations in a
    typed boundary, while `methods.ts` keeps public `window.api` wrapper names
    for compatibility. The API guide documents the new access-control split,
    and focused API HTTP tests verify source placement, mirrored role reads,
    encoded ids, expected-updated-at role mutation ownership, and no direct
    user/role fetch calls in the large registry. The source guard parsed 222
    frontend files and the production build now reports the `app-api-methods`
    chunk around 28.58 kB with no circular chunk warning. Proof: focused API
    HTTP tests, action stability tests, frontend source guard, frontend
    typecheck, frontend utility suite, frontend production build, and focused
    Users desktop/mobile live control audit passed with 14/16 controls tested,
    2 low-value controls skipped, and zero findings; Phase 29 and live hygiene
    checks are rerun after reference refresh.

689. Extract typed app bootstrap transport from the large domain registry.
    Done: `frontend/src/api/appBootstrapTransport.ts` now owns app bootstrap
    local fallback, invalid-session fallback, transient-offline fallback,
    stored-user recovery, local settings bootstrap, sensitive live-server
    mirror purge, and stored-session detection previously embedded in
    `frontend/src/api/methods.ts`. The helper keeps bootstrap startup recovery
    in a typed boundary, while `methods.ts` keeps the public `window.api`
    wrapper name for compatibility. The API guide documents the new bootstrap
    split, and focused API HTTP tests verify invalid-session handling, local
    settings fallback, transient-gateway fallback, source placement, and no
    direct bootstrap fetch in the large registry. The source guard parsed 223
    frontend files and the production build now reports the `app-api-methods`
    chunk around 27.90 kB with no circular chunk warning. Proof: focused API
    HTTP tests, frontend source guard, frontend typecheck, frontend utility
    suite, frontend production build, and focused Dashboard desktop/mobile live
    control audit passed with 36/46 controls tested, 10 long-label controls
    skipped, and zero findings; Phase 29 and live hygiene checks are rerun
    after reference refresh.

690. Extract typed custom tables transport from the large domain registry.
    Done: `frontend/src/api/customTablesTransport.ts` now owns custom table
    list/create transport plus custom row read/create/update/delete transport
    previously embedded in `frontend/src/api/methods.ts`. The helper keeps
    encoded table and row path segments plus the Dexie custom-table fallback in
    a typed boundary, while `methods.ts` keeps public `window.api` wrapper
    names for compatibility. The API guide documents the new custom tables
    split, and focused API HTTP tests verify source placement, encoded path
    ownership, expected-updated-at row update payloads, and no direct custom
    table fetch calls in the large registry. The source guard parsed 224
    frontend files and the production build now reports the `app-api-methods`
    chunk around 27.57 kB with no circular chunk warning. Proof: focused API
    HTTP tests, frontend source guard, frontend typecheck, frontend utility
    suite, frontend production build, and focused Settings desktop/mobile live
    control audit passed with 12/34 controls tested, 22 controls skipped by
    stable broad-audit guardrails, and zero findings; Phase 29 and live hygiene
    checks are rerun after reference refresh.

691. Extract typed audit log transport from the large domain registry.
    Done: `frontend/src/api/auditLogTransport.ts` now owns paged audit-log
    reads, audit row mirroring, local paged fallback shape, shared query
    construction, and retention cleanup with encoded query parameters
    previously embedded in `frontend/src/api/methods.ts`. The helper keeps
    audit log pagination and fallback behavior in a typed boundary, while
    `methods.ts` keeps public `window.api` wrapper names for compatibility.
    The API guide documents the new audit log split, and focused API HTTP tests
    verify user filter exposure, server result return behavior, local fallback
    shape, shared query builder usage, source placement, and no direct audit-log
    fetch calls in the large registry. The source guard parsed 225 frontend
    files and the production build now reports the `app-api-methods` chunk
    around 26.97 kB with no circular chunk warning. Proof: focused API HTTP
    tests, frontend source guard, frontend typecheck, frontend utility suite,
    frontend production build, and focused Audit Log desktop/mobile live control
    audit passed with 28/29 controls tested, 1 empty-label control skipped, and
    zero findings; Phase 29 and live hygiene checks are rerun after reference
    refresh.

692. Extract typed dashboard transport from the large domain registry.
    Done: `frontend/src/api/dashboardTransport.ts` now owns dashboard summary
    reads and analytics reads previously embedded in
    `frontend/src/api/methods.ts`. The helper keeps analytics query
    construction, append-query behavior, and range-aware route cache keys in a
    typed boundary, while `methods.ts` keeps public `window.api` wrapper names
    for compatibility. The API guide documents the new dashboard split, and
    focused API HTTP tests verify dashboard summary transport, analytics query
    construction, route cache-key ownership, append-query usage, source
    placement, and no direct dashboard/analytics fetch calls in the large
    registry. The source guard parsed 226 frontend files and the production
    build now reports the `app-api-methods` chunk around 26.86 kB with no
    circular chunk warning. Proof: focused API HTTP tests, frontend source
    guard, frontend typecheck, frontend utility suite, frontend production
    build, and focused Dashboard desktop/mobile live control audit passed with
    36/46 controls tested, 10 long-label controls skipped, and zero findings;
    Phase 29 and live hygiene checks are rerun after reference refresh.

693. Extract typed sales transport from the large domain registry.
    Done: `frontend/src/api/salesTransport.ts` now owns sale creation,
    queued-offline retry POST transport with write-dedupe bypass, and sales
    list reads previously embedded in `frontend/src/api/methods.ts`. The
    helper keeps sale route keys, mirrored sales fallback, paged query
    construction, and typed Dexie table access in a focused boundary, while
    `methods.ts` keeps public `window.api` wrapper names and offline queue
    orchestration for compatibility. The API guide documents the new sales
    split, and focused API HTTP, offline-sales, and action-stability tests
    verify idempotent POS sale creation, queued retry replay, sales query
    construction, mirrored local fallback, source placement, and no direct
    sales create/list fetch calls in the large registry. The source guard
    parsed 227 frontend files and the production build now reports the
    `app-api-methods` chunk around 26.59 kB with no circular chunk warning.
    Proof: focused API HTTP tests, offline sales queue tests, action stability
    tests, frontend source guard, frontend typecheck, frontend utility suite,
    frontend production build, and focused Sales plus POS desktop/mobile live
    control audits passed with zero findings; Phase 29 and live hygiene checks
    are rerun after reference refresh.

694. Defer pending-sync startup refresh out of the first shell render.
    Done: `frontend/src/App.tsx` now schedules the initial pending-sync banner
    read with a cancellable idle-time helper instead of calling
    `getPendingSyncState()` synchronously during app startup. This avoids
    pulling the lazy API methods chunk and IndexedDB pending-write scan into
    the first render path, while keeping immediate refreshes for sync errors,
    write-blocked signals, reconnect/status changes, queue changes, offline
    sale queued/synced events, and write conflicts. The performance loading UX
    guard verifies the scheduler and blocks a regression back to synchronous
    startup queue reads. Proof: focused performance loading UX test, frontend
    source guard, frontend typecheck, frontend utility suite, frontend
    production build with hash `ec095d6fa2045c5a`, and focused Dashboard
    desktop/mobile live control audit passed with 36/46 controls tested, 10
    long-label controls skipped, and zero findings; Phase 29 and live hygiene
    checks are rerun after reference refresh.

695. Defer global background chunks until they are needed.
    Done: `frontend/src/App.tsx` now gates `WriteConflictModal` behind an
    actual `writeConflict` value and gates `BackgroundImportTracker` behind
    `useDeferredImportTrackerMount()`. The import tracker wakes after idle time
    or immediately on import-job sync updates, so active imports still surface,
    but normal startup no longer requests the write-conflict chunk, the import
    tracker chunk, or the import tracker `listImportJobs` poll during first
    render. The performance loading UX guard verifies both gates. Proof:
    focused performance loading UX test, frontend source guard, frontend
    typecheck, frontend utility suite, frontend production build with hash
    `b3f0c3283db09f7f`, and focused Dashboard desktop/mobile live control
    audit passed with 36/46 controls tested, 10 long-label controls skipped,
    and zero findings; Phase 29 and live hygiene checks are rerun after
    reference refresh.

696. Defer desktop notification-center startup work.
    Done: `frontend/src/App.tsx` now gates `NotificationCenter` behind
    `useDeferredNotificationCenterMount()` instead of mounting the lazy
    notification chunk during the first shell render. The fallback bell remains
    clickable for immediate user intent, and the real notification center wakes
    automatically after idle time or when relevant sync updates arrive. This
    avoids the normal-startup `notification-center` chunk request and the
    notification summary API read until notifications are needed or the shell
    is idle. Proof: focused performance loading UX test, frontend source
    guard, frontend typecheck, frontend utility suite, frontend production
    build with hash `5ad9eba769d0526d`, and focused Dashboard desktop/mobile
    live control audit passed with 36/46 controls tested, 10 long-label
    controls skipped, and zero findings; Phase 29 and live hygiene checks are
    rerun after reference refresh.

697. Defer custom favicon canvas processing until after shell paint.
    Done: `frontend/src/App.tsx` now sets the configured favicon source
    immediately, then waits for a short delay plus idle time before calling
    `createCircularFaviconDataUrl()`. This keeps image decode, canvas draw,
    and PNG data-URL serialization out of the first render path while
    preserving the rounded favicon polish once the browser is idle. Proof:
    focused performance loading UX test, frontend source guard, frontend
    typecheck, frontend utility suite, frontend production build with hash
    `2e6cd6a7af03e203`, and focused Dashboard desktop/mobile live control
    audit passed with 36/46 controls tested, 10 long-label controls skipped,
    and zero findings; Phase 29 and live hygiene checks are rerun after
    reference refresh.

698. Defer startup retry-marker storage cleanup until after shell paint.
    Done: `frontend/src/App.tsx` now keeps chunk-recovery URL cleanup
    immediate, but moves stale `business_os_page_loader_retry:` and
    `bos-lazy-reload:` marker enumeration/removal behind a short delay plus
    browser idle time. This keeps a synchronous `sessionStorage` key scan out
    of successful startup while preserving retry-marker hygiene through a
    timeout fallback. Proof: focused performance loading UX test, frontend
    source guard, frontend typecheck, frontend utility suite, frontend
    production build with hash `f75e2c8d3320d0ec`, and focused Dashboard
    desktop/mobile live control audit passed with 36/46 controls tested, 10
    long-label controls skipped, and zero findings; Phase 29 and live hygiene
    checks are rerun after reference refresh.

699. Defer post-render startup maintenance until after load and idle time.
    Done: `frontend/src/index.tsx` now renders the React root before scheduling
    non-critical startup maintenance. Service-worker registration still
    preserves offline app-shell support, but it now waits until page load plus
    browser idle time with a timeout fallback. Form-field accessibility wiring
    uses the same shared after-load idle scheduler, so generated field ids,
    names, and labels still recover without running before root render. Proof:
    focused performance loading UX test, app shell utility test, frontend
    source guard, frontend typecheck, frontend utility suite, frontend
    production build with hash `f41fed1ff54d30f9`, and focused Dashboard
    desktop/mobile live control audit passed with 36/46 controls tested, 10
    long-label controls skipped, and zero findings; Phase 29 and live hygiene
    checks are rerun after reference refresh.

700. Defer initial web API offline maintenance until after load and idle time.
    Done: `frontend/src/web-api.ts` still installs `window.api`
    synchronously and keeps sync URL setup, websocket connect, and health
    checks immediate, but the first offline maintenance pass now runs through
    `scheduleInitialOfflineMaintenance()`. That pass waits for page load, a
    short delay, and browser idle time before retrying pending sync, refreshing
    the offline snapshot, registering background sync, or updating the service
    worker. Online, focus, visibility, and reconnect maintenance paths remain
    immediate after startup. Proof: focused performance loading UX test,
    offline sync/security tests, frontend source guard, frontend typecheck,
    frontend utility suite, frontend production build with hash
    `7166cf124209d1aa`, and focused Dashboard desktop/mobile live control
    audit passed with 36/46 controls tested, 10 long-label controls skipped,
    and zero findings; Phase 29 and live hygiene checks are rerun after
    reference refresh.

701. Defer automatic sync URL persistence until after render and idle time.
    Done: `frontend/src/AppContext.tsx` still returns the backend origin as
    the active `syncUrl` immediately for backend-served pages and still reads
    the saved sync server URL in Vite dev, but it no longer writes
    `STORAGE_KEYS.SYNC_SERVER` during `useState` initialization. Automatic
    backend-origin persistence now runs from a delayed idle effect with a
    timeout fallback, while explicit user sync URL edits keep saving
    immediately. This removes a synchronous `localStorage` write from the
    first render setup without weakening connection behavior. Proof: focused
    performance loading UX test, frontend source guard, frontend typecheck,
    frontend utility suite, frontend production build with hash
    `5bb3317e6301aad9`, and focused Dashboard desktop/mobile live control
    audit passed with 36/46 controls tested, 10 long-label controls skipped,
    and zero findings; Phase 29 and live hygiene checks are rerun after
    reference refresh.

702. Defer web API bootstrap storage maintenance and same-URL duplicate work.
    Done: `frontend/src/web-api.ts` still installs `window.api`
    synchronously and keeps the active sync server URL, websocket connection,
    health checks, and scheduled offline maintenance immediate. Retired auth
    token cleanup plus backend-origin `localStorage` and Dexie sync URL
    persistence now run through `scheduleBootstrapStorageMaintenance()` after
    page load, a short delay, and browser idle time. The public
    `setSyncServerUrl()` bridge now compares the previous URL with the next
    clean URL before clearing caches, writing Dexie settings, or forcing
    offline maintenance, so AppContext does not duplicate bootstrap work when
    both install the same URL. Proof: focused performance loading UX test,
    frontend source guard, frontend typecheck, frontend utility suite,
    frontend production build with hash `95565c2fbe120c41`, and focused
    Dashboard desktop/mobile live control audit passed with 36/46 controls
    tested, 10 long-label controls skipped, and zero findings; Phase 29 and
    live hygiene checks are rerun after reference refresh.

703. Defer route chunk warmups until after the current page load completes.
    Done: `frontend/src/App.tsx` now funnels primary background route warmup
    and page-entry warmup through `scheduleWarmupAfterLoad()`. Speculative
    dynamic imports for Products, POS, Inventory, and later admin pages no
    longer start while the current page is still loading, but intent warmup
    remains available when the user actually points at or touches navigation.
    Empty data warmup plans now return before allocating timeout or
    idle-callback timers. Proof: focused performance loading UX test,
    frontend source guard, frontend typecheck, frontend utility suite,
    frontend production build with hash `830635f186b1e640`, and focused
    Dashboard desktop/mobile live control audit passed with 36/46 controls
    tested, 10 long-label controls skipped, and zero findings; Phase 29 and
    live hygiene checks are rerun after reference refresh.

704. Lazy-load local DB and Dexie out of the startup browser path.
    Done: `frontend/src/web-api.ts` now installs `window.api`, the sync URL,
    websocket, health checks, and scheduled maintenance without statically
    importing `frontend/src/api/localDb.ts`. Offline vault, business outbox,
    file chunk, and persisted settings paths load the local DB through
    `getOfflineDb()` only when those paths run. `frontend/vite.config.ts`
    keeps only startup API files in `app-api`, separates the IndexedDB schema
    into `app-local-db`, keeps method transports behind `app-api-methods`, and
    excludes `app-local-db` plus `vendor-dexie` from eager modulepreload.
    Proof: built `index.html` no longer preloads `vendor-dexie` or
    `app-local-db`, the startup `app-api` chunk no longer references Dexie,
    focused performance loading UX test, frontend source guard, frontend
    typecheck, frontend utility suite, frontend production build with hash
    `4ee9559e01210d68`, and focused Dashboard desktop/mobile live control
    audit passed with 36/46 controls tested, 10 long-label controls skipped,
    and zero findings; Phase 29 and live hygiene checks are rerun after
    reference refresh.

705. Defer catalog and public portal preloads from startup.
    Done: `frontend/vite.config.ts` now excludes `catalog`, `catalog-preview`,
    `catalog-editor`, and `portal-tools` chunk prefixes from eager
    modulepreload while keeping `CatalogPage` route-lazy in
    `frontend/src/App.tsx`. The catalog and public portal code still loads
    when staff navigate there or when the public route is opened, but it no
    longer competes with the first authenticated shell/dashboard paint. The
    focused loading UX guard verifies the preload exclusion and lazy route
    import. Proof: production `frontend/dist/index.html` and the live
    Docker-served `http://127.0.0.1:4000/` HTML no longer preload
    `catalog-*`, `catalog-preview-*`, `catalog-editor-*`, `portal-tools-*`,
    `app-local-db-*`, or `vendor-dexie-*`; source guard, typecheck, frontend
    utility suite, production build, exhaustive Playwright all-pages control
    audit, broad Phase 8.4 UI live check, public Cloudflare portal check, and
    post-live hygiene passed. Production build hash: `035370df0dd56898`;
    all-pages audit covered 34 desktop/mobile routes, 518 visible controls,
    391 exercised controls, 68 screenshots, zero failed controls, and zero
    findings.

706. Shrink authenticated shell startup imports with lazy profile,
    notification, favicon, and portal-menu boundaries.
    Done: `frontend/src/components/navigation/Sidebar.tsx` no longer imports
    `NotificationCenter` or `UserProfileModal` during shell startup. The app
    passes mobile notification UI through the deferred app-level notification
    gate, and the profile modal loads only after the profile button opens,
    which keeps the avatar/file-picker stack out of the first shell parse.
    `frontend/src/App.tsx` now imports `createCircularFaviconDataUrl()` only
    inside the delayed idle favicon processing task. `frontend/vite.config.ts`
    excludes `media-upload-utils` from eager preload and leaves shared
    `PortalMenu` in the shared UI chunk instead of forcing a separate
    `portal-tools` startup request. Proof: performance loading UX guard,
    source syntax check, typecheck, frontend utility suite, JSX/source check,
    production build hash `960afc698c5a3a4d`, Docker live build sync, live
    entry verification showing `assets/index-B0XA2Z2L.js` at 80,504 bytes with
    no startup preload or static import for `notification-center`,
    `catalog-*`, `catalog-preview-*`, `catalog-editor-*`, `portal-tools`,
    `media-upload-utils`, `file-picker-modal`, or `UserProfileModal`;
    exhaustive Playwright all-pages control audit passed across 34
    desktop/mobile routes with 518 visible controls, 392 exercised controls,
    68 screenshots, zero failed controls, and zero findings; broad Phase 8.4
    UI live check passed with 72 checked signals and no relevant console
    messages; public Cloudflare portal check passed with 20 rendered products,
    zero failed responses, zero page errors, and enforced CSP; post-live
    hygiene passed. Remaining deeper target: remove the synchronous
    Dexie/local DB side-effect from `web-api` bootstrap without regressing the
    guaranteed `window.api` install.

707. Remove Dexie/local DB from the startup static import graph.
    Done: `frontend/src/platform/runtime/clientRuntime.ts` now keeps pure
    runtime descriptor helpers free of the local DB module and dynamically
    imports `resetLocalMirrorDb()` only inside `resetClientRuntimeState()`,
    the rare runtime reset path. This preserves runtime reset behavior while
    removing `app-local-db` and `vendor-dexie` from normal boot. Proof:
    performance loading UX guard, source syntax check, typecheck, frontend
    utility suite, JSX/source check, production build hash
    `1d2c42ce528647f9`, Docker live build sync, live entry verification
    showing `assets/index-sOwFDnkY.js` at 80,434 bytes with no startup preload
    or static import for `notification-center`, `catalog-*`,
    `catalog-preview-*`, `catalog-editor-*`, `portal-tools`,
    `media-upload-utils`, `file-picker-modal`, `UserProfileModal`,
    `app-local-db`, or `vendor-dexie`; exhaustive Playwright all-pages control
    audit passed across 34 desktop/mobile routes with 518 visible controls,
    392 exercised controls, 68 screenshots, zero failed controls, and zero
    findings; broad Phase 8.4 UI live check passed with 72 checked signals and
    no relevant console messages; public Cloudflare portal check passed with
    20 rendered products, zero failed responses, zero page errors, and
    enforced CSP; post-live hygiene passed.

708. Split login/auth bootstrap out of the heavy API registry.
    Done: `frontend/src/web-api.ts` now exposes login, logout, OTP, Google
    OAuth, verification-capability, and organization bootstrap/search calls
    through a narrow lazy `authTransport` boundary instead of falling through
    to the full `app-api-methods` registry. `frontend/vite.config.ts` emits
    that boundary as `app-auth` and excludes it from eager modulepreload.
    `frontend/src/AppContext.tsx` now waits for server bootstrap validation
    before treating a stored user as authenticated for startup warmups, and
    `frontend/src/api/appBootstrapTransport.ts` returns an empty sign-in
    bootstrap for invalid sessions instead of reading IndexedDB. Proof:
    focused performance loading UX guard, updated API registry guard,
    TypeScript check, source guard, frontend utility suite, backend utility
    suite, production build hash `1a5804d05a4e008e`, Docker live build sync,
    built graph check showing no bad startup preloads/static entry imports,
    and a real Playwright first-12-seconds network trace showing only
    `app-bootstrap-EfLFgo7i.js` and `app-auth-DD-QfBFn.js` among auth startup
    lazy chunks, with zero `app-api-methods`, `app-local-db`, `vendor-dexie`,
    `vendor-zxing`, catalog, file-picker, or profile-modal requests. Broad
    Phase 8.4 live suite passed with 72 checked signals and no relevant
    console messages; public Cloudflare portal check passed with 20 rendered
    products, zero failed responses, and enforced CSP; post-live hygiene
    passed; exhaustive all-pages control audit passed across 34 desktop/mobile
    routes with 518 visible controls, 392 exercised controls, 68 screenshots,
    zero failed controls, and zero findings; Phase 29 and organization audits
    passed after generated references were refreshed.

709. Shrink authenticated Dashboard startup network and chunk load.
    Done: `frontend/src/App.tsx` now keeps unrelated route chunks cold until
    hover/touch/click intent and pushes pending-sync, notification-center, and
    background import-tracker work past the first Dashboard interaction window.
    `frontend/src/components/shared/NotificationCenter.tsx` accepts an
    `openRequestId` so the first notification-bell click still opens the panel
    after the lazy mount. `frontend/src/api/appBootstrapTransport.ts` no
    longer imports local DB or local mirror modules for bootstrap fallback, and
    `frontend/src/web-api.ts` schedules offline maintenance instead of loading
    IndexedDB during startup. `frontend/src/components/dashboard/Dashboard.tsx`
    now reads through the narrow dashboard transport and lazy-loads
    CSV/report/ZIP export helpers only when an export action is used.
    `frontend/vite.config.ts` keeps `dashboardTransport.ts` and `query.ts` in
    `app-api`, so Dashboard reads avoid the full method registry. Proof:
    performance loading UX guard, API HTTP guard, source check, typecheck,
    frontend utility suite, backend utility suite, production build hash
    `9b132859aa24909c`, Docker live build sync, authenticated Playwright
    first-12-seconds trace, broad Phase 8.4 live suite, public Cloudflare
    portal check, exhaustive all-pages control audit, and exhaustive
    browser-action smoke. The live trace reduced Dashboard startup from the
    earlier 34 JavaScript chunks and 5 app data/auth API calls to 12
    JavaScript chunks and 3 app data/auth API calls, plus 3 expected health
    probes, with zero unrelated product/POS/inventory/catalog/file-picker/
    local-DB/import-tracker/notification-center requests, zero failed
    responses, and zero relevant console messages. The all-pages audit covered
    34 desktop/mobile routes with 519 visible controls, 392 exercised controls,
    68 screenshots, zero failed controls, and zero findings; browser-action
    smoke covered 34 routes and 28 actions with zero findings.

710. Deduplicate startup health probes.
    Done: `frontend/src/api/http.ts` now owns a shared `pingServerHealth()`
    result with in-flight reuse, a short fresh-result reuse window, centralized
    Cloudflare Access/runtime-version handling, and a 30-second active health
    cadence after the first shared probe. `frontend/src/AppContext.tsx` now
    reads that shared health result instead of making its own raw
    `fetch('/health')` after sync URL discovery. Proof: API HTTP tests cover
    in-flight and fresh health-probe reuse; performance loading guards verify
    the shared probe constants and forbid the AppContext raw health fetch;
    source check, typecheck, production build hash `f29e8401e596bf6c`, Docker
    live build sync, and authenticated Playwright first-12-seconds trace
    passed. Broad Phase 8.4 live suite also passed on the same hash with 72
    checked signals, zero relevant console messages, no framework overlay, a
    public portal check with 20 rendered products and zero failed responses,
    and post-live hygiene green. The live startup trace kept startup at 12
    JavaScript chunks with zero unrelated route/local-DB chunks, dropped
    `/health` from 3 probes to 1, kept `/api/auth/bootstrap`,
    `/api/analytics`, and `/api/dashboard` at HTTP 200, and had zero failed
    responses or relevant console messages.

711. Combine Dashboard startup summary and analytics reads.
    Done: `backend/src/routes/sales.ts` now exposes
    `/api/dashboard/startup` by reusing the existing cached summary and
    analytics builders, so the old `/api/dashboard` and `/api/analytics`
    endpoints remain available for refresh and range changes. The Dashboard
    first-load path uses `getDashboardStartup()` once, validates both payloads,
    and keeps range changes on the analytics-only path. Proof: backend route
    contracts, API HTTP guard, performance loading guard, frontend typecheck,
    backend utility suite, frontend utility suite, production build hash
    `435e572a3d2acfaf`, generated release route sync, authenticated Playwright
    startup trace, broad Phase 8.4 UI live check, public Cloudflare portal
    check, and post-live hygiene. The live trace showed three initial
    API/health responses total (`/health`, `/api/auth/bootstrap`, and
    `/api/dashboard/startup`), zero initial legacy dashboard/analytics split
    calls, and a `7 Days` interaction that made exactly one analytics call and
    no summary refetch.

712. Prime startup health from authenticated bootstrap.
    Done: `backend/src/routes/auth.ts` now carries served frontend runtime
    metadata in the authenticated bootstrap system payload.
    `frontend/src/api/http.ts` adds `primeServerHealthFromRuntime()` and
    delays the first scheduled health probe so bootstrap can seed the shared
    health result before a network `/health` call. `frontend/src/AppContext.tsx`
    uses the bootstrap runtime proof and keeps the shared health probe as a
    fallback for offline, missing, or failed bootstrap data. Proof: API HTTP
    guard, performance loading guard, frontend typecheck, backend utility
    suite, frontend utility suite, source guard, production build hash
    `09107596d6229a5a`, generated release route sync, authenticated Playwright
    startup trace, broad Phase 8.4 UI live check, public Cloudflare portal
    check, and post-live hygiene. The live trace showed two initial app
    responses (`/api/auth/bootstrap` and `/api/dashboard/startup`), zero
    startup `/health`, zero initial legacy dashboard/analytics split calls,
    and a `7 Days` interaction that made exactly one analytics call and no
    summary refetch.

713. Defer inactive Dashboard bar-chart code.
    Done: Dashboard now imports the visible line and donut chart components
    directly and lazy-loads the inactive volume/transactions `BarChart` branch
    behind `React.lazy`/`Suspense`. The performance loading guard rejects the
    old eager chart-barrel import and requires the lazy bar-chart path. Proof:
    performance loading guard, frontend typecheck, source guard, frontend
    utility suite, production build hash `9ee8a8bbcfeb8deb`, Docker live sync,
    authenticated Playwright startup chunk trace, broad Phase 8.4 UI live
    check, public Cloudflare portal check, and post-live hygiene. Production
    output split `BarChart` into a 3.33 kB lazy chunk and reduced the
    first-paint chart chunk from the earlier 10.58 kB bundle to a 7.56 kB
    `DonutChart` chunk. The live trace confirmed `BarChart` was not requested
    or modulepreloaded during default Dashboard startup, while the visible
    donut chart still loaded and the console stayed clean.

714. Split later-route shared controls from Dashboard startup.
    Done: `frontend/vite.config.ts` now chunks `PaginationControls`,
    `ActionHistoryBar`, `FilterMenu`, `SectionSwitcher`, `PageHeader`, and
    `Modal` before the generic `app-shared` fallback, leaving only true
    startup shared helpers in the first-paint shared chunk. The performance
    loading guard locks this ordering. Proof: performance loading guard,
    frontend typecheck, source guard, frontend utility suite, production build
    hash `453778909dc40f11`, Docker live sync, authenticated Playwright
    startup resource trace, broad Phase 8.4 UI live check, public Cloudflare
    portal check, and post-live hygiene. Production output reduced
    `app-shared` from the previous 92.97 kB chunk to 73.03 kB. The focused
    live trace confirmed the split shared chunks and inactive `BarChart` were
    neither requested nor modulepreloaded on Dashboard startup, while initial
    app API traffic stayed at `/api/auth/bootstrap` and
    `/api/dashboard/startup` and the `7 Days` button still made exactly one
    analytics request.

715. Intent-load Dashboard export portal menu.
    Done: `ExportMenu` now keeps the visible export button in the startup
    render but loads `PortalMenu` on pointer/focus/click intent, with
    `PortalMenu.defaultOpen` preserving direct first-click menu opening.
    `vite.config.ts` emits the portal menu as the focused deferred
    `shared-portal-menu` chunk, and the performance loading guard verifies the
    dynamic import, chunk rule, deferred preload, and first-click open handoff.
    Proof: performance loading guard, frontend typecheck, source guard,
    frontend utility suite, production build hash `23fd366cede8b3c4`, Docker
    live sync, authenticated Playwright startup plus Export-click resource
    trace, broad Phase 8.4 UI live check, public Cloudflare portal check, and
    post-live hygiene. Production output reduced `app-shared` from 73.03 kB to
    69.31 kB and emitted `shared-portal-menu` as a 4.10 kB on-demand chunk.
    The focused live trace confirmed the portal chunk was not requested or
    modulepreloaded on Dashboard startup, then a direct `Export` click fetched
    it at HTTP 200 and opened the menu.

716. Focus startup Lucide icons into a shell-owned chunk.
    Done: frontend source now imports Lucide icons through direct
    `lucide-react/dist/esm/icons/*` module paths with a local declaration file,
    and `vite.config.ts` explicitly keeps only shell/Login/sidebar icons in
    `app-shell-icons`. This is a language/runtime organization move rather
    than a folder move: it preserves React/TypeScript, removes the broad
    Lucide vendor bucket, and prevents shell icons from making route chunks
    startup dependencies. Proof: performance loading guard, frontend
    typecheck, source guard, frontend utility suite, production build hash
    `ab7ff057cc20cdd9`, Docker live sync, authenticated Playwright startup
    plus Export-click trace, broad Phase 8.4 UI live check, public Cloudflare
    portal check, and post-live hygiene passed. The focused live trace
    measured 13 startup JavaScript files, 620,625 decoded bytes, no forbidden
    route chunks, no `vendor-lucide`, and preserved on-demand
    `shared-portal-menu` loading after clicking `Export`.

717. Defer signed-out Login UI and auth-only icons.
    Done: `frontend/src/App.tsx` now lazy-loads `Login` only in the
    unauthenticated branch, and `frontend/vite.config.ts` keeps the signed-out
    screen in a deferred `auth-login` chunk. Auth-only Lucide icons are listed
    in `authLoginIconNames`, so they do not enlarge the authenticated
    `app-shell-icons` chunk and do not fall into catalog. This preserves the
    TypeScript/React runtime while tightening ownership of signed-out-only
    code. Proof: performance loading guard, frontend typecheck, source guard,
    frontend utility suite, production build hash `80aceec796128140`, Docker
    live sync, authenticated Dashboard plus signed-out Login Playwright
    resource trace, broad Phase 8.4 UI live check, public Cloudflare portal
    check, and post-live hygiene passed. The focused live trace measured
    587,317 decoded startup bytes, no forbidden authenticated startup chunks
    or modulepreloads, `auth-login-SHSYT-QZ.js` loaded only on signed-out
    `/login`, and the signed-out screen no longer loaded catalog/file-picker/
    media/ZXing extras.

718. Gate signed-out sync/runtime listeners.
    Done: `frontend/src/AppContext.tsx` now skips operational sync listeners
    and websocket polling unless an active user or stored user payload exists,
    `frontend/src/App.tsx` skips the sync-banner listener set plus pending-sync
    poll while signed out, and `frontend/src/api/websocket.ts` keeps
    auth/network/focus lifecycle listeners behind stored-session evidence.
    This preserves the existing TypeScript/React/WebSocket runtime instead of
    adding another language, because the measurable gain is from removing
    unnecessary signed-out work. Proof: focused app-shell and performance
    guards, frontend typecheck, frontend utility suite, production build hash
    `6eb9420d6daf9353`, Docker live sync, instrumented Playwright
    login/dashboard probe, broad Phase 8.4 UI live check, public Cloudflare
    portal check, and post-live hygiene passed. The signed-out `/login` probe
    registered only `sync:update`, started no 500/3000/20000 ms sync
    intervals, started no 100 ms websocket quick check, and had no relevant
    console noise after filtering the expected unauthenticated bootstrap 401.
    The authenticated Dashboard still registered sync/auth listeners and live
    websocket polling.

719. Lazy-install HTTP sync cache invalidation after session recovery.
    Done: `frontend/src/api/http.ts` now keeps cache invalidation as an
    exported one-shot installer, `ensureSyncUpdateCacheListener()`, instead of
    registering `sync:update` at module load. `frontend/src/AppContext.tsx`
    calls that installer only after the recoverable-session gate passes. This
    is a small TypeScript runtime-flow cleanup: it removes the final
    signed-out sync listener without changing the cache invalidation strategy
    for authenticated sessions. Proof: focused app-shell and performance
    guards, frontend typecheck, frontend utility suite, production build hash
    `81223d01f14bfad9`, Docker live sync, instrumented Login/Dashboard
    Playwright probe, broad Phase 8.4 UI live check, public Cloudflare portal
    check, and post-live hygiene passed. The signed-out `/login` probe
    observed `listeners: []`, `intervals: []`, and `timeouts: []`, while the
    authenticated Dashboard still registered `sync:update` and live sync
    polling.

720. Defer pending-sync polling after startup.
    Done: `frontend/src/App.tsx` now uses
    `scheduleDeferredPendingSyncPolling()` so the 20 second pending-sync
    interval is not allocated during authenticated first paint. Event-driven
    refreshes still fire immediately for sync errors, reconnects, queue
    changes, offline sale events, and conflicts. This keeps the existing
    TypeScript/React strategy and removes a first-paint timer instead of
    adding another runtime. Proof: performance loading guard, frontend
    typecheck, frontend utility suite, production build hash
    `e473ce0cdd641ad7`, Docker live sync, instrumented Login/Dashboard
    Playwright probe, broad Phase 8.4 UI live check, public Cloudflare portal
    check, and post-live hygiene passed. The authenticated Dashboard probe
    saw websocket intervals `500` and `3000` only, no startup `20000`
    pending-sync interval, and deferred `30000` timers scheduled for later
    maintenance.

721. Gate session recovery listeners after session recovery.
    Done: `web-api.ts` now keeps online/focus/visibility/reconnected offline
    maintenance behind `ensureSessionRecoveryListeners()`, `api/http.ts`
    installs active health lifecycle listeners only from `startHealthCheck()`,
    `api/websocket.ts` installs auth/network lifecycle listeners only from
    `connectWS()` when a stored session exists, and `App.tsx` keeps kiosk
    focus recovery out of signed-out startup. This is a TypeScript runtime
    flow cleanup rather than a language conversion: the faster path comes
    from removing public-route side effects and preserving authenticated
    behavior through explicit installers. Proof: app-shell and performance
    loading guards, frontend typecheck, frontend utility suite, production
    build hash `cb858c5ce1c60aa4`, Docker live sync, instrumented
    Login/Dashboard Playwright probe, broad Phase 8.4 UI live check, public
    Cloudflare portal check, and post-live hygiene passed. The signed-out
    `/login` probe observed no recovery listeners, no visibility listener, no
    WebSocket, and no intervals; authenticated Dashboard still opened one
    WebSocket and kept recovery/health polling active.

722. Consolidate authenticated lifecycle recovery listeners.
    Done: `web-api.ts` is now the browser lifecycle recovery owner for
    online/focus/visible events, calling `resumeWS()`, `startHealthCheck()`,
    `pingServerHealth()`, and offline maintenance from one listener set.
    `api/http.ts` keeps only the offline health-state listener, and
    `api/websocket.ts` keeps auth suppression plus the `resumeWS()` helper
    instead of registering its own online/focus/visibility listeners. This
    stays in TypeScript because the measurable win is cleaner ownership and
    fewer browser side effects, not a language rewrite. Proof: app-shell and
    performance loading guards, frontend typecheck, frontend utility suite,
    production build hash `254ace63c1c99efe`, Docker live sync, instrumented
    lifecycle Playwright probe, broad Phase 8.4 UI live check, public
    Cloudflare portal check, and post-live hygiene passed. The Dashboard probe
    showed one online listener, two focus listeners, three visibility
    listeners, one WebSocket, and the expected health/ping/websocket
    intervals while signed-out Login stayed at zero recovery listeners.

723. Gate the background import tracker to import activity.
    Done: `App.tsx` now defers the tracker for 180 seconds or wakes it only
    from explicit `import-job:activity`; `importJobsTransport.ts` emits that
    event for real import job create/start/upload/cancel/retry/delete paths;
    `BackgroundImportTracker.tsx` no longer imports the shared Settings
    `Trash2` icon, so Vite does not make Settings own or fetch the tracker
    chunk as an icon carrier. This is a small TypeScript/React chunk-graph
    rewire rather than a language conversion: the measurable win is removing
    an unnecessary background chunk and `/api/import-jobs` poll from normal
    route navigation while keeping import progress immediate when import work
    begins. Proof: performance loading guard, import transport API test,
    frontend typecheck, frontend utility suite, JSX/source check, production
    build hash `cb6332a2ac6f7165`, Docker live sync, focused
    import-tracker Playwright probe, broad Phase 8.4 UI live check, public
    Cloudflare portal check, post-live hygiene, and storage prune passed. The
    broad live check saw zero tracker/import-jobs requests during normal
    navigation; the focused probe confirmed explicit import activity still
    loads the tracker and `/api/import-jobs?limit=8` at HTTP 200.

724. Trim public portal editor-only chunks from first load.
    Done: `CatalogPreviewSurface` now conditionally mounts the file picker
    only for admin/editor mode and mounts image lightboxes only when a gallery
    is open. `CatalogPage` keeps the upload reducer/cache-busted media helpers
    local so public catalog startup no longer statically imports the editor
    upload helper. `vite.config.ts` now splits `public-asset-urls`,
    `favicon-utils`, and editor-only `CatalogImageField` into explicit
    chunks, with `performanceLoadingUx.test.ts` guarding those boundaries.
    This is a TypeScript/React/Vite chunk-graph rewire rather than a language
    conversion: the measurable gain is fewer public first-load modules while
    preserving admin upload behavior. Proof: performance guard, frontend
    typecheck, source guard, frontend utility suite, production build hash
    `e37146866b299666`, Docker live sync, public Cloudflare Playwright check,
    broad Phase 8.4 UI live check, and `git diff --check` passed. The public
    report showed 20 rendered products, zero failed responses, zero relevant
    console messages, zero page errors, enforced CSP, and no first-load
    `file-picker-modal`, `media-upload-utils`, or `image-lightbox` requests.
    A stale Cloudflare tunnel briefly returned HTTP 502 after app restart;
    restarting only `business-os-cloudflared-1` restored public HTTP 200.

725. Split public portal API bootstrap from the legacy API/Dexie registry.
    Done: `web-api.ts` now has a focused lazy `PortalTransportModule`
    boundary and wires public portal config, bootstrap, catalog, search,
    membership, submission, and AI methods directly to `portalTransport.ts`
    instead of falling through the generic `api/methods.ts` registry.
    `vite.config.ts` places `portalTransport.ts` and `portalHttp.ts` in a
    small `app-portal` chunk and keeps shared catalog icons out of
    `auth-login`. This is the correct TypeScript/Vite rewire, not a
    Rust/Go/Python/WASM conversion: the hot path was a browser chunk graph
    and API-boundary problem. Proof: performance guard, frontend typecheck,
    source guard, frontend utility suite, production build hash
    `cbfed31b11f3c265`, Docker live sync, local `/public`, emitted chunk
    scans, public Cloudflare Playwright, and broad Phase 8.4 UI Playwright
    passed. The public report showed 20 rendered products, zero failed
    responses, zero relevant console
    messages, zero page errors, enforced CSP, and no first-load `auth-login`,
    `app-api-methods`, `vendor-dexie`, `app-auth`, or `app-local-db`
    requests. The broad report
    `ops/runtime/reports/phase84-ui-live-check-2026-06-02T19-20-44-127Z/report.json`
    kept admin helper loaders at HTTP 200 with zero relevant console
    messages. A stale Cloudflare tunnel returned HTTP 530 after app restart;
    restarting only `business-os-cloudflared-1` restored HTTP 200, with logs
    pointing to edge/Docker DNS connectivity rather than app code.

726. Lazy-load public portal transport from the legacy API registry.
    Done: `frontend/src/api/methods.ts` now keeps legacy/admin portal fallback
    methods behind a memoized dynamic `loadPortalTransport()` boundary instead
    of statically importing `portalTransport.ts`. `frontend/tests/apiHttp.test.ts`
    guards the split by rejecting a static portal transport import and
    verifying the dynamic import. This is an organization and Vite chunk-graph
    move: the public portal already has the focused `app-portal` owner, and
    the remaining registry should not own portal endpoint implementation by
    default. Proof: API HTTP source test, performance loading guard, frontend
    typecheck, source guard, production build hash `73fbae6ef77ff4b8`, emitted
    chunk scans, Docker live sync, public Cloudflare Playwright, and broad
    Phase 8.4 UI Playwright passed. The built `app-api-methods-DGc6nbrI.js`
    chunk is 60,808 bytes and contains no portal endpoint strings; the
    `app-portal-DTjuMQBz.js` chunk owns those endpoints at 2,747 bytes.

727. Collapse POS startup branch/product reads.
    Done: `backend/src/routes/products.ts` now shares one product search
    payload builder between `/api/products/search` and a new authenticated
    `/api/products/bootstrap` route, which adds the branch list POS needs for
    first paint. `frontend/src/api/productReadTransport.ts` and
    `frontend/src/api/methods.ts` expose `getProductBootstrap`, and
    `frontend/src/components/pos/POS.tsx` uses it only for the first metadata
    load before falling back to the existing search plus branch reads when the
    bootstrap method is unavailable. The broad Phase 8.4 live check now asserts
    `posProductBootstrapStatus`, keeping the old route behavior covered through
    Products and later POS refresh paths. Proof: frontend utility tests,
    frontend JSX/source check, backend utility tests, production build hash
    `b85f244d833cbb62`, Docker release/update image
    `business-os:v6.0.0-202606032013`, route-load trace
    `ops/runtime/reports/route-load-trace-2026-06-03T12-16-06-540Z.json`,
    broad Phase 8.4 UI Playwright, public Cloudflare Playwright, and
    `git diff --check` passed. The Docker-served trace reduced POS from 45
    total requests and 3 API requests to 44 total requests and 2 API requests,
    with first-window APIs `/api/auth/bootstrap` and
    `/api/products/bootstrap?...include=branch_stock,images,family`. Storage
    pruning removed 238,110,370 bytes of old reports, 100,882,733 bytes of old
    Docker-release backups, and 38.06 MB of Docker builder cache while keeping
    the newest backup set and leaving Docker images/volumes intact.

728. Collapse Inventory startup branch/product reads.
    Done: `backend/src/routes/inventory.ts` now shares one inventory product
    search payload builder between `/api/inventory/products/search` and a new
    authenticated `/api/inventory/bootstrap` route. The bootstrap adds the
    branch list needed by the product-section first paint, while normal product
    refreshes, stats, movements, RFID, reasons, and action-history paths keep
    their existing routes and deferred loaders. `frontend/src/api/
    inventoryTransport.ts` and `frontend/src/api/methods.ts` expose
    `getInventoryBootstrap`, and `frontend/src/components/inventory/
    Inventory.tsx` uses it only for the product-section startup window with a
    legacy fallback to separate branch/search reads for test doubles.
    Proof: frontend utility tests, frontend JSX/source check, backend utility
    tests, production build, Docker release/update, route-load trace
    `ops/runtime/reports/route-load-trace-2026-06-03T12-48-29-331Z.json`,
    broad Phase 8.4 UI Playwright, public Cloudflare Playwright, storage
    pruning, and `git diff --check` passed. The Docker-served trace reduced
    Inventory from 41 total requests and 3 API requests to 40 total requests
    and 2 API requests, with first-window APIs `/api/auth/bootstrap` and
    `/api/inventory/bootstrap`. The broad live check now asserts
    `inventoryBootstrapStatus: 200`. Storage pruning removed 295,764 bytes of
    old reports, 4,827,993 bytes of old Docker-release backup data, and
    76.13 MB of Docker builder cache while preserving uploads, secrets, env
    files, current business data, images, volumes, and newest backups.

729. Split cross-route notification icons from the notification-center chunk.
    Done: `frontend/vite.config.ts` now routes cross-route Lucide icons shared
    by NotificationCenter and feature pages into a focused `shared-icons`
    chunk, and `frontend/src/App.tsx` wakes NotificationCenter only from
    explicit notification-shaped events. This is a file/chunk-ownership move,
    not a language/runtime conversion: the measured bottleneck was Rollup
    ownership of common icons by the notification feature chunk.
    `frontend/tests/performanceLoadingUx.test.ts` guards both the wake
    predicate and the `shared-icons` manual chunk. Proof: frontend utility
    tests, production build, Docker release/update image
    `business-os:v6.0.0-202606032121`, route-load trace
    `ops/runtime/reports/route-load-trace-2026-06-03T13-23-37-802Z.json`,
    broad Phase 8.4 UI Playwright, public Cloudflare Playwright, storage
    pruning, and `git diff --check` passed. Every traced route reported
    `notification=none`; Backup and Server each dropped two first-window
    script requests, while icon-using routes now fetch the 2.99 KB / 0.74 KB
    gzip `shared-icons-1LAsiUVr.js` chunk instead of pulling the notification
    panel.

730. Split reusable catalog-adjacent code out of the Catalog route chunk.
    Done: `frontend/vite.config.ts` now assigns reusable product image
    primitives, product gallery helpers, action guards, small catalog
    UI/display/context helpers, and Catalog/admin-shared Lucide icons before
    the generic catalog route rule. The new ownership is `product-shared`,
    `action-guards`, `catalog-ui`, `catalog-display`, `catalog-context`, and
    the existing `shared-icons` chunk. This keeps the public Catalog route
    lazy while preventing Products, Inventory, POS, Sales, Returns, Contacts,
    Backup, and Server from fetching the heavy `catalog-*` route chunk just to
    reuse icons or small helpers.
    Proof: frontend utility tests, production build, no-write Vite chunk
    module audit, Docker release/update image
    `business-os:v6.0.0-202606032143`, route-load trace
    `ops/runtime/reports/route-load-trace-2026-06-03T13-53-46-619Z.json`,
    broad Phase 8.4 UI Playwright, public Cloudflare Playwright, storage
    pruning, and `git diff --check` passed. Every traced admin route reports
    `catalog=none`; the public catalog still loads the Catalog route by
    design. Backup and Server each dropped three first-window script requests.

731. Keep local DB and system runtime behind explicit lazy boundaries.
    Done: local mirror, expected-updated-at, query-cache, and transport fallback
    code now use `frontend/src/api/lazyLocalDb.ts` instead of static local DB
    imports. CSV template downloads moved to `frontend/src/utils/csvTemplate.ts`,
    and `csvImport.ts` is grouped into `csv-utils` so CSV parsing does not make
    `app-local-db` own import helpers. `frontend/src/web-api.ts` owns a narrow
    lazy `app-system` path for Server bootstrap/config/debug/test calls, while
    legacy system wrappers in `frontend/src/api/methods.ts` dynamically import
    `systemRuntime.ts` only when those system actions are used. Server pending
    sync queue reads are now gated behind the Queue diagnostics tab.
    Proof: frontend utility tests, production build, Docker release image
    `business-os:v6.0.0-202606032321`, focused route-load Playwright trace
    `ops/runtime/reports/route-load-trace-2026-06-03T15-23-15-920Z.json`, and
    a live Server Queue-tab interaction passed. No traced route loads
    `app-local-db` or `vendor-dexie` in the first 600 ms; only Server loads
    `app-system` initially, and queue diagnostics load local DB after the
    explicit Queue click.

780. Keep Sales/Returns CSV action utilities out of route startup. Done:
    `frontend/src/components/sales/Sales.tsx` and
    `frontend/src/components/returns/Returns.tsx` now dynamically import
    `frontend/src/utils/csv.ts` only from export actions. `contactsTransport.ts`
    and the legacy `api/methods.ts` registry lazy-load CSV template generation,
    while `api/methods.ts` lazy-loads browser CSV/image file-dialog
    compatibility. `frontend/vite.config.ts` gives `browserDialogs.ts` a
    focused `browser-dialogs` chunk and excludes it from eager modulepreload.
    This is a Phase 29 ownership/performance move, not a folder move or
    language conversion: the measured issue was Rollup folding CSV decoding
    into broad route startup. Proof: frontend utility tests, source/JSX check,
    production build, emitted chunk inspection, Docker release image
    `business-os:v6.0.0-202606041056`, local route trace
    `ops/runtime/reports/route-load-trace-2026-06-04T02-59-01-255Z.json`,
    remote admin trace
    `ops/runtime/reports/route-load-trace-2026-06-04T02-59-25-149Z.json`,
    public Cloudflare portal check
    `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-04T02-59-23-699Z/report.json`,
    post-live hygiene, and `git diff --check` passed. Sales and Returns both
    reported `csv-utils-present=False` during startup.

781. Keep Sales/Returns focused reads out of the broad API registry. Done:
    `Sales.tsx` now uses `salesTransport.getSales()` and
    `userReadTransport.getUsers()` for normal route-start reads, and
    `Returns.tsx` now uses `returnsTransport.getReturns()` for normal list
    startup. `frontend/vite.config.ts` now groups `http.ts`, `query.ts`, and
    `actorQuery.ts` into `api-http-core`, so focused read transports no longer
    inherit `app-api-methods` through shared HTTP/query helpers. This is a
    Phase 29 ownership/performance move, not a folder move or language
    conversion: the measured issue was route-start chunk ownership. Proof:
    focused performance guard, frontend typecheck, source/JSX check, full
    frontend utility suite, production build, emitted chunk inspection, Docker
    release image `business-os:v6.0.0-202606041117`, local route trace
    `ops/runtime/reports/route-load-trace-2026-06-04T03-19-53-714Z.json`,
    remote admin trace
    `ops/runtime/reports/route-load-trace-2026-06-04T03-20-19-101Z.json`,
    public Cloudflare portal check
    `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-04T03-19-53-181Z/report.json`,
    post-live hygiene, storage prune, generated-artifact cleanup, Phase 29
    audit, and `git diff --check` passed. Sales and Returns both reported
    `app-api-methods-present=False` and `csv-utils-present=False` during
    startup. Generated cleanup removed 415,957,346 bytes from regenerable
    `release`, `frontend/dist`, and `output` folders after the running Docker
    image was already built.

782. Keep Contacts CSV exports out of route startup. Done:
    `CustomersTab.tsx`, `SuppliersTab.tsx`, and `DeliveryTab.tsx` now lazy-load
    `frontend/src/utils/csv.ts` only from the export button handlers through a
    memoized dynamic import. This is a Phase 29 ownership/performance move, not
    a folder move or language conversion: the measured issue was the Contacts
    startup route loading `csv-utils` before export intent. Proof: focused
    performance guard, frontend typecheck, source/JSX check, full frontend
    utility suite, production build, Docker release image
    `business-os:v6.0.0-202606041904`, local Contacts route trace
    `ops/runtime/reports/route-load-trace-2026-06-04T11-14-33-581Z.json`,
    public Cloudflare portal check
    `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-04T11-14-33-554Z/report.json`,
    post-live hygiene, organization audit, schema audit, reference refresh,
    Phase 29 audit, storage prune, and `git diff --check` passed. Contacts
    reported `hasCsvUtils=false` during startup. Generated cleanup removed
    412,447,007 bytes from regenerable `release` and `frontend/dist` after the
    running Docker image was already built.

### Move 783: POS customer contact-option parser deferral

- Ownership evidence: Phase 29 performance scans and live route traces showed
  POS first-load still benefits from intent-sized chunks. The customer contact
  option parser belongs to the customer selection pathway, not the read-only
  product/cart browsing startup path.
- Change: `frontend/src/components/pos/POS.tsx` now keeps only the
  `ContactOption` type import from `contactOptionUtils`; the runtime parser is
  loaded through memoized `loadContactOptionUtilsModule()` when
  `parseContactOptions()` is called after customer intent.
- Guardrail: `frontend/tests/performanceLoadingUx.test.ts` rejects the static
  POS parser import and requires the dynamic import boundary.
- Verification: source guardrail test, frontend typecheck, production build,
  emitted chunk inspection, JSX check, frontend utils tests, Docker
  release/start, Docker health, POS Playwright route trace, authenticated POS
  interaction probe, public Cloudflare portal check, post-live hygiene,
  schema audit, organization audit, generated reference refresh, and Phase 29
  audit passed.
- Runtime proof: Docker image `business-os:v6.0.0-202606041924` is running
  with frontend hash `65f9c9c258d20478`. POS route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T11-38-42-025Z.json` passed
  in 235 ms with 30 requests, 22 scripts, zero failures/errors, and
  `hasContactOptionUtils=false`.
- Cleanup proof: deleted 412,448,579 bytes from regenerable `release` and
  `frontend/dist` after the running Docker image was already built.

### Move 784: Cloudflare startup warmup retry

- Ownership evidence: Phase 8.4 actual-link checks and Docker startup logs
  showed a startup-only readiness gap: Cloudflare Tunnel can briefly return
  1033/530 for public/admin documents while the local Docker health endpoint is
  already healthy. This belongs in the Cloudflare startup warmup path rather
  than app UI code or browser noise handling.
- Change: `ops/scripts/runtime/cloudflare/warm-cloudflare-startup-assets.ts`
  now retries transient document fetch failures (`status 0`, `429`, and
  `>=500`) using configurable defaults of five attempts and a two-second delay.
  Reports include the final result, every attempt, and `attemptCount` so future
  startup failures show whether the tunnel never recovered or only needed a
  warmup retry.
- Guardrail: `ops/scripts/verification/verify-docker-release.ts` now requires
  the warmup retry environment variables, CLI flags, transient failure
  predicate, retry loop, release-start wiring, and attempt reporting.
- Verification: Docker release guardrail, focused frontend performance guard,
  Docker release build/start, Docker health, launcher Cloudflare startup
  warmup, broad route-load Playwright trace, public Cloudflare portal
  Playwright check, post-live hygiene, storage prune, reference refresh, and
  Phase 29 audit passed.
- Runtime proof: Docker image `business-os:v6.0.0-202606042015` is running
  with frontend hash `e00a60f6b9937815`. The launcher warmup report
  `ops/runtime/docker-release/cloudflare-startup-warmup.json` passed with
  `ok=true`, `failedCount=0`, 26 warmed targets, `documentAttempts=5`, and
  `documentRetryDelayMs=2000`.
- Live proof: route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T12-18-08-251Z.json` passed
  Dashboard, Products, POS, Inventory, Contacts, Sales, Returns, and Server
  with zero failed requests and zero console/page errors. Public portal check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-04T12-18-07-701Z/report.json`
  rendered 20 products and recorded zero failed responses, zero relevant
  console messages, and zero page errors.
- Cleanup proof: deleted 380,729,941 bytes from regenerable `release` after
  the running Docker image was already built; host `frontend/dist` was already
  absent. Storage prune removed 226,683 bytes of old runtime reports and
  38.19 MB of Docker builder cache while preserving uploads, secrets, env
  files, local backup retention roots, Docker images, Docker volumes, and
  newest R2 backup `datasync-2026-06-04T09-26-59-912Z`.

### Move 785: Product detail chunk first-window deferral

- Ownership evidence: local route traces showed Products and Inventory were
  paying for the ProductDetailModal chunk during route startup. The root cause
  was shared visible-row helpers being assigned to the lazy `product-detail`
  chunk. Those helpers belong in a shared product chunk, while detail modal
  UI stays lazy.
- Change: `frontend/vite.config.ts` now assigns `productBatches.ts` and
  `color.ts` to `product-shared` beside existing product row/gallery helpers.
  The Products and Inventory ProductDetailModal components remain in
  `product-detail`.
- Guardrail: `frontend/tests/performanceLoadingUx.test.ts` now requires the
  product image, color, and visible batch primitives to stay in
  `product-shared`, and rejects `productBatches.ts` or `color.ts` from the
  `product-detail` ownership branch.
- Verification: focused performance guard, frontend typecheck, JSX/source
  check, frontend production build, production chunk inspection, Docker release
  build/start, route-load Playwright trace, authenticated Products detail-click
  probe, public Cloudflare portal Playwright check, post-live hygiene, schema
  audit, organization audit, generated reference refresh, Phase 29 audit,
  storage prune, and generated-artifact cleanup passed.
- Runtime proof: Docker image `business-os:v6.0.0-202606042050` is running
  with source hash `5d419c030bf25d50` and frontend hash
  `28fb39f953a5425c`.
- Route proof: route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T12-52-46-933Z.json` passed
  Products in 202 ms with 35 requests/27 scripts and Inventory in 194 ms with
  38 requests/31 scripts. Both routes had zero failures/errors and no
  `product-detail` request before detail intent.
- Interaction proof: authenticated Playwright clicked a real Products row and
  observed `beforeDetailClick=false` and `afterDetailClick=true` for the
  `product-detail` chunk, with zero failed responses, zero request failures,
  zero page errors, and zero relevant console messages.
- Cleanup proof: deleted 412,450,532 bytes from regenerable `release` and
  `frontend/dist` after the running Docker image was already built. Storage
  prune removed 594,838 bytes of old reports and 38.2 MB of Docker builder
  cache while preserving uploads, secrets, env files, backup roots, images,
  volumes, and newest R2 backup `datasync-2026-06-04T09-26-59-912Z`.

### Move 786: Audit Log focused startup transport

- Ownership evidence: Audit Log first-window route traces still loaded
  `app-api-methods`, CSV helpers, local DB, Dexie, and product-read mirror
  helpers even though normal startup only needed audit reads.
- Change: Audit Log now uses the focused `auditLogTransport.ts`; CSV helpers
  load only after export intent; audit mirror work is delayed; local DB is
  loaded only for offline fallback. Vite now owns this path as
  `audit-log-api` instead of the broad legacy registry.
- Verification: focused performance guard, frontend typecheck, JSX/source
  check, frontend build, generated chunk inspection, Docker release/start,
  health, and served route-load trace passed.
- Runtime proof: Docker image `business-os:v6.0.0-202606050317` is running
  with frontend hash `5e26c07d0103d31f`.
- Route proof: Audit Log startup dropped from 41 requests/36 scripts to
  27 requests/22 scripts in
  `ops/runtime/reports/route-load-trace-2026-06-04T19-19-51-914Z.json`, with
  no `app-api-methods`, `csv-utils`, `app-local-db`, `vendor-dexie`, or
  `product-read-api` in the served first-window script list.
- Cleanup proof: deleted only ignored/regenerable output after Docker health
  was verified: `release` (380,730,965 bytes) and `frontend/dist`
  (31,722,069 bytes), for 412,453,034 bytes removed. Phase 29 audit then
  passed with zero failures.
- Live public proof:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-04T19-26-46-628Z/report.json`
  passed with 20 rendered products, bootstrap 200, AI status 200 after
  interaction, and zero relevant console messages/page errors.
- Hygiene proof: post-live hygiene found zero leftover broad QA, smoke,
  action-history, or generated-integrity cleanup matches. Prune storage removed
  300,396 bytes of old reports and 38.2 MB of Docker builder cache while
  preserving business uploads, secrets, env files, backups, images, and
  volumes.

### Move 787: Files focused startup transport

- Ownership evidence: Files route traces still loaded the broad
  `app-api-methods` registry even though the default Library view needs only
  files, AI providers, and AI response reads plus focused upload/delete
  actions.
- Change: `FilesPage.tsx` now binds directly to `fileTransport.ts` and
  `aiTransport.ts`. Multipart upload headers moved into
  `multipartHeaders.ts` so Files can upload without importing the broad import
  transport chain. Vite groups the route into focused `file-api` and `ai-api`
  chunks.
- Verification: focused API/performance guards, full frontend utility suite,
  typecheck, JSX/source check, frontend build, Docker release/start, health,
  served route-load trace, focused Files providers live action check, public
  Cloudflare check, post-live hygiene, storage prune, generated reference
  refresh, schema audit, organization audit, and Phase 29 audit passed.
- Runtime proof: Docker image `business-os:v6.0.0-202606050336` is running
  with frontend hash `c0f2db77bab2fe05`.
- Route proof: Files startup dropped from 38 requests/33 scripts to
  27 requests/22 scripts in
  `ops/runtime/reports/route-load-trace-2026-06-04T19-46-51-343Z.json`, with
  no `app-api-methods` in the served first-window script list and focused
  `file-api` / `ai-api` chunks present.
- Live action proof:
  `ops/runtime/reports/phase84-files-providers-actions-live-check-2026-06-04T19-47-31-052Z/files-providers-actions.png`
  loaded files, providers, and responses with 200 statuses, opened the
  Providers tab, found 12 providers, and verified edit/test/delete actions for
  each provider with zero relevant console messages.
- Cleanup proof: deleted only ignored/regenerable output after Docker health
  was verified: `release` (380,733,013 bytes) and `frontend/dist`
  (31,722,976 bytes), for 412,455,989 bytes removed. Phase 29 audit then
  passed with zero failures. Prune storage removed 252,488 bytes of old
  reports and 38.2 MB of Docker builder cache while preserving business
  uploads, secrets, env files, backups, images, and volumes.

### Move 788: Users focused startup transport

- Ownership evidence: Users route traces still loaded the broad
  `app-api-methods` registry, profile/OAuth modal transport adjacency, and
  local DB/Dexie-adjacent fallback code even though the default first-window
  work only needs users, roles, and guarded user/role mutations.
- Change: `Users.tsx` now binds directly to `userAdminTransport.ts`.
  The new transport reuses `userReadTransport.ts` for users, lazy-loads local
  DB only for role fallback, and keeps expected-updated-at guards for writes.
  Vite groups this path as `user-admin-api`.
- Verification: focused performance and action-stability guards, full
  frontend utility suite, typecheck, JSX/source check, frontend build, Docker
  release/start, health, served route-load trace, focused Users actions live
  check, public Cloudflare check, post-live hygiene, storage prune, generated
  reference refresh, schema audit, organization audit, and Phase 29 audit
  passed.
- Runtime proof: Docker image `business-os:v6.0.0-202606050403` is running
  with frontend hash `47905159465a17b4`.
- Route proof: Users startup dropped from 41 requests/35 scripts to
  29 requests/23 scripts in
  `ops/runtime/reports/route-load-trace-2026-06-04T20-13-07-390Z.json`, with
  no `app-api-methods`, `user-profile-modal`, or `vendor-dexie` in the served
  first-window script list and focused `user-admin-api` / `user-read-api`
  chunks present.
- Live action proof:
  `ops/runtime/reports/phase84-users-actions-live-check-2026-06-04T20-13-25-408Z/users-actions.png`
  loaded users and roles with 200 statuses, opened Add User, Change Password,
  Roles, Edit/Delete Role, and Create Role surfaces, and recorded zero
  relevant console messages.
- Cleanup proof: deleted only ignored/regenerable output after Docker health
  was verified: `release` (380,736,085 bytes) and `frontend/dist`
  (31,724,915 bytes), for 412,461,000 bytes removed. Phase 29 audit then
  passed with zero failures. Prune storage removed 319,795 bytes of old
  reports and 38.21 MB of Docker builder cache while preserving business
  uploads, secrets, env files, backups, images, and volumes.

### Move 789: Branches focused startup transport

- Ownership evidence: Branches route traces still loaded the broad
  `app-api-methods` registry and transfer workflow during first-window
  list/summary loading, even though the default view only needs focused
  branch reads and guarded branch mutations.
- Change: `Branches.tsx` now binds directly to `branchTransport.ts` for branch
  list, summary, transfers, stock expansion, and CRUD. `TransferModal.tsx`
  lazy-loads only after transfer intent and uses the same focused branch
  transport. Vite groups the modal as `branch-transfer-modal` and excludes it
  from eager modulepreload.
- Ops fix: `ops/scripts/powershell/docker-release.ps1` now writes
  `docker-release.env` through explicit .NET `WriteAllLines`, fixing the
  post-build release failure seen after image `business-os:v6.0.0-202606050445`.
- Verification: focused performance and action-stability guards, typecheck,
  JSX/source check, frontend build, Docker release/start, health, served
  route-load trace, focused Branches actions live check, public Cloudflare
  check, post-live hygiene, storage prune, generated reference refresh, schema
  audit, organization audit, and Phase 29 audit passed.
- Runtime proof: Docker image `business-os:v6.0.0-202606050450` is running
  with frontend hash `cff197b375bc0cdd`.
- Route proof: Branches startup dropped from 42 requests/36 scripts and
  3533 ms to 29 requests/23 scripts and 194 ms in
  `ops/runtime/reports/route-load-trace-2026-06-04T20-52-25-519Z.json`, with
  no `app-api-methods` and no `branch-transfer-modal` in the served
  first-window script list and focused `branch-api` present.
- Live action proof:
  `ops/runtime/reports/phase84-branches-actions-live-check-2026-06-04T20-53-47-119Z/branches-actions.png`
  loaded branches with 200 status, opened Add Branch, edit, bulk-delete, and
  transfer surfaces, loaded branch stock with 200, and recorded zero relevant
  console messages.
- Cleanup proof: deleted only ignored/regenerable output after Docker health
  was verified: `release` (380,736,621 bytes) and `frontend/dist`
  (31,726,454 bytes), for 412,463,075 bytes removed. Phase 29 audit then
  passed with zero failures. Prune storage removed 264,795 bytes of old
  reports and 76.43 MB of Docker builder cache while preserving business
  uploads, secrets, env files, backups, images, and volumes.

### Move 790: Loyalty Points focused startup transport and Docker version cleanup

- Ownership evidence: Loyalty Points route traces still loaded the broad
  `app-api-methods` registry and portal transport during first-window customer
  points loading, even though the default view only needs the customer read
  path.
- Change: `LoyaltyPointsPage.tsx` now imports `getCustomers` from
  `contactReadTransport.ts` for customer point rows. Membership lookup
  lazy-loads `portalTransport.ts` only after lookup intent. The
  `performanceLoadingUx` guard now rejects `window.api`, `getLoyaltyApi()`,
  and `api/methods.ts` in Loyalty Points while preserving explicit loader
  timeouts.
- Runtime proof: Docker image `business-os:v6.0.0-202606050515` is running
  with frontend hash `612786e4d941e56b`, and `business-os:latest` points at
  that verified image.
- Route proof: Loyalty Points startup dropped from 36 requests/31 scripts and
  229 ms to 22 requests/17 scripts and 180 ms in
  `ops/runtime/reports/route-load-trace-2026-06-04T22-47-21-728Z.json`, with
  no `app-api-methods` and no `app-portal` in the served first-window script
  list and focused `contact-read-api` present.
- Live proof: `npm.cmd --prefix ops run phase84:live-suite` passed the broad
  admin UI live check, public Cloudflare portal check, and post-live hygiene
  gate. The broad UI report recorded 66 checked signals, zero relevant console
  messages, and no framework overlay.
- Cleanup proof: deleted only ignored/regenerable output after Docker health
  was verified: `release` and post-build `frontend/dist`, for 444,183,234
  bytes removed across cleanup passes. Phase 29 audit then passed with zero
  failures. Prune storage removed 371,474 bytes of old reports and 76.44 MB of
  Docker builder cache while preserving business uploads, secrets, env files,
  backups, images, and volumes.
- Docker version cleanup: removed 98 stale `business-os:v6.0.0-*` Docker image
  tags while keeping the active image and four recent rollback images. Docker
  volumes, uploads, databases, env files, and secrets were not pruned.
- Verification: frontend/backend utility suites, frontend typecheck,
  JSX/source check, frontend build, Docker health, route-load trace,
  Phase 8.4 live suite, storage prune, schema audit, organization audit,
  generated reference refresh, and Phase 29 audit passed.

### Move 791: Inventory persisted-section startup gate

- Ownership evidence: Inventory already defaulted to `products`, but its
  reusable section switcher could restore a previously persisted `all` value
  from `business-os:inventory:section:v2`, turning the next page entry into a
  heavier startup path with stats, movement, RFID, dashboard, and returns
  adjacency.
- Change: `SectionSwitcher` now accepts a narrow
  `shouldRestoreStoredValue` guard. Inventory uses that guard to refuse only
  the heavy persisted `all` value on page entry while preserving explicit
  focused sections such as `products`, `stats`, `movements`, and `rfid`.
  Users can still open `All` deliberately during a session.
- Ops proof: added
  `ops/scripts/runtime/live-checks/phase84-inventory-section-restore-live-check.ts`
  plus `npm.cmd --prefix ops run phase84:inventory-section-restore` so this
  guard can be tested with a real browser and seeded localStorage.
- Runtime proof: Docker image `business-os:v6.0.0-202606050737` is running
  with frontend hash `2881516323e52066`.
- Live proof:
  `ops/runtime/reports/phase84-inventory-section-restore-live-check-2026-06-04T23-48-31-869Z/report.json`
  seeded `business-os:inventory:section:v2=all`, loaded Inventory, confirmed
  the active section was `Products`, completed one product startup read through
  `/api/inventory/bootstrap`, and recorded zero stats, movements, RFID,
  dashboard, returns, framework overlay, or relevant console messages.
- Route proof:
  `ops/runtime/reports/route-load-trace-2026-06-04T23-48-08-028Z.json`
  passed Inventory, Products, Contacts, and Loyalty Points with zero failed
  requests and zero console/page errors. Inventory loaded in 231 ms with
  38 requests/31 scripts on the served Docker build.
- Cleanup proof: deleted only ignored/regenerable output after Docker health
  was verified: `release` (380,743,476 bytes) and `frontend/dist`
  (31,726,867 bytes), for 412,470,343 bytes removed. Storage prune removed
  488,515 bytes of old reports and 21.32 GB of Docker builder cache while
  preserving business uploads, secrets, env files, local backups, R2 newest
  backup, images, and volumes. Phase 29 audit passed afterward with zero
  failures.
- Verification: frontend section navigation guard, performance loading guard,
  frontend typecheck, frontend utility suite, JSX/source check, frontend build,
  Docker release/start health, route-load trace, focused Inventory persisted
  section Playwright check, public Cloudflare portal Playwright check, backend
  utility suite, storage prune, schema audit, organization audit, generated
  reference refresh, `git diff --check`, and Phase 29 audit passed.

### Move 792: Guarded Docker release-image retention

- Ownership evidence: Move 790 manually removed stale `business-os:v6.0.0-*`
  image tags after repeated release/test cycles. The plan called for
  formalizing that safe image-tag policy so future cleanups stay repeatable
  and do not drift into broad Docker pruning.
- Change: `ops/scripts/runtime/storage/prune-storage.ts` now owns Docker
  release-image retention under the existing cleanup command. Policy fields
  `cleanup.dockerImageRetention` and `cleanup.dockerImageKeepLatest` default
  to enabled with five kept release tags. CLI flags
  `--docker-image-retention`, `--skip-docker-image-retention`, and
  `--docker-image-keep-latest` allow explicit operator control.
- Safety proof: the retention function only removes old tagged
  `business-os:v*` release images. It protects `business-os:latest`, the
  active `BUSINESS_OS_IMAGE`, running image refs, running image IDs, and newest
  rollback tags. It does not call `docker image prune`, `docker system prune`,
  or `docker volume prune`.
- Cleanup proof: preview planned only
  `business-os:v6.0.0-202606050440`; apply removed only that tag and 176,008
  bytes of old route-trace reports. The final local Business OS image set is
  `latest`, `v6.0.0-202606050737`, `v6.0.0-202606050515`,
  `v6.0.0-202606050504`, `v6.0.0-202606050450`, and
  `v6.0.0-202606050445`.
- Runtime proof: Docker containers stayed healthy on
  `business-os:v6.0.0-202606050737` after cleanup. Uploads, secrets, env
  files, databases, volumes, backups, active image, and rollback tags were
  preserved.
- Verification: prune-storage syntax check, full automation guardrail test,
  prune preview/apply, Docker image/container inspection, generated reference
  refresh, and Phase 29 audit passed.

### Move 793: Inline generated public runtime guards

- Ownership evidence: the route-load traces showed every cold admin route paid
  separate startup requests for `/runtime-noise-guard.js` and
  `/theme-bootstrap.js`, even though both files are tiny, TypeScript-owned
  public runtime guards that must execute before React/vendor parsing.
- Change: `frontend/vite.config.ts` now owns an
  `inlinePublicRuntimeScripts` transform that reads the generated public guard
  files and replaces their external HTML script tags with escaped inline
  blocks at build time.
- Compatibility proof: `frontend/public/runtime-noise-guard.js` and
  `frontend/public/theme-bootstrap.js` stay in place, and
  `npm.cmd --prefix frontend run verify:public-runtime` continues to prove
  those generated files match `frontend/src/public-runtime/*.ts`.
- Performance proof: built `frontend/dist/index.html` contains
  `data-business-os-runtime` blocks for both guards and no longer contains
  external guard `src` tags, cutting two parser-blocking startup requests from
  every built app-shell page without changing route code.
- Verification: frontend utility suite, frontend production build, and
  frontend performance verification passed. The next live verification slice
  ran against Docker release `business-os:v6.0.0-202606050809` with frontend
  hash `b95ab65d20e981cf`. Products, Inventory, Contacts, and Loyalty Points
  each dropped by two total requests and two script fetches, with zero failed
  requests and zero console/page errors. The public Cloudflare portal check
  also passed after release startup. Generated `release` and `frontend/dist`
  output was removed after live proof, reclaiming 412,493,083 bytes, and
  guarded storage prune removed only old reports, builder cache, and the oldest
  rollback image tag.

### Move 794: Fold Contacts icon-only startup chunks into shared icons

- Ownership evidence: the post-Move-793 Contacts route trace still loaded two
  tiny route-local lucide icon chunks, `truck-*` and `warehouse-*`, even though
  Contacts already paid for the shared icon chunk during the same cold start.
- Change: `frontend/vite.config.ts` adds `truck` and `warehouse` to the
  route-shared lucide icon set, and `ops/scripts/frontend/verify-performance.ts`
  now guards that policy so future chunk rewires do not quietly split those
  icons back out.
- Performance proof: after production build, `frontend/dist/assets` contains
  no `truck-*.js` or `warehouse-*.js` output, and `shared-icons-bqdPMMqK.js`
  stays bounded at 11,651 bytes.
- Runtime proof: Docker release `business-os:v6.0.0-202606050831` is running
  and healthy. The focused Contacts route-load trace
  `ops/runtime/reports/route-load-trace-2026-06-05T00-47-32-343Z.json`
  passed with 30 total requests, 25 script requests, 2 API requests, ready
  text at 215 ms, and zero failed requests or page errors.
- Verification: frontend production build, frontend utility suite, frontend
  performance verifier, Docker health, container image inspection, and focused
  Contacts live route trace passed.

### Move 795: Fold Returns undo icon startup chunk into shared icons

- Ownership evidence: the broad post-Move-794 route trace still showed Returns
  loading a standalone `undo-2-*` lucide icon chunk before the page was ready,
  while Returns already loaded the shared icon chunk in the same cold-start
  path.
- Change: `frontend/vite.config.ts` adds `undo-2` to the route-shared lucide
  icon set, and `ops/scripts/frontend/verify-performance.ts` now guards that
  policy.
- Performance proof: after production build, `frontend/dist/assets` contains
  no `undo-2-*.js` output, and the shared icon chunk stays bounded at 11,985
  bytes.
- Runtime proof: Docker release `business-os:v6.0.0-202606050903` is running
  and healthy. The focused Returns route-load trace
  `ops/runtime/reports/route-load-trace-2026-06-05T01-14-26-794Z.json`
  passed with 27 total requests, 22 script requests, 2 API requests, ready
  text at 190 ms, and zero failed requests or page errors.
- Verification: frontend production build, frontend utility suite, frontend
  performance verifier, Docker health, container image inspection, and focused
  Returns live route trace passed.

### Move 796: Split Inventory read/write transports and defer action-only preloads

- Ownership evidence: live remote Inventory traces still showed many
  action-only API/tool chunks entering the first-window load even when the
  default product view only needed read bootstrap data.
- Change: inventory reads remain in `frontend/src/api/inventoryTransport.ts`;
  stock mutations, transfers, row moves, and reason saves now live in
  `frontend/src/api/inventoryWriteTransport.ts`. Inventory, Products, and the
  legacy API facade were rewired to call the write transport only on mutation
  intent.
- Preload policy: `frontend/vite.config.ts` now names
  `inventory-write-api` and defers modulepreload for action-only API/tool
  chunks so Cloudflare first paint does not compete with edit/history/import
  code before the user asks for those flows.
- Performance proof: remote Inventory dropped from 42 total requests and 37
  script requests in the pre-move trace to 24 total requests and 19 script
  requests in
  `ops/runtime/reports/route-load-trace-2026-06-05T02-19-04-186Z.json`, with
  zero failed requests and zero console/page errors.
- Live QA proof: the all-pages Playwright control audit passed 375 of 375
  tested controls across 34 desktop/mobile routes, with zero findings. The
  broad audit intentionally skipped destructive, print/download, and
  seeded-rollback-only settings actions.
- Cleanup proof: after live proof, regenerable `release` and `frontend/dist`
  output was removed, reclaiming 412,490,897 bytes. Guarded storage prune
  removed old reports, builder cache, and only the oldest rollback image tag
  while preserving the active image, recent rollbacks, uploads, secrets, env
  files, databases, volumes, and backup roots.
- Verification: frontend utility suite, frontend production build, frontend
  performance verifier, backend utility suite, Docker release build/start,
  local packaged route trace, remote admin route trace, public portal
  Cloudflare check, all-pages control audit, reference generation,
  organization audit, schema audit, storage prune, and Phase 29 audit passed.

### Move 797: Lazy-load legacy API bridge domain transports

- Ownership evidence: after Move 796, remote POS still loaded action-only API
  chunks through the legacy `window.api` bridge even when the first POS view
  only needed product/catalog/cart reads.
- Change: `frontend/src/api/methods.ts` now memoizes lazy import loaders for
  AI, action history, audit log, contacts, dashboard, files, inventory writes,
  import jobs, product writes, RFID, and sales read transports. The exported
  bridge method names stay stable, but those domain transports now load only
  when the matching action or page asks for them.
- Chunk policy: `frontend/vite.config.ts` now keeps import-job uploads in the
  deferred `import-jobs-api` chunk and moves shared multipart headers into a
  tiny deferred `multipart-headers-api` chunk. The emitted
  `app-api-methods` asset no longer statically imports `file-api`; import-job
  upload helpers live in `import-jobs-api` and import only the 0.22 kB
  multipart-header helper.
- Guardrail proof: `frontend/tests/apiHttp.test.ts` verifies the lazy bridge
  shape and keeps query-string ownership in the focused sales transport.
  `frontend/tests/performanceLoadingUx.test.ts` verifies file transport,
  import transport, and multipart-header chunk ownership.
- Runtime proof: Docker release `business-os:v6.0.0-202606051156` is running
  and healthy with frontend hash `a8074d3277060114`. The local packaged route
  trace `ops/runtime/reports/route-load-trace-2026-06-05T03-59-28-364Z.json`
  passed Dashboard, Products, Inventory, POS, Returns, Contacts, and public
  catalog with zero failed requests or console/page errors.
- Remote proof: the admin Cloudflare trace
  `ops/runtime/reports/route-load-trace-2026-06-05T03-59-58-547Z.json`
  passed Dashboard, Products, Inventory, POS, Returns, and Contacts with zero
  failed requests or console/page errors. POS dropped to 26 total requests and
  20 script requests, compared with the pre-split remote POS baseline of 43
  total requests and 37 script requests.
- Public proof:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-05T04-01-01-571Z/report.json`
  passed against `https://leangcosmetics.dpdns.org/public` with 20 rendered
  products, portal bootstrap 200, AI status 200 after interaction, enforced
  CSP present, and zero failed responses, relevant console messages, or page
  errors. The public route-load trace
  `ops/runtime/reports/route-load-trace-2026-06-05T04-01-38-924Z.json`
  passed with zero failures and ready text at 3432 ms through Cloudflare.
- Verification: frontend utility suite, frontend production build, frontend
  performance verifier, emitted asset inspection, Docker release build/start,
  Docker health, local route-load trace, remote admin route-load trace, public
  portal Cloudflare check, public route-load trace, generated reference
  refresh, organization audit, schema audit, and diff whitespace checks
  passed.
- Cleanup proof: after runtime proof, ignored regenerable `frontend/dist`
  (31,740,658 bytes) and `release` (380,757,896 bytes) were removed, for
  412,498,554 bytes reclaimed. `npm.cmd --prefix ops run phase29:audit`
  then passed all nine checks.

### Move 798: Correct brand/group filters, refresh metadata, and dark/filter polish

- Ownership evidence: live product-management review showed saved brand
  library entries with `0 product(s)` being mixed into active review and
  normalization suggestions. Product/POS/Inventory group filters still carried
  redundant parent/variant states, and exact brand comparisons made valid
  filters brittle when casing or whitespace differed.
- Change: `ManageBrandsModal` now separates active brand usage from unused
  saved library brands. Product, POS, and Inventory use the `All / Groups /
  Standalone` group model, while legacy `grouped`, `parent`, and `variant`
  values remain compatible. Product and inventory server routes compare
  normalized lower-trimmed lookup fields. Inventory keeps previous filter
  metadata when refresh responses do not include replacement metadata.
- UI policy: the shared filter menu now uses rounded popovers and pill
  controls. Dark mode global surfaces were softened to a neutral dark palette
  with clearer borders and less heavy navy block styling.
- Verification: frontend utility suite, backend utility suite, frontend
  production build, backend server-entry verification, Docker release
  build/start, local route-load trace, remote admin route-load trace, remote
  public route-load trace, Phase 8.4 live suite, all-pages control audit, and
  `git diff --check` passed. Root `npm.cmd run build` remains intentionally
  unavailable; package-level build scripts are the accepted verification path.
- Runtime proof: Docker release `business-os:v6.0.0-202606051251` is running
  healthy. Local ready times were 178-259 ms for the checked routes. Remote
  admin ready times were 186-276 ms; remote public catalog was 365 ms. The
  all-pages control audit covered 34 desktop/mobile routes, 519 discovered
  controls, 374 safely exercised controls, and 0 failed controls.

### Move 799: Compact shared filter dropdowns and verify live controls

- Ownership evidence: after Move 798, native `select` popovers in Dashboard,
  Products, Library, and related filter controls still rendered as square
  browser dropdowns, while Inventory could expose a stale translated `Back`
  label in the Brand section. POS filter chips also used stacked labels that
  wasted vertical space on smaller screens.
- Change: `AppSelect` now exposes rounded app-native popup and option surfaces
  with stable test hooks. `FilterMenu` and the Product/Inventory label helpers
  replace any translated `Back` label with the intended fallback label and use
  compact one-row section layouts. POS filter sections now use compact
  label-plus-chip rows with rounded chips and stable Playwright hooks.
- Verification: `npm.cmd --prefix frontend run typecheck`,
  `npm.cmd --prefix frontend run check:jsx`, and
  `npm.cmd --prefix frontend run build` passed. Docker release
  `business-os:v6.0.0-202606061544` built and started healthy with frontend
  hash `66c6408cdb3475b0` and source hash `9e29b055b17fc325`.
- Live proof: the focused Playwright check
  `ops/runtime/reports/phase84-filter-menu-live-check-2026-06-06T07-46-47-026Z/report.json`
  passed Products, Inventory, Audit, Library, Dashboard, and POS. It verified
  no `Back` labels, rounded filter sections, rounded select menus/options,
  compact POS filter rows, HTTP 200 reads, no framework overlay, and zero
  relevant console messages.
- Runtime proof: the broad Phase 8.4 UI live check
  `ops/runtime/reports/phase84-ui-live-check-2026-06-06T07-46-47-867Z/report.json`
  passed all probed local route/API signals at HTTP 200. The public Cloudflare
  portal check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-06T07-47-54-599Z/report.json`
  rendered 20 products with portal bootstrap 200, AI status 200 after
  interaction, enforced CSP, no internal server error, zero failed responses,
  zero relevant console messages, and zero page errors.

### Move 800: Lazy-load Inventory export and report assembly

- Ownership evidence: the measured route-size sweep after Move 799 showed
  Inventory still carried export-only CSV/report/ZIP assembly in the normal
  route chunk. Those helpers are not needed for viewing products, stats,
  movements, RFID, filters, or stock actions; they are needed only when the
  user activates an export command.
- Change: `frontend/src/components/inventory/inventoryExport.ts` now owns the
  export-only row builders, standalone report assembly, and ZIP package
  generation. `Inventory.tsx` keeps a small `buildInventoryExportScope`
  callback and lazy-loads `inventoryExport.ts` only inside export actions.
  `frontend/vite.config.ts` assigns that file to a named deferred
  `inventory-export` chunk and keeps it out of eager modulepreload.
- Guardrail proof: `frontend/tests/performanceLoadingUx.test.ts` now verifies
  that Inventory dynamically imports the export module, does not statically
  import it, that the export module owns `exportInventoryPackage` and
  `buildStandaloneReportHtml`, and that Vite defers the named
  `inventory-export` chunk.
- Verification proof: `npm.cmd --prefix frontend run typecheck`,
  `npm.cmd --prefix frontend run check:jsx`,
  `npm.cmd --prefix frontend run test:utils`, and
  `npm.cmd --prefix frontend run build` passed. The production build now emits
  `Inventory` at 132.96 kB plus an intent-only `inventory-export` chunk at
  16.71 kB, compared with the previous 145.95 kB Inventory route chunk.
- Packaged runtime proof: Docker release `business-os:v6.0.0-202606061614`
  built, updated, and started healthy with frontend hash
  `95c05024fca68d3a`. The focused route trace
  `ops/runtime/reports/route-load-trace-2026-06-06T08-16-53-367Z.json`
  loaded Inventory in 371 ms ready time with 37 requests, 30 scripts, 2 API
  calls, no failed requests, no relevant console errors, and no
  `inventory-export-*` request on normal route entry. `docker ps` showed only
  the expected release stack containers.
- Live proof: the full Phase 8.4 live suite passed. Broad local UI report
  `ops/runtime/reports/phase84-ui-live-check-2026-06-06T08-17-36-183Z/report.json`
  checked 66 signals with all probed route/API calls at HTTP 200, no framework
  overlay, and zero relevant console messages. Public Cloudflare portal report
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-06T08-18-14-943Z/report.json`
  rendered 20 products with zero failed responses, zero relevant console
  messages, zero page errors, and enforced CSP present. Post-live hygiene
  passed with loaded dataset status and zero generated-integrity matches.
- Cleanup and Phase 29 proof: after runtime proof, ignored regenerable
  `frontend/dist` (31,780,450 bytes) and `release` (380,849,304 bytes) were
  removed, for 412,629,754 bytes reclaimed. Uploads, secrets, env files,
  databases, volumes, backups, and the active Docker image were not touched.
  The follow-up `npm.cmd --prefix ops run phase29:audit` passed all nine
  guardrail checks.
- Current plan position after Move 800: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays
  at 51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, and performance guardrail. Next executable target: continue
  measured route-local Products/Inventory code-size checks and inspect the
  remaining dashboard/portal language and CSS costs with browser traces before
  any broader language/runtime rewrites.

### Move 801: Lazy-load Products CSV export row assembly

- Ownership evidence: the measured route-size sweep after Move 800 showed
  Products still carried export-only CSV row assembly in the normal route
  chunk. That logic is not needed for viewing, filtering, pagination, grouped
  rows, action history, selection, undo/redo, or product management; it is
  needed only when the user activates CSV export.
- Change: `frontend/src/components/products/helpers/productExport.ts` now owns
  export-only product row normalization, image gallery flattening, branch-stock
  summary formatting, and price formatting. `Products.tsx` lazy-loads that
  module together with `csv.ts` only inside the CSV export action, while
  `productFilterHelpers.ts` keeps only route-live filtering/search helpers.
  `frontend/vite.config.ts` assigns the export helper to a named deferred
  `product-export` chunk and keeps it out of eager modulepreload.
- Guardrail proof: `frontend/tests/performanceLoadingUx.test.ts` verifies that
  Products dynamically imports `productExport.ts`, does not import
  `buildProductExportRows` from `productFilterHelpers.ts`, that the export
  module owns `formatPriceNumber`, and that Vite defers the named
  `product-export` chunk.
- Verification proof: `node frontend\tests\productFilterHelpers.test.ts`,
  `node frontend\tests\performanceLoadingUx.test.ts`,
  `node frontend\tests\productSearchPagination.test.ts`,
  `npm.cmd --prefix frontend run typecheck`,
  `npm.cmd --prefix frontend run check:jsx`,
  `npm.cmd --prefix frontend run test:utils`, and
  `npm.cmd --prefix frontend run build` passed. The production build now emits
  `Products` at 96.60 kB plus an intent-only `product-export` chunk at
  2.60 kB, compared with the previous 98.80 kB Products route chunk.
- Packaged runtime proof: Docker release `business-os:v6.0.0-202606061633`
  built, updated, and started healthy with frontend hash
  `ef9de1c26f7b18d1`. The focused route trace
  `ops/runtime/reports/route-load-trace-2026-06-06T08-38-13-721Z.json`
  loaded Products in 315 ms ready time with 35 requests, 27 scripts, 2 API
  calls, no failed requests, no relevant console errors, and no
  `product-export-*` request on normal route entry. `docker ps` showed only
  the expected release stack containers.
- Live proof: the full Phase 8.4 live suite passed. Broad local UI report
  `ops/runtime/reports/phase84-ui-live-check-2026-06-06T08-38-27-510Z/report.json`
  checked 66 signals with all probed route/API calls at HTTP 200, no framework
  overlay, and zero relevant console messages. Public Cloudflare portal report
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-06T08-39-03-098Z/report.json`
  rendered 20 products with zero failed responses, zero relevant console
  messages, zero page errors, and enforced CSP present. Post-live hygiene
  passed with loaded dataset status and zero generated-integrity matches.
- Cleanup and Phase 29 proof: after runtime proof, ignored regenerable
  `frontend/dist` (31,780,848 bytes) and `release` (380,849,816 bytes) were
  removed, for 412,630,664 bytes reclaimed. Uploads, secrets, env files,
  databases, volumes, backups, and the active Docker image were not touched.
  The follow-up `npm.cmd --prefix ops run phase29:audit` passed all nine
  guardrail checks. `npm.cmd --prefix ops run prune-storage` still has a
  non-data follow-up for a locked old Vite preview report log:
  `ops/runtime/reports/vite-preview-appselect.log`.
- Current plan position after Move 801: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays
  at 51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, and performance guardrail. Next executable target: inspect
  the remaining dashboard/portal language and CSS costs with browser traces
  before any broader language/runtime rewrites.

### Move 802: Lazy-load Dashboard export and report assembly

- Ownership evidence: the focused Dashboard trace after the Products export
  split showed Dashboard still carried export-only CSV/report package code in
  its normal route graph. Dashboard viewing, range changes, chart rendering,
  stock alerts, recent sales, and KPI detail modals do not need CSV, ZIP, or
  standalone HTML report assembly until the user chooses an export action.
- Change: `frontend/src/components/dashboard/dashboardExport.ts` now owns
  export-only dashboard KPI rows, formula rows, manifest rows, sales/chart
  rows, top-product/customer rows, payment/branch rows, stock alert rows,
  recent-sale rows, standalone report assembly, and ZIP package generation.
  `Dashboard.tsx` builds a compact export context and dynamically imports the
  export module only from export menu actions. `frontend/vite.config.ts` names
  both `dashboard-export` and `dashboard-charts`; visible chart components stay
  in `dashboard-charts` so the export-only chunk is not fetched by normal
  Dashboard entry.
- Guardrail proof: `frontend/tests/performanceLoadingUx.test.ts` verifies the
  memoized dynamic Dashboard export import, prevents export row/report builders
  from creeping back into `Dashboard.tsx`, checks export-module ownership of
  price formatting, and asserts the Vite chunk ordering that keeps
  `dashboard-charts` separate from `dashboard-export`.
- Verification proof: `node frontend\tests\performanceLoadingUx.test.ts`,
  `npm.cmd --prefix frontend run typecheck`,
  `npm.cmd --prefix frontend run check:jsx`,
  `npm.cmd --prefix frontend run test:utils`, and
  `npm.cmd --prefix frontend run build` passed. The production build now emits
  `Dashboard` at 63.64 kB, `dashboard-charts` at 10.70 kB, and intent-only
  `dashboard-export` at 20.52 kB. Compared with the earlier Dashboard route
  baseline of 81.46 kB, export/report assembly is no longer part of the
  route-local bundle.
- Packaged runtime proof: Docker release `business-os:v6.0.0-202606061709`
  built, updated, and started healthy with frontend hash
  `bf8deeb130c3f486`. The Docker update created backup
  `ops/runtime/docker-release/backups/20260606-171118` before restart. The
  focused Dashboard route trace
  `ops/runtime/reports/route-load-trace-2026-06-06T09-12-04-350Z.json`
  reached ready text in 322 ms with 25 requests, 19 scripts, 2 API calls, no
  failed requests, no relevant console errors, and zero `dashboard-export-*`
  requests on normal route entry. `dashboard-charts-*` loaded once because the
  charts are visible route content.
- Live proof: the full Phase 8.4 live suite passed. Broad local UI report
  `ops/runtime/reports/phase84-ui-live-check-2026-06-06T09-12-04-495Z/report.json`
  checked 66 signals with all probed route/API calls at HTTP 200, no framework
  overlay, and zero relevant console messages. Public Cloudflare portal report
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-06T09-12-43-086Z/report.json`
  rendered 20 products with zero failed responses, zero relevant console
  messages, zero page errors, and enforced CSP present. Post-live hygiene
  passed with loaded dataset status and zero generated-integrity matches.
- Cleanup and Phase 29 proof: after runtime proof, ignored regenerable
  `frontend/dist` (31,781,438 bytes) and `release` (380,845,720 bytes) were
  removed, for 412,627,158 bytes reclaimed. Uploads, secrets, env files,
  databases, volumes, backups, and the active Docker image were not touched.
  The follow-up `npm.cmd --prefix ops run phase29:audit` passed all nine
  guardrail checks. `npm.cmd --prefix ops run prune-storage` still has a
  non-data follow-up for locked old report log
  `ops/runtime/reports/vite-preview-appselect.log`.
- Current plan position after Move 802: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays
  at 51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, and performance guardrail. Next executable target: inspect
  remaining portal language-pack/CSS costs and Dashboard chart packaging with
  browser traces before any broader language/runtime rewrites.

### Move 803: Defer the full English app language pack

- Ownership evidence: post-Move-802 route traces showed public catalog,
  Dashboard, Inventory, and POS still fetched the full `lang-en` chunk during
  the first route-load window even though the visible first-paint shell needs
  only a small set of common English labels. The full dictionary is pure
  lookup data and is not needed to render the first meaningful screen.
- Change: `frontend/src/AppContext.tsx` no longer statically imports
  `frontend/src/lang/en.json`. It now keeps a tiny `CORE_ENGLISH_PACK` for
  first-paint labels and dynamically imports the full English dictionary after
  page load/idle with a bounded timeout. Non-core language selections, such as
  Khmer, still load immediately so language recovery remains responsive.
- Guardrail proof: `frontend/tests/performanceLoadingUx.test.ts` now forbids
  the static English JSON import, verifies the synchronous core fallback,
  verifies the dynamic `import('./lang/en.json')`, and checks that core
  language packs are scheduled through the deferred load/idle path.
- Verification proof: `node frontend\tests\performanceLoadingUx.test.ts`,
  `npm.cmd --prefix frontend run typecheck`,
  `npm.cmd --prefix frontend run check:jsx`,
  `npm.cmd --prefix frontend run test:utils`, and
  `npm.cmd --prefix frontend run build` passed. The production build still
  emits `lang-en` as a separate chunk, but it is no longer required by initial
  route entry.
- Packaged runtime proof: Docker release `business-os:v6.0.0-202606061728`
  built, updated, and started healthy. The Docker update created backup
  `ops/runtime/docker-release/backups/20260606-173024` before restart. Local
  route traces against the live Docker app passed with zero failed requests
  and zero relevant console/page errors:
  public catalog `ops/runtime/reports/route-load-trace-2026-06-06T09-31-15-116Z.json`
  reached ready text in 271 ms with 21 requests/16 scripts/1 API;
  Dashboard `ops/runtime/reports/route-load-trace-2026-06-06T09-31-15-606Z.json`
  reached ready text in 271 ms with 24 requests/18 scripts/2 API;
  Inventory `ops/runtime/reports/route-load-trace-2026-06-06T09-31-15-629Z.json`
  reached ready text in 362 ms with 36 requests/29 scripts/2 API;
  POS `ops/runtime/reports/route-load-trace-2026-06-06T09-31-35-634Z.json`
  reached ready text in 206 ms with 26 requests/19 scripts/2 API. None of
  those first-window traces requested `lang-en-*`; Dashboard also kept
  `dashboard-export-*` out of normal route entry.
- Live proof: the full Phase 8.4 live suite passed. Broad UI report
  `ops/runtime/reports/phase84-ui-live-check-2026-06-06T09-33-26-469Z/report.json`
  checked 66 signals with all probed route/API calls at HTTP 200, no framework
  overlay, and zero relevant console messages. Public Cloudflare portal report
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-06T09-34-08-289Z/report.json`
  rendered 20 products with zero failed responses, zero relevant console
  messages, zero page errors, and enforced CSP present. Post-live hygiene
  passed with loaded dataset status and zero generated-integrity matches.
- Cleanup and Phase 29 proof: after runtime proof, ignored regenerable
  `frontend/dist` (31,826,118 bytes) and `release` (380,876,952 bytes) were
  removed, for 412,703,070 bytes reclaimed. Uploads, secrets, env files,
  databases, volumes, backups, and the active Docker image were not touched.
  `npm.cmd --prefix ops run prune-storage` still has the same non-data
  follow-up for locked old report log
  `ops/runtime/reports/vite-preview-appselect.log`.
- Current plan position after Move 803: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays
  at 51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, and performance guardrail. Next executable target: continue
  inspecting the public catalog route chunk and Inventory first-load helper
  graph before any broader language/runtime rewrites.

### Move 804: Move external portal translate widget setup into the lazy controller

- Ownership evidence: after Move 803, public catalog first-window traces no
  longer fetched `lang-en-*`, but `CatalogPage.tsx` still carried Google
  Translate widget bootstrap, callback, DOM host, and retry-loop code even
  though the external translate control is only needed after explicit language
  intent. The route already had a lazy `portalTranslateController.ts`
  boundary, so the setup loop belonged behind that boundary.
- Change: `frontend/src/components/catalog/portalTranslateController.ts` now
  owns `setupPortalExternalTranslateWidget`, including the Google Translate
  script callback, host creation, combo readiness polling, and cleanup.
  `CatalogPage.tsx` delegates to that lazy module and only passes state
  callbacks for pending, ready, and failure UI.
- Guardrail proof: `frontend/tests/performanceLoadingUx.test.ts` now verifies
  the lazy controller setup ownership and prevents `window.google`,
  `TranslateElement`, `ensurePortalTranslateScript`, or
  `ensurePortalTranslateWidgetHost` from returning to the public catalog route
  chunk. `node frontend\tests\portalTranslateController.test.ts`,
  `node frontend\tests\performanceLoadingUx.test.ts`,
  `npm.cmd --prefix frontend run typecheck`,
  `npm.cmd --prefix frontend run check:jsx`, and
  `npm.cmd --prefix frontend run test:utils` passed.
- Build proof: production build passed. The public catalog route chunk dropped
  from the Move 803 `catalog` chunk at 121.24 kB / 35.34 kB gzip to
  120.50 kB / 35.12 kB gzip. The intent-only
  `portal-translate-controller` chunk grew from 5.51 kB to 6.59 kB because it
  now owns the external widget setup code.
- Runtime proof: Docker release `business-os:v6.0.0-202606061753` built,
  updated, and started healthy. The update created backup
  `ops/runtime/docker-release/backups/20260606-175543` before restart. Local
  route traces against the live Docker app passed with zero failed requests and
  zero relevant console/page errors: public catalog
  `ops/runtime/reports/route-load-trace-2026-06-06T09-56-31-899Z.json`
  reached ready text in 239 ms with 21 requests/16 scripts/1 API; Dashboard
  `ops/runtime/reports/route-load-trace-2026-06-06T09-56-42-676Z.json`
  reached ready text in 365 ms with 24 requests/18 scripts/2 API; Inventory
  `ops/runtime/reports/route-load-trace-2026-06-06T09-56-42-718Z.json`
  reached ready text in 400 ms with 36 requests/29 scripts/2 API; POS
  `ops/runtime/reports/route-load-trace-2026-06-06T09-56-43-612Z.json`
  reached ready text in 212 ms with 26 requests/19 scripts/2 API. The public
  catalog trace did not request `portal-translate-controller-*`,
  `lang-en-*`, or Google Translate assets in the first-window route load.
- Live proof: the full Phase 8.4 live suite passed. Broad UI report
  `ops/runtime/reports/phase84-ui-live-check-2026-06-06T09-57-04-872Z/report.json`
  checked 66 signals with no framework overlay and zero relevant console
  messages. Public Cloudflare portal report
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-06T09-57-43-322Z/report.json`
  rendered 20 products with zero failed responses, zero relevant console
  messages, zero page errors, and enforced CSP present. Post-live hygiene
  passed with loaded dataset status and zero generated-integrity matches.
- Cleanup: ignored regenerable `frontend/dist` (31,826,230 bytes) and
  `release` (380,877,976 bytes) were removed for 412,704,206 bytes reclaimed.
  Uploads, secrets, env files, databases, volumes, backups, and active Docker
  images were not touched. Generated references were refreshed and
  `npm.cmd --prefix ops run phase29:audit` passed all nine checks.
  `npm.cmd --prefix ops run prune-storage` still has the same non-data
  follow-up for locked old report log
  `ops/runtime/reports/vite-preview-appselect.log`.
- Current plan position after Move 804: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays
  at 51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, and performance guardrail. Next executable target: continue
  inspecting the public catalog/CSS and Inventory first-load helper graph
  before any broader language/runtime rewrites.

### Move 805: Skip public catalog editor draft work

- Ownership evidence: `CatalogPage.tsx` serves both the public customer portal
  and the staff editor. After Move 804, public route traces were clean, but
  source inspection showed public mode still constructed `buildDraft(...)`,
  wrote editor draft state after public bootstrap, and normalized editor draft
  fields for recommended products, about blocks, promo items, and FAQ items.
  Those drafts are staff-editor state, not customer first-paint state.
- Change: public mode now initializes `editorDraft` as an empty object, public
  bootstrap no longer calls `setEditorDraft(buildDraft(nextConfig))`, and the
  public-facing recommended/about/promo/FAQ memos read `previewConfig`
  directly unless `canEdit` is true. Staff editor behavior still uses the
  draft path.
- Guardrail proof: `frontend/tests/performanceLoadingUx.test.ts` now checks
  that public first render skips editor draft construction, that the public
  bootstrap branch does not write editor draft state, and that public
  collection memos read config instead of editor draft fields.
- Verification proof: `node frontend\tests\performanceLoadingUx.test.ts`,
  `npm.cmd --prefix frontend run typecheck`,
  `npm.cmd --prefix frontend run check:jsx`,
  `npm.cmd --prefix frontend run test:utils`, and
  `npm.cmd --prefix frontend run build` passed. The production build remains a
  CPU-path optimization rather than a chunk split: the catalog chunk is
  120.54 kB / 35.13 kB gzip.
- Runtime proof: Docker release `business-os:v6.0.0-202606061809` built,
  updated, and started healthy. The update created backup
  `ops/runtime/docker-release/backups/20260606-181051` before restart. Local
  route traces against the live Docker app passed with zero failed requests and
  zero relevant console/page errors: public catalog
  `ops/runtime/reports/route-load-trace-2026-06-06T10-11-48-622Z.json`
  reached ready text in 295 ms with 21 requests/16 scripts/1 API; Dashboard
  `ops/runtime/reports/route-load-trace-2026-06-06T10-11-49-353Z.json`
  reached ready text in 270 ms with 24 requests/18 scripts/2 API; Inventory
  `ops/runtime/reports/route-load-trace-2026-06-06T10-11-50-072Z.json`
  reached ready text in 249 ms with 36 requests/29 scripts/2 API; POS
  `ops/runtime/reports/route-load-trace-2026-06-06T10-11-50-726Z.json`
  reached ready text in 205 ms with 26 requests/19 scripts/2 API.
- Live proof: the full Phase 8.4 live suite passed. Broad UI report
  `ops/runtime/reports/phase84-ui-live-check-2026-06-06T10-12-01-061Z/report.json`
  checked 66 signals with no framework overlay and zero relevant console
  messages. Public Cloudflare portal report
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-06T10-12-39-454Z/report.json`
  rendered 20 products with zero failed responses, zero relevant console
  messages, zero page errors, and enforced CSP present. Post-live hygiene
  passed with loaded dataset status and zero generated-integrity matches.
- Cleanup: ignored regenerable `frontend/dist` (31,826,268 bytes) and
  `release` (380,877,976 bytes) were removed for 412,704,244 bytes reclaimed.
  Uploads, secrets, env files, databases, volumes, backups, and active Docker
  images were not touched. Generated references were refreshed and
  `npm.cmd --prefix ops run phase29:audit` passed all nine checks.
  `npm.cmd --prefix ops run prune-storage` still has the same non-data
  follow-up for locked old report log
  `ops/runtime/reports/vite-preview-appselect.log`.
- Current plan position after Move 805: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays
  at 51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, and performance guardrail. Next executable target: continue
  separating public catalog customer-only code from staff editor code, then
  inspect the Inventory first-load helper graph.

### Move 806: Reuse Inventory movement selection indexes

- Ownership evidence: `frontend/src/components/inventory/Inventory.tsx` still
  owns the movement tab state, movement export scope, visible movement groups,
  expanded group/page state, and selected movement groups. After Move 805,
  source inspection found the route rebuilding the same visible movement ID set
  in multiple cleanup effects and scanning `visibleMovementGroups.some(...)`
  once per expanded-page entry.
- Change: the route now builds one memoized `visibleMovementGroupIds` set from
  `visibleMovementGroups`, reuses it for expanded group cleanup, expanded page
  cleanup, and selected group cleanup, and memoizes `selectedMovementGroups`
  for movement rendering/export. This removes repeated O(n) ID-set rebuilds and
  an avoidable O(n*m) cleanup scan without changing movement UI, selection, or
  export behavior.
- Guardrail proof: `frontend/tests/performanceLoadingUx.test.ts` now asserts
  the shared `visibleMovementGroupIds` memo, verifies expanded movement pages
  use `.has(...)` on that index instead of scanning every group per entry, and
  keeps selected movement groups memoized.
- Verification proof: `node frontend\tests\performanceLoadingUx.test.ts`,
  `npm.cmd --prefix frontend run typecheck`,
  `npm.cmd --prefix frontend run check:jsx`,
  `npm.cmd --prefix frontend run test:utils`, and
  `npm.cmd --prefix frontend run build` passed.
- Runtime proof: Docker release `business-os:v6.0.0-202606070254` built,
  updated, and started healthy after backup
  `ops/runtime/docker-release/backups/20260607-025635`. Route traces against
  the live Docker app passed with zero failed requests and zero relevant
  console/page errors: Inventory
  `ops/runtime/reports/route-load-trace-2026-06-06T18-57-30-753Z.json`
  reached ready text in 513 ms with 36 requests/29 scripts/2 API; Dashboard
  `ops/runtime/reports/route-load-trace-2026-06-06T18-57-29-541Z.json`
  reached ready text in 657 ms with 24 requests/18 scripts/2 API; POS
  `ops/runtime/reports/route-load-trace-2026-06-06T18-57-30-106Z.json`
  reached ready text in 638 ms with 26 requests/19 scripts/2 API; public
  catalog `ops/runtime/reports/route-load-trace-2026-06-06T18-57-31-347Z.json`
  reached ready text in 421 ms with 21 requests/16 scripts/1 API.
- Live proof: the full Phase 8.4 live suite passed. Broad UI report
  `ops/runtime/reports/phase84-ui-live-check-2026-06-06T18-57-45-619Z/report.json`
  checked 66 signals on frontend hash `0fadf1009a3f3008`, source hash
  `9e29b055b17fc325`, with no framework overlay and zero relevant console
  messages. Public Cloudflare portal report
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-06T18-58-29-787Z/report.json`
  rendered 20 products with zero failed responses, zero page errors, zero
  relevant console messages, and enforced CSP present. Post-live hygiene passed
  with loaded dataset status and zero generated-integrity matches.
- Cleanup: ignored regenerable `frontend/dist` (31,826,258 bytes) and
  `release` (380,877,976 bytes) were removed for 412,704,234 bytes reclaimed.
  Uploads, secrets, env files, databases, volumes, backups, and the active
  Docker image were not touched. The standard `npm.cmd --prefix ops run
  prune-storage` completed successfully afterward, pruning stale retained
  reports and old `business-os:v6.0.0-*` release image tags under policy while
  preserving `business-os:latest`, the active
  `business-os:v6.0.0-202606070254` image, Docker volumes, uploads, secrets,
  env files, and backups. Generated references were refreshed and
  `npm.cmd --prefix ops run phase29:audit` passed all nine checks.
- Current plan position after Move 806: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays
  at 51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail. Next
  executable target: continue measured Inventory/Product/POS startup and
  interaction cleanup, then inspect remaining UI filter/dropdown polish and
  route-local helper splits.

### Move 807: Reuse POS cart totals and branch ids

- Ownership evidence: `frontend/src/components/pos/POS.tsx` still owns active
  cart totals, checkout branch validation, and sale payload construction.
- Change: POS now derives USD subtotal, KHR subtotal, and unique non-empty cart
  branch IDs in one memoized `cartTotals` pass over `active.cart`. Checkout
  reuses `branchesById` for inactive-branch validation and reuses
  `cartTotals.branchIds` for the sale-level branch id, instead of rebuilding a
  separate branch Set and a cart `map/filter` branch list.
- Guardrail: `frontend/tests/performanceLoadingUx.test.ts` now asserts the
  memoized cart pass exists and blocks the old separate `active.cart.reduce`
  subtotal scans plus the checkout branch `map/filter` rebuild.
- Verification: `node frontend\tests\performanceLoadingUx.test.ts`,
  `npm.cmd --prefix frontend run typecheck`,
  `npm.cmd --prefix frontend run check:jsx`,
  `npm.cmd --prefix frontend run test:utils`, and
  `npm.cmd --prefix frontend run build` passed.
- Runtime proof: Docker image `business-os:v6.0.0-202606070314` was built and
  deployed after backup `ops/runtime/docker-release/backups/20260607-032424`;
  `business-os-app-1`, worker, Postgres, Redis, and Cloudflare containers are
  healthy on that image.
- Route proof: live route traces passed with zero failed requests and zero
  console errors: POS 213 ms with 26 requests, Inventory 232 ms with 36
  requests, Dashboard 213 ms with 24 requests, and public catalog 189 ms with
  21 requests.
- Browser proof: the in-app Browser rendered `http://127.0.0.1:4000/` with no
  runtime overlay and no captured console errors, then rendered
  `http://127.0.0.1:4000/public` with 5,539 products visible, no runtime
  overlay, and no captured console errors.
- Full live proof: `npm.cmd --prefix ops run phase84:live-suite` passed. The
  broad UI check covered 66 signals with zero relevant console messages; the
  public Cloudflare portal check rendered 20 products with zero failed
  responses, zero page errors, zero relevant console messages, and enforced CSP
  present; post-live hygiene passed with loaded dataset status.
- Cleanup: ignored regenerable `frontend/dist` (31,826,331 bytes) and
  `release` (380,876,952 bytes) were removed for 412,703,283 bytes reclaimed.
  The standard `npm.cmd --prefix ops run prune-storage` then removed 326,058
  bytes of stale runtime reports, one old Docker-release backup
  `20260606-175543` (5,037,440 bytes) beyond the latest-three retention
  policy, old Docker rollback image tag `business-os:v6.0.0-202606061709`, and
  21.27 GB of Docker builder cache. Uploads, secrets, env files, databases,
  Docker volumes, latest backup sets, R2 backup `datasync-2026-06-06T18-54-10-839Z`,
  `business-os:latest`, and active image `business-os:v6.0.0-202606070314`
  were not touched.
- Current plan position after Move 807: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.
- Next safe target: use the current live route traces to choose another focused
  route-local loop, loading, or chunk reduction, then repeat source checks,
  Docker/live route proof, Browser proof, cleanup, and Phase 29 audit.

### Move 808: Reuse POS branch-stock lookup in branch filtering

- Ownership evidence: `frontend/src/components/pos/POS.tsx` still owns POS
  product filtering, branch stock visibility, stock-status filtering, and the
  route-local product list used before checkout.
- Change: the branch-filter path now finds the selected branch stock row once,
  reuses that row for both branch existence and quantity, and keeps the
  no-branch-filter path on the global `stock_quantity`. This removes the prior
  duplicated `branch_stock.find(...)` pass and the nested quantity IIFE inside
  the hot `filteredProducts` loop.
- Guardrail: `frontend/tests/performanceLoadingUx.test.ts` now verifies the
  single branch-stock lookup pattern and blocks the old branch quantity IIFE
  rescan.
- Verification: `node frontend\tests\performanceLoadingUx.test.ts`,
  `npm.cmd --prefix frontend run typecheck`,
  `npm.cmd --prefix frontend run check:jsx`,
  `npm.cmd --prefix frontend run test:utils`, and
  `npm.cmd --prefix frontend run build` passed.
- Runtime proof: Docker image `business-os:v6.0.0-202606070343` was built and
  deployed after backup `ops/runtime/docker-release/backups/20260607-035407`;
  `business-os-app-1`, workers, Postgres, Redis, and Cloudflare containers are
  healthy on that image.
- Route proof: live route traces against the Docker app passed with zero failed
  requests and zero console errors: POS 237 ms with 26 requests / 19 scripts /
  2 API, Inventory 256 ms with 36 requests / 29 scripts / 2 API, Dashboard
  225 ms with 24 requests / 18 scripts / 2 API, and public catalog 184 ms with
  21 requests / 16 scripts / 1 API.
- Browser proof: the in-app Browser rendered `http://127.0.0.1:4000/` and
  `http://127.0.0.1:4000/public` with no runtime overlay and no captured
  console warnings/errors. The public portal showed 5,539 products, and a
  no-side-effect search interaction for `AHC` kept real product cards visible
  with no `0`/no-results flash.
- Full live proof: `npm.cmd --prefix ops run phase84:live-suite` passed. The
  broad UI check covered 66 signals with zero relevant console messages; the
  public Cloudflare portal check rendered 20 products with zero failed
  responses, zero page errors, zero relevant console messages, and enforced CSP
  present; post-live hygiene passed with loaded dataset status.
- Cleanup: ignored regenerable `frontend/dist` (31,826,251 bytes) and
  `release` (380,877,976 bytes) were removed for 412,704,227 bytes reclaimed.
  The standard `npm.cmd --prefix ops run prune-storage` then removed 328,231
  bytes of stale runtime reports, one old Docker-release backup
  `20260606-181051` (5,039,476 bytes) beyond the latest-three retention
  policy, old Docker rollback image tag `business-os:v6.0.0-202606061728`, and
  613.5 MB of Docker builder cache. Uploads, secrets, env files, databases,
  Docker volumes, latest backup sets, R2 backup
  `datasync-2026-06-06T18-54-10-839Z`, `business-os:latest`, and active image
  `business-os:v6.0.0-202606070343` were not touched.
- Current plan position after Move 808: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 809: Pick POS best branch in one pass

- Ownership evidence: `frontend/src/components/pos/POS.tsx` still owns POS
  branch choice for add-to-cart flows when no explicit cart branch is selected.
- Change: `pickBestBranchId` now scans `branch_stock` once, immediately returns
  the preferred/default branch when it has positive quantity, and otherwise
  tracks the highest positive quantity without building `stockRows`, filtering,
  and sorting. The fallback still returns `defaultBranchId` or `null` when no
  positive branch stock exists.
- Guardrail: `frontend/tests/performanceLoadingUx.test.ts` now verifies the
  one-pass branch chooser and blocks the old `stockRows.sort(...)` branch-stock
  selection path.
- Verification: `node frontend\tests\performanceLoadingUx.test.ts`,
  `npm.cmd --prefix frontend run typecheck`,
  `npm.cmd --prefix frontend run check:jsx`,
  `npm.cmd --prefix frontend run test:utils`, and
  `npm.cmd --prefix frontend run build` passed. The production POS chunk is
  `assets/POS-oyl15zcb.js` at 77.23 kB / 20.03 kB gzip.
- Runtime proof: Docker image `business-os:v6.0.0-202606070408` was built and
  deployed after backup `ops/runtime/docker-release/backups/20260607-041754`;
  `business-os-app-1`, workers, Postgres, Redis, and Cloudflare containers are
  healthy on that image.
- Route proof: live route traces against the Docker app passed with zero failed
  requests and zero console errors: POS 236 ms with 26 requests / 19 scripts /
  2 API, Inventory 231 ms with 36 requests / 29 scripts / 2 API, Dashboard
  223 ms with 24 requests / 18 scripts / 2 API, and public catalog 211 ms with
  21 requests / 16 scripts / 1 API.
- Live proof: `npm.cmd --prefix ops run phase84:live-suite` passed. The broad
  UI check covered 66 signals on frontend hash `d7232f7ee0e9f429` with zero
  relevant console messages; the public Cloudflare portal check rendered 20
  products with zero failed responses, zero page errors, zero relevant console
  messages, and enforced CSP present; post-live hygiene passed with loaded
  dataset status.
- Browser/Playwright proof: the in-app Browser loaded the app surfaces but its
  virtual clipboard layer failed before typing into the public search box, so
  regular Playwright was used for the no-side-effect interaction proof. It
  opened `http://127.0.0.1:4000/public`, saw 5,539 products, typed `AHC`, and
  verified 4 real AHC products with zero console/page errors and no
  `0`/no-results flash.
- Cleanup: ignored regenerable `frontend/dist` (31,826,187 bytes) and
  `release` (380,876,952 bytes) were removed for 412,703,139 bytes reclaimed.
  The standard `npm.cmd --prefix ops run prune-storage` then removed 354,792
  bytes of stale runtime reports, one old Docker-release backup
  `20260607-025635` (5,041,511 bytes) beyond the latest-three retention
  policy, old Docker rollback image tag `business-os:v6.0.0-202606061753`, and
  613.6 MB of Docker builder cache. Uploads, secrets, env files, databases,
  Docker volumes, latest backup sets, R2 backup
  `datasync-2026-06-06T18-54-10-839Z`, `business-os:latest`, and active image
  `business-os:v6.0.0-202606070408` were not touched.
- Current plan position after Move 809: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 810: Share POS product gallery helpers

- Ownership evidence: `frontend/src/components/products/helpers/productGalleryHelpers.ts`
  already owns product gallery normalization and lightbox state for product
  surfaces; `frontend/src/components/pos/POS.tsx` duplicated JSON string and
  pipe-delimited gallery parsing inside its route component.
- Change: `normalizeProductGallery` now accepts stored gallery arrays, JSON
  array strings, and pipe-delimited strings, then trims, de-duplicates, applies
  fallback images, and enforces the existing limit in one shared path. POS now
  calls `getProductGalleryImages` and `buildProductLightboxState` instead of
  carrying a route-local parser and lightbox object builder.
- Guardrail: `frontend/tests/productGalleryHelpers.test.ts` verifies JSON
  string and pipe-delimited gallery normalization. `frontend/tests/performanceLoadingUx.test.ts`
  blocks the old POS-local `JSON.parse`/`split('|')` gallery parser and
  requires the shared helper import.
- Verification: `node frontend\tests\productGalleryHelpers.test.ts`,
  `node frontend\tests\performanceLoadingUx.test.ts`,
  `npm.cmd --prefix frontend run typecheck`,
  `npm.cmd --prefix frontend run check:jsx`,
  `npm.cmd --prefix frontend run test:utils`, and
  `npm.cmd --prefix frontend run build` passed. The production build emits
  `assets/POS-BXEuZ52k.js` at 76.75 kB / 19.91 kB gzip and
  `assets/product-shared-CpOju8rp.js` at 6.83 kB / 2.62 kB gzip.
- Runtime proof: Docker image `business-os:v6.0.0-202606070439` was built and
  deployed after backup `ops/runtime/docker-release/backups/20260607-044957`;
  `business-os-app-1`, workers, Postgres, Redis, and Cloudflare containers are
  healthy on that image.
- Route proof: live route traces against the Docker app passed with zero failed
  requests and zero console errors: POS 209 ms with 27 requests / 20 scripts /
  2 API, Inventory 247 ms with 36 requests / 29 scripts / 2 API, Dashboard
  273 ms with 24 requests / 18 scripts / 2 API, and public catalog 202 ms with
  21 requests / 16 scripts / 1 API.
- Live proof: `npm.cmd --prefix ops run phase84:live-suite` passed. The broad
  UI check covered 66 signals on frontend hash `4669a465a3229a92` with zero
  relevant console messages; the public Cloudflare portal check rendered 20
  products with zero failed responses, zero page errors, zero relevant console
  messages, and enforced CSP present; post-live hygiene passed with loaded
  dataset status.
- Browser/Playwright proof: the in-app Browser rendered
  `http://127.0.0.1:4000/public` with no runtime overlay and no captured
  console warnings/errors. Its fill bridge set the public search value but did
  not dispatch the same React input path, so regular Playwright performed the
  no-side-effect interaction proof: public catalog loaded 5,539 products,
  searching `AHC` narrowed to 4 real AHC products, and there was no
  no-results flash, console error, or page error.
- Cleanup: ignored regenerable `frontend/dist` (31,825,848 bytes) and
  `release` (380,878,488 bytes) were removed for 412,704,336 bytes reclaimed.
  The standard `npm.cmd --prefix ops run prune-storage` then removed 354,753
  bytes of stale runtime reports, one old Docker-release backup
  `20260607-032424` (5,043,546 bytes) beyond the latest-three retention
  policy, old Docker rollback image tag `business-os:v6.0.0-202606061809`, and
  613.6 MB of Docker builder cache. Uploads, secrets, env files, databases,
  Docker volumes, latest backup sets, R2 backup
  `datasync-2026-06-06T18-54-10-839Z`, `business-os:latest`, and active image
  `business-os:v6.0.0-202606070439` were not touched.
- Current plan position after Move 810: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 811: Share POS product filter option helpers

- Ownership evidence: Products already normalizes brand filter options through
  `buildProductBrandOptions` and supplier filter options through
  `buildProductSupplierOptions`. POS duplicated both paths with local
  `Set`/`sort` logic and local `product_brand_options` JSON parsing.
- Change: `frontend/src/components/pos/POS.tsx` now imports
  `buildProductBrandOptions` from `productDisplayHelpers.ts` and
  `buildProductSupplierOptions` from `productMenuHelpers.ts`. POS brand and
  supplier option memos now share the same normalization, settings merge,
  de-duplication, and sort behavior as Products.
- Guardrail: `frontend/tests/performanceLoadingUx.test.ts` now requires the
  shared POS imports and blocks reintroducing the local brand settings parser
  and supplier `Set`/sort copy.
- Verification: `node frontend\tests\performanceLoadingUx.test.ts`,
  `node frontend\tests\productDisplayHelpers.test.ts`,
  `node frontend\tests\productMenuHelpers.test.ts`,
  `npm.cmd --prefix frontend run typecheck`,
  `npm.cmd --prefix frontend run check:jsx`,
  `npm.cmd --prefix frontend run test:utils`, and
  `npm.cmd --prefix frontend run build` passed. The production build emits
  `assets/POS-B3t7A_Za.js` at 76.52 kB / 19.86 kB gzip,
  `assets/Products-iih_XeX5.js` at 88.63 kB / 23.93 kB gzip, and the shared
  `assets/productMenuHelpers-ICbChNqd.js` at 8.06 kB / 2.55 kB gzip.
- Runtime proof: Docker image `business-os:v6.0.0-202606070504` was built and
  deployed after backup `ops/runtime/docker-release/backups/20260607-051433`;
  `business-os-app-1`, workers, Postgres, Redis, and Cloudflare containers are
  healthy on that image.
- Route proof: live route traces against the Docker app passed with zero failed
  requests and zero console errors: POS 205 ms with 28 requests / 21 scripts /
  2 API, Inventory 298 ms with 36 requests / 29 scripts / 2 API, Dashboard
  218 ms with 24 requests / 18 scripts / 2 API, and public catalog 215 ms with
  21 requests / 16 scripts / 1 API.
- Live proof: `npm.cmd --prefix ops run phase84:live-suite` passed. The broad
  UI check covered 66 signals on frontend hash `a3fd08ced369f325` with zero
  relevant console messages; the public Cloudflare portal check rendered 20
  products with zero failed responses, zero page errors, zero relevant console
  messages, and enforced CSP present; post-live hygiene passed with loaded
  dataset status.
- Browser/Playwright proof: the in-app Browser rendered
  `http://127.0.0.1:4000/public` with no blank shell, no runtime overlay, and
  no captured warnings/errors. Standalone Playwright then typed `AHC` into the
  public search field and verified the list narrowed from 5,539 products to
  4 real AHC products with no no-results flash, console error, or page error.
- Cleanup: ignored regenerable `frontend/dist` (31,825,844 bytes) and
  `release` (380,878,488 bytes) were removed for 412,704,332 bytes reclaimed.
  The standard `npm.cmd --prefix ops run prune-storage` then removed 325,725
  bytes of stale runtime reports, one old Docker-release backup
  `20260607-035407` (5,045,580 bytes) beyond the latest-three retention
  policy, old Docker rollback image tag `business-os:v6.0.0-202606070254`, and
  1.269 GB of Docker builder cache. Uploads, secrets, env files, databases,
  Docker volumes, latest backup sets, R2 backup
  `datasync-2026-06-06T18-54-10-839Z`, `business-os:latest`, and active image
  `business-os:v6.0.0-202606070504` were not touched.
- Current plan position after Move 811: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 812: Share POS search-term normalization

- Ownership evidence: Products already owns comma search normalization through
  `buildProductSearchTerms` in
  `frontend/src/components/products/helpers/productFilterHelpers.ts`. POS
  duplicated the same comma split, trim, lowercase, and empty-term filtering
  inside `frontend/src/components/pos/POS.tsx`.
- Change: POS now imports `buildProductSearchTerms` and derives its deferred
  search chips from the shared helper. This keeps POS and Products aligned for
  comma-separated AND/OR search behavior while removing one more route-local
  parser from the hot product-card filtering loop.
- Guardrail: `frontend/tests/performanceLoadingUx.test.ts` now requires the
  shared POS search helper import and blocks reintroducing
  `deferredSearch.split(...)` in POS.
- Verification: `node frontend\tests\performanceLoadingUx.test.ts`,
  `node frontend\tests\productFilterHelpers.test.ts`,
  `node frontend\tests\productSearchPagination.test.ts`,
  `npm.cmd --prefix frontend run typecheck`,
  `npm.cmd --prefix frontend run check:jsx`,
  `npm.cmd --prefix frontend run test:utils`, and
  `npm.cmd --prefix frontend run build` passed. The production build emits
  `assets/POS-DHMUwrng.js` at 76.50 kB / 19.86 kB gzip,
  `assets/Products-DuBCPKqV.js` at 86.85 kB / 23.30 kB gzip, and
  `assets/product-shared-BsbHUoqf.js` at 6.83 kB / 2.62 kB gzip.
- Runtime proof: Docker image `business-os:v6.0.0-202606070530` was built and
  deployed after backup `ops/runtime/docker-release/backups/20260607-054018`;
  `business-os-app-1`, workers, Postgres, Redis, and Cloudflare containers are
  healthy on that image.
- Route proof: live route traces against the Docker app passed with zero failed
  requests and zero console errors: POS 272 ms with 29 requests / 22 scripts /
  2 API, Products 234 ms with 35 requests / 27 scripts / 2 API, Inventory
  255 ms with 36 requests / 29 scripts / 2 API, Dashboard 207 ms with 24
  requests / 18 scripts / 2 API, and public catalog 197 ms with 21 requests /
  16 scripts / 1 API.
- Live proof: `npm.cmd --prefix ops run phase84:live-suite` passed. The broad
  UI check covered 66 signals on frontend hash `0dd2009439038702` with zero
  relevant console messages; the public Cloudflare portal check rendered 20
  products with zero failed responses, zero page errors, zero relevant console
  messages, and enforced CSP present; post-live hygiene passed with loaded
  dataset status.
- Browser/Playwright proof: the in-app Browser loaded the public catalog with
  no blank shell, no runtime overlay, and zero relevant app console messages.
  A focused authenticated Playwright POS check then loaded `/pos`, typed
  `AHC, Mask`, verified the POS input retained the comma query, rendered both
  `ahc` and `mask` chips, narrowed to `1-4 / 4` real AHC mask cards, and did
  not show a no-data flash or relevant console/page error.
- Follow-up finding: the public catalog currently keeps `AHC, Mask` at the full
  `5,539 result(s)` count in the rendered UI. The backend portal search already
  accepts comma terms, so this is logged as the next public-search synchronization
  slice instead of being conflated with the POS parser cleanup.
- Cleanup: ignored regenerable `frontend/dist` (31,825,872 bytes) and
  `release` (380,875,928 bytes) were removed for 412,701,800 bytes reclaimed.
  The standard `npm.cmd --prefix ops run prune-storage` then removed 333,540
  bytes of stale runtime reports, one old Docker-release backup
  `20260607-041754` (5,047,616 bytes) beyond the latest-three retention
  policy, old Docker rollback image tag `business-os:v6.0.0-202606070314`, and
  38.4 MB of Docker builder cache. Uploads, secrets, env files, databases,
  Docker volumes, latest backup sets, R2 backup
  `datasync-2026-06-06T18-54-10-839Z`, `business-os:latest`, and active image
  `business-os:v6.0.0-202606070530` were not touched.
- Current plan position after Move 812: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 813: Share public catalog search-term normalization

- Ownership evidence: Move 812 proved the backend portal search already returns
  the correct `AHC, Mask` payload (`total=4`) while the public UI still carried
  an ad hoc `deferredSearch.toLowerCase().split(...)` parser and sent the raw
  deferred input as the portal query string.
- Change: `frontend/src/components/catalog/CatalogPage.tsx` now imports
  `buildProductSearchTerms`, derives `portalSearchTerms` from the deferred
  input, sends the stable comma-normalized `portalSearchQuery` to
  `/api/portal/catalog/products/search`, resets pagination from that normalized
  query, and uses the same terms for the client-side visible-product pass.
- Guardrail: `frontend/tests/performanceLoadingUx.test.ts` now requires the
  public catalog shared helper import, the `portalSearchTerms` and
  `portalSearchQuery` memoization, and blocks the old ad hoc
  `deferredSearch.toLowerCase().split(...)` parser.
- Verification: `node frontend\tests\performanceLoadingUx.test.ts`,
  `node frontend\tests\productFilterHelpers.test.ts`,
  `npm.cmd --prefix frontend run typecheck`,
  `npm.cmd --prefix frontend run check:jsx`,
  `npm.cmd --prefix frontend run test:utils`, and
  `npm.cmd --prefix frontend run build` passed. The production build emits
  `assets/catalog-C8_xENBV.js` at 126.96 kB / 37.33 kB gzip,
  `assets/product-shared-CxPCJhYy.js` at 6.83 kB / 2.62 kB gzip, and keeps
  `PublicCatalogRoot` small at 1.61 kB / 0.80 kB gzip.
- Runtime proof: Docker image `business-os:v6.0.0-202606070604` was built and
  deployed after backup `ops/runtime/docker-release/backups/20260607-061341`;
  `business-os-app-1`, workers, Postgres, Redis, and Cloudflare containers are
  healthy on that image.
- Live browser proof: standalone Playwright on the deployed Docker runtime
  loaded `http://127.0.0.1:4000/public` in 346 ms, typed `AHC, Mask`, observed
  the request URL `query=ahc%2Cmask`, received `total=4` and 4 items, rendered
  `4 result(s)` plus `Showing 1-4 of 4`, and reported zero relevant console
  messages or page errors.
- Live suite proof: `npm.cmd --prefix ops run phase84:live-suite` passed. The
  broad UI check covered 66 signals on frontend hash `92a899e0a7b2462c` with
  zero relevant console messages; the public Cloudflare portal check rendered
  20 products with zero failed responses, zero page errors, zero relevant
  console messages, and enforced CSP present; post-live hygiene passed with
  loaded dataset status.
- Route proof: the standard route-load trace passed with zero failed requests
  and zero console errors: Dashboard 195 ms, Inventory 209 ms, Sales 235 ms,
  and Audit Log 227 ms.
- Cleanup: ignored regenerable `frontend/dist` (31,826,528 bytes) and
  `release` (380,877,464 bytes) were removed for 412,703,992 bytes reclaimed.
  The standard `npm.cmd --prefix ops run prune-storage` then removed 299,344
  bytes of stale runtime reports, Docker-release backup `20260607-044957`
  (5,049,651 bytes) beyond the latest-three policy, old Docker rollback tag
  `business-os:v6.0.0-202606070343`, and 1.269 GB of Docker builder cache.
  Uploads, secrets, env files, databases, Docker volumes, latest backup sets,
  R2 backup `datasync-2026-06-06T18-54-10-839Z`, `business-os:latest`, and
  active image `business-os:v6.0.0-202606070604` were not touched.
- Phase 29 proof: `node ops\scripts\architecture\phase29-audit.ts` passed
  after cleanup with 9 checks and 0 failures.
- Follow-up cleared: the Move 812 public catalog comma-search synchronization
  finding is resolved for the deployed local runtime.
- Current plan position after Move 813: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 814: Harden receipt Khmer labels and image export fallback

- Ownership evidence: the receipt overlay and print utility already own the
  receipt/export surface, while the focused receipt export live check exercises
  Receipt Settings preview, Sales reprint modal, print-preview popup, and PNG
  image download. This is a Phase 8.4/Phase 29 correctness and export fallback
  hardening move, not a folder move.
- Change: `Receipt.tsx` now uses the canonical Khmer label map directly instead
  of duplicating a second Khmer label object. `printReceipt.ts` now wraps canvas
  fallback text by measured pixel width, clips item names to the name column,
  and draws Qty and Price at fixed column positions for downloaded PNG receipts.
- Guardrail proof: `receiptTemplate.test.ts` now requires real Khmer labels,
  rejects mojibake fragments, and checks the canvas wrapping/clipping fallback
  helpers. The receipt export live check rejects status rows, redundant
  `@ $...` unit-price lines, missing Name/Qty/Price headers, overflow, and
  collapsed image downloads.
- Verification proof: focused receipt tests, receipt settings sync, frontend
  typecheck, JSX/source check, full frontend utility suite, production build,
  Docker release/update, and the receipt Playwright live check passed.
- Runtime proof: `business-os:v6.0.0-202606070648` is healthy with frontend
  hash `e567678f3ad2f58d`; report:
  `ops/runtime/reports/phase84-receipt-export-layout-check-2026-06-06T22-52-27-772Z/report.json`.
- Cleanup proof: ignored regenerable `frontend/dist` (31,827,183 bytes) and
  `release` (380,878,183 bytes) were removed for 412,705,366 bytes reclaimed.
  The standard `npm.cmd --prefix ops run prune-storage` then removed 30,307
  bytes of stale runtime reports, two old Docker-release backup packages
  (10,105,392 bytes total), old Docker rollback tags
  `business-os:v6.0.0-202606070439` and
  `business-os:v6.0.0-202606070408`, and 1.269 GB of Docker builder cache.
  Uploads, secrets, env files, databases, Docker volumes, latest backup sets,
  R2 backup `datasync-2026-06-06T18-54-10-839Z`, `business-os:latest`, and
  active image `business-os:v6.0.0-202606070648` were not touched.
- Phase 29 proof: `node ops\scripts\architecture\phase29-audit.ts` passed
  after cleanup with 9 checks and 0 failures, and
  `node ops\scripts\backend\schema-audit.ts` passed with 45 static tables and
  zero relationship-doc or backup action-needed gaps.
- Current plan position after Move 814: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 815: Harden rounded filter dropdowns and live menu checks

- Ownership evidence: `frontend/src/components/shared/AppSelect.tsx` owns the
  rounded custom dropdown used by page-size and filter controls, while
  `frontend/src/components/shared/FilterMenu.tsx` already owns the compact
  expanded filter panel rows. This is a Phase 8.4/Phase 29 UI consistency and
  live-check guardrail move, not a folder move.
- Change: `AppSelect` now exposes stable `data-app-select-button` and
  `data-app-select-selected` hooks and constrains its portal menu to
  `min(18rem, 100vh - 1rem)` with overscroll containment. This keeps dropdowns
  rounded, compact, and viewport-bounded across Dashboard, Products, Inventory,
  POS, Audit Log, Library, and other shared filter surfaces.
- Source guardrail: `frontend/tests/sourceSyntaxCheck.ts` now fails if
  component source reintroduces native `<select>` controls. `frontend/tests/
  performanceLoadingUx.test.ts` requires the compact one-row `FilterMenu`
  layout, the `Back` label fallback, and the new `AppSelect` hooks/menu
  bound.
- Live-check hardening: `ops/scripts/runtime/live-checks/
  phase84-filter-menu-live-check.ts` now falls back through persisted
  Dashboard filter preferences when localized or compact range buttons do not
  expose exact English `Custom` text, then verifies the actual custom date and
  granularity controls.
- Verification proof: `node frontend\tests\sourceSyntaxCheck.ts`, `node
  frontend\tests\performanceLoadingUx.test.ts`, `npm.cmd --prefix frontend run
  typecheck`, `npm.cmd --prefix frontend run check:jsx`, `npm.cmd --prefix
  frontend run build`, `node ops\scripts\runtime\live-checks\
  phase84-filter-menu-live-check.ts`, `node ops\scripts\runtime\live-checks\
  phase84-shared-select-live-check.ts`, and `npm.cmd --prefix ops run
  phase84:route-load-trace` passed.
- Runtime proof: Docker image `business-os:v6.0.0-202606070725` was built,
  deployed, and reported healthy on `http://127.0.0.1:4000/health` with
  frontend hash `c36ea69af92f848f`. The route-load trace reported Dashboard
  245 ms, Inventory 243 ms, Sales 183 ms, and Audit Log 167 ms with zero
  failed requests and zero console errors.
- Browser proof: the in-app browser signed in through the real local UI,
  opened Products, and opened the page-size dropdown. It saw options `20`,
  `50`, and `100`, a `16.8px` rounded custom menu, `288px` max height, zero
  native selects, and no framework overlay.
- Cleanup proof: ignored regenerable `frontend/dist` (31,827,380 bytes) and
  `release` (380,878,695 bytes) were removed for 412,706,075 bytes reclaimed.
  The standard prune removed 306,905 bytes of stale runtime reports,
  Docker-release backup `20260607-061341` (5,056,608 bytes), old Docker tags
  `business-os:v6.0.0-202606070530` and
  `business-os:v6.0.0-202606070504`, and 2.5 GB of Docker builder cache while
  preserving uploads, secrets, env files, databases, Docker volumes, latest
  backup sets, the latest R2 backup, `business-os:latest`, and active image
  `business-os:v6.0.0-202606070725`.
- Phase 29 proof: `node ops\scripts\architecture\phase29-audit.ts` passed with
  9 checks and 0 failures after cleanup, and `node ops\scripts\backend\
  schema-audit.ts` passed with 45 static tables and zero relationship-doc or
  backup action-needed gaps.
- Current plan position after Move 815: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 816: Compact public portal mobile loading and contact tray

- Ownership slice: public portal mobile UX and Phase 8.4 live-check coverage.
  `CatalogSecondaryTabs.tsx` now marks and compacts the About hero/contact tray
  so phone, address, and social actions occupy less vertical space on smaller
  screens without changing desktop layout ownership.
- Loading slice: `CatalogPage.tsx` now renders a tab-specific compact fallback
  for lazy secondary public portal tabs instead of the large generic
  `Loading customer portal...` panel. This keeps public Products, FAQ,
  Membership, and Beauty Assistant transitions visually stable on mobile.
- Guardrail slice: `portalCatalogDisplay.test.ts` now checks the About hero
  hook, contact tray hook, mobile minimum-height rule, and compact secondary
  loading fallback. The public Cloudflare check now verifies mobile hero/tray
  size, horizontal overflow, Assistant readiness, and no final generic loading
  panel.
- Verification proof: `node frontend\tests\portalCatalogDisplay.test.ts`,
  `node frontend\tests\performanceLoadingUx.test.ts`, `npm.cmd --prefix
  frontend run typecheck`, `npm.cmd --prefix frontend run check:jsx`,
  `npm.cmd --prefix frontend run build`, Docker release/update,
  `node ops\scripts\runtime\live-checks\phase84-public-portal-cloudflare-check.ts`,
  `npm.cmd --prefix ops run phase84:route-load-trace`,
  `npm.cmd --prefix ops run prune-storage`,
  `node ops\scripts\architecture\phase29-audit.ts`, and
  `node ops\scripts\backend\schema-audit.ts` passed.
- Runtime proof: Docker image `business-os:v6.0.0-202606070759` was built,
  deployed, and reported healthy on `http://127.0.0.1:4000/health` with
  frontend hash `8d3cdc06c5e7b390`. Public portal proof:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-07T00-02-46-596Z/report.json`.
- Cleanup proof: ignored regenerable `frontend/dist` (31,828,646 bytes) and
  `release` (380,875,107 bytes) were removed for 412,703,753 bytes reclaimed.
  The standard prune removed stale reports, two old Docker-release backups, old
  Docker rollback tags, and 2.538 GB of Docker builder cache while preserving
  uploads, secrets, env files, databases, Docker volumes, latest backup sets,
  the latest R2 backup, `business-os:latest`, and active image
  `business-os:v6.0.0-202606070759`.
- Current plan position after Move 816: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 817: Strengthen all-pages live-control audit coverage

- Ownership slice: Phase 8.4 live audit infrastructure only. No app route,
  data, schema, Docker image, or runtime path changed in this move.
- Test strategy slice: `all-pages-control-audit.ts` now reloads the current
  route after each safe button click so tab/panel controls are tested
  independently instead of being marked hidden after an earlier interaction.
- Safety slice: mutating, file/media, print/download, external delivery, and
  settings-toggle controls are still classified before the long-label guard and
  remain in the seeded rollback backlog. Safe sentence-length buttons can be
  tested up to the configurable `BOS_ALL_PAGES_MAX_BUTTON_LABEL_LENGTH`
  threshold, defaulting to 96 characters.
- Verification proof: `npm.cmd --prefix ops run phase84:all-pages-control-audit
  -- --route receipt_settings --route loyalty_points` passed with 4 routes, 27
  tested controls, and 0 findings. `npm.cmd --prefix ops run
  phase84:all-pages-control-audit` then passed with 34 routes, 398 tested
  controls, 56 guarded skips, 0 failed controls, 0 findings, and 68
  screenshots.
- Current plan position after Move 817: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 818: Add rollback-safe Loyalty Points save coverage

- Ownership slice: Phase 8.4 rollback-sensitive live coverage. The new
  `ops/scripts/runtime/live-checks/phase84-loyalty-points-rollback-check.ts`
  covers Loyalty Points settings save without leaving persistent test data.
- Safety slice: the check snapshots the loyalty point-rule settings, changes
  the earning basis through the UI, clicks Save, verifies the expected settings
  through `/api/settings`, and restores the exact snapshot in a `finally` block.
- Suite slice: `phase84-live-suite.ts` now includes Receipt Settings rollback
  and Loyalty Points rollback by default, with a shared `--skip-rollback` flag
  for faster explicit runs. `ops/package.json` exposes
  `phase84:loyalty-points-rollback`.
- Verification proof: `npm.cmd --prefix ops run
  phase84:loyalty-points-rollback` passed, and the expanded
  `npm.cmd --prefix ops run phase84:live-suite` passed all five default steps:
  broad UI, public portal, receipt rollback, loyalty rollback, and post-live
  hygiene.
- Current plan position after Move 818: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 819: Add rollback-safe Settings save coverage

- Ownership slice: Phase 8.4 rollback-sensitive live coverage for the Settings
  page Save action. The new
  `ops/scripts/runtime/live-checks/phase84-settings-save-rollback-check.ts`
  covers a real Settings save without leaving persistent test data.
- Safety slice: the check snapshots `business_name`, changes the Settings form
  through the UI, clicks Save, verifies `/api/settings`, and restores the
  original value in a `finally` block.
- Suite slice: `phase84-live-suite.ts` now includes the Settings save rollback
  check in the default rollback group, and `ops/package.json` exposes
  `phase84:settings-save-rollback`.
- Verification proof: `npm.cmd --prefix ops run
  phase84:settings-save-rollback` passed, and the expanded
  `npm.cmd --prefix ops run phase84:live-suite` passed all six default steps:
  broad UI, public portal, receipt rollback, loyalty rollback, settings
  rollback, and post-live hygiene.
- Current plan position after Move 819: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 820: Route legacy Settings API calls through typed transport

- Ownership slice: Phase 29 TypeScript/code-flow cleanup and Phase 8.4
  settings-save stability. `frontend/src/api/settingsTransport.ts` is now the
  single implementation owner for Settings reads and writes.
- Code-flow slice: `frontend/src/api/methods.ts` lazy-loads the typed settings
  transport for `getSettings` and `saveSettings` instead of carrying duplicate
  untyped conflict retry, inline `updatedAt`, local mirror, and refresh-channel
  logic.
- Guardrail slice: `frontend/tests/performanceLoadingUx.test.ts` now verifies
  that the settings transport owns `/api/settings`, the legacy registry
  lazy-loads that transport, the registry does not duplicate the settings read
  implementation, and `/api/settings/meta` is not reintroduced.
- Verification proof: `node frontend\tests\performanceLoadingUx.test.ts`,
  `npm.cmd --prefix frontend run typecheck`, `npm.cmd --prefix frontend run
  check:jsx`, `npm.cmd --prefix frontend run build`, and `npm.cmd --prefix ops
  run phase84:settings-save-rollback` passed.
- Current plan position after Move 820: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 821: Route offline snapshot refresh through typed transport

- Ownership slice: Phase 29 TypeScript/code-flow cleanup. The focused
  `frontend/src/api/offlineSnapshotTransport.ts` is now the single
  implementation owner for offline device snapshot refresh.
- Code-flow slice: `frontend/src/api/methods.ts` lazy-loads the offline
  snapshot transport for `refreshOfflineDeviceSnapshot` instead of carrying
  duplicate untyped server/session guards, snapshot metadata persistence,
  five-minute throttling, and local mirror refresh steps.
- Guardrail slice: `frontend/tests/offlineSalesQueue.test.ts` now verifies the
  legacy registry is only a compatibility facade and that the typed transport
  owns the snapshot metadata key, settings/products/branches/sales/returns
  refresh steps, and inventory movement snapshot request.
- Verification proof: `node frontend\tests\offlineSalesQueue.test.ts`, `node
  frontend\tests\performanceLoadingUx.test.ts`, `node
  frontend\tests\apiHttp.test.ts`, `node
  frontend\tests\offlineSecurityHardening.test.ts`, the full frontend utility
  suite, frontend production build, Phase 29 audit, storage prune, local health
  check, and `npm.cmd --prefix ops run phase84:live-suite -- --skip-rollback`
  passed. The production build split `offline-snapshot-api` to a 2.67 KB chunk
  and reduced `app-api-methods` to 28.85 KB.
- Current plan position after Move 821: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 822: Route legacy return APIs through typed transport

- Ownership slice: Phase 29 TypeScript/code-flow cleanup. The focused
  `frontend/src/api/returnsTransport.ts` now owns the full return API surface:
  list, detail, customer return creation, supplier return creation, and return
  updates.
- Code-flow slice: `frontend/src/api/methods.ts` lazy-loads the typed return
  transport for `getReturns`, `getReturn`, `createReturn`,
  `createSupplierReturn`, and `updateReturn` instead of carrying duplicate
  route, local mirror, request-id, expected-updated-at, and conflict-attempt
  logic.
- Guardrail slice: `frontend/tests/apiHttp.test.ts` and
  `frontend/tests/actionStability.test.ts` now verify that return query
  building, mirror ownership, encoded IDs, client request IDs, and attempted
  conflict payloads live in the typed transport while the legacy registry is
  only a facade.
- Verification proof: `node frontend\tests\apiHttp.test.ts`, `node
  frontend\tests\actionStability.test.ts`, `node
  frontend\tests\performanceLoadingUx.test.ts`, the full frontend utility
  suite, frontend production build, Phase 29 audit, storage prune, and
  `npm.cmd --prefix ops run phase84:live-suite -- --skip-rollback` passed. The
  production build emitted `returns-api` as a 1.93 KB chunk and reduced
  `app-api-methods` to 27.90 KB. The storage prune removed 267,804 bytes of
  stale retained reports.
- Current plan position after Move 822: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 823: Route legacy sales status and export APIs through typed transport

- Ownership slice: Phase 29 TypeScript/code-flow cleanup. The focused
  `frontend/src/api/salesTransport.ts` now owns sales status updates, sales
  customer attachment, and sales export reads.
- Code-flow slice: `frontend/src/api/methods.ts` lazy-loads the typed sales
  transport for `updateSaleStatus`, `attachSaleCustomer`, and `getSalesExport`
  instead of carrying duplicate mutation/export route, expected-updated-at,
  local sales update, and conflict-attempt logic.
- Guardrail slice: `frontend/tests/apiHttp.test.ts` now verifies that encoded
  sale IDs, expected `updated_at` guards, device metadata, local sales row
  updates, export query construction, and attempted conflict metadata live in
  the typed transport while the legacy registry is only a facade.
- Verification proof: `node frontend\tests\apiHttp.test.ts`, `node
  frontend\tests\actionStability.test.ts`, `node
  frontend\tests\performanceLoadingUx.test.ts`, the full frontend utility
  suite, and frontend production build passed. The production build emitted the
  sales transport chunk at 2.40 KB and reduced `app-api-methods` to 26.58 KB.
- Current plan position after Move 823: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 824: Route pending sync queue APIs through typed transport

- Ownership slice: Phase 29 TypeScript/code-flow cleanup. The focused
  `frontend/src/api/pendingSyncTransport.ts` now owns pending sync queue reads,
  queue discard, and manual retry delegation.
- Code-flow slice: `frontend/src/api/methods.ts` lazy-loads the typed pending
  sync transport for `getPendingSyncState`, `discardPendingSyncQueue`, and
  `retryPendingSyncNow` instead of carrying local DB, sync preview, sync
  runtime, and retry implementation details.
- Build slice: `frontend/vite.config.ts` gives the pending sync transport a
  named `pending-sync-api` intent chunk and excludes it from eager module
  preload.
- Guardrail slice: `frontend/tests/apiHttp.test.ts`,
  `frontend/tests/offlineSalesQueue.test.ts`, and
  `frontend/tests/performanceLoadingUx.test.ts` verify that queue Dexie
  reads/clears, compact preview serialization, queue events, discard update
  broadcasts, and retry delegation live in the typed transport while the legacy
  registry is only a facade.
- Verification proof: `node frontend\tests\apiHttp.test.ts`, `node
  frontend\tests\offlineSalesQueue.test.ts`, `node
  frontend\tests\performanceLoadingUx.test.ts`, standalone frontend typecheck,
  the full frontend utility suite, and frontend production build passed. The
  Phase 29 audit, storage prune, local health check, and `npm.cmd --prefix ops
  run phase84:live-suite -- --skip-rollback` also passed. The production build
  emitted `pending-sync-api` at 1.66 KB and reduced `app-api-methods` to 25.07
  KB. The storage prune removed 238,300 bytes of stale retained reports.
- Current plan position after Move 824: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 825: Lazy-load Google Drive sync APIs through typed transport

- Ownership slice: Phase 29 TypeScript/code-flow cleanup. The focused
  `frontend/src/api/driveSync.ts` transport now remains the sole owner for
  Google Drive sync status, preference save, OAuth start, disconnect,
  credential-forget, queued sync, and immediate sync route calls.
- Code-flow slice: `frontend/src/api/methods.ts` lazy-loads the Drive sync
  transport for `getGoogleDriveSyncStatus`, `saveGoogleDriveSyncPreferences`,
  `startGoogleDriveSyncOauth`, `disconnectGoogleDriveSync`,
  `forgetGoogleDriveSyncCredentials`, `queueGoogleDriveSyncNow`, and
  `syncGoogleDriveNow` instead of statically importing the focused transport
  during startup.
- Build slice: `frontend/vite.config.ts` gives the Drive sync transport a
  named `drive-sync-api` intent chunk and excludes it from eager module
  preload.
- Guardrail slice: `frontend/tests/apiHttp.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`, and
  `frontend/tests/backupJobs.test.ts` verify that Drive status cooldown
  fallback, in-flight request reuse, queue-now behavior, and backup-page job
  flows stay in the focused transport while the legacy registry is only a lazy
  facade.
- Verification proof: `node frontend\tests\apiHttp.test.ts`, `node
  frontend\tests\performanceLoadingUx.test.ts`, `node
  frontend\tests\backupJobs.test.ts`, standalone frontend typecheck, the full
  frontend utility suite, frontend production build, generated reference
  refresh, Phase 29 audit, storage prune, local health check, and
  `npm.cmd --prefix ops run phase84:live-suite -- --skip-rollback` passed. The
  production build emitted `drive-sync-api` at 1.82 KB and reduced
  `app-api-methods` to 24.31 KB. The storage prune removed 137,941 bytes of
  stale retained reports.
- Current plan position after Move 825: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 826: Lazy-load notification summary through focused transport

- Ownership slice: Phase 29 TypeScript/code-flow cleanup. The focused
  `frontend/src/api/notificationSummary.ts` transport remains the sole owner
  for notification summary reads, transient-gateway fallback, 404/missing
  cooldown, fallback payloads, and in-flight request reuse.
- Code-flow slice: `frontend/src/api/methods.ts` lazy-loads the notification
  summary transport for `getNotificationSummary` instead of statically
  importing that fallback-heavy path during registry startup.
- Build slice: `frontend/vite.config.ts` already keeps notification summary
  code in the named `notification-api` chunk; this move also excludes that
  chunk from eager module preload so it loads only on notification intent.
- Guardrail slice: `frontend/tests/apiHttp.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`, and
  `frontend/tests/notificationBadge.test.ts` verify that the legacy registry is
  only a lazy facade while the focused transport owns cooldown and fallback
  behavior.
- Verification proof: `node frontend\tests\apiHttp.test.ts`, `node
  frontend\tests\performanceLoadingUx.test.ts`, `node
  frontend\tests\notificationBadge.test.ts`, standalone frontend typecheck,
  the full frontend utility suite, frontend production build, generated
  reference refresh, Phase 29 audit, storage prune, local health check, and
  `npm.cmd --prefix ops run phase84:live-suite -- --skip-rollback` passed. The
  production build emitted `notification-api` at 1.63 KB and kept
  `app-api-methods` at 24.39 KB while removing the static notification summary
  import from the legacy registry. The storage prune removed 89,315 bytes of
  stale retained reports.
- Current plan position after Move 826: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 827: Lazy-load system jobs and backup queue APIs

- Ownership slice: Phase 29 TypeScript/code-flow cleanup. The focused
  `frontend/src/api/systemJobs.ts` transport remains the sole owner for system
  job reads, cancel requests, polling loops, backup export queueing, and backup
  restore queueing.
- Code-flow slice: `frontend/src/api/methods.ts` lazy-loads the system jobs
  transport for `getSystemJob`, `cancelSystemJob`, `pollSystemJob`,
  `queueBackupFolderExport`, and `queueBackupFolderRestore`; the legacy
  `exportBackupFolder` and `importBackupFolder` compatibility names continue
  to delegate through the queued APIs.
- Build slice: `frontend/vite.config.ts` gives system jobs a named
  `system-jobs-api` intent chunk and excludes it from eager module preload.
- Guardrail slice: `frontend/tests/apiHttp.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`, and
  `frontend/tests/backupJobs.test.ts` verify that polling, queued backup job
  flows, and Backup page status/cancel behavior remain on the focused
  transport while the legacy registry is only a lazy facade.
- Verification proof: `node frontend\tests\apiHttp.test.ts`, `node
  frontend\tests\performanceLoadingUx.test.ts`, `node
  frontend\tests\backupJobs.test.ts`, standalone frontend typecheck, the full
  frontend utility suite, frontend production build, generated reference
  refresh, Phase 29 audit, storage prune, local health check, and
  `npm.cmd --prefix ops run phase84:live-suite -- --skip-rollback` passed. The
  production build emitted `system-jobs-api` at 1.48 KB and reduced
  `app-api-methods` to 23.51 KB. The storage prune removed 89,157 bytes of
  stale retained reports.
- Current plan position after Move 827: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 828: Lazy-load legacy product/read lookup and admin data transports

- Ownership slice: Phase 29 TypeScript/code-flow cleanup. The focused product,
  lookup, access-control, custom-table, query-cache, and local-mirror modules
  remain the behavior owners while `frontend/src/api/methods.ts` becomes a
  lazy facade for the older `window.api` compatibility surface.
- Code-flow slice: product read wrappers (`getProducts`, `searchProducts`,
  `getProductBootstrap`, `getProductsByIds`, `getProductFilters`,
  `getProductLookupUsage`, `replaceProductLookupValues`), category/unit lookup
  wrappers, Users/Roles wrappers, custom-table wrappers, sync-update cache
  cleanup, and delayed sensitive mirror purge now resolve memoized dynamic
  modules only when those flows are used.
- Build slice: `frontend/vite.config.ts` gave access-control and custom-table
  operations named access-control and `custom-tables-api` chunks and
  excludes them from eager module preload. The existing `product-read-api`
  chunk stays the focused product/lookup/mirror/cache owner instead of being
  statically imported by `app-api-methods`.
- Guardrail slice: `frontend/tests/apiHttp.test.ts` and
  `frontend/tests/performanceLoadingUx.test.ts` verify no static imports from
  product read, lookup, access-control, custom-table, query-cache, or
  local-mirror modules remain in the legacy registry, while the focused
  transports still own their route/mirror/expected-update behavior.
- Verification proof: `node frontend\tests\apiHttp.test.ts`, `node
  frontend\tests\performanceLoadingUx.test.ts`, standalone frontend typecheck,
  the full frontend utility suite, frontend production build, generated
  reference refresh, Phase 29 audit, schema audit, organization audit, storage
  prune, local health check, and `npm.cmd --prefix ops run phase84:live-suite
  -- --skip-rollback` passed. The production build emitted
  the then-current access-control chunk at 2.07 KB, `custom-tables-api` at 1.28 KB, retained
  `product-read-api` as a 7.00 KB lazy dependency, and reduced
  `app-api-methods` from 23.51 KB to 23.26 KB. Inspection of the emitted
  `app-api-methods-*.js` confirmed no static `import ... from
  "./product-read-api"` remains; `product-read-api` only appears in the dynamic
  dependency map for lazy calls. The live suite checked 66 UI signals with zero
  relevant console messages, rendered 20 public portal products with zero
  failed responses, and passed post-live hygiene. The storage prune removed 0
  bytes because all retention targets were already within policy.
- Current plan position after Move 828: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 829: Lazy-load legacy branch and inventory read transports

- Ownership slice: Phase 29 TypeScript/code-flow cleanup. The focused
  `frontend/src/api/branchTransport.ts` and
  `frontend/src/api/inventoryTransport.ts` modules remain the behavior owners
  while `frontend/src/api/methods.ts` becomes a lazy facade for the older
  `window.api` compatibility surface.
- Code-flow slice: branch wrappers (`getBranches`, `getBranchSummary`,
  `createBranch`, `updateBranch`, `deleteBranch`, `getBranchStock`,
  `getTransfers`, `transferStock`, `getBranchStockIntegrity`,
  `repairBranchStockIntegrity`) and inventory read wrappers
  (`getInventorySummary`, `getInventoryStats`, `getInventoryBootstrap`,
  `searchInventoryProducts`, `getInventoryMovements`, `getInventoryReasons`)
  now resolve memoized dynamic modules only when those flows are used.
- Build slice: the existing `branch-api` and `inventory-api` chunks stay
  excluded from eager module preload. The production build emitted
  `branch-api` at 1.96 KB and `inventory-api` at 1.55 KB; compiled
  `app-api-methods` no longer has static imports for either transport and only
  references them through dynamic calls. The compatibility facade grew from
  23.26 KB to 23.84 KB, but it now avoids automatic branch/inventory transport
  request and evaluation on legacy API registry load.
- Guardrail slice: `frontend/tests/apiHttp.test.ts` and
  `frontend/tests/performanceLoadingUx.test.ts` verify no static imports from
  branch or inventory transports remain in the legacy registry, while the
  focused transports still own branch mirror/expected-update behavior,
  inventory bootstrap/search cache behavior, and user-filtered movement reads.
- Verification proof: `node frontend\tests\apiHttp.test.ts`, `node
  frontend\tests\performanceLoadingUx.test.ts`, standalone frontend typecheck,
  the full frontend utility suite, frontend production build, storage prune,
  local health check, and `npm.cmd --prefix ops run phase84:live-suite --
  --skip-rollback` passed. The live suite checked 66 UI signals with zero
  relevant console messages, rendered 20 public portal products with zero
  failed responses, and passed post-live hygiene. The storage prune removed
  321,689 bytes of stale retained report directories while preserving uploads,
  secrets, env files, Docker volumes, active images, and newest backup sets.
- Current plan position after Move 829: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 830: Lazy-load legacy auth and organization helpers

- Ownership slice: Phase 29 TypeScript/code-flow cleanup. The focused
  `frontend/src/api/authTransport.ts` module remains the behavior owner while
  `frontend/src/api/methods.ts` becomes a lazy facade for the older `window.api`
  compatibility surface.
- Code-flow slice: auth wrappers (`login`, `logout`,
  `resetPasswordWithOtp`, `requestPasswordResetEmail`,
  `completePasswordReset`, `updateSessionDuration`,
  `getVerificationCapabilities`), organization wrappers
  (`getOrganizationBootstrap`, `searchOrganizations`,
  `getCurrentOrganization`), Google OAuth wrappers (`startGoogleOauth`,
  `completeGoogleOauth`, `unlinkGoogleOauth`), and OTP wrappers
  (`otpSetup`, `otpConfirm`, `otpDisable`, `otpVerify`, `otpStatus`) now
  resolve the memoized auth module only when those flows are used.
- Build slice: the existing `app-auth` chunk stays excluded from eager module
  preload. The production build emitted `app-auth` at 1.96 KB; compiled
  `app-api-methods` no longer has a static source import for
  `authTransport.ts` and references the emitted auth chunk only through Vite's
  dynamic import dependency map. The compatibility facade grew from 23.84 KB to
  24.39 KB because of the lazy wrapper metadata, but it now avoids automatic
  auth transport request and evaluation on legacy API registry load.
- Guardrail slice: `frontend/tests/apiHttp.test.ts` and
  `frontend/tests/performanceLoadingUx.test.ts` verify no static import from
  the auth transport remains in the legacy registry while focused auth tests
  keep login, device fingerprinting, organization bootstrap/search, OAuth, and
  OTP behavior anchored in `authTransport.ts`.
- Verification proof: `node frontend\tests\apiHttp.test.ts`, `node
  frontend\tests\performanceLoadingUx.test.ts`, standalone frontend typecheck,
  the full frontend utility suite, frontend production build, storage prune,
  local health check, and `npm.cmd --prefix ops run phase84:live-suite --
  --skip-rollback` passed. The live suite checked 66 UI signals with zero
  relevant console messages, rendered 20 public portal products with zero
  failed responses, and passed post-live hygiene. The storage prune removed 0
  bytes because all retention targets were already within policy.
- Current plan position after Move 830: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 831: Lazy-load legacy runtime reset and lookup refresh utilities

- Ownership slice: Phase 29 TypeScript/code-flow cleanup. The legacy
  `frontend/src/api/methods.ts` registry no longer statically imports
  `clientRuntime.ts`, `appRefresh.ts`, or `settingsRefresh.ts`; reset/runtime
  invalidation and lookup-refresh dispatch stay behind focused lazy helpers.
- Code-flow slice: reset/data-path invalidation now resolves
  `resetClientRuntimeState` through `loadClientRuntimeModule()` only when a
  reset-like flow runs. Category and unit mutations now resolve
  `refreshAppData` through `loadAppRefreshModule()` only after the write
  succeeds, while local category/unit channel lists preserve the same refresh
  behavior without pulling the settings refresh rules into registry load.
- Build slice: the production build emitted `settings-refresh` at 1.45 KB as a
  deferred dependency; compiled `app-api-methods` references the helper chunk
  only through Vite's dynamic import dependency map. The compatibility facade
  grew from 24.39 KB to 24.80 KB because of the final lazy wrapper metadata,
  but the runtime reset and refresh helper code is no longer evaluated on
  legacy API registry load.
- Guardrail slice: `frontend/tests/apiHttp.test.ts` and
  `frontend/tests/performanceLoadingUx.test.ts` now verify the legacy registry
  does not statically import runtime reset, app refresh, or settings refresh
  helpers, and that lookup writes still dispatch refresh events through the
  lazy helper.
- Verification proof: `node frontend\tests\apiHttp.test.ts`, `node
  frontend\tests\performanceLoadingUx.test.ts`, standalone frontend typecheck,
  the full frontend utility suite, frontend production build, storage prune,
  local health check, and `npm.cmd --prefix ops run phase84:live-suite --
  --skip-rollback` passed. The live suite checked 66 UI signals with zero
  relevant console messages, rendered 20 public portal products with zero
  failed responses, and passed post-live hygiene. The storage prune removed
  321,164 bytes of stale retained report directories while preserving uploads,
  secrets, env files, Docker volumes, active images, and newest backup sets.
- Current plan position after Move 831: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 832: Split legacy sync-server HTTP state from HTTP core

- Ownership slice: Phase 29 TypeScript/code-flow cleanup. The tiny sync-server
  URL/token state now lives in `frontend/src/api/httpState.ts` while
  `frontend/src/api/http.ts` keeps owning fetch, health, cache, fallback, and
  route behavior.
- Code-flow slice: `frontend/src/api/methods.ts` imports only
  `getSyncServerUrl()` from the tiny state module for synchronous compatibility
  reads. Reset/data-path/factory-reset flows lazy-load `http.ts` through
  `loadHttpCoreModule()` only when `cacheClearAll()` is actually needed.
- Build slice: `frontend/vite.config.ts` gives `httpState.ts` the
  `api-http-state` chunk and excludes it from eager module preload. Production
  build proof emitted `api-http-state` at 0.18 KB, `api-http-core` at 21.90 KB,
  and `app-api-methods` at 25.00 KB. The previous circular chunk warning is
  gone; compiled `app-api-methods` statically imports only the state chunk and
  keeps `api-http-core` behind Vite's dynamic dependency map for reset-like
  flows.
- Guardrail slice: `frontend/tests/apiHttp.test.ts` and
  `frontend/tests/performanceLoadingUx.test.ts` verify the legacy registry does
  not statically import `http.ts`, does import `httpState.ts`, lazy-loads the
  HTTP core for cache clears, and keeps the state helper in a named tiny chunk.
- Verification proof: `node frontend\tests\apiHttp.test.ts`, `node
  frontend\tests\performanceLoadingUx.test.ts`, standalone frontend typecheck,
  the full frontend utility suite, frontend production build, storage prune,
  local health check, and `npm.cmd --prefix ops run phase84:live-suite --
  --skip-rollback` passed. The live suite checked 66 UI signals with zero
  relevant console messages, rendered 20 public portal products with zero
  failed responses or page errors, and passed post-live hygiene. The storage
  prune removed 321,475 bytes of stale retained report directories while
  preserving uploads, secrets, env files, Docker volumes, active images, newest
  local backup sets, and the newest R2 backup.
- Current plan position after Move 832: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 833: Remove duplicate legacy reset cache clears

- Ownership slice: Phase 29 TypeScript/code-flow cleanup. The shared
  `invalidateClientRuntimeState()` helper remains the single owner for legacy
  reset runtime invalidation, HTTP cache clearing, and runtime sync events.
- Code-flow slice: `resetData()` and `factoryReset()` no longer call
  `loadHttpCoreModule()` and `cacheClearAll()` after
  `invalidateClientRuntimeState()` has already completed the same cache clear.
  This keeps reset behavior intact while avoiding one duplicate async module
  lookup and one duplicate in-memory cache walk per reset/factory-reset intent.
- Guardrail slice: `frontend/tests/apiHttp.test.ts` and
  `frontend/tests/performanceLoadingUx.test.ts` now reject reset/factory-reset
  wrappers that re-clear the HTTP cache after runtime invalidation.
- Build slice: production build emitted `api-http-state` at 0.18 KB,
  `api-http-core` at 21.90 KB, and reduced `app-api-methods` from 25.00 KB to
  24.93 KB.
- Verification proof: `node frontend\tests\apiHttp.test.ts`, `node
  frontend\tests\performanceLoadingUx.test.ts`, standalone frontend typecheck,
  the full frontend utility suite, frontend production build, storage prune,
  local health check, and `npm.cmd --prefix ops run phase84:live-suite --
  --skip-rollback` passed. The live suite checked 66 UI signals with zero
  relevant console messages, rendered 20 public portal products with zero
  failed responses or page errors, and passed post-live hygiene. The storage
  prune removed 321,343 bytes of stale retained report directories while
  preserving uploads, secrets, env files, Docker volumes, active images, newest
  local backup sets, and the newest R2 backup.
- Current plan position after Move 833: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 834: Split legacy product image upload from file transport

- Ownership slice: Phase 29 TypeScript/code-flow cleanup. Product image upload
  intent is now owned only by `frontend/src/api/productImageUploadTransport.ts`;
  `frontend/src/api/fileTransport.ts` remains focused on library file reads,
  file asset upload/delete, and avatar upload.
- Code-flow slice: the legacy `window.api.uploadProductImage` compatibility
  wrapper in `frontend/src/api/methods.ts` now lazy-loads
  `productImageUploadTransport.ts` instead of waking `fileTransport.ts`. The
  duplicate product image `FormData` endpoint logic was removed from
  `fileTransport.ts`, so product upload no longer rides along with the Library
  file API chunk.
- Preload slice: `frontend/vite.config.ts` keeps the
  `product-image-upload-api` manual chunk and now excludes that upload-only
  chunk from eager modulepreload.
- Guardrail slice: `frontend/tests/apiHttp.test.ts` and
  `frontend/tests/performanceLoadingUx.test.ts` now reject product-image upload
  endpoint logic inside `fileTransport.ts`, require the legacy wrapper to use
  `loadProductImageUploadTransport()`, and require the product image upload
  chunk to stay out of eager modulepreload.
- Build slice: production build emitted `file-api` at 3.70 KB,
  `product-image-upload-api` at 1.29 KB, `api-http-core` at 21.90 KB,
  `api-http-state` at 0.18 KB, and `app-api-methods` at 25.05 KB. Built
  `index.html` has no eager preload entry for `file-api`,
  `product-image-upload-api`, or `app-api-methods`.
- Verification proof: focused API and performance tests, standalone frontend
  typecheck, JSX/source check, full frontend utility suite, frontend production
  build, backend utility suite, schema audit, organization audit, storage
  prune, local health check, and `npm.cmd --prefix ops run phase84:live-suite
  -- --skip-rollback` passed. The in-app Browser path was attempted first but
  remains blocked locally by the kernel asset path error, so repo Playwright
  live checks supplied browser proof: 66 UI signals, zero relevant console
  messages, 20 public portal products, zero failed responses/page errors, and
  post-live hygiene passed. Storage prune removed 643,340 bytes of stale
  retained reports while preserving uploads, secrets, env files, Docker
  volumes, active images, newest local backup sets, and the newest R2 backup.
- Current plan position after Move 834: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 835: Retire legacy access-control transport

- Ownership slice: Phase 29 TypeScript/code-flow cleanup. User list reads are
  now owned by `frontend/src/api/userReadTransport.ts`; user profile,
  authentication-method, password, role, and permission-management operations
  are owned by `frontend/src/api/userAdminTransport.ts`.
- Code-flow slice: the legacy `window.api.getUsers` compatibility wrapper in
  `frontend/src/api/methods.ts` lazy-loads the narrow user-read transport.
  Profile, password, and role wrappers lazy-load the user-admin transport. The
  obsolete combined access-control wrapper was deleted instead of carrying a
  third compatibility layer.
- Preload slice: `frontend/vite.config.ts` no longer emits a named
  access-control chunk. Production build proof emitted `user-read-api` at
  0.91 KB, `user-admin-api` at 2.54 KB, `app-api-methods` at 25.24 KB, and no
  access-control asset; built `index.html` has no eager preload entry for
  these user chunks or the legacy API facade.
- Guardrail slice: `frontend/tests/apiHttp.test.ts` and
  `frontend/tests/performanceLoadingUx.test.ts` now reject the retired loader
  and chunk rule, require user list wrappers to use `loadUserReadTransport()`,
  and require profile/password/role wrappers to use `loadUserAdminTransport()`.
- Verification proof: focused API and performance tests, standalone frontend
  typecheck, JSX/source check, full frontend utility suite, frontend production
  build, backend utility suite, schema audit, organization audit, generated
  reference refresh, Phase 29 audit, storage prune, local health check, and
  `npm.cmd --prefix ops run phase84:live-suite -- --skip-rollback` passed.
  The in-app Browser path was attempted first but remains blocked locally by
  the kernel asset path error; repo Playwright checks supplied browser proof
  with 66 UI signals, zero relevant console messages, 20 public portal
  products, zero failed responses/page errors, and passing post-live hygiene.
  Storage prune removed 0 bytes because retention policies were already
  satisfied.
- Current plan position after Move 835: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 836: Route Custom Tables through focused transport

- Ownership slice: Phase 29 TypeScript/code-flow cleanup. The dormant Custom
  Tables surface now owns its focused API transport directly instead of
  depending on the broad legacy API facade.
- Code-flow slice: `frontend/src/components/custom-tables/CustomTables.tsx`
  lazy-loads `frontend/src/api/customTablesTransport.ts` only when the
  component is opened. Reads, creates, row inserts, row updates, row deletes,
  undo, and redo all continue through the existing bounded loader/action
  guards.
- Cleanup slice: `frontend/src/api/methods.ts` no longer keeps custom-table
  compatibility wrappers or a custom-table transport loader. The focused
  transport stays available for any future routed Custom Tables page.
- Guardrail slice: source tests now reject `window.api`/`getCustomTablesApi`
  use in the component and reject custom-table wrappers returning to the
  legacy registry.
- Build slice: production build emitted `app-api-methods` at 24.42 KB, down
  from 25.24 KB in Move 835. No custom-table API asset was emitted or preloaded
  because the Custom Tables component is not part of the active routed bundle.
- Verification proof: focused API/performance/action-stability tests,
  standalone frontend typecheck, JSX/source check, full frontend utility
  suite, frontend production build, backend utility suite, schema audit,
  organization audit, generated reference refresh, Phase 29 audit, storage
  prune, local health check, and `npm.cmd --prefix ops run phase84:live-suite
  -- --skip-rollback` passed. The in-app Browser path was attempted first but
  remains blocked locally by the kernel asset path error; repo Playwright
  checks supplied browser proof with 66 UI signals, zero relevant console
  messages, 20 public portal products, zero failed responses/page errors, and
  passing post-live hygiene. Storage prune removed 321,677 bytes of stale
  retained report directories while preserving uploads, secrets, env files,
  Docker volumes, active images, newest local backup sets, and the newest R2
  backup.
- Current plan position after Move 836: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 837: Retire legacy Audit Log facade wrappers

- Ownership slice: Phase 29 TypeScript/code-flow cleanup. Audit Log reads and
  retention cleanup are now owned only by
  `frontend/src/api/auditLogTransport.ts` and the Audit Log route that imports
  it directly.
- Code-flow slice: `frontend/src/api/methods.ts` no longer keeps the dead
  `getAuditLogs`, `deleteAuditLogsRetention`, or audit transport loader
  wrappers. This removes a stale compatibility path from the normal legacy API
  registry without changing the route-owned Audit Log behavior.
- Guardrail slice: `frontend/tests/apiHttp.test.ts` and
  `frontend/tests/performanceLoadingUx.test.ts` now reject audit-log wrappers
  returning to the legacy registry while still proving the focused transport
  owns query building, offline fallback, idle mirroring, and retention cleanup.
- Build slice: production build emitted `app-api-methods` at 24.16 KB, down
  from 24.42 KB in Move 836. The focused `audit-log-api` route chunk remains
  available at 1.64 KB.
- Verification proof: focused API/performance/action-stability tests,
  standalone frontend typecheck, JSX/source check, frontend production build,
  the full frontend utility suite, backend utility suite, schema audit,
  organization audit, generated reference refresh, Phase 29 audit, storage
  prune, local health check, and `npm.cmd --prefix ops run phase84:live-suite
  -- --skip-rollback` passed. The in-app Browser path was attempted first but
  remains blocked locally by the kernel asset path error; repo Playwright
  checks supplied browser proof with 66 UI signals, zero relevant console
  messages, 20 public portal products, zero failed responses/page errors, and
  passing post-live hygiene. Storage prune removed 321,659 bytes of stale
  retained report directories while preserving uploads, secrets, env files,
  Docker volumes, active images, newest local backup sets, and the newest R2
  backup.
- Current plan position after Move 837: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 838: Retire legacy Dashboard facade wrappers

- Ownership slice: Phase 29 TypeScript/code-flow cleanup. Dashboard analytics
  and summary reads are now owned by
  `frontend/src/api/dashboardTransport.ts` plus the Dashboard route direct
  import and Inventory route-owned narrow lazy loader.
- Code-flow slice: `frontend/src/api/methods.ts` no longer keeps the dead
  `getDashboard`, `getAnalytics`, or dashboard transport loader wrappers.
  Dashboard still imports `getAnalytics`, `getDashboard`, and
  `getDashboardStartup` directly, while Inventory keeps its own focused
  lazy loader for stats.
- Guardrail slice: `frontend/tests/apiHttp.test.ts` and
  `frontend/tests/performanceLoadingUx.test.ts` now reject dashboard wrappers
  returning to the legacy registry while still proving the focused transport
  owns dashboard startup and analytics paths.
- Build slice: production build emitted `app-api-methods` at 23.94 KB, down
  from 24.16 KB in Move 837. The focused `dashboard-api` route chunk remains
  available at 0.47 KB.
- Verification proof: focused API/performance/dashboard reliability tests,
  standalone frontend typecheck, JSX/source check, frontend production build,
  the full frontend utility suite, backend utility suite, schema audit,
  organization audit, generated reference refresh, Phase 29 audit, storage
  prune, local health check, and `npm.cmd --prefix ops run phase84:live-suite
  -- --skip-rollback` passed. The in-app Browser path was attempted first but
  remains blocked locally by the kernel asset path error; repo Playwright
  checks supplied browser proof with 66 UI signals, zero relevant console
  messages, 20 public portal products, zero failed responses/page errors, and
  passing post-live hygiene. Storage prune removed 321,843 bytes of stale
  retained report directories while preserving uploads, secrets, env files,
  Docker volumes, active images, newest local backup sets, and the newest R2
  backup.
- Current plan position after Move 838: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

### Move 839: Retire legacy Product image upload facade

- Ownership slice: Phase 29 TypeScript/code-flow cleanup. Product image uploads
  are now owned by focused route/form intent imports of
  `frontend/src/api/productImageUploadTransport.ts`.
- Code-flow slice: `frontend/src/api/methods.ts` no longer keeps the dead
  `uploadProductImage`, `loadProductImageUploadTransport`, or product-image
  upload transport promise. This avoids keeping image-upload upload machinery
  visible through the broad legacy API registry.
- Guardrail slice: `frontend/tests/apiHttp.test.ts` and
  `frontend/tests/performanceLoadingUx.test.ts` now reject product-image upload
  wrappers returning to the legacy registry while still proving Products and
  Product form own the focused upload transport. Dashboard first-viewport
  label guards were added so range/payment/no-data text falls back instead of
  exposing raw translation keys during language-pack loading.
- Build/runtime slice: production build emitted `app-api-methods` at 23.75 KB,
  down from 23.94 KB in Move 838. The focused
  `product-image-upload-api` intent chunk remains available at 1.29 KB. The
  Docker release runtime was rebuilt and recreated as
  `business-os:v6.0.0-202606071009-move839`, then local health served frontend
  hash `1c581b7659d369c7`.
- Verification proof: focused API/performance/dashboard/action-stability tests,
  standalone frontend typecheck, JSX/source check, frontend production build,
  the full frontend utility suite, backend utility suite, schema audit,
  organization audit, generated reference refresh, Phase 29 audit, storage
  prune, local Docker health, `npm.cmd --prefix ops run phase84:live-suite
  -- --skip-rollback`, and in-app Browser DOM/log/interaction checks passed.
  Broad live-suite proof: 66 UI signals, zero relevant console messages, 20
  public portal products, zero failed responses/page errors, and passing
  post-live hygiene. Storage prune removed 321,415 bytes of stale retained
  reports while preserving uploads, secrets, env files, Docker volumes, active
  images, newest local backup sets, and the newest R2 backup. Browser screenshot
  capture timed out through the bridge after Docker refresh; the accepted
  focused Browser proof is the DOM/log/interaction result showing Dashboard
  visible, no relevant app console errors, no raw range/no-data keys, and
  Custom range input visibility after interaction.
- Current plan position after Move 839: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

## Safety Gates

- No broad folder rename without `rg` proving every old path is updated.
- No compatibility wrapper move is accepted unless
  `node ops/scripts/architecture/organization-audit.ts` reports zero broken
  wrapper targets.
- No compatibility wrapper deletion is accepted unless the organization audit
  shows zero active references and the generated references are refreshed after
  deletion.
- No source folder move without `npm.cmd run build`.
- No UI folder move without a focused Playwright run.
- No language conversion without a before/after test and build check.
- No backend language conversion until packaging/release scripts are updated and tested.
- No source deletion from Phase 29 cleanup findings without reference proof,
  focused tests, build, and affected live checks.
- No framework-specific config rename unless the framework's production build
  proves it. In particular, keep `next.config.mjs` as `.mjs` for any future
  Next.js surface unless a separate production-build proof replaces this rule.
