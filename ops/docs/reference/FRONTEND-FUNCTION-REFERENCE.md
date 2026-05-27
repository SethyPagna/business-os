# Frontend Function Reference

Auto-generated symbol inventory for frontend files. Regenerate with `node ops/scripts/docs/generate-doc-reference.js`.

## 1. Coverage Summary

Total files documented: **212**

## 2. Symbol Count by File

| No. | File | Symbols |
|---:|---|---:|
| 1 | `frontend/src/api/http.js` | 36 |
| 2 | `frontend/src/api/localDb.js` | 1 |
| 3 | `frontend/src/api/methods.js` | 159 |
| 4 | `frontend/src/api/websocket.js` | 5 |
| 5 | `frontend/src/App.jsx` | 62 |
| 6 | `frontend/src/app/appShellUtils.ts` | 0 |
| 7 | `frontend/src/AppContext.jsx` | 39 |
| 8 | `frontend/src/components/auth/Login.jsx` | 23 |
| 9 | `frontend/src/components/branches/Branches.jsx` | 10 |
| 10 | `frontend/src/components/branches/BranchForm.jsx` | 3 |
| 11 | `frontend/src/components/branches/TransferModal.jsx` | 4 |
| 12 | `frontend/src/components/catalog/CatalogEditorSurface.jsx` | 1 |
| 13 | `frontend/src/components/catalog/CatalogImageField.jsx` | 1 |
| 14 | `frontend/src/components/catalog/CatalogPage.jsx` | 115 |
| 15 | `frontend/src/components/catalog/CatalogPageContext.jsx` | 0 |
| 16 | `frontend/src/components/catalog/CatalogPreviewSurface.jsx` | 2 |
| 17 | `frontend/src/components/catalog/CatalogProductsSection.jsx` | 4 |
| 18 | `frontend/src/components/catalog/CatalogSecondaryTabs.jsx` | 6 |
| 19 | `frontend/src/components/catalog/catalogUi.jsx` | 1 |
| 20 | `frontend/src/components/catalog/portalCatalogDisplay.ts` | 2 |
| 21 | `frontend/src/components/catalog/portalContentI18n.ts` | 14 |
| 22 | `frontend/src/components/catalog/portalEditorUtils.ts` | 2 |
| 23 | `frontend/src/components/catalog/portalLanguagePacks.ts` | 0 |
| 24 | `frontend/src/components/contacts/ContactImportModal.jsx` | 10 |
| 25 | `frontend/src/components/contacts/contactImportParser.ts` | 0 |
| 26 | `frontend/src/components/contacts/contactImportWorker.ts` | 1 |
| 27 | `frontend/src/components/contacts/contactOptionUtils.js` | 0 |
| 28 | `frontend/src/components/contacts/contactOptionUtils.ts` | 3 |
| 29 | `frontend/src/components/contacts/Contacts.jsx` | 13 |
| 30 | `frontend/src/components/contacts/CustomerFormModal.jsx` | 11 |
| 31 | `frontend/src/components/contacts/customerMembershipNumber.js` | 0 |
| 32 | `frontend/src/components/contacts/customerMembershipNumber.ts` | 0 |
| 33 | `frontend/src/components/contacts/CustomersTab.jsx` | 10 |
| 34 | `frontend/src/components/contacts/DeliveryTab.jsx` | 21 |
| 35 | `frontend/src/components/contacts/shared.jsx` | 3 |
| 36 | `frontend/src/components/contacts/SuppliersTab.jsx` | 16 |
| 37 | `frontend/src/components/custom-tables/CustomTables.jsx` | 11 |
| 38 | `frontend/src/components/dashboard/charts/BarChart.jsx` | 5 |
| 39 | `frontend/src/components/dashboard/charts/DonutChart.jsx` | 1 |
| 40 | `frontend/src/components/dashboard/charts/index.js` | 0 |
| 41 | `frontend/src/components/dashboard/charts/index.ts` | 0 |
| 42 | `frontend/src/components/dashboard/charts/LineChart.jsx` | 7 |
| 43 | `frontend/src/components/dashboard/charts/NoData.jsx` | 1 |
| 44 | `frontend/src/components/dashboard/Dashboard.jsx` | 17 |
| 45 | `frontend/src/components/dashboard/MiniStat.jsx` | 1 |
| 46 | `frontend/src/components/files/FilePickerModal.jsx` | 6 |
| 47 | `frontend/src/components/files/FilesPage.jsx` | 25 |
| 48 | `frontend/src/components/files/FilesProvidersTab.jsx` | 2 |
| 49 | `frontend/src/components/files/FilesResponsesTab.jsx` | 1 |
| 50 | `frontend/src/components/inventory/DualMoney.jsx` | 1 |
| 51 | `frontend/src/components/inventory/Inventory.jsx` | 27 |
| 52 | `frontend/src/components/inventory/InventoryImportModal.jsx` | 10 |
| 53 | `frontend/src/components/inventory/inventoryImportWorker.ts` | 1 |
| 54 | `frontend/src/components/inventory/InventoryMovementsSurface.jsx` | 1 |
| 55 | `frontend/src/components/inventory/InventoryProductsSurface.jsx` | 3 |
| 56 | `frontend/src/components/inventory/InventoryRfidSurface.jsx` | 1 |
| 57 | `frontend/src/components/inventory/movementGroups.js` | 0 |
| 58 | `frontend/src/components/inventory/movementGroups.ts` | 11 |
| 59 | `frontend/src/components/inventory/ProductDetailModal.jsx` | 2 |
| 60 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | 9 |
| 61 | `frontend/src/components/navigation/Sidebar.jsx` | 7 |
| 62 | `frontend/src/components/pos/CartItem.jsx` | 1 |
| 63 | `frontend/src/components/pos/FilterPanel.jsx` | 6 |
| 64 | `frontend/src/components/pos/POS.jsx` | 22 |
| 65 | `frontend/src/components/pos/posCore.ts` | 1 |
| 66 | `frontend/src/components/pos/ProductImage.jsx` | 1 |
| 67 | `frontend/src/components/pos/QuickAddModal.jsx` | 2 |
| 68 | `frontend/src/components/products/config/productPageConfig.ts` | 0 |
| 69 | `frontend/src/components/products/forms/BranchStockAdjuster.jsx` | 4 |
| 70 | `frontend/src/components/products/forms/BulkAddStockModal.jsx` | 2 |
| 71 | `frontend/src/components/products/forms/ProductForm.jsx` | 17 |
| 72 | `frontend/src/components/products/forms/VariantFormModal.jsx` | 5 |
| 73 | `frontend/src/components/products/helpers/productDisplayHelpers.ts` | 1 |
| 74 | `frontend/src/components/products/helpers/productFilterHelpers.ts` | 5 |
| 75 | `frontend/src/components/products/helpers/productGalleryHelpers.ts` | 0 |
| 76 | `frontend/src/components/products/helpers/productGroupViewHelpers.ts` | 0 |
| 77 | `frontend/src/components/products/helpers/productMenuHelpers.ts` | 1 |
| 78 | `frontend/src/components/products/helpers/productSelectionHelpers.ts` | 0 |
| 79 | `frontend/src/components/products/helpers/productWriteHelpers.ts` | 3 |
| 80 | `frontend/src/components/products/history/productHistoryHelpers.ts` | 0 |
| 81 | `frontend/src/components/products/import/BulkImportModal.jsx` | 63 |
| 82 | `frontend/src/components/products/import/productImportPlanner.ts` | 11 |
| 83 | `frontend/src/components/products/import/productImportWorker.ts` | 3 |
| 84 | `frontend/src/components/products/lookups/ManageBrandsModal.jsx` | 16 |
| 85 | `frontend/src/components/products/lookups/ManageCategoriesModal.jsx` | 8 |
| 86 | `frontend/src/components/products/lookups/ManageUnitsModal.jsx` | 8 |
| 87 | `frontend/src/components/products/Products.jsx` | 15 |
| 88 | `frontend/src/components/products/scanning/barcodeImageScanner.ts` | 4 |
| 89 | `frontend/src/components/products/scanning/BarcodeScannerModal.jsx` | 5 |
| 90 | `frontend/src/components/products/scanning/barcodeScannerState.ts` | 0 |
| 91 | `frontend/src/components/products/shared/primitives.jsx` | 11 |
| 92 | `frontend/src/components/products/surfaces/HeaderActions.jsx` | 3 |
| 93 | `frontend/src/components/products/surfaces/ProductDetailModal.jsx` | 3 |
| 94 | `frontend/src/components/products/surfaces/ProductRowParts.jsx` | 1 |
| 95 | `frontend/src/components/products/surfaces/ProductsListSurface.jsx` | 3 |
| 96 | `frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | 4 |
| 97 | `frontend/src/components/receipt-settings/constants.js` | 0 |
| 98 | `frontend/src/components/receipt-settings/constants.ts` | 1 |
| 99 | `frontend/src/components/receipt-settings/ErrorBoundary.jsx` | 0 |
| 100 | `frontend/src/components/receipt-settings/FieldOrderManager.jsx` | 9 |
| 101 | `frontend/src/components/receipt-settings/PrintSettings.jsx` | 9 |
| 102 | `frontend/src/components/receipt-settings/ReceiptPreview.jsx` | 2 |
| 103 | `frontend/src/components/receipt-settings/ReceiptSettings.jsx` | 4 |
| 104 | `frontend/src/components/receipt-settings/template.js` | 0 |
| 105 | `frontend/src/components/receipt-settings/template.ts` | 2 |
| 106 | `frontend/src/components/receipt/Receipt.jsx` | 8 |
| 107 | `frontend/src/components/returns/EditReturnModal.jsx` | 5 |
| 108 | `frontend/src/components/returns/NewReturnModal.jsx` | 10 |
| 109 | `frontend/src/components/returns/NewSupplierReturnModal.jsx` | 6 |
| 110 | `frontend/src/components/returns/ReturnDetailModal.jsx` | 3 |
| 111 | `frontend/src/components/returns/Returns.jsx` | 12 |
| 112 | `frontend/src/components/returns/ReturnsListSurface.jsx` | 5 |
| 113 | `frontend/src/components/sales/ExportModal.jsx` | 9 |
| 114 | `frontend/src/components/sales/SaleDetailModal.jsx` | 6 |
| 115 | `frontend/src/components/sales/Sales.jsx` | 14 |
| 116 | `frontend/src/components/sales/SalesImportModal.jsx` | 10 |
| 117 | `frontend/src/components/sales/salesImportWorker.ts` | 1 |
| 118 | `frontend/src/components/sales/SalesListSurface.jsx` | 1 |
| 119 | `frontend/src/components/sales/StatusBadge.jsx` | 1 |
| 120 | `frontend/src/components/server/ServerPage.jsx` | 16 |
| 121 | `frontend/src/components/shared/ActionHistoryBar.jsx` | 4 |
| 122 | `frontend/src/components/shared/BackgroundImportTracker.jsx` | 19 |
| 123 | `frontend/src/components/shared/ExportMenu.jsx` | 1 |
| 124 | `frontend/src/components/shared/FilterMenu.jsx` | 2 |
| 125 | `frontend/src/components/shared/globalScroll.js` | 0 |
| 126 | `frontend/src/components/shared/ImageGalleryLightbox.jsx` | 5 |
| 127 | `frontend/src/components/shared/LoadingWatchdog.jsx` | 1 |
| 128 | `frontend/src/components/shared/Modal.jsx` | 1 |
| 129 | `frontend/src/components/shared/navigationConfig.js` | 0 |
| 130 | `frontend/src/components/shared/navigationConfig.ts` | 0 |
| 131 | `frontend/src/components/shared/NotificationCenter.jsx` | 7 |
| 132 | `frontend/src/components/shared/pageActivity.js` | 0 |
| 133 | `frontend/src/components/shared/PageHeader.jsx` | 1 |
| 134 | `frontend/src/components/shared/PaginationControls.jsx` | 3 |
| 135 | `frontend/src/components/shared/PortalMenu.jsx` | 5 |
| 136 | `frontend/src/components/shared/QuickPreferenceToggles.jsx` | 3 |
| 137 | `frontend/src/components/shared/SectionSwitcher.jsx` | 3 |
| 138 | `frontend/src/components/shared/WriteConflictModal.jsx` | 5 |
| 139 | `frontend/src/components/users/PermissionEditor.jsx` | 5 |
| 140 | `frontend/src/components/users/UserDetailSheet.jsx` | 3 |
| 141 | `frontend/src/components/users/UserProfileModal.jsx` | 21 |
| 142 | `frontend/src/components/users/Users.jsx` | 18 |
| 143 | `frontend/src/components/utils-settings/AuditLog.jsx` | 16 |
| 144 | `frontend/src/components/utils-settings/Backup.jsx` | 30 |
| 145 | `frontend/src/components/utils-settings/FontFamilyPicker.jsx` | 1 |
| 146 | `frontend/src/components/utils-settings/index.js` | 0 |
| 147 | `frontend/src/components/utils-settings/index.ts` | 0 |
| 148 | `frontend/src/components/utils-settings/OtpModal.jsx` | 2 |
| 149 | `frontend/src/components/utils-settings/ResetData.jsx` | 8 |
| 150 | `frontend/src/components/utils-settings/Settings.jsx` | 21 |
| 151 | `frontend/src/components/utils-settings/settingsConflict.js` | 0 |
| 152 | `frontend/src/components/utils-settings/settingsConflict.ts` | 1 |
| 153 | `frontend/src/constants.js` | 0 |
| 154 | `frontend/src/index.jsx` | 10 |
| 155 | `frontend/src/platform/runtime/clientRuntime.js` | 10 |
| 156 | `frontend/src/platform/storage/storagePolicy.ts` | 0 |
| 157 | `frontend/src/types/jsx-modules.d.ts` | 0 |
| 158 | `frontend/src/types/receiptContracts.ts` | 0 |
| 159 | `frontend/src/types/settingsContracts.ts` | 0 |
| 160 | `frontend/src/utils/actionGuards.ts` | 1 |
| 161 | `frontend/src/utils/appRefresh.d.ts` | 0 |
| 162 | `frontend/src/utils/appRefresh.js` | 1 |
| 163 | `frontend/src/utils/bulkOps.ts` | 1 |
| 164 | `frontend/src/utils/color.js` | 0 |
| 165 | `frontend/src/utils/color.ts` | 2 |
| 166 | `frontend/src/utils/csv.d.ts` | 0 |
| 167 | `frontend/src/utils/csv.js` | 8 |
| 168 | `frontend/src/utils/csvExportWorker.ts` | 1 |
| 169 | `frontend/src/utils/csvImport.js` | 0 |
| 170 | `frontend/src/utils/csvImport.ts` | 8 |
| 171 | `frontend/src/utils/csvRowCounter.ts` | 1 |
| 172 | `frontend/src/utils/dateHelpers.js` | 0 |
| 173 | `frontend/src/utils/dateHelpers.ts` | 1 |
| 174 | `frontend/src/utils/deviceInfo.js` | 0 |
| 175 | `frontend/src/utils/deviceInfo.ts` | 2 |
| 176 | `frontend/src/utils/exportPackage.js` | 0 |
| 177 | `frontend/src/utils/exportPackage.ts` | 0 |
| 178 | `frontend/src/utils/exportReports.jsx` | 8 |
| 179 | `frontend/src/utils/favicon.js` | 3 |
| 180 | `frontend/src/utils/formatters.js` | 0 |
| 181 | `frontend/src/utils/formatters.ts` | 1 |
| 182 | `frontend/src/utils/groupedRecords.ts` | 3 |
| 183 | `frontend/src/utils/historyHelpers.ts` | 0 |
| 184 | `frontend/src/utils/importJobRefresh.js` | 3 |
| 185 | `frontend/src/utils/index.js` | 0 |
| 186 | `frontend/src/utils/index.ts` | 0 |
| 187 | `frontend/src/utils/initials.ts` | 1 |
| 188 | `frontend/src/utils/mediaUpload.js` | 0 |
| 189 | `frontend/src/utils/mediaUpload.ts` | 0 |
| 190 | `frontend/src/utils/permissions.js` | 0 |
| 191 | `frontend/src/utils/permissions.ts` | 1 |
| 192 | `frontend/src/utils/pricing.d.ts` | 0 |
| 193 | `frontend/src/utils/pricing.js` | 0 |
| 194 | `frontend/src/utils/pricing.ts` | 0 |
| 195 | `frontend/src/utils/printReceipt.js` | 31 |
| 196 | `frontend/src/utils/productBatches.ts` | 1 |
| 197 | `frontend/src/utils/productGrouping.ts` | 9 |
| 198 | `frontend/src/utils/publicAssetUrls.d.ts` | 0 |
| 199 | `frontend/src/utils/publicAssetUrls.js` | 5 |
| 200 | `frontend/src/utils/receiptAppliedConfig.ts` | 1 |
| 201 | `frontend/src/utils/scriptTypography.js` | 0 |
| 202 | `frontend/src/utils/scriptTypography.ts` | 0 |
| 203 | `frontend/src/utils/settingsRefresh.js` | 0 |
| 204 | `frontend/src/utils/settingsRefresh.ts` | 1 |
| 205 | `frontend/src/utils/settingsWriteOptions.ts` | 0 |
| 206 | `frontend/src/web-api.js` | 32 |
| 207 | `ops/scripts/frontend/verify-i18n.js` | 6 |
| 208 | `ops/scripts/frontend/verify-performance.js` | 4 |
| 209 | `ops/scripts/frontend/verify-ui.js` | 11 |
| 210 | `frontend/vite.config.mjs` | 5 |
| 211 | `frontend/postcss.config.mjs` | 0 |
| 212 | `frontend/tailwind.config.mjs` | 0 |

## 3. Detailed Function Commentary

### 3.1 `frontend/src/api/http.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `hasStoredAuthSession` | function | 61 |
| 2 | `isProtectedAdminHost` | function | 70 |
| 3 | `normalizeApiPath` | function | 87 |
| 4 | `getApiMismatchKey` | function | 104 |
| 5 | `dispatchApiVersionMismatch` | function | 119 |
| 6 | `logCall` | function | 194 |
| 7 | `getClientMetaHeaders` | function | 202 |
| 8 | `createApiError` | function | 206 |
| 9 | `createCloudflareAccessError` | function | 235 |
| 10 | `dispatchUnauthorized` | function | 245 |
| 11 | `dispatchRuntimeVersionMismatch` | function | 273 |
| 12 | `checkRuntimeVersionFromHealth` | function | 285 |
| 13 | `createWriteBlockedError` | function | 292 |
| 14 | `dispatchWriteBlocked` | function | 303 |
| 15 | `dispatchTransientGatewayOutage` | function | 318 |
| 16 | `getConflictRefreshChannels` | function | 383 |
| 17 | `dispatchGlobalDataRefresh` | function | 392 |
| 18 | `sleep` | function | 401 |
| 19 | `hasUsableLocalData` | function | 405 |
| 20 | `tryServerReadWithRetry` | function | 420 |
| 21 | `noteReadFailure` | function | 431 |
| 22 | `resolveLocalRead` | function | 445 |
| 23 | `stableStringifyForDedupe` | function | 452 |
| 24 | `clampDedupeBody` | function | 462 |
| 25 | `methodAllowsRequestBody` | function | 474 |
| 26 | `requestPromise` | const arrow | 504 |
| 27 | `parsed` | const arrow | 541 |
| 28 | `shouldDispatchUnauthorized` | function | 602 |
| 29 | `isConnectivityError` | function | 615 |
| 30 | `setServerHealth` | function | 638 |
| 31 | `pingServerHealth` | function | 651 |
| 32 | `getChannelRefreshKey` | function | 723 |
| 33 | `emitCacheRefresh` | function | 727 |
| 34 | `clearInflight` | function | 741 |
| 35 | `hasReusableInflight` | function | 746 |
| 36 | `raceServerReadWithLocalFallback` | function | 756 |

