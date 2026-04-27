# Import / Export Reference

Auto-generated import/export and dependency-link coverage for frontend/backend code files.

## 1. Coverage Summary

Code files documented: **630**

## 2. Dependency Matrix

| No. | File | Imports | Exports | Internal deps | Referenced by |
|---:|---|---:|---:|---:|---:|
| 1 | `backend/server.js` | 32 | 0 | 26 | 0 |
| 2 | `backend/src/accessControl.js` | 2 | 1 | 2 | 3 |
| 3 | `backend/src/backupSchema.js` | 0 | 1 | 0 | 2 |
| 4 | `backend/src/config.js` | 3 | 1 | 0 | 10 |
| 5 | `backend/src/database.js` | 6 | 1 | 1 | 25 |
| 6 | `backend/src/dataPath.js` | 2 | 1 | 0 | 4 |
| 7 | `backend/src/fileAssets.js` | 6 | 1 | 3 | 5 |
| 8 | `backend/src/helpers.js` | 3 | 1 | 3 | 20 |
| 9 | `backend/src/middleware.js` | 10 | 1 | 6 | 18 |
| 10 | `backend/src/netSecurity.js` | 1 | 1 | 0 | 4 |
| 11 | `backend/src/organizationContext.js` | 5 | 1 | 2 | 5 |
| 12 | `backend/src/portalUtils.js` | 0 | 1 | 0 | 2 |
| 13 | `backend/src/requestContext.js` | 1 | 1 | 0 | 2 |
| 14 | `backend/src/routes/ai.js` | 5 | 1 | 4 | 1 |
| 15 | `backend/src/routes/auth.js` | 13 | 1 | 8 | 1 |
| 16 | `backend/src/routes/branches.js` | 4 | 1 | 3 | 1 |
| 17 | `backend/src/routes/catalog.js` | 3 | 1 | 2 | 1 |
| 18 | `backend/src/routes/categories.js` | 4 | 1 | 3 | 1 |
| 19 | `backend/src/routes/contacts.js` | 4 | 1 | 3 | 1 |
| 20 | `backend/src/routes/customTables.js` | 4 | 1 | 3 | 1 |
| 21 | `backend/src/routes/files.js` | 4 | 1 | 3 | 1 |
| 22 | `backend/src/routes/inventory.js` | 4 | 1 | 3 | 1 |
| 23 | `backend/src/routes/organizations.js` | 3 | 1 | 2 | 1 |
| 24 | `backend/src/routes/portal.js` | 10 | 1 | 9 | 1 |
| 25 | `backend/src/routes/products.js` | 9 | 1 | 6 | 1 |
| 26 | `backend/src/routes/returns.js` | 4 | 1 | 3 | 1 |
| 27 | `backend/src/routes/sales.js` | 4 | 1 | 3 | 1 |
| 28 | `backend/src/routes/settings.js` | 4 | 1 | 3 | 1 |
| 29 | `backend/src/routes/system.js` | 15 | 1 | 9 | 1 |
| 30 | `backend/src/routes/units.js` | 4 | 1 | 3 | 1 |
| 31 | `backend/src/routes/users.js` | 9 | 1 | 7 | 1 |
| 32 | `backend/src/security.js` | 1 | 1 | 0 | 7 |
| 33 | `backend/src/serverUtils.js` | 0 | 1 | 0 | 2 |
| 34 | `backend/src/services/aiGateway.js` | 2 | 1 | 2 | 2 |
| 35 | `backend/src/services/firebaseAuth.js` | 2 | 1 | 0 | 0 |
| 36 | `backend/src/services/googleDriveSync.js` | 8 | 1 | 4 | 2 |
| 37 | `backend/src/services/portalAi.js` | 2 | 1 | 2 | 1 |
| 38 | `backend/src/services/supabaseAuth.js` | 0 | 1 | 0 | 2 |
| 39 | `backend/src/services/verification.js` | 2 | 1 | 1 | 2 |
| 40 | `backend/src/sessionAuth.js` | 2 | 1 | 1 | 3 |
| 41 | `backend/src/systemFsWorker.js` | 3 | 0 | 1 | 0 |
| 42 | `backend/src/uploadSecurity.js` | 2 | 1 | 0 | 3 |
| 43 | `backend/src/websocket.js` | 4 | 1 | 2 | 1 |
| 44 | `backend/test/accessControl.test.js` | 2 | 0 | 1 | 0 |
| 45 | `backend/test/backupRoundtrip.test.js` | 6 | 0 | 0 | 0 |
| 46 | `backend/test/backupSchema.test.js` | 2 | 0 | 1 | 0 |
| 47 | `backend/test/dataPath.test.js` | 5 | 0 | 1 | 0 |
| 48 | `backend/test/netSecurity.test.js` | 2 | 0 | 1 | 0 |
| 49 | `backend/test/portalUtils.test.js` | 2 | 0 | 1 | 0 |
| 50 | `backend/test/serverUtils.test.js` | 2 | 0 | 1 | 0 |
| 51 | `backend/test/uploadSecurity.test.js` | 2 | 0 | 1 | 0 |
| 52 | `business-os-v1-centralized-org-path/backend/server.js` | 32 | 0 | 26 | 0 |
| 53 | `business-os-v1-centralized-org-path/backend/src/accessControl.js` | 2 | 1 | 2 | 3 |
| 54 | `business-os-v1-centralized-org-path/backend/src/backupSchema.js` | 0 | 1 | 0 | 2 |
| 55 | `business-os-v1-centralized-org-path/backend/src/config.js` | 3 | 1 | 0 | 9 |
| 56 | `business-os-v1-centralized-org-path/backend/src/database.js` | 6 | 1 | 1 | 24 |
| 57 | `business-os-v1-centralized-org-path/backend/src/dataPath.js` | 2 | 1 | 0 | 4 |
| 58 | `business-os-v1-centralized-org-path/backend/src/fileAssets.js` | 6 | 1 | 3 | 5 |
| 59 | `business-os-v1-centralized-org-path/backend/src/helpers.js` | 3 | 1 | 3 | 19 |
| 60 | `business-os-v1-centralized-org-path/backend/src/middleware.js` | 10 | 1 | 6 | 18 |
| 61 | `business-os-v1-centralized-org-path/backend/src/netSecurity.js` | 1 | 1 | 0 | 4 |
| 62 | `business-os-v1-centralized-org-path/backend/src/organizationContext.js` | 5 | 1 | 2 | 5 |
| 63 | `business-os-v1-centralized-org-path/backend/src/portalUtils.js` | 0 | 1 | 0 | 2 |
| 64 | `business-os-v1-centralized-org-path/backend/src/requestContext.js` | 1 | 1 | 0 | 2 |
| 65 | `business-os-v1-centralized-org-path/backend/src/routes/ai.js` | 5 | 1 | 4 | 1 |
| 66 | `business-os-v1-centralized-org-path/backend/src/routes/auth.js` | 13 | 1 | 8 | 1 |
| 67 | `business-os-v1-centralized-org-path/backend/src/routes/branches.js` | 4 | 1 | 3 | 1 |
| 68 | `business-os-v1-centralized-org-path/backend/src/routes/catalog.js` | 3 | 1 | 2 | 1 |
| 69 | `business-os-v1-centralized-org-path/backend/src/routes/categories.js` | 4 | 1 | 3 | 1 |
| 70 | `business-os-v1-centralized-org-path/backend/src/routes/contacts.js` | 4 | 1 | 3 | 1 |
| 71 | `business-os-v1-centralized-org-path/backend/src/routes/customTables.js` | 4 | 1 | 3 | 1 |
| 72 | `business-os-v1-centralized-org-path/backend/src/routes/files.js` | 4 | 1 | 3 | 1 |
| 73 | `business-os-v1-centralized-org-path/backend/src/routes/inventory.js` | 4 | 1 | 3 | 1 |
| 74 | `business-os-v1-centralized-org-path/backend/src/routes/organizations.js` | 3 | 1 | 2 | 1 |
| 75 | `business-os-v1-centralized-org-path/backend/src/routes/portal.js` | 10 | 1 | 9 | 1 |
| 76 | `business-os-v1-centralized-org-path/backend/src/routes/products.js` | 9 | 1 | 6 | 1 |
| 77 | `business-os-v1-centralized-org-path/backend/src/routes/returns.js` | 4 | 1 | 3 | 1 |
| 78 | `business-os-v1-centralized-org-path/backend/src/routes/sales.js` | 4 | 1 | 3 | 1 |
| 79 | `business-os-v1-centralized-org-path/backend/src/routes/settings.js` | 4 | 1 | 3 | 1 |
| 80 | `business-os-v1-centralized-org-path/backend/src/routes/system.js` | 15 | 1 | 9 | 1 |
| 81 | `business-os-v1-centralized-org-path/backend/src/routes/units.js` | 4 | 1 | 3 | 1 |
| 82 | `business-os-v1-centralized-org-path/backend/src/routes/users.js` | 9 | 1 | 7 | 1 |
| 83 | `business-os-v1-centralized-org-path/backend/src/security.js` | 1 | 1 | 0 | 7 |
| 84 | `business-os-v1-centralized-org-path/backend/src/serverUtils.js` | 0 | 1 | 0 | 2 |
| 85 | `business-os-v1-centralized-org-path/backend/src/services/aiGateway.js` | 2 | 1 | 2 | 2 |
| 86 | `business-os-v1-centralized-org-path/backend/src/services/firebaseAuth.js` | 2 | 1 | 0 | 0 |
| 87 | `business-os-v1-centralized-org-path/backend/src/services/googleDriveSync.js` | 8 | 1 | 4 | 2 |
| 88 | `business-os-v1-centralized-org-path/backend/src/services/portalAi.js` | 2 | 1 | 2 | 1 |
| 89 | `business-os-v1-centralized-org-path/backend/src/services/supabaseAuth.js` | 0 | 1 | 0 | 2 |
| 90 | `business-os-v1-centralized-org-path/backend/src/services/verification.js` | 2 | 1 | 1 | 2 |
| 91 | `business-os-v1-centralized-org-path/backend/src/sessionAuth.js` | 2 | 1 | 1 | 3 |
| 92 | `business-os-v1-centralized-org-path/backend/src/systemFsWorker.js` | 3 | 0 | 1 | 0 |
| 93 | `business-os-v1-centralized-org-path/backend/src/uploadSecurity.js` | 2 | 1 | 0 | 3 |
| 94 | `business-os-v1-centralized-org-path/backend/src/websocket.js` | 4 | 1 | 2 | 1 |
| 95 | `business-os-v1-centralized-org-path/backend/test/accessControl.test.js` | 2 | 0 | 1 | 0 |
| 96 | `business-os-v1-centralized-org-path/backend/test/backupRoundtrip.test.js` | 6 | 0 | 0 | 0 |
| 97 | `business-os-v1-centralized-org-path/backend/test/backupSchema.test.js` | 2 | 0 | 1 | 0 |
| 98 | `business-os-v1-centralized-org-path/backend/test/dataPath.test.js` | 5 | 0 | 1 | 0 |
| 99 | `business-os-v1-centralized-org-path/backend/test/netSecurity.test.js` | 2 | 0 | 1 | 0 |
| 100 | `business-os-v1-centralized-org-path/backend/test/portalUtils.test.js` | 2 | 0 | 1 | 0 |
| 101 | `business-os-v1-centralized-org-path/backend/test/serverUtils.test.js` | 2 | 0 | 1 | 0 |
| 102 | `business-os-v1-centralized-org-path/backend/test/uploadSecurity.test.js` | 2 | 0 | 1 | 0 |
| 103 | `business-os-v1-centralized-org-path/frontend/postcss.config.js` | 0 | 1 | 0 | 0 |
| 104 | `business-os-v1-centralized-org-path/frontend/src/api/http.js` | 2 | 18 | 2 | 5 |
| 105 | `business-os-v1-centralized-org-path/frontend/src/api/localDb.js` | 1 | 5 | 0 | 2 |
| 106 | `business-os-v1-centralized-org-path/frontend/src/api/methods.js` | 4 | 143 | 4 | 1 |
| 107 | `business-os-v1-centralized-org-path/frontend/src/api/websocket.js` | 2 | 3 | 2 | 2 |
| 108 | `business-os-v1-centralized-org-path/frontend/src/App.jsx` | 24 | 1 | 23 | 1 |
| 109 | `business-os-v1-centralized-org-path/frontend/src/app/appShellUtils.mjs` | 0 | 5 | 0 | 2 |
| 110 | `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx` | 8 | 5 | 7 | 44 |
| 111 | `business-os-v1-centralized-org-path/frontend/src/components/auth/Login.jsx` | 4 | 1 | 3 | 1 |
| 112 | `business-os-v1-centralized-org-path/frontend/src/components/branches/Branches.jsx` | 6 | 1 | 4 | 1 |
| 113 | `business-os-v1-centralized-org-path/frontend/src/components/branches/BranchForm.jsx` | 2 | 1 | 1 | 1 |
| 114 | `business-os-v1-centralized-org-path/frontend/src/components/branches/TransferModal.jsx` | 2 | 1 | 1 | 1 |
| 115 | `business-os-v1-centralized-org-path/frontend/src/components/catalog/CatalogPage.jsx` | 6 | 1 | 5 | 1 |
| 116 | `business-os-v1-centralized-org-path/frontend/src/components/catalog/portalEditorUtils.mjs` | 0 | 6 | 0 | 0 |
| 117 | `business-os-v1-centralized-org-path/frontend/src/components/contacts/Contacts.jsx` | 9 | 1 | 7 | 1 |
| 118 | `business-os-v1-centralized-org-path/frontend/src/components/contacts/CustomersTab.jsx` | 7 | 2 | 5 | 2 |
| 119 | `business-os-v1-centralized-org-path/frontend/src/components/contacts/DeliveryTab.jsx` | 7 | 2 | 5 | 1 |
| 120 | `business-os-v1-centralized-org-path/frontend/src/components/contacts/shared.jsx` | 4 | 5 | 3 | 4 |
| 121 | `business-os-v1-centralized-org-path/frontend/src/components/contacts/SuppliersTab.jsx` | 7 | 0 | 5 | 1 |
| 122 | `business-os-v1-centralized-org-path/frontend/src/components/custom-tables/CustomTables.jsx` | 2 | 1 | 1 | 0 |
| 123 | `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/BarChart.jsx` | 3 | 1 | 2 | 0 |
| 124 | `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/DonutChart.jsx` | 3 | 1 | 2 | 0 |
| 125 | `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/index.js` | 0 | 0 | 0 | 1 |
| 126 | `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/LineChart.jsx` | 3 | 1 | 2 | 0 |
| 127 | `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/NoData.jsx` | 1 | 1 | 1 | 3 |
| 128 | `business-os-v1-centralized-org-path/frontend/src/components/dashboard/Dashboard.jsx` | 9 | 1 | 7 | 1 |
| 129 | `business-os-v1-centralized-org-path/frontend/src/components/dashboard/MiniStat.jsx` | 0 | 1 | 0 | 1 |
| 130 | `business-os-v1-centralized-org-path/frontend/src/components/files/FilePickerModal.jsx` | 3 | 1 | 2 | 5 |
| 131 | `business-os-v1-centralized-org-path/frontend/src/components/files/FilesPage.jsx` | 2 | 1 | 1 | 1 |
| 132 | `business-os-v1-centralized-org-path/frontend/src/components/inventory/DualMoney.jsx` | 0 | 1 | 0 | 2 |
| 133 | `business-os-v1-centralized-org-path/frontend/src/components/inventory/Inventory.jsx` | 8 | 1 | 6 | 1 |
| 134 | `business-os-v1-centralized-org-path/frontend/src/components/inventory/movementGroups.js` | 0 | 2 | 0 | 1 |
| 135 | `business-os-v1-centralized-org-path/frontend/src/components/inventory/ProductDetailModal.jsx` | 1 | 1 | 1 | 1 |
| 136 | `business-os-v1-centralized-org-path/frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | 3 | 1 | 1 | 1 |
| 137 | `business-os-v1-centralized-org-path/frontend/src/components/navigation/Sidebar.jsx` | 4 | 1 | 3 | 1 |
| 138 | `business-os-v1-centralized-org-path/frontend/src/components/pos/CartItem.jsx` | 1 | 1 | 1 | 1 |
| 139 | `business-os-v1-centralized-org-path/frontend/src/components/pos/FilterPanel.jsx` | 1 | 1 | 0 | 1 |
| 140 | `business-os-v1-centralized-org-path/frontend/src/components/pos/POS.jsx` | 12 | 1 | 10 | 1 |
| 141 | `business-os-v1-centralized-org-path/frontend/src/components/pos/ProductImage.jsx` | 1 | 1 | 0 | 2 |
| 142 | `business-os-v1-centralized-org-path/frontend/src/components/pos/QuickAddModal.jsx` | 0 | 1 | 0 | 1 |
| 143 | `business-os-v1-centralized-org-path/frontend/src/components/products/BranchStockAdjuster.jsx` | 1 | 1 | 0 | 1 |
| 144 | `business-os-v1-centralized-org-path/frontend/src/components/products/BulkAddStockModal.jsx` | 2 | 1 | 1 | 1 |
| 145 | `business-os-v1-centralized-org-path/frontend/src/components/products/BulkImportModal.jsx` | 4 | 1 | 3 | 1 |
| 146 | `business-os-v1-centralized-org-path/frontend/src/components/products/HeaderActions.jsx` | 2 | 1 | 1 | 1 |
| 147 | `business-os-v1-centralized-org-path/frontend/src/components/products/ManageBrandsModal.jsx` | 3 | 1 | 2 | 1 |
| 148 | `business-os-v1-centralized-org-path/frontend/src/components/products/ManageCategoriesModal.jsx` | 3 | 1 | 2 | 1 |
| 149 | `business-os-v1-centralized-org-path/frontend/src/components/products/ManageFieldsModal.jsx` | 2 | 1 | 1 | 1 |
| 150 | `business-os-v1-centralized-org-path/frontend/src/components/products/ManageMenu.jsx` | 1 | 1 | 1 | 0 |
| 151 | `business-os-v1-centralized-org-path/frontend/src/components/products/ManageUnitsModal.jsx` | 2 | 1 | 1 | 1 |
| 152 | `business-os-v1-centralized-org-path/frontend/src/components/products/primitives.jsx` | 2 | 0 | 0 | 5 |
| 153 | `business-os-v1-centralized-org-path/frontend/src/components/products/ProductDetailModal.jsx` | 2 | 1 | 1 | 1 |
| 154 | `business-os-v1-centralized-org-path/frontend/src/components/products/ProductForm.jsx` | 5 | 1 | 4 | 1 |
| 155 | `business-os-v1-centralized-org-path/frontend/src/components/products/Products.jsx` | 18 | 1 | 16 | 1 |
| 156 | `business-os-v1-centralized-org-path/frontend/src/components/products/VariantFormModal.jsx` | 4 | 1 | 3 | 1 |
| 157 | `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | 3 | 1 | 2 | 1 |
| 158 | `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/constants.js` | 0 | 3 | 0 | 3 |
| 159 | `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/ErrorBoundary.jsx` | 1 | 1 | 0 | 1 |
| 160 | `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/FieldOrderManager.jsx` | 2 | 1 | 0 | 1 |
| 161 | `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/PrintSettings.jsx` | 3 | 1 | 1 | 1 |
| 162 | `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/ReceiptPreview.jsx` | 2 | 1 | 1 | 1 |
| 163 | `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/ReceiptSettings.jsx` | 9 | 1 | 7 | 1 |
| 164 | `business-os-v1-centralized-org-path/frontend/src/components/receipt/Receipt.jsx` | 6 | 2 | 4 | 3 |
| 165 | `business-os-v1-centralized-org-path/frontend/src/components/returns/EditReturnModal.jsx` | 2 | 1 | 1 | 1 |
| 166 | `business-os-v1-centralized-org-path/frontend/src/components/returns/NewReturnModal.jsx` | 3 | 1 | 2 | 1 |
| 167 | `business-os-v1-centralized-org-path/frontend/src/components/returns/NewSupplierReturnModal.jsx` | 2 | 1 | 1 | 1 |
| 168 | `business-os-v1-centralized-org-path/frontend/src/components/returns/ReturnDetailModal.jsx` | 2 | 1 | 2 | 1 |
| 169 | `business-os-v1-centralized-org-path/frontend/src/components/returns/Returns.jsx` | 9 | 1 | 7 | 1 |
| 170 | `business-os-v1-centralized-org-path/frontend/src/components/sales/ExportModal.jsx` | 4 | 1 | 2 | 1 |
| 171 | `business-os-v1-centralized-org-path/frontend/src/components/sales/SaleDetailModal.jsx` | 3 | 1 | 2 | 1 |
| 172 | `business-os-v1-centralized-org-path/frontend/src/components/sales/Sales.jsx` | 9 | 1 | 7 | 1 |
| 173 | `business-os-v1-centralized-org-path/frontend/src/components/sales/StatusBadge.jsx` | 0 | 5 | 0 | 5 |
| 174 | `business-os-v1-centralized-org-path/frontend/src/components/server/ServerPage.jsx` | 2 | 1 | 1 | 1 |
| 175 | `business-os-v1-centralized-org-path/frontend/src/components/shared/ImageGalleryLightbox.jsx` | 2 | 1 | 0 | 3 |
| 176 | `business-os-v1-centralized-org-path/frontend/src/components/shared/Modal.jsx` | 0 | 1 | 0 | 19 |
| 177 | `business-os-v1-centralized-org-path/frontend/src/components/shared/navigationConfig.js` | 0 | 4 | 0 | 2 |
| 178 | `business-os-v1-centralized-org-path/frontend/src/components/shared/PageHelpButton.jsx` | 4 | 1 | 2 | 1 |
| 179 | `business-os-v1-centralized-org-path/frontend/src/components/shared/pageHelpContent.js` | 0 | 2 | 0 | 1 |
| 180 | `business-os-v1-centralized-org-path/frontend/src/components/shared/PortalMenu.jsx` | 3 | 2 | 0 | 5 |
| 181 | `business-os-v1-centralized-org-path/frontend/src/components/users/PermissionEditor.jsx` | 0 | 2 | 0 | 2 |
| 182 | `business-os-v1-centralized-org-path/frontend/src/components/users/UserDetailSheet.jsx` | 2 | 1 | 2 | 1 |
| 183 | `business-os-v1-centralized-org-path/frontend/src/components/users/UserProfileModal.jsx` | 7 | 1 | 5 | 2 |
| 184 | `business-os-v1-centralized-org-path/frontend/src/components/users/Users.jsx` | 9 | 1 | 7 | 1 |
| 185 | `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/AuditLog.jsx` | 4 | 1 | 2 | 1 |
| 186 | `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/Backup.jsx` | 6 | 1 | 4 | 1 |
| 187 | `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/FontFamilyPicker.jsx` | 1 | 1 | 0 | 1 |
| 188 | `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/index.js` | 0 | 0 | 0 | 0 |
| 189 | `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/OtpModal.jsx` | 2 | 1 | 1 | 2 |
| 190 | `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/ResetData.jsx` | 4 | 0 | 2 | 1 |
| 191 | `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/Settings.jsx` | 7 | 1 | 5 | 1 |
| 192 | `business-os-v1-centralized-org-path/frontend/src/constants.js` | 0 | 12 | 0 | 7 |
| 193 | `business-os-v1-centralized-org-path/frontend/src/index.jsx` | 5 | 0 | 3 | 0 |
| 194 | `business-os-v1-centralized-org-path/frontend/src/utils/appRefresh.js` | 0 | 1 | 0 | 2 |
| 195 | `business-os-v1-centralized-org-path/frontend/src/utils/csv.js` | 0 | 1 | 0 | 9 |
| 196 | `business-os-v1-centralized-org-path/frontend/src/utils/dateHelpers.js` | 0 | 2 | 0 | 1 |
| 197 | `business-os-v1-centralized-org-path/frontend/src/utils/deviceInfo.js` | 0 | 2 | 0 | 6 |
| 198 | `business-os-v1-centralized-org-path/frontend/src/utils/favicon.js` | 0 | 1 | 0 | 3 |
| 199 | `business-os-v1-centralized-org-path/frontend/src/utils/firebasePhoneAuth.js` | 0 | 3 | 0 | 0 |
| 200 | `business-os-v1-centralized-org-path/frontend/src/utils/formatters.js` | 0 | 4 | 0 | 15 |
| 201 | `business-os-v1-centralized-org-path/frontend/src/utils/index.js` | 0 | 0 | 0 | 0 |
| 202 | `business-os-v1-centralized-org-path/frontend/src/utils/printReceipt.js` | 0 | 8 | 0 | 2 |
| 203 | `business-os-v1-centralized-org-path/frontend/src/web-api.js` | 5 | 0 | 5 | 1 |
| 204 | `business-os-v1-centralized-org-path/frontend/tailwind.config.js` | 0 | 1 | 0 | 0 |
| 205 | `business-os-v1-centralized-org-path/frontend/tests/appShellUtils.test.mjs` | 2 | 0 | 1 | 0 |
| 206 | `business-os-v1-centralized-org-path/frontend/tests/portalEditorUtils.test.mjs` | 1 | 0 | 0 | 0 |
| 207 | `business-os-v1-centralized-org-path/frontend/vite.config.mjs` | 2 | 1 | 0 | 0 |
| 208 | `business-os-v2-dedicated-server/backend/server.js` | 32 | 0 | 26 | 0 |
| 209 | `business-os-v2-dedicated-server/backend/src/accessControl.js` | 2 | 1 | 2 | 3 |
| 210 | `business-os-v2-dedicated-server/backend/src/backupSchema.js` | 0 | 1 | 0 | 2 |
| 211 | `business-os-v2-dedicated-server/backend/src/config.js` | 3 | 1 | 0 | 9 |
| 212 | `business-os-v2-dedicated-server/backend/src/database.js` | 6 | 1 | 1 | 24 |
| 213 | `business-os-v2-dedicated-server/backend/src/dataPath.js` | 2 | 1 | 0 | 4 |
| 214 | `business-os-v2-dedicated-server/backend/src/fileAssets.js` | 6 | 1 | 3 | 5 |
| 215 | `business-os-v2-dedicated-server/backend/src/helpers.js` | 3 | 1 | 3 | 19 |
| 216 | `business-os-v2-dedicated-server/backend/src/middleware.js` | 10 | 1 | 6 | 18 |
| 217 | `business-os-v2-dedicated-server/backend/src/netSecurity.js` | 1 | 1 | 0 | 4 |
| 218 | `business-os-v2-dedicated-server/backend/src/organizationContext.js` | 5 | 1 | 2 | 5 |
| 219 | `business-os-v2-dedicated-server/backend/src/portalUtils.js` | 0 | 1 | 0 | 2 |
| 220 | `business-os-v2-dedicated-server/backend/src/requestContext.js` | 1 | 1 | 0 | 2 |
| 221 | `business-os-v2-dedicated-server/backend/src/routes/ai.js` | 5 | 1 | 4 | 1 |
| 222 | `business-os-v2-dedicated-server/backend/src/routes/auth.js` | 13 | 1 | 8 | 1 |
| 223 | `business-os-v2-dedicated-server/backend/src/routes/branches.js` | 4 | 1 | 3 | 1 |
| 224 | `business-os-v2-dedicated-server/backend/src/routes/catalog.js` | 3 | 1 | 2 | 1 |
| 225 | `business-os-v2-dedicated-server/backend/src/routes/categories.js` | 4 | 1 | 3 | 1 |
| 226 | `business-os-v2-dedicated-server/backend/src/routes/contacts.js` | 4 | 1 | 3 | 1 |
| 227 | `business-os-v2-dedicated-server/backend/src/routes/customTables.js` | 4 | 1 | 3 | 1 |
| 228 | `business-os-v2-dedicated-server/backend/src/routes/files.js` | 4 | 1 | 3 | 1 |
| 229 | `business-os-v2-dedicated-server/backend/src/routes/inventory.js` | 4 | 1 | 3 | 1 |
| 230 | `business-os-v2-dedicated-server/backend/src/routes/organizations.js` | 3 | 1 | 2 | 1 |
| 231 | `business-os-v2-dedicated-server/backend/src/routes/portal.js` | 10 | 1 | 9 | 1 |
| 232 | `business-os-v2-dedicated-server/backend/src/routes/products.js` | 9 | 1 | 6 | 1 |
| 233 | `business-os-v2-dedicated-server/backend/src/routes/returns.js` | 4 | 1 | 3 | 1 |
| 234 | `business-os-v2-dedicated-server/backend/src/routes/sales.js` | 4 | 1 | 3 | 1 |
| 235 | `business-os-v2-dedicated-server/backend/src/routes/settings.js` | 4 | 1 | 3 | 1 |
| 236 | `business-os-v2-dedicated-server/backend/src/routes/system.js` | 15 | 1 | 9 | 1 |
| 237 | `business-os-v2-dedicated-server/backend/src/routes/units.js` | 4 | 1 | 3 | 1 |
| 238 | `business-os-v2-dedicated-server/backend/src/routes/users.js` | 9 | 1 | 7 | 1 |
| 239 | `business-os-v2-dedicated-server/backend/src/security.js` | 1 | 1 | 0 | 7 |
| 240 | `business-os-v2-dedicated-server/backend/src/serverUtils.js` | 0 | 1 | 0 | 2 |
| 241 | `business-os-v2-dedicated-server/backend/src/services/aiGateway.js` | 2 | 1 | 2 | 2 |
| 242 | `business-os-v2-dedicated-server/backend/src/services/firebaseAuth.js` | 2 | 1 | 0 | 0 |
| 243 | `business-os-v2-dedicated-server/backend/src/services/googleDriveSync.js` | 8 | 1 | 4 | 2 |
| 244 | `business-os-v2-dedicated-server/backend/src/services/portalAi.js` | 2 | 1 | 2 | 1 |
| 245 | `business-os-v2-dedicated-server/backend/src/services/supabaseAuth.js` | 0 | 1 | 0 | 2 |
| 246 | `business-os-v2-dedicated-server/backend/src/services/verification.js` | 2 | 1 | 1 | 2 |
| 247 | `business-os-v2-dedicated-server/backend/src/sessionAuth.js` | 2 | 1 | 1 | 3 |
| 248 | `business-os-v2-dedicated-server/backend/src/systemFsWorker.js` | 3 | 0 | 1 | 0 |
| 249 | `business-os-v2-dedicated-server/backend/src/uploadSecurity.js` | 2 | 1 | 0 | 3 |
| 250 | `business-os-v2-dedicated-server/backend/src/websocket.js` | 4 | 1 | 2 | 1 |
| 251 | `business-os-v2-dedicated-server/backend/test/accessControl.test.js` | 2 | 0 | 1 | 0 |
| 252 | `business-os-v2-dedicated-server/backend/test/backupRoundtrip.test.js` | 6 | 0 | 0 | 0 |
| 253 | `business-os-v2-dedicated-server/backend/test/backupSchema.test.js` | 2 | 0 | 1 | 0 |
| 254 | `business-os-v2-dedicated-server/backend/test/dataPath.test.js` | 5 | 0 | 1 | 0 |
| 255 | `business-os-v2-dedicated-server/backend/test/netSecurity.test.js` | 2 | 0 | 1 | 0 |
| 256 | `business-os-v2-dedicated-server/backend/test/portalUtils.test.js` | 2 | 0 | 1 | 0 |
| 257 | `business-os-v2-dedicated-server/backend/test/serverUtils.test.js` | 2 | 0 | 1 | 0 |
| 258 | `business-os-v2-dedicated-server/backend/test/uploadSecurity.test.js` | 2 | 0 | 1 | 0 |
| 259 | `business-os-v2-dedicated-server/frontend/postcss.config.js` | 0 | 1 | 0 | 0 |
| 260 | `business-os-v2-dedicated-server/frontend/src/api/http.js` | 2 | 18 | 2 | 5 |
| 261 | `business-os-v2-dedicated-server/frontend/src/api/localDb.js` | 1 | 5 | 0 | 2 |
| 262 | `business-os-v2-dedicated-server/frontend/src/api/methods.js` | 4 | 143 | 4 | 1 |
| 263 | `business-os-v2-dedicated-server/frontend/src/api/websocket.js` | 2 | 3 | 2 | 2 |
| 264 | `business-os-v2-dedicated-server/frontend/src/App.jsx` | 24 | 1 | 23 | 1 |
| 265 | `business-os-v2-dedicated-server/frontend/src/app/appShellUtils.mjs` | 0 | 5 | 0 | 2 |
| 266 | `business-os-v2-dedicated-server/frontend/src/AppContext.jsx` | 8 | 5 | 7 | 44 |
| 267 | `business-os-v2-dedicated-server/frontend/src/components/auth/Login.jsx` | 4 | 1 | 3 | 1 |
| 268 | `business-os-v2-dedicated-server/frontend/src/components/branches/Branches.jsx` | 6 | 1 | 4 | 1 |
| 269 | `business-os-v2-dedicated-server/frontend/src/components/branches/BranchForm.jsx` | 2 | 1 | 1 | 1 |
| 270 | `business-os-v2-dedicated-server/frontend/src/components/branches/TransferModal.jsx` | 2 | 1 | 1 | 1 |
| 271 | `business-os-v2-dedicated-server/frontend/src/components/catalog/CatalogPage.jsx` | 6 | 1 | 5 | 1 |
| 272 | `business-os-v2-dedicated-server/frontend/src/components/catalog/portalEditorUtils.mjs` | 0 | 6 | 0 | 0 |
| 273 | `business-os-v2-dedicated-server/frontend/src/components/contacts/Contacts.jsx` | 9 | 1 | 7 | 1 |
| 274 | `business-os-v2-dedicated-server/frontend/src/components/contacts/CustomersTab.jsx` | 7 | 2 | 5 | 2 |
| 275 | `business-os-v2-dedicated-server/frontend/src/components/contacts/DeliveryTab.jsx` | 7 | 2 | 5 | 1 |
| 276 | `business-os-v2-dedicated-server/frontend/src/components/contacts/shared.jsx` | 4 | 5 | 3 | 4 |
| 277 | `business-os-v2-dedicated-server/frontend/src/components/contacts/SuppliersTab.jsx` | 7 | 0 | 5 | 1 |
| 278 | `business-os-v2-dedicated-server/frontend/src/components/custom-tables/CustomTables.jsx` | 2 | 1 | 1 | 0 |
| 279 | `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/BarChart.jsx` | 3 | 1 | 2 | 0 |
| 280 | `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/DonutChart.jsx` | 3 | 1 | 2 | 0 |
| 281 | `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/index.js` | 0 | 0 | 0 | 1 |
| 282 | `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/LineChart.jsx` | 3 | 1 | 2 | 0 |
| 283 | `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/NoData.jsx` | 1 | 1 | 1 | 3 |
| 284 | `business-os-v2-dedicated-server/frontend/src/components/dashboard/Dashboard.jsx` | 9 | 1 | 7 | 1 |
| 285 | `business-os-v2-dedicated-server/frontend/src/components/dashboard/MiniStat.jsx` | 0 | 1 | 0 | 1 |
| 286 | `business-os-v2-dedicated-server/frontend/src/components/files/FilePickerModal.jsx` | 3 | 1 | 2 | 5 |
| 287 | `business-os-v2-dedicated-server/frontend/src/components/files/FilesPage.jsx` | 2 | 1 | 1 | 1 |
| 288 | `business-os-v2-dedicated-server/frontend/src/components/inventory/DualMoney.jsx` | 0 | 1 | 0 | 2 |
| 289 | `business-os-v2-dedicated-server/frontend/src/components/inventory/Inventory.jsx` | 8 | 1 | 6 | 1 |
| 290 | `business-os-v2-dedicated-server/frontend/src/components/inventory/movementGroups.js` | 0 | 2 | 0 | 1 |
| 291 | `business-os-v2-dedicated-server/frontend/src/components/inventory/ProductDetailModal.jsx` | 1 | 1 | 1 | 1 |
| 292 | `business-os-v2-dedicated-server/frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | 3 | 1 | 1 | 1 |
| 293 | `business-os-v2-dedicated-server/frontend/src/components/navigation/Sidebar.jsx` | 4 | 1 | 3 | 1 |
| 294 | `business-os-v2-dedicated-server/frontend/src/components/pos/CartItem.jsx` | 1 | 1 | 1 | 1 |
| 295 | `business-os-v2-dedicated-server/frontend/src/components/pos/FilterPanel.jsx` | 1 | 1 | 0 | 1 |
| 296 | `business-os-v2-dedicated-server/frontend/src/components/pos/POS.jsx` | 12 | 1 | 10 | 1 |
| 297 | `business-os-v2-dedicated-server/frontend/src/components/pos/ProductImage.jsx` | 1 | 1 | 0 | 2 |
| 298 | `business-os-v2-dedicated-server/frontend/src/components/pos/QuickAddModal.jsx` | 0 | 1 | 0 | 1 |
| 299 | `business-os-v2-dedicated-server/frontend/src/components/products/BranchStockAdjuster.jsx` | 1 | 1 | 0 | 1 |
| 300 | `business-os-v2-dedicated-server/frontend/src/components/products/BulkAddStockModal.jsx` | 2 | 1 | 1 | 1 |
| 301 | `business-os-v2-dedicated-server/frontend/src/components/products/BulkImportModal.jsx` | 4 | 1 | 3 | 1 |
| 302 | `business-os-v2-dedicated-server/frontend/src/components/products/HeaderActions.jsx` | 2 | 1 | 1 | 1 |
| 303 | `business-os-v2-dedicated-server/frontend/src/components/products/ManageBrandsModal.jsx` | 3 | 1 | 2 | 1 |
| 304 | `business-os-v2-dedicated-server/frontend/src/components/products/ManageCategoriesModal.jsx` | 3 | 1 | 2 | 1 |
| 305 | `business-os-v2-dedicated-server/frontend/src/components/products/ManageFieldsModal.jsx` | 2 | 1 | 1 | 1 |
| 306 | `business-os-v2-dedicated-server/frontend/src/components/products/ManageMenu.jsx` | 1 | 1 | 1 | 0 |
| 307 | `business-os-v2-dedicated-server/frontend/src/components/products/ManageUnitsModal.jsx` | 2 | 1 | 1 | 1 |
| 308 | `business-os-v2-dedicated-server/frontend/src/components/products/primitives.jsx` | 2 | 0 | 0 | 5 |
| 309 | `business-os-v2-dedicated-server/frontend/src/components/products/ProductDetailModal.jsx` | 2 | 1 | 1 | 1 |
| 310 | `business-os-v2-dedicated-server/frontend/src/components/products/ProductForm.jsx` | 5 | 1 | 4 | 1 |
| 311 | `business-os-v2-dedicated-server/frontend/src/components/products/Products.jsx` | 18 | 1 | 16 | 1 |
| 312 | `business-os-v2-dedicated-server/frontend/src/components/products/VariantFormModal.jsx` | 4 | 1 | 3 | 1 |
| 313 | `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | 3 | 1 | 2 | 1 |
| 314 | `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/constants.js` | 0 | 3 | 0 | 3 |
| 315 | `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/ErrorBoundary.jsx` | 1 | 1 | 0 | 1 |
| 316 | `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/FieldOrderManager.jsx` | 2 | 1 | 0 | 1 |
| 317 | `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/PrintSettings.jsx` | 3 | 1 | 1 | 1 |
| 318 | `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/ReceiptPreview.jsx` | 2 | 1 | 1 | 1 |
| 319 | `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/ReceiptSettings.jsx` | 9 | 1 | 7 | 1 |
| 320 | `business-os-v2-dedicated-server/frontend/src/components/receipt/Receipt.jsx` | 6 | 2 | 4 | 3 |
| 321 | `business-os-v2-dedicated-server/frontend/src/components/returns/EditReturnModal.jsx` | 2 | 1 | 1 | 1 |
| 322 | `business-os-v2-dedicated-server/frontend/src/components/returns/NewReturnModal.jsx` | 3 | 1 | 2 | 1 |
| 323 | `business-os-v2-dedicated-server/frontend/src/components/returns/NewSupplierReturnModal.jsx` | 2 | 1 | 1 | 1 |
| 324 | `business-os-v2-dedicated-server/frontend/src/components/returns/ReturnDetailModal.jsx` | 2 | 1 | 2 | 1 |
| 325 | `business-os-v2-dedicated-server/frontend/src/components/returns/Returns.jsx` | 9 | 1 | 7 | 1 |
| 326 | `business-os-v2-dedicated-server/frontend/src/components/sales/ExportModal.jsx` | 4 | 1 | 2 | 1 |
| 327 | `business-os-v2-dedicated-server/frontend/src/components/sales/SaleDetailModal.jsx` | 3 | 1 | 2 | 1 |
| 328 | `business-os-v2-dedicated-server/frontend/src/components/sales/Sales.jsx` | 9 | 1 | 7 | 1 |
| 329 | `business-os-v2-dedicated-server/frontend/src/components/sales/StatusBadge.jsx` | 0 | 5 | 0 | 5 |
| 330 | `business-os-v2-dedicated-server/frontend/src/components/server/ServerPage.jsx` | 2 | 1 | 1 | 1 |
| 331 | `business-os-v2-dedicated-server/frontend/src/components/shared/ImageGalleryLightbox.jsx` | 2 | 1 | 0 | 3 |
| 332 | `business-os-v2-dedicated-server/frontend/src/components/shared/Modal.jsx` | 0 | 1 | 0 | 19 |
| 333 | `business-os-v2-dedicated-server/frontend/src/components/shared/navigationConfig.js` | 0 | 4 | 0 | 2 |
| 334 | `business-os-v2-dedicated-server/frontend/src/components/shared/PageHelpButton.jsx` | 4 | 1 | 2 | 1 |
| 335 | `business-os-v2-dedicated-server/frontend/src/components/shared/pageHelpContent.js` | 0 | 2 | 0 | 1 |
| 336 | `business-os-v2-dedicated-server/frontend/src/components/shared/PortalMenu.jsx` | 3 | 2 | 0 | 5 |
| 337 | `business-os-v2-dedicated-server/frontend/src/components/users/PermissionEditor.jsx` | 0 | 2 | 0 | 2 |
| 338 | `business-os-v2-dedicated-server/frontend/src/components/users/UserDetailSheet.jsx` | 2 | 1 | 2 | 1 |
| 339 | `business-os-v2-dedicated-server/frontend/src/components/users/UserProfileModal.jsx` | 7 | 1 | 5 | 2 |
| 340 | `business-os-v2-dedicated-server/frontend/src/components/users/Users.jsx` | 9 | 1 | 7 | 1 |
| 341 | `business-os-v2-dedicated-server/frontend/src/components/utils-settings/AuditLog.jsx` | 4 | 1 | 2 | 1 |
| 342 | `business-os-v2-dedicated-server/frontend/src/components/utils-settings/Backup.jsx` | 6 | 1 | 4 | 1 |
| 343 | `business-os-v2-dedicated-server/frontend/src/components/utils-settings/FontFamilyPicker.jsx` | 1 | 1 | 0 | 1 |
| 344 | `business-os-v2-dedicated-server/frontend/src/components/utils-settings/index.js` | 0 | 0 | 0 | 0 |
| 345 | `business-os-v2-dedicated-server/frontend/src/components/utils-settings/OtpModal.jsx` | 2 | 1 | 1 | 2 |
| 346 | `business-os-v2-dedicated-server/frontend/src/components/utils-settings/ResetData.jsx` | 4 | 0 | 2 | 1 |
| 347 | `business-os-v2-dedicated-server/frontend/src/components/utils-settings/Settings.jsx` | 7 | 1 | 5 | 1 |
| 348 | `business-os-v2-dedicated-server/frontend/src/constants.js` | 0 | 12 | 0 | 7 |
| 349 | `business-os-v2-dedicated-server/frontend/src/index.jsx` | 5 | 0 | 3 | 0 |
| 350 | `business-os-v2-dedicated-server/frontend/src/utils/appRefresh.js` | 0 | 1 | 0 | 2 |
| 351 | `business-os-v2-dedicated-server/frontend/src/utils/csv.js` | 0 | 1 | 0 | 9 |
| 352 | `business-os-v2-dedicated-server/frontend/src/utils/dateHelpers.js` | 0 | 2 | 0 | 1 |
| 353 | `business-os-v2-dedicated-server/frontend/src/utils/deviceInfo.js` | 0 | 2 | 0 | 6 |
| 354 | `business-os-v2-dedicated-server/frontend/src/utils/favicon.js` | 0 | 1 | 0 | 3 |
| 355 | `business-os-v2-dedicated-server/frontend/src/utils/firebasePhoneAuth.js` | 0 | 3 | 0 | 0 |
| 356 | `business-os-v2-dedicated-server/frontend/src/utils/formatters.js` | 0 | 4 | 0 | 15 |
| 357 | `business-os-v2-dedicated-server/frontend/src/utils/index.js` | 0 | 0 | 0 | 0 |
| 358 | `business-os-v2-dedicated-server/frontend/src/utils/printReceipt.js` | 0 | 8 | 0 | 2 |
| 359 | `business-os-v2-dedicated-server/frontend/src/web-api.js` | 5 | 0 | 5 | 1 |
| 360 | `business-os-v2-dedicated-server/frontend/tailwind.config.js` | 0 | 1 | 0 | 0 |
| 361 | `business-os-v2-dedicated-server/frontend/tests/appShellUtils.test.mjs` | 2 | 0 | 1 | 0 |
| 362 | `business-os-v2-dedicated-server/frontend/tests/portalEditorUtils.test.mjs` | 1 | 0 | 0 | 0 |
| 363 | `business-os-v2-dedicated-server/frontend/vite.config.mjs` | 2 | 1 | 0 | 0 |
| 364 | `business-os-v3-centralized-server-template/backend/server.js` | 32 | 0 | 26 | 0 |
| 365 | `business-os-v3-centralized-server-template/backend/src/accessControl.js` | 2 | 1 | 2 | 3 |
| 366 | `business-os-v3-centralized-server-template/backend/src/backupSchema.js` | 0 | 1 | 0 | 2 |
| 367 | `business-os-v3-centralized-server-template/backend/src/config.js` | 3 | 1 | 0 | 9 |
| 368 | `business-os-v3-centralized-server-template/backend/src/database.js` | 6 | 1 | 1 | 24 |
| 369 | `business-os-v3-centralized-server-template/backend/src/dataPath.js` | 2 | 1 | 0 | 4 |
| 370 | `business-os-v3-centralized-server-template/backend/src/fileAssets.js` | 6 | 1 | 3 | 5 |
| 371 | `business-os-v3-centralized-server-template/backend/src/helpers.js` | 3 | 1 | 3 | 19 |
| 372 | `business-os-v3-centralized-server-template/backend/src/middleware.js` | 10 | 1 | 6 | 18 |
| 373 | `business-os-v3-centralized-server-template/backend/src/netSecurity.js` | 1 | 1 | 0 | 4 |
| 374 | `business-os-v3-centralized-server-template/backend/src/organizationContext.js` | 5 | 1 | 2 | 5 |
| 375 | `business-os-v3-centralized-server-template/backend/src/portalUtils.js` | 0 | 1 | 0 | 2 |
| 376 | `business-os-v3-centralized-server-template/backend/src/requestContext.js` | 1 | 1 | 0 | 2 |
| 377 | `business-os-v3-centralized-server-template/backend/src/routes/ai.js` | 5 | 1 | 4 | 1 |
| 378 | `business-os-v3-centralized-server-template/backend/src/routes/auth.js` | 13 | 1 | 8 | 1 |
| 379 | `business-os-v3-centralized-server-template/backend/src/routes/branches.js` | 4 | 1 | 3 | 1 |
| 380 | `business-os-v3-centralized-server-template/backend/src/routes/catalog.js` | 3 | 1 | 2 | 1 |
| 381 | `business-os-v3-centralized-server-template/backend/src/routes/categories.js` | 4 | 1 | 3 | 1 |
| 382 | `business-os-v3-centralized-server-template/backend/src/routes/contacts.js` | 4 | 1 | 3 | 1 |
| 383 | `business-os-v3-centralized-server-template/backend/src/routes/customTables.js` | 4 | 1 | 3 | 1 |
| 384 | `business-os-v3-centralized-server-template/backend/src/routes/files.js` | 4 | 1 | 3 | 1 |
| 385 | `business-os-v3-centralized-server-template/backend/src/routes/inventory.js` | 4 | 1 | 3 | 1 |
| 386 | `business-os-v3-centralized-server-template/backend/src/routes/organizations.js` | 3 | 1 | 2 | 1 |
| 387 | `business-os-v3-centralized-server-template/backend/src/routes/portal.js` | 10 | 1 | 9 | 1 |
| 388 | `business-os-v3-centralized-server-template/backend/src/routes/products.js` | 9 | 1 | 6 | 1 |
| 389 | `business-os-v3-centralized-server-template/backend/src/routes/returns.js` | 4 | 1 | 3 | 1 |
| 390 | `business-os-v3-centralized-server-template/backend/src/routes/sales.js` | 4 | 1 | 3 | 1 |
| 391 | `business-os-v3-centralized-server-template/backend/src/routes/settings.js` | 4 | 1 | 3 | 1 |
| 392 | `business-os-v3-centralized-server-template/backend/src/routes/system.js` | 15 | 1 | 9 | 1 |
| 393 | `business-os-v3-centralized-server-template/backend/src/routes/units.js` | 4 | 1 | 3 | 1 |
| 394 | `business-os-v3-centralized-server-template/backend/src/routes/users.js` | 9 | 1 | 7 | 1 |
| 395 | `business-os-v3-centralized-server-template/backend/src/security.js` | 1 | 1 | 0 | 7 |
| 396 | `business-os-v3-centralized-server-template/backend/src/serverUtils.js` | 0 | 1 | 0 | 2 |
| 397 | `business-os-v3-centralized-server-template/backend/src/services/aiGateway.js` | 2 | 1 | 2 | 2 |
| 398 | `business-os-v3-centralized-server-template/backend/src/services/firebaseAuth.js` | 2 | 1 | 0 | 0 |
| 399 | `business-os-v3-centralized-server-template/backend/src/services/googleDriveSync.js` | 8 | 1 | 4 | 2 |
| 400 | `business-os-v3-centralized-server-template/backend/src/services/portalAi.js` | 2 | 1 | 2 | 1 |
| 401 | `business-os-v3-centralized-server-template/backend/src/services/supabaseAuth.js` | 0 | 1 | 0 | 2 |
| 402 | `business-os-v3-centralized-server-template/backend/src/services/verification.js` | 2 | 1 | 1 | 2 |
| 403 | `business-os-v3-centralized-server-template/backend/src/sessionAuth.js` | 2 | 1 | 1 | 3 |
| 404 | `business-os-v3-centralized-server-template/backend/src/systemFsWorker.js` | 3 | 0 | 1 | 0 |
| 405 | `business-os-v3-centralized-server-template/backend/src/uploadSecurity.js` | 2 | 1 | 0 | 3 |
| 406 | `business-os-v3-centralized-server-template/backend/src/websocket.js` | 4 | 1 | 2 | 1 |
| 407 | `business-os-v3-centralized-server-template/backend/test/accessControl.test.js` | 2 | 0 | 1 | 0 |
| 408 | `business-os-v3-centralized-server-template/backend/test/backupRoundtrip.test.js` | 6 | 0 | 0 | 0 |
| 409 | `business-os-v3-centralized-server-template/backend/test/backupSchema.test.js` | 2 | 0 | 1 | 0 |
| 410 | `business-os-v3-centralized-server-template/backend/test/dataPath.test.js` | 5 | 0 | 1 | 0 |
| 411 | `business-os-v3-centralized-server-template/backend/test/netSecurity.test.js` | 2 | 0 | 1 | 0 |
| 412 | `business-os-v3-centralized-server-template/backend/test/portalUtils.test.js` | 2 | 0 | 1 | 0 |
| 413 | `business-os-v3-centralized-server-template/backend/test/serverUtils.test.js` | 2 | 0 | 1 | 0 |
| 414 | `business-os-v3-centralized-server-template/backend/test/uploadSecurity.test.js` | 2 | 0 | 1 | 0 |
| 415 | `business-os-v3-centralized-server-template/frontend/postcss.config.js` | 0 | 1 | 0 | 0 |
| 416 | `business-os-v3-centralized-server-template/frontend/src/api/http.js` | 2 | 18 | 2 | 5 |
| 417 | `business-os-v3-centralized-server-template/frontend/src/api/localDb.js` | 1 | 5 | 0 | 2 |
| 418 | `business-os-v3-centralized-server-template/frontend/src/api/methods.js` | 4 | 143 | 4 | 1 |
| 419 | `business-os-v3-centralized-server-template/frontend/src/api/websocket.js` | 2 | 3 | 2 | 2 |
| 420 | `business-os-v3-centralized-server-template/frontend/src/App.jsx` | 24 | 1 | 23 | 1 |
| 421 | `business-os-v3-centralized-server-template/frontend/src/app/appShellUtils.mjs` | 0 | 5 | 0 | 2 |
| 422 | `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx` | 8 | 5 | 7 | 44 |
| 423 | `business-os-v3-centralized-server-template/frontend/src/components/auth/Login.jsx` | 4 | 1 | 3 | 1 |
| 424 | `business-os-v3-centralized-server-template/frontend/src/components/branches/Branches.jsx` | 6 | 1 | 4 | 1 |
| 425 | `business-os-v3-centralized-server-template/frontend/src/components/branches/BranchForm.jsx` | 2 | 1 | 1 | 1 |
| 426 | `business-os-v3-centralized-server-template/frontend/src/components/branches/TransferModal.jsx` | 2 | 1 | 1 | 1 |
| 427 | `business-os-v3-centralized-server-template/frontend/src/components/catalog/CatalogPage.jsx` | 6 | 1 | 5 | 1 |
| 428 | `business-os-v3-centralized-server-template/frontend/src/components/catalog/portalEditorUtils.mjs` | 0 | 6 | 0 | 0 |
| 429 | `business-os-v3-centralized-server-template/frontend/src/components/contacts/Contacts.jsx` | 9 | 1 | 7 | 1 |
| 430 | `business-os-v3-centralized-server-template/frontend/src/components/contacts/CustomersTab.jsx` | 7 | 2 | 5 | 2 |
| 431 | `business-os-v3-centralized-server-template/frontend/src/components/contacts/DeliveryTab.jsx` | 7 | 2 | 5 | 1 |
| 432 | `business-os-v3-centralized-server-template/frontend/src/components/contacts/shared.jsx` | 4 | 5 | 3 | 4 |
| 433 | `business-os-v3-centralized-server-template/frontend/src/components/contacts/SuppliersTab.jsx` | 7 | 0 | 5 | 1 |
| 434 | `business-os-v3-centralized-server-template/frontend/src/components/custom-tables/CustomTables.jsx` | 2 | 1 | 1 | 0 |
| 435 | `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/BarChart.jsx` | 3 | 1 | 2 | 0 |
| 436 | `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/DonutChart.jsx` | 3 | 1 | 2 | 0 |
| 437 | `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/index.js` | 0 | 0 | 0 | 1 |
| 438 | `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/LineChart.jsx` | 3 | 1 | 2 | 0 |
| 439 | `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/NoData.jsx` | 1 | 1 | 1 | 3 |
| 440 | `business-os-v3-centralized-server-template/frontend/src/components/dashboard/Dashboard.jsx` | 9 | 1 | 7 | 1 |
| 441 | `business-os-v3-centralized-server-template/frontend/src/components/dashboard/MiniStat.jsx` | 0 | 1 | 0 | 1 |
| 442 | `business-os-v3-centralized-server-template/frontend/src/components/files/FilePickerModal.jsx` | 3 | 1 | 2 | 5 |
| 443 | `business-os-v3-centralized-server-template/frontend/src/components/files/FilesPage.jsx` | 2 | 1 | 1 | 1 |
| 444 | `business-os-v3-centralized-server-template/frontend/src/components/inventory/DualMoney.jsx` | 0 | 1 | 0 | 2 |
| 445 | `business-os-v3-centralized-server-template/frontend/src/components/inventory/Inventory.jsx` | 8 | 1 | 6 | 1 |
| 446 | `business-os-v3-centralized-server-template/frontend/src/components/inventory/movementGroups.js` | 0 | 2 | 0 | 1 |
| 447 | `business-os-v3-centralized-server-template/frontend/src/components/inventory/ProductDetailModal.jsx` | 1 | 1 | 1 | 1 |
| 448 | `business-os-v3-centralized-server-template/frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | 3 | 1 | 1 | 1 |
| 449 | `business-os-v3-centralized-server-template/frontend/src/components/navigation/Sidebar.jsx` | 4 | 1 | 3 | 1 |
| 450 | `business-os-v3-centralized-server-template/frontend/src/components/pos/CartItem.jsx` | 1 | 1 | 1 | 1 |
| 451 | `business-os-v3-centralized-server-template/frontend/src/components/pos/FilterPanel.jsx` | 1 | 1 | 0 | 1 |
| 452 | `business-os-v3-centralized-server-template/frontend/src/components/pos/POS.jsx` | 12 | 1 | 10 | 1 |
| 453 | `business-os-v3-centralized-server-template/frontend/src/components/pos/ProductImage.jsx` | 1 | 1 | 0 | 2 |
| 454 | `business-os-v3-centralized-server-template/frontend/src/components/pos/QuickAddModal.jsx` | 0 | 1 | 0 | 1 |
| 455 | `business-os-v3-centralized-server-template/frontend/src/components/products/BranchStockAdjuster.jsx` | 1 | 1 | 0 | 1 |
| 456 | `business-os-v3-centralized-server-template/frontend/src/components/products/BulkAddStockModal.jsx` | 2 | 1 | 1 | 1 |
| 457 | `business-os-v3-centralized-server-template/frontend/src/components/products/BulkImportModal.jsx` | 4 | 1 | 3 | 1 |
| 458 | `business-os-v3-centralized-server-template/frontend/src/components/products/HeaderActions.jsx` | 2 | 1 | 1 | 1 |
| 459 | `business-os-v3-centralized-server-template/frontend/src/components/products/ManageBrandsModal.jsx` | 3 | 1 | 2 | 1 |
| 460 | `business-os-v3-centralized-server-template/frontend/src/components/products/ManageCategoriesModal.jsx` | 3 | 1 | 2 | 1 |
| 461 | `business-os-v3-centralized-server-template/frontend/src/components/products/ManageFieldsModal.jsx` | 2 | 1 | 1 | 1 |
| 462 | `business-os-v3-centralized-server-template/frontend/src/components/products/ManageMenu.jsx` | 1 | 1 | 1 | 0 |
| 463 | `business-os-v3-centralized-server-template/frontend/src/components/products/ManageUnitsModal.jsx` | 2 | 1 | 1 | 1 |
| 464 | `business-os-v3-centralized-server-template/frontend/src/components/products/primitives.jsx` | 2 | 0 | 0 | 5 |
| 465 | `business-os-v3-centralized-server-template/frontend/src/components/products/ProductDetailModal.jsx` | 2 | 1 | 1 | 1 |
| 466 | `business-os-v3-centralized-server-template/frontend/src/components/products/ProductForm.jsx` | 5 | 1 | 4 | 1 |
| 467 | `business-os-v3-centralized-server-template/frontend/src/components/products/Products.jsx` | 18 | 1 | 16 | 1 |
| 468 | `business-os-v3-centralized-server-template/frontend/src/components/products/VariantFormModal.jsx` | 4 | 1 | 3 | 1 |
| 469 | `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | 3 | 1 | 2 | 1 |
| 470 | `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/constants.js` | 0 | 3 | 0 | 3 |
| 471 | `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/ErrorBoundary.jsx` | 1 | 1 | 0 | 1 |
| 472 | `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/FieldOrderManager.jsx` | 2 | 1 | 0 | 1 |
| 473 | `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/PrintSettings.jsx` | 3 | 1 | 1 | 1 |
| 474 | `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/ReceiptPreview.jsx` | 2 | 1 | 1 | 1 |
| 475 | `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/ReceiptSettings.jsx` | 9 | 1 | 7 | 1 |
| 476 | `business-os-v3-centralized-server-template/frontend/src/components/receipt/Receipt.jsx` | 6 | 2 | 4 | 3 |
| 477 | `business-os-v3-centralized-server-template/frontend/src/components/returns/EditReturnModal.jsx` | 2 | 1 | 1 | 1 |
| 478 | `business-os-v3-centralized-server-template/frontend/src/components/returns/NewReturnModal.jsx` | 3 | 1 | 2 | 1 |
| 479 | `business-os-v3-centralized-server-template/frontend/src/components/returns/NewSupplierReturnModal.jsx` | 2 | 1 | 1 | 1 |
| 480 | `business-os-v3-centralized-server-template/frontend/src/components/returns/ReturnDetailModal.jsx` | 2 | 1 | 2 | 1 |
| 481 | `business-os-v3-centralized-server-template/frontend/src/components/returns/Returns.jsx` | 9 | 1 | 7 | 1 |
| 482 | `business-os-v3-centralized-server-template/frontend/src/components/sales/ExportModal.jsx` | 4 | 1 | 2 | 1 |
| 483 | `business-os-v3-centralized-server-template/frontend/src/components/sales/SaleDetailModal.jsx` | 3 | 1 | 2 | 1 |
| 484 | `business-os-v3-centralized-server-template/frontend/src/components/sales/Sales.jsx` | 9 | 1 | 7 | 1 |
| 485 | `business-os-v3-centralized-server-template/frontend/src/components/sales/StatusBadge.jsx` | 0 | 5 | 0 | 5 |
| 486 | `business-os-v3-centralized-server-template/frontend/src/components/server/ServerPage.jsx` | 2 | 1 | 1 | 1 |
| 487 | `business-os-v3-centralized-server-template/frontend/src/components/shared/ImageGalleryLightbox.jsx` | 2 | 1 | 0 | 3 |
| 488 | `business-os-v3-centralized-server-template/frontend/src/components/shared/Modal.jsx` | 0 | 1 | 0 | 19 |
| 489 | `business-os-v3-centralized-server-template/frontend/src/components/shared/navigationConfig.js` | 0 | 4 | 0 | 2 |
| 490 | `business-os-v3-centralized-server-template/frontend/src/components/shared/PageHelpButton.jsx` | 4 | 1 | 2 | 1 |
| 491 | `business-os-v3-centralized-server-template/frontend/src/components/shared/pageHelpContent.js` | 0 | 2 | 0 | 1 |
| 492 | `business-os-v3-centralized-server-template/frontend/src/components/shared/PortalMenu.jsx` | 3 | 2 | 0 | 5 |
| 493 | `business-os-v3-centralized-server-template/frontend/src/components/users/PermissionEditor.jsx` | 0 | 2 | 0 | 2 |
| 494 | `business-os-v3-centralized-server-template/frontend/src/components/users/UserDetailSheet.jsx` | 2 | 1 | 2 | 1 |
| 495 | `business-os-v3-centralized-server-template/frontend/src/components/users/UserProfileModal.jsx` | 7 | 1 | 5 | 2 |
| 496 | `business-os-v3-centralized-server-template/frontend/src/components/users/Users.jsx` | 9 | 1 | 7 | 1 |
| 497 | `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/AuditLog.jsx` | 4 | 1 | 2 | 1 |
| 498 | `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/Backup.jsx` | 6 | 1 | 4 | 1 |
| 499 | `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/FontFamilyPicker.jsx` | 1 | 1 | 0 | 1 |
| 500 | `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/index.js` | 0 | 0 | 0 | 0 |
| 501 | `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/OtpModal.jsx` | 2 | 1 | 1 | 2 |
| 502 | `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/ResetData.jsx` | 4 | 0 | 2 | 1 |
| 503 | `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/Settings.jsx` | 7 | 1 | 5 | 1 |
| 504 | `business-os-v3-centralized-server-template/frontend/src/constants.js` | 0 | 12 | 0 | 7 |
| 505 | `business-os-v3-centralized-server-template/frontend/src/index.jsx` | 5 | 0 | 3 | 0 |
| 506 | `business-os-v3-centralized-server-template/frontend/src/utils/appRefresh.js` | 0 | 1 | 0 | 2 |
| 507 | `business-os-v3-centralized-server-template/frontend/src/utils/csv.js` | 0 | 1 | 0 | 9 |
| 508 | `business-os-v3-centralized-server-template/frontend/src/utils/dateHelpers.js` | 0 | 2 | 0 | 1 |
| 509 | `business-os-v3-centralized-server-template/frontend/src/utils/deviceInfo.js` | 0 | 2 | 0 | 6 |
| 510 | `business-os-v3-centralized-server-template/frontend/src/utils/favicon.js` | 0 | 1 | 0 | 3 |
| 511 | `business-os-v3-centralized-server-template/frontend/src/utils/firebasePhoneAuth.js` | 0 | 3 | 0 | 0 |
| 512 | `business-os-v3-centralized-server-template/frontend/src/utils/formatters.js` | 0 | 4 | 0 | 15 |
| 513 | `business-os-v3-centralized-server-template/frontend/src/utils/index.js` | 0 | 0 | 0 | 0 |
| 514 | `business-os-v3-centralized-server-template/frontend/src/utils/printReceipt.js` | 0 | 8 | 0 | 2 |
| 515 | `business-os-v3-centralized-server-template/frontend/src/web-api.js` | 5 | 0 | 5 | 1 |
| 516 | `business-os-v3-centralized-server-template/frontend/tailwind.config.js` | 0 | 1 | 0 | 0 |
| 517 | `business-os-v3-centralized-server-template/frontend/tests/appShellUtils.test.mjs` | 2 | 0 | 1 | 0 |
| 518 | `business-os-v3-centralized-server-template/frontend/tests/portalEditorUtils.test.mjs` | 1 | 0 | 0 | 0 |
| 519 | `business-os-v3-centralized-server-template/frontend/vite.config.mjs` | 2 | 1 | 0 | 0 |
| 520 | `frontend/postcss.config.js` | 0 | 1 | 0 | 0 |
| 521 | `frontend/src/api/http.js` | 2 | 18 | 2 | 5 |
| 522 | `frontend/src/api/localDb.js` | 1 | 5 | 0 | 2 |
| 523 | `frontend/src/api/methods.js` | 4 | 143 | 4 | 1 |
| 524 | `frontend/src/api/websocket.js` | 2 | 3 | 2 | 2 |
| 525 | `frontend/src/App.jsx` | 24 | 1 | 23 | 1 |
| 526 | `frontend/src/app/appShellUtils.mjs` | 0 | 5 | 0 | 2 |
| 527 | `frontend/src/AppContext.jsx` | 8 | 5 | 7 | 44 |
| 528 | `frontend/src/components/auth/Login.jsx` | 4 | 1 | 3 | 1 |
| 529 | `frontend/src/components/branches/Branches.jsx` | 6 | 1 | 4 | 1 |
| 530 | `frontend/src/components/branches/BranchForm.jsx` | 2 | 1 | 1 | 1 |
| 531 | `frontend/src/components/branches/TransferModal.jsx` | 2 | 1 | 1 | 1 |
| 532 | `frontend/src/components/catalog/CatalogPage.jsx` | 6 | 1 | 5 | 1 |
| 533 | `frontend/src/components/catalog/portalEditorUtils.mjs` | 0 | 6 | 0 | 0 |
| 534 | `frontend/src/components/contacts/Contacts.jsx` | 9 | 1 | 7 | 1 |
| 535 | `frontend/src/components/contacts/CustomersTab.jsx` | 7 | 2 | 5 | 2 |
| 536 | `frontend/src/components/contacts/DeliveryTab.jsx` | 7 | 2 | 5 | 1 |
| 537 | `frontend/src/components/contacts/shared.jsx` | 4 | 5 | 3 | 4 |
| 538 | `frontend/src/components/contacts/SuppliersTab.jsx` | 7 | 0 | 5 | 1 |
| 539 | `frontend/src/components/custom-tables/CustomTables.jsx` | 2 | 1 | 1 | 0 |
| 540 | `frontend/src/components/dashboard/charts/BarChart.jsx` | 3 | 1 | 2 | 0 |
| 541 | `frontend/src/components/dashboard/charts/DonutChart.jsx` | 3 | 1 | 2 | 0 |
| 542 | `frontend/src/components/dashboard/charts/index.js` | 0 | 0 | 0 | 1 |
| 543 | `frontend/src/components/dashboard/charts/LineChart.jsx` | 3 | 1 | 2 | 0 |
| 544 | `frontend/src/components/dashboard/charts/NoData.jsx` | 1 | 1 | 1 | 3 |
| 545 | `frontend/src/components/dashboard/Dashboard.jsx` | 9 | 1 | 7 | 1 |
| 546 | `frontend/src/components/dashboard/MiniStat.jsx` | 0 | 1 | 0 | 1 |
| 547 | `frontend/src/components/files/FilePickerModal.jsx` | 3 | 1 | 2 | 5 |
| 548 | `frontend/src/components/files/FilesPage.jsx` | 2 | 1 | 1 | 1 |
| 549 | `frontend/src/components/inventory/DualMoney.jsx` | 0 | 1 | 0 | 2 |
| 550 | `frontend/src/components/inventory/Inventory.jsx` | 8 | 1 | 6 | 1 |
| 551 | `frontend/src/components/inventory/movementGroups.js` | 0 | 2 | 0 | 1 |
| 552 | `frontend/src/components/inventory/ProductDetailModal.jsx` | 1 | 1 | 1 | 1 |
| 553 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | 3 | 1 | 1 | 1 |
| 554 | `frontend/src/components/navigation/Sidebar.jsx` | 4 | 1 | 3 | 1 |
| 555 | `frontend/src/components/pos/CartItem.jsx` | 1 | 1 | 1 | 1 |
| 556 | `frontend/src/components/pos/FilterPanel.jsx` | 1 | 1 | 0 | 1 |
| 557 | `frontend/src/components/pos/POS.jsx` | 12 | 1 | 10 | 1 |
| 558 | `frontend/src/components/pos/ProductImage.jsx` | 1 | 1 | 0 | 2 |
| 559 | `frontend/src/components/pos/QuickAddModal.jsx` | 0 | 1 | 0 | 1 |
| 560 | `frontend/src/components/products/BranchStockAdjuster.jsx` | 1 | 1 | 0 | 1 |
| 561 | `frontend/src/components/products/BulkAddStockModal.jsx` | 2 | 1 | 1 | 1 |
| 562 | `frontend/src/components/products/BulkImportModal.jsx` | 4 | 1 | 3 | 1 |
| 563 | `frontend/src/components/products/HeaderActions.jsx` | 2 | 1 | 1 | 1 |
| 564 | `frontend/src/components/products/ManageBrandsModal.jsx` | 3 | 1 | 2 | 1 |
| 565 | `frontend/src/components/products/ManageCategoriesModal.jsx` | 3 | 1 | 2 | 1 |
| 566 | `frontend/src/components/products/ManageFieldsModal.jsx` | 2 | 1 | 1 | 1 |
| 567 | `frontend/src/components/products/ManageMenu.jsx` | 1 | 1 | 1 | 0 |
| 568 | `frontend/src/components/products/ManageUnitsModal.jsx` | 2 | 1 | 1 | 1 |
| 569 | `frontend/src/components/products/primitives.jsx` | 2 | 0 | 0 | 5 |
| 570 | `frontend/src/components/products/ProductDetailModal.jsx` | 2 | 1 | 1 | 1 |
| 571 | `frontend/src/components/products/ProductForm.jsx` | 5 | 1 | 4 | 1 |
| 572 | `frontend/src/components/products/Products.jsx` | 18 | 1 | 16 | 1 |
| 573 | `frontend/src/components/products/VariantFormModal.jsx` | 4 | 1 | 3 | 1 |
| 574 | `frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | 3 | 1 | 2 | 1 |
| 575 | `frontend/src/components/receipt-settings/constants.js` | 0 | 3 | 0 | 3 |
| 576 | `frontend/src/components/receipt-settings/ErrorBoundary.jsx` | 1 | 1 | 0 | 1 |
| 577 | `frontend/src/components/receipt-settings/FieldOrderManager.jsx` | 2 | 1 | 0 | 1 |
| 578 | `frontend/src/components/receipt-settings/PrintSettings.jsx` | 3 | 1 | 1 | 1 |
| 579 | `frontend/src/components/receipt-settings/ReceiptPreview.jsx` | 2 | 1 | 1 | 1 |
| 580 | `frontend/src/components/receipt-settings/ReceiptSettings.jsx` | 9 | 1 | 7 | 1 |
| 581 | `frontend/src/components/receipt/Receipt.jsx` | 6 | 2 | 4 | 3 |
| 582 | `frontend/src/components/returns/EditReturnModal.jsx` | 2 | 1 | 1 | 1 |
| 583 | `frontend/src/components/returns/NewReturnModal.jsx` | 3 | 1 | 2 | 1 |
| 584 | `frontend/src/components/returns/NewSupplierReturnModal.jsx` | 2 | 1 | 1 | 1 |
| 585 | `frontend/src/components/returns/ReturnDetailModal.jsx` | 2 | 1 | 2 | 1 |
| 586 | `frontend/src/components/returns/Returns.jsx` | 9 | 1 | 7 | 1 |
| 587 | `frontend/src/components/sales/ExportModal.jsx` | 4 | 1 | 2 | 1 |
| 588 | `frontend/src/components/sales/SaleDetailModal.jsx` | 3 | 1 | 2 | 1 |
| 589 | `frontend/src/components/sales/Sales.jsx` | 9 | 1 | 7 | 1 |
| 590 | `frontend/src/components/sales/StatusBadge.jsx` | 0 | 5 | 0 | 5 |
| 591 | `frontend/src/components/server/ServerPage.jsx` | 2 | 1 | 1 | 1 |
| 592 | `frontend/src/components/shared/ImageGalleryLightbox.jsx` | 2 | 1 | 0 | 3 |
| 593 | `frontend/src/components/shared/Modal.jsx` | 0 | 1 | 0 | 19 |
| 594 | `frontend/src/components/shared/navigationConfig.js` | 0 | 4 | 0 | 2 |
| 595 | `frontend/src/components/shared/PageHelpButton.jsx` | 4 | 1 | 2 | 1 |
| 596 | `frontend/src/components/shared/pageHelpContent.js` | 0 | 2 | 0 | 1 |
| 597 | `frontend/src/components/shared/PortalMenu.jsx` | 3 | 2 | 0 | 5 |
| 598 | `frontend/src/components/users/PermissionEditor.jsx` | 0 | 2 | 0 | 2 |
| 599 | `frontend/src/components/users/UserDetailSheet.jsx` | 2 | 1 | 2 | 1 |
| 600 | `frontend/src/components/users/UserProfileModal.jsx` | 7 | 1 | 5 | 2 |
| 601 | `frontend/src/components/users/Users.jsx` | 9 | 1 | 7 | 1 |
| 602 | `frontend/src/components/utils-settings/AuditLog.jsx` | 4 | 1 | 2 | 1 |
| 603 | `frontend/src/components/utils-settings/Backup.jsx` | 6 | 1 | 4 | 1 |
| 604 | `frontend/src/components/utils-settings/FontFamilyPicker.jsx` | 1 | 1 | 0 | 1 |
| 605 | `frontend/src/components/utils-settings/index.js` | 0 | 0 | 0 | 0 |
| 606 | `frontend/src/components/utils-settings/OtpModal.jsx` | 2 | 1 | 1 | 2 |
| 607 | `frontend/src/components/utils-settings/ResetData.jsx` | 4 | 0 | 2 | 1 |
| 608 | `frontend/src/components/utils-settings/Settings.jsx` | 7 | 1 | 5 | 1 |
| 609 | `frontend/src/constants.js` | 0 | 12 | 0 | 7 |
| 610 | `frontend/src/index.jsx` | 5 | 0 | 3 | 0 |
| 611 | `frontend/src/utils/appRefresh.js` | 0 | 1 | 0 | 2 |
| 612 | `frontend/src/utils/csv.js` | 0 | 1 | 0 | 9 |
| 613 | `frontend/src/utils/dateHelpers.js` | 0 | 2 | 0 | 1 |
| 614 | `frontend/src/utils/deviceInfo.js` | 0 | 2 | 0 | 6 |
| 615 | `frontend/src/utils/favicon.js` | 0 | 1 | 0 | 3 |
| 616 | `frontend/src/utils/firebasePhoneAuth.js` | 0 | 3 | 0 | 0 |
| 617 | `frontend/src/utils/formatters.js` | 0 | 4 | 0 | 15 |
| 618 | `frontend/src/utils/index.js` | 0 | 0 | 0 | 0 |
| 619 | `frontend/src/utils/printReceipt.js` | 0 | 8 | 0 | 2 |
| 620 | `frontend/src/web-api.js` | 5 | 0 | 5 | 1 |
| 621 | `frontend/tailwind.config.js` | 0 | 1 | 0 | 0 |
| 622 | `frontend/tests/appShellUtils.test.mjs` | 2 | 0 | 1 | 0 |
| 623 | `frontend/tests/portalEditorUtils.test.mjs` | 1 | 0 | 0 | 0 |
| 624 | `frontend/vite.config.mjs` | 2 | 1 | 0 | 0 |
| 625 | `ops/scripts/backend/verify-data-integrity.js` | 4 | 0 | 3 | 0 |
| 626 | `ops/scripts/frontend/verify-i18n.js` | 2 | 0 | 1 | 0 |
| 627 | `ops/scripts/generate-doc-reference.js` | 3 | 0 | 1 | 0 |
| 628 | `ops/scripts/generate-full-project-docs.js` | 3 | 1 | 1 | 0 |
| 629 | `ops/scripts/lib/fs-utils.js` | 2 | 1 | 0 | 4 |
| 630 | `ops/scripts/performance-scan.js` | 3 | 0 | 1 | 0 |

## 3. Detailed File Dependency Commentary

### 3.1 `backend/server.js`

- Declared exports: none detected
- Imports (32)
  - `./src/config`
  - `./src/database`
  - `./src/helpers`
  - `./src/middleware`
  - `./src/organizationContext`
  - `./src/requestContext`
  - `./src/routes/ai`
  - `./src/routes/auth`
  - `./src/routes/branches`
  - `./src/routes/catalog`
  - `./src/routes/categories`
  - `./src/routes/contacts`
  - `./src/routes/customTables`
  - `./src/routes/files`
  - `./src/routes/inventory`
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
  - `./src/websocket`
  - `compression`
  - `cors`
  - `express`
  - `fs`
  - `http`
  - `path`
- Internal dependencies (26)
  - `backend/src/config.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/organizationContext.js`
  - `backend/src/requestContext.js`
  - `backend/src/routes/ai.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/branches.js`
  - `backend/src/routes/catalog.js`
  - `backend/src/routes/categories.js`
  - `backend/src/routes/contacts.js`
  - `backend/src/routes/customTables.js`
  - `backend/src/routes/files.js`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/organizations.js`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/returns.js`
  - `backend/src/routes/sales.js`
  - `backend/src/routes/settings.js`
  - `backend/src/routes/system.js`
  - `backend/src/routes/units.js`
  - `backend/src/routes/users.js`
  - `backend/src/serverUtils.js`
  - `backend/src/websocket.js`
- Referenced by (0)
  - none

### 3.2 `backend/src/accessControl.js`

- Declared exports: `module.exports`
- Imports (2)
  - `./config`
  - `./security`
- Internal dependencies (2)
  - `backend/src/config.js`
  - `backend/src/security.js`
- Referenced by (3)
  - `backend/src/middleware.js`
  - `backend/src/routes/system.js`
  - `backend/test/accessControl.test.js`

### 3.3 `backend/src/backupSchema.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/routes/system.js`
  - `backend/test/backupSchema.test.js`

### 3.4 `backend/src/config.js`

- Declared exports: `module.exports`
- Imports (3)
  - `dotenv`
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (10)
  - `backend/server.js`
  - `backend/src/accessControl.js`
  - `backend/src/database.js`
  - `backend/src/fileAssets.js`
  - `backend/src/middleware.js`
  - `backend/src/organizationContext.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/system.js`
  - `backend/src/services/googleDriveSync.js`
  - `ops/scripts/backend/verify-data-integrity.js`

### 3.5 `backend/src/database.js`

- Declared exports: `module.exports`
- Imports (6)
  - `./config`
  - `bcryptjs`
  - `better-sqlite3`
  - `crypto`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `backend/src/config.js`
- Referenced by (25)
  - `backend/server.js`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/organizationContext.js`
  - `backend/src/routes/ai.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/branches.js`
  - `backend/src/routes/catalog.js`
  - `backend/src/routes/categories.js`
  - `backend/src/routes/contacts.js`
  - `backend/src/routes/customTables.js`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/returns.js`
  - `backend/src/routes/sales.js`
  - `backend/src/routes/settings.js`
  - `backend/src/routes/system.js`
  - `backend/src/routes/units.js`
  - `backend/src/routes/users.js`
  - `backend/src/services/googleDriveSync.js`
  - `backend/src/services/portalAi.js`
  - `backend/src/services/verification.js`
  - `backend/src/sessionAuth.js`
  - `ops/scripts/backend/verify-data-integrity.js`

### 3.6 `backend/src/dataPath.js`

- Declared exports: `module.exports`
- Imports (2)
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `backend/src/routes/system.js`
  - `backend/src/services/googleDriveSync.js`
  - `backend/src/systemFsWorker.js`
  - `backend/test/dataPath.test.js`

### 3.7 `backend/src/fileAssets.js`

- Declared exports: `module.exports`
- Imports (6)
  - `./config`
  - `./database`
  - `./uploadSecurity`
  - `fs`
  - `path`
  - `sharp`
- Internal dependencies (3)
  - `backend/src/config.js`
  - `backend/src/database.js`
  - `backend/src/uploadSecurity.js`
- Referenced by (5)
  - `backend/src/middleware.js`
  - `backend/src/routes/files.js`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/users.js`

### 3.8 `backend/src/helpers.js`

- Declared exports: `module.exports`
- Imports (3)
  - `./database`
  - `./requestContext`
  - `./services/googleDriveSync`
- Internal dependencies (3)
  - `backend/src/database.js`
  - `backend/src/requestContext.js`
  - `backend/src/services/googleDriveSync.js`
- Referenced by (20)
  - `backend/server.js`
  - `backend/src/routes/ai.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/branches.js`
  - `backend/src/routes/catalog.js`
  - `backend/src/routes/categories.js`
  - `backend/src/routes/contacts.js`
  - `backend/src/routes/customTables.js`
  - `backend/src/routes/files.js`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/returns.js`
  - `backend/src/routes/sales.js`
  - `backend/src/routes/settings.js`
  - `backend/src/routes/system.js`
  - `backend/src/routes/units.js`
  - `backend/src/routes/users.js`
  - `backend/src/websocket.js`
  - `ops/scripts/backend/verify-data-integrity.js`

### 3.9 `backend/src/middleware.js`

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
  - `backend/src/config.js`
  - `backend/src/fileAssets.js`
  - `backend/src/security.js`
  - `backend/src/sessionAuth.js`
  - `backend/src/uploadSecurity.js`
- Referenced by (18)
  - `backend/server.js`
  - `backend/src/routes/ai.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/branches.js`
  - `backend/src/routes/categories.js`
  - `backend/src/routes/contacts.js`
  - `backend/src/routes/customTables.js`
  - `backend/src/routes/files.js`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/organizations.js`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/returns.js`
  - `backend/src/routes/sales.js`
  - `backend/src/routes/settings.js`
  - `backend/src/routes/system.js`
  - `backend/src/routes/units.js`
  - `backend/src/routes/users.js`

### 3.10 `backend/src/netSecurity.js`

- Declared exports: `module.exports`
- Imports (1)
  - `net`
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/src/services/aiGateway.js`
  - `backend/test/netSecurity.test.js`

### 3.11 `backend/src/organizationContext.js`

- Declared exports: `module.exports`
- Imports (5)
  - `./config`
  - `./database`
  - `crypto`
  - `fs`
  - `path`
- Internal dependencies (2)
  - `backend/src/config.js`
  - `backend/src/database.js`
- Referenced by (5)
  - `backend/server.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/organizations.js`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/users.js`

### 3.12 `backend/src/portalUtils.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/routes/portal.js`
  - `backend/test/portalUtils.test.js`

### 3.13 `backend/src/requestContext.js`

- Declared exports: `module.exports`
- Imports (1)
  - `async_hooks`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/server.js`
  - `backend/src/helpers.js`

### 3.14 `backend/src/routes/ai.js`

- Declared exports: `module.exports`
- Imports (5)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `../services/aiGateway`
  - `express`
- Internal dependencies (4)
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/services/aiGateway.js`
- Referenced by (1)
  - `backend/server.js`

### 3.15 `backend/src/routes/auth.js`

- Declared exports: `module.exports`
- Imports (13)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `../organizationContext`
  - `../security`
  - `../services/supabaseAuth`
  - `../services/verification`
  - `../sessionAuth`
  - `bcryptjs`
  - `crypto`
  - `express`
  - `qrcode`
  - `speakeasy`
- Internal dependencies (8)
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/organizationContext.js`
  - `backend/src/security.js`
  - `backend/src/services/supabaseAuth.js`
  - `backend/src/services/verification.js`
  - `backend/src/sessionAuth.js`
- Referenced by (1)
  - `backend/server.js`

### 3.16 `backend/src/routes/branches.js`

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

### 3.17 `backend/src/routes/catalog.js`

- Declared exports: `module.exports`
- Imports (3)
  - `../database`
  - `../helpers`
  - `express`
- Internal dependencies (2)
  - `backend/src/database.js`
  - `backend/src/helpers.js`
- Referenced by (1)
  - `backend/server.js`

### 3.18 `backend/src/routes/categories.js`

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

### 3.19 `backend/src/routes/contacts.js`

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

### 3.20 `backend/src/routes/customTables.js`

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

### 3.21 `backend/src/routes/files.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
- Referenced by (1)
  - `backend/server.js`

### 3.22 `backend/src/routes/inventory.js`

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

### 3.23 `backend/src/routes/organizations.js`

- Declared exports: `module.exports`
- Imports (3)
  - `../middleware`
  - `../organizationContext`
  - `express`
- Internal dependencies (2)
  - `backend/src/middleware.js`
  - `backend/src/organizationContext.js`
- Referenced by (1)
  - `backend/server.js`

### 3.24 `backend/src/routes/portal.js`

- Declared exports: `module.exports`
- Imports (10)
  - `../database`
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `../netSecurity`
  - `../organizationContext`
  - `../portalUtils`
  - `../security`
  - `../services/portalAi`
  - `express`
- Internal dependencies (9)
  - `backend/src/database.js`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/netSecurity.js`
  - `backend/src/organizationContext.js`
  - `backend/src/portalUtils.js`
  - `backend/src/security.js`
  - `backend/src/services/portalAi.js`
- Referenced by (1)
  - `backend/server.js`

### 3.25 `backend/src/routes/products.js`

- Declared exports: `module.exports`
- Imports (9)
  - `../config`
  - `../database`
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `../netSecurity`
  - `express`
  - `fs`
  - `path`
- Internal dependencies (6)
  - `backend/src/config.js`
  - `backend/src/database.js`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/netSecurity.js`
- Referenced by (1)
  - `backend/server.js`

### 3.26 `backend/src/routes/returns.js`

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

### 3.27 `backend/src/routes/sales.js`

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

### 3.28 `backend/src/routes/settings.js`

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

### 3.29 `backend/src/routes/system.js`

- Declared exports: `module.exports`
- Imports (15)
  - `../accessControl`
  - `../backupSchema`
  - `../config`
  - `../dataPath`
  - `../database`
  - `../helpers`
  - `../middleware`
  - `../security`
  - `../services/googleDriveSync`
  - `bcryptjs`
  - `better-sqlite3`
  - `child_process`
  - `express`
  - `fs`
  - `path`
- Internal dependencies (9)
  - `backend/src/accessControl.js`
  - `backend/src/backupSchema.js`
  - `backend/src/config.js`
  - `backend/src/dataPath.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/security.js`
  - `backend/src/services/googleDriveSync.js`
- Referenced by (1)
  - `backend/server.js`

### 3.30 `backend/src/routes/units.js`

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

### 3.31 `backend/src/routes/users.js`

- Declared exports: `module.exports`
- Imports (9)
  - `../database`
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `../organizationContext`
  - `../services/supabaseAuth`
  - `../services/verification`
  - `bcryptjs`
  - `express`
- Internal dependencies (7)
  - `backend/src/database.js`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/organizationContext.js`
  - `backend/src/services/supabaseAuth.js`
  - `backend/src/services/verification.js`
- Referenced by (1)
  - `backend/server.js`

### 3.32 `backend/src/security.js`

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
  - `backend/src/routes/system.js`
  - `backend/src/services/aiGateway.js`
  - `backend/src/services/googleDriveSync.js`

### 3.33 `backend/src/serverUtils.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/server.js`
  - `backend/test/serverUtils.test.js`

### 3.34 `backend/src/services/aiGateway.js`

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

### 3.35 `backend/src/services/firebaseAuth.js`

- Declared exports: `module.exports`
- Imports (2)
  - `crypto`
  - `fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.36 `backend/src/services/googleDriveSync.js`

- Declared exports: `module.exports`
- Imports (8)
  - `../config`
  - `../dataPath`
  - `../database`
  - `../security`
  - `crypto`
  - `fs`
  - `os`
  - `path`
- Internal dependencies (4)
  - `backend/src/config.js`
  - `backend/src/dataPath.js`
  - `backend/src/database.js`
  - `backend/src/security.js`
- Referenced by (2)
  - `backend/src/helpers.js`
  - `backend/src/routes/system.js`

### 3.37 `backend/src/services/portalAi.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../database`
  - `./aiGateway`
- Internal dependencies (2)
  - `backend/src/database.js`
  - `backend/src/services/aiGateway.js`
- Referenced by (1)
  - `backend/src/routes/portal.js`

### 3.38 `backend/src/services/supabaseAuth.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/routes/auth.js`
  - `backend/src/routes/users.js`

### 3.39 `backend/src/services/verification.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../database`
  - `crypto`
- Internal dependencies (1)
  - `backend/src/database.js`
- Referenced by (2)
  - `backend/src/routes/auth.js`
  - `backend/src/routes/users.js`

### 3.40 `backend/src/sessionAuth.js`

- Declared exports: `module.exports`
- Imports (2)
  - `./database`
  - `crypto`
- Internal dependencies (1)
  - `backend/src/database.js`
- Referenced by (3)
  - `backend/src/middleware.js`
  - `backend/src/routes/auth.js`
  - `backend/src/websocket.js`

### 3.41 `backend/src/systemFsWorker.js`

- Declared exports: none detected
- Imports (3)
  - `./dataPath`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `backend/src/dataPath.js`
- Referenced by (0)
  - none

### 3.42 `backend/src/uploadSecurity.js`

- Declared exports: `module.exports`
- Imports (2)
  - `fs`
  - `sharp`
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `backend/src/fileAssets.js`
  - `backend/src/middleware.js`
  - `backend/test/uploadSecurity.test.js`

### 3.43 `backend/src/websocket.js`

- Declared exports: `module.exports`
- Imports (4)
  - `./helpers`
  - `./sessionAuth`
  - `http`
  - `ws`
- Internal dependencies (2)
  - `backend/src/helpers.js`
  - `backend/src/sessionAuth.js`
- Referenced by (1)
  - `backend/server.js`

### 3.44 `backend/test/accessControl.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/accessControl`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/accessControl.js`
- Referenced by (0)
  - none

### 3.45 `backend/test/backupRoundtrip.test.js`

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

### 3.46 `backend/test/backupSchema.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/backupSchema`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/backupSchema.js`
- Referenced by (0)
  - none

### 3.47 `backend/test/dataPath.test.js`

- Declared exports: none detected
- Imports (5)
  - `../src/dataPath`
  - `fs`
  - `node:assert/strict`
  - `os`
  - `path`
- Internal dependencies (1)
  - `backend/src/dataPath.js`
- Referenced by (0)
  - none

### 3.48 `backend/test/netSecurity.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/netSecurity`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/netSecurity.js`
- Referenced by (0)
  - none

### 3.49 `backend/test/portalUtils.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/portalUtils`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/portalUtils.js`
- Referenced by (0)
  - none

### 3.50 `backend/test/serverUtils.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/serverUtils`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/serverUtils.js`
- Referenced by (0)
  - none

### 3.51 `backend/test/uploadSecurity.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/uploadSecurity`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/uploadSecurity.js`
- Referenced by (0)
  - none

### 3.52 `business-os-v1-centralized-org-path/backend/server.js`

- Declared exports: none detected
- Imports (32)
  - `./src/config`
  - `./src/database`
  - `./src/helpers`
  - `./src/middleware`
  - `./src/organizationContext`
  - `./src/requestContext`
  - `./src/routes/ai`
  - `./src/routes/auth`
  - `./src/routes/branches`
  - `./src/routes/catalog`
  - `./src/routes/categories`
  - `./src/routes/contacts`
  - `./src/routes/customTables`
  - `./src/routes/files`
  - `./src/routes/inventory`
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
  - `./src/websocket`
  - `compression`
  - `cors`
  - `express`
  - `fs`
  - `http`
  - `path`
- Internal dependencies (26)
  - `business-os-v1-centralized-org-path/backend/src/config.js`
  - `business-os-v1-centralized-org-path/backend/src/database.js`
  - `business-os-v1-centralized-org-path/backend/src/helpers.js`
  - `business-os-v1-centralized-org-path/backend/src/middleware.js`
  - `business-os-v1-centralized-org-path/backend/src/organizationContext.js`
  - `business-os-v1-centralized-org-path/backend/src/requestContext.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/ai.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/auth.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/branches.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/catalog.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/categories.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/contacts.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/customTables.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/files.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/inventory.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/organizations.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/portal.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/products.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/returns.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/sales.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/settings.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/system.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/units.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/users.js`
  - `business-os-v1-centralized-org-path/backend/src/serverUtils.js`
  - `business-os-v1-centralized-org-path/backend/src/websocket.js`
- Referenced by (0)
  - none

### 3.53 `business-os-v1-centralized-org-path/backend/src/accessControl.js`

- Declared exports: `module.exports`
- Imports (2)
  - `./config`
  - `./security`
- Internal dependencies (2)
  - `business-os-v1-centralized-org-path/backend/src/config.js`
  - `business-os-v1-centralized-org-path/backend/src/security.js`
- Referenced by (3)
  - `business-os-v1-centralized-org-path/backend/src/middleware.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/system.js`
  - `business-os-v1-centralized-org-path/backend/test/accessControl.test.js`

### 3.54 `business-os-v1-centralized-org-path/backend/src/backupSchema.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v1-centralized-org-path/backend/src/routes/system.js`
  - `business-os-v1-centralized-org-path/backend/test/backupSchema.test.js`

### 3.55 `business-os-v1-centralized-org-path/backend/src/config.js`

- Declared exports: `module.exports`
- Imports (3)
  - `dotenv`
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (9)
  - `business-os-v1-centralized-org-path/backend/server.js`
  - `business-os-v1-centralized-org-path/backend/src/accessControl.js`
  - `business-os-v1-centralized-org-path/backend/src/database.js`
  - `business-os-v1-centralized-org-path/backend/src/fileAssets.js`
  - `business-os-v1-centralized-org-path/backend/src/middleware.js`
  - `business-os-v1-centralized-org-path/backend/src/organizationContext.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/products.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/system.js`
  - `business-os-v1-centralized-org-path/backend/src/services/googleDriveSync.js`

### 3.56 `business-os-v1-centralized-org-path/backend/src/database.js`

- Declared exports: `module.exports`
- Imports (6)
  - `./config`
  - `bcryptjs`
  - `better-sqlite3`
  - `crypto`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/backend/src/config.js`
- Referenced by (24)
  - `business-os-v1-centralized-org-path/backend/server.js`
  - `business-os-v1-centralized-org-path/backend/src/fileAssets.js`
  - `business-os-v1-centralized-org-path/backend/src/helpers.js`
  - `business-os-v1-centralized-org-path/backend/src/organizationContext.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/ai.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/auth.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/branches.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/catalog.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/categories.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/contacts.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/customTables.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/inventory.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/portal.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/products.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/returns.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/sales.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/settings.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/system.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/units.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/users.js`
  - `business-os-v1-centralized-org-path/backend/src/services/googleDriveSync.js`
  - `business-os-v1-centralized-org-path/backend/src/services/portalAi.js`
  - `business-os-v1-centralized-org-path/backend/src/services/verification.js`
  - `business-os-v1-centralized-org-path/backend/src/sessionAuth.js`

### 3.57 `business-os-v1-centralized-org-path/backend/src/dataPath.js`

- Declared exports: `module.exports`
- Imports (2)
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `business-os-v1-centralized-org-path/backend/src/routes/system.js`
  - `business-os-v1-centralized-org-path/backend/src/services/googleDriveSync.js`
  - `business-os-v1-centralized-org-path/backend/src/systemFsWorker.js`
  - `business-os-v1-centralized-org-path/backend/test/dataPath.test.js`

### 3.58 `business-os-v1-centralized-org-path/backend/src/fileAssets.js`

- Declared exports: `module.exports`
- Imports (6)
  - `./config`
  - `./database`
  - `./uploadSecurity`
  - `fs`
  - `path`
  - `sharp`
- Internal dependencies (3)
  - `business-os-v1-centralized-org-path/backend/src/config.js`
  - `business-os-v1-centralized-org-path/backend/src/database.js`
  - `business-os-v1-centralized-org-path/backend/src/uploadSecurity.js`
- Referenced by (5)
  - `business-os-v1-centralized-org-path/backend/src/middleware.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/files.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/portal.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/products.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/users.js`

### 3.59 `business-os-v1-centralized-org-path/backend/src/helpers.js`

- Declared exports: `module.exports`
- Imports (3)
  - `./database`
  - `./requestContext`
  - `./services/googleDriveSync`
- Internal dependencies (3)
  - `business-os-v1-centralized-org-path/backend/src/database.js`
  - `business-os-v1-centralized-org-path/backend/src/requestContext.js`
  - `business-os-v1-centralized-org-path/backend/src/services/googleDriveSync.js`
- Referenced by (19)
  - `business-os-v1-centralized-org-path/backend/server.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/ai.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/auth.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/branches.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/catalog.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/categories.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/contacts.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/customTables.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/files.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/inventory.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/portal.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/products.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/returns.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/sales.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/settings.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/system.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/units.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/users.js`
  - `business-os-v1-centralized-org-path/backend/src/websocket.js`

### 3.60 `business-os-v1-centralized-org-path/backend/src/middleware.js`

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
  - `business-os-v1-centralized-org-path/backend/src/accessControl.js`
  - `business-os-v1-centralized-org-path/backend/src/config.js`
  - `business-os-v1-centralized-org-path/backend/src/fileAssets.js`
  - `business-os-v1-centralized-org-path/backend/src/security.js`
  - `business-os-v1-centralized-org-path/backend/src/sessionAuth.js`
  - `business-os-v1-centralized-org-path/backend/src/uploadSecurity.js`
- Referenced by (18)
  - `business-os-v1-centralized-org-path/backend/server.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/ai.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/auth.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/branches.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/categories.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/contacts.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/customTables.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/files.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/inventory.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/organizations.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/portal.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/products.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/returns.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/sales.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/settings.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/system.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/units.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/users.js`

### 3.61 `business-os-v1-centralized-org-path/backend/src/netSecurity.js`

- Declared exports: `module.exports`
- Imports (1)
  - `net`
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `business-os-v1-centralized-org-path/backend/src/routes/portal.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/products.js`
  - `business-os-v1-centralized-org-path/backend/src/services/aiGateway.js`
  - `business-os-v1-centralized-org-path/backend/test/netSecurity.test.js`

### 3.62 `business-os-v1-centralized-org-path/backend/src/organizationContext.js`

- Declared exports: `module.exports`
- Imports (5)
  - `./config`
  - `./database`
  - `crypto`
  - `fs`
  - `path`
- Internal dependencies (2)
  - `business-os-v1-centralized-org-path/backend/src/config.js`
  - `business-os-v1-centralized-org-path/backend/src/database.js`
- Referenced by (5)
  - `business-os-v1-centralized-org-path/backend/server.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/auth.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/organizations.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/portal.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/users.js`

### 3.63 `business-os-v1-centralized-org-path/backend/src/portalUtils.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v1-centralized-org-path/backend/src/routes/portal.js`
  - `business-os-v1-centralized-org-path/backend/test/portalUtils.test.js`

### 3.64 `business-os-v1-centralized-org-path/backend/src/requestContext.js`

- Declared exports: `module.exports`
- Imports (1)
  - `async_hooks`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v1-centralized-org-path/backend/server.js`
  - `business-os-v1-centralized-org-path/backend/src/helpers.js`

### 3.65 `business-os-v1-centralized-org-path/backend/src/routes/ai.js`

- Declared exports: `module.exports`
- Imports (5)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `../services/aiGateway`
  - `express`
- Internal dependencies (4)
  - `business-os-v1-centralized-org-path/backend/src/database.js`
  - `business-os-v1-centralized-org-path/backend/src/helpers.js`
  - `business-os-v1-centralized-org-path/backend/src/middleware.js`
  - `business-os-v1-centralized-org-path/backend/src/services/aiGateway.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/backend/server.js`

### 3.66 `business-os-v1-centralized-org-path/backend/src/routes/auth.js`

- Declared exports: `module.exports`
- Imports (13)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `../organizationContext`
  - `../security`
  - `../services/supabaseAuth`
  - `../services/verification`
  - `../sessionAuth`
  - `bcryptjs`
  - `crypto`
  - `express`
  - `qrcode`
  - `speakeasy`
- Internal dependencies (8)
  - `business-os-v1-centralized-org-path/backend/src/database.js`
  - `business-os-v1-centralized-org-path/backend/src/helpers.js`
  - `business-os-v1-centralized-org-path/backend/src/middleware.js`
  - `business-os-v1-centralized-org-path/backend/src/organizationContext.js`
  - `business-os-v1-centralized-org-path/backend/src/security.js`
  - `business-os-v1-centralized-org-path/backend/src/services/supabaseAuth.js`
  - `business-os-v1-centralized-org-path/backend/src/services/verification.js`
  - `business-os-v1-centralized-org-path/backend/src/sessionAuth.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/backend/server.js`

### 3.67 `business-os-v1-centralized-org-path/backend/src/routes/branches.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v1-centralized-org-path/backend/src/database.js`
  - `business-os-v1-centralized-org-path/backend/src/helpers.js`
  - `business-os-v1-centralized-org-path/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/backend/server.js`

### 3.68 `business-os-v1-centralized-org-path/backend/src/routes/catalog.js`

- Declared exports: `module.exports`
- Imports (3)
  - `../database`
  - `../helpers`
  - `express`
- Internal dependencies (2)
  - `business-os-v1-centralized-org-path/backend/src/database.js`
  - `business-os-v1-centralized-org-path/backend/src/helpers.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/backend/server.js`

### 3.69 `business-os-v1-centralized-org-path/backend/src/routes/categories.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v1-centralized-org-path/backend/src/database.js`
  - `business-os-v1-centralized-org-path/backend/src/helpers.js`
  - `business-os-v1-centralized-org-path/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/backend/server.js`

### 3.70 `business-os-v1-centralized-org-path/backend/src/routes/contacts.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v1-centralized-org-path/backend/src/database.js`
  - `business-os-v1-centralized-org-path/backend/src/helpers.js`
  - `business-os-v1-centralized-org-path/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/backend/server.js`

### 3.71 `business-os-v1-centralized-org-path/backend/src/routes/customTables.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v1-centralized-org-path/backend/src/database.js`
  - `business-os-v1-centralized-org-path/backend/src/helpers.js`
  - `business-os-v1-centralized-org-path/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/backend/server.js`

### 3.72 `business-os-v1-centralized-org-path/backend/src/routes/files.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v1-centralized-org-path/backend/src/fileAssets.js`
  - `business-os-v1-centralized-org-path/backend/src/helpers.js`
  - `business-os-v1-centralized-org-path/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/backend/server.js`

### 3.73 `business-os-v1-centralized-org-path/backend/src/routes/inventory.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v1-centralized-org-path/backend/src/database.js`
  - `business-os-v1-centralized-org-path/backend/src/helpers.js`
  - `business-os-v1-centralized-org-path/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/backend/server.js`

### 3.74 `business-os-v1-centralized-org-path/backend/src/routes/organizations.js`

- Declared exports: `module.exports`
- Imports (3)
  - `../middleware`
  - `../organizationContext`
  - `express`
- Internal dependencies (2)
  - `business-os-v1-centralized-org-path/backend/src/middleware.js`
  - `business-os-v1-centralized-org-path/backend/src/organizationContext.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/backend/server.js`

### 3.75 `business-os-v1-centralized-org-path/backend/src/routes/portal.js`

- Declared exports: `module.exports`
- Imports (10)
  - `../database`
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `../netSecurity`
  - `../organizationContext`
  - `../portalUtils`
  - `../security`
  - `../services/portalAi`
  - `express`
- Internal dependencies (9)
  - `business-os-v1-centralized-org-path/backend/src/database.js`
  - `business-os-v1-centralized-org-path/backend/src/fileAssets.js`
  - `business-os-v1-centralized-org-path/backend/src/helpers.js`
  - `business-os-v1-centralized-org-path/backend/src/middleware.js`
  - `business-os-v1-centralized-org-path/backend/src/netSecurity.js`
  - `business-os-v1-centralized-org-path/backend/src/organizationContext.js`
  - `business-os-v1-centralized-org-path/backend/src/portalUtils.js`
  - `business-os-v1-centralized-org-path/backend/src/security.js`
  - `business-os-v1-centralized-org-path/backend/src/services/portalAi.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/backend/server.js`

### 3.76 `business-os-v1-centralized-org-path/backend/src/routes/products.js`

- Declared exports: `module.exports`
- Imports (9)
  - `../config`
  - `../database`
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `../netSecurity`
  - `express`
  - `fs`
  - `path`
- Internal dependencies (6)
  - `business-os-v1-centralized-org-path/backend/src/config.js`
  - `business-os-v1-centralized-org-path/backend/src/database.js`
  - `business-os-v1-centralized-org-path/backend/src/fileAssets.js`
  - `business-os-v1-centralized-org-path/backend/src/helpers.js`
  - `business-os-v1-centralized-org-path/backend/src/middleware.js`
  - `business-os-v1-centralized-org-path/backend/src/netSecurity.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/backend/server.js`

### 3.77 `business-os-v1-centralized-org-path/backend/src/routes/returns.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v1-centralized-org-path/backend/src/database.js`
  - `business-os-v1-centralized-org-path/backend/src/helpers.js`
  - `business-os-v1-centralized-org-path/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/backend/server.js`

### 3.78 `business-os-v1-centralized-org-path/backend/src/routes/sales.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v1-centralized-org-path/backend/src/database.js`
  - `business-os-v1-centralized-org-path/backend/src/helpers.js`
  - `business-os-v1-centralized-org-path/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/backend/server.js`

### 3.79 `business-os-v1-centralized-org-path/backend/src/routes/settings.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v1-centralized-org-path/backend/src/database.js`
  - `business-os-v1-centralized-org-path/backend/src/helpers.js`
  - `business-os-v1-centralized-org-path/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/backend/server.js`

### 3.80 `business-os-v1-centralized-org-path/backend/src/routes/system.js`

- Declared exports: `module.exports`
- Imports (15)
  - `../accessControl`
  - `../backupSchema`
  - `../config`
  - `../dataPath`
  - `../database`
  - `../helpers`
  - `../middleware`
  - `../security`
  - `../services/googleDriveSync`
  - `bcryptjs`
  - `better-sqlite3`
  - `child_process`
  - `express`
  - `fs`
  - `path`
- Internal dependencies (9)
  - `business-os-v1-centralized-org-path/backend/src/accessControl.js`
  - `business-os-v1-centralized-org-path/backend/src/backupSchema.js`
  - `business-os-v1-centralized-org-path/backend/src/config.js`
  - `business-os-v1-centralized-org-path/backend/src/dataPath.js`
  - `business-os-v1-centralized-org-path/backend/src/database.js`
  - `business-os-v1-centralized-org-path/backend/src/helpers.js`
  - `business-os-v1-centralized-org-path/backend/src/middleware.js`
  - `business-os-v1-centralized-org-path/backend/src/security.js`
  - `business-os-v1-centralized-org-path/backend/src/services/googleDriveSync.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/backend/server.js`

### 3.81 `business-os-v1-centralized-org-path/backend/src/routes/units.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v1-centralized-org-path/backend/src/database.js`
  - `business-os-v1-centralized-org-path/backend/src/helpers.js`
  - `business-os-v1-centralized-org-path/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/backend/server.js`

### 3.82 `business-os-v1-centralized-org-path/backend/src/routes/users.js`

- Declared exports: `module.exports`
- Imports (9)
  - `../database`
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `../organizationContext`
  - `../services/supabaseAuth`
  - `../services/verification`
  - `bcryptjs`
  - `express`
- Internal dependencies (7)
  - `business-os-v1-centralized-org-path/backend/src/database.js`
  - `business-os-v1-centralized-org-path/backend/src/fileAssets.js`
  - `business-os-v1-centralized-org-path/backend/src/helpers.js`
  - `business-os-v1-centralized-org-path/backend/src/middleware.js`
  - `business-os-v1-centralized-org-path/backend/src/organizationContext.js`
  - `business-os-v1-centralized-org-path/backend/src/services/supabaseAuth.js`
  - `business-os-v1-centralized-org-path/backend/src/services/verification.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/backend/server.js`

### 3.83 `business-os-v1-centralized-org-path/backend/src/security.js`

- Declared exports: `module.exports`
- Imports (1)
  - `crypto`
- Internal dependencies (0)
  - none
- Referenced by (7)
  - `business-os-v1-centralized-org-path/backend/src/accessControl.js`
  - `business-os-v1-centralized-org-path/backend/src/middleware.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/auth.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/portal.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/system.js`
  - `business-os-v1-centralized-org-path/backend/src/services/aiGateway.js`
  - `business-os-v1-centralized-org-path/backend/src/services/googleDriveSync.js`

### 3.84 `business-os-v1-centralized-org-path/backend/src/serverUtils.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v1-centralized-org-path/backend/server.js`
  - `business-os-v1-centralized-org-path/backend/test/serverUtils.test.js`

### 3.85 `business-os-v1-centralized-org-path/backend/src/services/aiGateway.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../netSecurity`
  - `../security`
- Internal dependencies (2)
  - `business-os-v1-centralized-org-path/backend/src/netSecurity.js`
  - `business-os-v1-centralized-org-path/backend/src/security.js`
- Referenced by (2)
  - `business-os-v1-centralized-org-path/backend/src/routes/ai.js`
  - `business-os-v1-centralized-org-path/backend/src/services/portalAi.js`

### 3.86 `business-os-v1-centralized-org-path/backend/src/services/firebaseAuth.js`

- Declared exports: `module.exports`
- Imports (2)
  - `crypto`
  - `fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.87 `business-os-v1-centralized-org-path/backend/src/services/googleDriveSync.js`

- Declared exports: `module.exports`
- Imports (8)
  - `../config`
  - `../dataPath`
  - `../database`
  - `../security`
  - `crypto`
  - `fs`
  - `os`
  - `path`
- Internal dependencies (4)
  - `business-os-v1-centralized-org-path/backend/src/config.js`
  - `business-os-v1-centralized-org-path/backend/src/dataPath.js`
  - `business-os-v1-centralized-org-path/backend/src/database.js`
  - `business-os-v1-centralized-org-path/backend/src/security.js`
- Referenced by (2)
  - `business-os-v1-centralized-org-path/backend/src/helpers.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/system.js`

### 3.88 `business-os-v1-centralized-org-path/backend/src/services/portalAi.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../database`
  - `./aiGateway`
- Internal dependencies (2)
  - `business-os-v1-centralized-org-path/backend/src/database.js`
  - `business-os-v1-centralized-org-path/backend/src/services/aiGateway.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/backend/src/routes/portal.js`

### 3.89 `business-os-v1-centralized-org-path/backend/src/services/supabaseAuth.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v1-centralized-org-path/backend/src/routes/auth.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/users.js`

### 3.90 `business-os-v1-centralized-org-path/backend/src/services/verification.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../database`
  - `crypto`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/backend/src/database.js`
- Referenced by (2)
  - `business-os-v1-centralized-org-path/backend/src/routes/auth.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/users.js`

### 3.91 `business-os-v1-centralized-org-path/backend/src/sessionAuth.js`

- Declared exports: `module.exports`
- Imports (2)
  - `./database`
  - `crypto`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/backend/src/database.js`
- Referenced by (3)
  - `business-os-v1-centralized-org-path/backend/src/middleware.js`
  - `business-os-v1-centralized-org-path/backend/src/routes/auth.js`
  - `business-os-v1-centralized-org-path/backend/src/websocket.js`

### 3.92 `business-os-v1-centralized-org-path/backend/src/systemFsWorker.js`

- Declared exports: none detected
- Imports (3)
  - `./dataPath`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/backend/src/dataPath.js`
- Referenced by (0)
  - none

### 3.93 `business-os-v1-centralized-org-path/backend/src/uploadSecurity.js`

- Declared exports: `module.exports`
- Imports (2)
  - `fs`
  - `sharp`
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `business-os-v1-centralized-org-path/backend/src/fileAssets.js`
  - `business-os-v1-centralized-org-path/backend/src/middleware.js`
  - `business-os-v1-centralized-org-path/backend/test/uploadSecurity.test.js`

### 3.94 `business-os-v1-centralized-org-path/backend/src/websocket.js`

- Declared exports: `module.exports`
- Imports (4)
  - `./helpers`
  - `./sessionAuth`
  - `http`
  - `ws`
- Internal dependencies (2)
  - `business-os-v1-centralized-org-path/backend/src/helpers.js`
  - `business-os-v1-centralized-org-path/backend/src/sessionAuth.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/backend/server.js`

### 3.95 `business-os-v1-centralized-org-path/backend/test/accessControl.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/accessControl`
  - `node:assert/strict`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/backend/src/accessControl.js`
- Referenced by (0)
  - none

### 3.96 `business-os-v1-centralized-org-path/backend/test/backupRoundtrip.test.js`

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

### 3.97 `business-os-v1-centralized-org-path/backend/test/backupSchema.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/backupSchema`
  - `node:assert/strict`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/backend/src/backupSchema.js`
- Referenced by (0)
  - none

### 3.98 `business-os-v1-centralized-org-path/backend/test/dataPath.test.js`

- Declared exports: none detected
- Imports (5)
  - `../src/dataPath`
  - `fs`
  - `node:assert/strict`
  - `os`
  - `path`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/backend/src/dataPath.js`
- Referenced by (0)
  - none

### 3.99 `business-os-v1-centralized-org-path/backend/test/netSecurity.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/netSecurity`
  - `node:assert/strict`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/backend/src/netSecurity.js`
- Referenced by (0)
  - none

### 3.100 `business-os-v1-centralized-org-path/backend/test/portalUtils.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/portalUtils`
  - `node:assert/strict`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/backend/src/portalUtils.js`
- Referenced by (0)
  - none

### 3.101 `business-os-v1-centralized-org-path/backend/test/serverUtils.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/serverUtils`
  - `node:assert/strict`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/backend/src/serverUtils.js`
- Referenced by (0)
  - none

### 3.102 `business-os-v1-centralized-org-path/backend/test/uploadSecurity.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/uploadSecurity`
  - `node:assert/strict`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/backend/src/uploadSecurity.js`
- Referenced by (0)
  - none

### 3.103 `business-os-v1-centralized-org-path/frontend/postcss.config.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.104 `business-os-v1-centralized-org-path/frontend/src/api/http.js`

- Declared exports: `apiFetch`, `cacheClearAll`, `cacheGet`, `cacheGetStale`, `cacheInvalidate`, `cacheSet`, `clearCallLog`, `getAuthSessionToken`, `getCallLog`, `getSyncServerUrl`, `getSyncToken`, `isNetErr`, `isServerOnline`, `route`, `setAuthSessionToken`, `setSyncServerUrl`, `setSyncToken`, `startHealthCheck`
- Imports (2)
  - `../constants.js`
  - `../utils/deviceInfo.js`
- Internal dependencies (2)
  - `business-os-v1-centralized-org-path/frontend/src/constants.js`
  - `business-os-v1-centralized-org-path/frontend/src/utils/deviceInfo.js`
- Referenced by (5)
  - `business-os-v1-centralized-org-path/frontend/src/api/methods.js`
  - `business-os-v1-centralized-org-path/frontend/src/api/websocket.js`
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/Backup.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/web-api.js`

### 3.105 `business-os-v1-centralized-org-path/frontend/src/api/localDb.js`

- Declared exports: `buildCSVTemplate`, `dexieDb`, `localGetSettings`, `localSaveSettings`, `parseCSV`
- Imports (1)
  - `dexie`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v1-centralized-org-path/frontend/src/api/methods.js`
  - `business-os-v1-centralized-org-path/frontend/src/web-api.js`

### 3.106 `business-os-v1-centralized-org-path/frontend/src/api/methods.js`

- Declared exports: `adjustStock`, `askPortalAi`, `attachSaleCustomer`, `browseDir`, `bulkImportCustomers`, `bulkImportDeliveryContacts`, `bulkImportProducts`, `bulkImportSuppliers`, `changeUserPassword`, `completePasswordReset`, `completeSupabaseOauth`, `createAiProvider`, `createBranch`, `createCategory`, `createCustomField`, `createCustomTable`, `createCustomer`, `createDeliveryContact`, `createPortalSubmission`, `createProduct`, `createProductVariant`, `createReturn`, `createRole`, `createSale`, `createSupplier`, `createSupplierReturn`, `createUnit`, `createUser`, `deleteAiProvider`, `deleteBranch`, `deleteCategory`, `deleteCustomField`, `deleteCustomRow`, `deleteCustomer`, `deleteDeliveryContact`, `deleteFileAsset`, `deleteProduct`, `deleteRole`, `deleteSupplier`, `deleteUnit`, `disconnectGoogleDriveSync`, `disconnectUserAuthProvider`, `downloadCustomerTemplate`, `downloadImportTemplate`, `downloadSupplierTemplate`, `exportBackup`, `exportBackupFolder`, `factoryReset`, `flushPendingSyncQueue`, `getAiProviders`, `getAiResponses`, `getAnalytics`, `getAuditLogs`, `getBranchStock`, `getBranches`, `getCatalogMeta`, `getCatalogProducts`, `getCategories`, `getCurrentOrganization`, `getCustomFields`, `getCustomTableData`, `getCustomTables`, `getCustomers`, `getDashboard`, `getDataPath`, `getDeliveryContacts`, `getFiles`, `getGoogleDriveSyncStatus`, `getImageDataUrl`, `getInventoryMovements`, `getInventorySummary`, `getOrganizationBootstrap`, `getPortalAiStatus`, `getPortalCatalogMeta`, `getPortalCatalogProducts`, `getPortalConfig`, `getPortalSubmissionsForReview`, `getProducts`, `getReturn`, `getReturns`, `getRoles`, `getSales`, `getSalesExport`, `getSettings`, `getSuppliers`, `getSystemConfig`, `getSystemDebugLog`, `getTransfers`, `getUnits`, `getUserAuthMethods`, `getUserProfile`, `getUsers`, `getVerificationCapabilities`, `importBackup`, `importBackupData`, `importBackupFolder`, `insertCustomRow`, `login`, `logout`, `lookupPortalMembership`, `openCSVDialog`, `openFolderDialog`, `openImageDialog`, `openPath`, `otpConfirm`, `otpDisable`, `otpSetup`, `otpStatus`, `otpVerify`, `pickBackupFile`, `requestPasswordResetEmail`, `resetData`, `resetDataPath`, `resetPassword`, `resetPasswordWithOtp`, `reviewPortalSubmission`, `saveGoogleDriveSyncPreferences`, `saveSettings`, `searchOrganizations`, `setDataPath`, `startGoogleDriveSyncOauth`, `startSupabaseOauth`, `syncGoogleDriveNow`, `testAiProvider`, `testSyncServer`, `transferStock`, `updateAiProvider`, `updateBranch`, `updateCategory`, `updateCustomField`, `updateCustomRow`, `updateCustomer`, `updateDeliveryContact`, `updateProduct`, `updateReturn`, `updateRole`, `updateSaleStatus`, `updateSupplier`, `updateUser`, `updateUserProfile`, `uploadFileAsset`, `uploadProductImage`, `uploadUserAvatar`
- Imports (4)
  - `../constants`
  - `../utils/deviceInfo.js`
  - `./http.js`
  - `./localDb.js`
- Internal dependencies (4)
  - `business-os-v1-centralized-org-path/frontend/src/api/http.js`
  - `business-os-v1-centralized-org-path/frontend/src/api/localDb.js`
  - `business-os-v1-centralized-org-path/frontend/src/constants.js`
  - `business-os-v1-centralized-org-path/frontend/src/utils/deviceInfo.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/web-api.js`

### 3.107 `business-os-v1-centralized-org-path/frontend/src/api/websocket.js`

- Declared exports: `connectWS`, `disconnectWS`, `isWSConnected`
- Imports (2)
  - `../constants.js`
  - `./http.js`
- Internal dependencies (2)
  - `business-os-v1-centralized-org-path/frontend/src/api/http.js`
  - `business-os-v1-centralized-org-path/frontend/src/constants.js`
- Referenced by (2)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/web-api.js`

### 3.108 `business-os-v1-centralized-org-path/frontend/src/App.jsx`

- Declared exports: `function`
- Imports (24)
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
  - `./components/shared/PageHelpButton`
  - `./components/users/Users`
  - `./components/utils-settings/AuditLog`
  - `./components/utils-settings/Backup`
  - `./components/utils-settings/Settings`
  - `./utils/favicon`
  - `react`
- Internal dependencies (23)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/app/appShellUtils.mjs`
  - `business-os-v1-centralized-org-path/frontend/src/components/auth/Login.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/branches/Branches.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/catalog/CatalogPage.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/Contacts.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/dashboard/Dashboard.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/files/FilesPage.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/inventory/Inventory.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/navigation/Sidebar.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/pos/POS.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/Products.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/ReceiptSettings.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/returns/Returns.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/sales/Sales.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/server/ServerPage.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/PageHelpButton.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/users/Users.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/AuditLog.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/Backup.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/Settings.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/utils/favicon.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/index.jsx`

### 3.109 `business-os-v1-centralized-org-path/frontend/src/app/appShellUtils.mjs`

- Declared exports: `MAX_MOUNTED_PAGES`, `getNotificationColor`, `getNotificationPrefix`, `isPublicCatalogPath`, `updateMountedPages`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v1-centralized-org-path/frontend/src/App.jsx`
  - `business-os-v1-centralized-org-path/frontend/tests/appShellUtils.test.mjs`

### 3.110 `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`

- Declared exports: `AppProvider`, `PAGE_PERMISSIONS`, `useApp`, `useSync`, `useT`
- Imports (8)
  - `./api/http.js`
  - `./api/websocket.js`
  - `./constants`
  - `./lang/en.json`
  - `./lang/km.json`
  - `./utils/deviceInfo.js`
  - `./web-api.js`
  - `react`
- Internal dependencies (7)
  - `business-os-v1-centralized-org-path/frontend/src/api/http.js`
  - `business-os-v1-centralized-org-path/frontend/src/api/websocket.js`
  - `business-os-v1-centralized-org-path/frontend/src/constants.js`
  - `business-os-v1-centralized-org-path/frontend/src/lang/en.json`
  - `business-os-v1-centralized-org-path/frontend/src/lang/km.json`
  - `business-os-v1-centralized-org-path/frontend/src/utils/deviceInfo.js`
  - `business-os-v1-centralized-org-path/frontend/src/web-api.js`
- Referenced by (44)
  - `business-os-v1-centralized-org-path/frontend/src/App.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/auth/Login.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/branches/Branches.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/branches/BranchForm.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/branches/TransferModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/catalog/CatalogPage.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/Contacts.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/CustomersTab.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/DeliveryTab.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/shared.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/SuppliersTab.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/custom-tables/CustomTables.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/NoData.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/dashboard/Dashboard.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/files/FilePickerModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/files/FilesPage.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/inventory/Inventory.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/navigation/Sidebar.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/pos/POS.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/BulkImportModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/ManageBrandsModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/ManageCategoriesModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/Products.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/VariantFormModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/AllFieldsPanel.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/ReceiptSettings.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/receipt/Receipt.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/returns/EditReturnModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/returns/NewReturnModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/returns/NewSupplierReturnModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/returns/ReturnDetailModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/returns/Returns.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/sales/Sales.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/server/ServerPage.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/PageHelpButton.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/users/UserProfileModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/users/Users.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/AuditLog.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/Backup.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/OtpModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/ResetData.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/Settings.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/index.jsx`

### 3.111 `business-os-v1-centralized-org-path/frontend/src/components/auth/Login.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `../../constants`
  - `../../utils/deviceInfo.js`
  - `react`
- Internal dependencies (3)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/constants.js`
  - `business-os-v1-centralized-org-path/frontend/src/utils/deviceInfo.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/App.jsx`

### 3.112 `business-os-v1-centralized-org-path/frontend/src/components/branches/Branches.jsx`

- Declared exports: `function`
- Imports (6)
  - `../../AppContext`
  - `../shared/Modal`
  - `./BranchForm`
  - `./TransferModal`
  - `lucide-react`
  - `react`
- Internal dependencies (4)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/branches/BranchForm.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/branches/TransferModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/App.jsx`

### 3.113 `business-os-v1-centralized-org-path/frontend/src/components/branches/BranchForm.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/branches/Branches.jsx`

### 3.114 `business-os-v1-centralized-org-path/frontend/src/components/branches/TransferModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/branches/Branches.jsx`

### 3.115 `business-os-v1-centralized-org-path/frontend/src/components/catalog/CatalogPage.jsx`

- Declared exports: `function`
- Imports (6)
  - `../../AppContext`
  - `../../utils/favicon`
  - `../files/FilePickerModal`
  - `../products/primitives`
  - `../shared/ImageGalleryLightbox`
  - `react`
- Internal dependencies (5)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/files/FilePickerModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/primitives.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/ImageGalleryLightbox.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/utils/favicon.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/App.jsx`

### 3.116 `business-os-v1-centralized-org-path/frontend/src/components/catalog/portalEditorUtils.mjs`

- Declared exports: `createAboutBlock`, `extractGoogleMapsEmbedUrl`, `moveListItem`, `normalizeAboutBlocks`, `normalizeGoogleMapsEmbed`, `serializeAboutBlocks`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.117 `business-os-v1-centralized-org-path/frontend/src/components/contacts/Contacts.jsx`

- Declared exports: `function`
- Imports (9)
  - `../../AppContext`
  - `../../utils/csv`
  - `../shared/Modal`
  - `./CustomersTab`
  - `./DeliveryTab`
  - `./SuppliersTab`
  - `./shared`
  - `lucide-react`
  - `react`
- Internal dependencies (7)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/CustomersTab.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/DeliveryTab.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/SuppliersTab.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/shared.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/Modal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/utils/csv.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/App.jsx`

### 3.118 `business-os-v1-centralized-org-path/frontend/src/components/contacts/CustomersTab.jsx`

- Declared exports: `parseContactOptions`, `serializeContactOptions`
- Imports (7)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `../shared/Modal`
  - `./shared`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/shared.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/Modal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/utils/csv.js`
  - `business-os-v1-centralized-org-path/frontend/src/utils/formatters.js`
- Referenced by (2)
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/Contacts.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/pos/POS.jsx`

### 3.119 `business-os-v1-centralized-org-path/frontend/src/components/contacts/DeliveryTab.jsx`

- Declared exports: `parseDeliveryOptions`, `serializeDeliveryOptions`
- Imports (7)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `../shared/Modal`
  - `./shared`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/shared.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/Modal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/utils/csv.js`
  - `business-os-v1-centralized-org-path/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/Contacts.jsx`

### 3.120 `business-os-v1-centralized-org-path/frontend/src/components/contacts/shared.jsx`

- Declared exports: `ContactTable`, `DetailModal`, `ImportModal`, `ThreeDotMenu`, `useContactSelection`
- Imports (4)
  - `../../AppContext`
  - `../files/FilePickerModal`
  - `../shared/Modal`
  - `react`
- Internal dependencies (3)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/files/FilePickerModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/Modal.jsx`
- Referenced by (4)
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/Contacts.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/CustomersTab.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/DeliveryTab.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/SuppliersTab.jsx`

### 3.121 `business-os-v1-centralized-org-path/frontend/src/components/contacts/SuppliersTab.jsx`

- Declared exports: none detected
- Imports (7)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `../shared/Modal`
  - `./shared`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/shared.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/Modal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/utils/csv.js`
  - `business-os-v1-centralized-org-path/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/Contacts.jsx`

### 3.122 `business-os-v1-centralized-org-path/frontend/src/components/custom-tables/CustomTables.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
- Referenced by (0)
  - none

### 3.123 `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/BarChart.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../../utils/formatters`
  - `./NoData`
  - `react`
- Internal dependencies (2)
  - `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/NoData.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/utils/formatters.js`
- Referenced by (0)
  - none

### 3.124 `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/DonutChart.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../../utils/formatters`
  - `./NoData`
  - `react`
- Internal dependencies (2)
  - `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/NoData.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/utils/formatters.js`
- Referenced by (0)
  - none

### 3.125 `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/index.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/dashboard/Dashboard.jsx`

### 3.126 `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/LineChart.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../../utils/formatters`
  - `./NoData`
  - `react`
- Internal dependencies (2)
  - `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/NoData.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/utils/formatters.js`
- Referenced by (0)
  - none

### 3.127 `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/NoData.jsx`

- Declared exports: `function`
- Imports (1)
  - `../../../AppContext`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
- Referenced by (3)
  - `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/BarChart.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/DonutChart.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/LineChart.jsx`

### 3.128 `business-os-v1-centralized-org-path/frontend/src/components/dashboard/Dashboard.jsx`

- Declared exports: `function`
- Imports (9)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/dateHelpers`
  - `../../utils/formatters`
  - `../shared/PortalMenu`
  - `./MiniStat`
  - `./charts`
  - `lucide-react`
  - `react`
- Internal dependencies (7)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/dashboard/MiniStat.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/index.js`
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/PortalMenu.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/utils/csv.js`
  - `business-os-v1-centralized-org-path/frontend/src/utils/dateHelpers.js`
  - `business-os-v1-centralized-org-path/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/App.jsx`

### 3.129 `business-os-v1-centralized-org-path/frontend/src/components/dashboard/MiniStat.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/dashboard/Dashboard.jsx`

### 3.130 `business-os-v1-centralized-org-path/frontend/src/components/files/FilePickerModal.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `../shared/Modal`
  - `react`
- Internal dependencies (2)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/Modal.jsx`
- Referenced by (5)
  - `business-os-v1-centralized-org-path/frontend/src/components/catalog/CatalogPage.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/shared.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/BulkImportModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/ProductForm.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/users/UserProfileModal.jsx`

### 3.131 `business-os-v1-centralized-org-path/frontend/src/components/files/FilesPage.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/App.jsx`

### 3.132 `business-os-v1-centralized-org-path/frontend/src/components/inventory/DualMoney.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v1-centralized-org-path/frontend/src/components/inventory/Inventory.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/inventory/ProductDetailModal.jsx`

### 3.133 `business-os-v1-centralized-org-path/frontend/src/components/inventory/Inventory.jsx`

- Declared exports: `function`
- Imports (8)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `./DualMoney`
  - `./ProductDetailModal`
  - `./movementGroups`
  - `lucide-react`
  - `react`
- Internal dependencies (6)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/inventory/DualMoney.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/inventory/ProductDetailModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/inventory/movementGroups.js`
  - `business-os-v1-centralized-org-path/frontend/src/utils/csv.js`
  - `business-os-v1-centralized-org-path/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/App.jsx`

### 3.134 `business-os-v1-centralized-org-path/frontend/src/components/inventory/movementGroups.js`

- Declared exports: `buildMovementGroups`, `movementGroupHaystack`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/inventory/Inventory.jsx`

### 3.135 `business-os-v1-centralized-org-path/frontend/src/components/inventory/ProductDetailModal.jsx`

- Declared exports: `function`
- Imports (1)
  - `./DualMoney`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/inventory/DualMoney.jsx`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/inventory/Inventory.jsx`

### 3.136 `business-os-v1-centralized-org-path/frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `lucide-react`
  - `react`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/App.jsx`

### 3.137 `business-os-v1-centralized-org-path/frontend/src/components/navigation/Sidebar.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `../shared/navigationConfig`
  - `../users/UserProfileModal`
  - `react`
- Internal dependencies (3)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/navigationConfig.js`
  - `business-os-v1-centralized-org-path/frontend/src/components/users/UserProfileModal.jsx`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/App.jsx`

### 3.138 `business-os-v1-centralized-org-path/frontend/src/components/pos/CartItem.jsx`

- Declared exports: `function`
- Imports (1)
  - `./ProductImage`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/pos/ProductImage.jsx`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/pos/POS.jsx`

### 3.139 `business-os-v1-centralized-org-path/frontend/src/components/pos/FilterPanel.jsx`

- Declared exports: `function`
- Imports (1)
  - `lucide-react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/pos/POS.jsx`

### 3.140 `business-os-v1-centralized-org-path/frontend/src/components/pos/POS.jsx`

- Declared exports: `function`
- Imports (12)
  - `../../AppContext`
  - `../../utils/deviceInfo`
  - `../contacts/CustomersTab`
  - `../receipt/Receipt`
  - `../sales/StatusBadge`
  - `../shared/ImageGalleryLightbox`
  - `./CartItem`
  - `./FilterPanel`
  - `./ProductImage`
  - `./QuickAddModal`
  - `lucide-react`
  - `react`
- Internal dependencies (10)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/CustomersTab.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/pos/CartItem.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/pos/FilterPanel.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/pos/ProductImage.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/pos/QuickAddModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/receipt/Receipt.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/sales/StatusBadge.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/ImageGalleryLightbox.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/utils/deviceInfo.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/App.jsx`

### 3.141 `business-os-v1-centralized-org-path/frontend/src/components/pos/ProductImage.jsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v1-centralized-org-path/frontend/src/components/pos/CartItem.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/pos/POS.jsx`

### 3.142 `business-os-v1-centralized-org-path/frontend/src/components/pos/QuickAddModal.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/pos/POS.jsx`

### 3.143 `business-os-v1-centralized-org-path/frontend/src/components/products/BranchStockAdjuster.jsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/products/ProductForm.jsx`

### 3.144 `business-os-v1-centralized-org-path/frontend/src/components/products/BulkAddStockModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../shared/Modal`
  - `react`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/products/Products.jsx`

### 3.145 `business-os-v1-centralized-org-path/frontend/src/components/products/BulkImportModal.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `../files/FilePickerModal`
  - `../shared/Modal`
  - `react`
- Internal dependencies (3)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/files/FilePickerModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/products/Products.jsx`

### 3.146 `business-os-v1-centralized-org-path/frontend/src/components/products/HeaderActions.jsx`

- Declared exports: `function`
- Imports (2)
  - `../shared/PortalMenu`
  - `lucide-react`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/PortalMenu.jsx`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/products/Products.jsx`

### 3.147 `business-os-v1-centralized-org-path/frontend/src/components/products/ManageBrandsModal.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `../shared/Modal`
  - `react`
- Internal dependencies (2)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/products/Products.jsx`

### 3.148 `business-os-v1-centralized-org-path/frontend/src/components/products/ManageCategoriesModal.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `../shared/Modal`
  - `react`
- Internal dependencies (2)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/products/Products.jsx`

### 3.149 `business-os-v1-centralized-org-path/frontend/src/components/products/ManageFieldsModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../shared/Modal`
  - `react`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/products/Products.jsx`

### 3.150 `business-os-v1-centralized-org-path/frontend/src/components/products/ManageMenu.jsx`

- Declared exports: `function`
- Imports (1)
  - `../shared/PortalMenu`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/PortalMenu.jsx`
- Referenced by (0)
  - none

### 3.151 `business-os-v1-centralized-org-path/frontend/src/components/products/ManageUnitsModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../shared/Modal`
  - `react`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/products/Products.jsx`

### 3.152 `business-os-v1-centralized-org-path/frontend/src/components/products/primitives.jsx`

- Declared exports: none detected
- Imports (2)
  - `lucide-react`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `business-os-v1-centralized-org-path/frontend/src/components/catalog/CatalogPage.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/ProductDetailModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/ProductForm.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/Products.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/VariantFormModal.jsx`

### 3.153 `business-os-v1-centralized-org-path/frontend/src/components/products/ProductDetailModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `./primitives`
  - `lucide-react`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/products/primitives.jsx`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/products/Products.jsx`

### 3.154 `business-os-v1-centralized-org-path/frontend/src/components/products/ProductForm.jsx`

- Declared exports: `function`
- Imports (5)
  - `../files/FilePickerModal`
  - `../shared/Modal`
  - `./BranchStockAdjuster`
  - `./primitives`
  - `react`
- Internal dependencies (4)
  - `business-os-v1-centralized-org-path/frontend/src/components/files/FilePickerModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/BranchStockAdjuster.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/primitives.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/products/Products.jsx`

### 3.155 `business-os-v1-centralized-org-path/frontend/src/components/products/Products.jsx`

- Declared exports: `function`
- Imports (18)
  - `../../AppContext`
  - `../../utils/csv`
  - `../shared/ImageGalleryLightbox`
  - `../shared/Modal`
  - `../shared/PortalMenu`
  - `./BulkAddStockModal`
  - `./BulkImportModal`
  - `./HeaderActions`
  - `./ManageBrandsModal`
  - `./ManageCategoriesModal`
  - `./ManageFieldsModal`
  - `./ManageUnitsModal`
  - `./ProductDetailModal`
  - `./ProductForm`
  - `./VariantFormModal`
  - `./primitives`
  - `lucide-react`
  - `react`
- Internal dependencies (16)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/BulkAddStockModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/BulkImportModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/HeaderActions.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/ManageBrandsModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/ManageCategoriesModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/ManageFieldsModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/ManageUnitsModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/ProductDetailModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/ProductForm.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/VariantFormModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/primitives.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/ImageGalleryLightbox.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/Modal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/PortalMenu.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/utils/csv.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/App.jsx`

### 3.156 `business-os-v1-centralized-org-path/frontend/src/components/products/VariantFormModal.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `../shared/Modal`
  - `./primitives`
  - `react`
- Internal dependencies (3)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/primitives.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/products/Products.jsx`

### 3.157 `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/AllFieldsPanel.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `./constants`
  - `react`
- Internal dependencies (2)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/constants.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.158 `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/constants.js`

- Declared exports: `ALL_FIELD_ITEMS`, `DEFAULT_TEMPLATE`, `getFieldItems`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/AllFieldsPanel.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/ReceiptSettings.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/receipt/Receipt.jsx`

### 3.159 `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/ErrorBoundary.jsx`

- Declared exports: `class`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.160 `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/FieldOrderManager.jsx`

- Declared exports: `function`
- Imports (2)
  - `lucide-react`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.161 `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/PrintSettings.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../utils/printReceipt`
  - `lucide-react`
  - `react`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/frontend/src/utils/printReceipt.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.162 `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/ReceiptPreview.jsx`

- Declared exports: `function`
- Imports (2)
  - `../receipt/Receipt`
  - `react`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/receipt/Receipt.jsx`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.163 `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/ReceiptSettings.jsx`

- Declared exports: `function`
- Imports (9)
  - `../../AppContext`
  - `./AllFieldsPanel`
  - `./ErrorBoundary`
  - `./FieldOrderManager`
  - `./PrintSettings`
  - `./ReceiptPreview`
  - `./constants`
  - `lucide-react`
  - `react`
- Internal dependencies (7)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/AllFieldsPanel.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/ErrorBoundary.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/FieldOrderManager.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/PrintSettings.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/ReceiptPreview.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/constants.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/App.jsx`

### 3.164 `business-os-v1-centralized-org-path/frontend/src/components/receipt/Receipt.jsx`

- Declared exports: `function`, `parseTpl`
- Imports (6)
  - `../../AppContext`
  - `../../utils/printReceipt`
  - `../receipt-settings/constants`
  - `../sales/StatusBadge`
  - `lucide-react`
  - `react`
- Internal dependencies (4)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/constants.js`
  - `business-os-v1-centralized-org-path/frontend/src/components/sales/StatusBadge.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/utils/printReceipt.js`
- Referenced by (3)
  - `business-os-v1-centralized-org-path/frontend/src/components/pos/POS.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/ReceiptPreview.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/sales/Sales.jsx`

### 3.165 `business-os-v1-centralized-org-path/frontend/src/components/returns/EditReturnModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/returns/Returns.jsx`

### 3.166 `business-os-v1-centralized-org-path/frontend/src/components/returns/NewReturnModal.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `../../utils/formatters`
  - `react`
- Internal dependencies (2)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/returns/Returns.jsx`

### 3.167 `business-os-v1-centralized-org-path/frontend/src/components/returns/NewSupplierReturnModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/returns/Returns.jsx`

### 3.168 `business-os-v1-centralized-org-path/frontend/src/components/returns/ReturnDetailModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `../../utils/formatters`
- Internal dependencies (2)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/returns/Returns.jsx`

### 3.169 `business-os-v1-centralized-org-path/frontend/src/components/returns/Returns.jsx`

- Declared exports: `function`
- Imports (9)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `./EditReturnModal`
  - `./NewReturnModal`
  - `./NewSupplierReturnModal`
  - `./ReturnDetailModal`
  - `lucide-react`
  - `react`
- Internal dependencies (7)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/returns/EditReturnModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/returns/NewReturnModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/returns/NewSupplierReturnModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/returns/ReturnDetailModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/utils/csv.js`
  - `business-os-v1-centralized-org-path/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/App.jsx`

### 3.170 `business-os-v1-centralized-org-path/frontend/src/components/sales/ExportModal.jsx`

- Declared exports: `function`
- Imports (4)
  - `../shared/Modal`
  - `./StatusBadge`
  - `lucide-react`
  - `react`
- Internal dependencies (2)
  - `business-os-v1-centralized-org-path/frontend/src/components/sales/StatusBadge.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/sales/Sales.jsx`

### 3.171 `business-os-v1-centralized-org-path/frontend/src/components/sales/SaleDetailModal.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../utils/formatters`
  - `./StatusBadge`
  - `react`
- Internal dependencies (2)
  - `business-os-v1-centralized-org-path/frontend/src/components/sales/StatusBadge.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/sales/Sales.jsx`

### 3.172 `business-os-v1-centralized-org-path/frontend/src/components/sales/Sales.jsx`

- Declared exports: `function`
- Imports (9)
  - `../../AppContext`
  - `../../utils/deviceInfo`
  - `../../utils/formatters`
  - `../receipt/Receipt`
  - `./ExportModal`
  - `./SaleDetailModal`
  - `./StatusBadge`
  - `lucide-react`
  - `react`
- Internal dependencies (7)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/receipt/Receipt.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/sales/ExportModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/sales/SaleDetailModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/sales/StatusBadge.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/utils/deviceInfo.js`
  - `business-os-v1-centralized-org-path/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/App.jsx`

### 3.173 `business-os-v1-centralized-org-path/frontend/src/components/sales/StatusBadge.jsx`

- Declared exports: `ALL_STATUSES`, `STATUS_COLORS`, `STATUS_LABELS`, `function`, `getStatusLabel`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `business-os-v1-centralized-org-path/frontend/src/components/pos/POS.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/receipt/Receipt.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/sales/ExportModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/sales/SaleDetailModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/sales/Sales.jsx`

### 3.174 `business-os-v1-centralized-org-path/frontend/src/components/server/ServerPage.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/App.jsx`

### 3.175 `business-os-v1-centralized-org-path/frontend/src/components/shared/ImageGalleryLightbox.jsx`

- Declared exports: `function`
- Imports (2)
  - `lucide-react`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `business-os-v1-centralized-org-path/frontend/src/components/catalog/CatalogPage.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/pos/POS.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/Products.jsx`

### 3.176 `business-os-v1-centralized-org-path/frontend/src/components/shared/Modal.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (19)
  - `business-os-v1-centralized-org-path/frontend/src/components/branches/Branches.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/Contacts.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/CustomersTab.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/DeliveryTab.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/shared.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/SuppliersTab.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/files/FilePickerModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/BulkAddStockModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/BulkImportModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/ManageBrandsModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/ManageCategoriesModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/ManageFieldsModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/ManageUnitsModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/ProductForm.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/Products.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/VariantFormModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/sales/ExportModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/users/UserProfileModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/users/Users.jsx`

### 3.177 `business-os-v1-centralized-org-path/frontend/src/components/shared/navigationConfig.js`

- Declared exports: `DEFAULT_MOBILE_PINNED`, `NAV_ITEMS`, `orderNavItems`, `parseNavSetting`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v1-centralized-org-path/frontend/src/components/navigation/Sidebar.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/Settings.jsx`

### 3.178 `business-os-v1-centralized-org-path/frontend/src/components/shared/PageHelpButton.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `./pageHelpContent`
  - `lucide-react`
  - `react`
- Internal dependencies (2)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/pageHelpContent.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/App.jsx`

### 3.179 `business-os-v1-centralized-org-path/frontend/src/components/shared/pageHelpContent.js`

- Declared exports: `PAGE_HELP_CONTENT`, `getPageHelpContent`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/PageHelpButton.jsx`

### 3.180 `business-os-v1-centralized-org-path/frontend/src/components/shared/PortalMenu.jsx`

- Declared exports: `ThreeDotPortal`, `function`
- Imports (3)
  - `lucide-react`
  - `react`
  - `react-dom`
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `business-os-v1-centralized-org-path/frontend/src/components/dashboard/Dashboard.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/HeaderActions.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/ManageMenu.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/Products.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/users/Users.jsx`

### 3.181 `business-os-v1-centralized-org-path/frontend/src/components/users/PermissionEditor.jsx`

- Declared exports: `PERMISSION_DEFS`, `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v1-centralized-org-path/frontend/src/components/users/UserDetailSheet.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/users/Users.jsx`

### 3.182 `business-os-v1-centralized-org-path/frontend/src/components/users/UserDetailSheet.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../utils/formatters`
  - `./PermissionEditor`
- Internal dependencies (2)
  - `business-os-v1-centralized-org-path/frontend/src/components/users/PermissionEditor.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/users/Users.jsx`

### 3.183 `business-os-v1-centralized-org-path/frontend/src/components/users/UserProfileModal.jsx`

- Declared exports: `function`
- Imports (7)
  - `../../AppContext`
  - `../../constants`
  - `../files/FilePickerModal`
  - `../shared/Modal`
  - `../utils-settings/OtpModal`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/files/FilePickerModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/Modal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/OtpModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/constants.js`
- Referenced by (2)
  - `business-os-v1-centralized-org-path/frontend/src/components/navigation/Sidebar.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/users/Users.jsx`

### 3.184 `business-os-v1-centralized-org-path/frontend/src/components/users/Users.jsx`

- Declared exports: `function`
- Imports (9)
  - `../../AppContext`
  - `../../utils/formatters`
  - `../shared/Modal`
  - `../shared/PortalMenu`
  - `./PermissionEditor`
  - `./UserDetailSheet`
  - `./UserProfileModal`
  - `lucide-react`
  - `react`
- Internal dependencies (7)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/Modal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/PortalMenu.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/users/PermissionEditor.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/users/UserDetailSheet.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/users/UserProfileModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/App.jsx`

### 3.185 `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/AuditLog.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `../../utils/csv`
  - `lucide-react`
  - `react`
- Internal dependencies (2)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/utils/csv.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/App.jsx`

### 3.186 `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/Backup.jsx`

- Declared exports: `function`
- Imports (6)
  - `../../AppContext`
  - `../../api/http`
  - `../../utils/appRefresh`
  - `./ResetData`
  - `lucide-react`
  - `react`
- Internal dependencies (4)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/api/http.js`
  - `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/ResetData.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/utils/appRefresh.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/App.jsx`

### 3.187 `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/FontFamilyPicker.jsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/Settings.jsx`

### 3.188 `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/index.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.189 `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/OtpModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
- Referenced by (2)
  - `business-os-v1-centralized-org-path/frontend/src/components/users/UserProfileModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/Settings.jsx`

### 3.190 `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/ResetData.jsx`

- Declared exports: none detected
- Imports (4)
  - `../../AppContext`
  - `../../utils/appRefresh`
  - `lucide-react`
  - `react`
- Internal dependencies (2)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/utils/appRefresh.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/Backup.jsx`

### 3.191 `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/Settings.jsx`

- Declared exports: `function`
- Imports (7)
  - `../../AppContext`
  - `../../utils/favicon`
  - `../shared/navigationConfig`
  - `./FontFamilyPicker`
  - `./OtpModal`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/shared/navigationConfig.js`
  - `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/FontFamilyPicker.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/OtpModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/utils/favicon.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/App.jsx`

### 3.192 `business-os-v1-centralized-org-path/frontend/src/constants.js`

- Declared exports: `CURRENCY`, `DELIVERY_FEE_PAYER`, `EMPTY_CUSTOMER`, `LAYOUT`, `PAYMENT_METHODS`, `STOCK`, `STORAGE_KEYS`, `SYNC`, `WRITE_CHANNELS`, `createEmptyOrder`, `formatDate`, `isNetworkError`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (7)
  - `business-os-v1-centralized-org-path/frontend/src/api/http.js`
  - `business-os-v1-centralized-org-path/frontend/src/api/methods.js`
  - `business-os-v1-centralized-org-path/frontend/src/api/websocket.js`
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/auth/Login.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/users/UserProfileModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/web-api.js`

### 3.193 `business-os-v1-centralized-org-path/frontend/src/index.jsx`

- Declared exports: none detected
- Imports (5)
  - `./App`
  - `./AppContext`
  - `./styles/main.css`
  - `react`
  - `react-dom/client`
- Internal dependencies (3)
  - `business-os-v1-centralized-org-path/frontend/src/App.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/styles/main.css`
- Referenced by (0)
  - none

### 3.194 `business-os-v1-centralized-org-path/frontend/src/utils/appRefresh.js`

- Declared exports: `refreshAppData`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/Backup.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/ResetData.jsx`

### 3.195 `business-os-v1-centralized-org-path/frontend/src/utils/csv.js`

- Declared exports: `downloadCSV`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (9)
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/Contacts.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/CustomersTab.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/DeliveryTab.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/SuppliersTab.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/dashboard/Dashboard.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/inventory/Inventory.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/products/Products.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/returns/Returns.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/AuditLog.jsx`

### 3.196 `business-os-v1-centralized-org-path/frontend/src/utils/dateHelpers.js`

- Declared exports: `offsetDate`, `todayStr`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/components/dashboard/Dashboard.jsx`

### 3.197 `business-os-v1-centralized-org-path/frontend/src/utils/deviceInfo.js`

- Declared exports: `getClientDeviceInfo`, `getClientMetaHeaders`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (6)
  - `business-os-v1-centralized-org-path/frontend/src/api/http.js`
  - `business-os-v1-centralized-org-path/frontend/src/api/methods.js`
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/auth/Login.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/pos/POS.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/sales/Sales.jsx`

### 3.198 `business-os-v1-centralized-org-path/frontend/src/utils/favicon.js`

- Declared exports: `createCircularFaviconDataUrl`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `business-os-v1-centralized-org-path/frontend/src/App.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/catalog/CatalogPage.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/Settings.jsx`

### 3.199 `business-os-v1-centralized-org-path/frontend/src/utils/firebasePhoneAuth.js`

- Declared exports: `cleanupFirebasePhoneVerification`, `confirmFirebasePhoneCode`, `requestFirebasePhoneCode`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.200 `business-os-v1-centralized-org-path/frontend/src/utils/formatters.js`

- Declared exports: `fmtCount`, `fmtDate`, `fmtShort`, `fmtTime`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (15)
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/CustomersTab.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/DeliveryTab.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/contacts/SuppliersTab.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/BarChart.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/DonutChart.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/LineChart.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/dashboard/Dashboard.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/inventory/Inventory.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/returns/NewReturnModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/returns/ReturnDetailModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/returns/Returns.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/sales/SaleDetailModal.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/sales/Sales.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/users/UserDetailSheet.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/users/Users.jsx`

### 3.201 `business-os-v1-centralized-org-path/frontend/src/utils/index.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.202 `business-os-v1-centralized-org-path/frontend/src/utils/printReceipt.js`

- Declared exports: `PRINT_DEFAULTS`, `createReceiptPdfBlob`, `downloadReceiptPdf`, `getPaperWidthMm`, `getPrintSettings`, `openReceiptPdf`, `printReceipt`, `savePrintSettings`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/PrintSettings.jsx`
  - `business-os-v1-centralized-org-path/frontend/src/components/receipt/Receipt.jsx`

### 3.203 `business-os-v1-centralized-org-path/frontend/src/web-api.js`

- Declared exports: none detected
- Imports (5)
  - `./api/http.js`
  - `./api/localDb.js`
  - `./api/methods.js`
  - `./api/websocket.js`
  - `./constants.js`
- Internal dependencies (5)
  - `business-os-v1-centralized-org-path/frontend/src/api/http.js`
  - `business-os-v1-centralized-org-path/frontend/src/api/localDb.js`
  - `business-os-v1-centralized-org-path/frontend/src/api/methods.js`
  - `business-os-v1-centralized-org-path/frontend/src/api/websocket.js`
  - `business-os-v1-centralized-org-path/frontend/src/constants.js`
- Referenced by (1)
  - `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`

### 3.204 `business-os-v1-centralized-org-path/frontend/tailwind.config.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.205 `business-os-v1-centralized-org-path/frontend/tests/appShellUtils.test.mjs`

- Declared exports: none detected
- Imports (2)
  - `../src/app/appShellUtils.mjs`
  - `node:assert/strict`
- Internal dependencies (1)
  - `business-os-v1-centralized-org-path/frontend/src/app/appShellUtils.mjs`
- Referenced by (0)
  - none

### 3.206 `business-os-v1-centralized-org-path/frontend/tests/portalEditorUtils.test.mjs`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.207 `business-os-v1-centralized-org-path/frontend/vite.config.mjs`

- Declared exports: `defineConfig`
- Imports (2)
  - `@vitejs/plugin-react`
  - `vite`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.208 `business-os-v2-dedicated-server/backend/server.js`

- Declared exports: none detected
- Imports (32)
  - `./src/config`
  - `./src/database`
  - `./src/helpers`
  - `./src/middleware`
  - `./src/organizationContext`
  - `./src/requestContext`
  - `./src/routes/ai`
  - `./src/routes/auth`
  - `./src/routes/branches`
  - `./src/routes/catalog`
  - `./src/routes/categories`
  - `./src/routes/contacts`
  - `./src/routes/customTables`
  - `./src/routes/files`
  - `./src/routes/inventory`
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
  - `./src/websocket`
  - `compression`
  - `cors`
  - `express`
  - `fs`
  - `http`
  - `path`
- Internal dependencies (26)
  - `business-os-v2-dedicated-server/backend/src/config.js`
  - `business-os-v2-dedicated-server/backend/src/database.js`
  - `business-os-v2-dedicated-server/backend/src/helpers.js`
  - `business-os-v2-dedicated-server/backend/src/middleware.js`
  - `business-os-v2-dedicated-server/backend/src/organizationContext.js`
  - `business-os-v2-dedicated-server/backend/src/requestContext.js`
  - `business-os-v2-dedicated-server/backend/src/routes/ai.js`
  - `business-os-v2-dedicated-server/backend/src/routes/auth.js`
  - `business-os-v2-dedicated-server/backend/src/routes/branches.js`
  - `business-os-v2-dedicated-server/backend/src/routes/catalog.js`
  - `business-os-v2-dedicated-server/backend/src/routes/categories.js`
  - `business-os-v2-dedicated-server/backend/src/routes/contacts.js`
  - `business-os-v2-dedicated-server/backend/src/routes/customTables.js`
  - `business-os-v2-dedicated-server/backend/src/routes/files.js`
  - `business-os-v2-dedicated-server/backend/src/routes/inventory.js`
  - `business-os-v2-dedicated-server/backend/src/routes/organizations.js`
  - `business-os-v2-dedicated-server/backend/src/routes/portal.js`
  - `business-os-v2-dedicated-server/backend/src/routes/products.js`
  - `business-os-v2-dedicated-server/backend/src/routes/returns.js`
  - `business-os-v2-dedicated-server/backend/src/routes/sales.js`
  - `business-os-v2-dedicated-server/backend/src/routes/settings.js`
  - `business-os-v2-dedicated-server/backend/src/routes/system.js`
  - `business-os-v2-dedicated-server/backend/src/routes/units.js`
  - `business-os-v2-dedicated-server/backend/src/routes/users.js`
  - `business-os-v2-dedicated-server/backend/src/serverUtils.js`
  - `business-os-v2-dedicated-server/backend/src/websocket.js`
- Referenced by (0)
  - none

### 3.209 `business-os-v2-dedicated-server/backend/src/accessControl.js`

- Declared exports: `module.exports`
- Imports (2)
  - `./config`
  - `./security`
- Internal dependencies (2)
  - `business-os-v2-dedicated-server/backend/src/config.js`
  - `business-os-v2-dedicated-server/backend/src/security.js`
- Referenced by (3)
  - `business-os-v2-dedicated-server/backend/src/middleware.js`
  - `business-os-v2-dedicated-server/backend/src/routes/system.js`
  - `business-os-v2-dedicated-server/backend/test/accessControl.test.js`

### 3.210 `business-os-v2-dedicated-server/backend/src/backupSchema.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v2-dedicated-server/backend/src/routes/system.js`
  - `business-os-v2-dedicated-server/backend/test/backupSchema.test.js`

### 3.211 `business-os-v2-dedicated-server/backend/src/config.js`

- Declared exports: `module.exports`
- Imports (3)
  - `dotenv`
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (9)
  - `business-os-v2-dedicated-server/backend/server.js`
  - `business-os-v2-dedicated-server/backend/src/accessControl.js`
  - `business-os-v2-dedicated-server/backend/src/database.js`
  - `business-os-v2-dedicated-server/backend/src/fileAssets.js`
  - `business-os-v2-dedicated-server/backend/src/middleware.js`
  - `business-os-v2-dedicated-server/backend/src/organizationContext.js`
  - `business-os-v2-dedicated-server/backend/src/routes/products.js`
  - `business-os-v2-dedicated-server/backend/src/routes/system.js`
  - `business-os-v2-dedicated-server/backend/src/services/googleDriveSync.js`

### 3.212 `business-os-v2-dedicated-server/backend/src/database.js`

- Declared exports: `module.exports`
- Imports (6)
  - `./config`
  - `bcryptjs`
  - `better-sqlite3`
  - `crypto`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/backend/src/config.js`
- Referenced by (24)
  - `business-os-v2-dedicated-server/backend/server.js`
  - `business-os-v2-dedicated-server/backend/src/fileAssets.js`
  - `business-os-v2-dedicated-server/backend/src/helpers.js`
  - `business-os-v2-dedicated-server/backend/src/organizationContext.js`
  - `business-os-v2-dedicated-server/backend/src/routes/ai.js`
  - `business-os-v2-dedicated-server/backend/src/routes/auth.js`
  - `business-os-v2-dedicated-server/backend/src/routes/branches.js`
  - `business-os-v2-dedicated-server/backend/src/routes/catalog.js`
  - `business-os-v2-dedicated-server/backend/src/routes/categories.js`
  - `business-os-v2-dedicated-server/backend/src/routes/contacts.js`
  - `business-os-v2-dedicated-server/backend/src/routes/customTables.js`
  - `business-os-v2-dedicated-server/backend/src/routes/inventory.js`
  - `business-os-v2-dedicated-server/backend/src/routes/portal.js`
  - `business-os-v2-dedicated-server/backend/src/routes/products.js`
  - `business-os-v2-dedicated-server/backend/src/routes/returns.js`
  - `business-os-v2-dedicated-server/backend/src/routes/sales.js`
  - `business-os-v2-dedicated-server/backend/src/routes/settings.js`
  - `business-os-v2-dedicated-server/backend/src/routes/system.js`
  - `business-os-v2-dedicated-server/backend/src/routes/units.js`
  - `business-os-v2-dedicated-server/backend/src/routes/users.js`
  - `business-os-v2-dedicated-server/backend/src/services/googleDriveSync.js`
  - `business-os-v2-dedicated-server/backend/src/services/portalAi.js`
  - `business-os-v2-dedicated-server/backend/src/services/verification.js`
  - `business-os-v2-dedicated-server/backend/src/sessionAuth.js`

### 3.213 `business-os-v2-dedicated-server/backend/src/dataPath.js`

- Declared exports: `module.exports`
- Imports (2)
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `business-os-v2-dedicated-server/backend/src/routes/system.js`
  - `business-os-v2-dedicated-server/backend/src/services/googleDriveSync.js`
  - `business-os-v2-dedicated-server/backend/src/systemFsWorker.js`
  - `business-os-v2-dedicated-server/backend/test/dataPath.test.js`

### 3.214 `business-os-v2-dedicated-server/backend/src/fileAssets.js`

- Declared exports: `module.exports`
- Imports (6)
  - `./config`
  - `./database`
  - `./uploadSecurity`
  - `fs`
  - `path`
  - `sharp`
- Internal dependencies (3)
  - `business-os-v2-dedicated-server/backend/src/config.js`
  - `business-os-v2-dedicated-server/backend/src/database.js`
  - `business-os-v2-dedicated-server/backend/src/uploadSecurity.js`
- Referenced by (5)
  - `business-os-v2-dedicated-server/backend/src/middleware.js`
  - `business-os-v2-dedicated-server/backend/src/routes/files.js`
  - `business-os-v2-dedicated-server/backend/src/routes/portal.js`
  - `business-os-v2-dedicated-server/backend/src/routes/products.js`
  - `business-os-v2-dedicated-server/backend/src/routes/users.js`

### 3.215 `business-os-v2-dedicated-server/backend/src/helpers.js`

- Declared exports: `module.exports`
- Imports (3)
  - `./database`
  - `./requestContext`
  - `./services/googleDriveSync`
- Internal dependencies (3)
  - `business-os-v2-dedicated-server/backend/src/database.js`
  - `business-os-v2-dedicated-server/backend/src/requestContext.js`
  - `business-os-v2-dedicated-server/backend/src/services/googleDriveSync.js`
- Referenced by (19)
  - `business-os-v2-dedicated-server/backend/server.js`
  - `business-os-v2-dedicated-server/backend/src/routes/ai.js`
  - `business-os-v2-dedicated-server/backend/src/routes/auth.js`
  - `business-os-v2-dedicated-server/backend/src/routes/branches.js`
  - `business-os-v2-dedicated-server/backend/src/routes/catalog.js`
  - `business-os-v2-dedicated-server/backend/src/routes/categories.js`
  - `business-os-v2-dedicated-server/backend/src/routes/contacts.js`
  - `business-os-v2-dedicated-server/backend/src/routes/customTables.js`
  - `business-os-v2-dedicated-server/backend/src/routes/files.js`
  - `business-os-v2-dedicated-server/backend/src/routes/inventory.js`
  - `business-os-v2-dedicated-server/backend/src/routes/portal.js`
  - `business-os-v2-dedicated-server/backend/src/routes/products.js`
  - `business-os-v2-dedicated-server/backend/src/routes/returns.js`
  - `business-os-v2-dedicated-server/backend/src/routes/sales.js`
  - `business-os-v2-dedicated-server/backend/src/routes/settings.js`
  - `business-os-v2-dedicated-server/backend/src/routes/system.js`
  - `business-os-v2-dedicated-server/backend/src/routes/units.js`
  - `business-os-v2-dedicated-server/backend/src/routes/users.js`
  - `business-os-v2-dedicated-server/backend/src/websocket.js`

### 3.216 `business-os-v2-dedicated-server/backend/src/middleware.js`

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
  - `business-os-v2-dedicated-server/backend/src/accessControl.js`
  - `business-os-v2-dedicated-server/backend/src/config.js`
  - `business-os-v2-dedicated-server/backend/src/fileAssets.js`
  - `business-os-v2-dedicated-server/backend/src/security.js`
  - `business-os-v2-dedicated-server/backend/src/sessionAuth.js`
  - `business-os-v2-dedicated-server/backend/src/uploadSecurity.js`
- Referenced by (18)
  - `business-os-v2-dedicated-server/backend/server.js`
  - `business-os-v2-dedicated-server/backend/src/routes/ai.js`
  - `business-os-v2-dedicated-server/backend/src/routes/auth.js`
  - `business-os-v2-dedicated-server/backend/src/routes/branches.js`
  - `business-os-v2-dedicated-server/backend/src/routes/categories.js`
  - `business-os-v2-dedicated-server/backend/src/routes/contacts.js`
  - `business-os-v2-dedicated-server/backend/src/routes/customTables.js`
  - `business-os-v2-dedicated-server/backend/src/routes/files.js`
  - `business-os-v2-dedicated-server/backend/src/routes/inventory.js`
  - `business-os-v2-dedicated-server/backend/src/routes/organizations.js`
  - `business-os-v2-dedicated-server/backend/src/routes/portal.js`
  - `business-os-v2-dedicated-server/backend/src/routes/products.js`
  - `business-os-v2-dedicated-server/backend/src/routes/returns.js`
  - `business-os-v2-dedicated-server/backend/src/routes/sales.js`
  - `business-os-v2-dedicated-server/backend/src/routes/settings.js`
  - `business-os-v2-dedicated-server/backend/src/routes/system.js`
  - `business-os-v2-dedicated-server/backend/src/routes/units.js`
  - `business-os-v2-dedicated-server/backend/src/routes/users.js`

### 3.217 `business-os-v2-dedicated-server/backend/src/netSecurity.js`

- Declared exports: `module.exports`
- Imports (1)
  - `net`
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `business-os-v2-dedicated-server/backend/src/routes/portal.js`
  - `business-os-v2-dedicated-server/backend/src/routes/products.js`
  - `business-os-v2-dedicated-server/backend/src/services/aiGateway.js`
  - `business-os-v2-dedicated-server/backend/test/netSecurity.test.js`

### 3.218 `business-os-v2-dedicated-server/backend/src/organizationContext.js`

- Declared exports: `module.exports`
- Imports (5)
  - `./config`
  - `./database`
  - `crypto`
  - `fs`
  - `path`
- Internal dependencies (2)
  - `business-os-v2-dedicated-server/backend/src/config.js`
  - `business-os-v2-dedicated-server/backend/src/database.js`
- Referenced by (5)
  - `business-os-v2-dedicated-server/backend/server.js`
  - `business-os-v2-dedicated-server/backend/src/routes/auth.js`
  - `business-os-v2-dedicated-server/backend/src/routes/organizations.js`
  - `business-os-v2-dedicated-server/backend/src/routes/portal.js`
  - `business-os-v2-dedicated-server/backend/src/routes/users.js`

### 3.219 `business-os-v2-dedicated-server/backend/src/portalUtils.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v2-dedicated-server/backend/src/routes/portal.js`
  - `business-os-v2-dedicated-server/backend/test/portalUtils.test.js`

### 3.220 `business-os-v2-dedicated-server/backend/src/requestContext.js`

- Declared exports: `module.exports`
- Imports (1)
  - `async_hooks`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v2-dedicated-server/backend/server.js`
  - `business-os-v2-dedicated-server/backend/src/helpers.js`

### 3.221 `business-os-v2-dedicated-server/backend/src/routes/ai.js`

- Declared exports: `module.exports`
- Imports (5)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `../services/aiGateway`
  - `express`
- Internal dependencies (4)
  - `business-os-v2-dedicated-server/backend/src/database.js`
  - `business-os-v2-dedicated-server/backend/src/helpers.js`
  - `business-os-v2-dedicated-server/backend/src/middleware.js`
  - `business-os-v2-dedicated-server/backend/src/services/aiGateway.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/backend/server.js`

### 3.222 `business-os-v2-dedicated-server/backend/src/routes/auth.js`

- Declared exports: `module.exports`
- Imports (13)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `../organizationContext`
  - `../security`
  - `../services/supabaseAuth`
  - `../services/verification`
  - `../sessionAuth`
  - `bcryptjs`
  - `crypto`
  - `express`
  - `qrcode`
  - `speakeasy`
- Internal dependencies (8)
  - `business-os-v2-dedicated-server/backend/src/database.js`
  - `business-os-v2-dedicated-server/backend/src/helpers.js`
  - `business-os-v2-dedicated-server/backend/src/middleware.js`
  - `business-os-v2-dedicated-server/backend/src/organizationContext.js`
  - `business-os-v2-dedicated-server/backend/src/security.js`
  - `business-os-v2-dedicated-server/backend/src/services/supabaseAuth.js`
  - `business-os-v2-dedicated-server/backend/src/services/verification.js`
  - `business-os-v2-dedicated-server/backend/src/sessionAuth.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/backend/server.js`

### 3.223 `business-os-v2-dedicated-server/backend/src/routes/branches.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v2-dedicated-server/backend/src/database.js`
  - `business-os-v2-dedicated-server/backend/src/helpers.js`
  - `business-os-v2-dedicated-server/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/backend/server.js`

### 3.224 `business-os-v2-dedicated-server/backend/src/routes/catalog.js`

- Declared exports: `module.exports`
- Imports (3)
  - `../database`
  - `../helpers`
  - `express`
- Internal dependencies (2)
  - `business-os-v2-dedicated-server/backend/src/database.js`
  - `business-os-v2-dedicated-server/backend/src/helpers.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/backend/server.js`

### 3.225 `business-os-v2-dedicated-server/backend/src/routes/categories.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v2-dedicated-server/backend/src/database.js`
  - `business-os-v2-dedicated-server/backend/src/helpers.js`
  - `business-os-v2-dedicated-server/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/backend/server.js`

### 3.226 `business-os-v2-dedicated-server/backend/src/routes/contacts.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v2-dedicated-server/backend/src/database.js`
  - `business-os-v2-dedicated-server/backend/src/helpers.js`
  - `business-os-v2-dedicated-server/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/backend/server.js`

### 3.227 `business-os-v2-dedicated-server/backend/src/routes/customTables.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v2-dedicated-server/backend/src/database.js`
  - `business-os-v2-dedicated-server/backend/src/helpers.js`
  - `business-os-v2-dedicated-server/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/backend/server.js`

### 3.228 `business-os-v2-dedicated-server/backend/src/routes/files.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v2-dedicated-server/backend/src/fileAssets.js`
  - `business-os-v2-dedicated-server/backend/src/helpers.js`
  - `business-os-v2-dedicated-server/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/backend/server.js`

### 3.229 `business-os-v2-dedicated-server/backend/src/routes/inventory.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v2-dedicated-server/backend/src/database.js`
  - `business-os-v2-dedicated-server/backend/src/helpers.js`
  - `business-os-v2-dedicated-server/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/backend/server.js`

### 3.230 `business-os-v2-dedicated-server/backend/src/routes/organizations.js`

- Declared exports: `module.exports`
- Imports (3)
  - `../middleware`
  - `../organizationContext`
  - `express`
- Internal dependencies (2)
  - `business-os-v2-dedicated-server/backend/src/middleware.js`
  - `business-os-v2-dedicated-server/backend/src/organizationContext.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/backend/server.js`

### 3.231 `business-os-v2-dedicated-server/backend/src/routes/portal.js`

- Declared exports: `module.exports`
- Imports (10)
  - `../database`
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `../netSecurity`
  - `../organizationContext`
  - `../portalUtils`
  - `../security`
  - `../services/portalAi`
  - `express`
- Internal dependencies (9)
  - `business-os-v2-dedicated-server/backend/src/database.js`
  - `business-os-v2-dedicated-server/backend/src/fileAssets.js`
  - `business-os-v2-dedicated-server/backend/src/helpers.js`
  - `business-os-v2-dedicated-server/backend/src/middleware.js`
  - `business-os-v2-dedicated-server/backend/src/netSecurity.js`
  - `business-os-v2-dedicated-server/backend/src/organizationContext.js`
  - `business-os-v2-dedicated-server/backend/src/portalUtils.js`
  - `business-os-v2-dedicated-server/backend/src/security.js`
  - `business-os-v2-dedicated-server/backend/src/services/portalAi.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/backend/server.js`

### 3.232 `business-os-v2-dedicated-server/backend/src/routes/products.js`

- Declared exports: `module.exports`
- Imports (9)
  - `../config`
  - `../database`
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `../netSecurity`
  - `express`
  - `fs`
  - `path`
- Internal dependencies (6)
  - `business-os-v2-dedicated-server/backend/src/config.js`
  - `business-os-v2-dedicated-server/backend/src/database.js`
  - `business-os-v2-dedicated-server/backend/src/fileAssets.js`
  - `business-os-v2-dedicated-server/backend/src/helpers.js`
  - `business-os-v2-dedicated-server/backend/src/middleware.js`
  - `business-os-v2-dedicated-server/backend/src/netSecurity.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/backend/server.js`

### 3.233 `business-os-v2-dedicated-server/backend/src/routes/returns.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v2-dedicated-server/backend/src/database.js`
  - `business-os-v2-dedicated-server/backend/src/helpers.js`
  - `business-os-v2-dedicated-server/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/backend/server.js`

### 3.234 `business-os-v2-dedicated-server/backend/src/routes/sales.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v2-dedicated-server/backend/src/database.js`
  - `business-os-v2-dedicated-server/backend/src/helpers.js`
  - `business-os-v2-dedicated-server/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/backend/server.js`

### 3.235 `business-os-v2-dedicated-server/backend/src/routes/settings.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v2-dedicated-server/backend/src/database.js`
  - `business-os-v2-dedicated-server/backend/src/helpers.js`
  - `business-os-v2-dedicated-server/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/backend/server.js`

### 3.236 `business-os-v2-dedicated-server/backend/src/routes/system.js`

- Declared exports: `module.exports`
- Imports (15)
  - `../accessControl`
  - `../backupSchema`
  - `../config`
  - `../dataPath`
  - `../database`
  - `../helpers`
  - `../middleware`
  - `../security`
  - `../services/googleDriveSync`
  - `bcryptjs`
  - `better-sqlite3`
  - `child_process`
  - `express`
  - `fs`
  - `path`
- Internal dependencies (9)
  - `business-os-v2-dedicated-server/backend/src/accessControl.js`
  - `business-os-v2-dedicated-server/backend/src/backupSchema.js`
  - `business-os-v2-dedicated-server/backend/src/config.js`
  - `business-os-v2-dedicated-server/backend/src/dataPath.js`
  - `business-os-v2-dedicated-server/backend/src/database.js`
  - `business-os-v2-dedicated-server/backend/src/helpers.js`
  - `business-os-v2-dedicated-server/backend/src/middleware.js`
  - `business-os-v2-dedicated-server/backend/src/security.js`
  - `business-os-v2-dedicated-server/backend/src/services/googleDriveSync.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/backend/server.js`

### 3.237 `business-os-v2-dedicated-server/backend/src/routes/units.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v2-dedicated-server/backend/src/database.js`
  - `business-os-v2-dedicated-server/backend/src/helpers.js`
  - `business-os-v2-dedicated-server/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/backend/server.js`

### 3.238 `business-os-v2-dedicated-server/backend/src/routes/users.js`

- Declared exports: `module.exports`
- Imports (9)
  - `../database`
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `../organizationContext`
  - `../services/supabaseAuth`
  - `../services/verification`
  - `bcryptjs`
  - `express`
- Internal dependencies (7)
  - `business-os-v2-dedicated-server/backend/src/database.js`
  - `business-os-v2-dedicated-server/backend/src/fileAssets.js`
  - `business-os-v2-dedicated-server/backend/src/helpers.js`
  - `business-os-v2-dedicated-server/backend/src/middleware.js`
  - `business-os-v2-dedicated-server/backend/src/organizationContext.js`
  - `business-os-v2-dedicated-server/backend/src/services/supabaseAuth.js`
  - `business-os-v2-dedicated-server/backend/src/services/verification.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/backend/server.js`

### 3.239 `business-os-v2-dedicated-server/backend/src/security.js`

- Declared exports: `module.exports`
- Imports (1)
  - `crypto`
- Internal dependencies (0)
  - none
- Referenced by (7)
  - `business-os-v2-dedicated-server/backend/src/accessControl.js`
  - `business-os-v2-dedicated-server/backend/src/middleware.js`
  - `business-os-v2-dedicated-server/backend/src/routes/auth.js`
  - `business-os-v2-dedicated-server/backend/src/routes/portal.js`
  - `business-os-v2-dedicated-server/backend/src/routes/system.js`
  - `business-os-v2-dedicated-server/backend/src/services/aiGateway.js`
  - `business-os-v2-dedicated-server/backend/src/services/googleDriveSync.js`

### 3.240 `business-os-v2-dedicated-server/backend/src/serverUtils.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v2-dedicated-server/backend/server.js`
  - `business-os-v2-dedicated-server/backend/test/serverUtils.test.js`

### 3.241 `business-os-v2-dedicated-server/backend/src/services/aiGateway.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../netSecurity`
  - `../security`
- Internal dependencies (2)
  - `business-os-v2-dedicated-server/backend/src/netSecurity.js`
  - `business-os-v2-dedicated-server/backend/src/security.js`
- Referenced by (2)
  - `business-os-v2-dedicated-server/backend/src/routes/ai.js`
  - `business-os-v2-dedicated-server/backend/src/services/portalAi.js`

### 3.242 `business-os-v2-dedicated-server/backend/src/services/firebaseAuth.js`

- Declared exports: `module.exports`
- Imports (2)
  - `crypto`
  - `fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.243 `business-os-v2-dedicated-server/backend/src/services/googleDriveSync.js`

- Declared exports: `module.exports`
- Imports (8)
  - `../config`
  - `../dataPath`
  - `../database`
  - `../security`
  - `crypto`
  - `fs`
  - `os`
  - `path`
- Internal dependencies (4)
  - `business-os-v2-dedicated-server/backend/src/config.js`
  - `business-os-v2-dedicated-server/backend/src/dataPath.js`
  - `business-os-v2-dedicated-server/backend/src/database.js`
  - `business-os-v2-dedicated-server/backend/src/security.js`
- Referenced by (2)
  - `business-os-v2-dedicated-server/backend/src/helpers.js`
  - `business-os-v2-dedicated-server/backend/src/routes/system.js`

### 3.244 `business-os-v2-dedicated-server/backend/src/services/portalAi.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../database`
  - `./aiGateway`
- Internal dependencies (2)
  - `business-os-v2-dedicated-server/backend/src/database.js`
  - `business-os-v2-dedicated-server/backend/src/services/aiGateway.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/backend/src/routes/portal.js`

### 3.245 `business-os-v2-dedicated-server/backend/src/services/supabaseAuth.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v2-dedicated-server/backend/src/routes/auth.js`
  - `business-os-v2-dedicated-server/backend/src/routes/users.js`

### 3.246 `business-os-v2-dedicated-server/backend/src/services/verification.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../database`
  - `crypto`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/backend/src/database.js`
- Referenced by (2)
  - `business-os-v2-dedicated-server/backend/src/routes/auth.js`
  - `business-os-v2-dedicated-server/backend/src/routes/users.js`

### 3.247 `business-os-v2-dedicated-server/backend/src/sessionAuth.js`

- Declared exports: `module.exports`
- Imports (2)
  - `./database`
  - `crypto`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/backend/src/database.js`
- Referenced by (3)
  - `business-os-v2-dedicated-server/backend/src/middleware.js`
  - `business-os-v2-dedicated-server/backend/src/routes/auth.js`
  - `business-os-v2-dedicated-server/backend/src/websocket.js`

### 3.248 `business-os-v2-dedicated-server/backend/src/systemFsWorker.js`

- Declared exports: none detected
- Imports (3)
  - `./dataPath`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/backend/src/dataPath.js`
- Referenced by (0)
  - none

### 3.249 `business-os-v2-dedicated-server/backend/src/uploadSecurity.js`

- Declared exports: `module.exports`
- Imports (2)
  - `fs`
  - `sharp`
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `business-os-v2-dedicated-server/backend/src/fileAssets.js`
  - `business-os-v2-dedicated-server/backend/src/middleware.js`
  - `business-os-v2-dedicated-server/backend/test/uploadSecurity.test.js`

### 3.250 `business-os-v2-dedicated-server/backend/src/websocket.js`

- Declared exports: `module.exports`
- Imports (4)
  - `./helpers`
  - `./sessionAuth`
  - `http`
  - `ws`
- Internal dependencies (2)
  - `business-os-v2-dedicated-server/backend/src/helpers.js`
  - `business-os-v2-dedicated-server/backend/src/sessionAuth.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/backend/server.js`

### 3.251 `business-os-v2-dedicated-server/backend/test/accessControl.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/accessControl`
  - `node:assert/strict`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/backend/src/accessControl.js`
- Referenced by (0)
  - none

### 3.252 `business-os-v2-dedicated-server/backend/test/backupRoundtrip.test.js`

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

### 3.253 `business-os-v2-dedicated-server/backend/test/backupSchema.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/backupSchema`
  - `node:assert/strict`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/backend/src/backupSchema.js`
- Referenced by (0)
  - none

### 3.254 `business-os-v2-dedicated-server/backend/test/dataPath.test.js`

- Declared exports: none detected
- Imports (5)
  - `../src/dataPath`
  - `fs`
  - `node:assert/strict`
  - `os`
  - `path`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/backend/src/dataPath.js`
- Referenced by (0)
  - none

### 3.255 `business-os-v2-dedicated-server/backend/test/netSecurity.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/netSecurity`
  - `node:assert/strict`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/backend/src/netSecurity.js`
- Referenced by (0)
  - none

### 3.256 `business-os-v2-dedicated-server/backend/test/portalUtils.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/portalUtils`
  - `node:assert/strict`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/backend/src/portalUtils.js`
- Referenced by (0)
  - none

### 3.257 `business-os-v2-dedicated-server/backend/test/serverUtils.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/serverUtils`
  - `node:assert/strict`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/backend/src/serverUtils.js`
- Referenced by (0)
  - none

### 3.258 `business-os-v2-dedicated-server/backend/test/uploadSecurity.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/uploadSecurity`
  - `node:assert/strict`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/backend/src/uploadSecurity.js`
- Referenced by (0)
  - none

### 3.259 `business-os-v2-dedicated-server/frontend/postcss.config.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.260 `business-os-v2-dedicated-server/frontend/src/api/http.js`

- Declared exports: `apiFetch`, `cacheClearAll`, `cacheGet`, `cacheGetStale`, `cacheInvalidate`, `cacheSet`, `clearCallLog`, `getAuthSessionToken`, `getCallLog`, `getSyncServerUrl`, `getSyncToken`, `isNetErr`, `isServerOnline`, `route`, `setAuthSessionToken`, `setSyncServerUrl`, `setSyncToken`, `startHealthCheck`
- Imports (2)
  - `../constants.js`
  - `../utils/deviceInfo.js`
- Internal dependencies (2)
  - `business-os-v2-dedicated-server/frontend/src/constants.js`
  - `business-os-v2-dedicated-server/frontend/src/utils/deviceInfo.js`
- Referenced by (5)
  - `business-os-v2-dedicated-server/frontend/src/api/methods.js`
  - `business-os-v2-dedicated-server/frontend/src/api/websocket.js`
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/utils-settings/Backup.jsx`
  - `business-os-v2-dedicated-server/frontend/src/web-api.js`

### 3.261 `business-os-v2-dedicated-server/frontend/src/api/localDb.js`

- Declared exports: `buildCSVTemplate`, `dexieDb`, `localGetSettings`, `localSaveSettings`, `parseCSV`
- Imports (1)
  - `dexie`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v2-dedicated-server/frontend/src/api/methods.js`
  - `business-os-v2-dedicated-server/frontend/src/web-api.js`

### 3.262 `business-os-v2-dedicated-server/frontend/src/api/methods.js`

- Declared exports: `adjustStock`, `askPortalAi`, `attachSaleCustomer`, `browseDir`, `bulkImportCustomers`, `bulkImportDeliveryContacts`, `bulkImportProducts`, `bulkImportSuppliers`, `changeUserPassword`, `completePasswordReset`, `completeSupabaseOauth`, `createAiProvider`, `createBranch`, `createCategory`, `createCustomField`, `createCustomTable`, `createCustomer`, `createDeliveryContact`, `createPortalSubmission`, `createProduct`, `createProductVariant`, `createReturn`, `createRole`, `createSale`, `createSupplier`, `createSupplierReturn`, `createUnit`, `createUser`, `deleteAiProvider`, `deleteBranch`, `deleteCategory`, `deleteCustomField`, `deleteCustomRow`, `deleteCustomer`, `deleteDeliveryContact`, `deleteFileAsset`, `deleteProduct`, `deleteRole`, `deleteSupplier`, `deleteUnit`, `disconnectGoogleDriveSync`, `disconnectUserAuthProvider`, `downloadCustomerTemplate`, `downloadImportTemplate`, `downloadSupplierTemplate`, `exportBackup`, `exportBackupFolder`, `factoryReset`, `flushPendingSyncQueue`, `getAiProviders`, `getAiResponses`, `getAnalytics`, `getAuditLogs`, `getBranchStock`, `getBranches`, `getCatalogMeta`, `getCatalogProducts`, `getCategories`, `getCurrentOrganization`, `getCustomFields`, `getCustomTableData`, `getCustomTables`, `getCustomers`, `getDashboard`, `getDataPath`, `getDeliveryContacts`, `getFiles`, `getGoogleDriveSyncStatus`, `getImageDataUrl`, `getInventoryMovements`, `getInventorySummary`, `getOrganizationBootstrap`, `getPortalAiStatus`, `getPortalCatalogMeta`, `getPortalCatalogProducts`, `getPortalConfig`, `getPortalSubmissionsForReview`, `getProducts`, `getReturn`, `getReturns`, `getRoles`, `getSales`, `getSalesExport`, `getSettings`, `getSuppliers`, `getSystemConfig`, `getSystemDebugLog`, `getTransfers`, `getUnits`, `getUserAuthMethods`, `getUserProfile`, `getUsers`, `getVerificationCapabilities`, `importBackup`, `importBackupData`, `importBackupFolder`, `insertCustomRow`, `login`, `logout`, `lookupPortalMembership`, `openCSVDialog`, `openFolderDialog`, `openImageDialog`, `openPath`, `otpConfirm`, `otpDisable`, `otpSetup`, `otpStatus`, `otpVerify`, `pickBackupFile`, `requestPasswordResetEmail`, `resetData`, `resetDataPath`, `resetPassword`, `resetPasswordWithOtp`, `reviewPortalSubmission`, `saveGoogleDriveSyncPreferences`, `saveSettings`, `searchOrganizations`, `setDataPath`, `startGoogleDriveSyncOauth`, `startSupabaseOauth`, `syncGoogleDriveNow`, `testAiProvider`, `testSyncServer`, `transferStock`, `updateAiProvider`, `updateBranch`, `updateCategory`, `updateCustomField`, `updateCustomRow`, `updateCustomer`, `updateDeliveryContact`, `updateProduct`, `updateReturn`, `updateRole`, `updateSaleStatus`, `updateSupplier`, `updateUser`, `updateUserProfile`, `uploadFileAsset`, `uploadProductImage`, `uploadUserAvatar`
- Imports (4)
  - `../constants`
  - `../utils/deviceInfo.js`
  - `./http.js`
  - `./localDb.js`
- Internal dependencies (4)
  - `business-os-v2-dedicated-server/frontend/src/api/http.js`
  - `business-os-v2-dedicated-server/frontend/src/api/localDb.js`
  - `business-os-v2-dedicated-server/frontend/src/constants.js`
  - `business-os-v2-dedicated-server/frontend/src/utils/deviceInfo.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/web-api.js`

### 3.263 `business-os-v2-dedicated-server/frontend/src/api/websocket.js`

- Declared exports: `connectWS`, `disconnectWS`, `isWSConnected`
- Imports (2)
  - `../constants.js`
  - `./http.js`
- Internal dependencies (2)
  - `business-os-v2-dedicated-server/frontend/src/api/http.js`
  - `business-os-v2-dedicated-server/frontend/src/constants.js`
- Referenced by (2)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/web-api.js`

### 3.264 `business-os-v2-dedicated-server/frontend/src/App.jsx`

- Declared exports: `function`
- Imports (24)
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
  - `./components/shared/PageHelpButton`
  - `./components/users/Users`
  - `./components/utils-settings/AuditLog`
  - `./components/utils-settings/Backup`
  - `./components/utils-settings/Settings`
  - `./utils/favicon`
  - `react`
- Internal dependencies (23)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/app/appShellUtils.mjs`
  - `business-os-v2-dedicated-server/frontend/src/components/auth/Login.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/branches/Branches.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/catalog/CatalogPage.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/Contacts.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/dashboard/Dashboard.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/files/FilesPage.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/inventory/Inventory.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/navigation/Sidebar.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/pos/POS.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/Products.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/ReceiptSettings.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/returns/Returns.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/sales/Sales.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/server/ServerPage.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/shared/PageHelpButton.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/users/Users.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/utils-settings/AuditLog.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/utils-settings/Backup.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/utils-settings/Settings.jsx`
  - `business-os-v2-dedicated-server/frontend/src/utils/favicon.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/index.jsx`

### 3.265 `business-os-v2-dedicated-server/frontend/src/app/appShellUtils.mjs`

- Declared exports: `MAX_MOUNTED_PAGES`, `getNotificationColor`, `getNotificationPrefix`, `isPublicCatalogPath`, `updateMountedPages`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v2-dedicated-server/frontend/src/App.jsx`
  - `business-os-v2-dedicated-server/frontend/tests/appShellUtils.test.mjs`

### 3.266 `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`

- Declared exports: `AppProvider`, `PAGE_PERMISSIONS`, `useApp`, `useSync`, `useT`
- Imports (8)
  - `./api/http.js`
  - `./api/websocket.js`
  - `./constants`
  - `./lang/en.json`
  - `./lang/km.json`
  - `./utils/deviceInfo.js`
  - `./web-api.js`
  - `react`
- Internal dependencies (7)
  - `business-os-v2-dedicated-server/frontend/src/api/http.js`
  - `business-os-v2-dedicated-server/frontend/src/api/websocket.js`
  - `business-os-v2-dedicated-server/frontend/src/constants.js`
  - `business-os-v2-dedicated-server/frontend/src/lang/en.json`
  - `business-os-v2-dedicated-server/frontend/src/lang/km.json`
  - `business-os-v2-dedicated-server/frontend/src/utils/deviceInfo.js`
  - `business-os-v2-dedicated-server/frontend/src/web-api.js`
- Referenced by (44)
  - `business-os-v2-dedicated-server/frontend/src/App.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/auth/Login.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/branches/Branches.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/branches/BranchForm.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/branches/TransferModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/catalog/CatalogPage.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/Contacts.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/CustomersTab.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/DeliveryTab.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/shared.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/SuppliersTab.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/custom-tables/CustomTables.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/NoData.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/dashboard/Dashboard.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/files/FilePickerModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/files/FilesPage.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/inventory/Inventory.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/navigation/Sidebar.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/pos/POS.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/BulkImportModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/ManageBrandsModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/ManageCategoriesModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/Products.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/VariantFormModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/AllFieldsPanel.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/ReceiptSettings.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/receipt/Receipt.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/returns/EditReturnModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/returns/NewReturnModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/returns/NewSupplierReturnModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/returns/ReturnDetailModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/returns/Returns.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/sales/Sales.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/server/ServerPage.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/shared/PageHelpButton.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/users/UserProfileModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/users/Users.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/utils-settings/AuditLog.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/utils-settings/Backup.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/utils-settings/OtpModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/utils-settings/ResetData.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/utils-settings/Settings.jsx`
  - `business-os-v2-dedicated-server/frontend/src/index.jsx`

### 3.267 `business-os-v2-dedicated-server/frontend/src/components/auth/Login.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `../../constants`
  - `../../utils/deviceInfo.js`
  - `react`
- Internal dependencies (3)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/constants.js`
  - `business-os-v2-dedicated-server/frontend/src/utils/deviceInfo.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/App.jsx`

### 3.268 `business-os-v2-dedicated-server/frontend/src/components/branches/Branches.jsx`

- Declared exports: `function`
- Imports (6)
  - `../../AppContext`
  - `../shared/Modal`
  - `./BranchForm`
  - `./TransferModal`
  - `lucide-react`
  - `react`
- Internal dependencies (4)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/branches/BranchForm.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/branches/TransferModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/App.jsx`

### 3.269 `business-os-v2-dedicated-server/frontend/src/components/branches/BranchForm.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/branches/Branches.jsx`

### 3.270 `business-os-v2-dedicated-server/frontend/src/components/branches/TransferModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/branches/Branches.jsx`

### 3.271 `business-os-v2-dedicated-server/frontend/src/components/catalog/CatalogPage.jsx`

- Declared exports: `function`
- Imports (6)
  - `../../AppContext`
  - `../../utils/favicon`
  - `../files/FilePickerModal`
  - `../products/primitives`
  - `../shared/ImageGalleryLightbox`
  - `react`
- Internal dependencies (5)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/files/FilePickerModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/primitives.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/shared/ImageGalleryLightbox.jsx`
  - `business-os-v2-dedicated-server/frontend/src/utils/favicon.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/App.jsx`

### 3.272 `business-os-v2-dedicated-server/frontend/src/components/catalog/portalEditorUtils.mjs`

- Declared exports: `createAboutBlock`, `extractGoogleMapsEmbedUrl`, `moveListItem`, `normalizeAboutBlocks`, `normalizeGoogleMapsEmbed`, `serializeAboutBlocks`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.273 `business-os-v2-dedicated-server/frontend/src/components/contacts/Contacts.jsx`

- Declared exports: `function`
- Imports (9)
  - `../../AppContext`
  - `../../utils/csv`
  - `../shared/Modal`
  - `./CustomersTab`
  - `./DeliveryTab`
  - `./SuppliersTab`
  - `./shared`
  - `lucide-react`
  - `react`
- Internal dependencies (7)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/CustomersTab.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/DeliveryTab.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/SuppliersTab.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/shared.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/shared/Modal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/utils/csv.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/App.jsx`

### 3.274 `business-os-v2-dedicated-server/frontend/src/components/contacts/CustomersTab.jsx`

- Declared exports: `parseContactOptions`, `serializeContactOptions`
- Imports (7)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `../shared/Modal`
  - `./shared`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/shared.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/shared/Modal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/utils/csv.js`
  - `business-os-v2-dedicated-server/frontend/src/utils/formatters.js`
- Referenced by (2)
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/Contacts.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/pos/POS.jsx`

### 3.275 `business-os-v2-dedicated-server/frontend/src/components/contacts/DeliveryTab.jsx`

- Declared exports: `parseDeliveryOptions`, `serializeDeliveryOptions`
- Imports (7)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `../shared/Modal`
  - `./shared`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/shared.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/shared/Modal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/utils/csv.js`
  - `business-os-v2-dedicated-server/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/Contacts.jsx`

### 3.276 `business-os-v2-dedicated-server/frontend/src/components/contacts/shared.jsx`

- Declared exports: `ContactTable`, `DetailModal`, `ImportModal`, `ThreeDotMenu`, `useContactSelection`
- Imports (4)
  - `../../AppContext`
  - `../files/FilePickerModal`
  - `../shared/Modal`
  - `react`
- Internal dependencies (3)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/files/FilePickerModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/shared/Modal.jsx`
- Referenced by (4)
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/Contacts.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/CustomersTab.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/DeliveryTab.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/SuppliersTab.jsx`

### 3.277 `business-os-v2-dedicated-server/frontend/src/components/contacts/SuppliersTab.jsx`

- Declared exports: none detected
- Imports (7)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `../shared/Modal`
  - `./shared`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/shared.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/shared/Modal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/utils/csv.js`
  - `business-os-v2-dedicated-server/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/Contacts.jsx`

### 3.278 `business-os-v2-dedicated-server/frontend/src/components/custom-tables/CustomTables.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
- Referenced by (0)
  - none

### 3.279 `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/BarChart.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../../utils/formatters`
  - `./NoData`
  - `react`
- Internal dependencies (2)
  - `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/NoData.jsx`
  - `business-os-v2-dedicated-server/frontend/src/utils/formatters.js`
- Referenced by (0)
  - none

### 3.280 `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/DonutChart.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../../utils/formatters`
  - `./NoData`
  - `react`
- Internal dependencies (2)
  - `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/NoData.jsx`
  - `business-os-v2-dedicated-server/frontend/src/utils/formatters.js`
- Referenced by (0)
  - none

### 3.281 `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/index.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/dashboard/Dashboard.jsx`

### 3.282 `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/LineChart.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../../utils/formatters`
  - `./NoData`
  - `react`
- Internal dependencies (2)
  - `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/NoData.jsx`
  - `business-os-v2-dedicated-server/frontend/src/utils/formatters.js`
- Referenced by (0)
  - none

### 3.283 `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/NoData.jsx`

- Declared exports: `function`
- Imports (1)
  - `../../../AppContext`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
- Referenced by (3)
  - `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/BarChart.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/DonutChart.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/LineChart.jsx`

### 3.284 `business-os-v2-dedicated-server/frontend/src/components/dashboard/Dashboard.jsx`

- Declared exports: `function`
- Imports (9)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/dateHelpers`
  - `../../utils/formatters`
  - `../shared/PortalMenu`
  - `./MiniStat`
  - `./charts`
  - `lucide-react`
  - `react`
- Internal dependencies (7)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/dashboard/MiniStat.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/index.js`
  - `business-os-v2-dedicated-server/frontend/src/components/shared/PortalMenu.jsx`
  - `business-os-v2-dedicated-server/frontend/src/utils/csv.js`
  - `business-os-v2-dedicated-server/frontend/src/utils/dateHelpers.js`
  - `business-os-v2-dedicated-server/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/App.jsx`

### 3.285 `business-os-v2-dedicated-server/frontend/src/components/dashboard/MiniStat.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/dashboard/Dashboard.jsx`

### 3.286 `business-os-v2-dedicated-server/frontend/src/components/files/FilePickerModal.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `../shared/Modal`
  - `react`
- Internal dependencies (2)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/shared/Modal.jsx`
- Referenced by (5)
  - `business-os-v2-dedicated-server/frontend/src/components/catalog/CatalogPage.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/shared.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/BulkImportModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/ProductForm.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/users/UserProfileModal.jsx`

### 3.287 `business-os-v2-dedicated-server/frontend/src/components/files/FilesPage.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/App.jsx`

### 3.288 `business-os-v2-dedicated-server/frontend/src/components/inventory/DualMoney.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v2-dedicated-server/frontend/src/components/inventory/Inventory.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/inventory/ProductDetailModal.jsx`

### 3.289 `business-os-v2-dedicated-server/frontend/src/components/inventory/Inventory.jsx`

- Declared exports: `function`
- Imports (8)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `./DualMoney`
  - `./ProductDetailModal`
  - `./movementGroups`
  - `lucide-react`
  - `react`
- Internal dependencies (6)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/inventory/DualMoney.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/inventory/ProductDetailModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/inventory/movementGroups.js`
  - `business-os-v2-dedicated-server/frontend/src/utils/csv.js`
  - `business-os-v2-dedicated-server/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/App.jsx`

### 3.290 `business-os-v2-dedicated-server/frontend/src/components/inventory/movementGroups.js`

- Declared exports: `buildMovementGroups`, `movementGroupHaystack`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/inventory/Inventory.jsx`

### 3.291 `business-os-v2-dedicated-server/frontend/src/components/inventory/ProductDetailModal.jsx`

- Declared exports: `function`
- Imports (1)
  - `./DualMoney`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/frontend/src/components/inventory/DualMoney.jsx`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/inventory/Inventory.jsx`

### 3.292 `business-os-v2-dedicated-server/frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `lucide-react`
  - `react`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/App.jsx`

### 3.293 `business-os-v2-dedicated-server/frontend/src/components/navigation/Sidebar.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `../shared/navigationConfig`
  - `../users/UserProfileModal`
  - `react`
- Internal dependencies (3)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/shared/navigationConfig.js`
  - `business-os-v2-dedicated-server/frontend/src/components/users/UserProfileModal.jsx`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/App.jsx`

### 3.294 `business-os-v2-dedicated-server/frontend/src/components/pos/CartItem.jsx`

- Declared exports: `function`
- Imports (1)
  - `./ProductImage`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/frontend/src/components/pos/ProductImage.jsx`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/pos/POS.jsx`

### 3.295 `business-os-v2-dedicated-server/frontend/src/components/pos/FilterPanel.jsx`

- Declared exports: `function`
- Imports (1)
  - `lucide-react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/pos/POS.jsx`

### 3.296 `business-os-v2-dedicated-server/frontend/src/components/pos/POS.jsx`

- Declared exports: `function`
- Imports (12)
  - `../../AppContext`
  - `../../utils/deviceInfo`
  - `../contacts/CustomersTab`
  - `../receipt/Receipt`
  - `../sales/StatusBadge`
  - `../shared/ImageGalleryLightbox`
  - `./CartItem`
  - `./FilterPanel`
  - `./ProductImage`
  - `./QuickAddModal`
  - `lucide-react`
  - `react`
- Internal dependencies (10)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/CustomersTab.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/pos/CartItem.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/pos/FilterPanel.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/pos/ProductImage.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/pos/QuickAddModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/receipt/Receipt.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/sales/StatusBadge.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/shared/ImageGalleryLightbox.jsx`
  - `business-os-v2-dedicated-server/frontend/src/utils/deviceInfo.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/App.jsx`

### 3.297 `business-os-v2-dedicated-server/frontend/src/components/pos/ProductImage.jsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v2-dedicated-server/frontend/src/components/pos/CartItem.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/pos/POS.jsx`

### 3.298 `business-os-v2-dedicated-server/frontend/src/components/pos/QuickAddModal.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/pos/POS.jsx`

### 3.299 `business-os-v2-dedicated-server/frontend/src/components/products/BranchStockAdjuster.jsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/products/ProductForm.jsx`

### 3.300 `business-os-v2-dedicated-server/frontend/src/components/products/BulkAddStockModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../shared/Modal`
  - `react`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/products/Products.jsx`

### 3.301 `business-os-v2-dedicated-server/frontend/src/components/products/BulkImportModal.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `../files/FilePickerModal`
  - `../shared/Modal`
  - `react`
- Internal dependencies (3)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/files/FilePickerModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/products/Products.jsx`

### 3.302 `business-os-v2-dedicated-server/frontend/src/components/products/HeaderActions.jsx`

- Declared exports: `function`
- Imports (2)
  - `../shared/PortalMenu`
  - `lucide-react`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/frontend/src/components/shared/PortalMenu.jsx`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/products/Products.jsx`

### 3.303 `business-os-v2-dedicated-server/frontend/src/components/products/ManageBrandsModal.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `../shared/Modal`
  - `react`
- Internal dependencies (2)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/products/Products.jsx`

### 3.304 `business-os-v2-dedicated-server/frontend/src/components/products/ManageCategoriesModal.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `../shared/Modal`
  - `react`
- Internal dependencies (2)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/products/Products.jsx`

### 3.305 `business-os-v2-dedicated-server/frontend/src/components/products/ManageFieldsModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../shared/Modal`
  - `react`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/products/Products.jsx`

### 3.306 `business-os-v2-dedicated-server/frontend/src/components/products/ManageMenu.jsx`

- Declared exports: `function`
- Imports (1)
  - `../shared/PortalMenu`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/frontend/src/components/shared/PortalMenu.jsx`
- Referenced by (0)
  - none

### 3.307 `business-os-v2-dedicated-server/frontend/src/components/products/ManageUnitsModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../shared/Modal`
  - `react`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/products/Products.jsx`

### 3.308 `business-os-v2-dedicated-server/frontend/src/components/products/primitives.jsx`

- Declared exports: none detected
- Imports (2)
  - `lucide-react`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `business-os-v2-dedicated-server/frontend/src/components/catalog/CatalogPage.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/ProductDetailModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/ProductForm.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/Products.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/VariantFormModal.jsx`

### 3.309 `business-os-v2-dedicated-server/frontend/src/components/products/ProductDetailModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `./primitives`
  - `lucide-react`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/frontend/src/components/products/primitives.jsx`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/products/Products.jsx`

### 3.310 `business-os-v2-dedicated-server/frontend/src/components/products/ProductForm.jsx`

- Declared exports: `function`
- Imports (5)
  - `../files/FilePickerModal`
  - `../shared/Modal`
  - `./BranchStockAdjuster`
  - `./primitives`
  - `react`
- Internal dependencies (4)
  - `business-os-v2-dedicated-server/frontend/src/components/files/FilePickerModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/BranchStockAdjuster.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/primitives.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/products/Products.jsx`

### 3.311 `business-os-v2-dedicated-server/frontend/src/components/products/Products.jsx`

- Declared exports: `function`
- Imports (18)
  - `../../AppContext`
  - `../../utils/csv`
  - `../shared/ImageGalleryLightbox`
  - `../shared/Modal`
  - `../shared/PortalMenu`
  - `./BulkAddStockModal`
  - `./BulkImportModal`
  - `./HeaderActions`
  - `./ManageBrandsModal`
  - `./ManageCategoriesModal`
  - `./ManageFieldsModal`
  - `./ManageUnitsModal`
  - `./ProductDetailModal`
  - `./ProductForm`
  - `./VariantFormModal`
  - `./primitives`
  - `lucide-react`
  - `react`
- Internal dependencies (16)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/BulkAddStockModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/BulkImportModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/HeaderActions.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/ManageBrandsModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/ManageCategoriesModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/ManageFieldsModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/ManageUnitsModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/ProductDetailModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/ProductForm.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/VariantFormModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/primitives.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/shared/ImageGalleryLightbox.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/shared/Modal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/shared/PortalMenu.jsx`
  - `business-os-v2-dedicated-server/frontend/src/utils/csv.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/App.jsx`

### 3.312 `business-os-v2-dedicated-server/frontend/src/components/products/VariantFormModal.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `../shared/Modal`
  - `./primitives`
  - `react`
- Internal dependencies (3)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/primitives.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/products/Products.jsx`

### 3.313 `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/AllFieldsPanel.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `./constants`
  - `react`
- Internal dependencies (2)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/constants.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.314 `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/constants.js`

- Declared exports: `ALL_FIELD_ITEMS`, `DEFAULT_TEMPLATE`, `getFieldItems`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/AllFieldsPanel.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/ReceiptSettings.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/receipt/Receipt.jsx`

### 3.315 `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/ErrorBoundary.jsx`

- Declared exports: `class`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.316 `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/FieldOrderManager.jsx`

- Declared exports: `function`
- Imports (2)
  - `lucide-react`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.317 `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/PrintSettings.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../utils/printReceipt`
  - `lucide-react`
  - `react`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/frontend/src/utils/printReceipt.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.318 `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/ReceiptPreview.jsx`

- Declared exports: `function`
- Imports (2)
  - `../receipt/Receipt`
  - `react`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/frontend/src/components/receipt/Receipt.jsx`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.319 `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/ReceiptSettings.jsx`

- Declared exports: `function`
- Imports (9)
  - `../../AppContext`
  - `./AllFieldsPanel`
  - `./ErrorBoundary`
  - `./FieldOrderManager`
  - `./PrintSettings`
  - `./ReceiptPreview`
  - `./constants`
  - `lucide-react`
  - `react`
- Internal dependencies (7)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/AllFieldsPanel.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/ErrorBoundary.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/FieldOrderManager.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/PrintSettings.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/ReceiptPreview.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/constants.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/App.jsx`

### 3.320 `business-os-v2-dedicated-server/frontend/src/components/receipt/Receipt.jsx`

- Declared exports: `function`, `parseTpl`
- Imports (6)
  - `../../AppContext`
  - `../../utils/printReceipt`
  - `../receipt-settings/constants`
  - `../sales/StatusBadge`
  - `lucide-react`
  - `react`
- Internal dependencies (4)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/constants.js`
  - `business-os-v2-dedicated-server/frontend/src/components/sales/StatusBadge.jsx`
  - `business-os-v2-dedicated-server/frontend/src/utils/printReceipt.js`
- Referenced by (3)
  - `business-os-v2-dedicated-server/frontend/src/components/pos/POS.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/ReceiptPreview.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/sales/Sales.jsx`

### 3.321 `business-os-v2-dedicated-server/frontend/src/components/returns/EditReturnModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/returns/Returns.jsx`

### 3.322 `business-os-v2-dedicated-server/frontend/src/components/returns/NewReturnModal.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `../../utils/formatters`
  - `react`
- Internal dependencies (2)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/returns/Returns.jsx`

### 3.323 `business-os-v2-dedicated-server/frontend/src/components/returns/NewSupplierReturnModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/returns/Returns.jsx`

### 3.324 `business-os-v2-dedicated-server/frontend/src/components/returns/ReturnDetailModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `../../utils/formatters`
- Internal dependencies (2)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/returns/Returns.jsx`

### 3.325 `business-os-v2-dedicated-server/frontend/src/components/returns/Returns.jsx`

- Declared exports: `function`
- Imports (9)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `./EditReturnModal`
  - `./NewReturnModal`
  - `./NewSupplierReturnModal`
  - `./ReturnDetailModal`
  - `lucide-react`
  - `react`
- Internal dependencies (7)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/returns/EditReturnModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/returns/NewReturnModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/returns/NewSupplierReturnModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/returns/ReturnDetailModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/utils/csv.js`
  - `business-os-v2-dedicated-server/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/App.jsx`

### 3.326 `business-os-v2-dedicated-server/frontend/src/components/sales/ExportModal.jsx`

- Declared exports: `function`
- Imports (4)
  - `../shared/Modal`
  - `./StatusBadge`
  - `lucide-react`
  - `react`
- Internal dependencies (2)
  - `business-os-v2-dedicated-server/frontend/src/components/sales/StatusBadge.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/sales/Sales.jsx`

### 3.327 `business-os-v2-dedicated-server/frontend/src/components/sales/SaleDetailModal.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../utils/formatters`
  - `./StatusBadge`
  - `react`
- Internal dependencies (2)
  - `business-os-v2-dedicated-server/frontend/src/components/sales/StatusBadge.jsx`
  - `business-os-v2-dedicated-server/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/sales/Sales.jsx`

### 3.328 `business-os-v2-dedicated-server/frontend/src/components/sales/Sales.jsx`

- Declared exports: `function`
- Imports (9)
  - `../../AppContext`
  - `../../utils/deviceInfo`
  - `../../utils/formatters`
  - `../receipt/Receipt`
  - `./ExportModal`
  - `./SaleDetailModal`
  - `./StatusBadge`
  - `lucide-react`
  - `react`
- Internal dependencies (7)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/receipt/Receipt.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/sales/ExportModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/sales/SaleDetailModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/sales/StatusBadge.jsx`
  - `business-os-v2-dedicated-server/frontend/src/utils/deviceInfo.js`
  - `business-os-v2-dedicated-server/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/App.jsx`

### 3.329 `business-os-v2-dedicated-server/frontend/src/components/sales/StatusBadge.jsx`

- Declared exports: `ALL_STATUSES`, `STATUS_COLORS`, `STATUS_LABELS`, `function`, `getStatusLabel`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `business-os-v2-dedicated-server/frontend/src/components/pos/POS.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/receipt/Receipt.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/sales/ExportModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/sales/SaleDetailModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/sales/Sales.jsx`

### 3.330 `business-os-v2-dedicated-server/frontend/src/components/server/ServerPage.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/App.jsx`

### 3.331 `business-os-v2-dedicated-server/frontend/src/components/shared/ImageGalleryLightbox.jsx`

- Declared exports: `function`
- Imports (2)
  - `lucide-react`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `business-os-v2-dedicated-server/frontend/src/components/catalog/CatalogPage.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/pos/POS.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/Products.jsx`

### 3.332 `business-os-v2-dedicated-server/frontend/src/components/shared/Modal.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (19)
  - `business-os-v2-dedicated-server/frontend/src/components/branches/Branches.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/Contacts.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/CustomersTab.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/DeliveryTab.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/shared.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/SuppliersTab.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/files/FilePickerModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/BulkAddStockModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/BulkImportModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/ManageBrandsModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/ManageCategoriesModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/ManageFieldsModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/ManageUnitsModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/ProductForm.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/Products.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/VariantFormModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/sales/ExportModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/users/UserProfileModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/users/Users.jsx`

### 3.333 `business-os-v2-dedicated-server/frontend/src/components/shared/navigationConfig.js`

- Declared exports: `DEFAULT_MOBILE_PINNED`, `NAV_ITEMS`, `orderNavItems`, `parseNavSetting`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v2-dedicated-server/frontend/src/components/navigation/Sidebar.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/utils-settings/Settings.jsx`

### 3.334 `business-os-v2-dedicated-server/frontend/src/components/shared/PageHelpButton.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `./pageHelpContent`
  - `lucide-react`
  - `react`
- Internal dependencies (2)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/shared/pageHelpContent.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/App.jsx`

### 3.335 `business-os-v2-dedicated-server/frontend/src/components/shared/pageHelpContent.js`

- Declared exports: `PAGE_HELP_CONTENT`, `getPageHelpContent`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/shared/PageHelpButton.jsx`

### 3.336 `business-os-v2-dedicated-server/frontend/src/components/shared/PortalMenu.jsx`

- Declared exports: `ThreeDotPortal`, `function`
- Imports (3)
  - `lucide-react`
  - `react`
  - `react-dom`
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `business-os-v2-dedicated-server/frontend/src/components/dashboard/Dashboard.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/HeaderActions.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/ManageMenu.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/Products.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/users/Users.jsx`

### 3.337 `business-os-v2-dedicated-server/frontend/src/components/users/PermissionEditor.jsx`

- Declared exports: `PERMISSION_DEFS`, `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v2-dedicated-server/frontend/src/components/users/UserDetailSheet.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/users/Users.jsx`

### 3.338 `business-os-v2-dedicated-server/frontend/src/components/users/UserDetailSheet.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../utils/formatters`
  - `./PermissionEditor`
- Internal dependencies (2)
  - `business-os-v2-dedicated-server/frontend/src/components/users/PermissionEditor.jsx`
  - `business-os-v2-dedicated-server/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/users/Users.jsx`

### 3.339 `business-os-v2-dedicated-server/frontend/src/components/users/UserProfileModal.jsx`

- Declared exports: `function`
- Imports (7)
  - `../../AppContext`
  - `../../constants`
  - `../files/FilePickerModal`
  - `../shared/Modal`
  - `../utils-settings/OtpModal`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/files/FilePickerModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/shared/Modal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/utils-settings/OtpModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/constants.js`
- Referenced by (2)
  - `business-os-v2-dedicated-server/frontend/src/components/navigation/Sidebar.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/users/Users.jsx`

### 3.340 `business-os-v2-dedicated-server/frontend/src/components/users/Users.jsx`

- Declared exports: `function`
- Imports (9)
  - `../../AppContext`
  - `../../utils/formatters`
  - `../shared/Modal`
  - `../shared/PortalMenu`
  - `./PermissionEditor`
  - `./UserDetailSheet`
  - `./UserProfileModal`
  - `lucide-react`
  - `react`
- Internal dependencies (7)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/shared/Modal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/shared/PortalMenu.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/users/PermissionEditor.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/users/UserDetailSheet.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/users/UserProfileModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/App.jsx`

### 3.341 `business-os-v2-dedicated-server/frontend/src/components/utils-settings/AuditLog.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `../../utils/csv`
  - `lucide-react`
  - `react`
- Internal dependencies (2)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/utils/csv.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/App.jsx`

### 3.342 `business-os-v2-dedicated-server/frontend/src/components/utils-settings/Backup.jsx`

- Declared exports: `function`
- Imports (6)
  - `../../AppContext`
  - `../../api/http`
  - `../../utils/appRefresh`
  - `./ResetData`
  - `lucide-react`
  - `react`
- Internal dependencies (4)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/api/http.js`
  - `business-os-v2-dedicated-server/frontend/src/components/utils-settings/ResetData.jsx`
  - `business-os-v2-dedicated-server/frontend/src/utils/appRefresh.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/App.jsx`

### 3.343 `business-os-v2-dedicated-server/frontend/src/components/utils-settings/FontFamilyPicker.jsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/utils-settings/Settings.jsx`

### 3.344 `business-os-v2-dedicated-server/frontend/src/components/utils-settings/index.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.345 `business-os-v2-dedicated-server/frontend/src/components/utils-settings/OtpModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
- Referenced by (2)
  - `business-os-v2-dedicated-server/frontend/src/components/users/UserProfileModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/utils-settings/Settings.jsx`

### 3.346 `business-os-v2-dedicated-server/frontend/src/components/utils-settings/ResetData.jsx`

- Declared exports: none detected
- Imports (4)
  - `../../AppContext`
  - `../../utils/appRefresh`
  - `lucide-react`
  - `react`
- Internal dependencies (2)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/utils/appRefresh.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/utils-settings/Backup.jsx`

### 3.347 `business-os-v2-dedicated-server/frontend/src/components/utils-settings/Settings.jsx`

- Declared exports: `function`
- Imports (7)
  - `../../AppContext`
  - `../../utils/favicon`
  - `../shared/navigationConfig`
  - `./FontFamilyPicker`
  - `./OtpModal`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/shared/navigationConfig.js`
  - `business-os-v2-dedicated-server/frontend/src/components/utils-settings/FontFamilyPicker.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/utils-settings/OtpModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/utils/favicon.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/App.jsx`

### 3.348 `business-os-v2-dedicated-server/frontend/src/constants.js`

- Declared exports: `CURRENCY`, `DELIVERY_FEE_PAYER`, `EMPTY_CUSTOMER`, `LAYOUT`, `PAYMENT_METHODS`, `STOCK`, `STORAGE_KEYS`, `SYNC`, `WRITE_CHANNELS`, `createEmptyOrder`, `formatDate`, `isNetworkError`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (7)
  - `business-os-v2-dedicated-server/frontend/src/api/http.js`
  - `business-os-v2-dedicated-server/frontend/src/api/methods.js`
  - `business-os-v2-dedicated-server/frontend/src/api/websocket.js`
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/auth/Login.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/users/UserProfileModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/web-api.js`

### 3.349 `business-os-v2-dedicated-server/frontend/src/index.jsx`

- Declared exports: none detected
- Imports (5)
  - `./App`
  - `./AppContext`
  - `./styles/main.css`
  - `react`
  - `react-dom/client`
- Internal dependencies (3)
  - `business-os-v2-dedicated-server/frontend/src/App.jsx`
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/styles/main.css`
- Referenced by (0)
  - none

### 3.350 `business-os-v2-dedicated-server/frontend/src/utils/appRefresh.js`

- Declared exports: `refreshAppData`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v2-dedicated-server/frontend/src/components/utils-settings/Backup.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/utils-settings/ResetData.jsx`

### 3.351 `business-os-v2-dedicated-server/frontend/src/utils/csv.js`

- Declared exports: `downloadCSV`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (9)
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/Contacts.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/CustomersTab.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/DeliveryTab.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/SuppliersTab.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/dashboard/Dashboard.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/inventory/Inventory.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/products/Products.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/returns/Returns.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/utils-settings/AuditLog.jsx`

### 3.352 `business-os-v2-dedicated-server/frontend/src/utils/dateHelpers.js`

- Declared exports: `offsetDate`, `todayStr`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/components/dashboard/Dashboard.jsx`

### 3.353 `business-os-v2-dedicated-server/frontend/src/utils/deviceInfo.js`

- Declared exports: `getClientDeviceInfo`, `getClientMetaHeaders`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (6)
  - `business-os-v2-dedicated-server/frontend/src/api/http.js`
  - `business-os-v2-dedicated-server/frontend/src/api/methods.js`
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/auth/Login.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/pos/POS.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/sales/Sales.jsx`

### 3.354 `business-os-v2-dedicated-server/frontend/src/utils/favicon.js`

- Declared exports: `createCircularFaviconDataUrl`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `business-os-v2-dedicated-server/frontend/src/App.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/catalog/CatalogPage.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/utils-settings/Settings.jsx`

### 3.355 `business-os-v2-dedicated-server/frontend/src/utils/firebasePhoneAuth.js`

- Declared exports: `cleanupFirebasePhoneVerification`, `confirmFirebasePhoneCode`, `requestFirebasePhoneCode`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.356 `business-os-v2-dedicated-server/frontend/src/utils/formatters.js`

- Declared exports: `fmtCount`, `fmtDate`, `fmtShort`, `fmtTime`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (15)
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/CustomersTab.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/DeliveryTab.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/contacts/SuppliersTab.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/BarChart.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/DonutChart.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/LineChart.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/dashboard/Dashboard.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/inventory/Inventory.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/returns/NewReturnModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/returns/ReturnDetailModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/returns/Returns.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/sales/SaleDetailModal.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/sales/Sales.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/users/UserDetailSheet.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/users/Users.jsx`

### 3.357 `business-os-v2-dedicated-server/frontend/src/utils/index.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.358 `business-os-v2-dedicated-server/frontend/src/utils/printReceipt.js`

- Declared exports: `PRINT_DEFAULTS`, `createReceiptPdfBlob`, `downloadReceiptPdf`, `getPaperWidthMm`, `getPrintSettings`, `openReceiptPdf`, `printReceipt`, `savePrintSettings`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/PrintSettings.jsx`
  - `business-os-v2-dedicated-server/frontend/src/components/receipt/Receipt.jsx`

### 3.359 `business-os-v2-dedicated-server/frontend/src/web-api.js`

- Declared exports: none detected
- Imports (5)
  - `./api/http.js`
  - `./api/localDb.js`
  - `./api/methods.js`
  - `./api/websocket.js`
  - `./constants.js`
- Internal dependencies (5)
  - `business-os-v2-dedicated-server/frontend/src/api/http.js`
  - `business-os-v2-dedicated-server/frontend/src/api/localDb.js`
  - `business-os-v2-dedicated-server/frontend/src/api/methods.js`
  - `business-os-v2-dedicated-server/frontend/src/api/websocket.js`
  - `business-os-v2-dedicated-server/frontend/src/constants.js`
- Referenced by (1)
  - `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`

### 3.360 `business-os-v2-dedicated-server/frontend/tailwind.config.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.361 `business-os-v2-dedicated-server/frontend/tests/appShellUtils.test.mjs`

- Declared exports: none detected
- Imports (2)
  - `../src/app/appShellUtils.mjs`
  - `node:assert/strict`
- Internal dependencies (1)
  - `business-os-v2-dedicated-server/frontend/src/app/appShellUtils.mjs`
- Referenced by (0)
  - none

### 3.362 `business-os-v2-dedicated-server/frontend/tests/portalEditorUtils.test.mjs`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.363 `business-os-v2-dedicated-server/frontend/vite.config.mjs`

- Declared exports: `defineConfig`
- Imports (2)
  - `@vitejs/plugin-react`
  - `vite`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.364 `business-os-v3-centralized-server-template/backend/server.js`

- Declared exports: none detected
- Imports (32)
  - `./src/config`
  - `./src/database`
  - `./src/helpers`
  - `./src/middleware`
  - `./src/organizationContext`
  - `./src/requestContext`
  - `./src/routes/ai`
  - `./src/routes/auth`
  - `./src/routes/branches`
  - `./src/routes/catalog`
  - `./src/routes/categories`
  - `./src/routes/contacts`
  - `./src/routes/customTables`
  - `./src/routes/files`
  - `./src/routes/inventory`
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
  - `./src/websocket`
  - `compression`
  - `cors`
  - `express`
  - `fs`
  - `http`
  - `path`
- Internal dependencies (26)
  - `business-os-v3-centralized-server-template/backend/src/config.js`
  - `business-os-v3-centralized-server-template/backend/src/database.js`
  - `business-os-v3-centralized-server-template/backend/src/helpers.js`
  - `business-os-v3-centralized-server-template/backend/src/middleware.js`
  - `business-os-v3-centralized-server-template/backend/src/organizationContext.js`
  - `business-os-v3-centralized-server-template/backend/src/requestContext.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/ai.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/auth.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/branches.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/catalog.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/categories.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/contacts.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/customTables.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/files.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/inventory.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/organizations.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/portal.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/products.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/returns.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/sales.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/settings.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/system.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/units.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/users.js`
  - `business-os-v3-centralized-server-template/backend/src/serverUtils.js`
  - `business-os-v3-centralized-server-template/backend/src/websocket.js`
- Referenced by (0)
  - none

### 3.365 `business-os-v3-centralized-server-template/backend/src/accessControl.js`

- Declared exports: `module.exports`
- Imports (2)
  - `./config`
  - `./security`
- Internal dependencies (2)
  - `business-os-v3-centralized-server-template/backend/src/config.js`
  - `business-os-v3-centralized-server-template/backend/src/security.js`
- Referenced by (3)
  - `business-os-v3-centralized-server-template/backend/src/middleware.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/system.js`
  - `business-os-v3-centralized-server-template/backend/test/accessControl.test.js`

### 3.366 `business-os-v3-centralized-server-template/backend/src/backupSchema.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v3-centralized-server-template/backend/src/routes/system.js`
  - `business-os-v3-centralized-server-template/backend/test/backupSchema.test.js`

### 3.367 `business-os-v3-centralized-server-template/backend/src/config.js`

- Declared exports: `module.exports`
- Imports (3)
  - `dotenv`
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (9)
  - `business-os-v3-centralized-server-template/backend/server.js`
  - `business-os-v3-centralized-server-template/backend/src/accessControl.js`
  - `business-os-v3-centralized-server-template/backend/src/database.js`
  - `business-os-v3-centralized-server-template/backend/src/fileAssets.js`
  - `business-os-v3-centralized-server-template/backend/src/middleware.js`
  - `business-os-v3-centralized-server-template/backend/src/organizationContext.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/products.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/system.js`
  - `business-os-v3-centralized-server-template/backend/src/services/googleDriveSync.js`

### 3.368 `business-os-v3-centralized-server-template/backend/src/database.js`

- Declared exports: `module.exports`
- Imports (6)
  - `./config`
  - `bcryptjs`
  - `better-sqlite3`
  - `crypto`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/backend/src/config.js`
- Referenced by (24)
  - `business-os-v3-centralized-server-template/backend/server.js`
  - `business-os-v3-centralized-server-template/backend/src/fileAssets.js`
  - `business-os-v3-centralized-server-template/backend/src/helpers.js`
  - `business-os-v3-centralized-server-template/backend/src/organizationContext.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/ai.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/auth.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/branches.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/catalog.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/categories.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/contacts.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/customTables.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/inventory.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/portal.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/products.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/returns.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/sales.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/settings.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/system.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/units.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/users.js`
  - `business-os-v3-centralized-server-template/backend/src/services/googleDriveSync.js`
  - `business-os-v3-centralized-server-template/backend/src/services/portalAi.js`
  - `business-os-v3-centralized-server-template/backend/src/services/verification.js`
  - `business-os-v3-centralized-server-template/backend/src/sessionAuth.js`

### 3.369 `business-os-v3-centralized-server-template/backend/src/dataPath.js`

- Declared exports: `module.exports`
- Imports (2)
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `business-os-v3-centralized-server-template/backend/src/routes/system.js`
  - `business-os-v3-centralized-server-template/backend/src/services/googleDriveSync.js`
  - `business-os-v3-centralized-server-template/backend/src/systemFsWorker.js`
  - `business-os-v3-centralized-server-template/backend/test/dataPath.test.js`

### 3.370 `business-os-v3-centralized-server-template/backend/src/fileAssets.js`

- Declared exports: `module.exports`
- Imports (6)
  - `./config`
  - `./database`
  - `./uploadSecurity`
  - `fs`
  - `path`
  - `sharp`
- Internal dependencies (3)
  - `business-os-v3-centralized-server-template/backend/src/config.js`
  - `business-os-v3-centralized-server-template/backend/src/database.js`
  - `business-os-v3-centralized-server-template/backend/src/uploadSecurity.js`
- Referenced by (5)
  - `business-os-v3-centralized-server-template/backend/src/middleware.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/files.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/portal.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/products.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/users.js`

### 3.371 `business-os-v3-centralized-server-template/backend/src/helpers.js`

- Declared exports: `module.exports`
- Imports (3)
  - `./database`
  - `./requestContext`
  - `./services/googleDriveSync`
- Internal dependencies (3)
  - `business-os-v3-centralized-server-template/backend/src/database.js`
  - `business-os-v3-centralized-server-template/backend/src/requestContext.js`
  - `business-os-v3-centralized-server-template/backend/src/services/googleDriveSync.js`
- Referenced by (19)
  - `business-os-v3-centralized-server-template/backend/server.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/ai.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/auth.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/branches.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/catalog.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/categories.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/contacts.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/customTables.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/files.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/inventory.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/portal.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/products.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/returns.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/sales.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/settings.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/system.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/units.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/users.js`
  - `business-os-v3-centralized-server-template/backend/src/websocket.js`

### 3.372 `business-os-v3-centralized-server-template/backend/src/middleware.js`

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
  - `business-os-v3-centralized-server-template/backend/src/accessControl.js`
  - `business-os-v3-centralized-server-template/backend/src/config.js`
  - `business-os-v3-centralized-server-template/backend/src/fileAssets.js`
  - `business-os-v3-centralized-server-template/backend/src/security.js`
  - `business-os-v3-centralized-server-template/backend/src/sessionAuth.js`
  - `business-os-v3-centralized-server-template/backend/src/uploadSecurity.js`
- Referenced by (18)
  - `business-os-v3-centralized-server-template/backend/server.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/ai.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/auth.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/branches.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/categories.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/contacts.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/customTables.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/files.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/inventory.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/organizations.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/portal.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/products.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/returns.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/sales.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/settings.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/system.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/units.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/users.js`

### 3.373 `business-os-v3-centralized-server-template/backend/src/netSecurity.js`

- Declared exports: `module.exports`
- Imports (1)
  - `net`
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `business-os-v3-centralized-server-template/backend/src/routes/portal.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/products.js`
  - `business-os-v3-centralized-server-template/backend/src/services/aiGateway.js`
  - `business-os-v3-centralized-server-template/backend/test/netSecurity.test.js`

### 3.374 `business-os-v3-centralized-server-template/backend/src/organizationContext.js`

- Declared exports: `module.exports`
- Imports (5)
  - `./config`
  - `./database`
  - `crypto`
  - `fs`
  - `path`
- Internal dependencies (2)
  - `business-os-v3-centralized-server-template/backend/src/config.js`
  - `business-os-v3-centralized-server-template/backend/src/database.js`
- Referenced by (5)
  - `business-os-v3-centralized-server-template/backend/server.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/auth.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/organizations.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/portal.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/users.js`

### 3.375 `business-os-v3-centralized-server-template/backend/src/portalUtils.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v3-centralized-server-template/backend/src/routes/portal.js`
  - `business-os-v3-centralized-server-template/backend/test/portalUtils.test.js`

### 3.376 `business-os-v3-centralized-server-template/backend/src/requestContext.js`

- Declared exports: `module.exports`
- Imports (1)
  - `async_hooks`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v3-centralized-server-template/backend/server.js`
  - `business-os-v3-centralized-server-template/backend/src/helpers.js`

### 3.377 `business-os-v3-centralized-server-template/backend/src/routes/ai.js`

- Declared exports: `module.exports`
- Imports (5)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `../services/aiGateway`
  - `express`
- Internal dependencies (4)
  - `business-os-v3-centralized-server-template/backend/src/database.js`
  - `business-os-v3-centralized-server-template/backend/src/helpers.js`
  - `business-os-v3-centralized-server-template/backend/src/middleware.js`
  - `business-os-v3-centralized-server-template/backend/src/services/aiGateway.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/backend/server.js`

### 3.378 `business-os-v3-centralized-server-template/backend/src/routes/auth.js`

- Declared exports: `module.exports`
- Imports (13)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `../organizationContext`
  - `../security`
  - `../services/supabaseAuth`
  - `../services/verification`
  - `../sessionAuth`
  - `bcryptjs`
  - `crypto`
  - `express`
  - `qrcode`
  - `speakeasy`
- Internal dependencies (8)
  - `business-os-v3-centralized-server-template/backend/src/database.js`
  - `business-os-v3-centralized-server-template/backend/src/helpers.js`
  - `business-os-v3-centralized-server-template/backend/src/middleware.js`
  - `business-os-v3-centralized-server-template/backend/src/organizationContext.js`
  - `business-os-v3-centralized-server-template/backend/src/security.js`
  - `business-os-v3-centralized-server-template/backend/src/services/supabaseAuth.js`
  - `business-os-v3-centralized-server-template/backend/src/services/verification.js`
  - `business-os-v3-centralized-server-template/backend/src/sessionAuth.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/backend/server.js`

### 3.379 `business-os-v3-centralized-server-template/backend/src/routes/branches.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v3-centralized-server-template/backend/src/database.js`
  - `business-os-v3-centralized-server-template/backend/src/helpers.js`
  - `business-os-v3-centralized-server-template/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/backend/server.js`

### 3.380 `business-os-v3-centralized-server-template/backend/src/routes/catalog.js`

- Declared exports: `module.exports`
- Imports (3)
  - `../database`
  - `../helpers`
  - `express`
- Internal dependencies (2)
  - `business-os-v3-centralized-server-template/backend/src/database.js`
  - `business-os-v3-centralized-server-template/backend/src/helpers.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/backend/server.js`

### 3.381 `business-os-v3-centralized-server-template/backend/src/routes/categories.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v3-centralized-server-template/backend/src/database.js`
  - `business-os-v3-centralized-server-template/backend/src/helpers.js`
  - `business-os-v3-centralized-server-template/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/backend/server.js`

### 3.382 `business-os-v3-centralized-server-template/backend/src/routes/contacts.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v3-centralized-server-template/backend/src/database.js`
  - `business-os-v3-centralized-server-template/backend/src/helpers.js`
  - `business-os-v3-centralized-server-template/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/backend/server.js`

### 3.383 `business-os-v3-centralized-server-template/backend/src/routes/customTables.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v3-centralized-server-template/backend/src/database.js`
  - `business-os-v3-centralized-server-template/backend/src/helpers.js`
  - `business-os-v3-centralized-server-template/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/backend/server.js`

### 3.384 `business-os-v3-centralized-server-template/backend/src/routes/files.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v3-centralized-server-template/backend/src/fileAssets.js`
  - `business-os-v3-centralized-server-template/backend/src/helpers.js`
  - `business-os-v3-centralized-server-template/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/backend/server.js`

### 3.385 `business-os-v3-centralized-server-template/backend/src/routes/inventory.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v3-centralized-server-template/backend/src/database.js`
  - `business-os-v3-centralized-server-template/backend/src/helpers.js`
  - `business-os-v3-centralized-server-template/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/backend/server.js`

### 3.386 `business-os-v3-centralized-server-template/backend/src/routes/organizations.js`

- Declared exports: `module.exports`
- Imports (3)
  - `../middleware`
  - `../organizationContext`
  - `express`
- Internal dependencies (2)
  - `business-os-v3-centralized-server-template/backend/src/middleware.js`
  - `business-os-v3-centralized-server-template/backend/src/organizationContext.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/backend/server.js`

### 3.387 `business-os-v3-centralized-server-template/backend/src/routes/portal.js`

- Declared exports: `module.exports`
- Imports (10)
  - `../database`
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `../netSecurity`
  - `../organizationContext`
  - `../portalUtils`
  - `../security`
  - `../services/portalAi`
  - `express`
- Internal dependencies (9)
  - `business-os-v3-centralized-server-template/backend/src/database.js`
  - `business-os-v3-centralized-server-template/backend/src/fileAssets.js`
  - `business-os-v3-centralized-server-template/backend/src/helpers.js`
  - `business-os-v3-centralized-server-template/backend/src/middleware.js`
  - `business-os-v3-centralized-server-template/backend/src/netSecurity.js`
  - `business-os-v3-centralized-server-template/backend/src/organizationContext.js`
  - `business-os-v3-centralized-server-template/backend/src/portalUtils.js`
  - `business-os-v3-centralized-server-template/backend/src/security.js`
  - `business-os-v3-centralized-server-template/backend/src/services/portalAi.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/backend/server.js`

### 3.388 `business-os-v3-centralized-server-template/backend/src/routes/products.js`

- Declared exports: `module.exports`
- Imports (9)
  - `../config`
  - `../database`
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `../netSecurity`
  - `express`
  - `fs`
  - `path`
- Internal dependencies (6)
  - `business-os-v3-centralized-server-template/backend/src/config.js`
  - `business-os-v3-centralized-server-template/backend/src/database.js`
  - `business-os-v3-centralized-server-template/backend/src/fileAssets.js`
  - `business-os-v3-centralized-server-template/backend/src/helpers.js`
  - `business-os-v3-centralized-server-template/backend/src/middleware.js`
  - `business-os-v3-centralized-server-template/backend/src/netSecurity.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/backend/server.js`

### 3.389 `business-os-v3-centralized-server-template/backend/src/routes/returns.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v3-centralized-server-template/backend/src/database.js`
  - `business-os-v3-centralized-server-template/backend/src/helpers.js`
  - `business-os-v3-centralized-server-template/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/backend/server.js`

### 3.390 `business-os-v3-centralized-server-template/backend/src/routes/sales.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v3-centralized-server-template/backend/src/database.js`
  - `business-os-v3-centralized-server-template/backend/src/helpers.js`
  - `business-os-v3-centralized-server-template/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/backend/server.js`

### 3.391 `business-os-v3-centralized-server-template/backend/src/routes/settings.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v3-centralized-server-template/backend/src/database.js`
  - `business-os-v3-centralized-server-template/backend/src/helpers.js`
  - `business-os-v3-centralized-server-template/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/backend/server.js`

### 3.392 `business-os-v3-centralized-server-template/backend/src/routes/system.js`

- Declared exports: `module.exports`
- Imports (15)
  - `../accessControl`
  - `../backupSchema`
  - `../config`
  - `../dataPath`
  - `../database`
  - `../helpers`
  - `../middleware`
  - `../security`
  - `../services/googleDriveSync`
  - `bcryptjs`
  - `better-sqlite3`
  - `child_process`
  - `express`
  - `fs`
  - `path`
- Internal dependencies (9)
  - `business-os-v3-centralized-server-template/backend/src/accessControl.js`
  - `business-os-v3-centralized-server-template/backend/src/backupSchema.js`
  - `business-os-v3-centralized-server-template/backend/src/config.js`
  - `business-os-v3-centralized-server-template/backend/src/dataPath.js`
  - `business-os-v3-centralized-server-template/backend/src/database.js`
  - `business-os-v3-centralized-server-template/backend/src/helpers.js`
  - `business-os-v3-centralized-server-template/backend/src/middleware.js`
  - `business-os-v3-centralized-server-template/backend/src/security.js`
  - `business-os-v3-centralized-server-template/backend/src/services/googleDriveSync.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/backend/server.js`

### 3.393 `business-os-v3-centralized-server-template/backend/src/routes/units.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (3)
  - `business-os-v3-centralized-server-template/backend/src/database.js`
  - `business-os-v3-centralized-server-template/backend/src/helpers.js`
  - `business-os-v3-centralized-server-template/backend/src/middleware.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/backend/server.js`

### 3.394 `business-os-v3-centralized-server-template/backend/src/routes/users.js`

- Declared exports: `module.exports`
- Imports (9)
  - `../database`
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `../organizationContext`
  - `../services/supabaseAuth`
  - `../services/verification`
  - `bcryptjs`
  - `express`
- Internal dependencies (7)
  - `business-os-v3-centralized-server-template/backend/src/database.js`
  - `business-os-v3-centralized-server-template/backend/src/fileAssets.js`
  - `business-os-v3-centralized-server-template/backend/src/helpers.js`
  - `business-os-v3-centralized-server-template/backend/src/middleware.js`
  - `business-os-v3-centralized-server-template/backend/src/organizationContext.js`
  - `business-os-v3-centralized-server-template/backend/src/services/supabaseAuth.js`
  - `business-os-v3-centralized-server-template/backend/src/services/verification.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/backend/server.js`

### 3.395 `business-os-v3-centralized-server-template/backend/src/security.js`

- Declared exports: `module.exports`
- Imports (1)
  - `crypto`
- Internal dependencies (0)
  - none
- Referenced by (7)
  - `business-os-v3-centralized-server-template/backend/src/accessControl.js`
  - `business-os-v3-centralized-server-template/backend/src/middleware.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/auth.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/portal.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/system.js`
  - `business-os-v3-centralized-server-template/backend/src/services/aiGateway.js`
  - `business-os-v3-centralized-server-template/backend/src/services/googleDriveSync.js`

### 3.396 `business-os-v3-centralized-server-template/backend/src/serverUtils.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v3-centralized-server-template/backend/server.js`
  - `business-os-v3-centralized-server-template/backend/test/serverUtils.test.js`

### 3.397 `business-os-v3-centralized-server-template/backend/src/services/aiGateway.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../netSecurity`
  - `../security`
- Internal dependencies (2)
  - `business-os-v3-centralized-server-template/backend/src/netSecurity.js`
  - `business-os-v3-centralized-server-template/backend/src/security.js`
- Referenced by (2)
  - `business-os-v3-centralized-server-template/backend/src/routes/ai.js`
  - `business-os-v3-centralized-server-template/backend/src/services/portalAi.js`

### 3.398 `business-os-v3-centralized-server-template/backend/src/services/firebaseAuth.js`

- Declared exports: `module.exports`
- Imports (2)
  - `crypto`
  - `fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.399 `business-os-v3-centralized-server-template/backend/src/services/googleDriveSync.js`

- Declared exports: `module.exports`
- Imports (8)
  - `../config`
  - `../dataPath`
  - `../database`
  - `../security`
  - `crypto`
  - `fs`
  - `os`
  - `path`
- Internal dependencies (4)
  - `business-os-v3-centralized-server-template/backend/src/config.js`
  - `business-os-v3-centralized-server-template/backend/src/dataPath.js`
  - `business-os-v3-centralized-server-template/backend/src/database.js`
  - `business-os-v3-centralized-server-template/backend/src/security.js`
- Referenced by (2)
  - `business-os-v3-centralized-server-template/backend/src/helpers.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/system.js`

### 3.400 `business-os-v3-centralized-server-template/backend/src/services/portalAi.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../database`
  - `./aiGateway`
- Internal dependencies (2)
  - `business-os-v3-centralized-server-template/backend/src/database.js`
  - `business-os-v3-centralized-server-template/backend/src/services/aiGateway.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/backend/src/routes/portal.js`

### 3.401 `business-os-v3-centralized-server-template/backend/src/services/supabaseAuth.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v3-centralized-server-template/backend/src/routes/auth.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/users.js`

### 3.402 `business-os-v3-centralized-server-template/backend/src/services/verification.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../database`
  - `crypto`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/backend/src/database.js`
- Referenced by (2)
  - `business-os-v3-centralized-server-template/backend/src/routes/auth.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/users.js`

### 3.403 `business-os-v3-centralized-server-template/backend/src/sessionAuth.js`

- Declared exports: `module.exports`
- Imports (2)
  - `./database`
  - `crypto`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/backend/src/database.js`
- Referenced by (3)
  - `business-os-v3-centralized-server-template/backend/src/middleware.js`
  - `business-os-v3-centralized-server-template/backend/src/routes/auth.js`
  - `business-os-v3-centralized-server-template/backend/src/websocket.js`

### 3.404 `business-os-v3-centralized-server-template/backend/src/systemFsWorker.js`

- Declared exports: none detected
- Imports (3)
  - `./dataPath`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/backend/src/dataPath.js`
- Referenced by (0)
  - none

### 3.405 `business-os-v3-centralized-server-template/backend/src/uploadSecurity.js`

- Declared exports: `module.exports`
- Imports (2)
  - `fs`
  - `sharp`
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `business-os-v3-centralized-server-template/backend/src/fileAssets.js`
  - `business-os-v3-centralized-server-template/backend/src/middleware.js`
  - `business-os-v3-centralized-server-template/backend/test/uploadSecurity.test.js`

### 3.406 `business-os-v3-centralized-server-template/backend/src/websocket.js`

- Declared exports: `module.exports`
- Imports (4)
  - `./helpers`
  - `./sessionAuth`
  - `http`
  - `ws`
- Internal dependencies (2)
  - `business-os-v3-centralized-server-template/backend/src/helpers.js`
  - `business-os-v3-centralized-server-template/backend/src/sessionAuth.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/backend/server.js`

### 3.407 `business-os-v3-centralized-server-template/backend/test/accessControl.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/accessControl`
  - `node:assert/strict`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/backend/src/accessControl.js`
- Referenced by (0)
  - none

### 3.408 `business-os-v3-centralized-server-template/backend/test/backupRoundtrip.test.js`

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

### 3.409 `business-os-v3-centralized-server-template/backend/test/backupSchema.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/backupSchema`
  - `node:assert/strict`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/backend/src/backupSchema.js`
- Referenced by (0)
  - none

### 3.410 `business-os-v3-centralized-server-template/backend/test/dataPath.test.js`

- Declared exports: none detected
- Imports (5)
  - `../src/dataPath`
  - `fs`
  - `node:assert/strict`
  - `os`
  - `path`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/backend/src/dataPath.js`
- Referenced by (0)
  - none

### 3.411 `business-os-v3-centralized-server-template/backend/test/netSecurity.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/netSecurity`
  - `node:assert/strict`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/backend/src/netSecurity.js`
- Referenced by (0)
  - none

### 3.412 `business-os-v3-centralized-server-template/backend/test/portalUtils.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/portalUtils`
  - `node:assert/strict`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/backend/src/portalUtils.js`
- Referenced by (0)
  - none

### 3.413 `business-os-v3-centralized-server-template/backend/test/serverUtils.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/serverUtils`
  - `node:assert/strict`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/backend/src/serverUtils.js`
- Referenced by (0)
  - none

### 3.414 `business-os-v3-centralized-server-template/backend/test/uploadSecurity.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/uploadSecurity`
  - `node:assert/strict`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/backend/src/uploadSecurity.js`
- Referenced by (0)
  - none

### 3.415 `business-os-v3-centralized-server-template/frontend/postcss.config.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.416 `business-os-v3-centralized-server-template/frontend/src/api/http.js`

- Declared exports: `apiFetch`, `cacheClearAll`, `cacheGet`, `cacheGetStale`, `cacheInvalidate`, `cacheSet`, `clearCallLog`, `getAuthSessionToken`, `getCallLog`, `getSyncServerUrl`, `getSyncToken`, `isNetErr`, `isServerOnline`, `route`, `setAuthSessionToken`, `setSyncServerUrl`, `setSyncToken`, `startHealthCheck`
- Imports (2)
  - `../constants.js`
  - `../utils/deviceInfo.js`
- Internal dependencies (2)
  - `business-os-v3-centralized-server-template/frontend/src/constants.js`
  - `business-os-v3-centralized-server-template/frontend/src/utils/deviceInfo.js`
- Referenced by (5)
  - `business-os-v3-centralized-server-template/frontend/src/api/methods.js`
  - `business-os-v3-centralized-server-template/frontend/src/api/websocket.js`
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/Backup.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/web-api.js`

### 3.417 `business-os-v3-centralized-server-template/frontend/src/api/localDb.js`

- Declared exports: `buildCSVTemplate`, `dexieDb`, `localGetSettings`, `localSaveSettings`, `parseCSV`
- Imports (1)
  - `dexie`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v3-centralized-server-template/frontend/src/api/methods.js`
  - `business-os-v3-centralized-server-template/frontend/src/web-api.js`

### 3.418 `business-os-v3-centralized-server-template/frontend/src/api/methods.js`

- Declared exports: `adjustStock`, `askPortalAi`, `attachSaleCustomer`, `browseDir`, `bulkImportCustomers`, `bulkImportDeliveryContacts`, `bulkImportProducts`, `bulkImportSuppliers`, `changeUserPassword`, `completePasswordReset`, `completeSupabaseOauth`, `createAiProvider`, `createBranch`, `createCategory`, `createCustomField`, `createCustomTable`, `createCustomer`, `createDeliveryContact`, `createPortalSubmission`, `createProduct`, `createProductVariant`, `createReturn`, `createRole`, `createSale`, `createSupplier`, `createSupplierReturn`, `createUnit`, `createUser`, `deleteAiProvider`, `deleteBranch`, `deleteCategory`, `deleteCustomField`, `deleteCustomRow`, `deleteCustomer`, `deleteDeliveryContact`, `deleteFileAsset`, `deleteProduct`, `deleteRole`, `deleteSupplier`, `deleteUnit`, `disconnectGoogleDriveSync`, `disconnectUserAuthProvider`, `downloadCustomerTemplate`, `downloadImportTemplate`, `downloadSupplierTemplate`, `exportBackup`, `exportBackupFolder`, `factoryReset`, `flushPendingSyncQueue`, `getAiProviders`, `getAiResponses`, `getAnalytics`, `getAuditLogs`, `getBranchStock`, `getBranches`, `getCatalogMeta`, `getCatalogProducts`, `getCategories`, `getCurrentOrganization`, `getCustomFields`, `getCustomTableData`, `getCustomTables`, `getCustomers`, `getDashboard`, `getDataPath`, `getDeliveryContacts`, `getFiles`, `getGoogleDriveSyncStatus`, `getImageDataUrl`, `getInventoryMovements`, `getInventorySummary`, `getOrganizationBootstrap`, `getPortalAiStatus`, `getPortalCatalogMeta`, `getPortalCatalogProducts`, `getPortalConfig`, `getPortalSubmissionsForReview`, `getProducts`, `getReturn`, `getReturns`, `getRoles`, `getSales`, `getSalesExport`, `getSettings`, `getSuppliers`, `getSystemConfig`, `getSystemDebugLog`, `getTransfers`, `getUnits`, `getUserAuthMethods`, `getUserProfile`, `getUsers`, `getVerificationCapabilities`, `importBackup`, `importBackupData`, `importBackupFolder`, `insertCustomRow`, `login`, `logout`, `lookupPortalMembership`, `openCSVDialog`, `openFolderDialog`, `openImageDialog`, `openPath`, `otpConfirm`, `otpDisable`, `otpSetup`, `otpStatus`, `otpVerify`, `pickBackupFile`, `requestPasswordResetEmail`, `resetData`, `resetDataPath`, `resetPassword`, `resetPasswordWithOtp`, `reviewPortalSubmission`, `saveGoogleDriveSyncPreferences`, `saveSettings`, `searchOrganizations`, `setDataPath`, `startGoogleDriveSyncOauth`, `startSupabaseOauth`, `syncGoogleDriveNow`, `testAiProvider`, `testSyncServer`, `transferStock`, `updateAiProvider`, `updateBranch`, `updateCategory`, `updateCustomField`, `updateCustomRow`, `updateCustomer`, `updateDeliveryContact`, `updateProduct`, `updateReturn`, `updateRole`, `updateSaleStatus`, `updateSupplier`, `updateUser`, `updateUserProfile`, `uploadFileAsset`, `uploadProductImage`, `uploadUserAvatar`
- Imports (4)
  - `../constants`
  - `../utils/deviceInfo.js`
  - `./http.js`
  - `./localDb.js`
- Internal dependencies (4)
  - `business-os-v3-centralized-server-template/frontend/src/api/http.js`
  - `business-os-v3-centralized-server-template/frontend/src/api/localDb.js`
  - `business-os-v3-centralized-server-template/frontend/src/constants.js`
  - `business-os-v3-centralized-server-template/frontend/src/utils/deviceInfo.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/web-api.js`

### 3.419 `business-os-v3-centralized-server-template/frontend/src/api/websocket.js`

- Declared exports: `connectWS`, `disconnectWS`, `isWSConnected`
- Imports (2)
  - `../constants.js`
  - `./http.js`
- Internal dependencies (2)
  - `business-os-v3-centralized-server-template/frontend/src/api/http.js`
  - `business-os-v3-centralized-server-template/frontend/src/constants.js`
- Referenced by (2)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/web-api.js`

### 3.420 `business-os-v3-centralized-server-template/frontend/src/App.jsx`

- Declared exports: `function`
- Imports (24)
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
  - `./components/shared/PageHelpButton`
  - `./components/users/Users`
  - `./components/utils-settings/AuditLog`
  - `./components/utils-settings/Backup`
  - `./components/utils-settings/Settings`
  - `./utils/favicon`
  - `react`
- Internal dependencies (23)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/app/appShellUtils.mjs`
  - `business-os-v3-centralized-server-template/frontend/src/components/auth/Login.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/branches/Branches.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/catalog/CatalogPage.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/Contacts.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/dashboard/Dashboard.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/files/FilesPage.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/inventory/Inventory.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/navigation/Sidebar.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/pos/POS.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/Products.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/ReceiptSettings.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/returns/Returns.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/sales/Sales.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/server/ServerPage.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/PageHelpButton.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/users/Users.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/AuditLog.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/Backup.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/Settings.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/utils/favicon.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/index.jsx`

### 3.421 `business-os-v3-centralized-server-template/frontend/src/app/appShellUtils.mjs`

- Declared exports: `MAX_MOUNTED_PAGES`, `getNotificationColor`, `getNotificationPrefix`, `isPublicCatalogPath`, `updateMountedPages`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v3-centralized-server-template/frontend/src/App.jsx`
  - `business-os-v3-centralized-server-template/frontend/tests/appShellUtils.test.mjs`

### 3.422 `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`

- Declared exports: `AppProvider`, `PAGE_PERMISSIONS`, `useApp`, `useSync`, `useT`
- Imports (8)
  - `./api/http.js`
  - `./api/websocket.js`
  - `./constants`
  - `./lang/en.json`
  - `./lang/km.json`
  - `./utils/deviceInfo.js`
  - `./web-api.js`
  - `react`
- Internal dependencies (7)
  - `business-os-v3-centralized-server-template/frontend/src/api/http.js`
  - `business-os-v3-centralized-server-template/frontend/src/api/websocket.js`
  - `business-os-v3-centralized-server-template/frontend/src/constants.js`
  - `business-os-v3-centralized-server-template/frontend/src/lang/en.json`
  - `business-os-v3-centralized-server-template/frontend/src/lang/km.json`
  - `business-os-v3-centralized-server-template/frontend/src/utils/deviceInfo.js`
  - `business-os-v3-centralized-server-template/frontend/src/web-api.js`
- Referenced by (44)
  - `business-os-v3-centralized-server-template/frontend/src/App.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/auth/Login.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/branches/Branches.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/branches/BranchForm.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/branches/TransferModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/catalog/CatalogPage.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/Contacts.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/CustomersTab.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/DeliveryTab.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/shared.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/SuppliersTab.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/custom-tables/CustomTables.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/NoData.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/dashboard/Dashboard.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/files/FilePickerModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/files/FilesPage.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/inventory/Inventory.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/navigation/Sidebar.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/pos/POS.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/BulkImportModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/ManageBrandsModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/ManageCategoriesModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/Products.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/VariantFormModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/AllFieldsPanel.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/ReceiptSettings.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/receipt/Receipt.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/returns/EditReturnModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/returns/NewReturnModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/returns/NewSupplierReturnModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/returns/ReturnDetailModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/returns/Returns.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/sales/Sales.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/server/ServerPage.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/PageHelpButton.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/users/UserProfileModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/users/Users.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/AuditLog.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/Backup.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/OtpModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/ResetData.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/Settings.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/index.jsx`

### 3.423 `business-os-v3-centralized-server-template/frontend/src/components/auth/Login.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `../../constants`
  - `../../utils/deviceInfo.js`
  - `react`
- Internal dependencies (3)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/constants.js`
  - `business-os-v3-centralized-server-template/frontend/src/utils/deviceInfo.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/App.jsx`

### 3.424 `business-os-v3-centralized-server-template/frontend/src/components/branches/Branches.jsx`

- Declared exports: `function`
- Imports (6)
  - `../../AppContext`
  - `../shared/Modal`
  - `./BranchForm`
  - `./TransferModal`
  - `lucide-react`
  - `react`
- Internal dependencies (4)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/branches/BranchForm.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/branches/TransferModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/App.jsx`

### 3.425 `business-os-v3-centralized-server-template/frontend/src/components/branches/BranchForm.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/branches/Branches.jsx`

### 3.426 `business-os-v3-centralized-server-template/frontend/src/components/branches/TransferModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/branches/Branches.jsx`

### 3.427 `business-os-v3-centralized-server-template/frontend/src/components/catalog/CatalogPage.jsx`

- Declared exports: `function`
- Imports (6)
  - `../../AppContext`
  - `../../utils/favicon`
  - `../files/FilePickerModal`
  - `../products/primitives`
  - `../shared/ImageGalleryLightbox`
  - `react`
- Internal dependencies (5)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/files/FilePickerModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/primitives.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/ImageGalleryLightbox.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/utils/favicon.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/App.jsx`

### 3.428 `business-os-v3-centralized-server-template/frontend/src/components/catalog/portalEditorUtils.mjs`

- Declared exports: `createAboutBlock`, `extractGoogleMapsEmbedUrl`, `moveListItem`, `normalizeAboutBlocks`, `normalizeGoogleMapsEmbed`, `serializeAboutBlocks`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.429 `business-os-v3-centralized-server-template/frontend/src/components/contacts/Contacts.jsx`

- Declared exports: `function`
- Imports (9)
  - `../../AppContext`
  - `../../utils/csv`
  - `../shared/Modal`
  - `./CustomersTab`
  - `./DeliveryTab`
  - `./SuppliersTab`
  - `./shared`
  - `lucide-react`
  - `react`
- Internal dependencies (7)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/CustomersTab.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/DeliveryTab.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/SuppliersTab.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/shared.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/Modal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/utils/csv.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/App.jsx`

### 3.430 `business-os-v3-centralized-server-template/frontend/src/components/contacts/CustomersTab.jsx`

- Declared exports: `parseContactOptions`, `serializeContactOptions`
- Imports (7)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `../shared/Modal`
  - `./shared`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/shared.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/Modal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/utils/csv.js`
  - `business-os-v3-centralized-server-template/frontend/src/utils/formatters.js`
- Referenced by (2)
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/Contacts.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/pos/POS.jsx`

### 3.431 `business-os-v3-centralized-server-template/frontend/src/components/contacts/DeliveryTab.jsx`

- Declared exports: `parseDeliveryOptions`, `serializeDeliveryOptions`
- Imports (7)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `../shared/Modal`
  - `./shared`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/shared.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/Modal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/utils/csv.js`
  - `business-os-v3-centralized-server-template/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/Contacts.jsx`

### 3.432 `business-os-v3-centralized-server-template/frontend/src/components/contacts/shared.jsx`

- Declared exports: `ContactTable`, `DetailModal`, `ImportModal`, `ThreeDotMenu`, `useContactSelection`
- Imports (4)
  - `../../AppContext`
  - `../files/FilePickerModal`
  - `../shared/Modal`
  - `react`
- Internal dependencies (3)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/files/FilePickerModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/Modal.jsx`
- Referenced by (4)
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/Contacts.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/CustomersTab.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/DeliveryTab.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/SuppliersTab.jsx`

### 3.433 `business-os-v3-centralized-server-template/frontend/src/components/contacts/SuppliersTab.jsx`

- Declared exports: none detected
- Imports (7)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `../shared/Modal`
  - `./shared`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/shared.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/Modal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/utils/csv.js`
  - `business-os-v3-centralized-server-template/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/Contacts.jsx`

### 3.434 `business-os-v3-centralized-server-template/frontend/src/components/custom-tables/CustomTables.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
- Referenced by (0)
  - none

### 3.435 `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/BarChart.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../../utils/formatters`
  - `./NoData`
  - `react`
- Internal dependencies (2)
  - `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/NoData.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/utils/formatters.js`
- Referenced by (0)
  - none

### 3.436 `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/DonutChart.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../../utils/formatters`
  - `./NoData`
  - `react`
- Internal dependencies (2)
  - `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/NoData.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/utils/formatters.js`
- Referenced by (0)
  - none

### 3.437 `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/index.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/dashboard/Dashboard.jsx`

### 3.438 `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/LineChart.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../../utils/formatters`
  - `./NoData`
  - `react`
- Internal dependencies (2)
  - `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/NoData.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/utils/formatters.js`
- Referenced by (0)
  - none

### 3.439 `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/NoData.jsx`

- Declared exports: `function`
- Imports (1)
  - `../../../AppContext`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
- Referenced by (3)
  - `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/BarChart.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/DonutChart.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/LineChart.jsx`

### 3.440 `business-os-v3-centralized-server-template/frontend/src/components/dashboard/Dashboard.jsx`

- Declared exports: `function`
- Imports (9)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/dateHelpers`
  - `../../utils/formatters`
  - `../shared/PortalMenu`
  - `./MiniStat`
  - `./charts`
  - `lucide-react`
  - `react`
- Internal dependencies (7)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/dashboard/MiniStat.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/index.js`
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/PortalMenu.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/utils/csv.js`
  - `business-os-v3-centralized-server-template/frontend/src/utils/dateHelpers.js`
  - `business-os-v3-centralized-server-template/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/App.jsx`

### 3.441 `business-os-v3-centralized-server-template/frontend/src/components/dashboard/MiniStat.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/dashboard/Dashboard.jsx`

### 3.442 `business-os-v3-centralized-server-template/frontend/src/components/files/FilePickerModal.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `../shared/Modal`
  - `react`
- Internal dependencies (2)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/Modal.jsx`
- Referenced by (5)
  - `business-os-v3-centralized-server-template/frontend/src/components/catalog/CatalogPage.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/shared.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/BulkImportModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/ProductForm.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/users/UserProfileModal.jsx`

### 3.443 `business-os-v3-centralized-server-template/frontend/src/components/files/FilesPage.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/App.jsx`

### 3.444 `business-os-v3-centralized-server-template/frontend/src/components/inventory/DualMoney.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v3-centralized-server-template/frontend/src/components/inventory/Inventory.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/inventory/ProductDetailModal.jsx`

### 3.445 `business-os-v3-centralized-server-template/frontend/src/components/inventory/Inventory.jsx`

- Declared exports: `function`
- Imports (8)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `./DualMoney`
  - `./ProductDetailModal`
  - `./movementGroups`
  - `lucide-react`
  - `react`
- Internal dependencies (6)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/inventory/DualMoney.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/inventory/ProductDetailModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/inventory/movementGroups.js`
  - `business-os-v3-centralized-server-template/frontend/src/utils/csv.js`
  - `business-os-v3-centralized-server-template/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/App.jsx`

### 3.446 `business-os-v3-centralized-server-template/frontend/src/components/inventory/movementGroups.js`

- Declared exports: `buildMovementGroups`, `movementGroupHaystack`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/inventory/Inventory.jsx`

### 3.447 `business-os-v3-centralized-server-template/frontend/src/components/inventory/ProductDetailModal.jsx`

- Declared exports: `function`
- Imports (1)
  - `./DualMoney`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/inventory/DualMoney.jsx`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/inventory/Inventory.jsx`

### 3.448 `business-os-v3-centralized-server-template/frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `lucide-react`
  - `react`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/App.jsx`

### 3.449 `business-os-v3-centralized-server-template/frontend/src/components/navigation/Sidebar.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `../shared/navigationConfig`
  - `../users/UserProfileModal`
  - `react`
- Internal dependencies (3)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/navigationConfig.js`
  - `business-os-v3-centralized-server-template/frontend/src/components/users/UserProfileModal.jsx`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/App.jsx`

### 3.450 `business-os-v3-centralized-server-template/frontend/src/components/pos/CartItem.jsx`

- Declared exports: `function`
- Imports (1)
  - `./ProductImage`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/pos/ProductImage.jsx`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/pos/POS.jsx`

### 3.451 `business-os-v3-centralized-server-template/frontend/src/components/pos/FilterPanel.jsx`

- Declared exports: `function`
- Imports (1)
  - `lucide-react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/pos/POS.jsx`

### 3.452 `business-os-v3-centralized-server-template/frontend/src/components/pos/POS.jsx`

- Declared exports: `function`
- Imports (12)
  - `../../AppContext`
  - `../../utils/deviceInfo`
  - `../contacts/CustomersTab`
  - `../receipt/Receipt`
  - `../sales/StatusBadge`
  - `../shared/ImageGalleryLightbox`
  - `./CartItem`
  - `./FilterPanel`
  - `./ProductImage`
  - `./QuickAddModal`
  - `lucide-react`
  - `react`
- Internal dependencies (10)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/CustomersTab.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/pos/CartItem.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/pos/FilterPanel.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/pos/ProductImage.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/pos/QuickAddModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/receipt/Receipt.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/sales/StatusBadge.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/ImageGalleryLightbox.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/utils/deviceInfo.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/App.jsx`

### 3.453 `business-os-v3-centralized-server-template/frontend/src/components/pos/ProductImage.jsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v3-centralized-server-template/frontend/src/components/pos/CartItem.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/pos/POS.jsx`

### 3.454 `business-os-v3-centralized-server-template/frontend/src/components/pos/QuickAddModal.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/pos/POS.jsx`

### 3.455 `business-os-v3-centralized-server-template/frontend/src/components/products/BranchStockAdjuster.jsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/products/ProductForm.jsx`

### 3.456 `business-os-v3-centralized-server-template/frontend/src/components/products/BulkAddStockModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../shared/Modal`
  - `react`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/products/Products.jsx`

### 3.457 `business-os-v3-centralized-server-template/frontend/src/components/products/BulkImportModal.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `../files/FilePickerModal`
  - `../shared/Modal`
  - `react`
- Internal dependencies (3)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/files/FilePickerModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/products/Products.jsx`

### 3.458 `business-os-v3-centralized-server-template/frontend/src/components/products/HeaderActions.jsx`

- Declared exports: `function`
- Imports (2)
  - `../shared/PortalMenu`
  - `lucide-react`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/PortalMenu.jsx`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/products/Products.jsx`

### 3.459 `business-os-v3-centralized-server-template/frontend/src/components/products/ManageBrandsModal.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `../shared/Modal`
  - `react`
- Internal dependencies (2)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/products/Products.jsx`

### 3.460 `business-os-v3-centralized-server-template/frontend/src/components/products/ManageCategoriesModal.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `../shared/Modal`
  - `react`
- Internal dependencies (2)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/products/Products.jsx`

### 3.461 `business-os-v3-centralized-server-template/frontend/src/components/products/ManageFieldsModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../shared/Modal`
  - `react`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/products/Products.jsx`

### 3.462 `business-os-v3-centralized-server-template/frontend/src/components/products/ManageMenu.jsx`

- Declared exports: `function`
- Imports (1)
  - `../shared/PortalMenu`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/PortalMenu.jsx`
- Referenced by (0)
  - none

### 3.463 `business-os-v3-centralized-server-template/frontend/src/components/products/ManageUnitsModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../shared/Modal`
  - `react`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/products/Products.jsx`

### 3.464 `business-os-v3-centralized-server-template/frontend/src/components/products/primitives.jsx`

- Declared exports: none detected
- Imports (2)
  - `lucide-react`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `business-os-v3-centralized-server-template/frontend/src/components/catalog/CatalogPage.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/ProductDetailModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/ProductForm.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/Products.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/VariantFormModal.jsx`

### 3.465 `business-os-v3-centralized-server-template/frontend/src/components/products/ProductDetailModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `./primitives`
  - `lucide-react`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/products/primitives.jsx`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/products/Products.jsx`

### 3.466 `business-os-v3-centralized-server-template/frontend/src/components/products/ProductForm.jsx`

- Declared exports: `function`
- Imports (5)
  - `../files/FilePickerModal`
  - `../shared/Modal`
  - `./BranchStockAdjuster`
  - `./primitives`
  - `react`
- Internal dependencies (4)
  - `business-os-v3-centralized-server-template/frontend/src/components/files/FilePickerModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/BranchStockAdjuster.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/primitives.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/products/Products.jsx`

### 3.467 `business-os-v3-centralized-server-template/frontend/src/components/products/Products.jsx`

- Declared exports: `function`
- Imports (18)
  - `../../AppContext`
  - `../../utils/csv`
  - `../shared/ImageGalleryLightbox`
  - `../shared/Modal`
  - `../shared/PortalMenu`
  - `./BulkAddStockModal`
  - `./BulkImportModal`
  - `./HeaderActions`
  - `./ManageBrandsModal`
  - `./ManageCategoriesModal`
  - `./ManageFieldsModal`
  - `./ManageUnitsModal`
  - `./ProductDetailModal`
  - `./ProductForm`
  - `./VariantFormModal`
  - `./primitives`
  - `lucide-react`
  - `react`
- Internal dependencies (16)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/BulkAddStockModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/BulkImportModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/HeaderActions.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/ManageBrandsModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/ManageCategoriesModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/ManageFieldsModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/ManageUnitsModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/ProductDetailModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/ProductForm.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/VariantFormModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/primitives.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/ImageGalleryLightbox.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/Modal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/PortalMenu.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/utils/csv.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/App.jsx`

### 3.468 `business-os-v3-centralized-server-template/frontend/src/components/products/VariantFormModal.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `../shared/Modal`
  - `./primitives`
  - `react`
- Internal dependencies (3)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/primitives.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/products/Products.jsx`

### 3.469 `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/AllFieldsPanel.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `./constants`
  - `react`
- Internal dependencies (2)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/constants.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.470 `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/constants.js`

- Declared exports: `ALL_FIELD_ITEMS`, `DEFAULT_TEMPLATE`, `getFieldItems`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/AllFieldsPanel.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/ReceiptSettings.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/receipt/Receipt.jsx`

### 3.471 `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/ErrorBoundary.jsx`

- Declared exports: `class`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.472 `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/FieldOrderManager.jsx`

- Declared exports: `function`
- Imports (2)
  - `lucide-react`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.473 `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/PrintSettings.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../utils/printReceipt`
  - `lucide-react`
  - `react`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/frontend/src/utils/printReceipt.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.474 `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/ReceiptPreview.jsx`

- Declared exports: `function`
- Imports (2)
  - `../receipt/Receipt`
  - `react`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/receipt/Receipt.jsx`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.475 `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/ReceiptSettings.jsx`

- Declared exports: `function`
- Imports (9)
  - `../../AppContext`
  - `./AllFieldsPanel`
  - `./ErrorBoundary`
  - `./FieldOrderManager`
  - `./PrintSettings`
  - `./ReceiptPreview`
  - `./constants`
  - `lucide-react`
  - `react`
- Internal dependencies (7)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/AllFieldsPanel.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/ErrorBoundary.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/FieldOrderManager.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/PrintSettings.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/ReceiptPreview.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/constants.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/App.jsx`

### 3.476 `business-os-v3-centralized-server-template/frontend/src/components/receipt/Receipt.jsx`

- Declared exports: `function`, `parseTpl`
- Imports (6)
  - `../../AppContext`
  - `../../utils/printReceipt`
  - `../receipt-settings/constants`
  - `../sales/StatusBadge`
  - `lucide-react`
  - `react`
- Internal dependencies (4)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/constants.js`
  - `business-os-v3-centralized-server-template/frontend/src/components/sales/StatusBadge.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/utils/printReceipt.js`
- Referenced by (3)
  - `business-os-v3-centralized-server-template/frontend/src/components/pos/POS.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/ReceiptPreview.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/sales/Sales.jsx`

### 3.477 `business-os-v3-centralized-server-template/frontend/src/components/returns/EditReturnModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/returns/Returns.jsx`

### 3.478 `business-os-v3-centralized-server-template/frontend/src/components/returns/NewReturnModal.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `../../utils/formatters`
  - `react`
- Internal dependencies (2)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/returns/Returns.jsx`

### 3.479 `business-os-v3-centralized-server-template/frontend/src/components/returns/NewSupplierReturnModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/returns/Returns.jsx`

### 3.480 `business-os-v3-centralized-server-template/frontend/src/components/returns/ReturnDetailModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `../../utils/formatters`
- Internal dependencies (2)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/returns/Returns.jsx`

### 3.481 `business-os-v3-centralized-server-template/frontend/src/components/returns/Returns.jsx`

- Declared exports: `function`
- Imports (9)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `./EditReturnModal`
  - `./NewReturnModal`
  - `./NewSupplierReturnModal`
  - `./ReturnDetailModal`
  - `lucide-react`
  - `react`
- Internal dependencies (7)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/returns/EditReturnModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/returns/NewReturnModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/returns/NewSupplierReturnModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/returns/ReturnDetailModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/utils/csv.js`
  - `business-os-v3-centralized-server-template/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/App.jsx`

### 3.482 `business-os-v3-centralized-server-template/frontend/src/components/sales/ExportModal.jsx`

- Declared exports: `function`
- Imports (4)
  - `../shared/Modal`
  - `./StatusBadge`
  - `lucide-react`
  - `react`
- Internal dependencies (2)
  - `business-os-v3-centralized-server-template/frontend/src/components/sales/StatusBadge.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/sales/Sales.jsx`

### 3.483 `business-os-v3-centralized-server-template/frontend/src/components/sales/SaleDetailModal.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../utils/formatters`
  - `./StatusBadge`
  - `react`
- Internal dependencies (2)
  - `business-os-v3-centralized-server-template/frontend/src/components/sales/StatusBadge.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/sales/Sales.jsx`

### 3.484 `business-os-v3-centralized-server-template/frontend/src/components/sales/Sales.jsx`

- Declared exports: `function`
- Imports (9)
  - `../../AppContext`
  - `../../utils/deviceInfo`
  - `../../utils/formatters`
  - `../receipt/Receipt`
  - `./ExportModal`
  - `./SaleDetailModal`
  - `./StatusBadge`
  - `lucide-react`
  - `react`
- Internal dependencies (7)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/receipt/Receipt.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/sales/ExportModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/sales/SaleDetailModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/sales/StatusBadge.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/utils/deviceInfo.js`
  - `business-os-v3-centralized-server-template/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/App.jsx`

### 3.485 `business-os-v3-centralized-server-template/frontend/src/components/sales/StatusBadge.jsx`

- Declared exports: `ALL_STATUSES`, `STATUS_COLORS`, `STATUS_LABELS`, `function`, `getStatusLabel`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `business-os-v3-centralized-server-template/frontend/src/components/pos/POS.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/receipt/Receipt.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/sales/ExportModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/sales/SaleDetailModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/sales/Sales.jsx`

### 3.486 `business-os-v3-centralized-server-template/frontend/src/components/server/ServerPage.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/App.jsx`

### 3.487 `business-os-v3-centralized-server-template/frontend/src/components/shared/ImageGalleryLightbox.jsx`

- Declared exports: `function`
- Imports (2)
  - `lucide-react`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `business-os-v3-centralized-server-template/frontend/src/components/catalog/CatalogPage.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/pos/POS.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/Products.jsx`

### 3.488 `business-os-v3-centralized-server-template/frontend/src/components/shared/Modal.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (19)
  - `business-os-v3-centralized-server-template/frontend/src/components/branches/Branches.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/Contacts.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/CustomersTab.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/DeliveryTab.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/shared.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/SuppliersTab.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/files/FilePickerModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/BulkAddStockModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/BulkImportModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/ManageBrandsModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/ManageCategoriesModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/ManageFieldsModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/ManageUnitsModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/ProductForm.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/Products.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/VariantFormModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/sales/ExportModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/users/UserProfileModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/users/Users.jsx`

### 3.489 `business-os-v3-centralized-server-template/frontend/src/components/shared/navigationConfig.js`

- Declared exports: `DEFAULT_MOBILE_PINNED`, `NAV_ITEMS`, `orderNavItems`, `parseNavSetting`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v3-centralized-server-template/frontend/src/components/navigation/Sidebar.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/Settings.jsx`

### 3.490 `business-os-v3-centralized-server-template/frontend/src/components/shared/PageHelpButton.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `./pageHelpContent`
  - `lucide-react`
  - `react`
- Internal dependencies (2)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/pageHelpContent.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/App.jsx`

### 3.491 `business-os-v3-centralized-server-template/frontend/src/components/shared/pageHelpContent.js`

- Declared exports: `PAGE_HELP_CONTENT`, `getPageHelpContent`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/PageHelpButton.jsx`

### 3.492 `business-os-v3-centralized-server-template/frontend/src/components/shared/PortalMenu.jsx`

- Declared exports: `ThreeDotPortal`, `function`
- Imports (3)
  - `lucide-react`
  - `react`
  - `react-dom`
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `business-os-v3-centralized-server-template/frontend/src/components/dashboard/Dashboard.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/HeaderActions.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/ManageMenu.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/Products.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/users/Users.jsx`

### 3.493 `business-os-v3-centralized-server-template/frontend/src/components/users/PermissionEditor.jsx`

- Declared exports: `PERMISSION_DEFS`, `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v3-centralized-server-template/frontend/src/components/users/UserDetailSheet.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/users/Users.jsx`

### 3.494 `business-os-v3-centralized-server-template/frontend/src/components/users/UserDetailSheet.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../utils/formatters`
  - `./PermissionEditor`
- Internal dependencies (2)
  - `business-os-v3-centralized-server-template/frontend/src/components/users/PermissionEditor.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/users/Users.jsx`

### 3.495 `business-os-v3-centralized-server-template/frontend/src/components/users/UserProfileModal.jsx`

- Declared exports: `function`
- Imports (7)
  - `../../AppContext`
  - `../../constants`
  - `../files/FilePickerModal`
  - `../shared/Modal`
  - `../utils-settings/OtpModal`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/files/FilePickerModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/Modal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/OtpModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/constants.js`
- Referenced by (2)
  - `business-os-v3-centralized-server-template/frontend/src/components/navigation/Sidebar.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/users/Users.jsx`

### 3.496 `business-os-v3-centralized-server-template/frontend/src/components/users/Users.jsx`

- Declared exports: `function`
- Imports (9)
  - `../../AppContext`
  - `../../utils/formatters`
  - `../shared/Modal`
  - `../shared/PortalMenu`
  - `./PermissionEditor`
  - `./UserDetailSheet`
  - `./UserProfileModal`
  - `lucide-react`
  - `react`
- Internal dependencies (7)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/Modal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/PortalMenu.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/users/PermissionEditor.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/users/UserDetailSheet.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/users/UserProfileModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/utils/formatters.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/App.jsx`

### 3.497 `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/AuditLog.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `../../utils/csv`
  - `lucide-react`
  - `react`
- Internal dependencies (2)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/utils/csv.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/App.jsx`

### 3.498 `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/Backup.jsx`

- Declared exports: `function`
- Imports (6)
  - `../../AppContext`
  - `../../api/http`
  - `../../utils/appRefresh`
  - `./ResetData`
  - `lucide-react`
  - `react`
- Internal dependencies (4)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/api/http.js`
  - `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/ResetData.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/utils/appRefresh.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/App.jsx`

### 3.499 `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/FontFamilyPicker.jsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/Settings.jsx`

### 3.500 `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/index.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.501 `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/OtpModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
- Referenced by (2)
  - `business-os-v3-centralized-server-template/frontend/src/components/users/UserProfileModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/Settings.jsx`

### 3.502 `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/ResetData.jsx`

- Declared exports: none detected
- Imports (4)
  - `../../AppContext`
  - `../../utils/appRefresh`
  - `lucide-react`
  - `react`
- Internal dependencies (2)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/utils/appRefresh.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/Backup.jsx`

### 3.503 `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/Settings.jsx`

- Declared exports: `function`
- Imports (7)
  - `../../AppContext`
  - `../../utils/favicon`
  - `../shared/navigationConfig`
  - `./FontFamilyPicker`
  - `./OtpModal`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/shared/navigationConfig.js`
  - `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/FontFamilyPicker.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/OtpModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/utils/favicon.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/App.jsx`

### 3.504 `business-os-v3-centralized-server-template/frontend/src/constants.js`

- Declared exports: `CURRENCY`, `DELIVERY_FEE_PAYER`, `EMPTY_CUSTOMER`, `LAYOUT`, `PAYMENT_METHODS`, `STOCK`, `STORAGE_KEYS`, `SYNC`, `WRITE_CHANNELS`, `createEmptyOrder`, `formatDate`, `isNetworkError`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (7)
  - `business-os-v3-centralized-server-template/frontend/src/api/http.js`
  - `business-os-v3-centralized-server-template/frontend/src/api/methods.js`
  - `business-os-v3-centralized-server-template/frontend/src/api/websocket.js`
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/auth/Login.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/users/UserProfileModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/web-api.js`

### 3.505 `business-os-v3-centralized-server-template/frontend/src/index.jsx`

- Declared exports: none detected
- Imports (5)
  - `./App`
  - `./AppContext`
  - `./styles/main.css`
  - `react`
  - `react-dom/client`
- Internal dependencies (3)
  - `business-os-v3-centralized-server-template/frontend/src/App.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/styles/main.css`
- Referenced by (0)
  - none

### 3.506 `business-os-v3-centralized-server-template/frontend/src/utils/appRefresh.js`

- Declared exports: `refreshAppData`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/Backup.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/ResetData.jsx`

### 3.507 `business-os-v3-centralized-server-template/frontend/src/utils/csv.js`

- Declared exports: `downloadCSV`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (9)
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/Contacts.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/CustomersTab.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/DeliveryTab.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/SuppliersTab.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/dashboard/Dashboard.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/inventory/Inventory.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/products/Products.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/returns/Returns.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/AuditLog.jsx`

### 3.508 `business-os-v3-centralized-server-template/frontend/src/utils/dateHelpers.js`

- Declared exports: `offsetDate`, `todayStr`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/components/dashboard/Dashboard.jsx`

### 3.509 `business-os-v3-centralized-server-template/frontend/src/utils/deviceInfo.js`

- Declared exports: `getClientDeviceInfo`, `getClientMetaHeaders`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (6)
  - `business-os-v3-centralized-server-template/frontend/src/api/http.js`
  - `business-os-v3-centralized-server-template/frontend/src/api/methods.js`
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/auth/Login.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/pos/POS.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/sales/Sales.jsx`

### 3.510 `business-os-v3-centralized-server-template/frontend/src/utils/favicon.js`

- Declared exports: `createCircularFaviconDataUrl`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `business-os-v3-centralized-server-template/frontend/src/App.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/catalog/CatalogPage.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/Settings.jsx`

### 3.511 `business-os-v3-centralized-server-template/frontend/src/utils/firebasePhoneAuth.js`

- Declared exports: `cleanupFirebasePhoneVerification`, `confirmFirebasePhoneCode`, `requestFirebasePhoneCode`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.512 `business-os-v3-centralized-server-template/frontend/src/utils/formatters.js`

- Declared exports: `fmtCount`, `fmtDate`, `fmtShort`, `fmtTime`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (15)
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/CustomersTab.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/DeliveryTab.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/contacts/SuppliersTab.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/BarChart.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/DonutChart.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/LineChart.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/dashboard/Dashboard.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/inventory/Inventory.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/returns/NewReturnModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/returns/ReturnDetailModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/returns/Returns.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/sales/SaleDetailModal.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/sales/Sales.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/users/UserDetailSheet.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/users/Users.jsx`

### 3.513 `business-os-v3-centralized-server-template/frontend/src/utils/index.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.514 `business-os-v3-centralized-server-template/frontend/src/utils/printReceipt.js`

- Declared exports: `PRINT_DEFAULTS`, `createReceiptPdfBlob`, `downloadReceiptPdf`, `getPaperWidthMm`, `getPrintSettings`, `openReceiptPdf`, `printReceipt`, `savePrintSettings`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/PrintSettings.jsx`
  - `business-os-v3-centralized-server-template/frontend/src/components/receipt/Receipt.jsx`

### 3.515 `business-os-v3-centralized-server-template/frontend/src/web-api.js`

- Declared exports: none detected
- Imports (5)
  - `./api/http.js`
  - `./api/localDb.js`
  - `./api/methods.js`
  - `./api/websocket.js`
  - `./constants.js`
- Internal dependencies (5)
  - `business-os-v3-centralized-server-template/frontend/src/api/http.js`
  - `business-os-v3-centralized-server-template/frontend/src/api/localDb.js`
  - `business-os-v3-centralized-server-template/frontend/src/api/methods.js`
  - `business-os-v3-centralized-server-template/frontend/src/api/websocket.js`
  - `business-os-v3-centralized-server-template/frontend/src/constants.js`
- Referenced by (1)
  - `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`

### 3.516 `business-os-v3-centralized-server-template/frontend/tailwind.config.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.517 `business-os-v3-centralized-server-template/frontend/tests/appShellUtils.test.mjs`

- Declared exports: none detected
- Imports (2)
  - `../src/app/appShellUtils.mjs`
  - `node:assert/strict`
- Internal dependencies (1)
  - `business-os-v3-centralized-server-template/frontend/src/app/appShellUtils.mjs`
- Referenced by (0)
  - none

### 3.518 `business-os-v3-centralized-server-template/frontend/tests/portalEditorUtils.test.mjs`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.519 `business-os-v3-centralized-server-template/frontend/vite.config.mjs`

- Declared exports: `defineConfig`
- Imports (2)
  - `@vitejs/plugin-react`
  - `vite`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.520 `frontend/postcss.config.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.521 `frontend/src/api/http.js`

- Declared exports: `apiFetch`, `cacheClearAll`, `cacheGet`, `cacheGetStale`, `cacheInvalidate`, `cacheSet`, `clearCallLog`, `getAuthSessionToken`, `getCallLog`, `getSyncServerUrl`, `getSyncToken`, `isNetErr`, `isServerOnline`, `route`, `setAuthSessionToken`, `setSyncServerUrl`, `setSyncToken`, `startHealthCheck`
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

### 3.522 `frontend/src/api/localDb.js`

- Declared exports: `buildCSVTemplate`, `dexieDb`, `localGetSettings`, `localSaveSettings`, `parseCSV`
- Imports (1)
  - `dexie`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/api/methods.js`
  - `frontend/src/web-api.js`

### 3.523 `frontend/src/api/methods.js`

- Declared exports: `adjustStock`, `askPortalAi`, `attachSaleCustomer`, `browseDir`, `bulkImportCustomers`, `bulkImportDeliveryContacts`, `bulkImportProducts`, `bulkImportSuppliers`, `changeUserPassword`, `completePasswordReset`, `completeSupabaseOauth`, `createAiProvider`, `createBranch`, `createCategory`, `createCustomField`, `createCustomTable`, `createCustomer`, `createDeliveryContact`, `createPortalSubmission`, `createProduct`, `createProductVariant`, `createReturn`, `createRole`, `createSale`, `createSupplier`, `createSupplierReturn`, `createUnit`, `createUser`, `deleteAiProvider`, `deleteBranch`, `deleteCategory`, `deleteCustomField`, `deleteCustomRow`, `deleteCustomer`, `deleteDeliveryContact`, `deleteFileAsset`, `deleteProduct`, `deleteRole`, `deleteSupplier`, `deleteUnit`, `disconnectGoogleDriveSync`, `disconnectUserAuthProvider`, `downloadCustomerTemplate`, `downloadImportTemplate`, `downloadSupplierTemplate`, `exportBackup`, `exportBackupFolder`, `factoryReset`, `flushPendingSyncQueue`, `getAiProviders`, `getAiResponses`, `getAnalytics`, `getAuditLogs`, `getBranchStock`, `getBranches`, `getCatalogMeta`, `getCatalogProducts`, `getCategories`, `getCurrentOrganization`, `getCustomFields`, `getCustomTableData`, `getCustomTables`, `getCustomers`, `getDashboard`, `getDataPath`, `getDeliveryContacts`, `getFiles`, `getGoogleDriveSyncStatus`, `getImageDataUrl`, `getInventoryMovements`, `getInventorySummary`, `getOrganizationBootstrap`, `getPortalAiStatus`, `getPortalCatalogMeta`, `getPortalCatalogProducts`, `getPortalConfig`, `getPortalSubmissionsForReview`, `getProducts`, `getReturn`, `getReturns`, `getRoles`, `getSales`, `getSalesExport`, `getSettings`, `getSuppliers`, `getSystemConfig`, `getSystemDebugLog`, `getTransfers`, `getUnits`, `getUserAuthMethods`, `getUserProfile`, `getUsers`, `getVerificationCapabilities`, `importBackup`, `importBackupData`, `importBackupFolder`, `insertCustomRow`, `login`, `logout`, `lookupPortalMembership`, `openCSVDialog`, `openFolderDialog`, `openImageDialog`, `openPath`, `otpConfirm`, `otpDisable`, `otpSetup`, `otpStatus`, `otpVerify`, `pickBackupFile`, `requestPasswordResetEmail`, `resetData`, `resetDataPath`, `resetPassword`, `resetPasswordWithOtp`, `reviewPortalSubmission`, `saveGoogleDriveSyncPreferences`, `saveSettings`, `searchOrganizations`, `setDataPath`, `startGoogleDriveSyncOauth`, `startSupabaseOauth`, `syncGoogleDriveNow`, `testAiProvider`, `testSyncServer`, `transferStock`, `updateAiProvider`, `updateBranch`, `updateCategory`, `updateCustomField`, `updateCustomRow`, `updateCustomer`, `updateDeliveryContact`, `updateProduct`, `updateReturn`, `updateRole`, `updateSaleStatus`, `updateSupplier`, `updateUser`, `updateUserProfile`, `uploadFileAsset`, `uploadProductImage`, `uploadUserAvatar`
- Imports (4)
  - `../constants`
  - `../utils/deviceInfo.js`
  - `./http.js`
  - `./localDb.js`
- Internal dependencies (4)
  - `frontend/src/api/http.js`
  - `frontend/src/api/localDb.js`
  - `frontend/src/constants.js`
  - `frontend/src/utils/deviceInfo.js`
- Referenced by (1)
  - `frontend/src/web-api.js`

### 3.524 `frontend/src/api/websocket.js`

- Declared exports: `connectWS`, `disconnectWS`, `isWSConnected`
- Imports (2)
  - `../constants.js`
  - `./http.js`
- Internal dependencies (2)
  - `frontend/src/api/http.js`
  - `frontend/src/constants.js`
- Referenced by (2)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/web-api.js`

### 3.525 `frontend/src/App.jsx`

- Declared exports: `function`
- Imports (24)
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
  - `./components/shared/PageHelpButton`
  - `./components/users/Users`
  - `./components/utils-settings/AuditLog`
  - `./components/utils-settings/Backup`
  - `./components/utils-settings/Settings`
  - `./utils/favicon`
  - `react`
- Internal dependencies (23)
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
  - `frontend/src/components/shared/PageHelpButton.jsx`
  - `frontend/src/components/users/Users.jsx`
  - `frontend/src/components/utils-settings/AuditLog.jsx`
  - `frontend/src/components/utils-settings/Backup.jsx`
  - `frontend/src/components/utils-settings/Settings.jsx`
  - `frontend/src/utils/favicon.js`
- Referenced by (1)
  - `frontend/src/index.jsx`

### 3.526 `frontend/src/app/appShellUtils.mjs`

- Declared exports: `MAX_MOUNTED_PAGES`, `getNotificationColor`, `getNotificationPrefix`, `isPublicCatalogPath`, `updateMountedPages`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/App.jsx`
  - `frontend/tests/appShellUtils.test.mjs`

### 3.527 `frontend/src/AppContext.jsx`

- Declared exports: `AppProvider`, `PAGE_PERMISSIONS`, `useApp`, `useSync`, `useT`
- Imports (8)
  - `./api/http.js`
  - `./api/websocket.js`
  - `./constants`
  - `./lang/en.json`
  - `./lang/km.json`
  - `./utils/deviceInfo.js`
  - `./web-api.js`
  - `react`
- Internal dependencies (7)
  - `frontend/src/api/http.js`
  - `frontend/src/api/websocket.js`
  - `frontend/src/constants.js`
  - `frontend/src/lang/en.json`
  - `frontend/src/lang/km.json`
  - `frontend/src/utils/deviceInfo.js`
  - `frontend/src/web-api.js`
- Referenced by (44)
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
  - `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`
  - `frontend/src/components/navigation/Sidebar.jsx`
  - `frontend/src/components/pos/POS.jsx`
  - `frontend/src/components/products/BulkImportModal.jsx`
  - `frontend/src/components/products/ManageBrandsModal.jsx`
  - `frontend/src/components/products/ManageCategoriesModal.jsx`
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
  - `frontend/src/components/server/ServerPage.jsx`
  - `frontend/src/components/shared/PageHelpButton.jsx`
  - `frontend/src/components/users/UserProfileModal.jsx`
  - `frontend/src/components/users/Users.jsx`
  - `frontend/src/components/utils-settings/AuditLog.jsx`
  - `frontend/src/components/utils-settings/Backup.jsx`
  - `frontend/src/components/utils-settings/OtpModal.jsx`
  - `frontend/src/components/utils-settings/ResetData.jsx`
  - `frontend/src/components/utils-settings/Settings.jsx`
  - `frontend/src/index.jsx`

### 3.528 `frontend/src/components/auth/Login.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `../../constants`
  - `../../utils/deviceInfo.js`
  - `react`
- Internal dependencies (3)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/constants.js`
  - `frontend/src/utils/deviceInfo.js`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.529 `frontend/src/components/branches/Branches.jsx`

- Declared exports: `function`
- Imports (6)
  - `../../AppContext`
  - `../shared/Modal`
  - `./BranchForm`
  - `./TransferModal`
  - `lucide-react`
  - `react`
- Internal dependencies (4)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/branches/BranchForm.jsx`
  - `frontend/src/components/branches/TransferModal.jsx`
  - `frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.530 `frontend/src/components/branches/BranchForm.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (1)
  - `frontend/src/components/branches/Branches.jsx`

### 3.531 `frontend/src/components/branches/TransferModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (1)
  - `frontend/src/components/branches/Branches.jsx`

### 3.532 `frontend/src/components/catalog/CatalogPage.jsx`

- Declared exports: `function`
- Imports (6)
  - `../../AppContext`
  - `../../utils/favicon`
  - `../files/FilePickerModal`
  - `../products/primitives`
  - `../shared/ImageGalleryLightbox`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/files/FilePickerModal.jsx`
  - `frontend/src/components/products/primitives.jsx`
  - `frontend/src/components/shared/ImageGalleryLightbox.jsx`
  - `frontend/src/utils/favicon.js`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.533 `frontend/src/components/catalog/portalEditorUtils.mjs`

- Declared exports: `createAboutBlock`, `extractGoogleMapsEmbedUrl`, `moveListItem`, `normalizeAboutBlocks`, `normalizeGoogleMapsEmbed`, `serializeAboutBlocks`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.534 `frontend/src/components/contacts/Contacts.jsx`

- Declared exports: `function`
- Imports (9)
  - `../../AppContext`
  - `../../utils/csv`
  - `../shared/Modal`
  - `./CustomersTab`
  - `./DeliveryTab`
  - `./SuppliersTab`
  - `./shared`
  - `lucide-react`
  - `react`
- Internal dependencies (7)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`
  - `frontend/src/components/contacts/shared.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/utils/csv.js`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.535 `frontend/src/components/contacts/CustomersTab.jsx`

- Declared exports: `parseContactOptions`, `serializeContactOptions`
- Imports (7)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `../shared/Modal`
  - `./shared`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/contacts/shared.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/utils/csv.js`
  - `frontend/src/utils/formatters.js`
- Referenced by (2)
  - `frontend/src/components/contacts/Contacts.jsx`
  - `frontend/src/components/pos/POS.jsx`

### 3.536 `frontend/src/components/contacts/DeliveryTab.jsx`

- Declared exports: `parseDeliveryOptions`, `serializeDeliveryOptions`
- Imports (7)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `../shared/Modal`
  - `./shared`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/contacts/shared.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/utils/csv.js`
  - `frontend/src/utils/formatters.js`
- Referenced by (1)
  - `frontend/src/components/contacts/Contacts.jsx`

### 3.537 `frontend/src/components/contacts/shared.jsx`

- Declared exports: `ContactTable`, `DetailModal`, `ImportModal`, `ThreeDotMenu`, `useContactSelection`
- Imports (4)
  - `../../AppContext`
  - `../files/FilePickerModal`
  - `../shared/Modal`
  - `react`
- Internal dependencies (3)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/files/FilePickerModal.jsx`
  - `frontend/src/components/shared/Modal.jsx`
- Referenced by (4)
  - `frontend/src/components/contacts/Contacts.jsx`
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`

### 3.538 `frontend/src/components/contacts/SuppliersTab.jsx`

- Declared exports: none detected
- Imports (7)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `../shared/Modal`
  - `./shared`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/contacts/shared.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/utils/csv.js`
  - `frontend/src/utils/formatters.js`
- Referenced by (1)
  - `frontend/src/components/contacts/Contacts.jsx`

### 3.539 `frontend/src/components/custom-tables/CustomTables.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (0)
  - none

### 3.540 `frontend/src/components/dashboard/charts/BarChart.jsx`

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

### 3.541 `frontend/src/components/dashboard/charts/DonutChart.jsx`

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

### 3.542 `frontend/src/components/dashboard/charts/index.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/dashboard/Dashboard.jsx`

### 3.543 `frontend/src/components/dashboard/charts/LineChart.jsx`

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

### 3.544 `frontend/src/components/dashboard/charts/NoData.jsx`

- Declared exports: `function`
- Imports (1)
  - `../../../AppContext`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (3)
  - `frontend/src/components/dashboard/charts/BarChart.jsx`
  - `frontend/src/components/dashboard/charts/DonutChart.jsx`
  - `frontend/src/components/dashboard/charts/LineChart.jsx`

### 3.545 `frontend/src/components/dashboard/Dashboard.jsx`

- Declared exports: `function`
- Imports (9)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/dateHelpers`
  - `../../utils/formatters`
  - `../shared/PortalMenu`
  - `./MiniStat`
  - `./charts`
  - `lucide-react`
  - `react`
- Internal dependencies (7)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/dashboard/MiniStat.jsx`
  - `frontend/src/components/dashboard/charts/index.js`
  - `frontend/src/components/shared/PortalMenu.jsx`
  - `frontend/src/utils/csv.js`
  - `frontend/src/utils/dateHelpers.js`
  - `frontend/src/utils/formatters.js`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.546 `frontend/src/components/dashboard/MiniStat.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/dashboard/Dashboard.jsx`

### 3.547 `frontend/src/components/files/FilePickerModal.jsx`

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

### 3.548 `frontend/src/components/files/FilesPage.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.549 `frontend/src/components/inventory/DualMoney.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/inventory/ProductDetailModal.jsx`

### 3.550 `frontend/src/components/inventory/Inventory.jsx`

- Declared exports: `function`
- Imports (8)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `./DualMoney`
  - `./ProductDetailModal`
  - `./movementGroups`
  - `lucide-react`
  - `react`
- Internal dependencies (6)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/inventory/DualMoney.jsx`
  - `frontend/src/components/inventory/ProductDetailModal.jsx`
  - `frontend/src/components/inventory/movementGroups.js`
  - `frontend/src/utils/csv.js`
  - `frontend/src/utils/formatters.js`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.551 `frontend/src/components/inventory/movementGroups.js`

- Declared exports: `buildMovementGroups`, `movementGroupHaystack`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/inventory/Inventory.jsx`

### 3.552 `frontend/src/components/inventory/ProductDetailModal.jsx`

- Declared exports: `function`
- Imports (1)
  - `./DualMoney`
- Internal dependencies (1)
  - `frontend/src/components/inventory/DualMoney.jsx`
- Referenced by (1)
  - `frontend/src/components/inventory/Inventory.jsx`

### 3.553 `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `lucide-react`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.554 `frontend/src/components/navigation/Sidebar.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `../shared/navigationConfig`
  - `../users/UserProfileModal`
  - `react`
- Internal dependencies (3)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/navigationConfig.js`
  - `frontend/src/components/users/UserProfileModal.jsx`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.555 `frontend/src/components/pos/CartItem.jsx`

- Declared exports: `function`
- Imports (1)
  - `./ProductImage`
- Internal dependencies (1)
  - `frontend/src/components/pos/ProductImage.jsx`
- Referenced by (1)
  - `frontend/src/components/pos/POS.jsx`

### 3.556 `frontend/src/components/pos/FilterPanel.jsx`

- Declared exports: `function`
- Imports (1)
  - `lucide-react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/pos/POS.jsx`

### 3.557 `frontend/src/components/pos/POS.jsx`

- Declared exports: `function`
- Imports (12)
  - `../../AppContext`
  - `../../utils/deviceInfo`
  - `../contacts/CustomersTab`
  - `../receipt/Receipt`
  - `../sales/StatusBadge`
  - `../shared/ImageGalleryLightbox`
  - `./CartItem`
  - `./FilterPanel`
  - `./ProductImage`
  - `./QuickAddModal`
  - `lucide-react`
  - `react`
- Internal dependencies (10)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/pos/CartItem.jsx`
  - `frontend/src/components/pos/FilterPanel.jsx`
  - `frontend/src/components/pos/ProductImage.jsx`
  - `frontend/src/components/pos/QuickAddModal.jsx`
  - `frontend/src/components/receipt/Receipt.jsx`
  - `frontend/src/components/sales/StatusBadge.jsx`
  - `frontend/src/components/shared/ImageGalleryLightbox.jsx`
  - `frontend/src/utils/deviceInfo.js`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.558 `frontend/src/components/pos/ProductImage.jsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/pos/CartItem.jsx`
  - `frontend/src/components/pos/POS.jsx`

### 3.559 `frontend/src/components/pos/QuickAddModal.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/pos/POS.jsx`

### 3.560 `frontend/src/components/products/BranchStockAdjuster.jsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/products/ProductForm.jsx`

### 3.561 `frontend/src/components/products/BulkAddStockModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../shared/Modal`
  - `react`
- Internal dependencies (1)
  - `frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.562 `frontend/src/components/products/BulkImportModal.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `../files/FilePickerModal`
  - `../shared/Modal`
  - `react`
- Internal dependencies (3)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/files/FilePickerModal.jsx`
  - `frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.563 `frontend/src/components/products/HeaderActions.jsx`

- Declared exports: `function`
- Imports (2)
  - `../shared/PortalMenu`
  - `lucide-react`
- Internal dependencies (1)
  - `frontend/src/components/shared/PortalMenu.jsx`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.564 `frontend/src/components/products/ManageBrandsModal.jsx`

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

### 3.565 `frontend/src/components/products/ManageCategoriesModal.jsx`

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

### 3.566 `frontend/src/components/products/ManageFieldsModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../shared/Modal`
  - `react`
- Internal dependencies (1)
  - `frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.567 `frontend/src/components/products/ManageMenu.jsx`

- Declared exports: `function`
- Imports (1)
  - `../shared/PortalMenu`
- Internal dependencies (1)
  - `frontend/src/components/shared/PortalMenu.jsx`
- Referenced by (0)
  - none

### 3.568 `frontend/src/components/products/ManageUnitsModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../shared/Modal`
  - `react`
- Internal dependencies (1)
  - `frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.569 `frontend/src/components/products/primitives.jsx`

- Declared exports: none detected
- Imports (2)
  - `lucide-react`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `frontend/src/components/catalog/CatalogPage.jsx`
  - `frontend/src/components/products/ProductDetailModal.jsx`
  - `frontend/src/components/products/ProductForm.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/products/VariantFormModal.jsx`

### 3.570 `frontend/src/components/products/ProductDetailModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `./primitives`
  - `lucide-react`
- Internal dependencies (1)
  - `frontend/src/components/products/primitives.jsx`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.571 `frontend/src/components/products/ProductForm.jsx`

- Declared exports: `function`
- Imports (5)
  - `../files/FilePickerModal`
  - `../shared/Modal`
  - `./BranchStockAdjuster`
  - `./primitives`
  - `react`
- Internal dependencies (4)
  - `frontend/src/components/files/FilePickerModal.jsx`
  - `frontend/src/components/products/BranchStockAdjuster.jsx`
  - `frontend/src/components/products/primitives.jsx`
  - `frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.572 `frontend/src/components/products/Products.jsx`

- Declared exports: `function`
- Imports (18)
  - `../../AppContext`
  - `../../utils/csv`
  - `../shared/ImageGalleryLightbox`
  - `../shared/Modal`
  - `../shared/PortalMenu`
  - `./BulkAddStockModal`
  - `./BulkImportModal`
  - `./HeaderActions`
  - `./ManageBrandsModal`
  - `./ManageCategoriesModal`
  - `./ManageFieldsModal`
  - `./ManageUnitsModal`
  - `./ProductDetailModal`
  - `./ProductForm`
  - `./VariantFormModal`
  - `./primitives`
  - `lucide-react`
  - `react`
- Internal dependencies (16)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/products/BulkAddStockModal.jsx`
  - `frontend/src/components/products/BulkImportModal.jsx`
  - `frontend/src/components/products/HeaderActions.jsx`
  - `frontend/src/components/products/ManageBrandsModal.jsx`
  - `frontend/src/components/products/ManageCategoriesModal.jsx`
  - `frontend/src/components/products/ManageFieldsModal.jsx`
  - `frontend/src/components/products/ManageUnitsModal.jsx`
  - `frontend/src/components/products/ProductDetailModal.jsx`
  - `frontend/src/components/products/ProductForm.jsx`
  - `frontend/src/components/products/VariantFormModal.jsx`
  - `frontend/src/components/products/primitives.jsx`
  - `frontend/src/components/shared/ImageGalleryLightbox.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/components/shared/PortalMenu.jsx`
  - `frontend/src/utils/csv.js`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.573 `frontend/src/components/products/VariantFormModal.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `../shared/Modal`
  - `./primitives`
  - `react`
- Internal dependencies (3)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/products/primitives.jsx`
  - `frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.574 `frontend/src/components/receipt-settings/AllFieldsPanel.jsx`

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

### 3.575 `frontend/src/components/receipt-settings/constants.js`

- Declared exports: `ALL_FIELD_ITEMS`, `DEFAULT_TEMPLATE`, `getFieldItems`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `frontend/src/components/receipt-settings/AllFieldsPanel.jsx`
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`
  - `frontend/src/components/receipt/Receipt.jsx`

### 3.576 `frontend/src/components/receipt-settings/ErrorBoundary.jsx`

- Declared exports: `class`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.577 `frontend/src/components/receipt-settings/FieldOrderManager.jsx`

- Declared exports: `function`
- Imports (2)
  - `lucide-react`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.578 `frontend/src/components/receipt-settings/PrintSettings.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../utils/printReceipt`
  - `lucide-react`
  - `react`
- Internal dependencies (1)
  - `frontend/src/utils/printReceipt.js`
- Referenced by (1)
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.579 `frontend/src/components/receipt-settings/ReceiptPreview.jsx`

- Declared exports: `function`
- Imports (2)
  - `../receipt/Receipt`
  - `react`
- Internal dependencies (1)
  - `frontend/src/components/receipt/Receipt.jsx`
- Referenced by (1)
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.580 `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

- Declared exports: `function`
- Imports (9)
  - `../../AppContext`
  - `./AllFieldsPanel`
  - `./ErrorBoundary`
  - `./FieldOrderManager`
  - `./PrintSettings`
  - `./ReceiptPreview`
  - `./constants`
  - `lucide-react`
  - `react`
- Internal dependencies (7)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/receipt-settings/AllFieldsPanel.jsx`
  - `frontend/src/components/receipt-settings/ErrorBoundary.jsx`
  - `frontend/src/components/receipt-settings/FieldOrderManager.jsx`
  - `frontend/src/components/receipt-settings/PrintSettings.jsx`
  - `frontend/src/components/receipt-settings/ReceiptPreview.jsx`
  - `frontend/src/components/receipt-settings/constants.js`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.581 `frontend/src/components/receipt/Receipt.jsx`

- Declared exports: `function`, `parseTpl`
- Imports (6)
  - `../../AppContext`
  - `../../utils/printReceipt`
  - `../receipt-settings/constants`
  - `../sales/StatusBadge`
  - `lucide-react`
  - `react`
- Internal dependencies (4)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/receipt-settings/constants.js`
  - `frontend/src/components/sales/StatusBadge.jsx`
  - `frontend/src/utils/printReceipt.js`
- Referenced by (3)
  - `frontend/src/components/pos/POS.jsx`
  - `frontend/src/components/receipt-settings/ReceiptPreview.jsx`
  - `frontend/src/components/sales/Sales.jsx`

### 3.582 `frontend/src/components/returns/EditReturnModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (1)
  - `frontend/src/components/returns/Returns.jsx`

### 3.583 `frontend/src/components/returns/NewReturnModal.jsx`

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

### 3.584 `frontend/src/components/returns/NewSupplierReturnModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (1)
  - `frontend/src/components/returns/Returns.jsx`

### 3.585 `frontend/src/components/returns/ReturnDetailModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `../../utils/formatters`
- Internal dependencies (2)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/utils/formatters.js`
- Referenced by (1)
  - `frontend/src/components/returns/Returns.jsx`

### 3.586 `frontend/src/components/returns/Returns.jsx`

- Declared exports: `function`
- Imports (9)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `./EditReturnModal`
  - `./NewReturnModal`
  - `./NewSupplierReturnModal`
  - `./ReturnDetailModal`
  - `lucide-react`
  - `react`
- Internal dependencies (7)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/returns/EditReturnModal.jsx`
  - `frontend/src/components/returns/NewReturnModal.jsx`
  - `frontend/src/components/returns/NewSupplierReturnModal.jsx`
  - `frontend/src/components/returns/ReturnDetailModal.jsx`
  - `frontend/src/utils/csv.js`
  - `frontend/src/utils/formatters.js`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.587 `frontend/src/components/sales/ExportModal.jsx`

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

### 3.588 `frontend/src/components/sales/SaleDetailModal.jsx`

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

### 3.589 `frontend/src/components/sales/Sales.jsx`

- Declared exports: `function`
- Imports (9)
  - `../../AppContext`
  - `../../utils/deviceInfo`
  - `../../utils/formatters`
  - `../receipt/Receipt`
  - `./ExportModal`
  - `./SaleDetailModal`
  - `./StatusBadge`
  - `lucide-react`
  - `react`
- Internal dependencies (7)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/receipt/Receipt.jsx`
  - `frontend/src/components/sales/ExportModal.jsx`
  - `frontend/src/components/sales/SaleDetailModal.jsx`
  - `frontend/src/components/sales/StatusBadge.jsx`
  - `frontend/src/utils/deviceInfo.js`
  - `frontend/src/utils/formatters.js`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.590 `frontend/src/components/sales/StatusBadge.jsx`

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

### 3.591 `frontend/src/components/server/ServerPage.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.592 `frontend/src/components/shared/ImageGalleryLightbox.jsx`

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

### 3.593 `frontend/src/components/shared/Modal.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (19)
  - `frontend/src/components/branches/Branches.jsx`
  - `frontend/src/components/contacts/Contacts.jsx`
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/shared.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`
  - `frontend/src/components/files/FilePickerModal.jsx`
  - `frontend/src/components/products/BulkAddStockModal.jsx`
  - `frontend/src/components/products/BulkImportModal.jsx`
  - `frontend/src/components/products/ManageBrandsModal.jsx`
  - `frontend/src/components/products/ManageCategoriesModal.jsx`
  - `frontend/src/components/products/ManageFieldsModal.jsx`
  - `frontend/src/components/products/ManageUnitsModal.jsx`
  - `frontend/src/components/products/ProductForm.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/products/VariantFormModal.jsx`
  - `frontend/src/components/sales/ExportModal.jsx`
  - `frontend/src/components/users/UserProfileModal.jsx`
  - `frontend/src/components/users/Users.jsx`

### 3.594 `frontend/src/components/shared/navigationConfig.js`

- Declared exports: `DEFAULT_MOBILE_PINNED`, `NAV_ITEMS`, `orderNavItems`, `parseNavSetting`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/navigation/Sidebar.jsx`
  - `frontend/src/components/utils-settings/Settings.jsx`

### 3.595 `frontend/src/components/shared/PageHelpButton.jsx`

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

### 3.596 `frontend/src/components/shared/pageHelpContent.js`

- Declared exports: `PAGE_HELP_CONTENT`, `getPageHelpContent`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/shared/PageHelpButton.jsx`

### 3.597 `frontend/src/components/shared/PortalMenu.jsx`

- Declared exports: `ThreeDotPortal`, `function`
- Imports (3)
  - `lucide-react`
  - `react`
  - `react-dom`
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `frontend/src/components/dashboard/Dashboard.jsx`
  - `frontend/src/components/products/HeaderActions.jsx`
  - `frontend/src/components/products/ManageMenu.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/users/Users.jsx`

### 3.598 `frontend/src/components/users/PermissionEditor.jsx`

- Declared exports: `PERMISSION_DEFS`, `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/users/UserDetailSheet.jsx`
  - `frontend/src/components/users/Users.jsx`

### 3.599 `frontend/src/components/users/UserDetailSheet.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../utils/formatters`
  - `./PermissionEditor`
- Internal dependencies (2)
  - `frontend/src/components/users/PermissionEditor.jsx`
  - `frontend/src/utils/formatters.js`
- Referenced by (1)
  - `frontend/src/components/users/Users.jsx`

### 3.600 `frontend/src/components/users/UserProfileModal.jsx`

- Declared exports: `function`
- Imports (7)
  - `../../AppContext`
  - `../../constants`
  - `../files/FilePickerModal`
  - `../shared/Modal`
  - `../utils-settings/OtpModal`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/files/FilePickerModal.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/components/utils-settings/OtpModal.jsx`
  - `frontend/src/constants.js`
- Referenced by (2)
  - `frontend/src/components/navigation/Sidebar.jsx`
  - `frontend/src/components/users/Users.jsx`

### 3.601 `frontend/src/components/users/Users.jsx`

- Declared exports: `function`
- Imports (9)
  - `../../AppContext`
  - `../../utils/formatters`
  - `../shared/Modal`
  - `../shared/PortalMenu`
  - `./PermissionEditor`
  - `./UserDetailSheet`
  - `./UserProfileModal`
  - `lucide-react`
  - `react`
- Internal dependencies (7)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/components/shared/PortalMenu.jsx`
  - `frontend/src/components/users/PermissionEditor.jsx`
  - `frontend/src/components/users/UserDetailSheet.jsx`
  - `frontend/src/components/users/UserProfileModal.jsx`
  - `frontend/src/utils/formatters.js`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.602 `frontend/src/components/utils-settings/AuditLog.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `../../utils/csv`
  - `lucide-react`
  - `react`
- Internal dependencies (2)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/utils/csv.js`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.603 `frontend/src/components/utils-settings/Backup.jsx`

- Declared exports: `function`
- Imports (6)
  - `../../AppContext`
  - `../../api/http`
  - `../../utils/appRefresh`
  - `./ResetData`
  - `lucide-react`
  - `react`
- Internal dependencies (4)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/api/http.js`
  - `frontend/src/components/utils-settings/ResetData.jsx`
  - `frontend/src/utils/appRefresh.js`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.604 `frontend/src/components/utils-settings/FontFamilyPicker.jsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/utils-settings/Settings.jsx`

### 3.605 `frontend/src/components/utils-settings/index.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.606 `frontend/src/components/utils-settings/OtpModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (2)
  - `frontend/src/components/users/UserProfileModal.jsx`
  - `frontend/src/components/utils-settings/Settings.jsx`

### 3.607 `frontend/src/components/utils-settings/ResetData.jsx`

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

### 3.608 `frontend/src/components/utils-settings/Settings.jsx`

- Declared exports: `function`
- Imports (7)
  - `../../AppContext`
  - `../../utils/favicon`
  - `../shared/navigationConfig`
  - `./FontFamilyPicker`
  - `./OtpModal`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/navigationConfig.js`
  - `frontend/src/components/utils-settings/FontFamilyPicker.jsx`
  - `frontend/src/components/utils-settings/OtpModal.jsx`
  - `frontend/src/utils/favicon.js`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.609 `frontend/src/constants.js`

- Declared exports: `CURRENCY`, `DELIVERY_FEE_PAYER`, `EMPTY_CUSTOMER`, `LAYOUT`, `PAYMENT_METHODS`, `STOCK`, `STORAGE_KEYS`, `SYNC`, `WRITE_CHANNELS`, `createEmptyOrder`, `formatDate`, `isNetworkError`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (7)
  - `frontend/src/api/http.js`
  - `frontend/src/api/methods.js`
  - `frontend/src/api/websocket.js`
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/auth/Login.jsx`
  - `frontend/src/components/users/UserProfileModal.jsx`
  - `frontend/src/web-api.js`

### 3.610 `frontend/src/index.jsx`

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

### 3.611 `frontend/src/utils/appRefresh.js`

- Declared exports: `refreshAppData`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/utils-settings/Backup.jsx`
  - `frontend/src/components/utils-settings/ResetData.jsx`

### 3.612 `frontend/src/utils/csv.js`

- Declared exports: `downloadCSV`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (9)
  - `frontend/src/components/contacts/Contacts.jsx`
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`
  - `frontend/src/components/dashboard/Dashboard.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/returns/Returns.jsx`
  - `frontend/src/components/utils-settings/AuditLog.jsx`

### 3.613 `frontend/src/utils/dateHelpers.js`

- Declared exports: `offsetDate`, `todayStr`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/dashboard/Dashboard.jsx`

### 3.614 `frontend/src/utils/deviceInfo.js`

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

### 3.615 `frontend/src/utils/favicon.js`

- Declared exports: `createCircularFaviconDataUrl`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `frontend/src/App.jsx`
  - `frontend/src/components/catalog/CatalogPage.jsx`
  - `frontend/src/components/utils-settings/Settings.jsx`

### 3.616 `frontend/src/utils/firebasePhoneAuth.js`

- Declared exports: `cleanupFirebasePhoneVerification`, `confirmFirebasePhoneCode`, `requestFirebasePhoneCode`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.617 `frontend/src/utils/formatters.js`

- Declared exports: `fmtCount`, `fmtDate`, `fmtShort`, `fmtTime`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (15)
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

### 3.618 `frontend/src/utils/index.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.619 `frontend/src/utils/printReceipt.js`

- Declared exports: `PRINT_DEFAULTS`, `createReceiptPdfBlob`, `downloadReceiptPdf`, `getPaperWidthMm`, `getPrintSettings`, `openReceiptPdf`, `printReceipt`, `savePrintSettings`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/receipt-settings/PrintSettings.jsx`
  - `frontend/src/components/receipt/Receipt.jsx`

### 3.620 `frontend/src/web-api.js`

- Declared exports: none detected
- Imports (5)
  - `./api/http.js`
  - `./api/localDb.js`
  - `./api/methods.js`
  - `./api/websocket.js`
  - `./constants.js`
- Internal dependencies (5)
  - `frontend/src/api/http.js`
  - `frontend/src/api/localDb.js`
  - `frontend/src/api/methods.js`
  - `frontend/src/api/websocket.js`
  - `frontend/src/constants.js`
- Referenced by (1)
  - `frontend/src/AppContext.jsx`

### 3.621 `frontend/tailwind.config.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.622 `frontend/tests/appShellUtils.test.mjs`

- Declared exports: none detected
- Imports (2)
  - `../src/app/appShellUtils.mjs`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/app/appShellUtils.mjs`
- Referenced by (0)
  - none

### 3.623 `frontend/tests/portalEditorUtils.test.mjs`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.624 `frontend/vite.config.mjs`

- Declared exports: `defineConfig`
- Imports (2)
  - `@vitejs/plugin-react`
  - `vite`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.625 `ops/scripts/backend/verify-data-integrity.js`

- Declared exports: none detected
- Imports (4)
  - `../../../backend/src/config`
  - `../../../backend/src/database`
  - `../../../backend/src/helpers`
  - `path`
- Internal dependencies (3)
  - `backend/src/config.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
- Referenced by (0)
  - none

### 3.626 `ops/scripts/frontend/verify-i18n.js`

- Declared exports: none detected
- Imports (2)
  - `../lib/fs-utils`
  - `path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.js`
- Referenced by (0)
  - none

### 3.627 `ops/scripts/generate-doc-reference.js`

- Declared exports: none detected
- Imports (3)
  - `./lib/fs-utils`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.js`
- Referenced by (0)
  - none

### 3.628 `ops/scripts/generate-full-project-docs.js`

- Declared exports: `push`
- Imports (3)
  - `./lib/fs-utils`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.js`
- Referenced by (0)
  - none

### 3.629 `ops/scripts/lib/fs-utils.js`

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

### 3.630 `ops/scripts/performance-scan.js`

- Declared exports: none detected
- Imports (3)
  - `./lib/fs-utils`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.js`
- Referenced by (0)
  - none

