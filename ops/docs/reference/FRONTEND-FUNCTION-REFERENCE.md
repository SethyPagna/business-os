# Frontend Function Reference

Auto-generated symbol inventory for frontend files. Regenerate with `node ops/scripts/generate-doc-reference.js`.

## 1. Coverage Summary

Total files documented: **125**

## 2. Symbol Count by File

| No. | File | Symbols |
|---:|---|---:|
| 1 | `frontend/src/api/http.js` | 25 |
| 2 | `frontend/src/api/localDb.js` | 1 |
| 3 | `frontend/src/api/methods.js` | 103 |
| 4 | `frontend/src/api/websocket.js` | 3 |
| 5 | `frontend/src/App.jsx` | 38 |
| 6 | `frontend/src/AppContext.jsx` | 38 |
| 7 | `frontend/src/components/auth/Login.jsx` | 21 |
| 8 | `frontend/src/components/branches/Branches.jsx` | 9 |
| 9 | `frontend/src/components/branches/BranchForm.jsx` | 3 |
| 10 | `frontend/src/components/branches/TransferModal.jsx` | 3 |
| 11 | `frontend/src/components/catalog/CatalogPage.jsx` | 80 |
| 12 | `frontend/src/components/catalog/CatalogProductsSection.jsx` | 4 |
| 13 | `frontend/src/components/catalog/CatalogSecondaryTabs.jsx` | 5 |
| 14 | `frontend/src/components/catalog/catalogUi.jsx` | 1 |
| 15 | `frontend/src/components/contacts/contactOptionUtils.js` | 1 |
| 16 | `frontend/src/components/contacts/Contacts.jsx` | 8 |
| 17 | `frontend/src/components/contacts/CustomersTab.jsx` | 19 |
| 18 | `frontend/src/components/contacts/DeliveryTab.jsx` | 21 |
| 19 | `frontend/src/components/contacts/shared.jsx` | 10 |
| 20 | `frontend/src/components/contacts/SuppliersTab.jsx` | 15 |
| 21 | `frontend/src/components/custom-tables/CustomTables.jsx` | 11 |
| 22 | `frontend/src/components/dashboard/charts/BarChart.jsx` | 2 |
| 23 | `frontend/src/components/dashboard/charts/DonutChart.jsx` | 1 |
| 24 | `frontend/src/components/dashboard/charts/index.js` | 0 |
| 25 | `frontend/src/components/dashboard/charts/LineChart.jsx` | 4 |
| 26 | `frontend/src/components/dashboard/charts/NoData.jsx` | 1 |
| 27 | `frontend/src/components/dashboard/Dashboard.jsx` | 9 |
| 28 | `frontend/src/components/dashboard/MiniStat.jsx` | 1 |
| 29 | `frontend/src/components/files/FilePickerModal.jsx` | 6 |
| 30 | `frontend/src/components/files/FilesPage.jsx` | 15 |
| 31 | `frontend/src/components/inventory/DualMoney.jsx` | 1 |
| 32 | `frontend/src/components/inventory/Inventory.jsx` | 12 |
| 33 | `frontend/src/components/inventory/InventoryImportModal.jsx` | 6 |
| 34 | `frontend/src/components/inventory/movementGroups.js` | 4 |
| 35 | `frontend/src/components/inventory/ProductDetailModal.jsx` | 2 |
| 36 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | 8 |
| 37 | `frontend/src/components/navigation/Sidebar.jsx` | 6 |
| 38 | `frontend/src/components/pos/CartItem.jsx` | 1 |
| 39 | `frontend/src/components/pos/FilterPanel.jsx` | 5 |
| 40 | `frontend/src/components/pos/POS.jsx` | 21 |
| 41 | `frontend/src/components/pos/ProductImage.jsx` | 1 |
| 42 | `frontend/src/components/pos/QuickAddModal.jsx` | 2 |
| 43 | `frontend/src/components/products/BarcodeScannerModal.jsx` | 5 |
| 44 | `frontend/src/components/products/BranchStockAdjuster.jsx` | 4 |
| 45 | `frontend/src/components/products/BulkAddStockModal.jsx` | 2 |
| 46 | `frontend/src/components/products/BulkImportModal.jsx` | 25 |
| 47 | `frontend/src/components/products/HeaderActions.jsx` | 2 |
| 48 | `frontend/src/components/products/ManageBrandsModal.jsx` | 8 |
| 49 | `frontend/src/components/products/ManageCategoriesModal.jsx` | 4 |
| 50 | `frontend/src/components/products/ManageUnitsModal.jsx` | 5 |
| 51 | `frontend/src/components/products/primitives.jsx` | 9 |
| 52 | `frontend/src/components/products/ProductDetailModal.jsx` | 3 |
| 53 | `frontend/src/components/products/ProductForm.jsx` | 17 |
| 54 | `frontend/src/components/products/Products.jsx` | 25 |
| 55 | `frontend/src/components/products/VariantFormModal.jsx` | 5 |
| 56 | `frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | 4 |
| 57 | `frontend/src/components/receipt-settings/constants.js` | 1 |
| 58 | `frontend/src/components/receipt-settings/ErrorBoundary.jsx` | 0 |
| 59 | `frontend/src/components/receipt-settings/FieldOrderManager.jsx` | 9 |
| 60 | `frontend/src/components/receipt-settings/PrintSettings.jsx` | 8 |
| 61 | `frontend/src/components/receipt-settings/ReceiptPreview.jsx` | 2 |
| 62 | `frontend/src/components/receipt-settings/ReceiptSettings.jsx` | 4 |
| 63 | `frontend/src/components/receipt-settings/template.js` | 0 |
| 64 | `frontend/src/components/receipt/Receipt.jsx` | 8 |
| 65 | `frontend/src/components/returns/EditReturnModal.jsx` | 5 |
| 66 | `frontend/src/components/returns/NewReturnModal.jsx` | 10 |
| 67 | `frontend/src/components/returns/NewSupplierReturnModal.jsx` | 6 |
| 68 | `frontend/src/components/returns/ReturnDetailModal.jsx` | 3 |
| 69 | `frontend/src/components/returns/Returns.jsx` | 8 |
| 70 | `frontend/src/components/sales/ExportModal.jsx` | 9 |
| 71 | `frontend/src/components/sales/SaleDetailModal.jsx` | 6 |
| 72 | `frontend/src/components/sales/Sales.jsx` | 10 |
| 73 | `frontend/src/components/sales/SalesImportModal.jsx` | 6 |
| 74 | `frontend/src/components/sales/StatusBadge.jsx` | 1 |
| 75 | `frontend/src/components/server/ServerPage.jsx` | 15 |
| 76 | `frontend/src/components/shared/ActionHistoryBar.jsx` | 4 |
| 77 | `frontend/src/components/shared/BackgroundImportTracker.jsx` | 15 |
| 78 | `frontend/src/components/shared/ExportMenu.jsx` | 1 |
| 79 | `frontend/src/components/shared/FilterMenu.jsx` | 2 |
| 80 | `frontend/src/components/shared/ImageGalleryLightbox.jsx` | 5 |
| 81 | `frontend/src/components/shared/Modal.jsx` | 1 |
| 82 | `frontend/src/components/shared/navigationConfig.js` | 0 |
| 83 | `frontend/src/components/shared/NotificationCenter.jsx` | 7 |
| 84 | `frontend/src/components/shared/pageActivity.js` | 0 |
| 85 | `frontend/src/components/shared/PageHeader.jsx` | 1 |
| 86 | `frontend/src/components/shared/PageHelpButton.jsx` | 1 |
| 87 | `frontend/src/components/shared/pageHelpContent.js` | 0 |
| 88 | `frontend/src/components/shared/PaginationControls.jsx` | 1 |
| 89 | `frontend/src/components/shared/PortalMenu.jsx` | 5 |
| 90 | `frontend/src/components/shared/QuickPreferenceToggles.jsx` | 3 |
| 91 | `frontend/src/components/shared/WriteConflictModal.jsx` | 5 |
| 92 | `frontend/src/components/users/PermissionEditor.jsx` | 4 |
| 93 | `frontend/src/components/users/UserDetailSheet.jsx` | 3 |
| 94 | `frontend/src/components/users/UserProfileModal.jsx` | 21 |
| 95 | `frontend/src/components/users/Users.jsx` | 15 |
| 96 | `frontend/src/components/utils-settings/AuditLog.jsx` | 12 |
| 97 | `frontend/src/components/utils-settings/Backup.jsx` | 41 |
| 98 | `frontend/src/components/utils-settings/FontFamilyPicker.jsx` | 1 |
| 99 | `frontend/src/components/utils-settings/index.js` | 0 |
| 100 | `frontend/src/components/utils-settings/OtpModal.jsx` | 2 |
| 101 | `frontend/src/components/utils-settings/ResetData.jsx` | 8 |
| 102 | `frontend/src/components/utils-settings/Settings.jsx` | 20 |
| 103 | `frontend/src/constants.js` | 0 |
| 104 | `frontend/src/index.jsx` | 9 |
| 105 | `frontend/src/platform/runtime/clientRuntime.js` | 7 |
| 106 | `frontend/src/utils/appRefresh.js` | 0 |
| 107 | `frontend/src/utils/color.js` | 2 |
| 108 | `frontend/src/utils/csv.js` | 6 |
| 109 | `frontend/src/utils/csvImport.js` | 5 |
| 110 | `frontend/src/utils/dateHelpers.js` | 0 |
| 111 | `frontend/src/utils/deviceInfo.js` | 0 |
| 112 | `frontend/src/utils/exportPackage.js` | 0 |
| 113 | `frontend/src/utils/exportReports.jsx` | 8 |
| 114 | `frontend/src/utils/favicon.js` | 2 |
| 115 | `frontend/src/utils/formatters.js` | 0 |
| 116 | `frontend/src/utils/index.js` | 0 |
| 117 | `frontend/src/utils/pricing.js` | 0 |
| 118 | `frontend/src/utils/printReceipt.js` | 26 |
| 119 | `frontend/src/web-api.js` | 1 |
| 120 | `ops/scripts/frontend/verify-i18n.js` | 6 |
| 121 | `ops/scripts/frontend/verify-performance.js` | 4 |
| 122 | `ops/scripts/frontend/verify-ui.js` | 13 |
| 123 | `frontend/vite.config.mjs` | 2 |
| 124 | `frontend/postcss.config.mjs` | 0 |
| 125 | `frontend/tailwind.config.mjs` | 0 |

## 3. Detailed Function Commentary

### 3.1 `frontend/src/api/http.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `hydrateAuthTokenFromStorage` | function | 47 |
| 2 | `readAuthTokenFromStorage` | function | 59 |
| 3 | `logCall` | function | 114 |
| 4 | `getClientMetaHeaders` | function | 122 |
| 5 | `createApiError` | function | 126 |
| 6 | `createWriteBlockedError` | function | 139 |
| 7 | `dispatchWriteBlocked` | function | 149 |
| 8 | `getConflictRefreshChannels` | function | 207 |
| 9 | `dispatchGlobalDataRefresh` | function | 216 |
| 10 | `sleep` | function | 225 |
| 11 | `hasUsableLocalData` | function | 229 |
| 12 | `tryServerReadWithRetry` | function | 236 |
| 13 | `resolveLocalRead` | function | 246 |
| 14 | `stableStringifyForDedupe` | function | 253 |
| 15 | `clampDedupeBody` | function | 263 |
| 16 | `requestPromise` | const arrow | 293 |
| 17 | `parsed` | const arrow | 318 |
| 18 | `isConnectivityError` | function | 375 |
| 19 | `setServerHealth` | function | 396 |
| 20 | `pingServerHealth` | function | 408 |
| 21 | `getChannelRefreshKey` | function | 471 |
| 22 | `emitCacheRefresh` | function | 475 |
| 23 | `clearInflight` | function | 489 |
| 24 | `hasReusableInflight` | function | 494 |
| 25 | `raceServerReadWithLocalFallback` | function | 504 |

