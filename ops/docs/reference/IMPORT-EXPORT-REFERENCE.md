# Import / Export Reference

Auto-generated import/export and dependency-link coverage for frontend/backend code files.

## 1. Coverage Summary

Code files documented: **147**

## 2. Dependency Matrix

| No. | File | Imports | Exports | Internal deps | Referenced by |
|---:|---|---:|---:|---:|---:|
| 1 | `backend/server.js` | 29 | 0 | 23 | 0 |
| 2 | `backend/src/backupSchema.js` | 0 | 1 | 0 | 2 |
| 3 | `backend/src/config.js` | 3 | 1 | 0 | 8 |
| 4 | `backend/src/database.js` | 5 | 1 | 1 | 20 |
| 5 | `backend/src/dataPath.js` | 2 | 1 | 0 | 2 |
| 6 | `backend/src/fileAssets.js` | 5 | 1 | 2 | 4 |
| 7 | `backend/src/helpers.js` | 2 | 1 | 2 | 19 |
| 8 | `backend/src/middleware.js` | 7 | 1 | 3 | 16 |
| 9 | `backend/src/portalUtils.js` | 0 | 1 | 0 | 2 |
| 10 | `backend/src/requestContext.js` | 1 | 1 | 0 | 2 |
| 11 | `backend/src/routes/auth.js` | 10 | 1 | 6 | 1 |
| 12 | `backend/src/routes/branches.js` | 4 | 1 | 3 | 1 |
| 13 | `backend/src/routes/catalog.js` | 3 | 1 | 2 | 1 |
| 14 | `backend/src/routes/categories.js` | 4 | 1 | 3 | 1 |
| 15 | `backend/src/routes/contacts.js` | 4 | 1 | 3 | 1 |
| 16 | `backend/src/routes/customTables.js` | 4 | 1 | 3 | 1 |
| 17 | `backend/src/routes/files.js` | 4 | 1 | 3 | 1 |
| 18 | `backend/src/routes/inventory.js` | 4 | 1 | 3 | 1 |
| 19 | `backend/src/routes/portal.js` | 5 | 1 | 4 | 1 |
| 20 | `backend/src/routes/products.js` | 8 | 1 | 5 | 1 |
| 21 | `backend/src/routes/returns.js` | 4 | 1 | 3 | 1 |
| 22 | `backend/src/routes/sales.js` | 4 | 1 | 3 | 1 |
| 23 | `backend/src/routes/settings.js` | 4 | 1 | 3 | 1 |
| 24 | `backend/src/routes/system.js` | 13 | 1 | 7 | 1 |
| 25 | `backend/src/routes/units.js` | 4 | 1 | 3 | 1 |
| 26 | `backend/src/routes/users.js` | 9 | 1 | 7 | 1 |
| 27 | `backend/src/security.js` | 1 | 1 | 0 | 5 |
| 28 | `backend/src/serverUtils.js` | 0 | 1 | 0 | 2 |
| 29 | `backend/src/services/firebaseAuth.js` | 2 | 1 | 0 | 2 |
| 30 | `backend/src/services/verification.js` | 2 | 1 | 1 | 2 |
| 31 | `backend/src/websocket.js` | 5 | 1 | 3 | 1 |
| 32 | `backend/test/backupRoundtrip.test.js` | 6 | 0 | 0 | 0 |
| 33 | `backend/test/backupSchema.test.js` | 2 | 0 | 1 | 0 |
| 34 | `backend/test/dataPath.test.js` | 5 | 0 | 1 | 0 |
| 35 | `backend/test/portalUtils.test.js` | 2 | 0 | 1 | 0 |
| 36 | `backend/test/serverUtils.test.js` | 2 | 0 | 1 | 0 |
| 37 | `frontend/postcss.config.js` | 0 | 1 | 0 | 0 |
| 38 | `frontend/src/api/http.js` | 2 | 16 | 2 | 5 |
| 39 | `frontend/src/api/localDb.js` | 1 | 5 | 0 | 2 |
| 40 | `frontend/src/api/methods.js` | 4 | 122 | 4 | 1 |
| 41 | `frontend/src/api/websocket.js` | 2 | 3 | 2 | 2 |
| 42 | `frontend/src/App.jsx` | 23 | 1 | 22 | 1 |
| 43 | `frontend/src/app/appShellUtils.mjs` | 0 | 5 | 0 | 2 |
| 44 | `frontend/src/AppContext.jsx` | 8 | 5 | 7 | 44 |
| 45 | `frontend/src/components/auth/Login.jsx` | 4 | 1 | 3 | 1 |
| 46 | `frontend/src/components/branches/Branches.jsx` | 5 | 1 | 4 | 1 |
| 47 | `frontend/src/components/branches/BranchForm.jsx` | 2 | 1 | 1 | 1 |
| 48 | `frontend/src/components/branches/TransferModal.jsx` | 2 | 1 | 1 | 1 |
| 49 | `frontend/src/components/catalog/CatalogPage.jsx` | 5 | 1 | 4 | 1 |
| 50 | `frontend/src/components/catalog/portalEditorUtils.mjs` | 0 | 6 | 0 | 0 |
| 51 | `frontend/src/components/contacts/Contacts.jsx` | 9 | 1 | 7 | 1 |
| 52 | `frontend/src/components/contacts/CustomersTab.jsx` | 6 | 2 | 5 | 2 |
| 53 | `frontend/src/components/contacts/DeliveryTab.jsx` | 6 | 2 | 5 | 1 |
| 54 | `frontend/src/components/contacts/shared.jsx` | 4 | 5 | 3 | 4 |
| 55 | `frontend/src/components/contacts/SuppliersTab.jsx` | 6 | 0 | 5 | 1 |
| 56 | `frontend/src/components/custom-tables/CustomTables.jsx` | 2 | 1 | 1 | 0 |
| 57 | `frontend/src/components/dashboard/charts/BarChart.jsx` | 3 | 1 | 2 | 0 |
| 58 | `frontend/src/components/dashboard/charts/DonutChart.jsx` | 3 | 1 | 2 | 0 |
| 59 | `frontend/src/components/dashboard/charts/index.js` | 0 | 0 | 0 | 1 |
| 60 | `frontend/src/components/dashboard/charts/LineChart.jsx` | 3 | 1 | 2 | 0 |
| 61 | `frontend/src/components/dashboard/charts/NoData.jsx` | 1 | 1 | 1 | 3 |
| 62 | `frontend/src/components/dashboard/Dashboard.jsx` | 8 | 1 | 7 | 1 |
| 63 | `frontend/src/components/dashboard/MiniStat.jsx` | 0 | 1 | 0 | 1 |
| 64 | `frontend/src/components/files/FilePickerModal.jsx` | 3 | 1 | 2 | 5 |
| 65 | `frontend/src/components/files/FilesPage.jsx` | 2 | 1 | 1 | 1 |
| 66 | `frontend/src/components/inventory/DualMoney.jsx` | 0 | 1 | 0 | 2 |
| 67 | `frontend/src/components/inventory/Inventory.jsx` | 8 | 1 | 6 | 1 |
| 68 | `frontend/src/components/inventory/movementGroups.js` | 0 | 2 | 0 | 1 |
| 69 | `frontend/src/components/inventory/ProductDetailModal.jsx` | 1 | 1 | 1 | 1 |
| 70 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | 3 | 1 | 1 | 1 |
| 71 | `frontend/src/components/navigation/Sidebar.jsx` | 4 | 1 | 3 | 1 |
| 72 | `frontend/src/components/pos/CartItem.jsx` | 1 | 1 | 1 | 1 |
| 73 | `frontend/src/components/pos/FilterPanel.jsx` | 1 | 1 | 0 | 1 |
| 74 | `frontend/src/components/pos/POS.jsx` | 12 | 1 | 10 | 1 |
| 75 | `frontend/src/components/pos/ProductImage.jsx` | 1 | 1 | 0 | 2 |
| 76 | `frontend/src/components/pos/QuickAddModal.jsx` | 0 | 1 | 0 | 1 |
| 77 | `frontend/src/components/products/BranchStockAdjuster.jsx` | 1 | 1 | 0 | 1 |
| 78 | `frontend/src/components/products/BulkAddStockModal.jsx` | 2 | 1 | 1 | 1 |
| 79 | `frontend/src/components/products/BulkImportModal.jsx` | 4 | 1 | 3 | 1 |
| 80 | `frontend/src/components/products/HeaderActions.jsx` | 1 | 1 | 1 | 1 |
| 81 | `frontend/src/components/products/ManageBrandsModal.jsx` | 3 | 1 | 2 | 1 |
| 82 | `frontend/src/components/products/ManageCategoriesModal.jsx` | 3 | 1 | 2 | 1 |
| 83 | `frontend/src/components/products/ManageFieldsModal.jsx` | 2 | 1 | 1 | 1 |
| 84 | `frontend/src/components/products/ManageMenu.jsx` | 1 | 1 | 1 | 0 |
| 85 | `frontend/src/components/products/ManageUnitsModal.jsx` | 2 | 1 | 1 | 1 |
| 86 | `frontend/src/components/products/primitives.jsx` | 2 | 0 | 0 | 5 |
| 87 | `frontend/src/components/products/ProductDetailModal.jsx` | 2 | 1 | 1 | 1 |
| 88 | `frontend/src/components/products/ProductForm.jsx` | 5 | 1 | 4 | 1 |
| 89 | `frontend/src/components/products/Products.jsx` | 17 | 1 | 16 | 1 |
| 90 | `frontend/src/components/products/VariantFormModal.jsx` | 4 | 1 | 3 | 1 |
| 91 | `frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | 3 | 1 | 2 | 1 |
| 92 | `frontend/src/components/receipt-settings/constants.js` | 0 | 3 | 0 | 3 |
| 93 | `frontend/src/components/receipt-settings/ErrorBoundary.jsx` | 1 | 1 | 0 | 1 |
| 94 | `frontend/src/components/receipt-settings/FieldOrderManager.jsx` | 2 | 1 | 0 | 1 |
| 95 | `frontend/src/components/receipt-settings/PrintSettings.jsx` | 3 | 1 | 1 | 1 |
| 96 | `frontend/src/components/receipt-settings/ReceiptPreview.jsx` | 2 | 1 | 1 | 1 |
| 97 | `frontend/src/components/receipt-settings/ReceiptSettings.jsx` | 9 | 1 | 7 | 1 |
| 98 | `frontend/src/components/receipt/Receipt.jsx` | 6 | 2 | 4 | 3 |
| 99 | `frontend/src/components/returns/EditReturnModal.jsx` | 2 | 1 | 1 | 1 |
| 100 | `frontend/src/components/returns/NewReturnModal.jsx` | 3 | 1 | 2 | 1 |
| 101 | `frontend/src/components/returns/NewSupplierReturnModal.jsx` | 2 | 1 | 1 | 1 |
| 102 | `frontend/src/components/returns/ReturnDetailModal.jsx` | 2 | 1 | 2 | 1 |
| 103 | `frontend/src/components/returns/Returns.jsx` | 8 | 1 | 7 | 1 |
| 104 | `frontend/src/components/sales/ExportModal.jsx` | 2 | 1 | 1 | 1 |
| 105 | `frontend/src/components/sales/SaleDetailModal.jsx` | 3 | 1 | 2 | 1 |
| 106 | `frontend/src/components/sales/Sales.jsx` | 8 | 1 | 7 | 1 |
| 107 | `frontend/src/components/sales/StatusBadge.jsx` | 0 | 5 | 0 | 5 |
| 108 | `frontend/src/components/server/ServerPage.jsx` | 2 | 1 | 1 | 1 |
| 109 | `frontend/src/components/shared/ImageGalleryLightbox.jsx` | 2 | 1 | 0 | 3 |
| 110 | `frontend/src/components/shared/Modal.jsx` | 0 | 1 | 0 | 18 |
| 111 | `frontend/src/components/shared/navigationConfig.js` | 0 | 4 | 0 | 2 |
| 112 | `frontend/src/components/shared/PageHelpButton.jsx` | 4 | 1 | 2 | 1 |
| 113 | `frontend/src/components/shared/pageHelpContent.js` | 0 | 2 | 0 | 1 |
| 114 | `frontend/src/components/shared/PortalMenu.jsx` | 3 | 2 | 0 | 5 |
| 115 | `frontend/src/components/users/PermissionEditor.jsx` | 0 | 2 | 0 | 2 |
| 116 | `frontend/src/components/users/UserDetailSheet.jsx` | 2 | 1 | 2 | 1 |
| 117 | `frontend/src/components/users/UserProfileModal.jsx` | 6 | 1 | 5 | 2 |
| 118 | `frontend/src/components/users/Users.jsx` | 8 | 1 | 7 | 1 |
| 119 | `frontend/src/components/utils-settings/AuditLog.jsx` | 4 | 1 | 2 | 1 |
| 120 | `frontend/src/components/utils-settings/Backup.jsx` | 6 | 1 | 4 | 1 |
| 121 | `frontend/src/components/utils-settings/FontFamilyPicker.jsx` | 1 | 1 | 0 | 1 |
| 122 | `frontend/src/components/utils-settings/index.js` | 0 | 0 | 0 | 0 |
| 123 | `frontend/src/components/utils-settings/OtpModal.jsx` | 2 | 1 | 1 | 2 |
| 124 | `frontend/src/components/utils-settings/ResetData.jsx` | 4 | 0 | 2 | 1 |
| 125 | `frontend/src/components/utils-settings/Settings.jsx` | 6 | 1 | 4 | 1 |
| 126 | `frontend/src/constants.js` | 0 | 12 | 0 | 6 |
| 127 | `frontend/src/index.jsx` | 5 | 0 | 3 | 0 |
| 128 | `frontend/src/utils/appRefresh.js` | 0 | 1 | 0 | 2 |
| 129 | `frontend/src/utils/csv.js` | 0 | 1 | 0 | 9 |
| 130 | `frontend/src/utils/dateHelpers.js` | 0 | 2 | 0 | 1 |
| 131 | `frontend/src/utils/deviceInfo.js` | 0 | 2 | 0 | 6 |
| 132 | `frontend/src/utils/firebasePhoneAuth.js` | 0 | 3 | 0 | 0 |
| 133 | `frontend/src/utils/formatters.js` | 0 | 4 | 0 | 15 |
| 134 | `frontend/src/utils/index.js` | 0 | 0 | 0 | 0 |
| 135 | `frontend/src/utils/printReceipt.js` | 0 | 8 | 0 | 2 |
| 136 | `frontend/src/web-api.js` | 4 | 0 | 4 | 1 |
| 137 | `frontend/tailwind.config.js` | 0 | 1 | 0 | 0 |
| 138 | `frontend/tests/appShellUtils.test.mjs` | 2 | 0 | 1 | 0 |
| 139 | `frontend/tests/portalEditorUtils.test.mjs` | 1 | 0 | 0 | 0 |
| 140 | `frontend/vite.config.mjs` | 2 | 1 | 0 | 1 |
| 141 | `ops/scripts/backend/verify-data-integrity.js` | 4 | 0 | 3 | 0 |
| 142 | `ops/scripts/frontend/verify-i18n.js` | 2 | 0 | 1 | 0 |
| 143 | `ops/scripts/generate-doc-reference.js` | 3 | 0 | 1 | 0 |
| 144 | `ops/scripts/generate-full-project-docs.js` | 3 | 1 | 1 | 0 |
| 145 | `ops/scripts/lib/fs-utils.js` | 2 | 1 | 0 | 4 |
| 146 | `ops/scripts/performance-scan.js` | 3 | 0 | 1 | 0 |
| 147 | `temp-vite-build.mjs` | 4 | 0 | 1 | 0 |

## 3. Detailed File Dependency Commentary

### 3.1 `backend/server.js`

- Declared exports: none detected
- Imports (29)
  - `./src/config`
  - `./src/database`
  - `./src/helpers`
  - `./src/middleware`
  - `./src/requestContext`
  - `./src/routes/auth`
  - `./src/routes/branches`
  - `./src/routes/catalog`
  - `./src/routes/categories`
  - `./src/routes/contacts`
  - `./src/routes/customTables`
  - `./src/routes/files`
  - `./src/routes/inventory`
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
- Internal dependencies (23)
  - `backend/src/config.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/requestContext.js`
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
  - `backend/src/serverUtils.js`
  - `backend/src/websocket.js`
- Referenced by (0)
  - none

### 3.2 `backend/src/backupSchema.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/routes/system.js`
  - `backend/test/backupSchema.test.js`

### 3.3 `backend/src/config.js`

- Declared exports: `module.exports`
- Imports (3)
  - `dotenv`
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (8)
  - `backend/server.js`
  - `backend/src/database.js`
  - `backend/src/fileAssets.js`
  - `backend/src/middleware.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/system.js`
  - `backend/src/websocket.js`
  - `ops/scripts/backend/verify-data-integrity.js`

### 3.4 `backend/src/database.js`

- Declared exports: `module.exports`
- Imports (5)
  - `./config`
  - `bcryptjs`
  - `better-sqlite3`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `backend/src/config.js`
- Referenced by (20)
  - `backend/server.js`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
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
  - `backend/src/services/verification.js`
  - `ops/scripts/backend/verify-data-integrity.js`

### 3.5 `backend/src/dataPath.js`

- Declared exports: `module.exports`
- Imports (2)
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/routes/system.js`
  - `backend/test/dataPath.test.js`

