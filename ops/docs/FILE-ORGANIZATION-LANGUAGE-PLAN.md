# File Organization And Language Conversion Plan

> Current whole-plan position: Phase 6 schema audit green; Phase 8.4 loader/action stability sweep active; Phase 26 preserved at 51 completed moves; Phase 28 active with R2 prune follow-up; Phase 29 active as the recurring whole-codebase/schema/cleanup guardrail. Latest recorded cleanup/optimization move: Move 485 in this file.

## Goal

Make the codebase easier to navigate, safer to refactor, and more efficient to run by grouping files around real ownership boundaries and converting code to stronger languages only where the build/test system can prove a gain.

## Current Shape

- Frontend source: 261 files under `frontend/src`.
  - 107 `.jsx`
  - 36 `.js`
  - 32 `.mjs`
  - 86 `.ts`
  - 1 `.css`
- Frontend tests: 76 focused test files under `frontend/tests`.
  - 11 `.mjs`
  - 65 `.ts`
- Backend source: 87 files under `backend/src`.
  - 83 `.js`
  - 1 `.sql`
  - 3 `.md`
- Backend tests: 50 `.js` files under `backend/test`.
- Runtime/ops scripts: 44 `.mjs`, 16 `.js`, 8 `.ps1`, and 1 `.sql` under `ops/scripts`.
- TypeScript is strict for converted frontend source and the first converted `frontend/tests/**/*.ts` files.
- React type packages are not currently declared in `frontend/package.json`, so large `.jsx` to `.tsx` conversion needs a dependency/setup phase first.
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
- `npm.cmd run check:jsx`
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
7. Move the first product form cluster. Done: `VariantFormModal.jsx` now lives
   in `frontend/src/components/products/forms`. Focused source checks,
   production build, runtime health, and Product variant Playwright verification
   passed on frontend hash `42378a84fc53ab2f`.
8. Continue the product form split. Done: `BulkAddStockModal.jsx` and
   `BranchStockAdjuster.jsx` now live in
   `frontend/src/components/products/forms`. Focused source checks,
   production build, runtime health, and Product stock-helper Playwright
   verification passed on frontend hash `b79c04b453d1b469`.
9. Move the product import cluster. Done: `BulkImportModal.jsx`,
   `productImportPlanner.mjs`, and `productImportWorker.mjs` now live in
   `frontend/src/components/products/import`. Product import planner tests,
   performance loading source checks, production build, runtime health, and the
   broad Phase 8.4 UI Playwright check passed on frontend hash
   `0028bc915078664f`.
10. Move the product scanning cluster. Done: `BarcodeScannerModal.jsx`,
    `barcodeImageScanner.mjs`, `barcodeScannerState.mjs`, and
    `scanbotScanner.mjs` now live in
    `frontend/src/components/products/scanning`. Scanner unit tests, production
    build, runtime health, and a focused Product scanner Playwright check passed
    on frontend hash `4fdf242042c73694`.
11. Start the product history split. Done: `productHistoryHelpers.mjs` now lives
    in `frontend/src/components/products/history`. Product history helper tests,
    source checks, typecheck, production build, runtime health, and a focused
    Product page Playwright action check passed on frontend hash
    `db2bde8c13de0d64`.
12. Move the product presentation surface cluster. Done: `HeaderActions.jsx`,
    `ProductsListSurface.jsx`, and `ProductDetailModal.jsx` now live in
    `frontend/src/components/products/surfaces`. Product discount and product
    pagination source tests, source checks, typecheck, production build,
    runtime health, and a focused Product page Playwright action check passed
    on frontend hash `e9b985386668bdf9`.
13. Move the product shared primitive cluster. Done: `primitives.jsx` now lives
    in `frontend/src/components/products/shared`, with Products, ProductForm,
    VariantForm, Product surfaces, Catalog, and POS imports rewired. Product,
    POS, and portal catalog source tests, source checks, typecheck, production
    build, runtime health, a focused Product page Playwright action check, and
    the broad Phase 8.4 UI Playwright check passed on frontend hash
    `21bd97f0b6d8a0df`.
14. Move the main product form into the forms cluster. Done:
    `ProductForm.jsx` now lives in `frontend/src/components/products/forms`,
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
    `multiMatch` helper was removed from `Products.jsx`. Helper source tests,
    source checks, typecheck, production build, runtime health, focused Product
    page Playwright, and focused Product scanner Playwright passed on frontend
    hash `a440b744817036af`.
17. Split product gallery helpers. Done: `productGalleryHelpers.ts` now lives
    in `frontend/src/components/products/helpers`, owning gallery
    normalization, product gallery fallback selection, and public product image
    URL resolution. `Products.jsx` no longer imports `resolvePublicAssetUrl`
    directly or carries local gallery normalization logic. Helper source tests,
    source checks, typecheck, production build, runtime health, focused Product
    page Playwright, and focused Product scanner Playwright passed on frontend
    hash `ff7f953e9b217168`.
18. Move product row presentation parts. Done: `ProductRowParts.jsx` now lives
    in `frontend/src/components/products/surfaces`, owning the product discount
    badge, row action menu wrapper, batch preview chips, and desktop details
    cell. `Products.jsx` no longer defines those presentation helpers inline.
    Source checks, typecheck, production build, runtime health, focused Product
    page Playwright, and focused Product scanner Playwright passed on frontend
    hash `f04520d849d51963`.
19. Split product filter/export helpers. Done: `productFilterHelpers.mjs` now
    lives in `frontend/src/components/products/helpers`, owning search-term
    parsing, branch quantity lookup, filtered product selection, and product
    CSV export row shaping. `Products.jsx` now delegates that data work to the
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
    labels and grouped summary chip text. `Products.jsx` now delegates those
    calculations to the helper module while preserving the existing grouped row
    render contract. The moved behavior has focused source tests. Source checks,
    typecheck, production build, runtime health, focused Product page
    Playwright, and focused Product scanner Playwright passed on frontend hash
    `5781a6bf1ff07e16`.
22. Split product display data helpers. Done:
    `productDisplayHelpers.mjs` now lives in
    `frontend/src/components/products/helpers`, owning lookup map construction,
    merged brand filter options, branch id/name maps, branch summary labels, and
    stock-status classification. `Products.jsx` now delegates that display data
    work while keeping the row UI and badges unchanged. The moved behavior has
    focused source tests. Source checks, typecheck, production build, runtime
    health, focused Product page Playwright, and focused Product scanner
    Playwright passed on frontend hash `6039db439c681904`.
23. Split product menu metadata helpers. Done:
    `productMenuHelpers.mjs` now lives in
    `frontend/src/components/products/helpers`, owning export menu item
    construction, supplier filter option normalization, and active filter count
    calculation. `Products.jsx` now delegates that menu metadata work while
    keeping the header and filter menu surfaces unchanged. The moved behavior
    has focused source tests. Source checks, typecheck, production build,
    runtime health, focused Product page Playwright, and focused Product scanner
    Playwright passed on frontend hash `2641f1ce0445f430`.
24. Split product filter menu section builder. Done:
    `productMenuHelpers.mjs` now also owns Product filter menu section and
    option construction, including year/month, branch, group, stock, category,
    brand, and supplier filter toggles. `Products.jsx` now delegates the menu
    data builder while keeping the shared `FilterMenu` UI unchanged. The moved
    behavior has focused source tests for section ordering, active flags, and
    toggle side effects. Source checks, typecheck, production build, runtime
    health, focused Product page Playwright, and focused Product scanner
    Playwright passed on frontend hash `b96c2bf7d1b6c06e`.
25. Split product row display state helpers. Done:
    `productDisplayHelpers.mjs` now also owns row purchase-price fallback,
    margin math, visible stock quantity, promotion calculation, compact
    brand/category metadata, branch labels, and mobile stock badge presentation.
    `Products.jsx` now delegates shared desktop/mobile row display state while
    keeping row rendering and actions unchanged. The moved behavior has focused
    source tests for margins, status labels/classes, compact metadata, and
    promotion pricing. Source checks, typecheck, production build, runtime
    health, focused Product page Playwright, and focused Product scanner
    Playwright passed on frontend hash `8426a118f46c25cc`.
26. Split product lightbox state helper. Done:
    `productGalleryHelpers.ts` now also owns lightbox image URL resolution,
    empty-gallery handling, and start-index clamping. `Products.jsx` now
    delegates lightbox state construction while keeping the lightbox UI and
    navigation actions unchanged. The moved behavior has focused source tests
    for resolved upload URLs, high/negative/invalid index clamping, title
    preservation, and empty galleries. Source checks, typecheck, production
    build, runtime health, focused Product page Playwright, and focused Product
    scanner Playwright passed on frontend hash `3469c4d8b3425629`.
