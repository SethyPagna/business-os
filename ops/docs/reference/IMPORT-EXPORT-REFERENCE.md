# Import / Export Reference

Auto-generated import/export and dependency-link coverage for frontend/backend code files.

## 1. Coverage Summary

Code files documented: **252**

## 2. Dependency Matrix

| No. | File | Imports | Exports | Internal deps | Referenced by |
|---:|---|---:|---:|---:|---:|
| 1 | `backend/server.js` | 36 | 0 | 30 | 0 |
| 2 | `backend/src/accessControl.js` | 2 | 1 | 2 | 4 |
| 3 | `backend/src/authOtpGuards.js` | 1 | 1 | 1 | 2 |
| 4 | `backend/src/backupSchema.js` | 0 | 1 | 0 | 2 |
| 5 | `backend/src/config/index.js` | 5 | 1 | 1 | 16 |
| 6 | `backend/src/conflictControl.js` | 0 | 1 | 0 | 12 |
| 7 | `backend/src/contactOptions.js` | 0 | 1 | 0 | 2 |
| 8 | `backend/src/database.js` | 7 | 1 | 2 | 28 |
| 9 | `backend/src/dataPath/index.js` | 2 | 1 | 0 | 5 |
| 10 | `backend/src/fileAssets.js` | 8 | 1 | 4 | 8 |
| 11 | `backend/src/helpers.js` | 3 | 1 | 3 | 23 |
| 12 | `backend/src/idempotency.js` | 0 | 1 | 0 | 4 |
| 13 | `backend/src/importCsv.js` | 0 | 1 | 0 | 2 |
| 14 | `backend/src/importParsing.js` | 1 | 1 | 1 | 2 |
| 15 | `backend/src/middleware.js` | 10 | 1 | 6 | 22 |
| 16 | `backend/src/money.js` | 0 | 1 | 0 | 5 |
| 17 | `backend/src/netSecurity.js` | 1 | 1 | 0 | 5 |
| 18 | `backend/src/organizationContext/index.js` | 7 | 1 | 4 | 6 |
| 19 | `backend/src/portalUtils.js` | 0 | 1 | 0 | 2 |
| 20 | `backend/src/productDiscounts.js` | 1 | 1 | 1 | 3 |
| 21 | `backend/src/productImportPolicies.js` | 1 | 1 | 1 | 3 |
| 22 | `backend/src/requestContext.js` | 1 | 1 | 0 | 2 |
| 23 | `backend/src/routes/actionHistory.js` | 4 | 1 | 3 | 1 |
| 24 | `backend/src/routes/ai.js` | 6 | 1 | 5 | 1 |
| 25 | `backend/src/routes/auth.js` | 18 | 1 | 13 | 1 |
| 26 | `backend/src/routes/branches.js` | 5 | 1 | 4 | 1 |
| 27 | `backend/src/routes/catalog.js` | 4 | 1 | 3 | 1 |
| 28 | `backend/src/routes/categories.js` | 5 | 1 | 4 | 1 |
| 29 | `backend/src/routes/contacts.js` | 6 | 1 | 5 | 1 |
| 30 | `backend/src/routes/customTables.js` | 5 | 1 | 4 | 1 |
| 31 | `backend/src/routes/files.js` | 5 | 1 | 4 | 1 |
| 32 | `backend/src/routes/importJobs.js` | 9 | 1 | 5 | 1 |
| 33 | `backend/src/routes/inventory.js` | 6 | 1 | 5 | 1 |
| 34 | `backend/src/routes/notifications.js` | 4 | 1 | 3 | 1 |
| 35 | `backend/src/routes/organizations.js` | 3 | 1 | 2 | 1 |
| 36 | `backend/src/routes/portal.js` | 11 | 1 | 10 | 1 |
| 37 | `backend/src/routes/products.js` | 15 | 1 | 12 | 1 |
| 38 | `backend/src/routes/returns.js` | 6 | 1 | 5 | 1 |
| 39 | `backend/src/routes/sales.js` | 6 | 1 | 5 | 1 |
| 40 | `backend/src/routes/settings.js` | 6 | 1 | 5 | 1 |
| 41 | `backend/src/routes/system/index.js` | 17 | 1 | 12 | 1 |
| 42 | `backend/src/routes/units.js` | 5 | 1 | 4 | 1 |
| 43 | `backend/src/routes/users.js` | 11 | 1 | 9 | 1 |
| 44 | `backend/src/runtimeState/index.js` | 4 | 1 | 1 | 2 |
| 45 | `backend/src/security.js` | 1 | 1 | 0 | 7 |
| 46 | `backend/src/serverUtils.js` | 1 | 1 | 1 | 3 |
| 47 | `backend/src/services/aiGateway.js` | 2 | 1 | 2 | 2 |
| 48 | `backend/src/services/firebaseAuth.js` | 2 | 1 | 0 | 0 |
| 49 | `backend/src/services/googleDriveSync/index.js` | 8 | 1 | 4 | 3 |
| 50 | `backend/src/services/importJobs.js` | 16 | 1 | 10 | 3 |
| 51 | `backend/src/services/portalAi.js` | 2 | 1 | 2 | 1 |
| 52 | `backend/src/services/supabaseAuth.js` | 0 | 1 | 0 | 2 |
| 53 | `backend/src/services/verification.js` | 2 | 1 | 1 | 2 |
| 54 | `backend/src/sessionAuth.js` | 2 | 1 | 1 | 4 |
| 55 | `backend/src/settingsSnapshot.js` | 3 | 1 | 1 | 6 |
| 56 | `backend/src/storage/organizationFolders.js` | 2 | 1 | 0 | 2 |
| 57 | `backend/src/systemFsWorker.js` | 3 | 0 | 1 | 0 |
| 58 | `backend/src/uploadReferenceCleanup.js` | 1 | 1 | 1 | 2 |
| 59 | `backend/src/uploadSecurity.js` | 2 | 1 | 0 | 4 |
| 60 | `backend/src/websocket.js` | 5 | 1 | 3 | 1 |
| 61 | `backend/test/accessControl.test.js` | 2 | 0 | 1 | 0 |
| 62 | `backend/test/authOtpGuards.test.js` | 2 | 0 | 1 | 0 |
| 63 | `backend/test/authSecurityFlow.test.js` | 6 | 0 | 0 | 0 |
| 64 | `backend/test/backupRoundtrip.test.js` | 6 | 0 | 0 | 0 |
| 65 | `backend/test/backupSchema.test.js` | 2 | 0 | 1 | 0 |
| 66 | `backend/test/configOrganizationRuntime.test.js` | 7 | 0 | 0 | 0 |
| 67 | `backend/test/contactOptions.test.js` | 2 | 0 | 1 | 0 |
| 68 | `backend/test/dataPath.test.js` | 5 | 0 | 1 | 0 |
| 69 | `backend/test/fileRouteSecurityFlow.test.js` | 6 | 0 | 0 | 0 |
| 70 | `backend/test/idempotency.test.js` | 2 | 0 | 1 | 0 |
| 71 | `backend/test/importCsv.test.js` | 3 | 0 | 2 | 0 |
| 72 | `backend/test/netSecurity.test.js` | 2 | 0 | 1 | 0 |
| 73 | `backend/test/portalUtils.test.js` | 2 | 0 | 1 | 0 |
| 74 | `backend/test/productImportPolicies.test.js` | 2 | 0 | 1 | 0 |
| 75 | `backend/test/serverUtils.test.js` | 2 | 0 | 1 | 0 |
| 76 | `backend/test/stockConsistency.test.js` | 7 | 0 | 0 | 0 |
| 77 | `backend/test/systemRouteSecurity.test.js` | 6 | 0 | 0 | 0 |
| 78 | `backend/test/uploadSecurity.test.js` | 3 | 0 | 2 | 0 |
| 79 | `frontend/postcss.config.mjs` | 0 | 0 | 0 | 0 |
| 80 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.js` | 0 | 0 | 0 | 0 |
| 81 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.worker.js` | 0 | 0 | 0 | 0 |
| 82 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd-threads.js` | 0 | 0 | 0 | 0 |
| 83 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd.js` | 0 | 0 | 0 | 0 |
| 84 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core.js` | 0 | 0 | 0 | 0 |
| 85 | `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js` | 0 | 0 | 0 | 0 |
| 86 | `frontend/public/sw.js` | 0 | 0 | 0 | 0 |
| 87 | `frontend/public/theme-bootstrap.js` | 0 | 0 | 0 | 0 |
| 88 | `frontend/src/api/http.js` | 2 | 23 | 2 | 5 |
| 89 | `frontend/src/api/localDb.js` | 1 | 10 | 0 | 3 |
| 90 | `frontend/src/api/methods.js` | 5 | 164 | 5 | 1 |
| 91 | `frontend/src/api/websocket.js` | 2 | 4 | 2 | 2 |
| 92 | `frontend/src/App.jsx` | 28 | 1 | 27 | 1 |
| 93 | `frontend/src/app/appShellUtils.mjs` | 0 | 5 | 0 | 2 |
| 94 | `frontend/src/AppContext.jsx` | 11 | 6 | 10 | 50 |
| 95 | `frontend/src/components/auth/Login.jsx` | 5 | 1 | 4 | 1 |
| 96 | `frontend/src/components/branches/Branches.jsx` | 11 | 1 | 9 | 1 |
| 97 | `frontend/src/components/branches/BranchForm.jsx` | 2 | 1 | 1 | 1 |
| 98 | `frontend/src/components/branches/TransferModal.jsx` | 2 | 1 | 1 | 1 |
| 99 | `frontend/src/components/catalog/CatalogPage.jsx` | 11 | 1 | 10 | 1 |
| 100 | `frontend/src/components/catalog/CatalogProductsSection.jsx` | 5 | 1 | 3 | 1 |
| 101 | `frontend/src/components/catalog/CatalogSecondaryTabs.jsx` | 2 | 1 | 1 | 1 |
| 102 | `frontend/src/components/catalog/catalogUi.jsx` | 1 | 3 | 0 | 3 |
| 103 | `frontend/src/components/catalog/portalCatalogDisplay.mjs` | 1 | 7 | 1 | 1 |
| 104 | `frontend/src/components/catalog/portalEditorUtils.mjs` | 0 | 6 | 0 | 0 |
| 105 | `frontend/src/components/contacts/contactOptionUtils.js` | 0 | 9 | 0 | 0 |
| 106 | `frontend/src/components/contacts/Contacts.jsx` | 12 | 1 | 10 | 1 |
| 107 | `frontend/src/components/contacts/CustomersTab.jsx` | 13 | 2 | 11 | 2 |
| 108 | `frontend/src/components/contacts/DeliveryTab.jsx` | 13 | 2 | 11 | 1 |
| 109 | `frontend/src/components/contacts/shared.jsx` | 7 | 5 | 5 | 4 |
| 110 | `frontend/src/components/contacts/SuppliersTab.jsx` | 13 | 0 | 11 | 1 |
| 111 | `frontend/src/components/custom-tables/CustomTables.jsx` | 5 | 1 | 4 | 0 |
| 112 | `frontend/src/components/dashboard/charts/BarChart.jsx` | 3 | 1 | 2 | 0 |
| 113 | `frontend/src/components/dashboard/charts/DonutChart.jsx` | 3 | 1 | 2 | 0 |
| 114 | `frontend/src/components/dashboard/charts/index.js` | 0 | 0 | 0 | 2 |
| 115 | `frontend/src/components/dashboard/charts/LineChart.jsx` | 3 | 1 | 2 | 0 |
| 116 | `frontend/src/components/dashboard/charts/NoData.jsx` | 1 | 1 | 1 | 3 |
| 117 | `frontend/src/components/dashboard/Dashboard.jsx` | 15 | 1 | 13 | 1 |
| 118 | `frontend/src/components/dashboard/MiniStat.jsx` | 0 | 1 | 0 | 1 |
| 119 | `frontend/src/components/files/FilePickerModal.jsx` | 3 | 1 | 2 | 5 |
| 120 | `frontend/src/components/files/FilesPage.jsx` | 7 | 1 | 6 | 1 |
| 121 | `frontend/src/components/inventory/DualMoney.jsx` | 0 | 1 | 0 | 1 |
| 122 | `frontend/src/components/inventory/Inventory.jsx` | 19 | 1 | 17 | 1 |
| 123 | `frontend/src/components/inventory/InventoryImportModal.jsx` | 4 | 1 | 3 | 1 |
| 124 | `frontend/src/components/inventory/movementGroups.js` | 0 | 2 | 0 | 1 |
| 125 | `frontend/src/components/inventory/ProductDetailModal.jsx` | 1 | 1 | 1 | 1 |
| 126 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | 4 | 1 | 2 | 1 |
| 127 | `frontend/src/components/navigation/Sidebar.jsx` | 6 | 1 | 5 | 1 |
| 128 | `frontend/src/components/pos/CartItem.jsx` | 1 | 1 | 1 | 1 |
| 129 | `frontend/src/components/pos/FilterPanel.jsx` | 1 | 1 | 0 | 1 |
| 130 | `frontend/src/components/pos/POS.jsx` | 14 | 1 | 12 | 1 |
| 131 | `frontend/src/components/pos/posCore.mjs` | 2 | 8 | 2 | 0 |
| 132 | `frontend/src/components/pos/ProductImage.jsx` | 1 | 1 | 1 | 1 |
| 133 | `frontend/src/components/pos/QuickAddModal.jsx` | 0 | 1 | 0 | 1 |
| 134 | `frontend/src/components/products/barcodeImageScanner.mjs` | 1 | 1 | 0 | 2 |
| 135 | `frontend/src/components/products/BarcodeScannerModal.jsx` | 7 | 1 | 4 | 1 |
| 136 | `frontend/src/components/products/barcodeScannerState.mjs` | 0 | 1 | 0 | 2 |
| 137 | `frontend/src/components/products/BranchStockAdjuster.jsx` | 1 | 1 | 0 | 1 |
| 138 | `frontend/src/components/products/BulkAddStockModal.jsx` | 1 | 1 | 0 | 1 |
| 139 | `frontend/src/components/products/BulkImportModal.jsx` | 4 | 1 | 3 | 1 |
| 140 | `frontend/src/components/products/HeaderActions.jsx` | 3 | 1 | 2 | 1 |
| 141 | `frontend/src/components/products/ManageBrandsModal.jsx` | 3 | 1 | 2 | 1 |
| 142 | `frontend/src/components/products/ManageCategoriesModal.jsx` | 3 | 1 | 2 | 1 |
| 143 | `frontend/src/components/products/ManageUnitsModal.jsx` | 3 | 1 | 2 | 1 |
| 144 | `frontend/src/components/products/primitives.jsx` | 2 | 0 | 0 | 7 |
| 145 | `frontend/src/components/products/ProductDetailModal.jsx` | 4 | 1 | 3 | 1 |
| 146 | `frontend/src/components/products/ProductForm.jsx` | 9 | 1 | 7 | 1 |
| 147 | `frontend/src/components/products/productHistoryHelpers.mjs` | 0 | 2 | 0 | 2 |
| 148 | `frontend/src/components/products/productImportPlanner.mjs` | 0 | 8 | 0 | 3 |
| 149 | `frontend/src/components/products/productImportWorker.mjs` | 1 | 0 | 1 | 0 |
| 150 | `frontend/src/components/products/Products.jsx` | 27 | 1 | 25 | 1 |
| 151 | `frontend/src/components/products/scanbotScanner.mjs` | 0 | 3 | 0 | 3 |
| 152 | `frontend/src/components/products/VariantFormModal.jsx` | 6 | 1 | 5 | 1 |
| 153 | `frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | 3 | 1 | 2 | 1 |
| 154 | `frontend/src/components/receipt-settings/constants.js` | 0 | 3 | 0 | 4 |
| 155 | `frontend/src/components/receipt-settings/ErrorBoundary.jsx` | 1 | 1 | 0 | 1 |
| 156 | `frontend/src/components/receipt-settings/FieldOrderManager.jsx` | 2 | 1 | 0 | 1 |
| 157 | `frontend/src/components/receipt-settings/PrintSettings.jsx` | 3 | 1 | 1 | 1 |
| 158 | `frontend/src/components/receipt-settings/ReceiptPreview.jsx` | 2 | 1 | 1 | 1 |
| 159 | `frontend/src/components/receipt-settings/ReceiptSettings.jsx` | 11 | 1 | 9 | 1 |
| 160 | `frontend/src/components/receipt-settings/template.js` | 1 | 2 | 1 | 3 |
| 161 | `frontend/src/components/receipt/Receipt.jsx` | 6 | 1 | 4 | 3 |
| 162 | `frontend/src/components/returns/EditReturnModal.jsx` | 2 | 1 | 1 | 1 |
| 163 | `frontend/src/components/returns/NewReturnModal.jsx` | 3 | 1 | 2 | 1 |
| 164 | `frontend/src/components/returns/NewSupplierReturnModal.jsx` | 2 | 1 | 1 | 1 |
| 165 | `frontend/src/components/returns/ReturnDetailModal.jsx` | 2 | 1 | 2 | 1 |
| 166 | `frontend/src/components/returns/Returns.jsx` | 13 | 1 | 11 | 1 |
| 167 | `frontend/src/components/sales/ExportModal.jsx` | 4 | 1 | 2 | 1 |
| 168 | `frontend/src/components/sales/SaleDetailModal.jsx` | 3 | 1 | 2 | 1 |
| 169 | `frontend/src/components/sales/Sales.jsx` | 17 | 1 | 15 | 1 |
| 170 | `frontend/src/components/sales/SalesImportModal.jsx` | 4 | 1 | 3 | 1 |
| 171 | `frontend/src/components/sales/StatusBadge.jsx` | 0 | 5 | 0 | 5 |
| 172 | `frontend/src/components/server/ServerPage.jsx` | 4 | 1 | 3 | 1 |
| 173 | `frontend/src/components/shared/ActionHistoryBar.jsx` | 3 | 1 | 1 | 12 |
| 174 | `frontend/src/components/shared/ExportMenu.jsx` | 2 | 1 | 1 | 6 |
| 175 | `frontend/src/components/shared/FilterMenu.jsx` | 2 | 1 | 1 | 8 |
| 176 | `frontend/src/components/shared/ImageGalleryLightbox.jsx` | 2 | 1 | 0 | 3 |
| 177 | `frontend/src/components/shared/Modal.jsx` | 0 | 1 | 0 | 21 |
| 178 | `frontend/src/components/shared/navigationConfig.js` | 0 | 4 | 0 | 2 |
| 179 | `frontend/src/components/shared/NotificationCenter.jsx` | 3 | 1 | 1 | 2 |
| 180 | `frontend/src/components/shared/pageActivity.js` | 2 | 1 | 1 | 15 |
| 181 | `frontend/src/components/shared/PageHeader.jsx` | 0 | 1 | 0 | 6 |
| 182 | `frontend/src/components/shared/PageHelpButton.jsx` | 4 | 1 | 2 | 1 |
| 183 | `frontend/src/components/shared/pageHelpContent.js` | 0 | 2 | 0 | 1 |
| 184 | `frontend/src/components/shared/PortalMenu.jsx` | 3 | 2 | 0 | 8 |
| 185 | `frontend/src/components/shared/QuickPreferenceToggles.jsx` | 2 | 1 | 1 | 3 |
| 186 | `frontend/src/components/shared/WriteConflictModal.jsx` | 1 | 1 | 1 | 1 |
| 187 | `frontend/src/components/users/PermissionEditor.jsx` | 0 | 2 | 0 | 2 |
| 188 | `frontend/src/components/users/UserDetailSheet.jsx` | 2 | 1 | 2 | 1 |
| 189 | `frontend/src/components/users/UserProfileModal.jsx` | 10 | 1 | 8 | 2 |
| 190 | `frontend/src/components/users/Users.jsx` | 13 | 1 | 11 | 1 |
| 191 | `frontend/src/components/utils-settings/AuditLog.jsx` | 8 | 1 | 6 | 1 |
| 192 | `frontend/src/components/utils-settings/Backup.jsx` | 10 | 1 | 8 | 1 |
| 193 | `frontend/src/components/utils-settings/FontFamilyPicker.jsx` | 1 | 1 | 0 | 1 |
| 194 | `frontend/src/components/utils-settings/index.js` | 0 | 0 | 0 | 0 |
| 195 | `frontend/src/components/utils-settings/OtpModal.jsx` | 2 | 1 | 1 | 2 |
| 196 | `frontend/src/components/utils-settings/ResetData.jsx` | 4 | 0 | 2 | 1 |
| 197 | `frontend/src/components/utils-settings/Settings.jsx` | 9 | 1 | 7 | 1 |
| 198 | `frontend/src/constants.js` | 0 | 12 | 0 | 8 |
| 199 | `frontend/src/index.jsx` | 5 | 0 | 3 | 0 |
| 200 | `frontend/src/platform/runtime/clientRuntime.js` | 2 | 8 | 2 | 3 |
| 201 | `frontend/src/platform/storage/storagePolicy.mjs` | 0 | 8 | 0 | 0 |
| 202 | `frontend/src/utils/actionHistory.mjs` | 1 | 1 | 0 | 12 |
| 203 | `frontend/src/utils/appRefresh.js` | 0 | 1 | 0 | 2 |
| 204 | `frontend/src/utils/color.js` | 0 | 1 | 0 | 2 |
| 205 | `frontend/src/utils/csv.js` | 0 | 5 | 0 | 12 |
| 206 | `frontend/src/utils/csvImport.js` | 1 | 10 | 1 | 4 |
| 207 | `frontend/src/utils/dateHelpers.js` | 0 | 2 | 0 | 1 |
| 208 | `frontend/src/utils/deviceInfo.js` | 0 | 2 | 0 | 6 |
| 209 | `frontend/src/utils/exportPackage.js` | 1 | 2 | 1 | 3 |
| 210 | `frontend/src/utils/exportReports.jsx` | 3 | 1 | 2 | 2 |
| 211 | `frontend/src/utils/favicon.js` | 0 | 1 | 0 | 3 |
| 212 | `frontend/src/utils/formatters.js` | 0 | 4 | 0 | 16 |
| 213 | `frontend/src/utils/groupedRecords.mjs` | 0 | 8 | 0 | 9 |
| 214 | `frontend/src/utils/historyHelpers.mjs` | 0 | 3 | 0 | 10 |
| 215 | `frontend/src/utils/index.js` | 0 | 0 | 0 | 0 |
| 216 | `frontend/src/utils/loaders.mjs` | 0 | 8 | 0 | 10 |
| 217 | `frontend/src/utils/pricing.js` | 0 | 8 | 0 | 14 |
| 218 | `frontend/src/utils/printReceipt.js` | 0 | 9 | 0 | 2 |
| 219 | `frontend/src/utils/productGrouping.mjs` | 0 | 4 | 0 | 3 |
| 220 | `frontend/src/web-api.js` | 6 | 0 | 6 | 1 |
| 221 | `frontend/tailwind.config.mjs` | 0 | 0 | 0 | 0 |
| 222 | `frontend/tests/apiHttp.test.mjs` | 1 | 0 | 0 | 0 |
| 223 | `frontend/tests/appShellUtils.test.mjs` | 2 | 0 | 1 | 0 |
| 224 | `frontend/tests/barcodeImageScanner.test.mjs` | 2 | 0 | 1 | 0 |
| 225 | `frontend/tests/barcodeScannerState.test.mjs` | 2 | 0 | 1 | 0 |
| 226 | `frontend/tests/csvImport.test.mjs` | 2 | 0 | 1 | 0 |
| 227 | `frontend/tests/exportPackages.test.mjs` | 3 | 0 | 2 | 0 |
| 228 | `frontend/tests/groupedRecords.test.mjs` | 2 | 0 | 1 | 0 |
| 229 | `frontend/tests/historyHelpers.test.mjs` | 1 | 0 | 0 | 0 |
| 230 | `frontend/tests/loaders.test.mjs` | 1 | 0 | 0 | 0 |
| 231 | `frontend/tests/portalCatalogDisplay.test.mjs` | 1 | 0 | 0 | 0 |
| 232 | `frontend/tests/portalEditorUtils.test.mjs` | 1 | 0 | 0 | 0 |
| 233 | `frontend/tests/posCore.test.mjs` | 1 | 0 | 0 | 0 |
| 234 | `frontend/tests/pricingContacts.test.mjs` | 2 | 0 | 1 | 0 |
| 235 | `frontend/tests/productGrouping.test.mjs` | 2 | 0 | 1 | 0 |
| 236 | `frontend/tests/productHistoryHelpers.test.mjs` | 2 | 0 | 1 | 0 |
| 237 | `frontend/tests/productImportPlanner.test.mjs` | 2 | 0 | 1 | 0 |
| 238 | `frontend/tests/receiptTemplate.test.mjs` | 3 | 0 | 2 | 0 |
| 239 | `frontend/tests/scanbotScanner.test.mjs` | 2 | 0 | 1 | 0 |
| 240 | `frontend/tests/storagePolicy.test.mjs` | 1 | 0 | 0 | 0 |
| 241 | `frontend/vite.config.mjs` | 2 | 1 | 0 | 0 |
| 242 | `ops/scripts/backend/verify-data-integrity.js` | 4 | 0 | 3 | 0 |
| 243 | `ops/scripts/frontend/verify-i18n.js` | 2 | 0 | 1 | 0 |
| 244 | `ops/scripts/frontend/verify-performance.js` | 3 | 0 | 0 | 0 |
| 245 | `ops/scripts/frontend/verify-ui.js` | 2 | 0 | 0 | 0 |
| 246 | `ops/scripts/generate-doc-reference.js` | 3 | 0 | 1 | 0 |
| 247 | `ops/scripts/generate-full-project-docs.js` | 3 | 1 | 1 | 0 |
| 248 | `ops/scripts/lib/fs-utils.js` | 2 | 1 | 0 | 4 |
| 249 | `ops/scripts/performance-scan.js` | 3 | 0 | 1 | 0 |
| 250 | `ops/scripts/runtime/check-public-url.mjs` | 2 | 0 | 0 | 0 |
| 251 | `ops/scripts/verify-runtime-deps.js` | 2 | 0 | 0 | 0 |
| 252 | `ops/scripts/verify-scale-services.js` | 3 | 0 | 0 | 0 |

