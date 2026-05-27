# All Function Reference (Project First-Party Code)

Auto-generated function/class symbol commentary for all first-party code files (frontend, backend, root scripts/config code).

## 1. Coverage Summary

Code files scanned: **508**

## 2. Symbol Count by File

| No. | File | Symbols |
|---:|---|---:|
| 1 | `backend/server.js` | 23 |
| 2 | `backend/src/accessControl.js` | 18 |
| 3 | `backend/src/analytics/duckdbRuntime.js` | 3 |
| 4 | `backend/src/authOtpGuards.js` | 3 |
| 5 | `backend/src/backupSchema.js` | 4 |
| 6 | `backend/src/businessMetrics.js` | 9 |
| 7 | `backend/src/catalogTextIntegrity.js` | 5 |
| 8 | `backend/src/config/index.js` | 10 |
| 9 | `backend/src/conflictControl.js` | 6 |
| 10 | `backend/src/contactOptions.js` | 8 |
| 11 | `backend/src/database.js` | 0 |
| 12 | `backend/src/dataPath/index.js` | 9 |
| 13 | `backend/src/db/cutoverReadiness.js` | 7 |
| 14 | `backend/src/db/postgresQueryCompat.js` | 11 |
| 15 | `backend/src/fileAssets.js` | 51 |
| 16 | `backend/src/helpers.js` | 20 |
| 17 | `backend/src/idempotency.js` | 1 |
| 18 | `backend/src/importCsv.js` | 12 |
| 19 | `backend/src/importParsing.js` | 6 |
| 20 | `backend/src/initials.js` | 6 |
| 21 | `backend/src/maintenanceLock.js` | 7 |
| 22 | `backend/src/middleware.js` | 21 |
| 23 | `backend/src/money.js` | 3 |
| 24 | `backend/src/netSecurity.js` | 7 |
| 25 | `backend/src/objectStore.js` | 23 |
| 26 | `backend/src/optionalSharp.js` | 1 |
| 27 | `backend/src/organizationContext/index.js` | 14 |
| 28 | `backend/src/permissions.js` | 6 |
| 29 | `backend/src/portalUtils.js` | 6 |
| 30 | `backend/src/postgresDatabase.js` | 13 |
| 31 | `backend/src/productBatches.js` | 29 |
| 32 | `backend/src/productDiscounts.js` | 9 |
| 33 | `backend/src/productImportPolicies.js` | 8 |
| 34 | `backend/src/requestContext.js` | 5 |
| 35 | `backend/src/routes/actionHistory.js` | 11 |
| 36 | `backend/src/routes/ai.js` | 2 |
| 37 | `backend/src/routes/auth.js` | 30 |
| 38 | `backend/src/routes/branches.js` | 6 |
| 39 | `backend/src/routes/catalog.js` | 0 |
| 40 | `backend/src/routes/categories.js` | 2 |
| 41 | `backend/src/routes/contacts.js` | 23 |
| 42 | `backend/src/routes/customTables.js` | 8 |
| 43 | `backend/src/routes/files.js` | 3 |
| 44 | `backend/src/routes/importJobs.js` | 12 |
| 45 | `backend/src/routes/inventory.js` | 22 |
| 46 | `backend/src/routes/notifications.js` | 11 |
| 47 | `backend/src/routes/organizations.js` | 0 |
| 48 | `backend/src/routes/portal.js` | 38 |
| 49 | `backend/src/routes/products.js` | 53 |
| 50 | `backend/src/routes/returns.js` | 10 |
| 51 | `backend/src/routes/runtime.js` | 1 |
| 52 | `backend/src/routes/sales.js` | 23 |
| 53 | `backend/src/routes/settings.js` | 6 |
| 54 | `backend/src/routes/sync.js` | 9 |
| 55 | `backend/src/routes/system/index.js` | 29 |
| 56 | `backend/src/routes/units.js` | 3 |
| 57 | `backend/src/routes/users.js` | 23 |
| 58 | `backend/src/runtimeCache.js` | 11 |
| 59 | `backend/src/runtimeState/index.js` | 6 |
| 60 | `backend/src/runtimeVersion.js` | 7 |
| 61 | `backend/src/security.js` | 13 |
| 62 | `backend/src/serverUtils.js` | 26 |
| 63 | `backend/src/services/aiGateway.js` | 14 |
| 64 | `backend/src/services/backupPackages.js` | 53 |
| 65 | `backend/src/services/firebaseAuth.js` | 22 |
| 66 | `backend/src/services/googleDriveSync/index.js` | 67 |
| 67 | `backend/src/services/googleDriveSync/versioning.js` | 5 |
| 68 | `backend/src/services/googleOauth.js` | 16 |
| 69 | `backend/src/services/importJobs.js` | 139 |
| 70 | `backend/src/services/integrationDoctor.js` | 13 |
| 71 | `backend/src/services/mediaQueue.js` | 10 |
| 72 | `backend/src/services/portalAi.js` | 29 |
| 73 | `backend/src/services/verification.js` | 21 |
| 74 | `backend/src/sessionAuth.js` | 13 |
| 75 | `backend/src/settingsSnapshot.js` | 7 |
| 76 | `backend/src/storage/organizationFolders.js` | 5 |
| 77 | `backend/src/systemFsWorker.js` | 7 |
| 78 | `backend/src/systemJobs.js` | 24 |
| 79 | `backend/src/uploadReferenceCleanup.js` | 2 |
| 80 | `backend/src/uploadSecurity.js` | 7 |
| 81 | `backend/src/websocket.js` | 1 |
| 82 | `backend/src/workers/importWorker.js` | 2 |
| 83 | `backend/src/workers/mediaWorker.js` | 2 |
| 84 | `backend/test/accessControl.test.js` | 2 |
| 85 | `backend/test/analyticsRuntime.test.js` | 1 |
| 86 | `backend/test/authOtpGuards.test.js` | 1 |
| 87 | `backend/test/authSecurityFlow.test.js` | 9 |
| 88 | `backend/test/backupDefaultDestination.test.js` | 0 |
| 89 | `backend/test/backupPerformanceHardening.test.js` | 1 |
| 90 | `backend/test/backupRetention.test.js` | 1 |
| 91 | `backend/test/backupSchema.test.js` | 1 |
| 92 | `backend/test/branchStockSearch.test.js` | 10 |
| 93 | `backend/test/contactOptions.test.js` | 1 |
| 94 | `backend/test/dataPath.test.js` | 2 |
| 95 | `backend/test/defaultRoles.test.js` | 8 |
| 96 | `backend/test/fileAssetStorageReconcile.test.js` | 1 |
| 97 | `backend/test/fileRouteSecurityFlow.test.js` | 9 |
| 98 | `backend/test/fullAutomation.test.js` | 2 |
| 99 | `backend/test/googleDriveSyncVersioning.test.js` | 1 |
| 100 | `backend/test/idempotency.test.js` | 1 |
| 101 | `backend/test/importCsv.test.js` | 2 |
| 102 | `backend/test/importDecisionIntegrity.test.js` | 0 |
| 103 | `backend/test/importJobStateMachine.test.js` | 4 |
| 104 | `backend/test/importScaleSmoke.test.js` | 3 |
| 105 | `backend/test/initials.test.js` | 0 |
| 106 | `backend/test/integrationDoctor.test.js` | 1 |
| 107 | `backend/test/inventorySettingsMediaContracts.test.js` | 2 |
| 108 | `backend/test/mediaOptimization.test.js` | 3 |
| 109 | `backend/test/netSecurity.test.js` | 1 |
| 110 | `backend/test/offlineSecurity.test.js` | 2 |
| 111 | `backend/test/ownedGoogleAuth.test.js` | 2 |
| 112 | `backend/test/permissionPolicy.test.js` | 0 |
| 113 | `backend/test/portalInventoryRegression.test.js` | 2 |
| 114 | `backend/test/portalUtils.test.js` | 1 |
| 115 | `backend/test/postgresCutoverReadiness.test.js` | 1 |
| 116 | `backend/test/postgresDatabase.test.js` | 3 |
| 117 | `backend/test/postgresQueryCompat.test.js` | 1 |
| 118 | `backend/test/productBatchHierarchy.test.js` | 2 |
| 119 | `backend/test/productExpiry.test.js` | 1 |
| 120 | `backend/test/productImportPolicies.test.js` | 1 |
| 121 | `backend/test/productSearchPagination.test.js` | 0 |
| 122 | `backend/test/rfidRoutes.test.js` | 1 |
| 123 | `backend/test/routeContracts.test.js` | 2 |
| 124 | `backend/test/runtimeCache.test.js` | 2 |
| 125 | `backend/test/runtimeVersion.test.js` | 1 |
| 126 | `backend/test/serverUtils.test.js` | 2 |
| 127 | `backend/test/systemJobs.test.js` | 3 |
| 128 | `backend/test/uploadSecurity.test.js` | 1 |
| 129 | `frontend/postcss.config.mjs` | 0 |
| 130 | `frontend/public/runtime-noise-guard.js` | 6 |
| 131 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.js` | 0 |
| 132 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.worker.js` | 0 |
| 133 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd-threads.js` | 0 |
| 134 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd.js` | 0 |
| 135 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core.js` | 0 |
| 136 | `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js` | 0 |
| 137 | `frontend/public/sw.js` | 24 |
| 138 | `frontend/public/theme-bootstrap.js` | 10 |
| 139 | `frontend/src/api/http.js` | 67 |
| 140 | `frontend/src/api/localDb.js` | 10 |
| 141 | `frontend/src/api/methods.js` | 226 |
| 142 | `frontend/src/api/websocket.js` | 9 |
| 143 | `frontend/src/App.jsx` | 55 |
| 144 | `frontend/src/app/appShellUtils.mjs` | 0 |
| 145 | `frontend/src/app/appShellUtils.ts` | 10 |
| 146 | `frontend/src/app/publicErrorRecovery.mjs` | 3 |
| 147 | `frontend/src/AppContext.jsx` | 41 |
| 148 | `frontend/src/components/auth/Login.jsx` | 23 |
| 149 | `frontend/src/components/branches/Branches.jsx` | 10 |
| 150 | `frontend/src/components/branches/BranchForm.jsx` | 3 |
| 151 | `frontend/src/components/branches/TransferModal.jsx` | 4 |
| 152 | `frontend/src/components/catalog/CatalogEditorSurface.jsx` | 1 |
| 153 | `frontend/src/components/catalog/CatalogImageField.jsx` | 1 |
| 154 | `frontend/src/components/catalog/CatalogPage.jsx` | 113 |
| 155 | `frontend/src/components/catalog/CatalogPageContext.jsx` | 2 |
| 156 | `frontend/src/components/catalog/CatalogPreviewSurface.jsx` | 2 |
| 157 | `frontend/src/components/catalog/CatalogProductsSection.jsx` | 4 |
| 158 | `frontend/src/components/catalog/CatalogSecondaryTabs.jsx` | 6 |
| 159 | `frontend/src/components/catalog/catalogUi.jsx` | 4 |
| 160 | `frontend/src/components/catalog/portalCatalogDisplay.mjs` | 0 |
| 161 | `frontend/src/components/catalog/portalCatalogDisplay.ts` | 9 |
| 162 | `frontend/src/components/catalog/portalContentI18n.mjs` | 0 |
| 163 | `frontend/src/components/catalog/portalContentI18n.ts` | 18 |
| 164 | `frontend/src/components/catalog/portalEditorUtils.mjs` | 0 |
| 165 | `frontend/src/components/catalog/portalEditorUtils.ts` | 10 |
| 166 | `frontend/src/components/catalog/portalLanguagePacks.mjs` | 0 |
| 167 | `frontend/src/components/catalog/portalLanguagePacks.ts` | 3 |
| 168 | `frontend/src/components/catalog/portalTranslateController.mjs` | 17 |
| 169 | `frontend/src/components/contacts/ContactImportModal.jsx` | 10 |
| 170 | `frontend/src/components/contacts/contactImportParser.mjs` | 0 |
| 171 | `frontend/src/components/contacts/contactImportParser.ts` | 0 |
| 172 | `frontend/src/components/contacts/contactImportWorker.mjs` | 0 |
| 173 | `frontend/src/components/contacts/contactImportWorker.ts` | 1 |
| 174 | `frontend/src/components/contacts/contactOptionUtils.js` | 0 |
| 175 | `frontend/src/components/contacts/contactOptionUtils.ts` | 10 |
| 176 | `frontend/src/components/contacts/Contacts.jsx` | 12 |
| 177 | `frontend/src/components/contacts/CustomerFormModal.jsx` | 11 |
| 178 | `frontend/src/components/contacts/customerMembershipNumber.js` | 0 |
| 179 | `frontend/src/components/contacts/customerMembershipNumber.ts` | 1 |
| 180 | `frontend/src/components/contacts/CustomersTab.jsx` | 12 |
| 181 | `frontend/src/components/contacts/DeliveryTab.jsx` | 23 |
| 182 | `frontend/src/components/contacts/shared.jsx` | 7 |
| 183 | `frontend/src/components/contacts/SuppliersTab.jsx` | 16 |
| 184 | `frontend/src/components/custom-tables/CustomTables.jsx` | 11 |
| 185 | `frontend/src/components/dashboard/charts/BarChart.jsx` | 5 |
| 186 | `frontend/src/components/dashboard/charts/DonutChart.jsx` | 1 |
| 187 | `frontend/src/components/dashboard/charts/index.js` | 0 |
| 188 | `frontend/src/components/dashboard/charts/index.ts` | 0 |
| 189 | `frontend/src/components/dashboard/charts/LineChart.jsx` | 7 |
| 190 | `frontend/src/components/dashboard/charts/NoData.jsx` | 1 |
| 191 | `frontend/src/components/dashboard/Dashboard.jsx` | 17 |
| 192 | `frontend/src/components/dashboard/MiniStat.jsx` | 1 |
| 193 | `frontend/src/components/files/FilePickerModal.jsx` | 6 |
| 194 | `frontend/src/components/files/FilesPage.jsx` | 25 |
| 195 | `frontend/src/components/files/FilesProvidersTab.jsx` | 2 |
| 196 | `frontend/src/components/files/FilesResponsesTab.jsx` | 1 |
| 197 | `frontend/src/components/inventory/DualMoney.jsx` | 1 |
| 198 | `frontend/src/components/inventory/Inventory.jsx` | 22 |
| 199 | `frontend/src/components/inventory/InventoryImportModal.jsx` | 10 |
| 200 | `frontend/src/components/inventory/inventoryImportWorker.mjs` | 0 |
| 201 | `frontend/src/components/inventory/inventoryImportWorker.ts` | 1 |
| 202 | `frontend/src/components/inventory/InventoryMovementsSurface.jsx` | 1 |
| 203 | `frontend/src/components/inventory/InventoryProductsSurface.jsx` | 3 |
| 204 | `frontend/src/components/inventory/InventoryRfidSurface.jsx` | 1 |
| 205 | `frontend/src/components/inventory/movementGroups.js` | 0 |
| 206 | `frontend/src/components/inventory/movementGroups.ts` | 15 |
| 207 | `frontend/src/components/inventory/ProductDetailModal.jsx` | 2 |
| 208 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | 9 |
| 209 | `frontend/src/components/navigation/Sidebar.jsx` | 6 |
| 210 | `frontend/src/components/pos/CartItem.jsx` | 1 |
| 211 | `frontend/src/components/pos/FilterPanel.jsx` | 5 |
| 212 | `frontend/src/components/pos/POS.jsx` | 22 |
| 213 | `frontend/src/components/pos/posCore.mjs` | 0 |
| 214 | `frontend/src/components/pos/posCore.ts` | 9 |
| 215 | `frontend/src/components/pos/ProductImage.jsx` | 1 |
| 216 | `frontend/src/components/pos/QuickAddModal.jsx` | 2 |
| 217 | `frontend/src/components/products/config/productPageConfig.mjs` | 0 |
| 218 | `frontend/src/components/products/config/productPageConfig.ts` | 0 |
| 219 | `frontend/src/components/products/forms/BranchStockAdjuster.jsx` | 4 |
| 220 | `frontend/src/components/products/forms/BulkAddStockModal.jsx` | 2 |
| 221 | `frontend/src/components/products/forms/ProductForm.jsx` | 17 |
| 222 | `frontend/src/components/products/forms/VariantFormModal.jsx` | 5 |
| 223 | `frontend/src/components/products/helpers/productDisplayHelpers.mjs` | 0 |
| 224 | `frontend/src/components/products/helpers/productDisplayHelpers.ts` | 6 |
| 225 | `frontend/src/components/products/helpers/productFilterHelpers.mjs` | 0 |
| 226 | `frontend/src/components/products/helpers/productFilterHelpers.ts` | 9 |
| 227 | `frontend/src/components/products/helpers/productGalleryHelpers.mjs` | 0 |
| 228 | `frontend/src/components/products/helpers/productGalleryHelpers.ts` | 8 |
| 229 | `frontend/src/components/products/helpers/productGroupViewHelpers.mjs` | 0 |
| 230 | `frontend/src/components/products/helpers/productGroupViewHelpers.ts` | 2 |
| 231 | `frontend/src/components/products/helpers/productMenuHelpers.mjs` | 0 |
| 232 | `frontend/src/components/products/helpers/productMenuHelpers.ts` | 5 |
| 233 | `frontend/src/components/products/helpers/productPageHelpers.mjs` | 4 |
| 234 | `frontend/src/components/products/helpers/productSelectionHelpers.mjs` | 0 |
| 235 | `frontend/src/components/products/helpers/productSelectionHelpers.ts` | 7 |
| 236 | `frontend/src/components/products/helpers/productWriteHelpers.mjs` | 0 |
| 237 | `frontend/src/components/products/helpers/productWriteHelpers.ts` | 18 |
| 238 | `frontend/src/components/products/history/productHistoryHelpers.mjs` | 0 |
| 239 | `frontend/src/components/products/history/productHistoryHelpers.ts` | 1 |
| 240 | `frontend/src/components/products/import/BulkImportModal.jsx` | 63 |
| 241 | `frontend/src/components/products/import/productImportPlanner.mjs` | 0 |
| 242 | `frontend/src/components/products/import/productImportPlanner.ts` | 18 |
| 243 | `frontend/src/components/products/import/productImportWorker.mjs` | 0 |
| 244 | `frontend/src/components/products/import/productImportWorker.ts` | 3 |
| 245 | `frontend/src/components/products/lookups/ManageBrandsModal.jsx` | 16 |
| 246 | `frontend/src/components/products/lookups/ManageCategoriesModal.jsx` | 8 |
| 247 | `frontend/src/components/products/lookups/ManageUnitsModal.jsx` | 8 |
| 248 | `frontend/src/components/products/lookups/productLookupSnapshots.mjs` | 7 |
| 249 | `frontend/src/components/products/Products.jsx` | 15 |
| 250 | `frontend/src/components/products/scanning/barcodeImageScanner.mjs` | 0 |
| 251 | `frontend/src/components/products/scanning/barcodeImageScanner.ts` | 5 |
| 252 | `frontend/src/components/products/scanning/BarcodeScannerModal.jsx` | 5 |
| 253 | `frontend/src/components/products/scanning/barcodeScannerState.mjs` | 0 |
| 254 | `frontend/src/components/products/scanning/barcodeScannerState.ts` | 1 |
| 255 | `frontend/src/components/products/scanning/scanbotScanner.mjs` | 9 |
| 256 | `frontend/src/components/products/shared/primitives.jsx` | 11 |
| 257 | `frontend/src/components/products/surfaces/HeaderActions.jsx` | 3 |
| 258 | `frontend/src/components/products/surfaces/ProductDetailModal.jsx` | 3 |
| 259 | `frontend/src/components/products/surfaces/ProductRowParts.jsx` | 5 |
| 260 | `frontend/src/components/products/surfaces/ProductsListSurface.jsx` | 3 |
| 261 | `frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | 4 |
| 262 | `frontend/src/components/receipt-settings/constants.js` | 0 |
| 263 | `frontend/src/components/receipt-settings/constants.ts` | 2 |
| 264 | `frontend/src/components/receipt-settings/ErrorBoundary.jsx` | 0 |
| 265 | `frontend/src/components/receipt-settings/FieldOrderManager.jsx` | 9 |
| 266 | `frontend/src/components/receipt-settings/PrintSettings.jsx` | 9 |
| 267 | `frontend/src/components/receipt-settings/ReceiptPreview.jsx` | 2 |
| 268 | `frontend/src/components/receipt-settings/ReceiptSettings.jsx` | 4 |
| 269 | `frontend/src/components/receipt-settings/template.js` | 0 |
| 270 | `frontend/src/components/receipt-settings/template.ts` | 4 |
| 271 | `frontend/src/components/receipt/Receipt.jsx` | 8 |
| 272 | `frontend/src/components/returns/EditReturnModal.jsx` | 5 |
| 273 | `frontend/src/components/returns/NewReturnModal.jsx` | 10 |
| 274 | `frontend/src/components/returns/NewSupplierReturnModal.jsx` | 6 |
| 275 | `frontend/src/components/returns/ReturnDetailModal.jsx` | 3 |
| 276 | `frontend/src/components/returns/Returns.jsx` | 8 |
| 277 | `frontend/src/components/returns/ReturnsListSurface.jsx` | 5 |
| 278 | `frontend/src/components/sales/ExportModal.jsx` | 9 |
| 279 | `frontend/src/components/sales/SaleDetailModal.jsx` | 6 |
| 280 | `frontend/src/components/sales/Sales.jsx` | 10 |
| 281 | `frontend/src/components/sales/SalesImportModal.jsx` | 10 |
| 282 | `frontend/src/components/sales/salesImportWorker.mjs` | 0 |
| 283 | `frontend/src/components/sales/salesImportWorker.ts` | 1 |
| 284 | `frontend/src/components/sales/SalesListSurface.jsx` | 1 |
| 285 | `frontend/src/components/sales/StatusBadge.jsx` | 2 |
| 286 | `frontend/src/components/server/ServerPage.jsx` | 16 |
| 287 | `frontend/src/components/shared/ActionHistoryBar.jsx` | 4 |
| 288 | `frontend/src/components/shared/BackgroundImportTracker.jsx` | 19 |
| 289 | `frontend/src/components/shared/ExportMenu.jsx` | 1 |
| 290 | `frontend/src/components/shared/FilterMenu.jsx` | 2 |
| 291 | `frontend/src/components/shared/globalScroll.js` | 2 |
| 292 | `frontend/src/components/shared/ImageGalleryLightbox.jsx` | 5 |
| 293 | `frontend/src/components/shared/LoadingWatchdog.jsx` | 1 |
| 294 | `frontend/src/components/shared/Modal.jsx` | 1 |
| 295 | `frontend/src/components/shared/navigationConfig.js` | 0 |
| 296 | `frontend/src/components/shared/navigationConfig.ts` | 1 |
| 297 | `frontend/src/components/shared/NotificationCenter.jsx` | 7 |
| 298 | `frontend/src/components/shared/pageActivity.js` | 1 |
| 299 | `frontend/src/components/shared/PageHeader.jsx` | 1 |
| 300 | `frontend/src/components/shared/PaginationControls.jsx` | 5 |
| 301 | `frontend/src/components/shared/PortalMenu.jsx` | 6 |
| 302 | `frontend/src/components/shared/QuickPreferenceToggles.jsx` | 3 |
| 303 | `frontend/src/components/shared/SectionSwitcher.jsx` | 3 |
| 304 | `frontend/src/components/shared/WriteConflictModal.jsx` | 5 |
| 305 | `frontend/src/components/users/PermissionEditor.jsx` | 5 |
| 306 | `frontend/src/components/users/UserDetailSheet.jsx` | 3 |
| 307 | `frontend/src/components/users/UserProfileModal.jsx` | 21 |
| 308 | `frontend/src/components/users/Users.jsx` | 18 |
| 309 | `frontend/src/components/utils-settings/AuditLog.jsx` | 12 |
| 310 | `frontend/src/components/utils-settings/Backup.jsx` | 30 |
| 311 | `frontend/src/components/utils-settings/FontFamilyPicker.jsx` | 1 |
| 312 | `frontend/src/components/utils-settings/index.js` | 0 |
| 313 | `frontend/src/components/utils-settings/index.ts` | 0 |
| 314 | `frontend/src/components/utils-settings/OtpModal.jsx` | 2 |
| 315 | `frontend/src/components/utils-settings/ResetData.jsx` | 8 |
| 316 | `frontend/src/components/utils-settings/Settings.jsx` | 21 |
| 317 | `frontend/src/components/utils-settings/settingsConflict.js` | 0 |
| 318 | `frontend/src/components/utils-settings/settingsConflict.ts` | 3 |
| 319 | `frontend/src/constants.js` | 3 |
| 320 | `frontend/src/index.jsx` | 10 |
| 321 | `frontend/src/platform/runtime/clientRuntime.js` | 15 |
| 322 | `frontend/src/platform/storage/storagePolicy.mjs` | 0 |
| 323 | `frontend/src/platform/storage/storagePolicy.ts` | 3 |
| 324 | `frontend/src/runtime/runtimeErrorClassifier.mjs` | 11 |
| 325 | `frontend/src/types/jsx-modules.d.ts` | 0 |
| 326 | `frontend/src/types/receiptContracts.ts` | 0 |
| 327 | `frontend/src/types/settingsContracts.ts` | 0 |
| 328 | `frontend/src/utils/actionGuards.mjs` | 0 |
| 329 | `frontend/src/utils/actionGuards.ts` | 5 |
| 330 | `frontend/src/utils/actionHistory.mjs` | 2 |
| 331 | `frontend/src/utils/appRefresh.d.ts` | 2 |
| 332 | `frontend/src/utils/appRefresh.js` | 2 |
| 333 | `frontend/src/utils/bulkOps.mjs` | 0 |
| 334 | `frontend/src/utils/bulkOps.ts` | 1 |
| 335 | `frontend/src/utils/color.js` | 0 |
| 336 | `frontend/src/utils/color.ts` | 3 |
| 337 | `frontend/src/utils/csv.d.ts` | 7 |
| 338 | `frontend/src/utils/csv.js` | 15 |
| 339 | `frontend/src/utils/csvExportWorker.mjs` | 0 |
| 340 | `frontend/src/utils/csvExportWorker.ts` | 1 |
| 341 | `frontend/src/utils/csvImport.js` | 0 |
| 342 | `frontend/src/utils/csvImport.ts` | 19 |
| 343 | `frontend/src/utils/csvRowCounter.mjs` | 0 |
| 344 | `frontend/src/utils/csvRowCounter.ts` | 2 |
| 345 | `frontend/src/utils/dateHelpers.js` | 0 |
| 346 | `frontend/src/utils/dateHelpers.ts` | 3 |
| 347 | `frontend/src/utils/deviceInfo.js` | 0 |
| 348 | `frontend/src/utils/deviceInfo.ts` | 4 |
| 349 | `frontend/src/utils/exportPackage.js` | 0 |
| 350 | `frontend/src/utils/exportPackage.ts` | 2 |
| 351 | `frontend/src/utils/exportReports.jsx` | 9 |
| 352 | `frontend/src/utils/favicon.js` | 4 |
| 353 | `frontend/src/utils/formatters.js` | 0 |
| 354 | `frontend/src/utils/formatters.ts` | 5 |
| 355 | `frontend/src/utils/groupedRecords.mjs` | 0 |
| 356 | `frontend/src/utils/groupedRecords.ts` | 8 |
| 357 | `frontend/src/utils/historyHelpers.mjs` | 0 |
| 358 | `frontend/src/utils/historyHelpers.ts` | 2 |
| 359 | `frontend/src/utils/importJobRefresh.js` | 6 |
| 360 | `frontend/src/utils/index.js` | 0 |
| 361 | `frontend/src/utils/index.ts` | 0 |
| 362 | `frontend/src/utils/initials.mjs` | 0 |
| 363 | `frontend/src/utils/initials.ts` | 7 |
| 364 | `frontend/src/utils/loaders.mjs` | 8 |
| 365 | `frontend/src/utils/mediaUpload.js` | 0 |
| 366 | `frontend/src/utils/mediaUpload.ts` | 5 |
| 367 | `frontend/src/utils/permissions.js` | 0 |
| 368 | `frontend/src/utils/permissions.ts` | 2 |
| 369 | `frontend/src/utils/pricing.d.ts` | 8 |
| 370 | `frontend/src/utils/pricing.js` | 0 |
| 371 | `frontend/src/utils/pricing.ts` | 8 |
| 372 | `frontend/src/utils/printReceipt.js` | 41 |
| 373 | `frontend/src/utils/productBatches.mjs` | 0 |
| 374 | `frontend/src/utils/productBatches.ts` | 3 |
| 375 | `frontend/src/utils/productGrouping.mjs` | 0 |
| 376 | `frontend/src/utils/productGrouping.ts` | 13 |
| 377 | `frontend/src/utils/publicAssetUrls.d.ts` | 1 |
| 378 | `frontend/src/utils/publicAssetUrls.js` | 7 |
| 379 | `frontend/src/utils/receiptAppliedConfig.ts` | 7 |
| 380 | `frontend/src/utils/scriptTypography.js` | 0 |
| 381 | `frontend/src/utils/scriptTypography.ts` | 3 |
| 382 | `frontend/src/utils/settingsRefresh.js` | 0 |
| 383 | `frontend/src/utils/settingsRefresh.ts` | 2 |
| 384 | `frontend/src/utils/settingsWriteOptions.ts` | 1 |
| 385 | `frontend/src/web-api.js` | 31 |
| 386 | `frontend/tailwind.config.mjs` | 0 |
| 387 | `frontend/tests/actionGuards.test.mjs` | 1 |
| 388 | `frontend/tests/actionStability.test.mjs` | 3 |
| 389 | `frontend/tests/adminShellMediaGuards.test.mjs` | 0 |
| 390 | `frontend/tests/apiHttp.test.mjs` | 3 |
| 391 | `frontend/tests/appRefresh.test.mjs` | 2 |
| 392 | `frontend/tests/appShellUtils.test.mjs` | 1 |
| 393 | `frontend/tests/assetCompression.test.mjs` | 1 |
| 394 | `frontend/tests/backupJobs.test.mjs` | 0 |
| 395 | `frontend/tests/barcodeImageScanner.test.mjs` | 1 |
| 396 | `frontend/tests/barcodeScannerState.test.mjs` | 1 |
| 397 | `frontend/tests/bulkOps.test.mjs` | 1 |
| 398 | `frontend/tests/contactImportWorker.test.mjs` | 1 |
| 399 | `frontend/tests/csvImport.test.mjs` | 1 |
| 400 | `frontend/tests/dashboardDataReliability.test.mjs` | 0 |
| 401 | `frontend/tests/dateHelpers.test.mjs` | 2 |
| 402 | `frontend/tests/deviceInfo.test.mjs` | 2 |
| 403 | `frontend/tests/exportPackages.test.mjs` | 1 |
| 404 | `frontend/tests/formatters.test.mjs` | 1 |
| 405 | `frontend/tests/globalScroll.test.mjs` | 0 |
| 406 | `frontend/tests/globalScrollControls.test.mjs` | 1 |
| 407 | `frontend/tests/groupedRecords.test.mjs` | 1 |
| 408 | `frontend/tests/historyHelpers.test.mjs` | 1 |
| 409 | `frontend/tests/importJobRefresh.test.mjs` | 4 |
| 410 | `frontend/tests/initials.test.mjs` | 1 |
| 411 | `frontend/tests/inventoryImportWorker.test.mjs` | 1 |
| 412 | `frontend/tests/inventoryMobileCardLayout.test.mjs` | 0 |
| 413 | `frontend/tests/inventoryMovementGroups.test.mjs` | 1 |
| 414 | `frontend/tests/inventoryRfidSection.test.mjs` | 0 |
| 415 | `frontend/tests/jsxSyntaxCheck.mjs` | 1 |
| 416 | `frontend/tests/loaders.test.mjs` | 1 |
| 417 | `frontend/tests/mediaUploadHelpers.test.mjs` | 1 |
| 418 | `frontend/tests/navigationConfig.test.mjs` | 1 |
| 419 | `frontend/tests/notificationBadge.test.mjs` | 0 |
| 420 | `frontend/tests/offlineSalesQueue.test.mjs` | 1 |
| 421 | `frontend/tests/offlineSecurityHardening.test.mjs` | 1 |
| 422 | `frontend/tests/offlineSyncArchitecture.test.mjs` | 1 |
| 423 | `frontend/tests/ownedGoogleAuth.test.mjs` | 1 |
| 424 | `frontend/tests/performanceLoadingUx.test.mjs` | 0 |
| 425 | `frontend/tests/permissionEditor.test.mjs` | 0 |
| 426 | `frontend/tests/permissions.test.mjs` | 0 |
| 427 | `frontend/tests/portalCatalogDisplay.test.mjs` | 3 |
| 428 | `frontend/tests/portalContentI18n.test.mjs` | 0 |
| 429 | `frontend/tests/portalEditorUtils.test.mjs` | 1 |
| 430 | `frontend/tests/portalFaqVocabulary.test.mjs` | 0 |
| 431 | `frontend/tests/portalLanguagePacks.test.mjs` | 0 |
| 432 | `frontend/tests/portalTranslateController.test.mjs` | 2 |
| 433 | `frontend/tests/posCore.test.mjs` | 1 |
| 434 | `frontend/tests/pricingContacts.test.mjs` | 1 |
| 435 | `frontend/tests/productBatches.test.mjs` | 0 |
| 436 | `frontend/tests/productDiscountUx.test.mjs` | 1 |
| 437 | `frontend/tests/productDisplayHelpers.test.mjs` | 0 |
| 438 | `frontend/tests/productFilterHelpers.test.mjs` | 0 |
| 439 | `frontend/tests/productGalleryHelpers.test.mjs` | 0 |
| 440 | `frontend/tests/productGrouping.test.mjs` | 1 |
| 441 | `frontend/tests/productGroupViewHelpers.test.mjs` | 2 |
| 442 | `frontend/tests/productHistoryHelpers.test.mjs` | 1 |
| 443 | `frontend/tests/productImportPlanner.test.mjs` | 1 |
| 444 | `frontend/tests/productImportWorkerFallback.test.mjs` | 1 |
| 445 | `frontend/tests/productMenuHelpers.test.mjs` | 3 |
| 446 | `frontend/tests/productPageHelpers.test.mjs` | 0 |
| 447 | `frontend/tests/productSearchPagination.test.mjs` | 0 |
| 448 | `frontend/tests/productSelectionHelpers.test.mjs` | 0 |
| 449 | `frontend/tests/productWriteHelpers.test.mjs` | 0 |
| 450 | `frontend/tests/publicErrorRecovery.test.mjs` | 1 |
| 451 | `frontend/tests/receiptSettingsSync.test.mjs` | 0 |
| 452 | `frontend/tests/receiptTemplate.test.mjs` | 1 |
| 453 | `frontend/tests/returnsLayout.test.mjs` | 0 |
| 454 | `frontend/tests/runtimeErrorClassifier.test.mjs` | 0 |
| 455 | `frontend/tests/salesImportWorker.test.mjs` | 1 |
| 456 | `frontend/tests/scanbotScanner.test.mjs` | 2 |
| 457 | `frontend/tests/scriptTypography.test.mjs` | 0 |
| 458 | `frontend/tests/sectionNavigation.test.mjs` | 0 |
| 459 | `frontend/tests/settingsConflictHelpers.test.mjs` | 1 |
| 460 | `frontend/tests/settingsRefresh.test.mjs` | 0 |
| 461 | `frontend/tests/storagePolicy.test.mjs` | 1 |
| 462 | `frontend/tests/utilsSettingsBarrel.test.mjs` | 0 |
| 463 | `frontend/vite.config.mjs` | 5 |
| 464 | `ops/scripts/architecture/generated-bulk-audit.mjs` | 18 |
| 465 | `ops/scripts/architecture/language-runtime-audit.mjs` | 23 |
| 466 | `ops/scripts/architecture/organization-audit.mjs` | 20 |
| 467 | `ops/scripts/architecture/phase29-audit.mjs` | 17 |
| 468 | `ops/scripts/backend/schema-audit.js` | 22 |
| 469 | `ops/scripts/backend/verify-data-integrity.js` | 18 |
| 470 | `ops/scripts/frontend/verify-i18n.js` | 6 |
| 471 | `ops/scripts/frontend/verify-performance.js` | 4 |
| 472 | `ops/scripts/frontend/verify-ui.js` | 13 |
| 473 | `ops/scripts/lib/fs-utils.js` | 11 |
| 474 | `ops/scripts/runtime/audits/audit-auth.mjs` | 6 |
| 475 | `ops/scripts/runtime/audits/audit-manifest.mjs` | 2 |
| 476 | `ops/scripts/runtime/audits/audit-report-html.mjs` | 11 |
| 477 | `ops/scripts/runtime/audits/deep-live-audit.mjs` | 42 |
| 478 | `ops/scripts/runtime/audits/full-app-audit.mjs` | 21 |
| 479 | `ops/scripts/runtime/cloudflare/rotate-cloudflare-tunnel-token.mjs` | 16 |
| 480 | `ops/scripts/runtime/cloudflare/update-cloudflare-tunnel-origin.mjs` | 6 |
| 481 | `ops/scripts/runtime/cloudflare/verify-cloudflare-automation.mjs` | 15 |
| 482 | `ops/scripts/runtime/cloudflare/verify-r2-object-store.mjs` | 5 |
| 483 | `ops/scripts/runtime/live-checks/live-check-utils.mjs` | 8 |
| 484 | `ops/scripts/runtime/live-checks/phase84-branches-actions-live-check.mjs` | 2 |
| 485 | `ops/scripts/runtime/live-checks/phase84-contacts-live-check.mjs` | 2 |
| 486 | `ops/scripts/runtime/live-checks/phase84-files-providers-actions-live-check.mjs` | 2 |
| 487 | `ops/scripts/runtime/live-checks/phase84-inventory-actions-live-check.mjs` | 3 |
| 488 | `ops/scripts/runtime/live-checks/phase84-product-brands-actions-live-check.mjs` | 3 |
| 489 | `ops/scripts/runtime/live-checks/phase84-product-categories-actions-live-check.mjs` | 2 |
| 490 | `ops/scripts/runtime/live-checks/phase84-product-page-actions-live-check.mjs` | 3 |
| 491 | `ops/scripts/runtime/live-checks/phase84-product-scanning-actions-live-check.mjs` | 2 |
| 492 | `ops/scripts/runtime/live-checks/phase84-product-stock-actions-live-check.mjs` | 2 |
| 493 | `ops/scripts/runtime/live-checks/phase84-product-units-actions-live-check.mjs` | 2 |
| 494 | `ops/scripts/runtime/live-checks/phase84-product-variant-actions-live-check.mjs` | 3 |
| 495 | `ops/scripts/runtime/live-checks/phase84-public-portal-cloudflare-check.mjs` | 4 |
| 496 | `ops/scripts/runtime/live-checks/phase84-sales-actions-live-check.mjs` | 2 |
| 497 | `ops/scripts/runtime/live-checks/phase84-ui-live-check.mjs` | 2 |
| 498 | `ops/scripts/runtime/live-checks/phase84-users-actions-live-check.mjs` | 2 |
| 499 | `ops/scripts/runtime/smoke/check-public-url.mjs` | 11 |
| 500 | `ops/scripts/runtime/smoke/check-route-contract.mjs` | 3 |
| 501 | `ops/scripts/runtime/smoke/live-smoke.mjs` | 5 |
| 502 | `ops/scripts/runtime/storage/prune-storage.mjs` | 12 |
| 503 | `ops/scripts/verification/verify-backup-reliability.js` | 5 |
| 504 | `ops/scripts/verification/verify-docker-release.js` | 5 |
| 505 | `ops/scripts/verification/verify-hardening-policy.js` | 11 |
| 506 | `ops/scripts/verification/verify-runtime-deps.js` | 4 |
| 507 | `ops/scripts/verification/verify-scale-services.js` | 8 |
| 508 | `ops/scripts/verification/verify-secret-hygiene.js` | 0 |

