# Frontend Function Reference

Auto-generated symbol inventory for frontend files. Regenerate with `node ops/scripts/generate-doc-reference.js`.

## 1. Coverage Summary

Total files documented: **101**

## 2. Symbol Count by File

| No. | File | Symbols |
|---:|---|---:|
| 1 | `frontend/src/api/http.js` | 4 |
| 2 | `frontend/src/api/localDb.js` | 1 |
| 3 | `frontend/src/api/methods.js` | 56 |
| 4 | `frontend/src/api/websocket.js` | 1 |
| 5 | `frontend/src/App.jsx` | 22 |
| 6 | `frontend/src/AppContext.jsx` | 15 |
| 7 | `frontend/src/components/auth/Login.jsx` | 19 |
| 8 | `frontend/src/components/branches/Branches.jsx` | 9 |
| 9 | `frontend/src/components/branches/BranchForm.jsx` | 3 |
| 10 | `frontend/src/components/branches/TransferModal.jsx` | 3 |
| 11 | `frontend/src/components/catalog/CatalogPage.jsx` | 54 |
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
| 26 | `frontend/src/components/files/FilesPage.jsx` | 6 |
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
| 58 | `frontend/src/components/receipt-settings/ReceiptSettings.jsx` | 6 |
| 59 | `frontend/src/components/receipt/Receipt.jsx` | 8 |
| 60 | `frontend/src/components/returns/EditReturnModal.jsx` | 5 |
| 61 | `frontend/src/components/returns/NewReturnModal.jsx` | 10 |
| 62 | `frontend/src/components/returns/NewSupplierReturnModal.jsx` | 4 |
| 63 | `frontend/src/components/returns/ReturnDetailModal.jsx` | 3 |
| 64 | `frontend/src/components/returns/Returns.jsx` | 5 |
| 65 | `frontend/src/components/sales/ExportModal.jsx` | 5 |
| 66 | `frontend/src/components/sales/SaleDetailModal.jsx` | 6 |
| 67 | `frontend/src/components/sales/Sales.jsx` | 5 |
| 68 | `frontend/src/components/sales/StatusBadge.jsx` | 1 |
| 69 | `frontend/src/components/server/ServerPage.jsx` | 11 |
| 70 | `frontend/src/components/shared/ImageGalleryLightbox.jsx` | 5 |
| 71 | `frontend/src/components/shared/Modal.jsx` | 1 |
| 72 | `frontend/src/components/shared/navigationConfig.js` | 0 |
| 73 | `frontend/src/components/shared/PageHelpButton.jsx` | 1 |
| 74 | `frontend/src/components/shared/pageHelpContent.js` | 0 |
| 75 | `frontend/src/components/shared/PortalMenu.jsx` | 3 |
| 76 | `frontend/src/components/users/PermissionEditor.jsx` | 4 |
| 77 | `frontend/src/components/users/UserDetailSheet.jsx` | 3 |
| 78 | `frontend/src/components/users/UserProfileModal.jsx` | 13 |
| 79 | `frontend/src/components/users/Users.jsx` | 16 |
| 80 | `frontend/src/components/utils-settings/AuditLog.jsx` | 11 |
| 81 | `frontend/src/components/utils-settings/Backup.jsx` | 25 |
| 82 | `frontend/src/components/utils-settings/FontFamilyPicker.jsx` | 1 |
| 83 | `frontend/src/components/utils-settings/index.js` | 0 |
| 84 | `frontend/src/components/utils-settings/OtpModal.jsx` | 3 |
| 85 | `frontend/src/components/utils-settings/ResetData.jsx` | 8 |
| 86 | `frontend/src/components/utils-settings/Settings.jsx` | 13 |
| 87 | `frontend/src/constants.js` | 0 |
| 88 | `frontend/src/index.jsx` | 4 |
| 89 | `frontend/src/utils/appRefresh.js` | 0 |
| 90 | `frontend/src/utils/csv.js` | 0 |
| 91 | `frontend/src/utils/dateHelpers.js` | 0 |
| 92 | `frontend/src/utils/deviceInfo.js` | 0 |
| 93 | `frontend/src/utils/firebasePhoneAuth.js` | 1 |
| 94 | `frontend/src/utils/formatters.js` | 0 |
| 95 | `frontend/src/utils/index.js` | 0 |
| 96 | `frontend/src/utils/printReceipt.js` | 11 |
| 97 | `frontend/src/web-api.js` | 0 |
| 98 | `ops/scripts/frontend/verify-i18n.js` | 5 |
| 99 | `frontend/vite.config.mjs` | 1 |
| 100 | `frontend/postcss.config.js` | 0 |
| 101 | `frontend/tailwind.config.js` | 0 |

