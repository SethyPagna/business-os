# Frontend Function Reference

Auto-generated symbol inventory for frontend files. Regenerate with `node ops/scripts/docs/generate-doc-reference.ts`.

## 1. Coverage Summary

Total files documented: **234**

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
| 11 | `frontend/src/api/contactsTransport.ts` | 9 |
| 12 | `frontend/src/api/cooldownFallbacks.ts` | 3 |
| 13 | `frontend/src/api/customTablesTransport.ts` | 3 |
| 14 | `frontend/src/api/dashboardTransport.ts` | 0 |
| 15 | `frontend/src/api/driveSync.ts` | 0 |
| 16 | `frontend/src/api/expectedUpdatedAt.ts` | 1 |
| 17 | `frontend/src/api/fileTransport.ts` | 5 |
| 18 | `frontend/src/api/http.ts` | 31 |
| 19 | `frontend/src/api/importJobsTransport.ts` | 4 |
| 20 | `frontend/src/api/importTransport.ts` | 0 |
| 21 | `frontend/src/api/inventoryTransport.ts` | 1 |
| 22 | `frontend/src/api/localDb.ts` | 1 |
| 23 | `frontend/src/api/localMirrors.ts` | 0 |
| 24 | `frontend/src/api/lookupTransport.ts` | 4 |
| 25 | `frontend/src/api/methods.ts` | 147 |
| 26 | `frontend/src/api/notificationSummary.ts` | 1 |
| 27 | `frontend/src/api/portalHttp.ts` | 0 |
| 28 | `frontend/src/api/portalTransport.ts` | 2 |
| 29 | `frontend/src/api/productReadTransport.ts` | 0 |
| 30 | `frontend/src/api/productWriteTransport.ts` | 3 |
| 31 | `frontend/src/api/query.ts` | 1 |
| 32 | `frontend/src/api/queryCache.ts` | 0 |
| 33 | `frontend/src/api/requestIds.ts` | 0 |
| 34 | `frontend/src/api/rfidTransport.ts` | 2 |
| 35 | `frontend/src/api/salesTransport.ts` | 0 |
| 36 | `frontend/src/api/syncPreview.ts` | 0 |
| 37 | `frontend/src/api/syncRuntime.ts` | 0 |
| 38 | `frontend/src/api/systemJobs.ts` | 3 |
| 39 | `frontend/src/api/systemRuntime.ts` | 0 |
| 40 | `frontend/src/api/websocket.ts` | 8 |
| 41 | `frontend/src/App.tsx` | 84 |
| 42 | `frontend/src/app/appShellUtils.ts` | 0 |
| 43 | `frontend/src/app/publicErrorRecovery.ts` | 1 |
| 44 | `frontend/src/AppContext.tsx` | 39 |
| 45 | `frontend/src/components/auth/Login.tsx` | 23 |
| 46 | `frontend/src/components/branches/Branches.tsx` | 15 |
| 47 | `frontend/src/components/branches/BranchForm.tsx` | 2 |
| 48 | `frontend/src/components/branches/TransferModal.tsx` | 6 |
| 49 | `frontend/src/components/catalog/CatalogEditorSurface.tsx` | 1 |
| 50 | `frontend/src/components/catalog/CatalogImageField.tsx` | 1 |
| 51 | `frontend/src/components/catalog/CatalogPage.tsx` | 117 |
| 52 | `frontend/src/components/catalog/CatalogPageContext.tsx` | 0 |
| 53 | `frontend/src/components/catalog/CatalogPreviewSurface.tsx` | 2 |
| 54 | `frontend/src/components/catalog/CatalogProductsSection.tsx` | 4 |
| 55 | `frontend/src/components/catalog/CatalogSecondaryTabs.tsx` | 6 |
| 56 | `frontend/src/components/catalog/catalogUi.tsx` | 1 |
| 57 | `frontend/src/components/catalog/portalCatalogDisplay.ts` | 2 |
| 58 | `frontend/src/components/catalog/portalContentI18n.ts` | 14 |
| 59 | `frontend/src/components/catalog/portalEditorUtils.ts` | 2 |
| 60 | `frontend/src/components/catalog/portalLanguagePacks.ts` | 0 |
| 61 | `frontend/src/components/catalog/portalTranslateController.ts` | 2 |
| 62 | `frontend/src/components/contacts/ContactImportModal.tsx` | 8 |
| 63 | `frontend/src/components/contacts/contactImportWorker.ts` | 1 |
| 64 | `frontend/src/components/contacts/contactOptionUtils.ts` | 3 |
| 65 | `frontend/src/components/contacts/Contacts.tsx` | 11 |
| 66 | `frontend/src/components/contacts/CustomerFormModal.tsx` | 10 |
| 67 | `frontend/src/components/contacts/customerMembershipNumber.ts` | 0 |
| 68 | `frontend/src/components/contacts/CustomersTab.tsx` | 16 |
| 69 | `frontend/src/components/contacts/DeliveryTab.tsx` | 25 |
| 70 | `frontend/src/components/contacts/shared.tsx` | 3 |
| 71 | `frontend/src/components/contacts/SuppliersTab.tsx` | 20 |
| 72 | `frontend/src/components/custom-tables/CustomTables.tsx` | 19 |
| 73 | `frontend/src/components/dashboard/charts/BarChart.tsx` | 5 |
| 74 | `frontend/src/components/dashboard/charts/DonutChart.tsx` | 1 |
| 75 | `frontend/src/components/dashboard/charts/index.ts` | 0 |
| 76 | `frontend/src/components/dashboard/charts/LineChart.tsx` | 7 |
| 77 | `frontend/src/components/dashboard/charts/NoData.tsx` | 1 |
| 78 | `frontend/src/components/dashboard/Dashboard.tsx` | 18 |
| 79 | `frontend/src/components/dashboard/MiniStat.tsx` | 1 |
| 80 | `frontend/src/components/files/FilePickerModal.tsx` | 8 |
| 81 | `frontend/src/components/files/FilesPage.tsx` | 27 |
| 82 | `frontend/src/components/files/FilesProvidersTab.tsx` | 2 |
| 83 | `frontend/src/components/files/FilesResponsesTab.tsx` | 1 |
| 84 | `frontend/src/components/inventory/DualMoney.tsx` | 1 |
| 85 | `frontend/src/components/inventory/Inventory.tsx` | 23 |
| 86 | `frontend/src/components/inventory/InventoryImportModal.tsx` | 9 |
| 87 | `frontend/src/components/inventory/inventoryImportWorker.ts` | 1 |
| 88 | `frontend/src/components/inventory/InventoryMovementsSurface.tsx` | 1 |
| 89 | `frontend/src/components/inventory/InventoryProductsSurface.tsx` | 3 |
| 90 | `frontend/src/components/inventory/InventoryRfidSurface.tsx` | 1 |
| 91 | `frontend/src/components/inventory/movementGroups.ts` | 11 |
| 92 | `frontend/src/components/inventory/ProductDetailModal.tsx` | 2 |
| 93 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx` | 10 |
| 94 | `frontend/src/components/navigation/Sidebar.tsx` | 9 |
| 95 | `frontend/src/components/pos/CartItem.tsx` | 2 |
| 96 | `frontend/src/components/pos/FilterPanel.tsx` | 5 |
| 97 | `frontend/src/components/pos/POS.tsx` | 36 |
| 98 | `frontend/src/components/pos/posCore.ts` | 1 |
| 99 | `frontend/src/components/pos/ProductImage.tsx` | 1 |
| 100 | `frontend/src/components/pos/QuickAddModal.tsx` | 2 |
| 101 | `frontend/src/components/products/config/productPageConfig.ts` | 0 |
| 102 | `frontend/src/components/products/forms/BranchStockAdjuster.tsx` | 6 |
| 103 | `frontend/src/components/products/forms/BulkAddStockModal.tsx` | 6 |
| 104 | `frontend/src/components/products/forms/ProductForm.tsx` | 18 |
| 105 | `frontend/src/components/products/forms/VariantFormModal.tsx` | 3 |
| 106 | `frontend/src/components/products/helpers/productDisplayHelpers.ts` | 1 |
| 107 | `frontend/src/components/products/helpers/productFilterHelpers.ts` | 5 |
| 108 | `frontend/src/components/products/helpers/productGalleryHelpers.ts` | 0 |
| 109 | `frontend/src/components/products/helpers/productGroupViewHelpers.ts` | 0 |
| 110 | `frontend/src/components/products/helpers/productMenuHelpers.ts` | 1 |
| 111 | `frontend/src/components/products/helpers/productPageHelpers.ts` | 0 |
| 112 | `frontend/src/components/products/helpers/productSelectionHelpers.ts` | 0 |
| 113 | `frontend/src/components/products/helpers/productWriteHelpers.ts` | 3 |
| 114 | `frontend/src/components/products/history/productHistoryHelpers.ts` | 0 |
| 115 | `frontend/src/components/products/import/BulkImportModal.tsx` | 51 |
| 116 | `frontend/src/components/products/import/productImportPlanner.ts` | 11 |
| 117 | `frontend/src/components/products/import/productImportWorker.ts` | 3 |
| 118 | `frontend/src/components/products/lookups/ManageBrandsModal.tsx` | 9 |
| 119 | `frontend/src/components/products/lookups/ManageCategoriesModal.tsx` | 5 |
| 120 | `frontend/src/components/products/lookups/ManageUnitsModal.tsx` | 5 |
| 121 | `frontend/src/components/products/lookups/productLookupSnapshots.ts` | 7 |
| 122 | `frontend/src/components/products/Products.tsx` | 24 |
| 123 | `frontend/src/components/products/scanning/barcodeImageScanner.ts` | 4 |
| 124 | `frontend/src/components/products/scanning/BarcodeScannerModal.tsx` | 4 |
| 125 | `frontend/src/components/products/scanning/barcodeScannerState.ts` | 0 |
| 126 | `frontend/src/components/products/scanning/cameraPermission.ts` | 3 |
| 127 | `frontend/src/components/products/scanning/scanbotScanner.ts` | 5 |
| 128 | `frontend/src/components/products/shared/primitives.tsx` | 12 |
| 129 | `frontend/src/components/products/surfaces/HeaderActions.tsx` | 2 |
| 130 | `frontend/src/components/products/surfaces/ProductDetailModal.tsx` | 3 |
| 131 | `frontend/src/components/products/surfaces/ProductRowParts.tsx` | 1 |
| 132 | `frontend/src/components/products/surfaces/ProductsListSurface.tsx` | 3 |
| 133 | `frontend/src/components/receipt-settings/AllFieldsPanel.tsx` | 4 |
| 134 | `frontend/src/components/receipt-settings/constants.ts` | 1 |
| 135 | `frontend/src/components/receipt-settings/ErrorBoundary.tsx` | 1 |
| 136 | `frontend/src/components/receipt-settings/FieldOrderManager.tsx` | 9 |
| 137 | `frontend/src/components/receipt-settings/PrintSettings.tsx` | 8 |
| 138 | `frontend/src/components/receipt-settings/ReceiptPreview.tsx` | 3 |
| 139 | `frontend/src/components/receipt-settings/ReceiptSettings.tsx` | 4 |
| 140 | `frontend/src/components/receipt-settings/template.ts` | 2 |
| 141 | `frontend/src/components/receipt/Receipt.tsx` | 10 |
| 142 | `frontend/src/components/returns/EditReturnModal.tsx` | 7 |
| 143 | `frontend/src/components/returns/NewReturnModal.tsx` | 13 |
| 144 | `frontend/src/components/returns/NewSupplierReturnModal.tsx` | 7 |
| 145 | `frontend/src/components/returns/ReturnDetailModal.tsx` | 4 |
| 146 | `frontend/src/components/returns/Returns.tsx` | 12 |
| 147 | `frontend/src/components/returns/ReturnsListSurface.tsx` | 5 |
| 148 | `frontend/src/components/sales/ExportModal.tsx` | 5 |
| 149 | `frontend/src/components/sales/SaleDetailModal.tsx` | 4 |
| 150 | `frontend/src/components/sales/Sales.tsx` | 16 |
| 151 | `frontend/src/components/sales/SalesImportModal.tsx` | 8 |
| 152 | `frontend/src/components/sales/salesImportWorker.ts` | 1 |
| 153 | `frontend/src/components/sales/SalesListSurface.tsx` | 2 |
| 154 | `frontend/src/components/sales/StatusBadge.tsx` | 2 |
| 155 | `frontend/src/components/server/ServerPage.tsx` | 20 |
| 156 | `frontend/src/components/shared/ActionHistoryBar.tsx` | 3 |
| 157 | `frontend/src/components/shared/BackgroundImportTracker.tsx` | 21 |
| 158 | `frontend/src/components/shared/ExportMenu.tsx` | 1 |
| 159 | `frontend/src/components/shared/FilterMenu.tsx` | 2 |
| 160 | `frontend/src/components/shared/globalScroll.ts` | 3 |
| 161 | `frontend/src/components/shared/ImageGalleryLightbox.tsx` | 5 |
| 162 | `frontend/src/components/shared/LoadingWatchdog.tsx` | 1 |
| 163 | `frontend/src/components/shared/Modal.tsx` | 1 |
| 164 | `frontend/src/components/shared/navigationConfig.ts` | 0 |
| 165 | `frontend/src/components/shared/NotificationCenter.tsx` | 9 |
| 166 | `frontend/src/components/shared/pageActivity.ts` | 0 |
| 167 | `frontend/src/components/shared/PageHeader.tsx` | 1 |
| 168 | `frontend/src/components/shared/PaginationControls.tsx` | 3 |
| 169 | `frontend/src/components/shared/PortalMenu.tsx` | 6 |
| 170 | `frontend/src/components/shared/QuickPreferenceToggles.tsx` | 3 |
| 171 | `frontend/src/components/shared/SectionSwitcher.tsx` | 3 |
| 172 | `frontend/src/components/shared/WriteConflictModal.tsx` | 10 |
| 173 | `frontend/src/components/users/PermissionEditor.tsx` | 3 |
| 174 | `frontend/src/components/users/UserDetailSheet.tsx` | 4 |
| 175 | `frontend/src/components/users/UserProfileModal.tsx` | 14 |
| 176 | `frontend/src/components/users/Users.tsx` | 18 |
| 177 | `frontend/src/components/utils-settings/AuditLog.tsx` | 18 |
| 178 | `frontend/src/components/utils-settings/Backup.tsx` | 34 |
| 179 | `frontend/src/components/utils-settings/FontFamilyPicker.tsx` | 1 |
| 180 | `frontend/src/components/utils-settings/index.ts` | 0 |
| 181 | `frontend/src/components/utils-settings/OtpModal.tsx` | 4 |
| 182 | `frontend/src/components/utils-settings/ResetData.tsx` | 10 |
| 183 | `frontend/src/components/utils-settings/Settings.tsx` | 26 |
| 184 | `frontend/src/components/utils-settings/settingsConflict.ts` | 1 |
| 185 | `frontend/src/constants.ts` | 0 |
| 186 | `frontend/src/index.tsx` | 12 |
| 187 | `frontend/src/platform/runtime/clientRuntime.ts` | 9 |
| 188 | `frontend/src/platform/storage/storagePolicy.ts` | 0 |
| 189 | `frontend/src/public-runtime/runtime-noise-guard.ts` | 8 |
| 190 | `frontend/src/public-runtime/service-worker.ts` | 24 |
| 191 | `frontend/src/public-runtime/theme-bootstrap.ts` | 15 |
| 192 | `frontend/src/runtime/runtimeErrorClassifier.ts` | 5 |
| 193 | `frontend/src/types/lucide-react-icons.d.ts` | 0 |
| 194 | `frontend/src/types/receiptContracts.ts` | 0 |
| 195 | `frontend/src/types/settingsContracts.ts` | 0 |
| 196 | `frontend/src/utils/actionGuards.ts` | 1 |
| 197 | `frontend/src/utils/actionHistory.ts` | 4 |
| 198 | `frontend/src/utils/appRefresh.ts` | 0 |
| 199 | `frontend/src/utils/bulkOps.ts` | 1 |
| 200 | `frontend/src/utils/color.ts` | 2 |
| 201 | `frontend/src/utils/csv.ts` | 8 |
| 202 | `frontend/src/utils/csvExportWorker.ts` | 1 |
| 203 | `frontend/src/utils/csvImport.ts` | 8 |
| 204 | `frontend/src/utils/csvRowCounter.ts` | 1 |
| 205 | `frontend/src/utils/dateHelpers.ts` | 1 |
| 206 | `frontend/src/utils/deviceInfo.ts` | 2 |
| 207 | `frontend/src/utils/exportPackage.ts` | 0 |
| 208 | `frontend/src/utils/exportReports.tsx` | 8 |
| 209 | `frontend/src/utils/favicon.ts` | 3 |
| 210 | `frontend/src/utils/formatters.ts` | 1 |
| 211 | `frontend/src/utils/groupedRecords.ts` | 3 |
| 212 | `frontend/src/utils/historyHelpers.ts` | 0 |
| 213 | `frontend/src/utils/importJobRefresh.ts` | 4 |
| 214 | `frontend/src/utils/index.ts` | 0 |
| 215 | `frontend/src/utils/initials.ts` | 1 |
| 216 | `frontend/src/utils/loaders.ts` | 0 |
| 217 | `frontend/src/utils/mediaUpload.ts` | 0 |
| 218 | `frontend/src/utils/permissions.ts` | 1 |
| 219 | `frontend/src/utils/pricing.ts` | 0 |
| 220 | `frontend/src/utils/printReceipt.ts` | 30 |
| 221 | `frontend/src/utils/productBatches.ts` | 1 |
| 222 | `frontend/src/utils/productGrouping.ts` | 9 |
| 223 | `frontend/src/utils/publicAssetUrls.ts` | 6 |
| 224 | `frontend/src/utils/receiptAppliedConfig.ts` | 1 |
| 225 | `frontend/src/utils/scriptTypography.ts` | 0 |
| 226 | `frontend/src/utils/settingsRefresh.ts` | 1 |
| 227 | `frontend/src/utils/settingsWriteOptions.ts` | 0 |
| 228 | `frontend/src/web-api.ts` | 43 |
| 229 | `ops/scripts/frontend/build-public-runtime-scripts.ts` | 5 |
| 230 | `ops/scripts/frontend/verify-i18n.ts` | 6 |
| 231 | `ops/scripts/frontend/verify-performance.ts` | 4 |
| 232 | `ops/scripts/frontend/verify-ui.ts` | 11 |
| 233 | `frontend/vite.config.ts` | 5 |
| 234 | `frontend/tailwind.config.ts` | 0 |

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
| 1 | `getDevicePayload` | function | 39 |
| 2 | `encodeId` | function | 43 |
| 3 | `hasPagedParams` | function | 47 |
| 4 | `localSortedRows` | function | 52 |
| 5 | `readContactList` | function | 56 |
| 6 | `createContact` | function | 78 |
| 7 | `updateContact` | function | 88 |
| 8 | `deleteContact` | function | 102 |
| 9 | `bulkImportContact` | function | 112 |

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
| 1 | `hasExpectedUpdatedAt` | function | 13 |

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
| 1 | `hasStoredAuthSession` | function | 87 |
| 2 | `isProtectedAdminHost` | function | 96 |
| 3 | `normalizeApiPath` | function | 113 |
| 4 | `getApiMismatchKey` | function | 130 |
| 5 | `dispatchApiVersionMismatch` | function | 145 |
| 6 | `logCall` | function | 224 |
| 7 | `getClientMetaHeaders` | function | 232 |
| 8 | `createApiError` | function | 236 |
| 9 | `createCloudflareAccessError` | function | 265 |
| 10 | `dispatchUnauthorized` | function | 275 |
| 11 | `dispatchRuntimeVersionMismatch` | function | 303 |
| 12 | `checkRuntimeVersionFromHealth` | function | 315 |
| 13 | `createWriteBlockedError` | function | 322 |
| 14 | `dispatchWriteBlocked` | function | 333 |
| 15 | `dispatchTransientGatewayOutage` | function | 348 |
| 16 | `getConflictRefreshChannels` | function | 413 |
| 17 | `dispatchGlobalDataRefresh` | function | 422 |
| 18 | `sleep` | function | 431 |
| 19 | `hasUsableLocalData` | function | 435 |
| 20 | `noteReadFailure` | function | 461 |
| 21 | `stableStringifyForDedupe` | function | 482 |
| 22 | `clampDedupeBody` | function | 492 |
| 23 | `methodAllowsRequestBody` | function | 504 |
| 24 | `parsed` | const arrow | 582 |
| 25 | `shouldDispatchUnauthorized` | function | 643 |
| 26 | `isConnectivityError` | function | 656 |
| 27 | `setServerHealth` | function | 683 |
| 28 | `getChannelRefreshKey` | function | 833 |
| 29 | `emitCacheRefresh` | function | 838 |
| 30 | `clearInflight` | function | 852 |
| 31 | `hasReusableInflight` | function | 857 |

### 3.19 `frontend/src/api/importJobsTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `encodeId` | function | 33 |
| 2 | `getSource` | function | 37 |
| 3 | `appendDeviceFields` | function | 41 |
| 4 | `runImportJobAction` | function | 105 |

