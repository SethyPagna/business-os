# Frontend Function Reference

Auto-generated symbol inventory for frontend files. Regenerate with `node ops/scripts/generate-doc-reference.js`.

## 1. Coverage Summary

Total files documented: **121**

## 2. Symbol Count by File

| No. | File | Symbols |
|---:|---|---:|
| 1 | `frontend/src/api/http.js` | 22 |
| 2 | `frontend/src/api/localDb.js` | 1 |
| 3 | `frontend/src/api/methods.js` | 91 |
| 4 | `frontend/src/api/websocket.js` | 3 |
| 5 | `frontend/src/App.jsx` | 37 |
| 6 | `frontend/src/AppContext.jsx` | 38 |
| 7 | `frontend/src/components/auth/Login.jsx` | 21 |
| 8 | `frontend/src/components/branches/Branches.jsx` | 9 |
| 9 | `frontend/src/components/branches/BranchForm.jsx` | 3 |
| 10 | `frontend/src/components/branches/TransferModal.jsx` | 3 |
| 11 | `frontend/src/components/catalog/CatalogPage.jsx` | 73 |
| 12 | `frontend/src/components/catalog/CatalogProductsSection.jsx` | 1 |
| 13 | `frontend/src/components/catalog/CatalogSecondaryTabs.jsx` | 5 |
| 14 | `frontend/src/components/catalog/catalogUi.jsx` | 1 |
| 15 | `frontend/src/components/contacts/contactOptionUtils.js` | 1 |
| 16 | `frontend/src/components/contacts/Contacts.jsx` | 8 |
| 17 | `frontend/src/components/contacts/CustomersTab.jsx` | 19 |
| 18 | `frontend/src/components/contacts/DeliveryTab.jsx` | 21 |
| 19 | `frontend/src/components/contacts/shared.jsx` | 12 |
| 20 | `frontend/src/components/contacts/SuppliersTab.jsx` | 15 |
| 21 | `frontend/src/components/custom-tables/CustomTables.jsx` | 11 |
| 22 | `frontend/src/components/dashboard/charts/BarChart.jsx` | 2 |
| 23 | `frontend/src/components/dashboard/charts/DonutChart.jsx` | 1 |
| 24 | `frontend/src/components/dashboard/charts/index.js` | 0 |
| 25 | `frontend/src/components/dashboard/charts/LineChart.jsx` | 4 |
| 26 | `frontend/src/components/dashboard/charts/NoData.jsx` | 1 |
| 27 | `frontend/src/components/dashboard/Dashboard.jsx` | 6 |
| 28 | `frontend/src/components/dashboard/MiniStat.jsx` | 1 |
| 29 | `frontend/src/components/files/FilePickerModal.jsx` | 6 |
| 30 | `frontend/src/components/files/FilesPage.jsx` | 15 |
| 31 | `frontend/src/components/inventory/DualMoney.jsx` | 1 |
| 32 | `frontend/src/components/inventory/Inventory.jsx` | 10 |
| 33 | `frontend/src/components/inventory/InventoryImportModal.jsx` | 6 |
| 34 | `frontend/src/components/inventory/movementGroups.js` | 4 |
| 35 | `frontend/src/components/inventory/ProductDetailModal.jsx` | 2 |
| 36 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | 8 |
| 37 | `frontend/src/components/navigation/Sidebar.jsx` | 6 |
| 38 | `frontend/src/components/pos/CartItem.jsx` | 1 |
| 39 | `frontend/src/components/pos/FilterPanel.jsx` | 5 |
| 40 | `frontend/src/components/pos/POS.jsx` | 22 |
| 41 | `frontend/src/components/pos/ProductImage.jsx` | 1 |
| 42 | `frontend/src/components/pos/QuickAddModal.jsx` | 2 |
| 43 | `frontend/src/components/products/BarcodeScannerModal.jsx` | 5 |
| 44 | `frontend/src/components/products/BranchStockAdjuster.jsx` | 4 |
| 45 | `frontend/src/components/products/BulkAddStockModal.jsx` | 2 |
| 46 | `frontend/src/components/products/BulkImportModal.jsx` | 16 |
| 47 | `frontend/src/components/products/HeaderActions.jsx` | 2 |
| 48 | `frontend/src/components/products/ManageBrandsModal.jsx` | 8 |
| 49 | `frontend/src/components/products/ManageCategoriesModal.jsx` | 4 |
| 50 | `frontend/src/components/products/ManageUnitsModal.jsx` | 5 |
| 51 | `frontend/src/components/products/primitives.jsx` | 9 |
| 52 | `frontend/src/components/products/ProductDetailModal.jsx` | 3 |
| 53 | `frontend/src/components/products/ProductForm.jsx` | 18 |
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
| 73 | `frontend/src/components/sales/SalesImportModal.jsx` | 7 |
| 74 | `frontend/src/components/sales/StatusBadge.jsx` | 1 |
| 75 | `frontend/src/components/server/ServerPage.jsx` | 15 |
| 76 | `frontend/src/components/shared/ActionHistoryBar.jsx` | 2 |
| 77 | `frontend/src/components/shared/ExportMenu.jsx` | 1 |
| 78 | `frontend/src/components/shared/FilterMenu.jsx` | 2 |
| 79 | `frontend/src/components/shared/ImageGalleryLightbox.jsx` | 5 |
| 80 | `frontend/src/components/shared/Modal.jsx` | 1 |
| 81 | `frontend/src/components/shared/navigationConfig.js` | 0 |
| 82 | `frontend/src/components/shared/NotificationCenter.jsx` | 6 |
| 83 | `frontend/src/components/shared/pageActivity.js` | 0 |
| 84 | `frontend/src/components/shared/PageHeader.jsx` | 1 |
| 85 | `frontend/src/components/shared/PageHelpButton.jsx` | 1 |
| 86 | `frontend/src/components/shared/pageHelpContent.js` | 0 |
| 87 | `frontend/src/components/shared/PortalMenu.jsx` | 5 |
| 88 | `frontend/src/components/shared/QuickPreferenceToggles.jsx` | 3 |
| 89 | `frontend/src/components/shared/WriteConflictModal.jsx` | 5 |
| 90 | `frontend/src/components/users/PermissionEditor.jsx` | 4 |
| 91 | `frontend/src/components/users/UserDetailSheet.jsx` | 3 |
| 92 | `frontend/src/components/users/UserProfileModal.jsx` | 22 |
| 93 | `frontend/src/components/users/Users.jsx` | 15 |
| 94 | `frontend/src/components/utils-settings/AuditLog.jsx` | 12 |
| 95 | `frontend/src/components/utils-settings/Backup.jsx` | 37 |
| 96 | `frontend/src/components/utils-settings/FontFamilyPicker.jsx` | 1 |
| 97 | `frontend/src/components/utils-settings/index.js` | 0 |
| 98 | `frontend/src/components/utils-settings/OtpModal.jsx` | 2 |
| 99 | `frontend/src/components/utils-settings/ResetData.jsx` | 8 |
| 100 | `frontend/src/components/utils-settings/Settings.jsx` | 20 |
| 101 | `frontend/src/constants.js` | 0 |
| 102 | `frontend/src/index.jsx` | 13 |
| 103 | `frontend/src/platform/runtime/clientRuntime.js` | 7 |
| 104 | `frontend/src/utils/appRefresh.js` | 0 |
| 105 | `frontend/src/utils/color.js` | 2 |
| 106 | `frontend/src/utils/csv.js` | 6 |
| 107 | `frontend/src/utils/csvImport.js` | 0 |
| 108 | `frontend/src/utils/dateHelpers.js` | 0 |
| 109 | `frontend/src/utils/deviceInfo.js` | 0 |
| 110 | `frontend/src/utils/exportPackage.js` | 0 |
| 111 | `frontend/src/utils/exportReports.jsx` | 8 |
| 112 | `frontend/src/utils/favicon.js` | 2 |
| 113 | `frontend/src/utils/formatters.js` | 0 |
| 114 | `frontend/src/utils/index.js` | 0 |
| 115 | `frontend/src/utils/pricing.js` | 0 |
| 116 | `frontend/src/utils/printReceipt.js` | 26 |
| 117 | `frontend/src/web-api.js` | 4 |
| 118 | `ops/scripts/frontend/verify-i18n.js` | 6 |
| 119 | `frontend/vite.config.mjs` | 2 |
| 120 | `frontend/postcss.config.mjs` | 0 |
| 121 | `frontend/tailwind.config.mjs` | 0 |

