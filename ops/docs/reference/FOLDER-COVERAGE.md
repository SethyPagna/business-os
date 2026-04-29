# Folder Coverage and Commentary

Auto-generated folder-level documentation coverage for all first-party project folders.

## 1. Coverage Summary

Total folders documented: **53**

## 2. Folder Matrix

| No. | Folder | Purpose | Direct files | Direct subfolders |
|---:|---|---|---:|---:|
| 1 | `.` | Project root (run files, setup, packaging, top-level config) | 15 | 4 |
| 2 | `backend` | Backend project root | 5 | 2 |
| 3 | `backend/src` | Backend runtime core | 24 | 7 |
| 4 | `backend/src/config` | Backend runtime core | 1 | 0 |
| 5 | `backend/src/dataPath` | Backend runtime core | 1 | 0 |
| 6 | `backend/src/organizationContext` | Backend runtime core | 1 | 0 |
| 7 | `backend/src/routes` | HTTP route modules | 19 | 1 |
| 8 | `backend/src/routes/system` | HTTP route modules | 1 | 0 |
| 9 | `backend/src/runtimeState` | Backend runtime core | 1 | 0 |
| 10 | `backend/src/services` | Provider/service integrations | 6 | 1 |
| 11 | `backend/src/services/googleDriveSync` | Provider/service integrations | 1 | 0 |
| 12 | `backend/src/storage` | Backend runtime core | 1 | 0 |
| 13 | `backend/test` | Project folder | 16 | 0 |
| 14 | `frontend` | Frontend project root | 7 | 3 |
| 15 | `frontend/public` | Project folder | 4 | 0 |
| 16 | `frontend/src` | Project folder | 6 | 7 |
| 17 | `frontend/src/api` | Frontend API and sync transport | 5 | 0 |
| 18 | `frontend/src/app` | Project folder | 1 | 0 |
| 19 | `frontend/src/components` | UI pages/components domain | 1 | 20 |
| 20 | `frontend/src/components/auth` | UI pages/components domain | 1 | 0 |
| 21 | `frontend/src/components/branches` | UI pages/components domain | 3 | 0 |
| 22 | `frontend/src/components/catalog` | UI pages/components domain | 5 | 0 |
| 23 | `frontend/src/components/contacts` | UI pages/components domain | 6 | 0 |
| 24 | `frontend/src/components/custom-tables` | UI pages/components domain | 1 | 0 |
| 25 | `frontend/src/components/dashboard` | UI pages/components domain | 2 | 1 |
| 26 | `frontend/src/components/dashboard/charts` | UI pages/components domain | 5 | 0 |
| 27 | `frontend/src/components/files` | UI pages/components domain | 2 | 0 |
| 28 | `frontend/src/components/inventory` | UI pages/components domain | 5 | 0 |
| 29 | `frontend/src/components/loyalty-points` | UI pages/components domain | 1 | 0 |
| 30 | `frontend/src/components/navigation` | UI pages/components domain | 1 | 0 |
| 31 | `frontend/src/components/pos` | UI pages/components domain | 6 | 0 |
| 32 | `frontend/src/components/products` | UI pages/components domain | 14 | 0 |
| 33 | `frontend/src/components/receipt` | UI pages/components domain | 1 | 0 |
| 34 | `frontend/src/components/receipt-settings` | UI pages/components domain | 8 | 0 |
| 35 | `frontend/src/components/returns` | UI pages/components domain | 5 | 0 |
| 36 | `frontend/src/components/sales` | UI pages/components domain | 5 | 0 |
| 37 | `frontend/src/components/server` | UI pages/components domain | 1 | 0 |
| 38 | `frontend/src/components/shared` | UI pages/components domain | 13 | 0 |
| 39 | `frontend/src/components/users` | UI pages/components domain | 4 | 0 |
| 40 | `frontend/src/components/utils-settings` | UI pages/components domain | 7 | 0 |
| 41 | `frontend/src/lang` | Localization resources | 2 | 0 |
| 42 | `frontend/src/platform` | Project folder | 0 | 2 |
| 43 | `frontend/src/platform/runtime` | Project folder | 1 | 0 |
| 44 | `frontend/src/platform/storage` | Project folder | 1 | 0 |
| 45 | `frontend/src/styles` | Project folder | 1 | 0 |
| 46 | `frontend/src/utils` | Project folder | 15 | 0 |
| 47 | `frontend/tests` | Project folder | 11 | 0 |
| 48 | `ops/scripts` | Project-level automation scripts | 5 | 5 |
| 49 | `ops/scripts/backend` | Project folder | 1 | 0 |
| 50 | `ops/scripts/frontend` | Project folder | 1 | 0 |
| 51 | `ops/scripts/lib` | Project folder | 1 | 0 |
| 52 | `ops/scripts/powershell` | Project folder | 1 | 0 |
| 53 | `ops/scripts/windows` | Project folder | 6 | 0 |