## 3. Detailed Function Commentary

### 3.1 `backend/server.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `listFrontendAssetFiles` | function | 94 |
| 2 | `resolveFrontendAssetPath` | function | 104 |
| 3 | `loadCompressionMiddleware` | function | 127 |
| 4 | `applySecurityHeaders` | function | 136 |
| 5 | `applyRequestPolicy` | function | 142 |
| 6 | `applyCoreMiddleware` | function | 152 |
| 7 | `normalizeUploadFileName` | function | 166 |
| 8 | `getSafeActiveUploadPath` | function | 174 |
| 9 | `findBackupUploadFallback` | function | 183 |
| 10 | `inferUploadContentType` | function | 229 |
| 11 | `serveLocalUpload` | function | 240 |
| 12 | `getObjectStreamWithTimeout` | function | 257 |
| 13 | `mountStaticAssets` | function | 271 |
| 14 | `mountHealthRoute` | function | 336 |
| 15 | `mountApiRoutes` | function | 365 |
| 16 | `mountTransfersAlias` | function | 403 |
| 17 | `mountSpaFallback` | function | 418 |
| 18 | `mountErrorHandler` | function | 437 |
| 19 | `getStartupBanner` | function | 451 |
| 20 | `closeDatabase` | function | 476 |
| 21 | `startDatabaseMaintenanceTimer` | function | 486 |
| 22 | `registerShutdownHandlers` | function | 494 |
| 23 | `bootstrapServer` | function | 511 |

### 3.2 `backend/src/accessControl.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 19 |
| 2 | `normalizeHostname` | function | 23 |
| 3 | `getConfiguredSyncToken` | function | 29 |
| 4 | `getRemoteAccessProvider` | function | 33 |
| 5 | `isLegacyTailscaleEnabled` | function | 37 |
| 6 | `getRequestHost` | function | 41 |
| 7 | `getRemoteAddress` | function | 47 |
| 8 | `isLoopbackAddress` | function | 55 |
| 9 | `getPresentedSyncToken` | function | 62 |
| 10 | `getTailscaleIdentity` | function | 68 |
| 11 | `hasTrustedTailscaleIdentity` | function | 77 |
| 12 | `isLocalHostRequest` | function | 85 |
| 13 | `isTsNetHost` | function | 90 |
| 14 | `getConfiguredTailscaleHost` | function | 95 |
| 15 | `isPublicRemoteRequest` | function | 99 |
| 16 | `isPublicApiRequest` | function | 107 |
| 17 | `classifyRequestAccess` | function | 113 |
| 18 | `authorizeProtectedRequest` | function | 142 |

### 3.3 `backend/src/analytics/duckdbRuntime.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `tryRequireDuckDbPackage` | function | 14 |
| 2 | `probeDuckDbPackage` | function | 27 |
| 3 | `getDuckDbRuntimeStatus` | function | 56 |

### 3.4 `backend/src/authOtpGuards.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeUserId` | function | 5 |
| 2 | `canManageOtpTarget` | function | 10 |
| 3 | `requiresSelfOtpDisablePassword` | function | 20 |

### 3.5 `backend/src/backupSchema.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `countRowsByTable` | function | 90 |
| 2 | `countCustomTableRows` | function | 98 |
| 3 | `buildBackupSummary` | function | 104 |
| 4 | `buildBackupSummaryFromCounts` | function | 109 |

### 3.6 `backend/src/businessMetrics.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sellableProductWhere` | function | 5 |
| 2 | `effectiveCostExpr` | function | 12 |
| 3 | `stockQuantityExpr` | function | 18 |
| 4 | `normalizeMetricRow` | function | 22 |
| 5 | `getStockMetrics` | function | 34 |
| 6 | `getLowStockProducts` | function | 69 |
| 7 | `getOutOfStockProducts` | function | 83 |
| 8 | `getStockAlertProducts` | function | 96 |
| 9 | `getExpiringProducts` | function | 118 |

### 3.7 `backend/src/catalogTextIntegrity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeCatalogText` | function | 7 |
| 2 | `hasSuspiciousCatalogText` | function | 18 |
| 3 | `listSuspiciousCatalogFields` | function | 28 |
| 4 | `assertCatalogTextIntegrity` | function | 35 |
| 5 | `normalizeOptionList` | function | 41 |

### 3.8 `backend/src/config/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isDefaultDataMarker` | function | 46 |
| 2 | `resolveStoredDataDir` | function | 51 |
| 3 | `normalizeSelectedDataDir` | function | 58 |
| 4 | `readDataLocation` | function | 70 |
| 5 | `writeDataLocation` | function | 81 |
| 6 | `ensureDirectory` | function | 97 |
| 7 | `readSecretFileValue` | function | 101 |
| 8 | `ensureOrganizationRuntimeLayout` | function | 113 |
| 9 | `normalizeOrganizationSeed` | function | 119 |
| 10 | `STORAGE_ROOT` | const arrow | 126 |

### 3.9 `backend/src/conflictControl.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `WriteConflictError` | class | 3 |
| 2 | `normalizeUpdatedAt` | function | 17 |
| 3 | `getExpectedUpdatedAt` | function | 22 |
| 4 | `assertUpdatedAtMatch` | function | 31 |
| 5 | `sendWriteConflict` | function | 43 |
| 6 | `sendSettingsConflict` | function | 57 |

### 3.10 `backend/src/contactOptions.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cleanText` | function | 5 |
| 2 | `normalizeContactOption` | function | 10 |
| 3 | `hasContactOptionData` | function | 21 |
| 4 | `parseStoredContactOptions` | function | 28 |
| 5 | `parseImportContactOptions` | function | 56 |
| 6 | `serializeContactOptions` | function | 72 |
| 7 | `getPrimaryContactOption` | function | 80 |
| 8 | `buildImportedContactState` | function | 85 |

### 3.11 `backend/src/database.js`

- No top-level named symbols detected.

### 3.12 `backend/src/dataPath/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizePathForCompare` | function | 9 |
| 2 | `isSamePath` | function | 15 |
| 3 | `isSubPath` | function | 19 |
| 4 | `ensureDataRootLayout` | function | 24 |
| 5 | `walkFiles` | function | 30 |
| 6 | `summarizeDataRoot` | function | 48 |
| 7 | `copyDirectoryContents` | function | 91 |
| 8 | `buildArchivedTargetPath` | function | 128 |
| 9 | `relocateDataRoot` | function | 145 |

### 3.13 `backend/src/db/cutoverReadiness.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeRelative` | function | 36 |
| 2 | `toRelative` | function | 40 |
| 3 | `shouldSkipDir` | function | 44 |
| 4 | `listJavaScriptFiles` | function | 52 |
| 5 | `analyzeFile` | function | 66 |
| 6 | `summarizeBlockers` | function | 86 |
| 7 | `analyzePostgresCutoverReadiness` | function | 103 |

### 3.14 `backend/src/db/postgresQueryCompat.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `countPositionalPlaceholders` | function | 57 |
| 2 | `stripTrailingSemicolon` | function | 82 |
| 3 | `replacePositionalParams` | function | 86 |
| 4 | `normalizePortableSqlFunctions` | function | 120 |
| 5 | `translateInsertOrIgnore` | function | 131 |
| 6 | `translateParameters` | function | 135 |
| 7 | `appendReturning` | function | 160 |
| 8 | `getInsertTableName` | function | 172 |
| 9 | `translateSql` | function | 177 |
| 10 | `coerceRowValue` | function | 195 |
| 11 | `coerceRow` | function | 208 |

### 3.15 `backend/src/fileAssets.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDb` | function | 56 |
| 2 | `ensureUploadsDirectory` | function | 65 |
| 3 | `getMimeTypeFromName` | function | 69 |
| 4 | `getMediaType` | function | 74 |
| 5 | `sanitizeOriginalFileName` | function | 83 |
| 6 | `preserveOriginalDisplayName` | function | 96 |
| 7 | `buildUniqueStoredName` | function | 104 |
| 8 | `shouldCompressImage` | function | 121 |
| 9 | `compressBufferForAsset` | function | 127 |
| 10 | `encodeImageCandidate` | function | 211 |
| 11 | `readImageDimensions` | function | 240 |
| 12 | `getFfmpegPath` | function | 253 |
| 13 | `buildVideoOptimizationArgs` | function | 261 |
| 14 | `optimizeStoredVideo` | function | 299 |
| 15 | `createFileAssetRecord` | function | 365 |
| 16 | `getFileAssetByPublicPath` | function | 445 |
| 17 | `buildFileAssetFilterParams` | function | 454 |
| 18 | `listAssetRows` | function | 461 |
| 19 | `countAssetRows` | function | 486 |
| 20 | `writeObjectBodyToFile` | function | 506 |
| 21 | `ensureStoredAssetAvailableLocally` | function | 524 |
| 22 | `collectUploadPathsFromValue` | function | 534 |
| 23 | `pruneInvalidReferenceBackfillAssets` | function | 558 |
| 24 | `collectReferencedUploadPaths` | function | 566 |
| 25 | `add` | const arrow | 568 |
| 26 | `ensureReferencedAssetsRegistered` | function | 579 |
| 27 | `getUploadFilePath` | function | 612 |
| 28 | `toUploadPublicPathFromObjectKey` | function | 617 |
| 29 | `findUploadStorageOrphans` | function | 623 |
| 30 | `collectTrackedUploadPublicPaths` | function | 633 |
| 31 | `add` | const arrow | 635 |
| 32 | `reconcileUploadStorage` | function | 648 |
| 33 | `requestUploadStorageReconcile` | function | 710 |
| 34 | `ensureFileAssetListingWarm` | function | 714 |
| 35 | `prewarmFileAssetListing` | function | 732 |
| 36 | `deleteAllStoredUploads` | function | 741 |
| 37 | `buildInClausePlaceholders` | function | 762 |
| 38 | `collectUsagesByPublicPath` | function | 766 |
| 39 | `addUsage` | const arrow | 774 |
| 40 | `collectUsage` | function | 839 |
| 41 | `resolveBrowserPublicPath` | function | 843 |
| 42 | `serializeAssetRow` | function | 850 |
| 43 | `serializeAssetRows` | function | 864 |
| 44 | `registerStoredAsset` | function | 870 |
| 45 | `registerUploadFromRequest` | function | 947 |
| 46 | `optimizeStoredAssetFromQueue` | function | 961 |
| 47 | `storeDataUrlAsset` | function | 993 |
| 48 | `backfillUploadAssets` | function | 1019 |
| 49 | `listFileAssets` | function | 1038 |
| 50 | `getFileAssetById` | function | 1061 |
| 51 | `deleteFileAsset` | function | 1066 |

### 3.16 `backend/src/helpers.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `logOp` | function | 21 |
| 2 | `getServerLog` | function | 26 |
| 3 | `ok` | function | 30 |
| 4 | `err` | function | 35 |
| 5 | `audit` | function | 50 |
| 6 | `safeHistoryPayload` | function | 99 |
| 7 | `recordActionHistory` | function | 109 |
| 8 | `broadcast` | function | 164 |
| 9 | `tryParse` | function | 181 |
| 10 | `today` | function | 186 |
| 11 | `parseCSVRows` | function | 198 |
| 12 | `bulkImportCSV` | function | 222 |
| 13 | `parseCSVLine` | function | 248 |
| 14 | `importRows` | function | 268 |
| 15 | `verifyAndRepairStockQuantities` | function | 283 |
| 16 | `verifyAndRepairSaleStatuses` | function | 341 |
| 17 | `verifyAndRepairCostPrices` | function | 401 |
| 18 | `runDataIntegrityCheck` | function | 483 |
| 19 | `getSafeCostPrice` | function | 510 |
| 20 | `calculateSaleProfit` | function | 521 |

### 3.17 `backend/src/idempotency.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeClientRequestId` | function | 3 |

### 3.18 `backend/src/importCsv.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `stripBom` | function | 9 |
| 2 | `normalizeDigit` | function | 13 |
| 3 | `normalizeNumericText` | function | 21 |
| 4 | `countDelimiter` | function | 28 |
| 5 | `detectCsvDelimiter` | function | 47 |
| 6 | `parseDelimitedRows` | function | 54 |
| 7 | `normalizeCsvKey` | function | 99 |
| 8 | `parseCsvRows` | function | 107 |
| 9 | `detectCsvDelimiterFromFile` | function | 126 |
| 10 | `csvValuesToRow` | function | 137 |
| 11 | `hasCsvContent` | function | 147 |
| 12 | `emitRecord` | const function | 165 |

### 3.19 `backend/src/importParsing.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeDigit` | function | 9 |
| 2 | `normalizeNumericText` | function | 17 |
| 3 | `removeCurrencyNoise` | function | 24 |
| 4 | `normalizeNumberSeparators` | function | 31 |
| 5 | `parseImportNumericValue` | function | 65 |
| 6 | `normalizeImportMoney` | function | 80 |

### 3.20 `backend/src/initials.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeInitialText` | function | 16 |
| 2 | `getInitialKey` | function | 20 |
| 3 | `getInitialType` | function | 31 |
| 4 | `compareInitialKeys` | function | 40 |
| 5 | `rank` | const arrow | 44 |
| 6 | `aggregateInitialRows` | function | 64 |

### 3.21 `backend/src/maintenanceLock.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 5 |
| 2 | `getMaintenanceLock` | function | 9 |
| 3 | `isMaintenanceLocked` | function | 13 |
| 4 | `acquireMaintenanceLock` | function | 17 |
| 5 | `releaseMaintenanceLock` | function | 29 |
| 6 | `withMaintenanceLock` | function | 37 |
| 7 | `maintenanceWriteGuard` | function | 46 |

### 3.22 `backend/src/middleware.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `authToken` | function | 14 |
| 2 | `networkAccessGuard` | function | 27 |
| 3 | `sanitiseFilename` | function | 32 |
| 4 | `compressImageFile` | function | 64 |
| 5 | `compressImageBuffer` | function | 99 |
| 6 | `getClientKey` | function | 106 |
| 7 | `routeRateLimit` | function | 112 |
| 8 | `createStorage` | function | 124 |
| 9 | `buildUpload` | function | 140 |
| 10 | `parsePermissionsValue` | function | 172 |
| 11 | `getMergedPermissions` | function | 182 |
| 12 | `isAdminControlUser` | function | 189 |
| 13 | `hasPermission` | function | 197 |
| 14 | `requirePermission` | function | 204 |
| 15 | `requireAnyPermission` | function | 216 |
| 16 | `readAuditTextValue` | function | 229 |
| 17 | `getAuditRequestMeta` | function | 235 |
| 18 | `getAuditActor` | function | 264 |
| 19 | `compressUpload` | function | 280 |
| 20 | `validateUploadedFile` | function | 298 |
| 21 | `validateUploadBufferPayload` | function | 309 |

### 3.23 `backend/src/money.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toFiniteNumber` | function | 3 |
| 2 | `roundUpToDecimals` | function | 8 |
| 3 | `normalizePriceValue` | function | 17 |

### 3.24 `backend/src/netSecurity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 26 |
| 2 | `normalizeHostname` | function | 30 |
| 3 | `isPrivateIpv4` | function | 34 |
| 4 | `isPrivateIpv6` | function | 47 |
| 5 | `isBlockedHostname` | function | 58 |
| 6 | `assertSafeOutboundUrl` | function | 69 |
| 7 | `isSafeExternalImageReference` | function | 97 |

### 3.25 `backend/src/objectStore.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getS3RequestHandler` | function | 18 |
| 2 | `getObjectStorageDriver` | function | 29 |
| 3 | `isObjectStorageEnabled` | function | 33 |
| 4 | `isR2Enabled` | function | 37 |
| 5 | `isMinioEnabled` | function | 41 |
| 6 | `trim` | function | 45 |
| 7 | `getCloudflareAccountId` | function | 49 |
| 8 | `getCloudflareApiToken` | function | 56 |
| 9 | `canUseCloudflareR2Api` | function | 68 |
| 10 | `buildR2ApiObjectUrl` | function | 72 |
| 11 | `cloudflareR2ApiRequest` | function | 87 |
| 12 | `shouldFallbackToR2Api` | function | 123 |
| 13 | `getS3Client` | function | 133 |
| 14 | `normalizeObjectKey` | function | 152 |
| 15 | `ensureBucket` | function | 156 |
| 16 | `putObject` | function | 174 |
| 17 | `sendWithTimeout` | function | 209 |
| 18 | `getObjectStream` | function | 221 |
| 19 | `deleteObject` | function | 254 |
| 20 | `deleteObjects` | function | 273 |
| 21 | `listObjects` | function | 308 |
| 22 | `testObjectStore` | function | 359 |
| 23 | `bufferToStream` | function | 374 |

### 3.26 `backend/src/optionalSharp.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadSharp` | function | 7 |

### 3.27 `backend/src/organizationContext/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 11 |
| 2 | `slugify` | function | 15 |
| 3 | `generateOrganizationPublicId` | function | 23 |
| 4 | `getDefaultOrganization` | function | 27 |
| 5 | `getOrganizationById` | function | 36 |
| 6 | `findOrganizationByLookup` | function | 45 |
| 7 | `searchOrganizations` | function | 60 |
| 8 | `getOrganizationGroup` | function | 93 |
| 9 | `getDefaultOrganizationGroup` | function | 103 |
| 10 | `getOrganizationContextForUser` | function | 115 |
| 11 | `getPortalPublicPath` | function | 133 |
| 12 | `getOrganizationFilesystemLayout` | function | 138 |
| 13 | `ensureOrganizationFilesystemLayout` | function | 157 |
| 14 | `getOrganizationStorageStatus` | function | 226 |

### 3.28 `backend/src/permissions.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeKey` | function | 127 |
| 2 | `getPermissionDefinition` | function | 131 |
| 3 | `isSensitivePermissionKey` | function | 136 |
| 4 | `permissionForActionHistory` | function | 143 |
| 5 | `isSensitiveActionHistory` | function | 151 |
| 6 | `hasPermissionValue` | function | 166 |

### 3.29 `backend/src/portalUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toTrimmedString` | function | 5 |
| 2 | `safeJsonParse` | function | 9 |
| 3 | `createAboutBlock` | function | 17 |
| 4 | `normalizeAboutBlocks` | function | 28 |
| 5 | `extractGoogleMapsEmbedUrl` | function | 47 |
| 6 | `normalizeGoogleMapsEmbed` | function | 55 |

### 3.30 `backend/src/postgresDatabase.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadPgNative` | function | 13 |
| 2 | `normalizeQueryRows` | function | 30 |
| 3 | `buildRunResult` | function | 35 |
| 4 | `normalizeStatementArgs` | function | 44 |
| 5 | `PostgresCompatStatement` | class | 53 |
| 6 | `PostgresCompatDatabase` | class | 77 |
| 7 | `createPostgresDatabase` | function | 460 |
| 8 | `runDatabaseMaintenance` | function | 464 |
| 9 | `ensureCoreDataInvariants` | function | 468 |
| 10 | `ensureDefaultOrganizationAndGroup` | function | 472 |
| 11 | `ensurePrimaryAdminRoleAndUser` | function | 476 |
| 12 | `getDb` | function | 482 |
| 13 | `closeDatabase` | function | 510 |

### 3.31 `backend/src/productBatches.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeExpiryDate` | function | 23 |
| 2 | `normalizeLotCode` | function | 28 |
| 3 | `isSellableProduct` | function | 33 |
| 4 | `buildBatchKey` | function | 37 |
| 5 | `getProductById` | function | 46 |
| 6 | `getProductBatchIds` | function | 52 |
| 7 | `getBatchRowsForProduct` | function | 56 |
| 8 | `getLegacyBatchBackfillCandidates` | function | 65 |
| 9 | `createOrFindProductBatch` | function | 78 |
| 10 | `setBranchBatchQuantity` | function | 135 |
| 11 | `incrementBranchBatchQuantity` | function | 145 |
| 12 | `getBatchStockRows` | function | 156 |
| 13 | `listProductBatches` | function | 196 |
| 14 | `syncProductBatchRollups` | function | 267 |
| 15 | `migrateLegacyProductToBatches` | function | 306 |
| 16 | `migrateAllLegacyProductsToBatches` | function | 350 |
| 17 | `scheduleLegacyBatchBackfill` | function | 362 |
| 18 | `runNextChunk` | const arrow | 368 |
| 19 | `getLegacyBatchBackfillStatus` | function | 398 |
| 20 | `getAvailableProductQuantity` | function | 407 |
| 21 | `allocateProductBatches` | function | 412 |
| 22 | `increaseProductBatchStock` | function | 452 |
| 23 | `restoreBatchAllocations` | function | 469 |
| 24 | `cloneAllocationsToProduct` | function | 484 |
| 25 | `getSaleItemAllocations` | function | 508 |
| 26 | `markSaleItemAllocationsReleased` | function | 520 |
| 27 | `getAvailableSaleAllocationRows` | function | 528 |
| 28 | `getReturnItemAllocations` | function | 551 |
| 29 | `markReturnItemAllocationsReversed` | function | 563 |

### 3.32 `backend/src/productDiscounts.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeBooleanFlag` | function | 8 |
| 2 | `normalizePercent` | function | 17 |
| 3 | `normalizeDiscountType` | function | 23 |
| 4 | `normalizeHexColor` | function | 28 |
| 5 | `normalizeDateText` | function | 33 |
| 6 | `pick` | function | 41 |
| 7 | `normalizeProductDiscount` | function | 45 |
| 8 | `isDiscountActive` | function | 67 |
| 9 | `calculateDiscountedPrice` | function | 81 |

### 3.33 `backend/src/productImportPolicies.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseImportNumber` | function | 5 |
| 2 | `parseImportFlag` | function | 13 |
| 3 | `hasImportValue` | function | 22 |
| 4 | `normalizeFieldRule` | function | 27 |
| 5 | `splitUniqueImportValues` | function | 34 |
| 6 | `appendUniqueImportValue` | function | 50 |
| 7 | `resolveImportValue` | function | 67 |
| 8 | `normalizeImageConflictMode` | function | 81 |

### 3.34 `backend/src/requestContext.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cleanText` | function | 7 |
| 2 | `readHeader` | function | 13 |
| 3 | `extractRequestMeta` | function | 19 |
| 4 | `requestContextMiddleware` | function | 45 |
| 5 | `getRequestMeta` | function | 50 |

### 3.35 `backend/src/routes/actionHistory.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseJson` | function | 14 |
| 2 | `normalizeLimit` | function | 24 |
| 3 | `normalizeText` | function | 29 |
| 4 | `serializePayload` | function | 34 |
| 5 | `canReadAllHistory` | function | 43 |
| 6 | `getOwnedHistoryRow` | function | 47 |
| 7 | `canOperateHistoryRow` | function | 53 |
| 8 | `canRecordHistory` | function | 67 |
| 9 | `getHistoryRow` | function | 87 |
| 10 | `mapRow` | function | 94 |
| 11 | `completeServerHistoryTransition` | function | 206 |

### 3.36 `backend/src/routes/ai.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `listProviders` | function | 19 |
| 2 | `getProviderRow` | function | 28 |

### 3.37 `backend/src/routes/auth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getClientKey` | function | 91 |
| 2 | `applyRateLimit` | function | 104 |
| 3 | `getLoginLockKey` | function | 116 |
| 4 | `isReasonableCredentialLength` | function | 120 |
| 5 | `normalizeLookupText` | function | 125 |
| 6 | `isHttpUrl` | function | 129 |
| 7 | `buildPublicBaseUrl` | function | 133 |
| 8 | `isLocalOrigin` | function | 140 |
| 9 | `resolvePublicAssetBaseUrl` | function | 149 |
| 10 | `resolvePasswordResetRedirect` | function | 155 |
| 11 | `loginIdentifierPreview` | function | 171 |
| 12 | `rejectLogin` | function | 185 |
| 13 | `getOtpSecret` | function | 207 |
| 14 | `requireOtpActor` | function | 211 |
| 15 | `getOtpTargetUser` | function | 217 |
| 16 | `buildUserPayload` | function | 232 |
| 17 | `resolveOrganizationLookup` | function | 264 |
| 18 | `findUserByIdentifier` | function | 270 |
| 19 | `getExactActiveUserById` | function | 339 |
| 20 | `normalizeOauthMode` | function | 354 |
| 21 | `isEmailIdentifier` | function | 359 |
| 22 | `getUserById` | function | 363 |
| 23 | `getSettingsSnapshot` | function | 367 |
| 24 | `getBootstrapSystemSnapshot` | function | 376 |
| 25 | `buildAuthenticatedBootstrap` | function | 408 |
| 26 | `generateTemporaryAuthPassword` | function | 437 |
| 27 | `issueAuthSession` | function | 441 |
| 28 | `updateLocalUserGoogleIdentity` | function | 452 |
| 29 | `completeGoogleLogin` | function | 601 |
| 30 | `buildOauthCallbackHtml` | function | 687 |

### 3.38 `backend/src/routes/branches.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toDbBool` | function | 11 |
| 2 | `getStockTransferNoteColumn` | function | 19 |
| 3 | `normalizePositiveInt` | function | 34 |
| 4 | `getDefaultBranch` | function | 40 |
| 5 | `getSellableProductWhere` | function | 44 |
| 6 | `buildBranchStockWhere` | function | 50 |

### 3.39 `backend/src/routes/catalog.js`

- No top-level named symbols detected.

### 3.40 `backend/src/routes/categories.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLookup` | function | 12 |
| 2 | `normalizeColor` | function | 16 |

### 3.41 `backend/src/routes/contacts.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLegacyMembershipNumber` | function | 20 |
| 2 | `cleanMembershipNumber` | function | 26 |
| 3 | `requireMembershipNumber` | function | 30 |
| 4 | `assertUniqueMembershipNumber` | function | 36 |
| 5 | `ensureMembershipNumber` | function | 50 |
| 6 | `ensureOrGenerateMembershipNumber` | function | 55 |
| 7 | `generateCustomerMembershipNumber` | function | 61 |
| 8 | `normalizeFieldRule` | function | 75 |
| 9 | `resolveFieldValue` | function | 82 |
| 10 | `buildImportRows` | function | 93 |
| 11 | `normalizeConflictMode` | function | 103 |
| 12 | `toNumber` | function | 108 |
| 13 | `normalizePositiveInt` | function | 113 |
| 14 | `parseDateFilterParams` | function | 119 |
| 15 | `buildContactListFilters` | function | 143 |
| 16 | `parseScopedIds` | function | 169 |
| 17 | `loadPointPolicy` | function | 177 |
| 18 | `calculatePolicyPoints` | function | 203 |
| 19 | `wantsExpandedPoints` | function | 208 |
| 20 | `buildCustomerPointSummaries` | function | 213 |
| 21 | `findExisting` | const arrow | 489 |
| 22 | `findExisting` | const arrow | 704 |
| 23 | `findExisting` | const arrow | 898 |

### 3.42 `backend/src/routes/customTables.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `humanizeTableName` | function | 11 |
| 2 | `serializeCustomTable` | function | 20 |
| 3 | `sanitizeCustomTableName` | function | 28 |
| 4 | `resolveCustomTableRow` | function | 34 |
| 5 | `escapeIdentifier` | function | 43 |
| 6 | `normalizeCustomTableSchema` | function | 47 |
| 7 | `tableHasColumn` | function | 68 |
| 8 | `ensureCustomTableRowVersioning` | function | 79 |

### 3.43 `backend/src/routes/files.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseFileAssetId` | function | 22 |
| 2 | `getFileListFilters` | function | 30 |
| 3 | `getDeviceMeta` | function | 53 |

### 3.44 `backend/src/routes/importJobs.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `permissionForImportType` | function | 34 |
| 2 | `requireImportPermission` | function | 42 |
| 3 | `hasAnyImportPermission` | function | 55 |
| 4 | `requireAnyImportPermission` | function | 59 |
| 5 | `ensureDir` | function | 69 |
| 6 | `getJobUploadRoot` | function | 73 |
| 7 | `getJobOr404` | function | 78 |
| 8 | `isAllowedImportFile` | function | 107 |
| 9 | `parsePolicy` | function | 131 |
| 10 | `parseRelativePaths` | function | 137 |
| 11 | `shouldForceDelete` | function | 148 |
| 12 | `auditImportJobEvent` | function | 153 |