27. Split product lightbox index helpers and remove dead overlay branch. Done:
    `productGalleryHelpers.ts` now also owns reusable lightbox index clamping
    and active lightbox index updates. `Products.jsx` now delegates gallery
    index changes to that helper and no longer carries the disabled legacy
    `false && lightbox` overlay branch. The moved behavior has focused source
    tests for high/low/invalid/empty index clamping, null lightbox state, and
    existing state preservation. Source checks, typecheck, production build,
    runtime health, focused Product page Playwright, and focused Product
    scanner Playwright passed on frontend hash `713180d4d834b1ce`.
28. Split product detail lightbox gallery-input helper. Done:
    `productGalleryHelpers.ts` now also owns the detail-modal lightbox input
    decision: prefer a normalized clicked gallery when present, otherwise fall
    back to the clicked image source. `Products.jsx` now delegates that
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
    parent-product id set construction. `Products.jsx` now delegates the
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
    `Products.jsx` keeps only a small user-context wrapper for undo/redo,
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
    only the add/remove deltas needed for restore. `Products.jsx` now keeps the
    API loop focused on executing those planned adjustments instead of mixing
    map/set diffing with mutation calls. Focused source checks, typecheck,
    helper tests, production build, performance verification, runtime health,
    focused Product page Playwright, and focused Product scanner Playwright
    passed on frontend hash `f8c95fdbb7171cff`.
33. Split deleted-product restore planning helpers. Done:
    `productWriteHelpers.mjs` now also owns the smaller deleted-restore
    planning decisions: default branch selection, deleted-id set construction,
    preferred restore branch selection, and parent-id remapping when a deleted
    parent is restored in the same batch. `Products.jsx` now keeps the
    deleted-product restore loop focused on payload creation, API calls, id
    tracking, and branch-stock restoration. Focused source checks, typecheck,
    helper tests, production build, performance verification, runtime health,
    focused Product page Playwright, and focused Product scanner Playwright
    passed on frontend hash `f355894dc1465d5c`.
34. Split product clear-stock adjustment planner. Done:
    `productWriteHelpers.mjs` now also owns bulk out-of-stock branch-row
    planning. It filters invalid branch ids, ignores zero/invalid quantities,
    resolves purchase/cost unit prices once, and returns only valid stock
    removal adjustments. `Products.jsx` now keeps the out-of-stock loop focused
    on executing preplanned branch adjustments. Focused source checks,
    typecheck, helper tests, production build, performance verification,
    runtime health, focused Product page Playwright, and focused Product
    scanner Playwright passed on frontend hash `2fbb7e7e9a4dee2c`.
35. Split product branch-move planner. Done:
    `productWriteHelpers.mjs` now also owns bulk branch-change planning. It
    identifies the first valid positive-stock branch, returns an explicit
    transfer plan when stock must move, returns an initialize plan when the
    product has no valid positive stock, and returns no-op when stock is
    already in the target branch. `Products.jsx` now keeps the branch-change
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
    redo. `Products.jsx` now keeps the bulk update loop focused on confirmation,
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
    provided price fields through the shared price normalizer. `Products.jsx`
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
    source-tested place. `Products.jsx` now delegates nested clear-stock and
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
    payload in `Products.jsx`: restore branch-stock sync, deleted-product stock
    restore, clear-stock, bulk add-stock, and branch initialization. The helper
    now supports snapshot product-name overrides and zero-quantity branch
    initialization while preserving purchase/cost unit-cost fallback behavior.
    `Products.jsx` no longer carries raw `adjustStock({ ... })` object
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
    finite-number normalizer for transfer branch ids. `Products.jsx` keeps
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
    `frontend/src/components/utils-settings/Backup.jsx` is now LF-normalized
    so `git diff --check` no longer reports every changed line as trailing
    whitespace. Backup UI utility tests, frontend JSX syntax check, frontend
    typecheck, focused `git diff --check`, and full `git diff --check` passed;
    only normal Git CRLF conversion warnings remain.
44. Harden Backup Drive and job action pathways. Done:
    `frontend/src/components/utils-settings/Backup.jsx` now wraps Google Drive
    sync preferences, OAuth start, manual sync queueing, disconnect, credential
    forget, backup export/restore queueing, and system-job cancellation in
    explicit timeout contracts while keeping the existing same-tick action
    locks. `frontend/tests/backupJobs.test.ts` now source-tests those timeout
    wrappers. Backup source tests, JSX check, typecheck, production build,
    focused diff whitespace check, in-app browser Backup action verification,
    and the broad Phase 8.4 Playwright UI live check passed on frontend hash
    `184285cf77ae8c5e`.
45. Harden Files library asset upload/delete actions. Done:
    `frontend/src/components/files/FilesPage.jsx` and
    `frontend/src/components/files/FilePickerModal.jsx` now wrap file asset
    uploads and deletes in explicit timeout contracts while preserving their
    same-tick upload/delete guards. The Files selected-assets toolbar also uses
    the imported `Download` icon instead of an undefined `Save` symbol. Focused
    action stability tests, performance loading UX tests, JSX check, typecheck,
    production build, a live Playwright upload/search/delete cleanup loop, and
    the broad Phase 8.4 Playwright UI live check passed on frontend hash
    `d0e1a511d334b9e4`.
46. Harden Settings and Catalog media upload pathways. Done:
    `frontend/src/components/utils-settings/Settings.jsx` and
    `frontend/src/components/catalog/CatalogPage.jsx` now wrap their
    `uploadFileAsset(...)` media uploads in explicit 30s timeout contracts while
    preserving keyed same-tick guards, abort controllers, progress updates,
    preview rollback, and non-persisted draft behavior. Focused action
    stability tests, performance loading UX tests, JSX check, typecheck,
    production build, broad Phase 8.4 Playwright UI live check, and a targeted
    Settings upload/search/delete cleanup loop passed on frontend hash
    `e0a84171cdaad979`.
47. Harden Product form image upload pathway. Done:
    `frontend/src/components/products/forms/ProductForm.jsx` now wraps the Add
    Product/Edit Product direct `window.api.uploadProductImage(...)` file upload
    path in an explicit 30s timeout contract while preserving the existing
    same-tick upload guard, five-image limit, staged gallery behavior, and
    cache-busted preview handling. Focused action stability tests, performance
    loading UX tests, JSX check, typecheck, production build, focused Product
    page Playwright, a targeted Add Product image upload/render/API cleanup
    loop, broad Phase 8.4 Playwright UI live check, and storage pruning passed
    on frontend hash `5e4397389d09fb6a`.
48. Harden AppContext auth and settings write pathways. Done:
    `frontend/src/AppContext.jsx` now wraps login, logout, Google OAuth link
    completion, server settings save, and session-duration refresh in explicit
    timeout contracts while keeping existing session persistence, bootstrap,
    conflict handling, and local-device setting behavior. Focused loading UX,
    receipt-settings sync, owned Google auth, action stability, JSX, typecheck,
    production build, a targeted fresh-browser login/settings-save Playwright
    loop, broad Phase 8.4 Playwright UI live check, and storage pruning passed
    on frontend hash `f1e8f62676674afa`.
49. Harden POS write pathways. Done:
    `frontend/src/components/pos/POS.jsx` now wraps POS quick-add customer,
    quick-add delivery contact, and checkout sale creation in explicit timeout
    contracts while preserving the existing same-tick customer, delivery, and
    checkout guards plus sale idempotency. Focused action stability tests,
    performance loading UX tests, JSX check, typecheck, production build,
    targeted POS quick-add customer/delivery Playwright create-and-cleanup
    verification, broad Phase 8.4 Playwright UI live check, and storage pruning
    passed on frontend hash `080d514c34776914`.
50. Harden Returns write pathways. Done:
    `frontend/src/components/returns/NewReturnModal.jsx`,
    `frontend/src/components/returns/EditReturnModal.jsx`, and
    `frontend/src/components/returns/NewSupplierReturnModal.jsx` now wrap
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
    `frontend/src/components/returns/Returns.jsx` now wraps action-history
    undo/redo return restore `updateReturn(...)` calls in a 15s timeout contract
    and a same-tick restore guard. This prevents rapid repeated undo/redo clicks
    from stacking return rewrites that can affect sales, inventory, stock
    movements, and return accounting. Focused action stability tests,
    performance loading UX tests, JSX check, typecheck, and production build
    passed on frontend hash `c760b6afc8011408`.
53. Harden destructive reset actions. Done:
    `frontend/src/components/utils-settings/ResetData.jsx` now wraps typed-confirm
    business-data reset and factory-reset calls in shared same-tick guards plus
    explicit long-running timeout contracts. This keeps reset/factory-reset
    requests from stacking under repeated clicks and prevents an indefinite
    Working/Resetting state if the destructive backend operation stalls.
    Focused action stability tests, performance loading UX tests, JSX check,
    typecheck, production build, broad Phase 8.4 Playwright UI live check, and
    storage pruning passed on frontend hash `41ba19c6e7f1bb2d`.
