# Frontend Function Reference

Auto-generated symbol inventory for frontend files. Regenerate with `node ops/scripts/docs/generate-doc-reference.ts`.

## 1. Coverage Summary

Total files documented: **236**

## 2. Symbol Count by File

| No. | File | Symbols |
|---:|---|---:|
| 1 | `frontend/src/api/accessControlTransport.ts` | 1 |
| 2 | `frontend/src/api/actionHistoryTransport.ts` | 1 |
| 3 | `frontend/src/api/actorQuery.ts` | 0 |
| 4 | `frontend/src/api/aiTransport.ts` | 0 |
| 5 | `frontend/src/api/appBootstrapTransport.ts` | 5 |
| 6 | `frontend/src/api/auditLogTransport.ts` | 1 |
| 7 | `frontend/src/api/authTransport.ts` | 0 |
| 8 | `frontend/src/api/branchTransport.ts` | 2 |
| 9 | `frontend/src/api/browserDialogs.ts` | 0 |
| 10 | `frontend/src/api/conflicts.ts` | 0 |
| 11 | `frontend/src/api/contactsTransport.ts` | 10 |
| 12 | `frontend/src/api/cooldownFallbacks.ts` | 3 |
| 13 | `frontend/src/api/customTablesTransport.ts` | 3 |
| 14 | `frontend/src/api/dashboardTransport.ts` | 0 |
| 15 | `frontend/src/api/driveSync.ts` | 0 |
| 16 | `frontend/src/api/expectedUpdatedAt.ts` | 2 |
| 17 | `frontend/src/api/fileTransport.ts` | 5 |
| 18 | `frontend/src/api/http.ts` | 31 |
| 19 | `frontend/src/api/importJobsTransport.ts` | 5 |
| 20 | `frontend/src/api/importTransport.ts` | 0 |
| 21 | `frontend/src/api/inventoryTransport.ts` | 1 |
| 22 | `frontend/src/api/lazyLocalDb.ts` | 0 |
| 23 | `frontend/src/api/localDb.ts` | 1 |
| 24 | `frontend/src/api/localMirrors.ts` | 3 |
| 25 | `frontend/src/api/lookupTransport.ts` | 4 |
| 26 | `frontend/src/api/methods.ts` | 160 |
| 27 | `frontend/src/api/notificationSummary.ts` | 1 |
| 28 | `frontend/src/api/portalHttp.ts` | 0 |
| 29 | `frontend/src/api/portalTransport.ts` | 2 |
| 30 | `frontend/src/api/productReadTransport.ts` | 0 |
| 31 | `frontend/src/api/productWriteTransport.ts` | 3 |
| 32 | `frontend/src/api/query.ts` | 1 |
| 33 | `frontend/src/api/queryCache.ts` | 0 |
| 34 | `frontend/src/api/requestIds.ts` | 0 |
| 35 | `frontend/src/api/rfidTransport.ts` | 2 |
| 36 | `frontend/src/api/salesTransport.ts` | 0 |
| 37 | `frontend/src/api/syncPreview.ts` | 0 |
| 38 | `frontend/src/api/syncRuntime.ts` | 0 |
| 39 | `frontend/src/api/systemJobs.ts` | 3 |
| 40 | `frontend/src/api/systemRuntime.ts` | 0 |
| 41 | `frontend/src/api/websocket.ts` | 7 |
| 42 | `frontend/src/App.tsx` | 85 |
| 43 | `frontend/src/app/appShellUtils.ts` | 0 |
| 44 | `frontend/src/app/publicErrorRecovery.ts` | 1 |
| 45 | `frontend/src/AppContext.tsx` | 40 |
| 46 | `frontend/src/components/auth/Login.tsx` | 23 |
| 47 | `frontend/src/components/branches/Branches.tsx` | 15 |
| 48 | `frontend/src/components/branches/BranchForm.tsx` | 2 |
| 49 | `frontend/src/components/branches/TransferModal.tsx` | 6 |
| 50 | `frontend/src/components/catalog/CatalogEditorSurface.tsx` | 1 |
| 51 | `frontend/src/components/catalog/CatalogImageField.tsx` | 1 |
| 52 | `frontend/src/components/catalog/CatalogPage.tsx` | 122 |
| 53 | `frontend/src/components/catalog/CatalogPageContext.tsx` | 0 |
| 54 | `frontend/src/components/catalog/CatalogPreviewSurface.tsx` | 2 |
| 55 | `frontend/src/components/catalog/CatalogProductsSection.tsx` | 4 |
| 56 | `frontend/src/components/catalog/CatalogSecondaryTabs.tsx` | 6 |
| 57 | `frontend/src/components/catalog/catalogUi.tsx` | 1 |
| 58 | `frontend/src/components/catalog/portalCatalogDisplay.ts` | 2 |
| 59 | `frontend/src/components/catalog/portalContentI18n.ts` | 14 |
| 60 | `frontend/src/components/catalog/portalEditorUtils.ts` | 2 |
| 61 | `frontend/src/components/catalog/portalLanguagePacks.ts` | 0 |
| 62 | `frontend/src/components/catalog/portalTranslateController.ts` | 2 |
| 63 | `frontend/src/components/contacts/ContactImportModal.tsx` | 8 |
| 64 | `frontend/src/components/contacts/contactImportWorker.ts` | 1 |
| 65 | `frontend/src/components/contacts/contactOptionUtils.ts` | 3 |
| 66 | `frontend/src/components/contacts/Contacts.tsx` | 11 |
| 67 | `frontend/src/components/contacts/CustomerFormModal.tsx` | 10 |
| 68 | `frontend/src/components/contacts/customerMembershipNumber.ts` | 0 |
| 69 | `frontend/src/components/contacts/CustomersTab.tsx` | 16 |
| 70 | `frontend/src/components/contacts/DeliveryTab.tsx` | 25 |
| 71 | `frontend/src/components/contacts/shared.tsx` | 3 |
| 72 | `frontend/src/components/contacts/SuppliersTab.tsx` | 20 |
| 73 | `frontend/src/components/custom-tables/CustomTables.tsx` | 19 |
| 74 | `frontend/src/components/dashboard/charts/BarChart.tsx` | 5 |
| 75 | `frontend/src/components/dashboard/charts/DonutChart.tsx` | 1 |
| 76 | `frontend/src/components/dashboard/charts/index.ts` | 0 |
| 77 | `frontend/src/components/dashboard/charts/LineChart.tsx` | 7 |
| 78 | `frontend/src/components/dashboard/charts/NoData.tsx` | 1 |
| 79 | `frontend/src/components/dashboard/Dashboard.tsx` | 18 |
| 80 | `frontend/src/components/dashboard/MiniStat.tsx` | 1 |
| 81 | `frontend/src/components/files/FilePickerModal.tsx` | 8 |
| 82 | `frontend/src/components/files/FilesPage.tsx` | 27 |
| 83 | `frontend/src/components/files/FilesProvidersTab.tsx` | 2 |
| 84 | `frontend/src/components/files/FilesResponsesTab.tsx` | 1 |
| 85 | `frontend/src/components/inventory/DualMoney.tsx` | 1 |
| 86 | `frontend/src/components/inventory/Inventory.tsx` | 24 |
| 87 | `frontend/src/components/inventory/InventoryImportModal.tsx` | 9 |
| 88 | `frontend/src/components/inventory/inventoryImportWorker.ts` | 1 |
| 89 | `frontend/src/components/inventory/InventoryMovementsSurface.tsx` | 1 |
| 90 | `frontend/src/components/inventory/InventoryProductsSurface.tsx` | 3 |
| 91 | `frontend/src/components/inventory/InventoryRfidSurface.tsx` | 1 |
| 92 | `frontend/src/components/inventory/movementGroups.ts` | 11 |
| 93 | `frontend/src/components/inventory/ProductDetailModal.tsx` | 2 |
| 94 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx` | 10 |
| 95 | `frontend/src/components/navigation/Sidebar.tsx` | 9 |
| 96 | `frontend/src/components/pos/CartItem.tsx` | 2 |
| 97 | `frontend/src/components/pos/FilterPanel.tsx` | 5 |
| 98 | `frontend/src/components/pos/POS.tsx` | 37 |
| 99 | `frontend/src/components/pos/posCore.ts` | 1 |
| 100 | `frontend/src/components/pos/ProductImage.tsx` | 1 |
| 101 | `frontend/src/components/pos/QuickAddModal.tsx` | 2 |
| 102 | `frontend/src/components/products/config/productPageConfig.ts` | 0 |
| 103 | `frontend/src/components/products/forms/BranchStockAdjuster.tsx` | 6 |
| 104 | `frontend/src/components/products/forms/BulkAddStockModal.tsx` | 6 |
| 105 | `frontend/src/components/products/forms/ProductForm.tsx` | 18 |
| 106 | `frontend/src/components/products/forms/VariantFormModal.tsx` | 3 |
| 107 | `frontend/src/components/products/helpers/productDisplayHelpers.ts` | 1 |
| 108 | `frontend/src/components/products/helpers/productFilterHelpers.ts` | 5 |
| 109 | `frontend/src/components/products/helpers/productGalleryHelpers.ts` | 0 |
| 110 | `frontend/src/components/products/helpers/productGroupViewHelpers.ts` | 0 |
| 111 | `frontend/src/components/products/helpers/productMenuHelpers.ts` | 1 |
| 112 | `frontend/src/components/products/helpers/productPageHelpers.ts` | 0 |
| 113 | `frontend/src/components/products/helpers/productSelectionHelpers.ts` | 0 |
| 114 | `frontend/src/components/products/helpers/productWriteHelpers.ts` | 3 |
| 115 | `frontend/src/components/products/history/productHistoryHelpers.ts` | 0 |
| 116 | `frontend/src/components/products/import/BulkImportModal.tsx` | 51 |
| 117 | `frontend/src/components/products/import/productImportPlanner.ts` | 11 |
| 118 | `frontend/src/components/products/import/productImportWorker.ts` | 3 |
| 119 | `frontend/src/components/products/lookups/ManageBrandsModal.tsx` | 9 |
| 120 | `frontend/src/components/products/lookups/ManageCategoriesModal.tsx` | 5 |
| 121 | `frontend/src/components/products/lookups/ManageUnitsModal.tsx` | 5 |
| 122 | `frontend/src/components/products/lookups/productLookupSnapshots.ts` | 7 |
| 123 | `frontend/src/components/products/Products.tsx` | 24 |
| 124 | `frontend/src/components/products/scanning/barcodeImageScanner.ts` | 4 |
| 125 | `frontend/src/components/products/scanning/BarcodeScannerModal.tsx` | 4 |
| 126 | `frontend/src/components/products/scanning/barcodeScannerState.ts` | 0 |
| 127 | `frontend/src/components/products/scanning/cameraPermission.ts` | 3 |
| 128 | `frontend/src/components/products/scanning/scanbotScanner.ts` | 5 |
| 129 | `frontend/src/components/products/shared/primitives.tsx` | 12 |
| 130 | `frontend/src/components/products/surfaces/HeaderActions.tsx` | 2 |
| 131 | `frontend/src/components/products/surfaces/ProductDetailModal.tsx` | 3 |
| 132 | `frontend/src/components/products/surfaces/ProductRowParts.tsx` | 1 |
| 133 | `frontend/src/components/products/surfaces/ProductsListSurface.tsx` | 3 |
| 134 | `frontend/src/components/receipt-settings/AllFieldsPanel.tsx` | 4 |
| 135 | `frontend/src/components/receipt-settings/constants.ts` | 1 |
| 136 | `frontend/src/components/receipt-settings/ErrorBoundary.tsx` | 1 |
| 137 | `frontend/src/components/receipt-settings/FieldOrderManager.tsx` | 9 |
| 138 | `frontend/src/components/receipt-settings/PrintSettings.tsx` | 8 |
| 139 | `frontend/src/components/receipt-settings/ReceiptPreview.tsx` | 3 |
| 140 | `frontend/src/components/receipt-settings/ReceiptSettings.tsx` | 4 |
| 141 | `frontend/src/components/receipt-settings/template.ts` | 2 |
| 142 | `frontend/src/components/receipt/Receipt.tsx` | 10 |
| 143 | `frontend/src/components/returns/EditReturnModal.tsx` | 7 |
| 144 | `frontend/src/components/returns/NewReturnModal.tsx` | 13 |
| 145 | `frontend/src/components/returns/NewSupplierReturnModal.tsx` | 7 |
| 146 | `frontend/src/components/returns/ReturnDetailModal.tsx` | 4 |
| 147 | `frontend/src/components/returns/Returns.tsx` | 12 |
| 148 | `frontend/src/components/returns/ReturnsListSurface.tsx` | 5 |
| 149 | `frontend/src/components/sales/ExportModal.tsx` | 5 |
| 150 | `frontend/src/components/sales/SaleDetailModal.tsx` | 4 |
| 151 | `frontend/src/components/sales/Sales.tsx` | 16 |
| 152 | `frontend/src/components/sales/SalesImportModal.tsx` | 8 |
| 153 | `frontend/src/components/sales/salesImportWorker.ts` | 1 |
| 154 | `frontend/src/components/sales/SalesListSurface.tsx` | 2 |
| 155 | `frontend/src/components/sales/StatusBadge.tsx` | 2 |
| 156 | `frontend/src/components/server/ServerPage.tsx` | 21 |
| 157 | `frontend/src/components/shared/ActionHistoryBar.tsx` | 3 |
| 158 | `frontend/src/components/shared/BackgroundImportTracker.tsx` | 21 |
| 159 | `frontend/src/components/shared/ExportMenu.tsx` | 1 |
| 160 | `frontend/src/components/shared/FilterMenu.tsx` | 2 |
| 161 | `frontend/src/components/shared/globalScroll.ts` | 3 |
| 162 | `frontend/src/components/shared/ImageGalleryLightbox.tsx` | 5 |
| 163 | `frontend/src/components/shared/LoadingWatchdog.tsx` | 1 |
| 164 | `frontend/src/components/shared/Modal.tsx` | 1 |
| 165 | `frontend/src/components/shared/navigationConfig.ts` | 0 |
| 166 | `frontend/src/components/shared/NotificationCenter.tsx` | 9 |
| 167 | `frontend/src/components/shared/pageActivity.ts` | 0 |
| 168 | `frontend/src/components/shared/PageHeader.tsx` | 1 |
| 169 | `frontend/src/components/shared/PaginationControls.tsx` | 3 |
| 170 | `frontend/src/components/shared/PortalMenu.tsx` | 6 |
| 171 | `frontend/src/components/shared/QuickPreferenceToggles.tsx` | 3 |
| 172 | `frontend/src/components/shared/SectionSwitcher.tsx` | 3 |
| 173 | `frontend/src/components/shared/WriteConflictModal.tsx` | 10 |
| 174 | `frontend/src/components/users/PermissionEditor.tsx` | 3 |
| 175 | `frontend/src/components/users/UserDetailSheet.tsx` | 4 |
| 176 | `frontend/src/components/users/UserProfileModal.tsx` | 14 |
| 177 | `frontend/src/components/users/Users.tsx` | 18 |
| 178 | `frontend/src/components/utils-settings/AuditLog.tsx` | 18 |
| 179 | `frontend/src/components/utils-settings/Backup.tsx` | 34 |
| 180 | `frontend/src/components/utils-settings/FontFamilyPicker.tsx` | 1 |
| 181 | `frontend/src/components/utils-settings/index.ts` | 0 |
| 182 | `frontend/src/components/utils-settings/OtpModal.tsx` | 4 |
| 183 | `frontend/src/components/utils-settings/ResetData.tsx` | 10 |
| 184 | `frontend/src/components/utils-settings/Settings.tsx` | 26 |
| 185 | `frontend/src/components/utils-settings/settingsConflict.ts` | 1 |
| 186 | `frontend/src/constants.ts` | 0 |
| 187 | `frontend/src/index.tsx` | 12 |
| 188 | `frontend/src/platform/runtime/clientRuntime.ts` | 9 |
| 189 | `frontend/src/platform/storage/storagePolicy.ts` | 0 |
| 190 | `frontend/src/public-runtime/runtime-noise-guard.ts` | 8 |
| 191 | `frontend/src/public-runtime/service-worker.ts` | 24 |
| 192 | `frontend/src/public-runtime/theme-bootstrap.ts` | 15 |
| 193 | `frontend/src/runtime/runtimeErrorClassifier.ts` | 5 |
| 194 | `frontend/src/types/lucide-react-icons.d.ts` | 0 |
| 195 | `frontend/src/types/receiptContracts.ts` | 0 |
| 196 | `frontend/src/types/settingsContracts.ts` | 0 |
| 197 | `frontend/src/utils/actionGuards.ts` | 1 |
| 198 | `frontend/src/utils/actionHistory.ts` | 4 |
| 199 | `frontend/src/utils/appRefresh.ts` | 0 |
| 200 | `frontend/src/utils/bulkOps.ts` | 1 |
| 201 | `frontend/src/utils/color.ts` | 2 |
| 202 | `frontend/src/utils/csv.ts` | 8 |
| 203 | `frontend/src/utils/csvExportWorker.ts` | 1 |
| 204 | `frontend/src/utils/csvImport.ts` | 8 |
| 205 | `frontend/src/utils/csvRowCounter.ts` | 1 |
| 206 | `frontend/src/utils/csvTemplate.ts` | 0 |
| 207 | `frontend/src/utils/dateHelpers.ts` | 1 |
| 208 | `frontend/src/utils/deviceInfo.ts` | 2 |
| 209 | `frontend/src/utils/exportPackage.ts` | 0 |
| 210 | `frontend/src/utils/exportReports.tsx` | 8 |
| 211 | `frontend/src/utils/favicon.ts` | 3 |
| 212 | `frontend/src/utils/formatters.ts` | 1 |
| 213 | `frontend/src/utils/groupedRecords.ts` | 3 |
| 214 | `frontend/src/utils/historyHelpers.ts` | 0 |
| 215 | `frontend/src/utils/importJobRefresh.ts` | 4 |
| 216 | `frontend/src/utils/index.ts` | 0 |
| 217 | `frontend/src/utils/initials.ts` | 1 |
| 218 | `frontend/src/utils/loaders.ts` | 0 |
| 219 | `frontend/src/utils/mediaUpload.ts` | 0 |
| 220 | `frontend/src/utils/permissions.ts` | 1 |
| 221 | `frontend/src/utils/pricing.ts` | 0 |
| 222 | `frontend/src/utils/printReceipt.ts` | 30 |
| 223 | `frontend/src/utils/productBatches.ts` | 1 |
| 224 | `frontend/src/utils/productGrouping.ts` | 9 |
| 225 | `frontend/src/utils/publicAssetUrls.ts` | 6 |
| 226 | `frontend/src/utils/receiptAppliedConfig.ts` | 1 |
| 227 | `frontend/src/utils/scriptTypography.ts` | 0 |
| 228 | `frontend/src/utils/settingsRefresh.ts` | 1 |
| 229 | `frontend/src/utils/settingsWriteOptions.ts` | 0 |
| 230 | `frontend/src/web-api.ts` | 47 |
| 231 | `ops/scripts/frontend/build-public-runtime-scripts.ts` | 5 |
| 232 | `ops/scripts/frontend/verify-i18n.ts` | 6 |
| 233 | `ops/scripts/frontend/verify-performance.ts` | 4 |
| 234 | `ops/scripts/frontend/verify-ui.ts` | 11 |
| 235 | `frontend/vite.config.ts` | 5 |
| 236 | `frontend/tailwind.config.ts` | 0 |

## 3. Detailed Function Commentary

### 3.1 `frontend/src/api/accessControlTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `encodeId` | function | 9 |

