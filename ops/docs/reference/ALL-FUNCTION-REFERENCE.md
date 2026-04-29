# All Function Reference (Project First-Party Code)

Auto-generated function/class symbol commentary for all first-party code files (frontend, backend, root scripts/config code).

## 1. Coverage Summary

Code files scanned: **216**

## 2. Symbol Count by File

| No. | File | Symbols |
|---:|---|---:|
| 1 | `backend/server.js` | 14 |
| 2 | `backend/src/accessControl.js` | 16 |
| 3 | `backend/src/authOtpGuards.js` | 3 |
| 4 | `backend/src/backupSchema.js` | 3 |
| 5 | `backend/src/config/index.js` | 21 |
| 6 | `backend/src/conflictControl.js` | 5 |
| 7 | `backend/src/contactOptions.js` | 8 |
| 8 | `backend/src/database.js` | 13 |
| 9 | `backend/src/dataPath/index.js` | 9 |
| 10 | `backend/src/fileAssets.js` | 22 |
| 11 | `backend/src/helpers.js` | 18 |
| 12 | `backend/src/idempotency.js` | 1 |
| 13 | `backend/src/middleware.js` | 21 |
| 14 | `backend/src/money.js` | 3 |
| 15 | `backend/src/netSecurity.js` | 7 |
| 16 | `backend/src/organizationContext/index.js` | 14 |
| 17 | `backend/src/portalUtils.js` | 6 |
| 18 | `backend/src/productImportPolicies.js` | 6 |
| 19 | `backend/src/requestContext.js` | 5 |
| 20 | `backend/src/routes/ai.js` | 2 |
| 21 | `backend/src/routes/auth.js` | 26 |
| 22 | `backend/src/routes/branches.js` | 2 |
| 23 | `backend/src/routes/catalog.js` | 0 |
| 24 | `backend/src/routes/categories.js` | 2 |
| 25 | `backend/src/routes/contacts.js` | 14 |
| 26 | `backend/src/routes/customTables.js` | 8 |
| 27 | `backend/src/routes/files.js` | 3 |
| 28 | `backend/src/routes/inventory.js` | 2 |
| 29 | `backend/src/routes/notifications.js` | 10 |
| 30 | `backend/src/routes/organizations.js` | 0 |
| 31 | `backend/src/routes/portal.js` | 21 |
| 32 | `backend/src/routes/products.js` | 26 |
| 33 | `backend/src/routes/returns.js` | 7 |
| 34 | `backend/src/routes/sales.js` | 14 |
| 35 | `backend/src/routes/settings.js` | 5 |
| 36 | `backend/src/routes/system/index.js` | 27 |
| 37 | `backend/src/routes/units.js` | 3 |
| 38 | `backend/src/routes/users.js` | 21 |
| 39 | `backend/src/runtimeState/index.js` | 6 |
| 40 | `backend/src/security.js` | 13 |
| 41 | `backend/src/serverUtils.js` | 17 |
| 42 | `backend/src/services/aiGateway.js` | 12 |
| 43 | `backend/src/services/firebaseAuth.js` | 22 |
| 44 | `backend/src/services/googleDriveSync/index.js` | 49 |
| 45 | `backend/src/services/portalAi.js` | 29 |
| 46 | `backend/src/services/supabaseAuth.js` | 37 |
| 47 | `backend/src/services/verification.js` | 21 |
| 48 | `backend/src/sessionAuth.js` | 8 |
| 49 | `backend/src/settingsSnapshot.js` | 7 |
| 50 | `backend/src/storage/organizationFolders.js` | 5 |
| 51 | `backend/src/systemFsWorker.js` | 7 |
| 52 | `backend/src/uploadReferenceCleanup.js` | 2 |
| 53 | `backend/src/uploadSecurity.js` | 7 |
| 54 | `backend/src/websocket.js` | 1 |
| 55 | `backend/test/accessControl.test.js` | 2 |
| 56 | `backend/test/authOtpGuards.test.js` | 1 |
| 57 | `backend/test/authSecurityFlow.test.js` | 8 |
| 58 | `backend/test/backupRoundtrip.test.js` | 12 |
| 59 | `backend/test/backupSchema.test.js` | 1 |
| 60 | `backend/test/configOrganizationRuntime.test.js` | 2 |
| 61 | `backend/test/contactOptions.test.js` | 1 |
| 62 | `backend/test/dataPath.test.js` | 2 |
| 63 | `backend/test/fileRouteSecurityFlow.test.js` | 9 |
| 64 | `backend/test/idempotency.test.js` | 1 |
| 65 | `backend/test/netSecurity.test.js` | 1 |
| 66 | `backend/test/portalUtils.test.js` | 1 |
| 67 | `backend/test/productImportPolicies.test.js` | 1 |
| 68 | `backend/test/serverUtils.test.js` | 1 |
| 69 | `backend/test/stockConsistency.test.js` | 26 |
| 70 | `backend/test/uploadSecurity.test.js` | 1 |
| 71 | `frontend/postcss.config.mjs` | 0 |
| 72 | `frontend/public/sw.js` | 3 |
| 73 | `frontend/public/theme-bootstrap.js` | 1 |
| 74 | `frontend/src/api/http.js` | 43 |
| 75 | `frontend/src/api/localDb.js` | 10 |
| 76 | `frontend/src/api/methods.js` | 151 |
| 77 | `frontend/src/api/websocket.js` | 7 |
| 78 | `frontend/src/App.jsx` | 37 |
| 79 | `frontend/src/app/appShellUtils.mjs` | 4 |
| 80 | `frontend/src/AppContext.jsx` | 40 |
| 81 | `frontend/src/components/auth/Login.jsx` | 21 |
| 82 | `frontend/src/components/branches/Branches.jsx` | 9 |
| 83 | `frontend/src/components/branches/BranchForm.jsx` | 3 |
| 84 | `frontend/src/components/branches/TransferModal.jsx` | 3 |
| 85 | `frontend/src/components/catalog/CatalogPage.jsx` | 73 |
| 86 | `frontend/src/components/catalog/CatalogProductsSection.jsx` | 1 |
| 87 | `frontend/src/components/catalog/CatalogSecondaryTabs.jsx` | 5 |
| 88 | `frontend/src/components/catalog/catalogUi.jsx` | 4 |
| 89 | `frontend/src/components/catalog/portalEditorUtils.mjs` | 8 |
| 90 | `frontend/src/components/contacts/contactOptionUtils.js` | 9 |
| 91 | `frontend/src/components/contacts/Contacts.jsx` | 8 |
| 92 | `frontend/src/components/contacts/CustomersTab.jsx` | 21 |
| 93 | `frontend/src/components/contacts/DeliveryTab.jsx` | 23 |
| 94 | `frontend/src/components/contacts/shared.jsx` | 17 |
| 95 | `frontend/src/components/contacts/SuppliersTab.jsx` | 15 |
| 96 | `frontend/src/components/custom-tables/CustomTables.jsx` | 11 |
| 97 | `frontend/src/components/dashboard/charts/BarChart.jsx` | 2 |
| 98 | `frontend/src/components/dashboard/charts/DonutChart.jsx` | 1 |
| 99 | `frontend/src/components/dashboard/charts/index.js` | 0 |
| 100 | `frontend/src/components/dashboard/charts/LineChart.jsx` | 4 |
| 101 | `frontend/src/components/dashboard/charts/NoData.jsx` | 1 |
| 102 | `frontend/src/components/dashboard/Dashboard.jsx` | 6 |
| 103 | `frontend/src/components/dashboard/MiniStat.jsx` | 1 |
| 104 | `frontend/src/components/files/FilePickerModal.jsx` | 6 |
| 105 | `frontend/src/components/files/FilesPage.jsx` | 17 |
| 106 | `frontend/src/components/inventory/DualMoney.jsx` | 1 |
| 107 | `frontend/src/components/inventory/Inventory.jsx` | 10 |
| 108 | `frontend/src/components/inventory/InventoryImportModal.jsx` | 6 |
| 109 | `frontend/src/components/inventory/movementGroups.js` | 6 |
| 110 | `frontend/src/components/inventory/ProductDetailModal.jsx` | 2 |
| 111 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | 8 |
| 112 | `frontend/src/components/navigation/Sidebar.jsx` | 6 |
| 113 | `frontend/src/components/pos/CartItem.jsx` | 1 |
| 114 | `frontend/src/components/pos/FilterPanel.jsx` | 5 |
| 115 | `frontend/src/components/pos/POS.jsx` | 22 |
| 116 | `frontend/src/components/pos/posCore.mjs` | 8 |
| 117 | `frontend/src/components/pos/ProductImage.jsx` | 1 |
| 118 | `frontend/src/components/pos/QuickAddModal.jsx` | 2 |
| 119 | `frontend/src/components/products/BarcodeScannerModal.jsx` | 5 |
| 120 | `frontend/src/components/products/barcodeScannerState.mjs` | 1 |
| 121 | `frontend/src/components/products/BranchStockAdjuster.jsx` | 4 |
| 122 | `frontend/src/components/products/BulkAddStockModal.jsx` | 2 |
| 123 | `frontend/src/components/products/BulkImportModal.jsx` | 16 |
| 124 | `frontend/src/components/products/HeaderActions.jsx` | 2 |
| 125 | `frontend/src/components/products/ManageBrandsModal.jsx` | 8 |
| 126 | `frontend/src/components/products/ManageCategoriesModal.jsx` | 4 |
| 127 | `frontend/src/components/products/ManageUnitsModal.jsx` | 5 |
| 128 | `frontend/src/components/products/primitives.jsx` | 9 |
| 129 | `frontend/src/components/products/ProductDetailModal.jsx` | 3 |
| 130 | `frontend/src/components/products/ProductForm.jsx` | 17 |
| 131 | `frontend/src/components/products/Products.jsx` | 25 |
| 132 | `frontend/src/components/products/VariantFormModal.jsx` | 5 |
| 133 | `frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | 4 |
| 134 | `frontend/src/components/receipt-settings/constants.js` | 2 |
| 135 | `frontend/src/components/receipt-settings/ErrorBoundary.jsx` | 0 |
| 136 | `frontend/src/components/receipt-settings/FieldOrderManager.jsx` | 9 |
| 137 | `frontend/src/components/receipt-settings/PrintSettings.jsx` | 8 |
| 138 | `frontend/src/components/receipt-settings/ReceiptPreview.jsx` | 2 |
| 139 | `frontend/src/components/receipt-settings/ReceiptSettings.jsx` | 4 |
| 140 | `frontend/src/components/receipt-settings/template.js` | 2 |
| 141 | `frontend/src/components/receipt/Receipt.jsx` | 8 |
| 142 | `frontend/src/components/returns/EditReturnModal.jsx` | 5 |
| 143 | `frontend/src/components/returns/NewReturnModal.jsx` | 10 |
| 144 | `frontend/src/components/returns/NewSupplierReturnModal.jsx` | 6 |
| 145 | `frontend/src/components/returns/ReturnDetailModal.jsx` | 3 |
| 146 | `frontend/src/components/returns/Returns.jsx` | 8 |
| 147 | `frontend/src/components/sales/ExportModal.jsx` | 9 |
| 148 | `frontend/src/components/sales/SaleDetailModal.jsx` | 6 |
| 149 | `frontend/src/components/sales/Sales.jsx` | 10 |
| 150 | `frontend/src/components/sales/SalesImportModal.jsx` | 7 |
| 151 | `frontend/src/components/sales/StatusBadge.jsx` | 2 |
| 152 | `frontend/src/components/server/ServerPage.jsx` | 15 |
| 153 | `frontend/src/components/shared/ExportMenu.jsx` | 1 |
| 154 | `frontend/src/components/shared/FilterMenu.jsx` | 2 |
| 155 | `frontend/src/components/shared/ImageGalleryLightbox.jsx` | 5 |
| 156 | `frontend/src/components/shared/Modal.jsx` | 1 |
| 157 | `frontend/src/components/shared/navigationConfig.js` | 2 |
| 158 | `frontend/src/components/shared/NotificationCenter.jsx` | 6 |
| 159 | `frontend/src/components/shared/pageActivity.js` | 1 |
| 160 | `frontend/src/components/shared/PageHeader.jsx` | 1 |
| 161 | `frontend/src/components/shared/PageHelpButton.jsx` | 1 |
| 162 | `frontend/src/components/shared/pageHelpContent.js` | 1 |
| 163 | `frontend/src/components/shared/PortalMenu.jsx` | 6 |
| 164 | `frontend/src/components/shared/QuickPreferenceToggles.jsx` | 3 |
| 165 | `frontend/src/components/shared/WriteConflictModal.jsx` | 5 |
| 166 | `frontend/src/components/users/PermissionEditor.jsx` | 4 |
| 167 | `frontend/src/components/users/UserDetailSheet.jsx` | 3 |
| 168 | `frontend/src/components/users/UserProfileModal.jsx` | 22 |
| 169 | `frontend/src/components/users/Users.jsx` | 15 |
| 170 | `frontend/src/components/utils-settings/AuditLog.jsx` | 12 |
| 171 | `frontend/src/components/utils-settings/Backup.jsx` | 37 |
| 172 | `frontend/src/components/utils-settings/FontFamilyPicker.jsx` | 1 |
| 173 | `frontend/src/components/utils-settings/index.js` | 0 |
| 174 | `frontend/src/components/utils-settings/OtpModal.jsx` | 2 |
| 175 | `frontend/src/components/utils-settings/ResetData.jsx` | 8 |
| 176 | `frontend/src/components/utils-settings/Settings.jsx` | 20 |
| 177 | `frontend/src/constants.js` | 3 |
| 178 | `frontend/src/index.jsx` | 13 |
| 179 | `frontend/src/platform/runtime/clientRuntime.js` | 15 |
| 180 | `frontend/src/platform/storage/storagePolicy.mjs` | 3 |
| 181 | `frontend/src/utils/appRefresh.js` | 1 |
| 182 | `frontend/src/utils/color.js` | 3 |
| 183 | `frontend/src/utils/csv.js` | 11 |
| 184 | `frontend/src/utils/csvImport.js` | 4 |
| 185 | `frontend/src/utils/dateHelpers.js` | 2 |
| 186 | `frontend/src/utils/deviceInfo.js` | 2 |
| 187 | `frontend/src/utils/exportPackage.js` | 2 |
| 188 | `frontend/src/utils/exportReports.jsx` | 9 |
| 189 | `frontend/src/utils/favicon.js` | 3 |
| 190 | `frontend/src/utils/formatters.js` | 4 |
| 191 | `frontend/src/utils/groupedRecords.mjs` | 9 |
| 192 | `frontend/src/utils/index.js` | 0 |
| 193 | `frontend/src/utils/loaders.mjs` | 8 |
| 194 | `frontend/src/utils/pricing.js` | 4 |
| 195 | `frontend/src/utils/printReceipt.js` | 34 |
| 196 | `frontend/src/web-api.js` | 4 |
| 197 | `frontend/tailwind.config.mjs` | 0 |
| 198 | `frontend/tests/appShellUtils.test.mjs` | 1 |
| 199 | `frontend/tests/barcodeScannerState.test.mjs` | 1 |
| 200 | `frontend/tests/csvImport.test.mjs` | 1 |
| 201 | `frontend/tests/exportPackages.test.mjs` | 1 |
| 202 | `frontend/tests/groupedRecords.test.mjs` | 1 |
| 203 | `frontend/tests/loaders.test.mjs` | 1 |
| 204 | `frontend/tests/portalEditorUtils.test.mjs` | 1 |
| 205 | `frontend/tests/posCore.test.mjs` | 1 |
| 206 | `frontend/tests/pricingContacts.test.mjs` | 1 |
| 207 | `frontend/tests/receiptTemplate.test.mjs` | 1 |
| 208 | `frontend/tests/storagePolicy.test.mjs` | 1 |
| 209 | `frontend/vite.config.mjs` | 2 |
| 210 | `ops/scripts/backend/verify-data-integrity.js` | 10 |
| 211 | `ops/scripts/frontend/verify-i18n.js` | 6 |
| 212 | `ops/scripts/generate-doc-reference.js` | 18 |
| 213 | `ops/scripts/generate-full-project-docs.js` | 26 |
| 214 | `ops/scripts/lib/fs-utils.js` | 8 |
| 215 | `ops/scripts/performance-scan.js` | 3 |
| 216 | `ops/scripts/verify-runtime-deps.js` | 4 |

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
| 12 | `closeDatabase` | function | 203 |
| 13 | `registerShutdownHandlers` | function | 210 |
| 14 | `bootstrapServer` | function | 228 |

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

### 3.3 `backend/src/authOtpGuards.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeUserId` | function | 5 |
| 2 | `canManageOtpTarget` | function | 10 |
| 3 | `requiresSelfOtpDisablePassword` | function | 20 |

### 3.4 `backend/src/backupSchema.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `countRowsByTable` | function | 61 |
| 2 | `countCustomTableRows` | function | 69 |
| 3 | `buildBackupSummary` | function | 75 |

