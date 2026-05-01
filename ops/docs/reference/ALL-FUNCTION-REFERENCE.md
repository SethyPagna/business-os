# All Function Reference (Project First-Party Code)

Auto-generated function/class symbol commentary for all first-party code files (frontend, backend, root scripts/config code).

## 1. Coverage Summary

Code files scanned: **252**

## 2. Symbol Count by File

| No. | File | Symbols |
|---:|---|---:|
| 1 | `backend/server.js` | 14 |
| 2 | `backend/src/accessControl.js` | 16 |
| 3 | `backend/src/authOtpGuards.js` | 3 |
| 4 | `backend/src/backupSchema.js` | 3 |
| 5 | `backend/src/config/index.js` | 23 |
| 6 | `backend/src/conflictControl.js` | 5 |
| 7 | `backend/src/contactOptions.js` | 8 |
| 8 | `backend/src/database.js` | 13 |
| 9 | `backend/src/dataPath/index.js` | 9 |
| 10 | `backend/src/fileAssets.js` | 24 |
| 11 | `backend/src/helpers.js` | 18 |
| 12 | `backend/src/idempotency.js` | 1 |
| 13 | `backend/src/importCsv.js` | 8 |
| 14 | `backend/src/importParsing.js` | 6 |
| 15 | `backend/src/middleware.js` | 21 |
| 16 | `backend/src/money.js` | 3 |
| 17 | `backend/src/netSecurity.js` | 7 |
| 18 | `backend/src/organizationContext/index.js` | 14 |
| 19 | `backend/src/portalUtils.js` | 6 |
| 20 | `backend/src/productDiscounts.js` | 9 |
| 21 | `backend/src/productImportPolicies.js` | 8 |
| 22 | `backend/src/requestContext.js` | 5 |
| 23 | `backend/src/routes/actionHistory.js` | 7 |
| 24 | `backend/src/routes/ai.js` | 2 |
| 25 | `backend/src/routes/auth.js` | 26 |
| 26 | `backend/src/routes/branches.js` | 2 |
| 27 | `backend/src/routes/catalog.js` | 0 |
| 28 | `backend/src/routes/categories.js` | 2 |
| 29 | `backend/src/routes/contacts.js` | 14 |
| 30 | `backend/src/routes/customTables.js` | 8 |
| 31 | `backend/src/routes/files.js` | 3 |
| 32 | `backend/src/routes/importJobs.js` | 6 |
| 33 | `backend/src/routes/inventory.js` | 4 |
| 34 | `backend/src/routes/notifications.js` | 10 |
| 35 | `backend/src/routes/organizations.js` | 0 |
| 36 | `backend/src/routes/portal.js` | 25 |
| 37 | `backend/src/routes/products.js` | 34 |
| 38 | `backend/src/routes/returns.js` | 7 |
| 39 | `backend/src/routes/sales.js` | 14 |
| 40 | `backend/src/routes/settings.js` | 5 |
| 41 | `backend/src/routes/system/index.js` | 38 |
| 42 | `backend/src/routes/units.js` | 3 |
| 43 | `backend/src/routes/users.js` | 21 |
| 44 | `backend/src/runtimeState/index.js` | 6 |
| 45 | `backend/src/security.js` | 13 |
| 46 | `backend/src/serverUtils.js` | 22 |
| 47 | `backend/src/services/aiGateway.js` | 12 |
| 48 | `backend/src/services/firebaseAuth.js` | 22 |
| 49 | `backend/src/services/googleDriveSync/index.js` | 49 |
| 50 | `backend/src/services/importJobs.js` | 57 |
| 51 | `backend/src/services/portalAi.js` | 29 |
| 52 | `backend/src/services/supabaseAuth.js` | 37 |
| 53 | `backend/src/services/verification.js` | 21 |
| 54 | `backend/src/sessionAuth.js` | 8 |
| 55 | `backend/src/settingsSnapshot.js` | 7 |
| 56 | `backend/src/storage/organizationFolders.js` | 5 |
| 57 | `backend/src/systemFsWorker.js` | 7 |
| 58 | `backend/src/uploadReferenceCleanup.js` | 2 |
| 59 | `backend/src/uploadSecurity.js` | 7 |
| 60 | `backend/src/websocket.js` | 1 |
| 61 | `backend/test/accessControl.test.js` | 2 |
| 62 | `backend/test/authOtpGuards.test.js` | 1 |
| 63 | `backend/test/authSecurityFlow.test.js` | 8 |
| 64 | `backend/test/backupRoundtrip.test.js` | 12 |
| 65 | `backend/test/backupSchema.test.js` | 1 |
| 66 | `backend/test/configOrganizationRuntime.test.js` | 2 |
| 67 | `backend/test/contactOptions.test.js` | 1 |
| 68 | `backend/test/dataPath.test.js` | 2 |
| 69 | `backend/test/fileRouteSecurityFlow.test.js` | 9 |
| 70 | `backend/test/idempotency.test.js` | 1 |
| 71 | `backend/test/importCsv.test.js` | 1 |
| 72 | `backend/test/netSecurity.test.js` | 1 |
| 73 | `backend/test/portalUtils.test.js` | 1 |
| 74 | `backend/test/productImportPolicies.test.js` | 1 |
| 75 | `backend/test/serverUtils.test.js` | 1 |
| 76 | `backend/test/stockConsistency.test.js` | 26 |
| 77 | `backend/test/systemRouteSecurity.test.js` | 9 |
| 78 | `backend/test/uploadSecurity.test.js` | 1 |
| 79 | `frontend/postcss.config.mjs` | 0 |
| 80 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.js` | 0 |
| 81 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.worker.js` | 0 |
| 82 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd-threads.js` | 0 |
| 83 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd.js` | 0 |
| 84 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core.js` | 0 |
| 85 | `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js` | 0 |
| 86 | `frontend/public/sw.js` | 3 |
| 87 | `frontend/public/theme-bootstrap.js` | 4 |
| 88 | `frontend/src/api/http.js` | 48 |
| 89 | `frontend/src/api/localDb.js` | 10 |
| 90 | `frontend/src/api/methods.js` | 164 |
| 91 | `frontend/src/api/websocket.js` | 7 |
| 92 | `frontend/src/App.jsx` | 38 |
| 93 | `frontend/src/app/appShellUtils.mjs` | 4 |
| 94 | `frontend/src/AppContext.jsx` | 40 |
| 95 | `frontend/src/components/auth/Login.jsx` | 21 |
| 96 | `frontend/src/components/branches/Branches.jsx` | 9 |
| 97 | `frontend/src/components/branches/BranchForm.jsx` | 3 |
| 98 | `frontend/src/components/branches/TransferModal.jsx` | 3 |
| 99 | `frontend/src/components/catalog/CatalogPage.jsx` | 75 |
| 100 | `frontend/src/components/catalog/CatalogProductsSection.jsx` | 3 |
| 101 | `frontend/src/components/catalog/CatalogSecondaryTabs.jsx` | 5 |
| 102 | `frontend/src/components/catalog/catalogUi.jsx` | 4 |
| 103 | `frontend/src/components/catalog/portalCatalogDisplay.mjs` | 8 |
| 104 | `frontend/src/components/catalog/portalEditorUtils.mjs` | 8 |
| 105 | `frontend/src/components/contacts/contactOptionUtils.js` | 9 |
| 106 | `frontend/src/components/contacts/Contacts.jsx` | 8 |
| 107 | `frontend/src/components/contacts/CustomersTab.jsx` | 21 |
| 108 | `frontend/src/components/contacts/DeliveryTab.jsx` | 23 |
| 109 | `frontend/src/components/contacts/shared.jsx` | 17 |
| 110 | `frontend/src/components/contacts/SuppliersTab.jsx` | 15 |
| 111 | `frontend/src/components/custom-tables/CustomTables.jsx` | 11 |
| 112 | `frontend/src/components/dashboard/charts/BarChart.jsx` | 2 |
| 113 | `frontend/src/components/dashboard/charts/DonutChart.jsx` | 1 |
| 114 | `frontend/src/components/dashboard/charts/index.js` | 0 |
| 115 | `frontend/src/components/dashboard/charts/LineChart.jsx` | 4 |
| 116 | `frontend/src/components/dashboard/charts/NoData.jsx` | 1 |
| 117 | `frontend/src/components/dashboard/Dashboard.jsx` | 8 |
| 118 | `frontend/src/components/dashboard/MiniStat.jsx` | 1 |
| 119 | `frontend/src/components/files/FilePickerModal.jsx` | 6 |
| 120 | `frontend/src/components/files/FilesPage.jsx` | 15 |
| 121 | `frontend/src/components/inventory/DualMoney.jsx` | 1 |
| 122 | `frontend/src/components/inventory/Inventory.jsx` | 12 |
| 123 | `frontend/src/components/inventory/InventoryImportModal.jsx` | 6 |
| 124 | `frontend/src/components/inventory/movementGroups.js` | 6 |
| 125 | `frontend/src/components/inventory/ProductDetailModal.jsx` | 2 |
| 126 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | 8 |
| 127 | `frontend/src/components/navigation/Sidebar.jsx` | 6 |
| 128 | `frontend/src/components/pos/CartItem.jsx` | 1 |
| 129 | `frontend/src/components/pos/FilterPanel.jsx` | 5 |
| 130 | `frontend/src/components/pos/POS.jsx` | 21 |
| 131 | `frontend/src/components/pos/posCore.mjs` | 8 |
| 132 | `frontend/src/components/pos/ProductImage.jsx` | 1 |
| 133 | `frontend/src/components/pos/QuickAddModal.jsx` | 2 |
| 134 | `frontend/src/components/products/barcodeImageScanner.mjs` | 4 |
| 135 | `frontend/src/components/products/BarcodeScannerModal.jsx` | 5 |
| 136 | `frontend/src/components/products/barcodeScannerState.mjs` | 1 |
| 137 | `frontend/src/components/products/BranchStockAdjuster.jsx` | 4 |
| 138 | `frontend/src/components/products/BulkAddStockModal.jsx` | 2 |
| 139 | `frontend/src/components/products/BulkImportModal.jsx` | 25 |
| 140 | `frontend/src/components/products/HeaderActions.jsx` | 2 |
| 141 | `frontend/src/components/products/ManageBrandsModal.jsx` | 8 |
| 142 | `frontend/src/components/products/ManageCategoriesModal.jsx` | 4 |
| 143 | `frontend/src/components/products/ManageUnitsModal.jsx` | 5 |
| 144 | `frontend/src/components/products/primitives.jsx` | 9 |
| 145 | `frontend/src/components/products/ProductDetailModal.jsx` | 3 |
| 146 | `frontend/src/components/products/ProductForm.jsx` | 18 |
| 147 | `frontend/src/components/products/productHistoryHelpers.mjs` | 2 |
| 148 | `frontend/src/components/products/productImportPlanner.mjs` | 11 |
| 149 | `frontend/src/components/products/productImportWorker.mjs` | 1 |
| 150 | `frontend/src/components/products/Products.jsx` | 25 |
| 151 | `frontend/src/components/products/scanbotScanner.mjs` | 9 |
| 152 | `frontend/src/components/products/VariantFormModal.jsx` | 5 |
| 153 | `frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | 4 |
| 154 | `frontend/src/components/receipt-settings/constants.js` | 2 |
| 155 | `frontend/src/components/receipt-settings/ErrorBoundary.jsx` | 0 |
| 156 | `frontend/src/components/receipt-settings/FieldOrderManager.jsx` | 9 |
| 157 | `frontend/src/components/receipt-settings/PrintSettings.jsx` | 8 |
| 158 | `frontend/src/components/receipt-settings/ReceiptPreview.jsx` | 2 |
| 159 | `frontend/src/components/receipt-settings/ReceiptSettings.jsx` | 4 |
| 160 | `frontend/src/components/receipt-settings/template.js` | 2 |
| 161 | `frontend/src/components/receipt/Receipt.jsx` | 8 |
| 162 | `frontend/src/components/returns/EditReturnModal.jsx` | 5 |
| 163 | `frontend/src/components/returns/NewReturnModal.jsx` | 10 |
| 164 | `frontend/src/components/returns/NewSupplierReturnModal.jsx` | 6 |
| 165 | `frontend/src/components/returns/ReturnDetailModal.jsx` | 3 |
| 166 | `frontend/src/components/returns/Returns.jsx` | 8 |
| 167 | `frontend/src/components/sales/ExportModal.jsx` | 9 |
| 168 | `frontend/src/components/sales/SaleDetailModal.jsx` | 6 |
| 169 | `frontend/src/components/sales/Sales.jsx` | 10 |
| 170 | `frontend/src/components/sales/SalesImportModal.jsx` | 7 |
| 171 | `frontend/src/components/sales/StatusBadge.jsx` | 2 |
| 172 | `frontend/src/components/server/ServerPage.jsx` | 15 |
| 173 | `frontend/src/components/shared/ActionHistoryBar.jsx` | 4 |
| 174 | `frontend/src/components/shared/ExportMenu.jsx` | 1 |
| 175 | `frontend/src/components/shared/FilterMenu.jsx` | 2 |
| 176 | `frontend/src/components/shared/ImageGalleryLightbox.jsx` | 5 |
| 177 | `frontend/src/components/shared/Modal.jsx` | 1 |
| 178 | `frontend/src/components/shared/navigationConfig.js` | 2 |
| 179 | `frontend/src/components/shared/NotificationCenter.jsx` | 6 |
| 180 | `frontend/src/components/shared/pageActivity.js` | 1 |
| 181 | `frontend/src/components/shared/PageHeader.jsx` | 1 |
| 182 | `frontend/src/components/shared/PageHelpButton.jsx` | 1 |
| 183 | `frontend/src/components/shared/pageHelpContent.js` | 1 |
| 184 | `frontend/src/components/shared/PortalMenu.jsx` | 6 |
| 185 | `frontend/src/components/shared/QuickPreferenceToggles.jsx` | 3 |
| 186 | `frontend/src/components/shared/WriteConflictModal.jsx` | 5 |
| 187 | `frontend/src/components/users/PermissionEditor.jsx` | 4 |
| 188 | `frontend/src/components/users/UserDetailSheet.jsx` | 3 |
| 189 | `frontend/src/components/users/UserProfileModal.jsx` | 22 |
| 190 | `frontend/src/components/users/Users.jsx` | 15 |
| 191 | `frontend/src/components/utils-settings/AuditLog.jsx` | 12 |
| 192 | `frontend/src/components/utils-settings/Backup.jsx` | 41 |
| 193 | `frontend/src/components/utils-settings/FontFamilyPicker.jsx` | 1 |
| 194 | `frontend/src/components/utils-settings/index.js` | 0 |
| 195 | `frontend/src/components/utils-settings/OtpModal.jsx` | 2 |
| 196 | `frontend/src/components/utils-settings/ResetData.jsx` | 8 |
| 197 | `frontend/src/components/utils-settings/Settings.jsx` | 20 |
| 198 | `frontend/src/constants.js` | 3 |
| 199 | `frontend/src/index.jsx` | 13 |
| 200 | `frontend/src/platform/runtime/clientRuntime.js` | 15 |
| 201 | `frontend/src/platform/storage/storagePolicy.mjs` | 3 |
| 202 | `frontend/src/utils/actionHistory.mjs` | 2 |
| 203 | `frontend/src/utils/appRefresh.js` | 1 |
| 204 | `frontend/src/utils/color.js` | 3 |
| 205 | `frontend/src/utils/csv.js` | 11 |
| 206 | `frontend/src/utils/csvImport.js` | 15 |
| 207 | `frontend/src/utils/dateHelpers.js` | 2 |
| 208 | `frontend/src/utils/deviceInfo.js` | 2 |
| 209 | `frontend/src/utils/exportPackage.js` | 2 |
| 210 | `frontend/src/utils/exportReports.jsx` | 9 |
| 211 | `frontend/src/utils/favicon.js` | 3 |
| 212 | `frontend/src/utils/formatters.js` | 4 |
| 213 | `frontend/src/utils/groupedRecords.mjs` | 14 |
| 214 | `frontend/src/utils/historyHelpers.mjs` | 3 |
| 215 | `frontend/src/utils/index.js` | 0 |
| 216 | `frontend/src/utils/loaders.mjs` | 8 |
| 217 | `frontend/src/utils/pricing.js` | 8 |
| 218 | `frontend/src/utils/printReceipt.js` | 34 |
| 219 | `frontend/src/utils/productGrouping.mjs` | 12 |
| 220 | `frontend/src/web-api.js` | 4 |
| 221 | `frontend/tailwind.config.mjs` | 0 |
| 222 | `frontend/tests/apiHttp.test.mjs` | 3 |
| 223 | `frontend/tests/appShellUtils.test.mjs` | 1 |
| 224 | `frontend/tests/barcodeImageScanner.test.mjs` | 1 |
| 225 | `frontend/tests/barcodeScannerState.test.mjs` | 1 |
| 226 | `frontend/tests/csvImport.test.mjs` | 1 |
| 227 | `frontend/tests/exportPackages.test.mjs` | 1 |
| 228 | `frontend/tests/groupedRecords.test.mjs` | 1 |
| 229 | `frontend/tests/historyHelpers.test.mjs` | 1 |
| 230 | `frontend/tests/loaders.test.mjs` | 1 |
| 231 | `frontend/tests/portalCatalogDisplay.test.mjs` | 3 |
| 232 | `frontend/tests/portalEditorUtils.test.mjs` | 1 |
| 233 | `frontend/tests/posCore.test.mjs` | 1 |
| 234 | `frontend/tests/pricingContacts.test.mjs` | 1 |
| 235 | `frontend/tests/productGrouping.test.mjs` | 1 |
| 236 | `frontend/tests/productHistoryHelpers.test.mjs` | 1 |
| 237 | `frontend/tests/productImportPlanner.test.mjs` | 1 |
| 238 | `frontend/tests/receiptTemplate.test.mjs` | 1 |
| 239 | `frontend/tests/scanbotScanner.test.mjs` | 2 |
| 240 | `frontend/tests/storagePolicy.test.mjs` | 1 |
| 241 | `frontend/vite.config.mjs` | 2 |
| 242 | `ops/scripts/backend/verify-data-integrity.js` | 10 |
| 243 | `ops/scripts/frontend/verify-i18n.js` | 6 |
| 244 | `ops/scripts/frontend/verify-performance.js` | 4 |
| 245 | `ops/scripts/frontend/verify-ui.js` | 13 |
| 246 | `ops/scripts/generate-doc-reference.js` | 18 |
| 247 | `ops/scripts/generate-full-project-docs.js` | 26 |
| 248 | `ops/scripts/lib/fs-utils.js` | 8 |
| 249 | `ops/scripts/performance-scan.js` | 3 |
| 250 | `ops/scripts/runtime/check-public-url.mjs` | 10 |
| 251 | `ops/scripts/verify-runtime-deps.js` | 4 |
| 252 | `ops/scripts/verify-scale-services.js` | 8 |