### 3.2 `frontend/src/api/actionHistoryTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDevicePayload` | function | 7 |

### 3.3 `frontend/src/api/actorQuery.ts`

- No top-level named function/class symbols detected.

### 3.4 `frontend/src/api/aiTransport.ts`

- No top-level named function/class symbols detected.

### 3.5 `frontend/src/api/appBootstrapTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `emptyBootstrap` | function | 25 |
| 2 | `readStoredUser` | function | 37 |
| 3 | `readErrorField` | function | 47 |
| 4 | `ensureBootstrapServerUrl` | function | 52 |
| 5 | `buildLocalBootstrap` | function | 63 |

### 3.6 `frontend/src/api/auditLogTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeAuditPageSize` | function | 10 |

### 3.7 `frontend/src/api/authTransport.ts`

- No top-level named function/class symbols detected.

### 3.8 `frontend/src/api/branchTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDevicePayload` | function | 10 |
| 2 | `encodeId` | function | 14 |

### 3.9 `frontend/src/api/browserDialogs.ts`

- No top-level named function/class symbols detected.

### 3.10 `frontend/src/api/conflicts.ts`

- No top-level named function/class symbols detected.

### 3.11 `frontend/src/api/contactsTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getLocalDbModule` | function | 41 |
| 2 | `getDevicePayload` | function | 46 |
| 3 | `encodeId` | function | 50 |
| 4 | `hasPagedParams` | function | 54 |
| 5 | `localSortedRows` | function | 59 |
| 6 | `readContactList` | function | 64 |
| 7 | `createContact` | function | 86 |
| 8 | `updateContact` | function | 96 |
| 9 | `deleteContact` | function | 110 |
| 10 | `bulkImportContact` | function | 120 |

### 3.12 `frontend/src/api/cooldownFallbacks.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readBrowserStoredNumber` | function | 23 |
| 2 | `writeBrowserStoredNumber` | function | 36 |
| 3 | `clearBrowserStoredNumber` | function | 44 |

### 3.13 `frontend/src/api/customTablesTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `encodePathSegment` | function | 24 |
| 2 | `tableDataPath` | function | 28 |
| 3 | `tableRowPath` | function | 32 |

### 3.14 `frontend/src/api/dashboardTransport.ts`

- No top-level named function/class symbols detected.

### 3.15 `frontend/src/api/driveSync.ts`

- No top-level named function/class symbols detected.

### 3.16 `frontend/src/api/expectedUpdatedAt.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getLocalDbModule` | function | 13 |
| 2 | `hasExpectedUpdatedAt` | function | 18 |

### 3.17 `frontend/src/api/fileTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeFileListResult` | function | 64 |
| 2 | `appendUserAndDeviceFields` | function | 78 |
| 3 | `dataUrlToBlob` | function | 87 |
| 4 | `parseJsonResponse` | function | 94 |
| 5 | `finish` | const arrow | 129 |

### 3.18 `frontend/src/api/http.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `hasStoredAuthSession` | function | 88 |
| 2 | `isProtectedAdminHost` | function | 97 |
| 3 | `normalizeApiPath` | function | 114 |
| 4 | `getApiMismatchKey` | function | 131 |
| 5 | `dispatchApiVersionMismatch` | function | 146 |
| 6 | `logCall` | function | 225 |
| 7 | `getClientMetaHeaders` | function | 233 |
| 8 | `createApiError` | function | 237 |
| 9 | `createCloudflareAccessError` | function | 266 |
| 10 | `dispatchUnauthorized` | function | 276 |
| 11 | `dispatchRuntimeVersionMismatch` | function | 304 |
| 12 | `checkRuntimeVersionFromHealth` | function | 316 |
| 13 | `createWriteBlockedError` | function | 323 |
| 14 | `dispatchWriteBlocked` | function | 334 |
| 15 | `dispatchTransientGatewayOutage` | function | 349 |
| 16 | `getConflictRefreshChannels` | function | 414 |
| 17 | `dispatchGlobalDataRefresh` | function | 423 |
| 18 | `sleep` | function | 432 |
| 19 | `hasUsableLocalData` | function | 436 |
| 20 | `noteReadFailure` | function | 462 |
| 21 | `stableStringifyForDedupe` | function | 483 |
| 22 | `clampDedupeBody` | function | 493 |
| 23 | `methodAllowsRequestBody` | function | 505 |
| 24 | `parsed` | const arrow | 583 |
| 25 | `shouldDispatchUnauthorized` | function | 644 |
| 26 | `isConnectivityError` | function | 657 |
| 27 | `setServerHealth` | function | 685 |
| 28 | `getChannelRefreshKey` | function | 824 |
| 29 | `emitCacheRefresh` | function | 829 |
| 30 | `clearInflight` | function | 843 |
| 31 | `hasReusableInflight` | function | 848 |

### 3.19 `frontend/src/api/importJobsTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `encodeId` | function | 38 |
| 2 | `getSource` | function | 42 |
| 3 | `appendDeviceFields` | function | 46 |
| 4 | `notifyImportJobActivity` | function | 53 |
| 5 | `runImportJobAction` | function | 121 |

### 3.20 `frontend/src/api/importTransport.ts`

- No top-level named function/class symbols detected.

### 3.21 `frontend/src/api/inventoryTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDevicePayload` | function | 21 |

### 3.22 `frontend/src/api/lazyLocalDb.ts`

- No top-level named function/class symbols detected.

### 3.23 `frontend/src/api/localDb.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `splitCSVLine` | function | 268 |

### 3.24 `frontend/src/api/localMirrors.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getLocalDbModule` | function | 13 |
| 2 | `scheduleMirrorWrite` | function | 18 |
| 3 | `idle` | const arrow | 24 |

### 3.25 `frontend/src/api/lookupTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `listLookupRows` | function | 26 |
| 2 | `createLookupRow` | function | 38 |
| 3 | `updateLookupRow` | function | 47 |
| 4 | `deleteLookupRow` | function | 60 |

