# Frontend Function Reference

Auto-generated symbol inventory for frontend files. Regenerate with `node ops/scripts/docs/generate-doc-reference.ts`.

## 1. Coverage Summary

Total files documented: **193**

## 2. Symbol Count by File

| No. | File | Symbols |
|---:|---|---:|
| 1 | `frontend/src/api/http.ts` | 32 |
| 2 | `frontend/src/api/localDb.ts` | 1 |
| 3 | `frontend/src/api/methods.ts` | 163 |
| 4 | `frontend/src/api/websocket.ts` | 7 |
| 5 | `frontend/src/App.tsx` | 68 |
| 6 | `frontend/src/app/appShellUtils.ts` | 0 |
| 7 | `frontend/src/app/publicErrorRecovery.ts` | 1 |
| 8 | `frontend/src/AppContext.tsx` | 37 |
| 9 | `frontend/src/components/auth/Login.tsx` | 23 |
| 10 | `frontend/src/components/branches/Branches.tsx` | 15 |
| 11 | `frontend/src/components/branches/BranchForm.tsx` | 2 |
| 12 | `frontend/src/components/branches/TransferModal.tsx` | 6 |
| 13 | `frontend/src/components/catalog/CatalogEditorSurface.tsx` | 1 |
| 14 | `frontend/src/components/catalog/CatalogImageField.tsx` | 1 |
| 15 | `frontend/src/components/catalog/CatalogPage.tsx` | 117 |
| 16 | `frontend/src/components/catalog/CatalogPageContext.tsx` | 0 |
| 17 | `frontend/src/components/catalog/CatalogPreviewSurface.tsx` | 2 |
| 18 | `frontend/src/components/catalog/CatalogProductsSection.tsx` | 4 |
| 19 | `frontend/src/components/catalog/CatalogSecondaryTabs.tsx` | 6 |
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
| 42 | `frontend/src/components/dashboard/Dashboard.tsx` | 18 |
| 43 | `frontend/src/components/dashboard/MiniStat.tsx` | 1 |
| 44 | `frontend/src/components/files/FilePickerModal.tsx` | 8 |
| 45 | `frontend/src/components/files/FilesPage.tsx` | 27 |
| 46 | `frontend/src/components/files/FilesProvidersTab.tsx` | 2 |
| 47 | `frontend/src/components/files/FilesResponsesTab.tsx` | 1 |
| 48 | `frontend/src/components/inventory/DualMoney.tsx` | 1 |
| 49 | `frontend/src/components/inventory/Inventory.tsx` | 23 |
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
| 61 | `frontend/src/components/pos/POS.tsx` | 36 |
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
| 86 | `frontend/src/components/products/Products.tsx` | 24 |
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
| 138 | `frontend/src/components/users/UserProfileModal.tsx` | 14 |
| 139 | `frontend/src/components/users/Users.tsx` | 18 |
| 140 | `frontend/src/components/utils-settings/AuditLog.tsx` | 18 |
| 141 | `frontend/src/components/utils-settings/Backup.tsx` | 34 |
| 142 | `frontend/src/components/utils-settings/FontFamilyPicker.tsx` | 1 |
| 143 | `frontend/src/components/utils-settings/index.ts` | 0 |
| 144 | `frontend/src/components/utils-settings/OtpModal.tsx` | 4 |
| 145 | `frontend/src/components/utils-settings/ResetData.tsx` | 10 |
| 146 | `frontend/src/components/utils-settings/Settings.tsx` | 26 |
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

