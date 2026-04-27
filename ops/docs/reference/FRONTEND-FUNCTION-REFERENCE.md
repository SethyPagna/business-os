# Frontend Function Reference

Auto-generated symbol inventory for frontend files. Regenerate with `node ops/scripts/generate-doc-reference.js`.

## 1. Coverage Summary

Total files documented: **102**

## 2. Symbol Count by File

| No. | File | Symbols |
|---:|---|---:|
| 1 | `frontend/src/api/http.js` | 6 |
| 2 | `frontend/src/api/localDb.js` | 1 |
| 3 | `frontend/src/api/methods.js` | 68 |
| 4 | `frontend/src/api/websocket.js` | 1 |
| 5 | `frontend/src/App.jsx` | 26 |
| 6 | `frontend/src/AppContext.jsx` | 21 |
| 7 | `frontend/src/components/auth/Login.jsx` | 19 |
| 8 | `frontend/src/components/branches/Branches.jsx` | 9 |
| 9 | `frontend/src/components/branches/BranchForm.jsx` | 3 |
| 10 | `frontend/src/components/branches/TransferModal.jsx` | 3 |
| 11 | `frontend/src/components/catalog/CatalogPage.jsx` | 67 |
| 12 | `frontend/src/components/contacts/Contacts.jsx` | 8 |
| 13 | `frontend/src/components/contacts/CustomersTab.jsx` | 15 |
| 14 | `frontend/src/components/contacts/DeliveryTab.jsx` | 12 |
| 15 | `frontend/src/components/contacts/shared.jsx` | 6 |
| 16 | `frontend/src/components/contacts/SuppliersTab.jsx` | 6 |
| 17 | `frontend/src/components/custom-tables/CustomTables.jsx` | 10 |
| 18 | `frontend/src/components/dashboard/charts/BarChart.jsx` | 2 |
| 19 | `frontend/src/components/dashboard/charts/DonutChart.jsx` | 1 |
| 20 | `frontend/src/components/dashboard/charts/index.js` | 0 |
| 21 | `frontend/src/components/dashboard/charts/LineChart.jsx` | 4 |
| 22 | `frontend/src/components/dashboard/charts/NoData.jsx` | 1 |
| 23 | `frontend/src/components/dashboard/Dashboard.jsx` | 6 |
| 24 | `frontend/src/components/dashboard/MiniStat.jsx` | 1 |
| 25 | `frontend/src/components/files/FilePickerModal.jsx` | 7 |
| 26 | `frontend/src/components/files/FilesPage.jsx` | 18 |
| 27 | `frontend/src/components/inventory/DualMoney.jsx` | 1 |
| 28 | `frontend/src/components/inventory/Inventory.jsx` | 6 |
| 29 | `frontend/src/components/inventory/movementGroups.js` | 4 |
| 30 | `frontend/src/components/inventory/ProductDetailModal.jsx` | 2 |
| 31 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | 9 |
| 32 | `frontend/src/components/navigation/Sidebar.jsx` | 6 |
| 33 | `frontend/src/components/pos/CartItem.jsx` | 1 |
| 34 | `frontend/src/components/pos/FilterPanel.jsx` | 5 |
| 35 | `frontend/src/components/pos/POS.jsx` | 24 |
| 36 | `frontend/src/components/pos/ProductImage.jsx` | 1 |
| 37 | `frontend/src/components/pos/QuickAddModal.jsx` | 2 |
| 38 | `frontend/src/components/products/BranchStockAdjuster.jsx` | 3 |
| 39 | `frontend/src/components/products/BulkAddStockModal.jsx` | 2 |
| 40 | `frontend/src/components/products/BulkImportModal.jsx` | 12 |
| 41 | `frontend/src/components/products/HeaderActions.jsx` | 1 |
| 42 | `frontend/src/components/products/ManageBrandsModal.jsx` | 7 |
| 43 | `frontend/src/components/products/ManageCategoriesModal.jsx` | 5 |
| 44 | `frontend/src/components/products/ManageFieldsModal.jsx` | 3 |
| 45 | `frontend/src/components/products/ManageMenu.jsx` | 1 |
| 46 | `frontend/src/components/products/ManageUnitsModal.jsx` | 3 |
| 47 | `frontend/src/components/products/primitives.jsx` | 6 |
| 48 | `frontend/src/components/products/ProductDetailModal.jsx` | 3 |
| 49 | `frontend/src/components/products/ProductForm.jsx` | 10 |
| 50 | `frontend/src/components/products/Products.jsx` | 21 |
| 51 | `frontend/src/components/products/VariantFormModal.jsx` | 3 |
| 52 | `frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | 4 |
| 53 | `frontend/src/components/receipt-settings/constants.js` | 1 |
| 54 | `frontend/src/components/receipt-settings/ErrorBoundary.jsx` | 0 |
| 55 | `frontend/src/components/receipt-settings/FieldOrderManager.jsx` | 9 |
| 56 | `frontend/src/components/receipt-settings/PrintSettings.jsx` | 5 |
| 57 | `frontend/src/components/receipt-settings/ReceiptPreview.jsx` | 1 |
| 58 | `frontend/src/components/receipt-settings/ReceiptSettings.jsx` | 5 |
| 59 | `frontend/src/components/receipt/Receipt.jsx` | 8 |
| 60 | `frontend/src/components/returns/EditReturnModal.jsx` | 5 |
| 61 | `frontend/src/components/returns/NewReturnModal.jsx` | 10 |
| 62 | `frontend/src/components/returns/NewSupplierReturnModal.jsx` | 4 |
| 63 | `frontend/src/components/returns/ReturnDetailModal.jsx` | 3 |
| 64 | `frontend/src/components/returns/Returns.jsx` | 5 |
| 65 | `frontend/src/components/sales/ExportModal.jsx` | 9 |
| 66 | `frontend/src/components/sales/SaleDetailModal.jsx` | 6 |
| 67 | `frontend/src/components/sales/Sales.jsx` | 5 |
| 68 | `frontend/src/components/sales/StatusBadge.jsx` | 1 |
| 69 | `frontend/src/components/server/ServerPage.jsx` | 12 |
| 70 | `frontend/src/components/shared/ImageGalleryLightbox.jsx` | 5 |
| 71 | `frontend/src/components/shared/Modal.jsx` | 1 |
| 72 | `frontend/src/components/shared/navigationConfig.js` | 0 |
| 73 | `frontend/src/components/shared/PageHelpButton.jsx` | 1 |
| 74 | `frontend/src/components/shared/pageHelpContent.js` | 0 |
| 75 | `frontend/src/components/shared/PortalMenu.jsx` | 3 |
| 76 | `frontend/src/components/users/PermissionEditor.jsx` | 4 |
| 77 | `frontend/src/components/users/UserDetailSheet.jsx` | 3 |
| 78 | `frontend/src/components/users/UserProfileModal.jsx` | 12 |
| 79 | `frontend/src/components/users/Users.jsx` | 16 |
| 80 | `frontend/src/components/utils-settings/AuditLog.jsx` | 11 |
| 81 | `frontend/src/components/utils-settings/Backup.jsx` | 37 |
| 82 | `frontend/src/components/utils-settings/FontFamilyPicker.jsx` | 1 |
| 83 | `frontend/src/components/utils-settings/index.js` | 0 |
| 84 | `frontend/src/components/utils-settings/OtpModal.jsx` | 3 |
| 85 | `frontend/src/components/utils-settings/ResetData.jsx` | 8 |
| 86 | `frontend/src/components/utils-settings/Settings.jsx` | 16 |
| 87 | `frontend/src/constants.js` | 0 |
| 88 | `frontend/src/index.jsx` | 4 |
| 89 | `frontend/src/utils/appRefresh.js` | 0 |
| 90 | `frontend/src/utils/csv.js` | 0 |
| 91 | `frontend/src/utils/dateHelpers.js` | 0 |
| 92 | `frontend/src/utils/deviceInfo.js` | 0 |
| 93 | `frontend/src/utils/favicon.js` | 2 |
| 94 | `frontend/src/utils/firebasePhoneAuth.js` | 1 |
| 95 | `frontend/src/utils/formatters.js` | 0 |
| 96 | `frontend/src/utils/index.js` | 0 |
| 97 | `frontend/src/utils/printReceipt.js` | 14 |
| 98 | `frontend/src/web-api.js` | 0 |
| 99 | `ops/scripts/frontend/verify-i18n.js` | 5 |
| 100 | `frontend/vite.config.mjs` | 2 |
| 101 | `frontend/postcss.config.js` | 0 |
| 102 | `frontend/tailwind.config.js` | 0 |

## 3. Detailed Function Commentary

### 3.1 `frontend/src/api/http.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `logCall` | function | 74 |
| 2 | `getClientMetaHeaders` | function | 82 |
| 3 | `dispatchGlobalDataRefresh` | function | 86 |
| 4 | `parsed` | const arrow | 119 |
| 5 | `isConnectivityError` | function | 145 |
| 6 | `setServerHealth` | function | 166 |