### 3.20 `frontend/src/api/importTransport.ts`

- No top-level named function/class symbols detected.

### 3.21 `frontend/src/api/inventoryTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDevicePayload` | function | 21 |

### 3.22 `frontend/src/api/localDb.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `splitCSVLine` | function | 268 |

### 3.23 `frontend/src/api/localMirrors.ts`

- No top-level named function/class symbols detected.

### 3.24 `frontend/src/api/lookupTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `listLookupRows` | function | 26 |
| 2 | `createLookupRow` | function | 35 |
| 3 | `updateLookupRow` | function | 44 |
| 4 | `deleteLookupRow` | function | 57 |

### 3.25 `frontend/src/api/methods.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDeviceInfo` | function | 6 |
| 2 | `canRefreshOfflineDeviceSnapshot` | function | 330 |
| 3 | `readOfflineDeviceSnapshotMeta` | function | 337 |
| 4 | `writeOfflineDeviceSnapshotMeta` | function | 345 |
| 5 | `runOfflineSnapshotStep` | function | 362 |
| 6 | `previousMeta` | const arrow | 382 |
| 7 | `invalidateClientRuntimeState` | function | 427 |
| 8 | `login` | const arrow | 458 |
| 9 | `logout` | const arrow | 460 |
| 10 | `resetPasswordWithOtp` | const arrow | 462 |
| 11 | `requestPasswordResetEmail` | const arrow | 464 |
| 12 | `completePasswordReset` | const arrow | 466 |
| 13 | `updateSessionDuration` | const arrow | 468 |
| 14 | `getVerificationCapabilities` | const arrow | 470 |
| 15 | `getSystemConfig` | const arrow | 472 |
| 16 | `getSystemDebugLog` | const arrow | 477 |
| 17 | `startGoogleOauth` | const arrow | 479 |
| 18 | `completeGoogleOauth` | const arrow | 481 |
| 19 | `unlinkGoogleOauth` | const arrow | 483 |
| 20 | `getAppBootstrap` | const arrow | 485 |
| 21 | `getOrganizationBootstrap` | const arrow | 489 |
| 22 | `searchOrganizations` | const arrow | 491 |
| 23 | `getCurrentOrganization` | const arrow | 493 |
| 24 | `runSave` | const arrow | 519 |
| 25 | `getCategories` | const arrow | 582 |
| 26 | `updateCategory` | const arrow | 589 |
| 27 | `deleteCategory` | const arrow | 594 |
| 28 | `getUnits` | const arrow | 601 |
| 29 | `updateUnit` | const arrow | 608 |
| 30 | `deleteUnit` | const arrow | 613 |
| 31 | `getBranches` | const arrow | 620 |
| 32 | `getBranchSummary` | const arrow | 622 |
| 33 | `updateBranch` | const arrow | 626 |
| 34 | `deleteBranch` | const arrow | 628 |
| 35 | `getBranchStock` | const arrow | 630 |
| 36 | `getTransfers` | const arrow | 632 |
| 37 | `getBranchStockIntegrity` | const arrow | 636 |
| 38 | `getProducts` | const arrow | 642 |
| 39 | `searchProducts` | const arrow | 644 |
| 40 | `getProductsByIds` | const arrow | 646 |
| 41 | `getProductFilters` | const arrow | 648 |
| 42 | `getProductLookupUsage` | const arrow | 650 |
| 43 | `replaceProductLookupValues` | const arrow | 652 |
| 44 | `getPortalSubmissionsForReview` | const arrow | 687 |
| 45 | `reviewPortalSubmission` | const arrow | 689 |
| 46 | `getAiProviders` | const arrow | 692 |
| 47 | `createAiProvider` | const arrow | 694 |
| 48 | `updateAiProvider` | const arrow | 696 |
| 49 | `deleteAiProvider` | const arrow | 698 |
| 50 | `testAiProvider` | const arrow | 700 |
| 51 | `getAiResponses` | const arrow | 702 |
| 52 | `createProduct` | const arrow | 704 |
| 53 | `updateProduct` | const arrow | 706 |
| 54 | `deleteProduct` | const arrow | 708 |
| 55 | `otpSetup` | const arrow | 712 |
| 56 | `otpConfirm` | const arrow | 714 |
| 57 | `otpDisable` | const arrow | 716 |
| 58 | `otpVerify` | const arrow | 718 |
| 59 | `otpStatus` | const arrow | 720 |
| 60 | `listImportJobs` | const arrow | 732 |
| 61 | `getImportJobReview` | const arrow | 736 |
| 62 | `updateImportJobDecisions` | const arrow | 738 |
| 63 | `startImportJob` | const arrow | 742 |
| 64 | `approveImportJob` | const arrow | 744 |
| 65 | `cancelImportJob` | const arrow | 746 |
| 66 | `retryImportJob` | const arrow | 748 |
| 67 | `deleteImportJob` | const arrow | 750 |
| 68 | `getImportQueueStatus` | const arrow | 752 |
| 69 | `getFiles` | const arrow | 763 |
| 70 | `deleteFileAsset` | const arrow | 769 |
| 71 | `getActionHistory` | const arrow | 807 |
| 72 | `updateActionHistory` | const arrow | 812 |
| 73 | `getInventorySummary` | const arrow | 818 |
| 74 | `getInventoryStats` | const arrow | 820 |
| 75 | `searchInventoryProducts` | const arrow | 822 |
| 76 | `getInventoryMovements` | const arrow | 824 |
| 77 | `getInventoryReasons` | const arrow | 826 |
| 78 | `saveInventoryReasons` | const arrow | 828 |
| 79 | `buildOfflineSaleReceiptNumber` | function | 831 |
| 80 | `isRetryableOfflineSaleError` | function | 837 |
| 81 | `findQueuedSale` | function | 846 |
| 82 | `putOfflineSaleMirror` | function | 853 |
| 83 | `queueOfflineSale` | function | 878 |
| 84 | `queuedSaleBackoffMs` | function | 936 |
| 85 | `updateQueuedRow` | function | 941 |
| 86 | `completeQueuedSale` | function | 950 |
| 87 | `failQueuedSale` | function | 973 |
| 88 | `markQueuedSaleConflict` | function | 986 |
| 89 | `syncPendingSalesQueue` | function | 1008 |
| 90 | `getRfidStatus` | const arrow | 1051 |
| 91 | `searchRfidTags` | const arrow | 1056 |
| 92 | `recordRfidSessionEvents` | const arrow | 1061 |
| 93 | `applyRfidSession` | const arrow | 1065 |
| 94 | `getSales` | const arrow | 1081 |
| 95 | `getDashboard` | const arrow | 1086 |
| 96 | `getAnalytics` | const arrow | 1087 |
| 97 | `getCustomers` | const arrow | 1090 |
| 98 | `getCustomerPointSummaries` | const arrow | 1093 |
| 99 | `updateCustomer` | const arrow | 1099 |
| 100 | `deleteCustomer` | const arrow | 1102 |
| 101 | `downloadCustomerTemplate` | const arrow | 1107 |
| 102 | `getSuppliers` | const arrow | 1111 |
| 103 | `updateSupplier` | const arrow | 1117 |
| 104 | `deleteSupplier` | const arrow | 1120 |
| 105 | `downloadSupplierTemplate` | const arrow | 1125 |
| 106 | `getDeliveryContacts` | const arrow | 1129 |
| 107 | `updateDeliveryContact` | const arrow | 1135 |
| 108 | `deleteDeliveryContact` | const arrow | 1138 |
| 109 | `getUsers` | const arrow | 1145 |
| 110 | `updateUser` | const arrow | 1147 |
| 111 | `getUserProfile` | const arrow | 1148 |
| 112 | `getUserAuthMethods` | const arrow | 1149 |
| 113 | `updateUserProfile` | const arrow | 1151 |
| 114 | `disconnectUserAuthProvider` | const arrow | 1153 |
| 115 | `changeUserPassword` | const arrow | 1155 |
| 116 | `resetPassword` | const arrow | 1157 |
| 117 | `getRoles` | const arrow | 1160 |
| 118 | `updateRole` | const arrow | 1162 |
| 119 | `deleteRole` | const arrow | 1163 |
| 120 | `getCustomTables` | const arrow | 1166 |
| 121 | `getCustomTableData` | const arrow | 1168 |
| 122 | `insertCustomRow` | const arrow | 1169 |
| 123 | `updateCustomRow` | const arrow | 1170 |
| 124 | `deleteCustomRow` | const arrow | 1171 |
| 125 | `getAuditLogs` | const arrow | 1174 |
| 126 | `deleteAuditLogsRetention` | const arrow | 1177 |
| 127 | `getIntegrationDoctor` | const arrow | 1193 |
| 128 | `getGoogleDriveSyncStatus` | const arrow | 1216 |
| 129 | `saveGoogleDriveSyncPreferences` | const arrow | 1219 |
| 130 | `startGoogleDriveSyncOauth` | const arrow | 1222 |
| 131 | `disconnectGoogleDriveSync` | const arrow | 1225 |
| 132 | `forgetGoogleDriveSyncCredentials` | const arrow | 1228 |
| 133 | `queueGoogleDriveSyncNow` | const arrow | 1231 |
| 134 | `syncGoogleDriveNow` | const arrow | 1234 |
| 135 | `openPath` | const arrow | 1299 |
| 136 | `getReturns` | const arrow | 1303 |
| 137 | `updateSaleStatus` | const arrow | 1324 |
| 138 | `attachSaleCustomer` | const arrow | 1340 |
| 139 | `getSalesExport` | const arrow | 1364 |
| 140 | `updateReturn` | const arrow | 1368 |
| 141 | `testSyncServer` | const arrow | 1392 |
| 142 | `openFolderDialog` | const arrow | 1397 |
| 143 | `getDataPath` | const arrow | 1401 |
| 144 | `getScaleMigrationStatus` | const arrow | 1403 |
| 145 | `prepareScaleMigration` | const arrow | 1405 |
| 146 | `runScaleMigration` | const arrow | 1407 |
| 147 | `browseDir` | const arrow | 1419 |