## 3. Detailed Folder Commentary

### 3.1 Folder: `.`

- Purpose: Project root (run files, setup, packaging, top-level config)
- Direct files: **15**
- Direct subfolders: **4**

#### 3.1.1 Subfolders

| No. | Name |
|---:|---|
| 1 | `backend` |
| 2 | `frontend` |
| 3 | `ops` |
| 4 | `runtime` |

#### 3.1.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `.npmrc` | Project source/support file |
| 2 | `build-release.bat` | Release build orchestration script |
| 3 | `clean-generated.bat` | Project source/support file |
| 4 | `clean-generated.ps1` | Project source/support file |
| 5 | `README-build.md` | Project documentation entrypoint |
| 6 | `README.md` | Project documentation entrypoint |
| 7 | `setup.bat` | Environment setup script |
| 8 | `setup.sh` | Environment setup script |
| 9 | `start-server-release.bat` | Server lifecycle launcher script |
| 10 | `start-server.bat` | Server lifecycle launcher script |
| 11 | `start-server.sh` | Server lifecycle launcher script |
| 12 | `stop-server-release.bat` | Server lifecycle launcher script |
| 13 | `stop-server.bat` | Server lifecycle launcher script |
| 14 | `stop-server.sh` | Server lifecycle launcher script |
| 15 | `verify-local.bat` | Project source/support file |


### 3.2 Folder: `backend`

- Purpose: Backend project root
- Direct files: **5**
- Direct subfolders: **2**

#### 3.2.1 Subfolders

| No. | Name |
|---:|---|
| 1 | `src` |
| 2 | `test` |

#### 3.2.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `.env` | Project source/support file |
| 2 | `.npmrc` | Project source/support file |
| 3 | `package-lock.json` | Configuration/data manifest |
| 4 | `package.json` | Configuration/data manifest |
| 5 | `server.js` | Backend server entrypoint |


### 3.3 Folder: `backend/src`

- Purpose: Backend runtime core
- Direct files: **24**
- Direct subfolders: **7**

#### 3.3.1 Subfolders

| No. | Name |
|---:|---|
| 1 | `config` |
| 2 | `dataPath` |
| 3 | `organizationContext` |
| 4 | `routes` |
| 5 | `runtimeState` |
| 6 | `services` |
| 7 | `storage` |

#### 3.3.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `accessControl.js` | Project source/support file |
| 2 | `authOtpGuards.js` | Project source/support file |
| 3 | `backupSchema.js` | Project source/support file |
| 4 | `conflictControl.js` | Project source/support file |
| 5 | `contactOptions.js` | Project source/support file |
| 6 | `database.js` | Schema/migrations and DB bootstrap |
| 7 | `fileAssets.js` | Project source/support file |
| 8 | `helpers.js` | Project source/support file |
| 9 | `idempotency.js` | Project source/support file |
| 10 | `middleware.js` | Project source/support file |
| 11 | `money.js` | Project source/support file |
| 12 | `netSecurity.js` | Project source/support file |
| 13 | `portalUtils.js` | Project source/support file |
| 14 | `productImportPolicies.js` | Project source/support file |
| 15 | `README.md` | Documentation |
| 16 | `requestContext.js` | Project source/support file |
| 17 | `security.js` | Project source/support file |
| 18 | `serverUtils.js` | Project source/support file |
| 19 | `sessionAuth.js` | Project source/support file |
| 20 | `settingsSnapshot.js` | Project source/support file |
| 21 | `systemFsWorker.js` | Project source/support file |
| 22 | `uploadReferenceCleanup.js` | Project source/support file |
| 23 | `uploadSecurity.js` | Project source/support file |
| 24 | `websocket.js` | Project source/support file |


### 3.4 Folder: `backend/src/config`

