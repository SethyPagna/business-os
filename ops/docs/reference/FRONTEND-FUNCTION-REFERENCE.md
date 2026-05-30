# Frontend Function Reference

Auto-generated symbol inventory for frontend files. Regenerate with `node ops/scripts/docs/generate-doc-reference.ts`.

## 1. Coverage Summary

Total files documented: **193**

## 2. Symbol Count by File

| No. | File | Symbols |
|---:|---|---:|
| 1 | `frontend/src/api/http.ts` | 32 |
| 2 | `frontend/src/api/localDb.ts` | 1 |
| 3 | `frontend/src/api/methods.js` | 163 |
| 4 | `frontend/src/api/websocket.ts` | 7 |
| 5 | `frontend/src/App.jsx` | 62 |
| 6 | `frontend/src/app/appShellUtils.ts` | 0 |
| 7 | `frontend/src/app/publicErrorRecovery.ts` | 1 |
| 8 | `frontend/src/AppContext.jsx` | 39 |
| 9 | `frontend/src/components/auth/Login.jsx` | 23 |
| 10 | `frontend/src/components/branches/Branches.tsx` | 15 |
| 11 | `frontend/src/components/branches/BranchForm.tsx` | 2 |
| 12 | `frontend/src/components/branches/TransferModal.tsx` | 6 |
| 13 | `frontend/src/components/catalog/CatalogEditorSurface.jsx` | 1 |
| 14 | `frontend/src/components/catalog/CatalogImageField.tsx` | 1 |
| 15 | `frontend/src/components/catalog/CatalogPage.jsx` | 115 |
| 16 | `frontend/src/components/catalog/CatalogPageContext.tsx` | 0 |
| 17 | `frontend/src/components/catalog/CatalogPreviewSurface.tsx` | 2 |
| 18 | `frontend/src/components/catalog/CatalogProductsSection.tsx` | 4 |
| 19 | `frontend/src/components/catalog/CatalogSecondaryTabs.jsx` | 6 |
| 20 | `frontend/src/components/catalog/catalogUi.tsx` | 1 |
| 21 | `frontend/src/components/catalog/portalCatalogDisplay.ts` | 2 |
| 22 | `frontend/src/components/catalog/portalContentI18n.ts` | 14 |
| 23 | `frontend/src/components/catalog/portalEditorUtils.ts` | 2 |
| 24 | `frontend/src/components/catalog/portalLanguagePacks.ts` | 0 |
| 25 | `frontend/src/components/catalog/portalTranslateController.ts` | 2 |
| 26 | `frontend/src/components/contacts/ContactImportModal.tsx` | 8 |
| 27 | `frontend/src/components/contacts/contactImportWorker.ts` | 1 |
| 28 | `frontend/src/components/contacts/contactOptionUtils.ts` | 3 |
| 29 | `frontend/src/components/contacts/Contacts.tsx` | 11 |
| 30 | `frontend/src/components/contacts/CustomerFormModal.tsx` | 10 |
| 31 | `frontend/src/components/contacts/customerMembershipNumber.ts` | 0 |
| 32 | `frontend/src/components/contacts/CustomersTab.tsx` | 16 |
| 33 | `frontend/src/components/contacts/DeliveryTab.tsx` | 25 |
| 34 | `frontend/src/components/contacts/shared.tsx` | 3 |
| 35 | `frontend/src/components/contacts/SuppliersTab.tsx` | 20 |
| 36 | `frontend/src/components/custom-tables/CustomTables.tsx` | 19 |
| 37 | `frontend/src/components/dashboard/charts/BarChart.tsx` | 5 |
| 38 | `frontend/src/components/dashboard/charts/DonutChart.tsx` | 1 |
| 39 | `frontend/src/components/dashboard/charts/index.ts` | 0 |
| 40 | `frontend/src/components/dashboard/charts/LineChart.tsx` | 7 |
| 41 | `frontend/src/components/dashboard/charts/NoData.tsx` | 1 |
| 42 | `frontend/src/components/dashboard/Dashboard.jsx` | 16 |
| 43 | `frontend/src/components/dashboard/MiniStat.tsx` | 1 |
| 44 | `frontend/src/components/files/FilePickerModal.tsx` | 8 |
| 45 | `frontend/src/components/files/FilesPage.tsx` | 27 |
| 46 | `frontend/src/components/files/FilesProvidersTab.tsx` | 2 |
| 47 | `frontend/src/components/files/FilesResponsesTab.tsx` | 1 |
| 48 | `frontend/src/components/inventory/DualMoney.tsx` | 1 |
| 49 | `frontend/src/components/inventory/Inventory.jsx` | 27 |
| 50 | `frontend/src/components/inventory/InventoryImportModal.tsx` | 9 |
| 51 | `frontend/src/components/inventory/inventoryImportWorker.ts` | 1 |
| 52 | `frontend/src/components/inventory/InventoryMovementsSurface.tsx` | 1 |
| 53 | `frontend/src/components/inventory/InventoryProductsSurface.tsx` | 3 |
| 54 | `frontend/src/components/inventory/InventoryRfidSurface.tsx` | 1 |
| 55 | `frontend/src/components/inventory/movementGroups.ts` | 11 |
| 56 | `frontend/src/components/inventory/ProductDetailModal.tsx` | 2 |
| 57 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx` | 10 |
| 58 | `frontend/src/components/navigation/Sidebar.tsx` | 9 |
| 59 | `frontend/src/components/pos/CartItem.tsx` | 2 |
| 60 | `frontend/src/components/pos/FilterPanel.tsx` | 5 |
| 61 | `frontend/src/components/pos/POS.jsx` | 22 |
| 62 | `frontend/src/components/pos/posCore.ts` | 1 |
| 63 | `frontend/src/components/pos/ProductImage.tsx` | 1 |
| 64 | `frontend/src/components/pos/QuickAddModal.tsx` | 2 |
| 65 | `frontend/src/components/products/config/productPageConfig.ts` | 0 |
| 66 | `frontend/src/components/products/forms/BranchStockAdjuster.tsx` | 6 |
| 67 | `frontend/src/components/products/forms/BulkAddStockModal.tsx` | 6 |
| 68 | `frontend/src/components/products/forms/ProductForm.tsx` | 18 |
| 69 | `frontend/src/components/products/forms/VariantFormModal.tsx` | 3 |
| 70 | `frontend/src/components/products/helpers/productDisplayHelpers.ts` | 1 |
| 71 | `frontend/src/components/products/helpers/productFilterHelpers.ts` | 5 |
| 72 | `frontend/src/components/products/helpers/productGalleryHelpers.ts` | 0 |
| 73 | `frontend/src/components/products/helpers/productGroupViewHelpers.ts` | 0 |
| 74 | `frontend/src/components/products/helpers/productMenuHelpers.ts` | 1 |
| 75 | `frontend/src/components/products/helpers/productPageHelpers.ts` | 0 |
| 76 | `frontend/src/components/products/helpers/productSelectionHelpers.ts` | 0 |
| 77 | `frontend/src/components/products/helpers/productWriteHelpers.ts` | 3 |
| 78 | `frontend/src/components/products/history/productHistoryHelpers.ts` | 0 |
| 79 | `frontend/src/components/products/import/BulkImportModal.tsx` | 51 |
| 80 | `frontend/src/components/products/import/productImportPlanner.ts` | 11 |
| 81 | `frontend/src/components/products/import/productImportWorker.ts` | 3 |
| 82 | `frontend/src/components/products/lookups/ManageBrandsModal.tsx` | 9 |
| 83 | `frontend/src/components/products/lookups/ManageCategoriesModal.tsx` | 5 |
| 84 | `frontend/src/components/products/lookups/ManageUnitsModal.tsx` | 5 |
| 85 | `frontend/src/components/products/lookups/productLookupSnapshots.ts` | 7 |
| 86 | `frontend/src/components/products/Products.jsx` | 15 |
| 87 | `frontend/src/components/products/scanning/barcodeImageScanner.ts` | 4 |
| 88 | `frontend/src/components/products/scanning/BarcodeScannerModal.tsx` | 7 |
| 89 | `frontend/src/components/products/scanning/barcodeScannerState.ts` | 0 |
| 90 | `frontend/src/components/products/scanning/scanbotScanner.ts` | 6 |
| 91 | `frontend/src/components/products/shared/primitives.tsx` | 12 |
| 92 | `frontend/src/components/products/surfaces/HeaderActions.tsx` | 2 |
| 93 | `frontend/src/components/products/surfaces/ProductDetailModal.tsx` | 3 |
| 94 | `frontend/src/components/products/surfaces/ProductRowParts.tsx` | 1 |
| 95 | `frontend/src/components/products/surfaces/ProductsListSurface.tsx` | 3 |
| 96 | `frontend/src/components/receipt-settings/AllFieldsPanel.tsx` | 4 |
| 97 | `frontend/src/components/receipt-settings/constants.ts` | 1 |
| 98 | `frontend/src/components/receipt-settings/ErrorBoundary.tsx` | 1 |
| 99 | `frontend/src/components/receipt-settings/FieldOrderManager.tsx` | 9 |
| 100 | `frontend/src/components/receipt-settings/PrintSettings.tsx` | 8 |
| 101 | `frontend/src/components/receipt-settings/ReceiptPreview.tsx` | 3 |
| 102 | `frontend/src/components/receipt-settings/ReceiptSettings.tsx` | 4 |
| 103 | `frontend/src/components/receipt-settings/template.ts` | 2 |
| 104 | `frontend/src/components/receipt/Receipt.tsx` | 10 |
| 105 | `frontend/src/components/returns/EditReturnModal.tsx` | 7 |
| 106 | `frontend/src/components/returns/NewReturnModal.tsx` | 13 |
| 107 | `frontend/src/components/returns/NewSupplierReturnModal.tsx` | 7 |
| 108 | `frontend/src/components/returns/ReturnDetailModal.tsx` | 4 |
| 109 | `frontend/src/components/returns/Returns.tsx` | 12 |
| 110 | `frontend/src/components/returns/ReturnsListSurface.tsx` | 5 |
| 111 | `frontend/src/components/sales/ExportModal.tsx` | 5 |
| 112 | `frontend/src/components/sales/SaleDetailModal.tsx` | 4 |
| 113 | `frontend/src/components/sales/Sales.tsx` | 16 |
| 114 | `frontend/src/components/sales/SalesImportModal.tsx` | 8 |
| 115 | `frontend/src/components/sales/salesImportWorker.ts` | 1 |
| 116 | `frontend/src/components/sales/SalesListSurface.tsx` | 2 |
| 117 | `frontend/src/components/sales/StatusBadge.tsx` | 2 |
| 118 | `frontend/src/components/server/ServerPage.tsx` | 20 |
| 119 | `frontend/src/components/shared/ActionHistoryBar.tsx` | 3 |
| 120 | `frontend/src/components/shared/BackgroundImportTracker.tsx` | 21 |
| 121 | `frontend/src/components/shared/ExportMenu.tsx` | 1 |
| 122 | `frontend/src/components/shared/FilterMenu.tsx` | 2 |
| 123 | `frontend/src/components/shared/globalScroll.ts` | 3 |
| 124 | `frontend/src/components/shared/ImageGalleryLightbox.tsx` | 5 |
| 125 | `frontend/src/components/shared/LoadingWatchdog.tsx` | 1 |
| 126 | `frontend/src/components/shared/Modal.tsx` | 1 |
| 127 | `frontend/src/components/shared/navigationConfig.ts` | 0 |
| 128 | `frontend/src/components/shared/NotificationCenter.tsx` | 9 |
| 129 | `frontend/src/components/shared/pageActivity.ts` | 0 |
| 130 | `frontend/src/components/shared/PageHeader.tsx` | 1 |
| 131 | `frontend/src/components/shared/PaginationControls.tsx` | 3 |
| 132 | `frontend/src/components/shared/PortalMenu.tsx` | 6 |
| 133 | `frontend/src/components/shared/QuickPreferenceToggles.tsx` | 3 |
| 134 | `frontend/src/components/shared/SectionSwitcher.tsx` | 3 |
| 135 | `frontend/src/components/shared/WriteConflictModal.tsx` | 10 |
| 136 | `frontend/src/components/users/PermissionEditor.tsx` | 3 |
| 137 | `frontend/src/components/users/UserDetailSheet.tsx` | 4 |
| 138 | `frontend/src/components/users/UserProfileModal.jsx` | 21 |
| 139 | `frontend/src/components/users/Users.jsx` | 18 |
| 140 | `frontend/src/components/utils-settings/AuditLog.jsx` | 16 |
| 141 | `frontend/src/components/utils-settings/Backup.jsx` | 30 |
| 142 | `frontend/src/components/utils-settings/FontFamilyPicker.tsx` | 1 |
| 143 | `frontend/src/components/utils-settings/index.ts` | 0 |
| 144 | `frontend/src/components/utils-settings/OtpModal.tsx` | 4 |
| 145 | `frontend/src/components/utils-settings/ResetData.tsx` | 10 |
| 146 | `frontend/src/components/utils-settings/Settings.jsx` | 21 |
| 147 | `frontend/src/components/utils-settings/settingsConflict.ts` | 1 |
| 148 | `frontend/src/constants.ts` | 0 |
| 149 | `frontend/src/index.tsx` | 10 |
| 150 | `frontend/src/platform/runtime/clientRuntime.ts` | 9 |
| 151 | `frontend/src/platform/storage/storagePolicy.ts` | 0 |
| 152 | `frontend/src/runtime/runtimeErrorClassifier.ts` | 5 |
| 153 | `frontend/src/types/jsx-modules.d.ts` | 0 |
| 154 | `frontend/src/types/receiptContracts.ts` | 0 |
| 155 | `frontend/src/types/settingsContracts.ts` | 0 |
| 156 | `frontend/src/utils/actionGuards.ts` | 1 |
| 157 | `frontend/src/utils/actionHistory.ts` | 4 |
| 158 | `frontend/src/utils/appRefresh.ts` | 0 |
| 159 | `frontend/src/utils/bulkOps.ts` | 1 |
| 160 | `frontend/src/utils/color.ts` | 2 |
| 161 | `frontend/src/utils/csv.ts` | 8 |
| 162 | `frontend/src/utils/csvExportWorker.ts` | 1 |
| 163 | `frontend/src/utils/csvImport.ts` | 8 |
| 164 | `frontend/src/utils/csvRowCounter.ts` | 1 |
| 165 | `frontend/src/utils/dateHelpers.ts` | 1 |
| 166 | `frontend/src/utils/deviceInfo.ts` | 2 |
| 167 | `frontend/src/utils/exportPackage.ts` | 0 |
| 168 | `frontend/src/utils/exportReports.tsx` | 8 |
| 169 | `frontend/src/utils/favicon.ts` | 3 |
| 170 | `frontend/src/utils/formatters.ts` | 1 |
| 171 | `frontend/src/utils/groupedRecords.ts` | 3 |
| 172 | `frontend/src/utils/historyHelpers.ts` | 0 |
| 173 | `frontend/src/utils/importJobRefresh.ts` | 4 |
| 174 | `frontend/src/utils/index.ts` | 0 |
| 175 | `frontend/src/utils/initials.ts` | 1 |
| 176 | `frontend/src/utils/loaders.ts` | 0 |
| 177 | `frontend/src/utils/mediaUpload.ts` | 0 |
| 178 | `frontend/src/utils/permissions.ts` | 1 |
| 179 | `frontend/src/utils/pricing.ts` | 0 |
| 180 | `frontend/src/utils/printReceipt.ts` | 30 |
| 181 | `frontend/src/utils/productBatches.ts` | 1 |
| 182 | `frontend/src/utils/productGrouping.ts` | 9 |
| 183 | `frontend/src/utils/publicAssetUrls.ts` | 6 |
| 184 | `frontend/src/utils/receiptAppliedConfig.ts` | 1 |
| 185 | `frontend/src/utils/scriptTypography.ts` | 0 |
| 186 | `frontend/src/utils/settingsRefresh.ts` | 1 |
| 187 | `frontend/src/utils/settingsWriteOptions.ts` | 0 |
| 188 | `frontend/src/web-api.ts` | 33 |
| 189 | `ops/scripts/frontend/verify-i18n.ts` | 6 |
| 190 | `ops/scripts/frontend/verify-performance.ts` | 4 |
| 191 | `ops/scripts/frontend/verify-ui.ts` | 11 |
| 192 | `frontend/vite.config.ts` | 5 |
| 193 | `frontend/tailwind.config.ts` | 0 |

## 3. Detailed Function Commentary

### 3.1 `frontend/src/api/http.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `hasStoredAuthSession` | function | 77 |
| 2 | `isProtectedAdminHost` | function | 86 |
| 3 | `normalizeApiPath` | function | 103 |
| 4 | `getApiMismatchKey` | function | 120 |
| 5 | `dispatchApiVersionMismatch` | function | 135 |
| 6 | `logCall` | function | 210 |
| 7 | `getClientMetaHeaders` | function | 218 |
| 8 | `createApiError` | function | 222 |
| 9 | `createCloudflareAccessError` | function | 251 |
| 10 | `dispatchUnauthorized` | function | 261 |
| 11 | `dispatchRuntimeVersionMismatch` | function | 289 |
| 12 | `checkRuntimeVersionFromHealth` | function | 301 |
| 13 | `createWriteBlockedError` | function | 308 |
| 14 | `dispatchWriteBlocked` | function | 319 |
| 15 | `dispatchTransientGatewayOutage` | function | 334 |
| 16 | `getConflictRefreshChannels` | function | 399 |
| 17 | `dispatchGlobalDataRefresh` | function | 408 |
| 18 | `sleep` | function | 417 |
| 19 | `hasUsableLocalData` | function | 421 |
| 20 | `noteReadFailure` | function | 447 |
| 21 | `stableStringifyForDedupe` | function | 468 |
| 22 | `clampDedupeBody` | function | 478 |
| 23 | `methodAllowsRequestBody` | function | 490 |
| 24 | `parsed` | const arrow | 557 |
| 25 | `shouldDispatchUnauthorized` | function | 618 |
| 26 | `isConnectivityError` | function | 631 |
| 27 | `setServerHealth` | function | 654 |
| 28 | `pingServerHealth` | function | 667 |
| 29 | `getChannelRefreshKey` | function | 739 |
| 30 | `emitCacheRefresh` | function | 744 |
| 31 | `clearInflight` | function | 758 |
| 32 | `hasReusableInflight` | function | 763 |