### 3.45 `backend/src/routes/inventory.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeImportedTimestamp` | function | 27 |
| 2 | `recalcProductStock` | function | 35 |
| 3 | `findTransferByClientRequestId` | function | 39 |
| 4 | `cleanMoveReason` | function | 53 |
| 5 | `normalizePositiveInt` | function | 59 |
| 6 | `cleanInventoryReasonEntry` | function | 65 |
| 7 | `loadSavedInventoryReasons` | function | 79 |
| 8 | `persistSavedInventoryReasons` | function | 93 |
| 9 | `splitSearchTerms` | function | 111 |
| 10 | `normalizeMovementDisplayText` | function | 123 |
| 11 | `sanitizeInventoryResponseProduct` | function | 134 |
| 12 | `appendInventoryProductFilters` | function | 147 |
| 13 | `hydrateInventoryProducts` | function | 200 |
| 14 | `buildInventoryFinancialJoinSql` | function | 220 |
| 15 | `inventoryFinancialSelectSql` | function | 326 |
| 16 | `getFilteredInventoryStats` | function | 340 |
| 17 | `normalizeRfidId` | function | 1149 |
| 18 | `getRfidSession` | function | 1153 |
| 19 | `getBranchLedgerQty` | function | 1157 |
| 20 | `refreshRfidSessionCounts` | function | 1161 |
| 21 | `upsertRfidSessionItem` | function | 1196 |
| 22 | `recordRfidEvent` | function | 1221 |

### 3.46 `backend/src/routes/notifications.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeBoolean` | function | 23 |
| 2 | `toNumber` | function | 31 |
| 3 | `loadNotificationPreferences` | function | 36 |
| 4 | `loadPointPolicy` | function | 62 |
| 5 | `calculatePolicyPoints` | function | 88 |
| 6 | `buildInventorySection` | function | 93 |
| 7 | `buildExpirySection` | function | 137 |
| 8 | `buildSalesSection` | function | 171 |
| 9 | `buildLoyaltySection` | function | 238 |
| 10 | `buildPortalSection` | function | 325 |
| 11 | `buildSystemSection` | function | 362 |

### 3.47 `backend/src/routes/organizations.js`

- No top-level named symbols detected.

### 3.48 `backend/src/routes/portal.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `asyncRoute` | function | 24 |
| 2 | `toNumber` | function | 29 |
| 3 | `normalizeBoolean` | function | 35 |
| 4 | `normalizePhone` | function | 41 |
| 5 | `normalizePublicPath` | function | 46 |
| 6 | `normalizeUrl` | function | 60 |
| 7 | `normalizeRedeemValueUsd` | function | 75 |
| 8 | `normalizeRedeemValueKhr` | function | 80 |
| 9 | `normalizeHexColor` | function | 87 |
| 10 | `normalizeFaqItems` | function | 93 |
| 11 | `normalizePortalTranslations` | function | 107 |
| 12 | `normalizeProductIdList` | function | 121 |
| 13 | `loadSettingsMap` | function | 136 |
| 14 | `buildPortalConfig` | function | 144 |
| 15 | `buildRankMap` | function | 270 |
| 16 | `getPortalProductSignals` | function | 289 |
| 17 | `calculatePointsValue` | function | 387 |
| 18 | `summarizePoints` | function | 397 |
| 19 | `getPortalProducts` | function | 437 |
| 20 | `cacheTtl` | function | 527 |
| 21 | `normalizePositiveInt` | function | 531 |
| 22 | `splitSearchTerms` | function | 537 |
| 23 | `splitFilterValues` | function | 546 |
| 24 | `appendPortalProductSearchFilters` | function | 555 |
| 25 | `getPortalCatalogSearchMetadata` | function | 623 |
| 26 | `distinctField` | const arrow | 628 |
| 27 | `getPortalCatalogProductPage` | function | 652 |
| 28 | `getCachedPortalConfig` | function | 766 |
| 29 | `getCachedPortalMeta` | function | 770 |
| 30 | `getCachedPortalProducts` | function | 774 |
| 31 | `getPortalCatalogMeta` | function | 779 |
| 32 | `findCustomerByMembership` | function | 825 |
| 33 | `sanitizeScreenshots` | function | 835 |
| 34 | `materializePortalScreenshots` | function | 844 |
| 35 | `sanitizeAiProfile` | function | 862 |
| 36 | `getVisitorFingerprint` | function | 874 |
| 37 | `getClientKey` | function | 880 |
| 38 | `applyPortalRateLimit` | function | 885 |

### 3.49 `backend/src/routes/products.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getActiveBranches` | function | 52 |
| 2 | `getDefaultBranch` | function | 56 |
| 3 | `seedBranchRows` | function | 60 |
| 4 | `recalcProductStock` | function | 65 |
| 5 | `normalizeImageGallery` | function | 69 |
| 6 | `syncProductImageGallery` | function | 76 |
| 7 | `loadProductImageMap` | function | 94 |
| 8 | `attachImageGallery` | function | 112 |
| 9 | `findProductByClientRequestId` | function | 124 |
| 10 | `assertUniqueProductFields` | function | 134 |
| 11 | `normalizeProductIdentifier` | function | 182 |
| 12 | `hasOwnField` | function | 187 |
| 13 | `pickField` | function | 191 |
| 14 | `ensureParentProductExists` | function | 195 |
| 15 | `markParentProductAsGroup` | function | 205 |
| 16 | `normalizeImportLookup` | function | 210 |
| 17 | `normalizeLookup` | function | 214 |
| 18 | `normalizeImportFlagValue` | function | 218 |
| 19 | `getProductImportDetailSignature` | function | 251 |
| 20 | `chooseImportParentProduct` | function | 261 |
| 21 | `normalizeImportAction` | function | 276 |
| 22 | `parseOptionalImportId` | function | 284 |
| 23 | `discountInsertColumns` | function | 291 |
| 24 | `discountValues` | function | 295 |
| 25 | `normalizeExpiryFields` | function | 310 |
| 26 | `normalizeBatchFields` | function | 321 |
| 27 | `seedOpeningBatch` | function | 328 |
| 28 | `normalizePositiveInt` | function | 343 |
| 29 | `parseInclude` | function | 349 |
| 30 | `splitSearchTerms` | function | 353 |
| 31 | `getProductCatalogSnapshotVersion` | function | 361 |
| 32 | `parseBrandOptionsSetting` | function | 374 |
| 33 | `sanitizeProductLookupPayload` | function | 380 |
| 34 | `buildLookupUsageEntries` | function | 393 |
| 35 | `buildLookupUsageSummary` | function | 455 |
| 36 | `appendProductSearchFilters` | function | 482 |
| 37 | `getProductSearchMetadata` | function | 557 |
| 38 | `distinctField` | const arrow | 562 |
| 39 | `attachBranchStock` | function | 586 |
| 40 | `expandProductFamilyRows` | function | 613 |
| 41 | `bindList` | const arrow | 632 |
| 42 | `normalizeLookup` | const arrow | 1319 |
| 43 | `resolveImage` | const arrow | 1434 |
| 44 | `ensureCategory` | const arrow | 1450 |
| 45 | `ensureUnit` | const arrow | 1465 |
| 46 | `ensureBrand` | const arrow | 1480 |
| 47 | `ensureSupplier` | const arrow | 1493 |
| 48 | `determineBranch` | const arrow | 1505 |
| 49 | `handleBranch` | const arrow | 1525 |
| 50 | `isDirectImageRef` | const arrow | 1561 |
| 51 | `normalizeDirectImageRef` | const arrow | 1572 |
| 52 | `parseIncomingImageRefs` | const arrow | 1579 |
| 53 | `loadCurrentGallery` | const arrow | 1612 |

### 3.50 `backend/src/routes/returns.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `deductBranchStock` | function | 24 |
| 2 | `restoreBranchStock` | function | 32 |
| 3 | `normalizeMovementProductName` | function | 43 |
| 4 | `refreshProductStockQuantity` | function | 54 |
| 5 | `refreshProductStockQuantities` | function | 58 |
| 6 | `normalizeScope` | function | 68 |
| 7 | `toNumber` | function | 76 |
| 8 | `findReturnByClientRequestId` | function | 81 |
| 9 | `assertReturnableItems` | function | 91 |
| 10 | `assertSupplierReturnableStock` | function | 515 |

### 3.51 `backend/src/routes/runtime.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `requireRuntimePermission` | function | 19 |

### 3.52 `backend/src/routes/sales.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `periodExpression` | function | 30 |
| 2 | `hourExpression` | function | 37 |
| 3 | `toDayBounds` | function | 41 |
| 4 | `readCachedDashboardSummary` | function | 51 |
| 5 | `writeCachedDashboardSummary` | function | 58 |
| 6 | `readCachedDashboardAnalytics` | function | 66 |
| 7 | `writeCachedDashboardAnalytics` | function | 73 |
| 8 | `normalizeImportedTimestamp` | function | 81 |
| 9 | `getSaleItemCosts` | function | 89 |
| 10 | `assertSaleStockAvailable` | function | 115 |
| 11 | `findCustomerForSaleAssignment` | function | 142 |
| 12 | `parseBranchId` | function | 163 |
| 13 | `getActiveBranchContext` | function | 168 |
| 14 | `requireActiveBranch` | function | 183 |
| 15 | `resolveSaleItemBranchId` | function | 190 |
| 16 | `normalizeSaleItems` | function | 201 |
| 17 | `summarizeSaleBranch` | function | 231 |
| 18 | `refreshProductStockQuantity` | function | 255 |
| 19 | `refreshProductStockQuantities` | function | 259 |
| 20 | `deductBranchStock` | function | 266 |
| 21 | `restoreBranchStock` | function | 274 |
| 22 | `fetchSaleItemsWithBranches` | function | 282 |
| 23 | `findSaleByClientRequestId` | function | 291 |

### 3.53 `backend/src/routes/settings.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLookup` | function | 19 |
| 2 | `normalizeBrandOptionsValue` | function | 23 |
| 3 | `normalizeBrandColorMapValue` | function | 43 |
| 4 | `settingsHasUpdatedAt` | function | 67 |
| 5 | `getSettingsSnapshot` | function | 82 |
| 6 | `getSettingsUpdatedAt` | function | 89 |

### 3.54 `backend/src/routes/sync.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `stableStringify` | function | 47 |
| 2 | `sha256` | function | 53 |
| 3 | `verifyOperationDigest` | function | 57 |
| 4 | `normalizeOperation` | function | 64 |
| 5 | `hasWriteConflict` | function | 77 |
| 6 | `buildReplayUrl` | function | 84 |
| 7 | `replayOperation` | function | 88 |
| 8 | `getUploadDir` | function | 182 |
| 9 | `readManifest` | function | 186 |

### 3.55 `backend/src/routes/system/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `auditWithActorMeta` | function | 86 |
| 2 | `q` | function | 104 |
| 3 | `getClientKey` | function | 108 |
| 4 | `applyRouteRateLimit` | function | 114 |
| 5 | `stopImportsBeforeDestructiveAction` | function | 126 |
| 6 | `runFsWorker` | function | 141 |
| 7 | `finish` | const arrow | 153 |
| 8 | `getHostUiAvailability` | function | 197 |
| 9 | `buildRequestBaseUrl` | function | 206 |
| 10 | `resolveDriveRedirectUri` | function | 213 |
| 11 | `getSafeTableCount` | function | 220 |
| 12 | `buildMigrationTableCounts` | function | 228 |
| 13 | `safeJsonParse` | function | 248 |
| 14 | `readSystemSettings` | function | 257 |
| 15 | `writeSystemSettings` | function | 268 |
| 16 | `getMigrationSafetyBackupDestination` | function | 283 |
| 17 | `getMigrationSafetyState` | function | 287 |
| 18 | `createMigrationSafetyBackup` | function | 309 |
| 19 | `runMigrationSafetyDriveSync` | function | 326 |
| 20 | `runMigrationSafetyAutomation` | function | 364 |
| 21 | `buildScaleMigrationStatus` | function | 379 |
| 22 | `readFinalBackupManifest` | function | 448 |
| 23 | `getCustomTableNames` | function | 452 |
| 24 | `getDefaultBackupDestinationDir` | function | 458 |
| 25 | `createFolderBackup` | function | 464 |
| 26 | `restoreFolderBackup` | function | 501 |
| 27 | `sendBackupVersions` | function | 871 |
| 28 | `listWindowsFsRoots` | const arrow | 1371 |
| 29 | `listDriveRoots` | const arrow | 1388 |

### 3.56 `backend/src/routes/units.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLookup` | function | 13 |
| 2 | `normalizeUnitColor` | function | 17 |
| 3 | `updateUnitHandler` | function | 52 |

### 3.57 `backend/src/routes/users.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isGoogleAuthConfigured` | function | 35 |
| 2 | `getGoogleAuthPublicConfig` | function | 39 |
| 3 | `getClientKey` | function | 53 |
| 4 | `parseJson` | function | 59 |
| 5 | `normalizeLookupText` | function | 67 |
| 6 | `normalizePhoneLookup` | function | 71 |
| 7 | `findUserIdentityConflict` | function | 75 |
| 8 | `getMergedPermissions` | function | 143 |
| 9 | `isPrimaryAdmin` | function | 152 |
| 10 | `hasAdminControl` | function | 159 |
| 11 | `canManageTarget` | function | 172 |
| 12 | `getActorFromRequest` | function | 185 |
| 13 | `requireAdminControl` | function | 192 |
| 14 | `getUserSecurityContext` | function | 205 |
| 15 | `getUserWithRole` | function | 215 |
| 16 | `syncLocalEmailVerification` | function | 230 |
| 17 | `repairGoogleIdentityForUser` | function | 261 |
| 18 | `sanitizeUserRow` | function | 290 |
| 19 | `isValidEmail` | function | 306 |
| 20 | `getAuthIdentityList` | function | 311 |
| 21 | `isUuid` | function | 317 |
| 22 | `resolveAuthIdentityUuid` | function | 321 |
| 23 | `buildAuthMethodsPayload` | function | 330 |

### 3.58 `backend/src/runtimeCache.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `enabled` | function | 17 |
| 2 | `namespacedKey` | function | 21 |
| 3 | `getClient` | function | 26 |
| 4 | `getJson` | function | 64 |
| 5 | `setJson` | function | 77 |
| 6 | `getOrSetJson` | function | 90 |
| 7 | `deleteByPrefix` | function | 98 |
| 8 | `prefixesForChannel` | function | 117 |
| 9 | `invalidateForChannel` | function | 138 |
| 10 | `pingRuntimeCache` | function | 148 |
| 11 | `getRuntimeCacheStatus` | function | 159 |

### 3.59 `backend/src/runtimeState/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ensureRuntimeMetaDir` | function | 11 |
| 2 | `readRuntimeState` | function | 15 |
| 3 | `writeRuntimeState` | function | 32 |
| 4 | `getRuntimeState` | function | 38 |
| 5 | `bumpStorageVersion` | function | 48 |
| 6 | `buildRuntimeDescriptor` | function | 57 |

### 3.60 `backend/src/runtimeVersion.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `firstExistingDir` | function | 11 |
| 2 | `readGitRevision` | function | 15 |
| 3 | `collectFiles` | function | 30 |
| 4 | `computeSourceHash` | function | 44 |
| 5 | `emptyFrontendBuildInfo` | function | 69 |
| 6 | `readFrontendBuildInfoFromRoot` | function | 77 |
| 7 | `getRuntimeVersion` | function | 112 |

### 3.61 `backend/src/security.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeEncryptionKey` | function | 9 |
| 2 | `isEncryptionConfigured` | function | 29 |
| 3 | `encryptSecret` | function | 33 |
| 4 | `decryptSecret` | function | 46 |
| 5 | `pruneRateBucket` | function | 67 |
| 6 | `checkRateLimit` | function | 79 |
| 7 | `resetRateLimit` | function | 108 |
| 8 | `safeCompare` | function | 115 |
| 9 | `getAbuseBucket` | function | 126 |
| 10 | `pruneAbuseBucket` | function | 136 |
| 11 | `checkAbuseLock` | function | 148 |
| 12 | `recordAbuseFailure` | function | 165 |
| 13 | `clearAbuseFailure` | function | 189 |

### 3.62 `backend/src/serverUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildOriginFromParts` | function | 13 |
| 2 | `parseOriginHost` | function | 24 |
| 3 | `normalizeConfiguredHost` | function | 34 |
| 4 | `getConfiguredPublicHosts` | function | 44 |
| 5 | `getConfiguredCustomerPortalHosts` | function | 52 |
| 6 | `isConfiguredCustomerPortalHost` | function | 59 |
| 7 | `isAllowedRequestOrigin` | function | 69 |
| 8 | `isAllowedWebSocketOrigin` | function | 78 |
| 9 | `hostIsLoopbackPair` | function | 95 |
| 10 | `getTrustedDocumentOrigins` | function | 100 |
| 11 | `addOrigin` | const arrow | 102 |
| 12 | `buildPermissionsPolicy` | function | 131 |
| 13 | `getCloudflareAccessDiagnostics` | function | 158 |
| 14 | `sanitizeObjectKeys` | function | 184 |
| 15 | `sanitizeStringValue` | function | 203 |
| 16 | `sanitizeRequestPayload` | function | 209 |
| 17 | `sanitizeDeepStrings` | function | 216 |
| 18 | `isApiOrHealthPath` | function | 233 |
| 19 | `isSpaFallbackEligible` | function | 237 |
| 20 | `setNoStoreHeaders` | function | 245 |
| 21 | `setHtmlNoCacheHeaders` | function | 251 |
| 22 | `isCustomerPortalRoutePath` | function | 258 |
| 23 | `setTunnelSecurityHeaders` | function | 263 |
| 24 | `setFrontendStaticHeaders` | function | 306 |
| 25 | `setUploadStaticHeaders` | function | 356 |
| 26 | `mapServerError` | function | 366 |

### 3.63 `backend/src/services/aiGateway.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 6 |
| 2 | `trim` | function | 10 |
| 3 | `parseJsonSafe` | function | 14 |
| 4 | `clamp` | function | 22 |
| 5 | `maskApiKey` | function | 26 |
| 6 | `getProviderMeta` | function | 96 |
| 7 | `normalizeProviderPayload` | function | 100 |
| 8 | `serializeProviderRow` | function | 132 |
| 9 | `providerCanUseWebResearch` | function | 165 |
| 10 | `resolveProviderEndpoint` | function | 170 |
| 11 | `buildProviderHttpError` | function | 177 |
| 12 | `host` | const arrow | 180 |
| 13 | `callChatProvider` | function | 193 |
| 14 | `testProviderConfig` | function | 285 |

### 3.64 `backend/src/services/backupPackages.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readCachedBackupVersions` | function | 29 |
| 2 | `writeCachedBackupVersions` | function | 38 |
| 3 | `clearBackupVersionCaches` | function | 46 |
| 4 | `getDb` | function | 51 |
| 5 | `q` | function | 55 |
| 6 | `nowSafeId` | function | 59 |
| 7 | `sha256` | function | 63 |
| 8 | `createSha256` | function | 67 |
| 9 | `sha256File` | function | 71 |
| 10 | `readTableRows` | function | 81 |
| 11 | `yieldToEventLoop` | function | 93 |
| 12 | `throwIfAborted` | function | 97 |
| 13 | `getManagedWritableState` | function | 105 |
| 14 | `writeStream` | function | 136 |
| 15 | `closeWriteStream` | function | 150 |
| 16 | `handleFinish` | const arrow | 154 |
| 17 | `handleError` | const arrow | 159 |
| 18 | `cleanup` | const arrow | 163 |
| 19 | `createProgressReporter` | function | 173 |
| 20 | `getSafeTableCount` | function | 212 |
| 21 | `streamBackupDataFile` | function | 220 |
| 22 | `buildObjectManifest` | function | 278 |
| 23 | `buildPackageMetadata` | function | 295 |
| 24 | `writeTextFileWithChecksum` | function | 349 |
| 25 | `writeJsonLinesFileWithChecksum` | function | 354 |
| 26 | `uploadPackageFile` | function | 367 |
| 27 | `writeAndUploadMetadataFiles` | function | 387 |
| 28 | `retryOperation` | function | 413 |
| 29 | `writeDestinationChunk` | function | 428 |
| 30 | `endDestination` | function | 441 |
| 31 | `handleFinish` | const arrow | 445 |
| 32 | `handleError` | const arrow | 450 |
| 33 | `cleanup` | const arrow | 454 |
| 34 | `copyOnePackageObject` | function | 464 |
| 35 | `abortCopy` | const arrow | 476 |
| 36 | `copyPackageObjects` | function | 503 |
| 37 | `worker` | function | 512 |
| 38 | `createFinalBackupPackage` | function | 554 |
| 39 | `validateLocalBackupPackage` | function | 669 |
| 40 | `getLocalBackupRoot` | function | 693 |
| 41 | `isDockerReleaseBackupRoot` | function | 698 |
| 42 | `isLocalBackupDirectoryName` | function | 703 |
| 43 | `listLocalBackupDirectories` | function | 709 |
| 44 | `getDirectoryBytes` | function | 729 |
| 45 | `planBackupPackageRetention` | function | 755 |
| 46 | `pruneLocalBackupVersions` | function | 772 |
| 47 | `groupRemoteBackupObjects` | function | 798 |
| 48 | `pruneRemoteBackupVersions` | function | 820 |
| 49 | `pruneBackupVersions` | function | 847 |
| 50 | `readReusableLocalBackupPackage` | function | 864 |
| 51 | `findReusableLocalBackupPackage` | function | 889 |
| 52 | `listLocalBackupVersions` | function | 900 |
| 53 | `listBackupVersions` | function | 930 |

### 3.65 `backend/src/services/firebaseAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `truthy` | function | 16 |
| 2 | `trim` | function | 20 |
| 3 | `normalizePrivateKey` | function | 24 |
| 4 | `parseJsonSafe` | function | 28 |
| 5 | `loadServiceAccount` | function | 36 |
| 6 | `isFirebaseAuthConfigured` | function | 85 |
| 7 | `isFirebasePhoneVerificationConfigured` | function | 89 |
| 8 | `hasFirebaseAdminCredentials` | function | 93 |
| 9 | `base64Url` | function | 97 |
| 10 | `buildGoogleServiceJwt` | function | 106 |
| 11 | `getGoogleAccessToken` | function | 136 |
| 12 | `normalizeProviderError` | function | 172 |
| 13 | `parseResponseData` | function | 189 |
| 14 | `callFirebasePublic` | function | 193 |
| 15 | `callFirebaseAdmin` | function | 222 |
| 16 | `normalizeEmail` | function | 257 |
| 17 | `normalizeE164` | function | 262 |
| 18 | `getFirebaseAuthPublicConfig` | function | 270 |
| 19 | `createOrUpdateAuthUser` | function | 282 |
| 20 | `updateAuthPassword` | function | 323 |
| 21 | `setAuthUserActive` | function | 342 |
| 22 | `verifyPasswordWithFirebase` | function | 355 |

### 3.66 `backend/src/services/googleDriveSync/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 80 |
| 2 | `trim` | function | 84 |
| 3 | `toBool` | function | 88 |
| 4 | `clamp` | function | 96 |
| 5 | `escapeDriveQueryValue` | function | 102 |
| 6 | `readSettingsMap` | function | 106 |
| 7 | `writeSettingsMap` | function | 116 |
| 8 | `clearDriveSyncMappings` | function | 134 |
| 9 | `resetDriveSyncRootState` | function | 138 |
| 10 | `getDriveSyncConfig` | function | 148 |
| 11 | `getDriveSyncEntriesMap` | function | 184 |
| 12 | `upsertDriveSyncEntry` | function | 196 |
| 13 | `deleteDriveSyncEntry` | function | 233 |
| 14 | `deleteDriveSyncEntriesUnder` | function | 237 |
| 15 | `inferMimeType` | function | 244 |
| 16 | `hashFile` | function | 259 |
| 17 | `hashFileMany` | function | 269 |
| 18 | `yieldToEventLoop` | function | 289 |
| 19 | `sleep` | function | 293 |
| 20 | `buildAccessTokenKey` | function | 297 |
| 21 | `clearCachedAccessToken` | function | 304 |
| 22 | `describeFetchFailure` | function | 311 |
| 23 | `fetchWithTimeout` | function | 325 |
| 24 | `exchangeRefreshToken` | function | 352 |
| 25 | `exchangeAuthorizationCode` | function | 394 |
| 26 | `driveApiRequest` | function | 417 |
| 27 | `driveApiUpload` | function | 434 |
| 28 | `fetchDriveUserProfile` | function | 450 |
| 29 | `findDriveItem` | function | 465 |
| 30 | `findDriveItems` | function | 470 |
| 31 | `listDriveChildren` | function | 485 |
| 32 | `getDriveFileIfExists` | function | 494 |
| 33 | `removeDuplicateDriveItems` | function | 506 |
| 34 | `createDriveFolder` | function | 518 |
| 35 | `ensureRootFolder` | function | 530 |
| 36 | `ensureDriveVersionFolder` | function | 549 |
| 37 | `writeSnapshotManifest` | function | 596 |
| 38 | `buildManagedSnapshotRoot` | function | 630 |
| 39 | `ensureSnapshotLayout` | function | 634 |
| 40 | `shouldSkipSnapshotFile` | function | 640 |
| 41 | `createDataRootSnapshot` | function | 647 |
| 42 | `collectSnapshotItems` | function | 689 |
| 43 | `ensureRemoteDirectories` | function | 739 |
| 44 | `updateRuntimeUploadProgress` | function | 790 |
| 45 | `clearRuntimeUploadProgress` | function | 797 |
| 46 | `initiateDriveResumableSession` | function | 804 |
| 47 | `queryResumableOffset` | function | 832 |
| 48 | `isInvalidUploadRequest` | function | 860 |
| 49 | `isDriveNotFoundError` | function | 864 |
| 50 | `isDriveWriteAccessError` | function | 868 |
| 51 | `canRecoverDriveItemWrite` | function | 876 |
| 52 | `putResumableChunk` | function | 880 |
| 53 | `uploadDriveFileResumable` | function | 915 |
| 54 | `uploadDriveFile` | function | 989 |
| 55 | `updateDriveFile` | function | 994 |
| 56 | `removeDriveFile` | function | 999 |
| 57 | `runDriveSync` | function | 1011 |
| 58 | `runDriveSyncInternal` | function | 1022 |
| 59 | `scheduleDriveSync` | function | 1267 |
| 60 | `getDriveSyncStatus` | function | 1289 |
| 61 | `beginGoogleDriveOAuth` | function | 1338 |
| 62 | `prunePendingOauthStates` | function | 1362 |
| 63 | `finalizeGoogleDriveOAuth` | function | 1369 |
| 64 | `saveDriveSyncPreferences` | function | 1412 |
| 65 | `disconnectDriveSync` | function | 1433 |
| 66 | `forgetDriveSyncCredentials` | function | 1453 |
| 67 | `schedulePeriodicDriveSync` | function | 1461 |

### 3.67 `backend/src/services/googleDriveSync/versioning.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toSafeDate` | function | 7 |
| 2 | `toSafeVersionNumber` | function | 12 |
| 3 | `resolveDriveSyncVersionState` | function | 17 |
| 4 | `parseVersionName` | function | 56 |
| 5 | `selectExpiredDriveSyncVersions` | function | 61 |

### 3.68 `backend/src/services/googleOauth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 27 |
| 2 | `unique` | function | 31 |
| 3 | `getGoogleLoginOrigins` | function | 35 |
| 4 | `getGoogleLoginRedirectUris` | function | 44 |
| 5 | `getPrimaryRedirectUri` | function | 52 |
| 6 | `getDefaultReturnPath` | function | 56 |
| 7 | `normalizeReturnTarget` | function | 62 |
| 8 | `base64url` | function | 99 |
| 9 | `sha256Base64Url` | function | 104 |
| 10 | `getStateSecret` | function | 108 |
| 11 | `signState` | function | 112 |
| 12 | `verifyState` | function | 118 |
| 13 | `getGoogleLoginPublicConfig` | function | 134 |
| 14 | `buildGoogleOauthStartUrl` | function | 147 |
| 15 | `exchangeGoogleOauthCode` | function | 178 |
| 16 | `getGoogleUserFromTokens` | function | 201 |

### 3.69 `backend/src/services/importJobs.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 62 |
| 2 | `wait` | function | 66 |
| 3 | `yieldImportWorker` | function | 70 |
| 4 | `countCsvRowsFromFile` | function | 75 |
| 5 | `safeJson` | function | 120 |
| 6 | `stringify` | function | 125 |
| 7 | `cleanAuditActorText` | function | 129 |
| 8 | `normalizeAuditActor` | function | 135 |
| 9 | `attachInternalPolicyMetadata` | function | 145 |
| 10 | `stripInternalPolicyMetadata` | function | 156 |
| 11 | `getPersistedAuditActor` | function | 162 |
| 12 | `mergeAuditActors` | function | 167 |
| 13 | `auditWithActor` | function | 177 |
| 14 | `decorateImportJobRow` | function | 195 |
| 15 | `isCancelRequested` | function | 205 |
| 16 | `isImportJobStale` | function | 212 |
| 17 | `isImportJobWorkDrained` | function | 218 |
| 18 | `markStoredImportFilesCancelled` | function | 230 |
| 19 | `reconcileImportJobRow` | function | 240 |
| 20 | `ensureDir` | function | 261 |
| 21 | `ensureImportRoot` | function | 265 |
| 22 | `getJobRoot` | function | 269 |
| 23 | `assertSafeImportPath` | function | 273 |
| 24 | `deleteImportJobFiles` | function | 282 |
| 25 | `clearImportRuntimeFiles` | function | 289 |
| 26 | `createImportJob` | function | 300 |
| 27 | `getImportJob` | function | 320 |
| 28 | `listImportJobs` | function | 326 |
| 29 | `updateJob` | function | 335 |
| 30 | `addJobError` | function | 361 |
| 31 | `getJobErrors` | function | 368 |
| 32 | `normalizeReviewText` | function | 378 |
| 33 | `normalizeReviewIdentifier` | function | 382 |
| 34 | `getBarcodeReviewIssue` | function | 386 |
| 35 | `isBlockingBarcodeIssue` | function | 403 |
| 36 | `buildProductImportReviewState` | function | 407 |
| 37 | `add` | const arrow | 411 |
| 38 | `duplicateGroupCount` | const arrow | 424 |
| 39 | `hasReviewQueryMatch` | function | 435 |
| 40 | `normalizeReviewFilter` | function | 455 |
| 41 | `matchesReviewFilter` | function | 463 |
| 42 | `buildProductReviewIndex` | function | 471 |
| 43 | `getProductConflictForReview` | function | 498 |
| 44 | `getReviewRowNumber` | function | 586 |
| 45 | `summarizeImportReviewRow` | function | 591 |
| 46 | `addProductReviewGroup` | function | 611 |
| 47 | `finalizeProductReviewGroups` | function | 655 |
| 48 | `buildContactReviewIndex` | function | 689 |
| 49 | `getContactConflictForReview` | function | 709 |
| 50 | `getGenericImportConflictForReview` | function | 760 |
| 51 | `applyImportDecisionToRow` | function | 773 |
| 52 | `getImportDecisionMap` | function | 841 |
| 53 | `getImportJobReview` | function | 850 |
| 54 | `updateImportJobDecisions` | function | 960 |
| 55 | `addJobFile` | function | 993 |
| 56 | `getJobFiles` | function | 1012 |
| 57 | `markJobCancelled` | function | 1017 |
| 58 | `isCancelled` | function | 1021 |
| 59 | `waitForQueuedImportMedia` | function | 1027 |
| 60 | `finalizeSkippedImportImages` | function | 1054 |
| 61 | `normalizeLookup` | function | 1071 |
| 62 | `normalizeText` | function | 1075 |
| 63 | `getMimeTypeFromName` | function | 1079 |
| 64 | `normalizeProductSignature` | function | 1115 |
| 65 | `chooseParentProduct` | function | 1123 |
| 66 | `normalizeImportAction` | function | 1137 |
| 67 | `parseOptionalImportId` | function | 1145 |
| 68 | `parseIncomingImageRefs` | function | 1150 |
| 69 | `syncProductImageGallery` | function | 1184 |
| 70 | `loadCurrentGallery` | function | 1207 |
| 71 | `ensureParentProductExists` | function | 1214 |
| 72 | `assertUniqueProductFields` | function | 1223 |
| 73 | `findProductIdentifierConflict` | function | 1266 |
| 74 | `normalizeIdentifierConflictMode` | function | 1296 |
| 75 | `resolveNewProductIdentifiers` | function | 1304 |
| 76 | `copyImageIntoAssets` | function | 1341 |
| 77 | `resolveImageGallery` | function | 1380 |
| 78 | `ensureSettingOptionMap` | function | 1436 |
| 79 | `upsertSettingJson` | function | 1446 |
| 80 | `normalizeRowForProduct` | function | 1453 |
| 81 | `createProductContext` | function | 1501 |
| 82 | `buildImportSignatureKey` | function | 1525 |
| 83 | `ensureCategory` | function | 1531 |
| 84 | `ensureUnit` | function | 1544 |
| 85 | `ensureBrand` | function | 1556 |
| 86 | `ensureSupplier` | function | 1569 |
| 87 | `determineBranch` | function | 1581 |
| 88 | `handleBranchStock` | function | 1596 |
| 89 | `recalcProductStock` | function | 1625 |
| 90 | `insertInventoryMovement` | function | 1629 |
| 91 | `seedBranchRows` | function | 1657 |
| 92 | `processProductRow` | function | 1664 |
| 93 | `processProductRowBatches` | function | 1945 |
| 94 | `flushProgress` | const arrow | 1957 |
| 95 | `processProductRows` | function | 2062 |
| 96 | `preflightImportJob` | function | 2072 |
| 97 | `addFailure` | const arrow | 2086 |
| 98 | `buildImageLookup` | function | 2179 |
| 99 | `normalizeImageMatchKey` | function | 2194 |
| 100 | `processImageOnlyFiles` | function | 2204 |
| 101 | `normalizeContactMode` | function | 2266 |
| 102 | `resolveContactValue` | function | 2271 |
| 103 | `parseFieldRules` | function | 2279 |
| 104 | `generateCustomerMembershipNumber` | function | 2285 |
| 105 | `normalizeImportedMembershipNumber` | function | 2301 |
| 106 | `processContactRowBatches` | function | 2307 |
| 107 | `processContactRows` | function | 2476 |
| 108 | `normalizeInventoryAction` | function | 2486 |
| 109 | `processInventoryRowBatches` | function | 2493 |
| 110 | `processInventoryRows` | function | 2595 |
| 111 | `processSalesRowBatches` | function | 2604 |
| 112 | `processSalesRows` | function | 2819 |
| 113 | `extractZipImages` | function | 2828 |
| 114 | `processImportJob` | function | 2898 |
| 115 | `runLocalJob` | function | 3036 |
| 116 | `normalizeQueueMode` | function | 3043 |
| 117 | `queueNameForMode` | function | 3047 |
| 118 | `configuredQueueDriver` | function | 3051 |
| 119 | `getImportQueueConcurrency` | function | 3056 |
| 120 | `hasBullProducer` | function | 3060 |
| 121 | `hasBullWorkers` | function | 3064 |
| 122 | `removeQueuedBullJobsForImport` | function | 3068 |
| 123 | `getBullConnection` | function | 3091 |
| 124 | `initializeBullQueue` | function | 3104 |
| 125 | `startImportWorkers` | function | 3123 |
| 126 | `startWorker` | const arrow | 3130 |
| 127 | `enqueueImportJob` | function | 3166 |
| 128 | `resetImportJobForRetry` | function | 3209 |
| 129 | `cancelImportJob` | function | 3261 |
| 130 | `listCancellableImportJobs` | function | 3294 |
| 131 | `waitForImportJobsToStop` | function | 3303 |
| 132 | `cancelAllImportJobs` | function | 3325 |
| 133 | `deleteImportJob` | function | 3356 |
| 134 | `deleteAllImportJobs` | function | 3386 |
| 135 | `approveImportJob` | function | 3402 |
| 136 | `recoverImportJobs` | function | 3426 |
| 137 | `getQueueStatus` | function | 3448 |
| 138 | `buildErrorsCsv` | function | 3465 |
| 139 | `escape` | const arrow | 3467 |