54. Harden Server queue and connection actions. Done:
    `frontend/src/components/server/ServerPage.jsx` now wraps pending-sync queue
    retry, pending-sync queue discard, and manual sync-server connection test
    actions in same-tick guards plus explicit 12s timeout contracts. This keeps
    repeated clicks from stacking server queue operations and prevents the
    connection-test spinner from hanging indefinitely. Focused action stability
    tests, performance loading UX tests, JSX check, typecheck, production build,
    and broad Phase 8.4 Playwright UI live check passed on frontend hash
    `baaa4a6c9a19b70f`.
55. Harden Audit Log retention cleanup. Done:
    `frontend/src/components/utils-settings/AuditLog.jsx` now wraps the admin
    "Clear 30d" audit-log retention delete in a shared same-tick guard and a
    12s timeout contract, while disabling the button during cleanup. This keeps
    repeated clicks from stacking destructive retention cleanup calls and avoids
    an indefinite loading state if the delete request stalls. Focused action
    stability tests, performance loading UX tests, JSX check, typecheck,
    production build, and broad Phase 8.4 Playwright UI live check passed on
    frontend hash `f6d54693ea42f9a0`.
56. Harden Catalog portal submission writes. Done:
    `frontend/src/components/catalog/CatalogPage.jsx` now wraps customer portal
    share-proof submission creation and staff submission review actions in
    shared same-tick guards plus explicit 12s timeout contracts. This prevents
    repeated clicks from stacking customer submission writes or duplicate review
    decisions, while preserving the existing membership refresh and portal
    refresh behavior. Focused action stability tests, performance loading UX
    tests, JSX check, typecheck, production build, and broad Phase 8.4
    Playwright UI live check passed on frontend hash `813ec1480c527052`.
57. Harden Products page history and bulk mutation pathways. Done:
    `frontend/src/components/products/Products.jsx` now routes product
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
    `backend/src/services/backupPackages.js` now recognizes timestamped
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
    `frontend/src/utils/mediaUpload.js` remains as the compatibility wrapper for
    catalog, settings, product form, and focused test imports. Added the
    existing `frontend/tests/mediaUploadHelpers.test.ts` to the frontend utility
    suite and fixed cache-busting so explicit upload versions replace an
    existing `v` query parameter instead of appending a duplicate. Added
    `frontend/src/utils/publicAssetUrls.ts` directly after retiring the JS public-asset boundary declaration file.
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
    `frontend/src/components/products/import/productImportPlanner.ts`, while
    `productImportPlanner.mjs` remains as the compatibility wrapper for
    `BulkImportModal`, the product import worker, and focused tests. The
    frontend TypeScript project now includes product import `.ts` modules.
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
    `frontend/src/components/products/scanning/barcodeImageScanner.ts`, while
    `barcodeImageScanner.mjs` remains as the compatibility wrapper for
    `BarcodeScannerModal.jsx` and focused scanner tests. The typed helper keeps
    the native `BarcodeDetector` fast path, zxing fallback, image loader, and
    injected test seams explicit.
142. Convert barcode scanner presentation state helper to TypeScript. Done:
    The scanner presentation-state helper moved to
    `frontend/src/components/products/scanning/barcodeScannerState.ts`, while
    `barcodeScannerState.mjs` remains as the compatibility wrapper for
    `BarcodeScannerModal.jsx` and focused scanner-state tests. The typed helper
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
    app-shell compatibility wrapper has been retired after `App.jsx`,
    `AppContext.jsx`, startup routing, and focused app-shell tests moved to the
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
    `CatalogPage.jsx` and focused portal editor tests.
148. Convert portal language pack helper to TypeScript. Done:
    The first-party portal language pack and lookup helper moved to
    `frontend/src/components/catalog/portalLanguagePacks.ts`, while
    `portalLanguagePacks.ts` remains as the compatibility wrapper for
    `CatalogPage.jsx`, portal i18n helpers, and focused portal vocabulary
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
    `Inventory.jsx` and focused movement-group tests, then was retired in Move
    479 after callers moved to the TypeScript source. The existing
    `inventoryMovementGroups.test.ts` is now part of `test:utils` so movement
    grouping stays inside the regular Phase 29 frontend gate.
151. Convert POS core helper to TypeScript. Done:
    The POS product grouping, variant-choice, cart price, cart line identity,
    and matching helper moved to `frontend/src/components/pos/posCore.ts`,
    while `posCore.mjs` remains as the compatibility wrapper for `POS.jsx` and
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
    `productImportWorker.mjs` remains as the stable Vite module-worker wrapper
    used by `BulkImportModal.jsx`. The typed worker boundary now narrows
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
    to the TypeScript source. `frontend/src/types/jsx-modules.d.ts` documents
    the checked boundary for existing JSX chart components until those visual
    components are converted in their own measured slices.
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
    callers moved to the TypeScript source. `frontend/src/types/jsx-modules.d.ts`
    now documents the checked JSX component boundary needed by the barrel until
    those large admin surfaces are converted in separate measured slices.
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
    `frontend/src/components/products/import/BulkImportModal.jsx` now treats
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
    wrapper. `SalesImportModal.jsx` now uses the shared
    `frontend/src/utils/csvRowCounter.ts` parser, so quoted multiline CSV
    records are counted consistently across sales, inventory, and contacts.
    The modal keeps the server-side background import job contract while
    adding a 5 second row-count timeout, synchronous fallback, stale-result
    guard, and disabled import state while row checking is in flight.
165. Reject the background import tracker as a Web Worker candidate. Done:
    Phase 29 inspection found that
    `frontend/src/components/shared/BackgroundImportTracker.jsx` is API
    polling and bounded UI orchestration, not file parsing, media decoding, or
    a CPU-heavy browser loop. `language-runtime-audit.ts` now records it in
    `rejectedWebWorkerCandidates`, removes it from future worker rankings, and
    promotes the next measurable candidates: `frontend/src/utils/csv.ts` for
    browser export/ZIP work and `backend/src/services/backupPackages.js` for
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
    `backend/src/services/backupPackages.js` now pages large backup tables with
    keyset reads (`WHERE id > ? ORDER BY id ASC LIMIT ?`) after the first page
    while keeping the existing `LIMIT ? OFFSET ?` fallback for tables or
    compatibility paths that cannot use `id`. The package format, checksum
    streaming, retention behavior, and remote mirror path stay unchanged.
    `frontend/src/utils/csvImport.ts` is also recorded as an intentional shared
    parser/fallback rather than another worker target because product, contact,
    inventory, and sales import surfaces already run their heavy CSV work
    through focused worker slices.
168. Optimize product import lookup loops. Done:
    `backend/src/services/importJobs.js` now keeps a per-job product-name cache
    for product import apply work and a supplier lookup cache inside the product
    import context. Repeated same-name rows, variants, and supplier values avoid
    repeated database lookups, while `rememberProductForImport()` keeps the
    in-memory product cache current after new products or updates. The scanner
    photo/camera files are recorded as rejected standalone Worker targets
    because their work is tied to `Image`, `BarcodeDetector`, `getUserMedia`,
    video refs, zxing browser controls, and React permission UI.
169. Clear remaining false-positive Web Worker candidates. Done:
    `frontend/src/components/shared/ImageGalleryLightbox.jsx` is recorded as a
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
    `backend/src/routes/importJobs.js` now derives permitted import types from
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
    `backend/src/routes/inventory.js` now prepares the RFID branch lookup,
    product lookup, branch-stock writes, movement insert, product RFID summary
    update, and session-finalization statement once per apply request instead
    of preparing statements inside each confirmed product row. This keeps the
    route in Node.js/SQLite because it is request orchestration with audit and
    stock recalculation side effects, but removes avoidable per-row statement
    setup. `backend/test/rfidRoutes.test.ts` records the source-level guard,
    and `language-runtime-audit.ts` records the completed SQL/data-path slice
    with rollback and proof commands.
175. Consolidate portal catalog product payload assembly. Done:
    `backend/src/routes/portal.js` now uses `getPortalProductAssets()` and
    `buildPortalProductPayload()` for both the full customer-safe catalog and
    paged catalog search. Image gallery loading, branch-stock grouping, fallback
    image selection, and highlight badge decoration now have one route-local
    implementation instead of two parallel blocks. This keeps the route in
    Node.js while reducing duplicate query/materialization pathways, with
    `backend/test/portalInventoryRegression.test.ts` guarding the shared
    helper contract.