### 3.6 `backend/src/fileAssets.js`

- Declared exports: `module.exports`
- Imports (5)
  - `./config`
  - `./database`
  - `fs`
  - `path`
  - `sharp`
- Internal dependencies (2)
  - `backend/src/config.js`
  - `backend/src/database.js`
- Referenced by (4)
  - `backend/src/middleware.js`
  - `backend/src/routes/files.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/users.js`

### 3.7 `backend/src/helpers.js`

- Declared exports: `module.exports`
- Imports (2)
  - `./database`
  - `./requestContext`
- Internal dependencies (2)
  - `backend/src/database.js`
  - `backend/src/requestContext.js`
- Referenced by (19)
  - `backend/server.js`
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

### 3.8 `backend/src/middleware.js`

- Declared exports: `module.exports`
- Imports (7)
  - `./config`
  - `./fileAssets`
  - `./security`
  - `fs`
  - `multer`
  - `path`
  - `sharp`
- Internal dependencies (3)
  - `backend/src/config.js`
  - `backend/src/fileAssets.js`
  - `backend/src/security.js`
- Referenced by (16)
  - `backend/server.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/branches.js`
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

### 3.9 `backend/src/portalUtils.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/routes/portal.js`
  - `backend/test/portalUtils.test.js`

### 3.10 `backend/src/requestContext.js`

