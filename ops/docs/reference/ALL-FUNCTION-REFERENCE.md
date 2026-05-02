# All Function Reference (Project First-Party Code)

Auto-generated function/class symbol commentary for all first-party code files (frontend, backend, root scripts/config code).

## 1. Coverage Summary

Code files scanned: **274**

## 2. Symbol Count by File

| No. | File | Symbols |
|---:|---|---:|
| 1 | `backend/server.js` | 15 |
| 2 | `backend/src/accessControl.js` | 18 |
| 3 | `backend/src/authOtpGuards.js` | 3 |
| 4 | `backend/src/backupSchema.js` | 3 |
| 5 | `backend/src/config/index.js` | 23 |
| 6 | `backend/src/conflictControl.js` | 5 |
| 7 | `backend/src/contactOptions.js` | 8 |
| 8 | `backend/src/database.js` | 17 |
| 9 | `backend/src/dataPath/index.js` | 9 |
| 10 | `backend/src/fileAssets.js` | 24 |
| 11 | `backend/src/helpers.js` | 18 |
| 12 | `backend/src/idempotency.js` | 1 |
| 13 | `backend/src/importCsv.js` | 12 |
| 14 | `backend/src/importParsing.js` | 6 |
| 15 | `backend/src/middleware.js` | 21 |
| 16 | `backend/src/money.js` | 3 |
| 17 | `backend/src/netSecurity.js` | 7 |
| 18 | `backend/src/organizationContext/index.js` | 14 |
| 19 | `backend/src/portalUtils.js` | 6 |
| 20 | `backend/src/productDiscounts.js` | 9 |
| 21 | `backend/src/productImportPolicies.js` | 8 |
| 22 | `backend/src/requestContext.js` | 5 |
| 23 | `backend/src/routes/actionHistory.js` | 10 |
| 24 | `backend/src/routes/ai.js` | 2 |
| 25 | `backend/src/routes/auth.js` | 26 |
| 26 | `backend/src/routes/branches.js` | 2 |
| 27 | `backend/src/routes/catalog.js` | 0 |
| 28 | `backend/src/routes/categories.js` | 2 |
| 29 | `backend/src/routes/contacts.js` | 15 |
| 30 | `backend/src/routes/customTables.js` | 8 |
| 31 | `backend/src/routes/files.js` | 3 |
| 32 | `backend/src/routes/importJobs.js` | 11 |
| 33 | `backend/src/routes/inventory.js` | 4 |
| 34 | `backend/src/routes/notifications.js` | 10 |
| 35 | `backend/src/routes/organizations.js` | 0 |
| 36 | `backend/src/routes/portal.js` | 30 |
| 37 | `backend/src/routes/products.js` | 34 |
| 38 | `backend/src/routes/returns.js` | 7 |
| 39 | `backend/src/routes/runtime.js` | 1 |
| 40 | `backend/src/routes/sales.js` | 14 |
| 41 | `backend/src/routes/settings.js` | 5 |
| 42 | `backend/src/routes/system/index.js` | 39 |
| 43 | `backend/src/routes/units.js` | 3 |
| 44 | `backend/src/routes/users.js` | 21 |
| 45 | `backend/src/runtimeCache.js` | 11 |
| 46 | `backend/src/runtimeState/index.js` | 6 |
| 47 | `backend/src/security.js` | 13 |
| 48 | `backend/src/serverUtils.js` | 25 |
| 49 | `backend/src/services/aiGateway.js` | 12 |
| 50 | `backend/src/services/firebaseAuth.js` | 22 |
| 51 | `backend/src/services/googleDriveSync/index.js` | 49 |
| 52 | `backend/src/services/importJobs.js` | 116 |
| 53 | `backend/src/services/mediaQueue.js` | 10 |
| 54 | `backend/src/services/portalAi.js` | 29 |
| 55 | `backend/src/services/supabaseAuth.js` | 37 |
| 56 | `backend/src/services/verification.js` | 21 |
| 57 | `backend/src/sessionAuth.js` | 8 |
| 58 | `backend/src/settingsSnapshot.js` | 7 |
| 59 | `backend/src/storage/organizationFolders.js` | 5 |
| 60 | `backend/src/systemFsWorker.js` | 7 |
| 61 | `backend/src/uploadReferenceCleanup.js` | 2 |
| 62 | `backend/src/uploadSecurity.js` | 7 |
| 63 | `backend/src/websocket.js` | 1 |
| 64 | `backend/src/workers/importWorker.js` | 2 |
| 65 | `backend/src/workers/mediaWorker.js` | 2 |
| 66 | `backend/src/workers/migrationWorker.js` | 24 |
| 67 | `backend/test/accessControl.test.js` | 2 |
| 68 | `backend/test/authOtpGuards.test.js` | 1 |
| 69 | `backend/test/authSecurityFlow.test.js` | 8 |
| 70 | `backend/test/backupRoundtrip.test.js` | 12 |
| 71 | `backend/test/backupSchema.test.js` | 1 |
| 72 | `backend/test/configOrganizationRuntime.test.js` | 2 |
| 73 | `backend/test/contactOptions.test.js` | 1 |
| 74 | `backend/test/databaseRuntime.test.js` | 1 |
| 75 | `backend/test/dataPath.test.js` | 2 |
| 76 | `backend/test/fileRouteSecurityFlow.test.js` | 9 |
| 77 | `backend/test/idempotency.test.js` | 1 |
| 78 | `backend/test/importCsv.test.js` | 2 |
| 79 | `backend/test/importJobStateMachine.test.js` | 4 |
| 80 | `backend/test/importScaleSmoke.test.js` | 3 |
| 81 | `backend/test/netSecurity.test.js` | 1 |
| 82 | `backend/test/portalUtils.test.js` | 1 |
| 83 | `backend/test/productImportPolicies.test.js` | 1 |
| 84 | `backend/test/runtimeCache.test.js` | 2 |
| 85 | `backend/test/serverUtils.test.js` | 2 |
| 86 | `backend/test/stockConsistency.test.js` | 26 |
| 87 | `backend/test/systemRouteSecurity.test.js` | 9 |
| 88 | `backend/test/uploadSecurity.test.js` | 1 |
| 89 | `frontend/postcss.config.mjs` | 0 |
| 90 | `frontend/public/runtime-noise-guard.js` | 6 |
| 91 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.js` | 0 |
| 92 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.worker.js` | 0 |
| 93 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd-threads.js` | 0 |
| 94 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd.js` | 0 |
| 95 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core.js` | 0 |
| 96 | `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js` | 0 |
| 97 | `frontend/public/sw.js` | 3 |
| 98 | `frontend/public/theme-bootstrap.js` | 10 |
| 99 | `frontend/src/api/http.js` | 49 |
| 100 | `frontend/src/api/localDb.js` | 10 |
| 101 | `frontend/src/api/methods.js` | 168 |
| 102 | `frontend/src/api/websocket.js` | 7 |
| 103 | `frontend/src/App.jsx` | 38 |
| 104 | `frontend/src/app/appShellUtils.mjs` | 4 |
| 105 | `frontend/src/app/publicErrorRecovery.mjs` | 3 |
| 106 | `frontend/src/AppContext.jsx` | 40 |
| 107 | `frontend/src/components/auth/Login.jsx` | 21 |
| 108 | `frontend/src/components/branches/Branches.jsx` | 9 |
| 109 | `frontend/src/components/branches/BranchForm.jsx` | 3 |
| 110 | `frontend/src/components/branches/TransferModal.jsx` | 3 |
| 111 | `frontend/src/components/catalog/CatalogPage.jsx` | 80 |
| 112 | `frontend/src/components/catalog/CatalogProductsSection.jsx` | 4 |
| 113 | `frontend/src/components/catalog/CatalogSecondaryTabs.jsx` | 5 |
| 114 | `frontend/src/components/catalog/catalogUi.jsx` | 4 |
| 115 | `frontend/src/components/catalog/portalCatalogDisplay.mjs` | 8 |
| 116 | `frontend/src/components/catalog/portalEditorUtils.mjs` | 8 |
| 117 | `frontend/src/components/catalog/portalTranslateController.mjs` | 17 |
| 118 | `frontend/src/components/contacts/contactOptionUtils.js` | 9 |
| 119 | `frontend/src/components/contacts/Contacts.jsx` | 8 |
| 120 | `frontend/src/components/contacts/CustomersTab.jsx` | 21 |
| 121 | `frontend/src/components/contacts/DeliveryTab.jsx` | 23 |
| 122 | `frontend/src/components/contacts/shared.jsx` | 15 |
| 123 | `frontend/src/components/contacts/SuppliersTab.jsx` | 15 |
| 124 | `frontend/src/components/custom-tables/CustomTables.jsx` | 11 |
| 125 | `frontend/src/components/dashboard/charts/BarChart.jsx` | 2 |
| 126 | `frontend/src/components/dashboard/charts/DonutChart.jsx` | 1 |
| 127 | `frontend/src/components/dashboard/charts/index.js` | 0 |
| 128 | `frontend/src/components/dashboard/charts/LineChart.jsx` | 4 |
| 129 | `frontend/src/components/dashboard/charts/NoData.jsx` | 1 |
| 130 | `frontend/src/components/dashboard/Dashboard.jsx` | 9 |
| 131 | `frontend/src/components/dashboard/MiniStat.jsx` | 1 |
| 132 | `frontend/src/components/files/FilePickerModal.jsx` | 6 |
| 133 | `frontend/src/components/files/FilesPage.jsx` | 15 |
| 134 | `frontend/src/components/inventory/DualMoney.jsx` | 1 |
| 135 | `frontend/src/components/inventory/Inventory.jsx` | 12 |
| 136 | `frontend/src/components/inventory/InventoryImportModal.jsx` | 6 |
| 137 | `frontend/src/components/inventory/movementGroups.js` | 6 |
| 138 | `frontend/src/components/inventory/ProductDetailModal.jsx` | 2 |
| 139 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | 8 |
| 140 | `frontend/src/components/navigation/Sidebar.jsx` | 6 |
| 141 | `frontend/src/components/pos/CartItem.jsx` | 1 |
| 142 | `frontend/src/components/pos/FilterPanel.jsx` | 5 |
| 143 | `frontend/src/components/pos/POS.jsx` | 21 |
| 144 | `frontend/src/components/pos/posCore.mjs` | 8 |
| 145 | `frontend/src/components/pos/ProductImage.jsx` | 1 |
| 146 | `frontend/src/components/pos/QuickAddModal.jsx` | 2 |
| 147 | `frontend/src/components/products/barcodeImageScanner.mjs` | 4 |
| 148 | `frontend/src/components/products/BarcodeScannerModal.jsx` | 5 |
| 149 | `frontend/src/components/products/barcodeScannerState.mjs` | 1 |
| 150 | `frontend/src/components/products/BranchStockAdjuster.jsx` | 4 |
| 151 | `frontend/src/components/products/BulkAddStockModal.jsx` | 2 |
| 152 | `frontend/src/components/products/BulkImportModal.jsx` | 25 |
| 153 | `frontend/src/components/products/HeaderActions.jsx` | 2 |
| 154 | `frontend/src/components/products/ManageBrandsModal.jsx` | 8 |
| 155 | `frontend/src/components/products/ManageCategoriesModal.jsx` | 4 |
| 156 | `frontend/src/components/products/ManageUnitsModal.jsx` | 5 |
| 157 | `frontend/src/components/products/primitives.jsx` | 9 |
| 158 | `frontend/src/components/products/ProductDetailModal.jsx` | 3 |
| 159 | `frontend/src/components/products/ProductForm.jsx` | 17 |
| 160 | `frontend/src/components/products/productHistoryHelpers.mjs` | 2 |
| 161 | `frontend/src/components/products/productImportPlanner.mjs` | 11 |
| 162 | `frontend/src/components/products/productImportWorker.mjs` | 1 |
| 163 | `frontend/src/components/products/Products.jsx` | 25 |
| 164 | `frontend/src/components/products/scanbotScanner.mjs` | 9 |
| 165 | `frontend/src/components/products/VariantFormModal.jsx` | 5 |
| 166 | `frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | 4 |
| 167 | `frontend/src/components/receipt-settings/constants.js` | 2 |
| 168 | `frontend/src/components/receipt-settings/ErrorBoundary.jsx` | 0 |
| 169 | `frontend/src/components/receipt-settings/FieldOrderManager.jsx` | 9 |
| 170 | `frontend/src/components/receipt-settings/PrintSettings.jsx` | 8 |
| 171 | `frontend/src/components/receipt-settings/ReceiptPreview.jsx` | 2 |
| 172 | `frontend/src/components/receipt-settings/ReceiptSettings.jsx` | 4 |
| 173 | `frontend/src/components/receipt-settings/template.js` | 2 |
| 174 | `frontend/src/components/receipt/Receipt.jsx` | 8 |
| 175 | `frontend/src/components/returns/EditReturnModal.jsx` | 5 |
| 176 | `frontend/src/components/returns/NewReturnModal.jsx` | 10 |
| 177 | `frontend/src/components/returns/NewSupplierReturnModal.jsx` | 6 |
| 178 | `frontend/src/components/returns/ReturnDetailModal.jsx` | 3 |
| 179 | `frontend/src/components/returns/Returns.jsx` | 8 |
| 180 | `frontend/src/components/sales/ExportModal.jsx` | 9 |
| 181 | `frontend/src/components/sales/SaleDetailModal.jsx` | 6 |
| 182 | `frontend/src/components/sales/Sales.jsx` | 10 |
| 183 | `frontend/src/components/sales/SalesImportModal.jsx` | 6 |
| 184 | `frontend/src/components/sales/StatusBadge.jsx` | 2 |
| 185 | `frontend/src/components/server/ServerPage.jsx` | 15 |
| 186 | `frontend/src/components/shared/ActionHistoryBar.jsx` | 4 |
| 187 | `frontend/src/components/shared/BackgroundImportTracker.jsx` | 15 |
| 188 | `frontend/src/components/shared/ExportMenu.jsx` | 1 |
| 189 | `frontend/src/components/shared/FilterMenu.jsx` | 2 |
| 190 | `frontend/src/components/shared/ImageGalleryLightbox.jsx` | 5 |
| 191 | `frontend/src/components/shared/Modal.jsx` | 1 |
| 192 | `frontend/src/components/shared/navigationConfig.js` | 2 |
| 193 | `frontend/src/components/shared/NotificationCenter.jsx` | 7 |
| 194 | `frontend/src/components/shared/pageActivity.js` | 1 |
| 195 | `frontend/src/components/shared/PageHeader.jsx` | 1 |
| 196 | `frontend/src/components/shared/PageHelpButton.jsx` | 1 |
| 197 | `frontend/src/components/shared/pageHelpContent.js` | 1 |
| 198 | `frontend/src/components/shared/PaginationControls.jsx` | 3 |
| 199 | `frontend/src/components/shared/PortalMenu.jsx` | 6 |
| 200 | `frontend/src/components/shared/QuickPreferenceToggles.jsx` | 3 |
| 201 | `frontend/src/components/shared/WriteConflictModal.jsx` | 5 |
| 202 | `frontend/src/components/users/PermissionEditor.jsx` | 4 |
| 203 | `frontend/src/components/users/UserDetailSheet.jsx` | 3 |
| 204 | `frontend/src/components/users/UserProfileModal.jsx` | 21 |
| 205 | `frontend/src/components/users/Users.jsx` | 15 |
| 206 | `frontend/src/components/utils-settings/AuditLog.jsx` | 12 |
| 207 | `frontend/src/components/utils-settings/Backup.jsx` | 41 |
| 208 | `frontend/src/components/utils-settings/FontFamilyPicker.jsx` | 1 |
| 209 | `frontend/src/components/utils-settings/index.js` | 0 |
| 210 | `frontend/src/components/utils-settings/OtpModal.jsx` | 2 |
| 211 | `frontend/src/components/utils-settings/ResetData.jsx` | 8 |
| 212 | `frontend/src/components/utils-settings/Settings.jsx` | 20 |
| 213 | `frontend/src/constants.js` | 3 |
| 214 | `frontend/src/index.jsx` | 9 |
| 215 | `frontend/src/platform/runtime/clientRuntime.js` | 15 |
| 216 | `frontend/src/platform/storage/storagePolicy.mjs` | 3 |
| 217 | `frontend/src/runtime/runtimeErrorClassifier.mjs` | 11 |
| 218 | `frontend/src/utils/actionHistory.mjs` | 2 |
| 219 | `frontend/src/utils/appRefresh.js` | 1 |
| 220 | `frontend/src/utils/color.js` | 3 |
| 221 | `frontend/src/utils/csv.js` | 11 |
| 222 | `frontend/src/utils/csvImport.js` | 15 |
| 223 | `frontend/src/utils/dateHelpers.js` | 2 |
| 224 | `frontend/src/utils/deviceInfo.js` | 2 |
| 225 | `frontend/src/utils/exportPackage.js` | 2 |
| 226 | `frontend/src/utils/exportReports.jsx` | 9 |
| 227 | `frontend/src/utils/favicon.js` | 3 |
| 228 | `frontend/src/utils/formatters.js` | 4 |
| 229 | `frontend/src/utils/groupedRecords.mjs` | 14 |
| 230 | `frontend/src/utils/historyHelpers.mjs` | 3 |
| 231 | `frontend/src/utils/index.js` | 0 |
| 232 | `frontend/src/utils/loaders.mjs` | 8 |
| 233 | `frontend/src/utils/pricing.js` | 8 |
| 234 | `frontend/src/utils/printReceipt.js` | 34 |
| 235 | `frontend/src/utils/productGrouping.mjs` | 12 |
| 236 | `frontend/src/web-api.js` | 1 |
| 237 | `frontend/tailwind.config.mjs` | 0 |
| 238 | `frontend/tests/apiHttp.test.mjs` | 3 |
| 239 | `frontend/tests/appShellUtils.test.mjs` | 1 |
| 240 | `frontend/tests/barcodeImageScanner.test.mjs` | 1 |
| 241 | `frontend/tests/barcodeScannerState.test.mjs` | 1 |
| 242 | `frontend/tests/csvImport.test.mjs` | 1 |
| 243 | `frontend/tests/exportPackages.test.mjs` | 1 |
| 244 | `frontend/tests/groupedRecords.test.mjs` | 1 |
| 245 | `frontend/tests/historyHelpers.test.mjs` | 1 |
| 246 | `frontend/tests/loaders.test.mjs` | 1 |
| 247 | `frontend/tests/portalCatalogDisplay.test.mjs` | 3 |
| 248 | `frontend/tests/portalEditorUtils.test.mjs` | 1 |
| 249 | `frontend/tests/portalTranslateController.test.mjs` | 2 |
| 250 | `frontend/tests/posCore.test.mjs` | 1 |
| 251 | `frontend/tests/pricingContacts.test.mjs` | 1 |
| 252 | `frontend/tests/productGrouping.test.mjs` | 1 |
| 253 | `frontend/tests/productHistoryHelpers.test.mjs` | 1 |
| 254 | `frontend/tests/productImportPlanner.test.mjs` | 1 |
| 255 | `frontend/tests/publicErrorRecovery.test.mjs` | 1 |
| 256 | `frontend/tests/receiptTemplate.test.mjs` | 1 |
| 257 | `frontend/tests/runtimeErrorClassifier.test.mjs` | 0 |
| 258 | `frontend/tests/scanbotScanner.test.mjs` | 2 |
| 259 | `frontend/tests/storagePolicy.test.mjs` | 1 |
| 260 | `frontend/vite.config.mjs` | 2 |
| 261 | `ops/scripts/backend/verify-data-integrity.js` | 10 |
| 262 | `ops/scripts/frontend/verify-i18n.js` | 6 |
| 263 | `ops/scripts/frontend/verify-performance.js` | 4 |
| 264 | `ops/scripts/frontend/verify-ui.js` | 13 |
| 265 | `ops/scripts/generate-doc-reference.js` | 18 |
| 266 | `ops/scripts/generate-full-project-docs.js` | 26 |
| 267 | `ops/scripts/lib/fs-utils.js` | 8 |
| 268 | `ops/scripts/performance-scan.js` | 3 |
| 269 | `ops/scripts/runtime/check-public-url.mjs` | 11 |
| 270 | `ops/scripts/runtime/rotate-cloudflare-tunnel-token.mjs` | 16 |
| 271 | `ops/scripts/runtime/update-cloudflare-tunnel-origin.mjs` | 6 |
| 272 | `ops/scripts/verify-docker-release.js` | 3 |
| 273 | `ops/scripts/verify-runtime-deps.js` | 4 |
| 274 | `ops/scripts/verify-scale-services.js` | 8 |