## 3. Detailed Function Commentary

### 3.1 `backend/server.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadCompressionMiddleware` | function | 41 |
| 2 | `applySecurityHeaders` | function | 50 |
| 3 | `applyRequestPolicy` | function | 56 |
| 4 | `applyCoreMiddleware` | function | 66 |
| 5 | `mountStaticAssets` | function | 80 |
| 6 | `mountHealthRoute` | function | 94 |
| 7 | `mountApiRoutes` | function | 106 |
| 8 | `mountTransfersAlias` | function | 136 |
| 9 | `mountSpaFallback` | function | 151 |
| 10 | `mountErrorHandler` | function | 170 |
| 11 | `getStartupBanner` | function | 184 |
| 12 | `closeDatabase` | function | 205 |
| 13 | `registerShutdownHandlers` | function | 212 |
| 14 | `bootstrapServer` | function | 230 |

### 3.2 `backend/src/accessControl.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 19 |
| 2 | `normalizeHostname` | function | 23 |
| 3 | `getConfiguredSyncToken` | function | 29 |
| 4 | `getRequestHost` | function | 33 |
| 5 | `getRemoteAddress` | function | 39 |
| 6 | `isLoopbackAddress` | function | 47 |
| 7 | `getPresentedSyncToken` | function | 54 |
| 8 | `getTailscaleIdentity` | function | 60 |
| 9 | `hasTrustedTailscaleIdentity` | function | 69 |
| 10 | `isLocalHostRequest` | function | 76 |
| 11 | `isTsNetHost` | function | 81 |
| 12 | `getConfiguredTailscaleHost` | function | 86 |
| 13 | `isPublicRemoteRequest` | function | 90 |
| 14 | `isPublicApiRequest` | function | 98 |
| 15 | `classifyRequestAccess` | function | 104 |
| 16 | `authorizeProtectedRequest` | function | 132 |

### 3.3 `backend/src/authOtpGuards.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeUserId` | function | 5 |
| 2 | `canManageOtpTarget` | function | 10 |
| 3 | `requiresSelfOtpDisablePassword` | function | 20 |

### 3.4 `backend/src/backupSchema.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `countRowsByTable` | function | 69 |
| 2 | `countCustomTableRows` | function | 77 |
| 3 | `buildBackupSummary` | function | 83 |

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
| 1 | `tableHasColumn` | function | 830 |
| 2 | `ensureColumn` | function | 840 |
| 3 | `normalizeUserPhoneLookup` | function | 861 |
| 4 | `slugifyOrgName` | function | 866 |
| 5 | `generateOrgPublicId` | function | 875 |
| 6 | `seedIfEmpty` | function | 1004 |
| 7 | `ensureDefaultOrganizationAndGroup` | function | 1015 |
| 8 | `ensurePrimaryAdminRoleAndUser` | function | 1087 |
| 9 | `buildDefaultSettingsSeed` | function | 1138 |
| 10 | `ensureDefaultSettings` | function | 1268 |
| 11 | `ensureDefaultBranches` | function | 1279 |
| 12 | `ensureDefaultUnits` | function | 1285 |
| 13 | `ensureCoreDataInvariants` | function | 1291 |

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
| 7 | `tryParse` | function | 121 |
| 8 | `today` | function | 126 |
| 9 | `parseCSVRows` | function | 138 |
| 10 | `bulkImportCSV` | function | 162 |
| 11 | `parseCSVLine` | function | 188 |
| 12 | `importRows` | function | 208 |
| 13 | `verifyAndRepairStockQuantities` | function | 223 |
| 14 | `verifyAndRepairSaleStatuses` | function | 281 |
| 15 | `verifyAndRepairCostPrices` | function | 341 |
| 16 | `runDataIntegrityCheck` | function | 423 |
| 17 | `getSafeCostPrice` | function | 450 |
| 18 | `calculateSaleProfit` | function | 461 |