- Declared exports: `module.exports`
- Imports (1)
  - `async_hooks`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/server.js`
  - `backend/src/helpers.js`

### 3.11 `backend/src/routes/auth.js`

- Declared exports: `module.exports`
- Imports (10)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `../security`
  - `../services/firebaseAuth`
  - `../services/verification`
  - `bcryptjs`
  - `express`
  - `qrcode`
  - `speakeasy`
- Internal dependencies (6)
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/security.js`
  - `backend/src/services/firebaseAuth.js`
  - `backend/src/services/verification.js`
- Referenced by (1)
  - `backend/server.js`

### 3.12 `backend/src/routes/branches.js`

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

### 3.13 `backend/src/routes/catalog.js`

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

### 3.14 `backend/src/routes/categories.js`

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

### 3.15 `backend/src/routes/contacts.js`

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

### 3.16 `backend/src/routes/customTables.js`

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

### 3.17 `backend/src/routes/files.js`

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

### 3.18 `backend/src/routes/inventory.js`

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

### 3.19 `backend/src/routes/portal.js`

- Declared exports: `module.exports`
- Imports (5)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `../portalUtils`
  - `express`
- Internal dependencies (4)
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/portalUtils.js`
- Referenced by (1)
  - `backend/server.js`

### 3.20 `backend/src/routes/products.js`

- Declared exports: `module.exports`
- Imports (8)
  - `../config`
  - `../database`
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `express`
  - `fs`
  - `path`
- Internal dependencies (5)
  - `backend/src/config.js`
  - `backend/src/database.js`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
- Referenced by (1)
  - `backend/server.js`

### 3.21 `backend/src/routes/returns.js`

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

### 3.22 `backend/src/routes/sales.js`

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

### 3.23 `backend/src/routes/settings.js`

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

### 3.24 `backend/src/routes/system.js`

- Declared exports: `module.exports`
- Imports (13)
  - `../backupSchema`
  - `../config`
  - `../dataPath`
  - `../database`
  - `../helpers`
  - `../middleware`
  - `../security`
  - `bcryptjs`
  - `better-sqlite3`
  - `child_process`
  - `express`
  - `fs`
  - `path`
- Internal dependencies (7)
  - `backend/src/backupSchema.js`
  - `backend/src/config.js`
  - `backend/src/dataPath.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/security.js`
- Referenced by (1)
  - `backend/server.js`

### 3.25 `backend/src/routes/units.js`

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

### 3.26 `backend/src/routes/users.js`

- Declared exports: `module.exports`
- Imports (9)
  - `../database`
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `../security`
  - `../services/firebaseAuth`
  - `../services/verification`
  - `bcryptjs`
  - `express`
- Internal dependencies (7)
  - `backend/src/database.js`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/security.js`
  - `backend/src/services/firebaseAuth.js`
  - `backend/src/services/verification.js`