### 3.2 `frontend/src/api/localDb.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `splitCSVLine` | function | 224 |

### 3.3 `frontend/src/api/methods.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDeviceInfo` | function | 3 |
| 2 | `getPortalBaseUrl` | function | 30 |
| 3 | `getCurrentUserContext` | function | 35 |
| 4 | `emitSyncQueueChanged` | function | 50 |
| 5 | `createClientRequestId` | function | 75 |
| 6 | `ensureClientRequestId` | function | 82 |
| 7 | `invalidateClientRuntimeState` | function | 132 |
| 8 | `withExpectedUpdatedAt` | function | 148 |
| 9 | `withSettingsExpectedUpdatedAt` | function | 162 |
| 10 | `appendActorQuery` | function | 172 |
| 11 | `fetchJsonWithTimeout` | function | 185 |
| 12 | `mirrorReadResult` | function | 203 |
| 13 | `routeMirrored` | function | 212 |
| 14 | `shouldPersistLocalMirror` | function | 218 |
| 15 | `purgeSensitiveLiveServerMirrors` | function | 222 |
| 16 | `mirrorTable` | function | 233 |
| 17 | `getNotificationSummaryFallback` | function | 253 |
| 18 | `getDriveSyncStatusFallback` | function | 262 |
| 19 | `readNotificationSummaryMissingUntil` | function | 270 |
| 20 | `markNotificationSummaryMissing` | function | 282 |
| 21 | `clearNotificationSummaryMissing` | function | 297 |
| 22 | `readStorageNumber` | function | 306 |
| 23 | `writeStorageNumber` | function | 322 |
| 24 | `clearStorageNumber` | function | 333 |
| 25 | `buildLocalBootstrap` | const arrow | 410 |
| 26 | `getCategories` | const arrow | 507 |
| 27 | `updateCategory` | const arrow | 509 |
| 28 | `deleteCategory` | const arrow | 510 |
| 29 | `getUnits` | const arrow | 513 |
| 30 | `updateUnit` | const arrow | 515 |
| 31 | `deleteUnit` | const arrow | 516 |
| 32 | `getBranches` | const arrow | 519 |
| 33 | `updateBranch` | const arrow | 521 |
| 34 | `deleteBranch` | const arrow | 525 |
| 35 | `getTransfers` | const arrow | 530 |
| 36 | `getProducts` | const arrow | 534 |
| 37 | `getPortalSubmissionsForReview` | const arrow | 629 |
| 38 | `reviewPortalSubmission` | const arrow | 631 |
| 39 | `getAiProviders` | const arrow | 634 |
| 40 | `createAiProvider` | const arrow | 636 |
| 41 | `updateAiProvider` | const arrow | 638 |
| 42 | `deleteAiProvider` | const arrow | 640 |
| 43 | `testAiProvider` | const arrow | 642 |
| 44 | `getAiResponses` | const arrow | 644 |
| 45 | `deleteProduct` | const arrow | 673 |
| 46 | `buildMultipartHeaders` | function | 690 |
| 47 | `apiFormPost` | function | 703 |
| 48 | `listImportJobs` | const arrow | 722 |
| 49 | `getImportJobReview` | const arrow | 727 |
| 50 | `updateImportJobDecisions` | const arrow | 731 |
| 51 | `deleteImportJob` | const arrow | 737 |
| 52 | `getImportQueueStatus` | const arrow | 756 |
| 53 | `getActionHistory` | const arrow | 983 |
| 54 | `updateActionHistory` | const arrow | 987 |
| 55 | `getInventorySummary` | const arrow | 993 |
| 56 | `getInventoryMovements` | const arrow | 994 |
| 57 | `getSales` | const arrow | 1002 |
| 58 | `getDashboard` | const arrow | 1009 |
| 59 | `getAnalytics` | const arrow | 1010 |
| 60 | `getCustomers` | const arrow | 1019 |
| 61 | `updateCustomer` | const arrow | 1024 |
| 62 | `deleteCustomer` | const arrow | 1028 |
| 63 | `downloadCustomerTemplate` | const arrow | 1033 |
| 64 | `getSuppliers` | const arrow | 1042 |
| 65 | `updateSupplier` | const arrow | 1047 |
| 66 | `deleteSupplier` | const arrow | 1051 |
| 67 | `downloadSupplierTemplate` | const arrow | 1056 |
| 68 | `getDeliveryContacts` | const arrow | 1065 |
| 69 | `updateDeliveryContact` | const arrow | 1070 |
| 70 | `deleteDeliveryContact` | const arrow | 1074 |
| 71 | `getUsers` | const arrow | 1081 |
| 72 | `updateUser` | const arrow | 1083 |
| 73 | `getUserProfile` | const arrow | 1084 |
| 74 | `getUserAuthMethods` | const arrow | 1085 |
| 75 | `updateUserProfile` | const arrow | 1087 |
| 76 | `disconnectUserAuthProvider` | const arrow | 1089 |
| 77 | `changeUserPassword` | const arrow | 1091 |
| 78 | `resetPassword` | const arrow | 1093 |
| 79 | `getRoles` | const arrow | 1096 |
| 80 | `updateRole` | const arrow | 1098 |
| 81 | `deleteRole` | const arrow | 1099 |
| 82 | `getCustomTables` | const arrow | 1102 |
| 83 | `getCustomTableData` | const arrow | 1104 |
| 84 | `insertCustomRow` | const arrow | 1105 |
| 85 | `updateCustomRow` | const arrow | 1106 |
| 86 | `deleteCustomRow` | const arrow | 1107 |
| 87 | `getAuditLogs` | const arrow | 1110 |
| 88 | `getGoogleDriveSyncStatus` | const arrow | 1178 |
| 89 | `saveGoogleDriveSyncPreferences` | const arrow | 1212 |
| 90 | `startGoogleDriveSyncOauth` | const arrow | 1215 |
| 91 | `disconnectGoogleDriveSync` | const arrow | 1218 |
| 92 | `forgetGoogleDriveSyncCredentials` | const arrow | 1221 |
| 93 | `syncGoogleDriveNow` | const arrow | 1224 |
| 94 | `getReturns` | const arrow | 1298 |
| 95 | `updateSaleStatus` | const arrow | 1319 |
| 96 | `attachSaleCustomer` | const arrow | 1335 |
| 97 | `getSalesExport` | const arrow | 1359 |
| 98 | `updateReturn` | const arrow | 1363 |
| 99 | `getDataPath` | const arrow | 1423 |
| 100 | `getScaleMigrationStatus` | const arrow | 1424 |
| 101 | `prepareScaleMigration` | const arrow | 1425 |
| 102 | `runScaleMigration` | const arrow | 1426 |
| 103 | `browseDir` | const arrow | 1437 |