### 3.5 `backend/src/config/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isDefaultDataMarker` | function | 49 |
| 2 | `resolveStoredDataDir` | function | 54 |
| 3 | `normalizeSelectedDataDir` | function | 61 |
| 4 | `readDataLocation` | function | 73 |
| 5 | `writeDataLocation` | function | 84 |
| 6 | `pathExists` | function | 100 |
| 7 | `normalizeOrganizationSeed` | function | 104 |
| 8 | `readPrimaryOrganizationSeed` | function | 111 |
| 9 | `ensureDirectory` | function | 143 |
| 10 | `copyTree` | function | 147 |
| 11 | `normalizePathForCompare` | function | 162 |
| 12 | `isSamePath` | function | 166 |
| 13 | `isOrganizationRuntimeRoot` | function | 170 |
| 14 | `ensureOrganizationRuntimeLayout` | function | 175 |
| 15 | `writeMigrationMarker` | function | 181 |
| 16 | `moveOrganizationRootPreservingSource` | function | 191 |
| 17 | `migrateLegacySharedRootToOrganization` | function | 222 |
| 18 | `detectExistingOrganizationRuntimeRoot` | function | 242 |
| 19 | `STORAGE_ROOT` | const arrow | 254 |
| 20 | `PRIMARY_ORGANIZATION_SEED` | const arrow | 262 |
| 21 | `DATA_ROOT` | const arrow | 286 |

### 3.6 `backend/src/conflictControl.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `WriteConflictError` | class | 3 |
| 2 | `normalizeUpdatedAt` | function | 17 |
| 3 | `getExpectedUpdatedAt` | function | 22 |
| 4 | `assertUpdatedAtMatch` | function | 31 |
| 5 | `sendWriteConflict` | function | 43 |

### 3.7 `backend/src/contactOptions.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cleanText` | function | 5 |
| 2 | `normalizeContactOption` | function | 10 |
| 3 | `hasContactOptionData` | function | 21 |
| 4 | `parseStoredContactOptions` | function | 28 |
| 5 | `parseImportContactOptions` | function | 56 |
| 6 | `serializeContactOptions` | function | 72 |
| 7 | `getPrimaryContactOption` | function | 80 |
| 8 | `buildImportedContactState` | function | 85 |

### 3.8 `backend/src/database.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `tableHasColumn` | function | 685 |
| 2 | `ensureColumn` | function | 695 |
| 3 | `normalizeUserPhoneLookup` | function | 716 |
| 4 | `slugifyOrgName` | function | 721 |
| 5 | `generateOrgPublicId` | function | 730 |
| 6 | `seedIfEmpty` | function | 859 |
| 7 | `ensureDefaultOrganizationAndGroup` | function | 870 |
| 8 | `ensurePrimaryAdminRoleAndUser` | function | 942 |
| 9 | `buildDefaultSettingsSeed` | function | 993 |
| 10 | `ensureDefaultSettings` | function | 1115 |
| 11 | `ensureDefaultBranches` | function | 1126 |
| 12 | `ensureDefaultUnits` | function | 1132 |
| 13 | `ensureCoreDataInvariants` | function | 1138 |

### 3.9 `backend/src/dataPath/index.js`

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

### 3.10 `backend/src/fileAssets.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ensureUploadsDirectory` | function | 46 |
| 2 | `getMimeTypeFromName` | function | 50 |
| 3 | `getMediaType` | function | 55 |
| 4 | `sanitizeOriginalFileName` | function | 64 |
| 5 | `preserveOriginalDisplayName` | function | 77 |
| 6 | `buildUniqueStoredName` | function | 85 |
| 7 | `shouldCompressImage` | function | 99 |
| 8 | `compressBufferForAsset` | function | 105 |
| 9 | `readImageDimensions` | function | 121 |
| 10 | `createFileAssetRecord` | function | 134 |
| 11 | `getFileAssetByPublicPath` | function | 194 |
| 12 | `listAssetRows` | function | 203 |
| 13 | `getUploadFilePath` | function | 225 |
| 14 | `collectUsage` | function | 230 |
| 15 | `serializeAssetRow` | function | 259 |
| 16 | `registerStoredAsset` | function | 269 |
| 17 | `registerUploadFromRequest` | function | 297 |
| 18 | `storeDataUrlAsset` | function | 309 |
| 19 | `backfillUploadAssets` | function | 331 |
| 20 | `listFileAssets` | function | 349 |
| 21 | `getFileAssetById` | function | 355 |
| 22 | `deleteFileAsset` | function | 360 |

### 3.11 `backend/src/helpers.js`

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
| 9 | `parseCSVRows` | function | 138 |
| 10 | `bulkImportCSV` | function | 162 |
| 11 | `parseCSVLine` | function | 188 |
| 12 | `importRows` | function | 208 |
| 13 | `verifyAndRepairStockQuantities` | function | 223 |
| 14 | `verifyAndRepairSaleStatuses` | function | 281 |
| 15 | `verifyAndRepairCostPrices` | function | 341 |
| 16 | `runDataIntegrityCheck` | function | 423 |
| 17 | `getSafeCostPrice` | function | 450 |
| 18 | `calculateSaleProfit` | function | 461 |

### 3.12 `backend/src/idempotency.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeClientRequestId` | function | 3 |

### 3.13 `backend/src/middleware.js`

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
| 12 | `parsePermissionsValue` | function | 193 |
| 13 | `getMergedPermissions` | function | 203 |
| 14 | `isAdminControlUser` | function | 210 |
| 15 | `hasPermission` | function | 218 |
| 16 | `requirePermission` | function | 225 |
| 17 | `requireAnyPermission` | function | 237 |
| 18 | `getAuditActor` | function | 250 |
| 19 | `compressUpload` | function | 263 |
| 20 | `validateUploadedFile` | function | 268 |
| 21 | `validateUploadBufferPayload` | function | 279 |

### 3.14 `backend/src/money.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toFiniteNumber` | function | 3 |
| 2 | `roundUpToDecimals` | function | 8 |
| 3 | `normalizePriceValue` | function | 17 |

### 3.15 `backend/src/netSecurity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 26 |
| 2 | `normalizeHostname` | function | 30 |
| 3 | `isPrivateIpv4` | function | 34 |
| 4 | `isPrivateIpv6` | function | 47 |
| 5 | `isBlockedHostname` | function | 58 |
| 6 | `assertSafeOutboundUrl` | function | 69 |
| 7 | `isSafeExternalImageReference` | function | 97 |

### 3.16 `backend/src/organizationContext/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 11 |
| 2 | `slugify` | function | 15 |
| 3 | `generateOrganizationPublicId` | function | 23 |
| 4 | `getDefaultOrganization` | function | 27 |
| 5 | `getOrganizationById` | function | 36 |
| 6 | `findOrganizationByLookup` | function | 45 |
| 7 | `searchOrganizations` | function | 60 |
| 8 | `getOrganizationGroup` | function | 93 |
| 9 | `getDefaultOrganizationGroup` | function | 103 |
| 10 | `getOrganizationContextForUser` | function | 115 |
| 11 | `getPortalPublicPath` | function | 133 |
| 12 | `getOrganizationFilesystemLayout` | function | 138 |
| 13 | `ensureOrganizationFilesystemLayout` | function | 158 |
| 14 | `getOrganizationStorageStatus` | function | 226 |

### 3.17 `backend/src/portalUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toTrimmedString` | function | 5 |
| 2 | `safeJsonParse` | function | 9 |
| 3 | `createAboutBlock` | function | 17 |
| 4 | `normalizeAboutBlocks` | function | 28 |
| 5 | `extractGoogleMapsEmbedUrl` | function | 47 |
| 6 | `normalizeGoogleMapsEmbed` | function | 55 |

### 3.18 `backend/src/productImportPolicies.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseImportNumber` | function | 3 |
| 2 | `parseImportFlag` | function | 16 |
| 3 | `hasImportValue` | function | 25 |
| 4 | `normalizeFieldRule` | function | 30 |
| 5 | `resolveImportValue` | function | 37 |
| 6 | `normalizeImageConflictMode` | function | 50 |

### 3.19 `backend/src/requestContext.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cleanText` | function | 7 |
| 2 | `readHeader` | function | 13 |
| 3 | `extractRequestMeta` | function | 19 |
| 4 | `requestContextMiddleware` | function | 45 |
| 5 | `getRequestMeta` | function | 50 |

### 3.20 `backend/src/routes/ai.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `listProviders` | function | 19 |
| 2 | `getProviderRow` | function | 28 |

### 3.21 `backend/src/routes/auth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getClientKey` | function | 90 |
| 2 | `applyRateLimit` | function | 103 |
| 3 | `getLoginLockKey` | function | 115 |
| 4 | `isReasonableCredentialLength` | function | 119 |
| 5 | `normalizeLookupText` | function | 124 |
| 6 | `isHttpUrl` | function | 128 |
| 7 | `buildPublicBaseUrl` | function | 132 |
| 8 | `resolvePasswordResetRedirect` | function | 139 |
| 9 | `loginIdentifierPreview` | function | 153 |
| 10 | `rejectLogin` | function | 167 |
| 11 | `getOtpSecret` | function | 189 |
| 12 | `requireOtpActor` | function | 193 |
| 13 | `getOtpTargetUser` | function | 199 |
| 14 | `buildUserPayload` | function | 214 |
| 15 | `resolveOrganizationLookup` | function | 246 |
| 16 | `findUserByIdentifier` | function | 252 |
| 17 | `getExactActiveUserById` | function | 321 |
| 18 | `normalizeOauthMode` | function | 336 |
| 19 | `isEmailIdentifier` | function | 341 |
| 20 | `getUserById` | function | 345 |
| 21 | `getSettingsSnapshot` | function | 349 |
| 22 | `getBootstrapSystemSnapshot` | function | 358 |
| 23 | `buildAuthenticatedBootstrap` | function | 390 |
| 24 | `generateTemporaryAuthPassword` | function | 419 |
| 25 | `issueAuthSession` | function | 423 |
| 26 | `updateLocalUserSupabaseIdentity` | function | 434 |

### 3.22 `backend/src/routes/branches.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toDbBool` | function | 10 |
| 2 | `getStockTransferNoteColumn` | function | 18 |

### 3.23 `backend/src/routes/catalog.js`

- No top-level named symbols detected.

### 3.24 `backend/src/routes/categories.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLookup` | function | 11 |
| 2 | `normalizeColor` | function | 15 |

### 3.25 `backend/src/routes/contacts.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cleanMembershipNumber` | function | 19 |
| 2 | `requireMembershipNumber` | function | 23 |
| 3 | `assertUniqueMembershipNumber` | function | 29 |
| 4 | `ensureMembershipNumber` | function | 43 |
| 5 | `normalizeFieldRule` | function | 48 |
| 6 | `resolveFieldValue` | function | 55 |
| 7 | `buildImportRows` | function | 66 |
| 8 | `normalizeConflictMode` | function | 76 |
| 9 | `toNumber` | function | 81 |
| 10 | `loadPointPolicy` | function | 86 |
| 11 | `calculatePolicyPoints` | function | 112 |
| 12 | `findExisting` | const arrow | 271 |
| 13 | `findExisting` | const arrow | 481 |
| 14 | `findExisting` | const arrow | 665 |

### 3.26 `backend/src/routes/customTables.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `humanizeTableName` | function | 11 |
| 2 | `serializeCustomTable` | function | 20 |
| 3 | `sanitizeCustomTableName` | function | 28 |
| 4 | `resolveCustomTableRow` | function | 34 |
| 5 | `escapeIdentifier` | function | 43 |
| 6 | `normalizeCustomTableSchema` | function | 47 |
| 7 | `tableHasColumn` | function | 68 |
| 8 | `ensureCustomTableRowVersioning` | function | 73 |

### 3.27 `backend/src/routes/files.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseFileAssetId` | function | 18 |
| 2 | `getFileListFilters` | function | 26 |
| 3 | `getDeviceMeta` | function | 38 |

### 3.28 `backend/src/routes/inventory.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeImportedTimestamp` | function | 9 |
| 2 | `getBranchQty` | const arrow | 43 |

### 3.29 `backend/src/routes/notifications.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeBoolean` | function | 19 |
| 2 | `toNumber` | function | 27 |
| 3 | `loadNotificationPreferences` | function | 32 |
| 4 | `loadPointPolicy` | function | 55 |
| 5 | `calculatePolicyPoints` | function | 81 |
| 6 | `buildInventorySection` | function | 86 |
| 7 | `buildSalesSection` | function | 162 |
| 8 | `buildLoyaltySection` | function | 229 |
| 9 | `buildPortalSection` | function | 316 |
| 10 | `buildSystemSection` | function | 353 |

### 3.30 `backend/src/routes/organizations.js`

- No top-level named symbols detected.

### 3.31 `backend/src/routes/portal.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toNumber` | function | 23 |
| 2 | `normalizeBoolean` | function | 29 |
| 3 | `normalizePhone` | function | 35 |
| 4 | `normalizePublicPath` | function | 40 |
| 5 | `normalizeUrl` | function | 54 |
| 6 | `normalizeRedeemValueUsd` | function | 69 |
| 7 | `normalizeRedeemValueKhr` | function | 74 |
| 8 | `normalizeHexColor` | function | 81 |
| 9 | `normalizeFaqItems` | function | 87 |
| 10 | `loadSettingsMap` | function | 101 |
| 11 | `buildPortalConfig` | function | 109 |
| 12 | `calculatePointsValue` | function | 227 |
| 13 | `summarizePoints` | function | 237 |
| 14 | `getPortalProducts` | function | 277 |
| 15 | `findCustomerByMembership` | function | 335 |
| 16 | `sanitizeScreenshots` | function | 345 |
| 17 | `materializePortalScreenshots` | function | 354 |
| 18 | `sanitizeAiProfile` | function | 372 |
| 19 | `getVisitorFingerprint` | function | 384 |
| 20 | `getClientKey` | function | 390 |
| 21 | `applyPortalRateLimit` | function | 395 |