### 3.2 `frontend/src/api/localDb.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `splitCSVLine` | function | 259 |

### 3.3 `frontend/src/api/methods.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDeviceInfo` | function | 3 |
| 2 | `getPortalBaseUrl` | function | 52 |
| 3 | `buildQueryString` | function | 57 |
| 4 | `appendQuery` | function | 67 |
| 5 | `normalizePositiveUniqueIds` | function | 71 |
| 6 | `getCurrentUserContext` | function | 84 |
| 7 | `registerOutboxBackgroundSync` | function | 106 |
| 8 | `hasStoredUserSession` | function | 118 |
| 9 | `emitSyncQueueChanged` | function | 127 |
| 10 | `createClientRequestId` | function | 152 |
| 11 | `ensureClientRequestId` | function | 159 |
| 12 | `canRefreshOfflineDeviceSnapshot` | function | 210 |
| 13 | `readOfflineDeviceSnapshotMeta` | function | 217 |
| 14 | `writeOfflineDeviceSnapshotMeta` | function | 225 |
| 15 | `runOfflineSnapshotStep` | function | 242 |
| 16 | `previousMeta` | const arrow | 262 |
| 17 | `invalidateClientRuntimeState` | function | 307 |
| 18 | `withExpectedUpdatedAt` | function | 323 |
| 19 | `withSettingsExpectedUpdatedAt` | function | 337 |
| 20 | `appendActorQuery` | function | 347 |
| 21 | `fetchJsonWithTimeout` | function | 362 |
| 22 | `mirrorReadResult` | function | 380 |
| 23 | `routeMirrored` | function | 389 |
| 24 | `shouldPersistLocalMirror` | function | 395 |
| 25 | `purgeSensitiveLiveServerMirrors` | function | 399 |
| 26 | `mirrorTable` | function | 410 |
| 27 | `buildQueryCacheStorageKey` | function | 424 |
| 28 | `readCachedQueryResult` | function | 428 |
| 29 | `writeCachedQueryResult` | function | 442 |
| 30 | `clearCachedQueryResults` | function | 456 |
| 31 | `getNotificationSummaryFallback` | function | 499 |
| 32 | `getDriveSyncStatusFallback` | function | 508 |
| 33 | `readNotificationSummaryMissingUntil` | function | 516 |
| 34 | `markNotificationSummaryMissing` | function | 528 |
| 35 | `clearNotificationSummaryMissing` | function | 543 |
| 36 | `readStorageNumber` | function | 552 |
| 37 | `writeStorageNumber` | function | 568 |
| 38 | `clearStorageNumber` | function | 579 |
| 39 | `buildLocalBootstrap` | const arrow | 679 |
| 40 | `runSave` | const arrow | 770 |
| 41 | `getCategories` | const arrow | 830 |
| 42 | `createCategory` | const arrow | 831 |
| 43 | `updateCategory` | const arrow | 836 |
| 44 | `deleteCategory` | const arrow | 841 |
| 45 | `getUnits` | const arrow | 848 |
| 46 | `createUnit` | const arrow | 849 |
| 47 | `updateUnit` | const arrow | 854 |
| 48 | `deleteUnit` | const arrow | 859 |
| 49 | `getBranches` | const arrow | 866 |
| 50 | `getBranchSummary` | const arrow | 867 |
| 51 | `updateBranch` | const arrow | 869 |
| 52 | `deleteBranch` | const arrow | 873 |
| 53 | `getBranchStock` | const arrow | 877 |
| 54 | `getTransfers` | const arrow | 881 |
| 55 | `getBranchStockIntegrity` | const arrow | 883 |
| 56 | `getProducts` | const arrow | 887 |
| 57 | `searchProducts` | const arrow | 888 |
| 58 | `getProductsByIds` | const arrow | 898 |
| 59 | `getProductFilters` | const arrow | 909 |
| 60 | `getProductLookupUsage` | const arrow | 919 |
| 61 | `replaceProductLookupValues` | const arrow | 927 |
| 62 | `getPortalSubmissionsForReview` | const arrow | 1046 |
| 63 | `reviewPortalSubmission` | const arrow | 1048 |
| 64 | `getAiProviders` | const arrow | 1051 |
| 65 | `createAiProvider` | const arrow | 1053 |
| 66 | `updateAiProvider` | const arrow | 1055 |
| 67 | `deleteAiProvider` | const arrow | 1057 |
| 68 | `testAiProvider` | const arrow | 1059 |
| 69 | `getAiResponses` | const arrow | 1061 |
| 70 | `deleteProduct` | const arrow | 1090 |
| 71 | `buildMultipartHeaders` | function | 1107 |
| 72 | `apiFormPost` | function | 1117 |
| 73 | `withImportDeviceInfo` | const arrow | 1136 |
| 74 | `listImportJobs` | const arrow | 1139 |
| 75 | `getImportJobReview` | const arrow | 1148 |
| 76 | `updateImportJobDecisions` | const arrow | 1152 |
| 77 | `startImportJob` | const arrow | 1155 |
| 78 | `approveImportJob` | const arrow | 1157 |
| 79 | `cancelImportJob` | const arrow | 1159 |
| 80 | `retryImportJob` | const arrow | 1161 |
| 81 | `deleteImportJob` | const arrow | 1163 |
| 82 | `getImportQueueStatus` | const arrow | 1182 |
| 83 | `finish` | const arrow | 1297 |
| 84 | `abortListener` | const arrow | 1304 |
| 85 | `getActionHistory` | const arrow | 1476 |
| 86 | `updateActionHistory` | const arrow | 1482 |
| 87 | `getInventorySummary` | const arrow | 1488 |
| 88 | `getInventoryStats` | const arrow | 1489 |
| 89 | `searchInventoryProducts` | const arrow | 1493 |
| 90 | `getInventoryMovements` | const arrow | 1503 |
| 91 | `getInventoryReasons` | const arrow | 1528 |
| 92 | `saveInventoryReasons` | const arrow | 1530 |
| 93 | `buildOfflineSaleReceiptNumber` | function | 1533 |
| 94 | `isRetryableOfflineSaleError` | function | 1539 |
| 95 | `findQueuedSale` | function | 1548 |
| 96 | `putOfflineSaleMirror` | function | 1555 |
| 97 | `queueOfflineSale` | function | 1580 |
| 98 | `queuedSaleBackoffMs` | function | 1638 |
| 99 | `updateQueuedRow` | function | 1643 |
| 100 | `completeQueuedSale` | function | 1652 |
| 101 | `failQueuedSale` | function | 1679 |
| 102 | `markQueuedSaleConflict` | function | 1692 |
| 103 | `syncPendingSalesQueue` | function | 1714 |
| 104 | `getRfidStatus` | const arrow | 1755 |
| 105 | `searchRfidTags` | const arrow | 1761 |
| 106 | `recordRfidSessionEvents` | const arrow | 1767 |
| 107 | `applyRfidSession` | const arrow | 1771 |
| 108 | `getSales` | const arrow | 1787 |
| 109 | `getDashboard` | const arrow | 1794 |
| 110 | `getAnalytics` | const arrow | 1795 |
| 111 | `getCustomers` | const arrow | 1804 |
| 112 | `getCustomerPointSummaries` | const arrow | 1825 |
| 113 | `updateCustomer` | const arrow | 1833 |
| 114 | `deleteCustomer` | const arrow | 1837 |
| 115 | `downloadCustomerTemplate` | const arrow | 1842 |
| 116 | `getSuppliers` | const arrow | 1851 |
| 117 | `updateSupplier` | const arrow | 1860 |
| 118 | `deleteSupplier` | const arrow | 1864 |
| 119 | `downloadSupplierTemplate` | const arrow | 1869 |
| 120 | `getDeliveryContacts` | const arrow | 1878 |
| 121 | `updateDeliveryContact` | const arrow | 1887 |
| 122 | `deleteDeliveryContact` | const arrow | 1891 |
| 123 | `getUsers` | const arrow | 1898 |
| 124 | `updateUser` | const arrow | 1900 |
| 125 | `getUserProfile` | const arrow | 1901 |
| 126 | `getUserAuthMethods` | const arrow | 1902 |
| 127 | `updateUserProfile` | const arrow | 1904 |
| 128 | `disconnectUserAuthProvider` | const arrow | 1906 |
| 129 | `changeUserPassword` | const arrow | 1908 |
| 130 | `resetPassword` | const arrow | 1910 |
| 131 | `getRoles` | const arrow | 1913 |
| 132 | `updateRole` | const arrow | 1915 |
| 133 | `deleteRole` | const arrow | 1916 |
| 134 | `getCustomTables` | const arrow | 1919 |
| 135 | `getCustomTableData` | const arrow | 1921 |
| 136 | `insertCustomRow` | const arrow | 1922 |
| 137 | `updateCustomRow` | const arrow | 1923 |
| 138 | `deleteCustomRow` | const arrow | 1924 |
| 139 | `getAuditLogs` | const arrow | 1927 |
| 140 | `deleteAuditLogsRetention` | const arrow | 1953 |
| 141 | `wait` | function | 1957 |
| 142 | `waitForSystemJob` | function | 1997 |
| 143 | `getGoogleDriveSyncStatus` | const arrow | 2044 |
| 144 | `saveGoogleDriveSyncPreferences` | const arrow | 2078 |
| 145 | `startGoogleDriveSyncOauth` | const arrow | 2081 |
| 146 | `disconnectGoogleDriveSync` | const arrow | 2084 |
| 147 | `forgetGoogleDriveSyncCredentials` | const arrow | 2087 |
| 148 | `queueGoogleDriveSyncNow` | const arrow | 2090 |
| 149 | `syncGoogleDriveNow` | const arrow | 2093 |
| 150 | `getReturns` | const arrow | 2169 |
| 151 | `updateSaleStatus` | const arrow | 2190 |
| 152 | `attachSaleCustomer` | const arrow | 2206 |
| 153 | `getSalesExport` | const arrow | 2230 |
| 154 | `updateReturn` | const arrow | 2234 |
| 155 | `getDataPath` | const arrow | 2294 |
| 156 | `getScaleMigrationStatus` | const arrow | 2295 |
| 157 | `prepareScaleMigration` | const arrow | 2296 |
| 158 | `runScaleMigration` | const arrow | 2297 |
| 159 | `browseDir` | const arrow | 2308 |

