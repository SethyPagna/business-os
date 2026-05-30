# All Function Reference (Project First-Party Code)

Auto-generated function/class symbol commentary for all first-party code files (frontend, backend, root scripts/config code).

## 1. Coverage Summary

Code files scanned: **467**

## 2. Symbol Count by File

| No. | File | Symbols |
|---:|---|---:|
| 1 | `backend/server.js` | 23 |
| 2 | `backend/src/accessControl.ts` | 18 |
| 3 | `backend/src/analytics/duckdbRuntime.ts` | 3 |
| 4 | `backend/src/authOtpGuards.ts` | 3 |
| 5 | `backend/src/backupSchema.ts` | 4 |
| 6 | `backend/src/businessMetrics.ts` | 9 |
| 7 | `backend/src/catalogTextIntegrity.ts` | 5 |
| 8 | `backend/src/config/index.js` | 11 |
| 9 | `backend/src/conflictControl.ts` | 6 |
| 10 | `backend/src/contactOptions.ts` | 10 |
| 11 | `backend/src/database.ts` | 0 |
| 12 | `backend/src/dataPath/index.ts` | 9 |
| 13 | `backend/src/db/cutoverReadiness.ts` | 10 |
| 14 | `backend/src/db/postgresQueryCompat.ts` | 12 |
| 15 | `backend/src/fileAssets.js` | 61 |
| 16 | `backend/src/helpers.js` | 30 |
| 17 | `backend/src/idempotency.ts` | 1 |
| 18 | `backend/src/importCsv.ts` | 16 |
| 19 | `backend/src/importParsing.ts` | 6 |
| 20 | `backend/src/initials.ts` | 7 |
| 21 | `backend/src/maintenanceLock.ts` | 9 |
| 22 | `backend/src/middleware.js` | 21 |
| 23 | `backend/src/money.ts` | 3 |
| 24 | `backend/src/netSecurity.ts` | 7 |
| 25 | `backend/src/objectStore.js` | 29 |
| 26 | `backend/src/optionalSharp.ts` | 1 |
| 27 | `backend/src/organizationContext/index.js` | 14 |
| 28 | `backend/src/permissions.ts` | 7 |
| 29 | `backend/src/portalUtils.ts` | 6 |
| 30 | `backend/src/postgresDatabase.js` | 14 |
| 31 | `backend/src/productBatches.js` | 34 |
| 32 | `backend/src/productDiscounts.ts` | 9 |
| 33 | `backend/src/productImportPolicies.ts` | 10 |
| 34 | `backend/src/requestContext.ts` | 5 |
| 35 | `backend/src/routes/actionHistory.js` | 12 |
| 36 | `backend/src/routes/ai.js` | 3 |
| 37 | `backend/src/routes/auth.js` | 31 |
| 38 | `backend/src/routes/branches.js` | 10 |
| 39 | `backend/src/routes/catalog.ts` | 4 |
| 40 | `backend/src/routes/categories.js` | 2 |
| 41 | `backend/src/routes/contacts.js` | 34 |
| 42 | `backend/src/routes/customTables.js` | 9 |
| 43 | `backend/src/routes/files.js` | 3 |
| 44 | `backend/src/routes/importJobs.js` | 16 |
| 45 | `backend/src/routes/inventory.js` | 32 |
| 46 | `backend/src/routes/notifications.js` | 27 |
| 47 | `backend/src/routes/organizations.ts` | 0 |
| 48 | `backend/src/routes/portal.js` | 60 |
| 49 | `backend/src/routes/products.js` | 64 |
| 50 | `backend/src/routes/returns.js` | 10 |
| 51 | `backend/src/routes/runtime.js` | 6 |
| 52 | `backend/src/routes/sales.js` | 24 |
| 53 | `backend/src/routes/settings.js` | 8 |
| 54 | `backend/src/routes/sync.js` | 12 |
| 55 | `backend/src/routes/system/index.js` | 44 |
| 56 | `backend/src/routes/units.js` | 3 |
| 57 | `backend/src/routes/users.js` | 26 |
| 58 | `backend/src/runtimeCache.ts` | 12 |
| 59 | `backend/src/runtimeState/index.ts` | 6 |
| 60 | `backend/src/runtimeVersion.ts` | 8 |
| 61 | `backend/src/schemaMetadata.ts` | 9 |
| 62 | `backend/src/security.ts` | 14 |
| 63 | `backend/src/serverUtils.js` | 26 |
| 64 | `backend/src/services/aiGateway.js` | 17 |
| 65 | `backend/src/services/backupPackages.js` | 59 |
| 66 | `backend/src/services/firebaseAuth.js` | 22 |
| 67 | `backend/src/services/googleDriveSync/index.js` | 75 |
| 68 | `backend/src/services/googleDriveSync/versioning.ts` | 7 |
| 69 | `backend/src/services/googleOauth.js` | 17 |
| 70 | `backend/src/services/importJobs.js` | 175 |
| 71 | `backend/src/services/integrationDoctor.js` | 14 |
| 72 | `backend/src/services/mediaQueue.js` | 10 |
| 73 | `backend/src/services/portalAi.js` | 42 |
| 74 | `backend/src/services/verification.js` | 21 |
| 75 | `backend/src/sessionAuth.js` | 13 |
| 76 | `backend/src/settingsSnapshot.ts` | 12 |
| 77 | `backend/src/storage/organizationFolders.ts` | 5 |
| 78 | `backend/src/systemFsWorker.ts` | 7 |
| 79 | `backend/src/systemJobs.js` | 28 |
| 80 | `backend/src/uploadReferenceCleanup.js` | 3 |
| 81 | `backend/src/uploadSecurity.ts` | 7 |
| 82 | `backend/src/websocket.js` | 1 |
| 83 | `backend/src/workers/importWorker.ts` | 2 |
| 84 | `backend/src/workers/mediaWorker.ts` | 2 |
| 85 | `backend/test/accessControl.test.ts` | 2 |
| 86 | `backend/test/analyticsRuntime.test.ts` | 1 |
| 87 | `backend/test/authOtpGuards.test.ts` | 1 |
| 88 | `backend/test/authSecurityFlow.test.ts` | 14 |
| 89 | `backend/test/backupDefaultDestination.test.ts` | 0 |
| 90 | `backend/test/backupPerformanceHardening.test.ts` | 1 |
| 91 | `backend/test/backupRetention.test.ts` | 1 |
| 92 | `backend/test/backupSchema.test.ts` | 1 |
| 93 | `backend/test/branchStockSearch.test.ts` | 10 |
| 94 | `backend/test/contactOptions.test.ts` | 1 |
| 95 | `backend/test/dataPath.test.ts` | 2 |
| 96 | `backend/test/defaultRoles.test.ts` | 8 |
| 97 | `backend/test/fileAssetStorageReconcile.test.ts` | 1 |
| 98 | `backend/test/fileAssetUsageCache.test.ts` | 1 |
| 99 | `backend/test/fileRouteSecurityFlow.test.ts` | 9 |
| 100 | `backend/test/fullAutomation.test.ts` | 2 |
| 101 | `backend/test/googleDriveSyncVersioning.test.ts` | 1 |
| 102 | `backend/test/idempotency.test.ts` | 1 |
| 103 | `backend/test/importCsv.test.ts` | 2 |
| 104 | `backend/test/importDecisionIntegrity.test.ts` | 0 |
| 105 | `backend/test/importJobPerformanceHardening.test.ts` | 1 |
| 106 | `backend/test/importJobStateMachine.test.ts` | 4 |
| 107 | `backend/test/importScaleSmoke.test.ts` | 3 |
| 108 | `backend/test/initials.test.ts` | 0 |
| 109 | `backend/test/integrationDoctor.test.ts` | 1 |
| 110 | `backend/test/inventorySettingsMediaContracts.test.ts` | 2 |
| 111 | `backend/test/mediaOptimization.test.ts` | 3 |
| 112 | `backend/test/netSecurity.test.ts` | 1 |
| 113 | `backend/test/notificationSummaryCache.test.ts` | 1 |
| 114 | `backend/test/offlineSecurity.test.ts` | 2 |
| 115 | `backend/test/ownedGoogleAuth.test.ts` | 2 |
| 116 | `backend/test/permissionPolicy.test.ts` | 0 |
| 117 | `backend/test/portalInventoryRegression.test.ts` | 2 |
| 118 | `backend/test/portalUtils.test.ts` | 1 |
| 119 | `backend/test/postgresCutoverReadiness.test.ts` | 1 |
| 120 | `backend/test/postgresDatabase.test.ts` | 3 |
| 121 | `backend/test/postgresQueryCompat.test.ts` | 1 |
| 122 | `backend/test/productBatchHierarchy.test.ts` | 2 |
| 123 | `backend/test/productExpiry.test.ts` | 1 |
| 124 | `backend/test/productImportPolicies.test.ts` | 1 |
| 125 | `backend/test/productSearchPagination.test.ts` | 0 |
| 126 | `backend/test/rfidRoutes.test.ts` | 1 |
| 127 | `backend/test/routeContracts.test.ts` | 2 |
| 128 | `backend/test/runtimeCache.test.ts` | 2 |
| 129 | `backend/test/runtimeVersion.test.ts` | 1 |
| 130 | `backend/test/schemaMetadata.test.ts` | 3 |
| 131 | `backend/test/security.test.ts` | 1 |
| 132 | `backend/test/serverUtils.test.ts` | 2 |
| 133 | `backend/test/settingsSnapshotObjectStorage.test.ts` | 4 |
| 134 | `backend/test/systemJobs.test.ts` | 3 |
| 135 | `backend/test/uploadSecurity.test.ts` | 1 |
| 136 | `frontend/public/runtime-noise-guard.js` | 6 |
| 137 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.js` | 0 |
| 138 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.worker.js` | 0 |
| 139 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd-threads.js` | 0 |
| 140 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd.js` | 0 |
| 141 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core.js` | 0 |
| 142 | `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js` | 0 |
| 143 | `frontend/public/sw.js` | 24 |
| 144 | `frontend/public/theme-bootstrap.js` | 10 |
| 145 | `frontend/src/api/http.ts` | 62 |
| 146 | `frontend/src/api/localDb.ts` | 10 |
| 147 | `frontend/src/api/methods.ts` | 233 |
| 148 | `frontend/src/api/websocket.ts` | 11 |
| 149 | `frontend/src/App.tsx` | 68 |
| 150 | `frontend/src/app/appShellUtils.ts` | 10 |
| 151 | `frontend/src/app/publicErrorRecovery.ts` | 4 |
| 152 | `frontend/src/AppContext.tsx` | 39 |
| 153 | `frontend/src/components/auth/Login.tsx` | 23 |
| 154 | `frontend/src/components/branches/Branches.tsx` | 15 |
| 155 | `frontend/src/components/branches/BranchForm.tsx` | 2 |
| 156 | `frontend/src/components/branches/TransferModal.tsx` | 6 |
| 157 | `frontend/src/components/catalog/CatalogEditorSurface.tsx` | 1 |
| 158 | `frontend/src/components/catalog/CatalogImageField.tsx` | 1 |
| 159 | `frontend/src/components/catalog/CatalogPage.tsx` | 117 |
| 160 | `frontend/src/components/catalog/CatalogPageContext.tsx` | 1 |
| 161 | `frontend/src/components/catalog/CatalogPreviewSurface.tsx` | 2 |
| 162 | `frontend/src/components/catalog/CatalogProductsSection.tsx` | 4 |
| 163 | `frontend/src/components/catalog/CatalogSecondaryTabs.tsx` | 6 |
| 164 | `frontend/src/components/catalog/catalogUi.tsx` | 4 |
| 165 | `frontend/src/components/catalog/portalCatalogDisplay.ts` | 9 |
| 166 | `frontend/src/components/catalog/portalContentI18n.ts` | 18 |
| 167 | `frontend/src/components/catalog/portalEditorUtils.ts` | 10 |
| 168 | `frontend/src/components/catalog/portalLanguagePacks.ts` | 3 |
| 169 | `frontend/src/components/catalog/portalTranslateController.ts` | 17 |
| 170 | `frontend/src/components/contacts/ContactImportModal.tsx` | 8 |
| 171 | `frontend/src/components/contacts/contactImportWorker.ts` | 1 |
| 172 | `frontend/src/components/contacts/contactOptionUtils.ts` | 10 |
| 173 | `frontend/src/components/contacts/Contacts.tsx` | 11 |
| 174 | `frontend/src/components/contacts/CustomerFormModal.tsx` | 10 |
| 175 | `frontend/src/components/contacts/customerMembershipNumber.ts` | 1 |
| 176 | `frontend/src/components/contacts/CustomersTab.tsx` | 18 |
| 177 | `frontend/src/components/contacts/DeliveryTab.tsx` | 27 |
| 178 | `frontend/src/components/contacts/shared.tsx` | 6 |
| 179 | `frontend/src/components/contacts/SuppliersTab.tsx` | 20 |
| 180 | `frontend/src/components/custom-tables/CustomTables.tsx` | 19 |
| 181 | `frontend/src/components/dashboard/charts/BarChart.tsx` | 5 |
| 182 | `frontend/src/components/dashboard/charts/DonutChart.tsx` | 1 |
| 183 | `frontend/src/components/dashboard/charts/index.ts` | 0 |
| 184 | `frontend/src/components/dashboard/charts/LineChart.tsx` | 7 |
| 185 | `frontend/src/components/dashboard/charts/NoData.tsx` | 1 |
| 186 | `frontend/src/components/dashboard/Dashboard.tsx` | 18 |
| 187 | `frontend/src/components/dashboard/MiniStat.tsx` | 1 |
| 188 | `frontend/src/components/files/FilePickerModal.tsx` | 8 |
| 189 | `frontend/src/components/files/FilesPage.tsx` | 27 |
| 190 | `frontend/src/components/files/FilesProvidersTab.tsx` | 2 |
| 191 | `frontend/src/components/files/FilesResponsesTab.tsx` | 1 |
| 192 | `frontend/src/components/inventory/DualMoney.tsx` | 1 |
| 193 | `frontend/src/components/inventory/Inventory.tsx` | 23 |
| 194 | `frontend/src/components/inventory/InventoryImportModal.tsx` | 9 |
| 195 | `frontend/src/components/inventory/inventoryImportWorker.ts` | 1 |
| 196 | `frontend/src/components/inventory/InventoryMovementsSurface.tsx` | 1 |
| 197 | `frontend/src/components/inventory/InventoryProductsSurface.tsx` | 3 |
| 198 | `frontend/src/components/inventory/InventoryRfidSurface.tsx` | 1 |
| 199 | `frontend/src/components/inventory/movementGroups.ts` | 15 |
| 200 | `frontend/src/components/inventory/ProductDetailModal.tsx` | 2 |
| 201 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx` | 10 |
| 202 | `frontend/src/components/navigation/Sidebar.tsx` | 9 |
| 203 | `frontend/src/components/pos/CartItem.tsx` | 2 |
| 204 | `frontend/src/components/pos/FilterPanel.tsx` | 5 |
| 205 | `frontend/src/components/pos/POS.tsx` | 36 |
| 206 | `frontend/src/components/pos/posCore.ts` | 10 |
| 207 | `frontend/src/components/pos/ProductImage.tsx` | 1 |
| 208 | `frontend/src/components/pos/QuickAddModal.tsx` | 2 |
| 209 | `frontend/src/components/products/config/productPageConfig.ts` | 0 |
| 210 | `frontend/src/components/products/forms/BranchStockAdjuster.tsx` | 6 |
| 211 | `frontend/src/components/products/forms/BulkAddStockModal.tsx` | 6 |
| 212 | `frontend/src/components/products/forms/ProductForm.tsx` | 18 |
| 213 | `frontend/src/components/products/forms/VariantFormModal.tsx` | 3 |
| 214 | `frontend/src/components/products/helpers/productDisplayHelpers.ts` | 6 |
| 215 | `frontend/src/components/products/helpers/productFilterHelpers.ts` | 9 |
| 216 | `frontend/src/components/products/helpers/productGalleryHelpers.ts` | 8 |
| 217 | `frontend/src/components/products/helpers/productGroupViewHelpers.ts` | 2 |
| 218 | `frontend/src/components/products/helpers/productMenuHelpers.ts` | 5 |
| 219 | `frontend/src/components/products/helpers/productPageHelpers.ts` | 3 |
| 220 | `frontend/src/components/products/helpers/productSelectionHelpers.ts` | 7 |
| 221 | `frontend/src/components/products/helpers/productWriteHelpers.ts` | 18 |
| 222 | `frontend/src/components/products/history/productHistoryHelpers.ts` | 1 |
| 223 | `frontend/src/components/products/import/BulkImportModal.tsx` | 51 |
| 224 | `frontend/src/components/products/import/productImportPlanner.ts` | 18 |
| 225 | `frontend/src/components/products/import/productImportWorker.ts` | 3 |
| 226 | `frontend/src/components/products/lookups/ManageBrandsModal.tsx` | 9 |
| 227 | `frontend/src/components/products/lookups/ManageCategoriesModal.tsx` | 5 |
| 228 | `frontend/src/components/products/lookups/ManageUnitsModal.tsx` | 5 |
| 229 | `frontend/src/components/products/lookups/productLookupSnapshots.ts` | 10 |
| 230 | `frontend/src/components/products/Products.tsx` | 24 |
| 231 | `frontend/src/components/products/scanning/barcodeImageScanner.ts` | 5 |
| 232 | `frontend/src/components/products/scanning/BarcodeScannerModal.tsx` | 7 |
| 233 | `frontend/src/components/products/scanning/barcodeScannerState.ts` | 1 |
| 234 | `frontend/src/components/products/scanning/scanbotScanner.ts` | 9 |
| 235 | `frontend/src/components/products/shared/primitives.tsx` | 12 |
| 236 | `frontend/src/components/products/surfaces/HeaderActions.tsx` | 2 |
| 237 | `frontend/src/components/products/surfaces/ProductDetailModal.tsx` | 3 |
| 238 | `frontend/src/components/products/surfaces/ProductRowParts.tsx` | 5 |
| 239 | `frontend/src/components/products/surfaces/ProductsListSurface.tsx` | 3 |
| 240 | `frontend/src/components/receipt-settings/AllFieldsPanel.tsx` | 4 |
| 241 | `frontend/src/components/receipt-settings/constants.ts` | 2 |
| 242 | `frontend/src/components/receipt-settings/ErrorBoundary.tsx` | 1 |
| 243 | `frontend/src/components/receipt-settings/FieldOrderManager.tsx` | 9 |
| 244 | `frontend/src/components/receipt-settings/PrintSettings.tsx` | 8 |
| 245 | `frontend/src/components/receipt-settings/ReceiptPreview.tsx` | 3 |
| 246 | `frontend/src/components/receipt-settings/ReceiptSettings.tsx` | 4 |
| 247 | `frontend/src/components/receipt-settings/template.ts` | 4 |
| 248 | `frontend/src/components/receipt/Receipt.tsx` | 10 |
| 249 | `frontend/src/components/returns/EditReturnModal.tsx` | 7 |
| 250 | `frontend/src/components/returns/NewReturnModal.tsx` | 13 |
| 251 | `frontend/src/components/returns/NewSupplierReturnModal.tsx` | 7 |
| 252 | `frontend/src/components/returns/ReturnDetailModal.tsx` | 4 |
| 253 | `frontend/src/components/returns/Returns.tsx` | 12 |
| 254 | `frontend/src/components/returns/ReturnsListSurface.tsx` | 5 |
| 255 | `frontend/src/components/sales/ExportModal.tsx` | 5 |
| 256 | `frontend/src/components/sales/SaleDetailModal.tsx` | 4 |
| 257 | `frontend/src/components/sales/Sales.tsx` | 16 |
| 258 | `frontend/src/components/sales/SalesImportModal.tsx` | 8 |
| 259 | `frontend/src/components/sales/salesImportWorker.ts` | 1 |
| 260 | `frontend/src/components/sales/SalesListSurface.tsx` | 2 |
| 261 | `frontend/src/components/sales/StatusBadge.tsx` | 3 |
| 262 | `frontend/src/components/server/ServerPage.tsx` | 20 |
| 263 | `frontend/src/components/shared/ActionHistoryBar.tsx` | 3 |
| 264 | `frontend/src/components/shared/BackgroundImportTracker.tsx` | 21 |
| 265 | `frontend/src/components/shared/ExportMenu.tsx` | 1 |
| 266 | `frontend/src/components/shared/FilterMenu.tsx` | 2 |
| 267 | `frontend/src/components/shared/globalScroll.ts` | 5 |
| 268 | `frontend/src/components/shared/ImageGalleryLightbox.tsx` | 5 |
| 269 | `frontend/src/components/shared/LoadingWatchdog.tsx` | 1 |
| 270 | `frontend/src/components/shared/Modal.tsx` | 1 |
| 271 | `frontend/src/components/shared/navigationConfig.ts` | 1 |
| 272 | `frontend/src/components/shared/NotificationCenter.tsx` | 9 |
| 273 | `frontend/src/components/shared/pageActivity.ts` | 1 |
| 274 | `frontend/src/components/shared/PageHeader.tsx` | 1 |
| 275 | `frontend/src/components/shared/PaginationControls.tsx` | 4 |
| 276 | `frontend/src/components/shared/PortalMenu.tsx` | 7 |
| 277 | `frontend/src/components/shared/QuickPreferenceToggles.tsx` | 3 |
| 278 | `frontend/src/components/shared/SectionSwitcher.tsx` | 3 |
| 279 | `frontend/src/components/shared/WriteConflictModal.tsx` | 10 |
| 280 | `frontend/src/components/users/PermissionEditor.tsx` | 3 |
| 281 | `frontend/src/components/users/UserDetailSheet.tsx` | 4 |
| 282 | `frontend/src/components/users/UserProfileModal.tsx` | 14 |
| 283 | `frontend/src/components/users/Users.tsx` | 18 |
| 284 | `frontend/src/components/utils-settings/AuditLog.tsx` | 18 |
| 285 | `frontend/src/components/utils-settings/Backup.tsx` | 34 |
| 286 | `frontend/src/components/utils-settings/FontFamilyPicker.tsx` | 1 |
| 287 | `frontend/src/components/utils-settings/index.ts` | 0 |
| 288 | `frontend/src/components/utils-settings/OtpModal.tsx` | 4 |
| 289 | `frontend/src/components/utils-settings/ResetData.tsx` | 10 |
| 290 | `frontend/src/components/utils-settings/Settings.tsx` | 26 |
| 291 | `frontend/src/components/utils-settings/settingsConflict.ts` | 3 |
| 292 | `frontend/src/constants.ts` | 3 |
| 293 | `frontend/src/index.tsx` | 10 |
| 294 | `frontend/src/platform/runtime/clientRuntime.ts` | 17 |
| 295 | `frontend/src/platform/storage/storagePolicy.ts` | 3 |
| 296 | `frontend/src/runtime/runtimeErrorClassifier.ts` | 13 |
| 297 | `frontend/src/types/jsx-modules.d.ts` | 0 |
| 298 | `frontend/src/types/receiptContracts.ts` | 0 |
| 299 | `frontend/src/types/settingsContracts.ts` | 0 |
| 300 | `frontend/src/utils/actionGuards.ts` | 5 |
| 301 | `frontend/src/utils/actionHistory.ts` | 5 |
| 302 | `frontend/src/utils/appRefresh.ts` | 2 |
| 303 | `frontend/src/utils/bulkOps.ts` | 1 |
| 304 | `frontend/src/utils/color.ts` | 3 |
| 305 | `frontend/src/utils/csv.ts` | 15 |
| 306 | `frontend/src/utils/csvExportWorker.ts` | 1 |
| 307 | `frontend/src/utils/csvImport.ts` | 19 |
| 308 | `frontend/src/utils/csvRowCounter.ts` | 2 |
| 309 | `frontend/src/utils/dateHelpers.ts` | 3 |
| 310 | `frontend/src/utils/deviceInfo.ts` | 4 |
| 311 | `frontend/src/utils/exportPackage.ts` | 2 |
| 312 | `frontend/src/utils/exportReports.tsx` | 9 |
| 313 | `frontend/src/utils/favicon.ts` | 4 |
| 314 | `frontend/src/utils/formatters.ts` | 5 |
| 315 | `frontend/src/utils/groupedRecords.ts` | 8 |
| 316 | `frontend/src/utils/historyHelpers.ts` | 2 |
| 317 | `frontend/src/utils/importJobRefresh.ts` | 7 |
| 318 | `frontend/src/utils/index.ts` | 0 |
| 319 | `frontend/src/utils/initials.ts` | 7 |
| 320 | `frontend/src/utils/loaders.ts` | 7 |
| 321 | `frontend/src/utils/mediaUpload.ts` | 5 |
| 322 | `frontend/src/utils/permissions.ts` | 2 |
| 323 | `frontend/src/utils/pricing.ts` | 8 |
| 324 | `frontend/src/utils/printReceipt.ts` | 40 |
| 325 | `frontend/src/utils/productBatches.ts` | 3 |
| 326 | `frontend/src/utils/productGrouping.ts` | 13 |
| 327 | `frontend/src/utils/publicAssetUrls.ts` | 8 |
| 328 | `frontend/src/utils/receiptAppliedConfig.ts` | 7 |
| 329 | `frontend/src/utils/scriptTypography.ts` | 3 |
| 330 | `frontend/src/utils/settingsRefresh.ts` | 2 |
| 331 | `frontend/src/utils/settingsWriteOptions.ts` | 1 |
| 332 | `frontend/src/web-api.ts` | 33 |
| 333 | `frontend/tailwind.config.ts` | 0 |
| 334 | `frontend/tests/actionGuards.test.ts` | 1 |
| 335 | `frontend/tests/actionStability.test.ts` | 3 |
| 336 | `frontend/tests/adminShellMediaGuards.test.ts` | 0 |
| 337 | `frontend/tests/apiHttp.test.ts` | 3 |
| 338 | `frontend/tests/appRefresh.test.ts` | 2 |
| 339 | `frontend/tests/appShellUtils.test.ts` | 1 |
| 340 | `frontend/tests/assetCompression.test.ts` | 1 |
| 341 | `frontend/tests/backupJobs.test.ts` | 0 |
| 342 | `frontend/tests/barcodeImageScanner.test.ts` | 2 |
| 343 | `frontend/tests/barcodeScannerState.test.ts` | 1 |
| 344 | `frontend/tests/bulkOps.test.ts` | 1 |
| 345 | `frontend/tests/contactImportWorker.test.ts` | 1 |
| 346 | `frontend/tests/csvImport.test.ts` | 1 |
| 347 | `frontend/tests/dashboardDataReliability.test.ts` | 0 |
| 348 | `frontend/tests/dateHelpers.test.ts` | 2 |
| 349 | `frontend/tests/deviceInfo.test.ts` | 2 |
| 350 | `frontend/tests/exportPackages.test.ts` | 1 |
| 351 | `frontend/tests/formatters.test.ts` | 1 |
| 352 | `frontend/tests/globalScroll.test.ts` | 0 |
| 353 | `frontend/tests/globalScrollControls.test.ts` | 1 |
| 354 | `frontend/tests/groupedRecords.test.ts` | 1 |
| 355 | `frontend/tests/historyHelpers.test.ts` | 1 |
| 356 | `frontend/tests/importJobRefresh.test.ts` | 4 |
| 357 | `frontend/tests/initials.test.ts` | 1 |
| 358 | `frontend/tests/inventoryImportWorker.test.ts` | 1 |
| 359 | `frontend/tests/inventoryMobileCardLayout.test.ts` | 0 |
| 360 | `frontend/tests/inventoryMovementGroups.test.ts` | 1 |
| 361 | `frontend/tests/inventoryRfidSection.test.ts` | 0 |
| 362 | `frontend/tests/jsxSyntaxCheck.ts` | 1 |
| 363 | `frontend/tests/loaders.test.ts` | 1 |
| 364 | `frontend/tests/mediaUploadHelpers.test.ts` | 1 |
| 365 | `frontend/tests/navigationConfig.test.ts` | 1 |
| 366 | `frontend/tests/notificationBadge.test.ts` | 0 |
| 367 | `frontend/tests/offlineSalesQueue.test.ts` | 1 |
| 368 | `frontend/tests/offlineSecurityHardening.test.ts` | 1 |
| 369 | `frontend/tests/offlineSyncArchitecture.test.ts` | 1 |
| 370 | `frontend/tests/ownedGoogleAuth.test.ts` | 1 |
| 371 | `frontend/tests/performanceLoadingUx.test.ts` | 0 |
| 372 | `frontend/tests/permissionEditor.test.ts` | 0 |
| 373 | `frontend/tests/permissions.test.ts` | 0 |
| 374 | `frontend/tests/portalCatalogDisplay.test.ts` | 1 |
| 375 | `frontend/tests/portalContentI18n.test.ts` | 0 |
| 376 | `frontend/tests/portalEditorUtils.test.ts` | 1 |
| 377 | `frontend/tests/portalFaqVocabulary.test.ts` | 0 |
| 378 | `frontend/tests/portalLanguagePacks.test.ts` | 0 |
| 379 | `frontend/tests/portalTranslateController.test.ts` | 3 |
| 380 | `frontend/tests/posCore.test.ts` | 1 |
| 381 | `frontend/tests/pricingContacts.test.ts` | 1 |
| 382 | `frontend/tests/productBatches.test.ts` | 0 |
| 383 | `frontend/tests/productDiscountUx.test.ts` | 1 |
| 384 | `frontend/tests/productDisplayHelpers.test.ts` | 0 |
| 385 | `frontend/tests/productFilterHelpers.test.ts` | 0 |
| 386 | `frontend/tests/productGalleryHelpers.test.ts` | 0 |
| 387 | `frontend/tests/productGrouping.test.ts` | 1 |
| 388 | `frontend/tests/productGroupViewHelpers.test.ts` | 2 |
| 389 | `frontend/tests/productHistoryHelpers.test.ts` | 1 |
| 390 | `frontend/tests/productImportPlanner.test.ts` | 1 |
| 391 | `frontend/tests/productImportWorkerFallback.test.ts` | 1 |
| 392 | `frontend/tests/productMenuHelpers.test.ts` | 5 |
| 393 | `frontend/tests/productPageHelpers.test.ts` | 0 |
| 394 | `frontend/tests/productSearchPagination.test.ts` | 0 |
| 395 | `frontend/tests/productSelectionHelpers.test.ts` | 0 |
| 396 | `frontend/tests/productWriteHelpers.test.ts` | 0 |
| 397 | `frontend/tests/publicErrorRecovery.test.ts` | 1 |
| 398 | `frontend/tests/receiptSettingsSync.test.ts` | 0 |
| 399 | `frontend/tests/receiptTemplate.test.ts` | 1 |
| 400 | `frontend/tests/returnsLayout.test.ts` | 0 |
| 401 | `frontend/tests/runtimeErrorClassifier.test.ts` | 0 |
| 402 | `frontend/tests/salesImportWorker.test.ts` | 1 |
| 403 | `frontend/tests/scanbotScanner.test.ts` | 2 |
| 404 | `frontend/tests/scriptTypography.test.ts` | 0 |
| 405 | `frontend/tests/sectionNavigation.test.ts` | 0 |
| 406 | `frontend/tests/settingsConflictHelpers.test.ts` | 1 |
| 407 | `frontend/tests/settingsRefresh.test.ts` | 0 |
| 408 | `frontend/tests/storagePolicy.test.ts` | 1 |
| 409 | `frontend/tests/utilsSettingsBarrel.test.ts` | 0 |
| 410 | `frontend/vite.config.ts` | 5 |
| 411 | `ops/scripts/architecture/generated-bulk-audit.ts` | 18 |
| 412 | `ops/scripts/architecture/language-runtime-audit.ts` | 20 |
| 413 | `ops/scripts/architecture/organization-audit.ts` | 15 |
| 414 | `ops/scripts/architecture/phase29-audit.ts` | 13 |
| 415 | `ops/scripts/backend/schema-audit.ts` | 25 |
| 416 | `ops/scripts/backend/schema-primary-key-preflight.ts` | 5 |
| 417 | `ops/scripts/backend/verify-data-integrity.ts` | 27 |
| 418 | `ops/scripts/frontend/verify-i18n.ts` | 6 |
| 419 | `ops/scripts/frontend/verify-performance.ts` | 4 |
| 420 | `ops/scripts/frontend/verify-ui.ts` | 11 |
| 421 | `ops/scripts/lib/fs-utils.ts` | 16 |
| 422 | `ops/scripts/lib/report-utils.ts` | 5 |
| 423 | `ops/scripts/runtime/audits/action-history-undo-redo-check.ts` | 5 |
| 424 | `ops/scripts/runtime/audits/audit-auth.ts` | 6 |
| 425 | `ops/scripts/runtime/audits/audit-manifest.ts` | 3 |
| 426 | `ops/scripts/runtime/audits/audit-report-html.ts` | 11 |
| 427 | `ops/scripts/runtime/audits/deep-live-audit.ts` | 42 |
| 428 | `ops/scripts/runtime/audits/full-app-audit.ts` | 22 |
| 429 | `ops/scripts/runtime/browser-action-smoke.ts` | 32 |
| 430 | `ops/scripts/runtime/cloudflare/rotate-cloudflare-tunnel-token.ts` | 16 |
| 431 | `ops/scripts/runtime/cloudflare/update-cloudflare-tunnel-origin.ts` | 6 |
| 432 | `ops/scripts/runtime/cloudflare/verify-cloudflare-automation.ts` | 16 |
| 433 | `ops/scripts/runtime/cloudflare/verify-r2-object-store.ts` | 8 |
| 434 | `ops/scripts/runtime/live-checks/live-check-utils.ts` | 8 |
| 435 | `ops/scripts/runtime/live-checks/phase84-branches-actions-live-check.ts` | 2 |
| 436 | `ops/scripts/runtime/live-checks/phase84-contacts-live-check.ts` | 2 |
| 437 | `ops/scripts/runtime/live-checks/phase84-files-providers-actions-live-check.ts` | 2 |
| 438 | `ops/scripts/runtime/live-checks/phase84-inventory-actions-live-check.ts` | 3 |
| 439 | `ops/scripts/runtime/live-checks/phase84-live-suite.ts` | 11 |
| 440 | `ops/scripts/runtime/live-checks/phase84-product-brands-actions-live-check.ts` | 3 |
| 441 | `ops/scripts/runtime/live-checks/phase84-product-categories-actions-live-check.ts` | 2 |
| 442 | `ops/scripts/runtime/live-checks/phase84-product-page-actions-live-check.ts` | 3 |
| 443 | `ops/scripts/runtime/live-checks/phase84-product-scanning-actions-live-check.ts` | 2 |
| 444 | `ops/scripts/runtime/live-checks/phase84-product-stock-actions-live-check.ts` | 2 |
| 445 | `ops/scripts/runtime/live-checks/phase84-product-units-actions-live-check.ts` | 2 |
| 446 | `ops/scripts/runtime/live-checks/phase84-product-variant-actions-live-check.ts` | 3 |
| 447 | `ops/scripts/runtime/live-checks/phase84-public-portal-cloudflare-check.ts` | 5 |
| 448 | `ops/scripts/runtime/live-checks/phase84-sales-actions-live-check.ts` | 2 |
| 449 | `ops/scripts/runtime/live-checks/phase84-ui-live-check.ts` | 2 |
| 450 | `ops/scripts/runtime/live-checks/phase84-users-actions-live-check.ts` | 2 |
| 451 | `ops/scripts/runtime/smoke/check-public-url.ts` | 11 |
| 452 | `ops/scripts/runtime/smoke/check-route-contract.ts` | 3 |
| 453 | `ops/scripts/runtime/smoke/live-smoke.ts` | 6 |
| 454 | `ops/scripts/runtime/smoke/post-start-diagnostics.ts` | 7 |
| 455 | `ops/scripts/runtime/storage/cleanup-integrity-backlog.ts` | 8 |
| 456 | `ops/scripts/runtime/storage/cleanup-test-data.ts` | 21 |
| 457 | `ops/scripts/runtime/storage/dataset-readiness.ts` | 5 |
| 458 | `ops/scripts/runtime/storage/post-live-hygiene.ts` | 11 |
| 459 | `ops/scripts/runtime/storage/prune-storage.ts` | 17 |
| 460 | `ops/scripts/runtime/storage/restore-candidates.ts` | 8 |
| 461 | `ops/scripts/runtime/storage/restore-rehearsal.ts` | 14 |
| 462 | `ops/scripts/verification/verify-backup-reliability.ts` | 6 |
| 463 | `ops/scripts/verification/verify-docker-release.ts` | 11 |
| 464 | `ops/scripts/verification/verify-hardening-policy.ts` | 9 |
| 465 | `ops/scripts/verification/verify-runtime-deps.ts` | 13 |
| 466 | `ops/scripts/verification/verify-scale-services.ts` | 8 |
| 467 | `ops/scripts/verification/verify-secret-hygiene.ts` | 0 |

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