### 3.12 `backend/src/idempotency.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeClientRequestId` | function | 3 |

### 3.13 `backend/src/importCsv.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `stripBom` | function | 7 |
| 2 | `normalizeDigit` | function | 11 |
| 3 | `normalizeNumericText` | function | 19 |
| 4 | `countDelimiter` | function | 26 |
| 5 | `detectCsvDelimiter` | function | 45 |
| 6 | `parseDelimitedRows` | function | 52 |
| 7 | `normalizeCsvKey` | function | 97 |
| 8 | `parseCsvRows` | function | 105 |

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
| 7 | `mapRow` | function | 49 |

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
| 9 | `loginIdentifierPreview` | function | 153 |
| 10 | `rejectLogin` | function | 167 |
| 11 | `getOtpSecret` | function | 189 |
| 12 | `requireOtpActor` | function | 193 |
| 13 | `getOtpTargetUser` | function | 199 |
| 14 | `buildUserPayload` | function | 214 |
| 15 | `resolveOrganizationLookup` | function | 246 |
| 16 | `findUserByIdentifier` | function | 252 |
| 17 | `getExactActiveUserById` | function | 321 |
| 18 | `normalizeOauthMode` | function | 336 |
| 19 | `isEmailIdentifier` | function | 341 |
| 20 | `getUserById` | function | 345 |
| 21 | `getSettingsSnapshot` | function | 349 |
| 22 | `getBootstrapSystemSnapshot` | function | 358 |
| 23 | `buildAuthenticatedBootstrap` | function | 390 |
| 24 | `generateTemporaryAuthPassword` | function | 419 |
| 25 | `issueAuthSession` | function | 423 |
| 26 | `updateLocalUserSupabaseIdentity` | function | 434 |

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
| 5 | `normalizeFieldRule` | function | 48 |
| 6 | `resolveFieldValue` | function | 55 |
| 7 | `buildImportRows` | function | 66 |
| 8 | `normalizeConflictMode` | function | 76 |
| 9 | `toNumber` | function | 81 |
| 10 | `loadPointPolicy` | function | 86 |
| 11 | `calculatePolicyPoints` | function | 112 |
| 12 | `findExisting` | const arrow | 271 |
| 13 | `findExisting` | const arrow | 481 |
| 14 | `findExisting` | const arrow | 665 |

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
| 1 | `ensureDir` | function | 28 |
| 2 | `getJobUploadRoot` | function | 32 |
| 3 | `getJobOr404` | function | 37 |
| 4 | `isAllowedImportFile` | function | 66 |
| 5 | `parsePolicy` | function | 90 |
| 6 | `parseRelativePaths` | function | 96 |

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
| 1 | `normalizeBoolean` | function | 19 |
| 2 | `toNumber` | function | 27 |
| 3 | `loadNotificationPreferences` | function | 32 |
| 4 | `loadPointPolicy` | function | 55 |
| 5 | `calculatePolicyPoints` | function | 81 |
| 6 | `buildInventorySection` | function | 86 |
| 7 | `buildSalesSection` | function | 162 |
| 8 | `buildLoyaltySection` | function | 229 |
| 9 | `buildPortalSection` | function | 316 |
| 10 | `buildSystemSection` | function | 353 |

### 3.35 `backend/src/routes/organizations.js`

- No top-level named symbols detected.

### 3.36 `backend/src/routes/portal.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toNumber` | function | 23 |
| 2 | `normalizeBoolean` | function | 29 |
| 3 | `normalizePhone` | function | 35 |
| 4 | `normalizePublicPath` | function | 40 |
| 5 | `normalizeUrl` | function | 54 |
| 6 | `normalizeRedeemValueUsd` | function | 69 |
| 7 | `normalizeRedeemValueKhr` | function | 74 |
| 8 | `normalizeHexColor` | function | 81 |
| 9 | `normalizeFaqItems` | function | 87 |
| 10 | `normalizeProductIdList` | function | 100 |
| 11 | `loadSettingsMap` | function | 115 |
| 12 | `buildPortalConfig` | function | 123 |
| 13 | `buildRankMap` | function | 248 |
| 14 | `getPortalProductSignals` | function | 267 |
| 15 | `calculatePointsValue` | function | 365 |
| 16 | `summarizePoints` | function | 375 |
| 17 | `getPortalProducts` | function | 415 |
| 18 | `getPortalCatalogMeta` | function | 490 |
| 19 | `findCustomerByMembership` | function | 536 |
| 20 | `sanitizeScreenshots` | function | 546 |
| 21 | `materializePortalScreenshots` | function | 555 |
| 22 | `sanitizeAiProfile` | function | 573 |
| 23 | `getVisitorFingerprint` | function | 585 |
| 24 | `getClientKey` | function | 591 |
| 25 | `applyPortalRateLimit` | function | 596 |

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
| 24 | `resolveImage` | const arrow | 772 |
| 25 | `ensureCategory` | const arrow | 788 |
| 26 | `ensureUnit` | const arrow | 802 |
| 27 | `ensureBrand` | const arrow | 816 |
| 28 | `ensureSupplier` | const arrow | 828 |
| 29 | `determineBranch` | const arrow | 839 |
| 30 | `handleBranch` | const arrow | 858 |
| 31 | `isDirectImageRef` | const arrow | 883 |
| 32 | `normalizeDirectImageRef` | const arrow | 894 |
| 33 | `parseIncomingImageRefs` | const arrow | 901 |
| 34 | `loadCurrentGallery` | const arrow | 934 |

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

### 3.39 `backend/src/routes/sales.js`

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

### 3.40 `backend/src/routes/settings.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLookup` | function | 11 |
| 2 | `normalizeBrandOptionsValue` | function | 15 |
| 3 | `settingsHasUpdatedAt` | function | 39 |
| 4 | `getSettingsSnapshot` | function | 48 |
| 5 | `getSettingsUpdatedAt` | function | 55 |

### 3.41 `backend/src/routes/system/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `q` | function | 75 |
| 2 | `getClientKey` | function | 79 |
| 3 | `applyRouteRateLimit` | function | 85 |
| 4 | `runFsWorker` | function | 97 |
| 5 | `finish` | const arrow | 109 |
| 6 | `getHostUiAvailability` | function | 153 |
| 7 | `buildRequestBaseUrl` | function | 162 |
| 8 | `resolveDriveRedirectUri` | function | 169 |
| 9 | `getTableColumns` | function | 176 |
| 10 | `getSafeTableCount` | function | 180 |
| 11 | `buildMigrationTableCounts` | function | 188 |
| 12 | `safeJsonParse` | function | 208 |
| 13 | `readSystemSettings` | function | 217 |
| 14 | `writeSystemSettings` | function | 228 |
| 15 | `getMigrationSafetyBackupDestination` | function | 243 |
| 16 | `getMigrationSafetyState` | function | 247 |
| 17 | `createMigrationSafetyBackup` | function | 269 |
| 18 | `runMigrationSafetyDriveSync` | function | 287 |
| 19 | `runMigrationSafetyAutomation` | function | 325 |
| 20 | `buildScaleMigrationStatus` | function | 340 |
| 21 | `extractUploadPathsFromText` | function | 390 |
| 22 | `collectBackupUploads` | function | 399 |
| 23 | `addUpload` | const arrow | 403 |
| 24 | `restoreBackupUploads` | function | 433 |
| 25 | `deleteAllUploads` | function | 443 |
| 26 | `getBackupDataRootCandidate` | function | 452 |
| 27 | `readBackupTablesFromDataRoot` | function | 464 |
| 28 | `restoreUploadsFromDataRoot` | function | 497 |
| 29 | `restoreSnapshotTables` | function | 511 |
| 30 | `replaceTableRows` | function | 567 |
| 31 | `normaliseBackupTables` | function | 602 |
| 32 | `normaliseBackupCustomTableRows` | function | 631 |
| 33 | `repairRelationalConsistency` | function | 636 |
| 34 | `getCustomTableNames` | function | 644 |
| 35 | `parseCustomTableDefinition` | function | 650 |
| 36 | `recreateCustomTable` | function | 693 |
| 37 | `listWindowsFsRoots` | const arrow | 1334 |
| 38 | `listDriveRoots` | const arrow | 1351 |

### 3.42 `backend/src/routes/units.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLookup` | function | 12 |
| 2 | `normalizeUnitColor` | function | 16 |
| 3 | `updateUnitHandler` | function | 50 |

### 3.43 `backend/src/routes/users.js`

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

### 3.44 `backend/src/runtimeState/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ensureRuntimeMetaDir` | function | 11 |
| 2 | `readRuntimeState` | function | 15 |
| 3 | `writeRuntimeState` | function | 32 |
| 4 | `getRuntimeState` | function | 38 |
| 5 | `bumpStorageVersion` | function | 48 |
| 6 | `buildRuntimeDescriptor` | function | 57 |

### 3.45 `backend/src/security.js`

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

### 3.46 `backend/src/serverUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildOriginFromParts` | function | 13 |
| 2 | `parseOriginHost` | function | 24 |
| 3 | `normalizeConfiguredHost` | function | 34 |
| 4 | `isAllowedRequestOrigin` | function | 44 |
| 5 | `isAllowedWebSocketOrigin` | function | 54 |
| 6 | `hostIsLoopbackPair` | function | 72 |
| 7 | `getTrustedDocumentOrigins` | function | 77 |
| 8 | `addOrigin` | const arrow | 79 |
| 9 | `buildPermissionsPolicy` | function | 105 |
| 10 | `sanitizeObjectKeys` | function | 134 |
| 11 | `sanitizeStringValue` | function | 153 |
| 12 | `sanitizeRequestPayload` | function | 159 |
| 13 | `sanitizeDeepStrings` | function | 166 |
| 14 | `isApiOrHealthPath` | function | 183 |
| 15 | `isSpaFallbackEligible` | function | 187 |
| 16 | `setNoStoreHeaders` | function | 195 |
| 17 | `setHtmlNoCacheHeaders` | function | 199 |
| 18 | `isCustomerPortalRoutePath` | function | 205 |
| 19 | `setTunnelSecurityHeaders` | function | 210 |
| 20 | `setFrontendStaticHeaders` | function | 251 |
| 21 | `setUploadStaticHeaders` | function | 269 |
| 22 | `mapServerError` | function | 276 |

### 3.47 `backend/src/services/aiGateway.js`

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

### 3.48 `backend/src/services/firebaseAuth.js`

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

### 3.49 `backend/src/services/googleDriveSync/index.js`

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