### 3.3 `frontend/src/api/methods.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 13 | `createClientRequestId` | function | 186 |
| 14 | `ensureClientRequestId` | function | 193 |
| 15 | `serializePendingSyncPreview` | function | 199 |
| 16 | `canRefreshOfflineDeviceSnapshot` | function | 254 |
| 17 | `readOfflineDeviceSnapshotMeta` | function | 261 |
| 18 | `writeOfflineDeviceSnapshotMeta` | function | 269 |
| 19 | `runOfflineSnapshotStep` | function | 286 |
| 20 | `previousMeta` | const arrow | 306 |
| 21 | `invalidateClientRuntimeState` | function | 351 |
| 22 | `withExpectedUpdatedAt` | function | 367 |
| 23 | `withSettingsExpectedUpdatedAt` | function | 381 |
| 24 | `appendActorQuery` | function | 391 |
| 25 | `fetchJsonWithTimeout` | function | 406 |
| 26 | `mirrorReadResult` | function | 424 |
| 27 | `routeMirrored` | function | 433 |
| 28 | `shouldPersistLocalMirror` | function | 439 |
| 29 | `purgeSensitiveLiveServerMirrors` | function | 443 |
| 30 | `mirrorTable` | function | 454 |
| 31 | `buildQueryCacheStorageKey` | function | 471 |
| 32 | `readCachedQueryResult` | function | 475 |
| 33 | `writeCachedQueryResult` | function | 489 |
| 34 | `clearCachedQueryResults` | function | 503 |
| 35 | `getNotificationSummaryFallback` | function | 546 |
| 36 | `getDriveSyncStatusFallback` | function | 555 |
| 37 | `readNotificationSummaryMissingUntil` | function | 563 |
| 38 | `markNotificationSummaryMissing` | function | 575 |
| 39 | `clearNotificationSummaryMissing` | function | 590 |
| 40 | `readStorageNumber` | function | 599 |
| 41 | `writeStorageNumber` | function | 615 |
| 42 | `clearStorageNumber` | function | 626 |
| 43 | `buildLocalBootstrap` | const arrow | 726 |
| 44 | `runSave` | const arrow | 817 |
| 45 | `getCategories` | const arrow | 875 |
| 46 | `createCategory` | const arrow | 876 |
| 47 | `updateCategory` | const arrow | 881 |
| 48 | `deleteCategory` | const arrow | 886 |
| 49 | `getUnits` | const arrow | 893 |
| 50 | `createUnit` | const arrow | 894 |
| 51 | `updateUnit` | const arrow | 899 |
| 52 | `deleteUnit` | const arrow | 904 |
| 53 | `getBranches` | const arrow | 911 |
| 54 | `getBranchSummary` | const arrow | 912 |
| 55 | `updateBranch` | const arrow | 914 |
| 56 | `deleteBranch` | const arrow | 918 |
| 57 | `getBranchStock` | const arrow | 922 |
| 58 | `getTransfers` | const arrow | 926 |
| 59 | `getBranchStockIntegrity` | const arrow | 928 |
| 60 | `getProducts` | const arrow | 932 |
| 61 | `searchProducts` | const arrow | 933 |
| 62 | `getProductsByIds` | const arrow | 943 |
| 63 | `getProductFilters` | const arrow | 954 |
| 64 | `getProductLookupUsage` | const arrow | 964 |
| 65 | `replaceProductLookupValues` | const arrow | 972 |
| 66 | `getPortalSubmissionsForReview` | const arrow | 1091 |
| 67 | `reviewPortalSubmission` | const arrow | 1093 |
| 68 | `getAiProviders` | const arrow | 1096 |
| 69 | `createAiProvider` | const arrow | 1098 |
| 70 | `updateAiProvider` | const arrow | 1100 |
| 71 | `deleteAiProvider` | const arrow | 1102 |
| 72 | `testAiProvider` | const arrow | 1104 |
| 73 | `getAiResponses` | const arrow | 1106 |
| 74 | `deleteProduct` | const arrow | 1135 |
| 75 | `buildMultipartHeaders` | function | 1152 |
| 76 | `apiFormPost` | function | 1162 |
| 77 | `withImportDeviceInfo` | const arrow | 1181 |
| 78 | `listImportJobs` | const arrow | 1184 |
| 79 | `getImportJobReview` | const arrow | 1193 |
| 80 | `updateImportJobDecisions` | const arrow | 1197 |
| 81 | `startImportJob` | const arrow | 1200 |
| 82 | `approveImportJob` | const arrow | 1202 |
| 83 | `cancelImportJob` | const arrow | 1204 |
| 84 | `retryImportJob` | const arrow | 1206 |
| 85 | `deleteImportJob` | const arrow | 1208 |
| 86 | `getImportQueueStatus` | const arrow | 1227 |
| 87 | `finish` | const arrow | 1344 |
| 88 | `abortListener` | const arrow | 1351 |
| 89 | `getActionHistory` | const arrow | 1524 |
| 90 | `updateActionHistory` | const arrow | 1530 |
| 91 | `getInventorySummary` | const arrow | 1536 |
| 92 | `getInventoryStats` | const arrow | 1537 |
| 93 | `searchInventoryProducts` | const arrow | 1541 |
| 94 | `getInventoryMovements` | const arrow | 1551 |
| 95 | `getInventoryReasons` | const arrow | 1576 |
| 96 | `saveInventoryReasons` | const arrow | 1578 |
| 97 | `buildOfflineSaleReceiptNumber` | function | 1581 |
| 98 | `isRetryableOfflineSaleError` | function | 1587 |
| 99 | `findQueuedSale` | function | 1596 |
| 100 | `putOfflineSaleMirror` | function | 1603 |
| 101 | `queueOfflineSale` | function | 1628 |
| 102 | `queuedSaleBackoffMs` | function | 1686 |
| 103 | `updateQueuedRow` | function | 1691 |
| 104 | `completeQueuedSale` | function | 1700 |
| 105 | `failQueuedSale` | function | 1723 |
| 106 | `markQueuedSaleConflict` | function | 1736 |
| 107 | `syncPendingSalesQueue` | function | 1758 |
| 108 | `getRfidStatus` | const arrow | 1801 |
| 109 | `searchRfidTags` | const arrow | 1807 |
| 110 | `recordRfidSessionEvents` | const arrow | 1813 |
| 111 | `applyRfidSession` | const arrow | 1817 |
| 112 | `getSales` | const arrow | 1833 |
| 113 | `getDashboard` | const arrow | 1840 |
| 114 | `getAnalytics` | const arrow | 1841 |
| 115 | `getCustomers` | const arrow | 1850 |
| 116 | `getCustomerPointSummaries` | const arrow | 1871 |
| 117 | `updateCustomer` | const arrow | 1879 |
| 118 | `deleteCustomer` | const arrow | 1883 |
| 119 | `downloadCustomerTemplate` | const arrow | 1888 |
| 120 | `getSuppliers` | const arrow | 1897 |
| 121 | `updateSupplier` | const arrow | 1906 |
| 122 | `deleteSupplier` | const arrow | 1910 |
| 123 | `downloadSupplierTemplate` | const arrow | 1915 |
| 124 | `getDeliveryContacts` | const arrow | 1924 |
| 125 | `updateDeliveryContact` | const arrow | 1933 |
| 126 | `deleteDeliveryContact` | const arrow | 1937 |
| 127 | `getUsers` | const arrow | 1944 |
| 128 | `updateUser` | const arrow | 1946 |
| 129 | `getUserProfile` | const arrow | 1947 |
| 130 | `getUserAuthMethods` | const arrow | 1948 |
| 131 | `updateUserProfile` | const arrow | 1950 |
| 132 | `disconnectUserAuthProvider` | const arrow | 1952 |
| 133 | `changeUserPassword` | const arrow | 1954 |
| 134 | `resetPassword` | const arrow | 1956 |
| 135 | `getRoles` | const arrow | 1959 |
| 136 | `updateRole` | const arrow | 1961 |
| 137 | `deleteRole` | const arrow | 1962 |
| 138 | `getCustomTables` | const arrow | 1965 |
| 139 | `getCustomTableData` | const arrow | 1967 |
| 140 | `insertCustomRow` | const arrow | 1968 |
| 141 | `updateCustomRow` | const arrow | 1969 |
| 142 | `deleteCustomRow` | const arrow | 1970 |
| 143 | `getAuditLogs` | const arrow | 1973 |
| 144 | `deleteAuditLogsRetention` | const arrow | 1999 |
| 145 | `wait` | function | 2003 |
| 146 | `waitForSystemJob` | function | 2043 |
| 147 | `getGoogleDriveSyncStatus` | const arrow | 2090 |
| 148 | `saveGoogleDriveSyncPreferences` | const arrow | 2124 |
| 149 | `startGoogleDriveSyncOauth` | const arrow | 2127 |
| 150 | `disconnectGoogleDriveSync` | const arrow | 2130 |
| 151 | `forgetGoogleDriveSyncCredentials` | const arrow | 2133 |
| 152 | `queueGoogleDriveSyncNow` | const arrow | 2136 |
| 153 | `syncGoogleDriveNow` | const arrow | 2139 |
| 154 | `getReturns` | const arrow | 2215 |
| 155 | `updateSaleStatus` | const arrow | 2236 |
| 156 | `attachSaleCustomer` | const arrow | 2252 |
| 157 | `getSalesExport` | const arrow | 2276 |
| 158 | `updateReturn` | const arrow | 2280 |
| 159 | `getDataPath` | const arrow | 2334 |
| 160 | `getScaleMigrationStatus` | const arrow | 2335 |
| 161 | `prepareScaleMigration` | const arrow | 2336 |
| 162 | `runScaleMigration` | const arrow | 2337 |
| 163 | `browseDir` | const arrow | 2348 |

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

