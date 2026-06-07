# Frontend Function Reference

Auto-generated symbol inventory for frontend files. Regenerate with `node ops/scripts/docs/generate-doc-reference.ts`.

## 1. Coverage Summary

Total files documented: **264**

## 2. Symbol Count by File

| No. | File | Symbols |
|---:|---|---:|
| 1 | `frontend/src/AdminRoot.tsx` | 1 |
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
| 21 | `frontend/src/api/httpState.ts` | 0 |
| 22 | `frontend/src/api/importJobsTransport.ts` | 5 |
| 23 | `frontend/src/api/importTransport.ts` | 0 |
| 24 | `frontend/src/api/inventoryTransport.ts` | 0 |
| 25 | `frontend/src/api/inventoryWriteTransport.ts` | 1 |
| 26 | `frontend/src/api/lazyLocalDb.ts` | 0 |
| 27 | `frontend/src/api/localDb.ts` | 1 |
| 28 | `frontend/src/api/localMirrors.ts` | 3 |
| 29 | `frontend/src/api/lookupTransport.ts` | 4 |
| 30 | `frontend/src/api/methods.ts` | 169 |
| 31 | `frontend/src/api/multipartHeaders.ts` | 0 |
| 32 | `frontend/src/api/notificationSummary.ts` | 1 |
| 33 | `frontend/src/api/offlineSnapshotTransport.ts` | 7 |
| 34 | `frontend/src/api/pendingSyncTransport.ts` | 0 |
| 35 | `frontend/src/api/portalHttp.ts` | 0 |
| 36 | `frontend/src/api/portalTransport.ts` | 2 |
| 37 | `frontend/src/api/productImageUploadTransport.ts` | 1 |
| 38 | `frontend/src/api/productReadTransport.ts` | 0 |
| 39 | `frontend/src/api/productWriteTransport.ts` | 3 |
| 40 | `frontend/src/api/query.ts` | 1 |
| 41 | `frontend/src/api/queryCache.ts` | 0 |
| 42 | `frontend/src/api/requestIds.ts` | 0 |
| 43 | `frontend/src/api/returnsTransport.ts` | 5 |
| 44 | `frontend/src/api/rfidTransport.ts` | 2 |
| 45 | `frontend/src/api/salesTransport.ts` | 4 |
| 46 | `frontend/src/api/saleWriteTransport.ts` | 16 |
| 47 | `frontend/src/api/settingsTransport.ts` | 6 |
| 48 | `frontend/src/api/syncPreview.ts` | 0 |
| 49 | `frontend/src/api/syncRuntime.ts` | 0 |
| 50 | `frontend/src/api/systemJobs.ts` | 3 |
| 51 | `frontend/src/api/systemRuntime.ts` | 0 |
| 52 | `frontend/src/api/userAdminTransport.ts` | 1 |
| 53 | `frontend/src/api/userReadTransport.ts` | 0 |
| 54 | `frontend/src/api/websocket.ts` | 8 |
| 55 | `frontend/src/App.tsx` | 85 |
| 56 | `frontend/src/app/appShellUtils.ts` | 0 |
| 57 | `frontend/src/app/pathRouting.ts` | 0 |
| 58 | `frontend/src/app/publicErrorRecovery.ts` | 1 |
| 59 | `frontend/src/AppContext.tsx` | 43 |
| 60 | `frontend/src/components/auth/Login.tsx` | 23 |
| 61 | `frontend/src/components/branches/Branches.tsx` | 15 |
| 62 | `frontend/src/components/branches/BranchForm.tsx` | 2 |
| 63 | `frontend/src/components/branches/TransferModal.tsx` | 6 |
| 64 | `frontend/src/components/catalog/catalogAssetUrls.ts` | 7 |
| 65 | `frontend/src/components/catalog/CatalogEditorSurface.tsx` | 2 |
| 66 | `frontend/src/components/catalog/CatalogImageField.tsx` | 1 |
| 67 | `frontend/src/components/catalog/catalogImages.tsx` | 5 |
| 68 | `frontend/src/components/catalog/CatalogPage.tsx` | 127 |
| 69 | `frontend/src/components/catalog/CatalogPageContext.tsx` | 0 |
| 70 | `frontend/src/components/catalog/catalogPagination.tsx` | 4 |
| 71 | `frontend/src/components/catalog/CatalogPreviewSurface.tsx` | 2 |
| 72 | `frontend/src/components/catalog/CatalogProductsSection.tsx` | 4 |
| 73 | `frontend/src/components/catalog/CatalogSecondaryTabs.tsx` | 7 |
| 74 | `frontend/src/components/catalog/catalogUi.tsx` | 1 |
| 75 | `frontend/src/components/catalog/portalCatalogDisplay.ts` | 2 |
| 76 | `frontend/src/components/catalog/portalContentI18n.ts` | 14 |
| 77 | `frontend/src/components/catalog/portalEditorUtils.ts` | 2 |
| 78 | `frontend/src/components/catalog/portalLanguageOptions.ts` | 0 |
| 79 | `frontend/src/components/catalog/portalLanguagePacks.ts` | 0 |
| 80 | `frontend/src/components/catalog/portalTranslateController.ts` | 4 |
| 81 | `frontend/src/components/catalog/portalTranslationData.ts` | 1 |
| 82 | `frontend/src/components/contacts/ContactImportModal.tsx` | 8 |
| 83 | `frontend/src/components/contacts/contactImportWorker.ts` | 1 |
| 84 | `frontend/src/components/contacts/contactOptionUtils.ts` | 3 |
| 85 | `frontend/src/components/contacts/Contacts.tsx` | 13 |
| 86 | `frontend/src/components/contacts/CustomerFormModal.tsx` | 10 |
| 87 | `frontend/src/components/contacts/customerMembershipNumber.ts` | 0 |
| 88 | `frontend/src/components/contacts/CustomersTab.tsx` | 19 |
| 89 | `frontend/src/components/contacts/DeliveryTab.tsx` | 28 |
| 90 | `frontend/src/components/contacts/shared.tsx` | 3 |
| 91 | `frontend/src/components/contacts/SuppliersTab.tsx` | 23 |
| 92 | `frontend/src/components/custom-tables/CustomTables.tsx` | 25 |
| 93 | `frontend/src/components/dashboard/charts/BarChart.tsx` | 5 |
| 94 | `frontend/src/components/dashboard/charts/DonutChart.tsx` | 1 |
| 95 | `frontend/src/components/dashboard/charts/index.ts` | 0 |
| 96 | `frontend/src/components/dashboard/charts/LineChart.tsx` | 7 |
| 97 | `frontend/src/components/dashboard/charts/NoData.tsx` | 1 |
| 98 | `frontend/src/components/dashboard/Dashboard.tsx` | 18 |
| 99 | `frontend/src/components/dashboard/dashboardExport.ts` | 16 |
| 100 | `frontend/src/components/dashboard/MiniStat.tsx` | 1 |
| 101 | `frontend/src/components/files/FilePickerModal.tsx` | 8 |
| 102 | `frontend/src/components/files/FilesPage.tsx` | 27 |
| 103 | `frontend/src/components/files/FilesProvidersTab.tsx` | 4 |
| 104 | `frontend/src/components/files/FilesResponsesTab.tsx` | 1 |
| 105 | `frontend/src/components/inventory/DualMoney.tsx` | 1 |
| 106 | `frontend/src/components/inventory/Inventory.tsx` | 31 |
| 107 | `frontend/src/components/inventory/inventoryExport.ts` | 14 |
| 108 | `frontend/src/components/inventory/InventoryImportModal.tsx` | 9 |
| 109 | `frontend/src/components/inventory/inventoryImportWorker.ts` | 1 |
| 110 | `frontend/src/components/inventory/InventoryMovementsSurface.tsx` | 1 |
| 111 | `frontend/src/components/inventory/InventoryProductsSurface.tsx` | 3 |
| 112 | `frontend/src/components/inventory/InventoryRfidSurface.tsx` | 1 |
| 113 | `frontend/src/components/inventory/movementGroups.ts` | 11 |
| 114 | `frontend/src/components/inventory/ProductDetailModal.tsx` | 2 |
| 115 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx` | 11 |
| 116 | `frontend/src/components/navigation/Sidebar.tsx` | 9 |
| 117 | `frontend/src/components/pos/CartItem.tsx` | 2 |
| 118 | `frontend/src/components/pos/FilterPanel.tsx` | 5 |
| 119 | `frontend/src/components/pos/POS.tsx` | 51 |
| 120 | `frontend/src/components/pos/posCore.ts` | 1 |
| 121 | `frontend/src/components/pos/ProductImage.tsx` | 5 |
| 122 | `frontend/src/components/pos/QuickAddModal.tsx` | 2 |
| 123 | `frontend/src/components/products/config/productPageConfig.ts` | 0 |
| 124 | `frontend/src/components/products/forms/BranchStockAdjuster.tsx` | 6 |
| 125 | `frontend/src/components/products/forms/BulkAddStockModal.tsx` | 6 |
| 126 | `frontend/src/components/products/forms/ProductForm.tsx` | 19 |
| 127 | `frontend/src/components/products/forms/VariantFormModal.tsx` | 3 |
| 128 | `frontend/src/components/products/helpers/productDisplayHelpers.ts` | 1 |
| 129 | `frontend/src/components/products/helpers/productExport.ts` | 5 |
| 130 | `frontend/src/components/products/helpers/productFilterHelpers.ts` | 2 |
| 131 | `frontend/src/components/products/helpers/productGalleryHelpers.ts` | 0 |
| 132 | `frontend/src/components/products/helpers/productGroupViewHelpers.ts` | 0 |
| 133 | `frontend/src/components/products/helpers/productMenuHelpers.ts` | 3 |
| 134 | `frontend/src/components/products/helpers/productPageHelpers.ts` | 0 |
| 135 | `frontend/src/components/products/helpers/productSelectionHelpers.ts` | 0 |
| 136 | `frontend/src/components/products/helpers/productWriteHelpers.ts` | 3 |
| 137 | `frontend/src/components/products/history/productHistoryHelpers.ts` | 0 |
| 138 | `frontend/src/components/products/import/BulkImportModal.tsx` | 51 |
| 139 | `frontend/src/components/products/import/productImportPlanner.ts` | 11 |
| 140 | `frontend/src/components/products/import/productImportWorker.ts` | 3 |
| 141 | `frontend/src/components/products/lookups/ManageBrandsModal.tsx` | 10 |
| 142 | `frontend/src/components/products/lookups/ManageCategoriesModal.tsx` | 5 |
| 143 | `frontend/src/components/products/lookups/ManageUnitsModal.tsx` | 5 |
| 144 | `frontend/src/components/products/lookups/productLookupSnapshots.ts` | 7 |
| 145 | `frontend/src/components/products/Products.tsx` | 30 |
| 146 | `frontend/src/components/products/scanning/barcodeImageScanner.ts` | 4 |
| 147 | `frontend/src/components/products/scanning/BarcodeScannerModal.tsx` | 4 |
| 148 | `frontend/src/components/products/scanning/barcodeScannerState.ts` | 0 |
| 149 | `frontend/src/components/products/scanning/cameraPermission.ts` | 3 |
| 150 | `frontend/src/components/products/scanning/scanbotScanner.ts` | 5 |
| 151 | `frontend/src/components/products/shared/primitives.tsx` | 12 |
| 152 | `frontend/src/components/products/surfaces/HeaderActions.tsx` | 2 |
| 153 | `frontend/src/components/products/surfaces/ProductDetailModal.tsx` | 3 |
| 154 | `frontend/src/components/products/surfaces/ProductRowParts.tsx` | 1 |
| 155 | `frontend/src/components/products/surfaces/ProductsListSurface.tsx` | 3 |
| 156 | `frontend/src/components/receipt-settings/AllFieldsPanel.tsx` | 4 |
| 157 | `frontend/src/components/receipt-settings/constants.ts` | 1 |
| 158 | `frontend/src/components/receipt-settings/ErrorBoundary.tsx` | 1 |
| 159 | `frontend/src/components/receipt-settings/FieldOrderManager.tsx` | 9 |
| 160 | `frontend/src/components/receipt-settings/PrintSettings.tsx` | 8 |
| 161 | `frontend/src/components/receipt-settings/ReceiptPreview.tsx` | 3 |
| 162 | `frontend/src/components/receipt-settings/ReceiptSettings.tsx` | 4 |
| 163 | `frontend/src/components/receipt-settings/template.ts` | 2 |
| 164 | `frontend/src/components/receipt/Receipt.tsx` | 12 |
| 165 | `frontend/src/components/returns/EditReturnModal.tsx` | 7 |
| 166 | `frontend/src/components/returns/NewReturnModal.tsx` | 13 |
| 167 | `frontend/src/components/returns/NewSupplierReturnModal.tsx` | 7 |
| 168 | `frontend/src/components/returns/ReturnDetailModal.tsx` | 4 |
| 169 | `frontend/src/components/returns/Returns.tsx` | 12 |
| 170 | `frontend/src/components/returns/ReturnsListSurface.tsx` | 5 |
| 171 | `frontend/src/components/sales/ExportModal.tsx` | 5 |
| 172 | `frontend/src/components/sales/SaleDetailModal.tsx` | 4 |
| 173 | `frontend/src/components/sales/Sales.tsx` | 16 |
| 174 | `frontend/src/components/sales/SalesImportModal.tsx` | 8 |
| 175 | `frontend/src/components/sales/salesImportWorker.ts` | 1 |
| 176 | `frontend/src/components/sales/SalesListSurface.tsx` | 2 |
| 177 | `frontend/src/components/sales/StatusBadge.tsx` | 2 |
| 178 | `frontend/src/components/server/ServerPage.tsx` | 21 |
| 179 | `frontend/src/components/shared/ActionHistoryBar.tsx` | 3 |
| 180 | `frontend/src/components/shared/AppSelect.tsx` | 8 |
| 181 | `frontend/src/components/shared/BackgroundImportTracker.tsx` | 21 |
| 182 | `frontend/src/components/shared/ExportMenu.tsx` | 1 |
| 183 | `frontend/src/components/shared/FilterMenu.tsx` | 4 |
| 184 | `frontend/src/components/shared/globalScroll.ts` | 3 |
| 185 | `frontend/src/components/shared/ImageGalleryLightbox.tsx` | 5 |
| 186 | `frontend/src/components/shared/LazyPortalMenu.tsx` | 1 |
| 187 | `frontend/src/components/shared/LoadingWatchdog.tsx` | 1 |
| 188 | `frontend/src/components/shared/Modal.tsx` | 1 |
| 189 | `frontend/src/components/shared/navigationConfig.ts` | 0 |
| 190 | `frontend/src/components/shared/NotificationCenter.tsx` | 9 |
| 191 | `frontend/src/components/shared/pageActivity.ts` | 0 |
| 192 | `frontend/src/components/shared/PageHeader.tsx` | 1 |
| 193 | `frontend/src/components/shared/PaginationControls.tsx` | 3 |
| 194 | `frontend/src/components/shared/PortalMenu.tsx` | 6 |
| 195 | `frontend/src/components/shared/QuickPreferenceToggles.tsx` | 3 |
| 196 | `frontend/src/components/shared/SectionSwitcher.tsx` | 3 |
| 197 | `frontend/src/components/shared/WriteConflictModal.tsx` | 10 |
| 198 | `frontend/src/components/users/permissionDefinitions.ts` | 0 |
| 199 | `frontend/src/components/users/PermissionEditor.tsx` | 3 |
| 200 | `frontend/src/components/users/UserDetailSheet.tsx` | 4 |
| 201 | `frontend/src/components/users/UserProfileModal.tsx` | 14 |
| 202 | `frontend/src/components/users/Users.tsx` | 18 |
| 203 | `frontend/src/components/utils-settings/AuditLog.tsx` | 20 |
| 204 | `frontend/src/components/utils-settings/Backup.tsx` | 34 |
| 205 | `frontend/src/components/utils-settings/FontFamilyPicker.tsx` | 1 |
| 206 | `frontend/src/components/utils-settings/index.ts` | 0 |
| 207 | `frontend/src/components/utils-settings/OtpModal.tsx` | 4 |
| 208 | `frontend/src/components/utils-settings/ResetData.tsx` | 10 |
| 209 | `frontend/src/components/utils-settings/Settings.tsx` | 27 |
| 210 | `frontend/src/components/utils-settings/settingsConflict.ts` | 1 |
| 211 | `frontend/src/constants.ts` | 0 |
| 212 | `frontend/src/index.tsx` | 12 |
| 213 | `frontend/src/platform/runtime/clientRuntime.ts` | 9 |
| 214 | `frontend/src/platform/storage/storagePolicy.ts` | 0 |
| 215 | `frontend/src/public-runtime/runtime-noise-guard.ts` | 8 |
| 216 | `frontend/src/public-runtime/service-worker.ts` | 24 |
| 217 | `frontend/src/public-runtime/theme-bootstrap.ts` | 15 |
| 218 | `frontend/src/public-web-api.ts` | 2 |
| 219 | `frontend/src/PublicCatalogRoot.tsx` | 2 |
| 220 | `frontend/src/runtime/runtimeErrorClassifier.ts` | 5 |
| 221 | `frontend/src/types/lucide-react-icons.d.ts` | 0 |
| 222 | `frontend/src/types/receiptContracts.ts` | 0 |
| 223 | `frontend/src/types/settingsContracts.ts` | 0 |
| 224 | `frontend/src/utils/actionGuards.ts` | 1 |
| 225 | `frontend/src/utils/actionHistory.ts` | 5 |
| 226 | `frontend/src/utils/appRefresh.ts` | 0 |
| 227 | `frontend/src/utils/bulkOps.ts` | 1 |
| 228 | `frontend/src/utils/color.ts` | 2 |
| 229 | `frontend/src/utils/csv.ts` | 8 |
| 230 | `frontend/src/utils/csvExportWorker.ts` | 1 |
| 231 | `frontend/src/utils/csvImport.ts` | 8 |
| 232 | `frontend/src/utils/csvRowCounter.ts` | 1 |
| 233 | `frontend/src/utils/csvTemplate.ts` | 0 |
| 234 | `frontend/src/utils/dateHelpers.ts` | 1 |
| 235 | `frontend/src/utils/deviceInfo.ts` | 2 |
| 236 | `frontend/src/utils/exportPackage.ts` | 0 |
| 237 | `frontend/src/utils/exportReports.tsx` | 8 |
| 238 | `frontend/src/utils/favicon.ts` | 3 |
| 239 | `frontend/src/utils/formatters.ts` | 1 |
| 240 | `frontend/src/utils/groupedRecords.ts` | 3 |
| 241 | `frontend/src/utils/historyHelpers.ts` | 0 |
| 242 | `frontend/src/utils/importJobRefresh.ts` | 4 |
| 243 | `frontend/src/utils/index.ts` | 0 |
| 244 | `frontend/src/utils/initials.ts` | 1 |
| 245 | `frontend/src/utils/loaders.ts` | 0 |
| 246 | `frontend/src/utils/mediaUpload.ts` | 0 |
| 247 | `frontend/src/utils/mediaUploadState.ts` | 0 |
| 248 | `frontend/src/utils/permissions.ts` | 1 |
| 249 | `frontend/src/utils/pricing.ts` | 0 |
| 250 | `frontend/src/utils/printReceipt.ts` | 35 |
| 251 | `frontend/src/utils/productBatches.ts` | 1 |
| 252 | `frontend/src/utils/productGrouping.ts` | 9 |
| 253 | `frontend/src/utils/publicAssetUrls.ts` | 6 |
| 254 | `frontend/src/utils/receiptAppliedConfig.ts` | 1 |
| 255 | `frontend/src/utils/scriptTypography.ts` | 0 |
| 256 | `frontend/src/utils/settingsRefresh.ts` | 1 |
| 257 | `frontend/src/utils/settingsWriteOptions.ts` | 0 |
| 258 | `frontend/src/web-api.ts` | 58 |
| 259 | `ops/scripts/frontend/build-public-runtime-scripts.ts` | 5 |
| 260 | `ops/scripts/frontend/verify-i18n.ts` | 6 |
| 261 | `ops/scripts/frontend/verify-performance.ts` | 4 |
| 262 | `ops/scripts/frontend/verify-ui.ts` | 11 |
| 263 | `frontend/vite.config.ts` | 7 |
| 264 | `frontend/tailwind.config.ts` | 0 |

## 3. Detailed Function Commentary

### 3.1 `frontend/src/AdminRoot.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `AdminRoot` | component/function | 6 |

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
| 1 | `normalizeFileListResult` | function | 57 |
| 2 | `appendUserAndDeviceFields` | function | 71 |
| 3 | `dataUrlToBlob` | function | 80 |
| 4 | `parseJsonResponse` | function | 87 |
| 5 | `finish` | const arrow | 122 |