## 3. Detailed Function Commentary

### 3.1 `backend/server.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadCompressionMiddleware` | function | 67 |
| 2 | `applySecurityHeaders` | function | 76 |
| 3 | `applyRequestPolicy` | function | 82 |
| 4 | `applyCoreMiddleware` | function | 92 |
| 5 | `mountStaticAssets` | function | 106 |
| 6 | `mountHealthRoute` | function | 125 |
| 7 | `mountApiRoutes` | function | 137 |
| 8 | `mountTransfersAlias` | function | 168 |
| 9 | `mountSpaFallback` | function | 183 |
| 10 | `mountErrorHandler` | function | 202 |
| 11 | `getStartupBanner` | function | 216 |
| 12 | `closeDatabase` | function | 237 |
| 13 | `startDatabaseMaintenanceTimer` | function | 247 |
| 14 | `registerShutdownHandlers` | function | 255 |
| 15 | `bootstrapServer` | function | 273 |

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

### 3.3 `backend/src/authOtpGuards.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeUserId` | function | 5 |
| 2 | `canManageOtpTarget` | function | 10 |
| 3 | `requiresSelfOtpDisablePassword` | function | 20 |

### 3.4 `backend/src/backupSchema.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `countRowsByTable` | function | 71 |
| 2 | `countCustomTableRows` | function | 79 |
| 3 | `buildBackupSummary` | function | 85 |

### 3.5 `backend/src/config/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isDefaultDataMarker` | function | 49 |
| 2 | `resolveStoredDataDir` | function | 54 |
| 3 | `normalizeSelectedDataDir` | function | 61 |
| 4 | `readDataLocation` | function | 73 |
| 5 | `writeDataLocation` | function | 84 |
| 6 | `pathExists` | function | 100 |
| 7 | `normalizeOrganizationSeed` | function | 104 |
| 8 | `readPrimaryOrganizationSeed` | function | 111 |
| 9 | `ensureDirectory` | function | 143 |
| 10 | `copyTree` | function | 147 |
| 11 | `normalizePathForCompare` | function | 162 |
| 12 | `isSamePath` | function | 166 |
| 13 | `getOrganizationDbPath` | function | 170 |
| 14 | `isHealthySqliteDatabase` | function | 174 |
| 15 | `isOrganizationRuntimeRoot` | function | 187 |
| 16 | `ensureOrganizationRuntimeLayout` | function | 192 |
| 17 | `writeMigrationMarker` | function | 198 |
| 18 | `moveOrganizationRootPreservingSource` | function | 208 |
| 19 | `migrateLegacySharedRootToOrganization` | function | 239 |
| 20 | `detectExistingOrganizationRuntimeRoot` | function | 259 |
| 21 | `STORAGE_ROOT` | const arrow | 271 |
| 22 | `PRIMARY_ORGANIZATION_SEED` | const arrow | 279 |
| 23 | `DATA_ROOT` | const arrow | 303 |

### 3.6 `backend/src/conflictControl.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `WriteConflictError` | class | 3 |
| 2 | `normalizeUpdatedAt` | function | 17 |
| 3 | `getExpectedUpdatedAt` | function | 22 |
| 4 | `assertUpdatedAtMatch` | function | 31 |
| 5 | `sendWriteConflict` | function | 43 |

### 3.7 `backend/src/contactOptions.js`

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

### 3.8 `backend/src/database.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `safePragma` | function | 49 |
| 2 | `applyDatabasePragmas` | function | 53 |
| 3 | `runDatabaseMaintenance` | function | 66 |
| 4 | `tableHasColumn` | function | 867 |
| 5 | `ensureColumn` | function | 877 |
| 6 | `normalizeUserPhoneLookup` | function | 898 |
| 7 | `slugifyOrgName` | function | 903 |
| 8 | `generateOrgPublicId` | function | 912 |
| 9 | `seedIfEmpty` | function | 1041 |
| 10 | `ensureDefaultOrganizationAndGroup` | function | 1052 |
| 11 | `ensurePrimaryAdminRoleAndUser` | function | 1124 |
| 12 | `buildDefaultSettingsSeed` | function | 1175 |
| 13 | `ensureDefaultSettings` | function | 1305 |
| 14 | `ensureDefaultBranches` | function | 1316 |
| 15 | `ensureDefaultUnits` | function | 1322 |
| 16 | `ensureCoreDataInvariants` | function | 1328 |
| 17 | `closeDatabase` | function | 1576 |

### 3.9 `backend/src/dataPath/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizePathForCompare` | function | 10 |
| 2 | `isSamePath` | function | 16 |
| 3 | `isSubPath` | function | 20 |
| 4 | `ensureDataRootLayout` | function | 25 |
| 5 | `walkFiles` | function | 30 |
| 6 | `summarizeDataRoot` | function | 48 |
| 7 | `copyDirectoryContents` | function | 89 |
| 8 | `buildArchivedTargetPath` | function | 126 |
| 9 | `relocateDataRoot` | function | 143 |

### 3.10 `backend/src/fileAssets.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ensureUploadsDirectory` | function | 48 |
| 2 | `getMimeTypeFromName` | function | 52 |
| 3 | `getMediaType` | function | 57 |
| 4 | `sanitizeOriginalFileName` | function | 66 |
| 5 | `preserveOriginalDisplayName` | function | 79 |
| 6 | `buildUniqueStoredName` | function | 87 |
| 7 | `shouldCompressImage` | function | 101 |
| 8 | `compressBufferForAsset` | function | 107 |
| 9 | `readImageDimensions` | function | 147 |
| 10 | `getFfmpegPath` | function | 160 |
| 11 | `optimizeStoredVideo` | function | 168 |
| 12 | `createFileAssetRecord` | function | 234 |
| 13 | `getFileAssetByPublicPath` | function | 314 |
| 14 | `listAssetRows` | function | 323 |
| 15 | `getUploadFilePath` | function | 345 |
| 16 | `collectUsage` | function | 350 |
| 17 | `serializeAssetRow` | function | 379 |
| 18 | `registerStoredAsset` | function | 389 |
| 19 | `registerUploadFromRequest` | function | 447 |
| 20 | `storeDataUrlAsset` | function | 460 |
| 21 | `backfillUploadAssets` | function | 483 |
| 22 | `listFileAssets` | function | 501 |
| 23 | `getFileAssetById` | function | 507 |
| 24 | `deleteFileAsset` | function | 512 |

### 3.11 `backend/src/helpers.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `logOp` | function | 21 |
| 2 | `getServerLog` | function | 26 |
| 3 | `ok` | function | 30 |
| 4 | `err` | function | 35 |
| 5 | `audit` | function | 50 |
| 6 | `broadcast` | function | 108 |
| 7 | `tryParse` | function | 125 |
| 8 | `today` | function | 130 |
| 9 | `parseCSVRows` | function | 142 |
| 10 | `bulkImportCSV` | function | 166 |
| 11 | `parseCSVLine` | function | 192 |
| 12 | `importRows` | function | 212 |
| 13 | `verifyAndRepairStockQuantities` | function | 227 |
| 14 | `verifyAndRepairSaleStatuses` | function | 285 |
| 15 | `verifyAndRepairCostPrices` | function | 345 |
| 16 | `runDataIntegrityCheck` | function | 427 |
| 17 | `getSafeCostPrice` | function | 454 |
| 18 | `calculateSaleProfit` | function | 465 |

### 3.12 `backend/src/idempotency.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeClientRequestId` | function | 3 |

### 3.13 `backend/src/importCsv.js`

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

### 3.14 `backend/src/importParsing.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeDigit` | function | 9 |
| 2 | `normalizeNumericText` | function | 17 |
| 3 | `removeCurrencyNoise` | function | 24 |
| 4 | `normalizeNumberSeparators` | function | 31 |
| 5 | `parseImportNumericValue` | function | 65 |
| 6 | `normalizeImportMoney` | function | 80 |

### 3.15 `backend/src/middleware.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `authToken` | function | 16 |
| 2 | `networkAccessGuard` | function | 29 |
| 3 | `sanitiseFilename` | function | 34 |
| 4 | `resolveExtension` | function | 66 |
| 5 | `compressibleImageFormat` | function | 78 |
| 6 | `compressImageFile` | function | 83 |
| 7 | `compressImageBuffer` | function | 132 |
| 8 | `getClientKey` | function | 178 |
| 9 | `routeRateLimit` | function | 184 |
| 10 | `createStorage` | function | 196 |
| 11 | `buildUpload` | function | 212 |
| 12 | `parsePermissionsValue` | function | 244 |
| 13 | `getMergedPermissions` | function | 254 |
| 14 | `isAdminControlUser` | function | 261 |
| 15 | `hasPermission` | function | 269 |
| 16 | `requirePermission` | function | 276 |
| 17 | `requireAnyPermission` | function | 288 |
| 18 | `getAuditActor` | function | 301 |
| 19 | `compressUpload` | function | 314 |
| 20 | `validateUploadedFile` | function | 328 |
| 21 | `validateUploadBufferPayload` | function | 339 |

### 3.16 `backend/src/money.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toFiniteNumber` | function | 3 |
| 2 | `roundUpToDecimals` | function | 8 |
| 3 | `normalizePriceValue` | function | 17 |

### 3.17 `backend/src/netSecurity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 26 |
| 2 | `normalizeHostname` | function | 30 |
| 3 | `isPrivateIpv4` | function | 34 |
| 4 | `isPrivateIpv6` | function | 47 |
| 5 | `isBlockedHostname` | function | 58 |
| 6 | `assertSafeOutboundUrl` | function | 69 |
| 7 | `isSafeExternalImageReference` | function | 97 |

### 3.18 `backend/src/organizationContext/index.js`

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
| 13 | `ensureOrganizationFilesystemLayout` | function | 158 |
| 14 | `getOrganizationStorageStatus` | function | 226 |

### 3.19 `backend/src/portalUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toTrimmedString` | function | 5 |
| 2 | `safeJsonParse` | function | 9 |
| 3 | `createAboutBlock` | function | 17 |
| 4 | `normalizeAboutBlocks` | function | 28 |
| 5 | `extractGoogleMapsEmbedUrl` | function | 47 |
| 6 | `normalizeGoogleMapsEmbed` | function | 55 |

### 3.20 `backend/src/productDiscounts.js`

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

### 3.21 `backend/src/productImportPolicies.js`

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

### 3.22 `backend/src/requestContext.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cleanText` | function | 7 |
| 2 | `readHeader` | function | 13 |
| 3 | `extractRequestMeta` | function | 19 |
| 4 | `requestContextMiddleware` | function | 45 |
| 5 | `getRequestMeta` | function | 50 |

### 3.23 `backend/src/routes/actionHistory.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseJson` | function | 10 |
| 2 | `normalizeLimit` | function | 20 |
| 3 | `normalizeText` | function | 25 |
| 4 | `serializePayload` | function | 30 |
| 5 | `canReadAllHistory` | function | 39 |
| 6 | `getOwnedHistoryRow` | function | 43 |
| 7 | `canOperateHistoryRow` | function | 49 |
| 8 | `getHistoryRow` | function | 55 |
| 9 | `mapRow` | function | 62 |
| 10 | `completeServerHistoryTransition` | function | 162 |

### 3.24 `backend/src/routes/ai.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `listProviders` | function | 19 |
| 2 | `getProviderRow` | function | 28 |

### 3.25 `backend/src/routes/auth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getClientKey` | function | 90 |
| 2 | `applyRateLimit` | function | 103 |
| 3 | `getLoginLockKey` | function | 115 |
| 4 | `isReasonableCredentialLength` | function | 119 |
| 5 | `normalizeLookupText` | function | 124 |
| 6 | `isHttpUrl` | function | 128 |
| 7 | `buildPublicBaseUrl` | function | 132 |
| 8 | `resolvePasswordResetRedirect` | function | 139 |
| 9 | `loginIdentifierPreview` | function | 155 |
| 10 | `rejectLogin` | function | 169 |
| 11 | `getOtpSecret` | function | 191 |
| 12 | `requireOtpActor` | function | 195 |
| 13 | `getOtpTargetUser` | function | 201 |
| 14 | `buildUserPayload` | function | 216 |
| 15 | `resolveOrganizationLookup` | function | 248 |
| 16 | `findUserByIdentifier` | function | 254 |
| 17 | `getExactActiveUserById` | function | 323 |
| 18 | `normalizeOauthMode` | function | 338 |
| 19 | `isEmailIdentifier` | function | 343 |
| 20 | `getUserById` | function | 347 |
| 21 | `getSettingsSnapshot` | function | 351 |
| 22 | `getBootstrapSystemSnapshot` | function | 360 |
| 23 | `buildAuthenticatedBootstrap` | function | 391 |
| 24 | `generateTemporaryAuthPassword` | function | 420 |
| 25 | `issueAuthSession` | function | 424 |
| 26 | `updateLocalUserSupabaseIdentity` | function | 435 |

### 3.26 `backend/src/routes/branches.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toDbBool` | function | 10 |
| 2 | `getStockTransferNoteColumn` | function | 18 |

### 3.27 `backend/src/routes/catalog.js`

- No top-level named symbols detected.

### 3.28 `backend/src/routes/categories.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLookup` | function | 11 |
| 2 | `normalizeColor` | function | 15 |

### 3.29 `backend/src/routes/contacts.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cleanMembershipNumber` | function | 19 |
| 2 | `requireMembershipNumber` | function | 23 |
| 3 | `assertUniqueMembershipNumber` | function | 29 |
| 4 | `ensureMembershipNumber` | function | 43 |
| 5 | `generateCustomerMembershipNumber` | function | 48 |
| 6 | `normalizeFieldRule` | function | 68 |
| 7 | `resolveFieldValue` | function | 75 |
| 8 | `buildImportRows` | function | 86 |
| 9 | `normalizeConflictMode` | function | 96 |
| 10 | `toNumber` | function | 101 |
| 11 | `loadPointPolicy` | function | 106 |
| 12 | `calculatePolicyPoints` | function | 132 |
| 13 | `findExisting` | const arrow | 292 |
| 14 | `findExisting` | const arrow | 497 |
| 15 | `findExisting` | const arrow | 681 |

### 3.30 `backend/src/routes/customTables.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `humanizeTableName` | function | 11 |
| 2 | `serializeCustomTable` | function | 20 |
| 3 | `sanitizeCustomTableName` | function | 28 |
| 4 | `resolveCustomTableRow` | function | 34 |
| 5 | `escapeIdentifier` | function | 43 |
| 6 | `normalizeCustomTableSchema` | function | 47 |
| 7 | `tableHasColumn` | function | 68 |
| 8 | `ensureCustomTableRowVersioning` | function | 73 |

### 3.31 `backend/src/routes/files.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseFileAssetId` | function | 18 |
| 2 | `getFileListFilters` | function | 26 |
| 3 | `getDeviceMeta` | function | 38 |

### 3.32 `backend/src/routes/importJobs.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `permissionForImportType` | function | 32 |
| 2 | `requireImportPermission` | function | 40 |
| 3 | `hasAnyImportPermission` | function | 53 |
| 4 | `requireAnyImportPermission` | function | 57 |
| 5 | `ensureDir` | function | 67 |
| 6 | `getJobUploadRoot` | function | 71 |
| 7 | `getJobOr404` | function | 76 |
| 8 | `isAllowedImportFile` | function | 105 |
| 9 | `parsePolicy` | function | 129 |
| 10 | `parseRelativePaths` | function | 135 |
| 11 | `shouldForceDelete` | function | 146 |

### 3.33 `backend/src/routes/inventory.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeImportedTimestamp` | function | 11 |
| 2 | `recalcProductStock` | function | 19 |
| 3 | `cleanMoveReason` | function | 28 |
| 4 | `getBranchQty` | const arrow | 60 |

### 3.34 `backend/src/routes/notifications.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeBoolean` | function | 20 |
| 2 | `toNumber` | function | 28 |
| 3 | `loadNotificationPreferences` | function | 33 |
| 4 | `loadPointPolicy` | function | 57 |
| 5 | `calculatePolicyPoints` | function | 83 |
| 6 | `buildInventorySection` | function | 88 |
| 7 | `buildSalesSection` | function | 164 |
| 8 | `buildLoyaltySection` | function | 231 |
| 9 | `buildPortalSection` | function | 318 |
| 10 | `buildSystemSection` | function | 355 |

### 3.35 `backend/src/routes/organizations.js`

- No top-level named symbols detected.

### 3.36 `backend/src/routes/portal.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `asyncRoute` | function | 23 |
| 2 | `toNumber` | function | 28 |
| 3 | `normalizeBoolean` | function | 34 |
| 4 | `normalizePhone` | function | 40 |
| 5 | `normalizePublicPath` | function | 45 |
| 6 | `normalizeUrl` | function | 59 |
| 7 | `normalizeRedeemValueUsd` | function | 74 |
| 8 | `normalizeRedeemValueKhr` | function | 79 |
| 9 | `normalizeHexColor` | function | 86 |
| 10 | `normalizeFaqItems` | function | 92 |
| 11 | `normalizeProductIdList` | function | 105 |
| 12 | `loadSettingsMap` | function | 120 |
| 13 | `buildPortalConfig` | function | 128 |
| 14 | `buildRankMap` | function | 253 |
| 15 | `getPortalProductSignals` | function | 272 |
| 16 | `calculatePointsValue` | function | 370 |
| 17 | `summarizePoints` | function | 380 |
| 18 | `getPortalProducts` | function | 420 |
| 19 | `cacheTtl` | function | 495 |
| 20 | `getCachedPortalConfig` | function | 499 |
| 21 | `getCachedPortalMeta` | function | 503 |
| 22 | `getCachedPortalProducts` | function | 507 |
| 23 | `getPortalCatalogMeta` | function | 512 |
| 24 | `findCustomerByMembership` | function | 558 |
| 25 | `sanitizeScreenshots` | function | 568 |
| 26 | `materializePortalScreenshots` | function | 577 |
| 27 | `sanitizeAiProfile` | function | 595 |
| 28 | `getVisitorFingerprint` | function | 607 |
| 29 | `getClientKey` | function | 613 |
| 30 | `applyPortalRateLimit` | function | 618 |