### 3.26 `frontend/src/api/methods.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDeviceInfo` | function | 6 |
| 2 | `loadPortalTransport` | function | 13 |
| 3 | `loadLocalDbModule` | function | 18 |
| 4 | `getLocalDb` | function | 23 |
| 5 | `localGetSettings` | function | 28 |
| 6 | `localSaveSettings` | function | 33 |
| 7 | `localSaveSettingsMeta` | function | 38 |
| 8 | `loadSystemRuntimeModule` | function | 292 |
| 9 | `callSystemRuntimeMethod` | function | 297 |
| 10 | `scheduleSensitiveMirrorPurge` | function | 304 |
| 11 | `run` | const arrow | 305 |
| 12 | `canRefreshOfflineDeviceSnapshot` | function | 367 |
| 13 | `readOfflineDeviceSnapshotMeta` | function | 374 |
| 14 | `writeOfflineDeviceSnapshotMeta` | function | 383 |
| 15 | `runOfflineSnapshotStep` | function | 401 |
| 16 | `previousMeta` | const arrow | 421 |
| 17 | `invalidateClientRuntimeState` | function | 466 |
| 18 | `login` | const arrow | 497 |
| 19 | `logout` | const arrow | 499 |
| 20 | `resetPasswordWithOtp` | const arrow | 501 |
| 21 | `requestPasswordResetEmail` | const arrow | 503 |
| 22 | `completePasswordReset` | const arrow | 505 |
| 23 | `updateSessionDuration` | const arrow | 507 |
| 24 | `getVerificationCapabilities` | const arrow | 509 |
| 25 | `getSystemConfig` | const arrow | 511 |
| 26 | `getSystemBootstrap` | const arrow | 513 |
| 27 | `getSystemDebugLog` | const arrow | 518 |
| 28 | `startGoogleOauth` | const arrow | 520 |
| 29 | `completeGoogleOauth` | const arrow | 522 |
| 30 | `unlinkGoogleOauth` | const arrow | 524 |
| 31 | `getAppBootstrap` | const arrow | 526 |
| 32 | `getOrganizationBootstrap` | const arrow | 530 |
| 33 | `searchOrganizations` | const arrow | 532 |
| 34 | `getCurrentOrganization` | const arrow | 534 |
| 35 | `runSave` | const arrow | 560 |
| 36 | `getCategories` | const arrow | 623 |
| 37 | `updateCategory` | const arrow | 630 |
| 38 | `deleteCategory` | const arrow | 635 |
| 39 | `getUnits` | const arrow | 642 |
| 40 | `updateUnit` | const arrow | 649 |
| 41 | `deleteUnit` | const arrow | 654 |
| 42 | `getBranches` | const arrow | 661 |
| 43 | `getBranchSummary` | const arrow | 663 |
| 44 | `updateBranch` | const arrow | 667 |
| 45 | `deleteBranch` | const arrow | 669 |
| 46 | `getBranchStock` | const arrow | 671 |
| 47 | `getTransfers` | const arrow | 673 |
| 48 | `getBranchStockIntegrity` | const arrow | 677 |
| 49 | `getProducts` | const arrow | 683 |
| 50 | `searchProducts` | const arrow | 685 |
| 51 | `getProductBootstrap` | const arrow | 687 |
| 52 | `getProductsByIds` | const arrow | 689 |
| 53 | `getProductFilters` | const arrow | 691 |
| 54 | `getProductLookupUsage` | const arrow | 693 |
| 55 | `replaceProductLookupValues` | const arrow | 695 |
| 56 | `getPortalSubmissionsForReview` | const arrow | 741 |
| 57 | `reviewPortalSubmission` | const arrow | 745 |
| 58 | `getAiProviders` | const arrow | 750 |
| 59 | `createAiProvider` | const arrow | 752 |
| 60 | `updateAiProvider` | const arrow | 754 |
| 61 | `deleteAiProvider` | const arrow | 756 |
| 62 | `testAiProvider` | const arrow | 758 |
| 63 | `getAiResponses` | const arrow | 760 |
| 64 | `createProduct` | const arrow | 762 |
| 65 | `updateProduct` | const arrow | 764 |
| 66 | `deleteProduct` | const arrow | 766 |
| 67 | `otpSetup` | const arrow | 770 |
| 68 | `otpConfirm` | const arrow | 772 |
| 69 | `otpDisable` | const arrow | 774 |
| 70 | `otpVerify` | const arrow | 776 |
| 71 | `otpStatus` | const arrow | 778 |
| 72 | `listImportJobs` | const arrow | 790 |
| 73 | `getImportJobReview` | const arrow | 794 |
| 74 | `updateImportJobDecisions` | const arrow | 796 |
| 75 | `startImportJob` | const arrow | 800 |
| 76 | `approveImportJob` | const arrow | 802 |
| 77 | `cancelImportJob` | const arrow | 804 |
| 78 | `retryImportJob` | const arrow | 806 |
| 79 | `deleteImportJob` | const arrow | 808 |
| 80 | `getImportQueueStatus` | const arrow | 810 |
| 81 | `getFiles` | const arrow | 821 |
| 82 | `deleteFileAsset` | const arrow | 827 |
| 83 | `getActionHistory` | const arrow | 865 |
| 84 | `updateActionHistory` | const arrow | 870 |
| 85 | `getInventorySummary` | const arrow | 876 |
| 86 | `getInventoryStats` | const arrow | 878 |
| 87 | `getInventoryBootstrap` | const arrow | 880 |
| 88 | `searchInventoryProducts` | const arrow | 882 |
| 89 | `getInventoryMovements` | const arrow | 884 |
| 90 | `getInventoryReasons` | const arrow | 886 |
| 91 | `saveInventoryReasons` | const arrow | 888 |
| 92 | `buildOfflineSaleReceiptNumber` | function | 891 |
| 93 | `isRetryableOfflineSaleError` | function | 897 |
| 94 | `findQueuedSale` | function | 906 |
| 95 | `putOfflineSaleMirror` | function | 914 |
| 96 | `queueOfflineSale` | function | 940 |
| 97 | `queuedSaleBackoffMs` | function | 999 |
| 98 | `updateQueuedRow` | function | 1004 |
| 99 | `completeQueuedSale` | function | 1014 |
| 100 | `failQueuedSale` | function | 1038 |
| 101 | `markQueuedSaleConflict` | function | 1051 |
| 102 | `syncPendingSalesQueue` | function | 1073 |
| 103 | `getRfidStatus` | const arrow | 1117 |
| 104 | `searchRfidTags` | const arrow | 1122 |
| 105 | `recordRfidSessionEvents` | const arrow | 1127 |
| 106 | `applyRfidSession` | const arrow | 1131 |
| 107 | `getSales` | const arrow | 1147 |
| 108 | `getDashboard` | const arrow | 1152 |
| 109 | `getAnalytics` | const arrow | 1153 |
| 110 | `getCustomers` | const arrow | 1156 |
| 111 | `getCustomerPointSummaries` | const arrow | 1159 |
| 112 | `updateCustomer` | const arrow | 1165 |
| 113 | `deleteCustomer` | const arrow | 1168 |
| 114 | `downloadCustomerTemplate` | const arrow | 1173 |
| 115 | `getSuppliers` | const arrow | 1177 |
| 116 | `updateSupplier` | const arrow | 1183 |
| 117 | `deleteSupplier` | const arrow | 1186 |
| 118 | `downloadSupplierTemplate` | const arrow | 1191 |
| 119 | `getDeliveryContacts` | const arrow | 1195 |
| 120 | `updateDeliveryContact` | const arrow | 1201 |
| 121 | `deleteDeliveryContact` | const arrow | 1204 |
| 122 | `getUsers` | const arrow | 1211 |
| 123 | `updateUser` | const arrow | 1213 |
| 124 | `getUserProfile` | const arrow | 1214 |
| 125 | `getUserAuthMethods` | const arrow | 1215 |
| 126 | `updateUserProfile` | const arrow | 1217 |
| 127 | `disconnectUserAuthProvider` | const arrow | 1219 |
| 128 | `changeUserPassword` | const arrow | 1221 |
| 129 | `resetPassword` | const arrow | 1223 |
| 130 | `getRoles` | const arrow | 1226 |
| 131 | `updateRole` | const arrow | 1228 |
| 132 | `deleteRole` | const arrow | 1229 |
| 133 | `getCustomTables` | const arrow | 1232 |
| 134 | `getCustomTableData` | const arrow | 1234 |
| 135 | `insertCustomRow` | const arrow | 1235 |
| 136 | `updateCustomRow` | const arrow | 1236 |
| 137 | `deleteCustomRow` | const arrow | 1237 |
| 138 | `getAuditLogs` | const arrow | 1240 |
| 139 | `deleteAuditLogsRetention` | const arrow | 1243 |
| 140 | `getIntegrationDoctor` | const arrow | 1259 |
| 141 | `getGoogleDriveSyncStatus` | const arrow | 1282 |
| 142 | `saveGoogleDriveSyncPreferences` | const arrow | 1285 |
| 143 | `startGoogleDriveSyncOauth` | const arrow | 1288 |
| 144 | `disconnectGoogleDriveSync` | const arrow | 1291 |
| 145 | `forgetGoogleDriveSyncCredentials` | const arrow | 1294 |
| 146 | `queueGoogleDriveSyncNow` | const arrow | 1297 |
| 147 | `syncGoogleDriveNow` | const arrow | 1300 |
| 148 | `openPath` | const arrow | 1365 |
| 149 | `getReturns` | const arrow | 1369 |
| 150 | `updateSaleStatus` | const arrow | 1393 |
| 151 | `attachSaleCustomer` | const arrow | 1410 |
| 152 | `getSalesExport` | const arrow | 1435 |
| 153 | `updateReturn` | const arrow | 1439 |
| 154 | `testSyncServer` | const arrow | 1464 |
| 155 | `openFolderDialog` | const arrow | 1469 |
| 156 | `getDataPath` | const arrow | 1473 |
| 157 | `getScaleMigrationStatus` | const arrow | 1475 |
| 158 | `prepareScaleMigration` | const arrow | 1477 |
| 159 | `runScaleMigration` | const arrow | 1479 |
| 160 | `browseDir` | const arrow | 1491 |

### 3.27 `frontend/src/api/notificationSummary.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `buildNotificationSummaryFallback` | function | 12 |

### 3.28 `frontend/src/api/portalHttp.ts`

- No top-level named function/class symbols detected.

### 3.29 `frontend/src/api/portalTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readJsonObject` | function | 18 |
| 2 | `fetchPortalJson` | function | 22 |

### 3.30 `frontend/src/api/productReadTransport.ts`

- No top-level named function/class symbols detected.

### 3.31 `frontend/src/api/productWriteTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDevicePayload` | function | 9 |
| 2 | `encodeId` | function | 13 |
| 3 | `ensureSupplierExists` | function | 17 |

### 3.32 `frontend/src/api/query.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `appendQueryValue` | function | 44 |

### 3.33 `frontend/src/api/queryCache.ts`

- No top-level named function/class symbols detected.

### 3.34 `frontend/src/api/requestIds.ts`

- No top-level named function/class symbols detected.

### 3.35 `frontend/src/api/rfidTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDevicePayload` | function | 7 |
| 2 | `encodeId` | function | 11 |

### 3.36 `frontend/src/api/salesTransport.ts`

- No top-level named function/class symbols detected.

### 3.37 `frontend/src/api/syncPreview.ts`

- No top-level named function/class symbols detected.

### 3.38 `frontend/src/api/syncRuntime.ts`

- No top-level named function/class symbols detected.

### 3.39 `frontend/src/api/systemJobs.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `wait` | function | 25 |
| 2 | `requireJobId` | function | 29 |
| 3 | `unwrapSystemJob` | function | 35 |

### 3.40 `frontend/src/api/systemRuntime.ts`

- No top-level named function/class symbols detected.

### 3.41 `frontend/src/api/websocket.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `clearReconnectTimer` | function | 22 |
| 2 | `clearPingTimer` | function | 28 |
| 3 | `hasStoredAuthSession` | function | 34 |
| 4 | `isProtectedAdminHost` | function | 43 |
| 5 | `shouldDebugWs` | function | 53 |
| 6 | `logWs` | function | 63 |
| 7 | `scheduleReconnect` | function | 191 |

### 3.42 `frontend/src/App.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `asPageModule` | function | 188 |
| 2 | `getAppShellApi` | function | 192 |
| 3 | `getConnection` | function | 196 |
| 4 | `isPageId` | function | 202 |
| 5 | `normalizePageId` | function | 206 |
| 6 | `getErrorMessage` | function | 210 |
| 7 | `getChunkErrorMessage` | function | 309 |
| 8 | `isChunkLoadError` | function | 314 |
| 9 | `createChunkTimeoutError` | function | 323 |
| 10 | `isRetryableImportError` | function | 329 |
| 11 | `importWithTimeout` | function | 337 |
| 12 | `clearRetryMarker` | function | 353 |
| 13 | `buildChunkRecoveryUrl` | function | 360 |
| 14 | `deleteStaleShellCaches` | function | 371 |
| 15 | `clearStaleShellCaches` | function | 384 |
| 16 | `triggerChunkRecoveryReload` | function | 394 |
| 17 | `reload` | const arrow | 401 |
| 18 | `createChunkReloadStallError` | function | 411 |
| 19 | `shouldRetryChunk` | function | 417 |
| 20 | `lazyWithRetry` | function | 427 |
| 21 | `getWarmupImporters` | function | 503 |
| 22 | `shouldSkipBackgroundWarmup` | function | 514 |
| 23 | `shouldSkipIntentWarmup` | function | 523 |
| 24 | `getIntentPageId` | function | 532 |
| 25 | `scheduleIntentChunkLoad` | function | 538 |
| 26 | `run` | const arrow | 545 |
| 27 | `scheduleInitialPendingSyncRefresh` | function | 569 |
| 28 | `run` | const arrow | 575 |
| 29 | `scheduleDeferredPendingSyncPolling` | function | 597 |
| 30 | `isImportTrackerWakeEvent` | function | 611 |
| 31 | `isNotificationCenterWakeEvent` | function | 626 |
| 32 | `getDataWarmupLoaders` | function | 644 |
| 33 | `createWarmupLoader` | function | 653 |
| 34 | `runWarmupBatches` | function | 658 |
| 35 | `scheduleWarmupAfterLoad` | function | 667 |
| 36 | `run` | const arrow | 672 |
| 37 | `getPageEntryWarmupLoaders` | function | 690 |
| 38 | `useMountedPages` | function | 697 |
| 39 | `syncProfile` | const arrow | 711 |
| 40 | `useSyncErrorBanner` | function | 740 |
| 41 | `refreshPendingSync` | const arrow | 760 |
| 42 | `onSyncError` | const arrow | 765 |
| 43 | `onTransientOutage` | const arrow | 771 |
| 44 | `onSyncRecovered` | const arrow | 779 |
| 45 | `onQueueChanged` | const arrow | 787 |
| 46 | `onVaultLocked` | const arrow | 788 |
| 47 | `onAppUpdate` | const arrow | 789 |
| 48 | `onConflictReview` | const arrow | 790 |
| 49 | `useDeferredImportTrackerMount` | function | 838 |
| 50 | `enable` | const arrow | 851 |
| 51 | `enableWhenVisible` | const arrow | 855 |
| 52 | `onImportJobActivity` | const arrow | 860 |
| 53 | `useDeferredNotificationCenterMount` | function | 885 |
| 54 | `enable` | const arrow | 904 |
| 55 | `enableWhenVisible` | const arrow | 908 |
| 56 | `onSyncUpdate` | const arrow | 912 |
| 57 | `onNotificationActivity` | const arrow | 915 |
| 58 | `useVisibilityRecovery` | function | 950 |
| 59 | `onVisible` | const arrow | 955 |
| 60 | `onFocus` | const arrow | 965 |
| 61 | `useChunkWarmup` | function | 983 |
| 62 | `runWarmup` | const arrow | 994 |
| 63 | `useIntentChunkWarmup` | function | 1036 |
| 64 | `warmIntentPage` | const arrow | 1043 |
| 65 | `useDataWarmup` | function | 1063 |
| 66 | `runWarmup` | const arrow | 1075 |
| 67 | `usePageEntryWarmup` | function | 1100 |
| 68 | `run` | const arrow | 1129 |
| 69 | `PageErrorBoundary` | class | 1158 |
| 70 | `Notification` | function | 1211 |
| 71 | `SyncErrorBanner` | function | 1224 |
| 72 | `GlobalScrollControls` | function | 1246 |
| 73 | `scrollTo` | const arrow | 1247 |
| 74 | `formatSyncTimestamp` | function | 1284 |
| 75 | `OfflineModeBanner` | function | 1299 |
| 76 | `PageLoader` | function | 1448 |
| 77 | `NotificationCenterFallback` | function | 1491 |
| 78 | `PageSlot` | function | 1506 |
| 79 | `PublicCatalogView` | function | 1532 |
| 80 | `App` | component/function | 1542 |
| 81 | `cleanupRecoveryStorageMarkers` | const arrow | 1619 |
| 82 | `onQueued` | const arrow | 1648 |
| 83 | `onSynced` | const arrow | 1661 |
| 84 | `handleLocationChange` | const arrow | 1686 |
| 85 | `processFavicon` | function | 1734 |

### 3.43 `frontend/src/app/appShellUtils.ts`

- No top-level named function/class symbols detected.

### 3.44 `frontend/src/app/publicErrorRecovery.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getRecoveryStorage` | function | 6 |

### 3.45 `frontend/src/AppContext.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getAppApi` | function | 198 |
| 2 | `getErrorMessage` | function | 208 |
| 3 | `flattenTranslationTree` | function | 212 |
| 4 | `safeStorageGet` | function | 268 |
| 5 | `safeStorageSet` | function | 276 |
| 6 | `safeStorageRemove` | function | 282 |
| 7 | `getStoredUserPayload` | function | 288 |
| 8 | `getStoredUserExpiry` | function | 292 |
| 9 | `clearPersistedAuthState` | function | 296 |
| 10 | `persistAuthState` | function | 309 |
| 11 | `computeSessionExpiryMs` | function | 331 |
| 12 | `readDeviceSettings` | function | 347 |
| 13 | `writeDeviceSettings` | function | 356 |
| 14 | `writeStoredSessionDuration` | function | 362 |
| 15 | `readPendingOauthLink` | function | 370 |
| 16 | `clearPendingOauthLink` | function | 384 |
| 17 | `readOauthCallbackResult` | function | 390 |
| 18 | `clearOauthCallbackResult` | function | 401 |
| 19 | `mergeSettingsWithDeviceOverrides` | function | 407 |
| 20 | `normalizeDateInput` | function | 411 |
| 21 | `buildRuntimeDescriptorFromBootstrap` | function | 429 |
| 22 | `getInitialAdminPage` | function | 458 |
| 23 | `LoadingScreen` | function | 463 |
| 24 | `AccessDenied` | function | 476 |
| 25 | `persistAutoSyncUrl` | const arrow | 565 |
| 26 | `onUpdate` | const arrow | 763 |
| 27 | `onStatus` | const arrow | 795 |
| 28 | `poll` | const arrow | 804 |
| 29 | `onError` | const arrow | 824 |
| 30 | `onWriteBlocked` | const arrow | 846 |
| 31 | `onRuntimeMismatch` | const arrow | 856 |
| 32 | `onConflict` | const arrow | 876 |
| 33 | `onUnauthorized` | const arrow | 945 |
| 34 | `handleOtpLogin` | const arrow | 1004 |
| 35 | `handleUserUpdated` | const arrow | 1046 |
| 36 | `discoverSyncUrl` | const arrow | 1083 |
| 37 | `runStartupHealthProbe` | const arrow | 1106 |
| 38 | `clearCallbackUrl` | const arrow | 1477 |
| 39 | `clearPendingLink` | const arrow | 1481 |
| 40 | `run` | const arrow | 1485 |

