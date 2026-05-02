# All Function Reference (Project First-Party Code)

Auto-generated function/class symbol commentary for all first-party code files (frontend, backend, root scripts/config code).

## 1. Coverage Summary

Code files scanned: **285**

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
| 15 | `backend/src/initials.js` | 6 |
| 16 | `backend/src/middleware.js` | 21 |
| 17 | `backend/src/money.js` | 3 |
| 18 | `backend/src/netSecurity.js` | 7 |
| 19 | `backend/src/organizationContext/index.js` | 14 |
| 20 | `backend/src/portalUtils.js` | 6 |
| 21 | `backend/src/productDiscounts.js` | 9 |
| 22 | `backend/src/productImportPolicies.js` | 8 |
| 23 | `backend/src/requestContext.js` | 5 |
| 24 | `backend/src/routes/actionHistory.js` | 10 |
| 25 | `backend/src/routes/ai.js` | 2 |
| 26 | `backend/src/routes/auth.js` | 26 |
| 27 | `backend/src/routes/branches.js` | 5 |
| 28 | `backend/src/routes/catalog.js` | 0 |
| 29 | `backend/src/routes/categories.js` | 2 |
| 30 | `backend/src/routes/contacts.js` | 15 |
| 31 | `backend/src/routes/customTables.js` | 8 |
| 32 | `backend/src/routes/files.js` | 3 |
| 33 | `backend/src/routes/importJobs.js` | 11 |
| 34 | `backend/src/routes/inventory.js` | 7 |
| 35 | `backend/src/routes/notifications.js` | 10 |
| 36 | `backend/src/routes/organizations.js` | 0 |
| 37 | `backend/src/routes/portal.js` | 38 |
| 38 | `backend/src/routes/products.js` | 41 |
| 39 | `backend/src/routes/returns.js` | 7 |
| 40 | `backend/src/routes/runtime.js` | 1 |
| 41 | `backend/src/routes/sales.js` | 14 |
| 42 | `backend/src/routes/settings.js` | 5 |
| 43 | `backend/src/routes/system/index.js` | 39 |
| 44 | `backend/src/routes/units.js` | 3 |
| 45 | `backend/src/routes/users.js` | 21 |
| 46 | `backend/src/runtimeCache.js` | 11 |
| 47 | `backend/src/runtimeState/index.js` | 6 |
| 48 | `backend/src/runtimeVersion.js` | 7 |
| 49 | `backend/src/security.js` | 13 |
| 50 | `backend/src/serverUtils.js` | 25 |
| 51 | `backend/src/services/aiGateway.js` | 12 |
| 52 | `backend/src/services/firebaseAuth.js` | 22 |
| 53 | `backend/src/services/googleDriveSync/index.js` | 49 |
| 54 | `backend/src/services/importJobs.js` | 121 |
| 55 | `backend/src/services/mediaQueue.js` | 10 |
| 56 | `backend/src/services/portalAi.js` | 29 |
| 57 | `backend/src/services/supabaseAuth.js` | 37 |
| 58 | `backend/src/services/verification.js` | 21 |
| 59 | `backend/src/sessionAuth.js` | 8 |
| 60 | `backend/src/settingsSnapshot.js` | 7 |
| 61 | `backend/src/storage/organizationFolders.js` | 5 |
| 62 | `backend/src/systemFsWorker.js` | 7 |
| 63 | `backend/src/uploadReferenceCleanup.js` | 2 |
| 64 | `backend/src/uploadSecurity.js` | 7 |
| 65 | `backend/src/websocket.js` | 1 |
| 66 | `backend/src/workers/importWorker.js` | 2 |
| 67 | `backend/src/workers/mediaWorker.js` | 2 |
| 68 | `backend/src/workers/migrationWorker.js` | 24 |
| 69 | `backend/test/accessControl.test.js` | 2 |
| 70 | `backend/test/authOtpGuards.test.js` | 1 |
| 71 | `backend/test/authSecurityFlow.test.js` | 8 |
| 72 | `backend/test/backupRoundtrip.test.js` | 12 |
| 73 | `backend/test/backupSchema.test.js` | 1 |
| 74 | `backend/test/configOrganizationRuntime.test.js` | 2 |
| 75 | `backend/test/contactOptions.test.js` | 1 |
| 76 | `backend/test/databaseRuntime.test.js` | 1 |
| 77 | `backend/test/dataPath.test.js` | 2 |
| 78 | `backend/test/fileRouteSecurityFlow.test.js` | 9 |
| 79 | `backend/test/idempotency.test.js` | 1 |
| 80 | `backend/test/importCsv.test.js` | 2 |
| 81 | `backend/test/importJobStateMachine.test.js` | 4 |
| 82 | `backend/test/importScaleSmoke.test.js` | 3 |
| 83 | `backend/test/initials.test.js` | 0 |
| 84 | `backend/test/netSecurity.test.js` | 1 |
| 85 | `backend/test/portalUtils.test.js` | 1 |
| 86 | `backend/test/productImportPolicies.test.js` | 1 |
| 87 | `backend/test/routeContracts.test.js` | 2 |
| 88 | `backend/test/runtimeCache.test.js` | 2 |
| 89 | `backend/test/runtimeVersion.test.js` | 1 |
| 90 | `backend/test/serverUtils.test.js` | 2 |
| 91 | `backend/test/stockConsistency.test.js` | 26 |
| 92 | `backend/test/systemRouteSecurity.test.js` | 9 |
| 93 | `backend/test/uploadSecurity.test.js` | 1 |
| 94 | `frontend/postcss.config.mjs` | 0 |
| 95 | `frontend/public/runtime-noise-guard.js` | 6 |
| 96 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.js` | 0 |
| 97 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.worker.js` | 0 |
| 98 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd-threads.js` | 0 |
| 99 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd.js` | 0 |
| 100 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core.js` | 0 |
| 101 | `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js` | 0 |
| 102 | `frontend/public/sw.js` | 3 |
| 103 | `frontend/public/theme-bootstrap.js` | 10 |
| 104 | `frontend/src/api/http.js` | 60 |
| 105 | `frontend/src/api/localDb.js` | 10 |
| 106 | `frontend/src/api/methods.js` | 174 |
| 107 | `frontend/src/api/websocket.js` | 7 |
| 108 | `frontend/src/App.jsx` | 38 |
| 109 | `frontend/src/app/appShellUtils.mjs` | 4 |
| 110 | `frontend/src/app/publicErrorRecovery.mjs` | 3 |
| 111 | `frontend/src/AppContext.jsx` | 41 |
| 112 | `frontend/src/components/auth/Login.jsx` | 21 |
| 113 | `frontend/src/components/branches/Branches.jsx` | 10 |
| 114 | `frontend/src/components/branches/BranchForm.jsx` | 3 |
| 115 | `frontend/src/components/branches/TransferModal.jsx` | 3 |
| 116 | `frontend/src/components/catalog/CatalogPage.jsx` | 80 |
| 117 | `frontend/src/components/catalog/CatalogProductsSection.jsx` | 4 |
| 118 | `frontend/src/components/catalog/CatalogSecondaryTabs.jsx` | 5 |
| 119 | `frontend/src/components/catalog/catalogUi.jsx` | 4 |
| 120 | `frontend/src/components/catalog/portalCatalogDisplay.mjs` | 8 |
| 121 | `frontend/src/components/catalog/portalContentI18n.mjs` | 13 |
| 122 | `frontend/src/components/catalog/portalEditorUtils.mjs` | 8 |
| 123 | `frontend/src/components/catalog/portalLanguagePacks.mjs` | 3 |
| 124 | `frontend/src/components/catalog/portalTranslateController.mjs` | 17 |
| 125 | `frontend/src/components/contacts/contactOptionUtils.js` | 9 |
| 126 | `frontend/src/components/contacts/Contacts.jsx` | 8 |
| 127 | `frontend/src/components/contacts/CustomersTab.jsx` | 21 |
| 128 | `frontend/src/components/contacts/DeliveryTab.jsx` | 23 |
| 129 | `frontend/src/components/contacts/shared.jsx` | 15 |
| 130 | `frontend/src/components/contacts/SuppliersTab.jsx` | 15 |
| 131 | `frontend/src/components/custom-tables/CustomTables.jsx` | 11 |
| 132 | `frontend/src/components/dashboard/charts/BarChart.jsx` | 2 |
| 133 | `frontend/src/components/dashboard/charts/DonutChart.jsx` | 1 |
| 134 | `frontend/src/components/dashboard/charts/index.js` | 0 |
| 135 | `frontend/src/components/dashboard/charts/LineChart.jsx` | 4 |
| 136 | `frontend/src/components/dashboard/charts/NoData.jsx` | 1 |
| 137 | `frontend/src/components/dashboard/Dashboard.jsx` | 9 |
| 138 | `frontend/src/components/dashboard/MiniStat.jsx` | 1 |
| 139 | `frontend/src/components/files/FilePickerModal.jsx` | 6 |
| 140 | `frontend/src/components/files/FilesPage.jsx` | 15 |
| 141 | `frontend/src/components/inventory/DualMoney.jsx` | 1 |
| 142 | `frontend/src/components/inventory/Inventory.jsx` | 11 |
| 143 | `frontend/src/components/inventory/InventoryImportModal.jsx` | 6 |
| 144 | `frontend/src/components/inventory/movementGroups.js` | 6 |
| 145 | `frontend/src/components/inventory/ProductDetailModal.jsx` | 2 |
| 146 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | 8 |
| 147 | `frontend/src/components/navigation/Sidebar.jsx` | 6 |
| 148 | `frontend/src/components/pos/CartItem.jsx` | 1 |
| 149 | `frontend/src/components/pos/FilterPanel.jsx` | 5 |
| 150 | `frontend/src/components/pos/POS.jsx` | 22 |
| 151 | `frontend/src/components/pos/posCore.mjs` | 8 |
| 152 | `frontend/src/components/pos/ProductImage.jsx` | 1 |
| 153 | `frontend/src/components/pos/QuickAddModal.jsx` | 2 |
| 154 | `frontend/src/components/products/barcodeImageScanner.mjs` | 4 |
| 155 | `frontend/src/components/products/BarcodeScannerModal.jsx` | 5 |
| 156 | `frontend/src/components/products/barcodeScannerState.mjs` | 1 |
| 157 | `frontend/src/components/products/BranchStockAdjuster.jsx` | 4 |
| 158 | `frontend/src/components/products/BulkAddStockModal.jsx` | 2 |
| 159 | `frontend/src/components/products/BulkImportModal.jsx` | 25 |
| 160 | `frontend/src/components/products/HeaderActions.jsx` | 2 |
| 161 | `frontend/src/components/products/ManageBrandsModal.jsx` | 11 |
| 162 | `frontend/src/components/products/ManageCategoriesModal.jsx` | 7 |
| 163 | `frontend/src/components/products/ManageUnitsModal.jsx` | 8 |
| 164 | `frontend/src/components/products/primitives.jsx` | 9 |
| 165 | `frontend/src/components/products/ProductDetailModal.jsx` | 3 |
| 166 | `frontend/src/components/products/ProductForm.jsx` | 17 |
| 167 | `frontend/src/components/products/productHistoryHelpers.mjs` | 2 |
| 168 | `frontend/src/components/products/productImportPlanner.mjs` | 13 |
| 169 | `frontend/src/components/products/productImportWorker.mjs` | 1 |
| 170 | `frontend/src/components/products/Products.jsx` | 26 |
| 171 | `frontend/src/components/products/scanbotScanner.mjs` | 9 |
| 172 | `frontend/src/components/products/VariantFormModal.jsx` | 5 |
| 173 | `frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | 4 |
| 174 | `frontend/src/components/receipt-settings/constants.js` | 2 |
| 175 | `frontend/src/components/receipt-settings/ErrorBoundary.jsx` | 0 |
| 176 | `frontend/src/components/receipt-settings/FieldOrderManager.jsx` | 9 |
| 177 | `frontend/src/components/receipt-settings/PrintSettings.jsx` | 8 |
| 178 | `frontend/src/components/receipt-settings/ReceiptPreview.jsx` | 2 |
| 179 | `frontend/src/components/receipt-settings/ReceiptSettings.jsx` | 4 |
| 180 | `frontend/src/components/receipt-settings/template.js` | 2 |
| 181 | `frontend/src/components/receipt/Receipt.jsx` | 8 |
| 182 | `frontend/src/components/returns/EditReturnModal.jsx` | 5 |
| 183 | `frontend/src/components/returns/NewReturnModal.jsx` | 10 |
| 184 | `frontend/src/components/returns/NewSupplierReturnModal.jsx` | 6 |
| 185 | `frontend/src/components/returns/ReturnDetailModal.jsx` | 3 |
| 186 | `frontend/src/components/returns/Returns.jsx` | 8 |
| 187 | `frontend/src/components/sales/ExportModal.jsx` | 9 |
| 188 | `frontend/src/components/sales/SaleDetailModal.jsx` | 6 |
| 189 | `frontend/src/components/sales/Sales.jsx` | 10 |
| 190 | `frontend/src/components/sales/SalesImportModal.jsx` | 6 |
| 191 | `frontend/src/components/sales/StatusBadge.jsx` | 2 |
| 192 | `frontend/src/components/server/ServerPage.jsx` | 15 |
| 193 | `frontend/src/components/shared/ActionHistoryBar.jsx` | 4 |
| 194 | `frontend/src/components/shared/BackgroundImportTracker.jsx` | 15 |
| 195 | `frontend/src/components/shared/ExportMenu.jsx` | 1 |
| 196 | `frontend/src/components/shared/FilterMenu.jsx` | 2 |
| 197 | `frontend/src/components/shared/ImageGalleryLightbox.jsx` | 5 |
| 198 | `frontend/src/components/shared/Modal.jsx` | 1 |
| 199 | `frontend/src/components/shared/navigationConfig.js` | 2 |
| 200 | `frontend/src/components/shared/NotificationCenter.jsx` | 7 |
| 201 | `frontend/src/components/shared/pageActivity.js` | 1 |
| 202 | `frontend/src/components/shared/PageHeader.jsx` | 1 |
| 203 | `frontend/src/components/shared/PageHelpButton.jsx` | 1 |
| 204 | `frontend/src/components/shared/pageHelpContent.js` | 1 |
| 205 | `frontend/src/components/shared/PaginationControls.jsx` | 3 |
| 206 | `frontend/src/components/shared/PortalMenu.jsx` | 6 |
| 207 | `frontend/src/components/shared/QuickPreferenceToggles.jsx` | 3 |
| 208 | `frontend/src/components/shared/WriteConflictModal.jsx` | 5 |
| 209 | `frontend/src/components/users/PermissionEditor.jsx` | 4 |
| 210 | `frontend/src/components/users/UserDetailSheet.jsx` | 3 |
| 211 | `frontend/src/components/users/UserProfileModal.jsx` | 21 |
| 212 | `frontend/src/components/users/Users.jsx` | 15 |
| 213 | `frontend/src/components/utils-settings/AuditLog.jsx` | 12 |
| 214 | `frontend/src/components/utils-settings/Backup.jsx` | 41 |
| 215 | `frontend/src/components/utils-settings/FontFamilyPicker.jsx` | 1 |
| 216 | `frontend/src/components/utils-settings/index.js` | 0 |
| 217 | `frontend/src/components/utils-settings/OtpModal.jsx` | 2 |
| 218 | `frontend/src/components/utils-settings/ResetData.jsx` | 8 |
| 219 | `frontend/src/components/utils-settings/Settings.jsx` | 20 |
| 220 | `frontend/src/constants.js` | 3 |
| 221 | `frontend/src/index.jsx` | 9 |
| 222 | `frontend/src/platform/runtime/clientRuntime.js` | 15 |
| 223 | `frontend/src/platform/storage/storagePolicy.mjs` | 3 |
| 224 | `frontend/src/runtime/runtimeErrorClassifier.mjs` | 11 |
| 225 | `frontend/src/utils/actionHistory.mjs` | 2 |
| 226 | `frontend/src/utils/appRefresh.js` | 1 |
| 227 | `frontend/src/utils/color.js` | 3 |
| 228 | `frontend/src/utils/csv.js` | 11 |
| 229 | `frontend/src/utils/csvImport.js` | 15 |
| 230 | `frontend/src/utils/dateHelpers.js` | 2 |
| 231 | `frontend/src/utils/deviceInfo.js` | 2 |
| 232 | `frontend/src/utils/exportPackage.js` | 2 |
| 233 | `frontend/src/utils/exportReports.jsx` | 9 |
| 234 | `frontend/src/utils/favicon.js` | 3 |
| 235 | `frontend/src/utils/formatters.js` | 4 |
| 236 | `frontend/src/utils/groupedRecords.mjs` | 14 |
| 237 | `frontend/src/utils/historyHelpers.mjs` | 3 |
| 238 | `frontend/src/utils/index.js` | 0 |
| 239 | `frontend/src/utils/initials.mjs` | 6 |
| 240 | `frontend/src/utils/loaders.mjs` | 8 |
| 241 | `frontend/src/utils/pricing.js` | 8 |
| 242 | `frontend/src/utils/printReceipt.js` | 34 |
| 243 | `frontend/src/utils/productGrouping.mjs` | 12 |
| 244 | `frontend/src/web-api.js` | 1 |
| 245 | `frontend/tailwind.config.mjs` | 0 |
| 246 | `frontend/tests/apiHttp.test.mjs` | 3 |
| 247 | `frontend/tests/appShellUtils.test.mjs` | 1 |
| 248 | `frontend/tests/barcodeImageScanner.test.mjs` | 1 |
| 249 | `frontend/tests/barcodeScannerState.test.mjs` | 1 |
| 250 | `frontend/tests/csvImport.test.mjs` | 1 |
| 251 | `frontend/tests/exportPackages.test.mjs` | 1 |
| 252 | `frontend/tests/groupedRecords.test.mjs` | 1 |
| 253 | `frontend/tests/historyHelpers.test.mjs` | 1 |
| 254 | `frontend/tests/loaders.test.mjs` | 1 |
| 255 | `frontend/tests/portalCatalogDisplay.test.mjs` | 3 |
| 256 | `frontend/tests/portalContentI18n.test.mjs` | 0 |
| 257 | `frontend/tests/portalEditorUtils.test.mjs` | 1 |
| 258 | `frontend/tests/portalLanguagePacks.test.mjs` | 0 |
| 259 | `frontend/tests/portalTranslateController.test.mjs` | 2 |
| 260 | `frontend/tests/posCore.test.mjs` | 1 |
| 261 | `frontend/tests/pricingContacts.test.mjs` | 1 |
| 262 | `frontend/tests/productGrouping.test.mjs` | 1 |
| 263 | `frontend/tests/productHistoryHelpers.test.mjs` | 1 |
| 264 | `frontend/tests/productImportPlanner.test.mjs` | 1 |
| 265 | `frontend/tests/publicErrorRecovery.test.mjs` | 1 |
| 266 | `frontend/tests/receiptTemplate.test.mjs` | 1 |
| 267 | `frontend/tests/runtimeErrorClassifier.test.mjs` | 0 |
| 268 | `frontend/tests/scanbotScanner.test.mjs` | 2 |
| 269 | `frontend/tests/storagePolicy.test.mjs` | 1 |
| 270 | `frontend/vite.config.mjs` | 4 |
| 271 | `ops/scripts/backend/verify-data-integrity.js` | 10 |
| 272 | `ops/scripts/frontend/verify-i18n.js` | 6 |
| 273 | `ops/scripts/frontend/verify-performance.js` | 4 |
| 274 | `ops/scripts/frontend/verify-ui.js` | 13 |
| 275 | `ops/scripts/generate-doc-reference.js` | 18 |
| 276 | `ops/scripts/generate-full-project-docs.js` | 26 |
| 277 | `ops/scripts/lib/fs-utils.js` | 8 |
| 278 | `ops/scripts/performance-scan.js` | 3 |
| 279 | `ops/scripts/runtime/check-public-url.mjs` | 11 |
| 280 | `ops/scripts/runtime/check-route-contract.mjs` | 3 |
| 281 | `ops/scripts/runtime/rotate-cloudflare-tunnel-token.mjs` | 16 |
| 282 | `ops/scripts/runtime/update-cloudflare-tunnel-origin.mjs` | 6 |
| 283 | `ops/scripts/verify-docker-release.js` | 3 |
| 284 | `ops/scripts/verify-runtime-deps.js` | 4 |
| 285 | `ops/scripts/verify-scale-services.js` | 8 |