### 3.4 `frontend/src/api/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `shouldDebugWs` | function | 19 |
| 2 | `logWs` | function | 29 |
| 3 | `scheduleReconnect` | function | 141 |

### 3.5 `frontend/src/App.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 37 | `App` | component/function | 618 |
| 38 | `loadFavicon` | function | 676 |

### 3.6 `frontend/src/AppContext.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 18 | `buildRuntimeDescriptorFromBootstrap` | function | 215 |
| 19 | `LoadingScreen` | function | 243 |
| 20 | `AccessDenied` | function | 256 |
| 21 | `onUpdate` | const arrow | 444 |
| 22 | `onStatus` | const arrow | 472 |
| 23 | `poll` | const arrow | 480 |
| 24 | `onError` | const arrow | 500 |
| 25 | `onWriteBlocked` | const arrow | 504 |
| 26 | `onConflict` | const arrow | 515 |
| 27 | `finalizeUnauthorized` | const arrow | 575 |
| 28 | `onUnauthorized` | const arrow | 591 |
| 29 | `handleOtpLogin` | const arrow | 642 |
| 30 | `handleUserUpdated` | const arrow | 682 |
| 31 | `discoverSyncUrl` | const arrow | 716 |
| 32 | `hexAlpha` | const arrow | 861 |
| 33 | `clearCallbackUrl` | const arrow | 1047 |
| 34 | `clearPendingLink` | const arrow | 1051 |
| 35 | `run` | const arrow | 1055 |
| 36 | `useApp` | const arrow | 1362 |
| 37 | `useSync` | const arrow | 1363 |
| 38 | `useT` | const arrow | 1366 |

### 3.7 `frontend/src/components/auth/Login.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readPendingOauthLogin` | function | 27 |
| 2 | `clearPendingOauthLogin` | function | 41 |
| 3 | `OauthButton` | function | 47 |
| 4 | `ModeBackButton` | function | 61 |
| 5 | `Login` | component/function | 74 |
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