### 3.2 `frontend/src/api/localDb.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `splitCSVLine` | function | 268 |

### 3.3 `frontend/src/api/methods.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDeviceInfo` | function | 3 |
| 2 | `getPortalBaseUrl` | function | 52 |
| 3 | `buildQueryString` | function | 57 |
| 4 | `appendQuery` | function | 68 |
| 5 | `normalizePositiveUniqueIds` | function | 72 |
| 6 | `buildAttemptedSettings` | function | 87 |
| 7 | `buildAttemptedReturnItems` | function | 96 |
| 8 | `getCurrentUserContext` | function | 108 |
| 9 | `dispatchSyncUpdates` | function | 133 |
| 10 | `registerOutboxBackgroundSync` | function | 143 |
| 11 | `hasStoredUserSession` | function | 155 |
| 12 | `emitSyncQueueChanged` | function | 164 |
| 13 | `createClientRequestId` | function | 183 |
| 14 | `ensureClientRequestId` | function | 190 |
| 15 | `serializePendingSyncPreview` | function | 196 |
| 16 | `canRefreshOfflineDeviceSnapshot` | function | 251 |
| 17 | `readOfflineDeviceSnapshotMeta` | function | 258 |
| 18 | `writeOfflineDeviceSnapshotMeta` | function | 266 |
| 19 | `runOfflineSnapshotStep` | function | 283 |
| 20 | `previousMeta` | const arrow | 303 |
| 21 | `invalidateClientRuntimeState` | function | 348 |
| 22 | `withExpectedUpdatedAt` | function | 364 |
| 23 | `withSettingsExpectedUpdatedAt` | function | 378 |
| 24 | `appendActorQuery` | function | 388 |
| 25 | `fetchJsonWithTimeout` | function | 403 |
| 26 | `mirrorReadResult` | function | 421 |
| 27 | `routeMirrored` | function | 430 |
| 28 | `shouldPersistLocalMirror` | function | 436 |
| 29 | `purgeSensitiveLiveServerMirrors` | function | 440 |
| 30 | `mirrorTable` | function | 451 |
| 31 | `buildQueryCacheStorageKey` | function | 468 |
| 32 | `readCachedQueryResult` | function | 472 |
| 33 | `writeCachedQueryResult` | function | 486 |
| 34 | `clearCachedQueryResults` | function | 500 |
| 35 | `getNotificationSummaryFallback` | function | 543 |
| 36 | `getDriveSyncStatusFallback` | function | 552 |
| 37 | `readNotificationSummaryMissingUntil` | function | 560 |
| 38 | `markNotificationSummaryMissing` | function | 572 |
| 39 | `clearNotificationSummaryMissing` | function | 587 |
| 40 | `readStorageNumber` | function | 596 |
| 41 | `writeStorageNumber` | function | 612 |
| 42 | `clearStorageNumber` | function | 623 |
| 43 | `buildLocalBootstrap` | const arrow | 723 |
| 44 | `runSave` | const arrow | 814 |
| 45 | `getCategories` | const arrow | 872 |
| 46 | `createCategory` | const arrow | 873 |
| 47 | `updateCategory` | const arrow | 878 |
| 48 | `deleteCategory` | const arrow | 883 |
| 49 | `getUnits` | const arrow | 890 |
| 50 | `createUnit` | const arrow | 891 |
| 51 | `updateUnit` | const arrow | 896 |
| 52 | `deleteUnit` | const arrow | 901 |
| 53 | `getBranches` | const arrow | 908 |
| 54 | `getBranchSummary` | const arrow | 909 |
| 55 | `updateBranch` | const arrow | 911 |
| 56 | `deleteBranch` | const arrow | 915 |
| 57 | `getBranchStock` | const arrow | 919 |
| 58 | `getTransfers` | const arrow | 923 |
| 59 | `getBranchStockIntegrity` | const arrow | 925 |
| 60 | `getProducts` | const arrow | 929 |
| 61 | `searchProducts` | const arrow | 930 |
| 62 | `getProductsByIds` | const arrow | 940 |
| 63 | `getProductFilters` | const arrow | 951 |
| 64 | `getProductLookupUsage` | const arrow | 961 |
| 65 | `replaceProductLookupValues` | const arrow | 969 |
| 66 | `getPortalSubmissionsForReview` | const arrow | 1088 |
| 67 | `reviewPortalSubmission` | const arrow | 1090 |
| 68 | `getAiProviders` | const arrow | 1093 |
| 69 | `createAiProvider` | const arrow | 1095 |
| 70 | `updateAiProvider` | const arrow | 1097 |
| 71 | `deleteAiProvider` | const arrow | 1099 |
| 72 | `testAiProvider` | const arrow | 1101 |
| 73 | `getAiResponses` | const arrow | 1103 |
| 74 | `deleteProduct` | const arrow | 1132 |
| 75 | `buildMultipartHeaders` | function | 1149 |
| 76 | `apiFormPost` | function | 1159 |
| 77 | `withImportDeviceInfo` | const arrow | 1178 |
| 78 | `listImportJobs` | const arrow | 1181 |
| 79 | `getImportJobReview` | const arrow | 1190 |
| 80 | `updateImportJobDecisions` | const arrow | 1194 |
| 81 | `startImportJob` | const arrow | 1197 |
| 82 | `approveImportJob` | const arrow | 1199 |
| 83 | `cancelImportJob` | const arrow | 1201 |
| 84 | `retryImportJob` | const arrow | 1203 |
| 85 | `deleteImportJob` | const arrow | 1205 |
| 86 | `getImportQueueStatus` | const arrow | 1224 |
| 87 | `finish` | const arrow | 1341 |
| 88 | `abortListener` | const arrow | 1348 |
| 89 | `getActionHistory` | const arrow | 1521 |
| 90 | `updateActionHistory` | const arrow | 1527 |
| 91 | `getInventorySummary` | const arrow | 1533 |
| 92 | `getInventoryStats` | const arrow | 1534 |
| 93 | `searchInventoryProducts` | const arrow | 1538 |
| 94 | `getInventoryMovements` | const arrow | 1548 |
| 95 | `getInventoryReasons` | const arrow | 1573 |
| 96 | `saveInventoryReasons` | const arrow | 1575 |
| 97 | `buildOfflineSaleReceiptNumber` | function | 1578 |
| 98 | `isRetryableOfflineSaleError` | function | 1584 |
| 99 | `findQueuedSale` | function | 1593 |
| 100 | `putOfflineSaleMirror` | function | 1600 |
| 101 | `queueOfflineSale` | function | 1625 |
| 102 | `queuedSaleBackoffMs` | function | 1683 |
| 103 | `updateQueuedRow` | function | 1688 |
| 104 | `completeQueuedSale` | function | 1697 |
| 105 | `failQueuedSale` | function | 1720 |
| 106 | `markQueuedSaleConflict` | function | 1733 |
| 107 | `syncPendingSalesQueue` | function | 1755 |
| 108 | `getRfidStatus` | const arrow | 1798 |
| 109 | `searchRfidTags` | const arrow | 1804 |
| 110 | `recordRfidSessionEvents` | const arrow | 1810 |
| 111 | `applyRfidSession` | const arrow | 1814 |
| 112 | `getSales` | const arrow | 1830 |
| 113 | `getDashboard` | const arrow | 1837 |
| 114 | `getAnalytics` | const arrow | 1838 |
| 115 | `getCustomers` | const arrow | 1847 |
| 116 | `getCustomerPointSummaries` | const arrow | 1868 |
| 117 | `updateCustomer` | const arrow | 1876 |
| 118 | `deleteCustomer` | const arrow | 1880 |
| 119 | `downloadCustomerTemplate` | const arrow | 1885 |
| 120 | `getSuppliers` | const arrow | 1894 |
| 121 | `updateSupplier` | const arrow | 1903 |
| 122 | `deleteSupplier` | const arrow | 1907 |
| 123 | `downloadSupplierTemplate` | const arrow | 1912 |
| 124 | `getDeliveryContacts` | const arrow | 1921 |
| 125 | `updateDeliveryContact` | const arrow | 1930 |
| 126 | `deleteDeliveryContact` | const arrow | 1934 |
| 127 | `getUsers` | const arrow | 1941 |
| 128 | `updateUser` | const arrow | 1943 |
| 129 | `getUserProfile` | const arrow | 1944 |
| 130 | `getUserAuthMethods` | const arrow | 1945 |
| 131 | `updateUserProfile` | const arrow | 1947 |
| 132 | `disconnectUserAuthProvider` | const arrow | 1949 |
| 133 | `changeUserPassword` | const arrow | 1951 |
| 134 | `resetPassword` | const arrow | 1953 |
| 135 | `getRoles` | const arrow | 1956 |
| 136 | `updateRole` | const arrow | 1958 |
| 137 | `deleteRole` | const arrow | 1959 |
| 138 | `getCustomTables` | const arrow | 1962 |
| 139 | `getCustomTableData` | const arrow | 1964 |
| 140 | `insertCustomRow` | const arrow | 1965 |
| 141 | `updateCustomRow` | const arrow | 1966 |
| 142 | `deleteCustomRow` | const arrow | 1967 |
| 143 | `getAuditLogs` | const arrow | 1970 |
| 144 | `deleteAuditLogsRetention` | const arrow | 1996 |
| 145 | `wait` | function | 2000 |
| 146 | `waitForSystemJob` | function | 2040 |
| 147 | `getGoogleDriveSyncStatus` | const arrow | 2087 |
| 148 | `saveGoogleDriveSyncPreferences` | const arrow | 2121 |
| 149 | `startGoogleDriveSyncOauth` | const arrow | 2124 |
| 150 | `disconnectGoogleDriveSync` | const arrow | 2127 |
| 151 | `forgetGoogleDriveSyncCredentials` | const arrow | 2130 |
| 152 | `queueGoogleDriveSyncNow` | const arrow | 2133 |
| 153 | `syncGoogleDriveNow` | const arrow | 2136 |
| 154 | `getReturns` | const arrow | 2212 |
| 155 | `updateSaleStatus` | const arrow | 2233 |
| 156 | `attachSaleCustomer` | const arrow | 2249 |
| 157 | `getSalesExport` | const arrow | 2273 |
| 158 | `updateReturn` | const arrow | 2277 |
| 159 | `getDataPath` | const arrow | 2331 |
| 160 | `getScaleMigrationStatus` | const arrow | 2332 |
| 161 | `prepareScaleMigration` | const arrow | 2333 |
| 162 | `runScaleMigration` | const arrow | 2334 |
| 163 | `browseDir` | const arrow | 2345 |