## 3. Detailed Function Commentary

### 3.1 `frontend/src/api/http.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `logCall` | function | 54 |
| 2 | `getClientMetaHeaders` | function | 62 |
| 3 | `msg` | const arrow | 85 |
| 4 | `setServerHealth` | function | 107 |

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
| 4 | `appendActorQuery` | function | 39 |
| 5 | `getCategories` | const arrow | 88 |
| 6 | `updateCategory` | const arrow | 90 |
| 7 | `getUnits` | const arrow | 94 |
| 8 | `getCustomFields` | const arrow | 99 |
| 9 | `updateCustomField` | const arrow | 101 |
| 10 | `getBranches` | const arrow | 105 |
| 11 | `updateBranch` | const arrow | 107 |
| 12 | `deleteBranch` | const arrow | 108 |
| 13 | `getTransfers` | const arrow | 110 |
| 14 | `getProducts` | const arrow | 114 |
| 15 | `getPortalSubmissionsForReview` | const arrow | 179 |
| 16 | `reviewPortalSubmission` | const arrow | 181 |
| 17 | `getInventorySummary` | const arrow | 395 |
| 18 | `getInventoryMovements` | const arrow | 396 |
| 19 | `getSales` | const arrow | 423 |
| 20 | `getDashboard` | const arrow | 429 |
| 21 | `getAnalytics` | const arrow | 430 |
| 22 | `getCustomers` | const arrow | 439 |
| 23 | `updateCustomer` | const arrow | 441 |
| 24 | `downloadCustomerTemplate` | const arrow | 444 |
| 25 | `getSuppliers` | const arrow | 447 |
| 26 | `updateSupplier` | const arrow | 449 |
| 27 | `downloadSupplierTemplate` | const arrow | 452 |
| 28 | `getDeliveryContacts` | const arrow | 455 |
| 29 | `updateDeliveryContact` | const arrow | 457 |
| 30 | `getUsers` | const arrow | 462 |
| 31 | `updateUser` | const arrow | 464 |
| 32 | `getUserProfile` | const arrow | 465 |
| 33 | `getUserAuthMethods` | const arrow | 466 |
| 34 | `updateUserProfile` | const arrow | 468 |
| 35 | `changeUserPassword` | const arrow | 470 |
| 36 | `requestUserContactVerification` | const arrow | 472 |
| 37 | `confirmUserContactVerification` | const arrow | 474 |
| 38 | `resetPassword` | const arrow | 476 |
| 39 | `getRoles` | const arrow | 479 |
| 40 | `updateRole` | const arrow | 481 |
| 41 | `deleteRole` | const arrow | 482 |
| 42 | `getCustomTables` | const arrow | 485 |
| 43 | `getCustomTableData` | const arrow | 487 |
| 44 | `insertCustomRow` | const arrow | 488 |
| 45 | `updateCustomRow` | const arrow | 489 |
| 46 | `deleteCustomRow` | const arrow | 490 |
| 47 | `getAuditLogs` | const arrow | 493 |
| 48 | `getReturns` | const arrow | 601 |
| 49 | `updateSaleStatus` | const arrow | 611 |
| 50 | `attachSaleCustomer` | const arrow | 615 |
| 51 | `getSalesExport` | const arrow | 618 |
| 52 | `updateReturn` | const arrow | 622 |
| 53 | `getDataPath` | const arrow | 656 |
| 54 | `setDataPath` | const arrow | 657 |
| 55 | `resetDataPath` | const arrow | 658 |
| 56 | `browseDir` | const arrow | 659 |