### 3.8 `frontend/src/components/branches/Branches.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatTransferDate` | function | 31 |
| 2 | `Branches` | component/function | 48 |
| 3 | `promise` | const arrow | 81 |
| 4 | `loadBranchStock` | const arrow | 186 |
| 5 | `handleSaveBranch` | const arrow | 201 |
| 6 | `handleDelete` | const arrow | 254 |
| 7 | `handleBulkDelete` | const arrow | 287 |
| 8 | `toggleSelect` | const arrow | 355 |
| 9 | `toggleSelectAll` | const arrow | 364 |

### 3.9 `frontend/src/components/branches/BranchForm.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `BranchForm` | component/function | 11 |
| 2 | `set` | const arrow | 33 |
| 3 | `handleSave` | const arrow | 45 |

### 3.10 `frontend/src/components/branches/TransferModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `TransferModal` | component/function | 17 |
| 2 | `loadStock` | function | 61 |
| 3 | `handleTransfer` | const arrow | 106 |

### 3.11 `frontend/src/components/catalog/CatalogPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 35 | `CatalogPage` | component/function | 1513 |
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

### 3.12 `frontend/src/components/catalog/CatalogProductsSection.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBadgeIcon` | function | 8 |
| 2 | `getBadgeToneClass` | function | 16 |
| 3 | `getProductInitial` | function | 25 |
| 4 | `CatalogProductsSection` | component/function | 36 |

### 3.13 `frontend/src/components/catalog/CatalogSecondaryTabs.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `CatalogMembershipSection` | function | 20 |
| 2 | `CatalogAboutSection` | function | 366 |
| 3 | `CatalogFaqSection` | function | 437 |
| 4 | `CatalogAiSection` | function | 491 |
| 5 | `CatalogSecondaryTabs` | component/function | 677 |

### 3.14 `frontend/src/components/catalog/catalogUi.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `statusClass` | function | 3 |

### 3.15 `frontend/src/components/contacts/contactOptionUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeOption` | function | 15 |

### 3.16 `frontend/src/components/contacts/Contacts.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `TABS` | const arrow | 17 |
| 2 | `ImportTypePicker` | function | 23 |
| 3 | `T` | const arrow | 24 |
| 4 | `Contacts` | component/function | 63 |
| 5 | `handleExportAll` | const arrow | 71 |
| 6 | `openImportPicker` | const arrow | 146 |
| 7 | `handleTypeSelected` | const arrow | 148 |
| 8 | `handleImportDone` | const arrow | 153 |

### 3.17 `frontend/src/components/contacts/CustomersTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `tr` | function | 35 |
| 2 | `OptionEditor` | function | 40 |
| 3 | `setField` | const arrow | 41 |
| 4 | `fieldId` | const arrow | 42 |
| 5 | `CustomerForm` | function | 84 |
| 6 | `setField` | const arrow | 96 |
| 7 | `addOption` | const arrow | 97 |
| 8 | `removeOption` | const arrow | 101 |
| 9 | `updateOption` | const arrow | 102 |
| 10 | `handleSubmit` | const arrow | 103 |
| 11 | `CustomersTab` | function | 211 |
| 12 | `toggleSectionCollapsed` | const arrow | 342 |
| 13 | `isSectionFullySelected` | const arrow | 348 |
| 14 | `isSectionPartiallySelected` | const arrow | 349 |
| 15 | `toggleSectionSelection` | const arrow | 350 |
| 16 | `promise` | const arrow | 373 |
| 17 | `handleSave` | const arrow | 438 |
| 18 | `handleDelete` | const arrow | 501 |
| 19 | `handleBulkDelete` | const arrow | 531 |

### 3.18 `frontend/src/components/contacts/DeliveryTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `BLANK_OPTION` | const arrow | 39 |
| 2 | `OptionEditor` | function | 42 |
| 3 | `set` | const arrow | 43 |
| 4 | `fieldId` | const arrow | 44 |
| 5 | `DeliveryForm` | function | 81 |
| 6 | `set` | const arrow | 90 |
| 7 | `addOption` | const arrow | 91 |
| 8 | `updateOption` | const arrow | 95 |
| 9 | `removeOption` | const arrow | 96 |
| 10 | `handleSave` | const arrow | 97 |
| 11 | `OptionsDisplay` | function | 167 |
| 12 | `OptionsBadge` | function | 184 |
| 13 | `DeliveryTab` | function | 195 |
| 14 | `toggleSectionCollapsed` | const arrow | 317 |
| 15 | `isSectionFullySelected` | const arrow | 323 |
| 16 | `isSectionPartiallySelected` | const arrow | 324 |
| 17 | `toggleSectionSelection` | const arrow | 325 |
| 18 | `promise` | const arrow | 346 |
| 19 | `handleSave` | const arrow | 410 |
| 20 | `handleDelete` | const arrow | 460 |
| 21 | `handleBulkDelete` | const arrow | 489 |

### 3.19 `frontend/src/components/contacts/shared.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toggleOne` | const arrow | 30 |
| 2 | `clearSelection` | const arrow | 41 |
| 3 | `menuContent` | const arrow | 76 |
| 4 | `countCsvDataRows` | function | 275 |
| 5 | `loadCsvText` | const arrow | 319 |
| 6 | `handlePickFile` | const arrow | 329 |
| 7 | `handleChooseExistingFile` | const arrow | 335 |
| 8 | `handleDownloadTemplate` | const arrow | 355 |
| 9 | `applyContactRulePreset` | const arrow | 359 |
| 10 | `handleImport` | const arrow | 369 |

### 3.20 `frontend/src/components/contacts/SuppliersTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.21 `frontend/src/components/custom-tables/CustomTables.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeRowValue` | function | 15 |
| 2 | `buildRowPayload` | function | 28 |
| 3 | `CustomTables` | component/function | 37 |
| 4 | `addColumn` | const arrow | 136 |
| 5 | `updateColumn` | const arrow | 143 |
| 6 | `removeColumn` | const arrow | 152 |
| 7 | `handleCreateTable` | const arrow | 159 |
| 8 | `handleSaveRow` | const arrow | 197 |
| 9 | `handleDeleteRow` | const arrow | 269 |
| 10 | `openAddRow` | const arrow | 305 |
| 11 | `openEditRow` | const arrow | 312 |

### 3.22 `frontend/src/components/dashboard/charts/BarChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `BarChart` | component/function | 14 |
| 2 | `yPx` | function | 32 |

### 3.23 `frontend/src/components/dashboard/charts/DonutChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `DonutChart` | component/function | 14 |

### 3.24 `frontend/src/components/dashboard/charts/index.js`

- No top-level named function/class symbols detected.

### 3.25 `frontend/src/components/dashboard/charts/LineChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `LineChart` | component/function | 13 |
| 2 | `xPx` | function | 35 |
| 3 | `yPx` | function | 36 |
| 4 | `handleMouseMove` | const arrow | 41 |

