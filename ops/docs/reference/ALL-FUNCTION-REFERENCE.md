# All Function Reference (Project First-Party Code)

Auto-generated function/class symbol commentary for all first-party code files (frontend, backend, root scripts/config code).

## 1. Coverage Summary

Code files scanned: **147**

## 2. Symbol Count by File

| No. | File | Symbols |
|---:|---|---:|
| 1 | `backend/server.js` | 14 |
| 2 | `backend/src/backupSchema.js` | 3 |
| 3 | `backend/src/config.js` | 5 |
| 4 | `backend/src/database.js` | 4 |
| 5 | `backend/src/dataPath.js` | 9 |
| 6 | `backend/src/fileAssets.js` | 22 |
| 7 | `backend/src/helpers.js` | 17 |
| 8 | `backend/src/middleware.js` | 9 |
| 9 | `backend/src/portalUtils.js` | 6 |
| 10 | `backend/src/requestContext.js` | 5 |
| 11 | `backend/src/routes/auth.js` | 9 |
| 12 | `backend/src/routes/branches.js` | 1 |
| 13 | `backend/src/routes/catalog.js` | 0 |
| 14 | `backend/src/routes/categories.js` | 0 |
| 15 | `backend/src/routes/contacts.js` | 9 |
| 16 | `backend/src/routes/customTables.js` | 2 |
| 17 | `backend/src/routes/files.js` | 2 |
| 18 | `backend/src/routes/inventory.js` | 1 |
| 19 | `backend/src/routes/portal.js` | 15 |
| 20 | `backend/src/routes/products.js` | 17 |
| 21 | `backend/src/routes/returns.js` | 4 |
| 22 | `backend/src/routes/sales.js` | 12 |
| 23 | `backend/src/routes/settings.js` | 0 |
| 24 | `backend/src/routes/system.js` | 25 |
| 25 | `backend/src/routes/units.js` | 0 |
| 26 | `backend/src/routes/users.js` | 14 |
| 27 | `backend/src/security.js` | 13 |
| 28 | `backend/src/serverUtils.js` | 9 |
| 29 | `backend/src/services/firebaseAuth.js` | 22 |
| 30 | `backend/src/services/verification.js` | 20 |
| 31 | `backend/src/websocket.js` | 1 |
| 32 | `backend/test/backupRoundtrip.test.js` | 11 |
| 33 | `backend/test/backupSchema.test.js` | 1 |
| 34 | `backend/test/dataPath.test.js` | 2 |
| 35 | `backend/test/portalUtils.test.js` | 1 |
| 36 | `backend/test/serverUtils.test.js` | 1 |
| 37 | `frontend/postcss.config.js` | 0 |
| 38 | `frontend/src/api/http.js` | 20 |
| 39 | `frontend/src/api/localDb.js` | 5 |
| 40 | `frontend/src/api/methods.js` | 93 |
| 41 | `frontend/src/api/websocket.js` | 4 |
| 42 | `frontend/src/App.jsx` | 22 |
| 43 | `frontend/src/app/appShellUtils.mjs` | 4 |
| 44 | `frontend/src/AppContext.jsx` | 14 |
| 45 | `frontend/src/components/auth/Login.jsx` | 13 |
| 46 | `frontend/src/components/branches/Branches.jsx` | 9 |
| 47 | `frontend/src/components/branches/BranchForm.jsx` | 3 |
| 48 | `frontend/src/components/branches/TransferModal.jsx` | 3 |
| 49 | `frontend/src/components/catalog/CatalogPage.jsx` | 54 |
| 50 | `frontend/src/components/catalog/portalEditorUtils.mjs` | 8 |
| 51 | `frontend/src/components/contacts/Contacts.jsx` | 8 |
| 52 | `frontend/src/components/contacts/CustomersTab.jsx` | 17 |
| 53 | `frontend/src/components/contacts/DeliveryTab.jsx` | 14 |
| 54 | `frontend/src/components/contacts/shared.jsx` | 11 |
| 55 | `frontend/src/components/contacts/SuppliersTab.jsx` | 6 |
| 56 | `frontend/src/components/custom-tables/CustomTables.jsx` | 10 |
| 57 | `frontend/src/components/dashboard/charts/BarChart.jsx` | 2 |
| 58 | `frontend/src/components/dashboard/charts/DonutChart.jsx` | 1 |
| 59 | `frontend/src/components/dashboard/charts/index.js` | 0 |
| 60 | `frontend/src/components/dashboard/charts/LineChart.jsx` | 4 |
| 61 | `frontend/src/components/dashboard/charts/NoData.jsx` | 1 |
| 62 | `frontend/src/components/dashboard/Dashboard.jsx` | 6 |
| 63 | `frontend/src/components/dashboard/MiniStat.jsx` | 1 |
| 64 | `frontend/src/components/files/FilePickerModal.jsx` | 7 |
| 65 | `frontend/src/components/files/FilesPage.jsx` | 6 |
| 66 | `frontend/src/components/inventory/DualMoney.jsx` | 1 |
| 67 | `frontend/src/components/inventory/Inventory.jsx` | 6 |
| 68 | `frontend/src/components/inventory/movementGroups.js` | 6 |
| 69 | `frontend/src/components/inventory/ProductDetailModal.jsx` | 2 |
| 70 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | 9 |
| 71 | `frontend/src/components/navigation/Sidebar.jsx` | 6 |
| 72 | `frontend/src/components/pos/CartItem.jsx` | 1 |
| 73 | `frontend/src/components/pos/FilterPanel.jsx` | 5 |
| 74 | `frontend/src/components/pos/POS.jsx` | 24 |
| 75 | `frontend/src/components/pos/ProductImage.jsx` | 1 |
| 76 | `frontend/src/components/pos/QuickAddModal.jsx` | 2 |
| 77 | `frontend/src/components/products/BranchStockAdjuster.jsx` | 3 |
| 78 | `frontend/src/components/products/BulkAddStockModal.jsx` | 2 |
| 79 | `frontend/src/components/products/BulkImportModal.jsx` | 12 |
| 80 | `frontend/src/components/products/HeaderActions.jsx` | 1 |
| 81 | `frontend/src/components/products/ManageBrandsModal.jsx` | 7 |
| 82 | `frontend/src/components/products/ManageCategoriesModal.jsx` | 5 |
| 83 | `frontend/src/components/products/ManageFieldsModal.jsx` | 3 |
| 84 | `frontend/src/components/products/ManageMenu.jsx` | 1 |
| 85 | `frontend/src/components/products/ManageUnitsModal.jsx` | 3 |
| 86 | `frontend/src/components/products/primitives.jsx` | 6 |
| 87 | `frontend/src/components/products/ProductDetailModal.jsx` | 3 |
| 88 | `frontend/src/components/products/ProductForm.jsx` | 10 |
| 89 | `frontend/src/components/products/Products.jsx` | 21 |
| 90 | `frontend/src/components/products/VariantFormModal.jsx` | 3 |
| 91 | `frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | 4 |
| 92 | `frontend/src/components/receipt-settings/constants.js` | 2 |
| 93 | `frontend/src/components/receipt-settings/ErrorBoundary.jsx` | 0 |
| 94 | `frontend/src/components/receipt-settings/FieldOrderManager.jsx` | 9 |
| 95 | `frontend/src/components/receipt-settings/PrintSettings.jsx` | 5 |
| 96 | `frontend/src/components/receipt-settings/ReceiptPreview.jsx` | 1 |
| 97 | `frontend/src/components/receipt-settings/ReceiptSettings.jsx` | 6 |
| 98 | `frontend/src/components/receipt/Receipt.jsx` | 9 |
| 99 | `frontend/src/components/returns/EditReturnModal.jsx` | 5 |
| 100 | `frontend/src/components/returns/NewReturnModal.jsx` | 10 |
| 101 | `frontend/src/components/returns/NewSupplierReturnModal.jsx` | 4 |
| 102 | `frontend/src/components/returns/ReturnDetailModal.jsx` | 3 |
| 103 | `frontend/src/components/returns/Returns.jsx` | 5 |
| 104 | `frontend/src/components/sales/ExportModal.jsx` | 5 |
| 105 | `frontend/src/components/sales/SaleDetailModal.jsx` | 6 |
| 106 | `frontend/src/components/sales/Sales.jsx` | 5 |
| 107 | `frontend/src/components/sales/StatusBadge.jsx` | 2 |
| 108 | `frontend/src/components/server/ServerPage.jsx` | 11 |
| 109 | `frontend/src/components/shared/ImageGalleryLightbox.jsx` | 5 |
| 110 | `frontend/src/components/shared/Modal.jsx` | 1 |
| 111 | `frontend/src/components/shared/navigationConfig.js` | 2 |
| 112 | `frontend/src/components/shared/PageHelpButton.jsx` | 1 |
| 113 | `frontend/src/components/shared/pageHelpContent.js` | 1 |
| 114 | `frontend/src/components/shared/PortalMenu.jsx` | 4 |
| 115 | `frontend/src/components/users/PermissionEditor.jsx` | 4 |
| 116 | `frontend/src/components/users/UserDetailSheet.jsx` | 3 |
| 117 | `frontend/src/components/users/UserProfileModal.jsx` | 12 |
| 118 | `frontend/src/components/users/Users.jsx` | 16 |
| 119 | `frontend/src/components/utils-settings/AuditLog.jsx` | 11 |
| 120 | `frontend/src/components/utils-settings/Backup.jsx` | 25 |
| 121 | `frontend/src/components/utils-settings/FontFamilyPicker.jsx` | 1 |
| 122 | `frontend/src/components/utils-settings/index.js` | 0 |
| 123 | `frontend/src/components/utils-settings/OtpModal.jsx` | 3 |
| 124 | `frontend/src/components/utils-settings/ResetData.jsx` | 8 |
| 125 | `frontend/src/components/utils-settings/Settings.jsx` | 13 |
| 126 | `frontend/src/constants.js` | 3 |
| 127 | `frontend/src/index.jsx` | 4 |
| 128 | `frontend/src/utils/appRefresh.js` | 1 |
| 129 | `frontend/src/utils/csv.js` | 1 |
| 130 | `frontend/src/utils/dateHelpers.js` | 2 |
| 131 | `frontend/src/utils/deviceInfo.js` | 2 |
| 132 | `frontend/src/utils/firebasePhoneAuth.js` | 4 |
| 133 | `frontend/src/utils/formatters.js` | 4 |
| 134 | `frontend/src/utils/index.js` | 0 |
| 135 | `frontend/src/utils/printReceipt.js` | 18 |
| 136 | `frontend/src/web-api.js` | 0 |
| 137 | `frontend/tailwind.config.js` | 0 |
| 138 | `frontend/tests/appShellUtils.test.mjs` | 1 |
| 139 | `frontend/tests/portalEditorUtils.test.mjs` | 1 |
| 140 | `frontend/vite.config.mjs` | 1 |
| 141 | `ops/scripts/backend/verify-data-integrity.js` | 10 |
| 142 | `ops/scripts/frontend/verify-i18n.js` | 5 |
| 143 | `ops/scripts/generate-doc-reference.js` | 18 |
| 144 | `ops/scripts/generate-full-project-docs.js` | 26 |
| 145 | `ops/scripts/lib/fs-utils.js` | 8 |
| 146 | `ops/scripts/performance-scan.js` | 3 |
| 147 | `temp-vite-build.mjs` | 0 |

## 3. Detailed Function Commentary

### 3.1 `backend/server.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadCompressionMiddleware` | function | 39 |
| 2 | `applySecurityHeaders` | function | 48 |
| 3 | `applyRequestPolicy` | function | 54 |
| 4 | `applyCoreMiddleware` | function | 64 |
| 5 | `mountStaticAssets` | function | 78 |
| 6 | `mountHealthRoute` | function | 91 |
| 7 | `mountApiRoutes` | function | 103 |
| 8 | `mountTransfersAlias` | function | 127 |
| 9 | `mountSpaFallback` | function | 142 |
| 10 | `mountErrorHandler` | function | 154 |
| 11 | `getStartupBanner` | function | 168 |
| 12 | `closeDatabase` | function | 188 |
| 13 | `registerShutdownHandlers` | function | 195 |
| 14 | `bootstrapServer` | function | 213 |

### 3.2 `backend/src/backupSchema.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `countRowsByTable` | function | 61 |
| 2 | `countCustomTableRows` | function | 69 |
| 3 | `buildBackupSummary` | function | 75 |

