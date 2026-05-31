# Language Runtime Audit

Generated: 2026-05-31T01:17:21.472Z

## Summary

- Mode: non-mutating audit.
- Files scanned: 458
- Scan roots: `frontend/src`, `frontend/tests`, `backend/src`, `backend/test`, `ops/scripts`, `ops/config`, `run`
- Default frontend runtime: React/JavaScript
- Default backend runtime: Node.js
- Preferred heavy-data path: SQL/DuckDB before new general-purpose runtimes
- Browser CPU path: Web Workers before server round-trips or WASM
- Packaging gate: No backend language/runtime conversion without release packaging and rollback proof.
- Missing proof commands: 0
- Focused test coverage gaps: 0
- Converted TypeScript coverage gaps: 0
- Completed Web Worker coverage gaps: 0
- Completed data-path coverage gaps: 0

## Language Counts

| Language | Files |
| --- | --- |
| TypeScript | 319 |
| React TSX | 107 |
| Windows batch | 16 |
| PowerShell | 8 |
| Shell | 3 |
| JSON | 2 |
| SQL | 2 |
| CSS | 1 |

## Conversion Candidates

| Track | File | Lines | Score | Rule |
| --- | --- | --- | --- | --- |
| Web Worker extraction | frontend/src/components/products/scanning/scanbotScanner.ts | 180 | 5 | Browser CPU/file parsing/media work candidate. |

## First Executable Slices

| Track | First candidate | Lines | Score | Required proof |
| --- | --- | --- | --- | --- |
| TypeScript utility conversion | none | 0 | 0 | `npm.cmd --prefix frontend run typecheck`<br>`npm.cmd --prefix frontend run test:utils`<br>`npm.cmd --prefix frontend run build`<br>`rg old import path after rename or extension change` |
| Web Worker extraction | `frontend/src/components/products/scanning/scanbotScanner.ts` | 180 | 5 | `npm.cmd --prefix frontend run test:utils`<br>`npm.cmd --prefix frontend run build`<br>`focused Playwright flow for the affected import/scanner/media action`<br>`fallback path when Worker construction fails` |
| SQL/DuckDB/data-path optimization | none | 0 | 0 | `npm.cmd --prefix backend run test:utils`<br>`node ops\scripts\backend\schema-audit.ts`<br>`backup/restore or count-diff rehearsal for changed data paths`<br>`before/after timing on the same fixture` |

## Verification Matrix

| Track | Required proof | Rollback | Approval boundary |
| --- | --- | --- | --- |
| TypeScript utility conversion | `npm.cmd --prefix frontend run typecheck`<br>`npm.cmd --prefix frontend run test:utils`<br>`npm.cmd --prefix frontend run build`<br>`rg old import path after rename or extension change` | Keep the original module path or add a temporary wrapper until every import and test is updated. | Allowed only for pure helpers with no React render boundary and no packaging change. |
| Web Worker extraction | `npm.cmd --prefix frontend run test:utils`<br>`npm.cmd --prefix frontend run build`<br>`focused Playwright flow for the affected import/scanner/media action`<br>`fallback path when Worker construction fails` | Keep the synchronous helper as a fallback until browser and worker tests pass. | Allowed only for browser CPU, file parsing, scanner, image, or media preprocessing hot paths. |
| SQL/DuckDB/data-path optimization | `npm.cmd --prefix backend run test:utils`<br>`node ops\scripts\backend\schema-audit.ts`<br>`backup/restore or count-diff rehearsal for changed data paths`<br>`before/after timing on the same fixture` | Keep the Node.js path as the correctness oracle until timing and data diffs agree. | Allowed for import, reporting, analytics, backup, or verification work with measurable data volume. |

## Proof Command Coverage