### 3.2 `frontend/src/api/localDb.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `splitCSVLine` | function | 67 |

### 3.3 `frontend/src/api/methods.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDeviceInfo` | function | 3 |
| 2 | `getPortalBaseUrl` | function | 19 |
| 3 | `getCurrentUserContext` | function | 24 |
| 4 | `queueOfflineWrite` | function | 39 |
| 5 | `appendActorQuery` | function | 48 |
| 6 | `fetchJsonWithTimeout` | function | 61 |
| 7 | `getCategories` | const arrow | 131 |
| 8 | `updateCategory` | const arrow | 133 |
| 9 | `getUnits` | const arrow | 137 |
| 10 | `getCustomFields` | const arrow | 142 |
| 11 | `updateCustomField` | const arrow | 144 |
| 12 | `getBranches` | const arrow | 148 |
| 13 | `updateBranch` | const arrow | 150 |
| 14 | `deleteBranch` | const arrow | 151 |
| 15 | `getTransfers` | const arrow | 153 |
| 16 | `getProducts` | const arrow | 157 |
| 17 | `getPortalSubmissionsForReview` | const arrow | 244 |
| 18 | `reviewPortalSubmission` | const arrow | 246 |
| 19 | `getAiProviders` | const arrow | 249 |
| 20 | `createAiProvider` | const arrow | 251 |
| 21 | `updateAiProvider` | const arrow | 253 |
| 22 | `deleteAiProvider` | const arrow | 255 |
| 23 | `testAiProvider` | const arrow | 257 |
| 24 | `getAiResponses` | const arrow | 259 |
| 25 | `getInventorySummary` | const arrow | 468 |
| 26 | `getInventoryMovements` | const arrow | 469 |
| 27 | `getSales` | const arrow | 550 |
| 28 | `getDashboard` | const arrow | 556 |
| 29 | `getAnalytics` | const arrow | 557 |
| 30 | `getCustomers` | const arrow | 566 |
| 31 | `updateCustomer` | const arrow | 568 |
| 32 | `downloadCustomerTemplate` | const arrow | 571 |
| 33 | `getSuppliers` | const arrow | 574 |
| 34 | `updateSupplier` | const arrow | 576 |
| 35 | `downloadSupplierTemplate` | const arrow | 579 |
| 36 | `getDeliveryContacts` | const arrow | 582 |
| 37 | `updateDeliveryContact` | const arrow | 584 |
| 38 | `getUsers` | const arrow | 589 |
| 39 | `updateUser` | const arrow | 591 |
| 40 | `getUserProfile` | const arrow | 592 |
| 41 | `getUserAuthMethods` | const arrow | 593 |
| 42 | `updateUserProfile` | const arrow | 595 |
| 43 | `disconnectUserAuthProvider` | const arrow | 597 |
| 44 | `changeUserPassword` | const arrow | 599 |
| 45 | `resetPassword` | const arrow | 601 |
| 46 | `getRoles` | const arrow | 604 |
| 47 | `updateRole` | const arrow | 606 |
| 48 | `deleteRole` | const arrow | 607 |
| 49 | `getCustomTables` | const arrow | 610 |
| 50 | `getCustomTableData` | const arrow | 612 |
| 51 | `insertCustomRow` | const arrow | 613 |
| 52 | `updateCustomRow` | const arrow | 614 |
| 53 | `deleteCustomRow` | const arrow | 615 |
| 54 | `getAuditLogs` | const arrow | 618 |
| 55 | `getGoogleDriveSyncStatus` | const arrow | 684 |
| 56 | `saveGoogleDriveSyncPreferences` | const arrow | 687 |
| 57 | `startGoogleDriveSyncOauth` | const arrow | 690 |
| 58 | `disconnectGoogleDriveSync` | const arrow | 693 |
| 59 | `syncGoogleDriveNow` | const arrow | 696 |
| 60 | `getReturns` | const arrow | 741 |
| 61 | `updateSaleStatus` | const arrow | 751 |
| 62 | `attachSaleCustomer` | const arrow | 755 |
| 63 | `getSalesExport` | const arrow | 758 |
| 64 | `updateReturn` | const arrow | 762 |
| 65 | `getDataPath` | const arrow | 796 |
| 66 | `setDataPath` | const arrow | 797 |
| 67 | `resetDataPath` | const arrow | 798 |
| 68 | `browseDir` | const arrow | 799 |