### 3.3 `backend/src/config.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isDefaultDataMarker` | function | 42 |
| 2 | `resolveStoredDataDir` | function | 47 |
| 3 | `normalizeSelectedDataDir` | function | 54 |
| 4 | `readDataLocation` | function | 68 |
| 5 | `writeDataLocation` | function | 82 |

### 3.4 `backend/src/database.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `tableHasColumn` | function | 534 |
| 2 | `ensureColumn` | function | 544 |
| 3 | `seedIfEmpty` | function | 590 |
| 4 | `ensurePrimaryAdminRoleAndUser` | function | 601 |

### 3.5 `backend/src/dataPath.js`

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

### 3.6 `backend/src/fileAssets.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ensureUploadsDirectory` | function | 42 |
| 2 | `getMimeTypeFromName` | function | 46 |
| 3 | `getMediaType` | function | 51 |
| 4 | `sanitizeOriginalFileName` | function | 60 |
| 5 | `preserveOriginalDisplayName` | function | 72 |
| 6 | `buildUniqueStoredName` | function | 79 |
| 7 | `shouldCompressImage` | function | 93 |
| 8 | `compressBufferForAsset` | function | 99 |
| 9 | `readImageDimensions` | function | 115 |
| 10 | `createFileAssetRecord` | function | 128 |
| 11 | `getFileAssetByPublicPath` | function | 188 |
| 12 | `listAssetRows` | function | 197 |
| 13 | `getUploadFilePath` | function | 219 |
| 14 | `collectUsage` | function | 224 |
| 15 | `serializeAssetRow` | function | 253 |
| 16 | `registerStoredAsset` | function | 263 |
| 17 | `registerUploadFromRequest` | function | 291 |
| 18 | `storeDataUrlAsset` | function | 303 |
| 19 | `backfillUploadAssets` | function | 324 |
| 20 | `listFileAssets` | function | 342 |
| 21 | `getFileAssetById` | function | 347 |
| 22 | `deleteFileAsset` | function | 352 |

### 3.7 `backend/src/helpers.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `logOp` | function | 21 |
| 2 | `getServerLog` | function | 26 |
| 3 | `ok` | function | 30 |
| 4 | `err` | function | 35 |
| 5 | `audit` | function | 50 |
| 6 | `broadcast` | function | 108 |
| 7 | `tryParse` | function | 117 |
| 8 | `today` | function | 122 |
| 9 | `bulkImportCSV` | function | 134 |
| 10 | `parseCSVLine` | function | 164 |
| 11 | `importRows` | function | 184 |
| 12 | `verifyAndRepairStockQuantities` | function | 199 |
| 13 | `verifyAndRepairSaleStatuses` | function | 268 |
| 14 | `verifyAndRepairCostPrices` | function | 328 |
| 15 | `runDataIntegrityCheck` | function | 398 |
| 16 | `getSafeCostPrice` | function | 425 |
| 17 | `calculateSaleProfit` | function | 436 |

### 3.8 `backend/src/middleware.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `authToken` | function | 13 |
| 2 | `sanitiseFilename` | function | 28 |
| 3 | `resolveExtension` | function | 60 |
| 4 | `compressibleImageFormat` | function | 72 |
| 5 | `compressImageFile` | function | 77 |
| 6 | `compressImageBuffer` | function | 99 |
| 7 | `createStorage` | function | 121 |
| 8 | `buildUpload` | function | 137 |
| 9 | `compressUpload` | function | 162 |

### 3.9 `backend/src/portalUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toTrimmedString` | function | 5 |
| 2 | `safeJsonParse` | function | 9 |
| 3 | `createAboutBlock` | function | 17 |
| 4 | `normalizeAboutBlocks` | function | 28 |
| 5 | `extractGoogleMapsEmbedUrl` | function | 47 |
| 6 | `normalizeGoogleMapsEmbed` | function | 55 |