## 3. Detailed File Dependency Commentary

### 3.1 `backend/server.js`

- Declared exports: none detected
- Imports (36)
  - `./src/config`
  - `./src/database`
  - `./src/helpers`
  - `./src/middleware`
  - `./src/organizationContext`
  - `./src/requestContext`
  - `./src/routes/actionHistory`
  - `./src/routes/ai`
  - `./src/routes/auth`
  - `./src/routes/branches`
  - `./src/routes/catalog`
  - `./src/routes/categories`
  - `./src/routes/contacts`
  - `./src/routes/customTables`
  - `./src/routes/files`
  - `./src/routes/importJobs`
  - `./src/routes/inventory`
  - `./src/routes/notifications`
  - `./src/routes/organizations`
  - `./src/routes/portal`
  - `./src/routes/products`
  - `./src/routes/returns`
  - `./src/routes/sales`
  - `./src/routes/settings`
  - `./src/routes/system`
  - `./src/routes/units`
  - `./src/routes/users`
  - `./src/serverUtils`
  - `./src/services/importJobs`
  - `./src/websocket`
  - `compression`
  - `cors`
  - `express`
  - `fs`
  - `http`
  - `path`
- Internal dependencies (30)
  - `backend/src/config/index.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/organizationContext/index.js`
  - `backend/src/requestContext.js`
  - `backend/src/routes/actionHistory.js`
  - `backend/src/routes/ai.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/branches.js`
  - `backend/src/routes/catalog.js`
  - `backend/src/routes/categories.js`
  - `backend/src/routes/contacts.js`
  - `backend/src/routes/customTables.js`
  - `backend/src/routes/files.js`
  - `backend/src/routes/importJobs.js`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/notifications.js`
  - `backend/src/routes/organizations.js`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/returns.js`
  - `backend/src/routes/sales.js`
  - `backend/src/routes/settings.js`
  - `backend/src/routes/system/index.js`
  - `backend/src/routes/units.js`
  - `backend/src/routes/users.js`
  - `backend/src/serverUtils.js`
  - `backend/src/services/importJobs.js`
  - `backend/src/websocket.js`
- Referenced by (0)
  - none

### 3.2 `backend/src/accessControl.js`

- Declared exports: `module.exports`
- Imports (2)
  - `./config`
  - `./security`
- Internal dependencies (2)
  - `backend/src/config/index.js`
  - `backend/src/security.js`
- Referenced by (4)
  - `backend/src/middleware.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/system/index.js`
  - `backend/test/accessControl.test.js`

### 3.3 `backend/src/authOtpGuards.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./middleware`
- Internal dependencies (1)
  - `backend/src/middleware.js`
- Referenced by (2)
  - `backend/src/routes/auth.js`
  - `backend/test/authOtpGuards.test.js`

### 3.4 `backend/src/backupSchema.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/routes/system/index.js`
  - `backend/test/backupSchema.test.js`

### 3.5 `backend/src/config/index.js`

- Declared exports: `module.exports`
- Imports (5)
  - `../storage/organizationFolders`
  - `better-sqlite3`
  - `dotenv`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `backend/src/storage/organizationFolders.js`
- Referenced by (16)
  - `backend/server.js`
  - `backend/src/accessControl.js`
  - `backend/src/database.js`
  - `backend/src/fileAssets.js`
  - `backend/src/middleware.js`
  - `backend/src/organizationContext/index.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/importJobs.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/system/index.js`
  - `backend/src/runtimeState/index.js`
  - `backend/src/serverUtils.js`
  - `backend/src/services/googleDriveSync/index.js`
  - `backend/src/services/importJobs.js`
  - `backend/src/settingsSnapshot.js`
  - `ops/scripts/backend/verify-data-integrity.js`

### 3.6 `backend/src/conflictControl.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (12)
  - `backend/src/routes/ai.js`
  - `backend/src/routes/branches.js`
  - `backend/src/routes/categories.js`
  - `backend/src/routes/contacts.js`
  - `backend/src/routes/customTables.js`
  - `backend/src/routes/files.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/returns.js`
  - `backend/src/routes/sales.js`
  - `backend/src/routes/settings.js`
  - `backend/src/routes/units.js`
  - `backend/src/routes/users.js`

### 3.7 `backend/src/contactOptions.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/routes/contacts.js`
  - `backend/test/contactOptions.test.js`

### 3.8 `backend/src/database.js`

- Declared exports: `module.exports`
- Imports (7)
  - `./config`
  - `./uploadReferenceCleanup`
  - `bcryptjs`
  - `better-sqlite3`
  - `crypto`
  - `fs`
  - `path`
- Internal dependencies (2)
  - `backend/src/config/index.js`
  - `backend/src/uploadReferenceCleanup.js`
- Referenced by (28)
  - `backend/server.js`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/organizationContext/index.js`
  - `backend/src/routes/actionHistory.js`
  - `backend/src/routes/ai.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/branches.js`
  - `backend/src/routes/catalog.js`
  - `backend/src/routes/categories.js`
  - `backend/src/routes/contacts.js`
  - `backend/src/routes/customTables.js`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/notifications.js`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/returns.js`
  - `backend/src/routes/sales.js`
  - `backend/src/routes/settings.js`
  - `backend/src/routes/system/index.js`
  - `backend/src/routes/units.js`
  - `backend/src/routes/users.js`
  - `backend/src/services/googleDriveSync/index.js`
  - `backend/src/services/importJobs.js`
  - `backend/src/services/portalAi.js`
  - `backend/src/services/verification.js`
  - `backend/src/sessionAuth.js`
  - `ops/scripts/backend/verify-data-integrity.js`

### 3.9 `backend/src/dataPath/index.js`

- Declared exports: `module.exports`
- Imports (2)
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `backend/src/organizationContext/index.js`
  - `backend/src/routes/system/index.js`
  - `backend/src/services/googleDriveSync/index.js`
  - `backend/src/systemFsWorker.js`
  - `backend/test/dataPath.test.js`

### 3.10 `backend/src/fileAssets.js`

- Declared exports: `module.exports`
- Imports (8)
  - `./config`
  - `./database`
  - `./uploadReferenceCleanup`
  - `./uploadSecurity`
  - `child_process`
  - `fs`
  - `path`
  - `sharp`
- Internal dependencies (4)
  - `backend/src/config/index.js`
  - `backend/src/database.js`
  - `backend/src/uploadReferenceCleanup.js`
  - `backend/src/uploadSecurity.js`
- Referenced by (8)
  - `backend/src/middleware.js`
  - `backend/src/routes/files.js`
  - `backend/src/routes/importJobs.js`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/users.js`
  - `backend/src/services/importJobs.js`
  - `backend/test/uploadSecurity.test.js`

### 3.11 `backend/src/helpers.js`

- Declared exports: `module.exports`
- Imports (3)
  - `./database`
  - `./requestContext`
  - `./services/googleDriveSync`
- Internal dependencies (3)
  - `backend/src/database.js`
  - `backend/src/requestContext.js`
  - `backend/src/services/googleDriveSync/index.js`
