# Frontend Function Reference

Auto-generated symbol inventory for frontend files. Regenerate with `node ops/scripts/docs/generate-doc-reference.ts`.

## 1. Coverage Summary

Total files documented: **278**

## 2. Symbol Count by File

| No. | File | Symbols |
|---:|---|---:|
| 1 | `frontend/src/AdminRoot.tsx` | 1 |
| 2 | `frontend/src/api/actionHistoryTransport.ts` | 1 |
| 3 | `frontend/src/api/actorQuery.ts` | 0 |
| 4 | `frontend/src/api/aiTransport.ts` | 0 |
| 5 | `frontend/src/api/appBootstrapTransport.ts` | 7 |
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
| 20 | `frontend/src/api/http.ts` | 33 |
| 21 | `frontend/src/api/httpState.ts` | 0 |
| 22 | `frontend/src/api/importJobsTransport.ts` | 5 |
| 23 | `frontend/src/api/importTransport.ts` | 0 |
| 24 | `frontend/src/api/inventoryTransport.ts` | 3 |
| 25 | `frontend/src/api/inventoryWriteTransport.ts` | 1 |
| 26 | `frontend/src/api/lazyLocalDb.ts` | 0 |
| 27 | `frontend/src/api/localDb.ts` | 1 |
| 28 | `frontend/src/api/localMirrors.ts` | 3 |
| 29 | `frontend/src/api/lookupTransport.ts` | 4 |
| 30 | `frontend/src/api/methods.ts` | 162 |
| 31 | `frontend/src/api/multipartHeaders.ts` | 0 |
| 32 | `frontend/src/api/notificationSummary.ts` | 1 |
| 33 | `frontend/src/api/offlineSnapshotTransport.ts` | 7 |
| 34 | `frontend/src/api/pendingSyncTransport.ts` | 0 |
| 35 | `frontend/src/api/portalHttp.ts` | 0 |
| 36 | `frontend/src/api/portalPublicTransport.ts` | 7 |
| 37 | `frontend/src/api/portalTransport.ts` | 2 |
| 38 | `frontend/src/api/productImageUploadTransport.ts` | 1 |
| 39 | `frontend/src/api/productReadTransport.ts` | 4 |
| 40 | `frontend/src/api/productWriteTransport.ts` | 3 |
| 41 | `frontend/src/api/query.ts` | 1 |
| 42 | `frontend/src/api/queryCache.ts` | 0 |
| 43 | `frontend/src/api/requestIds.ts` | 0 |
| 44 | `frontend/src/api/returnsReadTransport.ts` | 1 |
| 45 | `frontend/src/api/returnsTransport.ts` | 5 |
| 46 | `frontend/src/api/rfidTransport.ts` | 2 |
| 47 | `frontend/src/api/salesTransport.ts` | 4 |
| 48 | `frontend/src/api/saleWriteTransport.ts` | 16 |
| 49 | `frontend/src/api/settingsTransport.ts` | 6 |
| 50 | `frontend/src/api/syncPreview.ts` | 0 |
| 51 | `frontend/src/api/syncRuntime.ts` | 0 |
| 52 | `frontend/src/api/systemJobs.ts` | 3 |
| 53 | `frontend/src/api/systemRuntime.ts` | 0 |
| 54 | `frontend/src/api/userAdminTransport.ts` | 1 |
| 55 | `frontend/src/api/userReadTransport.ts` | 0 |
| 56 | `frontend/src/api/websocket.ts` | 8 |
| 57 | `frontend/src/App.tsx` | 89 |
| 58 | `frontend/src/app/AppContextCore.tsx` | 1 |
| 59 | `frontend/src/app/appShellUtils.ts` | 0 |
| 60 | `frontend/src/app/pathRouting.ts` | 0 |
| 61 | `frontend/src/app/PublicCatalogAppProvider.tsx` | 0 |
| 62 | `frontend/src/app/publicErrorRecovery.ts` | 1 |
| 63 | `frontend/src/AppContext.tsx` | 43 |
| 64 | `frontend/src/components/auth/Login.tsx` | 23 |
| 65 | `frontend/src/components/branches/Branches.tsx` | 15 |
| 66 | `frontend/src/components/branches/BranchForm.tsx` | 2 |
| 67 | `frontend/src/components/branches/TransferModal.tsx` | 6 |
| 68 | `frontend/src/components/catalog/catalogAssetUrls.ts` | 7 |
| 69 | `frontend/src/components/catalog/CatalogEditorSurface.tsx` | 3 |
| 70 | `frontend/src/components/catalog/CatalogImageField.tsx` | 1 |
| 71 | `frontend/src/components/catalog/catalogImages.tsx` | 5 |
| 72 | `frontend/src/components/catalog/CatalogPage.tsx` | 127 |
| 73 | `frontend/src/components/catalog/CatalogPageContext.tsx` | 0 |
| 74 | `frontend/src/components/catalog/catalogPagination.tsx` | 5 |
| 75 | `frontend/src/components/catalog/CatalogPreviewSurface.tsx` | 2 |
| 76 | `frontend/src/components/catalog/CatalogProductsSection.tsx` | 4 |
| 77 | `frontend/src/components/catalog/CatalogSecondaryTabs.tsx` | 7 |
| 78 | `frontend/src/components/catalog/catalogUi.tsx` | 1 |
| 79 | `frontend/src/components/catalog/portalCatalogDisplay.ts` | 7 |
| 80 | `frontend/src/components/catalog/portalContentI18n.ts` | 14 |
| 81 | `frontend/src/components/catalog/portalEditorUtils.ts` | 2 |
| 82 | `frontend/src/components/catalog/portalLanguageOptions.ts` | 0 |
| 83 | `frontend/src/components/catalog/portalLanguagePacks.ts` | 0 |
| 84 | `frontend/src/components/catalog/portalTranslateController.ts` | 4 |
| 85 | `frontend/src/components/catalog/portalTranslationData.ts` | 1 |
| 86 | `frontend/src/components/catalog/PublicCatalogPage.tsx` | 41 |
| 87 | `frontend/src/components/contacts/ContactImportModal.tsx` | 8 |
| 88 | `frontend/src/components/contacts/contactImportWorker.ts` | 1 |
| 89 | `frontend/src/components/contacts/contactOptionUtils.ts` | 3 |
| 90 | `frontend/src/components/contacts/Contacts.tsx` | 13 |
| 91 | `frontend/src/components/contacts/CustomerFormModal.tsx` | 10 |
| 92 | `frontend/src/components/contacts/customerMembershipNumber.ts` | 0 |
| 93 | `frontend/src/components/contacts/CustomersTab.tsx` | 19 |
| 94 | `frontend/src/components/contacts/DeliveryTab.tsx` | 28 |
| 95 | `frontend/src/components/contacts/shared.tsx` | 3 |
| 96 | `frontend/src/components/contacts/SuppliersTab.tsx` | 23 |
| 97 | `frontend/src/components/custom-tables/CustomTables.tsx` | 25 |
| 98 | `frontend/src/components/dashboard/charts/BarChart.tsx` | 5 |
| 99 | `frontend/src/components/dashboard/charts/DonutChart.tsx` | 1 |
| 100 | `frontend/src/components/dashboard/charts/index.ts` | 0 |
| 101 | `frontend/src/components/dashboard/charts/LineChart.tsx` | 7 |
| 102 | `frontend/src/components/dashboard/charts/NoData.tsx` | 1 |
| 103 | `frontend/src/components/dashboard/Dashboard.tsx` | 18 |
| 104 | `frontend/src/components/dashboard/dashboardExport.ts` | 16 |
| 105 | `frontend/src/components/dashboard/MiniStat.tsx` | 1 |
| 106 | `frontend/src/components/files/FilePickerModal.tsx` | 9 |
| 107 | `frontend/src/components/files/FilesPage.tsx` | 27 |
| 108 | `frontend/src/components/files/FilesProvidersTab.tsx` | 4 |
| 109 | `frontend/src/components/files/FilesResponsesTab.tsx` | 1 |
| 110 | `frontend/src/components/inventory/DualMoney.tsx` | 1 |
| 111 | `frontend/src/components/inventory/Inventory.tsx` | 32 |
| 112 | `frontend/src/components/inventory/InventoryBatchModal.tsx` | 3 |
| 113 | `frontend/src/components/inventory/inventoryExport.ts` | 14 |
| 114 | `frontend/src/components/inventory/InventoryImportModal.tsx` | 9 |
| 115 | `frontend/src/components/inventory/inventoryImportWorker.ts` | 1 |
| 116 | `frontend/src/components/inventory/InventoryMovementsSurface.tsx` | 1 |
| 117 | `frontend/src/components/inventory/InventoryProductsSurface.tsx` | 3 |
| 118 | `frontend/src/components/inventory/InventoryReasonManagerModal.tsx` | 2 |
| 119 | `frontend/src/components/inventory/InventoryRfidSurface.tsx` | 1 |
| 120 | `frontend/src/components/inventory/InventoryStatDetailModal.tsx` | 1 |
| 121 | `frontend/src/components/inventory/InventoryStockModals.tsx` | 1 |
| 122 | `frontend/src/components/inventory/movementGroups.ts` | 11 |
| 123 | `frontend/src/components/inventory/ProductDetailModal.tsx` | 2 |
| 124 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx` | 11 |
| 125 | `frontend/src/components/navigation/Sidebar.tsx` | 9 |
| 126 | `frontend/src/components/pos/CartItem.tsx` | 2 |
| 127 | `frontend/src/components/pos/FilterPanel.tsx` | 5 |
| 128 | `frontend/src/components/pos/POS.tsx` | 52 |
| 129 | `frontend/src/components/pos/posCore.ts` | 1 |
| 130 | `frontend/src/components/pos/POSQuickAddModals.tsx` | 1 |
| 131 | `frontend/src/components/pos/ProductDetailSheet.tsx` | 2 |
| 132 | `frontend/src/components/pos/ProductImage.tsx` | 5 |
| 133 | `frontend/src/components/pos/QuickAddModal.tsx` | 2 |
| 134 | `frontend/src/components/products/config/productPageConfig.ts` | 0 |
| 135 | `frontend/src/components/products/forms/BranchStockAdjuster.tsx` | 6 |
| 136 | `frontend/src/components/products/forms/BulkAddStockModal.tsx` | 6 |
| 137 | `frontend/src/components/products/forms/ProductForm.tsx` | 19 |
| 138 | `frontend/src/components/products/forms/VariantFormModal.tsx` | 3 |
| 139 | `frontend/src/components/products/helpers/productDisplayHelpers.ts` | 1 |
| 140 | `frontend/src/components/products/helpers/productExport.ts` | 5 |
| 141 | `frontend/src/components/products/helpers/productFilterHelpers.ts` | 2 |
| 142 | `frontend/src/components/products/helpers/productGalleryHelpers.ts` | 0 |
| 143 | `frontend/src/components/products/helpers/productGroupViewHelpers.ts` | 0 |
| 144 | `frontend/src/components/products/helpers/productMenuHelpers.ts` | 3 |
| 145 | `frontend/src/components/products/helpers/productPageHelpers.ts` | 0 |
| 146 | `frontend/src/components/products/helpers/productSelectionHelpers.ts` | 0 |
| 147 | `frontend/src/components/products/helpers/productSupplierOptions.ts` | 0 |
| 148 | `frontend/src/components/products/helpers/productWriteHelpers.ts` | 3 |
| 149 | `frontend/src/components/products/history/productHistoryHelpers.ts` | 0 |
| 150 | `frontend/src/components/products/import/BulkImportModal.tsx` | 51 |
| 151 | `frontend/src/components/products/import/productImportPlanner.ts` | 11 |
| 152 | `frontend/src/components/products/import/productImportWorker.ts` | 3 |
| 153 | `frontend/src/components/products/lookups/ManageBrandsModal.tsx` | 10 |
| 154 | `frontend/src/components/products/lookups/ManageCategoriesModal.tsx` | 5 |
| 155 | `frontend/src/components/products/lookups/ManageUnitsModal.tsx` | 5 |
| 156 | `frontend/src/components/products/lookups/productLookupSnapshots.ts` | 7 |
| 157 | `frontend/src/components/products/Products.tsx` | 31 |
| 158 | `frontend/src/components/products/scanning/barcodeImageScanner.ts` | 4 |
| 159 | `frontend/src/components/products/scanning/BarcodeScannerModal.tsx` | 4 |
| 160 | `frontend/src/components/products/scanning/barcodeScannerState.ts` | 0 |
| 161 | `frontend/src/components/products/scanning/cameraPermission.ts` | 3 |
| 162 | `frontend/src/components/products/scanning/scanbotScanner.ts` | 5 |
| 163 | `frontend/src/components/products/shared/primitives.tsx` | 12 |
| 164 | `frontend/src/components/products/surfaces/HeaderActions.tsx` | 2 |
| 165 | `frontend/src/components/products/surfaces/ProductDetailModal.tsx` | 3 |
| 166 | `frontend/src/components/products/surfaces/ProductRowParts.tsx` | 1 |
| 167 | `frontend/src/components/products/surfaces/ProductsListSurface.tsx` | 3 |
| 168 | `frontend/src/components/receipt-settings/AllFieldsPanel.tsx` | 4 |
| 169 | `frontend/src/components/receipt-settings/constants.ts` | 1 |
| 170 | `frontend/src/components/receipt-settings/ErrorBoundary.tsx` | 1 |
| 171 | `frontend/src/components/receipt-settings/FieldOrderManager.tsx` | 9 |
| 172 | `frontend/src/components/receipt-settings/PrintSettings.tsx` | 8 |
| 173 | `frontend/src/components/receipt-settings/ReceiptPreview.tsx` | 3 |
| 174 | `frontend/src/components/receipt-settings/ReceiptSettings.tsx` | 4 |
| 175 | `frontend/src/components/receipt-settings/template.ts` | 2 |
| 176 | `frontend/src/components/receipt/Receipt.tsx` | 12 |
| 177 | `frontend/src/components/returns/EditReturnModal.tsx` | 8 |
| 178 | `frontend/src/components/returns/NewReturnModal.tsx` | 18 |
| 179 | `frontend/src/components/returns/NewSupplierReturnModal.tsx` | 14 |
| 180 | `frontend/src/components/returns/ReturnDetailModal.tsx` | 4 |
| 181 | `frontend/src/components/returns/Returns.tsx` | 13 |
| 182 | `frontend/src/components/returns/ReturnsListSurface.tsx` | 5 |
| 183 | `frontend/src/components/sales/ExportModal.tsx` | 5 |
| 184 | `frontend/src/components/sales/SaleDetailModal.tsx` | 4 |
| 185 | `frontend/src/components/sales/Sales.tsx` | 16 |
| 186 | `frontend/src/components/sales/SalesImportModal.tsx` | 8 |
| 187 | `frontend/src/components/sales/salesImportWorker.ts` | 1 |
| 188 | `frontend/src/components/sales/SalesListSurface.tsx` | 2 |
| 189 | `frontend/src/components/sales/StatusBadge.tsx` | 2 |
| 190 | `frontend/src/components/server/ServerPage.tsx` | 21 |
| 191 | `frontend/src/components/shared/ActionHistoryBar.tsx` | 3 |
| 192 | `frontend/src/components/shared/AppSelect.tsx` | 8 |
| 193 | `frontend/src/components/shared/BackgroundImportTracker.tsx` | 21 |
| 194 | `frontend/src/components/shared/ExportMenu.tsx` | 1 |
| 195 | `frontend/src/components/shared/FilterMenu.tsx` | 4 |
| 196 | `frontend/src/components/shared/globalScroll.ts` | 3 |
| 197 | `frontend/src/components/shared/ImageGalleryLightbox.tsx` | 5 |
| 198 | `frontend/src/components/shared/LazyPortalMenu.tsx` | 1 |
| 199 | `frontend/src/components/shared/LoadingWatchdog.tsx` | 1 |
| 200 | `frontend/src/components/shared/Modal.tsx` | 1 |
| 201 | `frontend/src/components/shared/navigationConfig.ts` | 0 |
| 202 | `frontend/src/components/shared/NotificationCenter.tsx` | 8 |
| 203 | `frontend/src/components/shared/pageActivity.ts` | 0 |
| 204 | `frontend/src/components/shared/PageHeader.tsx` | 1 |
| 205 | `frontend/src/components/shared/PaginationControls.tsx` | 3 |
| 206 | `frontend/src/components/shared/PortalMenu.tsx` | 6 |
| 207 | `frontend/src/components/shared/QuickPreferenceToggles.tsx` | 3 |
| 208 | `frontend/src/components/shared/SectionSwitcher.tsx` | 3 |
| 209 | `frontend/src/components/shared/WriteConflictModal.tsx` | 10 |
| 210 | `frontend/src/components/users/permissionDefinitions.ts` | 0 |
| 211 | `frontend/src/components/users/PermissionEditor.tsx` | 3 |
| 212 | `frontend/src/components/users/UserDetailSheet.tsx` | 4 |
| 213 | `frontend/src/components/users/UserProfileModal.tsx` | 14 |
| 214 | `frontend/src/components/users/Users.tsx` | 19 |
| 215 | `frontend/src/components/utils-settings/AuditLog.tsx` | 22 |
| 216 | `frontend/src/components/utils-settings/Backup.tsx` | 34 |
| 217 | `frontend/src/components/utils-settings/FontFamilyPicker.tsx` | 1 |
| 218 | `frontend/src/components/utils-settings/index.ts` | 0 |
| 219 | `frontend/src/components/utils-settings/OtpModal.tsx` | 4 |
| 220 | `frontend/src/components/utils-settings/ResetData.tsx` | 10 |
| 221 | `frontend/src/components/utils-settings/Settings.tsx` | 27 |
| 222 | `frontend/src/components/utils-settings/settingsConflict.ts` | 1 |
| 223 | `frontend/src/constants.ts` | 0 |
| 224 | `frontend/src/index.tsx` | 13 |
| 225 | `frontend/src/platform/runtime/clientRuntime.ts` | 9 |
| 226 | `frontend/src/platform/storage/storagePolicy.ts` | 0 |
| 227 | `frontend/src/public-runtime/runtime-noise-guard.ts` | 8 |
| 228 | `frontend/src/public-runtime/service-worker.ts` | 26 |
| 229 | `frontend/src/public-runtime/theme-bootstrap.ts` | 15 |
| 230 | `frontend/src/public-web-api.ts` | 2 |
| 231 | `frontend/src/PublicCatalogRoot.tsx` | 2 |
| 232 | `frontend/src/runtime/runtimeErrorClassifier.ts` | 5 |
| 233 | `frontend/src/types/lucide-react-icons.d.ts` | 0 |
| 234 | `frontend/src/types/receiptContracts.ts` | 0 |
| 235 | `frontend/src/types/settingsContracts.ts` | 0 |
| 236 | `frontend/src/utils/actionGuards.ts` | 1 |
| 237 | `frontend/src/utils/actionHistory.ts` | 6 |
| 238 | `frontend/src/utils/appRefresh.ts` | 0 |
| 239 | `frontend/src/utils/bulkOps.ts` | 1 |
| 240 | `frontend/src/utils/color.ts` | 2 |
| 241 | `frontend/src/utils/csv.ts` | 8 |
| 242 | `frontend/src/utils/csvExportWorker.ts` | 1 |
| 243 | `frontend/src/utils/csvImport.ts` | 8 |
| 244 | `frontend/src/utils/csvRowCounter.ts` | 1 |
| 245 | `frontend/src/utils/csvTemplate.ts` | 0 |
| 246 | `frontend/src/utils/dateHelpers.ts` | 1 |
| 247 | `frontend/src/utils/deviceInfo.ts` | 2 |
| 248 | `frontend/src/utils/exportPackage.ts` | 0 |
| 249 | `frontend/src/utils/exportReports.tsx` | 8 |
| 250 | `frontend/src/utils/favicon.ts` | 3 |
| 251 | `frontend/src/utils/formatters.ts` | 1 |
| 252 | `frontend/src/utils/groupedRecords.ts` | 2 |
| 253 | `frontend/src/utils/historyHelpers.ts` | 0 |
| 254 | `frontend/src/utils/importJobRefresh.ts` | 4 |
| 255 | `frontend/src/utils/index.ts` | 0 |
| 256 | `frontend/src/utils/initials.ts` | 1 |
| 257 | `frontend/src/utils/loaders.ts` | 0 |
| 258 | `frontend/src/utils/mediaUpload.ts` | 0 |
| 259 | `frontend/src/utils/mediaUploadState.ts` | 0 |
| 260 | `frontend/src/utils/permissions.ts` | 1 |
| 261 | `frontend/src/utils/pricing.ts` | 0 |
| 262 | `frontend/src/utils/printReceipt.ts` | 35 |
| 263 | `frontend/src/utils/productBatches.ts` | 1 |
| 264 | `frontend/src/utils/productGrouping.ts` | 9 |
| 265 | `frontend/src/utils/publicAssetUrls.ts` | 6 |
| 266 | `frontend/src/utils/receiptAppliedConfig.ts` | 1 |
| 267 | `frontend/src/utils/recordFilters.ts` | 1 |
| 268 | `frontend/src/utils/scriptTypography.ts` | 0 |
| 269 | `frontend/src/utils/searchTerms.ts` | 0 |
| 270 | `frontend/src/utils/settingsRefresh.ts` | 1 |
| 271 | `frontend/src/utils/settingsWriteOptions.ts` | 0 |
| 272 | `frontend/src/web-api.ts` | 58 |
| 273 | `ops/scripts/frontend/build-public-runtime-scripts.ts` | 5 |
| 274 | `ops/scripts/frontend/verify-i18n.ts` | 6 |
| 275 | `ops/scripts/frontend/verify-performance.ts` | 4 |
| 276 | `ops/scripts/frontend/verify-ui.ts` | 11 |
| 277 | `frontend/vite.config.ts` | 19 |
| 278 | `frontend/tailwind.config.ts` | 0 |

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
| 1 | `emptyBootstrap` | function | 31 |
| 2 | `readStoredUser` | function | 43 |
| 3 | `readErrorField` | function | 53 |
| 4 | `ensureBootstrapServerUrl` | function | 58 |
| 5 | `buildLocalBootstrap` | function | 69 |
| 6 | `takeEarlyAuthBootstrapPromise` | function | 81 |
| 7 | `takeEmbeddedAuthBootstrapPayload` | function | 90 |

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
| 1 | `getDevicePayload` | function | 9 |
| 2 | `encodeId` | function | 13 |

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
| 1 | `getSameOriginApiBaseUrl` | function | 94 |
| 2 | `getReadServerBaseUrl` | function | 103 |
| 3 | `hasStoredAuthSession` | function | 107 |
| 4 | `isProtectedAdminHost` | function | 116 |
| 5 | `normalizeApiPath` | function | 133 |
| 6 | `getApiMismatchKey` | function | 150 |
| 7 | `dispatchApiVersionMismatch` | function | 165 |
| 8 | `logCall` | function | 244 |
| 9 | `getClientMetaHeaders` | function | 252 |
| 10 | `createApiError` | function | 256 |
| 11 | `createCloudflareAccessError` | function | 285 |
| 12 | `dispatchUnauthorized` | function | 295 |
| 13 | `dispatchRuntimeVersionMismatch` | function | 323 |
| 14 | `checkRuntimeVersionFromHealth` | function | 335 |
| 15 | `createWriteBlockedError` | function | 342 |
| 16 | `dispatchWriteBlocked` | function | 353 |
| 17 | `dispatchTransientGatewayOutage` | function | 368 |
| 18 | `getConflictRefreshChannels` | function | 434 |
| 19 | `dispatchGlobalDataRefresh` | function | 443 |
| 20 | `sleep` | function | 452 |
| 21 | `hasUsableLocalData` | function | 456 |
| 22 | `noteReadFailure` | function | 482 |
| 23 | `stableStringifyForDedupe` | function | 503 |
| 24 | `clampDedupeBody` | function | 513 |
| 25 | `methodAllowsRequestBody` | function | 525 |
| 26 | `parsed` | const arrow | 606 |
| 27 | `shouldDispatchUnauthorized` | function | 667 |
| 28 | `isConnectivityError` | function | 680 |
| 29 | `setServerHealth` | function | 708 |
| 30 | `getChannelRefreshKey` | function | 848 |
| 31 | `emitCacheRefresh` | function | 853 |
| 32 | `clearInflight` | function | 867 |
| 33 | `hasReusableInflight` | function | 872 |

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

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `scheduleInventoryCacheWrite` | function | 17 |
| 2 | `readInventoryCache` | function | 30 |
| 3 | `routeCachedInventoryQuery` | function | 34 |

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
| 1 | `listLookupRows` | function | 25 |
| 2 | `createLookupRow` | function | 48 |
| 3 | `updateLookupRow` | function | 57 |
| 4 | `deleteLookupRow` | function | 70 |

### 3.30 `frontend/src/api/methods.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadPortalTransport` | function | 42 |
| 2 | `loadSaleWriteTransport` | function | 47 |
| 3 | `loadCsvTemplateModule` | function | 52 |
| 4 | `loadBrowserDialogsModule` | function | 57 |
| 5 | `loadAiTransport` | function | 62 |
| 6 | `loadActionHistoryTransport` | function | 67 |
| 7 | `loadAuthTransport` | function | 72 |
| 8 | `loadContactsTransport` | function | 77 |
| 9 | `loadFileTransport` | function | 82 |
| 10 | `loadBranchTransport` | function | 87 |
| 11 | `loadInventoryTransport` | function | 92 |
| 12 | `loadInventoryWriteTransport` | function | 97 |
| 13 | `loadImportJobsTransport` | function | 102 |
| 14 | `loadProductWriteTransport` | function | 107 |
| 15 | `loadRfidTransport` | function | 112 |
| 16 | `loadSalesTransport` | function | 117 |
| 17 | `loadSettingsTransport` | function | 122 |
| 18 | `loadOfflineSnapshotTransport` | function | 127 |
| 19 | `loadReturnsTransport` | function | 132 |
| 20 | `loadPendingSyncTransport` | function | 137 |
| 21 | `loadDriveSyncTransport` | function | 142 |
| 22 | `loadNotificationSummaryTransport` | function | 147 |
| 23 | `loadSystemJobsTransport` | function | 152 |
| 24 | `loadLookupTransport` | function | 157 |
| 25 | `loadProductReadTransport` | function | 162 |
| 26 | `loadQueryCacheModule` | function | 167 |
| 27 | `loadLocalMirrorsModule` | function | 172 |
| 28 | `loadUserAdminTransport` | function | 177 |
| 29 | `loadUserReadTransport` | function | 182 |
| 30 | `loadClientRuntimeModule` | function | 187 |
| 31 | `loadAppRefreshModule` | function | 192 |
| 32 | `loadHttpCoreModule` | function | 197 |
| 33 | `buildImportCsvTemplate` | function | 202 |
| 34 | `loadSystemRuntimeModule` | function | 234 |
| 35 | `callSystemRuntimeMethod` | function | 239 |
| 36 | `scheduleSensitiveMirrorPurge` | function | 246 |
| 37 | `run` | const arrow | 247 |
| 38 | `invalidateClientRuntimeState` | function | 285 |
| 39 | `dispatchRefreshAppData` | function | 303 |
| 40 | `login` | const arrow | 327 |
| 41 | `logout` | const arrow | 331 |
| 42 | `resetPasswordWithOtp` | const arrow | 335 |
| 43 | `requestPasswordResetEmail` | const arrow | 339 |
| 44 | `completePasswordReset` | const arrow | 343 |
| 45 | `updateSessionDuration` | const arrow | 347 |
| 46 | `getVerificationCapabilities` | const arrow | 351 |
| 47 | `getSystemConfig` | const arrow | 355 |
| 48 | `getSystemBootstrap` | const arrow | 357 |
| 49 | `getSystemDebugLog` | const arrow | 363 |
| 50 | `startGoogleOauth` | const arrow | 365 |
| 51 | `completeGoogleOauth` | const arrow | 369 |
| 52 | `unlinkGoogleOauth` | const arrow | 373 |
| 53 | `getAppBootstrap` | const arrow | 377 |
| 54 | `getOrganizationBootstrap` | const arrow | 381 |
| 55 | `searchOrganizations` | const arrow | 385 |
| 56 | `getCurrentOrganization` | const arrow | 389 |
| 57 | `getCategories` | const arrow | 406 |
| 58 | `updateCategory` | const arrow | 416 |
| 59 | `deleteCategory` | const arrow | 422 |
| 60 | `getUnits` | const arrow | 430 |
| 61 | `updateUnit` | const arrow | 440 |
| 62 | `deleteUnit` | const arrow | 446 |
| 63 | `getBranches` | const arrow | 454 |
| 64 | `getBranchSummary` | const arrow | 458 |
| 65 | `updateBranch` | const arrow | 466 |
| 66 | `deleteBranch` | const arrow | 470 |
| 67 | `getBranchStock` | const arrow | 474 |
| 68 | `getTransfers` | const arrow | 478 |
| 69 | `getBranchStockIntegrity` | const arrow | 486 |
| 70 | `getProducts` | const arrow | 496 |
| 71 | `searchProducts` | const arrow | 500 |
| 72 | `getProductBootstrap` | const arrow | 504 |
| 73 | `getProductsByIds` | const arrow | 508 |
| 74 | `getProductFilters` | const arrow | 512 |
| 75 | `getProductLookupUsage` | const arrow | 516 |
| 76 | `replaceProductLookupValues` | const arrow | 520 |
| 77 | `getPortalSubmissionsForReview` | const arrow | 568 |
| 78 | `reviewPortalSubmission` | const arrow | 572 |
| 79 | `getAiProviders` | const arrow | 577 |
| 80 | `createAiProvider` | const arrow | 581 |
| 81 | `updateAiProvider` | const arrow | 585 |
| 82 | `deleteAiProvider` | const arrow | 589 |
| 83 | `testAiProvider` | const arrow | 593 |
| 84 | `getAiResponses` | const arrow | 597 |
| 85 | `createProduct` | const arrow | 601 |
| 86 | `updateProduct` | const arrow | 605 |
| 87 | `deleteProduct` | const arrow | 609 |
| 88 | `otpSetup` | const arrow | 615 |
| 89 | `otpConfirm` | const arrow | 619 |
| 90 | `otpDisable` | const arrow | 623 |
| 91 | `otpVerify` | const arrow | 627 |
| 92 | `otpStatus` | const arrow | 631 |
| 93 | `listImportJobs` | const arrow | 651 |
| 94 | `getImportJobReview` | const arrow | 659 |
| 95 | `updateImportJobDecisions` | const arrow | 663 |
| 96 | `startImportJob` | const arrow | 671 |
| 97 | `approveImportJob` | const arrow | 675 |
| 98 | `cancelImportJob` | const arrow | 679 |
| 99 | `retryImportJob` | const arrow | 683 |
| 100 | `deleteImportJob` | const arrow | 687 |
| 101 | `getImportQueueStatus` | const arrow | 691 |
| 102 | `getFiles` | const arrow | 712 |
| 103 | `deleteFileAsset` | const arrow | 722 |
| 104 | `getActionHistory` | const arrow | 767 |
| 105 | `updateActionHistory` | const arrow | 775 |
| 106 | `getInventorySummary` | const arrow | 787 |
| 107 | `getInventoryStats` | const arrow | 791 |
| 108 | `getInventoryBootstrap` | const arrow | 795 |
| 109 | `searchInventoryProducts` | const arrow | 799 |
| 110 | `getInventoryMovements` | const arrow | 803 |
| 111 | `getInventoryReasons` | const arrow | 807 |
| 112 | `saveInventoryReasons` | const arrow | 811 |
| 113 | `getRfidStatus` | const arrow | 816 |
| 114 | `searchRfidTags` | const arrow | 824 |
| 115 | `recordRfidSessionEvents` | const arrow | 832 |
| 116 | `applyRfidSession` | const arrow | 840 |
| 117 | `getSales` | const arrow | 851 |
| 118 | `getCustomers` | const arrow | 858 |
| 119 | `getCustomerPointSummaries` | const arrow | 862 |
| 120 | `updateCustomer` | const arrow | 870 |
| 121 | `deleteCustomer` | const arrow | 874 |
| 122 | `downloadCustomerTemplate` | const arrow | 882 |
| 123 | `getSuppliers` | const arrow | 888 |
| 124 | `updateSupplier` | const arrow | 896 |
| 125 | `deleteSupplier` | const arrow | 900 |
| 126 | `downloadSupplierTemplate` | const arrow | 908 |
| 127 | `getDeliveryContacts` | const arrow | 914 |
| 128 | `updateDeliveryContact` | const arrow | 922 |
| 129 | `deleteDeliveryContact` | const arrow | 926 |
| 130 | `getUsers` | const arrow | 936 |
| 131 | `updateUser` | const arrow | 944 |
| 132 | `getUserProfile` | const arrow | 948 |
| 133 | `getUserAuthMethods` | const arrow | 952 |
| 134 | `updateUserProfile` | const arrow | 956 |
| 135 | `disconnectUserAuthProvider` | const arrow | 960 |
| 136 | `changeUserPassword` | const arrow | 964 |
| 137 | `resetPassword` | const arrow | 968 |
| 138 | `getRoles` | const arrow | 974 |
| 139 | `updateRole` | const arrow | 982 |
| 140 | `deleteRole` | const arrow | 986 |
| 141 | `getIntegrationDoctor` | const arrow | 1007 |
| 142 | `getGoogleDriveSyncStatus` | const arrow | 1032 |
| 143 | `saveGoogleDriveSyncPreferences` | const arrow | 1037 |
| 144 | `startGoogleDriveSyncOauth` | const arrow | 1042 |
| 145 | `disconnectGoogleDriveSync` | const arrow | 1047 |
| 146 | `forgetGoogleDriveSyncCredentials` | const arrow | 1052 |
| 147 | `queueGoogleDriveSyncNow` | const arrow | 1057 |
| 148 | `syncGoogleDriveNow` | const arrow | 1062 |
| 149 | `openPath` | const arrow | 1127 |
| 150 | `getReturns` | const arrow | 1131 |
| 151 | `getReturn` | const arrow | 1143 |
| 152 | `updateSaleStatus` | const arrow | 1149 |
| 153 | `attachSaleCustomer` | const arrow | 1155 |
| 154 | `getSalesExport` | const arrow | 1160 |
| 155 | `updateReturn` | const arrow | 1164 |
| 156 | `testSyncServer` | const arrow | 1171 |
| 157 | `openFolderDialog` | const arrow | 1176 |
| 158 | `getDataPath` | const arrow | 1180 |
| 159 | `getScaleMigrationStatus` | const arrow | 1182 |
| 160 | `prepareScaleMigration` | const arrow | 1184 |
| 161 | `runScaleMigration` | const arrow | 1186 |
| 162 | `browseDir` | const arrow | 1198 |

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

### 3.36 `frontend/src/api/portalPublicTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readJsonObject` | function | 12 |
| 2 | `getPortalBaseUrl` | function | 16 |
| 3 | `buildQueryString` | function | 20 |
| 4 | `appendQuery` | function | 32 |
| 5 | `appendQueryValue` | function | 36 |
| 6 | `fetchJsonWithTimeout` | function | 41 |
| 7 | `fetchPortalJson` | function | 63 |

### 3.37 `frontend/src/api/portalTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readJsonObject` | function | 18 |
| 2 | `fetchPortalJson` | function | 22 |

### 3.38 `frontend/src/api/productImageUploadTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `dataUrlToBlob` | function | 10 |