## 3. Detailed Function Commentary

### 3.1 `frontend/src/api/http.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `hydrateAuthTokenFromStorage` | function | 47 |
| 2 | `readAuthTokenFromStorage` | function | 59 |
| 3 | `logCall` | function | 100 |
| 4 | `getClientMetaHeaders` | function | 108 |
| 5 | `createApiError` | function | 112 |
| 6 | `createWriteBlockedError` | function | 125 |
| 7 | `dispatchWriteBlocked` | function | 135 |
| 8 | `getConflictRefreshChannels` | function | 189 |
| 9 | `dispatchGlobalDataRefresh` | function | 198 |
| 10 | `sleep` | function | 207 |
| 11 | `hasUsableLocalData` | function | 211 |
| 12 | `tryServerReadWithRetry` | function | 218 |
| 13 | `resolveLocalRead` | function | 228 |
| 14 | `parsed` | const arrow | 261 |
| 15 | `isConnectivityError` | function | 305 |
| 16 | `setServerHealth` | function | 326 |
| 17 | `pingServerHealth` | function | 338 |
| 18 | `getChannelRefreshKey` | function | 401 |
| 19 | `emitCacheRefresh` | function | 405 |
| 20 | `clearInflight` | function | 419 |
| 21 | `hasReusableInflight` | function | 424 |
| 22 | `raceServerReadWithLocalFallback` | function | 434 |

### 3.2 `frontend/src/api/localDb.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `splitCSVLine` | function | 231 |

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
| 37 | `getPortalSubmissionsForReview` | const arrow | 621 |
| 38 | `reviewPortalSubmission` | const arrow | 623 |
| 39 | `getAiProviders` | const arrow | 626 |
| 40 | `createAiProvider` | const arrow | 628 |
| 41 | `updateAiProvider` | const arrow | 630 |
| 42 | `deleteAiProvider` | const arrow | 632 |
| 43 | `testAiProvider` | const arrow | 634 |
| 44 | `getAiResponses` | const arrow | 636 |
| 45 | `deleteProduct` | const arrow | 665 |
| 46 | `getInventorySummary` | const arrow | 846 |
| 47 | `getInventoryMovements` | const arrow | 847 |
| 48 | `getSales` | const arrow | 855 |
| 49 | `getDashboard` | const arrow | 862 |
| 50 | `getAnalytics` | const arrow | 863 |
| 51 | `getCustomers` | const arrow | 872 |
| 52 | `updateCustomer` | const arrow | 877 |
| 53 | `deleteCustomer` | const arrow | 881 |
| 54 | `downloadCustomerTemplate` | const arrow | 886 |
| 55 | `getSuppliers` | const arrow | 894 |
| 56 | `updateSupplier` | const arrow | 899 |
| 57 | `deleteSupplier` | const arrow | 903 |
| 58 | `downloadSupplierTemplate` | const arrow | 908 |
| 59 | `getDeliveryContacts` | const arrow | 916 |
| 60 | `updateDeliveryContact` | const arrow | 921 |
| 61 | `deleteDeliveryContact` | const arrow | 925 |
| 62 | `getUsers` | const arrow | 932 |
| 63 | `updateUser` | const arrow | 934 |
| 64 | `getUserProfile` | const arrow | 935 |
| 65 | `getUserAuthMethods` | const arrow | 936 |
| 66 | `updateUserProfile` | const arrow | 938 |
| 67 | `disconnectUserAuthProvider` | const arrow | 940 |
| 68 | `changeUserPassword` | const arrow | 942 |
| 69 | `resetPassword` | const arrow | 944 |
| 70 | `getRoles` | const arrow | 947 |
| 71 | `updateRole` | const arrow | 949 |
| 72 | `deleteRole` | const arrow | 950 |
| 73 | `getCustomTables` | const arrow | 953 |
| 74 | `getCustomTableData` | const arrow | 955 |
| 75 | `insertCustomRow` | const arrow | 956 |
| 76 | `updateCustomRow` | const arrow | 957 |
| 77 | `deleteCustomRow` | const arrow | 958 |
| 78 | `getAuditLogs` | const arrow | 961 |
| 79 | `getGoogleDriveSyncStatus` | const arrow | 1029 |
| 80 | `saveGoogleDriveSyncPreferences` | const arrow | 1063 |
| 81 | `startGoogleDriveSyncOauth` | const arrow | 1066 |
| 82 | `disconnectGoogleDriveSync` | const arrow | 1069 |
| 83 | `forgetGoogleDriveSyncCredentials` | const arrow | 1072 |
| 84 | `syncGoogleDriveNow` | const arrow | 1075 |
| 85 | `getReturns` | const arrow | 1143 |
| 86 | `updateSaleStatus` | const arrow | 1164 |
| 87 | `attachSaleCustomer` | const arrow | 1180 |
| 88 | `getSalesExport` | const arrow | 1204 |
| 89 | `updateReturn` | const arrow | 1208 |
| 90 | `getDataPath` | const arrow | 1268 |
| 91 | `browseDir` | const arrow | 1279 |