### 3.46 `frontend/src/components/auth/Login.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getAuthApi` | function | 176 |
| 2 | `getErrorMessage` | function | 181 |
| 3 | `readPendingOauthLogin` | function | 185 |
| 4 | `clearPendingOauthLogin` | function | 199 |
| 5 | `readOauthCallbackResult` | function | 205 |
| 6 | `clearOauthCallbackResult` | function | 216 |
| 7 | `OauthButton` | function | 222 |
| 8 | `ModeBackButton` | function | 236 |
| 9 | `Login` | component/function | 249 |
| 10 | `rememberOrganization` | const arrow | 321 |
| 11 | `loadCapabilities` | const arrow | 357 |
| 12 | `bootstrap` | const arrow | 377 |
| 13 | `clearCallbackUrl` | const arrow | 456 |
| 14 | `run` | const arrow | 461 |
| 15 | `rememberedOrg` | const arrow | 516 |
| 16 | `handleLogin` | const arrow | 570 |
| 17 | `handleOtp` | const arrow | 600 |
| 18 | `handleOtpInput` | const arrow | 634 |
| 19 | `handleResetWithOtp` | const arrow | 639 |
| 20 | `handleResetWithEmail` | const arrow | 676 |
| 21 | `handleCompleteEmailReset` | const arrow | 705 |
| 22 | `handleStartOauth` | const arrow | 738 |
| 23 | `closeAuxMode` | const arrow | 786 |

### 3.47 `frontend/src/components/branches/Branches.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBranchApi` | function | 185 |
| 2 | `getErrorMessage` | function | 189 |
| 3 | `isBranchRecord` | function | 193 |
| 4 | `isTransferRecord` | function | 197 |
| 5 | `BranchStatTile` | function | 201 |
| 6 | `formatTransferDate` | function | 218 |
| 7 | `Branches` | component/function | 235 |
| 8 | `promise` | const arrow | 283 |
| 9 | `loadBranchStock` | const arrow | 433 |
| 10 | `loadMoreBranchStock` | const arrow | 454 |
| 11 | `handleSaveBranch` | const arrow | 485 |
| 12 | `handleDelete` | const arrow | 553 |
| 13 | `handleBulkDelete` | const arrow | 601 |
| 14 | `toggleSelect` | const arrow | 687 |
| 15 | `toggleSelectAll` | const arrow | 696 |

### 3.48 `frontend/src/components/branches/BranchForm.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `BranchForm` | component/function | 37 |
| 2 | `handleSave` | const arrow | 57 |

### 3.49 `frontend/src/components/branches/TransferModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getTransferApi` | function | 71 |
| 2 | `getErrorMessage` | function | 76 |
| 3 | `normalizeTransferStockRows` | function | 80 |
| 4 | `TransferModal` | component/function | 94 |
| 5 | `loadStock` | function | 146 |
| 6 | `handleTransfer` | const arrow | 194 |

### 3.50 `frontend/src/components/catalog/CatalogEditorSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `CatalogEditorSurface` | component/function | 200 |

### 3.51 `frontend/src/components/catalog/CatalogImageField.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `CatalogImageField` | component/function | 29 |

### 3.52 `frontend/src/components/catalog/CatalogPage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadCatalogEditorSurface` | const arrow | 86 |
| 2 | `loadCatalogSecondaryTabs` | const arrow | 87 |
| 3 | `loadCatalogProductsSection` | const arrow | 88 |
| 4 | `loadCatalogPreviewSurface` | const arrow | 89 |
| 5 | `getCatalogApi` | function | 254 |
| 6 | `getCatalogErrorMessage` | function | 258 |
| 7 | `createInitialUploadState` | function | 262 |
| 8 | `isTemporaryPreviewUrl` | function | 276 |
| 9 | `sanitizePersistedMediaPath` | function | 281 |
| 10 | `buildCacheBustedMediaPath` | function | 288 |
| 11 | `reduceUploadState` | function | 306 |
| 12 | `normalizePortalInitialOptions` | function | 373 |
| 13 | `normalizeCatalogOptions` | function | 382 |
| 14 | `normalizeBrandOptions` | function | 393 |
| 15 | `getAboutBlockLabel` | function | 398 |
| 16 | `withAssetVersion` | function | 404 |
| 17 | `sanitizePortalMediaValue` | function | 414 |
| 18 | `tt` | function | 424 |
| 19 | `toBoolean` | function | 432 |
| 20 | `toNumber` | function | 439 |
| 21 | `normalizePriceDisplay` | function | 446 |
| 22 | `normalizeHexColor` | function | 452 |
| 23 | `normalizeExternalUrl` | function | 458 |
| 24 | `createFaqId` | function | 474 |
| 25 | `normalizeFaqItems` | function | 478 |
| 26 | `translatedPortalText` | function | 534 |
| 27 | `translateConfiguredFaqText` | function | 540 |
| 28 | `localizeConfiguredFaqItems` | function | 547 |
| 29 | `buildFaqStarterItems` | function | 555 |
| 30 | `buildAiFaqStarterItems` | function | 564 |
| 31 | `hexToRgba` | function | 574 |
| 32 | `readPortalCache` | function | 585 |
| 33 | `writePortalCache` | function | 608 |
| 34 | `normalizePortalPath` | function | 627 |
| 35 | `isReservedPortalPath` | function | 640 |
| 36 | `getPortalTabs` | function | 644 |
| 37 | `resolvePortalActiveTab` | function | 655 |
| 38 | `buildDraft` | function | 663 |
| 39 | `applyDraft` | function | 763 |
| 40 | `getBranchQty` | function | 887 |
| 41 | `getStockStatus` | function | 894 |
| 42 | `normalizeProductGallery` | function | 905 |
| 43 | `normalizePortalProductSearch` | function | 922 |
| 44 | `buildRecommendedProductOption` | function | 926 |
| 45 | `productMatchesRecommendedSearch` | function | 936 |
| 46 | `formatDateTime` | function | 951 |
| 47 | `formatPortalPrice` | function | 959 |
| 48 | `ImageField` | function | 972 |
| 49 | `readImageFileAsDataUrl` | function | 1061 |
| 50 | `readImageFilesAsDataUrls` | function | 1070 |
| 51 | `pickImageAsDataUrl` | function | 1093 |
| 52 | `pickMultipleImagesAsDataUrls` | function | 1106 |
| 53 | `replaceVars` | function | 1119 |
| 54 | `getPortalResourceText` | function | 1123 |
| 55 | `isFirstPartyTranslateTarget` | function | 1161 |
| 56 | `normalizePortalTranslateChoice` | function | 1168 |
| 57 | `isDocumentVisible` | function | 1176 |
| 58 | `sleep` | function | 1181 |
| 59 | `CatalogPage` | component/function | 1287 |
| 60 | `warmPublicProductsPanel` | const arrow | 1403 |
| 61 | `warmPublicSecondaryTabs` | const arrow | 1407 |
| 62 | `updateMediaUploadState` | const arrow | 1559 |
| 63 | `forgetMediaUploadState` | const arrow | 1566 |
| 64 | `loadAssistantStatus` | function | 1618 |
| 65 | `openProductGallery` | function | 1641 |
| 66 | `changeTranslateTarget` | function | 1654 |
| 67 | `isPortalLoadCurrent` | function | 1702 |
| 68 | `loadPortalEditorData` | function | 1706 |
| 69 | `refreshPortalView` | function | 1748 |
| 70 | `loadPortal` | function | 1777 |
| 71 | `ensureLink` | const arrow | 2042 |
| 72 | `updateVisibility` | const arrow | 2135 |
| 73 | `handleScroll` | const arrow | 2165 |
| 74 | `initWidget` | const arrow | 2210 |
| 75 | `waitForWidget` | const arrow | 2228 |
| 76 | `toggleFilterValue` | function | 2352 |
| 77 | `clearPortalFilters` | function | 2360 |
| 78 | `setDraft` | function | 2368 |
| 79 | `toggleRecommendedProduct` | function | 2373 |
| 80 | `openPortalImage` | function | 2382 |
| 81 | `setAboutBlocksDraft` | function | 2393 |
| 82 | `setPromoItemsDraft` | function | 2397 |
| 83 | `getPortalMediaValue` | function | 2401 |
| 84 | `setPortalMediaValue` | function | 2415 |
| 85 | `clearPortalUploadPreview` | function | 2429 |
| 86 | `clearPortalMediaTarget` | function | 2435 |
| 87 | `uploadPortalMedia` | function | 2446 |
| 88 | `cancelPortalMediaUpload` | function | 2517 |
| 89 | `updateAboutBlock` | function | 2523 |
| 90 | `updatePromoItem` | function | 2529 |
| 91 | `addAboutBlock` | function | 2535 |
| 92 | `addPromoItem` | function | 2539 |
| 93 | `moveAboutBlockBefore` | function | 2543 |
| 94 | `removeAboutBlock` | function | 2555 |
| 95 | `movePromoItemBefore` | function | 2566 |
| 96 | `removePromoItem` | function | 2578 |
| 97 | `setFaqDraft` | function | 2589 |
| 98 | `addFaqItem` | function | 2593 |
| 99 | `mergeFaqStarterItems` | function | 2604 |
| 100 | `addFaqStarterSet` | function | 2617 |
| 101 | `addAiFaqStarterSet` | function | 2621 |
| 102 | `updateFaqItem` | function | 2625 |
| 103 | `removeFaqItem` | function | 2631 |
| 104 | `clearAssistantState` | function | 2635 |
| 105 | `uploadDraftImage` | function | 2650 |
| 106 | `uploadAboutBlockMedia` | function | 2654 |
| 107 | `uploadPromoItemMedia` | function | 2660 |
| 108 | `openFilePicker` | function | 2664 |
| 109 | `handleFilePickerSelect` | function | 2668 |
| 110 | `savePortalDraft` | function | 2696 |
| 111 | `askAssistant` | function | 2888 |
| 112 | `refreshMembershipData` | function | 2934 |
| 113 | `handleMembershipLookup` | function | 2976 |
| 114 | `addSubmissionImages` | function | 2989 |
| 115 | `handleSubmissionPaste` | function | 2999 |
| 116 | `handleSubmitShareProof` | function | 3015 |
| 117 | `handleReviewSubmission` | function | 3062 |
| 118 | `renderCatalogSection` | function | 3226 |
| 119 | `handleUploadSubmissionImages` | const arrow | 3252 |
| 120 | `renderSecondaryTabPanel` | function | 3308 |
| 121 | `renderSecondaryTabSection` | function | 3320 |
| 122 | `scrollPublicPortal` | const arrow | 3449 |

### 3.53 `frontend/src/components/catalog/CatalogPageContext.tsx`

- No top-level named function/class symbols detected.

### 3.54 `frontend/src/components/catalog/CatalogPreviewSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `CatalogPreviewSurface` | component/function | 113 |
| 2 | `handlePortalTabClick` | const arrow | 151 |

### 3.55 `frontend/src/components/catalog/CatalogProductsSection.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBadgeIcon` | function | 120 |
| 2 | `getBadgeToneClass` | function | 128 |
| 3 | `getProductInitial` | function | 137 |
| 4 | `CatalogProductsSection` | component/function | 145 |

### 3.56 `frontend/src/components/catalog/CatalogSecondaryTabs.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizePortalColor` | function | 267 |
| 2 | `CatalogMembershipSection` | function | 272 |
| 3 | `CatalogAboutSection` | function | 618 |
| 4 | `CatalogFaqSection` | function | 838 |
| 5 | `CatalogAiSection` | function | 892 |
| 6 | `CatalogSecondaryTabs` | component/function | 1078 |

### 3.57 `frontend/src/components/catalog/catalogUi.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `statusClass` | function | 22 |

### 3.58 `frontend/src/components/catalog/portalCatalogDisplay.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `replaceRankVars` | function | 173 |
| 2 | `normalizeRankBadgeLabel` | function | 177 |

### 3.59 `frontend/src/components/catalog/portalContentI18n.ts`

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

### 3.60 `frontend/src/components/catalog/portalEditorUtils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPlainObject` | function | 47 |
| 2 | `toTrimmedString` | function | 51 |

### 3.61 `frontend/src/components/catalog/portalLanguagePacks.ts`

- No top-level named function/class symbols detected.

### 3.62 `frontend/src/components/catalog/portalTranslateController.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeLanguage` | function | 16 |
| 2 | `ensureLinkHint` | function | 108 |

### 3.63 `frontend/src/components/contacts/ContactImportModal.tsx`

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

### 3.64 `frontend/src/components/contacts/contactImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.65 `frontend/src/components/contacts/contactOptionUtils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPlainRecord` | function | 24 |
| 2 | `readStringField` | function | 28 |
| 3 | `normalizeOption` | function | 45 |

### 3.66 `frontend/src/components/contacts/Contacts.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getContactApi` | function | 90 |
| 2 | `getErrorMessage` | function | 95 |
| 3 | `asExportValue` | function | 99 |
| 4 | `normalizeContactExportRows` | function | 103 |
| 5 | `ContactTabFallback` | function | 131 |
| 6 | `ImportTypePicker` | function | 180 |
| 7 | `Contacts` | component/function | 220 |
| 8 | `handleExportAll` | const arrow | 236 |
| 9 | `openImportPicker` | const arrow | 324 |
| 10 | `handleTypeSelected` | const arrow | 326 |
| 11 | `handleImportDone` | const arrow | 331 |

### 3.67 `frontend/src/components/contacts/CustomerFormModal.tsx`

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

### 3.68 `frontend/src/components/contacts/customerMembershipNumber.ts`

- No top-level named function/class symbols detected.

### 3.69 `frontend/src/components/contacts/CustomersTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getCustomerApi` | function | 123 |
| 2 | `isSectionRow` | function | 128 |
| 3 | `normalizeCustomerRows` | function | 132 |
| 4 | `getApiListPayload` | function | 139 |
| 5 | `getErrorMessage` | function | 143 |
| 6 | `formatPoints` | function | 147 |
| 7 | `tr` | function | 159 |
| 8 | `CustomersTab` | function | 168 |
| 9 | `toggleSectionCollapsed` | const arrow | 331 |
| 10 | `isSectionFullySelected` | const arrow | 337 |
| 11 | `isSectionPartiallySelected` | const arrow | 338 |
| 12 | `toggleSectionSelection` | const arrow | 339 |
| 13 | `promise` | const arrow | 373 |
| 14 | `handleSave` | const arrow | 460 |
| 15 | `handleDelete` | const arrow | 537 |
| 16 | `handleBulkDelete` | const arrow | 576 |