### 3.37 `backend/src/routes/products.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getActiveBranches` | function | 27 |
| 2 | `getDefaultBranch` | function | 31 |
| 3 | `seedBranchRows` | function | 35 |
| 4 | `recalcProductStock` | function | 40 |
| 5 | `normalizeImageGallery` | function | 49 |
| 6 | `syncProductImageGallery` | function | 56 |
| 7 | `loadProductImageMap` | function | 74 |
| 8 | `attachImageGallery` | function | 92 |
| 9 | `findProductByClientRequestId` | function | 104 |
| 10 | `assertUniqueProductFields` | function | 114 |
| 11 | `hasOwnField` | function | 141 |
| 12 | `pickField` | function | 145 |
| 13 | `ensureParentProductExists` | function | 149 |
| 14 | `markParentProductAsGroup` | function | 159 |
| 15 | `normalizeImportLookup` | function | 164 |
| 16 | `normalizeImportFlagValue` | function | 168 |
| 17 | `getProductImportDetailSignature` | function | 217 |
| 18 | `chooseImportParentProduct` | function | 227 |
| 19 | `normalizeImportAction` | function | 242 |
| 20 | `parseOptionalImportId` | function | 250 |
| 21 | `discountInsertColumns` | function | 257 |
| 22 | `discountValues` | function | 261 |
| 23 | `normalizeLookup` | const arrow | 675 |
| 24 | `resolveImage` | const arrow | 784 |
| 25 | `ensureCategory` | const arrow | 800 |
| 26 | `ensureUnit` | const arrow | 814 |
| 27 | `ensureBrand` | const arrow | 828 |
| 28 | `ensureSupplier` | const arrow | 840 |
| 29 | `determineBranch` | const arrow | 851 |
| 30 | `handleBranch` | const arrow | 870 |
| 31 | `isDirectImageRef` | const arrow | 895 |
| 32 | `normalizeDirectImageRef` | const arrow | 906 |
| 33 | `parseIncomingImageRefs` | const arrow | 913 |
| 34 | `loadCurrentGallery` | const arrow | 946 |

### 3.38 `backend/src/routes/returns.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `refreshProductStockQuantity` | function | 13 |
| 2 | `refreshProductStockQuantities` | function | 26 |
| 3 | `normalizeScope` | function | 36 |
| 4 | `toNumber` | function | 44 |
| 5 | `findReturnByClientRequestId` | function | 49 |
| 6 | `assertReturnableItems` | function | 59 |
| 7 | `assertSupplierReturnableStock` | function | 374 |

### 3.39 `backend/src/routes/runtime.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `requireRuntimePermission` | function | 12 |

### 3.40 `backend/src/routes/sales.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeImportedTimestamp` | function | 11 |
| 2 | `getSaleItemCosts` | function | 19 |
| 3 | `assertSaleStockAvailable` | function | 45 |
| 4 | `findCustomerForSaleAssignment` | function | 74 |
| 5 | `parseBranchId` | function | 95 |
| 6 | `getActiveBranchContext` | function | 100 |
| 7 | `requireActiveBranch` | function | 115 |
| 8 | `resolveSaleItemBranchId` | function | 122 |
| 9 | `normalizeSaleItems` | function | 133 |
| 10 | `summarizeSaleBranch` | function | 163 |
| 11 | `refreshProductStockQuantity` | function | 187 |
| 12 | `refreshProductStockQuantities` | function | 200 |
| 13 | `fetchSaleItemsWithBranches` | function | 207 |
| 14 | `findSaleByClientRequestId` | function | 216 |

### 3.41 `backend/src/routes/settings.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLookup` | function | 11 |
| 2 | `normalizeBrandOptionsValue` | function | 15 |
| 3 | `settingsHasUpdatedAt` | function | 39 |
| 4 | `getSettingsSnapshot` | function | 48 |
| 5 | `getSettingsUpdatedAt` | function | 55 |

### 3.42 `backend/src/routes/system/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `q` | function | 79 |
| 2 | `getClientKey` | function | 83 |
| 3 | `applyRouteRateLimit` | function | 89 |
| 4 | `stopImportsBeforeDestructiveAction` | function | 101 |
| 5 | `runFsWorker` | function | 116 |
| 6 | `finish` | const arrow | 128 |
| 7 | `getHostUiAvailability` | function | 172 |
| 8 | `buildRequestBaseUrl` | function | 181 |
| 9 | `resolveDriveRedirectUri` | function | 188 |
| 10 | `getTableColumns` | function | 195 |
| 11 | `getSafeTableCount` | function | 199 |
| 12 | `buildMigrationTableCounts` | function | 207 |
| 13 | `safeJsonParse` | function | 227 |
| 14 | `readSystemSettings` | function | 236 |
| 15 | `writeSystemSettings` | function | 247 |
| 16 | `getMigrationSafetyBackupDestination` | function | 262 |
| 17 | `getMigrationSafetyState` | function | 266 |
| 18 | `createMigrationSafetyBackup` | function | 288 |
| 19 | `runMigrationSafetyDriveSync` | function | 306 |
| 20 | `runMigrationSafetyAutomation` | function | 344 |
| 21 | `buildScaleMigrationStatus` | function | 359 |
| 22 | `extractUploadPathsFromText` | function | 410 |
| 23 | `collectBackupUploads` | function | 419 |
| 24 | `addUpload` | const arrow | 423 |
| 25 | `restoreBackupUploads` | function | 453 |
| 26 | `deleteAllUploads` | function | 463 |
| 27 | `getBackupDataRootCandidate` | function | 472 |
| 28 | `readBackupTablesFromDataRoot` | function | 484 |
| 29 | `restoreUploadsFromDataRoot` | function | 517 |
| 30 | `restoreSnapshotTables` | function | 531 |
| 31 | `replaceTableRows` | function | 587 |
| 32 | `normaliseBackupTables` | function | 622 |
| 33 | `normaliseBackupCustomTableRows` | function | 652 |
| 34 | `repairRelationalConsistency` | function | 657 |
| 35 | `getCustomTableNames` | function | 665 |
| 36 | `parseCustomTableDefinition` | function | 671 |
| 37 | `recreateCustomTable` | function | 714 |
| 38 | `listWindowsFsRoots` | const arrow | 1379 |
| 39 | `listDriveRoots` | const arrow | 1396 |

### 3.43 `backend/src/routes/units.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLookup` | function | 12 |
| 2 | `normalizeUnitColor` | function | 16 |
| 3 | `updateUnitHandler` | function | 50 |

### 3.44 `backend/src/routes/users.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getClientKey` | function | 49 |
| 2 | `parseJson` | function | 55 |
| 3 | `normalizeLookupText` | function | 63 |
| 4 | `normalizePhoneLookup` | function | 67 |
| 5 | `findUserIdentityConflict` | function | 71 |
| 6 | `getMergedPermissions` | function | 139 |
| 7 | `isPrimaryAdmin` | function | 148 |
| 8 | `hasAdminControl` | function | 155 |
| 9 | `canManageTarget` | function | 168 |
| 10 | `getActorFromRequest` | function | 181 |
| 11 | `requireAdminControl` | function | 188 |
| 12 | `getUserSecurityContext` | function | 201 |
| 13 | `getUserWithRole` | function | 211 |
| 14 | `syncLocalEmailVerification` | function | 226 |
| 15 | `repairSupabaseIdentityForUser` | function | 257 |
| 16 | `sanitizeUserRow` | function | 286 |
| 17 | `isValidEmail` | function | 302 |
| 18 | `getAuthIdentityList` | function | 307 |
| 19 | `isUuid` | function | 313 |
| 20 | `resolveAuthIdentityUuid` | function | 317 |
| 21 | `buildAuthMethodsPayload` | function | 326 |

### 3.45 `backend/src/runtimeCache.js`

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

### 3.46 `backend/src/runtimeState/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ensureRuntimeMetaDir` | function | 11 |
| 2 | `readRuntimeState` | function | 15 |
| 3 | `writeRuntimeState` | function | 32 |
| 4 | `getRuntimeState` | function | 38 |
| 5 | `bumpStorageVersion` | function | 48 |
| 6 | `buildRuntimeDescriptor` | function | 57 |

### 3.47 `backend/src/security.js`

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

### 3.48 `backend/src/serverUtils.js`

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
| 13 | `sanitizeObjectKeys` | function | 160 |
| 14 | `sanitizeStringValue` | function | 179 |
| 15 | `sanitizeRequestPayload` | function | 185 |
| 16 | `sanitizeDeepStrings` | function | 192 |
| 17 | `isApiOrHealthPath` | function | 209 |
| 18 | `isSpaFallbackEligible` | function | 213 |
| 19 | `setNoStoreHeaders` | function | 221 |
| 20 | `setHtmlNoCacheHeaders` | function | 225 |
| 21 | `isCustomerPortalRoutePath` | function | 232 |
| 22 | `setTunnelSecurityHeaders` | function | 237 |
| 23 | `setFrontendStaticHeaders` | function | 282 |
| 24 | `setUploadStaticHeaders` | function | 318 |
| 25 | `mapServerError` | function | 325 |

### 3.49 `backend/src/services/aiGateway.js`

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
| 11 | `callChatProvider` | function | 177 |
| 12 | `testProviderConfig` | function | 269 |

### 3.50 `backend/src/services/firebaseAuth.js`

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

### 3.51 `backend/src/services/googleDriveSync/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 53 |
| 2 | `trim` | function | 57 |
| 3 | `toBool` | function | 61 |
| 4 | `clamp` | function | 69 |
| 5 | `escapeDriveQueryValue` | function | 75 |
| 6 | `readSettingsMap` | function | 79 |
| 7 | `writeSettingsMap` | function | 89 |
| 8 | `clearDriveSyncMappings` | function | 107 |
| 9 | `resetDriveSyncRootState` | function | 111 |
| 10 | `getDriveSyncConfig` | function | 118 |
| 11 | `getDriveSyncEntriesMap` | function | 145 |
| 12 | `upsertDriveSyncEntry` | function | 156 |
| 13 | `deleteDriveSyncEntry` | function | 182 |
| 14 | `deleteDriveSyncEntriesUnder` | function | 186 |
| 15 | `inferMimeType` | function | 193 |
| 16 | `md5File` | function | 208 |
| 17 | `buildMultipartBody` | function | 214 |
| 18 | `exchangeRefreshToken` | function | 231 |
| 19 | `exchangeAuthorizationCode` | function | 250 |
| 20 | `driveApiRequest` | function | 273 |
| 21 | `driveApiUpload` | function | 290 |
| 22 | `fetchDriveUserProfile` | function | 306 |
| 23 | `findDriveItem` | function | 321 |
| 24 | `findDriveItems` | function | 326 |
| 25 | `listDriveChildren` | function | 341 |
| 26 | `getDriveFileIfExists` | function | 350 |
| 27 | `removeDuplicateDriveItems` | function | 362 |
| 28 | `createDriveFolder` | function | 374 |
| 29 | `ensureRootFolder` | function | 386 |
| 30 | `buildManagedSnapshotRoot` | function | 405 |
| 31 | `ensureSnapshotLayout` | function | 409 |
| 32 | `shouldSkipSnapshotFile` | function | 415 |
| 33 | `createDataRootSnapshot` | function | 420 |
| 34 | `collectSnapshotItems` | function | 450 |
| 35 | `ensureRemoteDirectories` | function | 479 |
| 36 | `uploadDriveFile` | function | 514 |
| 37 | `updateDriveFile` | function | 529 |
| 38 | `removeDriveFile` | function | 540 |
| 39 | `runDriveSync` | function | 552 |
| 40 | `scheduleDriveSync` | function | 706 |
| 41 | `getDriveSyncStatus` | function | 729 |
| 42 | `beginGoogleDriveOAuth` | function | 760 |
| 43 | `prunePendingOauthStates` | function | 779 |
| 44 | `finalizeGoogleDriveOAuth` | function | 786 |
| 45 | `saveDriveSyncPreferences` | function | 828 |
| 46 | `disconnectDriveSync` | function | 847 |
| 47 | `updateEnvSettingLines` | function | 863 |
| 48 | `forgetDriveSyncCredentials` | function | 876 |
| 49 | `schedulePeriodicDriveSync` | function | 891 |

### 3.52 `backend/src/services/importJobs.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 49 |
| 2 | `wait` | function | 53 |
| 3 | `yieldImportWorker` | function | 57 |
| 4 | `countCsvRowsFromFile` | function | 62 |
| 5 | `safeJson` | function | 107 |
| 6 | `stringify` | function | 112 |
| 7 | `decorateImportJobRow` | function | 116 |
| 8 | `isImportJobStale` | function | 125 |
| 9 | `isImportJobWorkDrained` | function | 131 |
| 10 | `markStoredImportFilesCancelled` | function | 143 |
| 11 | `reconcileImportJobRow` | function | 153 |
| 12 | `ensureDir` | function | 174 |
| 13 | `ensureImportRoot` | function | 178 |
| 14 | `getJobRoot` | function | 182 |
| 15 | `assertSafeImportPath` | function | 186 |
| 16 | `deleteImportJobFiles` | function | 195 |
| 17 | `clearImportRuntimeFiles` | function | 202 |
| 18 | `createImportJob` | function | 213 |
| 19 | `getImportJob` | function | 233 |
| 20 | `listImportJobs` | function | 239 |
| 21 | `updateJob` | function | 248 |
| 22 | `addJobError` | function | 274 |
| 23 | `getJobErrors` | function | 281 |
| 24 | `normalizeReviewText` | function | 291 |
| 25 | `hasReviewQueryMatch` | function | 295 |
| 26 | `normalizeReviewFilter` | function | 315 |
| 27 | `matchesReviewFilter` | function | 323 |
| 28 | `buildProductReviewIndex` | function | 331 |
| 29 | `getProductConflictForReview` | function | 358 |
| 30 | `buildContactReviewIndex` | function | 407 |
| 31 | `getContactConflictForReview` | function | 427 |
| 32 | `getGenericImportConflictForReview` | function | 478 |
| 33 | `applyImportDecisionToRow` | function | 491 |
| 34 | `getImportDecisionMap` | function | 508 |
| 35 | `getImportJobReview` | function | 514 |
| 36 | `updateImportJobDecisions` | function | 585 |
| 37 | `addJobFile` | function | 598 |
| 38 | `getJobFiles` | function | 617 |
| 39 | `markJobCancelled` | function | 622 |
| 40 | `isCancelled` | function | 626 |
| 41 | `waitForQueuedImportMedia` | function | 632 |
| 42 | `finalizeSkippedImportImages` | function | 659 |
| 43 | `normalizeLookup` | function | 676 |
| 44 | `normalizeText` | function | 680 |
| 45 | `getMimeTypeFromName` | function | 684 |
| 46 | `normalizeProductSignature` | function | 738 |
| 47 | `chooseParentProduct` | function | 746 |
| 48 | `normalizeImportAction` | function | 760 |
| 49 | `parseOptionalImportId` | function | 768 |
| 50 | `parseIncomingImageRefs` | function | 773 |
| 51 | `syncProductImageGallery` | function | 807 |
| 52 | `loadCurrentGallery` | function | 830 |
| 53 | `ensureParentProductExists` | function | 837 |
| 54 | `assertUniqueProductFields` | function | 846 |
| 55 | `findProductIdentifierConflict` | function | 880 |
| 56 | `normalizeIdentifierConflictMode` | function | 901 |
| 57 | `resolveNewProductIdentifiers` | function | 909 |
| 58 | `copyImageIntoAssets` | function | 946 |
| 59 | `resolveImageGallery` | function | 985 |
| 60 | `ensureSettingOptionMap` | function | 1041 |
| 61 | `upsertSettingJson` | function | 1051 |
| 62 | `normalizeRowForProduct` | function | 1058 |
| 63 | `createProductContext` | function | 1103 |
| 64 | `ensureCategory` | function | 1125 |
| 65 | `ensureUnit` | function | 1137 |
| 66 | `ensureBrand` | function | 1148 |
| 67 | `ensureSupplier` | function | 1160 |
| 68 | `determineBranch` | function | 1171 |
| 69 | `handleBranchStock` | function | 1186 |
| 70 | `recalcProductStock` | function | 1204 |
| 71 | `insertInventoryMovement` | function | 1213 |
| 72 | `seedBranchRows` | function | 1237 |
| 73 | `processProductRow` | function | 1244 |
| 74 | `processProductRowBatches` | function | 1465 |
| 75 | `flushProgress` | const arrow | 1474 |
| 76 | `processProductRows` | function | 1554 |
| 77 | `buildImageLookup` | function | 1564 |
| 78 | `normalizeImageMatchKey` | function | 1579 |
| 79 | `processImageOnlyFiles` | function | 1589 |
| 80 | `normalizeContactMode` | function | 1651 |
| 81 | `resolveContactValue` | function | 1656 |
| 82 | `parseFieldRules` | function | 1664 |
| 83 | `generateCustomerMembershipNumber` | function | 1670 |
| 84 | `processContactRowBatches` | function | 1681 |
| 85 | `processContactRows` | function | 1850 |
| 86 | `normalizeInventoryAction` | function | 1860 |
| 87 | `processInventoryRowBatches` | function | 1867 |
| 88 | `processInventoryRows` | function | 1968 |
| 89 | `processSalesRowBatches` | function | 1977 |
| 90 | `processSalesRows` | function | 2192 |
| 91 | `extractZipImages` | function | 2201 |
| 92 | `processImportJob` | function | 2271 |
| 93 | `runLocalJob` | function | 2406 |
| 94 | `normalizeQueueMode` | function | 2413 |
| 95 | `queueNameForMode` | function | 2417 |
| 96 | `configuredQueueDriver` | function | 2421 |
| 97 | `getImportQueueConcurrency` | function | 2427 |
| 98 | `hasBullProducer` | function | 2431 |
| 99 | `hasBullWorkers` | function | 2435 |
| 100 | `removeQueuedBullJobsForImport` | function | 2439 |
| 101 | `getBullConnection` | function | 2462 |
| 102 | `initializeBullQueue` | function | 2475 |
| 103 | `startImportWorkers` | function | 2498 |
| 104 | `startWorker` | const arrow | 2505 |
| 105 | `enqueueImportJob` | function | 2541 |
| 106 | `cancelImportJob` | function | 2573 |
| 107 | `listCancellableImportJobs` | function | 2606 |
| 108 | `waitForImportJobsToStop` | function | 2615 |
| 109 | `cancelAllImportJobs` | function | 2637 |
| 110 | `deleteImportJob` | function | 2668 |
| 111 | `deleteAllImportJobs` | function | 2698 |
| 112 | `approveImportJob` | function | 2714 |
| 113 | `recoverImportJobs` | function | 2733 |
| 114 | `getQueueStatus` | function | 2760 |
| 115 | `buildErrorsCsv` | function | 2777 |
| 116 | `escape` | const arrow | 2779 |

### 3.53 `backend/src/services/mediaQueue.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `wait` | function | 19 |
| 2 | `queueDriverRequired` | function | 23 |
| 3 | `isImportJobCancelled` | function | 27 |
| 4 | `getMediaConnection` | function | 34 |
| 5 | `initializeMediaQueue` | function | 47 |
| 6 | `processMediaOptimizationJob` | function | 69 |
| 7 | `runLocalMediaJob` | function | 123 |
| 8 | `enqueueMediaOptimization` | function | 135 |
| 9 | `startMediaWorker` | function | 161 |
| 10 | `getMediaQueueStatus` | function | 185 |

### 3.54 `backend/src/services/portalAi.js`

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