### 3.4 `frontend/src/api/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `scheduleReconnect` | function | 100 |

### 3.5 `frontend/src/App.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getChunkErrorMessage` | function | 61 |
| 2 | `isChunkLoadError` | function | 66 |
| 3 | `createChunkTimeoutError` | function | 75 |
| 4 | `isRetryableImportError` | function | 81 |
| 5 | `importWithTimeout` | function | 89 |
| 6 | `clearRetryMarker` | function | 105 |
| 7 | `triggerChunkRecoveryReload` | function | 112 |
| 8 | `createChunkReloadStallError` | function | 122 |
| 9 | `shouldRetryChunk` | function | 128 |
| 10 | `lazyWithRetry` | function | 138 |
| 11 | `getWarmupImporters` | function | 212 |
| 12 | `useMountedPages` | function | 223 |
| 13 | `useSyncErrorBanner` | function | 237 |
| 14 | `onSyncError` | const arrow | 242 |
| 15 | `useVisibilityRecovery` | function | 253 |
| 16 | `onVisible` | const arrow | 257 |
| 17 | `onFocus` | const arrow | 267 |
| 18 | `useChunkWarmup` | function | 285 |
| 19 | `runWarmup` | const arrow | 297 |
| 20 | `PageErrorBoundary` | class | 333 |
| 21 | `Notification` | function | 381 |
| 22 | `SyncErrorBanner` | function | 393 |
| 23 | `PageLoader` | function | 413 |
| 24 | `PageSlot` | function | 424 |
| 25 | `PublicCatalogView` | function | 447 |
| 26 | `App` | component/function | 460 |

### 3.6 `frontend/src/AppContext.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readDeviceSettings` | function | 52 |
| 2 | `writeDeviceSettings` | function | 60 |
| 3 | `mergeSettingsWithDeviceOverrides` | function | 66 |
| 4 | `normalizeDateInput` | function | 70 |
| 5 | `LoadingScreen` | function | 95 |
| 6 | `AccessDenied` | function | 108 |
| 7 | `onUpdate` | const arrow | 215 |
| 8 | `onStatus` | const arrow | 225 |
| 9 | `poll` | const arrow | 233 |
| 10 | `onError` | const arrow | 253 |
| 11 | `onUnauthorized` | const arrow | 257 |
| 12 | `handleOtpLogin` | const arrow | 289 |
| 13 | `handleUserUpdated` | const arrow | 329 |
| 14 | `discoverSyncUrl` | const arrow | 357 |
| 15 | `hexAlpha` | const arrow | 453 |
| 16 | `clearCallbackUrl` | const arrow | 618 |
| 17 | `clearPendingLink` | const arrow | 622 |
| 18 | `run` | const arrow | 626 |
| 19 | `useApp` | const arrow | 863 |
| 20 | `useSync` | const arrow | 864 |
| 21 | `useT` | const arrow | 867 |

### 3.7 `frontend/src/components/auth/Login.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `OauthButton` | function | 16 |
| 2 | `ModeBackButton` | function | 30 |
| 3 | `Login` | component/function | 43 |
| 4 | `tr` | const arrow | 45 |
| 5 | `rememberOrganization` | const arrow | 88 |
| 6 | `loadCapabilities` | const arrow | 115 |
| 7 | `bootstrap` | const arrow | 132 |
| 8 | `clearCallbackUrl` | const arrow | 191 |
| 9 | `run` | const arrow | 196 |
| 10 | `rememberedOrg` | const arrow | 224 |
| 11 | `getDeviceContext` | const arrow | 269 |
| 12 | `handleLogin` | const arrow | 271 |
| 13 | `handleOtp` | const arrow | 291 |
| 14 | `handleOtpInput` | const arrow | 321 |
| 15 | `handleResetWithOtp` | const arrow | 326 |
| 16 | `handleResetWithEmail` | const arrow | 360 |
| 17 | `handleCompleteEmailReset` | const arrow | 386 |
| 18 | `handleStartOauth` | const arrow | 416 |
| 19 | `closeAuxMode` | const arrow | 446 |

### 3.8 `frontend/src/components/branches/Branches.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatTransferDate` | function | 19 |
| 2 | `Branches` | component/function | 36 |
| 3 | `load` | const arrow | 58 |
| 4 | `loadBranchStock` | const arrow | 94 |
| 5 | `handleSaveBranch` | const arrow | 109 |
| 6 | `handleDelete` | const arrow | 128 |
| 7 | `handleBulkDelete` | const arrow | 143 |
| 8 | `toggleSelect` | const arrow | 168 |
| 9 | `toggleSelectAll` | const arrow | 177 |

### 3.9 `frontend/src/components/branches/BranchForm.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `BranchForm` | component/function | 11 |
| 2 | `set` | const arrow | 33 |
| 3 | `handleSave` | const arrow | 45 |

### 3.10 `frontend/src/components/branches/TransferModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `TransferModal` | component/function | 11 |
| 2 | `run` | const arrow | 36 |
| 3 | `handleTransfer` | const arrow | 70 |