### 3.26 `frontend/src/components/dashboard/charts/NoData.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `NoData` | component/function | 7 |

### 3.27 `frontend/src/components/dashboard/Dashboard.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDashboardFilterStorageKey` | function | 24 |
| 2 | `readDashboardFilterPrefs` | function | 29 |
| 3 | `downsampleChartRows` | function | 53 |
| 4 | `Dashboard` | component/function | 64 |
| 5 | `translateOr` | const arrow | 69 |
| 6 | `calcTrend` | const arrow | 260 |
| 7 | `rangeLabel` | const arrow | 286 |
| 8 | `periodShort` | const arrow | 292 |
| 9 | `buildExportAll` | const arrow | 567 |

### 3.28 `frontend/src/components/dashboard/MiniStat.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `MiniStat` | component/function | 2 |

### 3.29 `frontend/src/components/files/FilePickerModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `AssetPreview` | function | 11 |
| 2 | `FilePickerModal` | component/function | 21 |
| 3 | `tr` | const arrow | 41 |
| 4 | `toggleSelectedPath` | function | 82 |
| 5 | `handleUpload` | function | 92 |
| 6 | `handleDelete` | function | 127 |

### 3.30 `frontend/src/components/files/FilesPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `AssetPreview` | function | 32 |
| 2 | `formatDateTime` | function | 46 |
| 3 | `ProviderStatus` | function | 56 |
| 4 | `emptyProviderForm` | function | 67 |
| 5 | `compactTabLabel` | function | 90 |
| 6 | `FilesPage` | component/function | 96 |
| 7 | `tr` | const arrow | 125 |
| 8 | `handleUpload` | function | 303 |
| 9 | `handleDeleteAsset` | function | 319 |
| 10 | `startCreateProvider` | function | 338 |
| 11 | `startEditProvider` | function | 354 |
| 12 | `saveProvider` | function | 379 |
| 13 | `testProvider` | function | 460 |
| 14 | `removeProvider` | function | 474 |
| 15 | `tabButton` | const arrow | 487 |

### 3.31 `frontend/src/components/inventory/DualMoney.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `DualMoney` | function | 5 |

### 3.32 `frontend/src/components/inventory/Inventory.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `reuseSetWhenUnchanged` | function | 32 |
| 2 | `priceCsv` | function | 41 |
| 3 | `Inventory` | component/function | 45 |
| 4 | `tr` | const arrow | 50 |
| 5 | `promise` | const arrow | 101 |
| 6 | `handleAdjust` | const arrow | 214 |
| 7 | `openAdjust` | const arrow | 278 |
| 8 | `openMove` | const arrow | 284 |
| 9 | `handleMoveStock` | const arrow | 306 |
| 10 | `matchesSearch` | const arrow | 377 |
| 11 | `productHay` | const arrow | 384 |
| 12 | `movHay` | const arrow | 387 |

### 3.33 `frontend/src/components/inventory/InventoryImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `countCsvDataRows` | function | 11 |
| 2 | `InventoryImportModal` | component/function | 16 |
| 3 | `tr` | const arrow | 26 |
| 4 | `handlePickFile` | const arrow | 39 |
| 5 | `handleDownloadTemplate` | const arrow | 47 |
| 6 | `handleImport` | const arrow | 51 |

### 3.34 `frontend/src/components/inventory/movementGroups.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `minuteBucket` | function | 1 |
| 2 | `normalizeText` | function | 8 |
| 3 | `buildGroupKey` | function | 12 |
| 4 | `describeMovementType` | function | 27 |

### 3.35 `frontend/src/components/inventory/ProductDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductDetailModal` | component/function | 5 |
| 2 | `T` | const arrow | 6 |

### 3.36 `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `sanitizeInteger` | function | 108 |
| 2 | `sanitizeKhr` | function | 113 |
| 3 | `formatLookupValue` | function | 119 |
| 4 | `LoyaltyPointsPage` | component/function | 123 |
| 5 | `copy` | const arrow | 127 |
| 6 | `setValue` | function | 216 |
| 7 | `handleSave` | function | 220 |
| 8 | `handleLookup` | function | 245 |

### 3.37 `frontend/src/components/navigation/Sidebar.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getFallbackLabel` | function | 49 |
| 2 | `getNavLabel` | function | 57 |
| 3 | `isDarkColor` | function | 73 |
| 4 | `withAlpha` | function | 83 |
| 5 | `mergeStyles` | function | 89 |
| 6 | `Sidebar` | component/function | 93 |

### 3.38 `frontend/src/components/pos/CartItem.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `CartItem` | component/function | 3 |

### 3.39 `frontend/src/components/pos/FilterPanel.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `POSFilterPanel` | component/function | 3 |
| 2 | `T` | const arrow | 27 |
| 3 | `clearAll` | const arrow | 38 |
| 4 | `chip` | const arrow | 47 |
| 5 | `SectionLabel` | const arrow | 53 |

### 3.40 `frontend/src/components/pos/POS.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `allTermsMatch` | function | 60 |
| 2 | `POS` | component/function | 65 |
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

### 3.41 `frontend/src/components/pos/ProductImage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductImage` | component/function | 3 |

### 3.42 `frontend/src/components/pos/QuickAddModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `QuickAddModal` | component/function | 4 |
| 2 | `T` | const arrow | 5 |

### 3.43 `frontend/src/components/products/BarcodeScannerModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `stopStream` | function | 24 |
| 2 | `readCameraPermissionState` | function | 30 |
| 3 | `watchCameraPermission` | function | 40 |
| 4 | `handleChange` | const arrow | 44 |
| 5 | `BarcodeScannerModal` | component/function | 53 |

### 3.44 `frontend/src/components/products/BranchStockAdjuster.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `BranchStockAdjuster` | component/function | 3 |
| 2 | `T` | const arrow | 20 |
| 3 | `setRow` | const arrow | 26 |
| 4 | `handleSave` | const arrow | 32 |

### 3.45 `frontend/src/components/products/BulkAddStockModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `BulkAddStockModal` | function | 5 |
| 2 | `handleSave` | const arrow | 12 |

### 3.46 `frontend/src/components/products/BulkImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBaseName` | function | 12 |
| 2 | `analyzeProductCsvInWorker` | function | 19 |
| 3 | `cleanup` | const arrow | 26 |
| 4 | `getIncomingImageFilenames` | function | 52 |
| 5 | `getExistingImageFilenames` | function | 85 |
| 6 | `csvEscape` | function | 114 |
| 7 | `buildImageOnlyCsv` | function | 119 |
| 8 | `getBrowserImageEntries` | function | 134 |
| 9 | `BulkImportModal` | component/function | 143 |
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

### 3.47 `frontend/src/components/products/HeaderActions.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductsHeaderActions` | component/function | 5 |
| 2 | `tr` | const arrow | 16 |