### 3.55 `backend/src/services/supabaseAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `truthy` | function | 13 |
| 2 | `trim` | function | 17 |
| 3 | `parseJsonSafe` | function | 21 |
| 4 | `normalizeSupabaseUrl` | function | 29 |
| 5 | `normalizeEmail` | function | 33 |
| 6 | `isPlainObject` | function | 38 |
| 7 | `clampPassword` | function | 42 |
| 8 | `isAllowedOauthProvider` | function | 46 |
| 9 | `isHttpUrl` | function | 50 |
| 10 | `isSupabaseAuthConfigured` | function | 64 |
| 11 | `hasSupabaseAdminCredentials` | function | 68 |
| 12 | `hasSupabasePublicCredentials` | function | 72 |
| 13 | `buildSupabaseUrl` | function | 76 |
| 14 | `normalizeRedirectTo` | function | 80 |
| 15 | `getSupabaseAuthPublicConfig` | function | 85 |
| 16 | `normalizeProviderError` | function | 101 |
| 17 | `parseResponseData` | function | 118 |
| 18 | `callSupabasePublic` | function | 126 |
| 19 | `callSupabaseAdmin` | function | 159 |
| 20 | `getBanDurationForActiveState` | function | 193 |
| 21 | `buildUserMetadata` | function | 197 |
| 22 | `buildAppMetadata` | function | 207 |
| 23 | `getIdentityProviders` | function | 216 |
| 24 | `summarizeAuthUser` | function | 237 |
| 25 | `isLocalUserActive` | function | 254 |
| 26 | `getAuthUserById` | function | 258 |
| 27 | `getAuthUserFromAccessToken` | function | 266 |
| 28 | `listAuthUsersPage` | function | 276 |
| 29 | `findAuthUserByEmail` | function | 295 |
| 30 | `createOrUpdateAuthUser` | function | 315 |
| 31 | `updateAuthPassword` | function | 365 |
| 32 | `setAuthUserActive` | function | 384 |
| 33 | `verifyPasswordWithSupabase` | function | 399 |
| 34 | `unlinkAuthIdentity` | function | 424 |
| 35 | `sendSupabaseVerificationEmail` | function | 438 |
| 36 | `sendSupabasePasswordRecoveryEmail` | function | 477 |
| 37 | `buildOauthStartUrl` | function | 501 |

### 3.56 `backend/src/services/verification.js`

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

### 3.57 `backend/src/sessionAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `hashToken` | function | 15 |
| 2 | `buildSessionExpiry` | function | 19 |
| 3 | `createAuthSession` | function | 35 |
| 4 | `buildRevocationTimestamp` | function | 56 |
| 5 | `getPresentedSessionToken` | function | 61 |
| 6 | `getSessionUser` | function | 86 |
| 7 | `revokeAuthSession` | function | 149 |
| 8 | `revokeUserSessions` | function | 161 |

### 3.58 `backend/src/settingsSnapshot.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeUploadPublicPath` | function | 7 |
| 2 | `isUploadPublicPath` | function | 15 |
| 3 | `sanitizeMediaPath` | function | 20 |
| 4 | `sanitizeMediaList` | function | 27 |
| 5 | `uploadPublicPathExists` | function | 40 |
| 6 | `sanitizeSettingValue` | function | 52 |
| 7 | `sanitizeSettingsSnapshot` | function | 56 |

### 3.59 `backend/src/storage/organizationFolders.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 6 |
| 2 | `sanitizeOrganizationFolderLabel` | function | 10 |
| 3 | `buildOrganizationFolderName` | function | 20 |
| 4 | `extractOrganizationPublicId` | function | 26 |
| 5 | `findOrganizationFolderByPublicId` | function | 33 |

### 3.60 `backend/src/systemFsWorker.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatBackupStamp` | function | 15 |
| 2 | `pad` | const arrow | 17 |
| 3 | `respond` | function | 21 |
| 4 | `fail` | function | 25 |
| 5 | `runExportFolder` | function | 30 |
| 6 | `runRelocateDataRoot` | function | 70 |
| 7 | `main` | function | 77 |

### 3.61 `backend/src/uploadReferenceCleanup.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `safeJsonArray` | function | 10 |
| 2 | `repairMissingUploadReferences` | function | 19 |

### 3.62 `backend/src/uploadSecurity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `bufferStartsWith` | function | 11 |
| 2 | `isLikelyCsvBuffer` | function | 15 |
| 3 | `detectBufferKind` | function | 28 |
| 4 | `getExpectedUploadedKind` | function | 42 |
| 5 | `validateImageMetadata` | function | 51 |
| 6 | `validateUploadedBuffer` | function | 65 |
| 7 | `validateUploadedPath` | function | 76 |

### 3.63 `backend/src/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `attachWss` | function | 24 |

### 3.64 `backend/src/workers/importWorker.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `start` | function | 10 |
| 2 | `shutdown` | function | 16 |

### 3.65 `backend/src/workers/mediaWorker.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `start` | function | 10 |
| 2 | `shutdown` | function | 15 |

### 3.66 `backend/src/workers/migrationWorker.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 14 |
| 2 | `quoteIdent` | function | 18 |
| 3 | `normalizeSqliteType` | function | 22 |
| 4 | `resolvePostgresColumnType` | function | 31 |
| 5 | `defaultExpression` | function | 51 |
| 6 | `mapColumnDefinition` | function | 61 |
| 7 | `readSqliteTables` | function | 71 |
| 8 | `ensureSchema` | function | 81 |
| 9 | `hashFile` | function | 103 |
| 10 | `tableHasRows` | function | 119 |
| 11 | `insertRows` | function | 124 |
| 12 | `migrateTable` | function | 143 |
| 13 | `resetIdentity` | function | 157 |
| 14 | `hmac` | function | 166 |
| 15 | `sha256Hex` | function | 170 |
| 16 | `deriveSigningKey` | function | 174 |
| 17 | `encodeS3Path` | function | 181 |
| 18 | `s3Request` | function | 185 |
| 19 | `ensureBucket` | function | 252 |
| 20 | `migrateUploadsToMinio` | function | 256 |
| 21 | `collectFiles` | function | 276 |
| 22 | `resolveLegacyPaths` | function | 286 |
| 23 | `snapshotSqliteDatabase` | function | 316 |
| 24 | `start` | function | 329 |

### 3.67 `backend/test/accessControl.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |
| 2 | `makeReq` | function | 22 |

### 3.68 `backend/test/authOtpGuards.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |

### 3.69 `backend/test/authSecurityFlow.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 16 |
| 2 | `makeTempRoot` | function | 34 |
| 3 | `getFreePort` | function | 38 |
| 4 | `waitForHealth` | function | 49 |
| 5 | `startServer` | function | 61 |
| 6 | `stopServer` | function | 82 |
| 7 | `fetchJson` | function | 96 |
| 8 | `login` | function | 108 |

### 3.70 `backend/test/backupRoundtrip.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 19 |
| 2 | `makeTempRoot` | function | 39 |
| 3 | `getFreePort` | function | 43 |
| 4 | `waitForHealth` | function | 54 |
| 5 | `startServer` | function | 66 |
| 6 | `stopServer` | function | 87 |
| 7 | `fetchJson` | function | 101 |
| 8 | `loginAsAdmin` | function | 115 |
| 9 | `uploadPortalLogo` | function | 132 |
| 10 | `seedSourceServer` | function | 143 |
| 11 | `exportBackup` | function | 249 |
| 12 | `assertRoundtripState` | function | 257 |

### 3.71 `backend/test/backupSchema.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.72 `backend/test/configOrganizationRuntime.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |
| 2 | `makeTempRoot` | function | 23 |

### 3.73 `backend/test/contactOptions.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.74 `backend/test/databaseRuntime.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 23 |

### 3.75 `backend/test/dataPath.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 16 |
| 2 | `makeTempRoot` | function | 27 |

### 3.76 `backend/test/fileRouteSecurityFlow.test.js`

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
| 9 | `buildForm` | function | 127 |

### 3.77 `backend/test/idempotency.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.78 `backend/test/importCsv.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 13 |
| 2 | `collectBatches` | function | 26 |

### 3.79 `backend/test/importJobStateMachine.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 34 |
| 2 | `writeImportFile` | function | 45 |
| 3 | `writeJobFile` | function | 52 |
| 4 | `main` | function | 59 |

### 3.80 `backend/test/importScaleSmoke.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |
| 2 | `makeLargeCsv` | function | 23 |
| 3 | `assertLargeCsvSmoke` | function | 38 |

### 3.81 `backend/test/netSecurity.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |

### 3.82 `backend/test/portalUtils.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.83 `backend/test/productImportPolicies.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 15 |

### 3.84 `backend/test/runtimeCache.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 23 |
| 2 | `main` | function | 34 |

### 3.85 `backend/test/serverUtils.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 22 |
| 2 | `collectHeaders` | const arrow | 214 |

### 3.86 `backend/test/stockConsistency.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 21 |
| 2 | `makeTempRoot` | function | 39 |
| 3 | `getFreePort` | function | 43 |
| 4 | `waitForHealth` | function | 54 |
| 5 | `startServer` | function | 66 |
| 6 | `stopServer` | function | 87 |
| 7 | `fetchJson` | function | 101 |
| 8 | `loginAsAdmin` | function | 115 |
| 9 | `getDefaultBranch` | function | 132 |
| 10 | `createBranch` | function | 139 |
| 11 | `createProduct` | function | 158 |
| 12 | `getProduct` | function | 179 |
| 13 | `updateProduct` | function | 186 |
| 14 | `getSale` | function | 195 |
| 15 | `getInventoryMovements` | function | 202 |
| 16 | `getFiles` | function | 209 |
| 17 | `getUsers` | function | 214 |
| 18 | `getRoles` | function | 220 |
| 19 | `getSettings` | function | 226 |
| 20 | `getSettingsMeta` | function | 230 |
| 21 | `getCategories` | function | 234 |
| 22 | `getUnits` | function | 240 |
| 23 | `getAiProviders` | function | 246 |
| 24 | `uploadTinyPng` | function | 252 |
| 25 | `findDbPath` | function | 263 |
| 26 | `sumBranchStock` | function | 282 |

### 3.87 `backend/test/systemRouteSecurity.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 16 |
| 2 | `makeTempRoot` | function | 36 |
| 3 | `getFreePort` | function | 40 |
| 4 | `waitForHealth` | function | 51 |
| 5 | `startServer` | function | 63 |
| 6 | `stopServer` | function | 84 |
| 7 | `fetchJson` | function | 98 |
| 8 | `login` | function | 107 |
| 9 | `createLimitedUser` | function | 126 |

### 3.88 `backend/test/uploadSecurity.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.89 `frontend/postcss.config.mjs`

- No top-level named symbols detected.

### 3.90 `frontend/public/runtime-noise-guard.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `text` | function | 10 |
| 2 | `sourceFromEvent` | function | 14 |
| 3 | `isFirstPartyAsset` | function | 23 |
| 4 | `isInjectedSource` | function | 27 |
| 5 | `isKnownNoise` | function | 32 |
| 6 | `suppress` | function | 45 |

### 3.91 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.js`

- No top-level named symbols detected.

### 3.92 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.worker.js`

- No top-level named symbols detected.

### 3.93 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd-threads.js`

- No top-level named symbols detected.

### 3.94 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd.js`

- No top-level named symbols detected.

### 3.95 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core.js`

- No top-level named symbols detected.

### 3.96 `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js`

- No top-level named symbols detected.

### 3.97 `frontend/public/sw.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isSameOrigin` | function | 38 |
| 2 | `isCacheableStaticPath` | function | 46 |
| 3 | `networkFirstStatic` | function | 52 |

### 3.98 `frontend/public/theme-bootstrap.js`

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

### 3.99 `frontend/src/api/http.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSyncServerUrl` | export function | 39 |
| 2 | `getSyncToken` | export function | 40 |
| 3 | `getAuthSessionToken` | export function | 41 |
| 4 | `setSyncServerUrl` | export function | 43 |
| 5 | `setSyncToken` | export function | 44 |
| 6 | `setAuthSessionToken` | export function | 45 |
| 7 | `hydrateAuthTokenFromStorage` | function | 47 |
| 8 | `readAuthTokenFromStorage` | function | 59 |
| 9 | `cacheGet` | export function | 79 |
| 10 | `cacheSet` | export function | 83 |
| 11 | `cacheInvalidate` | export function | 84 |
| 12 | `cacheClearAll` | export function | 87 |
| 13 | `logCall` | function | 114 |
| 14 | `getCallLog` | export function | 119 |
| 15 | `clearCallLog` | export function | 120 |
| 16 | `getClientMetaHeaders` | function | 122 |
| 17 | `createApiError` | function | 126 |
| 18 | `createWriteBlockedError` | function | 139 |
| 19 | `dispatchWriteBlocked` | function | 149 |
| 20 | `isWriteConflictError` | export function | 163 |
| 21 | `isWriteBlockedError` | export function | 167 |
| 22 | `isInvalidSessionError` | export function | 171 |
| 23 | `requireLiveServerWrite` | export function | 175 |
| 24 | `getConflictRefreshChannels` | function | 207 |
| 25 | `dispatchGlobalDataRefresh` | function | 216 |
| 26 | `sleep` | function | 225 |
| 27 | `hasUsableLocalData` | function | 229 |
| 28 | `tryServerReadWithRetry` | function | 236 |
| 29 | `resolveLocalRead` | function | 246 |
| 30 | `stableStringifyForDedupe` | function | 253 |
| 31 | `clampDedupeBody` | function | 263 |
| 32 | `buildApiRequestDedupeKey` | export function | 269 |
| 33 | `__resetApiWriteDedupeForTests` | export function | 275 |
| 34 | `apiFetch` | export function | 280 |
| 35 | `requestPromise` | const arrow | 293 |
| 36 | `parsed` | const arrow | 318 |
| 37 | `isNetErr` | export function | 369 |
| 38 | `isConnectivityError` | function | 375 |
| 39 | `isServerOnline` | export function | 394 |
| 40 | `setServerHealth` | function | 396 |
| 41 | `pingServerHealth` | function | 408 |
| 42 | `startHealthCheck` | export function | 431 |
| 43 | `cacheGetStale` | export function | 462 |
| 44 | `getChannelRefreshKey` | function | 471 |
| 45 | `emitCacheRefresh` | function | 475 |
| 46 | `clearInflight` | function | 489 |
| 47 | `hasReusableInflight` | function | 494 |
| 48 | `raceServerReadWithLocalFallback` | function | 504 |
| 49 | `route` | export function | 576 |

### 3.100 `frontend/src/api/localDb.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `localGetSettings` | export function | 109 |
| 2 | `localSaveSettings` | export function | 116 |
| 3 | `localGetSettingsMeta` | export function | 124 |
| 4 | `localSaveSettingsMeta` | export function | 128 |
| 5 | `replaceTableContents` | export function | 138 |
| 6 | `resetLocalMirrorDb` | export function | 182 |
| 7 | `clearLocalMirrorTables` | export function | 194 |
| 8 | `parseCSV` | export function | 220 |
| 9 | `splitCSVLine` | function | 224 |
| 10 | `buildCSVTemplate` | export function | 235 |

