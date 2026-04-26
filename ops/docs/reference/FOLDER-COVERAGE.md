# Folder Coverage and Commentary

Auto-generated folder-level documentation coverage for all first-party project folders.

## 1. Coverage Summary

Total folders documented: **42**

## 2. Folder Matrix

| No. | Folder | Purpose | Direct files | Direct subfolders |
|---:|---|---|---:|---:|
| 1 | `.` | Project root (run files, setup, packaging, top-level config) | 13 | 5 |
| 2 | `backend` | Backend project root | 6 | 3 |
| 3 | `backend/src` | Backend runtime core | 13 | 2 |
| 4 | `backend/src/routes` | HTTP route modules | 17 | 0 |
| 5 | `backend/src/services` | Provider/service integrations | 3 | 0 |
| 6 | `backend/temp-backup-roundtrip-4011` | Project folder | 1 | 0 |
| 7 | `backend/test` | Project folder | 5 | 0 |
| 8 | `frontend` | Frontend project root | 7 | 3 |
| 9 | `frontend/public` | Project folder | 2 | 0 |
| 10 | `frontend/src` | Project folder | 6 | 6 |
| 11 | `frontend/src/api` | Frontend API and sync transport | 4 | 0 |
| 12 | `frontend/src/app` | Project folder | 1 | 0 |
| 13 | `frontend/src/components` | UI pages/components domain | 1 | 20 |
| 14 | `frontend/src/components/auth` | UI pages/components domain | 1 | 0 |
| 15 | `frontend/src/components/branches` | UI pages/components domain | 3 | 0 |
| 16 | `frontend/src/components/catalog` | UI pages/components domain | 2 | 0 |
| 17 | `frontend/src/components/contacts` | UI pages/components domain | 5 | 0 |
| 18 | `frontend/src/components/custom-tables` | UI pages/components domain | 1 | 0 |
| 19 | `frontend/src/components/dashboard` | UI pages/components domain | 2 | 1 |
| 20 | `frontend/src/components/dashboard/charts` | UI pages/components domain | 5 | 0 |
| 21 | `frontend/src/components/files` | UI pages/components domain | 2 | 0 |
| 22 | `frontend/src/components/inventory` | UI pages/components domain | 4 | 0 |
| 23 | `frontend/src/components/loyalty-points` | UI pages/components domain | 1 | 0 |
| 24 | `frontend/src/components/navigation` | UI pages/components domain | 1 | 0 |
| 25 | `frontend/src/components/pos` | UI pages/components domain | 5 | 0 |
| 26 | `frontend/src/components/products` | UI pages/components domain | 14 | 0 |
| 27 | `frontend/src/components/receipt` | UI pages/components domain | 1 | 0 |
| 28 | `frontend/src/components/receipt-settings` | UI pages/components domain | 7 | 0 |
| 29 | `frontend/src/components/returns` | UI pages/components domain | 5 | 0 |
| 30 | `frontend/src/components/sales` | UI pages/components domain | 4 | 0 |
| 31 | `frontend/src/components/server` | UI pages/components domain | 1 | 0 |
| 32 | `frontend/src/components/shared` | UI pages/components domain | 6 | 0 |
| 33 | `frontend/src/components/users` | UI pages/components domain | 4 | 0 |
| 34 | `frontend/src/components/utils-settings` | UI pages/components domain | 7 | 0 |
| 35 | `frontend/src/lang` | Localization resources | 2 | 0 |
| 36 | `frontend/src/styles` | Project folder | 1 | 0 |
| 37 | `frontend/src/utils` | Project folder | 8 | 0 |
| 38 | `frontend/tests` | Project folder | 2 | 0 |
| 39 | `ops/scripts` | Project-level automation scripts | 4 | 3 |
| 40 | `ops/scripts/backend` | Project folder | 1 | 0 |
| 41 | `ops/scripts/frontend` | Project folder | 1 | 0 |
| 42 | `ops/scripts/lib` | Project folder | 1 | 0 |

## 3. Detailed Folder Commentary

### 3.1 Folder: `.`

- Purpose: Project root (run files, setup, packaging, top-level config)
- Direct files: **13**
- Direct subfolders: **5**

#### 3.1.1 Subfolders

| No. | Name |
|---:|---|
| 1 | `backend` |
| 2 | `frontend` |
| 3 | `ops` |
| 4 | `runtime` |
| 5 | `temp-backup-roundtrip-4011` |