### 3.50 `backend/src/services/importJobs.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 42 |
| 2 | `safeJson` | function | 46 |
| 3 | `stringify` | function | 51 |
| 4 | `ensureDir` | function | 55 |
| 5 | `ensureImportRoot` | function | 59 |
| 6 | `getJobRoot` | function | 63 |
| 7 | `createImportJob` | function | 67 |
| 8 | `getImportJob` | function | 87 |
| 9 | `listImportJobs` | function | 97 |
| 10 | `updateJob` | function | 110 |
| 11 | `addJobError` | function | 135 |
| 12 | `getJobErrors` | function | 142 |
| 13 | `addJobFile` | function | 152 |
| 14 | `getJobFiles` | function | 171 |
| 15 | `markJobCancelled` | function | 176 |
| 16 | `isCancelled` | function | 180 |
| 17 | `normalizeLookup` | function | 184 |
| 18 | `normalizeText` | function | 188 |
| 19 | `getMimeTypeFromName` | function | 192 |
| 20 | `normalizeProductSignature` | function | 246 |
| 21 | `chooseParentProduct` | function | 254 |
| 22 | `normalizeImportAction` | function | 268 |
| 23 | `parseOptionalImportId` | function | 276 |
| 24 | `parseIncomingImageRefs` | function | 281 |
| 25 | `syncProductImageGallery` | function | 315 |
| 26 | `loadCurrentGallery` | function | 338 |
| 27 | `ensureParentProductExists` | function | 345 |
| 28 | `assertUniqueProductFields` | function | 354 |
| 29 | `copyImageIntoAssets` | function | 380 |
| 30 | `resolveImageGallery` | function | 398 |
| 31 | `ensureSettingOptionMap` | function | 444 |
| 32 | `upsertSettingJson` | function | 454 |
| 33 | `normalizeRowForProduct` | function | 461 |
| 34 | `createProductContext` | function | 506 |
| 35 | `ensureCategory` | function | 528 |
| 36 | `ensureUnit` | function | 540 |
| 37 | `ensureBrand` | function | 551 |
| 38 | `ensureSupplier` | function | 563 |
| 39 | `determineBranch` | function | 574 |
| 40 | `handleBranchStock` | function | 589 |
| 41 | `recalcProductStock` | function | 607 |
| 42 | `insertInventoryMovement` | function | 616 |
| 43 | `seedBranchRows` | function | 640 |
| 44 | `processProductRow` | function | 645 |
| 45 | `processProductRows` | function | 863 |
| 46 | `buildImageLookup` | function | 926 |
| 47 | `normalizeImageMatchKey` | function | 941 |
| 48 | `processImageOnlyFiles` | function | 951 |
| 49 | `extractZipImages` | function | 1009 |
| 50 | `processImportJob` | function | 1079 |
| 51 | `runLocalJob` | function | 1137 |
| 52 | `initializeBullQueue` | function | 1143 |
| 53 | `enqueueImportJob` | function | 1176 |
| 54 | `recoverImportJobs` | function | 1203 |
| 55 | `getQueueStatus` | function | 1217 |
| 56 | `buildErrorsCsv` | function | 1227 |
| 57 | `escape` | const arrow | 1229 |

### 3.51 `backend/src/services/portalAi.js`

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

### 3.52 `backend/src/services/supabaseAuth.js`

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

### 3.53 `backend/src/services/verification.js`

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

### 3.54 `backend/src/sessionAuth.js`

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

### 3.55 `backend/src/settingsSnapshot.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeUploadPublicPath` | function | 7 |
| 2 | `isUploadPublicPath` | function | 15 |
| 3 | `sanitizeMediaPath` | function | 20 |
| 4 | `sanitizeMediaList` | function | 27 |
| 5 | `uploadPublicPathExists` | function | 40 |
| 6 | `sanitizeSettingValue` | function | 52 |
| 7 | `sanitizeSettingsSnapshot` | function | 56 |

### 3.56 `backend/src/storage/organizationFolders.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 6 |
| 2 | `sanitizeOrganizationFolderLabel` | function | 10 |
| 3 | `buildOrganizationFolderName` | function | 20 |
| 4 | `extractOrganizationPublicId` | function | 26 |
| 5 | `findOrganizationFolderByPublicId` | function | 33 |

### 3.57 `backend/src/systemFsWorker.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatBackupStamp` | function | 15 |
| 2 | `pad` | const arrow | 17 |
| 3 | `respond` | function | 21 |
| 4 | `fail` | function | 25 |
| 5 | `runExportFolder` | function | 30 |
| 6 | `runRelocateDataRoot` | function | 70 |
| 7 | `main` | function | 77 |

### 3.58 `backend/src/uploadReferenceCleanup.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `safeJsonArray` | function | 10 |
| 2 | `repairMissingUploadReferences` | function | 19 |

### 3.59 `backend/src/uploadSecurity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `bufferStartsWith` | function | 11 |
| 2 | `isLikelyCsvBuffer` | function | 15 |
| 3 | `detectBufferKind` | function | 28 |
| 4 | `getExpectedUploadedKind` | function | 42 |
| 5 | `validateImageMetadata` | function | 51 |
| 6 | `validateUploadedBuffer` | function | 65 |
| 7 | `validateUploadedPath` | function | 76 |

### 3.60 `backend/src/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `attachWss` | function | 24 |

### 3.61 `backend/test/accessControl.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |
| 2 | `makeReq` | function | 22 |

### 3.62 `backend/test/authOtpGuards.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |

### 3.63 `backend/test/authSecurityFlow.test.js`

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

### 3.64 `backend/test/backupRoundtrip.test.js`

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

### 3.65 `backend/test/backupSchema.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.66 `backend/test/configOrganizationRuntime.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |
| 2 | `makeTempRoot` | function | 23 |

### 3.67 `backend/test/contactOptions.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.68 `backend/test/dataPath.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 16 |
| 2 | `makeTempRoot` | function | 27 |

### 3.69 `backend/test/fileRouteSecurityFlow.test.js`

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

### 3.70 `backend/test/idempotency.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.71 `backend/test/importCsv.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |

### 3.72 `backend/test/netSecurity.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |

### 3.73 `backend/test/portalUtils.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.74 `backend/test/productImportPolicies.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 15 |

### 3.75 `backend/test/serverUtils.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 17 |

### 3.76 `backend/test/stockConsistency.test.js`

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

### 3.77 `backend/test/systemRouteSecurity.test.js`

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

### 3.78 `backend/test/uploadSecurity.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.79 `frontend/postcss.config.mjs`

- No top-level named symbols detected.

### 3.80 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.js`

- No top-level named symbols detected.

### 3.81 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.worker.js`

- No top-level named symbols detected.

### 3.82 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd-threads.js`

- No top-level named symbols detected.

### 3.83 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd.js`

- No top-level named symbols detected.

### 3.84 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core.js`

- No top-level named symbols detected.

### 3.85 `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js`

- No top-level named symbols detected.

### 3.86 `frontend/public/sw.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isSameOrigin` | function | 38 |
| 2 | `isCacheableStaticPath` | function | 46 |
| 3 | `networkFirstStatic` | function | 52 |

### 3.87 `frontend/public/theme-bootstrap.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isInjectedRuntimeNoise` | function | 11 |
| 2 | `hasInjectedBundleSource` | function | 23 |
| 3 | `isGuardableSheetError` | function | 32 |
| 4 | `installStyleSheetGuards` | function | 53 |

### 3.88 `frontend/src/api/http.js`

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
| 22 | `requireLiveServerWrite` | export function | 171 |
| 23 | `getConflictRefreshChannels` | function | 203 |
| 24 | `dispatchGlobalDataRefresh` | function | 212 |
| 25 | `sleep` | function | 221 |
| 26 | `hasUsableLocalData` | function | 225 |
| 27 | `tryServerReadWithRetry` | function | 232 |
| 28 | `resolveLocalRead` | function | 242 |
| 29 | `stableStringifyForDedupe` | function | 249 |
| 30 | `clampDedupeBody` | function | 259 |
| 31 | `buildApiRequestDedupeKey` | export function | 265 |
| 32 | `__resetApiWriteDedupeForTests` | export function | 271 |
| 33 | `apiFetch` | export function | 276 |
| 34 | `requestPromise` | const arrow | 289 |
| 35 | `parsed` | const arrow | 314 |
| 36 | `isNetErr` | export function | 365 |
| 37 | `isConnectivityError` | function | 371 |
| 38 | `isServerOnline` | export function | 390 |
| 39 | `setServerHealth` | function | 392 |
| 40 | `pingServerHealth` | function | 404 |
| 41 | `startHealthCheck` | export function | 427 |
| 42 | `cacheGetStale` | export function | 458 |
| 43 | `getChannelRefreshKey` | function | 467 |
| 44 | `emitCacheRefresh` | function | 471 |
| 45 | `clearInflight` | function | 485 |
| 46 | `hasReusableInflight` | function | 490 |
| 47 | `raceServerReadWithLocalFallback` | function | 500 |
| 48 | `route` | export function | 572 |

### 3.89 `frontend/src/api/localDb.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `localGetSettings` | export function | 107 |
| 2 | `localSaveSettings` | export function | 114 |
| 3 | `localGetSettingsMeta` | export function | 122 |
| 4 | `localSaveSettingsMeta` | export function | 126 |
| 5 | `replaceTableContents` | export function | 136 |
| 6 | `resetLocalMirrorDb` | export function | 180 |
| 7 | `clearLocalMirrorTables` | export function | 192 |
| 8 | `parseCSV` | export function | 218 |
| 9 | `splitCSVLine` | function | 231 |
| 10 | `buildCSVTemplate` | export function | 242 |

### 3.90 `frontend/src/api/methods.js`

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
| 81 | `getImportQueueStatus` | const arrow | 726 |
| 82 | `downloadImportJobErrors` | export function | 728 |
| 83 | `uploadImportJobCsv` | export function | 747 |
| 84 | `uploadImportJobZip` | export function | 753 |
| 85 | `uploadImportJobImages` | export function | 760 |
| 86 | `getFiles` | export function | 784 |
| 87 | `uploadFileAsset` | export function | 790 |
| 88 | `deleteFileAsset` | export function | 824 |
| 89 | `uploadProductImage` | export function | 836 |
| 90 | `uploadUserAvatar` | export function | 870 |
| 91 | `openCSVDialog` | export function | 911 |
| 92 | `openImageDialog` | export function | 931 |
| 93 | `getImageDataUrl` | export function | 939 |
| 94 | `getActionHistory` | const arrow | 950 |
| 95 | `updateActionHistory` | const arrow | 954 |
| 96 | `getInventorySummary` | const arrow | 956 |
| 97 | `getInventoryMovements` | const arrow | 957 |
| 98 | `createSale` | export function | 960 |
| 99 | `getSales` | const arrow | 965 |
| 100 | `getDashboard` | const arrow | 972 |
| 101 | `getAnalytics` | const arrow | 973 |
| 102 | `getCustomers` | const arrow | 982 |
| 103 | `createCustomer` | export function | 983 |
| 104 | `updateCustomer` | const arrow | 987 |
| 105 | `deleteCustomer` | const arrow | 991 |
| 106 | `downloadCustomerTemplate` | const arrow | 996 |
| 107 | `getSuppliers` | const arrow | 1004 |
| 108 | `createSupplier` | export function | 1005 |
| 109 | `updateSupplier` | const arrow | 1009 |
| 110 | `deleteSupplier` | const arrow | 1013 |
| 111 | `downloadSupplierTemplate` | const arrow | 1018 |
| 112 | `getDeliveryContacts` | const arrow | 1026 |
| 113 | `createDeliveryContact` | export function | 1027 |
| 114 | `updateDeliveryContact` | const arrow | 1031 |
| 115 | `deleteDeliveryContact` | const arrow | 1035 |
| 116 | `getUsers` | const arrow | 1042 |
| 117 | `updateUser` | const arrow | 1044 |
| 118 | `getUserProfile` | const arrow | 1045 |
| 119 | `getUserAuthMethods` | const arrow | 1046 |
| 120 | `updateUserProfile` | const arrow | 1048 |
| 121 | `disconnectUserAuthProvider` | const arrow | 1050 |
| 122 | `changeUserPassword` | const arrow | 1052 |
| 123 | `resetPassword` | const arrow | 1054 |
| 124 | `getRoles` | const arrow | 1057 |
| 125 | `updateRole` | const arrow | 1059 |
| 126 | `deleteRole` | const arrow | 1060 |
| 127 | `getCustomTables` | const arrow | 1063 |
| 128 | `getCustomTableData` | const arrow | 1065 |
| 129 | `insertCustomRow` | const arrow | 1066 |
| 130 | `updateCustomRow` | const arrow | 1067 |
| 131 | `deleteCustomRow` | const arrow | 1068 |
| 132 | `getAuditLogs` | const arrow | 1071 |
| 133 | `exportBackup` | export function | 1074 |
| 134 | `exportBackupFolder` | export function | 1091 |
| 135 | `pickBackupFile` | export function | 1095 |
| 136 | `importBackupData` | export function | 1110 |
| 137 | `importBackupFolder` | export function | 1117 |
| 138 | `importBackup` | export function | 1124 |
| 139 | `getGoogleDriveSyncStatus` | const arrow | 1139 |
| 140 | `saveGoogleDriveSyncPreferences` | const arrow | 1173 |
| 141 | `startGoogleDriveSyncOauth` | const arrow | 1176 |
| 142 | `disconnectGoogleDriveSync` | const arrow | 1179 |
| 143 | `forgetGoogleDriveSyncCredentials` | const arrow | 1182 |
| 144 | `syncGoogleDriveNow` | const arrow | 1185 |
| 145 | `resetData` | export function | 1188 |
| 146 | `factoryReset` | export function | 1195 |
| 147 | `downloadImportTemplate` | export function | 1203 |
| 148 | `openPath` | export function | 1246 |
| 149 | `getReturns` | const arrow | 1255 |
| 150 | `createReturn` | export function | 1261 |
| 151 | `createSupplierReturn` | export function | 1267 |
| 152 | `updateSaleStatus` | const arrow | 1276 |
| 153 | `attachSaleCustomer` | const arrow | 1292 |
| 154 | `getSalesExport` | const arrow | 1316 |
| 155 | `updateReturn` | const arrow | 1320 |
| 156 | `testSyncServer` | export function | 1350 |
| 157 | `openFolderDialog` | export function | 1369 |
| 158 | `getDataPath` | const arrow | 1380 |
| 159 | `getScaleMigrationStatus` | const arrow | 1381 |
| 160 | `prepareScaleMigration` | const arrow | 1382 |
| 161 | `runScaleMigration` | const arrow | 1383 |
| 162 | `setDataPath` | export function | 1384 |
| 163 | `resetDataPath` | export function | 1389 |
| 164 | `browseDir` | const arrow | 1394 |