### 3.4 `frontend/src/api/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `shouldDebugWs` | function | 19 |
| 2 | `logWs` | function | 29 |
| 3 | `scheduleReconnect` | function | 141 |

### 3.5 `frontend/src/App.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getChunkErrorMessage` | function | 77 |
| 2 | `isChunkLoadError` | function | 82 |
| 3 | `createChunkTimeoutError` | function | 91 |
| 4 | `isRetryableImportError` | function | 97 |
| 5 | `importWithTimeout` | function | 105 |
| 6 | `clearRetryMarker` | function | 121 |
| 7 | `triggerChunkRecoveryReload` | function | 128 |
| 8 | `createChunkReloadStallError` | function | 138 |
| 9 | `shouldRetryChunk` | function | 144 |
| 10 | `lazyWithRetry` | function | 154 |
| 11 | `getWarmupImporters` | function | 221 |
| 12 | `getDataWarmupLoaders` | function | 235 |
| 13 | `createWarmupLoader` | function | 244 |
| 14 | `runWarmupBatches` | function | 249 |
| 15 | `getPageEntryWarmupLoaders` | function | 258 |
| 16 | `useMountedPages` | function | 265 |
| 17 | `useSyncErrorBanner` | function | 279 |
| 18 | `onSyncError` | const arrow | 284 |
| 19 | `onSyncRecovered` | const arrow | 285 |
| 20 | `useVisibilityRecovery` | function | 306 |
| 21 | `onVisible` | const arrow | 310 |
| 22 | `onFocus` | const arrow | 320 |
| 23 | `useChunkWarmup` | function | 338 |
| 24 | `runWarmup` | const arrow | 350 |
| 25 | `useDataWarmup` | function | 379 |
| 26 | `runWarmup` | const arrow | 390 |
| 27 | `usePageEntryWarmup` | function | 415 |
| 28 | `run` | const arrow | 434 |
| 29 | `PageErrorBoundary` | class | 450 |
| 30 | `Notification` | function | 498 |
| 31 | `SyncErrorBanner` | function | 510 |
| 32 | `ReadOnlyServerBanner` | function | 532 |
| 33 | `PageLoader` | function | 540 |
| 34 | `PageSlot` | function | 567 |
| 35 | `PublicCatalogView` | function | 590 |
| 36 | `App` | component/function | 603 |
| 37 | `loadFavicon` | function | 661 |