176. Optimize image-only product bulk import matching. Done:
    `backend/src/routes/products.js` now builds a `productsByImageBaseName` map
    once from active products before processing uploaded image filenames. The
    image-only import path now does one normalized-name lookup per image instead
    of scanning every active product for every uploaded file. The behavior stays
    name-based and route-local, while `backend/test/productSearchPagination.test.ts`
    guards the map-backed path and absence of the repeated `allProducts.find`
    loop.
177. Reuse sale creation movement statements. Done:
    `backend/src/routes/sales.js` now prepares the sale inventory-movement
    insert and optional imported timestamp update once per sale creation
    transaction instead of rebuilding those statements for each sold item. This
    keeps the existing Node.js batch allocation and audit flow while reducing
    per-item SQL statement setup. `backend/test/productBatchHierarchy.test.ts`
    guards the request-scoped movement statements.
178. Reuse system settings delete statement. Done:
    `backend/src/routes/system/index.js` now prepares the settings delete
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
    `backend/src/postgresDatabase.js` and `backend/src/db/postgresSchema.sql`
    now create `idx_action_history_scope_updated_pg` and
    `idx_action_history_scope_user_updated_pg`, matching the API's
    `scope = ? ORDER BY updated_at DESC, id DESC` and
    `scope = ? AND created_by_id = ? ORDER BY updated_at DESC, id DESC`
    history-bar reads. `backend/test/postgresDatabase.test.ts` guards the
    startup DDL, and `ops/docs/SCHEMA-RELATIONSHIPS.md` now records the
    completed read-path indexes in the schema map.
241. Add unique session-token index. Done:
    A live duplicate check found zero duplicate `user_sessions.token_hash`
    values across 3,459 current sessions. `backend/src/postgresDatabase.js` and
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
    values in `sales`, `returns`, and `products`. `backend/src/postgresDatabase.js`
    and `backend/src/db/postgresSchema.sql` now create unique partial indexes for
    `sales(client_request_id)`, `returns(client_request_id)`, and
    `products(client_request_id)` where the request id is present. These indexes
    close the race window behind the existing route-level replay lookup/catchback
    logic and keep accidental double-submit/retry behavior deterministic.
245. Add parent-first detail-read indexes. Done:
    `backend/src/postgresDatabase.js` and `backend/src/db/postgresSchema.sql`
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
    slow/save-data connection guards. `Sidebar.jsx` publishes that event from
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
    `CatalogPage.jsx` now relies on the scoped portal language pack and the
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
    `frontend/src/api/methods.js` now uses the `updatedAt` value already
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
    `backend/src/routes/settings.js` now caches the `settings.updated_at`
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
    `branches.js` and `inventory.js` now cache the stock-transfer note-column
    selection used by transfer write paths, and `products.js` now caches the
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
    `backend/src/routes/customTables.js` now caches stable custom-table
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
    `backend/src/schemaMetadata.js` now owns cached table/column metadata
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
    and fails if any production route bypasses `schemaMetadata.js` with a direct
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
    `frontend/src/components/catalog/CatalogPage.jsx` now uses shared image
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
    `frontend/src/App.jsx` now uses `deleteStaleShellCaches()` with
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
    `backend/src/runtimeCache.js` now uses `deletePrefixesInOrder()` when a
    write invalidates several cache namespaces. This keeps Redis invalidation
    from running multiple `SCAN`/`DEL` prefix walks at once during product,
    inventory, settings, sales, returns, or customer write bursts. Backend
    runtime-cache tests guard the pathway.
305. Index lookup-manager bulk delete snapshots. Done:
    `frontend/src/components/products/lookups/ManageCategoriesModal.jsx` and
    `ManageUnitsModal.jsx` now build stable id maps for category/unit rows and
    reuse them for single and bulk delete snapshots. This removes repeated
    `find()` scans from bulk lookup cleanup while preserving undo/redo
    behavior and expected-updated-at guards.
306. Index brand lookup bulk delete impact. Done:
    `frontend/src/components/products/lookups/ManageBrandsModal.jsx` now builds
    `brandsByLookup` once per render and uses it to calculate selected-brand
    usage impact before delete confirmation. This removes repeated full-list
    filtering from bulk brand cleanup and keeps the three lookup managers
    aligned on indexed selection paths.
307. Index POS cart product and branch lookups. Done:
    `frontend/src/components/pos/POS.jsx` now reuses `productsById` for cart
    quantity validation, branch changes, and detail opening, and builds
    `branchesById` for branch-name error messages. This keeps the checkout path
    on stable indexed references without moving POS files or changing cart-line
    identity.
308. Index inventory branch labels and product summary lookups. Done:
    `frontend/src/components/inventory/Inventory.jsx` now builds `branchesById`
    and `summaryById` maps once, then routes RFID labels, export metadata,
    branch comparison rows, adjustment snapshots, and movement product detail
    opening through those indexes. This improves repeated inventory operations
    without moving inventory modules or changing data flows.
309. Index product page branch moves and fresh history snapshots. Done:
    `frontend/src/components/products/Products.jsx` now builds `branchesById`
    for bulk branch-change target resolution and indexes freshly fetched
    product snapshots before save/variant undo history entries are created.
    This keeps product write flows aligned with the id-map strategy used in POS
    and Inventory. The Phase 29 repeat audit was also tightened so generated
    dist-manifest presence stays reported but no longer creates false drift in
    stable runtime-version source-wiring comparisons.
310. Index inventory transfer branch defaults. Done:
    `frontend/src/components/inventory/Inventory.jsx` now precomputes
    `defaultTransferDestinationBySourceId` once per branch list and resolves
    submitted transfer branches through `branchesById`. This keeps single and
    batch transfer setup on the same indexed branch pathway without moving UI
    modules.
311. Make inventory return stats single-pass. Done:
    `frontend/src/components/inventory/Inventory.jsx` now aggregates customer
    returns, supplier returns, refunds, restock count, and returned item
    quantities through one accumulator pass after the bounded stats loader
    resolves. This is a loop cleanup only; no schema, folder, or runtime
    language move was needed.
312. Index inventory adjustment branch stock per submit. Done:
    `frontend/src/components/inventory/Inventory.jsx` now builds
    `selectedBranchStockById` for the selected adjustment product and reuses the
    resolved row for undo quantity capture and remove-stock validation. This is
    another local hot-path cleanup with no module move or language conversion.
313. Make Inventory visible stats single-pass. Done:
    `frontend/src/components/inventory/Inventory.jsx` now builds one memoized
    `visibleInventoryStats` accumulator for visible stock value, stock-state
    counts, sold quantity, revenue, COGS, and discount fallbacks. This keeps the
    stat-card render path linear and local; no folder move, source deletion, or
    language conversion was justified.
314. Index backend inventory active branches per request. Done:
    `backend/src/routes/inventory.js` now builds one `activeBranchIndex` map
    from loaded active branches and reuses it in inventory adjustment and
    product-row move flows. This removes repeated branch scans from stock write
    pathways while keeping the existing Node/SQL route structure; no folder move
    or runtime conversion was needed.
315. Index product-import branches by normalized name per job. Done:
    `backend/src/services/importJobs.js` now keeps a `branchesByName` map in the
    product import context and updates it when imported rows create new
    branches. This is a hot-path import optimization only; no schema migration,
    folder move, or language conversion was justified.
316. Make bulk product-import conflict summaries single-pass. Done:
    `frontend/src/components/products/import/BulkImportModal.jsx` now computes
    review badge counts in one `conflictGroups` accumulator loop instead of
    repeatedly filtering the conflict list. This is a local UI workflow
    optimization; no folder move or language conversion was needed.
317. Precompute Inventory visible product IDs. Done:
    `frontend/src/components/inventory/Inventory.jsx` now memoizes
    `visibleInventoryProductIds` once from the visible product list and reuses
    it for selection cleanup, select-all, and the reveal signature. This trims
    repeated list walks in the Inventory selection pathway; no folder move or
    language conversion was needed.
318. Centralize Inventory selection-scope ID normalization. Done:
    `frontend/src/components/inventory/Inventory.jsx` now uses
    `normalizeFiniteIds()` for section/group selection checks and toggles. This
    removes repeated `ids.map(...).filter(...)` normalization in the selection
    workflow; no folder move or language conversion was needed.
319. Remove Inventory active-filter count allocations. Done:
    `frontend/src/components/inventory/Inventory.jsx` now uses
    `countActiveFlags()` for RFID, movement, and product filter badge counts
    instead of allocating short arrays only to call `.filter(Boolean).length`.
    This is a local render-path cleanup; no folder move or language conversion
    was needed.
320. Reuse Inventory selection helpers for partial counts and retries. Done:
    `frontend/src/components/inventory/Inventory.jsx` now shares
    `normalizeFiniteIdsFrom()` and `countSelectedIds()` across selection-scope
    checks, toggles, and batch failure recovery. This removes the remaining
    filtered selected-ID allocation and one-off failed-item ID normalization
    path; no folder move or language conversion was needed.