- Referenced by (23)
  - `backend/server.js`
  - `backend/src/routes/actionHistory.js`
  - `backend/src/routes/ai.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/branches.js`
  - `backend/src/routes/catalog.js`
  - `backend/src/routes/categories.js`
  - `backend/src/routes/contacts.js`
  - `backend/src/routes/customTables.js`
  - `backend/src/routes/files.js`
  - `backend/src/routes/importJobs.js`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/returns.js`
  - `backend/src/routes/sales.js`
  - `backend/src/routes/settings.js`
  - `backend/src/routes/system/index.js`
  - `backend/src/routes/units.js`
  - `backend/src/routes/users.js`
  - `backend/src/services/importJobs.js`
  - `backend/src/websocket.js`
  - `ops/scripts/backend/verify-data-integrity.js`

### 3.12 `backend/src/idempotency.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `backend/src/routes/products.js`
  - `backend/src/routes/returns.js`
  - `backend/src/routes/sales.js`
  - `backend/test/idempotency.test.js`

### 3.13 `backend/src/importCsv.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/services/importJobs.js`
  - `backend/test/importCsv.test.js`

### 3.14 `backend/src/importParsing.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./money`
- Internal dependencies (1)
  - `backend/src/money.js`
- Referenced by (2)
  - `backend/src/productImportPolicies.js`
  - `backend/test/importCsv.test.js`

### 3.15 `backend/src/middleware.js`

- Declared exports: `module.exports`
- Imports (10)
  - `./accessControl`
  - `./config`
  - `./fileAssets`
  - `./security`
  - `./sessionAuth`
  - `./uploadSecurity`
  - `fs`
  - `multer`
  - `path`
  - `sharp`
- Internal dependencies (6)
  - `backend/src/accessControl.js`
  - `backend/src/config/index.js`
  - `backend/src/fileAssets.js`
  - `backend/src/security.js`
  - `backend/src/sessionAuth.js`
  - `backend/src/uploadSecurity.js`
- Referenced by (22)
  - `backend/server.js`
  - `backend/src/authOtpGuards.js`
  - `backend/src/routes/actionHistory.js`
  - `backend/src/routes/ai.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/branches.js`
  - `backend/src/routes/categories.js`
  - `backend/src/routes/contacts.js`
  - `backend/src/routes/customTables.js`
  - `backend/src/routes/files.js`
  - `backend/src/routes/importJobs.js`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/notifications.js`
  - `backend/src/routes/organizations.js`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/returns.js`
  - `backend/src/routes/sales.js`
  - `backend/src/routes/settings.js`
  - `backend/src/routes/system/index.js`
  - `backend/src/routes/units.js`
  - `backend/src/routes/users.js`

### 3.16 `backend/src/money.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `backend/src/importParsing.js`
  - `backend/src/productDiscounts.js`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/products.js`
  - `backend/src/services/importJobs.js`

### 3.17 `backend/src/netSecurity.js`

- Declared exports: `module.exports`
- Imports (1)
  - `net`
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/src/services/aiGateway.js`
  - `backend/src/services/importJobs.js`
  - `backend/test/netSecurity.test.js`

### 3.18 `backend/src/organizationContext/index.js`

- Declared exports: `module.exports`
- Imports (7)
  - `../config`
  - `../dataPath`
  - `../database`
  - `../storage/organizationFolders`
  - `crypto`
  - `fs`
  - `path`
- Internal dependencies (4)
  - `backend/src/config/index.js`
  - `backend/src/dataPath/index.js`
  - `backend/src/database.js`
  - `backend/src/storage/organizationFolders.js`
- Referenced by (6)
  - `backend/server.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/organizations.js`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/system/index.js`
  - `backend/src/routes/users.js`

### 3.19 `backend/src/portalUtils.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/routes/portal.js`
  - `backend/test/portalUtils.test.js`

### 3.20 `backend/src/productDiscounts.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./money`
- Internal dependencies (1)
  - `backend/src/money.js`
- Referenced by (3)
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/products.js`
  - `backend/src/services/importJobs.js`

### 3.21 `backend/src/productImportPolicies.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./importParsing`
- Internal dependencies (1)
  - `backend/src/importParsing.js`
- Referenced by (3)
  - `backend/src/routes/products.js`
  - `backend/src/services/importJobs.js`
  - `backend/test/productImportPolicies.test.js`

### 3.22 `backend/src/requestContext.js`

- Declared exports: `module.exports`
- Imports (1)
  - `async_hooks`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/server.js`
  - `backend/src/helpers.js`

### 3.23 `backend/src/routes/actionHistory.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
- Referenced by (1)
  - `backend/server.js`

### 3.24 `backend/src/routes/ai.js`

- Declared exports: `module.exports`
- Imports (6)
  - `../conflictControl`
  - `../database`
  - `../helpers`
  - `../middleware`
  - `../services/aiGateway`
  - `express`
- Internal dependencies (5)
  - `backend/src/conflictControl.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/services/aiGateway.js`
- Referenced by (1)
  - `backend/server.js`

### 3.25 `backend/src/routes/auth.js`

- Declared exports: `module.exports`
- Imports (18)
  - `../accessControl`
  - `../authOtpGuards`
  - `../config`
  - `../database`
  - `../helpers`
  - `../middleware`
  - `../organizationContext`
  - `../runtimeState`
  - `../security`
  - `../services/supabaseAuth`
  - `../services/verification`
  - `../sessionAuth`
  - `../settingsSnapshot`
  - `bcryptjs`
  - `crypto`
  - `express`
  - `qrcode`
  - `speakeasy`
- Internal dependencies (13)
  - `backend/src/accessControl.js`
  - `backend/src/authOtpGuards.js`
  - `backend/src/config/index.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/organizationContext/index.js`
  - `backend/src/runtimeState/index.js`
  - `backend/src/security.js`
  - `backend/src/services/supabaseAuth.js`
  - `backend/src/services/verification.js`
  - `backend/src/sessionAuth.js`
  - `backend/src/settingsSnapshot.js`
- Referenced by (1)
  - `backend/server.js`

### 3.26 `backend/src/routes/branches.js`

- Declared exports: `module.exports`
- Imports (5)
  - `../conflictControl`
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (4)
  - `backend/src/conflictControl.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
- Referenced by (1)
  - `backend/server.js`

### 3.27 `backend/src/routes/catalog.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../settingsSnapshot`
  - `express`
- Internal dependencies (3)
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/settingsSnapshot.js`
- Referenced by (1)
  - `backend/server.js`

### 3.28 `backend/src/routes/categories.js`

- Declared exports: `module.exports`
- Imports (5)
  - `../conflictControl`
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (4)
  - `backend/src/conflictControl.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
- Referenced by (1)
  - `backend/server.js`

### 3.29 `backend/src/routes/contacts.js`

- Declared exports: `module.exports`
- Imports (6)
  - `../conflictControl`
  - `../contactOptions`
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (5)
  - `backend/src/conflictControl.js`
  - `backend/src/contactOptions.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
- Referenced by (1)
  - `backend/server.js`

### 3.30 `backend/src/routes/customTables.js`

- Declared exports: `module.exports`
- Imports (5)
  - `../conflictControl`
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (4)
  - `backend/src/conflictControl.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
- Referenced by (1)
  - `backend/server.js`

### 3.31 `backend/src/routes/files.js`

- Declared exports: `module.exports`
- Imports (5)
  - `../conflictControl`
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (4)
  - `backend/src/conflictControl.js`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
- Referenced by (1)
  - `backend/server.js`

### 3.32 `backend/src/routes/importJobs.js`

- Declared exports: `module.exports`
- Imports (9)
  - `../config`
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `../services/importJobs`
  - `express`
  - `fs`
  - `multer`
  - `path`
- Internal dependencies (5)
  - `backend/src/config/index.js`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/services/importJobs.js`
- Referenced by (1)
  - `backend/server.js`

### 3.33 `backend/src/routes/inventory.js`

- Declared exports: `module.exports`
- Imports (6)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `../money`
  - `../productDiscounts`
  - `express`
- Internal dependencies (5)
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/money.js`
  - `backend/src/productDiscounts.js`
- Referenced by (1)
  - `backend/server.js`

### 3.34 `backend/src/routes/notifications.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../middleware`
  - `../services/googleDriveSync`
  - `express`
- Internal dependencies (3)
  - `backend/src/database.js`
  - `backend/src/middleware.js`
  - `backend/src/services/googleDriveSync/index.js`
- Referenced by (1)
  - `backend/server.js`

### 3.35 `backend/src/routes/organizations.js`

- Declared exports: `module.exports`
- Imports (3)
  - `../middleware`
  - `../organizationContext`
  - `express`
- Internal dependencies (2)
  - `backend/src/middleware.js`
  - `backend/src/organizationContext/index.js`
- Referenced by (1)
  - `backend/server.js`

### 3.36 `backend/src/routes/portal.js`

- Declared exports: `module.exports`
- Imports (11)
  - `../database`
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `../netSecurity`
  - `../organizationContext`
  - `../portalUtils`
  - `../security`
  - `../services/portalAi`
  - `../settingsSnapshot`
  - `express`
- Internal dependencies (10)
  - `backend/src/database.js`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/netSecurity.js`
  - `backend/src/organizationContext/index.js`
  - `backend/src/portalUtils.js`
  - `backend/src/security.js`
  - `backend/src/services/portalAi.js`
  - `backend/src/settingsSnapshot.js`
- Referenced by (1)
  - `backend/server.js`

### 3.37 `backend/src/routes/products.js`

- Declared exports: `module.exports`
- Imports (15)
  - `../config`
  - `../conflictControl`
  - `../database`
  - `../fileAssets`
  - `../helpers`
  - `../idempotency`
  - `../middleware`
  - `../money`
  - `../netSecurity`
  - `../productDiscounts`
  - `../productImportPolicies`
  - `../settingsSnapshot`
  - `express`
  - `fs`
  - `path`
- Internal dependencies (12)
  - `backend/src/config/index.js`
  - `backend/src/conflictControl.js`
  - `backend/src/database.js`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/idempotency.js`
  - `backend/src/middleware.js`
  - `backend/src/money.js`
  - `backend/src/netSecurity.js`
  - `backend/src/productDiscounts.js`
  - `backend/src/productImportPolicies.js`
  - `backend/src/settingsSnapshot.js`
- Referenced by (1)
  - `backend/server.js`

### 3.38 `backend/src/routes/returns.js`

- Declared exports: `module.exports`
- Imports (6)
  - `../conflictControl`
  - `../database`
  - `../helpers`
  - `../idempotency`
  - `../middleware`
  - `express`
- Internal dependencies (5)
  - `backend/src/conflictControl.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/idempotency.js`
  - `backend/src/middleware.js`
- Referenced by (1)
  - `backend/server.js`

### 3.39 `backend/src/routes/sales.js`

- Declared exports: `module.exports`
- Imports (6)
  - `../conflictControl`
  - `../database`
  - `../helpers`
  - `../idempotency`
  - `../middleware`
  - `express`
- Internal dependencies (5)
  - `backend/src/conflictControl.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/idempotency.js`
  - `backend/src/middleware.js`
- Referenced by (1)
  - `backend/server.js`

### 3.40 `backend/src/routes/settings.js`

- Declared exports: `module.exports`
- Imports (6)
  - `../conflictControl`
  - `../database`
  - `../helpers`
  - `../middleware`
  - `../settingsSnapshot`
  - `express`
- Internal dependencies (5)
  - `backend/src/conflictControl.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/settingsSnapshot.js`
- Referenced by (1)
  - `backend/server.js`

### 3.41 `backend/src/routes/system/index.js`

- Declared exports: `module.exports`
- Imports (17)
  - `../../accessControl`
  - `../../backupSchema`
  - `../../config`
  - `../../dataPath`
  - `../../database`
  - `../../helpers`
  - `../../middleware`
  - `../../organizationContext`
  - `../../runtimeState`
  - `../../security`
  - `../../services/googleDriveSync`
  - `../../services/importJobs`
  - `better-sqlite3`
  - `child_process`
  - `express`
  - `fs`
  - `path`
- Internal dependencies (12)
  - `backend/src/accessControl.js`
  - `backend/src/backupSchema.js`
  - `backend/src/config/index.js`
  - `backend/src/dataPath/index.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/organizationContext/index.js`
  - `backend/src/runtimeState/index.js`
  - `backend/src/security.js`
  - `backend/src/services/googleDriveSync/index.js`
  - `backend/src/services/importJobs.js`
- Referenced by (1)
  - `backend/server.js`

### 3.42 `backend/src/routes/units.js`

- Declared exports: `module.exports`
- Imports (5)
  - `../conflictControl`
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (4)
  - `backend/src/conflictControl.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
- Referenced by (1)
  - `backend/server.js`

### 3.43 `backend/src/routes/users.js`

- Declared exports: `module.exports`
- Imports (11)
  - `../conflictControl`
  - `../database`
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `../organizationContext`
  - `../services/supabaseAuth`
  - `../services/verification`
  - `../sessionAuth`
  - `bcryptjs`
  - `express`
- Internal dependencies (9)
  - `backend/src/conflictControl.js`
  - `backend/src/database.js`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/organizationContext/index.js`
  - `backend/src/services/supabaseAuth.js`
  - `backend/src/services/verification.js`
  - `backend/src/sessionAuth.js`
- Referenced by (1)
  - `backend/server.js`

### 3.44 `backend/src/runtimeState/index.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../config`
  - `crypto`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `backend/src/config/index.js`
- Referenced by (2)
  - `backend/src/routes/auth.js`
  - `backend/src/routes/system/index.js`

### 3.45 `backend/src/security.js`

- Declared exports: `module.exports`
- Imports (1)
  - `crypto`
- Internal dependencies (0)
  - none
- Referenced by (7)
  - `backend/src/accessControl.js`
  - `backend/src/middleware.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/system/index.js`
  - `backend/src/services/aiGateway.js`
  - `backend/src/services/googleDriveSync/index.js`

### 3.46 `backend/src/serverUtils.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./config`
- Internal dependencies (1)
  - `backend/src/config/index.js`
- Referenced by (3)
  - `backend/server.js`
  - `backend/src/websocket.js`
  - `backend/test/serverUtils.test.js`

### 3.47 `backend/src/services/aiGateway.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../netSecurity`
  - `../security`
- Internal dependencies (2)
  - `backend/src/netSecurity.js`
  - `backend/src/security.js`
- Referenced by (2)
  - `backend/src/routes/ai.js`
  - `backend/src/services/portalAi.js`

### 3.48 `backend/src/services/firebaseAuth.js`

- Declared exports: `module.exports`
- Imports (2)
  - `crypto`
  - `fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.49 `backend/src/services/googleDriveSync/index.js`

- Declared exports: `module.exports`
- Imports (8)
  - `../../config`
  - `../../dataPath`
  - `../../database`
  - `../../security`
  - `crypto`
  - `fs`
  - `os`
  - `path`
- Internal dependencies (4)
  - `backend/src/config/index.js`
  - `backend/src/dataPath/index.js`
  - `backend/src/database.js`
  - `backend/src/security.js`
- Referenced by (3)
  - `backend/src/helpers.js`
  - `backend/src/routes/notifications.js`
  - `backend/src/routes/system/index.js`

### 3.50 `backend/src/services/importJobs.js`

- Declared exports: `module.exports`
- Imports (16)
  - `../config`
  - `../database`
  - `../fileAssets`
  - `../helpers`
  - `../importCsv`
  - `../money`
  - `../netSecurity`
  - `../productDiscounts`
  - `../productImportPolicies`
  - `../uploadSecurity`
  - `bullmq`
  - `crypto`
  - `fs`
  - `ioredis`
  - `path`
  - `yauzl`
- Internal dependencies (10)
  - `backend/src/config/index.js`
  - `backend/src/database.js`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/importCsv.js`
  - `backend/src/money.js`
  - `backend/src/netSecurity.js`
  - `backend/src/productDiscounts.js`
  - `backend/src/productImportPolicies.js`
  - `backend/src/uploadSecurity.js`
- Referenced by (3)
  - `backend/server.js`
  - `backend/src/routes/importJobs.js`
  - `backend/src/routes/system/index.js`

### 3.51 `backend/src/services/portalAi.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../database`
  - `./aiGateway`
- Internal dependencies (2)
  - `backend/src/database.js`
  - `backend/src/services/aiGateway.js`
- Referenced by (1)
  - `backend/src/routes/portal.js`

### 3.52 `backend/src/services/supabaseAuth.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/routes/auth.js`
  - `backend/src/routes/users.js`

### 3.53 `backend/src/services/verification.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../database`
  - `crypto`
- Internal dependencies (1)
  - `backend/src/database.js`
- Referenced by (2)
  - `backend/src/routes/auth.js`
  - `backend/src/routes/users.js`

### 3.54 `backend/src/sessionAuth.js`

- Declared exports: `module.exports`
- Imports (2)
  - `./database`
  - `crypto`
- Internal dependencies (1)
  - `backend/src/database.js`
- Referenced by (4)
  - `backend/src/middleware.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/users.js`
  - `backend/src/websocket.js`

### 3.55 `backend/src/settingsSnapshot.js`

- Declared exports: `module.exports`
- Imports (3)
  - `./config`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `backend/src/config/index.js`
- Referenced by (6)
  - `backend/src/routes/auth.js`
  - `backend/src/routes/catalog.js`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/settings.js`
  - `backend/src/uploadReferenceCleanup.js`

