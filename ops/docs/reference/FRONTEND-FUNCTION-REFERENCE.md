# Frontend Function Reference

Auto-generated symbol inventory for frontend files. Regenerate with `node ops/scripts/docs/generate-doc-reference.ts`.

## 1. Coverage Summary

Total files documented: **247**

## 2. Symbol Count by File

| No. | File | Symbols |
|---:|---|---:|
| 1 | `frontend/src/api/accessControlTransport.ts` | 1 |
| 2 | `frontend/src/api/actionHistoryTransport.ts` | 1 |
| 3 | `frontend/src/api/actorQuery.ts` | 0 |
| 4 | `frontend/src/api/aiTransport.ts` | 0 |
| 5 | `frontend/src/api/appBootstrapTransport.ts` | 5 |
| 6 | `frontend/src/api/auditLogTransport.ts` | 4 |
| 7 | `frontend/src/api/authTransport.ts` | 0 |
| 8 | `frontend/src/api/branchTransport.ts` | 2 |
| 9 | `frontend/src/api/browserDialogs.ts` | 0 |
| 10 | `frontend/src/api/conflicts.ts` | 0 |
| 11 | `frontend/src/api/contactReadTransport.ts` | 9 |
| 12 | `frontend/src/api/contactsTransport.ts` | 12 |
| 13 | `frontend/src/api/contactWriteTransport.ts` | 6 |
| 14 | `frontend/src/api/cooldownFallbacks.ts` | 3 |
| 15 | `frontend/src/api/customTablesTransport.ts` | 3 |
| 16 | `frontend/src/api/dashboardTransport.ts` | 0 |
| 17 | `frontend/src/api/driveSync.ts` | 0 |
| 18 | `frontend/src/api/expectedUpdatedAt.ts` | 2 |
| 19 | `frontend/src/api/fileTransport.ts` | 5 |
| 20 | `frontend/src/api/http.ts` | 31 |
| 21 | `frontend/src/api/importJobsTransport.ts` | 5 |
| 22 | `frontend/src/api/importTransport.ts` | 0 |
| 23 | `frontend/src/api/inventoryTransport.ts` | 1 |
| 24 | `frontend/src/api/lazyLocalDb.ts` | 0 |
| 25 | `frontend/src/api/localDb.ts` | 1 |
| 26 | `frontend/src/api/localMirrors.ts` | 3 |
| 27 | `frontend/src/api/lookupTransport.ts` | 4 |
| 28 | `frontend/src/api/methods.ts` | 153 |
| 29 | `frontend/src/api/multipartHeaders.ts` | 0 |
| 30 | `frontend/src/api/notificationSummary.ts` | 1 |
| 31 | `frontend/src/api/offlineSnapshotTransport.ts` | 7 |
| 32 | `frontend/src/api/portalHttp.ts` | 0 |
| 33 | `frontend/src/api/portalTransport.ts` | 2 |
| 34 | `frontend/src/api/productImageUploadTransport.ts` | 1 |
| 35 | `frontend/src/api/productReadTransport.ts` | 0 |
| 36 | `frontend/src/api/productWriteTransport.ts` | 3 |
| 37 | `frontend/src/api/query.ts` | 1 |
| 38 | `frontend/src/api/queryCache.ts` | 0 |
| 39 | `frontend/src/api/requestIds.ts` | 0 |
| 40 | `frontend/src/api/returnsTransport.ts` | 0 |
| 41 | `frontend/src/api/rfidTransport.ts` | 2 |
| 42 | `frontend/src/api/salesTransport.ts` | 0 |
| 43 | `frontend/src/api/saleWriteTransport.ts` | 16 |
| 44 | `frontend/src/api/syncPreview.ts` | 0 |
| 45 | `frontend/src/api/syncRuntime.ts` | 0 |
| 46 | `frontend/src/api/systemJobs.ts` | 3 |
| 47 | `frontend/src/api/systemRuntime.ts` | 0 |
| 48 | `frontend/src/api/userReadTransport.ts` | 0 |
| 49 | `frontend/src/api/websocket.ts` | 7 |
| 50 | `frontend/src/App.tsx` | 85 |
| 51 | `frontend/src/app/appShellUtils.ts` | 0 |
| 52 | `frontend/src/app/publicErrorRecovery.ts` | 1 |
| 53 | `frontend/src/AppContext.tsx` | 40 |
| 54 | `frontend/src/components/auth/Login.tsx` | 23 |
| 55 | `frontend/src/components/branches/Branches.tsx` | 15 |
| 56 | `frontend/src/components/branches/BranchForm.tsx` | 2 |
| 57 | `frontend/src/components/branches/TransferModal.tsx` | 6 |
| 58 | `frontend/src/components/catalog/CatalogEditorSurface.tsx` | 1 |
| 59 | `frontend/src/components/catalog/CatalogImageField.tsx` | 1 |
| 60 | `frontend/src/components/catalog/CatalogPage.tsx` | 130 |
| 61 | `frontend/src/components/catalog/CatalogPageContext.tsx` | 0 |
| 62 | `frontend/src/components/catalog/CatalogPreviewSurface.tsx` | 2 |
| 63 | `frontend/src/components/catalog/CatalogProductsSection.tsx` | 4 |
| 64 | `frontend/src/components/catalog/CatalogSecondaryTabs.tsx` | 6 |
| 65 | `frontend/src/components/catalog/catalogUi.tsx` | 1 |
| 66 | `frontend/src/components/catalog/portalCatalogDisplay.ts` | 2 |
| 67 | `frontend/src/components/catalog/portalContentI18n.ts` | 14 |
| 68 | `frontend/src/components/catalog/portalEditorUtils.ts` | 2 |
| 69 | `frontend/src/components/catalog/portalLanguagePacks.ts` | 0 |
| 70 | `frontend/src/components/catalog/portalTranslateController.ts` | 2 |
| 71 | `frontend/src/components/contacts/ContactImportModal.tsx` | 8 |
| 72 | `frontend/src/components/contacts/contactImportWorker.ts` | 1 |
| 73 | `frontend/src/components/contacts/contactOptionUtils.ts` | 3 |
| 74 | `frontend/src/components/contacts/Contacts.tsx` | 13 |
| 75 | `frontend/src/components/contacts/CustomerFormModal.tsx` | 10 |
| 76 | `frontend/src/components/contacts/customerMembershipNumber.ts` | 0 |
| 77 | `frontend/src/components/contacts/CustomersTab.tsx` | 19 |
| 78 | `frontend/src/components/contacts/DeliveryTab.tsx` | 28 |
| 79 | `frontend/src/components/contacts/shared.tsx` | 3 |
| 80 | `frontend/src/components/contacts/SuppliersTab.tsx` | 23 |
| 81 | `frontend/src/components/custom-tables/CustomTables.tsx` | 19 |
| 82 | `frontend/src/components/dashboard/charts/BarChart.tsx` | 5 |
| 83 | `frontend/src/components/dashboard/charts/DonutChart.tsx` | 1 |
| 84 | `frontend/src/components/dashboard/charts/index.ts` | 0 |
| 85 | `frontend/src/components/dashboard/charts/LineChart.tsx` | 7 |
| 86 | `frontend/src/components/dashboard/charts/NoData.tsx` | 1 |
| 87 | `frontend/src/components/dashboard/Dashboard.tsx` | 18 |
| 88 | `frontend/src/components/dashboard/MiniStat.tsx` | 1 |
| 89 | `frontend/src/components/files/FilePickerModal.tsx` | 8 |
| 90 | `frontend/src/components/files/FilesPage.tsx` | 27 |
| 91 | `frontend/src/components/files/FilesProvidersTab.tsx` | 2 |
| 92 | `frontend/src/components/files/FilesResponsesTab.tsx` | 1 |
| 93 | `frontend/src/components/inventory/DualMoney.tsx` | 1 |
| 94 | `frontend/src/components/inventory/Inventory.tsx` | 31 |
| 95 | `frontend/src/components/inventory/InventoryImportModal.tsx` | 9 |
| 96 | `frontend/src/components/inventory/inventoryImportWorker.ts` | 1 |
| 97 | `frontend/src/components/inventory/InventoryMovementsSurface.tsx` | 1 |
| 98 | `frontend/src/components/inventory/InventoryProductsSurface.tsx` | 3 |
| 99 | `frontend/src/components/inventory/InventoryRfidSurface.tsx` | 1 |
| 100 | `frontend/src/components/inventory/movementGroups.ts` | 11 |
| 101 | `frontend/src/components/inventory/ProductDetailModal.tsx` | 2 |
| 102 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx` | 10 |
| 103 | `frontend/src/components/navigation/Sidebar.tsx` | 9 |
| 104 | `frontend/src/components/pos/CartItem.tsx` | 2 |
| 105 | `frontend/src/components/pos/FilterPanel.tsx` | 5 |
| 106 | `frontend/src/components/pos/POS.tsx` | 51 |
| 107 | `frontend/src/components/pos/posCore.ts` | 1 |
| 108 | `frontend/src/components/pos/ProductImage.tsx` | 1 |
| 109 | `frontend/src/components/pos/QuickAddModal.tsx` | 2 |
| 110 | `frontend/src/components/products/config/productPageConfig.ts` | 0 |
| 111 | `frontend/src/components/products/forms/BranchStockAdjuster.tsx` | 6 |
| 112 | `frontend/src/components/products/forms/BulkAddStockModal.tsx` | 6 |
| 113 | `frontend/src/components/products/forms/ProductForm.tsx` | 19 |
| 114 | `frontend/src/components/products/forms/VariantFormModal.tsx` | 3 |
| 115 | `frontend/src/components/products/helpers/productDisplayHelpers.ts` | 1 |
| 116 | `frontend/src/components/products/helpers/productFilterHelpers.ts` | 5 |
| 117 | `frontend/src/components/products/helpers/productGalleryHelpers.ts` | 0 |
| 118 | `frontend/src/components/products/helpers/productGroupViewHelpers.ts` | 0 |
| 119 | `frontend/src/components/products/helpers/productMenuHelpers.ts` | 1 |
| 120 | `frontend/src/components/products/helpers/productPageHelpers.ts` | 0 |
| 121 | `frontend/src/components/products/helpers/productSelectionHelpers.ts` | 0 |
| 122 | `frontend/src/components/products/helpers/productWriteHelpers.ts` | 3 |
| 123 | `frontend/src/components/products/history/productHistoryHelpers.ts` | 0 |
| 124 | `frontend/src/components/products/import/BulkImportModal.tsx` | 51 |
| 125 | `frontend/src/components/products/import/productImportPlanner.ts` | 11 |
| 126 | `frontend/src/components/products/import/productImportWorker.ts` | 3 |
| 127 | `frontend/src/components/products/lookups/ManageBrandsModal.tsx` | 9 |
| 128 | `frontend/src/components/products/lookups/ManageCategoriesModal.tsx` | 5 |
| 129 | `frontend/src/components/products/lookups/ManageUnitsModal.tsx` | 5 |
| 130 | `frontend/src/components/products/lookups/productLookupSnapshots.ts` | 7 |
| 131 | `frontend/src/components/products/Products.tsx` | 30 |
| 132 | `frontend/src/components/products/scanning/barcodeImageScanner.ts` | 4 |
| 133 | `frontend/src/components/products/scanning/BarcodeScannerModal.tsx` | 4 |
| 134 | `frontend/src/components/products/scanning/barcodeScannerState.ts` | 0 |
| 135 | `frontend/src/components/products/scanning/cameraPermission.ts` | 3 |
| 136 | `frontend/src/components/products/scanning/scanbotScanner.ts` | 5 |
| 137 | `frontend/src/components/products/shared/primitives.tsx` | 12 |
| 138 | `frontend/src/components/products/surfaces/HeaderActions.tsx` | 2 |
| 139 | `frontend/src/components/products/surfaces/ProductDetailModal.tsx` | 3 |
| 140 | `frontend/src/components/products/surfaces/ProductRowParts.tsx` | 1 |
| 141 | `frontend/src/components/products/surfaces/ProductsListSurface.tsx` | 3 |
| 142 | `frontend/src/components/receipt-settings/AllFieldsPanel.tsx` | 4 |
| 143 | `frontend/src/components/receipt-settings/constants.ts` | 1 |
| 144 | `frontend/src/components/receipt-settings/ErrorBoundary.tsx` | 1 |
| 145 | `frontend/src/components/receipt-settings/FieldOrderManager.tsx` | 9 |
| 146 | `frontend/src/components/receipt-settings/PrintSettings.tsx` | 8 |
| 147 | `frontend/src/components/receipt-settings/ReceiptPreview.tsx` | 3 |
| 148 | `frontend/src/components/receipt-settings/ReceiptSettings.tsx` | 4 |
| 149 | `frontend/src/components/receipt-settings/template.ts` | 2 |
| 150 | `frontend/src/components/receipt/Receipt.tsx` | 11 |
| 151 | `frontend/src/components/returns/EditReturnModal.tsx` | 7 |
| 152 | `frontend/src/components/returns/NewReturnModal.tsx` | 13 |
| 153 | `frontend/src/components/returns/NewSupplierReturnModal.tsx` | 7 |
| 154 | `frontend/src/components/returns/ReturnDetailModal.tsx` | 4 |
| 155 | `frontend/src/components/returns/Returns.tsx` | 12 |
| 156 | `frontend/src/components/returns/ReturnsListSurface.tsx` | 5 |
| 157 | `frontend/src/components/sales/ExportModal.tsx` | 5 |
| 158 | `frontend/src/components/sales/SaleDetailModal.tsx` | 4 |
| 159 | `frontend/src/components/sales/Sales.tsx` | 16 |
| 160 | `frontend/src/components/sales/SalesImportModal.tsx` | 8 |
| 161 | `frontend/src/components/sales/salesImportWorker.ts` | 1 |
| 162 | `frontend/src/components/sales/SalesListSurface.tsx` | 2 |
| 163 | `frontend/src/components/sales/StatusBadge.tsx` | 2 |
| 164 | `frontend/src/components/server/ServerPage.tsx` | 21 |
| 165 | `frontend/src/components/shared/ActionHistoryBar.tsx` | 3 |
| 166 | `frontend/src/components/shared/BackgroundImportTracker.tsx` | 21 |
| 167 | `frontend/src/components/shared/ExportMenu.tsx` | 1 |
| 168 | `frontend/src/components/shared/FilterMenu.tsx` | 2 |
| 169 | `frontend/src/components/shared/globalScroll.ts` | 3 |
| 170 | `frontend/src/components/shared/ImageGalleryLightbox.tsx` | 5 |
| 171 | `frontend/src/components/shared/LazyPortalMenu.tsx` | 1 |
| 172 | `frontend/src/components/shared/LoadingWatchdog.tsx` | 1 |
| 173 | `frontend/src/components/shared/Modal.tsx` | 1 |
| 174 | `frontend/src/components/shared/navigationConfig.ts` | 0 |
| 175 | `frontend/src/components/shared/NotificationCenter.tsx` | 9 |
| 176 | `frontend/src/components/shared/pageActivity.ts` | 0 |
| 177 | `frontend/src/components/shared/PageHeader.tsx` | 1 |
| 178 | `frontend/src/components/shared/PaginationControls.tsx` | 3 |
| 179 | `frontend/src/components/shared/PortalMenu.tsx` | 6 |
| 180 | `frontend/src/components/shared/QuickPreferenceToggles.tsx` | 3 |
| 181 | `frontend/src/components/shared/SectionSwitcher.tsx` | 3 |
| 182 | `frontend/src/components/shared/WriteConflictModal.tsx` | 10 |
| 183 | `frontend/src/components/users/permissionDefinitions.ts` | 0 |
| 184 | `frontend/src/components/users/PermissionEditor.tsx` | 3 |
| 185 | `frontend/src/components/users/UserDetailSheet.tsx` | 4 |
| 186 | `frontend/src/components/users/UserProfileModal.tsx` | 14 |
| 187 | `frontend/src/components/users/Users.tsx` | 18 |
| 188 | `frontend/src/components/utils-settings/AuditLog.tsx` | 18 |
| 189 | `frontend/src/components/utils-settings/Backup.tsx` | 34 |
| 190 | `frontend/src/components/utils-settings/FontFamilyPicker.tsx` | 1 |
| 191 | `frontend/src/components/utils-settings/index.ts` | 0 |
| 192 | `frontend/src/components/utils-settings/OtpModal.tsx` | 4 |
| 193 | `frontend/src/components/utils-settings/ResetData.tsx` | 10 |
| 194 | `frontend/src/components/utils-settings/Settings.tsx` | 27 |
| 195 | `frontend/src/components/utils-settings/settingsConflict.ts` | 1 |
| 196 | `frontend/src/constants.ts` | 0 |
| 197 | `frontend/src/index.tsx` | 12 |
| 198 | `frontend/src/platform/runtime/clientRuntime.ts` | 9 |
| 199 | `frontend/src/platform/storage/storagePolicy.ts` | 0 |
| 200 | `frontend/src/public-runtime/runtime-noise-guard.ts` | 8 |
| 201 | `frontend/src/public-runtime/service-worker.ts` | 24 |
| 202 | `frontend/src/public-runtime/theme-bootstrap.ts` | 15 |
| 203 | `frontend/src/runtime/runtimeErrorClassifier.ts` | 5 |
| 204 | `frontend/src/types/lucide-react-icons.d.ts` | 0 |
| 205 | `frontend/src/types/receiptContracts.ts` | 0 |
| 206 | `frontend/src/types/settingsContracts.ts` | 0 |
| 207 | `frontend/src/utils/actionGuards.ts` | 1 |
| 208 | `frontend/src/utils/actionHistory.ts` | 5 |
| 209 | `frontend/src/utils/appRefresh.ts` | 0 |
| 210 | `frontend/src/utils/bulkOps.ts` | 1 |
| 211 | `frontend/src/utils/color.ts` | 2 |
| 212 | `frontend/src/utils/csv.ts` | 8 |
| 213 | `frontend/src/utils/csvExportWorker.ts` | 1 |
| 214 | `frontend/src/utils/csvImport.ts` | 8 |
| 215 | `frontend/src/utils/csvRowCounter.ts` | 1 |
| 216 | `frontend/src/utils/csvTemplate.ts` | 0 |
| 217 | `frontend/src/utils/dateHelpers.ts` | 1 |
| 218 | `frontend/src/utils/deviceInfo.ts` | 2 |
| 219 | `frontend/src/utils/exportPackage.ts` | 0 |
| 220 | `frontend/src/utils/exportReports.tsx` | 8 |
| 221 | `frontend/src/utils/favicon.ts` | 3 |
| 222 | `frontend/src/utils/formatters.ts` | 1 |
| 223 | `frontend/src/utils/groupedRecords.ts` | 3 |
| 224 | `frontend/src/utils/historyHelpers.ts` | 0 |
| 225 | `frontend/src/utils/importJobRefresh.ts` | 4 |
| 226 | `frontend/src/utils/index.ts` | 0 |
| 227 | `frontend/src/utils/initials.ts` | 1 |
| 228 | `frontend/src/utils/loaders.ts` | 0 |
| 229 | `frontend/src/utils/mediaUpload.ts` | 0 |
| 230 | `frontend/src/utils/mediaUploadState.ts` | 0 |
| 231 | `frontend/src/utils/permissions.ts` | 1 |
| 232 | `frontend/src/utils/pricing.ts` | 0 |
| 233 | `frontend/src/utils/printReceipt.ts` | 30 |
| 234 | `frontend/src/utils/productBatches.ts` | 1 |
| 235 | `frontend/src/utils/productGrouping.ts` | 9 |
| 236 | `frontend/src/utils/publicAssetUrls.ts` | 6 |
| 237 | `frontend/src/utils/receiptAppliedConfig.ts` | 1 |
| 238 | `frontend/src/utils/scriptTypography.ts` | 0 |
| 239 | `frontend/src/utils/settingsRefresh.ts` | 1 |
| 240 | `frontend/src/utils/settingsWriteOptions.ts` | 0 |
| 241 | `frontend/src/web-api.ts` | 49 |
| 242 | `ops/scripts/frontend/build-public-runtime-scripts.ts` | 5 |
| 243 | `ops/scripts/frontend/verify-i18n.ts` | 6 |
| 244 | `ops/scripts/frontend/verify-performance.ts` | 4 |
| 245 | `ops/scripts/frontend/verify-ui.ts` | 11 |
| 246 | `frontend/vite.config.ts` | 5 |
| 247 | `frontend/tailwind.config.ts` | 0 |

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
| 1 | `getLocalDbModule` | function | 13 |
| 2 | `getLocalMirrorsModule` | function | 18 |
| 3 | `scheduleAuditLogMirror` | function | 23 |
| 4 | `normalizeAuditPageSize` | function | 36 |

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

### 3.11 `frontend/src/api/contactReadTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readLocalContacts` | function | 43 |
| 2 | `buildQueryString` | function | 49 |
| 3 | `appendQuery` | function | 64 |
| 4 | `getCachedRead` | function | 69 |
| 5 | `setCachedRead` | function | 75 |
| 6 | `scheduleLateMirror` | function | 80 |
| 7 | `run` | const arrow | 83 |
| 8 | `idle` | const arrow | 87 |
| 9 | `readContacts` | function | 96 |

### 3.12 `frontend/src/api/contactsTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getLocalDbModule` | function | 42 |
| 2 | `getCsvTemplateModule` | function | 47 |
| 3 | `buildContactCsvTemplate` | function | 52 |
| 4 | `getDevicePayload` | function | 57 |
| 5 | `encodeId` | function | 61 |
| 6 | `hasPagedParams` | function | 65 |
| 7 | `localSortedRows` | function | 70 |
| 8 | `readContactList` | function | 75 |
| 9 | `createContact` | function | 97 |
| 10 | `updateContact` | function | 107 |
| 11 | `deleteContact` | function | 121 |
| 12 | `bulkImportContact` | function | 131 |

### 3.13 `frontend/src/api/contactWriteTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `createContactClientRequestId` | function | 7 |
| 2 | `ensureContactClientRequestId` | function | 14 |
| 3 | `buildContactWritePayload` | function | 23 |
| 4 | `createContact` | function | 36 |
| 5 | `updateContact` | function | 51 |
| 6 | `deleteContact` | function | 68 |