### 3.39 `frontend/src/api/productReadTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `scheduleProductCacheWrite` | function | 14 |
| 2 | `scheduleProductsMirror` | function | 27 |
| 3 | `readProductCache` | function | 40 |
| 4 | `routeCachedProductQuery` | function | 44 |

### 3.40 `frontend/src/api/productWriteTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDevicePayload` | function | 9 |
| 2 | `encodeId` | function | 13 |
| 3 | `ensureSupplierExists` | function | 17 |

### 3.41 `frontend/src/api/query.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `appendQueryValue` | function | 44 |

### 3.42 `frontend/src/api/queryCache.ts`

- No top-level named function/class symbols detected.

### 3.43 `frontend/src/api/requestIds.ts`

- No top-level named function/class symbols detected.

### 3.44 `frontend/src/api/returnsReadTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `encodeId` | function | 4 |

### 3.45 `frontend/src/api/returnsTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `encodeId` | function | 21 |
| 2 | `getDevicePayload` | function | 25 |
| 3 | `getResultTimestamp` | function | 29 |
| 4 | `buildReturnNumber` | function | 34 |
| 5 | `attachAttemptedReturnUpdate` | function | 38 |

### 3.46 `frontend/src/api/rfidTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDevicePayload` | function | 7 |
| 2 | `encodeId` | function | 11 |