### 3.2 `backend/src/accessControl.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 45 |
| 2 | `normalizeHostname` | function | 49 |
| 3 | `getConfiguredSyncToken` | function | 55 |
| 4 | `getRemoteAccessProvider` | function | 59 |
| 5 | `isLegacyTailscaleEnabled` | function | 63 |
| 6 | `getRequestHost` | function | 70 |
| 7 | `getRemoteAddress` | function | 79 |
| 8 | `isLoopbackAddress` | function | 87 |
| 9 | `getPresentedSyncToken` | function | 97 |
| 10 | `getTailscaleIdentity` | function | 106 |
| 11 | `hasTrustedTailscaleIdentity` | function | 118 |
| 12 | `isLocalHostRequest` | function | 129 |
| 13 | `isTsNetHost` | function | 134 |
| 14 | `getConfiguredTailscaleHost` | function | 139 |
| 15 | `isPublicRemoteRequest` | function | 146 |
| 16 | `isPublicApiRequest` | function | 157 |
| 17 | `classifyRequestAccess` | function | 170 |
| 18 | `authorizeProtectedRequest` | function | 202 |

### 3.3 `backend/src/analytics/duckdbRuntime.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `tryRequireDuckDbPackage` | function | 30 |
| 2 | `probeDuckDbPackage` | function | 44 |
| 3 | `getDuckDbRuntimeStatus` | function | 74 |

### 3.4 `backend/src/authOtpGuards.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeUserId` | function | 6 |
| 2 | `canManageOtpTarget` | function | 12 |
| 3 | `requiresSelfOtpDisablePassword` | function | 23 |

### 3.5 `backend/src/backupSchema.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `countRowsByTable` | function | 102 |
| 2 | `countCustomTableRows` | function | 114 |
| 3 | `buildBackupSummary` | function | 125 |
| 4 | `buildBackupSummaryFromCounts` | function | 133 |

### 3.6 `backend/src/businessMetrics.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sellableProductWhere` | function | 14 |
| 2 | `effectiveCostExpr` | function | 25 |
| 3 | `stockQuantityExpr` | function | 34 |
| 4 | `normalizeMetricRow` | function | 41 |
| 5 | `getStockMetrics` | function | 56 |
| 6 | `getLowStockProducts` | function | 94 |
| 7 | `getOutOfStockProducts` | function | 111 |
| 8 | `getStockAlertProducts` | function | 127 |
| 9 | `getExpiringProducts` | function | 152 |

### 3.7 `backend/src/catalogTextIntegrity.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeCatalogText` | function | 16 |
| 2 | `hasSuspiciousCatalogText` | function | 31 |
| 3 | `listSuspiciousCatalogFields` | function | 46 |
| 4 | `assertCatalogTextIntegrity` | function | 63 |
| 5 | `normalizeOptionList` | function | 73 |

### 3.8 `backend/src/config/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildEnvCandidates` | function | 25 |
| 2 | `isDefaultDataMarker` | function | 54 |
| 3 | `resolveStoredDataDir` | function | 59 |
| 4 | `normalizeSelectedDataDir` | function | 66 |
| 5 | `readDataLocation` | function | 78 |
| 6 | `writeDataLocation` | function | 89 |
| 7 | `ensureDirectory` | function | 105 |
| 8 | `readSecretFileValue` | function | 109 |
| 9 | `ensureOrganizationRuntimeLayout` | function | 121 |
| 10 | `normalizeOrganizationSeed` | function | 128 |
| 11 | `STORAGE_ROOT` | const arrow | 135 |

### 3.9 `backend/src/conflictControl.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `WriteConflictError` | class | 8 |
| 2 | `normalizeUpdatedAt` | function | 32 |
| 3 | `getExpectedUpdatedAt` | function | 41 |
| 4 | `assertUpdatedAtMatch` | function | 56 |
| 5 | `sendWriteConflict` | function | 73 |
| 6 | `sendSettingsConflict` | function | 93 |

### 3.10 `backend/src/contactOptions.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cleanText` | function | 9 |
| 2 | `normalizeContactOption` | function | 41 |
| 3 | `hasContactOptionData` | function | 57 |
| 4 | `collectNormalizedContactOptions` | function | 72 |
| 5 | `collectLegacyContactOptions` | function | 89 |
| 6 | `parseStoredContactOptions` | function | 111 |
| 7 | `parseImportContactOptions` | function | 135 |
| 8 | `serializeContactOptions` | function | 156 |
| 9 | `getPrimaryContactOption` | function | 166 |
| 10 | `buildImportedContactState` | function | 178 |

### 3.11 `backend/src/database.ts`

- No top-level named symbols detected.

### 3.12 `backend/src/dataPath/index.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizePathForCompare` | function | 32 |
| 2 | `isSamePath` | function | 38 |
| 3 | `isSubPath` | function | 42 |
| 4 | `ensureDataRootLayout` | function | 47 |
| 5 | `walkFiles` | function | 58 |
| 6 | `summarizeDataRoot` | function | 80 |
| 7 | `copyDirectoryContents` | function | 123 |
| 8 | `buildArchivedTargetPath` | function | 160 |
| 9 | `relocateDataRoot` | function | 180 |

### 3.13 `backend/src/db/cutoverReadiness.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeRelative` | function | 44 |
| 2 | `toRelative` | function | 48 |
| 3 | `shouldSkipDir` | function | 52 |
| 4 | `listSourceFiles` | function | 60 |
| 5 | `analyzeFile` | function | 74 |
| 6 | `incrementCount` | function | 95 |
| 7 | `mapCountsToRows` | function | 99 |
| 8 | `summarizeBlockers` | function | 107 |
| 9 | `analyzeFiles` | function | 124 |
| 10 | `analyzePostgresCutoverReadiness` | function | 134 |

### 3.14 `backend/src/db/postgresQueryCompat.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `countPositionalPlaceholders` | function | 63 |
| 2 | `stripTrailingSemicolon` | function | 88 |
| 3 | `replacePositionalParams` | function | 92 |
| 4 | `normalizePortableSqlFunctions` | function | 126 |
| 5 | `translateInsertOrIgnore` | function | 137 |
| 6 | `translateParameters` | function | 141 |
| 7 | `appendReturning` | function | 166 |
| 8 | `isNumericFieldName` | function | 178 |
| 9 | `getInsertTableName` | function | 185 |
| 10 | `translateSql` | function | 195 |
| 11 | `coerceRowValue` | function | 213 |
| 12 | `coerceRow` | function | 226 |

### 3.15 `backend/src/fileAssets.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDb` | function | 59 |
| 2 | `buildAssetExtToMime` | function | 63 |
| 3 | `ensureUploadsDirectory` | function | 73 |
| 4 | `getMimeTypeFromName` | function | 77 |
| 5 | `getMediaType` | function | 82 |
| 6 | `sanitizeOriginalFileName` | function | 91 |
| 7 | `preserveOriginalDisplayName` | function | 105 |
| 8 | `buildUniqueStoredName` | function | 113 |
| 9 | `shouldCompressImage` | function | 130 |
| 10 | `compressBufferForAsset` | function | 136 |
| 11 | `encodeImageCandidate` | function | 220 |
| 12 | `readImageDimensions` | function | 249 |
| 13 | `getFfmpegPath` | function | 262 |
| 14 | `buildVideoOptimizationArgs` | function | 270 |
| 15 | `optimizeStoredVideo` | function | 308 |
| 16 | `createFileAssetRecord` | function | 374 |
| 17 | `getFileAssetByPublicPath` | function | 454 |
| 18 | `buildFileAssetFilterParams` | function | 463 |
| 19 | `listAssetRows` | function | 470 |
| 20 | `countAssetRows` | function | 495 |
| 21 | `writeObjectBodyToFile` | function | 515 |
| 22 | `ensureStoredAssetAvailableLocally` | function | 533 |
| 23 | `collectUploadPathsFromValue` | function | 543 |
| 24 | `pruneInvalidReferenceBackfillAssets` | function | 571 |
| 25 | `collectReferencedUploadPaths` | function | 579 |
| 26 | `add` | const arrow | 581 |
| 27 | `ensureReferencedAssetsRegistered` | function | 592 |
| 28 | `getUploadFilePath` | function | 625 |
| 29 | `toUploadPublicPathFromObjectKey` | function | 630 |
| 30 | `findUploadStorageOrphans` | function | 636 |
| 31 | `collectTrackedUploadPublicPaths` | function | 654 |
| 32 | `add` | const arrow | 656 |
| 33 | `collectObjectKeys` | function | 673 |
| 34 | `listLocalUploadFiles` | function | 682 |
| 35 | `reconcileUploadStorage` | function | 690 |
| 36 | `requestUploadStorageReconcile` | function | 750 |
| 37 | `ensureFileAssetListingWarm` | function | 754 |
| 38 | `prewarmFileAssetListing` | function | 772 |
| 39 | `deleteAllStoredUploads` | function | 783 |
| 40 | `buildInClausePlaceholders` | function | 804 |
| 41 | `normalizeUniquePublicPaths` | function | 810 |
| 42 | `createUsageMap` | function | 822 |
| 43 | `addReferencedRowUsages` | function | 830 |
| 44 | `buildUploadReferenceUsageMap` | function | 840 |
| 45 | `getCachedSettingsUsageReferences` | function | 862 |
| 46 | `getCachedSubmissionUsageReferences` | function | 882 |
| 47 | `mergeUsageReferences` | function | 902 |
| 48 | `collectUsagesByPublicPath` | function | 911 |
| 49 | `addUsage` | const arrow | 917 |
| 50 | `collectUsage` | function | 987 |
| 51 | `resolveBrowserPublicPath` | function | 991 |
| 52 | `serializeAssetRow` | function | 998 |
| 53 | `serializeAssetRows` | function | 1012 |
| 54 | `registerStoredAsset` | function | 1026 |
| 55 | `registerUploadFromRequest` | function | 1103 |
| 56 | `optimizeStoredAssetFromQueue` | function | 1117 |
| 57 | `storeDataUrlAsset` | function | 1149 |
| 58 | `backfillUploadAssets` | function | 1175 |
| 59 | `listFileAssets` | function | 1192 |
| 60 | `getFileAssetById` | function | 1215 |
| 61 | `deleteFileAsset` | function | 1220 |

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
| 11 | `nonEmptyCsvLines` | function | 190 |
| 12 | `normalizeCsvHeaders` | function | 198 |
| 13 | `normalizeCsvCell` | function | 206 |
| 14 | `buildCsvRow` | function | 210 |
| 15 | `buildParsedCsvRows` | function | 218 |
| 16 | `parseCSVRows` | function | 237 |
| 17 | `bulkImportCSV` | function | 254 |
| 18 | `parseCSVLine` | function | 280 |
| 19 | `buildPlaceholders` | function | 294 |
| 20 | `rowValuesForColumns` | function | 300 |
| 21 | `importRows` | function | 314 |
| 22 | `verifyAndRepairStockQuantities` | function | 329 |
| 23 | `mapReturnedQuantities` | function | 382 |
| 24 | `areAllSaleItemsReturned` | function | 390 |
| 25 | `verifyAndRepairSaleStatuses` | function | 402 |
| 26 | `verifyAndRepairCostPrices` | function | 461 |
| 27 | `runDataIntegrityCheck` | function | 543 |
| 28 | `hasRepairMessages` | function | 567 |
| 29 | `getSafeCostPrice` | function | 577 |
| 30 | `calculateSaleProfit` | function | 588 |

### 3.17 `backend/src/idempotency.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeClientRequestId` | function | 4 |

### 3.18 `backend/src/importCsv.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `stripBom` | function | 15 |
| 2 | `normalizeDigit` | function | 22 |
| 3 | `normalizeNumericText` | function | 33 |
| 4 | `countDelimiter` | function | 44 |
| 5 | `detectCsvDelimiter` | function | 66 |
| 6 | `parseDelimitedRows` | function | 85 |
| 7 | `normalizeCsvKey` | function | 130 |
| 8 | `normalizeCsvHeaders` | function | 141 |
| 9 | `hasDelimitedRowContent` | function | 152 |
| 10 | `hasParsedCsvRowContent` | function | 162 |
| 11 | `buildParsedCsvRows` | function | 172 |
| 12 | `parseCsvRows` | function | 186 |
| 13 | `detectCsvDelimiterFromFile` | function | 196 |
| 14 | `csvValuesToRow` | function | 212 |
| 15 | `hasCsvContent` | function | 226 |
| 16 | `emitRecord` | const function | 248 |

### 3.19 `backend/src/importParsing.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeDigit` | function | 13 |
| 2 | `normalizeNumericText` | function | 24 |
| 3 | `removeCurrencyNoise` | function | 34 |
| 4 | `normalizeNumberSeparators` | function | 44 |
| 5 | `parseImportNumericValue` | function | 83 |
| 6 | `normalizeImportMoney` | function | 102 |

### 3.20 `backend/src/initials.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildKhmerOrder` | function | 21 |
| 2 | `normalizeInitialText` | function | 34 |
| 3 | `getInitialKey` | function | 39 |
| 4 | `getInitialType` | function | 51 |
| 5 | `compareInitialKeys` | function | 61 |
| 6 | `rank` | const arrow | 66 |
| 7 | `aggregateInitialRows` | function | 87 |

### 3.21 `backend/src/maintenanceLock.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 15 |
| 2 | `getMaintenanceLock` | function | 22 |
| 3 | `isMaintenanceLocked` | function | 29 |
| 4 | `acquireMaintenanceLock` | function | 37 |
| 5 | `releaseMaintenanceLock` | function | 53 |
| 6 | `withMaintenanceLock` | function | 66 |
| 7 | `isReadOnlyMethod` | function | 79 |
| 8 | `isMaintenanceWriteAllowed` | function | 87 |
| 9 | `maintenanceWriteGuard` | function | 109 |

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
| 16 | `readAuditTextValue` | function | 234 |
| 17 | `getAuditRequestMeta` | function | 240 |
| 18 | `getAuditActor` | function | 269 |
| 19 | `compressUpload` | function | 285 |
| 20 | `validateUploadedFile` | function | 303 |
| 21 | `validateUploadBufferPayload` | function | 314 |

### 3.23 `backend/src/money.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toFiniteNumber` | function | 4 |
| 2 | `roundUpToDecimals` | function | 10 |
| 3 | `normalizePriceValue` | function | 20 |

### 3.24 `backend/src/netSecurity.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 29 |
| 2 | `normalizeHostname` | function | 36 |
| 3 | `isPrivateIpv4` | function | 43 |
| 4 | `isPrivateIpv6` | function | 64 |
| 5 | `isBlockedHostname` | function | 78 |
| 6 | `assertSafeOutboundUrl` | function | 99 |
| 7 | `isSafeExternalImageReference` | function | 130 |

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
| 12 | `shouldFallbackToR2Api` | function | 125 |
| 13 | `isMissingObjectError` | function | 135 |
| 14 | `getS3Client` | function | 145 |
| 15 | `normalizeObjectKey` | function | 164 |
| 16 | `normalizeUniqueObjectKeys` | function | 168 |
| 17 | `buildDeleteObjectRefs` | function | 180 |
| 18 | `serializeCloudflareObjectList` | function | 188 |
| 19 | `serializeS3ObjectList` | function | 201 |
| 20 | `ensureBucket` | function | 214 |
| 21 | `putObject` | function | 232 |
| 22 | `sendWithTimeout` | function | 267 |
| 23 | `getObjectStream` | function | 279 |
| 24 | `objectExists` | function | 312 |
| 25 | `deleteObject` | function | 345 |
| 26 | `deleteObjects` | function | 364 |
| 27 | `listObjects` | function | 397 |
| 28 | `testObjectStore` | function | 433 |
| 29 | `bufferToStream` | function | 448 |

### 3.26 `backend/src/optionalSharp.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadSharp` | function | 9 |

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

### 3.28 `backend/src/permissions.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildPermissionDefinitions` | function | 51 |
| 2 | `normalizeKey` | function | 148 |
| 3 | `getPermissionDefinition` | function | 155 |
| 4 | `isSensitivePermissionKey` | function | 166 |
| 5 | `permissionForActionHistory` | function | 176 |
| 6 | `isSensitiveActionHistory` | function | 187 |
| 7 | `hasPermissionValue` | function | 206 |

### 3.29 `backend/src/portalUtils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toTrimmedString` | function | 14 |
| 2 | `safeJsonParse` | function | 23 |
| 3 | `createAboutBlock` | function | 36 |
| 4 | `normalizeAboutBlocks` | function | 51 |
| 5 | `extractGoogleMapsEmbedUrl` | function | 78 |
| 6 | `normalizeGoogleMapsEmbed` | function | 90 |

### 3.30 `backend/src/postgresDatabase.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadPgNative` | function | 13 |
| 2 | `normalizeQueryRows` | function | 30 |
| 3 | `buildRunResult` | function | 37 |
| 4 | `normalizeStatementArgs` | function | 46 |
| 5 | `splitSqlStatements` | function | 55 |
| 6 | `PostgresCompatStatement` | class | 65 |
| 7 | `PostgresCompatDatabase` | class | 89 |
| 8 | `createPostgresDatabase` | function | 531 |
| 9 | `runDatabaseMaintenance` | function | 535 |
| 10 | `ensureCoreDataInvariants` | function | 539 |
| 11 | `ensureDefaultOrganizationAndGroup` | function | 543 |
| 12 | `ensurePrimaryAdminRoleAndUser` | function | 547 |
| 13 | `getDb` | function | 553 |
| 14 | `closeDatabase` | function | 581 |

### 3.31 `backend/src/productBatches.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeExpiryDate` | function | 23 |
| 2 | `normalizeLotCode` | function | 28 |
| 3 | `isSellableProduct` | function | 33 |
| 4 | `buildBatchKey` | function | 37 |
| 5 | `getProductById` | function | 46 |
| 6 | `rowsToIds` | function | 52 |
| 7 | `normalizePositiveIds` | function | 60 |
| 8 | `buildPlaceholders` | function | 72 |
| 9 | `sumQuantities` | function | 78 |
| 10 | `hasTrackedBatch` | function | 86 |
| 11 | `getProductBatchIds` | function | 93 |
| 12 | `getBatchRowsForProduct` | function | 97 |
| 13 | `getLegacyBatchBackfillCandidates` | function | 106 |
| 14 | `createOrFindProductBatch` | function | 119 |
| 15 | `setBranchBatchQuantity` | function | 176 |
| 16 | `incrementBranchBatchQuantity` | function | 186 |
| 17 | `getBatchStockRows` | function | 197 |
| 18 | `listProductBatches` | function | 237 |
| 19 | `syncProductBatchRollups` | function | 308 |
| 20 | `migrateLegacyProductToBatches` | function | 353 |
| 21 | `migrateAllLegacyProductsToBatches` | function | 397 |
| 22 | `scheduleLegacyBatchBackfill` | function | 409 |
| 23 | `runNextChunk` | const arrow | 415 |
| 24 | `getLegacyBatchBackfillStatus` | function | 445 |
| 25 | `getAvailableProductQuantity` | function | 454 |
| 26 | `allocateProductBatches` | function | 459 |
| 27 | `increaseProductBatchStock` | function | 499 |
| 28 | `restoreBatchAllocations` | function | 516 |
| 29 | `cloneAllocationsToProduct` | function | 531 |
| 30 | `getSaleItemAllocations` | function | 555 |
| 31 | `markSaleItemAllocationsReleased` | function | 567 |
| 32 | `getAvailableSaleAllocationRows` | function | 575 |
| 33 | `getReturnItemAllocations` | function | 598 |
| 34 | `markReturnItemAllocationsReversed` | function | 610 |

### 3.32 `backend/src/productDiscounts.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeBooleanFlag` | function | 41 |
| 2 | `normalizePercent` | function | 54 |
| 3 | `normalizeDiscountType` | function | 64 |
| 4 | `normalizeHexColor` | function | 74 |
| 5 | `normalizeDateText` | function | 83 |
| 6 | `pick` | function | 97 |
| 7 | `normalizeProductDiscount` | function | 106 |
| 8 | `isDiscountActive` | function | 133 |
| 9 | `calculateDiscountedPrice` | function | 152 |

### 3.33 `backend/src/productImportPolicies.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseImportNumber` | function | 17 |
| 2 | `parseImportFlag` | function | 31 |
| 3 | `hasImportValue` | function | 45 |
| 4 | `normalizeFieldRule` | function | 55 |
| 5 | `splitUniqueImportValues` | function | 66 |
| 6 | `collectImportListValues` | function | 83 |
| 7 | `buildLowercaseSet` | function | 96 |
| 8 | `appendUniqueImportValue` | function | 110 |
| 9 | `resolveImportValue` | function | 135 |
| 10 | `normalizeImageConflictMode` | function | 155 |

### 3.34 `backend/src/requestContext.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cleanText` | function | 10 |
| 2 | `readHeader` | function | 17 |
| 3 | `extractRequestMeta` | function | 24 |
| 4 | `requestContextMiddleware` | function | 51 |
| 5 | `getRequestMeta` | function | 57 |

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
| 11 | `mapHistoryRows` | function | 103 |
| 12 | `completeServerHistoryTransition` | function | 214 |

### 3.36 `backend/src/routes/ai.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `listProviders` | function | 19 |
| 2 | `getProviderRow` | function | 32 |
| 3 | `serializeResponseRows` | function | 244 |

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
| 11 | `findFirstHttpUrl` | function | 168 |
| 12 | `loginIdentifierPreview` | function | 178 |
| 13 | `rejectLogin` | function | 192 |
| 14 | `getOtpSecret` | function | 214 |
| 15 | `requireOtpActor` | function | 218 |
| 16 | `getOtpTargetUser` | function | 224 |
| 17 | `buildUserPayload` | function | 239 |
| 18 | `resolveOrganizationLookup` | function | 271 |
| 19 | `findUserByIdentifier` | function | 277 |
| 20 | `getExactActiveUserById` | function | 346 |
| 21 | `normalizeOauthMode` | function | 361 |
| 22 | `isEmailIdentifier` | function | 366 |
| 23 | `getUserById` | function | 370 |
| 24 | `getSettingsSnapshot` | function | 374 |
| 25 | `getBootstrapSystemSnapshot` | function | 383 |
| 26 | `buildAuthenticatedBootstrap` | function | 415 |
| 27 | `generateTemporaryAuthPassword` | function | 444 |
| 28 | `issueAuthSession` | function | 448 |
| 29 | `updateLocalUserGoogleIdentity` | function | 459 |
| 30 | `completeGoogleLogin` | function | 608 |
| 31 | `buildOauthCallbackHtml` | function | 694 |

### 3.38 `backend/src/routes/branches.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toDbBool` | function | 13 |
| 2 | `getStockTransferNoteColumn` | function | 21 |
| 3 | `normalizePositiveInt` | function | 25 |
| 4 | `getDefaultBranch` | function | 31 |
| 5 | `getSellableProductWhere` | function | 35 |
| 6 | `buildStockIntegrityPreview` | function | 41 |
| 7 | `buildSqlPlaceholders` | function | 53 |
| 8 | `quoteSqlColumns` | function | 61 |
| 9 | `buildBranchStockWhere` | function | 69 |
| 10 | `hasPagedStockQuery` | function | 93 |

### 3.39 `backend/src/routes/catalog.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `collectProductIds` | function | 10 |
| 2 | `buildPlaceholders` | function | 18 |
| 3 | `buildImageMap` | function | 26 |
| 4 | `buildCatalogProductPayloads` | function | 35 |

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
| 11 | `buildProvidedImportRows` | function | 103 |
| 12 | `normalizeConflictMode` | function | 112 |
| 13 | `toNumber` | function | 117 |
| 14 | `normalizePositiveInt` | function | 122 |
| 15 | `parseDateFilterParams` | function | 128 |
| 16 | `buildContactListFilters` | function | 152 |
| 17 | `buildSearchHaystack` | function | 176 |
| 18 | `parseScopedIds` | function | 185 |
| 19 | `addPositiveId` | function | 201 |
| 20 | `collectPositiveIds` | function | 208 |
| 21 | `buildSqlPlaceholders` | function | 217 |
| 22 | `loadPointPolicy` | function | 225 |
| 23 | `calculatePolicyPoints` | function | 253 |
| 24 | `wantsExpandedPoints` | function | 258 |
| 25 | `buildCustomerPointSummaries` | function | 263 |
| 26 | `buildCustomerRowMap` | function | 336 |
| 27 | `collectPointSummarySourceIds` | function | 345 |
| 28 | `defaultPointSummary` | function | 356 |
| 29 | `buildPointSummaryList` | function | 367 |
| 30 | `attachPointSummaries` | function | 375 |
| 31 | `collectCustomerIdsFromRows` | function | 387 |
| 32 | `findExisting` | const arrow | 560 |
| 33 | `findExisting` | const arrow | 775 |
| 34 | `findExisting` | const arrow | 969 |

### 3.42 `backend/src/routes/customTables.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `humanizeTableName` | function | 13 |
| 2 | `serializeCustomTable` | function | 21 |
| 3 | `sanitizeCustomTableName` | function | 29 |
| 4 | `resolveCustomTableRow` | function | 35 |
| 5 | `escapeIdentifier` | function | 44 |
| 6 | `normalizeCustomTableSchema` | function | 48 |
| 7 | `tableHasColumn` | function | 71 |
| 8 | `ensureCustomTableRowVersioning` | function | 75 |
| 9 | `getWritableCustomTableKeys` | function | 92 |

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
| 4 | `getPermittedImportTypes` | function | 63 |
| 5 | `requireAnyImportPermission` | function | 71 |
| 6 | `ensureDir` | function | 81 |
| 7 | `getJobUploadRoot` | function | 85 |
| 8 | `getJobOr404` | function | 90 |
| 9 | `serializeJobFile` | function | 99 |
| 10 | `serializeJobFiles` | function | 111 |
| 11 | `saveImageJobFiles` | function | 120 |
| 12 | `isAllowedImportFile` | function | 149 |
| 13 | `parsePolicy` | function | 173 |
| 14 | `parseRelativePaths` | function | 179 |
| 15 | `shouldForceDelete` | function | 190 |
| 16 | `auditImportJobEvent` | function | 195 |

### 3.45 `backend/src/routes/inventory.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeImportedTimestamp` | function | 28 |
| 2 | `recalcProductStock` | function | 36 |
| 3 | `findTransferByClientRequestId` | function | 40 |
| 4 | `getStockTransferNoteColumn` | function | 54 |
| 5 | `buildActiveBranchIndex` | function | 58 |
| 6 | `collectSetValues` | function | 73 |
| 7 | `compareInventoryProductRows` | function | 81 |
| 8 | `insertInventoryProductRowSorted` | function | 89 |
| 9 | `collectSortedInventoryProductRows` | function | 97 |
| 10 | `cleanMoveReason` | function | 105 |
| 11 | `normalizePositiveInt` | function | 111 |
| 12 | `hasInventoryStatsFilter` | function | 117 |
| 13 | `cleanInventoryReasonEntry` | function | 125 |
| 14 | `normalizeInventoryReasonList` | function | 139 |
| 15 | `loadSavedInventoryReasons` | function | 161 |
| 16 | `persistSavedInventoryReasons` | function | 172 |
| 17 | `splitSearchTerms` | function | 182 |
| 18 | `normalizeMovementDisplayText` | function | 198 |
| 19 | `sanitizeInventoryResponseProduct` | function | 209 |
| 20 | `appendInventoryProductFilters` | function | 222 |
| 21 | `hydrateInventoryProducts` | function | 278 |
| 22 | `appendAllocationMovementEntries` | function | 301 |
| 23 | `buildInsertColumnSql` | function | 316 |
| 24 | `buildInventoryFinancialJoinSql` | function | 329 |
| 25 | `inventoryFinancialSelectSql` | function | 435 |
| 26 | `getFilteredInventoryStats` | function | 449 |
| 27 | `normalizeRfidId` | function | 1231 |
| 28 | `getRfidSession` | function | 1235 |
| 29 | `getBranchLedgerQty` | function | 1239 |
| 30 | `refreshRfidSessionCounts` | function | 1243 |
| 31 | `upsertRfidSessionItem` | function | 1278 |
| 32 | `recordRfidEvent` | function | 1303 |

### 3.46 `backend/src/routes/notifications.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeBoolean` | function | 26 |
| 2 | `toNumber` | function | 34 |
| 3 | `pruneNotificationSummaryCache` | function | 39 |
| 4 | `getNotificationSummaryCacheKey` | function | 47 |
| 5 | `cloneNotificationSummaryPayload` | function | 60 |
| 6 | `getCachedNotificationSummary` | function | 64 |
| 7 | `setCachedNotificationSummary` | function | 73 |
| 8 | `buildPlaceholders` | function | 80 |
| 9 | `rowsToSettingMap` | function | 88 |
| 10 | `joinNotificationSummary` | function | 96 |
| 11 | `loadNotificationPreferences` | function | 104 |
| 12 | `loadPointPolicy` | function | 127 |
| 13 | `calculatePolicyPoints` | function | 152 |
| 14 | `buildInventoryItems` | function | 157 |
| 15 | `buildInventorySection` | function | 186 |
| 16 | `buildExpiryItems` | function | 209 |
| 17 | `buildExpirySection` | function | 229 |
| 18 | `buildSalesItems` | function | 251 |
| 19 | `buildSalesSection` | function | 280 |
| 20 | `rowsByCustomerId` | function | 326 |
| 21 | `buildLoyaltyMatches` | function | 334 |
| 22 | `buildLoyaltyItems` | function | 357 |
| 23 | `buildLoyaltySection` | function | 376 |
| 24 | `buildPortalItems` | function | 435 |
| 25 | `buildPortalSection` | function | 452 |
| 26 | `buildSystemSection` | function | 480 |
| 27 | `sumSectionCounts` | function | 510 |