- Purpose: Backend runtime core
- Direct files: **1**
- Direct subfolders: **0**

#### 3.4.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `index.js` | Project source/support file |


### 3.5 Folder: `backend/src/dataPath`

- Purpose: Backend runtime core
- Direct files: **1**
- Direct subfolders: **0**

#### 3.5.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `index.js` | Project source/support file |


### 3.6 Folder: `backend/src/organizationContext`

- Purpose: Backend runtime core
- Direct files: **1**
- Direct subfolders: **0**

#### 3.6.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `index.js` | Project source/support file |


### 3.7 Folder: `backend/src/routes`

- Purpose: HTTP route modules
- Direct files: **19**
- Direct subfolders: **1**

#### 3.7.1 Subfolders

| No. | Name |
|---:|---|
| 1 | `system` |

#### 3.7.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `ai.js` | API route handler |
| 2 | `auth.js` | API route handler |
| 3 | `branches.js` | API route handler |
| 4 | `catalog.js` | API route handler |
| 5 | `categories.js` | API route handler |
| 6 | `contacts.js` | API route handler |
| 7 | `customTables.js` | API route handler |
| 8 | `files.js` | API route handler |
| 9 | `inventory.js` | API route handler |
| 10 | `notifications.js` | API route handler |
| 11 | `organizations.js` | API route handler |
| 12 | `portal.js` | API route handler |
| 13 | `products.js` | API route handler |
| 14 | `README.md` | API route handler |
| 15 | `returns.js` | API route handler |
| 16 | `sales.js` | API route handler |
| 17 | `settings.js` | API route handler |
| 18 | `units.js` | API route handler |
| 19 | `users.js` | API route handler |


### 3.8 Folder: `backend/src/routes/system`

- Purpose: HTTP route modules
- Direct files: **1**
- Direct subfolders: **0**

#### 3.8.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `index.js` | API route handler |


### 3.9 Folder: `backend/src/runtimeState`

- Purpose: Backend runtime core
- Direct files: **1**
- Direct subfolders: **0**

#### 3.9.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `index.js` | Project source/support file |


### 3.10 Folder: `backend/src/services`

- Purpose: Provider/service integrations
- Direct files: **6**
- Direct subfolders: **1**

#### 3.10.1 Subfolders

| No. | Name |
|---:|---|
| 1 | `googleDriveSync` |

#### 3.10.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `aiGateway.js` | Integration/service layer |
| 2 | `firebaseAuth.js` | Integration/service layer |
| 3 | `portalAi.js` | Integration/service layer |
| 4 | `README.md` | Integration/service layer |
| 5 | `supabaseAuth.js` | Integration/service layer |
| 6 | `verification.js` | Integration/service layer |


### 3.11 Folder: `backend/src/services/googleDriveSync`

- Purpose: Provider/service integrations
- Direct files: **1**
- Direct subfolders: **0**

#### 3.11.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `index.js` | Integration/service layer |


### 3.12 Folder: `backend/src/storage`

- Purpose: Backend runtime core
- Direct files: **1**
- Direct subfolders: **0**

#### 3.12.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `organizationFolders.js` | Project source/support file |


### 3.13 Folder: `backend/test`

- Purpose: Project folder
- Direct files: **16**
- Direct subfolders: **0**

#### 3.13.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `accessControl.test.js` | Project source/support file |
| 2 | `authOtpGuards.test.js` | Project source/support file |
| 3 | `authSecurityFlow.test.js` | Project source/support file |
| 4 | `backupRoundtrip.test.js` | Project source/support file |
| 5 | `backupSchema.test.js` | Project source/support file |
| 6 | `configOrganizationRuntime.test.js` | Project source/support file |
| 7 | `contactOptions.test.js` | Project source/support file |
| 8 | `dataPath.test.js` | Project source/support file |
| 9 | `fileRouteSecurityFlow.test.js` | Project source/support file |
| 10 | `idempotency.test.js` | Project source/support file |
| 11 | `netSecurity.test.js` | Project source/support file |
| 12 | `portalUtils.test.js` | Project source/support file |
| 13 | `productImportPolicies.test.js` | Project source/support file |
| 14 | `serverUtils.test.js` | Project source/support file |
| 15 | `stockConsistency.test.js` | Project source/support file |
| 16 | `uploadSecurity.test.js` | Project source/support file |


### 3.14 Folder: `frontend`