321. Remove Inventory destination-selector filter allocations. Done:
    `frontend/src/components/inventory/Inventory.jsx` now uses
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
    `frontend/src/components/sales/Sales.jsx` now precomputes visible sale IDs,
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
    helper internals with direct loops. `frontend/src/components/products/Products.jsx`
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
    `backend/src/services/importJobs.js` now uses direct loops for import job
    type filtering, duplicate-group counting, image-list parsing, setting
    option parsing, and cancel-wait job ID normalization. This was a backend
    data-flow cleanup only; no folder move, schema migration, or runtime
    conversion was needed.
332. Reuse product-route ID and token normalization helpers. Done:
    `backend/src/routes/products.js` now shares direct-loop helpers for
    positive ID collection and comma-token normalization across image map
    loading, product search filters, include parsing, branch-stock hydration,
    lookup replacement, and import image reference parsing. This was a
    localized backend route cleanup; no folder move, schema migration, or
    runtime conversion was needed.
333. Reuse settings conflict attempted-payload construction. Done:
    `frontend/src/api/methods.js` now builds settings conflict attempted values
    through `buildAttemptedSettings()` and a shared conflict metadata-key set
    instead of an inline `Object.entries(...).filter(...)` chain inside
    `saveSettings()`. This is a shared API-path cleanup only; no source folder
    move, schema migration, or runtime conversion was needed.
334. Tighten shared API query and import-image upload loops. Done:
    `frontend/src/api/methods.js` now builds shared query strings with direct
    key iteration and prepares import image browser-file/relative-path lists
    with direct loops. This keeps API URL and upload payload behavior stable
    while removing small repeated allocation chains from common read and import
    paths. No folder move, schema migration, or runtime conversion was needed.
335. Tighten upload, offline queue, and return conflict API loops. Done:
    `frontend/src/api/methods.js` now applies XHR upload headers with direct
    key iteration, collects eligible offline sale queue rows in one pass before
    sorting, and builds return conflict attempted-item snapshots through
    `buildAttemptedReturnItems()`. This was a shared API-path cleanup only; no
    folder move, schema migration, or runtime conversion was needed.
336. Centralize shared sync-update and mirror serialization loops. Done:
    `frontend/src/api/methods.js` now reuses named sync-update channel lists
    through `dispatchSyncUpdates()`, builds pending sync previews through a
    bounded direct-loop serializer, and clones local mirror rows with a direct
    loop before replacing table contents. This was another shared API-path
    cleanup only; no folder move, schema migration, or runtime conversion was
    needed.
337. Reuse backend inventory reason and search normalization loops. Done:
    `backend/src/routes/inventory.js` now normalizes saved inventory reasons
    through one direct-loop helper and splits inventory search terms with a
    bounded direct loop. This was a backend route cleanup only; no folder move,
    schema migration, or runtime conversion was needed.
338. Make backend inventory product hydration single-pass. Done:
    `backend/src/routes/inventory.js` now parses inventory product branch-stock
    JSON and collects product IDs in one pass before attaching batch rows. This
    was a backend route cleanup only; no folder move, schema migration, or
    runtime conversion was needed.
339. Consolidate backend stock-adjustment allocation movement loops. Done:
    `backend/src/routes/inventory.js` now uses
    `appendAllocationMovementEntries()` for remove/set stock allocation
    movement rows and a direct insertion loop for movement persistence. This
    was a backend route cleanup only; no folder move, schema migration, or
    runtime conversion was needed.
340. Tighten backend inventory transfer insertion loops. Done:
    `backend/src/routes/inventory.js` now applies transferred batch
    allocations and writes transfer movement pairs with direct loops, and
    `buildInsertColumnSql()` builds dynamic insert columns/placeholders in one
    helper. This was a backend route cleanup only; no folder move, schema
    migration, or runtime conversion was needed.
341. Tighten backend inventory row-move movement construction. Done:
    `backend/src/routes/inventory.js` now writes row-move source and
    destination allocation movement rows with direct loops and precomputed
    source/destination unit-cost fallbacks. This was a backend route cleanup
    only; no folder move, schema migration, or runtime conversion was needed.
342. Tighten backend RFID transaction loops. Done:
    `backend/src/routes/inventory.js` now records RFID events and applies RFID
    present-row stock updates with direct transaction loops, while precomputing
    purchase-price movement totals per product row. This was a backend route
    cleanup only; no folder move, schema migration, or runtime conversion was
    needed.
343. Tighten backend inventory product list assembly loops. Done:
    `backend/src/routes/inventory.js` now collects family root IDs, merges
    family/base product rows, sanitizes hydrated rows, and extracts brand
    filters with direct loops. This was a backend route cleanup only; no folder
    move, schema migration, or runtime conversion was needed.
344. Complete backend inventory route array-chain cleanup. Done:
    `backend/src/routes/inventory.js` now builds product-filter clauses,
    movement-search clauses, and summary branch-stock payloads with direct
    loops instead of array `map()` chains. This was a backend route cleanup
    only; no folder move, schema migration, or runtime conversion was needed.
345. Tighten shared backend product image and branch-stock helper loops. Done:
    `backend/src/routes/products.js` now seeds branch-stock rows, persists
    product image galleries, loads image maps, and attaches gallery payloads
    with direct loops. This was a backend route cleanup only; no folder move,
    schema migration, or runtime conversion was needed.
346. Tighten backend product lookup metadata assembly loops. Done:
    `backend/src/routes/products.js` now parses brand options, builds lookup
    usage entries, collects sample products, and prepares brand/category/unit
    rows with direct loops. This was a backend route cleanup only; no folder
    move, schema migration, or runtime conversion was needed.
347. Tighten backend product search filter and branch-stock attachment loops.
    Done: `backend/src/routes/products.js` now builds product ID bindings,
    search clauses, lookup filters, metadata distinct values, branch-stock
    placeholders, branch-stock groups, and branch-stock response payloads with
    direct loops. This was a backend route cleanup only; no folder move, schema
    migration, or runtime conversion was needed.
348. Tighten backend product family expansion and search response loops. Done:
    `backend/src/routes/products.js` now filters family sources, scans family
    rows, binds family SQL values, parses paged rows, collects batch IDs, and
    attaches batch payloads with direct loops. This was a backend route cleanup
    only; no folder move, schema migration, or runtime conversion was needed.
349. Tighten backend product lookup replacement and legacy list response
    loops. Done: `backend/src/routes/products.js` now builds lookup
    replacement placeholders, parses legacy product list rows, collects batch
    lookup IDs, and assembles product/batch payloads with direct loops. This
    was a backend route cleanup only; no folder move, schema migration, or
    runtime conversion was needed.
350. Tighten backend product edit stock adjustment movement loops. Done:
    `backend/src/routes/products.js` now processes manual stock reduction
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
    `backend/src/routes/products.js` now counts legacy image payload bytes,
    matches image-only imports, and builds category, unit, and brand lookup
    maps with direct loops instead of allocation-heavy callback chains. This
    was a backend route cleanup only; no folder move, schema migration, or
    runtime conversion was needed.
353. Tighten backend product bulk-import image and batch reset loops. Done:
    `backend/src/routes/products.js` now builds batch reset placeholders,
    parses import image references, loads current image galleries, collects
    resolved import images, seeds new-product branch stock, and cleans imported
    brand options with direct loops. This was a backend route cleanup only; no
    folder move, schema migration, or runtime conversion was needed.
354. Tighten backend product import signature and sales checkout loops. Done:
    `backend/src/routes/products.js` now builds product import signatures with
    a direct loop, and `backend/src/routes/sales.js` now normalizes checkout
    branch context, sale items, product metadata lookup, batch migration, and
    allocation/movement writes with direct loops. This was a backend route
    cleanup only; no folder move, schema migration, or runtime conversion was
    needed.
355. Tighten backend sales status-transition and list-response loops. Done:
    `backend/src/routes/sales.js` now writes status-transition batch
    allocations/restores and inventory movements with direct loops, and builds
    sales search tokens plus response payloads without callback chains. This
    was a backend route cleanup only; no folder move, schema migration, or
    runtime conversion was needed.
356. Tighten backend sales export/report loops. Done:
    `backend/src/routes/sales.js` now hydrates export rows, computes item COGS,
    accumulates completed-sale accounting totals, builds sales-detail payloads,
    and writes CSV rows/summary lines with direct loops. This was a backend
    route cleanup only; no folder move, schema migration, or runtime conversion
    was needed.
357. Tighten backend returns stock-flow loops. Done:
    `backend/src/routes/returns.js` now builds returns search/items payloads,
    product metadata maps, supplier totals/lookups, return allocation
    movements, edit reversals/restocks, and sale return-status recalculation
    with direct loops. This was a backend route cleanup only; no folder move,
    schema migration, or runtime conversion was needed.