### 3.47 `backend/src/routes/organizations.ts`

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
| 11 | `normalizePortalTranslations` | function | 111 |
| 12 | `normalizeProductIdList` | function | 125 |
| 13 | `loadSettingsMap` | function | 140 |
| 14 | `buildPortalConfig` | function | 150 |
| 15 | `buildRankMap` | function | 276 |
| 16 | `buildEmptyPortalMetric` | function | 297 |
| 17 | `collectPortalSignalRows` | function | 309 |
| 18 | `buildIdRankMap` | function | 322 |
| 19 | `buildRecommendedRankMap` | function | 331 |
| 20 | `getPortalProductSignals` | function | 339 |
| 21 | `buildPlaceholders` | function | 415 |
| 22 | `collectProductIds` | function | 421 |
| 23 | `getPortalProductAssets` | function | 427 |
| 24 | `buildPortalProductPayload` | function | 467 |
| 25 | `buildPortalProductPayloads` | function | 484 |
| 26 | `calculatePointsValue` | function | 493 |
| 27 | `summarizePoints` | function | 503 |
| 28 | `joinWrappedClauses` | function | 543 |
| 29 | `normalizePortalSubmissionRows` | function | 550 |
| 30 | `summarizeMembershipTotals` | function | 562 |
| 31 | `getPortalProducts` | function | 593 |
| 32 | `cacheTtl` | function | 632 |
| 33 | `normalizePositiveInt` | function | 636 |
| 34 | `splitSearchTerms` | function | 642 |
| 35 | `splitFilterValues` | function | 653 |
| 36 | `parsePositiveIds` | function | 664 |
| 37 | `buildNamedPlaceholders` | function | 673 |
| 38 | `appendSearchTermFilters` | function | 681 |
| 39 | `appendNamedFilter` | function | 697 |
| 40 | `normalizeLowerValues` | function | 713 |
| 41 | `appendPortalProductSearchFilters` | function | 719 |
| 42 | `collectRowValues` | function | 759 |
| 43 | `normalizeStringList` | function | 765 |
| 44 | `uniqueSortedStrings` | function | 776 |
| 45 | `getPortalCatalogSearchMetadata` | function | 790 |
| 46 | `distinctField` | const arrow | 795 |
| 47 | `getPortalCatalogProductPage` | function | 819 |
| 48 | `getCachedPortalConfig` | function | 882 |
| 49 | `getCachedPortalMeta` | function | 886 |
| 50 | `getCachedPortalProducts` | function | 890 |
| 51 | `getPortalCatalogMeta` | function | 895 |
| 52 | `findCustomerByMembership` | function | 935 |
| 53 | `sanitizeScreenshots` | function | 945 |
| 54 | `materializePortalScreenshots` | function | 958 |
| 55 | `sanitizeAiProfile` | function | 976 |
| 56 | `hasAiProfilePreference` | function | 987 |
| 57 | `getVisitorFingerprint` | function | 995 |
| 58 | `getClientKey` | function | 1001 |
| 59 | `applyPortalRateLimit` | function | 1006 |
| 60 | `collectRecommendationCitations` | function | 1014 |

### 3.49 `backend/src/routes/products.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getActiveBranches` | function | 53 |
| 2 | `settingsHasUpdatedAt` | function | 57 |
| 3 | `getDefaultBranch` | function | 61 |
| 4 | `getBranchById` | function | 70 |
| 5 | `findBranchByName` | function | 77 |
| 6 | `seedBranchRows` | function | 86 |
| 7 | `recalcProductStock` | function | 93 |
| 8 | `normalizeImageGallery` | function | 97 |
| 9 | `syncProductImageGallery` | function | 104 |
| 10 | `loadProductImageMap` | function | 123 |
| 11 | `attachImageGallery` | function | 144 |
| 12 | `findProductByClientRequestId` | function | 162 |
| 13 | `assertUniqueProductFields` | function | 172 |
| 14 | `normalizeProductIdentifier` | function | 220 |
| 15 | `hasOwnField` | function | 225 |
| 16 | `pickField` | function | 229 |
| 17 | `ensureParentProductExists` | function | 233 |
| 18 | `markParentProductAsGroup` | function | 243 |
| 19 | `normalizeImportLookup` | function | 248 |
| 20 | `normalizeLookup` | function | 252 |
| 21 | `collectUniquePositiveIds` | function | 256 |
| 22 | `collectNormalizedTokens` | function | 269 |
| 23 | `collectBoundedValues` | function | 283 |
| 24 | `collectSortedMapValues` | function | 292 |
| 25 | `insertSortedValue` | function | 300 |
| 26 | `normalizeImportFlagValue` | function | 308 |
| 27 | `getProductImportDetailSignature` | function | 341 |
| 28 | `chooseImportParentProduct` | function | 362 |
| 29 | `compareImportParentProduct` | function | 370 |
| 30 | `findImportProductWithSignature` | function | 383 |
| 31 | `normalizeImportAction` | function | 391 |
| 32 | `parseOptionalImportId` | function | 399 |
| 33 | `discountInsertColumns` | function | 406 |
| 34 | `discountValues` | function | 410 |
| 35 | `normalizeExpiryFields` | function | 425 |
| 36 | `normalizeBatchFields` | function | 436 |
| 37 | `seedOpeningBatch` | function | 443 |
| 38 | `normalizePositiveInt` | function | 458 |
| 39 | `parseInclude` | function | 464 |
| 40 | `splitSearchTerms` | function | 468 |
| 41 | `getProductCatalogSnapshotVersion` | function | 472 |
| 42 | `parseBrandOptionsSetting` | function | 485 |
| 43 | `sanitizeProductLookupPayload` | function | 495 |
| 44 | `buildLookupUsageEntries` | function | 508 |
| 45 | `buildLookupUsageSummary` | function | 575 |
| 46 | `appendProductSearchFilters` | function | 604 |
| 47 | `getProductSearchMetadata` | function | 681 |
| 48 | `distinctField` | const arrow | 686 |
| 49 | `attachBranchStock` | function | 717 |
| 50 | `expandProductFamilyRows` | function | 754 |
| 51 | `bindList` | const arrow | 778 |
| 52 | `normalizeLookup` | const arrow | 1510 |
| 53 | `resolveImage` | const arrow | 1620 |
| 54 | `ensureCategory` | const arrow | 1636 |
| 55 | `ensureUnit` | const arrow | 1651 |
| 56 | `ensureBrand` | const arrow | 1666 |
| 57 | `ensureSupplier` | const arrow | 1679 |
| 58 | `determineBranch` | const arrow | 1691 |
| 59 | `handleBranch` | const arrow | 1710 |
| 60 | `resetBatchStock` | const arrow | 1713 |
| 61 | `isDirectImageRef` | const arrow | 1750 |
| 62 | `normalizeDirectImageRef` | const arrow | 1761 |
| 63 | `parseIncomingImageRefs` | const arrow | 1768 |
| 64 | `loadCurrentGallery` | const arrow | 1804 |

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
| 10 | `assertSupplierReturnableStock` | function | 535 |

### 3.51 `backend/src/routes/runtime.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createProductFieldCounts` | function | 18 |
| 2 | `collectSuspiciousProductFields` | function | 26 |
| 3 | `summarizeSuspiciousProducts` | function | 36 |
| 4 | `parseJsonArray` | function | 62 |
| 5 | `summarizeSuspiciousTextValues` | function | 71 |
| 6 | `requireRuntimePermission` | function | 91 |

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
| 11 | `findSaleItemForProduct` | function | 142 |
| 12 | `findCustomerForSaleAssignment` | function | 149 |
| 13 | `parseBranchId` | function | 170 |
| 14 | `getActiveBranchContext` | function | 175 |
| 15 | `requireActiveBranch` | function | 197 |
| 16 | `resolveSaleItemBranchId` | function | 204 |
| 17 | `normalizeSaleItems` | function | 215 |
| 18 | `summarizeSaleBranch` | function | 249 |
| 19 | `refreshProductStockQuantity` | function | 281 |
| 20 | `refreshProductStockQuantities` | function | 285 |
| 21 | `deductBranchStock` | function | 292 |
| 22 | `restoreBranchStock` | function | 300 |
| 23 | `fetchSaleItemsWithBranches` | function | 308 |
| 24 | `findSaleByClientRequestId` | function | 317 |

### 3.53 `backend/src/routes/settings.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLookup` | function | 21 |
| 2 | `normalizeBrandOptionsValue` | function | 25 |
| 3 | `hasSuspiciousCatalogValue` | function | 47 |
| 4 | `normalizeBrandColorMapValue` | function | 54 |
| 5 | `settingsHasUpdatedAt` | function | 83 |
| 6 | `getSettingsSnapshot` | function | 87 |
| 7 | `collectAttemptedSettings` | function | 94 |
| 8 | `getSettingsUpdatedAt` | function | 106 |

### 3.54 `backend/src/routes/sync.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `stableStringify` | function | 47 |
| 2 | `sha256` | function | 65 |
| 3 | `verifyOperationDigest` | function | 69 |
| 4 | `normalizeOperation` | function | 76 |
| 5 | `normalizeOperations` | function | 89 |
| 6 | `hasWriteConflict` | function | 98 |
| 7 | `hasResultCode` | function | 105 |
| 8 | `hasBlockingReplayResult` | function | 112 |
| 9 | `buildReplayUrl` | function | 120 |
| 10 | `replayOperation` | function | 124 |
| 11 | `getUploadDir` | function | 218 |
| 12 | `readManifest` | function | 222 |

### 3.55 `backend/src/routes/system/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `auditWithActorMeta` | function | 87 |
| 2 | `q` | function | 105 |
| 3 | `buildSqlPlaceholders` | function | 109 |
| 4 | `joinRemainingImportJobIds` | function | 117 |
| 5 | `collectSystemSettingKeys` | function | 125 |
| 6 | `buildSettingsMap` | function | 133 |
| 7 | `buildSystemSettingEntries` | function | 141 |
| 8 | `sumNumericValues` | function | 149 |
| 9 | `getCustomTableNames` | function | 157 |
| 10 | `broadcastMany` | function | 166 |
| 11 | `dropCustomTables` | function | 172 |
| 12 | `clearTables` | function | 179 |
| 13 | `collectAppliedOperationIds` | function | 185 |
| 14 | `collectSortedSetValues` | function | 193 |
| 15 | `buildFolderEntries` | function | 202 |
| 16 | `buildExistingFavoriteFolders` | function | 214 |
| 17 | `listVisibleDirectories` | function | 226 |
| 18 | `buildPickerScript` | function | 237 |
| 19 | `getClientKey` | function | 252 |
| 20 | `applyRouteRateLimit` | function | 258 |
| 21 | `stopImportsBeforeDestructiveAction` | function | 270 |
| 22 | `runFsWorker` | function | 285 |
| 23 | `finish` | const arrow | 297 |
| 24 | `getHostUiAvailability` | function | 341 |
| 25 | `buildRequestBaseUrl` | function | 350 |
| 26 | `resolveDriveRedirectUri` | function | 357 |
| 27 | `getSafeTableCount` | function | 364 |
| 28 | `buildMigrationTableCounts` | function | 372 |
| 29 | `safeJsonParse` | function | 392 |
| 30 | `readSystemSettings` | function | 401 |
| 31 | `writeSystemSettings` | function | 409 |
| 32 | `getMigrationSafetyBackupDestination` | function | 425 |
| 33 | `getMigrationSafetyState` | function | 429 |
| 34 | `createMigrationSafetyBackup` | function | 451 |
| 35 | `runMigrationSafetyDriveSync` | function | 468 |
| 36 | `runMigrationSafetyAutomation` | function | 506 |
| 37 | `buildScaleMigrationStatus` | function | 521 |
| 38 | `readFinalBackupManifest` | function | 590 |
| 39 | `getDefaultBackupDestinationDir` | function | 594 |
| 40 | `createFolderBackup` | function | 600 |
| 41 | `restoreFolderBackup` | function | 637 |
| 42 | `sendBackupVersions` | function | 1007 |
| 43 | `listWindowsFsRoots` | const arrow | 1510 |
| 44 | `listDriveRoots` | const arrow | 1525 |

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
| 19 | `sanitizeUserRows` | function | 306 |
| 20 | `isValidEmail` | function | 314 |
| 21 | `getAuthIdentityList` | function | 319 |
| 22 | `isUuid` | function | 325 |
| 23 | `resolveAuthIdentityUuid` | function | 329 |
| 24 | `findFirstUuid` | function | 337 |
| 25 | `findProviderIdentity` | function | 344 |
| 26 | `buildAuthMethodsPayload` | function | 352 |

### 3.58 `backend/src/runtimeCache.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `enabled` | function | 32 |
| 2 | `namespacedKey` | function | 40 |
| 3 | `getClient` | function | 48 |
| 4 | `getJson` | function | 90 |
| 5 | `setJson` | function | 109 |
| 6 | `getOrSetJson` | function | 129 |
| 7 | `deleteByPrefix` | function | 141 |
| 8 | `deletePrefixesInOrder` | function | 164 |
| 9 | `prefixesForChannel` | function | 176 |
| 10 | `invalidateForChannel` | function | 201 |
| 11 | `pingRuntimeCache` | function | 213 |
| 12 | `getRuntimeCacheStatus` | function | 227 |

### 3.59 `backend/src/runtimeState/index.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ensureRuntimeMetaDir` | function | 16 |
| 2 | `readRuntimeState` | function | 23 |
| 3 | `writeRuntimeState` | function | 44 |
| 4 | `getRuntimeState` | function | 53 |
| 5 | `bumpStorageVersion` | function | 67 |
| 6 | `buildRuntimeDescriptor` | function | 80 |

### 3.60 `backend/src/runtimeVersion.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `firstExistingDir` | function | 27 |
| 2 | `collectExistingFiles` | function | 38 |
| 3 | `readGitRevision` | function | 50 |
| 4 | `collectFiles` | function | 70 |
| 5 | `computeSourceHash` | function | 87 |
| 6 | `emptyFrontendBuildInfo` | function | 114 |
| 7 | `readFrontendBuildInfoFromRoot` | function | 126 |
| 8 | `getRuntimeVersion` | function | 165 |

### 3.61 `backend/src/schemaMetadata.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeName` | function | 16 |
| 2 | `columnKey` | function | 25 |
| 3 | `normalizeNames` | function | 33 |
| 4 | `normalizeColumnRows` | function | 46 |
| 5 | `candidateKey` | function | 60 |
| 6 | `listColumns` | function | 68 |
| 7 | `hasColumn` | function | 83 |
| 8 | `firstExistingColumn` | function | 108 |
| 9 | `markColumnPresent` | function | 140 |

### 3.62 `backend/src/security.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeEncryptionKey` | function | 28 |
| 2 | `isEncryptionConfigured` | function | 48 |
| 3 | `encryptSecret` | function | 52 |
| 4 | `decryptSecret` | function | 65 |
| 5 | `pruneRateBucket` | function | 86 |
| 6 | `keepRecentTimestamps` | function | 98 |
| 7 | `checkRateLimit` | function | 113 |
| 8 | `resetRateLimit` | function | 142 |
| 9 | `safeCompare` | function | 149 |
| 10 | `getAbuseBucket` | function | 160 |
| 11 | `pruneAbuseBucket` | function | 170 |
| 12 | `checkAbuseLock` | function | 188 |
| 13 | `recordAbuseFailure` | function | 211 |
| 14 | `clearAbuseFailure` | function | 235 |

### 3.63 `backend/src/serverUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildOriginFromParts` | function | 13 |
| 2 | `parseOriginHost` | function | 24 |
| 3 | `normalizeConfiguredHost` | function | 34 |
| 4 | `getConfiguredPublicHosts` | function | 44 |
| 5 | `getConfiguredCustomerPortalHosts` | function | 55 |
| 6 | `isConfiguredCustomerPortalHost` | function | 67 |
| 7 | `isAllowedRequestOrigin` | function | 77 |
| 8 | `isAllowedWebSocketOrigin` | function | 86 |
| 9 | `hostIsLoopbackPair` | function | 103 |
| 10 | `getTrustedDocumentOrigins` | function | 108 |
| 11 | `addOrigin` | const arrow | 110 |
| 12 | `buildPermissionsPolicy` | function | 139 |
| 13 | `getCloudflareAccessDiagnostics` | function | 166 |
| 14 | `sanitizeObjectKeys` | function | 192 |
| 15 | `sanitizeStringValue` | function | 215 |
| 16 | `sanitizeRequestPayload` | function | 221 |
| 17 | `sanitizeDeepStrings` | function | 228 |
| 18 | `isApiOrHealthPath` | function | 245 |
| 19 | `isSpaFallbackEligible` | function | 249 |
| 20 | `setNoStoreHeaders` | function | 257 |
| 21 | `setHtmlNoCacheHeaders` | function | 263 |
| 22 | `isCustomerPortalRoutePath` | function | 270 |
| 23 | `setTunnelSecurityHeaders` | function | 275 |
| 24 | `setFrontendStaticHeaders` | function | 318 |
| 25 | `setUploadStaticHeaders` | function | 368 |
| 26 | `mapServerError` | function | 378 |

### 3.64 `backend/src/services/aiGateway.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 6 |
| 2 | `trim` | function | 10 |
| 3 | `parseJsonSafe` | function | 14 |
| 4 | `clamp` | function | 22 |
| 5 | `maskApiKey` | function | 26 |
| 6 | `normalizeTextList` | function | 33 |
| 7 | `getProviderMeta` | function | 106 |
| 8 | `normalizeProviderPayload` | function | 110 |
| 9 | `serializeProviderRow` | function | 137 |
| 10 | `providerCanUseWebResearch` | function | 170 |
| 11 | `resolveProviderEndpoint` | function | 175 |
| 12 | `buildProviderHttpError` | function | 182 |
| 13 | `host` | const arrow | 185 |
| 14 | `buildGoogleMessageContents` | function | 198 |
| 15 | `joinGoogleTextParts` | function | 209 |
| 16 | `callChatProvider` | function | 218 |
| 17 | `testProviderConfig` | function | 307 |

### 3.65 `backend/src/services/backupPackages.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readCachedBackupVersions` | function | 30 |
| 2 | `writeCachedBackupVersions` | function | 39 |
| 3 | `clearBackupVersionCaches` | function | 53 |
| 4 | `getDb` | function | 58 |
| 5 | `q` | function | 62 |
| 6 | `nowSafeId` | function | 66 |
| 7 | `sha256` | function | 70 |
| 8 | `createSha256` | function | 74 |
| 9 | `sha256File` | function | 78 |
| 10 | `readTableRows` | function | 88 |
| 11 | `yieldToEventLoop` | function | 105 |
| 12 | `throwIfAborted` | function | 109 |
| 13 | `collectSetValues` | function | 117 |
| 14 | `startWorkerPromises` | function | 125 |
| 15 | `getManagedWritableState` | function | 133 |
| 16 | `writeStream` | function | 164 |
| 17 | `closeWriteStream` | function | 178 |
| 18 | `handleFinish` | const arrow | 182 |
| 19 | `handleError` | const arrow | 187 |
| 20 | `cleanup` | const arrow | 191 |
| 21 | `createProgressReporter` | function | 201 |
| 22 | `getSafeTableCount` | function | 240 |
| 23 | `streamBackupDataFile` | function | 248 |
| 24 | `buildObjectManifest` | function | 308 |
| 25 | `buildPackageMetadata` | function | 326 |
| 26 | `writeTextFileWithChecksum` | function | 380 |
| 27 | `writeJsonLinesFileWithChecksum` | function | 385 |
| 28 | `uploadPackageFile` | function | 398 |
| 29 | `writeAndUploadMetadataFiles` | function | 418 |
| 30 | `retryOperation` | function | 444 |
| 31 | `writeDestinationChunk` | function | 459 |
| 32 | `endDestination` | function | 472 |
| 33 | `handleFinish` | const arrow | 476 |
| 34 | `handleError` | const arrow | 481 |
| 35 | `cleanup` | const arrow | 485 |
| 36 | `copyOnePackageObject` | function | 495 |
| 37 | `abortCopy` | const arrow | 507 |
| 38 | `copyPackageObjects` | function | 534 |
| 39 | `worker` | function | 543 |
| 40 | `createFinalBackupPackage` | function | 585 |
| 41 | `validateLocalBackupPackage` | function | 700 |
| 42 | `getLocalBackupRoot` | function | 724 |
| 43 | `isDockerReleaseBackupRoot` | function | 729 |
| 44 | `isLocalBackupDirectoryName` | function | 734 |
| 45 | `listLocalBackupDirectories` | function | 740 |
| 46 | `getDirectoryBytes` | function | 761 |
| 47 | `planBackupPackageRetention` | function | 787 |
| 48 | `pruneLocalBackupVersions` | function | 807 |
| 49 | `groupRemoteBackupObjects` | function | 833 |
| 50 | `packageIds` | function | 855 |
| 51 | `summarizeRemovedRemotePackages` | function | 863 |
| 52 | `collectRemoteDeleteKeys` | function | 878 |
| 53 | `sortBackupVersionsByPackageId` | function | 888 |
| 54 | `pruneRemoteBackupVersions` | function | 894 |
| 55 | `pruneBackupVersions` | function | 918 |
| 56 | `readReusableLocalBackupPackage` | function | 935 |
| 57 | `findReusableLocalBackupPackage` | function | 960 |
| 58 | `listLocalBackupVersions` | function | 971 |
| 59 | `listBackupVersions` | function | 1003 |

### 3.66 `backend/src/services/firebaseAuth.js`

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

### 3.67 `backend/src/services/googleDriveSync/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 80 |
| 2 | `trim` | function | 84 |
| 3 | `toBool` | function | 88 |
| 4 | `clamp` | function | 96 |
| 5 | `escapeDriveQueryValue` | function | 102 |
| 6 | `buildPlaceholders` | function | 106 |
| 7 | `readSettingsMap` | function | 114 |
| 8 | `writeSettingsMap` | function | 125 |
| 9 | `clearDriveSyncMappings` | function | 147 |
| 10 | `resetDriveSyncRootState` | function | 151 |
| 11 | `getDriveSyncConfig` | function | 161 |
| 12 | `getDriveSyncEntriesMap` | function | 197 |
| 13 | `hasCanonicalDriveLayout` | function | 210 |
| 14 | `upsertDriveSyncEntry` | function | 218 |
| 15 | `deleteDriveSyncEntry` | function | 255 |
| 16 | `deleteDriveSyncEntriesUnder` | function | 259 |
| 17 | `inferMimeType` | function | 266 |
| 18 | `hashFile` | function | 281 |
| 19 | `hashFileMany` | function | 291 |
| 20 | `yieldToEventLoop` | function | 315 |
| 21 | `sleep` | function | 319 |
| 22 | `buildAccessTokenKey` | function | 323 |
| 23 | `clearCachedAccessToken` | function | 330 |
| 24 | `describeFetchFailure` | function | 337 |
| 25 | `joinNonEmptyParts` | function | 351 |
| 26 | `fetchWithTimeout` | function | 359 |
| 27 | `exchangeRefreshToken` | function | 386 |
| 28 | `exchangeAuthorizationCode` | function | 428 |
| 29 | `driveApiRequest` | function | 451 |
| 30 | `driveApiUpload` | function | 468 |
| 31 | `fetchDriveUserProfile` | function | 484 |
| 32 | `findDriveItem` | function | 499 |
| 33 | `findDriveItems` | function | 504 |
| 34 | `listDriveChildren` | function | 519 |
| 35 | `getDriveFileIfExists` | function | 528 |
| 36 | `removeDuplicateDriveItems` | function | 540 |
| 37 | `buildSortedDirectoryList` | function | 552 |
| 38 | `getNonFolderDriveItems` | function | 561 |
| 39 | `getFirstNonFolderDriveItem` | function | 571 |
| 40 | `buildLiveSyncPathSet` | function | 578 |
| 41 | `selectStaleDriveMappings` | function | 589 |
| 42 | `createDriveFolder` | function | 598 |
| 43 | `ensureRootFolder` | function | 610 |
| 44 | `ensureDriveVersionFolder` | function | 629 |
| 45 | `writeSnapshotManifest` | function | 676 |
| 46 | `buildManagedSnapshotRoot` | function | 710 |
| 47 | `ensureSnapshotLayout` | function | 714 |
| 48 | `shouldSkipSnapshotFile` | function | 720 |
| 49 | `createDataRootSnapshot` | function | 727 |
| 50 | `collectSnapshotItems` | function | 769 |
| 51 | `ensureRemoteDirectories` | function | 819 |
| 52 | `updateRuntimeUploadProgress` | function | 870 |
| 53 | `clearRuntimeUploadProgress` | function | 877 |
| 54 | `initiateDriveResumableSession` | function | 884 |
| 55 | `queryResumableOffset` | function | 912 |
| 56 | `isInvalidUploadRequest` | function | 940 |
| 57 | `isDriveNotFoundError` | function | 944 |
| 58 | `isDriveWriteAccessError` | function | 948 |
| 59 | `canRecoverDriveItemWrite` | function | 956 |
| 60 | `putResumableChunk` | function | 960 |
| 61 | `uploadDriveFileResumable` | function | 995 |
| 62 | `uploadDriveFile` | function | 1069 |
| 63 | `updateDriveFile` | function | 1074 |
| 64 | `removeDriveFile` | function | 1079 |
| 65 | `runDriveSync` | function | 1091 |
| 66 | `runDriveSyncInternal` | function | 1102 |
| 67 | `scheduleDriveSync` | function | 1341 |
| 68 | `getDriveSyncStatus` | function | 1363 |
| 69 | `beginGoogleDriveOAuth` | function | 1412 |
| 70 | `prunePendingOauthStates` | function | 1436 |
| 71 | `finalizeGoogleDriveOAuth` | function | 1443 |
| 72 | `saveDriveSyncPreferences` | function | 1486 |
| 73 | `disconnectDriveSync` | function | 1507 |
| 74 | `forgetDriveSyncCredentials` | function | 1527 |
| 75 | `schedulePeriodicDriveSync` | function | 1535 |

### 3.68 `backend/src/services/googleDriveSync/versioning.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toSafeDate` | function | 25 |
| 2 | `toSafeVersionNumber` | function | 30 |
| 3 | `resolveDriveSyncVersionState` | function | 36 |
| 4 | `parseVersionName` | function | 75 |
| 5 | `buildDriveSyncVersionRows` | function | 81 |
| 6 | `selectDateExpiredVersions` | function | 101 |
| 7 | `selectExpiredDriveSyncVersions` | function | 113 |

### 3.69 `backend/src/services/googleOauth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 27 |
| 2 | `unique` | function | 31 |
| 3 | `appendCallbackPath` | function | 43 |
| 4 | `getGoogleLoginOrigins` | function | 53 |
| 5 | `getGoogleLoginRedirectUris` | function | 62 |
| 6 | `getPrimaryRedirectUri` | function | 70 |
| 7 | `getDefaultReturnPath` | function | 74 |
| 8 | `normalizeReturnTarget` | function | 80 |
| 9 | `base64url` | function | 117 |
| 10 | `sha256Base64Url` | function | 122 |
| 11 | `getStateSecret` | function | 126 |
| 12 | `signState` | function | 130 |
| 13 | `verifyState` | function | 136 |
| 14 | `getGoogleLoginPublicConfig` | function | 152 |
| 15 | `buildGoogleOauthStartUrl` | function | 165 |
| 16 | `exchangeGoogleOauthCode` | function | 196 |
| 17 | `getGoogleUserFromTokens` | function | 219 |

### 3.70 `backend/src/services/importJobs.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 65 |
| 2 | `wait` | function | 69 |
| 3 | `yieldImportWorker` | function | 73 |
| 4 | `countCsvRowsFromFile` | function | 78 |
| 5 | `safeJson` | function | 123 |
| 6 | `normalizeImportJobListLimit` | function | 128 |
| 7 | `clearImportJobListCache` | function | 132 |
| 8 | `readCachedImportJobList` | function | 136 |
| 9 | `canCacheImportJobList` | function | 144 |
| 10 | `writeCachedImportJobList` | function | 148 |
| 11 | `stringify` | function | 161 |
| 12 | `cleanAuditActorText` | function | 165 |
| 13 | `normalizeAuditActor` | function | 171 |
| 14 | `attachInternalPolicyMetadata` | function | 181 |
| 15 | `stripInternalPolicyMetadata` | function | 192 |
| 16 | `getPersistedAuditActor` | function | 198 |
| 17 | `mergeAuditActors` | function | 203 |
| 18 | `auditWithActor` | function | 213 |
| 19 | `decorateImportJobRow` | function | 231 |
| 20 | `isCancelRequested` | function | 241 |
| 21 | `isImportJobStale` | function | 248 |
| 22 | `isImportJobWorkDrained` | function | 254 |
| 23 | `markStoredImportFilesCancelled` | function | 266 |
| 24 | `reconcileImportJobRow` | function | 276 |
| 25 | `ensureDir` | function | 297 |
| 26 | `ensureImportRoot` | function | 301 |
| 27 | `getJobRoot` | function | 305 |
| 28 | `assertSafeImportPath` | function | 309 |
| 29 | `deleteImportJobFiles` | function | 318 |
| 30 | `clearImportRuntimeFiles` | function | 325 |
| 31 | `createImportJob` | function | 336 |
| 32 | `getImportJob` | function | 357 |
| 33 | `buildSqlPlaceholders` | function | 363 |
| 34 | `collectRowIds` | function | 371 |
| 35 | `decorateImportJobRows` | function | 379 |
| 36 | `listImportJobs` | function | 388 |
| 37 | `updateJob` | function | 421 |
| 38 | `addJobError` | function | 457 |
| 39 | `getJobErrors` | function | 464 |
| 40 | `normalizeReviewText` | function | 474 |
| 41 | `normalizeReviewIdentifier` | function | 478 |
| 42 | `getBarcodeReviewIssue` | function | 482 |
| 43 | `isBlockingBarcodeIssue` | function | 499 |
| 44 | `buildProductImportReviewState` | function | 503 |
| 45 | `add` | const arrow | 507 |
| 46 | `duplicateGroupCount` | const arrow | 520 |
| 47 | `hasReviewQueryMatch` | function | 537 |
| 48 | `normalizeReviewFilter` | function | 557 |
| 49 | `matchesReviewFilter` | function | 565 |
| 50 | `hasAnyIdentifierField` | function | 573 |
| 51 | `buildProductReviewLabels` | function | 580 |
| 52 | `buildContactReviewLabels` | function | 604 |
| 53 | `hasMeaningfulImportRowValue` | function | 613 |
| 54 | `addReviewConflictCounts` | function | 621 |
| 55 | `normalizeGroupDecisions` | function | 635 |
| 56 | `addSetValues` | function | 645 |
| 57 | `setValuesToArray` | function | 651 |
| 58 | `firstRowNumber` | function | 659 |
| 59 | `buildProductReviewIndex` | function | 663 |
| 60 | `getProductConflictForReview` | function | 690 |
| 61 | `getReviewRowNumber` | function | 773 |
| 62 | `summarizeImportReviewRow` | function | 778 |
| 63 | `addProductReviewGroup` | function | 798 |
| 64 | `finalizeProductReviewSubgroups` | function | 843 |
| 65 | `finalizeProductReviewGroups` | function | 868 |
| 66 | `buildContactReviewIndex` | function | 890 |
| 67 | `getContactConflictForReview` | function | 910 |
| 68 | `getGenericImportConflictForReview` | function | 956 |
| 69 | `applyImportDecisionToRow` | function | 969 |
| 70 | `getImportDecisionMap` | function | 1037 |
| 71 | `getImportJobReview` | function | 1046 |
| 72 | `updateImportJobDecisions` | function | 1146 |
| 73 | `addJobFile` | function | 1174 |
| 74 | `getJobFiles` | function | 1194 |
| 75 | `markJobCancelled` | function | 1199 |
| 76 | `isCancelled` | function | 1203 |
| 77 | `waitForQueuedImportMedia` | function | 1209 |
| 78 | `finalizeSkippedImportImages` | function | 1236 |
| 79 | `normalizeLookup` | function | 1253 |
| 80 | `normalizeText` | function | 1257 |
| 81 | `getMimeTypeFromName` | function | 1261 |
| 82 | `normalizeProductSignature` | function | 1329 |
| 83 | `findProductWithSignature` | function | 1340 |
| 84 | `chooseParentProduct` | function | 1348 |
| 85 | `compareParentProductCandidate` | function | 1357 |
| 86 | `normalizeImportAction` | function | 1369 |
| 87 | `parseOptionalImportId` | function | 1377 |
| 88 | `parseIncomingImageRefs` | function | 1382 |
| 89 | `syncProductImageGallery` | function | 1413 |
| 90 | `loadCurrentGallery` | function | 1439 |
| 91 | `ensureParentProductExists` | function | 1451 |
| 92 | `assertUniqueProductFields` | function | 1460 |
| 93 | `findProductIdentifierConflict` | function | 1503 |
| 94 | `normalizeIdentifierConflictMode` | function | 1533 |
| 95 | `resolveNewProductIdentifiers` | function | 1541 |
| 96 | `copyImageIntoAssets` | function | 1578 |
| 97 | `resolveImageGallery` | function | 1617 |
| 98 | `ensureSettingOptionMap` | function | 1673 |
| 99 | `buildLookupMap` | function | 1692 |
| 100 | `getDefaultBranch` | function | 1700 |
| 101 | `upsertSettingJson` | function | 1709 |
| 102 | `normalizeRowForProduct` | function | 1716 |
| 103 | `createProductContext` | function | 1764 |
| 104 | `sortProductImportRows` | function | 1793 |
| 105 | `compareProductImportRows` | function | 1801 |
| 106 | `insertProductImportRow` | function | 1811 |
| 107 | `getProductsByNameForImport` | function | 1828 |
| 108 | `rememberProductForImport` | function | 1843 |
| 109 | `buildImportSignatureKey` | function | 1850 |
| 110 | `ensureCategory` | function | 1856 |
| 111 | `ensureUnit` | function | 1869 |
| 112 | `ensureBrand` | function | 1881 |
| 113 | `ensureSupplier` | function | 1894 |
| 114 | `determineBranch` | function | 1908 |
| 115 | `clearBranchBatchStockForProduct` | function | 1925 |
| 116 | `handleBranchStock` | function | 1936 |
| 117 | `recalcProductStock` | function | 1953 |
| 118 | `insertInventoryMovement` | function | 1957 |
| 119 | `seedBranchRows` | function | 1985 |
| 120 | `processProductRow` | function | 1992 |
| 121 | `processProductRowBatches` | function | 2282 |
| 122 | `flushProgress` | const arrow | 2294 |
| 123 | `processProductRows` | function | 2395 |
| 124 | `buildSafeCatalogOptionList` | function | 2405 |
| 125 | `preflightImportJob` | function | 2414 |
| 126 | `addFailure` | const arrow | 2428 |
| 127 | `buildImageLookup` | function | 2521 |
| 128 | `addImageLookupCandidate` | function | 2531 |
| 129 | `normalizeImageMatchKey` | function | 2536 |
| 130 | `processImageOnlyFiles` | function | 2546 |
| 131 | `addImageProductKey` | function | 2607 |
| 132 | `normalizeContactMode` | function | 2612 |
| 133 | `resolveContactValue` | function | 2617 |
| 134 | `parseFieldRules` | function | 2625 |
| 135 | `generateCustomerMembershipNumber` | function | 2631 |
| 136 | `normalizeImportedMembershipNumber` | function | 2647 |
| 137 | `processContactRowBatches` | function | 2653 |
| 138 | `processContactRows` | function | 2822 |
| 139 | `normalizeInventoryAction` | function | 2832 |
| 140 | `addCsvLookupValue` | function | 2839 |
| 141 | `buildProductCsvLookupMap` | function | 2845 |
| 142 | `buildBranchCsvLookupMap` | function | 2856 |
| 143 | `processInventoryRowBatches` | function | 2865 |
| 144 | `processInventoryRows` | function | 2955 |
| 145 | `processSalesRowBatches` | function | 2964 |
| 146 | `processSalesRows` | function | 3167 |
| 147 | `extractZipImages` | function | 3176 |
| 148 | `processImportJob` | function | 3246 |
| 149 | `runLocalJob` | function | 3384 |
| 150 | `normalizeQueueMode` | function | 3391 |
| 151 | `queueNameForMode` | function | 3395 |
| 152 | `configuredQueueDriver` | function | 3399 |
| 153 | `getImportQueueConcurrency` | function | 3404 |
| 154 | `hasBullProducer` | function | 3408 |
| 155 | `hasBullWorkers` | function | 3412 |
| 156 | `removeQueuedBullJobsForImport` | function | 3416 |
| 157 | `getBullConnection` | function | 3439 |
| 158 | `initializeBullQueue` | function | 3452 |
| 159 | `startImportWorkers` | function | 3471 |
| 160 | `startWorker` | const arrow | 3478 |
| 161 | `enqueueImportJob` | function | 3514 |
| 162 | `resetImportJobForRetry` | function | 3557 |
| 163 | `cancelImportJob` | function | 3610 |
| 164 | `listCancellableImportJobs` | function | 3643 |
| 165 | `waitForImportJobsToStop` | function | 3652 |
| 166 | `cancelAllImportJobs` | function | 3680 |
| 167 | `deleteImportJob` | function | 3712 |
| 168 | `deleteAllImportJobs` | function | 3743 |
| 169 | `approveImportJob` | function | 3760 |
| 170 | `recoverImportJobs` | function | 3784 |
| 171 | `getUnprocessedJobFiles` | function | 3806 |
| 172 | `getQueueStatus` | function | 3814 |
| 173 | `buildErrorsCsv` | function | 3831 |
| 174 | `escape` | const arrow | 3833 |
| 175 | `joinEscapedCsvRow` | function | 3846 |