### 3.47 `frontend/src/api/salesTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `encodeId` | function | 21 |
| 2 | `getDevicePayload` | function | 25 |
| 3 | `getResultTimestamp` | function | 29 |
| 4 | `attachAttempted` | function | 34 |

### 3.48 `frontend/src/api/saleWriteTransport.ts`

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

### 3.49 `frontend/src/api/settingsTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `asSettingsPayload` | function | 27 |
| 2 | `asSettingsConflictError` | function | 31 |
| 3 | `saveSettingsLocally` | function | 35 |
| 4 | `saveSettingsMeta` | function | 39 |
| 5 | `getServerSettings` | function | 43 |
| 6 | `saveSettingsOnce` | function | 64 |

### 3.50 `frontend/src/api/syncPreview.ts`

- No top-level named function/class symbols detected.

### 3.51 `frontend/src/api/syncRuntime.ts`

- No top-level named function/class symbols detected.

### 3.52 `frontend/src/api/systemJobs.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `wait` | function | 25 |
| 2 | `requireJobId` | function | 29 |
| 3 | `unwrapSystemJob` | function | 35 |

### 3.53 `frontend/src/api/systemRuntime.ts`

- No top-level named function/class symbols detected.

### 3.54 `frontend/src/api/userAdminTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `encodeId` | function | 8 |

### 3.55 `frontend/src/api/userReadTransport.ts`

- No top-level named function/class symbols detected.

### 3.56 `frontend/src/api/websocket.ts`

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

### 3.57 `frontend/src/App.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `asPageModule` | function | 187 |
| 2 | `getAppShellApi` | function | 191 |
| 3 | `readStorageValue` | function | 195 |
| 4 | `hasUsableStoredAuthSession` | function | 203 |
| 5 | `getConnection` | function | 221 |
| 6 | `isPageId` | function | 227 |
| 7 | `normalizePageId` | function | 231 |
| 8 | `getErrorMessage` | function | 235 |
| 9 | `getChunkErrorMessage` | function | 336 |
| 10 | `isChunkLoadError` | function | 341 |
| 11 | `createChunkTimeoutError` | function | 350 |
| 12 | `isRetryableImportError` | function | 356 |
| 13 | `importWithTimeout` | function | 364 |
| 14 | `clearRetryMarker` | function | 380 |
| 15 | `buildChunkRecoveryUrl` | function | 387 |
| 16 | `deleteStaleShellCaches` | function | 398 |
| 17 | `clearStaleShellCaches` | function | 411 |
| 18 | `triggerChunkRecoveryReload` | function | 421 |
| 19 | `reload` | const arrow | 428 |
| 20 | `createChunkReloadStallError` | function | 438 |
| 21 | `shouldRetryChunk` | function | 444 |
| 22 | `lazyWithRetry` | function | 454 |
| 23 | `getWarmupImporters` | function | 532 |
| 24 | `shouldSkipBackgroundWarmup` | function | 543 |
| 25 | `shouldSkipIntentWarmup` | function | 552 |
| 26 | `getIntentPageId` | function | 561 |
| 27 | `scheduleIntentChunkLoad` | function | 567 |
| 28 | `run` | const arrow | 574 |
| 29 | `scheduleInitialPendingSyncRefresh` | function | 598 |
| 30 | `run` | const arrow | 604 |
| 31 | `scheduleDeferredPendingSyncPolling` | function | 626 |
| 32 | `isImportTrackerWakeEvent` | function | 640 |
| 33 | `isNotificationCenterWakeEvent` | function | 655 |
| 34 | `getDataWarmupLoaders` | function | 673 |
| 35 | `createWarmupLoader` | function | 682 |
| 36 | `runWarmupBatches` | function | 687 |
| 37 | `scheduleWarmupAfterLoad` | function | 696 |
| 38 | `run` | const arrow | 701 |
| 39 | `getPageEntryWarmupLoaders` | function | 719 |
| 40 | `useMountedPages` | function | 726 |
| 41 | `syncProfile` | const arrow | 740 |
| 42 | `useSyncErrorBanner` | function | 769 |
| 43 | `refreshPendingSync` | const arrow | 789 |
| 44 | `onSyncError` | const arrow | 794 |
| 45 | `onTransientOutage` | const arrow | 800 |
| 46 | `onSyncRecovered` | const arrow | 808 |
| 47 | `onQueueChanged` | const arrow | 816 |
| 48 | `onVaultLocked` | const arrow | 817 |
| 49 | `onAppUpdate` | const arrow | 818 |
| 50 | `onConflictReview` | const arrow | 819 |
| 51 | `useDeferredImportTrackerMount` | function | 867 |
| 52 | `enable` | const arrow | 880 |
| 53 | `enableWhenVisible` | const arrow | 884 |
| 54 | `onImportJobActivity` | const arrow | 889 |
| 55 | `useDeferredQuickPreferencesMount` | function | 914 |
| 56 | `enable` | const arrow | 927 |
| 57 | `useDeferredNotificationCenterMount` | function | 951 |
| 58 | `enable` | const arrow | 970 |
| 59 | `enableWhenVisible` | const arrow | 974 |
| 60 | `onSyncUpdate` | const arrow | 978 |
| 61 | `onNotificationActivity` | const arrow | 981 |
| 62 | `useVisibilityRecovery` | function | 1016 |
| 63 | `onVisible` | const arrow | 1021 |
| 64 | `onFocus` | const arrow | 1031 |
| 65 | `useChunkWarmup` | function | 1049 |
| 66 | `runWarmup` | const arrow | 1060 |
| 67 | `useIntentChunkWarmup` | function | 1102 |
| 68 | `warmIntentPage` | const arrow | 1109 |
| 69 | `useDataWarmup` | function | 1129 |
| 70 | `runWarmup` | const arrow | 1141 |
| 71 | `usePageEntryWarmup` | function | 1166 |
| 72 | `run` | const arrow | 1196 |
| 73 | `PageErrorBoundary` | class | 1225 |
| 74 | `Notification` | function | 1278 |
| 75 | `SyncErrorBanner` | function | 1291 |
| 76 | `GlobalScrollControls` | function | 1313 |
| 77 | `scrollTo` | const arrow | 1314 |
| 78 | `formatSyncTimestamp` | function | 1351 |
| 79 | `OfflineModeBanner` | function | 1366 |
| 80 | `PageLoader` | function | 1515 |
| 81 | `NotificationCenterFallback` | function | 1576 |
| 82 | `PageSlot` | function | 1591 |
| 83 | `PublicCatalogView` | function | 1617 |
| 84 | `App` | component/function | 1627 |
| 85 | `cleanupRecoveryStorageMarkers` | const arrow | 1705 |
| 86 | `onQueued` | const arrow | 1734 |
| 87 | `onSynced` | const arrow | 1747 |
| 88 | `handleLocationChange` | const arrow | 1772 |
| 89 | `processFavicon` | function | 1820 |