### 3.101 `frontend/src/api/methods.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDeviceInfo` | function | 3 |
| 2 | `getPortalBaseUrl` | function | 30 |
| 3 | `getCurrentUserContext` | function | 35 |
| 4 | `emitSyncQueueChanged` | function | 50 |
| 5 | `discardPendingSyncQueue` | export function | 57 |
| 6 | `createClientRequestId` | function | 75 |
| 7 | `ensureClientRequestId` | function | 82 |
| 8 | `getPendingSyncState` | export function | 88 |
| 9 | `retryPendingSyncNow` | export function | 128 |
| 10 | `invalidateClientRuntimeState` | function | 132 |
| 11 | `withExpectedUpdatedAt` | function | 148 |
| 12 | `withSettingsExpectedUpdatedAt` | function | 162 |
| 13 | `appendActorQuery` | function | 172 |
| 14 | `fetchJsonWithTimeout` | function | 185 |
| 15 | `mirrorReadResult` | function | 203 |
| 16 | `routeMirrored` | function | 212 |
| 17 | `shouldPersistLocalMirror` | function | 218 |
| 18 | `purgeSensitiveLiveServerMirrors` | function | 222 |
| 19 | `mirrorTable` | function | 233 |
| 20 | `getNotificationSummaryFallback` | function | 253 |
| 21 | `getDriveSyncStatusFallback` | function | 262 |
| 22 | `readNotificationSummaryMissingUntil` | function | 270 |
| 23 | `markNotificationSummaryMissing` | function | 282 |
| 24 | `clearNotificationSummaryMissing` | function | 297 |
| 25 | `readStorageNumber` | function | 306 |
| 26 | `writeStorageNumber` | function | 322 |
| 27 | `clearStorageNumber` | function | 333 |
| 28 | `login` | export function | 345 |
| 29 | `logout` | export function | 348 |
| 30 | `resetPasswordWithOtp` | export function | 351 |
| 31 | `requestPasswordResetEmail` | export function | 354 |
| 32 | `completePasswordReset` | export function | 357 |
| 33 | `updateSessionDuration` | export function | 360 |
| 34 | `getVerificationCapabilities` | export function | 363 |
| 35 | `getSystemConfig` | export function | 366 |
| 36 | `getNotificationSummary` | export function | 369 |
| 37 | `getSystemDebugLog` | export function | 400 |
| 38 | `startSupabaseOauth` | export function | 403 |
| 39 | `completeSupabaseOauth` | export function | 406 |
| 40 | `getAppBootstrap` | export function | 409 |
| 41 | `buildLocalBootstrap` | const arrow | 410 |
| 42 | `getOrganizationBootstrap` | export function | 462 |
| 43 | `searchOrganizations` | export function | 465 |
| 44 | `getCurrentOrganization` | export function | 469 |
| 45 | `getSettings` | export function | 474 |
| 46 | `saveSettings` | export function | 489 |
| 47 | `getCategories` | const arrow | 507 |
| 48 | `updateCategory` | const arrow | 509 |
| 49 | `deleteCategory` | const arrow | 510 |
| 50 | `getUnits` | const arrow | 513 |
| 51 | `updateUnit` | const arrow | 515 |
| 52 | `deleteUnit` | const arrow | 516 |
| 53 | `getBranches` | const arrow | 519 |
| 54 | `updateBranch` | const arrow | 521 |
| 55 | `deleteBranch` | const arrow | 525 |
| 56 | `getTransfers` | const arrow | 530 |
| 57 | `getProducts` | const arrow | 534 |
| 58 | `getCatalogMeta` | export function | 535 |
| 59 | `getCatalogProducts` | export function | 543 |
| 60 | `getPortalConfig` | export function | 551 |
| 61 | `getPortalBootstrap` | export function | 559 |
| 62 | `getPortalCatalogMeta` | export function | 567 |
| 63 | `getPortalCatalogProducts` | export function | 575 |
| 64 | `lookupPortalMembership` | export function | 583 |
| 65 | `createPortalSubmission` | export function | 593 |
| 66 | `getPortalAiStatus` | export function | 607 |
| 67 | `askPortalAi` | export function | 615 |
| 68 | `getPortalSubmissionsForReview` | const arrow | 629 |
| 69 | `reviewPortalSubmission` | const arrow | 631 |
| 70 | `getAiProviders` | const arrow | 634 |
| 71 | `createAiProvider` | const arrow | 636 |
| 72 | `updateAiProvider` | const arrow | 638 |
| 73 | `deleteAiProvider` | const arrow | 640 |
| 74 | `testAiProvider` | const arrow | 642 |
| 75 | `getAiResponses` | const arrow | 644 |
| 76 | `createProduct` | export function | 646 |
| 77 | `updateProduct` | export function | 660 |
| 78 | `deleteProduct` | const arrow | 673 |
| 79 | `buildMultipartHeaders` | function | 690 |
| 80 | `apiFormPost` | function | 703 |
| 81 | `listImportJobs` | const arrow | 722 |
| 82 | `getImportJobReview` | const arrow | 727 |
| 83 | `updateImportJobDecisions` | const arrow | 731 |
| 84 | `deleteImportJob` | const arrow | 737 |
| 85 | `getImportQueueStatus` | const arrow | 756 |
| 86 | `downloadImportJobErrors` | export function | 758 |
| 87 | `uploadImportJobCsv` | export function | 777 |
| 88 | `uploadImportJobZip` | export function | 784 |
| 89 | `uploadImportJobImages` | export function | 791 |
| 90 | `getFiles` | export function | 815 |
| 91 | `uploadFileAsset` | export function | 821 |
| 92 | `deleteFileAsset` | export function | 855 |
| 93 | `uploadProductImage` | export function | 867 |
| 94 | `uploadUserAvatar` | export function | 903 |
| 95 | `openCSVDialog` | export function | 944 |
| 96 | `openImageDialog` | export function | 964 |
| 97 | `getImageDataUrl` | export function | 972 |
| 98 | `getActionHistory` | const arrow | 983 |
| 99 | `updateActionHistory` | const arrow | 987 |
| 100 | `getInventorySummary` | const arrow | 993 |
| 101 | `getInventoryMovements` | const arrow | 994 |
| 102 | `createSale` | export function | 997 |
| 103 | `getSales` | const arrow | 1002 |
| 104 | `getDashboard` | const arrow | 1009 |
| 105 | `getAnalytics` | const arrow | 1010 |
| 106 | `getCustomers` | const arrow | 1019 |
| 107 | `createCustomer` | export function | 1020 |
| 108 | `updateCustomer` | const arrow | 1024 |
| 109 | `deleteCustomer` | const arrow | 1028 |
| 110 | `downloadCustomerTemplate` | const arrow | 1033 |
| 111 | `getSuppliers` | const arrow | 1042 |
| 112 | `createSupplier` | export function | 1043 |
| 113 | `updateSupplier` | const arrow | 1047 |
| 114 | `deleteSupplier` | const arrow | 1051 |
| 115 | `downloadSupplierTemplate` | const arrow | 1056 |
| 116 | `getDeliveryContacts` | const arrow | 1065 |
| 117 | `createDeliveryContact` | export function | 1066 |
| 118 | `updateDeliveryContact` | const arrow | 1070 |
| 119 | `deleteDeliveryContact` | const arrow | 1074 |
| 120 | `getUsers` | const arrow | 1081 |
| 121 | `updateUser` | const arrow | 1083 |
| 122 | `getUserProfile` | const arrow | 1084 |
| 123 | `getUserAuthMethods` | const arrow | 1085 |
| 124 | `updateUserProfile` | const arrow | 1087 |
| 125 | `disconnectUserAuthProvider` | const arrow | 1089 |
| 126 | `changeUserPassword` | const arrow | 1091 |
| 127 | `resetPassword` | const arrow | 1093 |
| 128 | `getRoles` | const arrow | 1096 |
| 129 | `updateRole` | const arrow | 1098 |
| 130 | `deleteRole` | const arrow | 1099 |
| 131 | `getCustomTables` | const arrow | 1102 |
| 132 | `getCustomTableData` | const arrow | 1104 |
| 133 | `insertCustomRow` | const arrow | 1105 |
| 134 | `updateCustomRow` | const arrow | 1106 |
| 135 | `deleteCustomRow` | const arrow | 1107 |
| 136 | `getAuditLogs` | const arrow | 1110 |
| 137 | `exportBackup` | export function | 1113 |
| 138 | `exportBackupFolder` | export function | 1130 |
| 139 | `pickBackupFile` | export function | 1134 |
| 140 | `importBackupData` | export function | 1149 |
| 141 | `importBackupFolder` | export function | 1156 |
| 142 | `importBackup` | export function | 1163 |
| 143 | `getGoogleDriveSyncStatus` | const arrow | 1178 |
| 144 | `saveGoogleDriveSyncPreferences` | const arrow | 1212 |
| 145 | `startGoogleDriveSyncOauth` | const arrow | 1215 |
| 146 | `disconnectGoogleDriveSync` | const arrow | 1218 |
| 147 | `forgetGoogleDriveSyncCredentials` | const arrow | 1221 |
| 148 | `syncGoogleDriveNow` | const arrow | 1224 |
| 149 | `resetData` | export function | 1227 |
| 150 | `factoryReset` | export function | 1234 |
| 151 | `downloadImportTemplate` | export function | 1242 |
| 152 | `openPath` | export function | 1289 |
| 153 | `getReturns` | const arrow | 1298 |
| 154 | `createReturn` | export function | 1304 |
| 155 | `createSupplierReturn` | export function | 1310 |
| 156 | `updateSaleStatus` | const arrow | 1319 |
| 157 | `attachSaleCustomer` | const arrow | 1335 |
| 158 | `getSalesExport` | const arrow | 1359 |
| 159 | `updateReturn` | const arrow | 1363 |
| 160 | `testSyncServer` | export function | 1393 |
| 161 | `openFolderDialog` | export function | 1412 |
| 162 | `getDataPath` | const arrow | 1423 |
| 163 | `getScaleMigrationStatus` | const arrow | 1424 |
| 164 | `prepareScaleMigration` | const arrow | 1425 |
| 165 | `runScaleMigration` | const arrow | 1426 |
| 166 | `setDataPath` | export function | 1427 |
| 167 | `resetDataPath` | export function | 1432 |
| 168 | `browseDir` | const arrow | 1437 |

### 3.102 `frontend/src/api/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `shouldDebugWs` | function | 19 |
| 2 | `logWs` | function | 29 |
| 3 | `connectWS` | export function | 35 |
| 4 | `disconnectWS` | export function | 127 |
| 5 | `reconnectWS` | export function | 136 |
| 6 | `scheduleReconnect` | function | 141 |
| 7 | `isWSConnected` | export function | 157 |

### 3.103 `frontend/src/App.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getChunkErrorMessage` | function | 71 |
| 2 | `isChunkLoadError` | function | 76 |
| 3 | `createChunkTimeoutError` | function | 85 |
| 4 | `isRetryableImportError` | function | 91 |
| 5 | `importWithTimeout` | function | 99 |
| 6 | `clearRetryMarker` | function | 115 |
| 7 | `triggerChunkRecoveryReload` | function | 122 |
| 8 | `createChunkReloadStallError` | function | 132 |
| 9 | `shouldRetryChunk` | function | 138 |
| 10 | `lazyWithRetry` | function | 148 |
| 11 | `getWarmupImporters` | function | 215 |
| 12 | `shouldSkipBackgroundWarmup` | function | 227 |
| 13 | `getDataWarmupLoaders` | function | 236 |
| 14 | `createWarmupLoader` | function | 245 |
| 15 | `runWarmupBatches` | function | 250 |
| 16 | `getPageEntryWarmupLoaders` | function | 259 |
| 17 | `useMountedPages` | function | 266 |
| 18 | `useSyncErrorBanner` | function | 280 |
| 19 | `onSyncError` | const arrow | 285 |
| 20 | `onSyncRecovered` | const arrow | 286 |
| 21 | `useVisibilityRecovery` | function | 307 |
| 22 | `onVisible` | const arrow | 311 |
| 23 | `onFocus` | const arrow | 321 |
| 24 | `useChunkWarmup` | function | 339 |
| 25 | `runWarmup` | const arrow | 352 |
| 26 | `useDataWarmup` | function | 381 |
| 27 | `runWarmup` | const arrow | 392 |
| 28 | `usePageEntryWarmup` | function | 417 |
| 29 | `run` | const arrow | 438 |
| 30 | `PageErrorBoundary` | class | 459 |
| 31 | `Notification` | function | 512 |
| 32 | `SyncErrorBanner` | function | 524 |
| 33 | `ReadOnlyServerBanner` | function | 546 |
| 34 | `PageLoader` | function | 554 |
| 35 | `PageSlot` | function | 581 |
| 36 | `PublicCatalogView` | function | 605 |
| 37 | `App` | export default function | 618 |
| 38 | `loadFavicon` | function | 676 |

### 3.104 `frontend/src/app/appShellUtils.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isPublicCatalogPath` | export function | 9 |
| 2 | `updateMountedPages` | export function | 19 |
| 3 | `getNotificationPrefix` | export function | 29 |
| 4 | `getNotificationColor` | export function | 36 |

### 3.105 `frontend/src/app/publicErrorRecovery.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isPublicDomMutationError` | export function | 3 |
| 2 | `shouldAttemptPublicDomRecovery` | export function | 8 |
| 3 | `clearPublicDomRecoveryMarker` | export function | 19 |

### 3.106 `frontend/src/AppContext.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `flattenTranslationTree` | function | 25 |
| 2 | `safeStorageGet` | function | 81 |
| 3 | `safeStorageSet` | function | 89 |
| 4 | `safeStorageRemove` | function | 95 |
| 5 | `getStoredAuthToken` | function | 101 |
| 6 | `getStoredUserPayload` | function | 105 |
| 7 | `getStoredUserExpiry` | function | 109 |
| 8 | `clearPersistedAuthState` | function | 113 |
| 9 | `persistAuthState` | function | 123 |
| 10 | `computeSessionExpiryMs` | function | 137 |
| 11 | `readDeviceSettings` | function | 153 |
| 12 | `writeDeviceSettings` | function | 161 |
| 13 | `writeStoredSessionDuration` | function | 167 |
| 14 | `readPendingOauthLink` | function | 175 |
| 15 | `clearPendingOauthLink` | function | 189 |
| 16 | `mergeSettingsWithDeviceOverrides` | function | 195 |
| 17 | `normalizeDateInput` | function | 199 |
| 18 | `isBrokenLocalizedString` | export function | 205 |
| 19 | `buildRuntimeDescriptorFromBootstrap` | function | 215 |
| 20 | `LoadingScreen` | function | 243 |
| 21 | `AccessDenied` | function | 256 |
| 22 | `AppProvider` | export function | 268 |
| 23 | `onUpdate` | const arrow | 444 |
| 24 | `onStatus` | const arrow | 472 |
| 25 | `poll` | const arrow | 480 |
| 26 | `onError` | const arrow | 500 |
| 27 | `onWriteBlocked` | const arrow | 504 |
| 28 | `onConflict` | const arrow | 515 |
| 29 | `finalizeUnauthorized` | const arrow | 575 |
| 30 | `onUnauthorized` | const arrow | 591 |
| 31 | `handleOtpLogin` | const arrow | 642 |
| 32 | `handleUserUpdated` | const arrow | 682 |
| 33 | `discoverSyncUrl` | const arrow | 716 |
| 34 | `hexAlpha` | const arrow | 861 |
| 35 | `clearCallbackUrl` | const arrow | 1047 |
| 36 | `clearPendingLink` | const arrow | 1051 |
| 37 | `run` | const arrow | 1055 |
| 38 | `useApp` | const arrow | 1362 |
| 39 | `useSync` | const arrow | 1363 |
| 40 | `useT` | const arrow | 1366 |

### 3.107 `frontend/src/components/auth/Login.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readPendingOauthLogin` | function | 27 |
| 2 | `clearPendingOauthLogin` | function | 41 |
| 3 | `OauthButton` | function | 47 |
| 4 | `ModeBackButton` | function | 61 |
| 5 | `Login` | export default function | 74 |
| 6 | `tr` | const arrow | 76 |
| 7 | `rememberOrganization` | const arrow | 145 |
| 8 | `loadCapabilities` | const arrow | 181 |
| 9 | `bootstrap` | const arrow | 201 |
| 10 | `clearCallbackUrl` | const arrow | 270 |
| 11 | `run` | const arrow | 275 |
| 12 | `rememberedOrg` | const arrow | 306 |
| 13 | `getDeviceContext` | const arrow | 356 |
| 14 | `handleLogin` | const arrow | 358 |
| 15 | `handleOtp` | const arrow | 388 |
| 16 | `handleOtpInput` | const arrow | 422 |
| 17 | `handleResetWithOtp` | const arrow | 427 |
| 18 | `handleResetWithEmail` | const arrow | 464 |
| 19 | `handleCompleteEmailReset` | const arrow | 493 |
| 20 | `handleStartOauth` | const arrow | 526 |
| 21 | `closeAuxMode` | const arrow | 574 |

### 3.108 `frontend/src/components/branches/Branches.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatTransferDate` | function | 31 |
| 2 | `Branches` | export default function | 48 |
| 3 | `promise` | const arrow | 81 |
| 4 | `loadBranchStock` | const arrow | 186 |
| 5 | `handleSaveBranch` | const arrow | 201 |
| 6 | `handleDelete` | const arrow | 254 |
| 7 | `handleBulkDelete` | const arrow | 287 |
| 8 | `toggleSelect` | const arrow | 355 |
| 9 | `toggleSelectAll` | const arrow | 364 |

### 3.109 `frontend/src/components/branches/BranchForm.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BranchForm` | export default function | 11 |
| 2 | `set` | const arrow | 33 |
| 3 | `handleSave` | const arrow | 45 |

### 3.110 `frontend/src/components/branches/TransferModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `TransferModal` | export default function | 17 |
| 2 | `loadStock` | function | 61 |
| 3 | `handleTransfer` | const arrow | 106 |

### 3.111 `frontend/src/components/catalog/CatalogPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getAboutBlockLabel` | function | 77 |
| 2 | `withAssetVersion` | function | 83 |
| 3 | `tt` | function | 806 |
| 4 | `toBoolean` | function | 819 |
| 5 | `toNumber` | function | 826 |
| 6 | `normalizePriceDisplay` | function | 832 |
| 7 | `normalizeHexColor` | function | 837 |
| 8 | `normalizeExternalUrl` | function | 843 |
| 9 | `buildFaqStarterItems` | function | 859 |
| 10 | `buildAiFaqStarterItems` | function | 939 |
| 11 | `hexToRgba` | function | 970 |
| 12 | `readPortalCache` | function | 981 |
| 13 | `writePortalCache` | function | 1004 |
| 14 | `normalizePortalPath` | function | 1023 |
| 15 | `isReservedPortalPath` | function | 1036 |
| 16 | `buildDraft` | function | 1041 |
| 17 | `applyDraft` | function | 1132 |
| 18 | `getBranchQty` | function | 1255 |
| 19 | `getStockStatus` | function | 1262 |
| 20 | `normalizeProductGallery` | function | 1272 |
| 21 | `normalizePortalProductSearch` | function | 1289 |
| 22 | `buildRecommendedProductOption` | function | 1293 |
| 23 | `productMatchesRecommendedSearch` | function | 1303 |
| 24 | `formatDateTime` | function | 1318 |
| 25 | `formatPortalPrice` | function | 1325 |
| 26 | `ImageField` | function | 1338 |
| 27 | `pickImageAsDataUrl` | function | 1398 |
| 28 | `pickMultipleImagesAsDataUrls` | function | 1417 |
| 29 | `replaceVars` | function | 1438 |
| 30 | `getPortalResourceText` | function | 1442 |
| 31 | `isFirstPartyTranslateTarget` | function | 1492 |
| 32 | `normalizePortalTranslateChoice` | function | 1496 |
| 33 | `isDocumentVisible` | function | 1503 |
| 34 | `sleep` | function | 1508 |
| 35 | `CatalogPage` | export default function | 1513 |
| 36 | `copy` | const arrow | 1649 |
| 37 | `resolveVisibleTab` | const arrow | 1661 |
| 38 | `loadAssistantStatus` | function | 1750 |
| 39 | `openProductGallery` | function | 1768 |
| 40 | `changeTranslateTarget` | function | 1781 |
| 41 | `isPortalLoadCurrent` | function | 1829 |
| 42 | `loadPortalEditorData` | function | 1833 |
| 43 | `refreshPortalView` | function | 1862 |
| 44 | `loadPortal` | function | 1891 |
| 45 | `initWidget` | const arrow | 2088 |
| 46 | `waitForWidget` | const arrow | 2106 |
| 47 | `toggleFilterValue` | function | 2230 |
| 48 | `clearPortalFilters` | function | 2238 |
| 49 | `setDraft` | function | 2245 |
| 50 | `toggleRecommendedProduct` | function | 2250 |
| 51 | `openPortalImage` | function | 2259 |
| 52 | `setAboutBlocksDraft` | function | 2270 |
| 53 | `updateAboutBlock` | function | 2274 |
| 54 | `addAboutBlock` | function | 2280 |
| 55 | `moveAboutBlockBefore` | function | 2284 |
| 56 | `removeAboutBlock` | function | 2296 |
| 57 | `setFaqDraft` | function | 2300 |
| 58 | `addFaqItem` | function | 2304 |
| 59 | `mergeFaqStarterItems` | function | 2315 |
| 60 | `addFaqStarterSet` | function | 2328 |
| 61 | `addAiFaqStarterSet` | function | 2332 |
| 62 | `updateFaqItem` | function | 2336 |
| 63 | `removeFaqItem` | function | 2342 |
| 64 | `clearAssistantState` | function | 2346 |
| 65 | `uploadPortalImage` | function | 2361 |
| 66 | `uploadDraftImage` | function | 2380 |
| 67 | `uploadAboutBlockMedia` | function | 2385 |
| 68 | `openFilePicker` | function | 2394 |
| 69 | `handleFilePickerSelect` | function | 2398 |
| 70 | `savePortalDraft` | function | 2414 |
| 71 | `askAssistant` | function | 2543 |
| 72 | `refreshMembershipData` | function | 2587 |
| 73 | `handleMembershipLookup` | function | 2631 |
| 74 | `addSubmissionImages` | function | 2644 |
| 75 | `handleSubmissionPaste` | function | 2654 |
| 76 | `handleSubmitShareProof` | function | 2670 |
| 77 | `handleReviewSubmission` | function | 2714 |
| 78 | `renderCatalogSection` | function | 2859 |
| 79 | `handleUploadSubmissionImages` | const arrow | 2876 |
| 80 | `renderSecondaryTabSection` | function | 2928 |

### 3.112 `frontend/src/components/catalog/CatalogProductsSection.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBadgeIcon` | function | 8 |
| 2 | `getBadgeToneClass` | function | 16 |
| 3 | `getProductInitial` | function | 25 |
| 4 | `CatalogProductsSection` | export default function | 36 |

### 3.113 `frontend/src/components/catalog/CatalogSecondaryTabs.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CatalogMembershipSection` | function | 20 |
| 2 | `CatalogAboutSection` | function | 366 |
| 3 | `CatalogFaqSection` | function | 437 |
| 4 | `CatalogAiSection` | function | 491 |
| 5 | `CatalogSecondaryTabs` | export default function | 677 |

### 3.114 `frontend/src/components/catalog/catalogUi.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `statusClass` | function | 3 |
| 2 | `SectionShell` | export function | 10 |
| 3 | `SummaryTile` | export function | 26 |
| 4 | `StatusPill` | export function | 50 |

### 3.115 `frontend/src/components/catalog/portalCatalogDisplay.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeRecommendedProductIds` | export function | 3 |
| 2 | `getPortalGridClass` | export function | 26 |
| 3 | `getPortalMobileGridClass` | export function | 37 |
| 4 | `productMatchesPortalBranches` | export function | 44 |
| 5 | `getPortalPromotionDetails` | export function | 52 |
| 6 | `buildPortalPricePresentation` | export function | 65 |
| 7 | `buildPortalHighlightBadges` | export function | 79 |
| 8 | `replaceRankVars` | function | 132 |