### 3.71 `backend/src/services/integrationDoctor.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 44 |
| 2 | `hasValue` | function | 48 |
| 3 | `redactPresence` | function | 52 |
| 4 | `status` | function | 59 |
| 5 | `allCriticalChecksOk` | function | 67 |
| 6 | `unique` | function | 80 |
| 7 | `buildExpectedOauthChecklist` | function | 92 |
| 8 | `probeDatabase` | function | 120 |
| 9 | `getSafeTableCount` | function | 130 |
| 10 | `readCurrentBusinessCounts` | function | 139 |
| 11 | `findLatestVerifiedReleaseBackup` | function | 153 |
| 12 | `probeQueue` | function | 178 |
| 13 | `probeBackups` | function | 199 |
| 14 | `buildIntegrationDoctor` | function | 216 |

### 3.72 `backend/src/services/mediaQueue.js`

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

### 3.73 `backend/src/services/portalAi.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 15 |
| 2 | `toNumber` | function | 19 |
| 3 | `tokenize` | function | 24 |
| 4 | `nowMs` | function | 36 |
| 5 | `getProviderPriority` | function | 40 |
| 6 | `getProviderCapacity` | function | 45 |
| 7 | `getProviderMaxInputChars` | function | 50 |
| 8 | `getProviderMaxCompletionTokens` | function | 55 |
| 9 | `getProviderTimeoutMs` | function | 60 |
| 10 | `getProviderCooldownMs` | function | 65 |
| 11 | `getRuntimeState` | function | 71 |
| 12 | `pruneProviderState` | function | 86 |
| 13 | `keepRecentTimestamps` | function | 92 |
| 14 | `pruneVisitorActivity` | function | 100 |
| 15 | `registerVisitorActivity` | function | 108 |
| 16 | `countActiveVisitors` | function | 118 |
| 17 | `getVisitorMinuteCount` | function | 123 |
| 18 | `summarizeProfile` | function | 130 |
| 19 | `sanitizeQuestion` | function | 140 |
| 20 | `scoreProduct` | function | 144 |
| 21 | `buildQueryTermSet` | function | 176 |
| 22 | `productMatchesPreference` | function | 185 |
| 23 | `toPromptCandidate` | function | 195 |
| 24 | `selectCandidateProducts` | function | 212 |
| 25 | `buildPrompt` | function | 236 |
| 26 | `takeTrimmedStrings` | function | 266 |
| 27 | `normalizeCitations` | function | 277 |
| 28 | `buildRecommendationPayloads` | function | 293 |
| 29 | `parseAssistantPayload` | function | 322 |
| 30 | `listEnabledChatProviders` | function | 351 |
| 31 | `chooseProviderForAttempt` | function | 373 |
| 32 | `markProviderStart` | function | 395 |
| 33 | `markProviderSuccess` | function | 403 |
| 34 | `markProviderFailure` | function | 410 |
| 35 | `sumProviderCapacity` | function | 418 |
| 36 | `buildProviderUsageItems` | function | 426 |
| 37 | `getPortalAiUsageStatus` | function | 445 |
| 38 | `minProviderInputChars` | function | 460 |
| 39 | `hasAnyProfileValue` | function | 468 |
| 40 | `productsById` | function | 475 |
| 41 | `remainingProviders` | function | 483 |
| 42 | `generatePortalAiResponse` | function | 491 |

### 3.74 `backend/src/services/verification.js`

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

### 3.75 `backend/src/sessionAuth.js`

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

### 3.76 `backend/src/settingsSnapshot.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeUploadPublicPath` | function | 16 |
| 2 | `isUploadPublicPath` | function | 33 |
| 3 | `toUploadObjectKey` | function | 41 |
| 4 | `sanitizeMediaPath` | function | 52 |
| 5 | `sanitizeMediaPathAsync` | function | 65 |
| 6 | `sanitizeMediaList` | function | 84 |
| 7 | `sanitizeMediaListAsync` | function | 101 |
| 8 | `uploadPublicPathExists` | function | 117 |
| 9 | `sanitizeSettingValue` | function | 132 |
| 10 | `sanitizeSettingValueAsync` | function | 140 |
| 11 | `sanitizeSettingsSnapshot` | function | 147 |
| 12 | `sanitizeSettingsSnapshotAsync` | function | 158 |

### 3.77 `backend/src/storage/organizationFolders.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 7 |
| 2 | `sanitizeOrganizationFolderLabel` | function | 12 |
| 3 | `buildOrganizationFolderName` | function | 23 |
| 4 | `extractOrganizationPublicId` | function | 30 |
| 5 | `findOrganizationFolderByPublicId` | function | 38 |

### 3.78 `backend/src/systemFsWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatBackupStamp` | function | 23 |
| 2 | `pad` | const arrow | 25 |
| 3 | `respond` | function | 33 |
| 4 | `fail` | function | 41 |
| 5 | `runExportFolder` | function | 50 |
| 6 | `runRelocateDataRoot` | function | 94 |
| 7 | `main` | function | 104 |

### 3.79 `backend/src/systemJobs.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 12 |
| 2 | `makeJobId` | function | 16 |
| 3 | `publicJob` | function | 20 |
| 4 | `findActiveJob` | function | 44 |
| 5 | `safeJsonParse` | function | 55 |
| 6 | `getDb` | function | 64 |
| 7 | `ensureTable` | function | 68 |
| 8 | `persistJob` | function | 124 |
| 9 | `collectFinishedJobs` | function | 171 |
| 10 | `removeOldFinishedJobs` | function | 182 |
| 11 | `serializeJobRows` | function | 188 |
| 12 | `listActiveJobs` | function | 198 |
| 13 | `cleanupJobs` | function | 207 |
| 14 | `buildPersistSignature` | function | 224 |
| 15 | `markPersisted` | function | 239 |
| 16 | `flushPersistJob` | function | 244 |
| 17 | `shouldPersistJob` | function | 256 |
| 18 | `schedulePersistJob` | function | 274 |
| 19 | `updateJob` | function | 285 |
| 20 | `SystemJobCancelledError` | class | 302 |
| 21 | `startSystemJob` | function | 310 |
| 22 | `runWorker` | const arrow | 339 |
| 23 | `isCancelled` | const arrow | 358 |
| 24 | `throwIfCancelled` | const arrow | 359 |
| 25 | `progress` | const arrow | 362 |
| 26 | `cancelSystemJob` | function | 415 |
| 27 | `getSystemJob` | function | 432 |
| 28 | `listSystemJobs` | function | 444 |

### 3.80 `backend/src/uploadReferenceCleanup.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `safeJsonArray` | function | 13 |
| 2 | `repairMissingUploadReferences` | function | 22 |
| 3 | `repairMissingUploadReferencesAsync` | function | 134 |

### 3.81 `backend/src/uploadSecurity.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `bufferStartsWith` | function | 16 |
| 2 | `isLikelyCsvBuffer` | function | 26 |
| 3 | `detectBufferKind` | function | 42 |
| 4 | `getExpectedUploadedKind` | function | 63 |
| 5 | `validateImageMetadata` | function | 75 |
| 6 | `validateUploadedBuffer` | function | 93 |
| 7 | `validateUploadedPath` | function | 108 |

### 3.82 `backend/src/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `attachWss` | function | 24 |

### 3.83 `backend/src/workers/importWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `start` | function | 13 |
| 2 | `shutdown` | function | 23 |

### 3.84 `backend/src/workers/mediaWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `start` | function | 13 |
| 2 | `shutdown` | function | 22 |

### 3.85 `backend/test/accessControl.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |
| 2 | `makeReq` | function | 22 |

### 3.86 `backend/test/analyticsRuntime.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |

### 3.87 `backend/test/authOtpGuards.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |

### 3.88 `backend/test/authSecurityFlow.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 19 |
| 2 | `runTests` | function | 23 |
| 3 | `makeTempRoot` | function | 37 |
| 4 | `getFreePort` | function | 41 |
| 5 | `waitForHealth` | function | 52 |
| 6 | `startServer` | function | 64 |
| 7 | `captureOutput` | const arrow | 67 |
| 8 | `stopServer` | function | 93 |
| 9 | `fetchJson` | function | 107 |
| 10 | `getDefaultOrganizationIds` | function | 119 |
| 11 | `cleanupTestUser` | function | 143 |
| 12 | `createTestUser` | function | 152 |
| 13 | `extractSessionCookie` | function | 171 |
| 14 | `login` | function | 178 |

### 3.89 `backend/test/backupDefaultDestination.test.ts`

- No top-level named symbols detected.

### 3.90 `backend/test/backupPerformanceHardening.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |

### 3.91 `backend/test/backupRetention.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.92 `backend/test/backupSchema.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 17 |

### 3.93 `backend/test/branchStockSearch.test.ts`

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

### 3.94 `backend/test/contactOptions.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.95 `backend/test/dataPath.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 16 |
| 2 | `makeTempRoot` | function | 27 |

### 3.96 `backend/test/defaultRoles.test.ts`

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

### 3.97 `backend/test/fileAssetStorageReconcile.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |

### 3.98 `backend/test/fileAssetUsageCache.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.99 `backend/test/fileRouteSecurityFlow.test.ts`

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

### 3.100 `backend/test/fullAutomation.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `read` | function | 9 |
| 2 | `runTest` | function | 13 |

### 3.101 `backend/test/googleDriveSyncVersioning.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 15 |

### 3.102 `backend/test/idempotency.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.103 `backend/test/importCsv.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 13 |
| 2 | `collectBatches` | function | 26 |

### 3.104 `backend/test/importDecisionIntegrity.test.ts`

- No top-level named symbols detected.

### 3.105 `backend/test/importJobPerformanceHardening.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |

### 3.106 `backend/test/importJobStateMachine.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 35 |
| 2 | `writeImportFile` | function | 46 |
| 3 | `writeJobFile` | function | 53 |
| 4 | `main` | function | 60 |

### 3.107 `backend/test/importScaleSmoke.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |
| 2 | `makeLargeCsv` | function | 23 |
| 3 | `assertLargeCsvSmoke` | function | 38 |

### 3.108 `backend/test/initials.test.ts`

- No top-level named symbols detected.

### 3.109 `backend/test/integrationDoctor.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |

### 3.110 `backend/test/inventorySettingsMediaContracts.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |
| 2 | `readSource` | function | 20 |

### 3.111 `backend/test/mediaOptimization.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |
| 2 | `buildDeterministicPixels` | function | 34 |
| 3 | `buildLogoPixels` | function | 44 |

### 3.112 `backend/test/netSecurity.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |

### 3.113 `backend/test/notificationSummaryCache.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 16 |

### 3.114 `backend/test/offlineSecurity.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `read` | function | 5 |
| 2 | `runTest` | function | 9 |

### 3.115 `backend/test/ownedGoogleAuth.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `read` | function | 9 |
| 2 | `runTest` | function | 13 |

### 3.116 `backend/test/permissionPolicy.test.ts`

- No top-level named symbols detected.

### 3.117 `backend/test/portalInventoryRegression.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |
| 2 | `readSource` | function | 20 |

### 3.118 `backend/test/portalUtils.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.119 `backend/test/postgresCutoverReadiness.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 10 |

### 3.120 `backend/test/postgresDatabase.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 10 |
| 2 | `FakeClient` | class | 21 |
| 3 | `createFakeDb` | function | 37 |

### 3.121 `backend/test/postgresQueryCompat.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.122 `backend/test/productBatchHierarchy.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |
| 2 | `readSource` | function | 20 |

### 3.123 `backend/test/productExpiry.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |

### 3.124 `backend/test/productImportPolicies.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 15 |

### 3.125 `backend/test/productSearchPagination.test.ts`

- No top-level named symbols detected.

### 3.126 `backend/test/rfidRoutes.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 7 |

### 3.127 `backend/test/routeContracts.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |
| 2 | `getRoutePaths` | function | 20 |

### 3.128 `backend/test/runtimeCache.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 24 |
| 2 | `main` | function | 35 |

### 3.129 `backend/test/runtimeVersion.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |

### 3.130 `backend/test/schemaMetadata.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 7 |
| 2 | `loadSchemaMetadataWithColumns` | function | 18 |
| 3 | `cleanup` | const arrow | 46 |

### 3.131 `backend/test/security.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 18 |

### 3.132 `backend/test/serverUtils.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 22 |
| 2 | `collectHeaders` | const arrow | 230 |

### 3.133 `backend/test/settingsSnapshotObjectStorage.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 7 |
| 2 | `withObjectStoreStub` | function | 23 |
| 3 | `restore` | const arrow | 38 |
| 4 | `createFakeCleanupDb` | function | 51 |

### 3.134 `backend/test/systemJobs.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `wait` | function | 6 |
| 2 | `waitForStatus` | function | 10 |
| 3 | `main` | function | 20 |

### 3.135 `backend/test/uploadSecurity.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.136 `frontend/public/runtime-noise-guard.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `text` | function | 10 |
| 2 | `sourceFromEvent` | function | 14 |
| 3 | `isFirstPartyAsset` | function | 23 |
| 4 | `isInjectedSource` | function | 27 |
| 5 | `isKnownNoise` | function | 32 |
| 6 | `suppress` | function | 45 |

### 3.137 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.js`

- No top-level named symbols detected.

### 3.138 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.worker.js`

- No top-level named symbols detected.

### 3.139 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd-threads.js`

- No top-level named symbols detected.

### 3.140 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd.js`

- No top-level named symbols detected.

### 3.141 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core.js`

- No top-level named symbols detected.

### 3.142 `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js`

- No top-level named symbols detected.

### 3.143 `frontend/public/sw.js`

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

### 3.144 `frontend/public/theme-bootstrap.js`

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

### 3.145 `frontend/src/api/http.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSyncServerUrl` | export function | 54 |
| 2 | `getSyncToken` | export function | 55 |
| 3 | `setSyncServerUrl` | export function | 57 |
| 4 | `setSyncToken` | export function | 58 |
| 5 | `hasStoredAuthSession` | function | 77 |
| 6 | `isProtectedAdminHost` | function | 86 |
| 7 | `normalizeApiPath` | function | 103 |
| 8 | `isRequiredRuntimeApiPath` | export function | 115 |
| 9 | `getApiMismatchKey` | function | 120 |
| 10 | `getApiVersionMismatchCooldown` | export function | 124 |
| 11 | `dispatchApiVersionMismatch` | function | 135 |
| 12 | `createApiVersionMismatchError` | export function | 149 |
| 13 | `isApiVersionMismatchError` | export function | 160 |
| 14 | `markApiVersionMismatch` | export function | 164 |
| 15 | `cacheGet` | export function | 174 |
| 16 | `cacheSet` | export function | 178 |
| 17 | `cacheInvalidate` | export function | 179 |
| 18 | `cacheClearAll` | export function | 182 |
| 19 | `logCall` | function | 210 |
| 20 | `getCallLog` | export function | 215 |
| 21 | `clearCallLog` | export function | 216 |
| 22 | `getClientMetaHeaders` | function | 218 |
| 23 | `createApiError` | function | 222 |
| 24 | `isCloudflareAccessRedirectResponse` | export function | 238 |
| 25 | `createCloudflareAccessError` | function | 251 |
| 26 | `dispatchUnauthorized` | function | 261 |
| 27 | `shouldCompareRuntimeVersions` | export function | 273 |
| 28 | `dispatchRuntimeVersionMismatch` | function | 289 |
| 29 | `checkRuntimeVersionFromHealth` | function | 301 |
| 30 | `createWriteBlockedError` | function | 308 |
| 31 | `dispatchWriteBlocked` | function | 319 |
| 32 | `dispatchTransientGatewayOutage` | function | 334 |
| 33 | `isWriteConflictError` | export function | 350 |
| 34 | `isWriteBlockedError` | export function | 354 |
| 35 | `isInvalidSessionError` | export function | 358 |
| 36 | `requireLiveServerWrite` | export function | 367 |
| 37 | `getConflictRefreshChannels` | function | 399 |
| 38 | `dispatchGlobalDataRefresh` | function | 408 |
| 39 | `sleep` | function | 417 |
| 40 | `hasUsableLocalData` | function | 421 |
| 41 | `noteReadFailure` | function | 447 |
| 42 | `stableStringifyForDedupe` | function | 468 |
| 43 | `clampDedupeBody` | function | 478 |
| 44 | `buildApiRequestDedupeKey` | export function | 484 |
| 45 | `methodAllowsRequestBody` | function | 490 |
| 46 | `__resetApiWriteDedupeForTests` | export function | 495 |
| 47 | `apiFetch` | export function | 500 |
| 48 | `parsed` | const arrow | 557 |
| 49 | `isNetErr` | export function | 596 |
| 50 | `isTransientGatewayError` | export function | 602 |
| 51 | `isReachableServerResponseStatus` | export function | 607 |
| 52 | `shouldDispatchUnauthorized` | function | 618 |
| 53 | `isConnectivityError` | function | 631 |
| 54 | `isServerOnline` | export function | 652 |
| 55 | `setServerHealth` | function | 654 |
| 56 | `pingServerHealth` | function | 667 |
| 57 | `startHealthCheck` | export function | 699 |
| 58 | `cacheGetStale` | export function | 730 |
| 59 | `getChannelRefreshKey` | function | 739 |
| 60 | `emitCacheRefresh` | function | 744 |
| 61 | `clearInflight` | function | 758 |
| 62 | `hasReusableInflight` | function | 763 |

### 3.146 `frontend/src/api/localDb.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `localGetSettings` | export function | 148 |
| 2 | `localSaveSettings` | export function | 155 |
| 3 | `localGetSettingsMeta` | export function | 163 |
| 4 | `localSaveSettingsMeta` | export function | 167 |
| 5 | `replaceTableContents` | export function | 177 |
| 6 | `resetLocalMirrorDb` | export function | 221 |
| 7 | `clearLocalMirrorTables` | export function | 236 |
| 8 | `parseCSV` | export function | 264 |
| 9 | `splitCSVLine` | function | 268 |
| 10 | `buildCSVTemplate` | export function | 279 |

### 3.147 `frontend/src/api/methods.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDeviceInfo` | function | 6 |
| 2 | `getPortalBaseUrl` | function | 55 |
| 3 | `buildQueryString` | function | 60 |
| 4 | `appendQuery` | function | 71 |
| 5 | `normalizePositiveUniqueIds` | function | 75 |
| 6 | `buildAttemptedSettings` | function | 90 |
| 7 | `buildAttemptedReturnItems` | function | 99 |
| 8 | `getCurrentUserContext` | function | 111 |
| 9 | `dispatchSyncUpdates` | function | 136 |
| 10 | `registerOutboxBackgroundSync` | function | 146 |
| 11 | `hasStoredUserSession` | function | 158 |
| 12 | `emitSyncQueueChanged` | function | 167 |
| 13 | `discardPendingSyncQueue` | export function | 174 |
| 14 | `createClientRequestId` | function | 186 |
| 15 | `ensureClientRequestId` | function | 193 |
| 16 | `serializePendingSyncPreview` | function | 199 |
| 17 | `getPendingSyncState` | export function | 222 |
| 18 | `retryPendingSyncNow` | export function | 250 |
| 19 | `canRefreshOfflineDeviceSnapshot` | function | 254 |
| 20 | `readOfflineDeviceSnapshotMeta` | function | 261 |
| 21 | `writeOfflineDeviceSnapshotMeta` | function | 269 |
| 22 | `runOfflineSnapshotStep` | function | 286 |
| 23 | `refreshOfflineDeviceSnapshot` | export function | 298 |
| 24 | `previousMeta` | const arrow | 306 |
| 25 | `invalidateClientRuntimeState` | function | 351 |
| 26 | `withExpectedUpdatedAt` | function | 367 |
| 27 | `withSettingsExpectedUpdatedAt` | function | 381 |
| 28 | `appendActorQuery` | function | 391 |
| 29 | `fetchJsonWithTimeout` | function | 406 |
| 30 | `mirrorReadResult` | function | 424 |
| 31 | `routeMirrored` | function | 433 |
| 32 | `shouldPersistLocalMirror` | function | 439 |
| 33 | `purgeSensitiveLiveServerMirrors` | function | 443 |
| 34 | `mirrorTable` | function | 454 |
| 35 | `buildQueryCacheStorageKey` | function | 471 |
| 36 | `readCachedQueryResult` | function | 475 |
| 37 | `writeCachedQueryResult` | function | 489 |
| 38 | `clearCachedQueryResults` | function | 503 |
| 39 | `getNotificationSummaryFallback` | function | 546 |
| 40 | `getDriveSyncStatusFallback` | function | 555 |
| 41 | `readNotificationSummaryMissingUntil` | function | 563 |
| 42 | `markNotificationSummaryMissing` | function | 575 |
| 43 | `clearNotificationSummaryMissing` | function | 590 |
| 44 | `readStorageNumber` | function | 599 |
| 45 | `writeStorageNumber` | function | 615 |
| 46 | `clearStorageNumber` | function | 626 |
| 47 | `login` | export function | 638 |
| 48 | `logout` | export function | 650 |
| 49 | `resetPasswordWithOtp` | export function | 653 |
| 50 | `requestPasswordResetEmail` | export function | 656 |
| 51 | `completePasswordReset` | export function | 659 |
| 52 | `updateSessionDuration` | export function | 662 |
| 53 | `getVerificationCapabilities` | export function | 665 |
| 54 | `getSystemConfig` | export function | 668 |
| 55 | `getNotificationSummary` | export function | 671 |
| 56 | `getSystemDebugLog` | export function | 713 |
| 57 | `startGoogleOauth` | export function | 716 |
| 58 | `completeGoogleOauth` | export function | 719 |
| 59 | `unlinkGoogleOauth` | export function | 722 |
| 60 | `getAppBootstrap` | export function | 725 |
| 61 | `buildLocalBootstrap` | const arrow | 726 |
| 62 | `getOrganizationBootstrap` | export function | 783 |
| 63 | `searchOrganizations` | export function | 786 |
| 64 | `getCurrentOrganization` | export function | 790 |
| 65 | `getSettings` | export function | 795 |
| 66 | `saveSettings` | export function | 816 |
| 67 | `runSave` | const arrow | 817 |
| 68 | `getCategories` | const arrow | 875 |
| 69 | `createCategory` | const arrow | 876 |
| 70 | `updateCategory` | const arrow | 881 |
| 71 | `deleteCategory` | const arrow | 886 |
| 72 | `getUnits` | const arrow | 893 |
| 73 | `createUnit` | const arrow | 894 |
| 74 | `updateUnit` | const arrow | 899 |
| 75 | `deleteUnit` | const arrow | 904 |
| 76 | `getBranches` | const arrow | 911 |
| 77 | `getBranchSummary` | const arrow | 912 |
| 78 | `updateBranch` | const arrow | 914 |
| 79 | `deleteBranch` | const arrow | 918 |
| 80 | `getBranchStock` | const arrow | 922 |
| 81 | `getTransfers` | const arrow | 926 |
| 82 | `getBranchStockIntegrity` | const arrow | 928 |
| 83 | `getProducts` | const arrow | 932 |
| 84 | `searchProducts` | const arrow | 933 |
| 85 | `getProductsByIds` | const arrow | 943 |
| 86 | `getProductFilters` | const arrow | 954 |
| 87 | `getProductLookupUsage` | const arrow | 964 |
| 88 | `replaceProductLookupValues` | const arrow | 972 |
| 89 | `getCatalogMeta` | export function | 985 |
| 90 | `getCatalogProducts` | export function | 993 |
| 91 | `getPortalConfig` | export function | 1001 |
| 92 | `getPortalBootstrap` | export function | 1009 |
| 93 | `getPortalCatalogMeta` | export function | 1017 |
| 94 | `getPortalCatalogProducts` | export function | 1025 |
| 95 | `searchPortalCatalogProducts` | export function | 1033 |
| 96 | `lookupPortalMembership` | export function | 1045 |
| 97 | `createPortalSubmission` | export function | 1055 |
| 98 | `getPortalAiStatus` | export function | 1069 |
| 99 | `askPortalAi` | export function | 1077 |
| 100 | `getPortalSubmissionsForReview` | const arrow | 1091 |
| 101 | `reviewPortalSubmission` | const arrow | 1093 |
| 102 | `getAiProviders` | const arrow | 1096 |
| 103 | `createAiProvider` | const arrow | 1098 |
| 104 | `updateAiProvider` | const arrow | 1100 |
| 105 | `deleteAiProvider` | const arrow | 1102 |
| 106 | `testAiProvider` | const arrow | 1104 |
| 107 | `getAiResponses` | const arrow | 1106 |
| 108 | `createProduct` | export function | 1108 |
| 109 | `updateProduct` | export function | 1122 |
| 110 | `deleteProduct` | const arrow | 1135 |
| 111 | `buildMultipartHeaders` | function | 1152 |
| 112 | `apiFormPost` | function | 1162 |
| 113 | `withImportDeviceInfo` | const arrow | 1181 |
| 114 | `listImportJobs` | const arrow | 1184 |
| 115 | `getImportJobReview` | const arrow | 1193 |
| 116 | `updateImportJobDecisions` | const arrow | 1197 |
| 117 | `startImportJob` | const arrow | 1200 |
| 118 | `approveImportJob` | const arrow | 1202 |
| 119 | `cancelImportJob` | const arrow | 1204 |
| 120 | `retryImportJob` | const arrow | 1206 |
| 121 | `deleteImportJob` | const arrow | 1208 |
| 122 | `getImportQueueStatus` | const arrow | 1227 |
| 123 | `downloadImportJobErrors` | export function | 1229 |
| 124 | `uploadImportJobCsv` | export function | 1249 |
| 125 | `uploadImportJobZip` | export function | 1260 |
| 126 | `uploadImportJobImages` | export function | 1271 |
| 127 | `getFiles` | export function | 1301 |
| 128 | `uploadFileAsset` | export function | 1317 |
| 129 | `finish` | const arrow | 1344 |
| 130 | `abortListener` | const arrow | 1351 |
| 131 | `deleteFileAsset` | export function | 1399 |
| 132 | `uploadProductImage` | export function | 1411 |
| 133 | `uploadUserAvatar` | export function | 1445 |
| 134 | `openCSVDialog` | export function | 1484 |
| 135 | `openImageDialog` | export function | 1504 |
| 136 | `getImageDataUrl` | export function | 1512 |
| 137 | `getActionHistory` | const arrow | 1524 |
| 138 | `updateActionHistory` | const arrow | 1530 |
| 139 | `getInventorySummary` | const arrow | 1536 |
| 140 | `getInventoryStats` | const arrow | 1537 |
| 141 | `searchInventoryProducts` | const arrow | 1541 |
| 142 | `getInventoryMovements` | const arrow | 1551 |
| 143 | `getInventoryReasons` | const arrow | 1576 |
| 144 | `saveInventoryReasons` | const arrow | 1578 |
| 145 | `buildOfflineSaleReceiptNumber` | function | 1581 |
| 146 | `isRetryableOfflineSaleError` | function | 1587 |
| 147 | `findQueuedSale` | function | 1596 |
| 148 | `putOfflineSaleMirror` | function | 1603 |
| 149 | `queueOfflineSale` | function | 1628 |
| 150 | `queuedSaleBackoffMs` | function | 1686 |
| 151 | `updateQueuedRow` | function | 1691 |
| 152 | `completeQueuedSale` | function | 1700 |
| 153 | `failQueuedSale` | function | 1723 |
| 154 | `markQueuedSaleConflict` | function | 1736 |
| 155 | `syncPendingSalesQueue` | function | 1758 |
| 156 | `getRfidStatus` | const arrow | 1801 |
| 157 | `searchRfidTags` | const arrow | 1807 |
| 158 | `recordRfidSessionEvents` | const arrow | 1813 |
| 159 | `applyRfidSession` | const arrow | 1817 |
| 160 | `createSale` | export function | 1821 |
| 161 | `getSales` | const arrow | 1833 |
| 162 | `getDashboard` | const arrow | 1840 |
| 163 | `getAnalytics` | const arrow | 1841 |
| 164 | `getCustomers` | const arrow | 1850 |
| 165 | `getCustomerPointSummaries` | const arrow | 1871 |
| 166 | `createCustomer` | export function | 1875 |
| 167 | `updateCustomer` | const arrow | 1879 |
| 168 | `deleteCustomer` | const arrow | 1883 |
| 169 | `downloadCustomerTemplate` | const arrow | 1888 |
| 170 | `getSuppliers` | const arrow | 1897 |
| 171 | `createSupplier` | export function | 1902 |
| 172 | `updateSupplier` | const arrow | 1906 |
| 173 | `deleteSupplier` | const arrow | 1910 |
| 174 | `downloadSupplierTemplate` | const arrow | 1915 |
| 175 | `getDeliveryContacts` | const arrow | 1924 |
| 176 | `createDeliveryContact` | export function | 1929 |
| 177 | `updateDeliveryContact` | const arrow | 1933 |
| 178 | `deleteDeliveryContact` | const arrow | 1937 |
| 179 | `getUsers` | const arrow | 1944 |
| 180 | `updateUser` | const arrow | 1946 |
| 181 | `getUserProfile` | const arrow | 1947 |
| 182 | `getUserAuthMethods` | const arrow | 1948 |
| 183 | `updateUserProfile` | const arrow | 1950 |
| 184 | `disconnectUserAuthProvider` | const arrow | 1952 |
| 185 | `changeUserPassword` | const arrow | 1954 |
| 186 | `resetPassword` | const arrow | 1956 |
| 187 | `getRoles` | const arrow | 1959 |
| 188 | `updateRole` | const arrow | 1961 |
| 189 | `deleteRole` | const arrow | 1962 |
| 190 | `getCustomTables` | const arrow | 1965 |
| 191 | `getCustomTableData` | const arrow | 1967 |
| 192 | `insertCustomRow` | const arrow | 1968 |
| 193 | `updateCustomRow` | const arrow | 1969 |
| 194 | `deleteCustomRow` | const arrow | 1970 |
| 195 | `getAuditLogs` | const arrow | 1973 |
| 196 | `deleteAuditLogsRetention` | const arrow | 1999 |
| 197 | `wait` | function | 2003 |
| 198 | `getSystemJob` | export function | 2007 |
| 199 | `cancelSystemJob` | export function | 2012 |
| 200 | `pollSystemJob` | export function | 2017 |
| 201 | `waitForSystemJob` | function | 2043 |
| 202 | `getIntegrationDoctor` | export function | 2051 |
| 203 | `queueBackupFolderExport` | export function | 2062 |
| 204 | `exportBackupFolder` | export function | 2071 |
| 205 | `queueBackupFolderRestore` | export function | 2075 |
| 206 | `importBackupFolder` | export function | 2082 |
| 207 | `getGoogleDriveSyncStatus` | const arrow | 2090 |
| 208 | `saveGoogleDriveSyncPreferences` | const arrow | 2124 |
| 209 | `startGoogleDriveSyncOauth` | const arrow | 2127 |
| 210 | `disconnectGoogleDriveSync` | const arrow | 2130 |
| 211 | `forgetGoogleDriveSyncCredentials` | const arrow | 2133 |
| 212 | `queueGoogleDriveSyncNow` | const arrow | 2136 |
| 213 | `syncGoogleDriveNow` | const arrow | 2139 |
| 214 | `resetData` | export function | 2144 |
| 215 | `factoryReset` | export function | 2151 |
| 216 | `downloadImportTemplate` | export function | 2159 |
| 217 | `openPath` | export function | 2206 |
| 218 | `getReturns` | const arrow | 2215 |
| 219 | `createReturn` | export function | 2221 |
| 220 | `createSupplierReturn` | export function | 2227 |
| 221 | `updateSaleStatus` | const arrow | 2236 |
| 222 | `attachSaleCustomer` | const arrow | 2252 |
| 223 | `getSalesExport` | const arrow | 2276 |
| 224 | `updateReturn` | const arrow | 2280 |
| 225 | `testSyncServer` | export function | 2304 |
| 226 | `openFolderDialog` | export function | 2323 |
| 227 | `getDataPath` | const arrow | 2334 |
| 228 | `getScaleMigrationStatus` | const arrow | 2335 |
| 229 | `prepareScaleMigration` | const arrow | 2336 |
| 230 | `runScaleMigration` | const arrow | 2337 |
| 231 | `setDataPath` | export function | 2338 |
| 232 | `resetDataPath` | export function | 2343 |
| 233 | `browseDir` | const arrow | 2348 |