### 3.10 `backend/src/requestContext.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cleanText` | function | 7 |
| 2 | `readHeader` | function | 13 |
| 3 | `extractRequestMeta` | function | 19 |
| 4 | `requestContextMiddleware` | function | 45 |
| 5 | `getRequestMeta` | function | 50 |

### 3.11 `backend/src/routes/auth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getClientKey` | function | 67 |
| 2 | `applyRateLimit` | function | 80 |
| 3 | `getLoginLockKey` | function | 92 |
| 4 | `loginIdentifierPreview` | function | 99 |
| 5 | `rejectLogin` | function | 113 |
| 6 | `getOtpSecret` | function | 135 |
| 7 | `buildUserPayload` | function | 144 |
| 8 | `findUserByIdentifier` | function | 164 |
| 9 | `normalizeVerificationMethod` | function | 188 |

### 3.12 `backend/src/routes/branches.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toDbBool` | function | 9 |

### 3.13 `backend/src/routes/catalog.js`

- No top-level named symbols detected.

### 3.14 `backend/src/routes/categories.js`

- No top-level named symbols detected.

### 3.15 `backend/src/routes/contacts.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cleanMembershipNumber` | function | 9 |
| 2 | `assertUniqueMembershipNumber` | function | 14 |
| 3 | `normalizeConflictMode` | function | 28 |
| 4 | `toNumber` | function | 33 |
| 5 | `loadPointPolicy` | function | 38 |
| 6 | `calculatePolicyPoints` | function | 64 |
| 7 | `findExisting` | const arrow | 201 |
| 8 | `findExisting` | const arrow | 353 |
| 9 | `findExisting` | const arrow | 502 |

### 3.16 `backend/src/routes/customTables.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `humanizeTableName` | function | 9 |
| 2 | `serializeCustomTable` | function | 18 |

### 3.17 `backend/src/routes/files.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getActor` | function | 14 |
| 2 | `getDeviceMeta` | function | 21 |

### 3.18 `backend/src/routes/inventory.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBranchQty` | const arrow | 33 |

### 3.19 `backend/src/routes/portal.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toNumber` | function | 17 |
| 2 | `normalizeBoolean` | function | 23 |
| 3 | `normalizePhone` | function | 29 |
| 4 | `normalizePublicPath` | function | 34 |
| 5 | `normalizeUrl` | function | 48 |
| 6 | `normalizeRedeemValueUsd` | function | 61 |
| 7 | `normalizeRedeemValueKhr` | function | 66 |
| 8 | `normalizeHexColor` | function | 73 |
| 9 | `loadSettingsMap` | function | 79 |
| 10 | `buildPortalConfig` | function | 87 |
| 11 | `calculatePointsValue` | function | 181 |
| 12 | `summarizePoints` | function | 191 |
| 13 | `getPortalProducts` | function | 231 |
| 14 | `findCustomerByMembership` | function | 288 |
| 15 | `sanitizeScreenshots` | function | 298 |

### 3.20 `backend/src/routes/products.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getActiveBranches` | function | 13 |
| 2 | `getDefaultBranch` | function | 17 |
| 3 | `seedBranchRows` | function | 21 |
| 4 | `recalcProductStock` | function | 26 |
| 5 | `normalizeImageGallery` | function | 35 |
| 6 | `syncProductImageGallery` | function | 52 |
| 7 | `loadProductImageMap` | function | 70 |
| 8 | `attachImageGallery` | function | 88 |
| 9 | `assertUniqueProductFields` | function | 100 |
| 10 | `resolveImage` | const arrow | 492 |
| 11 | `determineBranch` | const arrow | 508 |
| 12 | `handleBranch` | const arrow | 523 |
| 13 | `isDirectImageRef` | const arrow | 547 |
| 14 | `normalizeDirectImageRef` | const arrow | 558 |
| 15 | `parseIncomingImageRefs` | const arrow | 565 |
| 16 | `normalizeImageConflictMode` | const arrow | 598 |
| 17 | `loadCurrentGallery` | const arrow | 608 |

### 3.21 `backend/src/routes/returns.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeScope` | function | 11 |
| 2 | `toNumber` | function | 19 |
| 3 | `assertReturnableItems` | function | 24 |
| 4 | `assertSupplierReturnableStock` | function | 315 |

### 3.22 `backend/src/routes/sales.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSaleItemCosts` | function | 9 |
| 2 | `assertSaleStockAvailable` | function | 35 |
| 3 | `findCustomerForSaleAssignment` | function | 64 |
| 4 | `parseBranchId` | function | 85 |
| 5 | `getActiveBranchContext` | function | 90 |
| 6 | `requireActiveBranch` | function | 105 |
| 7 | `resolveSaleItemBranchId` | function | 112 |
| 8 | `normalizeSaleItems` | function | 123 |
| 9 | `summarizeSaleBranch` | function | 153 |
| 10 | `refreshProductStockQuantity` | function | 177 |
| 11 | `refreshProductStockQuantities` | function | 190 |
| 12 | `fetchSaleItemsWithBranches` | function | 197 |

### 3.23 `backend/src/routes/settings.js`

- No top-level named symbols detected.

### 3.24 `backend/src/routes/system.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `q` | function | 49 |
| 2 | `getClientKey` | function | 53 |
| 3 | `applyRouteRateLimit` | function | 59 |
| 4 | `getTableColumns` | function | 71 |
| 5 | `extractUploadPathsFromText` | function | 75 |
| 6 | `collectBackupUploads` | function | 84 |
| 7 | `addUpload` | const arrow | 88 |
| 8 | `restoreBackupUploads` | function | 118 |
| 9 | `deleteAllUploads` | function | 128 |
| 10 | `formatBackupStamp` | function | 137 |
| 11 | `pad` | const arrow | 139 |
| 12 | `getBackupDataRootCandidate` | function | 143 |
| 13 | `readBackupTablesFromDataRoot` | function | 155 |
| 14 | `restoreUploadsFromDataRoot` | function | 188 |
| 15 | `restoreSnapshotTables` | function | 202 |
| 16 | `ensurePrimaryAdminRoleAndUser` | function | 254 |
| 17 | `replaceTableRows` | function | 319 |
| 18 | `normaliseBackupTables` | function | 354 |
| 19 | `normaliseBackupCustomTableRows` | function | 383 |
| 20 | `repairRelationalConsistency` | function | 388 |
| 21 | `getCustomTableNames` | function | 396 |
| 22 | `parseCustomTableDefinition` | function | 402 |
| 23 | `recreateCustomTable` | function | 445 |
| 24 | `listWindowsFsRoots` | const arrow | 865 |
| 25 | `listDriveRoots` | const arrow | 915 |

### 3.25 `backend/src/routes/units.js`

- No top-level named symbols detected.

### 3.26 `backend/src/routes/users.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getClientKey` | function | 47 |
| 2 | `parseJson` | function | 53 |
| 3 | `getMergedPermissions` | function | 65 |
| 4 | `isPrimaryAdmin` | function | 74 |
| 5 | `hasAdminControl` | function | 81 |
| 6 | `canManageTarget` | function | 94 |
| 7 | `getActorFromPayload` | function | 107 |
| 8 | `getActorFromRequest` | function | 118 |
| 9 | `requireAdminControl` | function | 125 |
| 10 | `getUserSecurityContext` | function | 138 |
| 11 | `resolveVerificationContext` | function | 150 |
| 12 | `getUserWithRole` | function | 158 |
| 13 | `sanitizeUserRow` | function | 169 |
| 14 | `isValidEmail` | function | 185 |

### 3.27 `backend/src/security.js`

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

### 3.28 `backend/src/serverUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sanitizeObjectKeys` | function | 24 |
| 2 | `sanitizeRequestPayload` | function | 43 |
| 3 | `isApiOrHealthPath` | function | 48 |
| 4 | `isSpaFallbackEligible` | function | 52 |
| 5 | `setNoStoreHeaders` | function | 60 |
| 6 | `setHtmlNoCacheHeaders` | function | 64 |
| 7 | `setTunnelSecurityHeaders` | function | 70 |
| 8 | `setFrontendStaticHeaders` | function | 81 |
| 9 | `mapServerError` | function | 96 |