### 3.4 `frontend/src/api/websocket.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `clearReconnectTimer` | function | 21 |
| 2 | `clearPingTimer` | function | 27 |
| 3 | `hasStoredAuthSession` | function | 33 |
| 4 | `isProtectedAdminHost` | function | 42 |
| 5 | `shouldDebugWs` | function | 52 |
| 6 | `logWs` | function | 62 |
| 7 | `scheduleReconnect` | function | 183 |

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

### 3.7 `frontend/src/app/publicErrorRecovery.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getRecoveryStorage` | function | 6 |

### 3.8 `frontend/src/AppContext.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `flattenTranslationTree` | function | 44 |
| 2 | `safeStorageGet` | function | 100 |
| 3 | `safeStorageSet` | function | 108 |
| 4 | `safeStorageRemove` | function | 114 |
| 5 | `getStoredUserPayload` | function | 120 |
| 6 | `getStoredUserExpiry` | function | 124 |
| 7 | `clearPersistedAuthState` | function | 128 |
| 8 | `persistAuthState` | function | 141 |
| 9 | `computeSessionExpiryMs` | function | 155 |
| 10 | `readDeviceSettings` | function | 171 |
| 11 | `writeDeviceSettings` | function | 179 |
| 12 | `writeStoredSessionDuration` | function | 185 |
| 13 | `readPendingOauthLink` | function | 193 |
| 14 | `clearPendingOauthLink` | function | 207 |
| 15 | `readOauthCallbackResult` | function | 213 |
| 16 | `clearOauthCallbackResult` | function | 224 |
| 17 | `mergeSettingsWithDeviceOverrides` | function | 230 |
| 18 | `normalizeDateInput` | function | 234 |
| 19 | `buildRuntimeDescriptorFromBootstrap` | function | 252 |
| 20 | `LoadingScreen` | function | 280 |
| 21 | `AccessDenied` | function | 293 |
| 22 | `onUpdate` | const arrow | 529 |
| 23 | `onStatus` | const arrow | 559 |
| 24 | `poll` | const arrow | 567 |
| 25 | `onError` | const arrow | 587 |
| 26 | `onWriteBlocked` | const arrow | 603 |
| 27 | `onRuntimeMismatch` | const arrow | 612 |
| 28 | `onConflict` | const arrow | 631 |
| 29 | `onUnauthorized` | const arrow | 700 |
| 30 | `handleOtpLogin` | const arrow | 758 |
| 31 | `handleUserUpdated` | const arrow | 800 |
| 32 | `discoverSyncUrl` | const arrow | 837 |
| 33 | `hexAlpha` | const arrow | 1011 |
| 34 | `clearCallbackUrl` | const arrow | 1222 |
| 35 | `clearPendingLink` | const arrow | 1226 |
| 36 | `run` | const arrow | 1230 |
| 37 | `useApp` | const arrow | 1597 |
| 38 | `useSync` | const arrow | 1598 |
| 39 | `useT` | const arrow | 1601 |