### 3.148 `frontend/src/api/websocket.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `clearReconnectTimer` | function | 21 |
| 2 | `clearPingTimer` | function | 27 |
| 3 | `hasStoredAuthSession` | function | 33 |
| 4 | `isProtectedAdminHost` | function | 42 |
| 5 | `shouldDebugWs` | function | 52 |
| 6 | `logWs` | function | 62 |
| 7 | `connectWS` | export function | 68 |
| 8 | `disconnectWS` | export function | 158 |
| 9 | `reconnectWS` | export function | 178 |
| 10 | `scheduleReconnect` | function | 183 |
| 11 | `isWSConnected` | export function | 202 |

### 3.149 `frontend/src/App.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `asPageModule` | function | 169 |
| 2 | `getAppShellApi` | function | 173 |
| 3 | `getConnection` | function | 177 |
| 4 | `isPageId` | function | 183 |
| 5 | `normalizePageId` | function | 187 |
| 6 | `getErrorMessage` | function | 191 |
| 7 | `getChunkErrorMessage` | function | 281 |
| 8 | `isChunkLoadError` | function | 286 |
| 9 | `createChunkTimeoutError` | function | 295 |
| 10 | `isRetryableImportError` | function | 301 |
| 11 | `importWithTimeout` | function | 309 |
| 12 | `clearRetryMarker` | function | 325 |
| 13 | `buildChunkRecoveryUrl` | function | 332 |
| 14 | `deleteStaleShellCaches` | function | 343 |
| 15 | `clearStaleShellCaches` | function | 356 |
| 16 | `triggerChunkRecoveryReload` | function | 366 |
| 17 | `reload` | const arrow | 373 |
| 18 | `createChunkReloadStallError` | function | 383 |
| 19 | `shouldRetryChunk` | function | 389 |
| 20 | `lazyWithRetry` | function | 399 |
| 21 | `getWarmupImporters` | function | 474 |
| 22 | `shouldSkipBackgroundWarmup` | function | 485 |
| 23 | `shouldSkipIntentWarmup` | function | 494 |
| 24 | `getIntentPageId` | function | 503 |
| 25 | `scheduleIntentChunkLoad` | function | 509 |
| 26 | `run` | const arrow | 516 |
| 27 | `getDataWarmupLoaders` | function | 540 |
| 28 | `createWarmupLoader` | function | 549 |
| 29 | `runWarmupBatches` | function | 554 |
| 30 | `getPageEntryWarmupLoaders` | function | 563 |
| 31 | `useMountedPages` | function | 570 |
| 32 | `syncProfile` | const arrow | 584 |
| 33 | `useSyncErrorBanner` | function | 613 |
| 34 | `refreshPendingSync` | const arrow | 623 |
| 35 | `onSyncError` | const arrow | 628 |
| 36 | `onTransientOutage` | const arrow | 634 |
| 37 | `onSyncRecovered` | const arrow | 642 |
| 38 | `onQueueChanged` | const arrow | 650 |
| 39 | `onVaultLocked` | const arrow | 651 |
| 40 | `onAppUpdate` | const arrow | 652 |
| 41 | `onConflictReview` | const arrow | 653 |
| 42 | `useVisibilityRecovery` | function | 700 |
| 43 | `onVisible` | const arrow | 704 |
| 44 | `onFocus` | const arrow | 714 |
| 45 | `useChunkWarmup` | function | 732 |
| 46 | `runWarmup` | const arrow | 745 |
| 47 | `useIntentChunkWarmup` | function | 777 |
| 48 | `warmIntentPage` | const arrow | 784 |
| 49 | `useDataWarmup` | function | 804 |
| 50 | `runWarmup` | const arrow | 815 |
| 51 | `usePageEntryWarmup` | function | 840 |
| 52 | `run` | const arrow | 869 |
| 53 | `PageErrorBoundary` | class | 892 |
| 54 | `Notification` | function | 945 |
| 55 | `SyncErrorBanner` | function | 958 |
| 56 | `GlobalScrollControls` | function | 980 |
| 57 | `scrollTo` | const arrow | 981 |
| 58 | `formatSyncTimestamp` | function | 1018 |
| 59 | `OfflineModeBanner` | function | 1033 |
| 60 | `PageLoader` | function | 1182 |
| 61 | `NotificationCenterFallback` | function | 1225 |
| 62 | `PageSlot` | function | 1239 |
| 63 | `PublicCatalogView` | function | 1265 |
| 64 | `App` | export default function | 1275 |
| 65 | `onQueued` | const arrow | 1340 |
| 66 | `onSynced` | const arrow | 1353 |
| 67 | `handleLocationChange` | const arrow | 1378 |
| 68 | `loadFavicon` | function | 1424 |

### 3.150 `frontend/src/app/appShellUtils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeAppPath` | export function | 61 |
| 2 | `getAdminPageFromPath` | export function | 71 |
| 3 | `getAdminPathForPage` | export function | 78 |
| 4 | `isAdminAppPath` | export function | 82 |
| 5 | `isPublicCatalogPath` | export function | 89 |
| 6 | `updateMountedPages` | export function | 100 |
| 7 | `getMountedPageLimit` | export function | 120 |
| 8 | `shouldWarmPageEntries` | export function | 138 |
| 9 | `getNotificationPrefix` | export function | 145 |
| 10 | `getNotificationColor` | export function | 152 |

### 3.151 `frontend/src/app/publicErrorRecovery.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getRecoveryStorage` | function | 6 |
| 2 | `isPublicDomMutationError` | export function | 11 |
| 3 | `shouldAttemptPublicDomRecovery` | export function | 16 |
| 4 | `clearPublicDomRecoveryMarker` | export function | 32 |

### 3.152 `frontend/src/AppContext.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getAppApi` | function | 195 |
| 2 | `getErrorMessage` | function | 205 |
| 3 | `flattenTranslationTree` | function | 209 |
| 4 | `safeStorageGet` | function | 265 |
| 5 | `safeStorageSet` | function | 273 |
| 6 | `safeStorageRemove` | function | 279 |
| 7 | `getStoredUserPayload` | function | 285 |
| 8 | `getStoredUserExpiry` | function | 289 |
| 9 | `clearPersistedAuthState` | function | 293 |
| 10 | `persistAuthState` | function | 306 |
| 11 | `computeSessionExpiryMs` | function | 328 |
| 12 | `readDeviceSettings` | function | 344 |
| 13 | `writeDeviceSettings` | function | 353 |
| 14 | `writeStoredSessionDuration` | function | 359 |
| 15 | `readPendingOauthLink` | function | 367 |
| 16 | `clearPendingOauthLink` | function | 381 |
| 17 | `readOauthCallbackResult` | function | 387 |
| 18 | `clearOauthCallbackResult` | function | 398 |
| 19 | `mergeSettingsWithDeviceOverrides` | function | 404 |
| 20 | `normalizeDateInput` | function | 408 |
| 21 | `isBrokenLocalizedString` | export function | 414 |
| 22 | `buildRuntimeDescriptorFromBootstrap` | function | 426 |
| 23 | `LoadingScreen` | function | 455 |
| 24 | `AccessDenied` | function | 468 |
| 25 | `AppProvider` | export function | 480 |
| 26 | `onUpdate` | const arrow | 722 |
| 27 | `onStatus` | const arrow | 754 |
| 28 | `poll` | const arrow | 763 |
| 29 | `onError` | const arrow | 783 |
| 30 | `onWriteBlocked` | const arrow | 805 |
| 31 | `onRuntimeMismatch` | const arrow | 815 |
| 32 | `onConflict` | const arrow | 835 |
| 33 | `onUnauthorized` | const arrow | 904 |
| 34 | `handleOtpLogin` | const arrow | 963 |
| 35 | `handleUserUpdated` | const arrow | 1005 |
| 36 | `discoverSyncUrl` | const arrow | 1042 |
| 37 | `clearCallbackUrl` | const arrow | 1431 |
| 38 | `clearPendingLink` | const arrow | 1435 |
| 39 | `run` | const arrow | 1439 |

### 3.153 `frontend/src/components/auth/Login.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getAuthApi` | function | 178 |
| 2 | `getErrorMessage` | function | 183 |
| 3 | `readPendingOauthLogin` | function | 187 |
| 4 | `clearPendingOauthLogin` | function | 201 |
| 5 | `readOauthCallbackResult` | function | 207 |
| 6 | `clearOauthCallbackResult` | function | 218 |
| 7 | `OauthButton` | function | 224 |
| 8 | `ModeBackButton` | function | 238 |
| 9 | `Login` | export default function | 251 |
| 10 | `rememberOrganization` | const arrow | 323 |
| 11 | `loadCapabilities` | const arrow | 359 |
| 12 | `bootstrap` | const arrow | 379 |
| 13 | `clearCallbackUrl` | const arrow | 458 |
| 14 | `run` | const arrow | 463 |
| 15 | `rememberedOrg` | const arrow | 518 |
| 16 | `handleLogin` | const arrow | 572 |
| 17 | `handleOtp` | const arrow | 602 |
| 18 | `handleOtpInput` | const arrow | 636 |
| 19 | `handleResetWithOtp` | const arrow | 641 |
| 20 | `handleResetWithEmail` | const arrow | 678 |
| 21 | `handleCompleteEmailReset` | const arrow | 707 |
| 22 | `handleStartOauth` | const arrow | 740 |
| 23 | `closeAuxMode` | const arrow | 788 |

### 3.154 `frontend/src/components/branches/Branches.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBranchApi` | function | 179 |
| 2 | `getErrorMessage` | function | 183 |
| 3 | `isBranchRecord` | function | 187 |
| 4 | `isTransferRecord` | function | 191 |
| 5 | `BranchStatTile` | function | 195 |
| 6 | `formatTransferDate` | function | 212 |
| 7 | `Branches` | export default function | 229 |
| 8 | `promise` | const arrow | 276 |
| 9 | `loadBranchStock` | const arrow | 413 |
| 10 | `loadMoreBranchStock` | const arrow | 434 |
| 11 | `handleSaveBranch` | const arrow | 465 |
| 12 | `handleDelete` | const arrow | 533 |
| 13 | `handleBulkDelete` | const arrow | 581 |
| 14 | `toggleSelect` | const arrow | 667 |
| 15 | `toggleSelectAll` | const arrow | 676 |

### 3.155 `frontend/src/components/branches/BranchForm.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BranchForm` | export default function | 37 |
| 2 | `handleSave` | const arrow | 57 |

### 3.156 `frontend/src/components/branches/TransferModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getTransferApi` | function | 71 |
| 2 | `getErrorMessage` | function | 76 |
| 3 | `normalizeTransferStockRows` | function | 80 |
| 4 | `TransferModal` | export default function | 94 |
| 5 | `loadStock` | function | 146 |
| 6 | `handleTransfer` | const arrow | 194 |

### 3.157 `frontend/src/components/catalog/CatalogEditorSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CatalogEditorSurface` | export default function | 191 |

### 3.158 `frontend/src/components/catalog/CatalogImageField.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CatalogImageField` | export default function | 28 |

### 3.159 `frontend/src/components/catalog/CatalogPage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadCatalogEditorSurface` | const arrow | 93 |
| 2 | `loadCatalogSecondaryTabs` | const arrow | 94 |
| 3 | `loadCatalogProductsSection` | const arrow | 95 |
| 4 | `loadCatalogPreviewSurface` | const arrow | 96 |
| 5 | `getCatalogApi` | function | 240 |
| 6 | `getCatalogErrorMessage` | function | 244 |
| 7 | `normalizePortalInitialOptions` | function | 248 |
| 8 | `normalizeCatalogOptions` | function | 257 |
| 9 | `normalizeBrandOptions` | function | 268 |
| 10 | `getAboutBlockLabel` | function | 273 |
| 11 | `withAssetVersion` | function | 279 |
| 12 | `sanitizePortalMediaValue` | function | 289 |
| 13 | `tt` | function | 299 |
| 14 | `toBoolean` | function | 307 |
| 15 | `toNumber` | function | 314 |
| 16 | `normalizePriceDisplay` | function | 321 |
| 17 | `normalizeHexColor` | function | 327 |
| 18 | `normalizeExternalUrl` | function | 333 |
| 19 | `createFaqId` | function | 349 |
| 20 | `normalizeFaqItems` | function | 353 |
| 21 | `translatedPortalText` | function | 409 |
| 22 | `translateConfiguredFaqText` | function | 415 |
| 23 | `localizeConfiguredFaqItems` | function | 422 |
| 24 | `buildFaqStarterItems` | function | 430 |
| 25 | `buildAiFaqStarterItems` | function | 439 |
| 26 | `hexToRgba` | function | 449 |
| 27 | `readPortalCache` | function | 460 |
| 28 | `writePortalCache` | function | 483 |
| 29 | `normalizePortalPath` | function | 502 |
| 30 | `isReservedPortalPath` | function | 515 |
| 31 | `getPortalTabs` | function | 519 |
| 32 | `resolvePortalActiveTab` | function | 530 |
| 33 | `buildDraft` | function | 538 |
| 34 | `applyDraft` | function | 638 |
| 35 | `getBranchQty` | function | 762 |
| 36 | `getStockStatus` | function | 769 |
| 37 | `normalizeProductGallery` | function | 780 |
| 38 | `normalizePortalProductSearch` | function | 797 |
| 39 | `buildRecommendedProductOption` | function | 801 |
| 40 | `productMatchesRecommendedSearch` | function | 811 |
| 41 | `formatDateTime` | function | 826 |
| 42 | `formatPortalPrice` | function | 834 |
| 43 | `ImageField` | function | 847 |
| 44 | `readImageFileAsDataUrl` | function | 936 |
| 45 | `readImageFilesAsDataUrls` | function | 945 |
| 46 | `pickImageAsDataUrl` | function | 968 |
| 47 | `pickMultipleImagesAsDataUrls` | function | 981 |
| 48 | `replaceVars` | function | 994 |
| 49 | `getPortalResourceText` | function | 998 |
| 50 | `isFirstPartyTranslateTarget` | function | 1036 |
| 51 | `normalizePortalTranslateChoice` | function | 1043 |
| 52 | `isDocumentVisible` | function | 1051 |
| 53 | `sleep` | function | 1056 |
| 54 | `CatalogPage` | export default function | 1162 |
| 55 | `warmPublicProductsPanel` | const arrow | 1276 |
| 56 | `warmPublicSecondaryTabs` | const arrow | 1280 |
| 57 | `updateMediaUploadState` | const arrow | 1432 |
| 58 | `forgetMediaUploadState` | const arrow | 1439 |
| 59 | `loadAssistantStatus` | function | 1486 |
| 60 | `openProductGallery` | function | 1508 |
| 61 | `changeTranslateTarget` | function | 1521 |
| 62 | `isPortalLoadCurrent` | function | 1569 |
| 63 | `loadPortalEditorData` | function | 1573 |
| 64 | `refreshPortalView` | function | 1615 |
| 65 | `loadPortal` | function | 1644 |
| 66 | `ensureLink` | const arrow | 1900 |
| 67 | `updateVisibility` | const arrow | 1993 |
| 68 | `handleScroll` | const arrow | 2023 |
| 69 | `initWidget` | const arrow | 2068 |
| 70 | `waitForWidget` | const arrow | 2086 |
| 71 | `toggleFilterValue` | function | 2210 |
| 72 | `clearPortalFilters` | function | 2218 |
| 73 | `setDraft` | function | 2226 |
| 74 | `toggleRecommendedProduct` | function | 2231 |
| 75 | `openPortalImage` | function | 2240 |
| 76 | `setAboutBlocksDraft` | function | 2251 |
| 77 | `setPromoItemsDraft` | function | 2255 |
| 78 | `getPortalMediaValue` | function | 2259 |
| 79 | `setPortalMediaValue` | function | 2273 |
| 80 | `clearPortalUploadPreview` | function | 2287 |
| 81 | `clearPortalMediaTarget` | function | 2293 |
| 82 | `uploadPortalMedia` | function | 2304 |
| 83 | `cancelPortalMediaUpload` | function | 2375 |
| 84 | `updateAboutBlock` | function | 2381 |
| 85 | `updatePromoItem` | function | 2387 |
| 86 | `addAboutBlock` | function | 2393 |
| 87 | `addPromoItem` | function | 2397 |
| 88 | `moveAboutBlockBefore` | function | 2401 |
| 89 | `removeAboutBlock` | function | 2413 |
| 90 | `movePromoItemBefore` | function | 2424 |
| 91 | `removePromoItem` | function | 2436 |
| 92 | `setFaqDraft` | function | 2447 |
| 93 | `addFaqItem` | function | 2451 |
| 94 | `mergeFaqStarterItems` | function | 2462 |
| 95 | `addFaqStarterSet` | function | 2475 |
| 96 | `addAiFaqStarterSet` | function | 2479 |
| 97 | `updateFaqItem` | function | 2483 |
| 98 | `removeFaqItem` | function | 2489 |
| 99 | `clearAssistantState` | function | 2493 |
| 100 | `uploadDraftImage` | function | 2508 |
| 101 | `uploadAboutBlockMedia` | function | 2512 |
| 102 | `uploadPromoItemMedia` | function | 2518 |
| 103 | `openFilePicker` | function | 2522 |
| 104 | `handleFilePickerSelect` | function | 2526 |
| 105 | `savePortalDraft` | function | 2554 |
| 106 | `askAssistant` | function | 2746 |
| 107 | `refreshMembershipData` | function | 2792 |
| 108 | `handleMembershipLookup` | function | 2834 |
| 109 | `addSubmissionImages` | function | 2847 |
| 110 | `handleSubmissionPaste` | function | 2857 |
| 111 | `handleSubmitShareProof` | function | 2873 |
| 112 | `handleReviewSubmission` | function | 2920 |
| 113 | `renderCatalogSection` | function | 3083 |
| 114 | `handleUploadSubmissionImages` | const arrow | 3109 |
| 115 | `renderSecondaryTabPanel` | function | 3165 |
| 116 | `renderSecondaryTabSection` | function | 3177 |
| 117 | `scrollPublicPortal` | const arrow | 3306 |

### 3.160 `frontend/src/components/catalog/CatalogPageContext.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CatalogPageProvider` | export function | 10 |

### 3.161 `frontend/src/components/catalog/CatalogPreviewSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CatalogPreviewSurface` | export default function | 109 |
| 2 | `handlePortalTabClick` | const arrow | 147 |

### 3.162 `frontend/src/components/catalog/CatalogProductsSection.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBadgeIcon` | function | 112 |
| 2 | `getBadgeToneClass` | function | 120 |
| 3 | `getProductInitial` | function | 129 |
| 4 | `CatalogProductsSection` | export default function | 137 |

### 3.163 `frontend/src/components/catalog/CatalogSecondaryTabs.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizePortalColor` | function | 269 |
| 2 | `CatalogMembershipSection` | function | 274 |
| 3 | `CatalogAboutSection` | function | 620 |
| 4 | `CatalogFaqSection` | function | 834 |
| 5 | `CatalogAiSection` | function | 888 |
| 6 | `CatalogSecondaryTabs` | export default function | 1074 |

### 3.164 `frontend/src/components/catalog/catalogUi.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `statusClass` | function | 22 |
| 2 | `SectionShell` | export function | 29 |
| 3 | `SummaryTile` | export function | 45 |
| 4 | `StatusPill` | export function | 69 |

### 3.165 `frontend/src/components/catalog/portalCatalogDisplay.ts`

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

### 3.166 `frontend/src/components/catalog/portalContentI18n.ts`

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

### 3.167 `frontend/src/components/catalog/portalEditorUtils.ts`

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

### 3.168 `frontend/src/components/catalog/portalLanguagePacks.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeFirstPartyPortalLanguage` | export function | 1334 |
| 2 | `isFirstPartyPortalLanguage` | export function | 1339 |
| 3 | `getPortalLanguageText` | export function | 1343 |

### 3.169 `frontend/src/components/catalog/portalTranslateController.ts`

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

### 3.170 `frontend/src/components/contacts/ContactImportModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getContactImportApi` | function | 114 |
| 2 | `getErrorMessage` | function | 119 |
| 3 | `countCsvDataRowsInWorker` | function | 123 |
| 4 | `cleanup` | const arrow | 135 |
| 5 | `ContactImportModal` | export default function | 155 |
| 6 | `handleDownloadTemplate` | const arrow | 227 |
| 7 | `applyContactRulePreset` | const arrow | 231 |
| 8 | `handleImport` | const arrow | 241 |

### 3.171 `frontend/src/components/contacts/contactImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.172 `frontend/src/components/contacts/contactOptionUtils.ts`

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

### 3.173 `frontend/src/components/contacts/Contacts.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getContactApi` | function | 85 |
| 2 | `getErrorMessage` | function | 90 |
| 3 | `asExportValue` | function | 94 |
| 4 | `normalizeContactExportRows` | function | 98 |
| 5 | `ContactTabFallback` | function | 126 |
| 6 | `ImportTypePicker` | function | 175 |
| 7 | `Contacts` | export default function | 215 |
| 8 | `handleExportAll` | const arrow | 231 |
| 9 | `openImportPicker` | const arrow | 319 |
| 10 | `handleTypeSelected` | const arrow | 321 |
| 11 | `handleImportDone` | const arrow | 326 |

### 3.174 `frontend/src/components/contacts/CustomerFormModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `tr` | function | 50 |
| 2 | `parseContactOptions` | function | 55 |
| 3 | `OptionEditor` | function | 59 |
| 4 | `setField` | const arrow | 60 |
| 5 | `fieldId` | const arrow | 61 |
| 6 | `CustomerFormModal` | export default function | 104 |
| 7 | `addOption` | const arrow | 125 |
| 8 | `removeOption` | const arrow | 129 |
| 9 | `updateOption` | const arrow | 130 |
| 10 | `handleSubmit` | const arrow | 131 |

### 3.175 `frontend/src/components/contacts/customerMembershipNumber.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `generateCustomerMembershipNumber` | export function | 4 |

### 3.176 `frontend/src/components/contacts/CustomersTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getCustomerApi` | function | 117 |
| 2 | `isSectionRow` | function | 122 |
| 3 | `normalizeCustomerRows` | function | 126 |
| 4 | `getApiListPayload` | function | 133 |
| 5 | `getErrorMessage` | function | 137 |
| 6 | `formatPoints` | function | 141 |
| 7 | `parseContactOptions` | export function | 145 |
| 8 | `serializeContactOptions` | export function | 149 |
| 9 | `tr` | function | 153 |
| 10 | `CustomersTab` | function | 162 |
| 11 | `toggleSectionCollapsed` | const arrow | 325 |
| 12 | `isSectionFullySelected` | const arrow | 331 |
| 13 | `isSectionPartiallySelected` | const arrow | 332 |
| 14 | `toggleSectionSelection` | const arrow | 333 |
| 15 | `promise` | const arrow | 367 |
| 16 | `handleSave` | const arrow | 454 |
| 17 | `handleDelete` | const arrow | 531 |
| 18 | `handleBulkDelete` | const arrow | 570 |

### 3.177 `frontend/src/components/contacts/DeliveryTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDeliveryApi` | function | 112 |
| 2 | `normalizeDeliveryRows` | function | 117 |
| 3 | `isSectionRow` | function | 125 |
| 4 | `getErrorMessage` | function | 129 |
| 5 | `parseDeliveryOptions` | export function | 138 |
| 6 | `serializeDeliveryOptions` | export function | 142 |
| 7 | `BLANK_OPTION` | const arrow | 146 |
| 8 | `OptionEditor` | function | 157 |
| 9 | `set` | const arrow | 158 |
| 10 | `fieldId` | const arrow | 159 |
| 11 | `DeliveryForm` | function | 204 |
| 12 | `set` | const arrow | 213 |
| 13 | `addOption` | const arrow | 214 |
| 14 | `updateOption` | const arrow | 218 |
| 15 | `removeOption` | const arrow | 219 |
| 16 | `handleSave` | const arrow | 220 |
| 17 | `OptionsDisplay` | function | 290 |
| 18 | `OptionsBadge` | function | 307 |
| 19 | `DeliveryTab` | function | 318 |
| 20 | `toggleSectionCollapsed` | const arrow | 458 |
| 21 | `isSectionFullySelected` | const arrow | 464 |
| 22 | `isSectionPartiallySelected` | const arrow | 465 |
| 23 | `toggleSectionSelection` | const arrow | 466 |
| 24 | `promise` | const arrow | 498 |
| 25 | `handleSave` | const arrow | 560 |
| 26 | `handleDelete` | const arrow | 622 |
| 27 | `handleBulkDelete` | const arrow | 659 |

### 3.178 `frontend/src/components/contacts/shared.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toggleOne` | const arrow | 99 |
| 2 | `clearSelection` | const arrow | 110 |
| 3 | `countActiveFlags` | export function | 133 |
| 4 | `ThreeDotMenu` | export function | 155 |
| 5 | `menuContent` | const arrow | 164 |
| 6 | `DetailModal` | export function | 223 |

### 3.179 `frontend/src/components/contacts/SuppliersTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSupplierApi` | function | 115 |
| 2 | `normalizeSupplierRows` | function | 120 |
| 3 | `isSectionRow` | function | 128 |
| 4 | `getErrorMessage` | function | 132 |
| 5 | `SupplierForm` | function | 143 |
| 6 | `set` | const arrow | 159 |
| 7 | `addOption` | const arrow | 160 |
| 8 | `updateOption` | const arrow | 164 |
| 9 | `removeOption` | const arrow | 165 |
| 10 | `handleSubmit` | const arrow | 166 |
| 11 | `fieldId` | const arrow | 214 |
| 12 | `SuppliersTab` | function | 260 |
| 13 | `toggleSectionCollapsed` | const arrow | 407 |
| 14 | `isSectionFullySelected` | const arrow | 413 |
| 15 | `isSectionPartiallySelected` | const arrow | 414 |
| 16 | `toggleSectionSelection` | const arrow | 415 |
| 17 | `promise` | const arrow | 449 |
| 18 | `handleSave` | const arrow | 512 |
| 19 | `handleDelete` | const arrow | 582 |
| 20 | `handleBulkDelete` | const arrow | 621 |

### 3.180 `frontend/src/components/custom-tables/CustomTables.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getCustomTablesApi` | function | 72 |
| 2 | `getErrorMessage` | function | 76 |
| 3 | `getHistoryResultId` | function | 80 |
| 4 | `formatCellValue` | function | 84 |
| 5 | `toInputValue` | function | 91 |
| 6 | `normalizeRowValue` | function | 98 |
| 7 | `normalizeCustomTable` | function | 111 |
| 8 | `parseSchema` | function | 124 |
| 9 | `normalizeRows` | function | 145 |
| 10 | `buildRowPayload` | function | 151 |
| 11 | `CustomTables` | export default function | 160 |
| 12 | `addColumn` | const arrow | 275 |
| 13 | `updateColumn` | const arrow | 282 |
| 14 | `removeColumn` | const arrow | 291 |
| 15 | `handleCreateTable` | const arrow | 298 |
| 16 | `handleSaveRow` | const arrow | 345 |
| 17 | `handleDeleteRow` | const arrow | 443 |
| 18 | `openAddRow` | const arrow | 495 |
| 19 | `openEditRow` | const arrow | 502 |

### 3.181 `frontend/src/components/dashboard/charts/BarChart.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `chartLabelsNeedYear` | function | 23 |
| 2 | `formatAxisLabel` | function | 32 |
| 3 | `BarChart` | export default function | 45 |
| 4 | `updateWidth` | const arrow | 53 |
| 5 | `yPx` | function | 89 |

### 3.182 `frontend/src/components/dashboard/charts/DonutChart.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `DonutChart` | export default function | 22 |

### 3.183 `frontend/src/components/dashboard/charts/index.ts`

- No top-level named symbols detected.

### 3.184 `frontend/src/components/dashboard/charts/LineChart.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `chartLabelsNeedYear` | function | 28 |
| 2 | `formatAxisLabel` | function | 37 |
| 3 | `LineChart` | export default function | 50 |
| 4 | `updateWidth` | const arrow | 58 |
| 5 | `xPx` | function | 100 |
| 6 | `yPx` | function | 104 |
| 7 | `handleMouseMove` | const arrow | 114 |

### 3.185 `frontend/src/components/dashboard/charts/NoData.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NoData` | export default function | 7 |

### 3.186 `frontend/src/components/dashboard/Dashboard.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDashboardApi` | function | 235 |
| 2 | `getErrorMessage` | function | 239 |
| 3 | `getDashboardFilterStorageKey` | function | 287 |
| 4 | `readDashboardFilterPrefs` | function | 292 |
| 5 | `downsampleChartRows` | function | 316 |
| 6 | `normalizeDashboardRangeId` | function | 327 |
| 7 | `normalizeDashboardGranularity` | function | 334 |
| 8 | `compactDashboardMetaParts` | function | 338 |
| 9 | `formatDashboardHourLabel` | function | 344 |
| 10 | `getSaleStatusTone` | function | 351 |
| 11 | `isDashboardSummaryPayload` | function | 358 |
| 12 | `isDashboardAnalyticsPayload` | function | 370 |
| 13 | `normalizeDashboardSummaryPayload` | function | 383 |
| 14 | `normalizeDashboardAnalyticsPayload` | function | 396 |
| 15 | `Dashboard` | export default function | 416 |
| 16 | `calcTrend` | const arrow | 669 |
| 17 | `rangeLabel` | const arrow | 713 |
| 18 | `periodShort` | const arrow | 719 |

### 3.187 `frontend/src/components/dashboard/MiniStat.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `MiniStat` | export default function | 13 |

### 3.188 `frontend/src/components/files/FilePickerModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getFilePickerApi` | function | 60 |
| 2 | `getErrorMessage` | function | 65 |
| 3 | `normalizeFileAssets` | function | 69 |
| 4 | `AssetPreview` | function | 73 |
| 5 | `FilePickerModal` | export default function | 96 |
| 6 | `toggleSelectedPath` | function | 163 |
| 7 | `handleUpload` | function | 173 |
| 8 | `handleDelete` | function | 215 |