### 3.29 `backend/src/services/firebaseAuth.js`

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

### 3.30 `backend/src/services/verification.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowMs` | function | 8 |
| 2 | `toIso` | function | 12 |
| 3 | `parseBool` | function | 16 |
| 4 | `isEmailProviderConfigured` | function | 23 |
| 5 | `getVerificationCapabilities` | function | 30 |
| 6 | `normalizeEmail` | function | 37 |
| 7 | `normalizePhone` | function | 44 |
| 8 | `maskDestination` | function | 54 |
| 9 | `generateCode` | function | 67 |
| 10 | `hashCode` | function | 71 |
| 11 | `resolveChannel` | function | 75 |
| 12 | `getDestinationForChannel` | function | 85 |
| 13 | `cleanupExpiredCodes` | function | 90 |
| 14 | `createVerificationRecord` | function | 98 |
| 15 | `findActiveCode` | function | 124 |
| 16 | `consumeCode` | function | 139 |
| 17 | `verifyCode` | function | 143 |
| 18 | `messageForPurpose` | function | 152 |
| 19 | `sendEmail` | function | 171 |
| 20 | `requestVerificationCode` | function | 235 |

### 3.31 `backend/src/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `attachWss` | function | 20 |

### 3.32 `backend/test/backupRoundtrip.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 19 |
| 2 | `makeTempRoot` | function | 39 |
| 3 | `getFreePort` | function | 43 |
| 4 | `waitForHealth` | function | 54 |
| 5 | `startServer` | function | 66 |
| 6 | `stopServer` | function | 87 |
| 7 | `fetchJson` | function | 101 |
| 8 | `uploadPortalLogo` | function | 111 |
| 9 | `seedSourceServer` | function | 122 |
| 10 | `exportBackup` | function | 221 |
| 11 | `assertRoundtripState` | function | 227 |

### 3.33 `backend/test/backupSchema.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.34 `backend/test/dataPath.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 16 |
| 2 | `makeTempRoot` | function | 27 |

### 3.35 `backend/test/portalUtils.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.36 `backend/test/serverUtils.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 13 |

### 3.37 `frontend/postcss.config.js`

- No top-level named symbols detected.

### 3.38 `frontend/src/api/http.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSyncServerUrl` | export function | 21 |
| 2 | `getSyncToken` | export function | 22 |
| 3 | `setSyncServerUrl` | export function | 24 |
| 4 | `setSyncToken` | export function | 25 |
| 5 | `cacheGet` | export function | 32 |
| 6 | `cacheSet` | export function | 36 |
| 7 | `cacheInvalidate` | export function | 37 |
| 8 | `cacheClearAll` | export function | 40 |
| 9 | `logCall` | function | 54 |
| 10 | `getCallLog` | export function | 59 |
| 11 | `clearCallLog` | export function | 60 |
| 12 | `getClientMetaHeaders` | function | 62 |
| 13 | `apiFetch` | export function | 67 |
| 14 | `msg` | const arrow | 85 |
| 15 | `isNetErr` | export function | 95 |
| 16 | `isServerOnline` | export function | 105 |
| 17 | `setServerHealth` | function | 107 |
| 18 | `startHealthCheck` | export function | 121 |
| 19 | `cacheGetStale` | export function | 156 |
| 20 | `route` | export function | 173 |

### 3.39 `frontend/src/api/localDb.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `localGetSettings` | export function | 38 |
| 2 | `localSaveSettings` | export function | 45 |
| 3 | `parseCSV` | export function | 54 |
| 4 | `splitCSVLine` | function | 67 |
| 5 | `buildCSVTemplate` | export function | 78 |

### 3.40 `frontend/src/api/methods.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDeviceInfo` | function | 3 |
| 2 | `getPortalBaseUrl` | function | 19 |
| 3 | `getCurrentUserContext` | function | 24 |
| 4 | `appendActorQuery` | function | 39 |
| 5 | `login` | export function | 53 |
| 6 | `requestLoginCode` | export function | 56 |
| 7 | `verifyLoginCode` | export function | 59 |
| 8 | `requestPasswordResetCode` | export function | 62 |
| 9 | `completePasswordReset` | export function | 65 |
| 10 | `getVerificationCapabilities` | export function | 68 |
| 11 | `getSettings` | export function | 73 |
| 12 | `saveSettings` | export function | 76 |
| 13 | `getCategories` | const arrow | 82 |
| 14 | `updateCategory` | const arrow | 84 |
| 15 | `getUnits` | const arrow | 88 |
| 16 | `getCustomFields` | const arrow | 93 |
| 17 | `updateCustomField` | const arrow | 95 |
| 18 | `getBranches` | const arrow | 99 |
| 19 | `updateBranch` | const arrow | 101 |
| 20 | `deleteBranch` | const arrow | 102 |
| 21 | `getTransfers` | const arrow | 104 |
| 22 | `getProducts` | const arrow | 108 |
| 23 | `getCatalogMeta` | export function | 109 |
| 24 | `getCatalogProducts` | export function | 117 |
| 25 | `getPortalConfig` | export function | 125 |
| 26 | `getPortalCatalogMeta` | export function | 133 |
| 27 | `getPortalCatalogProducts` | export function | 141 |
| 28 | `lookupPortalMembership` | export function | 149 |
| 29 | `createPortalSubmission` | export function | 159 |
| 30 | `getPortalSubmissionsForReview` | const arrow | 173 |
| 31 | `reviewPortalSubmission` | const arrow | 175 |
| 32 | `createProduct` | export function | 177 |
| 33 | `updateProduct` | export function | 213 |
| 34 | `getFiles` | export function | 241 |
| 35 | `uploadFileAsset` | export function | 247 |
| 36 | `deleteFileAsset` | export function | 277 |
| 37 | `uploadProductImage` | export function | 286 |
| 38 | `uploadUserAvatar` | export function | 315 |
| 39 | `openCSVDialog` | export function | 352 |
| 40 | `openImageDialog` | export function | 372 |
| 41 | `getImageDataUrl` | export function | 380 |
| 42 | `getInventorySummary` | const arrow | 389 |
| 43 | `getInventoryMovements` | const arrow | 390 |
| 44 | `createSale` | export function | 393 |
| 45 | `getSales` | const arrow | 417 |
| 46 | `getDashboard` | const arrow | 423 |
| 47 | `getAnalytics` | const arrow | 424 |
| 48 | `getCustomers` | const arrow | 433 |
| 49 | `updateCustomer` | const arrow | 435 |
| 50 | `downloadCustomerTemplate` | const arrow | 438 |
| 51 | `getSuppliers` | const arrow | 441 |
| 52 | `updateSupplier` | const arrow | 443 |
| 53 | `downloadSupplierTemplate` | const arrow | 446 |
| 54 | `getDeliveryContacts` | const arrow | 449 |
| 55 | `updateDeliveryContact` | const arrow | 451 |
| 56 | `getUsers` | const arrow | 456 |
| 57 | `updateUser` | const arrow | 458 |
| 58 | `getUserProfile` | const arrow | 459 |
| 59 | `updateUserProfile` | const arrow | 460 |
| 60 | `changeUserPassword` | const arrow | 462 |
| 61 | `requestUserContactVerification` | const arrow | 464 |
| 62 | `confirmUserContactVerification` | const arrow | 466 |
| 63 | `resetPassword` | const arrow | 468 |
| 64 | `getRoles` | const arrow | 471 |
| 65 | `updateRole` | const arrow | 473 |
| 66 | `deleteRole` | const arrow | 474 |
| 67 | `getCustomTables` | const arrow | 477 |
| 68 | `getCustomTableData` | const arrow | 479 |
| 69 | `insertCustomRow` | const arrow | 480 |
| 70 | `updateCustomRow` | const arrow | 481 |
| 71 | `deleteCustomRow` | const arrow | 482 |
| 72 | `getAuditLogs` | const arrow | 485 |
| 73 | `exportBackup` | export function | 488 |
| 74 | `exportBackupFolder` | export function | 505 |
| 75 | `pickBackupFile` | export function | 509 |
| 76 | `importBackupData` | export function | 524 |
| 77 | `importBackupFolder` | export function | 530 |
| 78 | `importBackup` | export function | 536 |
| 79 | `resetData` | export function | 551 |
| 80 | `factoryReset` | export function | 557 |
| 81 | `downloadImportTemplate` | export function | 564 |
| 82 | `openPath` | export function | 584 |
| 83 | `getReturns` | const arrow | 593 |
| 84 | `updateSaleStatus` | const arrow | 603 |
| 85 | `attachSaleCustomer` | const arrow | 607 |
| 86 | `getSalesExport` | const arrow | 610 |
| 87 | `updateReturn` | const arrow | 614 |
| 88 | `testSyncServer` | export function | 618 |
| 89 | `openFolderDialog` | export function | 637 |
| 90 | `getDataPath` | const arrow | 648 |
| 91 | `setDataPath` | const arrow | 649 |
| 92 | `resetDataPath` | const arrow | 650 |
| 93 | `browseDir` | const arrow | 651 |