### 3.70 `frontend/src/components/contacts/DeliveryTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDeliveryApi` | function | 117 |
| 2 | `normalizeDeliveryRows` | function | 122 |
| 3 | `isSectionRow` | function | 130 |
| 4 | `getErrorMessage` | function | 134 |
| 5 | `BLANK_OPTION` | const arrow | 151 |
| 6 | `OptionEditor` | function | 162 |
| 7 | `set` | const arrow | 163 |
| 8 | `fieldId` | const arrow | 164 |
| 9 | `DeliveryForm` | function | 209 |
| 10 | `set` | const arrow | 218 |
| 11 | `addOption` | const arrow | 219 |
| 12 | `updateOption` | const arrow | 223 |
| 13 | `removeOption` | const arrow | 224 |
| 14 | `handleSave` | const arrow | 225 |
| 15 | `OptionsDisplay` | function | 295 |
| 16 | `OptionsBadge` | function | 312 |
| 17 | `DeliveryTab` | function | 323 |
| 18 | `toggleSectionCollapsed` | const arrow | 464 |
| 19 | `isSectionFullySelected` | const arrow | 470 |
| 20 | `isSectionPartiallySelected` | const arrow | 471 |
| 21 | `toggleSectionSelection` | const arrow | 472 |
| 22 | `promise` | const arrow | 504 |
| 23 | `handleSave` | const arrow | 578 |
| 24 | `handleDelete` | const arrow | 640 |
| 25 | `handleBulkDelete` | const arrow | 677 |

### 3.71 `frontend/src/components/contacts/shared.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toggleOne` | const arrow | 100 |
| 2 | `clearSelection` | const arrow | 111 |
| 3 | `menuContent` | const arrow | 165 |

### 3.72 `frontend/src/components/contacts/SuppliersTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getSupplierApi` | function | 120 |
| 2 | `normalizeSupplierRows` | function | 125 |
| 3 | `isSectionRow` | function | 133 |
| 4 | `getErrorMessage` | function | 137 |
| 5 | `SupplierForm` | function | 148 |
| 6 | `set` | const arrow | 164 |
| 7 | `addOption` | const arrow | 165 |
| 8 | `updateOption` | const arrow | 169 |
| 9 | `removeOption` | const arrow | 170 |
| 10 | `handleSubmit` | const arrow | 171 |
| 11 | `fieldId` | const arrow | 219 |
| 12 | `SuppliersTab` | function | 265 |
| 13 | `toggleSectionCollapsed` | const arrow | 413 |
| 14 | `isSectionFullySelected` | const arrow | 419 |
| 15 | `isSectionPartiallySelected` | const arrow | 420 |
| 16 | `toggleSectionSelection` | const arrow | 421 |
| 17 | `promise` | const arrow | 455 |
| 18 | `handleSave` | const arrow | 530 |
| 19 | `handleDelete` | const arrow | 600 |
| 20 | `handleBulkDelete` | const arrow | 639 |

### 3.73 `frontend/src/components/custom-tables/CustomTables.tsx`

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

### 3.74 `frontend/src/components/dashboard/charts/BarChart.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `chartLabelsNeedYear` | function | 23 |
| 2 | `formatAxisLabel` | function | 32 |
| 3 | `BarChart` | component/function | 45 |
| 4 | `updateWidth` | const arrow | 53 |
| 5 | `yPx` | function | 89 |

### 3.75 `frontend/src/components/dashboard/charts/DonutChart.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `DonutChart` | component/function | 22 |

### 3.76 `frontend/src/components/dashboard/charts/index.ts`

- No top-level named function/class symbols detected.

### 3.77 `frontend/src/components/dashboard/charts/LineChart.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `chartLabelsNeedYear` | function | 28 |
| 2 | `formatAxisLabel` | function | 37 |
| 3 | `LineChart` | component/function | 50 |
| 4 | `updateWidth` | const arrow | 58 |
| 5 | `xPx` | function | 100 |
| 6 | `yPx` | function | 104 |
| 7 | `handleMouseMove` | const arrow | 114 |

### 3.78 `frontend/src/components/dashboard/charts/NoData.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `NoData` | component/function | 7 |

### 3.79 `frontend/src/components/dashboard/Dashboard.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDashboardApi` | function | 238 |
| 2 | `getErrorMessage` | function | 242 |
| 3 | `getDashboardFilterStorageKey` | function | 291 |
| 4 | `readDashboardFilterPrefs` | function | 296 |
| 5 | `downsampleChartRows` | function | 320 |
| 6 | `normalizeDashboardRangeId` | function | 331 |
| 7 | `normalizeDashboardGranularity` | function | 338 |
| 8 | `compactDashboardMetaParts` | function | 342 |
| 9 | `formatDashboardHourLabel` | function | 348 |
| 10 | `getSaleStatusTone` | function | 355 |
| 11 | `isDashboardSummaryPayload` | function | 362 |
| 12 | `isDashboardAnalyticsPayload` | function | 374 |
| 13 | `normalizeDashboardSummaryPayload` | function | 387 |
| 14 | `normalizeDashboardAnalyticsPayload` | function | 400 |
| 15 | `Dashboard` | component/function | 420 |
| 16 | `calcTrend` | const arrow | 739 |
| 17 | `rangeLabel` | const arrow | 783 |
| 18 | `periodShort` | const arrow | 789 |

### 3.80 `frontend/src/components/dashboard/MiniStat.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `MiniStat` | component/function | 13 |

### 3.81 `frontend/src/components/files/FilePickerModal.tsx`

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

### 3.82 `frontend/src/components/files/FilesPage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadFilesProvidersTab` | const arrow | 28 |
| 2 | `loadFilesResponsesTab` | const arrow | 29 |
| 3 | `getFilesApi` | function | 224 |
| 4 | `getErrorMessage` | function | 228 |
| 5 | `hasMojibake` | function | 232 |
| 6 | `sanitizeFallback` | function | 236 |
| 7 | `AssetPreview` | function | 240 |
| 8 | `AssetCardSkeleton` | function | 263 |
| 9 | `formatDateTime` | function | 289 |
| 10 | `formatFileSize` | function | 299 |
| 11 | `emptyProviderForm` | function | 307 |
| 12 | `compactTabLabel` | function | 330 |
| 13 | `getDefaultFilesPageSize` | function | 336 |
| 14 | `downloadAssetFile` | function | 341 |
| 15 | `FilesPage` | component/function | 353 |
| 16 | `handleUpload` | function | 647 |
| 17 | `handleDeleteAsset` | function | 670 |
| 18 | `toggleAssetSelection` | function | 698 |
| 19 | `toggleSelectAllAssets` | function | 709 |
| 20 | `handleCopySelectedPaths` | function | 716 |
| 21 | `handleDownloadSelected` | function | 731 |
| 22 | `handleDeleteSelectedAssets` | function | 739 |
| 23 | `startCreateProvider` | function | 785 |
| 24 | `startEditProvider` | function | 801 |
| 25 | `saveProvider` | function | 826 |
| 26 | `testProvider` | function | 910 |
| 27 | `removeProvider` | function | 931 |

### 3.83 `frontend/src/components/files/FilesProvidersTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProviderStatus` | function | 121 |
| 2 | `FilesProvidersTab` | component/function | 132 |

### 3.84 `frontend/src/components/files/FilesResponsesTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `FilesResponsesTab` | component/function | 64 |

### 3.85 `frontend/src/components/inventory/DualMoney.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `DualMoney` | component/function | 8 |

### 3.86 `frontend/src/components/inventory/Inventory.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getInventoryApi` | function | 191 |
| 2 | `normalizeFiniteIds` | function | 225 |
| 3 | `countActiveFlags` | function | 229 |
| 4 | `countSelectedIds` | function | 237 |
| 5 | `renderDestinationProductOptions` | function | 245 |
| 6 | `limitInventorySectionsForMobile` | function | 256 |
| 7 | `priceCsv` | function | 283 |
| 8 | `parseInventoryTimestamp` | function | 287 |
| 9 | `InventoryDiscountBadge` | function | 301 |
| 10 | `InventoryBatchPreview` | function | 312 |
| 11 | `label` | const arrow | 324 |
| 12 | `loadInventoryExportTools` | function | 379 |
| 13 | `Inventory` | component/function | 394 |
| 14 | `promise` | const arrow | 638 |
| 15 | `loadInventoryBootstrap` | const arrow | 676 |
| 16 | `handleAdjust` | const arrow | 1043 |
| 17 | `openAdjust` | const arrow | 1125 |
| 18 | `openMove` | const arrow | 1132 |
| 19 | `openTransfer` | const arrow | 1155 |
| 20 | `handleMoveStock` | const arrow | 1210 |
| 21 | `handleTransferStock` | const arrow | 1283 |
| 22 | `syncViewport` | const arrow | 1440 |
| 23 | `statsValue` | const arrow | 2059 |
| 24 | `selectInventorySection` | const arrow | 3282 |

### 3.87 `frontend/src/components/inventory/InventoryImportModal.tsx`

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

### 3.88 `frontend/src/components/inventory/inventoryImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.89 `frontend/src/components/inventory/InventoryMovementsSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `InventoryMovementsSurface` | component/function | 143 |

### 3.90 `frontend/src/components/inventory/InventoryProductsSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `InventoryProductsSurface` | component/function | 103 |
| 2 | `renderDesktopTableHead` | const arrow | 142 |
| 3 | `renderDesktopLoadingShell` | const arrow | 164 |

### 3.91 `frontend/src/components/inventory/InventoryRfidSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `InventoryRfidSurface` | component/function | 55 |

### 3.92 `frontend/src/components/inventory/movementGroups.ts`

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

### 3.93 `frontend/src/components/inventory/ProductDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBranchStockKey` | function | 61 |
| 2 | `ProductDetailModal` | component/function | 65 |

### 3.94 `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getLoyaltyApi` | function | 191 |
| 2 | `toCustomerPointRows` | function | 195 |
| 3 | `getErrorMessage` | function | 199 |
| 4 | `sanitizeInteger` | function | 203 |
| 5 | `sanitizeKhr` | function | 208 |
| 6 | `formatLookupValue` | function | 214 |
| 7 | `normalizeLoyaltySection` | function | 218 |
| 8 | `LoyaltyPointsPage` | component/function | 222 |
| 9 | `handleSave` | function | 331 |
| 10 | `handleLookup` | function | 355 |

### 3.95 `frontend/src/components/navigation/Sidebar.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getFallbackLabel` | function | 95 |
| 2 | `getNavLabel` | function | 103 |
| 3 | `isDarkColor` | function | 119 |
| 4 | `withAlpha` | function | 129 |
| 5 | `mergeStyles` | function | 135 |
| 6 | `announcePageIntent` | function | 139 |
| 7 | `getIconForItem` | function | 146 |
| 8 | `isNavigationItemWithIcon` | function | 150 |
| 9 | `Sidebar` | component/function | 154 |

### 3.96 `frontend/src/components/pos/CartItem.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `translate` | function | 41 |
| 2 | `CartItem` | component/function | 45 |

### 3.97 `frontend/src/components/pos/FilterPanel.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `countActiveFlags` | function | 47 |
| 2 | `SectionLabel` | function | 55 |
| 3 | `POSFilterPanel` | component/function | 66 |
| 4 | `clearAll` | const arrow | 99 |
| 5 | `chip` | const arrow | 108 |

### 3.98 `frontend/src/components/pos/POS.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPlainRecord` | function | 304 |
| 2 | `normalizeCategory` | function | 308 |
| 3 | `getPosApi` | function | 323 |
| 4 | `missingPosApiMethod` | function | 327 |
| 5 | `normalizeOrder` | function | 331 |
| 6 | `getErrorMessage` | function | 342 |
| 7 | `asText` | function | 346 |
| 8 | `asNumber` | function | 350 |
| 9 | `allTermsMatch` | function | 354 |
| 10 | `ProductDiscountBadge` | function | 368 |
| 11 | `POS` | component/function | 388 |
| 12 | `setPersistedCat` | const arrow | 419 |
| 13 | `setPersistedBrand` | const arrow | 420 |
| 14 | `setPersistedBranch` | const arrow | 421 |
| 15 | `setPersistedStock` | const arrow | 422 |
| 16 | `setPersistedGroup` | const arrow | 423 |
| 17 | `setPersistedSupplier` | const arrow | 424 |
| 18 | `setPersistedInitial` | const arrow | 425 |
| 19 | `addNewOrder` | const arrow | 486 |
| 20 | `closeOrder` | const arrow | 498 |
| 21 | `promise` | const arrow | 640 |
| 22 | `selectCustomer` | const arrow | 978 |
| 23 | `applyCustomerOption` | const arrow | 1026 |
| 24 | `clearCustomer` | const arrow | 1040 |
| 25 | `handleAddCustomer` | const arrow | 1048 |
| 26 | `selectDelivery` | const arrow | 1086 |
| 27 | `clearDelivery` | const arrow | 1091 |
| 28 | `handleAddDelivery` | const arrow | 1093 |
| 29 | `qty` | const arrow | 1205 |
| 30 | `addToCart` | function | 1369 |
| 31 | `updateQty` | const arrow | 1408 |
| 32 | `updatePrice` | const arrow | 1416 |
| 33 | `updateItemBranch` | const arrow | 1440 |
| 34 | `handleDiscountUsd` | const arrow | 1489 |
| 35 | `handleDiscountKhr` | const arrow | 1490 |
| 36 | `handleMembershipUnits` | const arrow | 1491 |
| 37 | `handleCheckout` | const arrow | 1530 |

### 3.99 `frontend/src/components/pos/posCore.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeNumber` | function | 48 |

### 3.100 `frontend/src/components/pos/ProductImage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductImage` | component/function | 9 |

### 3.101 `frontend/src/components/pos/QuickAddModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `QuickAddModal` | component/function | 12 |
| 2 | `T` | const arrow | 13 |

### 3.102 `frontend/src/components/products/config/productPageConfig.ts`

- No top-level named function/class symbols detected.

### 3.103 `frontend/src/components/products/forms/BranchStockAdjuster.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getProductApi` | function | 72 |
| 2 | `parseStockDelta` | function | 76 |
| 3 | `BranchStockAdjuster` | component/function | 81 |
| 4 | `T` | const arrow | 102 |
| 5 | `setRow` | const arrow | 108 |
| 6 | `handleSave` | const arrow | 114 |

### 3.104 `frontend/src/components/products/forms/BulkAddStockModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getProductApi` | function | 68 |
| 2 | `parsePositiveQuantity` | function | 72 |
| 3 | `normalizeBranchId` | function | 77 |
| 4 | `normalizeProductId` | function | 83 |
| 5 | `BulkAddStockModal` | component/function | 88 |
| 6 | `handleSave` | const arrow | 101 |