- Purpose: Frontend project root
- Direct files: **7**
- Direct subfolders: **3**

#### 3.14.1 Subfolders

| No. | Name |
|---:|---|
| 1 | `public` |
| 2 | `src` |
| 3 | `tests` |

#### 3.14.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `.npmrc` | Project source/support file |
| 2 | `index.html` | Project source/support file |
| 3 | `package-lock.json` | Configuration/data manifest |
| 4 | `package.json` | Configuration/data manifest |
| 5 | `postcss.config.mjs` | Project source/support file |
| 6 | `tailwind.config.mjs` | Project source/support file |
| 7 | `vite.config.mjs` | Project source/support file |


### 3.15 Folder: `frontend/public`

- Purpose: Project folder
- Direct files: **4**
- Direct subfolders: **0**

#### 3.15.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `icon.png` | Project source/support file |
| 2 | `manifest.json` | Configuration/data manifest |
| 3 | `sw.js` | Project source/support file |
| 4 | `theme-bootstrap.js` | Project source/support file |


### 3.16 Folder: `frontend/src`

- Purpose: Project folder
- Direct files: **6**
- Direct subfolders: **7**

#### 3.16.1 Subfolders

| No. | Name |
|---:|---|
| 1 | `api` |
| 2 | `app` |
| 3 | `components` |
| 4 | `lang` |
| 5 | `platform` |
| 6 | `styles` |
| 7 | `utils` |

#### 3.16.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `App.jsx` | Main app shell and page mounting |
| 2 | `AppContext.jsx` | Global app state/context provider |
| 3 | `constants.js` | Project source/support file |
| 4 | `index.jsx` | Project source/support file |
| 5 | `README.md` | Documentation |
| 6 | `web-api.js` | Project source/support file |


### 3.17 Folder: `frontend/src/api`

- Purpose: Frontend API and sync transport
- Direct files: **5**
- Direct subfolders: **0**

#### 3.17.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `http.js` | Frontend API/sync helper |
| 2 | `localDb.js` | Frontend API/sync helper |
| 3 | `methods.js` | Frontend API/sync helper |
| 4 | `README.md` | Frontend API/sync helper |
| 5 | `websocket.js` | Frontend API/sync helper |


### 3.18 Folder: `frontend/src/app`

- Purpose: Project folder
- Direct files: **1**
- Direct subfolders: **0**

#### 3.18.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `appShellUtils.mjs` | Project source/support file |


### 3.19 Folder: `frontend/src/components`

- Purpose: UI pages/components domain
- Direct files: **1**
- Direct subfolders: **20**

#### 3.19.1 Subfolders

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

#### 3.19.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `README.md` | UI component/page |


### 3.20 Folder: `frontend/src/components/auth`

- Purpose: UI pages/components domain
- Direct files: **1**
- Direct subfolders: **0**

#### 3.20.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `Login.jsx` | UI component/page |


### 3.21 Folder: `frontend/src/components/branches`

- Purpose: UI pages/components domain
- Direct files: **3**
- Direct subfolders: **0**

#### 3.21.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `Branches.jsx` | UI component/page |
| 2 | `BranchForm.jsx` | UI component/page |
| 3 | `TransferModal.jsx` | UI component/page |


### 3.22 Folder: `frontend/src/components/catalog`

- Purpose: UI pages/components domain
- Direct files: **5**
- Direct subfolders: **0**

#### 3.22.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `CatalogPage.jsx` | UI component/page |
| 2 | `CatalogProductsSection.jsx` | UI component/page |
| 3 | `CatalogSecondaryTabs.jsx` | UI component/page |
| 4 | `catalogUi.jsx` | UI component/page |
| 5 | `portalEditorUtils.mjs` | UI component/page |


### 3.23 Folder: `frontend/src/components/contacts`

- Purpose: UI pages/components domain
- Direct files: **6**
- Direct subfolders: **0**

#### 3.23.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `contactOptionUtils.js` | UI component/page |
| 2 | `Contacts.jsx` | UI component/page |
| 3 | `CustomersTab.jsx` | UI component/page |
| 4 | `DeliveryTab.jsx` | UI component/page |
| 5 | `shared.jsx` | UI component/page |
| 6 | `SuppliersTab.jsx` | UI component/page |


### 3.24 Folder: `frontend/src/components/custom-tables`