### 3.11 `frontend/src/components/catalog/CatalogPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getAboutBlockLabel` | function | 41 |
| 2 | `withAssetVersion` | function | 47 |
| 3 | `tt` | function | 522 |
| 4 | `toBoolean` | function | 527 |
| 5 | `toNumber` | function | 534 |
| 6 | `normalizePriceDisplay` | function | 540 |
| 7 | `normalizeHexColor` | function | 545 |
| 8 | `normalizeExternalUrl` | function | 551 |
| 9 | `buildFaqStarterItems` | function | 567 |
| 10 | `buildAiFaqStarterItems` | function | 647 |
| 11 | `hexToRgba` | function | 678 |
| 12 | `readPortalCache` | function | 689 |
| 13 | `writePortalCache` | function | 705 |
| 14 | `normalizePortalPath` | function | 719 |
| 15 | `isReservedPortalPath` | function | 732 |
| 16 | `buildDraft` | function | 737 |
| 17 | `applyDraft` | function | 821 |
| 18 | `statusClass` | function | 936 |
| 19 | `getBranchQty` | function | 943 |
| 20 | `getStockStatus` | function | 950 |
| 21 | `normalizeProductGallery` | function | 960 |
| 22 | `formatDateTime` | function | 978 |
| 23 | `formatPortalPrice` | function | 985 |
| 24 | `SectionShell` | function | 998 |
| 25 | `SummaryTile` | function | 1014 |
| 26 | `StatusPill` | function | 1038 |
| 27 | `ImageField` | function | 1053 |
| 28 | `pickImageAsDataUrl` | function | 1119 |
| 29 | `pickMultipleImagesAsDataUrls` | function | 1138 |
| 30 | `replaceVars` | function | 1159 |
| 31 | `applyGoogleTranslateSelection` | function | 1196 |
| 32 | `CatalogPage` | component/function | 1218 |
| 33 | `copy` | const arrow | 1289 |
| 34 | `resolveVisibleTab` | const arrow | 1290 |
| 35 | `openProductGallery` | function | 1382 |
| 36 | `changeTranslateTarget` | function | 1395 |
| 37 | `loadPortal` | function | 1407 |
| 38 | `run` | function | 1471 |
| 39 | `toggleFilterValue` | function | 1695 |
| 40 | `clearPortalFilters` | function | 1703 |
| 41 | `setDraft` | function | 1710 |
| 42 | `openPortalImage` | function | 1715 |
| 43 | `setAboutBlocksDraft` | function | 1726 |
| 44 | `updateAboutBlock` | function | 1730 |
| 45 | `addAboutBlock` | function | 1736 |
| 46 | `moveAboutBlockBefore` | function | 1740 |
| 47 | `removeAboutBlock` | function | 1752 |
| 48 | `setFaqDraft` | function | 1756 |
| 49 | `addFaqItem` | function | 1760 |
| 50 | `mergeFaqStarterItems` | function | 1771 |
| 51 | `addFaqStarterSet` | function | 1784 |
| 52 | `addAiFaqStarterSet` | function | 1788 |
| 53 | `updateFaqItem` | function | 1792 |
| 54 | `removeFaqItem` | function | 1798 |
| 55 | `clearAssistantState` | function | 1802 |
| 56 | `uploadPortalImage` | function | 1817 |
| 57 | `uploadDraftImage` | function | 1836 |
| 58 | `uploadAboutBlockMedia` | function | 1841 |
| 59 | `openFilePicker` | function | 1850 |
| 60 | `handleFilePickerSelect` | function | 1854 |
| 61 | `savePortalDraft` | function | 1870 |
| 62 | `askAssistant` | function | 1990 |
| 63 | `handleMembershipLookup` | function | 2023 |
| 64 | `addSubmissionImages` | function | 2049 |
| 65 | `handleSubmissionPaste` | function | 2058 |
| 66 | `handleSubmitShareProof` | function | 2074 |
| 67 | `handleReviewSubmission` | function | 2109 |

### 3.12 `frontend/src/components/contacts/Contacts.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `TABS` | const arrow | 14 |
| 2 | `ImportTypePicker` | function | 20 |
| 3 | `T` | const arrow | 21 |
| 4 | `Contacts` | component/function | 60 |
| 5 | `handleExportAll` | const arrow | 67 |
| 6 | `openImportPicker` | const arrow | 118 |
| 7 | `handleTypeSelected` | const arrow | 120 |
| 8 | `handleImportDone` | const arrow | 125 |

### 3.13 `frontend/src/components/contacts/CustomersTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `BLANK_OPTION` | const arrow | 41 |
| 2 | `generateMembershipNumber` | function | 43 |
| 3 | `tr` | function | 49 |
| 4 | `OptionEditor` | function | 54 |
| 5 | `setField` | const arrow | 55 |
| 6 | `buildOptionSummary` | function | 95 |
| 7 | `CustomerForm` | function | 103 |
| 8 | `setField` | const arrow | 113 |
| 9 | `addOption` | const arrow | 114 |
| 10 | `removeOption` | const arrow | 115 |
| 11 | `updateOption` | const arrow | 116 |
| 12 | `CustomersTab` | function | 190 |
| 13 | `handleSave` | const arrow | 230 |
| 14 | `handleDelete` | const arrow | 254 |
| 15 | `handleBulkDelete` | const arrow | 267 |

### 3.14 `frontend/src/components/contacts/DeliveryTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `BLANK_OPTION` | const arrow | 37 |
| 2 | `OptionEditor` | function | 40 |
| 3 | `set` | const arrow | 41 |
| 4 | `DeliveryForm` | function | 71 |
| 5 | `set` | const arrow | 74 |
| 6 | `handleSave` | const arrow | 75 |
| 7 | `OptionsDisplay` | function | 115 |
| 8 | `OptionsBadge` | function | 132 |
| 9 | `DeliveryTab` | function | 143 |
| 10 | `handleSave` | const arrow | 174 |
| 11 | `handleDelete` | const arrow | 189 |
| 12 | `handleBulkDelete` | const arrow | 195 |

### 3.15 `frontend/src/components/contacts/shared.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toggleOne` | const arrow | 25 |
| 2 | `clearSelection` | const arrow | 36 |
| 3 | `handlePickFile` | const arrow | 246 |
| 4 | `handleChooseExistingFile` | const arrow | 254 |
| 5 | `handleDownloadTemplate` | const arrow | 276 |
| 6 | `handleImport` | const arrow | 280 |

### 3.16 `frontend/src/components/contacts/SuppliersTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `SupplierForm` | function | 9 |
| 2 | `set` | const arrow | 14 |
| 3 | `SuppliersTab` | function | 60 |
| 4 | `handleSave` | const arrow | 101 |
| 5 | `handleDelete` | const arrow | 121 |
| 6 | `handleBulkDelete` | const arrow | 134 |

### 3.17 `frontend/src/components/custom-tables/CustomTables.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `CustomTables` | component/function | 6 |
| 2 | `loadTables` | const arrow | 17 |
| 3 | `addColumn` | const arrow | 39 |
| 4 | `updateColumn` | const arrow | 43 |
| 5 | `removeColumn` | const arrow | 47 |
| 6 | `handleCreateTable` | const arrow | 51 |
| 7 | `handleSaveRow` | const arrow | 64 |
| 8 | `handleDeleteRow` | const arrow | 78 |
| 9 | `openAddRow` | const arrow | 84 |
| 10 | `openEditRow` | const arrow | 91 |

### 3.18 `frontend/src/components/dashboard/charts/BarChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `BarChart` | component/function | 14 |
| 2 | `yPx` | function | 32 |

### 3.19 `frontend/src/components/dashboard/charts/DonutChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `DonutChart` | component/function | 14 |

### 3.20 `frontend/src/components/dashboard/charts/index.js`

- No top-level named function/class symbols detected.

### 3.21 `frontend/src/components/dashboard/charts/LineChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `LineChart` | component/function | 13 |
| 2 | `xPx` | function | 29 |
| 3 | `yPx` | function | 30 |
| 4 | `handleMouseMove` | const arrow | 35 |