- Referenced by (1)
  - `backend/server.js`

### 3.27 `backend/src/security.js`

- Declared exports: `module.exports`
- Imports (1)
  - `crypto`
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `backend/src/middleware.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/system.js`
  - `backend/src/routes/users.js`
  - `backend/src/websocket.js`

### 3.28 `backend/src/serverUtils.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/server.js`
  - `backend/test/serverUtils.test.js`

### 3.29 `backend/src/services/firebaseAuth.js`

- Declared exports: `module.exports`
- Imports (2)
  - `crypto`
  - `fs`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/routes/auth.js`
  - `backend/src/routes/users.js`

### 3.30 `backend/src/services/verification.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../database`
  - `crypto`
- Internal dependencies (1)
  - `backend/src/database.js`
- Referenced by (2)
  - `backend/src/routes/auth.js`
  - `backend/src/routes/users.js`

### 3.31 `backend/src/websocket.js`

- Declared exports: `module.exports`
- Imports (5)
  - `./config`
  - `./helpers`
  - `./security`
  - `http`
  - `ws`
- Internal dependencies (3)
  - `backend/src/config.js`
  - `backend/src/helpers.js`
  - `backend/src/security.js`
- Referenced by (1)
  - `backend/server.js`

### 3.32 `backend/test/backupRoundtrip.test.js`

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

### 3.33 `backend/test/backupSchema.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/backupSchema`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/backupSchema.js`
- Referenced by (0)
  - none