### 3.32 `backend/src/routes/products.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getActiveBranches` | function | 26 |
| 2 | `getDefaultBranch` | function | 30 |
| 3 | `seedBranchRows` | function | 34 |
| 4 | `recalcProductStock` | function | 39 |
| 5 | `normalizeImageGallery` | function | 48 |
| 6 | `syncProductImageGallery` | function | 55 |
| 7 | `loadProductImageMap` | function | 73 |
| 8 | `attachImageGallery` | function | 91 |
| 9 | `findProductByClientRequestId` | function | 103 |
| 10 | `assertUniqueProductFields` | function | 113 |
| 11 | `hasOwnField` | function | 140 |
| 12 | `pickField` | function | 144 |
| 13 | `ensureParentProductExists` | function | 148 |
| 14 | `markParentProductAsGroup` | function | 158 |
| 15 | `normalizeLookup` | const arrow | 544 |
| 16 | `resolveImage` | const arrow | 641 |
| 17 | `ensureCategory` | const arrow | 657 |
| 18 | `ensureUnit` | const arrow | 671 |
| 19 | `ensureBrand` | const arrow | 685 |
| 20 | `ensureSupplier` | const arrow | 697 |
| 21 | `determineBranch` | const arrow | 708 |
| 22 | `handleBranch` | const arrow | 727 |
| 23 | `isDirectImageRef` | const arrow | 752 |
| 24 | `normalizeDirectImageRef` | const arrow | 763 |
| 25 | `parseIncomingImageRefs` | const arrow | 770 |
| 26 | `loadCurrentGallery` | const arrow | 803 |

### 3.33 `backend/src/routes/returns.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `refreshProductStockQuantity` | function | 13 |
| 2 | `refreshProductStockQuantities` | function | 26 |
| 3 | `normalizeScope` | function | 36 |
| 4 | `toNumber` | function | 44 |
| 5 | `findReturnByClientRequestId` | function | 49 |
| 6 | `assertReturnableItems` | function | 59 |
| 7 | `assertSupplierReturnableStock` | function | 374 |

### 3.34 `backend/src/routes/sales.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeImportedTimestamp` | function | 11 |
| 2 | `getSaleItemCosts` | function | 19 |
| 3 | `assertSaleStockAvailable` | function | 45 |
| 4 | `findCustomerForSaleAssignment` | function | 74 |
| 5 | `parseBranchId` | function | 95 |
| 6 | `getActiveBranchContext` | function | 100 |
| 7 | `requireActiveBranch` | function | 115 |
| 8 | `resolveSaleItemBranchId` | function | 122 |
| 9 | `normalizeSaleItems` | function | 133 |
| 10 | `summarizeSaleBranch` | function | 163 |
| 11 | `refreshProductStockQuantity` | function | 187 |
| 12 | `refreshProductStockQuantities` | function | 200 |
| 13 | `fetchSaleItemsWithBranches` | function | 207 |
| 14 | `findSaleByClientRequestId` | function | 216 |

### 3.35 `backend/src/routes/settings.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLookup` | function | 11 |
| 2 | `normalizeBrandOptionsValue` | function | 15 |
| 3 | `settingsHasUpdatedAt` | function | 39 |
| 4 | `getSettingsSnapshot` | function | 48 |
| 5 | `getSettingsUpdatedAt` | function | 55 |

### 3.36 `backend/src/routes/system/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `q` | function | 64 |
| 2 | `getClientKey` | function | 68 |
| 3 | `applyRouteRateLimit` | function | 74 |
| 4 | `runFsWorker` | function | 86 |
| 5 | `finish` | const arrow | 98 |
| 6 | `getHostUiAvailability` | function | 142 |
| 7 | `buildRequestBaseUrl` | function | 151 |
| 8 | `resolveDriveRedirectUri` | function | 158 |
| 9 | `getTableColumns` | function | 165 |
| 10 | `extractUploadPathsFromText` | function | 169 |
| 11 | `collectBackupUploads` | function | 178 |
| 12 | `addUpload` | const arrow | 182 |
| 13 | `restoreBackupUploads` | function | 212 |
| 14 | `deleteAllUploads` | function | 222 |
| 15 | `getBackupDataRootCandidate` | function | 231 |
| 16 | `readBackupTablesFromDataRoot` | function | 243 |
| 17 | `restoreUploadsFromDataRoot` | function | 276 |
| 18 | `restoreSnapshotTables` | function | 290 |
| 19 | `replaceTableRows` | function | 346 |
| 20 | `normaliseBackupTables` | function | 381 |
| 21 | `normaliseBackupCustomTableRows` | function | 410 |
| 22 | `repairRelationalConsistency` | function | 415 |
| 23 | `getCustomTableNames` | function | 423 |
| 24 | `parseCustomTableDefinition` | function | 429 |
| 25 | `recreateCustomTable` | function | 472 |
| 26 | `listWindowsFsRoots` | const arrow | 1062 |
| 27 | `listDriveRoots` | const arrow | 1079 |

### 3.37 `backend/src/routes/units.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLookup` | function | 12 |
| 2 | `normalizeUnitColor` | function | 16 |
| 3 | `updateUnitHandler` | function | 50 |

### 3.38 `backend/src/routes/users.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getClientKey` | function | 49 |
| 2 | `parseJson` | function | 55 |
| 3 | `normalizeLookupText` | function | 63 |
| 4 | `normalizePhoneLookup` | function | 67 |
| 5 | `findUserIdentityConflict` | function | 71 |
| 6 | `getMergedPermissions` | function | 139 |
| 7 | `isPrimaryAdmin` | function | 148 |
| 8 | `hasAdminControl` | function | 155 |
| 9 | `canManageTarget` | function | 168 |
| 10 | `getActorFromRequest` | function | 181 |
| 11 | `requireAdminControl` | function | 188 |
| 12 | `getUserSecurityContext` | function | 201 |
| 13 | `getUserWithRole` | function | 211 |
| 14 | `syncLocalEmailVerification` | function | 226 |
| 15 | `repairSupabaseIdentityForUser` | function | 257 |
| 16 | `sanitizeUserRow` | function | 286 |
| 17 | `isValidEmail` | function | 302 |
| 18 | `getAuthIdentityList` | function | 307 |
| 19 | `isUuid` | function | 313 |
| 20 | `resolveAuthIdentityUuid` | function | 317 |
| 21 | `buildAuthMethodsPayload` | function | 326 |

### 3.39 `backend/src/runtimeState/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ensureRuntimeMetaDir` | function | 11 |
| 2 | `readRuntimeState` | function | 15 |
| 3 | `writeRuntimeState` | function | 32 |
| 4 | `getRuntimeState` | function | 38 |
| 5 | `bumpStorageVersion` | function | 48 |
| 6 | `buildRuntimeDescriptor` | function | 57 |

### 3.40 `backend/src/security.js`

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

### 3.41 `backend/src/serverUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseOriginHost` | function | 13 |
| 2 | `normalizeConfiguredHost` | function | 23 |
| 3 | `isAllowedRequestOrigin` | function | 33 |
| 4 | `isAllowedWebSocketOrigin` | function | 43 |
| 5 | `hostIsLoopbackPair` | function | 61 |
| 6 | `sanitizeObjectKeys` | function | 85 |
| 7 | `sanitizeStringValue` | function | 104 |
| 8 | `sanitizeRequestPayload` | function | 110 |
| 9 | `sanitizeDeepStrings` | function | 117 |
| 10 | `isApiOrHealthPath` | function | 134 |
| 11 | `isSpaFallbackEligible` | function | 138 |
| 12 | `setNoStoreHeaders` | function | 146 |
| 13 | `setHtmlNoCacheHeaders` | function | 150 |
| 14 | `setTunnelSecurityHeaders` | function | 156 |
| 15 | `setFrontendStaticHeaders` | function | 191 |
| 16 | `setUploadStaticHeaders` | function | 209 |
| 17 | `mapServerError` | function | 216 |

### 3.42 `backend/src/services/aiGateway.js`

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

### 3.43 `backend/src/services/firebaseAuth.js`

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

### 3.44 `backend/src/services/googleDriveSync/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 53 |
| 2 | `trim` | function | 57 |
| 3 | `toBool` | function | 61 |
| 4 | `clamp` | function | 69 |
| 5 | `escapeDriveQueryValue` | function | 75 |
| 6 | `readSettingsMap` | function | 79 |
| 7 | `writeSettingsMap` | function | 89 |
| 8 | `clearDriveSyncMappings` | function | 107 |
| 9 | `resetDriveSyncRootState` | function | 111 |
| 10 | `getDriveSyncConfig` | function | 118 |
| 11 | `getDriveSyncEntriesMap` | function | 145 |
| 12 | `upsertDriveSyncEntry` | function | 156 |
| 13 | `deleteDriveSyncEntry` | function | 182 |
| 14 | `deleteDriveSyncEntriesUnder` | function | 186 |
| 15 | `inferMimeType` | function | 193 |
| 16 | `md5File` | function | 208 |
| 17 | `buildMultipartBody` | function | 214 |
| 18 | `exchangeRefreshToken` | function | 231 |
| 19 | `exchangeAuthorizationCode` | function | 250 |
| 20 | `driveApiRequest` | function | 273 |
| 21 | `driveApiUpload` | function | 290 |
| 22 | `fetchDriveUserProfile` | function | 306 |
| 23 | `findDriveItem` | function | 321 |
| 24 | `findDriveItems` | function | 326 |
| 25 | `listDriveChildren` | function | 341 |
| 26 | `getDriveFileIfExists` | function | 350 |
| 27 | `removeDuplicateDriveItems` | function | 362 |
| 28 | `createDriveFolder` | function | 374 |
| 29 | `ensureRootFolder` | function | 386 |
| 30 | `buildManagedSnapshotRoot` | function | 405 |
| 31 | `ensureSnapshotLayout` | function | 409 |
| 32 | `shouldSkipSnapshotFile` | function | 415 |
| 33 | `createDataRootSnapshot` | function | 420 |
| 34 | `collectSnapshotItems` | function | 450 |
| 35 | `ensureRemoteDirectories` | function | 479 |
| 36 | `uploadDriveFile` | function | 514 |
| 37 | `updateDriveFile` | function | 529 |
| 38 | `removeDriveFile` | function | 540 |
| 39 | `runDriveSync` | function | 552 |
| 40 | `scheduleDriveSync` | function | 706 |
| 41 | `getDriveSyncStatus` | function | 729 |
| 42 | `beginGoogleDriveOAuth` | function | 760 |
| 43 | `prunePendingOauthStates` | function | 779 |
| 44 | `finalizeGoogleDriveOAuth` | function | 786 |
| 45 | `saveDriveSyncPreferences` | function | 828 |
| 46 | `disconnectDriveSync` | function | 847 |
| 47 | `updateEnvSettingLines` | function | 863 |
| 48 | `forgetDriveSyncCredentials` | function | 876 |
| 49 | `schedulePeriodicDriveSync` | function | 891 |

### 3.45 `backend/src/services/portalAi.js`

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

### 3.46 `backend/src/services/supabaseAuth.js`

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

### 3.47 `backend/src/services/verification.js`

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

### 3.48 `backend/src/sessionAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `hashToken` | function | 15 |
| 2 | `buildSessionExpiry` | function | 19 |
| 3 | `createAuthSession` | function | 35 |
| 4 | `buildRevocationTimestamp` | function | 56 |
| 5 | `getPresentedSessionToken` | function | 61 |
| 6 | `getSessionUser` | function | 86 |
| 7 | `revokeAuthSession` | function | 149 |
| 8 | `revokeUserSessions` | function | 161 |

### 3.49 `backend/src/settingsSnapshot.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeUploadPublicPath` | function | 7 |
| 2 | `isUploadPublicPath` | function | 15 |
| 3 | `sanitizeMediaPath` | function | 20 |
| 4 | `sanitizeMediaList` | function | 27 |
| 5 | `uploadPublicPathExists` | function | 40 |
| 6 | `sanitizeSettingValue` | function | 52 |
| 7 | `sanitizeSettingsSnapshot` | function | 56 |

### 3.50 `backend/src/storage/organizationFolders.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 6 |
| 2 | `sanitizeOrganizationFolderLabel` | function | 10 |
| 3 | `buildOrganizationFolderName` | function | 20 |
| 4 | `extractOrganizationPublicId` | function | 26 |
| 5 | `findOrganizationFolderByPublicId` | function | 33 |

### 3.51 `backend/src/systemFsWorker.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatBackupStamp` | function | 15 |
| 2 | `pad` | const arrow | 17 |
| 3 | `respond` | function | 21 |
| 4 | `fail` | function | 25 |
| 5 | `runExportFolder` | function | 30 |
| 6 | `runRelocateDataRoot` | function | 70 |
| 7 | `main` | function | 77 |

### 3.52 `backend/src/uploadReferenceCleanup.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `safeJsonArray` | function | 10 |
| 2 | `repairMissingUploadReferences` | function | 19 |

### 3.53 `backend/src/uploadSecurity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `bufferStartsWith` | function | 11 |
| 2 | `isLikelyCsvBuffer` | function | 15 |
| 3 | `detectBufferKind` | function | 28 |
| 4 | `getExpectedUploadedKind` | function | 42 |
| 5 | `validateImageMetadata` | function | 51 |
| 6 | `validateUploadedBuffer` | function | 65 |
| 7 | `validateUploadedPath` | function | 76 |

### 3.54 `backend/src/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `attachWss` | function | 24 |

### 3.55 `backend/test/accessControl.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |
| 2 | `makeReq` | function | 22 |

### 3.56 `backend/test/authOtpGuards.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |

### 3.57 `backend/test/authSecurityFlow.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 16 |
| 2 | `makeTempRoot` | function | 34 |
| 3 | `getFreePort` | function | 38 |
| 4 | `waitForHealth` | function | 49 |
| 5 | `startServer` | function | 61 |
| 6 | `stopServer` | function | 82 |
| 7 | `fetchJson` | function | 96 |
| 8 | `login` | function | 108 |

### 3.58 `backend/test/backupRoundtrip.test.js`

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

### 3.59 `backend/test/backupSchema.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.60 `backend/test/configOrganizationRuntime.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |
| 2 | `makeTempRoot` | function | 23 |

### 3.61 `backend/test/contactOptions.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.62 `backend/test/dataPath.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 16 |
| 2 | `makeTempRoot` | function | 27 |

### 3.63 `backend/test/fileRouteSecurityFlow.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 17 |
| 2 | `makeTempRoot` | function | 37 |
| 3 | `getFreePort` | function | 41 |
| 4 | `waitForHealth` | function | 52 |
| 5 | `startServer` | function | 64 |
| 6 | `stopServer` | function | 85 |
| 7 | `fetchJson` | function | 99 |
| 8 | `login` | function | 108 |
| 9 | `buildForm` | function | 127 |