### 3.4 `frontend/src/api/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `hasStoredAuthSession` | function | 21 |
| 2 | `isProtectedAdminHost` | function | 30 |
| 3 | `shouldDebugWs` | function | 40 |
| 4 | `logWs` | function | 50 |
| 5 | `scheduleReconnect` | function | 173 |

### 3.5 `frontend/src/App.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getChunkErrorMessage` | function | 100 |
| 2 | `isChunkLoadError` | function | 105 |
| 3 | `createChunkTimeoutError` | function | 114 |
| 4 | `isRetryableImportError` | function | 120 |
| 5 | `importWithTimeout` | function | 128 |
| 6 | `clearRetryMarker` | function | 144 |
| 7 | `buildChunkRecoveryUrl` | function | 151 |
| 8 | `deleteStaleShellCaches` | function | 162 |
| 9 | `clearStaleShellCaches` | function | 175 |
| 10 | `triggerChunkRecoveryReload` | function | 185 |
| 11 | `reload` | const arrow | 192 |
| 12 | `createChunkReloadStallError` | function | 202 |
| 13 | `shouldRetryChunk` | function | 208 |
| 14 | `lazyWithRetry` | function | 218 |
| 15 | `getWarmupImporters` | function | 293 |
| 16 | `shouldSkipBackgroundWarmup` | function | 305 |
| 17 | `shouldSkipIntentWarmup` | function | 314 |
| 18 | `getIntentPageId` | function | 323 |
| 19 | `scheduleIntentChunkLoad` | function | 327 |
| 20 | `run` | const arrow | 334 |
| 21 | `getDataWarmupLoaders` | function | 358 |
| 22 | `createWarmupLoader` | function | 367 |
| 23 | `runWarmupBatches` | function | 372 |
| 24 | `getPageEntryWarmupLoaders` | function | 381 |
| 25 | `useMountedPages` | function | 388 |
| 26 | `syncProfile` | const arrow | 402 |
| 27 | `useSyncErrorBanner` | function | 431 |
| 28 | `refreshPendingSync` | const arrow | 441 |
| 29 | `onSyncError` | const arrow | 446 |
| 30 | `onTransientOutage` | const arrow | 451 |
| 31 | `onSyncRecovered` | const arrow | 459 |
| 32 | `onQueueChanged` | const arrow | 466 |
| 33 | `onVaultLocked` | const arrow | 467 |
| 34 | `onAppUpdate` | const arrow | 468 |
| 35 | `onConflictReview` | const arrow | 469 |
| 36 | `useVisibilityRecovery` | function | 516 |
| 37 | `onVisible` | const arrow | 520 |
| 38 | `onFocus` | const arrow | 530 |
| 39 | `useChunkWarmup` | function | 548 |
| 40 | `runWarmup` | const arrow | 561 |
| 41 | `useIntentChunkWarmup` | function | 593 |
| 42 | `warmIntentPage` | const arrow | 600 |
| 43 | `useDataWarmup` | function | 620 |
| 44 | `runWarmup` | const arrow | 631 |
| 45 | `usePageEntryWarmup` | function | 656 |
| 46 | `run` | const arrow | 688 |
| 47 | `PageErrorBoundary` | class | 711 |
| 48 | `Notification` | function | 764 |
| 49 | `SyncErrorBanner` | function | 777 |
| 50 | `GlobalScrollControls` | function | 799 |
| 51 | `scrollTo` | const arrow | 800 |
| 52 | `formatSyncTimestamp` | function | 836 |
| 53 | `OfflineModeBanner` | function | 848 |
| 54 | `PageLoader` | function | 997 |
| 55 | `NotificationCenterFallback` | function | 1040 |
| 56 | `PageSlot` | function | 1054 |
| 57 | `PublicCatalogView` | function | 1080 |
| 58 | `App` | component/function | 1090 |
| 59 | `onQueued` | const arrow | 1155 |
| 60 | `onSynced` | const arrow | 1168 |
| 61 | `handleLocationChange` | const arrow | 1193 |
| 62 | `loadFavicon` | function | 1239 |

### 3.6 `frontend/src/app/appShellUtils.ts`

- No top-level named function/class symbols detected.

### 3.7 `frontend/src/AppContext.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 19 | `buildRuntimeDescriptorFromBootstrap` | function | 245 |
| 20 | `LoadingScreen` | function | 273 |
| 21 | `AccessDenied` | function | 286 |
| 22 | `onUpdate` | const arrow | 522 |
| 23 | `onStatus` | const arrow | 552 |
| 24 | `poll` | const arrow | 560 |
| 25 | `onError` | const arrow | 580 |
| 26 | `onWriteBlocked` | const arrow | 596 |
| 27 | `onRuntimeMismatch` | const arrow | 605 |
| 28 | `onConflict` | const arrow | 624 |
| 29 | `onUnauthorized` | const arrow | 693 |
| 30 | `handleOtpLogin` | const arrow | 751 |
| 31 | `handleUserUpdated` | const arrow | 793 |
| 32 | `discoverSyncUrl` | const arrow | 830 |
| 33 | `hexAlpha` | const arrow | 1004 |
| 34 | `clearCallbackUrl` | const arrow | 1215 |
| 35 | `clearPendingLink` | const arrow | 1219 |
| 36 | `run` | const arrow | 1223 |
| 37 | `useApp` | const arrow | 1585 |
| 38 | `useSync` | const arrow | 1586 |
| 39 | `useT` | const arrow | 1589 |

### 3.8 `frontend/src/components/auth/Login.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readPendingOauthLogin` | function | 27 |
| 2 | `clearPendingOauthLogin` | function | 41 |
| 3 | `readOauthCallbackResult` | function | 47 |
| 4 | `clearOauthCallbackResult` | function | 58 |
| 5 | `OauthButton` | function | 64 |
| 6 | `ModeBackButton` | function | 78 |
| 7 | `Login` | component/function | 91 |
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