### 3.26 `frontend/src/api/notificationSummary.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `buildNotificationSummaryFallback` | function | 12 |

### 3.27 `frontend/src/api/portalHttp.ts`

- No top-level named function/class symbols detected.

### 3.28 `frontend/src/api/portalTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readJsonObject` | function | 18 |
| 2 | `fetchPortalJson` | function | 22 |

### 3.29 `frontend/src/api/productReadTransport.ts`

- No top-level named function/class symbols detected.

### 3.30 `frontend/src/api/productWriteTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDevicePayload` | function | 9 |
| 2 | `encodeId` | function | 13 |
| 3 | `ensureSupplierExists` | function | 17 |

### 3.31 `frontend/src/api/query.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `appendQueryValue` | function | 44 |

### 3.32 `frontend/src/api/queryCache.ts`

- No top-level named function/class symbols detected.

### 3.33 `frontend/src/api/requestIds.ts`

- No top-level named function/class symbols detected.

### 3.34 `frontend/src/api/rfidTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDevicePayload` | function | 7 |
| 2 | `encodeId` | function | 11 |

### 3.35 `frontend/src/api/salesTransport.ts`

- No top-level named function/class symbols detected.

### 3.36 `frontend/src/api/syncPreview.ts`

- No top-level named function/class symbols detected.

### 3.37 `frontend/src/api/syncRuntime.ts`

- No top-level named function/class symbols detected.

### 3.38 `frontend/src/api/systemJobs.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `wait` | function | 25 |
| 2 | `requireJobId` | function | 29 |
| 3 | `unwrapSystemJob` | function | 35 |

### 3.39 `frontend/src/api/systemRuntime.ts`

- No top-level named function/class symbols detected.

### 3.40 `frontend/src/api/websocket.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `clearReconnectTimer` | function | 21 |
| 2 | `clearPingTimer` | function | 27 |
| 3 | `hasStoredAuthSession` | function | 33 |
| 4 | `shouldRegisterSessionLifecycleListeners` | function | 42 |
| 5 | `isProtectedAdminHost` | function | 46 |
| 6 | `shouldDebugWs` | function | 56 |
| 7 | `logWs` | function | 66 |
| 8 | `scheduleReconnect` | function | 187 |

### 3.41 `frontend/src/App.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `asPageModule` | function | 179 |
| 2 | `getAppShellApi` | function | 183 |
| 3 | `getConnection` | function | 187 |
| 4 | `isPageId` | function | 193 |
| 5 | `normalizePageId` | function | 197 |
| 6 | `getErrorMessage` | function | 201 |
| 7 | `getChunkErrorMessage` | function | 297 |
| 8 | `isChunkLoadError` | function | 302 |
| 9 | `createChunkTimeoutError` | function | 311 |
| 10 | `isRetryableImportError` | function | 317 |
| 11 | `importWithTimeout` | function | 325 |
| 12 | `clearRetryMarker` | function | 341 |
| 13 | `buildChunkRecoveryUrl` | function | 348 |
| 14 | `deleteStaleShellCaches` | function | 359 |
| 15 | `clearStaleShellCaches` | function | 372 |
| 16 | `triggerChunkRecoveryReload` | function | 382 |
| 17 | `reload` | const arrow | 389 |
| 18 | `createChunkReloadStallError` | function | 399 |
| 19 | `shouldRetryChunk` | function | 405 |
| 20 | `lazyWithRetry` | function | 415 |
| 21 | `getWarmupImporters` | function | 491 |
| 22 | `shouldSkipBackgroundWarmup` | function | 502 |
| 23 | `shouldSkipIntentWarmup` | function | 511 |
| 24 | `getIntentPageId` | function | 520 |
| 25 | `scheduleIntentChunkLoad` | function | 526 |
| 26 | `run` | const arrow | 533 |
| 27 | `scheduleInitialPendingSyncRefresh` | function | 557 |
| 28 | `run` | const arrow | 563 |
| 29 | `isImportTrackerWakeEvent` | function | 585 |
| 30 | `isNotificationCenterWakeEvent` | function | 592 |
| 31 | `getDataWarmupLoaders` | function | 599 |
| 32 | `createWarmupLoader` | function | 608 |
| 33 | `runWarmupBatches` | function | 613 |
| 34 | `scheduleWarmupAfterLoad` | function | 622 |
| 35 | `run` | const arrow | 627 |
| 36 | `getPageEntryWarmupLoaders` | function | 645 |
| 37 | `useMountedPages` | function | 652 |
| 38 | `syncProfile` | const arrow | 666 |
| 39 | `useSyncErrorBanner` | function | 695 |
| 40 | `refreshPendingSync` | const arrow | 715 |
| 41 | `onSyncError` | const arrow | 720 |
| 42 | `onTransientOutage` | const arrow | 726 |
| 43 | `onSyncRecovered` | const arrow | 734 |
| 44 | `onQueueChanged` | const arrow | 742 |
| 45 | `onVaultLocked` | const arrow | 743 |
| 46 | `onAppUpdate` | const arrow | 744 |
| 47 | `onConflictReview` | const arrow | 745 |
| 48 | `useDeferredImportTrackerMount` | function | 793 |
| 49 | `enable` | const arrow | 806 |
| 50 | `enableWhenVisible` | const arrow | 810 |
| 51 | `onSyncUpdate` | const arrow | 815 |
| 52 | `onVisible` | const arrow | 818 |
| 53 | `useDeferredNotificationCenterMount` | function | 847 |
| 54 | `enable` | const arrow | 866 |
| 55 | `enableWhenVisible` | const arrow | 870 |
| 56 | `onSyncUpdate` | const arrow | 874 |
| 57 | `useVisibilityRecovery` | function | 907 |
| 58 | `onVisible` | const arrow | 911 |
| 59 | `onFocus` | const arrow | 921 |
| 60 | `useChunkWarmup` | function | 939 |
| 61 | `runWarmup` | const arrow | 950 |
| 62 | `useIntentChunkWarmup` | function | 992 |
| 63 | `warmIntentPage` | const arrow | 999 |
| 64 | `useDataWarmup` | function | 1019 |
| 65 | `runWarmup` | const arrow | 1031 |
| 66 | `usePageEntryWarmup` | function | 1056 |
| 67 | `run` | const arrow | 1085 |
| 68 | `PageErrorBoundary` | class | 1114 |
| 69 | `Notification` | function | 1167 |
| 70 | `SyncErrorBanner` | function | 1180 |
| 71 | `GlobalScrollControls` | function | 1202 |
| 72 | `scrollTo` | const arrow | 1203 |
| 73 | `formatSyncTimestamp` | function | 1240 |
| 74 | `OfflineModeBanner` | function | 1255 |
| 75 | `PageLoader` | function | 1404 |
| 76 | `NotificationCenterFallback` | function | 1447 |
| 77 | `PageSlot` | function | 1462 |
| 78 | `PublicCatalogView` | function | 1488 |
| 79 | `App` | component/function | 1498 |
| 80 | `cleanupRecoveryStorageMarkers` | const arrow | 1575 |
| 81 | `onQueued` | const arrow | 1604 |
| 82 | `onSynced` | const arrow | 1617 |
| 83 | `handleLocationChange` | const arrow | 1642 |
| 84 | `processFavicon` | function | 1690 |