### 3.34 `backend/test/dataPath.test.js`

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

### 3.35 `backend/test/portalUtils.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/portalUtils`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/portalUtils.js`
- Referenced by (0)
  - none

### 3.36 `backend/test/serverUtils.test.js`

- Declared exports: none detected
- Imports (2)
  - `../src/serverUtils`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/serverUtils.js`
- Referenced by (0)
  - none

### 3.37 `frontend/postcss.config.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.38 `frontend/src/api/http.js`

- Declared exports: `apiFetch`, `cacheClearAll`, `cacheGet`, `cacheGetStale`, `cacheInvalidate`, `cacheSet`, `clearCallLog`, `getCallLog`, `getSyncServerUrl`, `getSyncToken`, `isNetErr`, `isServerOnline`, `route`, `setSyncServerUrl`, `setSyncToken`, `startHealthCheck`
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

### 3.39 `frontend/src/api/localDb.js`

- Declared exports: `buildCSVTemplate`, `dexieDb`, `localGetSettings`, `localSaveSettings`, `parseCSV`
- Imports (1)
  - `dexie`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/api/methods.js`
  - `frontend/src/web-api.js`

### 3.40 `frontend/src/api/methods.js`

- Declared exports: `adjustStock`, `attachSaleCustomer`, `browseDir`, `bulkImportCustomers`, `bulkImportDeliveryContacts`, `bulkImportProducts`, `bulkImportSuppliers`, `changeUserPassword`, `completePasswordReset`, `confirmUserContactVerification`, `createBranch`, `createCategory`, `createCustomField`, `createCustomTable`, `createCustomer`, `createDeliveryContact`, `createPortalSubmission`, `createProduct`, `createProductVariant`, `createReturn`, `createRole`, `createSale`, `createSupplier`, `createSupplierReturn`, `createUnit`, `createUser`, `deleteBranch`, `deleteCategory`, `deleteCustomField`, `deleteCustomRow`, `deleteCustomer`, `deleteDeliveryContact`, `deleteFileAsset`, `deleteProduct`, `deleteRole`, `deleteSupplier`, `deleteUnit`, `downloadCustomerTemplate`, `downloadImportTemplate`, `downloadSupplierTemplate`, `exportBackup`, `exportBackupFolder`, `factoryReset`, `getAnalytics`, `getAuditLogs`, `getBranchStock`, `getBranches`, `getCatalogMeta`, `getCatalogProducts`, `getCategories`, `getCustomFields`, `getCustomTableData`, `getCustomTables`, `getCustomers`, `getDashboard`, `getDataPath`, `getDeliveryContacts`, `getFiles`, `getImageDataUrl`, `getInventoryMovements`, `getInventorySummary`, `getPortalCatalogMeta`, `getPortalCatalogProducts`, `getPortalConfig`, `getPortalSubmissionsForReview`, `getProducts`, `getReturn`, `getReturns`, `getRoles`, `getSales`, `getSalesExport`, `getSettings`, `getSuppliers`, `getTransfers`, `getUnits`, `getUserProfile`, `getUsers`, `getVerificationCapabilities`, `importBackup`, `importBackupData`, `importBackupFolder`, `insertCustomRow`, `login`, `lookupPortalMembership`, `openCSVDialog`, `openFolderDialog`, `openImageDialog`, `openPath`, `otpConfirm`, `otpDisable`, `otpSetup`, `otpStatus`, `otpVerify`, `pickBackupFile`, `requestLoginCode`, `requestPasswordResetCode`, `requestUserContactVerification`, `resetData`, `resetDataPath`, `resetPassword`, `reviewPortalSubmission`, `saveSettings`, `setDataPath`, `testSyncServer`, `transferStock`, `updateBranch`, `updateCategory`, `updateCustomField`, `updateCustomRow`, `updateCustomer`, `updateDeliveryContact`, `updateProduct`, `updateReturn`, `updateRole`, `updateSaleStatus`, `updateSupplier`, `updateUser`, `updateUserProfile`, `uploadFileAsset`, `uploadProductImage`, `uploadUserAvatar`, `verifyLoginCode`
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

### 3.41 `frontend/src/api/websocket.js`

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

### 3.42 `frontend/src/App.jsx`

- Declared exports: `function`
- Imports (23)
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
  - `react`
- Internal dependencies (22)
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
- Referenced by (1)
  - `frontend/src/index.jsx`

### 3.43 `frontend/src/app/appShellUtils.mjs`

- Declared exports: `MAX_MOUNTED_PAGES`, `getNotificationColor`, `getNotificationPrefix`, `isPublicCatalogPath`, `updateMountedPages`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/App.jsx`
  - `frontend/tests/appShellUtils.test.mjs`

### 3.44 `frontend/src/AppContext.jsx`

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

### 3.45 `frontend/src/components/auth/Login.jsx`

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

### 3.46 `frontend/src/components/branches/Branches.jsx`

- Declared exports: `function`
- Imports (5)
  - `../../AppContext`
  - `../shared/Modal`
  - `./BranchForm`
  - `./TransferModal`
  - `react`
- Internal dependencies (4)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/branches/BranchForm.jsx`
  - `frontend/src/components/branches/TransferModal.jsx`
  - `frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.47 `frontend/src/components/branches/BranchForm.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (1)
  - `frontend/src/components/branches/Branches.jsx`

### 3.48 `frontend/src/components/branches/TransferModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (1)
  - `frontend/src/components/branches/Branches.jsx`