### 3.58 `frontend/src/app/AppContextCore.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizePriceValue` | function | 62 |

### 3.59 `frontend/src/app/appShellUtils.ts`

- No top-level named function/class symbols detected.

### 3.60 `frontend/src/app/pathRouting.ts`

- No top-level named function/class symbols detected.

### 3.61 `frontend/src/app/PublicCatalogAppProvider.tsx`

- No top-level named function/class symbols detected.

### 3.62 `frontend/src/app/publicErrorRecovery.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getRecoveryStorage` | function | 6 |

### 3.63 `frontend/src/AppContext.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getAppApi` | function | 204 |
| 2 | `getErrorMessage` | function | 214 |
| 3 | `flattenTranslationTree` | function | 218 |
| 4 | `safeStorageGet` | function | 377 |
| 5 | `safeStorageSet` | function | 385 |
| 6 | `safeStorageRemove` | function | 391 |
| 7 | `getStoredUserPayload` | function | 397 |
| 8 | `getStoredUserExpiry` | function | 401 |
| 9 | `clearPersistedAuthState` | function | 405 |
| 10 | `persistAuthState` | function | 418 |
| 11 | `computeSessionExpiryMs` | function | 440 |
| 12 | `readDeviceSettings` | function | 456 |
| 13 | `writeDeviceSettings` | function | 465 |
| 14 | `writeStoredSessionDuration` | function | 471 |
| 15 | `readPendingOauthLink` | function | 479 |
| 16 | `clearPendingOauthLink` | function | 493 |
| 17 | `readOauthCallbackResult` | function | 499 |
| 18 | `clearOauthCallbackResult` | function | 510 |
| 19 | `mergeSettingsWithDeviceOverrides` | function | 516 |
| 20 | `normalizeDateInput` | function | 520 |
| 21 | `buildRuntimeDescriptorFromBootstrap` | function | 526 |
| 22 | `getInitialAdminPage` | function | 555 |
| 23 | `LoadingScreen` | function | 560 |
| 24 | `AccessDenied` | function | 573 |
| 25 | `persistAutoSyncUrl` | const arrow | 667 |
| 26 | `onUpdate` | const arrow | 865 |
| 27 | `onStatus` | const arrow | 897 |
| 28 | `poll` | const arrow | 906 |
| 29 | `onError` | const arrow | 926 |
| 30 | `onWriteBlocked` | const arrow | 948 |
| 31 | `onRuntimeMismatch` | const arrow | 958 |
| 32 | `onConflict` | const arrow | 978 |
| 33 | `onUnauthorized` | const arrow | 1047 |
| 34 | `handleOtpLogin` | const arrow | 1106 |
| 35 | `handleUserUpdated` | const arrow | 1148 |
| 36 | `discoverSyncUrl` | const arrow | 1185 |
| 37 | `runStartupHealthProbe` | const arrow | 1208 |
| 38 | `loadLanguagePack` | const arrow | 1302 |
| 39 | `scheduleDeferredLanguagePack` | const arrow | 1313 |
| 40 | `runWhenIdle` | const arrow | 1314 |
| 41 | `clearCallbackUrl` | const arrow | 1618 |
| 42 | `clearPendingLink` | const arrow | 1622 |
| 43 | `run` | const arrow | 1626 |

### 3.64 `frontend/src/components/auth/Login.tsx`

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

### 3.65 `frontend/src/components/branches/Branches.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBranchApi` | function | 205 |
| 2 | `getErrorMessage` | function | 217 |
| 3 | `isBranchRecord` | function | 221 |
| 4 | `isTransferRecord` | function | 225 |
| 5 | `BranchStatTile` | function | 229 |
| 6 | `formatTransferDate` | function | 246 |
| 7 | `Branches` | component/function | 263 |
| 8 | `promise` | const arrow | 315 |
| 9 | `loadBranchStock` | const arrow | 462 |
| 10 | `loadMoreBranchStock` | const arrow | 483 |
| 11 | `handleSaveBranch` | const arrow | 514 |
| 12 | `handleDelete` | const arrow | 588 |
| 13 | `handleBulkDelete` | const arrow | 636 |
| 14 | `toggleSelect` | const arrow | 722 |
| 15 | `toggleSelectAll` | const arrow | 731 |

### 3.66 `frontend/src/components/branches/BranchForm.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `BranchForm` | component/function | 37 |
| 2 | `handleSave` | const arrow | 57 |

### 3.67 `frontend/src/components/branches/TransferModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getTransferApi` | function | 76 |
| 2 | `getErrorMessage` | function | 83 |
| 3 | `normalizeTransferStockRows` | function | 87 |
| 4 | `TransferModal` | component/function | 101 |
| 5 | `loadStock` | function | 165 |
| 6 | `handleTransfer` | const arrow | 213 |

### 3.68 `frontend/src/components/catalog/catalogAssetUrls.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `trimBaseUrl` | function | 9 |
| 2 | `normalizeUploadPath` | function | 13 |
| 3 | `isLocalLikeHostname` | function | 21 |
| 4 | `getSafeCurrentOrigin` | function | 25 |
| 5 | `getStoredCatalogAssetBaseUrl` | function | 37 |
| 6 | `api` | const arrow | 40 |
| 7 | `appendAssetVersion` | function | 51 |

### 3.69 `frontend/src/components/catalog/CatalogEditorSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toAiProviderOptions` | function | 118 |
| 2 | `CatalogEditorSurface` | component/function | 219 |
| 3 | `CatalogEditorSurfaceContent` | function | 227 |

### 3.70 `frontend/src/components/catalog/CatalogImageField.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `CatalogImageField` | component/function | 29 |

### 3.71 `frontend/src/components/catalog/catalogImages.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getImageApi` | function | 19 |
| 2 | `isRecentlyBrokenCatalogImage` | function | 23 |
| 3 | `markBrokenCatalogImage` | function | 31 |
| 4 | `CatalogProductImage` | component/function | 36 |
| 5 | `loadImageData` | function | 78 |

### 3.72 `frontend/src/components/catalog/CatalogPage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadCatalogEditorSurface` | const arrow | 48 |
| 2 | `loadCatalogProductsSection` | const arrow | 49 |
| 3 | `loadCatalogSecondaryTabs` | const arrow | 50 |
| 4 | `loadPortalTranslateControllerModule` | function | 57 |
| 5 | `loadPortalLanguagePacksModule` | function | 63 |
| 6 | `loadPortalContentI18nModule` | function | 69 |
| 7 | `getCatalogApi` | function | 202 |
| 8 | `getCatalogErrorMessage` | function | 206 |
| 9 | `createInitialUploadState` | function | 210 |
| 10 | `isTemporaryPreviewUrl` | function | 224 |
| 11 | `sanitizePersistedMediaPath` | function | 229 |
| 12 | `buildCacheBustedMediaPath` | function | 236 |
| 13 | `reduceUploadState` | function | 254 |
| 14 | `normalizePortalInitialOptions` | function | 321 |
| 15 | `normalizeCatalogOptions` | function | 330 |
| 16 | `normalizeBrandOptions` | function | 341 |
| 17 | `getAboutBlockLabel` | function | 346 |
| 18 | `withAssetVersion` | function | 352 |
| 19 | `sanitizePortalMediaValue` | function | 362 |
| 20 | `tt` | function | 372 |
| 21 | `toBoolean` | function | 386 |
| 22 | `toNumber` | function | 393 |
| 23 | `normalizePriceDisplay` | function | 400 |
| 24 | `normalizeHexColor` | function | 406 |
| 25 | `normalizeExternalUrl` | function | 412 |
| 26 | `createFaqId` | function | 428 |
| 27 | `normalizeFaqItems` | function | 432 |
| 28 | `translatedPortalText` | function | 488 |
| 29 | `translateConfiguredFaqText` | function | 494 |
| 30 | `localizeConfiguredFaqItems` | function | 501 |
| 31 | `buildFaqStarterItems` | function | 509 |
| 32 | `buildAiFaqStarterItems` | function | 518 |
| 33 | `hexToRgba` | function | 528 |
| 34 | `readPortalCache` | function | 539 |
| 35 | `writePortalCache` | function | 574 |
| 36 | `normalizePortalPath` | function | 592 |
| 37 | `isReservedPortalPath` | function | 605 |
| 38 | `getPortalTabs` | function | 609 |
| 39 | `resolvePortalActiveTab` | function | 620 |
| 40 | `buildDraft` | function | 628 |
| 41 | `applyDraft` | function | 728 |
| 42 | `getBranchQty` | function | 852 |
| 43 | `getStockStatus` | function | 859 |
| 44 | `normalizeProductGallery` | function | 870 |
| 45 | `normalizePortalProductSearch` | function | 887 |
| 46 | `buildRecommendedProductOption` | function | 891 |
| 47 | `productMatchesRecommendedSearch` | function | 901 |
| 48 | `formatDateTime` | function | 916 |
| 49 | `formatPortalPrice` | function | 924 |
| 50 | `readImageFileAsDataUrl` | function | 936 |
| 51 | `readImageFilesAsDataUrls` | function | 945 |
| 52 | `pickImageAsDataUrl` | function | 968 |
| 53 | `pickMultipleImagesAsDataUrls` | function | 981 |
| 54 | `replaceVars` | function | 994 |
| 55 | `canonicalPortalTranslateLanguage` | function | 1033 |
| 56 | `normalizeExternalTranslateTarget` | function | 1042 |
| 57 | `isFirstPartyTranslateTarget` | function | 1048 |
| 58 | `normalizePortalTranslateChoice` | function | 1055 |
| 59 | `readGoogleTranslateCookieTarget` | function | 1063 |
| 60 | `readStoredTranslateTargetLocal` | function | 1077 |
| 61 | `removePortalTranslateWidgetHostLocal` | function | 1090 |
| 62 | `isDocumentVisible` | function | 1095 |
| 63 | `sleep` | function | 1100 |
| 64 | `CatalogPage` | component/function | 1206 |
| 65 | `updateMediaUploadState` | const arrow | 1492 |
| 66 | `forgetMediaUploadState` | const arrow | 1499 |
| 67 | `loadAssistantStatus` | function | 1551 |
| 68 | `openProductGallery` | function | 1574 |
| 69 | `changeTranslateTarget` | function | 1587 |
| 70 | `isPortalLoadCurrent` | function | 1647 |
| 71 | `loadPortalEditorData` | function | 1651 |
| 72 | `refreshPortalView` | function | 1693 |
| 73 | `loadPortal` | function | 1722 |
| 74 | `ensureLink` | const arrow | 1986 |
| 75 | `renderRoundedFavicon` | const arrow | 2026 |
| 76 | `updateVisibility` | const arrow | 2103 |
| 77 | `handleScroll` | const arrow | 2133 |
| 78 | `setupExternalTranslateWidget` | function | 2177 |
| 79 | `toggleFilterValue` | function | 2290 |
| 80 | `clearPortalFilters` | function | 2298 |
| 81 | `setDraft` | function | 2306 |
| 82 | `toggleRecommendedProduct` | function | 2311 |
| 83 | `openPortalImage` | function | 2320 |
| 84 | `setAboutBlocksDraft` | function | 2331 |
| 85 | `setPromoItemsDraft` | function | 2335 |
| 86 | `getPortalMediaValue` | function | 2339 |
| 87 | `setPortalMediaValue` | function | 2353 |
| 88 | `clearPortalUploadPreview` | function | 2367 |
| 89 | `clearPortalMediaTarget` | function | 2373 |
| 90 | `uploadPortalMedia` | function | 2384 |
| 91 | `cancelPortalMediaUpload` | function | 2455 |
| 92 | `updateAboutBlock` | function | 2461 |
| 93 | `updatePromoItem` | function | 2467 |
| 94 | `addAboutBlock` | function | 2473 |
| 95 | `addPromoItem` | function | 2477 |
| 96 | `moveAboutBlockBefore` | function | 2481 |
| 97 | `removeAboutBlock` | function | 2493 |
| 98 | `movePromoItemBefore` | function | 2504 |
| 99 | `removePromoItem` | function | 2516 |
| 100 | `setFaqDraft` | function | 2527 |
| 101 | `addFaqItem` | function | 2531 |
| 102 | `mergeFaqStarterItems` | function | 2542 |
| 103 | `addFaqStarterSet` | function | 2555 |
| 104 | `addAiFaqStarterSet` | function | 2559 |
| 105 | `updateFaqItem` | function | 2563 |
| 106 | `removeFaqItem` | function | 2569 |
| 107 | `clearAssistantState` | function | 2573 |
| 108 | `uploadDraftImage` | function | 2588 |
| 109 | `uploadAboutBlockMedia` | function | 2592 |
| 110 | `uploadPromoItemMedia` | function | 2598 |
| 111 | `openFilePicker` | function | 2602 |
| 112 | `handleFilePickerSelect` | function | 2606 |
| 113 | `savePortalDraft` | function | 2634 |
| 114 | `askAssistant` | function | 2826 |
| 115 | `refreshMembershipData` | function | 2872 |
| 116 | `handleMembershipLookup` | function | 2914 |
| 117 | `addSubmissionImages` | function | 2927 |
| 118 | `handleSubmissionPaste` | function | 2937 |
| 119 | `handleSubmitShareProof` | function | 2953 |
| 120 | `handleReviewSubmission` | function | 3000 |
| 121 | `renderCatalogSection` | function | 3160 |
| 122 | `handleUploadSubmissionImages` | const arrow | 3183 |
| 123 | `handlePortalTabChange` | const arrow | 3239 |
| 124 | `renderSecondaryTabPanel` | function | 3247 |
| 125 | `renderSecondaryTabFallback` | function | 3259 |
| 126 | `renderSecondaryTabSection` | function | 3283 |
| 127 | `scrollPublicPortal` | const arrow | 3408 |

### 3.73 `frontend/src/components/catalog/CatalogPageContext.tsx`

- No top-level named function/class symbols detected.

### 3.74 `frontend/src/components/catalog/catalogPagination.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `clampCatalogPage` | function | 26 |
| 2 | `CatalogPageSizeSelect` | function | 40 |
| 3 | `CatalogPaginationControls` | component/function | 80 |
| 4 | `commitPageDraft` | const arrow | 106 |
| 5 | `handlePageInputKeyDown` | const arrow | 117 |

### 3.75 `frontend/src/components/catalog/CatalogPreviewSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `CatalogPreviewSurface` | component/function | 114 |
| 2 | `handlePortalTabClick` | const arrow | 152 |

### 3.76 `frontend/src/components/catalog/CatalogProductsSection.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBadgeIcon` | function | 120 |
| 2 | `getBadgeToneClass` | function | 128 |
| 3 | `getProductInitial` | function | 137 |
| 4 | `CatalogProductsSection` | component/function | 145 |