### 3.22 `frontend/src/components/dashboard/charts/NoData.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `NoData` | component/function | 7 |

### 3.23 `frontend/src/components/dashboard/Dashboard.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Dashboard` | component/function | 11 |
| 2 | `translateOr` | const arrow | 15 |
| 3 | `calcTrend` | const arrow | 94 |
| 4 | `rangeLabel` | const arrow | 119 |
| 5 | `periodShort` | const arrow | 125 |
| 6 | `buildExportAll` | const arrow | 232 |

### 3.24 `frontend/src/components/dashboard/MiniStat.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `MiniStat` | component/function | 2 |

### 3.25 `frontend/src/components/files/FilePickerModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `AssetPreview` | function | 5 |
| 2 | `FilePickerModal` | component/function | 15 |
| 3 | `tr` | const arrow | 33 |
| 4 | `loadFiles` | function | 38 |
| 5 | `toggleSelectedPath` | function | 69 |
| 6 | `handleUpload` | function | 79 |
| 7 | `handleDelete` | function | 114 |

### 3.26 `frontend/src/components/files/FilesPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `AssetPreview` | function | 21 |
| 2 | `formatDateTime` | function | 35 |
| 3 | `ProviderStatus` | function | 45 |
| 4 | `emptyProviderForm` | function | 56 |
| 5 | `compactTabLabel` | function | 79 |
| 6 | `FilesPage` | component/function | 85 |
| 7 | `tr` | const arrow | 106 |
| 8 | `loadFiles` | function | 146 |
| 9 | `loadProviders` | function | 158 |
| 10 | `loadResponses` | function | 171 |
| 11 | `handleUpload` | function | 183 |
| 12 | `handleDeleteAsset` | function | 199 |
| 13 | `startCreateProvider` | function | 215 |
| 14 | `startEditProvider` | function | 231 |
| 15 | `saveProvider` | function | 255 |
| 16 | `testProvider` | function | 298 |
| 17 | `removeProvider` | function | 312 |
| 18 | `tabButton` | const arrow | 325 |

### 3.27 `frontend/src/components/inventory/DualMoney.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `DualMoney` | function | 5 |

### 3.28 `frontend/src/components/inventory/Inventory.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Inventory` | component/function | 13 |
| 2 | `handleAdjust` | const arrow | 93 |
| 3 | `openAdjust` | const arrow | 124 |
| 4 | `matchesSearch` | const arrow | 137 |
| 5 | `productHay` | const arrow | 144 |
| 6 | `movHay` | const arrow | 147 |

### 3.29 `frontend/src/components/inventory/movementGroups.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `minuteBucket` | function | 1 |
| 2 | `normalizeText` | function | 8 |
| 3 | `buildGroupKey` | function | 12 |
| 4 | `describeMovementType` | function | 28 |

### 3.30 `frontend/src/components/inventory/ProductDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductDetailModal` | function | 6 |
| 2 | `T` | const arrow | 7 |

### 3.31 `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `sanitizeInteger` | function | 101 |
| 2 | `sanitizeKhr` | function | 106 |
| 3 | `formatLookupValue` | function | 112 |
| 4 | `LoyaltyPointsPage` | component/function | 116 |
| 5 | `copy` | const arrow | 119 |
| 6 | `loadCustomerPoints` | function | 150 |
| 7 | `setValue` | function | 185 |
| 8 | `handleSave` | function | 189 |
| 9 | `handleLookup` | function | 211 |

### 3.32 `frontend/src/components/navigation/Sidebar.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getFallbackLabel` | function | 47 |
| 2 | `getNavLabel` | function | 55 |
| 3 | `isDarkColor` | function | 71 |
| 4 | `withAlpha` | function | 81 |
| 5 | `mergeStyles` | function | 87 |
| 6 | `Sidebar` | component/function | 91 |

### 3.33 `frontend/src/components/pos/CartItem.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `CartItem` | function | 7 |

### 3.34 `frontend/src/components/pos/FilterPanel.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `POSFilterPanel` | component/function | 3 |
| 2 | `T` | const arrow | 24 |
| 3 | `clearAll` | const arrow | 34 |
| 4 | `chip` | const arrow | 42 |
| 5 | `SectionLabel` | const arrow | 48 |

### 3.35 `frontend/src/components/pos/POS.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `allTermsMatch` | function | 42 |
| 2 | `POS` | component/function | 47 |
| 3 | `posCopy` | const arrow | 50 |
| 4 | `setQuickFilter` | const arrow | 85 |
| 5 | `addNewOrder` | const arrow | 150 |
| 6 | `closeOrder` | const arrow | 162 |
| 7 | `loadMembership` | function | 307 |
| 8 | `selectCustomer` | const arrow | 329 |
| 9 | `applyCustomerOption` | const arrow | 377 |
| 10 | `clearCustomer` | const arrow | 391 |
| 11 | `handleAddCustomer` | const arrow | 399 |
| 12 | `selectDelivery` | const arrow | 415 |
| 13 | `clearDelivery` | const arrow | 420 |
| 14 | `handleAddDelivery` | const arrow | 422 |
| 15 | `filteredProducts` | const arrow | 463 |
| 16 | `qty` | const arrow | 492 |
| 17 | `addToCart` | const arrow | 600 |
| 18 | `updateQty` | const arrow | 626 |
| 19 | `updatePrice` | const arrow | 634 |
| 20 | `updateItemBranch` | const arrow | 646 |
| 21 | `handleDiscountUsd` | const arrow | 695 |
| 22 | `handleDiscountKhr` | const arrow | 696 |
| 23 | `handleMembershipUnits` | const arrow | 697 |
| 24 | `handleCheckout` | const arrow | 714 |

### 3.36 `frontend/src/components/pos/ProductImage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductImage` | component/function | 7 |

### 3.37 `frontend/src/components/pos/QuickAddModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `QuickAddModal` | function | 5 |
| 2 | `T` | const arrow | 6 |

### 3.38 `frontend/src/components/products/BranchStockAdjuster.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `BranchStockAdjuster` | function | 6 |
| 2 | `setRow` | const arrow | 16 |
| 3 | `handleSave` | const arrow | 19 |

### 3.39 `frontend/src/components/products/BulkAddStockModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `BulkAddStockModal` | function | 6 |
| 2 | `handleSave` | const arrow | 13 |