### 3.91 `frontend/src/api/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `shouldDebugWs` | function | 19 |
| 2 | `logWs` | function | 29 |
| 3 | `connectWS` | export function | 35 |
| 4 | `disconnectWS` | export function | 127 |
| 5 | `reconnectWS` | export function | 136 |
| 6 | `scheduleReconnect` | function | 141 |
| 7 | `isWSConnected` | export function | 157 |

### 3.92 `frontend/src/App.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getChunkErrorMessage` | function | 69 |
| 2 | `isChunkLoadError` | function | 74 |
| 3 | `createChunkTimeoutError` | function | 83 |
| 4 | `isRetryableImportError` | function | 89 |
| 5 | `importWithTimeout` | function | 97 |
| 6 | `clearRetryMarker` | function | 113 |
| 7 | `triggerChunkRecoveryReload` | function | 120 |
| 8 | `createChunkReloadStallError` | function | 130 |
| 9 | `shouldRetryChunk` | function | 136 |
| 10 | `lazyWithRetry` | function | 146 |
| 11 | `getWarmupImporters` | function | 213 |
| 12 | `shouldSkipBackgroundWarmup` | function | 225 |
| 13 | `getDataWarmupLoaders` | function | 234 |
| 14 | `createWarmupLoader` | function | 243 |
| 15 | `runWarmupBatches` | function | 248 |
| 16 | `getPageEntryWarmupLoaders` | function | 257 |
| 17 | `useMountedPages` | function | 264 |
| 18 | `useSyncErrorBanner` | function | 278 |
| 19 | `onSyncError` | const arrow | 283 |
| 20 | `onSyncRecovered` | const arrow | 284 |
| 21 | `useVisibilityRecovery` | function | 305 |
| 22 | `onVisible` | const arrow | 309 |
| 23 | `onFocus` | const arrow | 319 |
| 24 | `useChunkWarmup` | function | 337 |
| 25 | `runWarmup` | const arrow | 350 |
| 26 | `useDataWarmup` | function | 379 |
| 27 | `runWarmup` | const arrow | 390 |
| 28 | `usePageEntryWarmup` | function | 415 |
| 29 | `run` | const arrow | 434 |
| 30 | `PageErrorBoundary` | class | 450 |
| 31 | `Notification` | function | 498 |
| 32 | `SyncErrorBanner` | function | 510 |
| 33 | `ReadOnlyServerBanner` | function | 532 |
| 34 | `PageLoader` | function | 540 |
| 35 | `PageSlot` | function | 567 |
| 36 | `PublicCatalogView` | function | 590 |
| 37 | `App` | export default function | 603 |
| 38 | `loadFavicon` | function | 661 |

### 3.93 `frontend/src/app/appShellUtils.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isPublicCatalogPath` | export function | 9 |
| 2 | `updateMountedPages` | export function | 19 |
| 3 | `getNotificationPrefix` | export function | 29 |
| 4 | `getNotificationColor` | export function | 36 |

### 3.94 `frontend/src/AppContext.jsx`

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
| 31 | `handleOtpLogin` | const arrow | 639 |
| 32 | `handleUserUpdated` | const arrow | 679 |
| 33 | `discoverSyncUrl` | const arrow | 713 |
| 34 | `hexAlpha` | const arrow | 858 |
| 35 | `clearCallbackUrl` | const arrow | 1044 |
| 36 | `clearPendingLink` | const arrow | 1048 |
| 37 | `run` | const arrow | 1052 |
| 38 | `useApp` | const arrow | 1359 |
| 39 | `useSync` | const arrow | 1360 |
| 40 | `useT` | const arrow | 1363 |

### 3.95 `frontend/src/components/auth/Login.jsx`

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

### 3.96 `frontend/src/components/branches/Branches.jsx`

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

### 3.97 `frontend/src/components/branches/BranchForm.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BranchForm` | export default function | 11 |
| 2 | `set` | const arrow | 33 |
| 3 | `handleSave` | const arrow | 45 |

### 3.98 `frontend/src/components/branches/TransferModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `TransferModal` | export default function | 17 |
| 2 | `loadStock` | function | 61 |
| 3 | `handleTransfer` | const arrow | 106 |

### 3.99 `frontend/src/components/catalog/CatalogPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getAboutBlockLabel` | function | 60 |
| 2 | `withAssetVersion` | function | 66 |
| 3 | `tt` | function | 788 |
| 4 | `toBoolean` | function | 801 |
| 5 | `toNumber` | function | 808 |
| 6 | `normalizePriceDisplay` | function | 814 |
| 7 | `normalizeHexColor` | function | 819 |
| 8 | `normalizeExternalUrl` | function | 825 |
| 9 | `buildFaqStarterItems` | function | 841 |
| 10 | `buildAiFaqStarterItems` | function | 921 |
| 11 | `hexToRgba` | function | 952 |
| 12 | `readPortalCache` | function | 963 |
| 13 | `writePortalCache` | function | 979 |
| 14 | `normalizePortalPath` | function | 993 |
| 15 | `isReservedPortalPath` | function | 1006 |
| 16 | `buildDraft` | function | 1011 |
| 17 | `applyDraft` | function | 1102 |
| 18 | `getBranchQty` | function | 1225 |
| 19 | `getStockStatus` | function | 1232 |
| 20 | `normalizeProductGallery` | function | 1242 |
| 21 | `formatDateTime` | function | 1260 |
| 22 | `formatPortalPrice` | function | 1267 |
| 23 | `ImageField` | function | 1280 |
| 24 | `pickImageAsDataUrl` | function | 1340 |
| 25 | `pickMultipleImagesAsDataUrls` | function | 1359 |
| 26 | `replaceVars` | function | 1380 |
| 27 | `applyGoogleTranslateSelection` | function | 1418 |
| 28 | `readStoredTranslateTarget` | function | 1449 |
| 29 | `isDocumentVisible` | function | 1472 |
| 30 | `CatalogPage` | export default function | 1478 |
| 31 | `copy` | const arrow | 1568 |
| 32 | `resolveVisibleTab` | const arrow | 1577 |
| 33 | `loadAssistantStatus` | function | 1666 |
| 34 | `openProductGallery` | function | 1684 |
| 35 | `changeTranslateTarget` | function | 1697 |
| 36 | `isPortalLoadCurrent` | function | 1716 |
| 37 | `loadPortalEditorData` | function | 1720 |
| 38 | `refreshPortalView` | function | 1749 |
| 39 | `loadPortal` | function | 1778 |
| 40 | `initWidget` | const arrow | 1963 |
| 41 | `waitForWidget` | const arrow | 1981 |
| 42 | `toggleFilterValue` | function | 2087 |
| 43 | `clearPortalFilters` | function | 2095 |
| 44 | `setDraft` | function | 2102 |
| 45 | `toggleRecommendedProduct` | function | 2107 |
| 46 | `openPortalImage` | function | 2116 |
| 47 | `setAboutBlocksDraft` | function | 2127 |
| 48 | `updateAboutBlock` | function | 2131 |
| 49 | `addAboutBlock` | function | 2137 |
| 50 | `moveAboutBlockBefore` | function | 2141 |
| 51 | `removeAboutBlock` | function | 2153 |
| 52 | `setFaqDraft` | function | 2157 |
| 53 | `addFaqItem` | function | 2161 |
| 54 | `mergeFaqStarterItems` | function | 2172 |
| 55 | `addFaqStarterSet` | function | 2185 |
| 56 | `addAiFaqStarterSet` | function | 2189 |
| 57 | `updateFaqItem` | function | 2193 |
| 58 | `removeFaqItem` | function | 2199 |
| 59 | `clearAssistantState` | function | 2203 |
| 60 | `uploadPortalImage` | function | 2218 |
| 61 | `uploadDraftImage` | function | 2237 |
| 62 | `uploadAboutBlockMedia` | function | 2242 |
| 63 | `openFilePicker` | function | 2251 |
| 64 | `handleFilePickerSelect` | function | 2255 |
| 65 | `savePortalDraft` | function | 2271 |
| 66 | `askAssistant` | function | 2400 |
| 67 | `refreshMembershipData` | function | 2444 |
| 68 | `handleMembershipLookup` | function | 2488 |
| 69 | `addSubmissionImages` | function | 2501 |
| 70 | `handleSubmissionPaste` | function | 2511 |
| 71 | `handleSubmitShareProof` | function | 2527 |
| 72 | `handleReviewSubmission` | function | 2571 |
| 73 | `renderCatalogSection` | function | 2703 |
| 74 | `handleUploadSubmissionImages` | const arrow | 2720 |
| 75 | `renderSecondaryTabSection` | function | 2772 |

### 3.100 `frontend/src/components/catalog/CatalogProductsSection.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBadgeIcon` | function | 7 |
| 2 | `getBadgeToneClass` | function | 15 |
| 3 | `CatalogProductsSection` | export default function | 28 |