### 3.70 `backend/src/services/integrationDoctor.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 39 |
| 2 | `hasValue` | function | 43 |
| 3 | `redactPresence` | function | 47 |
| 4 | `status` | function | 54 |
| 5 | `unique` | function | 62 |
| 6 | `buildExpectedOauthChecklist` | function | 66 |
| 7 | `probeDatabase` | function | 100 |
| 8 | `getSafeTableCount` | function | 110 |
| 9 | `readCurrentBusinessCounts` | function | 119 |
| 10 | `findLatestVerifiedReleaseBackup` | function | 133 |
| 11 | `probeQueue` | function | 157 |
| 12 | `probeBackups` | function | 178 |
| 13 | `buildIntegrationDoctor` | function | 195 |

### 3.71 `backend/src/services/mediaQueue.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `wait` | function | 19 |
| 2 | `queueDriverRequired` | function | 23 |
| 3 | `isImportJobCancelled` | function | 27 |
| 4 | `getMediaConnection` | function | 34 |
| 5 | `initializeMediaQueue` | function | 47 |
| 6 | `processMediaOptimizationJob` | function | 65 |
| 7 | `runLocalMediaJob` | function | 119 |
| 8 | `enqueueMediaOptimization` | function | 131 |
| 9 | `startMediaWorker` | function | 157 |
| 10 | `getMediaQueueStatus` | function | 181 |

### 3.72 `backend/src/services/portalAi.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 15 |
| 2 | `toNumber` | function | 19 |
| 3 | `tokenize` | function | 24 |
| 4 | `nowMs` | function | 32 |
| 5 | `getProviderPriority` | function | 36 |
| 6 | `getProviderCapacity` | function | 41 |
| 7 | `getProviderMaxInputChars` | function | 46 |
| 8 | `getProviderMaxCompletionTokens` | function | 51 |
| 9 | `getProviderTimeoutMs` | function | 56 |
| 10 | `getProviderCooldownMs` | function | 61 |
| 11 | `getRuntimeState` | function | 67 |
| 12 | `pruneProviderState` | function | 82 |
| 13 | `pruneVisitorActivity` | function | 88 |
| 14 | `registerVisitorActivity` | function | 96 |
| 15 | `countActiveVisitors` | function | 106 |
| 16 | `getVisitorMinuteCount` | function | 111 |
| 17 | `summarizeProfile` | function | 118 |
| 18 | `sanitizeQuestion` | function | 128 |
| 19 | `scoreProduct` | function | 132 |
| 20 | `selectCandidateProducts` | function | 164 |
| 21 | `buildPrompt` | function | 196 |
| 22 | `parseAssistantPayload` | function | 221 |
| 23 | `listEnabledChatProviders` | function | 287 |
| 24 | `chooseProviderForAttempt` | function | 306 |
| 25 | `markProviderStart` | function | 327 |
| 26 | `markProviderSuccess` | function | 335 |
| 27 | `markProviderFailure` | function | 342 |
| 28 | `getPortalAiUsageStatus` | function | 350 |
| 29 | `generatePortalAiResponse` | function | 378 |

### 3.73 `backend/src/services/verification.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowMs` | function | 8 |
| 2 | `toIso` | function | 12 |
| 3 | `parseBool` | function | 16 |
| 4 | `isEmailProviderConfigured` | function | 23 |
| 5 | `getVerificationCapabilities` | function | 30 |
| 6 | `normalizeEmail` | function | 37 |
| 7 | `normalizePhone` | function | 44 |
| 8 | `maskDestination` | function | 52 |
| 9 | `generateCode` | function | 65 |
| 10 | `hashCode` | function | 69 |
| 11 | `resolveChannel` | function | 73 |
| 12 | `getDestinationForChannel` | function | 83 |
| 13 | `cleanupExpiredCodes` | function | 88 |
| 14 | `invalidateActiveCodes` | function | 96 |
| 15 | `createVerificationRecord` | function | 109 |
| 16 | `findActiveCode` | function | 136 |
| 17 | `consumeCode` | function | 151 |
| 18 | `verifyCode` | function | 155 |
| 19 | `messageForPurpose` | function | 164 |
| 20 | `sendEmail` | function | 183 |
| 21 | `requestVerificationCode` | function | 247 |

### 3.74 `backend/src/sessionAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDb` | function | 14 |
| 2 | `hashToken` | function | 18 |
| 3 | `buildSessionExpiry` | function | 22 |
| 4 | `createAuthSession` | function | 38 |
| 5 | `isSecureRequest` | function | 59 |
| 6 | `buildSessionCookieOptions` | function | 69 |
| 7 | `setAuthSessionCookie` | function | 79 |
| 8 | `clearAuthSessionCookie` | function | 85 |
| 9 | `buildRevocationTimestamp` | function | 95 |
| 10 | `getPresentedSessionToken` | function | 100 |
| 11 | `getSessionUser` | function | 112 |
| 12 | `revokeAuthSession` | function | 175 |
| 13 | `revokeUserSessions` | function | 187 |

### 3.75 `backend/src/settingsSnapshot.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeUploadPublicPath` | function | 8 |
| 2 | `isUploadPublicPath` | function | 22 |
| 3 | `sanitizeMediaPath` | function | 27 |
| 4 | `sanitizeMediaList` | function | 35 |
| 5 | `uploadPublicPathExists` | function | 48 |
| 6 | `sanitizeSettingValue` | function | 60 |
| 7 | `sanitizeSettingsSnapshot` | function | 64 |

### 3.76 `backend/src/storage/organizationFolders.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 6 |
| 2 | `sanitizeOrganizationFolderLabel` | function | 10 |
| 3 | `buildOrganizationFolderName` | function | 20 |
| 4 | `extractOrganizationPublicId` | function | 26 |
| 5 | `findOrganizationFolderByPublicId` | function | 33 |

### 3.77 `backend/src/systemFsWorker.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatBackupStamp` | function | 15 |
| 2 | `pad` | const arrow | 17 |
| 3 | `respond` | function | 21 |
| 4 | `fail` | function | 25 |
| 5 | `runExportFolder` | function | 30 |
| 6 | `runRelocateDataRoot` | function | 70 |
| 7 | `main` | function | 77 |

### 3.78 `backend/src/systemJobs.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 12 |
| 2 | `makeJobId` | function | 16 |
| 3 | `publicJob` | function | 20 |
| 4 | `findActiveJob` | function | 44 |
| 5 | `safeJsonParse` | function | 55 |
| 6 | `getDb` | function | 64 |
| 7 | `ensureTable` | function | 68 |
| 8 | `persistJob` | function | 123 |
| 9 | `cleanupJobs` | function | 170 |
| 10 | `buildPersistSignature` | function | 190 |
| 11 | `markPersisted` | function | 205 |
| 12 | `flushPersistJob` | function | 210 |
| 13 | `shouldPersistJob` | function | 222 |
| 14 | `schedulePersistJob` | function | 240 |
| 15 | `updateJob` | function | 251 |
| 16 | `SystemJobCancelledError` | class | 268 |
| 17 | `startSystemJob` | function | 276 |
| 18 | `runWorker` | const arrow | 305 |
| 19 | `isCancelled` | const arrow | 324 |
| 20 | `throwIfCancelled` | const arrow | 325 |
| 21 | `progress` | const arrow | 328 |
| 22 | `cancelSystemJob` | function | 381 |
| 23 | `getSystemJob` | function | 398 |
| 24 | `listSystemJobs` | function | 410 |

### 3.79 `backend/src/uploadReferenceCleanup.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `safeJsonArray` | function | 10 |
| 2 | `repairMissingUploadReferences` | function | 19 |

### 3.80 `backend/src/uploadSecurity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `bufferStartsWith` | function | 12 |
| 2 | `isLikelyCsvBuffer` | function | 16 |
| 3 | `detectBufferKind` | function | 29 |
| 4 | `getExpectedUploadedKind` | function | 43 |
| 5 | `validateImageMetadata` | function | 52 |
| 6 | `validateUploadedBuffer` | function | 66 |
| 7 | `validateUploadedPath` | function | 77 |

### 3.81 `backend/src/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `attachWss` | function | 24 |

### 3.82 `backend/src/workers/importWorker.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `start` | function | 10 |
| 2 | `shutdown` | function | 16 |

### 3.83 `backend/src/workers/mediaWorker.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `start` | function | 10 |
| 2 | `shutdown` | function | 15 |

### 3.84 `backend/test/accessControl.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |
| 2 | `makeReq` | function | 22 |

### 3.85 `backend/test/analyticsRuntime.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |

### 3.86 `backend/test/authOtpGuards.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |

### 3.87 `backend/test/authSecurityFlow.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 16 |
| 2 | `makeTempRoot` | function | 34 |
| 3 | `getFreePort` | function | 38 |
| 4 | `waitForHealth` | function | 49 |
| 5 | `startServer` | function | 61 |
| 6 | `stopServer` | function | 82 |
| 7 | `fetchJson` | function | 96 |
| 8 | `extractSessionCookie` | function | 108 |
| 9 | `login` | function | 115 |

### 3.88 `backend/test/backupDefaultDestination.test.js`

- No top-level named symbols detected.

### 3.89 `backend/test/backupPerformanceHardening.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |

### 3.90 `backend/test/backupRetention.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.91 `backend/test/backupSchema.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 17 |

### 3.92 `backend/test/branchStockSearch.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 15 |
| 2 | `makeTempRoot` | function | 26 |
| 3 | `getFreePort` | function | 30 |
| 4 | `waitForHealth` | function | 41 |
| 5 | `startServer` | function | 53 |
| 6 | `stopServer` | function | 72 |
| 7 | `fetchJson` | function | 86 |
| 8 | `extractSessionCookie` | function | 98 |
| 9 | `loginAsAdmin` | function | 105 |
| 10 | `main` | function | 125 |

### 3.93 `backend/test/contactOptions.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.94 `backend/test/dataPath.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 16 |
| 2 | `makeTempRoot` | function | 27 |

### 3.95 `backend/test/defaultRoles.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `makeTempRoot` | function | 13 |
| 2 | `getFreePort` | function | 17 |
| 3 | `waitForHealth` | function | 28 |
| 4 | `startServer` | function | 40 |
| 5 | `stopServer` | function | 59 |
| 6 | `fetchJson` | function | 73 |
| 7 | `login` | function | 82 |
| 8 | `main` | function | 103 |

### 3.96 `backend/test/fileAssetStorageReconcile.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |

### 3.97 `backend/test/fileRouteSecurityFlow.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 17 |
| 2 | `makeTempRoot` | function | 37 |
| 3 | `getFreePort` | function | 41 |
| 4 | `waitForHealth` | function | 52 |
| 5 | `startServer` | function | 64 |
| 6 | `stopServer` | function | 85 |
| 7 | `fetchJson` | function | 99 |
| 8 | `login` | function | 108 |
| 9 | `buildForm` | function | 129 |

### 3.98 `backend/test/fullAutomation.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `read` | function | 9 |
| 2 | `runTest` | function | 13 |

### 3.99 `backend/test/googleDriveSyncVersioning.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 15 |

### 3.100 `backend/test/idempotency.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.101 `backend/test/importCsv.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 13 |
| 2 | `collectBatches` | function | 26 |

### 3.102 `backend/test/importDecisionIntegrity.test.js`

- No top-level named symbols detected.

### 3.103 `backend/test/importJobStateMachine.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 35 |
| 2 | `writeImportFile` | function | 46 |
| 3 | `writeJobFile` | function | 53 |
| 4 | `main` | function | 60 |

### 3.104 `backend/test/importScaleSmoke.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |
| 2 | `makeLargeCsv` | function | 23 |
| 3 | `assertLargeCsvSmoke` | function | 38 |

### 3.105 `backend/test/initials.test.js`

- No top-level named symbols detected.

### 3.106 `backend/test/integrationDoctor.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |

### 3.107 `backend/test/inventorySettingsMediaContracts.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |
| 2 | `readSource` | function | 20 |

### 3.108 `backend/test/mediaOptimization.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |
| 2 | `buildDeterministicPixels` | function | 34 |
| 3 | `buildLogoPixels` | function | 44 |

### 3.109 `backend/test/netSecurity.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |

### 3.110 `backend/test/offlineSecurity.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `read` | function | 5 |
| 2 | `runTest` | function | 9 |

### 3.111 `backend/test/ownedGoogleAuth.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `read` | function | 9 |
| 2 | `runTest` | function | 13 |

### 3.112 `backend/test/permissionPolicy.test.js`

- No top-level named symbols detected.

### 3.113 `backend/test/portalInventoryRegression.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |
| 2 | `readSource` | function | 20 |

### 3.114 `backend/test/portalUtils.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.115 `backend/test/postgresCutoverReadiness.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 10 |

### 3.116 `backend/test/postgresDatabase.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 10 |
| 2 | `FakeClient` | class | 21 |
| 3 | `createFakeDb` | function | 37 |

### 3.117 `backend/test/postgresQueryCompat.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.118 `backend/test/productBatchHierarchy.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |
| 2 | `readSource` | function | 20 |

### 3.119 `backend/test/productExpiry.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |

### 3.120 `backend/test/productImportPolicies.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 15 |

### 3.121 `backend/test/productSearchPagination.test.js`

- No top-level named symbols detected.

### 3.122 `backend/test/rfidRoutes.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 7 |

### 3.123 `backend/test/routeContracts.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |
| 2 | `getRoutePaths` | function | 20 |

### 3.124 `backend/test/runtimeCache.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 23 |
| 2 | `main` | function | 34 |

### 3.125 `backend/test/runtimeVersion.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |

### 3.126 `backend/test/serverUtils.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 22 |
| 2 | `collectHeaders` | const arrow | 230 |

### 3.127 `backend/test/systemJobs.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `wait` | function | 6 |
| 2 | `waitForStatus` | function | 10 |
| 3 | `main` | function | 20 |

### 3.128 `backend/test/uploadSecurity.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.129 `frontend/postcss.config.mjs`

- No top-level named symbols detected.

### 3.130 `frontend/public/runtime-noise-guard.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `text` | function | 10 |
| 2 | `sourceFromEvent` | function | 14 |
| 3 | `isFirstPartyAsset` | function | 23 |
| 4 | `isInjectedSource` | function | 27 |
| 5 | `isKnownNoise` | function | 32 |
| 6 | `suppress` | function | 45 |

### 3.131 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.js`

- No top-level named symbols detected.

### 3.132 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.worker.js`

- No top-level named symbols detected.

### 3.133 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd-threads.js`

- No top-level named symbols detected.

### 3.134 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd.js`

- No top-level named symbols detected.

### 3.135 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core.js`

- No top-level named symbols detected.

### 3.136 `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js`

- No top-level named symbols detected.

### 3.137 `frontend/public/sw.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `openBusinessDb` | function | 25 |
| 2 | `txDone` | function | 33 |
| 3 | `requestResult` | function | 41 |
| 4 | `readSetting` | function | 48 |
| 5 | `stableStringify` | function | 55 |
| 6 | `sha256` | function | 61 |
| 7 | `readQueuedBusinessOutbox` | function | 69 |
| 8 | `putBusinessOutboxRow` | function | 78 |
| 9 | `deleteBusinessOutboxRow` | function | 85 |
| 10 | `readPendingFileChunks` | function | 92 |
| 11 | `readQueuedSales` | function | 101 |
| 12 | `putQueueRow` | function | 114 |
| 13 | `deleteQueueRow` | function | 125 |
| 14 | `broadcastSyncEvent` | function | 132 |
| 15 | `nextRetryAt` | function | 143 |
| 16 | `markQueueFailure` | function | 152 |
| 17 | `replayQueuedSale` | function | 161 |
| 18 | `responsePayload` | const arrow | 183 |
| 19 | `syncOutbox` | function | 224 |
| 20 | `isSameOrigin` | function | 347 |
| 21 | `isNeverCachedPath` | function | 355 |
| 22 | `isCacheableStaticPath` | function | 363 |
| 23 | `appShellFallback` | function | 370 |
| 24 | `networkFirstStatic` | function | 389 |

### 3.138 `frontend/public/theme-bootstrap.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isKnownBridgeNoise` | function | 11 |
| 2 | `isKnownEvalNoise` | function | 22 |
| 3 | `isKnownStyleNoise` | function | 30 |
| 4 | `isStaleModuleGraphError` | function | 46 |
| 5 | `requestStaleModuleReload` | function | 53 |
| 6 | `isFirstPartyBuiltAssetSource` | function | 70 |
| 7 | `hasInjectedBundleSource` | function | 78 |
| 8 | `isGuardableSheetError` | function | 88 |
| 9 | `shouldSuppressRuntimeError` | function | 93 |
| 10 | `installStyleSheetGuards` | function | 103 |

### 3.139 `frontend/src/api/http.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSyncServerUrl` | export function | 38 |
| 2 | `getSyncToken` | export function | 39 |
| 3 | `setSyncServerUrl` | export function | 41 |
| 4 | `setSyncToken` | export function | 42 |
| 5 | `hasStoredAuthSession` | function | 61 |
| 6 | `isProtectedAdminHost` | function | 70 |
| 7 | `normalizeApiPath` | function | 87 |
| 8 | `isRequiredRuntimeApiPath` | export function | 99 |
| 9 | `getApiMismatchKey` | function | 104 |
| 10 | `getApiVersionMismatchCooldown` | export function | 108 |
| 11 | `dispatchApiVersionMismatch` | function | 119 |
| 12 | `createApiVersionMismatchError` | export function | 133 |
| 13 | `isApiVersionMismatchError` | export function | 144 |
| 14 | `markApiVersionMismatch` | export function | 148 |
| 15 | `cacheGet` | export function | 158 |
| 16 | `cacheSet` | export function | 162 |
| 17 | `cacheInvalidate` | export function | 163 |
| 18 | `cacheClearAll` | export function | 166 |
| 19 | `logCall` | function | 194 |
| 20 | `getCallLog` | export function | 199 |
| 21 | `clearCallLog` | export function | 200 |
| 22 | `getClientMetaHeaders` | function | 202 |
| 23 | `createApiError` | function | 206 |
| 24 | `isCloudflareAccessRedirectResponse` | export function | 222 |
| 25 | `createCloudflareAccessError` | function | 235 |
| 26 | `dispatchUnauthorized` | function | 245 |
| 27 | `shouldCompareRuntimeVersions` | export function | 257 |
| 28 | `dispatchRuntimeVersionMismatch` | function | 273 |
| 29 | `checkRuntimeVersionFromHealth` | function | 285 |
| 30 | `createWriteBlockedError` | function | 292 |
| 31 | `dispatchWriteBlocked` | function | 303 |
| 32 | `dispatchTransientGatewayOutage` | function | 318 |
| 33 | `isWriteConflictError` | export function | 334 |
| 34 | `isWriteBlockedError` | export function | 338 |
| 35 | `isInvalidSessionError` | export function | 342 |
| 36 | `requireLiveServerWrite` | export function | 351 |
| 37 | `getConflictRefreshChannels` | function | 383 |
| 38 | `dispatchGlobalDataRefresh` | function | 392 |
| 39 | `sleep` | function | 401 |
| 40 | `hasUsableLocalData` | function | 405 |
| 41 | `tryServerReadWithRetry` | function | 420 |
| 42 | `noteReadFailure` | function | 431 |
| 43 | `resolveLocalRead` | function | 445 |
| 44 | `stableStringifyForDedupe` | function | 452 |
| 45 | `clampDedupeBody` | function | 462 |
| 46 | `buildApiRequestDedupeKey` | export function | 468 |
| 47 | `methodAllowsRequestBody` | function | 474 |
| 48 | `__resetApiWriteDedupeForTests` | export function | 479 |
| 49 | `apiFetch` | export function | 484 |
| 50 | `requestPromise` | const arrow | 504 |
| 51 | `parsed` | const arrow | 541 |
| 52 | `isNetErr` | export function | 580 |
| 53 | `isTransientGatewayError` | export function | 586 |
| 54 | `isReachableServerResponseStatus` | export function | 591 |
| 55 | `shouldDispatchUnauthorized` | function | 602 |
| 56 | `isConnectivityError` | function | 615 |
| 57 | `isServerOnline` | export function | 636 |
| 58 | `setServerHealth` | function | 638 |
| 59 | `pingServerHealth` | function | 651 |
| 60 | `startHealthCheck` | export function | 683 |
| 61 | `cacheGetStale` | export function | 714 |
| 62 | `getChannelRefreshKey` | function | 723 |
| 63 | `emitCacheRefresh` | function | 727 |
| 64 | `clearInflight` | function | 741 |
| 65 | `hasReusableInflight` | function | 746 |
| 66 | `raceServerReadWithLocalFallback` | function | 756 |
| 67 | `route` | export function | 831 |

### 3.140 `frontend/src/api/localDb.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `localGetSettings` | export function | 139 |
| 2 | `localSaveSettings` | export function | 146 |
| 3 | `localGetSettingsMeta` | export function | 154 |
| 4 | `localSaveSettingsMeta` | export function | 158 |
| 5 | `replaceTableContents` | export function | 168 |
| 6 | `resetLocalMirrorDb` | export function | 212 |
| 7 | `clearLocalMirrorTables` | export function | 227 |
| 8 | `parseCSV` | export function | 253 |
| 9 | `splitCSVLine` | function | 257 |
| 10 | `buildCSVTemplate` | export function | 268 |

### 3.141 `frontend/src/api/methods.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDeviceInfo` | function | 3 |
| 2 | `getPortalBaseUrl` | function | 52 |
| 3 | `getCurrentUserContext` | function | 57 |
| 4 | `registerOutboxBackgroundSync` | function | 79 |
| 5 | `hasStoredUserSession` | function | 91 |
| 6 | `emitSyncQueueChanged` | function | 100 |
| 7 | `discardPendingSyncQueue` | export function | 107 |
| 8 | `createClientRequestId` | function | 125 |
| 9 | `ensureClientRequestId` | function | 132 |
| 10 | `getPendingSyncState` | export function | 138 |
| 11 | `retryPendingSyncNow` | export function | 179 |
| 12 | `canRefreshOfflineDeviceSnapshot` | function | 183 |
| 13 | `readOfflineDeviceSnapshotMeta` | function | 190 |
| 14 | `writeOfflineDeviceSnapshotMeta` | function | 198 |
| 15 | `runOfflineSnapshotStep` | function | 215 |
| 16 | `refreshOfflineDeviceSnapshot` | export function | 227 |
| 17 | `previousMeta` | const arrow | 235 |
| 18 | `invalidateClientRuntimeState` | function | 280 |
| 19 | `withExpectedUpdatedAt` | function | 296 |
| 20 | `withSettingsExpectedUpdatedAt` | function | 310 |
| 21 | `appendActorQuery` | function | 320 |
| 22 | `fetchJsonWithTimeout` | function | 333 |
| 23 | `mirrorReadResult` | function | 351 |
| 24 | `routeMirrored` | function | 360 |
| 25 | `shouldPersistLocalMirror` | function | 366 |
| 26 | `purgeSensitiveLiveServerMirrors` | function | 370 |
| 27 | `mirrorTable` | function | 381 |
| 28 | `buildQueryCacheStorageKey` | function | 395 |
| 29 | `readCachedQueryResult` | function | 399 |
| 30 | `writeCachedQueryResult` | function | 413 |
| 31 | `clearCachedQueryResults` | function | 427 |
| 32 | `getNotificationSummaryFallback` | function | 460 |
| 33 | `getDriveSyncStatusFallback` | function | 469 |
| 34 | `readNotificationSummaryMissingUntil` | function | 477 |
| 35 | `markNotificationSummaryMissing` | function | 489 |
| 36 | `clearNotificationSummaryMissing` | function | 504 |
| 37 | `readStorageNumber` | function | 513 |
| 38 | `writeStorageNumber` | function | 529 |
| 39 | `clearStorageNumber` | function | 540 |
| 40 | `login` | export function | 552 |
| 41 | `logout` | export function | 564 |
| 42 | `resetPasswordWithOtp` | export function | 567 |
| 43 | `requestPasswordResetEmail` | export function | 570 |
| 44 | `completePasswordReset` | export function | 573 |
| 45 | `updateSessionDuration` | export function | 576 |
| 46 | `getVerificationCapabilities` | export function | 579 |
| 47 | `getSystemConfig` | export function | 582 |
| 48 | `getNotificationSummary` | export function | 585 |
| 49 | `getSystemDebugLog` | export function | 627 |
| 50 | `startGoogleOauth` | export function | 630 |
| 51 | `completeGoogleOauth` | export function | 633 |
| 52 | `unlinkGoogleOauth` | export function | 636 |
| 53 | `getAppBootstrap` | export function | 639 |
| 54 | `buildLocalBootstrap` | const arrow | 640 |
| 55 | `getOrganizationBootstrap` | export function | 697 |
| 56 | `searchOrganizations` | export function | 700 |
| 57 | `getCurrentOrganization` | export function | 704 |
| 58 | `getSettings` | export function | 709 |
| 59 | `saveSettings` | export function | 734 |
| 60 | `runSave` | const arrow | 735 |
| 61 | `getCategories` | const arrow | 795 |
| 62 | `createCategory` | const arrow | 796 |
| 63 | `updateCategory` | const arrow | 801 |
| 64 | `deleteCategory` | const arrow | 806 |
| 65 | `getUnits` | const arrow | 813 |
| 66 | `createUnit` | const arrow | 814 |
| 67 | `updateUnit` | const arrow | 819 |
| 68 | `deleteUnit` | const arrow | 824 |
| 69 | `getBranches` | const arrow | 831 |
| 70 | `getBranchSummary` | const arrow | 832 |
| 71 | `updateBranch` | const arrow | 834 |
| 72 | `deleteBranch` | const arrow | 838 |
| 73 | `getBranchStock` | const arrow | 842 |
| 74 | `getTransfers` | const arrow | 846 |
| 75 | `getBranchStockIntegrity` | const arrow | 848 |
| 76 | `getProducts` | const arrow | 852 |
| 77 | `searchProducts` | const arrow | 853 |
| 78 | `getProductsByIds` | const arrow | 863 |
| 79 | `getProductFilters` | const arrow | 874 |
| 80 | `getProductLookupUsage` | const arrow | 884 |
| 81 | `replaceProductLookupValues` | const arrow | 892 |
| 82 | `getCatalogMeta` | export function | 905 |
| 83 | `getCatalogProducts` | export function | 913 |
| 84 | `getPortalConfig` | export function | 921 |
| 85 | `getPortalBootstrap` | export function | 929 |
| 86 | `getPortalCatalogMeta` | export function | 937 |
| 87 | `getPortalCatalogProducts` | export function | 945 |
| 88 | `searchPortalCatalogProducts` | export function | 953 |
| 89 | `lookupPortalMembership` | export function | 965 |
| 90 | `createPortalSubmission` | export function | 975 |
| 91 | `getPortalAiStatus` | export function | 989 |
| 92 | `askPortalAi` | export function | 997 |
| 93 | `getPortalSubmissionsForReview` | const arrow | 1011 |
| 94 | `reviewPortalSubmission` | const arrow | 1013 |
| 95 | `getAiProviders` | const arrow | 1016 |
| 96 | `createAiProvider` | const arrow | 1018 |
| 97 | `updateAiProvider` | const arrow | 1020 |
| 98 | `deleteAiProvider` | const arrow | 1022 |
| 99 | `testAiProvider` | const arrow | 1024 |
| 100 | `getAiResponses` | const arrow | 1026 |
| 101 | `createProduct` | export function | 1028 |
| 102 | `updateProduct` | export function | 1042 |
| 103 | `deleteProduct` | const arrow | 1055 |
| 104 | `buildMultipartHeaders` | function | 1072 |
| 105 | `apiFormPost` | function | 1082 |
| 106 | `withImportDeviceInfo` | const arrow | 1101 |
| 107 | `listImportJobs` | const arrow | 1104 |
| 108 | `getImportJobReview` | const arrow | 1113 |
| 109 | `updateImportJobDecisions` | const arrow | 1117 |
| 110 | `startImportJob` | const arrow | 1120 |
| 111 | `approveImportJob` | const arrow | 1122 |
| 112 | `cancelImportJob` | const arrow | 1124 |
| 113 | `retryImportJob` | const arrow | 1126 |
| 114 | `deleteImportJob` | const arrow | 1128 |
| 115 | `getImportQueueStatus` | const arrow | 1147 |
| 116 | `downloadImportJobErrors` | export function | 1149 |
| 117 | `uploadImportJobCsv` | export function | 1169 |
| 118 | `uploadImportJobZip` | export function | 1180 |
| 119 | `uploadImportJobImages` | export function | 1191 |
| 120 | `getFiles` | export function | 1219 |
| 121 | `uploadFileAsset` | export function | 1235 |
| 122 | `finish` | const arrow | 1262 |
| 123 | `abortListener` | const arrow | 1269 |
| 124 | `deleteFileAsset` | export function | 1316 |
| 125 | `uploadProductImage` | export function | 1328 |
| 126 | `uploadUserAvatar` | export function | 1362 |
| 127 | `openCSVDialog` | export function | 1401 |
| 128 | `openImageDialog` | export function | 1421 |
| 129 | `getImageDataUrl` | export function | 1429 |
| 130 | `getActionHistory` | const arrow | 1441 |
| 131 | `updateActionHistory` | const arrow | 1447 |
| 132 | `getInventorySummary` | const arrow | 1453 |
| 133 | `getInventoryStats` | const arrow | 1454 |
| 134 | `searchInventoryProducts` | const arrow | 1458 |
| 135 | `getInventoryMovements` | const arrow | 1468 |
| 136 | `getInventoryReasons` | const arrow | 1493 |
| 137 | `saveInventoryReasons` | const arrow | 1495 |
| 138 | `buildOfflineSaleReceiptNumber` | function | 1498 |
| 139 | `isRetryableOfflineSaleError` | function | 1504 |
| 140 | `findQueuedSale` | function | 1513 |
| 141 | `putOfflineSaleMirror` | function | 1520 |
| 142 | `queueOfflineSale` | function | 1545 |
| 143 | `queuedSaleBackoffMs` | function | 1603 |
| 144 | `updateQueuedRow` | function | 1608 |
| 145 | `completeQueuedSale` | function | 1617 |
| 146 | `failQueuedSale` | function | 1644 |
| 147 | `markQueuedSaleConflict` | function | 1657 |
| 148 | `syncPendingSalesQueue` | function | 1679 |
| 149 | `getRfidStatus` | const arrow | 1720 |
| 150 | `searchRfidTags` | const arrow | 1726 |
| 151 | `recordRfidSessionEvents` | const arrow | 1732 |
| 152 | `applyRfidSession` | const arrow | 1736 |
| 153 | `createSale` | export function | 1740 |
| 154 | `getSales` | const arrow | 1752 |
| 155 | `getDashboard` | const arrow | 1759 |
| 156 | `getAnalytics` | const arrow | 1760 |
| 157 | `getCustomers` | const arrow | 1769 |
| 158 | `getCustomerPointSummaries` | const arrow | 1790 |
| 159 | `createCustomer` | export function | 1794 |
| 160 | `updateCustomer` | const arrow | 1798 |
| 161 | `deleteCustomer` | const arrow | 1802 |
| 162 | `downloadCustomerTemplate` | const arrow | 1807 |
| 163 | `getSuppliers` | const arrow | 1816 |
| 164 | `createSupplier` | export function | 1821 |
| 165 | `updateSupplier` | const arrow | 1825 |
| 166 | `deleteSupplier` | const arrow | 1829 |
| 167 | `downloadSupplierTemplate` | const arrow | 1834 |
| 168 | `getDeliveryContacts` | const arrow | 1843 |
| 169 | `createDeliveryContact` | export function | 1848 |
| 170 | `updateDeliveryContact` | const arrow | 1852 |
| 171 | `deleteDeliveryContact` | const arrow | 1856 |
| 172 | `getUsers` | const arrow | 1863 |
| 173 | `updateUser` | const arrow | 1865 |
| 174 | `getUserProfile` | const arrow | 1866 |
| 175 | `getUserAuthMethods` | const arrow | 1867 |
| 176 | `updateUserProfile` | const arrow | 1869 |
| 177 | `disconnectUserAuthProvider` | const arrow | 1871 |
| 178 | `changeUserPassword` | const arrow | 1873 |
| 179 | `resetPassword` | const arrow | 1875 |
| 180 | `getRoles` | const arrow | 1878 |
| 181 | `updateRole` | const arrow | 1880 |
| 182 | `deleteRole` | const arrow | 1881 |
| 183 | `getCustomTables` | const arrow | 1884 |
| 184 | `getCustomTableData` | const arrow | 1886 |
| 185 | `insertCustomRow` | const arrow | 1887 |
| 186 | `updateCustomRow` | const arrow | 1888 |
| 187 | `deleteCustomRow` | const arrow | 1889 |
| 188 | `getAuditLogs` | const arrow | 1892 |
| 189 | `deleteAuditLogsRetention` | const arrow | 1918 |
| 190 | `wait` | function | 1922 |
| 191 | `getSystemJob` | export function | 1926 |
| 192 | `cancelSystemJob` | export function | 1931 |
| 193 | `pollSystemJob` | export function | 1936 |
| 194 | `waitForSystemJob` | function | 1962 |
| 195 | `getIntegrationDoctor` | export function | 1970 |
| 196 | `queueBackupFolderExport` | export function | 1981 |
| 197 | `exportBackupFolder` | export function | 1990 |
| 198 | `queueBackupFolderRestore` | export function | 1994 |
| 199 | `importBackupFolder` | export function | 2001 |
| 200 | `getGoogleDriveSyncStatus` | const arrow | 2009 |
| 201 | `saveGoogleDriveSyncPreferences` | const arrow | 2043 |
| 202 | `startGoogleDriveSyncOauth` | const arrow | 2046 |
| 203 | `disconnectGoogleDriveSync` | const arrow | 2049 |
| 204 | `forgetGoogleDriveSyncCredentials` | const arrow | 2052 |
| 205 | `queueGoogleDriveSyncNow` | const arrow | 2055 |
| 206 | `syncGoogleDriveNow` | const arrow | 2058 |
| 207 | `resetData` | export function | 2063 |
| 208 | `factoryReset` | export function | 2070 |
| 209 | `downloadImportTemplate` | export function | 2078 |
| 210 | `openPath` | export function | 2125 |
| 211 | `getReturns` | const arrow | 2134 |
| 212 | `createReturn` | export function | 2140 |
| 213 | `createSupplierReturn` | export function | 2146 |
| 214 | `updateSaleStatus` | const arrow | 2155 |
| 215 | `attachSaleCustomer` | const arrow | 2171 |
| 216 | `getSalesExport` | const arrow | 2195 |
| 217 | `updateReturn` | const arrow | 2199 |
| 218 | `testSyncServer` | export function | 2229 |
| 219 | `openFolderDialog` | export function | 2248 |
| 220 | `getDataPath` | const arrow | 2259 |
| 221 | `getScaleMigrationStatus` | const arrow | 2260 |
| 222 | `prepareScaleMigration` | const arrow | 2261 |
| 223 | `runScaleMigration` | const arrow | 2262 |
| 224 | `setDataPath` | export function | 2263 |
| 225 | `resetDataPath` | export function | 2268 |
| 226 | `browseDir` | const arrow | 2273 |

