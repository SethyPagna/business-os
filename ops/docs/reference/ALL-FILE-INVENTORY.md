# All File Inventory (Project First-Party Files)

Auto-generated file-level commentary for all first-party project files (frontend, backend, scripts, and root run/config files; excluding dependencies/build artifacts).

## 1. Coverage Summary

Total files documented: **180**

## 2. File Commentary Matrix

| No. | File | Category | Lines | Size (KB) | Purpose |
|---:|---|---|---:|---:|---|
| 1 | `.npmrc` | project-root | 14 | 0.4 | Project source/support file |
| 2 | `backend/.env` | backend-root | 33 | 0.9 | Project source/support file |
| 3 | `backend/.npmrc` | backend-root | 14 | 0.4 | Project source/support file |
| 4 | `backend/leang-cosmetics-firebase-admins.json` | backend-root | 14 | 2.3 | Configuration/data manifest |
| 5 | `backend/package-lock.json` | backend-root | 2362 | 80.4 | Configuration/data manifest |
| 6 | `backend/package.json` | backend-root | 53 | 1.7 | Configuration/data manifest |
| 7 | `backend/server.js` | backend-root | 234 | 7.3 | Backend server entrypoint |
| 8 | `backend/src/backupSchema.js` | backend-core | 101 | 2.1 | Project source/support file |
| 9 | `backend/src/config.js` | backend-core | 160 | 6.5 | Project source/support file |
| 10 | `backend/src/database.js` | backend-core | 792 | 30.1 | Schema/migrations and DB bootstrap |
| 11 | `backend/src/dataPath.js` | backend-core | 198 | 5.6 | Project source/support file |
| 12 | `backend/src/fileAssets.js` | backend-core | 376 | 12.2 | Project source/support file |
| 13 | `backend/src/helpers.js` | backend-core | 473 | 16.8 | Project source/support file |
| 14 | `backend/src/middleware.js` | backend-core | 168 | 5.9 | Project source/support file |
| 15 | `backend/src/portalUtils.js` | backend-core | 87 | 2.3 | Project source/support file |
| 16 | `backend/src/README.md` | backend-core | 47 | 2.0 | Documentation |
| 17 | `backend/src/requestContext.js` | backend-core | 59 | 1.2 | Project source/support file |
| 18 | `backend/src/routes/auth.js` | backend-routes | 578 | 21.7 | API route handler |
| 19 | `backend/src/routes/branches.js` | backend-routes | 196 | 8.2 | API route handler |
| 20 | `backend/src/routes/catalog.js` | backend-routes | 83 | 2.2 | API route handler |
| 21 | `backend/src/routes/categories.js` | backend-routes | 45 | 1.5 | API route handler |
| 22 | `backend/src/routes/contacts.js` | backend-routes | 585 | 19.9 | API route handler |
| 23 | `backend/src/routes/customTables.js` | backend-routes | 104 | 3.5 | API route handler |
| 24 | `backend/src/routes/files.js` | backend-routes | 75 | 2.3 | API route handler |
| 25 | `backend/src/routes/inventory.js` | backend-routes | 344 | 16.4 | API route handler |
| 26 | `backend/src/routes/portal.js` | backend-routes | 613 | 22.6 | API route handler |
| 27 | `backend/src/routes/products.js` | backend-routes | 766 | 34.0 | API route handler |
| 28 | `backend/src/routes/README.md` | backend-routes | 36 | 1.4 | API route handler |
| 29 | `backend/src/routes/returns.js` | backend-routes | 670 | 25.6 | API route handler |
| 30 | `backend/src/routes/sales.js` | backend-routes | 1245 | 51.1 | API route handler |
| 31 | `backend/src/routes/settings.js` | backend-routes | 34 | 0.9 | API route handler |
| 32 | `backend/src/routes/system.js` | backend-routes | 1007 | 38.9 | API route handler |
| 33 | `backend/src/routes/units.js` | backend-routes | 71 | 3.0 | API route handler |
| 34 | `backend/src/routes/users.js` | backend-routes | 757 | 29.8 | API route handler |
| 35 | `backend/src/security.js` | backend-core | 207 | 6.0 | Project source/support file |
| 36 | `backend/src/serverUtils.js` | backend-core | 129 | 3.7 | Project source/support file |
| 37 | `backend/src/services/firebaseAuth.js` | backend-services | 384 | 14.3 | Integration/service layer |
| 38 | `backend/src/services/README.md` | backend-services | 26 | 0.9 | Integration/service layer |
| 39 | `backend/src/services/verification.js` | backend-services | 308 | 9.4 | Integration/service layer |
| 40 | `backend/src/websocket.js` | backend-core | 64 | 2.3 | Project source/support file |
| 41 | `backend/temp-backup-roundtrip-4011/backend-test.env` | backend-root | 2 | 0.0 | Project source/support file |
| 42 | `backend/test/backupRoundtrip.test.js` | backend-root | 290 | 9.6 | Project source/support file |
| 43 | `backend/test/backupSchema.test.js` | backend-root | 67 | 1.9 | Project source/support file |
| 44 | `backend/test/dataPath.test.js` | backend-root | 85 | 2.6 | Project source/support file |
| 45 | `backend/test/portalUtils.test.js` | backend-root | 40 | 1.2 | Project source/support file |
| 46 | `backend/test/serverUtils.test.js` | backend-root | 76 | 2.2 | Project source/support file |
| 47 | `build-release.bat` | project-root | 539 | 19.7 | Release build orchestration script |
| 48 | `frontend/.npmrc` | frontend-root | 14 | 0.4 | Project source/support file |
| 49 | `frontend/index.html` | frontend-root | 75 | 4.1 | Project source/support file |
| 50 | `frontend/package-lock.json` | frontend-root | 3733 | 124.2 | Configuration/data manifest |
| 51 | `frontend/package.json` | frontend-root | 30 | 0.8 | Configuration/data manifest |
| 52 | `frontend/postcss.config.js` | frontend-root | 7 | 0.1 | Project source/support file |
| 53 | `frontend/public/icon.png` | frontend-root | 0 | 11.4 | Project source/support file |
| 54 | `frontend/public/manifest.json` | frontend-root | 17 | 0.3 | Configuration/data manifest |
| 55 | `frontend/src/api/http.js` | frontend-api | 264 | 10.0 | Frontend API/sync helper |
| 56 | `frontend/src/api/localDb.js` | frontend-api | 86 | 3.3 | Frontend API/sync helper |
| 57 | `frontend/src/api/methods.js` | frontend-api | 652 | 37.6 | Frontend API/sync helper |
| 58 | `frontend/src/api/websocket.js` | frontend-api | 108 | 3.6 | Frontend API/sync helper |
| 59 | `frontend/src/App.jsx` | frontend-core | 405 | 12.9 | Main app shell and page mounting |
| 60 | `frontend/src/app/appShellUtils.mjs` | frontend-core | 41 | 1.3 | Project source/support file |
| 61 | `frontend/src/AppContext.jsx` | frontend-core | 610 | 26.4 | Global app state/context provider |
| 62 | `frontend/src/components/auth/Login.jsx` | frontend-ui | 524 | 24.3 | UI component/page |
| 63 | `frontend/src/components/branches/Branches.jsx` | frontend-ui | 453 | 20.2 | UI component/page |
| 64 | `frontend/src/components/branches/BranchForm.jsx` | frontend-ui | 190 | 6.4 | UI component/page |
| 65 | `frontend/src/components/branches/TransferModal.jsx` | frontend-ui | 287 | 11.5 | UI component/page |
| 66 | `frontend/src/components/catalog/CatalogPage.jsx` | frontend-ui | 3426 | 188.6 | UI component/page |
| 67 | `frontend/src/components/catalog/portalEditorUtils.mjs` | frontend-ui | 98 | 2.7 | UI component/page |
| 68 | `frontend/src/components/contacts/Contacts.jsx` | frontend-ui | 197 | 7.5 | UI component/page |
| 69 | `frontend/src/components/contacts/CustomersTab.jsx` | frontend-ui | 415 | 20.5 | UI component/page |
| 70 | `frontend/src/components/contacts/DeliveryTab.jsx` | frontend-ui | 286 | 14.8 | UI component/page |
| 71 | `frontend/src/components/contacts/shared.jsx` | frontend-ui | 372 | 12.5 | UI component/page |
| 72 | `frontend/src/components/contacts/SuppliersTab.jsx` | frontend-ui | 252 | 12.4 | UI component/page |
| 73 | `frontend/src/components/custom-tables/CustomTables.jsx` | frontend-ui | 240 | 12.8 | UI component/page |
| 74 | `frontend/src/components/dashboard/charts/BarChart.jsx` | frontend-ui | 99 | 4.3 | UI component/page |
| 75 | `frontend/src/components/dashboard/charts/DonutChart.jsx` | frontend-ui | 83 | 3.8 | UI component/page |
| 76 | `frontend/src/components/dashboard/charts/index.js` | frontend-ui | 6 | 0.4 | UI component/page |
| 77 | `frontend/src/components/dashboard/charts/LineChart.jsx` | frontend-ui | 124 | 5.4 | UI component/page |
| 78 | `frontend/src/components/dashboard/charts/NoData.jsx` | frontend-ui | 15 | 0.6 | UI component/page |
| 79 | `frontend/src/components/dashboard/Dashboard.jsx` | frontend-ui | 796 | 49.3 | UI component/page |
| 80 | `frontend/src/components/dashboard/MiniStat.jsx` | frontend-ui | 25 | 1.1 | UI component/page |
| 81 | `frontend/src/components/files/FilePickerModal.jsx` | frontend-ui | 211 | 8.5 | UI component/page |
| 82 | `frontend/src/components/files/FilesPage.jsx` | frontend-ui | 129 | 5.7 | UI component/page |
| 83 | `frontend/src/components/inventory/DualMoney.jsx` | frontend-ui | 14 | 0.6 | UI component/page |
| 84 | `frontend/src/components/inventory/Inventory.jsx` | frontend-ui | 1167 | 65.9 | UI component/page |
| 85 | `frontend/src/components/inventory/movementGroups.js` | frontend-ui | 106 | 4.6 | UI component/page |
| 86 | `frontend/src/components/inventory/ProductDetailModal.jsx` | frontend-ui | 106 | 6.9 | UI component/page |
| 87 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | frontend-ui | 535 | 30.6 | UI component/page |
| 88 | `frontend/src/components/navigation/Sidebar.jsx` | frontend-ui | 341 | 15.0 | UI component/page |
| 89 | `frontend/src/components/pos/CartItem.jsx` | frontend-ui | 66 | 4.1 | UI component/page |
| 90 | `frontend/src/components/pos/FilterPanel.jsx` | frontend-ui | 224 | 7.4 | UI component/page |
| 91 | `frontend/src/components/pos/POS.jsx` | frontend-ui | 1553 | 91.3 | UI component/page |
| 92 | `frontend/src/components/pos/ProductImage.jsx` | frontend-ui | 31 | 1.2 | UI component/page |
| 93 | `frontend/src/components/pos/QuickAddModal.jsx` | frontend-ui | 30 | 1.7 | UI component/page |
| 94 | `frontend/src/components/products/BranchStockAdjuster.jsx` | frontend-ui | 91 | 3.4 | UI component/page |
| 95 | `frontend/src/components/products/BulkAddStockModal.jsx` | frontend-ui | 68 | 3.2 | UI component/page |
| 96 | `frontend/src/components/products/BulkImportModal.jsx` | frontend-ui | 482 | 23.0 | UI component/page |
| 97 | `frontend/src/components/products/HeaderActions.jsx` | frontend-ui | 96 | 2.6 | UI component/page |
| 98 | `frontend/src/components/products/ManageBrandsModal.jsx` | frontend-ui | 266 | 8.5 | UI component/page |
| 99 | `frontend/src/components/products/ManageCategoriesModal.jsx` | frontend-ui | 79 | 4.1 | UI component/page |
| 100 | `frontend/src/components/products/ManageFieldsModal.jsx` | frontend-ui | 73 | 4.3 | UI component/page |
| 101 | `frontend/src/components/products/ManageMenu.jsx` | frontend-ui | 22 | 0.9 | UI component/page |
| 102 | `frontend/src/components/products/ManageUnitsModal.jsx` | frontend-ui | 45 | 2.1 | UI component/page |
| 103 | `frontend/src/components/products/primitives.jsx` | frontend-ui | 114 | 4.3 | UI component/page |
| 104 | `frontend/src/components/products/ProductDetailModal.jsx` | frontend-ui | 144 | 6.6 | UI component/page |
| 105 | `frontend/src/components/products/ProductForm.jsx` | frontend-ui | 510 | 20.4 | UI component/page |
| 106 | `frontend/src/components/products/Products.jsx` | frontend-ui | 955 | 54.6 | UI component/page |
| 107 | `frontend/src/components/products/VariantFormModal.jsx` | frontend-ui | 100 | 6.5 | UI component/page |
| 108 | `frontend/src/components/README.md` | frontend-ui | 44 | 1.5 | UI component/page |
| 109 | `frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | frontend-ui | 105 | 4.7 | UI component/page |
| 110 | `frontend/src/components/receipt-settings/constants.js` | frontend-ui | 100 | 6.5 | UI component/page |
| 111 | `frontend/src/components/receipt-settings/ErrorBoundary.jsx` | frontend-ui | 28 | 0.9 | UI component/page |
| 112 | `frontend/src/components/receipt-settings/FieldOrderManager.jsx` | frontend-ui | 190 | 9.4 | UI component/page |
| 113 | `frontend/src/components/receipt-settings/PrintSettings.jsx` | frontend-ui | 201 | 9.9 | UI component/page |
| 114 | `frontend/src/components/receipt-settings/ReceiptPreview.jsx` | frontend-ui | 79 | 2.6 | UI component/page |
| 115 | `frontend/src/components/receipt-settings/ReceiptSettings.jsx` | frontend-ui | 382 | 22.6 | UI component/page |
| 116 | `frontend/src/components/receipt/Receipt.jsx` | frontend-ui | 410 | 19.0 | UI component/page |
| 117 | `frontend/src/components/returns/EditReturnModal.jsx` | frontend-ui | 226 | 12.1 | UI component/page |
| 118 | `frontend/src/components/returns/NewReturnModal.jsx` | frontend-ui | 447 | 25.4 | UI component/page |
| 119 | `frontend/src/components/returns/NewSupplierReturnModal.jsx` | frontend-ui | 335 | 17.7 | UI component/page |
| 120 | `frontend/src/components/returns/ReturnDetailModal.jsx` | frontend-ui | 132 | 6.8 | UI component/page |
| 121 | `frontend/src/components/returns/Returns.jsx` | frontend-ui | 329 | 15.3 | UI component/page |
| 122 | `frontend/src/components/sales/ExportModal.jsx` | frontend-ui | 191 | 9.8 | UI component/page |
| 123 | `frontend/src/components/sales/SaleDetailModal.jsx` | frontend-ui | 332 | 15.7 | UI component/page |
| 124 | `frontend/src/components/sales/Sales.jsx` | frontend-ui | 302 | 15.6 | UI component/page |
| 125 | `frontend/src/components/sales/StatusBadge.jsx` | frontend-ui | 47 | 1.6 | UI component/page |
| 126 | `frontend/src/components/server/ServerPage.jsx` | frontend-ui | 587 | 26.5 | UI component/page |
| 127 | `frontend/src/components/shared/ImageGalleryLightbox.jsx` | frontend-ui | 119 | 4.9 | UI component/page |
| 128 | `frontend/src/components/shared/Modal.jsx` | frontend-ui | 34 | 1.7 | UI component/page |
| 129 | `frontend/src/components/shared/navigationConfig.js` | frontend-ui | 45 | 1.8 | UI component/page |
| 130 | `frontend/src/components/shared/PageHelpButton.jsx` | frontend-ui | 76 | 3.2 | UI component/page |
| 131 | `frontend/src/components/shared/pageHelpContent.js` | frontend-ui | 447 | 28.2 | UI component/page |
| 132 | `frontend/src/components/shared/PortalMenu.jsx` | frontend-ui | 145 | 5.2 | UI component/page |
| 133 | `frontend/src/components/users/PermissionEditor.jsx` | frontend-ui | 88 | 3.5 | UI component/page |
| 134 | `frontend/src/components/users/UserDetailSheet.jsx` | frontend-ui | 103 | 5.0 | UI component/page |
| 135 | `frontend/src/components/users/UserProfileModal.jsx` | frontend-ui | 502 | 23.5 | UI component/page |
| 136 | `frontend/src/components/users/Users.jsx` | frontend-ui | 611 | 28.8 | UI component/page |
| 137 | `frontend/src/components/utils-settings/AuditLog.jsx` | frontend-ui | 436 | 19.6 | UI component/page |
| 138 | `frontend/src/components/utils-settings/Backup.jsx` | frontend-ui | 693 | 33.3 | UI component/page |
| 139 | `frontend/src/components/utils-settings/FontFamilyPicker.jsx` | frontend-ui | 59 | 2.9 | UI component/page |
| 140 | `frontend/src/components/utils-settings/index.js` | frontend-ui | 12 | 0.7 | UI component/page |
| 141 | `frontend/src/components/utils-settings/OtpModal.jsx` | frontend-ui | 127 | 6.6 | UI component/page |
| 142 | `frontend/src/components/utils-settings/ResetData.jsx` | frontend-ui | 267 | 12.1 | UI component/page |
| 143 | `frontend/src/components/utils-settings/Settings.jsx` | frontend-ui | 1045 | 49.0 | UI component/page |
| 144 | `frontend/src/constants.js` | frontend-core | 173 | 7.9 | Project source/support file |
| 145 | `frontend/src/index.jsx` | frontend-core | 81 | 2.4 | Project source/support file |
| 146 | `frontend/src/lang/en.json` | frontend-i18n | 1475 | 62.7 | Localization dictionary |
| 147 | `frontend/src/lang/km.json` | frontend-i18n | 1475 | 112.7 | Localization dictionary |
| 148 | `frontend/src/README.md` | frontend-core | 38 | 1.3 | Documentation |
| 149 | `frontend/src/styles/main.css` | frontend-style | 357 | 16.4 | Project source/support file |
| 150 | `frontend/src/utils/appRefresh.js` | frontend-utils | 28 | 0.6 | Utility helper |
| 151 | `frontend/src/utils/csv.js` | frontend-utils | 30 | 1.2 | Utility helper |
| 152 | `frontend/src/utils/dateHelpers.js` | frontend-utils | 25 | 1.0 | Utility helper |
| 153 | `frontend/src/utils/deviceInfo.js` | frontend-utils | 36 | 1.0 | Utility helper |
| 154 | `frontend/src/utils/firebasePhoneAuth.js` | frontend-utils | 21 | 0.5 | Utility helper |
| 155 | `frontend/src/utils/formatters.js` | frontend-utils | 55 | 1.8 | Utility helper |
| 156 | `frontend/src/utils/index.js` | frontend-utils | 10 | 0.5 | Utility helper |
| 157 | `frontend/src/utils/printReceipt.js` | frontend-utils | 370 | 11.2 | Utility helper |
| 158 | `frontend/src/web-api.js` | frontend-core | 136 | 5.1 | Project source/support file |
| 159 | `frontend/tailwind.config.js` | frontend-root | 17 | 0.4 | Project source/support file |
| 160 | `frontend/tests/appShellUtils.test.mjs` | frontend-root | 41 | 1.3 | Project source/support file |
| 161 | `frontend/tests/portalEditorUtils.test.mjs` | frontend-root | 57 | 1.9 | Project source/support file |
| 162 | `frontend/vite.config.mjs` | frontend-root | 93 | 3.4 | Project source/support file |
| 163 | `ops/scripts/backend/verify-data-integrity.js` | project-scripts | 233 | 7.9 | Project source/support file |
| 164 | `ops/scripts/frontend/verify-i18n.js` | project-scripts | 131 | 3.8 | Project source/support file |
| 165 | `ops/scripts/generate-doc-reference.js` | project-scripts | 466 | 15.3 | Project source/support file |
| 166 | `ops/scripts/generate-full-project-docs.js` | project-scripts | 633 | 22.3 | Project source/support file |
| 167 | `ops/scripts/lib/fs-utils.js` | project-scripts | 122 | 2.8 | Project source/support file |
| 168 | `ops/scripts/performance-scan.js` | project-scripts | 136 | 4.1 | Project source/support file |
| 169 | `ops/scripts/sync-firebase-release-env.ps1` | project-scripts | 55 | 1.7 | Project source/support file |
| 170 | `README-build.md` | project-root | 4 | 0.1 | Project documentation entrypoint |
| 171 | `README.md` | project-root | 6 | 0.2 | Project documentation entrypoint |
| 172 | `setup.bat` | project-root | 237 | 9.0 | Environment setup script |
| 173 | `setup.sh` | project-root | 110 | 3.4 | Environment setup script |
| 174 | `start-server-release.bat` | project-root | 256 | 10.5 | Server lifecycle launcher script |
| 175 | `start-server.bat` | project-root | 272 | 10.6 | Server lifecycle launcher script |
| 176 | `start-server.sh` | project-root | 131 | 5.8 | Server lifecycle launcher script |
| 177 | `stop-server-release.bat` | project-root | 124 | 4.6 | Server lifecycle launcher script |
| 178 | `stop-server.bat` | project-root | 113 | 4.0 | Server lifecycle launcher script |
| 179 | `stop-server.sh` | project-root | 69 | 2.2 | Server lifecycle launcher script |
| 180 | `temp-vite-build.mjs` | project-root | 10 | 0.3 | Project source/support file |