### 3.41 `frontend/src/api/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `connectWS` | export function | 18 |
| 2 | `disconnectWS` | export function | 81 |
| 3 | `scheduleReconnect` | function | 89 |
| 4 | `isWSConnected` | export function | 105 |

### 3.42 `frontend/src/App.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
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
| 22 | `App` | export default function | 355 |

### 3.43 `frontend/src/app/appShellUtils.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isPublicCatalogPath` | export function | 7 |
| 2 | `updateMountedPages` | export function | 17 |
| 3 | `getNotificationPrefix` | export function | 27 |
| 4 | `getNotificationColor` | export function | 34 |

### 3.44 `frontend/src/AppContext.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `LoadingScreen` | function | 46 |
| 2 | `AccessDenied` | function | 59 |
| 3 | `AppProvider` | export function | 71 |
| 4 | `onUpdate` | const arrow | 150 |
| 5 | `onStatus` | const arrow | 160 |
| 6 | `poll` | const arrow | 168 |
| 7 | `onError` | const arrow | 188 |
| 8 | `handleOtpLogin` | const arrow | 206 |
| 9 | `handleUserUpdated` | const arrow | 234 |
| 10 | `discoverSyncUrl` | const arrow | 262 |
| 11 | `hexAlpha` | const arrow | 358 |
| 12 | `useApp` | const arrow | 596 |
| 13 | `useSync` | const arrow | 597 |
| 14 | `useT` | const arrow | 600 |

### 3.45 `frontend/src/components/auth/Login.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Login` | export default function | 6 |
| 2 | `tr` | const arrow | 8 |
| 3 | `loadCapabilities` | const arrow | 63 |
| 4 | `handleLogin` | const arrow | 83 |
| 5 | `handleOtp` | const arrow | 98 |
| 6 | `handleOtpInput` | const arrow | 128 |
| 7 | `resetResetForm` | const arrow | 133 |
| 8 | `resetCodeLoginForm` | const arrow | 141 |
| 9 | `handleSendResetCode` | const arrow | 147 |
| 10 | `handleCompleteReset` | const arrow | 184 |
| 11 | `getDeviceContext` | const arrow | 216 |
| 12 | `handleSendLoginCode` | const arrow | 220 |
| 13 | `handleVerifyLoginCode` | const arrow | 258 |

### 3.46 `frontend/src/components/branches/Branches.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatTransferDate` | function | 18 |
| 2 | `Branches` | export default function | 35 |
| 3 | `load` | const arrow | 57 |
| 4 | `loadBranchStock` | const arrow | 93 |
| 5 | `handleSaveBranch` | const arrow | 108 |
| 6 | `handleDelete` | const arrow | 127 |
| 7 | `handleBulkDelete` | const arrow | 142 |
| 8 | `toggleSelect` | const arrow | 167 |
| 9 | `toggleSelectAll` | const arrow | 176 |

### 3.47 `frontend/src/components/branches/BranchForm.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BranchForm` | export default function | 11 |
| 2 | `set` | const arrow | 33 |
| 3 | `handleSave` | const arrow | 45 |

### 3.48 `frontend/src/components/branches/TransferModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `TransferModal` | export default function | 11 |
| 2 | `run` | const arrow | 36 |
| 3 | `handleTransfer` | const arrow | 70 |

### 3.49 `frontend/src/components/catalog/CatalogPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
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
| 28 | `CatalogPage` | export default function | 968 |
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

### 3.50 `frontend/src/components/catalog/portalEditorUtils.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toTrimmedString` | function | 3 |
| 2 | `safeJsonParse` | function | 7 |
| 3 | `createAboutBlock` | export function | 15 |
| 4 | `normalizeAboutBlocks` | export function | 27 |
| 5 | `serializeAboutBlocks` | export function | 46 |
| 6 | `moveListItem` | export function | 50 |
| 7 | `extractGoogleMapsEmbedUrl` | export function | 63 |
| 8 | `normalizeGoogleMapsEmbed` | export function | 71 |

### 3.51 `frontend/src/components/contacts/Contacts.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `TABS` | const arrow | 14 |
| 2 | `ImportTypePicker` | function | 20 |
| 3 | `T` | const arrow | 21 |
| 4 | `Contacts` | export default function | 60 |
| 5 | `handleExportAll` | const arrow | 67 |
| 6 | `openImportPicker` | const arrow | 118 |
| 7 | `handleTypeSelected` | const arrow | 120 |
| 8 | `handleImportDone` | const arrow | 125 |

### 3.52 `frontend/src/components/contacts/CustomersTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseContactOptions` | export function | 8 |
| 2 | `serializeContactOptions` | export function | 29 |
| 3 | `BLANK_OPTION` | const arrow | 40 |
| 4 | `generateMembershipNumber` | function | 42 |
| 5 | `tr` | function | 48 |
| 6 | `OptionEditor` | function | 53 |
| 7 | `setField` | const arrow | 54 |
| 8 | `buildOptionSummary` | function | 94 |
| 9 | `CustomerForm` | function | 102 |
| 10 | `setField` | const arrow | 112 |
| 11 | `addOption` | const arrow | 113 |
| 12 | `removeOption` | const arrow | 114 |
| 13 | `updateOption` | const arrow | 115 |
| 14 | `CustomersTab` | function | 189 |
| 15 | `handleSave` | const arrow | 222 |
| 16 | `handleDelete` | const arrow | 246 |
| 17 | `handleBulkDelete` | const arrow | 259 |

### 3.53 `frontend/src/components/contacts/DeliveryTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseDeliveryOptions` | export function | 14 |
| 2 | `serializeDeliveryOptions` | export function | 29 |
| 3 | `BLANK_OPTION` | const arrow | 36 |
| 4 | `OptionEditor` | function | 39 |
| 5 | `set` | const arrow | 40 |
| 6 | `DeliveryForm` | function | 70 |
| 7 | `set` | const arrow | 73 |
| 8 | `handleSave` | const arrow | 74 |
| 9 | `OptionsDisplay` | function | 114 |
| 10 | `OptionsBadge` | function | 131 |
| 11 | `DeliveryTab` | function | 142 |
| 12 | `handleSave` | const arrow | 166 |
| 13 | `handleDelete` | const arrow | 181 |
| 14 | `handleBulkDelete` | const arrow | 187 |

### 3.54 `frontend/src/components/contacts/shared.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `useContactSelection` | export function | 11 |
| 2 | `toggleOne` | const arrow | 25 |
| 3 | `clearSelection` | const arrow | 36 |
| 4 | `ThreeDotMenu` | export function | 62 |
| 5 | `DetailModal` | export function | 121 |
| 6 | `ContactTable` | export function | 152 |
| 7 | `ImportModal` | export function | 225 |
| 8 | `handlePickFile` | const arrow | 246 |
| 9 | `handleChooseExistingFile` | const arrow | 254 |
| 10 | `handleDownloadTemplate` | const arrow | 275 |
| 11 | `handleImport` | const arrow | 279 |