### 3.5 `frontend/src/App.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 64 | `App` | component/function | 1275 |
| 65 | `onQueued` | const arrow | 1340 |
| 66 | `onSynced` | const arrow | 1353 |
| 67 | `handleLocationChange` | const arrow | 1378 |
| 68 | `loadFavicon` | function | 1424 |

### 3.6 `frontend/src/app/appShellUtils.ts`

- No top-level named function/class symbols detected.

### 3.7 `frontend/src/app/publicErrorRecovery.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getRecoveryStorage` | function | 6 |

### 3.8 `frontend/src/AppContext.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 21 | `buildRuntimeDescriptorFromBootstrap` | function | 426 |
| 22 | `LoadingScreen` | function | 455 |
| 23 | `AccessDenied` | function | 468 |
| 24 | `onUpdate` | const arrow | 722 |
| 25 | `onStatus` | const arrow | 754 |
| 26 | `poll` | const arrow | 763 |
| 27 | `onError` | const arrow | 783 |
| 28 | `onWriteBlocked` | const arrow | 805 |
| 29 | `onRuntimeMismatch` | const arrow | 815 |
| 30 | `onConflict` | const arrow | 835 |
| 31 | `onUnauthorized` | const arrow | 904 |
| 32 | `handleOtpLogin` | const arrow | 963 |
| 33 | `handleUserUpdated` | const arrow | 1005 |
| 34 | `discoverSyncUrl` | const arrow | 1042 |
| 35 | `clearCallbackUrl` | const arrow | 1431 |
| 36 | `clearPendingLink` | const arrow | 1435 |
| 37 | `run` | const arrow | 1439 |