### 3.9 `frontend/src/components/branches/Branches.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatTransferDate` | function | 39 |
| 2 | `Branches` | component/function | 56 |
| 3 | `promise` | const arrow | 101 |
| 4 | `loadBranchStock` | const arrow | 231 |
| 5 | `loadMoreBranchStock` | const arrow | 252 |
| 6 | `handleSaveBranch` | const arrow | 278 |
| 7 | `handleDelete` | const arrow | 346 |
| 8 | `handleBulkDelete` | const arrow | 394 |
| 9 | `toggleSelect` | const arrow | 480 |
| 10 | `toggleSelectAll` | const arrow | 489 |

### 3.10 `frontend/src/components/branches/BranchForm.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `BranchForm` | component/function | 11 |
| 2 | `set` | const arrow | 33 |
| 3 | `handleSave` | const arrow | 45 |

### 3.11 `frontend/src/components/branches/TransferModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeTransferStockRows` | function | 14 |
| 2 | `TransferModal` | component/function | 27 |
| 3 | `loadStock` | function | 79 |
| 4 | `handleTransfer` | const arrow | 125 |

### 3.12 `frontend/src/components/catalog/CatalogEditorSurface.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `CatalogEditorSurface` | component/function | 7 |

### 3.13 `frontend/src/components/catalog/CatalogImageField.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `CatalogImageField` | component/function | 4 |

### 3.14 `frontend/src/components/catalog/CatalogPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadCatalogEditorSurface` | const arrow | 90 |
| 2 | `loadCatalogSecondaryTabs` | const arrow | 91 |
| 3 | `loadCatalogProductsSection` | const arrow | 92 |
| 4 | `loadCatalogPreviewSurface` | const arrow | 93 |
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
| 39 | `readImageFileAsDataUrl` | function | 774 |
| 40 | `readImageFilesAsDataUrls` | function | 783 |
| 41 | `pickImageAsDataUrl` | function | 803 |
| 42 | `pickMultipleImagesAsDataUrls` | function | 816 |
| 43 | `replaceVars` | function | 829 |
| 44 | `getPortalResourceText` | function | 833 |
| 45 | `isFirstPartyTranslateTarget` | function | 871 |
| 46 | `normalizePortalTranslateChoice` | function | 878 |
| 47 | `isDocumentVisible` | function | 886 |
| 48 | `sleep` | function | 891 |
| 49 | `CatalogPage` | component/function | 997 |
| 50 | `warmPublicProductsPanel` | const arrow | 1111 |
| 51 | `warmPublicSecondaryTabs` | const arrow | 1115 |
| 52 | `copy` | const arrow | 1194 |
| 53 | `resolveVisibleTab` | const arrow | 1214 |
| 54 | `getMediaUploadState` | const arrow | 1262 |
| 55 | `updateMediaUploadState` | const arrow | 1263 |
| 56 | `forgetMediaUploadState` | const arrow | 1270 |
| 57 | `loadAssistantStatus` | function | 1317 |
| 58 | `openProductGallery` | function | 1339 |
| 59 | `changeTranslateTarget` | function | 1352 |
| 60 | `isPortalLoadCurrent` | function | 1400 |
| 61 | `loadPortalEditorData` | function | 1404 |
| 62 | `refreshPortalView` | function | 1441 |
| 63 | `loadPortal` | function | 1470 |
| 64 | `ensureLink` | const arrow | 1726 |
| 65 | `updateVisibility` | const arrow | 1819 |
| 66 | `handleScroll` | const arrow | 1849 |
| 67 | `initWidget` | const arrow | 1894 |
| 68 | `waitForWidget` | const arrow | 1912 |
| 69 | `toggleFilterValue` | function | 2036 |
| 70 | `clearPortalFilters` | function | 2044 |
| 71 | `setDraft` | function | 2052 |
| 72 | `toggleRecommendedProduct` | function | 2057 |
| 73 | `openPortalImage` | function | 2066 |
| 74 | `setAboutBlocksDraft` | function | 2077 |
| 75 | `setPromoItemsDraft` | function | 2081 |
| 76 | `getPortalMediaValue` | function | 2085 |
| 77 | `setPortalMediaValue` | function | 2099 |
| 78 | `clearPortalUploadPreview` | function | 2113 |
| 79 | `clearPortalMediaTarget` | function | 2119 |
| 80 | `uploadPortalMedia` | function | 2130 |
| 81 | `cancelPortalMediaUpload` | function | 2200 |
| 82 | `updateAboutBlock` | function | 2206 |
| 83 | `updatePromoItem` | function | 2212 |
| 84 | `addAboutBlock` | function | 2218 |
| 85 | `addPromoItem` | function | 2222 |
| 86 | `moveAboutBlockBefore` | function | 2226 |
| 87 | `removeAboutBlock` | function | 2238 |
| 88 | `movePromoItemBefore` | function | 2249 |
| 89 | `removePromoItem` | function | 2261 |
| 90 | `setFaqDraft` | function | 2272 |
| 91 | `addFaqItem` | function | 2276 |
| 92 | `mergeFaqStarterItems` | function | 2287 |
| 93 | `addFaqStarterSet` | function | 2300 |
| 94 | `addAiFaqStarterSet` | function | 2304 |
| 95 | `updateFaqItem` | function | 2308 |
| 96 | `removeFaqItem` | function | 2314 |
| 97 | `clearAssistantState` | function | 2318 |
| 98 | `uploadDraftImage` | function | 2333 |
| 99 | `uploadAboutBlockMedia` | function | 2337 |
| 100 | `uploadPromoItemMedia` | function | 2343 |
| 101 | `openFilePicker` | function | 2347 |
| 102 | `handleFilePickerSelect` | function | 2351 |
| 103 | `savePortalDraft` | function | 2377 |
| 104 | `askAssistant` | function | 2569 |
| 105 | `refreshMembershipData` | function | 2614 |
| 106 | `handleMembershipLookup` | function | 2656 |
| 107 | `addSubmissionImages` | function | 2669 |
| 108 | `handleSubmissionPaste` | function | 2679 |
| 109 | `handleSubmitShareProof` | function | 2695 |
| 110 | `handleReviewSubmission` | function | 2742 |
| 111 | `renderCatalogSection` | function | 2905 |
| 112 | `handleUploadSubmissionImages` | const arrow | 2931 |
| 113 | `renderSecondaryTabPanel` | function | 2987 |
| 114 | `renderSecondaryTabSection` | function | 2999 |
| 115 | `scrollPublicPortal` | const arrow | 3140 |

### 3.15 `frontend/src/components/catalog/CatalogPageContext.jsx`

- No top-level named function/class symbols detected.

### 3.16 `frontend/src/components/catalog/CatalogPreviewSurface.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `CatalogPreviewSurface` | component/function | 9 |
| 2 | `handlePortalTabClick` | const arrow | 47 |

### 3.17 `frontend/src/components/catalog/CatalogProductsSection.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBadgeIcon` | function | 10 |
| 2 | `getBadgeToneClass` | function | 18 |
| 3 | `getProductInitial` | function | 27 |
| 4 | `CatalogProductsSection` | component/function | 35 |

### 3.18 `frontend/src/components/catalog/CatalogSecondaryTabs.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizePortalColor` | function | 25 |
| 2 | `CatalogMembershipSection` | function | 30 |
| 3 | `CatalogAboutSection` | function | 376 |
| 4 | `CatalogFaqSection` | function | 590 |
| 5 | `CatalogAiSection` | function | 644 |
| 6 | `CatalogSecondaryTabs` | component/function | 830 |

### 3.19 `frontend/src/components/catalog/catalogUi.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `statusClass` | function | 3 |

### 3.20 `frontend/src/components/catalog/portalCatalogDisplay.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `replaceRankVars` | function | 173 |
| 2 | `normalizeRankBadgeLabel` | function | 177 |

### 3.21 `frontend/src/components/catalog/portalContentI18n.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPlainObject` | function | 558 |
| 2 | `normalizeLanguageKey` | function | 562 |
| 3 | `normalizeText` | function | 571 |
| 4 | `getLanguageBlock` | function | 595 |
| 5 | `pickTranslatedText` | function | 607 |
| 6 | `pickDefaultFirstPartyText` | function | 623 |
| 7 | `getCollectionEntry` | function | 630 |
| 8 | `localizeCollectionItems` | function | 647 |
| 9 | `getLanguageMap` | function | 665 |
| 10 | `escapeRegExp` | function | 674 |
| 11 | `protectPublicCopyTerms` | function | 678 |
| 12 | `restorePublicCopyTerms` | function | 692 |
| 13 | `localizeFaqItems` | function | 722 |
| 14 | `getProductTranslationBlock` | function | 762 |

### 3.22 `frontend/src/components/catalog/portalEditorUtils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPlainObject` | function | 47 |
| 2 | `toTrimmedString` | function | 51 |

### 3.23 `frontend/src/components/catalog/portalLanguagePacks.ts`

- No top-level named function/class symbols detected.

### 3.24 `frontend/src/components/contacts/ContactImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `countCsvDataRowsInWorker` | function | 33 |
| 2 | `cleanup` | const arrow | 45 |
| 3 | `ContactImportModal` | component/function | 65 |
| 4 | `signalDone` | const arrow | 80 |
| 5 | `loadCsvText` | const arrow | 93 |
| 6 | `handlePickFile` | const arrow | 114 |
| 7 | `handleChooseExistingFile` | const arrow | 120 |
| 8 | `handleDownloadTemplate` | const arrow | 137 |
| 9 | `applyContactRulePreset` | const arrow | 141 |
| 10 | `handleImport` | const arrow | 151 |

### 3.25 `frontend/src/components/contacts/contactImportParser.ts`

- No top-level named function/class symbols detected.

### 3.26 `frontend/src/components/contacts/contactImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.27 `frontend/src/components/contacts/contactOptionUtils.js`

- No top-level named function/class symbols detected.

### 3.28 `frontend/src/components/contacts/contactOptionUtils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPlainRecord` | function | 24 |
| 2 | `readStringField` | function | 28 |
| 3 | `normalizeOption` | function | 45 |

### 3.29 `frontend/src/components/contacts/Contacts.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeContactExportRows` | function | 16 |
| 2 | `TABS` | const arrow | 22 |
| 3 | `loadSuppliersTab` | const arrow | 29 |
| 4 | `loadDeliveryTab` | const arrow | 30 |
| 5 | `ContactTabFallback` | function | 34 |
| 6 | `ImportTypePicker` | function | 83 |
| 7 | `T` | const arrow | 84 |
| 8 | `Contacts` | component/function | 123 |
| 9 | `prefetchTab` | const arrow | 131 |
| 10 | `handleExportAll` | const arrow | 139 |
| 11 | `openImportPicker` | const arrow | 226 |
| 12 | `handleTypeSelected` | const arrow | 228 |
| 13 | `handleImportDone` | const arrow | 233 |

### 3.30 `frontend/src/components/contacts/CustomerFormModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `tr` | function | 11 |
| 2 | `parseContactOptions` | function | 16 |
| 3 | `OptionEditor` | function | 20 |
| 4 | `setField` | const arrow | 21 |
| 5 | `fieldId` | const arrow | 22 |
| 6 | `CustomerFormModal` | component/function | 65 |
| 7 | `setField` | const arrow | 77 |
| 8 | `addOption` | const arrow | 78 |
| 9 | `removeOption` | const arrow | 82 |
| 10 | `updateOption` | const arrow | 83 |
| 11 | `handleSubmit` | const arrow | 84 |

### 3.31 `frontend/src/components/contacts/customerMembershipNumber.js`

- No top-level named function/class symbols detected.

### 3.32 `frontend/src/components/contacts/customerMembershipNumber.ts`

- No top-level named function/class symbols detected.

### 3.33 `frontend/src/components/contacts/CustomersTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `tr` | function | 38 |
| 2 | `CustomersTab` | function | 47 |
| 3 | `toggleSectionCollapsed` | const arrow | 210 |
| 4 | `isSectionFullySelected` | const arrow | 216 |
| 5 | `isSectionPartiallySelected` | const arrow | 217 |
| 6 | `toggleSectionSelection` | const arrow | 218 |
| 7 | `promise` | const arrow | 245 |
| 8 | `handleSave` | const arrow | 331 |
| 9 | `handleDelete` | const arrow | 408 |
| 10 | `handleBulkDelete` | const arrow | 447 |