358. Tighten backend custom-table dynamic SQL loops. Done:
    `backend/src/routes/customTables.js` now normalizes schemas, builds custom
    table payloads, DDL columns, insert columns/placeholders/values, and update
    set/value lists with direct loops and one shared ignored-field set. This
    was a backend route cleanup only; no folder move, schema migration, or
    runtime conversion was needed.
359. Tighten backend settings save loops. Done:
    `backend/src/routes/settings.js` now normalizes brand settings, builds
    settings snapshots, extracts attempted settings, upserts settings, and
    reports audit keys with direct loops plus one shared metadata-key set.
    This was a backend route cleanup only; no folder move, schema migration,
    or runtime conversion was needed.
360. Tighten owned Google OAuth and integration doctor origin loops. Done:
    `backend/src/services/googleOauth.js` now builds normalized origin and
    callback URI lists with direct loops, and
    `backend/src/services/integrationDoctor.js` reuses that login callback
    helper while discovering verified release-backup folders with direct
    iteration. This was a backend service cleanup only; no folder move, schema
    migration, or runtime conversion was needed.
361. Tighten public catalog payload loops. Done:
    `backend/src/routes/catalog.js` now collects product IDs, builds image SQL
    placeholders, groups image rows, and assembles catalog product payloads
    with direct loops and small named helpers. This was a backend route cleanup
    only; no folder move, schema migration, or runtime conversion was needed.
362. Tighten action history and user list response loops. Done:
    `backend/src/routes/actionHistory.js` and `backend/src/routes/users.js`
    now serialize action-history rows and sanitize user list rows with
    direct-loop helper functions instead of endpoint `rows.map(...)` calls.
    This was a backend route cleanup only; no folder move, schema migration,
    or runtime conversion was needed.
363. Tighten notification summary loops. Done:
    `backend/src/routes/notifications.js` now builds notification settings
    placeholders, settings maps, inventory alert items, expiry alert items and
    counts, and unread counts with direct loops and named helpers. Existing
    mojibake summary separator strings were left untouched to avoid accidental
    re-encoding. This was a backend route cleanup only; no folder move, schema
    migration, or runtime conversion was needed.
364. Tighten notification loyalty loops. Done:
    `backend/src/routes/notifications.js` now builds loyalty customer aggregate
    maps, threshold matches, and capped loyalty item payloads with direct
    loops while preserving point policy math and sorting. This was a backend
    route cleanup only; no folder move, schema migration, or runtime
    conversion was needed.
365. Tighten notification sales and portal item loops. Done:
    `backend/src/routes/notifications.js` now builds awaiting-payment,
    awaiting-delivery, and pending portal submission notification item payloads
    with direct-loop helpers. This was a backend route cleanup only; no folder
    move, schema migration, or runtime conversion was needed.
366. Tighten notification summary separator loops. Done:
    `backend/src/routes/notifications.js` now uses one notification separator
    constant and one direct-loop summary join helper for inventory, expiry,
    and sales summaries, and sales/portal metadata use the same separator.
    This was a backend route cleanup only; no folder move, schema migration,
    or runtime conversion was needed.
367. Tighten portal AI candidate and provider loops. Done:
    `backend/src/services/portalAi.js` now uses direct-loop helpers for token
    parsing, visitor timestamp pruning, candidate filtering/scoring, assistant
    recommendation normalization, provider usage summaries, and provider
    failover selection. This was a backend service cleanup only; no folder
    move, schema migration, or runtime conversion was needed.
368. Tighten Google Drive sync version-retention loops. Done:
    `backend/src/services/googleDriveSync/versioning.js` now normalizes Drive
    sync version rows and selects date-expired versions with direct-loop
    helpers while preserving timestamp-first retention and version-number
    fallback behavior. This was a backend service cleanup only; no folder move,
    schema migration, or runtime conversion was needed.
369. Tighten main Google Drive sync service loops. Done:
    `backend/src/services/googleDriveSync/index.js` now uses direct-loop
    helpers for settings reads/writes, sync-entry maps, multi-hash streaming,
    fetch error detail joining, snapshot directory lists, duplicate sibling
    filtering, live path sets, and stale mapping selection. This was a backend
    service cleanup only; no folder move, schema migration, or runtime
    conversion was needed.
370. Tighten backup package retention and listing loops. Done:
    `backend/src/services/backupPackages.js` now uses direct-loop helpers for
    cache cloning, object manifests, local backup directory discovery,
    retention planning, local/R2 removal summaries, local version listing, R2
    object aggregation, and final version sorting. This was a backend service
    cleanup only; no folder move, schema migration, or runtime conversion was
    needed.
371. Tighten AI provider gateway and route loops. Done:
    `backend/src/services/aiGateway.js` and `backend/src/routes/ai.js` now use
    direct-loop helpers for supported-model normalization, Google message
    payloads, Google text joining, provider list serialization, and AI response
    log serialization. This was a backend service/route cleanup only; no
    folder move, schema migration, or runtime conversion was needed.
372. Tighten branch stock integrity and transfer loops. Done:
    `backend/src/routes/branches.js` now uses direct-loop helpers for stock
    integrity preview payloads, total quantity calculation, repair stock
    updates, touched-product recalculation, and dynamic transfer insert SQL.
    This was a backend route cleanup only; no folder move, schema migration,
    or runtime conversion was needed.
373. Tighten runtime catalog-integrity diagnostics loops. Done:
    `backend/src/routes/runtime.js` now uses direct-loop helpers for product
    field counting, suspicious product sampling, and bounded brand-option
    suspicious-text sampling. This was a backend route cleanup only; no folder
    move, schema migration, or runtime conversion was needed.
374. Tighten offline sync digest and normalization loops. Done:
    `backend/src/routes/sync.js` now uses explicit ordered loops for stable
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
    `backend/src/routes/auth.js` now builds the bootstrap settings snapshot
    with a direct loop instead of a callback chain while preserving the
    sanitized settings payload and existing OAuth callback behavior. This was a
    backend route cleanup only; no folder move, schema migration, or runtime
    conversion was needed.
379. Tighten contacts point-policy settings loop. Done:
    `backend/src/routes/contacts.js` now builds the point-policy settings map
    with a direct loop instead of a callback chain while preserving customer
    point policy defaults and summary behavior. This was a backend route
    cleanup only; no folder move, schema migration, or runtime conversion was
    needed.
380. Tighten customer portal config normalization loops. Done:
    `backend/src/routes/portal.js` now normalizes FAQ items, portal translation
    blocks, recommended product IDs, and settings rows with direct loops while
    preserving the public portal config contract. This was a backend route
    cleanup only; no folder move, schema migration, or runtime conversion was
    needed.
381. Tighten customer portal product materialization loops. Done:
    `backend/src/routes/portal.js` now uses named direct-loop helpers for
    portal product ID collection, SQL placeholder construction, image/branch
    asset maps, and final payload list decoration. This was a backend route and
    regression-test cleanup only; no folder move, schema migration, or runtime
    conversion was needed.
382. Tighten customer portal loyalty point summary loops. Done:
    `backend/src/routes/portal.js` now summarizes earned, deducted, redeemed,
    and rewarded portal points with direct loops instead of filtered/reduced
    callback chains. This was a backend route cleanup only; no folder move,
    schema migration, or runtime conversion was needed.
383. Tighten customer portal catalog search/filter parsing loops. Done:
    `backend/src/routes/portal.js` now parses search terms, filter values,
    branch IDs, named placeholders, brand/category filters, and stock states
    with direct-loop helpers while preserving the public catalog query
    contract. This was a backend route cleanup only; no folder move, schema
    migration, or runtime conversion was needed.
384. Tighten customer portal catalog metadata loops. Done:
    `backend/src/routes/portal.js` now extracts distinct metadata rows,
    normalizes persisted brand options, and de-duplicates merged brands with
    direct-loop helpers while preserving catalog metadata output. This was a
    backend route cleanup only; no folder move, schema migration, or runtime
    conversion was needed.
385. Tighten customer portal membership/submission response loops. Done:
    `backend/src/routes/portal.js` now wraps membership SQL clauses, normalizes
    share-submission screenshot rows, and summarizes membership totals with
    direct-loop helpers while preserving the public membership and review
    response contracts. This was a backend route and regression-test cleanup
    only; no folder move, schema migration, or runtime conversion was needed.
386. Tighten customer portal screenshot and AI citation loops. Done:
    `backend/src/routes/portal.js` now sanitizes portal submission screenshots
    and collects AI recommendation citations with bounded direct-loop helpers
    while preserving media safety checks and AI response/log payloads. This was
    a backend route cleanup only; no folder move, schema migration, or runtime
    conversion was needed.