### 3.6 `frontend/src/AppContext.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `flattenTranslationTree` | function | 24 |
| 2 | `safeStorageGet` | function | 80 |
| 3 | `safeStorageSet` | function | 88 |
| 4 | `safeStorageRemove` | function | 94 |
| 5 | `getStoredAuthToken` | function | 100 |
| 6 | `getStoredUserPayload` | function | 104 |
| 7 | `getStoredUserExpiry` | function | 108 |
| 8 | `clearPersistedAuthState` | function | 112 |
| 9 | `persistAuthState` | function | 122 |
| 10 | `computeSessionExpiryMs` | function | 136 |
| 11 | `readDeviceSettings` | function | 152 |
| 12 | `writeDeviceSettings` | function | 160 |
| 13 | `writeStoredSessionDuration` | function | 166 |
| 14 | `readPendingOauthLink` | function | 174 |
| 15 | `clearPendingOauthLink` | function | 188 |
| 16 | `mergeSettingsWithDeviceOverrides` | function | 194 |
| 17 | `normalizeDateInput` | function | 198 |
| 18 | `buildRuntimeDescriptorFromBootstrap` | function | 214 |
| 19 | `LoadingScreen` | function | 242 |
| 20 | `AccessDenied` | function | 255 |
| 21 | `onUpdate` | const arrow | 443 |
| 22 | `onStatus` | const arrow | 471 |
| 23 | `poll` | const arrow | 479 |
| 24 | `onError` | const arrow | 499 |
| 25 | `onWriteBlocked` | const arrow | 503 |
| 26 | `onConflict` | const arrow | 514 |
| 27 | `finalizeUnauthorized` | const arrow | 574 |
| 28 | `onUnauthorized` | const arrow | 590 |
| 29 | `handleOtpLogin` | const arrow | 638 |
| 30 | `handleUserUpdated` | const arrow | 678 |
| 31 | `discoverSyncUrl` | const arrow | 712 |
| 32 | `hexAlpha` | const arrow | 846 |
| 33 | `clearCallbackUrl` | const arrow | 1032 |
| 34 | `clearPendingLink` | const arrow | 1036 |
| 35 | `run` | const arrow | 1040 |
| 36 | `useApp` | const arrow | 1347 |
| 37 | `useSync` | const arrow | 1348 |
| 38 | `useT` | const arrow | 1351 |

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
| 1 | `formatTransferDate` | function | 25 |
| 2 | `Branches` | component/function | 42 |
| 3 | `load` | const arrow | 66 |
| 4 | `loadBranchStock` | const arrow | 122 |
| 5 | `handleSaveBranch` | const arrow | 137 |
| 6 | `handleDelete` | const arrow | 190 |
| 7 | `handleBulkDelete` | const arrow | 223 |
| 8 | `toggleSelect` | const arrow | 291 |
| 9 | `toggleSelectAll` | const arrow | 300 |

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
| 1 | `getAboutBlockLabel` | function | 54 |
| 2 | `withAssetVersion` | function | 60 |
| 3 | `tt` | function | 741 |
| 4 | `toBoolean` | function | 754 |
| 5 | `toNumber` | function | 761 |
| 6 | `normalizePriceDisplay` | function | 767 |
| 7 | `normalizeHexColor` | function | 772 |
| 8 | `normalizeExternalUrl` | function | 778 |
| 9 | `buildFaqStarterItems` | function | 794 |
| 10 | `buildAiFaqStarterItems` | function | 874 |
| 11 | `hexToRgba` | function | 905 |
| 12 | `readPortalCache` | function | 916 |
| 13 | `writePortalCache` | function | 932 |
| 14 | `normalizePortalPath` | function | 946 |
| 15 | `isReservedPortalPath` | function | 959 |
| 16 | `buildDraft` | function | 964 |
| 17 | `applyDraft` | function | 1048 |
| 18 | `getBranchQty` | function | 1164 |
| 19 | `getStockStatus` | function | 1171 |
| 20 | `normalizeProductGallery` | function | 1181 |
| 21 | `formatDateTime` | function | 1199 |
| 22 | `formatPortalPrice` | function | 1206 |
| 23 | `ImageField` | function | 1219 |
| 24 | `pickImageAsDataUrl` | function | 1285 |
| 25 | `pickMultipleImagesAsDataUrls` | function | 1304 |
| 26 | `replaceVars` | function | 1325 |
| 27 | `applyGoogleTranslateSelection` | function | 1363 |
| 28 | `readStoredTranslateTarget` | function | 1386 |
| 29 | `CatalogPage` | component/function | 1410 |
| 30 | `copy` | const arrow | 1492 |
| 31 | `resolveVisibleTab` | const arrow | 1501 |
| 32 | `loadAssistantStatus` | function | 1590 |
| 33 | `openProductGallery` | function | 1608 |
| 34 | `changeTranslateTarget` | function | 1621 |
| 35 | `isPortalLoadCurrent` | function | 1637 |
| 36 | `loadPortalEditorData` | function | 1641 |
| 37 | `refreshPortalView` | function | 1670 |
| 38 | `loadPortal` | function | 1699 |
| 39 | `initWidget` | const arrow | 1894 |
| 40 | `waitForWidget` | const arrow | 1912 |
| 41 | `toggleFilterValue` | function | 2021 |
| 42 | `clearPortalFilters` | function | 2029 |
| 43 | `setDraft` | function | 2036 |
| 44 | `openPortalImage` | function | 2041 |
| 45 | `setAboutBlocksDraft` | function | 2052 |
| 46 | `updateAboutBlock` | function | 2056 |
| 47 | `addAboutBlock` | function | 2062 |
| 48 | `moveAboutBlockBefore` | function | 2066 |
| 49 | `removeAboutBlock` | function | 2078 |
| 50 | `setFaqDraft` | function | 2082 |
| 51 | `addFaqItem` | function | 2086 |
| 52 | `mergeFaqStarterItems` | function | 2097 |
| 53 | `addFaqStarterSet` | function | 2110 |
| 54 | `addAiFaqStarterSet` | function | 2114 |
| 55 | `updateFaqItem` | function | 2118 |
| 56 | `removeFaqItem` | function | 2124 |
| 57 | `clearAssistantState` | function | 2128 |
| 58 | `uploadPortalImage` | function | 2143 |
| 59 | `uploadDraftImage` | function | 2162 |
| 60 | `uploadAboutBlockMedia` | function | 2167 |
| 61 | `openFilePicker` | function | 2176 |
| 62 | `handleFilePickerSelect` | function | 2180 |
| 63 | `savePortalDraft` | function | 2196 |
| 64 | `askAssistant` | function | 2316 |
| 65 | `refreshMembershipData` | function | 2360 |
| 66 | `handleMembershipLookup` | function | 2404 |
| 67 | `addSubmissionImages` | function | 2417 |
| 68 | `handleSubmissionPaste` | function | 2427 |
| 69 | `handleSubmitShareProof` | function | 2443 |
| 70 | `handleReviewSubmission` | function | 2487 |
| 71 | `renderCatalogSection` | function | 2617 |
| 72 | `handleUploadSubmissionImages` | const arrow | 2634 |
| 73 | `renderSecondaryTabSection` | function | 2686 |

### 3.12 `frontend/src/components/catalog/CatalogProductsSection.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `CatalogProductsSection` | component/function | 10 |