### 3.9 `frontend/src/components/auth/Login.jsx`

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

### 3.10 `frontend/src/components/branches/Branches.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBranchApi` | function | 179 |
| 2 | `getErrorMessage` | function | 183 |
| 3 | `isBranchRecord` | function | 187 |
| 4 | `isTransferRecord` | function | 191 |
| 5 | `BranchStatTile` | function | 195 |
| 6 | `formatTransferDate` | function | 212 |
| 7 | `Branches` | component/function | 229 |
| 8 | `promise` | const arrow | 276 |
| 9 | `loadBranchStock` | const arrow | 413 |
| 10 | `loadMoreBranchStock` | const arrow | 434 |
| 11 | `handleSaveBranch` | const arrow | 465 |
| 12 | `handleDelete` | const arrow | 533 |
| 13 | `handleBulkDelete` | const arrow | 581 |
| 14 | `toggleSelect` | const arrow | 667 |
| 15 | `toggleSelectAll` | const arrow | 676 |

### 3.11 `frontend/src/components/branches/BranchForm.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `BranchForm` | component/function | 37 |
| 2 | `handleSave` | const arrow | 57 |

### 3.12 `frontend/src/components/branches/TransferModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getTransferApi` | function | 71 |
| 2 | `getErrorMessage` | function | 76 |
| 3 | `normalizeTransferStockRows` | function | 80 |
| 4 | `TransferModal` | component/function | 94 |
| 5 | `loadStock` | function | 146 |
| 6 | `handleTransfer` | const arrow | 194 |

### 3.13 `frontend/src/components/catalog/CatalogEditorSurface.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `CatalogEditorSurface` | component/function | 7 |

### 3.14 `frontend/src/components/catalog/CatalogImageField.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `CatalogImageField` | component/function | 28 |

### 3.15 `frontend/src/components/catalog/CatalogPage.jsx`

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
| 115 | `scrollPublicPortal` | const arrow | 3128 |

### 3.16 `frontend/src/components/catalog/CatalogPageContext.tsx`

- No top-level named function/class symbols detected.

### 3.17 `frontend/src/components/catalog/CatalogPreviewSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `CatalogPreviewSurface` | component/function | 109 |
| 2 | `handlePortalTabClick` | const arrow | 147 |

### 3.18 `frontend/src/components/catalog/CatalogProductsSection.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBadgeIcon` | function | 112 |
| 2 | `getBadgeToneClass` | function | 120 |
| 3 | `getProductInitial` | function | 129 |
| 4 | `CatalogProductsSection` | component/function | 137 |

### 3.19 `frontend/src/components/catalog/CatalogSecondaryTabs.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizePortalColor` | function | 25 |
| 2 | `CatalogMembershipSection` | function | 30 |
| 3 | `CatalogAboutSection` | function | 376 |
| 4 | `CatalogFaqSection` | function | 590 |
| 5 | `CatalogAiSection` | function | 644 |
| 6 | `CatalogSecondaryTabs` | component/function | 830 |

### 3.20 `frontend/src/components/catalog/catalogUi.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `statusClass` | function | 22 |

### 3.21 `frontend/src/components/catalog/portalCatalogDisplay.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `replaceRankVars` | function | 173 |
| 2 | `normalizeRankBadgeLabel` | function | 177 |

### 3.22 `frontend/src/components/catalog/portalContentI18n.ts`

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

### 3.23 `frontend/src/components/catalog/portalEditorUtils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPlainObject` | function | 47 |
| 2 | `toTrimmedString` | function | 51 |

### 3.24 `frontend/src/components/catalog/portalLanguagePacks.ts`

- No top-level named function/class symbols detected.

### 3.25 `frontend/src/components/catalog/portalTranslateController.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeLanguage` | function | 16 |
| 2 | `ensureLinkHint` | function | 108 |

### 3.26 `frontend/src/components/contacts/ContactImportModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getContactImportApi` | function | 114 |
| 2 | `getErrorMessage` | function | 119 |
| 3 | `countCsvDataRowsInWorker` | function | 123 |
| 4 | `cleanup` | const arrow | 135 |
| 5 | `ContactImportModal` | component/function | 155 |
| 6 | `handleDownloadTemplate` | const arrow | 227 |
| 7 | `applyContactRulePreset` | const arrow | 231 |
| 8 | `handleImport` | const arrow | 241 |

### 3.27 `frontend/src/components/contacts/contactImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.28 `frontend/src/components/contacts/contactOptionUtils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPlainRecord` | function | 24 |
| 2 | `readStringField` | function | 28 |
| 3 | `normalizeOption` | function | 45 |

### 3.29 `frontend/src/components/contacts/Contacts.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getContactApi` | function | 85 |
| 2 | `getErrorMessage` | function | 90 |
| 3 | `asExportValue` | function | 94 |
| 4 | `normalizeContactExportRows` | function | 98 |
| 5 | `ContactTabFallback` | function | 126 |
| 6 | `ImportTypePicker` | function | 175 |
| 7 | `Contacts` | component/function | 215 |
| 8 | `handleExportAll` | const arrow | 231 |
| 9 | `openImportPicker` | const arrow | 319 |
| 10 | `handleTypeSelected` | const arrow | 321 |
| 11 | `handleImportDone` | const arrow | 326 |

### 3.30 `frontend/src/components/contacts/CustomerFormModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `tr` | function | 50 |
| 2 | `parseContactOptions` | function | 55 |
| 3 | `OptionEditor` | function | 59 |
| 4 | `setField` | const arrow | 60 |
| 5 | `fieldId` | const arrow | 61 |
| 6 | `CustomerFormModal` | component/function | 104 |
| 7 | `addOption` | const arrow | 125 |
| 8 | `removeOption` | const arrow | 129 |
| 9 | `updateOption` | const arrow | 130 |
| 10 | `handleSubmit` | const arrow | 131 |

### 3.31 `frontend/src/components/contacts/customerMembershipNumber.ts`

- No top-level named function/class symbols detected.

### 3.32 `frontend/src/components/contacts/CustomersTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getCustomerApi` | function | 117 |
| 2 | `isSectionRow` | function | 122 |
| 3 | `normalizeCustomerRows` | function | 126 |
| 4 | `getApiListPayload` | function | 133 |
| 5 | `getErrorMessage` | function | 137 |
| 6 | `formatPoints` | function | 141 |
| 7 | `tr` | function | 153 |
| 8 | `CustomersTab` | function | 162 |
| 9 | `toggleSectionCollapsed` | const arrow | 325 |
| 10 | `isSectionFullySelected` | const arrow | 331 |
| 11 | `isSectionPartiallySelected` | const arrow | 332 |
| 12 | `toggleSectionSelection` | const arrow | 333 |
| 13 | `promise` | const arrow | 367 |
| 14 | `handleSave` | const arrow | 454 |
| 15 | `handleDelete` | const arrow | 531 |
| 16 | `handleBulkDelete` | const arrow | 570 |