### 3.4 `frontend/src/api/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `scheduleReconnect` | function | 89 |

### 3.5 `frontend/src/App.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getChunkErrorMessage` | function | 43 |
| 2 | `isChunkLoadError` | function | 48 |
| 3 | `clearRetryMarker` | function | 57 |
| 4 | `shouldRetryChunk` | function | 64 |
| 5 | `markChunkRetry` | function | 74 |
| 6 | `lazyWithRetry` | function | 80 |
| 7 | `getWarmupImporters` | function | 140 |
| 8 | `useMountedPages` | function | 145 |
| 9 | `useSyncErrorBanner` | function | 159 |
| 10 | `onSyncError` | const arrow | 164 |
| 11 | `useVisibilityRecovery` | function | 175 |
| 12 | `onVisible` | const arrow | 179 |
| 13 | `onFocus` | const arrow | 189 |
| 14 | `useChunkWarmup` | function | 207 |
| 15 | `runWarmup` | const arrow | 217 |
| 16 | `PageErrorBoundary` | class | 240 |
| 17 | `Notification` | function | 276 |
| 18 | `SyncErrorBanner` | function | 288 |
| 19 | `PageLoader` | function | 308 |
| 20 | `PageSlot` | function | 319 |
| 21 | `PublicCatalogView` | function | 342 |
| 22 | `App` | component/function | 355 |

### 3.6 `frontend/src/AppContext.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `LoadingScreen` | function | 46 |
| 2 | `AccessDenied` | function | 59 |
| 3 | `onUpdate` | const arrow | 150 |
| 4 | `onStatus` | const arrow | 160 |
| 5 | `poll` | const arrow | 168 |
| 6 | `onError` | const arrow | 188 |
| 7 | `handleOtpLogin` | const arrow | 206 |
| 8 | `handleUserUpdated` | const arrow | 234 |
| 9 | `discoverSyncUrl` | const arrow | 262 |
| 10 | `hexAlpha` | const arrow | 358 |
| 11 | `clearCallbackUrl` | const arrow | 509 |
| 12 | `run` | const arrow | 514 |
| 13 | `useApp` | const arrow | 651 |
| 14 | `useSync` | const arrow | 652 |
| 15 | `useT` | const arrow | 655 |

### 3.7 `frontend/src/components/auth/Login.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `OauthButton` | function | 19 |
| 2 | `ModeBackButton` | function | 33 |
| 3 | `Login` | component/function | 46 |
| 4 | `tr` | const arrow | 48 |
| 5 | `loadCapabilities` | const arrow | 111 |
| 6 | `clearCallbackUrl` | const arrow | 141 |
| 7 | `run` | const arrow | 146 |
| 8 | `getDeviceContext` | const arrow | 197 |
| 9 | `resetResetForm` | const arrow | 199 |
| 10 | `resetCodeLoginForm` | const arrow | 207 |
| 11 | `handleLogin` | const arrow | 213 |
| 12 | `handleOtp` | const arrow | 228 |
| 13 | `handleOtpInput` | const arrow | 257 |
| 14 | `handleSendResetCode` | const arrow | 262 |
| 15 | `handleCompleteReset` | const arrow | 299 |
| 16 | `handleSendLoginCode` | const arrow | 331 |
| 17 | `handleVerifyLoginCode` | const arrow | 369 |
| 18 | `handleStartOauth` | const arrow | 394 |
| 19 | `closeAuxMode` | const arrow | 416 |