### 3.42 `frontend/src/app/appShellUtils.ts`

- No top-level named function/class symbols detected.

### 3.43 `frontend/src/app/publicErrorRecovery.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getRecoveryStorage` | function | 6 |

### 3.44 `frontend/src/AppContext.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getAppApi` | function | 197 |
| 2 | `getErrorMessage` | function | 207 |
| 3 | `flattenTranslationTree` | function | 211 |
| 4 | `safeStorageGet` | function | 267 |
| 5 | `safeStorageSet` | function | 275 |
| 6 | `safeStorageRemove` | function | 281 |
| 7 | `getStoredUserPayload` | function | 287 |
| 8 | `getStoredUserExpiry` | function | 291 |
| 9 | `clearPersistedAuthState` | function | 295 |
| 10 | `persistAuthState` | function | 308 |
| 11 | `computeSessionExpiryMs` | function | 330 |
| 12 | `readDeviceSettings` | function | 346 |
| 13 | `writeDeviceSettings` | function | 355 |
| 14 | `writeStoredSessionDuration` | function | 361 |
| 15 | `readPendingOauthLink` | function | 369 |
| 16 | `clearPendingOauthLink` | function | 383 |
| 17 | `readOauthCallbackResult` | function | 389 |
| 18 | `clearOauthCallbackResult` | function | 400 |
| 19 | `mergeSettingsWithDeviceOverrides` | function | 406 |
| 20 | `normalizeDateInput` | function | 410 |
| 21 | `buildRuntimeDescriptorFromBootstrap` | function | 428 |
| 22 | `LoadingScreen` | function | 457 |
| 23 | `AccessDenied` | function | 470 |
| 24 | `persistAutoSyncUrl` | const arrow | 559 |
| 25 | `onUpdate` | const arrow | 757 |
| 26 | `onStatus` | const arrow | 789 |
| 27 | `poll` | const arrow | 798 |
| 28 | `onError` | const arrow | 818 |
| 29 | `onWriteBlocked` | const arrow | 840 |
| 30 | `onRuntimeMismatch` | const arrow | 850 |
| 31 | `onConflict` | const arrow | 870 |
| 32 | `onUnauthorized` | const arrow | 939 |
| 33 | `handleOtpLogin` | const arrow | 998 |
| 34 | `handleUserUpdated` | const arrow | 1040 |
| 35 | `discoverSyncUrl` | const arrow | 1077 |
| 36 | `runStartupHealthProbe` | const arrow | 1100 |
| 37 | `clearCallbackUrl` | const arrow | 1470 |
| 38 | `clearPendingLink` | const arrow | 1474 |
| 39 | `run` | const arrow | 1478 |

### 3.45 `frontend/src/components/auth/Login.tsx`

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

### 3.46 `frontend/src/components/branches/Branches.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBranchApi` | function | 184 |
| 2 | `getErrorMessage` | function | 188 |
| 3 | `isBranchRecord` | function | 192 |
| 4 | `isTransferRecord` | function | 196 |
| 5 | `BranchStatTile` | function | 200 |
| 6 | `formatTransferDate` | function | 217 |
| 7 | `Branches` | component/function | 234 |
| 8 | `promise` | const arrow | 281 |
| 9 | `loadBranchStock` | const arrow | 418 |
| 10 | `loadMoreBranchStock` | const arrow | 439 |
| 11 | `handleSaveBranch` | const arrow | 470 |
| 12 | `handleDelete` | const arrow | 538 |
| 13 | `handleBulkDelete` | const arrow | 586 |
| 14 | `toggleSelect` | const arrow | 672 |
| 15 | `toggleSelectAll` | const arrow | 681 |

### 3.47 `frontend/src/components/branches/BranchForm.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `BranchForm` | component/function | 37 |
| 2 | `handleSave` | const arrow | 57 |

### 3.48 `frontend/src/components/branches/TransferModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getTransferApi` | function | 71 |
| 2 | `getErrorMessage` | function | 76 |
| 3 | `normalizeTransferStockRows` | function | 80 |
| 4 | `TransferModal` | component/function | 94 |
| 5 | `loadStock` | function | 146 |
| 6 | `handleTransfer` | const arrow | 194 |

### 3.49 `frontend/src/components/catalog/CatalogEditorSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `CatalogEditorSurface` | component/function | 200 |

### 3.50 `frontend/src/components/catalog/CatalogImageField.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `CatalogImageField` | component/function | 29 |

### 3.51 `frontend/src/components/catalog/CatalogPage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadCatalogEditorSurface` | const arrow | 91 |
| 2 | `loadCatalogSecondaryTabs` | const arrow | 92 |
| 3 | `loadCatalogProductsSection` | const arrow | 93 |
| 4 | `loadCatalogPreviewSurface` | const arrow | 94 |
| 5 | `getCatalogApi` | function | 238 |
| 6 | `getCatalogErrorMessage` | function | 242 |
| 7 | `normalizePortalInitialOptions` | function | 246 |
| 8 | `normalizeCatalogOptions` | function | 255 |
| 9 | `normalizeBrandOptions` | function | 266 |
| 10 | `getAboutBlockLabel` | function | 271 |
| 11 | `withAssetVersion` | function | 277 |
| 12 | `sanitizePortalMediaValue` | function | 287 |
| 13 | `tt` | function | 297 |
| 14 | `toBoolean` | function | 305 |
| 15 | `toNumber` | function | 312 |
| 16 | `normalizePriceDisplay` | function | 319 |
| 17 | `normalizeHexColor` | function | 325 |
| 18 | `normalizeExternalUrl` | function | 331 |
| 19 | `createFaqId` | function | 347 |
| 20 | `normalizeFaqItems` | function | 351 |
| 21 | `translatedPortalText` | function | 407 |
| 22 | `translateConfiguredFaqText` | function | 413 |
| 23 | `localizeConfiguredFaqItems` | function | 420 |
| 24 | `buildFaqStarterItems` | function | 428 |
| 25 | `buildAiFaqStarterItems` | function | 437 |
| 26 | `hexToRgba` | function | 447 |
| 27 | `readPortalCache` | function | 458 |
| 28 | `writePortalCache` | function | 481 |
| 29 | `normalizePortalPath` | function | 500 |
| 30 | `isReservedPortalPath` | function | 513 |
| 31 | `getPortalTabs` | function | 517 |
| 32 | `resolvePortalActiveTab` | function | 528 |
| 33 | `buildDraft` | function | 536 |
| 34 | `applyDraft` | function | 636 |
| 35 | `getBranchQty` | function | 760 |
| 36 | `getStockStatus` | function | 767 |
| 37 | `normalizeProductGallery` | function | 778 |
| 38 | `normalizePortalProductSearch` | function | 795 |
| 39 | `buildRecommendedProductOption` | function | 799 |
| 40 | `productMatchesRecommendedSearch` | function | 809 |
| 41 | `formatDateTime` | function | 824 |
| 42 | `formatPortalPrice` | function | 832 |
| 43 | `ImageField` | function | 845 |
| 44 | `readImageFileAsDataUrl` | function | 934 |
| 45 | `readImageFilesAsDataUrls` | function | 943 |
| 46 | `pickImageAsDataUrl` | function | 966 |
| 47 | `pickMultipleImagesAsDataUrls` | function | 979 |
| 48 | `replaceVars` | function | 992 |
| 49 | `getPortalResourceText` | function | 996 |
| 50 | `isFirstPartyTranslateTarget` | function | 1034 |
| 51 | `normalizePortalTranslateChoice` | function | 1041 |
| 52 | `isDocumentVisible` | function | 1049 |
| 53 | `sleep` | function | 1054 |
| 54 | `CatalogPage` | component/function | 1160 |
| 55 | `warmPublicProductsPanel` | const arrow | 1274 |
| 56 | `warmPublicSecondaryTabs` | const arrow | 1278 |
| 57 | `updateMediaUploadState` | const arrow | 1430 |
| 58 | `forgetMediaUploadState` | const arrow | 1437 |
| 59 | `loadAssistantStatus` | function | 1484 |
| 60 | `openProductGallery` | function | 1506 |
| 61 | `changeTranslateTarget` | function | 1519 |
| 62 | `isPortalLoadCurrent` | function | 1567 |
| 63 | `loadPortalEditorData` | function | 1571 |
| 64 | `refreshPortalView` | function | 1613 |
| 65 | `loadPortal` | function | 1642 |
| 66 | `ensureLink` | const arrow | 1898 |
| 67 | `updateVisibility` | const arrow | 1991 |
| 68 | `handleScroll` | const arrow | 2021 |
| 69 | `initWidget` | const arrow | 2066 |
| 70 | `waitForWidget` | const arrow | 2084 |
| 71 | `toggleFilterValue` | function | 2208 |
| 72 | `clearPortalFilters` | function | 2216 |
| 73 | `setDraft` | function | 2224 |
| 74 | `toggleRecommendedProduct` | function | 2229 |
| 75 | `openPortalImage` | function | 2238 |
| 76 | `setAboutBlocksDraft` | function | 2249 |
| 77 | `setPromoItemsDraft` | function | 2253 |
| 78 | `getPortalMediaValue` | function | 2257 |
| 79 | `setPortalMediaValue` | function | 2271 |
| 80 | `clearPortalUploadPreview` | function | 2285 |
| 81 | `clearPortalMediaTarget` | function | 2291 |
| 82 | `uploadPortalMedia` | function | 2302 |
| 83 | `cancelPortalMediaUpload` | function | 2373 |
| 84 | `updateAboutBlock` | function | 2379 |
| 85 | `updatePromoItem` | function | 2385 |
| 86 | `addAboutBlock` | function | 2391 |
| 87 | `addPromoItem` | function | 2395 |
| 88 | `moveAboutBlockBefore` | function | 2399 |
| 89 | `removeAboutBlock` | function | 2411 |
| 90 | `movePromoItemBefore` | function | 2422 |
| 91 | `removePromoItem` | function | 2434 |
| 92 | `setFaqDraft` | function | 2445 |
| 93 | `addFaqItem` | function | 2449 |
| 94 | `mergeFaqStarterItems` | function | 2460 |
| 95 | `addFaqStarterSet` | function | 2473 |
| 96 | `addAiFaqStarterSet` | function | 2477 |
| 97 | `updateFaqItem` | function | 2481 |
| 98 | `removeFaqItem` | function | 2487 |
| 99 | `clearAssistantState` | function | 2491 |
| 100 | `uploadDraftImage` | function | 2506 |
| 101 | `uploadAboutBlockMedia` | function | 2510 |
| 102 | `uploadPromoItemMedia` | function | 2516 |
| 103 | `openFilePicker` | function | 2520 |
| 104 | `handleFilePickerSelect` | function | 2524 |
| 105 | `savePortalDraft` | function | 2552 |
| 106 | `askAssistant` | function | 2744 |
| 107 | `refreshMembershipData` | function | 2790 |
| 108 | `handleMembershipLookup` | function | 2832 |
| 109 | `addSubmissionImages` | function | 2845 |
| 110 | `handleSubmissionPaste` | function | 2855 |
| 111 | `handleSubmitShareProof` | function | 2871 |
| 112 | `handleReviewSubmission` | function | 2918 |
| 113 | `renderCatalogSection` | function | 3081 |
| 114 | `handleUploadSubmissionImages` | const arrow | 3107 |
| 115 | `renderSecondaryTabPanel` | function | 3163 |
| 116 | `renderSecondaryTabSection` | function | 3175 |
| 117 | `scrollPublicPortal` | const arrow | 3304 |