### 3.14 `frontend/src/api/cooldownFallbacks.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readBrowserStoredNumber` | function | 23 |
| 2 | `writeBrowserStoredNumber` | function | 36 |
| 3 | `clearBrowserStoredNumber` | function | 44 |

### 3.15 `frontend/src/api/customTablesTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `encodePathSegment` | function | 24 |
| 2 | `tableDataPath` | function | 28 |
| 3 | `tableRowPath` | function | 32 |

### 3.16 `frontend/src/api/dashboardTransport.ts`

- No top-level named function/class symbols detected.

### 3.17 `frontend/src/api/driveSync.ts`

- No top-level named function/class symbols detected.

### 3.18 `frontend/src/api/expectedUpdatedAt.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getLocalDbModule` | function | 13 |
| 2 | `hasExpectedUpdatedAt` | function | 18 |

### 3.19 `frontend/src/api/fileTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeFileListResult` | function | 64 |
| 2 | `appendUserAndDeviceFields` | function | 78 |
| 3 | `dataUrlToBlob` | function | 87 |
| 4 | `parseJsonResponse` | function | 94 |
| 5 | `finish` | const arrow | 129 |

### 3.20 `frontend/src/api/http.ts`

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

### 3.21 `frontend/src/api/importJobsTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `encodeId` | function | 38 |
| 2 | `getSource` | function | 42 |
| 3 | `appendDeviceFields` | function | 46 |
| 4 | `notifyImportJobActivity` | function | 53 |
| 5 | `runImportJobAction` | function | 121 |

### 3.22 `frontend/src/api/importTransport.ts`

- No top-level named function/class symbols detected.

### 3.23 `frontend/src/api/inventoryTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDevicePayload` | function | 21 |

### 3.24 `frontend/src/api/lazyLocalDb.ts`

- No top-level named function/class symbols detected.

### 3.25 `frontend/src/api/localDb.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `splitCSVLine` | function | 268 |

### 3.26 `frontend/src/api/localMirrors.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getLocalDbModule` | function | 13 |
| 2 | `scheduleMirrorWrite` | function | 18 |
| 3 | `idle` | const arrow | 24 |

### 3.27 `frontend/src/api/lookupTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `listLookupRows` | function | 26 |
| 2 | `createLookupRow` | function | 38 |
| 3 | `updateLookupRow` | function | 47 |
| 4 | `deleteLookupRow` | function | 60 |