## 3. Detailed Function Commentary

### 3.1 `backend/server.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadCompressionMiddleware` | function | 68 |
| 2 | `applySecurityHeaders` | function | 77 |
| 3 | `applyRequestPolicy` | function | 83 |
| 4 | `applyCoreMiddleware` | function | 93 |
| 5 | `mountStaticAssets` | function | 107 |
| 6 | `mountHealthRoute` | function | 126 |
| 7 | `mountApiRoutes` | function | 139 |
| 8 | `mountTransfersAlias` | function | 170 |
| 9 | `mountSpaFallback` | function | 185 |
| 10 | `mountErrorHandler` | function | 204 |
| 11 | `getStartupBanner` | function | 218 |
| 12 | `closeDatabase` | function | 239 |
| 13 | `startDatabaseMaintenanceTimer` | function | 249 |
| 14 | `registerShutdownHandlers` | function | 257 |
| 15 | `bootstrapServer` | function | 275 |

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
| 13 | `ensureDefaultSettings` | function | 1307 |
| 14 | `ensureDefaultBranches` | function | 1318 |
| 15 | `ensureDefaultUnits` | function | 1324 |
| 16 | `ensureCoreDataInvariants` | function | 1330 |
| 17 | `closeDatabase` | function | 1599 |

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

### 3.15 `backend/src/initials.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeInitialText` | function | 16 |
| 2 | `getInitialKey` | function | 20 |
| 3 | `getInitialType` | function | 31 |
| 4 | `compareInitialKeys` | function | 40 |
| 5 | `rank` | const arrow | 44 |
| 6 | `aggregateInitialRows` | function | 64 |

### 3.16 `backend/src/middleware.js`

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

### 3.17 `backend/src/money.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toFiniteNumber` | function | 3 |
| 2 | `roundUpToDecimals` | function | 8 |
| 3 | `normalizePriceValue` | function | 17 |

### 3.18 `backend/src/netSecurity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 26 |
| 2 | `normalizeHostname` | function | 30 |
| 3 | `isPrivateIpv4` | function | 34 |
| 4 | `isPrivateIpv6` | function | 47 |
| 5 | `isBlockedHostname` | function | 58 |
| 6 | `assertSafeOutboundUrl` | function | 69 |
| 7 | `isSafeExternalImageReference` | function | 97 |

### 3.19 `backend/src/organizationContext/index.js`

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

### 3.20 `backend/src/portalUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toTrimmedString` | function | 5 |
| 2 | `safeJsonParse` | function | 9 |
| 3 | `createAboutBlock` | function | 17 |
| 4 | `normalizeAboutBlocks` | function | 28 |
| 5 | `extractGoogleMapsEmbedUrl` | function | 47 |
| 6 | `normalizeGoogleMapsEmbed` | function | 55 |

### 3.21 `backend/src/productDiscounts.js`

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

### 3.22 `backend/src/productImportPolicies.js`

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

### 3.23 `backend/src/requestContext.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cleanText` | function | 7 |
| 2 | `readHeader` | function | 13 |
| 3 | `extractRequestMeta` | function | 19 |
| 4 | `requestContextMiddleware` | function | 45 |
| 5 | `getRequestMeta` | function | 50 |

### 3.24 `backend/src/routes/actionHistory.js`

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

### 3.25 `backend/src/routes/ai.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `listProviders` | function | 19 |
| 2 | `getProviderRow` | function | 28 |

### 3.26 `backend/src/routes/auth.js`

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

### 3.27 `backend/src/routes/branches.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toDbBool` | function | 10 |
| 2 | `getStockTransferNoteColumn` | function | 18 |
| 3 | `normalizePositiveInt` | function | 27 |
| 4 | `getDefaultBranch` | function | 33 |
| 5 | `buildBranchStockWhere` | function | 37 |

### 3.28 `backend/src/routes/catalog.js`

- No top-level named symbols detected.

### 3.29 `backend/src/routes/categories.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLookup` | function | 11 |
| 2 | `normalizeColor` | function | 15 |

### 3.30 `backend/src/routes/contacts.js`

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

### 3.31 `backend/src/routes/customTables.js`

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

### 3.32 `backend/src/routes/files.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseFileAssetId` | function | 18 |
| 2 | `getFileListFilters` | function | 26 |
| 3 | `getDeviceMeta` | function | 38 |

### 3.33 `backend/src/routes/importJobs.js`

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

### 3.34 `backend/src/routes/inventory.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeImportedTimestamp` | function | 12 |
| 2 | `recalcProductStock` | function | 20 |
| 3 | `cleanMoveReason` | function | 29 |
| 4 | `normalizePositiveInt` | function | 35 |
| 5 | `splitSearchTerms` | function | 41 |
| 6 | `appendInventoryProductFilters` | function | 50 |
| 7 | `getBranchQty` | const arrow | 126 |