### 3.40 `frontend/src/components/products/BulkImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBaseName` | function | 12 |
| 2 | `parseCSVContent` | function | 19 |
| 3 | `getIncomingImageFilenames` | function | 39 |
| 4 | `getExistingImageFilenames` | function | 72 |
| 5 | `BulkImportModal` | component/function | 90 |
| 6 | `T` | const arrow | 105 |
| 7 | `resetCsvState` | const arrow | 107 |
| 8 | `pickImageDirectory` | const arrow | 116 |
| 9 | `addLibraryImages` | const arrow | 145 |
| 10 | `handleImageOnlyImport` | const arrow | 161 |
| 11 | `handlePickCSV` | const arrow | 183 |
| 12 | `handleImport` | const arrow | 256 |

### 3.41 `frontend/src/components/products/HeaderActions.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductsHeaderActions` | component/function | 4 |

### 3.42 `frontend/src/components/products/ManageBrandsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `parseBrandOptions` | function | 5 |
| 2 | `toTitleCase` | function | 18 |
| 3 | `ManageBrandsModal` | component/function | 26 |
| 4 | `saveLibrary` | const arrow | 59 |
| 5 | `addLibraryBrand` | const arrow | 70 |
| 6 | `renameBrand` | const arrow | 92 |
| 7 | `removeBrand` | const arrow | 138 |

### 3.43 `frontend/src/components/products/ManageCategoriesModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ManageCategoriesModal` | function | 7 |
| 2 | `load` | const arrow | 16 |
| 3 | `handleAdd` | const arrow | 20 |
| 4 | `handleUpdate` | const arrow | 29 |
| 5 | `handleDelete` | const arrow | 37 |

### 3.44 `frontend/src/components/products/ManageFieldsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ManageFieldsModal` | function | 6 |
| 2 | `load` | const arrow | 13 |
| 3 | `handleSave` | const arrow | 16 |

### 3.45 `frontend/src/components/products/ManageMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ManageMenu` | component/function | 5 |

### 3.46 `frontend/src/components/products/ManageUnitsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ManageUnitsModal` | function | 6 |
| 2 | `load` | const arrow | 11 |
| 3 | `handleAddUnit` | const arrow | 14 |

### 3.47 `frontend/src/components/products/primitives.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductImg` | function | 7 |
| 2 | `ProductImagePlaceholder` | function | 41 |
| 3 | `MarginCard` | function | 49 |
| 4 | `DualPriceInput` | function | 81 |
| 5 | `handleUsdChange` | const arrow | 82 |
| 6 | `handleKhrChange` | const arrow | 88 |

### 3.48 `frontend/src/components/products/ProductDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductDetailModal` | component/function | 4 |
| 2 | `T` | const arrow | 15 |
| 3 | `Row` | const arrow | 25 |

### 3.49 `frontend/src/components/products/ProductForm.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeGallery` | function | 7 |
| 2 | `pickImageFiles` | function | 23 |
| 3 | `parseCustomFieldOptions` | function | 41 |
| 4 | `ProductForm` | component/function | 52 |
| 5 | `setField` | function | 130 |
| 6 | `setCustomField` | function | 134 |
| 7 | `addImages` | function | 144 |
| 8 | `removeImage` | function | 167 |
| 9 | `setPrimaryImage` | function | 171 |
| 10 | `saveForm` | function | 181 |

### 3.50 `frontend/src/components/products/Products.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `multiMatch` | function | 23 |
| 2 | `ThreeDot` | function | 27 |
| 3 | `Products` | component/function | 33 |
| 4 | `handleSave` | const arrow | 82 |
| 5 | `normalizeGallery` | const arrow | 133 |
| 6 | `uploadGalleryImages` | const arrow | 149 |
| 7 | `handleSaveWithGallery` | const arrow | 171 |
| 8 | `handleBulkDelete` | const arrow | 203 |
| 9 | `handleBulkOutOfStock` | const arrow | 216 |
| 10 | `handleBulkChangeBranch` | const arrow | 232 |
| 11 | `handleBulkAddStock` | const arrow | 269 |
| 12 | `toggleSelect` | const arrow | 274 |
| 13 | `toggleSelectAll` | const arrow | 279 |
| 14 | `handleDelete` | const arrow | 283 |
| 15 | `resolveImageUrl` | const arrow | 307 |
| 16 | `getProductGallery` | const arrow | 318 |
| 17 | `openLightbox` | const arrow | 320 |
| 18 | `getBranchQty` | const arrow | 328 |
| 19 | `getStockBadge` | const arrow | 329 |
| 20 | `toImageName` | const arrow | 390 |
| 21 | `toImageUrl` | const arrow | 391 |

### 3.51 `frontend/src/components/products/VariantFormModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `VariantFormModal` | function | 8 |
| 2 | `set` | const arrow | 21 |
| 3 | `handleSave` | const arrow | 24 |

### 3.52 `frontend/src/components/receipt-settings/AllFieldsPanel.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Toggle` | function | 5 |
| 2 | `AllFieldsPanel` | component/function | 21 |
| 3 | `T` | const arrow | 23 |
| 4 | `toggleSection` | const arrow | 42 |

### 3.53 `frontend/src/components/receipt-settings/constants.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `T` | const arrow | 53 |

### 3.54 `frontend/src/components/receipt-settings/ErrorBoundary.jsx`

- No top-level named function/class symbols detected.

### 3.55 `frontend/src/components/receipt-settings/FieldOrderManager.jsx`

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

### 3.56 `frontend/src/components/receipt-settings/PrintSettings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Section` | function | 5 |
| 2 | `PrintSettings` | component/function | 17 |
| 3 | `T` | const arrow | 18 |
| 4 | `setValue` | const arrow | 27 |
| 5 | `resetMargins` | const arrow | 35 |

### 3.57 `frontend/src/components/receipt-settings/ReceiptPreview.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ReceiptPreview` | component/function | 3 |

### 3.58 `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Section` | function | 13 |
| 2 | `Toggle` | function | 24 |
| 3 | `parseTemplate` | function | 39 |
| 4 | `ReceiptSettings` | component/function | 44 |
| 5 | `handleSave` | const arrow | 113 |

### 3.59 `frontend/src/components/receipt/Receipt.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `stripEmoji` | function | 16 |
| 2 | `displayAddress` | function | 21 |
| 3 | `parseItems` | function | 30 |
| 4 | `labelFor` | function | 95 |
| 5 | `Row` | function | 100 |
| 6 | `Receipt` | component/function | 112 |
| 7 | `em` | const arrow | 123 |
| 8 | `exportReceiptPdf` | const arrow | 319 |

### 3.60 `frontend/src/components/returns/EditReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `EditReturnModal` | function | 6 |
| 2 | `T` | const arrow | 8 |
| 3 | `updateQty` | const arrow | 33 |
| 4 | `updateRestock` | const arrow | 36 |
| 5 | `handleSubmit` | const arrow | 44 |