### 3.142 `frontend/src/api/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `hasStoredAuthSession` | function | 21 |
| 2 | `isProtectedAdminHost` | function | 30 |
| 3 | `shouldDebugWs` | function | 40 |
| 4 | `logWs` | function | 50 |
| 5 | `connectWS` | export function | 56 |
| 6 | `disconnectWS` | export function | 147 |
| 7 | `reconnectWS` | export function | 168 |
| 8 | `scheduleReconnect` | function | 173 |
| 9 | `isWSConnected` | export function | 192 |

### 3.143 `frontend/src/App.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getChunkErrorMessage` | function | 97 |
| 2 | `isChunkLoadError` | function | 102 |
| 3 | `createChunkTimeoutError` | function | 111 |
| 4 | `isRetryableImportError` | function | 117 |
| 5 | `importWithTimeout` | function | 125 |
| 6 | `clearRetryMarker` | function | 141 |
| 7 | `buildChunkRecoveryUrl` | function | 148 |
| 8 | `clearStaleShellCaches` | function | 159 |
| 9 | `triggerChunkRecoveryReload` | function | 171 |
| 10 | `reload` | const arrow | 178 |
| 11 | `createChunkReloadStallError` | function | 188 |
| 12 | `shouldRetryChunk` | function | 194 |
| 13 | `lazyWithRetry` | function | 204 |
| 14 | `getWarmupImporters` | function | 279 |
| 15 | `shouldSkipBackgroundWarmup` | function | 291 |
| 16 | `getDataWarmupLoaders` | function | 300 |
| 17 | `createWarmupLoader` | function | 309 |
| 18 | `runWarmupBatches` | function | 314 |
| 19 | `getPageEntryWarmupLoaders` | function | 323 |
| 20 | `useMountedPages` | function | 330 |
| 21 | `syncProfile` | const arrow | 344 |
| 22 | `useSyncErrorBanner` | function | 373 |
| 23 | `refreshPendingSync` | const arrow | 383 |
| 24 | `onSyncError` | const arrow | 388 |
| 25 | `onTransientOutage` | const arrow | 393 |
| 26 | `onSyncRecovered` | const arrow | 401 |
| 27 | `onQueueChanged` | const arrow | 408 |
| 28 | `onVaultLocked` | const arrow | 409 |
| 29 | `onAppUpdate` | const arrow | 410 |
| 30 | `onConflictReview` | const arrow | 411 |
| 31 | `useVisibilityRecovery` | function | 458 |
| 32 | `onVisible` | const arrow | 462 |
| 33 | `onFocus` | const arrow | 472 |
| 34 | `useChunkWarmup` | function | 490 |
| 35 | `runWarmup` | const arrow | 503 |
| 36 | `useDataWarmup` | function | 535 |
| 37 | `runWarmup` | const arrow | 546 |
| 38 | `usePageEntryWarmup` | function | 571 |
| 39 | `run` | const arrow | 603 |
| 40 | `PageErrorBoundary` | class | 626 |
| 41 | `Notification` | function | 679 |
| 42 | `SyncErrorBanner` | function | 692 |
| 43 | `GlobalScrollControls` | function | 714 |
| 44 | `scrollTo` | const arrow | 715 |
| 45 | `formatSyncTimestamp` | function | 751 |
| 46 | `OfflineModeBanner` | function | 763 |
| 47 | `PageLoader` | function | 912 |
| 48 | `NotificationCenterFallback` | function | 955 |
| 49 | `PageSlot` | function | 969 |
| 50 | `PublicCatalogView` | function | 995 |
| 51 | `App` | export default function | 1005 |
| 52 | `onQueued` | const arrow | 1069 |
| 53 | `onSynced` | const arrow | 1082 |
| 54 | `handleLocationChange` | const arrow | 1107 |
| 55 | `loadFavicon` | function | 1153 |

### 3.144 `frontend/src/app/appShellUtils.mjs`

- No top-level named symbols detected.

### 3.145 `frontend/src/app/appShellUtils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeAppPath` | export function | 60 |
| 2 | `getAdminPageFromPath` | export function | 70 |
| 3 | `getAdminPathForPage` | export function | 77 |
| 4 | `isAdminAppPath` | export function | 81 |
| 5 | `isPublicCatalogPath` | export function | 88 |
| 6 | `updateMountedPages` | export function | 99 |
| 7 | `getMountedPageLimit` | export function | 119 |
| 8 | `shouldWarmPageEntries` | export function | 137 |
| 9 | `getNotificationPrefix` | export function | 144 |
| 10 | `getNotificationColor` | export function | 151 |

### 3.146 `frontend/src/app/publicErrorRecovery.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isPublicDomMutationError` | export function | 3 |
| 2 | `shouldAttemptPublicDomRecovery` | export function | 8 |
| 3 | `clearPublicDomRecoveryMarker` | export function | 19 |

### 3.147 `frontend/src/AppContext.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `flattenTranslationTree` | function | 37 |
| 2 | `safeStorageGet` | function | 93 |
| 3 | `safeStorageSet` | function | 101 |
| 4 | `safeStorageRemove` | function | 107 |
| 5 | `getStoredUserPayload` | function | 113 |
| 6 | `getStoredUserExpiry` | function | 117 |
| 7 | `clearPersistedAuthState` | function | 121 |
| 8 | `persistAuthState` | function | 134 |
| 9 | `computeSessionExpiryMs` | function | 148 |
| 10 | `readDeviceSettings` | function | 164 |
| 11 | `writeDeviceSettings` | function | 172 |
| 12 | `writeStoredSessionDuration` | function | 178 |
| 13 | `readPendingOauthLink` | function | 186 |
| 14 | `clearPendingOauthLink` | function | 200 |
| 15 | `readOauthCallbackResult` | function | 206 |
| 16 | `clearOauthCallbackResult` | function | 217 |
| 17 | `mergeSettingsWithDeviceOverrides` | function | 223 |
| 18 | `normalizeDateInput` | function | 227 |
| 19 | `isBrokenLocalizedString` | export function | 233 |
| 20 | `buildRuntimeDescriptorFromBootstrap` | function | 245 |
| 21 | `LoadingScreen` | function | 273 |
| 22 | `AccessDenied` | function | 286 |
| 23 | `AppProvider` | export function | 298 |
| 24 | `onUpdate` | const arrow | 522 |
| 25 | `onStatus` | const arrow | 552 |
| 26 | `poll` | const arrow | 560 |
| 27 | `onError` | const arrow | 580 |
| 28 | `onWriteBlocked` | const arrow | 596 |
| 29 | `onRuntimeMismatch` | const arrow | 605 |
| 30 | `onConflict` | const arrow | 624 |
| 31 | `onUnauthorized` | const arrow | 693 |
| 32 | `handleOtpLogin` | const arrow | 751 |
| 33 | `handleUserUpdated` | const arrow | 793 |
| 34 | `discoverSyncUrl` | const arrow | 830 |
| 35 | `hexAlpha` | const arrow | 1004 |
| 36 | `clearCallbackUrl` | const arrow | 1215 |
| 37 | `clearPendingLink` | const arrow | 1219 |
| 38 | `run` | const arrow | 1223 |
| 39 | `useApp` | const arrow | 1585 |
| 40 | `useSync` | const arrow | 1586 |
| 41 | `useT` | const arrow | 1589 |

### 3.148 `frontend/src/components/auth/Login.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readPendingOauthLogin` | function | 27 |
| 2 | `clearPendingOauthLogin` | function | 41 |
| 3 | `readOauthCallbackResult` | function | 47 |
| 4 | `clearOauthCallbackResult` | function | 58 |
| 5 | `OauthButton` | function | 64 |
| 6 | `ModeBackButton` | function | 78 |
| 7 | `Login` | export default function | 91 |
| 8 | `tr` | const arrow | 93 |
| 9 | `rememberOrganization` | const arrow | 162 |
| 10 | `loadCapabilities` | const arrow | 198 |
| 11 | `bootstrap` | const arrow | 218 |
| 12 | `clearCallbackUrl` | const arrow | 297 |
| 13 | `run` | const arrow | 302 |
| 14 | `rememberedOrg` | const arrow | 357 |
| 15 | `getDeviceContext` | const arrow | 409 |
| 16 | `handleLogin` | const arrow | 411 |
| 17 | `handleOtp` | const arrow | 441 |
| 18 | `handleOtpInput` | const arrow | 475 |
| 19 | `handleResetWithOtp` | const arrow | 480 |
| 20 | `handleResetWithEmail` | const arrow | 517 |
| 21 | `handleCompleteEmailReset` | const arrow | 546 |
| 22 | `handleStartOauth` | const arrow | 579 |
| 23 | `closeAuxMode` | const arrow | 627 |

### 3.149 `frontend/src/components/branches/Branches.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatTransferDate` | function | 39 |
| 2 | `Branches` | export default function | 56 |
| 3 | `promise` | const arrow | 101 |
| 4 | `loadBranchStock` | const arrow | 231 |
| 5 | `loadMoreBranchStock` | const arrow | 252 |
| 6 | `handleSaveBranch` | const arrow | 278 |
| 7 | `handleDelete` | const arrow | 346 |
| 8 | `handleBulkDelete` | const arrow | 394 |
| 9 | `toggleSelect` | const arrow | 480 |
| 10 | `toggleSelectAll` | const arrow | 489 |

### 3.150 `frontend/src/components/branches/BranchForm.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BranchForm` | export default function | 11 |
| 2 | `set` | const arrow | 33 |
| 3 | `handleSave` | const arrow | 45 |

### 3.151 `frontend/src/components/branches/TransferModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeTransferStockRows` | function | 14 |
| 2 | `TransferModal` | export default function | 27 |
| 3 | `loadStock` | function | 79 |
| 4 | `handleTransfer` | const arrow | 125 |

### 3.152 `frontend/src/components/catalog/CatalogEditorSurface.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CatalogEditorSurface` | export default function | 7 |

### 3.153 `frontend/src/components/catalog/CatalogImageField.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CatalogImageField` | export default function | 4 |

### 3.154 `frontend/src/components/catalog/CatalogPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadCatalogEditorSurface` | const arrow | 92 |
| 2 | `loadCatalogSecondaryTabs` | const arrow | 93 |
| 3 | `loadCatalogProductsSection` | const arrow | 94 |
| 4 | `loadCatalogPreviewSurface` | const arrow | 95 |
| 5 | `getAboutBlockLabel` | function | 115 |
| 6 | `withAssetVersion` | function | 121 |
| 7 | `sanitizePortalMediaValue` | function | 131 |
| 8 | `tt` | function | 141 |
| 9 | `toBoolean` | function | 149 |
| 10 | `toNumber` | function | 156 |
| 11 | `normalizePriceDisplay` | function | 162 |
| 12 | `normalizeHexColor` | function | 167 |
| 13 | `normalizeExternalUrl` | function | 173 |
| 14 | `createFaqId` | function | 189 |
| 15 | `normalizeFaqItems` | function | 193 |
| 16 | `translatedPortalText` | function | 249 |
| 17 | `translateConfiguredFaqText` | function | 255 |
| 18 | `localizeConfiguredFaqItems` | function | 262 |
| 19 | `buildFaqStarterItems` | function | 270 |
| 20 | `buildAiFaqStarterItems` | function | 279 |
| 21 | `hexToRgba` | function | 289 |
| 22 | `readPortalCache` | function | 300 |
| 23 | `writePortalCache` | function | 323 |
| 24 | `normalizePortalPath` | function | 342 |
| 25 | `isReservedPortalPath` | function | 355 |
| 26 | `getPortalTabs` | function | 359 |
| 27 | `resolvePortalActiveTab` | function | 370 |
| 28 | `buildDraft` | function | 378 |
| 29 | `applyDraft` | function | 478 |
| 30 | `getBranchQty` | function | 602 |
| 31 | `getStockStatus` | function | 609 |
| 32 | `normalizeProductGallery` | function | 619 |
| 33 | `normalizePortalProductSearch` | function | 636 |
| 34 | `buildRecommendedProductOption` | function | 640 |
| 35 | `productMatchesRecommendedSearch` | function | 650 |
| 36 | `formatDateTime` | function | 665 |
| 37 | `formatPortalPrice` | function | 672 |
| 38 | `ImageField` | function | 685 |
| 39 | `pickImageAsDataUrl` | function | 775 |
| 40 | `pickMultipleImagesAsDataUrls` | function | 794 |
| 41 | `replaceVars` | function | 815 |
| 42 | `getPortalResourceText` | function | 819 |
| 43 | `isFirstPartyTranslateTarget` | function | 865 |
| 44 | `normalizePortalTranslateChoice` | function | 872 |
| 45 | `isDocumentVisible` | function | 880 |
| 46 | `sleep` | function | 885 |
| 47 | `CatalogPage` | export default function | 991 |
| 48 | `warmPublicProductsPanel` | const arrow | 1105 |
| 49 | `warmPublicSecondaryTabs` | const arrow | 1109 |
| 50 | `copy` | const arrow | 1188 |
| 51 | `resolveVisibleTab` | const arrow | 1208 |
| 52 | `getMediaUploadState` | const arrow | 1256 |
| 53 | `updateMediaUploadState` | const arrow | 1257 |
| 54 | `forgetMediaUploadState` | const arrow | 1264 |
| 55 | `loadAssistantStatus` | function | 1311 |
| 56 | `openProductGallery` | function | 1333 |
| 57 | `changeTranslateTarget` | function | 1346 |
| 58 | `isPortalLoadCurrent` | function | 1394 |
| 59 | `loadPortalEditorData` | function | 1398 |
| 60 | `refreshPortalView` | function | 1435 |
| 61 | `loadPortal` | function | 1464 |
| 62 | `ensureLink` | const arrow | 1720 |
| 63 | `updateVisibility` | const arrow | 1813 |
| 64 | `handleScroll` | const arrow | 1843 |
| 65 | `initWidget` | const arrow | 1888 |
| 66 | `waitForWidget` | const arrow | 1906 |
| 67 | `toggleFilterValue` | function | 2030 |
| 68 | `clearPortalFilters` | function | 2038 |
| 69 | `setDraft` | function | 2046 |
| 70 | `toggleRecommendedProduct` | function | 2051 |
| 71 | `openPortalImage` | function | 2060 |
| 72 | `setAboutBlocksDraft` | function | 2071 |
| 73 | `setPromoItemsDraft` | function | 2075 |
| 74 | `getPortalMediaValue` | function | 2079 |
| 75 | `setPortalMediaValue` | function | 2093 |
| 76 | `clearPortalUploadPreview` | function | 2107 |
| 77 | `clearPortalMediaTarget` | function | 2113 |
| 78 | `uploadPortalMedia` | function | 2124 |
| 79 | `cancelPortalMediaUpload` | function | 2194 |
| 80 | `updateAboutBlock` | function | 2200 |
| 81 | `updatePromoItem` | function | 2206 |
| 82 | `addAboutBlock` | function | 2212 |
| 83 | `addPromoItem` | function | 2216 |
| 84 | `moveAboutBlockBefore` | function | 2220 |
| 85 | `removeAboutBlock` | function | 2232 |
| 86 | `movePromoItemBefore` | function | 2243 |
| 87 | `removePromoItem` | function | 2255 |
| 88 | `setFaqDraft` | function | 2266 |
| 89 | `addFaqItem` | function | 2270 |
| 90 | `mergeFaqStarterItems` | function | 2281 |
| 91 | `addFaqStarterSet` | function | 2294 |
| 92 | `addAiFaqStarterSet` | function | 2298 |
| 93 | `updateFaqItem` | function | 2302 |
| 94 | `removeFaqItem` | function | 2308 |
| 95 | `clearAssistantState` | function | 2312 |
| 96 | `uploadDraftImage` | function | 2327 |
| 97 | `uploadAboutBlockMedia` | function | 2331 |
| 98 | `uploadPromoItemMedia` | function | 2337 |
| 99 | `openFilePicker` | function | 2341 |
| 100 | `handleFilePickerSelect` | function | 2345 |
| 101 | `savePortalDraft` | function | 2371 |
| 102 | `askAssistant` | function | 2563 |
| 103 | `refreshMembershipData` | function | 2608 |
| 104 | `handleMembershipLookup` | function | 2650 |
| 105 | `addSubmissionImages` | function | 2663 |
| 106 | `handleSubmissionPaste` | function | 2673 |
| 107 | `handleSubmitShareProof` | function | 2689 |
| 108 | `handleReviewSubmission` | function | 2736 |
| 109 | `renderCatalogSection` | function | 2899 |
| 110 | `handleUploadSubmissionImages` | const arrow | 2925 |
| 111 | `renderSecondaryTabPanel` | function | 2981 |
| 112 | `renderSecondaryTabSection` | function | 2993 |
| 113 | `scrollPublicPortal` | const arrow | 3134 |

### 3.155 `frontend/src/components/catalog/CatalogPageContext.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CatalogPageProvider` | export function | 5 |
| 2 | `useCatalogPageContext` | export function | 13 |

### 3.156 `frontend/src/components/catalog/CatalogPreviewSurface.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CatalogPreviewSurface` | export default function | 9 |
| 2 | `handlePortalTabClick` | const arrow | 47 |

### 3.157 `frontend/src/components/catalog/CatalogProductsSection.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBadgeIcon` | function | 10 |
| 2 | `getBadgeToneClass` | function | 18 |
| 3 | `getProductInitial` | function | 27 |
| 4 | `CatalogProductsSection` | export default function | 35 |

### 3.158 `frontend/src/components/catalog/CatalogSecondaryTabs.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizePortalColor` | function | 25 |
| 2 | `CatalogMembershipSection` | function | 30 |
| 3 | `CatalogAboutSection` | function | 376 |
| 4 | `CatalogFaqSection` | function | 590 |
| 5 | `CatalogAiSection` | function | 644 |
| 6 | `CatalogSecondaryTabs` | export default function | 830 |

### 3.159 `frontend/src/components/catalog/catalogUi.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `statusClass` | function | 3 |
| 2 | `SectionShell` | export function | 10 |
| 3 | `SummaryTile` | export function | 26 |
| 4 | `StatusPill` | export function | 50 |

### 3.160 `frontend/src/components/catalog/portalCatalogDisplay.mjs`

- No top-level named symbols detected.

### 3.161 `frontend/src/components/catalog/portalCatalogDisplay.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeRecommendedProductIds` | export function | 27 |
| 2 | `getPortalGridClass` | export function | 50 |
| 3 | `getPortalMobileGridClass` | export function | 63 |
| 4 | `productMatchesPortalBranches` | export function | 70 |
| 5 | `getPortalPromotionDetails` | export function | 78 |
| 6 | `buildPortalPricePresentation` | export function | 91 |
| 7 | `buildPortalHighlightBadges` | export function | 109 |
| 8 | `replaceRankVars` | function | 173 |
| 9 | `normalizeRankBadgeLabel` | function | 177 |

### 3.162 `frontend/src/components/catalog/portalContentI18n.mjs`

- No top-level named symbols detected.

### 3.163 `frontend/src/components/catalog/portalContentI18n.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isPlainObject` | function | 558 |
| 2 | `normalizeLanguageKey` | function | 562 |
| 3 | `normalizeText` | function | 571 |
| 4 | `normalizePortalTranslations` | export function | 575 |
| 5 | `stringifyPortalTranslations` | export function | 589 |
| 6 | `getLanguageBlock` | function | 595 |
| 7 | `pickTranslatedText` | function | 607 |
| 8 | `pickDefaultFirstPartyText` | function | 623 |
| 9 | `getCollectionEntry` | function | 630 |
| 10 | `localizeCollectionItems` | function | 647 |
| 11 | `getLanguageMap` | function | 665 |
| 12 | `escapeRegExp` | function | 674 |
| 13 | `protectPublicCopyTerms` | function | 678 |
| 14 | `restorePublicCopyTerms` | function | 692 |
| 15 | `localizePortalFaqText` | export function | 696 |
| 16 | `localizeFaqItems` | function | 722 |
| 17 | `localizePortalConfig` | export function | 737 |
| 18 | `getProductTranslationBlock` | function | 762 |

### 3.164 `frontend/src/components/catalog/portalEditorUtils.mjs`

- No top-level named symbols detected.

### 3.165 `frontend/src/components/catalog/portalEditorUtils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isPlainObject` | function | 47 |
| 2 | `toTrimmedString` | function | 51 |
| 3 | `createAboutBlock` | export function | 63 |
| 4 | `normalizeAboutBlocks` | export function | 75 |
| 5 | `serializeAboutBlocks` | export function | 95 |
| 6 | `createPromoItem` | export function | 99 |
| 7 | `normalizePromoItems` | export function | 113 |
| 8 | `serializePromoItems` | export function | 137 |
| 9 | `extractGoogleMapsEmbedUrl` | export function | 154 |
| 10 | `normalizeGoogleMapsEmbed` | export function | 162 |

### 3.166 `frontend/src/components/catalog/portalLanguagePacks.mjs`

- No top-level named symbols detected.

### 3.167 `frontend/src/components/catalog/portalLanguagePacks.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeFirstPartyPortalLanguage` | export function | 1334 |
| 2 | `isFirstPartyPortalLanguage` | export function | 1339 |
| 3 | `getPortalLanguageText` | export function | 1343 |

### 3.168 `frontend/src/components/catalog/portalTranslateController.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLanguage` | function | 16 |
| 2 | `canonicalTranslateLanguage` | export function | 20 |
| 3 | `normalizeTranslateTarget` | export function | 29 |
| 4 | `getPortalTranslateCookieTarget` | export function | 35 |
| 5 | `hasPortalTranslatedMarker` | export function | 49 |
| 6 | `clearGoogleTranslateCookies` | export function | 55 |
| 7 | `writePortalTranslateTarget` | export function | 73 |
| 8 | `storePortalTranslatePreference` | export function | 95 |
| 9 | `ensureLinkHint` | function | 108 |
| 10 | `warmPortalTranslateNetwork` | export function | 119 |
| 11 | `ensurePortalTranslateScript` | export function | 124 |
| 12 | `ensurePortalTranslateWidgetHost` | export function | 145 |
| 13 | `removePortalTranslateWidgetHost` | export function | 168 |
| 14 | `applyGoogleTranslateSelection` | export function | 173 |
| 15 | `isPortalTranslateApplied` | export function | 188 |
| 16 | `readStoredTranslateTarget` | export function | 197 |
| 17 | `requestPortalTranslateReload` | export function | 214 |

### 3.169 `frontend/src/components/contacts/ContactImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `countCsvDataRowsInWorker` | function | 33 |
| 2 | `cleanup` | const arrow | 45 |
| 3 | `ContactImportModal` | export default function | 65 |
| 4 | `signalDone` | const arrow | 80 |
| 5 | `loadCsvText` | const arrow | 93 |
| 6 | `handlePickFile` | const arrow | 114 |
| 7 | `handleChooseExistingFile` | const arrow | 120 |
| 8 | `handleDownloadTemplate` | const arrow | 137 |
| 9 | `applyContactRulePreset` | const arrow | 141 |
| 10 | `handleImport` | const arrow | 151 |

### 3.170 `frontend/src/components/contacts/contactImportParser.mjs`

- No top-level named symbols detected.

### 3.171 `frontend/src/components/contacts/contactImportParser.ts`

- No top-level named symbols detected.

### 3.172 `frontend/src/components/contacts/contactImportWorker.mjs`

- No top-level named symbols detected.

### 3.173 `frontend/src/components/contacts/contactImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.174 `frontend/src/components/contacts/contactOptionUtils.js`

- No top-level named symbols detected.

### 3.175 `frontend/src/components/contacts/contactOptionUtils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isPlainRecord` | function | 24 |
| 2 | `readStringField` | function | 28 |
| 3 | `createContactOption` | export function | 33 |
| 4 | `normalizeOption` | function | 45 |
| 5 | `parseStoredContactOptions` | export function | 61 |
| 6 | `hasContactOptionData` | export function | 82 |
| 7 | `serializeContactOptions` | export function | 93 |
| 8 | `buildContactOptionSummary` | export function | 100 |
| 9 | `parseContactOptionsFromImportRow` | export function | 110 |
| 10 | `getPrimaryContactOption` | export function | 126 |

### 3.176 `frontend/src/components/contacts/Contacts.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `TABS` | const arrow | 16 |
| 2 | `loadSuppliersTab` | const arrow | 23 |
| 3 | `loadDeliveryTab` | const arrow | 24 |
| 4 | `ContactTabFallback` | function | 28 |
| 5 | `ImportTypePicker` | function | 77 |
| 6 | `T` | const arrow | 78 |
| 7 | `Contacts` | export default function | 117 |
| 8 | `prefetchTab` | const arrow | 125 |
| 9 | `handleExportAll` | const arrow | 133 |
| 10 | `openImportPicker` | const arrow | 220 |
| 11 | `handleTypeSelected` | const arrow | 222 |
| 12 | `handleImportDone` | const arrow | 227 |

### 3.177 `frontend/src/components/contacts/CustomerFormModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `tr` | function | 11 |
| 2 | `parseContactOptions` | function | 16 |
| 3 | `OptionEditor` | function | 20 |
| 4 | `setField` | const arrow | 21 |
| 5 | `fieldId` | const arrow | 22 |
| 6 | `CustomerFormModal` | export default function | 65 |
| 7 | `setField` | const arrow | 77 |
| 8 | `addOption` | const arrow | 78 |
| 9 | `removeOption` | const arrow | 82 |
| 10 | `updateOption` | const arrow | 83 |
| 11 | `handleSubmit` | const arrow | 84 |

### 3.178 `frontend/src/components/contacts/customerMembershipNumber.js`

- No top-level named symbols detected.

### 3.179 `frontend/src/components/contacts/customerMembershipNumber.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `generateCustomerMembershipNumber` | export function | 4 |

### 3.180 `frontend/src/components/contacts/CustomersTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseContactOptions` | export function | 30 |
| 2 | `serializeContactOptions` | export function | 34 |
| 3 | `tr` | function | 38 |
| 4 | `CustomersTab` | function | 47 |
| 5 | `toggleSectionCollapsed` | const arrow | 210 |
| 6 | `isSectionFullySelected` | const arrow | 216 |
| 7 | `isSectionPartiallySelected` | const arrow | 217 |
| 8 | `toggleSectionSelection` | const arrow | 218 |
| 9 | `promise` | const arrow | 245 |
| 10 | `handleSave` | const arrow | 331 |
| 11 | `handleDelete` | const arrow | 408 |
| 12 | `handleBulkDelete` | const arrow | 447 |

### 3.181 `frontend/src/components/contacts/DeliveryTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseDeliveryOptions` | export function | 38 |
| 2 | `serializeDeliveryOptions` | export function | 42 |
| 3 | `BLANK_OPTION` | const arrow | 46 |
| 4 | `OptionEditor` | function | 49 |
| 5 | `set` | const arrow | 50 |
| 6 | `fieldId` | const arrow | 51 |
| 7 | `DeliveryForm` | function | 89 |
| 8 | `set` | const arrow | 98 |
| 9 | `addOption` | const arrow | 99 |
| 10 | `updateOption` | const arrow | 103 |
| 11 | `removeOption` | const arrow | 104 |
| 12 | `handleSave` | const arrow | 105 |
| 13 | `OptionsDisplay` | function | 175 |
| 14 | `OptionsBadge` | function | 192 |
| 15 | `DeliveryTab` | function | 203 |
| 16 | `toggleSectionCollapsed` | const arrow | 335 |
| 17 | `isSectionFullySelected` | const arrow | 341 |
| 18 | `isSectionPartiallySelected` | const arrow | 342 |
| 19 | `toggleSectionSelection` | const arrow | 343 |
| 20 | `promise` | const arrow | 368 |
| 21 | `handleSave` | const arrow | 430 |
| 22 | `handleDelete` | const arrow | 492 |
| 23 | `handleBulkDelete` | const arrow | 529 |

### 3.182 `frontend/src/components/contacts/shared.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `useContactSelection` | export function | 14 |
| 2 | `toggleOne` | const arrow | 30 |
| 3 | `clearSelection` | const arrow | 41 |
| 4 | `ThreeDotMenu` | export function | 68 |
| 5 | `menuContent` | const arrow | 77 |
| 6 | `DetailModal` | export function | 140 |
| 7 | `ContactTable` | export function | 171 |

### 3.183 `frontend/src/components/contacts/SuppliersTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `SupplierForm` | function | 34 |
| 2 | `set` | const arrow | 50 |
| 3 | `addOption` | const arrow | 51 |
| 4 | `updateOption` | const arrow | 55 |
| 5 | `removeOption` | const arrow | 56 |
| 6 | `handleSubmit` | const arrow | 57 |
| 7 | `fieldId` | const arrow | 105 |
| 8 | `SuppliersTab` | function | 151 |
| 9 | `toggleSectionCollapsed` | const arrow | 295 |
| 10 | `isSectionFullySelected` | const arrow | 301 |
| 11 | `isSectionPartiallySelected` | const arrow | 302 |
| 12 | `toggleSectionSelection` | const arrow | 303 |
| 13 | `promise` | const arrow | 330 |
| 14 | `handleSave` | const arrow | 393 |
| 15 | `handleDelete` | const arrow | 463 |
| 16 | `handleBulkDelete` | const arrow | 502 |

### 3.184 `frontend/src/components/custom-tables/CustomTables.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeRowValue` | function | 19 |
| 2 | `buildRowPayload` | function | 32 |
| 3 | `CustomTables` | export default function | 41 |
| 4 | `addColumn` | const arrow | 151 |
| 5 | `updateColumn` | const arrow | 158 |
| 6 | `removeColumn` | const arrow | 167 |
| 7 | `handleCreateTable` | const arrow | 174 |
| 8 | `handleSaveRow` | const arrow | 220 |
| 9 | `handleDeleteRow` | const arrow | 317 |
| 10 | `openAddRow` | const arrow | 369 |
| 11 | `openEditRow` | const arrow | 376 |

### 3.185 `frontend/src/components/dashboard/charts/BarChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `chartLabelsNeedYear` | function | 14 |
| 2 | `formatAxisLabel` | function | 23 |
| 3 | `BarChart` | export default function | 36 |
| 4 | `updateWidth` | const arrow | 44 |
| 5 | `yPx` | function | 79 |

### 3.186 `frontend/src/components/dashboard/charts/DonutChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `DonutChart` | export default function | 14 |

### 3.187 `frontend/src/components/dashboard/charts/index.js`

- No top-level named symbols detected.

### 3.188 `frontend/src/components/dashboard/charts/index.ts`

- No top-level named symbols detected.

### 3.189 `frontend/src/components/dashboard/charts/LineChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `chartLabelsNeedYear` | function | 13 |
| 2 | `formatAxisLabel` | function | 22 |
| 3 | `LineChart` | export default function | 35 |
| 4 | `updateWidth` | const arrow | 43 |
| 5 | `xPx` | function | 83 |
| 6 | `yPx` | function | 84 |
| 7 | `handleMouseMove` | const arrow | 92 |

### 3.190 `frontend/src/components/dashboard/charts/NoData.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NoData` | export default function | 7 |