### 3.28 `frontend/src/api/methods.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDeviceInfo` | function | 6 |
| 2 | `loadPortalTransport` | function | 16 |
| 3 | `loadSaleWriteTransport` | function | 21 |
| 4 | `loadLocalDbModule` | function | 26 |
| 5 | `loadCsvTemplateModule` | function | 31 |
| 6 | `loadBrowserDialogsModule` | function | 36 |
| 7 | `buildImportCsvTemplate` | function | 41 |
| 8 | `getLocalDb` | function | 46 |
| 9 | `localGetSettings` | function | 51 |
| 10 | `localSaveSettings` | function | 56 |
| 11 | `localSaveSettingsMeta` | function | 61 |
| 12 | `loadSystemRuntimeModule` | function | 319 |
| 13 | `callSystemRuntimeMethod` | function | 324 |
| 14 | `scheduleSensitiveMirrorPurge` | function | 331 |
| 15 | `run` | const arrow | 332 |
| 16 | `canRefreshOfflineDeviceSnapshot` | function | 395 |
| 17 | `readOfflineDeviceSnapshotMeta` | function | 402 |
| 18 | `writeOfflineDeviceSnapshotMeta` | function | 411 |
| 19 | `runOfflineSnapshotStep` | function | 429 |
| 20 | `previousMeta` | const arrow | 449 |
| 21 | `invalidateClientRuntimeState` | function | 494 |
| 22 | `login` | const arrow | 525 |
| 23 | `logout` | const arrow | 527 |
| 24 | `resetPasswordWithOtp` | const arrow | 529 |
| 25 | `requestPasswordResetEmail` | const arrow | 531 |
| 26 | `completePasswordReset` | const arrow | 533 |
| 27 | `updateSessionDuration` | const arrow | 535 |
| 28 | `getVerificationCapabilities` | const arrow | 537 |
| 29 | `getSystemConfig` | const arrow | 539 |
| 30 | `getSystemBootstrap` | const arrow | 541 |
| 31 | `getSystemDebugLog` | const arrow | 546 |
| 32 | `startGoogleOauth` | const arrow | 548 |
| 33 | `completeGoogleOauth` | const arrow | 550 |
| 34 | `unlinkGoogleOauth` | const arrow | 552 |
| 35 | `getAppBootstrap` | const arrow | 554 |
| 36 | `getOrganizationBootstrap` | const arrow | 558 |
| 37 | `searchOrganizations` | const arrow | 560 |
| 38 | `getCurrentOrganization` | const arrow | 562 |
| 39 | `runSave` | const arrow | 588 |
| 40 | `getCategories` | const arrow | 651 |
| 41 | `updateCategory` | const arrow | 658 |
| 42 | `deleteCategory` | const arrow | 663 |
| 43 | `getUnits` | const arrow | 670 |
| 44 | `updateUnit` | const arrow | 677 |
| 45 | `deleteUnit` | const arrow | 682 |
| 46 | `getBranches` | const arrow | 689 |
| 47 | `getBranchSummary` | const arrow | 691 |
| 48 | `updateBranch` | const arrow | 695 |
| 49 | `deleteBranch` | const arrow | 697 |
| 50 | `getBranchStock` | const arrow | 699 |
| 51 | `getTransfers` | const arrow | 701 |
| 52 | `getBranchStockIntegrity` | const arrow | 705 |
| 53 | `getProducts` | const arrow | 711 |
| 54 | `searchProducts` | const arrow | 713 |
| 55 | `getProductBootstrap` | const arrow | 715 |
| 56 | `getProductsByIds` | const arrow | 717 |
| 57 | `getProductFilters` | const arrow | 719 |
| 58 | `getProductLookupUsage` | const arrow | 721 |
| 59 | `replaceProductLookupValues` | const arrow | 723 |
| 60 | `getPortalSubmissionsForReview` | const arrow | 769 |
| 61 | `reviewPortalSubmission` | const arrow | 773 |
| 62 | `getAiProviders` | const arrow | 778 |
| 63 | `createAiProvider` | const arrow | 780 |
| 64 | `updateAiProvider` | const arrow | 782 |
| 65 | `deleteAiProvider` | const arrow | 784 |
| 66 | `testAiProvider` | const arrow | 786 |
| 67 | `getAiResponses` | const arrow | 788 |
| 68 | `createProduct` | const arrow | 790 |
| 69 | `updateProduct` | const arrow | 792 |
| 70 | `deleteProduct` | const arrow | 794 |
| 71 | `otpSetup` | const arrow | 798 |
| 72 | `otpConfirm` | const arrow | 800 |
| 73 | `otpDisable` | const arrow | 802 |
| 74 | `otpVerify` | const arrow | 804 |
| 75 | `otpStatus` | const arrow | 806 |
| 76 | `listImportJobs` | const arrow | 818 |
| 77 | `getImportJobReview` | const arrow | 822 |
| 78 | `updateImportJobDecisions` | const arrow | 824 |
| 79 | `startImportJob` | const arrow | 828 |
| 80 | `approveImportJob` | const arrow | 830 |
| 81 | `cancelImportJob` | const arrow | 832 |
| 82 | `retryImportJob` | const arrow | 834 |
| 83 | `deleteImportJob` | const arrow | 836 |
| 84 | `getImportQueueStatus` | const arrow | 838 |
| 85 | `getFiles` | const arrow | 849 |
| 86 | `deleteFileAsset` | const arrow | 855 |
| 87 | `getActionHistory` | const arrow | 893 |
| 88 | `updateActionHistory` | const arrow | 898 |
| 89 | `getInventorySummary` | const arrow | 904 |
| 90 | `getInventoryStats` | const arrow | 906 |
| 91 | `getInventoryBootstrap` | const arrow | 908 |
| 92 | `searchInventoryProducts` | const arrow | 910 |
| 93 | `getInventoryMovements` | const arrow | 912 |
| 94 | `getInventoryReasons` | const arrow | 914 |
| 95 | `saveInventoryReasons` | const arrow | 916 |
| 96 | `getRfidStatus` | const arrow | 919 |
| 97 | `searchRfidTags` | const arrow | 924 |
| 98 | `recordRfidSessionEvents` | const arrow | 929 |
| 99 | `applyRfidSession` | const arrow | 933 |
| 100 | `getSales` | const arrow | 942 |
| 101 | `getDashboard` | const arrow | 947 |
| 102 | `getAnalytics` | const arrow | 948 |
| 103 | `getCustomers` | const arrow | 951 |
| 104 | `getCustomerPointSummaries` | const arrow | 954 |
| 105 | `updateCustomer` | const arrow | 960 |
| 106 | `deleteCustomer` | const arrow | 963 |
| 107 | `downloadCustomerTemplate` | const arrow | 968 |
| 108 | `getSuppliers` | const arrow | 972 |
| 109 | `updateSupplier` | const arrow | 978 |
| 110 | `deleteSupplier` | const arrow | 981 |
| 111 | `downloadSupplierTemplate` | const arrow | 986 |
| 112 | `getDeliveryContacts` | const arrow | 990 |
| 113 | `updateDeliveryContact` | const arrow | 996 |
| 114 | `deleteDeliveryContact` | const arrow | 999 |
| 115 | `getUsers` | const arrow | 1006 |
| 116 | `updateUser` | const arrow | 1008 |
| 117 | `getUserProfile` | const arrow | 1009 |
| 118 | `getUserAuthMethods` | const arrow | 1010 |
| 119 | `updateUserProfile` | const arrow | 1012 |
| 120 | `disconnectUserAuthProvider` | const arrow | 1014 |
| 121 | `changeUserPassword` | const arrow | 1016 |
| 122 | `resetPassword` | const arrow | 1018 |
| 123 | `getRoles` | const arrow | 1021 |
| 124 | `updateRole` | const arrow | 1023 |
| 125 | `deleteRole` | const arrow | 1024 |
| 126 | `getCustomTables` | const arrow | 1027 |
| 127 | `getCustomTableData` | const arrow | 1029 |
| 128 | `insertCustomRow` | const arrow | 1030 |
| 129 | `updateCustomRow` | const arrow | 1031 |
| 130 | `deleteCustomRow` | const arrow | 1032 |
| 131 | `getAuditLogs` | const arrow | 1035 |
| 132 | `deleteAuditLogsRetention` | const arrow | 1038 |
| 133 | `getIntegrationDoctor` | const arrow | 1054 |
| 134 | `getGoogleDriveSyncStatus` | const arrow | 1077 |
| 135 | `saveGoogleDriveSyncPreferences` | const arrow | 1080 |
| 136 | `startGoogleDriveSyncOauth` | const arrow | 1083 |
| 137 | `disconnectGoogleDriveSync` | const arrow | 1086 |
| 138 | `forgetGoogleDriveSyncCredentials` | const arrow | 1089 |
| 139 | `queueGoogleDriveSyncNow` | const arrow | 1092 |
| 140 | `syncGoogleDriveNow` | const arrow | 1095 |
| 141 | `openPath` | const arrow | 1160 |
| 142 | `getReturns` | const arrow | 1164 |
| 143 | `updateSaleStatus` | const arrow | 1188 |
| 144 | `attachSaleCustomer` | const arrow | 1205 |
| 145 | `getSalesExport` | const arrow | 1230 |
| 146 | `updateReturn` | const arrow | 1234 |
| 147 | `testSyncServer` | const arrow | 1259 |
| 148 | `openFolderDialog` | const arrow | 1264 |
| 149 | `getDataPath` | const arrow | 1268 |
| 150 | `getScaleMigrationStatus` | const arrow | 1270 |
| 151 | `prepareScaleMigration` | const arrow | 1272 |
| 152 | `runScaleMigration` | const arrow | 1274 |
| 153 | `browseDir` | const arrow | 1286 |

### 3.29 `frontend/src/api/multipartHeaders.ts`

- No top-level named function/class symbols detected.

### 3.30 `frontend/src/api/notificationSummary.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `buildNotificationSummaryFallback` | function | 12 |

### 3.31 `frontend/src/api/offlineSnapshotTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `canRefreshOfflineDeviceSnapshot` | function | 26 |
| 2 | `readOfflineDeviceSnapshotMeta` | function | 33 |
| 3 | `writeOfflineDeviceSnapshotMeta` | function | 42 |
| 4 | `getSettingsSnapshot` | function | 60 |
| 5 | `getReturnsSnapshot` | function | 69 |
| 6 | `runOfflineSnapshotStep` | function | 73 |
| 7 | `previousMeta` | const arrow | 93 |

### 3.32 `frontend/src/api/portalHttp.ts`

- No top-level named function/class symbols detected.

### 3.33 `frontend/src/api/portalTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readJsonObject` | function | 18 |
| 2 | `fetchPortalJson` | function | 22 |

### 3.34 `frontend/src/api/productImageUploadTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `dataUrlToBlob` | function | 10 |

### 3.35 `frontend/src/api/productReadTransport.ts`

- No top-level named function/class symbols detected.

### 3.36 `frontend/src/api/productWriteTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDevicePayload` | function | 9 |
| 2 | `encodeId` | function | 13 |
| 3 | `ensureSupplierExists` | function | 17 |

### 3.37 `frontend/src/api/query.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `appendQueryValue` | function | 44 |

### 3.38 `frontend/src/api/queryCache.ts`

- No top-level named function/class symbols detected.

### 3.39 `frontend/src/api/requestIds.ts`

- No top-level named function/class symbols detected.

### 3.40 `frontend/src/api/returnsTransport.ts`

- No top-level named function/class symbols detected.

### 3.41 `frontend/src/api/rfidTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDevicePayload` | function | 7 |
| 2 | `encodeId` | function | 11 |

### 3.42 `frontend/src/api/salesTransport.ts`

- No top-level named function/class symbols detected.

### 3.43 `frontend/src/api/saleWriteTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `asText` | function | 27 |
| 2 | `createSaleClientRequestId` | function | 31 |
| 3 | `ensureSaleClientRequestId` | function | 38 |
| 4 | `localTable` | function | 44 |
| 5 | `buildOfflineSaleReceiptNumber` | function | 48 |
| 6 | `isRetryableOfflineSaleError` | function | 54 |
| 7 | `findQueuedSale` | function | 64 |
| 8 | `putOfflineSaleMirror` | function | 72 |
| 9 | `queueOfflineSale` | function | 98 |
| 10 | `queuedSaleBackoffMs` | function | 157 |
| 11 | `updateQueuedRow` | function | 162 |
| 12 | `completeQueuedSale` | function | 172 |
| 13 | `failQueuedSale` | function | 201 |
| 14 | `markQueuedSaleConflict` | function | 215 |
| 15 | `createSaleRequest` | function | 238 |
| 16 | `createSaleWithoutWriteDedupe` | function | 247 |

