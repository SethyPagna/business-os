# Organization Audit

Generated: 2026-06-06T20:25:33.638Z

## Summary

- Scanned roots: `frontend/src`, `frontend/tests`, `backend/src`, `backend/test`, `ops/scripts`, `ops/docs`, `run`
- Scanned root files: `package.json`, `backend/package.json`, `frontend/package.json`, `ops/package.json`
- Files scanned: 640
- Large file threshold: 700 lines
- File read mode: bounded parallel (24)

## File Extensions

| Extension | Files |
| --- | --- |
| .ts | 435 |
| .tsx | 113 |
| .md | 45 |
| .json | 17 |
| .bat | 16 |
| .ps1 | 8 |
| .sh | 3 |
| .sql | 2 |
| .css | 1 |

## Largest Areas

| Area | Files |
| --- | --- |
| frontend/api | 53 |
| frontend/utils | 34 |
| frontend/components/products | 33 |
| ops/docs/reference | 32 |
| ops/scripts/runtime/live-checks | 32 |
| backend/routes | 24 |
| frontend/components/shared | 19 |
| frontend/components/catalog | 18 |
| ops/docs | 14 |
| backend/services | 12 |
| frontend/components/contacts | 10 |
| frontend/components/inventory | 10 |
| run | 9 |
| run/docker | 9 |
| frontend/components/dashboard | 8 |
| frontend/components/receipt-settings | 8 |
| frontend/components/utils-settings | 8 |
| ops/scripts/powershell | 8 |
| frontend/components/sales | 7 |
| ops/scripts/runtime/audits | 7 |
| ops/scripts/runtime/storage | 7 |
| frontend/components/pos | 6 |
| frontend/components/returns | 6 |
| ops/scripts/backend | 6 |
| ops/scripts/verification | 6 |
| frontend/components/users | 5 |
| ops/scripts/architecture | 5 |
| ops/scripts/runtime/cloudflare | 5 |
| frontend/components/files | 4 |
| ops/scripts/frontend | 4 |

## Large Files

| File | Lines | Area |
| --- | --- | --- |
| ops/docs/OPTIMIZATION-ROADMAP.md | 12470 | ops/docs |
| ops/docs/reference/IMPORT-EXPORT-REFERENCE.md | 8928 | ops/docs/reference |
| ops/docs/FILE-ORGANIZATION-LANGUAGE-PLAN.md | 8400 | ops/docs |
| ops/docs/reference/ALL-FUNCTION-REFERENCE.md | 7625 | ops/docs/reference |
| ops/docs/OPTIMIZATION-SESSION-LOG.md | 4180 | ops/docs |
| frontend/src/components/inventory/Inventory.tsx | 4006 | frontend/components/inventory |
| backend/src/services/importJobs.ts | 3880 | backend/services |
| frontend/src/components/catalog/CatalogPage.tsx | 3602 | frontend/components/catalog |
| ops/docs/reference/FRONTEND-FUNCTION-REFERENCE.md | 3432 | ops/docs/reference |
| ops/docs/reference/PHASE29-AUDIT.json | 3263 | ops/docs/reference |
| frontend/tests/performanceLoadingUx.test.ts | 3205 | frontend/tests/performanceLoadingUx.test.ts |
| frontend/src/lang/km.json | 2730 | frontend/src/lang |
| frontend/src/lang/en.json | 2721 | frontend/src/lang |
| frontend/src/components/products/Products.tsx | 2553 | frontend/components/products |
| frontend/src/components/pos/POS.tsx | 2489 | frontend/components/pos |
| ops/docs/OPTIMIZATION-STATUS.md | 2402 | ops/docs |
| backend/src/routes/products.ts | 2277 | backend/routes |
| ops/docs/reference/PERFORMANCE-SCAN.md | 2179 | ops/docs/reference |
| frontend/src/components/products/import/BulkImportModal.tsx | 2170 | frontend/components/products |
| ops/docs/reference/TRANSLATION-SECTION-REFERENCE.md | 2150 | ops/docs/reference |
| backend/src/db/postgresSchema.sql | 2148 | backend/db |
| frontend/src/components/dashboard/Dashboard.tsx | 1984 | frontend/components/dashboard |
| frontend/src/AppContext.tsx | 1978 | frontend/src/AppContext.tsx |
| frontend/src/components/utils-settings/Settings.tsx | 1911 | frontend/components/utils-settings |
| frontend/src/App.tsx | 1905 | frontend/src/App.tsx |
| backend/src/routes/inventory.ts | 1902 | backend/routes |
| ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.json | 1886 | ops/docs/reference |
| ops/docs/reference/FOLDER-COVERAGE.md | 1813 | ops/docs/reference |
| frontend/src/components/utils-settings/Backup.tsx | 1775 | frontend/components/utils-settings |
| backend/src/routes/system/index.ts | 1674 | backend/routes |

