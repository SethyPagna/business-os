# All File Inventory (Project First-Party Files)

Auto-generated file-level commentary for all first-party project files (frontend, backend, scripts, and root run/config files; excluding dependencies/build artifacts).

## 1. Coverage Summary

Total files documented: **768**

## 2. File Commentary Matrix

| No. | File | Category | Lines | Size (KB) | Purpose |
|---:|---|---|---:|---:|---|
| 1 | `.npmrc` | project-root | 14 | 0.4 | Project source/support file |
| 2 | `backend/.env` | backend-root | 35 | 1.5 | Project source/support file |
| 3 | `backend/.npmrc` | backend-root | 14 | 0.4 | Project source/support file |
| 4 | `backend/leang-cosmetics-firebase-admins.json` | backend-root | 14 | 2.3 | Configuration/data manifest |
| 5 | `backend/package-lock.json` | backend-root | 2362 | 80.4 | Configuration/data manifest |
| 6 | `backend/package.json` | backend-root | 53 | 1.8 | Configuration/data manifest |
| 7 | `backend/server.js` | backend-root | 256 | 8.3 | Backend server entrypoint |
| 8 | `backend/src/accessControl.js` | backend-core | 148 | 4.4 | Project source/support file |
| 9 | `backend/src/backupSchema.js` | backend-core | 101 | 2.1 | Project source/support file |
| 10 | `backend/src/config.js` | backend-core | 160 | 6.5 | Project source/support file |
| 11 | `backend/src/database.js` | backend-core | 1090 | 39.9 | Schema/migrations and DB bootstrap |
| 12 | `backend/src/dataPath.js` | backend-core | 199 | 5.7 | Project source/support file |
| 13 | `backend/src/fileAssets.js` | backend-core | 378 | 12.4 | Project source/support file |
| 14 | `backend/src/helpers.js` | backend-core | 477 | 16.9 | Project source/support file |
| 15 | `backend/src/middleware.js` | backend-core | 214 | 7.5 | Project source/support file |
| 16 | `backend/src/netSecurity.js` | backend-core | 115 | 3.1 | Project source/support file |
| 17 | `backend/src/organizationContext.js` | backend-core | 176 | 4.8 | Project source/support file |
| 18 | `backend/src/portalUtils.js` | backend-core | 87 | 2.3 | Project source/support file |
| 19 | `backend/src/README.md` | backend-core | 47 | 2.0 | Documentation |
| 20 | `backend/src/requestContext.js` | backend-core | 59 | 1.2 | Project source/support file |
| 21 | `backend/src/routes/ai.js` | backend-routes | 249 | 7.9 | API route handler |
| 22 | `backend/src/routes/auth.js` | backend-routes | 890 | 31.1 | API route handler |
| 23 | `backend/src/routes/branches.js` | backend-routes | 196 | 8.2 | API route handler |
| 24 | `backend/src/routes/catalog.js` | backend-routes | 83 | 2.2 | API route handler |
| 25 | `backend/src/routes/categories.js` | backend-routes | 45 | 1.5 | API route handler |
| 26 | `backend/src/routes/contacts.js` | backend-routes | 585 | 19.9 | API route handler |
| 27 | `backend/src/routes/customTables.js` | backend-routes | 104 | 3.5 | API route handler |
| 28 | `backend/src/routes/files.js` | backend-routes | 75 | 2.4 | API route handler |
| 29 | `backend/src/routes/inventory.js` | backend-routes | 344 | 16.4 | API route handler |
| 30 | `backend/src/routes/organizations.js` | backend-routes | 53 | 1.5 | API route handler |
| 31 | `backend/src/routes/portal.js` | backend-routes | 802 | 30.7 | API route handler |
| 32 | `backend/src/routes/products.js` | backend-routes | 767 | 34.3 | API route handler |
| 33 | `backend/src/routes/README.md` | backend-routes | 36 | 1.4 | API route handler |
| 34 | `backend/src/routes/returns.js` | backend-routes | 670 | 25.6 | API route handler |
| 35 | `backend/src/routes/sales.js` | backend-routes | 1245 | 51.1 | API route handler |
| 36 | `backend/src/routes/settings.js` | backend-routes | 34 | 0.9 | API route handler |
| 37 | `backend/src/routes/system.js` | backend-routes | 1223 | 47.3 | API route handler |
| 38 | `backend/src/routes/units.js` | backend-routes | 71 | 3.0 | API route handler |
| 39 | `backend/src/routes/users.js` | backend-routes | 1015 | 41.2 | API route handler |
| 40 | `backend/src/security.js` | backend-core | 207 | 6.0 | Project source/support file |
| 41 | `backend/src/serverUtils.js` | backend-core | 196 | 6.4 | Project source/support file |
| 42 | `backend/src/services/aiGateway.js` | backend-services | 326 | 12.2 | Integration/service layer |
| 43 | `backend/src/services/firebaseAuth.js` | backend-services | 384 | 14.3 | Integration/service layer |
| 44 | `backend/src/services/googleDriveSync.js` | backend-services | 873 | 30.3 | Integration/service layer |
| 45 | `backend/src/services/portalAi.js` | backend-services | 511 | 18.9 | Integration/service layer |
| 46 | `backend/src/services/README.md` | backend-services | 29 | 1.1 | Integration/service layer |
| 47 | `backend/src/services/supabaseAuth.js` | backend-services | 551 | 20.6 | Integration/service layer |
| 48 | `backend/src/services/verification.js` | backend-services | 272 | 8.1 | Integration/service layer |
| 49 | `backend/src/sessionAuth.js` | backend-core | 151 | 4.5 | Project source/support file |
| 50 | `backend/src/systemFsWorker.js` | backend-core | 95 | 3.0 | Project source/support file |
| 51 | `backend/src/uploadSecurity.js` | backend-core | 87 | 3.5 | Project source/support file |
| 52 | `backend/src/websocket.js` | backend-core | 63 | 2.1 | Project source/support file |
| 53 | `backend/temp-backup-roundtrip-4011/backend-test.env` | backend-root | 2 | 0.0 | Project source/support file |
| 54 | `backend/test/accessControl.test.js` | backend-root | 103 | 3.0 | Project source/support file |
| 55 | `backend/test/backupRoundtrip.test.js` | backend-root | 323 | 10.8 | Project source/support file |
| 56 | `backend/test/backupSchema.test.js` | backend-root | 67 | 1.9 | Project source/support file |
| 57 | `backend/test/dataPath.test.js` | backend-root | 87 | 2.9 | Project source/support file |
| 58 | `backend/test/netSecurity.test.js` | backend-root | 45 | 1.5 | Project source/support file |
| 59 | `backend/test/portalUtils.test.js` | backend-root | 40 | 1.2 | Project source/support file |
| 60 | `backend/test/serverUtils.test.js` | backend-root | 81 | 2.4 | Project source/support file |
| 61 | `backend/test/uploadSecurity.test.js` | backend-root | 37 | 1.1 | Project source/support file |
| 62 | `build-release.bat` | project-root | 578 | 21.7 | Release build orchestration script |
| 63 | `business-os-v1-centralized-org-path/backend/.env` | project | 35 | 1.5 | Project source/support file |
| 64 | `business-os-v1-centralized-org-path/backend/.npmrc` | project | 14 | 0.4 | Project source/support file |
| 65 | `business-os-v1-centralized-org-path/backend/leang-cosmetics-firebase-admins.json` | project | 14 | 2.3 | Configuration/data manifest |
| 66 | `business-os-v1-centralized-org-path/backend/package-lock.json` | project | 2362 | 80.4 | Configuration/data manifest |
| 67 | `business-os-v1-centralized-org-path/backend/package.json` | project | 53 | 1.8 | Configuration/data manifest |
| 68 | `business-os-v1-centralized-org-path/backend/server.js` | project | 256 | 8.3 | Backend server entrypoint |
| 69 | `business-os-v1-centralized-org-path/backend/src/accessControl.js` | project | 148 | 4.4 | Project source/support file |
| 70 | `business-os-v1-centralized-org-path/backend/src/backupSchema.js` | project | 101 | 2.1 | Project source/support file |
| 71 | `business-os-v1-centralized-org-path/backend/src/config.js` | project | 160 | 6.5 | Project source/support file |
| 72 | `business-os-v1-centralized-org-path/backend/src/database.js` | project | 1090 | 39.9 | Schema/migrations and DB bootstrap |
| 73 | `business-os-v1-centralized-org-path/backend/src/dataPath.js` | project | 199 | 5.7 | Project source/support file |
| 74 | `business-os-v1-centralized-org-path/backend/src/fileAssets.js` | project | 378 | 12.4 | Project source/support file |
| 75 | `business-os-v1-centralized-org-path/backend/src/helpers.js` | project | 477 | 16.9 | Project source/support file |
| 76 | `business-os-v1-centralized-org-path/backend/src/middleware.js` | project | 214 | 7.5 | Project source/support file |
| 77 | `business-os-v1-centralized-org-path/backend/src/netSecurity.js` | project | 115 | 3.1 | Project source/support file |
| 78 | `business-os-v1-centralized-org-path/backend/src/organizationContext.js` | project | 176 | 4.8 | Project source/support file |
| 79 | `business-os-v1-centralized-org-path/backend/src/portalUtils.js` | project | 87 | 2.3 | Project source/support file |
| 80 | `business-os-v1-centralized-org-path/backend/src/README.md` | project | 47 | 2.0 | Documentation |
| 81 | `business-os-v1-centralized-org-path/backend/src/requestContext.js` | project | 59 | 1.2 | Project source/support file |
| 82 | `business-os-v1-centralized-org-path/backend/src/routes/ai.js` | project | 249 | 7.9 | API route handler |
| 83 | `business-os-v1-centralized-org-path/backend/src/routes/auth.js` | project | 890 | 31.1 | API route handler |
| 84 | `business-os-v1-centralized-org-path/backend/src/routes/branches.js` | project | 196 | 8.2 | API route handler |
| 85 | `business-os-v1-centralized-org-path/backend/src/routes/catalog.js` | project | 83 | 2.2 | API route handler |
| 86 | `business-os-v1-centralized-org-path/backend/src/routes/categories.js` | project | 45 | 1.5 | API route handler |
| 87 | `business-os-v1-centralized-org-path/backend/src/routes/contacts.js` | project | 585 | 19.9 | API route handler |
| 88 | `business-os-v1-centralized-org-path/backend/src/routes/customTables.js` | project | 104 | 3.5 | API route handler |
| 89 | `business-os-v1-centralized-org-path/backend/src/routes/files.js` | project | 75 | 2.4 | API route handler |
| 90 | `business-os-v1-centralized-org-path/backend/src/routes/inventory.js` | project | 344 | 16.4 | API route handler |
| 91 | `business-os-v1-centralized-org-path/backend/src/routes/organizations.js` | project | 53 | 1.5 | API route handler |
| 92 | `business-os-v1-centralized-org-path/backend/src/routes/portal.js` | project | 802 | 30.7 | API route handler |
| 93 | `business-os-v1-centralized-org-path/backend/src/routes/products.js` | project | 767 | 34.3 | API route handler |
| 94 | `business-os-v1-centralized-org-path/backend/src/routes/README.md` | project | 36 | 1.4 | API route handler |
| 95 | `business-os-v1-centralized-org-path/backend/src/routes/returns.js` | project | 670 | 25.6 | API route handler |
| 96 | `business-os-v1-centralized-org-path/backend/src/routes/sales.js` | project | 1245 | 51.1 | API route handler |
| 97 | `business-os-v1-centralized-org-path/backend/src/routes/settings.js` | project | 34 | 0.9 | API route handler |
| 98 | `business-os-v1-centralized-org-path/backend/src/routes/system.js` | project | 1223 | 47.3 | API route handler |
| 99 | `business-os-v1-centralized-org-path/backend/src/routes/units.js` | project | 71 | 3.0 | API route handler |
| 100 | `business-os-v1-centralized-org-path/backend/src/routes/users.js` | project | 1015 | 41.2 | API route handler |
| 101 | `business-os-v1-centralized-org-path/backend/src/security.js` | project | 207 | 6.0 | Project source/support file |
| 102 | `business-os-v1-centralized-org-path/backend/src/serverUtils.js` | project | 196 | 6.4 | Project source/support file |
| 103 | `business-os-v1-centralized-org-path/backend/src/services/aiGateway.js` | project | 326 | 12.2 | Integration/service layer |
| 104 | `business-os-v1-centralized-org-path/backend/src/services/firebaseAuth.js` | project | 384 | 14.3 | Integration/service layer |
| 105 | `business-os-v1-centralized-org-path/backend/src/services/googleDriveSync.js` | project | 873 | 30.3 | Integration/service layer |
| 106 | `business-os-v1-centralized-org-path/backend/src/services/portalAi.js` | project | 511 | 18.9 | Integration/service layer |
| 107 | `business-os-v1-centralized-org-path/backend/src/services/README.md` | project | 29 | 1.1 | Integration/service layer |
| 108 | `business-os-v1-centralized-org-path/backend/src/services/supabaseAuth.js` | project | 551 | 20.6 | Integration/service layer |
| 109 | `business-os-v1-centralized-org-path/backend/src/services/verification.js` | project | 272 | 8.1 | Integration/service layer |
| 110 | `business-os-v1-centralized-org-path/backend/src/sessionAuth.js` | project | 151 | 4.5 | Project source/support file |
| 111 | `business-os-v1-centralized-org-path/backend/src/systemFsWorker.js` | project | 95 | 3.0 | Project source/support file |
| 112 | `business-os-v1-centralized-org-path/backend/src/uploadSecurity.js` | project | 87 | 3.5 | Project source/support file |
| 113 | `business-os-v1-centralized-org-path/backend/src/websocket.js` | project | 63 | 2.1 | Project source/support file |
| 114 | `business-os-v1-centralized-org-path/backend/temp-backup-roundtrip-4011/backend-test.env` | project | 2 | 0.0 | Project source/support file |
| 115 | `business-os-v1-centralized-org-path/backend/test/accessControl.test.js` | project | 103 | 3.0 | Project source/support file |
| 116 | `business-os-v1-centralized-org-path/backend/test/backupRoundtrip.test.js` | project | 323 | 10.8 | Project source/support file |
| 117 | `business-os-v1-centralized-org-path/backend/test/backupSchema.test.js` | project | 67 | 1.9 | Project source/support file |
| 118 | `business-os-v1-centralized-org-path/backend/test/dataPath.test.js` | project | 87 | 2.9 | Project source/support file |
| 119 | `business-os-v1-centralized-org-path/backend/test/netSecurity.test.js` | project | 45 | 1.5 | Project source/support file |
| 120 | `business-os-v1-centralized-org-path/backend/test/portalUtils.test.js` | project | 40 | 1.2 | Project source/support file |
| 121 | `business-os-v1-centralized-org-path/backend/test/serverUtils.test.js` | project | 81 | 2.4 | Project source/support file |
| 122 | `business-os-v1-centralized-org-path/backend/test/uploadSecurity.test.js` | project | 37 | 1.1 | Project source/support file |
| 123 | `business-os-v1-centralized-org-path/build-release-v1.bat` | project | 5 | 0.1 | Project source/support file |
| 124 | `business-os-v1-centralized-org-path/build-release.bat` | project | 544 | 20.8 | Project source/support file |
| 125 | `business-os-v1-centralized-org-path/frontend-dev.log` | project | 0 | 7.2 | Project source/support file |
| 126 | `business-os-v1-centralized-org-path/frontend/.npmrc` | project | 14 | 0.4 | Project source/support file |
| 127 | `business-os-v1-centralized-org-path/frontend/index.html` | project | 107 | 5.4 | Project source/support file |
| 128 | `business-os-v1-centralized-org-path/frontend/package-lock.json` | project | 3733 | 124.2 | Configuration/data manifest |
| 129 | `business-os-v1-centralized-org-path/frontend/package.json` | project | 30 | 0.8 | Configuration/data manifest |
| 130 | `business-os-v1-centralized-org-path/frontend/postcss.config.js` | project | 7 | 0.1 | Project source/support file |
| 131 | `business-os-v1-centralized-org-path/frontend/public/icon.png` | project | 0 | 11.4 | Project source/support file |
| 132 | `business-os-v1-centralized-org-path/frontend/public/manifest.json` | project | 17 | 0.3 | Configuration/data manifest |
| 133 | `business-os-v1-centralized-org-path/frontend/src/api/http.js` | project | 324 | 11.9 | Frontend API/sync helper |
| 134 | `business-os-v1-centralized-org-path/frontend/src/api/localDb.js` | project | 86 | 3.3 | Frontend API/sync helper |
| 135 | `business-os-v1-centralized-org-path/frontend/src/api/methods.js` | project | 800 | 43.3 | Frontend API/sync helper |
| 136 | `business-os-v1-centralized-org-path/frontend/src/api/websocket.js` | project | 119 | 4.0 | Frontend API/sync helper |
| 137 | `business-os-v1-centralized-org-path/frontend/src/App.jsx` | project | 537 | 16.7 | Main app shell and page mounting |
| 138 | `business-os-v1-centralized-org-path/frontend/src/app/appShellUtils.mjs` | project | 41 | 1.3 | Project source/support file |
| 139 | `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx` | project | 877 | 35.6 | Global app state/context provider |
| 140 | `business-os-v1-centralized-org-path/frontend/src/components/auth/Login.jsx` | project | 816 | 34.6 | UI component/page |
| 141 | `business-os-v1-centralized-org-path/frontend/src/components/branches/Branches.jsx` | project | 462 | 20.8 | UI component/page |
| 142 | `business-os-v1-centralized-org-path/frontend/src/components/branches/BranchForm.jsx` | project | 190 | 6.4 | UI component/page |
| 143 | `business-os-v1-centralized-org-path/frontend/src/components/branches/TransferModal.jsx` | project | 287 | 11.5 | UI component/page |
| 144 | `business-os-v1-centralized-org-path/frontend/src/components/catalog/CatalogPage.jsx` | project | 4258 | 233.3 | UI component/page |
| 145 | `business-os-v1-centralized-org-path/frontend/src/components/catalog/portalEditorUtils.mjs` | project | 99 | 2.8 | UI component/page |
| 146 | `business-os-v1-centralized-org-path/frontend/src/components/contacts/Contacts.jsx` | project | 197 | 7.4 | UI component/page |
| 147 | `business-os-v1-centralized-org-path/frontend/src/components/contacts/CustomersTab.jsx` | project | 428 | 21.2 | UI component/page |
| 148 | `business-os-v1-centralized-org-path/frontend/src/components/contacts/DeliveryTab.jsx` | project | 299 | 15.5 | UI component/page |
| 149 | `business-os-v1-centralized-org-path/frontend/src/components/contacts/shared.jsx` | project | 373 | 12.6 | UI component/page |
| 150 | `business-os-v1-centralized-org-path/frontend/src/components/contacts/SuppliersTab.jsx` | project | 263 | 12.9 | UI component/page |
| 151 | `business-os-v1-centralized-org-path/frontend/src/components/custom-tables/CustomTables.jsx` | project | 240 | 12.8 | UI component/page |
| 152 | `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/BarChart.jsx` | project | 99 | 4.3 | UI component/page |
| 153 | `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/DonutChart.jsx` | project | 83 | 3.8 | UI component/page |
| 154 | `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/index.js` | project | 6 | 0.4 | UI component/page |
| 155 | `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/LineChart.jsx` | project | 124 | 5.4 | UI component/page |
| 156 | `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/NoData.jsx` | project | 15 | 0.6 | UI component/page |
| 157 | `business-os-v1-centralized-org-path/frontend/src/components/dashboard/Dashboard.jsx` | project | 803 | 49.8 | UI component/page |
| 158 | `business-os-v1-centralized-org-path/frontend/src/components/dashboard/MiniStat.jsx` | project | 25 | 1.1 | UI component/page |
| 159 | `business-os-v1-centralized-org-path/frontend/src/components/files/FilePickerModal.jsx` | project | 211 | 8.5 | UI component/page |
| 160 | `business-os-v1-centralized-org-path/frontend/src/components/files/FilesPage.jsx` | project | 709 | 37.9 | UI component/page |
| 161 | `business-os-v1-centralized-org-path/frontend/src/components/inventory/DualMoney.jsx` | project | 14 | 0.6 | UI component/page |
| 162 | `business-os-v1-centralized-org-path/frontend/src/components/inventory/Inventory.jsx` | project | 1170 | 66.8 | UI component/page |
| 163 | `business-os-v1-centralized-org-path/frontend/src/components/inventory/movementGroups.js` | project | 106 | 4.6 | UI component/page |
| 164 | `business-os-v1-centralized-org-path/frontend/src/components/inventory/ProductDetailModal.jsx` | project | 106 | 6.9 | UI component/page |
| 165 | `business-os-v1-centralized-org-path/frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | project | 537 | 31.0 | UI component/page |
| 166 | `business-os-v1-centralized-org-path/frontend/src/components/navigation/Sidebar.jsx` | project | 341 | 15.0 | UI component/page |
| 167 | `business-os-v1-centralized-org-path/frontend/src/components/pos/CartItem.jsx` | project | 66 | 4.1 | UI component/page |
| 168 | `business-os-v1-centralized-org-path/frontend/src/components/pos/FilterPanel.jsx` | project | 224 | 7.4 | UI component/page |
| 169 | `business-os-v1-centralized-org-path/frontend/src/components/pos/POS.jsx` | project | 1394 | 83.3 | UI component/page |
| 170 | `business-os-v1-centralized-org-path/frontend/src/components/pos/ProductImage.jsx` | project | 31 | 1.2 | UI component/page |
| 171 | `business-os-v1-centralized-org-path/frontend/src/components/pos/QuickAddModal.jsx` | project | 30 | 1.7 | UI component/page |
| 172 | `business-os-v1-centralized-org-path/frontend/src/components/products/BranchStockAdjuster.jsx` | project | 91 | 3.4 | UI component/page |
| 173 | `business-os-v1-centralized-org-path/frontend/src/components/products/BulkAddStockModal.jsx` | project | 68 | 3.2 | UI component/page |
| 174 | `business-os-v1-centralized-org-path/frontend/src/components/products/BulkImportModal.jsx` | project | 482 | 23.0 | UI component/page |
| 175 | `business-os-v1-centralized-org-path/frontend/src/components/products/HeaderActions.jsx` | project | 108 | 3.8 | UI component/page |
| 176 | `business-os-v1-centralized-org-path/frontend/src/components/products/ManageBrandsModal.jsx` | project | 266 | 8.5 | UI component/page |
| 177 | `business-os-v1-centralized-org-path/frontend/src/components/products/ManageCategoriesModal.jsx` | project | 79 | 4.1 | UI component/page |
| 178 | `business-os-v1-centralized-org-path/frontend/src/components/products/ManageFieldsModal.jsx` | project | 73 | 4.3 | UI component/page |
| 179 | `business-os-v1-centralized-org-path/frontend/src/components/products/ManageMenu.jsx` | project | 22 | 0.9 | UI component/page |
| 180 | `business-os-v1-centralized-org-path/frontend/src/components/products/ManageUnitsModal.jsx` | project | 45 | 2.1 | UI component/page |
| 181 | `business-os-v1-centralized-org-path/frontend/src/components/products/primitives.jsx` | project | 114 | 4.3 | UI component/page |
| 182 | `business-os-v1-centralized-org-path/frontend/src/components/products/ProductDetailModal.jsx` | project | 144 | 6.6 | UI component/page |
| 183 | `business-os-v1-centralized-org-path/frontend/src/components/products/ProductForm.jsx` | project | 510 | 20.4 | UI component/page |
| 184 | `business-os-v1-centralized-org-path/frontend/src/components/products/Products.jsx` | project | 961 | 54.9 | UI component/page |
| 185 | `business-os-v1-centralized-org-path/frontend/src/components/products/VariantFormModal.jsx` | project | 100 | 6.5 | UI component/page |
| 186 | `business-os-v1-centralized-org-path/frontend/src/components/README.md` | project | 44 | 1.5 | UI component/page |
| 187 | `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | project | 93 | 3.8 | UI component/page |
| 188 | `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/constants.js` | project | 99 | 6.3 | UI component/page |
| 189 | `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/ErrorBoundary.jsx` | project | 28 | 0.9 | UI component/page |
| 190 | `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/FieldOrderManager.jsx` | project | 190 | 9.4 | UI component/page |
| 191 | `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/PrintSettings.jsx` | project | 201 | 9.9 | UI component/page |
| 192 | `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/ReceiptPreview.jsx` | project | 79 | 2.6 | UI component/page |
| 193 | `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/ReceiptSettings.jsx` | project | 369 | 22.2 | UI component/page |
| 194 | `business-os-v1-centralized-org-path/frontend/src/components/receipt/Receipt.jsx` | project | 410 | 19.0 | UI component/page |
| 195 | `business-os-v1-centralized-org-path/frontend/src/components/returns/EditReturnModal.jsx` | project | 226 | 12.1 | UI component/page |
| 196 | `business-os-v1-centralized-org-path/frontend/src/components/returns/NewReturnModal.jsx` | project | 447 | 25.4 | UI component/page |
| 197 | `business-os-v1-centralized-org-path/frontend/src/components/returns/NewSupplierReturnModal.jsx` | project | 335 | 17.7 | UI component/page |
| 198 | `business-os-v1-centralized-org-path/frontend/src/components/returns/ReturnDetailModal.jsx` | project | 132 | 6.8 | UI component/page |
| 199 | `business-os-v1-centralized-org-path/frontend/src/components/returns/Returns.jsx` | project | 340 | 16.1 | UI component/page |
| 200 | `business-os-v1-centralized-org-path/frontend/src/components/sales/ExportModal.jsx` | project | 238 | 10.6 | UI component/page |
| 201 | `business-os-v1-centralized-org-path/frontend/src/components/sales/SaleDetailModal.jsx` | project | 332 | 15.7 | UI component/page |
| 202 | `business-os-v1-centralized-org-path/frontend/src/components/sales/Sales.jsx` | project | 317 | 15.8 | UI component/page |
| 203 | `business-os-v1-centralized-org-path/frontend/src/components/sales/StatusBadge.jsx` | project | 47 | 1.6 | UI component/page |
| 204 | `business-os-v1-centralized-org-path/frontend/src/components/server/ServerPage.jsx` | project | 569 | 26.2 | UI component/page |
| 205 | `business-os-v1-centralized-org-path/frontend/src/components/shared/ImageGalleryLightbox.jsx` | project | 119 | 4.9 | UI component/page |
| 206 | `business-os-v1-centralized-org-path/frontend/src/components/shared/Modal.jsx` | project | 34 | 1.7 | UI component/page |
| 207 | `business-os-v1-centralized-org-path/frontend/src/components/shared/navigationConfig.js` | project | 45 | 1.8 | UI component/page |
| 208 | `business-os-v1-centralized-org-path/frontend/src/components/shared/PageHelpButton.jsx` | project | 76 | 3.2 | UI component/page |
| 209 | `business-os-v1-centralized-org-path/frontend/src/components/shared/pageHelpContent.js` | project | 447 | 28.2 | UI component/page |
| 210 | `business-os-v1-centralized-org-path/frontend/src/components/shared/PortalMenu.jsx` | project | 145 | 5.2 | UI component/page |
| 211 | `business-os-v1-centralized-org-path/frontend/src/components/users/PermissionEditor.jsx` | project | 88 | 3.5 | UI component/page |
| 212 | `business-os-v1-centralized-org-path/frontend/src/components/users/UserDetailSheet.jsx` | project | 103 | 5.0 | UI component/page |
| 213 | `business-os-v1-centralized-org-path/frontend/src/components/users/UserProfileModal.jsx` | project | 579 | 29.1 | UI component/page |
| 214 | `business-os-v1-centralized-org-path/frontend/src/components/users/Users.jsx` | project | 617 | 29.3 | UI component/page |
| 215 | `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/AuditLog.jsx` | project | 439 | 19.7 | UI component/page |
| 216 | `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/Backup.jsx` | project | 1146 | 50.6 | UI component/page |
| 217 | `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/FontFamilyPicker.jsx` | project | 59 | 2.9 | UI component/page |
| 218 | `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/index.js` | project | 12 | 0.7 | UI component/page |
| 219 | `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/OtpModal.jsx` | project | 127 | 6.6 | UI component/page |
| 220 | `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/ResetData.jsx` | project | 267 | 12.1 | UI component/page |
| 221 | `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/Settings.jsx` | project | 1205 | 53.4 | UI component/page |
| 222 | `business-os-v1-centralized-org-path/frontend/src/constants.js` | project | 174 | 8.0 | Project source/support file |
| 223 | `business-os-v1-centralized-org-path/frontend/src/index.jsx` | project | 81 | 2.4 | Project source/support file |
| 224 | `business-os-v1-centralized-org-path/frontend/src/lang/en.json` | project | 1591 | 71.3 | Localization dictionary |
| 225 | `business-os-v1-centralized-org-path/frontend/src/lang/km.json` | project | 1591 | 129.5 | Localization dictionary |
| 226 | `business-os-v1-centralized-org-path/frontend/src/README.md` | project | 38 | 1.3 | Documentation |
| 227 | `business-os-v1-centralized-org-path/frontend/src/styles/main.css` | project | 357 | 16.4 | Project source/support file |
| 228 | `business-os-v1-centralized-org-path/frontend/src/utils/appRefresh.js` | project | 28 | 0.6 | Utility helper |
| 229 | `business-os-v1-centralized-org-path/frontend/src/utils/csv.js` | project | 33 | 1.2 | Utility helper |
| 230 | `business-os-v1-centralized-org-path/frontend/src/utils/dateHelpers.js` | project | 25 | 1.0 | Utility helper |
| 231 | `business-os-v1-centralized-org-path/frontend/src/utils/deviceInfo.js` | project | 36 | 1.0 | Utility helper |
| 232 | `business-os-v1-centralized-org-path/frontend/src/utils/favicon.js` | project | 61 | 1.8 | Utility helper |
| 233 | `business-os-v1-centralized-org-path/frontend/src/utils/firebasePhoneAuth.js` | project | 21 | 0.5 | Utility helper |
| 234 | `business-os-v1-centralized-org-path/frontend/src/utils/formatters.js` | project | 55 | 1.8 | Utility helper |
| 235 | `business-os-v1-centralized-org-path/frontend/src/utils/index.js` | project | 10 | 0.5 | Utility helper |
| 236 | `business-os-v1-centralized-org-path/frontend/src/utils/printReceipt.js` | project | 463 | 14.8 | Utility helper |
| 237 | `business-os-v1-centralized-org-path/frontend/src/web-api.js` | project | 167 | 6.1 | Project source/support file |
| 238 | `business-os-v1-centralized-org-path/frontend/tailwind.config.js` | project | 17 | 0.4 | Project source/support file |
| 239 | `business-os-v1-centralized-org-path/frontend/tests/appShellUtils.test.mjs` | project | 41 | 1.3 | Project source/support file |
| 240 | `business-os-v1-centralized-org-path/frontend/tests/portalEditorUtils.test.mjs` | project | 57 | 1.9 | Project source/support file |
| 241 | `business-os-v1-centralized-org-path/frontend/vite.config.mjs` | project | 101 | 3.9 | Project source/support file |
| 242 | `business-os-v1-centralized-org-path/README-organization-versions.md` | project | 120 | 3.5 | Documentation |
| 243 | `business-os-v1-centralized-org-path/README.md` | project | 20 | 0.7 | Documentation |
| 244 | `business-os-v1-centralized-org-path/setup.bat` | project | 259 | 11.2 | Project source/support file |
| 245 | `business-os-v1-centralized-org-path/setup.sh` | project | 110 | 3.4 | Project source/support file |
| 246 | `business-os-v1-centralized-org-path/start-server-release.bat` | project | 258 | 10.7 | Project source/support file |
| 247 | `business-os-v1-centralized-org-path/start-server.bat` | project | 272 | 10.6 | Project source/support file |
| 248 | `business-os-v1-centralized-org-path/start-server.sh` | project | 131 | 5.8 | Project source/support file |
| 249 | `business-os-v1-centralized-org-path/stop-server-release.bat` | project | 124 | 4.6 | Project source/support file |
| 250 | `business-os-v1-centralized-org-path/stop-server.bat` | project | 113 | 4.0 | Project source/support file |
| 251 | `business-os-v1-centralized-org-path/stop-server.sh` | project | 69 | 2.2 | Project source/support file |
| 252 | `business-os-v1-centralized-org-path/SUPABASE.md` | project | 20 | 0.4 | Documentation |
| 253 | `business-os-v2-dedicated-server/backend/.env` | project | 35 | 1.5 | Project source/support file |
| 254 | `business-os-v2-dedicated-server/backend/.npmrc` | project | 14 | 0.4 | Project source/support file |
| 255 | `business-os-v2-dedicated-server/backend/leang-cosmetics-firebase-admins.json` | project | 14 | 2.3 | Configuration/data manifest |
| 256 | `business-os-v2-dedicated-server/backend/package-lock.json` | project | 2362 | 80.4 | Configuration/data manifest |
| 257 | `business-os-v2-dedicated-server/backend/package.json` | project | 53 | 1.8 | Configuration/data manifest |
| 258 | `business-os-v2-dedicated-server/backend/server.js` | project | 256 | 8.3 | Backend server entrypoint |
| 259 | `business-os-v2-dedicated-server/backend/src/accessControl.js` | project | 148 | 4.4 | Project source/support file |
| 260 | `business-os-v2-dedicated-server/backend/src/backupSchema.js` | project | 101 | 2.1 | Project source/support file |
| 261 | `business-os-v2-dedicated-server/backend/src/config.js` | project | 160 | 6.5 | Project source/support file |
| 262 | `business-os-v2-dedicated-server/backend/src/database.js` | project | 1090 | 39.9 | Schema/migrations and DB bootstrap |
| 263 | `business-os-v2-dedicated-server/backend/src/dataPath.js` | project | 199 | 5.7 | Project source/support file |
| 264 | `business-os-v2-dedicated-server/backend/src/fileAssets.js` | project | 378 | 12.4 | Project source/support file |
| 265 | `business-os-v2-dedicated-server/backend/src/helpers.js` | project | 477 | 16.9 | Project source/support file |
| 266 | `business-os-v2-dedicated-server/backend/src/middleware.js` | project | 214 | 7.5 | Project source/support file |
| 267 | `business-os-v2-dedicated-server/backend/src/netSecurity.js` | project | 115 | 3.1 | Project source/support file |
| 268 | `business-os-v2-dedicated-server/backend/src/organizationContext.js` | project | 176 | 4.8 | Project source/support file |
| 269 | `business-os-v2-dedicated-server/backend/src/portalUtils.js` | project | 87 | 2.3 | Project source/support file |
| 270 | `business-os-v2-dedicated-server/backend/src/README.md` | project | 47 | 2.0 | Documentation |
| 271 | `business-os-v2-dedicated-server/backend/src/requestContext.js` | project | 59 | 1.2 | Project source/support file |
| 272 | `business-os-v2-dedicated-server/backend/src/routes/ai.js` | project | 249 | 7.9 | API route handler |
| 273 | `business-os-v2-dedicated-server/backend/src/routes/auth.js` | project | 890 | 31.1 | API route handler |
| 274 | `business-os-v2-dedicated-server/backend/src/routes/branches.js` | project | 196 | 8.2 | API route handler |
| 275 | `business-os-v2-dedicated-server/backend/src/routes/catalog.js` | project | 83 | 2.2 | API route handler |
| 276 | `business-os-v2-dedicated-server/backend/src/routes/categories.js` | project | 45 | 1.5 | API route handler |
| 277 | `business-os-v2-dedicated-server/backend/src/routes/contacts.js` | project | 585 | 19.9 | API route handler |
| 278 | `business-os-v2-dedicated-server/backend/src/routes/customTables.js` | project | 104 | 3.5 | API route handler |
| 279 | `business-os-v2-dedicated-server/backend/src/routes/files.js` | project | 75 | 2.4 | API route handler |
| 280 | `business-os-v2-dedicated-server/backend/src/routes/inventory.js` | project | 344 | 16.4 | API route handler |
| 281 | `business-os-v2-dedicated-server/backend/src/routes/organizations.js` | project | 53 | 1.5 | API route handler |
| 282 | `business-os-v2-dedicated-server/backend/src/routes/portal.js` | project | 802 | 30.7 | API route handler |
| 283 | `business-os-v2-dedicated-server/backend/src/routes/products.js` | project | 767 | 34.3 | API route handler |
| 284 | `business-os-v2-dedicated-server/backend/src/routes/README.md` | project | 36 | 1.4 | API route handler |
| 285 | `business-os-v2-dedicated-server/backend/src/routes/returns.js` | project | 670 | 25.6 | API route handler |
| 286 | `business-os-v2-dedicated-server/backend/src/routes/sales.js` | project | 1245 | 51.1 | API route handler |
| 287 | `business-os-v2-dedicated-server/backend/src/routes/settings.js` | project | 34 | 0.9 | API route handler |
| 288 | `business-os-v2-dedicated-server/backend/src/routes/system.js` | project | 1223 | 47.3 | API route handler |
| 289 | `business-os-v2-dedicated-server/backend/src/routes/units.js` | project | 71 | 3.0 | API route handler |
| 290 | `business-os-v2-dedicated-server/backend/src/routes/users.js` | project | 1015 | 41.2 | API route handler |
| 291 | `business-os-v2-dedicated-server/backend/src/security.js` | project | 207 | 6.0 | Project source/support file |
| 292 | `business-os-v2-dedicated-server/backend/src/serverUtils.js` | project | 196 | 6.4 | Project source/support file |
| 293 | `business-os-v2-dedicated-server/backend/src/services/aiGateway.js` | project | 326 | 12.2 | Integration/service layer |
| 294 | `business-os-v2-dedicated-server/backend/src/services/firebaseAuth.js` | project | 384 | 14.3 | Integration/service layer |
| 295 | `business-os-v2-dedicated-server/backend/src/services/googleDriveSync.js` | project | 873 | 30.3 | Integration/service layer |
| 296 | `business-os-v2-dedicated-server/backend/src/services/portalAi.js` | project | 511 | 18.9 | Integration/service layer |
| 297 | `business-os-v2-dedicated-server/backend/src/services/README.md` | project | 29 | 1.1 | Integration/service layer |
| 298 | `business-os-v2-dedicated-server/backend/src/services/supabaseAuth.js` | project | 551 | 20.6 | Integration/service layer |
| 299 | `business-os-v2-dedicated-server/backend/src/services/verification.js` | project | 272 | 8.1 | Integration/service layer |
| 300 | `business-os-v2-dedicated-server/backend/src/sessionAuth.js` | project | 151 | 4.5 | Project source/support file |
| 301 | `business-os-v2-dedicated-server/backend/src/systemFsWorker.js` | project | 95 | 3.0 | Project source/support file |
| 302 | `business-os-v2-dedicated-server/backend/src/uploadSecurity.js` | project | 87 | 3.5 | Project source/support file |
| 303 | `business-os-v2-dedicated-server/backend/src/websocket.js` | project | 63 | 2.1 | Project source/support file |
| 304 | `business-os-v2-dedicated-server/backend/temp-backup-roundtrip-4011/backend-test.env` | project | 2 | 0.0 | Project source/support file |
| 305 | `business-os-v2-dedicated-server/backend/test/accessControl.test.js` | project | 103 | 3.0 | Project source/support file |
| 306 | `business-os-v2-dedicated-server/backend/test/backupRoundtrip.test.js` | project | 323 | 10.8 | Project source/support file |
| 307 | `business-os-v2-dedicated-server/backend/test/backupSchema.test.js` | project | 67 | 1.9 | Project source/support file |
| 308 | `business-os-v2-dedicated-server/backend/test/dataPath.test.js` | project | 87 | 2.9 | Project source/support file |
| 309 | `business-os-v2-dedicated-server/backend/test/netSecurity.test.js` | project | 45 | 1.5 | Project source/support file |
| 310 | `business-os-v2-dedicated-server/backend/test/portalUtils.test.js` | project | 40 | 1.2 | Project source/support file |
| 311 | `business-os-v2-dedicated-server/backend/test/serverUtils.test.js` | project | 81 | 2.4 | Project source/support file |
| 312 | `business-os-v2-dedicated-server/backend/test/uploadSecurity.test.js` | project | 37 | 1.1 | Project source/support file |
| 313 | `business-os-v2-dedicated-server/build-release-v2.bat` | project | 5 | 0.1 | Project source/support file |
| 314 | `business-os-v2-dedicated-server/build-release.bat` | project | 544 | 20.8 | Project source/support file |
| 315 | `business-os-v2-dedicated-server/frontend-dev.log` | project | 0 | 7.2 | Project source/support file |
| 316 | `business-os-v2-dedicated-server/frontend/.npmrc` | project | 14 | 0.4 | Project source/support file |
| 317 | `business-os-v2-dedicated-server/frontend/index.html` | project | 107 | 5.4 | Project source/support file |
| 318 | `business-os-v2-dedicated-server/frontend/package-lock.json` | project | 3733 | 124.2 | Configuration/data manifest |
| 319 | `business-os-v2-dedicated-server/frontend/package.json` | project | 30 | 0.8 | Configuration/data manifest |
| 320 | `business-os-v2-dedicated-server/frontend/postcss.config.js` | project | 7 | 0.1 | Project source/support file |
| 321 | `business-os-v2-dedicated-server/frontend/public/icon.png` | project | 0 | 11.4 | Project source/support file |
| 322 | `business-os-v2-dedicated-server/frontend/public/manifest.json` | project | 17 | 0.3 | Configuration/data manifest |
| 323 | `business-os-v2-dedicated-server/frontend/src/api/http.js` | project | 324 | 11.9 | Frontend API/sync helper |
| 324 | `business-os-v2-dedicated-server/frontend/src/api/localDb.js` | project | 86 | 3.3 | Frontend API/sync helper |
| 325 | `business-os-v2-dedicated-server/frontend/src/api/methods.js` | project | 800 | 43.3 | Frontend API/sync helper |
| 326 | `business-os-v2-dedicated-server/frontend/src/api/websocket.js` | project | 119 | 4.0 | Frontend API/sync helper |
| 327 | `business-os-v2-dedicated-server/frontend/src/App.jsx` | project | 537 | 16.7 | Main app shell and page mounting |
| 328 | `business-os-v2-dedicated-server/frontend/src/app/appShellUtils.mjs` | project | 41 | 1.3 | Project source/support file |
| 329 | `business-os-v2-dedicated-server/frontend/src/AppContext.jsx` | project | 877 | 35.6 | Global app state/context provider |
| 330 | `business-os-v2-dedicated-server/frontend/src/components/auth/Login.jsx` | project | 816 | 34.6 | UI component/page |
| 331 | `business-os-v2-dedicated-server/frontend/src/components/branches/Branches.jsx` | project | 462 | 20.8 | UI component/page |
| 332 | `business-os-v2-dedicated-server/frontend/src/components/branches/BranchForm.jsx` | project | 190 | 6.4 | UI component/page |
| 333 | `business-os-v2-dedicated-server/frontend/src/components/branches/TransferModal.jsx` | project | 287 | 11.5 | UI component/page |
| 334 | `business-os-v2-dedicated-server/frontend/src/components/catalog/CatalogPage.jsx` | project | 4258 | 233.3 | UI component/page |
| 335 | `business-os-v2-dedicated-server/frontend/src/components/catalog/portalEditorUtils.mjs` | project | 99 | 2.8 | UI component/page |
| 336 | `business-os-v2-dedicated-server/frontend/src/components/contacts/Contacts.jsx` | project | 197 | 7.4 | UI component/page |
| 337 | `business-os-v2-dedicated-server/frontend/src/components/contacts/CustomersTab.jsx` | project | 428 | 21.2 | UI component/page |
| 338 | `business-os-v2-dedicated-server/frontend/src/components/contacts/DeliveryTab.jsx` | project | 299 | 15.5 | UI component/page |
| 339 | `business-os-v2-dedicated-server/frontend/src/components/contacts/shared.jsx` | project | 373 | 12.6 | UI component/page |
| 340 | `business-os-v2-dedicated-server/frontend/src/components/contacts/SuppliersTab.jsx` | project | 263 | 12.9 | UI component/page |
| 341 | `business-os-v2-dedicated-server/frontend/src/components/custom-tables/CustomTables.jsx` | project | 240 | 12.8 | UI component/page |
| 342 | `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/BarChart.jsx` | project | 99 | 4.3 | UI component/page |
| 343 | `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/DonutChart.jsx` | project | 83 | 3.8 | UI component/page |
| 344 | `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/index.js` | project | 6 | 0.4 | UI component/page |
| 345 | `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/LineChart.jsx` | project | 124 | 5.4 | UI component/page |
| 346 | `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/NoData.jsx` | project | 15 | 0.6 | UI component/page |
| 347 | `business-os-v2-dedicated-server/frontend/src/components/dashboard/Dashboard.jsx` | project | 803 | 49.8 | UI component/page |
| 348 | `business-os-v2-dedicated-server/frontend/src/components/dashboard/MiniStat.jsx` | project | 25 | 1.1 | UI component/page |
| 349 | `business-os-v2-dedicated-server/frontend/src/components/files/FilePickerModal.jsx` | project | 211 | 8.5 | UI component/page |
| 350 | `business-os-v2-dedicated-server/frontend/src/components/files/FilesPage.jsx` | project | 709 | 37.9 | UI component/page |
| 351 | `business-os-v2-dedicated-server/frontend/src/components/inventory/DualMoney.jsx` | project | 14 | 0.6 | UI component/page |
| 352 | `business-os-v2-dedicated-server/frontend/src/components/inventory/Inventory.jsx` | project | 1170 | 66.8 | UI component/page |
| 353 | `business-os-v2-dedicated-server/frontend/src/components/inventory/movementGroups.js` | project | 106 | 4.6 | UI component/page |
| 354 | `business-os-v2-dedicated-server/frontend/src/components/inventory/ProductDetailModal.jsx` | project | 106 | 6.9 | UI component/page |
| 355 | `business-os-v2-dedicated-server/frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | project | 537 | 31.0 | UI component/page |
| 356 | `business-os-v2-dedicated-server/frontend/src/components/navigation/Sidebar.jsx` | project | 341 | 15.0 | UI component/page |
| 357 | `business-os-v2-dedicated-server/frontend/src/components/pos/CartItem.jsx` | project | 66 | 4.1 | UI component/page |
| 358 | `business-os-v2-dedicated-server/frontend/src/components/pos/FilterPanel.jsx` | project | 224 | 7.4 | UI component/page |
| 359 | `business-os-v2-dedicated-server/frontend/src/components/pos/POS.jsx` | project | 1394 | 83.3 | UI component/page |
| 360 | `business-os-v2-dedicated-server/frontend/src/components/pos/ProductImage.jsx` | project | 31 | 1.2 | UI component/page |
| 361 | `business-os-v2-dedicated-server/frontend/src/components/pos/QuickAddModal.jsx` | project | 30 | 1.7 | UI component/page |
| 362 | `business-os-v2-dedicated-server/frontend/src/components/products/BranchStockAdjuster.jsx` | project | 91 | 3.4 | UI component/page |
| 363 | `business-os-v2-dedicated-server/frontend/src/components/products/BulkAddStockModal.jsx` | project | 68 | 3.2 | UI component/page |
| 364 | `business-os-v2-dedicated-server/frontend/src/components/products/BulkImportModal.jsx` | project | 482 | 23.0 | UI component/page |
| 365 | `business-os-v2-dedicated-server/frontend/src/components/products/HeaderActions.jsx` | project | 108 | 3.8 | UI component/page |
| 366 | `business-os-v2-dedicated-server/frontend/src/components/products/ManageBrandsModal.jsx` | project | 266 | 8.5 | UI component/page |
| 367 | `business-os-v2-dedicated-server/frontend/src/components/products/ManageCategoriesModal.jsx` | project | 79 | 4.1 | UI component/page |
| 368 | `business-os-v2-dedicated-server/frontend/src/components/products/ManageFieldsModal.jsx` | project | 73 | 4.3 | UI component/page |
| 369 | `business-os-v2-dedicated-server/frontend/src/components/products/ManageMenu.jsx` | project | 22 | 0.9 | UI component/page |
| 370 | `business-os-v2-dedicated-server/frontend/src/components/products/ManageUnitsModal.jsx` | project | 45 | 2.1 | UI component/page |
| 371 | `business-os-v2-dedicated-server/frontend/src/components/products/primitives.jsx` | project | 114 | 4.3 | UI component/page |
| 372 | `business-os-v2-dedicated-server/frontend/src/components/products/ProductDetailModal.jsx` | project | 144 | 6.6 | UI component/page |
| 373 | `business-os-v2-dedicated-server/frontend/src/components/products/ProductForm.jsx` | project | 510 | 20.4 | UI component/page |
| 374 | `business-os-v2-dedicated-server/frontend/src/components/products/Products.jsx` | project | 961 | 54.9 | UI component/page |
| 375 | `business-os-v2-dedicated-server/frontend/src/components/products/VariantFormModal.jsx` | project | 100 | 6.5 | UI component/page |
| 376 | `business-os-v2-dedicated-server/frontend/src/components/README.md` | project | 44 | 1.5 | UI component/page |
| 377 | `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | project | 93 | 3.8 | UI component/page |
| 378 | `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/constants.js` | project | 99 | 6.3 | UI component/page |
| 379 | `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/ErrorBoundary.jsx` | project | 28 | 0.9 | UI component/page |
| 380 | `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/FieldOrderManager.jsx` | project | 190 | 9.4 | UI component/page |
| 381 | `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/PrintSettings.jsx` | project | 201 | 9.9 | UI component/page |
| 382 | `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/ReceiptPreview.jsx` | project | 79 | 2.6 | UI component/page |
| 383 | `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/ReceiptSettings.jsx` | project | 369 | 22.2 | UI component/page |
| 384 | `business-os-v2-dedicated-server/frontend/src/components/receipt/Receipt.jsx` | project | 410 | 19.0 | UI component/page |
| 385 | `business-os-v2-dedicated-server/frontend/src/components/returns/EditReturnModal.jsx` | project | 226 | 12.1 | UI component/page |
| 386 | `business-os-v2-dedicated-server/frontend/src/components/returns/NewReturnModal.jsx` | project | 447 | 25.4 | UI component/page |
| 387 | `business-os-v2-dedicated-server/frontend/src/components/returns/NewSupplierReturnModal.jsx` | project | 335 | 17.7 | UI component/page |
| 388 | `business-os-v2-dedicated-server/frontend/src/components/returns/ReturnDetailModal.jsx` | project | 132 | 6.8 | UI component/page |
| 389 | `business-os-v2-dedicated-server/frontend/src/components/returns/Returns.jsx` | project | 340 | 16.1 | UI component/page |
| 390 | `business-os-v2-dedicated-server/frontend/src/components/sales/ExportModal.jsx` | project | 238 | 10.6 | UI component/page |
| 391 | `business-os-v2-dedicated-server/frontend/src/components/sales/SaleDetailModal.jsx` | project | 332 | 15.7 | UI component/page |
| 392 | `business-os-v2-dedicated-server/frontend/src/components/sales/Sales.jsx` | project | 317 | 15.8 | UI component/page |
| 393 | `business-os-v2-dedicated-server/frontend/src/components/sales/StatusBadge.jsx` | project | 47 | 1.6 | UI component/page |
| 394 | `business-os-v2-dedicated-server/frontend/src/components/server/ServerPage.jsx` | project | 569 | 26.2 | UI component/page |
| 395 | `business-os-v2-dedicated-server/frontend/src/components/shared/ImageGalleryLightbox.jsx` | project | 119 | 4.9 | UI component/page |
| 396 | `business-os-v2-dedicated-server/frontend/src/components/shared/Modal.jsx` | project | 34 | 1.7 | UI component/page |
| 397 | `business-os-v2-dedicated-server/frontend/src/components/shared/navigationConfig.js` | project | 45 | 1.8 | UI component/page |
| 398 | `business-os-v2-dedicated-server/frontend/src/components/shared/PageHelpButton.jsx` | project | 76 | 3.2 | UI component/page |
| 399 | `business-os-v2-dedicated-server/frontend/src/components/shared/pageHelpContent.js` | project | 447 | 28.2 | UI component/page |
| 400 | `business-os-v2-dedicated-server/frontend/src/components/shared/PortalMenu.jsx` | project | 145 | 5.2 | UI component/page |
| 401 | `business-os-v2-dedicated-server/frontend/src/components/users/PermissionEditor.jsx` | project | 88 | 3.5 | UI component/page |
| 402 | `business-os-v2-dedicated-server/frontend/src/components/users/UserDetailSheet.jsx` | project | 103 | 5.0 | UI component/page |
| 403 | `business-os-v2-dedicated-server/frontend/src/components/users/UserProfileModal.jsx` | project | 579 | 29.1 | UI component/page |
| 404 | `business-os-v2-dedicated-server/frontend/src/components/users/Users.jsx` | project | 617 | 29.3 | UI component/page |
| 405 | `business-os-v2-dedicated-server/frontend/src/components/utils-settings/AuditLog.jsx` | project | 439 | 19.7 | UI component/page |
| 406 | `business-os-v2-dedicated-server/frontend/src/components/utils-settings/Backup.jsx` | project | 1146 | 50.6 | UI component/page |
| 407 | `business-os-v2-dedicated-server/frontend/src/components/utils-settings/FontFamilyPicker.jsx` | project | 59 | 2.9 | UI component/page |
| 408 | `business-os-v2-dedicated-server/frontend/src/components/utils-settings/index.js` | project | 12 | 0.7 | UI component/page |
| 409 | `business-os-v2-dedicated-server/frontend/src/components/utils-settings/OtpModal.jsx` | project | 127 | 6.6 | UI component/page |
| 410 | `business-os-v2-dedicated-server/frontend/src/components/utils-settings/ResetData.jsx` | project | 267 | 12.1 | UI component/page |
| 411 | `business-os-v2-dedicated-server/frontend/src/components/utils-settings/Settings.jsx` | project | 1205 | 53.4 | UI component/page |
| 412 | `business-os-v2-dedicated-server/frontend/src/constants.js` | project | 174 | 8.0 | Project source/support file |
| 413 | `business-os-v2-dedicated-server/frontend/src/index.jsx` | project | 81 | 2.4 | Project source/support file |
| 414 | `business-os-v2-dedicated-server/frontend/src/lang/en.json` | project | 1591 | 71.3 | Localization dictionary |
| 415 | `business-os-v2-dedicated-server/frontend/src/lang/km.json` | project | 1591 | 129.5 | Localization dictionary |
| 416 | `business-os-v2-dedicated-server/frontend/src/README.md` | project | 38 | 1.3 | Documentation |
| 417 | `business-os-v2-dedicated-server/frontend/src/styles/main.css` | project | 357 | 16.4 | Project source/support file |
| 418 | `business-os-v2-dedicated-server/frontend/src/utils/appRefresh.js` | project | 28 | 0.6 | Utility helper |
| 419 | `business-os-v2-dedicated-server/frontend/src/utils/csv.js` | project | 33 | 1.2 | Utility helper |
| 420 | `business-os-v2-dedicated-server/frontend/src/utils/dateHelpers.js` | project | 25 | 1.0 | Utility helper |
| 421 | `business-os-v2-dedicated-server/frontend/src/utils/deviceInfo.js` | project | 36 | 1.0 | Utility helper |
| 422 | `business-os-v2-dedicated-server/frontend/src/utils/favicon.js` | project | 61 | 1.8 | Utility helper |
| 423 | `business-os-v2-dedicated-server/frontend/src/utils/firebasePhoneAuth.js` | project | 21 | 0.5 | Utility helper |
| 424 | `business-os-v2-dedicated-server/frontend/src/utils/formatters.js` | project | 55 | 1.8 | Utility helper |
| 425 | `business-os-v2-dedicated-server/frontend/src/utils/index.js` | project | 10 | 0.5 | Utility helper |
| 426 | `business-os-v2-dedicated-server/frontend/src/utils/printReceipt.js` | project | 463 | 14.8 | Utility helper |
| 427 | `business-os-v2-dedicated-server/frontend/src/web-api.js` | project | 167 | 6.1 | Project source/support file |
| 428 | `business-os-v2-dedicated-server/frontend/tailwind.config.js` | project | 17 | 0.4 | Project source/support file |
| 429 | `business-os-v2-dedicated-server/frontend/tests/appShellUtils.test.mjs` | project | 41 | 1.3 | Project source/support file |
| 430 | `business-os-v2-dedicated-server/frontend/tests/portalEditorUtils.test.mjs` | project | 57 | 1.9 | Project source/support file |
| 431 | `business-os-v2-dedicated-server/frontend/vite.config.mjs` | project | 101 | 3.9 | Project source/support file |
| 432 | `business-os-v2-dedicated-server/README-organization-versions.md` | project | 120 | 3.5 | Documentation |
| 433 | `business-os-v2-dedicated-server/README.md` | project | 13 | 0.4 | Documentation |
| 434 | `business-os-v2-dedicated-server/setup.bat` | project | 259 | 11.2 | Project source/support file |
| 435 | `business-os-v2-dedicated-server/setup.sh` | project | 110 | 3.4 | Project source/support file |
| 436 | `business-os-v2-dedicated-server/start-server-release.bat` | project | 258 | 10.7 | Project source/support file |
| 437 | `business-os-v2-dedicated-server/start-server.bat` | project | 272 | 10.6 | Project source/support file |
| 438 | `business-os-v2-dedicated-server/start-server.sh` | project | 131 | 5.8 | Project source/support file |
| 439 | `business-os-v2-dedicated-server/stop-server-release.bat` | project | 124 | 4.6 | Project source/support file |
| 440 | `business-os-v2-dedicated-server/stop-server.bat` | project | 113 | 4.0 | Project source/support file |
| 441 | `business-os-v2-dedicated-server/stop-server.sh` | project | 69 | 2.2 | Project source/support file |
| 442 | `business-os-v2-dedicated-server/SUPABASE.md` | project | 13 | 0.2 | Documentation |
| 443 | `business-os-v3-centralized-server-template/backend/.env` | project | 35 | 1.5 | Project source/support file |
| 444 | `business-os-v3-centralized-server-template/backend/.npmrc` | project | 14 | 0.4 | Project source/support file |
| 445 | `business-os-v3-centralized-server-template/backend/leang-cosmetics-firebase-admins.json` | project | 14 | 2.3 | Configuration/data manifest |
| 446 | `business-os-v3-centralized-server-template/backend/package-lock.json` | project | 2362 | 80.4 | Configuration/data manifest |
| 447 | `business-os-v3-centralized-server-template/backend/package.json` | project | 53 | 1.8 | Configuration/data manifest |
| 448 | `business-os-v3-centralized-server-template/backend/server.js` | project | 256 | 8.3 | Backend server entrypoint |
| 449 | `business-os-v3-centralized-server-template/backend/src/accessControl.js` | project | 148 | 4.4 | Project source/support file |
| 450 | `business-os-v3-centralized-server-template/backend/src/backupSchema.js` | project | 101 | 2.1 | Project source/support file |
| 451 | `business-os-v3-centralized-server-template/backend/src/config.js` | project | 160 | 6.5 | Project source/support file |
| 452 | `business-os-v3-centralized-server-template/backend/src/database.js` | project | 1090 | 39.9 | Schema/migrations and DB bootstrap |
| 453 | `business-os-v3-centralized-server-template/backend/src/dataPath.js` | project | 199 | 5.7 | Project source/support file |
| 454 | `business-os-v3-centralized-server-template/backend/src/fileAssets.js` | project | 378 | 12.4 | Project source/support file |
| 455 | `business-os-v3-centralized-server-template/backend/src/helpers.js` | project | 477 | 16.9 | Project source/support file |
| 456 | `business-os-v3-centralized-server-template/backend/src/middleware.js` | project | 214 | 7.5 | Project source/support file |
| 457 | `business-os-v3-centralized-server-template/backend/src/netSecurity.js` | project | 115 | 3.1 | Project source/support file |
| 458 | `business-os-v3-centralized-server-template/backend/src/organizationContext.js` | project | 176 | 4.8 | Project source/support file |
| 459 | `business-os-v3-centralized-server-template/backend/src/portalUtils.js` | project | 87 | 2.3 | Project source/support file |
| 460 | `business-os-v3-centralized-server-template/backend/src/README.md` | project | 47 | 2.0 | Documentation |
| 461 | `business-os-v3-centralized-server-template/backend/src/requestContext.js` | project | 59 | 1.2 | Project source/support file |
| 462 | `business-os-v3-centralized-server-template/backend/src/routes/ai.js` | project | 249 | 7.9 | API route handler |
| 463 | `business-os-v3-centralized-server-template/backend/src/routes/auth.js` | project | 890 | 31.1 | API route handler |
| 464 | `business-os-v3-centralized-server-template/backend/src/routes/branches.js` | project | 196 | 8.2 | API route handler |
| 465 | `business-os-v3-centralized-server-template/backend/src/routes/catalog.js` | project | 83 | 2.2 | API route handler |
| 466 | `business-os-v3-centralized-server-template/backend/src/routes/categories.js` | project | 45 | 1.5 | API route handler |
| 467 | `business-os-v3-centralized-server-template/backend/src/routes/contacts.js` | project | 585 | 19.9 | API route handler |
| 468 | `business-os-v3-centralized-server-template/backend/src/routes/customTables.js` | project | 104 | 3.5 | API route handler |
| 469 | `business-os-v3-centralized-server-template/backend/src/routes/files.js` | project | 75 | 2.4 | API route handler |
| 470 | `business-os-v3-centralized-server-template/backend/src/routes/inventory.js` | project | 344 | 16.4 | API route handler |
| 471 | `business-os-v3-centralized-server-template/backend/src/routes/organizations.js` | project | 53 | 1.5 | API route handler |
| 472 | `business-os-v3-centralized-server-template/backend/src/routes/portal.js` | project | 802 | 30.7 | API route handler |
| 473 | `business-os-v3-centralized-server-template/backend/src/routes/products.js` | project | 767 | 34.3 | API route handler |
| 474 | `business-os-v3-centralized-server-template/backend/src/routes/README.md` | project | 36 | 1.4 | API route handler |
| 475 | `business-os-v3-centralized-server-template/backend/src/routes/returns.js` | project | 670 | 25.6 | API route handler |
| 476 | `business-os-v3-centralized-server-template/backend/src/routes/sales.js` | project | 1245 | 51.1 | API route handler |
| 477 | `business-os-v3-centralized-server-template/backend/src/routes/settings.js` | project | 34 | 0.9 | API route handler |
| 478 | `business-os-v3-centralized-server-template/backend/src/routes/system.js` | project | 1223 | 47.3 | API route handler |
| 479 | `business-os-v3-centralized-server-template/backend/src/routes/units.js` | project | 71 | 3.0 | API route handler |
| 480 | `business-os-v3-centralized-server-template/backend/src/routes/users.js` | project | 1015 | 41.2 | API route handler |
| 481 | `business-os-v3-centralized-server-template/backend/src/security.js` | project | 207 | 6.0 | Project source/support file |
| 482 | `business-os-v3-centralized-server-template/backend/src/serverUtils.js` | project | 196 | 6.4 | Project source/support file |
| 483 | `business-os-v3-centralized-server-template/backend/src/services/aiGateway.js` | project | 326 | 12.2 | Integration/service layer |
| 484 | `business-os-v3-centralized-server-template/backend/src/services/firebaseAuth.js` | project | 384 | 14.3 | Integration/service layer |
| 485 | `business-os-v3-centralized-server-template/backend/src/services/googleDriveSync.js` | project | 873 | 30.3 | Integration/service layer |
| 486 | `business-os-v3-centralized-server-template/backend/src/services/portalAi.js` | project | 511 | 18.9 | Integration/service layer |
| 487 | `business-os-v3-centralized-server-template/backend/src/services/README.md` | project | 29 | 1.1 | Integration/service layer |
| 488 | `business-os-v3-centralized-server-template/backend/src/services/supabaseAuth.js` | project | 551 | 20.6 | Integration/service layer |
| 489 | `business-os-v3-centralized-server-template/backend/src/services/verification.js` | project | 272 | 8.1 | Integration/service layer |
| 490 | `business-os-v3-centralized-server-template/backend/src/sessionAuth.js` | project | 151 | 4.5 | Project source/support file |
| 491 | `business-os-v3-centralized-server-template/backend/src/systemFsWorker.js` | project | 95 | 3.0 | Project source/support file |
| 492 | `business-os-v3-centralized-server-template/backend/src/uploadSecurity.js` | project | 87 | 3.5 | Project source/support file |
| 493 | `business-os-v3-centralized-server-template/backend/src/websocket.js` | project | 63 | 2.1 | Project source/support file |
| 494 | `business-os-v3-centralized-server-template/backend/temp-backup-roundtrip-4011/backend-test.env` | project | 2 | 0.0 | Project source/support file |
| 495 | `business-os-v3-centralized-server-template/backend/test/accessControl.test.js` | project | 103 | 3.0 | Project source/support file |
| 496 | `business-os-v3-centralized-server-template/backend/test/backupRoundtrip.test.js` | project | 323 | 10.8 | Project source/support file |
| 497 | `business-os-v3-centralized-server-template/backend/test/backupSchema.test.js` | project | 67 | 1.9 | Project source/support file |
| 498 | `business-os-v3-centralized-server-template/backend/test/dataPath.test.js` | project | 87 | 2.9 | Project source/support file |
| 499 | `business-os-v3-centralized-server-template/backend/test/netSecurity.test.js` | project | 45 | 1.5 | Project source/support file |
| 500 | `business-os-v3-centralized-server-template/backend/test/portalUtils.test.js` | project | 40 | 1.2 | Project source/support file |
| 501 | `business-os-v3-centralized-server-template/backend/test/serverUtils.test.js` | project | 81 | 2.4 | Project source/support file |
| 502 | `business-os-v3-centralized-server-template/backend/test/uploadSecurity.test.js` | project | 37 | 1.1 | Project source/support file |
| 503 | `business-os-v3-centralized-server-template/build-release-v3.bat` | project | 5 | 0.1 | Project source/support file |
| 504 | `business-os-v3-centralized-server-template/build-release.bat` | project | 544 | 20.8 | Project source/support file |
| 505 | `business-os-v3-centralized-server-template/frontend-dev.log` | project | 0 | 7.2 | Project source/support file |
| 506 | `business-os-v3-centralized-server-template/frontend/.npmrc` | project | 14 | 0.4 | Project source/support file |
| 507 | `business-os-v3-centralized-server-template/frontend/index.html` | project | 107 | 5.4 | Project source/support file |
| 508 | `business-os-v3-centralized-server-template/frontend/package-lock.json` | project | 3733 | 124.2 | Configuration/data manifest |
| 509 | `business-os-v3-centralized-server-template/frontend/package.json` | project | 30 | 0.8 | Configuration/data manifest |
| 510 | `business-os-v3-centralized-server-template/frontend/postcss.config.js` | project | 7 | 0.1 | Project source/support file |
| 511 | `business-os-v3-centralized-server-template/frontend/public/icon.png` | project | 0 | 11.4 | Project source/support file |
| 512 | `business-os-v3-centralized-server-template/frontend/public/manifest.json` | project | 17 | 0.3 | Configuration/data manifest |
| 513 | `business-os-v3-centralized-server-template/frontend/src/api/http.js` | project | 324 | 11.9 | Frontend API/sync helper |
| 514 | `business-os-v3-centralized-server-template/frontend/src/api/localDb.js` | project | 86 | 3.3 | Frontend API/sync helper |
| 515 | `business-os-v3-centralized-server-template/frontend/src/api/methods.js` | project | 800 | 43.3 | Frontend API/sync helper |
| 516 | `business-os-v3-centralized-server-template/frontend/src/api/websocket.js` | project | 119 | 4.0 | Frontend API/sync helper |
| 517 | `business-os-v3-centralized-server-template/frontend/src/App.jsx` | project | 537 | 16.7 | Main app shell and page mounting |
| 518 | `business-os-v3-centralized-server-template/frontend/src/app/appShellUtils.mjs` | project | 41 | 1.3 | Project source/support file |
| 519 | `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx` | project | 877 | 35.6 | Global app state/context provider |
| 520 | `business-os-v3-centralized-server-template/frontend/src/components/auth/Login.jsx` | project | 816 | 34.6 | UI component/page |
| 521 | `business-os-v3-centralized-server-template/frontend/src/components/branches/Branches.jsx` | project | 462 | 20.8 | UI component/page |
| 522 | `business-os-v3-centralized-server-template/frontend/src/components/branches/BranchForm.jsx` | project | 190 | 6.4 | UI component/page |
| 523 | `business-os-v3-centralized-server-template/frontend/src/components/branches/TransferModal.jsx` | project | 287 | 11.5 | UI component/page |
| 524 | `business-os-v3-centralized-server-template/frontend/src/components/catalog/CatalogPage.jsx` | project | 4258 | 233.3 | UI component/page |
| 525 | `business-os-v3-centralized-server-template/frontend/src/components/catalog/portalEditorUtils.mjs` | project | 99 | 2.8 | UI component/page |
| 526 | `business-os-v3-centralized-server-template/frontend/src/components/contacts/Contacts.jsx` | project | 197 | 7.4 | UI component/page |
| 527 | `business-os-v3-centralized-server-template/frontend/src/components/contacts/CustomersTab.jsx` | project | 428 | 21.2 | UI component/page |
| 528 | `business-os-v3-centralized-server-template/frontend/src/components/contacts/DeliveryTab.jsx` | project | 299 | 15.5 | UI component/page |
| 529 | `business-os-v3-centralized-server-template/frontend/src/components/contacts/shared.jsx` | project | 373 | 12.6 | UI component/page |
| 530 | `business-os-v3-centralized-server-template/frontend/src/components/contacts/SuppliersTab.jsx` | project | 263 | 12.9 | UI component/page |
| 531 | `business-os-v3-centralized-server-template/frontend/src/components/custom-tables/CustomTables.jsx` | project | 240 | 12.8 | UI component/page |
| 532 | `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/BarChart.jsx` | project | 99 | 4.3 | UI component/page |
| 533 | `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/DonutChart.jsx` | project | 83 | 3.8 | UI component/page |
| 534 | `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/index.js` | project | 6 | 0.4 | UI component/page |
| 535 | `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/LineChart.jsx` | project | 124 | 5.4 | UI component/page |
| 536 | `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/NoData.jsx` | project | 15 | 0.6 | UI component/page |
| 537 | `business-os-v3-centralized-server-template/frontend/src/components/dashboard/Dashboard.jsx` | project | 803 | 49.8 | UI component/page |
| 538 | `business-os-v3-centralized-server-template/frontend/src/components/dashboard/MiniStat.jsx` | project | 25 | 1.1 | UI component/page |
| 539 | `business-os-v3-centralized-server-template/frontend/src/components/files/FilePickerModal.jsx` | project | 211 | 8.5 | UI component/page |
| 540 | `business-os-v3-centralized-server-template/frontend/src/components/files/FilesPage.jsx` | project | 709 | 37.9 | UI component/page |
| 541 | `business-os-v3-centralized-server-template/frontend/src/components/inventory/DualMoney.jsx` | project | 14 | 0.6 | UI component/page |
| 542 | `business-os-v3-centralized-server-template/frontend/src/components/inventory/Inventory.jsx` | project | 1170 | 66.8 | UI component/page |
| 543 | `business-os-v3-centralized-server-template/frontend/src/components/inventory/movementGroups.js` | project | 106 | 4.6 | UI component/page |
| 544 | `business-os-v3-centralized-server-template/frontend/src/components/inventory/ProductDetailModal.jsx` | project | 106 | 6.9 | UI component/page |
| 545 | `business-os-v3-centralized-server-template/frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | project | 537 | 31.0 | UI component/page |
| 546 | `business-os-v3-centralized-server-template/frontend/src/components/navigation/Sidebar.jsx` | project | 341 | 15.0 | UI component/page |
| 547 | `business-os-v3-centralized-server-template/frontend/src/components/pos/CartItem.jsx` | project | 66 | 4.1 | UI component/page |
| 548 | `business-os-v3-centralized-server-template/frontend/src/components/pos/FilterPanel.jsx` | project | 224 | 7.4 | UI component/page |
| 549 | `business-os-v3-centralized-server-template/frontend/src/components/pos/POS.jsx` | project | 1394 | 83.3 | UI component/page |
| 550 | `business-os-v3-centralized-server-template/frontend/src/components/pos/ProductImage.jsx` | project | 31 | 1.2 | UI component/page |
| 551 | `business-os-v3-centralized-server-template/frontend/src/components/pos/QuickAddModal.jsx` | project | 30 | 1.7 | UI component/page |
| 552 | `business-os-v3-centralized-server-template/frontend/src/components/products/BranchStockAdjuster.jsx` | project | 91 | 3.4 | UI component/page |
| 553 | `business-os-v3-centralized-server-template/frontend/src/components/products/BulkAddStockModal.jsx` | project | 68 | 3.2 | UI component/page |
| 554 | `business-os-v3-centralized-server-template/frontend/src/components/products/BulkImportModal.jsx` | project | 482 | 23.0 | UI component/page |
| 555 | `business-os-v3-centralized-server-template/frontend/src/components/products/HeaderActions.jsx` | project | 108 | 3.8 | UI component/page |
| 556 | `business-os-v3-centralized-server-template/frontend/src/components/products/ManageBrandsModal.jsx` | project | 266 | 8.5 | UI component/page |
| 557 | `business-os-v3-centralized-server-template/frontend/src/components/products/ManageCategoriesModal.jsx` | project | 79 | 4.1 | UI component/page |
| 558 | `business-os-v3-centralized-server-template/frontend/src/components/products/ManageFieldsModal.jsx` | project | 73 | 4.3 | UI component/page |
| 559 | `business-os-v3-centralized-server-template/frontend/src/components/products/ManageMenu.jsx` | project | 22 | 0.9 | UI component/page |
| 560 | `business-os-v3-centralized-server-template/frontend/src/components/products/ManageUnitsModal.jsx` | project | 45 | 2.1 | UI component/page |
| 561 | `business-os-v3-centralized-server-template/frontend/src/components/products/primitives.jsx` | project | 114 | 4.3 | UI component/page |
| 562 | `business-os-v3-centralized-server-template/frontend/src/components/products/ProductDetailModal.jsx` | project | 144 | 6.6 | UI component/page |
| 563 | `business-os-v3-centralized-server-template/frontend/src/components/products/ProductForm.jsx` | project | 510 | 20.4 | UI component/page |
| 564 | `business-os-v3-centralized-server-template/frontend/src/components/products/Products.jsx` | project | 961 | 54.9 | UI component/page |
| 565 | `business-os-v3-centralized-server-template/frontend/src/components/products/VariantFormModal.jsx` | project | 100 | 6.5 | UI component/page |
| 566 | `business-os-v3-centralized-server-template/frontend/src/components/README.md` | project | 44 | 1.5 | UI component/page |
| 567 | `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | project | 93 | 3.8 | UI component/page |
| 568 | `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/constants.js` | project | 99 | 6.3 | UI component/page |
| 569 | `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/ErrorBoundary.jsx` | project | 28 | 0.9 | UI component/page |
| 570 | `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/FieldOrderManager.jsx` | project | 190 | 9.4 | UI component/page |
| 571 | `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/PrintSettings.jsx` | project | 201 | 9.9 | UI component/page |
| 572 | `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/ReceiptPreview.jsx` | project | 79 | 2.6 | UI component/page |
| 573 | `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/ReceiptSettings.jsx` | project | 369 | 22.2 | UI component/page |
| 574 | `business-os-v3-centralized-server-template/frontend/src/components/receipt/Receipt.jsx` | project | 410 | 19.0 | UI component/page |
| 575 | `business-os-v3-centralized-server-template/frontend/src/components/returns/EditReturnModal.jsx` | project | 226 | 12.1 | UI component/page |
| 576 | `business-os-v3-centralized-server-template/frontend/src/components/returns/NewReturnModal.jsx` | project | 447 | 25.4 | UI component/page |
| 577 | `business-os-v3-centralized-server-template/frontend/src/components/returns/NewSupplierReturnModal.jsx` | project | 335 | 17.7 | UI component/page |
| 578 | `business-os-v3-centralized-server-template/frontend/src/components/returns/ReturnDetailModal.jsx` | project | 132 | 6.8 | UI component/page |
| 579 | `business-os-v3-centralized-server-template/frontend/src/components/returns/Returns.jsx` | project | 340 | 16.1 | UI component/page |
| 580 | `business-os-v3-centralized-server-template/frontend/src/components/sales/ExportModal.jsx` | project | 238 | 10.6 | UI component/page |
| 581 | `business-os-v3-centralized-server-template/frontend/src/components/sales/SaleDetailModal.jsx` | project | 332 | 15.7 | UI component/page |
| 582 | `business-os-v3-centralized-server-template/frontend/src/components/sales/Sales.jsx` | project | 317 | 15.8 | UI component/page |
| 583 | `business-os-v3-centralized-server-template/frontend/src/components/sales/StatusBadge.jsx` | project | 47 | 1.6 | UI component/page |
| 584 | `business-os-v3-centralized-server-template/frontend/src/components/server/ServerPage.jsx` | project | 569 | 26.2 | UI component/page |
| 585 | `business-os-v3-centralized-server-template/frontend/src/components/shared/ImageGalleryLightbox.jsx` | project | 119 | 4.9 | UI component/page |
| 586 | `business-os-v3-centralized-server-template/frontend/src/components/shared/Modal.jsx` | project | 34 | 1.7 | UI component/page |
| 587 | `business-os-v3-centralized-server-template/frontend/src/components/shared/navigationConfig.js` | project | 45 | 1.8 | UI component/page |
| 588 | `business-os-v3-centralized-server-template/frontend/src/components/shared/PageHelpButton.jsx` | project | 76 | 3.2 | UI component/page |
| 589 | `business-os-v3-centralized-server-template/frontend/src/components/shared/pageHelpContent.js` | project | 447 | 28.2 | UI component/page |
| 590 | `business-os-v3-centralized-server-template/frontend/src/components/shared/PortalMenu.jsx` | project | 145 | 5.2 | UI component/page |
| 591 | `business-os-v3-centralized-server-template/frontend/src/components/users/PermissionEditor.jsx` | project | 88 | 3.5 | UI component/page |
| 592 | `business-os-v3-centralized-server-template/frontend/src/components/users/UserDetailSheet.jsx` | project | 103 | 5.0 | UI component/page |
| 593 | `business-os-v3-centralized-server-template/frontend/src/components/users/UserProfileModal.jsx` | project | 579 | 29.1 | UI component/page |
| 594 | `business-os-v3-centralized-server-template/frontend/src/components/users/Users.jsx` | project | 617 | 29.3 | UI component/page |
| 595 | `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/AuditLog.jsx` | project | 439 | 19.7 | UI component/page |
| 596 | `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/Backup.jsx` | project | 1146 | 50.6 | UI component/page |
| 597 | `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/FontFamilyPicker.jsx` | project | 59 | 2.9 | UI component/page |
| 598 | `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/index.js` | project | 12 | 0.7 | UI component/page |
| 599 | `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/OtpModal.jsx` | project | 127 | 6.6 | UI component/page |
| 600 | `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/ResetData.jsx` | project | 267 | 12.1 | UI component/page |
| 601 | `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/Settings.jsx` | project | 1205 | 53.4 | UI component/page |
| 602 | `business-os-v3-centralized-server-template/frontend/src/constants.js` | project | 174 | 8.0 | Project source/support file |
| 603 | `business-os-v3-centralized-server-template/frontend/src/index.jsx` | project | 81 | 2.4 | Project source/support file |
| 604 | `business-os-v3-centralized-server-template/frontend/src/lang/en.json` | project | 1591 | 71.3 | Localization dictionary |
| 605 | `business-os-v3-centralized-server-template/frontend/src/lang/km.json` | project | 1591 | 129.5 | Localization dictionary |
| 606 | `business-os-v3-centralized-server-template/frontend/src/README.md` | project | 38 | 1.3 | Documentation |
| 607 | `business-os-v3-centralized-server-template/frontend/src/styles/main.css` | project | 357 | 16.4 | Project source/support file |
| 608 | `business-os-v3-centralized-server-template/frontend/src/utils/appRefresh.js` | project | 28 | 0.6 | Utility helper |
| 609 | `business-os-v3-centralized-server-template/frontend/src/utils/csv.js` | project | 33 | 1.2 | Utility helper |
| 610 | `business-os-v3-centralized-server-template/frontend/src/utils/dateHelpers.js` | project | 25 | 1.0 | Utility helper |
| 611 | `business-os-v3-centralized-server-template/frontend/src/utils/deviceInfo.js` | project | 36 | 1.0 | Utility helper |
| 612 | `business-os-v3-centralized-server-template/frontend/src/utils/favicon.js` | project | 61 | 1.8 | Utility helper |
| 613 | `business-os-v3-centralized-server-template/frontend/src/utils/firebasePhoneAuth.js` | project | 21 | 0.5 | Utility helper |
| 614 | `business-os-v3-centralized-server-template/frontend/src/utils/formatters.js` | project | 55 | 1.8 | Utility helper |
| 615 | `business-os-v3-centralized-server-template/frontend/src/utils/index.js` | project | 10 | 0.5 | Utility helper |
| 616 | `business-os-v3-centralized-server-template/frontend/src/utils/printReceipt.js` | project | 463 | 14.8 | Utility helper |
| 617 | `business-os-v3-centralized-server-template/frontend/src/web-api.js` | project | 167 | 6.1 | Project source/support file |
| 618 | `business-os-v3-centralized-server-template/frontend/tailwind.config.js` | project | 17 | 0.4 | Project source/support file |
| 619 | `business-os-v3-centralized-server-template/frontend/tests/appShellUtils.test.mjs` | project | 41 | 1.3 | Project source/support file |
| 620 | `business-os-v3-centralized-server-template/frontend/tests/portalEditorUtils.test.mjs` | project | 57 | 1.9 | Project source/support file |
| 621 | `business-os-v3-centralized-server-template/frontend/vite.config.mjs` | project | 101 | 3.9 | Project source/support file |
| 622 | `business-os-v3-centralized-server-template/README-organization-versions.md` | project | 120 | 3.5 | Documentation |
| 623 | `business-os-v3-centralized-server-template/README.md` | project | 17 | 0.6 | Documentation |
| 624 | `business-os-v3-centralized-server-template/setup.bat` | project | 259 | 11.2 | Project source/support file |
| 625 | `business-os-v3-centralized-server-template/setup.sh` | project | 110 | 3.4 | Project source/support file |
| 626 | `business-os-v3-centralized-server-template/start-server-release.bat` | project | 258 | 10.7 | Project source/support file |
| 627 | `business-os-v3-centralized-server-template/start-server.bat` | project | 272 | 10.6 | Project source/support file |
| 628 | `business-os-v3-centralized-server-template/start-server.sh` | project | 131 | 5.8 | Project source/support file |
| 629 | `business-os-v3-centralized-server-template/stop-server-release.bat` | project | 124 | 4.6 | Project source/support file |
| 630 | `business-os-v3-centralized-server-template/stop-server.bat` | project | 113 | 4.0 | Project source/support file |
| 631 | `business-os-v3-centralized-server-template/stop-server.sh` | project | 69 | 2.2 | Project source/support file |
| 632 | `business-os-v3-centralized-server-template/SUPABASE.md` | project | 14 | 0.4 | Documentation |
| 633 | `clean-generated.bat` | project-root | 43 | 1.0 | Project source/support file |
| 634 | `clean-generated.ps1` | project-root | 56 | 1.5 | Project source/support file |
| 635 | `frontend/.npmrc` | frontend-root | 14 | 0.4 | Project source/support file |
| 636 | `frontend/index.html` | frontend-root | 107 | 5.4 | Project source/support file |
| 637 | `frontend/package-lock.json` | frontend-root | 3733 | 124.2 | Configuration/data manifest |
| 638 | `frontend/package.json` | frontend-root | 30 | 0.8 | Configuration/data manifest |
| 639 | `frontend/postcss.config.js` | frontend-root | 7 | 0.1 | Project source/support file |
| 640 | `frontend/public/icon.png` | frontend-root | 0 | 11.4 | Project source/support file |
| 641 | `frontend/public/manifest.json` | frontend-root | 17 | 0.3 | Configuration/data manifest |
| 642 | `frontend/src/api/http.js` | frontend-api | 324 | 11.9 | Frontend API/sync helper |
| 643 | `frontend/src/api/localDb.js` | frontend-api | 86 | 3.3 | Frontend API/sync helper |
| 644 | `frontend/src/api/methods.js` | frontend-api | 800 | 43.3 | Frontend API/sync helper |
| 645 | `frontend/src/api/README.md` | frontend-api | 26 | 0.8 | Frontend API/sync helper |
| 646 | `frontend/src/api/websocket.js` | frontend-api | 119 | 4.0 | Frontend API/sync helper |
| 647 | `frontend/src/App.jsx` | frontend-core | 560 | 17.5 | Main app shell and page mounting |
| 648 | `frontend/src/app/appShellUtils.mjs` | frontend-core | 41 | 1.3 | Project source/support file |
| 649 | `frontend/src/AppContext.jsx` | frontend-core | 877 | 35.6 | Global app state/context provider |
| 650 | `frontend/src/components/auth/Login.jsx` | frontend-ui | 816 | 34.6 | UI component/page |
| 651 | `frontend/src/components/branches/Branches.jsx` | frontend-ui | 462 | 20.8 | UI component/page |
| 652 | `frontend/src/components/branches/BranchForm.jsx` | frontend-ui | 190 | 6.4 | UI component/page |
| 653 | `frontend/src/components/branches/TransferModal.jsx` | frontend-ui | 287 | 11.5 | UI component/page |
| 654 | `frontend/src/components/catalog/CatalogPage.jsx` | frontend-ui | 4258 | 233.3 | UI component/page |
| 655 | `frontend/src/components/catalog/portalEditorUtils.mjs` | frontend-ui | 99 | 2.8 | UI component/page |
| 656 | `frontend/src/components/contacts/Contacts.jsx` | frontend-ui | 197 | 7.4 | UI component/page |
| 657 | `frontend/src/components/contacts/CustomersTab.jsx` | frontend-ui | 428 | 21.2 | UI component/page |
| 658 | `frontend/src/components/contacts/DeliveryTab.jsx` | frontend-ui | 299 | 15.5 | UI component/page |
| 659 | `frontend/src/components/contacts/shared.jsx` | frontend-ui | 373 | 12.6 | UI component/page |
| 660 | `frontend/src/components/contacts/SuppliersTab.jsx` | frontend-ui | 263 | 12.9 | UI component/page |
| 661 | `frontend/src/components/custom-tables/CustomTables.jsx` | frontend-ui | 240 | 12.8 | UI component/page |
| 662 | `frontend/src/components/dashboard/charts/BarChart.jsx` | frontend-ui | 99 | 4.3 | UI component/page |
| 663 | `frontend/src/components/dashboard/charts/DonutChart.jsx` | frontend-ui | 83 | 3.8 | UI component/page |
| 664 | `frontend/src/components/dashboard/charts/index.js` | frontend-ui | 6 | 0.4 | UI component/page |
| 665 | `frontend/src/components/dashboard/charts/LineChart.jsx` | frontend-ui | 124 | 5.4 | UI component/page |
| 666 | `frontend/src/components/dashboard/charts/NoData.jsx` | frontend-ui | 15 | 0.6 | UI component/page |
| 667 | `frontend/src/components/dashboard/Dashboard.jsx` | frontend-ui | 803 | 49.8 | UI component/page |
| 668 | `frontend/src/components/dashboard/MiniStat.jsx` | frontend-ui | 25 | 1.1 | UI component/page |
| 669 | `frontend/src/components/files/FilePickerModal.jsx` | frontend-ui | 211 | 8.5 | UI component/page |
| 670 | `frontend/src/components/files/FilesPage.jsx` | frontend-ui | 709 | 37.9 | UI component/page |
| 671 | `frontend/src/components/inventory/DualMoney.jsx` | frontend-ui | 14 | 0.6 | UI component/page |
| 672 | `frontend/src/components/inventory/Inventory.jsx` | frontend-ui | 1170 | 66.8 | UI component/page |
| 673 | `frontend/src/components/inventory/movementGroups.js` | frontend-ui | 106 | 4.6 | UI component/page |
| 674 | `frontend/src/components/inventory/ProductDetailModal.jsx` | frontend-ui | 106 | 6.9 | UI component/page |
| 675 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | frontend-ui | 537 | 31.0 | UI component/page |
| 676 | `frontend/src/components/navigation/Sidebar.jsx` | frontend-ui | 341 | 15.0 | UI component/page |
| 677 | `frontend/src/components/pos/CartItem.jsx` | frontend-ui | 66 | 4.1 | UI component/page |
| 678 | `frontend/src/components/pos/FilterPanel.jsx` | frontend-ui | 224 | 7.4 | UI component/page |
| 679 | `frontend/src/components/pos/POS.jsx` | frontend-ui | 1394 | 83.3 | UI component/page |
| 680 | `frontend/src/components/pos/ProductImage.jsx` | frontend-ui | 31 | 1.2 | UI component/page |
| 681 | `frontend/src/components/pos/QuickAddModal.jsx` | frontend-ui | 30 | 1.7 | UI component/page |
| 682 | `frontend/src/components/products/BranchStockAdjuster.jsx` | frontend-ui | 91 | 3.4 | UI component/page |
| 683 | `frontend/src/components/products/BulkAddStockModal.jsx` | frontend-ui | 68 | 3.2 | UI component/page |
| 684 | `frontend/src/components/products/BulkImportModal.jsx` | frontend-ui | 482 | 23.0 | UI component/page |
| 685 | `frontend/src/components/products/HeaderActions.jsx` | frontend-ui | 108 | 3.8 | UI component/page |
| 686 | `frontend/src/components/products/ManageBrandsModal.jsx` | frontend-ui | 266 | 8.5 | UI component/page |
| 687 | `frontend/src/components/products/ManageCategoriesModal.jsx` | frontend-ui | 79 | 4.1 | UI component/page |
| 688 | `frontend/src/components/products/ManageFieldsModal.jsx` | frontend-ui | 73 | 4.3 | UI component/page |
| 689 | `frontend/src/components/products/ManageMenu.jsx` | frontend-ui | 22 | 0.9 | UI component/page |
| 690 | `frontend/src/components/products/ManageUnitsModal.jsx` | frontend-ui | 45 | 2.1 | UI component/page |
| 691 | `frontend/src/components/products/primitives.jsx` | frontend-ui | 114 | 4.3 | UI component/page |
| 692 | `frontend/src/components/products/ProductDetailModal.jsx` | frontend-ui | 144 | 6.6 | UI component/page |
| 693 | `frontend/src/components/products/ProductForm.jsx` | frontend-ui | 510 | 20.4 | UI component/page |
| 694 | `frontend/src/components/products/Products.jsx` | frontend-ui | 961 | 54.9 | UI component/page |
| 695 | `frontend/src/components/products/VariantFormModal.jsx` | frontend-ui | 100 | 6.5 | UI component/page |
| 696 | `frontend/src/components/README.md` | frontend-ui | 37 | 1.9 | UI component/page |
| 697 | `frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | frontend-ui | 93 | 3.8 | UI component/page |
| 698 | `frontend/src/components/receipt-settings/constants.js` | frontend-ui | 99 | 6.3 | UI component/page |
| 699 | `frontend/src/components/receipt-settings/ErrorBoundary.jsx` | frontend-ui | 28 | 0.9 | UI component/page |
| 700 | `frontend/src/components/receipt-settings/FieldOrderManager.jsx` | frontend-ui | 190 | 9.4 | UI component/page |
| 701 | `frontend/src/components/receipt-settings/PrintSettings.jsx` | frontend-ui | 201 | 9.9 | UI component/page |
| 702 | `frontend/src/components/receipt-settings/ReceiptPreview.jsx` | frontend-ui | 79 | 2.6 | UI component/page |
| 703 | `frontend/src/components/receipt-settings/ReceiptSettings.jsx` | frontend-ui | 369 | 22.2 | UI component/page |
| 704 | `frontend/src/components/receipt/Receipt.jsx` | frontend-ui | 410 | 19.0 | UI component/page |
| 705 | `frontend/src/components/returns/EditReturnModal.jsx` | frontend-ui | 226 | 12.1 | UI component/page |
| 706 | `frontend/src/components/returns/NewReturnModal.jsx` | frontend-ui | 447 | 25.4 | UI component/page |
| 707 | `frontend/src/components/returns/NewSupplierReturnModal.jsx` | frontend-ui | 335 | 17.7 | UI component/page |
| 708 | `frontend/src/components/returns/ReturnDetailModal.jsx` | frontend-ui | 132 | 6.8 | UI component/page |
| 709 | `frontend/src/components/returns/Returns.jsx` | frontend-ui | 340 | 16.1 | UI component/page |
| 710 | `frontend/src/components/sales/ExportModal.jsx` | frontend-ui | 238 | 10.6 | UI component/page |
| 711 | `frontend/src/components/sales/SaleDetailModal.jsx` | frontend-ui | 332 | 15.7 | UI component/page |
| 712 | `frontend/src/components/sales/Sales.jsx` | frontend-ui | 317 | 15.8 | UI component/page |
| 713 | `frontend/src/components/sales/StatusBadge.jsx` | frontend-ui | 47 | 1.6 | UI component/page |
| 714 | `frontend/src/components/server/ServerPage.jsx` | frontend-ui | 569 | 26.2 | UI component/page |
| 715 | `frontend/src/components/shared/ImageGalleryLightbox.jsx` | frontend-ui | 119 | 4.9 | UI component/page |
| 716 | `frontend/src/components/shared/Modal.jsx` | frontend-ui | 34 | 1.7 | UI component/page |
| 717 | `frontend/src/components/shared/navigationConfig.js` | frontend-ui | 45 | 1.8 | UI component/page |
| 718 | `frontend/src/components/shared/PageHelpButton.jsx` | frontend-ui | 76 | 3.2 | UI component/page |
| 719 | `frontend/src/components/shared/pageHelpContent.js` | frontend-ui | 447 | 28.2 | UI component/page |
| 720 | `frontend/src/components/shared/PortalMenu.jsx` | frontend-ui | 145 | 5.2 | UI component/page |
| 721 | `frontend/src/components/users/PermissionEditor.jsx` | frontend-ui | 88 | 3.5 | UI component/page |
| 722 | `frontend/src/components/users/UserDetailSheet.jsx` | frontend-ui | 103 | 5.0 | UI component/page |
| 723 | `frontend/src/components/users/UserProfileModal.jsx` | frontend-ui | 579 | 29.1 | UI component/page |
| 724 | `frontend/src/components/users/Users.jsx` | frontend-ui | 617 | 29.3 | UI component/page |
| 725 | `frontend/src/components/utils-settings/AuditLog.jsx` | frontend-ui | 439 | 19.7 | UI component/page |
| 726 | `frontend/src/components/utils-settings/Backup.jsx` | frontend-ui | 1146 | 50.6 | UI component/page |
| 727 | `frontend/src/components/utils-settings/FontFamilyPicker.jsx` | frontend-ui | 59 | 2.9 | UI component/page |
| 728 | `frontend/src/components/utils-settings/index.js` | frontend-ui | 12 | 0.7 | UI component/page |
| 729 | `frontend/src/components/utils-settings/OtpModal.jsx` | frontend-ui | 127 | 6.6 | UI component/page |
| 730 | `frontend/src/components/utils-settings/ResetData.jsx` | frontend-ui | 267 | 12.1 | UI component/page |
| 731 | `frontend/src/components/utils-settings/Settings.jsx` | frontend-ui | 1205 | 53.4 | UI component/page |
| 732 | `frontend/src/constants.js` | frontend-core | 174 | 8.0 | Project source/support file |
| 733 | `frontend/src/index.jsx` | frontend-core | 81 | 2.4 | Project source/support file |
| 734 | `frontend/src/lang/en.json` | frontend-i18n | 1592 | 71.4 | Localization dictionary |
| 735 | `frontend/src/lang/km.json` | frontend-i18n | 1592 | 129.6 | Localization dictionary |
| 736 | `frontend/src/README.md` | frontend-core | 38 | 1.3 | Documentation |
| 737 | `frontend/src/styles/main.css` | frontend-style | 357 | 16.4 | Project source/support file |
| 738 | `frontend/src/utils/appRefresh.js` | frontend-utils | 28 | 0.6 | Utility helper |
| 739 | `frontend/src/utils/csv.js` | frontend-utils | 33 | 1.2 | Utility helper |
| 740 | `frontend/src/utils/dateHelpers.js` | frontend-utils | 25 | 1.0 | Utility helper |
| 741 | `frontend/src/utils/deviceInfo.js` | frontend-utils | 36 | 1.0 | Utility helper |
| 742 | `frontend/src/utils/favicon.js` | frontend-utils | 61 | 1.8 | Utility helper |
| 743 | `frontend/src/utils/firebasePhoneAuth.js` | frontend-utils | 21 | 0.5 | Utility helper |
| 744 | `frontend/src/utils/formatters.js` | frontend-utils | 55 | 1.8 | Utility helper |
| 745 | `frontend/src/utils/index.js` | frontend-utils | 10 | 0.5 | Utility helper |
| 746 | `frontend/src/utils/printReceipt.js` | frontend-utils | 463 | 14.8 | Utility helper |
| 747 | `frontend/src/web-api.js` | frontend-core | 167 | 6.1 | Project source/support file |
| 748 | `frontend/tailwind.config.js` | frontend-root | 17 | 0.4 | Project source/support file |
| 749 | `frontend/tests/appShellUtils.test.mjs` | frontend-root | 41 | 1.3 | Project source/support file |
| 750 | `frontend/tests/portalEditorUtils.test.mjs` | frontend-root | 57 | 1.9 | Project source/support file |
| 751 | `frontend/vite.config.mjs` | frontend-root | 109 | 4.4 | Project source/support file |
| 752 | `ops/scripts/backend/verify-data-integrity.js` | project-scripts | 233 | 7.9 | Project source/support file |
| 753 | `ops/scripts/frontend/verify-i18n.js` | project-scripts | 131 | 3.8 | Project source/support file |
| 754 | `ops/scripts/generate-doc-reference.js` | project-scripts | 465 | 15.3 | Project source/support file |
| 755 | `ops/scripts/generate-full-project-docs.js` | project-scripts | 637 | 22.5 | Project source/support file |
| 756 | `ops/scripts/lib/fs-utils.js` | project-scripts | 122 | 2.8 | Project source/support file |
| 757 | `ops/scripts/performance-scan.js` | project-scripts | 136 | 4.1 | Project source/support file |
| 758 | `ops/scripts/sync-firebase-release-env.ps1` | project-scripts | 55 | 1.7 | Project source/support file |
| 759 | `README-build.md` | project-root | 4 | 0.1 | Project documentation entrypoint |
| 760 | `README.md` | project-root | 6 | 0.2 | Project documentation entrypoint |
| 761 | `setup.bat` | project-root | 280 | 11.7 | Environment setup script |
| 762 | `setup.sh` | project-root | 110 | 3.4 | Environment setup script |
| 763 | `start-server-release.bat` | project-root | 258 | 10.7 | Server lifecycle launcher script |
| 764 | `start-server.bat` | project-root | 272 | 10.6 | Server lifecycle launcher script |
| 765 | `start-server.sh` | project-root | 131 | 5.8 | Server lifecycle launcher script |
| 766 | `stop-server-release.bat` | project-root | 124 | 4.6 | Server lifecycle launcher script |
| 767 | `stop-server.bat` | project-root | 113 | 4.0 | Server lifecycle launcher script |
| 768 | `stop-server.sh` | project-root | 69 | 2.2 | Server lifecycle launcher script |