### 3.116 `frontend/src/components/catalog/portalEditorUtils.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toTrimmedString` | function | 3 |
| 2 | `safeJsonParse` | function | 7 |
| 3 | `createAboutBlock` | export function | 15 |
| 4 | `normalizeAboutBlocks` | export function | 27 |
| 5 | `serializeAboutBlocks` | export function | 47 |
| 6 | `moveListItem` | export function | 51 |
| 7 | `extractGoogleMapsEmbedUrl` | export function | 64 |
| 8 | `normalizeGoogleMapsEmbed` | export function | 72 |

### 3.117 `frontend/src/components/catalog/portalTranslateController.mjs`

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

### 3.118 `frontend/src/components/contacts/contactOptionUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createContactOption` | export function | 3 |
| 2 | `normalizeOption` | function | 15 |
| 3 | `limitContactOptions` | export function | 26 |
| 4 | `parseStoredContactOptions` | export function | 30 |
| 5 | `hasContactOptionData` | export function | 51 |
| 6 | `serializeContactOptions` | export function | 62 |
| 7 | `buildContactOptionSummary` | export function | 69 |
| 8 | `parseContactOptionsFromImportRow` | export function | 78 |
| 9 | `getPrimaryContactOption` | export function | 94 |

### 3.119 `frontend/src/components/contacts/Contacts.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `TABS` | const arrow | 17 |
| 2 | `ImportTypePicker` | function | 23 |
| 3 | `T` | const arrow | 24 |
| 4 | `Contacts` | export default function | 63 |
| 5 | `handleExportAll` | const arrow | 71 |
| 6 | `openImportPicker` | const arrow | 146 |
| 7 | `handleTypeSelected` | const arrow | 148 |
| 8 | `handleImportDone` | const arrow | 153 |

### 3.120 `frontend/src/components/contacts/CustomersTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseContactOptions` | export function | 27 |
| 2 | `serializeContactOptions` | export function | 31 |
| 3 | `tr` | function | 35 |
| 4 | `OptionEditor` | function | 40 |
| 5 | `setField` | const arrow | 41 |
| 6 | `fieldId` | const arrow | 42 |
| 7 | `CustomerForm` | function | 84 |
| 8 | `setField` | const arrow | 96 |
| 9 | `addOption` | const arrow | 97 |
| 10 | `removeOption` | const arrow | 101 |
| 11 | `updateOption` | const arrow | 102 |
| 12 | `handleSubmit` | const arrow | 103 |
| 13 | `CustomersTab` | function | 211 |
| 14 | `toggleSectionCollapsed` | const arrow | 342 |
| 15 | `isSectionFullySelected` | const arrow | 348 |
| 16 | `isSectionPartiallySelected` | const arrow | 349 |
| 17 | `toggleSectionSelection` | const arrow | 350 |
| 18 | `promise` | const arrow | 373 |
| 19 | `handleSave` | const arrow | 438 |
| 20 | `handleDelete` | const arrow | 501 |
| 21 | `handleBulkDelete` | const arrow | 531 |

### 3.121 `frontend/src/components/contacts/DeliveryTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseDeliveryOptions` | export function | 31 |
| 2 | `serializeDeliveryOptions` | export function | 35 |
| 3 | `BLANK_OPTION` | const arrow | 39 |
| 4 | `OptionEditor` | function | 42 |
| 5 | `set` | const arrow | 43 |
| 6 | `fieldId` | const arrow | 44 |
| 7 | `DeliveryForm` | function | 81 |
| 8 | `set` | const arrow | 90 |
| 9 | `addOption` | const arrow | 91 |
| 10 | `updateOption` | const arrow | 95 |
| 11 | `removeOption` | const arrow | 96 |
| 12 | `handleSave` | const arrow | 97 |
| 13 | `OptionsDisplay` | function | 167 |
| 14 | `OptionsBadge` | function | 184 |
| 15 | `DeliveryTab` | function | 195 |
| 16 | `toggleSectionCollapsed` | const arrow | 317 |
| 17 | `isSectionFullySelected` | const arrow | 323 |
| 18 | `isSectionPartiallySelected` | const arrow | 324 |
| 19 | `toggleSectionSelection` | const arrow | 325 |
| 20 | `promise` | const arrow | 346 |
| 21 | `handleSave` | const arrow | 410 |
| 22 | `handleDelete` | const arrow | 460 |
| 23 | `handleBulkDelete` | const arrow | 489 |

### 3.122 `frontend/src/components/contacts/shared.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `useContactSelection` | export function | 14 |
| 2 | `toggleOne` | const arrow | 30 |
| 3 | `clearSelection` | const arrow | 41 |
| 4 | `ThreeDotMenu` | export function | 68 |
| 5 | `menuContent` | const arrow | 76 |
| 6 | `DetailModal` | export function | 139 |
| 7 | `ContactTable` | export function | 170 |
| 8 | `countCsvDataRows` | function | 275 |
| 9 | `ImportModal` | export function | 298 |
| 10 | `loadCsvText` | const arrow | 319 |
| 11 | `handlePickFile` | const arrow | 329 |
| 12 | `handleChooseExistingFile` | const arrow | 335 |
| 13 | `handleDownloadTemplate` | const arrow | 355 |
| 14 | `applyContactRulePreset` | const arrow | 359 |
| 15 | `handleImport` | const arrow | 369 |

### 3.123 `frontend/src/components/contacts/SuppliersTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `SupplierForm` | function | 27 |
| 2 | `set` | const arrow | 43 |
| 3 | `addOption` | const arrow | 44 |
| 4 | `updateOption` | const arrow | 48 |
| 5 | `removeOption` | const arrow | 49 |
| 6 | `handleSubmit` | const arrow | 50 |
| 7 | `SuppliersTab` | function | 137 |
| 8 | `toggleSectionCollapsed` | const arrow | 271 |
| 9 | `isSectionFullySelected` | const arrow | 277 |
| 10 | `isSectionPartiallySelected` | const arrow | 278 |
| 11 | `toggleSectionSelection` | const arrow | 279 |
| 12 | `promise` | const arrow | 302 |
| 13 | `handleSave` | const arrow | 367 |
| 14 | `handleDelete` | const arrow | 422 |
| 15 | `handleBulkDelete` | const arrow | 452 |

### 3.124 `frontend/src/components/custom-tables/CustomTables.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeRowValue` | function | 15 |
| 2 | `buildRowPayload` | function | 28 |
| 3 | `CustomTables` | export default function | 37 |
| 4 | `addColumn` | const arrow | 136 |
| 5 | `updateColumn` | const arrow | 143 |
| 6 | `removeColumn` | const arrow | 152 |
| 7 | `handleCreateTable` | const arrow | 159 |
| 8 | `handleSaveRow` | const arrow | 197 |
| 9 | `handleDeleteRow` | const arrow | 269 |
| 10 | `openAddRow` | const arrow | 305 |
| 11 | `openEditRow` | const arrow | 312 |

### 3.125 `frontend/src/components/dashboard/charts/BarChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BarChart` | export default function | 14 |
| 2 | `yPx` | function | 32 |

### 3.126 `frontend/src/components/dashboard/charts/DonutChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `DonutChart` | export default function | 14 |

### 3.127 `frontend/src/components/dashboard/charts/index.js`

- No top-level named symbols detected.

### 3.128 `frontend/src/components/dashboard/charts/LineChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `LineChart` | export default function | 13 |
| 2 | `xPx` | function | 35 |
| 3 | `yPx` | function | 36 |
| 4 | `handleMouseMove` | const arrow | 41 |

### 3.129 `frontend/src/components/dashboard/charts/NoData.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NoData` | export default function | 7 |

### 3.130 `frontend/src/components/dashboard/Dashboard.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDashboardFilterStorageKey` | function | 24 |
| 2 | `readDashboardFilterPrefs` | function | 29 |
| 3 | `downsampleChartRows` | function | 53 |
| 4 | `Dashboard` | export default function | 64 |
| 5 | `translateOr` | const arrow | 69 |
| 6 | `calcTrend` | const arrow | 260 |
| 7 | `rangeLabel` | const arrow | 286 |
| 8 | `periodShort` | const arrow | 292 |
| 9 | `buildExportAll` | const arrow | 567 |

### 3.131 `frontend/src/components/dashboard/MiniStat.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `MiniStat` | export default function | 2 |

### 3.132 `frontend/src/components/files/FilePickerModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `AssetPreview` | function | 11 |
| 2 | `FilePickerModal` | export default function | 21 |
| 3 | `tr` | const arrow | 41 |
| 4 | `toggleSelectedPath` | function | 82 |
| 5 | `handleUpload` | function | 92 |
| 6 | `handleDelete` | function | 127 |

### 3.133 `frontend/src/components/files/FilesPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `AssetPreview` | function | 32 |
| 2 | `formatDateTime` | function | 46 |
| 3 | `ProviderStatus` | function | 56 |
| 4 | `emptyProviderForm` | function | 67 |
| 5 | `compactTabLabel` | function | 90 |
| 6 | `FilesPage` | export default function | 96 |
| 7 | `tr` | const arrow | 125 |
| 8 | `handleUpload` | function | 303 |
| 9 | `handleDeleteAsset` | function | 319 |
| 10 | `startCreateProvider` | function | 338 |
| 11 | `startEditProvider` | function | 354 |
| 12 | `saveProvider` | function | 379 |
| 13 | `testProvider` | function | 460 |
| 14 | `removeProvider` | function | 474 |
| 15 | `tabButton` | const arrow | 487 |

### 3.134 `frontend/src/components/inventory/DualMoney.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `DualMoney` | function | 5 |

### 3.135 `frontend/src/components/inventory/Inventory.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `reuseSetWhenUnchanged` | function | 32 |
| 2 | `priceCsv` | function | 41 |
| 3 | `Inventory` | export default function | 45 |
| 4 | `tr` | const arrow | 50 |
| 5 | `promise` | const arrow | 101 |
| 6 | `handleAdjust` | const arrow | 214 |
| 7 | `openAdjust` | const arrow | 278 |
| 8 | `openMove` | const arrow | 284 |
| 9 | `handleMoveStock` | const arrow | 306 |
| 10 | `matchesSearch` | const arrow | 377 |
| 11 | `productHay` | const arrow | 384 |
| 12 | `movHay` | const arrow | 387 |

### 3.136 `frontend/src/components/inventory/InventoryImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `countCsvDataRows` | function | 11 |
| 2 | `InventoryImportModal` | export default function | 16 |
| 3 | `tr` | const arrow | 26 |
| 4 | `handlePickFile` | const arrow | 39 |
| 5 | `handleDownloadTemplate` | const arrow | 47 |
| 6 | `handleImport` | const arrow | 51 |

### 3.137 `frontend/src/components/inventory/movementGroups.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `minuteBucket` | function | 1 |
| 2 | `normalizeText` | function | 8 |
| 3 | `buildGroupKey` | function | 12 |
| 4 | `describeMovementType` | function | 27 |
| 5 | `buildMovementGroups` | export function | 38 |
| 6 | `movementGroupHaystack` | export function | 99 |

### 3.138 `frontend/src/components/inventory/ProductDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductDetailModal` | export default function | 5 |
| 2 | `T` | const arrow | 6 |

### 3.139 `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sanitizeInteger` | function | 108 |
| 2 | `sanitizeKhr` | function | 113 |
| 3 | `formatLookupValue` | function | 119 |
| 4 | `LoyaltyPointsPage` | export default function | 123 |
| 5 | `copy` | const arrow | 127 |
| 6 | `setValue` | function | 216 |
| 7 | `handleSave` | function | 220 |
| 8 | `handleLookup` | function | 245 |

### 3.140 `frontend/src/components/navigation/Sidebar.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getFallbackLabel` | function | 49 |
| 2 | `getNavLabel` | function | 57 |
| 3 | `isDarkColor` | function | 73 |
| 4 | `withAlpha` | function | 83 |
| 5 | `mergeStyles` | function | 89 |
| 6 | `Sidebar` | export default function | 93 |

### 3.141 `frontend/src/components/pos/CartItem.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CartItem` | export default function | 3 |

### 3.142 `frontend/src/components/pos/FilterPanel.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `POSFilterPanel` | export default function | 3 |
| 2 | `T` | const arrow | 27 |
| 3 | `clearAll` | const arrow | 38 |
| 4 | `chip` | const arrow | 47 |
| 5 | `SectionLabel` | const arrow | 53 |

### 3.143 `frontend/src/components/pos/POS.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `allTermsMatch` | function | 60 |
| 2 | `POS` | export default function | 65 |
| 3 | `setQuickFilter` | const arrow | 108 |
| 4 | `addNewOrder` | const arrow | 173 |
| 5 | `closeOrder` | const arrow | 185 |
| 6 | `selectCustomer` | const arrow | 444 |
| 7 | `applyCustomerOption` | const arrow | 492 |
| 8 | `clearCustomer` | const arrow | 506 |
| 9 | `handleAddCustomer` | const arrow | 514 |
| 10 | `selectDelivery` | const arrow | 535 |
| 11 | `clearDelivery` | const arrow | 540 |
| 12 | `handleAddDelivery` | const arrow | 542 |
| 13 | `qty` | const arrow | 634 |
| 14 | `addToCart` | function | 802 |
| 15 | `updateQty` | const arrow | 841 |
| 16 | `updatePrice` | const arrow | 849 |
| 17 | `updateItemBranch` | const arrow | 873 |
| 18 | `handleDiscountUsd` | const arrow | 922 |
| 19 | `handleDiscountKhr` | const arrow | 923 |
| 20 | `handleMembershipUnits` | const arrow | 924 |
| 21 | `handleCheckout` | const arrow | 963 |

### 3.144 `frontend/src/components/pos/posCore.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildProductsById` | export function | 4 |
| 2 | `buildVariantChildrenByParentId` | export function | 8 |
| 3 | `getVariantRootProduct` | export function | 20 |
| 4 | `buildVisibleProductCards` | export function | 27 |
| 5 | `getVariantChoices` | export function | 40 |
| 6 | `resolveCartPriceValues` | export function | 48 |
| 7 | `getCartLineId` | export function | 83 |
| 8 | `findMatchingCartLineIndex` | export function | 90 |

### 3.145 `frontend/src/components/pos/ProductImage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductImage` | export default function | 3 |

### 3.146 `frontend/src/components/pos/QuickAddModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `QuickAddModal` | export default function | 4 |
| 2 | `T` | const arrow | 5 |

### 3.147 `frontend/src/components/products/barcodeImageScanner.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readFileAsDataUrl` | function | 1 |
| 2 | `createImageElement` | function | 10 |
| 3 | `loadImageSource` | function | 14 |
| 4 | `scanBarcodeFromImageFile` | export function | 23 |

### 3.148 `frontend/src/components/products/BarcodeScannerModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `stopStream` | function | 24 |
| 2 | `readCameraPermissionState` | function | 30 |
| 3 | `watchCameraPermission` | function | 40 |
| 4 | `handleChange` | const arrow | 44 |
| 5 | `BarcodeScannerModal` | export default function | 53 |

### 3.149 `frontend/src/components/products/barcodeScannerState.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `deriveScannerPresentation` | export function | 1 |

### 3.150 `frontend/src/components/products/BranchStockAdjuster.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BranchStockAdjuster` | export default function | 3 |
| 2 | `T` | const arrow | 20 |
| 3 | `setRow` | const arrow | 26 |
| 4 | `handleSave` | const arrow | 32 |

### 3.151 `frontend/src/components/products/BulkAddStockModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BulkAddStockModal` | function | 5 |
| 2 | `handleSave` | const arrow | 12 |

### 3.152 `frontend/src/components/products/BulkImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBaseName` | function | 12 |
| 2 | `analyzeProductCsvInWorker` | function | 19 |
| 3 | `cleanup` | const arrow | 26 |
| 4 | `getIncomingImageFilenames` | function | 52 |
| 5 | `getExistingImageFilenames` | function | 85 |
| 6 | `csvEscape` | function | 114 |
| 7 | `buildImageOnlyCsv` | function | 119 |
| 8 | `getBrowserImageEntries` | function | 134 |
| 9 | `BulkImportModal` | export default function | 143 |
| 10 | `T` | const arrow | 167 |
| 11 | `resetCsvState` | const arrow | 169 |
| 12 | `pickImageDirectory` | const arrow | 188 |
| 13 | `pickImageZip` | const arrow | 212 |
| 14 | `addLibraryImages` | const arrow | 225 |
| 15 | `buildCsvForImportJob` | const arrow | 241 |
| 16 | `handleCancelCurrentJob` | const arrow | 266 |
| 17 | `handleImageOnlyImport` | const arrow | 282 |
| 18 | `handlePickCSV` | const arrow | 334 |
| 19 | `handleImport` | const arrow | 386 |
| 20 | `toggleConflictSelection` | const arrow | 472 |
| 21 | `toggleSelectAllConflicts` | const arrow | 481 |
| 22 | `applyDecisionToSelection` | const arrow | 489 |
| 23 | `applyImageDecisionToSelection` | const arrow | 499 |
| 24 | `applyIdentifierDecisionToSelection` | const arrow | 509 |
| 25 | `applyFieldRulePreset` | const arrow | 519 |

### 3.153 `frontend/src/components/products/HeaderActions.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductsHeaderActions` | export default function | 5 |
| 2 | `tr` | const arrow | 16 |

### 3.154 `frontend/src/components/products/ManageBrandsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseBrandOptions` | function | 5 |
| 2 | `toTitleCase` | function | 18 |
| 3 | `normalizeLookup` | function | 26 |
| 4 | `ManageBrandsModal` | export default function | 30 |
| 5 | `saveLibrary` | const arrow | 63 |
| 6 | `addLibraryBrand` | const arrow | 79 |
| 7 | `renameBrand` | const arrow | 101 |
| 8 | `removeBrand` | const arrow | 146 |

### 3.155 `frontend/src/components/products/ManageCategoriesModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ManageCategoriesModal` | export default function | 13 |
| 2 | `handleAdd` | const arrow | 48 |
| 3 | `handleUpdate` | const arrow | 68 |
| 4 | `handleDelete` | const arrow | 91 |

### 3.156 `frontend/src/components/products/ManageUnitsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ManageUnitsModal` | export default function | 7 |
| 2 | `load` | const arrow | 19 |
| 3 | `handleAdd` | const arrow | 37 |
| 4 | `handleUpdate` | const arrow | 57 |
| 5 | `handleDelete` | const arrow | 76 |

### 3.157 `frontend/src/components/products/primitives.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sanitizeNumericInput` | function | 7 |
| 2 | `parseNumericInput` | function | 17 |
| 3 | `ProductImg` | function | 23 |
| 4 | `loadImageData` | function | 60 |
| 5 | `ProductImagePlaceholder` | function | 94 |
| 6 | `MarginCard` | function | 102 |
| 7 | `DualPriceInput` | function | 134 |
| 8 | `handleUsdChange` | const arrow | 135 |
| 9 | `handleKhrChange` | const arrow | 136 |

### 3.158 `frontend/src/components/products/ProductDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductDetailModal` | export default function | 6 |
| 2 | `T` | const arrow | 18 |
| 3 | `Row` | const arrow | 33 |