### 3.101 `frontend/src/components/catalog/CatalogSecondaryTabs.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CatalogMembershipSection` | function | 20 |
| 2 | `CatalogAboutSection` | function | 366 |
| 3 | `CatalogFaqSection` | function | 437 |
| 4 | `CatalogAiSection` | function | 491 |
| 5 | `CatalogSecondaryTabs` | export default function | 677 |

### 3.102 `frontend/src/components/catalog/catalogUi.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `statusClass` | function | 3 |
| 2 | `SectionShell` | export function | 10 |
| 3 | `SummaryTile` | export function | 26 |
| 4 | `StatusPill` | export function | 50 |

### 3.103 `frontend/src/components/catalog/portalCatalogDisplay.mjs`

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

### 3.104 `frontend/src/components/catalog/portalEditorUtils.mjs`

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

### 3.105 `frontend/src/components/contacts/contactOptionUtils.js`

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

### 3.106 `frontend/src/components/contacts/Contacts.jsx`

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

### 3.107 `frontend/src/components/contacts/CustomersTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseContactOptions` | export function | 26 |
| 2 | `serializeContactOptions` | export function | 30 |
| 3 | `tr` | function | 34 |
| 4 | `OptionEditor` | function | 39 |
| 5 | `setField` | const arrow | 40 |
| 6 | `fieldId` | const arrow | 41 |
| 7 | `CustomerForm` | function | 83 |
| 8 | `setField` | const arrow | 95 |
| 9 | `addOption` | const arrow | 96 |
| 10 | `removeOption` | const arrow | 100 |
| 11 | `updateOption` | const arrow | 101 |
| 12 | `handleSubmit` | const arrow | 102 |
| 13 | `CustomersTab` | function | 210 |
| 14 | `toggleSectionCollapsed` | const arrow | 340 |
| 15 | `isSectionFullySelected` | const arrow | 346 |
| 16 | `isSectionPartiallySelected` | const arrow | 347 |
| 17 | `toggleSectionSelection` | const arrow | 348 |
| 18 | `promise` | const arrow | 371 |
| 19 | `handleSave` | const arrow | 436 |
| 20 | `handleDelete` | const arrow | 499 |
| 21 | `handleBulkDelete` | const arrow | 529 |

### 3.108 `frontend/src/components/contacts/DeliveryTab.jsx`

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

### 3.109 `frontend/src/components/contacts/shared.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `useContactSelection` | export function | 14 |
| 2 | `toggleOne` | const arrow | 30 |
| 3 | `clearSelection` | const arrow | 41 |
| 4 | `ThreeDotMenu` | export function | 68 |
| 5 | `menuContent` | const arrow | 76 |
| 6 | `DetailModal` | export function | 139 |
| 7 | `ContactTable` | export function | 170 |
| 8 | `parseCsvText` | function | 249 |
| 9 | `ImportModal` | export function | 302 |
| 10 | `analyzeCsv` | const arrow | 322 |
| 11 | `handlePickFile` | const arrow | 364 |
| 12 | `handleChooseExistingFile` | const arrow | 370 |
| 13 | `handleDownloadTemplate` | const arrow | 390 |
| 14 | `toggleConflictSelection` | const arrow | 394 |
| 15 | `applyModeToSelected` | const arrow | 403 |
| 16 | `toggleSelectAllConflicts` | const arrow | 413 |
| 17 | `handleImport` | const arrow | 421 |

### 3.110 `frontend/src/components/contacts/SuppliersTab.jsx`

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

### 3.111 `frontend/src/components/custom-tables/CustomTables.jsx`

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

### 3.112 `frontend/src/components/dashboard/charts/BarChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BarChart` | export default function | 14 |
| 2 | `yPx` | function | 32 |

### 3.113 `frontend/src/components/dashboard/charts/DonutChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `DonutChart` | export default function | 14 |

### 3.114 `frontend/src/components/dashboard/charts/index.js`

- No top-level named symbols detected.

### 3.115 `frontend/src/components/dashboard/charts/LineChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `LineChart` | export default function | 13 |
| 2 | `xPx` | function | 29 |
| 3 | `yPx` | function | 30 |
| 4 | `handleMouseMove` | const arrow | 35 |

### 3.116 `frontend/src/components/dashboard/charts/NoData.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NoData` | export default function | 7 |

### 3.117 `frontend/src/components/dashboard/Dashboard.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDashboardFilterStorageKey` | function | 23 |
| 2 | `readDashboardFilterPrefs` | function | 28 |
| 3 | `Dashboard` | export default function | 52 |
| 4 | `translateOr` | const arrow | 57 |
| 5 | `calcTrend` | const arrow | 248 |
| 6 | `rangeLabel` | const arrow | 273 |
| 7 | `periodShort` | const arrow | 279 |
| 8 | `buildExportAll` | const arrow | 554 |

### 3.118 `frontend/src/components/dashboard/MiniStat.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `MiniStat` | export default function | 2 |

### 3.119 `frontend/src/components/files/FilePickerModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `AssetPreview` | function | 11 |
| 2 | `FilePickerModal` | export default function | 21 |
| 3 | `tr` | const arrow | 41 |
| 4 | `toggleSelectedPath` | function | 82 |
| 5 | `handleUpload` | function | 92 |
| 6 | `handleDelete` | function | 127 |

### 3.120 `frontend/src/components/files/FilesPage.jsx`

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

### 3.121 `frontend/src/components/inventory/DualMoney.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `DualMoney` | function | 5 |

### 3.122 `frontend/src/components/inventory/Inventory.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `reuseSetWhenUnchanged` | function | 31 |
| 2 | `priceCsv` | function | 40 |
| 3 | `Inventory` | export default function | 44 |
| 4 | `tr` | const arrow | 49 |
| 5 | `promise` | const arrow | 97 |
| 6 | `handleAdjust` | const arrow | 205 |
| 7 | `openAdjust` | const arrow | 269 |
| 8 | `openMove` | const arrow | 275 |
| 9 | `handleMoveStock` | const arrow | 297 |
| 10 | `matchesSearch` | const arrow | 368 |
| 11 | `productHay` | const arrow | 375 |
| 12 | `movHay` | const arrow | 378 |

### 3.123 `frontend/src/components/inventory/InventoryImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeAction` | function | 12 |
| 2 | `InventoryImportModal` | export default function | 19 |
| 3 | `tr` | const arrow | 29 |
| 4 | `handlePickFile` | const arrow | 42 |
| 5 | `handleDownloadTemplate` | const arrow | 50 |
| 6 | `handleImport` | const arrow | 54 |

### 3.124 `frontend/src/components/inventory/movementGroups.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `minuteBucket` | function | 1 |
| 2 | `normalizeText` | function | 8 |
| 3 | `buildGroupKey` | function | 12 |
| 4 | `describeMovementType` | function | 27 |
| 5 | `buildMovementGroups` | export function | 38 |
| 6 | `movementGroupHaystack` | export function | 99 |

### 3.125 `frontend/src/components/inventory/ProductDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductDetailModal` | export default function | 5 |
| 2 | `T` | const arrow | 6 |

### 3.126 `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`

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

### 3.127 `frontend/src/components/navigation/Sidebar.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getFallbackLabel` | function | 49 |
| 2 | `getNavLabel` | function | 57 |
| 3 | `isDarkColor` | function | 73 |
| 4 | `withAlpha` | function | 83 |
| 5 | `mergeStyles` | function | 89 |
| 6 | `Sidebar` | export default function | 93 |

### 3.128 `frontend/src/components/pos/CartItem.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CartItem` | export default function | 3 |

### 3.129 `frontend/src/components/pos/FilterPanel.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `POSFilterPanel` | export default function | 3 |
| 2 | `T` | const arrow | 25 |
| 3 | `clearAll` | const arrow | 35 |
| 4 | `chip` | const arrow | 43 |
| 5 | `SectionLabel` | const arrow | 49 |

### 3.130 `frontend/src/components/pos/POS.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `allTermsMatch` | function | 59 |
| 2 | `POS` | export default function | 64 |
| 3 | `setQuickFilter` | const arrow | 103 |
| 4 | `addNewOrder` | const arrow | 168 |
| 5 | `closeOrder` | const arrow | 180 |
| 6 | `selectCustomer` | const arrow | 439 |
| 7 | `applyCustomerOption` | const arrow | 487 |
| 8 | `clearCustomer` | const arrow | 501 |
| 9 | `handleAddCustomer` | const arrow | 509 |
| 10 | `selectDelivery` | const arrow | 530 |
| 11 | `clearDelivery` | const arrow | 535 |
| 12 | `handleAddDelivery` | const arrow | 537 |
| 13 | `qty` | const arrow | 629 |
| 14 | `addToCart` | function | 780 |
| 15 | `updateQty` | const arrow | 819 |
| 16 | `updatePrice` | const arrow | 827 |
| 17 | `updateItemBranch` | const arrow | 851 |
| 18 | `handleDiscountUsd` | const arrow | 900 |
| 19 | `handleDiscountKhr` | const arrow | 901 |
| 20 | `handleMembershipUnits` | const arrow | 902 |
| 21 | `handleCheckout` | const arrow | 941 |

### 3.131 `frontend/src/components/pos/posCore.mjs`

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

### 3.132 `frontend/src/components/pos/ProductImage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductImage` | export default function | 3 |

### 3.133 `frontend/src/components/pos/QuickAddModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `QuickAddModal` | export default function | 4 |
| 2 | `T` | const arrow | 5 |

### 3.134 `frontend/src/components/products/barcodeImageScanner.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readFileAsDataUrl` | function | 1 |
| 2 | `createImageElement` | function | 10 |
| 3 | `loadImageSource` | function | 14 |
| 4 | `scanBarcodeFromImageFile` | export function | 23 |

### 3.135 `frontend/src/components/products/BarcodeScannerModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `stopStream` | function | 24 |
| 2 | `readCameraPermissionState` | function | 30 |
| 3 | `watchCameraPermission` | function | 40 |
| 4 | `handleChange` | const arrow | 44 |
| 5 | `BarcodeScannerModal` | export default function | 53 |

### 3.136 `frontend/src/components/products/barcodeScannerState.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `deriveScannerPresentation` | export function | 1 |

### 3.137 `frontend/src/components/products/BranchStockAdjuster.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BranchStockAdjuster` | export default function | 3 |
| 2 | `T` | const arrow | 20 |
| 3 | `setRow` | const arrow | 26 |
| 4 | `handleSave` | const arrow | 32 |

### 3.138 `frontend/src/components/products/BulkAddStockModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BulkAddStockModal` | function | 5 |
| 2 | `handleSave` | const arrow | 12 |

### 3.139 `frontend/src/components/products/BulkImportModal.jsx`

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
| 10 | `T` | const arrow | 164 |
| 11 | `resetCsvState` | const arrow | 166 |
| 12 | `pickImageDirectory` | const arrow | 182 |
| 13 | `pickImageZip` | const arrow | 206 |
| 14 | `addLibraryImages` | const arrow | 219 |
| 15 | `buildCsvForImportJob` | const arrow | 235 |
| 16 | `formatJobResult` | const arrow | 259 |
| 17 | `waitForImportJob` | const arrow | 275 |
| 18 | `handleCancelCurrentJob` | const arrow | 296 |
| 19 | `handleImageOnlyImport` | const arrow | 312 |
| 20 | `handlePickCSV` | const arrow | 358 |
| 21 | `handleImport` | const arrow | 407 |
| 22 | `toggleConflictSelection` | const arrow | 462 |
| 23 | `toggleSelectAllConflicts` | const arrow | 471 |
| 24 | `applyDecisionToSelection` | const arrow | 479 |
| 25 | `applyImageDecisionToSelection` | const arrow | 489 |