### 3.191 `frontend/src/components/dashboard/Dashboard.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDashboardFilterStorageKey` | function | 65 |
| 2 | `readDashboardFilterPrefs` | function | 70 |
| 3 | `downsampleChartRows` | function | 94 |
| 4 | `normalizeDashboardRangeId` | function | 105 |
| 5 | `compactDashboardMetaParts` | function | 111 |
| 6 | `formatDashboardHourLabel` | function | 117 |
| 7 | `getSaleStatusTone` | function | 124 |
| 8 | `isDashboardSummaryPayload` | function | 131 |
| 9 | `isDashboardAnalyticsPayload` | function | 142 |
| 10 | `normalizeDashboardSummaryPayload` | function | 154 |
| 11 | `normalizeDashboardAnalyticsPayload` | function | 166 |
| 12 | `Dashboard` | export default function | 185 |
| 13 | `translateOr` | const arrow | 190 |
| 14 | `calcTrend` | const arrow | 420 |
| 15 | `rangeLabel` | const arrow | 464 |
| 16 | `periodShort` | const arrow | 470 |
| 17 | `buildExportAll` | const arrow | 857 |

### 3.192 `frontend/src/components/dashboard/MiniStat.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `MiniStat` | export default function | 2 |

### 3.193 `frontend/src/components/files/FilePickerModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `AssetPreview` | function | 16 |
| 2 | `FilePickerModal` | export default function | 39 |
| 3 | `tr` | const arrow | 61 |
| 4 | `toggleSelectedPath` | function | 102 |
| 5 | `handleUpload` | function | 112 |
| 6 | `handleDelete` | function | 154 |

### 3.194 `frontend/src/components/files/FilesPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadFilesProvidersTab` | const arrow | 29 |
| 2 | `loadFilesResponsesTab` | const arrow | 30 |
| 3 | `AssetPreview` | function | 42 |
| 4 | `AssetCardSkeleton` | function | 65 |
| 5 | `formatDateTime` | function | 91 |
| 6 | `formatFileSize` | function | 101 |
| 7 | `emptyProviderForm` | function | 109 |
| 8 | `compactTabLabel` | function | 132 |
| 9 | `getDefaultFilesPageSize` | function | 138 |
| 10 | `downloadAssetFile` | function | 143 |
| 11 | `FilesPage` | export default function | 155 |
| 12 | `tr` | const arrow | 195 |
| 13 | `handleUpload` | function | 431 |
| 14 | `handleDeleteAsset` | function | 454 |
| 15 | `toggleAssetSelection` | function | 482 |
| 16 | `toggleSelectAllAssets` | function | 493 |
| 17 | `handleCopySelectedPaths` | function | 500 |
| 18 | `handleDownloadSelected` | function | 515 |
| 19 | `handleDeleteSelectedAssets` | function | 523 |
| 20 | `startCreateProvider` | function | 569 |
| 21 | `startEditProvider` | function | 585 |
| 22 | `saveProvider` | function | 610 |
| 23 | `testProvider` | function | 694 |
| 24 | `removeProvider` | function | 715 |
| 25 | `tabButton` | const arrow | 736 |

### 3.195 `frontend/src/components/files/FilesProvidersTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProviderStatus` | function | 10 |
| 2 | `FilesProvidersTab` | export default function | 21 |

### 3.196 `frontend/src/components/files/FilesResponsesTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `FilesResponsesTab` | export default function | 11 |

### 3.197 `frontend/src/components/inventory/DualMoney.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `DualMoney` | function | 5 |

### 3.198 `frontend/src/components/inventory/Inventory.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `reuseSetWhenUnchanged` | function | 52 |
| 2 | `limitInventorySectionsForMobile` | function | 63 |
| 3 | `priceCsv` | function | 90 |
| 4 | `parseInventoryTimestamp` | function | 94 |
| 5 | `InventoryDiscountBadge` | function | 108 |
| 6 | `InventoryBatchPreview` | function | 119 |
| 7 | `label` | const arrow | 121 |
| 8 | `loadInventoryExportTools` | function | 176 |
| 9 | `Inventory` | export default function | 191 |
| 10 | `promise` | const arrow | 411 |
| 11 | `handleAdjust` | const arrow | 763 |
| 12 | `openAdjust` | const arrow | 841 |
| 13 | `openMove` | const arrow | 848 |
| 14 | `openTransfer` | const arrow | 871 |
| 15 | `handleMoveStock` | const arrow | 928 |
| 16 | `handleTransferStock` | const arrow | 1001 |
| 17 | `matchesSearch` | const arrow | 1088 |
| 18 | `productHay` | const arrow | 1095 |
| 19 | `movHay` | const arrow | 1098 |
| 20 | `syncViewport` | const arrow | 1146 |
| 21 | `statsValue` | const arrow | 1743 |
| 22 | `selectInventorySection` | const arrow | 2964 |

### 3.199 `frontend/src/components/inventory/InventoryImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `countInventoryCsvRowsInWorker` | function | 18 |
| 2 | `cleanup` | const arrow | 30 |
| 3 | `InventoryImportModal` | export default function | 50 |
| 4 | `tr` | const arrow | 63 |
| 5 | `signalDone` | const arrow | 69 |
| 6 | `analyzeCsvText` | const arrow | 80 |
| 7 | `setInventoryCsvText` | const arrow | 96 |
| 8 | `handlePickFile` | const arrow | 104 |
| 9 | `handleDownloadTemplate` | const arrow | 110 |
| 10 | `handleImport` | const arrow | 114 |

### 3.200 `frontend/src/components/inventory/inventoryImportWorker.mjs`

- No top-level named symbols detected.

### 3.201 `frontend/src/components/inventory/inventoryImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.202 `frontend/src/components/inventory/InventoryMovementsSurface.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `InventoryMovementsSurface` | export default function | 6 |

### 3.203 `frontend/src/components/inventory/InventoryProductsSurface.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `InventoryProductsSurface` | export default function | 6 |
| 2 | `renderDesktopTableHead` | const arrow | 45 |
| 3 | `renderDesktopLoadingShell` | const arrow | 67 |

### 3.204 `frontend/src/components/inventory/InventoryRfidSurface.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `InventoryRfidSurface` | export default function | 1 |

### 3.205 `frontend/src/components/inventory/movementGroups.js`

- No top-level named symbols detected.

### 3.206 `frontend/src/components/inventory/movementGroups.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isMovementRecord` | function | 40 |
| 2 | `normalizeMovementTimeValue` | function | 44 |
| 3 | `minuteBucket` | function | 57 |
| 4 | `normalizeText` | function | 65 |
| 5 | `canonicalMovementType` | function | 72 |
| 6 | `buildGroupKey` | function | 78 |
| 7 | `describeMovementType` | function | 94 |
| 8 | `movementSign` | function | 105 |
| 9 | `movementSignedValue` | function | 111 |
| 10 | `movementAbsoluteValue` | function | 117 |
| 11 | `parseMovementTime` | function | 123 |
| 12 | `normalizeMovementTimestamp` | export function | 130 |
| 13 | `buildMovementGroups` | export function | 145 |
| 14 | `getMovementGroupPage` | export function | 257 |
| 15 | `movementGroupHaystack` | export function | 273 |

### 3.207 `frontend/src/components/inventory/ProductDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductDetailModal` | export default function | 6 |
| 2 | `T` | const arrow | 7 |

### 3.208 `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sanitizeInteger` | function | 121 |
| 2 | `sanitizeKhr` | function | 126 |
| 3 | `formatLookupValue` | function | 132 |
| 4 | `LoyaltyPointsPage` | export default function | 136 |
| 5 | `copy` | const arrow | 140 |
| 6 | `showLoyaltySection` | const arrow | 161 |
| 7 | `setValue` | function | 231 |
| 8 | `handleSave` | function | 235 |
| 9 | `handleLookup` | function | 259 |

### 3.209 `frontend/src/components/navigation/Sidebar.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getFallbackLabel` | function | 49 |
| 2 | `getNavLabel` | function | 57 |
| 3 | `isDarkColor` | function | 73 |
| 4 | `withAlpha` | function | 83 |
| 5 | `mergeStyles` | function | 89 |
| 6 | `Sidebar` | export default function | 93 |

### 3.210 `frontend/src/components/pos/CartItem.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CartItem` | export default function | 4 |

### 3.211 `frontend/src/components/pos/FilterPanel.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `POSFilterPanel` | export default function | 3 |
| 2 | `T` | const arrow | 25 |
| 3 | `clearAll` | const arrow | 36 |
| 4 | `chip` | const arrow | 45 |
| 5 | `SectionLabel` | const arrow | 51 |

### 3.212 `frontend/src/components/pos/POS.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `allTermsMatch` | function | 70 |
| 2 | `useDebouncedValue` | function | 75 |
| 3 | `ProductDiscountBadge` | function | 84 |
| 4 | `POS` | export default function | 94 |
| 5 | `addNewOrder` | const arrow | 189 |
| 6 | `closeOrder` | const arrow | 201 |
| 7 | `selectCustomer` | const arrow | 517 |
| 8 | `applyCustomerOption` | const arrow | 565 |
| 9 | `clearCustomer` | const arrow | 579 |
| 10 | `handleAddCustomer` | const arrow | 587 |
| 11 | `selectDelivery` | const arrow | 624 |
| 12 | `clearDelivery` | const arrow | 629 |
| 13 | `handleAddDelivery` | const arrow | 631 |
| 14 | `qty` | const arrow | 731 |
| 15 | `addToCart` | function | 894 |
| 16 | `updateQty` | const arrow | 933 |
| 17 | `updatePrice` | const arrow | 941 |
| 18 | `updateItemBranch` | const arrow | 965 |
| 19 | `handleDiscountUsd` | const arrow | 1014 |
| 20 | `handleDiscountKhr` | const arrow | 1015 |
| 21 | `handleMembershipUnits` | const arrow | 1016 |
| 22 | `handleCheckout` | const arrow | 1055 |

### 3.213 `frontend/src/components/pos/posCore.mjs`

- No top-level named symbols detected.

### 3.214 `frontend/src/components/pos/posCore.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeNumber` | function | 41 |
| 2 | `buildProductsById` | export function | 45 |
| 3 | `buildVariantChildrenByParentId` | export function | 49 |
| 4 | `getVariantRootProduct` | export function | 61 |
| 5 | `buildVisibleProductCards` | export function | 68 |
| 6 | `getVariantChoices` | export function | 81 |
| 7 | `resolveCartPriceValues` | export function | 89 |
| 8 | `getCartLineId` | export function | 129 |
| 9 | `findMatchingCartLineIndex` | export function | 136 |

### 3.215 `frontend/src/components/pos/ProductImage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductImage` | export default function | 3 |

### 3.216 `frontend/src/components/pos/QuickAddModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `QuickAddModal` | export default function | 4 |
| 2 | `T` | const arrow | 5 |

### 3.217 `frontend/src/components/products/config/productPageConfig.mjs`

- No top-level named symbols detected.

### 3.218 `frontend/src/components/products/config/productPageConfig.ts`

- No top-level named symbols detected.

### 3.219 `frontend/src/components/products/forms/BranchStockAdjuster.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BranchStockAdjuster` | export default function | 7 |
| 2 | `T` | const arrow | 28 |
| 3 | `setRow` | const arrow | 34 |
| 4 | `handleSave` | const arrow | 40 |

### 3.220 `frontend/src/components/products/forms/BulkAddStockModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BulkAddStockModal` | function | 9 |
| 2 | `handleSave` | const arrow | 20 |

### 3.221 `frontend/src/components/products/forms/ProductForm.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeGallery` | function | 20 |
| 2 | `editablePrice` | function | 36 |
| 3 | `pickImageFiles` | function | 41 |
| 4 | `ProductForm` | export default function | 60 |
| 5 | `tr` | const arrow | 147 |
| 6 | `loadSuppliers` | function | 192 |
| 7 | `setField` | function | 211 |
| 8 | `setNumericField` | function | 215 |
| 9 | `addImages` | function | 219 |
| 10 | `addPhoto` | function | 224 |
| 11 | `uploadPickedImages` | function | 229 |
| 12 | `removeImage` | function | 274 |
| 13 | `setPrimaryImage` | function | 278 |
| 14 | `saveForm` | function | 288 |
| 15 | `openScanner` | function | 339 |
| 16 | `closeScanner` | function | 344 |
| 17 | `applyScannedValue` | function | 348 |

### 3.222 `frontend/src/components/products/forms/VariantFormModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `VariantFormModal` | export default function | 12 |
| 2 | `tr` | const arrow | 14 |
| 3 | `setField` | const arrow | 41 |
| 4 | `setNumeric` | const arrow | 42 |
| 5 | `handleSave` | const arrow | 47 |

### 3.223 `frontend/src/components/products/helpers/productDisplayHelpers.mjs`

- No top-level named symbols detected.

### 3.224 `frontend/src/components/products/helpers/productDisplayHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toNumber` | function | 57 |
| 2 | `buildBranchNameByIdMap` | export function | 72 |
| 3 | `buildProductBrandOptions` | export function | 76 |
| 4 | `buildProductBranchSummaryLabel` | export function | 90 |
| 5 | `getProductStockStatus` | export function | 101 |
| 6 | `buildProductRowDisplayState` | export function | 111 |

### 3.225 `frontend/src/components/products/helpers/productFilterHelpers.mjs`

- No top-level named symbols detected.

### 3.226 `frontend/src/components/products/helpers/productFilterHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toNumber` | function | 66 |
| 2 | `getImageGallery` | function | 71 |
| 3 | `buildProductSearchTerms` | export function | 75 |
| 4 | `getProductBranchQuantity` | export function | 81 |
| 5 | `filterProductsForPage` | export function | 86 |
| 6 | `buildProductExportRows` | export function | 151 |
| 7 | `toImageName` | const arrow | 152 |
| 8 | `toImageUrl` | const arrow | 153 |
| 9 | `priceCsv` | const arrow | 154 |

### 3.227 `frontend/src/components/products/helpers/productGalleryHelpers.mjs`

- No top-level named symbols detected.

### 3.228 `frontend/src/components/products/helpers/productGalleryHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeProductGallery` | export function | 27 |
| 2 | `getProductGalleryImages` | export function | 47 |
| 3 | `buildProductThumbnailState` | export function | 51 |
| 4 | `resolveProductImageUrl` | export function | 60 |
| 5 | `clampProductLightboxIndex` | export function | 66 |
| 6 | `buildProductLightboxState` | export function | 74 |
| 7 | `buildProductLightboxGalleryInput` | export function | 85 |
| 8 | `updateProductLightboxIndex` | export function | 91 |

### 3.229 `frontend/src/components/products/helpers/productGroupViewHelpers.mjs`

- No top-level named symbols detected.

### 3.230 `frontend/src/components/products/helpers/productGroupViewHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildProductGroupPriceLabel` | export function | 22 |
| 2 | `buildProductGroupSummaryParts` | export function | 32 |

### 3.231 `frontend/src/components/products/helpers/productMenuHelpers.mjs`

- No top-level named symbols detected.

### 3.232 `frontend/src/components/products/helpers/productMenuHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `asString` | function | 85 |
| 2 | `buildProductExportItems` | export function | 89 |
| 3 | `buildProductSupplierOptions` | export function | 117 |
| 4 | `countActiveProductFilters` | export function | 121 |
| 5 | `buildProductFilterSections` | export function | 147 |

### 3.233 `frontend/src/components/products/helpers/productPageHelpers.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `useDebouncedValue` | export function | 3 |
| 2 | `parseBrandColorMap` | export function | 12 |
| 3 | `normalizeBrandLookup` | export function | 22 |
| 4 | `waitForNextFrame` | export function | 26 |

### 3.234 `frontend/src/components/products/helpers/productSelectionHelpers.mjs`

- No top-level named symbols detected.

### 3.235 `frontend/src/components/products/helpers/productSelectionHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildVisibleProductIds` | export function | 39 |
| 2 | `buildParentProductIdSet` | export function | 53 |
| 3 | `buildSelectedVisibleIds` | export function | 61 |
| 4 | `buildProductPaginationState` | export function | 66 |
| 5 | `buildJumpTargetIdsByLetter` | export function | 98 |
| 6 | `isSelectionScopeFullySelected` | export function | 115 |
| 7 | `isSelectionScopePartiallySelected` | export function | 119 |

### 3.236 `frontend/src/components/products/helpers/productWriteHelpers.mjs`

- No top-level named symbols detected.

### 3.237 `frontend/src/components/products/helpers/productWriteHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toFiniteNumber` | function | 123 |
| 2 | `hasBulkFormValue` | function | 128 |
| 3 | `stringOrEmpty` | function | 132 |
| 4 | `buildProductWritePayload` | export function | 136 |
| 5 | `buildProductBranchStockAdjustments` | export function | 168 |
| 6 | `buildProductClearStockAdjustments` | export function | 198 |
| 7 | `buildProductStockAdjustmentPayload` | export function | 216 |
| 8 | `buildProductBranchMovePlan` | export function | 233 |
| 9 | `buildProductTransferStockPayload` | export function | 261 |
| 10 | `summarizeProductBulkRun` | export function | 274 |
| 11 | `buildDefinedProductUpdates` | export function | 289 |
| 12 | `buildProductBulkUpdatePayload` | export function | 295 |
| 13 | `buildProductBulkInfoUpdates` | export function | 311 |
| 14 | `buildProductBulkPricingUpdates` | export function | 324 |
| 15 | `getDefaultProductRestoreBranchId` | export function | 339 |
| 16 | `buildDeletedProductIdSet` | export function | 345 |
| 17 | `getPreferredProductRestoreBranchId` | export function | 353 |
| 18 | `resolveRestoredProductParentId` | export function | 361 |

### 3.238 `frontend/src/components/products/history/productHistoryHelpers.mjs`

- No top-level named symbols detected.

### 3.239 `frontend/src/components/products/history/productHistoryHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createProductHistoryRequestId` | export function | 43 |

### 3.240 `frontend/src/components/products/import/BulkImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBaseName` | function | 61 |
| 2 | `analyzeProductCsvInWorker` | function | 68 |
| 3 | `runFallbackAnalysis` | const arrow | 69 |
| 4 | `cleanup` | const arrow | 81 |
| 5 | `complete` | const arrow | 89 |
| 6 | `runFallback` | const arrow | 95 |
| 7 | `getIncomingImageFilenames` | function | 138 |
| 8 | `getExistingImageFilenames` | function | 171 |
| 9 | `csvEscape` | function | 200 |
| 10 | `compactImportValue` | function | 230 |
| 11 | `isBlankImportValue` | function | 235 |
| 12 | `hasPriceReviewIssue` | function | 239 |
| 13 | `getProductImportIssueLabel` | function | 244 |
| 14 | `getProductImportIssueHint` | function | 253 |
| 15 | `getProductImportRowIssueDetails` | function | 261 |
| 16 | `valuesDiffer` | function | 316 |
| 17 | `normalizeImageMatchKey` | function | 320 |
| 18 | `getImageReference` | function | 332 |
| 19 | `findImageReferenceForRow` | function | 340 |
| 20 | `getDecisionLabel` | function | 350 |
| 21 | `getFamilyKeyForRow` | function | 354 |
| 22 | `summarizeRowNumbers` | function | 358 |
| 23 | `summarizeSubgroup` | function | 365 |
| 24 | `getImportActionTargetSummary` | function | 370 |
| 25 | `createFamilyContextEntry` | function | 403 |
| 26 | `buildVisibleFamilyRows` | function | 424 |
| 27 | `InlineImportDetailGrid` | function | 439 |
| 28 | `buildImageOnlyCsv` | function | 470 |
| 29 | `getBrowserImageEntries` | function | 488 |
| 30 | `BulkImportModal` | export default function | 497 |
| 31 | `T` | const arrow | 531 |
| 32 | `signalDone` | const arrow | 532 |
| 33 | `throwIfImportCancelled` | const arrow | 538 |
| 34 | `isCancelledStartError` | const arrow | 545 |
| 35 | `beginImportAction` | const arrow | 547 |
| 36 | `finishImportAction` | const arrow | 553 |
| 37 | `setCancelledResult` | const arrow | 558 |
| 38 | `createReviewSnapshot` | const arrow | 585 |
| 39 | `pushReviewUndoSnapshot` | const arrow | 595 |
| 40 | `undoLastReviewChange` | const arrow | 599 |
| 41 | `beginInlineEdit` | const arrow | 614 |
| 42 | `resetCsvState` | const arrow | 627 |
| 43 | `pickImageDirectory` | const arrow | 655 |
| 44 | `pickImageZip` | const arrow | 679 |
| 45 | `addLibraryImages` | const arrow | 692 |
| 46 | `buildCsvForImportJob` | const arrow | 708 |
| 47 | `ensureServerPreflightReady` | const arrow | 741 |
| 48 | `handleCancelCurrentJob` | const arrow | 775 |
| 49 | `handleRetryCurrentJob` | const arrow | 796 |
| 50 | `handleDeleteCurrentJob` | const arrow | 820 |
| 51 | `handleImageOnlyImport` | const arrow | 847 |
| 52 | `handlePickCSV` | const arrow | 939 |
| 53 | `handleImport` | const arrow | 1003 |
| 54 | `toggleFamilyCollapse` | const arrow | 1232 |
| 55 | `toggleInlineDetails` | const arrow | 1241 |
| 56 | `toggleConflictSelection` | const arrow | 1250 |
| 57 | `toggleSelectAllConflicts` | const arrow | 1259 |
| 58 | `applyDecisionToSelection` | const arrow | 1267 |
| 59 | `applyImageDecisionToSelection` | const arrow | 1277 |
| 60 | `applyIdentifierDecisionToSelection` | const arrow | 1294 |
| 61 | `applyFieldRulePreset` | const arrow | 1306 |
| 62 | `renderConflictRow` | const arrow | 1319 |
| 63 | `updateEditedRow` | const arrow | 1327 |

### 3.241 `frontend/src/components/products/import/productImportPlanner.mjs`

- No top-level named symbols detected.

### 3.242 `frontend/src/components/products/import/productImportPlanner.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeText` | function | 142 |
| 2 | `normalizeImportProductName` | export function | 146 |
| 3 | `normalizeComparableText` | function | 150 |
| 4 | `isBlockingProductImportIssue` | export function | 161 |
| 5 | `getProductImportBarcodeIssue` | export function | 165 |
| 6 | `hasSuspiciousEncodingCorruption` | function | 176 |
| 7 | `getCorruptedTextFields` | function | 185 |
| 8 | `getBlockingIssueMessage` | function | 189 |
| 9 | `normalizeFlag` | function | 201 |
| 10 | `normalizeProductImportRow` | export function | 209 |
| 11 | `normalizeProductForSignature` | function | 249 |
| 12 | `getProductImportDetailSignature` | export function | 274 |
| 13 | `chooseParentProduct` | function | 286 |
| 14 | `buildExistingIndex` | function | 302 |
| 15 | `buildImportedIdentifierIndex` | function | 320 |
| 16 | `buildProductImportReviewGroups` | function | 336 |
| 17 | `analyzeProductImportRows` | export function | 457 |
| 18 | `analyzeProductImportText` | export function | 631 |

### 3.243 `frontend/src/components/products/import/productImportWorker.mjs`

- No top-level named symbols detected.

### 3.244 `frontend/src/components/products/import/productImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `post` | function | 39 |
| 2 | `waitForNextTask` | function | 43 |
| 3 | `getErrorMessage` | function | 49 |

### 3.245 `frontend/src/components/products/lookups/ManageBrandsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseBrandOptions` | function | 40 |
| 2 | `parseBrandColorMap` | function | 53 |
| 3 | `toTitleCase` | function | 63 |
| 4 | `getBrandReviewRule` | function | 71 |
| 5 | `getBrandSortScore` | function | 75 |
| 6 | `buildSavedLibrary` | function | 81 |
| 7 | `ManageBrandsModal` | export default function | 99 |
| 8 | `saveLibrary` | const arrow | 198 |
| 9 | `restoreProductFieldSnapshots` | const arrow | 207 |
| 10 | `addLibraryBrand` | const arrow | 221 |
| 11 | `renameBrand` | const arrow | 273 |
| 12 | `removeBrands` | const arrow | 353 |
| 13 | `removeBrand` | const arrow | 432 |
| 14 | `applySuggestedNormalization` | const arrow | 434 |
| 15 | `toggleSelectedBrand` | const arrow | 440 |
| 16 | `toggleAllVisibleBrands` | const arrow | 449 |

### 3.246 `frontend/src/components/products/lookups/ManageCategoriesModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `mergeCategoryUsage` | function | 24 |
| 2 | `ManageCategoriesModal` | export default function | 53 |
| 3 | `handleAdd` | const arrow | 144 |
| 4 | `handleUpdate` | const arrow | 180 |
| 5 | `handleDelete` | const arrow | 235 |
| 6 | `toggleSelected` | const arrow | 283 |
| 7 | `toggleAllVisible` | const arrow | 293 |
| 8 | `handleDeleteSelected` | const arrow | 306 |

### 3.247 `frontend/src/components/products/lookups/ManageUnitsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `mergeUnitUsage` | function | 24 |
| 2 | `ManageUnitsModal` | export default function | 53 |
| 3 | `handleAdd` | const arrow | 144 |
| 4 | `handleUpdate` | const arrow | 180 |
| 5 | `handleDelete` | const arrow | 229 |
| 6 | `toggleSelected` | const arrow | 277 |
| 7 | `toggleAllVisible` | const arrow | 287 |
| 8 | `handleDeleteSelected` | const arrow | 300 |

### 3.248 `frontend/src/components/products/lookups/productLookupSnapshots.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLookup` | export function | 6 |
| 2 | `normalizeProductRows` | function | 10 |
| 3 | `snapshotLookupProducts` | function | 16 |
| 4 | `mergeUniqueSnapshots` | function | 30 |
| 5 | `fetchLookupProductSnapshots` | export function | 39 |
| 6 | `fetchProductsByIds` | function | 75 |
| 7 | `restoreLookupProductSnapshots` | export function | 94 |

### 3.249 `frontend/src/components/products/Products.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Products` | export default function | 129 |
| 2 | `promise` | const arrow | 212 |
| 3 | `handleSave` | const arrow | 383 |
| 4 | `uploadGalleryImages` | const arrow | 407 |
| 5 | `handleSaveWithGallery` | const arrow | 433 |
| 6 | `handleBulkDelete` | const arrow | 499 |
| 7 | `handleBulkOutOfStock` | const arrow | 546 |
| 8 | `handleBulkChangeBranch` | const arrow | 589 |
| 9 | `handleBulkAddStock` | const arrow | 619 |
| 10 | `toggleSelect` | const arrow | 627 |
| 11 | `toggleSelectAll` | const arrow | 634 |
| 12 | `handleDelete` | const arrow | 641 |
| 13 | `renderUnitChip` | const arrow | 720 |
| 14 | `openLightbox` | const arrow | 734 |
| 15 | `getStockBadge` | const arrow | 741 |

### 3.250 `frontend/src/components/products/scanning/barcodeImageScanner.mjs`

- No top-level named symbols detected.

### 3.251 `frontend/src/components/products/scanning/barcodeImageScanner.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readFileAsDataUrl` | function | 37 |
| 2 | `createImageElement` | function | 62 |
| 3 | `loadImageSource` | function | 66 |
| 4 | `detectWithNativeBarcodeDetector` | function | 75 |
| 5 | `scanBarcodeFromImageFile` | export function | 101 |

### 3.252 `frontend/src/components/products/scanning/BarcodeScannerModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `stopStream` | function | 24 |
| 2 | `readCameraPermissionState` | function | 30 |
| 3 | `watchCameraPermission` | function | 40 |
| 4 | `handleChange` | const arrow | 44 |
| 5 | `BarcodeScannerModal` | export default function | 53 |

### 3.253 `frontend/src/components/products/scanning/barcodeScannerState.mjs`

- No top-level named symbols detected.

### 3.254 `frontend/src/components/products/scanning/barcodeScannerState.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `deriveScannerPresentation` | export function | 31 |

### 3.255 `frontend/src/components/products/scanning/scanbotScanner.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `publicBasePath` | const arrow | 1 |
| 2 | `getScanbotGlobal` | function | 13 |
| 3 | `isCameraBlockedByDocumentPolicy` | export function | 17 |
| 4 | `normalizeScanbotError` | function | 27 |
| 5 | `loadScanbotScript` | function | 41 |
| 6 | `readCameraPermissionState` | function | 69 |
| 7 | `getPreferredScannerMode` | export function | 79 |
| 8 | `getInitializedScanbot` | function | 103 |
| 9 | `scanBarcodeWithScanbot` | export function | 117 |

### 3.256 `frontend/src/components/products/shared/primitives.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isRecentlyBrokenProductImage` | function | 11 |
| 2 | `markBrokenProductImage` | function | 19 |
| 3 | `sanitizeNumericInput` | function | 24 |
| 4 | `parseNumericInput` | function | 34 |
| 5 | `ProductImg` | function | 40 |
| 6 | `loadImageData` | function | 82 |
| 7 | `ProductImagePlaceholder` | function | 126 |
| 8 | `MarginCard` | function | 134 |
| 9 | `DualPriceInput` | function | 166 |
| 10 | `handleUsdChange` | const arrow | 167 |
| 11 | `handleKhrChange` | const arrow | 168 |

### 3.257 `frontend/src/components/products/surfaces/HeaderActions.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductsHeaderActions` | export default function | 5 |
| 2 | `cleanFallback` | const arrow | 16 |
| 3 | `tr` | const arrow | 22 |

### 3.258 `frontend/src/components/products/surfaces/ProductDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductDetailModal` | export default function | 7 |
| 2 | `T` | const arrow | 23 |
| 3 | `Row` | const arrow | 43 |

### 3.259 `frontend/src/components/products/surfaces/ProductRowParts.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductDiscountBadge` | export function | 5 |
| 2 | `ProductRowActions` | export function | 19 |
| 3 | `label` | const arrow | 20 |
| 4 | `ProductBatchPreview` | export function | 42 |
| 5 | `ProductDetailsCell` | export function | 65 |

### 3.260 `frontend/src/components/products/surfaces/ProductsListSurface.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductsListSurface` | export default function | 4 |
| 2 | `renderDesktopTableHead` | const arrow | 47 |
| 3 | `renderDesktopLoadingShell` | const arrow | 76 |

### 3.261 `frontend/src/components/receipt-settings/AllFieldsPanel.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Toggle` | function | 5 |
| 2 | `AllFieldsPanel` | export default function | 21 |
| 3 | `T` | const arrow | 23 |
| 4 | `toggleSection` | const arrow | 42 |

### 3.262 `frontend/src/components/receipt-settings/constants.js`

- No top-level named symbols detected.

### 3.263 `frontend/src/components/receipt-settings/constants.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getFieldItems` | export function | 109 |
| 2 | `T` | const arrow | 110 |

### 3.264 `frontend/src/components/receipt-settings/ErrorBoundary.jsx`

- No top-level named symbols detected.

### 3.265 `frontend/src/components/receipt-settings/FieldOrderManager.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSectionOrderItems` | function | 4 |
| 2 | `buildList` | function | 23 |
| 3 | `toKeys` | function | 48 |
| 4 | `FieldOrderManager` | export default function | 52 |
| 5 | `moveItem` | const arrow | 66 |
| 6 | `addDivider` | const arrow | 74 |
| 7 | `removeDivider` | const arrow | 85 |
| 8 | `handleDragStart` | const arrow | 91 |
| 9 | `handleDragOver` | const arrow | 96 |

### 3.266 `frontend/src/components/receipt-settings/PrintSettings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Section` | function | 5 |
| 2 | `buildFallbackPreviewHtml` | function | 17 |
| 3 | `buildSafePreviewSource` | function | 35 |
| 4 | `PrintSettings` | export default function | 46 |
| 5 | `T` | const arrow | 47 |
| 6 | `persistPrintSettings` | const arrow | 69 |
| 7 | `setValue` | const arrow | 85 |
| 8 | `resetMargins` | const arrow | 94 |
| 9 | `getPreviewSource` | const arrow | 110 |

### 3.267 `frontend/src/components/receipt-settings/ReceiptPreview.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ReceiptPreview` | export default function | 12 |
| 2 | `loadPreview` | function | 23 |

### 3.268 `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Section` | function | 19 |
| 2 | `Toggle` | function | 30 |
| 3 | `ReceiptSettings` | export default function | 45 |
| 4 | `handleSave` | const arrow | 190 |

### 3.269 `frontend/src/components/receipt-settings/template.js`

- No top-level named symbols detected.

### 3.270 `frontend/src/components/receipt-settings/template.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isRecord` | function | 6 |
| 2 | `parseTemplateInput` | function | 10 |
| 3 | `parseReceiptTemplate` | export function | 19 |
| 4 | `serializeReceiptTemplate` | export function | 30 |

### 3.271 `frontend/src/components/receipt/Receipt.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `stripEmoji` | function | 9 |
| 2 | `displayAddress` | function | 14 |
| 3 | `parseItems` | function | 23 |
| 4 | `labelFor` | function | 115 |
| 5 | `Row` | function | 120 |
| 6 | `Receipt` | export default function | 132 |
| 7 | `em` | const arrow | 146 |
| 8 | `exportReceiptPdf` | const arrow | 342 |

### 3.272 `frontend/src/components/returns/EditReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `EditReturnModal` | function | 10 |
| 2 | `T` | const arrow | 12 |
| 3 | `updateQty` | const arrow | 38 |
| 4 | `updateRestock` | const arrow | 41 |
| 5 | `handleSubmit` | const arrow | 49 |

### 3.273 `frontend/src/components/returns/NewReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NewReturnModal` | function | 18 |
| 2 | `T` | const arrow | 20 |
| 3 | `handleSearch` | const arrow | 48 |
| 4 | `handleReturnTypeChange` | const arrow | 113 |
| 5 | `toggleIncluded` | const arrow | 118 |
| 6 | `updateItemQty` | const arrow | 126 |
| 7 | `updateItemRestock` | const arrow | 134 |
| 8 | `selectAll` | const arrow | 138 |
| 9 | `clearAll` | const arrow | 141 |
| 10 | `handleSubmit` | const arrow | 148 |

### 3.274 `frontend/src/components/returns/NewSupplierReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NewSupplierReturnModal` | export default function | 15 |
| 2 | `tr` | const arrow | 17 |
| 3 | `loadSetup` | function | 52 |
| 4 | `loadInventory` | function | 97 |
| 5 | `updateQty` | const arrow | 162 |
| 6 | `submit` | const arrow | 168 |