### 3.44 `frontend/src/api/syncPreview.ts`

- No top-level named function/class symbols detected.

### 3.45 `frontend/src/api/syncRuntime.ts`

- No top-level named function/class symbols detected.

### 3.46 `frontend/src/api/systemJobs.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `wait` | function | 25 |
| 2 | `requireJobId` | function | 29 |
| 3 | `unwrapSystemJob` | function | 35 |

### 3.47 `frontend/src/api/systemRuntime.ts`

- No top-level named function/class symbols detected.

### 3.48 `frontend/src/api/userReadTransport.ts`

- No top-level named function/class symbols detected.

### 3.49 `frontend/src/api/websocket.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `clearReconnectTimer` | function | 22 |
| 2 | `clearPingTimer` | function | 28 |
| 3 | `hasStoredAuthSession` | function | 34 |
| 4 | `isProtectedAdminHost` | function | 43 |
| 5 | `shouldDebugWs` | function | 53 |
| 6 | `logWs` | function | 63 |
| 7 | `scheduleReconnect` | function | 191 |

### 3.50 `frontend/src/App.tsx`

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

### 3.51 `frontend/src/app/appShellUtils.ts`

- No top-level named function/class symbols detected.

### 3.52 `frontend/src/app/publicErrorRecovery.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getRecoveryStorage` | function | 6 |

### 3.53 `frontend/src/AppContext.tsx`

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

### 3.54 `frontend/src/components/auth/Login.tsx`

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

### 3.55 `frontend/src/components/branches/Branches.tsx`

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

### 3.56 `frontend/src/components/branches/BranchForm.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `BranchForm` | component/function | 37 |
| 2 | `handleSave` | const arrow | 57 |

### 3.57 `frontend/src/components/branches/TransferModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getTransferApi` | function | 71 |
| 2 | `getErrorMessage` | function | 76 |
| 3 | `normalizeTransferStockRows` | function | 80 |
| 4 | `TransferModal` | component/function | 94 |
| 5 | `loadStock` | function | 146 |
| 6 | `handleTransfer` | const arrow | 194 |

### 3.58 `frontend/src/components/catalog/CatalogEditorSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `CatalogEditorSurface` | component/function | 200 |

### 3.59 `frontend/src/components/catalog/CatalogImageField.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `CatalogImageField` | component/function | 29 |

### 3.60 `frontend/src/components/catalog/CatalogPage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadCatalogEditorSurface` | const arrow | 70 |
| 2 | `loadCatalogSecondaryTabs` | const arrow | 71 |
| 3 | `loadCatalogProductsSection` | const arrow | 72 |
| 4 | `loadCatalogPreviewSurface` | const arrow | 73 |
| 5 | `loadPortalTranslateControllerModule` | function | 76 |
| 6 | `getCatalogApi` | function | 246 |
| 7 | `getCatalogErrorMessage` | function | 250 |
| 8 | `createInitialUploadState` | function | 254 |
| 9 | `isTemporaryPreviewUrl` | function | 268 |
| 10 | `sanitizePersistedMediaPath` | function | 273 |
| 11 | `buildCacheBustedMediaPath` | function | 280 |
| 12 | `reduceUploadState` | function | 298 |
| 13 | `normalizePortalInitialOptions` | function | 365 |
| 14 | `normalizeCatalogOptions` | function | 374 |
| 15 | `normalizeBrandOptions` | function | 385 |
| 16 | `getAboutBlockLabel` | function | 390 |
| 17 | `withAssetVersion` | function | 396 |
| 18 | `sanitizePortalMediaValue` | function | 406 |
| 19 | `tt` | function | 416 |
| 20 | `toBoolean` | function | 424 |
| 21 | `toNumber` | function | 431 |
| 22 | `normalizePriceDisplay` | function | 438 |
| 23 | `normalizeHexColor` | function | 444 |
| 24 | `normalizeExternalUrl` | function | 450 |
| 25 | `createFaqId` | function | 466 |
| 26 | `normalizeFaqItems` | function | 470 |
| 27 | `translatedPortalText` | function | 526 |
| 28 | `translateConfiguredFaqText` | function | 532 |
| 29 | `localizeConfiguredFaqItems` | function | 539 |
| 30 | `buildFaqStarterItems` | function | 547 |
| 31 | `buildAiFaqStarterItems` | function | 556 |
| 32 | `hexToRgba` | function | 566 |
| 33 | `readPortalCache` | function | 577 |
| 34 | `writePortalCache` | function | 600 |
| 35 | `normalizePortalPath` | function | 619 |
| 36 | `isReservedPortalPath` | function | 632 |
| 37 | `getPortalTabs` | function | 636 |
| 38 | `resolvePortalActiveTab` | function | 647 |
| 39 | `buildDraft` | function | 655 |
| 40 | `applyDraft` | function | 755 |
| 41 | `getBranchQty` | function | 879 |
| 42 | `getStockStatus` | function | 886 |
| 43 | `normalizeProductGallery` | function | 897 |
| 44 | `normalizePortalProductSearch` | function | 914 |
| 45 | `buildRecommendedProductOption` | function | 918 |
| 46 | `productMatchesRecommendedSearch` | function | 928 |
| 47 | `formatDateTime` | function | 943 |
| 48 | `formatPortalPrice` | function | 951 |
| 49 | `ImageField` | function | 964 |
| 50 | `readImageFileAsDataUrl` | function | 1053 |
| 51 | `readImageFilesAsDataUrls` | function | 1062 |
| 52 | `pickImageAsDataUrl` | function | 1085 |
| 53 | `pickMultipleImagesAsDataUrls` | function | 1098 |
| 54 | `replaceVars` | function | 1111 |
| 55 | `getPortalResourceText` | function | 1115 |
| 56 | `canonicalPortalTranslateLanguage` | function | 1156 |
| 57 | `normalizeExternalTranslateTarget` | function | 1165 |
| 58 | `isFirstPartyTranslateTarget` | function | 1171 |
| 59 | `normalizePortalTranslateChoice` | function | 1178 |
| 60 | `readGoogleTranslateCookieTarget` | function | 1186 |
| 61 | `readStoredTranslateTargetLocal` | function | 1200 |
| 62 | `removePortalTranslateWidgetHostLocal` | function | 1213 |
| 63 | `isDocumentVisible` | function | 1218 |
| 64 | `sleep` | function | 1223 |
| 65 | `CatalogPage` | component/function | 1329 |
| 66 | `warmPublicProductsPanel` | const arrow | 1445 |
| 67 | `updateMediaUploadState` | const arrow | 1589 |
| 68 | `forgetMediaUploadState` | const arrow | 1596 |
| 69 | `loadAssistantStatus` | function | 1648 |
| 70 | `openProductGallery` | function | 1671 |
| 71 | `changeTranslateTarget` | function | 1684 |
| 72 | `isPortalLoadCurrent` | function | 1744 |
| 73 | `loadPortalEditorData` | function | 1748 |
| 74 | `refreshPortalView` | function | 1790 |
| 75 | `loadPortal` | function | 1819 |
| 76 | `ensureLink` | const arrow | 2084 |
| 77 | `renderRoundedFavicon` | const arrow | 2124 |
| 78 | `updateVisibility` | const arrow | 2201 |
| 79 | `handleScroll` | const arrow | 2231 |
| 80 | `initWidget` | const arrow | 2274 |
| 81 | `waitForWidget` | const arrow | 2294 |
| 82 | `setupExternalTranslateWidget` | function | 2315 |
| 83 | `toggleFilterValue` | function | 2432 |
| 84 | `clearPortalFilters` | function | 2440 |
| 85 | `setDraft` | function | 2448 |
| 86 | `toggleRecommendedProduct` | function | 2453 |
| 87 | `openPortalImage` | function | 2462 |
| 88 | `setAboutBlocksDraft` | function | 2473 |
| 89 | `setPromoItemsDraft` | function | 2477 |
| 90 | `getPortalMediaValue` | function | 2481 |
| 91 | `setPortalMediaValue` | function | 2495 |
| 92 | `clearPortalUploadPreview` | function | 2509 |
| 93 | `clearPortalMediaTarget` | function | 2515 |
| 94 | `uploadPortalMedia` | function | 2526 |
| 95 | `cancelPortalMediaUpload` | function | 2597 |
| 96 | `updateAboutBlock` | function | 2603 |
| 97 | `updatePromoItem` | function | 2609 |
| 98 | `addAboutBlock` | function | 2615 |
| 99 | `addPromoItem` | function | 2619 |
| 100 | `moveAboutBlockBefore` | function | 2623 |
| 101 | `removeAboutBlock` | function | 2635 |
| 102 | `movePromoItemBefore` | function | 2646 |
| 103 | `removePromoItem` | function | 2658 |
| 104 | `setFaqDraft` | function | 2669 |
| 105 | `addFaqItem` | function | 2673 |
| 106 | `mergeFaqStarterItems` | function | 2684 |
| 107 | `addFaqStarterSet` | function | 2697 |
| 108 | `addAiFaqStarterSet` | function | 2701 |
| 109 | `updateFaqItem` | function | 2705 |
| 110 | `removeFaqItem` | function | 2711 |
| 111 | `clearAssistantState` | function | 2715 |
| 112 | `uploadDraftImage` | function | 2730 |
| 113 | `uploadAboutBlockMedia` | function | 2734 |
| 114 | `uploadPromoItemMedia` | function | 2740 |
| 115 | `openFilePicker` | function | 2744 |
| 116 | `handleFilePickerSelect` | function | 2748 |
| 117 | `savePortalDraft` | function | 2776 |
| 118 | `askAssistant` | function | 2968 |
| 119 | `refreshMembershipData` | function | 3014 |
| 120 | `handleMembershipLookup` | function | 3056 |
| 121 | `addSubmissionImages` | function | 3069 |
| 122 | `handleSubmissionPaste` | function | 3079 |
| 123 | `handleSubmitShareProof` | function | 3095 |
| 124 | `handleReviewSubmission` | function | 3142 |
| 125 | `renderCatalogSection` | function | 3306 |
| 126 | `handleUploadSubmissionImages` | const arrow | 3332 |
| 127 | `handlePortalTabChange` | const arrow | 3388 |
| 128 | `renderSecondaryTabPanel` | function | 3399 |
| 129 | `renderSecondaryTabSection` | function | 3411 |
| 130 | `scrollPublicPortal` | const arrow | 3540 |

### 3.61 `frontend/src/components/catalog/CatalogPageContext.tsx`

- No top-level named function/class symbols detected.

### 3.62 `frontend/src/components/catalog/CatalogPreviewSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `CatalogPreviewSurface` | component/function | 113 |
| 2 | `handlePortalTabClick` | const arrow | 151 |

### 3.63 `frontend/src/components/catalog/CatalogProductsSection.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBadgeIcon` | function | 120 |
| 2 | `getBadgeToneClass` | function | 128 |
| 3 | `getProductInitial` | function | 137 |
| 4 | `CatalogProductsSection` | component/function | 145 |

### 3.64 `frontend/src/components/catalog/CatalogSecondaryTabs.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizePortalColor` | function | 267 |
| 2 | `CatalogMembershipSection` | function | 272 |
| 3 | `CatalogAboutSection` | function | 618 |
| 4 | `CatalogFaqSection` | function | 838 |
| 5 | `CatalogAiSection` | function | 892 |
| 6 | `CatalogSecondaryTabs` | component/function | 1078 |

### 3.65 `frontend/src/components/catalog/catalogUi.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `statusClass` | function | 22 |

### 3.66 `frontend/src/components/catalog/portalCatalogDisplay.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `replaceRankVars` | function | 173 |
| 2 | `normalizeRankBadgeLabel` | function | 177 |

### 3.67 `frontend/src/components/catalog/portalContentI18n.ts`

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

### 3.68 `frontend/src/components/catalog/portalEditorUtils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPlainObject` | function | 47 |
| 2 | `toTrimmedString` | function | 51 |

### 3.69 `frontend/src/components/catalog/portalLanguagePacks.ts`

- No top-level named function/class symbols detected.

### 3.70 `frontend/src/components/catalog/portalTranslateController.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeLanguage` | function | 16 |
| 2 | `ensureLinkHint` | function | 108 |

### 3.71 `frontend/src/components/contacts/ContactImportModal.tsx`

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

### 3.72 `frontend/src/components/contacts/contactImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.73 `frontend/src/components/contacts/contactOptionUtils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPlainRecord` | function | 24 |
| 2 | `readStringField` | function | 28 |
| 3 | `normalizeOption` | function | 45 |