### 3.34 `frontend/src/components/contacts/DeliveryTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `BLANK_OPTION` | const arrow | 46 |
| 2 | `OptionEditor` | function | 49 |
| 3 | `set` | const arrow | 50 |
| 4 | `fieldId` | const arrow | 51 |
| 5 | `DeliveryForm` | function | 89 |
| 6 | `set` | const arrow | 98 |
| 7 | `addOption` | const arrow | 99 |
| 8 | `updateOption` | const arrow | 103 |
| 9 | `removeOption` | const arrow | 104 |
| 10 | `handleSave` | const arrow | 105 |
| 11 | `OptionsDisplay` | function | 175 |
| 12 | `OptionsBadge` | function | 192 |
| 13 | `DeliveryTab` | function | 203 |
| 14 | `toggleSectionCollapsed` | const arrow | 335 |
| 15 | `isSectionFullySelected` | const arrow | 341 |
| 16 | `isSectionPartiallySelected` | const arrow | 342 |
| 17 | `toggleSectionSelection` | const arrow | 343 |
| 18 | `promise` | const arrow | 368 |
| 19 | `handleSave` | const arrow | 430 |
| 20 | `handleDelete` | const arrow | 492 |
| 21 | `handleBulkDelete` | const arrow | 529 |

### 3.35 `frontend/src/components/contacts/shared.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toggleOne` | const arrow | 30 |
| 2 | `clearSelection` | const arrow | 41 |
| 3 | `menuContent` | const arrow | 99 |

### 3.36 `frontend/src/components/contacts/SuppliersTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.37 `frontend/src/components/custom-tables/CustomTables.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeRowValue` | function | 19 |
| 2 | `buildRowPayload` | function | 32 |
| 3 | `CustomTables` | component/function | 41 |
| 4 | `addColumn` | const arrow | 151 |
| 5 | `updateColumn` | const arrow | 158 |
| 6 | `removeColumn` | const arrow | 167 |
| 7 | `handleCreateTable` | const arrow | 174 |
| 8 | `handleSaveRow` | const arrow | 220 |
| 9 | `handleDeleteRow` | const arrow | 317 |
| 10 | `openAddRow` | const arrow | 369 |
| 11 | `openEditRow` | const arrow | 376 |

### 3.38 `frontend/src/components/dashboard/charts/BarChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `chartLabelsNeedYear` | function | 14 |
| 2 | `formatAxisLabel` | function | 23 |
| 3 | `BarChart` | component/function | 36 |
| 4 | `updateWidth` | const arrow | 44 |
| 5 | `yPx` | function | 79 |

### 3.39 `frontend/src/components/dashboard/charts/DonutChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `DonutChart` | component/function | 14 |

### 3.40 `frontend/src/components/dashboard/charts/index.js`

- No top-level named function/class symbols detected.

### 3.41 `frontend/src/components/dashboard/charts/index.ts`

- No top-level named function/class symbols detected.

### 3.42 `frontend/src/components/dashboard/charts/LineChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `chartLabelsNeedYear` | function | 13 |
| 2 | `formatAxisLabel` | function | 22 |
| 3 | `LineChart` | component/function | 35 |
| 4 | `updateWidth` | const arrow | 43 |
| 5 | `xPx` | function | 83 |
| 6 | `yPx` | function | 84 |
| 7 | `handleMouseMove` | const arrow | 92 |

### 3.43 `frontend/src/components/dashboard/charts/NoData.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `NoData` | component/function | 7 |

### 3.44 `frontend/src/components/dashboard/Dashboard.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 12 | `Dashboard` | component/function | 185 |
| 13 | `translateOr` | const arrow | 190 |
| 14 | `calcTrend` | const arrow | 420 |
| 15 | `rangeLabel` | const arrow | 464 |
| 16 | `periodShort` | const arrow | 470 |
| 17 | `buildExportAll` | const arrow | 857 |

### 3.45 `frontend/src/components/dashboard/MiniStat.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `MiniStat` | component/function | 2 |

### 3.46 `frontend/src/components/files/FilePickerModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `AssetPreview` | function | 16 |
| 2 | `FilePickerModal` | component/function | 39 |
| 3 | `tr` | const arrow | 61 |
| 4 | `toggleSelectedPath` | function | 102 |
| 5 | `handleUpload` | function | 112 |
| 6 | `handleDelete` | function | 154 |

### 3.47 `frontend/src/components/files/FilesPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 11 | `FilesPage` | component/function | 155 |
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

### 3.48 `frontend/src/components/files/FilesProvidersTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProviderStatus` | function | 10 |
| 2 | `FilesProvidersTab` | component/function | 21 |

### 3.49 `frontend/src/components/files/FilesResponsesTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `FilesResponsesTab` | component/function | 11 |

### 3.50 `frontend/src/components/inventory/DualMoney.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `DualMoney` | function | 5 |

### 3.51 `frontend/src/components/inventory/Inventory.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `reuseSetWhenUnchanged` | function | 52 |
| 2 | `normalizeFiniteIdsFrom` | function | 61 |
| 3 | `normalizeFiniteIds` | function | 69 |
| 4 | `countActiveFlags` | function | 73 |
| 5 | `countSelectedIds` | function | 81 |
| 6 | `renderDestinationProductOptions` | function | 89 |
| 7 | `limitInventorySectionsForMobile` | function | 100 |
| 8 | `priceCsv` | function | 127 |
| 9 | `parseInventoryTimestamp` | function | 131 |
| 10 | `InventoryDiscountBadge` | function | 145 |
| 11 | `InventoryBatchPreview` | function | 156 |
| 12 | `label` | const arrow | 158 |
| 13 | `loadInventoryExportTools` | function | 213 |
| 14 | `Inventory` | component/function | 228 |
| 15 | `promise` | const arrow | 471 |
| 16 | `handleAdjust` | const arrow | 836 |
| 17 | `openAdjust` | const arrow | 917 |
| 18 | `openMove` | const arrow | 924 |
| 19 | `openTransfer` | const arrow | 947 |
| 20 | `handleMoveStock` | const arrow | 1002 |
| 21 | `handleTransferStock` | const arrow | 1075 |
| 22 | `matchesSearch` | const arrow | 1166 |
| 23 | `productHay` | const arrow | 1173 |
| 24 | `movHay` | const arrow | 1176 |
| 25 | `syncViewport` | const arrow | 1232 |
| 26 | `statsValue` | const arrow | 1851 |
| 27 | `selectInventorySection` | const arrow | 3072 |

### 3.52 `frontend/src/components/inventory/InventoryImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `countInventoryCsvRowsInWorker` | function | 18 |
| 2 | `cleanup` | const arrow | 30 |
| 3 | `InventoryImportModal` | component/function | 50 |
| 4 | `tr` | const arrow | 63 |
| 5 | `signalDone` | const arrow | 69 |
| 6 | `analyzeCsvText` | const arrow | 80 |
| 7 | `setInventoryCsvText` | const arrow | 96 |
| 8 | `handlePickFile` | const arrow | 104 |
| 9 | `handleDownloadTemplate` | const arrow | 110 |
| 10 | `handleImport` | const arrow | 114 |

### 3.53 `frontend/src/components/inventory/inventoryImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.54 `frontend/src/components/inventory/InventoryMovementsSurface.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `InventoryMovementsSurface` | component/function | 6 |

### 3.55 `frontend/src/components/inventory/InventoryProductsSurface.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `InventoryProductsSurface` | component/function | 6 |
| 2 | `renderDesktopTableHead` | const arrow | 45 |
| 3 | `renderDesktopLoadingShell` | const arrow | 67 |

### 3.56 `frontend/src/components/inventory/InventoryRfidSurface.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `InventoryRfidSurface` | component/function | 1 |

### 3.57 `frontend/src/components/inventory/movementGroups.js`

- No top-level named function/class symbols detected.

### 3.58 `frontend/src/components/inventory/movementGroups.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.59 `frontend/src/components/inventory/ProductDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductDetailModal` | component/function | 6 |
| 2 | `T` | const arrow | 7 |

### 3.60 `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `sanitizeInteger` | function | 121 |
| 2 | `sanitizeKhr` | function | 126 |
| 3 | `formatLookupValue` | function | 132 |
| 4 | `LoyaltyPointsPage` | component/function | 136 |
| 5 | `copy` | const arrow | 140 |
| 6 | `showLoyaltySection` | const arrow | 161 |
| 7 | `setValue` | function | 231 |
| 8 | `handleSave` | function | 235 |
| 9 | `handleLookup` | function | 259 |

### 3.61 `frontend/src/components/navigation/Sidebar.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getFallbackLabel` | function | 50 |
| 2 | `getNavLabel` | function | 58 |
| 3 | `isDarkColor` | function | 74 |
| 4 | `withAlpha` | function | 84 |
| 5 | `mergeStyles` | function | 90 |
| 6 | `announcePageIntent` | function | 94 |
| 7 | `Sidebar` | component/function | 101 |

### 3.62 `frontend/src/components/pos/CartItem.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `CartItem` | component/function | 4 |

### 3.63 `frontend/src/components/pos/FilterPanel.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `countActiveFlags` | function | 3 |
| 2 | `POSFilterPanel` | component/function | 11 |
| 3 | `T` | const arrow | 33 |
| 4 | `clearAll` | const arrow | 44 |
| 5 | `chip` | const arrow | 53 |
| 6 | `SectionLabel` | const arrow | 59 |

### 3.64 `frontend/src/components/pos/POS.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `allTermsMatch` | function | 70 |
| 2 | `useDebouncedValue` | function | 75 |
| 3 | `ProductDiscountBadge` | function | 84 |
| 4 | `POS` | component/function | 94 |
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
| 15 | `addToCart` | function | 895 |
| 16 | `updateQty` | const arrow | 934 |
| 17 | `updatePrice` | const arrow | 942 |
| 18 | `updateItemBranch` | const arrow | 966 |
| 19 | `handleDiscountUsd` | const arrow | 1015 |
| 20 | `handleDiscountKhr` | const arrow | 1016 |
| 21 | `handleMembershipUnits` | const arrow | 1017 |
| 22 | `handleCheckout` | const arrow | 1056 |

### 3.65 `frontend/src/components/pos/posCore.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeNumber` | function | 41 |

### 3.66 `frontend/src/components/pos/ProductImage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductImage` | component/function | 3 |

### 3.67 `frontend/src/components/pos/QuickAddModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `QuickAddModal` | component/function | 4 |
| 2 | `T` | const arrow | 5 |

### 3.68 `frontend/src/components/products/config/productPageConfig.ts`

- No top-level named function/class symbols detected.

### 3.69 `frontend/src/components/products/forms/BranchStockAdjuster.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `BranchStockAdjuster` | component/function | 7 |
| 2 | `T` | const arrow | 28 |
| 3 | `setRow` | const arrow | 34 |
| 4 | `handleSave` | const arrow | 40 |

### 3.70 `frontend/src/components/products/forms/BulkAddStockModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `BulkAddStockModal` | function | 9 |
| 2 | `handleSave` | const arrow | 20 |

### 3.71 `frontend/src/components/products/forms/ProductForm.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeGallery` | function | 20 |
| 2 | `editablePrice` | function | 36 |
| 3 | `pickImageFiles` | function | 41 |
| 4 | `ProductForm` | component/function | 60 |
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

### 3.72 `frontend/src/components/products/forms/VariantFormModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `VariantFormModal` | component/function | 12 |
| 2 | `tr` | const arrow | 14 |
| 3 | `setField` | const arrow | 41 |
| 4 | `setNumeric` | const arrow | 42 |
| 5 | `handleSave` | const arrow | 47 |

### 3.73 `frontend/src/components/products/helpers/productDisplayHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toNumber` | function | 57 |

### 3.74 `frontend/src/components/products/helpers/productFilterHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toNumber` | function | 66 |
| 2 | `getImageGallery` | function | 71 |
| 3 | `toImageName` | const arrow | 152 |
| 4 | `toImageUrl` | const arrow | 153 |
| 5 | `priceCsv` | const arrow | 154 |

### 3.75 `frontend/src/components/products/helpers/productGalleryHelpers.ts`