### 3.48 `frontend/src/components/products/ManageBrandsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `parseBrandOptions` | function | 5 |
| 2 | `toTitleCase` | function | 18 |
| 3 | `normalizeLookup` | function | 26 |
| 4 | `ManageBrandsModal` | component/function | 30 |
| 5 | `saveLibrary` | const arrow | 63 |
| 6 | `addLibraryBrand` | const arrow | 79 |
| 7 | `renameBrand` | const arrow | 101 |
| 8 | `removeBrand` | const arrow | 146 |

### 3.49 `frontend/src/components/products/ManageCategoriesModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ManageCategoriesModal` | component/function | 13 |
| 2 | `handleAdd` | const arrow | 48 |
| 3 | `handleUpdate` | const arrow | 68 |
| 4 | `handleDelete` | const arrow | 91 |

### 3.50 `frontend/src/components/products/ManageUnitsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ManageUnitsModal` | component/function | 7 |
| 2 | `load` | const arrow | 19 |
| 3 | `handleAdd` | const arrow | 37 |
| 4 | `handleUpdate` | const arrow | 57 |
| 5 | `handleDelete` | const arrow | 76 |

### 3.51 `frontend/src/components/products/primitives.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `sanitizeNumericInput` | function | 7 |
| 2 | `parseNumericInput` | function | 17 |
| 3 | `ProductImg` | function | 23 |
| 4 | `loadImageData` | function | 60 |
| 5 | `ProductImagePlaceholder` | function | 94 |
| 6 | `MarginCard` | function | 102 |
| 7 | `DualPriceInput` | function | 134 |
| 8 | `handleUsdChange` | const arrow | 135 |
| 9 | `handleKhrChange` | const arrow | 136 |

### 3.52 `frontend/src/components/products/ProductDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductDetailModal` | component/function | 6 |
| 2 | `T` | const arrow | 18 |
| 3 | `Row` | const arrow | 33 |

### 3.53 `frontend/src/components/products/ProductForm.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeGallery` | function | 16 |
| 2 | `editablePrice` | function | 32 |
| 3 | `pickImageFiles` | function | 37 |
| 4 | `ProductForm` | component/function | 56 |
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

### 3.54 `frontend/src/components/products/Products.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `multiMatch` | function | 40 |
| 2 | `ThreeDot` | function | 44 |
| 3 | `getScrollContainer` | function | 65 |
| 4 | `scrollNodeWithOffset` | function | 77 |
| 5 | `Products` | component/function | 93 |
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

### 3.55 `frontend/src/components/products/VariantFormModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `VariantFormModal` | component/function | 8 |
| 2 | `tr` | const arrow | 10 |
| 3 | `setField` | const arrow | 36 |
| 4 | `setNumeric` | const arrow | 37 |
| 5 | `handleSave` | const arrow | 39 |

### 3.56 `frontend/src/components/receipt-settings/AllFieldsPanel.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Toggle` | function | 5 |
| 2 | `AllFieldsPanel` | component/function | 21 |
| 3 | `T` | const arrow | 23 |
| 4 | `toggleSection` | const arrow | 42 |

### 3.57 `frontend/src/components/receipt-settings/constants.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `T` | const arrow | 53 |

### 3.58 `frontend/src/components/receipt-settings/ErrorBoundary.jsx`

- No top-level named function/class symbols detected.

### 3.59 `frontend/src/components/receipt-settings/FieldOrderManager.jsx`

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

### 3.60 `frontend/src/components/receipt-settings/PrintSettings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Section` | function | 5 |
| 2 | `buildFallbackPreviewHtml` | function | 17 |
| 3 | `buildSafePreviewSource` | function | 35 |
| 4 | `PrintSettings` | component/function | 46 |
| 5 | `T` | const arrow | 47 |
| 6 | `setValue` | const arrow | 56 |
| 7 | `resetMargins` | const arrow | 64 |
| 8 | `getPreviewSource` | const arrow | 79 |

### 3.61 `frontend/src/components/receipt-settings/ReceiptPreview.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ReceiptPreview` | component/function | 9 |
| 2 | `loadPreview` | function | 20 |

### 3.62 `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Section` | function | 15 |
| 2 | `Toggle` | function | 26 |
| 3 | `ReceiptSettings` | component/function | 41 |
| 4 | `handleSave` | const arrow | 155 |

### 3.63 `frontend/src/components/receipt-settings/template.js`

- No top-level named function/class symbols detected.

### 3.64 `frontend/src/components/receipt/Receipt.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `stripEmoji` | function | 8 |
| 2 | `displayAddress` | function | 13 |
| 3 | `parseItems` | function | 22 |
| 4 | `labelFor` | function | 114 |
| 5 | `Row` | function | 119 |
| 6 | `Receipt` | component/function | 131 |
| 7 | `em` | const arrow | 142 |
| 8 | `exportReceiptPdf` | const arrow | 338 |

### 3.65 `frontend/src/components/returns/EditReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `EditReturnModal` | function | 6 |
| 2 | `T` | const arrow | 8 |
| 3 | `updateQty` | const arrow | 33 |
| 4 | `updateRestock` | const arrow | 36 |
| 5 | `handleSubmit` | const arrow | 44 |

### 3.66 `frontend/src/components/returns/NewReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.67 `frontend/src/components/returns/NewSupplierReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `NewSupplierReturnModal` | component/function | 10 |
| 2 | `tr` | const arrow | 12 |
| 3 | `loadSetup` | function | 45 |
| 4 | `loadInventory` | function | 86 |
| 5 | `updateQty` | const arrow | 150 |
| 6 | `submit` | const arrow | 156 |

### 3.68 `frontend/src/components/returns/ReturnDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeScope` | function | 6 |
| 2 | `ReturnDetailModal` | component/function | 10 |
| 3 | `tr` | const arrow | 12 |

### 3.69 `frontend/src/components/returns/Returns.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeScope` | function | 25 |
| 2 | `getReturnTypeKey` | function | 29 |
| 3 | `getReturnTypeLabel` | function | 35 |
| 4 | `exportReturnRows` | function | 43 |
| 5 | `Returns` | component/function | 61 |
| 6 | `promise` | const arrow | 100 |
| 7 | `handleOpenEdit` | const arrow | 165 |
| 8 | `renderAmount` | const arrow | 443 |

### 3.70 `frontend/src/components/sales/ExportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ExportModal` | component/function | 6 |
| 2 | `tr` | const arrow | 13 |
| 3 | `computeDates` | const arrow | 18 |
| 4 | `validateDates` | const arrow | 37 |
| 5 | `downloadCsvBlob` | const arrow | 45 |
| 6 | `buildCsvFallback` | const arrow | 55 |
| 7 | `escape` | const arrow | 59 |
| 8 | `handlePreview` | const arrow | 80 |
| 9 | `handleExportCSV` | const arrow | 93 |