### 3.9 `frontend/src/components/auth/Login.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getAuthApi` | function | 178 |
| 2 | `getErrorMessage` | function | 183 |
| 3 | `readPendingOauthLogin` | function | 187 |
| 4 | `clearPendingOauthLogin` | function | 201 |
| 5 | `readOauthCallbackResult` | function | 207 |
| 6 | `clearOauthCallbackResult` | function | 218 |
| 7 | `OauthButton` | function | 224 |
| 8 | `ModeBackButton` | function | 238 |
| 9 | `Login` | component/function | 251 |
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

### 3.13 `frontend/src/components/catalog/CatalogEditorSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `CatalogEditorSurface` | component/function | 191 |

### 3.14 `frontend/src/components/catalog/CatalogImageField.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `CatalogImageField` | component/function | 28 |

### 3.15 `frontend/src/components/catalog/CatalogPage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 54 | `CatalogPage` | component/function | 1162 |
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

### 3.19 `frontend/src/components/catalog/CatalogSecondaryTabs.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizePortalColor` | function | 269 |
| 2 | `CatalogMembershipSection` | function | 274 |
| 3 | `CatalogAboutSection` | function | 620 |
| 4 | `CatalogFaqSection` | function | 834 |
| 5 | `CatalogAiSection` | function | 888 |
| 6 | `CatalogSecondaryTabs` | component/function | 1074 |

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