### 3.77 `frontend/src/components/catalog/CatalogSecondaryTabs.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toAssistantSelectOptions` | function | 204 |
| 2 | `normalizePortalColor` | function | 275 |
| 3 | `CatalogMembershipSection` | function | 280 |
| 4 | `CatalogAboutSection` | function | 626 |
| 5 | `CatalogFaqSection` | function | 847 |
| 6 | `CatalogAiSection` | function | 901 |
| 7 | `CatalogSecondaryTabs` | component/function | 1109 |

### 3.78 `frontend/src/components/catalog/catalogUi.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `statusClass` | function | 22 |

### 3.79 `frontend/src/components/catalog/portalCatalogDisplay.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toFiniteNumber` | function | 25 |
| 2 | `normalizePriceValue` | function | 30 |
| 3 | `normalizeDiscountPercent` | function | 36 |
| 4 | `isPortalDiscountActive` | function | 40 |
| 5 | `calculatePortalDiscount` | function | 53 |
| 6 | `replaceRankVars` | function | 237 |
| 7 | `normalizeRankBadgeLabel` | function | 241 |

### 3.80 `frontend/src/components/catalog/portalContentI18n.ts`

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

### 3.81 `frontend/src/components/catalog/portalEditorUtils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPlainObject` | function | 47 |
| 2 | `toTrimmedString` | function | 51 |

### 3.82 `frontend/src/components/catalog/portalLanguageOptions.ts`

- No top-level named function/class symbols detected.

### 3.83 `frontend/src/components/catalog/portalLanguagePacks.ts`

- No top-level named function/class symbols detected.

### 3.84 `frontend/src/components/catalog/portalTranslateController.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeLanguage` | function | 39 |
| 2 | `ensureLinkHint` | function | 131 |
| 3 | `initWidget` | const arrow | 216 |
| 4 | `waitForWidget` | const arrow | 233 |

### 3.85 `frontend/src/components/catalog/portalTranslationData.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPlainObject` | function | 3 |

### 3.86 `frontend/src/components/catalog/PublicCatalogPage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadCatalogProductsSection` | const arrow | 20 |
| 2 | `getCatalogApi` | function | 197 |
| 3 | `getErrorMessage` | function | 201 |
| 4 | `toNumber` | function | 205 |
| 5 | `normalizePriceDisplay` | function | 211 |
| 6 | `normalizeHexColor` | function | 216 |
| 7 | `hexToRgba` | function | 221 |
| 8 | `normalizeExternalUrl` | function | 230 |
| 9 | `normalizeCatalogOptions` | function | 245 |
| 10 | `normalizeBrandOptions` | function | 253 |
| 11 | `normalizePortalInitialOptions` | function | 258 |
| 12 | `normalizeFaqItems` | function | 263 |
| 13 | `readPortalCache` | function | 274 |
| 14 | `writePortalCache` | function | 308 |
| 15 | `readEmbeddedPortalBootstrap` | function | 321 |
| 16 | `withAssetVersion` | function | 342 |
| 17 | `buildPortalBackground` | function | 349 |
| 18 | `getPortalTabs` | function | 360 |
| 19 | `resolvePortalActiveTab` | function | 371 |
| 20 | `getBranchQty` | function | 376 |
| 21 | `getStockStatus` | function | 382 |
| 22 | `normalizeProductGallery` | function | 392 |
| 23 | `formatPortalPrice` | function | 407 |
| 24 | `formatDateTime` | function | 419 |
| 25 | `replaceVars` | function | 426 |
| 26 | `readImageFileAsDataUrl` | function | 430 |
| 27 | `readImageFilesAsDataUrls` | function | 439 |
| 28 | `pickMultipleImagesAsDataUrls` | function | 457 |
| 29 | `normalizeBootstrapPayload` | function | 469 |
| 30 | `PublicCatalogPage` | component/function | 482 |
| 31 | `toggleFilterValue` | const arrow | 680 |
| 32 | `clearPortalFilters` | const arrow | 683 |
| 33 | `openProductGallery` | const arrow | 691 |
| 34 | `openPortalImage` | const arrow | 696 |
| 35 | `handleMembershipLookup` | const arrow | 701 |
| 36 | `handleSubmissionPaste` | const arrow | 717 |
| 37 | `handleUploadSubmissionImages` | const arrow | 725 |
| 38 | `handleSubmitShareProof` | const arrow | 730 |
| 39 | `clearAssistantState` | const arrow | 745 |
| 40 | `askAssistant` | const arrow | 750 |
| 41 | `scrollPublicPortal` | const arrow | 882 |

### 3.87 `frontend/src/components/contacts/ContactImportModal.tsx`

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

### 3.88 `frontend/src/components/contacts/contactImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.89 `frontend/src/components/contacts/contactOptionUtils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPlainRecord` | function | 24 |
| 2 | `readStringField` | function | 28 |
| 3 | `normalizeOption` | function | 45 |

### 3.90 `frontend/src/components/contacts/Contacts.tsx`

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

### 3.91 `frontend/src/components/contacts/CustomerFormModal.tsx`

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

### 3.92 `frontend/src/components/contacts/customerMembershipNumber.ts`

- No top-level named function/class symbols detected.

### 3.93 `frontend/src/components/contacts/CustomersTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadContactReadTransportModule` | function | 129 |
| 2 | `loadContactWriteTransportModule` | function | 134 |
| 3 | `loadCsvUtilsModule` | function | 139 |
| 4 | `getCustomerApi` | function | 144 |
| 5 | `isSectionRow` | function | 153 |
| 6 | `normalizeCustomerRows` | function | 157 |
| 7 | `getApiListPayload` | function | 164 |
| 8 | `getErrorMessage` | function | 168 |
| 9 | `formatPoints` | function | 172 |
| 10 | `tr` | function | 184 |
| 11 | `CustomersTab` | function | 193 |
| 12 | `toggleSectionCollapsed` | const arrow | 356 |
| 13 | `isSectionFullySelected` | const arrow | 362 |
| 14 | `isSectionPartiallySelected` | const arrow | 363 |
| 15 | `toggleSectionSelection` | const arrow | 364 |
| 16 | `promise` | const arrow | 398 |
| 17 | `handleSave` | const arrow | 482 |
| 18 | `handleDelete` | const arrow | 559 |
| 19 | `handleBulkDelete` | const arrow | 598 |

### 3.94 `frontend/src/components/contacts/DeliveryTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadContactReadTransportModule` | function | 124 |
| 2 | `loadContactWriteTransportModule` | function | 129 |
| 3 | `loadCsvUtilsModule` | function | 134 |
| 4 | `getDeliveryApi` | function | 139 |
| 5 | `normalizeDeliveryRows` | function | 148 |
| 6 | `isSectionRow` | function | 156 |
| 7 | `getErrorMessage` | function | 160 |
| 8 | `BLANK_OPTION` | const arrow | 177 |
| 9 | `OptionEditor` | function | 188 |
| 10 | `set` | const arrow | 189 |
| 11 | `fieldId` | const arrow | 190 |
| 12 | `DeliveryForm` | function | 235 |
| 13 | `set` | const arrow | 244 |
| 14 | `addOption` | const arrow | 245 |
| 15 | `updateOption` | const arrow | 249 |
| 16 | `removeOption` | const arrow | 250 |
| 17 | `handleSave` | const arrow | 251 |
| 18 | `OptionsDisplay` | function | 321 |
| 19 | `OptionsBadge` | function | 338 |
| 20 | `DeliveryTab` | function | 349 |
| 21 | `toggleSectionCollapsed` | const arrow | 490 |
| 22 | `isSectionFullySelected` | const arrow | 496 |
| 23 | `isSectionPartiallySelected` | const arrow | 497 |
| 24 | `toggleSectionSelection` | const arrow | 498 |
| 25 | `promise` | const arrow | 530 |
| 26 | `handleSave` | const arrow | 601 |
| 27 | `handleDelete` | const arrow | 663 |
| 28 | `handleBulkDelete` | const arrow | 700 |

### 3.95 `frontend/src/components/contacts/shared.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toggleOne` | const arrow | 100 |
| 2 | `clearSelection` | const arrow | 111 |
| 3 | `menuContent` | const arrow | 165 |

### 3.96 `frontend/src/components/contacts/SuppliersTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadContactReadTransportModule` | function | 127 |
| 2 | `loadContactWriteTransportModule` | function | 132 |
| 3 | `loadCsvUtilsModule` | function | 137 |
| 4 | `getSupplierApi` | function | 142 |
| 5 | `normalizeSupplierRows` | function | 151 |
| 6 | `isSectionRow` | function | 159 |
| 7 | `getErrorMessage` | function | 163 |
| 8 | `SupplierForm` | function | 174 |
| 9 | `set` | const arrow | 190 |
| 10 | `addOption` | const arrow | 191 |
| 11 | `updateOption` | const arrow | 195 |
| 12 | `removeOption` | const arrow | 196 |
| 13 | `handleSubmit` | const arrow | 197 |
| 14 | `fieldId` | const arrow | 245 |
| 15 | `SuppliersTab` | function | 291 |
| 16 | `toggleSectionCollapsed` | const arrow | 439 |
| 17 | `isSectionFullySelected` | const arrow | 445 |
| 18 | `isSectionPartiallySelected` | const arrow | 446 |
| 19 | `toggleSectionSelection` | const arrow | 447 |
| 20 | `promise` | const arrow | 481 |
| 21 | `handleSave` | const arrow | 553 |
| 22 | `handleDelete` | const arrow | 623 |
| 23 | `handleBulkDelete` | const arrow | 662 |

### 3.97 `frontend/src/components/custom-tables/CustomTables.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadCustomTablesApi` | function | 64 |
| 2 | `getCustomTablesRequest` | function | 69 |
| 3 | `createCustomTableRequest` | function | 73 |
| 4 | `getCustomTableDataRequest` | function | 77 |
| 5 | `insertCustomRowRequest` | function | 81 |
| 6 | `updateCustomRowRequest` | function | 85 |
| 7 | `deleteCustomRowRequest` | function | 95 |
| 8 | `getErrorMessage` | function | 103 |
| 9 | `getHistoryResultId` | function | 107 |
| 10 | `formatCellValue` | function | 111 |
| 11 | `toInputValue` | function | 118 |
| 12 | `normalizeRowValue` | function | 125 |
| 13 | `normalizeCustomTable` | function | 138 |
| 14 | `parseSchema` | function | 151 |
| 15 | `normalizeRows` | function | 172 |
| 16 | `buildRowPayload` | function | 178 |
| 17 | `CustomTables` | component/function | 187 |
| 18 | `addColumn` | const arrow | 303 |
| 19 | `updateColumn` | const arrow | 310 |
| 20 | `removeColumn` | const arrow | 319 |
| 21 | `handleCreateTable` | const arrow | 326 |
| 22 | `handleSaveRow` | const arrow | 373 |
| 23 | `handleDeleteRow` | const arrow | 454 |
| 24 | `openAddRow` | const arrow | 502 |
| 25 | `openEditRow` | const arrow | 509 |

### 3.98 `frontend/src/components/dashboard/charts/BarChart.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `chartLabelsNeedYear` | function | 23 |
| 2 | `formatAxisLabel` | function | 32 |
| 3 | `BarChart` | component/function | 45 |
| 4 | `updateWidth` | const arrow | 53 |
| 5 | `yPx` | function | 89 |

### 3.99 `frontend/src/components/dashboard/charts/DonutChart.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `DonutChart` | component/function | 22 |

### 3.100 `frontend/src/components/dashboard/charts/index.ts`

- No top-level named function/class symbols detected.

### 3.101 `frontend/src/components/dashboard/charts/LineChart.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `chartLabelsNeedYear` | function | 28 |
| 2 | `formatAxisLabel` | function | 37 |
| 3 | `LineChart` | component/function | 50 |
| 4 | `updateWidth` | const arrow | 58 |
| 5 | `xPx` | function | 100 |
| 6 | `yPx` | function | 104 |
| 7 | `handleMouseMove` | const arrow | 114 |

### 3.102 `frontend/src/components/dashboard/charts/NoData.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `NoData` | component/function | 1 |

### 3.103 `frontend/src/components/dashboard/Dashboard.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDashboardApi` | function | 233 |
| 2 | `getErrorMessage` | function | 237 |
| 3 | `getDashboardFilterStorageKey` | function | 286 |
| 4 | `readDashboardFilterPrefs` | function | 291 |
| 5 | `downsampleChartRows` | function | 314 |
| 6 | `normalizeDashboardRangeId` | function | 325 |
| 7 | `compactDashboardMetaParts` | function | 332 |
| 8 | `ChartFallback` | function | 338 |
| 9 | `formatDashboardHourLabel` | function | 344 |
| 10 | `getSaleStatusTone` | function | 351 |
| 11 | `isDashboardSummaryPayload` | function | 358 |
| 12 | `isDashboardAnalyticsPayload` | function | 370 |
| 13 | `normalizeDashboardSummaryPayload` | function | 383 |
| 14 | `normalizeDashboardAnalyticsPayload` | function | 396 |
| 15 | `Dashboard` | component/function | 416 |
| 16 | `calcTrend` | const arrow | 722 |
| 17 | `rangeLabel` | const arrow | 766 |
| 18 | `periodShort` | const arrow | 772 |

### 3.104 `frontend/src/components/dashboard/dashboardExport.ts`

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

### 3.105 `frontend/src/components/dashboard/MiniStat.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `MiniStat` | component/function | 13 |

### 3.106 `frontend/src/components/files/FilePickerModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 60 |
| 2 | `normalizeFileAssets` | function | 64 |
| 3 | `uploadFileAssetRequest` | function | 68 |
| 4 | `deleteFileAssetRequest` | function | 72 |
| 5 | `AssetPreview` | function | 76 |
| 6 | `FilePickerModal` | component/function | 99 |
| 7 | `toggleSelectedPath` | function | 176 |
| 8 | `handleUpload` | function | 186 |
| 9 | `handleDelete` | function | 228 |

### 3.107 `frontend/src/components/files/FilesPage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadFilesProvidersTab` | const arrow | 42 |
| 2 | `loadFilesResponsesTab` | const arrow | 43 |
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
| 16 | `handleUpload` | function | 671 |
| 17 | `handleDeleteAsset` | function | 694 |
| 18 | `toggleAssetSelection` | function | 722 |
| 19 | `toggleSelectAllAssets` | function | 733 |
| 20 | `handleCopySelectedPaths` | function | 740 |
| 21 | `handleDownloadSelected` | function | 755 |
| 22 | `handleDeleteSelectedAssets` | function | 763 |
| 23 | `startCreateProvider` | function | 809 |
| 24 | `startEditProvider` | function | 825 |
| 25 | `saveProvider` | function | 850 |
| 26 | `testProvider` | function | 934 |
| 27 | `removeProvider` | function | 955 |