### 3.20 `frontend/src/api/http.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `hasStoredAuthSession` | function | 93 |
| 2 | `isProtectedAdminHost` | function | 102 |
| 3 | `normalizeApiPath` | function | 119 |
| 4 | `getApiMismatchKey` | function | 136 |
| 5 | `dispatchApiVersionMismatch` | function | 151 |
| 6 | `logCall` | function | 230 |
| 7 | `getClientMetaHeaders` | function | 238 |
| 8 | `createApiError` | function | 242 |
| 9 | `createCloudflareAccessError` | function | 271 |
| 10 | `dispatchUnauthorized` | function | 281 |
| 11 | `dispatchRuntimeVersionMismatch` | function | 309 |
| 12 | `checkRuntimeVersionFromHealth` | function | 321 |
| 13 | `createWriteBlockedError` | function | 328 |
| 14 | `dispatchWriteBlocked` | function | 339 |
| 15 | `dispatchTransientGatewayOutage` | function | 354 |
| 16 | `getConflictRefreshChannels` | function | 420 |
| 17 | `dispatchGlobalDataRefresh` | function | 429 |
| 18 | `sleep` | function | 438 |
| 19 | `hasUsableLocalData` | function | 442 |
| 20 | `noteReadFailure` | function | 468 |
| 21 | `stableStringifyForDedupe` | function | 489 |
| 22 | `clampDedupeBody` | function | 499 |
| 23 | `methodAllowsRequestBody` | function | 511 |
| 24 | `parsed` | const arrow | 591 |
| 25 | `shouldDispatchUnauthorized` | function | 652 |
| 26 | `isConnectivityError` | function | 665 |
| 27 | `setServerHealth` | function | 693 |
| 28 | `getChannelRefreshKey` | function | 833 |
| 29 | `emitCacheRefresh` | function | 838 |
| 30 | `clearInflight` | function | 852 |
| 31 | `hasReusableInflight` | function | 857 |

### 3.21 `frontend/src/api/httpState.ts`

- No top-level named function/class symbols detected.

### 3.22 `frontend/src/api/importJobsTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `encodeId` | function | 38 |
| 2 | `getSource` | function | 42 |
| 3 | `appendDeviceFields` | function | 46 |
| 4 | `notifyImportJobActivity` | function | 53 |
| 5 | `runImportJobAction` | function | 121 |

### 3.23 `frontend/src/api/importTransport.ts`

- No top-level named function/class symbols detected.

### 3.24 `frontend/src/api/inventoryTransport.ts`

- No top-level named function/class symbols detected.

### 3.25 `frontend/src/api/inventoryWriteTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDevicePayload` | function | 7 |

### 3.26 `frontend/src/api/lazyLocalDb.ts`

- No top-level named function/class symbols detected.

### 3.27 `frontend/src/api/localDb.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `splitCSVLine` | function | 268 |

### 3.28 `frontend/src/api/localMirrors.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getLocalDbModule` | function | 13 |
| 2 | `scheduleMirrorWrite` | function | 18 |
| 3 | `idle` | const arrow | 24 |

### 3.29 `frontend/src/api/lookupTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `listLookupRows` | function | 26 |
| 2 | `createLookupRow` | function | 38 |
| 3 | `updateLookupRow` | function | 47 |
| 4 | `deleteLookupRow` | function | 60 |