### 3.56 `backend/src/storage/organizationFolders.js`

- Declared exports: `module.exports`
- Imports (2)
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/config/index.js`
  - `backend/src/organizationContext/index.js`

### 3.57 `backend/src/systemFsWorker.js`

- Declared exports: none detected
- Imports (3)
  - `./dataPath`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `backend/src/dataPath/index.js`
- Referenced by (0)
  - none

### 3.58 `backend/src/uploadReferenceCleanup.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./settingsSnapshot`
- Internal dependencies (1)
  - `backend/src/settingsSnapshot.js`
- Referenced by (2)
  - `backend/src/database.js`
  - `backend/src/fileAssets.js`

### 3.59 `backend/src/uploadSecurity.js`

- Declared exports: `module.exports`
- Imports (2)
  - `fs`
  - `sharp`
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `backend/src/fileAssets.js`
  - `backend/src/middleware.js`
  - `backend/src/services/importJobs.js`
  - `backend/test/uploadSecurity.test.js`

### 3.60 `backend/src/websocket.js`

- Declared exports: `module.exports`
- Imports (5)
  - `./helpers`
  - `./serverUtils`
  - `./sessionAuth`
  - `http`
  - `ws`
- Internal dependencies (3)
  - `backend/src/helpers.js`
  - `backend/src/serverUtils.js`
  - `backend/src/sessionAuth.js`
- Referenced by (1)
  - `backend/server.js`

### 3.61 `backend/test/accessControl.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/accessControl`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/accessControl.js`
- Referenced by (0)
  - none

### 3.62 `backend/test/authOtpGuards.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/authOtpGuards`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/authOtpGuards.js`
- Referenced by (0)
  - none

### 3.63 `backend/test/authSecurityFlow.test.js`

- Declared exports: none detected
- Imports (6)
  - `child_process`
  - `fs`
  - `net`
  - `node:assert/strict`
  - `os`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.64 `backend/test/backupRoundtrip.test.js`

- Declared exports: none detected
- Imports (6)
  - `child_process`
  - `fs`
  - `net`
  - `node:assert/strict`
  - `os`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.65 `backend/test/backupSchema.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/backupSchema`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/backupSchema.js`
- Referenced by (0)
  - none

### 3.66 `backend/test/configOrganizationRuntime.test.js`

- Declared exports: none detected
- Imports (7)
  - `./src/config`
  - `better-sqlite3`
  - `child_process`
  - `fs`
  - `node:assert/strict`
  - `os`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.67 `backend/test/contactOptions.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/contactOptions`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/contactOptions.js`
- Referenced by (0)
  - none

### 3.68 `backend/test/dataPath.test.js`

- Declared exports: none detected
- Imports (5)
  - `../src/dataPath`
  - `fs`
  - `node:assert/strict`
  - `os`
  - `path`
- Internal dependencies (1)
  - `backend/src/dataPath/index.js`
- Referenced by (0)
  - none

### 3.69 `backend/test/fileRouteSecurityFlow.test.js`

- Declared exports: none detected
- Imports (6)
  - `child_process`
  - `fs`
  - `net`
  - `node:assert/strict`
  - `os`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.70 `backend/test/idempotency.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/idempotency`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/idempotency.js`
- Referenced by (0)
  - none

### 3.71 `backend/test/importCsv.test.js`

- Declared exports: none detected
- Imports (3)
  - `../src/importCsv`
  - `../src/importParsing`
  - `node:assert/strict`
- Internal dependencies (2)
  - `backend/src/importCsv.js`
  - `backend/src/importParsing.js`
- Referenced by (0)
  - none

### 3.72 `backend/test/netSecurity.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/netSecurity`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/netSecurity.js`
- Referenced by (0)
  - none

### 3.73 `backend/test/portalUtils.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/portalUtils`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/portalUtils.js`
- Referenced by (0)
  - none

### 3.74 `backend/test/productImportPolicies.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/productImportPolicies`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/productImportPolicies.js`
- Referenced by (0)
  - none

### 3.75 `backend/test/serverUtils.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/serverUtils`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/serverUtils.js`
- Referenced by (0)
  - none

### 3.76 `backend/test/stockConsistency.test.js`

- Declared exports: none detected
- Imports (7)
  - `better-sqlite3`
  - `child_process`
  - `fs`
  - `net`
  - `node:assert/strict`
  - `os`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.77 `backend/test/systemRouteSecurity.test.js`

- Declared exports: none detected
- Imports (6)
  - `child_process`
  - `fs`
  - `net`
  - `node:assert/strict`
  - `os`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.78 `backend/test/uploadSecurity.test.js`

- Declared exports: none detected
- Imports (3)
  - `../src/fileAssets`
  - `../src/uploadSecurity`
  - `node:assert/strict`
- Internal dependencies (2)
  - `backend/src/fileAssets.js`
  - `backend/src/uploadSecurity.js`
- Referenced by (0)
  - none

### 3.79 `frontend/postcss.config.mjs`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.80 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.81 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.worker.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.82 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd-threads.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.83 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.84 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.85 `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.86 `frontend/public/sw.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.87 `frontend/public/theme-bootstrap.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.88 `frontend/src/api/http.js`

- Declared exports: `__resetApiWriteDedupeForTests`, `apiFetch`, `buildApiRequestDedupeKey`, `cacheClearAll`, `cacheGet`, `cacheGetStale`, `cacheInvalidate`, `cacheSet`, `clearCallLog`, `getAuthSessionToken`, `getCallLog`, `getSyncServerUrl`, `getSyncToken`, `isNetErr`, `isServerOnline`, `isWriteBlockedError`, `isWriteConflictError`, `requireLiveServerWrite`, `route`, `setAuthSessionToken`, `setSyncServerUrl`, `setSyncToken`, `startHealthCheck`
- Imports (2)
  - `../constants.js`
  - `../utils/deviceInfo.js`
- Internal dependencies (2)
  - `frontend/src/constants.js`
  - `frontend/src/utils/deviceInfo.js`
- Referenced by (5)
  - `frontend/src/api/methods.js`
  - `frontend/src/api/websocket.js`
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/utils-settings/Backup.jsx`
  - `frontend/src/web-api.js`

### 3.89 `frontend/src/api/localDb.js`

- Declared exports: `buildCSVTemplate`, `clearLocalMirrorTables`, `dexieDb`, `localGetSettings`, `localGetSettingsMeta`, `localSaveSettings`, `localSaveSettingsMeta`, `parseCSV`, `replaceTableContents`, `resetLocalMirrorDb`
- Imports (1)
  - `dexie`
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `frontend/src/api/methods.js`
  - `frontend/src/platform/runtime/clientRuntime.js`
  - `frontend/src/web-api.js`

### 3.90 `frontend/src/api/methods.js`

- Declared exports: `adjustStock`, `askPortalAi`, `attachSaleCustomer`, `browseDir`, `bulkImportCustomers`, `bulkImportDeliveryContacts`, `bulkImportProducts`, `bulkImportSuppliers`, `cancelImportJob`, `changeUserPassword`, `completePasswordReset`, `completeSupabaseOauth`, `createActionHistory`, `createAiProvider`, `createBranch`, `createCategory`, `createCustomTable`, `createCustomer`, `createDeliveryContact`, `createImportJob`, `createPortalSubmission`, `createProduct`, `createProductVariant`, `createReturn`, `createRole`, `createSale`, `createSupplier`, `createSupplierReturn`, `createUnit`, `createUser`, `deleteAiProvider`, `deleteBranch`, `deleteCategory`, `deleteCustomRow`, `deleteCustomer`, `deleteDeliveryContact`, `deleteFileAsset`, `deleteProduct`, `deleteRole`, `deleteSupplier`, `deleteUnit`, `discardPendingSyncQueue`, `disconnectGoogleDriveSync`, `disconnectUserAuthProvider`, `downloadCustomerTemplate`, `downloadImportJobErrors`, `downloadImportTemplate`, `downloadSupplierTemplate`, `exportBackup`, `exportBackupFolder`, `factoryReset`, `forgetGoogleDriveSyncCredentials`, `getActionHistory`, `getAiProviders`, `getAiResponses`, `getAnalytics`, `getAppBootstrap`, `getAuditLogs`, `getBranchStock`, `getBranches`, `getCatalogMeta`, `getCatalogProducts`, `getCategories`, `getCurrentOrganization`, `getCustomTableData`, `getCustomTables`, `getCustomers`, `getDashboard`, `getDataPath`, `getDeliveryContacts`, `getFiles`, `getGoogleDriveSyncStatus`, `getImageDataUrl`, `getImportJob`, `getImportQueueStatus`, `getInventoryMovements`, `getInventorySummary`, `getNotificationSummary`, `getOrganizationBootstrap`, `getPendingSyncState`, `getPortalAiStatus`, `getPortalBootstrap`, `getPortalCatalogMeta`, `getPortalCatalogProducts`, `getPortalConfig`, `getPortalSubmissionsForReview`, `getProducts`, `getReturn`, `getReturns`, `getRoles`, `getSales`, `getSalesExport`, `getScaleMigrationStatus`, `getSettings`, `getSuppliers`, `getSystemConfig`, `getSystemDebugLog`, `getTransfers`, `getUnits`, `getUserAuthMethods`, `getUserProfile`, `getUsers`, `getVerificationCapabilities`, `importBackup`, `importBackupData`, `importBackupFolder`, `insertCustomRow`, `login`, `logout`, `lookupPortalMembership`, `moveStockRow`, `openCSVDialog`, `openFolderDialog`, `openImageDialog`, `openPath`, `otpConfirm`, `otpDisable`, `otpSetup`, `otpStatus`, `otpVerify`, `pickBackupFile`, `prepareScaleMigration`, `requestPasswordResetEmail`, `resetData`, `resetDataPath`, `resetPassword`, `resetPasswordWithOtp`, `retryImportJob`, `retryPendingSyncNow`, `reviewPortalSubmission`, `runScaleMigration`, `saveGoogleDriveSyncPreferences`, `saveSettings`, `searchOrganizations`, `setDataPath`, `startGoogleDriveSyncOauth`, `startImportJob`, `startSupabaseOauth`, `syncGoogleDriveNow`, `testAiProvider`, `testSyncServer`, `transferStock`, `updateActionHistory`, `updateAiProvider`, `updateBranch`, `updateCategory`, `updateCustomRow`, `updateCustomer`, `updateDeliveryContact`, `updateProduct`, `updateReturn`, `updateRole`, `updateSaleStatus`, `updateSessionDuration`, `updateSupplier`, `updateUnit`, `updateUser`, `updateUserProfile`, `uploadFileAsset`, `uploadImportJobCsv`, `uploadImportJobImages`, `uploadImportJobZip`, `uploadProductImage`, `uploadUserAvatar`
- Imports (5)
  - `../constants`
  - `../platform/runtime/clientRuntime.js`
  - `../utils/deviceInfo.js`
  - `./http.js`
  - `./localDb.js`
- Internal dependencies (5)
  - `frontend/src/api/http.js`
  - `frontend/src/api/localDb.js`
  - `frontend/src/constants.js`
  - `frontend/src/platform/runtime/clientRuntime.js`
  - `frontend/src/utils/deviceInfo.js`
- Referenced by (1)
  - `frontend/src/web-api.js`

### 3.91 `frontend/src/api/websocket.js`

- Declared exports: `connectWS`, `disconnectWS`, `isWSConnected`, `reconnectWS`
- Imports (2)
  - `../constants.js`
  - `./http.js`
- Internal dependencies (2)
  - `frontend/src/api/http.js`
  - `frontend/src/constants.js`
- Referenced by (2)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/web-api.js`

### 3.92 `frontend/src/App.jsx`

- Declared exports: `function`
- Imports (28)
  - `./AppContext`
  - `./app/appShellUtils.mjs`
  - `./components/auth/Login`
  - `./components/branches/Branches`
  - `./components/catalog/CatalogPage`
  - `./components/contacts/Contacts`
  - `./components/dashboard/Dashboard`
  - `./components/files/FilesPage`
  - `./components/inventory/Inventory`
  - `./components/loyalty-points/LoyaltyPointsPage`
  - `./components/navigation/Sidebar`
  - `./components/pos/POS`
  - `./components/products/Products`
  - `./components/receipt-settings/ReceiptSettings`
  - `./components/returns/Returns`
  - `./components/sales/Sales`
  - `./components/server/ServerPage`
  - `./components/shared/NotificationCenter`
  - `./components/shared/PageHelpButton`
  - `./components/shared/QuickPreferenceToggles`
  - `./components/shared/WriteConflictModal`
  - `./components/users/Users`
  - `./components/utils-settings/AuditLog`
  - `./components/utils-settings/Backup`
  - `./components/utils-settings/Settings`
  - `./utils/favicon`
  - `./utils/loaders.mjs`
  - `react`
- Internal dependencies (27)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/app/appShellUtils.mjs`
  - `frontend/src/components/auth/Login.jsx`
  - `frontend/src/components/branches/Branches.jsx`
  - `frontend/src/components/catalog/CatalogPage.jsx`
  - `frontend/src/components/contacts/Contacts.jsx`
  - `frontend/src/components/dashboard/Dashboard.jsx`
  - `frontend/src/components/files/FilesPage.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`
  - `frontend/src/components/navigation/Sidebar.jsx`
  - `frontend/src/components/pos/POS.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`
  - `frontend/src/components/returns/Returns.jsx`
  - `frontend/src/components/sales/Sales.jsx`
  - `frontend/src/components/server/ServerPage.jsx`
  - `frontend/src/components/shared/NotificationCenter.jsx`
  - `frontend/src/components/shared/PageHelpButton.jsx`
  - `frontend/src/components/shared/QuickPreferenceToggles.jsx`
  - `frontend/src/components/shared/WriteConflictModal.jsx`
  - `frontend/src/components/users/Users.jsx`
  - `frontend/src/components/utils-settings/AuditLog.jsx`
  - `frontend/src/components/utils-settings/Backup.jsx`
  - `frontend/src/components/utils-settings/Settings.jsx`
  - `frontend/src/utils/favicon.js`
  - `frontend/src/utils/loaders.mjs`
- Referenced by (1)
  - `frontend/src/index.jsx`

### 3.93 `frontend/src/app/appShellUtils.mjs`

- Declared exports: `MAX_MOUNTED_PAGES`, `getNotificationColor`, `getNotificationPrefix`, `isPublicCatalogPath`, `updateMountedPages`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/App.jsx`
  - `frontend/tests/appShellUtils.test.mjs`

### 3.94 `frontend/src/AppContext.jsx`

- Declared exports: `AppProvider`, `PAGE_PERMISSIONS`, `isBrokenLocalizedString`, `useApp`, `useSync`, `useT`
- Imports (11)
  - `./api/http.js`
  - `./api/websocket.js`
  - `./constants`
  - `./lang/en.json`
  - `./lang/km.json`
  - `./platform/runtime/clientRuntime.js`
  - `./utils/deviceInfo.js`
  - `./utils/loaders.mjs`
  - `./utils/pricing.js`
  - `./web-api.js`
  - `react`
- Internal dependencies (10)
  - `frontend/src/api/http.js`
  - `frontend/src/api/websocket.js`
  - `frontend/src/constants.js`
  - `frontend/src/lang/en.json`
  - `frontend/src/lang/km.json`
  - `frontend/src/platform/runtime/clientRuntime.js`
  - `frontend/src/utils/deviceInfo.js`
  - `frontend/src/utils/loaders.mjs`
  - `frontend/src/utils/pricing.js`
  - `frontend/src/web-api.js`