### 3.52 `frontend/src/components/catalog/CatalogPageContext.tsx`

- No top-level named function/class symbols detected.

### 3.53 `frontend/src/components/catalog/CatalogPreviewSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `CatalogPreviewSurface` | component/function | 113 |
| 2 | `handlePortalTabClick` | const arrow | 151 |

### 3.54 `frontend/src/components/catalog/CatalogProductsSection.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBadgeIcon` | function | 120 |
| 2 | `getBadgeToneClass` | function | 128 |
| 3 | `getProductInitial` | function | 137 |
| 4 | `CatalogProductsSection` | component/function | 145 |

### 3.55 `frontend/src/components/catalog/CatalogSecondaryTabs.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizePortalColor` | function | 267 |
| 2 | `CatalogMembershipSection` | function | 272 |
| 3 | `CatalogAboutSection` | function | 618 |
| 4 | `CatalogFaqSection` | function | 832 |
| 5 | `CatalogAiSection` | function | 886 |
| 6 | `CatalogSecondaryTabs` | component/function | 1072 |

### 3.56 `frontend/src/components/catalog/catalogUi.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `statusClass` | function | 22 |

### 3.57 `frontend/src/components/catalog/portalCatalogDisplay.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `replaceRankVars` | function | 173 |
| 2 | `normalizeRankBadgeLabel` | function | 177 |

### 3.58 `frontend/src/components/catalog/portalContentI18n.ts`

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

### 3.59 `frontend/src/components/catalog/portalEditorUtils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPlainObject` | function | 47 |
| 2 | `toTrimmedString` | function | 51 |

### 3.60 `frontend/src/components/catalog/portalLanguagePacks.ts`

- No top-level named function/class symbols detected.

### 3.61 `frontend/src/components/catalog/portalTranslateController.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeLanguage` | function | 16 |
| 2 | `ensureLinkHint` | function | 108 |

### 3.62 `frontend/src/components/contacts/ContactImportModal.tsx`

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

### 3.63 `frontend/src/components/contacts/contactImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.64 `frontend/src/components/contacts/contactOptionUtils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPlainRecord` | function | 24 |
| 2 | `readStringField` | function | 28 |
| 3 | `normalizeOption` | function | 45 |

### 3.65 `frontend/src/components/contacts/Contacts.tsx`

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

### 3.66 `frontend/src/components/contacts/CustomerFormModal.tsx`

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

### 3.67 `frontend/src/components/contacts/customerMembershipNumber.ts`

- No top-level named function/class symbols detected.

### 3.68 `frontend/src/components/contacts/CustomersTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getCustomerApi` | function | 121 |
| 2 | `isSectionRow` | function | 126 |
| 3 | `normalizeCustomerRows` | function | 130 |
| 4 | `getApiListPayload` | function | 137 |
| 5 | `getErrorMessage` | function | 141 |
| 6 | `formatPoints` | function | 145 |
| 7 | `tr` | function | 157 |
| 8 | `CustomersTab` | function | 166 |
| 9 | `toggleSectionCollapsed` | const arrow | 329 |
| 10 | `isSectionFullySelected` | const arrow | 335 |
| 11 | `isSectionPartiallySelected` | const arrow | 336 |
| 12 | `toggleSectionSelection` | const arrow | 337 |
| 13 | `promise` | const arrow | 371 |
| 14 | `handleSave` | const arrow | 458 |
| 15 | `handleDelete` | const arrow | 535 |
| 16 | `handleBulkDelete` | const arrow | 574 |

### 3.69 `frontend/src/components/contacts/DeliveryTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDeliveryApi` | function | 116 |
| 2 | `normalizeDeliveryRows` | function | 121 |
| 3 | `isSectionRow` | function | 129 |
| 4 | `getErrorMessage` | function | 133 |
| 5 | `BLANK_OPTION` | const arrow | 150 |
| 6 | `OptionEditor` | function | 161 |
| 7 | `set` | const arrow | 162 |
| 8 | `fieldId` | const arrow | 163 |
| 9 | `DeliveryForm` | function | 208 |
| 10 | `set` | const arrow | 217 |
| 11 | `addOption` | const arrow | 218 |
| 12 | `updateOption` | const arrow | 222 |
| 13 | `removeOption` | const arrow | 223 |
| 14 | `handleSave` | const arrow | 224 |
| 15 | `OptionsDisplay` | function | 294 |
| 16 | `OptionsBadge` | function | 311 |
| 17 | `DeliveryTab` | function | 322 |
| 18 | `toggleSectionCollapsed` | const arrow | 462 |
| 19 | `isSectionFullySelected` | const arrow | 468 |
| 20 | `isSectionPartiallySelected` | const arrow | 469 |
| 21 | `toggleSectionSelection` | const arrow | 470 |
| 22 | `promise` | const arrow | 502 |
| 23 | `handleSave` | const arrow | 564 |
| 24 | `handleDelete` | const arrow | 626 |
| 25 | `handleBulkDelete` | const arrow | 663 |

### 3.70 `frontend/src/components/contacts/shared.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toggleOne` | const arrow | 100 |
| 2 | `clearSelection` | const arrow | 111 |
| 3 | `menuContent` | const arrow | 165 |

### 3.71 `frontend/src/components/contacts/SuppliersTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getSupplierApi` | function | 119 |
| 2 | `normalizeSupplierRows` | function | 124 |
| 3 | `isSectionRow` | function | 132 |
| 4 | `getErrorMessage` | function | 136 |
| 5 | `SupplierForm` | function | 147 |
| 6 | `set` | const arrow | 163 |
| 7 | `addOption` | const arrow | 164 |
| 8 | `updateOption` | const arrow | 168 |
| 9 | `removeOption` | const arrow | 169 |
| 10 | `handleSubmit` | const arrow | 170 |
| 11 | `fieldId` | const arrow | 218 |
| 12 | `SuppliersTab` | function | 264 |
| 13 | `toggleSectionCollapsed` | const arrow | 411 |
| 14 | `isSectionFullySelected` | const arrow | 417 |
| 15 | `isSectionPartiallySelected` | const arrow | 418 |
| 16 | `toggleSectionSelection` | const arrow | 419 |
| 17 | `promise` | const arrow | 453 |
| 18 | `handleSave` | const arrow | 516 |
| 19 | `handleDelete` | const arrow | 586 |
| 20 | `handleBulkDelete` | const arrow | 625 |

### 3.72 `frontend/src/components/custom-tables/CustomTables.tsx`

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

### 3.73 `frontend/src/components/dashboard/charts/BarChart.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `chartLabelsNeedYear` | function | 23 |
| 2 | `formatAxisLabel` | function | 32 |
| 3 | `BarChart` | component/function | 45 |
| 4 | `updateWidth` | const arrow | 53 |
| 5 | `yPx` | function | 89 |

### 3.74 `frontend/src/components/dashboard/charts/DonutChart.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `DonutChart` | component/function | 22 |

### 3.75 `frontend/src/components/dashboard/charts/index.ts`

- No top-level named function/class symbols detected.

### 3.76 `frontend/src/components/dashboard/charts/LineChart.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `chartLabelsNeedYear` | function | 28 |
| 2 | `formatAxisLabel` | function | 37 |
| 3 | `LineChart` | component/function | 50 |
| 4 | `updateWidth` | const arrow | 58 |
| 5 | `xPx` | function | 100 |
| 6 | `yPx` | function | 104 |
| 7 | `handleMouseMove` | const arrow | 114 |

### 3.77 `frontend/src/components/dashboard/charts/NoData.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `NoData` | component/function | 7 |

### 3.78 `frontend/src/components/dashboard/Dashboard.tsx`

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

### 3.79 `frontend/src/components/dashboard/MiniStat.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `MiniStat` | component/function | 13 |

### 3.80 `frontend/src/components/files/FilePickerModal.tsx`

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

### 3.81 `frontend/src/components/files/FilesPage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadFilesProvidersTab` | const arrow | 28 |
| 2 | `loadFilesResponsesTab` | const arrow | 29 |
| 3 | `getFilesApi` | function | 223 |
| 4 | `getErrorMessage` | function | 227 |
| 5 | `hasMojibake` | function | 231 |
| 6 | `sanitizeFallback` | function | 235 |
| 7 | `AssetPreview` | function | 239 |
| 8 | `AssetCardSkeleton` | function | 262 |
| 9 | `formatDateTime` | function | 288 |
| 10 | `formatFileSize` | function | 298 |
| 11 | `emptyProviderForm` | function | 306 |
| 12 | `compactTabLabel` | function | 329 |
| 13 | `getDefaultFilesPageSize` | function | 335 |
| 14 | `downloadAssetFile` | function | 340 |
| 15 | `FilesPage` | component/function | 352 |
| 16 | `handleUpload` | function | 630 |
| 17 | `handleDeleteAsset` | function | 653 |
| 18 | `toggleAssetSelection` | function | 681 |
| 19 | `toggleSelectAllAssets` | function | 692 |
| 20 | `handleCopySelectedPaths` | function | 699 |
| 21 | `handleDownloadSelected` | function | 714 |
| 22 | `handleDeleteSelectedAssets` | function | 722 |
| 23 | `startCreateProvider` | function | 768 |
| 24 | `startEditProvider` | function | 784 |
| 25 | `saveProvider` | function | 809 |
| 26 | `testProvider` | function | 893 |
| 27 | `removeProvider` | function | 914 |

### 3.82 `frontend/src/components/files/FilesProvidersTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProviderStatus` | function | 121 |
| 2 | `FilesProvidersTab` | component/function | 132 |

### 3.83 `frontend/src/components/files/FilesResponsesTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `FilesResponsesTab` | component/function | 64 |

### 3.84 `frontend/src/components/inventory/DualMoney.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `DualMoney` | component/function | 8 |