### 3.71 `frontend/src/components/sales/SaleDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `InfoBlock` | function | 5 |
| 2 | `parseItems` | function | 21 |
| 3 | `SaleDetailModal` | component/function | 31 |
| 4 | `translateOr` | const arrow | 47 |
| 5 | `handleStatusUpdate` | const arrow | 69 |
| 6 | `handleMembershipAttach` | const arrow | 80 |

### 3.72 `frontend/src/components/sales/Sales.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `multiMatch` | function | 25 |
| 2 | `getSaleBranchLabel` | function | 29 |
| 3 | `Sales` | component/function | 37 |
| 4 | `promise` | const arrow | 78 |
| 5 | `handleStatusChange` | const arrow | 144 |
| 6 | `handleAttachMembership` | const arrow | 179 |
| 7 | `toggleSelected` | const arrow | 330 |
| 8 | `toggleSelectAll` | const arrow | 336 |
| 9 | `handleExportSelected` | const arrow | 367 |
| 10 | `handleBulkStatusUpdate` | const arrow | 419 |

### 3.73 `frontend/src/components/sales/SalesImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `countCsvDataRows` | function | 11 |
| 2 | `SalesImportModal` | component/function | 16 |
| 3 | `tr` | const arrow | 26 |
| 4 | `handlePickFile` | const arrow | 39 |
| 5 | `handleDownloadTemplate` | const arrow | 47 |
| 6 | `handleImport` | const arrow | 51 |

### 3.74 `frontend/src/components/sales/StatusBadge.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `StatusBadge` | component/function | 39 |

### 3.75 `frontend/src/components/server/ServerPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `useLocalCopy` | function | 22 |
| 2 | `isAutoDetected` | function | 32 |
| 3 | `StatusRow` | function | 39 |
| 4 | `InfoTab` | function | 51 |
| 5 | `fmt` | const arrow | 116 |
| 6 | `DiagnosticsPanel` | function | 202 |
| 7 | `onErr` | const arrow | 240 |
| 8 | `onQueueChanged` | const arrow | 244 |
| 9 | `handleRetryQueue` | function | 286 |
| 10 | `ServerPage` | component/function | 440 |
| 11 | `check` | const arrow | 466 |
| 12 | `loadSecurityConfig` | const arrow | 492 |
| 13 | `handleTest` | function | 504 |
| 14 | `handleSave` | function | 526 |
| 15 | `handleDisconnect` | function | 533 |

### 3.76 `frontend/src/components/shared/ActionHistoryBar.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatHistoryList` | function | 5 |
| 2 | `formatServerStatus` | function | 9 |
| 3 | `ActionHistoryBar` | component/function | 16 |
| 4 | `T` | const arrow | 26 |

### 3.77 `frontend/src/components/shared/BackgroundImportTracker.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeJobStatus` | function | 11 |
| 2 | `dedupeJobsById` | function | 15 |
| 3 | `isRecent` | function | 27 |
| 4 | `getJobProgressDetails` | function | 33 |
| 5 | `getJobLabel` | function | 87 |
| 6 | `getJobResultSummary` | function | 93 |
| 7 | `add` | const arrow | 96 |
| 8 | `getRowsDisplay` | function | 109 |
| 9 | `buildJobsSignature` | function | 120 |
| 10 | `BackgroundImportTracker` | component/function | 135 |
| 11 | `handleCancel` | const arrow | 228 |
| 12 | `handleRetry` | const arrow | 242 |
| 13 | `handleApprove` | const arrow | 256 |
| 14 | `handleDownloadErrors` | const arrow | 270 |
| 15 | `handleRemove` | const arrow | 282 |

### 3.78 `frontend/src/components/shared/ExportMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ExportMenu` | component/function | 4 |

### 3.79 `frontend/src/components/shared/FilterMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `sectionButtonClass` | function | 4 |
| 2 | `FilterMenu` | component/function | 10 |

### 3.80 `frontend/src/components/shared/ImageGalleryLightbox.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ImageGalleryLightbox` | component/function | 8 |
| 2 | `formatLabel` | function | 30 |
| 3 | `setIndex` | function | 34 |
| 4 | `renderGalleryImage` | function | 40 |
| 5 | `onKeyDown` | function | 47 |

### 3.81 `frontend/src/components/shared/Modal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Modal` | component/function | 10 |

### 3.82 `frontend/src/components/shared/navigationConfig.js`

- No top-level named function/class symbols detected.

### 3.83 `frontend/src/components/shared/NotificationCenter.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `preferenceValue` | function | 103 |
| 2 | `matchesVisibilityMode` | function | 110 |
| 3 | `getRealertMs` | function | 117 |
| 4 | `NotificationCenter` | component/function | 123 |
| 5 | `syncVisibility` | const arrow | 157 |
| 6 | `onVisible` | const arrow | 213 |
| 7 | `handleClickOutside` | const arrow | 236 |

### 3.84 `frontend/src/components/shared/pageActivity.js`

- No top-level named function/class symbols detected.

### 3.85 `frontend/src/components/shared/PageHeader.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PageHeader` | component/function | 9 |

### 3.86 `frontend/src/components/shared/PageHelpButton.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PageHelpButton` | component/function | 6 |

### 3.87 `frontend/src/components/shared/pageHelpContent.js`

- No top-level named function/class symbols detected.

### 3.88 `frontend/src/components/shared/PaginationControls.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PaginationControls` | component/function | 19 |

### 3.89 `frontend/src/components/shared/PortalMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PortalMenu` | component/function | 11 |
| 2 | `closeIfClickedOutside` | const arrow | 63 |
| 3 | `closeMenu` | const arrow | 70 |
| 4 | `scheduleReposition` | const arrow | 71 |
| 5 | `closeIfEscape` | const arrow | 78 |

### 3.90 `frontend/src/components/shared/QuickPreferenceToggles.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ToggleButton` | function | 4 |
| 2 | `QuickPreferenceToggles` | component/function | 23 |
| 3 | `tr` | const arrow | 25 |

### 3.91 `frontend/src/components/shared/WriteConflictModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatConflictTime` | function | 3 |
| 2 | `summarizeCurrentValue` | function | 10 |
| 3 | `formatValue` | function | 66 |
| 4 | `getConflictFieldRows` | function | 73 |
| 5 | `WriteConflictModal` | component/function | 171 |

### 3.92 `frontend/src/components/users/PermissionEditor.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PermissionEditor` | component/function | 15 |
| 2 | `translate` | const arrow | 16 |
| 3 | `labelFor` | const arrow | 22 |
| 4 | `toggle` | const arrow | 25 |

### 3.93 `frontend/src/components/users/UserDetailSheet.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `translateLabel` | function | 4 |
| 2 | `buildRowData` | function | 9 |
| 3 | `UserDetailSheet` | component/function | 21 |