### 3.49 `frontend/src/components/catalog/CatalogPage.jsx`

- Declared exports: `function`
- Imports (5)
  - `../../AppContext`
  - `../files/FilePickerModal`
  - `../products/primitives`
  - `../shared/ImageGalleryLightbox`
  - `react`
- Internal dependencies (4)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/files/FilePickerModal.jsx`
  - `frontend/src/components/products/primitives.jsx`
  - `frontend/src/components/shared/ImageGalleryLightbox.jsx`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.50 `frontend/src/components/catalog/portalEditorUtils.mjs`

- Declared exports: `createAboutBlock`, `extractGoogleMapsEmbedUrl`, `moveListItem`, `normalizeAboutBlocks`, `normalizeGoogleMapsEmbed`, `serializeAboutBlocks`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.51 `frontend/src/components/contacts/Contacts.jsx`

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

### 3.52 `frontend/src/components/contacts/CustomersTab.jsx`

- Declared exports: `parseContactOptions`, `serializeContactOptions`
- Imports (6)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `../shared/Modal`
  - `./shared`
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

### 3.53 `frontend/src/components/contacts/DeliveryTab.jsx`

- Declared exports: `parseDeliveryOptions`, `serializeDeliveryOptions`
- Imports (6)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `../shared/Modal`
  - `./shared`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/contacts/shared.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/utils/csv.js`
  - `frontend/src/utils/formatters.js`
- Referenced by (1)
  - `frontend/src/components/contacts/Contacts.jsx`

### 3.54 `frontend/src/components/contacts/shared.jsx`

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

### 3.55 `frontend/src/components/contacts/SuppliersTab.jsx`

- Declared exports: none detected
- Imports (6)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `../shared/Modal`
  - `./shared`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/contacts/shared.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/utils/csv.js`
  - `frontend/src/utils/formatters.js`
- Referenced by (1)
  - `frontend/src/components/contacts/Contacts.jsx`

### 3.56 `frontend/src/components/custom-tables/CustomTables.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (0)
  - none

### 3.57 `frontend/src/components/dashboard/charts/BarChart.jsx`

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

### 3.58 `frontend/src/components/dashboard/charts/DonutChart.jsx`

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

### 3.59 `frontend/src/components/dashboard/charts/index.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/dashboard/Dashboard.jsx`

### 3.60 `frontend/src/components/dashboard/charts/LineChart.jsx`

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

### 3.61 `frontend/src/components/dashboard/charts/NoData.jsx`

- Declared exports: `function`
- Imports (1)
  - `../../../AppContext`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (3)
  - `frontend/src/components/dashboard/charts/BarChart.jsx`
  - `frontend/src/components/dashboard/charts/DonutChart.jsx`
  - `frontend/src/components/dashboard/charts/LineChart.jsx`

### 3.62 `frontend/src/components/dashboard/Dashboard.jsx`

- Declared exports: `function`
- Imports (8)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/dateHelpers`
  - `../../utils/formatters`
  - `../shared/PortalMenu`
  - `./MiniStat`
  - `./charts`
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

### 3.63 `frontend/src/components/dashboard/MiniStat.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/dashboard/Dashboard.jsx`

### 3.64 `frontend/src/components/files/FilePickerModal.jsx`

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

### 3.65 `frontend/src/components/files/FilesPage.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.66 `frontend/src/components/inventory/DualMoney.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/inventory/ProductDetailModal.jsx`

### 3.67 `frontend/src/components/inventory/Inventory.jsx`

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

### 3.68 `frontend/src/components/inventory/movementGroups.js`

- Declared exports: `buildMovementGroups`, `movementGroupHaystack`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/inventory/Inventory.jsx`

### 3.69 `frontend/src/components/inventory/ProductDetailModal.jsx`

- Declared exports: `function`
- Imports (1)
  - `./DualMoney`
- Internal dependencies (1)
  - `frontend/src/components/inventory/DualMoney.jsx`
- Referenced by (1)
  - `frontend/src/components/inventory/Inventory.jsx`

### 3.70 `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `lucide-react`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.71 `frontend/src/components/navigation/Sidebar.jsx`

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

### 3.72 `frontend/src/components/pos/CartItem.jsx`

- Declared exports: `function`
- Imports (1)
  - `./ProductImage`
- Internal dependencies (1)
  - `frontend/src/components/pos/ProductImage.jsx`
- Referenced by (1)
  - `frontend/src/components/pos/POS.jsx`

### 3.73 `frontend/src/components/pos/FilterPanel.jsx`

- Declared exports: `function`
- Imports (1)
  - `lucide-react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/pos/POS.jsx`

### 3.74 `frontend/src/components/pos/POS.jsx`

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

### 3.75 `frontend/src/components/pos/ProductImage.jsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/pos/CartItem.jsx`
  - `frontend/src/components/pos/POS.jsx`

### 3.76 `frontend/src/components/pos/QuickAddModal.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/pos/POS.jsx`

### 3.77 `frontend/src/components/products/BranchStockAdjuster.jsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/products/ProductForm.jsx`

### 3.78 `frontend/src/components/products/BulkAddStockModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../shared/Modal`
  - `react`
- Internal dependencies (1)
  - `frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.79 `frontend/src/components/products/BulkImportModal.jsx`

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

### 3.80 `frontend/src/components/products/HeaderActions.jsx`

- Declared exports: `function`
- Imports (1)
  - `../shared/PortalMenu`
- Internal dependencies (1)
  - `frontend/src/components/shared/PortalMenu.jsx`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.81 `frontend/src/components/products/ManageBrandsModal.jsx`

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

### 3.82 `frontend/src/components/products/ManageCategoriesModal.jsx`

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

### 3.83 `frontend/src/components/products/ManageFieldsModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../shared/Modal`
  - `react`
- Internal dependencies (1)
  - `frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.84 `frontend/src/components/products/ManageMenu.jsx`