### 3.159 `frontend/src/components/products/ProductForm.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeGallery` | function | 16 |
| 2 | `editablePrice` | function | 32 |
| 3 | `pickImageFiles` | function | 37 |
| 4 | `ProductForm` | export default function | 56 |
| 5 | `tr` | const arrow | 138 |
| 6 | `loadSuppliers` | function | 180 |
| 7 | `setField` | function | 200 |
| 8 | `setNumericField` | function | 204 |
| 9 | `addImages` | function | 208 |
| 10 | `addPhoto` | function | 213 |
| 11 | `uploadPickedImages` | function | 218 |
| 12 | `removeImage` | function | 250 |
| 13 | `setPrimaryImage` | function | 254 |
| 14 | `saveForm` | function | 264 |
| 15 | `openScanner` | function | 311 |
| 16 | `closeScanner` | function | 316 |
| 17 | `applyScannedValue` | function | 320 |

### 3.160 `frontend/src/components/products/productHistoryHelpers.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `orderProductRestoreSnapshots` | export function | 1 |
| 2 | `createProductHistoryRequestId` | export function | 35 |

### 3.161 `frontend/src/components/products/productImportPlanner.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeText` | function | 79 |
| 2 | `normalizeImportProductName` | export function | 83 |
| 3 | `normalizeComparableText` | function | 87 |
| 4 | `normalizeFlag` | function | 91 |
| 5 | `normalizeProductImportRow` | export function | 99 |
| 6 | `normalizeProductForSignature` | function | 139 |
| 7 | `getProductImportDetailSignature` | export function | 164 |
| 8 | `chooseParentProduct` | function | 176 |
| 9 | `buildExistingIndex` | function | 192 |
| 10 | `analyzeProductImportRows` | export function | 210 |
| 11 | `analyzeProductImportText` | export function | 326 |

### 3.162 `frontend/src/components/products/productImportWorker.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `post` | function | 3 |

### 3.163 `frontend/src/components/products/Products.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `multiMatch` | function | 40 |
| 2 | `ThreeDot` | function | 44 |
| 3 | `getScrollContainer` | function | 65 |
| 4 | `scrollNodeWithOffset` | function | 77 |
| 5 | `Products` | export default function | 93 |
| 6 | `promise` | const arrow | 149 |
| 7 | `handleSave` | const arrow | 235 |
| 8 | `normalizeGallery` | const arrow | 256 |
| 9 | `uploadGalleryImages` | const arrow | 272 |
| 10 | `handleSaveWithGallery` | const arrow | 294 |
| 11 | `handleBulkDelete` | const arrow | 358 |
| 12 | `handleBulkOutOfStock` | const arrow | 406 |
| 13 | `handleBulkChangeBranch` | const arrow | 449 |
| 14 | `handleBulkAddStock` | const arrow | 479 |
| 15 | `toggleSelect` | const arrow | 487 |
| 16 | `toggleSelectAll` | const arrow | 494 |
| 17 | `handleDelete` | const arrow | 501 |
| 18 | `resolveImageUrl` | const arrow | 550 |
| 19 | `getProductGallery` | const arrow | 561 |
| 20 | `renderUnitChip` | const arrow | 562 |
| 21 | `openLightbox` | const arrow | 576 |
| 22 | `getStockBadge` | const arrow | 592 |
| 23 | `toImageName` | const arrow | 643 |
| 24 | `toImageUrl` | const arrow | 644 |
| 25 | `priceCsv` | const arrow | 645 |

### 3.164 `frontend/src/components/products/scanbotScanner.mjs`

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

### 3.165 `frontend/src/components/products/VariantFormModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `VariantFormModal` | export default function | 8 |
| 2 | `tr` | const arrow | 10 |
| 3 | `setField` | const arrow | 36 |
| 4 | `setNumeric` | const arrow | 37 |
| 5 | `handleSave` | const arrow | 39 |

### 3.166 `frontend/src/components/receipt-settings/AllFieldsPanel.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Toggle` | function | 5 |
| 2 | `AllFieldsPanel` | export default function | 21 |
| 3 | `T` | const arrow | 23 |
| 4 | `toggleSection` | const arrow | 42 |

### 3.167 `frontend/src/components/receipt-settings/constants.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getFieldItems` | export function | 52 |
| 2 | `T` | const arrow | 53 |

### 3.168 `frontend/src/components/receipt-settings/ErrorBoundary.jsx`

- No top-level named symbols detected.

### 3.169 `frontend/src/components/receipt-settings/FieldOrderManager.jsx`

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

### 3.170 `frontend/src/components/receipt-settings/PrintSettings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Section` | function | 5 |
| 2 | `buildFallbackPreviewHtml` | function | 17 |
| 3 | `buildSafePreviewSource` | function | 35 |
| 4 | `PrintSettings` | export default function | 46 |
| 5 | `T` | const arrow | 47 |
| 6 | `setValue` | const arrow | 56 |
| 7 | `resetMargins` | const arrow | 64 |
| 8 | `getPreviewSource` | const arrow | 79 |

### 3.171 `frontend/src/components/receipt-settings/ReceiptPreview.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ReceiptPreview` | export default function | 9 |
| 2 | `loadPreview` | function | 20 |

### 3.172 `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Section` | function | 15 |
| 2 | `Toggle` | function | 26 |
| 3 | `ReceiptSettings` | export default function | 41 |
| 4 | `handleSave` | const arrow | 155 |

### 3.173 `frontend/src/components/receipt-settings/template.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseReceiptTemplate` | export function | 3 |
| 2 | `serializeReceiptTemplate` | export function | 14 |

### 3.174 `frontend/src/components/receipt/Receipt.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `stripEmoji` | function | 8 |
| 2 | `displayAddress` | function | 13 |
| 3 | `parseItems` | function | 22 |
| 4 | `labelFor` | function | 114 |
| 5 | `Row` | function | 119 |
| 6 | `Receipt` | export default function | 131 |
| 7 | `em` | const arrow | 142 |
| 8 | `exportReceiptPdf` | const arrow | 338 |

### 3.175 `frontend/src/components/returns/EditReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `EditReturnModal` | function | 6 |
| 2 | `T` | const arrow | 8 |
| 3 | `updateQty` | const arrow | 33 |
| 4 | `updateRestock` | const arrow | 36 |
| 5 | `handleSubmit` | const arrow | 44 |

### 3.176 `frontend/src/components/returns/NewReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NewReturnModal` | function | 13 |
| 2 | `T` | const arrow | 15 |
| 3 | `handleSearch` | const arrow | 42 |
| 4 | `handleReturnTypeChange` | const arrow | 95 |
| 5 | `toggleIncluded` | const arrow | 100 |
| 6 | `updateItemQty` | const arrow | 108 |
| 7 | `updateItemRestock` | const arrow | 116 |
| 8 | `selectAll` | const arrow | 120 |
| 9 | `clearAll` | const arrow | 123 |
| 10 | `handleSubmit` | const arrow | 130 |

### 3.177 `frontend/src/components/returns/NewSupplierReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NewSupplierReturnModal` | export default function | 10 |
| 2 | `tr` | const arrow | 12 |
| 3 | `loadSetup` | function | 45 |
| 4 | `loadInventory` | function | 86 |
| 5 | `updateQty` | const arrow | 150 |
| 6 | `submit` | const arrow | 156 |

### 3.178 `frontend/src/components/returns/ReturnDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeScope` | function | 6 |
| 2 | `ReturnDetailModal` | export default function | 10 |
| 3 | `tr` | const arrow | 12 |

### 3.179 `frontend/src/components/returns/Returns.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeScope` | function | 25 |
| 2 | `getReturnTypeKey` | function | 29 |
| 3 | `getReturnTypeLabel` | function | 35 |
| 4 | `exportReturnRows` | function | 43 |
| 5 | `Returns` | export default function | 61 |
| 6 | `promise` | const arrow | 100 |
| 7 | `handleOpenEdit` | const arrow | 165 |
| 8 | `renderAmount` | const arrow | 443 |

### 3.180 `frontend/src/components/sales/ExportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ExportModal` | export default function | 6 |
| 2 | `tr` | const arrow | 13 |
| 3 | `computeDates` | const arrow | 18 |
| 4 | `validateDates` | const arrow | 37 |
| 5 | `downloadCsvBlob` | const arrow | 45 |
| 6 | `buildCsvFallback` | const arrow | 55 |
| 7 | `escape` | const arrow | 59 |
| 8 | `handlePreview` | const arrow | 80 |
| 9 | `handleExportCSV` | const arrow | 93 |

### 3.181 `frontend/src/components/sales/SaleDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `InfoBlock` | function | 5 |
| 2 | `parseItems` | function | 21 |
| 3 | `SaleDetailModal` | export default function | 31 |
| 4 | `translateOr` | const arrow | 47 |
| 5 | `handleStatusUpdate` | const arrow | 69 |
| 6 | `handleMembershipAttach` | const arrow | 80 |

### 3.182 `frontend/src/components/sales/Sales.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `multiMatch` | function | 25 |
| 2 | `getSaleBranchLabel` | function | 29 |
| 3 | `Sales` | export default function | 37 |
| 4 | `promise` | const arrow | 78 |
| 5 | `handleStatusChange` | const arrow | 144 |
| 6 | `handleAttachMembership` | const arrow | 179 |
| 7 | `toggleSelected` | const arrow | 330 |
| 8 | `toggleSelectAll` | const arrow | 336 |
| 9 | `handleExportSelected` | const arrow | 367 |
| 10 | `handleBulkStatusUpdate` | const arrow | 419 |

### 3.183 `frontend/src/components/sales/SalesImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `countCsvDataRows` | function | 11 |
| 2 | `SalesImportModal` | export default function | 16 |
| 3 | `tr` | const arrow | 26 |
| 4 | `handlePickFile` | const arrow | 39 |
| 5 | `handleDownloadTemplate` | const arrow | 47 |
| 6 | `handleImport` | const arrow | 51 |

### 3.184 `frontend/src/components/sales/StatusBadge.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getStatusLabel` | export function | 23 |
| 2 | `StatusBadge` | export default function | 39 |

### 3.185 `frontend/src/components/server/ServerPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `useLocalCopy` | function | 22 |
| 2 | `isAutoDetected` | function | 32 |
| 3 | `StatusRow` | function | 39 |
| 4 | `InfoTab` | function | 51 |
| 5 | `fmt` | const arrow | 116 |
| 6 | `DiagnosticsPanel` | function | 202 |
| 7 | `onErr` | const arrow | 240 |
| 8 | `onQueueChanged` | const arrow | 244 |
| 9 | `handleRetryQueue` | function | 286 |
| 10 | `ServerPage` | export default function | 440 |
| 11 | `check` | const arrow | 466 |
| 12 | `loadSecurityConfig` | const arrow | 492 |
| 13 | `handleTest` | function | 504 |
| 14 | `handleSave` | function | 526 |
| 15 | `handleDisconnect` | function | 533 |

### 3.186 `frontend/src/components/shared/ActionHistoryBar.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatHistoryList` | function | 5 |
| 2 | `formatServerStatus` | function | 9 |
| 3 | `ActionHistoryBar` | export default function | 16 |
| 4 | `T` | const arrow | 26 |

### 3.187 `frontend/src/components/shared/BackgroundImportTracker.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeJobStatus` | function | 11 |
| 2 | `dedupeJobsById` | function | 15 |
| 3 | `isRecent` | function | 27 |
| 4 | `getJobProgressDetails` | function | 33 |
| 5 | `getJobLabel` | function | 87 |
| 6 | `getJobResultSummary` | function | 93 |
| 7 | `add` | const arrow | 96 |
| 8 | `getRowsDisplay` | function | 109 |
| 9 | `buildJobsSignature` | function | 120 |
| 10 | `BackgroundImportTracker` | export default function | 135 |
| 11 | `handleCancel` | const arrow | 228 |
| 12 | `handleRetry` | const arrow | 242 |
| 13 | `handleApprove` | const arrow | 256 |
| 14 | `handleDownloadErrors` | const arrow | 270 |
| 15 | `handleRemove` | const arrow | 282 |

### 3.188 `frontend/src/components/shared/ExportMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ExportMenu` | export default function | 4 |

### 3.189 `frontend/src/components/shared/FilterMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sectionButtonClass` | function | 4 |
| 2 | `FilterMenu` | export default function | 10 |

### 3.190 `frontend/src/components/shared/ImageGalleryLightbox.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ImageGalleryLightbox` | export default function | 8 |
| 2 | `formatLabel` | function | 30 |
| 3 | `setIndex` | function | 34 |
| 4 | `renderGalleryImage` | function | 40 |
| 5 | `onKeyDown` | function | 47 |

### 3.191 `frontend/src/components/shared/Modal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Modal` | export default function | 10 |

### 3.192 `frontend/src/components/shared/navigationConfig.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseNavSetting` | export function | 23 |
| 2 | `orderNavItems` | export function | 32 |

### 3.193 `frontend/src/components/shared/NotificationCenter.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `preferenceValue` | function | 103 |
| 2 | `matchesVisibilityMode` | function | 110 |
| 3 | `getRealertMs` | function | 117 |
| 4 | `NotificationCenter` | export default function | 123 |
| 5 | `syncVisibility` | const arrow | 157 |
| 6 | `onVisible` | const arrow | 213 |
| 7 | `handleClickOutside` | const arrow | 236 |

### 3.194 `frontend/src/components/shared/pageActivity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `useIsPageActive` | export function | 4 |

### 3.195 `frontend/src/components/shared/PageHeader.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PageHeader` | export default function | 9 |

### 3.196 `frontend/src/components/shared/PageHelpButton.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PageHelpButton` | export default function | 6 |

### 3.197 `frontend/src/components/shared/pageHelpContent.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getPageHelpContent` | export function | 442 |

### 3.198 `frontend/src/components/shared/PaginationControls.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `clampPage` | export function | 5 |
| 2 | `paginateItems` | export function | 11 |
| 3 | `PaginationControls` | export default function | 19 |

### 3.199 `frontend/src/components/shared/PortalMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PortalMenu` | export default function | 11 |
| 2 | `closeIfClickedOutside` | const arrow | 63 |
| 3 | `closeMenu` | const arrow | 70 |
| 4 | `scheduleReposition` | const arrow | 71 |
| 5 | `closeIfEscape` | const arrow | 78 |
| 6 | `ThreeDotPortal` | export function | 180 |

### 3.200 `frontend/src/components/shared/QuickPreferenceToggles.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ToggleButton` | function | 4 |
| 2 | `QuickPreferenceToggles` | export default function | 23 |
| 3 | `tr` | const arrow | 25 |

### 3.201 `frontend/src/components/shared/WriteConflictModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatConflictTime` | function | 3 |
| 2 | `summarizeCurrentValue` | function | 10 |
| 3 | `formatValue` | function | 66 |
| 4 | `getConflictFieldRows` | function | 73 |
| 5 | `WriteConflictModal` | export default function | 171 |

### 3.202 `frontend/src/components/users/PermissionEditor.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PermissionEditor` | export default function | 15 |
| 2 | `translate` | const arrow | 16 |
| 3 | `labelFor` | const arrow | 22 |
| 4 | `toggle` | const arrow | 25 |

### 3.203 `frontend/src/components/users/UserDetailSheet.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `translateLabel` | function | 4 |
| 2 | `buildRowData` | function | 9 |
| 3 | `UserDetailSheet` | export default function | 21 |

### 3.204 `frontend/src/components/users/UserProfileModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `AvatarPreview` | function | 20 |
| 2 | `ProfileSectionButton` | function | 38 |
| 3 | `clamp` | function | 148 |
| 4 | `loadImageElement` | function | 152 |
| 5 | `renderAvatarCropBlob` | function | 162 |
| 6 | `AvatarEditorModal` | function | 188 |
| 7 | `UserProfileModal` | export default function | 249 |
| 8 | `tr` | const arrow | 253 |
| 9 | `loadProfile` | const arrow | 324 |
| 10 | `handleProfileSave` | const arrow | 397 |
| 11 | `handlePasswordSave` | const arrow | 458 |
| 12 | `handleSessionSave` | const arrow | 494 |
| 13 | `refreshOtpState` | const arrow | 514 |
| 14 | `handleAvatarPick` | const arrow | 526 |
| 15 | `resetAvatarEditor` | const arrow | 528 |
| 16 | `openAvatarEditor` | const arrow | 534 |
| 17 | `closeAvatarEditor` | const arrow | 542 |
| 18 | `handleStartOauthLink` | const arrow | 552 |
| 19 | `handleDisconnectOauthProvider` | const arrow | 591 |
| 20 | `handleAvatarSelected` | const arrow | 639 |
| 21 | `saveAvatarFromEditor` | const arrow | 659 |

### 3.205 `frontend/src/components/users/Users.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ThreeDot` | function | 32 |
| 2 | `formatContactValue` | function | 67 |
| 3 | `Users` | export default function | 72 |
| 4 | `canManageTargetUser` | const arrow | 111 |
| 5 | `promise` | const arrow | 123 |
| 6 | `openCreateUser` | const arrow | 239 |
| 7 | `openEditUser` | const arrow | 246 |
| 8 | `openCreateRole` | const arrow | 263 |
| 9 | `openEditRole` | const arrow | 270 |
| 10 | `getRolePermissions` | const arrow | 281 |
| 11 | `getPermissionSummary` | const arrow | 290 |
| 12 | `handleSaveUser` | const arrow | 328 |
| 13 | `handleResetPassword` | const arrow | 396 |
| 14 | `handleSaveRole` | const arrow | 448 |
| 15 | `handleDeleteRole` | const arrow | 521 |

### 3.206 `frontend/src/components/utils-settings/AuditLog.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toIso` | function | 42 |
| 2 | `formatDateTime` | function | 48 |
| 3 | `formatLogTime` | function | 66 |
| 4 | `getLogEpoch` | function | 70 |
| 5 | `formatJsonPretty` | function | 77 |
| 6 | `parseLogJson` | function | 85 |
| 7 | `flattenSummaryValue` | function | 93 |
| 8 | `formatEntityName` | function | 112 |
| 9 | `readableSummary` | function | 118 |
| 10 | `DetailRow` | function | 138 |
| 11 | `AuditLog` | export default function | 150 |
| 12 | `sessionEntryLabel` | function | 423 |

### 3.207 `frontend/src/components/utils-settings/Backup.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PathActionButton` | function | 76 |
| 2 | `PrimaryActionButton` | function | 88 |
| 3 | `useCopy` | function | 100 |
| 4 | `buildPathCrumbs` | function | 110 |
| 5 | `buildFinalDataFolderPath` | function | 128 |
| 6 | `formatDateTime` | function | 141 |
| 7 | `formatBytes` | function | 156 |
| 8 | `countBackupRows` | function | 165 |
| 9 | `buildBackupPreview` | function | 175 |
| 10 | `yieldToBrowser` | function | 217 |
| 11 | `parseBackupJsonFile` | function | 222 |
| 12 | `SectionChip` | function | 264 |
| 13 | `FolderBrowserPanel` | function | 279 |
| 14 | `DataFolderLocation` | function | 392 |
| 15 | `openBrowser` | const arrow | 448 |
| 16 | `openDriveBrowser` | const arrow | 461 |
| 17 | `pickFolderNatively` | const arrow | 465 |
| 18 | `openInlinePicker` | const arrow | 493 |
| 19 | `openInExplorer` | const arrow | 501 |
| 20 | `selectDir` | const arrow | 516 |
| 21 | `handleApply` | const arrow | 522 |
| 22 | `handleReset` | const arrow | 551 |
| 23 | `GoogleDriveSyncSection` | function | 694 |
| 24 | `handler` | const arrow | 796 |
| 25 | `savePreferences` | const arrow | 812 |
| 26 | `connectGoogleDrive` | const arrow | 837 |
| 27 | `syncNow` | const arrow | 877 |
| 28 | `disconnect` | const arrow | 901 |
| 29 | `forgetCredentials` | const arrow | 922 |
| 30 | `ScaleMigrationSection` | function | 1090 |
| 31 | `prepare` | const arrow | 1118 |
| 32 | `Backup` | export default function | 1231 |
| 33 | `loadHostConfig` | function | 1264 |
| 34 | `browseServerFolders` | const arrow | 1278 |
| 35 | `toggleServerBrowser` | const arrow | 1300 |
| 36 | `handleExport` | const arrow | 1314 |
| 37 | `pickFolder` | const arrow | 1335 |
| 38 | `handleFolderExport` | const arrow | 1348 |
| 39 | `handleFolderImport` | const arrow | 1373 |
| 40 | `handleChooseImportFile` | const arrow | 1401 |
| 41 | `handleConfirmImport` | const arrow | 1421 |