### 3.8 `frontend/src/components/branches/Branches.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatTransferDate` | function | 18 |
| 2 | `Branches` | component/function | 35 |
| 3 | `load` | const arrow | 57 |
| 4 | `loadBranchStock` | const arrow | 93 |
| 5 | `handleSaveBranch` | const arrow | 108 |
| 6 | `handleDelete` | const arrow | 127 |
| 7 | `handleBulkDelete` | const arrow | 142 |
| 8 | `toggleSelect` | const arrow | 167 |
| 9 | `toggleSelectAll` | const arrow | 176 |

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
| 1 | `getAboutBlockLabel` | function | 34 |
| 2 | `tt` | function | 441 |
| 3 | `toBoolean` | function | 446 |
| 4 | `toNumber` | function | 453 |
| 5 | `normalizePriceDisplay` | function | 459 |
| 6 | `normalizeHexColor` | function | 464 |
| 7 | `hexToRgba` | function | 470 |
| 8 | `readPortalCache` | function | 481 |
| 9 | `writePortalCache` | function | 497 |
| 10 | `normalizePortalPath` | function | 511 |
| 11 | `isReservedPortalPath` | function | 524 |
| 12 | `buildDraft` | function | 529 |
| 13 | `applyDraft` | function | 601 |
| 14 | `statusClass` | function | 686 |
| 15 | `getBranchQty` | function | 693 |
| 16 | `getStockStatus` | function | 700 |
| 17 | `normalizeProductGallery` | function | 710 |
| 18 | `formatDateTime` | function | 728 |
| 19 | `formatPortalPrice` | function | 735 |
| 20 | `SectionShell` | function | 748 |
| 21 | `SummaryTile` | function | 764 |
| 22 | `StatusPill` | function | 788 |
| 23 | `ImageField` | function | 803 |
| 24 | `pickImageAsDataUrl` | function | 869 |
| 25 | `pickMultipleImagesAsDataUrls` | function | 888 |
| 26 | `replaceVars` | function | 909 |
| 27 | `applyGoogleTranslateSelection` | function | 946 |
| 28 | `CatalogPage` | component/function | 968 |
| 29 | `copy` | const arrow | 1023 |
| 30 | `resolveVisibleTab` | const arrow | 1024 |
| 31 | `openProductGallery` | function | 1047 |
| 32 | `changeTranslateTarget` | function | 1060 |
| 33 | `loadPortal` | function | 1072 |
| 34 | `run` | function | 1129 |
| 35 | `toggleFilterValue` | function | 1320 |
| 36 | `clearPortalFilters` | function | 1328 |
| 37 | `setDraft` | function | 1335 |
| 38 | `openPortalImage` | function | 1340 |
| 39 | `setAboutBlocksDraft` | function | 1351 |
| 40 | `updateAboutBlock` | function | 1355 |
| 41 | `addAboutBlock` | function | 1361 |
| 42 | `moveAboutBlockBefore` | function | 1365 |
| 43 | `removeAboutBlock` | function | 1377 |
| 44 | `uploadPortalImage` | function | 1381 |
| 45 | `uploadDraftImage` | function | 1400 |
| 46 | `uploadAboutBlockMedia` | function | 1405 |
| 47 | `openFilePicker` | function | 1414 |
| 48 | `handleFilePickerSelect` | function | 1418 |
| 49 | `savePortalDraft` | function | 1430 |
| 50 | `handleMembershipLookup` | function | 1536 |
| 51 | `addSubmissionImages` | function | 1562 |
| 52 | `handleSubmissionPaste` | function | 1571 |
| 53 | `handleSubmitShareProof` | function | 1587 |
| 54 | `handleReviewSubmission` | function | 1622 |

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
| 1 | `BLANK_OPTION` | const arrow | 40 |
| 2 | `generateMembershipNumber` | function | 42 |
| 3 | `tr` | function | 48 |
| 4 | `OptionEditor` | function | 53 |
| 5 | `setField` | const arrow | 54 |
| 6 | `buildOptionSummary` | function | 94 |
| 7 | `CustomerForm` | function | 102 |
| 8 | `setField` | const arrow | 112 |
| 9 | `addOption` | const arrow | 113 |
| 10 | `removeOption` | const arrow | 114 |
| 11 | `updateOption` | const arrow | 115 |
| 12 | `CustomersTab` | function | 189 |
| 13 | `handleSave` | const arrow | 222 |
| 14 | `handleDelete` | const arrow | 246 |
| 15 | `handleBulkDelete` | const arrow | 259 |