### 3.55 `frontend/src/components/contacts/SuppliersTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `SupplierForm` | function | 8 |
| 2 | `set` | const arrow | 13 |
| 3 | `SuppliersTab` | function | 59 |
| 4 | `handleSave` | const arrow | 93 |
| 5 | `handleDelete` | const arrow | 113 |
| 6 | `handleBulkDelete` | const arrow | 126 |

### 3.56 `frontend/src/components/custom-tables/CustomTables.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CustomTables` | export default function | 6 |
| 2 | `loadTables` | const arrow | 17 |
| 3 | `addColumn` | const arrow | 39 |
| 4 | `updateColumn` | const arrow | 43 |
| 5 | `removeColumn` | const arrow | 47 |
| 6 | `handleCreateTable` | const arrow | 51 |
| 7 | `handleSaveRow` | const arrow | 64 |
| 8 | `handleDeleteRow` | const arrow | 78 |
| 9 | `openAddRow` | const arrow | 84 |
| 10 | `openEditRow` | const arrow | 91 |

### 3.57 `frontend/src/components/dashboard/charts/BarChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BarChart` | export default function | 14 |
| 2 | `yPx` | function | 32 |

### 3.58 `frontend/src/components/dashboard/charts/DonutChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `DonutChart` | export default function | 14 |

### 3.59 `frontend/src/components/dashboard/charts/index.js`

- No top-level named symbols detected.

### 3.60 `frontend/src/components/dashboard/charts/LineChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `LineChart` | export default function | 13 |
| 2 | `xPx` | function | 29 |
| 3 | `yPx` | function | 30 |
| 4 | `handleMouseMove` | const arrow | 35 |

### 3.61 `frontend/src/components/dashboard/charts/NoData.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NoData` | export default function | 7 |

### 3.62 `frontend/src/components/dashboard/Dashboard.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Dashboard` | export default function | 10 |
| 2 | `translateOr` | const arrow | 14 |
| 3 | `calcTrend` | const arrow | 93 |
| 4 | `rangeLabel` | const arrow | 118 |
| 5 | `periodShort` | const arrow | 124 |
| 6 | `buildExportAll` | const arrow | 231 |

### 3.63 `frontend/src/components/dashboard/MiniStat.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `MiniStat` | export default function | 2 |

### 3.64 `frontend/src/components/files/FilePickerModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `AssetPreview` | function | 5 |
| 2 | `FilePickerModal` | export default function | 15 |
| 3 | `tr` | const arrow | 33 |
| 4 | `loadFiles` | function | 38 |
| 5 | `toggleSelectedPath` | function | 69 |
| 6 | `handleUpload` | function | 79 |
| 7 | `handleDelete` | function | 114 |

### 3.65 `frontend/src/components/files/FilesPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `AssetPreview` | function | 4 |
| 2 | `FilesPage` | export default function | 14 |
| 3 | `tr` | const arrow | 22 |
| 4 | `loadFiles` | function | 27 |
| 5 | `handleUpload` | function | 45 |
| 6 | `handleDelete` | function | 61 |

### 3.66 `frontend/src/components/inventory/DualMoney.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `DualMoney` | function | 5 |

### 3.67 `frontend/src/components/inventory/Inventory.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Inventory` | export default function | 13 |
| 2 | `handleAdjust` | const arrow | 93 |
| 3 | `openAdjust` | const arrow | 124 |
| 4 | `matchesSearch` | const arrow | 137 |
| 5 | `productHay` | const arrow | 144 |
| 6 | `movHay` | const arrow | 147 |

### 3.68 `frontend/src/components/inventory/movementGroups.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `minuteBucket` | function | 1 |
| 2 | `normalizeText` | function | 8 |
| 3 | `buildGroupKey` | function | 12 |
| 4 | `describeMovementType` | function | 28 |
| 5 | `buildMovementGroups` | export function | 33 |
| 6 | `movementGroupHaystack` | export function | 94 |

### 3.69 `frontend/src/components/inventory/ProductDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductDetailModal` | function | 6 |
| 2 | `T` | const arrow | 7 |

### 3.70 `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sanitizeInteger` | function | 100 |
| 2 | `sanitizeKhr` | function | 105 |
| 3 | `formatLookupValue` | function | 111 |
| 4 | `LoyaltyPointsPage` | export default function | 115 |
| 5 | `copy` | const arrow | 118 |
| 6 | `loadCustomerPoints` | function | 149 |
| 7 | `setValue` | function | 184 |
| 8 | `handleSave` | function | 188 |
| 9 | `handleLookup` | function | 210 |

### 3.71 `frontend/src/components/navigation/Sidebar.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getFallbackLabel` | function | 47 |
| 2 | `getNavLabel` | function | 55 |
| 3 | `isDarkColor` | function | 71 |
| 4 | `withAlpha` | function | 81 |
| 5 | `mergeStyles` | function | 87 |
| 6 | `Sidebar` | export default function | 91 |

### 3.72 `frontend/src/components/pos/CartItem.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CartItem` | function | 7 |

### 3.73 `frontend/src/components/pos/FilterPanel.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `POSFilterPanel` | export default function | 3 |
| 2 | `T` | const arrow | 24 |
| 3 | `clearAll` | const arrow | 34 |
| 4 | `chip` | const arrow | 42 |
| 5 | `SectionLabel` | const arrow | 48 |

### 3.74 `frontend/src/components/pos/POS.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `allTermsMatch` | function | 42 |
| 2 | `POS` | export default function | 47 |
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

### 3.75 `frontend/src/components/pos/ProductImage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductImage` | export default function | 7 |

### 3.76 `frontend/src/components/pos/QuickAddModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `QuickAddModal` | function | 5 |
| 2 | `T` | const arrow | 6 |

### 3.77 `frontend/src/components/products/BranchStockAdjuster.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BranchStockAdjuster` | function | 6 |
| 2 | `setRow` | const arrow | 16 |
| 3 | `handleSave` | const arrow | 19 |

### 3.78 `frontend/src/components/products/BulkAddStockModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BulkAddStockModal` | function | 6 |
| 2 | `handleSave` | const arrow | 13 |

### 3.79 `frontend/src/components/products/BulkImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBaseName` | function | 12 |
| 2 | `parseCSVContent` | function | 19 |
| 3 | `getIncomingImageFilenames` | function | 39 |
| 4 | `getExistingImageFilenames` | function | 72 |
| 5 | `BulkImportModal` | export default function | 90 |
| 6 | `T` | const arrow | 105 |
| 7 | `resetCsvState` | const arrow | 107 |
| 8 | `pickImageDirectory` | const arrow | 116 |
| 9 | `addLibraryImages` | const arrow | 145 |
| 10 | `handleImageOnlyImport` | const arrow | 161 |
| 11 | `handlePickCSV` | const arrow | 183 |
| 12 | `handleImport` | const arrow | 256 |

### 3.80 `frontend/src/components/products/HeaderActions.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductsHeaderActions` | export default function | 3 |

### 3.81 `frontend/src/components/products/ManageBrandsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseBrandOptions` | function | 5 |
| 2 | `toTitleCase` | function | 18 |
| 3 | `ManageBrandsModal` | export default function | 26 |
| 4 | `saveLibrary` | const arrow | 59 |
| 5 | `addLibraryBrand` | const arrow | 70 |
| 6 | `renameBrand` | const arrow | 92 |
| 7 | `removeBrand` | const arrow | 138 |

### 3.82 `frontend/src/components/products/ManageCategoriesModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ManageCategoriesModal` | function | 7 |
| 2 | `load` | const arrow | 16 |
| 3 | `handleAdd` | const arrow | 20 |
| 4 | `handleUpdate` | const arrow | 29 |
| 5 | `handleDelete` | const arrow | 37 |

### 3.83 `frontend/src/components/products/ManageFieldsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ManageFieldsModal` | function | 6 |
| 2 | `load` | const arrow | 13 |
| 3 | `handleSave` | const arrow | 16 |

### 3.84 `frontend/src/components/products/ManageMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ManageMenu` | export default function | 5 |

### 3.85 `frontend/src/components/products/ManageUnitsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ManageUnitsModal` | function | 6 |
| 2 | `load` | const arrow | 11 |
| 3 | `handleAddUnit` | const arrow | 14 |