### 3.13 `frontend/src/components/catalog/CatalogSecondaryTabs.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `CatalogMembershipSection` | function | 20 |
| 2 | `CatalogAboutSection` | function | 366 |
| 3 | `CatalogFaqSection` | function | 437 |
| 4 | `CatalogAiSection` | function | 491 |
| 5 | `CatalogSecondaryTabs` | component/function | 670 |

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
| 1 | `tr` | function | 34 |
| 2 | `OptionEditor` | function | 39 |
| 3 | `setField` | const arrow | 40 |
| 4 | `fieldId` | const arrow | 41 |
| 5 | `CustomerForm` | function | 83 |
| 6 | `setField` | const arrow | 95 |
| 7 | `addOption` | const arrow | 96 |
| 8 | `removeOption` | const arrow | 100 |
| 9 | `updateOption` | const arrow | 101 |
| 10 | `handleSubmit` | const arrow | 102 |
| 11 | `CustomersTab` | function | 210 |
| 12 | `toggleSectionCollapsed` | const arrow | 323 |
| 13 | `isSectionFullySelected` | const arrow | 329 |
| 14 | `isSectionPartiallySelected` | const arrow | 330 |
| 15 | `toggleSectionSelection` | const arrow | 331 |
| 16 | `promise` | const arrow | 354 |
| 17 | `handleSave` | const arrow | 419 |
| 18 | `handleDelete` | const arrow | 482 |
| 19 | `handleBulkDelete` | const arrow | 512 |

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
| 14 | `toggleSectionCollapsed` | const arrow | 300 |
| 15 | `isSectionFullySelected` | const arrow | 306 |
| 16 | `isSectionPartiallySelected` | const arrow | 307 |
| 17 | `toggleSectionSelection` | const arrow | 308 |
| 18 | `promise` | const arrow | 329 |
| 19 | `handleSave` | const arrow | 393 |
| 20 | `handleDelete` | const arrow | 443 |
| 21 | `handleBulkDelete` | const arrow | 472 |

### 3.19 `frontend/src/components/contacts/shared.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toggleOne` | const arrow | 29 |
| 2 | `clearSelection` | const arrow | 40 |
| 3 | `menuContent` | const arrow | 75 |
| 4 | `parseCsvText` | function | 248 |
| 5 | `analyzeCsv` | const arrow | 329 |
| 6 | `handlePickFile` | const arrow | 371 |
| 7 | `handleChooseExistingFile` | const arrow | 377 |
| 8 | `handleDownloadTemplate` | const arrow | 397 |
| 9 | `toggleConflictSelection` | const arrow | 401 |
| 10 | `applyModeToSelected` | const arrow | 410 |
| 11 | `toggleSelectAllConflicts` | const arrow | 420 |
| 12 | `handleImport` | const arrow | 428 |

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
| 8 | `toggleSectionCollapsed` | const arrow | 254 |
| 9 | `isSectionFullySelected` | const arrow | 260 |
| 10 | `isSectionPartiallySelected` | const arrow | 261 |
| 11 | `toggleSectionSelection` | const arrow | 262 |
| 12 | `promise` | const arrow | 285 |
| 13 | `handleSave` | const arrow | 350 |
| 14 | `handleDelete` | const arrow | 405 |
| 15 | `handleBulkDelete` | const arrow | 435 |

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
| 2 | `xPx` | function | 29 |
| 3 | `yPx` | function | 30 |
| 4 | `handleMouseMove` | const arrow | 35 |

### 3.26 `frontend/src/components/dashboard/charts/NoData.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `NoData` | component/function | 7 |

### 3.27 `frontend/src/components/dashboard/Dashboard.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Dashboard` | component/function | 20 |
| 2 | `translateOr` | const arrow | 25 |
| 3 | `calcTrend` | const arrow | 180 |
| 4 | `rangeLabel` | const arrow | 205 |
| 5 | `periodShort` | const arrow | 211 |
| 6 | `buildExportAll` | const arrow | 475 |

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
| 1 | `reuseSetWhenUnchanged` | function | 30 |
| 2 | `priceCsv` | function | 39 |
| 3 | `Inventory` | component/function | 43 |
| 4 | `tr` | const arrow | 47 |
| 5 | `promise` | const arrow | 92 |
| 6 | `handleAdjust` | const arrow | 199 |
| 7 | `openAdjust` | const arrow | 263 |
| 8 | `matchesSearch` | const arrow | 276 |
| 9 | `productHay` | const arrow | 283 |
| 10 | `movHay` | const arrow | 286 |

### 3.33 `frontend/src/components/inventory/InventoryImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeAction` | function | 12 |
| 2 | `InventoryImportModal` | component/function | 19 |
| 3 | `tr` | const arrow | 29 |
| 4 | `handlePickFile` | const arrow | 42 |
| 5 | `handleDownloadTemplate` | const arrow | 50 |
| 6 | `handleImport` | const arrow | 54 |

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
| 1 | `ProductDetailModal` | component/function | 4 |
| 2 | `T` | const arrow | 5 |

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
| 2 | `T` | const arrow | 25 |
| 3 | `clearAll` | const arrow | 35 |
| 4 | `chip` | const arrow | 43 |
| 5 | `SectionLabel` | const arrow | 49 |