- No top-level named function/class symbols detected.

### 3.76 `frontend/src/components/products/helpers/productGroupViewHelpers.ts`

- No top-level named function/class symbols detected.

### 3.77 `frontend/src/components/products/helpers/productMenuHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `asString` | function | 85 |

### 3.78 `frontend/src/components/products/helpers/productSelectionHelpers.ts`

- No top-level named function/class symbols detected.

### 3.79 `frontend/src/components/products/helpers/productWriteHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toFiniteNumber` | function | 123 |
| 2 | `hasBulkFormValue` | function | 128 |
| 3 | `stringOrEmpty` | function | 132 |

### 3.80 `frontend/src/components/products/history/productHistoryHelpers.ts`

- No top-level named function/class symbols detected.

### 3.81 `frontend/src/components/products/import/BulkImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 30 | `BulkImportModal` | component/function | 497 |
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
| 54 | `toggleFamilyCollapse` | const arrow | 1249 |
| 55 | `toggleInlineDetails` | const arrow | 1258 |
| 56 | `toggleConflictSelection` | const arrow | 1267 |
| 57 | `toggleSelectAllConflicts` | const arrow | 1276 |
| 58 | `applyDecisionToSelection` | const arrow | 1284 |
| 59 | `applyImageDecisionToSelection` | const arrow | 1294 |
| 60 | `applyIdentifierDecisionToSelection` | const arrow | 1311 |
| 61 | `applyFieldRulePreset` | const arrow | 1323 |
| 62 | `renderConflictRow` | const arrow | 1336 |
| 63 | `updateEditedRow` | const arrow | 1344 |

### 3.82 `frontend/src/components/products/import/productImportPlanner.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeText` | function | 142 |
| 2 | `normalizeComparableText` | function | 150 |
| 3 | `hasSuspiciousEncodingCorruption` | function | 176 |
| 4 | `getCorruptedTextFields` | function | 185 |
| 5 | `getBlockingIssueMessage` | function | 189 |
| 6 | `normalizeFlag` | function | 201 |
| 7 | `normalizeProductForSignature` | function | 249 |
| 8 | `chooseParentProduct` | function | 286 |
| 9 | `buildExistingIndex` | function | 302 |
| 10 | `buildImportedIdentifierIndex` | function | 320 |
| 11 | `buildProductImportReviewGroups` | function | 336 |

### 3.83 `frontend/src/components/products/import/productImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `post` | function | 39 |
| 2 | `waitForNextTask` | function | 43 |
| 3 | `getErrorMessage` | function | 49 |

### 3.84 `frontend/src/components/products/lookups/ManageBrandsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `parseBrandOptions` | function | 40 |
| 2 | `parseBrandColorMap` | function | 53 |
| 3 | `toTitleCase` | function | 63 |
| 4 | `getBrandReviewRule` | function | 71 |
| 5 | `getBrandSortScore` | function | 75 |
| 6 | `buildSavedLibrary` | function | 81 |
| 7 | `ManageBrandsModal` | component/function | 99 |
| 8 | `saveLibrary` | const arrow | 207 |
| 9 | `restoreProductFieldSnapshots` | const arrow | 216 |
| 10 | `addLibraryBrand` | const arrow | 230 |
| 11 | `renameBrand` | const arrow | 282 |
| 12 | `removeBrands` | const arrow | 362 |
| 13 | `removeBrand` | const arrow | 442 |
| 14 | `applySuggestedNormalization` | const arrow | 444 |
| 15 | `toggleSelectedBrand` | const arrow | 450 |
| 16 | `toggleAllVisibleBrands` | const arrow | 459 |

### 3.85 `frontend/src/components/products/lookups/ManageCategoriesModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `mergeCategoryUsage` | function | 24 |
| 2 | `ManageCategoriesModal` | component/function | 53 |
| 3 | `handleAdd` | const arrow | 152 |
| 4 | `handleUpdate` | const arrow | 188 |
| 5 | `handleDelete` | const arrow | 243 |
| 6 | `toggleSelected` | const arrow | 291 |
| 7 | `toggleAllVisible` | const arrow | 301 |
| 8 | `handleDeleteSelected` | const arrow | 314 |

### 3.86 `frontend/src/components/products/lookups/ManageUnitsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `mergeUnitUsage` | function | 24 |
| 2 | `ManageUnitsModal` | component/function | 53 |
| 3 | `handleAdd` | const arrow | 152 |
| 4 | `handleUpdate` | const arrow | 188 |
| 5 | `handleDelete` | const arrow | 237 |
| 6 | `toggleSelected` | const arrow | 285 |
| 7 | `toggleAllVisible` | const arrow | 295 |
| 8 | `handleDeleteSelected` | const arrow | 308 |

### 3.87 `frontend/src/components/products/Products.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Products` | component/function | 129 |
| 2 | `promise` | const arrow | 212 |
| 3 | `handleSave` | const arrow | 383 |
| 4 | `uploadGalleryImages` | const arrow | 407 |
| 5 | `handleSaveWithGallery` | const arrow | 433 |
| 6 | `handleBulkDelete` | const arrow | 500 |
| 7 | `handleBulkOutOfStock` | const arrow | 547 |
| 8 | `handleBulkChangeBranch` | const arrow | 590 |
| 9 | `handleBulkAddStock` | const arrow | 620 |
| 10 | `toggleSelect` | const arrow | 628 |
| 11 | `toggleSelectAll` | const arrow | 635 |
| 12 | `handleDelete` | const arrow | 642 |
| 13 | `renderUnitChip` | const arrow | 722 |
| 14 | `openLightbox` | const arrow | 736 |
| 15 | `getStockBadge` | const arrow | 743 |

### 3.88 `frontend/src/components/products/scanning/barcodeImageScanner.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readFileAsDataUrl` | function | 37 |
| 2 | `createImageElement` | function | 62 |
| 3 | `loadImageSource` | function | 66 |
| 4 | `detectWithNativeBarcodeDetector` | function | 75 |

### 3.89 `frontend/src/components/products/scanning/BarcodeScannerModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `stopStream` | function | 24 |
| 2 | `readCameraPermissionState` | function | 30 |
| 3 | `watchCameraPermission` | function | 40 |
| 4 | `handleChange` | const arrow | 44 |
| 5 | `BarcodeScannerModal` | component/function | 53 |

### 3.90 `frontend/src/components/products/scanning/barcodeScannerState.ts`

- No top-level named function/class symbols detected.

### 3.91 `frontend/src/components/products/shared/primitives.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.92 `frontend/src/components/products/surfaces/HeaderActions.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductsHeaderActions` | component/function | 5 |
| 2 | `cleanFallback` | const arrow | 16 |
| 3 | `tr` | const arrow | 22 |

### 3.93 `frontend/src/components/products/surfaces/ProductDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductDetailModal` | component/function | 7 |
| 2 | `T` | const arrow | 23 |
| 3 | `Row` | const arrow | 43 |

### 3.94 `frontend/src/components/products/surfaces/ProductRowParts.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `label` | const arrow | 20 |

### 3.95 `frontend/src/components/products/surfaces/ProductsListSurface.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductsListSurface` | component/function | 4 |
| 2 | `renderDesktopTableHead` | const arrow | 47 |
| 3 | `renderDesktopLoadingShell` | const arrow | 76 |

### 3.96 `frontend/src/components/receipt-settings/AllFieldsPanel.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Toggle` | function | 5 |
| 2 | `AllFieldsPanel` | component/function | 21 |
| 3 | `T` | const arrow | 23 |
| 4 | `toggleSection` | const arrow | 42 |

### 3.97 `frontend/src/components/receipt-settings/constants.js`

- No top-level named function/class symbols detected.

### 3.98 `frontend/src/components/receipt-settings/constants.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `T` | const arrow | 110 |

### 3.99 `frontend/src/components/receipt-settings/ErrorBoundary.jsx`

- No top-level named function/class symbols detected.

### 3.100 `frontend/src/components/receipt-settings/FieldOrderManager.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getSectionOrderItems` | function | 4 |
| 2 | `buildList` | function | 23 |
| 3 | `toKeys` | function | 48 |
| 4 | `FieldOrderManager` | component/function | 52 |
| 5 | `moveItem` | const arrow | 66 |
| 6 | `addDivider` | const arrow | 74 |
| 7 | `removeDivider` | const arrow | 85 |
| 8 | `handleDragStart` | const arrow | 91 |
| 9 | `handleDragOver` | const arrow | 96 |

### 3.101 `frontend/src/components/receipt-settings/PrintSettings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Section` | function | 5 |
| 2 | `buildFallbackPreviewHtml` | function | 17 |
| 3 | `buildSafePreviewSource` | function | 35 |
| 4 | `PrintSettings` | component/function | 46 |
| 5 | `T` | const arrow | 47 |
| 6 | `persistPrintSettings` | const arrow | 69 |
| 7 | `setValue` | const arrow | 85 |
| 8 | `resetMargins` | const arrow | 94 |
| 9 | `getPreviewSource` | const arrow | 110 |

### 3.102 `frontend/src/components/receipt-settings/ReceiptPreview.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ReceiptPreview` | component/function | 12 |
| 2 | `loadPreview` | function | 23 |

### 3.103 `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Section` | function | 19 |
| 2 | `Toggle` | function | 30 |
| 3 | `ReceiptSettings` | component/function | 45 |
| 4 | `handleSave` | const arrow | 190 |

### 3.104 `frontend/src/components/receipt-settings/template.js`

- No top-level named function/class symbols detected.

### 3.105 `frontend/src/components/receipt-settings/template.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isRecord` | function | 6 |
| 2 | `parseTemplateInput` | function | 10 |

### 3.106 `frontend/src/components/receipt/Receipt.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `stripEmoji` | function | 9 |
| 2 | `displayAddress` | function | 14 |
| 3 | `parseItems` | function | 23 |
| 4 | `labelFor` | function | 115 |
| 5 | `Row` | function | 120 |
| 6 | `Receipt` | component/function | 132 |
| 7 | `em` | const arrow | 146 |
| 8 | `exportReceiptPdf` | const arrow | 342 |

### 3.107 `frontend/src/components/returns/EditReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `EditReturnModal` | function | 10 |
| 2 | `T` | const arrow | 12 |
| 3 | `updateQty` | const arrow | 38 |
| 4 | `updateRestock` | const arrow | 41 |
| 5 | `handleSubmit` | const arrow | 49 |

### 3.108 `frontend/src/components/returns/NewReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.109 `frontend/src/components/returns/NewSupplierReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `NewSupplierReturnModal` | component/function | 15 |
| 2 | `tr` | const arrow | 17 |
| 3 | `loadSetup` | function | 52 |
| 4 | `loadInventory` | function | 97 |
| 5 | `updateQty` | const arrow | 162 |
| 6 | `submit` | const arrow | 168 |

### 3.110 `frontend/src/components/returns/ReturnDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeScope` | function | 6 |
| 2 | `ReturnDetailModal` | component/function | 10 |
| 3 | `tr` | const arrow | 12 |

### 3.111 `frontend/src/components/returns/Returns.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeScope` | function | 34 |
| 2 | `getReturnTypeKey` | function | 38 |
| 3 | `getReturnTypeLabel` | function | 44 |
| 4 | `normalizeFiniteIdsFrom` | function | 52 |
| 5 | `normalizeFiniteIds` | function | 60 |
| 6 | `countSelectedIds` | function | 64 |
| 7 | `countActiveFlags` | function | 72 |
| 8 | `exportReturnRows` | function | 80 |
| 9 | `Returns` | component/function | 98 |
| 10 | `promise` | const arrow | 163 |
| 11 | `handleOpenEdit` | const arrow | 240 |
| 12 | `renderAmount` | const arrow | 643 |

### 3.112 `frontend/src/components/returns/ReturnsListSurface.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `detectMobileViewport` | function | 14 |
| 2 | `ReturnsDesktopSkeletonRows` | function | 19 |
| 3 | `ReturnsMobileSkeletonCards` | function | 36 |
| 4 | `ReturnsListSurface` | component/function | 56 |
| 5 | `apply` | const arrow | 87 |