### 3.30 `frontend/src/api/methods.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadPortalTransport` | function | 45 |
| 2 | `loadSaleWriteTransport` | function | 50 |
| 3 | `loadCsvTemplateModule` | function | 55 |
| 4 | `loadBrowserDialogsModule` | function | 60 |
| 5 | `loadAiTransport` | function | 65 |
| 6 | `loadActionHistoryTransport` | function | 70 |
| 7 | `loadAuditLogTransport` | function | 75 |
| 8 | `loadAuthTransport` | function | 80 |
| 9 | `loadContactsTransport` | function | 85 |
| 10 | `loadDashboardTransport` | function | 90 |
| 11 | `loadFileTransport` | function | 95 |
| 12 | `loadBranchTransport` | function | 100 |
| 13 | `loadInventoryTransport` | function | 105 |
| 14 | `loadInventoryWriteTransport` | function | 110 |
| 15 | `loadImportJobsTransport` | function | 115 |
| 16 | `loadProductWriteTransport` | function | 120 |
| 17 | `loadProductImageUploadTransport` | function | 125 |
| 18 | `loadRfidTransport` | function | 130 |
| 19 | `loadSalesTransport` | function | 135 |
| 20 | `loadSettingsTransport` | function | 140 |
| 21 | `loadOfflineSnapshotTransport` | function | 145 |
| 22 | `loadReturnsTransport` | function | 150 |
| 23 | `loadPendingSyncTransport` | function | 155 |
| 24 | `loadDriveSyncTransport` | function | 160 |
| 25 | `loadNotificationSummaryTransport` | function | 165 |
| 26 | `loadSystemJobsTransport` | function | 170 |
| 27 | `loadLookupTransport` | function | 175 |
| 28 | `loadProductReadTransport` | function | 180 |
| 29 | `loadQueryCacheModule` | function | 185 |
| 30 | `loadLocalMirrorsModule` | function | 190 |
| 31 | `loadUserAdminTransport` | function | 195 |
| 32 | `loadUserReadTransport` | function | 200 |
| 33 | `loadClientRuntimeModule` | function | 205 |
| 34 | `loadAppRefreshModule` | function | 210 |
| 35 | `loadHttpCoreModule` | function | 215 |
| 36 | `buildImportCsvTemplate` | function | 220 |
| 37 | `loadSystemRuntimeModule` | function | 252 |
| 38 | `callSystemRuntimeMethod` | function | 257 |
| 39 | `scheduleSensitiveMirrorPurge` | function | 264 |
| 40 | `run` | const arrow | 265 |
| 41 | `invalidateClientRuntimeState` | function | 303 |
| 42 | `dispatchRefreshAppData` | function | 321 |
| 43 | `login` | const arrow | 345 |
| 44 | `logout` | const arrow | 349 |
| 45 | `resetPasswordWithOtp` | const arrow | 353 |
| 46 | `requestPasswordResetEmail` | const arrow | 357 |
| 47 | `completePasswordReset` | const arrow | 361 |
| 48 | `updateSessionDuration` | const arrow | 365 |
| 49 | `getVerificationCapabilities` | const arrow | 369 |
| 50 | `getSystemConfig` | const arrow | 373 |
| 51 | `getSystemBootstrap` | const arrow | 375 |
| 52 | `getSystemDebugLog` | const arrow | 381 |
| 53 | `startGoogleOauth` | const arrow | 383 |
| 54 | `completeGoogleOauth` | const arrow | 387 |
| 55 | `unlinkGoogleOauth` | const arrow | 391 |
| 56 | `getAppBootstrap` | const arrow | 395 |
| 57 | `getOrganizationBootstrap` | const arrow | 399 |
| 58 | `searchOrganizations` | const arrow | 403 |
| 59 | `getCurrentOrganization` | const arrow | 407 |
| 60 | `getCategories` | const arrow | 424 |
| 61 | `updateCategory` | const arrow | 434 |
| 62 | `deleteCategory` | const arrow | 440 |
| 63 | `getUnits` | const arrow | 448 |
| 64 | `updateUnit` | const arrow | 458 |
| 65 | `deleteUnit` | const arrow | 464 |
| 66 | `getBranches` | const arrow | 472 |
| 67 | `getBranchSummary` | const arrow | 476 |
| 68 | `updateBranch` | const arrow | 484 |
| 69 | `deleteBranch` | const arrow | 488 |
| 70 | `getBranchStock` | const arrow | 492 |
| 71 | `getTransfers` | const arrow | 496 |
| 72 | `getBranchStockIntegrity` | const arrow | 504 |
| 73 | `getProducts` | const arrow | 514 |
| 74 | `searchProducts` | const arrow | 518 |
| 75 | `getProductBootstrap` | const arrow | 522 |
| 76 | `getProductsByIds` | const arrow | 526 |
| 77 | `getProductFilters` | const arrow | 530 |
| 78 | `getProductLookupUsage` | const arrow | 534 |
| 79 | `replaceProductLookupValues` | const arrow | 538 |
| 80 | `getPortalSubmissionsForReview` | const arrow | 586 |
| 81 | `reviewPortalSubmission` | const arrow | 590 |
| 82 | `getAiProviders` | const arrow | 595 |
| 83 | `createAiProvider` | const arrow | 599 |
| 84 | `updateAiProvider` | const arrow | 603 |
| 85 | `deleteAiProvider` | const arrow | 607 |
| 86 | `testAiProvider` | const arrow | 611 |
| 87 | `getAiResponses` | const arrow | 615 |
| 88 | `createProduct` | const arrow | 619 |
| 89 | `updateProduct` | const arrow | 623 |
| 90 | `deleteProduct` | const arrow | 627 |
| 91 | `otpSetup` | const arrow | 633 |
| 92 | `otpConfirm` | const arrow | 637 |
| 93 | `otpDisable` | const arrow | 641 |
| 94 | `otpVerify` | const arrow | 645 |
| 95 | `otpStatus` | const arrow | 649 |
| 96 | `listImportJobs` | const arrow | 669 |
| 97 | `getImportJobReview` | const arrow | 677 |
| 98 | `updateImportJobDecisions` | const arrow | 681 |
| 99 | `startImportJob` | const arrow | 689 |
| 100 | `approveImportJob` | const arrow | 693 |
| 101 | `cancelImportJob` | const arrow | 697 |
| 102 | `retryImportJob` | const arrow | 701 |
| 103 | `deleteImportJob` | const arrow | 705 |
| 104 | `getImportQueueStatus` | const arrow | 709 |
| 105 | `getFiles` | const arrow | 730 |
| 106 | `deleteFileAsset` | const arrow | 740 |
| 107 | `getActionHistory` | const arrow | 790 |
| 108 | `updateActionHistory` | const arrow | 798 |
| 109 | `getInventorySummary` | const arrow | 810 |
| 110 | `getInventoryStats` | const arrow | 814 |
| 111 | `getInventoryBootstrap` | const arrow | 818 |
| 112 | `searchInventoryProducts` | const arrow | 822 |
| 113 | `getInventoryMovements` | const arrow | 826 |
| 114 | `getInventoryReasons` | const arrow | 830 |
| 115 | `saveInventoryReasons` | const arrow | 834 |
| 116 | `getRfidStatus` | const arrow | 839 |
| 117 | `searchRfidTags` | const arrow | 847 |
| 118 | `recordRfidSessionEvents` | const arrow | 855 |
| 119 | `applyRfidSession` | const arrow | 863 |
| 120 | `getSales` | const arrow | 874 |
| 121 | `getDashboard` | const arrow | 880 |
| 122 | `getAnalytics` | const arrow | 884 |
| 123 | `getCustomers` | const arrow | 890 |
| 124 | `getCustomerPointSummaries` | const arrow | 894 |
| 125 | `updateCustomer` | const arrow | 902 |
| 126 | `deleteCustomer` | const arrow | 906 |
| 127 | `downloadCustomerTemplate` | const arrow | 914 |
| 128 | `getSuppliers` | const arrow | 920 |
| 129 | `updateSupplier` | const arrow | 928 |
| 130 | `deleteSupplier` | const arrow | 932 |
| 131 | `downloadSupplierTemplate` | const arrow | 940 |
| 132 | `getDeliveryContacts` | const arrow | 946 |
| 133 | `updateDeliveryContact` | const arrow | 954 |
| 134 | `deleteDeliveryContact` | const arrow | 958 |
| 135 | `getUsers` | const arrow | 968 |
| 136 | `updateUser` | const arrow | 976 |
| 137 | `getUserProfile` | const arrow | 980 |
| 138 | `getUserAuthMethods` | const arrow | 984 |
| 139 | `updateUserProfile` | const arrow | 988 |
| 140 | `disconnectUserAuthProvider` | const arrow | 992 |
| 141 | `changeUserPassword` | const arrow | 996 |
| 142 | `resetPassword` | const arrow | 1000 |
| 143 | `getRoles` | const arrow | 1006 |
| 144 | `updateRole` | const arrow | 1014 |
| 145 | `deleteRole` | const arrow | 1018 |
| 146 | `getAuditLogs` | const arrow | 1024 |
| 147 | `deleteAuditLogsRetention` | const arrow | 1029 |
| 148 | `getIntegrationDoctor` | const arrow | 1050 |
| 149 | `getGoogleDriveSyncStatus` | const arrow | 1075 |
| 150 | `saveGoogleDriveSyncPreferences` | const arrow | 1080 |
| 151 | `startGoogleDriveSyncOauth` | const arrow | 1085 |
| 152 | `disconnectGoogleDriveSync` | const arrow | 1090 |
| 153 | `forgetGoogleDriveSyncCredentials` | const arrow | 1095 |
| 154 | `queueGoogleDriveSyncNow` | const arrow | 1100 |
| 155 | `syncGoogleDriveNow` | const arrow | 1105 |
| 156 | `openPath` | const arrow | 1170 |
| 157 | `getReturns` | const arrow | 1174 |
| 158 | `getReturn` | const arrow | 1186 |
| 159 | `updateSaleStatus` | const arrow | 1192 |
| 160 | `attachSaleCustomer` | const arrow | 1198 |
| 161 | `getSalesExport` | const arrow | 1203 |
| 162 | `updateReturn` | const arrow | 1207 |
| 163 | `testSyncServer` | const arrow | 1214 |
| 164 | `openFolderDialog` | const arrow | 1219 |
| 165 | `getDataPath` | const arrow | 1223 |
| 166 | `getScaleMigrationStatus` | const arrow | 1225 |
| 167 | `prepareScaleMigration` | const arrow | 1227 |
| 168 | `runScaleMigration` | const arrow | 1229 |
| 169 | `browseDir` | const arrow | 1241 |

### 3.31 `frontend/src/api/multipartHeaders.ts`

- No top-level named function/class symbols detected.

### 3.32 `frontend/src/api/notificationSummary.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `buildNotificationSummaryFallback` | function | 12 |

### 3.33 `frontend/src/api/offlineSnapshotTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `canRefreshOfflineDeviceSnapshot` | function | 26 |
| 2 | `readOfflineDeviceSnapshotMeta` | function | 33 |
| 3 | `writeOfflineDeviceSnapshotMeta` | function | 42 |
| 4 | `getSettingsSnapshot` | function | 60 |
| 5 | `getReturnsSnapshot` | function | 69 |
| 6 | `runOfflineSnapshotStep` | function | 73 |
| 7 | `previousMeta` | const arrow | 93 |

### 3.34 `frontend/src/api/pendingSyncTransport.ts`

- No top-level named function/class symbols detected.

### 3.35 `frontend/src/api/portalHttp.ts`

- No top-level named function/class symbols detected.

### 3.36 `frontend/src/api/portalTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readJsonObject` | function | 18 |
| 2 | `fetchPortalJson` | function | 22 |

### 3.37 `frontend/src/api/productImageUploadTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `dataUrlToBlob` | function | 10 |

### 3.38 `frontend/src/api/productReadTransport.ts`

- No top-level named function/class symbols detected.

### 3.39 `frontend/src/api/productWriteTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDevicePayload` | function | 9 |
| 2 | `encodeId` | function | 13 |
| 3 | `ensureSupplierExists` | function | 17 |

### 3.40 `frontend/src/api/query.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `appendQueryValue` | function | 44 |

### 3.41 `frontend/src/api/queryCache.ts`

- No top-level named function/class symbols detected.

### 3.42 `frontend/src/api/requestIds.ts`

- No top-level named function/class symbols detected.

### 3.43 `frontend/src/api/returnsTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `encodeId` | function | 22 |
| 2 | `getDevicePayload` | function | 26 |
| 3 | `getResultTimestamp` | function | 30 |
| 4 | `buildReturnNumber` | function | 35 |
| 5 | `attachAttemptedReturnUpdate` | function | 39 |

### 3.44 `frontend/src/api/rfidTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDevicePayload` | function | 7 |
| 2 | `encodeId` | function | 11 |

### 3.45 `frontend/src/api/salesTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `encodeId` | function | 21 |
| 2 | `getDevicePayload` | function | 25 |
| 3 | `getResultTimestamp` | function | 29 |
| 4 | `attachAttempted` | function | 34 |

### 3.46 `frontend/src/api/saleWriteTransport.ts`

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

### 3.47 `frontend/src/api/settingsTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `asSettingsPayload` | function | 27 |
| 2 | `asSettingsConflictError` | function | 31 |
| 3 | `saveSettingsLocally` | function | 35 |
| 4 | `saveSettingsMeta` | function | 39 |
| 5 | `getServerSettings` | function | 43 |
| 6 | `saveSettingsOnce` | function | 64 |

### 3.48 `frontend/src/api/syncPreview.ts`

- No top-level named function/class symbols detected.

### 3.49 `frontend/src/api/syncRuntime.ts`

- No top-level named function/class symbols detected.

### 3.50 `frontend/src/api/systemJobs.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `wait` | function | 25 |
| 2 | `requireJobId` | function | 29 |
| 3 | `unwrapSystemJob` | function | 35 |

### 3.51 `frontend/src/api/systemRuntime.ts`

- No top-level named function/class symbols detected.

### 3.52 `frontend/src/api/userAdminTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `encodeId` | function | 8 |

### 3.53 `frontend/src/api/userReadTransport.ts`

- No top-level named function/class symbols detected.

### 3.54 `frontend/src/api/websocket.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `clearReconnectTimer` | function | 25 |
| 2 | `clearPingTimer` | function | 31 |
| 3 | `clearDeferredConnectTimer` | function | 37 |
| 4 | `hasStoredAuthSession` | function | 43 |
| 5 | `isProtectedAdminHost` | function | 52 |
| 6 | `shouldDebugWs` | function | 62 |
| 7 | `logWs` | function | 72 |
| 8 | `scheduleReconnect` | function | 212 |

### 3.55 `frontend/src/App.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `asPageModule` | function | 186 |
| 2 | `getAppShellApi` | function | 190 |
| 3 | `getConnection` | function | 194 |
| 4 | `isPageId` | function | 200 |
| 5 | `normalizePageId` | function | 204 |
| 6 | `getErrorMessage` | function | 208 |
| 7 | `getChunkErrorMessage` | function | 307 |
| 8 | `isChunkLoadError` | function | 312 |
| 9 | `createChunkTimeoutError` | function | 321 |
| 10 | `isRetryableImportError` | function | 327 |
| 11 | `importWithTimeout` | function | 335 |
| 12 | `clearRetryMarker` | function | 351 |
| 13 | `buildChunkRecoveryUrl` | function | 358 |
| 14 | `deleteStaleShellCaches` | function | 369 |
| 15 | `clearStaleShellCaches` | function | 382 |
| 16 | `triggerChunkRecoveryReload` | function | 392 |
| 17 | `reload` | const arrow | 399 |
| 18 | `createChunkReloadStallError` | function | 409 |
| 19 | `shouldRetryChunk` | function | 415 |
| 20 | `lazyWithRetry` | function | 425 |
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

### 3.56 `frontend/src/app/appShellUtils.ts`

- No top-level named function/class symbols detected.

### 3.57 `frontend/src/app/pathRouting.ts`

- No top-level named function/class symbols detected.

### 3.58 `frontend/src/app/publicErrorRecovery.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getRecoveryStorage` | function | 6 |

### 3.59 `frontend/src/AppContext.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getAppApi` | function | 193 |
| 2 | `getErrorMessage` | function | 203 |
| 3 | `flattenTranslationTree` | function | 207 |
| 4 | `safeStorageGet` | function | 339 |
| 5 | `safeStorageSet` | function | 347 |
| 6 | `safeStorageRemove` | function | 353 |
| 7 | `getStoredUserPayload` | function | 359 |
| 8 | `getStoredUserExpiry` | function | 363 |
| 9 | `clearPersistedAuthState` | function | 367 |
| 10 | `persistAuthState` | function | 380 |
| 11 | `computeSessionExpiryMs` | function | 402 |
| 12 | `readDeviceSettings` | function | 418 |
| 13 | `writeDeviceSettings` | function | 427 |
| 14 | `writeStoredSessionDuration` | function | 433 |
| 15 | `readPendingOauthLink` | function | 441 |
| 16 | `clearPendingOauthLink` | function | 455 |
| 17 | `readOauthCallbackResult` | function | 461 |
| 18 | `clearOauthCallbackResult` | function | 472 |
| 19 | `mergeSettingsWithDeviceOverrides` | function | 478 |
| 20 | `normalizeDateInput` | function | 482 |
| 21 | `buildRuntimeDescriptorFromBootstrap` | function | 500 |
| 22 | `getInitialAdminPage` | function | 529 |
| 23 | `LoadingScreen` | function | 534 |
| 24 | `AccessDenied` | function | 547 |
| 25 | `persistAutoSyncUrl` | const arrow | 636 |
| 26 | `onUpdate` | const arrow | 834 |
| 27 | `onStatus` | const arrow | 866 |
| 28 | `poll` | const arrow | 875 |
| 29 | `onError` | const arrow | 895 |
| 30 | `onWriteBlocked` | const arrow | 917 |
| 31 | `onRuntimeMismatch` | const arrow | 927 |
| 32 | `onConflict` | const arrow | 947 |
| 33 | `onUnauthorized` | const arrow | 1016 |
| 34 | `handleOtpLogin` | const arrow | 1075 |
| 35 | `handleUserUpdated` | const arrow | 1117 |
| 36 | `discoverSyncUrl` | const arrow | 1154 |
| 37 | `runStartupHealthProbe` | const arrow | 1177 |
| 38 | `loadLanguagePack` | const arrow | 1267 |
| 39 | `scheduleDeferredLanguagePack` | const arrow | 1278 |
| 40 | `runWhenIdle` | const arrow | 1279 |
| 41 | `clearCallbackUrl` | const arrow | 1583 |
| 42 | `clearPendingLink` | const arrow | 1587 |
| 43 | `run` | const arrow | 1591 |

### 3.60 `frontend/src/components/auth/Login.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getAuthApi` | function | 177 |
| 2 | `getErrorMessage` | function | 182 |
| 3 | `readPendingOauthLogin` | function | 186 |
| 4 | `clearPendingOauthLogin` | function | 200 |
| 5 | `readOauthCallbackResult` | function | 206 |
| 6 | `clearOauthCallbackResult` | function | 217 |
| 7 | `OauthButton` | function | 223 |
| 8 | `ModeBackButton` | function | 237 |
| 9 | `Login` | component/function | 250 |
| 10 | `rememberOrganization` | const arrow | 322 |
| 11 | `loadCapabilities` | const arrow | 358 |
| 12 | `bootstrap` | const arrow | 378 |
| 13 | `clearCallbackUrl` | const arrow | 457 |
| 14 | `run` | const arrow | 462 |
| 15 | `rememberedOrg` | const arrow | 517 |
| 16 | `handleLogin` | const arrow | 571 |
| 17 | `handleOtp` | const arrow | 601 |
| 18 | `handleOtpInput` | const arrow | 635 |
| 19 | `handleResetWithOtp` | const arrow | 640 |
| 20 | `handleResetWithEmail` | const arrow | 677 |
| 21 | `handleCompleteEmailReset` | const arrow | 706 |
| 22 | `handleStartOauth` | const arrow | 739 |
| 23 | `closeAuxMode` | const arrow | 787 |