- Declared exports: `function`
- Imports (1)
  - `../shared/PortalMenu`
- Internal dependencies (1)
  - `frontend/src/components/shared/PortalMenu.jsx`
- Referenced by (0)
  - none

### 3.85 `frontend/src/components/products/ManageUnitsModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../shared/Modal`
  - `react`
- Internal dependencies (1)
  - `frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.86 `frontend/src/components/products/primitives.jsx`

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

### 3.87 `frontend/src/components/products/ProductDetailModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `./primitives`
  - `lucide-react`
- Internal dependencies (1)
  - `frontend/src/components/products/primitives.jsx`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.88 `frontend/src/components/products/ProductForm.jsx`

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

### 3.89 `frontend/src/components/products/Products.jsx`

- Declared exports: `function`
- Imports (17)
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

### 3.90 `frontend/src/components/products/VariantFormModal.jsx`

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

### 3.91 `frontend/src/components/receipt-settings/AllFieldsPanel.jsx`

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

### 3.92 `frontend/src/components/receipt-settings/constants.js`

- Declared exports: `ALL_FIELD_ITEMS`, `DEFAULT_TEMPLATE`, `getFieldItems`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `frontend/src/components/receipt-settings/AllFieldsPanel.jsx`
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`
  - `frontend/src/components/receipt/Receipt.jsx`

### 3.93 `frontend/src/components/receipt-settings/ErrorBoundary.jsx`

- Declared exports: `class`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.94 `frontend/src/components/receipt-settings/FieldOrderManager.jsx`

- Declared exports: `function`
- Imports (2)
  - `lucide-react`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.95 `frontend/src/components/receipt-settings/PrintSettings.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../utils/printReceipt`
  - `lucide-react`
  - `react`
- Internal dependencies (1)
  - `frontend/src/utils/printReceipt.js`
- Referenced by (1)
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.96 `frontend/src/components/receipt-settings/ReceiptPreview.jsx`

- Declared exports: `function`
- Imports (2)
  - `../receipt/Receipt`
  - `react`
- Internal dependencies (1)
  - `frontend/src/components/receipt/Receipt.jsx`
- Referenced by (1)
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.97 `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

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

### 3.98 `frontend/src/components/receipt/Receipt.jsx`

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

### 3.99 `frontend/src/components/returns/EditReturnModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (1)
  - `frontend/src/components/returns/Returns.jsx`

### 3.100 `frontend/src/components/returns/NewReturnModal.jsx`

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

### 3.101 `frontend/src/components/returns/NewSupplierReturnModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (1)
  - `frontend/src/components/returns/Returns.jsx`

### 3.102 `frontend/src/components/returns/ReturnDetailModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `../../utils/formatters`
- Internal dependencies (2)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/utils/formatters.js`
- Referenced by (1)
  - `frontend/src/components/returns/Returns.jsx`

### 3.103 `frontend/src/components/returns/Returns.jsx`

- Declared exports: `function`
- Imports (8)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `./EditReturnModal`
  - `./NewReturnModal`
  - `./NewSupplierReturnModal`
  - `./ReturnDetailModal`
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

### 3.104 `frontend/src/components/sales/ExportModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `./StatusBadge`
  - `react`
- Internal dependencies (1)
  - `frontend/src/components/sales/StatusBadge.jsx`
- Referenced by (1)
  - `frontend/src/components/sales/Sales.jsx`

### 3.105 `frontend/src/components/sales/SaleDetailModal.jsx`

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

### 3.106 `frontend/src/components/sales/Sales.jsx`

- Declared exports: `function`
- Imports (8)
  - `../../AppContext`
  - `../../utils/deviceInfo`
  - `../../utils/formatters`
  - `../receipt/Receipt`
  - `./ExportModal`
  - `./SaleDetailModal`
  - `./StatusBadge`
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

### 3.107 `frontend/src/components/sales/StatusBadge.jsx`

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

### 3.108 `frontend/src/components/server/ServerPage.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.109 `frontend/src/components/shared/ImageGalleryLightbox.jsx`

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

### 3.110 `frontend/src/components/shared/Modal.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (18)
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
  - `frontend/src/components/users/UserProfileModal.jsx`
  - `frontend/src/components/users/Users.jsx`

### 3.111 `frontend/src/components/shared/navigationConfig.js`

- Declared exports: `DEFAULT_MOBILE_PINNED`, `NAV_ITEMS`, `orderNavItems`, `parseNavSetting`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/navigation/Sidebar.jsx`
  - `frontend/src/components/utils-settings/Settings.jsx`

### 3.112 `frontend/src/components/shared/PageHelpButton.jsx`

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

### 3.113 `frontend/src/components/shared/pageHelpContent.js`

- Declared exports: `PAGE_HELP_CONTENT`, `getPageHelpContent`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/shared/PageHelpButton.jsx`

### 3.114 `frontend/src/components/shared/PortalMenu.jsx`

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

### 3.115 `frontend/src/components/users/PermissionEditor.jsx`

- Declared exports: `PERMISSION_DEFS`, `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/users/UserDetailSheet.jsx`
  - `frontend/src/components/users/Users.jsx`

### 3.116 `frontend/src/components/users/UserDetailSheet.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../utils/formatters`
  - `./PermissionEditor`
- Internal dependencies (2)
  - `frontend/src/components/users/PermissionEditor.jsx`
  - `frontend/src/utils/formatters.js`
- Referenced by (1)
  - `frontend/src/components/users/Users.jsx`

### 3.117 `frontend/src/components/users/UserProfileModal.jsx`

- Declared exports: `function`
- Imports (6)
  - `../../AppContext`
  - `../../constants`
  - `../files/FilePickerModal`
  - `../shared/Modal`
  - `../utils-settings/OtpModal`
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