### 3.85 `frontend/src/components/inventory/Inventory.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getInventoryApi` | function | 188 |
| 2 | `normalizeFiniteIds` | function | 222 |
| 3 | `countActiveFlags` | function | 226 |
| 4 | `countSelectedIds` | function | 234 |
| 5 | `renderDestinationProductOptions` | function | 242 |
| 6 | `limitInventorySectionsForMobile` | function | 253 |
| 7 | `priceCsv` | function | 280 |
| 8 | `parseInventoryTimestamp` | function | 284 |
| 9 | `InventoryDiscountBadge` | function | 298 |
| 10 | `InventoryBatchPreview` | function | 309 |
| 11 | `label` | const arrow | 321 |
| 12 | `loadInventoryExportTools` | function | 376 |
| 13 | `Inventory` | component/function | 391 |
| 14 | `promise` | const arrow | 634 |
| 15 | `handleAdjust` | const arrow | 1000 |
| 16 | `openAdjust` | const arrow | 1082 |
| 17 | `openMove` | const arrow | 1089 |
| 18 | `openTransfer` | const arrow | 1112 |
| 19 | `handleMoveStock` | const arrow | 1167 |
| 20 | `handleTransferStock` | const arrow | 1240 |
| 21 | `syncViewport` | const arrow | 1397 |
| 22 | `statsValue` | const arrow | 2016 |
| 23 | `selectInventorySection` | const arrow | 3239 |

### 3.86 `frontend/src/components/inventory/InventoryImportModal.tsx`

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

### 3.87 `frontend/src/components/inventory/inventoryImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.88 `frontend/src/components/inventory/InventoryMovementsSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `InventoryMovementsSurface` | component/function | 143 |

### 3.89 `frontend/src/components/inventory/InventoryProductsSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `InventoryProductsSurface` | component/function | 103 |
| 2 | `renderDesktopTableHead` | const arrow | 142 |
| 3 | `renderDesktopLoadingShell` | const arrow | 164 |

### 3.90 `frontend/src/components/inventory/InventoryRfidSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `InventoryRfidSurface` | component/function | 55 |

### 3.91 `frontend/src/components/inventory/movementGroups.ts`

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

### 3.92 `frontend/src/components/inventory/ProductDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBranchStockKey` | function | 61 |
| 2 | `ProductDetailModal` | component/function | 65 |

### 3.93 `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx`

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

### 3.94 `frontend/src/components/navigation/Sidebar.tsx`

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

### 3.95 `frontend/src/components/pos/CartItem.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `translate` | function | 41 |
| 2 | `CartItem` | component/function | 45 |

### 3.96 `frontend/src/components/pos/FilterPanel.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `countActiveFlags` | function | 47 |
| 2 | `SectionLabel` | function | 55 |
| 3 | `POSFilterPanel` | component/function | 66 |
| 4 | `clearAll` | const arrow | 99 |
| 5 | `chip` | const arrow | 108 |

### 3.97 `frontend/src/components/pos/POS.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPlainRecord` | function | 289 |
| 2 | `normalizeCategory` | function | 293 |
| 3 | `getPosApi` | function | 308 |
| 4 | `missingPosApiMethod` | function | 312 |
| 5 | `normalizeOrder` | function | 316 |
| 6 | `getErrorMessage` | function | 327 |
| 7 | `asText` | function | 331 |
| 8 | `asNumber` | function | 335 |
| 9 | `allTermsMatch` | function | 339 |
| 10 | `ProductDiscountBadge` | function | 353 |
| 11 | `POS` | component/function | 373 |
| 12 | `setPersistedCat` | const arrow | 404 |
| 13 | `setPersistedBrand` | const arrow | 405 |
| 14 | `setPersistedBranch` | const arrow | 406 |
| 15 | `setPersistedStock` | const arrow | 407 |
| 16 | `setPersistedGroup` | const arrow | 408 |
| 17 | `setPersistedSupplier` | const arrow | 409 |
| 18 | `setPersistedInitial` | const arrow | 410 |
| 19 | `addNewOrder` | const arrow | 471 |
| 20 | `closeOrder` | const arrow | 483 |
| 21 | `selectCustomer` | const arrow | 804 |
| 22 | `applyCustomerOption` | const arrow | 852 |
| 23 | `clearCustomer` | const arrow | 866 |
| 24 | `handleAddCustomer` | const arrow | 874 |
| 25 | `selectDelivery` | const arrow | 912 |
| 26 | `clearDelivery` | const arrow | 917 |
| 27 | `handleAddDelivery` | const arrow | 919 |
| 28 | `qty` | const arrow | 1031 |
| 29 | `addToCart` | function | 1195 |
| 30 | `updateQty` | const arrow | 1234 |
| 31 | `updatePrice` | const arrow | 1242 |
| 32 | `updateItemBranch` | const arrow | 1266 |
| 33 | `handleDiscountUsd` | const arrow | 1315 |
| 34 | `handleDiscountKhr` | const arrow | 1316 |
| 35 | `handleMembershipUnits` | const arrow | 1317 |
| 36 | `handleCheckout` | const arrow | 1356 |

### 3.98 `frontend/src/components/pos/posCore.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeNumber` | function | 48 |

### 3.99 `frontend/src/components/pos/ProductImage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductImage` | component/function | 9 |

### 3.100 `frontend/src/components/pos/QuickAddModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `QuickAddModal` | component/function | 12 |
| 2 | `T` | const arrow | 13 |

### 3.101 `frontend/src/components/products/config/productPageConfig.ts`

- No top-level named function/class symbols detected.

### 3.102 `frontend/src/components/products/forms/BranchStockAdjuster.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getProductApi` | function | 72 |
| 2 | `parseStockDelta` | function | 76 |
| 3 | `BranchStockAdjuster` | component/function | 81 |
| 4 | `T` | const arrow | 102 |
| 5 | `setRow` | const arrow | 108 |
| 6 | `handleSave` | const arrow | 114 |

### 3.103 `frontend/src/components/products/forms/BulkAddStockModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getProductApi` | function | 68 |
| 2 | `parsePositiveQuantity` | function | 72 |
| 3 | `normalizeBranchId` | function | 77 |
| 4 | `normalizeProductId` | function | 83 |
| 5 | `BulkAddStockModal` | component/function | 88 |
| 6 | `handleSave` | const arrow | 101 |

### 3.104 `frontend/src/components/products/forms/ProductForm.tsx`

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

### 3.105 `frontend/src/components/products/forms/VariantFormModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getProductVariantApi` | function | 104 |
| 2 | `getErrorMessage` | function | 108 |
| 3 | `VariantFormModal` | component/function | 112 |

### 3.106 `frontend/src/components/products/helpers/productDisplayHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toNumber` | function | 57 |

### 3.107 `frontend/src/components/products/helpers/productFilterHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toNumber` | function | 66 |
| 2 | `getImageGallery` | function | 71 |
| 3 | `toImageName` | const arrow | 154 |
| 4 | `toImageUrl` | const arrow | 155 |
| 5 | `priceCsv` | const arrow | 156 |

### 3.108 `frontend/src/components/products/helpers/productGalleryHelpers.ts`

- No top-level named function/class symbols detected.

### 3.109 `frontend/src/components/products/helpers/productGroupViewHelpers.ts`

- No top-level named function/class symbols detected.

### 3.110 `frontend/src/components/products/helpers/productMenuHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `asString` | function | 85 |

### 3.111 `frontend/src/components/products/helpers/productPageHelpers.ts`

- No top-level named function/class symbols detected.

### 3.112 `frontend/src/components/products/helpers/productSelectionHelpers.ts`

- No top-level named function/class symbols detected.

### 3.113 `frontend/src/components/products/helpers/productWriteHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toFiniteNumber` | function | 123 |
| 2 | `hasBulkFormValue` | function | 128 |
| 3 | `stringOrEmpty` | function | 132 |

### 3.114 `frontend/src/components/products/history/productHistoryHelpers.ts`

- No top-level named function/class symbols detected.

### 3.115 `frontend/src/components/products/import/BulkImportModal.tsx`

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

### 3.116 `frontend/src/components/products/import/productImportPlanner.ts`

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

### 3.117 `frontend/src/components/products/import/productImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `post` | function | 39 |
| 2 | `waitForNextTask` | function | 43 |
| 3 | `getErrorMessage` | function | 49 |

### 3.118 `frontend/src/components/products/lookups/ManageBrandsModal.tsx`

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

### 3.119 `frontend/src/components/products/lookups/ManageCategoriesModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getCategoryApi` | function | 106 |
| 2 | `getErrorMessage` | function | 110 |
| 3 | `normalizeCategoryRows` | function | 114 |
| 4 | `mergeCategoryUsage` | function | 129 |
| 5 | `ManageCategoriesModal` | component/function | 158 |

### 3.120 `frontend/src/components/products/lookups/ManageUnitsModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getUnitApi` | function | 106 |
| 2 | `getErrorMessage` | function | 110 |
| 3 | `normalizeUnitRows` | function | 114 |
| 4 | `mergeUnitUsage` | function | 129 |
| 5 | `ManageUnitsModal` | component/function | 158 |

### 3.121 `frontend/src/components/products/lookups/productLookupSnapshots.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getFallbackApiClient` | function | 57 |
| 2 | `normalizeProductRows` | function | 63 |
| 3 | `getPayloadNumber` | function | 70 |
| 4 | `snapshotLookupProducts` | function | 75 |
| 5 | `mergeUniqueSnapshots` | function | 89 |
| 6 | `fetchLookupProductSnapshotsForName` | function | 113 |
| 7 | `fetchProductsByIds` | function | 165 |

### 3.122 `frontend/src/components/products/Products.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getProductApi` | function | 333 |
| 2 | `getErrorMessage` | function | 337 |
| 3 | `isObjectRecord` | function | 341 |
| 4 | `toProductApiResponse` | function | 345 |
| 5 | `scrollNodeWithOffset` | function | 349 |
| 6 | `summarizeProductRun` | function | 355 |
| 7 | `aggregateProductInitials` | function | 359 |
| 8 | `toModalProduct` | function | 370 |
| 9 | `toVariantParentProduct` | function | 382 |
| 10 | `toLightboxState` | function | 388 |
| 11 | `Products` | component/function | 398 |
| 12 | `promise` | const arrow | 481 |
| 13 | `handleSave` | const arrow | 656 |
| 14 | `handleSaveWithGallery` | const arrow | 706 |
| 15 | `handleBulkDelete` | const arrow | 773 |
| 16 | `handleBulkOutOfStock` | const arrow | 820 |
| 17 | `handleBulkChangeBranch` | const arrow | 863 |
| 18 | `handleBulkAddStock` | const arrow | 893 |
| 19 | `toggleSelect` | const arrow | 901 |
| 20 | `toggleSelectAll` | const arrow | 908 |
| 21 | `handleDelete` | const arrow | 915 |
| 22 | `renderUnitChip` | const arrow | 1002 |
| 23 | `openLightbox` | const arrow | 1016 |
| 24 | `getStockBadge` | const arrow | 1023 |

### 3.123 `frontend/src/components/products/scanning/barcodeImageScanner.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readFileAsDataUrl` | function | 37 |
| 2 | `createImageElement` | function | 62 |
| 3 | `loadImageSource` | function | 66 |
| 4 | `detectWithNativeBarcodeDetector` | function | 75 |

### 3.124 `frontend/src/components/products/scanning/BarcodeScannerModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getNativeBarcodeDetector` | function | 100 |
| 2 | `getScanErrorText` | function | 107 |
| 3 | `stopStream` | function | 112 |
| 4 | `BarcodeScannerModal` | component/function | 118 |

### 3.125 `frontend/src/components/products/scanning/barcodeScannerState.ts`

- No top-level named function/class symbols detected.

### 3.126 `frontend/src/components/products/scanning/cameraPermission.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeCameraPermissionState` | function | 9 |
| 2 | `queryCameraPermission` | function | 16 |
| 3 | `handleChange` | const arrow | 35 |

### 3.127 `frontend/src/components/products/scanning/scanbotScanner.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `publicBasePath` | const arrow | 37 |
| 2 | `getScanbotGlobal` | function | 49 |
| 3 | `normalizeScanbotError` | function | 68 |
| 4 | `loadScanbotScript` | function | 82 |
| 5 | `getInitializedScanbot` | function | 135 |

### 3.128 `frontend/src/components/products/shared/primitives.tsx`

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

### 3.129 `frontend/src/components/products/surfaces/HeaderActions.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductsHeaderActions` | component/function | 22 |
| 2 | `tr` | const arrow | 32 |