### 3.33 `frontend/src/components/contacts/DeliveryTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDeliveryApi` | function | 112 |
| 2 | `normalizeDeliveryRows` | function | 117 |
| 3 | `isSectionRow` | function | 125 |
| 4 | `getErrorMessage` | function | 129 |
| 5 | `BLANK_OPTION` | const arrow | 146 |
| 6 | `OptionEditor` | function | 157 |
| 7 | `set` | const arrow | 158 |
| 8 | `fieldId` | const arrow | 159 |
| 9 | `DeliveryForm` | function | 204 |
| 10 | `set` | const arrow | 213 |
| 11 | `addOption` | const arrow | 214 |
| 12 | `updateOption` | const arrow | 218 |
| 13 | `removeOption` | const arrow | 219 |
| 14 | `handleSave` | const arrow | 220 |
| 15 | `OptionsDisplay` | function | 290 |
| 16 | `OptionsBadge` | function | 307 |
| 17 | `DeliveryTab` | function | 318 |
| 18 | `toggleSectionCollapsed` | const arrow | 458 |
| 19 | `isSectionFullySelected` | const arrow | 464 |
| 20 | `isSectionPartiallySelected` | const arrow | 465 |
| 21 | `toggleSectionSelection` | const arrow | 466 |
| 22 | `promise` | const arrow | 498 |
| 23 | `handleSave` | const arrow | 560 |
| 24 | `handleDelete` | const arrow | 622 |
| 25 | `handleBulkDelete` | const arrow | 659 |

### 3.34 `frontend/src/components/contacts/shared.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toggleOne` | const arrow | 99 |
| 2 | `clearSelection` | const arrow | 110 |
| 3 | `menuContent` | const arrow | 164 |

### 3.35 `frontend/src/components/contacts/SuppliersTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.36 `frontend/src/components/custom-tables/CustomTables.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 11 | `CustomTables` | component/function | 160 |
| 12 | `addColumn` | const arrow | 275 |
| 13 | `updateColumn` | const arrow | 282 |
| 14 | `removeColumn` | const arrow | 291 |
| 15 | `handleCreateTable` | const arrow | 298 |
| 16 | `handleSaveRow` | const arrow | 345 |
| 17 | `handleDeleteRow` | const arrow | 443 |
| 18 | `openAddRow` | const arrow | 495 |
| 19 | `openEditRow` | const arrow | 502 |

### 3.37 `frontend/src/components/dashboard/charts/BarChart.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `chartLabelsNeedYear` | function | 23 |
| 2 | `formatAxisLabel` | function | 32 |
| 3 | `BarChart` | component/function | 45 |
| 4 | `updateWidth` | const arrow | 53 |
| 5 | `yPx` | function | 89 |

### 3.38 `frontend/src/components/dashboard/charts/DonutChart.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `DonutChart` | component/function | 22 |

### 3.39 `frontend/src/components/dashboard/charts/index.ts`

- No top-level named function/class symbols detected.

### 3.40 `frontend/src/components/dashboard/charts/LineChart.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `chartLabelsNeedYear` | function | 28 |
| 2 | `formatAxisLabel` | function | 37 |
| 3 | `LineChart` | component/function | 50 |
| 4 | `updateWidth` | const arrow | 58 |
| 5 | `xPx` | function | 100 |
| 6 | `yPx` | function | 104 |
| 7 | `handleMouseMove` | const arrow | 114 |

### 3.41 `frontend/src/components/dashboard/charts/NoData.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `NoData` | component/function | 7 |

### 3.42 `frontend/src/components/dashboard/Dashboard.jsx`

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
| 14 | `calcTrend` | const arrow | 436 |
| 15 | `rangeLabel` | const arrow | 480 |
| 16 | `periodShort` | const arrow | 486 |

### 3.43 `frontend/src/components/dashboard/MiniStat.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `MiniStat` | component/function | 13 |

### 3.44 `frontend/src/components/files/FilePickerModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getFilePickerApi` | function | 60 |
| 2 | `getErrorMessage` | function | 65 |
| 3 | `normalizeFileAssets` | function | 69 |
| 4 | `AssetPreview` | function | 73 |
| 5 | `FilePickerModal` | component/function | 96 |
| 6 | `toggleSelectedPath` | function | 163 |
| 7 | `handleUpload` | function | 173 |
| 8 | `handleDelete` | function | 215 |

### 3.45 `frontend/src/components/files/FilesPage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 15 | `FilesPage` | component/function | 354 |
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

### 3.46 `frontend/src/components/files/FilesProvidersTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProviderStatus` | function | 123 |
| 2 | `FilesProvidersTab` | component/function | 134 |

### 3.47 `frontend/src/components/files/FilesResponsesTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `FilesResponsesTab` | component/function | 66 |

### 3.48 `frontend/src/components/inventory/DualMoney.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `DualMoney` | component/function | 8 |

### 3.49 `frontend/src/components/inventory/Inventory.jsx`

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

### 3.50 `frontend/src/components/inventory/InventoryImportModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isBrokenLocalizedString` | function | 68 |
| 2 | `getImportApi` | function | 80 |
| 3 | `getErrorMessage` | function | 85 |
| 4 | `countInventoryCsvRowsInWorker` | function | 89 |
| 5 | `cleanup` | const arrow | 101 |
| 6 | `InventoryImportModal` | component/function | 121 |
| 7 | `handlePickFile` | const arrow | 175 |
| 8 | `handleDownloadTemplate` | const arrow | 181 |
| 9 | `handleImport` | const arrow | 185 |

### 3.51 `frontend/src/components/inventory/inventoryImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.52 `frontend/src/components/inventory/InventoryMovementsSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `InventoryMovementsSurface` | component/function | 140 |

### 3.53 `frontend/src/components/inventory/InventoryProductsSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `InventoryProductsSurface` | component/function | 102 |
| 2 | `renderDesktopTableHead` | const arrow | 141 |
| 3 | `renderDesktopLoadingShell` | const arrow | 163 |

### 3.54 `frontend/src/components/inventory/InventoryRfidSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `InventoryRfidSurface` | component/function | 55 |

### 3.55 `frontend/src/components/inventory/movementGroups.ts`

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

### 3.56 `frontend/src/components/inventory/ProductDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBranchStockKey` | function | 61 |
| 2 | `ProductDetailModal` | component/function | 65 |

### 3.57 `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getLoyaltyApi` | function | 187 |
| 2 | `toCustomerPointRows` | function | 191 |
| 3 | `getErrorMessage` | function | 195 |
| 4 | `sanitizeInteger` | function | 199 |
| 5 | `sanitizeKhr` | function | 204 |
| 6 | `formatLookupValue` | function | 210 |
| 7 | `normalizeLoyaltySection` | function | 214 |
| 8 | `LoyaltyPointsPage` | component/function | 218 |
| 9 | `handleSave` | function | 327 |
| 10 | `handleLookup` | function | 351 |

### 3.58 `frontend/src/components/navigation/Sidebar.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getFallbackLabel` | function | 93 |
| 2 | `getNavLabel` | function | 101 |
| 3 | `isDarkColor` | function | 117 |
| 4 | `withAlpha` | function | 127 |
| 5 | `mergeStyles` | function | 133 |
| 6 | `announcePageIntent` | function | 137 |
| 7 | `getIconForItem` | function | 144 |
| 8 | `isNavigationItemWithIcon` | function | 148 |
| 9 | `Sidebar` | component/function | 152 |

### 3.59 `frontend/src/components/pos/CartItem.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `translate` | function | 41 |
| 2 | `CartItem` | component/function | 45 |

### 3.60 `frontend/src/components/pos/FilterPanel.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `countActiveFlags` | function | 42 |
| 2 | `SectionLabel` | function | 50 |
| 3 | `POSFilterPanel` | component/function | 61 |
| 4 | `clearAll` | const arrow | 94 |
| 5 | `chip` | const arrow | 103 |

### 3.61 `frontend/src/components/pos/POS.jsx`

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

### 3.62 `frontend/src/components/pos/posCore.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeNumber` | function | 48 |

### 3.63 `frontend/src/components/pos/ProductImage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductImage` | component/function | 9 |

### 3.64 `frontend/src/components/pos/QuickAddModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `QuickAddModal` | component/function | 12 |
| 2 | `T` | const arrow | 13 |

### 3.65 `frontend/src/components/products/config/productPageConfig.ts`

- No top-level named function/class symbols detected.

### 3.66 `frontend/src/components/products/forms/BranchStockAdjuster.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getProductApi` | function | 72 |
| 2 | `parseStockDelta` | function | 76 |
| 3 | `BranchStockAdjuster` | component/function | 81 |
| 4 | `T` | const arrow | 102 |
| 5 | `setRow` | const arrow | 108 |
| 6 | `handleSave` | const arrow | 114 |

### 3.67 `frontend/src/components/products/forms/BulkAddStockModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getProductApi` | function | 68 |
| 2 | `parsePositiveQuantity` | function | 72 |
| 3 | `normalizeBranchId` | function | 77 |
| 4 | `normalizeProductId` | function | 83 |
| 5 | `BulkAddStockModal` | component/function | 88 |
| 6 | `handleSave` | const arrow | 101 |

### 3.68 `frontend/src/components/products/forms/ProductForm.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getProductFormApi` | function | 188 |
| 2 | `getErrorMessage` | function | 192 |
| 3 | `normalizeGallery` | function | 196 |
| 4 | `editablePrice` | function | 212 |
| 5 | `pickImageFiles` | function | 217 |
| 6 | `ProductForm` | component/function | 236 |
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