### 3.105 `frontend/src/components/products/forms/ProductForm.tsx`

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

### 3.106 `frontend/src/components/products/forms/VariantFormModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getProductVariantApi` | function | 104 |
| 2 | `getErrorMessage` | function | 108 |
| 3 | `VariantFormModal` | component/function | 112 |

### 3.107 `frontend/src/components/products/helpers/productDisplayHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toNumber` | function | 57 |

### 3.108 `frontend/src/components/products/helpers/productFilterHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toNumber` | function | 66 |
| 2 | `getImageGallery` | function | 71 |
| 3 | `toImageName` | const arrow | 154 |
| 4 | `toImageUrl` | const arrow | 155 |
| 5 | `priceCsv` | const arrow | 156 |

### 3.109 `frontend/src/components/products/helpers/productGalleryHelpers.ts`

- No top-level named function/class symbols detected.

### 3.110 `frontend/src/components/products/helpers/productGroupViewHelpers.ts`

- No top-level named function/class symbols detected.

### 3.111 `frontend/src/components/products/helpers/productMenuHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `asString` | function | 85 |

### 3.112 `frontend/src/components/products/helpers/productPageHelpers.ts`

- No top-level named function/class symbols detected.

### 3.113 `frontend/src/components/products/helpers/productSelectionHelpers.ts`

- No top-level named function/class symbols detected.

### 3.114 `frontend/src/components/products/helpers/productWriteHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toFiniteNumber` | function | 123 |
| 2 | `hasBulkFormValue` | function | 128 |
| 3 | `stringOrEmpty` | function | 132 |

### 3.115 `frontend/src/components/products/history/productHistoryHelpers.ts`

- No top-level named function/class symbols detected.

### 3.116 `frontend/src/components/products/import/BulkImportModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getProductImportApi` | function | 250 |
| 2 | `getErrorMessage` | function | 254 |
| 3 | `getBaseName` | function | 264 |
| 4 | `analyzeProductCsvInWorker` | function | 272 |
| 5 | `runFallbackAnalysis` | const arrow | 281 |
| 6 | `cleanup` | const arrow | 293 |
| 7 | `complete` | const arrow | 301 |
| 8 | `getIncomingImageFilenames` | function | 350 |
| 9 | `getExistingImageFilenames` | function | 383 |
| 10 | `csvEscape` | function | 412 |
| 11 | `compactImportValue` | function | 442 |
| 12 | `isBlankImportValue` | function | 447 |
| 13 | `hasPriceReviewIssue` | function | 451 |
| 14 | `getProductImportIssueLabel` | function | 456 |
| 15 | `getProductImportIssueHint` | function | 465 |
| 16 | `getProductImportRowIssueDetails` | function | 473 |
| 17 | `valuesDiffer` | function | 528 |
| 18 | `normalizeImageMatchKey` | function | 532 |
| 19 | `getImageReference` | function | 545 |
| 20 | `findImageReferenceForRow` | function | 554 |
| 21 | `getDecisionLabel` | function | 565 |
| 22 | `getFamilyKeyForRow` | function | 569 |
| 23 | `summarizeRowNumbers` | function | 573 |
| 24 | `summarizeSubgroup` | function | 580 |
| 25 | `getImportActionTargetSummary` | function | 585 |
| 26 | `createFamilyContextEntry` | function | 618 |
| 27 | `buildVisibleFamilyRows` | function | 639 |
| 28 | `InlineImportDetailGrid` | function | 658 |
| 29 | `buildImageOnlyCsv` | function | 699 |
| 30 | `getBrowserImageEntries` | function | 717 |
| 31 | `BulkImportModal` | component/function | 726 |
| 32 | `resetCsvState` | const arrow | 857 |
| 33 | `pickImageDirectory` | const arrow | 885 |
| 34 | `pickImageZip` | const arrow | 910 |
| 35 | `addLibraryImages` | const arrow | 924 |
| 36 | `handleCancelCurrentJob` | const arrow | 1008 |
| 37 | `handleRetryCurrentJob` | const arrow | 1029 |
| 38 | `handleDeleteCurrentJob` | const arrow | 1053 |
| 39 | `handleImageOnlyImport` | const arrow | 1080 |
| 40 | `handlePickCSV` | const arrow | 1175 |
| 41 | `handleImport` | const arrow | 1239 |
| 42 | `toggleFamilyCollapse` | const arrow | 1489 |
| 43 | `toggleInlineDetails` | const arrow | 1498 |
| 44 | `toggleConflictSelection` | const arrow | 1507 |
| 45 | `toggleSelectAllConflicts` | const arrow | 1516 |
| 46 | `applyDecisionToSelection` | const arrow | 1524 |
| 47 | `applyImageDecisionToSelection` | const arrow | 1534 |
| 48 | `applyIdentifierDecisionToSelection` | const arrow | 1551 |
| 49 | `applyFieldRulePreset` | const arrow | 1563 |
| 50 | `renderConflictRow` | const arrow | 1576 |
| 51 | `updateEditedRow` | const arrow | 1584 |

### 3.117 `frontend/src/components/products/import/productImportPlanner.ts`

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

### 3.118 `frontend/src/components/products/import/productImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `post` | function | 39 |
| 2 | `waitForNextTask` | function | 43 |
| 3 | `getErrorMessage` | function | 49 |

### 3.119 `frontend/src/components/products/lookups/ManageBrandsModal.tsx`

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

### 3.120 `frontend/src/components/products/lookups/ManageCategoriesModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getCategoryApi` | function | 106 |
| 2 | `getErrorMessage` | function | 110 |
| 3 | `normalizeCategoryRows` | function | 114 |
| 4 | `mergeCategoryUsage` | function | 129 |
| 5 | `ManageCategoriesModal` | component/function | 158 |

### 3.121 `frontend/src/components/products/lookups/ManageUnitsModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getUnitApi` | function | 106 |
| 2 | `getErrorMessage` | function | 110 |
| 3 | `normalizeUnitRows` | function | 114 |
| 4 | `mergeUnitUsage` | function | 129 |
| 5 | `ManageUnitsModal` | component/function | 158 |

### 3.122 `frontend/src/components/products/lookups/productLookupSnapshots.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getFallbackApiClient` | function | 57 |
| 2 | `normalizeProductRows` | function | 63 |
| 3 | `getPayloadNumber` | function | 70 |
| 4 | `snapshotLookupProducts` | function | 75 |
| 5 | `mergeUniqueSnapshots` | function | 89 |
| 6 | `fetchLookupProductSnapshotsForName` | function | 113 |
| 7 | `fetchProductsByIds` | function | 165 |

### 3.123 `frontend/src/components/products/Products.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getProductApi` | function | 337 |
| 2 | `getErrorMessage` | function | 341 |
| 3 | `isObjectRecord` | function | 345 |
| 4 | `toProductApiResponse` | function | 349 |
| 5 | `scrollNodeWithOffset` | function | 353 |
| 6 | `summarizeProductRun` | function | 359 |
| 7 | `aggregateProductInitials` | function | 363 |
| 8 | `toModalProduct` | function | 374 |
| 9 | `toVariantParentProduct` | function | 386 |
| 10 | `toLightboxState` | function | 392 |
| 11 | `Products` | component/function | 402 |
| 12 | `promise` | const arrow | 499 |
| 13 | `handleSave` | const arrow | 759 |
| 14 | `handleSaveWithGallery` | const arrow | 809 |
| 15 | `handleBulkDelete` | const arrow | 876 |
| 16 | `handleBulkOutOfStock` | const arrow | 923 |
| 17 | `handleBulkChangeBranch` | const arrow | 966 |
| 18 | `handleBulkAddStock` | const arrow | 996 |
| 19 | `toggleSelect` | const arrow | 1004 |
| 20 | `toggleSelectAll` | const arrow | 1011 |
| 21 | `handleDelete` | const arrow | 1018 |
| 22 | `renderUnitChip` | const arrow | 1105 |
| 23 | `openLightbox` | const arrow | 1119 |
| 24 | `getStockBadge` | const arrow | 1126 |

### 3.124 `frontend/src/components/products/scanning/barcodeImageScanner.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readFileAsDataUrl` | function | 37 |
| 2 | `createImageElement` | function | 62 |
| 3 | `loadImageSource` | function | 66 |
| 4 | `detectWithNativeBarcodeDetector` | function | 75 |

### 3.125 `frontend/src/components/products/scanning/BarcodeScannerModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getNativeBarcodeDetector` | function | 100 |
| 2 | `getScanErrorText` | function | 107 |
| 3 | `stopStream` | function | 112 |
| 4 | `BarcodeScannerModal` | component/function | 118 |

### 3.126 `frontend/src/components/products/scanning/barcodeScannerState.ts`

- No top-level named function/class symbols detected.

### 3.127 `frontend/src/components/products/scanning/cameraPermission.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeCameraPermissionState` | function | 9 |
| 2 | `queryCameraPermission` | function | 16 |
| 3 | `handleChange` | const arrow | 35 |

### 3.128 `frontend/src/components/products/scanning/scanbotScanner.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `publicBasePath` | const arrow | 37 |
| 2 | `getScanbotGlobal` | function | 49 |
| 3 | `normalizeScanbotError` | function | 68 |
| 4 | `loadScanbotScript` | function | 82 |
| 5 | `getInitializedScanbot` | function | 135 |

### 3.129 `frontend/src/components/products/shared/primitives.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getImageApi` | function | 50 |
| 2 | `isRecentlyBrokenProductImage` | function | 54 |
| 3 | `markBrokenProductImage` | function | 62 |
| 4 | `sanitizeNumericInput` | function | 67 |
| 5 | `parseNumericInput` | function | 77 |
| 6 | `ProductImg` | function | 83 |
| 7 | `loadImageData` | function | 126 |
| 8 | `ProductImagePlaceholder` | function | 170 |
| 9 | `MarginCard` | function | 178 |
| 10 | `DualPriceInput` | function | 210 |
| 11 | `handleUsdChange` | const arrow | 211 |
| 12 | `handleKhrChange` | const arrow | 212 |

### 3.130 `frontend/src/components/products/surfaces/HeaderActions.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductsHeaderActions` | component/function | 22 |
| 2 | `tr` | const arrow | 32 |

### 3.131 `frontend/src/components/products/surfaces/ProductDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductDetailModal` | component/function | 79 |
| 2 | `T` | const arrow | 95 |
| 3 | `Row` | const arrow | 121 |

### 3.132 `frontend/src/components/products/surfaces/ProductRowParts.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `label` | const arrow | 103 |

### 3.133 `frontend/src/components/products/surfaces/ProductsListSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductsListSurface` | component/function | 62 |
| 2 | `renderDesktopTableHead` | const arrow | 105 |
| 3 | `renderDesktopLoadingShell` | const arrow | 134 |

### 3.134 `frontend/src/components/receipt-settings/AllFieldsPanel.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Toggle` | function | 30 |
| 2 | `AllFieldsPanel` | component/function | 46 |
| 3 | `T` | const arrow | 49 |
| 4 | `toggleSection` | const arrow | 68 |

### 3.135 `frontend/src/components/receipt-settings/constants.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `T` | const arrow | 110 |

### 3.136 `frontend/src/components/receipt-settings/ErrorBoundary.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatError` | function | 11 |

### 3.137 `frontend/src/components/receipt-settings/FieldOrderManager.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getSectionOrderItems` | function | 25 |
| 2 | `buildList` | function | 44 |
| 3 | `toKeys` | function | 69 |
| 4 | `FieldOrderManager` | component/function | 73 |
| 5 | `moveItem` | const arrow | 87 |
| 6 | `addDivider` | const arrow | 95 |
| 7 | `removeDivider` | const arrow | 106 |
| 8 | `handleDragStart` | const arrow | 112 |
| 9 | `handleDragOver` | const arrow | 117 |

### 3.138 `frontend/src/components/receipt-settings/PrintSettings.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Section` | function | 35 |
| 2 | `buildFallbackPreviewHtml` | function | 47 |
| 3 | `buildSafePreviewSource` | function | 65 |
| 4 | `PrintSettings` | component/function | 77 |
| 5 | `persistPrintSettings` | const arrow | 100 |
| 6 | `setValue` | const arrow | 116 |
| 7 | `resetMargins` | const arrow | 125 |
| 8 | `getPreviewSource` | const arrow | 148 |

### 3.139 `frontend/src/components/receipt-settings/ReceiptPreview.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatLoadError` | function | 34 |
| 2 | `ReceiptPreview` | component/function | 39 |
| 3 | `loadPreview` | function | 50 |

### 3.140 `frontend/src/components/receipt-settings/ReceiptSettings.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 80 |
| 2 | `Section` | function | 85 |
| 3 | `Toggle` | function | 96 |
| 4 | `ReceiptSettings` | component/function | 111 |

### 3.141 `frontend/src/components/receipt-settings/template.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isRecord` | function | 6 |
| 2 | `parseTemplateInput` | function | 10 |

### 3.142 `frontend/src/components/receipt/Receipt.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toNumber` | function | 107 |
| 2 | `stripEmoji` | function | 112 |
| 3 | `stripEmoji` | function | 114 |
| 4 | `displayAddress` | function | 119 |
| 5 | `parseItems` | function | 128 |
| 6 | `getErrorMessage` | function | 139 |
| 7 | `labelFor` | function | 225 |
| 8 | `Row` | function | 230 |
| 9 | `Receipt` | component/function | 242 |
| 10 | `exportReceiptPdf` | const arrow | 453 |

### 3.143 `frontend/src/components/returns/EditReturnModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getReturnApi` | function | 90 |
| 2 | `toNumber` | function | 95 |
| 3 | `clampReturnQuantity` | function | 100 |
| 4 | `isWriteConflict` | function | 106 |
| 5 | `EditReturnModal` | component/function | 111 |
| 6 | `updateQty` | const arrow | 144 |
| 7 | `updateRestock` | const arrow | 147 |

### 3.144 `frontend/src/components/returns/NewReturnModal.tsx`

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

### 3.145 `frontend/src/components/returns/NewSupplierReturnModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isSupplierReturnItem` | function | 86 |
| 2 | `getSupplierReturnApi` | function | 90 |
| 3 | `NewSupplierReturnModal` | component/function | 99 |
| 4 | `loadSetup` | function | 136 |
| 5 | `loadInventory` | function | 187 |
| 6 | `updateQty` | const arrow | 258 |
| 7 | `submit` | const arrow | 264 |

### 3.146 `frontend/src/components/returns/ReturnDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeScope` | function | 52 |
| 2 | `coerceMoney` | function | 56 |
| 3 | `isPositiveMoney` | function | 60 |
| 4 | `ReturnDetailModal` | component/function | 64 |