### 3.14 `frontend/src/components/contacts/DeliveryTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `BLANK_OPTION` | const arrow | 36 |
| 2 | `OptionEditor` | function | 39 |
| 3 | `set` | const arrow | 40 |
| 4 | `DeliveryForm` | function | 70 |
| 5 | `set` | const arrow | 73 |
| 6 | `handleSave` | const arrow | 74 |
| 7 | `OptionsDisplay` | function | 114 |
| 8 | `OptionsBadge` | function | 131 |
| 9 | `DeliveryTab` | function | 142 |
| 10 | `handleSave` | const arrow | 166 |
| 11 | `handleDelete` | const arrow | 181 |
| 12 | `handleBulkDelete` | const arrow | 187 |

### 3.15 `frontend/src/components/contacts/shared.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toggleOne` | const arrow | 25 |
| 2 | `clearSelection` | const arrow | 36 |
| 3 | `handlePickFile` | const arrow | 246 |
| 4 | `handleChooseExistingFile` | const arrow | 254 |
| 5 | `handleDownloadTemplate` | const arrow | 275 |
| 6 | `handleImport` | const arrow | 279 |

### 3.16 `frontend/src/components/contacts/SuppliersTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `SupplierForm` | function | 8 |
| 2 | `set` | const arrow | 13 |
| 3 | `SuppliersTab` | function | 59 |
| 4 | `handleSave` | const arrow | 93 |
| 5 | `handleDelete` | const arrow | 113 |
| 6 | `handleBulkDelete` | const arrow | 126 |

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
| 1 | `Dashboard` | component/function | 10 |
| 2 | `translateOr` | const arrow | 14 |
| 3 | `calcTrend` | const arrow | 93 |
| 4 | `rangeLabel` | const arrow | 118 |
| 5 | `periodShort` | const arrow | 124 |
| 6 | `buildExportAll` | const arrow | 231 |

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
| 1 | `AssetPreview` | function | 4 |
| 2 | `FilesPage` | component/function | 14 |
| 3 | `tr` | const arrow | 22 |
| 4 | `loadFiles` | function | 27 |
| 5 | `handleUpload` | function | 45 |
| 6 | `handleDelete` | function | 61 |

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
| 1 | `sanitizeInteger` | function | 100 |
| 2 | `sanitizeKhr` | function | 105 |
| 3 | `formatLookupValue` | function | 111 |
| 4 | `LoyaltyPointsPage` | component/function | 115 |
| 5 | `copy` | const arrow | 118 |
| 6 | `loadCustomerPoints` | function | 149 |
| 7 | `setValue` | function | 184 |
| 8 | `handleSave` | function | 188 |
| 9 | `handleLookup` | function | 210 |

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
| 1 | `ProductsHeaderActions` | component/function | 3 |

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
| 1 | `multiMatch` | function | 22 |
| 2 | `ThreeDot` | function | 26 |
| 3 | `Products` | component/function | 32 |
| 4 | `handleSave` | const arrow | 81 |
| 5 | `normalizeGallery` | const arrow | 132 |
| 6 | `uploadGalleryImages` | const arrow | 148 |
| 7 | `handleSaveWithGallery` | const arrow | 170 |
| 8 | `handleBulkDelete` | const arrow | 202 |
| 9 | `handleBulkOutOfStock` | const arrow | 215 |
| 10 | `handleBulkChangeBranch` | const arrow | 231 |
| 11 | `handleBulkAddStock` | const arrow | 268 |
| 12 | `toggleSelect` | const arrow | 273 |
| 13 | `toggleSelectAll` | const arrow | 278 |
| 14 | `handleDelete` | const arrow | 282 |
| 15 | `resolveImageUrl` | const arrow | 306 |
| 16 | `getProductGallery` | const arrow | 317 |
| 17 | `openLightbox` | const arrow | 319 |
| 18 | `getBranchQty` | const arrow | 327 |
| 19 | `getStockBadge` | const arrow | 328 |
| 20 | `toImageName` | const arrow | 386 |
| 21 | `toImageUrl` | const arrow | 387 |