### 3.189 `frontend/src/components/files/FilesPage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadFilesProvidersTab` | const arrow | 30 |
| 2 | `loadFilesResponsesTab` | const arrow | 31 |
| 3 | `getFilesApi` | function | 225 |
| 4 | `getErrorMessage` | function | 229 |
| 5 | `hasMojibake` | function | 233 |
| 6 | `sanitizeFallback` | function | 237 |
| 7 | `AssetPreview` | function | 241 |
| 8 | `AssetCardSkeleton` | function | 264 |
| 9 | `formatDateTime` | function | 290 |
| 10 | `formatFileSize` | function | 300 |
| 11 | `emptyProviderForm` | function | 308 |
| 12 | `compactTabLabel` | function | 331 |
| 13 | `getDefaultFilesPageSize` | function | 337 |
| 14 | `downloadAssetFile` | function | 342 |
| 15 | `FilesPage` | export default function | 354 |
| 16 | `handleUpload` | function | 632 |
| 17 | `handleDeleteAsset` | function | 655 |
| 18 | `toggleAssetSelection` | function | 683 |
| 19 | `toggleSelectAllAssets` | function | 694 |
| 20 | `handleCopySelectedPaths` | function | 701 |
| 21 | `handleDownloadSelected` | function | 716 |
| 22 | `handleDeleteSelectedAssets` | function | 724 |
| 23 | `startCreateProvider` | function | 770 |
| 24 | `startEditProvider` | function | 786 |
| 25 | `saveProvider` | function | 811 |
| 26 | `testProvider` | function | 895 |
| 27 | `removeProvider` | function | 916 |

### 3.190 `frontend/src/components/files/FilesProvidersTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProviderStatus` | function | 123 |
| 2 | `FilesProvidersTab` | export default function | 134 |

### 3.191 `frontend/src/components/files/FilesResponsesTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `FilesResponsesTab` | export default function | 66 |

### 3.192 `frontend/src/components/inventory/DualMoney.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `DualMoney` | export default function | 8 |

### 3.193 `frontend/src/components/inventory/Inventory.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getInventoryApi` | function | 180 |
| 2 | `normalizeFiniteIds` | function | 214 |
| 3 | `countActiveFlags` | function | 218 |
| 4 | `countSelectedIds` | function | 226 |
| 5 | `renderDestinationProductOptions` | function | 234 |
| 6 | `limitInventorySectionsForMobile` | function | 245 |
| 7 | `priceCsv` | function | 272 |
| 8 | `parseInventoryTimestamp` | function | 276 |
| 9 | `InventoryDiscountBadge` | function | 290 |
| 10 | `InventoryBatchPreview` | function | 301 |
| 11 | `label` | const arrow | 313 |
| 12 | `loadInventoryExportTools` | function | 368 |
| 13 | `Inventory` | export default function | 383 |
| 14 | `promise` | const arrow | 626 |
| 15 | `handleAdjust` | const arrow | 992 |
| 16 | `openAdjust` | const arrow | 1074 |
| 17 | `openMove` | const arrow | 1081 |
| 18 | `openTransfer` | const arrow | 1104 |
| 19 | `handleMoveStock` | const arrow | 1159 |
| 20 | `handleTransferStock` | const arrow | 1232 |
| 21 | `syncViewport` | const arrow | 1389 |
| 22 | `statsValue` | const arrow | 2008 |
| 23 | `selectInventorySection` | const arrow | 3231 |

### 3.194 `frontend/src/components/inventory/InventoryImportModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isBrokenLocalizedString` | function | 68 |
| 2 | `getImportApi` | function | 80 |
| 3 | `getErrorMessage` | function | 85 |
| 4 | `countInventoryCsvRowsInWorker` | function | 89 |
| 5 | `cleanup` | const arrow | 101 |
| 6 | `InventoryImportModal` | export default function | 121 |
| 7 | `handlePickFile` | const arrow | 175 |
| 8 | `handleDownloadTemplate` | const arrow | 181 |
| 9 | `handleImport` | const arrow | 185 |

### 3.195 `frontend/src/components/inventory/inventoryImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.196 `frontend/src/components/inventory/InventoryMovementsSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `InventoryMovementsSurface` | export default function | 140 |

### 3.197 `frontend/src/components/inventory/InventoryProductsSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `InventoryProductsSurface` | export default function | 102 |
| 2 | `renderDesktopTableHead` | const arrow | 141 |
| 3 | `renderDesktopLoadingShell` | const arrow | 163 |

### 3.198 `frontend/src/components/inventory/InventoryRfidSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `InventoryRfidSurface` | export default function | 55 |

### 3.199 `frontend/src/components/inventory/movementGroups.ts`

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

### 3.200 `frontend/src/components/inventory/ProductDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBranchStockKey` | function | 61 |
| 2 | `ProductDetailModal` | export default function | 65 |

### 3.201 `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getLoyaltyApi` | function | 187 |
| 2 | `toCustomerPointRows` | function | 191 |
| 3 | `getErrorMessage` | function | 195 |
| 4 | `sanitizeInteger` | function | 199 |
| 5 | `sanitizeKhr` | function | 204 |
| 6 | `formatLookupValue` | function | 210 |
| 7 | `normalizeLoyaltySection` | function | 214 |
| 8 | `LoyaltyPointsPage` | export default function | 218 |
| 9 | `handleSave` | function | 327 |
| 10 | `handleLookup` | function | 351 |

### 3.202 `frontend/src/components/navigation/Sidebar.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getFallbackLabel` | function | 93 |
| 2 | `getNavLabel` | function | 101 |
| 3 | `isDarkColor` | function | 117 |
| 4 | `withAlpha` | function | 127 |
| 5 | `mergeStyles` | function | 133 |
| 6 | `announcePageIntent` | function | 137 |
| 7 | `getIconForItem` | function | 144 |
| 8 | `isNavigationItemWithIcon` | function | 148 |
| 9 | `Sidebar` | export default function | 152 |

### 3.203 `frontend/src/components/pos/CartItem.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `translate` | function | 41 |
| 2 | `CartItem` | export default function | 45 |

### 3.204 `frontend/src/components/pos/FilterPanel.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `countActiveFlags` | function | 42 |
| 2 | `SectionLabel` | function | 50 |
| 3 | `POSFilterPanel` | export default function | 61 |
| 4 | `clearAll` | const arrow | 94 |
| 5 | `chip` | const arrow | 103 |

### 3.205 `frontend/src/components/pos/POS.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isPlainRecord` | function | 287 |
| 2 | `normalizeCategory` | function | 291 |
| 3 | `getPosApi` | function | 306 |
| 4 | `missingPosApiMethod` | function | 310 |
| 5 | `normalizeOrder` | function | 314 |
| 6 | `getErrorMessage` | function | 325 |
| 7 | `asText` | function | 329 |
| 8 | `asNumber` | function | 333 |
| 9 | `allTermsMatch` | function | 337 |
| 10 | `ProductDiscountBadge` | function | 351 |
| 11 | `POS` | export default function | 371 |
| 12 | `setPersistedCat` | const arrow | 402 |
| 13 | `setPersistedBrand` | const arrow | 403 |
| 14 | `setPersistedBranch` | const arrow | 404 |
| 15 | `setPersistedStock` | const arrow | 405 |
| 16 | `setPersistedGroup` | const arrow | 406 |
| 17 | `setPersistedSupplier` | const arrow | 407 |
| 18 | `setPersistedInitial` | const arrow | 408 |
| 19 | `addNewOrder` | const arrow | 469 |
| 20 | `closeOrder` | const arrow | 481 |
| 21 | `selectCustomer` | const arrow | 802 |
| 22 | `applyCustomerOption` | const arrow | 850 |
| 23 | `clearCustomer` | const arrow | 864 |
| 24 | `handleAddCustomer` | const arrow | 872 |
| 25 | `selectDelivery` | const arrow | 910 |
| 26 | `clearDelivery` | const arrow | 915 |
| 27 | `handleAddDelivery` | const arrow | 917 |
| 28 | `qty` | const arrow | 1029 |
| 29 | `addToCart` | function | 1193 |
| 30 | `updateQty` | const arrow | 1232 |
| 31 | `updatePrice` | const arrow | 1240 |
| 32 | `updateItemBranch` | const arrow | 1264 |
| 33 | `handleDiscountUsd` | const arrow | 1313 |
| 34 | `handleDiscountKhr` | const arrow | 1314 |
| 35 | `handleMembershipUnits` | const arrow | 1315 |
| 36 | `handleCheckout` | const arrow | 1354 |

### 3.206 `frontend/src/components/pos/posCore.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeNumber` | function | 48 |
| 2 | `buildProductsById` | export function | 52 |
| 3 | `buildVariantChildrenByParentId` | export function | 61 |
| 4 | `getVariantRootProduct` | export function | 73 |
| 5 | `buildVisibleProductCards` | export function | 80 |
| 6 | `getVariantChoices` | export function | 96 |
| 7 | `buildPosFilterMeta` | export function | 104 |
| 8 | `resolveCartPriceValues` | export function | 113 |
| 9 | `getCartLineId` | export function | 153 |
| 10 | `findMatchingCartLineIndex` | export function | 160 |

### 3.207 `frontend/src/components/pos/ProductImage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductImage` | export default function | 9 |

### 3.208 `frontend/src/components/pos/QuickAddModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `QuickAddModal` | export default function | 12 |
| 2 | `T` | const arrow | 13 |

### 3.209 `frontend/src/components/products/config/productPageConfig.ts`

- No top-level named symbols detected.

### 3.210 `frontend/src/components/products/forms/BranchStockAdjuster.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getProductApi` | function | 72 |
| 2 | `parseStockDelta` | function | 76 |
| 3 | `BranchStockAdjuster` | export default function | 81 |
| 4 | `T` | const arrow | 102 |
| 5 | `setRow` | const arrow | 108 |
| 6 | `handleSave` | const arrow | 114 |

### 3.211 `frontend/src/components/products/forms/BulkAddStockModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getProductApi` | function | 68 |
| 2 | `parsePositiveQuantity` | function | 72 |
| 3 | `normalizeBranchId` | function | 77 |
| 4 | `normalizeProductId` | function | 83 |
| 5 | `BulkAddStockModal` | export default function | 88 |
| 6 | `handleSave` | const arrow | 101 |

### 3.212 `frontend/src/components/products/forms/ProductForm.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getProductFormApi` | function | 188 |
| 2 | `getErrorMessage` | function | 192 |
| 3 | `normalizeGallery` | function | 196 |
| 4 | `editablePrice` | function | 212 |
| 5 | `pickImageFiles` | function | 217 |
| 6 | `ProductForm` | export default function | 236 |
| 7 | `loadSuppliers` | function | 371 |
| 8 | `setField` | function | 392 |
| 9 | `setNumericField` | function | 396 |
| 10 | `addImages` | function | 400 |
| 11 | `addPhoto` | function | 405 |
| 12 | `uploadPickedImages` | function | 410 |
| 13 | `removeImage` | function | 457 |
| 14 | `setPrimaryImage` | function | 461 |
| 15 | `saveForm` | function | 471 |
| 16 | `openScanner` | function | 522 |
| 17 | `closeScanner` | function | 527 |
| 18 | `applyScannedValue` | function | 531 |

### 3.213 `frontend/src/components/products/forms/VariantFormModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getProductVariantApi` | function | 104 |
| 2 | `getErrorMessage` | function | 108 |
| 3 | `VariantFormModal` | export default function | 112 |

### 3.214 `frontend/src/components/products/helpers/productDisplayHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toNumber` | function | 57 |
| 2 | `buildBranchNameByIdMap` | export function | 72 |
| 3 | `buildProductBrandOptions` | export function | 76 |
| 4 | `buildProductBranchSummaryLabel` | export function | 90 |
| 5 | `getProductStockStatus` | export function | 101 |
| 6 | `buildProductRowDisplayState` | export function | 111 |

### 3.215 `frontend/src/components/products/helpers/productFilterHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toNumber` | function | 66 |
| 2 | `getImageGallery` | function | 71 |
| 3 | `buildProductSearchTerms` | export function | 75 |
| 4 | `getProductBranchQuantity` | export function | 81 |
| 5 | `filterProductsForPage` | export function | 86 |
| 6 | `buildProductExportRows` | export function | 153 |
| 7 | `toImageName` | const arrow | 154 |
| 8 | `toImageUrl` | const arrow | 155 |
| 9 | `priceCsv` | const arrow | 156 |

### 3.216 `frontend/src/components/products/helpers/productGalleryHelpers.ts`

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

### 3.217 `frontend/src/components/products/helpers/productGroupViewHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildProductGroupPriceLabel` | export function | 22 |
| 2 | `buildProductGroupSummaryParts` | export function | 32 |

### 3.218 `frontend/src/components/products/helpers/productMenuHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `asString` | function | 85 |
| 2 | `buildProductExportItems` | export function | 89 |
| 3 | `buildProductSupplierOptions` | export function | 117 |
| 4 | `countActiveProductFilters` | export function | 121 |
| 5 | `buildProductFilterSections` | export function | 147 |

### 3.219 `frontend/src/components/products/helpers/productPageHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseBrandColorMap` | export function | 12 |
| 2 | `normalizeBrandLookup` | export function | 22 |
| 3 | `waitForNextFrame` | export function | 26 |

### 3.220 `frontend/src/components/products/helpers/productSelectionHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildVisibleProductIds` | export function | 51 |
| 2 | `buildParentProductIdSet` | export function | 69 |
| 3 | `buildSelectedVisibleIds` | export function | 78 |
| 4 | `buildProductPaginationState` | export function | 83 |
| 5 | `buildJumpTargetIdsByLetter` | export function | 115 |
| 6 | `isSelectionScopeFullySelected` | export function | 132 |
| 7 | `isSelectionScopePartiallySelected` | export function | 136 |

### 3.221 `frontend/src/components/products/helpers/productWriteHelpers.ts`

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

### 3.222 `frontend/src/components/products/history/productHistoryHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createProductHistoryRequestId` | export function | 43 |

### 3.223 `frontend/src/components/products/import/BulkImportModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getProductImportApi` | function | 247 |
| 2 | `getErrorMessage` | function | 251 |
| 3 | `getBaseName` | function | 261 |
| 4 | `analyzeProductCsvInWorker` | function | 269 |
| 5 | `runFallbackAnalysis` | const arrow | 278 |
| 6 | `cleanup` | const arrow | 290 |
| 7 | `complete` | const arrow | 298 |
| 8 | `getIncomingImageFilenames` | function | 347 |
| 9 | `getExistingImageFilenames` | function | 380 |
| 10 | `csvEscape` | function | 409 |
| 11 | `compactImportValue` | function | 439 |
| 12 | `isBlankImportValue` | function | 444 |
| 13 | `hasPriceReviewIssue` | function | 448 |
| 14 | `getProductImportIssueLabel` | function | 453 |
| 15 | `getProductImportIssueHint` | function | 462 |
| 16 | `getProductImportRowIssueDetails` | function | 470 |
| 17 | `valuesDiffer` | function | 525 |
| 18 | `normalizeImageMatchKey` | function | 529 |
| 19 | `getImageReference` | function | 542 |
| 20 | `findImageReferenceForRow` | function | 551 |
| 21 | `getDecisionLabel` | function | 562 |
| 22 | `getFamilyKeyForRow` | function | 566 |
| 23 | `summarizeRowNumbers` | function | 570 |
| 24 | `summarizeSubgroup` | function | 577 |
| 25 | `getImportActionTargetSummary` | function | 582 |
| 26 | `createFamilyContextEntry` | function | 615 |
| 27 | `buildVisibleFamilyRows` | function | 636 |
| 28 | `InlineImportDetailGrid` | function | 655 |
| 29 | `buildImageOnlyCsv` | function | 696 |
| 30 | `getBrowserImageEntries` | function | 714 |
| 31 | `BulkImportModal` | export default function | 723 |
| 32 | `resetCsvState` | const arrow | 854 |
| 33 | `pickImageDirectory` | const arrow | 882 |
| 34 | `pickImageZip` | const arrow | 907 |
| 35 | `addLibraryImages` | const arrow | 921 |
| 36 | `handleCancelCurrentJob` | const arrow | 1005 |
| 37 | `handleRetryCurrentJob` | const arrow | 1026 |
| 38 | `handleDeleteCurrentJob` | const arrow | 1050 |
| 39 | `handleImageOnlyImport` | const arrow | 1077 |
| 40 | `handlePickCSV` | const arrow | 1172 |
| 41 | `handleImport` | const arrow | 1236 |
| 42 | `toggleFamilyCollapse` | const arrow | 1486 |
| 43 | `toggleInlineDetails` | const arrow | 1495 |
| 44 | `toggleConflictSelection` | const arrow | 1504 |
| 45 | `toggleSelectAllConflicts` | const arrow | 1513 |
| 46 | `applyDecisionToSelection` | const arrow | 1521 |
| 47 | `applyImageDecisionToSelection` | const arrow | 1531 |
| 48 | `applyIdentifierDecisionToSelection` | const arrow | 1548 |
| 49 | `applyFieldRulePreset` | const arrow | 1560 |
| 50 | `renderConflictRow` | const arrow | 1573 |
| 51 | `updateEditedRow` | const arrow | 1581 |

### 3.224 `frontend/src/components/products/import/productImportPlanner.ts`

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

### 3.225 `frontend/src/components/products/import/productImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `post` | function | 39 |
| 2 | `waitForNextTask` | function | 43 |
| 3 | `getErrorMessage` | function | 49 |

### 3.226 `frontend/src/components/products/lookups/ManageBrandsModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBrandApi` | function | 116 |
| 2 | `getErrorMessage` | function | 120 |
| 3 | `parseBrandOptions` | function | 124 |
| 4 | `parseBrandColorMap` | function | 137 |
| 5 | `toTitleCase` | function | 152 |
| 6 | `getBrandReviewRule` | function | 160 |
| 7 | `getBrandSortScore` | function | 164 |
| 8 | `buildSavedLibrary` | function | 170 |
| 9 | `ManageBrandsModal` | export default function | 192 |

### 3.227 `frontend/src/components/products/lookups/ManageCategoriesModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getCategoryApi` | function | 106 |
| 2 | `getErrorMessage` | function | 110 |
| 3 | `normalizeCategoryRows` | function | 114 |
| 4 | `mergeCategoryUsage` | function | 129 |
| 5 | `ManageCategoriesModal` | export default function | 158 |

### 3.228 `frontend/src/components/products/lookups/ManageUnitsModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getUnitApi` | function | 106 |
| 2 | `getErrorMessage` | function | 110 |
| 3 | `normalizeUnitRows` | function | 114 |
| 4 | `mergeUnitUsage` | function | 129 |
| 5 | `ManageUnitsModal` | export default function | 158 |

### 3.229 `frontend/src/components/products/lookups/productLookupSnapshots.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLookup` | export function | 53 |
| 2 | `getFallbackApiClient` | function | 57 |
| 3 | `normalizeProductRows` | function | 63 |
| 4 | `getPayloadNumber` | function | 70 |
| 5 | `snapshotLookupProducts` | function | 75 |
| 6 | `mergeUniqueSnapshots` | function | 89 |
| 7 | `fetchLookupProductSnapshotsForName` | function | 113 |
| 8 | `fetchLookupProductSnapshots` | export function | 149 |
| 9 | `fetchProductsByIds` | function | 165 |
| 10 | `restoreLookupProductSnapshots` | export function | 194 |

### 3.230 `frontend/src/components/products/Products.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getProductApi` | function | 330 |
| 2 | `getErrorMessage` | function | 334 |
| 3 | `isObjectRecord` | function | 338 |
| 4 | `toProductApiResponse` | function | 342 |
| 5 | `scrollNodeWithOffset` | function | 346 |
| 6 | `summarizeProductRun` | function | 352 |
| 7 | `aggregateProductInitials` | function | 356 |
| 8 | `toModalProduct` | function | 367 |
| 9 | `toVariantParentProduct` | function | 379 |
| 10 | `toLightboxState` | function | 385 |
| 11 | `Products` | export default function | 395 |
| 12 | `promise` | const arrow | 478 |
| 13 | `handleSave` | const arrow | 653 |
| 14 | `handleSaveWithGallery` | const arrow | 703 |
| 15 | `handleBulkDelete` | const arrow | 770 |
| 16 | `handleBulkOutOfStock` | const arrow | 817 |
| 17 | `handleBulkChangeBranch` | const arrow | 860 |
| 18 | `handleBulkAddStock` | const arrow | 890 |
| 19 | `toggleSelect` | const arrow | 898 |
| 20 | `toggleSelectAll` | const arrow | 905 |
| 21 | `handleDelete` | const arrow | 912 |
| 22 | `renderUnitChip` | const arrow | 999 |
| 23 | `openLightbox` | const arrow | 1013 |
| 24 | `getStockBadge` | const arrow | 1020 |

### 3.231 `frontend/src/components/products/scanning/barcodeImageScanner.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readFileAsDataUrl` | function | 37 |
| 2 | `createImageElement` | function | 62 |
| 3 | `loadImageSource` | function | 66 |
| 4 | `detectWithNativeBarcodeDetector` | function | 75 |
| 5 | `scanBarcodeFromImageFile` | export function | 101 |

### 3.232 `frontend/src/components/products/scanning/BarcodeScannerModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getNativeBarcodeDetector` | function | 94 |
| 2 | `getScanErrorText` | function | 101 |
| 3 | `stopStream` | function | 106 |
| 4 | `readCameraPermissionState` | function | 112 |
| 5 | `watchCameraPermission` | function | 123 |
| 6 | `handleChange` | const arrow | 127 |
| 7 | `BarcodeScannerModal` | export default function | 139 |

### 3.233 `frontend/src/components/products/scanning/barcodeScannerState.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `deriveScannerPresentation` | export function | 31 |

### 3.234 `frontend/src/components/products/scanning/scanbotScanner.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `publicBasePath` | const arrow | 35 |
| 2 | `getScanbotGlobal` | function | 47 |
| 3 | `isCameraBlockedByDocumentPolicy` | export function | 52 |
| 4 | `normalizeScanbotError` | function | 66 |
| 5 | `loadScanbotScript` | function | 80 |
| 6 | `readCameraPermissionState` | function | 109 |
| 7 | `getPreferredScannerMode` | export function | 119 |
| 8 | `getInitializedScanbot` | function | 143 |
| 9 | `scanBarcodeWithScanbot` | export function | 158 |

### 3.235 `frontend/src/components/products/shared/primitives.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getImageApi` | function | 49 |
| 2 | `isRecentlyBrokenProductImage` | function | 53 |
| 3 | `markBrokenProductImage` | function | 61 |
| 4 | `sanitizeNumericInput` | function | 66 |
| 5 | `parseNumericInput` | function | 76 |
| 6 | `ProductImg` | function | 82 |
| 7 | `loadImageData` | function | 125 |
| 8 | `ProductImagePlaceholder` | function | 169 |
| 9 | `MarginCard` | function | 177 |
| 10 | `DualPriceInput` | function | 209 |
| 11 | `handleUsdChange` | const arrow | 210 |
| 12 | `handleKhrChange` | const arrow | 211 |

### 3.236 `frontend/src/components/products/surfaces/HeaderActions.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductsHeaderActions` | export default function | 19 |
| 2 | `tr` | const arrow | 29 |

### 3.237 `frontend/src/components/products/surfaces/ProductDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductDetailModal` | export default function | 79 |
| 2 | `T` | const arrow | 95 |
| 3 | `Row` | const arrow | 121 |

### 3.238 `frontend/src/components/products/surfaces/ProductRowParts.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductDiscountBadge` | export function | 74 |
| 2 | `ProductRowActions` | export function | 94 |
| 3 | `label` | const arrow | 103 |
| 4 | `ProductBatchPreview` | export function | 127 |
| 5 | `ProductDetailsCell` | export function | 161 |

### 3.239 `frontend/src/components/products/surfaces/ProductsListSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductsListSurface` | export default function | 61 |
| 2 | `renderDesktopTableHead` | const arrow | 104 |
| 3 | `renderDesktopLoadingShell` | const arrow | 133 |

### 3.240 `frontend/src/components/receipt-settings/AllFieldsPanel.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Toggle` | function | 30 |
| 2 | `AllFieldsPanel` | export default function | 46 |
| 3 | `T` | const arrow | 49 |
| 4 | `toggleSection` | const arrow | 68 |

### 3.241 `frontend/src/components/receipt-settings/constants.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getFieldItems` | export function | 109 |
| 2 | `T` | const arrow | 110 |

### 3.242 `frontend/src/components/receipt-settings/ErrorBoundary.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatError` | function | 11 |

### 3.243 `frontend/src/components/receipt-settings/FieldOrderManager.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSectionOrderItems` | function | 20 |
| 2 | `buildList` | function | 39 |
| 3 | `toKeys` | function | 64 |
| 4 | `FieldOrderManager` | export default function | 68 |
| 5 | `moveItem` | const arrow | 82 |
| 6 | `addDivider` | const arrow | 90 |
| 7 | `removeDivider` | const arrow | 101 |
| 8 | `handleDragStart` | const arrow | 107 |
| 9 | `handleDragOver` | const arrow | 112 |

### 3.244 `frontend/src/components/receipt-settings/PrintSettings.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Section` | function | 31 |
| 2 | `buildFallbackPreviewHtml` | function | 43 |
| 3 | `buildSafePreviewSource` | function | 61 |
| 4 | `PrintSettings` | export default function | 73 |
| 5 | `persistPrintSettings` | const arrow | 96 |
| 6 | `setValue` | const arrow | 112 |
| 7 | `resetMargins` | const arrow | 121 |
| 8 | `getPreviewSource` | const arrow | 144 |

### 3.245 `frontend/src/components/receipt-settings/ReceiptPreview.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatLoadError` | function | 34 |
| 2 | `ReceiptPreview` | export default function | 39 |
| 3 | `loadPreview` | function | 50 |

### 3.246 `frontend/src/components/receipt-settings/ReceiptSettings.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getErrorMessage` | function | 71 |
| 2 | `Section` | function | 76 |
| 3 | `Toggle` | function | 87 |
| 4 | `ReceiptSettings` | export default function | 102 |

### 3.247 `frontend/src/components/receipt-settings/template.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isRecord` | function | 6 |
| 2 | `parseTemplateInput` | function | 10 |
| 3 | `parseReceiptTemplate` | export function | 19 |
| 4 | `serializeReceiptTemplate` | export function | 30 |

### 3.248 `frontend/src/components/receipt/Receipt.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toNumber` | function | 104 |
| 2 | `stripEmoji` | function | 109 |
| 3 | `stripEmoji` | function | 111 |
| 4 | `displayAddress` | function | 116 |
| 5 | `parseItems` | function | 125 |
| 6 | `getErrorMessage` | function | 136 |
| 7 | `labelFor` | function | 222 |
| 8 | `Row` | function | 227 |
| 9 | `Receipt` | export default function | 239 |
| 10 | `exportReceiptPdf` | const arrow | 450 |

### 3.249 `frontend/src/components/returns/EditReturnModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getReturnApi` | function | 90 |
| 2 | `toNumber` | function | 95 |
| 3 | `clampReturnQuantity` | function | 100 |
| 4 | `isWriteConflict` | function | 106 |
| 5 | `EditReturnModal` | export default function | 111 |
| 6 | `updateQty` | const arrow | 144 |
| 7 | `updateRestock` | const arrow | 147 |

### 3.250 `frontend/src/components/returns/NewReturnModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getReturnApi` | function | 119 |
| 2 | `toNumber` | function | 124 |
| 3 | `clampReturnQuantity` | function | 129 |
| 4 | `getSaleItemKey` | function | 135 |
| 5 | `NewReturnModal` | export default function | 139 |
| 6 | `handleSearch` | const arrow | 172 |
| 7 | `handleReturnTypeChange` | const arrow | 237 |
| 8 | `toggleIncluded` | const arrow | 242 |
| 9 | `updateItemQty` | const arrow | 250 |
| 10 | `updateItemRestock` | const arrow | 258 |
| 11 | `selectAll` | const arrow | 262 |
| 12 | `clearAll` | const arrow | 265 |
| 13 | `handleSubmit` | const arrow | 272 |

### 3.251 `frontend/src/components/returns/NewSupplierReturnModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isSupplierReturnItem` | function | 86 |
| 2 | `getSupplierReturnApi` | function | 90 |
| 3 | `NewSupplierReturnModal` | export default function | 99 |
| 4 | `loadSetup` | function | 136 |
| 5 | `loadInventory` | function | 187 |
| 6 | `updateQty` | const arrow | 258 |
| 7 | `submit` | const arrow | 264 |

### 3.252 `frontend/src/components/returns/ReturnDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeScope` | function | 52 |
| 2 | `coerceMoney` | function | 56 |
| 3 | `isPositiveMoney` | function | 60 |
| 4 | `ReturnDetailModal` | export default function | 64 |

### 3.253 `frontend/src/components/returns/Returns.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getReturnApi` | function | 148 |
| 2 | `normalizeScope` | function | 153 |
| 3 | `getReturnTypeKey` | function | 157 |
| 4 | `getReturnTypeLabel` | function | 163 |
| 5 | `normalizeFiniteIds` | function | 179 |
| 6 | `countSelectedIds` | function | 183 |
| 7 | `countActiveFlags` | function | 191 |
| 8 | `toNumericAmount` | function | 199 |
| 9 | `exportReturnRows` | function | 204 |
| 10 | `getInitialReturnPageSize` | function | 222 |
| 11 | `Returns` | export default function | 227 |
| 12 | `promise` | const arrow | 300 |

### 3.254 `frontend/src/components/returns/ReturnsListSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `detectMobileViewport` | function | 70 |
| 2 | `ReturnsDesktopSkeletonRows` | function | 75 |
| 3 | `ReturnsMobileSkeletonCards` | function | 92 |
| 4 | `ReturnsListSurface` | export default function | 112 |
| 5 | `apply` | const arrow | 143 |

### 3.255 `frontend/src/components/sales/ExportModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSalesExportApi` | function | 68 |
| 2 | `getErrorMessage` | function | 73 |
| 3 | `ExportModal` | export default function | 77 |
| 4 | `handlePreview` | const arrow | 151 |
| 5 | `handleExportCSV` | const arrow | 169 |

### 3.256 `frontend/src/components/sales/SaleDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toNumber` | function | 73 |
| 2 | `InfoBlock` | function | 78 |
| 3 | `parseItems` | function | 94 |
| 4 | `SaleDetailModal` | export default function | 105 |

### 3.257 `frontend/src/components/sales/Sales.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSalesApi` | function | 126 |
| 2 | `normalizeSaleRows` | function | 131 |
| 3 | `normalizeUserOptions` | function | 139 |
| 4 | `getErrorMessage` | function | 144 |
| 5 | `isWriteConflict` | function | 148 |
| 6 | `multiMatch` | function | 155 |
| 7 | `normalizeFiniteIds` | function | 167 |
| 8 | `countSelectedIds` | function | 171 |
| 9 | `countActiveFlags` | function | 179 |
| 10 | `getSaleBranchLabel` | function | 187 |
| 11 | `Sales` | export default function | 195 |
| 12 | `promise` | const arrow | 285 |
| 13 | `toggleSelected` | const arrow | 622 |
| 14 | `toggleSelectAll` | const arrow | 628 |
| 15 | `handleExportSelected` | const arrow | 667 |
| 16 | `handleBulkStatusUpdate` | const arrow | 715 |

### 3.258 `frontend/src/components/sales/SalesImportModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getImportApi` | function | 69 |
| 2 | `getErrorMessage` | function | 74 |
| 3 | `countSalesCsvRowsInWorker` | function | 78 |
| 4 | `cleanup` | const arrow | 90 |
| 5 | `SalesImportModal` | export default function | 110 |
| 6 | `handlePickFile` | const arrow | 163 |
| 7 | `handleDownloadTemplate` | const arrow | 169 |
| 8 | `handleImport` | const arrow | 173 |

### 3.259 `frontend/src/components/sales/salesImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.260 `frontend/src/components/sales/SalesListSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSaleItems` | function | 66 |
| 2 | `SalesListSurface` | export default function | 70 |

### 3.261 `frontend/src/components/sales/StatusBadge.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isSaleStatus` | function | 24 |
| 2 | `getStatusLabel` | export function | 28 |
| 3 | `StatusBadge` | export default function | 50 |

### 3.262 `frontend/src/components/server/ServerPage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getServerApi` | function | 131 |
| 2 | `getErrorMessage` | function | 135 |
| 3 | `normalizePendingSyncState` | function | 139 |
| 4 | `normalizeSystemDebugLog` | function | 150 |
| 5 | `normalizeSystemConfig` | function | 159 |
| 6 | `useLocalCopy` | function | 163 |
| 7 | `isAutoDetected` | function | 174 |
| 8 | `StatusRow` | function | 181 |
| 9 | `InfoTab` | function | 193 |
| 10 | `DiagnosticsPanel` | function | 346 |
| 11 | `onErr` | const arrow | 386 |
| 12 | `onQueueChanged` | const arrow | 391 |
| 13 | `handleRetryQueue` | function | 438 |
| 14 | `handleDiscardQueue` | function | 455 |
| 15 | `ServerPage` | export default function | 646 |
| 16 | `check` | const arrow | 673 |
| 17 | `loadSecurityConfig` | const arrow | 701 |
| 18 | `handleTest` | function | 719 |
| 19 | `handleSave` | function | 748 |
| 20 | `handleDisconnect` | function | 755 |

### 3.263 `frontend/src/components/shared/ActionHistoryBar.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatHistoryList` | function | 48 |
| 2 | `formatServerStatus` | function | 52 |
| 3 | `ActionHistoryBar` | export default function | 59 |