387. Tighten customer portal product signal ranking loops. Done:
    `backend/src/routes/portal.js` now builds portal product rank maps, net
    sale/return signal rows, new-arrival ranks, and recommended-product ranks
    with named direct-loop helpers while preserving catalog badge behavior.
    This was a backend route cleanup only; no folder move, schema migration, or
    runtime conversion was needed.
388. Tighten import job route wrapper loops. Done:
    `backend/src/routes/importJobs.js` now resolves permitted import types,
    serializes import job files, and saves multi-image upload records with
    named direct-loop helpers while preserving permission behavior, response
    fields, and upload order. This was a backend route cleanup only; no folder
    move, schema migration, or runtime conversion was needed.
389. Tighten import job service list/update loops. Done:
    `backend/src/services/importJobs.js` now lists decorated import jobs and
    builds import-job update assignments with direct helper loops while
    preserving type filtering, pagination limits, and allowed patch fields.
    This was a backend service cleanup only; no folder move, schema migration,
    or runtime conversion was needed.
390. Tighten import image-reference and product-gallery loops. Done:
    `backend/src/services/importJobs.js` now collects incoming image references,
    de-duplicates product galleries, inserts gallery rows, and loads current
    galleries with direct bounded loops while preserving the five-image cap and
    upload path normalization. This was a backend import/media cleanup only; no
    folder move, schema migration, or runtime conversion was needed.
391. Tighten import product review grouping loops. Done:
    `backend/src/services/importJobs.js` now finalizes duplicate-name import
    review groups and subgroups with direct-loop helpers while preserving row
    ordering, field/issue payloads, existing matches, and suggested actions.
    This was a backend import-review cleanup only; no folder move, schema
    migration, or runtime conversion was needed.
392. Tighten import review decision and label loops. Done:
    `backend/src/services/importJobs.js` now builds conflict labels, checks
    identifier filters, detects generic empty rows, copies review decision
    fields, applies field overrides, and serializes product signatures with
    named direct-loop helpers. This was a backend import-review cleanup only;
    no folder move, schema migration, or runtime conversion was needed.
393. Tighten import review count and group-decision loops. Done:
    `backend/src/services/importJobs.js` now accumulates review conflict counts
    and normalizes group decisions with named direct-loop helpers while
    preserving count keys, pagination behavior, merge order, and policy
    persistence. This was a backend import-review cleanup only; no folder move,
    schema migration, or runtime conversion was needed.
394. Tighten import product parent and lookup-map helpers. Done:
    `backend/src/services/importJobs.js` now picks parent products in one pass,
    builds settings option maps without array-map constructors, and shares a
    direct lookup-map helper for product import category, unit, supplier, and
    branch indexes. This was a backend import/product cleanup only; no folder
    move, schema migration, or runtime conversion was needed.
395. Tighten import product row-cache ordering. Done:
    `backend/src/services/importJobs.js` now updates same-name product cache
    rows with ordered insertion instead of filter-then-sort, preserving product
    import ordering and cache behavior. This was a backend import/product
    cleanup only; no folder move, schema migration, or runtime conversion was
    needed.
396. Tighten import branch-batch stock cleanup. Done:
    `backend/src/services/importJobs.js` now shares direct-loop batch ID
    collection and branch-batch stock zeroing for replacement imports while
    preserving stock rollups and batch increase behavior. This was a backend
    import/stock cleanup only; no folder move, schema migration, or runtime
    conversion was needed.
397. Tighten import cancellation placeholder and ID loops. Done:
    `backend/src/services/importJobs.js` now reuses shared SQL placeholder and
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
    first baseline. `backend/src/services/importJobs.js` now builds image
    lookups and inventory/sales CSV lookup maps with named direct-loop helpers
    instead of temporary arrays and callback chains. This was a documentation
    cleanup plus backend import-service optimization only; no source folder
    move, schema migration, or language conversion was needed.
399. Tighten import error CSV export. Done:
    `backend/src/services/importJobs.js` now builds error CSV output with a
    direct row helper instead of nested `map()` chains and spread
    materialization. This preserves the export header, UTF-8 BOM, quote
    escaping, row limit, row ordering, and download contract. This was a
    backend import/export cleanup only; no folder move, schema migration, or
    language conversion was needed.
400. Tighten import product signature and ZIP-file selection callbacks. Done:
    `backend/src/services/importJobs.js` now shares
    `findProductWithSignature()` for same-name product signature matching in
    review, preflight, and apply paths, and `getUnprocessedJobFiles()` for ZIP
    extraction selection. This preserves signature equality, imported
    signature fallback, merge-target validation, conflict classification, ZIP
    processed-file skipping, and queue behavior. This was a backend
    import-service cleanup only; no folder move, schema migration, or language
    conversion was needed.
401. Clear final import-service callback chain. Done:
    `backend/src/services/importJobs.js` now uses
    `buildSafeCatalogOptionList()` for brand-option cleanup after product
    imports, preserving text normalization, blank filtering, suspicious catalog
    text rejection, and `normalizeOptionList()` de-duplication. A callback
    scan now reports no `map()`, `filter()`, `forEach()`, `reduce()`, `find()`,
    or `Array.from()` hits in the import service. This was a backend
    import-service cleanup only; no folder move, schema migration, or language
    conversion was needed.
402. Tighten product-route branch and sorted-map helpers. Done:
    `backend/src/routes/products.js` now shares direct-loop helpers for default
    branch selection, branch-by-id lookup, branch-by-name lookup, bounded set
    materialization, sorted map values, and import same-detail product
    matching. A callback scan now reports no `map()`, `filter()`, `forEach()`,
    `reduce()`, `find()`, or `Array.from()` hits in the product route. This
    was a backend product-route cleanup only; no folder move, schema migration,
    or language conversion was needed.
403. Tighten inventory product family expansion helpers. Done:
    `backend/src/routes/inventory.js` now shares direct-loop helpers for
    family root ID collection, merged family-row sorting, and inventory product
    row comparison. A callback scan now reports no `map()`, `filter()`,
    `forEach()`, `reduce()`, `find()`, or `Array.from()` hits in the inventory
    route. This was a backend inventory-route cleanup only; no folder move,
    schema migration, or language conversion was needed.
404. Tighten sale stock availability sampling. Done:
    `backend/src/routes/sales.js` now uses `findSaleItemForProduct()` for the
    insufficient-stock error sample instead of an inline `find()` callback.
    A callback scan now reports no `map()`, `filter()`, `forEach()`,
    `reduce()`, `find()`, or `Array.from()` hits in the sales route. This was
    a backend sales-route cleanup only; no folder move, schema migration, or
    language conversion was needed.
405. Tighten contact import, search, scoped-ID, and point-summary helpers.
    Done: `backend/src/routes/contacts.js` now shares direct-loop helpers for
    provided import row shaping, searchable-field haystacks, scoped customer
    ID parsing, point-summary scope placeholders, customer row maps, point
    summary defaults, and response decoration. A callback scan now reports no
    `map()`, `filter()`, `forEach()`, `reduce()`, `find()`, `flatMap()`, or
    `Array.from()` hits in the contacts route. This was a backend
    contacts-route cleanup only; no folder move, schema migration, or language
    conversion was needed.
406. Tighten auth/user selection helpers. Done: `backend/src/routes/auth.js`
    now selects the first valid password-reset redirect through
    `findFirstHttpUrl()`, and `backend/src/routes/users.js` now selects UUID
    candidates and linked provider identities through direct-loop helpers. A
    callback scan now reports no `map()`, `filter()`, `forEach()`, `reduce()`,
    `find()`, `flatMap()`, or `Array.from()` hits in the auth or users routes.
    This was a backend auth/users-route cleanup only; no folder move, schema
    migration, or language conversion was needed.
407. Clear backend route callback-chain scan. Done:
    `backend/src/routes/system/index.js` now uses named direct-loop helpers for
    import-stop ID messages, migration counts, settings reads/writes, row
    totals, custom-table discovery, reset/factory-reset broadcasts, sync push
    response shaping, integrity repair broadcasts, folder roots, visible
    directories, and picker script assembly. A callback scan now reports no
    `map()`, `filter()`, `forEach()`, `reduce()`, `find()`, `flatMap()`, or
    `Array.from()` hits anywhere under `backend/src/routes`. This was a
    backend system-route cleanup only; no folder move, schema migration, or
    language conversion was needed.
408. Clear backend service callback-chain scan. Done:
    `backend/src/services/backupPackages.js` now uses direct helpers for
    writable waiters, object-copy worker promises, grouped remote package
    values, and backup-version sorting inputs, while
    `backend/src/services/googleDriveSync/index.js` uses a direct reusable
    non-folder sibling selector. A callback scan now reports no `map()`,
    `filter()`, `forEach()`, `reduce()`, `find()`, `flatMap()`, or
    `Array.from()` hits anywhere under `backend/src/services`. This was a
    backend service cleanup only; no folder move, schema migration, or language
    conversion was needed.