| Track | Proof | Type | Target | Covered |
| --- | --- | --- | --- | --- |
| TypeScript utility conversion | `npm.cmd --prefix frontend run typecheck` | package-script | frontend/package.json scripts.typecheck | yes |
| TypeScript utility conversion | `npm.cmd --prefix frontend run test:utils` | package-script | frontend/package.json scripts.test:utils | yes |
| TypeScript utility conversion | `npm.cmd --prefix frontend run build` | package-script | frontend/package.json scripts.build | yes |
| TypeScript utility conversion | `rg old import path after rename or extension change` | external-tool | ripgrep available in developer workflow | yes |
| Web Worker extraction | `npm.cmd --prefix frontend run test:utils` | package-script | frontend/package.json scripts.test:utils | yes |
| Web Worker extraction | `npm.cmd --prefix frontend run build` | package-script | frontend/package.json scripts.build | yes |
| Web Worker extraction | `focused Playwright flow for the affected import/scanner/media action` | manual-proof | manual verification evidence required in the implementing slice | yes |
| Web Worker extraction | `fallback path when Worker construction fails` | manual-proof | manual verification evidence required in the implementing slice | yes |
| SQL/DuckDB/data-path optimization | `npm.cmd --prefix backend run test:utils` | package-script | backend/package.json scripts.test:utils | yes |
| SQL/DuckDB/data-path optimization | `node ops\scripts\backend\schema-audit.ts` | local-script | ops/scripts/backend/schema-audit.ts | yes |
| SQL/DuckDB/data-path optimization | `backup/restore or count-diff rehearsal for changed data paths` | manual-proof | manual verification evidence required in the implementing slice | yes |
| SQL/DuckDB/data-path optimization | `before/after timing on the same fixture` | manual-proof | manual verification evidence required in the implementing slice | yes |

## Focused Test Coverage

| Track | Candidate | Candidate exists | Tests | Covered | Command |
| --- | --- | --- | --- | --- | --- |
| Completed TypeScript utility conversion | `frontend/src/utils/csvImport.ts` | yes | yes `frontend/tests/csvImport.test.ts`<br>yes `frontend/tests/productImportPlanner.test.ts` | yes | npm.cmd --prefix frontend run test:utils |
| Web Worker extraction | `frontend/src/components/contacts/ContactImportModal.tsx` | yes | yes `frontend/tests/contactImportWorker.test.ts`<br>yes `frontend/tests/actionStability.test.ts`<br>yes `frontend/tests/performanceLoadingUx.test.ts` | yes | npm.cmd --prefix frontend run test:utils plus focused Playwright import flow |
| Completed Web Worker extraction | `frontend/src/components/inventory/InventoryImportModal.tsx` | yes | yes `frontend/tests/inventoryImportWorker.test.ts`<br>yes `frontend/tests/actionStability.test.ts`<br>yes `frontend/tests/performanceLoadingUx.test.ts` | yes | npm.cmd --prefix frontend run test:utils plus focused Playwright import flow |
| Completed Web Worker extraction | `frontend/src/components/sales/SalesImportModal.tsx` | yes | yes `frontend/tests/salesImportWorker.test.ts`<br>yes `frontend/tests/actionStability.test.ts`<br>yes `frontend/tests/performanceLoadingUx.test.ts` | yes | npm.cmd --prefix frontend run test:utils plus focused Playwright import flow |
| SQL/DuckDB/data-path optimization | `backend/src/services/backupPackages.ts` | yes | yes `backend/test/backupPerformanceHardening.test.ts`<br>yes `backend/test/backupRetention.test.ts`<br>yes `backend/test/backupSchema.test.ts` | yes | npm.cmd --prefix backend run test:utils |

## Converted TypeScript Slices