### 3.61 `frontend/src/components/branches/Branches.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBranchApi` | function | 206 |
| 2 | `getErrorMessage` | function | 218 |
| 3 | `isBranchRecord` | function | 222 |
| 4 | `isTransferRecord` | function | 226 |
| 5 | `BranchStatTile` | function | 230 |
| 6 | `formatTransferDate` | function | 247 |
| 7 | `Branches` | component/function | 264 |
| 8 | `promise` | const arrow | 312 |
| 9 | `loadBranchStock` | const arrow | 462 |
| 10 | `loadMoreBranchStock` | const arrow | 483 |
| 11 | `handleSaveBranch` | const arrow | 514 |
| 12 | `handleDelete` | const arrow | 588 |
| 13 | `handleBulkDelete` | const arrow | 636 |
| 14 | `toggleSelect` | const arrow | 722 |
| 15 | `toggleSelectAll` | const arrow | 731 |

### 3.62 `frontend/src/components/branches/BranchForm.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `BranchForm` | component/function | 37 |
| 2 | `handleSave` | const arrow | 57 |

### 3.63 `frontend/src/components/branches/TransferModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getTransferApi` | function | 76 |
| 2 | `getErrorMessage` | function | 83 |
| 3 | `normalizeTransferStockRows` | function | 87 |
| 4 | `TransferModal` | component/function | 101 |
| 5 | `loadStock` | function | 165 |
| 6 | `handleTransfer` | const arrow | 213 |

### 3.64 `frontend/src/components/catalog/catalogAssetUrls.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `trimBaseUrl` | function | 9 |
| 2 | `normalizeUploadPath` | function | 13 |
| 3 | `isLocalLikeHostname` | function | 21 |
| 4 | `getSafeCurrentOrigin` | function | 25 |
| 5 | `getStoredCatalogAssetBaseUrl` | function | 37 |
| 6 | `api` | const arrow | 40 |
| 7 | `appendAssetVersion` | function | 51 |

### 3.65 `frontend/src/components/catalog/CatalogEditorSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toAiProviderOptions` | function | 118 |
| 2 | `CatalogEditorSurface` | component/function | 215 |

### 3.66 `frontend/src/components/catalog/CatalogImageField.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `CatalogImageField` | component/function | 29 |

### 3.67 `frontend/src/components/catalog/catalogImages.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getImageApi` | function | 19 |
| 2 | `isRecentlyBrokenCatalogImage` | function | 23 |
| 3 | `markBrokenCatalogImage` | function | 31 |
| 4 | `CatalogProductImage` | component/function | 36 |
| 5 | `loadImageData` | function | 78 |

### 3.68 `frontend/src/components/catalog/CatalogPage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadCatalogEditorSurface` | const arrow | 70 |
| 2 | `loadCatalogSecondaryTabs` | const arrow | 71 |
| 3 | `loadPortalTranslateControllerModule` | function | 78 |
| 4 | `loadPortalLanguagePacksModule` | function | 84 |
| 5 | `loadPortalContentI18nModule` | function | 90 |
| 6 | `getCatalogApi` | function | 244 |
| 7 | `getCatalogErrorMessage` | function | 248 |
| 8 | `createInitialUploadState` | function | 252 |
| 9 | `isTemporaryPreviewUrl` | function | 266 |
| 10 | `sanitizePersistedMediaPath` | function | 271 |
| 11 | `buildCacheBustedMediaPath` | function | 278 |
| 12 | `reduceUploadState` | function | 296 |
| 13 | `normalizePortalInitialOptions` | function | 363 |
| 14 | `normalizeCatalogOptions` | function | 372 |
| 15 | `normalizeBrandOptions` | function | 383 |
| 16 | `getAboutBlockLabel` | function | 388 |
| 17 | `withAssetVersion` | function | 394 |
| 18 | `sanitizePortalMediaValue` | function | 404 |
| 19 | `tt` | function | 414 |
| 20 | `toBoolean` | function | 428 |
| 21 | `toNumber` | function | 435 |
| 22 | `normalizePriceDisplay` | function | 442 |
| 23 | `normalizeHexColor` | function | 448 |
| 24 | `normalizeExternalUrl` | function | 454 |
| 25 | `createFaqId` | function | 470 |
| 26 | `normalizeFaqItems` | function | 474 |
| 27 | `translatedPortalText` | function | 530 |
| 28 | `translateConfiguredFaqText` | function | 536 |
| 29 | `localizeConfiguredFaqItems` | function | 543 |
| 30 | `buildFaqStarterItems` | function | 551 |
| 31 | `buildAiFaqStarterItems` | function | 560 |
| 32 | `hexToRgba` | function | 570 |
| 33 | `readPortalCache` | function | 581 |
| 34 | `writePortalCache` | function | 604 |
| 35 | `normalizePortalPath` | function | 623 |
| 36 | `isReservedPortalPath` | function | 636 |
| 37 | `getPortalTabs` | function | 640 |
| 38 | `resolvePortalActiveTab` | function | 651 |
| 39 | `buildDraft` | function | 659 |
| 40 | `applyDraft` | function | 759 |
| 41 | `getBranchQty` | function | 883 |
| 42 | `getStockStatus` | function | 890 |
| 43 | `normalizeProductGallery` | function | 901 |
| 44 | `normalizePortalProductSearch` | function | 918 |
| 45 | `buildRecommendedProductOption` | function | 922 |
| 46 | `productMatchesRecommendedSearch` | function | 932 |
| 47 | `formatDateTime` | function | 947 |
| 48 | `formatPortalPrice` | function | 955 |
| 49 | `ImageField` | function | 968 |
| 50 | `readImageFileAsDataUrl` | function | 1057 |
| 51 | `readImageFilesAsDataUrls` | function | 1066 |
| 52 | `pickImageAsDataUrl` | function | 1089 |
| 53 | `pickMultipleImagesAsDataUrls` | function | 1102 |
| 54 | `replaceVars` | function | 1115 |
| 55 | `canonicalPortalTranslateLanguage` | function | 1154 |
| 56 | `normalizeExternalTranslateTarget` | function | 1163 |
| 57 | `isFirstPartyTranslateTarget` | function | 1169 |
| 58 | `normalizePortalTranslateChoice` | function | 1176 |
| 59 | `readGoogleTranslateCookieTarget` | function | 1184 |
| 60 | `readStoredTranslateTargetLocal` | function | 1198 |
| 61 | `removePortalTranslateWidgetHostLocal` | function | 1211 |
| 62 | `isDocumentVisible` | function | 1216 |
| 63 | `sleep` | function | 1221 |
| 64 | `CatalogPage` | component/function | 1327 |
| 65 | `updateMediaUploadState` | const arrow | 1613 |
| 66 | `forgetMediaUploadState` | const arrow | 1620 |
| 67 | `loadAssistantStatus` | function | 1672 |
| 68 | `openProductGallery` | function | 1695 |
| 69 | `changeTranslateTarget` | function | 1708 |
| 70 | `isPortalLoadCurrent` | function | 1768 |
| 71 | `loadPortalEditorData` | function | 1772 |
| 72 | `refreshPortalView` | function | 1814 |
| 73 | `loadPortal` | function | 1843 |
| 74 | `ensureLink` | const arrow | 2107 |
| 75 | `renderRoundedFavicon` | const arrow | 2147 |
| 76 | `updateVisibility` | const arrow | 2224 |
| 77 | `handleScroll` | const arrow | 2254 |
| 78 | `setupExternalTranslateWidget` | function | 2298 |
| 79 | `toggleFilterValue` | function | 2411 |
| 80 | `clearPortalFilters` | function | 2419 |
| 81 | `setDraft` | function | 2427 |
| 82 | `toggleRecommendedProduct` | function | 2432 |
| 83 | `openPortalImage` | function | 2441 |
| 84 | `setAboutBlocksDraft` | function | 2452 |
| 85 | `setPromoItemsDraft` | function | 2456 |
| 86 | `getPortalMediaValue` | function | 2460 |
| 87 | `setPortalMediaValue` | function | 2474 |
| 88 | `clearPortalUploadPreview` | function | 2488 |
| 89 | `clearPortalMediaTarget` | function | 2494 |
| 90 | `uploadPortalMedia` | function | 2505 |
| 91 | `cancelPortalMediaUpload` | function | 2576 |
| 92 | `updateAboutBlock` | function | 2582 |
| 93 | `updatePromoItem` | function | 2588 |
| 94 | `addAboutBlock` | function | 2594 |
| 95 | `addPromoItem` | function | 2598 |
| 96 | `moveAboutBlockBefore` | function | 2602 |
| 97 | `removeAboutBlock` | function | 2614 |
| 98 | `movePromoItemBefore` | function | 2625 |
| 99 | `removePromoItem` | function | 2637 |
| 100 | `setFaqDraft` | function | 2648 |
| 101 | `addFaqItem` | function | 2652 |
| 102 | `mergeFaqStarterItems` | function | 2663 |
| 103 | `addFaqStarterSet` | function | 2676 |
| 104 | `addAiFaqStarterSet` | function | 2680 |
| 105 | `updateFaqItem` | function | 2684 |
| 106 | `removeFaqItem` | function | 2690 |
| 107 | `clearAssistantState` | function | 2694 |
| 108 | `uploadDraftImage` | function | 2709 |
| 109 | `uploadAboutBlockMedia` | function | 2713 |
| 110 | `uploadPromoItemMedia` | function | 2719 |
| 111 | `openFilePicker` | function | 2723 |
| 112 | `handleFilePickerSelect` | function | 2727 |
| 113 | `savePortalDraft` | function | 2755 |
| 114 | `askAssistant` | function | 2947 |
| 115 | `refreshMembershipData` | function | 2993 |
| 116 | `handleMembershipLookup` | function | 3035 |
| 117 | `addSubmissionImages` | function | 3048 |
| 118 | `handleSubmissionPaste` | function | 3058 |
| 119 | `handleSubmitShareProof` | function | 3074 |
| 120 | `handleReviewSubmission` | function | 3121 |
| 121 | `renderCatalogSection` | function | 3285 |
| 122 | `handleUploadSubmissionImages` | const arrow | 3308 |
| 123 | `handlePortalTabChange` | const arrow | 3364 |
| 124 | `renderSecondaryTabPanel` | function | 3372 |
| 125 | `renderSecondaryTabFallback` | function | 3384 |
| 126 | `renderSecondaryTabSection` | function | 3408 |
| 127 | `scrollPublicPortal` | const arrow | 3533 |

### 3.69 `frontend/src/components/catalog/CatalogPageContext.tsx`

- No top-level named function/class symbols detected.

### 3.70 `frontend/src/components/catalog/catalogPagination.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `clampCatalogPage` | function | 21 |
| 2 | `CatalogPaginationControls` | component/function | 35 |
| 3 | `commitPageDraft` | const arrow | 62 |
| 4 | `handlePageInputKeyDown` | const arrow | 73 |

### 3.71 `frontend/src/components/catalog/CatalogPreviewSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `CatalogPreviewSurface` | component/function | 113 |
| 2 | `handlePortalTabClick` | const arrow | 151 |

### 3.72 `frontend/src/components/catalog/CatalogProductsSection.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBadgeIcon` | function | 120 |
| 2 | `getBadgeToneClass` | function | 128 |
| 3 | `getProductInitial` | function | 137 |
| 4 | `CatalogProductsSection` | component/function | 145 |

### 3.73 `frontend/src/components/catalog/CatalogSecondaryTabs.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toAssistantSelectOptions` | function | 204 |
| 2 | `normalizePortalColor` | function | 275 |
| 3 | `CatalogMembershipSection` | function | 280 |
| 4 | `CatalogAboutSection` | function | 626 |
| 5 | `CatalogFaqSection` | function | 847 |
| 6 | `CatalogAiSection` | function | 901 |
| 7 | `CatalogSecondaryTabs` | component/function | 1109 |

### 3.74 `frontend/src/components/catalog/catalogUi.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `statusClass` | function | 22 |

### 3.75 `frontend/src/components/catalog/portalCatalogDisplay.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `replaceRankVars` | function | 173 |
| 2 | `normalizeRankBadgeLabel` | function | 177 |

### 3.76 `frontend/src/components/catalog/portalContentI18n.ts`

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

### 3.77 `frontend/src/components/catalog/portalEditorUtils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPlainObject` | function | 47 |
| 2 | `toTrimmedString` | function | 51 |

### 3.78 `frontend/src/components/catalog/portalLanguageOptions.ts`

- No top-level named function/class symbols detected.

### 3.79 `frontend/src/components/catalog/portalLanguagePacks.ts`

- No top-level named function/class symbols detected.

### 3.80 `frontend/src/components/catalog/portalTranslateController.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeLanguage` | function | 39 |
| 2 | `ensureLinkHint` | function | 131 |
| 3 | `initWidget` | const arrow | 216 |
| 4 | `waitForWidget` | const arrow | 233 |

### 3.81 `frontend/src/components/catalog/portalTranslationData.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPlainObject` | function | 3 |

### 3.82 `frontend/src/components/contacts/ContactImportModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getContactImportApi` | function | 115 |
| 2 | `getErrorMessage` | function | 120 |
| 3 | `countCsvDataRowsInWorker` | function | 124 |
| 4 | `cleanup` | const arrow | 136 |
| 5 | `ContactImportModal` | component/function | 156 |
| 6 | `handleDownloadTemplate` | const arrow | 228 |
| 7 | `applyContactRulePreset` | const arrow | 232 |
| 8 | `handleImport` | const arrow | 242 |

### 3.83 `frontend/src/components/contacts/contactImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.84 `frontend/src/components/contacts/contactOptionUtils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPlainRecord` | function | 24 |
| 2 | `readStringField` | function | 28 |
| 3 | `normalizeOption` | function | 45 |

### 3.85 `frontend/src/components/contacts/Contacts.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadContactReadTransportModule` | function | 95 |
| 2 | `loadCsvUtilsModule` | function | 100 |
| 3 | `getContactApi` | function | 105 |
| 4 | `getErrorMessage` | function | 113 |
| 5 | `asExportValue` | function | 117 |
| 6 | `normalizeContactExportRows` | function | 121 |
| 7 | `ContactTabFallback` | function | 152 |
| 8 | `ImportTypePicker` | function | 201 |
| 9 | `Contacts` | component/function | 241 |
| 10 | `handleExportAll` | const arrow | 259 |
| 11 | `openImportPicker` | const arrow | 348 |
| 12 | `handleTypeSelected` | const arrow | 350 |
| 13 | `handleImportDone` | const arrow | 355 |