### 3.64 `backend/test/idempotency.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.65 `backend/test/netSecurity.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |

### 3.66 `backend/test/portalUtils.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.67 `backend/test/productImportPolicies.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 15 |

### 3.68 `backend/test/serverUtils.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 17 |

### 3.69 `backend/test/stockConsistency.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 21 |
| 2 | `makeTempRoot` | function | 39 |
| 3 | `getFreePort` | function | 43 |
| 4 | `waitForHealth` | function | 54 |
| 5 | `startServer` | function | 66 |
| 6 | `stopServer` | function | 87 |
| 7 | `fetchJson` | function | 101 |
| 8 | `loginAsAdmin` | function | 115 |
| 9 | `getDefaultBranch` | function | 132 |
| 10 | `createBranch` | function | 139 |
| 11 | `createProduct` | function | 158 |
| 12 | `getProduct` | function | 179 |
| 13 | `updateProduct` | function | 186 |
| 14 | `getSale` | function | 195 |
| 15 | `getInventoryMovements` | function | 202 |
| 16 | `getFiles` | function | 209 |
| 17 | `getUsers` | function | 214 |
| 18 | `getRoles` | function | 220 |
| 19 | `getSettings` | function | 226 |
| 20 | `getSettingsMeta` | function | 230 |
| 21 | `getCategories` | function | 234 |
| 22 | `getUnits` | function | 240 |
| 23 | `getAiProviders` | function | 246 |
| 24 | `uploadTinyPng` | function | 252 |
| 25 | `findDbPath` | function | 263 |
| 26 | `sumBranchStock` | function | 282 |

### 3.70 `backend/test/uploadSecurity.test.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.71 `frontend/postcss.config.mjs`

- No top-level named symbols detected.

### 3.72 `frontend/public/sw.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isSameOrigin` | function | 38 |
| 2 | `isCacheableStaticPath` | function | 46 |
| 3 | `networkFirstStatic` | function | 52 |

### 3.73 `frontend/public/theme-bootstrap.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isInjectedRuntimeNoise` | function | 5 |

### 3.74 `frontend/src/api/http.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSyncServerUrl` | export function | 39 |
| 2 | `getSyncToken` | export function | 40 |
| 3 | `getAuthSessionToken` | export function | 41 |
| 4 | `setSyncServerUrl` | export function | 43 |
| 5 | `setSyncToken` | export function | 44 |
| 6 | `setAuthSessionToken` | export function | 45 |
| 7 | `hydrateAuthTokenFromStorage` | function | 47 |
| 8 | `readAuthTokenFromStorage` | function | 59 |
| 9 | `cacheGet` | export function | 77 |
| 10 | `cacheSet` | export function | 81 |
| 11 | `cacheInvalidate` | export function | 82 |
| 12 | `cacheClearAll` | export function | 85 |
| 13 | `logCall` | function | 100 |
| 14 | `getCallLog` | export function | 105 |
| 15 | `clearCallLog` | export function | 106 |
| 16 | `getClientMetaHeaders` | function | 108 |
| 17 | `createApiError` | function | 112 |
| 18 | `createWriteBlockedError` | function | 125 |
| 19 | `dispatchWriteBlocked` | function | 135 |
| 20 | `isWriteConflictError` | export function | 149 |
| 21 | `isWriteBlockedError` | export function | 153 |
| 22 | `requireLiveServerWrite` | export function | 157 |
| 23 | `getConflictRefreshChannels` | function | 189 |
| 24 | `dispatchGlobalDataRefresh` | function | 198 |
| 25 | `sleep` | function | 207 |
| 26 | `hasUsableLocalData` | function | 211 |
| 27 | `tryServerReadWithRetry` | function | 218 |
| 28 | `resolveLocalRead` | function | 228 |
| 29 | `apiFetch` | export function | 236 |
| 30 | `parsed` | const arrow | 261 |
| 31 | `isNetErr` | export function | 299 |
| 32 | `isConnectivityError` | function | 305 |
| 33 | `isServerOnline` | export function | 324 |
| 34 | `setServerHealth` | function | 326 |
| 35 | `pingServerHealth` | function | 338 |
| 36 | `startHealthCheck` | export function | 361 |
| 37 | `cacheGetStale` | export function | 392 |
| 38 | `getChannelRefreshKey` | function | 401 |
| 39 | `emitCacheRefresh` | function | 405 |
| 40 | `clearInflight` | function | 419 |
| 41 | `hasReusableInflight` | function | 424 |
| 42 | `raceServerReadWithLocalFallback` | function | 434 |
| 43 | `route` | export function | 506 |

### 3.75 `frontend/src/api/localDb.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `localGetSettings` | export function | 107 |
| 2 | `localSaveSettings` | export function | 114 |
| 3 | `localGetSettingsMeta` | export function | 122 |
| 4 | `localSaveSettingsMeta` | export function | 126 |
| 5 | `replaceTableContents` | export function | 136 |
| 6 | `resetLocalMirrorDb` | export function | 180 |
| 7 | `clearLocalMirrorTables` | export function | 192 |
| 8 | `parseCSV` | export function | 218 |
| 9 | `splitCSVLine` | function | 231 |
| 10 | `buildCSVTemplate` | export function | 242 |

### 3.76 `frontend/src/api/methods.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDeviceInfo` | function | 3 |
| 2 | `getPortalBaseUrl` | function | 30 |
| 3 | `getCurrentUserContext` | function | 35 |
| 4 | `emitSyncQueueChanged` | function | 50 |
| 5 | `discardPendingSyncQueue` | export function | 57 |
| 6 | `createClientRequestId` | function | 75 |
| 7 | `ensureClientRequestId` | function | 82 |
| 8 | `getPendingSyncState` | export function | 88 |
| 9 | `retryPendingSyncNow` | export function | 128 |
| 10 | `invalidateClientRuntimeState` | function | 132 |
| 11 | `withExpectedUpdatedAt` | function | 148 |
| 12 | `withSettingsExpectedUpdatedAt` | function | 162 |
| 13 | `appendActorQuery` | function | 172 |
| 14 | `fetchJsonWithTimeout` | function | 185 |
| 15 | `mirrorReadResult` | function | 203 |
| 16 | `routeMirrored` | function | 212 |
| 17 | `shouldPersistLocalMirror` | function | 218 |
| 18 | `purgeSensitiveLiveServerMirrors` | function | 222 |
| 19 | `mirrorTable` | function | 233 |
| 20 | `getNotificationSummaryFallback` | function | 253 |
| 21 | `getDriveSyncStatusFallback` | function | 262 |
| 22 | `readNotificationSummaryMissingUntil` | function | 270 |
| 23 | `markNotificationSummaryMissing` | function | 282 |
| 24 | `clearNotificationSummaryMissing` | function | 297 |
| 25 | `readStorageNumber` | function | 306 |
| 26 | `writeStorageNumber` | function | 322 |
| 27 | `clearStorageNumber` | function | 333 |
| 28 | `login` | export function | 345 |
| 29 | `logout` | export function | 348 |
| 30 | `resetPasswordWithOtp` | export function | 351 |
| 31 | `requestPasswordResetEmail` | export function | 354 |
| 32 | `completePasswordReset` | export function | 357 |
| 33 | `updateSessionDuration` | export function | 360 |
| 34 | `getVerificationCapabilities` | export function | 363 |
| 35 | `getSystemConfig` | export function | 366 |
| 36 | `getNotificationSummary` | export function | 369 |
| 37 | `getSystemDebugLog` | export function | 400 |
| 38 | `startSupabaseOauth` | export function | 403 |
| 39 | `completeSupabaseOauth` | export function | 406 |
| 40 | `getAppBootstrap` | export function | 409 |
| 41 | `buildLocalBootstrap` | const arrow | 410 |
| 42 | `getOrganizationBootstrap` | export function | 462 |
| 43 | `searchOrganizations` | export function | 465 |
| 44 | `getCurrentOrganization` | export function | 469 |
| 45 | `getSettings` | export function | 474 |
| 46 | `saveSettings` | export function | 489 |
| 47 | `getCategories` | const arrow | 507 |
| 48 | `updateCategory` | const arrow | 509 |
| 49 | `deleteCategory` | const arrow | 510 |
| 50 | `getUnits` | const arrow | 513 |
| 51 | `updateUnit` | const arrow | 515 |
| 52 | `deleteUnit` | const arrow | 516 |
| 53 | `getBranches` | const arrow | 519 |
| 54 | `updateBranch` | const arrow | 521 |
| 55 | `deleteBranch` | const arrow | 525 |
| 56 | `getTransfers` | const arrow | 530 |
| 57 | `getProducts` | const arrow | 534 |
| 58 | `getCatalogMeta` | export function | 535 |
| 59 | `getCatalogProducts` | export function | 543 |
| 60 | `getPortalConfig` | export function | 551 |
| 61 | `getPortalCatalogMeta` | export function | 559 |
| 62 | `getPortalCatalogProducts` | export function | 567 |
| 63 | `lookupPortalMembership` | export function | 575 |
| 64 | `createPortalSubmission` | export function | 585 |
| 65 | `getPortalAiStatus` | export function | 599 |
| 66 | `askPortalAi` | export function | 607 |
| 67 | `getPortalSubmissionsForReview` | const arrow | 621 |
| 68 | `reviewPortalSubmission` | const arrow | 623 |
| 69 | `getAiProviders` | const arrow | 626 |
| 70 | `createAiProvider` | const arrow | 628 |
| 71 | `updateAiProvider` | const arrow | 630 |
| 72 | `deleteAiProvider` | const arrow | 632 |
| 73 | `testAiProvider` | const arrow | 634 |
| 74 | `getAiResponses` | const arrow | 636 |
| 75 | `createProduct` | export function | 638 |
| 76 | `updateProduct` | export function | 652 |
| 77 | `deleteProduct` | const arrow | 665 |
| 78 | `getFiles` | export function | 682 |
| 79 | `uploadFileAsset` | export function | 688 |
| 80 | `deleteFileAsset` | export function | 722 |
| 81 | `uploadProductImage` | export function | 734 |
| 82 | `uploadUserAvatar` | export function | 768 |
| 83 | `openCSVDialog` | export function | 809 |
| 84 | `openImageDialog` | export function | 829 |
| 85 | `getImageDataUrl` | export function | 837 |
| 86 | `getInventorySummary` | const arrow | 846 |
| 87 | `getInventoryMovements` | const arrow | 847 |
| 88 | `createSale` | export function | 850 |
| 89 | `getSales` | const arrow | 855 |
| 90 | `getDashboard` | const arrow | 862 |
| 91 | `getAnalytics` | const arrow | 863 |
| 92 | `getCustomers` | const arrow | 872 |
| 93 | `createCustomer` | export function | 873 |
| 94 | `updateCustomer` | const arrow | 877 |
| 95 | `deleteCustomer` | const arrow | 881 |
| 96 | `downloadCustomerTemplate` | const arrow | 886 |
| 97 | `getSuppliers` | const arrow | 894 |
| 98 | `createSupplier` | export function | 895 |
| 99 | `updateSupplier` | const arrow | 899 |
| 100 | `deleteSupplier` | const arrow | 903 |
| 101 | `downloadSupplierTemplate` | const arrow | 908 |
| 102 | `getDeliveryContacts` | const arrow | 916 |
| 103 | `createDeliveryContact` | export function | 917 |
| 104 | `updateDeliveryContact` | const arrow | 921 |
| 105 | `deleteDeliveryContact` | const arrow | 925 |
| 106 | `getUsers` | const arrow | 932 |
| 107 | `updateUser` | const arrow | 934 |
| 108 | `getUserProfile` | const arrow | 935 |
| 109 | `getUserAuthMethods` | const arrow | 936 |
| 110 | `updateUserProfile` | const arrow | 938 |
| 111 | `disconnectUserAuthProvider` | const arrow | 940 |
| 112 | `changeUserPassword` | const arrow | 942 |
| 113 | `resetPassword` | const arrow | 944 |
| 114 | `getRoles` | const arrow | 947 |
| 115 | `updateRole` | const arrow | 949 |
| 116 | `deleteRole` | const arrow | 950 |
| 117 | `getCustomTables` | const arrow | 953 |
| 118 | `getCustomTableData` | const arrow | 955 |
| 119 | `insertCustomRow` | const arrow | 956 |
| 120 | `updateCustomRow` | const arrow | 957 |
| 121 | `deleteCustomRow` | const arrow | 958 |
| 122 | `getAuditLogs` | const arrow | 961 |
| 123 | `exportBackup` | export function | 964 |
| 124 | `exportBackupFolder` | export function | 981 |
| 125 | `pickBackupFile` | export function | 985 |
| 126 | `importBackupData` | export function | 1000 |
| 127 | `importBackupFolder` | export function | 1007 |
| 128 | `importBackup` | export function | 1014 |
| 129 | `getGoogleDriveSyncStatus` | const arrow | 1029 |
| 130 | `saveGoogleDriveSyncPreferences` | const arrow | 1063 |
| 131 | `startGoogleDriveSyncOauth` | const arrow | 1066 |
| 132 | `disconnectGoogleDriveSync` | const arrow | 1069 |
| 133 | `forgetGoogleDriveSyncCredentials` | const arrow | 1072 |
| 134 | `syncGoogleDriveNow` | const arrow | 1075 |
| 135 | `resetData` | export function | 1078 |
| 136 | `factoryReset` | export function | 1085 |
| 137 | `downloadImportTemplate` | export function | 1093 |
| 138 | `openPath` | export function | 1134 |
| 139 | `getReturns` | const arrow | 1143 |
| 140 | `createReturn` | export function | 1149 |
| 141 | `createSupplierReturn` | export function | 1155 |
| 142 | `updateSaleStatus` | const arrow | 1164 |
| 143 | `attachSaleCustomer` | const arrow | 1180 |
| 144 | `getSalesExport` | const arrow | 1203 |
| 145 | `updateReturn` | const arrow | 1207 |
| 146 | `testSyncServer` | export function | 1237 |
| 147 | `openFolderDialog` | export function | 1256 |
| 148 | `getDataPath` | const arrow | 1267 |
| 149 | `setDataPath` | export function | 1268 |
| 150 | `resetDataPath` | export function | 1273 |
| 151 | `browseDir` | const arrow | 1278 |

### 3.77 `frontend/src/api/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `shouldDebugWs` | function | 19 |
| 2 | `logWs` | function | 29 |
| 3 | `connectWS` | export function | 35 |
| 4 | `disconnectWS` | export function | 127 |
| 5 | `reconnectWS` | export function | 136 |
| 6 | `scheduleReconnect` | function | 141 |
| 7 | `isWSConnected` | export function | 157 |