- Referenced by (50)
  - `frontend/src/App.jsx`
  - `frontend/src/components/auth/Login.jsx`
  - `frontend/src/components/branches/Branches.jsx`
  - `frontend/src/components/branches/BranchForm.jsx`
  - `frontend/src/components/branches/TransferModal.jsx`
  - `frontend/src/components/catalog/CatalogPage.jsx`
  - `frontend/src/components/contacts/Contacts.jsx`
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/shared.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`
  - `frontend/src/components/custom-tables/CustomTables.jsx`
  - `frontend/src/components/dashboard/charts/NoData.jsx`
  - `frontend/src/components/dashboard/Dashboard.jsx`
  - `frontend/src/components/files/FilePickerModal.jsx`
  - `frontend/src/components/files/FilesPage.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/inventory/InventoryImportModal.jsx`
  - `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`
  - `frontend/src/components/navigation/Sidebar.jsx`
  - `frontend/src/components/pos/POS.jsx`
  - `frontend/src/components/products/ManageBrandsModal.jsx`
  - `frontend/src/components/products/ManageCategoriesModal.jsx`
  - `frontend/src/components/products/ManageUnitsModal.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/products/VariantFormModal.jsx`
  - `frontend/src/components/receipt-settings/AllFieldsPanel.jsx`
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`
  - `frontend/src/components/receipt/Receipt.jsx`
  - `frontend/src/components/returns/EditReturnModal.jsx`
  - `frontend/src/components/returns/NewReturnModal.jsx`
  - `frontend/src/components/returns/NewSupplierReturnModal.jsx`
  - `frontend/src/components/returns/ReturnDetailModal.jsx`
  - `frontend/src/components/returns/Returns.jsx`
  - `frontend/src/components/sales/Sales.jsx`
  - `frontend/src/components/sales/SalesImportModal.jsx`
  - `frontend/src/components/server/ServerPage.jsx`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/NotificationCenter.jsx`
  - `frontend/src/components/shared/pageActivity.js`
  - `frontend/src/components/shared/PageHelpButton.jsx`
  - `frontend/src/components/shared/QuickPreferenceToggles.jsx`
  - `frontend/src/components/users/UserProfileModal.jsx`
  - `frontend/src/components/users/Users.jsx`
  - `frontend/src/components/utils-settings/AuditLog.jsx`
  - `frontend/src/components/utils-settings/Backup.jsx`
  - `frontend/src/components/utils-settings/OtpModal.jsx`
  - `frontend/src/components/utils-settings/ResetData.jsx`
  - `frontend/src/components/utils-settings/Settings.jsx`
  - `frontend/src/index.jsx`

### 3.95 `frontend/src/components/auth/Login.jsx`

- Declared exports: `function`
- Imports (5)
  - `../../AppContext`
  - `../../constants`
  - `../../utils/deviceInfo.js`
  - `../shared/QuickPreferenceToggles`
  - `react`
- Internal dependencies (4)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/QuickPreferenceToggles.jsx`
  - `frontend/src/constants.js`
  - `frontend/src/utils/deviceInfo.js`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.96 `frontend/src/components/branches/Branches.jsx`

- Declared exports: `function`
- Imports (11)
  - `../../AppContext`
  - `../../utils/actionHistory.mjs`
  - `../../utils/historyHelpers.mjs`
  - `../shared/ActionHistoryBar.jsx`
  - `../shared/Modal`
  - `../shared/PageHeader`
  - `../shared/pageActivity`
  - `./BranchForm`
  - `./TransferModal`
  - `lucide-react`
  - `react`
- Internal dependencies (9)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/branches/BranchForm.jsx`
  - `frontend/src/components/branches/TransferModal.jsx`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/components/shared/PageHeader.jsx`
  - `frontend/src/components/shared/pageActivity.js`
  - `frontend/src/utils/actionHistory.mjs`
  - `frontend/src/utils/historyHelpers.mjs`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.97 `frontend/src/components/branches/BranchForm.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (1)
  - `frontend/src/components/branches/Branches.jsx`

### 3.98 `frontend/src/components/branches/TransferModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (1)
  - `frontend/src/components/branches/Branches.jsx`

### 3.99 `frontend/src/components/catalog/CatalogPage.jsx`

- Declared exports: `function`
- Imports (11)
  - `../../AppContext`
  - `../../utils/favicon`
  - `../files/FilePickerModal`
  - `../products/primitives`
  - `../shared/ImageGalleryLightbox`
  - `../shared/PortalMenu`
  - `../shared/pageActivity`
  - `./CatalogProductsSection`
  - `./CatalogSecondaryTabs`
  - `./catalogUi`
  - `react`
- Internal dependencies (10)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/catalog/CatalogProductsSection.jsx`
  - `frontend/src/components/catalog/CatalogSecondaryTabs.jsx`
  - `frontend/src/components/catalog/catalogUi.jsx`
  - `frontend/src/components/files/FilePickerModal.jsx`
  - `frontend/src/components/products/primitives.jsx`
  - `frontend/src/components/shared/ImageGalleryLightbox.jsx`
  - `frontend/src/components/shared/PortalMenu.jsx`
  - `frontend/src/components/shared/pageActivity.js`
  - `frontend/src/utils/favicon.js`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.100 `frontend/src/components/catalog/CatalogProductsSection.jsx`

- Declared exports: `function`
- Imports (5)
  - `../products/primitives`
  - `./catalogUi`
  - `./portalCatalogDisplay.mjs`
  - `lucide-react`
  - `react`
- Internal dependencies (3)
  - `frontend/src/components/catalog/catalogUi.jsx`
  - `frontend/src/components/catalog/portalCatalogDisplay.mjs`
  - `frontend/src/components/products/primitives.jsx`
- Referenced by (1)
  - `frontend/src/components/catalog/CatalogPage.jsx`

### 3.101 `frontend/src/components/catalog/CatalogSecondaryTabs.jsx`

- Declared exports: `function`
- Imports (2)
  - `./catalogUi`
  - `react`
- Internal dependencies (1)
  - `frontend/src/components/catalog/catalogUi.jsx`
- Referenced by (1)
  - `frontend/src/components/catalog/CatalogPage.jsx`

### 3.102 `frontend/src/components/catalog/catalogUi.jsx`

- Declared exports: `SectionShell`, `StatusPill`, `SummaryTile`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `frontend/src/components/catalog/CatalogPage.jsx`
  - `frontend/src/components/catalog/CatalogProductsSection.jsx`
  - `frontend/src/components/catalog/CatalogSecondaryTabs.jsx`

### 3.103 `frontend/src/components/catalog/portalCatalogDisplay.mjs`

- Declared exports: `buildPortalHighlightBadges`, `buildPortalPricePresentation`, `getPortalGridClass`, `getPortalMobileGridClass`, `getPortalPromotionDetails`, `normalizeRecommendedProductIds`, `productMatchesPortalBranches`
- Imports (1)
  - `../../utils/pricing.js`
- Internal dependencies (1)
  - `frontend/src/utils/pricing.js`
- Referenced by (1)
  - `frontend/src/components/catalog/CatalogProductsSection.jsx`

### 3.104 `frontend/src/components/catalog/portalEditorUtils.mjs`

- Declared exports: `createAboutBlock`, `extractGoogleMapsEmbedUrl`, `moveListItem`, `normalizeAboutBlocks`, `normalizeGoogleMapsEmbed`, `serializeAboutBlocks`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.105 `frontend/src/components/contacts/contactOptionUtils.js`

- Declared exports: `CONTACT_OPTION_LIMIT`, `buildContactOptionSummary`, `createContactOption`, `getPrimaryContactOption`, `hasContactOptionData`, `limitContactOptions`, `parseContactOptionsFromImportRow`, `parseStoredContactOptions`, `serializeContactOptions`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.106 `frontend/src/components/contacts/Contacts.jsx`

- Declared exports: `function`
- Imports (12)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/loaders.mjs`
  - `../shared/Modal`
  - `../shared/PageHeader`
  - `../shared/pageActivity`
  - `./CustomersTab`
  - `./DeliveryTab`
  - `./SuppliersTab`
  - `./shared`
  - `lucide-react`
  - `react`
- Internal dependencies (10)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`
  - `frontend/src/components/contacts/shared.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/components/shared/PageHeader.jsx`
  - `frontend/src/components/shared/pageActivity.js`
  - `frontend/src/utils/csv.js`
  - `frontend/src/utils/loaders.mjs`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.107 `frontend/src/components/contacts/CustomersTab.jsx`

- Declared exports: `parseContactOptions`, `serializeContactOptions`
- Imports (13)
  - `../../AppContext`
  - `../../utils/actionHistory.mjs`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `../../utils/groupedRecords.mjs`
  - `../../utils/historyHelpers.mjs`
  - `../../utils/loaders.mjs`
  - `../shared/ActionHistoryBar.jsx`
  - `../shared/FilterMenu`
  - `../shared/Modal`
  - `./shared`
  - `lucide-react`
  - `react`
- Internal dependencies (11)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/contacts/shared.jsx`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/FilterMenu.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/utils/actionHistory.mjs`
  - `frontend/src/utils/csv.js`
  - `frontend/src/utils/formatters.js`
  - `frontend/src/utils/groupedRecords.mjs`
  - `frontend/src/utils/historyHelpers.mjs`
  - `frontend/src/utils/loaders.mjs`
- Referenced by (2)
  - `frontend/src/components/contacts/Contacts.jsx`
  - `frontend/src/components/pos/POS.jsx`

### 3.108 `frontend/src/components/contacts/DeliveryTab.jsx`

- Declared exports: `parseDeliveryOptions`, `serializeDeliveryOptions`
- Imports (13)
  - `../../AppContext`
  - `../../utils/actionHistory.mjs`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `../../utils/groupedRecords.mjs`
  - `../../utils/historyHelpers.mjs`
  - `../../utils/loaders.mjs`
  - `../shared/ActionHistoryBar.jsx`
  - `../shared/FilterMenu`
  - `../shared/Modal`
  - `./shared`
  - `lucide-react`
  - `react`
- Internal dependencies (11)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/contacts/shared.jsx`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/FilterMenu.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/utils/actionHistory.mjs`
  - `frontend/src/utils/csv.js`
  - `frontend/src/utils/formatters.js`
  - `frontend/src/utils/groupedRecords.mjs`
  - `frontend/src/utils/historyHelpers.mjs`
  - `frontend/src/utils/loaders.mjs`
- Referenced by (1)
  - `frontend/src/components/contacts/Contacts.jsx`

### 3.109 `frontend/src/components/contacts/shared.jsx`

- Declared exports: `ContactTable`, `DetailModal`, `ImportModal`, `ThreeDotMenu`, `useContactSelection`
- Imports (7)
  - `../../AppContext`
  - `../../utils/csvImport`
  - `../files/FilePickerModal`
  - `../shared/Modal`
  - `../shared/PortalMenu`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/files/FilePickerModal.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/components/shared/PortalMenu.jsx`
  - `frontend/src/utils/csvImport.js`
- Referenced by (4)
  - `frontend/src/components/contacts/Contacts.jsx`
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`

### 3.110 `frontend/src/components/contacts/SuppliersTab.jsx`

- Declared exports: none detected
- Imports (13)
  - `../../AppContext`
  - `../../utils/actionHistory.mjs`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `../../utils/groupedRecords.mjs`
  - `../../utils/historyHelpers.mjs`
  - `../../utils/loaders.mjs`
  - `../shared/ActionHistoryBar.jsx`
  - `../shared/FilterMenu`
  - `../shared/Modal`
  - `./shared`
  - `lucide-react`
  - `react`
- Internal dependencies (11)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/contacts/shared.jsx`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/FilterMenu.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/utils/actionHistory.mjs`
  - `frontend/src/utils/csv.js`
  - `frontend/src/utils/formatters.js`
  - `frontend/src/utils/groupedRecords.mjs`
  - `frontend/src/utils/historyHelpers.mjs`
  - `frontend/src/utils/loaders.mjs`
- Referenced by (1)
  - `frontend/src/components/contacts/Contacts.jsx`

### 3.111 `frontend/src/components/custom-tables/CustomTables.jsx`

- Declared exports: `function`
- Imports (5)
  - `../../AppContext`
  - `../../utils/actionHistory.mjs`
  - `../../utils/historyHelpers.mjs`
  - `../shared/ActionHistoryBar.jsx`
  - `react`
- Internal dependencies (4)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/utils/actionHistory.mjs`
  - `frontend/src/utils/historyHelpers.mjs`
- Referenced by (0)
  - none

### 3.112 `frontend/src/components/dashboard/charts/BarChart.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../../utils/formatters`
  - `./NoData`
  - `react`
- Internal dependencies (2)
  - `frontend/src/components/dashboard/charts/NoData.jsx`
  - `frontend/src/utils/formatters.js`
- Referenced by (0)
  - none

### 3.113 `frontend/src/components/dashboard/charts/DonutChart.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../../utils/formatters`
  - `./NoData`
  - `react`
- Internal dependencies (2)
  - `frontend/src/components/dashboard/charts/NoData.jsx`
  - `frontend/src/utils/formatters.js`
- Referenced by (0)
  - none

### 3.114 `frontend/src/components/dashboard/charts/index.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/dashboard/Dashboard.jsx`
  - `frontend/src/utils/exportReports.jsx`

### 3.115 `frontend/src/components/dashboard/charts/LineChart.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../../utils/formatters`
  - `./NoData`
  - `react`
- Internal dependencies (2)
  - `frontend/src/components/dashboard/charts/NoData.jsx`
  - `frontend/src/utils/formatters.js`
- Referenced by (0)
  - none

### 3.116 `frontend/src/components/dashboard/charts/NoData.jsx`

- Declared exports: `function`
- Imports (1)
  - `../../../AppContext`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (3)
  - `frontend/src/components/dashboard/charts/BarChart.jsx`
  - `frontend/src/components/dashboard/charts/DonutChart.jsx`
  - `frontend/src/components/dashboard/charts/LineChart.jsx`

### 3.117 `frontend/src/components/dashboard/Dashboard.jsx`

- Declared exports: `function`
- Imports (15)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/dateHelpers`
  - `../../utils/exportPackage`
  - `../../utils/exportReports`
  - `../../utils/formatters`
  - `../../utils/loaders.mjs`
  - `../../utils/pricing.js`
  - `../shared/ExportMenu`
  - `../shared/PortalMenu`
  - `../shared/pageActivity`
  - `./MiniStat`
  - `./charts`
  - `lucide-react`
  - `react`
- Internal dependencies (13)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/dashboard/MiniStat.jsx`
  - `frontend/src/components/dashboard/charts/index.js`
  - `frontend/src/components/shared/ExportMenu.jsx`
  - `frontend/src/components/shared/PortalMenu.jsx`
  - `frontend/src/components/shared/pageActivity.js`
  - `frontend/src/utils/csv.js`
  - `frontend/src/utils/dateHelpers.js`
  - `frontend/src/utils/exportPackage.js`
  - `frontend/src/utils/exportReports.jsx`
  - `frontend/src/utils/formatters.js`
  - `frontend/src/utils/loaders.mjs`
  - `frontend/src/utils/pricing.js`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.118 `frontend/src/components/dashboard/MiniStat.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/dashboard/Dashboard.jsx`

### 3.119 `frontend/src/components/files/FilePickerModal.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `../shared/Modal`
  - `react`
- Internal dependencies (2)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/Modal.jsx`
- Referenced by (5)
  - `frontend/src/components/catalog/CatalogPage.jsx`
  - `frontend/src/components/contacts/shared.jsx`
  - `frontend/src/components/products/BulkImportModal.jsx`
  - `frontend/src/components/products/ProductForm.jsx`
  - `frontend/src/components/users/UserProfileModal.jsx`

### 3.120 `frontend/src/components/files/FilesPage.jsx`

- Declared exports: `function`
- Imports (7)
  - `../../AppContext`
  - `../../utils/actionHistory.mjs`
  - `../../utils/historyHelpers.mjs`
  - `../shared/ActionHistoryBar.jsx`
  - `../shared/PageHeader`
  - `../shared/pageActivity`
  - `react`
- Internal dependencies (6)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/PageHeader.jsx`
  - `frontend/src/components/shared/pageActivity.js`
  - `frontend/src/utils/actionHistory.mjs`
  - `frontend/src/utils/historyHelpers.mjs`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.121 `frontend/src/components/inventory/DualMoney.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/inventory/Inventory.jsx`

### 3.122 `frontend/src/components/inventory/Inventory.jsx`

- Declared exports: `function`
- Imports (19)
  - `../../AppContext`
  - `../../utils/actionHistory.mjs`
  - `../../utils/csv`
  - `../../utils/exportPackage`
  - `../../utils/exportReports`
  - `../../utils/formatters`
  - `../../utils/groupedRecords.mjs`
  - `../../utils/historyHelpers.mjs`
  - `../../utils/pricing.js`
  - `../shared/ActionHistoryBar.jsx`
  - `../shared/ExportMenu`
  - `../shared/FilterMenu`
  - `../shared/pageActivity`
  - `./DualMoney`
  - `./InventoryImportModal`
  - `./ProductDetailModal`
  - `./movementGroups`
  - `lucide-react`
  - `react`
