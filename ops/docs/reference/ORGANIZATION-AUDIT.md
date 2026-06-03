# Organization Audit

Generated: 2026-06-03T11:45:41.063Z

## Summary

- Scanned roots: `frontend/src`, `frontend/tests`, `backend/src`, `backend/test`, `ops/scripts`, `ops/docs`, `run`
- Scanned root files: `package.json`, `backend/package.json`, `frontend/package.json`, `ops/package.json`
- Files scanned: 600
- Large file threshold: 700 lines
- File read mode: bounded parallel (24)

## File Extensions

| Extension | Files |
| --- | --- |
| .ts | 401 |
| .tsx | 107 |
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
| frontend/api | 41 |
| frontend/components/products | 32 |
| frontend/utils | 32 |
| ops/docs/reference | 32 |
| backend/routes | 24 |
| ops/scripts/runtime/live-checks | 22 |
| frontend/components/shared | 17 |
| ops/docs | 14 |
| frontend/components/catalog | 13 |
| backend/services | 12 |
| frontend/components/contacts | 10 |
| frontend/components/inventory | 9 |
| run | 9 |
| run/docker | 9 |
| frontend/components/receipt-settings | 8 |
| frontend/components/utils-settings | 8 |
| ops/scripts/powershell | 8 |
| frontend/components/dashboard | 7 |
| frontend/components/sales | 7 |
| ops/scripts/runtime/audits | 7 |
| ops/scripts/runtime/storage | 7 |
| frontend/components/pos | 6 |
| frontend/components/returns | 6 |
| ops/scripts/backend | 6 |
| ops/scripts/verification | 6 |
| ops/scripts/architecture | 5 |
| frontend/components/files | 4 |
| frontend/components/users | 4 |
| ops/scripts/frontend | 4 |
| ops/scripts/runtime/cloudflare | 4 |

## Large Files

| File | Lines | Area |
| --- | --- | --- |
| ops/docs/OPTIMIZATION-ROADMAP.md | 9530 | ops/docs |
| ops/docs/reference/IMPORT-EXPORT-REFERENCE.md | 8928 | ops/docs/reference |
| ops/docs/reference/ALL-FUNCTION-REFERENCE.md | 7625 | ops/docs/reference |
| ops/docs/FILE-ORGANIZATION-LANGUAGE-PLAN.md | 7067 | ops/docs |
| frontend/src/components/inventory/Inventory.tsx | 4305 | frontend/components/inventory |
| backend/src/services/importJobs.ts | 3880 | backend/services |
| frontend/src/components/catalog/CatalogPage.tsx | 3539 | frontend/components/catalog |
| ops/docs/reference/PHASE29-AUDIT.json | 3407 | ops/docs/reference |
| ops/docs/reference/FRONTEND-FUNCTION-REFERENCE.md | 3043 | ops/docs/reference |
| frontend/src/lang/km.json | 2730 | frontend/src/lang |
| frontend/src/lang/en.json | 2721 | frontend/src/lang |
| ops/docs/OPTIMIZATION-SESSION-LOG.md | 2602 | ops/docs |
| frontend/tests/performanceLoadingUx.test.ts | 2518 | frontend/tests/performanceLoadingUx.test.ts |
| frontend/src/components/products/Products.tsx | 2450 | frontend/components/products |
| frontend/src/components/pos/POS.tsx | 2382 | frontend/components/pos |
| frontend/src/components/dashboard/Dashboard.tsx | 2376 | frontend/components/dashboard |
| backend/src/routes/products.ts | 2218 | backend/routes |
| ops/docs/reference/TRANSLATION-SECTION-REFERENCE.md | 2150 | ops/docs/reference |
| backend/src/db/postgresSchema.sql | 2148 | backend/db |
| frontend/src/components/products/import/BulkImportModal.tsx | 2147 | frontend/components/products |
| ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.json | 1886 | ops/docs/reference |
| backend/src/routes/inventory.ts | 1881 | backend/routes |
| frontend/src/App.tsx | 1881 | frontend/src/App.tsx |
| frontend/src/AppContext.tsx | 1872 | frontend/src/AppContext.tsx |
| frontend/src/components/utils-settings/Settings.tsx | 1872 | frontend/components/utils-settings |
| ops/docs/reference/FOLDER-COVERAGE.md | 1813 | ops/docs/reference |
| frontend/src/components/utils-settings/Backup.tsx | 1754 | frontend/components/utils-settings |
| ops/scripts/architecture/language-runtime-audit.ts | 1666 | ops/scripts/architecture |
| backend/src/routes/system/index.ts | 1659 | backend/routes |
| ops/docs/reference/PERFORMANCE-SCAN.md | 1617 | ops/docs/reference |

## Relative Import Hotspots

| File | Relative imports | Area |
| --- | --- | --- |
| frontend/src/components/products/Products.tsx | 41 | frontend/components/products |
| frontend/src/api/methods.ts | 38 | frontend/api |
| frontend/src/App.tsx | 29 | frontend/src/App.tsx |
| frontend/src/components/inventory/Inventory.tsx | 29 | frontend/components/inventory |
| frontend/src/components/dashboard/Dashboard.tsx | 21 | frontend/components/dashboard |
| frontend/src/components/sales/Sales.tsx | 21 | frontend/components/sales |
| backend/src/routes/system/index.ts | 20 | backend/routes |
| frontend/src/components/pos/POS.tsx | 20 | frontend/components/pos |
| frontend/src/components/catalog/CatalogPage.tsx | 19 | frontend/components/catalog |
| frontend/src/components/contacts/CustomersTab.tsx | 18 | frontend/components/contacts |
| frontend/src/components/returns/Returns.tsx | 18 | frontend/components/returns |
| backend/src/routes/products.ts | 17 | backend/routes |
| frontend/src/components/contacts/DeliveryTab.tsx | 17 | frontend/components/contacts |
| frontend/src/components/contacts/SuppliersTab.tsx | 17 | frontend/components/contacts |
| backend/test/routeContracts.test.ts | 16 | backend/test/routeContracts.test.ts |
| frontend/tests/apiHttp.test.ts | 15 | frontend/tests/apiHttp.test.ts |
| backend/src/routes/auth.ts | 14 | backend/routes |
| backend/src/services/importJobs.ts | 14 | backend/services |
| frontend/src/AppContext.tsx | 14 | frontend/src/AppContext.tsx |
| frontend/src/web-api.ts | 14 | frontend/src/web-api.ts |
| frontend/src/components/users/Users.tsx | 13 | frontend/components/users |
| frontend/src/components/utils-settings/Settings.tsx | 13 | frontend/components/utils-settings |
| backend/src/routes/portal.ts | 12 | backend/routes |
| frontend/src/components/branches/Branches.tsx | 12 | frontend/components/branches |
| backend/src/routes/inventory.ts | 11 | backend/routes |
| frontend/src/components/files/FilesPage.tsx | 11 | frontend/components/files |
| frontend/src/components/receipt-settings/ReceiptSettings.tsx | 11 | frontend/components/receipt-settings |
| frontend/src/components/contacts/Contacts.tsx | 10 | frontend/components/contacts |

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
