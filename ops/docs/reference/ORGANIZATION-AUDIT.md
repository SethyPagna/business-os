# Organization Audit

Generated: 2026-06-11T10:52:13.641Z

## Summary

- Scanned roots: `frontend/src`, `frontend/tests`, `backend/src`, `backend/test`, `ops/scripts`, `ops/docs`, `run`
- Scanned root files: `package.json`, `backend/package.json`, `frontend/package.json`, `ops/package.json`
- Files scanned: 661
- Large file threshold: 700 lines
- File read mode: bounded parallel (24)

## File Extensions

| Extension | Files |
| --- | --- |
| .ts | 446 |
| .tsx | 122 |
| .md | 45 |
| .json | 17 |
| .bat | 16 |
| .ps1 | 8 |
| .sh | 3 |
| .css | 2 |
| .sql | 2 |

## Largest Areas

| Area | Files |
| --- | --- |
| frontend/api | 56 |
| frontend/utils | 36 |
| ops/scripts/runtime/live-checks | 35 |
| frontend/components/products | 34 |
| ops/docs/reference | 32 |
| backend/routes | 24 |
| frontend/components/catalog | 19 |
| frontend/components/shared | 19 |
| frontend/components/inventory | 14 |
| ops/docs | 14 |
| backend/services | 12 |
| frontend/components/contacts | 10 |
| run | 9 |
| run/docker | 9 |
| frontend/components/dashboard | 8 |
| frontend/components/pos | 8 |
| frontend/components/receipt-settings | 8 |
| frontend/components/utils-settings | 8 |
| ops/scripts/powershell | 8 |
| frontend/components/sales | 7 |
| ops/scripts/runtime/audits | 7 |
| ops/scripts/runtime/storage | 7 |
| frontend/components/returns | 6 |
| ops/scripts/backend | 6 |
| ops/scripts/runtime/cloudflare | 6 |
| ops/scripts/verification | 6 |
| frontend/app | 5 |
| frontend/components/users | 5 |
| ops/scripts/architecture | 5 |
| frontend/components/files | 4 |

## Large Files

| File | Lines | Area |
| --- | --- | --- |
| ops/docs/OPTIMIZATION-ROADMAP.md | 15615 | ops/docs |
| ops/docs/reference/IMPORT-EXPORT-REFERENCE.md | 12322 | ops/docs/reference |
| ops/docs/reference/ALL-FUNCTION-REFERENCE.md | 10654 | ops/docs/reference |
| ops/docs/FILE-ORGANIZATION-LANGUAGE-PLAN.md | 10069 | ops/docs |
| ops/docs/OPTIMIZATION-STATUS.md | 5352 | ops/docs |
| ops/docs/OPTIMIZATION-SESSION-LOG.md | 5169 | ops/docs |
| backend/src/services/importJobs.ts | 3880 | backend/services |
| frontend/tests/performanceLoadingUx.test.ts | 3700 | frontend/tests/performanceLoadingUx.test.ts |
| ops/docs/reference/FRONTEND-FUNCTION-REFERENCE.md | 3654 | ops/docs/reference |
| frontend/src/components/catalog/CatalogPage.tsx | 3498 | frontend/components/catalog |
| frontend/src/components/inventory/Inventory.tsx | 3488 | frontend/components/inventory |
| ops/docs/reference/PHASE29-AUDIT.json | 3432 | ops/docs/reference |
| frontend/src/lang/km.json | 2730 | frontend/src/lang |
| ops/docs/reference/PERFORMANCE-SCAN.md | 2729 | ops/docs/reference |
| frontend/src/lang/en.json | 2721 | frontend/src/lang |
| frontend/src/components/products/Products.tsx | 2585 | frontend/components/products |
| frontend/src/components/pos/POS.tsx | 2362 | frontend/components/pos |
| backend/src/routes/products.ts | 2310 | backend/routes |
| backend/src/db/postgresSchema.sql | 2190 | backend/db |
| ops/docs/reference/FOLDER-COVERAGE.md | 2184 | ops/docs/reference |
| frontend/src/components/products/import/BulkImportModal.tsx | 2170 | frontend/components/products |
| ops/docs/reference/TRANSLATION-SECTION-REFERENCE.md | 2150 | ops/docs/reference |
| frontend/src/App.tsx | 2009 | frontend/src/App.tsx |
| frontend/src/components/dashboard/Dashboard.tsx | 1970 | frontend/components/dashboard |
| backend/src/routes/inventory.ts | 1962 | backend/routes |
| frontend/src/AppContext.tsx | 1947 | frontend/src/AppContext.tsx |
| frontend/src/components/utils-settings/Settings.tsx | 1911 | frontend/components/utils-settings |
| ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.json | 1886 | ops/docs/reference |
| frontend/src/components/utils-settings/Backup.tsx | 1779 | frontend/components/utils-settings |
| backend/src/routes/system/index.ts | 1674 | backend/routes |

## Relative Import Hotspots

| File | Relative imports | Area |
| --- | --- | --- |
| frontend/src/components/products/Products.tsx | 57 | frontend/components/products |
| frontend/src/components/inventory/Inventory.tsx | 50 | frontend/components/inventory |
| frontend/src/components/pos/POS.tsx | 43 | frontend/components/pos |
| frontend/src/web-api.ts | 36 | frontend/src/web-api.ts |
| frontend/src/api/methods.ts | 35 | frontend/api |
| frontend/src/App.tsx | 30 | frontend/src/App.tsx |
| frontend/src/components/contacts/CustomersTab.tsx | 24 | frontend/components/contacts |
| frontend/src/components/sales/Sales.tsx | 24 | frontend/components/sales |
| frontend/src/components/catalog/CatalogPage.tsx | 23 | frontend/components/catalog |
| frontend/src/components/contacts/DeliveryTab.tsx | 23 | frontend/components/contacts |
| frontend/src/components/contacts/SuppliersTab.tsx | 23 | frontend/components/contacts |
| frontend/src/components/returns/Returns.tsx | 21 | frontend/components/returns |
| backend/src/routes/system/index.ts | 20 | backend/routes |
| backend/src/routes/products.ts | 18 | backend/routes |
| frontend/src/components/utils-settings/Settings.tsx | 17 | frontend/components/utils-settings |
| backend/test/routeContracts.test.ts | 16 | backend/test/routeContracts.test.ts |
| frontend/src/components/dashboard/Dashboard.tsx | 16 | frontend/components/dashboard |
| frontend/src/components/users/Users.tsx | 16 | frontend/components/users |
| frontend/src/AppContext.tsx | 15 | frontend/src/AppContext.tsx |
| frontend/tests/apiHttp.test.ts | 15 | frontend/tests/apiHttp.test.ts |
| backend/src/routes/auth.ts | 14 | backend/routes |
| backend/src/services/importJobs.ts | 14 | backend/services |
| frontend/src/components/contacts/Contacts.tsx | 14 | frontend/components/contacts |
| frontend/src/components/files/FilesPage.tsx | 14 | frontend/components/files |
| frontend/src/components/branches/Branches.tsx | 13 | frontend/components/branches |
| frontend/src/components/products/forms/ProductForm.tsx | 13 | frontend/components/products |
| backend/src/routes/inventory.ts | 12 | backend/routes |
| backend/src/routes/portal.ts | 12 | backend/routes |
| frontend/src/api/contactsTransport.ts | 12 | frontend/api |
| frontend/src/components/returns/NewSupplierReturnModal.tsx | 12 | frontend/components/returns |

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