### 3.147 `frontend/src/components/returns/Returns.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getReturnApi` | function | 152 |
| 2 | `normalizeScope` | function | 157 |
| 3 | `getReturnTypeKey` | function | 161 |
| 4 | `getReturnTypeLabel` | function | 167 |
| 5 | `normalizeFiniteIds` | function | 183 |
| 6 | `countSelectedIds` | function | 187 |
| 7 | `countActiveFlags` | function | 195 |
| 8 | `toNumericAmount` | function | 203 |
| 9 | `exportReturnRows` | function | 208 |
| 10 | `getInitialReturnPageSize` | function | 226 |
| 11 | `Returns` | component/function | 231 |
| 12 | `promise` | const arrow | 305 |

### 3.148 `frontend/src/components/returns/ReturnsListSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `detectMobileViewport` | function | 71 |
| 2 | `ReturnsDesktopSkeletonRows` | function | 76 |
| 3 | `ReturnsMobileSkeletonCards` | function | 93 |
| 4 | `ReturnsListSurface` | component/function | 113 |
| 5 | `apply` | const arrow | 144 |

### 3.149 `frontend/src/components/sales/ExportModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getSalesExportApi` | function | 71 |
| 2 | `getErrorMessage` | function | 76 |
| 3 | `ExportModal` | component/function | 80 |
| 4 | `handlePreview` | const arrow | 154 |
| 5 | `handleExportCSV` | const arrow | 172 |

### 3.150 `frontend/src/components/sales/SaleDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toNumber` | function | 73 |
| 2 | `InfoBlock` | function | 78 |
| 3 | `parseItems` | function | 94 |
| 4 | `SaleDetailModal` | component/function | 105 |

### 3.151 `frontend/src/components/sales/Sales.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getSalesApi` | function | 129 |
| 2 | `normalizeSaleRows` | function | 134 |
| 3 | `normalizeUserOptions` | function | 142 |
| 4 | `getErrorMessage` | function | 147 |
| 5 | `isWriteConflict` | function | 151 |
| 6 | `multiMatch` | function | 158 |
| 7 | `normalizeFiniteIds` | function | 170 |
| 8 | `countSelectedIds` | function | 174 |
| 9 | `countActiveFlags` | function | 182 |
| 10 | `getSaleBranchLabel` | function | 190 |
| 11 | `Sales` | component/function | 198 |
| 12 | `promise` | const arrow | 289 |
| 13 | `toggleSelected` | const arrow | 639 |
| 14 | `toggleSelectAll` | const arrow | 645 |
| 15 | `handleExportSelected` | const arrow | 684 |
| 16 | `handleBulkStatusUpdate` | const arrow | 732 |

### 3.152 `frontend/src/components/sales/SalesImportModal.tsx`

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

### 3.153 `frontend/src/components/sales/salesImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.154 `frontend/src/components/sales/SalesListSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getSaleItems` | function | 67 |
| 2 | `SalesListSurface` | component/function | 71 |

### 3.155 `frontend/src/components/sales/StatusBadge.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isSaleStatus` | function | 24 |
| 2 | `StatusBadge` | component/function | 50 |

### 3.156 `frontend/src/components/server/ServerPage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getServerApi` | function | 139 |
| 2 | `getErrorMessage` | function | 143 |
| 3 | `normalizePendingSyncState` | function | 147 |
| 4 | `normalizeSystemDebugLog` | function | 158 |
| 5 | `normalizeSystemConfig` | function | 167 |
| 6 | `normalizeSystemBootstrap` | function | 171 |
| 7 | `useLocalCopy` | function | 179 |
| 8 | `isAutoDetected` | function | 190 |
| 9 | `StatusRow` | function | 197 |
| 10 | `InfoTab` | function | 209 |
| 11 | `DiagnosticsPanel` | function | 362 |
| 12 | `onErr` | const arrow | 401 |
| 13 | `onQueueChanged` | const arrow | 406 |
| 14 | `handleRetryQueue` | function | 464 |
| 15 | `handleDiscardQueue` | function | 481 |
| 16 | `ServerPage` | component/function | 672 |
| 17 | `check` | const arrow | 700 |
| 18 | `loadServerBootstrap` | const arrow | 731 |
| 19 | `handleTest` | function | 766 |
| 20 | `handleSave` | function | 795 |
| 21 | `handleDisconnect` | function | 802 |

### 3.157 `frontend/src/components/shared/ActionHistoryBar.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatHistoryList` | function | 50 |
| 2 | `formatServerStatus` | function | 54 |
| 3 | `ActionHistoryBar` | component/function | 61 |

### 3.158 `frontend/src/components/shared/BackgroundImportTracker.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getImportTrackerApi` | function | 105 |
| 2 | `getErrorMessage` | function | 110 |
| 3 | `nextImportTrackerBackoff` | function | 114 |
| 4 | `normalizeJobStatus` | function | 121 |
| 5 | `dedupeJobsById` | function | 125 |
| 6 | `isRecent` | function | 137 |
| 7 | `normalizeImportJobListResult` | function | 143 |
| 8 | `getJobProgressDetails` | function | 158 |
| 9 | `getJobLabel` | function | 226 |
| 10 | `getJobResultSummary` | function | 232 |
| 11 | `add` | const arrow | 235 |
| 12 | `getRowsDisplay` | function | 248 |
| 13 | `buildJobsSignature` | function | 264 |
| 14 | `BackgroundImportTracker` | component/function | 279 |
| 15 | `finishTrackerAction` | const arrow | 418 |
| 16 | `handleCancel` | const arrow | 423 |
| 17 | `handleRetry` | const arrow | 442 |
| 18 | `handleApprove` | const arrow | 461 |
| 19 | `handleDownloadErrors` | const arrow | 491 |
| 20 | `handleRemove` | const arrow | 508 |
| 21 | `handleDismiss` | const arrow | 546 |

### 3.159 `frontend/src/components/shared/ExportMenu.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ExportMenu` | component/function | 17 |

### 3.160 `frontend/src/components/shared/FilterMenu.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `sectionButtonClass` | function | 35 |
| 2 | `FilterMenu` | component/function | 41 |

### 3.161 `frontend/src/components/shared/globalScroll.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDocumentLike` | function | 21 |
| 2 | `getPageScrollCandidates` | function | 25 |
| 3 | `isVisibleScrollNode` | function | 38 |

### 3.162 `frontend/src/components/shared/ImageGalleryLightbox.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ImageGalleryLightbox` | component/function | 31 |
| 2 | `formatLabel` | function | 53 |
| 3 | `setIndex` | function | 57 |
| 4 | `renderGalleryImage` | function | 63 |
| 5 | `onKeyDown` | function | 70 |

### 3.163 `frontend/src/components/shared/LoadingWatchdog.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `LoadingWatchdog` | component/function | 14 |

### 3.164 `frontend/src/components/shared/Modal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Modal` | component/function | 13 |

### 3.165 `frontend/src/components/shared/navigationConfig.ts`

- No top-level named function/class symbols detected.

### 3.166 `frontend/src/components/shared/NotificationCenter.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getNotificationApi` | function | 111 |
| 2 | `getErrorMessage` | function | 116 |
| 3 | `preferenceValue` | function | 243 |
| 4 | `matchesVisibilityMode` | function | 251 |
| 5 | `NotificationSeverityIcon` | function | 258 |
| 6 | `NotificationCenter` | component/function | 273 |
| 7 | `syncVisibility` | const arrow | 307 |
| 8 | `onVisible` | const arrow | 381 |
| 9 | `handleClickOutside` | const arrow | 404 |

### 3.167 `frontend/src/components/shared/pageActivity.ts`

- No top-level named function/class symbols detected.

### 3.168 `frontend/src/components/shared/PageHeader.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PageHeader` | component/function | 26 |

### 3.169 `frontend/src/components/shared/PaginationControls.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PaginationControls` | component/function | 41 |
| 2 | `commitPageDraft` | const arrow | 71 |
| 3 | `handlePageInputKeyDown` | const arrow | 82 |

### 3.170 `frontend/src/components/shared/PortalMenu.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPortalMenuItem` | function | 50 |
| 2 | `PortalMenu` | component/function | 60 |
| 3 | `closeIfClickedOutside` | const arrow | 119 |
| 4 | `closeMenu` | const arrow | 127 |
| 5 | `scheduleReposition` | const arrow | 128 |
| 6 | `closeIfEscape` | const arrow | 135 |

### 3.171 `frontend/src/components/shared/QuickPreferenceToggles.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ToggleButton` | function | 26 |
| 2 | `QuickPreferenceToggles` | component/function | 45 |
| 3 | `tr` | const arrow | 48 |

### 3.172 `frontend/src/components/shared/SectionSwitcher.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readStoredSection` | function | 19 |
| 2 | `SectionSwitcher` | component/function | 28 |
| 3 | `selectValue` | const arrow | 55 |

### 3.173 `frontend/src/components/shared/WriteConflictModal.tsx`

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

### 3.174 `frontend/src/components/users/PermissionEditor.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `parsePermissionState` | function | 75 |
| 2 | `PermissionEditor` | component/function | 89 |
| 3 | `toggle` | const arrow | 104 |

### 3.175 `frontend/src/components/users/UserDetailSheet.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `translateLabel` | function | 43 |
| 2 | `buildRowData` | function | 48 |
| 3 | `parsePermissions` | function | 60 |
| 4 | `UserDetailSheet` | component/function | 71 |

### 3.176 `frontend/src/components/users/UserProfileModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getProfileApi` | function | 154 |
| 2 | `getErrorMessage` | function | 159 |
| 3 | `parseStoredOrganization` | function | 163 |
| 4 | `AvatarPreview` | function | 180 |
| 5 | `ProfileSectionButton` | function | 198 |
| 6 | `clamp` | function | 308 |
| 7 | `loadImageElement` | function | 312 |
| 8 | `renderAvatarCropBlob` | function | 327 |
| 9 | `AvatarEditorModal` | function | 353 |
| 10 | `UserProfileModal` | component/function | 414 |
| 11 | `handleProfileSave` | const arrow | 582 |
| 12 | `handlePasswordSave` | const arrow | 646 |
| 13 | `handleSessionSave` | const arrow | 685 |
| 14 | `refreshOtpState` | const arrow | 705 |

### 3.177 `frontend/src/components/users/Users.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getUsersApi` | function | 135 |
| 2 | `normalizeUsers` | function | 140 |
| 3 | `normalizeRoles` | function | 144 |
| 4 | `normalizePermissionState` | function | 148 |
| 5 | `getErrorMessage` | function | 163 |
| 6 | `clearTimeoutRef` | function | 167 |
| 7 | `ThreeDot` | function | 184 |
| 8 | `formatContactValue` | function | 224 |
| 9 | `UsersDesktopSkeletonRows` | function | 229 |
| 10 | `UsersMobileSkeletonCards` | function | 253 |
| 11 | `Users` | component/function | 267 |
| 12 | `promise` | const arrow | 335 |
| 13 | `promise` | const arrow | 373 |
| 14 | `openCreateUser` | const arrow | 497 |
| 15 | `openCreateRole` | const arrow | 527 |
| 16 | `handleSaveUser` | const arrow | 588 |
| 17 | `handleResetPassword` | const arrow | 658 |
| 18 | `handleSaveRole` | const arrow | 715 |

### 3.178 `frontend/src/components/utils-settings/AuditLog.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getAuditApi` | function | 102 |
| 2 | `isRecord` | function | 106 |
| 3 | `getErrorMessage` | function | 110 |
| 4 | `toIso` | function | 142 |
| 5 | `formatDateTime` | function | 149 |
| 6 | `formatLogTime` | function | 170 |
| 7 | `getLogEpoch` | function | 174 |
| 8 | `formatJsonPretty` | function | 181 |
| 9 | `parseLogJson` | function | 189 |
| 10 | `flattenSummaryValue` | function | 197 |
| 11 | `formatEntityName` | function | 216 |
| 12 | `readableSummary` | function | 222 |
| 13 | `normalizeFiniteIds` | function | 250 |
| 14 | `countSelectedIds` | function | 254 |
| 15 | `countActiveFlags` | function | 262 |
| 16 | `DetailRow` | function | 270 |
| 17 | `AuditLog` | component/function | 282 |
| 18 | `sessionEntryLabel` | function | 676 |

### 3.179 `frontend/src/components/utils-settings/Backup.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBackupApi` | function | 237 |
| 2 | `getErrorMessage` | function | 241 |
| 3 | `unwrapJob` | function | 245 |
| 4 | `isBackupSectionId` | function | 272 |
| 5 | `PathActionButton` | function | 321 |
| 6 | `PrimaryActionButton` | function | 333 |
| 7 | `formatElapsed` | function | 345 |
| 8 | `JobProgressCard` | function | 354 |
| 9 | `DoctorStatusPill` | function | 414 |
| 10 | `IntegrationDoctorCard` | function | 438 |
| 11 | `useCopy` | function | 544 |
| 12 | `formatDateTime` | function | 560 |
| 13 | `formatBytes` | function | 576 |
| 14 | `yieldToBrowser` | function | 585 |
| 15 | `getJobSignature` | function | 593 |
| 16 | `startJobWatcher` | function | 612 |
| 17 | `stop` | const arrow | 628 |
| 18 | `scheduleTick` | const arrow | 634 |
| 19 | `tick` | const arrow | 640 |
| 20 | `SectionChip` | function | 697 |
| 21 | `secondsToSyncMinutes` | function | 720 |
| 22 | `minutesToSyncSeconds` | function | 729 |
| 23 | `GoogleDriveSyncSection` | function | 737 |
| 24 | `handler` | const arrow | 859 |
| 25 | `savePreferences` | const arrow | 944 |
| 26 | `connectGoogleDrive` | const arrow | 974 |
| 27 | `syncNow` | const arrow | 1019 |
| 28 | `disconnect` | const arrow | 1056 |
| 29 | `forgetCredentials` | const arrow | 1081 |
| 30 | `BackupOverview` | function | 1311 |
| 31 | `Backup` | component/function | 1383 |
| 32 | `showBackupSection` | const arrow | 1399 |
| 33 | `handleFolderExport` | const arrow | 1436 |
| 34 | `handleFolderImport` | const arrow | 1505 |

### 3.180 `frontend/src/components/utils-settings/FontFamilyPicker.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `FontFamilyPicker` | component/function | 30 |

### 3.181 `frontend/src/components/utils-settings/index.ts`

- No top-level named function/class symbols detected.

### 3.182 `frontend/src/components/utils-settings/OtpModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getOtpApi` | function | 45 |
| 2 | `getErrorMessage` | function | 49 |
| 3 | `OtpModal` | component/function | 53 |
| 4 | `loadSetup` | function | 88 |

### 3.183 `frontend/src/components/utils-settings/ResetData.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ConfirmReset` | function | 75 |
| 2 | `T` | const arrow | 88 |
| 3 | `getResetApi` | function | 156 |
| 4 | `getErrorMessage` | function | 160 |
| 5 | `ResetData` | function | 164 |
| 6 | `T` | const arrow | 166 |
| 7 | `doReset` | const arrow | 194 |
| 8 | `FactoryReset` | function | 264 |
| 9 | `T` | const arrow | 266 |
| 10 | `doFactoryReset` | function | 273 |