### 3.35 `backend/src/routes/notifications.js`

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

### 3.36 `backend/src/routes/organizations.js`

- No top-level named symbols detected.

### 3.37 `backend/src/routes/portal.js`

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
| 20 | `cacheTtl` | function | 512 |
| 21 | `normalizePositiveInt` | function | 516 |
| 22 | `splitSearchTerms` | function | 522 |
| 23 | `splitFilterValues` | function | 531 |
| 24 | `appendPortalProductSearchFilters` | function | 540 |
| 25 | `getPortalCatalogSearchMetadata` | function | 608 |
| 26 | `distinctField` | const arrow | 613 |
| 27 | `getPortalCatalogProductPage` | function | 637 |
| 28 | `getCachedPortalConfig` | function | 739 |
| 29 | `getCachedPortalMeta` | function | 743 |
| 30 | `getCachedPortalProducts` | function | 747 |
| 31 | `getPortalCatalogMeta` | function | 752 |
| 32 | `findCustomerByMembership` | function | 798 |
| 33 | `sanitizeScreenshots` | function | 808 |
| 34 | `materializePortalScreenshots` | function | 817 |
| 35 | `sanitizeAiProfile` | function | 835 |
| 36 | `getVisitorFingerprint` | function | 847 |
| 37 | `getClientKey` | function | 853 |
| 38 | `applyPortalRateLimit` | function | 858 |

### 3.38 `backend/src/routes/products.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getActiveBranches` | function | 28 |
| 2 | `getDefaultBranch` | function | 32 |
| 3 | `seedBranchRows` | function | 36 |
| 4 | `recalcProductStock` | function | 41 |
| 5 | `normalizeImageGallery` | function | 50 |
| 6 | `syncProductImageGallery` | function | 57 |
| 7 | `loadProductImageMap` | function | 75 |
| 8 | `attachImageGallery` | function | 93 |
| 9 | `findProductByClientRequestId` | function | 105 |
| 10 | `assertUniqueProductFields` | function | 115 |
| 11 | `hasOwnField` | function | 142 |
| 12 | `pickField` | function | 146 |
| 13 | `ensureParentProductExists` | function | 150 |
| 14 | `markParentProductAsGroup` | function | 160 |
| 15 | `normalizeImportLookup` | function | 165 |
| 16 | `normalizeImportFlagValue` | function | 169 |
| 17 | `getProductImportDetailSignature` | function | 218 |
| 18 | `chooseImportParentProduct` | function | 228 |
| 19 | `normalizeImportAction` | function | 243 |
| 20 | `parseOptionalImportId` | function | 251 |
| 21 | `discountInsertColumns` | function | 258 |
| 22 | `discountValues` | function | 262 |
| 23 | `normalizePositiveInt` | function | 277 |
| 24 | `parseInclude` | function | 283 |
| 25 | `splitSearchTerms` | function | 287 |
| 26 | `appendProductSearchFilters` | function | 296 |
| 27 | `getProductSearchMetadata` | function | 351 |
| 28 | `distinctField` | const arrow | 356 |
| 29 | `attachBranchStock` | function | 381 |
| 30 | `normalizeLookup` | const arrow | 878 |
| 31 | `resolveImage` | const arrow | 987 |
| 32 | `ensureCategory` | const arrow | 1003 |
| 33 | `ensureUnit` | const arrow | 1017 |
| 34 | `ensureBrand` | const arrow | 1031 |
| 35 | `ensureSupplier` | const arrow | 1043 |
| 36 | `determineBranch` | const arrow | 1054 |
| 37 | `handleBranch` | const arrow | 1073 |
| 38 | `isDirectImageRef` | const arrow | 1098 |
| 39 | `normalizeDirectImageRef` | const arrow | 1109 |
| 40 | `parseIncomingImageRefs` | const arrow | 1116 |
| 41 | `loadCurrentGallery` | const arrow | 1149 |

### 3.39 `backend/src/routes/returns.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `refreshProductStockQuantity` | function | 13 |
| 2 | `refreshProductStockQuantities` | function | 26 |
| 3 | `normalizeScope` | function | 36 |
| 4 | `toNumber` | function | 44 |
| 5 | `findReturnByClientRequestId` | function | 49 |
| 6 | `assertReturnableItems` | function | 59 |
| 7 | `assertSupplierReturnableStock` | function | 374 |

### 3.40 `backend/src/routes/runtime.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `requireRuntimePermission` | function | 17 |

### 3.41 `backend/src/routes/sales.js`

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

### 3.42 `backend/src/routes/settings.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLookup` | function | 11 |
| 2 | `normalizeBrandOptionsValue` | function | 15 |
| 3 | `settingsHasUpdatedAt` | function | 39 |
| 4 | `getSettingsSnapshot` | function | 48 |
| 5 | `getSettingsUpdatedAt` | function | 55 |

### 3.43 `backend/src/routes/system/index.js`

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

### 3.44 `backend/src/routes/units.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLookup` | function | 12 |
| 2 | `normalizeUnitColor` | function | 16 |
| 3 | `updateUnitHandler` | function | 50 |

### 3.45 `backend/src/routes/users.js`

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

### 3.46 `backend/src/runtimeCache.js`

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

### 3.47 `backend/src/runtimeState/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ensureRuntimeMetaDir` | function | 11 |
| 2 | `readRuntimeState` | function | 15 |
| 3 | `writeRuntimeState` | function | 32 |
| 4 | `getRuntimeState` | function | 38 |
| 5 | `bumpStorageVersion` | function | 48 |
| 6 | `buildRuntimeDescriptor` | function | 57 |

### 3.48 `backend/src/runtimeVersion.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `firstExistingDir` | function | 11 |
| 2 | `readGitRevision` | function | 15 |
| 3 | `collectFiles` | function | 30 |
| 4 | `computeSourceHash` | function | 44 |
| 5 | `emptyFrontendBuildInfo` | function | 69 |
| 6 | `readFrontendBuildInfoFromRoot` | function | 77 |
| 7 | `getRuntimeVersion` | function | 112 |

### 3.49 `backend/src/security.js`

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

### 3.50 `backend/src/serverUtils.js`

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

### 3.51 `backend/src/services/aiGateway.js`

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

### 3.52 `backend/src/services/firebaseAuth.js`

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

### 3.53 `backend/src/services/googleDriveSync/index.js`

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

### 3.54 `backend/src/services/importJobs.js`

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
| 25 | `normalizeReviewIdentifier` | function | 295 |
| 26 | `getBarcodeReviewIssue` | function | 299 |
| 27 | `buildProductImportReviewState` | function | 308 |
| 28 | `add` | const arrow | 312 |
| 29 | `duplicateGroupCount` | const arrow | 325 |
| 30 | `hasReviewQueryMatch` | function | 336 |
| 31 | `normalizeReviewFilter` | function | 356 |
| 32 | `matchesReviewFilter` | function | 364 |
| 33 | `buildProductReviewIndex` | function | 372 |
| 34 | `getProductConflictForReview` | function | 399 |
| 35 | `buildContactReviewIndex` | function | 484 |
| 36 | `getContactConflictForReview` | function | 504 |
| 37 | `getGenericImportConflictForReview` | function | 555 |
| 38 | `applyImportDecisionToRow` | function | 568 |
| 39 | `getImportDecisionMap` | function | 593 |
| 40 | `getImportJobReview` | function | 599 |
| 41 | `updateImportJobDecisions` | function | 701 |
| 42 | `addJobFile` | function | 714 |
| 43 | `getJobFiles` | function | 733 |
| 44 | `markJobCancelled` | function | 738 |
| 45 | `isCancelled` | function | 742 |
| 46 | `waitForQueuedImportMedia` | function | 748 |
| 47 | `finalizeSkippedImportImages` | function | 775 |
| 48 | `normalizeLookup` | function | 792 |
| 49 | `normalizeText` | function | 796 |
| 50 | `getMimeTypeFromName` | function | 800 |
| 51 | `normalizeProductSignature` | function | 854 |
| 52 | `chooseParentProduct` | function | 862 |
| 53 | `normalizeImportAction` | function | 876 |
| 54 | `parseOptionalImportId` | function | 884 |
| 55 | `parseIncomingImageRefs` | function | 889 |
| 56 | `syncProductImageGallery` | function | 923 |
| 57 | `loadCurrentGallery` | function | 946 |
| 58 | `ensureParentProductExists` | function | 953 |
| 59 | `assertUniqueProductFields` | function | 962 |
| 60 | `findProductIdentifierConflict` | function | 996 |
| 61 | `normalizeIdentifierConflictMode` | function | 1017 |
| 62 | `resolveNewProductIdentifiers` | function | 1025 |
| 63 | `copyImageIntoAssets` | function | 1062 |
| 64 | `resolveImageGallery` | function | 1101 |
| 65 | `ensureSettingOptionMap` | function | 1157 |
| 66 | `upsertSettingJson` | function | 1167 |
| 67 | `normalizeRowForProduct` | function | 1174 |
| 68 | `createProductContext` | function | 1219 |
| 69 | `ensureCategory` | function | 1242 |
| 70 | `ensureUnit` | function | 1254 |
| 71 | `ensureBrand` | function | 1265 |
| 72 | `ensureSupplier` | function | 1277 |
| 73 | `determineBranch` | function | 1288 |
| 74 | `handleBranchStock` | function | 1303 |
| 75 | `recalcProductStock` | function | 1321 |
| 76 | `insertInventoryMovement` | function | 1330 |
| 77 | `seedBranchRows` | function | 1354 |
| 78 | `processProductRow` | function | 1361 |
| 79 | `processProductRowBatches` | function | 1617 |
| 80 | `flushProgress` | const arrow | 1629 |
| 81 | `processProductRows` | function | 1728 |
| 82 | `buildImageLookup` | function | 1738 |
| 83 | `normalizeImageMatchKey` | function | 1753 |
| 84 | `processImageOnlyFiles` | function | 1763 |
| 85 | `normalizeContactMode` | function | 1825 |
| 86 | `resolveContactValue` | function | 1830 |
| 87 | `parseFieldRules` | function | 1838 |
| 88 | `generateCustomerMembershipNumber` | function | 1844 |
| 89 | `processContactRowBatches` | function | 1855 |
| 90 | `processContactRows` | function | 2024 |
| 91 | `normalizeInventoryAction` | function | 2034 |
| 92 | `processInventoryRowBatches` | function | 2041 |
| 93 | `processInventoryRows` | function | 2142 |
| 94 | `processSalesRowBatches` | function | 2151 |
| 95 | `processSalesRows` | function | 2366 |
| 96 | `extractZipImages` | function | 2375 |
| 97 | `processImportJob` | function | 2445 |
| 98 | `runLocalJob` | function | 2580 |
| 99 | `normalizeQueueMode` | function | 2587 |
| 100 | `queueNameForMode` | function | 2591 |
| 101 | `configuredQueueDriver` | function | 2595 |
| 102 | `getImportQueueConcurrency` | function | 2601 |
| 103 | `hasBullProducer` | function | 2605 |
| 104 | `hasBullWorkers` | function | 2609 |
| 105 | `removeQueuedBullJobsForImport` | function | 2613 |
| 106 | `getBullConnection` | function | 2636 |
| 107 | `initializeBullQueue` | function | 2649 |
| 108 | `startImportWorkers` | function | 2672 |
| 109 | `startWorker` | const arrow | 2679 |
| 110 | `enqueueImportJob` | function | 2715 |
| 111 | `cancelImportJob` | function | 2747 |
| 112 | `listCancellableImportJobs` | function | 2780 |
| 113 | `waitForImportJobsToStop` | function | 2789 |
| 114 | `cancelAllImportJobs` | function | 2811 |
| 115 | `deleteImportJob` | function | 2842 |
| 116 | `deleteAllImportJobs` | function | 2872 |
| 117 | `approveImportJob` | function | 2888 |
| 118 | `recoverImportJobs` | function | 2907 |
| 119 | `getQueueStatus` | function | 2934 |
| 120 | `buildErrorsCsv` | function | 2951 |
| 121 | `escape` | const arrow | 2953 |

### 3.55 `backend/src/services/mediaQueue.js`

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

### 3.56 `backend/src/services/portalAi.js`

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

### 3.57 `backend/src/services/supabaseAuth.js`

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

### 3.58 `backend/src/services/verification.js`

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

### 3.59 `backend/src/sessionAuth.js`

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