- Internal dependencies (17)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/inventory/DualMoney.jsx`
  - `frontend/src/components/inventory/InventoryImportModal.jsx`
  - `frontend/src/components/inventory/ProductDetailModal.jsx`
  - `frontend/src/components/inventory/movementGroups.js`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/ExportMenu.jsx`
  - `frontend/src/components/shared/FilterMenu.jsx`
  - `frontend/src/components/shared/pageActivity.js`
  - `frontend/src/utils/actionHistory.mjs`
  - `frontend/src/utils/csv.js`
  - `frontend/src/utils/exportPackage.js`
  - `frontend/src/utils/exportReports.jsx`
  - `frontend/src/utils/formatters.js`
  - `frontend/src/utils/groupedRecords.mjs`
  - `frontend/src/utils/historyHelpers.mjs`
  - `frontend/src/utils/pricing.js`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.123 `frontend/src/components/inventory/InventoryImportModal.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `../../utils/csvImport`
  - `../shared/Modal`
  - `react`
- Internal dependencies (3)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/utils/csvImport.js`
- Referenced by (1)
  - `frontend/src/components/inventory/Inventory.jsx`

### 3.124 `frontend/src/components/inventory/movementGroups.js`

- Declared exports: `buildMovementGroups`, `movementGroupHaystack`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/inventory/Inventory.jsx`

### 3.125 `frontend/src/components/inventory/ProductDetailModal.jsx`

- Declared exports: `function`
- Imports (1)
  - `../../utils/pricing.js`
- Internal dependencies (1)
  - `frontend/src/utils/pricing.js`
- Referenced by (1)
  - `frontend/src/components/inventory/Inventory.jsx`

### 3.126 `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `../shared/pageActivity`
  - `lucide-react`
  - `react`
- Internal dependencies (2)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/pageActivity.js`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.127 `frontend/src/components/navigation/Sidebar.jsx`

- Declared exports: `function`
- Imports (6)
  - `../../AppContext`
  - `../shared/NotificationCenter`
  - `../shared/QuickPreferenceToggles`
  - `../shared/navigationConfig`
  - `../users/UserProfileModal`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/NotificationCenter.jsx`
  - `frontend/src/components/shared/QuickPreferenceToggles.jsx`
  - `frontend/src/components/shared/navigationConfig.js`
  - `frontend/src/components/users/UserProfileModal.jsx`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.128 `frontend/src/components/pos/CartItem.jsx`

- Declared exports: `function`
- Imports (1)
  - `../../utils/pricing.js`
- Internal dependencies (1)
  - `frontend/src/utils/pricing.js`
- Referenced by (1)
  - `frontend/src/components/pos/POS.jsx`

### 3.129 `frontend/src/components/pos/FilterPanel.jsx`

- Declared exports: `function`
- Imports (1)
  - `lucide-react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/pos/POS.jsx`

### 3.130 `frontend/src/components/pos/POS.jsx`

- Declared exports: `function`
- Imports (14)
  - `../../AppContext`
  - `../../utils/deviceInfo`
  - `../../utils/pricing.js`
  - `../contacts/CustomersTab`
  - `../receipt/Receipt`
  - `../sales/StatusBadge`
  - `../shared/ImageGalleryLightbox`
  - `../shared/pageActivity`
  - `./CartItem`
  - `./FilterPanel`
  - `./ProductImage`
  - `./QuickAddModal`
  - `lucide-react`
  - `react`
- Internal dependencies (12)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/pos/CartItem.jsx`
  - `frontend/src/components/pos/FilterPanel.jsx`
  - `frontend/src/components/pos/ProductImage.jsx`
  - `frontend/src/components/pos/QuickAddModal.jsx`
  - `frontend/src/components/receipt/Receipt.jsx`
  - `frontend/src/components/sales/StatusBadge.jsx`
  - `frontend/src/components/shared/ImageGalleryLightbox.jsx`
  - `frontend/src/components/shared/pageActivity.js`
  - `frontend/src/utils/deviceInfo.js`
  - `frontend/src/utils/pricing.js`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.131 `frontend/src/components/pos/posCore.mjs`

- Declared exports: `buildProductsById`, `buildVariantChildrenByParentId`, `buildVisibleProductCards`, `findMatchingCartLineIndex`, `getCartLineId`, `getVariantChoices`, `getVariantRootProduct`, `resolveCartPriceValues`
- Imports (2)
  - `../../utils/pricing.js`
  - `../../utils/productGrouping.mjs`
- Internal dependencies (2)
  - `frontend/src/utils/pricing.js`
  - `frontend/src/utils/productGrouping.mjs`
- Referenced by (0)
  - none

### 3.132 `frontend/src/components/pos/ProductImage.jsx`

- Declared exports: `function`
- Imports (1)
  - `../products/primitives`
- Internal dependencies (1)
  - `frontend/src/components/products/primitives.jsx`
- Referenced by (1)
  - `frontend/src/components/pos/POS.jsx`

### 3.133 `frontend/src/components/pos/QuickAddModal.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/pos/POS.jsx`

### 3.134 `frontend/src/components/products/barcodeImageScanner.mjs`

- Declared exports: `scanBarcodeFromImageFile`
- Imports (1)
  - `@zxing/browser`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/products/BarcodeScannerModal.jsx`
  - `frontend/tests/barcodeImageScanner.test.mjs`

### 3.135 `frontend/src/components/products/BarcodeScannerModal.jsx`

- Declared exports: `function`
- Imports (7)
  - `../shared/Modal`
  - `./barcodeImageScanner.mjs`
  - `./barcodeScannerState.mjs`
  - `./scanbotScanner.mjs`
  - `@zxing/browser`
  - `lucide-react`
  - `react`
- Internal dependencies (4)
  - `frontend/src/components/products/barcodeImageScanner.mjs`
  - `frontend/src/components/products/barcodeScannerState.mjs`
  - `frontend/src/components/products/scanbotScanner.mjs`
  - `frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `frontend/src/components/products/ProductForm.jsx`

### 3.136 `frontend/src/components/products/barcodeScannerState.mjs`

- Declared exports: `deriveScannerPresentation`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/products/BarcodeScannerModal.jsx`
  - `frontend/tests/barcodeScannerState.test.mjs`

### 3.137 `frontend/src/components/products/BranchStockAdjuster.jsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/products/ProductForm.jsx`

### 3.138 `frontend/src/components/products/BulkAddStockModal.jsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.139 `frontend/src/components/products/BulkImportModal.jsx`

- Declared exports: `function`
- Imports (4)
  - `../files/FilePickerModal`
  - `../shared/Modal`
  - `./productImportPlanner.mjs`
  - `react`
- Internal dependencies (3)
  - `frontend/src/components/files/FilePickerModal.jsx`
  - `frontend/src/components/products/productImportPlanner.mjs`
  - `frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.140 `frontend/src/components/products/HeaderActions.jsx`

- Declared exports: `function`
- Imports (3)
  - `../shared/ExportMenu`
  - `../shared/PortalMenu`
  - `lucide-react`
- Internal dependencies (2)
  - `frontend/src/components/shared/ExportMenu.jsx`
  - `frontend/src/components/shared/PortalMenu.jsx`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.141 `frontend/src/components/products/ManageBrandsModal.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `../shared/Modal`
  - `react`
- Internal dependencies (2)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.142 `frontend/src/components/products/ManageCategoriesModal.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `../shared/Modal`
  - `react`
- Internal dependencies (2)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.143 `frontend/src/components/products/ManageUnitsModal.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `../shared/Modal`
  - `react`
- Internal dependencies (2)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.144 `frontend/src/components/products/primitives.jsx`

- Declared exports: none detected
- Imports (2)
  - `lucide-react`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (7)
  - `frontend/src/components/catalog/CatalogPage.jsx`
  - `frontend/src/components/catalog/CatalogProductsSection.jsx`
  - `frontend/src/components/pos/ProductImage.jsx`
  - `frontend/src/components/products/ProductDetailModal.jsx`
  - `frontend/src/components/products/ProductForm.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/products/VariantFormModal.jsx`

### 3.145 `frontend/src/components/products/ProductDetailModal.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../utils/color.js`
  - `../../utils/pricing.js`
  - `./primitives`
  - `lucide-react`
- Internal dependencies (3)
  - `frontend/src/components/products/primitives.jsx`
  - `frontend/src/utils/color.js`
  - `frontend/src/utils/pricing.js`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.146 `frontend/src/components/products/ProductForm.jsx`

- Declared exports: `function`
- Imports (9)
  - `../../utils/pricing.js`
  - `../files/FilePickerModal`
  - `../shared/Modal`
  - `./BarcodeScannerModal`
  - `./BranchStockAdjuster`
  - `./primitives`
  - `./scanbotScanner.mjs`
  - `lucide-react`
  - `react`
- Internal dependencies (7)
  - `frontend/src/components/files/FilePickerModal.jsx`
  - `frontend/src/components/products/BarcodeScannerModal.jsx`
  - `frontend/src/components/products/BranchStockAdjuster.jsx`
  - `frontend/src/components/products/primitives.jsx`
  - `frontend/src/components/products/scanbotScanner.mjs`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/utils/pricing.js`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.147 `frontend/src/components/products/productHistoryHelpers.mjs`

- Declared exports: `createProductHistoryRequestId`, `orderProductRestoreSnapshots`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/products/Products.jsx`
  - `frontend/tests/productHistoryHelpers.test.mjs`

### 3.148 `frontend/src/components/products/productImportPlanner.mjs`

- Declared exports: `PRODUCT_MONEY_FIELDS`, `PRODUCT_NUMBER_FIELDS`, `PRODUCT_PERCENT_FIELDS`, `analyzeProductImportRows`, `analyzeProductImportText`, `getProductImportDetailSignature`, `normalizeImportProductName`, `normalizeProductImportRow`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `frontend/src/components/products/BulkImportModal.jsx`
  - `frontend/src/components/products/productImportWorker.mjs`
  - `frontend/tests/productImportPlanner.test.mjs`

### 3.149 `frontend/src/components/products/productImportWorker.mjs`

- Declared exports: none detected
- Imports (1)
  - `./productImportPlanner.mjs`
- Internal dependencies (1)
  - `frontend/src/components/products/productImportPlanner.mjs`
- Referenced by (0)
  - none

### 3.150 `frontend/src/components/products/Products.jsx`

- Declared exports: `function`
- Imports (27)
  - `../../AppContext`
  - `../../utils/actionHistory.mjs`
  - `../../utils/color.js`
  - `../../utils/csv`
  - `../../utils/groupedRecords.mjs`
  - `../../utils/historyHelpers.mjs`
  - `../../utils/pricing.js`
  - `../../utils/productGrouping.mjs`
  - `../shared/ActionHistoryBar.jsx`
  - `../shared/FilterMenu`
  - `../shared/ImageGalleryLightbox`
  - `../shared/Modal`
  - `../shared/PortalMenu`
  - `../shared/pageActivity`
  - `./BulkAddStockModal`
  - `./BulkImportModal`
  - `./HeaderActions`
  - `./ManageBrandsModal`
  - `./ManageCategoriesModal`
  - `./ManageUnitsModal`
  - `./ProductDetailModal`
  - `./ProductForm`
  - `./VariantFormModal`
  - `./primitives`
  - `./productHistoryHelpers.mjs`
  - `lucide-react`
  - `react`
- Internal dependencies (25)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/products/BulkAddStockModal.jsx`
  - `frontend/src/components/products/BulkImportModal.jsx`
  - `frontend/src/components/products/HeaderActions.jsx`
  - `frontend/src/components/products/ManageBrandsModal.jsx`
  - `frontend/src/components/products/ManageCategoriesModal.jsx`
  - `frontend/src/components/products/ManageUnitsModal.jsx`
  - `frontend/src/components/products/ProductDetailModal.jsx`
  - `frontend/src/components/products/ProductForm.jsx`
  - `frontend/src/components/products/VariantFormModal.jsx`
  - `frontend/src/components/products/primitives.jsx`
  - `frontend/src/components/products/productHistoryHelpers.mjs`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/FilterMenu.jsx`
  - `frontend/src/components/shared/ImageGalleryLightbox.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/components/shared/PortalMenu.jsx`
  - `frontend/src/components/shared/pageActivity.js`
  - `frontend/src/utils/actionHistory.mjs`
  - `frontend/src/utils/color.js`
  - `frontend/src/utils/csv.js`
  - `frontend/src/utils/groupedRecords.mjs`
  - `frontend/src/utils/historyHelpers.mjs`
  - `frontend/src/utils/pricing.js`
  - `frontend/src/utils/productGrouping.mjs`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.151 `frontend/src/components/products/scanbotScanner.mjs`

- Declared exports: `getPreferredScannerMode`, `isCameraBlockedByDocumentPolicy`, `scanBarcodeWithScanbot`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `frontend/src/components/products/BarcodeScannerModal.jsx`
  - `frontend/src/components/products/ProductForm.jsx`
  - `frontend/tests/scanbotScanner.test.mjs`

### 3.152 `frontend/src/components/products/VariantFormModal.jsx`

- Declared exports: `function`
- Imports (6)
  - `../../AppContext`
  - `../../utils/historyHelpers.mjs`
  - `../../utils/pricing.js`
  - `../shared/Modal`
  - `./primitives`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/products/primitives.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/utils/historyHelpers.mjs`
  - `frontend/src/utils/pricing.js`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.153 `frontend/src/components/receipt-settings/AllFieldsPanel.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `./constants`
  - `react`
- Internal dependencies (2)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/receipt-settings/constants.js`
- Referenced by (1)
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.154 `frontend/src/components/receipt-settings/constants.js`

- Declared exports: `ALL_FIELD_ITEMS`, `DEFAULT_TEMPLATE`, `getFieldItems`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `frontend/src/components/receipt-settings/AllFieldsPanel.jsx`
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`
  - `frontend/src/components/receipt-settings/template.js`
  - `frontend/tests/receiptTemplate.test.mjs`

### 3.155 `frontend/src/components/receipt-settings/ErrorBoundary.jsx`

- Declared exports: `class`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.156 `frontend/src/components/receipt-settings/FieldOrderManager.jsx`

- Declared exports: `function`
- Imports (2)
  - `lucide-react`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.157 `frontend/src/components/receipt-settings/PrintSettings.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../utils/printReceipt`
  - `lucide-react`
  - `react`
- Internal dependencies (1)
  - `frontend/src/utils/printReceipt.js`
- Referenced by (1)
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.158 `frontend/src/components/receipt-settings/ReceiptPreview.jsx`

- Declared exports: `function`
- Imports (2)
  - `../receipt/Receipt`
  - `react`
- Internal dependencies (1)
  - `frontend/src/components/receipt/Receipt.jsx`
- Referenced by (1)
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.159 `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

- Declared exports: `function`
- Imports (11)
  - `../../AppContext`
  - `../../utils/loaders.mjs`
  - `./AllFieldsPanel`
  - `./ErrorBoundary`
  - `./FieldOrderManager`
  - `./PrintSettings`
  - `./ReceiptPreview`
  - `./constants`
  - `./template`
  - `lucide-react`
  - `react`
- Internal dependencies (9)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/receipt-settings/AllFieldsPanel.jsx`
  - `frontend/src/components/receipt-settings/ErrorBoundary.jsx`
  - `frontend/src/components/receipt-settings/FieldOrderManager.jsx`
  - `frontend/src/components/receipt-settings/PrintSettings.jsx`
  - `frontend/src/components/receipt-settings/ReceiptPreview.jsx`
  - `frontend/src/components/receipt-settings/constants.js`
  - `frontend/src/components/receipt-settings/template.js`
  - `frontend/src/utils/loaders.mjs`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.160 `frontend/src/components/receipt-settings/template.js`

- Declared exports: `parseReceiptTemplate`, `serializeReceiptTemplate`
- Imports (1)
  - `./constants.js`
- Internal dependencies (1)
  - `frontend/src/components/receipt-settings/constants.js`
- Referenced by (3)
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`
  - `frontend/src/components/receipt/Receipt.jsx`
  - `frontend/tests/receiptTemplate.test.mjs`

### 3.161 `frontend/src/components/receipt/Receipt.jsx`

- Declared exports: `function`
- Imports (6)
  - `../../AppContext`
  - `../../utils/printReceipt`
  - `../receipt-settings/template`
  - `../sales/StatusBadge`
  - `lucide-react`
  - `react`
- Internal dependencies (4)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/receipt-settings/template.js`
  - `frontend/src/components/sales/StatusBadge.jsx`
  - `frontend/src/utils/printReceipt.js`