### 3.113 `frontend/src/components/sales/ExportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ExportModal` | component/function | 10 |
| 2 | `tr` | const arrow | 17 |
| 3 | `computeDates` | const arrow | 22 |
| 4 | `validateDates` | const arrow | 41 |
| 5 | `downloadCsvBlob` | const arrow | 49 |
| 6 | `buildCsvFallback` | const arrow | 59 |
| 7 | `escape` | const arrow | 63 |
| 8 | `handlePreview` | const arrow | 84 |
| 9 | `handleExportCSV` | const arrow | 101 |

### 3.114 `frontend/src/components/sales/SaleDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `InfoBlock` | function | 5 |
| 2 | `parseItems` | function | 21 |
| 3 | `SaleDetailModal` | component/function | 31 |
| 4 | `translateOr` | const arrow | 47 |
| 5 | `handleStatusUpdate` | const arrow | 69 |
| 6 | `handleMembershipAttach` | const arrow | 80 |

### 3.115 `frontend/src/components/sales/Sales.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `multiMatch` | function | 33 |
| 2 | `normalizeFiniteIdsFrom` | function | 37 |
| 3 | `normalizeFiniteIds` | function | 45 |
| 4 | `countSelectedIds` | function | 49 |
| 5 | `countActiveFlags` | function | 57 |
| 6 | `getSaleBranchLabel` | function | 65 |
| 7 | `Sales` | component/function | 73 |
| 8 | `promise` | const arrow | 156 |
| 9 | `handleStatusChange` | const arrow | 268 |
| 10 | `handleAttachMembership` | const arrow | 312 |
| 11 | `toggleSelected` | const arrow | 492 |
| 12 | `toggleSelectAll` | const arrow | 498 |
| 13 | `handleExportSelected` | const arrow | 537 |
| 14 | `handleBulkStatusUpdate` | const arrow | 585 |

### 3.116 `frontend/src/components/sales/SalesImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `countSalesCsvRowsInWorker` | function | 18 |
| 2 | `cleanup` | const arrow | 30 |
| 3 | `SalesImportModal` | component/function | 50 |
| 4 | `tr` | const arrow | 63 |
| 5 | `signalDone` | const arrow | 68 |
| 6 | `analyzeCsvText` | const arrow | 79 |
| 7 | `setSalesCsvText` | const arrow | 95 |
| 8 | `handlePickFile` | const arrow | 103 |
| 9 | `handleDownloadTemplate` | const arrow | 109 |
| 10 | `handleImport` | const arrow | 113 |

### 3.117 `frontend/src/components/sales/salesImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.118 `frontend/src/components/sales/SalesListSurface.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `SalesListSurface` | component/function | 5 |

### 3.119 `frontend/src/components/sales/StatusBadge.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `StatusBadge` | component/function | 39 |

### 3.120 `frontend/src/components/server/ServerPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 11 | `ServerPage` | component/function | 508 |
| 12 | `check` | const arrow | 535 |
| 13 | `loadSecurityConfig` | const arrow | 561 |
| 14 | `handleTest` | function | 577 |
| 15 | `handleSave` | function | 606 |
| 16 | `handleDisconnect` | function | 613 |

### 3.121 `frontend/src/components/shared/ActionHistoryBar.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatHistoryList` | function | 5 |
| 2 | `formatServerStatus` | function | 9 |
| 3 | `ActionHistoryBar` | component/function | 16 |
| 4 | `T` | const arrow | 27 |

### 3.122 `frontend/src/components/shared/BackgroundImportTracker.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 11 | `BackgroundImportTracker` | component/function | 176 |
| 12 | `beginTrackerAction` | const arrow | 303 |
| 13 | `finishTrackerAction` | const arrow | 312 |
| 14 | `handleCancel` | const arrow | 317 |
| 15 | `handleRetry` | const arrow | 335 |
| 16 | `handleApprove` | const arrow | 353 |
| 17 | `handleDownloadErrors` | const arrow | 382 |
| 18 | `handleRemove` | const arrow | 398 |
| 19 | `handleDismiss` | const arrow | 434 |

### 3.123 `frontend/src/components/shared/ExportMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ExportMenu` | component/function | 4 |

### 3.124 `frontend/src/components/shared/FilterMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `sectionButtonClass` | function | 4 |
| 2 | `FilterMenu` | component/function | 10 |

### 3.125 `frontend/src/components/shared/globalScroll.js`

- No top-level named function/class symbols detected.

### 3.126 `frontend/src/components/shared/ImageGalleryLightbox.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ImageGalleryLightbox` | component/function | 8 |
| 2 | `formatLabel` | function | 30 |
| 3 | `setIndex` | function | 34 |
| 4 | `renderGalleryImage` | function | 40 |
| 5 | `onKeyDown` | function | 47 |

### 3.127 `frontend/src/components/shared/LoadingWatchdog.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `LoadingWatchdog` | component/function | 3 |

### 3.128 `frontend/src/components/shared/Modal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Modal` | component/function | 10 |

### 3.129 `frontend/src/components/shared/navigationConfig.js`

- No top-level named function/class symbols detected.

### 3.130 `frontend/src/components/shared/navigationConfig.ts`

- No top-level named function/class symbols detected.

### 3.131 `frontend/src/components/shared/NotificationCenter.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `preferenceValue` | function | 135 |
| 2 | `matchesVisibilityMode` | function | 142 |
| 3 | `NotificationSeverityIcon` | function | 149 |
| 4 | `NotificationCenter` | component/function | 164 |
| 5 | `syncVisibility` | const arrow | 198 |
| 6 | `onVisible` | const arrow | 271 |
| 7 | `handleClickOutside` | const arrow | 294 |

### 3.132 `frontend/src/components/shared/pageActivity.js`

- No top-level named function/class symbols detected.

### 3.133 `frontend/src/components/shared/PageHeader.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PageHeader` | component/function | 9 |

### 3.134 `frontend/src/components/shared/PaginationControls.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PaginationControls` | component/function | 20 |
| 2 | `commitPageDraft` | const arrow | 50 |
| 3 | `handlePageInputKeyDown` | const arrow | 61 |

### 3.135 `frontend/src/components/shared/PortalMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PortalMenu` | component/function | 11 |
| 2 | `closeIfClickedOutside` | const arrow | 69 |
| 3 | `closeMenu` | const arrow | 76 |
| 4 | `scheduleReposition` | const arrow | 77 |
| 5 | `closeIfEscape` | const arrow | 84 |

### 3.136 `frontend/src/components/shared/QuickPreferenceToggles.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ToggleButton` | function | 4 |
| 2 | `QuickPreferenceToggles` | component/function | 23 |
| 3 | `tr` | const arrow | 25 |

### 3.137 `frontend/src/components/shared/SectionSwitcher.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readStoredSection` | function | 3 |
| 2 | `SectionSwitcher` | component/function | 12 |
| 3 | `selectValue` | const arrow | 39 |

### 3.138 `frontend/src/components/shared/WriteConflictModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatConflictTime` | function | 3 |
| 2 | `summarizeCurrentValue` | function | 10 |
| 3 | `formatValue` | function | 66 |
| 4 | `getConflictFieldRows` | function | 73 |
| 5 | `WriteConflictModal` | component/function | 171 |

### 3.139 `frontend/src/components/users/PermissionEditor.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PermissionEditor` | component/function | 49 |
| 2 | `translate` | const arrow | 50 |
| 3 | `labelFor` | const arrow | 56 |
| 4 | `sensitivityLabel` | const arrow | 57 |
| 5 | `toggle` | const arrow | 64 |

### 3.140 `frontend/src/components/users/UserDetailSheet.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `translateLabel` | function | 4 |
| 2 | `buildRowData` | function | 9 |
| 3 | `UserDetailSheet` | component/function | 21 |

### 3.141 `frontend/src/components/users/UserProfileModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `AvatarPreview` | function | 25 |
| 2 | `ProfileSectionButton` | function | 43 |
| 3 | `clamp` | function | 153 |
| 4 | `loadImageElement` | function | 157 |
| 5 | `renderAvatarCropBlob` | function | 172 |
| 6 | `AvatarEditorModal` | function | 198 |
| 7 | `UserProfileModal` | component/function | 259 |
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

### 3.142 `frontend/src/components/users/Users.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ThreeDot` | function | 33 |
| 2 | `formatContactValue` | function | 72 |
| 3 | `UsersDesktopSkeletonRows` | function | 77 |
| 4 | `UsersMobileSkeletonCards` | function | 101 |
| 5 | `Users` | component/function | 115 |
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

### 3.143 `frontend/src/components/utils-settings/AuditLog.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toIso` | function | 46 |
| 2 | `formatDateTime` | function | 52 |
| 3 | `formatLogTime` | function | 72 |
| 4 | `getLogEpoch` | function | 76 |
| 5 | `formatJsonPretty` | function | 83 |
| 6 | `parseLogJson` | function | 91 |
| 7 | `flattenSummaryValue` | function | 99 |
| 8 | `formatEntityName` | function | 118 |
| 9 | `readableSummary` | function | 124 |
| 10 | `normalizeFiniteIdsFrom` | function | 144 |
| 11 | `normalizeFiniteIds` | function | 152 |
| 12 | `countSelectedIds` | function | 156 |
| 13 | `countActiveFlags` | function | 164 |
| 14 | `DetailRow` | function | 172 |
| 15 | `AuditLog` | component/function | 184 |
| 16 | `sessionEntryLabel` | function | 578 |

### 3.144 `frontend/src/components/utils-settings/Backup.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 27 | `Backup` | component/function | 1134 |
| 28 | `showBackupSection` | const arrow | 1149 |
| 29 | `handleFolderExport` | const arrow | 1172 |
| 30 | `handleFolderImport` | const arrow | 1241 |

### 3.145 `frontend/src/components/utils-settings/FontFamilyPicker.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `FontFamilyPicker` | function | 20 |

### 3.146 `frontend/src/components/utils-settings/index.js`

- No top-level named function/class symbols detected.

### 3.147 `frontend/src/components/utils-settings/index.ts`

- No top-level named function/class symbols detected.

### 3.148 `frontend/src/components/utils-settings/OtpModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `OtpModal` | component/function | 17 |
| 2 | `loadSetup` | function | 52 |

### 3.149 `frontend/src/components/utils-settings/ResetData.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ConfirmReset` | function | 11 |
| 2 | `T` | const arrow | 24 |
| 3 | `ResetData` | function | 92 |
| 4 | `T` | const arrow | 94 |
| 5 | `doReset` | const arrow | 122 |
| 6 | `FactoryReset` | function | 192 |
| 7 | `T` | const arrow | 194 |
| 8 | `doFactoryReset` | function | 201 |

### 3.150 `frontend/src/components/utils-settings/Settings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `parseStoredColors` | function | 115 |
| 2 | `buildColorChoices` | function | 126 |
| 3 | `useCopy` | function | 217 |
| 4 | `getSettingsNavLabel` | function | 225 |
| 5 | `SwatchPicker` | function | 242 |
| 6 | `SettingsSection` | function | 325 |
| 7 | `Settings` | component/function | 355 |
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

### 3.151 `frontend/src/components/utils-settings/settingsConflict.js`

- No top-level named function/class symbols detected.

### 3.152 `frontend/src/components/utils-settings/settingsConflict.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeObject` | function | 28 |

### 3.153 `frontend/src/constants.js`

- No top-level named function/class symbols detected.

### 3.154 `frontend/src/index.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.155 `frontend/src/platform/runtime/clientRuntime.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `canUseBrowserStorage` | function | 7 |
| 2 | `isBusinessOsStorageKey` | function | 11 |
| 3 | `sanitizeText` | function | 16 |
| 4 | `mapRuntimeCleanup` | function | 103 |
| 5 | `unregisterServiceWorkers` | function | 121 |
| 6 | `deleteBusinessOsCaches` | function | 125 |
| 7 | `clearServiceWorkersAndCaches` | function | 131 |
| 8 | `snapshotStorage` | function | 147 |
| 9 | `clearStorage` | function | 160 |
| 10 | `restoreStorage` | function | 173 |

### 3.156 `frontend/src/platform/storage/storagePolicy.ts`

- No top-level named function/class symbols detected.

