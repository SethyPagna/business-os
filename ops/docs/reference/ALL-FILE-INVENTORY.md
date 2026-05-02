# All File Inventory (Project First-Party Files)

Auto-generated file-level commentary for all first-party project files (frontend, backend, scripts, and root run/config files; excluding dependencies/build artifacts).

## 1. Coverage Summary

Total files documented: **329**

## 2. File Commentary Matrix

| No. | File | Category | Lines | Size (KB) | Purpose |
|---:|---|---|---:|---:|---|
| 1 | `.npmrc` | project-root | 14 | 0.4 | Project source/support file |
| 2 | `backend/.env` | backend-root | 80 | 3.2 | Project source/support file |
| 3 | `backend/.npmrc` | backend-root | 14 | 0.4 | Project source/support file |
| 4 | `backend/package-lock.json` | backend-root | 6073 | 219.5 | Configuration/data manifest |
| 5 | `backend/package.json` | backend-root | 62 | 2.6 | Configuration/data manifest |
| 6 | `backend/README.md` | backend-root | 13 | 0.6 | Documentation |
| 7 | `backend/server.js` | backend-root | 317 | 10.9 | Backend server entrypoint |
| 8 | `backend/src/accessControl.js` | backend-core | 158 | 4.8 | Project source/support file |
| 9 | `backend/src/authOtpGuards.js` | backend-core | 31 | 0.9 | Project source/support file |
| 10 | `backend/src/backupSchema.js` | backend-core | 111 | 2.3 | Project source/support file |
| 11 | `backend/src/config/index.js` | backend-core | 481 | 18.6 | Project source/support file |
| 12 | `backend/src/conflictControl.js` | backend-core | 64 | 1.8 | Project source/support file |
| 13 | `backend/src/contactOptions.js` | backend-core | 118 | 4.1 | Project source/support file |
| 14 | `backend/src/database.js` | backend-core | 1594 | 57.2 | Schema/migrations and DB bootstrap |
| 15 | `backend/src/dataPath/index.js` | backend-core | 199 | 5.7 | Project source/support file |
| 16 | `backend/src/fileAssets.js` | backend-core | 537 | 19.0 | Project source/support file |
| 17 | `backend/src/helpers.js` | backend-core | 502 | 17.7 | Project source/support file |
| 18 | `backend/src/idempotency.js` | backend-core | 13 | 0.3 | Project source/support file |
| 19 | `backend/src/importCsv.js` | backend-core | 260 | 6.8 | Project source/support file |
| 20 | `backend/src/importParsing.js` | backend-core | 89 | 3.2 | Project source/support file |
| 21 | `backend/src/middleware.js` | backend-core | 361 | 12.0 | Project source/support file |
| 22 | `backend/src/money.js` | backend-core | 26 | 0.6 | Project source/support file |
| 23 | `backend/src/netSecurity.js` | backend-core | 115 | 3.1 | Project source/support file |
| 24 | `backend/src/organizationContext/index.js` | backend-core | 266 | 8.0 | Project source/support file |
| 25 | `backend/src/portalUtils.js` | backend-core | 87 | 2.3 | Project source/support file |
| 26 | `backend/src/productDiscounts.js` | backend-core | 129 | 5.1 | Project source/support file |
| 27 | `backend/src/productImportPolicies.js` | backend-core | 100 | 3.6 | Project source/support file |
| 28 | `backend/src/README.md` | backend-core | 47 | 2.0 | Documentation |
| 29 | `backend/src/requestContext.js` | backend-core | 59 | 1.2 | Project source/support file |
| 30 | `backend/src/routes/actionHistory.js` | backend-routes | 204 | 7.1 | API route handler |
| 31 | `backend/src/routes/ai.js` | backend-routes | 252 | 8.7 | API route handler |
| 32 | `backend/src/routes/auth.js` | backend-routes | 1120 | 40.0 | API route handler |
| 33 | `backend/src/routes/branches.js` | backend-routes | 233 | 10.4 | API route handler |
| 34 | `backend/src/routes/catalog.js` | backend-routes | 85 | 2.4 | API route handler |
| 35 | `backend/src/routes/categories.js` | backend-routes | 137 | 5.2 | API route handler |
| 36 | `backend/src/routes/contacts.js` | backend-routes | 765 | 32.0 | API route handler |
| 37 | `backend/src/routes/customTables.js` | backend-routes | 221 | 8.7 | API route handler |
| 38 | `backend/src/routes/files.js` | backend-routes | 95 | 3.6 | API route handler |
| 39 | `backend/src/routes/importJobs.js` | backend-routes | 344 | 11.7 | API route handler |
| 40 | `backend/src/routes/inventory.js` | backend-routes | 557 | 27.7 | API route handler |
| 41 | `backend/src/routes/notifications.js` | backend-routes | 425 | 14.6 | API route handler |
| 42 | `backend/src/routes/organizations.js` | backend-routes | 63 | 1.8 | API route handler |
| 43 | `backend/src/routes/portal.js` | backend-routes | 997 | 38.0 | API route handler |
| 44 | `backend/src/routes/products.js` | backend-routes | 1318 | 64.3 | API route handler |
| 45 | `backend/src/routes/README.md` | backend-routes | 37 | 1.5 | API route handler |
| 46 | `backend/src/routes/returns.js` | backend-routes | 759 | 29.7 | API route handler |
| 47 | `backend/src/routes/runtime.js` | backend-routes | 46 | 1.5 | API route handler |
| 48 | `backend/src/routes/sales.js` | backend-routes | 1329 | 56.4 | API route handler |
| 49 | `backend/src/routes/settings.js` | backend-routes | 122 | 3.9 | API route handler |
| 50 | `backend/src/routes/system/index.js` | backend-routes | 1546 | 62.2 | API route handler |
| 51 | `backend/src/routes/units.js` | backend-routes | 141 | 5.3 | API route handler |
| 52 | `backend/src/routes/users.js` | backend-routes | 1060 | 44.0 | API route handler |
| 53 | `backend/src/runtimeCache.js` | backend-core | 180 | 4.9 | Project source/support file |
| 54 | `backend/src/runtimeState/index.js` | backend-core | 74 | 2.2 | Project source/support file |
| 55 | `backend/src/security.js` | backend-core | 207 | 6.0 | Project source/support file |
| 56 | `backend/src/serverUtils.js` | backend-core | 377 | 13.4 | Project source/support file |
| 57 | `backend/src/services/aiGateway.js` | backend-services | 326 | 12.2 | Integration/service layer |
| 58 | `backend/src/services/firebaseAuth.js` | backend-services | 384 | 14.3 | Integration/service layer |
| 59 | `backend/src/services/googleDriveSync/index.js` | backend-services | 917 | 31.6 | Integration/service layer |
| 60 | `backend/src/services/importJobs.js` | backend-services | 2815 | 117.1 | Integration/service layer |
| 61 | `backend/src/services/mediaQueue.js` | backend-services | 204 | 7.2 | Integration/service layer |
| 62 | `backend/src/services/portalAi.js` | backend-services | 511 | 18.9 | Integration/service layer |
| 63 | `backend/src/services/README.md` | backend-services | 29 | 1.1 | Integration/service layer |
| 64 | `backend/src/services/supabaseAuth.js` | backend-services | 551 | 20.6 | Integration/service layer |
| 65 | `backend/src/services/verification.js` | backend-services | 272 | 8.1 | Integration/service layer |
| 66 | `backend/src/sessionAuth.js` | backend-core | 187 | 6.2 | Project source/support file |
| 67 | `backend/src/settingsSnapshot.js` | backend-core | 73 | 2.0 | Project source/support file |
| 68 | `backend/src/storage/organizationFolders.js` | backend-core | 56 | 1.7 | Project source/support file |
| 69 | `backend/src/systemFsWorker.js` | backend-core | 95 | 3.0 | Project source/support file |
| 70 | `backend/src/uploadReferenceCleanup.js` | backend-core | 128 | 4.0 | Project source/support file |
| 71 | `backend/src/uploadSecurity.js` | backend-core | 87 | 3.5 | Project source/support file |
| 72 | `backend/src/websocket.js` | backend-core | 94 | 3.6 | Project source/support file |
| 73 | `backend/src/workers/importWorker.js` | backend-core | 35 | 1.0 | Project source/support file |
| 74 | `backend/src/workers/mediaWorker.js` | backend-core | 34 | 0.9 | Project source/support file |
| 75 | `backend/src/workers/migrationWorker.js` | backend-core | 405 | 15.1 | Project source/support file |
| 76 | `backend/test/accessControl.test.js` | backend-root | 127 | 4.0 | Project source/support file |
| 77 | `backend/test/authOtpGuards.test.js` | backend-root | 71 | 1.6 | Project source/support file |
| 78 | `backend/test/authSecurityFlow.test.js` | backend-root | 198 | 6.0 | Project source/support file |
| 79 | `backend/test/backupRoundtrip.test.js` | backend-root | 323 | 10.8 | Project source/support file |
| 80 | `backend/test/backupSchema.test.js` | backend-root | 69 | 2.0 | Project source/support file |
| 81 | `backend/test/configOrganizationRuntime.test.js` | backend-root | 142 | 4.8 | Project source/support file |
| 82 | `backend/test/contactOptions.test.js` | backend-root | 82 | 2.3 | Project source/support file |
| 83 | `backend/test/databaseRuntime.test.js` | backend-root | 51 | 1.7 | Project source/support file |
| 84 | `backend/test/dataPath.test.js` | backend-root | 87 | 2.9 | Project source/support file |
| 85 | `backend/test/fileRouteSecurityFlow.test.js` | backend-root | 215 | 7.0 | Project source/support file |
| 86 | `backend/test/idempotency.test.js` | backend-root | 32 | 0.7 | Project source/support file |
| 87 | `backend/test/importCsv.test.js` | backend-root | 83 | 3.0 | Project source/support file |
| 88 | `backend/test/importJobStateMachine.test.js` | backend-root | 205 | 8.5 | Project source/support file |
| 89 | `backend/test/importScaleSmoke.test.js` | backend-root | 79 | 2.7 | Project source/support file |
| 90 | `backend/test/netSecurity.test.js` | backend-root | 45 | 1.5 | Project source/support file |
| 91 | `backend/test/portalUtils.test.js` | backend-root | 40 | 1.2 | Project source/support file |
| 92 | `backend/test/productImportPolicies.test.js` | backend-root | 72 | 2.9 | Project source/support file |
| 93 | `backend/test/runtimeCache.test.js` | backend-root | 52 | 1.3 | Project source/support file |
| 94 | `backend/test/serverUtils.test.js` | backend-root | 263 | 9.5 | Project source/support file |
| 95 | `backend/test/stockConsistency.test.js` | backend-root | 1766 | 64.6 | Project source/support file |
| 96 | `backend/test/systemRouteSecurity.test.js` | backend-root | 288 | 9.6 | Project source/support file |
| 97 | `backend/test/uploadSecurity.test.js` | backend-root | 59 | 2.0 | Project source/support file |
| 98 | `frontend/.npmrc` | frontend-root | 14 | 0.4 | Project source/support file |
| 99 | `frontend/index.html` | frontend-root | 24 | 1.0 | Project source/support file |
| 100 | `frontend/package-lock.json` | frontend-root | 3778 | 129.6 | Configuration/data manifest |
| 101 | `frontend/package.json` | frontend-root | 36 | 1.8 | Configuration/data manifest |
| 102 | `frontend/postcss.config.mjs` | frontend-root | 7 | 0.1 | Project source/support file |
| 103 | `frontend/public/icon.png` | frontend-root | 0 | 11.4 | Project source/support file |
| 104 | `frontend/public/manifest.json` | frontend-root | 17 | 0.3 | Configuration/data manifest |
| 105 | `frontend/public/runtime-noise-guard.js` | frontend-root | 105 | 4.1 | Project source/support file |
| 106 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.js` | frontend-root | 1 | 94.8 | Project source/support file |
| 107 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.wasm` | frontend-root | 0 | 8726.7 | Project source/support file |
| 108 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.worker.js` | frontend-root | 1 | 1.9 | Project source/support file |
| 109 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd.wasm` | frontend-root | 0 | 8782.2 | Project source/support file |
| 110 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm.wasm` | frontend-root | 0 | 8192.9 | Project source/support file |
| 111 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd-threads.js` | frontend-root | 1 | 146.4 | Project source/support file |
| 112 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd.js` | frontend-root | 1 | 135.5 | Project source/support file |
| 113 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core.js` | frontend-root | 1 | 135.5 | Project source/support file |
| 114 | `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js` | frontend-root | 187 | 1007.0 | Project source/support file |
| 115 | `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js.LICENSE.txt` | frontend-root | 24 | 0.5 | Project source/support file |
| 116 | `frontend/public/sw.js` | frontend-root | 79 | 2.0 | Project source/support file |
| 117 | `frontend/public/theme-bootstrap.js` | frontend-root | 219 | 7.9 | Project source/support file |
| 118 | `frontend/README.md` | frontend-root | 13 | 0.5 | Documentation |
| 119 | `frontend/src/api/http.js` | frontend-api | 785 | 27.4 | Frontend API/sync helper |
| 120 | `frontend/src/api/localDb.js` | frontend-api | 243 | 8.5 | Frontend API/sync helper |
| 121 | `frontend/src/api/methods.js` | frontend-api | 1438 | 69.4 | Frontend API/sync helper |
| 122 | `frontend/src/api/README.md` | frontend-api | 26 | 0.8 | Frontend API/sync helper |
| 123 | `frontend/src/api/websocket.js` | frontend-api | 160 | 5.4 | Frontend API/sync helper |
| 124 | `frontend/src/App.jsx` | frontend-core | 802 | 27.5 | Main app shell and page mounting |
| 125 | `frontend/src/app/appShellUtils.mjs` | frontend-core | 43 | 1.5 | Project source/support file |
| 126 | `frontend/src/app/publicErrorRecovery.mjs` | frontend-core | 23 | 1.0 | Project source/support file |
| 127 | `frontend/src/AppContext.jsx` | frontend-core | 1376 | 56.2 | Global app state/context provider |
| 128 | `frontend/src/components/auth/Login.jsx` | frontend-ui | 1028 | 47.0 | UI component/page |
| 129 | `frontend/src/components/branches/Branches.jsx` | frontend-ui | 684 | 30.7 | UI component/page |
| 130 | `frontend/src/components/branches/BranchForm.jsx` | frontend-ui | 190 | 6.4 | UI component/page |
| 131 | `frontend/src/components/branches/TransferModal.jsx` | frontend-ui | 325 | 12.9 | UI component/page |
| 132 | `frontend/src/components/catalog/CatalogPage.jsx` | frontend-ui | 4403 | 245.4 | UI component/page |
| 133 | `frontend/src/components/catalog/CatalogProductsSection.jsx` | frontend-ui | 383 | 19.1 | UI component/page |
| 134 | `frontend/src/components/catalog/CatalogSecondaryTabs.jsx` | frontend-ui | 684 | 42.2 | UI component/page |
| 135 | `frontend/src/components/catalog/catalogUi.jsx` | frontend-ui | 63 | 2.5 | UI component/page |
| 136 | `frontend/src/components/catalog/portalCatalogDisplay.mjs` | frontend-ui | 135 | 4.6 | UI component/page |
| 137 | `frontend/src/components/catalog/portalEditorUtils.mjs` | frontend-ui | 99 | 2.8 | UI component/page |
| 138 | `frontend/src/components/catalog/portalTranslateController.mjs` | frontend-ui | 224 | 8.6 | UI component/page |
| 139 | `frontend/src/components/contacts/contactOptionUtils.js` | frontend-ui | 99 | 3.4 | UI component/page |
| 140 | `frontend/src/components/contacts/Contacts.jsx` | frontend-ui | 230 | 8.7 | UI component/page |
| 141 | `frontend/src/components/contacts/CustomersTab.jsx` | frontend-ui | 855 | 42.1 | UI component/page |
| 142 | `frontend/src/components/contacts/DeliveryTab.jsx` | frontend-ui | 769 | 38.6 | UI component/page |
| 143 | `frontend/src/components/contacts/shared.jsx` | frontend-ui | 526 | 19.5 | UI component/page |
| 144 | `frontend/src/components/contacts/SuppliersTab.jsx` | frontend-ui | 774 | 38.7 | UI component/page |
| 145 | `frontend/src/components/custom-tables/CustomTables.jsx` | frontend-ui | 525 | 23.2 | UI component/page |
| 146 | `frontend/src/components/dashboard/charts/BarChart.jsx` | frontend-ui | 99 | 4.3 | UI component/page |
| 147 | `frontend/src/components/dashboard/charts/DonutChart.jsx` | frontend-ui | 93 | 4.2 | UI component/page |
| 148 | `frontend/src/components/dashboard/charts/index.js` | frontend-ui | 6 | 0.4 | UI component/page |
| 149 | `frontend/src/components/dashboard/charts/LineChart.jsx` | frontend-ui | 130 | 5.8 | UI component/page |
| 150 | `frontend/src/components/dashboard/charts/NoData.jsx` | frontend-ui | 15 | 0.6 | UI component/page |
| 151 | `frontend/src/components/dashboard/Dashboard.jsx` | frontend-ui | 1354 | 68.2 | UI component/page |
| 152 | `frontend/src/components/dashboard/MiniStat.jsx` | frontend-ui | 25 | 1.1 | UI component/page |
| 153 | `frontend/src/components/files/FilePickerModal.jsx` | frontend-ui | 232 | 9.5 | UI component/page |
| 154 | `frontend/src/components/files/FilesPage.jsx` | frontend-ui | 886 | 52.8 | UI component/page |
| 155 | `frontend/src/components/inventory/DualMoney.jsx` | frontend-ui | 14 | 0.6 | UI component/page |
| 156 | `frontend/src/components/inventory/Inventory.jsx` | frontend-ui | 2470 | 139.2 | UI component/page |
| 157 | `frontend/src/components/inventory/InventoryImportModal.jsx` | frontend-ui | 148 | 7.2 | UI component/page |
| 158 | `frontend/src/components/inventory/movementGroups.js` | frontend-ui | 111 | 4.7 | UI component/page |
| 159 | `frontend/src/components/inventory/ProductDetailModal.jsx` | frontend-ui | 133 | 8.6 | UI component/page |
| 160 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | frontend-ui | 580 | 33.4 | UI component/page |
| 161 | `frontend/src/components/navigation/Sidebar.jsx` | frontend-ui | 317 | 14.1 | UI component/page |
| 162 | `frontend/src/components/pos/CartItem.jsx` | frontend-ui | 105 | 4.9 | UI component/page |
| 163 | `frontend/src/components/pos/FilterPanel.jsx` | frontend-ui | 261 | 9.1 | UI component/page |
| 164 | `frontend/src/components/pos/POS.jsx` | frontend-ui | 1784 | 104.5 | UI component/page |
| 165 | `frontend/src/components/pos/posCore.mjs` | frontend-ui | 97 | 4.0 | UI component/page |
| 166 | `frontend/src/components/pos/ProductImage.jsx` | frontend-ui | 6 | 0.2 | UI component/page |
| 167 | `frontend/src/components/pos/QuickAddModal.jsx` | frontend-ui | 38 | 1.6 | UI component/page |
| 168 | `frontend/src/components/products/barcodeImageScanner.mjs` | frontend-ui | 43 | 1.5 | UI component/page |
| 169 | `frontend/src/components/products/BarcodeScannerModal.jsx` | frontend-ui | 581 | 27.7 | UI component/page |
| 170 | `frontend/src/components/products/barcodeScannerState.mjs` | frontend-ui | 52 | 1.5 | UI component/page |
| 171 | `frontend/src/components/products/BranchStockAdjuster.jsx` | frontend-ui | 107 | 4.2 | UI component/page |
| 172 | `frontend/src/components/products/BulkAddStockModal.jsx` | frontend-ui | 73 | 3.4 | UI component/page |
| 173 | `frontend/src/components/products/BulkImportModal.jsx` | frontend-ui | 869 | 43.5 | UI component/page |
| 174 | `frontend/src/components/products/HeaderActions.jsx` | frontend-ui | 127 | 4.6 | UI component/page |
| 175 | `frontend/src/components/products/ManageBrandsModal.jsx` | frontend-ui | 274 | 8.8 | UI component/page |
| 176 | `frontend/src/components/products/ManageCategoriesModal.jsx` | frontend-ui | 191 | 7.4 | UI component/page |
| 177 | `frontend/src/components/products/ManageUnitsModal.jsx` | frontend-ui | 170 | 6.6 | UI component/page |
| 178 | `frontend/src/components/products/primitives.jsx` | frontend-ui | 175 | 6.3 | UI component/page |
| 179 | `frontend/src/components/products/ProductDetailModal.jsx` | frontend-ui | 184 | 8.9 | UI component/page |
| 180 | `frontend/src/components/products/ProductForm.jsx` | frontend-ui | 876 | 43.4 | UI component/page |
| 181 | `frontend/src/components/products/productHistoryHelpers.mjs` | frontend-ui | 38 | 1.1 | UI component/page |
| 182 | `frontend/src/components/products/productImportPlanner.mjs` | frontend-ui | 329 | 12.8 | UI component/page |
| 183 | `frontend/src/components/products/productImportWorker.mjs` | frontend-ui | 22 | 0.9 | UI component/page |
| 184 | `frontend/src/components/products/Products.jsx` | frontend-ui | 2107 | 106.7 | UI component/page |
| 185 | `frontend/src/components/products/scanbotScanner.mjs` | frontend-ui | 137 | 4.5 | UI component/page |
| 186 | `frontend/src/components/products/VariantFormModal.jsx` | frontend-ui | 263 | 12.6 | UI component/page |
| 187 | `frontend/src/components/README.md` | frontend-ui | 37 | 1.9 | UI component/page |
| 188 | `frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | frontend-ui | 99 | 4.0 | UI component/page |
| 189 | `frontend/src/components/receipt-settings/constants.js` | frontend-ui | 99 | 6.3 | UI component/page |
| 190 | `frontend/src/components/receipt-settings/ErrorBoundary.jsx` | frontend-ui | 28 | 0.9 | UI component/page |
| 191 | `frontend/src/components/receipt-settings/FieldOrderManager.jsx` | frontend-ui | 190 | 9.4 | UI component/page |
| 192 | `frontend/src/components/receipt-settings/PrintSettings.jsx` | frontend-ui | 212 | 9.9 | UI component/page |
| 193 | `frontend/src/components/receipt-settings/ReceiptPreview.jsx` | frontend-ui | 97 | 3.3 | UI component/page |
| 194 | `frontend/src/components/receipt-settings/ReceiptSettings.jsx` | frontend-ui | 404 | 24.1 | UI component/page |
| 195 | `frontend/src/components/receipt-settings/template.js` | frontend-ui | 17 | 0.4 | UI component/page |
| 196 | `frontend/src/components/receipt/Receipt.jsx` | frontend-ui | 450 | 21.6 | UI component/page |
| 197 | `frontend/src/components/returns/EditReturnModal.jsx` | frontend-ui | 230 | 12.2 | UI component/page |
| 198 | `frontend/src/components/returns/NewReturnModal.jsx` | frontend-ui | 468 | 26.5 | UI component/page |
| 199 | `frontend/src/components/returns/NewSupplierReturnModal.jsx` | frontend-ui | 376 | 19.7 | UI component/page |
| 200 | `frontend/src/components/returns/ReturnDetailModal.jsx` | frontend-ui | 132 | 6.8 | UI component/page |
| 201 | `frontend/src/components/returns/Returns.jsx` | frontend-ui | 831 | 40.0 | UI component/page |
| 202 | `frontend/src/components/sales/ExportModal.jsx` | frontend-ui | 238 | 10.8 | UI component/page |
| 203 | `frontend/src/components/sales/SaleDetailModal.jsx` | frontend-ui | 332 | 15.7 | UI component/page |
| 204 | `frontend/src/components/sales/Sales.jsx` | frontend-ui | 912 | 45.3 | UI component/page |
| 205 | `frontend/src/components/sales/SalesImportModal.jsx` | frontend-ui | 149 | 7.5 | UI component/page |
| 206 | `frontend/src/components/sales/StatusBadge.jsx` | frontend-ui | 47 | 1.6 | UI component/page |
| 207 | `frontend/src/components/server/ServerPage.jsx` | frontend-ui | 701 | 34.6 | UI component/page |
| 208 | `frontend/src/components/shared/ActionHistoryBar.jsx` | frontend-ui | 121 | 6.4 | UI component/page |
| 209 | `frontend/src/components/shared/BackgroundImportTracker.jsx` | frontend-ui | 397 | 17.6 | UI component/page |
| 210 | `frontend/src/components/shared/ExportMenu.jsx` | frontend-ui | 32 | 1.1 | UI component/page |
| 211 | `frontend/src/components/shared/FilterMenu.jsx` | frontend-ui | 111 | 4.8 | UI component/page |
| 212 | `frontend/src/components/shared/ImageGalleryLightbox.jsx` | frontend-ui | 119 | 4.9 | UI component/page |
| 213 | `frontend/src/components/shared/Modal.jsx` | frontend-ui | 34 | 1.7 | UI component/page |
| 214 | `frontend/src/components/shared/navigationConfig.js` | frontend-ui | 45 | 1.8 | UI component/page |
| 215 | `frontend/src/components/shared/NotificationCenter.jsx` | frontend-ui | 466 | 23.9 | UI component/page |
| 216 | `frontend/src/components/shared/pageActivity.js` | frontend-ui | 8 | 0.2 | UI component/page |
| 217 | `frontend/src/components/shared/PageHeader.jsx` | frontend-ui | 47 | 1.9 | UI component/page |
| 218 | `frontend/src/components/shared/PageHelpButton.jsx` | frontend-ui | 76 | 3.2 | UI component/page |
| 219 | `frontend/src/components/shared/pageHelpContent.js` | frontend-ui | 447 | 28.2 | UI component/page |
| 220 | `frontend/src/components/shared/PaginationControls.jsx` | frontend-ui | 88 | 4.0 | UI component/page |
| 221 | `frontend/src/components/shared/PortalMenu.jsx` | frontend-ui | 201 | 7.0 | UI component/page |
| 222 | `frontend/src/components/shared/QuickPreferenceToggles.jsx` | frontend-ui | 56 | 2.0 | UI component/page |
| 223 | `frontend/src/components/shared/WriteConflictModal.jsx` | frontend-ui | 266 | 11.0 | UI component/page |
| 224 | `frontend/src/components/users/PermissionEditor.jsx` | frontend-ui | 88 | 3.5 | UI component/page |
| 225 | `frontend/src/components/users/UserDetailSheet.jsx` | frontend-ui | 103 | 5.0 | UI component/page |
| 226 | `frontend/src/components/users/UserProfileModal.jsx` | frontend-ui | 1118 | 60.5 | UI component/page |
| 227 | `frontend/src/components/users/Users.jsx` | frontend-ui | 914 | 43.6 | UI component/page |
| 228 | `frontend/src/components/utils-settings/AuditLog.jsx` | frontend-ui | 889 | 41.6 | UI component/page |
| 229 | `frontend/src/components/utils-settings/Backup.jsx` | frontend-ui | 1667 | 77.6 | UI component/page |
| 230 | `frontend/src/components/utils-settings/FontFamilyPicker.jsx` | frontend-ui | 59 | 2.9 | UI component/page |
| 231 | `frontend/src/components/utils-settings/index.js` | frontend-ui | 12 | 0.7 | UI component/page |
| 232 | `frontend/src/components/utils-settings/OtpModal.jsx` | frontend-ui | 249 | 9.7 | UI component/page |
| 233 | `frontend/src/components/utils-settings/ResetData.jsx` | frontend-ui | 280 | 12.6 | UI component/page |
| 234 | `frontend/src/components/utils-settings/Settings.jsx` | frontend-ui | 1387 | 62.4 | UI component/page |
| 235 | `frontend/src/constants.js` | frontend-core | 181 | 8.5 | Project source/support file |
| 236 | `frontend/src/index.jsx` | frontend-core | 187 | 6.0 | Project source/support file |
| 237 | `frontend/src/lang/en.json` | frontend-i18n | 2415 | 115.3 | Localization dictionary |
| 238 | `frontend/src/lang/km.json` | frontend-i18n | 2423 | 211.9 | Localization dictionary |
| 239 | `frontend/src/platform/runtime/clientRuntime.js` | frontend-core | 195 | 7.2 | Project source/support file |
| 240 | `frontend/src/platform/storage/storagePolicy.mjs` | frontend-core | 37 | 1.1 | Project source/support file |
| 241 | `frontend/src/README.md` | frontend-core | 38 | 1.3 | Documentation |
| 242 | `frontend/src/runtime/runtimeErrorClassifier.mjs` | frontend-core | 125 | 4.5 | Project source/support file |
| 243 | `frontend/src/styles/main.css` | frontend-style | 605 | 25.0 | Project source/support file |
| 244 | `frontend/src/utils/actionHistory.mjs` | frontend-utils | 122 | 5.4 | Utility helper |
| 245 | `frontend/src/utils/appRefresh.js` | frontend-utils | 28 | 0.6 | Utility helper |
| 246 | `frontend/src/utils/color.js` | frontend-utils | 32 | 0.9 | Utility helper |
| 247 | `frontend/src/utils/csv.js` | frontend-utils | 168 | 5.5 | Utility helper |
| 248 | `frontend/src/utils/csvImport.js` | frontend-utils | 227 | 6.8 | Utility helper |
| 249 | `frontend/src/utils/dateHelpers.js` | frontend-utils | 25 | 1.0 | Utility helper |
| 250 | `frontend/src/utils/deviceInfo.js` | frontend-utils | 36 | 1.0 | Utility helper |
| 251 | `frontend/src/utils/exportPackage.js` | frontend-utils | 34 | 0.7 | Utility helper |
| 252 | `frontend/src/utils/exportReports.jsx` | frontend-utils | 366 | 9.6 | Utility helper |
| 253 | `frontend/src/utils/favicon.js` | frontend-utils | 61 | 1.8 | Utility helper |
| 254 | `frontend/src/utils/formatters.js` | frontend-utils | 55 | 1.8 | Utility helper |
| 255 | `frontend/src/utils/groupedRecords.mjs` | frontend-utils | 282 | 9.4 | Utility helper |
| 256 | `frontend/src/utils/historyHelpers.mjs` | frontend-utils | 41 | 1.2 | Utility helper |
| 257 | `frontend/src/utils/index.js` | frontend-utils | 10 | 0.5 | Utility helper |
| 258 | `frontend/src/utils/loaders.mjs` | frontend-utils | 84 | 2.5 | Utility helper |
| 259 | `frontend/src/utils/pricing.js` | frontend-utils | 85 | 3.4 | Utility helper |
| 260 | `frontend/src/utils/printReceipt.js` | frontend-utils | 829 | 27.5 | Utility helper |
| 261 | `frontend/src/utils/productGrouping.mjs` | frontend-utils | 264 | 9.6 | Utility helper |
| 262 | `frontend/src/web-api.js` | frontend-core | 206 | 7.1 | Project source/support file |
| 263 | `frontend/tailwind.config.mjs` | frontend-root | 17 | 0.4 | Project source/support file |
| 264 | `frontend/tests/apiHttp.test.mjs` | frontend-root | 115 | 3.7 | Project source/support file |
| 265 | `frontend/tests/appShellUtils.test.mjs` | frontend-root | 41 | 1.3 | Project source/support file |
| 266 | `frontend/tests/barcodeImageScanner.test.mjs` | frontend-root | 84 | 2.0 | Project source/support file |
| 267 | `frontend/tests/barcodeScannerState.test.mjs` | frontend-root | 62 | 2.4 | Project source/support file |
| 268 | `frontend/tests/csvImport.test.mjs` | frontend-root | 51 | 1.7 | Project source/support file |
| 269 | `frontend/tests/exportPackages.test.mjs` | frontend-root | 67 | 2.4 | Project source/support file |
| 270 | `frontend/tests/groupedRecords.test.mjs` | frontend-root | 68 | 2.2 | Project source/support file |
| 271 | `frontend/tests/historyHelpers.test.mjs` | frontend-root | 72 | 2.1 | Project source/support file |
| 272 | `frontend/tests/loaders.test.mjs` | frontend-root | 82 | 2.4 | Project source/support file |
| 273 | `frontend/tests/portalCatalogDisplay.test.mjs` | frontend-root | 103 | 3.1 | Project source/support file |
| 274 | `frontend/tests/portalEditorUtils.test.mjs` | frontend-root | 57 | 1.9 | Project source/support file |
| 275 | `frontend/tests/portalTranslateController.test.mjs` | frontend-root | 145 | 4.5 | Project source/support file |
| 276 | `frontend/tests/posCore.test.mjs` | frontend-root | 136 | 5.1 | Project source/support file |
| 277 | `frontend/tests/pricingContacts.test.mjs` | frontend-root | 94 | 3.0 | Project source/support file |
| 278 | `frontend/tests/productGrouping.test.mjs` | frontend-root | 111 | 4.8 | Project source/support file |
| 279 | `frontend/tests/productHistoryHelpers.test.mjs` | frontend-root | 44 | 1.3 | Project source/support file |
| 280 | `frontend/tests/productImportPlanner.test.mjs` | frontend-root | 107 | 4.4 | Project source/support file |
| 281 | `frontend/tests/publicErrorRecovery.test.mjs` | frontend-root | 35 | 1.2 | Project source/support file |
| 282 | `frontend/tests/receiptTemplate.test.mjs` | frontend-root | 41 | 1.2 | Project source/support file |
| 283 | `frontend/tests/runtimeErrorClassifier.test.mjs` | frontend-root | 58 | 2.2 | Project source/support file |
| 284 | `frontend/tests/scanbotScanner.test.mjs` | frontend-root | 111 | 2.9 | Project source/support file |
| 285 | `frontend/tests/storagePolicy.test.mjs` | frontend-root | 42 | 1.3 | Project source/support file |
| 286 | `frontend/vite.config.mjs` | frontend-root | 114 | 4.6 | Project source/support file |
| 287 | `ops/scripts/backend/verify-data-integrity.js` | project-scripts | 233 | 7.9 | Project source/support file |
| 288 | `ops/scripts/frontend/verify-i18n.js` | project-scripts | 145 | 4.3 | Project source/support file |
| 289 | `ops/scripts/frontend/verify-performance.js` | project-scripts | 130 | 7.7 | Project source/support file |
| 290 | `ops/scripts/frontend/verify-ui.js` | project-scripts | 250 | 8.5 | Project source/support file |
| 291 | `ops/scripts/generate-doc-reference.js` | project-scripts | 474 | 15.6 | Project source/support file |
| 292 | `ops/scripts/generate-full-project-docs.js` | project-scripts | 638 | 22.7 | Project source/support file |
| 293 | `ops/scripts/lib/fs-utils.js` | project-scripts | 122 | 2.8 | Project source/support file |
| 294 | `ops/scripts/performance-scan.js` | project-scripts | 135 | 4.1 | Project source/support file |
| 295 | `ops/scripts/powershell/clean-generated.ps1` | project-scripts | 194 | 5.4 | Project source/support file |
| 296 | `ops/scripts/powershell/docker-release.ps1` | project-scripts | 344 | 13.4 | Project source/support file |
| 297 | `ops/scripts/powershell/runtime-bootstrap.ps1` | project-scripts | 513 | 17.4 | Project source/support file |
| 298 | `ops/scripts/powershell/start-runtime.ps1` | project-scripts | 233 | 9.4 | Project source/support file |
| 299 | `ops/scripts/powershell/tailscale-health-monitor.ps1` | project-scripts | 240 | 7.5 | Project source/support file |
| 300 | `ops/scripts/runtime/check-public-url.mjs` | project-scripts | 239 | 8.0 | Project source/support file |
| 301 | `ops/scripts/runtime/rotate-cloudflare-tunnel-token.mjs` | project-scripts | 244 | 10.6 | Project source/support file |
| 302 | `ops/scripts/runtime/update-cloudflare-tunnel-origin.mjs` | project-scripts | 144 | 5.9 | Project source/support file |
| 303 | `ops/scripts/sync-firebase-release-env.ps1` | project-scripts | 55 | 1.7 | Project source/support file |
| 304 | `ops/scripts/verify-docker-release.js` | project-scripts | 81 | 2.5 | Project source/support file |
| 305 | `ops/scripts/verify-runtime-deps.js` | project-scripts | 81 | 2.5 | Project source/support file |
| 306 | `ops/scripts/verify-scale-services.js` | project-scripts | 158 | 5.3 | Project source/support file |
| 307 | `README.md` | project-root | 102 | 4.6 | Project documentation entrypoint |
| 308 | `run/build-release.bat` | project-scripts | 634 | 26.5 | Project source/support file |
| 309 | `run/clean-generated.bat` | project-scripts | 60 | 1.7 | Project source/support file |
| 310 | `run/cloudflare-origin.bat` | project-scripts | 34 | 1.0 | Project source/support file |
| 311 | `run/docker/backup.bat` | project-scripts | 15 | 0.5 | Project source/support file |
| 312 | `run/docker/doctor.bat` | project-scripts | 15 | 0.5 | Project source/support file |
| 313 | `run/docker/install.bat` | project-scripts | 15 | 0.5 | Project source/support file |
| 314 | `run/docker/publish-release.bat` | project-scripts | 15 | 0.5 | Project source/support file |
| 315 | `run/docker/README.md` | project-scripts | 30 | 1.3 | Documentation |
| 316 | `run/docker/release.bat` | project-scripts | 15 | 0.5 | Project source/support file |
| 317 | `run/docker/restore.bat` | project-scripts | 15 | 0.5 | Project source/support file |
| 318 | `run/docker/rotate-cloudflare.bat` | project-scripts | 15 | 0.5 | Project source/support file |
| 319 | `run/docker/start.bat` | project-scripts | 15 | 0.6 | Project source/support file |
| 320 | `run/docker/update.bat` | project-scripts | 15 | 0.5 | Project source/support file |
| 321 | `run/README.md` | project-scripts | 35 | 1.6 | Documentation |
| 322 | `run/setup.bat` | project-scripts | 378 | 17.8 | Project source/support file |
| 323 | `run/sh/setup.sh` | project-scripts | 122 | 3.3 | Project source/support file |
| 324 | `run/sh/start-server.sh` | project-scripts | 153 | 5.9 | Project source/support file |
| 325 | `run/sh/stop-server.sh` | project-scripts | 62 | 1.6 | Project source/support file |
| 326 | `run/start-server.bat` | project-scripts | 571 | 29.3 | Project source/support file |
| 327 | `run/stop-server.bat` | project-scripts | 183 | 8.2 | Project source/support file |
| 328 | `run/verify-local.bat` | project-scripts | 130 | 4.6 | Project source/support file |
| 329 | `Start Business OS.bat` | project-root | 43 | 1.3 | Project source/support file |