### 3.69 `frontend/src/components/products/forms/VariantFormModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getProductVariantApi` | function | 104 |
| 2 | `getErrorMessage` | function | 108 |
| 3 | `VariantFormModal` | component/function | 112 |

### 3.70 `frontend/src/components/products/helpers/productDisplayHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toNumber` | function | 57 |

### 3.71 `frontend/src/components/products/helpers/productFilterHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toNumber` | function | 66 |
| 2 | `getImageGallery` | function | 71 |
| 3 | `toImageName` | const arrow | 154 |
| 4 | `toImageUrl` | const arrow | 155 |
| 5 | `priceCsv` | const arrow | 156 |

### 3.72 `frontend/src/components/products/helpers/productGalleryHelpers.ts`

- No top-level named function/class symbols detected.

### 3.73 `frontend/src/components/products/helpers/productGroupViewHelpers.ts`

- No top-level named function/class symbols detected.

### 3.74 `frontend/src/components/products/helpers/productMenuHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `asString` | function | 85 |

### 3.75 `frontend/src/components/products/helpers/productPageHelpers.ts`

- No top-level named function/class symbols detected.

### 3.76 `frontend/src/components/products/helpers/productSelectionHelpers.ts`

- No top-level named function/class symbols detected.

### 3.77 `frontend/src/components/products/helpers/productWriteHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toFiniteNumber` | function | 123 |
| 2 | `hasBulkFormValue` | function | 128 |
| 3 | `stringOrEmpty` | function | 132 |

### 3.78 `frontend/src/components/products/history/productHistoryHelpers.ts`

- No top-level named function/class symbols detected.

### 3.79 `frontend/src/components/products/import/BulkImportModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 31 | `BulkImportModal` | component/function | 723 |
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

### 3.80 `frontend/src/components/products/import/productImportPlanner.ts`

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

### 3.81 `frontend/src/components/products/import/productImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `post` | function | 39 |
| 2 | `waitForNextTask` | function | 43 |
| 3 | `getErrorMessage` | function | 49 |

### 3.82 `frontend/src/components/products/lookups/ManageBrandsModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBrandApi` | function | 116 |
| 2 | `getErrorMessage` | function | 120 |
| 3 | `parseBrandOptions` | function | 124 |
| 4 | `parseBrandColorMap` | function | 137 |
| 5 | `toTitleCase` | function | 152 |
| 6 | `getBrandReviewRule` | function | 160 |
| 7 | `getBrandSortScore` | function | 164 |
| 8 | `buildSavedLibrary` | function | 170 |
| 9 | `ManageBrandsModal` | component/function | 192 |

### 3.83 `frontend/src/components/products/lookups/ManageCategoriesModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getCategoryApi` | function | 106 |
| 2 | `getErrorMessage` | function | 110 |
| 3 | `normalizeCategoryRows` | function | 114 |
| 4 | `mergeCategoryUsage` | function | 129 |
| 5 | `ManageCategoriesModal` | component/function | 158 |

### 3.84 `frontend/src/components/products/lookups/ManageUnitsModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getUnitApi` | function | 106 |
| 2 | `getErrorMessage` | function | 110 |
| 3 | `normalizeUnitRows` | function | 114 |
| 4 | `mergeUnitUsage` | function | 129 |
| 5 | `ManageUnitsModal` | component/function | 158 |

### 3.85 `frontend/src/components/products/lookups/productLookupSnapshots.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getFallbackApiClient` | function | 57 |
| 2 | `normalizeProductRows` | function | 63 |
| 3 | `getPayloadNumber` | function | 70 |
| 4 | `snapshotLookupProducts` | function | 75 |
| 5 | `mergeUniqueSnapshots` | function | 89 |
| 6 | `fetchLookupProductSnapshotsForName` | function | 113 |
| 7 | `fetchProductsByIds` | function | 165 |

### 3.86 `frontend/src/components/products/Products.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Products` | component/function | 130 |
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

### 3.87 `frontend/src/components/products/scanning/barcodeImageScanner.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readFileAsDataUrl` | function | 37 |
| 2 | `createImageElement` | function | 62 |
| 3 | `loadImageSource` | function | 66 |
| 4 | `detectWithNativeBarcodeDetector` | function | 75 |

### 3.88 `frontend/src/components/products/scanning/BarcodeScannerModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getNativeBarcodeDetector` | function | 94 |
| 2 | `getScanErrorText` | function | 101 |
| 3 | `stopStream` | function | 106 |
| 4 | `readCameraPermissionState` | function | 112 |
| 5 | `watchCameraPermission` | function | 123 |
| 6 | `handleChange` | const arrow | 127 |
| 7 | `BarcodeScannerModal` | component/function | 139 |

### 3.89 `frontend/src/components/products/scanning/barcodeScannerState.ts`

- No top-level named function/class symbols detected.

### 3.90 `frontend/src/components/products/scanning/scanbotScanner.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `publicBasePath` | const arrow | 35 |
| 2 | `getScanbotGlobal` | function | 47 |
| 3 | `normalizeScanbotError` | function | 66 |
| 4 | `loadScanbotScript` | function | 80 |
| 5 | `readCameraPermissionState` | function | 109 |
| 6 | `getInitializedScanbot` | function | 143 |

### 3.91 `frontend/src/components/products/shared/primitives.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.92 `frontend/src/components/products/surfaces/HeaderActions.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductsHeaderActions` | component/function | 19 |
| 2 | `tr` | const arrow | 29 |

### 3.93 `frontend/src/components/products/surfaces/ProductDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductDetailModal` | component/function | 79 |
| 2 | `T` | const arrow | 95 |
| 3 | `Row` | const arrow | 116 |

### 3.94 `frontend/src/components/products/surfaces/ProductRowParts.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `label` | const arrow | 103 |

### 3.95 `frontend/src/components/products/surfaces/ProductsListSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductsListSurface` | component/function | 61 |
| 2 | `renderDesktopTableHead` | const arrow | 104 |
| 3 | `renderDesktopLoadingShell` | const arrow | 133 |

### 3.96 `frontend/src/components/receipt-settings/AllFieldsPanel.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Toggle` | function | 30 |
| 2 | `AllFieldsPanel` | component/function | 46 |
| 3 | `T` | const arrow | 49 |
| 4 | `toggleSection` | const arrow | 68 |

### 3.97 `frontend/src/components/receipt-settings/constants.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `T` | const arrow | 110 |

### 3.98 `frontend/src/components/receipt-settings/ErrorBoundary.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatError` | function | 11 |

### 3.99 `frontend/src/components/receipt-settings/FieldOrderManager.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getSectionOrderItems` | function | 20 |
| 2 | `buildList` | function | 39 |
| 3 | `toKeys` | function | 64 |
| 4 | `FieldOrderManager` | component/function | 68 |
| 5 | `moveItem` | const arrow | 82 |
| 6 | `addDivider` | const arrow | 90 |
| 7 | `removeDivider` | const arrow | 101 |
| 8 | `handleDragStart` | const arrow | 107 |
| 9 | `handleDragOver` | const arrow | 112 |

### 3.100 `frontend/src/components/receipt-settings/PrintSettings.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Section` | function | 31 |
| 2 | `buildFallbackPreviewHtml` | function | 43 |
| 3 | `buildSafePreviewSource` | function | 61 |
| 4 | `PrintSettings` | component/function | 73 |
| 5 | `persistPrintSettings` | const arrow | 96 |
| 6 | `setValue` | const arrow | 112 |
| 7 | `resetMargins` | const arrow | 121 |
| 8 | `getPreviewSource` | const arrow | 144 |

### 3.101 `frontend/src/components/receipt-settings/ReceiptPreview.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatLoadError` | function | 34 |
| 2 | `ReceiptPreview` | component/function | 39 |
| 3 | `loadPreview` | function | 50 |

### 3.102 `frontend/src/components/receipt-settings/ReceiptSettings.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 71 |
| 2 | `Section` | function | 76 |
| 3 | `Toggle` | function | 87 |
| 4 | `ReceiptSettings` | component/function | 102 |

### 3.103 `frontend/src/components/receipt-settings/template.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isRecord` | function | 6 |
| 2 | `parseTemplateInput` | function | 10 |

### 3.104 `frontend/src/components/receipt/Receipt.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toNumber` | function | 104 |
| 2 | `stripEmoji` | function | 109 |
| 3 | `stripEmoji` | function | 111 |
| 4 | `displayAddress` | function | 116 |
| 5 | `parseItems` | function | 125 |
| 6 | `getErrorMessage` | function | 136 |
| 7 | `labelFor` | function | 222 |
| 8 | `Row` | function | 227 |
| 9 | `Receipt` | component/function | 239 |
| 10 | `exportReceiptPdf` | const arrow | 450 |

### 3.105 `frontend/src/components/returns/EditReturnModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getReturnApi` | function | 90 |
| 2 | `toNumber` | function | 95 |
| 3 | `clampReturnQuantity` | function | 100 |
| 4 | `isWriteConflict` | function | 106 |
| 5 | `EditReturnModal` | component/function | 111 |
| 6 | `updateQty` | const arrow | 144 |
| 7 | `updateRestock` | const arrow | 147 |

### 3.106 `frontend/src/components/returns/NewReturnModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getReturnApi` | function | 119 |
| 2 | `toNumber` | function | 124 |
| 3 | `clampReturnQuantity` | function | 129 |
| 4 | `getSaleItemKey` | function | 135 |
| 5 | `NewReturnModal` | component/function | 139 |
| 6 | `handleSearch` | const arrow | 172 |
| 7 | `handleReturnTypeChange` | const arrow | 237 |
| 8 | `toggleIncluded` | const arrow | 242 |
| 9 | `updateItemQty` | const arrow | 250 |
| 10 | `updateItemRestock` | const arrow | 258 |
| 11 | `selectAll` | const arrow | 262 |
| 12 | `clearAll` | const arrow | 265 |
| 13 | `handleSubmit` | const arrow | 272 |