#### 3.1.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `.npmrc` | Project source/support file |
| 2 | `build-release.bat` | Release build orchestration script |
| 3 | `README-build.md` | Project documentation entrypoint |
| 4 | `README.md` | Project documentation entrypoint |
| 5 | `setup.bat` | Environment setup script |
| 6 | `setup.sh` | Environment setup script |
| 7 | `start-server-release.bat` | Server lifecycle launcher script |
| 8 | `start-server.bat` | Server lifecycle launcher script |
| 9 | `start-server.sh` | Server lifecycle launcher script |
| 10 | `stop-server-release.bat` | Server lifecycle launcher script |
| 11 | `stop-server.bat` | Server lifecycle launcher script |
| 12 | `stop-server.sh` | Server lifecycle launcher script |
| 13 | `temp-vite-build.mjs` | Project source/support file |


### 3.2 Folder: `backend`

- Purpose: Backend project root
- Direct files: **6**
- Direct subfolders: **3**

#### 3.2.1 Subfolders

| No. | Name |
|---:|---|
| 1 | `src` |
| 2 | `temp-backup-roundtrip-4011` |
| 3 | `test` |

#### 3.2.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `.env` | Project source/support file |
| 2 | `.npmrc` | Project source/support file |
| 3 | `leang-cosmetics-firebase-admins.json` | Configuration/data manifest |
| 4 | `package-lock.json` | Configuration/data manifest |
| 5 | `package.json` | Configuration/data manifest |
| 6 | `server.js` | Backend server entrypoint |


### 3.3 Folder: `backend/src`

- Purpose: Backend runtime core
- Direct files: **13**
- Direct subfolders: **2**

#### 3.3.1 Subfolders

| No. | Name |
|---:|---|
| 1 | `routes` |
| 2 | `services` |

#### 3.3.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `backupSchema.js` | Project source/support file |
| 2 | `config.js` | Project source/support file |
| 3 | `database.js` | Schema/migrations and DB bootstrap |
| 4 | `dataPath.js` | Project source/support file |
| 5 | `fileAssets.js` | Project source/support file |
| 6 | `helpers.js` | Project source/support file |
| 7 | `middleware.js` | Project source/support file |
| 8 | `portalUtils.js` | Project source/support file |
| 9 | `README.md` | Documentation |
| 10 | `requestContext.js` | Project source/support file |
| 11 | `security.js` | Project source/support file |
| 12 | `serverUtils.js` | Project source/support file |
| 13 | `websocket.js` | Project source/support file |


### 3.4 Folder: `backend/src/routes`

- Purpose: HTTP route modules
- Direct files: **17**
- Direct subfolders: **0**

#### 3.4.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `auth.js` | API route handler |
| 2 | `branches.js` | API route handler |
| 3 | `catalog.js` | API route handler |
| 4 | `categories.js` | API route handler |
| 5 | `contacts.js` | API route handler |
| 6 | `customTables.js` | API route handler |
| 7 | `files.js` | API route handler |
| 8 | `inventory.js` | API route handler |
| 9 | `portal.js` | API route handler |
| 10 | `products.js` | API route handler |
| 11 | `README.md` | API route handler |
| 12 | `returns.js` | API route handler |
| 13 | `sales.js` | API route handler |
| 14 | `settings.js` | API route handler |
| 15 | `system.js` | API route handler |
| 16 | `units.js` | API route handler |
| 17 | `users.js` | API route handler |


### 3.5 Folder: `backend/src/services`

- Purpose: Provider/service integrations
- Direct files: **3**
- Direct subfolders: **0**

#### 3.5.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `firebaseAuth.js` | Integration/service layer |
| 2 | `README.md` | Integration/service layer |
| 3 | `verification.js` | Integration/service layer |


### 3.6 Folder: `backend/temp-backup-roundtrip-4011`

- Purpose: Project folder
- Direct files: **1**
- Direct subfolders: **0**

#### 3.6.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `backend-test.env` | Project source/support file |


### 3.7 Folder: `backend/test`

- Purpose: Project folder
- Direct files: **5**
- Direct subfolders: **0**

#### 3.7.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `backupRoundtrip.test.js` | Project source/support file |
| 2 | `backupSchema.test.js` | Project source/support file |
| 3 | `dataPath.test.js` | Project source/support file |
| 4 | `portalUtils.test.js` | Project source/support file |
| 5 | `serverUtils.test.js` | Project source/support file |


### 3.8 Folder: `frontend`

- Purpose: Frontend project root
- Direct files: **7**
- Direct subfolders: **3**

#### 3.8.1 Subfolders

| No. | Name |
|---:|---|
| 1 | `public` |
| 2 | `src` |
| 3 | `tests` |