### 3.60 `backend/src/settingsSnapshot.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeUploadPublicPath` | function | 7 |
| 2 | `isUploadPublicPath` | function | 15 |
| 3 | `sanitizeMediaPath` | function | 20 |
| 4 | `sanitizeMediaList` | function | 27 |
| 5 | `uploadPublicPathExists` | function | 40 |
| 6 | `sanitizeSettingValue` | function | 52 |
| 7 | `sanitizeSettingsSnapshot` | function | 56 |

### 3.61 `backend/src/storage/organizationFolders.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 6 |
| 2 | `sanitizeOrganizationFolderLabel` | function | 10 |
| 3 | `buildOrganizationFolderName` | function | 20 |
| 4 | `extractOrganizationPublicId` | function | 26 |
| 5 | `findOrganizationFolderByPublicId` | function | 33 |

### 3.62 `backend/src/systemFsWorker.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatBackupStamp` | function | 15 |
| 2 | `pad` | const arrow | 17 |
| 3 | `respond` | function | 21 |
| 4 | `fail` | function | 25 |
| 5 | `runExportFolder` | function | 30 |
| 6 | `runRelocateDataRoot` | function | 70 |
| 7 | `main` | function | 77 |

### 3.63 `backend/src/uploadReferenceCleanup.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `safeJsonArray` | function | 10 |
| 2 | `repairMissingUploadReferences` | function | 19 |

### 3.64 `backend/src/uploadSecurity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `bufferStartsWith` | function | 11 |
| 2 | `isLikelyCsvBuffer` | function | 15 |
| 3 | `detectBufferKind` | function | 28 |
| 4 | `getExpectedUploadedKind` | function | 42 |
| 5 | `validateImageMetadata` | function | 51 |
| 6 | `validateUploadedBuffer` | function | 65 |
| 7 | `validateUploadedPath` | function | 76 |

### 3.65 `backend/src/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `attachWss` | function | 24 |

### 3.66 `backend/src/workers/importWorker.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `start` | function | 10 |
| 2 | `shutdown` | function | 16 |

### 3.67 `backend/src/workers/mediaWorker.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `start` | function | 10 |
| 2 | `shutdown` | function | 15 |

### 3.68 `backend/src/workers/migrationWorker.js`

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

### 3.69 `backend/test/accessControl.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |
| 2 | `makeReq` | function | 22 |

### 3.70 `backend/test/authOtpGuards.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |

### 3.71 `backend/test/authSecurityFlow.test.js`

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

### 3.72 `backend/test/backupRoundtrip.test.js`

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

### 3.73 `backend/test/backupSchema.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.74 `backend/test/configOrganizationRuntime.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |
| 2 | `makeTempRoot` | function | 23 |

### 3.75 `backend/test/contactOptions.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.76 `backend/test/databaseRuntime.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 23 |

### 3.77 `backend/test/dataPath.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 16 |
| 2 | `makeTempRoot` | function | 27 |

### 3.78 `backend/test/fileRouteSecurityFlow.test.js`

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

### 3.79 `backend/test/idempotency.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.80 `backend/test/importCsv.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 13 |
| 2 | `collectBatches` | function | 26 |

### 3.81 `backend/test/importJobStateMachine.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 34 |
| 2 | `writeImportFile` | function | 45 |
| 3 | `writeJobFile` | function | 52 |
| 4 | `main` | function | 59 |

### 3.82 `backend/test/importScaleSmoke.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |
| 2 | `makeLargeCsv` | function | 23 |
| 3 | `assertLargeCsvSmoke` | function | 38 |

### 3.83 `backend/test/initials.test.js`

- No top-level named symbols detected.

### 3.84 `backend/test/netSecurity.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |

### 3.85 `backend/test/portalUtils.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.86 `backend/test/productImportPolicies.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 15 |

### 3.87 `backend/test/routeContracts.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 7 |
| 2 | `getRoutePaths` | function | 18 |

### 3.88 `backend/test/runtimeCache.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 23 |
| 2 | `main` | function | 34 |

### 3.89 `backend/test/runtimeVersion.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |

### 3.90 `backend/test/serverUtils.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 22 |
| 2 | `collectHeaders` | const arrow | 214 |

### 3.91 `backend/test/stockConsistency.test.js`

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

### 3.92 `backend/test/systemRouteSecurity.test.js`

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

### 3.93 `backend/test/uploadSecurity.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.94 `frontend/postcss.config.mjs`

- No top-level named symbols detected.

### 3.95 `frontend/public/runtime-noise-guard.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `text` | function | 10 |
| 2 | `sourceFromEvent` | function | 14 |
| 3 | `isFirstPartyAsset` | function | 23 |
| 4 | `isInjectedSource` | function | 27 |
| 5 | `isKnownNoise` | function | 32 |
| 6 | `suppress` | function | 45 |

### 3.96 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.js`

- No top-level named symbols detected.

### 3.97 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.worker.js`

- No top-level named symbols detected.

### 3.98 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd-threads.js`

- No top-level named symbols detected.

### 3.99 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd.js`

- No top-level named symbols detected.

### 3.100 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core.js`

- No top-level named symbols detected.

### 3.101 `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js`

- No top-level named symbols detected.

### 3.102 `frontend/public/sw.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isSameOrigin` | function | 38 |
| 2 | `isCacheableStaticPath` | function | 46 |
| 3 | `networkFirstStatic` | function | 52 |

### 3.103 `frontend/public/theme-bootstrap.js`

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

### 3.104 `frontend/src/api/http.js`

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
| 9 | `normalizeApiPath` | function | 92 |
| 10 | `isRequiredRuntimeApiPath` | export function | 104 |
| 11 | `getApiMismatchKey` | function | 109 |
| 12 | `getApiVersionMismatchCooldown` | export function | 113 |
| 13 | `dispatchApiVersionMismatch` | function | 124 |
| 14 | `createApiVersionMismatchError` | export function | 138 |
| 15 | `isApiVersionMismatchError` | export function | 149 |
| 16 | `markApiVersionMismatch` | export function | 153 |
| 17 | `cacheGet` | export function | 163 |
| 18 | `cacheSet` | export function | 167 |
| 19 | `cacheInvalidate` | export function | 168 |
| 20 | `cacheClearAll` | export function | 171 |
| 21 | `logCall` | function | 199 |
| 22 | `getCallLog` | export function | 204 |
| 23 | `clearCallLog` | export function | 205 |
| 24 | `getClientMetaHeaders` | function | 207 |
| 25 | `createApiError` | function | 211 |
| 26 | `shouldCompareRuntimeVersions` | export function | 224 |
| 27 | `dispatchRuntimeVersionMismatch` | function | 238 |
| 28 | `checkRuntimeVersionFromHealth` | function | 250 |
| 29 | `createWriteBlockedError` | function | 257 |
| 30 | `dispatchWriteBlocked` | function | 267 |
| 31 | `isWriteConflictError` | export function | 281 |
| 32 | `isWriteBlockedError` | export function | 285 |
| 33 | `isInvalidSessionError` | export function | 289 |
| 34 | `requireLiveServerWrite` | export function | 293 |
| 35 | `getConflictRefreshChannels` | function | 325 |
| 36 | `dispatchGlobalDataRefresh` | function | 334 |
| 37 | `sleep` | function | 343 |
| 38 | `hasUsableLocalData` | function | 347 |
| 39 | `tryServerReadWithRetry` | function | 354 |
| 40 | `resolveLocalRead` | function | 364 |
| 41 | `stableStringifyForDedupe` | function | 371 |
| 42 | `clampDedupeBody` | function | 381 |
| 43 | `buildApiRequestDedupeKey` | export function | 387 |
| 44 | `__resetApiWriteDedupeForTests` | export function | 393 |
| 45 | `apiFetch` | export function | 398 |
| 46 | `requestPromise` | const arrow | 418 |
| 47 | `parsed` | const arrow | 443 |
| 48 | `isNetErr` | export function | 497 |
| 49 | `isConnectivityError` | function | 503 |
| 50 | `isServerOnline` | export function | 522 |
| 51 | `setServerHealth` | function | 524 |
| 52 | `pingServerHealth` | function | 536 |
| 53 | `startHealthCheck` | export function | 561 |
| 54 | `cacheGetStale` | export function | 592 |
| 55 | `getChannelRefreshKey` | function | 601 |
| 56 | `emitCacheRefresh` | function | 605 |
| 57 | `clearInflight` | function | 619 |
| 58 | `hasReusableInflight` | function | 624 |
| 59 | `raceServerReadWithLocalFallback` | function | 634 |
| 60 | `route` | export function | 706 |

### 3.105 `frontend/src/api/localDb.js`

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