### 3.40 `frontend/src/components/pos/POS.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `allTermsMatch` | function | 59 |
| 2 | `POS` | component/function | 64 |
| 3 | `setQuickFilter` | const arrow | 103 |
| 4 | `addNewOrder` | const arrow | 168 |
| 5 | `closeOrder` | const arrow | 180 |
| 6 | `selectCustomer` | const arrow | 440 |
| 7 | `applyCustomerOption` | const arrow | 488 |
| 8 | `clearCustomer` | const arrow | 502 |
| 9 | `handleAddCustomer` | const arrow | 510 |
| 10 | `selectDelivery` | const arrow | 531 |
| 11 | `clearDelivery` | const arrow | 536 |
| 12 | `handleAddDelivery` | const arrow | 538 |
| 13 | `filteredProducts` | const arrow | 585 |
| 14 | `qty` | const arrow | 614 |
| 15 | `addToCart` | const arrow | 751 |
| 16 | `updateQty` | const arrow | 790 |
| 17 | `updatePrice` | const arrow | 798 |
| 18 | `updateItemBranch` | const arrow | 822 |
| 19 | `handleDiscountUsd` | const arrow | 871 |
| 20 | `handleDiscountKhr` | const arrow | 872 |
| 21 | `handleMembershipUnits` | const arrow | 873 |
| 22 | `handleCheckout` | const arrow | 912 |

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
| 2 | `parseCSVContent` | function | 19 |
| 3 | `getIncomingImageFilenames` | function | 39 |
| 4 | `getExistingImageFilenames` | function | 72 |
| 5 | `BulkImportModal` | component/function | 90 |
| 6 | `T` | const arrow | 107 |
| 7 | `resetCsvState` | const arrow | 109 |
| 8 | `pickImageDirectory` | const arrow | 120 |
| 9 | `addLibraryImages` | const arrow | 149 |
| 10 | `handleImageOnlyImport` | const arrow | 165 |
| 11 | `handlePickCSV` | const arrow | 187 |
| 12 | `handleImport` | const arrow | 262 |
| 13 | `toggleConflictSelection` | const arrow | 295 |
| 14 | `toggleSelectAllConflicts` | const arrow | 304 |
| 15 | `applyDecisionToSelection` | const arrow | 312 |
| 16 | `applyImageDecisionToSelection` | const arrow | 322 |

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
| 1 | `ProductDetailModal` | component/function | 5 |
| 2 | `T` | const arrow | 17 |
| 3 | `Row` | const arrow | 31 |

### 3.53 `frontend/src/components/products/ProductForm.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeGallery` | function | 17 |
| 2 | `editablePrice` | function | 33 |
| 3 | `pickImageFiles` | function | 38 |
| 4 | `readFileAsDataUrl` | function | 57 |
| 5 | `ProductForm` | component/function | 66 |
| 6 | `tr` | const arrow | 138 |
| 7 | `loadSuppliers` | function | 171 |
| 8 | `setField` | function | 191 |
| 9 | `setNumericField` | function | 195 |
| 10 | `addImages` | function | 199 |
| 11 | `addPhoto` | function | 204 |
| 12 | `uploadPickedImages` | function | 209 |
| 13 | `removeImage` | function | 232 |
| 14 | `setPrimaryImage` | function | 236 |
| 15 | `saveForm` | function | 246 |
| 16 | `openScanner` | function | 284 |
| 17 | `closeScanner` | function | 306 |
| 18 | `applyScannedValue` | function | 310 |

### 3.54 `frontend/src/components/products/Products.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `multiMatch` | function | 38 |
| 2 | `ThreeDot` | function | 42 |
| 3 | `getScrollContainer` | function | 63 |
| 4 | `scrollNodeWithOffset` | function | 75 |
| 5 | `Products` | component/function | 91 |
| 6 | `promise` | const arrow | 143 |
| 7 | `handleSave` | const arrow | 228 |
| 8 | `normalizeGallery` | const arrow | 249 |
| 9 | `uploadGalleryImages` | const arrow | 265 |
| 10 | `handleSaveWithGallery` | const arrow | 287 |
| 11 | `handleBulkDelete` | const arrow | 351 |
| 12 | `handleBulkOutOfStock` | const arrow | 399 |
| 13 | `handleBulkChangeBranch` | const arrow | 442 |
| 14 | `handleBulkAddStock` | const arrow | 472 |
| 15 | `toggleSelect` | const arrow | 480 |
| 16 | `toggleSelectAll` | const arrow | 487 |
| 17 | `handleDelete` | const arrow | 494 |
| 18 | `resolveImageUrl` | const arrow | 539 |
| 19 | `getProductGallery` | const arrow | 550 |
| 20 | `renderUnitChip` | const arrow | 551 |
| 21 | `openLightbox` | const arrow | 565 |
| 22 | `getStockBadge` | const arrow | 576 |
| 23 | `toImageName` | const arrow | 617 |
| 24 | `toImageUrl` | const arrow | 618 |
| 25 | `priceCsv` | const arrow | 619 |

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
| 1 | `normalizeScope` | function | 24 |
| 2 | `getReturnTypeKey` | function | 28 |
| 3 | `getReturnTypeLabel` | function | 34 |
| 4 | `exportReturnRows` | function | 42 |
| 5 | `Returns` | component/function | 60 |
| 6 | `promise` | const arrow | 97 |
| 7 | `handleOpenEdit` | const arrow | 162 |
| 8 | `renderAmount` | const arrow | 414 |

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
| 1 | `multiMatch` | function | 24 |
| 2 | `getSaleBranchLabel` | function | 28 |
| 3 | `Sales` | component/function | 36 |
| 4 | `promise` | const arrow | 76 |
| 5 | `handleStatusChange` | const arrow | 141 |
| 6 | `handleAttachMembership` | const arrow | 176 |
| 7 | `toggleSelected` | const arrow | 327 |
| 8 | `toggleSelectAll` | const arrow | 333 |
| 9 | `handleExportSelected` | const arrow | 364 |
| 10 | `handleBulkStatusUpdate` | const arrow | 416 |

### 3.73 `frontend/src/components/sales/SalesImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeBranchMap` | function | 12 |
| 2 | `findProduct` | function | 23 |
| 3 | `SalesImportModal` | component/function | 33 |
| 4 | `tr` | const arrow | 43 |
| 5 | `handlePickFile` | const arrow | 56 |
| 6 | `handleDownloadTemplate` | const arrow | 64 |
| 7 | `handleImport` | const arrow | 68 |

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
| 1 | `formatHistoryList` | function | 3 |
| 2 | `ActionHistoryBar` | component/function | 7 |

### 3.77 `frontend/src/components/shared/ExportMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ExportMenu` | component/function | 4 |

### 3.78 `frontend/src/components/shared/FilterMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `sectionButtonClass` | function | 4 |
| 2 | `FilterMenu` | component/function | 10 |

### 3.79 `frontend/src/components/shared/ImageGalleryLightbox.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ImageGalleryLightbox` | component/function | 8 |
| 2 | `formatLabel` | function | 30 |
| 3 | `setIndex` | function | 34 |
| 4 | `renderGalleryImage` | function | 40 |
| 5 | `onKeyDown` | function | 47 |