### 3.74 `frontend/src/components/contacts/Contacts.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadContactReadTransportModule` | function | 96 |
| 2 | `loadCsvUtilsModule` | function | 101 |
| 3 | `getContactApi` | function | 106 |
| 4 | `getErrorMessage` | function | 114 |
| 5 | `asExportValue` | function | 118 |
| 6 | `normalizeContactExportRows` | function | 122 |
| 7 | `ContactTabFallback` | function | 150 |
| 8 | `ImportTypePicker` | function | 199 |
| 9 | `Contacts` | component/function | 239 |
| 10 | `handleExportAll` | const arrow | 255 |
| 11 | `openImportPicker` | const arrow | 344 |
| 12 | `handleTypeSelected` | const arrow | 346 |
| 13 | `handleImportDone` | const arrow | 351 |

### 3.75 `frontend/src/components/contacts/CustomerFormModal.tsx`

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

### 3.76 `frontend/src/components/contacts/customerMembershipNumber.ts`

- No top-level named function/class symbols detected.

### 3.77 `frontend/src/components/contacts/CustomersTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadContactReadTransportModule` | function | 131 |
| 2 | `loadContactWriteTransportModule` | function | 136 |
| 3 | `loadCsvUtilsModule` | function | 141 |
| 4 | `getCustomerApi` | function | 146 |
| 5 | `isSectionRow` | function | 155 |
| 6 | `normalizeCustomerRows` | function | 159 |
| 7 | `getApiListPayload` | function | 166 |
| 8 | `getErrorMessage` | function | 170 |
| 9 | `formatPoints` | function | 174 |
| 10 | `tr` | function | 186 |
| 11 | `CustomersTab` | function | 195 |
| 12 | `toggleSectionCollapsed` | const arrow | 358 |
| 13 | `isSectionFullySelected` | const arrow | 364 |
| 14 | `isSectionPartiallySelected` | const arrow | 365 |
| 15 | `toggleSectionSelection` | const arrow | 366 |
| 16 | `promise` | const arrow | 400 |
| 17 | `handleSave` | const arrow | 487 |
| 18 | `handleDelete` | const arrow | 564 |
| 19 | `handleBulkDelete` | const arrow | 603 |

### 3.78 `frontend/src/components/contacts/DeliveryTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadContactReadTransportModule` | function | 125 |
| 2 | `loadContactWriteTransportModule` | function | 130 |
| 3 | `loadCsvUtilsModule` | function | 135 |
| 4 | `getDeliveryApi` | function | 140 |
| 5 | `normalizeDeliveryRows` | function | 149 |
| 6 | `isSectionRow` | function | 157 |
| 7 | `getErrorMessage` | function | 161 |
| 8 | `BLANK_OPTION` | const arrow | 178 |
| 9 | `OptionEditor` | function | 189 |
| 10 | `set` | const arrow | 190 |
| 11 | `fieldId` | const arrow | 191 |
| 12 | `DeliveryForm` | function | 236 |
| 13 | `set` | const arrow | 245 |
| 14 | `addOption` | const arrow | 246 |
| 15 | `updateOption` | const arrow | 250 |
| 16 | `removeOption` | const arrow | 251 |
| 17 | `handleSave` | const arrow | 252 |
| 18 | `OptionsDisplay` | function | 322 |
| 19 | `OptionsBadge` | function | 339 |
| 20 | `DeliveryTab` | function | 350 |
| 21 | `toggleSectionCollapsed` | const arrow | 491 |
| 22 | `isSectionFullySelected` | const arrow | 497 |
| 23 | `isSectionPartiallySelected` | const arrow | 498 |
| 24 | `toggleSectionSelection` | const arrow | 499 |
| 25 | `promise` | const arrow | 531 |
| 26 | `handleSave` | const arrow | 605 |
| 27 | `handleDelete` | const arrow | 667 |
| 28 | `handleBulkDelete` | const arrow | 704 |

### 3.79 `frontend/src/components/contacts/shared.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toggleOne` | const arrow | 100 |
| 2 | `clearSelection` | const arrow | 111 |
| 3 | `menuContent` | const arrow | 165 |

### 3.80 `frontend/src/components/contacts/SuppliersTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadContactReadTransportModule` | function | 128 |
| 2 | `loadContactWriteTransportModule` | function | 133 |
| 3 | `loadCsvUtilsModule` | function | 138 |
| 4 | `getSupplierApi` | function | 143 |
| 5 | `normalizeSupplierRows` | function | 152 |
| 6 | `isSectionRow` | function | 160 |
| 7 | `getErrorMessage` | function | 164 |
| 8 | `SupplierForm` | function | 175 |
| 9 | `set` | const arrow | 191 |
| 10 | `addOption` | const arrow | 192 |
| 11 | `updateOption` | const arrow | 196 |
| 12 | `removeOption` | const arrow | 197 |
| 13 | `handleSubmit` | const arrow | 198 |
| 14 | `fieldId` | const arrow | 246 |
| 15 | `SuppliersTab` | function | 292 |
| 16 | `toggleSectionCollapsed` | const arrow | 440 |
| 17 | `isSectionFullySelected` | const arrow | 446 |
| 18 | `isSectionPartiallySelected` | const arrow | 447 |
| 19 | `toggleSectionSelection` | const arrow | 448 |
| 20 | `promise` | const arrow | 482 |
| 21 | `handleSave` | const arrow | 557 |
| 22 | `handleDelete` | const arrow | 627 |
| 23 | `handleBulkDelete` | const arrow | 666 |

### 3.81 `frontend/src/components/custom-tables/CustomTables.tsx`

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

### 3.82 `frontend/src/components/dashboard/charts/BarChart.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `chartLabelsNeedYear` | function | 23 |
| 2 | `formatAxisLabel` | function | 32 |
| 3 | `BarChart` | component/function | 45 |
| 4 | `updateWidth` | const arrow | 53 |
| 5 | `yPx` | function | 89 |

### 3.83 `frontend/src/components/dashboard/charts/DonutChart.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `DonutChart` | component/function | 22 |

### 3.84 `frontend/src/components/dashboard/charts/index.ts`

- No top-level named function/class symbols detected.

### 3.85 `frontend/src/components/dashboard/charts/LineChart.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `chartLabelsNeedYear` | function | 28 |
| 2 | `formatAxisLabel` | function | 37 |
| 3 | `LineChart` | component/function | 50 |
| 4 | `updateWidth` | const arrow | 58 |
| 5 | `xPx` | function | 100 |
| 6 | `yPx` | function | 104 |
| 7 | `handleMouseMove` | const arrow | 114 |

### 3.86 `frontend/src/components/dashboard/charts/NoData.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `NoData` | component/function | 7 |

### 3.87 `frontend/src/components/dashboard/Dashboard.tsx`

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

### 3.88 `frontend/src/components/dashboard/MiniStat.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `MiniStat` | component/function | 13 |

### 3.89 `frontend/src/components/files/FilePickerModal.tsx`

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

### 3.90 `frontend/src/components/files/FilesPage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadFilesProvidersTab` | const arrow | 41 |
| 2 | `loadFilesResponsesTab` | const arrow | 42 |
| 3 | `getFilesApi` | function | 250 |
| 4 | `getErrorMessage` | function | 254 |
| 5 | `hasMojibake` | function | 258 |
| 6 | `sanitizeFallback` | function | 262 |
| 7 | `AssetPreview` | function | 266 |
| 8 | `AssetCardSkeleton` | function | 289 |
| 9 | `formatDateTime` | function | 315 |
| 10 | `formatFileSize` | function | 325 |
| 11 | `emptyProviderForm` | function | 333 |
| 12 | `compactTabLabel` | function | 356 |
| 13 | `getDefaultFilesPageSize` | function | 362 |
| 14 | `downloadAssetFile` | function | 367 |
| 15 | `FilesPage` | component/function | 379 |
| 16 | `handleUpload` | function | 673 |
| 17 | `handleDeleteAsset` | function | 696 |
| 18 | `toggleAssetSelection` | function | 724 |
| 19 | `toggleSelectAllAssets` | function | 735 |
| 20 | `handleCopySelectedPaths` | function | 742 |
| 21 | `handleDownloadSelected` | function | 757 |
| 22 | `handleDeleteSelectedAssets` | function | 765 |
| 23 | `startCreateProvider` | function | 811 |
| 24 | `startEditProvider` | function | 827 |
| 25 | `saveProvider` | function | 852 |
| 26 | `testProvider` | function | 936 |
| 27 | `removeProvider` | function | 957 |

### 3.91 `frontend/src/components/files/FilesProvidersTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProviderStatus` | function | 121 |
| 2 | `FilesProvidersTab` | component/function | 132 |

### 3.92 `frontend/src/components/files/FilesResponsesTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `FilesResponsesTab` | component/function | 64 |

### 3.93 `frontend/src/components/inventory/DualMoney.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `DualMoney` | component/function | 8 |

### 3.94 `frontend/src/components/inventory/Inventory.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadBranchTransport` | function | 207 |
| 2 | `loadDashboardTransport` | function | 212 |
| 3 | `loadInventoryTransport` | function | 217 |
| 4 | `loadProductReadTransport` | function | 222 |
| 5 | `loadReturnsTransport` | function | 227 |
| 6 | `loadRfidTransport` | function | 232 |
| 7 | `loadUserReadTransport` | function | 237 |
| 8 | `getInventoryApi` | function | 242 |
| 9 | `normalizeFiniteIds` | function | 292 |
| 10 | `countActiveFlags` | function | 296 |
| 11 | `countSelectedIds` | function | 304 |
| 12 | `renderDestinationProductOptions` | function | 312 |
| 13 | `limitInventorySectionsForMobile` | function | 323 |
| 14 | `priceCsv` | function | 350 |
| 15 | `parseInventoryTimestamp` | function | 354 |
| 16 | `InventoryDiscountBadge` | function | 368 |
| 17 | `InventoryBatchPreview` | function | 379 |
| 18 | `label` | const arrow | 391 |
| 19 | `loadInventoryExportTools` | function | 446 |
| 20 | `Inventory` | component/function | 461 |
| 21 | `promise` | const arrow | 705 |
| 22 | `loadInventoryBootstrap` | const arrow | 743 |
| 23 | `handleAdjust` | const arrow | 1110 |
| 24 | `openAdjust` | const arrow | 1192 |
| 25 | `openMove` | const arrow | 1199 |
| 26 | `openTransfer` | const arrow | 1222 |
| 27 | `handleMoveStock` | const arrow | 1277 |
| 28 | `handleTransferStock` | const arrow | 1350 |
| 29 | `syncViewport` | const arrow | 1511 |
| 30 | `statsValue` | const arrow | 2130 |
| 31 | `selectInventorySection` | const arrow | 3353 |

### 3.95 `frontend/src/components/inventory/InventoryImportModal.tsx`

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

### 3.96 `frontend/src/components/inventory/inventoryImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.97 `frontend/src/components/inventory/InventoryMovementsSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `InventoryMovementsSurface` | component/function | 143 |

### 3.98 `frontend/src/components/inventory/InventoryProductsSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `InventoryProductsSurface` | component/function | 103 |
| 2 | `renderDesktopTableHead` | const arrow | 142 |
| 3 | `renderDesktopLoadingShell` | const arrow | 164 |

### 3.99 `frontend/src/components/inventory/InventoryRfidSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `InventoryRfidSurface` | component/function | 55 |

### 3.100 `frontend/src/components/inventory/movementGroups.ts`

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

### 3.101 `frontend/src/components/inventory/ProductDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBranchStockKey` | function | 61 |
| 2 | `ProductDetailModal` | component/function | 65 |

### 3.102 `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx`

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

### 3.103 `frontend/src/components/navigation/Sidebar.tsx`

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

### 3.104 `frontend/src/components/pos/CartItem.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `translate` | function | 41 |
| 2 | `CartItem` | component/function | 45 |

### 3.105 `frontend/src/components/pos/FilterPanel.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `countActiveFlags` | function | 47 |
| 2 | `SectionLabel` | function | 55 |
| 3 | `POSFilterPanel` | component/function | 66 |
| 4 | `clearAll` | const arrow | 99 |
| 5 | `chip` | const arrow | 108 |