### 3.51 `frontend/src/components/products/VariantFormModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `VariantFormModal` | function | 8 |
| 2 | `set` | const arrow | 21 |
| 3 | `handleSave` | const arrow | 24 |

### 3.52 `frontend/src/components/receipt-settings/AllFieldsPanel.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Toggle` | function | 6 |
| 2 | `AllFieldsPanel` | function | 23 |
| 3 | `T` | const arrow | 25 |
| 4 | `toggleSection` | const arrow | 43 |

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
| 6 | `handleReset` | const arrow | 127 |

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
| 1 | `normalizeScope` | function | 13 |
| 2 | `Returns` | component/function | 17 |
| 3 | `tr` | const arrow | 29 |
| 4 | `handleOpenEdit` | const arrow | 57 |
| 5 | `renderAmount` | const arrow | 120 |

### 3.65 `frontend/src/components/sales/ExportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ExportModal` | function | 6 |
| 2 | `computeDates` | const arrow | 13 |
| 3 | `handlePreview` | const arrow | 30 |
| 4 | `handleExportCSV` | const arrow | 44 |
| 5 | `downloadJSON` | const arrow | 67 |

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
| 1 | `multiMatch` | function | 10 |
| 2 | `getSaleBranchLabel` | function | 14 |
| 3 | `Sales` | component/function | 22 |
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
| 4 | `fmt` | const arrow | 82 |
| 5 | `DiagnosticsPanel` | function | 179 |
| 6 | `onErr` | const arrow | 191 |
| 7 | `ServerPage` | component/function | 332 |
| 8 | `check` | const arrow | 358 |
| 9 | `handleTest` | function | 379 |
| 10 | `handleSave` | function | 401 |
| 11 | `handleDisconnect` | function | 409 |

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
| 1 | `AvatarPreview` | function | 17 |
| 2 | `UserProfileModal` | component/function | 35 |
| 3 | `tr` | const arrow | 37 |
| 4 | `loadProfile` | const arrow | 78 |
| 5 | `handleStartProviderLink` | const arrow | 119 |
| 6 | `handleProfileSave` | const arrow | 150 |
| 7 | `handlePasswordSave` | const arrow | 196 |
| 8 | `handleSessionSave` | const arrow | 225 |
| 9 | `refreshOtpState` | const arrow | 234 |
| 10 | `requestContactCode` | const arrow | 240 |
| 11 | `confirmContactCode` | const arrow | 275 |
| 12 | `handleAvatarPick` | const arrow | 318 |
| 13 | `handleAvatarSelected` | const arrow | 325 |