- Purpose: UI pages/components domain
- Direct files: **1**
- Direct subfolders: **0**

#### 3.24.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `CustomTables.jsx` | UI component/page |


### 3.25 Folder: `frontend/src/components/dashboard`

- Purpose: UI pages/components domain
- Direct files: **2**
- Direct subfolders: **1**

#### 3.25.1 Subfolders

| No. | Name |
|---:|---|
| 1 | `charts` |

#### 3.25.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `Dashboard.jsx` | UI component/page |
| 2 | `MiniStat.jsx` | UI component/page |


### 3.26 Folder: `frontend/src/components/dashboard/charts`

- Purpose: UI pages/components domain
- Direct files: **5**
- Direct subfolders: **0**

#### 3.26.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `BarChart.jsx` | UI component/page |
| 2 | `DonutChart.jsx` | UI component/page |
| 3 | `index.js` | UI component/page |
| 4 | `LineChart.jsx` | UI component/page |
| 5 | `NoData.jsx` | UI component/page |


### 3.27 Folder: `frontend/src/components/files`

- Purpose: UI pages/components domain
- Direct files: **2**
- Direct subfolders: **0**

#### 3.27.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `FilePickerModal.jsx` | UI component/page |
| 2 | `FilesPage.jsx` | UI component/page |


### 3.28 Folder: `frontend/src/components/inventory`

- Purpose: UI pages/components domain
- Direct files: **5**
- Direct subfolders: **0**

#### 3.28.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `DualMoney.jsx` | UI component/page |
| 2 | `Inventory.jsx` | UI component/page |
| 3 | `InventoryImportModal.jsx` | UI component/page |
| 4 | `movementGroups.js` | UI component/page |
| 5 | `ProductDetailModal.jsx` | UI component/page |


### 3.29 Folder: `frontend/src/components/loyalty-points`

- Purpose: UI pages/components domain
- Direct files: **1**
- Direct subfolders: **0**

#### 3.29.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `LoyaltyPointsPage.jsx` | UI component/page |


### 3.30 Folder: `frontend/src/components/navigation`

- Purpose: UI pages/components domain
- Direct files: **1**
- Direct subfolders: **0**

#### 3.30.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `Sidebar.jsx` | UI component/page |


### 3.31 Folder: `frontend/src/components/pos`

- Purpose: UI pages/components domain
- Direct files: **6**
- Direct subfolders: **0**

#### 3.31.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `CartItem.jsx` | UI component/page |
| 2 | `FilterPanel.jsx` | UI component/page |
| 3 | `POS.jsx` | UI component/page |
| 4 | `posCore.mjs` | UI component/page |
| 5 | `ProductImage.jsx` | UI component/page |
| 6 | `QuickAddModal.jsx` | UI component/page |


### 3.32 Folder: `frontend/src/components/products`

- Purpose: UI pages/components domain
- Direct files: **14**
- Direct subfolders: **0**

#### 3.32.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `BarcodeScannerModal.jsx` | UI component/page |
| 2 | `barcodeScannerState.mjs` | UI component/page |
| 3 | `BranchStockAdjuster.jsx` | UI component/page |
| 4 | `BulkAddStockModal.jsx` | UI component/page |
| 5 | `BulkImportModal.jsx` | UI component/page |
| 6 | `HeaderActions.jsx` | UI component/page |
| 7 | `ManageBrandsModal.jsx` | UI component/page |
| 8 | `ManageCategoriesModal.jsx` | UI component/page |
| 9 | `ManageUnitsModal.jsx` | UI component/page |
| 10 | `primitives.jsx` | UI component/page |
| 11 | `ProductDetailModal.jsx` | UI component/page |
| 12 | `ProductForm.jsx` | UI component/page |
| 13 | `Products.jsx` | UI component/page |
| 14 | `VariantFormModal.jsx` | UI component/page |


### 3.33 Folder: `frontend/src/components/receipt`

- Purpose: UI pages/components domain
- Direct files: **1**
- Direct subfolders: **0**

#### 3.33.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `Receipt.jsx` | UI component/page |


### 3.34 Folder: `frontend/src/components/receipt-settings`

- Purpose: UI pages/components domain
- Direct files: **8**
- Direct subfolders: **0**