### 3.86 `frontend/src/components/contacts/CustomerFormModal.tsx`

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

### 3.87 `frontend/src/components/contacts/customerMembershipNumber.ts`

- No top-level named function/class symbols detected.

### 3.88 `frontend/src/components/contacts/CustomersTab.tsx`

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

### 3.89 `frontend/src/components/contacts/DeliveryTab.tsx`

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

### 3.90 `frontend/src/components/contacts/shared.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toggleOne` | const arrow | 100 |
| 2 | `clearSelection` | const arrow | 111 |
| 3 | `menuContent` | const arrow | 165 |

### 3.91 `frontend/src/components/contacts/SuppliersTab.tsx`

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

### 3.92 `frontend/src/components/custom-tables/CustomTables.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadCustomTablesApi` | function | 59 |
| 2 | `getCustomTablesRequest` | function | 64 |
| 3 | `createCustomTableRequest` | function | 68 |
| 4 | `getCustomTableDataRequest` | function | 72 |
| 5 | `insertCustomRowRequest` | function | 76 |
| 6 | `updateCustomRowRequest` | function | 80 |
| 7 | `deleteCustomRowRequest` | function | 90 |
| 8 | `getErrorMessage` | function | 98 |
| 9 | `getHistoryResultId` | function | 102 |
| 10 | `formatCellValue` | function | 106 |
| 11 | `toInputValue` | function | 113 |
| 12 | `normalizeRowValue` | function | 120 |
| 13 | `normalizeCustomTable` | function | 133 |
| 14 | `parseSchema` | function | 146 |
| 15 | `normalizeRows` | function | 167 |
| 16 | `buildRowPayload` | function | 173 |
| 17 | `CustomTables` | component/function | 182 |
| 18 | `addColumn` | const arrow | 297 |
| 19 | `updateColumn` | const arrow | 304 |
| 20 | `removeColumn` | const arrow | 313 |
| 21 | `handleCreateTable` | const arrow | 320 |
| 22 | `handleSaveRow` | const arrow | 367 |
| 23 | `handleDeleteRow` | const arrow | 448 |
| 24 | `openAddRow` | const arrow | 496 |
| 25 | `openEditRow` | const arrow | 503 |

### 3.93 `frontend/src/components/dashboard/charts/BarChart.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `chartLabelsNeedYear` | function | 23 |
| 2 | `formatAxisLabel` | function | 32 |
| 3 | `BarChart` | component/function | 45 |
| 4 | `updateWidth` | const arrow | 53 |
| 5 | `yPx` | function | 89 |

### 3.94 `frontend/src/components/dashboard/charts/DonutChart.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `DonutChart` | component/function | 22 |

### 3.95 `frontend/src/components/dashboard/charts/index.ts`

- No top-level named function/class symbols detected.

### 3.96 `frontend/src/components/dashboard/charts/LineChart.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `chartLabelsNeedYear` | function | 28 |
| 2 | `formatAxisLabel` | function | 37 |
| 3 | `LineChart` | component/function | 50 |
| 4 | `updateWidth` | const arrow | 58 |
| 5 | `xPx` | function | 100 |
| 6 | `yPx` | function | 104 |
| 7 | `handleMouseMove` | const arrow | 114 |

### 3.97 `frontend/src/components/dashboard/charts/NoData.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `NoData` | component/function | 7 |

### 3.98 `frontend/src/components/dashboard/Dashboard.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDashboardApi` | function | 235 |
| 2 | `getErrorMessage` | function | 239 |
| 3 | `getDashboardFilterStorageKey` | function | 288 |
| 4 | `readDashboardFilterPrefs` | function | 293 |
| 5 | `downsampleChartRows` | function | 317 |
| 6 | `normalizeDashboardRangeId` | function | 328 |
| 7 | `normalizeDashboardGranularity` | function | 335 |
| 8 | `compactDashboardMetaParts` | function | 339 |
| 9 | `formatDashboardHourLabel` | function | 345 |
| 10 | `getSaleStatusTone` | function | 352 |
| 11 | `isDashboardSummaryPayload` | function | 359 |
| 12 | `isDashboardAnalyticsPayload` | function | 371 |
| 13 | `normalizeDashboardSummaryPayload` | function | 384 |
| 14 | `normalizeDashboardAnalyticsPayload` | function | 397 |
| 15 | `Dashboard` | component/function | 417 |
| 16 | `calcTrend` | const arrow | 727 |
| 17 | `rangeLabel` | const arrow | 771 |
| 18 | `periodShort` | const arrow | 777 |

### 3.99 `frontend/src/components/dashboard/dashboardExport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `priceCsv` | function | 91 |
| 2 | `totals` | function | 95 |
| 3 | `periodReturns` | function | 99 |
| 4 | `periodSupplierReturns` | function | 103 |
| 5 | `buildDashboardKpiRows` | function | 107 |
| 6 | `buildDashboardFormulaRows` | function | 135 |
| 7 | `buildDashboardManifestEntries` | function | 163 |
| 8 | `buildDashboardSalesRows` | function | 178 |
| 9 | `buildDashboardTopProductRows` | function | 193 |
| 10 | `buildDashboardTopCustomerRows` | function | 202 |
| 11 | `buildDashboardPaymentRows` | function | 215 |
| 12 | `buildDashboardBranchRows` | function | 223 |
| 13 | `buildDashboardLowStockRows` | function | 231 |
| 14 | `buildDashboardOutStockRows` | function | 239 |
| 15 | `buildDashboardRecentRows` | function | 247 |
| 16 | `hasDashboardExportData` | function | 258 |

### 3.100 `frontend/src/components/dashboard/MiniStat.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `MiniStat` | component/function | 13 |

### 3.101 `frontend/src/components/files/FilePickerModal.tsx`

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

### 3.102 `frontend/src/components/files/FilesPage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadFilesProvidersTab` | const arrow | 42 |
| 2 | `loadFilesResponsesTab` | const arrow | 43 |
| 3 | `getFilesApi` | function | 251 |
| 4 | `getErrorMessage` | function | 255 |
| 5 | `hasMojibake` | function | 259 |
| 6 | `sanitizeFallback` | function | 263 |
| 7 | `AssetPreview` | function | 267 |
| 8 | `AssetCardSkeleton` | function | 290 |
| 9 | `formatDateTime` | function | 316 |
| 10 | `formatFileSize` | function | 326 |
| 11 | `emptyProviderForm` | function | 334 |
| 12 | `compactTabLabel` | function | 357 |
| 13 | `getDefaultFilesPageSize` | function | 363 |
| 14 | `downloadAssetFile` | function | 368 |
| 15 | `FilesPage` | component/function | 380 |
| 16 | `handleUpload` | function | 674 |
| 17 | `handleDeleteAsset` | function | 697 |
| 18 | `toggleAssetSelection` | function | 725 |
| 19 | `toggleSelectAllAssets` | function | 736 |
| 20 | `handleCopySelectedPaths` | function | 743 |
| 21 | `handleDownloadSelected` | function | 758 |
| 22 | `handleDeleteSelectedAssets` | function | 766 |
| 23 | `startCreateProvider` | function | 812 |
| 24 | `startEditProvider` | function | 828 |
| 25 | `saveProvider` | function | 853 |
| 26 | `testProvider` | function | 937 |
| 27 | `removeProvider` | function | 958 |

### 3.103 `frontend/src/components/files/FilesProvidersTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toProviderSelectOptions` | function | 47 |
| 2 | `toProviderTypeOptions` | function | 51 |
| 3 | `ProviderStatus` | function | 130 |
| 4 | `FilesProvidersTab` | component/function | 141 |

### 3.104 `frontend/src/components/files/FilesResponsesTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `FilesResponsesTab` | component/function | 64 |

### 3.105 `frontend/src/components/inventory/DualMoney.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `DualMoney` | component/function | 8 |

### 3.106 `frontend/src/components/inventory/Inventory.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadBranchTransport` | function | 212 |
| 2 | `loadDashboardTransport` | function | 217 |
| 3 | `loadInventoryTransport` | function | 222 |
| 4 | `loadInventoryWriteTransport` | function | 227 |
| 5 | `loadProductReadTransport` | function | 232 |
| 6 | `loadReturnsTransport` | function | 237 |
| 7 | `loadRfidTransport` | function | 242 |
| 8 | `loadUserReadTransport` | function | 247 |
| 9 | `loadInventoryExportModule` | function | 252 |
| 10 | `getInventoryApi` | function | 257 |
| 11 | `normalizeFiniteIds` | function | 307 |
| 12 | `countActiveFlags` | function | 311 |
| 13 | `countSelectedIds` | function | 319 |
| 14 | `buildDestinationProductOptions` | function | 327 |
| 15 | `limitInventorySectionsForMobile` | function | 340 |
| 16 | `parseInventoryTimestamp` | function | 367 |
| 17 | `InventoryDiscountBadge` | function | 381 |
| 18 | `InventoryBatchPreview` | function | 392 |
| 19 | `label` | const arrow | 404 |
| 20 | `Inventory` | component/function | 457 |
| 21 | `promise` | const arrow | 706 |
| 22 | `loadInventoryBootstrap` | const arrow | 744 |
| 23 | `handleAdjust` | const arrow | 1147 |
| 24 | `openAdjust` | const arrow | 1229 |
| 25 | `openMove` | const arrow | 1236 |
| 26 | `openTransfer` | const arrow | 1259 |
| 27 | `handleMoveStock` | const arrow | 1314 |
| 28 | `handleTransferStock` | const arrow | 1387 |
| 29 | `syncViewport` | const arrow | 1551 |
| 30 | `statsValue` | const arrow | 2172 |
| 31 | `selectInventorySection` | const arrow | 2898 |

### 3.107 `frontend/src/components/inventory/inventoryExport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadInventoryExportTools` | function | 57 |
| 2 | `priceCsv` | function | 72 |
| 3 | `parseExportTimestamp` | function | 76 |
| 4 | `getMovementActivityRows` | function | 90 |
| 5 | `getMovementVolumeRows` | function | 108 |
| 6 | `getStockStatusRows` | function | 126 |
| 7 | `getTopStockValueRows` | function | 134 |
| 8 | `getBranchComparisonRows` | function | 147 |
| 9 | `buildInventoryStatsRows` | function | 171 |
| 10 | `buildInventoryFormulaRows` | function | 205 |
| 11 | `buildMovementFilterRows` | function | 246 |
| 12 | `buildInventoryExportContextRows` | function | 261 |
| 13 | `buildMovementRows` | function | 281 |
| 14 | `buildInventoryProductRows` | function | 295 |

### 3.108 `frontend/src/components/inventory/InventoryImportModal.tsx`

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

### 3.109 `frontend/src/components/inventory/inventoryImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.110 `frontend/src/components/inventory/InventoryMovementsSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `InventoryMovementsSurface` | component/function | 143 |

### 3.111 `frontend/src/components/inventory/InventoryProductsSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `InventoryProductsSurface` | component/function | 103 |
| 2 | `renderDesktopTableHead` | const arrow | 142 |
| 3 | `renderDesktopLoadingShell` | const arrow | 164 |

### 3.112 `frontend/src/components/inventory/InventoryRfidSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `InventoryRfidSurface` | component/function | 55 |

### 3.113 `frontend/src/components/inventory/movementGroups.ts`

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

### 3.114 `frontend/src/components/inventory/ProductDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBranchStockKey` | function | 61 |
| 2 | `ProductDetailModal` | component/function | 65 |

### 3.115 `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getPortalTransport` | function | 191 |
| 2 | `lookupLoyaltyPortalMembership` | function | 196 |
| 3 | `toCustomerPointRows` | function | 201 |
| 4 | `getErrorMessage` | function | 205 |
| 5 | `sanitizeInteger` | function | 209 |
| 6 | `sanitizeKhr` | function | 214 |
| 7 | `formatLookupValue` | function | 220 |
| 8 | `normalizeLoyaltySection` | function | 224 |
| 9 | `LoyaltyPointsPage` | component/function | 228 |
| 10 | `handleSave` | function | 337 |
| 11 | `handleLookup` | function | 361 |

### 3.116 `frontend/src/components/navigation/Sidebar.tsx`

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

### 3.117 `frontend/src/components/pos/CartItem.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `translate` | function | 42 |
| 2 | `CartItem` | component/function | 46 |

### 3.118 `frontend/src/components/pos/FilterPanel.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `countActiveFlags` | function | 47 |
| 2 | `SectionLabel` | function | 55 |
| 3 | `POSFilterPanel` | component/function | 66 |
| 4 | `clearAll` | const arrow | 100 |
| 5 | `chip` | const arrow | 109 |

### 3.119 `frontend/src/components/pos/POS.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getPosStatusLabel` | function | 106 |
| 2 | `loadContactOptionUtilsModule` | function | 112 |
| 3 | `parseContactOptions` | function | 143 |
| 4 | `isPlainRecord` | function | 334 |
| 5 | `normalizeCategory` | function | 338 |
| 6 | `loadPosProductBootstrap` | function | 353 |
| 7 | `searchPosCatalogProducts` | function | 357 |
| 8 | `loadPosProductFilters` | function | 361 |
| 9 | `loadPosCategories` | function | 365 |
| 10 | `getContactReadTransport` | function | 374 |
| 11 | `getContactWriteTransport` | function | 379 |
| 12 | `getPortalTransport` | function | 384 |
| 13 | `getSaleWriteTransport` | function | 389 |
| 14 | `loadPosCustomers` | function | 394 |
| 15 | `loadPosDeliveryContacts` | function | 399 |
| 16 | `createPosCustomer` | function | 404 |
| 17 | `createPosDeliveryContact` | function | 409 |
| 18 | `lookupPosPortalMembership` | function | 414 |
| 19 | `createPosSale` | function | 419 |
| 20 | `normalizeOrder` | function | 424 |
| 21 | `getErrorMessage` | function | 435 |
| 22 | `asText` | function | 439 |
| 23 | `asNumber` | function | 443 |
| 24 | `allTermsMatch` | function | 447 |
| 25 | `ProductDiscountBadge` | function | 461 |
| 26 | `POS` | component/function | 481 |
| 27 | `setPersistedCat` | const arrow | 512 |
| 28 | `setPersistedBrand` | const arrow | 513 |
| 29 | `setPersistedBranch` | const arrow | 514 |
| 30 | `setPersistedStock` | const arrow | 515 |
| 31 | `setPersistedGroup` | const arrow | 516 |
| 32 | `setPersistedSupplier` | const arrow | 517 |
| 33 | `setPersistedInitial` | const arrow | 518 |
| 34 | `addNewOrder` | const arrow | 579 |
| 35 | `closeOrder` | const arrow | 591 |
| 36 | `promise` | const arrow | 733 |
| 37 | `selectCustomer` | const arrow | 1064 |
| 38 | `applyCustomerOption` | const arrow | 1112 |
| 39 | `clearCustomer` | const arrow | 1126 |
| 40 | `handleAddCustomer` | const arrow | 1134 |
| 41 | `selectDelivery` | const arrow | 1171 |
| 42 | `clearDelivery` | const arrow | 1176 |
| 43 | `handleAddDelivery` | const arrow | 1178 |
| 44 | `addToCart` | function | 1403 |
| 45 | `updateQty` | const arrow | 1442 |
| 46 | `updatePrice` | const arrow | 1450 |
| 47 | `updateItemBranch` | const arrow | 1474 |
| 48 | `handleDiscountUsd` | const arrow | 1543 |
| 49 | `handleDiscountKhr` | const arrow | 1544 |
| 50 | `handleMembershipUnits` | const arrow | 1545 |
| 51 | `handleCheckout` | const arrow | 1584 |