### 3.208 `frontend/src/components/utils-settings/FontFamilyPicker.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `FontFamilyPicker` | function | 20 |

### 3.209 `frontend/src/components/utils-settings/index.js`

- No top-level named symbols detected.

### 3.210 `frontend/src/components/utils-settings/OtpModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `OtpModal` | export default function | 12 |
| 2 | `loadSetup` | function | 47 |

### 3.211 `frontend/src/components/utils-settings/ResetData.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ConfirmReset` | function | 6 |
| 2 | `T` | const arrow | 19 |
| 3 | `ResetData` | function | 87 |
| 4 | `T` | const arrow | 89 |
| 5 | `doReset` | const arrow | 116 |
| 6 | `FactoryReset` | function | 181 |
| 7 | `T` | const arrow | 183 |
| 8 | `doFactoryReset` | function | 189 |

### 3.212 `frontend/src/components/utils-settings/Settings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseStoredColors` | function | 94 |
| 2 | `buildColorChoices` | function | 105 |
| 3 | `useCopy` | function | 196 |
| 4 | `getSettingsNavLabel` | function | 204 |
| 5 | `SwatchPicker` | function | 221 |
| 6 | `SettingsSection` | function | 304 |
| 7 | `Settings` | export default function | 334 |
| 8 | `loadOtpStatus` | function | 403 |
| 9 | `loadFaviconPreview` | function | 428 |
| 10 | `setValue` | const arrow | 478 |
| 11 | `formatPreviewDateTime` | const arrow | 497 |
| 12 | `moveNavItem` | const arrow | 513 |
| 13 | `toggleMobilePinned` | const arrow | 523 |
| 14 | `movePinnedItem` | const arrow | 535 |
| 15 | `movePinnedBefore` | const arrow | 545 |
| 16 | `resetNavigationLayout` | const arrow | 557 |
| 17 | `field` | const arrow | 562 |
| 18 | `savePaymentMethods` | const arrow | 584 |
| 19 | `uploadImageSetting` | const arrow | 589 |
| 20 | `handleSaveSettings` | const arrow | 616 |

### 3.213 `frontend/src/constants.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createEmptyOrder` | export function | 127 |
| 2 | `formatDate` | export function | 157 |
| 3 | `isNetworkError` | export function | 177 |

### 3.214 `frontend/src/index.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `disableServiceWorkerCaching` | function | 12 |
| 2 | `cleanup` | const arrow | 15 |
| 3 | `installFormFieldAccessibility` | function | 41 |
| 4 | `escapeSelectorValue` | const arrow | 46 |
| 5 | `wireField` | const arrow | 51 |
| 6 | `scan` | const arrow | 73 |
| 7 | `safeInsertRule` | const function | 111 |
| 8 | `safeCssRulesGetter` | const function | 128 |
| 9 | `stopKnownStartupNoise` | const arrow | 144 |

### 3.215 `frontend/src/platform/runtime/clientRuntime.js`

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

### 3.216 `frontend/src/platform/storage/storagePolicy.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `shouldPersistLocalMirror` | export function | 22 |
| 2 | `maxStoredNumber` | export function | 26 |
| 3 | `isCooldownActive` | export function | 33 |

### 3.217 `frontend/src/runtime/runtimeErrorClassifier.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toText` | function | 8 |
| 2 | `includesExtensionOrigin` | function | 12 |
| 3 | `getPathname` | function | 17 |
| 4 | `isFirstPartyBuiltAssetSource` | export function | 27 |
| 5 | `isLikelyInjectedRuntimeSource` | export function | 37 |
| 6 | `isKnownBridgeMessage` | export function | 48 |
| 7 | `isKnownStyleInjectionNoise` | export function | 57 |
| 8 | `isKnownEvalCspNoise` | export function | 76 |
| 9 | `shouldSuppressRuntimeError` | export function | 83 |
| 10 | `shouldSuppressSecurityPolicyViolation` | export function | 105 |
| 11 | `isGuardableStyleSheetError` | export function | 119 |

### 3.218 `frontend/src/utils/actionHistory.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeEntry` | function | 3 |
| 2 | `useActionHistory` | export function | 16 |

### 3.219 `frontend/src/utils/appRefresh.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `refreshAppData` | export function | 18 |

### 3.220 `frontend/src/utils/color.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeHex` | function | 1 |
| 2 | `relativeLuminance` | function | 12 |
| 3 | `getContrastingTextColor` | export function | 27 |

### 3.221 `frontend/src/utils/csv.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `escapeCsvValue` | function | 6 |
| 2 | `buildCSV` | export function | 17 |
| 3 | `downloadBlob` | export function | 26 |
| 4 | `downloadCSV` | export function | 40 |
| 5 | `CRC32_TABLE` | const arrow | 46 |
| 6 | `crc32` | function | 58 |
| 7 | `writeUint16` | function | 66 |
| 8 | `writeUint32` | function | 70 |
| 9 | `encodeZipTimestamp` | function | 74 |
| 10 | `buildZip` | export function | 87 |
| 11 | `downloadZipFiles` | export function | 163 |

### 3.222 `frontend/src/utils/csvImport.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `stripBom` | function | 7 |
| 2 | `normalizeDigit` | function | 11 |
| 3 | `normalizeNumericText` | export function | 19 |
| 4 | `countDelimiter` | function | 26 |
| 5 | `detectCsvDelimiter` | export function | 45 |
| 6 | `splitCsvLine` | export function | 53 |
| 7 | `parseDelimitedRows` | export function | 86 |
| 8 | `normalizeCsvKey` | export function | 131 |
| 9 | `parseCsvRows` | export function | 139 |
| 10 | `removeCurrencyNoise` | function | 158 |
| 11 | `normalizeNumberSeparators` | function | 165 |
| 12 | `parseCsvNumber` | export function | 201 |
| 13 | `parseRequiredCsvNumber` | export function | 211 |
| 14 | `normalizeCsvMoney` | export function | 220 |
| 15 | `normalizeCsvPercent` | export function | 224 |

### 3.223 `frontend/src/utils/dateHelpers.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `todayStr` | export function | 10 |
| 2 | `offsetDate` | export function | 20 |

### 3.224 `frontend/src/utils/deviceInfo.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getClientDeviceInfo` | export function | 1 |
| 2 | `getClientMetaHeaders` | export function | 24 |

### 3.225 `frontend/src/utils/exportPackage.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildReportManifestRows` | export function | 3 |
| 2 | `buildReportPackageFiles` | export function | 11 |

### 3.226 `frontend/src/utils/exportReports.jsx`

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

### 3.227 `frontend/src/utils/favicon.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `clamp` | function | 1 |
| 2 | `loadImage` | function | 5 |
| 3 | `createCircularFaviconDataUrl` | export function | 19 |

### 3.228 `frontend/src/utils/formatters.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fmtTime` | export function | 9 |
| 2 | `fmtDate` | export function | 25 |
| 3 | `fmtShort` | export function | 39 |
| 4 | `fmtCount` | export function | 51 |

### 3.229 `frontend/src/utils/groupedRecords.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toDate` | function | 1 |
| 2 | `normalizeName` | function | 20 |
| 3 | `getAlphabetInitialSection` | export function | 24 |
| 4 | `compareAlphabetLabels` | function | 33 |
| 5 | `getTimeParts` | export function | 47 |
| 6 | `matchesYearMonthFilters` | export function | 79 |
| 7 | `getAvailableYears` | export function | 86 |
| 8 | `getTimeGroupingMode` | export function | 95 |
| 9 | `buildTimeActionSections` | export function | 101 |
| 10 | `getSortTime` | const arrow | 113 |
| 11 | `compareItemsByTime` | const arrow | 118 |
| 12 | `buildAlphabetActionSections` | export function | 224 |
| 13 | `compareItems` | const arrow | 245 |
| 14 | `toggleIdSet` | export function | 273 |

### 3.230 `frontend/src/utils/historyHelpers.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cloneHistorySnapshot` | export function | 1 |
| 2 | `extractHistoryResultId` | export function | 6 |
| 3 | `resolveCreatedHistorySnapshot` | export function | 16 |

### 3.231 `frontend/src/utils/index.js`

- No top-level named symbols detected.

### 3.232 `frontend/src/utils/loaders.mjs`

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

### 3.233 `frontend/src/utils/pricing.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toFiniteNumber` | export function | 1 |
| 2 | `roundUpToDecimals` | export function | 6 |
| 3 | `normalizePriceValue` | export function | 15 |
| 4 | `formatPriceNumber` | export function | 19 |
| 5 | `normalizeDiscountPercent` | export function | 26 |
| 6 | `normalizeDiscountType` | export function | 31 |
| 7 | `isProductDiscountActive` | export function | 35 |
| 8 | `calculateProductDiscount` | export function | 48 |

### 3.234 `frontend/src/utils/printReceipt.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parsePrintNumber` | function | 12 |
| 2 | `cloneElementWithInlineStyles` | function | 85 |
| 3 | `escapeHtml` | function | 108 |
| 4 | `blobToDataUrl` | function | 117 |
| 5 | `inlineImageNodeSources` | function | 126 |
| 6 | `extractUrlsFromCssValue` | function | 149 |
| 7 | `inlineStyleAssetUrls` | function | 155 |
| 8 | `normalizePrintableRoot` | function | 189 |
| 9 | `mmToPt` | function | 206 |
| 10 | `dataUrlToBytes` | function | 210 |
| 11 | `joinPdfChunks` | function | 220 |
| 12 | `buildPdfStream` | function | 231 |
| 13 | `buildSingleImagePdf` | function | 240 |
| 14 | `escapePdfText` | function | 278 |
| 15 | `wrapTextLine` | function | 285 |
| 16 | `buildTextOnlyPdf` | function | 304 |
| 17 | `buildReceiptFileName` | function | 357 |
| 18 | `waitForElementAssets` | function | 367 |
| 19 | `renderElementToCanvas` | function | 396 |
| 20 | `withReceiptElement` | function | 461 |
| 21 | `createPrintableReceiptMarkup` | function | 500 |
| 22 | `buildPrintablePreviewDocument` | function | 514 |
| 23 | `openPrintableReceiptPreview` | export function | 658 |
| 24 | `downloadBlob` | function | 670 |
| 25 | `getPrintSettings` | export function | 681 |
| 26 | `savePrintSettings` | export function | 689 |
| 27 | `getPaperWidthMm` | export function | 695 |
| 28 | `createReceiptPdfBlob` | export function | 705 |
| 29 | `buildTextOnlyReceiptBlob` | const arrow | 711 |
| 30 | `renderPdfBlob` | const arrow | 725 |
| 31 | `extractReceiptLines` | function | 760 |
| 32 | `downloadReceiptPdf` | export function | 778 |
| 33 | `openReceiptPdf` | export function | 797 |
| 34 | `printReceipt` | export function | 821 |

### 3.235 `frontend/src/utils/productGrouping.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeText` | function | 1 |
| 2 | `normalizeProductGroupName` | export function | 19 |
| 3 | `getNameInitialSection` | export function | 23 |
| 4 | `compareSectionLabels` | function | 32 |
| 5 | `compareProducts` | function | 46 |
| 6 | `buildChildrenByParentId` | function | 69 |
| 7 | `resolveRootProduct` | function | 80 |
| 8 | `resolveFamilyRootId` | function | 98 |
| 9 | `compareProductsWithinGroup` | function | 102 |
| 10 | `resolveGroupKey` | function | 117 |
| 11 | `buildProductGroups` | export function | 137 |
| 12 | `buildProductGroupSections` | export function | 225 |

### 3.236 `frontend/src/web-api.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getStoredAuthToken` | function | 27 |

### 3.237 `frontend/tailwind.config.mjs`

- No top-level named symbols detected.

### 3.238 `frontend/tests/apiHttp.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |
| 2 | `createDeferredResponse` | function | 25 |
| 3 | `resetApiState` | function | 36 |

### 3.239 `frontend/tests/appShellUtils.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.240 `frontend/tests/barcodeImageScanner.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.241 `frontend/tests/barcodeScannerState.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.242 `frontend/tests/csvImport.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.243 `frontend/tests/exportPackages.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 7 |

### 3.244 `frontend/tests/groupedRecords.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.245 `frontend/tests/historyHelpers.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 10 |

### 3.246 `frontend/tests/loaders.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.247 `frontend/tests/portalCatalogDisplay.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |
| 2 | `copy` | const arrow | 25 |
| 3 | `formatPortalPrice` | const arrow | 26 |

### 3.248 `frontend/tests/portalEditorUtils.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |

### 3.249 `frontend/tests/portalTranslateController.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createStorage` | function | 17 |
| 2 | `createDocument` | function | 32 |

### 3.250 `frontend/tests/posCore.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 15 |

### 3.251 `frontend/tests/pricingContacts.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |

### 3.252 `frontend/tests/productGrouping.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.253 `frontend/tests/productHistoryHelpers.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.254 `frontend/tests/productImportPlanner.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.255 `frontend/tests/publicErrorRecovery.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createStorage` | function | 8 |

### 3.256 `frontend/tests/receiptTemplate.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 7 |

### 3.257 `frontend/tests/runtimeErrorClassifier.test.mjs`

- No top-level named symbols detected.

### 3.258 `frontend/tests/scanbotScanner.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `setNavigator` | function | 8 |
| 2 | `run` | function | 16 |

### 3.259 `frontend/tests/storagePolicy.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 13 |

### 3.260 `frontend/vite.config.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fixCrossorigin` | function | 29 |
| 2 | `manualChunks` | function | 54 |

### 3.261 `ops/scripts/backend/verify-data-integrity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fail` | function | 20 |
| 2 | `pass` | function | 25 |
| 3 | `approxEqual` | function | 29 |
| 4 | `checkNoNegativeStock` | function | 36 |
| 5 | `checkProductStockMatchesBranches` | function | 45 |
| 6 | `checkSaleItemTotals` | function | 94 |
| 7 | `checkReturnDoesNotExceedSold` | function | 104 |
| 8 | `checkProfitFormulaConsistency` | function | 130 |
| 9 | `checkCogsSnapshotVsCurrentProductCost` | function | 166 |
| 10 | `run` | function | 190 |

### 3.262 `ops/scripts/frontend/verify-i18n.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `collectUsedKeys` | function | 29 |
| 2 | `flattenTranslationTree` | function | 69 |
| 3 | `listMissing` | function | 83 |
| 4 | `listEmptyValues` | function | 88 |
| 5 | `printList` | function | 95 |
| 6 | `main` | function | 102 |

### 3.263 `ops/scripts/frontend/verify-performance.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `read` | function | 15 |
| 2 | `walk` | function | 19 |
| 3 | `trackedFiles` | function | 37 |
| 4 | `assert` | function | 47 |

### 3.264 `ops/scripts/frontend/verify-ui.js`

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

### 3.265 `ops/scripts/generate-doc-reference.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ensureDir` | function | 17 |
| 2 | `normalizePath` | function | 21 |
| 3 | `getFilesRecursive` | function | 25 |
| 4 | `getRootCodeFiles` | function | 45 |
| 5 | `findSymbols` | function | 54 |
| 6 | `findRouteHandlers` | function | 83 |
| 7 | `collectScriptMetadata` | function | 99 |
| 8 | `markdownHeader` | function | 122 |
| 9 | `markdownSection` | function | 126 |
| 10 | `writeBackendReference` | function | 130 |
| 11 | `writeFrontendReference` | function | 185 |
| 12 | `readJsonObject` | function | 228 |
| 13 | `groupByPrefix` | function | 234 |
| 14 | `writeTranslationReference` | function | 243 |
| 15 | `writeRunReleaseReference` | function | 299 |
| 16 | `writeModuleNamingGuide` | function | 373 |
| 17 | `writeProjectCodeReference` | function | 421 |
| 18 | `main` | function | 462 |

### 3.266 `ops/scripts/generate-full-project-docs.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ensureDir` | function | 48 |
| 2 | `toPosix` | function | 52 |
| 3 | `rel` | function | 56 |
| 4 | `shouldSkipDir` | function | 60 |
| 5 | `collectFilesAndFolders` | function | 64 |
| 6 | `getAllProjectFilesAndFolders` | function | 85 |
| 7 | `isProbablyText` | function | 108 |
| 8 | `readText` | function | 121 |
| 9 | `lineCount` | function | 129 |
| 10 | `fileCategory` | function | 134 |
| 11 | `inferPurpose` | function | 155 |
| 12 | `markdownHeader` | function | 180 |
| 13 | `markdownSection` | function | 184 |
| 14 | `extractImportsExports` | function | 188 |
| 15 | `findSymbols` | function | 228 |
| 16 | `writeAllFunctionReference` | function | 254 |
| 17 | `resolveInternalImport` | function | 292 |
| 18 | `writeAllFileInventory` | function | 315 |
| 19 | `folderPurpose` | function | 337 |
| 20 | `writeFolderCoverage` | function | 355 |
| 21 | `writeImportExportReference` | function | 414 |
| 22 | `readJsonObject` | function | 488 |
| 23 | `translationSectionForKey` | function | 496 |
| 24 | `writeTranslationSectionReference` | function | 547 |
| 25 | `writeMainCoverageSummary` | function | 596 |
| 26 | `main` | function | 625 |

### 3.267 `ops/scripts/lib/fs-utils.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toPosix` | function | 16 |
| 2 | `resolveProjectRoot` | function | 20 |
| 3 | `relFrom` | function | 35 |
| 4 | `readUtf8` | function | 42 |
| 5 | `readJson` | function | 50 |
| 6 | `lineCount` | function | 58 |
| 7 | `walkFilesRecursive` | function | 66 |
| 8 | `collectRootFiles` | function | 93 |

### 3.268 `ops/scripts/performance-scan.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `kb` | function | 43 |
| 2 | `topN` | function | 48 |
| 3 | `main` | function | 56 |

### 3.269 `ops/scripts/runtime/check-public-url.mjs`

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

### 3.270 `ops/scripts/runtime/rotate-cloudflare-tunnel-token.mjs`

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

### 3.271 `ops/scripts/runtime/update-cloudflare-tunnel-origin.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readEnvFile` | function | 10 |
| 2 | `parseArgs` | function | 25 |
| 3 | `readToken` | function | 36 |
| 4 | `ensureIngress` | function | 42 |
| 5 | `main` | function | 58 |
| 6 | `requestJson` | function | 103 |

### 3.272 `ops/scripts/verify-docker-release.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `read` | function | 24 |
| 2 | `requireFile` | function | 28 |
| 3 | `main` | function | 32 |

### 3.273 `ops/scripts/verify-runtime-deps.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readJson` | function | 22 |
| 2 | `assertTrackedFile` | function | 26 |
| 3 | `hasLockDependency` | function | 32 |
| 4 | `main` | function | 38 |

### 3.274 `ops/scripts/verify-scale-services.js`

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