#### 3.34.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `AllFieldsPanel.jsx` | UI component/page |
| 2 | `constants.js` | UI component/page |
| 3 | `ErrorBoundary.jsx` | UI component/page |
| 4 | `FieldOrderManager.jsx` | UI component/page |
| 5 | `PrintSettings.jsx` | UI component/page |
| 6 | `ReceiptPreview.jsx` | UI component/page |
| 7 | `ReceiptSettings.jsx` | UI component/page |
| 8 | `template.js` | UI component/page |


### 3.35 Folder: `frontend/src/components/returns`

- Purpose: UI pages/components domain
- Direct files: **5**
- Direct subfolders: **0**

#### 3.35.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `EditReturnModal.jsx` | UI component/page |
| 2 | `NewReturnModal.jsx` | UI component/page |
| 3 | `NewSupplierReturnModal.jsx` | UI component/page |
| 4 | `ReturnDetailModal.jsx` | UI component/page |
| 5 | `Returns.jsx` | UI component/page |


### 3.36 Folder: `frontend/src/components/sales`

- Purpose: UI pages/components domain
- Direct files: **5**
- Direct subfolders: **0**

#### 3.36.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `ExportModal.jsx` | UI component/page |
| 2 | `SaleDetailModal.jsx` | UI component/page |
| 3 | `Sales.jsx` | UI component/page |
| 4 | `SalesImportModal.jsx` | UI component/page |
| 5 | `StatusBadge.jsx` | UI component/page |


### 3.37 Folder: `frontend/src/components/server`

- Purpose: UI pages/components domain
- Direct files: **1**
- Direct subfolders: **0**

#### 3.37.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `ServerPage.jsx` | UI component/page |


### 3.38 Folder: `frontend/src/components/shared`

- Purpose: UI pages/components domain
- Direct files: **13**
- Direct subfolders: **0**

#### 3.38.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `ExportMenu.jsx` | UI component/page |
| 2 | `FilterMenu.jsx` | UI component/page |
| 3 | `ImageGalleryLightbox.jsx` | UI component/page |
| 4 | `Modal.jsx` | UI component/page |
| 5 | `navigationConfig.js` | UI component/page |
| 6 | `NotificationCenter.jsx` | UI component/page |
| 7 | `pageActivity.js` | UI component/page |
| 8 | `PageHeader.jsx` | UI component/page |
| 9 | `PageHelpButton.jsx` | UI component/page |
| 10 | `pageHelpContent.js` | UI component/page |
| 11 | `PortalMenu.jsx` | UI component/page |
| 12 | `QuickPreferenceToggles.jsx` | UI component/page |
| 13 | `WriteConflictModal.jsx` | UI component/page |


### 3.39 Folder: `frontend/src/components/users`

- Purpose: UI pages/components domain
- Direct files: **4**
- Direct subfolders: **0**

#### 3.39.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `PermissionEditor.jsx` | UI component/page |
| 2 | `UserDetailSheet.jsx` | UI component/page |
| 3 | `UserProfileModal.jsx` | UI component/page |
| 4 | `Users.jsx` | UI component/page |


### 3.40 Folder: `frontend/src/components/utils-settings`

- Purpose: UI pages/components domain
- Direct files: **7**
- Direct subfolders: **0**

#### 3.40.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `AuditLog.jsx` | UI component/page |
| 2 | `Backup.jsx` | UI component/page |
| 3 | `FontFamilyPicker.jsx` | UI component/page |
| 4 | `index.js` | UI component/page |
| 5 | `OtpModal.jsx` | UI component/page |
| 6 | `ResetData.jsx` | UI component/page |
| 7 | `Settings.jsx` | UI component/page |


### 3.41 Folder: `frontend/src/lang`

- Purpose: Localization resources
- Direct files: **2**
- Direct subfolders: **0**

#### 3.41.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `en.json` | Localization dictionary |
| 2 | `km.json` | Localization dictionary |


### 3.42 Folder: `frontend/src/platform`

- Purpose: Project folder
- Direct files: **0**
- Direct subfolders: **2**

#### 3.42.1 Subfolders

| No. | Name |
|---:|---|
| 1 | `runtime` |
| 2 | `storage` |


### 3.43 Folder: `frontend/src/platform/runtime`

- Purpose: Project folder
- Direct files: **1**
- Direct subfolders: **0**

#### 3.43.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `clientRuntime.js` | Project source/support file |


### 3.44 Folder: `frontend/src/platform/storage`