### 3.79 `frontend/src/components/users/Users.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ThreeDot` | function | 21 |
| 2 | `formatContactValue` | function | 56 |
| 3 | `Users` | component/function | 61 |
| 4 | `tr` | const arrow | 64 |
| 5 | `canManageTargetUser` | const arrow | 88 |
| 6 | `load` | const arrow | 94 |
| 7 | `openCreateUser` | const arrow | 126 |
| 8 | `openEditUser` | const arrow | 133 |
| 9 | `openCreateRole` | const arrow | 150 |
| 10 | `openEditRole` | const arrow | 157 |
| 11 | `getRolePermissions` | const arrow | 168 |
| 12 | `getPermissionSummary` | const arrow | 177 |
| 13 | `handleSaveUser` | const arrow | 195 |
| 14 | `handleResetPassword` | const arrow | 244 |
| 15 | `handleSaveRole` | const arrow | 273 |
| 16 | `handleDeleteRole` | const arrow | 308 |

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
| 1 | `useCopy` | function | 23 |
| 2 | `buildPathCrumbs` | function | 30 |
| 3 | `buildFinalDataFolderPath` | function | 48 |
| 4 | `formatDateTime` | function | 61 |
| 5 | `formatBytes` | function | 76 |
| 6 | `countBackupRows` | function | 85 |
| 7 | `buildBackupPreview` | function | 95 |
| 8 | `SectionChip` | function | 133 |
| 9 | `DataFolderLocation` | function | 148 |
| 10 | `load` | const arrow | 157 |
| 11 | `openBrowser` | const arrow | 176 |
| 12 | `openDriveBrowser` | const arrow | 188 |
| 13 | `pickFolderNatively` | const arrow | 192 |
| 14 | `openInlinePicker` | const arrow | 213 |
| 15 | `openInExplorer` | const arrow | 221 |
| 16 | `selectDir` | const arrow | 232 |
| 17 | `handleApply` | const arrow | 238 |
| 18 | `handleReset` | const arrow | 259 |
| 19 | `Backup` | component/function | 423 |
| 20 | `handleExport` | const arrow | 439 |
| 21 | `pickFolder` | const arrow | 452 |
| 22 | `handleFolderExport` | const arrow | 461 |
| 23 | `handleFolderImport` | const arrow | 479 |
| 24 | `handleChooseImportFile` | const arrow | 500 |
| 25 | `handleConfirmImport` | const arrow | 516 |

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
| 1 | `normalizePortalPath` | function | 211 |
| 2 | `useCopy` | function | 222 |
| 3 | `getSettingsNavLabel` | function | 230 |
| 4 | `SwatchPicker` | function | 247 |
| 5 | `Settings` | component/function | 289 |
| 6 | `setValue` | const arrow | 346 |
| 7 | `moveNavItem` | const arrow | 348 |
| 8 | `toggleMobilePinned` | const arrow | 358 |
| 9 | `movePinnedItem` | const arrow | 370 |
| 10 | `movePinnedBefore` | const arrow | 380 |
| 11 | `resetNavigationLayout` | const arrow | 392 |
| 12 | `field` | const arrow | 397 |
| 13 | `savePaymentMethods` | const arrow | 419 |

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

### 3.93 `frontend/src/utils/firebasePhoneAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `disabled` | function | 6 |

### 3.94 `frontend/src/utils/formatters.js`

- No top-level named function/class symbols detected.

### 3.95 `frontend/src/utils/index.js`

- No top-level named function/class symbols detected.

### 3.96 `frontend/src/utils/printReceipt.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `cloneWithInlineStyles` | function | 80 |
| 2 | `mmToPt` | function | 103 |
| 3 | `dataUrlToBytes` | function | 107 |
| 4 | `joinPdfChunks` | function | 117 |
| 5 | `buildPdfStream` | function | 128 |
| 6 | `buildSingleImagePdf` | function | 137 |
| 7 | `buildReceiptFileName` | function | 175 |
| 8 | `waitForElementAssets` | function | 185 |
| 9 | `renderElementToCanvas` | function | 214 |
| 10 | `withReceiptElement` | function | 265 |
| 11 | `downloadBlob` | function | 288 |

### 3.97 `frontend/src/web-api.js`

- No top-level named function/class symbols detected.

### 3.98 `ops/scripts/frontend/verify-i18n.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `collectUsedKeys` | function | 29 |
| 2 | `listMissing` | function | 69 |
| 3 | `listEmptyValues` | function | 74 |
| 4 | `printList` | function | 81 |
| 5 | `main` | function | 88 |

### 3.99 `frontend/vite.config.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `fixCrossorigin` | function | 29 |

### 3.100 `frontend/postcss.config.js`

- No top-level named function/class symbols detected.

### 3.101 `frontend/tailwind.config.js`

- No top-level named function/class symbols detected.

