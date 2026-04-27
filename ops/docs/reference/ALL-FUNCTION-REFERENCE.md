# All Function Reference (Project First-Party Code)

Auto-generated function/class symbol commentary for all first-party code files (frontend, backend, root scripts/config code).

## 1. Coverage Summary

Code files scanned: **630**

## 2. Symbol Count by File

| No. | File | Symbols |
|---:|---|---:|
| 1 | `backend/server.js` | 14 |
| 2 | `backend/src/accessControl.js` | 16 |
| 3 | `backend/src/backupSchema.js` | 3 |
| 4 | `backend/src/config.js` | 5 |
| 5 | `backend/src/database.js` | 8 |
| 6 | `backend/src/dataPath.js` | 9 |
| 7 | `backend/src/fileAssets.js` | 22 |
| 8 | `backend/src/helpers.js` | 17 |
| 9 | `backend/src/middleware.js` | 14 |
| 10 | `backend/src/netSecurity.js` | 7 |
| 11 | `backend/src/organizationContext.js` | 12 |
| 12 | `backend/src/portalUtils.js` | 6 |
| 13 | `backend/src/requestContext.js` | 5 |
| 14 | `backend/src/routes/ai.js` | 3 |
| 15 | `backend/src/routes/auth.js` | 17 |
| 16 | `backend/src/routes/branches.js` | 1 |
| 17 | `backend/src/routes/catalog.js` | 0 |
| 18 | `backend/src/routes/categories.js` | 0 |
| 19 | `backend/src/routes/contacts.js` | 9 |
| 20 | `backend/src/routes/customTables.js` | 2 |
| 21 | `backend/src/routes/files.js` | 2 |
| 22 | `backend/src/routes/inventory.js` | 1 |
| 23 | `backend/src/routes/organizations.js` | 0 |
| 24 | `backend/src/routes/portal.js` | 21 |
| 25 | `backend/src/routes/products.js` | 17 |
| 26 | `backend/src/routes/returns.js` | 4 |
| 27 | `backend/src/routes/sales.js` | 12 |
| 28 | `backend/src/routes/settings.js` | 0 |
| 29 | `backend/src/routes/system.js` | 27 |
| 30 | `backend/src/routes/units.js` | 0 |
| 31 | `backend/src/routes/users.js` | 19 |
| 32 | `backend/src/security.js` | 13 |
| 33 | `backend/src/serverUtils.js` | 12 |
| 34 | `backend/src/services/aiGateway.js` | 12 |
| 35 | `backend/src/services/firebaseAuth.js` | 22 |
| 36 | `backend/src/services/googleDriveSync.js` | 46 |
| 37 | `backend/src/services/portalAi.js` | 29 |
| 38 | `backend/src/services/supabaseAuth.js` | 37 |
| 39 | `backend/src/services/verification.js` | 21 |
| 40 | `backend/src/sessionAuth.js` | 6 |
| 41 | `backend/src/systemFsWorker.js` | 7 |
| 42 | `backend/src/uploadSecurity.js` | 7 |
| 43 | `backend/src/websocket.js` | 1 |
| 44 | `backend/test/accessControl.test.js` | 2 |
| 45 | `backend/test/backupRoundtrip.test.js` | 12 |
| 46 | `backend/test/backupSchema.test.js` | 1 |
| 47 | `backend/test/dataPath.test.js` | 2 |
| 48 | `backend/test/netSecurity.test.js` | 1 |
| 49 | `backend/test/portalUtils.test.js` | 1 |
| 50 | `backend/test/serverUtils.test.js` | 1 |
| 51 | `backend/test/uploadSecurity.test.js` | 1 |
| 52 | `business-os-v1-centralized-org-path/backend/server.js` | 14 |
| 53 | `business-os-v1-centralized-org-path/backend/src/accessControl.js` | 16 |
| 54 | `business-os-v1-centralized-org-path/backend/src/backupSchema.js` | 3 |
| 55 | `business-os-v1-centralized-org-path/backend/src/config.js` | 5 |
| 56 | `business-os-v1-centralized-org-path/backend/src/database.js` | 8 |
| 57 | `business-os-v1-centralized-org-path/backend/src/dataPath.js` | 9 |
| 58 | `business-os-v1-centralized-org-path/backend/src/fileAssets.js` | 22 |
| 59 | `business-os-v1-centralized-org-path/backend/src/helpers.js` | 17 |
| 60 | `business-os-v1-centralized-org-path/backend/src/middleware.js` | 14 |
| 61 | `business-os-v1-centralized-org-path/backend/src/netSecurity.js` | 7 |
| 62 | `business-os-v1-centralized-org-path/backend/src/organizationContext.js` | 12 |
| 63 | `business-os-v1-centralized-org-path/backend/src/portalUtils.js` | 6 |
| 64 | `business-os-v1-centralized-org-path/backend/src/requestContext.js` | 5 |
| 65 | `business-os-v1-centralized-org-path/backend/src/routes/ai.js` | 3 |
| 66 | `business-os-v1-centralized-org-path/backend/src/routes/auth.js` | 17 |
| 67 | `business-os-v1-centralized-org-path/backend/src/routes/branches.js` | 1 |
| 68 | `business-os-v1-centralized-org-path/backend/src/routes/catalog.js` | 0 |
| 69 | `business-os-v1-centralized-org-path/backend/src/routes/categories.js` | 0 |
| 70 | `business-os-v1-centralized-org-path/backend/src/routes/contacts.js` | 9 |
| 71 | `business-os-v1-centralized-org-path/backend/src/routes/customTables.js` | 2 |
| 72 | `business-os-v1-centralized-org-path/backend/src/routes/files.js` | 2 |
| 73 | `business-os-v1-centralized-org-path/backend/src/routes/inventory.js` | 1 |
| 74 | `business-os-v1-centralized-org-path/backend/src/routes/organizations.js` | 0 |
| 75 | `business-os-v1-centralized-org-path/backend/src/routes/portal.js` | 21 |
| 76 | `business-os-v1-centralized-org-path/backend/src/routes/products.js` | 17 |
| 77 | `business-os-v1-centralized-org-path/backend/src/routes/returns.js` | 4 |
| 78 | `business-os-v1-centralized-org-path/backend/src/routes/sales.js` | 12 |
| 79 | `business-os-v1-centralized-org-path/backend/src/routes/settings.js` | 0 |
| 80 | `business-os-v1-centralized-org-path/backend/src/routes/system.js` | 27 |
| 81 | `business-os-v1-centralized-org-path/backend/src/routes/units.js` | 0 |
| 82 | `business-os-v1-centralized-org-path/backend/src/routes/users.js` | 19 |
| 83 | `business-os-v1-centralized-org-path/backend/src/security.js` | 13 |
| 84 | `business-os-v1-centralized-org-path/backend/src/serverUtils.js` | 12 |
| 85 | `business-os-v1-centralized-org-path/backend/src/services/aiGateway.js` | 12 |
| 86 | `business-os-v1-centralized-org-path/backend/src/services/firebaseAuth.js` | 22 |
| 87 | `business-os-v1-centralized-org-path/backend/src/services/googleDriveSync.js` | 46 |
| 88 | `business-os-v1-centralized-org-path/backend/src/services/portalAi.js` | 29 |
| 89 | `business-os-v1-centralized-org-path/backend/src/services/supabaseAuth.js` | 37 |
| 90 | `business-os-v1-centralized-org-path/backend/src/services/verification.js` | 21 |
| 91 | `business-os-v1-centralized-org-path/backend/src/sessionAuth.js` | 6 |
| 92 | `business-os-v1-centralized-org-path/backend/src/systemFsWorker.js` | 7 |
| 93 | `business-os-v1-centralized-org-path/backend/src/uploadSecurity.js` | 7 |
| 94 | `business-os-v1-centralized-org-path/backend/src/websocket.js` | 1 |
| 95 | `business-os-v1-centralized-org-path/backend/test/accessControl.test.js` | 2 |
| 96 | `business-os-v1-centralized-org-path/backend/test/backupRoundtrip.test.js` | 12 |
| 97 | `business-os-v1-centralized-org-path/backend/test/backupSchema.test.js` | 1 |
| 98 | `business-os-v1-centralized-org-path/backend/test/dataPath.test.js` | 2 |
| 99 | `business-os-v1-centralized-org-path/backend/test/netSecurity.test.js` | 1 |
| 100 | `business-os-v1-centralized-org-path/backend/test/portalUtils.test.js` | 1 |
| 101 | `business-os-v1-centralized-org-path/backend/test/serverUtils.test.js` | 1 |
| 102 | `business-os-v1-centralized-org-path/backend/test/uploadSecurity.test.js` | 1 |
| 103 | `business-os-v1-centralized-org-path/frontend/postcss.config.js` | 0 |
| 104 | `business-os-v1-centralized-org-path/frontend/src/api/http.js` | 24 |
| 105 | `business-os-v1-centralized-org-path/frontend/src/api/localDb.js` | 5 |
| 106 | `business-os-v1-centralized-org-path/frontend/src/api/methods.js` | 116 |
| 107 | `business-os-v1-centralized-org-path/frontend/src/api/websocket.js` | 4 |
| 108 | `business-os-v1-centralized-org-path/frontend/src/App.jsx` | 26 |
| 109 | `business-os-v1-centralized-org-path/frontend/src/app/appShellUtils.mjs` | 4 |
| 110 | `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx` | 22 |
| 111 | `business-os-v1-centralized-org-path/frontend/src/components/auth/Login.jsx` | 19 |
| 112 | `business-os-v1-centralized-org-path/frontend/src/components/branches/Branches.jsx` | 9 |
| 113 | `business-os-v1-centralized-org-path/frontend/src/components/branches/BranchForm.jsx` | 3 |
| 114 | `business-os-v1-centralized-org-path/frontend/src/components/branches/TransferModal.jsx` | 3 |
| 115 | `business-os-v1-centralized-org-path/frontend/src/components/catalog/CatalogPage.jsx` | 67 |
| 116 | `business-os-v1-centralized-org-path/frontend/src/components/catalog/portalEditorUtils.mjs` | 8 |
| 117 | `business-os-v1-centralized-org-path/frontend/src/components/contacts/Contacts.jsx` | 8 |
| 118 | `business-os-v1-centralized-org-path/frontend/src/components/contacts/CustomersTab.jsx` | 17 |
| 119 | `business-os-v1-centralized-org-path/frontend/src/components/contacts/DeliveryTab.jsx` | 14 |
| 120 | `business-os-v1-centralized-org-path/frontend/src/components/contacts/shared.jsx` | 11 |
| 121 | `business-os-v1-centralized-org-path/frontend/src/components/contacts/SuppliersTab.jsx` | 6 |
| 122 | `business-os-v1-centralized-org-path/frontend/src/components/custom-tables/CustomTables.jsx` | 10 |
| 123 | `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/BarChart.jsx` | 2 |
| 124 | `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/DonutChart.jsx` | 1 |
| 125 | `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/index.js` | 0 |
| 126 | `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/LineChart.jsx` | 4 |
| 127 | `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/NoData.jsx` | 1 |
| 128 | `business-os-v1-centralized-org-path/frontend/src/components/dashboard/Dashboard.jsx` | 6 |
| 129 | `business-os-v1-centralized-org-path/frontend/src/components/dashboard/MiniStat.jsx` | 1 |
| 130 | `business-os-v1-centralized-org-path/frontend/src/components/files/FilePickerModal.jsx` | 7 |
| 131 | `business-os-v1-centralized-org-path/frontend/src/components/files/FilesPage.jsx` | 18 |
| 132 | `business-os-v1-centralized-org-path/frontend/src/components/inventory/DualMoney.jsx` | 1 |
| 133 | `business-os-v1-centralized-org-path/frontend/src/components/inventory/Inventory.jsx` | 6 |
| 134 | `business-os-v1-centralized-org-path/frontend/src/components/inventory/movementGroups.js` | 6 |
| 135 | `business-os-v1-centralized-org-path/frontend/src/components/inventory/ProductDetailModal.jsx` | 2 |
| 136 | `business-os-v1-centralized-org-path/frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | 9 |
| 137 | `business-os-v1-centralized-org-path/frontend/src/components/navigation/Sidebar.jsx` | 6 |
| 138 | `business-os-v1-centralized-org-path/frontend/src/components/pos/CartItem.jsx` | 1 |
| 139 | `business-os-v1-centralized-org-path/frontend/src/components/pos/FilterPanel.jsx` | 5 |
| 140 | `business-os-v1-centralized-org-path/frontend/src/components/pos/POS.jsx` | 24 |
| 141 | `business-os-v1-centralized-org-path/frontend/src/components/pos/ProductImage.jsx` | 1 |
| 142 | `business-os-v1-centralized-org-path/frontend/src/components/pos/QuickAddModal.jsx` | 2 |
| 143 | `business-os-v1-centralized-org-path/frontend/src/components/products/BranchStockAdjuster.jsx` | 3 |
| 144 | `business-os-v1-centralized-org-path/frontend/src/components/products/BulkAddStockModal.jsx` | 2 |
| 145 | `business-os-v1-centralized-org-path/frontend/src/components/products/BulkImportModal.jsx` | 12 |
| 146 | `business-os-v1-centralized-org-path/frontend/src/components/products/HeaderActions.jsx` | 1 |
| 147 | `business-os-v1-centralized-org-path/frontend/src/components/products/ManageBrandsModal.jsx` | 7 |
| 148 | `business-os-v1-centralized-org-path/frontend/src/components/products/ManageCategoriesModal.jsx` | 5 |
| 149 | `business-os-v1-centralized-org-path/frontend/src/components/products/ManageFieldsModal.jsx` | 3 |
| 150 | `business-os-v1-centralized-org-path/frontend/src/components/products/ManageMenu.jsx` | 1 |
| 151 | `business-os-v1-centralized-org-path/frontend/src/components/products/ManageUnitsModal.jsx` | 3 |
| 152 | `business-os-v1-centralized-org-path/frontend/src/components/products/primitives.jsx` | 6 |
| 153 | `business-os-v1-centralized-org-path/frontend/src/components/products/ProductDetailModal.jsx` | 3 |
| 154 | `business-os-v1-centralized-org-path/frontend/src/components/products/ProductForm.jsx` | 10 |
| 155 | `business-os-v1-centralized-org-path/frontend/src/components/products/Products.jsx` | 21 |
| 156 | `business-os-v1-centralized-org-path/frontend/src/components/products/VariantFormModal.jsx` | 3 |
| 157 | `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | 4 |
| 158 | `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/constants.js` | 2 |
| 159 | `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/ErrorBoundary.jsx` | 0 |
| 160 | `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/FieldOrderManager.jsx` | 9 |
| 161 | `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/PrintSettings.jsx` | 5 |
| 162 | `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/ReceiptPreview.jsx` | 1 |
| 163 | `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/ReceiptSettings.jsx` | 5 |
| 164 | `business-os-v1-centralized-org-path/frontend/src/components/receipt/Receipt.jsx` | 9 |
| 165 | `business-os-v1-centralized-org-path/frontend/src/components/returns/EditReturnModal.jsx` | 5 |
| 166 | `business-os-v1-centralized-org-path/frontend/src/components/returns/NewReturnModal.jsx` | 10 |
| 167 | `business-os-v1-centralized-org-path/frontend/src/components/returns/NewSupplierReturnModal.jsx` | 4 |
| 168 | `business-os-v1-centralized-org-path/frontend/src/components/returns/ReturnDetailModal.jsx` | 3 |
| 169 | `business-os-v1-centralized-org-path/frontend/src/components/returns/Returns.jsx` | 5 |
| 170 | `business-os-v1-centralized-org-path/frontend/src/components/sales/ExportModal.jsx` | 9 |
| 171 | `business-os-v1-centralized-org-path/frontend/src/components/sales/SaleDetailModal.jsx` | 6 |
| 172 | `business-os-v1-centralized-org-path/frontend/src/components/sales/Sales.jsx` | 5 |
| 173 | `business-os-v1-centralized-org-path/frontend/src/components/sales/StatusBadge.jsx` | 2 |
| 174 | `business-os-v1-centralized-org-path/frontend/src/components/server/ServerPage.jsx` | 12 |
| 175 | `business-os-v1-centralized-org-path/frontend/src/components/shared/ImageGalleryLightbox.jsx` | 5 |
| 176 | `business-os-v1-centralized-org-path/frontend/src/components/shared/Modal.jsx` | 1 |
| 177 | `business-os-v1-centralized-org-path/frontend/src/components/shared/navigationConfig.js` | 2 |
| 178 | `business-os-v1-centralized-org-path/frontend/src/components/shared/PageHelpButton.jsx` | 1 |
| 179 | `business-os-v1-centralized-org-path/frontend/src/components/shared/pageHelpContent.js` | 1 |
| 180 | `business-os-v1-centralized-org-path/frontend/src/components/shared/PortalMenu.jsx` | 4 |
| 181 | `business-os-v1-centralized-org-path/frontend/src/components/users/PermissionEditor.jsx` | 4 |
| 182 | `business-os-v1-centralized-org-path/frontend/src/components/users/UserDetailSheet.jsx` | 3 |
| 183 | `business-os-v1-centralized-org-path/frontend/src/components/users/UserProfileModal.jsx` | 12 |
| 184 | `business-os-v1-centralized-org-path/frontend/src/components/users/Users.jsx` | 16 |
| 185 | `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/AuditLog.jsx` | 11 |
| 186 | `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/Backup.jsx` | 37 |
| 187 | `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/FontFamilyPicker.jsx` | 1 |
| 188 | `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/index.js` | 0 |
| 189 | `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/OtpModal.jsx` | 3 |
| 190 | `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/ResetData.jsx` | 8 |
| 191 | `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/Settings.jsx` | 16 |
| 192 | `business-os-v1-centralized-org-path/frontend/src/constants.js` | 3 |
| 193 | `business-os-v1-centralized-org-path/frontend/src/index.jsx` | 4 |
| 194 | `business-os-v1-centralized-org-path/frontend/src/utils/appRefresh.js` | 1 |
| 195 | `business-os-v1-centralized-org-path/frontend/src/utils/csv.js` | 1 |
| 196 | `business-os-v1-centralized-org-path/frontend/src/utils/dateHelpers.js` | 2 |
| 197 | `business-os-v1-centralized-org-path/frontend/src/utils/deviceInfo.js` | 2 |
| 198 | `business-os-v1-centralized-org-path/frontend/src/utils/favicon.js` | 3 |
| 199 | `business-os-v1-centralized-org-path/frontend/src/utils/firebasePhoneAuth.js` | 4 |
| 200 | `business-os-v1-centralized-org-path/frontend/src/utils/formatters.js` | 4 |
| 201 | `business-os-v1-centralized-org-path/frontend/src/utils/index.js` | 0 |
| 202 | `business-os-v1-centralized-org-path/frontend/src/utils/printReceipt.js` | 21 |
| 203 | `business-os-v1-centralized-org-path/frontend/src/web-api.js` | 0 |
| 204 | `business-os-v1-centralized-org-path/frontend/tailwind.config.js` | 0 |
| 205 | `business-os-v1-centralized-org-path/frontend/tests/appShellUtils.test.mjs` | 1 |
| 206 | `business-os-v1-centralized-org-path/frontend/tests/portalEditorUtils.test.mjs` | 1 |
| 207 | `business-os-v1-centralized-org-path/frontend/vite.config.mjs` | 1 |
| 208 | `business-os-v2-dedicated-server/backend/server.js` | 14 |
| 209 | `business-os-v2-dedicated-server/backend/src/accessControl.js` | 16 |
| 210 | `business-os-v2-dedicated-server/backend/src/backupSchema.js` | 3 |
| 211 | `business-os-v2-dedicated-server/backend/src/config.js` | 5 |
| 212 | `business-os-v2-dedicated-server/backend/src/database.js` | 8 |
| 213 | `business-os-v2-dedicated-server/backend/src/dataPath.js` | 9 |
| 214 | `business-os-v2-dedicated-server/backend/src/fileAssets.js` | 22 |
| 215 | `business-os-v2-dedicated-server/backend/src/helpers.js` | 17 |
| 216 | `business-os-v2-dedicated-server/backend/src/middleware.js` | 14 |
| 217 | `business-os-v2-dedicated-server/backend/src/netSecurity.js` | 7 |
| 218 | `business-os-v2-dedicated-server/backend/src/organizationContext.js` | 12 |
| 219 | `business-os-v2-dedicated-server/backend/src/portalUtils.js` | 6 |
| 220 | `business-os-v2-dedicated-server/backend/src/requestContext.js` | 5 |
| 221 | `business-os-v2-dedicated-server/backend/src/routes/ai.js` | 3 |
| 222 | `business-os-v2-dedicated-server/backend/src/routes/auth.js` | 17 |
| 223 | `business-os-v2-dedicated-server/backend/src/routes/branches.js` | 1 |
| 224 | `business-os-v2-dedicated-server/backend/src/routes/catalog.js` | 0 |
| 225 | `business-os-v2-dedicated-server/backend/src/routes/categories.js` | 0 |
| 226 | `business-os-v2-dedicated-server/backend/src/routes/contacts.js` | 9 |
| 227 | `business-os-v2-dedicated-server/backend/src/routes/customTables.js` | 2 |
| 228 | `business-os-v2-dedicated-server/backend/src/routes/files.js` | 2 |
| 229 | `business-os-v2-dedicated-server/backend/src/routes/inventory.js` | 1 |
| 230 | `business-os-v2-dedicated-server/backend/src/routes/organizations.js` | 0 |
| 231 | `business-os-v2-dedicated-server/backend/src/routes/portal.js` | 21 |
| 232 | `business-os-v2-dedicated-server/backend/src/routes/products.js` | 17 |
| 233 | `business-os-v2-dedicated-server/backend/src/routes/returns.js` | 4 |
| 234 | `business-os-v2-dedicated-server/backend/src/routes/sales.js` | 12 |
| 235 | `business-os-v2-dedicated-server/backend/src/routes/settings.js` | 0 |
| 236 | `business-os-v2-dedicated-server/backend/src/routes/system.js` | 27 |
| 237 | `business-os-v2-dedicated-server/backend/src/routes/units.js` | 0 |
| 238 | `business-os-v2-dedicated-server/backend/src/routes/users.js` | 19 |
| 239 | `business-os-v2-dedicated-server/backend/src/security.js` | 13 |
| 240 | `business-os-v2-dedicated-server/backend/src/serverUtils.js` | 12 |
| 241 | `business-os-v2-dedicated-server/backend/src/services/aiGateway.js` | 12 |
| 242 | `business-os-v2-dedicated-server/backend/src/services/firebaseAuth.js` | 22 |
| 243 | `business-os-v2-dedicated-server/backend/src/services/googleDriveSync.js` | 46 |
| 244 | `business-os-v2-dedicated-server/backend/src/services/portalAi.js` | 29 |
| 245 | `business-os-v2-dedicated-server/backend/src/services/supabaseAuth.js` | 37 |
| 246 | `business-os-v2-dedicated-server/backend/src/services/verification.js` | 21 |
| 247 | `business-os-v2-dedicated-server/backend/src/sessionAuth.js` | 6 |
| 248 | `business-os-v2-dedicated-server/backend/src/systemFsWorker.js` | 7 |
| 249 | `business-os-v2-dedicated-server/backend/src/uploadSecurity.js` | 7 |
| 250 | `business-os-v2-dedicated-server/backend/src/websocket.js` | 1 |
| 251 | `business-os-v2-dedicated-server/backend/test/accessControl.test.js` | 2 |
| 252 | `business-os-v2-dedicated-server/backend/test/backupRoundtrip.test.js` | 12 |
| 253 | `business-os-v2-dedicated-server/backend/test/backupSchema.test.js` | 1 |
| 254 | `business-os-v2-dedicated-server/backend/test/dataPath.test.js` | 2 |
| 255 | `business-os-v2-dedicated-server/backend/test/netSecurity.test.js` | 1 |
| 256 | `business-os-v2-dedicated-server/backend/test/portalUtils.test.js` | 1 |
| 257 | `business-os-v2-dedicated-server/backend/test/serverUtils.test.js` | 1 |
| 258 | `business-os-v2-dedicated-server/backend/test/uploadSecurity.test.js` | 1 |
| 259 | `business-os-v2-dedicated-server/frontend/postcss.config.js` | 0 |
| 260 | `business-os-v2-dedicated-server/frontend/src/api/http.js` | 24 |
| 261 | `business-os-v2-dedicated-server/frontend/src/api/localDb.js` | 5 |
| 262 | `business-os-v2-dedicated-server/frontend/src/api/methods.js` | 116 |
| 263 | `business-os-v2-dedicated-server/frontend/src/api/websocket.js` | 4 |
| 264 | `business-os-v2-dedicated-server/frontend/src/App.jsx` | 26 |
| 265 | `business-os-v2-dedicated-server/frontend/src/app/appShellUtils.mjs` | 4 |
| 266 | `business-os-v2-dedicated-server/frontend/src/AppContext.jsx` | 22 |
| 267 | `business-os-v2-dedicated-server/frontend/src/components/auth/Login.jsx` | 19 |
| 268 | `business-os-v2-dedicated-server/frontend/src/components/branches/Branches.jsx` | 9 |
| 269 | `business-os-v2-dedicated-server/frontend/src/components/branches/BranchForm.jsx` | 3 |
| 270 | `business-os-v2-dedicated-server/frontend/src/components/branches/TransferModal.jsx` | 3 |
| 271 | `business-os-v2-dedicated-server/frontend/src/components/catalog/CatalogPage.jsx` | 67 |
| 272 | `business-os-v2-dedicated-server/frontend/src/components/catalog/portalEditorUtils.mjs` | 8 |
| 273 | `business-os-v2-dedicated-server/frontend/src/components/contacts/Contacts.jsx` | 8 |
| 274 | `business-os-v2-dedicated-server/frontend/src/components/contacts/CustomersTab.jsx` | 17 |
| 275 | `business-os-v2-dedicated-server/frontend/src/components/contacts/DeliveryTab.jsx` | 14 |
| 276 | `business-os-v2-dedicated-server/frontend/src/components/contacts/shared.jsx` | 11 |
| 277 | `business-os-v2-dedicated-server/frontend/src/components/contacts/SuppliersTab.jsx` | 6 |
| 278 | `business-os-v2-dedicated-server/frontend/src/components/custom-tables/CustomTables.jsx` | 10 |
| 279 | `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/BarChart.jsx` | 2 |
| 280 | `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/DonutChart.jsx` | 1 |
| 281 | `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/index.js` | 0 |
| 282 | `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/LineChart.jsx` | 4 |
| 283 | `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/NoData.jsx` | 1 |
| 284 | `business-os-v2-dedicated-server/frontend/src/components/dashboard/Dashboard.jsx` | 6 |
| 285 | `business-os-v2-dedicated-server/frontend/src/components/dashboard/MiniStat.jsx` | 1 |
| 286 | `business-os-v2-dedicated-server/frontend/src/components/files/FilePickerModal.jsx` | 7 |
| 287 | `business-os-v2-dedicated-server/frontend/src/components/files/FilesPage.jsx` | 18 |
| 288 | `business-os-v2-dedicated-server/frontend/src/components/inventory/DualMoney.jsx` | 1 |
| 289 | `business-os-v2-dedicated-server/frontend/src/components/inventory/Inventory.jsx` | 6 |
| 290 | `business-os-v2-dedicated-server/frontend/src/components/inventory/movementGroups.js` | 6 |
| 291 | `business-os-v2-dedicated-server/frontend/src/components/inventory/ProductDetailModal.jsx` | 2 |
| 292 | `business-os-v2-dedicated-server/frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | 9 |
| 293 | `business-os-v2-dedicated-server/frontend/src/components/navigation/Sidebar.jsx` | 6 |
| 294 | `business-os-v2-dedicated-server/frontend/src/components/pos/CartItem.jsx` | 1 |
| 295 | `business-os-v2-dedicated-server/frontend/src/components/pos/FilterPanel.jsx` | 5 |
| 296 | `business-os-v2-dedicated-server/frontend/src/components/pos/POS.jsx` | 24 |
| 297 | `business-os-v2-dedicated-server/frontend/src/components/pos/ProductImage.jsx` | 1 |
| 298 | `business-os-v2-dedicated-server/frontend/src/components/pos/QuickAddModal.jsx` | 2 |
| 299 | `business-os-v2-dedicated-server/frontend/src/components/products/BranchStockAdjuster.jsx` | 3 |
| 300 | `business-os-v2-dedicated-server/frontend/src/components/products/BulkAddStockModal.jsx` | 2 |
| 301 | `business-os-v2-dedicated-server/frontend/src/components/products/BulkImportModal.jsx` | 12 |
| 302 | `business-os-v2-dedicated-server/frontend/src/components/products/HeaderActions.jsx` | 1 |
| 303 | `business-os-v2-dedicated-server/frontend/src/components/products/ManageBrandsModal.jsx` | 7 |
| 304 | `business-os-v2-dedicated-server/frontend/src/components/products/ManageCategoriesModal.jsx` | 5 |
| 305 | `business-os-v2-dedicated-server/frontend/src/components/products/ManageFieldsModal.jsx` | 3 |
| 306 | `business-os-v2-dedicated-server/frontend/src/components/products/ManageMenu.jsx` | 1 |
| 307 | `business-os-v2-dedicated-server/frontend/src/components/products/ManageUnitsModal.jsx` | 3 |
| 308 | `business-os-v2-dedicated-server/frontend/src/components/products/primitives.jsx` | 6 |
| 309 | `business-os-v2-dedicated-server/frontend/src/components/products/ProductDetailModal.jsx` | 3 |
| 310 | `business-os-v2-dedicated-server/frontend/src/components/products/ProductForm.jsx` | 10 |
| 311 | `business-os-v2-dedicated-server/frontend/src/components/products/Products.jsx` | 21 |
| 312 | `business-os-v2-dedicated-server/frontend/src/components/products/VariantFormModal.jsx` | 3 |
| 313 | `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | 4 |
| 314 | `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/constants.js` | 2 |
| 315 | `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/ErrorBoundary.jsx` | 0 |
| 316 | `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/FieldOrderManager.jsx` | 9 |
| 317 | `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/PrintSettings.jsx` | 5 |
| 318 | `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/ReceiptPreview.jsx` | 1 |
| 319 | `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/ReceiptSettings.jsx` | 5 |
| 320 | `business-os-v2-dedicated-server/frontend/src/components/receipt/Receipt.jsx` | 9 |
| 321 | `business-os-v2-dedicated-server/frontend/src/components/returns/EditReturnModal.jsx` | 5 |
| 322 | `business-os-v2-dedicated-server/frontend/src/components/returns/NewReturnModal.jsx` | 10 |
| 323 | `business-os-v2-dedicated-server/frontend/src/components/returns/NewSupplierReturnModal.jsx` | 4 |
| 324 | `business-os-v2-dedicated-server/frontend/src/components/returns/ReturnDetailModal.jsx` | 3 |
| 325 | `business-os-v2-dedicated-server/frontend/src/components/returns/Returns.jsx` | 5 |
| 326 | `business-os-v2-dedicated-server/frontend/src/components/sales/ExportModal.jsx` | 9 |
| 327 | `business-os-v2-dedicated-server/frontend/src/components/sales/SaleDetailModal.jsx` | 6 |
| 328 | `business-os-v2-dedicated-server/frontend/src/components/sales/Sales.jsx` | 5 |
| 329 | `business-os-v2-dedicated-server/frontend/src/components/sales/StatusBadge.jsx` | 2 |
| 330 | `business-os-v2-dedicated-server/frontend/src/components/server/ServerPage.jsx` | 12 |
| 331 | `business-os-v2-dedicated-server/frontend/src/components/shared/ImageGalleryLightbox.jsx` | 5 |
| 332 | `business-os-v2-dedicated-server/frontend/src/components/shared/Modal.jsx` | 1 |
| 333 | `business-os-v2-dedicated-server/frontend/src/components/shared/navigationConfig.js` | 2 |
| 334 | `business-os-v2-dedicated-server/frontend/src/components/shared/PageHelpButton.jsx` | 1 |
| 335 | `business-os-v2-dedicated-server/frontend/src/components/shared/pageHelpContent.js` | 1 |
| 336 | `business-os-v2-dedicated-server/frontend/src/components/shared/PortalMenu.jsx` | 4 |
| 337 | `business-os-v2-dedicated-server/frontend/src/components/users/PermissionEditor.jsx` | 4 |
| 338 | `business-os-v2-dedicated-server/frontend/src/components/users/UserDetailSheet.jsx` | 3 |
| 339 | `business-os-v2-dedicated-server/frontend/src/components/users/UserProfileModal.jsx` | 12 |
| 340 | `business-os-v2-dedicated-server/frontend/src/components/users/Users.jsx` | 16 |
| 341 | `business-os-v2-dedicated-server/frontend/src/components/utils-settings/AuditLog.jsx` | 11 |
| 342 | `business-os-v2-dedicated-server/frontend/src/components/utils-settings/Backup.jsx` | 37 |
| 343 | `business-os-v2-dedicated-server/frontend/src/components/utils-settings/FontFamilyPicker.jsx` | 1 |
| 344 | `business-os-v2-dedicated-server/frontend/src/components/utils-settings/index.js` | 0 |
| 345 | `business-os-v2-dedicated-server/frontend/src/components/utils-settings/OtpModal.jsx` | 3 |
| 346 | `business-os-v2-dedicated-server/frontend/src/components/utils-settings/ResetData.jsx` | 8 |
| 347 | `business-os-v2-dedicated-server/frontend/src/components/utils-settings/Settings.jsx` | 16 |
| 348 | `business-os-v2-dedicated-server/frontend/src/constants.js` | 3 |
| 349 | `business-os-v2-dedicated-server/frontend/src/index.jsx` | 4 |
| 350 | `business-os-v2-dedicated-server/frontend/src/utils/appRefresh.js` | 1 |
| 351 | `business-os-v2-dedicated-server/frontend/src/utils/csv.js` | 1 |
| 352 | `business-os-v2-dedicated-server/frontend/src/utils/dateHelpers.js` | 2 |
| 353 | `business-os-v2-dedicated-server/frontend/src/utils/deviceInfo.js` | 2 |
| 354 | `business-os-v2-dedicated-server/frontend/src/utils/favicon.js` | 3 |
| 355 | `business-os-v2-dedicated-server/frontend/src/utils/firebasePhoneAuth.js` | 4 |
| 356 | `business-os-v2-dedicated-server/frontend/src/utils/formatters.js` | 4 |
| 357 | `business-os-v2-dedicated-server/frontend/src/utils/index.js` | 0 |
| 358 | `business-os-v2-dedicated-server/frontend/src/utils/printReceipt.js` | 21 |
| 359 | `business-os-v2-dedicated-server/frontend/src/web-api.js` | 0 |
| 360 | `business-os-v2-dedicated-server/frontend/tailwind.config.js` | 0 |
| 361 | `business-os-v2-dedicated-server/frontend/tests/appShellUtils.test.mjs` | 1 |
| 362 | `business-os-v2-dedicated-server/frontend/tests/portalEditorUtils.test.mjs` | 1 |
| 363 | `business-os-v2-dedicated-server/frontend/vite.config.mjs` | 1 |
| 364 | `business-os-v3-centralized-server-template/backend/server.js` | 14 |
| 365 | `business-os-v3-centralized-server-template/backend/src/accessControl.js` | 16 |
| 366 | `business-os-v3-centralized-server-template/backend/src/backupSchema.js` | 3 |
| 367 | `business-os-v3-centralized-server-template/backend/src/config.js` | 5 |
| 368 | `business-os-v3-centralized-server-template/backend/src/database.js` | 8 |
| 369 | `business-os-v3-centralized-server-template/backend/src/dataPath.js` | 9 |
| 370 | `business-os-v3-centralized-server-template/backend/src/fileAssets.js` | 22 |
| 371 | `business-os-v3-centralized-server-template/backend/src/helpers.js` | 17 |
| 372 | `business-os-v3-centralized-server-template/backend/src/middleware.js` | 14 |
| 373 | `business-os-v3-centralized-server-template/backend/src/netSecurity.js` | 7 |
| 374 | `business-os-v3-centralized-server-template/backend/src/organizationContext.js` | 12 |
| 375 | `business-os-v3-centralized-server-template/backend/src/portalUtils.js` | 6 |
| 376 | `business-os-v3-centralized-server-template/backend/src/requestContext.js` | 5 |
| 377 | `business-os-v3-centralized-server-template/backend/src/routes/ai.js` | 3 |
| 378 | `business-os-v3-centralized-server-template/backend/src/routes/auth.js` | 17 |
| 379 | `business-os-v3-centralized-server-template/backend/src/routes/branches.js` | 1 |
| 380 | `business-os-v3-centralized-server-template/backend/src/routes/catalog.js` | 0 |
| 381 | `business-os-v3-centralized-server-template/backend/src/routes/categories.js` | 0 |
| 382 | `business-os-v3-centralized-server-template/backend/src/routes/contacts.js` | 9 |
| 383 | `business-os-v3-centralized-server-template/backend/src/routes/customTables.js` | 2 |
| 384 | `business-os-v3-centralized-server-template/backend/src/routes/files.js` | 2 |
| 385 | `business-os-v3-centralized-server-template/backend/src/routes/inventory.js` | 1 |
| 386 | `business-os-v3-centralized-server-template/backend/src/routes/organizations.js` | 0 |
| 387 | `business-os-v3-centralized-server-template/backend/src/routes/portal.js` | 21 |
| 388 | `business-os-v3-centralized-server-template/backend/src/routes/products.js` | 17 |
| 389 | `business-os-v3-centralized-server-template/backend/src/routes/returns.js` | 4 |
| 390 | `business-os-v3-centralized-server-template/backend/src/routes/sales.js` | 12 |
| 391 | `business-os-v3-centralized-server-template/backend/src/routes/settings.js` | 0 |
| 392 | `business-os-v3-centralized-server-template/backend/src/routes/system.js` | 27 |
| 393 | `business-os-v3-centralized-server-template/backend/src/routes/units.js` | 0 |
| 394 | `business-os-v3-centralized-server-template/backend/src/routes/users.js` | 19 |
| 395 | `business-os-v3-centralized-server-template/backend/src/security.js` | 13 |
| 396 | `business-os-v3-centralized-server-template/backend/src/serverUtils.js` | 12 |
| 397 | `business-os-v3-centralized-server-template/backend/src/services/aiGateway.js` | 12 |
| 398 | `business-os-v3-centralized-server-template/backend/src/services/firebaseAuth.js` | 22 |
| 399 | `business-os-v3-centralized-server-template/backend/src/services/googleDriveSync.js` | 46 |
| 400 | `business-os-v3-centralized-server-template/backend/src/services/portalAi.js` | 29 |
| 401 | `business-os-v3-centralized-server-template/backend/src/services/supabaseAuth.js` | 37 |
| 402 | `business-os-v3-centralized-server-template/backend/src/services/verification.js` | 21 |
| 403 | `business-os-v3-centralized-server-template/backend/src/sessionAuth.js` | 6 |
| 404 | `business-os-v3-centralized-server-template/backend/src/systemFsWorker.js` | 7 |
| 405 | `business-os-v3-centralized-server-template/backend/src/uploadSecurity.js` | 7 |
| 406 | `business-os-v3-centralized-server-template/backend/src/websocket.js` | 1 |
| 407 | `business-os-v3-centralized-server-template/backend/test/accessControl.test.js` | 2 |
| 408 | `business-os-v3-centralized-server-template/backend/test/backupRoundtrip.test.js` | 12 |
| 409 | `business-os-v3-centralized-server-template/backend/test/backupSchema.test.js` | 1 |
| 410 | `business-os-v3-centralized-server-template/backend/test/dataPath.test.js` | 2 |
| 411 | `business-os-v3-centralized-server-template/backend/test/netSecurity.test.js` | 1 |
| 412 | `business-os-v3-centralized-server-template/backend/test/portalUtils.test.js` | 1 |
| 413 | `business-os-v3-centralized-server-template/backend/test/serverUtils.test.js` | 1 |
| 414 | `business-os-v3-centralized-server-template/backend/test/uploadSecurity.test.js` | 1 |
| 415 | `business-os-v3-centralized-server-template/frontend/postcss.config.js` | 0 |
| 416 | `business-os-v3-centralized-server-template/frontend/src/api/http.js` | 24 |
| 417 | `business-os-v3-centralized-server-template/frontend/src/api/localDb.js` | 5 |
| 418 | `business-os-v3-centralized-server-template/frontend/src/api/methods.js` | 116 |
| 419 | `business-os-v3-centralized-server-template/frontend/src/api/websocket.js` | 4 |
| 420 | `business-os-v3-centralized-server-template/frontend/src/App.jsx` | 26 |
| 421 | `business-os-v3-centralized-server-template/frontend/src/app/appShellUtils.mjs` | 4 |
| 422 | `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx` | 22 |
| 423 | `business-os-v3-centralized-server-template/frontend/src/components/auth/Login.jsx` | 19 |
| 424 | `business-os-v3-centralized-server-template/frontend/src/components/branches/Branches.jsx` | 9 |
| 425 | `business-os-v3-centralized-server-template/frontend/src/components/branches/BranchForm.jsx` | 3 |
| 426 | `business-os-v3-centralized-server-template/frontend/src/components/branches/TransferModal.jsx` | 3 |
| 427 | `business-os-v3-centralized-server-template/frontend/src/components/catalog/CatalogPage.jsx` | 67 |
| 428 | `business-os-v3-centralized-server-template/frontend/src/components/catalog/portalEditorUtils.mjs` | 8 |
| 429 | `business-os-v3-centralized-server-template/frontend/src/components/contacts/Contacts.jsx` | 8 |
| 430 | `business-os-v3-centralized-server-template/frontend/src/components/contacts/CustomersTab.jsx` | 17 |
| 431 | `business-os-v3-centralized-server-template/frontend/src/components/contacts/DeliveryTab.jsx` | 14 |
| 432 | `business-os-v3-centralized-server-template/frontend/src/components/contacts/shared.jsx` | 11 |
| 433 | `business-os-v3-centralized-server-template/frontend/src/components/contacts/SuppliersTab.jsx` | 6 |
| 434 | `business-os-v3-centralized-server-template/frontend/src/components/custom-tables/CustomTables.jsx` | 10 |
| 435 | `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/BarChart.jsx` | 2 |
| 436 | `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/DonutChart.jsx` | 1 |
| 437 | `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/index.js` | 0 |
| 438 | `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/LineChart.jsx` | 4 |
| 439 | `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/NoData.jsx` | 1 |
| 440 | `business-os-v3-centralized-server-template/frontend/src/components/dashboard/Dashboard.jsx` | 6 |
| 441 | `business-os-v3-centralized-server-template/frontend/src/components/dashboard/MiniStat.jsx` | 1 |
| 442 | `business-os-v3-centralized-server-template/frontend/src/components/files/FilePickerModal.jsx` | 7 |
| 443 | `business-os-v3-centralized-server-template/frontend/src/components/files/FilesPage.jsx` | 18 |
| 444 | `business-os-v3-centralized-server-template/frontend/src/components/inventory/DualMoney.jsx` | 1 |
| 445 | `business-os-v3-centralized-server-template/frontend/src/components/inventory/Inventory.jsx` | 6 |
| 446 | `business-os-v3-centralized-server-template/frontend/src/components/inventory/movementGroups.js` | 6 |
| 447 | `business-os-v3-centralized-server-template/frontend/src/components/inventory/ProductDetailModal.jsx` | 2 |
| 448 | `business-os-v3-centralized-server-template/frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | 9 |
| 449 | `business-os-v3-centralized-server-template/frontend/src/components/navigation/Sidebar.jsx` | 6 |
| 450 | `business-os-v3-centralized-server-template/frontend/src/components/pos/CartItem.jsx` | 1 |
| 451 | `business-os-v3-centralized-server-template/frontend/src/components/pos/FilterPanel.jsx` | 5 |
| 452 | `business-os-v3-centralized-server-template/frontend/src/components/pos/POS.jsx` | 24 |
| 453 | `business-os-v3-centralized-server-template/frontend/src/components/pos/ProductImage.jsx` | 1 |
| 454 | `business-os-v3-centralized-server-template/frontend/src/components/pos/QuickAddModal.jsx` | 2 |
| 455 | `business-os-v3-centralized-server-template/frontend/src/components/products/BranchStockAdjuster.jsx` | 3 |
| 456 | `business-os-v3-centralized-server-template/frontend/src/components/products/BulkAddStockModal.jsx` | 2 |
| 457 | `business-os-v3-centralized-server-template/frontend/src/components/products/BulkImportModal.jsx` | 12 |
| 458 | `business-os-v3-centralized-server-template/frontend/src/components/products/HeaderActions.jsx` | 1 |
| 459 | `business-os-v3-centralized-server-template/frontend/src/components/products/ManageBrandsModal.jsx` | 7 |
| 460 | `business-os-v3-centralized-server-template/frontend/src/components/products/ManageCategoriesModal.jsx` | 5 |
| 461 | `business-os-v3-centralized-server-template/frontend/src/components/products/ManageFieldsModal.jsx` | 3 |
| 462 | `business-os-v3-centralized-server-template/frontend/src/components/products/ManageMenu.jsx` | 1 |
| 463 | `business-os-v3-centralized-server-template/frontend/src/components/products/ManageUnitsModal.jsx` | 3 |
| 464 | `business-os-v3-centralized-server-template/frontend/src/components/products/primitives.jsx` | 6 |
| 465 | `business-os-v3-centralized-server-template/frontend/src/components/products/ProductDetailModal.jsx` | 3 |
| 466 | `business-os-v3-centralized-server-template/frontend/src/components/products/ProductForm.jsx` | 10 |
| 467 | `business-os-v3-centralized-server-template/frontend/src/components/products/Products.jsx` | 21 |
| 468 | `business-os-v3-centralized-server-template/frontend/src/components/products/VariantFormModal.jsx` | 3 |
| 469 | `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | 4 |
| 470 | `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/constants.js` | 2 |
| 471 | `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/ErrorBoundary.jsx` | 0 |
| 472 | `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/FieldOrderManager.jsx` | 9 |
| 473 | `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/PrintSettings.jsx` | 5 |
| 474 | `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/ReceiptPreview.jsx` | 1 |
| 475 | `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/ReceiptSettings.jsx` | 5 |
| 476 | `business-os-v3-centralized-server-template/frontend/src/components/receipt/Receipt.jsx` | 9 |
| 477 | `business-os-v3-centralized-server-template/frontend/src/components/returns/EditReturnModal.jsx` | 5 |
| 478 | `business-os-v3-centralized-server-template/frontend/src/components/returns/NewReturnModal.jsx` | 10 |
| 479 | `business-os-v3-centralized-server-template/frontend/src/components/returns/NewSupplierReturnModal.jsx` | 4 |
| 480 | `business-os-v3-centralized-server-template/frontend/src/components/returns/ReturnDetailModal.jsx` | 3 |
| 481 | `business-os-v3-centralized-server-template/frontend/src/components/returns/Returns.jsx` | 5 |
| 482 | `business-os-v3-centralized-server-template/frontend/src/components/sales/ExportModal.jsx` | 9 |
| 483 | `business-os-v3-centralized-server-template/frontend/src/components/sales/SaleDetailModal.jsx` | 6 |
| 484 | `business-os-v3-centralized-server-template/frontend/src/components/sales/Sales.jsx` | 5 |
| 485 | `business-os-v3-centralized-server-template/frontend/src/components/sales/StatusBadge.jsx` | 2 |
| 486 | `business-os-v3-centralized-server-template/frontend/src/components/server/ServerPage.jsx` | 12 |
| 487 | `business-os-v3-centralized-server-template/frontend/src/components/shared/ImageGalleryLightbox.jsx` | 5 |
| 488 | `business-os-v3-centralized-server-template/frontend/src/components/shared/Modal.jsx` | 1 |
| 489 | `business-os-v3-centralized-server-template/frontend/src/components/shared/navigationConfig.js` | 2 |
| 490 | `business-os-v3-centralized-server-template/frontend/src/components/shared/PageHelpButton.jsx` | 1 |
| 491 | `business-os-v3-centralized-server-template/frontend/src/components/shared/pageHelpContent.js` | 1 |
| 492 | `business-os-v3-centralized-server-template/frontend/src/components/shared/PortalMenu.jsx` | 4 |
| 493 | `business-os-v3-centralized-server-template/frontend/src/components/users/PermissionEditor.jsx` | 4 |
| 494 | `business-os-v3-centralized-server-template/frontend/src/components/users/UserDetailSheet.jsx` | 3 |
| 495 | `business-os-v3-centralized-server-template/frontend/src/components/users/UserProfileModal.jsx` | 12 |
| 496 | `business-os-v3-centralized-server-template/frontend/src/components/users/Users.jsx` | 16 |
| 497 | `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/AuditLog.jsx` | 11 |
| 498 | `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/Backup.jsx` | 37 |
| 499 | `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/FontFamilyPicker.jsx` | 1 |
| 500 | `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/index.js` | 0 |
| 501 | `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/OtpModal.jsx` | 3 |
| 502 | `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/ResetData.jsx` | 8 |
| 503 | `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/Settings.jsx` | 16 |
| 504 | `business-os-v3-centralized-server-template/frontend/src/constants.js` | 3 |
| 505 | `business-os-v3-centralized-server-template/frontend/src/index.jsx` | 4 |
| 506 | `business-os-v3-centralized-server-template/frontend/src/utils/appRefresh.js` | 1 |
| 507 | `business-os-v3-centralized-server-template/frontend/src/utils/csv.js` | 1 |
| 508 | `business-os-v3-centralized-server-template/frontend/src/utils/dateHelpers.js` | 2 |
| 509 | `business-os-v3-centralized-server-template/frontend/src/utils/deviceInfo.js` | 2 |
| 510 | `business-os-v3-centralized-server-template/frontend/src/utils/favicon.js` | 3 |
| 511 | `business-os-v3-centralized-server-template/frontend/src/utils/firebasePhoneAuth.js` | 4 |
| 512 | `business-os-v3-centralized-server-template/frontend/src/utils/formatters.js` | 4 |
| 513 | `business-os-v3-centralized-server-template/frontend/src/utils/index.js` | 0 |
| 514 | `business-os-v3-centralized-server-template/frontend/src/utils/printReceipt.js` | 21 |
| 515 | `business-os-v3-centralized-server-template/frontend/src/web-api.js` | 0 |
| 516 | `business-os-v3-centralized-server-template/frontend/tailwind.config.js` | 0 |
| 517 | `business-os-v3-centralized-server-template/frontend/tests/appShellUtils.test.mjs` | 1 |
| 518 | `business-os-v3-centralized-server-template/frontend/tests/portalEditorUtils.test.mjs` | 1 |
| 519 | `business-os-v3-centralized-server-template/frontend/vite.config.mjs` | 1 |
| 520 | `frontend/postcss.config.js` | 0 |
| 521 | `frontend/src/api/http.js` | 24 |
| 522 | `frontend/src/api/localDb.js` | 5 |
| 523 | `frontend/src/api/methods.js` | 116 |
| 524 | `frontend/src/api/websocket.js` | 4 |
| 525 | `frontend/src/App.jsx` | 26 |
| 526 | `frontend/src/app/appShellUtils.mjs` | 4 |
| 527 | `frontend/src/AppContext.jsx` | 22 |
| 528 | `frontend/src/components/auth/Login.jsx` | 19 |
| 529 | `frontend/src/components/branches/Branches.jsx` | 9 |
| 530 | `frontend/src/components/branches/BranchForm.jsx` | 3 |
| 531 | `frontend/src/components/branches/TransferModal.jsx` | 3 |
| 532 | `frontend/src/components/catalog/CatalogPage.jsx` | 67 |
| 533 | `frontend/src/components/catalog/portalEditorUtils.mjs` | 8 |
| 534 | `frontend/src/components/contacts/Contacts.jsx` | 8 |
| 535 | `frontend/src/components/contacts/CustomersTab.jsx` | 17 |
| 536 | `frontend/src/components/contacts/DeliveryTab.jsx` | 14 |
| 537 | `frontend/src/components/contacts/shared.jsx` | 11 |
| 538 | `frontend/src/components/contacts/SuppliersTab.jsx` | 6 |
| 539 | `frontend/src/components/custom-tables/CustomTables.jsx` | 10 |
| 540 | `frontend/src/components/dashboard/charts/BarChart.jsx` | 2 |
| 541 | `frontend/src/components/dashboard/charts/DonutChart.jsx` | 1 |
| 542 | `frontend/src/components/dashboard/charts/index.js` | 0 |
| 543 | `frontend/src/components/dashboard/charts/LineChart.jsx` | 4 |
| 544 | `frontend/src/components/dashboard/charts/NoData.jsx` | 1 |
| 545 | `frontend/src/components/dashboard/Dashboard.jsx` | 6 |
| 546 | `frontend/src/components/dashboard/MiniStat.jsx` | 1 |
| 547 | `frontend/src/components/files/FilePickerModal.jsx` | 7 |
| 548 | `frontend/src/components/files/FilesPage.jsx` | 18 |
| 549 | `frontend/src/components/inventory/DualMoney.jsx` | 1 |
| 550 | `frontend/src/components/inventory/Inventory.jsx` | 6 |
| 551 | `frontend/src/components/inventory/movementGroups.js` | 6 |
| 552 | `frontend/src/components/inventory/ProductDetailModal.jsx` | 2 |
| 553 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | 9 |
| 554 | `frontend/src/components/navigation/Sidebar.jsx` | 6 |
| 555 | `frontend/src/components/pos/CartItem.jsx` | 1 |
| 556 | `frontend/src/components/pos/FilterPanel.jsx` | 5 |
| 557 | `frontend/src/components/pos/POS.jsx` | 24 |
| 558 | `frontend/src/components/pos/ProductImage.jsx` | 1 |
| 559 | `frontend/src/components/pos/QuickAddModal.jsx` | 2 |
| 560 | `frontend/src/components/products/BranchStockAdjuster.jsx` | 3 |
| 561 | `frontend/src/components/products/BulkAddStockModal.jsx` | 2 |
| 562 | `frontend/src/components/products/BulkImportModal.jsx` | 12 |
| 563 | `frontend/src/components/products/HeaderActions.jsx` | 1 |
| 564 | `frontend/src/components/products/ManageBrandsModal.jsx` | 7 |
| 565 | `frontend/src/components/products/ManageCategoriesModal.jsx` | 5 |
| 566 | `frontend/src/components/products/ManageFieldsModal.jsx` | 3 |
| 567 | `frontend/src/components/products/ManageMenu.jsx` | 1 |
| 568 | `frontend/src/components/products/ManageUnitsModal.jsx` | 3 |
| 569 | `frontend/src/components/products/primitives.jsx` | 6 |
| 570 | `frontend/src/components/products/ProductDetailModal.jsx` | 3 |
| 571 | `frontend/src/components/products/ProductForm.jsx` | 10 |
| 572 | `frontend/src/components/products/Products.jsx` | 21 |
| 573 | `frontend/src/components/products/VariantFormModal.jsx` | 3 |
| 574 | `frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | 4 |
| 575 | `frontend/src/components/receipt-settings/constants.js` | 2 |
| 576 | `frontend/src/components/receipt-settings/ErrorBoundary.jsx` | 0 |
| 577 | `frontend/src/components/receipt-settings/FieldOrderManager.jsx` | 9 |
| 578 | `frontend/src/components/receipt-settings/PrintSettings.jsx` | 5 |
| 579 | `frontend/src/components/receipt-settings/ReceiptPreview.jsx` | 1 |
| 580 | `frontend/src/components/receipt-settings/ReceiptSettings.jsx` | 5 |
| 581 | `frontend/src/components/receipt/Receipt.jsx` | 9 |
| 582 | `frontend/src/components/returns/EditReturnModal.jsx` | 5 |
| 583 | `frontend/src/components/returns/NewReturnModal.jsx` | 10 |
| 584 | `frontend/src/components/returns/NewSupplierReturnModal.jsx` | 4 |
| 585 | `frontend/src/components/returns/ReturnDetailModal.jsx` | 3 |
| 586 | `frontend/src/components/returns/Returns.jsx` | 5 |
| 587 | `frontend/src/components/sales/ExportModal.jsx` | 9 |
| 588 | `frontend/src/components/sales/SaleDetailModal.jsx` | 6 |
| 589 | `frontend/src/components/sales/Sales.jsx` | 5 |
| 590 | `frontend/src/components/sales/StatusBadge.jsx` | 2 |
| 591 | `frontend/src/components/server/ServerPage.jsx` | 12 |
| 592 | `frontend/src/components/shared/ImageGalleryLightbox.jsx` | 5 |
| 593 | `frontend/src/components/shared/Modal.jsx` | 1 |
| 594 | `frontend/src/components/shared/navigationConfig.js` | 2 |
| 595 | `frontend/src/components/shared/PageHelpButton.jsx` | 1 |
| 596 | `frontend/src/components/shared/pageHelpContent.js` | 1 |
| 597 | `frontend/src/components/shared/PortalMenu.jsx` | 4 |
| 598 | `frontend/src/components/users/PermissionEditor.jsx` | 4 |
| 599 | `frontend/src/components/users/UserDetailSheet.jsx` | 3 |
| 600 | `frontend/src/components/users/UserProfileModal.jsx` | 12 |
| 601 | `frontend/src/components/users/Users.jsx` | 16 |
| 602 | `frontend/src/components/utils-settings/AuditLog.jsx` | 11 |
| 603 | `frontend/src/components/utils-settings/Backup.jsx` | 37 |
| 604 | `frontend/src/components/utils-settings/FontFamilyPicker.jsx` | 1 |
| 605 | `frontend/src/components/utils-settings/index.js` | 0 |
| 606 | `frontend/src/components/utils-settings/OtpModal.jsx` | 3 |
| 607 | `frontend/src/components/utils-settings/ResetData.jsx` | 8 |
| 608 | `frontend/src/components/utils-settings/Settings.jsx` | 16 |
| 609 | `frontend/src/constants.js` | 3 |
| 610 | `frontend/src/index.jsx` | 4 |
| 611 | `frontend/src/utils/appRefresh.js` | 1 |
| 612 | `frontend/src/utils/csv.js` | 1 |
| 613 | `frontend/src/utils/dateHelpers.js` | 2 |
| 614 | `frontend/src/utils/deviceInfo.js` | 2 |
| 615 | `frontend/src/utils/favicon.js` | 3 |
| 616 | `frontend/src/utils/firebasePhoneAuth.js` | 4 |
| 617 | `frontend/src/utils/formatters.js` | 4 |
| 618 | `frontend/src/utils/index.js` | 0 |
| 619 | `frontend/src/utils/printReceipt.js` | 21 |
| 620 | `frontend/src/web-api.js` | 0 |
| 621 | `frontend/tailwind.config.js` | 0 |
| 622 | `frontend/tests/appShellUtils.test.mjs` | 1 |
| 623 | `frontend/tests/portalEditorUtils.test.mjs` | 1 |
| 624 | `frontend/vite.config.mjs` | 2 |
| 625 | `ops/scripts/backend/verify-data-integrity.js` | 10 |
| 626 | `ops/scripts/frontend/verify-i18n.js` | 5 |
| 627 | `ops/scripts/generate-doc-reference.js` | 18 |
| 628 | `ops/scripts/generate-full-project-docs.js` | 26 |
| 629 | `ops/scripts/lib/fs-utils.js` | 8 |
| 630 | `ops/scripts/performance-scan.js` | 3 |

## 3. Detailed Function Commentary

### 3.1 `backend/server.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadCompressionMiddleware` | function | 41 |
| 2 | `applySecurityHeaders` | function | 50 |
| 3 | `applyRequestPolicy` | function | 56 |
| 4 | `applyCoreMiddleware` | function | 66 |
| 5 | `mountStaticAssets` | function | 80 |
| 6 | `mountHealthRoute` | function | 94 |
| 7 | `mountApiRoutes` | function | 106 |
| 8 | `mountTransfersAlias` | function | 134 |
| 9 | `mountSpaFallback` | function | 149 |
| 10 | `mountErrorHandler` | function | 168 |
| 11 | `getStartupBanner` | function | 182 |
| 12 | `closeDatabase` | function | 202 |
| 13 | `registerShutdownHandlers` | function | 209 |
| 14 | `bootstrapServer` | function | 227 |

### 3.2 `backend/src/accessControl.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 19 |
| 2 | `normalizeHostname` | function | 23 |
| 3 | `getConfiguredSyncToken` | function | 29 |
| 4 | `getRequestHost` | function | 33 |
| 5 | `getRemoteAddress` | function | 39 |
| 6 | `isLoopbackAddress` | function | 47 |
| 7 | `getPresentedSyncToken` | function | 54 |
| 8 | `getTailscaleIdentity` | function | 60 |
| 9 | `hasTrustedTailscaleIdentity` | function | 69 |
| 10 | `isLocalHostRequest` | function | 76 |
| 11 | `isTsNetHost` | function | 81 |
| 12 | `getConfiguredTailscaleHost` | function | 86 |
| 13 | `isPublicRemoteRequest` | function | 90 |
| 14 | `isPublicApiRequest` | function | 98 |
| 15 | `classifyRequestAccess` | function | 104 |
| 16 | `authorizeProtectedRequest` | function | 132 |

### 3.3 `backend/src/backupSchema.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `countRowsByTable` | function | 61 |
| 2 | `countCustomTableRows` | function | 69 |
| 3 | `buildBackupSummary` | function | 75 |

### 3.4 `backend/src/config.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isDefaultDataMarker` | function | 42 |
| 2 | `resolveStoredDataDir` | function | 47 |
| 3 | `normalizeSelectedDataDir` | function | 54 |
| 4 | `readDataLocation` | function | 68 |
| 5 | `writeDataLocation` | function | 82 |

### 3.5 `backend/src/database.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `tableHasColumn` | function | 655 |
| 2 | `ensureColumn` | function | 665 |
| 3 | `normalizeUserPhoneLookup` | function | 677 |
| 4 | `slugifyOrgName` | function | 682 |
| 5 | `generateOrgPublicId` | function | 691 |
| 6 | `seedIfEmpty` | function | 785 |
| 7 | `ensureDefaultOrganizationAndGroup` | function | 796 |
| 8 | `ensurePrimaryAdminRoleAndUser` | function | 867 |

### 3.6 `backend/src/dataPath.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizePathForCompare` | function | 10 |
| 2 | `isSamePath` | function | 16 |
| 3 | `isSubPath` | function | 20 |
| 4 | `ensureDataRootLayout` | function | 25 |
| 5 | `walkFiles` | function | 30 |
| 6 | `summarizeDataRoot` | function | 48 |
| 7 | `copyDirectoryContents` | function | 89 |
| 8 | `buildArchivedTargetPath` | function | 126 |
| 9 | `relocateDataRoot` | function | 143 |

### 3.7 `backend/src/fileAssets.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ensureUploadsDirectory` | function | 43 |
| 2 | `getMimeTypeFromName` | function | 47 |
| 3 | `getMediaType` | function | 52 |
| 4 | `sanitizeOriginalFileName` | function | 61 |
| 5 | `preserveOriginalDisplayName` | function | 73 |
| 6 | `buildUniqueStoredName` | function | 80 |
| 7 | `shouldCompressImage` | function | 94 |
| 8 | `compressBufferForAsset` | function | 100 |
| 9 | `readImageDimensions` | function | 116 |
| 10 | `createFileAssetRecord` | function | 129 |
| 11 | `getFileAssetByPublicPath` | function | 189 |
| 12 | `listAssetRows` | function | 198 |
| 13 | `getUploadFilePath` | function | 220 |
| 14 | `collectUsage` | function | 225 |
| 15 | `serializeAssetRow` | function | 254 |
| 16 | `registerStoredAsset` | function | 264 |
| 17 | `registerUploadFromRequest` | function | 292 |
| 18 | `storeDataUrlAsset` | function | 304 |
| 19 | `backfillUploadAssets` | function | 326 |
| 20 | `listFileAssets` | function | 344 |
| 21 | `getFileAssetById` | function | 349 |
| 22 | `deleteFileAsset` | function | 354 |

### 3.8 `backend/src/helpers.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `logOp` | function | 21 |
| 2 | `getServerLog` | function | 26 |
| 3 | `ok` | function | 30 |
| 4 | `err` | function | 35 |
| 5 | `audit` | function | 50 |
| 6 | `broadcast` | function | 108 |
| 7 | `tryParse` | function | 121 |
| 8 | `today` | function | 126 |
| 9 | `bulkImportCSV` | function | 138 |
| 10 | `parseCSVLine` | function | 168 |
| 11 | `importRows` | function | 188 |
| 12 | `verifyAndRepairStockQuantities` | function | 203 |
| 13 | `verifyAndRepairSaleStatuses` | function | 272 |
| 14 | `verifyAndRepairCostPrices` | function | 332 |
| 15 | `runDataIntegrityCheck` | function | 402 |
| 16 | `getSafeCostPrice` | function | 429 |
| 17 | `calculateSaleProfit` | function | 440 |

### 3.9 `backend/src/middleware.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `authToken` | function | 16 |
| 2 | `networkAccessGuard` | function | 29 |
| 3 | `sanitiseFilename` | function | 34 |
| 4 | `resolveExtension` | function | 66 |
| 5 | `compressibleImageFormat` | function | 78 |
| 6 | `compressImageFile` | function | 83 |
| 7 | `compressImageBuffer` | function | 105 |
| 8 | `getClientKey` | function | 127 |
| 9 | `routeRateLimit` | function | 133 |
| 10 | `createStorage` | function | 145 |
| 11 | `buildUpload` | function | 161 |
| 12 | `compressUpload` | function | 193 |
| 13 | `validateUploadedFile` | function | 198 |
| 14 | `validateUploadBufferPayload` | function | 209 |

### 3.10 `backend/src/netSecurity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 26 |
| 2 | `normalizeHostname` | function | 30 |
| 3 | `isPrivateIpv4` | function | 34 |
| 4 | `isPrivateIpv6` | function | 47 |
| 5 | `isBlockedHostname` | function | 58 |
| 6 | `assertSafeOutboundUrl` | function | 69 |
| 7 | `isSafeExternalImageReference` | function | 97 |

### 3.11 `backend/src/organizationContext.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 9 |
| 2 | `slugify` | function | 13 |
| 3 | `generateOrganizationPublicId` | function | 21 |
| 4 | `getDefaultOrganization` | function | 25 |
| 5 | `getOrganizationById` | function | 34 |
| 6 | `findOrganizationByLookup` | function | 43 |
| 7 | `searchOrganizations` | function | 58 |
| 8 | `getOrganizationGroup` | function | 91 |
| 9 | `getDefaultOrganizationGroup` | function | 101 |
| 10 | `getOrganizationContextForUser` | function | 113 |
| 11 | `getPortalPublicPath` | function | 131 |
| 12 | `ensureOrganizationFilesystemLayout` | function | 136 |

### 3.12 `backend/src/portalUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toTrimmedString` | function | 5 |
| 2 | `safeJsonParse` | function | 9 |
| 3 | `createAboutBlock` | function | 17 |
| 4 | `normalizeAboutBlocks` | function | 28 |
| 5 | `extractGoogleMapsEmbedUrl` | function | 47 |
| 6 | `normalizeGoogleMapsEmbed` | function | 55 |

### 3.13 `backend/src/requestContext.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cleanText` | function | 7 |
| 2 | `readHeader` | function | 13 |
| 3 | `extractRequestMeta` | function | 19 |
| 4 | `requestContextMiddleware` | function | 45 |
| 5 | `getRequestMeta` | function | 50 |

### 3.14 `backend/src/routes/ai.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getActor` | function | 18 |
| 2 | `listProviders` | function | 25 |
| 3 | `getProviderRow` | function | 34 |

### 3.15 `backend/src/routes/auth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getClientKey` | function | 71 |
| 2 | `applyRateLimit` | function | 84 |
| 3 | `getLoginLockKey` | function | 96 |
| 4 | `normalizeLookupText` | function | 100 |
| 5 | `loginIdentifierPreview` | function | 107 |
| 6 | `rejectLogin` | function | 121 |
| 7 | `getOtpSecret` | function | 143 |
| 8 | `buildUserPayload` | function | 152 |
| 9 | `resolveOrganizationLookup` | function | 184 |
| 10 | `findUserByIdentifier` | function | 190 |
| 11 | `getExactActiveUserById` | function | 259 |
| 12 | `normalizeOauthMode` | function | 274 |
| 13 | `isEmailIdentifier` | function | 279 |
| 14 | `getUserById` | function | 283 |
| 15 | `generateTemporaryAuthPassword` | function | 287 |
| 16 | `issueAuthSession` | function | 291 |
| 17 | `updateLocalUserSupabaseIdentity` | function | 302 |

### 3.16 `backend/src/routes/branches.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toDbBool` | function | 9 |

### 3.17 `backend/src/routes/catalog.js`

- No top-level named symbols detected.

### 3.18 `backend/src/routes/categories.js`

- No top-level named symbols detected.

### 3.19 `backend/src/routes/contacts.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cleanMembershipNumber` | function | 9 |
| 2 | `assertUniqueMembershipNumber` | function | 14 |
| 3 | `normalizeConflictMode` | function | 28 |
| 4 | `toNumber` | function | 33 |
| 5 | `loadPointPolicy` | function | 38 |
| 6 | `calculatePolicyPoints` | function | 64 |
| 7 | `findExisting` | const arrow | 201 |
| 8 | `findExisting` | const arrow | 353 |
| 9 | `findExisting` | const arrow | 502 |

### 3.20 `backend/src/routes/customTables.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `humanizeTableName` | function | 9 |
| 2 | `serializeCustomTable` | function | 18 |

### 3.21 `backend/src/routes/files.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getActor` | function | 14 |
| 2 | `getDeviceMeta` | function | 21 |

### 3.22 `backend/src/routes/inventory.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBranchQty` | const arrow | 33 |

### 3.23 `backend/src/routes/organizations.js`

- No top-level named symbols detected.

### 3.24 `backend/src/routes/portal.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toNumber` | function | 22 |
| 2 | `normalizeBoolean` | function | 28 |
| 3 | `normalizePhone` | function | 34 |
| 4 | `normalizePublicPath` | function | 39 |
| 5 | `normalizeUrl` | function | 53 |
| 6 | `normalizeRedeemValueUsd` | function | 68 |
| 7 | `normalizeRedeemValueKhr` | function | 73 |
| 8 | `normalizeHexColor` | function | 80 |
| 9 | `normalizeFaqItems` | function | 86 |
| 10 | `loadSettingsMap` | function | 100 |
| 11 | `buildPortalConfig` | function | 108 |
| 12 | `calculatePointsValue` | function | 226 |
| 13 | `summarizePoints` | function | 236 |
| 14 | `getPortalProducts` | function | 276 |
| 15 | `findCustomerByMembership` | function | 333 |
| 16 | `sanitizeScreenshots` | function | 343 |
| 17 | `materializePortalScreenshots` | function | 352 |
| 18 | `sanitizeAiProfile` | function | 370 |
| 19 | `getVisitorFingerprint` | function | 382 |
| 20 | `getClientKey` | function | 388 |
| 21 | `applyPortalRateLimit` | function | 393 |

### 3.25 `backend/src/routes/products.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getActiveBranches` | function | 14 |
| 2 | `getDefaultBranch` | function | 18 |
| 3 | `seedBranchRows` | function | 22 |
| 4 | `recalcProductStock` | function | 27 |
| 5 | `normalizeImageGallery` | function | 36 |
| 6 | `syncProductImageGallery` | function | 53 |
| 7 | `loadProductImageMap` | function | 71 |
| 8 | `attachImageGallery` | function | 89 |
| 9 | `assertUniqueProductFields` | function | 101 |
| 10 | `resolveImage` | const arrow | 493 |
| 11 | `determineBranch` | const arrow | 509 |
| 12 | `handleBranch` | const arrow | 524 |
| 13 | `isDirectImageRef` | const arrow | 548 |
| 14 | `normalizeDirectImageRef` | const arrow | 559 |
| 15 | `parseIncomingImageRefs` | const arrow | 566 |
| 16 | `normalizeImageConflictMode` | const arrow | 599 |
| 17 | `loadCurrentGallery` | const arrow | 609 |

### 3.26 `backend/src/routes/returns.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeScope` | function | 11 |
| 2 | `toNumber` | function | 19 |
| 3 | `assertReturnableItems` | function | 24 |
| 4 | `assertSupplierReturnableStock` | function | 315 |

### 3.27 `backend/src/routes/sales.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSaleItemCosts` | function | 9 |
| 2 | `assertSaleStockAvailable` | function | 35 |
| 3 | `findCustomerForSaleAssignment` | function | 64 |
| 4 | `parseBranchId` | function | 85 |
| 5 | `getActiveBranchContext` | function | 90 |
| 6 | `requireActiveBranch` | function | 105 |
| 7 | `resolveSaleItemBranchId` | function | 112 |
| 8 | `normalizeSaleItems` | function | 123 |
| 9 | `summarizeSaleBranch` | function | 153 |
| 10 | `refreshProductStockQuantity` | function | 177 |
| 11 | `refreshProductStockQuantities` | function | 190 |
| 12 | `fetchSaleItemsWithBranches` | function | 197 |

### 3.28 `backend/src/routes/settings.js`

- No top-level named symbols detected.

### 3.29 `backend/src/routes/system.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `q` | function | 59 |
| 2 | `getClientKey` | function | 63 |
| 3 | `applyRouteRateLimit` | function | 69 |
| 4 | `runFsWorker` | function | 81 |
| 5 | `finish` | const arrow | 93 |
| 6 | `getHostUiAvailability` | function | 137 |
| 7 | `buildRequestBaseUrl` | function | 146 |
| 8 | `getTableColumns` | function | 153 |
| 9 | `extractUploadPathsFromText` | function | 157 |
| 10 | `collectBackupUploads` | function | 166 |
| 11 | `addUpload` | const arrow | 170 |
| 12 | `restoreBackupUploads` | function | 200 |
| 13 | `deleteAllUploads` | function | 210 |
| 14 | `getBackupDataRootCandidate` | function | 219 |
| 15 | `readBackupTablesFromDataRoot` | function | 231 |
| 16 | `restoreUploadsFromDataRoot` | function | 264 |
| 17 | `restoreSnapshotTables` | function | 278 |
| 18 | `ensurePrimaryAdminRoleAndUser` | function | 330 |
| 19 | `replaceTableRows` | function | 395 |
| 20 | `normaliseBackupTables` | function | 430 |
| 21 | `normaliseBackupCustomTableRows` | function | 459 |
| 22 | `repairRelationalConsistency` | function | 464 |
| 23 | `getCustomTableNames` | function | 472 |
| 24 | `parseCustomTableDefinition` | function | 478 |
| 25 | `recreateCustomTable` | function | 521 |
| 26 | `listWindowsFsRoots` | const arrow | 1061 |
| 27 | `listDriveRoots` | const arrow | 1078 |

### 3.30 `backend/src/routes/units.js`

- No top-level named symbols detected.

### 3.31 `backend/src/routes/users.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getClientKey` | function | 47 |
| 2 | `parseJson` | function | 53 |
| 3 | `normalizeLookupText` | function | 61 |
| 4 | `normalizePhoneLookup` | function | 65 |
| 5 | `findUserIdentityConflict` | function | 69 |
| 6 | `getMergedPermissions` | function | 137 |
| 7 | `isPrimaryAdmin` | function | 146 |
| 8 | `hasAdminControl` | function | 153 |
| 9 | `canManageTarget` | function | 166 |
| 10 | `getActorFromRequest` | function | 179 |
| 11 | `requireAdminControl` | function | 186 |
| 12 | `getUserSecurityContext` | function | 199 |
| 13 | `getUserWithRole` | function | 209 |
| 14 | `syncLocalEmailVerification` | function | 224 |
| 15 | `repairSupabaseIdentityForUser` | function | 255 |
| 16 | `sanitizeUserRow` | function | 284 |
| 17 | `isValidEmail` | function | 300 |
| 18 | `getAuthIdentityList` | function | 305 |
| 19 | `buildAuthMethodsPayload` | function | 309 |

### 3.32 `backend/src/security.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeEncryptionKey` | function | 9 |
| 2 | `isEncryptionConfigured` | function | 29 |
| 3 | `encryptSecret` | function | 33 |
| 4 | `decryptSecret` | function | 46 |
| 5 | `pruneRateBucket` | function | 67 |
| 6 | `checkRateLimit` | function | 79 |
| 7 | `resetRateLimit` | function | 108 |
| 8 | `safeCompare` | function | 115 |
| 9 | `getAbuseBucket` | function | 126 |
| 10 | `pruneAbuseBucket` | function | 136 |
| 11 | `checkAbuseLock` | function | 148 |
| 12 | `recordAbuseFailure` | function | 165 |
| 13 | `clearAbuseFailure` | function | 189 |

### 3.33 `backend/src/serverUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sanitizeObjectKeys` | function | 27 |
| 2 | `sanitizeStringValue` | function | 46 |
| 3 | `sanitizeRequestPayload` | function | 52 |
| 4 | `sanitizeDeepStrings` | function | 59 |
| 5 | `isApiOrHealthPath` | function | 76 |
| 6 | `isSpaFallbackEligible` | function | 80 |
| 7 | `setNoStoreHeaders` | function | 88 |
| 8 | `setHtmlNoCacheHeaders` | function | 92 |
| 9 | `setTunnelSecurityHeaders` | function | 98 |
| 10 | `setFrontendStaticHeaders` | function | 131 |
| 11 | `setUploadStaticHeaders` | function | 149 |
| 12 | `mapServerError` | function | 156 |

### 3.34 `backend/src/services/aiGateway.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 6 |
| 2 | `trim` | function | 10 |
| 3 | `parseJsonSafe` | function | 14 |
| 4 | `clamp` | function | 22 |
| 5 | `maskApiKey` | function | 26 |
| 6 | `getProviderMeta` | function | 96 |
| 7 | `normalizeProviderPayload` | function | 100 |
| 8 | `serializeProviderRow` | function | 132 |
| 9 | `providerCanUseWebResearch` | function | 165 |
| 10 | `resolveProviderEndpoint` | function | 170 |
| 11 | `callChatProvider` | function | 177 |
| 12 | `testProviderConfig` | function | 269 |

### 3.35 `backend/src/services/firebaseAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `truthy` | function | 16 |
| 2 | `trim` | function | 20 |
| 3 | `normalizePrivateKey` | function | 24 |
| 4 | `parseJsonSafe` | function | 28 |
| 5 | `loadServiceAccount` | function | 36 |
| 6 | `isFirebaseAuthConfigured` | function | 85 |
| 7 | `isFirebasePhoneVerificationConfigured` | function | 89 |
| 8 | `hasFirebaseAdminCredentials` | function | 93 |
| 9 | `base64Url` | function | 97 |
| 10 | `buildGoogleServiceJwt` | function | 106 |
| 11 | `getGoogleAccessToken` | function | 136 |
| 12 | `normalizeProviderError` | function | 172 |
| 13 | `parseResponseData` | function | 189 |
| 14 | `callFirebasePublic` | function | 193 |
| 15 | `callFirebaseAdmin` | function | 222 |
| 16 | `normalizeEmail` | function | 257 |
| 17 | `normalizeE164` | function | 262 |
| 18 | `getFirebaseAuthPublicConfig` | function | 270 |
| 19 | `createOrUpdateAuthUser` | function | 282 |
| 20 | `updateAuthPassword` | function | 323 |
| 21 | `setAuthUserActive` | function | 342 |
| 22 | `verifyPasswordWithFirebase` | function | 355 |

### 3.36 `backend/src/services/googleDriveSync.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 45 |
| 2 | `trim` | function | 49 |
| 3 | `toBool` | function | 53 |
| 4 | `clamp` | function | 61 |
| 5 | `escapeDriveQueryValue` | function | 67 |
| 6 | `readSettingsMap` | function | 71 |
| 7 | `writeSettingsMap` | function | 81 |
| 8 | `clearDriveSyncMappings` | function | 99 |
| 9 | `resetDriveSyncRootState` | function | 103 |
| 10 | `getDriveSyncConfig` | function | 110 |
| 11 | `getDriveSyncEntriesMap` | function | 131 |
| 12 | `upsertDriveSyncEntry` | function | 142 |
| 13 | `deleteDriveSyncEntry` | function | 168 |
| 14 | `deleteDriveSyncEntriesUnder` | function | 172 |
| 15 | `inferMimeType` | function | 179 |
| 16 | `md5File` | function | 194 |
| 17 | `buildMultipartBody` | function | 200 |
| 18 | `exchangeRefreshToken` | function | 217 |
| 19 | `exchangeAuthorizationCode` | function | 236 |
| 20 | `driveApiRequest` | function | 259 |
| 21 | `driveApiUpload` | function | 276 |
| 22 | `fetchDriveUserProfile` | function | 292 |
| 23 | `findDriveItem` | function | 307 |
| 24 | `findDriveItems` | function | 312 |
| 25 | `listDriveChildren` | function | 327 |
| 26 | `getDriveFileIfExists` | function | 336 |
| 27 | `removeDuplicateDriveItems` | function | 348 |
| 28 | `createDriveFolder` | function | 360 |
| 29 | `ensureRootFolder` | function | 372 |
| 30 | `ensureSnapshotLayout` | function | 391 |
| 31 | `shouldSkipSnapshotFile` | function | 397 |
| 32 | `createDataRootSnapshot` | function | 402 |
| 33 | `collectSnapshotItems` | function | 432 |
| 34 | `ensureRemoteDirectories` | function | 461 |
| 35 | `uploadDriveFile` | function | 496 |
| 36 | `updateDriveFile` | function | 511 |
| 37 | `removeDriveFile` | function | 522 |
| 38 | `runDriveSync` | function | 534 |
| 39 | `scheduleDriveSync` | function | 689 |
| 40 | `getDriveSyncStatus` | function | 712 |
| 41 | `beginGoogleDriveOAuth` | function | 743 |
| 42 | `prunePendingOauthStates` | function | 762 |
| 43 | `finalizeGoogleDriveOAuth` | function | 769 |
| 44 | `saveDriveSyncPreferences` | function | 811 |
| 45 | `disconnectDriveSync` | function | 830 |
| 46 | `schedulePeriodicDriveSync` | function | 848 |

### 3.37 `backend/src/services/portalAi.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 15 |
| 2 | `toNumber` | function | 19 |
| 3 | `tokenize` | function | 24 |
| 4 | `nowMs` | function | 32 |
| 5 | `getProviderPriority` | function | 36 |
| 6 | `getProviderCapacity` | function | 41 |
| 7 | `getProviderMaxInputChars` | function | 46 |
| 8 | `getProviderMaxCompletionTokens` | function | 51 |
| 9 | `getProviderTimeoutMs` | function | 56 |
| 10 | `getProviderCooldownMs` | function | 61 |
| 11 | `getRuntimeState` | function | 67 |
| 12 | `pruneProviderState` | function | 82 |
| 13 | `pruneVisitorActivity` | function | 88 |
| 14 | `registerVisitorActivity` | function | 96 |
| 15 | `countActiveVisitors` | function | 106 |
| 16 | `getVisitorMinuteCount` | function | 111 |
| 17 | `summarizeProfile` | function | 118 |
| 18 | `sanitizeQuestion` | function | 128 |
| 19 | `scoreProduct` | function | 132 |
| 20 | `selectCandidateProducts` | function | 164 |
| 21 | `buildPrompt` | function | 196 |
| 22 | `parseAssistantPayload` | function | 221 |
| 23 | `listEnabledChatProviders` | function | 287 |
| 24 | `chooseProviderForAttempt` | function | 306 |
| 25 | `markProviderStart` | function | 327 |
| 26 | `markProviderSuccess` | function | 335 |
| 27 | `markProviderFailure` | function | 342 |
| 28 | `getPortalAiUsageStatus` | function | 350 |
| 29 | `generatePortalAiResponse` | function | 378 |

### 3.38 `backend/src/services/supabaseAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `truthy` | function | 13 |
| 2 | `trim` | function | 17 |
| 3 | `parseJsonSafe` | function | 21 |
| 4 | `normalizeSupabaseUrl` | function | 29 |
| 5 | `normalizeEmail` | function | 33 |
| 6 | `isPlainObject` | function | 38 |
| 7 | `clampPassword` | function | 42 |
| 8 | `isAllowedOauthProvider` | function | 46 |
| 9 | `isHttpUrl` | function | 50 |
| 10 | `isSupabaseAuthConfigured` | function | 64 |
| 11 | `hasSupabaseAdminCredentials` | function | 68 |
| 12 | `hasSupabasePublicCredentials` | function | 72 |
| 13 | `buildSupabaseUrl` | function | 76 |
| 14 | `normalizeRedirectTo` | function | 80 |
| 15 | `getSupabaseAuthPublicConfig` | function | 85 |
| 16 | `normalizeProviderError` | function | 101 |
| 17 | `parseResponseData` | function | 118 |
| 18 | `callSupabasePublic` | function | 126 |
| 19 | `callSupabaseAdmin` | function | 159 |
| 20 | `getBanDurationForActiveState` | function | 193 |
| 21 | `buildUserMetadata` | function | 197 |
| 22 | `buildAppMetadata` | function | 207 |
| 23 | `getIdentityProviders` | function | 216 |
| 24 | `summarizeAuthUser` | function | 237 |
| 25 | `isLocalUserActive` | function | 254 |
| 26 | `getAuthUserById` | function | 258 |
| 27 | `getAuthUserFromAccessToken` | function | 266 |
| 28 | `listAuthUsersPage` | function | 276 |
| 29 | `findAuthUserByEmail` | function | 295 |
| 30 | `createOrUpdateAuthUser` | function | 315 |
| 31 | `updateAuthPassword` | function | 365 |
| 32 | `setAuthUserActive` | function | 384 |
| 33 | `verifyPasswordWithSupabase` | function | 399 |
| 34 | `unlinkAuthIdentity` | function | 424 |
| 35 | `sendSupabaseVerificationEmail` | function | 438 |
| 36 | `sendSupabasePasswordRecoveryEmail` | function | 477 |
| 37 | `buildOauthStartUrl` | function | 501 |

### 3.39 `backend/src/services/verification.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowMs` | function | 8 |
| 2 | `toIso` | function | 12 |
| 3 | `parseBool` | function | 16 |
| 4 | `isEmailProviderConfigured` | function | 23 |
| 5 | `getVerificationCapabilities` | function | 30 |
| 6 | `normalizeEmail` | function | 37 |
| 7 | `normalizePhone` | function | 44 |
| 8 | `maskDestination` | function | 52 |
| 9 | `generateCode` | function | 65 |
| 10 | `hashCode` | function | 69 |
| 11 | `resolveChannel` | function | 73 |
| 12 | `getDestinationForChannel` | function | 83 |
| 13 | `cleanupExpiredCodes` | function | 88 |
| 14 | `invalidateActiveCodes` | function | 96 |
| 15 | `createVerificationRecord` | function | 109 |
| 16 | `findActiveCode` | function | 136 |
| 17 | `consumeCode` | function | 151 |
| 18 | `verifyCode` | function | 155 |
| 19 | `messageForPurpose` | function | 164 |
| 20 | `sendEmail` | function | 183 |
| 21 | `requestVerificationCode` | function | 247 |

### 3.40 `backend/src/sessionAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `hashToken` | function | 11 |
| 2 | `buildSessionExpiry` | function | 15 |
| 3 | `createAuthSession` | function | 25 |
| 4 | `getPresentedSessionToken` | function | 46 |
| 5 | `getSessionUser` | function | 70 |
| 6 | `revokeAuthSession` | function | 133 |

### 3.41 `backend/src/systemFsWorker.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatBackupStamp` | function | 15 |
| 2 | `pad` | const arrow | 17 |
| 3 | `respond` | function | 21 |
| 4 | `fail` | function | 25 |
| 5 | `runExportFolder` | function | 30 |
| 6 | `runRelocateDataRoot` | function | 70 |
| 7 | `main` | function | 77 |

### 3.42 `backend/src/uploadSecurity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `bufferStartsWith` | function | 11 |
| 2 | `isLikelyCsvBuffer` | function | 15 |
| 3 | `detectBufferKind` | function | 28 |
| 4 | `getExpectedUploadedKind` | function | 42 |
| 5 | `validateImageMetadata` | function | 51 |
| 6 | `validateUploadedBuffer` | function | 65 |
| 7 | `validateUploadedPath` | function | 76 |

### 3.43 `backend/src/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `attachWss` | function | 19 |

### 3.44 `backend/test/accessControl.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |
| 2 | `makeReq` | function | 22 |

### 3.45 `backend/test/backupRoundtrip.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 19 |
| 2 | `makeTempRoot` | function | 39 |
| 3 | `getFreePort` | function | 43 |
| 4 | `waitForHealth` | function | 54 |
| 5 | `startServer` | function | 66 |
| 6 | `stopServer` | function | 87 |
| 7 | `fetchJson` | function | 101 |
| 8 | `loginAsAdmin` | function | 115 |
| 9 | `uploadPortalLogo` | function | 132 |
| 10 | `seedSourceServer` | function | 143 |
| 11 | `exportBackup` | function | 249 |
| 12 | `assertRoundtripState` | function | 257 |

### 3.46 `backend/test/backupSchema.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.47 `backend/test/dataPath.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 16 |
| 2 | `makeTempRoot` | function | 27 |

### 3.48 `backend/test/netSecurity.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |

### 3.49 `backend/test/portalUtils.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.50 `backend/test/serverUtils.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.51 `backend/test/uploadSecurity.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |

### 3.52 `business-os-v1-centralized-org-path/backend/server.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadCompressionMiddleware` | function | 41 |
| 2 | `applySecurityHeaders` | function | 50 |
| 3 | `applyRequestPolicy` | function | 56 |
| 4 | `applyCoreMiddleware` | function | 66 |
| 5 | `mountStaticAssets` | function | 80 |
| 6 | `mountHealthRoute` | function | 94 |
| 7 | `mountApiRoutes` | function | 106 |
| 8 | `mountTransfersAlias` | function | 134 |
| 9 | `mountSpaFallback` | function | 149 |
| 10 | `mountErrorHandler` | function | 168 |
| 11 | `getStartupBanner` | function | 182 |
| 12 | `closeDatabase` | function | 202 |
| 13 | `registerShutdownHandlers` | function | 209 |
| 14 | `bootstrapServer` | function | 227 |

### 3.53 `business-os-v1-centralized-org-path/backend/src/accessControl.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 19 |
| 2 | `normalizeHostname` | function | 23 |
| 3 | `getConfiguredSyncToken` | function | 29 |
| 4 | `getRequestHost` | function | 33 |
| 5 | `getRemoteAddress` | function | 39 |
| 6 | `isLoopbackAddress` | function | 47 |
| 7 | `getPresentedSyncToken` | function | 54 |
| 8 | `getTailscaleIdentity` | function | 60 |
| 9 | `hasTrustedTailscaleIdentity` | function | 69 |
| 10 | `isLocalHostRequest` | function | 76 |
| 11 | `isTsNetHost` | function | 81 |
| 12 | `getConfiguredTailscaleHost` | function | 86 |
| 13 | `isPublicRemoteRequest` | function | 90 |
| 14 | `isPublicApiRequest` | function | 98 |
| 15 | `classifyRequestAccess` | function | 104 |
| 16 | `authorizeProtectedRequest` | function | 132 |

### 3.54 `business-os-v1-centralized-org-path/backend/src/backupSchema.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `countRowsByTable` | function | 61 |
| 2 | `countCustomTableRows` | function | 69 |
| 3 | `buildBackupSummary` | function | 75 |

### 3.55 `business-os-v1-centralized-org-path/backend/src/config.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isDefaultDataMarker` | function | 42 |
| 2 | `resolveStoredDataDir` | function | 47 |
| 3 | `normalizeSelectedDataDir` | function | 54 |
| 4 | `readDataLocation` | function | 68 |
| 5 | `writeDataLocation` | function | 82 |

### 3.56 `business-os-v1-centralized-org-path/backend/src/database.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `tableHasColumn` | function | 655 |
| 2 | `ensureColumn` | function | 665 |
| 3 | `normalizeUserPhoneLookup` | function | 677 |
| 4 | `slugifyOrgName` | function | 682 |
| 5 | `generateOrgPublicId` | function | 691 |
| 6 | `seedIfEmpty` | function | 785 |
| 7 | `ensureDefaultOrganizationAndGroup` | function | 796 |
| 8 | `ensurePrimaryAdminRoleAndUser` | function | 867 |

### 3.57 `business-os-v1-centralized-org-path/backend/src/dataPath.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizePathForCompare` | function | 10 |
| 2 | `isSamePath` | function | 16 |
| 3 | `isSubPath` | function | 20 |
| 4 | `ensureDataRootLayout` | function | 25 |
| 5 | `walkFiles` | function | 30 |
| 6 | `summarizeDataRoot` | function | 48 |
| 7 | `copyDirectoryContents` | function | 89 |
| 8 | `buildArchivedTargetPath` | function | 126 |
| 9 | `relocateDataRoot` | function | 143 |

### 3.58 `business-os-v1-centralized-org-path/backend/src/fileAssets.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ensureUploadsDirectory` | function | 43 |
| 2 | `getMimeTypeFromName` | function | 47 |
| 3 | `getMediaType` | function | 52 |
| 4 | `sanitizeOriginalFileName` | function | 61 |
| 5 | `preserveOriginalDisplayName` | function | 73 |
| 6 | `buildUniqueStoredName` | function | 80 |
| 7 | `shouldCompressImage` | function | 94 |
| 8 | `compressBufferForAsset` | function | 100 |
| 9 | `readImageDimensions` | function | 116 |
| 10 | `createFileAssetRecord` | function | 129 |
| 11 | `getFileAssetByPublicPath` | function | 189 |
| 12 | `listAssetRows` | function | 198 |
| 13 | `getUploadFilePath` | function | 220 |
| 14 | `collectUsage` | function | 225 |
| 15 | `serializeAssetRow` | function | 254 |
| 16 | `registerStoredAsset` | function | 264 |
| 17 | `registerUploadFromRequest` | function | 292 |
| 18 | `storeDataUrlAsset` | function | 304 |
| 19 | `backfillUploadAssets` | function | 326 |
| 20 | `listFileAssets` | function | 344 |
| 21 | `getFileAssetById` | function | 349 |
| 22 | `deleteFileAsset` | function | 354 |

### 3.59 `business-os-v1-centralized-org-path/backend/src/helpers.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `logOp` | function | 21 |
| 2 | `getServerLog` | function | 26 |
| 3 | `ok` | function | 30 |
| 4 | `err` | function | 35 |
| 5 | `audit` | function | 50 |
| 6 | `broadcast` | function | 108 |
| 7 | `tryParse` | function | 121 |
| 8 | `today` | function | 126 |
| 9 | `bulkImportCSV` | function | 138 |
| 10 | `parseCSVLine` | function | 168 |
| 11 | `importRows` | function | 188 |
| 12 | `verifyAndRepairStockQuantities` | function | 203 |
| 13 | `verifyAndRepairSaleStatuses` | function | 272 |
| 14 | `verifyAndRepairCostPrices` | function | 332 |
| 15 | `runDataIntegrityCheck` | function | 402 |
| 16 | `getSafeCostPrice` | function | 429 |
| 17 | `calculateSaleProfit` | function | 440 |

### 3.60 `business-os-v1-centralized-org-path/backend/src/middleware.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `authToken` | function | 16 |
| 2 | `networkAccessGuard` | function | 29 |
| 3 | `sanitiseFilename` | function | 34 |
| 4 | `resolveExtension` | function | 66 |
| 5 | `compressibleImageFormat` | function | 78 |
| 6 | `compressImageFile` | function | 83 |
| 7 | `compressImageBuffer` | function | 105 |
| 8 | `getClientKey` | function | 127 |
| 9 | `routeRateLimit` | function | 133 |
| 10 | `createStorage` | function | 145 |
| 11 | `buildUpload` | function | 161 |
| 12 | `compressUpload` | function | 193 |
| 13 | `validateUploadedFile` | function | 198 |
| 14 | `validateUploadBufferPayload` | function | 209 |

### 3.61 `business-os-v1-centralized-org-path/backend/src/netSecurity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 26 |
| 2 | `normalizeHostname` | function | 30 |
| 3 | `isPrivateIpv4` | function | 34 |
| 4 | `isPrivateIpv6` | function | 47 |
| 5 | `isBlockedHostname` | function | 58 |
| 6 | `assertSafeOutboundUrl` | function | 69 |
| 7 | `isSafeExternalImageReference` | function | 97 |

### 3.62 `business-os-v1-centralized-org-path/backend/src/organizationContext.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 9 |
| 2 | `slugify` | function | 13 |
| 3 | `generateOrganizationPublicId` | function | 21 |
| 4 | `getDefaultOrganization` | function | 25 |
| 5 | `getOrganizationById` | function | 34 |
| 6 | `findOrganizationByLookup` | function | 43 |
| 7 | `searchOrganizations` | function | 58 |
| 8 | `getOrganizationGroup` | function | 91 |
| 9 | `getDefaultOrganizationGroup` | function | 101 |
| 10 | `getOrganizationContextForUser` | function | 113 |
| 11 | `getPortalPublicPath` | function | 131 |
| 12 | `ensureOrganizationFilesystemLayout` | function | 136 |

### 3.63 `business-os-v1-centralized-org-path/backend/src/portalUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toTrimmedString` | function | 5 |
| 2 | `safeJsonParse` | function | 9 |
| 3 | `createAboutBlock` | function | 17 |
| 4 | `normalizeAboutBlocks` | function | 28 |
| 5 | `extractGoogleMapsEmbedUrl` | function | 47 |
| 6 | `normalizeGoogleMapsEmbed` | function | 55 |

### 3.64 `business-os-v1-centralized-org-path/backend/src/requestContext.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cleanText` | function | 7 |
| 2 | `readHeader` | function | 13 |
| 3 | `extractRequestMeta` | function | 19 |
| 4 | `requestContextMiddleware` | function | 45 |
| 5 | `getRequestMeta` | function | 50 |

### 3.65 `business-os-v1-centralized-org-path/backend/src/routes/ai.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getActor` | function | 18 |
| 2 | `listProviders` | function | 25 |
| 3 | `getProviderRow` | function | 34 |

### 3.66 `business-os-v1-centralized-org-path/backend/src/routes/auth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getClientKey` | function | 71 |
| 2 | `applyRateLimit` | function | 84 |
| 3 | `getLoginLockKey` | function | 96 |
| 4 | `normalizeLookupText` | function | 100 |
| 5 | `loginIdentifierPreview` | function | 107 |
| 6 | `rejectLogin` | function | 121 |
| 7 | `getOtpSecret` | function | 143 |
| 8 | `buildUserPayload` | function | 152 |
| 9 | `resolveOrganizationLookup` | function | 184 |
| 10 | `findUserByIdentifier` | function | 190 |
| 11 | `getExactActiveUserById` | function | 259 |
| 12 | `normalizeOauthMode` | function | 274 |
| 13 | `isEmailIdentifier` | function | 279 |
| 14 | `getUserById` | function | 283 |
| 15 | `generateTemporaryAuthPassword` | function | 287 |
| 16 | `issueAuthSession` | function | 291 |
| 17 | `updateLocalUserSupabaseIdentity` | function | 302 |

### 3.67 `business-os-v1-centralized-org-path/backend/src/routes/branches.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toDbBool` | function | 9 |

### 3.68 `business-os-v1-centralized-org-path/backend/src/routes/catalog.js`

- No top-level named symbols detected.

### 3.69 `business-os-v1-centralized-org-path/backend/src/routes/categories.js`

- No top-level named symbols detected.

### 3.70 `business-os-v1-centralized-org-path/backend/src/routes/contacts.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cleanMembershipNumber` | function | 9 |
| 2 | `assertUniqueMembershipNumber` | function | 14 |
| 3 | `normalizeConflictMode` | function | 28 |
| 4 | `toNumber` | function | 33 |
| 5 | `loadPointPolicy` | function | 38 |
| 6 | `calculatePolicyPoints` | function | 64 |
| 7 | `findExisting` | const arrow | 201 |
| 8 | `findExisting` | const arrow | 353 |
| 9 | `findExisting` | const arrow | 502 |

### 3.71 `business-os-v1-centralized-org-path/backend/src/routes/customTables.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `humanizeTableName` | function | 9 |
| 2 | `serializeCustomTable` | function | 18 |

### 3.72 `business-os-v1-centralized-org-path/backend/src/routes/files.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getActor` | function | 14 |
| 2 | `getDeviceMeta` | function | 21 |

### 3.73 `business-os-v1-centralized-org-path/backend/src/routes/inventory.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBranchQty` | const arrow | 33 |

### 3.74 `business-os-v1-centralized-org-path/backend/src/routes/organizations.js`

- No top-level named symbols detected.

### 3.75 `business-os-v1-centralized-org-path/backend/src/routes/portal.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toNumber` | function | 22 |
| 2 | `normalizeBoolean` | function | 28 |
| 3 | `normalizePhone` | function | 34 |
| 4 | `normalizePublicPath` | function | 39 |
| 5 | `normalizeUrl` | function | 53 |
| 6 | `normalizeRedeemValueUsd` | function | 68 |
| 7 | `normalizeRedeemValueKhr` | function | 73 |
| 8 | `normalizeHexColor` | function | 80 |
| 9 | `normalizeFaqItems` | function | 86 |
| 10 | `loadSettingsMap` | function | 100 |
| 11 | `buildPortalConfig` | function | 108 |
| 12 | `calculatePointsValue` | function | 226 |
| 13 | `summarizePoints` | function | 236 |
| 14 | `getPortalProducts` | function | 276 |
| 15 | `findCustomerByMembership` | function | 333 |
| 16 | `sanitizeScreenshots` | function | 343 |
| 17 | `materializePortalScreenshots` | function | 352 |
| 18 | `sanitizeAiProfile` | function | 370 |
| 19 | `getVisitorFingerprint` | function | 382 |
| 20 | `getClientKey` | function | 388 |
| 21 | `applyPortalRateLimit` | function | 393 |

### 3.76 `business-os-v1-centralized-org-path/backend/src/routes/products.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getActiveBranches` | function | 14 |
| 2 | `getDefaultBranch` | function | 18 |
| 3 | `seedBranchRows` | function | 22 |
| 4 | `recalcProductStock` | function | 27 |
| 5 | `normalizeImageGallery` | function | 36 |
| 6 | `syncProductImageGallery` | function | 53 |
| 7 | `loadProductImageMap` | function | 71 |
| 8 | `attachImageGallery` | function | 89 |
| 9 | `assertUniqueProductFields` | function | 101 |
| 10 | `resolveImage` | const arrow | 493 |
| 11 | `determineBranch` | const arrow | 509 |
| 12 | `handleBranch` | const arrow | 524 |
| 13 | `isDirectImageRef` | const arrow | 548 |
| 14 | `normalizeDirectImageRef` | const arrow | 559 |
| 15 | `parseIncomingImageRefs` | const arrow | 566 |
| 16 | `normalizeImageConflictMode` | const arrow | 599 |
| 17 | `loadCurrentGallery` | const arrow | 609 |

### 3.77 `business-os-v1-centralized-org-path/backend/src/routes/returns.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeScope` | function | 11 |
| 2 | `toNumber` | function | 19 |
| 3 | `assertReturnableItems` | function | 24 |
| 4 | `assertSupplierReturnableStock` | function | 315 |

### 3.78 `business-os-v1-centralized-org-path/backend/src/routes/sales.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSaleItemCosts` | function | 9 |
| 2 | `assertSaleStockAvailable` | function | 35 |
| 3 | `findCustomerForSaleAssignment` | function | 64 |
| 4 | `parseBranchId` | function | 85 |
| 5 | `getActiveBranchContext` | function | 90 |
| 6 | `requireActiveBranch` | function | 105 |
| 7 | `resolveSaleItemBranchId` | function | 112 |
| 8 | `normalizeSaleItems` | function | 123 |
| 9 | `summarizeSaleBranch` | function | 153 |
| 10 | `refreshProductStockQuantity` | function | 177 |
| 11 | `refreshProductStockQuantities` | function | 190 |
| 12 | `fetchSaleItemsWithBranches` | function | 197 |

### 3.79 `business-os-v1-centralized-org-path/backend/src/routes/settings.js`

- No top-level named symbols detected.

### 3.80 `business-os-v1-centralized-org-path/backend/src/routes/system.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `q` | function | 59 |
| 2 | `getClientKey` | function | 63 |
| 3 | `applyRouteRateLimit` | function | 69 |
| 4 | `runFsWorker` | function | 81 |
| 5 | `finish` | const arrow | 93 |
| 6 | `getHostUiAvailability` | function | 137 |
| 7 | `buildRequestBaseUrl` | function | 146 |
| 8 | `getTableColumns` | function | 153 |
| 9 | `extractUploadPathsFromText` | function | 157 |
| 10 | `collectBackupUploads` | function | 166 |
| 11 | `addUpload` | const arrow | 170 |
| 12 | `restoreBackupUploads` | function | 200 |
| 13 | `deleteAllUploads` | function | 210 |
| 14 | `getBackupDataRootCandidate` | function | 219 |
| 15 | `readBackupTablesFromDataRoot` | function | 231 |
| 16 | `restoreUploadsFromDataRoot` | function | 264 |
| 17 | `restoreSnapshotTables` | function | 278 |
| 18 | `ensurePrimaryAdminRoleAndUser` | function | 330 |
| 19 | `replaceTableRows` | function | 395 |
| 20 | `normaliseBackupTables` | function | 430 |
| 21 | `normaliseBackupCustomTableRows` | function | 459 |
| 22 | `repairRelationalConsistency` | function | 464 |
| 23 | `getCustomTableNames` | function | 472 |
| 24 | `parseCustomTableDefinition` | function | 478 |
| 25 | `recreateCustomTable` | function | 521 |
| 26 | `listWindowsFsRoots` | const arrow | 1061 |
| 27 | `listDriveRoots` | const arrow | 1078 |

### 3.81 `business-os-v1-centralized-org-path/backend/src/routes/units.js`

- No top-level named symbols detected.

### 3.82 `business-os-v1-centralized-org-path/backend/src/routes/users.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getClientKey` | function | 47 |
| 2 | `parseJson` | function | 53 |
| 3 | `normalizeLookupText` | function | 61 |
| 4 | `normalizePhoneLookup` | function | 65 |
| 5 | `findUserIdentityConflict` | function | 69 |
| 6 | `getMergedPermissions` | function | 137 |
| 7 | `isPrimaryAdmin` | function | 146 |
| 8 | `hasAdminControl` | function | 153 |
| 9 | `canManageTarget` | function | 166 |
| 10 | `getActorFromRequest` | function | 179 |
| 11 | `requireAdminControl` | function | 186 |
| 12 | `getUserSecurityContext` | function | 199 |
| 13 | `getUserWithRole` | function | 209 |
| 14 | `syncLocalEmailVerification` | function | 224 |
| 15 | `repairSupabaseIdentityForUser` | function | 255 |
| 16 | `sanitizeUserRow` | function | 284 |
| 17 | `isValidEmail` | function | 300 |
| 18 | `getAuthIdentityList` | function | 305 |
| 19 | `buildAuthMethodsPayload` | function | 309 |

### 3.83 `business-os-v1-centralized-org-path/backend/src/security.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeEncryptionKey` | function | 9 |
| 2 | `isEncryptionConfigured` | function | 29 |
| 3 | `encryptSecret` | function | 33 |
| 4 | `decryptSecret` | function | 46 |
| 5 | `pruneRateBucket` | function | 67 |
| 6 | `checkRateLimit` | function | 79 |
| 7 | `resetRateLimit` | function | 108 |
| 8 | `safeCompare` | function | 115 |
| 9 | `getAbuseBucket` | function | 126 |
| 10 | `pruneAbuseBucket` | function | 136 |
| 11 | `checkAbuseLock` | function | 148 |
| 12 | `recordAbuseFailure` | function | 165 |
| 13 | `clearAbuseFailure` | function | 189 |

### 3.84 `business-os-v1-centralized-org-path/backend/src/serverUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sanitizeObjectKeys` | function | 27 |
| 2 | `sanitizeStringValue` | function | 46 |
| 3 | `sanitizeRequestPayload` | function | 52 |
| 4 | `sanitizeDeepStrings` | function | 59 |
| 5 | `isApiOrHealthPath` | function | 76 |
| 6 | `isSpaFallbackEligible` | function | 80 |
| 7 | `setNoStoreHeaders` | function | 88 |
| 8 | `setHtmlNoCacheHeaders` | function | 92 |
| 9 | `setTunnelSecurityHeaders` | function | 98 |
| 10 | `setFrontendStaticHeaders` | function | 131 |
| 11 | `setUploadStaticHeaders` | function | 149 |
| 12 | `mapServerError` | function | 156 |

### 3.85 `business-os-v1-centralized-org-path/backend/src/services/aiGateway.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 6 |
| 2 | `trim` | function | 10 |
| 3 | `parseJsonSafe` | function | 14 |
| 4 | `clamp` | function | 22 |
| 5 | `maskApiKey` | function | 26 |
| 6 | `getProviderMeta` | function | 96 |
| 7 | `normalizeProviderPayload` | function | 100 |
| 8 | `serializeProviderRow` | function | 132 |
| 9 | `providerCanUseWebResearch` | function | 165 |
| 10 | `resolveProviderEndpoint` | function | 170 |
| 11 | `callChatProvider` | function | 177 |
| 12 | `testProviderConfig` | function | 269 |

### 3.86 `business-os-v1-centralized-org-path/backend/src/services/firebaseAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `truthy` | function | 16 |
| 2 | `trim` | function | 20 |
| 3 | `normalizePrivateKey` | function | 24 |
| 4 | `parseJsonSafe` | function | 28 |
| 5 | `loadServiceAccount` | function | 36 |
| 6 | `isFirebaseAuthConfigured` | function | 85 |
| 7 | `isFirebasePhoneVerificationConfigured` | function | 89 |
| 8 | `hasFirebaseAdminCredentials` | function | 93 |
| 9 | `base64Url` | function | 97 |
| 10 | `buildGoogleServiceJwt` | function | 106 |
| 11 | `getGoogleAccessToken` | function | 136 |
| 12 | `normalizeProviderError` | function | 172 |
| 13 | `parseResponseData` | function | 189 |
| 14 | `callFirebasePublic` | function | 193 |
| 15 | `callFirebaseAdmin` | function | 222 |
| 16 | `normalizeEmail` | function | 257 |
| 17 | `normalizeE164` | function | 262 |
| 18 | `getFirebaseAuthPublicConfig` | function | 270 |
| 19 | `createOrUpdateAuthUser` | function | 282 |
| 20 | `updateAuthPassword` | function | 323 |
| 21 | `setAuthUserActive` | function | 342 |
| 22 | `verifyPasswordWithFirebase` | function | 355 |

### 3.87 `business-os-v1-centralized-org-path/backend/src/services/googleDriveSync.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 45 |
| 2 | `trim` | function | 49 |
| 3 | `toBool` | function | 53 |
| 4 | `clamp` | function | 61 |
| 5 | `escapeDriveQueryValue` | function | 67 |
| 6 | `readSettingsMap` | function | 71 |
| 7 | `writeSettingsMap` | function | 81 |
| 8 | `clearDriveSyncMappings` | function | 99 |
| 9 | `resetDriveSyncRootState` | function | 103 |
| 10 | `getDriveSyncConfig` | function | 110 |
| 11 | `getDriveSyncEntriesMap` | function | 131 |
| 12 | `upsertDriveSyncEntry` | function | 142 |
| 13 | `deleteDriveSyncEntry` | function | 168 |
| 14 | `deleteDriveSyncEntriesUnder` | function | 172 |
| 15 | `inferMimeType` | function | 179 |
| 16 | `md5File` | function | 194 |
| 17 | `buildMultipartBody` | function | 200 |
| 18 | `exchangeRefreshToken` | function | 217 |
| 19 | `exchangeAuthorizationCode` | function | 236 |
| 20 | `driveApiRequest` | function | 259 |
| 21 | `driveApiUpload` | function | 276 |
| 22 | `fetchDriveUserProfile` | function | 292 |
| 23 | `findDriveItem` | function | 307 |
| 24 | `findDriveItems` | function | 312 |
| 25 | `listDriveChildren` | function | 327 |
| 26 | `getDriveFileIfExists` | function | 336 |
| 27 | `removeDuplicateDriveItems` | function | 348 |
| 28 | `createDriveFolder` | function | 360 |
| 29 | `ensureRootFolder` | function | 372 |
| 30 | `ensureSnapshotLayout` | function | 391 |
| 31 | `shouldSkipSnapshotFile` | function | 397 |
| 32 | `createDataRootSnapshot` | function | 402 |
| 33 | `collectSnapshotItems` | function | 432 |
| 34 | `ensureRemoteDirectories` | function | 461 |
| 35 | `uploadDriveFile` | function | 496 |
| 36 | `updateDriveFile` | function | 511 |
| 37 | `removeDriveFile` | function | 522 |
| 38 | `runDriveSync` | function | 534 |
| 39 | `scheduleDriveSync` | function | 689 |
| 40 | `getDriveSyncStatus` | function | 712 |
| 41 | `beginGoogleDriveOAuth` | function | 743 |
| 42 | `prunePendingOauthStates` | function | 762 |
| 43 | `finalizeGoogleDriveOAuth` | function | 769 |
| 44 | `saveDriveSyncPreferences` | function | 811 |
| 45 | `disconnectDriveSync` | function | 830 |
| 46 | `schedulePeriodicDriveSync` | function | 848 |

### 3.88 `business-os-v1-centralized-org-path/backend/src/services/portalAi.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 15 |
| 2 | `toNumber` | function | 19 |
| 3 | `tokenize` | function | 24 |
| 4 | `nowMs` | function | 32 |
| 5 | `getProviderPriority` | function | 36 |
| 6 | `getProviderCapacity` | function | 41 |
| 7 | `getProviderMaxInputChars` | function | 46 |
| 8 | `getProviderMaxCompletionTokens` | function | 51 |
| 9 | `getProviderTimeoutMs` | function | 56 |
| 10 | `getProviderCooldownMs` | function | 61 |
| 11 | `getRuntimeState` | function | 67 |
| 12 | `pruneProviderState` | function | 82 |
| 13 | `pruneVisitorActivity` | function | 88 |
| 14 | `registerVisitorActivity` | function | 96 |
| 15 | `countActiveVisitors` | function | 106 |
| 16 | `getVisitorMinuteCount` | function | 111 |
| 17 | `summarizeProfile` | function | 118 |
| 18 | `sanitizeQuestion` | function | 128 |
| 19 | `scoreProduct` | function | 132 |
| 20 | `selectCandidateProducts` | function | 164 |
| 21 | `buildPrompt` | function | 196 |
| 22 | `parseAssistantPayload` | function | 221 |
| 23 | `listEnabledChatProviders` | function | 287 |
| 24 | `chooseProviderForAttempt` | function | 306 |
| 25 | `markProviderStart` | function | 327 |
| 26 | `markProviderSuccess` | function | 335 |
| 27 | `markProviderFailure` | function | 342 |
| 28 | `getPortalAiUsageStatus` | function | 350 |
| 29 | `generatePortalAiResponse` | function | 378 |

### 3.89 `business-os-v1-centralized-org-path/backend/src/services/supabaseAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `truthy` | function | 13 |
| 2 | `trim` | function | 17 |
| 3 | `parseJsonSafe` | function | 21 |
| 4 | `normalizeSupabaseUrl` | function | 29 |
| 5 | `normalizeEmail` | function | 33 |
| 6 | `isPlainObject` | function | 38 |
| 7 | `clampPassword` | function | 42 |
| 8 | `isAllowedOauthProvider` | function | 46 |
| 9 | `isHttpUrl` | function | 50 |
| 10 | `isSupabaseAuthConfigured` | function | 64 |
| 11 | `hasSupabaseAdminCredentials` | function | 68 |
| 12 | `hasSupabasePublicCredentials` | function | 72 |
| 13 | `buildSupabaseUrl` | function | 76 |
| 14 | `normalizeRedirectTo` | function | 80 |
| 15 | `getSupabaseAuthPublicConfig` | function | 85 |
| 16 | `normalizeProviderError` | function | 101 |
| 17 | `parseResponseData` | function | 118 |
| 18 | `callSupabasePublic` | function | 126 |
| 19 | `callSupabaseAdmin` | function | 159 |
| 20 | `getBanDurationForActiveState` | function | 193 |
| 21 | `buildUserMetadata` | function | 197 |
| 22 | `buildAppMetadata` | function | 207 |
| 23 | `getIdentityProviders` | function | 216 |
| 24 | `summarizeAuthUser` | function | 237 |
| 25 | `isLocalUserActive` | function | 254 |
| 26 | `getAuthUserById` | function | 258 |
| 27 | `getAuthUserFromAccessToken` | function | 266 |
| 28 | `listAuthUsersPage` | function | 276 |
| 29 | `findAuthUserByEmail` | function | 295 |
| 30 | `createOrUpdateAuthUser` | function | 315 |
| 31 | `updateAuthPassword` | function | 365 |
| 32 | `setAuthUserActive` | function | 384 |
| 33 | `verifyPasswordWithSupabase` | function | 399 |
| 34 | `unlinkAuthIdentity` | function | 424 |
| 35 | `sendSupabaseVerificationEmail` | function | 438 |
| 36 | `sendSupabasePasswordRecoveryEmail` | function | 477 |
| 37 | `buildOauthStartUrl` | function | 501 |

### 3.90 `business-os-v1-centralized-org-path/backend/src/services/verification.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowMs` | function | 8 |
| 2 | `toIso` | function | 12 |
| 3 | `parseBool` | function | 16 |
| 4 | `isEmailProviderConfigured` | function | 23 |
| 5 | `getVerificationCapabilities` | function | 30 |
| 6 | `normalizeEmail` | function | 37 |
| 7 | `normalizePhone` | function | 44 |
| 8 | `maskDestination` | function | 52 |
| 9 | `generateCode` | function | 65 |
| 10 | `hashCode` | function | 69 |
| 11 | `resolveChannel` | function | 73 |
| 12 | `getDestinationForChannel` | function | 83 |
| 13 | `cleanupExpiredCodes` | function | 88 |
| 14 | `invalidateActiveCodes` | function | 96 |
| 15 | `createVerificationRecord` | function | 109 |
| 16 | `findActiveCode` | function | 136 |
| 17 | `consumeCode` | function | 151 |
| 18 | `verifyCode` | function | 155 |
| 19 | `messageForPurpose` | function | 164 |
| 20 | `sendEmail` | function | 183 |
| 21 | `requestVerificationCode` | function | 247 |

### 3.91 `business-os-v1-centralized-org-path/backend/src/sessionAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `hashToken` | function | 11 |
| 2 | `buildSessionExpiry` | function | 15 |
| 3 | `createAuthSession` | function | 25 |
| 4 | `getPresentedSessionToken` | function | 46 |
| 5 | `getSessionUser` | function | 70 |
| 6 | `revokeAuthSession` | function | 133 |

### 3.92 `business-os-v1-centralized-org-path/backend/src/systemFsWorker.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatBackupStamp` | function | 15 |
| 2 | `pad` | const arrow | 17 |
| 3 | `respond` | function | 21 |
| 4 | `fail` | function | 25 |
| 5 | `runExportFolder` | function | 30 |
| 6 | `runRelocateDataRoot` | function | 70 |
| 7 | `main` | function | 77 |

### 3.93 `business-os-v1-centralized-org-path/backend/src/uploadSecurity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `bufferStartsWith` | function | 11 |
| 2 | `isLikelyCsvBuffer` | function | 15 |
| 3 | `detectBufferKind` | function | 28 |
| 4 | `getExpectedUploadedKind` | function | 42 |
| 5 | `validateImageMetadata` | function | 51 |
| 6 | `validateUploadedBuffer` | function | 65 |
| 7 | `validateUploadedPath` | function | 76 |

### 3.94 `business-os-v1-centralized-org-path/backend/src/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `attachWss` | function | 19 |

### 3.95 `business-os-v1-centralized-org-path/backend/test/accessControl.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |
| 2 | `makeReq` | function | 22 |

### 3.96 `business-os-v1-centralized-org-path/backend/test/backupRoundtrip.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 19 |
| 2 | `makeTempRoot` | function | 39 |
| 3 | `getFreePort` | function | 43 |
| 4 | `waitForHealth` | function | 54 |
| 5 | `startServer` | function | 66 |
| 6 | `stopServer` | function | 87 |
| 7 | `fetchJson` | function | 101 |
| 8 | `loginAsAdmin` | function | 115 |
| 9 | `uploadPortalLogo` | function | 132 |
| 10 | `seedSourceServer` | function | 143 |
| 11 | `exportBackup` | function | 249 |
| 12 | `assertRoundtripState` | function | 257 |

### 3.97 `business-os-v1-centralized-org-path/backend/test/backupSchema.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.98 `business-os-v1-centralized-org-path/backend/test/dataPath.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 16 |
| 2 | `makeTempRoot` | function | 27 |

### 3.99 `business-os-v1-centralized-org-path/backend/test/netSecurity.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |

### 3.100 `business-os-v1-centralized-org-path/backend/test/portalUtils.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.101 `business-os-v1-centralized-org-path/backend/test/serverUtils.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.102 `business-os-v1-centralized-org-path/backend/test/uploadSecurity.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |

### 3.103 `business-os-v1-centralized-org-path/frontend/postcss.config.js`

- No top-level named symbols detected.

### 3.104 `business-os-v1-centralized-org-path/frontend/src/api/http.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSyncServerUrl` | export function | 39 |
| 2 | `getSyncToken` | export function | 40 |
| 3 | `getAuthSessionToken` | export function | 41 |
| 4 | `setSyncServerUrl` | export function | 43 |
| 5 | `setSyncToken` | export function | 44 |
| 6 | `setAuthSessionToken` | export function | 45 |
| 7 | `cacheGet` | export function | 52 |
| 8 | `cacheSet` | export function | 56 |
| 9 | `cacheInvalidate` | export function | 57 |
| 10 | `cacheClearAll` | export function | 60 |
| 11 | `logCall` | function | 74 |
| 12 | `getCallLog` | export function | 79 |
| 13 | `clearCallLog` | export function | 80 |
| 14 | `getClientMetaHeaders` | function | 82 |
| 15 | `dispatchGlobalDataRefresh` | function | 86 |
| 16 | `apiFetch` | export function | 96 |
| 17 | `parsed` | const arrow | 119 |
| 18 | `isNetErr` | export function | 139 |
| 19 | `isConnectivityError` | function | 145 |
| 20 | `isServerOnline` | export function | 164 |
| 21 | `setServerHealth` | function | 166 |
| 22 | `startHealthCheck` | export function | 181 |
| 23 | `cacheGetStale` | export function | 216 |
| 24 | `route` | export function | 233 |

### 3.105 `business-os-v1-centralized-org-path/frontend/src/api/localDb.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `localGetSettings` | export function | 38 |
| 2 | `localSaveSettings` | export function | 45 |
| 3 | `parseCSV` | export function | 54 |
| 4 | `splitCSVLine` | function | 67 |
| 5 | `buildCSVTemplate` | export function | 78 |

### 3.106 `business-os-v1-centralized-org-path/frontend/src/api/methods.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDeviceInfo` | function | 3 |
| 2 | `getPortalBaseUrl` | function | 19 |
| 3 | `getCurrentUserContext` | function | 24 |
| 4 | `queueOfflineWrite` | function | 39 |
| 5 | `appendActorQuery` | function | 48 |
| 6 | `fetchJsonWithTimeout` | function | 61 |
| 7 | `login` | export function | 80 |
| 8 | `logout` | export function | 83 |
| 9 | `resetPasswordWithOtp` | export function | 86 |
| 10 | `requestPasswordResetEmail` | export function | 89 |
| 11 | `completePasswordReset` | export function | 92 |
| 12 | `getVerificationCapabilities` | export function | 95 |
| 13 | `getSystemConfig` | export function | 98 |
| 14 | `getSystemDebugLog` | export function | 101 |
| 15 | `startSupabaseOauth` | export function | 104 |
| 16 | `completeSupabaseOauth` | export function | 107 |
| 17 | `getOrganizationBootstrap` | export function | 110 |
| 18 | `searchOrganizations` | export function | 113 |
| 19 | `getCurrentOrganization` | export function | 117 |
| 20 | `getSettings` | export function | 122 |
| 21 | `saveSettings` | export function | 125 |
| 22 | `getCategories` | const arrow | 131 |
| 23 | `updateCategory` | const arrow | 133 |
| 24 | `getUnits` | const arrow | 137 |
| 25 | `getCustomFields` | const arrow | 142 |
| 26 | `updateCustomField` | const arrow | 144 |
| 27 | `getBranches` | const arrow | 148 |
| 28 | `updateBranch` | const arrow | 150 |
| 29 | `deleteBranch` | const arrow | 151 |
| 30 | `getTransfers` | const arrow | 153 |
| 31 | `getProducts` | const arrow | 157 |
| 32 | `getCatalogMeta` | export function | 158 |
| 33 | `getCatalogProducts` | export function | 166 |
| 34 | `getPortalConfig` | export function | 174 |
| 35 | `getPortalCatalogMeta` | export function | 182 |
| 36 | `getPortalCatalogProducts` | export function | 190 |
| 37 | `lookupPortalMembership` | export function | 198 |
| 38 | `createPortalSubmission` | export function | 208 |
| 39 | `getPortalAiStatus` | export function | 222 |
| 40 | `askPortalAi` | export function | 230 |
| 41 | `getPortalSubmissionsForReview` | const arrow | 244 |
| 42 | `reviewPortalSubmission` | const arrow | 246 |
| 43 | `getAiProviders` | const arrow | 249 |
| 44 | `createAiProvider` | const arrow | 251 |
| 45 | `updateAiProvider` | const arrow | 253 |
| 46 | `deleteAiProvider` | const arrow | 255 |
| 47 | `testAiProvider` | const arrow | 257 |
| 48 | `getAiResponses` | const arrow | 259 |
| 49 | `createProduct` | export function | 261 |
| 50 | `updateProduct` | export function | 292 |
| 51 | `getFiles` | export function | 320 |
| 52 | `uploadFileAsset` | export function | 326 |
| 53 | `deleteFileAsset` | export function | 356 |
| 54 | `uploadProductImage` | export function | 365 |
| 55 | `uploadUserAvatar` | export function | 394 |
| 56 | `openCSVDialog` | export function | 431 |
| 57 | `openImageDialog` | export function | 451 |
| 58 | `getImageDataUrl` | export function | 459 |
| 59 | `getInventorySummary` | const arrow | 468 |
| 60 | `getInventoryMovements` | const arrow | 469 |
| 61 | `createSale` | export function | 472 |
| 62 | `flushPendingSyncQueue` | export function | 492 |
| 63 | `getSales` | const arrow | 550 |
| 64 | `getDashboard` | const arrow | 556 |
| 65 | `getAnalytics` | const arrow | 557 |
| 66 | `getCustomers` | const arrow | 566 |
| 67 | `updateCustomer` | const arrow | 568 |
| 68 | `downloadCustomerTemplate` | const arrow | 571 |
| 69 | `getSuppliers` | const arrow | 574 |
| 70 | `updateSupplier` | const arrow | 576 |
| 71 | `downloadSupplierTemplate` | const arrow | 579 |
| 72 | `getDeliveryContacts` | const arrow | 582 |
| 73 | `updateDeliveryContact` | const arrow | 584 |
| 74 | `getUsers` | const arrow | 589 |
| 75 | `updateUser` | const arrow | 591 |
| 76 | `getUserProfile` | const arrow | 592 |
| 77 | `getUserAuthMethods` | const arrow | 593 |
| 78 | `updateUserProfile` | const arrow | 595 |
| 79 | `disconnectUserAuthProvider` | const arrow | 597 |
| 80 | `changeUserPassword` | const arrow | 599 |
| 81 | `resetPassword` | const arrow | 601 |
| 82 | `getRoles` | const arrow | 604 |
| 83 | `updateRole` | const arrow | 606 |
| 84 | `deleteRole` | const arrow | 607 |
| 85 | `getCustomTables` | const arrow | 610 |
| 86 | `getCustomTableData` | const arrow | 612 |
| 87 | `insertCustomRow` | const arrow | 613 |
| 88 | `updateCustomRow` | const arrow | 614 |
| 89 | `deleteCustomRow` | const arrow | 615 |
| 90 | `getAuditLogs` | const arrow | 618 |
| 91 | `exportBackup` | export function | 621 |
| 92 | `exportBackupFolder` | export function | 638 |
| 93 | `pickBackupFile` | export function | 642 |
| 94 | `importBackupData` | export function | 657 |
| 95 | `importBackupFolder` | export function | 663 |
| 96 | `importBackup` | export function | 669 |
| 97 | `getGoogleDriveSyncStatus` | const arrow | 684 |
| 98 | `saveGoogleDriveSyncPreferences` | const arrow | 687 |
| 99 | `startGoogleDriveSyncOauth` | const arrow | 690 |
| 100 | `disconnectGoogleDriveSync` | const arrow | 693 |
| 101 | `syncGoogleDriveNow` | const arrow | 696 |
| 102 | `resetData` | export function | 699 |
| 103 | `factoryReset` | export function | 705 |
| 104 | `downloadImportTemplate` | export function | 712 |
| 105 | `openPath` | export function | 732 |
| 106 | `getReturns` | const arrow | 741 |
| 107 | `updateSaleStatus` | const arrow | 751 |
| 108 | `attachSaleCustomer` | const arrow | 755 |
| 109 | `getSalesExport` | const arrow | 758 |
| 110 | `updateReturn` | const arrow | 762 |
| 111 | `testSyncServer` | export function | 766 |
| 112 | `openFolderDialog` | export function | 785 |
| 113 | `getDataPath` | const arrow | 796 |
| 114 | `setDataPath` | const arrow | 797 |
| 115 | `resetDataPath` | const arrow | 798 |
| 116 | `browseDir` | const arrow | 799 |

### 3.107 `business-os-v1-centralized-org-path/frontend/src/api/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `connectWS` | export function | 18 |
| 2 | `disconnectWS` | export function | 92 |
| 3 | `scheduleReconnect` | function | 100 |
| 4 | `isWSConnected` | export function | 116 |

### 3.108 `business-os-v1-centralized-org-path/frontend/src/App.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getChunkErrorMessage` | function | 54 |
| 2 | `isChunkLoadError` | function | 59 |
| 3 | `createChunkTimeoutError` | function | 68 |
| 4 | `isRetryableImportError` | function | 74 |
| 5 | `importWithTimeout` | function | 82 |
| 6 | `clearRetryMarker` | function | 98 |
| 7 | `triggerChunkRecoveryReload` | function | 105 |
| 8 | `createChunkReloadStallError` | function | 115 |
| 9 | `shouldRetryChunk` | function | 121 |
| 10 | `lazyWithRetry` | function | 131 |
| 11 | `getWarmupImporters` | function | 198 |
| 12 | `useMountedPages` | function | 209 |
| 13 | `useSyncErrorBanner` | function | 223 |
| 14 | `onSyncError` | const arrow | 228 |
| 15 | `useVisibilityRecovery` | function | 239 |
| 16 | `onVisible` | const arrow | 243 |
| 17 | `onFocus` | const arrow | 253 |
| 18 | `useChunkWarmup` | function | 271 |
| 19 | `runWarmup` | const arrow | 282 |
| 20 | `PageErrorBoundary` | class | 310 |
| 21 | `Notification` | function | 358 |
| 22 | `SyncErrorBanner` | function | 370 |
| 23 | `PageLoader` | function | 390 |
| 24 | `PageSlot` | function | 401 |
| 25 | `PublicCatalogView` | function | 424 |
| 26 | `App` | export default function | 437 |

### 3.109 `business-os-v1-centralized-org-path/frontend/src/app/appShellUtils.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isPublicCatalogPath` | export function | 7 |
| 2 | `updateMountedPages` | export function | 17 |
| 3 | `getNotificationPrefix` | export function | 27 |
| 4 | `getNotificationColor` | export function | 34 |

### 3.110 `business-os-v1-centralized-org-path/frontend/src/AppContext.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readDeviceSettings` | function | 52 |
| 2 | `writeDeviceSettings` | function | 60 |
| 3 | `mergeSettingsWithDeviceOverrides` | function | 66 |
| 4 | `normalizeDateInput` | function | 70 |
| 5 | `LoadingScreen` | function | 95 |
| 6 | `AccessDenied` | function | 108 |
| 7 | `AppProvider` | export function | 120 |
| 8 | `onUpdate` | const arrow | 215 |
| 9 | `onStatus` | const arrow | 225 |
| 10 | `poll` | const arrow | 233 |
| 11 | `onError` | const arrow | 253 |
| 12 | `onUnauthorized` | const arrow | 257 |
| 13 | `handleOtpLogin` | const arrow | 289 |
| 14 | `handleUserUpdated` | const arrow | 329 |
| 15 | `discoverSyncUrl` | const arrow | 357 |
| 16 | `hexAlpha` | const arrow | 453 |
| 17 | `clearCallbackUrl` | const arrow | 618 |
| 18 | `clearPendingLink` | const arrow | 622 |
| 19 | `run` | const arrow | 626 |
| 20 | `useApp` | const arrow | 863 |
| 21 | `useSync` | const arrow | 864 |
| 22 | `useT` | const arrow | 867 |

### 3.111 `business-os-v1-centralized-org-path/frontend/src/components/auth/Login.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `OauthButton` | function | 16 |
| 2 | `ModeBackButton` | function | 30 |
| 3 | `Login` | export default function | 43 |
| 4 | `tr` | const arrow | 45 |
| 5 | `rememberOrganization` | const arrow | 88 |
| 6 | `loadCapabilities` | const arrow | 115 |
| 7 | `bootstrap` | const arrow | 132 |
| 8 | `clearCallbackUrl` | const arrow | 191 |
| 9 | `run` | const arrow | 196 |
| 10 | `rememberedOrg` | const arrow | 224 |
| 11 | `getDeviceContext` | const arrow | 269 |
| 12 | `handleLogin` | const arrow | 271 |
| 13 | `handleOtp` | const arrow | 291 |
| 14 | `handleOtpInput` | const arrow | 321 |
| 15 | `handleResetWithOtp` | const arrow | 326 |
| 16 | `handleResetWithEmail` | const arrow | 360 |
| 17 | `handleCompleteEmailReset` | const arrow | 386 |
| 18 | `handleStartOauth` | const arrow | 416 |
| 19 | `closeAuxMode` | const arrow | 446 |

### 3.112 `business-os-v1-centralized-org-path/frontend/src/components/branches/Branches.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatTransferDate` | function | 19 |
| 2 | `Branches` | export default function | 36 |
| 3 | `load` | const arrow | 58 |
| 4 | `loadBranchStock` | const arrow | 94 |
| 5 | `handleSaveBranch` | const arrow | 109 |
| 6 | `handleDelete` | const arrow | 128 |
| 7 | `handleBulkDelete` | const arrow | 143 |
| 8 | `toggleSelect` | const arrow | 168 |
| 9 | `toggleSelectAll` | const arrow | 177 |

### 3.113 `business-os-v1-centralized-org-path/frontend/src/components/branches/BranchForm.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BranchForm` | export default function | 11 |
| 2 | `set` | const arrow | 33 |
| 3 | `handleSave` | const arrow | 45 |

### 3.114 `business-os-v1-centralized-org-path/frontend/src/components/branches/TransferModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `TransferModal` | export default function | 11 |
| 2 | `run` | const arrow | 36 |
| 3 | `handleTransfer` | const arrow | 70 |

### 3.115 `business-os-v1-centralized-org-path/frontend/src/components/catalog/CatalogPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getAboutBlockLabel` | function | 41 |
| 2 | `withAssetVersion` | function | 47 |
| 3 | `tt` | function | 522 |
| 4 | `toBoolean` | function | 527 |
| 5 | `toNumber` | function | 534 |
| 6 | `normalizePriceDisplay` | function | 540 |
| 7 | `normalizeHexColor` | function | 545 |
| 8 | `normalizeExternalUrl` | function | 551 |
| 9 | `buildFaqStarterItems` | function | 567 |
| 10 | `buildAiFaqStarterItems` | function | 647 |
| 11 | `hexToRgba` | function | 678 |
| 12 | `readPortalCache` | function | 689 |
| 13 | `writePortalCache` | function | 705 |
| 14 | `normalizePortalPath` | function | 719 |
| 15 | `isReservedPortalPath` | function | 732 |
| 16 | `buildDraft` | function | 737 |
| 17 | `applyDraft` | function | 821 |
| 18 | `statusClass` | function | 936 |
| 19 | `getBranchQty` | function | 943 |
| 20 | `getStockStatus` | function | 950 |
| 21 | `normalizeProductGallery` | function | 960 |
| 22 | `formatDateTime` | function | 978 |
| 23 | `formatPortalPrice` | function | 985 |
| 24 | `SectionShell` | function | 998 |
| 25 | `SummaryTile` | function | 1014 |
| 26 | `StatusPill` | function | 1038 |
| 27 | `ImageField` | function | 1053 |
| 28 | `pickImageAsDataUrl` | function | 1119 |
| 29 | `pickMultipleImagesAsDataUrls` | function | 1138 |
| 30 | `replaceVars` | function | 1159 |
| 31 | `applyGoogleTranslateSelection` | function | 1196 |
| 32 | `CatalogPage` | export default function | 1218 |
| 33 | `copy` | const arrow | 1289 |
| 34 | `resolveVisibleTab` | const arrow | 1290 |
| 35 | `openProductGallery` | function | 1382 |
| 36 | `changeTranslateTarget` | function | 1395 |
| 37 | `loadPortal` | function | 1407 |
| 38 | `run` | function | 1471 |
| 39 | `toggleFilterValue` | function | 1695 |
| 40 | `clearPortalFilters` | function | 1703 |
| 41 | `setDraft` | function | 1710 |
| 42 | `openPortalImage` | function | 1715 |
| 43 | `setAboutBlocksDraft` | function | 1726 |
| 44 | `updateAboutBlock` | function | 1730 |
| 45 | `addAboutBlock` | function | 1736 |
| 46 | `moveAboutBlockBefore` | function | 1740 |
| 47 | `removeAboutBlock` | function | 1752 |
| 48 | `setFaqDraft` | function | 1756 |
| 49 | `addFaqItem` | function | 1760 |
| 50 | `mergeFaqStarterItems` | function | 1771 |
| 51 | `addFaqStarterSet` | function | 1784 |
| 52 | `addAiFaqStarterSet` | function | 1788 |
| 53 | `updateFaqItem` | function | 1792 |
| 54 | `removeFaqItem` | function | 1798 |
| 55 | `clearAssistantState` | function | 1802 |
| 56 | `uploadPortalImage` | function | 1817 |
| 57 | `uploadDraftImage` | function | 1836 |
| 58 | `uploadAboutBlockMedia` | function | 1841 |
| 59 | `openFilePicker` | function | 1850 |
| 60 | `handleFilePickerSelect` | function | 1854 |
| 61 | `savePortalDraft` | function | 1870 |
| 62 | `askAssistant` | function | 1990 |
| 63 | `handleMembershipLookup` | function | 2023 |
| 64 | `addSubmissionImages` | function | 2049 |
| 65 | `handleSubmissionPaste` | function | 2058 |
| 66 | `handleSubmitShareProof` | function | 2074 |
| 67 | `handleReviewSubmission` | function | 2109 |

### 3.116 `business-os-v1-centralized-org-path/frontend/src/components/catalog/portalEditorUtils.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toTrimmedString` | function | 3 |
| 2 | `safeJsonParse` | function | 7 |
| 3 | `createAboutBlock` | export function | 15 |
| 4 | `normalizeAboutBlocks` | export function | 27 |
| 5 | `serializeAboutBlocks` | export function | 47 |
| 6 | `moveListItem` | export function | 51 |
| 7 | `extractGoogleMapsEmbedUrl` | export function | 64 |
| 8 | `normalizeGoogleMapsEmbed` | export function | 72 |

### 3.117 `business-os-v1-centralized-org-path/frontend/src/components/contacts/Contacts.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `TABS` | const arrow | 14 |
| 2 | `ImportTypePicker` | function | 20 |
| 3 | `T` | const arrow | 21 |
| 4 | `Contacts` | export default function | 60 |
| 5 | `handleExportAll` | const arrow | 67 |
| 6 | `openImportPicker` | const arrow | 118 |
| 7 | `handleTypeSelected` | const arrow | 120 |
| 8 | `handleImportDone` | const arrow | 125 |

### 3.118 `business-os-v1-centralized-org-path/frontend/src/components/contacts/CustomersTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseContactOptions` | export function | 9 |
| 2 | `serializeContactOptions` | export function | 30 |
| 3 | `BLANK_OPTION` | const arrow | 41 |
| 4 | `generateMembershipNumber` | function | 43 |
| 5 | `tr` | function | 49 |
| 6 | `OptionEditor` | function | 54 |
| 7 | `setField` | const arrow | 55 |
| 8 | `buildOptionSummary` | function | 95 |
| 9 | `CustomerForm` | function | 103 |
| 10 | `setField` | const arrow | 113 |
| 11 | `addOption` | const arrow | 114 |
| 12 | `removeOption` | const arrow | 115 |
| 13 | `updateOption` | const arrow | 116 |
| 14 | `CustomersTab` | function | 190 |
| 15 | `handleSave` | const arrow | 230 |
| 16 | `handleDelete` | const arrow | 254 |
| 17 | `handleBulkDelete` | const arrow | 267 |

### 3.119 `business-os-v1-centralized-org-path/frontend/src/components/contacts/DeliveryTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseDeliveryOptions` | export function | 15 |
| 2 | `serializeDeliveryOptions` | export function | 30 |
| 3 | `BLANK_OPTION` | const arrow | 37 |
| 4 | `OptionEditor` | function | 40 |
| 5 | `set` | const arrow | 41 |
| 6 | `DeliveryForm` | function | 71 |
| 7 | `set` | const arrow | 74 |
| 8 | `handleSave` | const arrow | 75 |
| 9 | `OptionsDisplay` | function | 115 |
| 10 | `OptionsBadge` | function | 132 |
| 11 | `DeliveryTab` | function | 143 |
| 12 | `handleSave` | const arrow | 174 |
| 13 | `handleDelete` | const arrow | 189 |
| 14 | `handleBulkDelete` | const arrow | 195 |

### 3.120 `business-os-v1-centralized-org-path/frontend/src/components/contacts/shared.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `useContactSelection` | export function | 11 |
| 2 | `toggleOne` | const arrow | 25 |
| 3 | `clearSelection` | const arrow | 36 |
| 4 | `ThreeDotMenu` | export function | 62 |
| 5 | `DetailModal` | export function | 121 |
| 6 | `ContactTable` | export function | 152 |
| 7 | `ImportModal` | export function | 225 |
| 8 | `handlePickFile` | const arrow | 246 |
| 9 | `handleChooseExistingFile` | const arrow | 254 |
| 10 | `handleDownloadTemplate` | const arrow | 276 |
| 11 | `handleImport` | const arrow | 280 |

### 3.121 `business-os-v1-centralized-org-path/frontend/src/components/contacts/SuppliersTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `SupplierForm` | function | 9 |
| 2 | `set` | const arrow | 14 |
| 3 | `SuppliersTab` | function | 60 |
| 4 | `handleSave` | const arrow | 101 |
| 5 | `handleDelete` | const arrow | 121 |
| 6 | `handleBulkDelete` | const arrow | 134 |

### 3.122 `business-os-v1-centralized-org-path/frontend/src/components/custom-tables/CustomTables.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CustomTables` | export default function | 6 |
| 2 | `loadTables` | const arrow | 17 |
| 3 | `addColumn` | const arrow | 39 |
| 4 | `updateColumn` | const arrow | 43 |
| 5 | `removeColumn` | const arrow | 47 |
| 6 | `handleCreateTable` | const arrow | 51 |
| 7 | `handleSaveRow` | const arrow | 64 |
| 8 | `handleDeleteRow` | const arrow | 78 |
| 9 | `openAddRow` | const arrow | 84 |
| 10 | `openEditRow` | const arrow | 91 |

### 3.123 `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/BarChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BarChart` | export default function | 14 |
| 2 | `yPx` | function | 32 |

### 3.124 `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/DonutChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `DonutChart` | export default function | 14 |

### 3.125 `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/index.js`

- No top-level named symbols detected.

### 3.126 `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/LineChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `LineChart` | export default function | 13 |
| 2 | `xPx` | function | 29 |
| 3 | `yPx` | function | 30 |
| 4 | `handleMouseMove` | const arrow | 35 |

### 3.127 `business-os-v1-centralized-org-path/frontend/src/components/dashboard/charts/NoData.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NoData` | export default function | 7 |

### 3.128 `business-os-v1-centralized-org-path/frontend/src/components/dashboard/Dashboard.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Dashboard` | export default function | 11 |
| 2 | `translateOr` | const arrow | 15 |
| 3 | `calcTrend` | const arrow | 94 |
| 4 | `rangeLabel` | const arrow | 119 |
| 5 | `periodShort` | const arrow | 125 |
| 6 | `buildExportAll` | const arrow | 232 |

### 3.129 `business-os-v1-centralized-org-path/frontend/src/components/dashboard/MiniStat.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `MiniStat` | export default function | 2 |

### 3.130 `business-os-v1-centralized-org-path/frontend/src/components/files/FilePickerModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `AssetPreview` | function | 5 |
| 2 | `FilePickerModal` | export default function | 15 |
| 3 | `tr` | const arrow | 33 |
| 4 | `loadFiles` | function | 38 |
| 5 | `toggleSelectedPath` | function | 69 |
| 6 | `handleUpload` | function | 79 |
| 7 | `handleDelete` | function | 114 |

### 3.131 `business-os-v1-centralized-org-path/frontend/src/components/files/FilesPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `AssetPreview` | function | 21 |
| 2 | `formatDateTime` | function | 35 |
| 3 | `ProviderStatus` | function | 45 |
| 4 | `emptyProviderForm` | function | 56 |
| 5 | `compactTabLabel` | function | 79 |
| 6 | `FilesPage` | export default function | 85 |
| 7 | `tr` | const arrow | 106 |
| 8 | `loadFiles` | function | 146 |
| 9 | `loadProviders` | function | 158 |
| 10 | `loadResponses` | function | 171 |
| 11 | `handleUpload` | function | 183 |
| 12 | `handleDeleteAsset` | function | 199 |
| 13 | `startCreateProvider` | function | 215 |
| 14 | `startEditProvider` | function | 231 |
| 15 | `saveProvider` | function | 255 |
| 16 | `testProvider` | function | 298 |
| 17 | `removeProvider` | function | 312 |
| 18 | `tabButton` | const arrow | 325 |

### 3.132 `business-os-v1-centralized-org-path/frontend/src/components/inventory/DualMoney.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `DualMoney` | function | 5 |

### 3.133 `business-os-v1-centralized-org-path/frontend/src/components/inventory/Inventory.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Inventory` | export default function | 13 |
| 2 | `handleAdjust` | const arrow | 93 |
| 3 | `openAdjust` | const arrow | 124 |
| 4 | `matchesSearch` | const arrow | 137 |
| 5 | `productHay` | const arrow | 144 |
| 6 | `movHay` | const arrow | 147 |

### 3.134 `business-os-v1-centralized-org-path/frontend/src/components/inventory/movementGroups.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `minuteBucket` | function | 1 |
| 2 | `normalizeText` | function | 8 |
| 3 | `buildGroupKey` | function | 12 |
| 4 | `describeMovementType` | function | 28 |
| 5 | `buildMovementGroups` | export function | 33 |
| 6 | `movementGroupHaystack` | export function | 94 |

### 3.135 `business-os-v1-centralized-org-path/frontend/src/components/inventory/ProductDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductDetailModal` | function | 6 |
| 2 | `T` | const arrow | 7 |

### 3.136 `business-os-v1-centralized-org-path/frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sanitizeInteger` | function | 101 |
| 2 | `sanitizeKhr` | function | 106 |
| 3 | `formatLookupValue` | function | 112 |
| 4 | `LoyaltyPointsPage` | export default function | 116 |
| 5 | `copy` | const arrow | 119 |
| 6 | `loadCustomerPoints` | function | 150 |
| 7 | `setValue` | function | 185 |
| 8 | `handleSave` | function | 189 |
| 9 | `handleLookup` | function | 211 |

### 3.137 `business-os-v1-centralized-org-path/frontend/src/components/navigation/Sidebar.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getFallbackLabel` | function | 47 |
| 2 | `getNavLabel` | function | 55 |
| 3 | `isDarkColor` | function | 71 |
| 4 | `withAlpha` | function | 81 |
| 5 | `mergeStyles` | function | 87 |
| 6 | `Sidebar` | export default function | 91 |

### 3.138 `business-os-v1-centralized-org-path/frontend/src/components/pos/CartItem.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CartItem` | function | 7 |

### 3.139 `business-os-v1-centralized-org-path/frontend/src/components/pos/FilterPanel.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `POSFilterPanel` | export default function | 3 |
| 2 | `T` | const arrow | 24 |
| 3 | `clearAll` | const arrow | 34 |
| 4 | `chip` | const arrow | 42 |
| 5 | `SectionLabel` | const arrow | 48 |

### 3.140 `business-os-v1-centralized-org-path/frontend/src/components/pos/POS.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `allTermsMatch` | function | 42 |
| 2 | `POS` | export default function | 47 |
| 3 | `posCopy` | const arrow | 50 |
| 4 | `setQuickFilter` | const arrow | 85 |
| 5 | `addNewOrder` | const arrow | 150 |
| 6 | `closeOrder` | const arrow | 162 |
| 7 | `loadMembership` | function | 307 |
| 8 | `selectCustomer` | const arrow | 329 |
| 9 | `applyCustomerOption` | const arrow | 377 |
| 10 | `clearCustomer` | const arrow | 391 |
| 11 | `handleAddCustomer` | const arrow | 399 |
| 12 | `selectDelivery` | const arrow | 415 |
| 13 | `clearDelivery` | const arrow | 420 |
| 14 | `handleAddDelivery` | const arrow | 422 |
| 15 | `filteredProducts` | const arrow | 463 |
| 16 | `qty` | const arrow | 492 |
| 17 | `addToCart` | const arrow | 600 |
| 18 | `updateQty` | const arrow | 626 |
| 19 | `updatePrice` | const arrow | 634 |
| 20 | `updateItemBranch` | const arrow | 646 |
| 21 | `handleDiscountUsd` | const arrow | 695 |
| 22 | `handleDiscountKhr` | const arrow | 696 |
| 23 | `handleMembershipUnits` | const arrow | 697 |
| 24 | `handleCheckout` | const arrow | 714 |

### 3.141 `business-os-v1-centralized-org-path/frontend/src/components/pos/ProductImage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductImage` | export default function | 7 |

### 3.142 `business-os-v1-centralized-org-path/frontend/src/components/pos/QuickAddModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `QuickAddModal` | function | 5 |
| 2 | `T` | const arrow | 6 |

### 3.143 `business-os-v1-centralized-org-path/frontend/src/components/products/BranchStockAdjuster.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BranchStockAdjuster` | function | 6 |
| 2 | `setRow` | const arrow | 16 |
| 3 | `handleSave` | const arrow | 19 |

### 3.144 `business-os-v1-centralized-org-path/frontend/src/components/products/BulkAddStockModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BulkAddStockModal` | function | 6 |
| 2 | `handleSave` | const arrow | 13 |

### 3.145 `business-os-v1-centralized-org-path/frontend/src/components/products/BulkImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBaseName` | function | 12 |
| 2 | `parseCSVContent` | function | 19 |
| 3 | `getIncomingImageFilenames` | function | 39 |
| 4 | `getExistingImageFilenames` | function | 72 |
| 5 | `BulkImportModal` | export default function | 90 |
| 6 | `T` | const arrow | 105 |
| 7 | `resetCsvState` | const arrow | 107 |
| 8 | `pickImageDirectory` | const arrow | 116 |
| 9 | `addLibraryImages` | const arrow | 145 |
| 10 | `handleImageOnlyImport` | const arrow | 161 |
| 11 | `handlePickCSV` | const arrow | 183 |
| 12 | `handleImport` | const arrow | 256 |

### 3.146 `business-os-v1-centralized-org-path/frontend/src/components/products/HeaderActions.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductsHeaderActions` | export default function | 4 |

### 3.147 `business-os-v1-centralized-org-path/frontend/src/components/products/ManageBrandsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseBrandOptions` | function | 5 |
| 2 | `toTitleCase` | function | 18 |
| 3 | `ManageBrandsModal` | export default function | 26 |
| 4 | `saveLibrary` | const arrow | 59 |
| 5 | `addLibraryBrand` | const arrow | 70 |
| 6 | `renameBrand` | const arrow | 92 |
| 7 | `removeBrand` | const arrow | 138 |

### 3.148 `business-os-v1-centralized-org-path/frontend/src/components/products/ManageCategoriesModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ManageCategoriesModal` | function | 7 |
| 2 | `load` | const arrow | 16 |
| 3 | `handleAdd` | const arrow | 20 |
| 4 | `handleUpdate` | const arrow | 29 |
| 5 | `handleDelete` | const arrow | 37 |

### 3.149 `business-os-v1-centralized-org-path/frontend/src/components/products/ManageFieldsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ManageFieldsModal` | function | 6 |
| 2 | `load` | const arrow | 13 |
| 3 | `handleSave` | const arrow | 16 |

### 3.150 `business-os-v1-centralized-org-path/frontend/src/components/products/ManageMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ManageMenu` | export default function | 5 |

### 3.151 `business-os-v1-centralized-org-path/frontend/src/components/products/ManageUnitsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ManageUnitsModal` | function | 6 |
| 2 | `load` | const arrow | 11 |
| 3 | `handleAddUnit` | const arrow | 14 |

### 3.152 `business-os-v1-centralized-org-path/frontend/src/components/products/primitives.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductImg` | function | 7 |
| 2 | `ProductImagePlaceholder` | function | 41 |
| 3 | `MarginCard` | function | 49 |
| 4 | `DualPriceInput` | function | 81 |
| 5 | `handleUsdChange` | const arrow | 82 |
| 6 | `handleKhrChange` | const arrow | 88 |

### 3.153 `business-os-v1-centralized-org-path/frontend/src/components/products/ProductDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductDetailModal` | export default function | 4 |
| 2 | `T` | const arrow | 15 |
| 3 | `Row` | const arrow | 25 |

### 3.154 `business-os-v1-centralized-org-path/frontend/src/components/products/ProductForm.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeGallery` | function | 7 |
| 2 | `pickImageFiles` | function | 23 |
| 3 | `parseCustomFieldOptions` | function | 41 |
| 4 | `ProductForm` | export default function | 52 |
| 5 | `setField` | function | 130 |
| 6 | `setCustomField` | function | 134 |
| 7 | `addImages` | function | 144 |
| 8 | `removeImage` | function | 167 |
| 9 | `setPrimaryImage` | function | 171 |
| 10 | `saveForm` | function | 181 |

### 3.155 `business-os-v1-centralized-org-path/frontend/src/components/products/Products.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `multiMatch` | function | 23 |
| 2 | `ThreeDot` | function | 27 |
| 3 | `Products` | export default function | 33 |
| 4 | `handleSave` | const arrow | 82 |
| 5 | `normalizeGallery` | const arrow | 133 |
| 6 | `uploadGalleryImages` | const arrow | 149 |
| 7 | `handleSaveWithGallery` | const arrow | 171 |
| 8 | `handleBulkDelete` | const arrow | 203 |
| 9 | `handleBulkOutOfStock` | const arrow | 216 |
| 10 | `handleBulkChangeBranch` | const arrow | 232 |
| 11 | `handleBulkAddStock` | const arrow | 269 |
| 12 | `toggleSelect` | const arrow | 274 |
| 13 | `toggleSelectAll` | const arrow | 279 |
| 14 | `handleDelete` | const arrow | 283 |
| 15 | `resolveImageUrl` | const arrow | 307 |
| 16 | `getProductGallery` | const arrow | 318 |
| 17 | `openLightbox` | const arrow | 320 |
| 18 | `getBranchQty` | const arrow | 328 |
| 19 | `getStockBadge` | const arrow | 329 |
| 20 | `toImageName` | const arrow | 390 |
| 21 | `toImageUrl` | const arrow | 391 |

### 3.156 `business-os-v1-centralized-org-path/frontend/src/components/products/VariantFormModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `VariantFormModal` | function | 8 |
| 2 | `set` | const arrow | 21 |
| 3 | `handleSave` | const arrow | 24 |

### 3.157 `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/AllFieldsPanel.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Toggle` | function | 5 |
| 2 | `AllFieldsPanel` | export default function | 21 |
| 3 | `T` | const arrow | 23 |
| 4 | `toggleSection` | const arrow | 42 |

### 3.158 `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/constants.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getFieldItems` | export function | 52 |
| 2 | `T` | const arrow | 53 |

### 3.159 `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/ErrorBoundary.jsx`

- No top-level named symbols detected.

### 3.160 `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/FieldOrderManager.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSectionOrderItems` | function | 4 |
| 2 | `buildList` | function | 23 |
| 3 | `toKeys` | function | 48 |
| 4 | `FieldOrderManager` | export default function | 52 |
| 5 | `moveItem` | const arrow | 66 |
| 6 | `addDivider` | const arrow | 74 |
| 7 | `removeDivider` | const arrow | 85 |
| 8 | `handleDragStart` | const arrow | 91 |
| 9 | `handleDragOver` | const arrow | 96 |

### 3.161 `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/PrintSettings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Section` | function | 5 |
| 2 | `PrintSettings` | export default function | 17 |
| 3 | `T` | const arrow | 18 |
| 4 | `setValue` | const arrow | 27 |
| 5 | `resetMargins` | const arrow | 35 |

### 3.162 `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/ReceiptPreview.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ReceiptPreview` | export default function | 3 |

### 3.163 `business-os-v1-centralized-org-path/frontend/src/components/receipt-settings/ReceiptSettings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Section` | function | 13 |
| 2 | `Toggle` | function | 24 |
| 3 | `parseTemplate` | function | 39 |
| 4 | `ReceiptSettings` | export default function | 44 |
| 5 | `handleSave` | const arrow | 113 |

### 3.164 `business-os-v1-centralized-org-path/frontend/src/components/receipt/Receipt.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseTpl` | export function | 8 |
| 2 | `stripEmoji` | function | 16 |
| 3 | `displayAddress` | function | 21 |
| 4 | `parseItems` | function | 30 |
| 5 | `labelFor` | function | 95 |
| 6 | `Row` | function | 100 |
| 7 | `Receipt` | export default function | 112 |
| 8 | `em` | const arrow | 123 |
| 9 | `exportReceiptPdf` | const arrow | 319 |

### 3.165 `business-os-v1-centralized-org-path/frontend/src/components/returns/EditReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `EditReturnModal` | function | 6 |
| 2 | `T` | const arrow | 8 |
| 3 | `updateQty` | const arrow | 33 |
| 4 | `updateRestock` | const arrow | 36 |
| 5 | `handleSubmit` | const arrow | 44 |

### 3.166 `business-os-v1-centralized-org-path/frontend/src/components/returns/NewReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NewReturnModal` | function | 7 |
| 2 | `T` | const arrow | 9 |
| 3 | `handleSearch` | const arrow | 34 |
| 4 | `handleReturnTypeChange` | const arrow | 74 |
| 5 | `toggleIncluded` | const arrow | 79 |
| 6 | `updateItemQty` | const arrow | 87 |
| 7 | `updateItemRestock` | const arrow | 95 |
| 8 | `selectAll` | const arrow | 99 |
| 9 | `clearAll` | const arrow | 102 |
| 10 | `handleSubmit` | const arrow | 109 |

### 3.167 `business-os-v1-centralized-org-path/frontend/src/components/returns/NewSupplierReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NewSupplierReturnModal` | export default function | 4 |
| 2 | `tr` | const arrow | 6 |
| 3 | `updateQty` | const arrow | 113 |
| 4 | `submit` | const arrow | 119 |

### 3.168 `business-os-v1-centralized-org-path/frontend/src/components/returns/ReturnDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeScope` | function | 6 |
| 2 | `ReturnDetailModal` | export default function | 10 |
| 3 | `tr` | const arrow | 12 |

### 3.169 `business-os-v1-centralized-org-path/frontend/src/components/returns/Returns.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeScope` | function | 14 |
| 2 | `Returns` | export default function | 18 |
| 3 | `tr` | const arrow | 30 |
| 4 | `handleOpenEdit` | const arrow | 58 |
| 5 | `renderAmount` | const arrow | 121 |

### 3.170 `business-os-v1-centralized-org-path/frontend/src/components/sales/ExportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ExportModal` | export default function | 6 |
| 2 | `tr` | const arrow | 13 |
| 3 | `computeDates` | const arrow | 18 |
| 4 | `validateDates` | const arrow | 37 |
| 5 | `downloadCsvBlob` | const arrow | 45 |
| 6 | `buildCsvFallback` | const arrow | 55 |
| 7 | `escape` | const arrow | 59 |
| 8 | `handlePreview` | const arrow | 80 |
| 9 | `handleExportCSV` | const arrow | 93 |

### 3.171 `business-os-v1-centralized-org-path/frontend/src/components/sales/SaleDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `InfoBlock` | function | 5 |
| 2 | `parseItems` | function | 21 |
| 3 | `SaleDetailModal` | export default function | 31 |
| 4 | `translateOr` | const arrow | 47 |
| 5 | `handleStatusUpdate` | const arrow | 69 |
| 6 | `handleMembershipAttach` | const arrow | 80 |

### 3.172 `business-os-v1-centralized-org-path/frontend/src/components/sales/Sales.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `multiMatch` | function | 11 |
| 2 | `getSaleBranchLabel` | function | 15 |
| 3 | `Sales` | export default function | 23 |
| 4 | `handleStatusChange` | const arrow | 68 |
| 5 | `handleAttachMembership` | const arrow | 80 |

### 3.173 `business-os-v1-centralized-org-path/frontend/src/components/sales/StatusBadge.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getStatusLabel` | export function | 23 |
| 2 | `StatusBadge` | export default function | 39 |

### 3.174 `business-os-v1-centralized-org-path/frontend/src/components/server/ServerPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isAutoDetected` | function | 13 |
| 2 | `StatusRow` | function | 20 |
| 3 | `InfoTab` | function | 32 |
| 4 | `fmt` | const arrow | 83 |
| 5 | `DiagnosticsPanel` | function | 169 |
| 6 | `onErr` | const arrow | 181 |
| 7 | `ServerPage` | export default function | 314 |
| 8 | `check` | const arrow | 337 |
| 9 | `loadSecurityConfig` | const arrow | 359 |
| 10 | `handleTest` | function | 372 |
| 11 | `handleSave` | function | 394 |
| 12 | `handleDisconnect` | function | 401 |

### 3.175 `business-os-v1-centralized-org-path/frontend/src/components/shared/ImageGalleryLightbox.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ImageGalleryLightbox` | export default function | 8 |
| 2 | `formatLabel` | function | 30 |
| 3 | `setIndex` | function | 34 |
| 4 | `renderGalleryImage` | function | 40 |
| 5 | `onKeyDown` | function | 47 |

### 3.176 `business-os-v1-centralized-org-path/frontend/src/components/shared/Modal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Modal` | export default function | 10 |

### 3.177 `business-os-v1-centralized-org-path/frontend/src/components/shared/navigationConfig.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseNavSetting` | export function | 23 |
| 2 | `orderNavItems` | export function | 32 |

### 3.178 `business-os-v1-centralized-org-path/frontend/src/components/shared/PageHelpButton.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PageHelpButton` | export default function | 6 |

### 3.179 `business-os-v1-centralized-org-path/frontend/src/components/shared/pageHelpContent.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getPageHelpContent` | export function | 442 |

### 3.180 `business-os-v1-centralized-org-path/frontend/src/components/shared/PortalMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PortalMenu` | export default function | 11 |
| 2 | `closeIfClickedOutside` | const arrow | 48 |
| 3 | `closeMenu` | const arrow | 55 |
| 4 | `ThreeDotPortal` | export function | 124 |

### 3.181 `business-os-v1-centralized-org-path/frontend/src/components/users/PermissionEditor.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PermissionEditor` | export default function | 15 |
| 2 | `translate` | const arrow | 16 |
| 3 | `labelFor` | const arrow | 22 |
| 4 | `toggle` | const arrow | 25 |

### 3.182 `business-os-v1-centralized-org-path/frontend/src/components/users/UserDetailSheet.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `translateLabel` | function | 4 |
| 2 | `buildRowData` | function | 9 |
| 3 | `UserDetailSheet` | export default function | 21 |

### 3.183 `business-os-v1-centralized-org-path/frontend/src/components/users/UserProfileModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `AvatarPreview` | function | 19 |
| 2 | `UserProfileModal` | export default function | 37 |
| 3 | `tr` | const arrow | 39 |
| 4 | `loadProfile` | const arrow | 82 |
| 5 | `handleProfileSave` | const arrow | 128 |
| 6 | `handlePasswordSave` | const arrow | 181 |
| 7 | `handleSessionSave` | const arrow | 210 |
| 8 | `refreshOtpState` | const arrow | 219 |
| 9 | `handleAvatarPick` | const arrow | 225 |
| 10 | `handleStartOauthLink` | const arrow | 227 |
| 11 | `handleDisconnectOauthProvider` | const arrow | 263 |
| 12 | `handleAvatarSelected` | const arrow | 303 |

### 3.184 `business-os-v1-centralized-org-path/frontend/src/components/users/Users.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ThreeDot` | function | 22 |
| 2 | `formatContactValue` | function | 57 |
| 3 | `Users` | export default function | 62 |
| 4 | `tr` | const arrow | 65 |
| 5 | `canManageTargetUser` | const arrow | 89 |
| 6 | `load` | const arrow | 95 |
| 7 | `openCreateUser` | const arrow | 127 |
| 8 | `openEditUser` | const arrow | 134 |
| 9 | `openCreateRole` | const arrow | 151 |
| 10 | `openEditRole` | const arrow | 158 |
| 11 | `getRolePermissions` | const arrow | 169 |
| 12 | `getPermissionSummary` | const arrow | 178 |
| 13 | `handleSaveUser` | const arrow | 196 |
| 14 | `handleResetPassword` | const arrow | 245 |
| 15 | `handleSaveRole` | const arrow | 274 |
| 16 | `handleDeleteRole` | const arrow | 309 |

### 3.185 `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/AuditLog.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toIso` | function | 32 |
| 2 | `formatDateTime` | function | 38 |
| 3 | `formatLogTime` | function | 56 |
| 4 | `formatJsonPretty` | function | 60 |
| 5 | `parseLogJson` | function | 68 |
| 6 | `formatEntityName` | function | 76 |
| 7 | `extractReference` | function | 82 |
| 8 | `readableSummary` | function | 97 |
| 9 | `recordIdentifier` | function | 111 |
| 10 | `DetailRow` | function | 118 |
| 11 | `AuditLog` | export default function | 130 |

### 3.186 `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/Backup.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PathActionButton` | function | 30 |
| 2 | `PrimaryActionButton` | function | 42 |
| 3 | `useCopy` | function | 54 |
| 4 | `buildPathCrumbs` | function | 61 |
| 5 | `buildFinalDataFolderPath` | function | 79 |
| 6 | `formatDateTime` | function | 92 |
| 7 | `formatBytes` | function | 107 |
| 8 | `countBackupRows` | function | 116 |
| 9 | `buildBackupPreview` | function | 126 |
| 10 | `SectionChip` | function | 164 |
| 11 | `FolderBrowserPanel` | function | 179 |
| 12 | `DataFolderLocation` | function | 292 |
| 13 | `load` | const arrow | 302 |
| 14 | `openBrowser` | const arrow | 326 |
| 15 | `openDriveBrowser` | const arrow | 338 |
| 16 | `pickFolderNatively` | const arrow | 342 |
| 17 | `openInlinePicker` | const arrow | 369 |
| 18 | `openInExplorer` | const arrow | 377 |
| 19 | `selectDir` | const arrow | 392 |
| 20 | `handleApply` | const arrow | 398 |
| 21 | `handleReset` | const arrow | 419 |
| 22 | `GoogleDriveSyncSection` | function | 534 |
| 23 | `load` | const arrow | 547 |
| 24 | `handler` | const arrow | 568 |
| 25 | `savePreferences` | const arrow | 584 |
| 26 | `connectGoogleDrive` | const arrow | 603 |
| 27 | `syncNow` | const arrow | 637 |
| 28 | `disconnect` | const arrow | 654 |
| 29 | `Backup` | export default function | 792 |
| 30 | `browseServerFolders` | const arrow | 816 |
| 31 | `toggleServerBrowser` | const arrow | 829 |
| 32 | `handleExport` | const arrow | 840 |
| 33 | `pickFolder` | const arrow | 853 |
| 34 | `handleFolderExport` | const arrow | 866 |
| 35 | `handleFolderImport` | const arrow | 884 |
| 36 | `handleChooseImportFile` | const arrow | 905 |
| 37 | `handleConfirmImport` | const arrow | 921 |

### 3.187 `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/FontFamilyPicker.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `FontFamilyPicker` | function | 20 |

### 3.188 `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/index.js`

- No top-level named symbols detected.

### 3.189 `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/OtpModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `OtpModal` | function | 7 |
| 2 | `handleConfirm` | const arrow | 28 |
| 3 | `handleDisable` | const arrow | 39 |

### 3.190 `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/ResetData.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ConfirmReset` | function | 6 |
| 2 | `T` | const arrow | 19 |
| 3 | `ResetData` | function | 87 |
| 4 | `T` | const arrow | 89 |
| 5 | `doReset` | const arrow | 116 |
| 6 | `FactoryReset` | function | 174 |
| 7 | `T` | const arrow | 176 |
| 8 | `doFactoryReset` | function | 182 |

### 3.191 `business-os-v1-centralized-org-path/frontend/src/components/utils-settings/Settings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseStoredColors` | function | 91 |
| 2 | `buildColorChoices` | function | 102 |
| 3 | `useCopy` | function | 193 |
| 4 | `getSettingsNavLabel` | function | 201 |
| 5 | `SwatchPicker` | function | 218 |
| 6 | `Settings` | export default function | 301 |
| 7 | `setValue` | const arrow | 405 |
| 8 | `formatPreviewDateTime` | const arrow | 424 |
| 9 | `moveNavItem` | const arrow | 440 |
| 10 | `toggleMobilePinned` | const arrow | 450 |
| 11 | `movePinnedItem` | const arrow | 462 |
| 12 | `movePinnedBefore` | const arrow | 472 |
| 13 | `resetNavigationLayout` | const arrow | 484 |
| 14 | `field` | const arrow | 489 |
| 15 | `savePaymentMethods` | const arrow | 511 |
| 16 | `uploadImageSetting` | const arrow | 516 |

### 3.192 `business-os-v1-centralized-org-path/frontend/src/constants.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createEmptyOrder` | export function | 120 |
| 2 | `formatDate` | export function | 150 |
| 3 | `isNetworkError` | export function | 170 |

### 3.193 `business-os-v1-centralized-org-path/frontend/src/index.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isIgnoredRuntimeMessage` | const arrow | 17 |
| 2 | `safeInsertRule` | const function | 25 |
| 3 | `safeCssRulesGetter` | const function | 42 |
| 4 | `stopKnownStartupNoise` | const arrow | 58 |

### 3.194 `business-os-v1-centralized-org-path/frontend/src/utils/appRefresh.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `refreshAppData` | export function | 18 |

### 3.195 `business-os-v1-centralized-org-path/frontend/src/utils/csv.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `downloadCSV` | export function | 10 |

### 3.196 `business-os-v1-centralized-org-path/frontend/src/utils/dateHelpers.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `todayStr` | export function | 10 |
| 2 | `offsetDate` | export function | 20 |

### 3.197 `business-os-v1-centralized-org-path/frontend/src/utils/deviceInfo.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getClientDeviceInfo` | export function | 1 |
| 2 | `getClientMetaHeaders` | export function | 24 |

### 3.198 `business-os-v1-centralized-org-path/frontend/src/utils/favicon.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `clamp` | function | 1 |
| 2 | `loadImage` | function | 5 |
| 3 | `createCircularFaviconDataUrl` | export function | 19 |

### 3.199 `business-os-v1-centralized-org-path/frontend/src/utils/firebasePhoneAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `disabled` | function | 6 |
| 2 | `requestFirebasePhoneCode` | export function | 10 |
| 3 | `confirmFirebasePhoneCode` | export function | 14 |
| 4 | `cleanupFirebasePhoneVerification` | export function | 18 |

### 3.200 `business-os-v1-centralized-org-path/frontend/src/utils/formatters.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fmtTime` | export function | 9 |
| 2 | `fmtDate` | export function | 25 |
| 3 | `fmtShort` | export function | 39 |
| 4 | `fmtCount` | export function | 51 |

### 3.201 `business-os-v1-centralized-org-path/frontend/src/utils/index.js`

- No top-level named symbols detected.

### 3.202 `business-os-v1-centralized-org-path/frontend/src/utils/printReceipt.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cloneWithInlineStyles` | function | 80 |
| 2 | `mmToPt` | function | 103 |
| 3 | `dataUrlToBytes` | function | 107 |
| 4 | `joinPdfChunks` | function | 117 |
| 5 | `buildPdfStream` | function | 128 |
| 6 | `buildSingleImagePdf` | function | 137 |
| 7 | `escapePdfText` | function | 175 |
| 8 | `wrapTextLine` | function | 182 |
| 9 | `buildTextOnlyPdf` | function | 201 |
| 10 | `buildReceiptFileName` | function | 254 |
| 11 | `waitForElementAssets` | function | 264 |
| 12 | `renderElementToCanvas` | function | 293 |
| 13 | `withReceiptElement` | function | 344 |
| 14 | `downloadBlob` | function | 367 |
| 15 | `getPrintSettings` | export function | 378 |
| 16 | `savePrintSettings` | export function | 386 |
| 17 | `getPaperWidthMm` | export function | 392 |
| 18 | `createReceiptPdfBlob` | export function | 402 |
| 19 | `downloadReceiptPdf` | export function | 434 |
| 20 | `openReceiptPdf` | export function | 441 |
| 21 | `printReceipt` | export function | 454 |

### 3.203 `business-os-v1-centralized-org-path/frontend/src/web-api.js`

- No top-level named symbols detected.

### 3.204 `business-os-v1-centralized-org-path/frontend/tailwind.config.js`

- No top-level named symbols detected.

### 3.205 `business-os-v1-centralized-org-path/frontend/tests/appShellUtils.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.206 `business-os-v1-centralized-org-path/frontend/tests/portalEditorUtils.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |

### 3.207 `business-os-v1-centralized-org-path/frontend/vite.config.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fixCrossorigin` | function | 29 |

### 3.208 `business-os-v2-dedicated-server/backend/server.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadCompressionMiddleware` | function | 41 |
| 2 | `applySecurityHeaders` | function | 50 |
| 3 | `applyRequestPolicy` | function | 56 |
| 4 | `applyCoreMiddleware` | function | 66 |
| 5 | `mountStaticAssets` | function | 80 |
| 6 | `mountHealthRoute` | function | 94 |
| 7 | `mountApiRoutes` | function | 106 |
| 8 | `mountTransfersAlias` | function | 134 |
| 9 | `mountSpaFallback` | function | 149 |
| 10 | `mountErrorHandler` | function | 168 |
| 11 | `getStartupBanner` | function | 182 |
| 12 | `closeDatabase` | function | 202 |
| 13 | `registerShutdownHandlers` | function | 209 |
| 14 | `bootstrapServer` | function | 227 |

### 3.209 `business-os-v2-dedicated-server/backend/src/accessControl.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 19 |
| 2 | `normalizeHostname` | function | 23 |
| 3 | `getConfiguredSyncToken` | function | 29 |
| 4 | `getRequestHost` | function | 33 |
| 5 | `getRemoteAddress` | function | 39 |
| 6 | `isLoopbackAddress` | function | 47 |
| 7 | `getPresentedSyncToken` | function | 54 |
| 8 | `getTailscaleIdentity` | function | 60 |
| 9 | `hasTrustedTailscaleIdentity` | function | 69 |
| 10 | `isLocalHostRequest` | function | 76 |
| 11 | `isTsNetHost` | function | 81 |
| 12 | `getConfiguredTailscaleHost` | function | 86 |
| 13 | `isPublicRemoteRequest` | function | 90 |
| 14 | `isPublicApiRequest` | function | 98 |
| 15 | `classifyRequestAccess` | function | 104 |
| 16 | `authorizeProtectedRequest` | function | 132 |

### 3.210 `business-os-v2-dedicated-server/backend/src/backupSchema.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `countRowsByTable` | function | 61 |
| 2 | `countCustomTableRows` | function | 69 |
| 3 | `buildBackupSummary` | function | 75 |

### 3.211 `business-os-v2-dedicated-server/backend/src/config.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isDefaultDataMarker` | function | 42 |
| 2 | `resolveStoredDataDir` | function | 47 |
| 3 | `normalizeSelectedDataDir` | function | 54 |
| 4 | `readDataLocation` | function | 68 |
| 5 | `writeDataLocation` | function | 82 |

### 3.212 `business-os-v2-dedicated-server/backend/src/database.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `tableHasColumn` | function | 655 |
| 2 | `ensureColumn` | function | 665 |
| 3 | `normalizeUserPhoneLookup` | function | 677 |
| 4 | `slugifyOrgName` | function | 682 |
| 5 | `generateOrgPublicId` | function | 691 |
| 6 | `seedIfEmpty` | function | 785 |
| 7 | `ensureDefaultOrganizationAndGroup` | function | 796 |
| 8 | `ensurePrimaryAdminRoleAndUser` | function | 867 |

### 3.213 `business-os-v2-dedicated-server/backend/src/dataPath.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizePathForCompare` | function | 10 |
| 2 | `isSamePath` | function | 16 |
| 3 | `isSubPath` | function | 20 |
| 4 | `ensureDataRootLayout` | function | 25 |
| 5 | `walkFiles` | function | 30 |
| 6 | `summarizeDataRoot` | function | 48 |
| 7 | `copyDirectoryContents` | function | 89 |
| 8 | `buildArchivedTargetPath` | function | 126 |
| 9 | `relocateDataRoot` | function | 143 |

### 3.214 `business-os-v2-dedicated-server/backend/src/fileAssets.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ensureUploadsDirectory` | function | 43 |
| 2 | `getMimeTypeFromName` | function | 47 |
| 3 | `getMediaType` | function | 52 |
| 4 | `sanitizeOriginalFileName` | function | 61 |
| 5 | `preserveOriginalDisplayName` | function | 73 |
| 6 | `buildUniqueStoredName` | function | 80 |
| 7 | `shouldCompressImage` | function | 94 |
| 8 | `compressBufferForAsset` | function | 100 |
| 9 | `readImageDimensions` | function | 116 |
| 10 | `createFileAssetRecord` | function | 129 |
| 11 | `getFileAssetByPublicPath` | function | 189 |
| 12 | `listAssetRows` | function | 198 |
| 13 | `getUploadFilePath` | function | 220 |
| 14 | `collectUsage` | function | 225 |
| 15 | `serializeAssetRow` | function | 254 |
| 16 | `registerStoredAsset` | function | 264 |
| 17 | `registerUploadFromRequest` | function | 292 |
| 18 | `storeDataUrlAsset` | function | 304 |
| 19 | `backfillUploadAssets` | function | 326 |
| 20 | `listFileAssets` | function | 344 |
| 21 | `getFileAssetById` | function | 349 |
| 22 | `deleteFileAsset` | function | 354 |

### 3.215 `business-os-v2-dedicated-server/backend/src/helpers.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `logOp` | function | 21 |
| 2 | `getServerLog` | function | 26 |
| 3 | `ok` | function | 30 |
| 4 | `err` | function | 35 |
| 5 | `audit` | function | 50 |
| 6 | `broadcast` | function | 108 |
| 7 | `tryParse` | function | 121 |
| 8 | `today` | function | 126 |
| 9 | `bulkImportCSV` | function | 138 |
| 10 | `parseCSVLine` | function | 168 |
| 11 | `importRows` | function | 188 |
| 12 | `verifyAndRepairStockQuantities` | function | 203 |
| 13 | `verifyAndRepairSaleStatuses` | function | 272 |
| 14 | `verifyAndRepairCostPrices` | function | 332 |
| 15 | `runDataIntegrityCheck` | function | 402 |
| 16 | `getSafeCostPrice` | function | 429 |
| 17 | `calculateSaleProfit` | function | 440 |

### 3.216 `business-os-v2-dedicated-server/backend/src/middleware.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `authToken` | function | 16 |
| 2 | `networkAccessGuard` | function | 29 |
| 3 | `sanitiseFilename` | function | 34 |
| 4 | `resolveExtension` | function | 66 |
| 5 | `compressibleImageFormat` | function | 78 |
| 6 | `compressImageFile` | function | 83 |
| 7 | `compressImageBuffer` | function | 105 |
| 8 | `getClientKey` | function | 127 |
| 9 | `routeRateLimit` | function | 133 |
| 10 | `createStorage` | function | 145 |
| 11 | `buildUpload` | function | 161 |
| 12 | `compressUpload` | function | 193 |
| 13 | `validateUploadedFile` | function | 198 |
| 14 | `validateUploadBufferPayload` | function | 209 |

### 3.217 `business-os-v2-dedicated-server/backend/src/netSecurity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 26 |
| 2 | `normalizeHostname` | function | 30 |
| 3 | `isPrivateIpv4` | function | 34 |
| 4 | `isPrivateIpv6` | function | 47 |
| 5 | `isBlockedHostname` | function | 58 |
| 6 | `assertSafeOutboundUrl` | function | 69 |
| 7 | `isSafeExternalImageReference` | function | 97 |

### 3.218 `business-os-v2-dedicated-server/backend/src/organizationContext.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 9 |
| 2 | `slugify` | function | 13 |
| 3 | `generateOrganizationPublicId` | function | 21 |
| 4 | `getDefaultOrganization` | function | 25 |
| 5 | `getOrganizationById` | function | 34 |
| 6 | `findOrganizationByLookup` | function | 43 |
| 7 | `searchOrganizations` | function | 58 |
| 8 | `getOrganizationGroup` | function | 91 |
| 9 | `getDefaultOrganizationGroup` | function | 101 |
| 10 | `getOrganizationContextForUser` | function | 113 |
| 11 | `getPortalPublicPath` | function | 131 |
| 12 | `ensureOrganizationFilesystemLayout` | function | 136 |

### 3.219 `business-os-v2-dedicated-server/backend/src/portalUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toTrimmedString` | function | 5 |
| 2 | `safeJsonParse` | function | 9 |
| 3 | `createAboutBlock` | function | 17 |
| 4 | `normalizeAboutBlocks` | function | 28 |
| 5 | `extractGoogleMapsEmbedUrl` | function | 47 |
| 6 | `normalizeGoogleMapsEmbed` | function | 55 |

### 3.220 `business-os-v2-dedicated-server/backend/src/requestContext.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cleanText` | function | 7 |
| 2 | `readHeader` | function | 13 |
| 3 | `extractRequestMeta` | function | 19 |
| 4 | `requestContextMiddleware` | function | 45 |
| 5 | `getRequestMeta` | function | 50 |

### 3.221 `business-os-v2-dedicated-server/backend/src/routes/ai.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getActor` | function | 18 |
| 2 | `listProviders` | function | 25 |
| 3 | `getProviderRow` | function | 34 |

### 3.222 `business-os-v2-dedicated-server/backend/src/routes/auth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getClientKey` | function | 71 |
| 2 | `applyRateLimit` | function | 84 |
| 3 | `getLoginLockKey` | function | 96 |
| 4 | `normalizeLookupText` | function | 100 |
| 5 | `loginIdentifierPreview` | function | 107 |
| 6 | `rejectLogin` | function | 121 |
| 7 | `getOtpSecret` | function | 143 |
| 8 | `buildUserPayload` | function | 152 |
| 9 | `resolveOrganizationLookup` | function | 184 |
| 10 | `findUserByIdentifier` | function | 190 |
| 11 | `getExactActiveUserById` | function | 259 |
| 12 | `normalizeOauthMode` | function | 274 |
| 13 | `isEmailIdentifier` | function | 279 |
| 14 | `getUserById` | function | 283 |
| 15 | `generateTemporaryAuthPassword` | function | 287 |
| 16 | `issueAuthSession` | function | 291 |
| 17 | `updateLocalUserSupabaseIdentity` | function | 302 |

### 3.223 `business-os-v2-dedicated-server/backend/src/routes/branches.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toDbBool` | function | 9 |

### 3.224 `business-os-v2-dedicated-server/backend/src/routes/catalog.js`

- No top-level named symbols detected.

### 3.225 `business-os-v2-dedicated-server/backend/src/routes/categories.js`

- No top-level named symbols detected.

### 3.226 `business-os-v2-dedicated-server/backend/src/routes/contacts.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cleanMembershipNumber` | function | 9 |
| 2 | `assertUniqueMembershipNumber` | function | 14 |
| 3 | `normalizeConflictMode` | function | 28 |
| 4 | `toNumber` | function | 33 |
| 5 | `loadPointPolicy` | function | 38 |
| 6 | `calculatePolicyPoints` | function | 64 |
| 7 | `findExisting` | const arrow | 201 |
| 8 | `findExisting` | const arrow | 353 |
| 9 | `findExisting` | const arrow | 502 |

### 3.227 `business-os-v2-dedicated-server/backend/src/routes/customTables.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `humanizeTableName` | function | 9 |
| 2 | `serializeCustomTable` | function | 18 |

### 3.228 `business-os-v2-dedicated-server/backend/src/routes/files.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getActor` | function | 14 |
| 2 | `getDeviceMeta` | function | 21 |

### 3.229 `business-os-v2-dedicated-server/backend/src/routes/inventory.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBranchQty` | const arrow | 33 |

### 3.230 `business-os-v2-dedicated-server/backend/src/routes/organizations.js`

- No top-level named symbols detected.

### 3.231 `business-os-v2-dedicated-server/backend/src/routes/portal.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toNumber` | function | 22 |
| 2 | `normalizeBoolean` | function | 28 |
| 3 | `normalizePhone` | function | 34 |
| 4 | `normalizePublicPath` | function | 39 |
| 5 | `normalizeUrl` | function | 53 |
| 6 | `normalizeRedeemValueUsd` | function | 68 |
| 7 | `normalizeRedeemValueKhr` | function | 73 |
| 8 | `normalizeHexColor` | function | 80 |
| 9 | `normalizeFaqItems` | function | 86 |
| 10 | `loadSettingsMap` | function | 100 |
| 11 | `buildPortalConfig` | function | 108 |
| 12 | `calculatePointsValue` | function | 226 |
| 13 | `summarizePoints` | function | 236 |
| 14 | `getPortalProducts` | function | 276 |
| 15 | `findCustomerByMembership` | function | 333 |
| 16 | `sanitizeScreenshots` | function | 343 |
| 17 | `materializePortalScreenshots` | function | 352 |
| 18 | `sanitizeAiProfile` | function | 370 |
| 19 | `getVisitorFingerprint` | function | 382 |
| 20 | `getClientKey` | function | 388 |
| 21 | `applyPortalRateLimit` | function | 393 |

### 3.232 `business-os-v2-dedicated-server/backend/src/routes/products.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getActiveBranches` | function | 14 |
| 2 | `getDefaultBranch` | function | 18 |
| 3 | `seedBranchRows` | function | 22 |
| 4 | `recalcProductStock` | function | 27 |
| 5 | `normalizeImageGallery` | function | 36 |
| 6 | `syncProductImageGallery` | function | 53 |
| 7 | `loadProductImageMap` | function | 71 |
| 8 | `attachImageGallery` | function | 89 |
| 9 | `assertUniqueProductFields` | function | 101 |
| 10 | `resolveImage` | const arrow | 493 |
| 11 | `determineBranch` | const arrow | 509 |
| 12 | `handleBranch` | const arrow | 524 |
| 13 | `isDirectImageRef` | const arrow | 548 |
| 14 | `normalizeDirectImageRef` | const arrow | 559 |
| 15 | `parseIncomingImageRefs` | const arrow | 566 |
| 16 | `normalizeImageConflictMode` | const arrow | 599 |
| 17 | `loadCurrentGallery` | const arrow | 609 |

### 3.233 `business-os-v2-dedicated-server/backend/src/routes/returns.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeScope` | function | 11 |
| 2 | `toNumber` | function | 19 |
| 3 | `assertReturnableItems` | function | 24 |
| 4 | `assertSupplierReturnableStock` | function | 315 |

### 3.234 `business-os-v2-dedicated-server/backend/src/routes/sales.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSaleItemCosts` | function | 9 |
| 2 | `assertSaleStockAvailable` | function | 35 |
| 3 | `findCustomerForSaleAssignment` | function | 64 |
| 4 | `parseBranchId` | function | 85 |
| 5 | `getActiveBranchContext` | function | 90 |
| 6 | `requireActiveBranch` | function | 105 |
| 7 | `resolveSaleItemBranchId` | function | 112 |
| 8 | `normalizeSaleItems` | function | 123 |
| 9 | `summarizeSaleBranch` | function | 153 |
| 10 | `refreshProductStockQuantity` | function | 177 |
| 11 | `refreshProductStockQuantities` | function | 190 |
| 12 | `fetchSaleItemsWithBranches` | function | 197 |

### 3.235 `business-os-v2-dedicated-server/backend/src/routes/settings.js`

- No top-level named symbols detected.

### 3.236 `business-os-v2-dedicated-server/backend/src/routes/system.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `q` | function | 59 |
| 2 | `getClientKey` | function | 63 |
| 3 | `applyRouteRateLimit` | function | 69 |
| 4 | `runFsWorker` | function | 81 |
| 5 | `finish` | const arrow | 93 |
| 6 | `getHostUiAvailability` | function | 137 |
| 7 | `buildRequestBaseUrl` | function | 146 |
| 8 | `getTableColumns` | function | 153 |
| 9 | `extractUploadPathsFromText` | function | 157 |
| 10 | `collectBackupUploads` | function | 166 |
| 11 | `addUpload` | const arrow | 170 |
| 12 | `restoreBackupUploads` | function | 200 |
| 13 | `deleteAllUploads` | function | 210 |
| 14 | `getBackupDataRootCandidate` | function | 219 |
| 15 | `readBackupTablesFromDataRoot` | function | 231 |
| 16 | `restoreUploadsFromDataRoot` | function | 264 |
| 17 | `restoreSnapshotTables` | function | 278 |
| 18 | `ensurePrimaryAdminRoleAndUser` | function | 330 |
| 19 | `replaceTableRows` | function | 395 |
| 20 | `normaliseBackupTables` | function | 430 |
| 21 | `normaliseBackupCustomTableRows` | function | 459 |
| 22 | `repairRelationalConsistency` | function | 464 |
| 23 | `getCustomTableNames` | function | 472 |
| 24 | `parseCustomTableDefinition` | function | 478 |
| 25 | `recreateCustomTable` | function | 521 |
| 26 | `listWindowsFsRoots` | const arrow | 1061 |
| 27 | `listDriveRoots` | const arrow | 1078 |

### 3.237 `business-os-v2-dedicated-server/backend/src/routes/units.js`

- No top-level named symbols detected.

### 3.238 `business-os-v2-dedicated-server/backend/src/routes/users.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getClientKey` | function | 47 |
| 2 | `parseJson` | function | 53 |
| 3 | `normalizeLookupText` | function | 61 |
| 4 | `normalizePhoneLookup` | function | 65 |
| 5 | `findUserIdentityConflict` | function | 69 |
| 6 | `getMergedPermissions` | function | 137 |
| 7 | `isPrimaryAdmin` | function | 146 |
| 8 | `hasAdminControl` | function | 153 |
| 9 | `canManageTarget` | function | 166 |
| 10 | `getActorFromRequest` | function | 179 |
| 11 | `requireAdminControl` | function | 186 |
| 12 | `getUserSecurityContext` | function | 199 |
| 13 | `getUserWithRole` | function | 209 |
| 14 | `syncLocalEmailVerification` | function | 224 |
| 15 | `repairSupabaseIdentityForUser` | function | 255 |
| 16 | `sanitizeUserRow` | function | 284 |
| 17 | `isValidEmail` | function | 300 |
| 18 | `getAuthIdentityList` | function | 305 |
| 19 | `buildAuthMethodsPayload` | function | 309 |

### 3.239 `business-os-v2-dedicated-server/backend/src/security.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeEncryptionKey` | function | 9 |
| 2 | `isEncryptionConfigured` | function | 29 |
| 3 | `encryptSecret` | function | 33 |
| 4 | `decryptSecret` | function | 46 |
| 5 | `pruneRateBucket` | function | 67 |
| 6 | `checkRateLimit` | function | 79 |
| 7 | `resetRateLimit` | function | 108 |
| 8 | `safeCompare` | function | 115 |
| 9 | `getAbuseBucket` | function | 126 |
| 10 | `pruneAbuseBucket` | function | 136 |
| 11 | `checkAbuseLock` | function | 148 |
| 12 | `recordAbuseFailure` | function | 165 |
| 13 | `clearAbuseFailure` | function | 189 |

### 3.240 `business-os-v2-dedicated-server/backend/src/serverUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sanitizeObjectKeys` | function | 27 |
| 2 | `sanitizeStringValue` | function | 46 |
| 3 | `sanitizeRequestPayload` | function | 52 |
| 4 | `sanitizeDeepStrings` | function | 59 |
| 5 | `isApiOrHealthPath` | function | 76 |
| 6 | `isSpaFallbackEligible` | function | 80 |
| 7 | `setNoStoreHeaders` | function | 88 |
| 8 | `setHtmlNoCacheHeaders` | function | 92 |
| 9 | `setTunnelSecurityHeaders` | function | 98 |
| 10 | `setFrontendStaticHeaders` | function | 131 |
| 11 | `setUploadStaticHeaders` | function | 149 |
| 12 | `mapServerError` | function | 156 |

### 3.241 `business-os-v2-dedicated-server/backend/src/services/aiGateway.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 6 |
| 2 | `trim` | function | 10 |
| 3 | `parseJsonSafe` | function | 14 |
| 4 | `clamp` | function | 22 |
| 5 | `maskApiKey` | function | 26 |
| 6 | `getProviderMeta` | function | 96 |
| 7 | `normalizeProviderPayload` | function | 100 |
| 8 | `serializeProviderRow` | function | 132 |
| 9 | `providerCanUseWebResearch` | function | 165 |
| 10 | `resolveProviderEndpoint` | function | 170 |
| 11 | `callChatProvider` | function | 177 |
| 12 | `testProviderConfig` | function | 269 |

### 3.242 `business-os-v2-dedicated-server/backend/src/services/firebaseAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `truthy` | function | 16 |
| 2 | `trim` | function | 20 |
| 3 | `normalizePrivateKey` | function | 24 |
| 4 | `parseJsonSafe` | function | 28 |
| 5 | `loadServiceAccount` | function | 36 |
| 6 | `isFirebaseAuthConfigured` | function | 85 |
| 7 | `isFirebasePhoneVerificationConfigured` | function | 89 |
| 8 | `hasFirebaseAdminCredentials` | function | 93 |
| 9 | `base64Url` | function | 97 |
| 10 | `buildGoogleServiceJwt` | function | 106 |
| 11 | `getGoogleAccessToken` | function | 136 |
| 12 | `normalizeProviderError` | function | 172 |
| 13 | `parseResponseData` | function | 189 |
| 14 | `callFirebasePublic` | function | 193 |
| 15 | `callFirebaseAdmin` | function | 222 |
| 16 | `normalizeEmail` | function | 257 |
| 17 | `normalizeE164` | function | 262 |
| 18 | `getFirebaseAuthPublicConfig` | function | 270 |
| 19 | `createOrUpdateAuthUser` | function | 282 |
| 20 | `updateAuthPassword` | function | 323 |
| 21 | `setAuthUserActive` | function | 342 |
| 22 | `verifyPasswordWithFirebase` | function | 355 |

### 3.243 `business-os-v2-dedicated-server/backend/src/services/googleDriveSync.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 45 |
| 2 | `trim` | function | 49 |
| 3 | `toBool` | function | 53 |
| 4 | `clamp` | function | 61 |
| 5 | `escapeDriveQueryValue` | function | 67 |
| 6 | `readSettingsMap` | function | 71 |
| 7 | `writeSettingsMap` | function | 81 |
| 8 | `clearDriveSyncMappings` | function | 99 |
| 9 | `resetDriveSyncRootState` | function | 103 |
| 10 | `getDriveSyncConfig` | function | 110 |
| 11 | `getDriveSyncEntriesMap` | function | 131 |
| 12 | `upsertDriveSyncEntry` | function | 142 |
| 13 | `deleteDriveSyncEntry` | function | 168 |
| 14 | `deleteDriveSyncEntriesUnder` | function | 172 |
| 15 | `inferMimeType` | function | 179 |
| 16 | `md5File` | function | 194 |
| 17 | `buildMultipartBody` | function | 200 |
| 18 | `exchangeRefreshToken` | function | 217 |
| 19 | `exchangeAuthorizationCode` | function | 236 |
| 20 | `driveApiRequest` | function | 259 |
| 21 | `driveApiUpload` | function | 276 |
| 22 | `fetchDriveUserProfile` | function | 292 |
| 23 | `findDriveItem` | function | 307 |
| 24 | `findDriveItems` | function | 312 |
| 25 | `listDriveChildren` | function | 327 |
| 26 | `getDriveFileIfExists` | function | 336 |
| 27 | `removeDuplicateDriveItems` | function | 348 |
| 28 | `createDriveFolder` | function | 360 |
| 29 | `ensureRootFolder` | function | 372 |
| 30 | `ensureSnapshotLayout` | function | 391 |
| 31 | `shouldSkipSnapshotFile` | function | 397 |
| 32 | `createDataRootSnapshot` | function | 402 |
| 33 | `collectSnapshotItems` | function | 432 |
| 34 | `ensureRemoteDirectories` | function | 461 |
| 35 | `uploadDriveFile` | function | 496 |
| 36 | `updateDriveFile` | function | 511 |
| 37 | `removeDriveFile` | function | 522 |
| 38 | `runDriveSync` | function | 534 |
| 39 | `scheduleDriveSync` | function | 689 |
| 40 | `getDriveSyncStatus` | function | 712 |
| 41 | `beginGoogleDriveOAuth` | function | 743 |
| 42 | `prunePendingOauthStates` | function | 762 |
| 43 | `finalizeGoogleDriveOAuth` | function | 769 |
| 44 | `saveDriveSyncPreferences` | function | 811 |
| 45 | `disconnectDriveSync` | function | 830 |
| 46 | `schedulePeriodicDriveSync` | function | 848 |

### 3.244 `business-os-v2-dedicated-server/backend/src/services/portalAi.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 15 |
| 2 | `toNumber` | function | 19 |
| 3 | `tokenize` | function | 24 |
| 4 | `nowMs` | function | 32 |
| 5 | `getProviderPriority` | function | 36 |
| 6 | `getProviderCapacity` | function | 41 |
| 7 | `getProviderMaxInputChars` | function | 46 |
| 8 | `getProviderMaxCompletionTokens` | function | 51 |
| 9 | `getProviderTimeoutMs` | function | 56 |
| 10 | `getProviderCooldownMs` | function | 61 |
| 11 | `getRuntimeState` | function | 67 |
| 12 | `pruneProviderState` | function | 82 |
| 13 | `pruneVisitorActivity` | function | 88 |
| 14 | `registerVisitorActivity` | function | 96 |
| 15 | `countActiveVisitors` | function | 106 |
| 16 | `getVisitorMinuteCount` | function | 111 |
| 17 | `summarizeProfile` | function | 118 |
| 18 | `sanitizeQuestion` | function | 128 |
| 19 | `scoreProduct` | function | 132 |
| 20 | `selectCandidateProducts` | function | 164 |
| 21 | `buildPrompt` | function | 196 |
| 22 | `parseAssistantPayload` | function | 221 |
| 23 | `listEnabledChatProviders` | function | 287 |
| 24 | `chooseProviderForAttempt` | function | 306 |
| 25 | `markProviderStart` | function | 327 |
| 26 | `markProviderSuccess` | function | 335 |
| 27 | `markProviderFailure` | function | 342 |
| 28 | `getPortalAiUsageStatus` | function | 350 |
| 29 | `generatePortalAiResponse` | function | 378 |

### 3.245 `business-os-v2-dedicated-server/backend/src/services/supabaseAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `truthy` | function | 13 |
| 2 | `trim` | function | 17 |
| 3 | `parseJsonSafe` | function | 21 |
| 4 | `normalizeSupabaseUrl` | function | 29 |
| 5 | `normalizeEmail` | function | 33 |
| 6 | `isPlainObject` | function | 38 |
| 7 | `clampPassword` | function | 42 |
| 8 | `isAllowedOauthProvider` | function | 46 |
| 9 | `isHttpUrl` | function | 50 |
| 10 | `isSupabaseAuthConfigured` | function | 64 |
| 11 | `hasSupabaseAdminCredentials` | function | 68 |
| 12 | `hasSupabasePublicCredentials` | function | 72 |
| 13 | `buildSupabaseUrl` | function | 76 |
| 14 | `normalizeRedirectTo` | function | 80 |
| 15 | `getSupabaseAuthPublicConfig` | function | 85 |
| 16 | `normalizeProviderError` | function | 101 |
| 17 | `parseResponseData` | function | 118 |
| 18 | `callSupabasePublic` | function | 126 |
| 19 | `callSupabaseAdmin` | function | 159 |
| 20 | `getBanDurationForActiveState` | function | 193 |
| 21 | `buildUserMetadata` | function | 197 |
| 22 | `buildAppMetadata` | function | 207 |
| 23 | `getIdentityProviders` | function | 216 |
| 24 | `summarizeAuthUser` | function | 237 |
| 25 | `isLocalUserActive` | function | 254 |
| 26 | `getAuthUserById` | function | 258 |
| 27 | `getAuthUserFromAccessToken` | function | 266 |
| 28 | `listAuthUsersPage` | function | 276 |
| 29 | `findAuthUserByEmail` | function | 295 |
| 30 | `createOrUpdateAuthUser` | function | 315 |
| 31 | `updateAuthPassword` | function | 365 |
| 32 | `setAuthUserActive` | function | 384 |
| 33 | `verifyPasswordWithSupabase` | function | 399 |
| 34 | `unlinkAuthIdentity` | function | 424 |
| 35 | `sendSupabaseVerificationEmail` | function | 438 |
| 36 | `sendSupabasePasswordRecoveryEmail` | function | 477 |
| 37 | `buildOauthStartUrl` | function | 501 |

### 3.246 `business-os-v2-dedicated-server/backend/src/services/verification.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowMs` | function | 8 |
| 2 | `toIso` | function | 12 |
| 3 | `parseBool` | function | 16 |
| 4 | `isEmailProviderConfigured` | function | 23 |
| 5 | `getVerificationCapabilities` | function | 30 |
| 6 | `normalizeEmail` | function | 37 |
| 7 | `normalizePhone` | function | 44 |
| 8 | `maskDestination` | function | 52 |
| 9 | `generateCode` | function | 65 |
| 10 | `hashCode` | function | 69 |
| 11 | `resolveChannel` | function | 73 |
| 12 | `getDestinationForChannel` | function | 83 |
| 13 | `cleanupExpiredCodes` | function | 88 |
| 14 | `invalidateActiveCodes` | function | 96 |
| 15 | `createVerificationRecord` | function | 109 |
| 16 | `findActiveCode` | function | 136 |
| 17 | `consumeCode` | function | 151 |
| 18 | `verifyCode` | function | 155 |
| 19 | `messageForPurpose` | function | 164 |
| 20 | `sendEmail` | function | 183 |
| 21 | `requestVerificationCode` | function | 247 |

### 3.247 `business-os-v2-dedicated-server/backend/src/sessionAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `hashToken` | function | 11 |
| 2 | `buildSessionExpiry` | function | 15 |
| 3 | `createAuthSession` | function | 25 |
| 4 | `getPresentedSessionToken` | function | 46 |
| 5 | `getSessionUser` | function | 70 |
| 6 | `revokeAuthSession` | function | 133 |

### 3.248 `business-os-v2-dedicated-server/backend/src/systemFsWorker.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatBackupStamp` | function | 15 |
| 2 | `pad` | const arrow | 17 |
| 3 | `respond` | function | 21 |
| 4 | `fail` | function | 25 |
| 5 | `runExportFolder` | function | 30 |
| 6 | `runRelocateDataRoot` | function | 70 |
| 7 | `main` | function | 77 |

### 3.249 `business-os-v2-dedicated-server/backend/src/uploadSecurity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `bufferStartsWith` | function | 11 |
| 2 | `isLikelyCsvBuffer` | function | 15 |
| 3 | `detectBufferKind` | function | 28 |
| 4 | `getExpectedUploadedKind` | function | 42 |
| 5 | `validateImageMetadata` | function | 51 |
| 6 | `validateUploadedBuffer` | function | 65 |
| 7 | `validateUploadedPath` | function | 76 |

### 3.250 `business-os-v2-dedicated-server/backend/src/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `attachWss` | function | 19 |

### 3.251 `business-os-v2-dedicated-server/backend/test/accessControl.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |
| 2 | `makeReq` | function | 22 |

### 3.252 `business-os-v2-dedicated-server/backend/test/backupRoundtrip.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 19 |
| 2 | `makeTempRoot` | function | 39 |
| 3 | `getFreePort` | function | 43 |
| 4 | `waitForHealth` | function | 54 |
| 5 | `startServer` | function | 66 |
| 6 | `stopServer` | function | 87 |
| 7 | `fetchJson` | function | 101 |
| 8 | `loginAsAdmin` | function | 115 |
| 9 | `uploadPortalLogo` | function | 132 |
| 10 | `seedSourceServer` | function | 143 |
| 11 | `exportBackup` | function | 249 |
| 12 | `assertRoundtripState` | function | 257 |

### 3.253 `business-os-v2-dedicated-server/backend/test/backupSchema.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.254 `business-os-v2-dedicated-server/backend/test/dataPath.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 16 |
| 2 | `makeTempRoot` | function | 27 |

### 3.255 `business-os-v2-dedicated-server/backend/test/netSecurity.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |

### 3.256 `business-os-v2-dedicated-server/backend/test/portalUtils.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.257 `business-os-v2-dedicated-server/backend/test/serverUtils.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.258 `business-os-v2-dedicated-server/backend/test/uploadSecurity.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |

### 3.259 `business-os-v2-dedicated-server/frontend/postcss.config.js`

- No top-level named symbols detected.

### 3.260 `business-os-v2-dedicated-server/frontend/src/api/http.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSyncServerUrl` | export function | 39 |
| 2 | `getSyncToken` | export function | 40 |
| 3 | `getAuthSessionToken` | export function | 41 |
| 4 | `setSyncServerUrl` | export function | 43 |
| 5 | `setSyncToken` | export function | 44 |
| 6 | `setAuthSessionToken` | export function | 45 |
| 7 | `cacheGet` | export function | 52 |
| 8 | `cacheSet` | export function | 56 |
| 9 | `cacheInvalidate` | export function | 57 |
| 10 | `cacheClearAll` | export function | 60 |
| 11 | `logCall` | function | 74 |
| 12 | `getCallLog` | export function | 79 |
| 13 | `clearCallLog` | export function | 80 |
| 14 | `getClientMetaHeaders` | function | 82 |
| 15 | `dispatchGlobalDataRefresh` | function | 86 |
| 16 | `apiFetch` | export function | 96 |
| 17 | `parsed` | const arrow | 119 |
| 18 | `isNetErr` | export function | 139 |
| 19 | `isConnectivityError` | function | 145 |
| 20 | `isServerOnline` | export function | 164 |
| 21 | `setServerHealth` | function | 166 |
| 22 | `startHealthCheck` | export function | 181 |
| 23 | `cacheGetStale` | export function | 216 |
| 24 | `route` | export function | 233 |

### 3.261 `business-os-v2-dedicated-server/frontend/src/api/localDb.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `localGetSettings` | export function | 38 |
| 2 | `localSaveSettings` | export function | 45 |
| 3 | `parseCSV` | export function | 54 |
| 4 | `splitCSVLine` | function | 67 |
| 5 | `buildCSVTemplate` | export function | 78 |

### 3.262 `business-os-v2-dedicated-server/frontend/src/api/methods.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDeviceInfo` | function | 3 |
| 2 | `getPortalBaseUrl` | function | 19 |
| 3 | `getCurrentUserContext` | function | 24 |
| 4 | `queueOfflineWrite` | function | 39 |
| 5 | `appendActorQuery` | function | 48 |
| 6 | `fetchJsonWithTimeout` | function | 61 |
| 7 | `login` | export function | 80 |
| 8 | `logout` | export function | 83 |
| 9 | `resetPasswordWithOtp` | export function | 86 |
| 10 | `requestPasswordResetEmail` | export function | 89 |
| 11 | `completePasswordReset` | export function | 92 |
| 12 | `getVerificationCapabilities` | export function | 95 |
| 13 | `getSystemConfig` | export function | 98 |
| 14 | `getSystemDebugLog` | export function | 101 |
| 15 | `startSupabaseOauth` | export function | 104 |
| 16 | `completeSupabaseOauth` | export function | 107 |
| 17 | `getOrganizationBootstrap` | export function | 110 |
| 18 | `searchOrganizations` | export function | 113 |
| 19 | `getCurrentOrganization` | export function | 117 |
| 20 | `getSettings` | export function | 122 |
| 21 | `saveSettings` | export function | 125 |
| 22 | `getCategories` | const arrow | 131 |
| 23 | `updateCategory` | const arrow | 133 |
| 24 | `getUnits` | const arrow | 137 |
| 25 | `getCustomFields` | const arrow | 142 |
| 26 | `updateCustomField` | const arrow | 144 |
| 27 | `getBranches` | const arrow | 148 |
| 28 | `updateBranch` | const arrow | 150 |
| 29 | `deleteBranch` | const arrow | 151 |
| 30 | `getTransfers` | const arrow | 153 |
| 31 | `getProducts` | const arrow | 157 |
| 32 | `getCatalogMeta` | export function | 158 |
| 33 | `getCatalogProducts` | export function | 166 |
| 34 | `getPortalConfig` | export function | 174 |
| 35 | `getPortalCatalogMeta` | export function | 182 |
| 36 | `getPortalCatalogProducts` | export function | 190 |
| 37 | `lookupPortalMembership` | export function | 198 |
| 38 | `createPortalSubmission` | export function | 208 |
| 39 | `getPortalAiStatus` | export function | 222 |
| 40 | `askPortalAi` | export function | 230 |
| 41 | `getPortalSubmissionsForReview` | const arrow | 244 |
| 42 | `reviewPortalSubmission` | const arrow | 246 |
| 43 | `getAiProviders` | const arrow | 249 |
| 44 | `createAiProvider` | const arrow | 251 |
| 45 | `updateAiProvider` | const arrow | 253 |
| 46 | `deleteAiProvider` | const arrow | 255 |
| 47 | `testAiProvider` | const arrow | 257 |
| 48 | `getAiResponses` | const arrow | 259 |
| 49 | `createProduct` | export function | 261 |
| 50 | `updateProduct` | export function | 292 |
| 51 | `getFiles` | export function | 320 |
| 52 | `uploadFileAsset` | export function | 326 |
| 53 | `deleteFileAsset` | export function | 356 |
| 54 | `uploadProductImage` | export function | 365 |
| 55 | `uploadUserAvatar` | export function | 394 |
| 56 | `openCSVDialog` | export function | 431 |
| 57 | `openImageDialog` | export function | 451 |
| 58 | `getImageDataUrl` | export function | 459 |
| 59 | `getInventorySummary` | const arrow | 468 |
| 60 | `getInventoryMovements` | const arrow | 469 |
| 61 | `createSale` | export function | 472 |
| 62 | `flushPendingSyncQueue` | export function | 492 |
| 63 | `getSales` | const arrow | 550 |
| 64 | `getDashboard` | const arrow | 556 |
| 65 | `getAnalytics` | const arrow | 557 |
| 66 | `getCustomers` | const arrow | 566 |
| 67 | `updateCustomer` | const arrow | 568 |
| 68 | `downloadCustomerTemplate` | const arrow | 571 |
| 69 | `getSuppliers` | const arrow | 574 |
| 70 | `updateSupplier` | const arrow | 576 |
| 71 | `downloadSupplierTemplate` | const arrow | 579 |
| 72 | `getDeliveryContacts` | const arrow | 582 |
| 73 | `updateDeliveryContact` | const arrow | 584 |
| 74 | `getUsers` | const arrow | 589 |
| 75 | `updateUser` | const arrow | 591 |
| 76 | `getUserProfile` | const arrow | 592 |
| 77 | `getUserAuthMethods` | const arrow | 593 |
| 78 | `updateUserProfile` | const arrow | 595 |
| 79 | `disconnectUserAuthProvider` | const arrow | 597 |
| 80 | `changeUserPassword` | const arrow | 599 |
| 81 | `resetPassword` | const arrow | 601 |
| 82 | `getRoles` | const arrow | 604 |
| 83 | `updateRole` | const arrow | 606 |
| 84 | `deleteRole` | const arrow | 607 |
| 85 | `getCustomTables` | const arrow | 610 |
| 86 | `getCustomTableData` | const arrow | 612 |
| 87 | `insertCustomRow` | const arrow | 613 |
| 88 | `updateCustomRow` | const arrow | 614 |
| 89 | `deleteCustomRow` | const arrow | 615 |
| 90 | `getAuditLogs` | const arrow | 618 |
| 91 | `exportBackup` | export function | 621 |
| 92 | `exportBackupFolder` | export function | 638 |
| 93 | `pickBackupFile` | export function | 642 |
| 94 | `importBackupData` | export function | 657 |
| 95 | `importBackupFolder` | export function | 663 |
| 96 | `importBackup` | export function | 669 |
| 97 | `getGoogleDriveSyncStatus` | const arrow | 684 |
| 98 | `saveGoogleDriveSyncPreferences` | const arrow | 687 |
| 99 | `startGoogleDriveSyncOauth` | const arrow | 690 |
| 100 | `disconnectGoogleDriveSync` | const arrow | 693 |
| 101 | `syncGoogleDriveNow` | const arrow | 696 |
| 102 | `resetData` | export function | 699 |
| 103 | `factoryReset` | export function | 705 |
| 104 | `downloadImportTemplate` | export function | 712 |
| 105 | `openPath` | export function | 732 |
| 106 | `getReturns` | const arrow | 741 |
| 107 | `updateSaleStatus` | const arrow | 751 |
| 108 | `attachSaleCustomer` | const arrow | 755 |
| 109 | `getSalesExport` | const arrow | 758 |
| 110 | `updateReturn` | const arrow | 762 |
| 111 | `testSyncServer` | export function | 766 |
| 112 | `openFolderDialog` | export function | 785 |
| 113 | `getDataPath` | const arrow | 796 |
| 114 | `setDataPath` | const arrow | 797 |
| 115 | `resetDataPath` | const arrow | 798 |
| 116 | `browseDir` | const arrow | 799 |

### 3.263 `business-os-v2-dedicated-server/frontend/src/api/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `connectWS` | export function | 18 |
| 2 | `disconnectWS` | export function | 92 |
| 3 | `scheduleReconnect` | function | 100 |
| 4 | `isWSConnected` | export function | 116 |

### 3.264 `business-os-v2-dedicated-server/frontend/src/App.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getChunkErrorMessage` | function | 54 |
| 2 | `isChunkLoadError` | function | 59 |
| 3 | `createChunkTimeoutError` | function | 68 |
| 4 | `isRetryableImportError` | function | 74 |
| 5 | `importWithTimeout` | function | 82 |
| 6 | `clearRetryMarker` | function | 98 |
| 7 | `triggerChunkRecoveryReload` | function | 105 |
| 8 | `createChunkReloadStallError` | function | 115 |
| 9 | `shouldRetryChunk` | function | 121 |
| 10 | `lazyWithRetry` | function | 131 |
| 11 | `getWarmupImporters` | function | 198 |
| 12 | `useMountedPages` | function | 209 |
| 13 | `useSyncErrorBanner` | function | 223 |
| 14 | `onSyncError` | const arrow | 228 |
| 15 | `useVisibilityRecovery` | function | 239 |
| 16 | `onVisible` | const arrow | 243 |
| 17 | `onFocus` | const arrow | 253 |
| 18 | `useChunkWarmup` | function | 271 |
| 19 | `runWarmup` | const arrow | 282 |
| 20 | `PageErrorBoundary` | class | 310 |
| 21 | `Notification` | function | 358 |
| 22 | `SyncErrorBanner` | function | 370 |
| 23 | `PageLoader` | function | 390 |
| 24 | `PageSlot` | function | 401 |
| 25 | `PublicCatalogView` | function | 424 |
| 26 | `App` | export default function | 437 |

### 3.265 `business-os-v2-dedicated-server/frontend/src/app/appShellUtils.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isPublicCatalogPath` | export function | 7 |
| 2 | `updateMountedPages` | export function | 17 |
| 3 | `getNotificationPrefix` | export function | 27 |
| 4 | `getNotificationColor` | export function | 34 |

### 3.266 `business-os-v2-dedicated-server/frontend/src/AppContext.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readDeviceSettings` | function | 52 |
| 2 | `writeDeviceSettings` | function | 60 |
| 3 | `mergeSettingsWithDeviceOverrides` | function | 66 |
| 4 | `normalizeDateInput` | function | 70 |
| 5 | `LoadingScreen` | function | 95 |
| 6 | `AccessDenied` | function | 108 |
| 7 | `AppProvider` | export function | 120 |
| 8 | `onUpdate` | const arrow | 215 |
| 9 | `onStatus` | const arrow | 225 |
| 10 | `poll` | const arrow | 233 |
| 11 | `onError` | const arrow | 253 |
| 12 | `onUnauthorized` | const arrow | 257 |
| 13 | `handleOtpLogin` | const arrow | 289 |
| 14 | `handleUserUpdated` | const arrow | 329 |
| 15 | `discoverSyncUrl` | const arrow | 357 |
| 16 | `hexAlpha` | const arrow | 453 |
| 17 | `clearCallbackUrl` | const arrow | 618 |
| 18 | `clearPendingLink` | const arrow | 622 |
| 19 | `run` | const arrow | 626 |
| 20 | `useApp` | const arrow | 863 |
| 21 | `useSync` | const arrow | 864 |
| 22 | `useT` | const arrow | 867 |

### 3.267 `business-os-v2-dedicated-server/frontend/src/components/auth/Login.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `OauthButton` | function | 16 |
| 2 | `ModeBackButton` | function | 30 |
| 3 | `Login` | export default function | 43 |
| 4 | `tr` | const arrow | 45 |
| 5 | `rememberOrganization` | const arrow | 88 |
| 6 | `loadCapabilities` | const arrow | 115 |
| 7 | `bootstrap` | const arrow | 132 |
| 8 | `clearCallbackUrl` | const arrow | 191 |
| 9 | `run` | const arrow | 196 |
| 10 | `rememberedOrg` | const arrow | 224 |
| 11 | `getDeviceContext` | const arrow | 269 |
| 12 | `handleLogin` | const arrow | 271 |
| 13 | `handleOtp` | const arrow | 291 |
| 14 | `handleOtpInput` | const arrow | 321 |
| 15 | `handleResetWithOtp` | const arrow | 326 |
| 16 | `handleResetWithEmail` | const arrow | 360 |
| 17 | `handleCompleteEmailReset` | const arrow | 386 |
| 18 | `handleStartOauth` | const arrow | 416 |
| 19 | `closeAuxMode` | const arrow | 446 |

### 3.268 `business-os-v2-dedicated-server/frontend/src/components/branches/Branches.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatTransferDate` | function | 19 |
| 2 | `Branches` | export default function | 36 |
| 3 | `load` | const arrow | 58 |
| 4 | `loadBranchStock` | const arrow | 94 |
| 5 | `handleSaveBranch` | const arrow | 109 |
| 6 | `handleDelete` | const arrow | 128 |
| 7 | `handleBulkDelete` | const arrow | 143 |
| 8 | `toggleSelect` | const arrow | 168 |
| 9 | `toggleSelectAll` | const arrow | 177 |

### 3.269 `business-os-v2-dedicated-server/frontend/src/components/branches/BranchForm.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BranchForm` | export default function | 11 |
| 2 | `set` | const arrow | 33 |
| 3 | `handleSave` | const arrow | 45 |

### 3.270 `business-os-v2-dedicated-server/frontend/src/components/branches/TransferModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `TransferModal` | export default function | 11 |
| 2 | `run` | const arrow | 36 |
| 3 | `handleTransfer` | const arrow | 70 |

### 3.271 `business-os-v2-dedicated-server/frontend/src/components/catalog/CatalogPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getAboutBlockLabel` | function | 41 |
| 2 | `withAssetVersion` | function | 47 |
| 3 | `tt` | function | 522 |
| 4 | `toBoolean` | function | 527 |
| 5 | `toNumber` | function | 534 |
| 6 | `normalizePriceDisplay` | function | 540 |
| 7 | `normalizeHexColor` | function | 545 |
| 8 | `normalizeExternalUrl` | function | 551 |
| 9 | `buildFaqStarterItems` | function | 567 |
| 10 | `buildAiFaqStarterItems` | function | 647 |
| 11 | `hexToRgba` | function | 678 |
| 12 | `readPortalCache` | function | 689 |
| 13 | `writePortalCache` | function | 705 |
| 14 | `normalizePortalPath` | function | 719 |
| 15 | `isReservedPortalPath` | function | 732 |
| 16 | `buildDraft` | function | 737 |
| 17 | `applyDraft` | function | 821 |
| 18 | `statusClass` | function | 936 |
| 19 | `getBranchQty` | function | 943 |
| 20 | `getStockStatus` | function | 950 |
| 21 | `normalizeProductGallery` | function | 960 |
| 22 | `formatDateTime` | function | 978 |
| 23 | `formatPortalPrice` | function | 985 |
| 24 | `SectionShell` | function | 998 |
| 25 | `SummaryTile` | function | 1014 |
| 26 | `StatusPill` | function | 1038 |
| 27 | `ImageField` | function | 1053 |
| 28 | `pickImageAsDataUrl` | function | 1119 |
| 29 | `pickMultipleImagesAsDataUrls` | function | 1138 |
| 30 | `replaceVars` | function | 1159 |
| 31 | `applyGoogleTranslateSelection` | function | 1196 |
| 32 | `CatalogPage` | export default function | 1218 |
| 33 | `copy` | const arrow | 1289 |
| 34 | `resolveVisibleTab` | const arrow | 1290 |
| 35 | `openProductGallery` | function | 1382 |
| 36 | `changeTranslateTarget` | function | 1395 |
| 37 | `loadPortal` | function | 1407 |
| 38 | `run` | function | 1471 |
| 39 | `toggleFilterValue` | function | 1695 |
| 40 | `clearPortalFilters` | function | 1703 |
| 41 | `setDraft` | function | 1710 |
| 42 | `openPortalImage` | function | 1715 |
| 43 | `setAboutBlocksDraft` | function | 1726 |
| 44 | `updateAboutBlock` | function | 1730 |
| 45 | `addAboutBlock` | function | 1736 |
| 46 | `moveAboutBlockBefore` | function | 1740 |
| 47 | `removeAboutBlock` | function | 1752 |
| 48 | `setFaqDraft` | function | 1756 |
| 49 | `addFaqItem` | function | 1760 |
| 50 | `mergeFaqStarterItems` | function | 1771 |
| 51 | `addFaqStarterSet` | function | 1784 |
| 52 | `addAiFaqStarterSet` | function | 1788 |
| 53 | `updateFaqItem` | function | 1792 |
| 54 | `removeFaqItem` | function | 1798 |
| 55 | `clearAssistantState` | function | 1802 |
| 56 | `uploadPortalImage` | function | 1817 |
| 57 | `uploadDraftImage` | function | 1836 |
| 58 | `uploadAboutBlockMedia` | function | 1841 |
| 59 | `openFilePicker` | function | 1850 |
| 60 | `handleFilePickerSelect` | function | 1854 |
| 61 | `savePortalDraft` | function | 1870 |
| 62 | `askAssistant` | function | 1990 |
| 63 | `handleMembershipLookup` | function | 2023 |
| 64 | `addSubmissionImages` | function | 2049 |
| 65 | `handleSubmissionPaste` | function | 2058 |
| 66 | `handleSubmitShareProof` | function | 2074 |
| 67 | `handleReviewSubmission` | function | 2109 |

### 3.272 `business-os-v2-dedicated-server/frontend/src/components/catalog/portalEditorUtils.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toTrimmedString` | function | 3 |
| 2 | `safeJsonParse` | function | 7 |
| 3 | `createAboutBlock` | export function | 15 |
| 4 | `normalizeAboutBlocks` | export function | 27 |
| 5 | `serializeAboutBlocks` | export function | 47 |
| 6 | `moveListItem` | export function | 51 |
| 7 | `extractGoogleMapsEmbedUrl` | export function | 64 |
| 8 | `normalizeGoogleMapsEmbed` | export function | 72 |

### 3.273 `business-os-v2-dedicated-server/frontend/src/components/contacts/Contacts.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `TABS` | const arrow | 14 |
| 2 | `ImportTypePicker` | function | 20 |
| 3 | `T` | const arrow | 21 |
| 4 | `Contacts` | export default function | 60 |
| 5 | `handleExportAll` | const arrow | 67 |
| 6 | `openImportPicker` | const arrow | 118 |
| 7 | `handleTypeSelected` | const arrow | 120 |
| 8 | `handleImportDone` | const arrow | 125 |

### 3.274 `business-os-v2-dedicated-server/frontend/src/components/contacts/CustomersTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseContactOptions` | export function | 9 |
| 2 | `serializeContactOptions` | export function | 30 |
| 3 | `BLANK_OPTION` | const arrow | 41 |
| 4 | `generateMembershipNumber` | function | 43 |
| 5 | `tr` | function | 49 |
| 6 | `OptionEditor` | function | 54 |
| 7 | `setField` | const arrow | 55 |
| 8 | `buildOptionSummary` | function | 95 |
| 9 | `CustomerForm` | function | 103 |
| 10 | `setField` | const arrow | 113 |
| 11 | `addOption` | const arrow | 114 |
| 12 | `removeOption` | const arrow | 115 |
| 13 | `updateOption` | const arrow | 116 |
| 14 | `CustomersTab` | function | 190 |
| 15 | `handleSave` | const arrow | 230 |
| 16 | `handleDelete` | const arrow | 254 |
| 17 | `handleBulkDelete` | const arrow | 267 |

### 3.275 `business-os-v2-dedicated-server/frontend/src/components/contacts/DeliveryTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseDeliveryOptions` | export function | 15 |
| 2 | `serializeDeliveryOptions` | export function | 30 |
| 3 | `BLANK_OPTION` | const arrow | 37 |
| 4 | `OptionEditor` | function | 40 |
| 5 | `set` | const arrow | 41 |
| 6 | `DeliveryForm` | function | 71 |
| 7 | `set` | const arrow | 74 |
| 8 | `handleSave` | const arrow | 75 |
| 9 | `OptionsDisplay` | function | 115 |
| 10 | `OptionsBadge` | function | 132 |
| 11 | `DeliveryTab` | function | 143 |
| 12 | `handleSave` | const arrow | 174 |
| 13 | `handleDelete` | const arrow | 189 |
| 14 | `handleBulkDelete` | const arrow | 195 |

### 3.276 `business-os-v2-dedicated-server/frontend/src/components/contacts/shared.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `useContactSelection` | export function | 11 |
| 2 | `toggleOne` | const arrow | 25 |
| 3 | `clearSelection` | const arrow | 36 |
| 4 | `ThreeDotMenu` | export function | 62 |
| 5 | `DetailModal` | export function | 121 |
| 6 | `ContactTable` | export function | 152 |
| 7 | `ImportModal` | export function | 225 |
| 8 | `handlePickFile` | const arrow | 246 |
| 9 | `handleChooseExistingFile` | const arrow | 254 |
| 10 | `handleDownloadTemplate` | const arrow | 276 |
| 11 | `handleImport` | const arrow | 280 |

### 3.277 `business-os-v2-dedicated-server/frontend/src/components/contacts/SuppliersTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `SupplierForm` | function | 9 |
| 2 | `set` | const arrow | 14 |
| 3 | `SuppliersTab` | function | 60 |
| 4 | `handleSave` | const arrow | 101 |
| 5 | `handleDelete` | const arrow | 121 |
| 6 | `handleBulkDelete` | const arrow | 134 |

### 3.278 `business-os-v2-dedicated-server/frontend/src/components/custom-tables/CustomTables.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CustomTables` | export default function | 6 |
| 2 | `loadTables` | const arrow | 17 |
| 3 | `addColumn` | const arrow | 39 |
| 4 | `updateColumn` | const arrow | 43 |
| 5 | `removeColumn` | const arrow | 47 |
| 6 | `handleCreateTable` | const arrow | 51 |
| 7 | `handleSaveRow` | const arrow | 64 |
| 8 | `handleDeleteRow` | const arrow | 78 |
| 9 | `openAddRow` | const arrow | 84 |
| 10 | `openEditRow` | const arrow | 91 |

### 3.279 `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/BarChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BarChart` | export default function | 14 |
| 2 | `yPx` | function | 32 |

### 3.280 `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/DonutChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `DonutChart` | export default function | 14 |

### 3.281 `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/index.js`

- No top-level named symbols detected.

### 3.282 `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/LineChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `LineChart` | export default function | 13 |
| 2 | `xPx` | function | 29 |
| 3 | `yPx` | function | 30 |
| 4 | `handleMouseMove` | const arrow | 35 |

### 3.283 `business-os-v2-dedicated-server/frontend/src/components/dashboard/charts/NoData.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NoData` | export default function | 7 |

### 3.284 `business-os-v2-dedicated-server/frontend/src/components/dashboard/Dashboard.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Dashboard` | export default function | 11 |
| 2 | `translateOr` | const arrow | 15 |
| 3 | `calcTrend` | const arrow | 94 |
| 4 | `rangeLabel` | const arrow | 119 |
| 5 | `periodShort` | const arrow | 125 |
| 6 | `buildExportAll` | const arrow | 232 |

### 3.285 `business-os-v2-dedicated-server/frontend/src/components/dashboard/MiniStat.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `MiniStat` | export default function | 2 |

### 3.286 `business-os-v2-dedicated-server/frontend/src/components/files/FilePickerModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `AssetPreview` | function | 5 |
| 2 | `FilePickerModal` | export default function | 15 |
| 3 | `tr` | const arrow | 33 |
| 4 | `loadFiles` | function | 38 |
| 5 | `toggleSelectedPath` | function | 69 |
| 6 | `handleUpload` | function | 79 |
| 7 | `handleDelete` | function | 114 |

### 3.287 `business-os-v2-dedicated-server/frontend/src/components/files/FilesPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `AssetPreview` | function | 21 |
| 2 | `formatDateTime` | function | 35 |
| 3 | `ProviderStatus` | function | 45 |
| 4 | `emptyProviderForm` | function | 56 |
| 5 | `compactTabLabel` | function | 79 |
| 6 | `FilesPage` | export default function | 85 |
| 7 | `tr` | const arrow | 106 |
| 8 | `loadFiles` | function | 146 |
| 9 | `loadProviders` | function | 158 |
| 10 | `loadResponses` | function | 171 |
| 11 | `handleUpload` | function | 183 |
| 12 | `handleDeleteAsset` | function | 199 |
| 13 | `startCreateProvider` | function | 215 |
| 14 | `startEditProvider` | function | 231 |
| 15 | `saveProvider` | function | 255 |
| 16 | `testProvider` | function | 298 |
| 17 | `removeProvider` | function | 312 |
| 18 | `tabButton` | const arrow | 325 |

### 3.288 `business-os-v2-dedicated-server/frontend/src/components/inventory/DualMoney.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `DualMoney` | function | 5 |

### 3.289 `business-os-v2-dedicated-server/frontend/src/components/inventory/Inventory.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Inventory` | export default function | 13 |
| 2 | `handleAdjust` | const arrow | 93 |
| 3 | `openAdjust` | const arrow | 124 |
| 4 | `matchesSearch` | const arrow | 137 |
| 5 | `productHay` | const arrow | 144 |
| 6 | `movHay` | const arrow | 147 |

### 3.290 `business-os-v2-dedicated-server/frontend/src/components/inventory/movementGroups.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `minuteBucket` | function | 1 |
| 2 | `normalizeText` | function | 8 |
| 3 | `buildGroupKey` | function | 12 |
| 4 | `describeMovementType` | function | 28 |
| 5 | `buildMovementGroups` | export function | 33 |
| 6 | `movementGroupHaystack` | export function | 94 |

### 3.291 `business-os-v2-dedicated-server/frontend/src/components/inventory/ProductDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductDetailModal` | function | 6 |
| 2 | `T` | const arrow | 7 |

### 3.292 `business-os-v2-dedicated-server/frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sanitizeInteger` | function | 101 |
| 2 | `sanitizeKhr` | function | 106 |
| 3 | `formatLookupValue` | function | 112 |
| 4 | `LoyaltyPointsPage` | export default function | 116 |
| 5 | `copy` | const arrow | 119 |
| 6 | `loadCustomerPoints` | function | 150 |
| 7 | `setValue` | function | 185 |
| 8 | `handleSave` | function | 189 |
| 9 | `handleLookup` | function | 211 |

### 3.293 `business-os-v2-dedicated-server/frontend/src/components/navigation/Sidebar.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getFallbackLabel` | function | 47 |
| 2 | `getNavLabel` | function | 55 |
| 3 | `isDarkColor` | function | 71 |
| 4 | `withAlpha` | function | 81 |
| 5 | `mergeStyles` | function | 87 |
| 6 | `Sidebar` | export default function | 91 |

### 3.294 `business-os-v2-dedicated-server/frontend/src/components/pos/CartItem.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CartItem` | function | 7 |

### 3.295 `business-os-v2-dedicated-server/frontend/src/components/pos/FilterPanel.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `POSFilterPanel` | export default function | 3 |
| 2 | `T` | const arrow | 24 |
| 3 | `clearAll` | const arrow | 34 |
| 4 | `chip` | const arrow | 42 |
| 5 | `SectionLabel` | const arrow | 48 |

### 3.296 `business-os-v2-dedicated-server/frontend/src/components/pos/POS.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `allTermsMatch` | function | 42 |
| 2 | `POS` | export default function | 47 |
| 3 | `posCopy` | const arrow | 50 |
| 4 | `setQuickFilter` | const arrow | 85 |
| 5 | `addNewOrder` | const arrow | 150 |
| 6 | `closeOrder` | const arrow | 162 |
| 7 | `loadMembership` | function | 307 |
| 8 | `selectCustomer` | const arrow | 329 |
| 9 | `applyCustomerOption` | const arrow | 377 |
| 10 | `clearCustomer` | const arrow | 391 |
| 11 | `handleAddCustomer` | const arrow | 399 |
| 12 | `selectDelivery` | const arrow | 415 |
| 13 | `clearDelivery` | const arrow | 420 |
| 14 | `handleAddDelivery` | const arrow | 422 |
| 15 | `filteredProducts` | const arrow | 463 |
| 16 | `qty` | const arrow | 492 |
| 17 | `addToCart` | const arrow | 600 |
| 18 | `updateQty` | const arrow | 626 |
| 19 | `updatePrice` | const arrow | 634 |
| 20 | `updateItemBranch` | const arrow | 646 |
| 21 | `handleDiscountUsd` | const arrow | 695 |
| 22 | `handleDiscountKhr` | const arrow | 696 |
| 23 | `handleMembershipUnits` | const arrow | 697 |
| 24 | `handleCheckout` | const arrow | 714 |

### 3.297 `business-os-v2-dedicated-server/frontend/src/components/pos/ProductImage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductImage` | export default function | 7 |

### 3.298 `business-os-v2-dedicated-server/frontend/src/components/pos/QuickAddModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `QuickAddModal` | function | 5 |
| 2 | `T` | const arrow | 6 |

### 3.299 `business-os-v2-dedicated-server/frontend/src/components/products/BranchStockAdjuster.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BranchStockAdjuster` | function | 6 |
| 2 | `setRow` | const arrow | 16 |
| 3 | `handleSave` | const arrow | 19 |

### 3.300 `business-os-v2-dedicated-server/frontend/src/components/products/BulkAddStockModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BulkAddStockModal` | function | 6 |
| 2 | `handleSave` | const arrow | 13 |

### 3.301 `business-os-v2-dedicated-server/frontend/src/components/products/BulkImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBaseName` | function | 12 |
| 2 | `parseCSVContent` | function | 19 |
| 3 | `getIncomingImageFilenames` | function | 39 |
| 4 | `getExistingImageFilenames` | function | 72 |
| 5 | `BulkImportModal` | export default function | 90 |
| 6 | `T` | const arrow | 105 |
| 7 | `resetCsvState` | const arrow | 107 |
| 8 | `pickImageDirectory` | const arrow | 116 |
| 9 | `addLibraryImages` | const arrow | 145 |
| 10 | `handleImageOnlyImport` | const arrow | 161 |
| 11 | `handlePickCSV` | const arrow | 183 |
| 12 | `handleImport` | const arrow | 256 |

### 3.302 `business-os-v2-dedicated-server/frontend/src/components/products/HeaderActions.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductsHeaderActions` | export default function | 4 |

### 3.303 `business-os-v2-dedicated-server/frontend/src/components/products/ManageBrandsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseBrandOptions` | function | 5 |
| 2 | `toTitleCase` | function | 18 |
| 3 | `ManageBrandsModal` | export default function | 26 |
| 4 | `saveLibrary` | const arrow | 59 |
| 5 | `addLibraryBrand` | const arrow | 70 |
| 6 | `renameBrand` | const arrow | 92 |
| 7 | `removeBrand` | const arrow | 138 |

### 3.304 `business-os-v2-dedicated-server/frontend/src/components/products/ManageCategoriesModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ManageCategoriesModal` | function | 7 |
| 2 | `load` | const arrow | 16 |
| 3 | `handleAdd` | const arrow | 20 |
| 4 | `handleUpdate` | const arrow | 29 |
| 5 | `handleDelete` | const arrow | 37 |

### 3.305 `business-os-v2-dedicated-server/frontend/src/components/products/ManageFieldsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ManageFieldsModal` | function | 6 |
| 2 | `load` | const arrow | 13 |
| 3 | `handleSave` | const arrow | 16 |

### 3.306 `business-os-v2-dedicated-server/frontend/src/components/products/ManageMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ManageMenu` | export default function | 5 |

### 3.307 `business-os-v2-dedicated-server/frontend/src/components/products/ManageUnitsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ManageUnitsModal` | function | 6 |
| 2 | `load` | const arrow | 11 |
| 3 | `handleAddUnit` | const arrow | 14 |

### 3.308 `business-os-v2-dedicated-server/frontend/src/components/products/primitives.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductImg` | function | 7 |
| 2 | `ProductImagePlaceholder` | function | 41 |
| 3 | `MarginCard` | function | 49 |
| 4 | `DualPriceInput` | function | 81 |
| 5 | `handleUsdChange` | const arrow | 82 |
| 6 | `handleKhrChange` | const arrow | 88 |

### 3.309 `business-os-v2-dedicated-server/frontend/src/components/products/ProductDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductDetailModal` | export default function | 4 |
| 2 | `T` | const arrow | 15 |
| 3 | `Row` | const arrow | 25 |

### 3.310 `business-os-v2-dedicated-server/frontend/src/components/products/ProductForm.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeGallery` | function | 7 |
| 2 | `pickImageFiles` | function | 23 |
| 3 | `parseCustomFieldOptions` | function | 41 |
| 4 | `ProductForm` | export default function | 52 |
| 5 | `setField` | function | 130 |
| 6 | `setCustomField` | function | 134 |
| 7 | `addImages` | function | 144 |
| 8 | `removeImage` | function | 167 |
| 9 | `setPrimaryImage` | function | 171 |
| 10 | `saveForm` | function | 181 |

### 3.311 `business-os-v2-dedicated-server/frontend/src/components/products/Products.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `multiMatch` | function | 23 |
| 2 | `ThreeDot` | function | 27 |
| 3 | `Products` | export default function | 33 |
| 4 | `handleSave` | const arrow | 82 |
| 5 | `normalizeGallery` | const arrow | 133 |
| 6 | `uploadGalleryImages` | const arrow | 149 |
| 7 | `handleSaveWithGallery` | const arrow | 171 |
| 8 | `handleBulkDelete` | const arrow | 203 |
| 9 | `handleBulkOutOfStock` | const arrow | 216 |
| 10 | `handleBulkChangeBranch` | const arrow | 232 |
| 11 | `handleBulkAddStock` | const arrow | 269 |
| 12 | `toggleSelect` | const arrow | 274 |
| 13 | `toggleSelectAll` | const arrow | 279 |
| 14 | `handleDelete` | const arrow | 283 |
| 15 | `resolveImageUrl` | const arrow | 307 |
| 16 | `getProductGallery` | const arrow | 318 |
| 17 | `openLightbox` | const arrow | 320 |
| 18 | `getBranchQty` | const arrow | 328 |
| 19 | `getStockBadge` | const arrow | 329 |
| 20 | `toImageName` | const arrow | 390 |
| 21 | `toImageUrl` | const arrow | 391 |

### 3.312 `business-os-v2-dedicated-server/frontend/src/components/products/VariantFormModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `VariantFormModal` | function | 8 |
| 2 | `set` | const arrow | 21 |
| 3 | `handleSave` | const arrow | 24 |

### 3.313 `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/AllFieldsPanel.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Toggle` | function | 5 |
| 2 | `AllFieldsPanel` | export default function | 21 |
| 3 | `T` | const arrow | 23 |
| 4 | `toggleSection` | const arrow | 42 |

### 3.314 `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/constants.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getFieldItems` | export function | 52 |
| 2 | `T` | const arrow | 53 |

### 3.315 `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/ErrorBoundary.jsx`

- No top-level named symbols detected.

### 3.316 `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/FieldOrderManager.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSectionOrderItems` | function | 4 |
| 2 | `buildList` | function | 23 |
| 3 | `toKeys` | function | 48 |
| 4 | `FieldOrderManager` | export default function | 52 |
| 5 | `moveItem` | const arrow | 66 |
| 6 | `addDivider` | const arrow | 74 |
| 7 | `removeDivider` | const arrow | 85 |
| 8 | `handleDragStart` | const arrow | 91 |
| 9 | `handleDragOver` | const arrow | 96 |

### 3.317 `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/PrintSettings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Section` | function | 5 |
| 2 | `PrintSettings` | export default function | 17 |
| 3 | `T` | const arrow | 18 |
| 4 | `setValue` | const arrow | 27 |
| 5 | `resetMargins` | const arrow | 35 |

### 3.318 `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/ReceiptPreview.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ReceiptPreview` | export default function | 3 |

### 3.319 `business-os-v2-dedicated-server/frontend/src/components/receipt-settings/ReceiptSettings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Section` | function | 13 |
| 2 | `Toggle` | function | 24 |
| 3 | `parseTemplate` | function | 39 |
| 4 | `ReceiptSettings` | export default function | 44 |
| 5 | `handleSave` | const arrow | 113 |

### 3.320 `business-os-v2-dedicated-server/frontend/src/components/receipt/Receipt.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseTpl` | export function | 8 |
| 2 | `stripEmoji` | function | 16 |
| 3 | `displayAddress` | function | 21 |
| 4 | `parseItems` | function | 30 |
| 5 | `labelFor` | function | 95 |
| 6 | `Row` | function | 100 |
| 7 | `Receipt` | export default function | 112 |
| 8 | `em` | const arrow | 123 |
| 9 | `exportReceiptPdf` | const arrow | 319 |

### 3.321 `business-os-v2-dedicated-server/frontend/src/components/returns/EditReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `EditReturnModal` | function | 6 |
| 2 | `T` | const arrow | 8 |
| 3 | `updateQty` | const arrow | 33 |
| 4 | `updateRestock` | const arrow | 36 |
| 5 | `handleSubmit` | const arrow | 44 |

### 3.322 `business-os-v2-dedicated-server/frontend/src/components/returns/NewReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NewReturnModal` | function | 7 |
| 2 | `T` | const arrow | 9 |
| 3 | `handleSearch` | const arrow | 34 |
| 4 | `handleReturnTypeChange` | const arrow | 74 |
| 5 | `toggleIncluded` | const arrow | 79 |
| 6 | `updateItemQty` | const arrow | 87 |
| 7 | `updateItemRestock` | const arrow | 95 |
| 8 | `selectAll` | const arrow | 99 |
| 9 | `clearAll` | const arrow | 102 |
| 10 | `handleSubmit` | const arrow | 109 |

### 3.323 `business-os-v2-dedicated-server/frontend/src/components/returns/NewSupplierReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NewSupplierReturnModal` | export default function | 4 |
| 2 | `tr` | const arrow | 6 |
| 3 | `updateQty` | const arrow | 113 |
| 4 | `submit` | const arrow | 119 |

### 3.324 `business-os-v2-dedicated-server/frontend/src/components/returns/ReturnDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeScope` | function | 6 |
| 2 | `ReturnDetailModal` | export default function | 10 |
| 3 | `tr` | const arrow | 12 |

### 3.325 `business-os-v2-dedicated-server/frontend/src/components/returns/Returns.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeScope` | function | 14 |
| 2 | `Returns` | export default function | 18 |
| 3 | `tr` | const arrow | 30 |
| 4 | `handleOpenEdit` | const arrow | 58 |
| 5 | `renderAmount` | const arrow | 121 |

### 3.326 `business-os-v2-dedicated-server/frontend/src/components/sales/ExportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ExportModal` | export default function | 6 |
| 2 | `tr` | const arrow | 13 |
| 3 | `computeDates` | const arrow | 18 |
| 4 | `validateDates` | const arrow | 37 |
| 5 | `downloadCsvBlob` | const arrow | 45 |
| 6 | `buildCsvFallback` | const arrow | 55 |
| 7 | `escape` | const arrow | 59 |
| 8 | `handlePreview` | const arrow | 80 |
| 9 | `handleExportCSV` | const arrow | 93 |

### 3.327 `business-os-v2-dedicated-server/frontend/src/components/sales/SaleDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `InfoBlock` | function | 5 |
| 2 | `parseItems` | function | 21 |
| 3 | `SaleDetailModal` | export default function | 31 |
| 4 | `translateOr` | const arrow | 47 |
| 5 | `handleStatusUpdate` | const arrow | 69 |
| 6 | `handleMembershipAttach` | const arrow | 80 |

### 3.328 `business-os-v2-dedicated-server/frontend/src/components/sales/Sales.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `multiMatch` | function | 11 |
| 2 | `getSaleBranchLabel` | function | 15 |
| 3 | `Sales` | export default function | 23 |
| 4 | `handleStatusChange` | const arrow | 68 |
| 5 | `handleAttachMembership` | const arrow | 80 |

### 3.329 `business-os-v2-dedicated-server/frontend/src/components/sales/StatusBadge.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getStatusLabel` | export function | 23 |
| 2 | `StatusBadge` | export default function | 39 |

### 3.330 `business-os-v2-dedicated-server/frontend/src/components/server/ServerPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isAutoDetected` | function | 13 |
| 2 | `StatusRow` | function | 20 |
| 3 | `InfoTab` | function | 32 |
| 4 | `fmt` | const arrow | 83 |
| 5 | `DiagnosticsPanel` | function | 169 |
| 6 | `onErr` | const arrow | 181 |
| 7 | `ServerPage` | export default function | 314 |
| 8 | `check` | const arrow | 337 |
| 9 | `loadSecurityConfig` | const arrow | 359 |
| 10 | `handleTest` | function | 372 |
| 11 | `handleSave` | function | 394 |
| 12 | `handleDisconnect` | function | 401 |

### 3.331 `business-os-v2-dedicated-server/frontend/src/components/shared/ImageGalleryLightbox.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ImageGalleryLightbox` | export default function | 8 |
| 2 | `formatLabel` | function | 30 |
| 3 | `setIndex` | function | 34 |
| 4 | `renderGalleryImage` | function | 40 |
| 5 | `onKeyDown` | function | 47 |

### 3.332 `business-os-v2-dedicated-server/frontend/src/components/shared/Modal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Modal` | export default function | 10 |

### 3.333 `business-os-v2-dedicated-server/frontend/src/components/shared/navigationConfig.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseNavSetting` | export function | 23 |
| 2 | `orderNavItems` | export function | 32 |

### 3.334 `business-os-v2-dedicated-server/frontend/src/components/shared/PageHelpButton.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PageHelpButton` | export default function | 6 |

### 3.335 `business-os-v2-dedicated-server/frontend/src/components/shared/pageHelpContent.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getPageHelpContent` | export function | 442 |

### 3.336 `business-os-v2-dedicated-server/frontend/src/components/shared/PortalMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PortalMenu` | export default function | 11 |
| 2 | `closeIfClickedOutside` | const arrow | 48 |
| 3 | `closeMenu` | const arrow | 55 |
| 4 | `ThreeDotPortal` | export function | 124 |

### 3.337 `business-os-v2-dedicated-server/frontend/src/components/users/PermissionEditor.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PermissionEditor` | export default function | 15 |
| 2 | `translate` | const arrow | 16 |
| 3 | `labelFor` | const arrow | 22 |
| 4 | `toggle` | const arrow | 25 |

### 3.338 `business-os-v2-dedicated-server/frontend/src/components/users/UserDetailSheet.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `translateLabel` | function | 4 |
| 2 | `buildRowData` | function | 9 |
| 3 | `UserDetailSheet` | export default function | 21 |

### 3.339 `business-os-v2-dedicated-server/frontend/src/components/users/UserProfileModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `AvatarPreview` | function | 19 |
| 2 | `UserProfileModal` | export default function | 37 |
| 3 | `tr` | const arrow | 39 |
| 4 | `loadProfile` | const arrow | 82 |
| 5 | `handleProfileSave` | const arrow | 128 |
| 6 | `handlePasswordSave` | const arrow | 181 |
| 7 | `handleSessionSave` | const arrow | 210 |
| 8 | `refreshOtpState` | const arrow | 219 |
| 9 | `handleAvatarPick` | const arrow | 225 |
| 10 | `handleStartOauthLink` | const arrow | 227 |
| 11 | `handleDisconnectOauthProvider` | const arrow | 263 |
| 12 | `handleAvatarSelected` | const arrow | 303 |

### 3.340 `business-os-v2-dedicated-server/frontend/src/components/users/Users.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ThreeDot` | function | 22 |
| 2 | `formatContactValue` | function | 57 |
| 3 | `Users` | export default function | 62 |
| 4 | `tr` | const arrow | 65 |
| 5 | `canManageTargetUser` | const arrow | 89 |
| 6 | `load` | const arrow | 95 |
| 7 | `openCreateUser` | const arrow | 127 |
| 8 | `openEditUser` | const arrow | 134 |
| 9 | `openCreateRole` | const arrow | 151 |
| 10 | `openEditRole` | const arrow | 158 |
| 11 | `getRolePermissions` | const arrow | 169 |
| 12 | `getPermissionSummary` | const arrow | 178 |
| 13 | `handleSaveUser` | const arrow | 196 |
| 14 | `handleResetPassword` | const arrow | 245 |
| 15 | `handleSaveRole` | const arrow | 274 |
| 16 | `handleDeleteRole` | const arrow | 309 |

### 3.341 `business-os-v2-dedicated-server/frontend/src/components/utils-settings/AuditLog.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toIso` | function | 32 |
| 2 | `formatDateTime` | function | 38 |
| 3 | `formatLogTime` | function | 56 |
| 4 | `formatJsonPretty` | function | 60 |
| 5 | `parseLogJson` | function | 68 |
| 6 | `formatEntityName` | function | 76 |
| 7 | `extractReference` | function | 82 |
| 8 | `readableSummary` | function | 97 |
| 9 | `recordIdentifier` | function | 111 |
| 10 | `DetailRow` | function | 118 |
| 11 | `AuditLog` | export default function | 130 |

### 3.342 `business-os-v2-dedicated-server/frontend/src/components/utils-settings/Backup.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PathActionButton` | function | 30 |
| 2 | `PrimaryActionButton` | function | 42 |
| 3 | `useCopy` | function | 54 |
| 4 | `buildPathCrumbs` | function | 61 |
| 5 | `buildFinalDataFolderPath` | function | 79 |
| 6 | `formatDateTime` | function | 92 |
| 7 | `formatBytes` | function | 107 |
| 8 | `countBackupRows` | function | 116 |
| 9 | `buildBackupPreview` | function | 126 |
| 10 | `SectionChip` | function | 164 |
| 11 | `FolderBrowserPanel` | function | 179 |
| 12 | `DataFolderLocation` | function | 292 |
| 13 | `load` | const arrow | 302 |
| 14 | `openBrowser` | const arrow | 326 |
| 15 | `openDriveBrowser` | const arrow | 338 |
| 16 | `pickFolderNatively` | const arrow | 342 |
| 17 | `openInlinePicker` | const arrow | 369 |
| 18 | `openInExplorer` | const arrow | 377 |
| 19 | `selectDir` | const arrow | 392 |
| 20 | `handleApply` | const arrow | 398 |
| 21 | `handleReset` | const arrow | 419 |
| 22 | `GoogleDriveSyncSection` | function | 534 |
| 23 | `load` | const arrow | 547 |
| 24 | `handler` | const arrow | 568 |
| 25 | `savePreferences` | const arrow | 584 |
| 26 | `connectGoogleDrive` | const arrow | 603 |
| 27 | `syncNow` | const arrow | 637 |
| 28 | `disconnect` | const arrow | 654 |
| 29 | `Backup` | export default function | 792 |
| 30 | `browseServerFolders` | const arrow | 816 |
| 31 | `toggleServerBrowser` | const arrow | 829 |
| 32 | `handleExport` | const arrow | 840 |
| 33 | `pickFolder` | const arrow | 853 |
| 34 | `handleFolderExport` | const arrow | 866 |
| 35 | `handleFolderImport` | const arrow | 884 |
| 36 | `handleChooseImportFile` | const arrow | 905 |
| 37 | `handleConfirmImport` | const arrow | 921 |

### 3.343 `business-os-v2-dedicated-server/frontend/src/components/utils-settings/FontFamilyPicker.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `FontFamilyPicker` | function | 20 |

### 3.344 `business-os-v2-dedicated-server/frontend/src/components/utils-settings/index.js`

- No top-level named symbols detected.

### 3.345 `business-os-v2-dedicated-server/frontend/src/components/utils-settings/OtpModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `OtpModal` | function | 7 |
| 2 | `handleConfirm` | const arrow | 28 |
| 3 | `handleDisable` | const arrow | 39 |

### 3.346 `business-os-v2-dedicated-server/frontend/src/components/utils-settings/ResetData.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ConfirmReset` | function | 6 |
| 2 | `T` | const arrow | 19 |
| 3 | `ResetData` | function | 87 |
| 4 | `T` | const arrow | 89 |
| 5 | `doReset` | const arrow | 116 |
| 6 | `FactoryReset` | function | 174 |
| 7 | `T` | const arrow | 176 |
| 8 | `doFactoryReset` | function | 182 |

### 3.347 `business-os-v2-dedicated-server/frontend/src/components/utils-settings/Settings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseStoredColors` | function | 91 |
| 2 | `buildColorChoices` | function | 102 |
| 3 | `useCopy` | function | 193 |
| 4 | `getSettingsNavLabel` | function | 201 |
| 5 | `SwatchPicker` | function | 218 |
| 6 | `Settings` | export default function | 301 |
| 7 | `setValue` | const arrow | 405 |
| 8 | `formatPreviewDateTime` | const arrow | 424 |
| 9 | `moveNavItem` | const arrow | 440 |
| 10 | `toggleMobilePinned` | const arrow | 450 |
| 11 | `movePinnedItem` | const arrow | 462 |
| 12 | `movePinnedBefore` | const arrow | 472 |
| 13 | `resetNavigationLayout` | const arrow | 484 |
| 14 | `field` | const arrow | 489 |
| 15 | `savePaymentMethods` | const arrow | 511 |
| 16 | `uploadImageSetting` | const arrow | 516 |

### 3.348 `business-os-v2-dedicated-server/frontend/src/constants.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createEmptyOrder` | export function | 120 |
| 2 | `formatDate` | export function | 150 |
| 3 | `isNetworkError` | export function | 170 |

### 3.349 `business-os-v2-dedicated-server/frontend/src/index.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isIgnoredRuntimeMessage` | const arrow | 17 |
| 2 | `safeInsertRule` | const function | 25 |
| 3 | `safeCssRulesGetter` | const function | 42 |
| 4 | `stopKnownStartupNoise` | const arrow | 58 |

### 3.350 `business-os-v2-dedicated-server/frontend/src/utils/appRefresh.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `refreshAppData` | export function | 18 |

### 3.351 `business-os-v2-dedicated-server/frontend/src/utils/csv.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `downloadCSV` | export function | 10 |

### 3.352 `business-os-v2-dedicated-server/frontend/src/utils/dateHelpers.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `todayStr` | export function | 10 |
| 2 | `offsetDate` | export function | 20 |

### 3.353 `business-os-v2-dedicated-server/frontend/src/utils/deviceInfo.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getClientDeviceInfo` | export function | 1 |
| 2 | `getClientMetaHeaders` | export function | 24 |

### 3.354 `business-os-v2-dedicated-server/frontend/src/utils/favicon.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `clamp` | function | 1 |
| 2 | `loadImage` | function | 5 |
| 3 | `createCircularFaviconDataUrl` | export function | 19 |

### 3.355 `business-os-v2-dedicated-server/frontend/src/utils/firebasePhoneAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `disabled` | function | 6 |
| 2 | `requestFirebasePhoneCode` | export function | 10 |
| 3 | `confirmFirebasePhoneCode` | export function | 14 |
| 4 | `cleanupFirebasePhoneVerification` | export function | 18 |

### 3.356 `business-os-v2-dedicated-server/frontend/src/utils/formatters.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fmtTime` | export function | 9 |
| 2 | `fmtDate` | export function | 25 |
| 3 | `fmtShort` | export function | 39 |
| 4 | `fmtCount` | export function | 51 |

### 3.357 `business-os-v2-dedicated-server/frontend/src/utils/index.js`

- No top-level named symbols detected.

### 3.358 `business-os-v2-dedicated-server/frontend/src/utils/printReceipt.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cloneWithInlineStyles` | function | 80 |
| 2 | `mmToPt` | function | 103 |
| 3 | `dataUrlToBytes` | function | 107 |
| 4 | `joinPdfChunks` | function | 117 |
| 5 | `buildPdfStream` | function | 128 |
| 6 | `buildSingleImagePdf` | function | 137 |
| 7 | `escapePdfText` | function | 175 |
| 8 | `wrapTextLine` | function | 182 |
| 9 | `buildTextOnlyPdf` | function | 201 |
| 10 | `buildReceiptFileName` | function | 254 |
| 11 | `waitForElementAssets` | function | 264 |
| 12 | `renderElementToCanvas` | function | 293 |
| 13 | `withReceiptElement` | function | 344 |
| 14 | `downloadBlob` | function | 367 |
| 15 | `getPrintSettings` | export function | 378 |
| 16 | `savePrintSettings` | export function | 386 |
| 17 | `getPaperWidthMm` | export function | 392 |
| 18 | `createReceiptPdfBlob` | export function | 402 |
| 19 | `downloadReceiptPdf` | export function | 434 |
| 20 | `openReceiptPdf` | export function | 441 |
| 21 | `printReceipt` | export function | 454 |

### 3.359 `business-os-v2-dedicated-server/frontend/src/web-api.js`

- No top-level named symbols detected.

### 3.360 `business-os-v2-dedicated-server/frontend/tailwind.config.js`

- No top-level named symbols detected.

### 3.361 `business-os-v2-dedicated-server/frontend/tests/appShellUtils.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.362 `business-os-v2-dedicated-server/frontend/tests/portalEditorUtils.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |

### 3.363 `business-os-v2-dedicated-server/frontend/vite.config.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fixCrossorigin` | function | 29 |

### 3.364 `business-os-v3-centralized-server-template/backend/server.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadCompressionMiddleware` | function | 41 |
| 2 | `applySecurityHeaders` | function | 50 |
| 3 | `applyRequestPolicy` | function | 56 |
| 4 | `applyCoreMiddleware` | function | 66 |
| 5 | `mountStaticAssets` | function | 80 |
| 6 | `mountHealthRoute` | function | 94 |
| 7 | `mountApiRoutes` | function | 106 |
| 8 | `mountTransfersAlias` | function | 134 |
| 9 | `mountSpaFallback` | function | 149 |
| 10 | `mountErrorHandler` | function | 168 |
| 11 | `getStartupBanner` | function | 182 |
| 12 | `closeDatabase` | function | 202 |
| 13 | `registerShutdownHandlers` | function | 209 |
| 14 | `bootstrapServer` | function | 227 |

### 3.365 `business-os-v3-centralized-server-template/backend/src/accessControl.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 19 |
| 2 | `normalizeHostname` | function | 23 |
| 3 | `getConfiguredSyncToken` | function | 29 |
| 4 | `getRequestHost` | function | 33 |
| 5 | `getRemoteAddress` | function | 39 |
| 6 | `isLoopbackAddress` | function | 47 |
| 7 | `getPresentedSyncToken` | function | 54 |
| 8 | `getTailscaleIdentity` | function | 60 |
| 9 | `hasTrustedTailscaleIdentity` | function | 69 |
| 10 | `isLocalHostRequest` | function | 76 |
| 11 | `isTsNetHost` | function | 81 |
| 12 | `getConfiguredTailscaleHost` | function | 86 |
| 13 | `isPublicRemoteRequest` | function | 90 |
| 14 | `isPublicApiRequest` | function | 98 |
| 15 | `classifyRequestAccess` | function | 104 |
| 16 | `authorizeProtectedRequest` | function | 132 |

### 3.366 `business-os-v3-centralized-server-template/backend/src/backupSchema.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `countRowsByTable` | function | 61 |
| 2 | `countCustomTableRows` | function | 69 |
| 3 | `buildBackupSummary` | function | 75 |

### 3.367 `business-os-v3-centralized-server-template/backend/src/config.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isDefaultDataMarker` | function | 42 |
| 2 | `resolveStoredDataDir` | function | 47 |
| 3 | `normalizeSelectedDataDir` | function | 54 |
| 4 | `readDataLocation` | function | 68 |
| 5 | `writeDataLocation` | function | 82 |

### 3.368 `business-os-v3-centralized-server-template/backend/src/database.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `tableHasColumn` | function | 655 |
| 2 | `ensureColumn` | function | 665 |
| 3 | `normalizeUserPhoneLookup` | function | 677 |
| 4 | `slugifyOrgName` | function | 682 |
| 5 | `generateOrgPublicId` | function | 691 |
| 6 | `seedIfEmpty` | function | 785 |
| 7 | `ensureDefaultOrganizationAndGroup` | function | 796 |
| 8 | `ensurePrimaryAdminRoleAndUser` | function | 867 |

### 3.369 `business-os-v3-centralized-server-template/backend/src/dataPath.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizePathForCompare` | function | 10 |
| 2 | `isSamePath` | function | 16 |
| 3 | `isSubPath` | function | 20 |
| 4 | `ensureDataRootLayout` | function | 25 |
| 5 | `walkFiles` | function | 30 |
| 6 | `summarizeDataRoot` | function | 48 |
| 7 | `copyDirectoryContents` | function | 89 |
| 8 | `buildArchivedTargetPath` | function | 126 |
| 9 | `relocateDataRoot` | function | 143 |

### 3.370 `business-os-v3-centralized-server-template/backend/src/fileAssets.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ensureUploadsDirectory` | function | 43 |
| 2 | `getMimeTypeFromName` | function | 47 |
| 3 | `getMediaType` | function | 52 |
| 4 | `sanitizeOriginalFileName` | function | 61 |
| 5 | `preserveOriginalDisplayName` | function | 73 |
| 6 | `buildUniqueStoredName` | function | 80 |
| 7 | `shouldCompressImage` | function | 94 |
| 8 | `compressBufferForAsset` | function | 100 |
| 9 | `readImageDimensions` | function | 116 |
| 10 | `createFileAssetRecord` | function | 129 |
| 11 | `getFileAssetByPublicPath` | function | 189 |
| 12 | `listAssetRows` | function | 198 |
| 13 | `getUploadFilePath` | function | 220 |
| 14 | `collectUsage` | function | 225 |
| 15 | `serializeAssetRow` | function | 254 |
| 16 | `registerStoredAsset` | function | 264 |
| 17 | `registerUploadFromRequest` | function | 292 |
| 18 | `storeDataUrlAsset` | function | 304 |
| 19 | `backfillUploadAssets` | function | 326 |
| 20 | `listFileAssets` | function | 344 |
| 21 | `getFileAssetById` | function | 349 |
| 22 | `deleteFileAsset` | function | 354 |

### 3.371 `business-os-v3-centralized-server-template/backend/src/helpers.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `logOp` | function | 21 |
| 2 | `getServerLog` | function | 26 |
| 3 | `ok` | function | 30 |
| 4 | `err` | function | 35 |
| 5 | `audit` | function | 50 |
| 6 | `broadcast` | function | 108 |
| 7 | `tryParse` | function | 121 |
| 8 | `today` | function | 126 |
| 9 | `bulkImportCSV` | function | 138 |
| 10 | `parseCSVLine` | function | 168 |
| 11 | `importRows` | function | 188 |
| 12 | `verifyAndRepairStockQuantities` | function | 203 |
| 13 | `verifyAndRepairSaleStatuses` | function | 272 |
| 14 | `verifyAndRepairCostPrices` | function | 332 |
| 15 | `runDataIntegrityCheck` | function | 402 |
| 16 | `getSafeCostPrice` | function | 429 |
| 17 | `calculateSaleProfit` | function | 440 |

### 3.372 `business-os-v3-centralized-server-template/backend/src/middleware.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `authToken` | function | 16 |
| 2 | `networkAccessGuard` | function | 29 |
| 3 | `sanitiseFilename` | function | 34 |
| 4 | `resolveExtension` | function | 66 |
| 5 | `compressibleImageFormat` | function | 78 |
| 6 | `compressImageFile` | function | 83 |
| 7 | `compressImageBuffer` | function | 105 |
| 8 | `getClientKey` | function | 127 |
| 9 | `routeRateLimit` | function | 133 |
| 10 | `createStorage` | function | 145 |
| 11 | `buildUpload` | function | 161 |
| 12 | `compressUpload` | function | 193 |
| 13 | `validateUploadedFile` | function | 198 |
| 14 | `validateUploadBufferPayload` | function | 209 |

### 3.373 `business-os-v3-centralized-server-template/backend/src/netSecurity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 26 |
| 2 | `normalizeHostname` | function | 30 |
| 3 | `isPrivateIpv4` | function | 34 |
| 4 | `isPrivateIpv6` | function | 47 |
| 5 | `isBlockedHostname` | function | 58 |
| 6 | `assertSafeOutboundUrl` | function | 69 |
| 7 | `isSafeExternalImageReference` | function | 97 |

### 3.374 `business-os-v3-centralized-server-template/backend/src/organizationContext.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 9 |
| 2 | `slugify` | function | 13 |
| 3 | `generateOrganizationPublicId` | function | 21 |
| 4 | `getDefaultOrganization` | function | 25 |
| 5 | `getOrganizationById` | function | 34 |
| 6 | `findOrganizationByLookup` | function | 43 |
| 7 | `searchOrganizations` | function | 58 |
| 8 | `getOrganizationGroup` | function | 91 |
| 9 | `getDefaultOrganizationGroup` | function | 101 |
| 10 | `getOrganizationContextForUser` | function | 113 |
| 11 | `getPortalPublicPath` | function | 131 |
| 12 | `ensureOrganizationFilesystemLayout` | function | 136 |

### 3.375 `business-os-v3-centralized-server-template/backend/src/portalUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toTrimmedString` | function | 5 |
| 2 | `safeJsonParse` | function | 9 |
| 3 | `createAboutBlock` | function | 17 |
| 4 | `normalizeAboutBlocks` | function | 28 |
| 5 | `extractGoogleMapsEmbedUrl` | function | 47 |
| 6 | `normalizeGoogleMapsEmbed` | function | 55 |

### 3.376 `business-os-v3-centralized-server-template/backend/src/requestContext.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cleanText` | function | 7 |
| 2 | `readHeader` | function | 13 |
| 3 | `extractRequestMeta` | function | 19 |
| 4 | `requestContextMiddleware` | function | 45 |
| 5 | `getRequestMeta` | function | 50 |

### 3.377 `business-os-v3-centralized-server-template/backend/src/routes/ai.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getActor` | function | 18 |
| 2 | `listProviders` | function | 25 |
| 3 | `getProviderRow` | function | 34 |

### 3.378 `business-os-v3-centralized-server-template/backend/src/routes/auth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getClientKey` | function | 71 |
| 2 | `applyRateLimit` | function | 84 |
| 3 | `getLoginLockKey` | function | 96 |
| 4 | `normalizeLookupText` | function | 100 |
| 5 | `loginIdentifierPreview` | function | 107 |
| 6 | `rejectLogin` | function | 121 |
| 7 | `getOtpSecret` | function | 143 |
| 8 | `buildUserPayload` | function | 152 |
| 9 | `resolveOrganizationLookup` | function | 184 |
| 10 | `findUserByIdentifier` | function | 190 |
| 11 | `getExactActiveUserById` | function | 259 |
| 12 | `normalizeOauthMode` | function | 274 |
| 13 | `isEmailIdentifier` | function | 279 |
| 14 | `getUserById` | function | 283 |
| 15 | `generateTemporaryAuthPassword` | function | 287 |
| 16 | `issueAuthSession` | function | 291 |
| 17 | `updateLocalUserSupabaseIdentity` | function | 302 |

### 3.379 `business-os-v3-centralized-server-template/backend/src/routes/branches.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toDbBool` | function | 9 |

### 3.380 `business-os-v3-centralized-server-template/backend/src/routes/catalog.js`

- No top-level named symbols detected.

### 3.381 `business-os-v3-centralized-server-template/backend/src/routes/categories.js`

- No top-level named symbols detected.

### 3.382 `business-os-v3-centralized-server-template/backend/src/routes/contacts.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cleanMembershipNumber` | function | 9 |
| 2 | `assertUniqueMembershipNumber` | function | 14 |
| 3 | `normalizeConflictMode` | function | 28 |
| 4 | `toNumber` | function | 33 |
| 5 | `loadPointPolicy` | function | 38 |
| 6 | `calculatePolicyPoints` | function | 64 |
| 7 | `findExisting` | const arrow | 201 |
| 8 | `findExisting` | const arrow | 353 |
| 9 | `findExisting` | const arrow | 502 |

### 3.383 `business-os-v3-centralized-server-template/backend/src/routes/customTables.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `humanizeTableName` | function | 9 |
| 2 | `serializeCustomTable` | function | 18 |

### 3.384 `business-os-v3-centralized-server-template/backend/src/routes/files.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getActor` | function | 14 |
| 2 | `getDeviceMeta` | function | 21 |

### 3.385 `business-os-v3-centralized-server-template/backend/src/routes/inventory.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBranchQty` | const arrow | 33 |

### 3.386 `business-os-v3-centralized-server-template/backend/src/routes/organizations.js`

- No top-level named symbols detected.

### 3.387 `business-os-v3-centralized-server-template/backend/src/routes/portal.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toNumber` | function | 22 |
| 2 | `normalizeBoolean` | function | 28 |
| 3 | `normalizePhone` | function | 34 |
| 4 | `normalizePublicPath` | function | 39 |
| 5 | `normalizeUrl` | function | 53 |
| 6 | `normalizeRedeemValueUsd` | function | 68 |
| 7 | `normalizeRedeemValueKhr` | function | 73 |
| 8 | `normalizeHexColor` | function | 80 |
| 9 | `normalizeFaqItems` | function | 86 |
| 10 | `loadSettingsMap` | function | 100 |
| 11 | `buildPortalConfig` | function | 108 |
| 12 | `calculatePointsValue` | function | 226 |
| 13 | `summarizePoints` | function | 236 |
| 14 | `getPortalProducts` | function | 276 |
| 15 | `findCustomerByMembership` | function | 333 |
| 16 | `sanitizeScreenshots` | function | 343 |
| 17 | `materializePortalScreenshots` | function | 352 |
| 18 | `sanitizeAiProfile` | function | 370 |
| 19 | `getVisitorFingerprint` | function | 382 |
| 20 | `getClientKey` | function | 388 |
| 21 | `applyPortalRateLimit` | function | 393 |

### 3.388 `business-os-v3-centralized-server-template/backend/src/routes/products.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getActiveBranches` | function | 14 |
| 2 | `getDefaultBranch` | function | 18 |
| 3 | `seedBranchRows` | function | 22 |
| 4 | `recalcProductStock` | function | 27 |
| 5 | `normalizeImageGallery` | function | 36 |
| 6 | `syncProductImageGallery` | function | 53 |
| 7 | `loadProductImageMap` | function | 71 |
| 8 | `attachImageGallery` | function | 89 |
| 9 | `assertUniqueProductFields` | function | 101 |
| 10 | `resolveImage` | const arrow | 493 |
| 11 | `determineBranch` | const arrow | 509 |
| 12 | `handleBranch` | const arrow | 524 |
| 13 | `isDirectImageRef` | const arrow | 548 |
| 14 | `normalizeDirectImageRef` | const arrow | 559 |
| 15 | `parseIncomingImageRefs` | const arrow | 566 |
| 16 | `normalizeImageConflictMode` | const arrow | 599 |
| 17 | `loadCurrentGallery` | const arrow | 609 |

### 3.389 `business-os-v3-centralized-server-template/backend/src/routes/returns.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeScope` | function | 11 |
| 2 | `toNumber` | function | 19 |
| 3 | `assertReturnableItems` | function | 24 |
| 4 | `assertSupplierReturnableStock` | function | 315 |

### 3.390 `business-os-v3-centralized-server-template/backend/src/routes/sales.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSaleItemCosts` | function | 9 |
| 2 | `assertSaleStockAvailable` | function | 35 |
| 3 | `findCustomerForSaleAssignment` | function | 64 |
| 4 | `parseBranchId` | function | 85 |
| 5 | `getActiveBranchContext` | function | 90 |
| 6 | `requireActiveBranch` | function | 105 |
| 7 | `resolveSaleItemBranchId` | function | 112 |
| 8 | `normalizeSaleItems` | function | 123 |
| 9 | `summarizeSaleBranch` | function | 153 |
| 10 | `refreshProductStockQuantity` | function | 177 |
| 11 | `refreshProductStockQuantities` | function | 190 |
| 12 | `fetchSaleItemsWithBranches` | function | 197 |

### 3.391 `business-os-v3-centralized-server-template/backend/src/routes/settings.js`

- No top-level named symbols detected.

### 3.392 `business-os-v3-centralized-server-template/backend/src/routes/system.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `q` | function | 59 |
| 2 | `getClientKey` | function | 63 |
| 3 | `applyRouteRateLimit` | function | 69 |
| 4 | `runFsWorker` | function | 81 |
| 5 | `finish` | const arrow | 93 |
| 6 | `getHostUiAvailability` | function | 137 |
| 7 | `buildRequestBaseUrl` | function | 146 |
| 8 | `getTableColumns` | function | 153 |
| 9 | `extractUploadPathsFromText` | function | 157 |
| 10 | `collectBackupUploads` | function | 166 |
| 11 | `addUpload` | const arrow | 170 |
| 12 | `restoreBackupUploads` | function | 200 |
| 13 | `deleteAllUploads` | function | 210 |
| 14 | `getBackupDataRootCandidate` | function | 219 |
| 15 | `readBackupTablesFromDataRoot` | function | 231 |
| 16 | `restoreUploadsFromDataRoot` | function | 264 |
| 17 | `restoreSnapshotTables` | function | 278 |
| 18 | `ensurePrimaryAdminRoleAndUser` | function | 330 |
| 19 | `replaceTableRows` | function | 395 |
| 20 | `normaliseBackupTables` | function | 430 |
| 21 | `normaliseBackupCustomTableRows` | function | 459 |
| 22 | `repairRelationalConsistency` | function | 464 |
| 23 | `getCustomTableNames` | function | 472 |
| 24 | `parseCustomTableDefinition` | function | 478 |
| 25 | `recreateCustomTable` | function | 521 |
| 26 | `listWindowsFsRoots` | const arrow | 1061 |
| 27 | `listDriveRoots` | const arrow | 1078 |

### 3.393 `business-os-v3-centralized-server-template/backend/src/routes/units.js`

- No top-level named symbols detected.

### 3.394 `business-os-v3-centralized-server-template/backend/src/routes/users.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getClientKey` | function | 47 |
| 2 | `parseJson` | function | 53 |
| 3 | `normalizeLookupText` | function | 61 |
| 4 | `normalizePhoneLookup` | function | 65 |
| 5 | `findUserIdentityConflict` | function | 69 |
| 6 | `getMergedPermissions` | function | 137 |
| 7 | `isPrimaryAdmin` | function | 146 |
| 8 | `hasAdminControl` | function | 153 |
| 9 | `canManageTarget` | function | 166 |
| 10 | `getActorFromRequest` | function | 179 |
| 11 | `requireAdminControl` | function | 186 |
| 12 | `getUserSecurityContext` | function | 199 |
| 13 | `getUserWithRole` | function | 209 |
| 14 | `syncLocalEmailVerification` | function | 224 |
| 15 | `repairSupabaseIdentityForUser` | function | 255 |
| 16 | `sanitizeUserRow` | function | 284 |
| 17 | `isValidEmail` | function | 300 |
| 18 | `getAuthIdentityList` | function | 305 |
| 19 | `buildAuthMethodsPayload` | function | 309 |

### 3.395 `business-os-v3-centralized-server-template/backend/src/security.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeEncryptionKey` | function | 9 |
| 2 | `isEncryptionConfigured` | function | 29 |
| 3 | `encryptSecret` | function | 33 |
| 4 | `decryptSecret` | function | 46 |
| 5 | `pruneRateBucket` | function | 67 |
| 6 | `checkRateLimit` | function | 79 |
| 7 | `resetRateLimit` | function | 108 |
| 8 | `safeCompare` | function | 115 |
| 9 | `getAbuseBucket` | function | 126 |
| 10 | `pruneAbuseBucket` | function | 136 |
| 11 | `checkAbuseLock` | function | 148 |
| 12 | `recordAbuseFailure` | function | 165 |
| 13 | `clearAbuseFailure` | function | 189 |

### 3.396 `business-os-v3-centralized-server-template/backend/src/serverUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sanitizeObjectKeys` | function | 27 |
| 2 | `sanitizeStringValue` | function | 46 |
| 3 | `sanitizeRequestPayload` | function | 52 |
| 4 | `sanitizeDeepStrings` | function | 59 |
| 5 | `isApiOrHealthPath` | function | 76 |
| 6 | `isSpaFallbackEligible` | function | 80 |
| 7 | `setNoStoreHeaders` | function | 88 |
| 8 | `setHtmlNoCacheHeaders` | function | 92 |
| 9 | `setTunnelSecurityHeaders` | function | 98 |
| 10 | `setFrontendStaticHeaders` | function | 131 |
| 11 | `setUploadStaticHeaders` | function | 149 |
| 12 | `mapServerError` | function | 156 |

### 3.397 `business-os-v3-centralized-server-template/backend/src/services/aiGateway.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 6 |
| 2 | `trim` | function | 10 |
| 3 | `parseJsonSafe` | function | 14 |
| 4 | `clamp` | function | 22 |
| 5 | `maskApiKey` | function | 26 |
| 6 | `getProviderMeta` | function | 96 |
| 7 | `normalizeProviderPayload` | function | 100 |
| 8 | `serializeProviderRow` | function | 132 |
| 9 | `providerCanUseWebResearch` | function | 165 |
| 10 | `resolveProviderEndpoint` | function | 170 |
| 11 | `callChatProvider` | function | 177 |
| 12 | `testProviderConfig` | function | 269 |

### 3.398 `business-os-v3-centralized-server-template/backend/src/services/firebaseAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `truthy` | function | 16 |
| 2 | `trim` | function | 20 |
| 3 | `normalizePrivateKey` | function | 24 |
| 4 | `parseJsonSafe` | function | 28 |
| 5 | `loadServiceAccount` | function | 36 |
| 6 | `isFirebaseAuthConfigured` | function | 85 |
| 7 | `isFirebasePhoneVerificationConfigured` | function | 89 |
| 8 | `hasFirebaseAdminCredentials` | function | 93 |
| 9 | `base64Url` | function | 97 |
| 10 | `buildGoogleServiceJwt` | function | 106 |
| 11 | `getGoogleAccessToken` | function | 136 |
| 12 | `normalizeProviderError` | function | 172 |
| 13 | `parseResponseData` | function | 189 |
| 14 | `callFirebasePublic` | function | 193 |
| 15 | `callFirebaseAdmin` | function | 222 |
| 16 | `normalizeEmail` | function | 257 |
| 17 | `normalizeE164` | function | 262 |
| 18 | `getFirebaseAuthPublicConfig` | function | 270 |
| 19 | `createOrUpdateAuthUser` | function | 282 |
| 20 | `updateAuthPassword` | function | 323 |
| 21 | `setAuthUserActive` | function | 342 |
| 22 | `verifyPasswordWithFirebase` | function | 355 |

### 3.399 `business-os-v3-centralized-server-template/backend/src/services/googleDriveSync.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 45 |
| 2 | `trim` | function | 49 |
| 3 | `toBool` | function | 53 |
| 4 | `clamp` | function | 61 |
| 5 | `escapeDriveQueryValue` | function | 67 |
| 6 | `readSettingsMap` | function | 71 |
| 7 | `writeSettingsMap` | function | 81 |
| 8 | `clearDriveSyncMappings` | function | 99 |
| 9 | `resetDriveSyncRootState` | function | 103 |
| 10 | `getDriveSyncConfig` | function | 110 |
| 11 | `getDriveSyncEntriesMap` | function | 131 |
| 12 | `upsertDriveSyncEntry` | function | 142 |
| 13 | `deleteDriveSyncEntry` | function | 168 |
| 14 | `deleteDriveSyncEntriesUnder` | function | 172 |
| 15 | `inferMimeType` | function | 179 |
| 16 | `md5File` | function | 194 |
| 17 | `buildMultipartBody` | function | 200 |
| 18 | `exchangeRefreshToken` | function | 217 |
| 19 | `exchangeAuthorizationCode` | function | 236 |
| 20 | `driveApiRequest` | function | 259 |
| 21 | `driveApiUpload` | function | 276 |
| 22 | `fetchDriveUserProfile` | function | 292 |
| 23 | `findDriveItem` | function | 307 |
| 24 | `findDriveItems` | function | 312 |
| 25 | `listDriveChildren` | function | 327 |
| 26 | `getDriveFileIfExists` | function | 336 |
| 27 | `removeDuplicateDriveItems` | function | 348 |
| 28 | `createDriveFolder` | function | 360 |
| 29 | `ensureRootFolder` | function | 372 |
| 30 | `ensureSnapshotLayout` | function | 391 |
| 31 | `shouldSkipSnapshotFile` | function | 397 |
| 32 | `createDataRootSnapshot` | function | 402 |
| 33 | `collectSnapshotItems` | function | 432 |
| 34 | `ensureRemoteDirectories` | function | 461 |
| 35 | `uploadDriveFile` | function | 496 |
| 36 | `updateDriveFile` | function | 511 |
| 37 | `removeDriveFile` | function | 522 |
| 38 | `runDriveSync` | function | 534 |
| 39 | `scheduleDriveSync` | function | 689 |
| 40 | `getDriveSyncStatus` | function | 712 |
| 41 | `beginGoogleDriveOAuth` | function | 743 |
| 42 | `prunePendingOauthStates` | function | 762 |
| 43 | `finalizeGoogleDriveOAuth` | function | 769 |
| 44 | `saveDriveSyncPreferences` | function | 811 |
| 45 | `disconnectDriveSync` | function | 830 |
| 46 | `schedulePeriodicDriveSync` | function | 848 |

### 3.400 `business-os-v3-centralized-server-template/backend/src/services/portalAi.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 15 |
| 2 | `toNumber` | function | 19 |
| 3 | `tokenize` | function | 24 |
| 4 | `nowMs` | function | 32 |
| 5 | `getProviderPriority` | function | 36 |
| 6 | `getProviderCapacity` | function | 41 |
| 7 | `getProviderMaxInputChars` | function | 46 |
| 8 | `getProviderMaxCompletionTokens` | function | 51 |
| 9 | `getProviderTimeoutMs` | function | 56 |
| 10 | `getProviderCooldownMs` | function | 61 |
| 11 | `getRuntimeState` | function | 67 |
| 12 | `pruneProviderState` | function | 82 |
| 13 | `pruneVisitorActivity` | function | 88 |
| 14 | `registerVisitorActivity` | function | 96 |
| 15 | `countActiveVisitors` | function | 106 |
| 16 | `getVisitorMinuteCount` | function | 111 |
| 17 | `summarizeProfile` | function | 118 |
| 18 | `sanitizeQuestion` | function | 128 |
| 19 | `scoreProduct` | function | 132 |
| 20 | `selectCandidateProducts` | function | 164 |
| 21 | `buildPrompt` | function | 196 |
| 22 | `parseAssistantPayload` | function | 221 |
| 23 | `listEnabledChatProviders` | function | 287 |
| 24 | `chooseProviderForAttempt` | function | 306 |
| 25 | `markProviderStart` | function | 327 |
| 26 | `markProviderSuccess` | function | 335 |
| 27 | `markProviderFailure` | function | 342 |
| 28 | `getPortalAiUsageStatus` | function | 350 |
| 29 | `generatePortalAiResponse` | function | 378 |

### 3.401 `business-os-v3-centralized-server-template/backend/src/services/supabaseAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `truthy` | function | 13 |
| 2 | `trim` | function | 17 |
| 3 | `parseJsonSafe` | function | 21 |
| 4 | `normalizeSupabaseUrl` | function | 29 |
| 5 | `normalizeEmail` | function | 33 |
| 6 | `isPlainObject` | function | 38 |
| 7 | `clampPassword` | function | 42 |
| 8 | `isAllowedOauthProvider` | function | 46 |
| 9 | `isHttpUrl` | function | 50 |
| 10 | `isSupabaseAuthConfigured` | function | 64 |
| 11 | `hasSupabaseAdminCredentials` | function | 68 |
| 12 | `hasSupabasePublicCredentials` | function | 72 |
| 13 | `buildSupabaseUrl` | function | 76 |
| 14 | `normalizeRedirectTo` | function | 80 |
| 15 | `getSupabaseAuthPublicConfig` | function | 85 |
| 16 | `normalizeProviderError` | function | 101 |
| 17 | `parseResponseData` | function | 118 |
| 18 | `callSupabasePublic` | function | 126 |
| 19 | `callSupabaseAdmin` | function | 159 |
| 20 | `getBanDurationForActiveState` | function | 193 |
| 21 | `buildUserMetadata` | function | 197 |
| 22 | `buildAppMetadata` | function | 207 |
| 23 | `getIdentityProviders` | function | 216 |
| 24 | `summarizeAuthUser` | function | 237 |
| 25 | `isLocalUserActive` | function | 254 |
| 26 | `getAuthUserById` | function | 258 |
| 27 | `getAuthUserFromAccessToken` | function | 266 |
| 28 | `listAuthUsersPage` | function | 276 |
| 29 | `findAuthUserByEmail` | function | 295 |
| 30 | `createOrUpdateAuthUser` | function | 315 |
| 31 | `updateAuthPassword` | function | 365 |
| 32 | `setAuthUserActive` | function | 384 |
| 33 | `verifyPasswordWithSupabase` | function | 399 |
| 34 | `unlinkAuthIdentity` | function | 424 |
| 35 | `sendSupabaseVerificationEmail` | function | 438 |
| 36 | `sendSupabasePasswordRecoveryEmail` | function | 477 |
| 37 | `buildOauthStartUrl` | function | 501 |

### 3.402 `business-os-v3-centralized-server-template/backend/src/services/verification.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowMs` | function | 8 |
| 2 | `toIso` | function | 12 |
| 3 | `parseBool` | function | 16 |
| 4 | `isEmailProviderConfigured` | function | 23 |
| 5 | `getVerificationCapabilities` | function | 30 |
| 6 | `normalizeEmail` | function | 37 |
| 7 | `normalizePhone` | function | 44 |
| 8 | `maskDestination` | function | 52 |
| 9 | `generateCode` | function | 65 |
| 10 | `hashCode` | function | 69 |
| 11 | `resolveChannel` | function | 73 |
| 12 | `getDestinationForChannel` | function | 83 |
| 13 | `cleanupExpiredCodes` | function | 88 |
| 14 | `invalidateActiveCodes` | function | 96 |
| 15 | `createVerificationRecord` | function | 109 |
| 16 | `findActiveCode` | function | 136 |
| 17 | `consumeCode` | function | 151 |
| 18 | `verifyCode` | function | 155 |
| 19 | `messageForPurpose` | function | 164 |
| 20 | `sendEmail` | function | 183 |
| 21 | `requestVerificationCode` | function | 247 |

### 3.403 `business-os-v3-centralized-server-template/backend/src/sessionAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `hashToken` | function | 11 |
| 2 | `buildSessionExpiry` | function | 15 |
| 3 | `createAuthSession` | function | 25 |
| 4 | `getPresentedSessionToken` | function | 46 |
| 5 | `getSessionUser` | function | 70 |
| 6 | `revokeAuthSession` | function | 133 |

### 3.404 `business-os-v3-centralized-server-template/backend/src/systemFsWorker.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatBackupStamp` | function | 15 |
| 2 | `pad` | const arrow | 17 |
| 3 | `respond` | function | 21 |
| 4 | `fail` | function | 25 |
| 5 | `runExportFolder` | function | 30 |
| 6 | `runRelocateDataRoot` | function | 70 |
| 7 | `main` | function | 77 |

### 3.405 `business-os-v3-centralized-server-template/backend/src/uploadSecurity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `bufferStartsWith` | function | 11 |
| 2 | `isLikelyCsvBuffer` | function | 15 |
| 3 | `detectBufferKind` | function | 28 |
| 4 | `getExpectedUploadedKind` | function | 42 |
| 5 | `validateImageMetadata` | function | 51 |
| 6 | `validateUploadedBuffer` | function | 65 |
| 7 | `validateUploadedPath` | function | 76 |

### 3.406 `business-os-v3-centralized-server-template/backend/src/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `attachWss` | function | 19 |

### 3.407 `business-os-v3-centralized-server-template/backend/test/accessControl.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |
| 2 | `makeReq` | function | 22 |

### 3.408 `business-os-v3-centralized-server-template/backend/test/backupRoundtrip.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 19 |
| 2 | `makeTempRoot` | function | 39 |
| 3 | `getFreePort` | function | 43 |
| 4 | `waitForHealth` | function | 54 |
| 5 | `startServer` | function | 66 |
| 6 | `stopServer` | function | 87 |
| 7 | `fetchJson` | function | 101 |
| 8 | `loginAsAdmin` | function | 115 |
| 9 | `uploadPortalLogo` | function | 132 |
| 10 | `seedSourceServer` | function | 143 |
| 11 | `exportBackup` | function | 249 |
| 12 | `assertRoundtripState` | function | 257 |

### 3.409 `business-os-v3-centralized-server-template/backend/test/backupSchema.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.410 `business-os-v3-centralized-server-template/backend/test/dataPath.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 16 |
| 2 | `makeTempRoot` | function | 27 |

### 3.411 `business-os-v3-centralized-server-template/backend/test/netSecurity.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |

### 3.412 `business-os-v3-centralized-server-template/backend/test/portalUtils.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.413 `business-os-v3-centralized-server-template/backend/test/serverUtils.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.414 `business-os-v3-centralized-server-template/backend/test/uploadSecurity.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |

### 3.415 `business-os-v3-centralized-server-template/frontend/postcss.config.js`

- No top-level named symbols detected.

### 3.416 `business-os-v3-centralized-server-template/frontend/src/api/http.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSyncServerUrl` | export function | 39 |
| 2 | `getSyncToken` | export function | 40 |
| 3 | `getAuthSessionToken` | export function | 41 |
| 4 | `setSyncServerUrl` | export function | 43 |
| 5 | `setSyncToken` | export function | 44 |
| 6 | `setAuthSessionToken` | export function | 45 |
| 7 | `cacheGet` | export function | 52 |
| 8 | `cacheSet` | export function | 56 |
| 9 | `cacheInvalidate` | export function | 57 |
| 10 | `cacheClearAll` | export function | 60 |
| 11 | `logCall` | function | 74 |
| 12 | `getCallLog` | export function | 79 |
| 13 | `clearCallLog` | export function | 80 |
| 14 | `getClientMetaHeaders` | function | 82 |
| 15 | `dispatchGlobalDataRefresh` | function | 86 |
| 16 | `apiFetch` | export function | 96 |
| 17 | `parsed` | const arrow | 119 |
| 18 | `isNetErr` | export function | 139 |
| 19 | `isConnectivityError` | function | 145 |
| 20 | `isServerOnline` | export function | 164 |
| 21 | `setServerHealth` | function | 166 |
| 22 | `startHealthCheck` | export function | 181 |
| 23 | `cacheGetStale` | export function | 216 |
| 24 | `route` | export function | 233 |

### 3.417 `business-os-v3-centralized-server-template/frontend/src/api/localDb.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `localGetSettings` | export function | 38 |
| 2 | `localSaveSettings` | export function | 45 |
| 3 | `parseCSV` | export function | 54 |
| 4 | `splitCSVLine` | function | 67 |
| 5 | `buildCSVTemplate` | export function | 78 |

### 3.418 `business-os-v3-centralized-server-template/frontend/src/api/methods.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDeviceInfo` | function | 3 |
| 2 | `getPortalBaseUrl` | function | 19 |
| 3 | `getCurrentUserContext` | function | 24 |
| 4 | `queueOfflineWrite` | function | 39 |
| 5 | `appendActorQuery` | function | 48 |
| 6 | `fetchJsonWithTimeout` | function | 61 |
| 7 | `login` | export function | 80 |
| 8 | `logout` | export function | 83 |
| 9 | `resetPasswordWithOtp` | export function | 86 |
| 10 | `requestPasswordResetEmail` | export function | 89 |
| 11 | `completePasswordReset` | export function | 92 |
| 12 | `getVerificationCapabilities` | export function | 95 |
| 13 | `getSystemConfig` | export function | 98 |
| 14 | `getSystemDebugLog` | export function | 101 |
| 15 | `startSupabaseOauth` | export function | 104 |
| 16 | `completeSupabaseOauth` | export function | 107 |
| 17 | `getOrganizationBootstrap` | export function | 110 |
| 18 | `searchOrganizations` | export function | 113 |
| 19 | `getCurrentOrganization` | export function | 117 |
| 20 | `getSettings` | export function | 122 |
| 21 | `saveSettings` | export function | 125 |
| 22 | `getCategories` | const arrow | 131 |
| 23 | `updateCategory` | const arrow | 133 |
| 24 | `getUnits` | const arrow | 137 |
| 25 | `getCustomFields` | const arrow | 142 |
| 26 | `updateCustomField` | const arrow | 144 |
| 27 | `getBranches` | const arrow | 148 |
| 28 | `updateBranch` | const arrow | 150 |
| 29 | `deleteBranch` | const arrow | 151 |
| 30 | `getTransfers` | const arrow | 153 |
| 31 | `getProducts` | const arrow | 157 |
| 32 | `getCatalogMeta` | export function | 158 |
| 33 | `getCatalogProducts` | export function | 166 |
| 34 | `getPortalConfig` | export function | 174 |
| 35 | `getPortalCatalogMeta` | export function | 182 |
| 36 | `getPortalCatalogProducts` | export function | 190 |
| 37 | `lookupPortalMembership` | export function | 198 |
| 38 | `createPortalSubmission` | export function | 208 |
| 39 | `getPortalAiStatus` | export function | 222 |
| 40 | `askPortalAi` | export function | 230 |
| 41 | `getPortalSubmissionsForReview` | const arrow | 244 |
| 42 | `reviewPortalSubmission` | const arrow | 246 |
| 43 | `getAiProviders` | const arrow | 249 |
| 44 | `createAiProvider` | const arrow | 251 |
| 45 | `updateAiProvider` | const arrow | 253 |
| 46 | `deleteAiProvider` | const arrow | 255 |
| 47 | `testAiProvider` | const arrow | 257 |
| 48 | `getAiResponses` | const arrow | 259 |
| 49 | `createProduct` | export function | 261 |
| 50 | `updateProduct` | export function | 292 |
| 51 | `getFiles` | export function | 320 |
| 52 | `uploadFileAsset` | export function | 326 |
| 53 | `deleteFileAsset` | export function | 356 |
| 54 | `uploadProductImage` | export function | 365 |
| 55 | `uploadUserAvatar` | export function | 394 |
| 56 | `openCSVDialog` | export function | 431 |
| 57 | `openImageDialog` | export function | 451 |
| 58 | `getImageDataUrl` | export function | 459 |
| 59 | `getInventorySummary` | const arrow | 468 |
| 60 | `getInventoryMovements` | const arrow | 469 |
| 61 | `createSale` | export function | 472 |
| 62 | `flushPendingSyncQueue` | export function | 492 |
| 63 | `getSales` | const arrow | 550 |
| 64 | `getDashboard` | const arrow | 556 |
| 65 | `getAnalytics` | const arrow | 557 |
| 66 | `getCustomers` | const arrow | 566 |
| 67 | `updateCustomer` | const arrow | 568 |
| 68 | `downloadCustomerTemplate` | const arrow | 571 |
| 69 | `getSuppliers` | const arrow | 574 |
| 70 | `updateSupplier` | const arrow | 576 |
| 71 | `downloadSupplierTemplate` | const arrow | 579 |
| 72 | `getDeliveryContacts` | const arrow | 582 |
| 73 | `updateDeliveryContact` | const arrow | 584 |
| 74 | `getUsers` | const arrow | 589 |
| 75 | `updateUser` | const arrow | 591 |
| 76 | `getUserProfile` | const arrow | 592 |
| 77 | `getUserAuthMethods` | const arrow | 593 |
| 78 | `updateUserProfile` | const arrow | 595 |
| 79 | `disconnectUserAuthProvider` | const arrow | 597 |
| 80 | `changeUserPassword` | const arrow | 599 |
| 81 | `resetPassword` | const arrow | 601 |
| 82 | `getRoles` | const arrow | 604 |
| 83 | `updateRole` | const arrow | 606 |
| 84 | `deleteRole` | const arrow | 607 |
| 85 | `getCustomTables` | const arrow | 610 |
| 86 | `getCustomTableData` | const arrow | 612 |
| 87 | `insertCustomRow` | const arrow | 613 |
| 88 | `updateCustomRow` | const arrow | 614 |
| 89 | `deleteCustomRow` | const arrow | 615 |
| 90 | `getAuditLogs` | const arrow | 618 |
| 91 | `exportBackup` | export function | 621 |
| 92 | `exportBackupFolder` | export function | 638 |
| 93 | `pickBackupFile` | export function | 642 |
| 94 | `importBackupData` | export function | 657 |
| 95 | `importBackupFolder` | export function | 663 |
| 96 | `importBackup` | export function | 669 |
| 97 | `getGoogleDriveSyncStatus` | const arrow | 684 |
| 98 | `saveGoogleDriveSyncPreferences` | const arrow | 687 |
| 99 | `startGoogleDriveSyncOauth` | const arrow | 690 |
| 100 | `disconnectGoogleDriveSync` | const arrow | 693 |
| 101 | `syncGoogleDriveNow` | const arrow | 696 |
| 102 | `resetData` | export function | 699 |
| 103 | `factoryReset` | export function | 705 |
| 104 | `downloadImportTemplate` | export function | 712 |
| 105 | `openPath` | export function | 732 |
| 106 | `getReturns` | const arrow | 741 |
| 107 | `updateSaleStatus` | const arrow | 751 |
| 108 | `attachSaleCustomer` | const arrow | 755 |
| 109 | `getSalesExport` | const arrow | 758 |
| 110 | `updateReturn` | const arrow | 762 |
| 111 | `testSyncServer` | export function | 766 |
| 112 | `openFolderDialog` | export function | 785 |
| 113 | `getDataPath` | const arrow | 796 |
| 114 | `setDataPath` | const arrow | 797 |
| 115 | `resetDataPath` | const arrow | 798 |
| 116 | `browseDir` | const arrow | 799 |

### 3.419 `business-os-v3-centralized-server-template/frontend/src/api/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `connectWS` | export function | 18 |
| 2 | `disconnectWS` | export function | 92 |
| 3 | `scheduleReconnect` | function | 100 |
| 4 | `isWSConnected` | export function | 116 |

### 3.420 `business-os-v3-centralized-server-template/frontend/src/App.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getChunkErrorMessage` | function | 54 |
| 2 | `isChunkLoadError` | function | 59 |
| 3 | `createChunkTimeoutError` | function | 68 |
| 4 | `isRetryableImportError` | function | 74 |
| 5 | `importWithTimeout` | function | 82 |
| 6 | `clearRetryMarker` | function | 98 |
| 7 | `triggerChunkRecoveryReload` | function | 105 |
| 8 | `createChunkReloadStallError` | function | 115 |
| 9 | `shouldRetryChunk` | function | 121 |
| 10 | `lazyWithRetry` | function | 131 |
| 11 | `getWarmupImporters` | function | 198 |
| 12 | `useMountedPages` | function | 209 |
| 13 | `useSyncErrorBanner` | function | 223 |
| 14 | `onSyncError` | const arrow | 228 |
| 15 | `useVisibilityRecovery` | function | 239 |
| 16 | `onVisible` | const arrow | 243 |
| 17 | `onFocus` | const arrow | 253 |
| 18 | `useChunkWarmup` | function | 271 |
| 19 | `runWarmup` | const arrow | 282 |
| 20 | `PageErrorBoundary` | class | 310 |
| 21 | `Notification` | function | 358 |
| 22 | `SyncErrorBanner` | function | 370 |
| 23 | `PageLoader` | function | 390 |
| 24 | `PageSlot` | function | 401 |
| 25 | `PublicCatalogView` | function | 424 |
| 26 | `App` | export default function | 437 |

### 3.421 `business-os-v3-centralized-server-template/frontend/src/app/appShellUtils.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isPublicCatalogPath` | export function | 7 |
| 2 | `updateMountedPages` | export function | 17 |
| 3 | `getNotificationPrefix` | export function | 27 |
| 4 | `getNotificationColor` | export function | 34 |

### 3.422 `business-os-v3-centralized-server-template/frontend/src/AppContext.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readDeviceSettings` | function | 52 |
| 2 | `writeDeviceSettings` | function | 60 |
| 3 | `mergeSettingsWithDeviceOverrides` | function | 66 |
| 4 | `normalizeDateInput` | function | 70 |
| 5 | `LoadingScreen` | function | 95 |
| 6 | `AccessDenied` | function | 108 |
| 7 | `AppProvider` | export function | 120 |
| 8 | `onUpdate` | const arrow | 215 |
| 9 | `onStatus` | const arrow | 225 |
| 10 | `poll` | const arrow | 233 |
| 11 | `onError` | const arrow | 253 |
| 12 | `onUnauthorized` | const arrow | 257 |
| 13 | `handleOtpLogin` | const arrow | 289 |
| 14 | `handleUserUpdated` | const arrow | 329 |
| 15 | `discoverSyncUrl` | const arrow | 357 |
| 16 | `hexAlpha` | const arrow | 453 |
| 17 | `clearCallbackUrl` | const arrow | 618 |
| 18 | `clearPendingLink` | const arrow | 622 |
| 19 | `run` | const arrow | 626 |
| 20 | `useApp` | const arrow | 863 |
| 21 | `useSync` | const arrow | 864 |
| 22 | `useT` | const arrow | 867 |

### 3.423 `business-os-v3-centralized-server-template/frontend/src/components/auth/Login.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `OauthButton` | function | 16 |
| 2 | `ModeBackButton` | function | 30 |
| 3 | `Login` | export default function | 43 |
| 4 | `tr` | const arrow | 45 |
| 5 | `rememberOrganization` | const arrow | 88 |
| 6 | `loadCapabilities` | const arrow | 115 |
| 7 | `bootstrap` | const arrow | 132 |
| 8 | `clearCallbackUrl` | const arrow | 191 |
| 9 | `run` | const arrow | 196 |
| 10 | `rememberedOrg` | const arrow | 224 |
| 11 | `getDeviceContext` | const arrow | 269 |
| 12 | `handleLogin` | const arrow | 271 |
| 13 | `handleOtp` | const arrow | 291 |
| 14 | `handleOtpInput` | const arrow | 321 |
| 15 | `handleResetWithOtp` | const arrow | 326 |
| 16 | `handleResetWithEmail` | const arrow | 360 |
| 17 | `handleCompleteEmailReset` | const arrow | 386 |
| 18 | `handleStartOauth` | const arrow | 416 |
| 19 | `closeAuxMode` | const arrow | 446 |

### 3.424 `business-os-v3-centralized-server-template/frontend/src/components/branches/Branches.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatTransferDate` | function | 19 |
| 2 | `Branches` | export default function | 36 |
| 3 | `load` | const arrow | 58 |
| 4 | `loadBranchStock` | const arrow | 94 |
| 5 | `handleSaveBranch` | const arrow | 109 |
| 6 | `handleDelete` | const arrow | 128 |
| 7 | `handleBulkDelete` | const arrow | 143 |
| 8 | `toggleSelect` | const arrow | 168 |
| 9 | `toggleSelectAll` | const arrow | 177 |

### 3.425 `business-os-v3-centralized-server-template/frontend/src/components/branches/BranchForm.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BranchForm` | export default function | 11 |
| 2 | `set` | const arrow | 33 |
| 3 | `handleSave` | const arrow | 45 |

### 3.426 `business-os-v3-centralized-server-template/frontend/src/components/branches/TransferModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `TransferModal` | export default function | 11 |
| 2 | `run` | const arrow | 36 |
| 3 | `handleTransfer` | const arrow | 70 |

### 3.427 `business-os-v3-centralized-server-template/frontend/src/components/catalog/CatalogPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getAboutBlockLabel` | function | 41 |
| 2 | `withAssetVersion` | function | 47 |
| 3 | `tt` | function | 522 |
| 4 | `toBoolean` | function | 527 |
| 5 | `toNumber` | function | 534 |
| 6 | `normalizePriceDisplay` | function | 540 |
| 7 | `normalizeHexColor` | function | 545 |
| 8 | `normalizeExternalUrl` | function | 551 |
| 9 | `buildFaqStarterItems` | function | 567 |
| 10 | `buildAiFaqStarterItems` | function | 647 |
| 11 | `hexToRgba` | function | 678 |
| 12 | `readPortalCache` | function | 689 |
| 13 | `writePortalCache` | function | 705 |
| 14 | `normalizePortalPath` | function | 719 |
| 15 | `isReservedPortalPath` | function | 732 |
| 16 | `buildDraft` | function | 737 |
| 17 | `applyDraft` | function | 821 |
| 18 | `statusClass` | function | 936 |
| 19 | `getBranchQty` | function | 943 |
| 20 | `getStockStatus` | function | 950 |
| 21 | `normalizeProductGallery` | function | 960 |
| 22 | `formatDateTime` | function | 978 |
| 23 | `formatPortalPrice` | function | 985 |
| 24 | `SectionShell` | function | 998 |
| 25 | `SummaryTile` | function | 1014 |
| 26 | `StatusPill` | function | 1038 |
| 27 | `ImageField` | function | 1053 |
| 28 | `pickImageAsDataUrl` | function | 1119 |
| 29 | `pickMultipleImagesAsDataUrls` | function | 1138 |
| 30 | `replaceVars` | function | 1159 |
| 31 | `applyGoogleTranslateSelection` | function | 1196 |
| 32 | `CatalogPage` | export default function | 1218 |
| 33 | `copy` | const arrow | 1289 |
| 34 | `resolveVisibleTab` | const arrow | 1290 |
| 35 | `openProductGallery` | function | 1382 |
| 36 | `changeTranslateTarget` | function | 1395 |
| 37 | `loadPortal` | function | 1407 |
| 38 | `run` | function | 1471 |
| 39 | `toggleFilterValue` | function | 1695 |
| 40 | `clearPortalFilters` | function | 1703 |
| 41 | `setDraft` | function | 1710 |
| 42 | `openPortalImage` | function | 1715 |
| 43 | `setAboutBlocksDraft` | function | 1726 |
| 44 | `updateAboutBlock` | function | 1730 |
| 45 | `addAboutBlock` | function | 1736 |
| 46 | `moveAboutBlockBefore` | function | 1740 |
| 47 | `removeAboutBlock` | function | 1752 |
| 48 | `setFaqDraft` | function | 1756 |
| 49 | `addFaqItem` | function | 1760 |
| 50 | `mergeFaqStarterItems` | function | 1771 |
| 51 | `addFaqStarterSet` | function | 1784 |
| 52 | `addAiFaqStarterSet` | function | 1788 |
| 53 | `updateFaqItem` | function | 1792 |
| 54 | `removeFaqItem` | function | 1798 |
| 55 | `clearAssistantState` | function | 1802 |
| 56 | `uploadPortalImage` | function | 1817 |
| 57 | `uploadDraftImage` | function | 1836 |
| 58 | `uploadAboutBlockMedia` | function | 1841 |
| 59 | `openFilePicker` | function | 1850 |
| 60 | `handleFilePickerSelect` | function | 1854 |
| 61 | `savePortalDraft` | function | 1870 |
| 62 | `askAssistant` | function | 1990 |
| 63 | `handleMembershipLookup` | function | 2023 |
| 64 | `addSubmissionImages` | function | 2049 |
| 65 | `handleSubmissionPaste` | function | 2058 |
| 66 | `handleSubmitShareProof` | function | 2074 |
| 67 | `handleReviewSubmission` | function | 2109 |

### 3.428 `business-os-v3-centralized-server-template/frontend/src/components/catalog/portalEditorUtils.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toTrimmedString` | function | 3 |
| 2 | `safeJsonParse` | function | 7 |
| 3 | `createAboutBlock` | export function | 15 |
| 4 | `normalizeAboutBlocks` | export function | 27 |
| 5 | `serializeAboutBlocks` | export function | 47 |
| 6 | `moveListItem` | export function | 51 |
| 7 | `extractGoogleMapsEmbedUrl` | export function | 64 |
| 8 | `normalizeGoogleMapsEmbed` | export function | 72 |

### 3.429 `business-os-v3-centralized-server-template/frontend/src/components/contacts/Contacts.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `TABS` | const arrow | 14 |
| 2 | `ImportTypePicker` | function | 20 |
| 3 | `T` | const arrow | 21 |
| 4 | `Contacts` | export default function | 60 |
| 5 | `handleExportAll` | const arrow | 67 |
| 6 | `openImportPicker` | const arrow | 118 |
| 7 | `handleTypeSelected` | const arrow | 120 |
| 8 | `handleImportDone` | const arrow | 125 |

### 3.430 `business-os-v3-centralized-server-template/frontend/src/components/contacts/CustomersTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseContactOptions` | export function | 9 |
| 2 | `serializeContactOptions` | export function | 30 |
| 3 | `BLANK_OPTION` | const arrow | 41 |
| 4 | `generateMembershipNumber` | function | 43 |
| 5 | `tr` | function | 49 |
| 6 | `OptionEditor` | function | 54 |
| 7 | `setField` | const arrow | 55 |
| 8 | `buildOptionSummary` | function | 95 |
| 9 | `CustomerForm` | function | 103 |
| 10 | `setField` | const arrow | 113 |
| 11 | `addOption` | const arrow | 114 |
| 12 | `removeOption` | const arrow | 115 |
| 13 | `updateOption` | const arrow | 116 |
| 14 | `CustomersTab` | function | 190 |
| 15 | `handleSave` | const arrow | 230 |
| 16 | `handleDelete` | const arrow | 254 |
| 17 | `handleBulkDelete` | const arrow | 267 |

### 3.431 `business-os-v3-centralized-server-template/frontend/src/components/contacts/DeliveryTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseDeliveryOptions` | export function | 15 |
| 2 | `serializeDeliveryOptions` | export function | 30 |
| 3 | `BLANK_OPTION` | const arrow | 37 |
| 4 | `OptionEditor` | function | 40 |
| 5 | `set` | const arrow | 41 |
| 6 | `DeliveryForm` | function | 71 |
| 7 | `set` | const arrow | 74 |
| 8 | `handleSave` | const arrow | 75 |
| 9 | `OptionsDisplay` | function | 115 |
| 10 | `OptionsBadge` | function | 132 |
| 11 | `DeliveryTab` | function | 143 |
| 12 | `handleSave` | const arrow | 174 |
| 13 | `handleDelete` | const arrow | 189 |
| 14 | `handleBulkDelete` | const arrow | 195 |

### 3.432 `business-os-v3-centralized-server-template/frontend/src/components/contacts/shared.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `useContactSelection` | export function | 11 |
| 2 | `toggleOne` | const arrow | 25 |
| 3 | `clearSelection` | const arrow | 36 |
| 4 | `ThreeDotMenu` | export function | 62 |
| 5 | `DetailModal` | export function | 121 |
| 6 | `ContactTable` | export function | 152 |
| 7 | `ImportModal` | export function | 225 |
| 8 | `handlePickFile` | const arrow | 246 |
| 9 | `handleChooseExistingFile` | const arrow | 254 |
| 10 | `handleDownloadTemplate` | const arrow | 276 |
| 11 | `handleImport` | const arrow | 280 |

### 3.433 `business-os-v3-centralized-server-template/frontend/src/components/contacts/SuppliersTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `SupplierForm` | function | 9 |
| 2 | `set` | const arrow | 14 |
| 3 | `SuppliersTab` | function | 60 |
| 4 | `handleSave` | const arrow | 101 |
| 5 | `handleDelete` | const arrow | 121 |
| 6 | `handleBulkDelete` | const arrow | 134 |

### 3.434 `business-os-v3-centralized-server-template/frontend/src/components/custom-tables/CustomTables.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CustomTables` | export default function | 6 |
| 2 | `loadTables` | const arrow | 17 |
| 3 | `addColumn` | const arrow | 39 |
| 4 | `updateColumn` | const arrow | 43 |
| 5 | `removeColumn` | const arrow | 47 |
| 6 | `handleCreateTable` | const arrow | 51 |
| 7 | `handleSaveRow` | const arrow | 64 |
| 8 | `handleDeleteRow` | const arrow | 78 |
| 9 | `openAddRow` | const arrow | 84 |
| 10 | `openEditRow` | const arrow | 91 |

### 3.435 `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/BarChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BarChart` | export default function | 14 |
| 2 | `yPx` | function | 32 |

### 3.436 `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/DonutChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `DonutChart` | export default function | 14 |

### 3.437 `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/index.js`

- No top-level named symbols detected.

### 3.438 `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/LineChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `LineChart` | export default function | 13 |
| 2 | `xPx` | function | 29 |
| 3 | `yPx` | function | 30 |
| 4 | `handleMouseMove` | const arrow | 35 |

### 3.439 `business-os-v3-centralized-server-template/frontend/src/components/dashboard/charts/NoData.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NoData` | export default function | 7 |

### 3.440 `business-os-v3-centralized-server-template/frontend/src/components/dashboard/Dashboard.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Dashboard` | export default function | 11 |
| 2 | `translateOr` | const arrow | 15 |
| 3 | `calcTrend` | const arrow | 94 |
| 4 | `rangeLabel` | const arrow | 119 |
| 5 | `periodShort` | const arrow | 125 |
| 6 | `buildExportAll` | const arrow | 232 |

### 3.441 `business-os-v3-centralized-server-template/frontend/src/components/dashboard/MiniStat.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `MiniStat` | export default function | 2 |

### 3.442 `business-os-v3-centralized-server-template/frontend/src/components/files/FilePickerModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `AssetPreview` | function | 5 |
| 2 | `FilePickerModal` | export default function | 15 |
| 3 | `tr` | const arrow | 33 |
| 4 | `loadFiles` | function | 38 |
| 5 | `toggleSelectedPath` | function | 69 |
| 6 | `handleUpload` | function | 79 |
| 7 | `handleDelete` | function | 114 |

### 3.443 `business-os-v3-centralized-server-template/frontend/src/components/files/FilesPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `AssetPreview` | function | 21 |
| 2 | `formatDateTime` | function | 35 |
| 3 | `ProviderStatus` | function | 45 |
| 4 | `emptyProviderForm` | function | 56 |
| 5 | `compactTabLabel` | function | 79 |
| 6 | `FilesPage` | export default function | 85 |
| 7 | `tr` | const arrow | 106 |
| 8 | `loadFiles` | function | 146 |
| 9 | `loadProviders` | function | 158 |
| 10 | `loadResponses` | function | 171 |
| 11 | `handleUpload` | function | 183 |
| 12 | `handleDeleteAsset` | function | 199 |
| 13 | `startCreateProvider` | function | 215 |
| 14 | `startEditProvider` | function | 231 |
| 15 | `saveProvider` | function | 255 |
| 16 | `testProvider` | function | 298 |
| 17 | `removeProvider` | function | 312 |
| 18 | `tabButton` | const arrow | 325 |

### 3.444 `business-os-v3-centralized-server-template/frontend/src/components/inventory/DualMoney.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `DualMoney` | function | 5 |

### 3.445 `business-os-v3-centralized-server-template/frontend/src/components/inventory/Inventory.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Inventory` | export default function | 13 |
| 2 | `handleAdjust` | const arrow | 93 |
| 3 | `openAdjust` | const arrow | 124 |
| 4 | `matchesSearch` | const arrow | 137 |
| 5 | `productHay` | const arrow | 144 |
| 6 | `movHay` | const arrow | 147 |

### 3.446 `business-os-v3-centralized-server-template/frontend/src/components/inventory/movementGroups.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `minuteBucket` | function | 1 |
| 2 | `normalizeText` | function | 8 |
| 3 | `buildGroupKey` | function | 12 |
| 4 | `describeMovementType` | function | 28 |
| 5 | `buildMovementGroups` | export function | 33 |
| 6 | `movementGroupHaystack` | export function | 94 |

### 3.447 `business-os-v3-centralized-server-template/frontend/src/components/inventory/ProductDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductDetailModal` | function | 6 |
| 2 | `T` | const arrow | 7 |

### 3.448 `business-os-v3-centralized-server-template/frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sanitizeInteger` | function | 101 |
| 2 | `sanitizeKhr` | function | 106 |
| 3 | `formatLookupValue` | function | 112 |
| 4 | `LoyaltyPointsPage` | export default function | 116 |
| 5 | `copy` | const arrow | 119 |
| 6 | `loadCustomerPoints` | function | 150 |
| 7 | `setValue` | function | 185 |
| 8 | `handleSave` | function | 189 |
| 9 | `handleLookup` | function | 211 |

### 3.449 `business-os-v3-centralized-server-template/frontend/src/components/navigation/Sidebar.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getFallbackLabel` | function | 47 |
| 2 | `getNavLabel` | function | 55 |
| 3 | `isDarkColor` | function | 71 |
| 4 | `withAlpha` | function | 81 |
| 5 | `mergeStyles` | function | 87 |
| 6 | `Sidebar` | export default function | 91 |

### 3.450 `business-os-v3-centralized-server-template/frontend/src/components/pos/CartItem.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CartItem` | function | 7 |

### 3.451 `business-os-v3-centralized-server-template/frontend/src/components/pos/FilterPanel.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `POSFilterPanel` | export default function | 3 |
| 2 | `T` | const arrow | 24 |
| 3 | `clearAll` | const arrow | 34 |
| 4 | `chip` | const arrow | 42 |
| 5 | `SectionLabel` | const arrow | 48 |

### 3.452 `business-os-v3-centralized-server-template/frontend/src/components/pos/POS.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `allTermsMatch` | function | 42 |
| 2 | `POS` | export default function | 47 |
| 3 | `posCopy` | const arrow | 50 |
| 4 | `setQuickFilter` | const arrow | 85 |
| 5 | `addNewOrder` | const arrow | 150 |
| 6 | `closeOrder` | const arrow | 162 |
| 7 | `loadMembership` | function | 307 |
| 8 | `selectCustomer` | const arrow | 329 |
| 9 | `applyCustomerOption` | const arrow | 377 |
| 10 | `clearCustomer` | const arrow | 391 |
| 11 | `handleAddCustomer` | const arrow | 399 |
| 12 | `selectDelivery` | const arrow | 415 |
| 13 | `clearDelivery` | const arrow | 420 |
| 14 | `handleAddDelivery` | const arrow | 422 |
| 15 | `filteredProducts` | const arrow | 463 |
| 16 | `qty` | const arrow | 492 |
| 17 | `addToCart` | const arrow | 600 |
| 18 | `updateQty` | const arrow | 626 |
| 19 | `updatePrice` | const arrow | 634 |
| 20 | `updateItemBranch` | const arrow | 646 |
| 21 | `handleDiscountUsd` | const arrow | 695 |
| 22 | `handleDiscountKhr` | const arrow | 696 |
| 23 | `handleMembershipUnits` | const arrow | 697 |
| 24 | `handleCheckout` | const arrow | 714 |

### 3.453 `business-os-v3-centralized-server-template/frontend/src/components/pos/ProductImage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductImage` | export default function | 7 |

### 3.454 `business-os-v3-centralized-server-template/frontend/src/components/pos/QuickAddModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `QuickAddModal` | function | 5 |
| 2 | `T` | const arrow | 6 |

### 3.455 `business-os-v3-centralized-server-template/frontend/src/components/products/BranchStockAdjuster.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BranchStockAdjuster` | function | 6 |
| 2 | `setRow` | const arrow | 16 |
| 3 | `handleSave` | const arrow | 19 |

### 3.456 `business-os-v3-centralized-server-template/frontend/src/components/products/BulkAddStockModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BulkAddStockModal` | function | 6 |
| 2 | `handleSave` | const arrow | 13 |

### 3.457 `business-os-v3-centralized-server-template/frontend/src/components/products/BulkImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBaseName` | function | 12 |
| 2 | `parseCSVContent` | function | 19 |
| 3 | `getIncomingImageFilenames` | function | 39 |
| 4 | `getExistingImageFilenames` | function | 72 |
| 5 | `BulkImportModal` | export default function | 90 |
| 6 | `T` | const arrow | 105 |
| 7 | `resetCsvState` | const arrow | 107 |
| 8 | `pickImageDirectory` | const arrow | 116 |
| 9 | `addLibraryImages` | const arrow | 145 |
| 10 | `handleImageOnlyImport` | const arrow | 161 |
| 11 | `handlePickCSV` | const arrow | 183 |
| 12 | `handleImport` | const arrow | 256 |

### 3.458 `business-os-v3-centralized-server-template/frontend/src/components/products/HeaderActions.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductsHeaderActions` | export default function | 4 |

### 3.459 `business-os-v3-centralized-server-template/frontend/src/components/products/ManageBrandsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseBrandOptions` | function | 5 |
| 2 | `toTitleCase` | function | 18 |
| 3 | `ManageBrandsModal` | export default function | 26 |
| 4 | `saveLibrary` | const arrow | 59 |
| 5 | `addLibraryBrand` | const arrow | 70 |
| 6 | `renameBrand` | const arrow | 92 |
| 7 | `removeBrand` | const arrow | 138 |

### 3.460 `business-os-v3-centralized-server-template/frontend/src/components/products/ManageCategoriesModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ManageCategoriesModal` | function | 7 |
| 2 | `load` | const arrow | 16 |
| 3 | `handleAdd` | const arrow | 20 |
| 4 | `handleUpdate` | const arrow | 29 |
| 5 | `handleDelete` | const arrow | 37 |

### 3.461 `business-os-v3-centralized-server-template/frontend/src/components/products/ManageFieldsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ManageFieldsModal` | function | 6 |
| 2 | `load` | const arrow | 13 |
| 3 | `handleSave` | const arrow | 16 |

### 3.462 `business-os-v3-centralized-server-template/frontend/src/components/products/ManageMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ManageMenu` | export default function | 5 |

### 3.463 `business-os-v3-centralized-server-template/frontend/src/components/products/ManageUnitsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ManageUnitsModal` | function | 6 |
| 2 | `load` | const arrow | 11 |
| 3 | `handleAddUnit` | const arrow | 14 |

### 3.464 `business-os-v3-centralized-server-template/frontend/src/components/products/primitives.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductImg` | function | 7 |
| 2 | `ProductImagePlaceholder` | function | 41 |
| 3 | `MarginCard` | function | 49 |
| 4 | `DualPriceInput` | function | 81 |
| 5 | `handleUsdChange` | const arrow | 82 |
| 6 | `handleKhrChange` | const arrow | 88 |

### 3.465 `business-os-v3-centralized-server-template/frontend/src/components/products/ProductDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductDetailModal` | export default function | 4 |
| 2 | `T` | const arrow | 15 |
| 3 | `Row` | const arrow | 25 |

### 3.466 `business-os-v3-centralized-server-template/frontend/src/components/products/ProductForm.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeGallery` | function | 7 |
| 2 | `pickImageFiles` | function | 23 |
| 3 | `parseCustomFieldOptions` | function | 41 |
| 4 | `ProductForm` | export default function | 52 |
| 5 | `setField` | function | 130 |
| 6 | `setCustomField` | function | 134 |
| 7 | `addImages` | function | 144 |
| 8 | `removeImage` | function | 167 |
| 9 | `setPrimaryImage` | function | 171 |
| 10 | `saveForm` | function | 181 |

### 3.467 `business-os-v3-centralized-server-template/frontend/src/components/products/Products.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `multiMatch` | function | 23 |
| 2 | `ThreeDot` | function | 27 |
| 3 | `Products` | export default function | 33 |
| 4 | `handleSave` | const arrow | 82 |
| 5 | `normalizeGallery` | const arrow | 133 |
| 6 | `uploadGalleryImages` | const arrow | 149 |
| 7 | `handleSaveWithGallery` | const arrow | 171 |
| 8 | `handleBulkDelete` | const arrow | 203 |
| 9 | `handleBulkOutOfStock` | const arrow | 216 |
| 10 | `handleBulkChangeBranch` | const arrow | 232 |
| 11 | `handleBulkAddStock` | const arrow | 269 |
| 12 | `toggleSelect` | const arrow | 274 |
| 13 | `toggleSelectAll` | const arrow | 279 |
| 14 | `handleDelete` | const arrow | 283 |
| 15 | `resolveImageUrl` | const arrow | 307 |
| 16 | `getProductGallery` | const arrow | 318 |
| 17 | `openLightbox` | const arrow | 320 |
| 18 | `getBranchQty` | const arrow | 328 |
| 19 | `getStockBadge` | const arrow | 329 |
| 20 | `toImageName` | const arrow | 390 |
| 21 | `toImageUrl` | const arrow | 391 |

### 3.468 `business-os-v3-centralized-server-template/frontend/src/components/products/VariantFormModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `VariantFormModal` | function | 8 |
| 2 | `set` | const arrow | 21 |
| 3 | `handleSave` | const arrow | 24 |

### 3.469 `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/AllFieldsPanel.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Toggle` | function | 5 |
| 2 | `AllFieldsPanel` | export default function | 21 |
| 3 | `T` | const arrow | 23 |
| 4 | `toggleSection` | const arrow | 42 |

### 3.470 `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/constants.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getFieldItems` | export function | 52 |
| 2 | `T` | const arrow | 53 |

### 3.471 `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/ErrorBoundary.jsx`

- No top-level named symbols detected.

### 3.472 `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/FieldOrderManager.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSectionOrderItems` | function | 4 |
| 2 | `buildList` | function | 23 |
| 3 | `toKeys` | function | 48 |
| 4 | `FieldOrderManager` | export default function | 52 |
| 5 | `moveItem` | const arrow | 66 |
| 6 | `addDivider` | const arrow | 74 |
| 7 | `removeDivider` | const arrow | 85 |
| 8 | `handleDragStart` | const arrow | 91 |
| 9 | `handleDragOver` | const arrow | 96 |

### 3.473 `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/PrintSettings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Section` | function | 5 |
| 2 | `PrintSettings` | export default function | 17 |
| 3 | `T` | const arrow | 18 |
| 4 | `setValue` | const arrow | 27 |
| 5 | `resetMargins` | const arrow | 35 |

### 3.474 `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/ReceiptPreview.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ReceiptPreview` | export default function | 3 |

### 3.475 `business-os-v3-centralized-server-template/frontend/src/components/receipt-settings/ReceiptSettings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Section` | function | 13 |
| 2 | `Toggle` | function | 24 |
| 3 | `parseTemplate` | function | 39 |
| 4 | `ReceiptSettings` | export default function | 44 |
| 5 | `handleSave` | const arrow | 113 |

### 3.476 `business-os-v3-centralized-server-template/frontend/src/components/receipt/Receipt.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseTpl` | export function | 8 |
| 2 | `stripEmoji` | function | 16 |
| 3 | `displayAddress` | function | 21 |
| 4 | `parseItems` | function | 30 |
| 5 | `labelFor` | function | 95 |
| 6 | `Row` | function | 100 |
| 7 | `Receipt` | export default function | 112 |
| 8 | `em` | const arrow | 123 |
| 9 | `exportReceiptPdf` | const arrow | 319 |

### 3.477 `business-os-v3-centralized-server-template/frontend/src/components/returns/EditReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `EditReturnModal` | function | 6 |
| 2 | `T` | const arrow | 8 |
| 3 | `updateQty` | const arrow | 33 |
| 4 | `updateRestock` | const arrow | 36 |
| 5 | `handleSubmit` | const arrow | 44 |

### 3.478 `business-os-v3-centralized-server-template/frontend/src/components/returns/NewReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NewReturnModal` | function | 7 |
| 2 | `T` | const arrow | 9 |
| 3 | `handleSearch` | const arrow | 34 |
| 4 | `handleReturnTypeChange` | const arrow | 74 |
| 5 | `toggleIncluded` | const arrow | 79 |
| 6 | `updateItemQty` | const arrow | 87 |
| 7 | `updateItemRestock` | const arrow | 95 |
| 8 | `selectAll` | const arrow | 99 |
| 9 | `clearAll` | const arrow | 102 |
| 10 | `handleSubmit` | const arrow | 109 |

### 3.479 `business-os-v3-centralized-server-template/frontend/src/components/returns/NewSupplierReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NewSupplierReturnModal` | export default function | 4 |
| 2 | `tr` | const arrow | 6 |
| 3 | `updateQty` | const arrow | 113 |
| 4 | `submit` | const arrow | 119 |

### 3.480 `business-os-v3-centralized-server-template/frontend/src/components/returns/ReturnDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeScope` | function | 6 |
| 2 | `ReturnDetailModal` | export default function | 10 |
| 3 | `tr` | const arrow | 12 |

### 3.481 `business-os-v3-centralized-server-template/frontend/src/components/returns/Returns.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeScope` | function | 14 |
| 2 | `Returns` | export default function | 18 |
| 3 | `tr` | const arrow | 30 |
| 4 | `handleOpenEdit` | const arrow | 58 |
| 5 | `renderAmount` | const arrow | 121 |

### 3.482 `business-os-v3-centralized-server-template/frontend/src/components/sales/ExportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ExportModal` | export default function | 6 |
| 2 | `tr` | const arrow | 13 |
| 3 | `computeDates` | const arrow | 18 |
| 4 | `validateDates` | const arrow | 37 |
| 5 | `downloadCsvBlob` | const arrow | 45 |
| 6 | `buildCsvFallback` | const arrow | 55 |
| 7 | `escape` | const arrow | 59 |
| 8 | `handlePreview` | const arrow | 80 |
| 9 | `handleExportCSV` | const arrow | 93 |

### 3.483 `business-os-v3-centralized-server-template/frontend/src/components/sales/SaleDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `InfoBlock` | function | 5 |
| 2 | `parseItems` | function | 21 |
| 3 | `SaleDetailModal` | export default function | 31 |
| 4 | `translateOr` | const arrow | 47 |
| 5 | `handleStatusUpdate` | const arrow | 69 |
| 6 | `handleMembershipAttach` | const arrow | 80 |

### 3.484 `business-os-v3-centralized-server-template/frontend/src/components/sales/Sales.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `multiMatch` | function | 11 |
| 2 | `getSaleBranchLabel` | function | 15 |
| 3 | `Sales` | export default function | 23 |
| 4 | `handleStatusChange` | const arrow | 68 |
| 5 | `handleAttachMembership` | const arrow | 80 |

### 3.485 `business-os-v3-centralized-server-template/frontend/src/components/sales/StatusBadge.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getStatusLabel` | export function | 23 |
| 2 | `StatusBadge` | export default function | 39 |

### 3.486 `business-os-v3-centralized-server-template/frontend/src/components/server/ServerPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isAutoDetected` | function | 13 |
| 2 | `StatusRow` | function | 20 |
| 3 | `InfoTab` | function | 32 |
| 4 | `fmt` | const arrow | 83 |
| 5 | `DiagnosticsPanel` | function | 169 |
| 6 | `onErr` | const arrow | 181 |
| 7 | `ServerPage` | export default function | 314 |
| 8 | `check` | const arrow | 337 |
| 9 | `loadSecurityConfig` | const arrow | 359 |
| 10 | `handleTest` | function | 372 |
| 11 | `handleSave` | function | 394 |
| 12 | `handleDisconnect` | function | 401 |

### 3.487 `business-os-v3-centralized-server-template/frontend/src/components/shared/ImageGalleryLightbox.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ImageGalleryLightbox` | export default function | 8 |
| 2 | `formatLabel` | function | 30 |
| 3 | `setIndex` | function | 34 |
| 4 | `renderGalleryImage` | function | 40 |
| 5 | `onKeyDown` | function | 47 |

### 3.488 `business-os-v3-centralized-server-template/frontend/src/components/shared/Modal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Modal` | export default function | 10 |

### 3.489 `business-os-v3-centralized-server-template/frontend/src/components/shared/navigationConfig.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseNavSetting` | export function | 23 |
| 2 | `orderNavItems` | export function | 32 |

### 3.490 `business-os-v3-centralized-server-template/frontend/src/components/shared/PageHelpButton.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PageHelpButton` | export default function | 6 |

### 3.491 `business-os-v3-centralized-server-template/frontend/src/components/shared/pageHelpContent.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getPageHelpContent` | export function | 442 |

### 3.492 `business-os-v3-centralized-server-template/frontend/src/components/shared/PortalMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PortalMenu` | export default function | 11 |
| 2 | `closeIfClickedOutside` | const arrow | 48 |
| 3 | `closeMenu` | const arrow | 55 |
| 4 | `ThreeDotPortal` | export function | 124 |

### 3.493 `business-os-v3-centralized-server-template/frontend/src/components/users/PermissionEditor.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PermissionEditor` | export default function | 15 |
| 2 | `translate` | const arrow | 16 |
| 3 | `labelFor` | const arrow | 22 |
| 4 | `toggle` | const arrow | 25 |

### 3.494 `business-os-v3-centralized-server-template/frontend/src/components/users/UserDetailSheet.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `translateLabel` | function | 4 |
| 2 | `buildRowData` | function | 9 |
| 3 | `UserDetailSheet` | export default function | 21 |

### 3.495 `business-os-v3-centralized-server-template/frontend/src/components/users/UserProfileModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `AvatarPreview` | function | 19 |
| 2 | `UserProfileModal` | export default function | 37 |
| 3 | `tr` | const arrow | 39 |
| 4 | `loadProfile` | const arrow | 82 |
| 5 | `handleProfileSave` | const arrow | 128 |
| 6 | `handlePasswordSave` | const arrow | 181 |
| 7 | `handleSessionSave` | const arrow | 210 |
| 8 | `refreshOtpState` | const arrow | 219 |
| 9 | `handleAvatarPick` | const arrow | 225 |
| 10 | `handleStartOauthLink` | const arrow | 227 |
| 11 | `handleDisconnectOauthProvider` | const arrow | 263 |
| 12 | `handleAvatarSelected` | const arrow | 303 |

### 3.496 `business-os-v3-centralized-server-template/frontend/src/components/users/Users.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ThreeDot` | function | 22 |
| 2 | `formatContactValue` | function | 57 |
| 3 | `Users` | export default function | 62 |
| 4 | `tr` | const arrow | 65 |
| 5 | `canManageTargetUser` | const arrow | 89 |
| 6 | `load` | const arrow | 95 |
| 7 | `openCreateUser` | const arrow | 127 |
| 8 | `openEditUser` | const arrow | 134 |
| 9 | `openCreateRole` | const arrow | 151 |
| 10 | `openEditRole` | const arrow | 158 |
| 11 | `getRolePermissions` | const arrow | 169 |
| 12 | `getPermissionSummary` | const arrow | 178 |
| 13 | `handleSaveUser` | const arrow | 196 |
| 14 | `handleResetPassword` | const arrow | 245 |
| 15 | `handleSaveRole` | const arrow | 274 |
| 16 | `handleDeleteRole` | const arrow | 309 |

### 3.497 `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/AuditLog.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toIso` | function | 32 |
| 2 | `formatDateTime` | function | 38 |
| 3 | `formatLogTime` | function | 56 |
| 4 | `formatJsonPretty` | function | 60 |
| 5 | `parseLogJson` | function | 68 |
| 6 | `formatEntityName` | function | 76 |
| 7 | `extractReference` | function | 82 |
| 8 | `readableSummary` | function | 97 |
| 9 | `recordIdentifier` | function | 111 |
| 10 | `DetailRow` | function | 118 |
| 11 | `AuditLog` | export default function | 130 |

### 3.498 `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/Backup.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PathActionButton` | function | 30 |
| 2 | `PrimaryActionButton` | function | 42 |
| 3 | `useCopy` | function | 54 |
| 4 | `buildPathCrumbs` | function | 61 |
| 5 | `buildFinalDataFolderPath` | function | 79 |
| 6 | `formatDateTime` | function | 92 |
| 7 | `formatBytes` | function | 107 |
| 8 | `countBackupRows` | function | 116 |
| 9 | `buildBackupPreview` | function | 126 |
| 10 | `SectionChip` | function | 164 |
| 11 | `FolderBrowserPanel` | function | 179 |
| 12 | `DataFolderLocation` | function | 292 |
| 13 | `load` | const arrow | 302 |
| 14 | `openBrowser` | const arrow | 326 |
| 15 | `openDriveBrowser` | const arrow | 338 |
| 16 | `pickFolderNatively` | const arrow | 342 |
| 17 | `openInlinePicker` | const arrow | 369 |
| 18 | `openInExplorer` | const arrow | 377 |
| 19 | `selectDir` | const arrow | 392 |
| 20 | `handleApply` | const arrow | 398 |
| 21 | `handleReset` | const arrow | 419 |
| 22 | `GoogleDriveSyncSection` | function | 534 |
| 23 | `load` | const arrow | 547 |
| 24 | `handler` | const arrow | 568 |
| 25 | `savePreferences` | const arrow | 584 |
| 26 | `connectGoogleDrive` | const arrow | 603 |
| 27 | `syncNow` | const arrow | 637 |
| 28 | `disconnect` | const arrow | 654 |
| 29 | `Backup` | export default function | 792 |
| 30 | `browseServerFolders` | const arrow | 816 |
| 31 | `toggleServerBrowser` | const arrow | 829 |
| 32 | `handleExport` | const arrow | 840 |
| 33 | `pickFolder` | const arrow | 853 |
| 34 | `handleFolderExport` | const arrow | 866 |
| 35 | `handleFolderImport` | const arrow | 884 |
| 36 | `handleChooseImportFile` | const arrow | 905 |
| 37 | `handleConfirmImport` | const arrow | 921 |

### 3.499 `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/FontFamilyPicker.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `FontFamilyPicker` | function | 20 |

### 3.500 `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/index.js`

- No top-level named symbols detected.

### 3.501 `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/OtpModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `OtpModal` | function | 7 |
| 2 | `handleConfirm` | const arrow | 28 |
| 3 | `handleDisable` | const arrow | 39 |

### 3.502 `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/ResetData.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ConfirmReset` | function | 6 |
| 2 | `T` | const arrow | 19 |
| 3 | `ResetData` | function | 87 |
| 4 | `T` | const arrow | 89 |
| 5 | `doReset` | const arrow | 116 |
| 6 | `FactoryReset` | function | 174 |
| 7 | `T` | const arrow | 176 |
| 8 | `doFactoryReset` | function | 182 |

### 3.503 `business-os-v3-centralized-server-template/frontend/src/components/utils-settings/Settings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseStoredColors` | function | 91 |
| 2 | `buildColorChoices` | function | 102 |
| 3 | `useCopy` | function | 193 |
| 4 | `getSettingsNavLabel` | function | 201 |
| 5 | `SwatchPicker` | function | 218 |
| 6 | `Settings` | export default function | 301 |
| 7 | `setValue` | const arrow | 405 |
| 8 | `formatPreviewDateTime` | const arrow | 424 |
| 9 | `moveNavItem` | const arrow | 440 |
| 10 | `toggleMobilePinned` | const arrow | 450 |
| 11 | `movePinnedItem` | const arrow | 462 |
| 12 | `movePinnedBefore` | const arrow | 472 |
| 13 | `resetNavigationLayout` | const arrow | 484 |
| 14 | `field` | const arrow | 489 |
| 15 | `savePaymentMethods` | const arrow | 511 |
| 16 | `uploadImageSetting` | const arrow | 516 |

### 3.504 `business-os-v3-centralized-server-template/frontend/src/constants.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createEmptyOrder` | export function | 120 |
| 2 | `formatDate` | export function | 150 |
| 3 | `isNetworkError` | export function | 170 |

### 3.505 `business-os-v3-centralized-server-template/frontend/src/index.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isIgnoredRuntimeMessage` | const arrow | 17 |
| 2 | `safeInsertRule` | const function | 25 |
| 3 | `safeCssRulesGetter` | const function | 42 |
| 4 | `stopKnownStartupNoise` | const arrow | 58 |

### 3.506 `business-os-v3-centralized-server-template/frontend/src/utils/appRefresh.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `refreshAppData` | export function | 18 |

### 3.507 `business-os-v3-centralized-server-template/frontend/src/utils/csv.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `downloadCSV` | export function | 10 |

### 3.508 `business-os-v3-centralized-server-template/frontend/src/utils/dateHelpers.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `todayStr` | export function | 10 |
| 2 | `offsetDate` | export function | 20 |

### 3.509 `business-os-v3-centralized-server-template/frontend/src/utils/deviceInfo.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getClientDeviceInfo` | export function | 1 |
| 2 | `getClientMetaHeaders` | export function | 24 |

### 3.510 `business-os-v3-centralized-server-template/frontend/src/utils/favicon.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `clamp` | function | 1 |
| 2 | `loadImage` | function | 5 |
| 3 | `createCircularFaviconDataUrl` | export function | 19 |

### 3.511 `business-os-v3-centralized-server-template/frontend/src/utils/firebasePhoneAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `disabled` | function | 6 |
| 2 | `requestFirebasePhoneCode` | export function | 10 |
| 3 | `confirmFirebasePhoneCode` | export function | 14 |
| 4 | `cleanupFirebasePhoneVerification` | export function | 18 |

### 3.512 `business-os-v3-centralized-server-template/frontend/src/utils/formatters.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fmtTime` | export function | 9 |
| 2 | `fmtDate` | export function | 25 |
| 3 | `fmtShort` | export function | 39 |
| 4 | `fmtCount` | export function | 51 |

### 3.513 `business-os-v3-centralized-server-template/frontend/src/utils/index.js`

- No top-level named symbols detected.

### 3.514 `business-os-v3-centralized-server-template/frontend/src/utils/printReceipt.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cloneWithInlineStyles` | function | 80 |
| 2 | `mmToPt` | function | 103 |
| 3 | `dataUrlToBytes` | function | 107 |
| 4 | `joinPdfChunks` | function | 117 |
| 5 | `buildPdfStream` | function | 128 |
| 6 | `buildSingleImagePdf` | function | 137 |
| 7 | `escapePdfText` | function | 175 |
| 8 | `wrapTextLine` | function | 182 |
| 9 | `buildTextOnlyPdf` | function | 201 |
| 10 | `buildReceiptFileName` | function | 254 |
| 11 | `waitForElementAssets` | function | 264 |
| 12 | `renderElementToCanvas` | function | 293 |
| 13 | `withReceiptElement` | function | 344 |
| 14 | `downloadBlob` | function | 367 |
| 15 | `getPrintSettings` | export function | 378 |
| 16 | `savePrintSettings` | export function | 386 |
| 17 | `getPaperWidthMm` | export function | 392 |
| 18 | `createReceiptPdfBlob` | export function | 402 |
| 19 | `downloadReceiptPdf` | export function | 434 |
| 20 | `openReceiptPdf` | export function | 441 |
| 21 | `printReceipt` | export function | 454 |

### 3.515 `business-os-v3-centralized-server-template/frontend/src/web-api.js`

- No top-level named symbols detected.

### 3.516 `business-os-v3-centralized-server-template/frontend/tailwind.config.js`

- No top-level named symbols detected.

### 3.517 `business-os-v3-centralized-server-template/frontend/tests/appShellUtils.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.518 `business-os-v3-centralized-server-template/frontend/tests/portalEditorUtils.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |

### 3.519 `business-os-v3-centralized-server-template/frontend/vite.config.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fixCrossorigin` | function | 29 |

### 3.520 `frontend/postcss.config.js`

- No top-level named symbols detected.

### 3.521 `frontend/src/api/http.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSyncServerUrl` | export function | 39 |
| 2 | `getSyncToken` | export function | 40 |
| 3 | `getAuthSessionToken` | export function | 41 |
| 4 | `setSyncServerUrl` | export function | 43 |
| 5 | `setSyncToken` | export function | 44 |
| 6 | `setAuthSessionToken` | export function | 45 |
| 7 | `cacheGet` | export function | 52 |
| 8 | `cacheSet` | export function | 56 |
| 9 | `cacheInvalidate` | export function | 57 |
| 10 | `cacheClearAll` | export function | 60 |
| 11 | `logCall` | function | 74 |
| 12 | `getCallLog` | export function | 79 |
| 13 | `clearCallLog` | export function | 80 |
| 14 | `getClientMetaHeaders` | function | 82 |
| 15 | `dispatchGlobalDataRefresh` | function | 86 |
| 16 | `apiFetch` | export function | 96 |
| 17 | `parsed` | const arrow | 119 |
| 18 | `isNetErr` | export function | 139 |
| 19 | `isConnectivityError` | function | 145 |
| 20 | `isServerOnline` | export function | 164 |
| 21 | `setServerHealth` | function | 166 |
| 22 | `startHealthCheck` | export function | 181 |
| 23 | `cacheGetStale` | export function | 216 |
| 24 | `route` | export function | 233 |

### 3.522 `frontend/src/api/localDb.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `localGetSettings` | export function | 38 |
| 2 | `localSaveSettings` | export function | 45 |
| 3 | `parseCSV` | export function | 54 |
| 4 | `splitCSVLine` | function | 67 |
| 5 | `buildCSVTemplate` | export function | 78 |

### 3.523 `frontend/src/api/methods.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDeviceInfo` | function | 3 |
| 2 | `getPortalBaseUrl` | function | 19 |
| 3 | `getCurrentUserContext` | function | 24 |
| 4 | `queueOfflineWrite` | function | 39 |
| 5 | `appendActorQuery` | function | 48 |
| 6 | `fetchJsonWithTimeout` | function | 61 |
| 7 | `login` | export function | 80 |
| 8 | `logout` | export function | 83 |
| 9 | `resetPasswordWithOtp` | export function | 86 |
| 10 | `requestPasswordResetEmail` | export function | 89 |
| 11 | `completePasswordReset` | export function | 92 |
| 12 | `getVerificationCapabilities` | export function | 95 |
| 13 | `getSystemConfig` | export function | 98 |
| 14 | `getSystemDebugLog` | export function | 101 |
| 15 | `startSupabaseOauth` | export function | 104 |
| 16 | `completeSupabaseOauth` | export function | 107 |
| 17 | `getOrganizationBootstrap` | export function | 110 |
| 18 | `searchOrganizations` | export function | 113 |
| 19 | `getCurrentOrganization` | export function | 117 |
| 20 | `getSettings` | export function | 122 |
| 21 | `saveSettings` | export function | 125 |
| 22 | `getCategories` | const arrow | 131 |
| 23 | `updateCategory` | const arrow | 133 |
| 24 | `getUnits` | const arrow | 137 |
| 25 | `getCustomFields` | const arrow | 142 |
| 26 | `updateCustomField` | const arrow | 144 |
| 27 | `getBranches` | const arrow | 148 |
| 28 | `updateBranch` | const arrow | 150 |
| 29 | `deleteBranch` | const arrow | 151 |
| 30 | `getTransfers` | const arrow | 153 |
| 31 | `getProducts` | const arrow | 157 |
| 32 | `getCatalogMeta` | export function | 158 |
| 33 | `getCatalogProducts` | export function | 166 |
| 34 | `getPortalConfig` | export function | 174 |
| 35 | `getPortalCatalogMeta` | export function | 182 |
| 36 | `getPortalCatalogProducts` | export function | 190 |
| 37 | `lookupPortalMembership` | export function | 198 |
| 38 | `createPortalSubmission` | export function | 208 |
| 39 | `getPortalAiStatus` | export function | 222 |
| 40 | `askPortalAi` | export function | 230 |
| 41 | `getPortalSubmissionsForReview` | const arrow | 244 |
| 42 | `reviewPortalSubmission` | const arrow | 246 |
| 43 | `getAiProviders` | const arrow | 249 |
| 44 | `createAiProvider` | const arrow | 251 |
| 45 | `updateAiProvider` | const arrow | 253 |
| 46 | `deleteAiProvider` | const arrow | 255 |
| 47 | `testAiProvider` | const arrow | 257 |
| 48 | `getAiResponses` | const arrow | 259 |
| 49 | `createProduct` | export function | 261 |
| 50 | `updateProduct` | export function | 292 |
| 51 | `getFiles` | export function | 320 |
| 52 | `uploadFileAsset` | export function | 326 |
| 53 | `deleteFileAsset` | export function | 356 |
| 54 | `uploadProductImage` | export function | 365 |
| 55 | `uploadUserAvatar` | export function | 394 |
| 56 | `openCSVDialog` | export function | 431 |
| 57 | `openImageDialog` | export function | 451 |
| 58 | `getImageDataUrl` | export function | 459 |
| 59 | `getInventorySummary` | const arrow | 468 |
| 60 | `getInventoryMovements` | const arrow | 469 |
| 61 | `createSale` | export function | 472 |
| 62 | `flushPendingSyncQueue` | export function | 492 |
| 63 | `getSales` | const arrow | 550 |
| 64 | `getDashboard` | const arrow | 556 |
| 65 | `getAnalytics` | const arrow | 557 |
| 66 | `getCustomers` | const arrow | 566 |
| 67 | `updateCustomer` | const arrow | 568 |
| 68 | `downloadCustomerTemplate` | const arrow | 571 |
| 69 | `getSuppliers` | const arrow | 574 |
| 70 | `updateSupplier` | const arrow | 576 |
| 71 | `downloadSupplierTemplate` | const arrow | 579 |
| 72 | `getDeliveryContacts` | const arrow | 582 |
| 73 | `updateDeliveryContact` | const arrow | 584 |
| 74 | `getUsers` | const arrow | 589 |
| 75 | `updateUser` | const arrow | 591 |
| 76 | `getUserProfile` | const arrow | 592 |
| 77 | `getUserAuthMethods` | const arrow | 593 |
| 78 | `updateUserProfile` | const arrow | 595 |
| 79 | `disconnectUserAuthProvider` | const arrow | 597 |
| 80 | `changeUserPassword` | const arrow | 599 |
| 81 | `resetPassword` | const arrow | 601 |
| 82 | `getRoles` | const arrow | 604 |
| 83 | `updateRole` | const arrow | 606 |
| 84 | `deleteRole` | const arrow | 607 |
| 85 | `getCustomTables` | const arrow | 610 |
| 86 | `getCustomTableData` | const arrow | 612 |
| 87 | `insertCustomRow` | const arrow | 613 |
| 88 | `updateCustomRow` | const arrow | 614 |
| 89 | `deleteCustomRow` | const arrow | 615 |
| 90 | `getAuditLogs` | const arrow | 618 |
| 91 | `exportBackup` | export function | 621 |
| 92 | `exportBackupFolder` | export function | 638 |
| 93 | `pickBackupFile` | export function | 642 |
| 94 | `importBackupData` | export function | 657 |
| 95 | `importBackupFolder` | export function | 663 |
| 96 | `importBackup` | export function | 669 |
| 97 | `getGoogleDriveSyncStatus` | const arrow | 684 |
| 98 | `saveGoogleDriveSyncPreferences` | const arrow | 687 |
| 99 | `startGoogleDriveSyncOauth` | const arrow | 690 |
| 100 | `disconnectGoogleDriveSync` | const arrow | 693 |
| 101 | `syncGoogleDriveNow` | const arrow | 696 |
| 102 | `resetData` | export function | 699 |
| 103 | `factoryReset` | export function | 705 |
| 104 | `downloadImportTemplate` | export function | 712 |
| 105 | `openPath` | export function | 732 |
| 106 | `getReturns` | const arrow | 741 |
| 107 | `updateSaleStatus` | const arrow | 751 |
| 108 | `attachSaleCustomer` | const arrow | 755 |
| 109 | `getSalesExport` | const arrow | 758 |
| 110 | `updateReturn` | const arrow | 762 |
| 111 | `testSyncServer` | export function | 766 |
| 112 | `openFolderDialog` | export function | 785 |
| 113 | `getDataPath` | const arrow | 796 |
| 114 | `setDataPath` | const arrow | 797 |
| 115 | `resetDataPath` | const arrow | 798 |
| 116 | `browseDir` | const arrow | 799 |

### 3.524 `frontend/src/api/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `connectWS` | export function | 18 |
| 2 | `disconnectWS` | export function | 92 |
| 3 | `scheduleReconnect` | function | 100 |
| 4 | `isWSConnected` | export function | 116 |

### 3.525 `frontend/src/App.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getChunkErrorMessage` | function | 61 |
| 2 | `isChunkLoadError` | function | 66 |
| 3 | `createChunkTimeoutError` | function | 75 |
| 4 | `isRetryableImportError` | function | 81 |
| 5 | `importWithTimeout` | function | 89 |
| 6 | `clearRetryMarker` | function | 105 |
| 7 | `triggerChunkRecoveryReload` | function | 112 |
| 8 | `createChunkReloadStallError` | function | 122 |
| 9 | `shouldRetryChunk` | function | 128 |
| 10 | `lazyWithRetry` | function | 138 |
| 11 | `getWarmupImporters` | function | 212 |
| 12 | `useMountedPages` | function | 223 |
| 13 | `useSyncErrorBanner` | function | 237 |
| 14 | `onSyncError` | const arrow | 242 |
| 15 | `useVisibilityRecovery` | function | 253 |
| 16 | `onVisible` | const arrow | 257 |
| 17 | `onFocus` | const arrow | 267 |
| 18 | `useChunkWarmup` | function | 285 |
| 19 | `runWarmup` | const arrow | 297 |
| 20 | `PageErrorBoundary` | class | 333 |
| 21 | `Notification` | function | 381 |
| 22 | `SyncErrorBanner` | function | 393 |
| 23 | `PageLoader` | function | 413 |
| 24 | `PageSlot` | function | 424 |
| 25 | `PublicCatalogView` | function | 447 |
| 26 | `App` | export default function | 460 |

### 3.526 `frontend/src/app/appShellUtils.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isPublicCatalogPath` | export function | 7 |
| 2 | `updateMountedPages` | export function | 17 |
| 3 | `getNotificationPrefix` | export function | 27 |
| 4 | `getNotificationColor` | export function | 34 |

### 3.527 `frontend/src/AppContext.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readDeviceSettings` | function | 52 |
| 2 | `writeDeviceSettings` | function | 60 |
| 3 | `mergeSettingsWithDeviceOverrides` | function | 66 |
| 4 | `normalizeDateInput` | function | 70 |
| 5 | `LoadingScreen` | function | 95 |
| 6 | `AccessDenied` | function | 108 |
| 7 | `AppProvider` | export function | 120 |
| 8 | `onUpdate` | const arrow | 215 |
| 9 | `onStatus` | const arrow | 225 |
| 10 | `poll` | const arrow | 233 |
| 11 | `onError` | const arrow | 253 |
| 12 | `onUnauthorized` | const arrow | 257 |
| 13 | `handleOtpLogin` | const arrow | 289 |
| 14 | `handleUserUpdated` | const arrow | 329 |
| 15 | `discoverSyncUrl` | const arrow | 357 |
| 16 | `hexAlpha` | const arrow | 453 |
| 17 | `clearCallbackUrl` | const arrow | 618 |
| 18 | `clearPendingLink` | const arrow | 622 |
| 19 | `run` | const arrow | 626 |
| 20 | `useApp` | const arrow | 863 |
| 21 | `useSync` | const arrow | 864 |
| 22 | `useT` | const arrow | 867 |

### 3.528 `frontend/src/components/auth/Login.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `OauthButton` | function | 16 |
| 2 | `ModeBackButton` | function | 30 |
| 3 | `Login` | export default function | 43 |
| 4 | `tr` | const arrow | 45 |
| 5 | `rememberOrganization` | const arrow | 88 |
| 6 | `loadCapabilities` | const arrow | 115 |
| 7 | `bootstrap` | const arrow | 132 |
| 8 | `clearCallbackUrl` | const arrow | 191 |
| 9 | `run` | const arrow | 196 |
| 10 | `rememberedOrg` | const arrow | 224 |
| 11 | `getDeviceContext` | const arrow | 269 |
| 12 | `handleLogin` | const arrow | 271 |
| 13 | `handleOtp` | const arrow | 291 |
| 14 | `handleOtpInput` | const arrow | 321 |
| 15 | `handleResetWithOtp` | const arrow | 326 |
| 16 | `handleResetWithEmail` | const arrow | 360 |
| 17 | `handleCompleteEmailReset` | const arrow | 386 |
| 18 | `handleStartOauth` | const arrow | 416 |
| 19 | `closeAuxMode` | const arrow | 446 |

### 3.529 `frontend/src/components/branches/Branches.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatTransferDate` | function | 19 |
| 2 | `Branches` | export default function | 36 |
| 3 | `load` | const arrow | 58 |
| 4 | `loadBranchStock` | const arrow | 94 |
| 5 | `handleSaveBranch` | const arrow | 109 |
| 6 | `handleDelete` | const arrow | 128 |
| 7 | `handleBulkDelete` | const arrow | 143 |
| 8 | `toggleSelect` | const arrow | 168 |
| 9 | `toggleSelectAll` | const arrow | 177 |

### 3.530 `frontend/src/components/branches/BranchForm.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BranchForm` | export default function | 11 |
| 2 | `set` | const arrow | 33 |
| 3 | `handleSave` | const arrow | 45 |

### 3.531 `frontend/src/components/branches/TransferModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `TransferModal` | export default function | 11 |
| 2 | `run` | const arrow | 36 |
| 3 | `handleTransfer` | const arrow | 70 |

### 3.532 `frontend/src/components/catalog/CatalogPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getAboutBlockLabel` | function | 41 |
| 2 | `withAssetVersion` | function | 47 |
| 3 | `tt` | function | 522 |
| 4 | `toBoolean` | function | 527 |
| 5 | `toNumber` | function | 534 |
| 6 | `normalizePriceDisplay` | function | 540 |
| 7 | `normalizeHexColor` | function | 545 |
| 8 | `normalizeExternalUrl` | function | 551 |
| 9 | `buildFaqStarterItems` | function | 567 |
| 10 | `buildAiFaqStarterItems` | function | 647 |
| 11 | `hexToRgba` | function | 678 |
| 12 | `readPortalCache` | function | 689 |
| 13 | `writePortalCache` | function | 705 |
| 14 | `normalizePortalPath` | function | 719 |
| 15 | `isReservedPortalPath` | function | 732 |
| 16 | `buildDraft` | function | 737 |
| 17 | `applyDraft` | function | 821 |
| 18 | `statusClass` | function | 936 |
| 19 | `getBranchQty` | function | 943 |
| 20 | `getStockStatus` | function | 950 |
| 21 | `normalizeProductGallery` | function | 960 |
| 22 | `formatDateTime` | function | 978 |
| 23 | `formatPortalPrice` | function | 985 |
| 24 | `SectionShell` | function | 998 |
| 25 | `SummaryTile` | function | 1014 |
| 26 | `StatusPill` | function | 1038 |
| 27 | `ImageField` | function | 1053 |
| 28 | `pickImageAsDataUrl` | function | 1119 |
| 29 | `pickMultipleImagesAsDataUrls` | function | 1138 |
| 30 | `replaceVars` | function | 1159 |
| 31 | `applyGoogleTranslateSelection` | function | 1196 |
| 32 | `CatalogPage` | export default function | 1218 |
| 33 | `copy` | const arrow | 1289 |
| 34 | `resolveVisibleTab` | const arrow | 1290 |
| 35 | `openProductGallery` | function | 1382 |
| 36 | `changeTranslateTarget` | function | 1395 |
| 37 | `loadPortal` | function | 1407 |
| 38 | `run` | function | 1471 |
| 39 | `toggleFilterValue` | function | 1695 |
| 40 | `clearPortalFilters` | function | 1703 |
| 41 | `setDraft` | function | 1710 |
| 42 | `openPortalImage` | function | 1715 |
| 43 | `setAboutBlocksDraft` | function | 1726 |
| 44 | `updateAboutBlock` | function | 1730 |
| 45 | `addAboutBlock` | function | 1736 |
| 46 | `moveAboutBlockBefore` | function | 1740 |
| 47 | `removeAboutBlock` | function | 1752 |
| 48 | `setFaqDraft` | function | 1756 |
| 49 | `addFaqItem` | function | 1760 |
| 50 | `mergeFaqStarterItems` | function | 1771 |
| 51 | `addFaqStarterSet` | function | 1784 |
| 52 | `addAiFaqStarterSet` | function | 1788 |
| 53 | `updateFaqItem` | function | 1792 |
| 54 | `removeFaqItem` | function | 1798 |
| 55 | `clearAssistantState` | function | 1802 |
| 56 | `uploadPortalImage` | function | 1817 |
| 57 | `uploadDraftImage` | function | 1836 |
| 58 | `uploadAboutBlockMedia` | function | 1841 |
| 59 | `openFilePicker` | function | 1850 |
| 60 | `handleFilePickerSelect` | function | 1854 |
| 61 | `savePortalDraft` | function | 1870 |
| 62 | `askAssistant` | function | 1990 |
| 63 | `handleMembershipLookup` | function | 2023 |
| 64 | `addSubmissionImages` | function | 2049 |
| 65 | `handleSubmissionPaste` | function | 2058 |
| 66 | `handleSubmitShareProof` | function | 2074 |
| 67 | `handleReviewSubmission` | function | 2109 |

### 3.533 `frontend/src/components/catalog/portalEditorUtils.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toTrimmedString` | function | 3 |
| 2 | `safeJsonParse` | function | 7 |
| 3 | `createAboutBlock` | export function | 15 |
| 4 | `normalizeAboutBlocks` | export function | 27 |
| 5 | `serializeAboutBlocks` | export function | 47 |
| 6 | `moveListItem` | export function | 51 |
| 7 | `extractGoogleMapsEmbedUrl` | export function | 64 |
| 8 | `normalizeGoogleMapsEmbed` | export function | 72 |

### 3.534 `frontend/src/components/contacts/Contacts.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `TABS` | const arrow | 14 |
| 2 | `ImportTypePicker` | function | 20 |
| 3 | `T` | const arrow | 21 |
| 4 | `Contacts` | export default function | 60 |
| 5 | `handleExportAll` | const arrow | 67 |
| 6 | `openImportPicker` | const arrow | 118 |
| 7 | `handleTypeSelected` | const arrow | 120 |
| 8 | `handleImportDone` | const arrow | 125 |

### 3.535 `frontend/src/components/contacts/CustomersTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseContactOptions` | export function | 9 |
| 2 | `serializeContactOptions` | export function | 30 |
| 3 | `BLANK_OPTION` | const arrow | 41 |
| 4 | `generateMembershipNumber` | function | 43 |
| 5 | `tr` | function | 49 |
| 6 | `OptionEditor` | function | 54 |
| 7 | `setField` | const arrow | 55 |
| 8 | `buildOptionSummary` | function | 95 |
| 9 | `CustomerForm` | function | 103 |
| 10 | `setField` | const arrow | 113 |
| 11 | `addOption` | const arrow | 114 |
| 12 | `removeOption` | const arrow | 115 |
| 13 | `updateOption` | const arrow | 116 |
| 14 | `CustomersTab` | function | 190 |
| 15 | `handleSave` | const arrow | 230 |
| 16 | `handleDelete` | const arrow | 254 |
| 17 | `handleBulkDelete` | const arrow | 267 |

### 3.536 `frontend/src/components/contacts/DeliveryTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseDeliveryOptions` | export function | 15 |
| 2 | `serializeDeliveryOptions` | export function | 30 |
| 3 | `BLANK_OPTION` | const arrow | 37 |
| 4 | `OptionEditor` | function | 40 |
| 5 | `set` | const arrow | 41 |
| 6 | `DeliveryForm` | function | 71 |
| 7 | `set` | const arrow | 74 |
| 8 | `handleSave` | const arrow | 75 |
| 9 | `OptionsDisplay` | function | 115 |
| 10 | `OptionsBadge` | function | 132 |
| 11 | `DeliveryTab` | function | 143 |
| 12 | `handleSave` | const arrow | 174 |
| 13 | `handleDelete` | const arrow | 189 |
| 14 | `handleBulkDelete` | const arrow | 195 |

### 3.537 `frontend/src/components/contacts/shared.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `useContactSelection` | export function | 11 |
| 2 | `toggleOne` | const arrow | 25 |
| 3 | `clearSelection` | const arrow | 36 |
| 4 | `ThreeDotMenu` | export function | 62 |
| 5 | `DetailModal` | export function | 121 |
| 6 | `ContactTable` | export function | 152 |
| 7 | `ImportModal` | export function | 225 |
| 8 | `handlePickFile` | const arrow | 246 |
| 9 | `handleChooseExistingFile` | const arrow | 254 |
| 10 | `handleDownloadTemplate` | const arrow | 276 |
| 11 | `handleImport` | const arrow | 280 |

### 3.538 `frontend/src/components/contacts/SuppliersTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `SupplierForm` | function | 9 |
| 2 | `set` | const arrow | 14 |
| 3 | `SuppliersTab` | function | 60 |
| 4 | `handleSave` | const arrow | 101 |
| 5 | `handleDelete` | const arrow | 121 |
| 6 | `handleBulkDelete` | const arrow | 134 |

### 3.539 `frontend/src/components/custom-tables/CustomTables.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CustomTables` | export default function | 6 |
| 2 | `loadTables` | const arrow | 17 |
| 3 | `addColumn` | const arrow | 39 |
| 4 | `updateColumn` | const arrow | 43 |
| 5 | `removeColumn` | const arrow | 47 |
| 6 | `handleCreateTable` | const arrow | 51 |
| 7 | `handleSaveRow` | const arrow | 64 |
| 8 | `handleDeleteRow` | const arrow | 78 |
| 9 | `openAddRow` | const arrow | 84 |
| 10 | `openEditRow` | const arrow | 91 |

### 3.540 `frontend/src/components/dashboard/charts/BarChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BarChart` | export default function | 14 |
| 2 | `yPx` | function | 32 |

### 3.541 `frontend/src/components/dashboard/charts/DonutChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `DonutChart` | export default function | 14 |

### 3.542 `frontend/src/components/dashboard/charts/index.js`

- No top-level named symbols detected.

### 3.543 `frontend/src/components/dashboard/charts/LineChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `LineChart` | export default function | 13 |
| 2 | `xPx` | function | 29 |
| 3 | `yPx` | function | 30 |
| 4 | `handleMouseMove` | const arrow | 35 |

### 3.544 `frontend/src/components/dashboard/charts/NoData.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NoData` | export default function | 7 |

### 3.545 `frontend/src/components/dashboard/Dashboard.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Dashboard` | export default function | 11 |
| 2 | `translateOr` | const arrow | 15 |
| 3 | `calcTrend` | const arrow | 94 |
| 4 | `rangeLabel` | const arrow | 119 |
| 5 | `periodShort` | const arrow | 125 |
| 6 | `buildExportAll` | const arrow | 232 |

### 3.546 `frontend/src/components/dashboard/MiniStat.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `MiniStat` | export default function | 2 |

### 3.547 `frontend/src/components/files/FilePickerModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `AssetPreview` | function | 5 |
| 2 | `FilePickerModal` | export default function | 15 |
| 3 | `tr` | const arrow | 33 |
| 4 | `loadFiles` | function | 38 |
| 5 | `toggleSelectedPath` | function | 69 |
| 6 | `handleUpload` | function | 79 |
| 7 | `handleDelete` | function | 114 |

### 3.548 `frontend/src/components/files/FilesPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `AssetPreview` | function | 21 |
| 2 | `formatDateTime` | function | 35 |
| 3 | `ProviderStatus` | function | 45 |
| 4 | `emptyProviderForm` | function | 56 |
| 5 | `compactTabLabel` | function | 79 |
| 6 | `FilesPage` | export default function | 85 |
| 7 | `tr` | const arrow | 106 |
| 8 | `loadFiles` | function | 146 |
| 9 | `loadProviders` | function | 158 |
| 10 | `loadResponses` | function | 171 |
| 11 | `handleUpload` | function | 183 |
| 12 | `handleDeleteAsset` | function | 199 |
| 13 | `startCreateProvider` | function | 215 |
| 14 | `startEditProvider` | function | 231 |
| 15 | `saveProvider` | function | 255 |
| 16 | `testProvider` | function | 298 |
| 17 | `removeProvider` | function | 312 |
| 18 | `tabButton` | const arrow | 325 |

### 3.549 `frontend/src/components/inventory/DualMoney.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `DualMoney` | function | 5 |

### 3.550 `frontend/src/components/inventory/Inventory.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Inventory` | export default function | 13 |
| 2 | `handleAdjust` | const arrow | 93 |
| 3 | `openAdjust` | const arrow | 124 |
| 4 | `matchesSearch` | const arrow | 137 |
| 5 | `productHay` | const arrow | 144 |
| 6 | `movHay` | const arrow | 147 |

### 3.551 `frontend/src/components/inventory/movementGroups.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `minuteBucket` | function | 1 |
| 2 | `normalizeText` | function | 8 |
| 3 | `buildGroupKey` | function | 12 |
| 4 | `describeMovementType` | function | 28 |
| 5 | `buildMovementGroups` | export function | 33 |
| 6 | `movementGroupHaystack` | export function | 94 |

### 3.552 `frontend/src/components/inventory/ProductDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductDetailModal` | function | 6 |
| 2 | `T` | const arrow | 7 |

### 3.553 `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sanitizeInteger` | function | 101 |
| 2 | `sanitizeKhr` | function | 106 |
| 3 | `formatLookupValue` | function | 112 |
| 4 | `LoyaltyPointsPage` | export default function | 116 |
| 5 | `copy` | const arrow | 119 |
| 6 | `loadCustomerPoints` | function | 150 |
| 7 | `setValue` | function | 185 |
| 8 | `handleSave` | function | 189 |
| 9 | `handleLookup` | function | 211 |

### 3.554 `frontend/src/components/navigation/Sidebar.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getFallbackLabel` | function | 47 |
| 2 | `getNavLabel` | function | 55 |
| 3 | `isDarkColor` | function | 71 |
| 4 | `withAlpha` | function | 81 |
| 5 | `mergeStyles` | function | 87 |
| 6 | `Sidebar` | export default function | 91 |

### 3.555 `frontend/src/components/pos/CartItem.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CartItem` | function | 7 |

### 3.556 `frontend/src/components/pos/FilterPanel.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `POSFilterPanel` | export default function | 3 |
| 2 | `T` | const arrow | 24 |
| 3 | `clearAll` | const arrow | 34 |
| 4 | `chip` | const arrow | 42 |
| 5 | `SectionLabel` | const arrow | 48 |

### 3.557 `frontend/src/components/pos/POS.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `allTermsMatch` | function | 42 |
| 2 | `POS` | export default function | 47 |
| 3 | `posCopy` | const arrow | 50 |
| 4 | `setQuickFilter` | const arrow | 85 |
| 5 | `addNewOrder` | const arrow | 150 |
| 6 | `closeOrder` | const arrow | 162 |
| 7 | `loadMembership` | function | 307 |
| 8 | `selectCustomer` | const arrow | 329 |
| 9 | `applyCustomerOption` | const arrow | 377 |
| 10 | `clearCustomer` | const arrow | 391 |
| 11 | `handleAddCustomer` | const arrow | 399 |
| 12 | `selectDelivery` | const arrow | 415 |
| 13 | `clearDelivery` | const arrow | 420 |
| 14 | `handleAddDelivery` | const arrow | 422 |
| 15 | `filteredProducts` | const arrow | 463 |
| 16 | `qty` | const arrow | 492 |
| 17 | `addToCart` | const arrow | 600 |
| 18 | `updateQty` | const arrow | 626 |
| 19 | `updatePrice` | const arrow | 634 |
| 20 | `updateItemBranch` | const arrow | 646 |
| 21 | `handleDiscountUsd` | const arrow | 695 |
| 22 | `handleDiscountKhr` | const arrow | 696 |
| 23 | `handleMembershipUnits` | const arrow | 697 |
| 24 | `handleCheckout` | const arrow | 714 |

### 3.558 `frontend/src/components/pos/ProductImage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductImage` | export default function | 7 |

### 3.559 `frontend/src/components/pos/QuickAddModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `QuickAddModal` | function | 5 |
| 2 | `T` | const arrow | 6 |

### 3.560 `frontend/src/components/products/BranchStockAdjuster.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BranchStockAdjuster` | function | 6 |
| 2 | `setRow` | const arrow | 16 |
| 3 | `handleSave` | const arrow | 19 |

### 3.561 `frontend/src/components/products/BulkAddStockModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BulkAddStockModal` | function | 6 |
| 2 | `handleSave` | const arrow | 13 |

### 3.562 `frontend/src/components/products/BulkImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBaseName` | function | 12 |
| 2 | `parseCSVContent` | function | 19 |
| 3 | `getIncomingImageFilenames` | function | 39 |
| 4 | `getExistingImageFilenames` | function | 72 |
| 5 | `BulkImportModal` | export default function | 90 |
| 6 | `T` | const arrow | 105 |
| 7 | `resetCsvState` | const arrow | 107 |
| 8 | `pickImageDirectory` | const arrow | 116 |
| 9 | `addLibraryImages` | const arrow | 145 |
| 10 | `handleImageOnlyImport` | const arrow | 161 |
| 11 | `handlePickCSV` | const arrow | 183 |
| 12 | `handleImport` | const arrow | 256 |

### 3.563 `frontend/src/components/products/HeaderActions.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductsHeaderActions` | export default function | 4 |

### 3.564 `frontend/src/components/products/ManageBrandsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseBrandOptions` | function | 5 |
| 2 | `toTitleCase` | function | 18 |
| 3 | `ManageBrandsModal` | export default function | 26 |
| 4 | `saveLibrary` | const arrow | 59 |
| 5 | `addLibraryBrand` | const arrow | 70 |
| 6 | `renameBrand` | const arrow | 92 |
| 7 | `removeBrand` | const arrow | 138 |

### 3.565 `frontend/src/components/products/ManageCategoriesModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ManageCategoriesModal` | function | 7 |
| 2 | `load` | const arrow | 16 |
| 3 | `handleAdd` | const arrow | 20 |
| 4 | `handleUpdate` | const arrow | 29 |
| 5 | `handleDelete` | const arrow | 37 |

### 3.566 `frontend/src/components/products/ManageFieldsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ManageFieldsModal` | function | 6 |
| 2 | `load` | const arrow | 13 |
| 3 | `handleSave` | const arrow | 16 |

### 3.567 `frontend/src/components/products/ManageMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ManageMenu` | export default function | 5 |

### 3.568 `frontend/src/components/products/ManageUnitsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ManageUnitsModal` | function | 6 |
| 2 | `load` | const arrow | 11 |
| 3 | `handleAddUnit` | const arrow | 14 |

### 3.569 `frontend/src/components/products/primitives.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductImg` | function | 7 |
| 2 | `ProductImagePlaceholder` | function | 41 |
| 3 | `MarginCard` | function | 49 |
| 4 | `DualPriceInput` | function | 81 |
| 5 | `handleUsdChange` | const arrow | 82 |
| 6 | `handleKhrChange` | const arrow | 88 |

### 3.570 `frontend/src/components/products/ProductDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductDetailModal` | export default function | 4 |
| 2 | `T` | const arrow | 15 |
| 3 | `Row` | const arrow | 25 |

### 3.571 `frontend/src/components/products/ProductForm.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeGallery` | function | 7 |
| 2 | `pickImageFiles` | function | 23 |
| 3 | `parseCustomFieldOptions` | function | 41 |
| 4 | `ProductForm` | export default function | 52 |
| 5 | `setField` | function | 130 |
| 6 | `setCustomField` | function | 134 |
| 7 | `addImages` | function | 144 |
| 8 | `removeImage` | function | 167 |
| 9 | `setPrimaryImage` | function | 171 |
| 10 | `saveForm` | function | 181 |

### 3.572 `frontend/src/components/products/Products.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `multiMatch` | function | 23 |
| 2 | `ThreeDot` | function | 27 |
| 3 | `Products` | export default function | 33 |
| 4 | `handleSave` | const arrow | 82 |
| 5 | `normalizeGallery` | const arrow | 133 |
| 6 | `uploadGalleryImages` | const arrow | 149 |
| 7 | `handleSaveWithGallery` | const arrow | 171 |
| 8 | `handleBulkDelete` | const arrow | 203 |
| 9 | `handleBulkOutOfStock` | const arrow | 216 |
| 10 | `handleBulkChangeBranch` | const arrow | 232 |
| 11 | `handleBulkAddStock` | const arrow | 269 |
| 12 | `toggleSelect` | const arrow | 274 |
| 13 | `toggleSelectAll` | const arrow | 279 |
| 14 | `handleDelete` | const arrow | 283 |
| 15 | `resolveImageUrl` | const arrow | 307 |
| 16 | `getProductGallery` | const arrow | 318 |
| 17 | `openLightbox` | const arrow | 320 |
| 18 | `getBranchQty` | const arrow | 328 |
| 19 | `getStockBadge` | const arrow | 329 |
| 20 | `toImageName` | const arrow | 390 |
| 21 | `toImageUrl` | const arrow | 391 |

### 3.573 `frontend/src/components/products/VariantFormModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `VariantFormModal` | function | 8 |
| 2 | `set` | const arrow | 21 |
| 3 | `handleSave` | const arrow | 24 |

### 3.574 `frontend/src/components/receipt-settings/AllFieldsPanel.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Toggle` | function | 5 |
| 2 | `AllFieldsPanel` | export default function | 21 |
| 3 | `T` | const arrow | 23 |
| 4 | `toggleSection` | const arrow | 42 |

### 3.575 `frontend/src/components/receipt-settings/constants.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getFieldItems` | export function | 52 |
| 2 | `T` | const arrow | 53 |

### 3.576 `frontend/src/components/receipt-settings/ErrorBoundary.jsx`

- No top-level named symbols detected.

### 3.577 `frontend/src/components/receipt-settings/FieldOrderManager.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSectionOrderItems` | function | 4 |
| 2 | `buildList` | function | 23 |
| 3 | `toKeys` | function | 48 |
| 4 | `FieldOrderManager` | export default function | 52 |
| 5 | `moveItem` | const arrow | 66 |
| 6 | `addDivider` | const arrow | 74 |
| 7 | `removeDivider` | const arrow | 85 |
| 8 | `handleDragStart` | const arrow | 91 |
| 9 | `handleDragOver` | const arrow | 96 |

### 3.578 `frontend/src/components/receipt-settings/PrintSettings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Section` | function | 5 |
| 2 | `PrintSettings` | export default function | 17 |
| 3 | `T` | const arrow | 18 |
| 4 | `setValue` | const arrow | 27 |
| 5 | `resetMargins` | const arrow | 35 |

### 3.579 `frontend/src/components/receipt-settings/ReceiptPreview.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ReceiptPreview` | export default function | 3 |

### 3.580 `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Section` | function | 13 |
| 2 | `Toggle` | function | 24 |
| 3 | `parseTemplate` | function | 39 |
| 4 | `ReceiptSettings` | export default function | 44 |
| 5 | `handleSave` | const arrow | 113 |

### 3.581 `frontend/src/components/receipt/Receipt.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseTpl` | export function | 8 |
| 2 | `stripEmoji` | function | 16 |
| 3 | `displayAddress` | function | 21 |
| 4 | `parseItems` | function | 30 |
| 5 | `labelFor` | function | 95 |
| 6 | `Row` | function | 100 |
| 7 | `Receipt` | export default function | 112 |
| 8 | `em` | const arrow | 123 |
| 9 | `exportReceiptPdf` | const arrow | 319 |

### 3.582 `frontend/src/components/returns/EditReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `EditReturnModal` | function | 6 |
| 2 | `T` | const arrow | 8 |
| 3 | `updateQty` | const arrow | 33 |
| 4 | `updateRestock` | const arrow | 36 |
| 5 | `handleSubmit` | const arrow | 44 |

### 3.583 `frontend/src/components/returns/NewReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NewReturnModal` | function | 7 |
| 2 | `T` | const arrow | 9 |
| 3 | `handleSearch` | const arrow | 34 |
| 4 | `handleReturnTypeChange` | const arrow | 74 |
| 5 | `toggleIncluded` | const arrow | 79 |
| 6 | `updateItemQty` | const arrow | 87 |
| 7 | `updateItemRestock` | const arrow | 95 |
| 8 | `selectAll` | const arrow | 99 |
| 9 | `clearAll` | const arrow | 102 |
| 10 | `handleSubmit` | const arrow | 109 |

### 3.584 `frontend/src/components/returns/NewSupplierReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NewSupplierReturnModal` | export default function | 4 |
| 2 | `tr` | const arrow | 6 |
| 3 | `updateQty` | const arrow | 113 |
| 4 | `submit` | const arrow | 119 |

### 3.585 `frontend/src/components/returns/ReturnDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeScope` | function | 6 |
| 2 | `ReturnDetailModal` | export default function | 10 |
| 3 | `tr` | const arrow | 12 |

### 3.586 `frontend/src/components/returns/Returns.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeScope` | function | 14 |
| 2 | `Returns` | export default function | 18 |
| 3 | `tr` | const arrow | 30 |
| 4 | `handleOpenEdit` | const arrow | 58 |
| 5 | `renderAmount` | const arrow | 121 |

### 3.587 `frontend/src/components/sales/ExportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ExportModal` | export default function | 6 |
| 2 | `tr` | const arrow | 13 |
| 3 | `computeDates` | const arrow | 18 |
| 4 | `validateDates` | const arrow | 37 |
| 5 | `downloadCsvBlob` | const arrow | 45 |
| 6 | `buildCsvFallback` | const arrow | 55 |
| 7 | `escape` | const arrow | 59 |
| 8 | `handlePreview` | const arrow | 80 |
| 9 | `handleExportCSV` | const arrow | 93 |

### 3.588 `frontend/src/components/sales/SaleDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `InfoBlock` | function | 5 |
| 2 | `parseItems` | function | 21 |
| 3 | `SaleDetailModal` | export default function | 31 |
| 4 | `translateOr` | const arrow | 47 |
| 5 | `handleStatusUpdate` | const arrow | 69 |
| 6 | `handleMembershipAttach` | const arrow | 80 |

### 3.589 `frontend/src/components/sales/Sales.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `multiMatch` | function | 11 |
| 2 | `getSaleBranchLabel` | function | 15 |
| 3 | `Sales` | export default function | 23 |
| 4 | `handleStatusChange` | const arrow | 68 |
| 5 | `handleAttachMembership` | const arrow | 80 |

### 3.590 `frontend/src/components/sales/StatusBadge.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getStatusLabel` | export function | 23 |
| 2 | `StatusBadge` | export default function | 39 |

### 3.591 `frontend/src/components/server/ServerPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isAutoDetected` | function | 13 |
| 2 | `StatusRow` | function | 20 |
| 3 | `InfoTab` | function | 32 |
| 4 | `fmt` | const arrow | 83 |
| 5 | `DiagnosticsPanel` | function | 169 |
| 6 | `onErr` | const arrow | 181 |
| 7 | `ServerPage` | export default function | 314 |
| 8 | `check` | const arrow | 337 |
| 9 | `loadSecurityConfig` | const arrow | 359 |
| 10 | `handleTest` | function | 372 |
| 11 | `handleSave` | function | 394 |
| 12 | `handleDisconnect` | function | 401 |

### 3.592 `frontend/src/components/shared/ImageGalleryLightbox.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ImageGalleryLightbox` | export default function | 8 |
| 2 | `formatLabel` | function | 30 |
| 3 | `setIndex` | function | 34 |
| 4 | `renderGalleryImage` | function | 40 |
| 5 | `onKeyDown` | function | 47 |

### 3.593 `frontend/src/components/shared/Modal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Modal` | export default function | 10 |

### 3.594 `frontend/src/components/shared/navigationConfig.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseNavSetting` | export function | 23 |
| 2 | `orderNavItems` | export function | 32 |

### 3.595 `frontend/src/components/shared/PageHelpButton.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PageHelpButton` | export default function | 6 |

### 3.596 `frontend/src/components/shared/pageHelpContent.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getPageHelpContent` | export function | 442 |

### 3.597 `frontend/src/components/shared/PortalMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PortalMenu` | export default function | 11 |
| 2 | `closeIfClickedOutside` | const arrow | 48 |
| 3 | `closeMenu` | const arrow | 55 |
| 4 | `ThreeDotPortal` | export function | 124 |

### 3.598 `frontend/src/components/users/PermissionEditor.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PermissionEditor` | export default function | 15 |
| 2 | `translate` | const arrow | 16 |
| 3 | `labelFor` | const arrow | 22 |
| 4 | `toggle` | const arrow | 25 |

### 3.599 `frontend/src/components/users/UserDetailSheet.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `translateLabel` | function | 4 |
| 2 | `buildRowData` | function | 9 |
| 3 | `UserDetailSheet` | export default function | 21 |

### 3.600 `frontend/src/components/users/UserProfileModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `AvatarPreview` | function | 19 |
| 2 | `UserProfileModal` | export default function | 37 |
| 3 | `tr` | const arrow | 39 |
| 4 | `loadProfile` | const arrow | 82 |
| 5 | `handleProfileSave` | const arrow | 128 |
| 6 | `handlePasswordSave` | const arrow | 181 |
| 7 | `handleSessionSave` | const arrow | 210 |
| 8 | `refreshOtpState` | const arrow | 219 |
| 9 | `handleAvatarPick` | const arrow | 225 |
| 10 | `handleStartOauthLink` | const arrow | 227 |
| 11 | `handleDisconnectOauthProvider` | const arrow | 263 |
| 12 | `handleAvatarSelected` | const arrow | 303 |

### 3.601 `frontend/src/components/users/Users.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ThreeDot` | function | 22 |
| 2 | `formatContactValue` | function | 57 |
| 3 | `Users` | export default function | 62 |
| 4 | `tr` | const arrow | 65 |
| 5 | `canManageTargetUser` | const arrow | 89 |
| 6 | `load` | const arrow | 95 |
| 7 | `openCreateUser` | const arrow | 127 |
| 8 | `openEditUser` | const arrow | 134 |
| 9 | `openCreateRole` | const arrow | 151 |
| 10 | `openEditRole` | const arrow | 158 |
| 11 | `getRolePermissions` | const arrow | 169 |
| 12 | `getPermissionSummary` | const arrow | 178 |
| 13 | `handleSaveUser` | const arrow | 196 |
| 14 | `handleResetPassword` | const arrow | 245 |
| 15 | `handleSaveRole` | const arrow | 274 |
| 16 | `handleDeleteRole` | const arrow | 309 |

### 3.602 `frontend/src/components/utils-settings/AuditLog.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toIso` | function | 32 |
| 2 | `formatDateTime` | function | 38 |
| 3 | `formatLogTime` | function | 56 |
| 4 | `formatJsonPretty` | function | 60 |
| 5 | `parseLogJson` | function | 68 |
| 6 | `formatEntityName` | function | 76 |
| 7 | `extractReference` | function | 82 |
| 8 | `readableSummary` | function | 97 |
| 9 | `recordIdentifier` | function | 111 |
| 10 | `DetailRow` | function | 118 |
| 11 | `AuditLog` | export default function | 130 |

### 3.603 `frontend/src/components/utils-settings/Backup.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PathActionButton` | function | 30 |
| 2 | `PrimaryActionButton` | function | 42 |
| 3 | `useCopy` | function | 54 |
| 4 | `buildPathCrumbs` | function | 61 |
| 5 | `buildFinalDataFolderPath` | function | 79 |
| 6 | `formatDateTime` | function | 92 |
| 7 | `formatBytes` | function | 107 |
| 8 | `countBackupRows` | function | 116 |
| 9 | `buildBackupPreview` | function | 126 |
| 10 | `SectionChip` | function | 164 |
| 11 | `FolderBrowserPanel` | function | 179 |
| 12 | `DataFolderLocation` | function | 292 |
| 13 | `load` | const arrow | 302 |
| 14 | `openBrowser` | const arrow | 326 |
| 15 | `openDriveBrowser` | const arrow | 338 |
| 16 | `pickFolderNatively` | const arrow | 342 |
| 17 | `openInlinePicker` | const arrow | 369 |
| 18 | `openInExplorer` | const arrow | 377 |
| 19 | `selectDir` | const arrow | 392 |
| 20 | `handleApply` | const arrow | 398 |
| 21 | `handleReset` | const arrow | 419 |
| 22 | `GoogleDriveSyncSection` | function | 534 |
| 23 | `load` | const arrow | 547 |
| 24 | `handler` | const arrow | 568 |
| 25 | `savePreferences` | const arrow | 584 |
| 26 | `connectGoogleDrive` | const arrow | 603 |
| 27 | `syncNow` | const arrow | 637 |
| 28 | `disconnect` | const arrow | 654 |
| 29 | `Backup` | export default function | 792 |
| 30 | `browseServerFolders` | const arrow | 816 |
| 31 | `toggleServerBrowser` | const arrow | 829 |
| 32 | `handleExport` | const arrow | 840 |
| 33 | `pickFolder` | const arrow | 853 |
| 34 | `handleFolderExport` | const arrow | 866 |
| 35 | `handleFolderImport` | const arrow | 884 |
| 36 | `handleChooseImportFile` | const arrow | 905 |
| 37 | `handleConfirmImport` | const arrow | 921 |

### 3.604 `frontend/src/components/utils-settings/FontFamilyPicker.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `FontFamilyPicker` | function | 20 |

### 3.605 `frontend/src/components/utils-settings/index.js`

- No top-level named symbols detected.

### 3.606 `frontend/src/components/utils-settings/OtpModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `OtpModal` | function | 7 |
| 2 | `handleConfirm` | const arrow | 28 |
| 3 | `handleDisable` | const arrow | 39 |

### 3.607 `frontend/src/components/utils-settings/ResetData.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ConfirmReset` | function | 6 |
| 2 | `T` | const arrow | 19 |
| 3 | `ResetData` | function | 87 |
| 4 | `T` | const arrow | 89 |
| 5 | `doReset` | const arrow | 116 |
| 6 | `FactoryReset` | function | 174 |
| 7 | `T` | const arrow | 176 |
| 8 | `doFactoryReset` | function | 182 |

### 3.608 `frontend/src/components/utils-settings/Settings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseStoredColors` | function | 91 |
| 2 | `buildColorChoices` | function | 102 |
| 3 | `useCopy` | function | 193 |
| 4 | `getSettingsNavLabel` | function | 201 |
| 5 | `SwatchPicker` | function | 218 |
| 6 | `Settings` | export default function | 301 |
| 7 | `setValue` | const arrow | 405 |
| 8 | `formatPreviewDateTime` | const arrow | 424 |
| 9 | `moveNavItem` | const arrow | 440 |
| 10 | `toggleMobilePinned` | const arrow | 450 |
| 11 | `movePinnedItem` | const arrow | 462 |
| 12 | `movePinnedBefore` | const arrow | 472 |
| 13 | `resetNavigationLayout` | const arrow | 484 |
| 14 | `field` | const arrow | 489 |
| 15 | `savePaymentMethods` | const arrow | 511 |
| 16 | `uploadImageSetting` | const arrow | 516 |

### 3.609 `frontend/src/constants.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createEmptyOrder` | export function | 120 |
| 2 | `formatDate` | export function | 150 |
| 3 | `isNetworkError` | export function | 170 |

### 3.610 `frontend/src/index.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isIgnoredRuntimeMessage` | const arrow | 17 |
| 2 | `safeInsertRule` | const function | 25 |
| 3 | `safeCssRulesGetter` | const function | 42 |
| 4 | `stopKnownStartupNoise` | const arrow | 58 |

### 3.611 `frontend/src/utils/appRefresh.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `refreshAppData` | export function | 18 |

### 3.612 `frontend/src/utils/csv.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `downloadCSV` | export function | 10 |

### 3.613 `frontend/src/utils/dateHelpers.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `todayStr` | export function | 10 |
| 2 | `offsetDate` | export function | 20 |

### 3.614 `frontend/src/utils/deviceInfo.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getClientDeviceInfo` | export function | 1 |
| 2 | `getClientMetaHeaders` | export function | 24 |

### 3.615 `frontend/src/utils/favicon.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `clamp` | function | 1 |
| 2 | `loadImage` | function | 5 |
| 3 | `createCircularFaviconDataUrl` | export function | 19 |

### 3.616 `frontend/src/utils/firebasePhoneAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `disabled` | function | 6 |
| 2 | `requestFirebasePhoneCode` | export function | 10 |
| 3 | `confirmFirebasePhoneCode` | export function | 14 |
| 4 | `cleanupFirebasePhoneVerification` | export function | 18 |

### 3.617 `frontend/src/utils/formatters.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fmtTime` | export function | 9 |
| 2 | `fmtDate` | export function | 25 |
| 3 | `fmtShort` | export function | 39 |
| 4 | `fmtCount` | export function | 51 |

### 3.618 `frontend/src/utils/index.js`

- No top-level named symbols detected.

### 3.619 `frontend/src/utils/printReceipt.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cloneWithInlineStyles` | function | 80 |
| 2 | `mmToPt` | function | 103 |
| 3 | `dataUrlToBytes` | function | 107 |
| 4 | `joinPdfChunks` | function | 117 |
| 5 | `buildPdfStream` | function | 128 |
| 6 | `buildSingleImagePdf` | function | 137 |
| 7 | `escapePdfText` | function | 175 |
| 8 | `wrapTextLine` | function | 182 |
| 9 | `buildTextOnlyPdf` | function | 201 |
| 10 | `buildReceiptFileName` | function | 254 |
| 11 | `waitForElementAssets` | function | 264 |
| 12 | `renderElementToCanvas` | function | 293 |
| 13 | `withReceiptElement` | function | 344 |
| 14 | `downloadBlob` | function | 367 |
| 15 | `getPrintSettings` | export function | 378 |
| 16 | `savePrintSettings` | export function | 386 |
| 17 | `getPaperWidthMm` | export function | 392 |
| 18 | `createReceiptPdfBlob` | export function | 402 |
| 19 | `downloadReceiptPdf` | export function | 434 |
| 20 | `openReceiptPdf` | export function | 441 |
| 21 | `printReceipt` | export function | 454 |

### 3.620 `frontend/src/web-api.js`

- No top-level named symbols detected.

### 3.621 `frontend/tailwind.config.js`

- No top-level named symbols detected.

### 3.622 `frontend/tests/appShellUtils.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.623 `frontend/tests/portalEditorUtils.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |

### 3.624 `frontend/vite.config.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fixCrossorigin` | function | 29 |
| 2 | `manualChunks` | function | 54 |

### 3.625 `ops/scripts/backend/verify-data-integrity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fail` | function | 20 |
| 2 | `pass` | function | 25 |
| 3 | `approxEqual` | function | 29 |
| 4 | `checkNoNegativeStock` | function | 36 |
| 5 | `checkProductStockMatchesBranches` | function | 45 |
| 6 | `checkSaleItemTotals` | function | 94 |
| 7 | `checkReturnDoesNotExceedSold` | function | 104 |
| 8 | `checkProfitFormulaConsistency` | function | 130 |
| 9 | `checkCogsSnapshotVsCurrentProductCost` | function | 166 |
| 10 | `run` | function | 190 |

### 3.626 `ops/scripts/frontend/verify-i18n.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `collectUsedKeys` | function | 29 |
| 2 | `listMissing` | function | 69 |
| 3 | `listEmptyValues` | function | 74 |
| 4 | `printList` | function | 81 |
| 5 | `main` | function | 88 |

### 3.627 `ops/scripts/generate-doc-reference.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ensureDir` | function | 17 |
| 2 | `normalizePath` | function | 21 |
| 3 | `getFilesRecursive` | function | 25 |
| 4 | `getRootCodeFiles` | function | 45 |
| 5 | `findSymbols` | function | 54 |
| 6 | `findRouteHandlers` | function | 83 |
| 7 | `collectScriptMetadata` | function | 99 |
| 8 | `markdownHeader` | function | 122 |
| 9 | `markdownSection` | function | 126 |
| 10 | `writeBackendReference` | function | 130 |
| 11 | `writeFrontendReference` | function | 185 |
| 12 | `readJsonObject` | function | 228 |
| 13 | `groupByPrefix` | function | 234 |
| 14 | `writeTranslationReference` | function | 243 |
| 15 | `writeRunReleaseReference` | function | 299 |
| 16 | `writeModuleNamingGuide` | function | 364 |
| 17 | `writeProjectCodeReference` | function | 412 |
| 18 | `main` | function | 453 |

### 3.628 `ops/scripts/generate-full-project-docs.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ensureDir` | function | 49 |
| 2 | `toPosix` | function | 53 |
| 3 | `rel` | function | 57 |
| 4 | `shouldSkipDir` | function | 61 |
| 5 | `collectFilesAndFolders` | function | 65 |
| 6 | `getAllProjectFilesAndFolders` | function | 86 |
| 7 | `isProbablyText` | function | 109 |
| 8 | `readText` | function | 122 |
| 9 | `lineCount` | function | 130 |
| 10 | `fileCategory` | function | 135 |
| 11 | `inferPurpose` | function | 155 |
| 12 | `markdownHeader` | function | 180 |
| 13 | `markdownSection` | function | 184 |
| 14 | `extractImportsExports` | function | 188 |
| 15 | `findSymbols` | function | 228 |
| 16 | `writeAllFunctionReference` | function | 254 |
| 17 | `resolveInternalImport` | function | 292 |
| 18 | `writeAllFileInventory` | function | 317 |
| 19 | `folderPurpose` | function | 339 |
| 20 | `writeFolderCoverage` | function | 354 |
| 21 | `writeImportExportReference` | function | 413 |
| 22 | `readJsonObject` | function | 487 |
| 23 | `translationSectionForKey` | function | 495 |
| 24 | `writeTranslationSectionReference` | function | 546 |
| 25 | `writeMainCoverageSummary` | function | 595 |
| 26 | `main` | function | 624 |

### 3.629 `ops/scripts/lib/fs-utils.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toPosix` | function | 16 |
| 2 | `resolveProjectRoot` | function | 20 |
| 3 | `relFrom` | function | 35 |
| 4 | `readUtf8` | function | 42 |
| 5 | `readJson` | function | 50 |
| 6 | `lineCount` | function | 58 |
| 7 | `walkFilesRecursive` | function | 66 |
| 8 | `collectRootFiles` | function | 93 |

### 3.630 `ops/scripts/performance-scan.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `kb` | function | 44 |
| 2 | `topN` | function | 49 |
| 3 | `main` | function | 57 |