### 3.120 `frontend/src/components/pos/posCore.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeNumber` | function | 48 |

### 3.121 `frontend/src/components/pos/ProductImage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getImageApi` | function | 17 |
| 2 | `isRecentlyBrokenProductImage` | function | 21 |
| 3 | `markBrokenProductImage` | function | 29 |
| 4 | `ProductImage` | component/function | 34 |
| 5 | `loadImageData` | function | 71 |

### 3.122 `frontend/src/components/pos/QuickAddModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `QuickAddModal` | component/function | 12 |
| 2 | `T` | const arrow | 13 |

### 3.123 `frontend/src/components/products/config/productPageConfig.ts`

- No top-level named function/class symbols detected.

### 3.124 `frontend/src/components/products/forms/BranchStockAdjuster.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getProductApi` | function | 73 |
| 2 | `parseStockDelta` | function | 77 |
| 3 | `BranchStockAdjuster` | component/function | 82 |
| 4 | `T` | const arrow | 103 |
| 5 | `setRow` | const arrow | 109 |
| 6 | `handleSave` | const arrow | 115 |

### 3.125 `frontend/src/components/products/forms/BulkAddStockModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getProductApi` | function | 69 |
| 2 | `parsePositiveQuantity` | function | 73 |
| 3 | `normalizeBranchId` | function | 78 |
| 4 | `normalizeProductId` | function | 84 |
| 5 | `BulkAddStockModal` | component/function | 89 |
| 6 | `handleSave` | const arrow | 109 |

### 3.126 `frontend/src/components/products/forms/ProductForm.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadContactsTransportModule` | function | 186 |
| 2 | `loadProductImageUploadTransportModule` | function | 191 |
| 3 | `getErrorMessage` | function | 198 |
| 4 | `normalizeGallery` | function | 202 |
| 5 | `editablePrice` | function | 218 |
| 6 | `pickImageFiles` | function | 223 |
| 7 | `ProductForm` | component/function | 242 |
| 8 | `loadSuppliers` | function | 423 |
| 9 | `setField` | function | 448 |
| 10 | `setNumericField` | function | 452 |
| 11 | `addImages` | function | 456 |
| 12 | `addPhoto` | function | 461 |
| 13 | `uploadPickedImages` | function | 466 |
| 14 | `removeImage` | function | 511 |
| 15 | `setPrimaryImage` | function | 515 |
| 16 | `saveForm` | function | 525 |
| 17 | `openScanner` | function | 576 |
| 18 | `closeScanner` | function | 581 |
| 19 | `applyScannedValue` | function | 585 |

### 3.127 `frontend/src/components/products/forms/VariantFormModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getProductVariantApi` | function | 105 |
| 2 | `getErrorMessage` | function | 109 |
| 3 | `VariantFormModal` | component/function | 113 |

### 3.128 `frontend/src/components/products/helpers/productDisplayHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toNumber` | function | 57 |

### 3.129 `frontend/src/components/products/helpers/productExport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toNumber` | function | 49 |
| 2 | `getImageGallery` | function | 54 |
| 3 | `toImageName` | const arrow | 59 |
| 4 | `toImageUrl` | const arrow | 60 |
| 5 | `priceCsv` | const arrow | 61 |

### 3.130 `frontend/src/components/products/helpers/productFilterHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toNumber` | function | 43 |
| 2 | `normalizeFilterValue` | function | 48 |

### 3.131 `frontend/src/components/products/helpers/productGalleryHelpers.ts`

- No top-level named function/class symbols detected.

### 3.132 `frontend/src/components/products/helpers/productGroupViewHelpers.ts`

- No top-level named function/class symbols detected.

### 3.133 `frontend/src/components/products/helpers/productMenuHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `asString` | function | 85 |
| 2 | `normalizeOptionValue` | function | 89 |
| 3 | `safeFilterLabel` | function | 93 |

### 3.134 `frontend/src/components/products/helpers/productPageHelpers.ts`

- No top-level named function/class symbols detected.

### 3.135 `frontend/src/components/products/helpers/productSelectionHelpers.ts`

- No top-level named function/class symbols detected.

### 3.136 `frontend/src/components/products/helpers/productWriteHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toFiniteNumber` | function | 123 |
| 2 | `hasBulkFormValue` | function | 128 |
| 3 | `stringOrEmpty` | function | 132 |

### 3.137 `frontend/src/components/products/history/productHistoryHelpers.ts`

- No top-level named function/class symbols detected.

### 3.138 `frontend/src/components/products/import/BulkImportModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getProductImportApi` | function | 251 |
| 2 | `getErrorMessage` | function | 255 |
| 3 | `getBaseName` | function | 259 |
| 4 | `analyzeProductCsvInWorker` | function | 267 |
| 5 | `runFallbackAnalysis` | const arrow | 276 |
| 6 | `cleanup` | const arrow | 288 |
| 7 | `complete` | const arrow | 296 |
| 8 | `getIncomingImageFilenames` | function | 345 |
| 9 | `getExistingImageFilenames` | function | 378 |
| 10 | `csvEscape` | function | 407 |
| 11 | `compactImportValue` | function | 437 |
| 12 | `isBlankImportValue` | function | 442 |
| 13 | `hasPriceReviewIssue` | function | 446 |
| 14 | `getProductImportIssueLabel` | function | 451 |
| 15 | `getProductImportIssueHint` | function | 460 |
| 16 | `getProductImportRowIssueDetails` | function | 468 |
| 17 | `valuesDiffer` | function | 523 |
| 18 | `normalizeImageMatchKey` | function | 527 |
| 19 | `getImageReference` | function | 540 |
| 20 | `findImageReferenceForRow` | function | 549 |
| 21 | `getDecisionLabel` | function | 560 |
| 22 | `getFamilyKeyForRow` | function | 564 |
| 23 | `summarizeRowNumbers` | function | 568 |
| 24 | `summarizeSubgroup` | function | 575 |
| 25 | `getImportActionTargetSummary` | function | 580 |
| 26 | `createFamilyContextEntry` | function | 613 |
| 27 | `buildVisibleFamilyRows` | function | 634 |
| 28 | `InlineImportDetailGrid` | function | 653 |
| 29 | `buildImageOnlyCsv` | function | 694 |
| 30 | `getBrowserImageEntries` | function | 712 |
| 31 | `BulkImportModal` | component/function | 721 |
| 32 | `resetCsvState` | const arrow | 852 |
| 33 | `pickImageDirectory` | const arrow | 880 |
| 34 | `pickImageZip` | const arrow | 905 |
| 35 | `addLibraryImages` | const arrow | 919 |
| 36 | `handleCancelCurrentJob` | const arrow | 1003 |
| 37 | `handleRetryCurrentJob` | const arrow | 1024 |
| 38 | `handleDeleteCurrentJob` | const arrow | 1048 |
| 39 | `handleImageOnlyImport` | const arrow | 1075 |
| 40 | `handlePickCSV` | const arrow | 1170 |
| 41 | `handleImport` | const arrow | 1234 |
| 42 | `toggleFamilyCollapse` | const arrow | 1484 |
| 43 | `toggleInlineDetails` | const arrow | 1493 |
| 44 | `toggleConflictSelection` | const arrow | 1502 |
| 45 | `toggleSelectAllConflicts` | const arrow | 1511 |
| 46 | `applyDecisionToSelection` | const arrow | 1519 |
| 47 | `applyImageDecisionToSelection` | const arrow | 1529 |
| 48 | `applyIdentifierDecisionToSelection` | const arrow | 1546 |
| 49 | `applyFieldRulePreset` | const arrow | 1558 |
| 50 | `renderConflictRow` | const arrow | 1571 |
| 51 | `updateEditedRow` | const arrow | 1579 |

### 3.139 `frontend/src/components/products/import/productImportPlanner.ts`

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

### 3.140 `frontend/src/components/products/import/productImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `post` | function | 39 |
| 2 | `waitForNextTask` | function | 43 |
| 3 | `getErrorMessage` | function | 49 |

### 3.141 `frontend/src/components/products/lookups/ManageBrandsModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBrandApi` | function | 116 |
| 2 | `getErrorMessage` | function | 120 |
| 3 | `parseBrandOptions` | function | 124 |
| 4 | `parseBrandColorMap` | function | 137 |
| 5 | `toTitleCase` | function | 152 |
| 6 | `getBrandReviewRule` | function | 160 |
| 7 | `hasActiveBrandUsage` | function | 164 |
| 8 | `getBrandSortScore` | function | 170 |
| 9 | `buildSavedLibrary` | function | 176 |
| 10 | `ManageBrandsModal` | component/function | 198 |

### 3.142 `frontend/src/components/products/lookups/ManageCategoriesModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getCategoryApi` | function | 106 |
| 2 | `getErrorMessage` | function | 110 |
| 3 | `normalizeCategoryRows` | function | 114 |
| 4 | `mergeCategoryUsage` | function | 129 |
| 5 | `ManageCategoriesModal` | component/function | 158 |

### 3.143 `frontend/src/components/products/lookups/ManageUnitsModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getUnitApi` | function | 106 |
| 2 | `getErrorMessage` | function | 110 |
| 3 | `normalizeUnitRows` | function | 114 |
| 4 | `mergeUnitUsage` | function | 129 |
| 5 | `ManageUnitsModal` | component/function | 158 |

### 3.144 `frontend/src/components/products/lookups/productLookupSnapshots.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getFallbackApiClient` | function | 57 |
| 2 | `normalizeProductRows` | function | 63 |
| 3 | `getPayloadNumber` | function | 70 |
| 4 | `snapshotLookupProducts` | function | 75 |
| 5 | `mergeUniqueSnapshots` | function | 89 |
| 6 | `fetchLookupProductSnapshotsForName` | function | 113 |
| 7 | `fetchProductsByIds` | function | 165 |

### 3.145 `frontend/src/components/products/Products.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadProductReadModule` | function | 349 |
| 2 | `loadProductWriteModule` | function | 354 |
| 3 | `loadLookupModule` | function | 359 |
| 4 | `loadBranchModule` | function | 364 |
| 5 | `loadInventoryWriteModule` | function | 369 |
| 6 | `loadProductImageUploadModule` | function | 374 |
| 7 | `getProductApi` | function | 406 |
| 8 | `getErrorMessage` | function | 410 |
| 9 | `isObjectRecord` | function | 414 |
| 10 | `toProductApiResponse` | function | 418 |
| 11 | `scrollNodeWithOffset` | function | 422 |
| 12 | `summarizeProductRun` | function | 428 |
| 13 | `aggregateProductInitials` | function | 432 |
| 14 | `toModalProduct` | function | 443 |
| 15 | `toVariantParentProduct` | function | 455 |
| 16 | `toLightboxState` | function | 461 |
| 17 | `Products` | component/function | 471 |
| 18 | `promise` | const arrow | 568 |
| 19 | `handleSave` | const arrow | 828 |
| 20 | `handleSaveWithGallery` | const arrow | 878 |
| 21 | `handleBulkDelete` | const arrow | 945 |
| 22 | `handleBulkOutOfStock` | const arrow | 992 |
| 23 | `handleBulkChangeBranch` | const arrow | 1035 |
| 24 | `handleBulkAddStock` | const arrow | 1065 |
| 25 | `toggleSelect` | const arrow | 1073 |
| 26 | `toggleSelectAll` | const arrow | 1080 |
| 27 | `handleDelete` | const arrow | 1087 |
| 28 | `renderUnitChip` | const arrow | 1174 |
| 29 | `openLightbox` | const arrow | 1188 |
| 30 | `getStockBadge` | const arrow | 1195 |

### 3.146 `frontend/src/components/products/scanning/barcodeImageScanner.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readFileAsDataUrl` | function | 37 |
| 2 | `createImageElement` | function | 62 |
| 3 | `loadImageSource` | function | 66 |
| 4 | `detectWithNativeBarcodeDetector` | function | 75 |

### 3.147 `frontend/src/components/products/scanning/BarcodeScannerModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getNativeBarcodeDetector` | function | 100 |
| 2 | `getScanErrorText` | function | 107 |
| 3 | `stopStream` | function | 112 |
| 4 | `BarcodeScannerModal` | component/function | 118 |

### 3.148 `frontend/src/components/products/scanning/barcodeScannerState.ts`

- No top-level named function/class symbols detected.

### 3.149 `frontend/src/components/products/scanning/cameraPermission.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeCameraPermissionState` | function | 9 |
| 2 | `queryCameraPermission` | function | 16 |
| 3 | `handleChange` | const arrow | 35 |

### 3.150 `frontend/src/components/products/scanning/scanbotScanner.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `publicBasePath` | const arrow | 37 |
| 2 | `getScanbotGlobal` | function | 49 |
| 3 | `normalizeScanbotError` | function | 68 |
| 4 | `loadScanbotScript` | function | 82 |
| 5 | `getInitializedScanbot` | function | 135 |

### 3.151 `frontend/src/components/products/shared/primitives.tsx`

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

### 3.152 `frontend/src/components/products/surfaces/HeaderActions.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductsHeaderActions` | component/function | 22 |
| 2 | `tr` | const arrow | 32 |

### 3.153 `frontend/src/components/products/surfaces/ProductDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductDetailModal` | component/function | 79 |
| 2 | `T` | const arrow | 95 |
| 3 | `Row` | const arrow | 121 |

### 3.154 `frontend/src/components/products/surfaces/ProductRowParts.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `label` | const arrow | 104 |

### 3.155 `frontend/src/components/products/surfaces/ProductsListSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductsListSurface` | component/function | 62 |
| 2 | `renderDesktopTableHead` | const arrow | 105 |
| 3 | `renderDesktopLoadingShell` | const arrow | 134 |