### 3.107 `frontend/src/components/returns/NewSupplierReturnModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isSupplierReturnItem` | function | 86 |
| 2 | `getSupplierReturnApi` | function | 90 |
| 3 | `NewSupplierReturnModal` | component/function | 99 |
| 4 | `loadSetup` | function | 136 |
| 5 | `loadInventory` | function | 187 |
| 6 | `updateQty` | const arrow | 258 |
| 7 | `submit` | const arrow | 264 |

### 3.108 `frontend/src/components/returns/ReturnDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeScope` | function | 52 |
| 2 | `coerceMoney` | function | 56 |
| 3 | `isPositiveMoney` | function | 60 |
| 4 | `ReturnDetailModal` | component/function | 64 |

### 3.109 `frontend/src/components/returns/Returns.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 11 | `Returns` | component/function | 227 |
| 12 | `promise` | const arrow | 300 |

### 3.110 `frontend/src/components/returns/ReturnsListSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `detectMobileViewport` | function | 70 |
| 2 | `ReturnsDesktopSkeletonRows` | function | 75 |
| 3 | `ReturnsMobileSkeletonCards` | function | 92 |
| 4 | `ReturnsListSurface` | component/function | 112 |
| 5 | `apply` | const arrow | 143 |

### 3.111 `frontend/src/components/sales/ExportModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getSalesExportApi` | function | 68 |
| 2 | `getErrorMessage` | function | 73 |
| 3 | `ExportModal` | component/function | 77 |
| 4 | `handlePreview` | const arrow | 151 |
| 5 | `handleExportCSV` | const arrow | 169 |

### 3.112 `frontend/src/components/sales/SaleDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toNumber` | function | 73 |
| 2 | `InfoBlock` | function | 78 |
| 3 | `parseItems` | function | 94 |
| 4 | `SaleDetailModal` | component/function | 105 |

### 3.113 `frontend/src/components/sales/Sales.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 11 | `Sales` | component/function | 195 |
| 12 | `promise` | const arrow | 285 |
| 13 | `toggleSelected` | const arrow | 622 |
| 14 | `toggleSelectAll` | const arrow | 628 |
| 15 | `handleExportSelected` | const arrow | 667 |
| 16 | `handleBulkStatusUpdate` | const arrow | 715 |

### 3.114 `frontend/src/components/sales/SalesImportModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getImportApi` | function | 69 |
| 2 | `getErrorMessage` | function | 74 |
| 3 | `countSalesCsvRowsInWorker` | function | 78 |
| 4 | `cleanup` | const arrow | 90 |
| 5 | `SalesImportModal` | component/function | 110 |
| 6 | `handlePickFile` | const arrow | 163 |
| 7 | `handleDownloadTemplate` | const arrow | 169 |
| 8 | `handleImport` | const arrow | 173 |

### 3.115 `frontend/src/components/sales/salesImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.116 `frontend/src/components/sales/SalesListSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getSaleItems` | function | 66 |
| 2 | `SalesListSurface` | component/function | 70 |

### 3.117 `frontend/src/components/sales/StatusBadge.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isSaleStatus` | function | 24 |
| 2 | `StatusBadge` | component/function | 50 |

### 3.118 `frontend/src/components/server/ServerPage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 15 | `ServerPage` | component/function | 646 |
| 16 | `check` | const arrow | 673 |
| 17 | `loadSecurityConfig` | const arrow | 701 |
| 18 | `handleTest` | function | 719 |
| 19 | `handleSave` | function | 748 |
| 20 | `handleDisconnect` | function | 755 |

### 3.119 `frontend/src/components/shared/ActionHistoryBar.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatHistoryList` | function | 48 |
| 2 | `formatServerStatus` | function | 52 |
| 3 | `ActionHistoryBar` | component/function | 59 |

### 3.120 `frontend/src/components/shared/BackgroundImportTracker.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 14 | `BackgroundImportTracker` | component/function | 273 |
| 15 | `finishTrackerAction` | const arrow | 412 |
| 16 | `handleCancel` | const arrow | 417 |
| 17 | `handleRetry` | const arrow | 436 |
| 18 | `handleApprove` | const arrow | 455 |
| 19 | `handleDownloadErrors` | const arrow | 485 |
| 20 | `handleRemove` | const arrow | 502 |
| 21 | `handleDismiss` | const arrow | 540 |

### 3.121 `frontend/src/components/shared/ExportMenu.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ExportMenu` | component/function | 15 |

### 3.122 `frontend/src/components/shared/FilterMenu.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `sectionButtonClass` | function | 34 |
| 2 | `FilterMenu` | component/function | 40 |

### 3.123 `frontend/src/components/shared/globalScroll.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDocumentLike` | function | 21 |
| 2 | `getPageScrollCandidates` | function | 25 |
| 3 | `isVisibleScrollNode` | function | 38 |

### 3.124 `frontend/src/components/shared/ImageGalleryLightbox.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ImageGalleryLightbox` | component/function | 29 |
| 2 | `formatLabel` | function | 51 |
| 3 | `setIndex` | function | 55 |
| 4 | `renderGalleryImage` | function | 61 |
| 5 | `onKeyDown` | function | 68 |

### 3.125 `frontend/src/components/shared/LoadingWatchdog.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `LoadingWatchdog` | component/function | 14 |

### 3.126 `frontend/src/components/shared/Modal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Modal` | component/function | 13 |

### 3.127 `frontend/src/components/shared/navigationConfig.ts`

- No top-level named function/class symbols detected.

### 3.128 `frontend/src/components/shared/NotificationCenter.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getNotificationApi` | function | 101 |
| 2 | `getErrorMessage` | function | 106 |
| 3 | `preferenceValue` | function | 233 |
| 4 | `matchesVisibilityMode` | function | 241 |
| 5 | `NotificationSeverityIcon` | function | 248 |
| 6 | `NotificationCenter` | component/function | 263 |
| 7 | `syncVisibility` | const arrow | 297 |
| 8 | `onVisible` | const arrow | 371 |
| 9 | `handleClickOutside` | const arrow | 394 |

### 3.129 `frontend/src/components/shared/pageActivity.ts`

- No top-level named function/class symbols detected.

### 3.130 `frontend/src/components/shared/PageHeader.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PageHeader` | component/function | 26 |

### 3.131 `frontend/src/components/shared/PaginationControls.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PaginationControls` | component/function | 40 |
| 2 | `commitPageDraft` | const arrow | 70 |
| 3 | `handlePageInputKeyDown` | const arrow | 81 |

### 3.132 `frontend/src/components/shared/PortalMenu.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPortalMenuItem` | function | 49 |
| 2 | `PortalMenu` | component/function | 59 |
| 3 | `closeIfClickedOutside` | const arrow | 117 |
| 4 | `closeMenu` | const arrow | 125 |
| 5 | `scheduleReposition` | const arrow | 126 |
| 6 | `closeIfEscape` | const arrow | 133 |

### 3.133 `frontend/src/components/shared/QuickPreferenceToggles.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ToggleButton` | function | 24 |
| 2 | `QuickPreferenceToggles` | component/function | 43 |
| 3 | `tr` | const arrow | 46 |

### 3.134 `frontend/src/components/shared/SectionSwitcher.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readStoredSection` | function | 19 |
| 2 | `SectionSwitcher` | component/function | 28 |
| 3 | `selectValue` | const arrow | 55 |

### 3.135 `frontend/src/components/shared/WriteConflictModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `asConflictRecord` | function | 34 |
| 2 | `isConflictSummaryRow` | function | 38 |
| 3 | `isVisibleFieldRow` | function | 42 |
| 4 | `formatConflictTime` | function | 46 |
| 5 | `valueToString` | function | 53 |
| 6 | `summarizeCurrentValue` | function | 57 |
| 7 | `formatValue` | function | 114 |
| 8 | `formatItemSummary` | function | 121 |
| 9 | `getConflictFieldRows` | function | 132 |
| 10 | `WriteConflictModal` | component/function | 226 |

### 3.136 `frontend/src/components/users/PermissionEditor.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `parsePermissionState` | function | 75 |
| 2 | `PermissionEditor` | component/function | 89 |
| 3 | `toggle` | const arrow | 104 |

### 3.137 `frontend/src/components/users/UserDetailSheet.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `translateLabel` | function | 43 |
| 2 | `buildRowData` | function | 48 |
| 3 | `parsePermissions` | function | 60 |
| 4 | `UserDetailSheet` | component/function | 71 |

### 3.138 `frontend/src/components/users/UserProfileModal.jsx`

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

### 3.139 `frontend/src/components/users/Users.jsx`

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

### 3.140 `frontend/src/components/utils-settings/AuditLog.jsx`

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

### 3.141 `frontend/src/components/utils-settings/Backup.jsx`

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

### 3.142 `frontend/src/components/utils-settings/FontFamilyPicker.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `FontFamilyPicker` | component/function | 29 |

### 3.143 `frontend/src/components/utils-settings/index.ts`

- No top-level named function/class symbols detected.

### 3.144 `frontend/src/components/utils-settings/OtpModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getOtpApi` | function | 45 |
| 2 | `getErrorMessage` | function | 49 |
| 3 | `OtpModal` | component/function | 53 |
| 4 | `loadSetup` | function | 88 |

### 3.145 `frontend/src/components/utils-settings/ResetData.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.146 `frontend/src/components/utils-settings/Settings.jsx`

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