### 3.106 `frontend/src/api/methods.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDeviceInfo` | function | 3 |
| 2 | `getPortalBaseUrl` | function | 41 |
| 3 | `getCurrentUserContext` | function | 46 |
| 4 | `emitSyncQueueChanged` | function | 61 |
| 5 | `discardPendingSyncQueue` | export function | 68 |
| 6 | `createClientRequestId` | function | 86 |
| 7 | `ensureClientRequestId` | function | 93 |
| 8 | `getPendingSyncState` | export function | 99 |
| 9 | `retryPendingSyncNow` | export function | 139 |
| 10 | `invalidateClientRuntimeState` | function | 143 |
| 11 | `withExpectedUpdatedAt` | function | 159 |
| 12 | `withSettingsExpectedUpdatedAt` | function | 173 |
| 13 | `appendActorQuery` | function | 183 |
| 14 | `fetchJsonWithTimeout` | function | 196 |
| 15 | `mirrorReadResult` | function | 214 |
| 16 | `routeMirrored` | function | 223 |
| 17 | `shouldPersistLocalMirror` | function | 229 |
| 18 | `purgeSensitiveLiveServerMirrors` | function | 233 |
| 19 | `mirrorTable` | function | 244 |
| 20 | `getNotificationSummaryFallback` | function | 264 |
| 21 | `getDriveSyncStatusFallback` | function | 273 |
| 22 | `readNotificationSummaryMissingUntil` | function | 281 |
| 23 | `markNotificationSummaryMissing` | function | 293 |
| 24 | `clearNotificationSummaryMissing` | function | 308 |
| 25 | `readStorageNumber` | function | 317 |
| 26 | `writeStorageNumber` | function | 333 |
| 27 | `clearStorageNumber` | function | 344 |
| 28 | `login` | export function | 356 |
| 29 | `logout` | export function | 359 |
| 30 | `resetPasswordWithOtp` | export function | 362 |
| 31 | `requestPasswordResetEmail` | export function | 365 |
| 32 | `completePasswordReset` | export function | 368 |
| 33 | `updateSessionDuration` | export function | 371 |
| 34 | `getVerificationCapabilities` | export function | 374 |
| 35 | `getSystemConfig` | export function | 377 |
| 36 | `getNotificationSummary` | export function | 380 |
| 37 | `getSystemDebugLog` | export function | 411 |
| 38 | `startSupabaseOauth` | export function | 414 |
| 39 | `completeSupabaseOauth` | export function | 417 |
| 40 | `getAppBootstrap` | export function | 420 |
| 41 | `buildLocalBootstrap` | const arrow | 421 |
| 42 | `getOrganizationBootstrap` | export function | 473 |
| 43 | `searchOrganizations` | export function | 476 |
| 44 | `getCurrentOrganization` | export function | 480 |
| 45 | `getSettings` | export function | 485 |
| 46 | `saveSettings` | export function | 500 |
| 47 | `getCategories` | const arrow | 518 |
| 48 | `updateCategory` | const arrow | 520 |
| 49 | `deleteCategory` | const arrow | 521 |
| 50 | `getUnits` | const arrow | 524 |
| 51 | `updateUnit` | const arrow | 526 |
| 52 | `deleteUnit` | const arrow | 527 |
| 53 | `getBranches` | const arrow | 530 |
| 54 | `updateBranch` | const arrow | 532 |
| 55 | `deleteBranch` | const arrow | 536 |
| 56 | `getBranchStock` | const arrow | 540 |
| 57 | `getTransfers` | const arrow | 544 |
| 58 | `getBranchStockIntegrity` | const arrow | 546 |
| 59 | `getProducts` | const arrow | 550 |
| 60 | `searchProducts` | const arrow | 551 |
| 61 | `getProductFilters` | const arrow | 555 |
| 62 | `getCatalogMeta` | export function | 559 |
| 63 | `getCatalogProducts` | export function | 567 |
| 64 | `getPortalConfig` | export function | 575 |
| 65 | `getPortalBootstrap` | export function | 583 |
| 66 | `getPortalCatalogMeta` | export function | 591 |
| 67 | `getPortalCatalogProducts` | export function | 599 |
| 68 | `searchPortalCatalogProducts` | export function | 607 |
| 69 | `lookupPortalMembership` | export function | 619 |
| 70 | `createPortalSubmission` | export function | 629 |
| 71 | `getPortalAiStatus` | export function | 643 |
| 72 | `askPortalAi` | export function | 651 |
| 73 | `getPortalSubmissionsForReview` | const arrow | 665 |
| 74 | `reviewPortalSubmission` | const arrow | 667 |
| 75 | `getAiProviders` | const arrow | 670 |
| 76 | `createAiProvider` | const arrow | 672 |
| 77 | `updateAiProvider` | const arrow | 674 |
| 78 | `deleteAiProvider` | const arrow | 676 |
| 79 | `testAiProvider` | const arrow | 678 |
| 80 | `getAiResponses` | const arrow | 680 |
| 81 | `createProduct` | export function | 682 |
| 82 | `updateProduct` | export function | 696 |
| 83 | `deleteProduct` | const arrow | 709 |
| 84 | `buildMultipartHeaders` | function | 726 |
| 85 | `apiFormPost` | function | 739 |
| 86 | `listImportJobs` | const arrow | 758 |
| 87 | `getImportJobReview` | const arrow | 763 |
| 88 | `updateImportJobDecisions` | const arrow | 767 |
| 89 | `deleteImportJob` | const arrow | 773 |
| 90 | `getImportQueueStatus` | const arrow | 792 |
| 91 | `downloadImportJobErrors` | export function | 794 |
| 92 | `uploadImportJobCsv` | export function | 813 |
| 93 | `uploadImportJobZip` | export function | 820 |
| 94 | `uploadImportJobImages` | export function | 827 |
| 95 | `getFiles` | export function | 851 |
| 96 | `uploadFileAsset` | export function | 857 |
| 97 | `deleteFileAsset` | export function | 891 |
| 98 | `uploadProductImage` | export function | 903 |
| 99 | `uploadUserAvatar` | export function | 939 |
| 100 | `openCSVDialog` | export function | 980 |
| 101 | `openImageDialog` | export function | 1000 |
| 102 | `getImageDataUrl` | export function | 1008 |
| 103 | `getActionHistory` | const arrow | 1019 |
| 104 | `updateActionHistory` | const arrow | 1023 |
| 105 | `getInventorySummary` | const arrow | 1029 |
| 106 | `searchInventoryProducts` | const arrow | 1030 |
| 107 | `getInventoryMovements` | const arrow | 1034 |
| 108 | `createSale` | export function | 1037 |
| 109 | `getSales` | const arrow | 1042 |
| 110 | `getDashboard` | const arrow | 1049 |
| 111 | `getAnalytics` | const arrow | 1050 |
| 112 | `getCustomers` | const arrow | 1059 |
| 113 | `createCustomer` | export function | 1060 |
| 114 | `updateCustomer` | const arrow | 1064 |
| 115 | `deleteCustomer` | const arrow | 1068 |
| 116 | `downloadCustomerTemplate` | const arrow | 1073 |
| 117 | `getSuppliers` | const arrow | 1082 |
| 118 | `createSupplier` | export function | 1083 |
| 119 | `updateSupplier` | const arrow | 1087 |
| 120 | `deleteSupplier` | const arrow | 1091 |
| 121 | `downloadSupplierTemplate` | const arrow | 1096 |
| 122 | `getDeliveryContacts` | const arrow | 1105 |
| 123 | `createDeliveryContact` | export function | 1106 |
| 124 | `updateDeliveryContact` | const arrow | 1110 |
| 125 | `deleteDeliveryContact` | const arrow | 1114 |
| 126 | `getUsers` | const arrow | 1121 |
| 127 | `updateUser` | const arrow | 1123 |
| 128 | `getUserProfile` | const arrow | 1124 |
| 129 | `getUserAuthMethods` | const arrow | 1125 |
| 130 | `updateUserProfile` | const arrow | 1127 |
| 131 | `disconnectUserAuthProvider` | const arrow | 1129 |
| 132 | `changeUserPassword` | const arrow | 1131 |
| 133 | `resetPassword` | const arrow | 1133 |
| 134 | `getRoles` | const arrow | 1136 |
| 135 | `updateRole` | const arrow | 1138 |
| 136 | `deleteRole` | const arrow | 1139 |
| 137 | `getCustomTables` | const arrow | 1142 |
| 138 | `getCustomTableData` | const arrow | 1144 |
| 139 | `insertCustomRow` | const arrow | 1145 |
| 140 | `updateCustomRow` | const arrow | 1146 |
| 141 | `deleteCustomRow` | const arrow | 1147 |
| 142 | `getAuditLogs` | const arrow | 1150 |
| 143 | `exportBackup` | export function | 1153 |
| 144 | `exportBackupFolder` | export function | 1170 |
| 145 | `pickBackupFile` | export function | 1174 |
| 146 | `importBackupData` | export function | 1189 |
| 147 | `importBackupFolder` | export function | 1196 |
| 148 | `importBackup` | export function | 1203 |
| 149 | `getGoogleDriveSyncStatus` | const arrow | 1218 |
| 150 | `saveGoogleDriveSyncPreferences` | const arrow | 1252 |
| 151 | `startGoogleDriveSyncOauth` | const arrow | 1255 |
| 152 | `disconnectGoogleDriveSync` | const arrow | 1258 |
| 153 | `forgetGoogleDriveSyncCredentials` | const arrow | 1261 |
| 154 | `syncGoogleDriveNow` | const arrow | 1264 |
| 155 | `resetData` | export function | 1267 |
| 156 | `factoryReset` | export function | 1274 |
| 157 | `downloadImportTemplate` | export function | 1282 |
| 158 | `openPath` | export function | 1329 |
| 159 | `getReturns` | const arrow | 1338 |
| 160 | `createReturn` | export function | 1344 |
| 161 | `createSupplierReturn` | export function | 1350 |
| 162 | `updateSaleStatus` | const arrow | 1359 |
| 163 | `attachSaleCustomer` | const arrow | 1375 |
| 164 | `getSalesExport` | const arrow | 1399 |
| 165 | `updateReturn` | const arrow | 1403 |
| 166 | `testSyncServer` | export function | 1433 |
| 167 | `openFolderDialog` | export function | 1452 |
| 168 | `getDataPath` | const arrow | 1463 |
| 169 | `getScaleMigrationStatus` | const arrow | 1464 |
| 170 | `prepareScaleMigration` | const arrow | 1465 |
| 171 | `runScaleMigration` | const arrow | 1466 |
| 172 | `setDataPath` | export function | 1467 |
| 173 | `resetDataPath` | export function | 1472 |
| 174 | `browseDir` | const arrow | 1477 |

### 3.107 `frontend/src/api/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `shouldDebugWs` | function | 19 |
| 2 | `logWs` | function | 29 |
| 3 | `connectWS` | export function | 35 |
| 4 | `disconnectWS` | export function | 127 |
| 5 | `reconnectWS` | export function | 136 |
| 6 | `scheduleReconnect` | function | 141 |
| 7 | `isWSConnected` | export function | 157 |

### 3.108 `frontend/src/App.jsx`

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

### 3.109 `frontend/src/app/appShellUtils.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isPublicCatalogPath` | export function | 9 |
| 2 | `updateMountedPages` | export function | 19 |
| 3 | `getNotificationPrefix` | export function | 29 |
| 4 | `getNotificationColor` | export function | 36 |

### 3.110 `frontend/src/app/publicErrorRecovery.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isPublicDomMutationError` | export function | 3 |
| 2 | `shouldAttemptPublicDomRecovery` | export function | 8 |
| 3 | `clearPublicDomRecoveryMarker` | export function | 19 |

### 3.111 `frontend/src/AppContext.jsx`

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
| 28 | `onRuntimeMismatch` | const arrow | 515 |
| 29 | `onConflict` | const arrow | 521 |
| 30 | `finalizeUnauthorized` | const arrow | 581 |
| 31 | `onUnauthorized` | const arrow | 597 |
| 32 | `handleOtpLogin` | const arrow | 652 |
| 33 | `handleUserUpdated` | const arrow | 692 |
| 34 | `discoverSyncUrl` | const arrow | 726 |
| 35 | `hexAlpha` | const arrow | 871 |
| 36 | `clearCallbackUrl` | const arrow | 1057 |
| 37 | `clearPendingLink` | const arrow | 1061 |
| 38 | `run` | const arrow | 1065 |
| 39 | `useApp` | const arrow | 1372 |
| 40 | `useSync` | const arrow | 1373 |
| 41 | `useT` | const arrow | 1376 |

### 3.112 `frontend/src/components/auth/Login.jsx`

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

### 3.113 `frontend/src/components/branches/Branches.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatTransferDate` | function | 31 |
| 2 | `Branches` | export default function | 48 |
| 3 | `promise` | const arrow | 81 |
| 4 | `loadBranchStock` | const arrow | 186 |
| 5 | `loadMoreBranchStock` | const arrow | 198 |
| 6 | `handleSaveBranch` | const arrow | 216 |
| 7 | `handleDelete` | const arrow | 269 |
| 8 | `handleBulkDelete` | const arrow | 302 |
| 9 | `toggleSelect` | const arrow | 370 |
| 10 | `toggleSelectAll` | const arrow | 379 |

### 3.114 `frontend/src/components/branches/BranchForm.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BranchForm` | export default function | 11 |
| 2 | `set` | const arrow | 33 |
| 3 | `handleSave` | const arrow | 45 |

### 3.115 `frontend/src/components/branches/TransferModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `TransferModal` | export default function | 17 |
| 2 | `loadStock` | function | 61 |
| 3 | `handleTransfer` | const arrow | 106 |

### 3.116 `frontend/src/components/catalog/CatalogPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getAboutBlockLabel` | function | 89 |
| 2 | `withAssetVersion` | function | 95 |
| 3 | `tt` | function | 819 |
| 4 | `toBoolean` | function | 832 |
| 5 | `toNumber` | function | 839 |
| 6 | `normalizePriceDisplay` | function | 845 |
| 7 | `normalizeHexColor` | function | 850 |
| 8 | `normalizeExternalUrl` | function | 856 |
| 9 | `buildFaqStarterItems` | function | 872 |
| 10 | `buildAiFaqStarterItems` | function | 952 |
| 11 | `hexToRgba` | function | 983 |
| 12 | `readPortalCache` | function | 994 |
| 13 | `writePortalCache` | function | 1017 |
| 14 | `normalizePortalPath` | function | 1036 |
| 15 | `isReservedPortalPath` | function | 1049 |
| 16 | `buildDraft` | function | 1054 |
| 17 | `applyDraft` | function | 1146 |
| 18 | `getBranchQty` | function | 1270 |
| 19 | `getStockStatus` | function | 1277 |
| 20 | `normalizeProductGallery` | function | 1287 |
| 21 | `normalizePortalProductSearch` | function | 1304 |
| 22 | `buildRecommendedProductOption` | function | 1308 |
| 23 | `productMatchesRecommendedSearch` | function | 1318 |
| 24 | `formatDateTime` | function | 1333 |
| 25 | `formatPortalPrice` | function | 1340 |
| 26 | `ImageField` | function | 1353 |
| 27 | `pickImageAsDataUrl` | function | 1413 |
| 28 | `pickMultipleImagesAsDataUrls` | function | 1432 |
| 29 | `replaceVars` | function | 1453 |
| 30 | `getPortalResourceText` | function | 1457 |
| 31 | `isFirstPartyTranslateTarget` | function | 1500 |
| 32 | `normalizePortalTranslateChoice` | function | 1507 |
| 33 | `isDocumentVisible` | function | 1515 |
| 34 | `sleep` | function | 1520 |
| 35 | `CatalogPage` | export default function | 1525 |
| 36 | `copy` | const arrow | 1669 |
| 37 | `resolveVisibleTab` | const arrow | 1689 |
| 38 | `loadAssistantStatus` | function | 1778 |
| 39 | `openProductGallery` | function | 1796 |
| 40 | `changeTranslateTarget` | function | 1809 |
| 41 | `isPortalLoadCurrent` | function | 1857 |
| 42 | `loadPortalEditorData` | function | 1861 |
| 43 | `refreshPortalView` | function | 1890 |
| 44 | `loadPortal` | function | 1919 |
| 45 | `initWidget` | const arrow | 2244 |
| 46 | `waitForWidget` | const arrow | 2262 |
| 47 | `toggleFilterValue` | function | 2386 |
| 48 | `clearPortalFilters` | function | 2394 |
| 49 | `setDraft` | function | 2402 |
| 50 | `toggleRecommendedProduct` | function | 2407 |
| 51 | `openPortalImage` | function | 2416 |
| 52 | `setAboutBlocksDraft` | function | 2427 |
| 53 | `updateAboutBlock` | function | 2431 |
| 54 | `addAboutBlock` | function | 2437 |
| 55 | `moveAboutBlockBefore` | function | 2441 |
| 56 | `removeAboutBlock` | function | 2453 |
| 57 | `setFaqDraft` | function | 2457 |
| 58 | `addFaqItem` | function | 2461 |
| 59 | `mergeFaqStarterItems` | function | 2472 |
| 60 | `addFaqStarterSet` | function | 2485 |
| 61 | `addAiFaqStarterSet` | function | 2489 |
| 62 | `updateFaqItem` | function | 2493 |
| 63 | `removeFaqItem` | function | 2499 |
| 64 | `clearAssistantState` | function | 2503 |
| 65 | `uploadPortalImage` | function | 2518 |
| 66 | `uploadDraftImage` | function | 2537 |
| 67 | `uploadAboutBlockMedia` | function | 2542 |
| 68 | `openFilePicker` | function | 2551 |
| 69 | `handleFilePickerSelect` | function | 2555 |
| 70 | `savePortalDraft` | function | 2571 |
| 71 | `askAssistant` | function | 2713 |
| 72 | `refreshMembershipData` | function | 2757 |
| 73 | `handleMembershipLookup` | function | 2801 |
| 74 | `addSubmissionImages` | function | 2814 |
| 75 | `handleSubmissionPaste` | function | 2824 |
| 76 | `handleSubmitShareProof` | function | 2840 |
| 77 | `handleReviewSubmission` | function | 2884 |
| 78 | `renderCatalogSection` | function | 3040 |
| 79 | `handleUploadSubmissionImages` | const arrow | 3057 |
| 80 | `renderSecondaryTabSection` | function | 3109 |