### 3.130 `frontend/src/components/products/surfaces/ProductDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductDetailModal` | component/function | 79 |
| 2 | `T` | const arrow | 95 |
| 3 | `Row` | const arrow | 121 |

### 3.131 `frontend/src/components/products/surfaces/ProductRowParts.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `label` | const arrow | 103 |

### 3.132 `frontend/src/components/products/surfaces/ProductsListSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductsListSurface` | component/function | 62 |
| 2 | `renderDesktopTableHead` | const arrow | 105 |
| 3 | `renderDesktopLoadingShell` | const arrow | 134 |

### 3.133 `frontend/src/components/receipt-settings/AllFieldsPanel.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Toggle` | function | 30 |
| 2 | `AllFieldsPanel` | component/function | 46 |
| 3 | `T` | const arrow | 49 |
| 4 | `toggleSection` | const arrow | 68 |

### 3.134 `frontend/src/components/receipt-settings/constants.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `T` | const arrow | 110 |

### 3.135 `frontend/src/components/receipt-settings/ErrorBoundary.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatError` | function | 11 |

### 3.136 `frontend/src/components/receipt-settings/FieldOrderManager.tsx`

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

### 3.137 `frontend/src/components/receipt-settings/PrintSettings.tsx`

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

### 3.138 `frontend/src/components/receipt-settings/ReceiptPreview.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatLoadError` | function | 34 |
| 2 | `ReceiptPreview` | component/function | 39 |
| 3 | `loadPreview` | function | 50 |

### 3.139 `frontend/src/components/receipt-settings/ReceiptSettings.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 80 |
| 2 | `Section` | function | 85 |
| 3 | `Toggle` | function | 96 |
| 4 | `ReceiptSettings` | component/function | 111 |

### 3.140 `frontend/src/components/receipt-settings/template.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isRecord` | function | 6 |
| 2 | `parseTemplateInput` | function | 10 |

### 3.141 `frontend/src/components/receipt/Receipt.tsx`

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

### 3.142 `frontend/src/components/returns/EditReturnModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getReturnApi` | function | 90 |
| 2 | `toNumber` | function | 95 |
| 3 | `clampReturnQuantity` | function | 100 |
| 4 | `isWriteConflict` | function | 106 |
| 5 | `EditReturnModal` | component/function | 111 |
| 6 | `updateQty` | const arrow | 144 |
| 7 | `updateRestock` | const arrow | 147 |

### 3.143 `frontend/src/components/returns/NewReturnModal.tsx`

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

### 3.144 `frontend/src/components/returns/NewSupplierReturnModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isSupplierReturnItem` | function | 86 |
| 2 | `getSupplierReturnApi` | function | 90 |
| 3 | `NewSupplierReturnModal` | component/function | 99 |
| 4 | `loadSetup` | function | 136 |
| 5 | `loadInventory` | function | 187 |
| 6 | `updateQty` | const arrow | 258 |
| 7 | `submit` | const arrow | 264 |

### 3.145 `frontend/src/components/returns/ReturnDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeScope` | function | 52 |
| 2 | `coerceMoney` | function | 56 |
| 3 | `isPositiveMoney` | function | 60 |
| 4 | `ReturnDetailModal` | component/function | 64 |

### 3.146 `frontend/src/components/returns/Returns.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getReturnApi` | function | 151 |
| 2 | `normalizeScope` | function | 156 |
| 3 | `getReturnTypeKey` | function | 160 |
| 4 | `getReturnTypeLabel` | function | 166 |
| 5 | `normalizeFiniteIds` | function | 182 |
| 6 | `countSelectedIds` | function | 186 |
| 7 | `countActiveFlags` | function | 194 |
| 8 | `toNumericAmount` | function | 202 |
| 9 | `exportReturnRows` | function | 207 |
| 10 | `getInitialReturnPageSize` | function | 225 |
| 11 | `Returns` | component/function | 230 |
| 12 | `promise` | const arrow | 303 |

### 3.147 `frontend/src/components/returns/ReturnsListSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `detectMobileViewport` | function | 71 |
| 2 | `ReturnsDesktopSkeletonRows` | function | 76 |
| 3 | `ReturnsMobileSkeletonCards` | function | 93 |
| 4 | `ReturnsListSurface` | component/function | 113 |
| 5 | `apply` | const arrow | 144 |

### 3.148 `frontend/src/components/sales/ExportModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getSalesExportApi` | function | 71 |
| 2 | `getErrorMessage` | function | 76 |
| 3 | `ExportModal` | component/function | 80 |
| 4 | `handlePreview` | const arrow | 154 |
| 5 | `handleExportCSV` | const arrow | 172 |

### 3.149 `frontend/src/components/sales/SaleDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toNumber` | function | 73 |
| 2 | `InfoBlock` | function | 78 |
| 3 | `parseItems` | function | 94 |
| 4 | `SaleDetailModal` | component/function | 105 |

### 3.150 `frontend/src/components/sales/Sales.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getSalesApi` | function | 128 |
| 2 | `normalizeSaleRows` | function | 133 |
| 3 | `normalizeUserOptions` | function | 141 |
| 4 | `getErrorMessage` | function | 146 |
| 5 | `isWriteConflict` | function | 150 |
| 6 | `multiMatch` | function | 157 |
| 7 | `normalizeFiniteIds` | function | 169 |
| 8 | `countSelectedIds` | function | 173 |
| 9 | `countActiveFlags` | function | 181 |
| 10 | `getSaleBranchLabel` | function | 189 |
| 11 | `Sales` | component/function | 197 |
| 12 | `promise` | const arrow | 287 |
| 13 | `toggleSelected` | const arrow | 624 |
| 14 | `toggleSelectAll` | const arrow | 630 |
| 15 | `handleExportSelected` | const arrow | 669 |
| 16 | `handleBulkStatusUpdate` | const arrow | 717 |

### 3.151 `frontend/src/components/sales/SalesImportModal.tsx`

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

### 3.152 `frontend/src/components/sales/salesImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.153 `frontend/src/components/sales/SalesListSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getSaleItems` | function | 67 |
| 2 | `SalesListSurface` | component/function | 71 |

### 3.154 `frontend/src/components/sales/StatusBadge.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isSaleStatus` | function | 24 |
| 2 | `StatusBadge` | component/function | 50 |

### 3.155 `frontend/src/components/server/ServerPage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getServerApi` | function | 129 |
| 2 | `getErrorMessage` | function | 133 |
| 3 | `normalizePendingSyncState` | function | 137 |
| 4 | `normalizeSystemDebugLog` | function | 148 |
| 5 | `normalizeSystemConfig` | function | 157 |
| 6 | `useLocalCopy` | function | 161 |
| 7 | `isAutoDetected` | function | 172 |
| 8 | `StatusRow` | function | 179 |
| 9 | `InfoTab` | function | 191 |
| 10 | `DiagnosticsPanel` | function | 344 |
| 11 | `onErr` | const arrow | 384 |
| 12 | `onQueueChanged` | const arrow | 389 |
| 13 | `handleRetryQueue` | function | 436 |
| 14 | `handleDiscardQueue` | function | 453 |
| 15 | `ServerPage` | component/function | 644 |
| 16 | `check` | const arrow | 671 |
| 17 | `loadSecurityConfig` | const arrow | 699 |
| 18 | `handleTest` | function | 717 |
| 19 | `handleSave` | function | 746 |
| 20 | `handleDisconnect` | function | 753 |

### 3.156 `frontend/src/components/shared/ActionHistoryBar.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatHistoryList` | function | 50 |
| 2 | `formatServerStatus` | function | 54 |
| 3 | `ActionHistoryBar` | component/function | 61 |

### 3.157 `frontend/src/components/shared/BackgroundImportTracker.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getImportTrackerApi` | function | 106 |
| 2 | `getErrorMessage` | function | 111 |
| 3 | `nextImportTrackerBackoff` | function | 115 |
| 4 | `normalizeJobStatus` | function | 122 |
| 5 | `dedupeJobsById` | function | 126 |
| 6 | `isRecent` | function | 138 |
| 7 | `normalizeImportJobListResult` | function | 144 |
| 8 | `getJobProgressDetails` | function | 159 |
| 9 | `getJobLabel` | function | 227 |
| 10 | `getJobResultSummary` | function | 233 |
| 11 | `add` | const arrow | 236 |
| 12 | `getRowsDisplay` | function | 249 |
| 13 | `buildJobsSignature` | function | 265 |
| 14 | `BackgroundImportTracker` | component/function | 280 |
| 15 | `finishTrackerAction` | const arrow | 419 |
| 16 | `handleCancel` | const arrow | 424 |
| 17 | `handleRetry` | const arrow | 443 |
| 18 | `handleApprove` | const arrow | 462 |
| 19 | `handleDownloadErrors` | const arrow | 492 |
| 20 | `handleRemove` | const arrow | 509 |
| 21 | `handleDismiss` | const arrow | 547 |

### 3.158 `frontend/src/components/shared/ExportMenu.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ExportMenu` | component/function | 17 |

### 3.159 `frontend/src/components/shared/FilterMenu.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `sectionButtonClass` | function | 35 |
| 2 | `FilterMenu` | component/function | 41 |

### 3.160 `frontend/src/components/shared/globalScroll.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDocumentLike` | function | 21 |
| 2 | `getPageScrollCandidates` | function | 25 |
| 3 | `isVisibleScrollNode` | function | 38 |

### 3.161 `frontend/src/components/shared/ImageGalleryLightbox.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ImageGalleryLightbox` | component/function | 31 |
| 2 | `formatLabel` | function | 53 |
| 3 | `setIndex` | function | 57 |
| 4 | `renderGalleryImage` | function | 63 |
| 5 | `onKeyDown` | function | 70 |

### 3.162 `frontend/src/components/shared/LoadingWatchdog.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `LoadingWatchdog` | component/function | 14 |

### 3.163 `frontend/src/components/shared/Modal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Modal` | component/function | 13 |

### 3.164 `frontend/src/components/shared/navigationConfig.ts`

- No top-level named function/class symbols detected.

### 3.165 `frontend/src/components/shared/NotificationCenter.tsx`

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

### 3.166 `frontend/src/components/shared/pageActivity.ts`

- No top-level named function/class symbols detected.

### 3.167 `frontend/src/components/shared/PageHeader.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PageHeader` | component/function | 26 |

### 3.168 `frontend/src/components/shared/PaginationControls.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PaginationControls` | component/function | 41 |
| 2 | `commitPageDraft` | const arrow | 71 |
| 3 | `handlePageInputKeyDown` | const arrow | 82 |

### 3.169 `frontend/src/components/shared/PortalMenu.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPortalMenuItem` | function | 50 |
| 2 | `PortalMenu` | component/function | 60 |
| 3 | `closeIfClickedOutside` | const arrow | 119 |
| 4 | `closeMenu` | const arrow | 127 |
| 5 | `scheduleReposition` | const arrow | 128 |
| 6 | `closeIfEscape` | const arrow | 135 |

### 3.170 `frontend/src/components/shared/QuickPreferenceToggles.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ToggleButton` | function | 26 |
| 2 | `QuickPreferenceToggles` | component/function | 45 |
| 3 | `tr` | const arrow | 48 |

### 3.171 `frontend/src/components/shared/SectionSwitcher.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readStoredSection` | function | 19 |
| 2 | `SectionSwitcher` | component/function | 28 |
| 3 | `selectValue` | const arrow | 55 |

### 3.172 `frontend/src/components/shared/WriteConflictModal.tsx`

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

### 3.173 `frontend/src/components/users/PermissionEditor.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `parsePermissionState` | function | 75 |
| 2 | `PermissionEditor` | component/function | 89 |
| 3 | `toggle` | const arrow | 104 |

### 3.174 `frontend/src/components/users/UserDetailSheet.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `translateLabel` | function | 43 |
| 2 | `buildRowData` | function | 48 |
| 3 | `parsePermissions` | function | 60 |
| 4 | `UserDetailSheet` | component/function | 71 |

### 3.175 `frontend/src/components/users/UserProfileModal.tsx`

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