- Referenced by (3)
  - `frontend/src/components/pos/POS.jsx`
  - `frontend/src/components/receipt-settings/ReceiptPreview.jsx`
  - `frontend/src/components/sales/Sales.jsx`

### 3.162 `frontend/src/components/returns/EditReturnModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (1)
  - `frontend/src/components/returns/Returns.jsx`

### 3.163 `frontend/src/components/returns/NewReturnModal.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `../../utils/formatters`
  - `react`
- Internal dependencies (2)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/utils/formatters.js`
- Referenced by (1)
  - `frontend/src/components/returns/Returns.jsx`

### 3.164 `frontend/src/components/returns/NewSupplierReturnModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (1)
  - `frontend/src/components/returns/Returns.jsx`

### 3.165 `frontend/src/components/returns/ReturnDetailModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `../../utils/formatters`
- Internal dependencies (2)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/utils/formatters.js`
- Referenced by (1)
  - `frontend/src/components/returns/Returns.jsx`

### 3.166 `frontend/src/components/returns/Returns.jsx`

- Declared exports: `function`
- Imports (13)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `../../utils/groupedRecords.mjs`
  - `../shared/ExportMenu`
  - `../shared/FilterMenu`
  - `../shared/pageActivity`
  - `./EditReturnModal`
  - `./NewReturnModal`
  - `./NewSupplierReturnModal`
  - `./ReturnDetailModal`
  - `lucide-react`
  - `react`
- Internal dependencies (11)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/returns/EditReturnModal.jsx`
  - `frontend/src/components/returns/NewReturnModal.jsx`
  - `frontend/src/components/returns/NewSupplierReturnModal.jsx`
  - `frontend/src/components/returns/ReturnDetailModal.jsx`
  - `frontend/src/components/shared/ExportMenu.jsx`
  - `frontend/src/components/shared/FilterMenu.jsx`
  - `frontend/src/components/shared/pageActivity.js`
  - `frontend/src/utils/csv.js`
  - `frontend/src/utils/formatters.js`
  - `frontend/src/utils/groupedRecords.mjs`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.167 `frontend/src/components/sales/ExportModal.jsx`

- Declared exports: `function`
- Imports (4)
  - `../shared/Modal`
  - `./StatusBadge`
  - `lucide-react`
  - `react`
- Internal dependencies (2)
  - `frontend/src/components/sales/StatusBadge.jsx`
  - `frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `frontend/src/components/sales/Sales.jsx`

### 3.168 `frontend/src/components/sales/SaleDetailModal.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../utils/formatters`
  - `./StatusBadge`
  - `react`
- Internal dependencies (2)
  - `frontend/src/components/sales/StatusBadge.jsx`
  - `frontend/src/utils/formatters.js`
- Referenced by (1)
  - `frontend/src/components/sales/Sales.jsx`

### 3.169 `frontend/src/components/sales/Sales.jsx`

- Declared exports: `function`
- Imports (17)
  - `../../AppContext`
  - `../../utils/actionHistory.mjs`
  - `../../utils/csv`
  - `../../utils/deviceInfo`
  - `../../utils/formatters`
  - `../../utils/groupedRecords.mjs`
  - `../receipt/Receipt`
  - `../shared/ActionHistoryBar.jsx`
  - `../shared/ExportMenu`
  - `../shared/FilterMenu`
  - `../shared/pageActivity`
  - `./ExportModal`
  - `./SaleDetailModal`
  - `./SalesImportModal`
  - `./StatusBadge`
  - `lucide-react`
  - `react`
- Internal dependencies (15)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/receipt/Receipt.jsx`
  - `frontend/src/components/sales/ExportModal.jsx`
  - `frontend/src/components/sales/SaleDetailModal.jsx`
  - `frontend/src/components/sales/SalesImportModal.jsx`
  - `frontend/src/components/sales/StatusBadge.jsx`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/ExportMenu.jsx`
  - `frontend/src/components/shared/FilterMenu.jsx`
  - `frontend/src/components/shared/pageActivity.js`
  - `frontend/src/utils/actionHistory.mjs`
  - `frontend/src/utils/csv.js`
  - `frontend/src/utils/deviceInfo.js`
  - `frontend/src/utils/formatters.js`
  - `frontend/src/utils/groupedRecords.mjs`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.170 `frontend/src/components/sales/SalesImportModal.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `../../utils/csvImport`
  - `../shared/Modal`
  - `react`
- Internal dependencies (3)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/utils/csvImport.js`
- Referenced by (1)
  - `frontend/src/components/sales/Sales.jsx`

### 3.171 `frontend/src/components/sales/StatusBadge.jsx`

- Declared exports: `ALL_STATUSES`, `STATUS_COLORS`, `STATUS_LABELS`, `function`, `getStatusLabel`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `frontend/src/components/pos/POS.jsx`
  - `frontend/src/components/receipt/Receipt.jsx`
  - `frontend/src/components/sales/ExportModal.jsx`
  - `frontend/src/components/sales/SaleDetailModal.jsx`
  - `frontend/src/components/sales/Sales.jsx`

### 3.172 `frontend/src/components/server/ServerPage.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `../shared/PageHeader`
  - `../shared/pageActivity`
  - `react`
- Internal dependencies (3)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/PageHeader.jsx`
  - `frontend/src/components/shared/pageActivity.js`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.173 `frontend/src/components/shared/ActionHistoryBar.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext.jsx`
  - `lucide-react`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (12)
  - `frontend/src/components/branches/Branches.jsx`
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`
  - `frontend/src/components/custom-tables/CustomTables.jsx`
  - `frontend/src/components/files/FilesPage.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/sales/Sales.jsx`
  - `frontend/src/components/users/UserProfileModal.jsx`
  - `frontend/src/components/users/Users.jsx`
  - `frontend/src/components/utils-settings/Backup.jsx`

### 3.174 `frontend/src/components/shared/ExportMenu.jsx`

- Declared exports: `function`
- Imports (2)
  - `./PortalMenu`
  - `lucide-react`
- Internal dependencies (1)
  - `frontend/src/components/shared/PortalMenu.jsx`
- Referenced by (6)
  - `frontend/src/components/dashboard/Dashboard.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/products/HeaderActions.jsx`
  - `frontend/src/components/returns/Returns.jsx`
  - `frontend/src/components/sales/Sales.jsx`
  - `frontend/src/components/utils-settings/AuditLog.jsx`

### 3.175 `frontend/src/components/shared/FilterMenu.jsx`

- Declared exports: `function`
- Imports (2)
  - `./PortalMenu`
  - `lucide-react`
- Internal dependencies (1)
  - `frontend/src/components/shared/PortalMenu.jsx`
- Referenced by (8)
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/returns/Returns.jsx`
  - `frontend/src/components/sales/Sales.jsx`
  - `frontend/src/components/utils-settings/AuditLog.jsx`

### 3.176 `frontend/src/components/shared/ImageGalleryLightbox.jsx`

- Declared exports: `function`
- Imports (2)
  - `lucide-react`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `frontend/src/components/catalog/CatalogPage.jsx`
  - `frontend/src/components/pos/POS.jsx`
  - `frontend/src/components/products/Products.jsx`

### 3.177 `frontend/src/components/shared/Modal.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (21)
  - `frontend/src/components/branches/Branches.jsx`
  - `frontend/src/components/contacts/Contacts.jsx`
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/shared.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`
  - `frontend/src/components/files/FilePickerModal.jsx`
  - `frontend/src/components/inventory/InventoryImportModal.jsx`
  - `frontend/src/components/products/BarcodeScannerModal.jsx`
  - `frontend/src/components/products/BulkImportModal.jsx`
  - `frontend/src/components/products/ManageBrandsModal.jsx`
  - `frontend/src/components/products/ManageCategoriesModal.jsx`
  - `frontend/src/components/products/ManageUnitsModal.jsx`
  - `frontend/src/components/products/ProductForm.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/products/VariantFormModal.jsx`
  - `frontend/src/components/sales/ExportModal.jsx`
  - `frontend/src/components/sales/SalesImportModal.jsx`
  - `frontend/src/components/shared/WriteConflictModal.jsx`
  - `frontend/src/components/users/UserProfileModal.jsx`
  - `frontend/src/components/users/Users.jsx`

### 3.178 `frontend/src/components/shared/navigationConfig.js`

- Declared exports: `DEFAULT_MOBILE_PINNED`, `NAV_ITEMS`, `orderNavItems`, `parseNavSetting`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/navigation/Sidebar.jsx`
  - `frontend/src/components/utils-settings/Settings.jsx`

### 3.179 `frontend/src/components/shared/NotificationCenter.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `lucide-react`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (2)
  - `frontend/src/App.jsx`
  - `frontend/src/components/navigation/Sidebar.jsx`

### 3.180 `frontend/src/components/shared/pageActivity.js`

- Declared exports: `useIsPageActive`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (15)
  - `frontend/src/components/branches/Branches.jsx`
  - `frontend/src/components/catalog/CatalogPage.jsx`
  - `frontend/src/components/contacts/Contacts.jsx`
  - `frontend/src/components/dashboard/Dashboard.jsx`
  - `frontend/src/components/files/FilesPage.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`
  - `frontend/src/components/pos/POS.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/returns/Returns.jsx`
  - `frontend/src/components/sales/Sales.jsx`
  - `frontend/src/components/server/ServerPage.jsx`
  - `frontend/src/components/users/Users.jsx`
  - `frontend/src/components/utils-settings/AuditLog.jsx`
  - `frontend/src/components/utils-settings/Backup.jsx`

### 3.181 `frontend/src/components/shared/PageHeader.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (6)
  - `frontend/src/components/branches/Branches.jsx`
  - `frontend/src/components/contacts/Contacts.jsx`
  - `frontend/src/components/files/FilesPage.jsx`
  - `frontend/src/components/server/ServerPage.jsx`
  - `frontend/src/components/utils-settings/Backup.jsx`
  - `frontend/src/components/utils-settings/Settings.jsx`

### 3.182 `frontend/src/components/shared/PageHelpButton.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `./pageHelpContent`
  - `lucide-react`
  - `react`
- Internal dependencies (2)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/pageHelpContent.js`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.183 `frontend/src/components/shared/pageHelpContent.js`

- Declared exports: `PAGE_HELP_CONTENT`, `getPageHelpContent`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/shared/PageHelpButton.jsx`

### 3.184 `frontend/src/components/shared/PortalMenu.jsx`

- Declared exports: `ThreeDotPortal`, `function`
- Imports (3)
  - `lucide-react`
  - `react`
  - `react-dom`
- Internal dependencies (0)
  - none
- Referenced by (8)
  - `frontend/src/components/catalog/CatalogPage.jsx`
  - `frontend/src/components/contacts/shared.jsx`
  - `frontend/src/components/dashboard/Dashboard.jsx`
  - `frontend/src/components/products/HeaderActions.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/shared/ExportMenu.jsx`
  - `frontend/src/components/shared/FilterMenu.jsx`
  - `frontend/src/components/users/Users.jsx`

### 3.185 `frontend/src/components/shared/QuickPreferenceToggles.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `lucide-react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (3)
  - `frontend/src/App.jsx`
  - `frontend/src/components/auth/Login.jsx`
  - `frontend/src/components/navigation/Sidebar.jsx`

### 3.186 `frontend/src/components/shared/WriteConflictModal.jsx`

- Declared exports: `function`
- Imports (1)
  - `./Modal`
- Internal dependencies (1)
  - `frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.187 `frontend/src/components/users/PermissionEditor.jsx`

- Declared exports: `PERMISSION_DEFS`, `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/users/UserDetailSheet.jsx`
  - `frontend/src/components/users/Users.jsx`

### 3.188 `frontend/src/components/users/UserDetailSheet.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../utils/formatters`
  - `./PermissionEditor`
- Internal dependencies (2)
  - `frontend/src/components/users/PermissionEditor.jsx`
  - `frontend/src/utils/formatters.js`
- Referenced by (1)
  - `frontend/src/components/users/Users.jsx`

### 3.189 `frontend/src/components/users/UserProfileModal.jsx`

- Declared exports: `function`
- Imports (10)
  - `../../AppContext`
  - `../../constants`
  - `../../utils/actionHistory.mjs`
  - `../../utils/loaders.mjs`
  - `../files/FilePickerModal`
  - `../shared/ActionHistoryBar`
  - `../shared/Modal`
  - `../utils-settings/OtpModal`
  - `lucide-react`
  - `react`
- Internal dependencies (8)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/files/FilePickerModal.jsx`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/components/utils-settings/OtpModal.jsx`
  - `frontend/src/constants.js`
  - `frontend/src/utils/actionHistory.mjs`
  - `frontend/src/utils/loaders.mjs`
- Referenced by (2)
  - `frontend/src/components/navigation/Sidebar.jsx`
  - `frontend/src/components/users/Users.jsx`

### 3.190 `frontend/src/components/users/Users.jsx`

- Declared exports: `function`
- Imports (13)
  - `../../AppContext`
  - `../../utils/actionHistory.mjs`
  - `../../utils/formatters`
  - `../../utils/historyHelpers.mjs`
  - `../shared/ActionHistoryBar.jsx`
  - `../shared/Modal`
  - `../shared/PortalMenu`
  - `../shared/pageActivity`
  - `./PermissionEditor`
  - `./UserDetailSheet`
  - `./UserProfileModal`
  - `lucide-react`
  - `react`
- Internal dependencies (11)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/components/shared/PortalMenu.jsx`
  - `frontend/src/components/shared/pageActivity.js`
  - `frontend/src/components/users/PermissionEditor.jsx`
  - `frontend/src/components/users/UserDetailSheet.jsx`
  - `frontend/src/components/users/UserProfileModal.jsx`
  - `frontend/src/utils/actionHistory.mjs`
  - `frontend/src/utils/formatters.js`
  - `frontend/src/utils/historyHelpers.mjs`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.191 `frontend/src/components/utils-settings/AuditLog.jsx`

- Declared exports: `function`
- Imports (8)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/groupedRecords.mjs`
  - `../shared/ExportMenu`
  - `../shared/FilterMenu`
  - `../shared/pageActivity`
  - `lucide-react`
  - `react`
- Internal dependencies (6)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/ExportMenu.jsx`
  - `frontend/src/components/shared/FilterMenu.jsx`
  - `frontend/src/components/shared/pageActivity.js`
  - `frontend/src/utils/csv.js`
  - `frontend/src/utils/groupedRecords.mjs`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.192 `frontend/src/components/utils-settings/Backup.jsx`

- Declared exports: `function`
- Imports (10)
  - `../../AppContext`
  - `../../api/http`
  - `../../utils/actionHistory.mjs`
  - `../../utils/appRefresh`
  - `../shared/ActionHistoryBar`
  - `../shared/PageHeader`
  - `../shared/pageActivity`
  - `./ResetData`
  - `lucide-react`
  - `react`
- Internal dependencies (8)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/api/http.js`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/PageHeader.jsx`
  - `frontend/src/components/shared/pageActivity.js`
  - `frontend/src/components/utils-settings/ResetData.jsx`
  - `frontend/src/utils/actionHistory.mjs`
  - `frontend/src/utils/appRefresh.js`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.193 `frontend/src/components/utils-settings/FontFamilyPicker.jsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/utils-settings/Settings.jsx`

### 3.194 `frontend/src/components/utils-settings/index.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.195 `frontend/src/components/utils-settings/OtpModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (2)
  - `frontend/src/components/users/UserProfileModal.jsx`
  - `frontend/src/components/utils-settings/Settings.jsx`

### 3.196 `frontend/src/components/utils-settings/ResetData.jsx`

- Declared exports: none detected
- Imports (4)
  - `../../AppContext`
  - `../../utils/appRefresh`
  - `lucide-react`
  - `react`
- Internal dependencies (2)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/utils/appRefresh.js`
- Referenced by (1)
  - `frontend/src/components/utils-settings/Backup.jsx`

### 3.197 `frontend/src/components/utils-settings/Settings.jsx`

- Declared exports: `function`
- Imports (9)
  - `../../AppContext`
  - `../../utils/favicon`
  - `../../utils/loaders.mjs`
  - `../shared/PageHeader`
  - `../shared/navigationConfig`
  - `./FontFamilyPicker`
  - `./OtpModal`
  - `lucide-react`
  - `react`
- Internal dependencies (7)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/PageHeader.jsx`
  - `frontend/src/components/shared/navigationConfig.js`
  - `frontend/src/components/utils-settings/FontFamilyPicker.jsx`
  - `frontend/src/components/utils-settings/OtpModal.jsx`
  - `frontend/src/utils/favicon.js`
  - `frontend/src/utils/loaders.mjs`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.198 `frontend/src/constants.js`