### 3.108 `frontend/src/components/files/FilesProvidersTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toProviderSelectOptions` | function | 47 |
| 2 | `toProviderTypeOptions` | function | 51 |
| 3 | `ProviderStatus` | function | 130 |
| 4 | `FilesProvidersTab` | component/function | 141 |

### 3.109 `frontend/src/components/files/FilesResponsesTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `FilesResponsesTab` | component/function | 64 |

### 3.110 `frontend/src/components/inventory/DualMoney.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `DualMoney` | component/function | 8 |

### 3.111 `frontend/src/components/inventory/Inventory.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `scheduleInventoryMetadataRead` | function | 213 |
| 2 | `loadBranchTransport` | function | 231 |
| 3 | `loadDashboardTransport` | function | 236 |
| 4 | `loadInventoryTransport` | function | 241 |
| 5 | `loadInventoryWriteTransport` | function | 246 |
| 6 | `loadProductReadTransport` | function | 251 |
| 7 | `loadReturnsReadTransport` | function | 256 |
| 8 | `loadRfidTransport` | function | 261 |
| 9 | `loadUserReadTransport` | function | 266 |
| 10 | `loadInventoryExportModule` | function | 271 |
| 11 | `getInventoryApi` | function | 276 |
| 12 | `normalizeFiniteIds` | function | 328 |
| 13 | `countActiveFlags` | function | 332 |
| 14 | `countSelectedIds` | function | 340 |
| 15 | `buildDestinationProductOptions` | function | 348 |
| 16 | `limitInventorySectionsForMobile` | function | 361 |
| 17 | `parseInventoryTimestamp` | function | 388 |
| 18 | `InventoryDiscountBadge` | function | 402 |
| 19 | `InventoryBatchPreview` | function | 413 |
| 20 | `label` | const arrow | 425 |
| 21 | `Inventory` | component/function | 478 |
| 22 | `promise` | const arrow | 728 |
| 23 | `loadInventoryBootstrap` | const arrow | 766 |
| 24 | `handleAdjust` | const arrow | 1209 |
| 25 | `openAdjust` | const arrow | 1291 |
| 26 | `openMove` | const arrow | 1298 |
| 27 | `openTransfer` | const arrow | 1321 |
| 28 | `handleMoveStock` | const arrow | 1376 |
| 29 | `handleTransferStock` | const arrow | 1449 |
| 30 | `syncViewport` | const arrow | 1613 |
| 31 | `statsValue` | const arrow | 2220 |
| 32 | `selectInventorySection` | const arrow | 2946 |

### 3.112 `frontend/src/components/inventory/InventoryBatchModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `buildDestinationProductOptions` | function | 68 |
| 2 | `InventoryBatchModal` | component/function | 79 |
| 3 | `closeIfIdle` | const arrow | 97 |

### 3.113 `frontend/src/components/inventory/inventoryExport.ts`

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

### 3.114 `frontend/src/components/inventory/InventoryImportModal.tsx`

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

### 3.115 `frontend/src/components/inventory/inventoryImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.116 `frontend/src/components/inventory/InventoryMovementsSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `InventoryMovementsSurface` | component/function | 143 |

### 3.117 `frontend/src/components/inventory/InventoryProductsSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `InventoryProductsSurface` | component/function | 103 |
| 2 | `renderDesktopTableHead` | const arrow | 142 |
| 3 | `renderDesktopLoadingShell` | const arrow | 164 |

### 3.118 `frontend/src/components/inventory/InventoryReasonManagerModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `InventoryReasonManagerModal` | component/function | 35 |
| 2 | `close` | const arrow | 50 |

### 3.119 `frontend/src/components/inventory/InventoryRfidSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `InventoryRfidSurface` | component/function | 55 |

### 3.120 `frontend/src/components/inventory/InventoryStatDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `InventoryStatDetailModal` | component/function | 23 |

### 3.121 `frontend/src/components/inventory/InventoryStockModals.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `InventoryStockModals` | component/function | 101 |

### 3.122 `frontend/src/components/inventory/movementGroups.ts`

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

### 3.123 `frontend/src/components/inventory/ProductDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBranchStockKey` | function | 61 |
| 2 | `ProductDetailModal` | component/function | 65 |

### 3.124 `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx`

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

### 3.125 `frontend/src/components/navigation/Sidebar.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getFallbackLabel` | function | 98 |
| 2 | `getNavLabel` | function | 106 |
| 3 | `isDarkColor` | function | 122 |
| 4 | `withAlpha` | function | 132 |
| 5 | `mergeStyles` | function | 138 |
| 6 | `announcePageIntent` | function | 142 |
| 7 | `getIconForItem` | function | 149 |
| 8 | `isNavigationItemWithIcon` | function | 153 |
| 9 | `Sidebar` | component/function | 157 |

### 3.126 `frontend/src/components/pos/CartItem.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `translate` | function | 42 |
| 2 | `CartItem` | component/function | 46 |

### 3.127 `frontend/src/components/pos/FilterPanel.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `countActiveFlags` | function | 47 |
| 2 | `SectionLabel` | function | 55 |
| 3 | `POSFilterPanel` | component/function | 66 |
| 4 | `clearAll` | const arrow | 100 |
| 5 | `chip` | const arrow | 109 |

### 3.128 `frontend/src/components/pos/POS.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getPosStatusLabel` | function | 96 |
| 2 | `loadContactOptionUtilsModule` | function | 102 |
| 3 | `parseContactOptions` | function | 133 |
| 4 | `isPlainRecord` | function | 324 |
| 5 | `normalizeCategory` | function | 328 |
| 6 | `getProductReadTransport` | function | 350 |
| 7 | `getLookupTransport` | function | 355 |
| 8 | `getContactReadTransport` | function | 360 |
| 9 | `getContactWriteTransport` | function | 365 |
| 10 | `getPortalTransport` | function | 370 |
| 11 | `getSaleWriteTransport` | function | 375 |
| 12 | `loadPosProductBootstrap` | function | 380 |
| 13 | `searchPosCatalogProducts` | function | 385 |
| 14 | `loadPosProductFilters` | function | 390 |
| 15 | `loadPosCategories` | function | 395 |
| 16 | `loadPosCustomers` | function | 400 |
| 17 | `loadPosDeliveryContacts` | function | 405 |
| 18 | `createPosCustomer` | function | 410 |
| 19 | `createPosDeliveryContact` | function | 415 |
| 20 | `lookupPosPortalMembership` | function | 420 |
| 21 | `createPosSale` | function | 425 |
| 22 | `normalizeOrder` | function | 430 |
| 23 | `getErrorMessage` | function | 441 |
| 24 | `asText` | function | 445 |
| 25 | `asNumber` | function | 449 |
| 26 | `ProductDiscountBadge` | function | 462 |
| 27 | `POS` | component/function | 482 |
| 28 | `setPersistedCat` | const arrow | 513 |
| 29 | `setPersistedBrand` | const arrow | 514 |
| 30 | `setPersistedBranch` | const arrow | 515 |
| 31 | `setPersistedStock` | const arrow | 516 |
| 32 | `setPersistedGroup` | const arrow | 517 |
| 33 | `setPersistedSupplier` | const arrow | 518 |
| 34 | `setPersistedInitial` | const arrow | 519 |
| 35 | `addNewOrder` | const arrow | 580 |
| 36 | `closeOrder` | const arrow | 592 |
| 37 | `promise` | const arrow | 734 |
| 38 | `selectCustomer` | const arrow | 1059 |
| 39 | `applyCustomerOption` | const arrow | 1107 |
| 40 | `clearCustomer` | const arrow | 1121 |
| 41 | `handleAddCustomer` | const arrow | 1129 |
| 42 | `selectDelivery` | const arrow | 1166 |
| 43 | `clearDelivery` | const arrow | 1171 |
| 44 | `handleAddDelivery` | const arrow | 1173 |
| 45 | `addToCart` | function | 1402 |
| 46 | `updateQty` | const arrow | 1441 |
| 47 | `updatePrice` | const arrow | 1449 |
| 48 | `updateItemBranch` | const arrow | 1473 |
| 49 | `handleDiscountUsd` | const arrow | 1542 |
| 50 | `handleDiscountKhr` | const arrow | 1543 |
| 51 | `handleMembershipUnits` | const arrow | 1544 |
| 52 | `handleCheckout` | const arrow | 1583 |

### 3.129 `frontend/src/components/pos/posCore.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeNumber` | function | 48 |

### 3.130 `frontend/src/components/pos/POSQuickAddModals.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `POSQuickAddModals` | component/function | 37 |

### 3.131 `frontend/src/components/pos/ProductDetailSheet.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductDetailSheet` | component/function | 87 |
| 2 | `closeAfterAdd` | const arrow | 113 |

### 3.132 `frontend/src/components/pos/ProductImage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getImageApi` | function | 17 |
| 2 | `isRecentlyBrokenProductImage` | function | 21 |
| 3 | `markBrokenProductImage` | function | 29 |
| 4 | `ProductImage` | component/function | 34 |
| 5 | `loadImageData` | function | 71 |

### 3.133 `frontend/src/components/pos/QuickAddModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `QuickAddModal` | component/function | 12 |
| 2 | `T` | const arrow | 13 |

### 3.134 `frontend/src/components/products/config/productPageConfig.ts`

- No top-level named function/class symbols detected.

### 3.135 `frontend/src/components/products/forms/BranchStockAdjuster.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getProductApi` | function | 73 |
| 2 | `parseStockDelta` | function | 77 |
| 3 | `BranchStockAdjuster` | component/function | 82 |
| 4 | `T` | const arrow | 103 |
| 5 | `setRow` | const arrow | 109 |
| 6 | `handleSave` | const arrow | 115 |

### 3.136 `frontend/src/components/products/forms/BulkAddStockModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getProductApi` | function | 69 |
| 2 | `parsePositiveQuantity` | function | 73 |
| 3 | `normalizeBranchId` | function | 78 |
| 4 | `normalizeProductId` | function | 84 |
| 5 | `BulkAddStockModal` | component/function | 89 |
| 6 | `handleSave` | const arrow | 109 |

### 3.137 `frontend/src/components/products/forms/ProductForm.tsx`

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

### 3.138 `frontend/src/components/products/forms/VariantFormModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getProductVariantApi` | function | 105 |
| 2 | `getErrorMessage` | function | 109 |
| 3 | `VariantFormModal` | component/function | 113 |

### 3.139 `frontend/src/components/products/helpers/productDisplayHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toNumber` | function | 57 |

### 3.140 `frontend/src/components/products/helpers/productExport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toNumber` | function | 49 |
| 2 | `getImageGallery` | function | 54 |
| 3 | `toImageName` | const arrow | 59 |
| 4 | `toImageUrl` | const arrow | 60 |
| 5 | `priceCsv` | const arrow | 61 |

### 3.141 `frontend/src/components/products/helpers/productFilterHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toNumber` | function | 44 |
| 2 | `normalizeFilterValue` | function | 49 |

### 3.142 `frontend/src/components/products/helpers/productGalleryHelpers.ts`

- No top-level named function/class symbols detected.

### 3.143 `frontend/src/components/products/helpers/productGroupViewHelpers.ts`

- No top-level named function/class symbols detected.

### 3.144 `frontend/src/components/products/helpers/productMenuHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `asString` | function | 85 |
| 2 | `normalizeOptionValue` | function | 89 |
| 3 | `safeFilterLabel` | function | 93 |

### 3.145 `frontend/src/components/products/helpers/productPageHelpers.ts`

- No top-level named function/class symbols detected.

### 3.146 `frontend/src/components/products/helpers/productSelectionHelpers.ts`

- No top-level named function/class symbols detected.

### 3.147 `frontend/src/components/products/helpers/productSupplierOptions.ts`

- No top-level named function/class symbols detected.

### 3.148 `frontend/src/components/products/helpers/productWriteHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toFiniteNumber` | function | 123 |
| 2 | `hasBulkFormValue` | function | 128 |
| 3 | `stringOrEmpty` | function | 132 |

### 3.149 `frontend/src/components/products/history/productHistoryHelpers.ts`

- No top-level named function/class symbols detected.

### 3.150 `frontend/src/components/products/import/BulkImportModal.tsx`

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

### 3.151 `frontend/src/components/products/import/productImportPlanner.ts`

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

### 3.152 `frontend/src/components/products/import/productImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `post` | function | 39 |
| 2 | `waitForNextTask` | function | 43 |
| 3 | `getErrorMessage` | function | 49 |

### 3.153 `frontend/src/components/products/lookups/ManageBrandsModal.tsx`

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

### 3.154 `frontend/src/components/products/lookups/ManageCategoriesModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getCategoryApi` | function | 113 |
| 2 | `getErrorMessage` | function | 117 |
| 3 | `normalizeCategoryRows` | function | 121 |
| 4 | `mergeCategoryUsage` | function | 136 |
| 5 | `ManageCategoriesModal` | component/function | 165 |

### 3.155 `frontend/src/components/products/lookups/ManageUnitsModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getUnitApi` | function | 113 |
| 2 | `getErrorMessage` | function | 117 |
| 3 | `normalizeUnitRows` | function | 121 |
| 4 | `mergeUnitUsage` | function | 136 |
| 5 | `ManageUnitsModal` | component/function | 165 |

### 3.156 `frontend/src/components/products/lookups/productLookupSnapshots.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getFallbackApiClient` | function | 57 |
| 2 | `normalizeProductRows` | function | 63 |
| 3 | `getPayloadNumber` | function | 70 |
| 4 | `snapshotLookupProducts` | function | 75 |
| 5 | `mergeUniqueSnapshots` | function | 89 |
| 6 | `fetchLookupProductSnapshotsForName` | function | 113 |
| 7 | `fetchProductsByIds` | function | 165 |