### 3.78 `frontend/src/App.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getChunkErrorMessage` | function | 77 |
| 2 | `isChunkLoadError` | function | 82 |
| 3 | `createChunkTimeoutError` | function | 91 |
| 4 | `isRetryableImportError` | function | 97 |
| 5 | `importWithTimeout` | function | 105 |
| 6 | `clearRetryMarker` | function | 121 |
| 7 | `triggerChunkRecoveryReload` | function | 128 |
| 8 | `createChunkReloadStallError` | function | 138 |
| 9 | `shouldRetryChunk` | function | 144 |
| 10 | `lazyWithRetry` | function | 154 |
| 11 | `getWarmupImporters` | function | 221 |
| 12 | `getDataWarmupLoaders` | function | 235 |
| 13 | `createWarmupLoader` | function | 244 |
| 14 | `runWarmupBatches` | function | 249 |
| 15 | `getPageEntryWarmupLoaders` | function | 258 |
| 16 | `useMountedPages` | function | 265 |
| 17 | `useSyncErrorBanner` | function | 279 |
| 18 | `onSyncError` | const arrow | 284 |
| 19 | `onSyncRecovered` | const arrow | 285 |
| 20 | `useVisibilityRecovery` | function | 306 |
| 21 | `onVisible` | const arrow | 310 |
| 22 | `onFocus` | const arrow | 320 |
| 23 | `useChunkWarmup` | function | 338 |
| 24 | `runWarmup` | const arrow | 350 |
| 25 | `useDataWarmup` | function | 379 |
| 26 | `runWarmup` | const arrow | 390 |
| 27 | `usePageEntryWarmup` | function | 415 |
| 28 | `run` | const arrow | 434 |
| 29 | `PageErrorBoundary` | class | 450 |
| 30 | `Notification` | function | 498 |
| 31 | `SyncErrorBanner` | function | 510 |
| 32 | `ReadOnlyServerBanner` | function | 532 |
| 33 | `PageLoader` | function | 540 |
| 34 | `PageSlot` | function | 567 |
| 35 | `PublicCatalogView` | function | 590 |
| 36 | `App` | export default function | 603 |
| 37 | `loadFavicon` | function | 661 |

### 3.79 `frontend/src/app/appShellUtils.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isPublicCatalogPath` | export function | 9 |
| 2 | `updateMountedPages` | export function | 19 |
| 3 | `getNotificationPrefix` | export function | 29 |
| 4 | `getNotificationColor` | export function | 36 |

### 3.80 `frontend/src/AppContext.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `flattenTranslationTree` | function | 24 |
| 2 | `safeStorageGet` | function | 80 |
| 3 | `safeStorageSet` | function | 88 |
| 4 | `safeStorageRemove` | function | 94 |
| 5 | `getStoredAuthToken` | function | 100 |
| 6 | `getStoredUserPayload` | function | 104 |
| 7 | `getStoredUserExpiry` | function | 108 |
| 8 | `clearPersistedAuthState` | function | 112 |
| 9 | `persistAuthState` | function | 122 |
| 10 | `computeSessionExpiryMs` | function | 136 |
| 11 | `readDeviceSettings` | function | 152 |
| 12 | `writeDeviceSettings` | function | 160 |
| 13 | `writeStoredSessionDuration` | function | 166 |
| 14 | `readPendingOauthLink` | function | 174 |
| 15 | `clearPendingOauthLink` | function | 188 |
| 16 | `mergeSettingsWithDeviceOverrides` | function | 194 |
| 17 | `normalizeDateInput` | function | 198 |
| 18 | `isBrokenLocalizedString` | export function | 204 |
| 19 | `buildRuntimeDescriptorFromBootstrap` | function | 214 |
| 20 | `LoadingScreen` | function | 242 |
| 21 | `AccessDenied` | function | 255 |
| 22 | `AppProvider` | export function | 267 |
| 23 | `onUpdate` | const arrow | 443 |
| 24 | `onStatus` | const arrow | 471 |
| 25 | `poll` | const arrow | 479 |
| 26 | `onError` | const arrow | 499 |
| 27 | `onWriteBlocked` | const arrow | 503 |
| 28 | `onConflict` | const arrow | 514 |
| 29 | `finalizeUnauthorized` | const arrow | 574 |
| 30 | `onUnauthorized` | const arrow | 590 |
| 31 | `handleOtpLogin` | const arrow | 638 |
| 32 | `handleUserUpdated` | const arrow | 678 |
| 33 | `discoverSyncUrl` | const arrow | 712 |
| 34 | `hexAlpha` | const arrow | 846 |
| 35 | `clearCallbackUrl` | const arrow | 1032 |
| 36 | `clearPendingLink` | const arrow | 1036 |
| 37 | `run` | const arrow | 1040 |
| 38 | `useApp` | const arrow | 1347 |
| 39 | `useSync` | const arrow | 1348 |
| 40 | `useT` | const arrow | 1351 |

### 3.81 `frontend/src/components/auth/Login.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readPendingOauthLogin` | function | 27 |
| 2 | `clearPendingOauthLogin` | function | 41 |
| 3 | `OauthButton` | function | 47 |
| 4 | `ModeBackButton` | function | 61 |
| 5 | `Login` | export default function | 74 |
| 6 | `tr` | const arrow | 76 |
| 7 | `rememberOrganization` | const arrow | 145 |
| 8 | `loadCapabilities` | const arrow | 181 |
| 9 | `bootstrap` | const arrow | 201 |
| 10 | `clearCallbackUrl` | const arrow | 270 |
| 11 | `run` | const arrow | 275 |
| 12 | `rememberedOrg` | const arrow | 306 |
| 13 | `getDeviceContext` | const arrow | 356 |
| 14 | `handleLogin` | const arrow | 358 |
| 15 | `handleOtp` | const arrow | 388 |
| 16 | `handleOtpInput` | const arrow | 422 |
| 17 | `handleResetWithOtp` | const arrow | 427 |
| 18 | `handleResetWithEmail` | const arrow | 464 |
| 19 | `handleCompleteEmailReset` | const arrow | 493 |
| 20 | `handleStartOauth` | const arrow | 526 |
| 21 | `closeAuxMode` | const arrow | 574 |

### 3.82 `frontend/src/components/branches/Branches.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatTransferDate` | function | 21 |
| 2 | `Branches` | export default function | 38 |
| 3 | `load` | const arrow | 60 |
| 4 | `loadBranchStock` | const arrow | 101 |
| 5 | `handleSaveBranch` | const arrow | 116 |
| 6 | `handleDelete` | const arrow | 135 |
| 7 | `handleBulkDelete` | const arrow | 150 |
| 8 | `toggleSelect` | const arrow | 175 |
| 9 | `toggleSelectAll` | const arrow | 184 |

### 3.83 `frontend/src/components/branches/BranchForm.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BranchForm` | export default function | 11 |
| 2 | `set` | const arrow | 33 |
| 3 | `handleSave` | const arrow | 45 |

### 3.84 `frontend/src/components/branches/TransferModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `TransferModal` | export default function | 17 |
| 2 | `loadStock` | function | 61 |
| 3 | `handleTransfer` | const arrow | 106 |

### 3.85 `frontend/src/components/catalog/CatalogPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getAboutBlockLabel` | function | 53 |
| 2 | `withAssetVersion` | function | 59 |
| 3 | `tt` | function | 740 |
| 4 | `toBoolean` | function | 753 |
| 5 | `toNumber` | function | 760 |
| 6 | `normalizePriceDisplay` | function | 766 |
| 7 | `normalizeHexColor` | function | 771 |
| 8 | `normalizeExternalUrl` | function | 777 |
| 9 | `buildFaqStarterItems` | function | 793 |
| 10 | `buildAiFaqStarterItems` | function | 873 |
| 11 | `hexToRgba` | function | 904 |
| 12 | `readPortalCache` | function | 915 |
| 13 | `writePortalCache` | function | 931 |
| 14 | `normalizePortalPath` | function | 945 |
| 15 | `isReservedPortalPath` | function | 958 |
| 16 | `buildDraft` | function | 963 |
| 17 | `applyDraft` | function | 1047 |
| 18 | `getBranchQty` | function | 1163 |
| 19 | `getStockStatus` | function | 1170 |
| 20 | `normalizeProductGallery` | function | 1180 |
| 21 | `formatDateTime` | function | 1198 |
| 22 | `formatPortalPrice` | function | 1205 |
| 23 | `ImageField` | function | 1218 |
| 24 | `pickImageAsDataUrl` | function | 1284 |
| 25 | `pickMultipleImagesAsDataUrls` | function | 1303 |
| 26 | `replaceVars` | function | 1324 |
| 27 | `applyGoogleTranslateSelection` | function | 1360 |
| 28 | `readStoredTranslateTarget` | function | 1383 |
| 29 | `CatalogPage` | export default function | 1407 |
| 30 | `copy` | const arrow | 1487 |
| 31 | `resolveVisibleTab` | const arrow | 1496 |
| 32 | `loadAssistantStatus` | function | 1585 |
| 33 | `openProductGallery` | function | 1603 |
| 34 | `changeTranslateTarget` | function | 1616 |
| 35 | `isPortalLoadCurrent` | function | 1632 |
| 36 | `loadPortalEditorData` | function | 1636 |
| 37 | `refreshPortalView` | function | 1665 |
| 38 | `loadPortal` | function | 1693 |
| 39 | `initWidget` | const arrow | 1874 |
| 40 | `waitForWidget` | const arrow | 1892 |
| 41 | `toggleFilterValue` | function | 1998 |
| 42 | `clearPortalFilters` | function | 2006 |
| 43 | `setDraft` | function | 2013 |
| 44 | `openPortalImage` | function | 2018 |
| 45 | `setAboutBlocksDraft` | function | 2029 |
| 46 | `updateAboutBlock` | function | 2033 |
| 47 | `addAboutBlock` | function | 2039 |
| 48 | `moveAboutBlockBefore` | function | 2043 |
| 49 | `removeAboutBlock` | function | 2055 |
| 50 | `setFaqDraft` | function | 2059 |
| 51 | `addFaqItem` | function | 2063 |
| 52 | `mergeFaqStarterItems` | function | 2074 |
| 53 | `addFaqStarterSet` | function | 2087 |
| 54 | `addAiFaqStarterSet` | function | 2091 |
| 55 | `updateFaqItem` | function | 2095 |
| 56 | `removeFaqItem` | function | 2101 |
| 57 | `clearAssistantState` | function | 2105 |
| 58 | `uploadPortalImage` | function | 2120 |
| 59 | `uploadDraftImage` | function | 2139 |
| 60 | `uploadAboutBlockMedia` | function | 2144 |
| 61 | `openFilePicker` | function | 2153 |
| 62 | `handleFilePickerSelect` | function | 2157 |
| 63 | `savePortalDraft` | function | 2173 |
| 64 | `askAssistant` | function | 2293 |
| 65 | `refreshMembershipData` | function | 2337 |
| 66 | `handleMembershipLookup` | function | 2381 |
| 67 | `addSubmissionImages` | function | 2394 |
| 68 | `handleSubmissionPaste` | function | 2404 |
| 69 | `handleSubmitShareProof` | function | 2420 |
| 70 | `handleReviewSubmission` | function | 2464 |
| 71 | `renderCatalogSection` | function | 2594 |
| 72 | `handleUploadSubmissionImages` | const arrow | 2611 |
| 73 | `renderSecondaryTabSection` | function | 2663 |

### 3.86 `frontend/src/components/catalog/CatalogProductsSection.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CatalogProductsSection` | export default function | 10 |

### 3.87 `frontend/src/components/catalog/CatalogSecondaryTabs.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CatalogMembershipSection` | function | 20 |
| 2 | `CatalogAboutSection` | function | 366 |
| 3 | `CatalogFaqSection` | function | 437 |
| 4 | `CatalogAiSection` | function | 491 |
| 5 | `CatalogSecondaryTabs` | export default function | 670 |

### 3.88 `frontend/src/components/catalog/catalogUi.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `statusClass` | function | 3 |
| 2 | `SectionShell` | export function | 10 |
| 3 | `SummaryTile` | export function | 26 |
| 4 | `StatusPill` | export function | 50 |

### 3.89 `frontend/src/components/catalog/portalEditorUtils.mjs`

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

### 3.90 `frontend/src/components/contacts/contactOptionUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createContactOption` | export function | 3 |
| 2 | `normalizeOption` | function | 15 |
| 3 | `limitContactOptions` | export function | 26 |
| 4 | `parseStoredContactOptions` | export function | 30 |
| 5 | `hasContactOptionData` | export function | 51 |
| 6 | `serializeContactOptions` | export function | 62 |
| 7 | `buildContactOptionSummary` | export function | 69 |
| 8 | `parseContactOptionsFromImportRow` | export function | 78 |
| 9 | `getPrimaryContactOption` | export function | 94 |

### 3.91 `frontend/src/components/contacts/Contacts.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `TABS` | const arrow | 16 |
| 2 | `ImportTypePicker` | function | 22 |
| 3 | `T` | const arrow | 23 |
| 4 | `Contacts` | export default function | 62 |
| 5 | `handleExportAll` | const arrow | 69 |
| 6 | `openImportPicker` | const arrow | 144 |
| 7 | `handleTypeSelected` | const arrow | 146 |
| 8 | `handleImportDone` | const arrow | 151 |

### 3.92 `frontend/src/components/contacts/CustomersTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseContactOptions` | export function | 23 |
| 2 | `serializeContactOptions` | export function | 27 |
| 3 | `tr` | function | 31 |
| 4 | `OptionEditor` | function | 36 |
| 5 | `setField` | const arrow | 37 |
| 6 | `fieldId` | const arrow | 38 |
| 7 | `CustomerForm` | function | 80 |
| 8 | `setField` | const arrow | 92 |
| 9 | `addOption` | const arrow | 93 |
| 10 | `removeOption` | const arrow | 97 |
| 11 | `updateOption` | const arrow | 98 |
| 12 | `handleSubmit` | const arrow | 99 |
| 13 | `CustomersTab` | function | 207 |
| 14 | `toggleSectionCollapsed` | const arrow | 319 |
| 15 | `isSectionFullySelected` | const arrow | 325 |
| 16 | `isSectionPartiallySelected` | const arrow | 326 |
| 17 | `toggleSectionSelection` | const arrow | 327 |
| 18 | `promise` | const arrow | 338 |
| 19 | `handleSave` | const arrow | 395 |
| 20 | `handleDelete` | const arrow | 423 |
| 21 | `handleBulkDelete` | const arrow | 436 |

### 3.93 `frontend/src/components/contacts/DeliveryTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseDeliveryOptions` | export function | 28 |
| 2 | `serializeDeliveryOptions` | export function | 32 |
| 3 | `BLANK_OPTION` | const arrow | 36 |
| 4 | `OptionEditor` | function | 39 |
| 5 | `set` | const arrow | 40 |
| 6 | `fieldId` | const arrow | 41 |
| 7 | `DeliveryForm` | function | 78 |
| 8 | `set` | const arrow | 87 |
| 9 | `addOption` | const arrow | 88 |
| 10 | `updateOption` | const arrow | 92 |
| 11 | `removeOption` | const arrow | 93 |
| 12 | `handleSave` | const arrow | 94 |
| 13 | `OptionsDisplay` | function | 164 |
| 14 | `OptionsBadge` | function | 181 |
| 15 | `DeliveryTab` | function | 192 |
| 16 | `toggleSectionCollapsed` | const arrow | 296 |
| 17 | `isSectionFullySelected` | const arrow | 302 |
| 18 | `isSectionPartiallySelected` | const arrow | 303 |
| 19 | `toggleSectionSelection` | const arrow | 304 |
| 20 | `promise` | const arrow | 315 |
| 21 | `handleSave` | const arrow | 371 |
| 22 | `handleDelete` | const arrow | 386 |
| 23 | `handleBulkDelete` | const arrow | 392 |