### 3.184 `frontend/src/components/utils-settings/Settings.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getSettingsApi` | function | 133 |
| 2 | `getErrorMessage` | function | 137 |
| 3 | `toStringValue` | function | 141 |
| 4 | `toNumberValue` | function | 146 |
| 5 | `isSettingsSectionId` | function | 234 |
| 6 | `parseStoredColors` | function | 250 |
| 7 | `buildColorChoices` | function | 261 |
| 8 | `useCopy` | function | 352 |
| 9 | `getSettingsNavLabel` | function | 360 |
| 10 | `SwatchPicker` | function | 377 |
| 11 | `SettingsSection` | function | 460 |
| 12 | `Settings` | component/function | 490 |
| 13 | `showSettingsSection` | const arrow | 516 |
| 14 | `loadOtpStatus` | function | 586 |
| 15 | `loadFaviconPreview` | function | 616 |
| 16 | `setValue` | const arrow | 673 |
| 17 | `formatPreviewDateTime` | const arrow | 699 |
| 18 | `moveNavItem` | const arrow | 715 |
| 19 | `toggleMobilePinned` | const arrow | 725 |
| 20 | `movePinnedItem` | const arrow | 737 |
| 21 | `movePinnedBefore` | const arrow | 747 |
| 22 | `resetNavigationLayout` | const arrow | 759 |
| 23 | `field` | const arrow | 764 |
| 24 | `savePaymentMethods` | const arrow | 786 |
| 25 | `uploadImageSetting` | const arrow | 806 |
| 26 | `handleSaveSettings` | const arrow | 872 |

### 3.185 `frontend/src/components/utils-settings/settingsConflict.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeObject` | function | 28 |

### 3.186 `frontend/src/constants.ts`

- No top-level named function/class symbols detected.

### 3.187 `frontend/src/index.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `scheduleAfterLoadIdle` | function | 26 |
| 2 | `schedule` | const arrow | 29 |
| 3 | `registerOfflineAppShell` | function | 45 |
| 4 | `register` | const arrow | 48 |
| 5 | `installFormFieldAccessibility` | function | 62 |
| 6 | `escapeSelectorValue` | const arrow | 67 |
| 7 | `wireField` | const arrow | 72 |
| 8 | `scan` | const arrow | 94 |
| 9 | `safeInsertRule` | const function | 132 |
| 10 | `safeCssRulesGetter` | const function | 150 |
| 11 | `stopKnownStartupNoise` | const arrow | 166 |
| 12 | `scheduleFormFieldAccessibility` | function | 201 |

### 3.188 `frontend/src/platform/runtime/clientRuntime.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `canUseBrowserStorage` | function | 30 |
| 2 | `isBusinessOsStorageKey` | function | 34 |
| 3 | `sanitizeText` | function | 39 |
| 4 | `unregisterServiceWorkers` | function | 151 |
| 5 | `deleteBusinessOsCaches` | function | 155 |
| 6 | `clearServiceWorkersAndCaches` | function | 161 |
| 7 | `snapshotStorage` | function | 177 |
| 8 | `clearStorage` | function | 190 |
| 9 | `restoreStorage` | function | 203 |

### 3.189 `frontend/src/platform/storage/storagePolicy.ts`

- No top-level named function/class symbols detected.

### 3.190 `frontend/src/public-runtime/runtime-noise-guard.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `text` | function | 22 |
| 2 | `sourceFromEvent` | function | 26 |
| 3 | `isFirstPartyAsset` | function | 36 |
| 4 | `isInjectedSource` | function | 40 |
| 5 | `isKnownNoise` | function | 45 |
| 6 | `suppress` | function | 58 |
| 7 | `guardedInsertRule` | const function | 89 |
| 8 | `guardedCssRulesGetter` | const function | 104 |

### 3.191 `frontend/src/public-runtime/service-worker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `openBusinessDb` | function | 25 |
| 2 | `txDone` | function | 33 |
| 3 | `requestResult` | function | 41 |
| 4 | `readSetting` | function | 48 |
| 5 | `stableStringify` | function | 55 |
| 6 | `sha256` | function | 61 |
| 7 | `readQueuedBusinessOutbox` | function | 69 |
| 8 | `putBusinessOutboxRow` | function | 78 |
| 9 | `deleteBusinessOutboxRow` | function | 85 |
| 10 | `readPendingFileChunks` | function | 92 |
| 11 | `readQueuedSales` | function | 101 |
| 12 | `putQueueRow` | function | 114 |
| 13 | `deleteQueueRow` | function | 125 |
| 14 | `broadcastSyncEvent` | function | 132 |
| 15 | `nextRetryAt` | function | 143 |
| 16 | `markQueueFailure` | function | 152 |
| 17 | `replayQueuedSale` | function | 161 |
| 18 | `responsePayload` | const arrow | 183 |
| 19 | `syncOutbox` | function | 224 |
| 20 | `isSameOrigin` | function | 347 |
| 21 | `isNeverCachedPath` | function | 355 |
| 22 | `isCacheableStaticPath` | function | 363 |
| 23 | `appShellFallback` | function | 370 |
| 24 | `networkFirstStatic` | function | 389 |

### 3.192 `frontend/src/public-runtime/theme-bootstrap.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `text` | function | 21 |
| 2 | `normalizeTheme` | function | 25 |
| 3 | `readJsonObject` | function | 30 |
| 4 | `isKnownBridgeNoise` | function | 39 |
| 5 | `isKnownEvalNoise` | function | 48 |
| 6 | `isKnownStyleNoise` | function | 54 |
| 7 | `isStaleModuleGraphError` | function | 70 |
| 8 | `requestStaleModuleReload` | function | 77 |
| 9 | `isFirstPartyBuiltAssetSource` | function | 94 |
| 10 | `hasInjectedBundleSource` | function | 102 |
| 11 | `isGuardableSheetError` | function | 112 |
| 12 | `shouldSuppressRuntimeError` | function | 116 |
| 13 | `installStyleSheetGuards` | function | 126 |
| 14 | `safeInsertRule` | const function | 132 |
| 15 | `safeCssRulesGetter` | const function | 147 |

### 3.193 `frontend/src/runtime/runtimeErrorClassifier.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `messageOf` | function | 27 |
| 2 | `stackOf` | function | 31 |
| 3 | `toText` | function | 35 |
| 4 | `includesExtensionOrigin` | function | 39 |
| 5 | `getPathname` | function | 44 |

### 3.194 `frontend/src/types/lucide-react-icons.d.ts`

- No top-level named function/class symbols detected.

### 3.195 `frontend/src/types/receiptContracts.ts`

- No top-level named function/class symbols detected.

### 3.196 `frontend/src/types/settingsContracts.ts`

- No top-level named function/class symbols detected.

### 3.197 `frontend/src/utils/actionGuards.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `hasOwn` | function | 18 |

### 3.198 `frontend/src/utils/actionHistory.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeActionHistoryId` | function | 94 |
| 2 | `normalizeEntry` | function | 100 |
| 3 | `parsePermissions` | function | 113 |
| 4 | `getErrorMessage` | function | 125 |

### 3.199 `frontend/src/utils/appRefresh.ts`

- No top-level named function/class symbols detected.

### 3.200 `frontend/src/utils/bulkOps.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `runner` | function | 47 |

### 3.201 `frontend/src/utils/color.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeHex` | function | 1 |
| 2 | `relativeLuminance` | function | 12 |

### 3.202 `frontend/src/utils/csv.ts`

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

### 3.203 `frontend/src/utils/csvExportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 20 |

### 3.204 `frontend/src/utils/csvImport.ts`

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

### 3.205 `frontend/src/utils/csvRowCounter.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `finishRecord` | const arrow | 7 |

### 3.206 `frontend/src/utils/csvTemplate.ts`

- No top-level named function/class symbols detected.

### 3.207 `frontend/src/utils/dateHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toLocalDateString` | function | 4 |

### 3.208 `frontend/src/utils/deviceInfo.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBrowserName` | function | 13 |
| 2 | `getOperatingSystemName` | function | 21 |

### 3.209 `frontend/src/utils/exportPackage.ts`

- No top-level named function/class symbols detected.

### 3.210 `frontend/src/utils/exportReports.tsx`

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

### 3.211 `frontend/src/utils/favicon.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `clamp` | function | 11 |
| 2 | `shouldUseAnonymousCors` | function | 18 |
| 3 | `loadImage` | function | 29 |

### 3.212 `frontend/src/utils/formatters.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeTimestampInput` | function | 6 |

### 3.213 `frontend/src/utils/groupedRecords.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toDate` | function | 37 |
| 2 | `normalizeName` | function | 56 |
| 3 | `compareAlphabetLabels` | function | 64 |

### 3.214 `frontend/src/utils/historyHelpers.ts`

- No top-level named function/class symbols detected.

### 3.215 `frontend/src/utils/importJobRefresh.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeImportJobStatus` | function | 24 |
| 2 | `normalizeImportJobType` | function | 28 |
| 3 | `uniqueChannels` | function | 32 |
| 4 | `dispatchSyncUpdate` | function | 41 |

### 3.216 `frontend/src/utils/index.ts`

- No top-level named function/class symbols detected.

### 3.217 `frontend/src/utils/initials.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getInitialRank` | function | 54 |

### 3.218 `frontend/src/utils/loaders.ts`

- No top-level named function/class symbols detected.

### 3.219 `frontend/src/utils/mediaUpload.ts`

- No top-level named function/class symbols detected.

### 3.220 `frontend/src/utils/permissions.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPermissionMap` | function | 3 |

### 3.221 `frontend/src/utils/pricing.ts`

- No top-level named function/class symbols detected.

### 3.222 `frontend/src/utils/printReceipt.ts`

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

### 3.223 `frontend/src/utils/productBatches.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeBranchId` | function | 26 |

### 3.224 `frontend/src/utils/productGrouping.ts`

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

### 3.225 `frontend/src/utils/publicAssetUrls.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `trimBaseUrl` | function | 11 |
| 2 | `normalizeUploadPath` | function | 15 |
| 3 | `appendAssetVersion` | function | 23 |
| 4 | `isLocalLikeHostname` | function | 38 |
| 5 | `getSafeCurrentOrigin` | function | 42 |
| 6 | `api` | const arrow | 57 |

### 3.226 `frontend/src/utils/receiptAppliedConfig.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `parseObject` | function | 67 |

### 3.227 `frontend/src/utils/scriptTypography.ts`

- No top-level named function/class symbols detected.

### 3.228 `frontend/src/utils/settingsRefresh.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeSettingKeys` | function | 62 |

### 3.229 `frontend/src/utils/settingsWriteOptions.ts`

- No top-level named function/class symbols detected.

### 3.230 `frontend/src/web-api.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `sanitizeBaseUrl` | function | 97 |
| 2 | `isPublicRuntimePath` | function | 101 |
| 3 | `getOfflineDb` | function | 107 |
| 4 | `loadMethodsModule` | function | 112 |
| 5 | `loadAppBootstrapModule` | function | 117 |
| 6 | `loadAuthTransportModule` | function | 122 |
| 7 | `loadPortalTransportModule` | function | 127 |
| 8 | `loadSystemRuntimeModule` | function | 132 |
| 9 | `getLazyApiMethod` | function | 170 |
| 10 | `mapOfflineFileChunkStatusUpdates` | function | 184 |
| 11 | `asArrayBuffer` | function | 200 |
| 12 | `bytesToBase64` | function | 204 |
| 13 | `base64ToBytes` | function | 215 |
| 14 | `stableStringify` | function | 222 |
| 15 | `sha256Hex` | function | 228 |
| 16 | `deriveOfflineVaultKey` | function | 236 |
| 17 | `encryptOfflineVaultValue` | function | 253 |
| 18 | `decryptOfflineVaultValue` | function | 261 |
| 19 | `requestOfflinePersistentStorage` | function | 271 |
| 20 | `dispatchVaultLocked` | function | 278 |
| 21 | `scheduleOfflineVaultIdleLock` | function | 283 |
| 22 | `lockOfflineVault` | function | 289 |
| 23 | `unlockOfflineVault` | function | 297 |
| 24 | `queueBusinessOutboxOperation` | function | 323 |
| 25 | `queueOfflineFileChunks` | function | 360 |
| 26 | `dispatchOutboxProgress` | function | 414 |
| 27 | `dispatchOutboxFileProgress` | function | 421 |
| 28 | `dispatchOutboxConflict` | function | 428 |
| 29 | `getSyncOutboxKey` | function | 435 |
| 30 | `syncUnlockedOfflineOutbox` | function | 439 |
| 31 | `syncUnlockedOfflineFileChunks` | function | 549 |
| 32 | `refreshOfflineSnapshotSoon` | function | 611 |
| 33 | `run` | const arrow | 621 |
| 34 | `refreshServiceWorkerSoon` | function | 640 |
| 35 | `runOfflineMaintenance` | function | 650 |
| 36 | `startOfflineMaintenanceLoop` | function | 663 |
| 37 | `scheduleInitialOfflineMaintenance` | function | 671 |
| 38 | `run` | const arrow | 675 |
| 39 | `scheduleIdle` | const arrow | 679 |
| 40 | `ensureSessionRecoveryListeners` | function | 696 |
| 41 | `scheduleBootstrapStorageMaintenance` | function | 721 |
| 42 | `run` | const arrow | 727 |
| 43 | `scheduleBootstrapOfflineDbWrite` | function | 744 |
| 44 | `run` | const arrow | 750 |
| 45 | `write` | const arrow | 752 |
| 46 | `forwardServiceWorkerOutboxEvent` | function | 771 |
| 47 | `forwardServiceWorkerAppEvent` | function | 859 |

### 3.231 `ops/scripts/frontend/build-public-runtime-scripts.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toProjectPath` | function | 36 |
| 2 | `formatDiagnostic` | function | 40 |
| 3 | `transpileRuntimeScript` | function | 47 |
| 4 | `writeIfChanged` | function | 67 |
| 5 | `main` | function | 74 |

### 3.232 `ops/scripts/frontend/verify-i18n.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `collectUsedKeys` | function | 29 |
| 2 | `flattenTranslationTree` | function | 69 |
| 3 | `listMissing` | function | 83 |
| 4 | `listEmptyValues` | function | 88 |
| 5 | `printList` | function | 95 |
| 6 | `main` | function | 102 |

### 3.233 `ops/scripts/frontend/verify-performance.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `read` | function | 15 |
| 2 | `walk` | function | 19 |
| 3 | `trackedFiles` | function | 37 |
| 4 | `assert` | function | 47 |

### 3.234 `ops/scripts/frontend/verify-ui.ts`

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

### 3.235 `frontend/vite.config.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readGitRevision` | function | 11 |
| 2 | `fixCrossorigin` | function | 49 |
| 3 | `emitBuildManifest` | function | 74 |
| 4 | `shouldDeferModulePreload` | function | 196 |
| 5 | `manualChunks` | function | 200 |

### 3.236 `frontend/tailwind.config.ts`

- No top-level named function/class symbols detected.