### 3.80 `frontend/src/components/shared/Modal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Modal` | component/function | 10 |

### 3.81 `frontend/src/components/shared/navigationConfig.js`

- No top-level named function/class symbols detected.

### 3.82 `frontend/src/components/shared/NotificationCenter.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `preferenceValue` | function | 99 |
| 2 | `matchesVisibilityMode` | function | 106 |
| 3 | `NotificationCenter` | component/function | 113 |
| 4 | `syncVisibility` | const arrow | 142 |
| 5 | `onVisible` | const arrow | 198 |
| 6 | `handleClickOutside` | const arrow | 221 |

### 3.83 `frontend/src/components/shared/pageActivity.js`

- No top-level named function/class symbols detected.

### 3.84 `frontend/src/components/shared/PageHeader.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PageHeader` | component/function | 9 |

### 3.85 `frontend/src/components/shared/PageHelpButton.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PageHelpButton` | component/function | 6 |

### 3.86 `frontend/src/components/shared/pageHelpContent.js`

- No top-level named function/class symbols detected.

### 3.87 `frontend/src/components/shared/PortalMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PortalMenu` | component/function | 11 |
| 2 | `closeIfClickedOutside` | const arrow | 63 |
| 3 | `closeMenu` | const arrow | 70 |
| 4 | `scheduleReposition` | const arrow | 71 |
| 5 | `closeIfEscape` | const arrow | 78 |

### 3.88 `frontend/src/components/shared/QuickPreferenceToggles.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ToggleButton` | function | 4 |
| 2 | `QuickPreferenceToggles` | component/function | 23 |
| 3 | `tr` | const arrow | 25 |

### 3.89 `frontend/src/components/shared/WriteConflictModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatConflictTime` | function | 3 |
| 2 | `summarizeCurrentValue` | function | 10 |
| 3 | `formatValue` | function | 66 |
| 4 | `getConflictFieldRows` | function | 73 |
| 5 | `WriteConflictModal` | component/function | 171 |

### 3.90 `frontend/src/components/users/PermissionEditor.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PermissionEditor` | component/function | 15 |
| 2 | `translate` | const arrow | 16 |
| 3 | `labelFor` | const arrow | 22 |
| 4 | `toggle` | const arrow | 25 |

### 3.91 `frontend/src/components/users/UserDetailSheet.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `translateLabel` | function | 4 |
| 2 | `buildRowData` | function | 9 |
| 3 | `UserDetailSheet` | component/function | 21 |

### 3.92 `frontend/src/components/users/UserProfileModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `AvatarPreview` | function | 18 |
| 2 | `ProfileSectionButton` | function | 36 |
| 3 | `clamp` | function | 146 |
| 4 | `readFileAsDataUrl` | function | 150 |
| 5 | `loadImageElement` | function | 159 |
| 6 | `renderAvatarCropBlob` | function | 169 |
| 7 | `AvatarEditorModal` | function | 195 |
| 8 | `UserProfileModal` | component/function | 256 |
| 9 | `tr` | const arrow | 259 |
| 10 | `loadProfile` | const arrow | 326 |
| 11 | `handleProfileSave` | const arrow | 389 |
| 12 | `handlePasswordSave` | const arrow | 443 |
| 13 | `handleSessionSave` | const arrow | 472 |
| 14 | `refreshOtpState` | const arrow | 479 |
| 15 | `handleAvatarPick` | const arrow | 485 |
| 16 | `resetAvatarEditor` | const arrow | 487 |
| 17 | `openAvatarEditor` | const arrow | 493 |
| 18 | `closeAvatarEditor` | const arrow | 501 |
| 19 | `handleStartOauthLink` | const arrow | 507 |
| 20 | `handleDisconnectOauthProvider` | const arrow | 543 |
| 21 | `handleAvatarSelected` | const arrow | 584 |
| 22 | `saveAvatarFromEditor` | const arrow | 600 |

### 3.93 `frontend/src/components/users/Users.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ThreeDot` | function | 31 |
| 2 | `formatContactValue` | function | 66 |
| 3 | `Users` | component/function | 71 |
| 4 | `canManageTargetUser` | const arrow | 109 |
| 5 | `promise` | const arrow | 121 |
| 6 | `openCreateUser` | const arrow | 236 |
| 7 | `openEditUser` | const arrow | 243 |
| 8 | `openCreateRole` | const arrow | 260 |
| 9 | `openEditRole` | const arrow | 267 |
| 10 | `getRolePermissions` | const arrow | 278 |
| 11 | `getPermissionSummary` | const arrow | 287 |
| 12 | `handleSaveUser` | const arrow | 325 |
| 13 | `handleResetPassword` | const arrow | 393 |
| 14 | `handleSaveRole` | const arrow | 445 |
| 15 | `handleDeleteRole` | const arrow | 518 |

### 3.94 `frontend/src/components/utils-settings/AuditLog.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toIso` | function | 41 |
| 2 | `formatDateTime` | function | 47 |
| 3 | `formatLogTime` | function | 65 |
| 4 | `getLogEpoch` | function | 69 |
| 5 | `formatJsonPretty` | function | 76 |
| 6 | `parseLogJson` | function | 84 |
| 7 | `flattenSummaryValue` | function | 92 |
| 8 | `formatEntityName` | function | 111 |
| 9 | `readableSummary` | function | 117 |
| 10 | `DetailRow` | function | 137 |
| 11 | `AuditLog` | component/function | 149 |
| 12 | `sessionEntryLabel` | function | 416 |