### 3.86 `frontend/src/components/products/primitives.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductImg` | function | 7 |
| 2 | `ProductImagePlaceholder` | function | 41 |
| 3 | `MarginCard` | function | 49 |
| 4 | `DualPriceInput` | function | 81 |
| 5 | `handleUsdChange` | const arrow | 82 |
| 6 | `handleKhrChange` | const arrow | 88 |

### 3.87 `frontend/src/components/products/ProductDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductDetailModal` | export default function | 4 |
| 2 | `T` | const arrow | 15 |
| 3 | `Row` | const arrow | 25 |

### 3.88 `frontend/src/components/products/ProductForm.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeGallery` | function | 7 |
| 2 | `pickImageFiles` | function | 23 |
| 3 | `parseCustomFieldOptions` | function | 41 |
| 4 | `ProductForm` | export default function | 52 |
| 5 | `setField` | function | 130 |
| 6 | `setCustomField` | function | 134 |
| 7 | `addImages` | function | 144 |
| 8 | `removeImage` | function | 167 |
| 9 | `setPrimaryImage` | function | 171 |
| 10 | `saveForm` | function | 181 |

### 3.89 `frontend/src/components/products/Products.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `multiMatch` | function | 22 |
| 2 | `ThreeDot` | function | 26 |
| 3 | `Products` | export default function | 32 |
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

### 3.90 `frontend/src/components/products/VariantFormModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `VariantFormModal` | function | 8 |
| 2 | `set` | const arrow | 21 |
| 3 | `handleSave` | const arrow | 24 |

### 3.91 `frontend/src/components/receipt-settings/AllFieldsPanel.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Toggle` | function | 6 |
| 2 | `AllFieldsPanel` | function | 23 |
| 3 | `T` | const arrow | 25 |
| 4 | `toggleSection` | const arrow | 43 |

### 3.92 `frontend/src/components/receipt-settings/constants.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getFieldItems` | export function | 52 |
| 2 | `T` | const arrow | 53 |

### 3.93 `frontend/src/components/receipt-settings/ErrorBoundary.jsx`

- No top-level named symbols detected.

### 3.94 `frontend/src/components/receipt-settings/FieldOrderManager.jsx`

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

### 3.95 `frontend/src/components/receipt-settings/PrintSettings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Section` | function | 5 |
| 2 | `PrintSettings` | export default function | 17 |
| 3 | `T` | const arrow | 18 |
| 4 | `setValue` | const arrow | 27 |
| 5 | `resetMargins` | const arrow | 35 |

### 3.96 `frontend/src/components/receipt-settings/ReceiptPreview.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ReceiptPreview` | export default function | 3 |

### 3.97 `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Section` | function | 13 |
| 2 | `Toggle` | function | 24 |
| 3 | `parseTemplate` | function | 39 |
| 4 | `ReceiptSettings` | export default function | 44 |
| 5 | `handleSave` | const arrow | 113 |
| 6 | `handleReset` | const arrow | 127 |

### 3.98 `frontend/src/components/receipt/Receipt.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseTpl` | export function | 8 |
| 2 | `stripEmoji` | function | 16 |
| 3 | `displayAddress` | function | 21 |
| 4 | `parseItems` | function | 30 |
| 5 | `labelFor` | function | 95 |
| 6 | `Row` | function | 100 |
| 7 | `Receipt` | export default function | 112 |
| 8 | `em` | const arrow | 123 |
| 9 | `exportReceiptPdf` | const arrow | 319 |

### 3.99 `frontend/src/components/returns/EditReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `EditReturnModal` | function | 6 |
| 2 | `T` | const arrow | 8 |
| 3 | `updateQty` | const arrow | 33 |
| 4 | `updateRestock` | const arrow | 36 |
| 5 | `handleSubmit` | const arrow | 44 |

### 3.100 `frontend/src/components/returns/NewReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
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

### 3.101 `frontend/src/components/returns/NewSupplierReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NewSupplierReturnModal` | export default function | 4 |
| 2 | `tr` | const arrow | 6 |
| 3 | `updateQty` | const arrow | 113 |
| 4 | `submit` | const arrow | 119 |

### 3.102 `frontend/src/components/returns/ReturnDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeScope` | function | 6 |
| 2 | `ReturnDetailModal` | export default function | 10 |
| 3 | `tr` | const arrow | 12 |

### 3.103 `frontend/src/components/returns/Returns.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeScope` | function | 13 |
| 2 | `Returns` | export default function | 17 |
| 3 | `tr` | const arrow | 29 |
| 4 | `handleOpenEdit` | const arrow | 57 |
| 5 | `renderAmount` | const arrow | 120 |

### 3.104 `frontend/src/components/sales/ExportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ExportModal` | function | 6 |
| 2 | `computeDates` | const arrow | 13 |
| 3 | `handlePreview` | const arrow | 30 |
| 4 | `handleExportCSV` | const arrow | 44 |
| 5 | `downloadJSON` | const arrow | 67 |

### 3.105 `frontend/src/components/sales/SaleDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `InfoBlock` | function | 5 |
| 2 | `parseItems` | function | 21 |
| 3 | `SaleDetailModal` | export default function | 31 |
| 4 | `translateOr` | const arrow | 47 |
| 5 | `handleStatusUpdate` | const arrow | 69 |
| 6 | `handleMembershipAttach` | const arrow | 80 |

### 3.106 `frontend/src/components/sales/Sales.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `multiMatch` | function | 10 |
| 2 | `getSaleBranchLabel` | function | 14 |
| 3 | `Sales` | export default function | 22 |
| 4 | `handleStatusChange` | const arrow | 68 |
| 5 | `handleAttachMembership` | const arrow | 80 |

### 3.107 `frontend/src/components/sales/StatusBadge.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getStatusLabel` | export function | 23 |
| 2 | `StatusBadge` | export default function | 39 |

### 3.108 `frontend/src/components/server/ServerPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isAutoDetected` | function | 13 |
| 2 | `StatusRow` | function | 20 |
| 3 | `InfoTab` | function | 32 |
| 4 | `fmt` | const arrow | 82 |
| 5 | `DiagnosticsPanel` | function | 179 |
| 6 | `onErr` | const arrow | 191 |
| 7 | `ServerPage` | export default function | 332 |
| 8 | `check` | const arrow | 358 |
| 9 | `handleTest` | function | 379 |
| 10 | `handleSave` | function | 401 |
| 11 | `handleDisconnect` | function | 409 |

### 3.109 `frontend/src/components/shared/ImageGalleryLightbox.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ImageGalleryLightbox` | export default function | 8 |
| 2 | `formatLabel` | function | 30 |
| 3 | `setIndex` | function | 34 |
| 4 | `renderGalleryImage` | function | 40 |
| 5 | `onKeyDown` | function | 47 |

### 3.110 `frontend/src/components/shared/Modal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Modal` | export default function | 10 |

### 3.111 `frontend/src/components/shared/navigationConfig.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseNavSetting` | export function | 23 |
| 2 | `orderNavItems` | export function | 32 |

### 3.112 `frontend/src/components/shared/PageHelpButton.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PageHelpButton` | export default function | 6 |

### 3.113 `frontend/src/components/shared/pageHelpContent.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getPageHelpContent` | export function | 442 |

### 3.114 `frontend/src/components/shared/PortalMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PortalMenu` | export default function | 11 |
| 2 | `closeIfClickedOutside` | const arrow | 48 |
| 3 | `closeMenu` | const arrow | 55 |
| 4 | `ThreeDotPortal` | export function | 124 |

### 3.115 `frontend/src/components/users/PermissionEditor.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PermissionEditor` | export default function | 15 |
| 2 | `translate` | const arrow | 16 |
| 3 | `labelFor` | const arrow | 22 |
| 4 | `toggle` | const arrow | 25 |

### 3.116 `frontend/src/components/users/UserDetailSheet.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `translateLabel` | function | 4 |
| 2 | `buildRowData` | function | 9 |
| 3 | `UserDetailSheet` | export default function | 21 |