### 3.106 `frontend/src/components/pos/POS.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadContactOptionUtilsModule` | function | 87 |
| 2 | `parseContactOptions` | function | 118 |
| 3 | `isPlainRecord` | function | 309 |
| 4 | `normalizeCategory` | function | 313 |
| 5 | `loadPosProductBootstrap` | function | 328 |
| 6 | `searchPosCatalogProducts` | function | 332 |
| 7 | `loadPosProductFilters` | function | 336 |
| 8 | `loadPosCategories` | function | 340 |
| 9 | `getContactReadTransport` | function | 349 |
| 10 | `getContactWriteTransport` | function | 354 |
| 11 | `getPortalTransport` | function | 359 |
| 12 | `getSaleWriteTransport` | function | 364 |
| 13 | `loadPosCustomers` | function | 369 |
| 14 | `loadPosDeliveryContacts` | function | 374 |
| 15 | `createPosCustomer` | function | 379 |
| 16 | `createPosDeliveryContact` | function | 384 |
| 17 | `lookupPosPortalMembership` | function | 389 |
| 18 | `createPosSale` | function | 394 |
| 19 | `normalizeOrder` | function | 399 |
| 20 | `getErrorMessage` | function | 410 |
| 21 | `asText` | function | 414 |
| 22 | `asNumber` | function | 418 |
| 23 | `allTermsMatch` | function | 422 |
| 24 | `ProductDiscountBadge` | function | 436 |
| 25 | `POS` | component/function | 456 |
| 26 | `setPersistedCat` | const arrow | 487 |
| 27 | `setPersistedBrand` | const arrow | 488 |
| 28 | `setPersistedBranch` | const arrow | 489 |
| 29 | `setPersistedStock` | const arrow | 490 |
| 30 | `setPersistedGroup` | const arrow | 491 |
| 31 | `setPersistedSupplier` | const arrow | 492 |
| 32 | `setPersistedInitial` | const arrow | 493 |
| 33 | `addNewOrder` | const arrow | 554 |
| 34 | `closeOrder` | const arrow | 566 |
| 35 | `promise` | const arrow | 708 |
| 36 | `selectCustomer` | const arrow | 1038 |
| 37 | `applyCustomerOption` | const arrow | 1086 |
| 38 | `clearCustomer` | const arrow | 1100 |
| 39 | `handleAddCustomer` | const arrow | 1108 |
| 40 | `selectDelivery` | const arrow | 1145 |
| 41 | `clearDelivery` | const arrow | 1150 |
| 42 | `handleAddDelivery` | const arrow | 1152 |
| 43 | `qty` | const arrow | 1263 |
| 44 | `addToCart` | function | 1427 |
| 45 | `updateQty` | const arrow | 1466 |
| 46 | `updatePrice` | const arrow | 1474 |
| 47 | `updateItemBranch` | const arrow | 1498 |
| 48 | `handleDiscountUsd` | const arrow | 1547 |
| 49 | `handleDiscountKhr` | const arrow | 1548 |
| 50 | `handleMembershipUnits` | const arrow | 1549 |
| 51 | `handleCheckout` | const arrow | 1588 |

### 3.107 `frontend/src/components/pos/posCore.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeNumber` | function | 48 |

### 3.108 `frontend/src/components/pos/ProductImage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductImage` | component/function | 9 |

### 3.109 `frontend/src/components/pos/QuickAddModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `QuickAddModal` | component/function | 12 |
| 2 | `T` | const arrow | 13 |

### 3.110 `frontend/src/components/products/config/productPageConfig.ts`

- No top-level named function/class symbols detected.

### 3.111 `frontend/src/components/products/forms/BranchStockAdjuster.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getProductApi` | function | 72 |
| 2 | `parseStockDelta` | function | 76 |
| 3 | `BranchStockAdjuster` | component/function | 81 |
| 4 | `T` | const arrow | 102 |
| 5 | `setRow` | const arrow | 108 |
| 6 | `handleSave` | const arrow | 114 |

### 3.112 `frontend/src/components/products/forms/BulkAddStockModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getProductApi` | function | 68 |
| 2 | `parsePositiveQuantity` | function | 72 |
| 3 | `normalizeBranchId` | function | 77 |
| 4 | `normalizeProductId` | function | 83 |
| 5 | `BulkAddStockModal` | component/function | 88 |
| 6 | `handleSave` | const arrow | 101 |

### 3.113 `frontend/src/components/products/forms/ProductForm.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadContactsTransportModule` | function | 185 |
| 2 | `loadProductImageUploadTransportModule` | function | 190 |
| 3 | `getErrorMessage` | function | 197 |
| 4 | `normalizeGallery` | function | 201 |
| 5 | `editablePrice` | function | 217 |
| 6 | `pickImageFiles` | function | 222 |
| 7 | `ProductForm` | component/function | 241 |
| 8 | `loadSuppliers` | function | 369 |
| 9 | `setField` | function | 394 |
| 10 | `setNumericField` | function | 398 |
| 11 | `addImages` | function | 402 |
| 12 | `addPhoto` | function | 407 |
| 13 | `uploadPickedImages` | function | 412 |
| 14 | `removeImage` | function | 457 |
| 15 | `setPrimaryImage` | function | 461 |
| 16 | `saveForm` | function | 471 |
| 17 | `openScanner` | function | 522 |
| 18 | `closeScanner` | function | 527 |
| 19 | `applyScannedValue` | function | 531 |

### 3.114 `frontend/src/components/products/forms/VariantFormModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getProductVariantApi` | function | 104 |
| 2 | `getErrorMessage` | function | 108 |
| 3 | `VariantFormModal` | component/function | 112 |

### 3.115 `frontend/src/components/products/helpers/productDisplayHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toNumber` | function | 57 |

### 3.116 `frontend/src/components/products/helpers/productFilterHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toNumber` | function | 66 |
| 2 | `getImageGallery` | function | 71 |
| 3 | `toImageName` | const arrow | 154 |
| 4 | `toImageUrl` | const arrow | 155 |
| 5 | `priceCsv` | const arrow | 156 |

### 3.117 `frontend/src/components/products/helpers/productGalleryHelpers.ts`

- No top-level named function/class symbols detected.

### 3.118 `frontend/src/components/products/helpers/productGroupViewHelpers.ts`

- No top-level named function/class symbols detected.

### 3.119 `frontend/src/components/products/helpers/productMenuHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `asString` | function | 85 |

### 3.120 `frontend/src/components/products/helpers/productPageHelpers.ts`

- No top-level named function/class symbols detected.

### 3.121 `frontend/src/components/products/helpers/productSelectionHelpers.ts`

- No top-level named function/class symbols detected.

### 3.122 `frontend/src/components/products/helpers/productWriteHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toFiniteNumber` | function | 123 |
| 2 | `hasBulkFormValue` | function | 128 |
| 3 | `stringOrEmpty` | function | 132 |

### 3.123 `frontend/src/components/products/history/productHistoryHelpers.ts`

- No top-level named function/class symbols detected.

### 3.124 `frontend/src/components/products/import/BulkImportModal.tsx`

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

### 3.125 `frontend/src/components/products/import/productImportPlanner.ts`

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

### 3.126 `frontend/src/components/products/import/productImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `post` | function | 39 |
| 2 | `waitForNextTask` | function | 43 |
| 3 | `getErrorMessage` | function | 49 |

### 3.127 `frontend/src/components/products/lookups/ManageBrandsModal.tsx`

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

### 3.128 `frontend/src/components/products/lookups/ManageCategoriesModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getCategoryApi` | function | 106 |
| 2 | `getErrorMessage` | function | 110 |
| 3 | `normalizeCategoryRows` | function | 114 |
| 4 | `mergeCategoryUsage` | function | 129 |
| 5 | `ManageCategoriesModal` | component/function | 158 |

### 3.129 `frontend/src/components/products/lookups/ManageUnitsModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getUnitApi` | function | 106 |
| 2 | `getErrorMessage` | function | 110 |
| 3 | `normalizeUnitRows` | function | 114 |
| 4 | `mergeUnitUsage` | function | 129 |
| 5 | `ManageUnitsModal` | component/function | 158 |

### 3.130 `frontend/src/components/products/lookups/productLookupSnapshots.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getFallbackApiClient` | function | 57 |
| 2 | `normalizeProductRows` | function | 63 |
| 3 | `getPayloadNumber` | function | 70 |
| 4 | `snapshotLookupProducts` | function | 75 |
| 5 | `mergeUniqueSnapshots` | function | 89 |
| 6 | `fetchLookupProductSnapshotsForName` | function | 113 |
| 7 | `fetchProductsByIds` | function | 165 |

### 3.131 `frontend/src/components/products/Products.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadProductReadModule` | function | 350 |
| 2 | `loadProductWriteModule` | function | 355 |
| 3 | `loadLookupModule` | function | 360 |
| 4 | `loadBranchModule` | function | 365 |
| 5 | `loadInventoryModule` | function | 370 |
| 6 | `loadProductImageUploadModule` | function | 375 |
| 7 | `getProductApi` | function | 407 |
| 8 | `getErrorMessage` | function | 411 |
| 9 | `isObjectRecord` | function | 415 |
| 10 | `toProductApiResponse` | function | 419 |
| 11 | `scrollNodeWithOffset` | function | 423 |
| 12 | `summarizeProductRun` | function | 429 |
| 13 | `aggregateProductInitials` | function | 433 |
| 14 | `toModalProduct` | function | 444 |
| 15 | `toVariantParentProduct` | function | 456 |
| 16 | `toLightboxState` | function | 462 |
| 17 | `Products` | component/function | 472 |
| 18 | `promise` | const arrow | 569 |
| 19 | `handleSave` | const arrow | 829 |
| 20 | `handleSaveWithGallery` | const arrow | 879 |
| 21 | `handleBulkDelete` | const arrow | 946 |
| 22 | `handleBulkOutOfStock` | const arrow | 993 |
| 23 | `handleBulkChangeBranch` | const arrow | 1036 |
| 24 | `handleBulkAddStock` | const arrow | 1066 |
| 25 | `toggleSelect` | const arrow | 1074 |
| 26 | `toggleSelectAll` | const arrow | 1081 |
| 27 | `handleDelete` | const arrow | 1088 |
| 28 | `renderUnitChip` | const arrow | 1175 |
| 29 | `openLightbox` | const arrow | 1189 |
| 30 | `getStockBadge` | const arrow | 1196 |

### 3.132 `frontend/src/components/products/scanning/barcodeImageScanner.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readFileAsDataUrl` | function | 37 |
| 2 | `createImageElement` | function | 62 |
| 3 | `loadImageSource` | function | 66 |
| 4 | `detectWithNativeBarcodeDetector` | function | 75 |

### 3.133 `frontend/src/components/products/scanning/BarcodeScannerModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getNativeBarcodeDetector` | function | 100 |
| 2 | `getScanErrorText` | function | 107 |
| 3 | `stopStream` | function | 112 |
| 4 | `BarcodeScannerModal` | component/function | 118 |

### 3.134 `frontend/src/components/products/scanning/barcodeScannerState.ts`

- No top-level named function/class symbols detected.

### 3.135 `frontend/src/components/products/scanning/cameraPermission.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeCameraPermissionState` | function | 9 |
| 2 | `queryCameraPermission` | function | 16 |
| 3 | `handleChange` | const arrow | 35 |

### 3.136 `frontend/src/components/products/scanning/scanbotScanner.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `publicBasePath` | const arrow | 37 |
| 2 | `getScanbotGlobal` | function | 49 |
| 3 | `normalizeScanbotError` | function | 68 |
| 4 | `loadScanbotScript` | function | 82 |
| 5 | `getInitializedScanbot` | function | 135 |

### 3.137 `frontend/src/components/products/shared/primitives.tsx`

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

### 3.138 `frontend/src/components/products/surfaces/HeaderActions.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductsHeaderActions` | component/function | 22 |
| 2 | `tr` | const arrow | 32 |

### 3.139 `frontend/src/components/products/surfaces/ProductDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductDetailModal` | component/function | 79 |
| 2 | `T` | const arrow | 95 |
| 3 | `Row` | const arrow | 121 |

### 3.140 `frontend/src/components/products/surfaces/ProductRowParts.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `label` | const arrow | 104 |

### 3.141 `frontend/src/components/products/surfaces/ProductsListSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductsListSurface` | component/function | 62 |
| 2 | `renderDesktopTableHead` | const arrow | 105 |
| 3 | `renderDesktopLoadingShell` | const arrow | 134 |

### 3.142 `frontend/src/components/receipt-settings/AllFieldsPanel.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Toggle` | function | 30 |
| 2 | `AllFieldsPanel` | component/function | 46 |
| 3 | `T` | const arrow | 49 |
| 4 | `toggleSection` | const arrow | 68 |