### 3.95 `frontend/src/components/utils-settings/Backup.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PathActionButton` | function | 74 |
| 2 | `PrimaryActionButton` | function | 86 |
| 3 | `useCopy` | function | 98 |
| 4 | `buildPathCrumbs` | function | 108 |
| 5 | `buildFinalDataFolderPath` | function | 126 |
| 6 | `formatDateTime` | function | 139 |
| 7 | `formatBytes` | function | 154 |
| 8 | `countBackupRows` | function | 163 |
| 9 | `buildBackupPreview` | function | 173 |
| 10 | `SectionChip` | function | 215 |
| 11 | `FolderBrowserPanel` | function | 230 |
| 12 | `DataFolderLocation` | function | 343 |
| 13 | `openBrowser` | const arrow | 399 |
| 14 | `openDriveBrowser` | const arrow | 411 |
| 15 | `pickFolderNatively` | const arrow | 415 |
| 16 | `openInlinePicker` | const arrow | 442 |
| 17 | `openInExplorer` | const arrow | 450 |
| 18 | `selectDir` | const arrow | 465 |
| 19 | `handleApply` | const arrow | 471 |
| 20 | `handleReset` | const arrow | 492 |
| 21 | `GoogleDriveSyncSection` | function | 628 |
| 22 | `handler` | const arrow | 730 |
| 23 | `savePreferences` | const arrow | 746 |
| 24 | `connectGoogleDrive` | const arrow | 765 |
| 25 | `syncNow` | const arrow | 799 |
| 26 | `disconnect` | const arrow | 816 |
| 27 | `forgetCredentials` | const arrow | 831 |
| 28 | `Backup` | component/function | 993 |
| 29 | `loadHostConfig` | function | 1025 |
| 30 | `browseServerFolders` | const arrow | 1039 |
| 31 | `toggleServerBrowser` | const arrow | 1061 |
| 32 | `handleExport` | const arrow | 1075 |
| 33 | `pickFolder` | const arrow | 1088 |
| 34 | `handleFolderExport` | const arrow | 1101 |
| 35 | `handleFolderImport` | const arrow | 1119 |
| 36 | `handleChooseImportFile` | const arrow | 1140 |
| 37 | `handleConfirmImport` | const arrow | 1156 |

### 3.96 `frontend/src/components/utils-settings/FontFamilyPicker.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `FontFamilyPicker` | function | 20 |

### 3.97 `frontend/src/components/utils-settings/index.js`

- No top-level named function/class symbols detected.

### 3.98 `frontend/src/components/utils-settings/OtpModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `OtpModal` | component/function | 12 |
| 2 | `loadSetup` | function | 47 |

### 3.99 `frontend/src/components/utils-settings/ResetData.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ConfirmReset` | function | 6 |
| 2 | `T` | const arrow | 19 |
| 3 | `ResetData` | function | 87 |
| 4 | `T` | const arrow | 89 |
| 5 | `doReset` | const arrow | 116 |
| 6 | `FactoryReset` | function | 174 |
| 7 | `T` | const arrow | 176 |
| 8 | `doFactoryReset` | function | 182 |

### 3.100 `frontend/src/components/utils-settings/Settings.jsx`

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

### 3.101 `frontend/src/constants.js`

- No top-level named function/class symbols detected.

### 3.102 `frontend/src/index.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.103 `frontend/src/platform/runtime/clientRuntime.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `canUseBrowserStorage` | function | 6 |
| 2 | `isBusinessOsStorageKey` | function | 10 |
| 3 | `sanitizeText` | function | 15 |
| 4 | `clearServiceWorkersAndCaches` | function | 102 |
| 5 | `snapshotStorage` | function | 122 |
| 6 | `clearStorage` | function | 135 |
| 7 | `restoreStorage` | function | 148 |

### 3.104 `frontend/src/utils/appRefresh.js`

- No top-level named function/class symbols detected.

### 3.105 `frontend/src/utils/color.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeHex` | function | 1 |
| 2 | `relativeLuminance` | function | 12 |

### 3.106 `frontend/src/utils/csv.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `escapeCsvValue` | function | 4 |
| 2 | `CRC32_TABLE` | const arrow | 44 |
| 3 | `crc32` | function | 56 |
| 4 | `writeUint16` | function | 64 |
| 5 | `writeUint32` | function | 68 |
| 6 | `encodeZipTimestamp` | function | 72 |

### 3.107 `frontend/src/utils/csvImport.js`

- No top-level named function/class symbols detected.

### 3.108 `frontend/src/utils/dateHelpers.js`

- No top-level named function/class symbols detected.

### 3.109 `frontend/src/utils/deviceInfo.js`

- No top-level named function/class symbols detected.

### 3.110 `frontend/src/utils/exportPackage.js`

- No top-level named function/class symbols detected.

### 3.111 `frontend/src/utils/exportReports.jsx`

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

### 3.112 `frontend/src/utils/favicon.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `clamp` | function | 1 |
| 2 | `loadImage` | function | 5 |

### 3.113 `frontend/src/utils/formatters.js`

- No top-level named function/class symbols detected.

### 3.114 `frontend/src/utils/index.js`

- No top-level named function/class symbols detected.

### 3.115 `frontend/src/utils/pricing.js`

- No top-level named function/class symbols detected.

### 3.116 `frontend/src/utils/printReceipt.js`

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

### 3.117 `frontend/src/web-api.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getStoredAuthToken` | function | 23 |
| 2 | `hasExtensionSource` | const arrow | 49 |
| 3 | `isLikelyInjectedBundle` | const arrow | 50 |
| 4 | `isSuppressedRuntimeMessage` | const arrow | 57 |

### 3.118 `ops/scripts/frontend/verify-i18n.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `collectUsedKeys` | function | 29 |
| 2 | `flattenTranslationTree` | function | 69 |
| 3 | `listMissing` | function | 83 |
| 4 | `listEmptyValues` | function | 88 |
| 5 | `printList` | function | 95 |
| 6 | `main` | function | 102 |

### 3.119 `frontend/vite.config.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `fixCrossorigin` | function | 29 |
| 2 | `manualChunks` | function | 54 |

### 3.120 `frontend/postcss.config.mjs`

- No top-level named function/class symbols detected.

### 3.121 `frontend/tailwind.config.mjs`

- No top-level named function/class symbols detected.