### 3.118 `frontend/src/components/users/Users.jsx`

- Declared exports: `function`
- Imports (8)
  - `../../AppContext`
  - `../../utils/formatters`
  - `../shared/Modal`
  - `../shared/PortalMenu`
  - `./PermissionEditor`
  - `./UserDetailSheet`
  - `./UserProfileModal`
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

### 3.119 `frontend/src/components/utils-settings/AuditLog.jsx`

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

### 3.120 `frontend/src/components/utils-settings/Backup.jsx`

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

### 3.121 `frontend/src/components/utils-settings/FontFamilyPicker.jsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/utils-settings/Settings.jsx`

### 3.122 `frontend/src/components/utils-settings/index.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.123 `frontend/src/components/utils-settings/OtpModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (2)
  - `frontend/src/components/users/UserProfileModal.jsx`
  - `frontend/src/components/utils-settings/Settings.jsx`

### 3.124 `frontend/src/components/utils-settings/ResetData.jsx`

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

### 3.125 `frontend/src/components/utils-settings/Settings.jsx`

- Declared exports: `function`
- Imports (6)
  - `../../AppContext`
  - `../shared/navigationConfig`
  - `./FontFamilyPicker`
  - `./OtpModal`
  - `lucide-react`
  - `react`
- Internal dependencies (4)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/navigationConfig.js`
  - `frontend/src/components/utils-settings/FontFamilyPicker.jsx`
  - `frontend/src/components/utils-settings/OtpModal.jsx`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.126 `frontend/src/constants.js`

- Declared exports: `CURRENCY`, `DELIVERY_FEE_PAYER`, `EMPTY_CUSTOMER`, `LAYOUT`, `PAYMENT_METHODS`, `STOCK`, `STORAGE_KEYS`, `SYNC`, `WRITE_CHANNELS`, `createEmptyOrder`, `formatDate`, `isNetworkError`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (6)
  - `frontend/src/api/http.js`
  - `frontend/src/api/methods.js`
  - `frontend/src/api/websocket.js`
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/auth/Login.jsx`
  - `frontend/src/components/users/UserProfileModal.jsx`

### 3.127 `frontend/src/index.jsx`

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

### 3.128 `frontend/src/utils/appRefresh.js`

- Declared exports: `refreshAppData`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/utils-settings/Backup.jsx`
  - `frontend/src/components/utils-settings/ResetData.jsx`

### 3.129 `frontend/src/utils/csv.js`

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

### 3.130 `frontend/src/utils/dateHelpers.js`

- Declared exports: `offsetDate`, `todayStr`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/dashboard/Dashboard.jsx`

### 3.131 `frontend/src/utils/deviceInfo.js`

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

### 3.132 `frontend/src/utils/firebasePhoneAuth.js`

- Declared exports: `cleanupFirebasePhoneVerification`, `confirmFirebasePhoneCode`, `requestFirebasePhoneCode`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.133 `frontend/src/utils/formatters.js`

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

### 3.134 `frontend/src/utils/index.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.135 `frontend/src/utils/printReceipt.js`

- Declared exports: `PRINT_DEFAULTS`, `createReceiptPdfBlob`, `downloadReceiptPdf`, `getPaperWidthMm`, `getPrintSettings`, `openReceiptPdf`, `printReceipt`, `savePrintSettings`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/receipt-settings/PrintSettings.jsx`
  - `frontend/src/components/receipt/Receipt.jsx`

### 3.136 `frontend/src/web-api.js`

- Declared exports: none detected
- Imports (4)
  - `./api/http.js`
  - `./api/localDb.js`
  - `./api/methods.js`
  - `./api/websocket.js`
- Internal dependencies (4)
  - `frontend/src/api/http.js`
  - `frontend/src/api/localDb.js`
  - `frontend/src/api/methods.js`
  - `frontend/src/api/websocket.js`
- Referenced by (1)
  - `frontend/src/AppContext.jsx`

### 3.137 `frontend/tailwind.config.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.138 `frontend/tests/appShellUtils.test.mjs`

- Declared exports: none detected
- Imports (2)
  - `../src/app/appShellUtils.mjs`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/app/appShellUtils.mjs`
- Referenced by (0)
  - none

### 3.139 `frontend/tests/portalEditorUtils.test.mjs`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.140 `frontend/vite.config.mjs`

- Declared exports: `defineConfig`
- Imports (2)
  - `@vitejs/plugin-react`
  - `vite`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `temp-vite-build.mjs`

### 3.141 `ops/scripts/backend/verify-data-integrity.js`

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

### 3.142 `ops/scripts/frontend/verify-i18n.js`

- Declared exports: none detected
- Imports (2)
  - `../lib/fs-utils`
  - `path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.js`
- Referenced by (0)
  - none

### 3.143 `ops/scripts/generate-doc-reference.js`

- Declared exports: none detected
- Imports (3)
  - `./lib/fs-utils`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.js`
- Referenced by (0)
  - none

### 3.144 `ops/scripts/generate-full-project-docs.js`

- Declared exports: `push`
- Imports (3)
  - `./lib/fs-utils`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.js`
- Referenced by (0)
  - none

### 3.145 `ops/scripts/lib/fs-utils.js`

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

### 3.146 `ops/scripts/performance-scan.js`

- Declared exports: none detected
- Imports (3)
  - `./lib/fs-utils`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.js`
- Referenced by (0)
  - none

### 3.147 `temp-vite-build.mjs`

- Declared exports: none detected
- Imports (4)
  - `./frontend/vite.config.mjs`
  - `node:path`
  - `node:url`
  - `vite`
- Internal dependencies (1)
  - `frontend/vite.config.mjs`
- Referenced by (0)
  - none