### 3.147 `frontend/src/components/utils-settings/settingsConflict.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeObject` | function | 28 |

### 3.148 `frontend/src/constants.ts`

- No top-level named function/class symbols detected.

### 3.149 `frontend/src/index.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.150 `frontend/src/platform/runtime/clientRuntime.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `canUseBrowserStorage` | function | 31 |
| 2 | `isBusinessOsStorageKey` | function | 35 |
| 3 | `sanitizeText` | function | 40 |
| 4 | `unregisterServiceWorkers` | function | 152 |
| 5 | `deleteBusinessOsCaches` | function | 156 |
| 6 | `clearServiceWorkersAndCaches` | function | 162 |
| 7 | `snapshotStorage` | function | 178 |
| 8 | `clearStorage` | function | 191 |
| 9 | `restoreStorage` | function | 204 |

### 3.151 `frontend/src/platform/storage/storagePolicy.ts`

- No top-level named function/class symbols detected.

### 3.152 `frontend/src/runtime/runtimeErrorClassifier.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `messageOf` | function | 27 |
| 2 | `stackOf` | function | 31 |
| 3 | `toText` | function | 35 |
| 4 | `includesExtensionOrigin` | function | 39 |
| 5 | `getPathname` | function | 44 |

### 3.153 `frontend/src/types/jsx-modules.d.ts`

- No top-level named function/class symbols detected.

### 3.154 `frontend/src/types/receiptContracts.ts`

- No top-level named function/class symbols detected.

### 3.155 `frontend/src/types/settingsContracts.ts`

- No top-level named function/class symbols detected.

### 3.156 `frontend/src/utils/actionGuards.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `hasOwn` | function | 18 |

### 3.157 `frontend/src/utils/actionHistory.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeActionHistoryId` | function | 86 |
| 2 | `normalizeEntry` | function | 92 |
| 3 | `parsePermissions` | function | 105 |
| 4 | `getErrorMessage` | function | 117 |

### 3.158 `frontend/src/utils/appRefresh.ts`

- No top-level named function/class symbols detected.

### 3.159 `frontend/src/utils/bulkOps.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `runner` | function | 47 |

### 3.160 `frontend/src/utils/color.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeHex` | function | 1 |
| 2 | `relativeLuminance` | function | 12 |

### 3.161 `frontend/src/utils/csv.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `escapeCsvValue` | function | 17 |
| 2 | `normalizeZipFile` | function | 54 |
| 3 | `CRC32_TABLE` | const arrow | 66 |
| 4 | `crc32` | function | 78 |
| 5 | `writeUint16` | function | 86 |
| 6 | `writeUint32` | function | 90 |
| 7 | `toBlobPart` | function | 94 |
| 8 | `encodeZipTimestamp` | function | 100 |

### 3.162 `frontend/src/utils/csvExportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 20 |

### 3.163 `frontend/src/utils/csvImport.ts`

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

### 3.164 `frontend/src/utils/csvRowCounter.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `finishRecord` | const arrow | 7 |

### 3.165 `frontend/src/utils/dateHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toLocalDateString` | function | 4 |

### 3.166 `frontend/src/utils/deviceInfo.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBrowserName` | function | 13 |
| 2 | `getOperatingSystemName` | function | 21 |

### 3.167 `frontend/src/utils/exportPackage.ts`

- No top-level named function/class symbols detected.

### 3.168 `frontend/src/utils/exportReports.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `escapeHtml` | function | 255 |
| 2 | `formatCellValue` | function | 264 |
| 3 | `renderChartMarkup` | function | 269 |
| 4 | `renderMetadataGroups` | function | 285 |
| 5 | `renderSummaryCards` | function | 307 |
| 6 | `renderCharts` | function | 322 |
| 7 | `renderTables` | function | 340 |
| 8 | `renderNotes` | function | 374 |

### 3.169 `frontend/src/utils/favicon.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `clamp` | function | 11 |
| 2 | `shouldUseAnonymousCors` | function | 18 |
| 3 | `loadImage` | function | 29 |

### 3.170 `frontend/src/utils/formatters.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeTimestampInput` | function | 6 |

### 3.171 `frontend/src/utils/groupedRecords.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toDate` | function | 37 |
| 2 | `normalizeName` | function | 56 |
| 3 | `compareAlphabetLabels` | function | 64 |

### 3.172 `frontend/src/utils/historyHelpers.ts`

- No top-level named function/class symbols detected.

### 3.173 `frontend/src/utils/importJobRefresh.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeImportJobStatus` | function | 24 |
| 2 | `normalizeImportJobType` | function | 28 |
| 3 | `uniqueChannels` | function | 32 |
| 4 | `dispatchSyncUpdate` | function | 41 |

### 3.174 `frontend/src/utils/index.ts`

- No top-level named function/class symbols detected.

### 3.175 `frontend/src/utils/initials.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getInitialRank` | function | 54 |

### 3.176 `frontend/src/utils/loaders.ts`

- No top-level named function/class symbols detected.

### 3.177 `frontend/src/utils/mediaUpload.ts`

- No top-level named function/class symbols detected.

### 3.178 `frontend/src/utils/permissions.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPermissionMap` | function | 3 |

### 3.179 `frontend/src/utils/pricing.ts`

- No top-level named function/class symbols detected.

### 3.180 `frontend/src/utils/printReceipt.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 27 | `downloadBlob` | function | 822 |
| 28 | `buildTextOnlyReceiptBlob` | const arrow | 870 |
| 29 | `renderPdfBlob` | const arrow | 884 |
| 30 | `extractReceiptLines` | function | 940 |

### 3.181 `frontend/src/utils/productBatches.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeBranchId` | function | 26 |

### 3.182 `frontend/src/utils/productGrouping.ts`

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

### 3.183 `frontend/src/utils/publicAssetUrls.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `trimBaseUrl` | function | 11 |
| 2 | `normalizeUploadPath` | function | 15 |
| 3 | `appendAssetVersion` | function | 23 |
| 4 | `isLocalLikeHostname` | function | 38 |
| 5 | `getSafeCurrentOrigin` | function | 42 |
| 6 | `api` | const arrow | 57 |

### 3.184 `frontend/src/utils/receiptAppliedConfig.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `parseObject` | function | 67 |

### 3.185 `frontend/src/utils/scriptTypography.ts`

- No top-level named function/class symbols detected.

### 3.186 `frontend/src/utils/settingsRefresh.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeSettingKeys` | function | 62 |

### 3.187 `frontend/src/utils/settingsWriteOptions.ts`

- No top-level named function/class symbols detected.

### 3.188 `frontend/src/web-api.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `sanitizeBaseUrl` | function | 77 |
| 2 | `loadMethodsModule` | function | 81 |
| 3 | `getLazyApiMethod` | function | 87 |
| 4 | `mapOfflineFileChunkStatusUpdates` | function | 101 |
| 5 | `asArrayBuffer` | function | 117 |
| 6 | `bytesToBase64` | function | 121 |
| 7 | `base64ToBytes` | function | 132 |
| 8 | `stableStringify` | function | 139 |
| 9 | `sha256Hex` | function | 145 |
| 10 | `deriveOfflineVaultKey` | function | 153 |
| 11 | `encryptOfflineVaultValue` | function | 170 |
| 12 | `decryptOfflineVaultValue` | function | 178 |
| 13 | `requestOfflinePersistentStorage` | function | 188 |
| 14 | `dispatchVaultLocked` | function | 195 |
| 15 | `scheduleOfflineVaultIdleLock` | function | 200 |
| 16 | `lockOfflineVault` | function | 206 |
| 17 | `unlockOfflineVault` | function | 214 |
| 18 | `queueBusinessOutboxOperation` | function | 239 |
| 19 | `queueOfflineFileChunks` | function | 277 |
| 20 | `dispatchOutboxProgress` | function | 330 |
| 21 | `dispatchOutboxFileProgress` | function | 337 |
| 22 | `dispatchOutboxConflict` | function | 344 |
| 23 | `getSyncOutboxKey` | function | 351 |
| 24 | `syncUnlockedOfflineOutbox` | function | 355 |
| 25 | `syncUnlockedOfflineFileChunks` | function | 464 |
| 26 | `registerOutboxBackgroundSync` | function | 525 |
| 27 | `refreshOfflineSnapshotSoon` | function | 540 |
| 28 | `run` | const arrow | 550 |
| 29 | `refreshServiceWorkerSoon` | function | 569 |
| 30 | `runOfflineMaintenance` | function | 579 |
| 31 | `startOfflineMaintenanceLoop` | function | 591 |
| 32 | `forwardServiceWorkerOutboxEvent` | function | 599 |
| 33 | `forwardServiceWorkerAppEvent` | function | 693 |

### 3.189 `ops/scripts/frontend/verify-i18n.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `collectUsedKeys` | function | 29 |
| 2 | `flattenTranslationTree` | function | 69 |
| 3 | `listMissing` | function | 83 |
| 4 | `listEmptyValues` | function | 88 |
| 5 | `printList` | function | 95 |
| 6 | `main` | function | 102 |

### 3.190 `ops/scripts/frontend/verify-performance.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `read` | function | 15 |
| 2 | `walk` | function | 19 |
| 3 | `trackedFiles` | function | 37 |
| 4 | `assert` | function | 47 |

### 3.191 `ops/scripts/frontend/verify-ui.ts`

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

### 3.192 `frontend/vite.config.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readGitRevision` | function | 11 |
| 2 | `fixCrossorigin` | function | 49 |
| 3 | `emitBuildManifest` | function | 74 |
| 4 | `shouldDeferModulePreload` | function | 115 |
| 5 | `manualChunks` | function | 119 |

### 3.193 `frontend/tailwind.config.ts`

- No top-level named function/class symbols detected.