| Implementation | Exists | Compatibility wrapper | Wrapper exists | Declaration support | Declarations exist | Proof |
| --- | --- | --- | --- | --- | --- | --- |
| `frontend/src/app/appShellUtils.ts` | yes | retired after callers moved to TypeScript source | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\appShellUtils.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/runtime/runtimeErrorClassifier.ts` | yes | retired after callers moved to TypeScript source | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\runtimeErrorClassifier.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/public-runtime/runtime-noise-guard.ts` | yes | `frontend/public/runtime-noise-guard.js` | yes | none | yes | `npm.cmd --prefix frontend run verify:public-runtime`<br>`npm.cmd --prefix frontend run test:utils`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/public-runtime/theme-bootstrap.ts` | yes | `frontend/public/theme-bootstrap.js` | yes | none | yes | `npm.cmd --prefix frontend run verify:public-runtime`<br>`npm.cmd --prefix frontend run test:utils`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/public-runtime/service-worker.ts` | yes | `frontend/public/sw.js` | yes | none | yes | `npm.cmd --prefix frontend run verify:public-runtime`<br>`npm.cmd --prefix frontend run test:utils`<br>`npm.cmd --prefix frontend run build` |
| `backend/server.ts` | yes | `backend/server.js` | yes | none | yes | `npm.cmd --prefix backend run verify:server-entry`<br>`npm.cmd --prefix backend run test:utils`<br>`npm.cmd --prefix backend run build:linux` |
| `ops/config/ecosystem.config.ts` | yes | `ops/config/ecosystem.config.js` | yes | none | yes | `npm.cmd --prefix ops run verify:ecosystem-config`<br>`node ops\scripts\architecture\phase29-audit.ts`<br>`run\sh\start-server.sh keeps ECOSYSTEM pointed at ops/config/ecosystem.config.js` |
| `frontend/src/components/catalog/portalCatalogDisplay.ts` | yes | retired frontend/src/components/catalog/portalCatalogDisplay.mjs | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\portalCatalogDisplay.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/components/catalog/portalContentI18n.ts` | yes | retired frontend/src/components/catalog/portalContentI18n.mjs | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\portalContentI18n.test.ts`<br>`node frontend\tests\portalFaqVocabulary.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/components/catalog/portalEditorUtils.ts` | yes | retired frontend/src/components/catalog/portalEditorUtils.mjs | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\portalEditorUtils.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/components/catalog/portalLanguagePacks.ts` | yes | retired after catalog surfaces and tests moved to TypeScript source | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\portalLanguagePacks.test.ts`<br>`node frontend\tests\portalFaqVocabulary.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/components/contacts/contactOptionUtils.ts` | yes | retired after contact callers moved to TypeScript source | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\pricingContacts.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/components/inventory/movementGroups.ts` | yes | retired after inventory callers moved to TypeScript source | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\inventoryMovementGroups.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/components/pos/posCore.ts` | yes | `frontend/src/components/pos/posCore.ts` | yes | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\posCore.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/utils/csvImport.ts` | yes | retired after CSV import callers moved to TypeScript source | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\csvImport.test.ts`<br>`node frontend\tests\productImportPlanner.test.ts` |
| `frontend/src/utils/csvRowCounter.ts` | yes | retired after import modals and workers moved to TypeScript source | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\inventoryImportWorker.test.ts`<br>`node frontend\tests\salesImportWorker.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/utils/formatters.ts` | yes | retired after frontend callers moved to TypeScript source | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\formatters.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/utils/groupedRecords.ts` | yes | retired after list surfaces and tests moved to TypeScript source | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\groupedRecords.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/utils/initials.ts` | yes | retired after product, inventory, POS, catalog, and tests moved to TypeScript source | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\initials.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/utils/mediaUpload.ts` | yes | retired after frontend callers moved to TypeScript source | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\mediaUploadHelpers.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/utils/pricing.ts` | yes | retired after pricing callers moved to TypeScript source | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\pricingContacts.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/utils/productGrouping.ts` | yes | retired after Products, Inventory, POS, and tests moved to TypeScript source | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\productGrouping.test.ts`<br>`node frontend\tests\posCore.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/components/products/helpers/productDisplayHelpers.ts` | yes | `frontend/src/components/products/helpers/productDisplayHelpers.ts` | yes | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\productDisplayHelpers.test.ts`<br>`node frontend\tests\productPageHelpers.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/components/products/helpers/productFilterHelpers.ts` | yes | `frontend/src/components/products/helpers/productFilterHelpers.ts` | yes | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\productFilterHelpers.test.ts`<br>`node frontend\tests\productSearchPagination.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/components/products/helpers/productMenuHelpers.ts` | yes | `frontend/src/components/products/helpers/productMenuHelpers.ts` | yes | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\productMenuHelpers.test.ts`<br>`node frontend\tests\productSearchPagination.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/components/products/helpers/productWriteHelpers.ts` | yes | `frontend/src/components/products/helpers/productWriteHelpers.ts` | yes | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\productWriteHelpers.test.ts`<br>`node frontend\tests\actionStability.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/components/products/helpers/productGalleryHelpers.ts` | yes | retired after Products and focused tests moved to TypeScript source | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\productGalleryHelpers.test.ts`<br>`node frontend\tests\productWriteHelpers.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/components/products/helpers/productGroupViewHelpers.ts` | yes | `frontend/src/components/products/helpers/productGroupViewHelpers.ts` | yes | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\productGroupViewHelpers.test.ts`<br>`node frontend\tests\productPageHelpers.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/components/products/helpers/productSelectionHelpers.ts` | yes | `frontend/src/components/products/helpers/productSelectionHelpers.ts` | yes | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\productSelectionHelpers.test.ts`<br>`node frontend\tests\productSearchPagination.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/components/products/history/productHistoryHelpers.ts` | yes | `frontend/src/components/products/history/productHistoryHelpers.ts` | yes | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\productHistoryHelpers.test.ts`<br>`node frontend\tests\historyHelpers.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/components/products/scanning/barcodeImageScanner.ts` | yes | `frontend/src/components/products/scanning/barcodeImageScanner.ts` | yes | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\barcodeImageScanner.test.ts`<br>`node frontend\tests\scanbotScanner.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/components/products/scanning/barcodeScannerState.ts` | yes | `frontend/src/components/products/scanning/barcodeScannerState.ts` | yes | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\barcodeScannerState.test.ts`<br>`node frontend\tests\scanbotScanner.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/utils/bulkOps.ts` | yes | retired frontend/src/utils/bulkOps.mjs | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\bulkOps.test.ts`<br>`node frontend\tests\actionStability.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/components/products/import/productImportPlanner.ts` | yes | none | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\productImportPlanner.test.ts`<br>`node frontend\tests\performanceLoadingUx.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/components/products/import/productImportWorker.ts` | yes | none | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\productImportPlanner.test.ts`<br>`node frontend\tests\performanceLoadingUx.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/components/receipt-settings/constants.ts` | yes | retired after receipt settings callers moved to TypeScript source | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\receiptTemplate.test.ts`<br>`node frontend\tests\receiptSettingsSync.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/components/contacts/customerMembershipNumber.ts` | yes | retired after contact callers moved to TypeScript source | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\pricingContacts.test.ts`<br>`node frontend\tests\performanceLoadingUx.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/components/dashboard/charts/index.ts` | yes | retired after dashboard chart callers moved to TypeScript source | n/a | `frontend/src/types/jsx-modules.d.ts` | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\dashboardDataReliability.test.ts`<br>`node frontend\tests\performanceLoadingUx.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/components/receipt-settings/template.ts` | yes | retired after receipt settings callers moved to TypeScript source | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\receiptTemplate.test.ts`<br>`node frontend\tests\receiptSettingsSync.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/components/shared/navigationConfig.ts` | yes | retired after navigation callers moved to TypeScript source | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\navigationConfig.test.ts`<br>`node frontend\tests\sectionNavigation.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/components/utils-settings/index.ts` | yes | retired after utility settings callers moved to TypeScript source | n/a | `frontend/src/types/jsx-modules.d.ts` | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\utilsSettingsBarrel.test.ts`<br>`node frontend\tests\sectionNavigation.test.ts`<br>`node frontend\tests\settingsRefresh.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/components/utils-settings/settingsConflict.ts` | yes | retired after Settings page callers moved to TypeScript source | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\settingsConflictHelpers.test.ts`<br>`node frontend\tests\settingsRefresh.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/platform/storage/storagePolicy.ts` | yes | retired frontend/src/platform/storage/storagePolicy.mjs | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\storagePolicy.test.ts`<br>`node frontend\tests\apiHttp.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/utils/actionGuards.ts` | yes | retired frontend/src/utils/actionGuards.mjs | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\actionGuards.test.ts`<br>`node frontend\tests\actionStability.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/utils/color.ts` | yes | retired after frontend callers moved to TypeScript source | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\productPageHelpers.test.ts`<br>`node frontend\tests\productSearchPagination.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/utils/dateHelpers.ts` | yes | retired after frontend callers moved to TypeScript source | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\dateHelpers.test.ts`<br>`node frontend\tests\dashboardDataReliability.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/utils/deviceInfo.ts` | yes | retired after frontend callers moved to TypeScript source | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\deviceInfo.test.ts`<br>`node frontend\tests\apiHttp.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/utils/exportPackage.ts` | yes | retired after export package callers moved to TypeScript source | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\exportPackages.test.ts`<br>`node frontend\tests\dashboardDataReliability.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/utils/historyHelpers.ts` | yes | retired frontend/src/utils/historyHelpers.mjs | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\historyHelpers.test.ts`<br>`node frontend\tests\productHistoryHelpers.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/utils/importJobRefresh.ts` | yes | retired after background import tracker moved to TypeScript source | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\importJobRefresh.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/utils/index.ts` | yes | retired after utility barrel callers moved to TypeScript source | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\formatters.test.ts`<br>`node frontend\tests\dateHelpers.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/utils/permissions.ts` | yes | retired after frontend callers moved to TypeScript source | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\permissions.test.ts`<br>`node frontend\tests\permissionEditor.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/utils/productBatches.ts` | yes | retired frontend/src/utils/productBatches.mjs | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\productBatches.test.ts`<br>`node frontend\tests\productPageHelpers.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/utils/scriptTypography.ts` | yes | retired after frontend callers moved to TypeScript source | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\scriptTypography.test.ts`<br>`node frontend\tests\portalCatalogDisplay.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/utils/settingsRefresh.ts` | yes | retired after API methods and settings callers moved to TypeScript source | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\settingsRefresh.test.ts`<br>`node frontend\tests\appRefresh.test.ts`<br>`npm.cmd --prefix frontend run build` |
| `frontend/src/components/products/config/productPageConfig.ts` | yes | retired frontend/src/components/products/config/productPageConfig.mjs | n/a | none | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\actionStability.test.ts`<br>`node frontend\tests\performanceLoadingUx.test.ts`<br>`npm.cmd --prefix frontend run build` |

## Completed Web Worker Slices

| Surface | Exists | Worker | Worker exists | Fallback | Fallback exists | Proof |
| --- | --- | --- | --- | --- | --- | --- |
| `frontend/src/components/products/import/BulkImportModal.tsx` | yes | `frontend/src/components/products/import/productImportWorker.ts` | yes | `frontend/src/components/products/import/productImportPlanner.ts` | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\productImportWorkerFallback.test.ts`<br>`node frontend\tests\productImportPlanner.test.ts`<br>`node frontend\tests\performanceLoadingUx.test.ts`<br>`npm.cmd --prefix frontend run build`<br>`focused Playwright product import modal flow` |
| `frontend/src/components/contacts/ContactImportModal.tsx` | yes | `frontend/src/components/contacts/contactImportWorker.ts` | yes | `frontend/src/utils/csvRowCounter.ts` | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\contactImportWorker.test.ts`<br>`node frontend\tests\performanceLoadingUx.test.ts`<br>`node frontend\tests\actionStability.test.ts`<br>`npm.cmd --prefix frontend run build`<br>`focused Playwright contact import modal flow` |
| `frontend/src/components/inventory/InventoryImportModal.tsx` | yes | `frontend/src/components/inventory/inventoryImportWorker.ts` | yes | `frontend/src/utils/csvRowCounter.ts` | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\inventoryImportWorker.test.ts`<br>`node frontend\tests\performanceLoadingUx.test.ts`<br>`node frontend\tests\actionStability.test.ts`<br>`npm.cmd --prefix frontend run build`<br>`focused Playwright inventory import modal flow` |
| `frontend/src/components/sales/SalesImportModal.tsx` | yes | `frontend/src/components/sales/salesImportWorker.ts` | yes | `frontend/src/utils/csvRowCounter.ts` | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\salesImportWorker.test.ts`<br>`node frontend\tests\performanceLoadingUx.test.ts`<br>`node frontend\tests\actionStability.test.ts`<br>`npm.cmd --prefix frontend run build`<br>`focused Playwright sales import modal flow` |
| `frontend/src/utils/csv.ts` | yes | `frontend/src/utils/csvExportWorker.ts` | yes | `frontend/src/utils/csv.ts` | yes | `npm.cmd --prefix frontend run typecheck`<br>`node frontend\tests\exportPackages.test.ts`<br>`node frontend\tests\performanceLoadingUx.test.ts`<br>`npm.cmd --prefix frontend run build`<br>`focused Playwright dashboard/inventory/contact export flow` |

## Completed Data-Path Optimizations

| Target | Exists | Optimization | Rollback | Proof |
| --- | --- | --- | --- | --- |
| `backend/src/services/backupPackages.ts` | yes | Backup table streaming now prefers keyset pagination on id and keeps LIMIT/OFFSET as the compatibility fallback. | Revert readTableRows to OFFSET-only paging; streamed checksum/package format remains unchanged. | `npm.cmd --prefix backend run test:utils`<br>`node ops\scripts\backend\schema-audit.ts`<br>`backend/test/backupPerformanceHardening.test.ts keyset guard` |
| `backend/src/services/importJobs.ts` | yes | Product import apply now caches same-name product lookups and supplier lookups per job, then updates the in-memory product cache when rows create or update products. | Remove getProductsByNameForImport, rememberProductForImport, supplierMap, and return to per-row database lookups; import job schema and row decisions remain unchanged. | `npm.cmd --prefix backend run test:utils`<br>`node ops\scripts\backend\schema-audit.ts`<br>`backend/test/importDecisionIntegrity.test.ts cache guards` |
| `ops/scripts/backend/schema-audit.ts` | yes | Schema audit now parses ALTER TABLE primary-key constraints in a single pre-pass map before walking CREATE TABLE bodies, avoiding one whole-schema regex scan per table. | Restore parsePrimaryKey to run a table-specific ALTER TABLE regex against the full schema text for every parsed table; generated report fields remain unchanged. | `node ops\scripts\backend\schema-audit.ts`<br>`Measure-Command { node ops\scripts\backend\schema-audit.ts | Out-Null }`<br>`npm.cmd --prefix ops run phase29:audit:repeat` |
| `ops/scripts/backend/schema-primary-key-preflight.ts` | yes | Primary-key preflight now materializes table row/null metrics, duplicate-key counts, and unique-index names once in shared CTEs, then reuses those values in the read-only JSON report. | Restore the per-field COUNT and pg_index subqueries inside each json_build_object table block; the output schema remains unchanged. | `npm.cmd --prefix ops run schema-pk-preflight`<br>`node ops\scripts\backend\schema-audit.ts`<br>`npm.cmd --prefix backend run test:utils`<br>`npm.cmd --prefix ops run phase29:audit:repeat` |
| `backend/src/routes/importJobs.ts` | yes | Import-job listing now derives permitted import types from the current user and passes them into listImportJobs so the service can filter by type in SQL before decoration. | Remove getPermittedImportTypes, call listImportJobs with only the limit, and restore the route-level JavaScript permission filter. | `npm.cmd --prefix backend run test:utils`<br>`node backend\test\importDecisionIntegrity.test.ts`<br>`node ops\scripts\backend\schema-audit.ts` |
| `ops/scripts/verification/verify-backup-reliability.ts` | yes | Backup reliability verification now uses a source manifest and grouped required/forbidden text checks, replacing repeated one-off assertions across the same backup, Drive, UI, offline, and automation files. | Inline the individual requireText/forbidText calls again; the checked guard strings and failure messages remain equivalent. | `node ops\scripts\verification\verify-backup-reliability.ts`<br>`npm.cmd --prefix backend run test:utils`<br>`npm.cmd --prefix ops run phase29:audit:repeat` |
| `backend/src/routes/inventory.ts` | yes | RFID session apply now prepares branch, product, branch-stock, movement, product-summary, and session-finalization statements once per request instead of preparing lookups inside each confirmed product row. | Inline the RFID apply db.prepare calls inside the product loop again; RFID confirmed quantity, movement, audit, and session status behavior remain unchanged. | `npm.cmd --prefix backend run test:utils`<br>`node backend\test\rfidRoutes.test.ts`<br>`node ops\scripts\backend\schema-audit.ts` |
| `backend/src/routes/portal.ts` | yes | Portal catalog products now share one image and branch-stock materialization helper plus one payload decorator across full catalog and paged search responses. | Inline the image-map, branch-stock-map, gallery, and badge decoration blocks separately in getPortalProducts and getPortalCatalogProductPage again; public catalog response fields remain unchanged. | `npm.cmd --prefix backend run test:utils`<br>`node backend\test\portalInventoryRegression.test.ts`<br>`node ops\scripts\backend\schema-audit.ts` |
| `backend/src/routes/products.ts` | yes | Image-only bulk import now builds one normalized product-name map before processing uploaded image filenames, replacing a full active-product scan for every image. | Remove productsByImageBaseName and return to allProducts.find inside the image loop; image matching behavior remains name-based. | `npm.cmd --prefix backend run test:utils`<br>`node backend\test\productSearchPagination.test.ts`<br>`node ops\scripts\backend\schema-audit.ts` |
| `backend/src/routes/sales.ts` | yes | Sale creation now prepares the inventory movement insert and optional movement timestamp update once per transaction instead of rebuilding those statements for every sold item. | Move insertSaleMovement and updateSaleMovementCreatedAt back into the per-item allocation block; sale item, batch allocation, movement, and imported timestamp behavior remain unchanged. | `npm.cmd --prefix backend run test:utils`<br>`node backend\test\productBatchHierarchy.test.ts`<br>`node ops\scripts\backend\schema-audit.ts` |
| `backend/src/routes/system/index.ts` | yes | System settings writes now prepare the delete statement once beside the upsert statement, avoiding repeated statement creation when null-valued settings are removed inside the transaction. | Remove deleteSetting and inline db.prepare("DELETE FROM settings WHERE key = ?") in the null-value branch; settings write behavior remains unchanged. | `npm.cmd --prefix backend run test:utils`<br>`node backend\test\routeContracts.test.ts`<br>`node ops\scripts\backend\schema-audit.ts` |

## Runtime Policy

| Runtime | Decision | Evidence required |
| --- | --- | --- |
| TypeScript | target pure helpers first | typecheck, focused tests, build, and unchanged public API |
| SQL/DuckDB | preferred for heavy reports/import verification | before/after timing and backup/restore-safe SQL path |
| Web Workers | preferred for browser CPU/file/media work | UI responsiveness check plus worker fallback path |
| PowerShell | keep for Windows orchestration | launcher compatibility and non-interactive execution |
| Rust/Go/Python/WASM | defer by default | benchmark win, packaging proof, rollback path, and dependency-size review |

## Rejected Runtime Families

| Runtime | Reason |
| --- | --- |
| Rust | No benchmark-backed hot path currently requires native compilation. |
| Go | No standalone service boundary has packaging proof yet. |
| Python | Would add runtime packaging complexity for current Node/SQL-owned flows. |
| WASM | Use only after Web Worker and library options are measured. |

## Rejected Data-Path Candidates

| File | Decision | Reason | Evidence |
| --- | --- | --- | --- |
| `backend/src/db/postgresSchema.sql` | keep under schema-migration protocol, not language/runtime conversion | The canonical schema dump is the data contract, not an executable hot path. Index, primary-key, JSONB, and foreign-key changes need backup, restore rehearsal, orphan checks, rollback SQL, and schema-audit proof before they are applied. | Move 173 inspection found the file ranked because it contains DDL and indexes; ops/docs/SCHEMA-RELATIONSHIPS.md already tracks the safe DDL backlog and migration gates. |
| `ops/scripts/architecture/language-runtime-audit.ts` | keep as Node.js meta-audit and exclude from SQL/DuckDB conversion queue | The script ranks itself because it contains report strings, SQL/data-path proof labels, and completed-slice metadata. It is a small deterministic report generator, not a runtime query or import hot path. | Move 179 inspection found the remaining SQL/DuckDB candidate was the audit script itself after backend routes and service data paths were optimized or governed by schema protocol. |
| `ops/scripts/lib/report-utils.ts` | keep as a shared Node.js report helper and exclude from SQL/DuckDB conversion queue | The helper only formats Markdown tables, digests, output tails, and byte labels. It is now TypeScript-typed, but it is still flagged by path/text report keywords rather than query-heavy runtime behavior or data-volume processing. | Move 210 inspection found no database reads, joins, imports, exports, backup streaming, or analytics loops in the file; Move 628 strengthened the helper with real TypeScript annotations while keeping SQL/DuckDB conversion rejected. |
| `ops/scripts/backend/schema-primary-key-rollback.sql` | keep as rollback DDL under the schema safety protocol | The file is intentionally SQL because it is a rollback artifact for guarded primary-key hardening, not an executable hot path or data-processing runtime. | Move 338 optimized the read-only preflight query and kept rollback SQL as the explicit recovery path required before any primary-key DDL is applied. |

## Rejected Web Worker Candidates

| File | Decision | Reason | Evidence |
| --- | --- | --- | --- |
| `frontend/src/utils/csvImport.ts` | keep as shared parser and fallback oracle | The heavy product import analysis already runs in productImportWorker, contact/inventory/sales row checks already use focused workers, and the remaining generic parseCSV surface has no direct UI caller. | Move 167 inspection found parseCsvRows used by productImportPlanner inside a Worker and by an unused localDb.parseCSV compatibility helper. |
| `frontend/src/components/products/scanning/barcodeImageScanner.ts` | keep on main browser path | Photo barcode scanning depends on FileReader, Image elements, native BarcodeDetector, and zxing BrowserMultiFormatReader image-element decoding; broad Worker extraction would duplicate the path and lose browser compatibility. | Move 168 inspection found DOM image loading and browser detector/zxing boundaries rather than a pure CPU loop that can move safely to a Worker. |
| `frontend/src/components/products/scanning/BarcodeScannerModal.tsx` | keep on React/browser camera path | The modal owns camera permission state, media streams, video refs, requestAnimationFrame scanning, and manual-entry UI. These are DOM and user-permission workflows, not transferable Worker computation. | Move 168 inspection found getUserMedia, video element, permission watcher, BarcodeDetector, zxing controls, and React state tightly coupled to the UI lifecycle. |
| `frontend/src/components/shared/ImageGalleryLightbox.tsx` | keep as React presentation component | The lightbox filters a small image list, clamps an index, handles keyboard navigation, and renders images/thumbnails. It has no decoding, resizing, or heavy image processing loop to transfer. | Move 169 inspection found React state/control rendering and event handlers only; image loading remains normal browser rendering. |
| `frontend/src/utils/importJobRefresh.ts` | keep as main-thread event dispatcher | The helper maps completed import-job types to refresh channels and dispatches sync:update browser events. Moving it to a Worker would add message overhead and lose direct window event dispatch. | Move 169 inspection found small status/type normalization, Set dedupe, and CustomEvent dispatch only; Move 385 converted the helper to TypeScript but kept the same main-thread event boundary. |
| `frontend/src/components/shared/BackgroundImportTracker.tsx` | keep on React main thread | Polls import-job state, dedupes a bounded eight-row list, dispatches completion refreshes, and coordinates UI actions; it has no file parsing, media decoding, or CPU-heavy browser loop worth moving to a Worker. | Move 165 inspection of BackgroundImportTracker.tsx found API orchestration and tiny list transforms only. |

## Boundary

- This audit does not convert files, install runtimes, run migrations, move folders, or delete source.
- React/JavaScript and Node.js remain the default until typecheck, benchmark, packaging, and rollback evidence exists.
- SQL/DuckDB and Web Workers are preferred first for narrow hot paths before Rust, Go, Python, or WASM.