### 3.157 `frontend/src/components/products/Products.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadProductReadModule` | function | 328 |
| 2 | `loadProductWriteModule` | function | 333 |
| 3 | `loadLookupModule` | function | 338 |
| 4 | `loadBranchModule` | function | 343 |
| 5 | `loadInventoryWriteModule` | function | 348 |
| 6 | `loadProductImageUploadModule` | function | 353 |
| 7 | `getProductApi` | function | 385 |
| 8 | `getErrorMessage` | function | 389 |
| 9 | `isObjectRecord` | function | 393 |
| 10 | `toProductApiResponse` | function | 397 |
| 11 | `scrollNodeWithOffset` | function | 401 |
| 12 | `loadProductWriteHelpers` | function | 409 |
| 13 | `summarizeProductRun` | function | 414 |
| 14 | `aggregateProductInitials` | function | 429 |
| 15 | `toModalProduct` | function | 440 |
| 16 | `toVariantParentProduct` | function | 452 |
| 17 | `toLightboxState` | function | 458 |
| 18 | `Products` | component/function | 468 |
| 19 | `promise` | const arrow | 565 |
| 20 | `handleSave` | const arrow | 821 |
| 21 | `handleSaveWithGallery` | const arrow | 871 |
| 22 | `handleBulkDelete` | const arrow | 938 |
| 23 | `handleBulkOutOfStock` | const arrow | 985 |
| 24 | `handleBulkChangeBranch` | const arrow | 1028 |
| 25 | `handleBulkAddStock` | const arrow | 1058 |
| 26 | `toggleSelect` | const arrow | 1066 |
| 27 | `toggleSelectAll` | const arrow | 1073 |
| 28 | `handleDelete` | const arrow | 1080 |
| 29 | `renderUnitChip` | const arrow | 1167 |
| 30 | `openLightbox` | const arrow | 1181 |
| 31 | `getStockBadge` | const arrow | 1188 |

### 3.158 `frontend/src/components/products/scanning/barcodeImageScanner.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readFileAsDataUrl` | function | 37 |
| 2 | `createImageElement` | function | 62 |
| 3 | `loadImageSource` | function | 66 |
| 4 | `detectWithNativeBarcodeDetector` | function | 75 |

### 3.159 `frontend/src/components/products/scanning/BarcodeScannerModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getNativeBarcodeDetector` | function | 100 |
| 2 | `getScanErrorText` | function | 107 |
| 3 | `stopStream` | function | 112 |
| 4 | `BarcodeScannerModal` | component/function | 118 |

### 3.160 `frontend/src/components/products/scanning/barcodeScannerState.ts`

- No top-level named function/class symbols detected.

### 3.161 `frontend/src/components/products/scanning/cameraPermission.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeCameraPermissionState` | function | 9 |
| 2 | `queryCameraPermission` | function | 16 |
| 3 | `handleChange` | const arrow | 35 |

### 3.162 `frontend/src/components/products/scanning/scanbotScanner.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `publicBasePath` | const arrow | 37 |
| 2 | `getScanbotGlobal` | function | 49 |
| 3 | `normalizeScanbotError` | function | 68 |
| 4 | `loadScanbotScript` | function | 82 |
| 5 | `getInitializedScanbot` | function | 135 |

### 3.163 `frontend/src/components/products/shared/primitives.tsx`

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

### 3.164 `frontend/src/components/products/surfaces/HeaderActions.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductsHeaderActions` | component/function | 22 |
| 2 | `tr` | const arrow | 32 |

### 3.165 `frontend/src/components/products/surfaces/ProductDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductDetailModal` | component/function | 79 |
| 2 | `T` | const arrow | 95 |
| 3 | `Row` | const arrow | 121 |

### 3.166 `frontend/src/components/products/surfaces/ProductRowParts.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `label` | const arrow | 104 |

### 3.167 `frontend/src/components/products/surfaces/ProductsListSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ProductsListSurface` | component/function | 63 |
| 2 | `renderDesktopTableHead` | const arrow | 107 |
| 3 | `renderDesktopLoadingShell` | const arrow | 136 |

### 3.168 `frontend/src/components/receipt-settings/AllFieldsPanel.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Toggle` | function | 30 |
| 2 | `AllFieldsPanel` | component/function | 46 |
| 3 | `T` | const arrow | 49 |
| 4 | `toggleSection` | const arrow | 68 |

### 3.169 `frontend/src/components/receipt-settings/constants.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `T` | const arrow | 110 |

### 3.170 `frontend/src/components/receipt-settings/ErrorBoundary.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatError` | function | 11 |

### 3.171 `frontend/src/components/receipt-settings/FieldOrderManager.tsx`

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

### 3.172 `frontend/src/components/receipt-settings/PrintSettings.tsx`

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

### 3.173 `frontend/src/components/receipt-settings/ReceiptPreview.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatLoadError` | function | 34 |
| 2 | `ReceiptPreview` | component/function | 39 |
| 3 | `loadPreview` | function | 50 |

### 3.174 `frontend/src/components/receipt-settings/ReceiptSettings.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 80 |
| 2 | `Section` | function | 85 |
| 3 | `Toggle` | function | 96 |
| 4 | `ReceiptSettings` | component/function | 111 |

### 3.175 `frontend/src/components/receipt-settings/template.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isRecord` | function | 6 |
| 2 | `parseTemplateInput` | function | 10 |

### 3.176 `frontend/src/components/receipt/Receipt.tsx`

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

### 3.177 `frontend/src/components/returns/EditReturnModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadReturnsTransport` | function | 91 |
| 2 | `updateReturnRequest` | function | 96 |
| 3 | `toNumber` | function | 101 |
| 4 | `clampReturnQuantity` | function | 106 |
| 5 | `isWriteConflict` | function | 112 |
| 6 | `EditReturnModal` | component/function | 117 |
| 7 | `updateQty` | const arrow | 150 |
| 8 | `updateRestock` | const arrow | 153 |

### 3.178 `frontend/src/components/returns/NewReturnModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadSalesTransport` | function | 122 |
| 2 | `loadReturnsTransport` | function | 127 |
| 3 | `loadReturnsReadTransport` | function | 132 |
| 4 | `searchReturnSales` | function | 137 |
| 5 | `loadExistingSaleReturns` | function | 143 |
| 6 | `createReturnRequest` | function | 149 |
| 7 | `toNumber` | function | 154 |
| 8 | `clampReturnQuantity` | function | 159 |
| 9 | `getSaleItemKey` | function | 165 |
| 10 | `NewReturnModal` | component/function | 169 |
| 11 | `handleSearch` | const arrow | 202 |
| 12 | `handleReturnTypeChange` | const arrow | 267 |
| 13 | `toggleIncluded` | const arrow | 272 |
| 14 | `updateItemQty` | const arrow | 280 |
| 15 | `updateItemRestock` | const arrow | 288 |
| 16 | `selectAll` | const arrow | 292 |
| 17 | `clearAll` | const arrow | 295 |
| 18 | `handleSubmit` | const arrow | 302 |

### 3.179 `frontend/src/components/returns/NewSupplierReturnModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isSupplierReturnItem` | function | 85 |
| 2 | `loadBranchTransport` | function | 104 |
| 3 | `loadContactReadTransport` | function | 109 |
| 4 | `loadInventoryTransport` | function | 114 |
| 5 | `loadReturnsTransport` | function | 119 |
| 6 | `loadSupplierReturnSetup` | function | 124 |
| 7 | `loadSupplierReturnInventory` | function | 139 |
| 8 | `createSupplierReturnRequest` | function | 145 |
| 9 | `NewSupplierReturnModal` | component/function | 150 |
| 10 | `clearSetupWatchdog` | const arrow | 200 |
| 11 | `loadSetup` | function | 203 |
| 12 | `loadInventory` | function | 257 |
| 13 | `updateQty` | const arrow | 341 |
| 14 | `submit` | const arrow | 347 |

### 3.180 `frontend/src/components/returns/ReturnDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeScope` | function | 52 |
| 2 | `coerceMoney` | function | 56 |
| 3 | `isPositiveMoney` | function | 60 |
| 4 | `ReturnDetailModal` | component/function | 64 |

### 3.181 `frontend/src/components/returns/Returns.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadReturnsWriteTransport` | function | 47 |
| 2 | `updateReturnRequest` | function | 116 |
| 3 | `normalizeScope` | function | 168 |
| 4 | `getReturnTypeKey` | function | 172 |
| 5 | `getReturnTypeLabel` | function | 178 |
| 6 | `normalizeFiniteIds` | function | 194 |
| 7 | `countSelectedIds` | function | 198 |
| 8 | `countActiveFlags` | function | 206 |
| 9 | `toNumericAmount` | function | 214 |
| 10 | `exportReturnRows` | function | 219 |
| 11 | `getInitialReturnPageSize` | function | 237 |
| 12 | `Returns` | component/function | 242 |
| 13 | `promise` | const arrow | 316 |

### 3.182 `frontend/src/components/returns/ReturnsListSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `detectMobileViewport` | function | 71 |
| 2 | `ReturnsDesktopSkeletonRows` | function | 76 |
| 3 | `ReturnsMobileSkeletonCards` | function | 93 |
| 4 | `ReturnsListSurface` | component/function | 113 |
| 5 | `apply` | const arrow | 144 |

### 3.183 `frontend/src/components/sales/ExportModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getSalesExportApi` | function | 71 |
| 2 | `getErrorMessage` | function | 76 |
| 3 | `ExportModal` | component/function | 80 |
| 4 | `handlePreview` | const arrow | 154 |
| 5 | `handleExportCSV` | const arrow | 172 |

### 3.184 `frontend/src/components/sales/SaleDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toNumber` | function | 74 |
| 2 | `InfoBlock` | function | 79 |
| 3 | `parseItems` | function | 95 |
| 4 | `SaleDetailModal` | component/function | 106 |

### 3.185 `frontend/src/components/sales/Sales.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getSalesApi` | function | 127 |
| 2 | `normalizeSaleRows` | function | 132 |
| 3 | `normalizeUserOptions` | function | 140 |
| 4 | `getErrorMessage` | function | 145 |
| 5 | `isWriteConflict` | function | 149 |
| 6 | `multiMatch` | function | 156 |
| 7 | `normalizeFiniteIds` | function | 168 |
| 8 | `countSelectedIds` | function | 172 |
| 9 | `countActiveFlags` | function | 180 |
| 10 | `getSaleBranchLabel` | function | 188 |
| 11 | `buildSaleExportRows` | function | 196 |
| 12 | `Sales` | component/function | 212 |
| 13 | `promise` | const arrow | 303 |
| 14 | `toggleSelected` | const arrow | 650 |
| 15 | `toggleSelectAll` | const arrow | 656 |
| 16 | `handleBulkStatusUpdate` | const arrow | 732 |

### 3.186 `frontend/src/components/sales/SalesImportModal.tsx`

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

### 3.187 `frontend/src/components/sales/salesImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.188 `frontend/src/components/sales/SalesListSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getSaleItems` | function | 67 |
| 2 | `SalesListSurface` | component/function | 71 |

### 3.189 `frontend/src/components/sales/StatusBadge.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isSaleStatus` | function | 24 |
| 2 | `StatusBadge` | component/function | 50 |

### 3.190 `frontend/src/components/server/ServerPage.tsx`

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

### 3.191 `frontend/src/components/shared/ActionHistoryBar.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatHistoryList` | function | 46 |
| 2 | `formatServerStatus` | function | 50 |
| 3 | `ActionHistoryBar` | component/function | 57 |

### 3.192 `frontend/src/components/shared/AppSelect.tsx`

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

### 3.193 `frontend/src/components/shared/BackgroundImportTracker.tsx`

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

### 3.194 `frontend/src/components/shared/ExportMenu.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ExportMenu` | component/function | 17 |

### 3.195 `frontend/src/components/shared/FilterMenu.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `sectionButtonClass` | function | 56 |
| 2 | `getSectionFallbackLabel` | function | 62 |
| 3 | `resolveSectionLabel` | function | 73 |
| 4 | `FilterMenu` | component/function | 82 |

### 3.196 `frontend/src/components/shared/globalScroll.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDocumentLike` | function | 21 |
| 2 | `getPageScrollCandidates` | function | 25 |
| 3 | `isVisibleScrollNode` | function | 38 |

### 3.197 `frontend/src/components/shared/ImageGalleryLightbox.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ImageGalleryLightbox` | component/function | 31 |
| 2 | `formatLabel` | function | 53 |
| 3 | `setIndex` | function | 57 |
| 4 | `renderGalleryImage` | function | 63 |
| 5 | `onKeyDown` | function | 70 |

### 3.198 `frontend/src/components/shared/LazyPortalMenu.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `LazyPortalMenu` | component/function | 7 |

### 3.199 `frontend/src/components/shared/LoadingWatchdog.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `LoadingWatchdog` | component/function | 14 |

### 3.200 `frontend/src/components/shared/Modal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Modal` | component/function | 13 |

### 3.201 `frontend/src/components/shared/navigationConfig.ts`

- No top-level named function/class symbols detected.

### 3.202 `frontend/src/components/shared/NotificationCenter.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 109 |
| 2 | `preferenceValue` | function | 236 |
| 3 | `matchesVisibilityMode` | function | 244 |
| 4 | `NotificationSeverityIcon` | function | 251 |
| 5 | `NotificationCenter` | component/function | 266 |
| 6 | `syncVisibility` | const arrow | 301 |
| 7 | `onVisible` | const arrow | 376 |
| 8 | `handleClickOutside` | const arrow | 400 |

### 3.203 `frontend/src/components/shared/pageActivity.ts`

- No top-level named function/class symbols detected.

### 3.204 `frontend/src/components/shared/PageHeader.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PageHeader` | component/function | 26 |

### 3.205 `frontend/src/components/shared/PaginationControls.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PaginationControls` | component/function | 42 |
| 2 | `commitPageDraft` | const arrow | 73 |
| 3 | `handlePageInputKeyDown` | const arrow | 84 |

### 3.206 `frontend/src/components/shared/PortalMenu.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPortalMenuItem` | function | 50 |
| 2 | `PortalMenu` | component/function | 60 |
| 3 | `closeIfClickedOutside` | const arrow | 125 |
| 4 | `closeMenu` | const arrow | 133 |
| 5 | `scheduleReposition` | const arrow | 134 |
| 6 | `closeIfEscape` | const arrow | 141 |

### 3.207 `frontend/src/components/shared/QuickPreferenceToggles.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ToggleButton` | function | 26 |
| 2 | `QuickPreferenceToggles` | component/function | 45 |
| 3 | `tr` | const arrow | 48 |

### 3.208 `frontend/src/components/shared/SectionSwitcher.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readStoredSection` | function | 20 |
| 2 | `SectionSwitcher` | component/function | 29 |
| 3 | `selectValue` | const arrow | 58 |

### 3.209 `frontend/src/components/shared/WriteConflictModal.tsx`

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

### 3.210 `frontend/src/components/users/permissionDefinitions.ts`

- No top-level named function/class symbols detected.

### 3.211 `frontend/src/components/users/PermissionEditor.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `parsePermissionState` | function | 11 |
| 2 | `PermissionEditor` | component/function | 25 |
| 3 | `toggle` | const arrow | 40 |