409. Tighten backup summary and catalog text utility loops. Done:
    `backend/src/backupSchema.js` now counts backup rows and totals with
    direct loops, and `backend/src/catalogTextIntegrity.js` now detects
    suspicious fields and normalizes option lists with direct loops. Backup
    summary keys, custom-table totals, suspicious-text rules, de-duplication,
    and locale sorting remain unchanged. This was a backend utility cleanup
    only; no folder move, schema migration, or language conversion was needed.
410. Tighten contact option normalization helpers. Done:
    `backend/src/contactOptions.js` now uses direct-loop helpers for stored
    structured options, legacy string options, fallback options, serialization
    cleanup, primary option selection, and data checks. The three-option cap,
    address-vs-area rules, default labels, legacy migration behavior, and JSON
    shape remain unchanged. This was a backend utility cleanup only; no folder
    move, schema migration, or language conversion was needed.
411. Tighten startup/runtime infrastructure helper loops. Done:
    `backend/src/config/index.js`, `backend/src/dataPath/index.js`,
    `backend/src/organizationContext/index.js`, `backend/src/settingsSnapshot.js`,
    and `backend/src/runtimeVersion.js` now use direct loops for env
    candidates, folder creation, settings snapshot sanitizing, first existing
    runtime directory selection, and source-hash file filtering. This was a
    backend infrastructure utility cleanup only; no folder move, schema
    migration, or language conversion was needed.
412. Tighten CSV import parsing loops. Done:
    `backend/src/importCsv.js` now uses direct-loop helpers for delimiter
    detection, header normalization, parsed row materialization, streaming
    header setup, row-content checks, and CSV value-to-row projection. BOM
    handling, delimiter priority, quote/CRLF parsing, Khmer text and digit
    preservation, row numbers, batch sizing, and empty-row filtering remain
    unchanged. This was a backend parser cleanup only; no folder move, schema
    migration, or language conversion was needed.
413. Tighten product import policy list helpers. Done:
    `backend/src/productImportPolicies.js` now uses direct-loop helpers for
    array/JSON/string list normalization, lowercase uniqueness set
    construction, and append-unique merging. JSON-array support,
    `|`/`;`/newline splitting, case-insensitive de-duplication, imported item
    ordering, and ` | ` serialization remain unchanged. This was a backend
    import-policy cleanup only; no folder move, schema migration, or language
    conversion was needed.
414. Tighten schema/security/runtime helper loops. Done:
    `backend/src/schemaMetadata.js`, `backend/src/middleware.js`,
    `backend/src/security.js`, `backend/src/netSecurity.js`, and
    `backend/src/storage/organizationFolders.js` now use direct-loop helpers
    for column candidates, permission keys, any-permission checks,
    rate/abuse timestamp pruning, private IPv4 parsing, blocked host suffixes,
    and organization folder discovery. This was a backend utility cleanup only;
    no folder move, schema migration, or language conversion was needed.
415. Tighten system job lifecycle helpers. Done:
    `backend/src/systemJobs.js` now uses direct-loop helpers for migration
    statement execution, finished-job collection, old finished job cleanup,
    persisted job row serialization, and in-memory job listing. Stale recovery,
    persistence throttling, completed-job cap, listing order, and public job
    shape remain unchanged. This was a backend runtime utility cleanup only; no
    folder move, schema migration, or language conversion was needed.
416. Tighten file-asset reference and orphan helpers. Done:
    `backend/src/fileAssets.js` now uses direct-loop helpers for upload
    reference recursion, persisted reference collection, reference backfill
    registration, tracked upload path collection, object/local orphan scans,
    storage-delete key collection, usage map seeding, settings/submission usage
    expansion, and asset row serialization. R2 key normalization, local upload
    deletion rules, backfill metadata, usage labels, `canDelete`, and browser
    public paths remain unchanged. This was a backend media/storage utility
    cleanup only; no folder move, schema migration, or language conversion was
    needed.
417. Tighten product-batch stock hierarchy helpers. Done:
    `backend/src/productBatches.js` now uses direct-loop helpers for product ID
    normalization, placeholder construction, batch ID extraction, tracked-batch
    detection, product-batch grouping, branch rollup aggregation, legacy batch
    zeroing, branch quantity seeding, force-migration ID listing, and
    availability totals. FEFO ordering, branch rollup math, synthetic legacy
    batches, allocation restore behavior, and public helper exports remain
    unchanged. This was a backend stock-hierarchy utility cleanup only; no
    folder move, schema migration, or language conversion was needed.
418. Tighten shared backend helper loops. Done:
    `backend/src/helpers.js` now uses direct-loop helpers for CSV non-empty
    line filtering, header normalization, parsed-row construction, backup
    import placeholder/value construction, returned-item quantity maps,
    fully-returned sale detection, integrity success checks, and sale profit
    COGS totals. CSV row numbering, backup import ignore behavior, sale status
    repair semantics, integrity response shape, and profit calculations remain
    unchanged. This was a backend shared-helper cleanup only; no folder move,
    schema migration, or language conversion was needed.
419. Tighten object-store helper loops. Done:
    `backend/src/objectStore.js` now uses direct-loop helpers for Cloudflare
    R2 API query construction, delete-key normalization and de-duplication,
    bulk delete object descriptors, Cloudflare object-list serialization, and
    S3 object-list serialization. S3/R2 driver selection, R2 API fallback
    conditions, timeout handling, delete chunk sizing, and list payload shape
    remain unchanged. This was a backend storage utility cleanup only; no
    folder move, schema migration, or language conversion was needed.
420. Tighten server utility host and sanitizer helpers. Done:
    `backend/src/serverUtils.js` now uses direct-loop helpers for configured
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
    `backend/src/permissions.js` now uses direct-loop helpers for permission
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
    `backend/src/accessControl.js`, `backend/src/maintenanceLock.js`, and
    `backend/src/uploadSecurity.js` now use direct-loop helpers or named
    predicates for public API allowlist matching, maintenance-lock write
    allowlisting, read-only method checks, and upload magic-byte matching.
    Public route behavior, maintenance 423 responses, upload type detection,
    and security test coverage remain unchanged. This was a backend predicate
    cleanup only; no folder move, schema migration, or language conversion was
    needed.
425. Tighten Postgres compatibility and cutover-readiness scans. Done:
    `backend/src/db/postgresQueryCompat.js` and
    `backend/src/db/cutoverReadiness.js` now use direct-loop helpers for
    numeric field matching, row coercion, forbidden-pattern scans, blocker
    counts, summary rows, and multi-file blocker collection. SQL translation,
    numeric coercion exceptions, cutover blockers, packaged-runtime gating,
    and report shapes remain unchanged. This was a backend database-runtime
    cleanup only; no folder move, schema migration, or language conversion was
    needed.
426. Tighten synchronous Postgres runtime bridge helpers. Done:
    `backend/src/postgresDatabase.js` now uses direct-loop helpers for query
    row coercion, semicolon-split exec statement materialization, runtime
    schema/index statement execution, and default role seeding. Statement
    translation, transaction boundaries, runtime DDL order, default
    organization/bootstrap behavior, and role seed updates remain unchanged.
    This was a backend database-runtime cleanup only; no folder move, schema
    migration, or language conversion was needed.
427. Tighten small route predicate helpers. Done:
    `backend/src/routes/branches.js`, `backend/src/routes/inventory.js`,
    `backend/src/routes/portal.js`, `backend/src/routes/settings.js`, and
    `backend/src/routes/sync.js` now use named direct-loop helpers for paged
    branch-stock query detection, inventory stats filters, portal AI profile
    preferences, suspicious brand option checks, sync conflict detection, and
    replay success checks. Route registration, validation messages, conflict
    status codes, and offline replay behavior remain unchanged. This was a
    backend route predicate cleanup only; no folder move, schema migration, or
    language conversion was needed.
428. Tighten upload reference cleanup loops. Done:
    `backend/src/uploadReferenceCleanup.js` now uses direct row loops for
    settings, product image, product, user avatar, file asset, and
    customer-share screenshot repair passes. Sanitization rules,
    gallery-primary fallback behavior, delete-vs-update decisions, summary
    counters, and public cleanup exports remain unchanged. This was a backend
    media/storage cleanup only; no folder move, schema migration, or language
    conversion was needed.
429. Clear remaining backend source callback-chain scan. Done:
    `backend/src/importCsv.js`, `backend/src/services/integrationDoctor.js`,
    and `backend/src/services/googleDriveSync/index.js` now use named
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