### 3.94 `frontend/src/components/contacts/shared.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `useContactSelection` | export function | 13 |
| 2 | `toggleOne` | const arrow | 29 |
| 3 | `clearSelection` | const arrow | 40 |
| 4 | `ThreeDotMenu` | export function | 67 |
| 5 | `menuContent` | const arrow | 75 |
| 6 | `DetailModal` | export function | 138 |
| 7 | `ContactTable` | export function | 169 |
| 8 | `parseCsvText` | function | 248 |
| 9 | `ImportModal` | export function | 309 |
| 10 | `analyzeCsv` | const arrow | 329 |
| 11 | `handlePickFile` | const arrow | 371 |
| 12 | `handleChooseExistingFile` | const arrow | 377 |
| 13 | `handleDownloadTemplate` | const arrow | 397 |
| 14 | `toggleConflictSelection` | const arrow | 401 |
| 15 | `applyModeToSelected` | const arrow | 410 |
| 16 | `toggleSelectAllConflicts` | const arrow | 420 |
| 17 | `handleImport` | const arrow | 428 |

### 3.95 `frontend/src/components/contacts/SuppliersTab.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `SupplierForm` | function | 24 |
| 2 | `set` | const arrow | 40 |
| 3 | `addOption` | const arrow | 41 |
| 4 | `updateOption` | const arrow | 45 |
| 5 | `removeOption` | const arrow | 46 |
| 6 | `handleSubmit` | const arrow | 47 |
| 7 | `SuppliersTab` | function | 134 |
| 8 | `toggleSectionCollapsed` | const arrow | 250 |
| 9 | `isSectionFullySelected` | const arrow | 256 |
| 10 | `isSectionPartiallySelected` | const arrow | 257 |
| 11 | `toggleSectionSelection` | const arrow | 258 |
| 12 | `promise` | const arrow | 269 |
| 13 | `handleSave` | const arrow | 326 |
| 14 | `handleDelete` | const arrow | 346 |
| 15 | `handleBulkDelete` | const arrow | 359 |

### 3.96 `frontend/src/components/custom-tables/CustomTables.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeRowValue` | function | 12 |
| 2 | `buildRowPayload` | function | 25 |
| 3 | `CustomTables` | export default function | 34 |
| 4 | `addColumn` | const arrow | 132 |
| 5 | `updateColumn` | const arrow | 139 |
| 6 | `removeColumn` | const arrow | 148 |
| 7 | `handleCreateTable` | const arrow | 155 |
| 8 | `handleSaveRow` | const arrow | 193 |
| 9 | `handleDeleteRow` | const arrow | 220 |
| 10 | `openAddRow` | const arrow | 239 |
| 11 | `openEditRow` | const arrow | 246 |

### 3.97 `frontend/src/components/dashboard/charts/BarChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BarChart` | export default function | 14 |
| 2 | `yPx` | function | 32 |

### 3.98 `frontend/src/components/dashboard/charts/DonutChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `DonutChart` | export default function | 14 |

### 3.99 `frontend/src/components/dashboard/charts/index.js`

- No top-level named symbols detected.

### 3.100 `frontend/src/components/dashboard/charts/LineChart.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `LineChart` | export default function | 13 |
| 2 | `xPx` | function | 29 |
| 3 | `yPx` | function | 30 |
| 4 | `handleMouseMove` | const arrow | 35 |

### 3.101 `frontend/src/components/dashboard/charts/NoData.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NoData` | export default function | 7 |

### 3.102 `frontend/src/components/dashboard/Dashboard.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Dashboard` | export default function | 19 |
| 2 | `translateOr` | const arrow | 23 |
| 3 | `calcTrend` | const arrow | 158 |
| 4 | `rangeLabel` | const arrow | 183 |
| 5 | `periodShort` | const arrow | 189 |
| 6 | `buildExportAll` | const arrow | 457 |

### 3.103 `frontend/src/components/dashboard/MiniStat.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `MiniStat` | export default function | 2 |

### 3.104 `frontend/src/components/files/FilePickerModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `AssetPreview` | function | 11 |
| 2 | `FilePickerModal` | export default function | 21 |
| 3 | `tr` | const arrow | 41 |
| 4 | `toggleSelectedPath` | function | 82 |
| 5 | `handleUpload` | function | 92 |
| 6 | `handleDelete` | function | 127 |

### 3.105 `frontend/src/components/files/FilesPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `AssetPreview` | function | 28 |
| 2 | `formatDateTime` | function | 42 |
| 3 | `ProviderStatus` | function | 52 |
| 4 | `emptyProviderForm` | function | 63 |
| 5 | `compactTabLabel` | function | 86 |
| 6 | `FilesPage` | export default function | 92 |
| 7 | `tr` | const arrow | 117 |
| 8 | `loadProviders` | function | 212 |
| 9 | `loadResponses` | function | 225 |
| 10 | `handleUpload` | function | 237 |
| 11 | `handleDeleteAsset` | function | 253 |
| 12 | `startCreateProvider` | function | 272 |
| 13 | `startEditProvider` | function | 288 |
| 14 | `saveProvider` | function | 313 |
| 15 | `testProvider` | function | 357 |
| 16 | `removeProvider` | function | 371 |
| 17 | `tabButton` | const arrow | 384 |

### 3.106 `frontend/src/components/inventory/DualMoney.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `DualMoney` | function | 5 |

### 3.107 `frontend/src/components/inventory/Inventory.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `reuseSetWhenUnchanged` | function | 27 |
| 2 | `priceCsv` | function | 36 |
| 3 | `Inventory` | export default function | 40 |
| 4 | `tr` | const arrow | 44 |
| 5 | `promise` | const arrow | 88 |
| 6 | `handleAdjust` | const arrow | 195 |
| 7 | `openAdjust` | const arrow | 229 |
| 8 | `matchesSearch` | const arrow | 242 |
| 9 | `productHay` | const arrow | 249 |
| 10 | `movHay` | const arrow | 252 |

### 3.108 `frontend/src/components/inventory/InventoryImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeAction` | function | 12 |
| 2 | `InventoryImportModal` | export default function | 19 |
| 3 | `tr` | const arrow | 29 |
| 4 | `handlePickFile` | const arrow | 42 |
| 5 | `handleDownloadTemplate` | const arrow | 50 |
| 6 | `handleImport` | const arrow | 54 |

### 3.109 `frontend/src/components/inventory/movementGroups.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `minuteBucket` | function | 1 |
| 2 | `normalizeText` | function | 8 |
| 3 | `buildGroupKey` | function | 12 |
| 4 | `describeMovementType` | function | 27 |
| 5 | `buildMovementGroups` | export function | 32 |
| 6 | `movementGroupHaystack` | export function | 93 |

### 3.110 `frontend/src/components/inventory/ProductDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductDetailModal` | export default function | 4 |
| 2 | `T` | const arrow | 5 |

### 3.111 `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sanitizeInteger` | function | 107 |
| 2 | `sanitizeKhr` | function | 112 |
| 3 | `formatLookupValue` | function | 118 |
| 4 | `LoyaltyPointsPage` | export default function | 122 |
| 5 | `copy` | const arrow | 125 |
| 6 | `setValue` | function | 206 |
| 7 | `handleSave` | function | 210 |
| 8 | `handleLookup` | function | 235 |

### 3.112 `frontend/src/components/navigation/Sidebar.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getFallbackLabel` | function | 49 |
| 2 | `getNavLabel` | function | 57 |
| 3 | `isDarkColor` | function | 73 |
| 4 | `withAlpha` | function | 83 |
| 5 | `mergeStyles` | function | 89 |
| 6 | `Sidebar` | export default function | 93 |

### 3.113 `frontend/src/components/pos/CartItem.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CartItem` | export default function | 3 |

### 3.114 `frontend/src/components/pos/FilterPanel.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `POSFilterPanel` | export default function | 3 |
| 2 | `T` | const arrow | 25 |
| 3 | `clearAll` | const arrow | 35 |
| 4 | `chip` | const arrow | 43 |
| 5 | `SectionLabel` | const arrow | 49 |

### 3.115 `frontend/src/components/pos/POS.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `allTermsMatch` | function | 58 |
| 2 | `POS` | export default function | 63 |
| 3 | `setQuickFilter` | const arrow | 101 |
| 4 | `addNewOrder` | const arrow | 166 |
| 5 | `closeOrder` | const arrow | 178 |
| 6 | `selectCustomer` | const arrow | 421 |
| 7 | `applyCustomerOption` | const arrow | 469 |
| 8 | `clearCustomer` | const arrow | 483 |
| 9 | `handleAddCustomer` | const arrow | 491 |
| 10 | `selectDelivery` | const arrow | 512 |
| 11 | `clearDelivery` | const arrow | 517 |
| 12 | `handleAddDelivery` | const arrow | 519 |
| 13 | `filteredProducts` | const arrow | 566 |
| 14 | `qty` | const arrow | 595 |
| 15 | `addToCart` | const arrow | 732 |
| 16 | `updateQty` | const arrow | 771 |
| 17 | `updatePrice` | const arrow | 779 |
| 18 | `updateItemBranch` | const arrow | 803 |
| 19 | `handleDiscountUsd` | const arrow | 852 |
| 20 | `handleDiscountKhr` | const arrow | 853 |
| 21 | `handleMembershipUnits` | const arrow | 854 |
| 22 | `handleCheckout` | const arrow | 893 |

### 3.116 `frontend/src/components/pos/posCore.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildProductsById` | export function | 3 |
| 2 | `buildVariantChildrenByParentId` | export function | 7 |
| 3 | `getVariantRootProduct` | export function | 19 |
| 4 | `buildVisibleProductCards` | export function | 26 |
| 5 | `getVariantChoices` | export function | 39 |
| 6 | `resolveCartPriceValues` | export function | 44 |
| 7 | `getCartLineId` | export function | 64 |
| 8 | `findMatchingCartLineIndex` | export function | 71 |

### 3.117 `frontend/src/components/pos/ProductImage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductImage` | export default function | 3 |

### 3.118 `frontend/src/components/pos/QuickAddModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `QuickAddModal` | export default function | 4 |
| 2 | `T` | const arrow | 5 |

### 3.119 `frontend/src/components/products/BarcodeScannerModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `stopStream` | function | 22 |
| 2 | `readCameraPermissionState` | function | 28 |
| 3 | `watchCameraPermission` | function | 38 |
| 4 | `handleChange` | const arrow | 42 |
| 5 | `BarcodeScannerModal` | export default function | 51 |

### 3.120 `frontend/src/components/products/barcodeScannerState.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `deriveScannerPresentation` | export function | 1 |

### 3.121 `frontend/src/components/products/BranchStockAdjuster.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BranchStockAdjuster` | export default function | 3 |
| 2 | `T` | const arrow | 20 |
| 3 | `setRow` | const arrow | 26 |
| 4 | `handleSave` | const arrow | 32 |

### 3.122 `frontend/src/components/products/BulkAddStockModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BulkAddStockModal` | function | 6 |
| 2 | `handleSave` | const arrow | 13 |

### 3.123 `frontend/src/components/products/BulkImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBaseName` | function | 12 |
| 2 | `parseCSVContent` | function | 19 |
| 3 | `getIncomingImageFilenames` | function | 39 |
| 4 | `getExistingImageFilenames` | function | 72 |
| 5 | `BulkImportModal` | export default function | 90 |
| 6 | `T` | const arrow | 107 |
| 7 | `resetCsvState` | const arrow | 109 |
| 8 | `pickImageDirectory` | const arrow | 120 |
| 9 | `addLibraryImages` | const arrow | 149 |
| 10 | `handleImageOnlyImport` | const arrow | 165 |
| 11 | `handlePickCSV` | const arrow | 187 |
| 12 | `handleImport` | const arrow | 262 |
| 13 | `toggleConflictSelection` | const arrow | 295 |
| 14 | `toggleSelectAllConflicts` | const arrow | 304 |
| 15 | `applyDecisionToSelection` | const arrow | 312 |
| 16 | `applyImageDecisionToSelection` | const arrow | 322 |

### 3.124 `frontend/src/components/products/HeaderActions.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductsHeaderActions` | export default function | 5 |
| 2 | `tr` | const arrow | 16 |

### 3.125 `frontend/src/components/products/ManageBrandsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseBrandOptions` | function | 5 |
| 2 | `toTitleCase` | function | 18 |
| 3 | `normalizeLookup` | function | 26 |
| 4 | `ManageBrandsModal` | export default function | 30 |
| 5 | `saveLibrary` | const arrow | 63 |
| 6 | `addLibraryBrand` | const arrow | 79 |
| 7 | `renameBrand` | const arrow | 101 |
| 8 | `removeBrand` | const arrow | 146 |

### 3.126 `frontend/src/components/products/ManageCategoriesModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ManageCategoriesModal` | export default function | 13 |
| 2 | `handleAdd` | const arrow | 48 |
| 3 | `handleUpdate` | const arrow | 68 |
| 4 | `handleDelete` | const arrow | 91 |

### 3.127 `frontend/src/components/products/ManageUnitsModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ManageUnitsModal` | export default function | 7 |
| 2 | `load` | const arrow | 19 |
| 3 | `handleAdd` | const arrow | 37 |
| 4 | `handleUpdate` | const arrow | 57 |
| 5 | `handleDelete` | const arrow | 76 |

### 3.128 `frontend/src/components/products/primitives.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sanitizeNumericInput` | function | 7 |
| 2 | `parseNumericInput` | function | 17 |
| 3 | `ProductImg` | function | 23 |
| 4 | `loadImageData` | function | 60 |
| 5 | `ProductImagePlaceholder` | function | 94 |
| 6 | `MarginCard` | function | 102 |
| 7 | `DualPriceInput` | function | 134 |
| 8 | `handleUsdChange` | const arrow | 135 |
| 9 | `handleKhrChange` | const arrow | 136 |

### 3.129 `frontend/src/components/products/ProductDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductDetailModal` | export default function | 5 |
| 2 | `T` | const arrow | 17 |
| 3 | `Row` | const arrow | 31 |

### 3.130 `frontend/src/components/products/ProductForm.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeGallery` | function | 16 |
| 2 | `editablePrice` | function | 32 |
| 3 | `pickImageFiles` | function | 37 |
| 4 | `ProductForm` | export default function | 56 |
| 5 | `tr` | const arrow | 127 |
| 6 | `loadSuppliers` | function | 160 |
| 7 | `setField` | function | 180 |
| 8 | `setNumericField` | function | 184 |
| 9 | `addImages` | function | 188 |
| 10 | `addPhoto` | function | 193 |
| 11 | `uploadPickedImages` | function | 198 |
| 12 | `removeImage` | function | 221 |
| 13 | `setPrimaryImage` | function | 225 |
| 14 | `saveForm` | function | 235 |
| 15 | `openScanner` | function | 273 |
| 16 | `closeScanner` | function | 277 |
| 17 | `applyScannedValue` | function | 281 |