### 3.140 `frontend/src/components/products/HeaderActions.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductsHeaderActions` | export default function | 5 |
| 2 | `tr` | const arrow | 16 |

### 3.141 `frontend/src/components/products/ManageBrandsModal.jsx`

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

### 3.142 `frontend/src/components/products/ManageCategoriesModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ManageCategoriesModal` | export default function | 13 |
| 2 | `handleAdd` | const arrow | 48 |
| 3 | `handleUpdate` | const arrow | 68 |
| 4 | `handleDelete` | const arrow | 91 |

### 3.143 `frontend/src/components/products/ManageUnitsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ManageUnitsModal` | export default function | 7 |
| 2 | `load` | const arrow | 19 |
| 3 | `handleAdd` | const arrow | 37 |
| 4 | `handleUpdate` | const arrow | 57 |
| 5 | `handleDelete` | const arrow | 76 |

### 3.144 `frontend/src/components/products/primitives.jsx`

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

### 3.145 `frontend/src/components/products/ProductDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductDetailModal` | export default function | 6 |
| 2 | `T` | const arrow | 18 |
| 3 | `Row` | const arrow | 33 |

### 3.146 `frontend/src/components/products/ProductForm.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeGallery` | function | 17 |
| 2 | `editablePrice` | function | 33 |
| 3 | `pickImageFiles` | function | 38 |
| 4 | `readFileAsDataUrl` | function | 57 |
| 5 | `ProductForm` | export default function | 66 |
| 6 | `tr` | const arrow | 147 |
| 7 | `loadSuppliers` | function | 189 |
| 8 | `setField` | function | 209 |
| 9 | `setNumericField` | function | 213 |
| 10 | `addImages` | function | 217 |
| 11 | `addPhoto` | function | 222 |
| 12 | `uploadPickedImages` | function | 227 |
| 13 | `removeImage` | function | 250 |
| 14 | `setPrimaryImage` | function | 254 |
| 15 | `saveForm` | function | 264 |
| 16 | `openScanner` | function | 311 |
| 17 | `closeScanner` | function | 333 |
| 18 | `applyScannedValue` | function | 337 |

### 3.147 `frontend/src/components/products/productHistoryHelpers.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `orderProductRestoreSnapshots` | export function | 1 |
| 2 | `createProductHistoryRequestId` | export function | 35 |

### 3.148 `frontend/src/components/products/productImportPlanner.mjs`

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
| 10 | `analyzeProductImportRows` | export function | 207 |
| 11 | `analyzeProductImportText` | export function | 304 |

### 3.149 `frontend/src/components/products/productImportWorker.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `post` | function | 3 |

### 3.150 `frontend/src/components/products/Products.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `multiMatch` | function | 39 |
| 2 | `ThreeDot` | function | 43 |
| 3 | `getScrollContainer` | function | 64 |
| 4 | `scrollNodeWithOffset` | function | 76 |
| 5 | `Products` | export default function | 92 |
| 6 | `promise` | const arrow | 145 |
| 7 | `handleSave` | const arrow | 231 |
| 8 | `normalizeGallery` | const arrow | 252 |
| 9 | `uploadGalleryImages` | const arrow | 268 |
| 10 | `handleSaveWithGallery` | const arrow | 290 |
| 11 | `handleBulkDelete` | const arrow | 354 |
| 12 | `handleBulkOutOfStock` | const arrow | 402 |
| 13 | `handleBulkChangeBranch` | const arrow | 445 |
| 14 | `handleBulkAddStock` | const arrow | 475 |
| 15 | `toggleSelect` | const arrow | 483 |
| 16 | `toggleSelectAll` | const arrow | 490 |
| 17 | `handleDelete` | const arrow | 497 |
| 18 | `resolveImageUrl` | const arrow | 542 |
| 19 | `getProductGallery` | const arrow | 553 |
| 20 | `renderUnitChip` | const arrow | 554 |
| 21 | `openLightbox` | const arrow | 568 |
| 22 | `getStockBadge` | const arrow | 579 |
| 23 | `toImageName` | const arrow | 620 |
| 24 | `toImageUrl` | const arrow | 621 |
| 25 | `priceCsv` | const arrow | 622 |

### 3.151 `frontend/src/components/products/scanbotScanner.mjs`

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

### 3.152 `frontend/src/components/products/VariantFormModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `VariantFormModal` | export default function | 8 |
| 2 | `tr` | const arrow | 10 |
| 3 | `setField` | const arrow | 36 |
| 4 | `setNumeric` | const arrow | 37 |
| 5 | `handleSave` | const arrow | 39 |

### 3.153 `frontend/src/components/receipt-settings/AllFieldsPanel.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Toggle` | function | 5 |
| 2 | `AllFieldsPanel` | export default function | 21 |
| 3 | `T` | const arrow | 23 |
| 4 | `toggleSection` | const arrow | 42 |

### 3.154 `frontend/src/components/receipt-settings/constants.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getFieldItems` | export function | 52 |
| 2 | `T` | const arrow | 53 |

### 3.155 `frontend/src/components/receipt-settings/ErrorBoundary.jsx`

- No top-level named symbols detected.

### 3.156 `frontend/src/components/receipt-settings/FieldOrderManager.jsx`

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

### 3.157 `frontend/src/components/receipt-settings/PrintSettings.jsx`

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

### 3.158 `frontend/src/components/receipt-settings/ReceiptPreview.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ReceiptPreview` | export default function | 9 |
| 2 | `loadPreview` | function | 20 |

### 3.159 `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Section` | function | 15 |
| 2 | `Toggle` | function | 26 |
| 3 | `ReceiptSettings` | export default function | 41 |
| 4 | `handleSave` | const arrow | 155 |

### 3.160 `frontend/src/components/receipt-settings/template.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseReceiptTemplate` | export function | 3 |
| 2 | `serializeReceiptTemplate` | export function | 14 |

### 3.161 `frontend/src/components/receipt/Receipt.jsx`

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

### 3.162 `frontend/src/components/returns/EditReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `EditReturnModal` | function | 6 |
| 2 | `T` | const arrow | 8 |
| 3 | `updateQty` | const arrow | 33 |
| 4 | `updateRestock` | const arrow | 36 |
| 5 | `handleSubmit` | const arrow | 44 |

### 3.163 `frontend/src/components/returns/NewReturnModal.jsx`

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

### 3.164 `frontend/src/components/returns/NewSupplierReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NewSupplierReturnModal` | export default function | 10 |
| 2 | `tr` | const arrow | 12 |
| 3 | `loadSetup` | function | 45 |
| 4 | `loadInventory` | function | 86 |
| 5 | `updateQty` | const arrow | 150 |
| 6 | `submit` | const arrow | 156 |

### 3.165 `frontend/src/components/returns/ReturnDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeScope` | function | 6 |
| 2 | `ReturnDetailModal` | export default function | 10 |
| 3 | `tr` | const arrow | 12 |

### 3.166 `frontend/src/components/returns/Returns.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeScope` | function | 24 |
| 2 | `getReturnTypeKey` | function | 28 |
| 3 | `getReturnTypeLabel` | function | 34 |
| 4 | `exportReturnRows` | function | 42 |
| 5 | `Returns` | export default function | 60 |
| 6 | `promise` | const arrow | 97 |
| 7 | `handleOpenEdit` | const arrow | 162 |
| 8 | `renderAmount` | const arrow | 414 |

### 3.167 `frontend/src/components/sales/ExportModal.jsx`

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

### 3.168 `frontend/src/components/sales/SaleDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `InfoBlock` | function | 5 |
| 2 | `parseItems` | function | 21 |
| 3 | `SaleDetailModal` | export default function | 31 |
| 4 | `translateOr` | const arrow | 47 |
| 5 | `handleStatusUpdate` | const arrow | 69 |
| 6 | `handleMembershipAttach` | const arrow | 80 |

### 3.169 `frontend/src/components/sales/Sales.jsx`

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

### 3.170 `frontend/src/components/sales/SalesImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeBranchMap` | function | 12 |
| 2 | `findProduct` | function | 23 |
| 3 | `SalesImportModal` | export default function | 33 |
| 4 | `tr` | const arrow | 43 |
| 5 | `handlePickFile` | const arrow | 56 |
| 6 | `handleDownloadTemplate` | const arrow | 64 |
| 7 | `handleImport` | const arrow | 68 |

### 3.171 `frontend/src/components/sales/StatusBadge.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getStatusLabel` | export function | 23 |
| 2 | `StatusBadge` | export default function | 39 |

### 3.172 `frontend/src/components/server/ServerPage.jsx`

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

### 3.173 `frontend/src/components/shared/ActionHistoryBar.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatHistoryList` | function | 5 |
| 2 | `formatServerStatus` | function | 9 |
| 3 | `ActionHistoryBar` | export default function | 16 |
| 4 | `T` | const arrow | 26 |

### 3.174 `frontend/src/components/shared/ExportMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ExportMenu` | export default function | 4 |

### 3.175 `frontend/src/components/shared/FilterMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sectionButtonClass` | function | 4 |
| 2 | `FilterMenu` | export default function | 10 |

### 3.176 `frontend/src/components/shared/ImageGalleryLightbox.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ImageGalleryLightbox` | export default function | 8 |
| 2 | `formatLabel` | function | 30 |
| 3 | `setIndex` | function | 34 |
| 4 | `renderGalleryImage` | function | 40 |
| 5 | `onKeyDown` | function | 47 |

### 3.177 `frontend/src/components/shared/Modal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Modal` | export default function | 10 |

### 3.178 `frontend/src/components/shared/navigationConfig.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseNavSetting` | export function | 23 |
| 2 | `orderNavItems` | export function | 32 |

### 3.179 `frontend/src/components/shared/NotificationCenter.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `preferenceValue` | function | 99 |
| 2 | `matchesVisibilityMode` | function | 106 |
| 3 | `NotificationCenter` | export default function | 113 |
| 4 | `syncVisibility` | const arrow | 142 |
| 5 | `onVisible` | const arrow | 198 |
| 6 | `handleClickOutside` | const arrow | 221 |

### 3.180 `frontend/src/components/shared/pageActivity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `useIsPageActive` | export function | 4 |

### 3.181 `frontend/src/components/shared/PageHeader.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PageHeader` | export default function | 9 |

### 3.182 `frontend/src/components/shared/PageHelpButton.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PageHelpButton` | export default function | 6 |

### 3.183 `frontend/src/components/shared/pageHelpContent.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getPageHelpContent` | export function | 442 |

### 3.184 `frontend/src/components/shared/PortalMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PortalMenu` | export default function | 11 |
| 2 | `closeIfClickedOutside` | const arrow | 63 |
| 3 | `closeMenu` | const arrow | 70 |
| 4 | `scheduleReposition` | const arrow | 71 |
| 5 | `closeIfEscape` | const arrow | 78 |
| 6 | `ThreeDotPortal` | export function | 180 |

### 3.185 `frontend/src/components/shared/QuickPreferenceToggles.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ToggleButton` | function | 4 |
| 2 | `QuickPreferenceToggles` | export default function | 23 |
| 3 | `tr` | const arrow | 25 |