### 3.117 `frontend/src/components/catalog/CatalogProductsSection.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBadgeIcon` | function | 9 |
| 2 | `getBadgeToneClass` | function | 17 |
| 3 | `getProductInitial` | function | 26 |
| 4 | `CatalogProductsSection` | export default function | 34 |

### 3.118 `frontend/src/components/catalog/CatalogSecondaryTabs.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CatalogMembershipSection` | function | 20 |
| 2 | `CatalogAboutSection` | function | 366 |
| 3 | `CatalogFaqSection` | function | 437 |
| 4 | `CatalogAiSection` | function | 491 |
| 5 | `CatalogSecondaryTabs` | export default function | 677 |

### 3.119 `frontend/src/components/catalog/catalogUi.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `statusClass` | function | 3 |
| 2 | `SectionShell` | export function | 10 |
| 3 | `SummaryTile` | export function | 26 |
| 4 | `StatusPill` | export function | 50 |

### 3.120 `frontend/src/components/catalog/portalCatalogDisplay.mjs`

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

### 3.121 `frontend/src/components/catalog/portalContentI18n.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isPlainObject` | function | 19 |
| 2 | `normalizeLanguageKey` | function | 23 |
| 3 | `normalizeText` | function | 32 |
| 4 | `normalizePortalTranslations` | export function | 36 |
| 5 | `stringifyPortalTranslations` | export function | 50 |
| 6 | `getLanguageBlock` | function | 56 |
| 7 | `pickTranslatedText` | function | 68 |
| 8 | `getCollectionEntry` | function | 82 |
| 9 | `localizeCollectionItems` | function | 99 |
| 10 | `localizePortalConfig` | export function | 112 |
| 11 | `getProductTranslationBlock` | function | 136 |
| 12 | `localizePortalProduct` | export function | 146 |
| 13 | `localizePortalProducts` | export function | 157 |

### 3.122 `frontend/src/components/catalog/portalEditorUtils.mjs`

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

### 3.123 `frontend/src/components/catalog/portalLanguagePacks.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeFirstPartyPortalLanguage` | export function | 769 |
| 2 | `isFirstPartyPortalLanguage` | export function | 774 |
| 3 | `getPortalLanguageText` | export function | 778 |

### 3.124 `frontend/src/components/catalog/portalTranslateController.mjs`

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

### 3.125 `frontend/src/components/contacts/contactOptionUtils.js`

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

### 3.126 `frontend/src/components/contacts/Contacts.jsx`

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

### 3.127 `frontend/src/components/contacts/CustomersTab.jsx`

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

### 3.128 `frontend/src/components/contacts/DeliveryTab.jsx`

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

### 3.129 `frontend/src/components/contacts/shared.jsx`

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

### 3.130 `frontend/src/components/contacts/SuppliersTab.jsx`

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

### 3.131 `frontend/src/components/custom-tables/CustomTables.jsx`

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

### 3.132 `frontend/src/components/dashboard/charts/BarChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BarChart` | export default function | 14 |
| 2 | `yPx` | function | 32 |

### 3.133 `frontend/src/components/dashboard/charts/DonutChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `DonutChart` | export default function | 14 |

### 3.134 `frontend/src/components/dashboard/charts/index.js`

- No top-level named symbols detected.

### 3.135 `frontend/src/components/dashboard/charts/LineChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `LineChart` | export default function | 13 |
| 2 | `xPx` | function | 35 |
| 3 | `yPx` | function | 36 |
| 4 | `handleMouseMove` | const arrow | 41 |

### 3.136 `frontend/src/components/dashboard/charts/NoData.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NoData` | export default function | 7 |

### 3.137 `frontend/src/components/dashboard/Dashboard.jsx`

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

### 3.138 `frontend/src/components/dashboard/MiniStat.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `MiniStat` | export default function | 2 |

### 3.139 `frontend/src/components/files/FilePickerModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `AssetPreview` | function | 11 |
| 2 | `FilePickerModal` | export default function | 21 |
| 3 | `tr` | const arrow | 41 |
| 4 | `toggleSelectedPath` | function | 82 |
| 5 | `handleUpload` | function | 92 |
| 6 | `handleDelete` | function | 127 |

### 3.140 `frontend/src/components/files/FilesPage.jsx`

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

### 3.141 `frontend/src/components/inventory/DualMoney.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `DualMoney` | function | 5 |

### 3.142 `frontend/src/components/inventory/Inventory.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `reuseSetWhenUnchanged` | function | 34 |
| 2 | `priceCsv` | function | 43 |
| 3 | `Inventory` | export default function | 47 |
| 4 | `promise` | const arrow | 109 |
| 5 | `handleAdjust` | const arrow | 263 |
| 6 | `openAdjust` | const arrow | 327 |
| 7 | `openMove` | const arrow | 333 |
| 8 | `handleMoveStock` | const arrow | 355 |
| 9 | `matchesSearch` | const arrow | 424 |
| 10 | `productHay` | const arrow | 431 |
| 11 | `movHay` | const arrow | 434 |

### 3.143 `frontend/src/components/inventory/InventoryImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `countCsvDataRows` | function | 11 |
| 2 | `InventoryImportModal` | export default function | 16 |
| 3 | `tr` | const arrow | 26 |
| 4 | `handlePickFile` | const arrow | 39 |
| 5 | `handleDownloadTemplate` | const arrow | 47 |
| 6 | `handleImport` | const arrow | 51 |

### 3.144 `frontend/src/components/inventory/movementGroups.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `minuteBucket` | function | 1 |
| 2 | `normalizeText` | function | 8 |
| 3 | `buildGroupKey` | function | 12 |
| 4 | `describeMovementType` | function | 27 |
| 5 | `buildMovementGroups` | export function | 38 |
| 6 | `movementGroupHaystack` | export function | 99 |

### 3.145 `frontend/src/components/inventory/ProductDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductDetailModal` | export default function | 5 |
| 2 | `T` | const arrow | 6 |

### 3.146 `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`

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

### 3.147 `frontend/src/components/navigation/Sidebar.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getFallbackLabel` | function | 49 |
| 2 | `getNavLabel` | function | 57 |
| 3 | `isDarkColor` | function | 73 |
| 4 | `withAlpha` | function | 83 |
| 5 | `mergeStyles` | function | 89 |
| 6 | `Sidebar` | export default function | 93 |

### 3.148 `frontend/src/components/pos/CartItem.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CartItem` | export default function | 3 |

### 3.149 `frontend/src/components/pos/FilterPanel.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `POSFilterPanel` | export default function | 3 |
| 2 | `T` | const arrow | 27 |
| 3 | `clearAll` | const arrow | 38 |
| 4 | `chip` | const arrow | 47 |
| 5 | `SectionLabel` | const arrow | 53 |

### 3.150 `frontend/src/components/pos/POS.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `allTermsMatch` | function | 61 |
| 2 | `useDebouncedValue` | function | 66 |
| 3 | `POS` | export default function | 75 |
| 4 | `setQuickFilter` | const arrow | 123 |
| 5 | `addNewOrder` | const arrow | 188 |
| 6 | `closeOrder` | const arrow | 200 |
| 7 | `selectCustomer` | const arrow | 494 |
| 8 | `applyCustomerOption` | const arrow | 542 |
| 9 | `clearCustomer` | const arrow | 556 |
| 10 | `handleAddCustomer` | const arrow | 564 |
| 11 | `selectDelivery` | const arrow | 585 |
| 12 | `clearDelivery` | const arrow | 590 |
| 13 | `handleAddDelivery` | const arrow | 592 |
| 14 | `qty` | const arrow | 688 |
| 15 | `addToCart` | function | 853 |
| 16 | `updateQty` | const arrow | 892 |
| 17 | `updatePrice` | const arrow | 900 |
| 18 | `updateItemBranch` | const arrow | 924 |
| 19 | `handleDiscountUsd` | const arrow | 973 |
| 20 | `handleDiscountKhr` | const arrow | 974 |
| 21 | `handleMembershipUnits` | const arrow | 975 |
| 22 | `handleCheckout` | const arrow | 1014 |

### 3.151 `frontend/src/components/pos/posCore.mjs`

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

### 3.152 `frontend/src/components/pos/ProductImage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductImage` | export default function | 3 |

### 3.153 `frontend/src/components/pos/QuickAddModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `QuickAddModal` | export default function | 4 |
| 2 | `T` | const arrow | 5 |

### 3.154 `frontend/src/components/products/barcodeImageScanner.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readFileAsDataUrl` | function | 1 |
| 2 | `createImageElement` | function | 10 |
| 3 | `loadImageSource` | function | 14 |
| 4 | `scanBarcodeFromImageFile` | export function | 23 |

### 3.155 `frontend/src/components/products/BarcodeScannerModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `stopStream` | function | 24 |
| 2 | `readCameraPermissionState` | function | 30 |
| 3 | `watchCameraPermission` | function | 40 |
| 4 | `handleChange` | const arrow | 44 |
| 5 | `BarcodeScannerModal` | export default function | 53 |

### 3.156 `frontend/src/components/products/barcodeScannerState.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `deriveScannerPresentation` | export function | 1 |

### 3.157 `frontend/src/components/products/BranchStockAdjuster.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BranchStockAdjuster` | export default function | 3 |
| 2 | `T` | const arrow | 20 |
| 3 | `setRow` | const arrow | 26 |
| 4 | `handleSave` | const arrow | 32 |

### 3.158 `frontend/src/components/products/BulkAddStockModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BulkAddStockModal` | function | 5 |
| 2 | `handleSave` | const arrow | 12 |

### 3.159 `frontend/src/components/products/BulkImportModal.jsx`

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
| 10 | `T` | const arrow | 168 |
| 11 | `resetCsvState` | const arrow | 170 |
| 12 | `pickImageDirectory` | const arrow | 190 |
| 13 | `pickImageZip` | const arrow | 214 |
| 14 | `addLibraryImages` | const arrow | 227 |
| 15 | `buildCsvForImportJob` | const arrow | 243 |
| 16 | `handleCancelCurrentJob` | const arrow | 270 |
| 17 | `handleImageOnlyImport` | const arrow | 286 |
| 18 | `handlePickCSV` | const arrow | 338 |
| 19 | `handleImport` | const arrow | 393 |
| 20 | `toggleConflictSelection` | const arrow | 481 |
| 21 | `toggleSelectAllConflicts` | const arrow | 490 |
| 22 | `applyDecisionToSelection` | const arrow | 498 |
| 23 | `applyImageDecisionToSelection` | const arrow | 508 |
| 24 | `applyIdentifierDecisionToSelection` | const arrow | 518 |
| 25 | `applyFieldRulePreset` | const arrow | 528 |