### 3.42 `frontend/src/components/dashboard/Dashboard.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 15 | `Dashboard` | component/function | 416 |
| 16 | `calcTrend` | const arrow | 669 |
| 17 | `rangeLabel` | const arrow | 713 |
| 18 | `periodShort` | const arrow | 719 |

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

### 3.49 `frontend/src/components/inventory/Inventory.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 13 | `Inventory` | component/function | 383 |
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

### 3.61 `frontend/src/components/pos/POS.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 11 | `POS` | component/function | 371 |
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

### 3.86 `frontend/src/components/products/Products.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 11 | `Products` | component/function | 395 |
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
| 3 | `Row` | const arrow | 121 |

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

### 3.138 `frontend/src/components/users/UserProfileModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getProfileApi` | function | 150 |
| 2 | `getErrorMessage` | function | 155 |
| 3 | `parseStoredOrganization` | function | 159 |
| 4 | `AvatarPreview` | function | 176 |
| 5 | `ProfileSectionButton` | function | 194 |
| 6 | `clamp` | function | 304 |
| 7 | `loadImageElement` | function | 308 |
| 8 | `renderAvatarCropBlob` | function | 323 |
| 9 | `AvatarEditorModal` | function | 349 |
| 10 | `UserProfileModal` | component/function | 410 |
| 11 | `handleProfileSave` | const arrow | 578 |
| 12 | `handlePasswordSave` | const arrow | 642 |
| 13 | `handleSessionSave` | const arrow | 681 |
| 14 | `refreshOtpState` | const arrow | 701 |

### 3.139 `frontend/src/components/users/Users.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 11 | `Users` | component/function | 265 |
| 12 | `promise` | const arrow | 332 |
| 13 | `promise` | const arrow | 370 |
| 14 | `openCreateUser` | const arrow | 482 |
| 15 | `openCreateRole` | const arrow | 512 |
| 16 | `handleSaveUser` | const arrow | 573 |
| 17 | `handleResetPassword` | const arrow | 643 |
| 18 | `handleSaveRole` | const arrow | 700 |

### 3.140 `frontend/src/components/utils-settings/AuditLog.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 17 | `AuditLog` | component/function | 274 |
| 18 | `sessionEntryLabel` | function | 668 |

### 3.141 `frontend/src/components/utils-settings/Backup.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 31 | `Backup` | component/function | 1373 |
| 32 | `showBackupSection` | const arrow | 1388 |
| 33 | `handleFolderExport` | const arrow | 1414 |
| 34 | `handleFolderImport` | const arrow | 1483 |

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

### 3.146 `frontend/src/components/utils-settings/Settings.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 12 | `Settings` | component/function | 464 |
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
| 1 | `normalizeActionHistoryId` | function | 94 |
| 2 | `normalizeEntry` | function | 100 |
| 3 | `parsePermissions` | function | 113 |
| 4 | `getErrorMessage` | function | 125 |

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