- Declared exports: `CURRENCY`, `DELIVERY_FEE_PAYER`, `EMPTY_CUSTOMER`, `LAYOUT`, `PAYMENT_METHODS`, `STOCK`, `STORAGE_KEYS`, `SYNC`, `WRITE_CHANNELS`, `createEmptyOrder`, `formatDate`, `isNetworkError`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (8)
  - `frontend/src/api/http.js`
  - `frontend/src/api/methods.js`
  - `frontend/src/api/websocket.js`
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/auth/Login.jsx`
  - `frontend/src/components/users/UserProfileModal.jsx`
  - `frontend/src/platform/runtime/clientRuntime.js`
  - `frontend/src/web-api.js`

### 3.199 `frontend/src/index.jsx`

- Declared exports: none detected
- Imports (5)
  - `./App`
  - `./AppContext`
  - `./styles/main.css`
  - `react`
  - `react-dom/client`
- Internal dependencies (3)
  - `frontend/src/App.jsx`
  - `frontend/src/AppContext.jsx`
  - `frontend/src/styles/main.css`
- Referenced by (0)
  - none

### 3.200 `frontend/src/platform/runtime/clientRuntime.js`

- Declared exports: `buildQueuedOperationScope`, `doesQueuedScopeMatchCurrent`, `normalizeRuntimeDescriptor`, `readStoredRuntimeDescriptor`, `resetClientRuntimeState`, `sanitizeSyncServerUrl`, `shouldResetForRuntimeChange`, `writeStoredRuntimeDescriptor`
- Imports (2)
  - `../../api/localDb.js`
  - `../../constants.js`
- Internal dependencies (2)
  - `frontend/src/api/localDb.js`
  - `frontend/src/constants.js`
- Referenced by (3)
  - `frontend/src/api/methods.js`
  - `frontend/src/AppContext.jsx`
  - `frontend/src/web-api.js`

### 3.201 `frontend/src/platform/storage/storagePolicy.mjs`

- Declared exports: `DRIVE_SYNC_STATUS_COOLDOWN_KEY`, `DRIVE_SYNC_STATUS_COOLDOWN_MS`, `LIVE_SERVER_SENSITIVE_MIRROR_TABLES`, `NOTIFICATION_SUMMARY_MISSING_TTL_MS`, `NOTIFICATION_SUMMARY_MISSING_UNTIL_KEY`, `isCooldownActive`, `maxStoredNumber`, `shouldPersistLocalMirror`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.202 `frontend/src/utils/actionHistory.mjs`

- Declared exports: `useActionHistory`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (12)
  - `frontend/src/components/branches/Branches.jsx`
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`
  - `frontend/src/components/custom-tables/CustomTables.jsx`
  - `frontend/src/components/files/FilesPage.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/sales/Sales.jsx`
  - `frontend/src/components/users/UserProfileModal.jsx`
  - `frontend/src/components/users/Users.jsx`
  - `frontend/src/components/utils-settings/Backup.jsx`

### 3.203 `frontend/src/utils/appRefresh.js`

- Declared exports: `refreshAppData`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/utils-settings/Backup.jsx`
  - `frontend/src/components/utils-settings/ResetData.jsx`

### 3.204 `frontend/src/utils/color.js`

- Declared exports: `getContrastingTextColor`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/products/ProductDetailModal.jsx`
  - `frontend/src/components/products/Products.jsx`

### 3.205 `frontend/src/utils/csv.js`

- Declared exports: `buildCSV`, `buildZip`, `downloadBlob`, `downloadCSV`, `downloadZipFiles`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (12)
  - `frontend/src/components/contacts/Contacts.jsx`
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`
  - `frontend/src/components/dashboard/Dashboard.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/returns/Returns.jsx`
  - `frontend/src/components/sales/Sales.jsx`
  - `frontend/src/components/utils-settings/AuditLog.jsx`
  - `frontend/src/utils/exportPackage.js`
  - `frontend/tests/exportPackages.test.mjs`

### 3.206 `frontend/src/utils/csvImport.js`

- Declared exports: `detectCsvDelimiter`, `normalizeCsvKey`, `normalizeCsvMoney`, `normalizeCsvPercent`, `normalizeNumericText`, `parseCsvNumber`, `parseCsvRows`, `parseDelimitedRows`, `parseRequiredCsvNumber`, `splitCsvLine`
- Imports (1)
  - `./pricing.js`
- Internal dependencies (1)
  - `frontend/src/utils/pricing.js`
- Referenced by (4)
  - `frontend/src/components/contacts/shared.jsx`
  - `frontend/src/components/inventory/InventoryImportModal.jsx`
  - `frontend/src/components/sales/SalesImportModal.jsx`
  - `frontend/tests/csvImport.test.mjs`

### 3.207 `frontend/src/utils/dateHelpers.js`

- Declared exports: `offsetDate`, `todayStr`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/dashboard/Dashboard.jsx`

### 3.208 `frontend/src/utils/deviceInfo.js`

- Declared exports: `getClientDeviceInfo`, `getClientMetaHeaders`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (6)
  - `frontend/src/api/http.js`
  - `frontend/src/api/methods.js`
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/auth/Login.jsx`
  - `frontend/src/components/pos/POS.jsx`
  - `frontend/src/components/sales/Sales.jsx`

### 3.209 `frontend/src/utils/exportPackage.js`

- Declared exports: `buildReportManifestRows`, `buildReportPackageFiles`
- Imports (1)
  - `./csv.js`
- Internal dependencies (1)
  - `frontend/src/utils/csv.js`
- Referenced by (3)
  - `frontend/src/components/dashboard/Dashboard.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/tests/exportPackages.test.mjs`

### 3.210 `frontend/src/utils/exportReports.jsx`

- Declared exports: `buildStandaloneReportHtml`
- Imports (3)
  - `../components/dashboard/charts`
  - `./formatters`
  - `react-dom/server`
- Internal dependencies (2)
  - `frontend/src/components/dashboard/charts/index.js`
  - `frontend/src/utils/formatters.js`
- Referenced by (2)
  - `frontend/src/components/dashboard/Dashboard.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`

### 3.211 `frontend/src/utils/favicon.js`

- Declared exports: `createCircularFaviconDataUrl`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `frontend/src/App.jsx`
  - `frontend/src/components/catalog/CatalogPage.jsx`
  - `frontend/src/components/utils-settings/Settings.jsx`

### 3.212 `frontend/src/utils/formatters.js`

- Declared exports: `fmtCount`, `fmtDate`, `fmtShort`, `fmtTime`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (16)
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`
  - `frontend/src/components/dashboard/charts/BarChart.jsx`
  - `frontend/src/components/dashboard/charts/DonutChart.jsx`
  - `frontend/src/components/dashboard/charts/LineChart.jsx`
  - `frontend/src/components/dashboard/Dashboard.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/returns/NewReturnModal.jsx`
  - `frontend/src/components/returns/ReturnDetailModal.jsx`
  - `frontend/src/components/returns/Returns.jsx`
  - `frontend/src/components/sales/SaleDetailModal.jsx`
  - `frontend/src/components/sales/Sales.jsx`
  - `frontend/src/components/users/UserDetailSheet.jsx`
  - `frontend/src/components/users/Users.jsx`
  - `frontend/src/utils/exportReports.jsx`

### 3.213 `frontend/src/utils/groupedRecords.mjs`

- Declared exports: `buildAlphabetActionSections`, `buildTimeActionSections`, `getAlphabetInitialSection`, `getAvailableYears`, `getTimeGroupingMode`, `getTimeParts`, `matchesYearMonthFilters`, `toggleIdSet`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (9)
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/returns/Returns.jsx`
  - `frontend/src/components/sales/Sales.jsx`
  - `frontend/src/components/utils-settings/AuditLog.jsx`
  - `frontend/tests/groupedRecords.test.mjs`

### 3.214 `frontend/src/utils/historyHelpers.mjs`

- Declared exports: `cloneHistorySnapshot`, `extractHistoryResultId`, `resolveCreatedHistorySnapshot`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (10)
  - `frontend/src/components/branches/Branches.jsx`
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`
  - `frontend/src/components/custom-tables/CustomTables.jsx`
  - `frontend/src/components/files/FilesPage.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/products/VariantFormModal.jsx`
  - `frontend/src/components/users/Users.jsx`

### 3.215 `frontend/src/utils/index.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.216 `frontend/src/utils/loaders.mjs`

- Declared exports: `beginTrackedRequest`, `createLoaderTimeoutError`, `getFirstLoaderError`, `getLoaderErrorMessage`, `invalidateTrackedRequest`, `isTrackedRequestCurrent`, `settleLoaderMap`, `withLoaderTimeout`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (10)
  - `frontend/src/App.jsx`
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/contacts/Contacts.jsx`
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`
  - `frontend/src/components/dashboard/Dashboard.jsx`
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`
  - `frontend/src/components/users/UserProfileModal.jsx`
  - `frontend/src/components/utils-settings/Settings.jsx`

### 3.217 `frontend/src/utils/pricing.js`

- Declared exports: `calculateProductDiscount`, `formatPriceNumber`, `isProductDiscountActive`, `normalizeDiscountPercent`, `normalizeDiscountType`, `normalizePriceValue`, `roundUpToDecimals`, `toFiniteNumber`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (14)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/catalog/portalCatalogDisplay.mjs`
  - `frontend/src/components/dashboard/Dashboard.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/inventory/ProductDetailModal.jsx`
  - `frontend/src/components/pos/CartItem.jsx`
  - `frontend/src/components/pos/POS.jsx`
  - `frontend/src/components/pos/posCore.mjs`
  - `frontend/src/components/products/ProductDetailModal.jsx`
  - `frontend/src/components/products/ProductForm.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/products/VariantFormModal.jsx`
  - `frontend/src/utils/csvImport.js`
  - `frontend/tests/pricingContacts.test.mjs`

### 3.218 `frontend/src/utils/printReceipt.js`

- Declared exports: `PRINT_DEFAULTS`, `createReceiptPdfBlob`, `downloadReceiptPdf`, `getPaperWidthMm`, `getPrintSettings`, `openPrintableReceiptPreview`, `openReceiptPdf`, `printReceipt`, `savePrintSettings`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/receipt-settings/PrintSettings.jsx`
  - `frontend/src/components/receipt/Receipt.jsx`

### 3.219 `frontend/src/utils/productGrouping.mjs`

- Declared exports: `buildProductGroupSections`, `buildProductGroups`, `getNameInitialSection`, `normalizeProductGroupName`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `frontend/src/components/pos/posCore.mjs`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/tests/productGrouping.test.mjs`

### 3.220 `frontend/src/web-api.js`

- Declared exports: none detected
- Imports (6)
  - `./api/http.js`
  - `./api/localDb.js`
  - `./api/methods.js`
  - `./api/websocket.js`
  - `./constants.js`
  - `./platform/runtime/clientRuntime.js`
- Internal dependencies (6)
  - `frontend/src/api/http.js`
  - `frontend/src/api/localDb.js`
  - `frontend/src/api/methods.js`
  - `frontend/src/api/websocket.js`
  - `frontend/src/constants.js`
  - `frontend/src/platform/runtime/clientRuntime.js`
- Referenced by (1)
  - `frontend/src/AppContext.jsx`

### 3.221 `frontend/tailwind.config.mjs`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.222 `frontend/tests/apiHttp.test.mjs`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.223 `frontend/tests/appShellUtils.test.mjs`

- Declared exports: none detected
- Imports (2)
  - `../src/app/appShellUtils.mjs`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/app/appShellUtils.mjs`
- Referenced by (0)
  - none

### 3.224 `frontend/tests/barcodeImageScanner.test.mjs`

- Declared exports: none detected
- Imports (2)
  - `../src/components/products/barcodeImageScanner.mjs`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/products/barcodeImageScanner.mjs`
- Referenced by (0)
  - none

### 3.225 `frontend/tests/barcodeScannerState.test.mjs`

- Declared exports: none detected
- Imports (2)
  - `../src/components/products/barcodeScannerState.mjs`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/products/barcodeScannerState.mjs`
- Referenced by (0)
  - none

### 3.226 `frontend/tests/csvImport.test.mjs`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/csvImport.js`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/csvImport.js`
- Referenced by (0)
  - none

### 3.227 `frontend/tests/exportPackages.test.mjs`

- Declared exports: none detected
- Imports (3)
  - `../src/utils/csv.js`
  - `../src/utils/exportPackage.js`
  - `node:assert/strict`
- Internal dependencies (2)
  - `frontend/src/utils/csv.js`
  - `frontend/src/utils/exportPackage.js`
- Referenced by (0)
  - none

### 3.228 `frontend/tests/groupedRecords.test.mjs`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/groupedRecords.mjs`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/groupedRecords.mjs`
- Referenced by (0)
  - none

### 3.229 `frontend/tests/historyHelpers.test.mjs`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.230 `frontend/tests/loaders.test.mjs`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.231 `frontend/tests/portalCatalogDisplay.test.mjs`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.232 `frontend/tests/portalEditorUtils.test.mjs`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.233 `frontend/tests/posCore.test.mjs`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.234 `frontend/tests/pricingContacts.test.mjs`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/pricing.js`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/pricing.js`
- Referenced by (0)
  - none

### 3.235 `frontend/tests/productGrouping.test.mjs`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/productGrouping.mjs`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/productGrouping.mjs`
- Referenced by (0)
  - none

### 3.236 `frontend/tests/productHistoryHelpers.test.mjs`

- Declared exports: none detected
- Imports (2)
  - `../src/components/products/productHistoryHelpers.mjs`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/products/productHistoryHelpers.mjs`
- Referenced by (0)
  - none

### 3.237 `frontend/tests/productImportPlanner.test.mjs`

- Declared exports: none detected
- Imports (2)
  - `../src/components/products/productImportPlanner.mjs`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/products/productImportPlanner.mjs`
- Referenced by (0)
  - none

### 3.238 `frontend/tests/receiptTemplate.test.mjs`

- Declared exports: none detected
- Imports (3)
  - `../src/components/receipt-settings/constants.js`
  - `../src/components/receipt-settings/template.js`
  - `node:assert/strict`
- Internal dependencies (2)
  - `frontend/src/components/receipt-settings/constants.js`
  - `frontend/src/components/receipt-settings/template.js`
- Referenced by (0)
  - none

### 3.239 `frontend/tests/scanbotScanner.test.mjs`

- Declared exports: none detected
- Imports (2)
  - `../src/components/products/scanbotScanner.mjs`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/products/scanbotScanner.mjs`
- Referenced by (0)
  - none

### 3.240 `frontend/tests/storagePolicy.test.mjs`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.241 `frontend/vite.config.mjs`

- Declared exports: `defineConfig`
- Imports (2)
  - `@vitejs/plugin-react`
  - `vite`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.242 `ops/scripts/backend/verify-data-integrity.js`

- Declared exports: none detected
- Imports (4)
  - `../../../backend/src/config`
  - `../../../backend/src/database`
  - `../../../backend/src/helpers`
  - `path`
- Internal dependencies (3)
  - `backend/src/config/index.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
- Referenced by (0)
  - none

### 3.243 `ops/scripts/frontend/verify-i18n.js`

- Declared exports: none detected
- Imports (2)
  - `../lib/fs-utils`
  - `path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.js`
- Referenced by (0)
  - none

### 3.244 `ops/scripts/frontend/verify-performance.js`

- Declared exports: none detected
- Imports (3)
  - `child_process`
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.245 `ops/scripts/frontend/verify-ui.js`

- Declared exports: none detected
- Imports (2)
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.246 `ops/scripts/generate-doc-reference.js`

- Declared exports: none detected
- Imports (3)
  - `./lib/fs-utils`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.js`
- Referenced by (0)
  - none

### 3.247 `ops/scripts/generate-full-project-docs.js`

- Declared exports: `push`
- Imports (3)
  - `./lib/fs-utils`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.js`
- Referenced by (0)
  - none

### 3.248 `ops/scripts/lib/fs-utils.js`

- Declared exports: `module.exports`
- Imports (2)
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `ops/scripts/frontend/verify-i18n.js`
  - `ops/scripts/generate-doc-reference.js`
  - `ops/scripts/generate-full-project-docs.js`
  - `ops/scripts/performance-scan.js`

### 3.249 `ops/scripts/performance-scan.js`

- Declared exports: none detected
- Imports (3)
  - `./lib/fs-utils`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.js`
- Referenced by (0)
  - none

### 3.250 `ops/scripts/runtime/check-public-url.mjs`

- Declared exports: none detected
- Imports (2)
  - `node:https`
  - `node:net`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.251 `ops/scripts/verify-runtime-deps.js`

- Declared exports: none detected
- Imports (2)
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.252 `ops/scripts/verify-scale-services.js`

- Declared exports: none detected
- Imports (3)
  - `child_process`
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