### 3.264 `frontend/src/components/shared/BackgroundImportTracker.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getImportTrackerApi` | function | 99 |
| 2 | `getErrorMessage` | function | 104 |
| 3 | `nextImportTrackerBackoff` | function | 108 |
| 4 | `normalizeJobStatus` | function | 115 |
| 5 | `dedupeJobsById` | function | 119 |
| 6 | `isRecent` | function | 131 |
| 7 | `normalizeImportJobListResult` | function | 137 |
| 8 | `getJobProgressDetails` | function | 152 |
| 9 | `getJobLabel` | function | 220 |
| 10 | `getJobResultSummary` | function | 226 |
| 11 | `add` | const arrow | 229 |
| 12 | `getRowsDisplay` | function | 242 |
| 13 | `buildJobsSignature` | function | 258 |
| 14 | `BackgroundImportTracker` | export default function | 273 |
| 15 | `finishTrackerAction` | const arrow | 412 |
| 16 | `handleCancel` | const arrow | 417 |
| 17 | `handleRetry` | const arrow | 436 |
| 18 | `handleApprove` | const arrow | 455 |
| 19 | `handleDownloadErrors` | const arrow | 485 |
| 20 | `handleRemove` | const arrow | 502 |
| 21 | `handleDismiss` | const arrow | 540 |

### 3.265 `frontend/src/components/shared/ExportMenu.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ExportMenu` | export default function | 15 |

### 3.266 `frontend/src/components/shared/FilterMenu.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sectionButtonClass` | function | 34 |
| 2 | `FilterMenu` | export default function | 40 |

### 3.267 `frontend/src/components/shared/globalScroll.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDocumentLike` | function | 21 |
| 2 | `getPageScrollCandidates` | function | 25 |
| 3 | `isVisibleScrollNode` | function | 38 |
| 4 | `getScrollTarget` | export function | 46 |
| 5 | `getScrollToPosition` | export function | 63 |

### 3.268 `frontend/src/components/shared/ImageGalleryLightbox.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ImageGalleryLightbox` | export default function | 29 |
| 2 | `formatLabel` | function | 51 |
| 3 | `setIndex` | function | 55 |
| 4 | `renderGalleryImage` | function | 61 |
| 5 | `onKeyDown` | function | 68 |

### 3.269 `frontend/src/components/shared/LoadingWatchdog.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `LoadingWatchdog` | export default function | 14 |

### 3.270 `frontend/src/components/shared/Modal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Modal` | export default function | 13 |

### 3.271 `frontend/src/components/shared/navigationConfig.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseNavSetting` | export function | 42 |

### 3.272 `frontend/src/components/shared/NotificationCenter.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getNotificationApi` | function | 101 |
| 2 | `getErrorMessage` | function | 106 |
| 3 | `preferenceValue` | function | 233 |
| 4 | `matchesVisibilityMode` | function | 241 |
| 5 | `NotificationSeverityIcon` | function | 248 |
| 6 | `NotificationCenter` | export default function | 263 |
| 7 | `syncVisibility` | const arrow | 297 |
| 8 | `onVisible` | const arrow | 371 |
| 9 | `handleClickOutside` | const arrow | 394 |

### 3.273 `frontend/src/components/shared/pageActivity.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `useIsPageActive` | export function | 8 |

### 3.274 `frontend/src/components/shared/PageHeader.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PageHeader` | export default function | 26 |

### 3.275 `frontend/src/components/shared/PaginationControls.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `clampPage` | export function | 26 |
| 2 | `PaginationControls` | export default function | 40 |
| 3 | `commitPageDraft` | const arrow | 70 |
| 4 | `handlePageInputKeyDown` | const arrow | 81 |

### 3.276 `frontend/src/components/shared/PortalMenu.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isPortalMenuItem` | function | 49 |
| 2 | `PortalMenu` | export default function | 59 |
| 3 | `closeIfClickedOutside` | const arrow | 117 |
| 4 | `closeMenu` | const arrow | 125 |
| 5 | `scheduleReposition` | const arrow | 126 |
| 6 | `closeIfEscape` | const arrow | 133 |
| 7 | `ThreeDotPortal` | export function | 243 |

### 3.277 `frontend/src/components/shared/QuickPreferenceToggles.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ToggleButton` | function | 24 |
| 2 | `QuickPreferenceToggles` | export default function | 43 |
| 3 | `tr` | const arrow | 46 |

### 3.278 `frontend/src/components/shared/SectionSwitcher.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readStoredSection` | function | 19 |
| 2 | `SectionSwitcher` | export default function | 28 |
| 3 | `selectValue` | const arrow | 55 |

### 3.279 `frontend/src/components/shared/WriteConflictModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `asConflictRecord` | function | 34 |
| 2 | `isConflictSummaryRow` | function | 38 |
| 3 | `isVisibleFieldRow` | function | 42 |
| 4 | `formatConflictTime` | function | 46 |
| 5 | `valueToString` | function | 53 |
| 6 | `summarizeCurrentValue` | function | 57 |
| 7 | `formatValue` | function | 114 |
| 8 | `formatItemSummary` | function | 121 |
| 9 | `getConflictFieldRows` | function | 132 |
| 10 | `WriteConflictModal` | export default function | 226 |

### 3.280 `frontend/src/components/users/PermissionEditor.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parsePermissionState` | function | 75 |
| 2 | `PermissionEditor` | export default function | 89 |
| 3 | `toggle` | const arrow | 104 |

### 3.281 `frontend/src/components/users/UserDetailSheet.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `translateLabel` | function | 43 |
| 2 | `buildRowData` | function | 48 |
| 3 | `parsePermissions` | function | 60 |
| 4 | `UserDetailSheet` | export default function | 71 |

### 3.282 `frontend/src/components/users/UserProfileModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getProfileApi` | function | 150 |
| 2 | `getErrorMessage` | function | 155 |
| 3 | `parseStoredOrganization` | function | 159 |
| 4 | `AvatarPreview` | function | 176 |
| 5 | `ProfileSectionButton` | function | 194 |
| 6 | `clamp` | function | 304 |
| 7 | `loadImageElement` | function | 308 |
| 8 | `renderAvatarCropBlob` | function | 323 |
| 9 | `AvatarEditorModal` | function | 349 |
| 10 | `UserProfileModal` | export default function | 410 |
| 11 | `handleProfileSave` | const arrow | 578 |
| 12 | `handlePasswordSave` | const arrow | 642 |
| 13 | `handleSessionSave` | const arrow | 681 |
| 14 | `refreshOtpState` | const arrow | 701 |

### 3.283 `frontend/src/components/users/Users.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getUsersApi` | function | 134 |
| 2 | `normalizeUsers` | function | 139 |
| 3 | `normalizeRoles` | function | 143 |
| 4 | `normalizePermissionState` | function | 147 |
| 5 | `getErrorMessage` | function | 162 |
| 6 | `clearTimeoutRef` | function | 166 |
| 7 | `ThreeDot` | function | 183 |
| 8 | `formatContactValue` | function | 222 |
| 9 | `UsersDesktopSkeletonRows` | function | 227 |
| 10 | `UsersMobileSkeletonCards` | function | 251 |
| 11 | `Users` | export default function | 265 |
| 12 | `promise` | const arrow | 332 |
| 13 | `promise` | const arrow | 370 |
| 14 | `openCreateUser` | const arrow | 482 |
| 15 | `openCreateRole` | const arrow | 512 |
| 16 | `handleSaveUser` | const arrow | 573 |
| 17 | `handleResetPassword` | const arrow | 643 |
| 18 | `handleSaveRole` | const arrow | 700 |

### 3.284 `frontend/src/components/utils-settings/AuditLog.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getAuditApi` | function | 94 |
| 2 | `isRecord` | function | 98 |
| 3 | `getErrorMessage` | function | 102 |
| 4 | `toIso` | function | 134 |
| 5 | `formatDateTime` | function | 141 |
| 6 | `formatLogTime` | function | 162 |
| 7 | `getLogEpoch` | function | 166 |
| 8 | `formatJsonPretty` | function | 173 |
| 9 | `parseLogJson` | function | 181 |
| 10 | `flattenSummaryValue` | function | 189 |
| 11 | `formatEntityName` | function | 208 |
| 12 | `readableSummary` | function | 214 |
| 13 | `normalizeFiniteIds` | function | 242 |
| 14 | `countSelectedIds` | function | 246 |
| 15 | `countActiveFlags` | function | 254 |
| 16 | `DetailRow` | function | 262 |
| 17 | `AuditLog` | export default function | 274 |
| 18 | `sessionEntryLabel` | function | 668 |

### 3.285 `frontend/src/components/utils-settings/Backup.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBackupApi` | function | 228 |
| 2 | `getErrorMessage` | function | 232 |
| 3 | `unwrapJob` | function | 236 |
| 4 | `isBackupSectionId` | function | 263 |
| 5 | `PathActionButton` | function | 312 |
| 6 | `PrimaryActionButton` | function | 324 |
| 7 | `formatElapsed` | function | 336 |
| 8 | `JobProgressCard` | function | 345 |
| 9 | `DoctorStatusPill` | function | 405 |
| 10 | `IntegrationDoctorCard` | function | 429 |
| 11 | `useCopy` | function | 535 |
| 12 | `formatDateTime` | function | 551 |
| 13 | `formatBytes` | function | 567 |
| 14 | `yieldToBrowser` | function | 576 |
| 15 | `getJobSignature` | function | 584 |
| 16 | `startJobWatcher` | function | 603 |
| 17 | `stop` | const arrow | 619 |
| 18 | `scheduleTick` | const arrow | 625 |
| 19 | `tick` | const arrow | 631 |
| 20 | `SectionChip` | function | 688 |
| 21 | `secondsToSyncMinutes` | function | 710 |
| 22 | `minutesToSyncSeconds` | function | 719 |
| 23 | `GoogleDriveSyncSection` | function | 727 |
| 24 | `handler` | const arrow | 849 |
| 25 | `savePreferences` | const arrow | 934 |
| 26 | `connectGoogleDrive` | const arrow | 964 |
| 27 | `syncNow` | const arrow | 1009 |
| 28 | `disconnect` | const arrow | 1046 |
| 29 | `forgetCredentials` | const arrow | 1071 |
| 30 | `BackupOverview` | function | 1301 |
| 31 | `Backup` | export default function | 1373 |
| 32 | `showBackupSection` | const arrow | 1388 |
| 33 | `handleFolderExport` | const arrow | 1414 |
| 34 | `handleFolderImport` | const arrow | 1483 |

### 3.286 `frontend/src/components/utils-settings/FontFamilyPicker.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `FontFamilyPicker` | export default function | 29 |

### 3.287 `frontend/src/components/utils-settings/index.ts`

- No top-level named symbols detected.

### 3.288 `frontend/src/components/utils-settings/OtpModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getOtpApi` | function | 45 |
| 2 | `getErrorMessage` | function | 49 |
| 3 | `OtpModal` | export default function | 53 |
| 4 | `loadSetup` | function | 88 |

### 3.289 `frontend/src/components/utils-settings/ResetData.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ConfirmReset` | function | 72 |
| 2 | `T` | const arrow | 85 |
| 3 | `getResetApi` | function | 153 |
| 4 | `getErrorMessage` | function | 157 |
| 5 | `ResetData` | function | 161 |
| 6 | `T` | const arrow | 163 |
| 7 | `doReset` | const arrow | 191 |
| 8 | `FactoryReset` | function | 261 |
| 9 | `T` | const arrow | 263 |
| 10 | `doFactoryReset` | function | 270 |

### 3.290 `frontend/src/components/utils-settings/Settings.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSettingsApi` | function | 107 |
| 2 | `getErrorMessage` | function | 111 |
| 3 | `toStringValue` | function | 115 |
| 4 | `toNumberValue` | function | 120 |
| 5 | `isSettingsSectionId` | function | 208 |
| 6 | `parseStoredColors` | function | 224 |
| 7 | `buildColorChoices` | function | 235 |
| 8 | `useCopy` | function | 326 |
| 9 | `getSettingsNavLabel` | function | 334 |
| 10 | `SwatchPicker` | function | 351 |
| 11 | `SettingsSection` | function | 434 |
| 12 | `Settings` | export default function | 464 |
| 13 | `showSettingsSection` | const arrow | 490 |
| 14 | `loadOtpStatus` | function | 560 |
| 15 | `loadFaviconPreview` | function | 590 |
| 16 | `setValue` | const arrow | 647 |
| 17 | `formatPreviewDateTime` | const arrow | 673 |
| 18 | `moveNavItem` | const arrow | 689 |
| 19 | `toggleMobilePinned` | const arrow | 699 |
| 20 | `movePinnedItem` | const arrow | 711 |
| 21 | `movePinnedBefore` | const arrow | 721 |
| 22 | `resetNavigationLayout` | const arrow | 733 |
| 23 | `field` | const arrow | 738 |
| 24 | `savePaymentMethods` | const arrow | 760 |
| 25 | `uploadImageSetting` | const arrow | 780 |
| 26 | `handleSaveSettings` | const arrow | 846 |

### 3.291 `frontend/src/components/utils-settings/settingsConflict.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeObject` | function | 28 |
| 2 | `buildSettingsConflictState` | export function | 32 |
| 3 | `diffSettingsConflictFields` | export function | 46 |

### 3.292 `frontend/src/constants.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createEmptyOrder` | export function | 128 |
| 2 | `formatDate` | export function | 152 |
| 3 | `isNetworkError` | export function | 181 |

### 3.293 `frontend/src/index.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `registerOfflineAppShell` | function | 22 |
| 2 | `register` | const arrow | 25 |
| 3 | `installFormFieldAccessibility` | function | 41 |
| 4 | `escapeSelectorValue` | const arrow | 46 |
| 5 | `wireField` | const arrow | 51 |
| 6 | `scan` | const arrow | 73 |
| 7 | `safeInsertRule` | const function | 111 |
| 8 | `safeCssRulesGetter` | const function | 129 |
| 9 | `stopKnownStartupNoise` | const arrow | 145 |
| 10 | `scheduleFormFieldAccessibility` | function | 180 |

### 3.294 `frontend/src/platform/runtime/clientRuntime.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `canUseBrowserStorage` | function | 31 |
| 2 | `isBusinessOsStorageKey` | function | 35 |
| 3 | `sanitizeText` | function | 40 |
| 4 | `sanitizeSyncServerUrl` | export function | 44 |
| 5 | `normalizeRuntimeDescriptor` | export function | 56 |
| 6 | `readStoredRuntimeDescriptor` | export function | 65 |
| 7 | `writeStoredRuntimeDescriptor` | export function | 76 |
| 8 | `shouldResetForRuntimeChange` | export function | 90 |
| 9 | `buildQueuedOperationScope` | export function | 107 |
| 10 | `doesQueuedScopeMatchCurrent` | export function | 115 |
| 11 | `unregisterServiceWorkers` | function | 152 |
| 12 | `deleteBusinessOsCaches` | function | 156 |
| 13 | `clearServiceWorkersAndCaches` | function | 162 |
| 14 | `snapshotStorage` | function | 178 |
| 15 | `clearStorage` | function | 191 |
| 16 | `restoreStorage` | function | 204 |
| 17 | `resetClientRuntimeState` | export function | 214 |

### 3.295 `frontend/src/platform/storage/storagePolicy.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `shouldPersistLocalMirror` | export function | 22 |
| 2 | `maxStoredNumber` | export function | 29 |
| 3 | `isCooldownActive` | export function | 36 |

### 3.296 `frontend/src/runtime/runtimeErrorClassifier.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `messageOf` | function | 27 |
| 2 | `stackOf` | function | 31 |
| 3 | `toText` | function | 35 |
| 4 | `includesExtensionOrigin` | function | 39 |
| 5 | `getPathname` | function | 44 |
| 6 | `isFirstPartyBuiltAssetSource` | export function | 54 |
| 7 | `isLikelyInjectedRuntimeSource` | export function | 64 |
| 8 | `isKnownBridgeMessage` | export function | 75 |
| 9 | `isKnownStyleInjectionNoise` | export function | 86 |
| 10 | `isKnownEvalCspNoise` | export function | 105 |
| 11 | `shouldSuppressRuntimeError` | export function | 112 |
| 12 | `shouldSuppressSecurityPolicyViolation` | export function | 134 |
| 13 | `isGuardableStyleSheetError` | export function | 148 |

### 3.297 `frontend/src/types/jsx-modules.d.ts`

- No top-level named symbols detected.

### 3.298 `frontend/src/types/receiptContracts.ts`

- No top-level named symbols detected.

### 3.299 `frontend/src/types/settingsContracts.ts`

- No top-level named symbols detected.

### 3.300 `frontend/src/utils/actionGuards.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `hasOwn` | function | 18 |
| 2 | `beginNamedAction` | export function | 41 |
| 3 | `finishNamedAction` | export function | 52 |
| 4 | `beginKeyedAction` | export function | 58 |
| 5 | `finishKeyedAction` | export function | 70 |

### 3.301 `frontend/src/utils/actionHistory.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeActionHistoryId` | function | 94 |
| 2 | `normalizeEntry` | function | 100 |
| 3 | `parsePermissions` | function | 113 |
| 4 | `getErrorMessage` | function | 125 |
| 5 | `useActionHistory` | export function | 129 |

### 3.302 `frontend/src/utils/appRefresh.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeRefreshChannels` | export function | 20 |
| 2 | `refreshAppData` | export function | 28 |

### 3.303 `frontend/src/utils/bulkOps.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runner` | function | 47 |

### 3.304 `frontend/src/utils/color.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeHex` | function | 1 |
| 2 | `relativeLuminance` | function | 12 |
| 3 | `getContrastingTextColor` | export function | 29 |

### 3.305 `frontend/src/utils/csv.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `escapeCsvValue` | function | 17 |
| 2 | `buildCSV` | export function | 28 |
| 3 | `downloadBlob` | export function | 40 |
| 4 | `downloadCSV` | export function | 48 |
| 5 | `normalizeZipFile` | function | 54 |
| 6 | `CRC32_TABLE` | const arrow | 66 |
| 7 | `crc32` | function | 78 |
| 8 | `writeUint16` | function | 86 |
| 9 | `writeUint32` | function | 90 |
| 10 | `toBlobPart` | function | 94 |
| 11 | `encodeZipTimestamp` | function | 100 |
| 12 | `buildZip` | export function | 113 |
| 13 | `buildZipInWorker` | export function | 190 |
| 14 | `downloadZipFiles` | export function | 219 |
| 15 | `downloadZipFilesAsync` | export function | 225 |

### 3.306 `frontend/src/utils/csvExportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getErrorMessage` | function | 20 |

### 3.307 `frontend/src/utils/csvImport.ts`

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

### 3.308 `frontend/src/utils/csvRowCounter.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `countCsvDataRows` | export function | 1 |
| 2 | `finishRecord` | const arrow | 7 |

### 3.309 `frontend/src/utils/dateHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toLocalDateString` | function | 4 |
| 2 | `todayStr` | export function | 8 |
| 3 | `offsetDate` | export function | 13 |

### 3.310 `frontend/src/utils/deviceInfo.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBrowserName` | function | 13 |
| 2 | `getOperatingSystemName` | function | 21 |
| 3 | `getClientDeviceInfo` | export function | 30 |
| 4 | `getClientMetaHeaders` | export function | 42 |

### 3.311 `frontend/src/utils/exportPackage.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildReportManifestRows` | export function | 30 |
| 2 | `buildReportPackageFiles` | export function | 38 |

### 3.312 `frontend/src/utils/exportReports.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `escapeHtml` | function | 255 |
| 2 | `formatCellValue` | function | 264 |
| 3 | `renderChartMarkup` | function | 269 |
| 4 | `renderMetadataGroups` | function | 285 |
| 5 | `renderSummaryCards` | function | 307 |
| 6 | `renderCharts` | function | 322 |
| 7 | `renderTables` | function | 340 |
| 8 | `renderNotes` | function | 374 |
| 9 | `buildStandaloneReportHtml` | export function | 386 |

### 3.313 `frontend/src/utils/favicon.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `clamp` | function | 11 |
| 2 | `shouldUseAnonymousCors` | function | 18 |
| 3 | `loadImage` | function | 29 |
| 4 | `createCircularFaviconDataUrl` | export function | 49 |

### 3.314 `frontend/src/utils/formatters.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeTimestampInput` | function | 6 |
| 2 | `fmtTime` | export function | 28 |
| 3 | `fmtDate` | export function | 52 |
| 4 | `fmtShort` | export function | 73 |
| 5 | `fmtCount` | export function | 85 |

### 3.315 `frontend/src/utils/groupedRecords.ts`

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

### 3.316 `frontend/src/utils/historyHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `extractHistoryResultId` | export function | 26 |
| 2 | `resolveCreatedHistorySnapshot` | export function | 36 |

### 3.317 `frontend/src/utils/importJobRefresh.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeImportJobStatus` | function | 24 |
| 2 | `normalizeImportJobType` | function | 28 |
| 3 | `uniqueChannels` | function | 32 |
| 4 | `dispatchSyncUpdate` | function | 41 |
| 5 | `getImportCompletionRefreshChannels` | export function | 45 |
| 6 | `shouldDispatchImportCompletionRefresh` | export function | 68 |
| 7 | `dispatchImportCompletionRefresh` | export function | 79 |

### 3.318 `frontend/src/utils/index.ts`

- No top-level named symbols detected.

### 3.319 `frontend/src/utils/initials.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeInitialText` | export function | 30 |
| 2 | `getInitialKey` | export function | 34 |
| 3 | `getInitialType` | export function | 45 |
| 4 | `getInitialRank` | function | 54 |
| 5 | `compareInitialKeys` | export function | 64 |
| 6 | `aggregateInitialOptions` | export function | 79 |
| 7 | `buildInitialOptionsFromProducts` | export function | 97 |

### 3.320 `frontend/src/utils/loaders.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `settleLoaderMap` | export function | 20 |
| 2 | `beginTrackedRequest` | export function | 47 |
| 3 | `isTrackedRequestCurrent` | export function | 53 |
| 4 | `invalidateTrackedRequest` | export function | 57 |
| 5 | `createLoaderTimeoutError` | export function | 63 |
| 6 | `getLoaderErrorMessage` | export function | 93 |
| 7 | `getFirstLoaderError` | export function | 97 |

### 3.321 `frontend/src/utils/mediaUpload.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createInitialUploadState` | export function | 33 |
| 2 | `isTemporaryPreviewUrl` | export function | 47 |
| 3 | `sanitizePersistedMediaPath` | export function | 52 |
| 4 | `buildCacheBustedMediaPath` | export function | 59 |
| 5 | `reduceUploadState` | export function | 77 |

### 3.322 `frontend/src/utils/permissions.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isPermissionMap` | function | 3 |
| 2 | `parsePermissionMap` | export function | 7 |

### 3.323 `frontend/src/utils/pricing.ts`

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

### 3.324 `frontend/src/utils/printReceipt.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parsePrintNumber` | function | 42 |
| 2 | `cloneElementWithInlineStyles` | function | 115 |
| 3 | `escapeHtml` | function | 161 |
| 4 | `blobToDataUrl` | function | 170 |
| 5 | `inlineImageNodeSources` | function | 193 |
| 6 | `extractUrlsFromCssValue` | function | 216 |
| 7 | `inlineStyleAssetUrls` | function | 222 |
| 8 | `normalizePrintableRoot` | function | 256 |
| 9 | `mmToPt` | function | 273 |
| 10 | `dataUrlToBytes` | function | 277 |
| 11 | `bytesToBlobPart` | function | 287 |
| 12 | `joinPdfChunks` | function | 291 |
| 13 | `buildPdfStream` | function | 302 |
| 14 | `buildSingleImagePdf` | function | 311 |
| 15 | `escapePdfText` | function | 349 |
| 16 | `wrapTextLine` | function | 356 |
| 17 | `buildTextOnlyPdf` | function | 375 |
| 18 | `buildReceiptFileName` | function | 428 |
| 19 | `createTextOnlyReceiptCanvas` | function | 439 |
| 20 | `canvasToPngBlob` | function | 480 |
| 21 | `waitForElementAssets` | function | 493 |
| 22 | `renderElementToCanvas` | function | 522 |
| 23 | `createPrintableReceiptMarkup` | function | 633 |
| 24 | `buildPrintablePreviewDocument` | function | 648 |
| 25 | `attachPrintablePreviewActions` | function | 795 |
| 26 | `schedulePrint` | const arrow | 804 |
| 27 | `openPrintableReceiptPreview` | export function | 809 |
| 28 | `downloadBlob` | function | 822 |
| 29 | `getPrintSettings` | export function | 833 |
| 30 | `savePrintSettings` | export function | 846 |
| 31 | `getPaperWidthMm` | export function | 854 |
| 32 | `createReceiptPdfBlob` | export function | 864 |
| 33 | `buildTextOnlyReceiptBlob` | const arrow | 870 |
| 34 | `renderPdfBlob` | const arrow | 884 |
| 35 | `createReceiptImageBlob` | export function | 919 |
| 36 | `extractReceiptLines` | function | 940 |
| 37 | `downloadReceiptPdf` | export function | 958 |
| 38 | `downloadReceiptImage` | export function | 977 |
| 39 | `openReceiptPdf` | export function | 984 |
| 40 | `printReceipt` | export function | 1008 |

### 3.325 `frontend/src/utils/productBatches.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeBranchId` | function | 26 |
| 2 | `getVisibleProductBatches` | export function | 32 |
| 3 | `buildBatchPreview` | export function | 53 |

### 3.326 `frontend/src/utils/productGrouping.ts`

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

### 3.327 `frontend/src/utils/publicAssetUrls.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trimBaseUrl` | function | 11 |
| 2 | `normalizeUploadPath` | function | 15 |
| 3 | `appendAssetVersion` | function | 23 |
| 4 | `isLocalLikeHostname` | function | 38 |
| 5 | `getSafeCurrentOrigin` | function | 42 |
| 6 | `getStoredPublicAssetBaseUrl` | export function | 54 |
| 7 | `api` | const arrow | 57 |
| 8 | `resolvePublicAssetUrl` | export function | 68 |

### 3.328 `frontend/src/utils/receiptAppliedConfig.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseObject` | function | 67 |
| 2 | `normalizeReceiptTemplate` | export function | 85 |
| 3 | `serializeReceiptTemplateValue` | export function | 92 |
| 4 | `normalizeReceiptPrintSettings` | export function | 96 |
| 5 | `serializeReceiptPrintSettings` | export function | 110 |
| 6 | `readReceiptPrintSettingsFromSettings` | export function | 114 |
| 7 | `buildAppliedReceiptConfig` | export function | 118 |

### 3.329 `frontend/src/utils/scriptTypography.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `containsKhmerScript` | export function | 8 |
| 2 | `withKhmerTextClass` | export function | 12 |
| 3 | `getKhmerTextProps` | export function | 18 |

### 3.330 `frontend/src/utils/settingsRefresh.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeSettingKeys` | function | 62 |
| 2 | `getSettingsRefreshChannels` | export function | 70 |

### 3.331 `frontend/src/utils/settingsWriteOptions.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeSettingsWriteOptions` | export function | 3 |

### 3.332 `frontend/src/web-api.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sanitizeBaseUrl` | function | 77 |
| 2 | `loadMethodsModule` | function | 81 |
| 3 | `getLazyApiMethod` | function | 86 |
| 4 | `mapOfflineFileChunkStatusUpdates` | function | 100 |
| 5 | `asArrayBuffer` | function | 116 |
| 6 | `bytesToBase64` | function | 120 |
| 7 | `base64ToBytes` | function | 131 |
| 8 | `stableStringify` | function | 138 |
| 9 | `sha256Hex` | function | 144 |
| 10 | `deriveOfflineVaultKey` | function | 152 |
| 11 | `encryptOfflineVaultValue` | function | 169 |
| 12 | `decryptOfflineVaultValue` | function | 177 |
| 13 | `requestOfflinePersistentStorage` | function | 187 |
| 14 | `dispatchVaultLocked` | function | 194 |
| 15 | `scheduleOfflineVaultIdleLock` | function | 199 |
| 16 | `lockOfflineVault` | function | 205 |
| 17 | `unlockOfflineVault` | function | 213 |
| 18 | `queueBusinessOutboxOperation` | function | 238 |
| 19 | `queueOfflineFileChunks` | function | 276 |
| 20 | `dispatchOutboxProgress` | function | 329 |
| 21 | `dispatchOutboxFileProgress` | function | 336 |
| 22 | `dispatchOutboxConflict` | function | 343 |
| 23 | `getSyncOutboxKey` | function | 350 |
| 24 | `syncUnlockedOfflineOutbox` | function | 354 |
| 25 | `syncUnlockedOfflineFileChunks` | function | 463 |
| 26 | `registerOutboxBackgroundSync` | function | 524 |
| 27 | `refreshOfflineSnapshotSoon` | function | 539 |
| 28 | `run` | const arrow | 549 |
| 29 | `refreshServiceWorkerSoon` | function | 568 |
| 30 | `runOfflineMaintenance` | function | 578 |
| 31 | `startOfflineMaintenanceLoop` | function | 590 |
| 32 | `forwardServiceWorkerOutboxEvent` | function | 598 |
| 33 | `forwardServiceWorkerAppEvent` | function | 692 |

### 3.333 `frontend/tailwind.config.ts`

- No top-level named symbols detected.

### 3.334 `frontend/tests/actionGuards.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 15 |

### 3.335 `frontend/tests/actionStability.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readFrontend` | function | 12 |
| 2 | `readRepo` | function | 16 |
| 3 | `runTest` | function | 22 |

### 3.336 `frontend/tests/adminShellMediaGuards.test.ts`

- No top-level named symbols detected.

### 3.337 `frontend/tests/apiHttp.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 24 |
| 2 | `createDeferredResponse` | function | 35 |
| 3 | `resetApiState` | function | 46 |

### 3.338 `frontend/tests/appRefresh.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `testNormalizeRefreshChannels` | function | 10 |
| 2 | `testRefreshAppDataDispatchesMergedDetail` | function | 17 |

### 3.339 `frontend/tests/appShellUtils.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 10 |

### 3.340 `frontend/tests/assetCompression.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `collectMediaFiles` | function | 12 |

### 3.341 `frontend/tests/backupJobs.test.ts`

- No top-level named symbols detected.

### 3.342 `frontend/tests/barcodeImageScanner.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createLoadedImage` | function | 13 |
| 2 | `runTest` | function | 29 |

### 3.343 `frontend/tests/barcodeScannerState.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.344 `frontend/tests/bulkOps.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.345 `frontend/tests/contactImportWorker.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |

### 3.346 `frontend/tests/csvImport.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |

### 3.347 `frontend/tests/dashboardDataReliability.test.ts`

- No top-level named symbols detected.

### 3.348 `frontend/tests/dateHelpers.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |
| 2 | `parseLocalDate` | function | 19 |

### 3.349 `frontend/tests/deviceInfo.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |
| 2 | `withNavigator` | function | 19 |

### 3.350 `frontend/tests/exportPackages.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 10 |

### 3.351 `frontend/tests/formatters.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.352 `frontend/tests/globalScroll.test.ts`

- No top-level named symbols detected.

### 3.353 `frontend/tests/globalScrollControls.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.354 `frontend/tests/groupedRecords.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.355 `frontend/tests/historyHelpers.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 13 |

### 3.356 `frontend/tests/importJobRefresh.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `testProductImportChannels` | function | 14 |
| 2 | `testSupplierImportChannels` | function | 21 |
| 3 | `testDispatchOnlyOnTerminalTransition` | function | 28 |
| 4 | `testDispatchEmitsExpectedEvents` | function | 52 |

### 3.357 `frontend/tests/initials.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.358 `frontend/tests/inventoryImportWorker.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |

### 3.359 `frontend/tests/inventoryMobileCardLayout.test.ts`

- No top-level named symbols detected.

### 3.360 `frontend/tests/inventoryMovementGroups.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.361 `frontend/tests/inventoryRfidSection.test.ts`

- No top-level named symbols detected.

### 3.362 `frontend/tests/jsxSyntaxCheck.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `listSourceFiles` | function | 10 |

### 3.363 `frontend/tests/loaders.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 16 |

### 3.364 `frontend/tests/mediaUploadHelpers.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.365 `frontend/tests/navigationConfig.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.366 `frontend/tests/notificationBadge.test.ts`

- No top-level named symbols detected.

### 3.367 `frontend/tests/offlineSalesQueue.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.368 `frontend/tests/offlineSecurityHardening.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.369 `frontend/tests/offlineSyncArchitecture.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.370 `frontend/tests/ownedGoogleAuth.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.371 `frontend/tests/performanceLoadingUx.test.ts`

- No top-level named symbols detected.

### 3.372 `frontend/tests/permissionEditor.test.ts`

- No top-level named symbols detected.

### 3.373 `frontend/tests/permissions.test.ts`

- No top-level named symbols detected.

### 3.374 `frontend/tests/portalCatalogDisplay.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 20 |

### 3.375 `frontend/tests/portalContentI18n.test.ts`

- No top-level named symbols detected.

### 3.376 `frontend/tests/portalEditorUtils.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 13 |

### 3.377 `frontend/tests/portalFaqVocabulary.test.ts`

- No top-level named symbols detected.

### 3.378 `frontend/tests/portalLanguagePacks.test.ts`

- No top-level named symbols detected.

### 3.379 `frontend/tests/portalTranslateController.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createStorage` | function | 46 |
| 2 | `createDocument` | function | 61 |
| 3 | `TestEvent` | class | 132 |

### 3.380 `frontend/tests/posCore.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 18 |

### 3.381 `frontend/tests/pricingContacts.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 15 |

### 3.382 `frontend/tests/productBatches.test.ts`

- No top-level named symbols detected.

### 3.383 `frontend/tests/productDiscountUx.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.384 `frontend/tests/productDisplayHelpers.test.ts`