### 3.212 `frontend/src/components/users/UserDetailSheet.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `translateLabel` | function | 43 |
| 2 | `buildRowData` | function | 48 |
| 3 | `parsePermissions` | function | 60 |
| 4 | `UserDetailSheet` | component/function | 71 |

### 3.213 `frontend/src/components/users/UserProfileModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getProfileApi` | function | 167 |
| 2 | `getErrorMessage` | function | 172 |
| 3 | `parseStoredOrganization` | function | 176 |
| 4 | `AvatarPreview` | function | 193 |
| 5 | `ProfileSectionButton` | function | 211 |
| 6 | `clamp` | function | 321 |
| 7 | `loadImageElement` | function | 325 |
| 8 | `renderAvatarCropBlob` | function | 340 |
| 9 | `AvatarEditorModal` | function | 366 |
| 10 | `UserProfileModal` | component/function | 427 |
| 11 | `handleProfileSave` | const arrow | 595 |
| 12 | `handlePasswordSave` | const arrow | 659 |
| 13 | `handleSessionSave` | const arrow | 698 |
| 14 | `refreshOtpState` | const arrow | 718 |

### 3.214 `frontend/src/components/users/Users.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getUsersApi` | function | 144 |
| 2 | `normalizeUsers` | function | 157 |
| 3 | `normalizeRoles` | function | 161 |
| 4 | `normalizePermissionState` | function | 165 |
| 5 | `getErrorMessage` | function | 180 |
| 6 | `clearTimeoutRef` | function | 184 |
| 7 | `scheduleUsersSecondaryRead` | function | 190 |
| 8 | `ThreeDot` | function | 219 |
| 9 | `formatContactValue` | function | 263 |
| 10 | `UsersDesktopSkeletonRows` | function | 268 |
| 11 | `UsersMobileSkeletonCards` | function | 292 |
| 12 | `Users` | component/function | 306 |
| 13 | `promise` | const arrow | 375 |
| 14 | `promise` | const arrow | 413 |
| 15 | `openCreateUser` | const arrow | 552 |
| 16 | `openCreateRole` | const arrow | 582 |
| 17 | `handleSaveUser` | const arrow | 643 |
| 18 | `handleResetPassword` | const arrow | 713 |
| 19 | `handleSaveRole` | const arrow | 770 |

### 3.215 `frontend/src/components/utils-settings/AuditLog.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadCsvUtilsModule` | function | 103 |
| 2 | `isRecord` | function | 108 |
| 3 | `getErrorMessage` | function | 112 |
| 4 | `toIso` | function | 144 |
| 5 | `formatDateTime` | function | 156 |
| 6 | `formatCompactDateTime` | function | 177 |
| 7 | `formatLogTime` | function | 195 |
| 8 | `formatLogTableTime` | function | 199 |
| 9 | `auditDeviceLabel` | function | 203 |
| 10 | `auditTimezoneLabel` | function | 211 |
| 11 | `getLogEpoch` | function | 219 |
| 12 | `formatJsonPretty` | function | 226 |
| 13 | `parseLogJson` | function | 234 |
| 14 | `flattenSummaryValue` | function | 242 |
| 15 | `formatEntityName` | function | 261 |
| 16 | `readableSummary` | function | 267 |
| 17 | `normalizeFiniteIds` | function | 295 |
| 18 | `countSelectedIds` | function | 299 |
| 19 | `countActiveFlags` | function | 307 |
| 20 | `DetailRow` | function | 315 |
| 21 | `AuditLog` | component/function | 327 |
| 22 | `sessionEntryLabel` | function | 692 |

### 3.216 `frontend/src/components/utils-settings/Backup.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBackupApi` | function | 247 |
| 2 | `getErrorMessage` | function | 251 |
| 3 | `unwrapJob` | function | 255 |
| 4 | `isBackupSectionId` | function | 292 |
| 5 | `PathActionButton` | function | 341 |
| 6 | `PrimaryActionButton` | function | 353 |
| 7 | `formatElapsed` | function | 365 |
| 8 | `JobProgressCard` | function | 374 |
| 9 | `DoctorStatusPill` | function | 434 |
| 10 | `IntegrationDoctorCard` | function | 458 |
| 11 | `useCopy` | function | 564 |
| 12 | `formatDateTime` | function | 580 |
| 13 | `formatBytes` | function | 596 |
| 14 | `yieldToBrowser` | function | 605 |
| 15 | `getJobSignature` | function | 613 |
| 16 | `startJobWatcher` | function | 632 |
| 17 | `stop` | const arrow | 648 |
| 18 | `scheduleTick` | const arrow | 654 |
| 19 | `tick` | const arrow | 660 |
| 20 | `SectionChip` | function | 717 |
| 21 | `secondsToSyncMinutes` | function | 739 |
| 22 | `minutesToSyncSeconds` | function | 748 |
| 23 | `GoogleDriveSyncSection` | function | 756 |
| 24 | `handler` | const arrow | 878 |
| 25 | `savePreferences` | const arrow | 963 |
| 26 | `connectGoogleDrive` | const arrow | 993 |
| 27 | `syncNow` | const arrow | 1038 |
| 28 | `disconnect` | const arrow | 1075 |
| 29 | `forgetCredentials` | const arrow | 1100 |
| 30 | `BackupOverview` | function | 1330 |
| 31 | `Backup` | component/function | 1402 |
| 32 | `showBackupSection` | const arrow | 1418 |
| 33 | `handleFolderExport` | const arrow | 1453 |
| 34 | `handleFolderImport` | const arrow | 1522 |

### 3.217 `frontend/src/components/utils-settings/FontFamilyPicker.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `FontFamilyPicker` | component/function | 30 |

### 3.218 `frontend/src/components/utils-settings/index.ts`

- No top-level named function/class symbols detected.

### 3.219 `frontend/src/components/utils-settings/OtpModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getOtpApi` | function | 45 |
| 2 | `getErrorMessage` | function | 49 |
| 3 | `OtpModal` | component/function | 53 |
| 4 | `loadSetup` | function | 88 |

### 3.220 `frontend/src/components/utils-settings/ResetData.tsx`

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

### 3.221 `frontend/src/components/utils-settings/Settings.tsx`

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

### 3.222 `frontend/src/components/utils-settings/settingsConflict.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeObject` | function | 28 |

### 3.223 `frontend/src/constants.ts`

- No top-level named function/class symbols detected.

### 3.224 `frontend/src/index.tsx`

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
| 13 | `InitialShellFallback` | function | 212 |

### 3.225 `frontend/src/platform/runtime/clientRuntime.ts`

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

### 3.226 `frontend/src/platform/storage/storagePolicy.ts`

- No top-level named function/class symbols detected.

### 3.227 `frontend/src/public-runtime/runtime-noise-guard.ts`

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

### 3.228 `frontend/src/public-runtime/service-worker.ts`

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
| 23 | `isHashedBuildAsset` | function | 370 |
| 24 | `appShellFallback` | function | 374 |
| 25 | `networkFirstStatic` | function | 393 |
| 26 | `cacheFirstStatic` | function | 412 |

### 3.229 `frontend/src/public-runtime/theme-bootstrap.ts`

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

### 3.230 `frontend/src/public-web-api.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadPortalTransport` | function | 18 |
| 2 | `getPortalMethod` | function | 23 |

### 3.231 `frontend/src/PublicCatalogRoot.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `PublicCatalogFallback` | function | 6 |
| 2 | `PublicCatalogRoot` | component/function | 16 |

### 3.232 `frontend/src/runtime/runtimeErrorClassifier.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `messageOf` | function | 27 |
| 2 | `stackOf` | function | 31 |
| 3 | `toText` | function | 35 |
| 4 | `includesExtensionOrigin` | function | 39 |
| 5 | `getPathname` | function | 44 |

### 3.233 `frontend/src/types/lucide-react-icons.d.ts`

- No top-level named function/class symbols detected.

### 3.234 `frontend/src/types/receiptContracts.ts`

- No top-level named function/class symbols detected.

### 3.235 `frontend/src/types/settingsContracts.ts`

- No top-level named function/class symbols detected.

### 3.236 `frontend/src/utils/actionGuards.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `hasOwn` | function | 18 |

### 3.237 `frontend/src/utils/actionHistory.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadActionHistoryTransport` | function | 85 |
| 2 | `scheduleActionHistoryRead` | function | 90 |
| 3 | `normalizeActionHistoryId` | function | 108 |
| 4 | `normalizeEntry` | function | 114 |
| 5 | `parsePermissions` | function | 127 |
| 6 | `getErrorMessage` | function | 139 |

### 3.238 `frontend/src/utils/appRefresh.ts`

- No top-level named function/class symbols detected.

### 3.239 `frontend/src/utils/bulkOps.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `runner` | function | 47 |

### 3.240 `frontend/src/utils/color.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeHex` | function | 1 |
| 2 | `relativeLuminance` | function | 12 |

### 3.241 `frontend/src/utils/csv.ts`

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

### 3.242 `frontend/src/utils/csvExportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getErrorMessage` | function | 20 |

### 3.243 `frontend/src/utils/csvImport.ts`

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

### 3.244 `frontend/src/utils/csvRowCounter.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `finishRecord` | const arrow | 7 |

### 3.245 `frontend/src/utils/csvTemplate.ts`

- No top-level named function/class symbols detected.

### 3.246 `frontend/src/utils/dateHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toLocalDateString` | function | 4 |

### 3.247 `frontend/src/utils/deviceInfo.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBrowserName` | function | 13 |
| 2 | `getOperatingSystemName` | function | 21 |

### 3.248 `frontend/src/utils/exportPackage.ts`

- No top-level named function/class symbols detected.

### 3.249 `frontend/src/utils/exportReports.tsx`

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

### 3.250 `frontend/src/utils/favicon.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `clamp` | function | 11 |
| 2 | `shouldUseAnonymousCors` | function | 18 |
| 3 | `loadImage` | function | 29 |

### 3.251 `frontend/src/utils/formatters.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeTimestampInput` | function | 6 |

### 3.252 `frontend/src/utils/groupedRecords.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeName` | function | 33 |
| 2 | `compareAlphabetLabels` | function | 41 |

### 3.253 `frontend/src/utils/historyHelpers.ts`

- No top-level named function/class symbols detected.

### 3.254 `frontend/src/utils/importJobRefresh.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeImportJobStatus` | function | 24 |
| 2 | `normalizeImportJobType` | function | 28 |
| 3 | `uniqueChannels` | function | 32 |
| 4 | `dispatchSyncUpdate` | function | 41 |

### 3.255 `frontend/src/utils/index.ts`

- No top-level named function/class symbols detected.

### 3.256 `frontend/src/utils/initials.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getInitialRank` | function | 54 |

### 3.257 `frontend/src/utils/loaders.ts`

- No top-level named function/class symbols detected.

### 3.258 `frontend/src/utils/mediaUpload.ts`

- No top-level named function/class symbols detected.

### 3.259 `frontend/src/utils/mediaUploadState.ts`

- No top-level named function/class symbols detected.

### 3.260 `frontend/src/utils/permissions.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isPermissionMap` | function | 3 |

### 3.261 `frontend/src/utils/pricing.ts`

- No top-level named function/class symbols detected.

### 3.262 `frontend/src/utils/printReceipt.ts`

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

### 3.263 `frontend/src/utils/productBatches.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeBranchId` | function | 26 |

### 3.264 `frontend/src/utils/productGrouping.ts`

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

### 3.265 `frontend/src/utils/publicAssetUrls.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `trimBaseUrl` | function | 11 |
| 2 | `normalizeUploadPath` | function | 15 |
| 3 | `appendAssetVersion` | function | 23 |
| 4 | `isLocalLikeHostname` | function | 38 |
| 5 | `getSafeCurrentOrigin` | function | 42 |
| 6 | `api` | const arrow | 57 |

### 3.266 `frontend/src/utils/receiptAppliedConfig.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `parseObject` | function | 67 |

### 3.267 `frontend/src/utils/recordFilters.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toDate` | function | 15 |

### 3.268 `frontend/src/utils/scriptTypography.ts`

- No top-level named function/class symbols detected.

### 3.269 `frontend/src/utils/searchTerms.ts`

- No top-level named function/class symbols detected.

### 3.270 `frontend/src/utils/settingsRefresh.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeSettingKeys` | function | 62 |

### 3.271 `frontend/src/utils/settingsWriteOptions.ts`

- No top-level named function/class symbols detected.

### 3.272 `frontend/src/web-api.ts`

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

### 3.273 `ops/scripts/frontend/build-public-runtime-scripts.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toProjectPath` | function | 36 |
| 2 | `formatDiagnostic` | function | 40 |
| 3 | `transpileRuntimeScript` | function | 47 |
| 4 | `writeIfChanged` | function | 67 |
| 5 | `main` | function | 74 |

### 3.274 `ops/scripts/frontend/verify-i18n.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `collectUsedKeys` | function | 29 |
| 2 | `flattenTranslationTree` | function | 69 |
| 3 | `listMissing` | function | 83 |
| 4 | `listEmptyValues` | function | 88 |
| 5 | `printList` | function | 95 |
| 6 | `main` | function | 102 |

### 3.275 `ops/scripts/frontend/verify-performance.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `read` | function | 15 |
| 2 | `walk` | function | 19 |
| 3 | `trackedFiles` | function | 37 |
| 4 | `assert` | function | 47 |

### 3.276 `ops/scripts/frontend/verify-ui.ts`

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

### 3.277 `frontend/vite.config.ts`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readGitRevision` | function | 12 |
| 2 | `escapeInlineScript` | function | 54 |
| 3 | `inlinePublicRuntimeScripts` | function | 60 |
| 4 | `fixCrossorigin` | function | 85 |
| 5 | `emitBuildManifest` | function | 110 |
| 6 | `isBundleChunk` | function | 221 |
| 7 | `toRoutePreloadFiles` | function | 225 |
| 8 | `buildRoutePreloadScript` | function | 237 |
| 9 | `normalizePath` | function | 240 |
| 10 | `isAdminAppPath` | function | 248 |
| 11 | `isLoginPath` | function | 281 |
| 12 | `isPublicCatalogPath` | function | 284 |
| 13 | `hasEmbeddedAuthBootstrap` | function | 290 |
| 14 | `routePreloadKey` | function | 293 |
| 15 | `injectRouteAwareModulePreloads` | function | 347 |
| 16 | `deferRenderBlockingStylesheets` | function | 368 |
| 17 | `activate` | function | 391 |
| 18 | `shouldDeferModulePreload` | function | 589 |
| 19 | `manualChunks` | function | 593 |

### 3.278 `frontend/tailwind.config.ts`

- No top-level named function/class symbols detected.

