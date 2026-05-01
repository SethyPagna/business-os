# All File Inventory (Project First-Party Files)

Auto-generated file-level commentary for all first-party project files (frontend, backend, scripts, and root run/config files; excluding dependencies/build artifacts).

## 1. Coverage Summary

Total files documented: **298**

## 2. File Commentary Matrix

| No. | File | Category | Lines | Size (KB) | Purpose |
|---:|---|---|---:|---:|---|
| 1 | `.npmrc` | project-root | 14 | 0.4 | Project source/support file |
| 2 | `backend/.env` | backend-root | 41 | 1.9 | Project source/support file |
| 3 | `backend/.npmrc` | backend-root | 14 | 0.4 | Project source/support file |
| 4 | `backend/package-lock.json` | backend-root | 4472 | 165.3 | Configuration/data manifest |
| 5 | `backend/package.json` | backend-root | 57 | 2.3 | Configuration/data manifest |
| 6 | `backend/server.js` | backend-root | 268 | 9.1 | Backend server entrypoint |
| 7 | `backend/src/accessControl.js` | backend-core | 148 | 4.4 | Project source/support file |
| 8 | `backend/src/authOtpGuards.js` | backend-core | 31 | 0.9 | Project source/support file |
| 9 | `backend/src/backupSchema.js` | backend-core | 109 | 2.2 | Project source/support file |
| 10 | `backend/src/config/index.js` | backend-core | 439 | 15.8 | Project source/support file |
| 11 | `backend/src/conflictControl.js` | backend-core | 64 | 1.8 | Project source/support file |
| 12 | `backend/src/contactOptions.js` | backend-core | 118 | 4.1 | Project source/support file |
| 13 | `backend/src/database.js` | backend-core | 1447 | 53.6 | Schema/migrations and DB bootstrap |
| 14 | `backend/src/dataPath/index.js` | backend-core | 199 | 5.7 | Project source/support file |
| 15 | `backend/src/fileAssets.js` | backend-core | 536 | 19.0 | Project source/support file |
| 16 | `backend/src/helpers.js` | backend-core | 498 | 17.6 | Project source/support file |
| 17 | `backend/src/idempotency.js` | backend-core | 13 | 0.3 | Project source/support file |
| 18 | `backend/src/importCsv.js` | backend-core | 131 | 3.5 | Project source/support file |
| 19 | `backend/src/importParsing.js` | backend-core | 89 | 3.2 | Project source/support file |
| 20 | `backend/src/middleware.js` | backend-core | 361 | 12.0 | Project source/support file |
| 21 | `backend/src/money.js` | backend-core | 26 | 0.6 | Project source/support file |
| 22 | `backend/src/netSecurity.js` | backend-core | 115 | 3.1 | Project source/support file |
| 23 | `backend/src/organizationContext/index.js` | backend-core | 266 | 8.0 | Project source/support file |
| 24 | `backend/src/portalUtils.js` | backend-core | 87 | 2.3 | Project source/support file |
| 25 | `backend/src/productDiscounts.js` | backend-core | 129 | 5.1 | Project source/support file |
| 26 | `backend/src/productImportPolicies.js` | backend-core | 100 | 3.6 | Project source/support file |
| 27 | `backend/src/README.md` | backend-core | 47 | 2.0 | Documentation |
| 28 | `backend/src/requestContext.js` | backend-core | 59 | 1.2 | Project source/support file |
| 29 | `backend/src/routes/actionHistory.js` | backend-routes | 150 | 4.8 | API route handler |
| 30 | `backend/src/routes/ai.js` | backend-routes | 252 | 8.7 | API route handler |
| 31 | `backend/src/routes/auth.js` | backend-routes | 1119 | 40.0 | API route handler |
| 32 | `backend/src/routes/branches.js` | backend-routes | 233 | 10.4 | API route handler |
| 33 | `backend/src/routes/catalog.js` | backend-routes | 85 | 2.4 | API route handler |
| 34 | `backend/src/routes/categories.js` | backend-routes | 137 | 5.2 | API route handler |
| 35 | `backend/src/routes/contacts.js` | backend-routes | 749 | 31.2 | API route handler |
| 36 | `backend/src/routes/customTables.js` | backend-routes | 221 | 8.7 | API route handler |
| 37 | `backend/src/routes/files.js` | backend-routes | 95 | 3.6 | API route handler |
| 38 | `backend/src/routes/importJobs.js` | backend-routes | 229 | 7.6 | API route handler |
| 39 | `backend/src/routes/inventory.js` | backend-routes | 557 | 27.7 | API route handler |
| 40 | `backend/src/routes/notifications.js` | backend-routes | 423 | 14.0 | API route handler |
| 41 | `backend/src/routes/organizations.js` | backend-routes | 63 | 1.8 | API route handler |
| 42 | `backend/src/routes/portal.js` | backend-routes | 975 | 37.2 | API route handler |
| 43 | `backend/src/routes/products.js` | backend-routes | 1306 | 63.7 | API route handler |
| 44 | `backend/src/routes/README.md` | backend-routes | 37 | 1.5 | API route handler |
| 45 | `backend/src/routes/returns.js` | backend-routes | 759 | 29.7 | API route handler |
| 46 | `backend/src/routes/sales.js` | backend-routes | 1329 | 56.4 | API route handler |
| 47 | `backend/src/routes/settings.js` | backend-routes | 122 | 3.9 | API route handler |
| 48 | `backend/src/routes/system/index.js` | backend-routes | 1501 | 60.2 | API route handler |
| 49 | `backend/src/routes/units.js` | backend-routes | 141 | 5.3 | API route handler |
| 50 | `backend/src/routes/users.js` | backend-routes | 1060 | 44.0 | API route handler |
| 51 | `backend/src/runtimeState/index.js` | backend-core | 74 | 2.2 | Project source/support file |
| 52 | `backend/src/security.js` | backend-core | 207 | 6.0 | Project source/support file |
| 53 | `backend/src/serverUtils.js` | backend-core | 326 | 11.5 | Project source/support file |
| 54 | `backend/src/services/aiGateway.js` | backend-services | 326 | 12.2 | Integration/service layer |
| 55 | `backend/src/services/firebaseAuth.js` | backend-services | 384 | 14.3 | Integration/service layer |
| 56 | `backend/src/services/googleDriveSync/index.js` | backend-services | 917 | 31.6 | Integration/service layer |
| 57 | `backend/src/services/importJobs.js` | backend-services | 1256 | 50.9 | Integration/service layer |
| 58 | `backend/src/services/portalAi.js` | backend-services | 511 | 18.9 | Integration/service layer |
| 59 | `backend/src/services/README.md` | backend-services | 29 | 1.1 | Integration/service layer |
| 60 | `backend/src/services/supabaseAuth.js` | backend-services | 551 | 20.6 | Integration/service layer |
| 61 | `backend/src/services/verification.js` | backend-services | 272 | 8.1 | Integration/service layer |
| 62 | `backend/src/sessionAuth.js` | backend-core | 187 | 6.2 | Project source/support file |
| 63 | `backend/src/settingsSnapshot.js` | backend-core | 73 | 2.0 | Project source/support file |
| 64 | `backend/src/storage/organizationFolders.js` | backend-core | 56 | 1.7 | Project source/support file |
| 65 | `backend/src/systemFsWorker.js` | backend-core | 95 | 3.0 | Project source/support file |
| 66 | `backend/src/uploadReferenceCleanup.js` | backend-core | 128 | 4.0 | Project source/support file |
| 67 | `backend/src/uploadSecurity.js` | backend-core | 87 | 3.5 | Project source/support file |
| 68 | `backend/src/websocket.js` | backend-core | 94 | 3.6 | Project source/support file |
| 69 | `backend/test/accessControl.test.js` | backend-root | 103 | 3.0 | Project source/support file |
| 70 | `backend/test/authOtpGuards.test.js` | backend-root | 71 | 1.6 | Project source/support file |
| 71 | `backend/test/authSecurityFlow.test.js` | backend-root | 198 | 6.0 | Project source/support file |
| 72 | `backend/test/backupRoundtrip.test.js` | backend-root | 323 | 10.8 | Project source/support file |
| 73 | `backend/test/backupSchema.test.js` | backend-root | 67 | 1.9 | Project source/support file |
| 74 | `backend/test/configOrganizationRuntime.test.js` | backend-root | 142 | 4.8 | Project source/support file |
| 75 | `backend/test/contactOptions.test.js` | backend-root | 82 | 2.3 | Project source/support file |
| 76 | `backend/test/dataPath.test.js` | backend-root | 87 | 2.9 | Project source/support file |
| 77 | `backend/test/fileRouteSecurityFlow.test.js` | backend-root | 215 | 7.0 | Project source/support file |
| 78 | `backend/test/idempotency.test.js` | backend-root | 32 | 0.7 | Project source/support file |
| 79 | `backend/test/importCsv.test.js` | backend-root | 50 | 1.6 | Project source/support file |
| 80 | `backend/test/netSecurity.test.js` | backend-root | 45 | 1.5 | Project source/support file |
| 81 | `backend/test/portalUtils.test.js` | backend-root | 40 | 1.2 | Project source/support file |
| 82 | `backend/test/productImportPolicies.test.js` | backend-root | 72 | 2.9 | Project source/support file |
| 83 | `backend/test/serverUtils.test.js` | backend-root | 177 | 6.2 | Project source/support file |
| 84 | `backend/test/stockConsistency.test.js` | backend-root | 1766 | 64.6 | Project source/support file |
| 85 | `backend/test/systemRouteSecurity.test.js` | backend-root | 288 | 9.6 | Project source/support file |
| 86 | `backend/test/uploadSecurity.test.js` | backend-root | 59 | 2.0 | Project source/support file |
| 87 | `build-release.bat` | project-root | 4 | 0.1 | Release build orchestration script |
| 88 | `clean-generated.bat` | project-root | 4 | 0.1 | Project source/support file |
| 89 | `frontend/.npmrc` | frontend-root | 14 | 0.4 | Project source/support file |
| 90 | `frontend/index.html` | frontend-root | 23 | 1.0 | Project source/support file |
| 91 | `frontend/package-lock.json` | frontend-root | 3778 | 129.6 | Configuration/data manifest |
| 92 | `frontend/package.json` | frontend-root | 36 | 1.7 | Configuration/data manifest |
| 93 | `frontend/postcss.config.mjs` | frontend-root | 7 | 0.1 | Project source/support file |
| 94 | `frontend/public/icon.png` | frontend-root | 0 | 11.4 | Project source/support file |
| 95 | `frontend/public/manifest.json` | frontend-root | 17 | 0.3 | Configuration/data manifest |
| 96 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.js` | frontend-root | 1 | 94.8 | Project source/support file |
| 97 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.wasm` | frontend-root | 0 | 8726.7 | Project source/support file |
| 98 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.worker.js` | frontend-root | 1 | 1.9 | Project source/support file |
| 99 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd.wasm` | frontend-root | 0 | 8782.2 | Project source/support file |
| 100 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm.wasm` | frontend-root | 0 | 8192.9 | Project source/support file |
| 101 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd-threads.js` | frontend-root | 1 | 146.4 | Project source/support file |
| 102 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd.js` | frontend-root | 1 | 135.5 | Project source/support file |
| 103 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core.js` | frontend-root | 1 | 135.5 | Project source/support file |
| 104 | `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js` | frontend-root | 187 | 1007.0 | Project source/support file |
| 105 | `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js.LICENSE.txt` | frontend-root | 24 | 0.5 | Project source/support file |
| 106 | `frontend/public/sw.js` | frontend-root | 79 | 2.0 | Project source/support file |
| 107 | `frontend/public/theme-bootstrap.js` | frontend-root | 165 | 5.7 | Project source/support file |
| 108 | `frontend/src/api/http.js` | frontend-api | 778 | 27.2 | Frontend API/sync helper |
| 109 | `frontend/src/api/localDb.js` | frontend-api | 250 | 8.7 | Frontend API/sync helper |
| 110 | `frontend/src/api/methods.js` | frontend-api | 1395 | 67.0 | Frontend API/sync helper |
| 111 | `frontend/src/api/README.md` | frontend-api | 26 | 0.8 | Frontend API/sync helper |
| 112 | `frontend/src/api/websocket.js` | frontend-api | 160 | 5.4 | Frontend API/sync helper |
| 113 | `frontend/src/App.jsx` | frontend-core | 786 | 26.7 | Main app shell and page mounting |
| 114 | `frontend/src/app/appShellUtils.mjs` | frontend-core | 43 | 1.5 | Project source/support file |
| 115 | `frontend/src/AppContext.jsx` | frontend-core | 1373 | 56.1 | Global app state/context provider |
| 116 | `frontend/src/components/auth/Login.jsx` | frontend-ui | 1028 | 47.0 | UI component/page |
| 117 | `frontend/src/components/branches/Branches.jsx` | frontend-ui | 684 | 30.7 | UI component/page |
| 118 | `frontend/src/components/branches/BranchForm.jsx` | frontend-ui | 190 | 6.4 | UI component/page |
| 119 | `frontend/src/components/branches/TransferModal.jsx` | frontend-ui | 325 | 12.9 | UI component/page |
| 120 | `frontend/src/components/catalog/CatalogPage.jsx` | frontend-ui | 4193 | 234.8 | UI component/page |
| 121 | `frontend/src/components/catalog/CatalogProductsSection.jsx` | frontend-ui | 290 | 15.6 | UI component/page |
| 122 | `frontend/src/components/catalog/CatalogSecondaryTabs.jsx` | frontend-ui | 684 | 42.2 | UI component/page |
| 123 | `frontend/src/components/catalog/catalogUi.jsx` | frontend-ui | 63 | 2.5 | UI component/page |
| 124 | `frontend/src/components/catalog/portalCatalogDisplay.mjs` | frontend-ui | 135 | 4.6 | UI component/page |
| 125 | `frontend/src/components/catalog/portalEditorUtils.mjs` | frontend-ui | 99 | 2.8 | UI component/page |
| 126 | `frontend/src/components/contacts/contactOptionUtils.js` | frontend-ui | 99 | 3.4 | UI component/page |
| 127 | `frontend/src/components/contacts/Contacts.jsx` | frontend-ui | 230 | 8.7 | UI component/page |
| 128 | `frontend/src/components/contacts/CustomersTab.jsx` | frontend-ui | 852 | 41.9 | UI component/page |
| 129 | `frontend/src/components/contacts/DeliveryTab.jsx` | frontend-ui | 769 | 38.6 | UI component/page |
| 130 | `frontend/src/components/contacts/shared.jsx` | frontend-ui | 657 | 26.4 | UI component/page |
| 131 | `frontend/src/components/contacts/SuppliersTab.jsx` | frontend-ui | 774 | 38.7 | UI component/page |
| 132 | `frontend/src/components/custom-tables/CustomTables.jsx` | frontend-ui | 525 | 23.2 | UI component/page |
| 133 | `frontend/src/components/dashboard/charts/BarChart.jsx` | frontend-ui | 99 | 4.3 | UI component/page |
| 134 | `frontend/src/components/dashboard/charts/DonutChart.jsx` | frontend-ui | 83 | 3.8 | UI component/page |
| 135 | `frontend/src/components/dashboard/charts/index.js` | frontend-ui | 6 | 0.4 | UI component/page |
| 136 | `frontend/src/components/dashboard/charts/LineChart.jsx` | frontend-ui | 124 | 5.4 | UI component/page |
| 137 | `frontend/src/components/dashboard/charts/NoData.jsx` | frontend-ui | 15 | 0.6 | UI component/page |
| 138 | `frontend/src/components/dashboard/Dashboard.jsx` | frontend-ui | 1341 | 67.6 | UI component/page |
| 139 | `frontend/src/components/dashboard/MiniStat.jsx` | frontend-ui | 25 | 1.1 | UI component/page |
| 140 | `frontend/src/components/files/FilePickerModal.jsx` | frontend-ui | 232 | 9.5 | UI component/page |
| 141 | `frontend/src/components/files/FilesPage.jsx` | frontend-ui | 886 | 52.8 | UI component/page |
| 142 | `frontend/src/components/inventory/DualMoney.jsx` | frontend-ui | 14 | 0.6 | UI component/page |
| 143 | `frontend/src/components/inventory/Inventory.jsx` | frontend-ui | 2422 | 136.9 | UI component/page |
| 144 | `frontend/src/components/inventory/InventoryImportModal.jsx` | frontend-ui | 227 | 10.5 | UI component/page |
| 145 | `frontend/src/components/inventory/movementGroups.js` | frontend-ui | 111 | 4.7 | UI component/page |
| 146 | `frontend/src/components/inventory/ProductDetailModal.jsx` | frontend-ui | 133 | 8.6 | UI component/page |
| 147 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | frontend-ui | 580 | 33.4 | UI component/page |
| 148 | `frontend/src/components/navigation/Sidebar.jsx` | frontend-ui | 317 | 14.1 | UI component/page |
| 149 | `frontend/src/components/pos/CartItem.jsx` | frontend-ui | 105 | 4.9 | UI component/page |
| 150 | `frontend/src/components/pos/FilterPanel.jsx` | frontend-ui | 237 | 8.2 | UI component/page |
| 151 | `frontend/src/components/pos/POS.jsx` | frontend-ui | 1747 | 102.7 | UI component/page |
| 152 | `frontend/src/components/pos/posCore.mjs` | frontend-ui | 97 | 4.0 | UI component/page |
| 153 | `frontend/src/components/pos/ProductImage.jsx` | frontend-ui | 6 | 0.2 | UI component/page |
| 154 | `frontend/src/components/pos/QuickAddModal.jsx` | frontend-ui | 38 | 1.6 | UI component/page |
| 155 | `frontend/src/components/products/barcodeImageScanner.mjs` | frontend-ui | 43 | 1.5 | UI component/page |
| 156 | `frontend/src/components/products/BarcodeScannerModal.jsx` | frontend-ui | 581 | 27.7 | UI component/page |
| 157 | `frontend/src/components/products/barcodeScannerState.mjs` | frontend-ui | 52 | 1.5 | UI component/page |
| 158 | `frontend/src/components/products/BranchStockAdjuster.jsx` | frontend-ui | 107 | 4.2 | UI component/page |
| 159 | `frontend/src/components/products/BulkAddStockModal.jsx` | frontend-ui | 73 | 3.4 | UI component/page |
| 160 | `frontend/src/components/products/BulkImportModal.jsx` | frontend-ui | 819 | 39.8 | UI component/page |
| 161 | `frontend/src/components/products/HeaderActions.jsx` | frontend-ui | 127 | 4.6 | UI component/page |
| 162 | `frontend/src/components/products/ManageBrandsModal.jsx` | frontend-ui | 274 | 8.8 | UI component/page |
| 163 | `frontend/src/components/products/ManageCategoriesModal.jsx` | frontend-ui | 191 | 7.4 | UI component/page |
| 164 | `frontend/src/components/products/ManageUnitsModal.jsx` | frontend-ui | 170 | 6.6 | UI component/page |
| 165 | `frontend/src/components/products/primitives.jsx` | frontend-ui | 175 | 6.3 | UI component/page |
| 166 | `frontend/src/components/products/ProductDetailModal.jsx` | frontend-ui | 184 | 8.9 | UI component/page |
| 167 | `frontend/src/components/products/ProductForm.jsx` | frontend-ui | 893 | 43.8 | UI component/page |
| 168 | `frontend/src/components/products/productHistoryHelpers.mjs` | frontend-ui | 38 | 1.1 | UI component/page |
| 169 | `frontend/src/components/products/productImportPlanner.mjs` | frontend-ui | 307 | 11.4 | UI component/page |
| 170 | `frontend/src/components/products/productImportWorker.mjs` | frontend-ui | 22 | 0.9 | UI component/page |
| 171 | `frontend/src/components/products/Products.jsx` | frontend-ui | 2021 | 103.2 | UI component/page |
| 172 | `frontend/src/components/products/scanbotScanner.mjs` | frontend-ui | 137 | 4.5 | UI component/page |
| 173 | `frontend/src/components/products/VariantFormModal.jsx` | frontend-ui | 263 | 12.6 | UI component/page |
| 174 | `frontend/src/components/README.md` | frontend-ui | 37 | 1.9 | UI component/page |
| 175 | `frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | frontend-ui | 99 | 4.0 | UI component/page |
| 176 | `frontend/src/components/receipt-settings/constants.js` | frontend-ui | 99 | 6.3 | UI component/page |
| 177 | `frontend/src/components/receipt-settings/ErrorBoundary.jsx` | frontend-ui | 28 | 0.9 | UI component/page |
| 178 | `frontend/src/components/receipt-settings/FieldOrderManager.jsx` | frontend-ui | 190 | 9.4 | UI component/page |
| 179 | `frontend/src/components/receipt-settings/PrintSettings.jsx` | frontend-ui | 212 | 9.9 | UI component/page |
| 180 | `frontend/src/components/receipt-settings/ReceiptPreview.jsx` | frontend-ui | 97 | 3.3 | UI component/page |
| 181 | `frontend/src/components/receipt-settings/ReceiptSettings.jsx` | frontend-ui | 404 | 24.1 | UI component/page |
| 182 | `frontend/src/components/receipt-settings/template.js` | frontend-ui | 17 | 0.4 | UI component/page |
| 183 | `frontend/src/components/receipt/Receipt.jsx` | frontend-ui | 450 | 21.6 | UI component/page |
| 184 | `frontend/src/components/returns/EditReturnModal.jsx` | frontend-ui | 230 | 12.2 | UI component/page |
| 185 | `frontend/src/components/returns/NewReturnModal.jsx` | frontend-ui | 468 | 26.5 | UI component/page |
| 186 | `frontend/src/components/returns/NewSupplierReturnModal.jsx` | frontend-ui | 376 | 19.7 | UI component/page |
| 187 | `frontend/src/components/returns/ReturnDetailModal.jsx` | frontend-ui | 132 | 6.8 | UI component/page |
| 188 | `frontend/src/components/returns/Returns.jsx` | frontend-ui | 788 | 38.5 | UI component/page |
| 189 | `frontend/src/components/sales/ExportModal.jsx` | frontend-ui | 238 | 10.8 | UI component/page |
| 190 | `frontend/src/components/sales/SaleDetailModal.jsx` | frontend-ui | 332 | 15.7 | UI component/page |
| 191 | `frontend/src/components/sales/Sales.jsx` | frontend-ui | 912 | 45.3 | UI component/page |
| 192 | `frontend/src/components/sales/SalesImportModal.jsx` | frontend-ui | 283 | 13.2 | UI component/page |
| 193 | `frontend/src/components/sales/StatusBadge.jsx` | frontend-ui | 47 | 1.6 | UI component/page |
| 194 | `frontend/src/components/server/ServerPage.jsx` | frontend-ui | 701 | 34.7 | UI component/page |
| 195 | `frontend/src/components/shared/ActionHistoryBar.jsx` | frontend-ui | 121 | 6.4 | UI component/page |
| 196 | `frontend/src/components/shared/ExportMenu.jsx` | frontend-ui | 32 | 1.1 | UI component/page |
| 197 | `frontend/src/components/shared/FilterMenu.jsx` | frontend-ui | 105 | 4.4 | UI component/page |
| 198 | `frontend/src/components/shared/ImageGalleryLightbox.jsx` | frontend-ui | 119 | 4.9 | UI component/page |
| 199 | `frontend/src/components/shared/Modal.jsx` | frontend-ui | 34 | 1.7 | UI component/page |
| 200 | `frontend/src/components/shared/navigationConfig.js` | frontend-ui | 45 | 1.8 | UI component/page |
| 201 | `frontend/src/components/shared/NotificationCenter.jsx` | frontend-ui | 408 | 20.2 | UI component/page |
| 202 | `frontend/src/components/shared/pageActivity.js` | frontend-ui | 8 | 0.2 | UI component/page |
| 203 | `frontend/src/components/shared/PageHeader.jsx` | frontend-ui | 47 | 1.9 | UI component/page |
| 204 | `frontend/src/components/shared/PageHelpButton.jsx` | frontend-ui | 76 | 3.2 | UI component/page |
| 205 | `frontend/src/components/shared/pageHelpContent.js` | frontend-ui | 447 | 28.2 | UI component/page |
| 206 | `frontend/src/components/shared/PortalMenu.jsx` | frontend-ui | 201 | 7.0 | UI component/page |
| 207 | `frontend/src/components/shared/QuickPreferenceToggles.jsx` | frontend-ui | 56 | 2.0 | UI component/page |
| 208 | `frontend/src/components/shared/WriteConflictModal.jsx` | frontend-ui | 266 | 11.0 | UI component/page |
| 209 | `frontend/src/components/users/PermissionEditor.jsx` | frontend-ui | 88 | 3.5 | UI component/page |
| 210 | `frontend/src/components/users/UserDetailSheet.jsx` | frontend-ui | 103 | 5.0 | UI component/page |
| 211 | `frontend/src/components/users/UserProfileModal.jsx` | frontend-ui | 1112 | 60.3 | UI component/page |
| 212 | `frontend/src/components/users/Users.jsx` | frontend-ui | 914 | 43.6 | UI component/page |
| 213 | `frontend/src/components/utils-settings/AuditLog.jsx` | frontend-ui | 889 | 41.6 | UI component/page |
| 214 | `frontend/src/components/utils-settings/Backup.jsx` | frontend-ui | 1667 | 77.6 | UI component/page |
| 215 | `frontend/src/components/utils-settings/FontFamilyPicker.jsx` | frontend-ui | 59 | 2.9 | UI component/page |
| 216 | `frontend/src/components/utils-settings/index.js` | frontend-ui | 12 | 0.7 | UI component/page |
| 217 | `frontend/src/components/utils-settings/OtpModal.jsx` | frontend-ui | 249 | 9.7 | UI component/page |
| 218 | `frontend/src/components/utils-settings/ResetData.jsx` | frontend-ui | 280 | 12.6 | UI component/page |
| 219 | `frontend/src/components/utils-settings/Settings.jsx` | frontend-ui | 1342 | 59.9 | UI component/page |
| 220 | `frontend/src/constants.js` | frontend-core | 181 | 8.5 | Project source/support file |
| 221 | `frontend/src/index.jsx` | frontend-core | 226 | 7.3 | Project source/support file |
| 222 | `frontend/src/lang/en.json` | frontend-i18n | 2359 | 112.4 | Localization dictionary |
| 223 | `frontend/src/lang/km.json` | frontend-i18n | 2367 | 205.9 | Localization dictionary |
| 224 | `frontend/src/platform/runtime/clientRuntime.js` | frontend-core | 195 | 7.2 | Project source/support file |
| 225 | `frontend/src/platform/storage/storagePolicy.mjs` | frontend-core | 37 | 1.1 | Project source/support file |
| 226 | `frontend/src/README.md` | frontend-core | 38 | 1.3 | Documentation |
| 227 | `frontend/src/styles/main.css` | frontend-style | 605 | 25.0 | Project source/support file |
| 228 | `frontend/src/utils/actionHistory.mjs` | frontend-utils | 109 | 4.7 | Utility helper |
| 229 | `frontend/src/utils/appRefresh.js` | frontend-utils | 28 | 0.6 | Utility helper |
| 230 | `frontend/src/utils/color.js` | frontend-utils | 32 | 0.9 | Utility helper |
| 231 | `frontend/src/utils/csv.js` | frontend-utils | 166 | 5.4 | Utility helper |
| 232 | `frontend/src/utils/csvImport.js` | frontend-utils | 227 | 6.8 | Utility helper |
| 233 | `frontend/src/utils/dateHelpers.js` | frontend-utils | 25 | 1.0 | Utility helper |
| 234 | `frontend/src/utils/deviceInfo.js` | frontend-utils | 36 | 1.0 | Utility helper |
| 235 | `frontend/src/utils/exportPackage.js` | frontend-utils | 34 | 0.7 | Utility helper |
| 236 | `frontend/src/utils/exportReports.jsx` | frontend-utils | 366 | 9.6 | Utility helper |
| 237 | `frontend/src/utils/favicon.js` | frontend-utils | 61 | 1.8 | Utility helper |
| 238 | `frontend/src/utils/formatters.js` | frontend-utils | 55 | 1.8 | Utility helper |
| 239 | `frontend/src/utils/groupedRecords.mjs` | frontend-utils | 282 | 9.4 | Utility helper |
| 240 | `frontend/src/utils/historyHelpers.mjs` | frontend-utils | 41 | 1.2 | Utility helper |
| 241 | `frontend/src/utils/index.js` | frontend-utils | 10 | 0.5 | Utility helper |
| 242 | `frontend/src/utils/loaders.mjs` | frontend-utils | 84 | 2.5 | Utility helper |
| 243 | `frontend/src/utils/pricing.js` | frontend-utils | 85 | 3.4 | Utility helper |
| 244 | `frontend/src/utils/printReceipt.js` | frontend-utils | 829 | 27.5 | Utility helper |
| 245 | `frontend/src/utils/productGrouping.mjs` | frontend-utils | 264 | 9.6 | Utility helper |
| 246 | `frontend/src/web-api.js` | frontend-core | 235 | 8.5 | Project source/support file |
| 247 | `frontend/tailwind.config.mjs` | frontend-root | 17 | 0.4 | Project source/support file |
| 248 | `frontend/tests/apiHttp.test.mjs` | frontend-root | 108 | 3.2 | Project source/support file |
| 249 | `frontend/tests/appShellUtils.test.mjs` | frontend-root | 41 | 1.3 | Project source/support file |
| 250 | `frontend/tests/barcodeImageScanner.test.mjs` | frontend-root | 84 | 2.0 | Project source/support file |
| 251 | `frontend/tests/barcodeScannerState.test.mjs` | frontend-root | 62 | 2.4 | Project source/support file |
| 252 | `frontend/tests/csvImport.test.mjs` | frontend-root | 51 | 1.7 | Project source/support file |
| 253 | `frontend/tests/exportPackages.test.mjs` | frontend-root | 67 | 2.4 | Project source/support file |
| 254 | `frontend/tests/groupedRecords.test.mjs` | frontend-root | 68 | 2.2 | Project source/support file |
| 255 | `frontend/tests/historyHelpers.test.mjs` | frontend-root | 72 | 2.1 | Project source/support file |
| 256 | `frontend/tests/loaders.test.mjs` | frontend-root | 82 | 2.4 | Project source/support file |
| 257 | `frontend/tests/portalCatalogDisplay.test.mjs` | frontend-root | 103 | 3.1 | Project source/support file |
| 258 | `frontend/tests/portalEditorUtils.test.mjs` | frontend-root | 57 | 1.9 | Project source/support file |
| 259 | `frontend/tests/posCore.test.mjs` | frontend-root | 136 | 5.1 | Project source/support file |
| 260 | `frontend/tests/pricingContacts.test.mjs` | frontend-root | 94 | 3.0 | Project source/support file |
| 261 | `frontend/tests/productGrouping.test.mjs` | frontend-root | 111 | 4.8 | Project source/support file |
| 262 | `frontend/tests/productHistoryHelpers.test.mjs` | frontend-root | 44 | 1.3 | Project source/support file |
| 263 | `frontend/tests/productImportPlanner.test.mjs` | frontend-root | 81 | 3.1 | Project source/support file |
| 264 | `frontend/tests/receiptTemplate.test.mjs` | frontend-root | 41 | 1.2 | Project source/support file |
| 265 | `frontend/tests/scanbotScanner.test.mjs` | frontend-root | 111 | 2.9 | Project source/support file |
| 266 | `frontend/tests/storagePolicy.test.mjs` | frontend-root | 42 | 1.3 | Project source/support file |
| 267 | `frontend/vite.config.mjs` | frontend-root | 117 | 4.7 | Project source/support file |
| 268 | `ops/scripts/backend/verify-data-integrity.js` | project-scripts | 233 | 7.9 | Project source/support file |
| 269 | `ops/scripts/frontend/verify-i18n.js` | project-scripts | 145 | 4.3 | Project source/support file |
| 270 | `ops/scripts/frontend/verify-performance.js` | project-scripts | 100 | 4.4 | Project source/support file |
| 271 | `ops/scripts/frontend/verify-ui.js` | project-scripts | 250 | 8.5 | Project source/support file |
| 272 | `ops/scripts/generate-doc-reference.js` | project-scripts | 475 | 15.6 | Project source/support file |
| 273 | `ops/scripts/generate-full-project-docs.js` | project-scripts | 638 | 22.7 | Project source/support file |
| 274 | `ops/scripts/lib/fs-utils.js` | project-scripts | 122 | 2.8 | Project source/support file |
| 275 | `ops/scripts/performance-scan.js` | project-scripts | 135 | 4.1 | Project source/support file |
| 276 | `ops/scripts/powershell/clean-generated.ps1` | project-scripts | 193 | 5.2 | Project source/support file |
| 277 | `ops/scripts/powershell/runtime-bootstrap.ps1` | project-scripts | 315 | 10.3 | Project source/support file |
| 278 | `ops/scripts/runtime/check-public-url.mjs` | project-scripts | 224 | 7.4 | Project source/support file |
| 279 | `ops/scripts/sync-firebase-release-env.ps1` | project-scripts | 55 | 1.7 | Project source/support file |
| 280 | `ops/scripts/verify-runtime-deps.js` | project-scripts | 81 | 2.5 | Project source/support file |
| 281 | `ops/scripts/verify-scale-services.js` | project-scripts | 147 | 4.6 | Project source/support file |
| 282 | `package.json` | project-root | 22 | 0.6 | Configuration/data manifest |
| 283 | `README.md` | project-root | 42 | 2.2 | Project documentation entrypoint |
| 284 | `run/bat/build-release.bat` | project-scripts | 617 | 25.2 | Project source/support file |
| 285 | `run/bat/clean-generated.bat` | project-scripts | 59 | 1.6 | Project source/support file |
| 286 | `run/bat/scale-services.bat` | project-scripts | 21 | 0.6 | Project source/support file |
| 287 | `run/bat/setup.bat` | project-scripts | 307 | 13.8 | Project source/support file |
| 288 | `run/bat/start-server.bat` | project-scripts | 367 | 16.3 | Project source/support file |
| 289 | `run/bat/stop-server.bat` | project-scripts | 139 | 5.2 | Project source/support file |
| 290 | `run/bat/verify-local.bat` | project-scripts | 92 | 2.3 | Project source/support file |
| 291 | `run/sh/scale-services.sh` | project-scripts | 44 | 1.1 | Project source/support file |
| 292 | `run/sh/setup.sh` | project-scripts | 110 | 2.9 | Project source/support file |
| 293 | `run/sh/start-server.sh` | project-scripts | 140 | 5.0 | Project source/support file |
| 294 | `run/sh/stop-server.sh` | project-scripts | 62 | 1.6 | Project source/support file |
| 295 | `setup.bat` | project-root | 4 | 0.1 | Environment setup script |
| 296 | `start-server.bat` | project-root | 4 | 0.1 | Server lifecycle launcher script |
| 297 | `stop-server.bat` | project-root | 4 | 0.1 | Server lifecycle launcher script |
| 298 | `verify-local.bat` | project-root | 4 | 0.1 | Project source/support file |