### 3.156 `frontend/src/components/receipt-settings/AllFieldsPanel.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Toggle` | function | 30 |
| 2 | `AllFieldsPanel` | component/function | 46 |
| 3 | `T` | const arrow | 49 |
| 4 | `toggleSection` | const arrow | 68 |

### 3.157 `frontend/src/components/receipt-settings/constants.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `T` | const arrow | 110 |

### 3.158 `frontend/src/components/receipt-settings/ErrorBoundary.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatError` | function | 11 |

### 3.159 `frontend/src/components/receipt-settings/FieldOrderManager.tsx`

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

### 3.160 `frontend/src/components/receipt-settings/PrintSettings.tsx`

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

### 3.161 `frontend/src/components/receipt-settings/ReceiptPreview.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatLoadError` | function | 34 |
| 2 | `ReceiptPreview` | component/function | 39 |
| 3 | `loadPreview` | function | 50 |

### 3.162 `frontend/src/components/receipt-settings/ReceiptSettings.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 80 |
| 2 | `Section` | function | 85 |
| 3 | `Toggle` | function | 96 |
| 4 | `ReceiptSettings` | component/function | 111 |

### 3.163 `frontend/src/components/receipt-settings/template.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isRecord` | function | 6 |
| 2 | `parseTemplateInput` | function | 10 |

### 3.164 `frontend/src/components/receipt/Receipt.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadReceiptPrintModule` | function | 108 |
| 2 | `toNumber` | function | 113 |
| 3 | `stripEmoji` | function | 118 |
| 4 | `stripEmoji` | function | 120 |
| 5 | `displayAddress` | function | 125 |
| 6 | `parseItems` | function | 134 |
| 7 | `getErrorMessage` | function | 145 |
| 8 | `getReceiptPaperWidthMm` | function | 149 |
| 9 | `labelFor` | function | 217 |
| 10 | `Row` | function | 222 |
| 11 | `Receipt` | component/function | 234 |
| 12 | `exportReceiptPdf` | const arrow | 450 |

### 3.165 `frontend/src/components/returns/EditReturnModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getReturnApi` | function | 91 |
| 2 | `toNumber` | function | 96 |
| 3 | `clampReturnQuantity` | function | 101 |
| 4 | `isWriteConflict` | function | 107 |
| 5 | `EditReturnModal` | component/function | 112 |
| 6 | `updateQty` | const arrow | 145 |
| 7 | `updateRestock` | const arrow | 148 |

### 3.166 `frontend/src/components/returns/NewReturnModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getReturnApi` | function | 120 |
| 2 | `toNumber` | function | 125 |
| 3 | `clampReturnQuantity` | function | 130 |
| 4 | `getSaleItemKey` | function | 136 |
| 5 | `NewReturnModal` | component/function | 140 |
| 6 | `handleSearch` | const arrow | 173 |
| 7 | `handleReturnTypeChange` | const arrow | 238 |
| 8 | `toggleIncluded` | const arrow | 243 |
| 9 | `updateItemQty` | const arrow | 251 |
| 10 | `updateItemRestock` | const arrow | 259 |
| 11 | `selectAll` | const arrow | 263 |
| 12 | `clearAll` | const arrow | 266 |
| 13 | `handleSubmit` | const arrow | 273 |

### 3.167 `frontend/src/components/returns/NewSupplierReturnModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isSupplierReturnItem` | function | 89 |
| 2 | `getSupplierReturnApi` | function | 93 |
| 3 | `NewSupplierReturnModal` | component/function | 102 |
| 4 | `loadSetup` | function | 139 |
| 5 | `loadInventory` | function | 190 |
| 6 | `updateQty` | const arrow | 278 |
| 7 | `submit` | const arrow | 284 |

### 3.168 `frontend/src/components/returns/ReturnDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeScope` | function | 52 |
| 2 | `coerceMoney` | function | 56 |
| 3 | `isPositiveMoney` | function | 60 |
| 4 | `ReturnDetailModal` | component/function | 64 |

### 3.169 `frontend/src/components/returns/Returns.tsx`

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

### 3.170 `frontend/src/components/returns/ReturnsListSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `detectMobileViewport` | function | 71 |
| 2 | `ReturnsDesktopSkeletonRows` | function | 76 |
| 3 | `ReturnsMobileSkeletonCards` | function | 93 |
| 4 | `ReturnsListSurface` | component/function | 113 |
| 5 | `apply` | const arrow | 144 |

### 3.171 `frontend/src/components/sales/ExportModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getSalesExportApi` | function | 71 |
| 2 | `getErrorMessage` | function | 76 |
| 3 | `ExportModal` | component/function | 80 |
| 4 | `handlePreview` | const arrow | 154 |
| 5 | `handleExportCSV` | const arrow | 172 |

### 3.172 `frontend/src/components/sales/SaleDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toNumber` | function | 74 |
| 2 | `InfoBlock` | function | 79 |
| 3 | `parseItems` | function | 95 |
| 4 | `SaleDetailModal` | component/function | 106 |

### 3.173 `frontend/src/components/sales/Sales.tsx`

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

### 3.174 `frontend/src/components/sales/SalesImportModal.tsx`

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

### 3.175 `frontend/src/components/sales/salesImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.176 `frontend/src/components/sales/SalesListSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getSaleItems` | function | 67 |
| 2 | `SalesListSurface` | component/function | 71 |

### 3.177 `frontend/src/components/sales/StatusBadge.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isSaleStatus` | function | 24 |
| 2 | `StatusBadge` | component/function | 50 |

### 3.178 `frontend/src/components/server/ServerPage.tsx`

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

### 3.179 `frontend/src/components/shared/ActionHistoryBar.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatHistoryList` | function | 51 |
| 2 | `formatServerStatus` | function | 55 |
| 3 | `ActionHistoryBar` | component/function | 62 |

### 3.180 `frontend/src/components/shared/AppSelect.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `optionValue` | function | 26 |
| 2 | `AppSelect` | component/function | 30 |
| 3 | `scheduleReposition` | const arrow | 80 |
| 4 | `closeIfOutside` | const arrow | 87 |
| 5 | `closeIfEscape` | const arrow | 93 |
| 6 | `chooseOption` | const arrow | 115 |
| 7 | `moveActive` | const arrow | 121 |
| 8 | `handleKeyDown` | const arrow | 131 |

### 3.181 `frontend/src/components/shared/BackgroundImportTracker.tsx`

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

### 3.182 `frontend/src/components/shared/ExportMenu.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ExportMenu` | component/function | 17 |

### 3.183 `frontend/src/components/shared/FilterMenu.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `sectionButtonClass` | function | 56 |
| 2 | `getSectionFallbackLabel` | function | 62 |
| 3 | `resolveSectionLabel` | function | 73 |
| 4 | `FilterMenu` | component/function | 82 |

### 3.184 `frontend/src/components/shared/globalScroll.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDocumentLike` | function | 21 |
| 2 | `getPageScrollCandidates` | function | 25 |
| 3 | `isVisibleScrollNode` | function | 38 |

### 3.185 `frontend/src/components/shared/ImageGalleryLightbox.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ImageGalleryLightbox` | component/function | 31 |
| 2 | `formatLabel` | function | 53 |
| 3 | `setIndex` | function | 57 |
| 4 | `renderGalleryImage` | function | 63 |
| 5 | `onKeyDown` | function | 70 |

### 3.186 `frontend/src/components/shared/LazyPortalMenu.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `LazyPortalMenu` | component/function | 7 |

### 3.187 `frontend/src/components/shared/LoadingWatchdog.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `LoadingWatchdog` | component/function | 14 |

### 3.188 `frontend/src/components/shared/Modal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Modal` | component/function | 13 |

### 3.189 `frontend/src/components/shared/navigationConfig.ts`

- No top-level named function/class symbols detected.

### 3.190 `frontend/src/components/shared/NotificationCenter.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getNotificationApi` | function | 112 |
| 2 | `getErrorMessage` | function | 117 |
| 3 | `preferenceValue` | function | 244 |
| 4 | `matchesVisibilityMode` | function | 252 |
| 5 | `NotificationSeverityIcon` | function | 259 |
| 6 | `NotificationCenter` | component/function | 274 |
| 7 | `syncVisibility` | const arrow | 308 |
| 8 | `onVisible` | const arrow | 382 |
| 9 | `handleClickOutside` | const arrow | 405 |

### 3.191 `frontend/src/components/shared/pageActivity.ts`

- No top-level named function/class symbols detected.

### 3.192 `frontend/src/components/shared/PageHeader.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PageHeader` | component/function | 26 |

### 3.193 `frontend/src/components/shared/PaginationControls.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PaginationControls` | component/function | 42 |
| 2 | `commitPageDraft` | const arrow | 73 |
| 3 | `handlePageInputKeyDown` | const arrow | 84 |

### 3.194 `frontend/src/components/shared/PortalMenu.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPortalMenuItem` | function | 50 |
| 2 | `PortalMenu` | component/function | 60 |
| 3 | `closeIfClickedOutside` | const arrow | 125 |
| 4 | `closeMenu` | const arrow | 133 |
| 5 | `scheduleReposition` | const arrow | 134 |
| 6 | `closeIfEscape` | const arrow | 141 |

### 3.195 `frontend/src/components/shared/QuickPreferenceToggles.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ToggleButton` | function | 26 |
| 2 | `QuickPreferenceToggles` | component/function | 45 |
| 3 | `tr` | const arrow | 48 |

### 3.196 `frontend/src/components/shared/SectionSwitcher.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readStoredSection` | function | 20 |
| 2 | `SectionSwitcher` | component/function | 29 |
| 3 | `selectValue` | const arrow | 58 |

### 3.197 `frontend/src/components/shared/WriteConflictModal.tsx`

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

### 3.198 `frontend/src/components/users/permissionDefinitions.ts`

- No top-level named function/class symbols detected.

### 3.199 `frontend/src/components/users/PermissionEditor.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `parsePermissionState` | function | 11 |
| 2 | `PermissionEditor` | component/function | 25 |
| 3 | `toggle` | const arrow | 40 |

### 3.200 `frontend/src/components/users/UserDetailSheet.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `translateLabel` | function | 43 |
| 2 | `buildRowData` | function | 48 |
| 3 | `parsePermissions` | function | 60 |
| 4 | `UserDetailSheet` | component/function | 71 |

### 3.201 `frontend/src/components/users/UserProfileModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getProfileApi` | function | 155 |
| 2 | `getErrorMessage` | function | 160 |
| 3 | `parseStoredOrganization` | function | 164 |
| 4 | `AvatarPreview` | function | 181 |
| 5 | `ProfileSectionButton` | function | 199 |
| 6 | `clamp` | function | 309 |
| 7 | `loadImageElement` | function | 313 |
| 8 | `renderAvatarCropBlob` | function | 328 |
| 9 | `AvatarEditorModal` | function | 354 |
| 10 | `UserProfileModal` | component/function | 415 |
| 11 | `handleProfileSave` | const arrow | 583 |
| 12 | `handlePasswordSave` | const arrow | 647 |
| 13 | `handleSessionSave` | const arrow | 686 |
| 14 | `refreshOtpState` | const arrow | 706 |

### 3.202 `frontend/src/components/users/Users.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getUsersApi` | function | 144 |
| 2 | `normalizeUsers` | function | 157 |
| 3 | `normalizeRoles` | function | 161 |
| 4 | `normalizePermissionState` | function | 165 |
| 5 | `getErrorMessage` | function | 180 |
| 6 | `clearTimeoutRef` | function | 184 |
| 7 | `ThreeDot` | function | 201 |
| 8 | `formatContactValue` | function | 244 |
| 9 | `UsersDesktopSkeletonRows` | function | 249 |
| 10 | `UsersMobileSkeletonCards` | function | 273 |
| 11 | `Users` | component/function | 287 |
| 12 | `promise` | const arrow | 355 |
| 13 | `promise` | const arrow | 393 |
| 14 | `openCreateUser` | const arrow | 517 |
| 15 | `openCreateRole` | const arrow | 547 |
| 16 | `handleSaveUser` | const arrow | 608 |
| 17 | `handleResetPassword` | const arrow | 678 |
| 18 | `handleSaveRole` | const arrow | 735 |

### 3.203 `frontend/src/components/utils-settings/AuditLog.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadCsvUtilsModule` | function | 103 |
| 2 | `isRecord` | function | 108 |
| 3 | `getErrorMessage` | function | 112 |
| 4 | `toIso` | function | 144 |
| 5 | `formatDateTime` | function | 151 |
| 6 | `formatLogTime` | function | 172 |
| 7 | `auditDeviceLabel` | function | 176 |
| 8 | `auditTimezoneLabel` | function | 184 |
| 9 | `getLogEpoch` | function | 192 |
| 10 | `formatJsonPretty` | function | 199 |
| 11 | `parseLogJson` | function | 207 |
| 12 | `flattenSummaryValue` | function | 215 |
| 13 | `formatEntityName` | function | 234 |
| 14 | `readableSummary` | function | 240 |
| 15 | `normalizeFiniteIds` | function | 268 |
| 16 | `countSelectedIds` | function | 272 |
| 17 | `countActiveFlags` | function | 280 |
| 18 | `DetailRow` | function | 288 |
| 19 | `AuditLog` | component/function | 300 |
| 20 | `sessionEntryLabel` | function | 694 |

### 3.204 `frontend/src/components/utils-settings/Backup.tsx`

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

### 3.205 `frontend/src/components/utils-settings/FontFamilyPicker.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `FontFamilyPicker` | component/function | 30 |

### 3.206 `frontend/src/components/utils-settings/index.ts`

- No top-level named function/class symbols detected.

### 3.207 `frontend/src/components/utils-settings/OtpModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getOtpApi` | function | 45 |
| 2 | `getErrorMessage` | function | 49 |
| 3 | `OtpModal` | component/function | 53 |
| 4 | `loadSetup` | function | 88 |

### 3.208 `frontend/src/components/utils-settings/ResetData.tsx`

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