### 3.61 `frontend/src/components/returns/NewReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `NewReturnModal` | function | 7 |
| 2 | `T` | const arrow | 9 |
| 3 | `handleSearch` | const arrow | 34 |
| 4 | `handleReturnTypeChange` | const arrow | 74 |
| 5 | `toggleIncluded` | const arrow | 79 |
| 6 | `updateItemQty` | const arrow | 87 |
| 7 | `updateItemRestock` | const arrow | 95 |
| 8 | `selectAll` | const arrow | 99 |
| 9 | `clearAll` | const arrow | 102 |
| 10 | `handleSubmit` | const arrow | 109 |

### 3.62 `frontend/src/components/returns/NewSupplierReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `NewSupplierReturnModal` | component/function | 4 |
| 2 | `tr` | const arrow | 6 |
| 3 | `updateQty` | const arrow | 113 |
| 4 | `submit` | const arrow | 119 |

### 3.63 `frontend/src/components/returns/ReturnDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeScope` | function | 6 |
| 2 | `ReturnDetailModal` | component/function | 10 |
| 3 | `tr` | const arrow | 12 |

### 3.64 `frontend/src/components/returns/Returns.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeScope` | function | 14 |
| 2 | `Returns` | component/function | 18 |
| 3 | `tr` | const arrow | 30 |
| 4 | `handleOpenEdit` | const arrow | 58 |
| 5 | `renderAmount` | const arrow | 121 |

### 3.65 `frontend/src/components/sales/ExportModal.jsx`

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

### 3.66 `frontend/src/components/sales/SaleDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `InfoBlock` | function | 5 |
| 2 | `parseItems` | function | 21 |
| 3 | `SaleDetailModal` | component/function | 31 |
| 4 | `translateOr` | const arrow | 47 |
| 5 | `handleStatusUpdate` | const arrow | 69 |
| 6 | `handleMembershipAttach` | const arrow | 80 |

### 3.67 `frontend/src/components/sales/Sales.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `multiMatch` | function | 11 |
| 2 | `getSaleBranchLabel` | function | 15 |
| 3 | `Sales` | component/function | 23 |
| 4 | `handleStatusChange` | const arrow | 68 |
| 5 | `handleAttachMembership` | const arrow | 80 |

### 3.68 `frontend/src/components/sales/StatusBadge.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `StatusBadge` | component/function | 39 |

### 3.69 `frontend/src/components/server/ServerPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isAutoDetected` | function | 13 |
| 2 | `StatusRow` | function | 20 |
| 3 | `InfoTab` | function | 32 |
| 4 | `fmt` | const arrow | 83 |
| 5 | `DiagnosticsPanel` | function | 169 |
| 6 | `onErr` | const arrow | 181 |
| 7 | `ServerPage` | component/function | 314 |
| 8 | `check` | const arrow | 337 |
| 9 | `loadSecurityConfig` | const arrow | 359 |
| 10 | `handleTest` | function | 372 |
| 11 | `handleSave` | function | 394 |
| 12 | `handleDisconnect` | function | 401 |

### 3.70 `frontend/src/components/shared/ImageGalleryLightbox.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ImageGalleryLightbox` | component/function | 8 |
| 2 | `formatLabel` | function | 30 |
| 3 | `setIndex` | function | 34 |
| 4 | `renderGalleryImage` | function | 40 |
| 5 | `onKeyDown` | function | 47 |

### 3.71 `frontend/src/components/shared/Modal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Modal` | component/function | 10 |

### 3.72 `frontend/src/components/shared/navigationConfig.js`

- No top-level named function/class symbols detected.

### 3.73 `frontend/src/components/shared/PageHelpButton.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PageHelpButton` | component/function | 6 |

### 3.74 `frontend/src/components/shared/pageHelpContent.js`

- No top-level named function/class symbols detected.

### 3.75 `frontend/src/components/shared/PortalMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PortalMenu` | component/function | 11 |
| 2 | `closeIfClickedOutside` | const arrow | 48 |
| 3 | `closeMenu` | const arrow | 55 |

### 3.76 `frontend/src/components/users/PermissionEditor.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PermissionEditor` | component/function | 15 |
| 2 | `translate` | const arrow | 16 |
| 3 | `labelFor` | const arrow | 22 |
| 4 | `toggle` | const arrow | 25 |

### 3.77 `frontend/src/components/users/UserDetailSheet.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `translateLabel` | function | 4 |
| 2 | `buildRowData` | function | 9 |
| 3 | `UserDetailSheet` | component/function | 21 |

### 3.78 `frontend/src/components/users/UserProfileModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `AvatarPreview` | function | 19 |
| 2 | `UserProfileModal` | component/function | 37 |
| 3 | `tr` | const arrow | 39 |
| 4 | `loadProfile` | const arrow | 82 |
| 5 | `handleProfileSave` | const arrow | 128 |
| 6 | `handlePasswordSave` | const arrow | 181 |
| 7 | `handleSessionSave` | const arrow | 210 |
| 8 | `refreshOtpState` | const arrow | 219 |
| 9 | `handleAvatarPick` | const arrow | 225 |
| 10 | `handleStartOauthLink` | const arrow | 227 |
| 11 | `handleDisconnectOauthProvider` | const arrow | 263 |
| 12 | `handleAvatarSelected` | const arrow | 303 |

### 3.79 `frontend/src/components/users/Users.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ThreeDot` | function | 22 |
| 2 | `formatContactValue` | function | 57 |
| 3 | `Users` | component/function | 62 |
| 4 | `tr` | const arrow | 65 |
| 5 | `canManageTargetUser` | const arrow | 89 |
| 6 | `load` | const arrow | 95 |
| 7 | `openCreateUser` | const arrow | 127 |
| 8 | `openEditUser` | const arrow | 134 |
| 9 | `openCreateRole` | const arrow | 151 |
| 10 | `openEditRole` | const arrow | 158 |
| 11 | `getRolePermissions` | const arrow | 169 |
| 12 | `getPermissionSummary` | const arrow | 178 |
| 13 | `handleSaveUser` | const arrow | 196 |
| 14 | `handleResetPassword` | const arrow | 245 |
| 15 | `handleSaveRole` | const arrow | 274 |
| 16 | `handleDeleteRole` | const arrow | 309 |

### 3.80 `frontend/src/components/utils-settings/AuditLog.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toIso` | function | 32 |
| 2 | `formatDateTime` | function | 38 |
| 3 | `formatLogTime` | function | 56 |
| 4 | `formatJsonPretty` | function | 60 |
| 5 | `parseLogJson` | function | 68 |
| 6 | `formatEntityName` | function | 76 |
| 7 | `extractReference` | function | 82 |
| 8 | `readableSummary` | function | 97 |
| 9 | `recordIdentifier` | function | 111 |
| 10 | `DetailRow` | function | 118 |
| 11 | `AuditLog` | component/function | 130 |