### 3.160 `frontend/src/components/products/HeaderActions.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductsHeaderActions` | export default function | 5 |
| 2 | `tr` | const arrow | 16 |

### 3.161 `frontend/src/components/products/ManageBrandsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseBrandOptions` | function | 5 |
| 2 | `toTitleCase` | function | 18 |
| 3 | `normalizeLookup` | function | 26 |
| 4 | `ManageBrandsModal` | export default function | 30 |
| 5 | `saveLibrary` | const arrow | 72 |
| 6 | `addLibraryBrand` | const arrow | 88 |
| 7 | `renameBrand` | const arrow | 110 |
| 8 | `removeBrands` | const arrow | 155 |
| 9 | `removeBrand` | const arrow | 191 |
| 10 | `toggleSelectedBrand` | const arrow | 193 |
| 11 | `toggleAllVisibleBrands` | const arrow | 202 |

### 3.162 `frontend/src/components/products/ManageCategoriesModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ManageCategoriesModal` | export default function | 13 |
| 2 | `handleAdd` | const arrow | 50 |
| 3 | `handleUpdate` | const arrow | 70 |
| 4 | `handleDelete` | const arrow | 93 |
| 5 | `toggleSelected` | const arrow | 113 |
| 6 | `toggleAllVisible` | const arrow | 123 |
| 7 | `handleDeleteSelected` | const arrow | 136 |

### 3.163 `frontend/src/components/products/ManageUnitsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ManageUnitsModal` | export default function | 7 |
| 2 | `load` | const arrow | 20 |
| 3 | `handleAdd` | const arrow | 39 |
| 4 | `handleUpdate` | const arrow | 59 |
| 5 | `handleDelete` | const arrow | 78 |
| 6 | `toggleSelected` | const arrow | 98 |
| 7 | `toggleAllVisible` | const arrow | 108 |
| 8 | `handleDeleteSelected` | const arrow | 121 |

### 3.164 `frontend/src/components/products/primitives.jsx`

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

### 3.165 `frontend/src/components/products/ProductDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductDetailModal` | export default function | 6 |
| 2 | `T` | const arrow | 18 |
| 3 | `Row` | const arrow | 33 |

### 3.166 `frontend/src/components/products/ProductForm.jsx`

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

### 3.167 `frontend/src/components/products/productHistoryHelpers.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `orderProductRestoreSnapshots` | export function | 1 |
| 2 | `createProductHistoryRequestId` | export function | 35 |

### 3.168 `frontend/src/components/products/productImportPlanner.mjs`

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
| 10 | `buildImportedIdentifierIndex` | function | 210 |
| 11 | `add` | const arrow | 213 |
| 12 | `analyzeProductImportRows` | export function | 226 |
| 13 | `analyzeProductImportText` | export function | 380 |

### 3.169 `frontend/src/components/products/productImportWorker.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `post` | function | 3 |

### 3.170 `frontend/src/components/products/Products.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `multiMatch` | function | 42 |
| 2 | `ThreeDot` | function | 46 |
| 3 | `useDebouncedValue` | function | 67 |
| 4 | `getScrollContainer` | function | 76 |
| 5 | `scrollNodeWithOffset` | function | 88 |
| 6 | `Products` | export default function | 104 |
| 7 | `promise` | const arrow | 164 |
| 8 | `handleSave` | const arrow | 288 |
| 9 | `normalizeGallery` | const arrow | 309 |
| 10 | `uploadGalleryImages` | const arrow | 325 |
| 11 | `handleSaveWithGallery` | const arrow | 347 |
| 12 | `handleBulkDelete` | const arrow | 411 |
| 13 | `handleBulkOutOfStock` | const arrow | 459 |
| 14 | `handleBulkChangeBranch` | const arrow | 502 |
| 15 | `handleBulkAddStock` | const arrow | 532 |
| 16 | `toggleSelect` | const arrow | 540 |
| 17 | `toggleSelectAll` | const arrow | 547 |
| 18 | `handleDelete` | const arrow | 554 |
| 19 | `resolveImageUrl` | const arrow | 608 |
| 20 | `getProductGallery` | const arrow | 619 |
| 21 | `renderUnitChip` | const arrow | 620 |
| 22 | `openLightbox` | const arrow | 634 |
| 23 | `getStockBadge` | const arrow | 650 |
| 24 | `toImageName` | const arrow | 701 |
| 25 | `toImageUrl` | const arrow | 702 |
| 26 | `priceCsv` | const arrow | 703 |

### 3.171 `frontend/src/components/products/scanbotScanner.mjs`

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

### 3.172 `frontend/src/components/products/VariantFormModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `VariantFormModal` | export default function | 8 |
| 2 | `tr` | const arrow | 10 |
| 3 | `setField` | const arrow | 36 |
| 4 | `setNumeric` | const arrow | 37 |
| 5 | `handleSave` | const arrow | 39 |

### 3.173 `frontend/src/components/receipt-settings/AllFieldsPanel.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Toggle` | function | 5 |
| 2 | `AllFieldsPanel` | export default function | 21 |
| 3 | `T` | const arrow | 23 |
| 4 | `toggleSection` | const arrow | 42 |

### 3.174 `frontend/src/components/receipt-settings/constants.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getFieldItems` | export function | 52 |
| 2 | `T` | const arrow | 53 |

### 3.175 `frontend/src/components/receipt-settings/ErrorBoundary.jsx`

- No top-level named symbols detected.

### 3.176 `frontend/src/components/receipt-settings/FieldOrderManager.jsx`

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

### 3.177 `frontend/src/components/receipt-settings/PrintSettings.jsx`

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

### 3.178 `frontend/src/components/receipt-settings/ReceiptPreview.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ReceiptPreview` | export default function | 9 |
| 2 | `loadPreview` | function | 20 |

### 3.179 `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Section` | function | 15 |
| 2 | `Toggle` | function | 26 |
| 3 | `ReceiptSettings` | export default function | 41 |
| 4 | `handleSave` | const arrow | 155 |

### 3.180 `frontend/src/components/receipt-settings/template.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseReceiptTemplate` | export function | 3 |
| 2 | `serializeReceiptTemplate` | export function | 14 |

### 3.181 `frontend/src/components/receipt/Receipt.jsx`

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

### 3.182 `frontend/src/components/returns/EditReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `EditReturnModal` | function | 6 |
| 2 | `T` | const arrow | 8 |
| 3 | `updateQty` | const arrow | 33 |
| 4 | `updateRestock` | const arrow | 36 |
| 5 | `handleSubmit` | const arrow | 44 |

### 3.183 `frontend/src/components/returns/NewReturnModal.jsx`

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

### 3.184 `frontend/src/components/returns/NewSupplierReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NewSupplierReturnModal` | export default function | 10 |
| 2 | `tr` | const arrow | 12 |
| 3 | `loadSetup` | function | 45 |
| 4 | `loadInventory` | function | 86 |
| 5 | `updateQty` | const arrow | 150 |
| 6 | `submit` | const arrow | 156 |

### 3.185 `frontend/src/components/returns/ReturnDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeScope` | function | 6 |
| 2 | `ReturnDetailModal` | export default function | 10 |
| 3 | `tr` | const arrow | 12 |

### 3.186 `frontend/src/components/returns/Returns.jsx`

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

### 3.187 `frontend/src/components/sales/ExportModal.jsx`

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

### 3.188 `frontend/src/components/sales/SaleDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `InfoBlock` | function | 5 |
| 2 | `parseItems` | function | 21 |
| 3 | `SaleDetailModal` | export default function | 31 |
| 4 | `translateOr` | const arrow | 47 |
| 5 | `handleStatusUpdate` | const arrow | 69 |
| 6 | `handleMembershipAttach` | const arrow | 80 |

### 3.189 `frontend/src/components/sales/Sales.jsx`

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

### 3.190 `frontend/src/components/sales/SalesImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `countCsvDataRows` | function | 11 |
| 2 | `SalesImportModal` | export default function | 16 |
| 3 | `tr` | const arrow | 26 |
| 4 | `handlePickFile` | const arrow | 39 |
| 5 | `handleDownloadTemplate` | const arrow | 47 |
| 6 | `handleImport` | const arrow | 51 |

### 3.191 `frontend/src/components/sales/StatusBadge.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getStatusLabel` | export function | 23 |
| 2 | `StatusBadge` | export default function | 39 |

### 3.192 `frontend/src/components/server/ServerPage.jsx`

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

### 3.193 `frontend/src/components/shared/ActionHistoryBar.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatHistoryList` | function | 5 |
| 2 | `formatServerStatus` | function | 9 |
| 3 | `ActionHistoryBar` | export default function | 16 |
| 4 | `T` | const arrow | 26 |

### 3.194 `frontend/src/components/shared/BackgroundImportTracker.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeJobStatus` | function | 11 |
| 2 | `dedupeJobsById` | function | 15 |
| 3 | `isRecent` | function | 27 |
| 4 | `getJobProgressDetails` | function | 33 |
| 5 | `getJobLabel` | function | 94 |
| 6 | `getJobResultSummary` | function | 100 |
| 7 | `add` | const arrow | 103 |
| 8 | `getRowsDisplay` | function | 116 |
| 9 | `buildJobsSignature` | function | 132 |
| 10 | `BackgroundImportTracker` | export default function | 147 |
| 11 | `handleCancel` | const arrow | 241 |
| 12 | `handleRetry` | const arrow | 255 |
| 13 | `handleApprove` | const arrow | 269 |
| 14 | `handleDownloadErrors` | const arrow | 283 |
| 15 | `handleRemove` | const arrow | 295 |

### 3.195 `frontend/src/components/shared/ExportMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ExportMenu` | export default function | 4 |

### 3.196 `frontend/src/components/shared/FilterMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sectionButtonClass` | function | 4 |
| 2 | `FilterMenu` | export default function | 10 |

### 3.197 `frontend/src/components/shared/ImageGalleryLightbox.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ImageGalleryLightbox` | export default function | 8 |
| 2 | `formatLabel` | function | 30 |
| 3 | `setIndex` | function | 34 |
| 4 | `renderGalleryImage` | function | 40 |
| 5 | `onKeyDown` | function | 47 |

### 3.198 `frontend/src/components/shared/Modal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Modal` | export default function | 10 |

### 3.199 `frontend/src/components/shared/navigationConfig.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseNavSetting` | export function | 23 |
| 2 | `orderNavItems` | export function | 32 |

### 3.200 `frontend/src/components/shared/NotificationCenter.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `preferenceValue` | function | 103 |
| 2 | `matchesVisibilityMode` | function | 110 |
| 3 | `getRealertMs` | function | 117 |
| 4 | `NotificationCenter` | export default function | 123 |
| 5 | `syncVisibility` | const arrow | 157 |
| 6 | `onVisible` | const arrow | 213 |
| 7 | `handleClickOutside` | const arrow | 236 |

### 3.201 `frontend/src/components/shared/pageActivity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `useIsPageActive` | export function | 4 |

### 3.202 `frontend/src/components/shared/PageHeader.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PageHeader` | export default function | 9 |

### 3.203 `frontend/src/components/shared/PageHelpButton.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PageHelpButton` | export default function | 6 |

### 3.204 `frontend/src/components/shared/pageHelpContent.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getPageHelpContent` | export function | 442 |

### 3.205 `frontend/src/components/shared/PaginationControls.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `clampPage` | export function | 5 |
| 2 | `paginateItems` | export function | 11 |
| 3 | `PaginationControls` | export default function | 19 |

### 3.206 `frontend/src/components/shared/PortalMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PortalMenu` | export default function | 11 |
| 2 | `closeIfClickedOutside` | const arrow | 63 |
| 3 | `closeMenu` | const arrow | 70 |
| 4 | `scheduleReposition` | const arrow | 71 |
| 5 | `closeIfEscape` | const arrow | 78 |
| 6 | `ThreeDotPortal` | export function | 180 |

### 3.207 `frontend/src/components/shared/QuickPreferenceToggles.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ToggleButton` | function | 4 |
| 2 | `QuickPreferenceToggles` | export default function | 23 |
| 3 | `tr` | const arrow | 25 |

### 3.208 `frontend/src/components/shared/WriteConflictModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatConflictTime` | function | 3 |
| 2 | `summarizeCurrentValue` | function | 10 |
| 3 | `formatValue` | function | 66 |
| 4 | `getConflictFieldRows` | function | 73 |
| 5 | `WriteConflictModal` | export default function | 171 |

### 3.209 `frontend/src/components/users/PermissionEditor.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PermissionEditor` | export default function | 15 |
| 2 | `translate` | const arrow | 16 |
| 3 | `labelFor` | const arrow | 22 |
| 4 | `toggle` | const arrow | 25 |