### 3.186 `frontend/src/components/shared/WriteConflictModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatConflictTime` | function | 3 |
| 2 | `summarizeCurrentValue` | function | 10 |
| 3 | `formatValue` | function | 66 |
| 4 | `getConflictFieldRows` | function | 73 |
| 5 | `WriteConflictModal` | export default function | 171 |

### 3.187 `frontend/src/components/users/PermissionEditor.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PermissionEditor` | export default function | 15 |
| 2 | `translate` | const arrow | 16 |
| 3 | `labelFor` | const arrow | 22 |
| 4 | `toggle` | const arrow | 25 |

### 3.188 `frontend/src/components/users/UserDetailSheet.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `translateLabel` | function | 4 |
| 2 | `buildRowData` | function | 9 |
| 3 | `UserDetailSheet` | export default function | 21 |

### 3.189 `frontend/src/components/users/UserProfileModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `AvatarPreview` | function | 20 |
| 2 | `ProfileSectionButton` | function | 38 |
| 3 | `clamp` | function | 148 |
| 4 | `readFileAsDataUrl` | function | 152 |
| 5 | `loadImageElement` | function | 161 |
| 6 | `renderAvatarCropBlob` | function | 171 |
| 7 | `AvatarEditorModal` | function | 197 |
| 8 | `UserProfileModal` | export default function | 258 |
| 9 | `tr` | const arrow | 262 |
| 10 | `loadProfile` | const arrow | 332 |
| 11 | `handleProfileSave` | const arrow | 399 |
| 12 | `handlePasswordSave` | const arrow | 460 |
| 13 | `handleSessionSave` | const arrow | 496 |
| 14 | `refreshOtpState` | const arrow | 516 |
| 15 | `handleAvatarPick` | const arrow | 528 |
| 16 | `resetAvatarEditor` | const arrow | 530 |
| 17 | `openAvatarEditor` | const arrow | 536 |
| 18 | `closeAvatarEditor` | const arrow | 544 |
| 19 | `handleStartOauthLink` | const arrow | 550 |
| 20 | `handleDisconnectOauthProvider` | const arrow | 589 |
| 21 | `handleAvatarSelected` | const arrow | 637 |
| 22 | `saveAvatarFromEditor` | const arrow | 653 |

### 3.190 `frontend/src/components/users/Users.jsx`

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

### 3.191 `frontend/src/components/utils-settings/AuditLog.jsx`

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

### 3.192 `frontend/src/components/utils-settings/Backup.jsx`

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

### 3.193 `frontend/src/components/utils-settings/FontFamilyPicker.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `FontFamilyPicker` | function | 20 |

### 3.194 `frontend/src/components/utils-settings/index.js`

- No top-level named symbols detected.

### 3.195 `frontend/src/components/utils-settings/OtpModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `OtpModal` | export default function | 12 |
| 2 | `loadSetup` | function | 47 |

### 3.196 `frontend/src/components/utils-settings/ResetData.jsx`

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

### 3.197 `frontend/src/components/utils-settings/Settings.jsx`

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

### 3.198 `frontend/src/constants.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createEmptyOrder` | export function | 127 |
| 2 | `formatDate` | export function | 157 |
| 3 | `isNetworkError` | export function | 177 |

### 3.199 `frontend/src/index.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `disableServiceWorkerCaching` | function | 7 |
| 2 | `cleanup` | const arrow | 10 |
| 3 | `installFormFieldAccessibility` | function | 36 |
| 4 | `escapeSelectorValue` | const arrow | 41 |
| 5 | `wireField` | const arrow | 46 |
| 6 | `scan` | const arrow | 68 |
| 7 | `valueIncludesExtensionSource` | const arrow | 120 |
| 8 | `valueIncludesLikelyInjectedBundle` | const arrow | 124 |
| 9 | `shouldIgnoreRuntimeValue` | const arrow | 131 |
| 10 | `isIgnoredRuntimeMessage` | const arrow | 139 |
| 11 | `safeInsertRule` | const function | 146 |
| 12 | `safeCssRulesGetter` | const function | 163 |
| 13 | `stopKnownStartupNoise` | const arrow | 179 |

### 3.200 `frontend/src/platform/runtime/clientRuntime.js`

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

### 3.201 `frontend/src/platform/storage/storagePolicy.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `shouldPersistLocalMirror` | export function | 22 |
| 2 | `maxStoredNumber` | export function | 26 |
| 3 | `isCooldownActive` | export function | 33 |

### 3.202 `frontend/src/utils/actionHistory.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeEntry` | function | 3 |
| 2 | `useActionHistory` | export function | 16 |

### 3.203 `frontend/src/utils/appRefresh.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `refreshAppData` | export function | 18 |

### 3.204 `frontend/src/utils/color.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeHex` | function | 1 |
| 2 | `relativeLuminance` | function | 12 |
| 3 | `getContrastingTextColor` | export function | 27 |

### 3.205 `frontend/src/utils/csv.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `escapeCsvValue` | function | 4 |
| 2 | `buildCSV` | export function | 15 |
| 3 | `downloadBlob` | export function | 24 |
| 4 | `downloadCSV` | export function | 38 |
| 5 | `CRC32_TABLE` | const arrow | 44 |
| 6 | `crc32` | function | 56 |
| 7 | `writeUint16` | function | 64 |
| 8 | `writeUint32` | function | 68 |
| 9 | `encodeZipTimestamp` | function | 72 |
| 10 | `buildZip` | export function | 85 |
| 11 | `downloadZipFiles` | export function | 161 |

### 3.206 `frontend/src/utils/csvImport.js`

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

### 3.207 `frontend/src/utils/dateHelpers.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `todayStr` | export function | 10 |
| 2 | `offsetDate` | export function | 20 |

### 3.208 `frontend/src/utils/deviceInfo.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getClientDeviceInfo` | export function | 1 |
| 2 | `getClientMetaHeaders` | export function | 24 |

### 3.209 `frontend/src/utils/exportPackage.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildReportManifestRows` | export function | 3 |
| 2 | `buildReportPackageFiles` | export function | 11 |

### 3.210 `frontend/src/utils/exportReports.jsx`

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

### 3.211 `frontend/src/utils/favicon.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `clamp` | function | 1 |
| 2 | `loadImage` | function | 5 |
| 3 | `createCircularFaviconDataUrl` | export function | 19 |

### 3.212 `frontend/src/utils/formatters.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fmtTime` | export function | 9 |
| 2 | `fmtDate` | export function | 25 |
| 3 | `fmtShort` | export function | 39 |
| 4 | `fmtCount` | export function | 51 |

### 3.213 `frontend/src/utils/groupedRecords.mjs`

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

### 3.214 `frontend/src/utils/historyHelpers.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cloneHistorySnapshot` | export function | 1 |
| 2 | `extractHistoryResultId` | export function | 6 |
| 3 | `resolveCreatedHistorySnapshot` | export function | 16 |

### 3.215 `frontend/src/utils/index.js`

- No top-level named symbols detected.

### 3.216 `frontend/src/utils/loaders.mjs`

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

### 3.217 `frontend/src/utils/pricing.js`

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

### 3.218 `frontend/src/utils/printReceipt.js`

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

### 3.219 `frontend/src/utils/productGrouping.mjs`

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

### 3.220 `frontend/src/web-api.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getStoredAuthToken` | function | 23 |
| 2 | `hasExtensionSource` | const arrow | 49 |
| 3 | `isLikelyInjectedBundle` | const arrow | 50 |
| 4 | `isSuppressedRuntimeMessage` | const arrow | 57 |

### 3.221 `frontend/tailwind.config.mjs`

- No top-level named symbols detected.

### 3.222 `frontend/tests/apiHttp.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 13 |
| 2 | `createDeferredResponse` | function | 24 |
| 3 | `resetApiState` | function | 35 |

### 3.223 `frontend/tests/appShellUtils.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.224 `frontend/tests/barcodeImageScanner.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.225 `frontend/tests/barcodeScannerState.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.226 `frontend/tests/csvImport.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.227 `frontend/tests/exportPackages.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 7 |

### 3.228 `frontend/tests/groupedRecords.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.229 `frontend/tests/historyHelpers.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 10 |

### 3.230 `frontend/tests/loaders.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.231 `frontend/tests/portalCatalogDisplay.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |
| 2 | `copy` | const arrow | 25 |
| 3 | `formatPortalPrice` | const arrow | 26 |

### 3.232 `frontend/tests/portalEditorUtils.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |

### 3.233 `frontend/tests/posCore.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 15 |

### 3.234 `frontend/tests/pricingContacts.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |

### 3.235 `frontend/tests/productGrouping.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.236 `frontend/tests/productHistoryHelpers.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.237 `frontend/tests/productImportPlanner.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.238 `frontend/tests/receiptTemplate.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 7 |

### 3.239 `frontend/tests/scanbotScanner.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `setNavigator` | function | 8 |
| 2 | `run` | function | 16 |

### 3.240 `frontend/tests/storagePolicy.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 13 |

### 3.241 `frontend/vite.config.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fixCrossorigin` | function | 29 |
| 2 | `manualChunks` | function | 54 |

### 3.242 `ops/scripts/backend/verify-data-integrity.js`

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

### 3.243 `ops/scripts/frontend/verify-i18n.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `collectUsedKeys` | function | 29 |
| 2 | `flattenTranslationTree` | function | 69 |
| 3 | `listMissing` | function | 83 |
| 4 | `listEmptyValues` | function | 88 |
| 5 | `printList` | function | 95 |
| 6 | `main` | function | 102 |

### 3.244 `ops/scripts/frontend/verify-performance.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `read` | function | 15 |
| 2 | `walk` | function | 19 |
| 3 | `trackedFiles` | function | 37 |
| 4 | `assert` | function | 47 |

### 3.245 `ops/scripts/frontend/verify-ui.js`

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

### 3.246 `ops/scripts/generate-doc-reference.js`

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

### 3.247 `ops/scripts/generate-full-project-docs.js`

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

### 3.248 `ops/scripts/lib/fs-utils.js`

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

### 3.249 `ops/scripts/performance-scan.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `kb` | function | 43 |
| 2 | `topN` | function | 48 |
| 3 | `main` | function | 56 |

### 3.250 `ops/scripts/runtime/check-public-url.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeBaseUrl` | function | 8 |
| 2 | `normalizePath` | function | 14 |
| 3 | `fetchWithTimeout` | function | 21 |
| 4 | `isPrivateIpv4` | function | 38 |
| 5 | `isPrivateIpv6` | function | 50 |
| 6 | `shouldCheckPublicIngress` | function | 59 |
| 7 | `fetchJsonWithTimeout` | function | 71 |
| 8 | `resolvePublicIngress` | function | 86 |
| 9 | `checkHttpsViaIp` | function | 111 |
| 10 | `main` | function | 148 |

### 3.251 `ops/scripts/verify-runtime-deps.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readJson` | function | 22 |
| 2 | `assertTrackedFile` | function | 26 |
| 3 | `hasLockDependency` | function | 32 |
| 4 | `main` | function | 38 |

### 3.252 `ops/scripts/verify-scale-services.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ensureDir` | function | 17 |
| 2 | `run` | function | 21 |
| 3 | `firstExisting` | function | 39 |
| 4 | `whereDocker` | function | 43 |
| 5 | `resolveDocker` | function | 56 |
| 6 | `checkSecretIgnoreRules` | function | 66 |
| 7 | `trackedLicenses` | const arrow | 67 |
| 8 | `main` | function | 93 |