### 3.81 `frontend/src/components/utils-settings/Backup.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PathActionButton` | function | 30 |
| 2 | `PrimaryActionButton` | function | 42 |
| 3 | `useCopy` | function | 54 |
| 4 | `buildPathCrumbs` | function | 61 |
| 5 | `buildFinalDataFolderPath` | function | 79 |
| 6 | `formatDateTime` | function | 92 |
| 7 | `formatBytes` | function | 107 |
| 8 | `countBackupRows` | function | 116 |
| 9 | `buildBackupPreview` | function | 126 |
| 10 | `SectionChip` | function | 164 |
| 11 | `FolderBrowserPanel` | function | 179 |
| 12 | `DataFolderLocation` | function | 292 |
| 13 | `load` | const arrow | 302 |
| 14 | `openBrowser` | const arrow | 326 |
| 15 | `openDriveBrowser` | const arrow | 338 |
| 16 | `pickFolderNatively` | const arrow | 342 |
| 17 | `openInlinePicker` | const arrow | 369 |
| 18 | `openInExplorer` | const arrow | 377 |
| 19 | `selectDir` | const arrow | 392 |
| 20 | `handleApply` | const arrow | 398 |
| 21 | `handleReset` | const arrow | 419 |
| 22 | `GoogleDriveSyncSection` | function | 534 |
| 23 | `load` | const arrow | 547 |
| 24 | `handler` | const arrow | 568 |
| 25 | `savePreferences` | const arrow | 584 |
| 26 | `connectGoogleDrive` | const arrow | 603 |
| 27 | `syncNow` | const arrow | 637 |
| 28 | `disconnect` | const arrow | 654 |
| 29 | `Backup` | component/function | 792 |
| 30 | `browseServerFolders` | const arrow | 816 |
| 31 | `toggleServerBrowser` | const arrow | 829 |
| 32 | `handleExport` | const arrow | 840 |
| 33 | `pickFolder` | const arrow | 853 |
| 34 | `handleFolderExport` | const arrow | 866 |
| 35 | `handleFolderImport` | const arrow | 884 |
| 36 | `handleChooseImportFile` | const arrow | 905 |
| 37 | `handleConfirmImport` | const arrow | 921 |

### 3.82 `frontend/src/components/utils-settings/FontFamilyPicker.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `FontFamilyPicker` | function | 20 |

### 3.83 `frontend/src/components/utils-settings/index.js`

- No top-level named function/class symbols detected.

### 3.84 `frontend/src/components/utils-settings/OtpModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `OtpModal` | function | 7 |
| 2 | `handleConfirm` | const arrow | 28 |
| 3 | `handleDisable` | const arrow | 39 |

### 3.85 `frontend/src/components/utils-settings/ResetData.jsx`

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

### 3.86 `frontend/src/components/utils-settings/Settings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `parseStoredColors` | function | 91 |
| 2 | `buildColorChoices` | function | 102 |
| 3 | `useCopy` | function | 193 |
| 4 | `getSettingsNavLabel` | function | 201 |
| 5 | `SwatchPicker` | function | 218 |
| 6 | `Settings` | component/function | 301 |
| 7 | `setValue` | const arrow | 405 |
| 8 | `formatPreviewDateTime` | const arrow | 424 |
| 9 | `moveNavItem` | const arrow | 440 |
| 10 | `toggleMobilePinned` | const arrow | 450 |
| 11 | `movePinnedItem` | const arrow | 462 |
| 12 | `movePinnedBefore` | const arrow | 472 |
| 13 | `resetNavigationLayout` | const arrow | 484 |
| 14 | `field` | const arrow | 489 |
| 15 | `savePaymentMethods` | const arrow | 511 |
| 16 | `uploadImageSetting` | const arrow | 516 |

### 3.87 `frontend/src/constants.js`

- No top-level named function/class symbols detected.

### 3.88 `frontend/src/index.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isIgnoredRuntimeMessage` | const arrow | 17 |
| 2 | `safeInsertRule` | const function | 25 |
| 3 | `safeCssRulesGetter` | const function | 42 |
| 4 | `stopKnownStartupNoise` | const arrow | 58 |

### 3.89 `frontend/src/utils/appRefresh.js`

- No top-level named function/class symbols detected.

### 3.90 `frontend/src/utils/csv.js`

- No top-level named function/class symbols detected.

### 3.91 `frontend/src/utils/dateHelpers.js`

- No top-level named function/class symbols detected.

### 3.92 `frontend/src/utils/deviceInfo.js`

- No top-level named function/class symbols detected.

### 3.93 `frontend/src/utils/favicon.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `clamp` | function | 1 |
| 2 | `loadImage` | function | 5 |

### 3.94 `frontend/src/utils/firebasePhoneAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `disabled` | function | 6 |

### 3.95 `frontend/src/utils/formatters.js`

- No top-level named function/class symbols detected.

### 3.96 `frontend/src/utils/index.js`

- No top-level named function/class symbols detected.

### 3.97 `frontend/src/utils/printReceipt.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `cloneWithInlineStyles` | function | 80 |
| 2 | `mmToPt` | function | 103 |
| 3 | `dataUrlToBytes` | function | 107 |
| 4 | `joinPdfChunks` | function | 117 |
| 5 | `buildPdfStream` | function | 128 |
| 6 | `buildSingleImagePdf` | function | 137 |
| 7 | `escapePdfText` | function | 175 |
| 8 | `wrapTextLine` | function | 182 |
| 9 | `buildTextOnlyPdf` | function | 201 |
| 10 | `buildReceiptFileName` | function | 254 |
| 11 | `waitForElementAssets` | function | 264 |
| 12 | `renderElementToCanvas` | function | 293 |
| 13 | `withReceiptElement` | function | 344 |
| 14 | `downloadBlob` | function | 367 |

### 3.98 `frontend/src/web-api.js`

- No top-level named function/class symbols detected.

### 3.99 `ops/scripts/frontend/verify-i18n.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `collectUsedKeys` | function | 29 |
| 2 | `listMissing` | function | 69 |
| 3 | `listEmptyValues` | function | 74 |
| 4 | `printList` | function | 81 |
| 5 | `main` | function | 88 |

### 3.100 `frontend/vite.config.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `fixCrossorigin` | function | 29 |
| 2 | `manualChunks` | function | 54 |

### 3.101 `frontend/postcss.config.js`

- No top-level named function/class symbols detected.

### 3.102 `frontend/tailwind.config.js`

- No top-level named function/class symbols detected.