#### 3.8.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `.npmrc` | Project source/support file |
| 2 | `index.html` | Project source/support file |
| 3 | `package-lock.json` | Configuration/data manifest |
| 4 | `package.json` | Configuration/data manifest |
| 5 | `postcss.config.js` | Project source/support file |
| 6 | `tailwind.config.js` | Project source/support file |
| 7 | `vite.config.mjs` | Project source/support file |


### 3.9 Folder: `frontend/public`

- Purpose: Project folder
- Direct files: **2**
- Direct subfolders: **0**

#### 3.9.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `icon.png` | Project source/support file |
| 2 | `manifest.json` | Configuration/data manifest |


### 3.10 Folder: `frontend/src`

- Purpose: Project folder
- Direct files: **6**
- Direct subfolders: **6**

#### 3.10.1 Subfolders

| No. | Name |
|---:|---|
| 1 | `api` |
| 2 | `app` |
| 3 | `components` |
| 4 | `lang` |
| 5 | `styles` |
| 6 | `utils` |

#### 3.10.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `App.jsx` | Main app shell and page mounting |
| 2 | `AppContext.jsx` | Global app state/context provider |
| 3 | `constants.js` | Project source/support file |
| 4 | `index.jsx` | Project source/support file |
| 5 | `README.md` | Documentation |
| 6 | `web-api.js` | Project source/support file |


### 3.11 Folder: `frontend/src/api`

- Purpose: Frontend API and sync transport
- Direct files: **4**
- Direct subfolders: **0**

#### 3.11.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `http.js` | Frontend API/sync helper |
| 2 | `localDb.js` | Frontend API/sync helper |
| 3 | `methods.js` | Frontend API/sync helper |
| 4 | `websocket.js` | Frontend API/sync helper |


### 3.12 Folder: `frontend/src/app`

- Purpose: Project folder
- Direct files: **1**
- Direct subfolders: **0**

#### 3.12.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `appShellUtils.mjs` | Project source/support file |


### 3.13 Folder: `frontend/src/components`

- Purpose: UI pages/components domain
- Direct files: **1**
- Direct subfolders: **20**

#### 3.13.1 Subfolders

| No. | Name |
|---:|---|
| 1 | `auth` |
| 2 | `branches` |
| 3 | `catalog` |
| 4 | `contacts` |
| 5 | `custom-tables` |
| 6 | `dashboard` |
| 7 | `files` |
| 8 | `inventory` |
| 9 | `loyalty-points` |
| 10 | `navigation` |
| 11 | `pos` |
| 12 | `products` |
| 13 | `receipt` |
| 14 | `receipt-settings` |
| 15 | `returns` |
| 16 | `sales` |
| 17 | `server` |
| 18 | `shared` |
| 19 | `users` |
| 20 | `utils-settings` |

#### 3.13.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `README.md` | UI component/page |


### 3.14 Folder: `frontend/src/components/auth`

- Purpose: UI pages/components domain
- Direct files: **1**
- Direct subfolders: **0**

#### 3.14.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `Login.jsx` | UI component/page |


### 3.15 Folder: `frontend/src/components/branches`

- Purpose: UI pages/components domain
- Direct files: **3**
- Direct subfolders: **0**

#### 3.15.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `Branches.jsx` | UI component/page |
| 2 | `BranchForm.jsx` | UI component/page |
| 3 | `TransferModal.jsx` | UI component/page |


### 3.16 Folder: `frontend/src/components/catalog`

- Purpose: UI pages/components domain
- Direct files: **2**
- Direct subfolders: **0**

#### 3.16.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `CatalogPage.jsx` | UI component/page |
| 2 | `portalEditorUtils.mjs` | UI component/page |


### 3.17 Folder: `frontend/src/components/contacts`

- Purpose: UI pages/components domain
- Direct files: **5**
- Direct subfolders: **0**

#### 3.17.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `Contacts.jsx` | UI component/page |
| 2 | `CustomersTab.jsx` | UI component/page |
| 3 | `DeliveryTab.jsx` | UI component/page |
| 4 | `shared.jsx` | UI component/page |
| 5 | `SuppliersTab.jsx` | UI component/page |


### 3.18 Folder: `frontend/src/components/custom-tables`

- Purpose: UI pages/components domain
- Direct files: **1**
- Direct subfolders: **0**

#### 3.18.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `CustomTables.jsx` | UI component/page |


### 3.19 Folder: `frontend/src/components/dashboard`

- Purpose: UI pages/components domain
- Direct files: **2**
- Direct subfolders: **1**

#### 3.19.1 Subfolders

| No. | Name |
|---:|---|
| 1 | `charts` |

#### 3.19.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `Dashboard.jsx` | UI component/page |
| 2 | `MiniStat.jsx` | UI component/page |