### 3.210 `frontend/src/components/users/UserDetailSheet.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `translateLabel` | function | 4 |
| 2 | `buildRowData` | function | 9 |
| 3 | `UserDetailSheet` | export default function | 21 |

### 3.211 `frontend/src/components/users/UserProfileModal.jsx`

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

### 3.212 `frontend/src/components/users/Users.jsx`

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

### 3.213 `frontend/src/components/utils-settings/AuditLog.jsx`

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

### 3.214 `frontend/src/components/utils-settings/Backup.jsx`

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
| 32 | `Backup` | export default function | 1235 |
| 33 | `loadHostConfig` | function | 1268 |
| 34 | `browseServerFolders` | const arrow | 1282 |
| 35 | `toggleServerBrowser` | const arrow | 1304 |
| 36 | `handleExport` | const arrow | 1318 |
| 37 | `pickFolder` | const arrow | 1339 |
| 38 | `handleFolderExport` | const arrow | 1352 |
| 39 | `handleFolderImport` | const arrow | 1377 |
| 40 | `handleChooseImportFile` | const arrow | 1405 |
| 41 | `handleConfirmImport` | const arrow | 1425 |

### 3.215 `frontend/src/components/utils-settings/FontFamilyPicker.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `FontFamilyPicker` | function | 20 |

### 3.216 `frontend/src/components/utils-settings/index.js`

- No top-level named symbols detected.

### 3.217 `frontend/src/components/utils-settings/OtpModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `OtpModal` | export default function | 12 |
| 2 | `loadSetup` | function | 47 |

### 3.218 `frontend/src/components/utils-settings/ResetData.jsx`

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

### 3.219 `frontend/src/components/utils-settings/Settings.jsx`

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

### 3.220 `frontend/src/constants.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createEmptyOrder` | export function | 127 |
| 2 | `formatDate` | export function | 157 |
| 3 | `isNetworkError` | export function | 177 |

### 3.221 `frontend/src/index.jsx`

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

### 3.222 `frontend/src/platform/runtime/clientRuntime.js`

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

### 3.223 `frontend/src/platform/storage/storagePolicy.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `shouldPersistLocalMirror` | export function | 22 |
| 2 | `maxStoredNumber` | export function | 26 |
| 3 | `isCooldownActive` | export function | 33 |

### 3.224 `frontend/src/runtime/runtimeErrorClassifier.mjs`

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

### 3.225 `frontend/src/utils/actionHistory.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeEntry` | function | 3 |
| 2 | `useActionHistory` | export function | 16 |

### 3.226 `frontend/src/utils/appRefresh.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `refreshAppData` | export function | 18 |

### 3.227 `frontend/src/utils/color.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeHex` | function | 1 |
| 2 | `relativeLuminance` | function | 12 |
| 3 | `getContrastingTextColor` | export function | 27 |

### 3.228 `frontend/src/utils/csv.js`

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

### 3.229 `frontend/src/utils/csvImport.js`

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

### 3.230 `frontend/src/utils/dateHelpers.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `todayStr` | export function | 10 |
| 2 | `offsetDate` | export function | 20 |

### 3.231 `frontend/src/utils/deviceInfo.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getClientDeviceInfo` | export function | 1 |
| 2 | `getClientMetaHeaders` | export function | 24 |

### 3.232 `frontend/src/utils/exportPackage.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildReportManifestRows` | export function | 3 |
| 2 | `buildReportPackageFiles` | export function | 11 |

### 3.233 `frontend/src/utils/exportReports.jsx`

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

### 3.234 `frontend/src/utils/favicon.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `clamp` | function | 1 |
| 2 | `loadImage` | function | 5 |
| 3 | `createCircularFaviconDataUrl` | export function | 19 |

### 3.235 `frontend/src/utils/formatters.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fmtTime` | export function | 9 |
| 2 | `fmtDate` | export function | 25 |
| 3 | `fmtShort` | export function | 39 |
| 4 | `fmtCount` | export function | 51 |

### 3.236 `frontend/src/utils/groupedRecords.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toDate` | function | 3 |
| 2 | `normalizeName` | function | 22 |
| 3 | `getAlphabetInitialSection` | export function | 26 |
| 4 | `compareAlphabetLabels` | function | 30 |
| 5 | `getTimeParts` | export function | 34 |
| 6 | `matchesYearMonthFilters` | export function | 66 |
| 7 | `getAvailableYears` | export function | 73 |
| 8 | `getTimeGroupingMode` | export function | 82 |
| 9 | `buildTimeActionSections` | export function | 88 |
| 10 | `getSortTime` | const arrow | 100 |
| 11 | `compareItemsByTime` | const arrow | 105 |
| 12 | `buildAlphabetActionSections` | export function | 211 |
| 13 | `compareItems` | const arrow | 232 |
| 14 | `toggleIdSet` | export function | 260 |

### 3.237 `frontend/src/utils/historyHelpers.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cloneHistorySnapshot` | export function | 1 |
| 2 | `extractHistoryResultId` | export function | 6 |
| 3 | `resolveCreatedHistorySnapshot` | export function | 16 |

### 3.238 `frontend/src/utils/index.js`

- No top-level named symbols detected.

### 3.239 `frontend/src/utils/initials.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeInitialText` | export function | 16 |
| 2 | `getInitialKey` | export function | 20 |
| 3 | `getInitialType` | export function | 31 |
| 4 | `compareInitialKeys` | export function | 40 |
| 5 | `rank` | const arrow | 44 |
| 6 | `aggregateInitialOptions` | export function | 64 |

### 3.240 `frontend/src/utils/loaders.mjs`

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

### 3.241 `frontend/src/utils/pricing.js`

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

### 3.242 `frontend/src/utils/printReceipt.js`

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

### 3.243 `frontend/src/utils/productGrouping.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeText` | function | 3 |
| 2 | `normalizeProductGroupName` | export function | 21 |
| 3 | `getNameInitialSection` | export function | 25 |
| 4 | `compareSectionLabels` | function | 29 |
| 5 | `compareProducts` | function | 33 |
| 6 | `buildChildrenByParentId` | function | 56 |
| 7 | `resolveRootProduct` | function | 67 |
| 8 | `resolveFamilyRootId` | function | 85 |
| 9 | `compareProductsWithinGroup` | function | 89 |
| 10 | `resolveGroupKey` | function | 104 |
| 11 | `buildProductGroups` | export function | 124 |
| 12 | `buildProductGroupSections` | export function | 212 |

### 3.244 `frontend/src/web-api.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getStoredAuthToken` | function | 27 |

### 3.245 `frontend/tailwind.config.mjs`

- No top-level named symbols detected.

### 3.246 `frontend/tests/apiHttp.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 18 |
| 2 | `createDeferredResponse` | function | 29 |
| 3 | `resetApiState` | function | 40 |

### 3.247 `frontend/tests/appShellUtils.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.248 `frontend/tests/barcodeImageScanner.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.249 `frontend/tests/barcodeScannerState.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.250 `frontend/tests/csvImport.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.251 `frontend/tests/exportPackages.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 7 |

### 3.252 `frontend/tests/groupedRecords.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.253 `frontend/tests/historyHelpers.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 10 |

### 3.254 `frontend/tests/loaders.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.255 `frontend/tests/portalCatalogDisplay.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |
| 2 | `copy` | const arrow | 25 |
| 3 | `formatPortalPrice` | const arrow | 26 |

### 3.256 `frontend/tests/portalContentI18n.test.mjs`

- No top-level named symbols detected.

### 3.257 `frontend/tests/portalEditorUtils.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |

### 3.258 `frontend/tests/portalLanguagePacks.test.mjs`

- No top-level named symbols detected.

### 3.259 `frontend/tests/portalTranslateController.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createStorage` | function | 17 |
| 2 | `createDocument` | function | 32 |

### 3.260 `frontend/tests/posCore.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 15 |

### 3.261 `frontend/tests/pricingContacts.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |

### 3.262 `frontend/tests/productGrouping.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.263 `frontend/tests/productHistoryHelpers.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.264 `frontend/tests/productImportPlanner.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.265 `frontend/tests/publicErrorRecovery.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createStorage` | function | 8 |

### 3.266 `frontend/tests/receiptTemplate.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 7 |

### 3.267 `frontend/tests/runtimeErrorClassifier.test.mjs`

- No top-level named symbols detected.

### 3.268 `frontend/tests/scanbotScanner.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `setNavigator` | function | 8 |
| 2 | `run` | function | 16 |

### 3.269 `frontend/tests/storagePolicy.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 13 |

### 3.270 `frontend/vite.config.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readGitRevision` | function | 6 |
| 2 | `fixCrossorigin` | function | 44 |
| 3 | `emitBuildManifest` | function | 69 |
| 4 | `manualChunks` | function | 86 |

### 3.271 `ops/scripts/backend/verify-data-integrity.js`

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

### 3.272 `ops/scripts/frontend/verify-i18n.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `collectUsedKeys` | function | 29 |
| 2 | `flattenTranslationTree` | function | 69 |
| 3 | `listMissing` | function | 83 |
| 4 | `listEmptyValues` | function | 88 |
| 5 | `printList` | function | 95 |
| 6 | `main` | function | 102 |

### 3.273 `ops/scripts/frontend/verify-performance.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `read` | function | 15 |
| 2 | `walk` | function | 19 |
| 3 | `trackedFiles` | function | 37 |
| 4 | `assert` | function | 47 |

### 3.274 `ops/scripts/frontend/verify-ui.js`

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

### 3.275 `ops/scripts/generate-doc-reference.js`

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
| 16 | `writeModuleNamingGuide` | function | 374 |
| 17 | `writeProjectCodeReference` | function | 422 |
| 18 | `main` | function | 463 |

### 3.276 `ops/scripts/generate-full-project-docs.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ensureDir` | function | 44 |
| 2 | `toPosix` | function | 48 |
| 3 | `rel` | function | 52 |
| 4 | `shouldSkipDir` | function | 56 |
| 5 | `collectFilesAndFolders` | function | 60 |
| 6 | `getAllProjectFilesAndFolders` | function | 81 |
| 7 | `isProbablyText` | function | 104 |
| 8 | `readText` | function | 117 |
| 9 | `lineCount` | function | 125 |
| 10 | `fileCategory` | function | 130 |
| 11 | `inferPurpose` | function | 151 |
| 12 | `markdownHeader` | function | 175 |
| 13 | `markdownSection` | function | 179 |
| 14 | `extractImportsExports` | function | 183 |
| 15 | `findSymbols` | function | 223 |
| 16 | `writeAllFunctionReference` | function | 249 |
| 17 | `resolveInternalImport` | function | 287 |
| 18 | `writeAllFileInventory` | function | 310 |
| 19 | `folderPurpose` | function | 332 |
| 20 | `writeFolderCoverage` | function | 349 |
| 21 | `writeImportExportReference` | function | 408 |
| 22 | `readJsonObject` | function | 482 |
| 23 | `translationSectionForKey` | function | 490 |
| 24 | `writeTranslationSectionReference` | function | 541 |
| 25 | `writeMainCoverageSummary` | function | 590 |
| 26 | `main` | function | 619 |

### 3.277 `ops/scripts/lib/fs-utils.js`

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

### 3.278 `ops/scripts/performance-scan.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `kb` | function | 43 |
| 2 | `topN` | function | 48 |
| 3 | `main` | function | 56 |

### 3.279 `ops/scripts/runtime/check-public-url.mjs`

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

### 3.280 `ops/scripts/runtime/check-route-contract.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fail` | function | 16 |
| 2 | `checkRoute` | function | 21 |
| 3 | `main` | function | 47 |

### 3.281 `ops/scripts/runtime/rotate-cloudflare-tunnel-token.mjs`

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

### 3.282 `ops/scripts/runtime/update-cloudflare-tunnel-origin.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readEnvFile` | function | 10 |
| 2 | `parseArgs` | function | 25 |
| 3 | `readToken` | function | 36 |
| 4 | `ensureIngress` | function | 42 |
| 5 | `main` | function | 58 |
| 6 | `requestJson` | function | 103 |

### 3.283 `ops/scripts/verify-docker-release.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `read` | function | 33 |
| 2 | `requireFile` | function | 37 |
| 3 | `main` | function | 41 |

### 3.284 `ops/scripts/verify-runtime-deps.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readJson` | function | 22 |
| 2 | `assertTrackedFile` | function | 26 |
| 3 | `hasLockDependency` | function | 32 |
| 4 | `main` | function | 38 |

### 3.285 `ops/scripts/verify-scale-services.js`

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