### 3.131 `frontend/src/components/products/Products.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `multiMatch` | function | 33 |
| 2 | `ThreeDot` | function | 37 |
| 3 | `getScrollContainer` | function | 58 |
| 4 | `scrollNodeWithOffset` | function | 70 |
| 5 | `Products` | export default function | 86 |
| 6 | `promise` | const arrow | 135 |
| 7 | `handleSave` | const arrow | 220 |
| 8 | `normalizeGallery` | const arrow | 241 |
| 9 | `uploadGalleryImages` | const arrow | 257 |
| 10 | `handleSaveWithGallery` | const arrow | 279 |
| 11 | `handleBulkDelete` | const arrow | 311 |
| 12 | `handleBulkOutOfStock` | const arrow | 338 |
| 13 | `handleBulkChangeBranch` | const arrow | 369 |
| 14 | `handleBulkAddStock` | const arrow | 419 |
| 15 | `toggleSelect` | const arrow | 424 |
| 16 | `toggleSelectAll` | const arrow | 431 |
| 17 | `handleDelete` | const arrow | 438 |
| 18 | `resolveImageUrl` | const arrow | 471 |
| 19 | `getProductGallery` | const arrow | 482 |
| 20 | `renderUnitChip` | const arrow | 483 |
| 21 | `openLightbox` | const arrow | 497 |
| 22 | `getStockBadge` | const arrow | 508 |
| 23 | `toImageName` | const arrow | 549 |
| 24 | `toImageUrl` | const arrow | 550 |
| 25 | `priceCsv` | const arrow | 551 |

### 3.132 `frontend/src/components/products/VariantFormModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `VariantFormModal` | export default function | 7 |
| 2 | `tr` | const arrow | 9 |
| 3 | `setField` | const arrow | 35 |
| 4 | `setNumeric` | const arrow | 36 |
| 5 | `handleSave` | const arrow | 38 |

### 3.133 `frontend/src/components/receipt-settings/AllFieldsPanel.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Toggle` | function | 5 |
| 2 | `AllFieldsPanel` | export default function | 21 |
| 3 | `T` | const arrow | 23 |
| 4 | `toggleSection` | const arrow | 42 |

### 3.134 `frontend/src/components/receipt-settings/constants.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getFieldItems` | export function | 52 |
| 2 | `T` | const arrow | 53 |

### 3.135 `frontend/src/components/receipt-settings/ErrorBoundary.jsx`

- No top-level named symbols detected.

### 3.136 `frontend/src/components/receipt-settings/FieldOrderManager.jsx`

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

### 3.137 `frontend/src/components/receipt-settings/PrintSettings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Section` | function | 5 |
| 2 | `buildFallbackPreviewHtml` | function | 17 |
| 3 | `buildSafePreviewSource` | function | 35 |
| 4 | `PrintSettings` | export default function | 46 |
| 5 | `T` | const arrow | 47 |
| 6 | `setValue` | const arrow | 56 |
| 7 | `resetMargins` | const arrow | 64 |
| 8 | `getPreviewSource` | const arrow | 79 |

### 3.138 `frontend/src/components/receipt-settings/ReceiptPreview.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ReceiptPreview` | export default function | 9 |
| 2 | `loadPreview` | function | 20 |

### 3.139 `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Section` | function | 15 |
| 2 | `Toggle` | function | 26 |
| 3 | `ReceiptSettings` | export default function | 41 |
| 4 | `handleSave` | const arrow | 155 |

### 3.140 `frontend/src/components/receipt-settings/template.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseReceiptTemplate` | export function | 3 |
| 2 | `serializeReceiptTemplate` | export function | 14 |

### 3.141 `frontend/src/components/receipt/Receipt.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `stripEmoji` | function | 8 |
| 2 | `displayAddress` | function | 13 |
| 3 | `parseItems` | function | 22 |
| 4 | `labelFor` | function | 114 |
| 5 | `Row` | function | 119 |
| 6 | `Receipt` | export default function | 131 |
| 7 | `em` | const arrow | 142 |
| 8 | `exportReceiptPdf` | const arrow | 338 |

### 3.142 `frontend/src/components/returns/EditReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `EditReturnModal` | function | 6 |
| 2 | `T` | const arrow | 8 |
| 3 | `updateQty` | const arrow | 33 |
| 4 | `updateRestock` | const arrow | 36 |
| 5 | `handleSubmit` | const arrow | 44 |

### 3.143 `frontend/src/components/returns/NewReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NewReturnModal` | function | 13 |
| 2 | `T` | const arrow | 15 |
| 3 | `handleSearch` | const arrow | 42 |
| 4 | `handleReturnTypeChange` | const arrow | 95 |
| 5 | `toggleIncluded` | const arrow | 100 |
| 6 | `updateItemQty` | const arrow | 108 |
| 7 | `updateItemRestock` | const arrow | 116 |
| 8 | `selectAll` | const arrow | 120 |
| 9 | `clearAll` | const arrow | 123 |
| 10 | `handleSubmit` | const arrow | 130 |

### 3.144 `frontend/src/components/returns/NewSupplierReturnModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NewSupplierReturnModal` | export default function | 10 |
| 2 | `tr` | const arrow | 12 |
| 3 | `loadSetup` | function | 45 |
| 4 | `loadInventory` | function | 86 |
| 5 | `updateQty` | const arrow | 150 |
| 6 | `submit` | const arrow | 156 |

### 3.145 `frontend/src/components/returns/ReturnDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeScope` | function | 6 |
| 2 | `ReturnDetailModal` | export default function | 10 |
| 3 | `tr` | const arrow | 12 |

### 3.146 `frontend/src/components/returns/Returns.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeScope` | function | 23 |
| 2 | `getReturnTypeKey` | function | 27 |
| 3 | `getReturnTypeLabel` | function | 33 |
| 4 | `exportReturnRows` | function | 41 |
| 5 | `Returns` | export default function | 59 |
| 6 | `promise` | const arrow | 95 |
| 7 | `handleOpenEdit` | const arrow | 153 |
| 8 | `renderAmount` | const arrow | 405 |

### 3.147 `frontend/src/components/sales/ExportModal.jsx`

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

### 3.148 `frontend/src/components/sales/SaleDetailModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `InfoBlock` | function | 5 |
| 2 | `parseItems` | function | 21 |
| 3 | `SaleDetailModal` | export default function | 31 |
| 4 | `translateOr` | const arrow | 47 |
| 5 | `handleStatusUpdate` | const arrow | 69 |
| 6 | `handleMembershipAttach` | const arrow | 80 |

### 3.149 `frontend/src/components/sales/Sales.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `multiMatch` | function | 22 |
| 2 | `getSaleBranchLabel` | function | 26 |
| 3 | `Sales` | export default function | 34 |
| 4 | `promise` | const arrow | 73 |
| 5 | `handleStatusChange` | const arrow | 138 |
| 6 | `handleAttachMembership` | const arrow | 162 |
| 7 | `toggleSelected` | const arrow | 270 |
| 8 | `toggleSelectAll` | const arrow | 276 |
| 9 | `handleExportSelected` | const arrow | 307 |
| 10 | `handleBulkStatusUpdate` | const arrow | 326 |

### 3.150 `frontend/src/components/sales/SalesImportModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeBranchMap` | function | 12 |
| 2 | `findProduct` | function | 23 |
| 3 | `SalesImportModal` | export default function | 33 |
| 4 | `tr` | const arrow | 43 |
| 5 | `handlePickFile` | const arrow | 56 |
| 6 | `handleDownloadTemplate` | const arrow | 64 |
| 7 | `handleImport` | const arrow | 68 |

### 3.151 `frontend/src/components/sales/StatusBadge.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getStatusLabel` | export function | 23 |
| 2 | `StatusBadge` | export default function | 39 |

### 3.152 `frontend/src/components/server/ServerPage.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `useLocalCopy` | function | 21 |
| 2 | `isAutoDetected` | function | 31 |
| 3 | `StatusRow` | function | 38 |
| 4 | `InfoTab` | function | 50 |
| 5 | `fmt` | const arrow | 109 |
| 6 | `DiagnosticsPanel` | function | 195 |
| 7 | `onErr` | const arrow | 226 |
| 8 | `onQueueChanged` | const arrow | 230 |
| 9 | `handleRetryQueue` | function | 272 |
| 10 | `ServerPage` | export default function | 426 |
| 11 | `check` | const arrow | 451 |
| 12 | `loadSecurityConfig` | const arrow | 473 |
| 13 | `handleTest` | function | 485 |
| 14 | `handleSave` | function | 507 |
| 15 | `handleDisconnect` | function | 514 |

### 3.153 `frontend/src/components/shared/ExportMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ExportMenu` | export default function | 4 |

### 3.154 `frontend/src/components/shared/FilterMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sectionButtonClass` | function | 4 |
| 2 | `FilterMenu` | export default function | 10 |

### 3.155 `frontend/src/components/shared/ImageGalleryLightbox.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ImageGalleryLightbox` | export default function | 8 |
| 2 | `formatLabel` | function | 30 |
| 3 | `setIndex` | function | 34 |
| 4 | `renderGalleryImage` | function | 40 |
| 5 | `onKeyDown` | function | 47 |

### 3.156 `frontend/src/components/shared/Modal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Modal` | export default function | 10 |

### 3.157 `frontend/src/components/shared/navigationConfig.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseNavSetting` | export function | 23 |
| 2 | `orderNavItems` | export function | 32 |

### 3.158 `frontend/src/components/shared/NotificationCenter.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `preferenceValue` | function | 99 |
| 2 | `matchesVisibilityMode` | function | 106 |
| 3 | `NotificationCenter` | export default function | 113 |
| 4 | `syncVisibility` | const arrow | 142 |
| 5 | `onVisible` | const arrow | 198 |
| 6 | `handleClickOutside` | const arrow | 221 |

### 3.159 `frontend/src/components/shared/pageActivity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `useIsPageActive` | export function | 4 |

### 3.160 `frontend/src/components/shared/PageHeader.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PageHeader` | export default function | 9 |

### 3.161 `frontend/src/components/shared/PageHelpButton.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PageHelpButton` | export default function | 6 |

### 3.162 `frontend/src/components/shared/pageHelpContent.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getPageHelpContent` | export function | 442 |

### 3.163 `frontend/src/components/shared/PortalMenu.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PortalMenu` | export default function | 11 |
| 2 | `closeIfClickedOutside` | const arrow | 63 |
| 3 | `closeMenu` | const arrow | 70 |
| 4 | `scheduleReposition` | const arrow | 71 |
| 5 | `closeIfEscape` | const arrow | 78 |
| 6 | `ThreeDotPortal` | export function | 180 |

### 3.164 `frontend/src/components/shared/QuickPreferenceToggles.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ToggleButton` | function | 4 |
| 2 | `QuickPreferenceToggles` | export default function | 23 |
| 3 | `tr` | const arrow | 25 |

### 3.165 `frontend/src/components/shared/WriteConflictModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatConflictTime` | function | 3 |
| 2 | `summarizeCurrentValue` | function | 10 |
| 3 | `formatValue` | function | 66 |
| 4 | `getConflictFieldRows` | function | 73 |
| 5 | `WriteConflictModal` | export default function | 171 |

### 3.166 `frontend/src/components/users/PermissionEditor.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PermissionEditor` | export default function | 15 |
| 2 | `translate` | const arrow | 16 |
| 3 | `labelFor` | const arrow | 22 |
| 4 | `toggle` | const arrow | 25 |

### 3.167 `frontend/src/components/users/UserDetailSheet.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `translateLabel` | function | 4 |
| 2 | `buildRowData` | function | 9 |
| 3 | `UserDetailSheet` | export default function | 21 |

### 3.168 `frontend/src/components/users/UserProfileModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `AvatarPreview` | function | 18 |
| 2 | `ProfileSectionButton` | function | 36 |
| 3 | `clamp` | function | 146 |
| 4 | `readFileAsDataUrl` | function | 150 |
| 5 | `loadImageElement` | function | 159 |
| 6 | `renderAvatarCropBlob` | function | 169 |
| 7 | `AvatarEditorModal` | function | 195 |
| 8 | `UserProfileModal` | export default function | 256 |
| 9 | `tr` | const arrow | 259 |
| 10 | `loadProfile` | const arrow | 326 |
| 11 | `handleProfileSave` | const arrow | 389 |
| 12 | `handlePasswordSave` | const arrow | 443 |
| 13 | `handleSessionSave` | const arrow | 472 |
| 14 | `refreshOtpState` | const arrow | 479 |
| 15 | `handleAvatarPick` | const arrow | 485 |
| 16 | `resetAvatarEditor` | const arrow | 487 |
| 17 | `openAvatarEditor` | const arrow | 493 |
| 18 | `closeAvatarEditor` | const arrow | 501 |
| 19 | `handleStartOauthLink` | const arrow | 507 |
| 20 | `handleDisconnectOauthProvider` | const arrow | 543 |
| 21 | `handleAvatarSelected` | const arrow | 584 |
| 22 | `saveAvatarFromEditor` | const arrow | 600 |

### 3.169 `frontend/src/components/users/Users.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ThreeDot` | function | 28 |
| 2 | `formatContactValue` | function | 63 |
| 3 | `Users` | export default function | 68 |
| 4 | `canManageTargetUser` | const arrow | 105 |
| 5 | `promise` | const arrow | 117 |
| 6 | `openCreateUser` | const arrow | 232 |
| 7 | `openEditUser` | const arrow | 239 |
| 8 | `openCreateRole` | const arrow | 256 |
| 9 | `openEditRole` | const arrow | 263 |
| 10 | `getRolePermissions` | const arrow | 274 |
| 11 | `getPermissionSummary` | const arrow | 283 |
| 12 | `handleSaveUser` | const arrow | 301 |
| 13 | `handleResetPassword` | const arrow | 351 |
| 14 | `handleSaveRole` | const arrow | 403 |
| 15 | `handleDeleteRole` | const arrow | 439 |

### 3.170 `frontend/src/components/utils-settings/AuditLog.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toIso` | function | 41 |
| 2 | `formatDateTime` | function | 47 |
| 3 | `formatLogTime` | function | 65 |
| 4 | `getLogEpoch` | function | 69 |
| 5 | `formatJsonPretty` | function | 76 |
| 6 | `parseLogJson` | function | 84 |
| 7 | `flattenSummaryValue` | function | 92 |
| 8 | `formatEntityName` | function | 111 |
| 9 | `readableSummary` | function | 117 |
| 10 | `DetailRow` | function | 137 |
| 11 | `AuditLog` | export default function | 149 |
| 12 | `sessionEntryLabel` | function | 416 |