### 3.20 Folder: `frontend/src/components/dashboard/charts`

- Purpose: UI pages/components domain
- Direct files: **5**
- Direct subfolders: **0**

#### 3.20.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `BarChart.jsx` | UI component/page |
| 2 | `DonutChart.jsx` | UI component/page |
| 3 | `index.js` | UI component/page |
| 4 | `LineChart.jsx` | UI component/page |
| 5 | `NoData.jsx` | UI component/page |


### 3.21 Folder: `frontend/src/components/files`

- Purpose: UI pages/components domain
- Direct files: **2**
- Direct subfolders: **0**

#### 3.21.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `FilePickerModal.jsx` | UI component/page |
| 2 | `FilesPage.jsx` | UI component/page |


### 3.22 Folder: `frontend/src/components/inventory`

- Purpose: UI pages/components domain
- Direct files: **4**
- Direct subfolders: **0**

#### 3.22.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `DualMoney.jsx` | UI component/page |
| 2 | `Inventory.jsx` | UI component/page |
| 3 | `movementGroups.js` | UI component/page |
| 4 | `ProductDetailModal.jsx` | UI component/page |


### 3.23 Folder: `frontend/src/components/loyalty-points`

- Purpose: UI pages/components domain
- Direct files: **1**
- Direct subfolders: **0**

#### 3.23.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `LoyaltyPointsPage.jsx` | UI component/page |


### 3.24 Folder: `frontend/src/components/navigation`

- Purpose: UI pages/components domain
- Direct files: **1**
- Direct subfolders: **0**

#### 3.24.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `Sidebar.jsx` | UI component/page |


### 3.25 Folder: `frontend/src/components/pos`

- Purpose: UI pages/components domain
- Direct files: **5**
- Direct subfolders: **0**

#### 3.25.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `CartItem.jsx` | UI component/page |
| 2 | `FilterPanel.jsx` | UI component/page |
| 3 | `POS.jsx` | UI component/page |
| 4 | `ProductImage.jsx` | UI component/page |
| 5 | `QuickAddModal.jsx` | UI component/page |


### 3.26 Folder: `frontend/src/components/products`

- Purpose: UI pages/components domain
- Direct files: **14**
- Direct subfolders: **0**

#### 3.26.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `BranchStockAdjuster.jsx` | UI component/page |
| 2 | `BulkAddStockModal.jsx` | UI component/page |
| 3 | `BulkImportModal.jsx` | UI component/page |
| 4 | `HeaderActions.jsx` | UI component/page |
| 5 | `ManageBrandsModal.jsx` | UI component/page |
| 6 | `ManageCategoriesModal.jsx` | UI component/page |
| 7 | `ManageFieldsModal.jsx` | UI component/page |
| 8 | `ManageMenu.jsx` | UI component/page |
| 9 | `ManageUnitsModal.jsx` | UI component/page |
| 10 | `primitives.jsx` | UI component/page |
| 11 | `ProductDetailModal.jsx` | UI component/page |
| 12 | `ProductForm.jsx` | UI component/page |
| 13 | `Products.jsx` | UI component/page |
| 14 | `VariantFormModal.jsx` | UI component/page |


### 3.27 Folder: `frontend/src/components/receipt`

- Purpose: UI pages/components domain
- Direct files: **1**
- Direct subfolders: **0**

#### 3.27.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `Receipt.jsx` | UI component/page |


### 3.28 Folder: `frontend/src/components/receipt-settings`

- Purpose: UI pages/components domain
- Direct files: **7**
- Direct subfolders: **0**

#### 3.28.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `AllFieldsPanel.jsx` | UI component/page |
| 2 | `constants.js` | UI component/page |
| 3 | `ErrorBoundary.jsx` | UI component/page |
| 4 | `FieldOrderManager.jsx` | UI component/page |
| 5 | `PrintSettings.jsx` | UI component/page |
| 6 | `ReceiptPreview.jsx` | UI component/page |
| 7 | `ReceiptSettings.jsx` | UI component/page |


### 3.29 Folder: `frontend/src/components/returns`

- Purpose: UI pages/components domain
- Direct files: **5**
- Direct subfolders: **0**

#### 3.29.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `EditReturnModal.jsx` | UI component/page |
| 2 | `NewReturnModal.jsx` | UI component/page |
| 3 | `NewSupplierReturnModal.jsx` | UI component/page |
| 4 | `ReturnDetailModal.jsx` | UI component/page |
| 5 | `Returns.jsx` | UI component/page |


### 3.30 Folder: `frontend/src/components/sales`