### 3.117 `frontend/src/components/users/UserProfileModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `AvatarPreview` | function | 16 |
| 2 | `UserProfileModal` | export default function | 34 |
| 3 | `tr` | const arrow | 36 |
| 4 | `loadProfile` | const arrow | 75 |
| 5 | `handleProfileSave` | const arrow | 114 |
| 6 | `handlePasswordSave` | const arrow | 155 |
| 7 | `handleSessionSave` | const arrow | 184 |
| 8 | `refreshOtpState` | const arrow | 193 |
| 9 | `requestContactCode` | const arrow | 199 |
| 10 | `confirmContactCode` | const arrow | 234 |
| 11 | `handleAvatarPick` | const arrow | 272 |
| 12 | `handleAvatarSelected` | const arrow | 279 |

### 3.118 `frontend/src/components/users/Users.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ThreeDot` | function | 21 |
| 2 | `formatContactValue` | function | 56 |
| 3 | `Users` | export default function | 61 |
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

### 3.119 `frontend/src/components/utils-settings/AuditLog.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
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
| 11 | `AuditLog` | export default function | 130 |

### 3.120 `frontend/src/components/utils-settings/Backup.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
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
| 19 | `Backup` | export default function | 423 |
| 20 | `handleExport` | const arrow | 439 |
| 21 | `pickFolder` | const arrow | 452 |
| 22 | `handleFolderExport` | const arrow | 461 |
| 23 | `handleFolderImport` | const arrow | 479 |
| 24 | `handleChooseImportFile` | const arrow | 500 |
| 25 | `handleConfirmImport` | const arrow | 516 |

### 3.121 `frontend/src/components/utils-settings/FontFamilyPicker.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `FontFamilyPicker` | function | 20 |

### 3.122 `frontend/src/components/utils-settings/index.js`

- No top-level named symbols detected.

### 3.123 `frontend/src/components/utils-settings/OtpModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `OtpModal` | function | 7 |
| 2 | `handleConfirm` | const arrow | 28 |
| 3 | `handleDisable` | const arrow | 39 |

### 3.124 `frontend/src/components/utils-settings/ResetData.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ConfirmReset` | function | 6 |
| 2 | `T` | const arrow | 19 |
| 3 | `ResetData` | function | 87 |
| 4 | `T` | const arrow | 89 |
| 5 | `doReset` | const arrow | 116 |
| 6 | `FactoryReset` | function | 174 |
| 7 | `T` | const arrow | 176 |
| 8 | `doFactoryReset` | function | 182 |

### 3.125 `frontend/src/components/utils-settings/Settings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizePortalPath` | function | 211 |
| 2 | `useCopy` | function | 222 |
| 3 | `getSettingsNavLabel` | function | 230 |
| 4 | `SwatchPicker` | function | 247 |
| 5 | `Settings` | export default function | 289 |
| 6 | `setValue` | const arrow | 346 |
| 7 | `moveNavItem` | const arrow | 348 |
| 8 | `toggleMobilePinned` | const arrow | 358 |
| 9 | `movePinnedItem` | const arrow | 370 |
| 10 | `movePinnedBefore` | const arrow | 380 |
| 11 | `resetNavigationLayout` | const arrow | 392 |
| 12 | `field` | const arrow | 397 |
| 13 | `savePaymentMethods` | const arrow | 419 |

### 3.126 `frontend/src/constants.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createEmptyOrder` | export function | 119 |
| 2 | `formatDate` | export function | 149 |
| 3 | `isNetworkError` | export function | 169 |

### 3.127 `frontend/src/index.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isIgnoredRuntimeMessage` | const arrow | 17 |
| 2 | `safeInsertRule` | const function | 25 |
| 3 | `safeCssRulesGetter` | const function | 42 |
| 4 | `stopKnownStartupNoise` | const arrow | 58 |

### 3.128 `frontend/src/utils/appRefresh.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `refreshAppData` | export function | 18 |

### 3.129 `frontend/src/utils/csv.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `downloadCSV` | export function | 10 |

### 3.130 `frontend/src/utils/dateHelpers.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `todayStr` | export function | 10 |
| 2 | `offsetDate` | export function | 20 |

### 3.131 `frontend/src/utils/deviceInfo.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getClientDeviceInfo` | export function | 1 |
| 2 | `getClientMetaHeaders` | export function | 24 |

### 3.132 `frontend/src/utils/firebasePhoneAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `disabled` | function | 6 |
| 2 | `requestFirebasePhoneCode` | export function | 10 |
| 3 | `confirmFirebasePhoneCode` | export function | 14 |
| 4 | `cleanupFirebasePhoneVerification` | export function | 18 |

### 3.133 `frontend/src/utils/formatters.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fmtTime` | export function | 9 |
| 2 | `fmtDate` | export function | 25 |
| 3 | `fmtShort` | export function | 39 |
| 4 | `fmtCount` | export function | 51 |

### 3.134 `frontend/src/utils/index.js`

- No top-level named symbols detected.

### 3.135 `frontend/src/utils/printReceipt.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
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
| 12 | `getPrintSettings` | export function | 299 |
| 13 | `savePrintSettings` | export function | 307 |
| 14 | `getPaperWidthMm` | export function | 313 |
| 15 | `createReceiptPdfBlob` | export function | 323 |
| 16 | `downloadReceiptPdf` | export function | 341 |
| 17 | `openReceiptPdf` | export function | 348 |
| 18 | `printReceipt` | export function | 361 |

### 3.136 `frontend/src/web-api.js`

- No top-level named symbols detected.

### 3.137 `frontend/tailwind.config.js`

- No top-level named symbols detected.

### 3.138 `frontend/tests/appShellUtils.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.139 `frontend/tests/portalEditorUtils.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |

### 3.140 `frontend/vite.config.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fixCrossorigin` | function | 29 |

### 3.141 `ops/scripts/backend/verify-data-integrity.js`

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

### 3.142 `ops/scripts/frontend/verify-i18n.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `collectUsedKeys` | function | 29 |
| 2 | `listMissing` | function | 69 |
| 3 | `listEmptyValues` | function | 74 |
| 4 | `printList` | function | 81 |
| 5 | `main` | function | 88 |

### 3.143 `ops/scripts/generate-doc-reference.js`

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
| 16 | `writeModuleNamingGuide` | function | 365 |
| 17 | `writeProjectCodeReference` | function | 413 |
| 18 | `main` | function | 454 |

### 3.144 `ops/scripts/generate-full-project-docs.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ensureDir` | function | 45 |
| 2 | `toPosix` | function | 49 |
| 3 | `rel` | function | 53 |
| 4 | `shouldSkipDir` | function | 57 |
| 5 | `collectFilesAndFolders` | function | 61 |
| 6 | `getAllProjectFilesAndFolders` | function | 82 |
| 7 | `isProbablyText` | function | 105 |
| 8 | `readText` | function | 118 |
| 9 | `lineCount` | function | 126 |
| 10 | `fileCategory` | function | 131 |
| 11 | `inferPurpose` | function | 151 |
| 12 | `markdownHeader` | function | 176 |
| 13 | `markdownSection` | function | 180 |
| 14 | `extractImportsExports` | function | 184 |
| 15 | `findSymbols` | function | 224 |
| 16 | `writeAllFunctionReference` | function | 250 |
| 17 | `resolveInternalImport` | function | 288 |
| 18 | `writeAllFileInventory` | function | 313 |
| 19 | `folderPurpose` | function | 335 |
| 20 | `writeFolderCoverage` | function | 350 |
| 21 | `writeImportExportReference` | function | 409 |
| 22 | `readJsonObject` | function | 483 |
| 23 | `translationSectionForKey` | function | 491 |
| 24 | `writeTranslationSectionReference` | function | 542 |
| 25 | `writeMainCoverageSummary` | function | 591 |
| 26 | `main` | function | 620 |

### 3.145 `ops/scripts/lib/fs-utils.js`

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

### 3.146 `ops/scripts/performance-scan.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `kb` | function | 44 |
| 2 | `topN` | function | 49 |
| 3 | `main` | function | 57 |

### 3.147 `temp-vite-build.mjs`

- No top-level named symbols detected.