### 3.143 `frontend/src/components/receipt-settings/constants.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `T` | const arrow | 110 |

### 3.144 `frontend/src/components/receipt-settings/ErrorBoundary.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatError` | function | 11 |

### 3.145 `frontend/src/components/receipt-settings/FieldOrderManager.tsx`

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

### 3.146 `frontend/src/components/receipt-settings/PrintSettings.tsx`

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

### 3.147 `frontend/src/components/receipt-settings/ReceiptPreview.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatLoadError` | function | 34 |
| 2 | `ReceiptPreview` | component/function | 39 |
| 3 | `loadPreview` | function | 50 |

### 3.148 `frontend/src/components/receipt-settings/ReceiptSettings.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 80 |
| 2 | `Section` | function | 85 |
| 3 | `Toggle` | function | 96 |
| 4 | `ReceiptSettings` | component/function | 111 |

### 3.149 `frontend/src/components/receipt-settings/template.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isRecord` | function | 6 |
| 2 | `parseTemplateInput` | function | 10 |

### 3.150 `frontend/src/components/receipt/Receipt.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadReceiptPrintModule` | function | 109 |
| 2 | `toNumber` | function | 114 |
| 3 | `stripEmoji` | function | 119 |
| 4 | `stripEmoji` | function | 121 |
| 5 | `displayAddress` | function | 126 |
| 6 | `parseItems` | function | 135 |
| 7 | `getErrorMessage` | function | 146 |
| 8 | `labelFor` | function | 232 |
| 9 | `Row` | function | 237 |
| 10 | `Receipt` | component/function | 249 |
| 11 | `exportReceiptPdf` | const arrow | 460 |

### 3.151 `frontend/src/components/returns/EditReturnModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getReturnApi` | function | 90 |
| 2 | `toNumber` | function | 95 |
| 3 | `clampReturnQuantity` | function | 100 |
| 4 | `isWriteConflict` | function | 106 |
| 5 | `EditReturnModal` | component/function | 111 |
| 6 | `updateQty` | const arrow | 144 |
| 7 | `updateRestock` | const arrow | 147 |

### 3.152 `frontend/src/components/returns/NewReturnModal.tsx`

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

### 3.153 `frontend/src/components/returns/NewSupplierReturnModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isSupplierReturnItem` | function | 86 |
| 2 | `getSupplierReturnApi` | function | 90 |
| 3 | `NewSupplierReturnModal` | component/function | 99 |
| 4 | `loadSetup` | function | 136 |
| 5 | `loadInventory` | function | 187 |
| 6 | `updateQty` | const arrow | 258 |
| 7 | `submit` | const arrow | 264 |

### 3.154 `frontend/src/components/returns/ReturnDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeScope` | function | 52 |
| 2 | `coerceMoney` | function | 56 |
| 3 | `isPositiveMoney` | function | 60 |
| 4 | `ReturnDetailModal` | component/function | 64 |

### 3.155 `frontend/src/components/returns/Returns.tsx`

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
| 12 | `promise` | const arrow | 304 |

### 3.156 `frontend/src/components/returns/ReturnsListSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `detectMobileViewport` | function | 71 |
| 2 | `ReturnsDesktopSkeletonRows` | function | 76 |
| 3 | `ReturnsMobileSkeletonCards` | function | 93 |
| 4 | `ReturnsListSurface` | component/function | 113 |
| 5 | `apply` | const arrow | 144 |

### 3.157 `frontend/src/components/sales/ExportModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getSalesExportApi` | function | 71 |
| 2 | `getErrorMessage` | function | 76 |
| 3 | `ExportModal` | component/function | 80 |
| 4 | `handlePreview` | const arrow | 154 |
| 5 | `handleExportCSV` | const arrow | 172 |

### 3.158 `frontend/src/components/sales/SaleDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toNumber` | function | 73 |
| 2 | `InfoBlock` | function | 78 |
| 3 | `parseItems` | function | 94 |
| 4 | `SaleDetailModal` | component/function | 105 |

### 3.159 `frontend/src/components/sales/Sales.tsx`

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
| 11 | `buildSaleExportRows` | function | 197 |
| 12 | `Sales` | component/function | 213 |
| 13 | `promise` | const arrow | 304 |
| 14 | `toggleSelected` | const arrow | 654 |
| 15 | `toggleSelectAll` | const arrow | 660 |
| 16 | `handleBulkStatusUpdate` | const arrow | 736 |

### 3.160 `frontend/src/components/sales/SalesImportModal.tsx`

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

### 3.161 `frontend/src/components/sales/salesImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.162 `frontend/src/components/sales/SalesListSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getSaleItems` | function | 67 |
| 2 | `SalesListSurface` | component/function | 71 |

### 3.163 `frontend/src/components/sales/StatusBadge.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isSaleStatus` | function | 24 |
| 2 | `StatusBadge` | component/function | 50 |

### 3.164 `frontend/src/components/server/ServerPage.tsx`

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

### 3.165 `frontend/src/components/shared/ActionHistoryBar.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatHistoryList` | function | 50 |
| 2 | `formatServerStatus` | function | 54 |
| 3 | `ActionHistoryBar` | component/function | 61 |

### 3.166 `frontend/src/components/shared/BackgroundImportTracker.tsx`

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

### 3.167 `frontend/src/components/shared/ExportMenu.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ExportMenu` | component/function | 17 |

### 3.168 `frontend/src/components/shared/FilterMenu.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `sectionButtonClass` | function | 35 |
| 2 | `FilterMenu` | component/function | 41 |

### 3.169 `frontend/src/components/shared/globalScroll.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDocumentLike` | function | 21 |
| 2 | `getPageScrollCandidates` | function | 25 |
| 3 | `isVisibleScrollNode` | function | 38 |

### 3.170 `frontend/src/components/shared/ImageGalleryLightbox.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ImageGalleryLightbox` | component/function | 31 |
| 2 | `formatLabel` | function | 53 |
| 3 | `setIndex` | function | 57 |
| 4 | `renderGalleryImage` | function | 63 |
| 5 | `onKeyDown` | function | 70 |

### 3.171 `frontend/src/components/shared/LazyPortalMenu.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `LazyPortalMenu` | component/function | 7 |

### 3.172 `frontend/src/components/shared/LoadingWatchdog.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `LoadingWatchdog` | component/function | 14 |

### 3.173 `frontend/src/components/shared/Modal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Modal` | component/function | 13 |

### 3.174 `frontend/src/components/shared/navigationConfig.ts`

- No top-level named function/class symbols detected.

### 3.175 `frontend/src/components/shared/NotificationCenter.tsx`

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

### 3.176 `frontend/src/components/shared/pageActivity.ts`

- No top-level named function/class symbols detected.

### 3.177 `frontend/src/components/shared/PageHeader.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PageHeader` | component/function | 26 |

### 3.178 `frontend/src/components/shared/PaginationControls.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PaginationControls` | component/function | 41 |
| 2 | `commitPageDraft` | const arrow | 71 |
| 3 | `handlePageInputKeyDown` | const arrow | 82 |

### 3.179 `frontend/src/components/shared/PortalMenu.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPortalMenuItem` | function | 50 |
| 2 | `PortalMenu` | component/function | 60 |
| 3 | `closeIfClickedOutside` | const arrow | 125 |
| 4 | `closeMenu` | const arrow | 133 |
| 5 | `scheduleReposition` | const arrow | 134 |
| 6 | `closeIfEscape` | const arrow | 141 |

### 3.180 `frontend/src/components/shared/QuickPreferenceToggles.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ToggleButton` | function | 26 |
| 2 | `QuickPreferenceToggles` | component/function | 45 |
| 3 | `tr` | const arrow | 48 |

### 3.181 `frontend/src/components/shared/SectionSwitcher.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readStoredSection` | function | 19 |
| 2 | `SectionSwitcher` | component/function | 28 |
| 3 | `selectValue` | const arrow | 55 |

### 3.182 `frontend/src/components/shared/WriteConflictModal.tsx`

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

### 3.183 `frontend/src/components/users/permissionDefinitions.ts`

- No top-level named function/class symbols detected.

### 3.184 `frontend/src/components/users/PermissionEditor.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `parsePermissionState` | function | 11 |
| 2 | `PermissionEditor` | component/function | 25 |
| 3 | `toggle` | const arrow | 40 |

### 3.185 `frontend/src/components/users/UserDetailSheet.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `translateLabel` | function | 43 |
| 2 | `buildRowData` | function | 48 |
| 3 | `parsePermissions` | function | 60 |
| 4 | `UserDetailSheet` | component/function | 71 |

### 3.186 `frontend/src/components/users/UserProfileModal.tsx`

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

### 3.187 `frontend/src/components/users/Users.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getUsersApi` | function | 133 |
| 2 | `normalizeUsers` | function | 138 |
| 3 | `normalizeRoles` | function | 142 |
| 4 | `normalizePermissionState` | function | 146 |
| 5 | `getErrorMessage` | function | 161 |
| 6 | `clearTimeoutRef` | function | 165 |
| 7 | `ThreeDot` | function | 182 |
| 8 | `formatContactValue` | function | 225 |
| 9 | `UsersDesktopSkeletonRows` | function | 230 |
| 10 | `UsersMobileSkeletonCards` | function | 254 |
| 11 | `Users` | component/function | 268 |
| 12 | `promise` | const arrow | 336 |
| 13 | `promise` | const arrow | 374 |
| 14 | `openCreateUser` | const arrow | 498 |
| 15 | `openCreateRole` | const arrow | 528 |
| 16 | `handleSaveUser` | const arrow | 589 |
| 17 | `handleResetPassword` | const arrow | 659 |
| 18 | `handleSaveRole` | const arrow | 716 |

### 3.188 `frontend/src/components/utils-settings/AuditLog.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadCsvUtilsModule` | function | 103 |
| 2 | `isRecord` | function | 108 |
| 3 | `getErrorMessage` | function | 112 |
| 4 | `toIso` | function | 144 |
| 5 | `formatDateTime` | function | 151 |
| 6 | `formatLogTime` | function | 172 |
| 7 | `getLogEpoch` | function | 176 |
| 8 | `formatJsonPretty` | function | 183 |
| 9 | `parseLogJson` | function | 191 |
| 10 | `flattenSummaryValue` | function | 199 |
| 11 | `formatEntityName` | function | 218 |
| 12 | `readableSummary` | function | 224 |
| 13 | `normalizeFiniteIds` | function | 252 |
| 14 | `countSelectedIds` | function | 256 |
| 15 | `countActiveFlags` | function | 264 |
| 16 | `DetailRow` | function | 272 |
| 17 | `AuditLog` | component/function | 284 |
| 18 | `sessionEntryLabel` | function | 678 |

### 3.189 `frontend/src/components/utils-settings/Backup.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBackupApi` | function | 240 |
| 2 | `getErrorMessage` | function | 244 |
| 3 | `unwrapJob` | function | 248 |
| 4 | `isBackupSectionId` | function | 285 |
| 5 | `PathActionButton` | function | 334 |
| 6 | `PrimaryActionButton` | function | 346 |
| 7 | `formatElapsed` | function | 358 |
| 8 | `JobProgressCard` | function | 367 |
| 9 | `DoctorStatusPill` | function | 427 |
| 10 | `IntegrationDoctorCard` | function | 451 |
| 11 | `useCopy` | function | 557 |
| 12 | `formatDateTime` | function | 573 |
| 13 | `formatBytes` | function | 589 |
| 14 | `yieldToBrowser` | function | 598 |
| 15 | `getJobSignature` | function | 606 |
| 16 | `startJobWatcher` | function | 625 |
| 17 | `stop` | const arrow | 641 |
| 18 | `scheduleTick` | const arrow | 647 |
| 19 | `tick` | const arrow | 653 |
| 20 | `SectionChip` | function | 710 |
| 21 | `secondsToSyncMinutes` | function | 733 |
| 22 | `minutesToSyncSeconds` | function | 742 |
| 23 | `GoogleDriveSyncSection` | function | 750 |
| 24 | `handler` | const arrow | 872 |
| 25 | `savePreferences` | const arrow | 957 |
| 26 | `connectGoogleDrive` | const arrow | 987 |
| 27 | `syncNow` | const arrow | 1032 |
| 28 | `disconnect` | const arrow | 1069 |
| 29 | `forgetCredentials` | const arrow | 1094 |
| 30 | `BackupOverview` | function | 1324 |
| 31 | `Backup` | component/function | 1396 |
| 32 | `showBackupSection` | const arrow | 1412 |
| 33 | `handleFolderExport` | const arrow | 1449 |
| 34 | `handleFolderImport` | const arrow | 1518 |