- Purpose: UI pages/components domain
- Direct files: **4**
- Direct subfolders: **0**

#### 3.30.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `ExportModal.jsx` | UI component/page |
| 2 | `SaleDetailModal.jsx` | UI component/page |
| 3 | `Sales.jsx` | UI component/page |
| 4 | `StatusBadge.jsx` | UI component/page |


### 3.31 Folder: `frontend/src/components/server`

- Purpose: UI pages/components domain
- Direct files: **1**
- Direct subfolders: **0**

#### 3.31.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `ServerPage.jsx` | UI component/page |


### 3.32 Folder: `frontend/src/components/shared`

- Purpose: UI pages/components domain
- Direct files: **6**
- Direct subfolders: **0**

#### 3.32.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `ImageGalleryLightbox.jsx` | UI component/page |
| 2 | `Modal.jsx` | UI component/page |
| 3 | `navigationConfig.js` | UI component/page |
| 4 | `PageHelpButton.jsx` | UI component/page |
| 5 | `pageHelpContent.js` | UI component/page |
| 6 | `PortalMenu.jsx` | UI component/page |


### 3.33 Folder: `frontend/src/components/users`

- Purpose: UI pages/components domain
- Direct files: **4**
- Direct subfolders: **0**

#### 3.33.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `PermissionEditor.jsx` | UI component/page |
| 2 | `UserDetailSheet.jsx` | UI component/page |
| 3 | `UserProfileModal.jsx` | UI component/page |
| 4 | `Users.jsx` | UI component/page |


### 3.34 Folder: `frontend/src/components/utils-settings`

- Purpose: UI pages/components domain
- Direct files: **7**
- Direct subfolders: **0**

#### 3.34.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `AuditLog.jsx` | UI component/page |
| 2 | `Backup.jsx` | UI component/page |
| 3 | `FontFamilyPicker.jsx` | UI component/page |
| 4 | `index.js` | UI component/page |
| 5 | `OtpModal.jsx` | UI component/page |
| 6 | `ResetData.jsx` | UI component/page |
| 7 | `Settings.jsx` | UI component/page |


### 3.35 Folder: `frontend/src/lang`

- Purpose: Localization resources
- Direct files: **2**
- Direct subfolders: **0**

#### 3.35.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `en.json` | Localization dictionary |
| 2 | `km.json` | Localization dictionary |


### 3.36 Folder: `frontend/src/styles`

- Purpose: Project folder
- Direct files: **1**
- Direct subfolders: **0**

#### 3.36.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `main.css` | Project source/support file |


### 3.37 Folder: `frontend/src/utils`

- Purpose: Project folder
- Direct files: **8**
- Direct subfolders: **0**

#### 3.37.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `appRefresh.js` | Utility helper |
| 2 | `csv.js` | Utility helper |
| 3 | `dateHelpers.js` | Utility helper |
| 4 | `deviceInfo.js` | Utility helper |
| 5 | `firebasePhoneAuth.js` | Utility helper |
| 6 | `formatters.js` | Utility helper |
| 7 | `index.js` | Utility helper |
| 8 | `printReceipt.js` | Utility helper |


### 3.38 Folder: `frontend/tests`

- Purpose: Project folder
- Direct files: **2**
- Direct subfolders: **0**

#### 3.38.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `appShellUtils.test.mjs` | Project source/support file |
| 2 | `portalEditorUtils.test.mjs` | Project source/support file |


### 3.39 Folder: `ops/scripts`

- Purpose: Project-level automation scripts
- Direct files: **4**
- Direct subfolders: **3**

#### 3.39.1 Subfolders

| No. | Name |
|---:|---|
| 1 | `backend` |
| 2 | `frontend` |
| 3 | `lib` |

#### 3.39.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `generate-doc-reference.js` | Project source/support file |
| 2 | `generate-full-project-docs.js` | Project source/support file |
| 3 | `performance-scan.js` | Project source/support file |
| 4 | `sync-firebase-release-env.ps1` | Project source/support file |


### 3.40 Folder: `ops/scripts/backend`

- Purpose: Project folder
- Direct files: **1**
- Direct subfolders: **0**

#### 3.40.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `verify-data-integrity.js` | Project source/support file |


### 3.41 Folder: `ops/scripts/frontend`

- Purpose: Project folder
- Direct files: **1**
- Direct subfolders: **0**

#### 3.41.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `verify-i18n.js` | Project source/support file |


### 3.42 Folder: `ops/scripts/lib`

- Purpose: Project folder
- Direct files: **1**
- Direct subfolders: **0**

#### 3.42.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `fs-utils.js` | Project source/support file |