### 3.94 `frontend/src/components/users/UserProfileModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `AvatarPreview` | function | 20 |
| 2 | `ProfileSectionButton` | function | 38 |
| 3 | `clamp` | function | 148 |
| 4 | `loadImageElement` | function | 152 |
| 5 | `renderAvatarCropBlob` | function | 162 |
| 6 | `AvatarEditorModal` | function | 188 |
| 7 | `UserProfileModal` | component/function | 249 |
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

### 3.95 `frontend/src/components/users/Users.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ThreeDot` | function | 32 |
| 2 | `formatContactValue` | function | 67 |
| 3 | `Users` | component/function | 72 |
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

### 3.96 `frontend/src/components/utils-settings/AuditLog.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 11 | `AuditLog` | component/function | 150 |
| 12 | `sessionEntryLabel` | function | 423 |

### 3.97 `frontend/src/components/utils-settings/Backup.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 32 | `Backup` | component/function | 1231 |
| 33 | `loadHostConfig` | function | 1264 |
| 34 | `browseServerFolders` | const arrow | 1278 |
| 35 | `toggleServerBrowser` | const arrow | 1300 |
| 36 | `handleExport` | const arrow | 1314 |
| 37 | `pickFolder` | const arrow | 1335 |
| 38 | `handleFolderExport` | const arrow | 1348 |
| 39 | `handleFolderImport` | const arrow | 1373 |
| 40 | `handleChooseImportFile` | const arrow | 1401 |
| 41 | `handleConfirmImport` | const arrow | 1421 |

### 3.98 `frontend/src/components/utils-settings/FontFamilyPicker.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `FontFamilyPicker` | function | 20 |

### 3.99 `frontend/src/components/utils-settings/index.js`

- No top-level named function/class symbols detected.

### 3.100 `frontend/src/components/utils-settings/OtpModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `OtpModal` | component/function | 12 |
| 2 | `loadSetup` | function | 47 |

### 3.101 `frontend/src/components/utils-settings/ResetData.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ConfirmReset` | function | 6 |
| 2 | `T` | const arrow | 19 |
| 3 | `ResetData` | function | 87 |
| 4 | `T` | const arrow | 89 |
| 5 | `doReset` | const arrow | 116 |
| 6 | `FactoryReset` | function | 181 |
| 7 | `T` | const arrow | 183 |
| 8 | `doFactoryReset` | function | 189 |

### 3.102 `frontend/src/components/utils-settings/Settings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `parseStoredColors` | function | 94 |
| 2 | `buildColorChoices` | function | 105 |
| 3 | `useCopy` | function | 196 |
| 4 | `getSettingsNavLabel` | function | 204 |
| 5 | `SwatchPicker` | function | 221 |
| 6 | `SettingsSection` | function | 304 |
| 7 | `Settings` | component/function | 334 |
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

### 3.103 `frontend/src/constants.js`

- No top-level named function/class symbols detected.

### 3.104 `frontend/src/index.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `disableServiceWorkerCaching` | function | 12 |
| 2 | `cleanup` | const arrow | 15 |
| 3 | `installFormFieldAccessibility` | function | 41 |
| 4 | `escapeSelectorValue` | const arrow | 46 |
| 5 | `wireField` | const arrow | 51 |
| 6 | `scan` | const arrow | 73 |
| 7 | `safeInsertRule` | const function | 111 |
| 8 | `safeCssRulesGetter` | const function | 128 |
| 9 | `stopKnownStartupNoise` | const arrow | 144 |

### 3.105 `frontend/src/platform/runtime/clientRuntime.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `canUseBrowserStorage` | function | 6 |
| 2 | `isBusinessOsStorageKey` | function | 10 |
| 3 | `sanitizeText` | function | 15 |
| 4 | `clearServiceWorkersAndCaches` | function | 102 |
| 5 | `snapshotStorage` | function | 122 |
| 6 | `clearStorage` | function | 135 |
| 7 | `restoreStorage` | function | 148 |

### 3.106 `frontend/src/utils/appRefresh.js`

- No top-level named function/class symbols detected.

### 3.107 `frontend/src/utils/color.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeHex` | function | 1 |
| 2 | `relativeLuminance` | function | 12 |

### 3.108 `frontend/src/utils/csv.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `escapeCsvValue` | function | 6 |
| 2 | `CRC32_TABLE` | const arrow | 46 |
| 3 | `crc32` | function | 58 |
| 4 | `writeUint16` | function | 66 |
| 5 | `writeUint32` | function | 70 |
| 6 | `encodeZipTimestamp` | function | 74 |

### 3.109 `frontend/src/utils/csvImport.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `stripBom` | function | 7 |
| 2 | `normalizeDigit` | function | 11 |
| 3 | `countDelimiter` | function | 26 |
| 4 | `removeCurrencyNoise` | function | 158 |
| 5 | `normalizeNumberSeparators` | function | 165 |

### 3.110 `frontend/src/utils/dateHelpers.js`

- No top-level named function/class symbols detected.

### 3.111 `frontend/src/utils/deviceInfo.js`

- No top-level named function/class symbols detected.

### 3.112 `frontend/src/utils/exportPackage.js`

- No top-level named function/class symbols detected.

### 3.113 `frontend/src/utils/exportReports.jsx`

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

### 3.114 `frontend/src/utils/favicon.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `clamp` | function | 1 |
| 2 | `loadImage` | function | 5 |

### 3.115 `frontend/src/utils/formatters.js`

- No top-level named function/class symbols detected.

### 3.116 `frontend/src/utils/index.js`

- No top-level named function/class symbols detected.

### 3.117 `frontend/src/utils/pricing.js`

- No top-level named function/class symbols detected.

### 3.118 `frontend/src/utils/printReceipt.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 23 | `downloadBlob` | function | 670 |
| 24 | `buildTextOnlyReceiptBlob` | const arrow | 711 |
| 25 | `renderPdfBlob` | const arrow | 725 |
| 26 | `extractReceiptLines` | function | 760 |

### 3.119 `frontend/src/web-api.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getStoredAuthToken` | function | 27 |

### 3.120 `ops/scripts/frontend/verify-i18n.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `collectUsedKeys` | function | 29 |
| 2 | `flattenTranslationTree` | function | 69 |
| 3 | `listMissing` | function | 83 |
| 4 | `listEmptyValues` | function | 88 |
| 5 | `printList` | function | 95 |
| 6 | `main` | function | 102 |

### 3.121 `ops/scripts/frontend/verify-performance.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `read` | function | 15 |
| 2 | `walk` | function | 19 |
| 3 | `trackedFiles` | function | 37 |
| 4 | `assert` | function | 47 |

### 3.122 `ops/scripts/frontend/verify-ui.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.123 `frontend/vite.config.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `fixCrossorigin` | function | 29 |
| 2 | `manualChunks` | function | 54 |

### 3.124 `frontend/postcss.config.mjs`

- No top-level named function/class symbols detected.

### 3.125 `frontend/tailwind.config.mjs`

- No top-level named function/class symbols detected.