### 3.190 `frontend/src/components/utils-settings/FontFamilyPicker.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `FontFamilyPicker` | component/function | 30 |

### 3.191 `frontend/src/components/utils-settings/index.ts`

- No top-level named function/class symbols detected.

### 3.192 `frontend/src/components/utils-settings/OtpModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getOtpApi` | function | 45 |
| 2 | `getErrorMessage` | function | 49 |
| 3 | `OtpModal` | component/function | 53 |
| 4 | `loadSetup` | function | 88 |

### 3.193 `frontend/src/components/utils-settings/ResetData.tsx`

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

### 3.194 `frontend/src/components/utils-settings/Settings.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getSettingsApi` | function | 132 |
| 2 | `getErrorMessage` | function | 136 |
| 3 | `toStringValue` | function | 140 |
| 4 | `toNumberValue` | function | 145 |
| 5 | `isSettingsSectionId` | function | 235 |
| 6 | `parseStoredColors` | function | 251 |
| 7 | `buildColorChoices` | function | 262 |
| 8 | `useCopy` | function | 353 |
| 9 | `getSettingsNavLabel` | function | 361 |
| 10 | `SwatchPicker` | function | 378 |
| 11 | `SettingsSection` | function | 461 |
| 12 | `Settings` | component/function | 491 |
| 13 | `showSettingsSection` | const arrow | 517 |
| 14 | `loadOtpStatus` | function | 587 |
| 15 | `loadFaviconPreview` | function | 619 |
| 16 | `scheduleIdlePreview` | const arrow | 634 |
| 17 | `setValue` | const arrow | 688 |
| 18 | `formatPreviewDateTime` | const arrow | 714 |
| 19 | `moveNavItem` | const arrow | 730 |
| 20 | `toggleMobilePinned` | const arrow | 740 |
| 21 | `movePinnedItem` | const arrow | 752 |
| 22 | `movePinnedBefore` | const arrow | 762 |
| 23 | `resetNavigationLayout` | const arrow | 774 |
| 24 | `field` | const arrow | 779 |
| 25 | `savePaymentMethods` | const arrow | 801 |
| 26 | `uploadImageSetting` | const arrow | 821 |
| 27 | `handleSaveSettings` | const arrow | 888 |

### 3.195 `frontend/src/components/utils-settings/settingsConflict.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeObject` | function | 28 |

### 3.196 `frontend/src/constants.ts`

- No top-level named function/class symbols detected.

### 3.197 `frontend/src/index.tsx`

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

### 3.198 `frontend/src/platform/runtime/clientRuntime.ts`

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

### 3.199 `frontend/src/platform/storage/storagePolicy.ts`

- No top-level named function/class symbols detected.

### 3.200 `frontend/src/public-runtime/runtime-noise-guard.ts`

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

### 3.201 `frontend/src/public-runtime/service-worker.ts`

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

### 3.202 `frontend/src/public-runtime/theme-bootstrap.ts`

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

### 3.203 `frontend/src/runtime/runtimeErrorClassifier.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `messageOf` | function | 27 |
| 2 | `stackOf` | function | 31 |
| 3 | `toText` | function | 35 |
| 4 | `includesExtensionOrigin` | function | 39 |
| 5 | `getPathname` | function | 44 |

### 3.204 `frontend/src/types/lucide-react-icons.d.ts`

- No top-level named function/class symbols detected.

### 3.205 `frontend/src/types/receiptContracts.ts`

- No top-level named function/class symbols detected.

### 3.206 `frontend/src/types/settingsContracts.ts`

- No top-level named function/class symbols detected.

### 3.207 `frontend/src/utils/actionGuards.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `hasOwn` | function | 18 |

### 3.208 `frontend/src/utils/actionHistory.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadActionHistoryTransport` | function | 83 |
| 2 | `normalizeActionHistoryId` | function | 88 |
| 3 | `normalizeEntry` | function | 94 |
| 4 | `parsePermissions` | function | 107 |
| 5 | `getErrorMessage` | function | 119 |

### 3.209 `frontend/src/utils/appRefresh.ts`

- No top-level named function/class symbols detected.

### 3.210 `frontend/src/utils/bulkOps.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `runner` | function | 47 |

### 3.211 `frontend/src/utils/color.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeHex` | function | 1 |
| 2 | `relativeLuminance` | function | 12 |

### 3.212 `frontend/src/utils/csv.ts`

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

### 3.213 `frontend/src/utils/csvExportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 20 |

### 3.214 `frontend/src/utils/csvImport.ts`

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

### 3.215 `frontend/src/utils/csvRowCounter.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `finishRecord` | const arrow | 7 |

### 3.216 `frontend/src/utils/csvTemplate.ts`

- No top-level named function/class symbols detected.

### 3.217 `frontend/src/utils/dateHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toLocalDateString` | function | 4 |

### 3.218 `frontend/src/utils/deviceInfo.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBrowserName` | function | 13 |
| 2 | `getOperatingSystemName` | function | 21 |

### 3.219 `frontend/src/utils/exportPackage.ts`

- No top-level named function/class symbols detected.

### 3.220 `frontend/src/utils/exportReports.tsx`

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

### 3.221 `frontend/src/utils/favicon.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `clamp` | function | 11 |
| 2 | `shouldUseAnonymousCors` | function | 18 |
| 3 | `loadImage` | function | 29 |

### 3.222 `frontend/src/utils/formatters.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeTimestampInput` | function | 6 |

### 3.223 `frontend/src/utils/groupedRecords.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toDate` | function | 37 |
| 2 | `normalizeName` | function | 56 |
| 3 | `compareAlphabetLabels` | function | 64 |

### 3.224 `frontend/src/utils/historyHelpers.ts`

- No top-level named function/class symbols detected.

### 3.225 `frontend/src/utils/importJobRefresh.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeImportJobStatus` | function | 24 |
| 2 | `normalizeImportJobType` | function | 28 |
| 3 | `uniqueChannels` | function | 32 |
| 4 | `dispatchSyncUpdate` | function | 41 |

### 3.226 `frontend/src/utils/index.ts`

- No top-level named function/class symbols detected.

### 3.227 `frontend/src/utils/initials.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getInitialRank` | function | 54 |

### 3.228 `frontend/src/utils/loaders.ts`

- No top-level named function/class symbols detected.

### 3.229 `frontend/src/utils/mediaUpload.ts`

- No top-level named function/class symbols detected.

### 3.230 `frontend/src/utils/mediaUploadState.ts`

- No top-level named function/class symbols detected.

### 3.231 `frontend/src/utils/permissions.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPermissionMap` | function | 3 |

### 3.232 `frontend/src/utils/pricing.ts`

- No top-level named function/class symbols detected.

### 3.233 `frontend/src/utils/printReceipt.ts`

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

### 3.234 `frontend/src/utils/productBatches.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeBranchId` | function | 26 |

### 3.235 `frontend/src/utils/productGrouping.ts`

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

### 3.236 `frontend/src/utils/publicAssetUrls.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `trimBaseUrl` | function | 11 |
| 2 | `normalizeUploadPath` | function | 15 |
| 3 | `appendAssetVersion` | function | 23 |
| 4 | `isLocalLikeHostname` | function | 38 |
| 5 | `getSafeCurrentOrigin` | function | 42 |
| 6 | `api` | const arrow | 57 |

### 3.237 `frontend/src/utils/receiptAppliedConfig.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `parseObject` | function | 67 |

### 3.238 `frontend/src/utils/scriptTypography.ts`

- No top-level named function/class symbols detected.

### 3.239 `frontend/src/utils/settingsRefresh.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeSettingKeys` | function | 62 |

### 3.240 `frontend/src/utils/settingsWriteOptions.ts`

- No top-level named function/class symbols detected.

### 3.241 `frontend/src/web-api.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `sanitizeBaseUrl` | function | 101 |
| 2 | `isPublicRuntimePath` | function | 105 |
| 3 | `getOfflineDb` | function | 111 |
| 4 | `loadMethodsModule` | function | 116 |
| 5 | `loadAppBootstrapModule` | function | 121 |
| 6 | `loadAuthTransportModule` | function | 126 |
| 7 | `loadPortalTransportModule` | function | 131 |
| 8 | `loadSystemRuntimeModule` | function | 136 |
| 9 | `loadSaleWriteTransportModule` | function | 141 |
| 10 | `loadOfflineSnapshotTransportModule` | function | 146 |
| 11 | `getLazyApiMethod` | function | 184 |
| 12 | `mapOfflineFileChunkStatusUpdates` | function | 198 |
| 13 | `asArrayBuffer` | function | 214 |
| 14 | `bytesToBase64` | function | 218 |
| 15 | `base64ToBytes` | function | 229 |
| 16 | `stableStringify` | function | 236 |
| 17 | `sha256Hex` | function | 242 |
| 18 | `deriveOfflineVaultKey` | function | 250 |
| 19 | `encryptOfflineVaultValue` | function | 267 |
| 20 | `decryptOfflineVaultValue` | function | 275 |
| 21 | `requestOfflinePersistentStorage` | function | 285 |
| 22 | `dispatchVaultLocked` | function | 292 |
| 23 | `scheduleOfflineVaultIdleLock` | function | 297 |
| 24 | `lockOfflineVault` | function | 303 |
| 25 | `unlockOfflineVault` | function | 311 |
| 26 | `queueBusinessOutboxOperation` | function | 337 |
| 27 | `queueOfflineFileChunks` | function | 374 |
| 28 | `dispatchOutboxProgress` | function | 428 |
| 29 | `dispatchOutboxFileProgress` | function | 435 |
| 30 | `dispatchOutboxConflict` | function | 442 |
| 31 | `getSyncOutboxKey` | function | 449 |
| 32 | `syncUnlockedOfflineOutbox` | function | 453 |
| 33 | `syncUnlockedOfflineFileChunks` | function | 563 |
| 34 | `refreshOfflineSnapshotSoon` | function | 625 |
| 35 | `run` | const arrow | 635 |
| 36 | `refreshServiceWorkerSoon` | function | 656 |
| 37 | `runOfflineMaintenance` | function | 666 |
| 38 | `startOfflineMaintenanceLoop` | function | 681 |
| 39 | `scheduleInitialOfflineMaintenance` | function | 689 |
| 40 | `run` | const arrow | 693 |
| 41 | `scheduleIdle` | const arrow | 697 |
| 42 | `ensureSessionRecoveryListeners` | function | 714 |
| 43 | `scheduleBootstrapStorageMaintenance` | function | 739 |
| 44 | `run` | const arrow | 745 |
| 45 | `scheduleBootstrapOfflineDbWrite` | function | 762 |
| 46 | `run` | const arrow | 768 |
| 47 | `write` | const arrow | 770 |
| 48 | `forwardServiceWorkerOutboxEvent` | function | 789 |
| 49 | `forwardServiceWorkerAppEvent` | function | 877 |

### 3.242 `ops/scripts/frontend/build-public-runtime-scripts.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toProjectPath` | function | 36 |
| 2 | `formatDiagnostic` | function | 40 |
| 3 | `transpileRuntimeScript` | function | 47 |
| 4 | `writeIfChanged` | function | 67 |
| 5 | `main` | function | 74 |

### 3.243 `ops/scripts/frontend/verify-i18n.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `collectUsedKeys` | function | 29 |
| 2 | `flattenTranslationTree` | function | 69 |
| 3 | `listMissing` | function | 83 |
| 4 | `listEmptyValues` | function | 88 |
| 5 | `printList` | function | 95 |
| 6 | `main` | function | 102 |

### 3.244 `ops/scripts/frontend/verify-performance.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `read` | function | 15 |
| 2 | `walk` | function | 19 |
| 3 | `trackedFiles` | function | 37 |
| 4 | `assert` | function | 47 |

### 3.245 `ops/scripts/frontend/verify-ui.ts`

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

### 3.246 `frontend/vite.config.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readGitRevision` | function | 11 |
| 2 | `fixCrossorigin` | function | 49 |
| 3 | `emitBuildManifest` | function | 74 |
| 4 | `shouldDeferModulePreload` | function | 207 |
| 5 | `manualChunks` | function | 211 |

### 3.247 `frontend/tailwind.config.ts`

- No top-level named function/class symbols detected.