### 3.171 `frontend/src/components/utils-settings/Backup.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PathActionButton` | function | 74 |
| 2 | `PrimaryActionButton` | function | 86 |
| 3 | `useCopy` | function | 98 |
| 4 | `buildPathCrumbs` | function | 108 |
| 5 | `buildFinalDataFolderPath` | function | 126 |
| 6 | `formatDateTime` | function | 139 |
| 7 | `formatBytes` | function | 154 |
| 8 | `countBackupRows` | function | 163 |
| 9 | `buildBackupPreview` | function | 173 |
| 10 | `SectionChip` | function | 215 |
| 11 | `FolderBrowserPanel` | function | 230 |
| 12 | `DataFolderLocation` | function | 343 |
| 13 | `openBrowser` | const arrow | 399 |
| 14 | `openDriveBrowser` | const arrow | 411 |
| 15 | `pickFolderNatively` | const arrow | 415 |
| 16 | `openInlinePicker` | const arrow | 442 |
| 17 | `openInExplorer` | const arrow | 450 |
| 18 | `selectDir` | const arrow | 465 |
| 19 | `handleApply` | const arrow | 471 |
| 20 | `handleReset` | const arrow | 492 |
| 21 | `GoogleDriveSyncSection` | function | 628 |
| 22 | `handler` | const arrow | 730 |
| 23 | `savePreferences` | const arrow | 746 |
| 24 | `connectGoogleDrive` | const arrow | 765 |
| 25 | `syncNow` | const arrow | 799 |
| 26 | `disconnect` | const arrow | 816 |
| 27 | `forgetCredentials` | const arrow | 831 |
| 28 | `Backup` | export default function | 993 |
| 29 | `loadHostConfig` | function | 1025 |
| 30 | `browseServerFolders` | const arrow | 1039 |
| 31 | `toggleServerBrowser` | const arrow | 1061 |
| 32 | `handleExport` | const arrow | 1075 |
| 33 | `pickFolder` | const arrow | 1088 |
| 34 | `handleFolderExport` | const arrow | 1101 |
| 35 | `handleFolderImport` | const arrow | 1119 |
| 36 | `handleChooseImportFile` | const arrow | 1140 |
| 37 | `handleConfirmImport` | const arrow | 1156 |

### 3.172 `frontend/src/components/utils-settings/FontFamilyPicker.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `FontFamilyPicker` | function | 20 |

### 3.173 `frontend/src/components/utils-settings/index.js`

- No top-level named symbols detected.

### 3.174 `frontend/src/components/utils-settings/OtpModal.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `OtpModal` | export default function | 12 |
| 2 | `loadSetup` | function | 47 |

### 3.175 `frontend/src/components/utils-settings/ResetData.jsx`

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

### 3.176 `frontend/src/components/utils-settings/Settings.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseStoredColors` | function | 94 |
| 2 | `buildColorChoices` | function | 105 |
| 3 | `useCopy` | function | 196 |
| 4 | `getSettingsNavLabel` | function | 204 |
| 5 | `SwatchPicker` | function | 221 |
| 6 | `SettingsSection` | function | 304 |
| 7 | `Settings` | export default function | 334 |
| 8 | `loadOtpStatus` | function | 403 |
| 9 | `loadFaviconPreview` | function | 428 |
| 10 | `setValue` | const arrow | 478 |
| 11 | `formatPreviewDateTime` | const arrow | 497 |
| 12 | `moveNavItem` | const arrow | 513 |
| 13 | `toggleMobilePinned` | const arrow | 523 |
| 14 | `movePinnedItem` | const arrow | 535 |
| 15 | `movePinnedBefore` | const arrow | 545 |
| 16 | `resetNavigationLayout` | const arrow | 557 |
| 17 | `field` | const arrow | 562 |
| 18 | `savePaymentMethods` | const arrow | 584 |
| 19 | `uploadImageSetting` | const arrow | 589 |
| 20 | `handleSaveSettings` | const arrow | 616 |

### 3.177 `frontend/src/constants.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createEmptyOrder` | export function | 127 |
| 2 | `formatDate` | export function | 157 |
| 3 | `isNetworkError` | export function | 177 |

### 3.178 `frontend/src/index.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `disableServiceWorkerCaching` | function | 7 |
| 2 | `cleanup` | const arrow | 10 |
| 3 | `installFormFieldAccessibility` | function | 36 |
| 4 | `escapeSelectorValue` | const arrow | 41 |
| 5 | `wireField` | const arrow | 46 |
| 6 | `scan` | const arrow | 68 |
| 7 | `valueIncludesExtensionSource` | const arrow | 120 |
| 8 | `valueIncludesLikelyInjectedBundle` | const arrow | 124 |
| 9 | `shouldIgnoreRuntimeValue` | const arrow | 131 |
| 10 | `isIgnoredRuntimeMessage` | const arrow | 139 |
| 11 | `safeInsertRule` | const function | 146 |
| 12 | `safeCssRulesGetter` | const function | 163 |
| 13 | `stopKnownStartupNoise` | const arrow | 179 |

### 3.179 `frontend/src/platform/runtime/clientRuntime.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `canUseBrowserStorage` | function | 6 |
| 2 | `isBusinessOsStorageKey` | function | 10 |
| 3 | `sanitizeText` | function | 15 |
| 4 | `sanitizeSyncServerUrl` | export function | 19 |
| 5 | `normalizeRuntimeDescriptor` | export function | 31 |
| 6 | `readStoredRuntimeDescriptor` | export function | 40 |
| 7 | `writeStoredRuntimeDescriptor` | export function | 51 |
| 8 | `shouldResetForRuntimeChange` | export function | 65 |
| 9 | `buildQueuedOperationScope` | export function | 79 |
| 10 | `doesQueuedScopeMatchCurrent` | export function | 87 |
| 11 | `clearServiceWorkersAndCaches` | function | 102 |
| 12 | `snapshotStorage` | function | 122 |
| 13 | `clearStorage` | function | 135 |
| 14 | `restoreStorage` | function | 148 |
| 15 | `resetClientRuntimeState` | export function | 158 |

### 3.180 `frontend/src/platform/storage/storagePolicy.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `shouldPersistLocalMirror` | export function | 22 |
| 2 | `maxStoredNumber` | export function | 26 |
| 3 | `isCooldownActive` | export function | 33 |

### 3.181 `frontend/src/utils/appRefresh.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `refreshAppData` | export function | 18 |

### 3.182 `frontend/src/utils/color.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeHex` | function | 1 |
| 2 | `relativeLuminance` | function | 12 |
| 3 | `getContrastingTextColor` | export function | 27 |

### 3.183 `frontend/src/utils/csv.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `escapeCsvValue` | function | 4 |
| 2 | `buildCSV` | export function | 15 |
| 3 | `downloadBlob` | export function | 24 |
| 4 | `downloadCSV` | export function | 38 |
| 5 | `CRC32_TABLE` | const arrow | 44 |
| 6 | `crc32` | function | 56 |
| 7 | `writeUint16` | function | 64 |
| 8 | `writeUint32` | function | 68 |
| 9 | `encodeZipTimestamp` | function | 72 |
| 10 | `buildZip` | export function | 85 |
| 11 | `downloadZipFiles` | export function | 161 |

### 3.184 `frontend/src/utils/csvImport.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `splitCsvLine` | export function | 1 |
| 2 | `parseCsvRows` | export function | 34 |
| 3 | `normalizeCsvKey` | export function | 54 |
| 4 | `parseCsvNumber` | export function | 58 |

### 3.185 `frontend/src/utils/dateHelpers.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `todayStr` | export function | 10 |
| 2 | `offsetDate` | export function | 20 |

### 3.186 `frontend/src/utils/deviceInfo.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getClientDeviceInfo` | export function | 1 |
| 2 | `getClientMetaHeaders` | export function | 24 |

### 3.187 `frontend/src/utils/exportPackage.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildReportManifestRows` | export function | 3 |
| 2 | `buildReportPackageFiles` | export function | 11 |

### 3.188 `frontend/src/utils/exportReports.jsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `escapeHtml` | function | 198 |
| 2 | `formatCellValue` | function | 207 |
| 3 | `renderChartMarkup` | function | 212 |
| 4 | `renderMetadataGroups` | function | 228 |
| 5 | `renderSummaryCards` | function | 250 |
| 6 | `renderCharts` | function | 265 |
| 7 | `renderTables` | function | 283 |
| 8 | `renderNotes` | function | 317 |
| 9 | `buildStandaloneReportHtml` | export function | 329 |

### 3.189 `frontend/src/utils/favicon.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `clamp` | function | 1 |
| 2 | `loadImage` | function | 5 |
| 3 | `createCircularFaviconDataUrl` | export function | 19 |

### 3.190 `frontend/src/utils/formatters.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fmtTime` | export function | 9 |
| 2 | `fmtDate` | export function | 25 |
| 3 | `fmtShort` | export function | 39 |
| 4 | `fmtCount` | export function | 51 |

### 3.191 `frontend/src/utils/groupedRecords.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toDate` | function | 1 |
| 2 | `getTimeParts` | export function | 6 |
| 3 | `matchesYearMonthFilters` | export function | 38 |
| 4 | `getAvailableYears` | export function | 45 |
| 5 | `getTimeGroupingMode` | export function | 54 |
| 6 | `buildTimeActionSections` | export function | 60 |
| 7 | `getSortTime` | const arrow | 72 |
| 8 | `compareItemsByTime` | const arrow | 77 |
| 9 | `toggleIdSet` | export function | 183 |

### 3.192 `frontend/src/utils/index.js`

- No top-level named symbols detected.

### 3.193 `frontend/src/utils/loaders.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `settleLoaderMap` | export function | 10 |
| 2 | `beginTrackedRequest` | export function | 34 |
| 3 | `isTrackedRequestCurrent` | export function | 40 |
| 4 | `invalidateTrackedRequest` | export function | 44 |
| 5 | `createLoaderTimeoutError` | export function | 52 |
| 6 | `withLoaderTimeout` | export function | 59 |
| 7 | `getLoaderErrorMessage` | export function | 76 |
| 8 | `getFirstLoaderError` | export function | 80 |

### 3.194 `frontend/src/utils/pricing.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toFiniteNumber` | export function | 1 |
| 2 | `roundUpToDecimals` | export function | 6 |
| 3 | `normalizePriceValue` | export function | 15 |
| 4 | `formatPriceNumber` | export function | 19 |

### 3.195 `frontend/src/utils/printReceipt.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parsePrintNumber` | function | 12 |
| 2 | `cloneElementWithInlineStyles` | function | 85 |
| 3 | `escapeHtml` | function | 108 |
| 4 | `blobToDataUrl` | function | 117 |
| 5 | `inlineImageNodeSources` | function | 126 |
| 6 | `extractUrlsFromCssValue` | function | 149 |
| 7 | `inlineStyleAssetUrls` | function | 155 |
| 8 | `normalizePrintableRoot` | function | 189 |
| 9 | `mmToPt` | function | 206 |
| 10 | `dataUrlToBytes` | function | 210 |
| 11 | `joinPdfChunks` | function | 220 |
| 12 | `buildPdfStream` | function | 231 |
| 13 | `buildSingleImagePdf` | function | 240 |
| 14 | `escapePdfText` | function | 278 |
| 15 | `wrapTextLine` | function | 285 |
| 16 | `buildTextOnlyPdf` | function | 304 |
| 17 | `buildReceiptFileName` | function | 357 |
| 18 | `waitForElementAssets` | function | 367 |
| 19 | `renderElementToCanvas` | function | 396 |
| 20 | `withReceiptElement` | function | 461 |
| 21 | `createPrintableReceiptMarkup` | function | 500 |
| 22 | `buildPrintablePreviewDocument` | function | 514 |
| 23 | `openPrintableReceiptPreview` | export function | 658 |
| 24 | `downloadBlob` | function | 670 |
| 25 | `getPrintSettings` | export function | 681 |
| 26 | `savePrintSettings` | export function | 689 |
| 27 | `getPaperWidthMm` | export function | 695 |
| 28 | `createReceiptPdfBlob` | export function | 705 |
| 29 | `buildTextOnlyReceiptBlob` | const arrow | 711 |
| 30 | `renderPdfBlob` | const arrow | 725 |
| 31 | `extractReceiptLines` | function | 760 |
| 32 | `downloadReceiptPdf` | export function | 778 |
| 33 | `openReceiptPdf` | export function | 797 |
| 34 | `printReceipt` | export function | 821 |

### 3.196 `frontend/src/web-api.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getStoredAuthToken` | function | 23 |
| 2 | `hasExtensionSource` | const arrow | 49 |
| 3 | `isLikelyInjectedBundle` | const arrow | 50 |
| 4 | `isSuppressedRuntimeMessage` | const arrow | 57 |

### 3.197 `frontend/tailwind.config.mjs`

- No top-level named symbols detected.

### 3.198 `frontend/tests/appShellUtils.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.199 `frontend/tests/barcodeScannerState.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.200 `frontend/tests/csvImport.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.201 `frontend/tests/exportPackages.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 7 |

### 3.202 `frontend/tests/groupedRecords.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 6 |

### 3.203 `frontend/tests/loaders.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.204 `frontend/tests/portalEditorUtils.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |

### 3.205 `frontend/tests/posCore.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 15 |

### 3.206 `frontend/tests/pricingContacts.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |

### 3.207 `frontend/tests/receiptTemplate.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 7 |

### 3.208 `frontend/tests/storagePolicy.test.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 13 |

### 3.209 `frontend/vite.config.mjs`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fixCrossorigin` | function | 29 |
| 2 | `manualChunks` | function | 54 |

### 3.210 `ops/scripts/backend/verify-data-integrity.js`

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

### 3.211 `ops/scripts/frontend/verify-i18n.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `collectUsedKeys` | function | 29 |
| 2 | `flattenTranslationTree` | function | 69 |
| 3 | `listMissing` | function | 83 |
| 4 | `listEmptyValues` | function | 88 |
| 5 | `printList` | function | 95 |
| 6 | `main` | function | 102 |

### 3.212 `ops/scripts/generate-doc-reference.js`

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

### 3.213 `ops/scripts/generate-full-project-docs.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ensureDir` | function | 48 |
| 2 | `toPosix` | function | 52 |
| 3 | `rel` | function | 56 |
| 4 | `shouldSkipDir` | function | 60 |
| 5 | `collectFilesAndFolders` | function | 64 |
| 6 | `getAllProjectFilesAndFolders` | function | 85 |
| 7 | `isProbablyText` | function | 108 |
| 8 | `readText` | function | 121 |
| 9 | `lineCount` | function | 129 |
| 10 | `fileCategory` | function | 134 |
| 11 | `inferPurpose` | function | 154 |
| 12 | `markdownHeader` | function | 179 |
| 13 | `markdownSection` | function | 183 |
| 14 | `extractImportsExports` | function | 187 |
| 15 | `findSymbols` | function | 227 |
| 16 | `writeAllFunctionReference` | function | 253 |
| 17 | `resolveInternalImport` | function | 291 |
| 18 | `writeAllFileInventory` | function | 314 |
| 19 | `folderPurpose` | function | 336 |
| 20 | `writeFolderCoverage` | function | 351 |
| 21 | `writeImportExportReference` | function | 410 |
| 22 | `readJsonObject` | function | 484 |
| 23 | `translationSectionForKey` | function | 492 |
| 24 | `writeTranslationSectionReference` | function | 543 |
| 25 | `writeMainCoverageSummary` | function | 592 |
| 26 | `main` | function | 621 |

### 3.214 `ops/scripts/lib/fs-utils.js`

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

### 3.215 `ops/scripts/performance-scan.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `kb` | function | 43 |
| 2 | `topN` | function | 48 |
| 3 | `main` | function | 56 |

### 3.216 `ops/scripts/verify-runtime-deps.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readJson` | function | 22 |
| 2 | `assertTrackedFile` | function | 26 |
| 3 | `hasLockDependency` | function | 32 |
| 4 | `main` | function | 38 |