### 3.176 `frontend/src/components/users/Users.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getUsersApi` | function | 135 |
| 2 | `normalizeUsers` | function | 140 |
| 3 | `normalizeRoles` | function | 144 |
| 4 | `normalizePermissionState` | function | 148 |
| 5 | `getErrorMessage` | function | 163 |
| 6 | `clearTimeoutRef` | function | 167 |
| 7 | `ThreeDot` | function | 184 |
| 8 | `formatContactValue` | function | 223 |
| 9 | `UsersDesktopSkeletonRows` | function | 228 |
| 10 | `UsersMobileSkeletonCards` | function | 252 |
| 11 | `Users` | component/function | 266 |
| 12 | `promise` | const arrow | 333 |
| 13 | `promise` | const arrow | 371 |
| 14 | `openCreateUser` | const arrow | 483 |
| 15 | `openCreateRole` | const arrow | 513 |
| 16 | `handleSaveUser` | const arrow | 574 |
| 17 | `handleResetPassword` | const arrow | 644 |
| 18 | `handleSaveRole` | const arrow | 701 |

### 3.177 `frontend/src/components/utils-settings/AuditLog.tsx`

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

### 3.178 `frontend/src/components/utils-settings/Backup.tsx`

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
| 21 | `secondsToSyncMinutes` | function | 719 |
| 22 | `minutesToSyncSeconds` | function | 728 |
| 23 | `GoogleDriveSyncSection` | function | 736 |
| 24 | `handler` | const arrow | 858 |
| 25 | `savePreferences` | const arrow | 943 |
| 26 | `connectGoogleDrive` | const arrow | 973 |
| 27 | `syncNow` | const arrow | 1018 |
| 28 | `disconnect` | const arrow | 1055 |
| 29 | `forgetCredentials` | const arrow | 1080 |
| 30 | `BackupOverview` | function | 1310 |
| 31 | `Backup` | component/function | 1382 |
| 32 | `showBackupSection` | const arrow | 1397 |
| 33 | `handleFolderExport` | const arrow | 1423 |
| 34 | `handleFolderImport` | const arrow | 1492 |

### 3.179 `frontend/src/components/utils-settings/FontFamilyPicker.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `FontFamilyPicker` | component/function | 30 |

### 3.180 `frontend/src/components/utils-settings/index.ts`

- No top-level named function/class symbols detected.

### 3.181 `frontend/src/components/utils-settings/OtpModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getOtpApi` | function | 45 |
| 2 | `getErrorMessage` | function | 49 |
| 3 | `OtpModal` | component/function | 53 |
| 4 | `loadSetup` | function | 88 |

### 3.182 `frontend/src/components/utils-settings/ResetData.tsx`

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

### 3.183 `frontend/src/components/utils-settings/Settings.tsx`

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

### 3.184 `frontend/src/components/utils-settings/settingsConflict.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeObject` | function | 28 |

### 3.185 `frontend/src/constants.ts`

- No top-level named function/class symbols detected.

### 3.186 `frontend/src/index.tsx`

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

### 3.187 `frontend/src/platform/runtime/clientRuntime.ts`

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

### 3.188 `frontend/src/platform/storage/storagePolicy.ts`

- No top-level named function/class symbols detected.

### 3.189 `frontend/src/public-runtime/runtime-noise-guard.ts`

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

### 3.190 `frontend/src/public-runtime/service-worker.ts`

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

### 3.191 `frontend/src/public-runtime/theme-bootstrap.ts`

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

### 3.192 `frontend/src/runtime/runtimeErrorClassifier.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `messageOf` | function | 27 |
| 2 | `stackOf` | function | 31 |
| 3 | `toText` | function | 35 |
| 4 | `includesExtensionOrigin` | function | 39 |
| 5 | `getPathname` | function | 44 |

### 3.193 `frontend/src/types/lucide-react-icons.d.ts`

- No top-level named function/class symbols detected.

### 3.194 `frontend/src/types/receiptContracts.ts`

- No top-level named function/class symbols detected.

### 3.195 `frontend/src/types/settingsContracts.ts`

- No top-level named function/class symbols detected.

### 3.196 `frontend/src/utils/actionGuards.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `hasOwn` | function | 18 |

### 3.197 `frontend/src/utils/actionHistory.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeActionHistoryId` | function | 94 |
| 2 | `normalizeEntry` | function | 100 |
| 3 | `parsePermissions` | function | 113 |
| 4 | `getErrorMessage` | function | 125 |

### 3.198 `frontend/src/utils/appRefresh.ts`

- No top-level named function/class symbols detected.

### 3.199 `frontend/src/utils/bulkOps.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `runner` | function | 47 |

### 3.200 `frontend/src/utils/color.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeHex` | function | 1 |
| 2 | `relativeLuminance` | function | 12 |

### 3.201 `frontend/src/utils/csv.ts`

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

### 3.202 `frontend/src/utils/csvExportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 20 |

### 3.203 `frontend/src/utils/csvImport.ts`

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

### 3.204 `frontend/src/utils/csvRowCounter.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `finishRecord` | const arrow | 7 |

### 3.205 `frontend/src/utils/dateHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toLocalDateString` | function | 4 |

### 3.206 `frontend/src/utils/deviceInfo.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBrowserName` | function | 13 |
| 2 | `getOperatingSystemName` | function | 21 |

### 3.207 `frontend/src/utils/exportPackage.ts`

- No top-level named function/class symbols detected.

### 3.208 `frontend/src/utils/exportReports.tsx`

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

### 3.209 `frontend/src/utils/favicon.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `clamp` | function | 11 |
| 2 | `shouldUseAnonymousCors` | function | 18 |
| 3 | `loadImage` | function | 29 |

### 3.210 `frontend/src/utils/formatters.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeTimestampInput` | function | 6 |

### 3.211 `frontend/src/utils/groupedRecords.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toDate` | function | 37 |
| 2 | `normalizeName` | function | 56 |
| 3 | `compareAlphabetLabels` | function | 64 |

### 3.212 `frontend/src/utils/historyHelpers.ts`

- No top-level named function/class symbols detected.

### 3.213 `frontend/src/utils/importJobRefresh.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeImportJobStatus` | function | 24 |
| 2 | `normalizeImportJobType` | function | 28 |
| 3 | `uniqueChannels` | function | 32 |
| 4 | `dispatchSyncUpdate` | function | 41 |

### 3.214 `frontend/src/utils/index.ts`

- No top-level named function/class symbols detected.

### 3.215 `frontend/src/utils/initials.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getInitialRank` | function | 54 |

### 3.216 `frontend/src/utils/loaders.ts`

- No top-level named function/class symbols detected.

### 3.217 `frontend/src/utils/mediaUpload.ts`

- No top-level named function/class symbols detected.

### 3.218 `frontend/src/utils/permissions.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPermissionMap` | function | 3 |

### 3.219 `frontend/src/utils/pricing.ts`

- No top-level named function/class symbols detected.

### 3.220 `frontend/src/utils/printReceipt.ts`

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

### 3.221 `frontend/src/utils/productBatches.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeBranchId` | function | 26 |

### 3.222 `frontend/src/utils/productGrouping.ts`

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

### 3.223 `frontend/src/utils/publicAssetUrls.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `trimBaseUrl` | function | 11 |
| 2 | `normalizeUploadPath` | function | 15 |
| 3 | `appendAssetVersion` | function | 23 |
| 4 | `isLocalLikeHostname` | function | 38 |
| 5 | `getSafeCurrentOrigin` | function | 42 |
| 6 | `api` | const arrow | 57 |

### 3.224 `frontend/src/utils/receiptAppliedConfig.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `parseObject` | function | 67 |

### 3.225 `frontend/src/utils/scriptTypography.ts`

- No top-level named function/class symbols detected.

### 3.226 `frontend/src/utils/settingsRefresh.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeSettingKeys` | function | 62 |

### 3.227 `frontend/src/utils/settingsWriteOptions.ts`

- No top-level named function/class symbols detected.

### 3.228 `frontend/src/web-api.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `sanitizeBaseUrl` | function | 92 |
| 2 | `getOfflineDb` | function | 96 |
| 3 | `loadMethodsModule` | function | 101 |
| 4 | `loadAppBootstrapModule` | function | 106 |
| 5 | `loadAuthTransportModule` | function | 111 |
| 6 | `getLazyApiMethod` | function | 127 |
| 7 | `mapOfflineFileChunkStatusUpdates` | function | 141 |
| 8 | `asArrayBuffer` | function | 157 |
| 9 | `bytesToBase64` | function | 161 |
| 10 | `base64ToBytes` | function | 172 |
| 11 | `stableStringify` | function | 179 |
| 12 | `sha256Hex` | function | 185 |
| 13 | `deriveOfflineVaultKey` | function | 193 |
| 14 | `encryptOfflineVaultValue` | function | 210 |
| 15 | `decryptOfflineVaultValue` | function | 218 |
| 16 | `requestOfflinePersistentStorage` | function | 228 |
| 17 | `dispatchVaultLocked` | function | 235 |
| 18 | `scheduleOfflineVaultIdleLock` | function | 240 |
| 19 | `lockOfflineVault` | function | 246 |
| 20 | `unlockOfflineVault` | function | 254 |
| 21 | `queueBusinessOutboxOperation` | function | 280 |
| 22 | `queueOfflineFileChunks` | function | 317 |
| 23 | `dispatchOutboxProgress` | function | 371 |
| 24 | `dispatchOutboxFileProgress` | function | 378 |
| 25 | `dispatchOutboxConflict` | function | 385 |
| 26 | `getSyncOutboxKey` | function | 392 |
| 27 | `syncUnlockedOfflineOutbox` | function | 396 |
| 28 | `syncUnlockedOfflineFileChunks` | function | 506 |
| 29 | `refreshOfflineSnapshotSoon` | function | 568 |
| 30 | `run` | const arrow | 578 |
| 31 | `refreshServiceWorkerSoon` | function | 597 |
| 32 | `runOfflineMaintenance` | function | 607 |
| 33 | `startOfflineMaintenanceLoop` | function | 620 |
| 34 | `scheduleInitialOfflineMaintenance` | function | 628 |
| 35 | `run` | const arrow | 632 |
| 36 | `scheduleIdle` | const arrow | 636 |
| 37 | `scheduleBootstrapStorageMaintenance` | function | 653 |
| 38 | `run` | const arrow | 659 |
| 39 | `scheduleBootstrapOfflineDbWrite` | function | 676 |
| 40 | `run` | const arrow | 682 |
| 41 | `write` | const arrow | 684 |
| 42 | `forwardServiceWorkerOutboxEvent` | function | 703 |
| 43 | `forwardServiceWorkerAppEvent` | function | 791 |

### 3.229 `ops/scripts/frontend/build-public-runtime-scripts.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toProjectPath` | function | 36 |
| 2 | `formatDiagnostic` | function | 40 |
| 3 | `transpileRuntimeScript` | function | 47 |
| 4 | `writeIfChanged` | function | 67 |
| 5 | `main` | function | 74 |

### 3.230 `ops/scripts/frontend/verify-i18n.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `collectUsedKeys` | function | 29 |
| 2 | `flattenTranslationTree` | function | 69 |
| 3 | `listMissing` | function | 83 |
| 4 | `listEmptyValues` | function | 88 |
| 5 | `printList` | function | 95 |
| 6 | `main` | function | 102 |

### 3.231 `ops/scripts/frontend/verify-performance.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `read` | function | 15 |
| 2 | `walk` | function | 19 |
| 3 | `trackedFiles` | function | 37 |
| 4 | `assert` | function | 47 |

### 3.232 `ops/scripts/frontend/verify-ui.ts`

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

### 3.233 `frontend/vite.config.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readGitRevision` | function | 11 |
| 2 | `fixCrossorigin` | function | 49 |
| 3 | `emitBuildManifest` | function | 74 |
| 4 | `shouldDeferModulePreload` | function | 166 |
| 5 | `manualChunks` | function | 170 |

### 3.234 `frontend/tailwind.config.ts`

- No top-level named function/class symbols detected.