### 3.275 `frontend/src/components/returns/ReturnDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeScope` | function | 6 |
| 2 | `ReturnDetailModal` | export default function | 10 |
| 3 | `tr` | const arrow | 12 |

### 3.276 `frontend/src/components/returns/Returns.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeScope` | function | 34 |
| 2 | `getReturnTypeKey` | function | 38 |
| 3 | `getReturnTypeLabel` | function | 44 |
| 4 | `exportReturnRows` | function | 52 |
| 5 | `Returns` | export default function | 70 |
| 6 | `promise` | const arrow | 135 |
| 7 | `handleOpenEdit` | const arrow | 212 |
| 8 | `renderAmount` | const arrow | 588 |

### 3.277 `frontend/src/components/returns/ReturnsListSurface.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `detectMobileViewport` | function | 14 |
| 2 | `ReturnsDesktopSkeletonRows` | function | 19 |
| 3 | `ReturnsMobileSkeletonCards` | function | 36 |
| 4 | `ReturnsListSurface` | export default function | 56 |
| 5 | `apply` | const arrow | 87 |

### 3.278 `frontend/src/components/sales/ExportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ExportModal` | export default function | 10 |
| 2 | `tr` | const arrow | 17 |
| 3 | `computeDates` | const arrow | 22 |
| 4 | `validateDates` | const arrow | 41 |
| 5 | `downloadCsvBlob` | const arrow | 49 |
| 6 | `buildCsvFallback` | const arrow | 59 |
| 7 | `escape` | const arrow | 63 |
| 8 | `handlePreview` | const arrow | 84 |
| 9 | `handleExportCSV` | const arrow | 101 |

### 3.279 `frontend/src/components/sales/SaleDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `InfoBlock` | function | 5 |
| 2 | `parseItems` | function | 21 |
| 3 | `SaleDetailModal` | export default function | 31 |
| 4 | `translateOr` | const arrow | 47 |
| 5 | `handleStatusUpdate` | const arrow | 69 |
| 6 | `handleMembershipAttach` | const arrow | 80 |

### 3.280 `frontend/src/components/sales/Sales.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `multiMatch` | function | 33 |
| 2 | `getSaleBranchLabel` | function | 37 |
| 3 | `Sales` | export default function | 45 |
| 4 | `promise` | const arrow | 128 |
| 5 | `handleStatusChange` | const arrow | 240 |
| 6 | `handleAttachMembership` | const arrow | 284 |
| 7 | `toggleSelected` | const arrow | 464 |
| 8 | `toggleSelectAll` | const arrow | 470 |
| 9 | `handleExportSelected` | const arrow | 501 |
| 10 | `handleBulkStatusUpdate` | const arrow | 549 |

### 3.281 `frontend/src/components/sales/SalesImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `countSalesCsvRowsInWorker` | function | 18 |
| 2 | `cleanup` | const arrow | 30 |
| 3 | `SalesImportModal` | export default function | 50 |
| 4 | `tr` | const arrow | 63 |
| 5 | `signalDone` | const arrow | 68 |
| 6 | `analyzeCsvText` | const arrow | 79 |
| 7 | `setSalesCsvText` | const arrow | 95 |
| 8 | `handlePickFile` | const arrow | 103 |
| 9 | `handleDownloadTemplate` | const arrow | 109 |
| 10 | `handleImport` | const arrow | 113 |

### 3.282 `frontend/src/components/sales/salesImportWorker.mjs`

- No top-level named symbols detected.

### 3.283 `frontend/src/components/sales/salesImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.284 `frontend/src/components/sales/SalesListSurface.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `SalesListSurface` | export default function | 5 |

### 3.285 `frontend/src/components/sales/StatusBadge.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getStatusLabel` | export function | 23 |
| 2 | `StatusBadge` | export default function | 39 |

### 3.286 `frontend/src/components/server/ServerPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `useLocalCopy` | function | 29 |
| 2 | `isAutoDetected` | function | 40 |
| 3 | `StatusRow` | function | 47 |
| 4 | `InfoTab` | function | 59 |
| 5 | `fmt` | const arrow | 124 |
| 6 | `DiagnosticsPanel` | function | 210 |
| 7 | `onErr` | const arrow | 250 |
| 8 | `onQueueChanged` | const arrow | 254 |
| 9 | `handleRetryQueue` | function | 300 |
| 10 | `handleDiscardQueue` | function | 317 |
| 11 | `ServerPage` | export default function | 508 |
| 12 | `check` | const arrow | 535 |
| 13 | `loadSecurityConfig` | const arrow | 561 |
| 14 | `handleTest` | function | 577 |
| 15 | `handleSave` | function | 606 |
| 16 | `handleDisconnect` | function | 613 |

### 3.287 `frontend/src/components/shared/ActionHistoryBar.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatHistoryList` | function | 5 |
| 2 | `formatServerStatus` | function | 9 |
| 3 | `ActionHistoryBar` | export default function | 16 |
| 4 | `T` | const arrow | 27 |

### 3.288 `frontend/src/components/shared/BackgroundImportTracker.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nextImportTrackerBackoff` | function | 26 |
| 2 | `normalizeJobStatus` | function | 33 |
| 3 | `dedupeJobsById` | function | 37 |
| 4 | `isRecent` | function | 49 |
| 5 | `getJobProgressDetails` | function | 55 |
| 6 | `getJobLabel` | function | 123 |
| 7 | `getJobResultSummary` | function | 129 |
| 8 | `add` | const arrow | 132 |
| 9 | `getRowsDisplay` | function | 145 |
| 10 | `buildJobsSignature` | function | 161 |
| 11 | `BackgroundImportTracker` | export default function | 176 |
| 12 | `beginTrackerAction` | const arrow | 303 |
| 13 | `finishTrackerAction` | const arrow | 312 |
| 14 | `handleCancel` | const arrow | 317 |
| 15 | `handleRetry` | const arrow | 335 |
| 16 | `handleApprove` | const arrow | 353 |
| 17 | `handleDownloadErrors` | const arrow | 382 |
| 18 | `handleRemove` | const arrow | 398 |
| 19 | `handleDismiss` | const arrow | 434 |

### 3.289 `frontend/src/components/shared/ExportMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ExportMenu` | export default function | 4 |

### 3.290 `frontend/src/components/shared/FilterMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sectionButtonClass` | function | 4 |
| 2 | `FilterMenu` | export default function | 10 |

### 3.291 `frontend/src/components/shared/globalScroll.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getScrollTarget` | export function | 1 |
| 2 | `getScrollToPosition` | export function | 21 |

### 3.292 `frontend/src/components/shared/ImageGalleryLightbox.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ImageGalleryLightbox` | export default function | 8 |
| 2 | `formatLabel` | function | 30 |
| 3 | `setIndex` | function | 34 |
| 4 | `renderGalleryImage` | function | 40 |
| 5 | `onKeyDown` | function | 47 |

### 3.293 `frontend/src/components/shared/LoadingWatchdog.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `LoadingWatchdog` | export default function | 3 |

### 3.294 `frontend/src/components/shared/Modal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Modal` | export default function | 10 |

### 3.295 `frontend/src/components/shared/navigationConfig.js`

- No top-level named symbols detected.

### 3.296 `frontend/src/components/shared/navigationConfig.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseNavSetting` | export function | 42 |

### 3.297 `frontend/src/components/shared/NotificationCenter.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `preferenceValue` | function | 135 |
| 2 | `matchesVisibilityMode` | function | 142 |
| 3 | `NotificationSeverityIcon` | function | 149 |
| 4 | `NotificationCenter` | export default function | 164 |
| 5 | `syncVisibility` | const arrow | 198 |
| 6 | `onVisible` | const arrow | 271 |
| 7 | `handleClickOutside` | const arrow | 294 |

### 3.298 `frontend/src/components/shared/pageActivity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `useIsPageActive` | export function | 4 |

### 3.299 `frontend/src/components/shared/PageHeader.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PageHeader` | export default function | 9 |

### 3.300 `frontend/src/components/shared/PaginationControls.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `clampPage` | export function | 6 |
| 2 | `paginateItems` | export function | 12 |
| 3 | `PaginationControls` | export default function | 20 |
| 4 | `commitPageDraft` | const arrow | 50 |
| 5 | `handlePageInputKeyDown` | const arrow | 61 |

### 3.301 `frontend/src/components/shared/PortalMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PortalMenu` | export default function | 11 |
| 2 | `closeIfClickedOutside` | const arrow | 69 |
| 3 | `closeMenu` | const arrow | 76 |
| 4 | `scheduleReposition` | const arrow | 77 |
| 5 | `closeIfEscape` | const arrow | 84 |
| 6 | `ThreeDotPortal` | export function | 193 |

### 3.302 `frontend/src/components/shared/QuickPreferenceToggles.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ToggleButton` | function | 4 |
| 2 | `QuickPreferenceToggles` | export default function | 23 |
| 3 | `tr` | const arrow | 25 |

### 3.303 `frontend/src/components/shared/SectionSwitcher.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readStoredSection` | function | 3 |
| 2 | `SectionSwitcher` | export default function | 12 |
| 3 | `selectValue` | const arrow | 39 |

### 3.304 `frontend/src/components/shared/WriteConflictModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatConflictTime` | function | 3 |
| 2 | `summarizeCurrentValue` | function | 10 |
| 3 | `formatValue` | function | 66 |
| 4 | `getConflictFieldRows` | function | 73 |
| 5 | `WriteConflictModal` | export default function | 171 |

### 3.305 `frontend/src/components/users/PermissionEditor.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PermissionEditor` | export default function | 49 |
| 2 | `translate` | const arrow | 50 |
| 3 | `labelFor` | const arrow | 56 |
| 4 | `sensitivityLabel` | const arrow | 57 |
| 5 | `toggle` | const arrow | 64 |

### 3.306 `frontend/src/components/users/UserDetailSheet.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `translateLabel` | function | 4 |
| 2 | `buildRowData` | function | 9 |
| 3 | `UserDetailSheet` | export default function | 21 |

### 3.307 `frontend/src/components/users/UserProfileModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `AvatarPreview` | function | 25 |
| 2 | `ProfileSectionButton` | function | 43 |
| 3 | `clamp` | function | 153 |
| 4 | `loadImageElement` | function | 157 |
| 5 | `renderAvatarCropBlob` | function | 172 |
| 6 | `AvatarEditorModal` | function | 198 |
| 7 | `UserProfileModal` | export default function | 259 |
| 8 | `tr` | const arrow | 263 |
| 9 | `loadProfile` | const arrow | 338 |
| 10 | `handleProfileSave` | const arrow | 427 |
| 11 | `handlePasswordSave` | const arrow | 490 |
| 12 | `handleSessionSave` | const arrow | 528 |
| 13 | `refreshOtpState` | const arrow | 548 |
| 14 | `handleAvatarPick` | const arrow | 560 |
| 15 | `resetAvatarEditor` | const arrow | 562 |
| 16 | `openAvatarEditor` | const arrow | 568 |
| 17 | `closeAvatarEditor` | const arrow | 576 |
| 18 | `handleStartOauthLink` | const arrow | 586 |
| 19 | `handleDisconnectOauthProvider` | const arrow | 625 |
| 20 | `handleAvatarSelected` | const arrow | 677 |
| 21 | `saveAvatarFromEditor` | const arrow | 697 |

### 3.308 `frontend/src/components/users/Users.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ThreeDot` | function | 33 |
| 2 | `formatContactValue` | function | 72 |
| 3 | `UsersDesktopSkeletonRows` | function | 77 |
| 4 | `UsersMobileSkeletonCards` | function | 101 |
| 5 | `Users` | export default function | 115 |
| 6 | `canManageTargetUser` | const arrow | 170 |
| 7 | `promise` | const arrow | 182 |
| 8 | `promise` | const arrow | 220 |
| 9 | `openCreateUser` | const arrow | 332 |
| 10 | `openEditUser` | const arrow | 342 |
| 11 | `openCreateRole` | const arrow | 362 |
| 12 | `openEditRole` | const arrow | 369 |
| 13 | `getRolePermissions` | const arrow | 380 |
| 14 | `getPermissionSummary` | const arrow | 389 |
| 15 | `handleSaveUser` | const arrow | 427 |
| 16 | `handleResetPassword` | const arrow | 497 |
| 17 | `handleSaveRole` | const arrow | 554 |
| 18 | `handleDeleteRole` | const arrow | 629 |

### 3.309 `frontend/src/components/utils-settings/AuditLog.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toIso` | function | 46 |
| 2 | `formatDateTime` | function | 52 |
| 3 | `formatLogTime` | function | 72 |
| 4 | `getLogEpoch` | function | 76 |
| 5 | `formatJsonPretty` | function | 83 |
| 6 | `parseLogJson` | function | 91 |
| 7 | `flattenSummaryValue` | function | 99 |
| 8 | `formatEntityName` | function | 118 |
| 9 | `readableSummary` | function | 124 |
| 10 | `DetailRow` | function | 144 |
| 11 | `AuditLog` | export default function | 156 |
| 12 | `sessionEntryLabel` | function | 542 |

### 3.310 `frontend/src/components/utils-settings/Backup.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PathActionButton` | function | 79 |
| 2 | `PrimaryActionButton` | function | 91 |
| 3 | `formatElapsed` | function | 103 |
| 4 | `JobProgressCard` | function | 112 |
| 5 | `DoctorStatusPill` | function | 172 |
| 6 | `IntegrationDoctorCard` | function | 196 |
| 7 | `useCopy` | function | 302 |
| 8 | `formatDateTime` | function | 318 |
| 9 | `formatBytes` | function | 333 |
| 10 | `yieldToBrowser` | function | 342 |
| 11 | `getJobSignature` | function | 350 |
| 12 | `startJobWatcher` | function | 369 |
| 13 | `stop` | const arrow | 385 |
| 14 | `scheduleTick` | const arrow | 391 |
| 15 | `tick` | const arrow | 397 |
| 16 | `SectionChip` | function | 454 |
| 17 | `secondsToSyncMinutes` | function | 476 |
| 18 | `minutesToSyncSeconds` | function | 485 |
| 19 | `GoogleDriveSyncSection` | function | 493 |
| 20 | `handler` | const arrow | 615 |
| 21 | `savePreferences` | const arrow | 700 |
| 22 | `connectGoogleDrive` | const arrow | 730 |
| 23 | `syncNow` | const arrow | 775 |
| 24 | `disconnect` | const arrow | 812 |
| 25 | `forgetCredentials` | const arrow | 837 |
| 26 | `BackupOverview` | function | 1067 |
| 27 | `Backup` | export default function | 1134 |
| 28 | `showBackupSection` | const arrow | 1149 |
| 29 | `handleFolderExport` | const arrow | 1172 |
| 30 | `handleFolderImport` | const arrow | 1241 |

### 3.311 `frontend/src/components/utils-settings/FontFamilyPicker.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `FontFamilyPicker` | function | 20 |

### 3.312 `frontend/src/components/utils-settings/index.js`

- No top-level named symbols detected.

### 3.313 `frontend/src/components/utils-settings/index.ts`

- No top-level named symbols detected.

### 3.314 `frontend/src/components/utils-settings/OtpModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `OtpModal` | export default function | 17 |
| 2 | `loadSetup` | function | 52 |

### 3.315 `frontend/src/components/utils-settings/ResetData.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ConfirmReset` | function | 11 |
| 2 | `T` | const arrow | 24 |
| 3 | `ResetData` | function | 92 |
| 4 | `T` | const arrow | 94 |
| 5 | `doReset` | const arrow | 122 |
| 6 | `FactoryReset` | function | 192 |
| 7 | `T` | const arrow | 194 |
| 8 | `doFactoryReset` | function | 201 |

### 3.316 `frontend/src/components/utils-settings/Settings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseStoredColors` | function | 115 |
| 2 | `buildColorChoices` | function | 126 |
| 3 | `useCopy` | function | 217 |
| 4 | `getSettingsNavLabel` | function | 225 |
| 5 | `SwatchPicker` | function | 242 |
| 6 | `SettingsSection` | function | 325 |
| 7 | `Settings` | export default function | 355 |
| 8 | `showSettingsSection` | const arrow | 381 |
| 9 | `loadOtpStatus` | function | 447 |
| 10 | `loadFaviconPreview` | function | 477 |
| 11 | `setValue` | const arrow | 532 |
| 12 | `formatPreviewDateTime` | const arrow | 558 |
| 13 | `moveNavItem` | const arrow | 574 |
| 14 | `toggleMobilePinned` | const arrow | 584 |
| 15 | `movePinnedItem` | const arrow | 596 |
| 16 | `movePinnedBefore` | const arrow | 606 |
| 17 | `resetNavigationLayout` | const arrow | 618 |
| 18 | `field` | const arrow | 623 |
| 19 | `savePaymentMethods` | const arrow | 645 |
| 20 | `uploadImageSetting` | const arrow | 665 |
| 21 | `handleSaveSettings` | const arrow | 730 |

### 3.317 `frontend/src/components/utils-settings/settingsConflict.js`

- No top-level named symbols detected.

### 3.318 `frontend/src/components/utils-settings/settingsConflict.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeObject` | function | 28 |
| 2 | `buildSettingsConflictState` | export function | 32 |
| 3 | `diffSettingsConflictFields` | export function | 46 |

### 3.319 `frontend/src/constants.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createEmptyOrder` | export function | 128 |
| 2 | `formatDate` | export function | 158 |
| 3 | `isNetworkError` | export function | 178 |

### 3.320 `frontend/src/index.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `registerOfflineAppShell` | function | 16 |
| 2 | `register` | const arrow | 19 |
| 3 | `installFormFieldAccessibility` | function | 35 |
| 4 | `escapeSelectorValue` | const arrow | 40 |
| 5 | `wireField` | const arrow | 45 |
| 6 | `scan` | const arrow | 67 |
| 7 | `safeInsertRule` | const function | 105 |
| 8 | `safeCssRulesGetter` | const function | 122 |
| 9 | `stopKnownStartupNoise` | const arrow | 138 |
| 10 | `scheduleFormFieldAccessibility` | function | 171 |

### 3.321 `frontend/src/platform/runtime/clientRuntime.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `canUseBrowserStorage` | function | 6 |
| 2 | `isBusinessOsStorageKey` | function | 10 |
| 3 | `sanitizeText` | function | 15 |
| 4 | `sanitizeSyncServerUrl` | export function | 19 |
| 5 | `normalizeRuntimeDescriptor` | export function | 31 |
| 6 | `readStoredRuntimeDescriptor` | export function | 40 |
| 7 | `writeStoredRuntimeDescriptor` | export function | 51 |
| 8 | `shouldResetForRuntimeChange` | export function | 65 |
| 9 | `buildQueuedOperationScope` | export function | 79 |
| 10 | `doesQueuedScopeMatchCurrent` | export function | 87 |
| 11 | `clearServiceWorkersAndCaches` | function | 102 |
| 12 | `snapshotStorage` | function | 122 |
| 13 | `clearStorage` | function | 135 |
| 14 | `restoreStorage` | function | 148 |
| 15 | `resetClientRuntimeState` | export function | 158 |

### 3.322 `frontend/src/platform/storage/storagePolicy.mjs`

- No top-level named symbols detected.

### 3.323 `frontend/src/platform/storage/storagePolicy.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `shouldPersistLocalMirror` | export function | 22 |
| 2 | `maxStoredNumber` | export function | 29 |
| 3 | `isCooldownActive` | export function | 36 |

### 3.324 `frontend/src/runtime/runtimeErrorClassifier.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toText` | function | 8 |
| 2 | `includesExtensionOrigin` | function | 12 |
| 3 | `getPathname` | function | 17 |
| 4 | `isFirstPartyBuiltAssetSource` | export function | 27 |
| 5 | `isLikelyInjectedRuntimeSource` | export function | 37 |
| 6 | `isKnownBridgeMessage` | export function | 48 |
| 7 | `isKnownStyleInjectionNoise` | export function | 59 |
| 8 | `isKnownEvalCspNoise` | export function | 78 |
| 9 | `shouldSuppressRuntimeError` | export function | 85 |
| 10 | `shouldSuppressSecurityPolicyViolation` | export function | 107 |
| 11 | `isGuardableStyleSheetError` | export function | 121 |

### 3.325 `frontend/src/types/jsx-modules.d.ts`

- No top-level named symbols detected.

### 3.326 `frontend/src/types/receiptContracts.ts`

- No top-level named symbols detected.

### 3.327 `frontend/src/types/settingsContracts.ts`

- No top-level named symbols detected.

### 3.328 `frontend/src/utils/actionGuards.mjs`

- No top-level named symbols detected.

### 3.329 `frontend/src/utils/actionGuards.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `hasOwn` | function | 18 |
| 2 | `beginNamedAction` | export function | 41 |
| 3 | `finishNamedAction` | export function | 52 |
| 4 | `beginKeyedAction` | export function | 58 |
| 5 | `finishKeyedAction` | export function | 70 |

### 3.330 `frontend/src/utils/actionHistory.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeEntry` | function | 13 |
| 2 | `useActionHistory` | export function | 26 |

### 3.331 `frontend/src/utils/appRefresh.d.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeRefreshChannels` | export function | 2 |
| 2 | `refreshAppData` | export function | 3 |

### 3.332 `frontend/src/utils/appRefresh.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeRefreshChannels` | function | 18 |
| 2 | `refreshAppData` | export function | 26 |

### 3.333 `frontend/src/utils/bulkOps.mjs`

- No top-level named symbols detected.

### 3.334 `frontend/src/utils/bulkOps.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runner` | function | 47 |

### 3.335 `frontend/src/utils/color.js`

- No top-level named symbols detected.

### 3.336 `frontend/src/utils/color.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeHex` | function | 1 |
| 2 | `relativeLuminance` | function | 12 |
| 3 | `getContrastingTextColor` | export function | 29 |

### 3.337 `frontend/src/utils/csv.d.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildCSV` | export function | 1 |
| 2 | `buildZip` | export function | 2 |
| 3 | `buildZipInWorker` | export function | 3 |
| 4 | `downloadBlob` | export function | 4 |
| 5 | `downloadCSV` | export function | 5 |
| 6 | `downloadZipFiles` | export function | 6 |
| 7 | `downloadZipFilesAsync` | export function | 7 |

### 3.338 `frontend/src/utils/csv.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `escapeCsvValue` | function | 7 |
| 2 | `buildCSV` | export function | 18 |
| 3 | `downloadBlob` | export function | 27 |
| 4 | `downloadCSV` | export function | 41 |
| 5 | `normalizeZipFile` | function | 47 |
| 6 | `CRC32_TABLE` | const arrow | 59 |
| 7 | `crc32` | function | 71 |
| 8 | `writeUint16` | function | 79 |
| 9 | `writeUint32` | function | 83 |
| 10 | `encodeZipTimestamp` | function | 87 |
| 11 | `buildZip` | export function | 100 |
| 12 | `buildZipInWorker` | export function | 177 |
| 13 | `finish` | const arrow | 183 |
| 14 | `downloadZipFiles` | export function | 205 |
| 15 | `downloadZipFilesAsync` | export function | 211 |

### 3.339 `frontend/src/utils/csvExportWorker.mjs`

- No top-level named symbols detected.

### 3.340 `frontend/src/utils/csvExportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getErrorMessage` | function | 20 |

### 3.341 `frontend/src/utils/csvImport.js`

- No top-level named symbols detected.

### 3.342 `frontend/src/utils/csvImport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `stripBom` | function | 24 |
| 2 | `toUint8Array` | function | 28 |
| 3 | `detectUtf16Encoding` | function | 35 |
| 4 | `decodeUtf16Be` | function | 56 |
| 5 | `decodeTextBuffer` | export function | 66 |
| 6 | `normalizeDigit` | function | 89 |
| 7 | `normalizeNumericText` | export function | 97 |
| 8 | `countDelimiter` | function | 104 |
| 9 | `detectCsvDelimiter` | export function | 123 |
| 10 | `splitCsvLine` | export function | 131 |
| 11 | `parseDelimitedRows` | export function | 165 |
| 12 | `normalizeCsvKey` | export function | 210 |
| 13 | `parseCsvRows` | export function | 218 |
| 14 | `removeCurrencyNoise` | function | 237 |
| 15 | `normalizeNumberSeparators` | function | 244 |
| 16 | `parseCsvNumber` | export function | 280 |
| 17 | `parseRequiredCsvNumber` | export function | 290 |
| 18 | `normalizeCsvMoney` | export function | 299 |
| 19 | `normalizeCsvPercent` | export function | 303 |

### 3.343 `frontend/src/utils/csvRowCounter.mjs`

- No top-level named symbols detected.

### 3.344 `frontend/src/utils/csvRowCounter.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `countCsvDataRows` | export function | 1 |
| 2 | `finishRecord` | const arrow | 7 |

### 3.345 `frontend/src/utils/dateHelpers.js`

- No top-level named symbols detected.

### 3.346 `frontend/src/utils/dateHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toLocalDateString` | function | 4 |
| 2 | `todayStr` | export function | 8 |
| 3 | `offsetDate` | export function | 13 |

### 3.347 `frontend/src/utils/deviceInfo.js`

- No top-level named symbols detected.

### 3.348 `frontend/src/utils/deviceInfo.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBrowserName` | function | 13 |
| 2 | `getOperatingSystemName` | function | 21 |
| 3 | `getClientDeviceInfo` | export function | 30 |
| 4 | `getClientMetaHeaders` | export function | 42 |

### 3.349 `frontend/src/utils/exportPackage.js`

- No top-level named symbols detected.

### 3.350 `frontend/src/utils/exportPackage.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildReportManifestRows` | export function | 30 |
| 2 | `buildReportPackageFiles` | export function | 38 |

### 3.351 `frontend/src/utils/exportReports.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `escapeHtml` | function | 198 |
| 2 | `formatCellValue` | function | 207 |
| 3 | `renderChartMarkup` | function | 212 |
| 4 | `renderMetadataGroups` | function | 228 |
| 5 | `renderSummaryCards` | function | 250 |
| 6 | `renderCharts` | function | 265 |
| 7 | `renderTables` | function | 283 |
| 8 | `renderNotes` | function | 317 |
| 9 | `buildStandaloneReportHtml` | export function | 329 |

### 3.352 `frontend/src/utils/favicon.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `clamp` | function | 1 |
| 2 | `shouldUseAnonymousCors` | function | 8 |
| 3 | `loadImage` | function | 19 |
| 4 | `createCircularFaviconDataUrl` | export function | 39 |

### 3.353 `frontend/src/utils/formatters.js`

- No top-level named symbols detected.

### 3.354 `frontend/src/utils/formatters.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeTimestampInput` | function | 6 |
| 2 | `fmtTime` | export function | 28 |
| 3 | `fmtDate` | export function | 52 |
| 4 | `fmtShort` | export function | 73 |
| 5 | `fmtCount` | export function | 85 |

### 3.355 `frontend/src/utils/groupedRecords.mjs`

- No top-level named symbols detected.

### 3.356 `frontend/src/utils/groupedRecords.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toDate` | function | 37 |
| 2 | `normalizeName` | function | 56 |
| 3 | `getAlphabetInitialSection` | export function | 60 |
| 4 | `compareAlphabetLabels` | function | 64 |
| 5 | `getTimeParts` | export function | 68 |
| 6 | `matchesYearMonthFilters` | export function | 100 |
| 7 | `getTimeGroupingMode` | export function | 119 |
| 8 | `toggleIdSet` | export function | 321 |

### 3.357 `frontend/src/utils/historyHelpers.mjs`

- No top-level named symbols detected.

### 3.358 `frontend/src/utils/historyHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `extractHistoryResultId` | export function | 26 |
| 2 | `resolveCreatedHistorySnapshot` | export function | 36 |

### 3.359 `frontend/src/utils/importJobRefresh.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeImportJobStatus` | function | 3 |
| 2 | `normalizeImportJobType` | function | 7 |
| 3 | `uniqueChannels` | function | 11 |
| 4 | `getImportCompletionRefreshChannels` | export function | 15 |
| 5 | `shouldDispatchImportCompletionRefresh` | export function | 38 |
| 6 | `dispatchImportCompletionRefresh` | export function | 46 |

### 3.360 `frontend/src/utils/index.js`

- No top-level named symbols detected.

### 3.361 `frontend/src/utils/index.ts`

- No top-level named symbols detected.

### 3.362 `frontend/src/utils/initials.mjs`

- No top-level named symbols detected.

### 3.363 `frontend/src/utils/initials.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeInitialText` | export function | 30 |
| 2 | `getInitialKey` | export function | 34 |
| 3 | `getInitialType` | export function | 45 |
| 4 | `getInitialRank` | function | 54 |
| 5 | `compareInitialKeys` | export function | 64 |
| 6 | `aggregateInitialOptions` | export function | 79 |
| 7 | `buildInitialOptionsFromProducts` | export function | 97 |

### 3.364 `frontend/src/utils/loaders.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `settleLoaderMap` | export function | 10 |
| 2 | `beginTrackedRequest` | export function | 34 |
| 3 | `isTrackedRequestCurrent` | export function | 40 |
| 4 | `invalidateTrackedRequest` | export function | 44 |
| 5 | `createLoaderTimeoutError` | export function | 52 |
| 6 | `withLoaderTimeout` | export function | 59 |
| 7 | `getLoaderErrorMessage` | export function | 76 |
| 8 | `getFirstLoaderError` | export function | 80 |

### 3.365 `frontend/src/utils/mediaUpload.js`

- No top-level named symbols detected.

### 3.366 `frontend/src/utils/mediaUpload.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createInitialUploadState` | export function | 33 |
| 2 | `isTemporaryPreviewUrl` | export function | 47 |
| 3 | `sanitizePersistedMediaPath` | export function | 52 |
| 4 | `buildCacheBustedMediaPath` | export function | 59 |
| 5 | `reduceUploadState` | export function | 77 |

### 3.367 `frontend/src/utils/permissions.js`

- No top-level named symbols detected.

### 3.368 `frontend/src/utils/permissions.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isPermissionMap` | function | 3 |
| 2 | `parsePermissionMap` | export function | 7 |

### 3.369 `frontend/src/utils/pricing.d.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toFiniteNumber` | export function | 1 |
| 2 | `roundUpToDecimals` | export function | 2 |
| 3 | `normalizePriceValue` | export function | 3 |
| 4 | `formatPriceNumber` | export function | 4 |
| 5 | `normalizeDiscountPercent` | export function | 5 |
| 6 | `normalizeDiscountType` | export function | 6 |
| 7 | `isProductDiscountActive` | export function | 7 |
| 8 | `calculateProductDiscount` | export function | 8 |

### 3.370 `frontend/src/utils/pricing.js`

- No top-level named symbols detected.

### 3.371 `frontend/src/utils/pricing.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toFiniteNumber` | export function | 15 |
| 2 | `roundUpToDecimals` | export function | 20 |
| 3 | `normalizePriceValue` | export function | 32 |
| 4 | `formatPriceNumber` | export function | 36 |
| 5 | `normalizeDiscountPercent` | export function | 43 |
| 6 | `normalizeDiscountType` | export function | 48 |
| 7 | `isProductDiscountActive` | export function | 52 |
| 8 | `calculateProductDiscount` | export function | 65 |

### 3.372 `frontend/src/utils/printReceipt.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parsePrintNumber` | function | 9 |
| 2 | `cloneElementWithInlineStyles` | function | 82 |
| 3 | `normalizeReceiptContentWidth` | export function | 105 |
| 4 | `escapeHtml` | function | 128 |
| 5 | `blobToDataUrl` | function | 137 |
| 6 | `inlineImageNodeSources` | function | 146 |
| 7 | `extractUrlsFromCssValue` | function | 169 |
| 8 | `inlineStyleAssetUrls` | function | 175 |
| 9 | `normalizePrintableRoot` | function | 209 |
| 10 | `mmToPt` | function | 226 |
| 11 | `dataUrlToBytes` | function | 230 |
| 12 | `joinPdfChunks` | function | 240 |
| 13 | `buildPdfStream` | function | 251 |
| 14 | `buildSingleImagePdf` | function | 260 |
| 15 | `escapePdfText` | function | 298 |
| 16 | `wrapTextLine` | function | 305 |
| 17 | `buildTextOnlyPdf` | function | 324 |
| 18 | `buildReceiptFileName` | function | 377 |
| 19 | `createTextOnlyReceiptCanvas` | function | 388 |
| 20 | `canvasToPngBlob` | function | 429 |
| 21 | `waitForElementAssets` | function | 442 |
| 22 | `renderElementToCanvas` | function | 471 |
| 23 | `withReceiptElement` | function | 537 |
| 24 | `createPrintableReceiptMarkup` | function | 577 |
| 25 | `buildPrintablePreviewDocument` | function | 592 |
| 26 | `attachPrintablePreviewActions` | function | 739 |
| 27 | `schedulePrint` | const arrow | 748 |
| 28 | `openPrintableReceiptPreview` | export function | 753 |
| 29 | `downloadBlob` | function | 766 |
| 30 | `getPrintSettings` | export function | 777 |
| 31 | `savePrintSettings` | export function | 790 |
| 32 | `getPaperWidthMm` | export function | 798 |
| 33 | `createReceiptPdfBlob` | export function | 808 |
| 34 | `buildTextOnlyReceiptBlob` | const arrow | 814 |
| 35 | `renderPdfBlob` | const arrow | 828 |
| 36 | `createReceiptImageBlob` | export function | 863 |
| 37 | `extractReceiptLines` | function | 884 |
| 38 | `downloadReceiptPdf` | export function | 902 |
| 39 | `downloadReceiptImage` | export function | 921 |
| 40 | `openReceiptPdf` | export function | 928 |
| 41 | `printReceipt` | export function | 952 |

### 3.373 `frontend/src/utils/productBatches.mjs`

- No top-level named symbols detected.

### 3.374 `frontend/src/utils/productBatches.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeBranchId` | function | 26 |
| 2 | `getVisibleProductBatches` | export function | 32 |
| 3 | `buildBatchPreview` | export function | 53 |

### 3.375 `frontend/src/utils/productGrouping.mjs`

- No top-level named symbols detected.

