# Organization Audit

Generated: 2026-05-27T18:55:55.751Z

## Summary

- Scanned roots: `frontend/src`, `frontend/tests`, `backend/src`, `backend/test`, `ops/scripts`, `ops/docs`, `run`
- Scanned root files: `package.json`, `backend/package.json`, `frontend/package.json`, `ops/package.json`
- Files scanned: 608
- Large file threshold: 700 lines
- File read mode: bounded parallel (24)

## File Extensions

| Extension | Files |
| --- | --- |
| .js | 185 |
| .mjs | 161 |
| .jsx | 107 |
| .ts | 67 |
| .md | 44 |
| .bat | 16 |
| .json | 14 |
| .ps1 | 8 |
| .sh | 3 |
| .sql | 2 |
| .css | 1 |

## Largest Areas

| Area | Files |
| --- | --- |
| frontend/utils | 59 |
| frontend/components/products | 44 |
| ops/docs/reference | 30 |
| backend/routes | 24 |
| frontend/components/shared | 18 |
| frontend/components/catalog | 17 |
| ops/scripts/runtime/live-checks | 17 |
| frontend/components/contacts | 15 |
| ops/docs | 14 |
| backend/services | 12 |
| frontend/components/inventory | 11 |
| frontend/components/receipt-settings | 10 |
| frontend/components/utils-settings | 10 |
| run | 9 |
| run/docker | 9 |
| frontend/components/dashboard | 8 |
| frontend/components/sales | 8 |
| ops/scripts/powershell | 8 |
| frontend/components/pos | 7 |
| ops/scripts/runtime/storage | 7 |
| frontend/components/returns | 6 |
| ops/scripts/runtime/audits | 6 |
| ops/scripts/verification | 6 |
| frontend/api | 5 |
| frontend/app | 4 |
| frontend/components/files | 4 |
| frontend/components/users | 4 |
| ops/scripts/architecture | 4 |
| ops/scripts/backend | 4 |
| ops/scripts/runtime/cloudflare | 4 |

## Large Files

| File | Lines | Area |
| --- | --- | --- |
| ops/docs/reference/PHASE29-AUDIT.json | 11647 | ops/docs/reference |
| ops/docs/reference/IMPORT-EXPORT-REFERENCE.md | 8249 | ops/docs/reference |
| ops/docs/reference/ALL-FUNCTION-REFERENCE.md | 6585 | ops/docs/reference |
| ops/docs/OPTIMIZATION-ROADMAP.md | 4917 | ops/docs |
| frontend/src/components/inventory/Inventory.jsx | 4123 | frontend/components/inventory |
| backend/src/services/importJobs.js | 3880 | backend/services |
| ops/docs/FILE-ORGANIZATION-LANGUAGE-PLAN.md | 3443 | ops/docs |
| frontend/src/components/catalog/CatalogPage.jsx | 3218 | frontend/components/catalog |
| frontend/src/lang/en.json | 2721 | frontend/src/lang |
| frontend/src/lang/km.json | 2715 | frontend/src/lang |
| ops/docs/reference/FRONTEND-FUNCTION-REFERENCE.md | 2681 | ops/docs/reference |
| frontend/src/api/methods.js | 2346 | frontend/api |
| backend/src/routes/products.js | 2218 | backend/routes |
| backend/src/db/postgresSchema.sql | 2148 | backend/db |
| ops/docs/reference/BACKEND-FUNCTION-REFERENCE.md | 2124 | ops/docs/reference |
| ops/docs/reference/TRANSLATION-SECTION-REFERENCE.md | 2105 | ops/docs/reference |
| frontend/tests/performanceLoadingUx.test.mjs | 2077 | frontend/tests/performanceLoadingUx.test.mjs |
| frontend/src/components/dashboard/Dashboard.jsx | 2063 | frontend/components/dashboard |
| frontend/src/components/products/Products.jsx | 2006 | frontend/components/products |
| frontend/src/components/pos/POS.jsx | 1919 | frontend/components/pos |
| frontend/src/components/products/import/BulkImportModal.jsx | 1907 | frontend/components/products |
| backend/src/routes/inventory.js | 1881 | backend/routes |
| ops/docs/reference/FOLDER-COVERAGE.md | 1788 | ops/docs/reference |
| frontend/src/components/utils-settings/Settings.jsx | 1730 | frontend/components/utils-settings |
| ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.json | 1666 | ops/docs/reference |
| backend/src/routes/system/index.js | 1659 | backend/routes |
| frontend/src/AppContext.jsx | 1603 | frontend/src/AppContext.jsx |
| backend/src/routes/sales.js | 1573 | backend/routes |
| backend/src/services/googleDriveSync/index.js | 1564 | backend/services |
| ops/scripts/architecture/language-runtime-audit.mjs | 1531 | ops/scripts/architecture |

## Relative Import Hotspots

| File | Relative imports | Area |
| --- | --- | --- |
| frontend/src/components/products/Products.jsx | 41 | frontend/components/products |
| frontend/src/App.jsx | 29 | frontend/src/App.jsx |
| frontend/src/components/inventory/Inventory.jsx | 29 | frontend/components/inventory |
| backend/src/routes/system/index.js | 20 | backend/routes |
| frontend/src/components/sales/Sales.jsx | 20 | frontend/components/sales |
| frontend/src/components/pos/POS.jsx | 19 | frontend/components/pos |
| frontend/src/components/catalog/CatalogPage.jsx | 18 | frontend/components/catalog |
| frontend/src/components/dashboard/Dashboard.jsx | 18 | frontend/components/dashboard |
| frontend/src/components/returns/Returns.jsx | 18 | frontend/components/returns |
| backend/src/routes/products.js | 17 | backend/routes |
| frontend/src/components/contacts/CustomersTab.jsx | 17 | frontend/components/contacts |
| frontend/src/components/contacts/DeliveryTab.jsx | 16 | frontend/components/contacts |
| frontend/src/components/contacts/SuppliersTab.jsx | 16 | frontend/components/contacts |
| backend/src/services/importJobs.js | 14 | backend/services |
| backend/src/routes/auth.js | 13 | backend/routes |
| frontend/src/AppContext.jsx | 13 | frontend/src/AppContext.jsx |
| frontend/src/components/users/Users.jsx | 13 | frontend/components/users |
| backend/src/routes/portal.js | 12 | backend/routes |
| frontend/src/components/branches/Branches.jsx | 12 | frontend/components/branches |
| frontend/src/components/utils-settings/Settings.jsx | 12 | frontend/components/utils-settings |
| backend/src/routes/inventory.js | 11 | backend/routes |
| frontend/src/components/files/FilesPage.jsx | 11 | frontend/components/files |
| frontend/src/components/contacts/Contacts.jsx | 10 | frontend/components/contacts |
| frontend/src/components/receipt-settings/ReceiptSettings.jsx | 10 | frontend/components/receipt-settings |

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