### 3.209 `frontend/src/components/utils-settings/Settings.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getSettingsApi` | function | 133 |
| 2 | `getErrorMessage` | function | 137 |
| 3 | `toStringValue` | function | 141 |
| 4 | `toNumberValue` | function | 146 |
| 5 | `isSettingsSectionId` | function | 236 |
| 6 | `parseStoredColors` | function | 252 |
| 7 | `buildColorChoices` | function | 263 |
| 8 | `useCopy` | function | 354 |
| 9 | `getSettingsNavLabel` | function | 362 |
| 10 | `SwatchPicker` | function | 379 |
| 11 | `SettingsSection` | function | 462 |
| 12 | `Settings` | component/function | 492 |
| 13 | `showSettingsSection` | const arrow | 518 |
| 14 | `loadOtpStatus` | function | 588 |
| 15 | `loadFaviconPreview` | function | 620 |
| 16 | `scheduleIdlePreview` | const arrow | 635 |
| 17 | `setValue` | const arrow | 689 |
| 18 | `formatPreviewDateTime` | const arrow | 715 |
| 19 | `moveNavItem` | const arrow | 731 |
| 20 | `toggleMobilePinned` | const arrow | 741 |
| 21 | `movePinnedItem` | const arrow | 753 |
| 22 | `movePinnedBefore` | const arrow | 763 |
| 23 | `resetNavigationLayout` | const arrow | 775 |
| 24 | `field` | const arrow | 780 |
| 25 | `savePaymentMethods` | const arrow | 802 |
| 26 | `uploadImageSetting` | const arrow | 822 |
| 27 | `handleSaveSettings` | const arrow | 889 |

### 3.210 `frontend/src/components/utils-settings/settingsConflict.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeObject` | function | 28 |

### 3.211 `frontend/src/constants.ts`

- No top-level named function/class symbols detected.

### 3.212 `frontend/src/index.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `scheduleAfterLoadIdle` | function | 24 |
| 2 | `schedule` | const arrow | 27 |
| 3 | `registerOfflineAppShell` | function | 43 |
| 4 | `register` | const arrow | 46 |
| 5 | `installFormFieldAccessibility` | function | 60 |
| 6 | `escapeSelectorValue` | const arrow | 65 |
| 7 | `wireField` | const arrow | 70 |
| 8 | `scan` | const arrow | 92 |
| 9 | `safeInsertRule` | const function | 130 |
| 10 | `safeCssRulesGetter` | const function | 148 |
| 11 | `stopKnownStartupNoise` | const arrow | 164 |
| 12 | `scheduleFormFieldAccessibility` | function | 199 |

### 3.213 `frontend/src/platform/runtime/clientRuntime.ts`

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

### 3.214 `frontend/src/platform/storage/storagePolicy.ts`

- No top-level named function/class symbols detected.

### 3.215 `frontend/src/public-runtime/runtime-noise-guard.ts`

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

### 3.216 `frontend/src/public-runtime/service-worker.ts`

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

### 3.217 `frontend/src/public-runtime/theme-bootstrap.ts`

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

### 3.218 `frontend/src/public-web-api.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadPortalTransport` | function | 18 |
| 2 | `getPortalMethod` | function | 23 |

### 3.219 `frontend/src/PublicCatalogRoot.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PublicCatalogFallback` | function | 6 |
| 2 | `PublicCatalogRoot` | component/function | 16 |

### 3.220 `frontend/src/runtime/runtimeErrorClassifier.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `messageOf` | function | 27 |
| 2 | `stackOf` | function | 31 |
| 3 | `toText` | function | 35 |
| 4 | `includesExtensionOrigin` | function | 39 |
| 5 | `getPathname` | function | 44 |

### 3.221 `frontend/src/types/lucide-react-icons.d.ts`

- No top-level named function/class symbols detected.

### 3.222 `frontend/src/types/receiptContracts.ts`

- No top-level named function/class symbols detected.

### 3.223 `frontend/src/types/settingsContracts.ts`

- No top-level named function/class symbols detected.

### 3.224 `frontend/src/utils/actionGuards.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `hasOwn` | function | 18 |

### 3.225 `frontend/src/utils/actionHistory.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadActionHistoryTransport` | function | 83 |
| 2 | `normalizeActionHistoryId` | function | 88 |
| 3 | `normalizeEntry` | function | 94 |
| 4 | `parsePermissions` | function | 107 |
| 5 | `getErrorMessage` | function | 119 |

### 3.226 `frontend/src/utils/appRefresh.ts`

- No top-level named function/class symbols detected.

### 3.227 `frontend/src/utils/bulkOps.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `runner` | function | 47 |

### 3.228 `frontend/src/utils/color.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeHex` | function | 1 |
| 2 | `relativeLuminance` | function | 12 |

### 3.229 `frontend/src/utils/csv.ts`

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

### 3.230 `frontend/src/utils/csvExportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 20 |

### 3.231 `frontend/src/utils/csvImport.ts`

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

### 3.232 `frontend/src/utils/csvRowCounter.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `finishRecord` | const arrow | 7 |

### 3.233 `frontend/src/utils/csvTemplate.ts`

- No top-level named function/class symbols detected.

### 3.234 `frontend/src/utils/dateHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toLocalDateString` | function | 4 |

### 3.235 `frontend/src/utils/deviceInfo.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBrowserName` | function | 13 |
| 2 | `getOperatingSystemName` | function | 21 |

### 3.236 `frontend/src/utils/exportPackage.ts`

- No top-level named function/class symbols detected.

### 3.237 `frontend/src/utils/exportReports.tsx`

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

### 3.238 `frontend/src/utils/favicon.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `clamp` | function | 11 |
| 2 | `shouldUseAnonymousCors` | function | 18 |
| 3 | `loadImage` | function | 29 |

### 3.239 `frontend/src/utils/formatters.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeTimestampInput` | function | 6 |

### 3.240 `frontend/src/utils/groupedRecords.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toDate` | function | 37 |
| 2 | `normalizeName` | function | 56 |
| 3 | `compareAlphabetLabels` | function | 64 |

### 3.241 `frontend/src/utils/historyHelpers.ts`

- No top-level named function/class symbols detected.

### 3.242 `frontend/src/utils/importJobRefresh.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeImportJobStatus` | function | 24 |
| 2 | `normalizeImportJobType` | function | 28 |
| 3 | `uniqueChannels` | function | 32 |
| 4 | `dispatchSyncUpdate` | function | 41 |

### 3.243 `frontend/src/utils/index.ts`

- No top-level named function/class symbols detected.

### 3.244 `frontend/src/utils/initials.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getInitialRank` | function | 54 |

### 3.245 `frontend/src/utils/loaders.ts`

- No top-level named function/class symbols detected.

### 3.246 `frontend/src/utils/mediaUpload.ts`

- No top-level named function/class symbols detected.

### 3.247 `frontend/src/utils/mediaUploadState.ts`

- No top-level named function/class symbols detected.

### 3.248 `frontend/src/utils/permissions.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPermissionMap` | function | 3 |

### 3.249 `frontend/src/utils/pricing.ts`

- No top-level named function/class symbols detected.

### 3.250 `frontend/src/utils/printReceipt.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `parsePrintNumber` | function | 46 |
| 2 | `cloneElementWithInlineStyles` | function | 119 |
| 3 | `escapeHtml` | function | 165 |
| 4 | `blobToDataUrl` | function | 174 |
| 5 | `inlineImageNodeSources` | function | 197 |
| 6 | `extractUrlsFromCssValue` | function | 220 |
| 7 | `inlineStyleAssetUrls` | function | 226 |
| 8 | `normalizePrintableRoot` | function | 260 |
| 9 | `mmToPt` | function | 277 |
| 10 | `dataUrlToBytes` | function | 281 |
| 11 | `bytesToBlobPart` | function | 291 |
| 12 | `joinPdfChunks` | function | 295 |
| 13 | `buildPdfStream` | function | 306 |
| 14 | `buildSingleImagePdf` | function | 315 |
| 15 | `escapePdfText` | function | 353 |
| 16 | `wrapTextLine` | function | 360 |
| 17 | `buildTextOnlyPdf` | function | 379 |
| 18 | `buildReceiptFileName` | function | 432 |
| 19 | `wrapReceiptFallbackLine` | function | 443 |
| 20 | `classifyReceiptFallbackLine` | function | 470 |
| 21 | `measureWrappedReceiptHeight` | function | 482 |
| 22 | `wrapCanvasText` | function | 490 |
| 23 | `drawClippedText` | function | 526 |
| 24 | `createTextOnlyReceiptCanvas` | function | 535 |
| 25 | `canvasToPngBlob` | function | 638 |
| 26 | `waitForElementAssets` | function | 651 |
| 27 | `renderElementToCanvas` | function | 680 |
| 28 | `createPrintableReceiptMarkup` | function | 791 |
| 29 | `buildPrintablePreviewDocument` | function | 814 |
| 30 | `attachPrintablePreviewActions` | function | 969 |
| 31 | `schedulePrint` | const arrow | 978 |
| 32 | `downloadBlob` | function | 996 |
| 33 | `buildTextOnlyReceiptBlob` | const arrow | 1044 |
| 34 | `renderPdfBlob` | const arrow | 1058 |
| 35 | `extractReceiptLines` | function | 1114 |

### 3.251 `frontend/src/utils/productBatches.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeBranchId` | function | 26 |

### 3.252 `frontend/src/utils/productGrouping.ts`

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

### 3.253 `frontend/src/utils/publicAssetUrls.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `trimBaseUrl` | function | 11 |
| 2 | `normalizeUploadPath` | function | 15 |
| 3 | `appendAssetVersion` | function | 23 |
| 4 | `isLocalLikeHostname` | function | 38 |
| 5 | `getSafeCurrentOrigin` | function | 42 |
| 6 | `api` | const arrow | 57 |

### 3.254 `frontend/src/utils/receiptAppliedConfig.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `parseObject` | function | 67 |

### 3.255 `frontend/src/utils/scriptTypography.ts`

- No top-level named function/class symbols detected.

### 3.256 `frontend/src/utils/settingsRefresh.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeSettingKeys` | function | 62 |

### 3.257 `frontend/src/utils/settingsWriteOptions.ts`

- No top-level named function/class symbols detected.

### 3.258 `frontend/src/web-api.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `sanitizeBaseUrl` | function | 119 |
| 2 | `isPublicRuntimePath` | function | 123 |
| 3 | `getOfflineDb` | function | 129 |
| 4 | `loadMethodsModule` | function | 134 |
| 5 | `loadAppBootstrapModule` | function | 139 |
| 6 | `loadAuthTransportModule` | function | 144 |
| 7 | `loadPortalTransportModule` | function | 149 |
| 8 | `loadSystemRuntimeModule` | function | 154 |
| 9 | `loadSaleWriteTransportModule` | function | 159 |
| 10 | `loadOfflineSnapshotTransportModule` | function | 164 |
| 11 | `loadNotificationSummaryModule` | function | 169 |
| 12 | `loadSettingsTransportModule` | function | 174 |
| 13 | `loadProductReadTransportModule` | function | 179 |
| 14 | `loadProductWriteTransportModule` | function | 184 |
| 15 | `loadLookupTransportModule` | function | 189 |
| 16 | `loadBranchTransportModule` | function | 194 |
| 17 | `loadUserReadTransportModule` | function | 199 |
| 18 | `loadActionHistoryTransportModule` | function | 204 |
| 19 | `getLazyApiMethod` | function | 242 |
| 20 | `serializePendingSyncPreview` | function | 256 |
| 21 | `mapOfflineFileChunkStatusUpdates` | function | 279 |
| 22 | `asArrayBuffer` | function | 295 |
| 23 | `bytesToBase64` | function | 299 |
| 24 | `base64ToBytes` | function | 310 |
| 25 | `stableStringify` | function | 317 |
| 26 | `sha256Hex` | function | 323 |
| 27 | `deriveOfflineVaultKey` | function | 331 |
| 28 | `encryptOfflineVaultValue` | function | 348 |
| 29 | `decryptOfflineVaultValue` | function | 356 |
| 30 | `requestOfflinePersistentStorage` | function | 366 |
| 31 | `dispatchVaultLocked` | function | 373 |
| 32 | `scheduleOfflineVaultIdleLock` | function | 378 |
| 33 | `lockOfflineVault` | function | 384 |
| 34 | `unlockOfflineVault` | function | 392 |
| 35 | `queueBusinessOutboxOperation` | function | 418 |
| 36 | `queueOfflineFileChunks` | function | 455 |
| 37 | `dispatchOutboxProgress` | function | 509 |
| 38 | `dispatchOutboxFileProgress` | function | 516 |
| 39 | `dispatchOutboxConflict` | function | 523 |
| 40 | `getSyncOutboxKey` | function | 530 |
| 41 | `syncUnlockedOfflineOutbox` | function | 534 |
| 42 | `syncUnlockedOfflineFileChunks` | function | 644 |
| 43 | `refreshOfflineSnapshotSoon` | function | 706 |
| 44 | `run` | const arrow | 716 |
| 45 | `refreshServiceWorkerSoon` | function | 737 |
| 46 | `runOfflineMaintenance` | function | 747 |
| 47 | `startOfflineMaintenanceLoop` | function | 762 |
| 48 | `scheduleInitialOfflineMaintenance` | function | 770 |
| 49 | `run` | const arrow | 774 |
| 50 | `scheduleIdle` | const arrow | 778 |
| 51 | `ensureSessionRecoveryListeners` | function | 795 |
| 52 | `scheduleBootstrapStorageMaintenance` | function | 820 |
| 53 | `run` | const arrow | 826 |
| 54 | `scheduleBootstrapOfflineDbWrite` | function | 843 |
| 55 | `run` | const arrow | 849 |
| 56 | `write` | const arrow | 851 |
| 57 | `forwardServiceWorkerOutboxEvent` | function | 870 |
| 58 | `forwardServiceWorkerAppEvent` | function | 958 |

### 3.259 `ops/scripts/frontend/build-public-runtime-scripts.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toProjectPath` | function | 36 |
| 2 | `formatDiagnostic` | function | 40 |
| 3 | `transpileRuntimeScript` | function | 47 |
| 4 | `writeIfChanged` | function | 67 |
| 5 | `main` | function | 74 |

### 3.260 `ops/scripts/frontend/verify-i18n.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `collectUsedKeys` | function | 29 |
| 2 | `flattenTranslationTree` | function | 69 |
| 3 | `listMissing` | function | 83 |
| 4 | `listEmptyValues` | function | 88 |
| 5 | `printList` | function | 95 |
| 6 | `main` | function | 102 |

### 3.261 `ops/scripts/frontend/verify-performance.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `read` | function | 15 |
| 2 | `walk` | function | 19 |
| 3 | `trackedFiles` | function | 37 |
| 4 | `assert` | function | 47 |

### 3.262 `ops/scripts/frontend/verify-ui.ts`

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

### 3.263 `frontend/vite.config.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readGitRevision` | function | 11 |
| 2 | `escapeInlineScript` | function | 53 |
| 3 | `inlinePublicRuntimeScripts` | function | 59 |
| 4 | `fixCrossorigin` | function | 84 |
| 5 | `emitBuildManifest` | function | 109 |
| 6 | `shouldDeferModulePreload` | function | 294 |
| 7 | `manualChunks` | function | 298 |

### 3.264 `frontend/tailwind.config.ts`

- No top-level named function/class symbols detected.