## Relative Import Hotspots

| File | Relative imports | Area |
| --- | --- | --- |
| frontend/src/components/products/Products.tsx | 55 | frontend/components/products |
| frontend/src/components/inventory/Inventory.tsx | 46 | frontend/components/inventory |
| frontend/src/api/methods.ts | 41 | frontend/api |
| frontend/src/web-api.ts | 36 | frontend/src/web-api.ts |
| frontend/src/components/pos/POS.tsx | 35 | frontend/components/pos |
| frontend/src/App.tsx | 29 | frontend/src/App.tsx |
| frontend/src/components/contacts/CustomersTab.tsx | 24 | frontend/components/contacts |
| frontend/src/components/sales/Sales.tsx | 24 | frontend/components/sales |
| frontend/src/components/catalog/CatalogPage.tsx | 23 | frontend/components/catalog |
| frontend/src/components/contacts/DeliveryTab.tsx | 23 | frontend/components/contacts |
| frontend/src/components/contacts/SuppliersTab.tsx | 23 | frontend/components/contacts |
| backend/src/routes/system/index.ts | 20 | backend/routes |
| frontend/src/components/returns/Returns.tsx | 19 | frontend/components/returns |
| backend/src/routes/products.ts | 18 | backend/routes |
| frontend/src/components/dashboard/Dashboard.tsx | 17 | frontend/components/dashboard |
| frontend/src/components/utils-settings/Settings.tsx | 17 | frontend/components/utils-settings |
| backend/test/routeContracts.test.ts | 16 | backend/test/routeContracts.test.ts |
| frontend/src/components/users/Users.tsx | 16 | frontend/components/users |
| frontend/tests/apiHttp.test.ts | 15 | frontend/tests/apiHttp.test.ts |
| backend/src/routes/auth.ts | 14 | backend/routes |
| backend/src/services/importJobs.ts | 14 | backend/services |
| frontend/src/AppContext.tsx | 14 | frontend/src/AppContext.tsx |
| frontend/src/components/contacts/Contacts.tsx | 14 | frontend/components/contacts |
| frontend/src/components/files/FilesPage.tsx | 14 | frontend/components/files |
| frontend/src/components/branches/Branches.tsx | 13 | frontend/components/branches |
| frontend/src/components/products/forms/ProductForm.tsx | 13 | frontend/components/products |
| backend/src/routes/portal.ts | 12 | backend/routes |
| frontend/src/api/contactsTransport.ts | 12 | frontend/api |
| backend/src/routes/inventory.ts | 11 | backend/routes |
| frontend/src/components/receipt-settings/ReceiptSettings.tsx | 11 | frontend/components/receipt-settings |

## Compatibility Wrappers

These root entrypoints are intentionally thin wrappers around grouped
implementations. Keep them small until all old paths are gone.

No compatibility wrappers detected.

## Broken Wrapper Targets

No broken compatibility wrapper targets detected.

## Wrapper Removal Candidates

No wrapper removal candidates detected. Every wrapper is still referenced by active first-party files.

## Recommended First Moves

1. Keep Phase 8.4 action stability work moving while organizing nearby product files.
2. Split `frontend/src/components/products` internally only after a passing Products Playwright check is available for each move.
3. Move ops runtime scripts into grouped subfolders with compatibility wrappers before touching high-traffic app source paths.
4. Convert pure frontend utility modules to TypeScript before React components.
5. Delay backend TypeScript conversion until release packaging has a compiled-output story.