### 3.157 `frontend/src/types/jsx-modules.d.ts`

- No top-level named function/class symbols detected.

### 3.158 `frontend/src/types/receiptContracts.ts`

- No top-level named function/class symbols detected.

### 3.159 `frontend/src/types/settingsContracts.ts`

- No top-level named function/class symbols detected.

### 3.160 `frontend/src/utils/actionGuards.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `hasOwn` | function | 18 |

### 3.161 `frontend/src/utils/appRefresh.d.ts`

- No top-level named function/class symbols detected.

### 3.162 `frontend/src/utils/appRefresh.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeRefreshChannels` | function | 18 |

### 3.163 `frontend/src/utils/bulkOps.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `runner` | function | 47 |

### 3.164 `frontend/src/utils/color.js`

- No top-level named function/class symbols detected.

### 3.165 `frontend/src/utils/color.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeHex` | function | 1 |
| 2 | `relativeLuminance` | function | 12 |

### 3.166 `frontend/src/utils/csv.d.ts`

- No top-level named function/class symbols detected.

### 3.167 `frontend/src/utils/csv.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `escapeCsvValue` | function | 7 |
| 2 | `normalizeZipFile` | function | 47 |
| 3 | `CRC32_TABLE` | const arrow | 59 |
| 4 | `crc32` | function | 71 |
| 5 | `writeUint16` | function | 79 |
| 6 | `writeUint32` | function | 83 |
| 7 | `encodeZipTimestamp` | function | 87 |
| 8 | `finish` | const arrow | 183 |

### 3.168 `frontend/src/utils/csvExportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 20 |

### 3.169 `frontend/src/utils/csvImport.js`

- No top-level named function/class symbols detected.

### 3.170 `frontend/src/utils/csvImport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `stripBom` | function | 24 |
| 2 | `toUint8Array` | function | 28 |
| 3 | `detectUtf16Encoding` | function | 35 |
| 4 | `decodeUtf16Be` | function | 56 |
| 5 | `normalizeDigit` | function | 89 |
| 6 | `countDelimiter` | function | 104 |
| 7 | `removeCurrencyNoise` | function | 237 |
| 8 | `normalizeNumberSeparators` | function | 244 |

### 3.171 `frontend/src/utils/csvRowCounter.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `finishRecord` | const arrow | 7 |

### 3.172 `frontend/src/utils/dateHelpers.js`

- No top-level named function/class symbols detected.

### 3.173 `frontend/src/utils/dateHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toLocalDateString` | function | 4 |

### 3.174 `frontend/src/utils/deviceInfo.js`

- No top-level named function/class symbols detected.

### 3.175 `frontend/src/utils/deviceInfo.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBrowserName` | function | 13 |
| 2 | `getOperatingSystemName` | function | 21 |

### 3.176 `frontend/src/utils/exportPackage.js`

- No top-level named function/class symbols detected.

### 3.177 `frontend/src/utils/exportPackage.ts`

- No top-level named function/class symbols detected.

### 3.178 `frontend/src/utils/exportReports.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `escapeHtml` | function | 198 |
| 2 | `formatCellValue` | function | 207 |
| 3 | `renderChartMarkup` | function | 212 |
| 4 | `renderMetadataGroups` | function | 228 |
| 5 | `renderSummaryCards` | function | 250 |
| 6 | `renderCharts` | function | 265 |
| 7 | `renderTables` | function | 283 |
| 8 | `renderNotes` | function | 317 |

### 3.179 `frontend/src/utils/favicon.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `clamp` | function | 1 |
| 2 | `shouldUseAnonymousCors` | function | 8 |
| 3 | `loadImage` | function | 19 |

### 3.180 `frontend/src/utils/formatters.js`

- No top-level named function/class symbols detected.

### 3.181 `frontend/src/utils/formatters.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeTimestampInput` | function | 6 |

### 3.182 `frontend/src/utils/groupedRecords.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toDate` | function | 37 |
| 2 | `normalizeName` | function | 56 |
| 3 | `compareAlphabetLabels` | function | 64 |

### 3.183 `frontend/src/utils/historyHelpers.ts`

- No top-level named function/class symbols detected.

### 3.184 `frontend/src/utils/importJobRefresh.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeImportJobStatus` | function | 3 |
| 2 | `normalizeImportJobType` | function | 7 |
| 3 | `uniqueChannels` | function | 11 |

### 3.185 `frontend/src/utils/index.js`

- No top-level named function/class symbols detected.

### 3.186 `frontend/src/utils/index.ts`

- No top-level named function/class symbols detected.

### 3.187 `frontend/src/utils/initials.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getInitialRank` | function | 54 |

### 3.188 `frontend/src/utils/mediaUpload.js`

- No top-level named function/class symbols detected.

### 3.189 `frontend/src/utils/mediaUpload.ts`

- No top-level named function/class symbols detected.

### 3.190 `frontend/src/utils/permissions.js`

- No top-level named function/class symbols detected.

### 3.191 `frontend/src/utils/permissions.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPermissionMap` | function | 3 |

### 3.192 `frontend/src/utils/pricing.d.ts`

- No top-level named function/class symbols detected.

### 3.193 `frontend/src/utils/pricing.js`

- No top-level named function/class symbols detected.

### 3.194 `frontend/src/utils/pricing.ts`

- No top-level named function/class symbols detected.

### 3.195 `frontend/src/utils/printReceipt.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `parsePrintNumber` | function | 10 |
| 2 | `cloneElementWithInlineStyles` | function | 83 |
| 3 | `escapeHtml` | function | 129 |
| 4 | `blobToDataUrl` | function | 138 |
| 5 | `mapReceiptAssets` | function | 147 |
| 6 | `inlineImageNodeSources` | function | 161 |
| 7 | `extractUrlsFromCssValue` | function | 184 |
| 8 | `inlineStyleAssetUrls` | function | 190 |
| 9 | `normalizePrintableRoot` | function | 224 |
| 10 | `mmToPt` | function | 241 |
| 11 | `dataUrlToBytes` | function | 245 |
| 12 | `joinPdfChunks` | function | 255 |
| 13 | `buildPdfStream` | function | 266 |
| 14 | `buildSingleImagePdf` | function | 275 |
| 15 | `escapePdfText` | function | 313 |
| 16 | `wrapTextLine` | function | 320 |
| 17 | `buildTextOnlyPdf` | function | 339 |
| 18 | `buildReceiptFileName` | function | 392 |
| 19 | `createTextOnlyReceiptCanvas` | function | 403 |
| 20 | `canvasToPngBlob` | function | 444 |
| 21 | `waitForElementAssets` | function | 457 |
| 22 | `renderElementToCanvas` | function | 486 |
| 23 | `withReceiptElement` | function | 552 |
| 24 | `createPrintableReceiptMarkup` | function | 592 |
| 25 | `buildPrintablePreviewDocument` | function | 607 |
| 26 | `attachPrintablePreviewActions` | function | 754 |
| 27 | `schedulePrint` | const arrow | 763 |
| 28 | `downloadBlob` | function | 781 |
| 29 | `buildTextOnlyReceiptBlob` | const arrow | 829 |
| 30 | `renderPdfBlob` | const arrow | 843 |
| 31 | `extractReceiptLines` | function | 899 |

### 3.196 `frontend/src/utils/productBatches.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeBranchId` | function | 26 |

### 3.197 `frontend/src/utils/productGrouping.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeText` | function | 63 |
| 2 | `toProductId` | function | 67 |
| 3 | `compareSectionLabels` | function | 80 |
| 4 | `compareProducts` | function | 84 |
| 5 | `buildChildrenByParentId` | function | 107 |
| 6 | `resolveRootProduct` | function | 118 |
| 7 | `resolveFamilyRootId` | function | 136 |
| 8 | `compareProductsWithinGroup` | function | 140 |
| 9 | `resolveGroupKey` | function | 155 |

### 3.198 `frontend/src/utils/publicAssetUrls.d.ts`

- No top-level named function/class symbols detected.

### 3.199 `frontend/src/utils/publicAssetUrls.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `trimBaseUrl` | function | 4 |
| 2 | `normalizeUploadPath` | function | 8 |
| 3 | `appendAssetVersion` | function | 16 |
| 4 | `isLocalLikeHostname` | function | 31 |
| 5 | `getSafeCurrentOrigin` | function | 35 |

### 3.200 `frontend/src/utils/receiptAppliedConfig.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `parseObject` | function | 67 |

### 3.201 `frontend/src/utils/scriptTypography.js`

- No top-level named function/class symbols detected.

### 3.202 `frontend/src/utils/scriptTypography.ts`

- No top-level named function/class symbols detected.

### 3.203 `frontend/src/utils/settingsRefresh.js`

- No top-level named function/class symbols detected.

### 3.204 `frontend/src/utils/settingsRefresh.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeSettingKeys` | function | 62 |

### 3.205 `frontend/src/utils/settingsWriteOptions.ts`

- No top-level named function/class symbols detected.

### 3.206 `frontend/src/web-api.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `sanitizeBaseUrl` | function | 44 |
| 2 | `loadMethodsModule` | function | 48 |
| 3 | `getLazyApiMethod` | function | 53 |
| 4 | `mapOfflineFileChunkStatusUpdates` | function | 67 |
| 5 | `bytesToBase64` | function | 80 |
| 6 | `base64ToBytes` | function | 87 |
| 7 | `stableStringify` | function | 94 |
| 8 | `sha256Hex` | function | 100 |
| 9 | `deriveOfflineVaultKey` | function | 108 |
| 10 | `encryptOfflineVaultValue` | function | 125 |
| 11 | `decryptOfflineVaultValue` | function | 133 |
| 12 | `requestOfflinePersistentStorage` | function | 143 |
| 13 | `dispatchVaultLocked` | function | 150 |
| 14 | `scheduleOfflineVaultIdleLock` | function | 155 |
| 15 | `lockOfflineVault` | function | 161 |
| 16 | `unlockOfflineVault` | function | 168 |
| 17 | `queueBusinessOutboxOperation` | function | 193 |
| 18 | `queueOfflineFileChunks` | function | 231 |
| 19 | `dispatchOutboxProgress` | function | 284 |
| 20 | `dispatchOutboxFileProgress` | function | 291 |
| 21 | `dispatchOutboxConflict` | function | 298 |
| 22 | `getSyncOutboxKey` | function | 305 |
| 23 | `syncUnlockedOfflineOutbox` | function | 309 |
| 24 | `syncUnlockedOfflineFileChunks` | function | 418 |
| 25 | `registerOutboxBackgroundSync` | function | 476 |
| 26 | `refreshOfflineSnapshotSoon` | function | 488 |
| 27 | `run` | const arrow | 498 |
| 28 | `refreshServiceWorkerSoon` | function | 517 |
| 29 | `runOfflineMaintenance` | function | 527 |
| 30 | `startOfflineMaintenanceLoop` | function | 539 |
| 31 | `forwardServiceWorkerOutboxEvent` | function | 547 |
| 32 | `forwardServiceWorkerAppEvent` | function | 641 |

### 3.207 `ops/scripts/frontend/verify-i18n.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `collectUsedKeys` | function | 29 |
| 2 | `flattenTranslationTree` | function | 69 |
| 3 | `listMissing` | function | 83 |
| 4 | `listEmptyValues` | function | 88 |
| 5 | `printList` | function | 95 |
| 6 | `main` | function | 102 |

### 3.208 `ops/scripts/frontend/verify-performance.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `read` | function | 15 |
| 2 | `walk` | function | 19 |
| 3 | `trackedFiles` | function | 37 |
| 4 | `assert` | function | 47 |

### 3.209 `ops/scripts/frontend/verify-ui.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.210 `frontend/vite.config.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readGitRevision` | function | 8 |
| 2 | `fixCrossorigin` | function | 46 |
| 3 | `emitBuildManifest` | function | 71 |
| 4 | `shouldDeferModulePreload` | function | 112 |
| 5 | `manualChunks` | function | 116 |

### 3.211 `frontend/postcss.config.mjs`

- No top-level named function/class symbols detected.

### 3.212 `frontend/tailwind.config.mjs`

- No top-level named function/class symbols detected.