- No top-level named symbols detected.

### 3.385 `frontend/tests/productFilterHelpers.test.ts`

- No top-level named symbols detected.

### 3.386 `frontend/tests/productGalleryHelpers.test.ts`

- No top-level named symbols detected.

### 3.387 `frontend/tests/productGrouping.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.388 `frontend/tests/productGroupViewHelpers.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fmtUSD` | const arrow | 7 |
| 2 | `t` | const arrow | 8 |

### 3.389 `frontend/tests/productHistoryHelpers.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.390 `frontend/tests/productImportPlanner.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 15 |

### 3.391 `frontend/tests/productImportWorkerFallback.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |

### 3.392 `frontend/tests/productMenuHelpers.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `exportProductsCsv` | const arrow | 16 |
| 2 | `tr` | const arrow | 19 |
| 3 | `asActionItem` | function | 21 |
| 4 | `requireSection` | function | 27 |
| 5 | `action` | const arrow | 108 |

### 3.393 `frontend/tests/productPageHelpers.test.ts`

- No top-level named symbols detected.

### 3.394 `frontend/tests/productSearchPagination.test.ts`

- No top-level named symbols detected.

### 3.395 `frontend/tests/productSelectionHelpers.test.ts`

- No top-level named symbols detected.

### 3.396 `frontend/tests/productWriteHelpers.test.ts`

- No top-level named symbols detected.

### 3.397 `frontend/tests/publicErrorRecovery.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createStorage` | function | 10 |

### 3.398 `frontend/tests/receiptSettingsSync.test.ts`

- No top-level named symbols detected.

### 3.399 `frontend/tests/receiptTemplate.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 10 |

### 3.400 `frontend/tests/returnsLayout.test.ts`

- No top-level named symbols detected.

### 3.401 `frontend/tests/runtimeErrorClassifier.test.ts`

- No top-level named symbols detected.

### 3.402 `frontend/tests/salesImportWorker.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |

### 3.403 `frontend/tests/scanbotScanner.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `setNavigator` | function | 18 |
| 2 | `run` | function | 26 |

### 3.404 `frontend/tests/scriptTypography.test.ts`

- No top-level named symbols detected.

### 3.405 `frontend/tests/sectionNavigation.test.ts`

- No top-level named symbols detected.

### 3.406 `frontend/tests/settingsConflictHelpers.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.407 `frontend/tests/settingsRefresh.test.ts`

- No top-level named symbols detected.

### 3.408 `frontend/tests/storagePolicy.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 15 |

### 3.409 `frontend/tests/utilsSettingsBarrel.test.ts`

- No top-level named symbols detected.

### 3.410 `frontend/vite.config.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readGitRevision` | function | 11 |
| 2 | `fixCrossorigin` | function | 49 |
| 3 | `emitBuildManifest` | function | 74 |
| 4 | `shouldDeferModulePreload` | function | 115 |
| 5 | `manualChunks` | function | 119 |

### 3.411 `ops/scripts/architecture/generated-bulk-audit.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseArgs` | function | 157 |
| 2 | `walkPathStats` | function | 171 |
| 3 | `recursivePathStats` | function | 208 |
| 4 | `pathStats` | function | 237 |
| 5 | `hasAnyToken` | function | 258 |
| 6 | `toPowerShellTargetToken` | function | 262 |
| 7 | `compactTargetRows` | function | 266 |
| 8 | `compactTimedRows` | function | 281 |
| 9 | `summarizeByDisposition` | function | 297 |
| 10 | `dispositionRows` | function | 312 |
| 11 | `isNestedTarget` | function | 324 |
| 12 | `collectTargetOverlaps` | function | 330 |
| 13 | `manifestHasInstallDeps` | function | 346 |
| 14 | `recordExists` | function | 355 |
| 15 | `buildDependencyTopology` | function | 359 |
| 16 | `buildSummary` | function | 393 |
| 17 | `renderReport` | function | 453 |
| 18 | `main` | function | 534 |

### 3.412 `ops/scripts/architecture/language-runtime-audit.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `walkFiles` | function | 35 |
| 2 | `countBy` | function | 57 |
| 3 | `hasReactOrDomBoundary` | function | 66 |
| 4 | `hasWorkerCandidateWork` | function | 70 |
| 5 | `hasSqlOrAnalyticsWork` | function | 74 |
| 6 | `scoreTypeScriptCandidate` | function | 78 |
| 7 | `scoreWorkerCandidate` | function | 93 |
| 8 | `scoreSqlCandidate` | function | 103 |
| 9 | `compactCandidates` | function | 112 |
| 10 | `verificationMatrix` | function | 120 |
| 11 | `buildFirstExecutableSlices` | function | 158 |
| 12 | `collectFocusedTestCoverage` | function | 1125 |
| 13 | `collectConvertedTypeScriptSlices` | function | 1140 |
| 14 | `collectCompletedWebWorkerSlices` | function | 1162 |
| 15 | `collectCompletedDataPathSlices` | function | 1186 |
| 16 | `collectProofCommandCoverage` | function | 1202 |
| 17 | `collectRecords` | function | 1256 |
| 18 | `renderReport` | function | 1273 |
| 19 | `buildSummary` | function | 1432 |
| 20 | `main` | function | 1511 |

### 3.413 `ops/scripts/architecture/organization-audit.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `walkFiles` | function | 23 |
| 2 | `getArea` | function | 44 |
| 3 | `countBy` | function | 75 |
| 4 | `extractRelativeImports` | function | 84 |
| 5 | `collectFileRecords` | function | 99 |
| 6 | `nonEmptyLines` | function | 133 |
| 7 | `extractWrapperTarget` | function | 137 |
| 8 | `collectCompatibilityWrappers` | function | 150 |
| 9 | `countOccurrences` | function | 173 |
| 10 | `wrapperReferenceCandidates` | function | 184 |
| 11 | `collectWrapperReferenceDetails` | function | 204 |
| 12 | `renderReferenceFiles` | function | 231 |
| 13 | `renderReport` | function | 239 |
| 14 | `buildSummary` | function | 328 |
| 15 | `main` | function | 356 |

### 3.414 `ops/scripts/architecture/phase29-audit.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseArgs` | function | 72 |
| 2 | `parseLastJsonObject` | function | 89 |
| 3 | `runChildProcess` | function | 101 |
| 4 | `runCheck` | function | 129 |
| 5 | `runCheckGroup` | function | 154 |
| 6 | `flattenCycles` | function | 158 |
| 7 | `buildDurationSummary` | function | 162 |
| 8 | `renderReport` | function | 197 |
| 9 | `comparableValue` | function | 288 |
| 10 | `collectParsedByCycle` | function | 300 |
| 11 | `buildRepeatConsistency` | function | 306 |
| 12 | `buildSummary` | function | 498 |
| 13 | `main` | function | 536 |

### 3.415 `ops/scripts/backend/schema-audit.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `read` | function | 33 |
| 2 | `uniqueSorted` | function | 37 |
| 3 | `getLineNumber` | function | 41 |
| 4 | `matchAllWithLine` | function | 45 |
| 5 | `parseSqlTables` | function | 54 |
| 6 | `parseAlteredPrimaryKeys` | function | 77 |
| 7 | `parseColumns` | function | 87 |
| 8 | `parsePrimaryKey` | function | 104 |
| 9 | `cleanColumnList` | function | 121 |
| 10 | `parseIndexes` | function | 128 |
| 11 | `parseRuntimeStatements` | function | 145 |
| 12 | `uniqueRuntimeRows` | function | 187 |
| 13 | `parseDexieStores` | function | 199 |
| 14 | `loadBackupSchema` | function | 220 |
| 15 | `countForeignKeyDeclarations` | function | 226 |
| 16 | `buildCoverage` | function | 233 |
| 17 | `buildBackupCoverage` | function | 242 |
| 18 | `renderList` | function | 264 |
| 19 | `renderRuntimeRows` | function | 269 |
| 20 | `renderTableCatalog` | function | 274 |
| 21 | `primaryKeyGapRows` | function | 280 |
| 22 | `renderPrimaryKeyGaps` | function | 293 |
| 23 | `renderReport` | function | 308 |
| 24 | `buildSummary` | function | 398 |
| 25 | `main` | function | 430 |

### 3.416 `ops/scripts/backend/schema-primary-key-preflight.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseArgs` | function | 30 |
| 2 | `assertInsideWorkspace` | function | 53 |
| 3 | `runPsql` | function | 59 |
| 4 | `buildPreflightSql` | function | 70 |
| 5 | `summarize` | function | 178 |

### 3.417 `ops/scripts/backend/verify-data-integrity.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseEnvFile` | function | 27 |
| 2 | `fail` | function | 59 |
| 3 | `pass` | function | 66 |
| 4 | `approxEqual` | function | 71 |
| 5 | `stripTrailingSemicolon` | function | 75 |
| 6 | `runPsql` | function | 79 |
| 7 | `queryRows` | function | 101 |
| 8 | `queryOne` | function | 110 |
| 9 | `queryScalarList` | function | 114 |
| 10 | `execSql` | function | 118 |
| 11 | `sqlString` | function | 122 |
| 12 | `sqlIdentifier` | function | 126 |
| 13 | `generatedTextMatch` | function | 130 |
| 14 | `checkNoNegativeStock` | function | 137 |
| 15 | `checkProductStockMatchesBranches` | function | 146 |
| 16 | `checkSaleItemTotals` | function | 191 |
| 17 | `checkReturnDoesNotExceedSold` | function | 201 |
| 18 | `addCleanupClassification` | function | 231 |
| 19 | `addCleanupCandidateIds` | function | 243 |
| 20 | `classifyIntegrityBacklog` | function | 253 |
| 21 | `checkProfitFormulaConsistency` | function | 405 |
| 22 | `checkCogsSnapshotVsCurrentProductCost` | function | 441 |
| 23 | `checkPostgresRuntimeTables` | function | 462 |
| 24 | `checkDatasetReadiness` | function | 491 |
| 25 | `checkRelationshipOrphans` | function | 529 |
| 26 | `writeReport` | function | 646 |
| 27 | `run` | function | 656 |

### 3.418 `ops/scripts/frontend/verify-i18n.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `collectUsedKeys` | function | 29 |
| 2 | `flattenTranslationTree` | function | 69 |
| 3 | `listMissing` | function | 83 |
| 4 | `listEmptyValues` | function | 88 |
| 5 | `printList` | function | 95 |
| 6 | `main` | function | 102 |

### 3.419 `ops/scripts/frontend/verify-performance.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `read` | function | 15 |
| 2 | `walk` | function | 19 |
| 3 | `trackedFiles` | function | 37 |
| 4 | `assert` | function | 47 |

### 3.420 `ops/scripts/frontend/verify-ui.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `flatten` | function | 62 |
| 2 | `walkFiles` | function | 75 |
| 3 | `isIntentionalLatin` | function | 87 |
| 4 | `report` | function | 95 |
| 5 | `checkKhmerQuality` | function | 101 |
| 6 | `checkPortalDarkModeContracts` | function | 125 |
| 7 | `checkPortalVisibleStrings` | function | 147 |
| 8 | `checkFormControlLabels` | function | 169 |
| 9 | `checkVerificationWiring` | function | 189 |
| 10 | `printAuditSummary` | function | 202 |
| 11 | `main` | function | 220 |

### 3.421 `ops/scripts/lib/fs-utils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toPosix` | function | 26 |
| 2 | `resolveProjectRoot` | function | 34 |
| 3 | `relFrom` | function | 54 |
| 4 | `readUtf8` | function | 66 |
| 5 | `readJson` | function | 80 |
| 6 | `readUtf8Async` | function | 93 |
| 7 | `readJsonAsync` | function | 107 |
| 8 | `lineCount` | function | 119 |
| 9 | `pathExists` | function | 128 |
| 10 | `mapLimit` | function | 145 |
| 11 | `worker` | function | 148 |
| 12 | `shouldSkipDirectory` | function | 168 |
| 13 | `walkFilesRecursive` | function | 177 |
| 14 | `collectFilesAndFolders` | function | 210 |
| 15 | `collectRootFiles` | function | 245 |
| 16 | `isProbablyText` | function | 268 |

### 3.422 `ops/scripts/lib/report-utils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `markdownTable` | function | 14 |
| 2 | `stableDigest` | function | 26 |
| 3 | `summarizeReportValue` | function | 34 |
| 4 | `outputTail` | function | 53 |
| 5 | `formatBytes` | function | 64 |

### 3.423 `ops/scripts/runtime/audits/action-history-undo-redo-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 62 |
| 2 | `request` | function | 66 |
| 3 | `runCleanupCommand` | function | 91 |
| 4 | `cleanupActionHistoryData` | function | 108 |
| 5 | `main` | function | 141 |

### 3.424 `ops/scripts/runtime/audits/audit-auth.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSetCookieHeaders` | function | 63 |
| 2 | `extractSessionCookie` | function | 72 |
| 3 | `buildBrowserStorageState` | export function | 82 |
| 4 | `loginWithFetch` | export function | 90 |
| 5 | `applySessionToPlaywrightContext` | export function | 155 |
| 6 | `hydratePlaywrightPage` | export function | 181 |

### 3.425 `ops/scripts/runtime/audits/audit-manifest.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getRouteManifest` | export function | 249 |
| 2 | `resolveAuditRoutes` | export function | 256 |
| 3 | `getAuditProfiles` | export function | 297 |

### 3.426 `ops/scripts/runtime/audits/audit-report-html.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `escapeHtml` | function | 98 |
| 2 | `formatMs` | function | 107 |
| 3 | `formatCls` | function | 113 |
| 4 | `formatCount` | function | 119 |
| 5 | `toRelativeLink` | function | 124 |
| 6 | `inferHotPath` | function | 130 |
| 7 | `renderFindings` | function | 150 |
| 8 | `renderSummaryCards` | function | 174 |
| 9 | `writeDeepAuditHtmlReport` | export function | 189 |
| 10 | `writeFullAuditHtmlReport` | export function | 307 |
| 11 | `writeBrowserActionHtmlReport` | export function | 368 |

### 3.427 `ops/scripts/runtime/audits/deep-live-audit.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readArg` | function | 88 |
| 2 | `readArgs` | function | 95 |
| 3 | `safeName` | function | 111 |
| 4 | `escapeRegExp` | function | 115 |
| 5 | `addFinding` | function | 119 |
| 6 | `assetFileName` | function | 128 |
| 7 | `getScriptBudgetBytes` | function | 136 |
| 8 | `isFailingFinding` | function | 157 |
| 9 | `appOwnedUrl` | function | 161 |
| 10 | `externalNoise` | function | 171 |
| 11 | `isAppConsoleIssue` | function | 175 |
| 12 | `isNavigationAbort` | function | 182 |
| 13 | `writeJson` | function | 189 |
| 14 | `requestJson` | function | 193 |
| 15 | `runCommand` | function | 214 |
| 16 | `captureHealth` | function | 251 |
| 17 | `runFullApiAudit` | function | 267 |
| 18 | `primeDirectRouteProbeMap` | function | 337 |
| 19 | `loginForAudit` | function | 376 |
| 20 | `isLoginScreen` | function | 390 |
| 21 | `ensureAuditLogin` | function | 396 |
| 22 | `installPerfObservers` | function | 430 |
| 23 | `bosSelectorFor` | const arrow | 432 |
| 24 | `createBrowserHarness` | function | 534 |
| 25 | `createContext` | const arrow | 538 |
| 26 | `attachCollectors` | function | 549 |
| 27 | `resetBrowserState` | function | 637 |
| 28 | `waitForRouteReady` | function | 653 |
| 29 | `collectPerfSnapshot` | function | 680 |
| 30 | `saveScreenshot` | function | 740 |
| 31 | `performSearchInteraction` | function | 747 |
| 32 | `dismissTransientUi` | function | 782 |
| 33 | `clickNamedButton` | function | 800 |
| 34 | `clickTestIdButton` | function | 835 |
| 35 | `runRouteInteractions` | function | 880 |
| 36 | `analyzeRoute` | function | 896 |
| 37 | `auditRoute` | function | 1004 |
| 38 | `auditBrowserProfile` | function | 1207 |
| 39 | `auditRemoteReadOnly` | function | 1271 |
| 40 | `captureDockerStateAndLogs` | function | 1309 |
| 41 | `compareWithPreviousBaseline` | function | 1357 |
| 42 | `main` | function | 1405 |

### 3.428 `ops/scripts/runtime/audits/full-app-audit.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `wait` | function | 61 |
| 2 | `pushFinding` | function | 65 |
| 3 | `assert` | function | 74 |
| 4 | `isJsonResponse` | function | 78 |
| 5 | `fetchWithTimeout` | function | 82 |
| 6 | `request` | function | 92 |
| 7 | `recordApi` | function | 138 |
| 8 | `login` | function | 156 |
| 9 | `captureHealth` | function | 169 |
| 10 | `auditHtmlRoutes` | function | 183 |
| 11 | `auditReadEndpoints` | function | 210 |
| 12 | `getActiveBranches` | function | 244 |
| 13 | `runFefoWriteFlow` | function | 253 |
| 14 | `runImportFlow` | function | 408 |
| 15 | `tinyPngBytes` | function | 458 |
| 16 | `runFilesFlow` | function | 465 |
| 17 | `runBackupFlow` | function | 480 |
| 18 | `pollSystemJob` | function | 517 |
| 19 | `cleanupAuditData` | function | 535 |
| 20 | `auditRemotePublic` | function | 566 |
| 21 | `writeSummary` | function | 601 |
| 22 | `main` | function | 612 |

### 3.429 `ops/scripts/runtime/browser-action-smoke.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readArg` | function | 131 |
| 2 | `readArgs` | function | 138 |
| 3 | `safeName` | function | 154 |
| 4 | `escapeRegExp` | function | 158 |
| 5 | `addFinding` | function | 162 |
| 6 | `isExternalConsoleNoise` | function | 171 |
| 7 | `isAppConsoleIssue` | function | 175 |
| 8 | `requestJson` | function | 181 |
| 9 | `captureHealth` | function | 193 |
| 10 | `buildContextOptions` | function | 206 |
| 11 | `attachConsoleCapture` | function | 215 |
| 12 | `saveScreenshot` | function | 236 |
| 13 | `waitForRouteReady` | function | 243 |
| 14 | `getActiveRouteRoot` | function | 264 |
| 15 | `dismissTransientUi` | function | 268 |
| 16 | `clickWithFallback` | function | 286 |
| 17 | `countVisibleDialogs` | function | 296 |
| 18 | `countVisibleNamedButtons` | function | 312 |
| 19 | `countVisiblePortalLayers` | function | 324 |
| 20 | `clickVisibleButton` | function | 337 |
| 21 | `findButtonInLocator` | function | 356 |
| 22 | `openMobileMoreDrawer` | function | 377 |
| 23 | `navigateViaUi` | function | 386 |
| 24 | `verifyExpectation` | function | 501 |
| 25 | `clickNamedButton` | function | 568 |
| 26 | `clickTestIdButton` | function | 620 |
| 27 | `performSearchInteraction` | function | 670 |
| 28 | `findSearchInput` | function | 673 |
| 29 | `runRouteInteractions` | function | 741 |
| 30 | `bootstrapProfile` | function | 755 |
| 31 | `runProfile` | function | 772 |
| 32 | `main` | function | 840 |

### 3.430 `ops/scripts/runtime/cloudflare/rotate-cloudflare-tunnel-token.ts`

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

### 3.431 `ops/scripts/runtime/cloudflare/update-cloudflare-tunnel-origin.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readEnvFile` | function | 10 |
| 2 | `parseArgs` | function | 25 |
| 3 | `readToken` | function | 36 |
| 4 | `ensureIngress` | function | 42 |
| 5 | `main` | function | 58 |
| 6 | `requestJson` | function | 103 |

### 3.432 `ops/scripts/runtime/cloudflare/verify-cloudflare-automation.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseArgs` | function | 11 |
| 2 | `readToken` | function | 21 |
| 3 | `cleanToken` | const arrow | 22 |
| 4 | `readAllowedEmails` | function | 28 |
| 5 | `normalizeAdminAccessMode` | function | 36 |
| 6 | `requestJson` | function | 42 |
| 7 | `summarizeFailure` | function | 77 |
| 8 | `cloudflareErrors` | function | 84 |
| 9 | `assertSuccess` | function | 90 |
| 10 | `buildAccessPolicies` | function | 97 |
| 11 | `upsertAccessApp` | function | 118 |
| 12 | `getEntrypointRuleset` | function | 143 |
| 13 | `upsertEntrypointRuleset` | function | 149 |
| 14 | `tryApplyRuleset` | function | 168 |
| 15 | `applyCloudflareAutomation` | function | 179 |
| 16 | `main` | function | 223 |

### 3.433 `ops/scripts/runtime/cloudflare/verify-r2-object-store.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadEnvFile` | function | 18 |
| 2 | `readConfig` | function | 36 |
| 3 | `bodyToString` | function | 59 |
| 4 | `isMissingObjectError` | function | 67 |
| 5 | `isAuthLikeError` | function | 73 |
| 6 | `canUseApiFallback` | function | 82 |
| 7 | `verifyRuntimeObjectStoreFallback` | function | 86 |
| 8 | `main` | function | 94 |

### 3.434 `ops/scripts/runtime/live-checks/live-check-utils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fetchJsonResponse` | function | 48 |
| 2 | `readJson` | export function | 64 |
| 3 | `readJsonStatus` | export function | 69 |
| 4 | `isIgnoredConsole` | export function | 75 |
| 5 | `attachConsoleCollector` | export function | 79 |
| 6 | `latestObservedStatus` | export function | 96 |
| 7 | `waitForRead` | export function | 101 |
| 8 | `closeTopModal` | export function | 118 |

### 3.435 `ops/scripts/runtime/live-checks/phase84-branches-actions-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 28 |
| 2 | `main` | function | 36 |

### 3.436 `ops/scripts/runtime/live-checks/phase84-contacts-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 28 |
| 2 | `main` | function | 36 |

### 3.437 `ops/scripts/runtime/live-checks/phase84-files-providers-actions-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 29 |
| 2 | `main` | function | 36 |

### 3.438 `ops/scripts/runtime/live-checks/phase84-inventory-actions-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 29 |
| 2 | `openFirstProductDetail` | function | 37 |
| 3 | `main` | function | 46 |

### 3.439 `ops/scripts/runtime/live-checks/phase84-live-suite.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseArgs` | function | 78 |
| 2 | `assertInsideWorkspace` | function | 101 |
| 3 | `tail` | function | 107 |
| 4 | `readJsonIfExists` | function | 111 |
| 5 | `latestReportPathForPrefix` | function | 116 |
| 6 | `relativePath` | function | 134 |
| 7 | `summarizeReport` | function | 139 |
| 8 | `readStepReport` | function | 172 |
| 9 | `runNodeStep` | function | 182 |
| 10 | `skippedStep` | function | 202 |
| 11 | `runSuite` | function | 212 |

### 3.440 `ops/scripts/runtime/live-checks/phase84-product-brands-actions-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 33 |
| 2 | `verifiedContextGet` | function | 39 |
| 3 | `main` | function | 46 |

### 3.441 `ops/scripts/runtime/live-checks/phase84-product-categories-actions-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 28 |
| 2 | `main` | function | 35 |

### 3.442 `ops/scripts/runtime/live-checks/phase84-product-page-actions-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 30 |
| 2 | `openFirstActionMenu` | function | 37 |
| 3 | `main` | function | 46 |

### 3.443 `ops/scripts/runtime/live-checks/phase84-product-scanning-actions-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 29 |
| 2 | `main` | function | 36 |

### 3.444 `ops/scripts/runtime/live-checks/phase84-product-stock-actions-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 28 |
| 2 | `main` | function | 36 |

### 3.445 `ops/scripts/runtime/live-checks/phase84-product-units-actions-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 28 |
| 2 | `main` | function | 35 |

### 3.446 `ops/scripts/runtime/live-checks/phase84-product-variant-actions-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 29 |
| 2 | `openFirstVariantModal` | function | 36 |
| 3 | `main` | function | 53 |

### 3.447 `ops/scripts/runtime/live-checks/phase84-public-portal-cloudflare-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 57 |
| 2 | `isRelevantConsole` | function | 61 |
| 3 | `isCloudflareScriptMonitorReportOnlyCsp` | function | 65 |
| 4 | `endpointStatus` | function | 70 |
| 5 | `main` | function | 74 |

### 3.448 `ops/scripts/runtime/live-checks/phase84-sales-actions-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 33 |
| 2 | `main` | function | 40 |

### 3.449 `ops/scripts/runtime/live-checks/phase84-ui-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 29 |
| 2 | `main` | function | 36 |

### 3.450 `ops/scripts/runtime/live-checks/phase84-users-actions-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 32 |
| 2 | `main` | function | 40 |

### 3.451 `ops/scripts/runtime/smoke/check-public-url.ts`

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

### 3.452 `ops/scripts/runtime/smoke/check-route-contract.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fail` | function | 35 |
| 2 | `checkRoute` | function | 40 |
| 3 | `main` | function | 67 |

### 3.453 `ops/scripts/runtime/smoke/live-smoke.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 15 |
| 2 | `request` | function | 19 |
| 3 | `login` | function | 48 |
| 4 | `cleanupLiveSmokeData` | function | 61 |
| 5 | `main` | function | 86 |
| 6 | `record` | const arrow | 91 |

### 3.454 `ops/scripts/runtime/smoke/post-start-diagnostics.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseArgs` | function | 38 |
| 2 | `readResponse` | function | 64 |
| 3 | `hasBuildInfo` | function | 97 |
| 4 | `asRecord` | function | 106 |
| 5 | `mkdirForFile` | function | 110 |
| 6 | `writeReport` | function | 115 |
| 7 | `main` | function | 121 |

### 3.455 `ops/scripts/runtime/storage/cleanup-integrity-backlog.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseArgs` | function | 8 |
| 2 | `assertInsideWorkspace` | function | 30 |
| 3 | `generatedTextMatch` | function | 36 |
| 4 | `buildTempTablesSql` | function | 43 |
| 5 | `buildCountsSql` | function | 144 |
| 6 | `buildDeleteSql` | function | 162 |
| 7 | `buildSql` | function | 191 |
| 8 | `runPsql` | function | 200 |

### 3.456 `ops/scripts/runtime/storage/cleanup-test-data.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseArgs` | function | 8 |
| 2 | `assertInsideWorkspace` | function | 38 |
| 3 | `sqlString` | function | 44 |
| 4 | `likeEscape` | function | 48 |
| 5 | `productSeedWhere` | function | 52 |
| 6 | `textQaWhere` | function | 72 |
| 7 | `lookupNameWhere` | function | 84 |
| 8 | `buildTempTablesSql` | function | 96 |
| 9 | `textMatch` | const arrow | 97 |
| 10 | `lookupNameMatch` | const arrow | 98 |
| 11 | `buildCountsSelectSql` | function | 218 |
| 12 | `buildDeleteSql` | function | 242 |
| 13 | `buildSql` | function | 303 |
| 14 | `runPsql` | function | 307 |
| 15 | `pathIsInside` | function | 319 |
| 16 | `measurePathBytes` | function | 324 |
| 17 | `walkFiles` | function | 335 |
| 18 | `fileMatchesGeneratedImport` | function | 344 |
| 19 | `findGeneratedImportDirectories` | function | 350 |
| 20 | `cleanupAuditImportFiles` | function | 376 |
| 21 | `countMatchedRows` | function | 399 |

### 3.457 `ops/scripts/runtime/storage/dataset-readiness.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseArgs` | function | 18 |
| 2 | `assertInsideWorkspace` | function | 39 |
| 3 | `runPsql` | function | 45 |
| 4 | `buildCountsSql` | function | 56 |
| 5 | `summarizeDataset` | function | 74 |

### 3.458 `ops/scripts/runtime/storage/post-live-hygiene.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseArgs` | function | 11 |
| 2 | `assertInsideWorkspace` | function | 26 |
| 3 | `runCheck` | function | 32 |
| 4 | `appendBounded` | const arrow | 42 |
| 5 | `readJsonReport` | function | 76 |
| 6 | `sumMatchedCounts` | function | 82 |
| 7 | `withReportCheck` | function | 87 |
| 8 | `nodeCheck` | function | 110 |
| 9 | `buildCheckPlan` | function | 114 |
| 10 | `runChecks` | function | 184 |
| 11 | `main` | function | 192 |

### 3.459 `ops/scripts/runtime/storage/prune-storage.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readJsonFile` | function | 12 |
| 2 | `numberFromPolicy` | function | 20 |
| 3 | `parseArgs` | function | 25 |
| 4 | `runDockerCommand` | function | 101 |
| 5 | `pruneDockerSafe` | function | 109 |
| 6 | `loadEnvFile` | function | 156 |
| 7 | `loadRuntimeEnv` | function | 174 |
| 8 | `assertInsideWorkspace` | function | 183 |
| 9 | `directoryBytes` | function | 192 |
| 10 | `pathBytes` | function | 218 |
| 11 | `pruneDirectoryChildren` | function | 227 |
| 12 | `pruneDirectoryEntries` | function | 231 |
| 13 | `collectLogFiles` | function | 268 |
| 14 | `compactLogFile` | function | 296 |
| 15 | `compactRuntimeLogs` | function | 324 |
| 16 | `findBackupRoots` | function | 357 |
| 17 | `main` | function | 371 |

### 3.460 `ops/scripts/runtime/storage/restore-candidates.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseArgs` | function | 48 |
| 2 | `assertInsideWorkspace` | function | 67 |
| 3 | `readJson` | function | 73 |
| 4 | `countSqlCopyRows` | function | 85 |
| 5 | `summarizeCounts` | function | 106 |
| 6 | `inspectBackupPackage` | function | 116 |
| 7 | `findBackupPackages` | function | 136 |
| 8 | `chooseRecommendation` | function | 150 |

### 3.461 `ops/scripts/runtime/storage/restore-rehearsal.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseArgs` | function | 36 |
| 2 | `assertInsideWorkspace` | function | 60 |
| 3 | `readJson` | function | 66 |
| 4 | `resolveRecommendedBackupPath` | function | 74 |
| 5 | `countSqlCopyRows` | function | 84 |
| 6 | `runDocker` | function | 104 |
| 7 | `runPsql` | function | 116 |
| 8 | `createTempDatabaseName` | function | 123 |
| 9 | `quoteIdentifier` | function | 127 |
| 10 | `createDatabase` | function | 131 |
| 11 | `dropDatabase` | function | 135 |
| 12 | `restoreSql` | function | 144 |
| 13 | `countRestoredTables` | function | 152 |
| 14 | `compareCounts` | function | 159 |

### 3.462 `ops/scripts/verification/verify-backup-reliability.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `read` | function | 11 |
| 2 | `lineFor` | function | 15 |
| 3 | `requireText` | function | 21 |
| 4 | `forbidText` | function | 25 |
| 5 | `checkNeedles` | function | 29 |
| 6 | `main` | function | 36 |

### 3.463 `ops/scripts/verification/verify-docker-release.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `read` | function | 60 |
| 2 | `rel` | function | 64 |
| 3 | `requireFile` | function | 68 |
| 4 | `requireToken` | function | 72 |
| 5 | `buildCloudflareRuntimeCoverage` | function | 76 |
| 6 | `assertCloudflareRuntimeCoverage` | function | 196 |
| 7 | `walk` | function | 198 |
| 8 | `buildTestDataCleanupCoverage` | function | 211 |
| 9 | `assertBooleanCoverage` | function | 312 |
| 10 | `walk` | function | 314 |
| 11 | `main` | function | 325 |

### 3.464 `ops/scripts/verification/verify-hardening-policy.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeRelativePath` | function | 13 |
| 2 | `readWithLocalImports` | function | 17 |
| 3 | `listTrackedOrPendingFiles` | function | 31 |
| 4 | `lineFor` | function | 38 |
| 5 | `assertContains` | function | 44 |
| 6 | `assertNotContains` | function | 50 |
| 7 | `assertNoApiCachingRegression` | function | 56 |
| 8 | `assertFullAutomationIncludesPolicy` | function | 77 |
| 9 | `main` | function | 93 |

### 3.465 `ops/scripts/verification/verify-runtime-deps.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assertTrackedFile` | function | 37 |
| 2 | `rel` | function | 43 |
| 3 | `requireToken` | function | 47 |
| 4 | `hasLockDependency` | function | 53 |
| 5 | `readIncludes` | function | 59 |
| 6 | `packageLockVersion` | function | 63 |
| 7 | `buildVersionConsistency` | function | 67 |
| 8 | `assertVersionConsistency` | function | 93 |
| 9 | `assertRuntimeVersionGuardWiring` | function | 99 |
| 10 | `assertBuildManifestShapeWhenPresent` | function | 167 |
| 11 | `buildLocalVerificationCoverage` | function | 184 |
| 12 | `assertCoverageComplete` | function | 232 |
| 13 | `main` | function | 245 |

### 3.466 `ops/scripts/verification/verify-scale-services.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ensureDir` | function | 19 |
| 2 | `run` | function | 23 |
| 3 | `firstExisting` | function | 41 |
| 4 | `whereDocker` | function | 45 |
| 5 | `resolveDocker` | function | 58 |
| 6 | `checkSecretIgnoreRules` | function | 68 |
| 7 | `trackedLicenses` | const arrow | 69 |
| 8 | `main` | function | 95 |

### 3.467 `ops/scripts/verification/verify-secret-hygiene.ts`

- No top-level named symbols detected.