- Purpose: Project folder
- Direct files: **1**
- Direct subfolders: **0**

#### 3.44.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `storagePolicy.mjs` | Project source/support file |


### 3.45 Folder: `frontend/src/styles`

- Purpose: Project folder
- Direct files: **1**
- Direct subfolders: **0**

#### 3.45.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `main.css` | Project source/support file |


### 3.46 Folder: `frontend/src/utils`

- Purpose: Project folder
- Direct files: **15**
- Direct subfolders: **0**

#### 3.46.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `appRefresh.js` | Utility helper |
| 2 | `color.js` | Utility helper |
| 3 | `csv.js` | Utility helper |
| 4 | `csvImport.js` | Utility helper |
| 5 | `dateHelpers.js` | Utility helper |
| 6 | `deviceInfo.js` | Utility helper |
| 7 | `exportPackage.js` | Utility helper |
| 8 | `exportReports.jsx` | Utility helper |
| 9 | `favicon.js` | Utility helper |
| 10 | `formatters.js` | Utility helper |
| 11 | `groupedRecords.mjs` | Utility helper |
| 12 | `index.js` | Utility helper |
| 13 | `loaders.mjs` | Utility helper |
| 14 | `pricing.js` | Utility helper |
| 15 | `printReceipt.js` | Utility helper |


### 3.47 Folder: `frontend/tests`

- Purpose: Project folder
- Direct files: **11**
- Direct subfolders: **0**

#### 3.47.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `appShellUtils.test.mjs` | Project source/support file |
| 2 | `barcodeScannerState.test.mjs` | Project source/support file |
| 3 | `csvImport.test.mjs` | Project source/support file |
| 4 | `exportPackages.test.mjs` | Project source/support file |
| 5 | `groupedRecords.test.mjs` | Project source/support file |
| 6 | `loaders.test.mjs` | Project source/support file |
| 7 | `portalEditorUtils.test.mjs` | Project source/support file |
| 8 | `posCore.test.mjs` | Project source/support file |
| 9 | `pricingContacts.test.mjs` | Project source/support file |
| 10 | `receiptTemplate.test.mjs` | Project source/support file |
| 11 | `storagePolicy.test.mjs` | Project source/support file |


### 3.48 Folder: `ops/scripts`

- Purpose: Project-level automation scripts
- Direct files: **5**
- Direct subfolders: **5**

#### 3.48.1 Subfolders

| No. | Name |
|---:|---|
| 1 | `backend` |
| 2 | `frontend` |
| 3 | `lib` |
| 4 | `powershell` |
| 5 | `windows` |

#### 3.48.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `generate-doc-reference.js` | Project source/support file |
| 2 | `generate-full-project-docs.js` | Project source/support file |
| 3 | `performance-scan.js` | Project source/support file |
| 4 | `sync-firebase-release-env.ps1` | Project source/support file |
| 5 | `verify-runtime-deps.js` | Project source/support file |


### 3.49 Folder: `ops/scripts/backend`

- Purpose: Project folder
- Direct files: **1**
- Direct subfolders: **0**

#### 3.49.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `verify-data-integrity.js` | Project source/support file |


### 3.50 Folder: `ops/scripts/frontend`

- Purpose: Project folder
- Direct files: **1**
- Direct subfolders: **0**

#### 3.50.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `verify-i18n.js` | Project source/support file |


### 3.51 Folder: `ops/scripts/lib`

- Purpose: Project folder
- Direct files: **1**
- Direct subfolders: **0**

#### 3.51.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `fs-utils.js` | Project source/support file |


### 3.52 Folder: `ops/scripts/powershell`

- Purpose: Project folder
- Direct files: **1**
- Direct subfolders: **0**

#### 3.52.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `clean-generated.ps1` | Project source/support file |


### 3.53 Folder: `ops/scripts/windows`

- Purpose: Project folder
- Direct files: **6**
- Direct subfolders: **0**

#### 3.53.2 Files

| No. | File | Purpose |
|---:|---|---|
| 1 | `build-release.bat` | Project source/support file |
| 2 | `clean-generated.bat` | Project source/support file |
| 3 | `setup.bat` | Project source/support file |
| 4 | `start-server.bat` | Project source/support file |
| 5 | `stop-server.bat` | Project source/support file |
| 6 | `verify-local.bat` | Project source/support file |