### 3.376 `frontend/src/utils/productGrouping.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeText` | function | 63 |
| 2 | `toProductId` | function | 67 |
| 3 | `normalizeProductGroupName` | export function | 72 |
| 4 | `getNameInitialSection` | export function | 76 |
| 5 | `compareSectionLabels` | function | 80 |
| 6 | `compareProducts` | function | 84 |
| 7 | `buildChildrenByParentId` | function | 107 |
| 8 | `resolveRootProduct` | function | 118 |
| 9 | `resolveFamilyRootId` | function | 136 |
| 10 | `compareProductsWithinGroup` | function | 140 |
| 11 | `resolveGroupKey` | function | 155 |
| 12 | `buildProductGroups` | export function | 175 |
| 13 | `buildProductGroupSections` | export function | 275 |

### 3.377 `frontend/src/utils/publicAssetUrls.d.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `resolvePublicAssetUrl` | export function | 1 |

### 3.378 `frontend/src/utils/publicAssetUrls.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trimBaseUrl` | function | 4 |
| 2 | `normalizeUploadPath` | function | 8 |
| 3 | `appendAssetVersion` | function | 16 |
| 4 | `isLocalLikeHostname` | function | 31 |
| 5 | `getSafeCurrentOrigin` | function | 35 |
| 6 | `getStoredPublicAssetBaseUrl` | export function | 47 |
| 7 | `resolvePublicAssetUrl` | export function | 60 |

### 3.379 `frontend/src/utils/receiptAppliedConfig.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseObject` | function | 67 |
| 2 | `normalizeReceiptTemplate` | export function | 85 |
| 3 | `serializeReceiptTemplateValue` | export function | 92 |
| 4 | `normalizeReceiptPrintSettings` | export function | 96 |
| 5 | `serializeReceiptPrintSettings` | export function | 110 |
| 6 | `readReceiptPrintSettingsFromSettings` | export function | 114 |
| 7 | `buildAppliedReceiptConfig` | export function | 118 |

### 3.380 `frontend/src/utils/scriptTypography.js`

- No top-level named symbols detected.

### 3.381 `frontend/src/utils/scriptTypography.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `containsKhmerScript` | export function | 8 |
| 2 | `withKhmerTextClass` | export function | 12 |
| 3 | `getKhmerTextProps` | export function | 18 |

### 3.382 `frontend/src/utils/settingsRefresh.js`

- No top-level named symbols detected.

### 3.383 `frontend/src/utils/settingsRefresh.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeSettingKeys` | function | 62 |
| 2 | `getSettingsRefreshChannels` | export function | 70 |

### 3.384 `frontend/src/utils/settingsWriteOptions.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeSettingsWriteOptions` | export function | 3 |

### 3.385 `frontend/src/web-api.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sanitizeBaseUrl` | function | 43 |
| 2 | `loadMethodsModule` | function | 47 |
| 3 | `getLazyApiMethod` | function | 52 |
| 4 | `bytesToBase64` | function | 66 |
| 5 | `base64ToBytes` | function | 73 |
| 6 | `stableStringify` | function | 80 |
| 7 | `sha256Hex` | function | 86 |
| 8 | `deriveOfflineVaultKey` | function | 94 |
| 9 | `encryptOfflineVaultValue` | function | 111 |
| 10 | `decryptOfflineVaultValue` | function | 119 |
| 11 | `requestOfflinePersistentStorage` | function | 129 |
| 12 | `dispatchVaultLocked` | function | 136 |
| 13 | `scheduleOfflineVaultIdleLock` | function | 141 |
| 14 | `lockOfflineVault` | function | 147 |
| 15 | `unlockOfflineVault` | function | 154 |
| 16 | `queueBusinessOutboxOperation` | function | 179 |
| 17 | `queueOfflineFileChunks` | function | 217 |
| 18 | `dispatchOutboxProgress` | function | 270 |
| 19 | `dispatchOutboxFileProgress` | function | 277 |
| 20 | `dispatchOutboxConflict` | function | 284 |
| 21 | `getSyncOutboxKey` | function | 291 |
| 22 | `syncUnlockedOfflineOutbox` | function | 295 |
| 23 | `syncUnlockedOfflineFileChunks` | function | 404 |
| 24 | `registerOutboxBackgroundSync` | function | 462 |
| 25 | `refreshOfflineSnapshotSoon` | function | 474 |
| 26 | `run` | const arrow | 484 |
| 27 | `refreshServiceWorkerSoon` | function | 503 |
| 28 | `runOfflineMaintenance` | function | 513 |
| 29 | `startOfflineMaintenanceLoop` | function | 525 |
| 30 | `forwardServiceWorkerOutboxEvent` | function | 533 |
| 31 | `forwardServiceWorkerAppEvent` | function | 627 |

### 3.386 `frontend/tailwind.config.mjs`

- No top-level named symbols detected.

### 3.387 `frontend/tests/actionGuards.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 13 |

### 3.388 `frontend/tests/actionStability.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readFrontend` | function | 10 |
| 2 | `readRepo` | function | 14 |
| 3 | `runTest` | function | 20 |

### 3.389 `frontend/tests/adminShellMediaGuards.test.mjs`

- No top-level named symbols detected.

### 3.390 `frontend/tests/apiHttp.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 21 |
| 2 | `createDeferredResponse` | function | 32 |
| 3 | `resetApiState` | function | 43 |

### 3.391 `frontend/tests/appRefresh.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `testNormalizeRefreshChannels` | function | 5 |
| 2 | `testRefreshAppDataDispatchesMergedDetail` | function | 12 |

### 3.392 `frontend/tests/appShellUtils.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.393 `frontend/tests/assetCompression.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `collectMediaFiles` | function | 11 |

### 3.394 `frontend/tests/backupJobs.test.mjs`

- No top-level named symbols detected.

### 3.395 `frontend/tests/barcodeImageScanner.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.396 `frontend/tests/barcodeScannerState.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.397 `frontend/tests/bulkOps.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.398 `frontend/tests/contactImportWorker.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 7 |

### 3.399 `frontend/tests/csvImport.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 7 |

### 3.400 `frontend/tests/dashboardDataReliability.test.mjs`

- No top-level named symbols detected.

### 3.401 `frontend/tests/dateHelpers.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |
| 2 | `parseLocalDate` | function | 17 |

### 3.402 `frontend/tests/deviceInfo.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |
| 2 | `withNavigator` | function | 17 |

### 3.403 `frontend/tests/exportPackages.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.404 `frontend/tests/formatters.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.405 `frontend/tests/globalScroll.test.mjs`

- No top-level named symbols detected.

### 3.406 `frontend/tests/globalScrollControls.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.407 `frontend/tests/groupedRecords.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.408 `frontend/tests/historyHelpers.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 10 |

### 3.409 `frontend/tests/importJobRefresh.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `testProductImportChannels` | function | 9 |
| 2 | `testSupplierImportChannels` | function | 16 |
| 3 | `testDispatchOnlyOnTerminalTransition` | function | 23 |
| 4 | `testDispatchEmitsExpectedEvents` | function | 47 |

### 3.410 `frontend/tests/initials.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |

### 3.411 `frontend/tests/inventoryImportWorker.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 7 |

### 3.412 `frontend/tests/inventoryMobileCardLayout.test.mjs`

- No top-level named symbols detected.

### 3.413 `frontend/tests/inventoryMovementGroups.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.414 `frontend/tests/inventoryRfidSection.test.mjs`

- No top-level named symbols detected.

### 3.415 `frontend/tests/jsxSyntaxCheck.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `listSourceFiles` | function | 10 |

### 3.416 `frontend/tests/loaders.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.417 `frontend/tests/mediaUploadHelpers.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.418 `frontend/tests/navigationConfig.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.419 `frontend/tests/notificationBadge.test.mjs`

- No top-level named symbols detected.

### 3.420 `frontend/tests/offlineSalesQueue.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.421 `frontend/tests/offlineSecurityHardening.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.422 `frontend/tests/offlineSyncArchitecture.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.423 `frontend/tests/ownedGoogleAuth.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.424 `frontend/tests/performanceLoadingUx.test.mjs`

- No top-level named symbols detected.

### 3.425 `frontend/tests/permissionEditor.test.mjs`

- No top-level named symbols detected.

### 3.426 `frontend/tests/permissions.test.mjs`

- No top-level named symbols detected.

### 3.427 `frontend/tests/portalCatalogDisplay.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 18 |
| 2 | `copy` | const arrow | 29 |
| 3 | `formatPortalPrice` | const arrow | 30 |

### 3.428 `frontend/tests/portalContentI18n.test.mjs`

- No top-level named symbols detected.

### 3.429 `frontend/tests/portalEditorUtils.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |

### 3.430 `frontend/tests/portalFaqVocabulary.test.mjs`

- No top-level named symbols detected.

### 3.431 `frontend/tests/portalLanguagePacks.test.mjs`

- No top-level named symbols detected.

### 3.432 `frontend/tests/portalTranslateController.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createStorage` | function | 17 |
| 2 | `createDocument` | function | 32 |

### 3.433 `frontend/tests/posCore.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 15 |

### 3.434 `frontend/tests/pricingContacts.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 13 |

### 3.435 `frontend/tests/productBatches.test.mjs`

- No top-level named symbols detected.

### 3.436 `frontend/tests/productDiscountUx.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.437 `frontend/tests/productDisplayHelpers.test.mjs`

- No top-level named symbols detected.

### 3.438 `frontend/tests/productFilterHelpers.test.mjs`

- No top-level named symbols detected.

### 3.439 `frontend/tests/productGalleryHelpers.test.mjs`

- No top-level named symbols detected.

### 3.440 `frontend/tests/productGrouping.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.441 `frontend/tests/productGroupViewHelpers.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fmtUSD` | const arrow | 7 |
| 2 | `t` | const arrow | 8 |

### 3.442 `frontend/tests/productHistoryHelpers.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.443 `frontend/tests/productImportPlanner.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 7 |

### 3.444 `frontend/tests/productImportWorkerFallback.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 7 |

### 3.445 `frontend/tests/productMenuHelpers.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `exportProductsCsv` | const arrow | 10 |
| 2 | `tr` | const arrow | 11 |
| 3 | `action` | const arrow | 88 |

### 3.446 `frontend/tests/productPageHelpers.test.mjs`

- No top-level named symbols detected.

### 3.447 `frontend/tests/productSearchPagination.test.mjs`

- No top-level named symbols detected.

### 3.448 `frontend/tests/productSelectionHelpers.test.mjs`

- No top-level named symbols detected.

### 3.449 `frontend/tests/productWriteHelpers.test.mjs`

- No top-level named symbols detected.

### 3.450 `frontend/tests/publicErrorRecovery.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createStorage` | function | 8 |

### 3.451 `frontend/tests/receiptSettingsSync.test.mjs`

- No top-level named symbols detected.

### 3.452 `frontend/tests/receiptTemplate.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.453 `frontend/tests/returnsLayout.test.mjs`

- No top-level named symbols detected.

### 3.454 `frontend/tests/runtimeErrorClassifier.test.mjs`

- No top-level named symbols detected.

### 3.455 `frontend/tests/salesImportWorker.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 7 |

### 3.456 `frontend/tests/scanbotScanner.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `setNavigator` | function | 8 |
| 2 | `run` | function | 16 |

### 3.457 `frontend/tests/scriptTypography.test.mjs`

- No top-level named symbols detected.

### 3.458 `frontend/tests/sectionNavigation.test.mjs`

- No top-level named symbols detected.

### 3.459 `frontend/tests/settingsConflictHelpers.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.460 `frontend/tests/settingsRefresh.test.mjs`

- No top-level named symbols detected.

### 3.461 `frontend/tests/storagePolicy.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 13 |

### 3.462 `frontend/tests/utilsSettingsBarrel.test.mjs`

- No top-level named symbols detected.

### 3.463 `frontend/vite.config.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readGitRevision` | function | 8 |
| 2 | `fixCrossorigin` | function | 46 |
| 3 | `emitBuildManifest` | function | 71 |
| 4 | `shouldDeferModulePreload` | function | 112 |
| 5 | `manualChunks` | function | 116 |

### 3.464 `ops/scripts/architecture/generated-bulk-audit.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizePath` | function | 150 |
| 2 | `formatBytes` | function | 154 |
| 3 | `parseArgs` | function | 166 |
| 4 | `mapLimit` | function | 180 |
| 5 | `worker` | function | 183 |
| 6 | `pathStats` | function | 195 |
| 7 | `readText` | function | 245 |
| 8 | `readJsonFile` | function | 253 |
| 9 | `hasAnyToken` | function | 262 |
| 10 | `toPowerShellTargetToken` | function | 266 |
| 11 | `markdownTable` | function | 270 |
| 12 | `compactTargetRows` | function | 278 |
| 13 | `compactTimedRows` | function | 293 |
| 14 | `isNestedTarget` | function | 309 |
| 15 | `collectTargetOverlaps` | function | 315 |
| 16 | `buildSummary` | function | 331 |
| 17 | `renderReport` | function | 388 |
| 18 | `main` | function | 464 |

### 3.465 `ops/scripts/architecture/language-runtime-audit.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizePath` | function | 31 |
| 2 | `pathExists` | function | 35 |
| 3 | `readJson` | function | 44 |
| 4 | `walkFiles` | function | 52 |
| 5 | `countBy` | function | 74 |
| 6 | `hasReactOrDomBoundary` | function | 83 |
| 7 | `hasWorkerCandidateWork` | function | 87 |
| 8 | `hasSqlOrAnalyticsWork` | function | 91 |
| 9 | `scoreTypeScriptCandidate` | function | 95 |
| 10 | `scoreWorkerCandidate` | function | 109 |
| 11 | `scoreSqlCandidate` | function | 119 |
| 12 | `compactCandidates` | function | 128 |
| 13 | `verificationMatrix` | function | 136 |
| 14 | `buildFirstExecutableSlices` | function | 174 |
| 15 | `collectFocusedTestCoverage` | function | 855 |
| 16 | `collectConvertedTypeScriptSlices` | function | 870 |
| 17 | `collectCompletedWebWorkerSlices` | function | 885 |
| 18 | `collectProofCommandCoverage` | function | 903 |
| 19 | `collectRecords` | function | 957 |
| 20 | `markdownTable` | function | 974 |
| 21 | `renderReport` | function | 982 |
| 22 | `buildSummary` | function | 1117 |
| 23 | `main` | function | 1184 |

### 3.466 `ops/scripts/architecture/organization-audit.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizePath` | function | 22 |
| 2 | `pathExists` | function | 26 |
| 3 | `walkFiles` | function | 35 |
| 4 | `getArea` | function | 56 |
| 5 | `countBy` | function | 87 |
| 6 | `extractRelativeImports` | function | 96 |
| 7 | `mapLimit` | function | 111 |
| 8 | `worker` | function | 114 |
| 9 | `collectFileRecords` | function | 126 |
| 10 | `nonEmptyLines` | function | 160 |
| 11 | `extractWrapperTarget` | function | 164 |
| 12 | `collectCompatibilityWrappers` | function | 177 |
| 13 | `countOccurrences` | function | 200 |
| 14 | `wrapperReferenceCandidates` | function | 211 |
| 15 | `collectWrapperReferenceDetails` | function | 231 |
| 16 | `markdownTable` | function | 258 |
| 17 | `renderReferenceFiles` | function | 264 |
| 18 | `renderReport` | function | 272 |
| 19 | `buildSummary` | function | 361 |
| 20 | `main` | function | 387 |

### 3.467 `ops/scripts/architecture/phase29-audit.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseArgs` | function | 52 |
| 2 | `normalizePath` | function | 69 |
| 3 | `parseLastJsonObject` | function | 73 |
| 4 | `markdownTable` | function | 85 |
| 5 | `stableDigest` | function | 93 |
| 6 | `summarizeReportValue` | function | 97 |
| 7 | `outputTail` | function | 111 |
| 8 | `pathExists` | function | 118 |
| 9 | `runCheck` | function | 127 |
| 10 | `flattenCycles` | function | 160 |
| 11 | `buildDurationSummary` | function | 164 |
| 12 | `renderReport` | function | 199 |
| 13 | `comparableValue` | function | 284 |
| 14 | `collectParsedByCycle` | function | 291 |
| 15 | `buildRepeatConsistency` | function | 297 |
| 16 | `buildSummary` | function | 448 |
| 17 | `main` | function | 483 |

### 3.468 `ops/scripts/backend/schema-audit.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `read` | function | 33 |
| 2 | `uniqueSorted` | function | 37 |
| 3 | `getLineNumber` | function | 41 |
| 4 | `matchAllWithLine` | function | 45 |
| 5 | `parseSqlTables` | function | 54 |
| 6 | `parseColumns` | function | 76 |
| 7 | `parsePrimaryKey` | function | 93 |
| 8 | `cleanColumnList` | function | 116 |
| 9 | `parseIndexes` | function | 123 |
| 10 | `parseRuntimeStatements` | function | 140 |
| 11 | `uniqueRuntimeRows` | function | 176 |
| 12 | `parseDexieStores` | function | 188 |
| 13 | `loadBackupSchema` | function | 209 |
| 14 | `countForeignKeyDeclarations` | function | 215 |
| 15 | `buildCoverage` | function | 222 |
| 16 | `buildBackupCoverage` | function | 231 |
| 17 | `renderList` | function | 253 |
| 18 | `renderRuntimeRows` | function | 258 |
| 19 | `renderTableCatalog` | function | 263 |
| 20 | `renderReport` | function | 269 |
| 21 | `buildSummary` | function | 352 |
| 22 | `main` | function | 378 |

### 3.469 `ops/scripts/backend/verify-data-integrity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseEnvFile` | function | 23 |
| 2 | `fail` | function | 41 |
| 3 | `pass` | function | 46 |
| 4 | `approxEqual` | function | 50 |
| 5 | `stripTrailingSemicolon` | function | 54 |
| 6 | `runPsql` | function | 58 |
| 7 | `queryRows` | function | 80 |
| 8 | `queryOne` | function | 89 |
| 9 | `execSql` | function | 93 |
| 10 | `sqlString` | function | 97 |
| 11 | `checkNoNegativeStock` | function | 101 |
| 12 | `checkProductStockMatchesBranches` | function | 110 |
| 13 | `checkSaleItemTotals` | function | 155 |
| 14 | `checkReturnDoesNotExceedSold` | function | 165 |
| 15 | `checkProfitFormulaConsistency` | function | 188 |
| 16 | `checkCogsSnapshotVsCurrentProductCost` | function | 224 |
| 17 | `checkPostgresRuntimeTables` | function | 245 |
| 18 | `run` | function | 274 |

### 3.470 `ops/scripts/frontend/verify-i18n.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `collectUsedKeys` | function | 29 |
| 2 | `flattenTranslationTree` | function | 69 |
| 3 | `listMissing` | function | 83 |
| 4 | `listEmptyValues` | function | 88 |
| 5 | `printList` | function | 95 |
| 6 | `main` | function | 102 |

### 3.471 `ops/scripts/frontend/verify-performance.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `read` | function | 15 |
| 2 | `walk` | function | 19 |
| 3 | `trackedFiles` | function | 37 |
| 4 | `assert` | function | 47 |

### 3.472 `ops/scripts/frontend/verify-ui.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readText` | function | 61 |
| 2 | `readJson` | function | 65 |
| 3 | `flatten` | function | 69 |
| 4 | `walkFiles` | function | 82 |
| 5 | `isIntentionalLatin` | function | 94 |
| 6 | `report` | function | 102 |
| 7 | `checkKhmerQuality` | function | 108 |
| 8 | `checkPortalDarkModeContracts` | function | 132 |
| 9 | `checkPortalVisibleStrings` | function | 154 |
| 10 | `checkFormControlLabels` | function | 176 |
| 11 | `checkVerificationWiring` | function | 196 |
| 12 | `printAuditSummary` | function | 209 |
| 13 | `main` | function | 227 |

### 3.473 `ops/scripts/lib/fs-utils.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toPosix` | function | 16 |
| 2 | `resolveProjectRoot` | function | 20 |
| 3 | `relFrom` | function | 35 |
| 4 | `readUtf8` | function | 42 |
| 5 | `readJson` | function | 50 |
| 6 | `lineCount` | function | 58 |
| 7 | `shouldSkipDirectory` | function | 66 |
| 8 | `walkFilesRecursive` | function | 70 |
| 9 | `collectFilesAndFolders` | function | 97 |
| 10 | `collectRootFiles` | function | 126 |
| 11 | `isProbablyText` | function | 145 |

### 3.474 `ops/scripts/runtime/audits/audit-auth.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSetCookieHeaders` | function | 3 |
| 2 | `extractSessionCookie` | function | 12 |
| 3 | `buildBrowserStorageState` | export function | 22 |
| 4 | `loginWithFetch` | export function | 30 |
| 5 | `applySessionToPlaywrightContext` | export function | 95 |
| 6 | `hydratePlaywrightPage` | export function | 117 |

### 3.475 `ops/scripts/runtime/audits/audit-manifest.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getRouteManifest` | export function | 192 |
| 2 | `getAuditProfiles` | export function | 210 |

### 3.476 `ops/scripts/runtime/audits/audit-report-html.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `escapeHtml` | function | 4 |
| 2 | `formatMs` | function | 13 |
| 3 | `formatCls` | function | 19 |
| 4 | `formatCount` | function | 25 |
| 5 | `formatBytes` | function | 30 |
| 6 | `toRelativeLink` | function | 38 |
| 7 | `inferHotPath` | function | 44 |
| 8 | `renderFindings` | function | 64 |
| 9 | `renderSummaryCards` | function | 88 |
| 10 | `writeDeepAuditHtmlReport` | export function | 103 |
| 11 | `writeFullAuditHtmlReport` | export function | 221 |

### 3.477 `ops/scripts/runtime/audits/deep-live-audit.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readArg` | function | 71 |
| 2 | `safeName` | function | 78 |
| 3 | `escapeRegExp` | function | 82 |
| 4 | `addFinding` | function | 86 |
| 5 | `assetFileName` | function | 95 |
| 6 | `getScriptBudgetBytes` | function | 103 |
| 7 | `isFailingFinding` | function | 124 |
| 8 | `appOwnedUrl` | function | 128 |
| 9 | `externalNoise` | function | 138 |
| 10 | `isAppConsoleIssue` | function | 142 |
| 11 | `isNavigationAbort` | function | 149 |
| 12 | `writeJson` | function | 156 |
| 13 | `requestJson` | function | 160 |
| 14 | `runCommand` | function | 181 |
| 15 | `captureHealth` | function | 218 |
| 16 | `runFullApiAudit` | function | 234 |
| 17 | `primeDirectRouteProbeMap` | function | 304 |
| 18 | `loginForAudit` | function | 343 |
| 19 | `isLoginScreen` | function | 357 |
| 20 | `ensureAuditLogin` | function | 363 |
| 21 | `installPerfObservers` | function | 397 |
| 22 | `bosSelectorFor` | const arrow | 399 |
| 23 | `createBrowserHarness` | function | 501 |
| 24 | `createContext` | const arrow | 505 |
| 25 | `attachCollectors` | function | 516 |
| 26 | `resetBrowserState` | function | 604 |
| 27 | `waitForRouteReady` | function | 620 |
| 28 | `collectPerfSnapshot` | function | 647 |
| 29 | `saveScreenshot` | function | 707 |
| 30 | `performSearchInteraction` | function | 714 |
| 31 | `dismissTransientUi` | function | 749 |
| 32 | `clickNamedButton` | function | 767 |
| 33 | `clickTestIdButton` | function | 802 |
| 34 | `runRouteInteractions` | function | 842 |
| 35 | `analyzeRoute` | function | 856 |
| 36 | `auditRoute` | function | 955 |
| 37 | `auditBrowserProfile` | function | 1151 |
| 38 | `runIsolatedRoute` | const arrow | 1176 |
| 39 | `auditRemoteReadOnly` | function | 1209 |
| 40 | `captureDockerStateAndLogs` | function | 1247 |
| 41 | `compareWithPreviousBaseline` | function | 1295 |
| 42 | `main` | function | 1343 |

### 3.478 `ops/scripts/runtime/audits/full-app-audit.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `wait` | function | 40 |
| 2 | `pushFinding` | function | 44 |
| 3 | `assert` | function | 53 |
| 4 | `isJsonResponse` | function | 57 |
| 5 | `fetchWithTimeout` | function | 61 |
| 6 | `request` | function | 71 |
| 7 | `recordApi` | function | 110 |
| 8 | `login` | function | 128 |
| 9 | `captureHealth` | function | 141 |
| 10 | `auditHtmlRoutes` | function | 155 |
| 11 | `auditReadEndpoints` | function | 182 |
| 12 | `getActiveBranches` | function | 216 |
| 13 | `runFefoWriteFlow` | function | 225 |
| 14 | `runImportFlow` | function | 380 |
| 15 | `tinyPngBytes` | function | 430 |
| 16 | `runFilesFlow` | function | 437 |
| 17 | `runBackupFlow` | function | 452 |
| 18 | `pollSystemJob` | function | 489 |
| 19 | `auditRemotePublic` | function | 502 |
| 20 | `writeSummary` | function | 537 |
| 21 | `main` | function | 548 |

### 3.479 `ops/scripts/runtime/cloudflare/rotate-cloudflare-tunnel-token.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readEnvFile` | function | 15 |
| 2 | `readEnv` | function | 30 |
| 3 | `parseArgs` | function | 34 |
| 4 | `readSecret` | function | 54 |
| 5 | `writeSecret` | function | 58 |
| 6 | `ensureIngress` | function | 63 |
| 7 | `extractTunnelToken` | function | 73 |
| 8 | `getCloudflareError` | function | 81 |
| 9 | `readCurrentTunnel` | function | 87 |
| 10 | `readTunnelConfig` | function | 95 |
| 11 | `rotateTunnelSecret` | function | 103 |
| 12 | `fetchTunnelToken` | function | 114 |
| 13 | `updateTunnelIngress` | function | 124 |
| 14 | `disconnectTunnelConnections` | function | 142 |
| 15 | `main` | function | 150 |
| 16 | `requestJson` | function | 205 |

### 3.480 `ops/scripts/runtime/cloudflare/update-cloudflare-tunnel-origin.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readEnvFile` | function | 10 |
| 2 | `parseArgs` | function | 25 |
| 3 | `readToken` | function | 36 |
| 4 | `ensureIngress` | function | 42 |
| 5 | `main` | function | 58 |
| 6 | `requestJson` | function | 103 |

### 3.481 `ops/scripts/runtime/cloudflare/verify-cloudflare-automation.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseArgs` | function | 10 |
| 2 | `readJson` | function | 20 |
| 3 | `readToken` | function | 24 |
| 4 | `cleanToken` | const arrow | 25 |
| 5 | `readAllowedEmails` | function | 31 |
| 6 | `requestJson` | function | 43 |
| 7 | `summarizeFailure` | function | 78 |
| 8 | `cloudflareErrors` | function | 85 |
| 9 | `assertSuccess` | function | 91 |
| 10 | `upsertAccessApp` | function | 98 |
| 11 | `getEntrypointRuleset` | function | 130 |
| 12 | `upsertEntrypointRuleset` | function | 136 |
| 13 | `tryApplyRuleset` | function | 155 |
| 14 | `applyCloudflareAutomation` | function | 166 |
| 15 | `main` | function | 209 |

### 3.482 `ops/scripts/runtime/cloudflare/verify-r2-object-store.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadEnvFile` | function | 20 |
| 2 | `readConfig` | function | 38 |
| 3 | `bodyToString` | function | 52 |
| 4 | `isMissingObjectError` | function | 60 |
| 5 | `main` | function | 66 |

### 3.483 `ops/scripts/runtime/live-checks/live-check-utils.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fetchJsonResponse` | function | 1 |
| 2 | `readJson` | export function | 17 |
| 3 | `readJsonStatus` | export function | 22 |
| 4 | `isIgnoredConsole` | export function | 28 |
| 5 | `attachConsoleCollector` | export function | 32 |
| 6 | `latestObservedStatus` | export function | 45 |
| 7 | `waitForRead` | export function | 50 |
| 8 | `closeTopModal` | export function | 62 |

### 3.484 `ops/scripts/runtime/live-checks/phase84-branches-actions-live-check.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 18 |
| 2 | `main` | function | 26 |

### 3.485 `ops/scripts/runtime/live-checks/phase84-contacts-live-check.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 18 |
| 2 | `main` | function | 26 |

### 3.486 `ops/scripts/runtime/live-checks/phase84-files-providers-actions-live-check.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 18 |
| 2 | `main` | function | 25 |

### 3.487 `ops/scripts/runtime/live-checks/phase84-inventory-actions-live-check.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 18 |
| 2 | `openFirstProductDetail` | function | 26 |
| 3 | `main` | function | 35 |

### 3.488 `ops/scripts/runtime/live-checks/phase84-product-brands-actions-live-check.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 18 |
| 2 | `verifiedContextGet` | function | 24 |
| 3 | `main` | function | 31 |

### 3.489 `ops/scripts/runtime/live-checks/phase84-product-categories-actions-live-check.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 18 |
| 2 | `main` | function | 25 |

### 3.490 `ops/scripts/runtime/live-checks/phase84-product-page-actions-live-check.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 18 |
| 2 | `openFirstActionMenu` | function | 25 |
| 3 | `main` | function | 34 |

### 3.491 `ops/scripts/runtime/live-checks/phase84-product-scanning-actions-live-check.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 19 |
| 2 | `main` | function | 26 |

### 3.492 `ops/scripts/runtime/live-checks/phase84-product-stock-actions-live-check.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 18 |
| 2 | `main` | function | 26 |

### 3.493 `ops/scripts/runtime/live-checks/phase84-product-units-actions-live-check.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 18 |
| 2 | `main` | function | 25 |

### 3.494 `ops/scripts/runtime/live-checks/phase84-product-variant-actions-live-check.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 18 |
| 2 | `openFirstVariantModal` | function | 25 |
| 3 | `main` | function | 42 |

### 3.495 `ops/scripts/runtime/live-checks/phase84-public-portal-cloudflare-check.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 14 |
| 2 | `isRelevantConsole` | function | 18 |
| 3 | `endpointStatus` | function | 22 |
| 4 | `main` | function | 26 |

### 3.496 `ops/scripts/runtime/live-checks/phase84-sales-actions-live-check.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 18 |
| 2 | `main` | function | 25 |

### 3.497 `ops/scripts/runtime/live-checks/phase84-ui-live-check.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 19 |
| 2 | `main` | function | 26 |

### 3.498 `ops/scripts/runtime/live-checks/phase84-users-actions-live-check.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 18 |
| 2 | `main` | function | 26 |

### 3.499 `ops/scripts/runtime/smoke/check-public-url.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeBaseUrl` | function | 8 |
| 2 | `normalizePath` | function | 14 |
| 3 | `fetchWithTimeout` | function | 21 |
| 4 | `isPrivateIpv4` | function | 38 |
| 5 | `isPrivateIpv6` | function | 50 |
| 6 | `shouldCheckPublicIngress` | function | 59 |
| 7 | `shouldRequirePublicIngress` | function | 71 |
| 8 | `fetchJsonWithTimeout` | function | 83 |
| 9 | `resolvePublicIngress` | function | 98 |
| 10 | `checkHttpsViaIp` | function | 123 |
| 11 | `main` | function | 160 |

### 3.500 `ops/scripts/runtime/smoke/check-route-contract.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fail` | function | 27 |
| 2 | `checkRoute` | function | 32 |
| 3 | `main` | function | 59 |

### 3.501 `ops/scripts/runtime/smoke/live-smoke.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 11 |
| 2 | `request` | function | 15 |
| 3 | `login` | function | 44 |
| 4 | `main` | function | 57 |
| 5 | `record` | const arrow | 61 |

### 3.502 `ops/scripts/runtime/storage/prune-storage.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseArgs` | function | 13 |
| 2 | `runDockerCommand` | function | 42 |
| 3 | `pruneDockerSafe` | function | 50 |
| 4 | `loadEnvFile` | function | 97 |
| 5 | `loadRuntimeEnv` | function | 115 |
| 6 | `assertInsideWorkspace` | function | 124 |
| 7 | `directoryBytes` | function | 133 |
| 8 | `pathBytes` | function | 159 |
| 9 | `pruneDirectoryChildren` | function | 168 |
| 10 | `pruneDirectoryEntries` | function | 172 |
| 11 | `findBackupRoots` | function | 209 |
| 12 | `main` | function | 223 |

### 3.503 `ops/scripts/verification/verify-backup-reliability.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `read` | function | 10 |
| 2 | `lineFor` | function | 14 |
| 3 | `requireText` | function | 20 |
| 4 | `forbidText` | function | 24 |
| 5 | `main` | function | 28 |

### 3.504 `ops/scripts/verification/verify-docker-release.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `read` | function | 38 |
| 2 | `rel` | function | 42 |
| 3 | `requireFile` | function | 46 |
| 4 | `requireToken` | function | 50 |
| 5 | `main` | function | 54 |

### 3.505 `ops/scripts/verification/verify-hardening-policy.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readJson` | function | 12 |
| 2 | `normalizeRelativePath` | function | 16 |
| 3 | `readText` | function | 20 |
| 4 | `readTextWithLocalImports` | function | 24 |
| 5 | `listTrackedFiles` | function | 38 |
| 6 | `lineFor` | function | 45 |
| 7 | `assertContains` | function | 51 |
| 8 | `assertNotContains` | function | 57 |
| 9 | `assertNoApiCachingRegression` | function | 63 |
| 10 | `assertFullAutomationIncludesPolicy` | function | 84 |
| 11 | `main` | function | 100 |

### 3.506 `ops/scripts/verification/verify-runtime-deps.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readJson` | function | 22 |
| 2 | `assertTrackedFile` | function | 26 |
| 3 | `hasLockDependency` | function | 32 |
| 4 | `main` | function | 38 |

### 3.507 `ops/scripts/verification/verify-scale-services.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ensureDir` | function | 18 |
| 2 | `run` | function | 22 |
| 3 | `firstExisting` | function | 40 |
| 4 | `whereDocker` | function | 44 |
| 5 | `resolveDocker` | function | 57 |
| 6 | `checkSecretIgnoreRules` | function | 67 |
| 7 | `trackedLicenses` | const arrow | 68 |
| 8 | `main` | function | 94 |

### 3.508 `ops/scripts/verification/verify-secret-hygiene.js`

- No top-level named symbols detected.

