# Import / Export Reference

Auto-generated import/export and dependency-link coverage for frontend/backend code files.

## 1. Coverage Summary

Code files documented: **471**

## 2. Dependency Matrix

| No. | File | Imports | Exports | Internal deps | Referenced by |
|---:|---|---:|---:|---:|---:|
| 1 | `backend/server.js` | 47 | 0 | 40 | 0 |
| 2 | `backend/src/accessControl.js` | 2 | 1 | 2 | 4 |
| 3 | `backend/src/analytics/duckdbRuntime.js` | 2 | 1 | 1 | 4 |
| 4 | `backend/src/authOtpGuards.js` | 1 | 1 | 1 | 2 |
| 5 | `backend/src/backupSchema.js` | 0 | 1 | 0 | 3 |
| 6 | `backend/src/businessMetrics.js` | 1 | 1 | 1 | 5 |
| 7 | `backend/src/catalogTextIntegrity.js` | 0 | 1 | 0 | 7 |
| 8 | `backend/src/config/index.js` | 4 | 1 | 1 | 25 |
| 9 | `backend/src/conflictControl.js` | 0 | 1 | 0 | 12 |
| 10 | `backend/src/contactOptions.js` | 0 | 1 | 0 | 3 |
| 11 | `backend/src/database.js` | 1 | 1 | 1 | 40 |
| 12 | `backend/src/dataPath/index.js` | 2 | 1 | 0 | 5 |
| 13 | `backend/src/db/cutoverReadiness.js` | 2 | 1 | 0 | 2 |
| 14 | `backend/src/db/postgresQueryCompat.js` | 0 | 1 | 0 | 2 |
| 15 | `backend/src/fileAssets.js` | 12 | 1 | 7 | 15 |
| 16 | `backend/src/helpers.js` | 4 | 1 | 4 | 23 |
| 17 | `backend/src/idempotency.js` | 0 | 1 | 0 | 5 |
| 18 | `backend/src/importCsv.js` | 1 | 1 | 0 | 3 |
| 19 | `backend/src/importParsing.js` | 1 | 1 | 1 | 3 |
| 20 | `backend/src/initials.js` | 0 | 1 | 0 | 4 |
| 21 | `backend/src/maintenanceLock.js` | 0 | 1 | 0 | 3 |
| 22 | `backend/src/middleware.js` | 10 | 1 | 7 | 24 |
| 23 | `backend/src/money.js` | 0 | 1 | 0 | 5 |
| 24 | `backend/src/netSecurity.js` | 1 | 1 | 0 | 5 |
| 25 | `backend/src/objectStore.js` | 7 | 1 | 1 | 6 |
| 26 | `backend/src/optionalSharp.js` | 1 | 1 | 0 | 2 |
| 27 | `backend/src/organizationContext/index.js` | 7 | 1 | 4 | 6 |
| 28 | `backend/src/permissions.js` | 0 | 1 | 0 | 4 |
| 29 | `backend/src/portalUtils.js` | 0 | 1 | 0 | 2 |
| 30 | `backend/src/postgresDatabase.js` | 7 | 1 | 3 | 2 |
| 31 | `backend/src/productBatches.js` | 1 | 1 | 1 | 6 |
| 32 | `backend/src/productDiscounts.js` | 1 | 1 | 1 | 3 |
| 33 | `backend/src/productImportPolicies.js` | 1 | 1 | 1 | 3 |
| 34 | `backend/src/requestContext.js` | 1 | 1 | 0 | 2 |
| 35 | `backend/src/routes/actionHistory.js` | 5 | 1 | 4 | 1 |
| 36 | `backend/src/routes/ai.js` | 6 | 1 | 5 | 1 |
| 37 | `backend/src/routes/auth.js` | 18 | 1 | 13 | 2 |
| 38 | `backend/src/routes/branches.js` | 8 | 1 | 6 | 1 |
| 39 | `backend/src/routes/catalog.js` | 4 | 1 | 3 | 1 |
| 40 | `backend/src/routes/categories.js` | 6 | 1 | 5 | 1 |
| 41 | `backend/src/routes/contacts.js` | 6 | 1 | 5 | 1 |
| 42 | `backend/src/routes/customTables.js` | 6 | 1 | 5 | 1 |
| 43 | `backend/src/routes/files.js` | 6 | 1 | 5 | 1 |
| 44 | `backend/src/routes/importJobs.js` | 9 | 1 | 5 | 1 |
| 45 | `backend/src/routes/inventory.js` | 12 | 1 | 11 | 2 |
| 46 | `backend/src/routes/notifications.js` | 5 | 1 | 4 | 2 |
| 47 | `backend/src/routes/organizations.js` | 3 | 1 | 2 | 1 |
| 48 | `backend/src/routes/portal.js` | 13 | 1 | 12 | 2 |
| 49 | `backend/src/routes/products.js` | 20 | 1 | 17 | 2 |
| 50 | `backend/src/routes/returns.js` | 7 | 1 | 6 | 1 |
| 51 | `backend/src/routes/runtime.js` | 9 | 1 | 8 | 1 |
| 52 | `backend/src/routes/sales.js` | 8 | 1 | 7 | 1 |
| 53 | `backend/src/routes/settings.js` | 9 | 1 | 8 | 1 |
| 54 | `backend/src/routes/sync.js` | 7 | 1 | 3 | 1 |
| 55 | `backend/src/routes/system/index.js` | 24 | 1 | 20 | 2 |
| 56 | `backend/src/routes/units.js` | 6 | 1 | 5 | 1 |
| 57 | `backend/src/routes/users.js` | 11 | 1 | 9 | 1 |
| 58 | `backend/src/runtimeCache.js` | 2 | 1 | 1 | 4 |
| 59 | `backend/src/runtimeState/index.js` | 4 | 1 | 1 | 2 |
| 60 | `backend/src/runtimeVersion.js` | 5 | 1 | 1 | 4 |
| 61 | `backend/src/schemaMetadata.js` | 1 | 1 | 1 | 6 |
| 62 | `backend/src/security.js` | 1 | 1 | 0 | 7 |
| 63 | `backend/src/serverUtils.js` | 1 | 1 | 1 | 4 |
| 64 | `backend/src/services/aiGateway.js` | 2 | 1 | 2 | 2 |
| 65 | `backend/src/services/backupPackages.js` | 9 | 1 | 4 | 4 |
| 66 | `backend/src/services/firebaseAuth.js` | 2 | 1 | 0 | 0 |
| 67 | `backend/src/services/googleDriveSync/index.js` | 12 | 1 | 8 | 4 |
| 68 | `backend/src/services/googleDriveSync/versioning.js` | 0 | 1 | 0 | 2 |
| 69 | `backend/src/services/googleOauth.js` | 2 | 1 | 1 | 4 |
| 70 | `backend/src/services/importJobs.js` | 20 | 1 | 14 | 7 |
| 71 | `backend/src/services/integrationDoctor.js` | 10 | 1 | 8 | 2 |
| 72 | `backend/src/services/mediaQueue.js` | 5 | 1 | 3 | 5 |
| 73 | `backend/src/services/portalAi.js` | 2 | 1 | 2 | 1 |
| 74 | `backend/src/services/verification.js` | 2 | 1 | 1 | 2 |
| 75 | `backend/src/sessionAuth.js` | 2 | 1 | 1 | 4 |
| 76 | `backend/src/settingsSnapshot.js` | 4 | 1 | 2 | 8 |
| 77 | `backend/src/storage/organizationFolders.js` | 2 | 1 | 0 | 2 |
| 78 | `backend/src/systemFsWorker.js` | 3 | 0 | 1 | 0 |
| 79 | `backend/src/systemJobs.js` | 2 | 1 | 1 | 2 |
| 80 | `backend/src/uploadReferenceCleanup.js` | 1 | 1 | 1 | 2 |
| 81 | `backend/src/uploadSecurity.js` | 2 | 1 | 1 | 4 |
| 82 | `backend/src/websocket.js` | 5 | 1 | 3 | 1 |
| 83 | `backend/src/workers/importWorker.js` | 2 | 1 | 2 | 1 |
| 84 | `backend/src/workers/mediaWorker.js` | 2 | 1 | 2 | 1 |
| 85 | `backend/test/accessControl.test.ts` | 2 | 0 | 1 | 0 |
| 86 | `backend/test/analyticsRuntime.test.ts` | 2 | 0 | 1 | 0 |
| 87 | `backend/test/authOtpGuards.test.ts` | 2 | 0 | 1 | 0 |
| 88 | `backend/test/authSecurityFlow.test.ts` | 8 | 0 | 1 | 0 |
| 89 | `backend/test/backupDefaultDestination.test.ts` | 3 | 0 | 0 | 0 |
| 90 | `backend/test/backupPerformanceHardening.test.ts` | 3 | 0 | 0 | 0 |
| 91 | `backend/test/backupRetention.test.ts` | 5 | 0 | 1 | 0 |
| 92 | `backend/test/backupSchema.test.ts` | 4 | 0 | 1 | 0 |
| 93 | `backend/test/branchStockSearch.test.ts` | 6 | 0 | 0 | 0 |
| 94 | `backend/test/contactOptions.test.ts` | 2 | 0 | 1 | 0 |
| 95 | `backend/test/dataPath.test.ts` | 5 | 0 | 1 | 0 |
| 96 | `backend/test/defaultRoles.test.ts` | 6 | 0 | 0 | 0 |
| 97 | `backend/test/fileAssetStorageReconcile.test.ts` | 2 | 0 | 1 | 0 |
| 98 | `backend/test/fileAssetUsageCache.test.ts` | 3 | 0 | 2 | 0 |
| 99 | `backend/test/fileRouteSecurityFlow.test.ts` | 6 | 0 | 0 | 0 |
| 100 | `backend/test/fullAutomation.test.ts` | 3 | 0 | 0 | 0 |
| 101 | `backend/test/googleDriveSyncVersioning.test.ts` | 4 | 0 | 1 | 0 |
| 102 | `backend/test/idempotency.test.ts` | 2 | 0 | 1 | 0 |
| 103 | `backend/test/importCsv.test.ts` | 6 | 0 | 2 | 0 |
| 104 | `backend/test/importDecisionIntegrity.test.ts` | 3 | 0 | 0 | 0 |
| 105 | `backend/test/importJobPerformanceHardening.test.ts` | 3 | 0 | 0 | 0 |
| 106 | `backend/test/importJobStateMachine.test.ts` | 8 | 0 | 4 | 0 |
| 107 | `backend/test/importScaleSmoke.test.ts` | 6 | 0 | 2 | 0 |
| 108 | `backend/test/initials.test.ts` | 2 | 0 | 1 | 0 |
| 109 | `backend/test/integrationDoctor.test.ts` | 2 | 0 | 1 | 0 |
| 110 | `backend/test/inventorySettingsMediaContracts.test.ts` | 3 | 0 | 0 | 0 |
| 111 | `backend/test/mediaOptimization.test.ts` | 3 | 0 | 1 | 0 |
| 112 | `backend/test/netSecurity.test.ts` | 2 | 0 | 1 | 0 |
| 113 | `backend/test/notificationSummaryCache.test.ts` | 2 | 0 | 1 | 0 |
| 114 | `backend/test/offlineSecurity.test.ts` | 3 | 0 | 0 | 0 |
| 115 | `backend/test/ownedGoogleAuth.test.ts` | 4 | 0 | 1 | 0 |
| 116 | `backend/test/permissionPolicy.test.ts` | 2 | 0 | 1 | 0 |
| 117 | `backend/test/portalInventoryRegression.test.ts` | 3 | 0 | 0 | 0 |
| 118 | `backend/test/portalUtils.test.ts` | 2 | 0 | 1 | 0 |
| 119 | `backend/test/postgresCutoverReadiness.test.ts` | 3 | 0 | 1 | 0 |
| 120 | `backend/test/postgresDatabase.test.ts` | 4 | 0 | 1 | 0 |
| 121 | `backend/test/postgresQueryCompat.test.ts` | 2 | 0 | 1 | 0 |
| 122 | `backend/test/productBatchHierarchy.test.ts` | 3 | 0 | 0 | 0 |
| 123 | `backend/test/productExpiry.test.ts` | 3 | 0 | 0 | 0 |
| 124 | `backend/test/productImportPolicies.test.ts` | 2 | 0 | 1 | 0 |
| 125 | `backend/test/productSearchPagination.test.ts` | 3 | 0 | 0 | 0 |
| 126 | `backend/test/rfidRoutes.test.ts` | 3 | 0 | 0 | 0 |
| 127 | `backend/test/routeContracts.test.ts` | 10 | 0 | 5 | 0 |
| 128 | `backend/test/runtimeCache.test.ts` | 5 | 0 | 1 | 0 |
| 129 | `backend/test/runtimeVersion.test.ts` | 5 | 0 | 1 | 0 |
| 130 | `backend/test/schemaMetadata.test.ts` | 2 | 0 | 1 | 0 |
| 131 | `backend/test/serverUtils.test.ts` | 3 | 0 | 2 | 0 |
| 132 | `backend/test/settingsSnapshotObjectStorage.test.ts` | 3 | 0 | 2 | 0 |
| 133 | `backend/test/systemJobs.test.ts` | 2 | 0 | 1 | 0 |
| 134 | `backend/test/uploadSecurity.test.ts` | 3 | 0 | 2 | 0 |
| 135 | `frontend/public/runtime-noise-guard.js` | 0 | 0 | 0 | 0 |
| 136 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.js` | 0 | 0 | 0 | 0 |
| 137 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.worker.js` | 0 | 0 | 0 | 0 |
| 138 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd-threads.js` | 0 | 0 | 0 | 0 |
| 139 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd.js` | 0 | 0 | 0 | 0 |
| 140 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core.js` | 0 | 0 | 0 | 0 |
| 141 | `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js` | 0 | 0 | 0 | 0 |
| 142 | `frontend/public/sw.js` | 0 | 0 | 0 | 0 |
| 143 | `frontend/public/theme-bootstrap.js` | 0 | 0 | 0 | 0 |
| 144 | `frontend/src/api/http.js` | 0 | 0 | 0 | 8 |
| 145 | `frontend/src/api/http.ts` | 2 | 32 | 2 | 0 |
| 146 | `frontend/src/api/localDb.js` | 0 | 0 | 0 | 3 |
| 147 | `frontend/src/api/localDb.ts` | 3 | 10 | 2 | 0 |
| 148 | `frontend/src/api/methods.js` | 6 | 200 | 6 | 1 |
| 149 | `frontend/src/api/websocket.js` | 0 | 0 | 0 | 2 |
| 150 | `frontend/src/api/websocket.ts` | 2 | 4 | 2 | 0 |
| 151 | `frontend/src/App.jsx` | 32 | 1 | 29 | 1 |
| 152 | `frontend/src/app/appShellUtils.ts` | 0 | 16 | 0 | 5 |
| 153 | `frontend/src/app/publicErrorRecovery.ts` | 0 | 3 | 0 | 1 |
| 154 | `frontend/src/AppContext.jsx` | 14 | 5 | 13 | 52 |
| 155 | `frontend/src/components/auth/Login.jsx` | 5 | 1 | 4 | 1 |
| 156 | `frontend/src/components/branches/Branches.jsx` | 13 | 1 | 11 | 1 |
| 157 | `frontend/src/components/branches/BranchForm.jsx` | 2 | 1 | 1 | 1 |
| 158 | `frontend/src/components/branches/TransferModal.jsx` | 3 | 1 | 2 | 1 |
| 159 | `frontend/src/components/catalog/CatalogEditorSurface.jsx` | 5 | 1 | 4 | 1 |
| 160 | `frontend/src/components/catalog/CatalogImageField.jsx` | 2 | 1 | 1 | 1 |
| 161 | `frontend/src/components/catalog/CatalogPage.jsx` | 12 | 1 | 11 | 1 |
| 162 | `frontend/src/components/catalog/CatalogPageContext.jsx` | 1 | 2 | 0 | 2 |
| 163 | `frontend/src/components/catalog/CatalogPreviewSurface.jsx` | 6 | 1 | 4 | 1 |
| 164 | `frontend/src/components/catalog/CatalogProductsSection.jsx` | 8 | 1 | 6 | 1 |
| 165 | `frontend/src/components/catalog/CatalogSecondaryTabs.jsx` | 2 | 1 | 1 | 1 |
| 166 | `frontend/src/components/catalog/catalogUi.jsx` | 1 | 3 | 0 | 4 |
| 167 | `frontend/src/components/catalog/portalCatalogDisplay.ts` | 1 | 7 | 1 | 1 |
| 168 | `frontend/src/components/catalog/portalContentI18n.ts` | 1 | 6 | 1 | 0 |
| 169 | `frontend/src/components/catalog/portalEditorUtils.ts` | 0 | 9 | 0 | 0 |
| 170 | `frontend/src/components/catalog/portalLanguagePacks.ts` | 0 | 4 | 0 | 1 |
| 171 | `frontend/src/components/catalog/portalTranslateController.ts` | 0 | 19 | 0 | 0 |
| 172 | `frontend/src/components/contacts/ContactImportModal.jsx` | 8 | 1 | 7 | 4 |
| 173 | `frontend/src/components/contacts/contactImportWorker.ts` | 1 | 0 | 1 | 0 |
| 174 | `frontend/src/components/contacts/contactOptionUtils.ts` | 0 | 9 | 0 | 0 |
| 175 | `frontend/src/components/contacts/Contacts.jsx` | 12 | 1 | 10 | 1 |
| 176 | `frontend/src/components/contacts/CustomerFormModal.jsx` | 3 | 1 | 2 | 1 |
| 177 | `frontend/src/components/contacts/customerMembershipNumber.ts` | 0 | 1 | 0 | 2 |
| 178 | `frontend/src/components/contacts/CustomersTab.jsx` | 17 | 2 | 15 | 2 |
| 179 | `frontend/src/components/contacts/DeliveryTab.jsx` | 16 | 2 | 14 | 1 |
| 180 | `frontend/src/components/contacts/shared.jsx` | 7 | 6 | 5 | 3 |
| 181 | `frontend/src/components/contacts/SuppliersTab.jsx` | 16 | 0 | 14 | 1 |
| 182 | `frontend/src/components/custom-tables/CustomTables.jsx` | 6 | 1 | 5 | 0 |
| 183 | `frontend/src/components/dashboard/charts/BarChart.jsx` | 3 | 1 | 2 | 0 |
| 184 | `frontend/src/components/dashboard/charts/DonutChart.jsx` | 3 | 1 | 2 | 0 |
| 185 | `frontend/src/components/dashboard/charts/index.ts` | 0 | 0 | 0 | 2 |
| 186 | `frontend/src/components/dashboard/charts/LineChart.jsx` | 3 | 1 | 2 | 0 |
| 187 | `frontend/src/components/dashboard/charts/NoData.jsx` | 1 | 1 | 1 | 3 |
| 188 | `frontend/src/components/dashboard/Dashboard.jsx` | 16 | 1 | 14 | 1 |
| 189 | `frontend/src/components/dashboard/MiniStat.jsx` | 0 | 1 | 0 | 1 |
| 190 | `frontend/src/components/files/FilePickerModal.jsx` | 4 | 1 | 3 | 5 |
| 191 | `frontend/src/components/files/FilesPage.jsx` | 11 | 1 | 10 | 1 |
| 192 | `frontend/src/components/files/FilesProvidersTab.jsx` | 0 | 1 | 0 | 1 |
| 193 | `frontend/src/components/files/FilesResponsesTab.jsx` | 0 | 1 | 0 | 1 |
| 194 | `frontend/src/components/inventory/DualMoney.jsx` | 0 | 1 | 0 | 1 |
| 195 | `frontend/src/components/inventory/Inventory.jsx` | 30 | 1 | 28 | 1 |
| 196 | `frontend/src/components/inventory/InventoryImportModal.jsx` | 5 | 1 | 4 | 1 |
| 197 | `frontend/src/components/inventory/inventoryImportWorker.ts` | 1 | 0 | 1 | 0 |
| 198 | `frontend/src/components/inventory/InventoryMovementsSurface.jsx` | 4 | 1 | 2 | 1 |
| 199 | `frontend/src/components/inventory/InventoryProductsSurface.jsx` | 4 | 1 | 2 | 1 |
| 200 | `frontend/src/components/inventory/InventoryRfidSurface.jsx` | 0 | 1 | 0 | 1 |
| 201 | `frontend/src/components/inventory/movementGroups.ts` | 0 | 4 | 0 | 2 |
| 202 | `frontend/src/components/inventory/ProductDetailModal.jsx` | 2 | 1 | 2 | 1 |
| 203 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | 7 | 1 | 5 | 1 |
| 204 | `frontend/src/components/navigation/Sidebar.jsx` | 7 | 1 | 6 | 1 |
| 205 | `frontend/src/components/pos/CartItem.jsx` | 2 | 1 | 2 | 1 |
| 206 | `frontend/src/components/pos/FilterPanel.jsx` | 1 | 1 | 0 | 1 |
| 207 | `frontend/src/components/pos/POS.jsx` | 18 | 1 | 16 | 1 |
| 208 | `frontend/src/components/pos/posCore.ts` | 3 | 9 | 3 | 0 |
| 209 | `frontend/src/components/pos/ProductImage.jsx` | 1 | 1 | 1 | 1 |
| 210 | `frontend/src/components/pos/QuickAddModal.jsx` | 0 | 1 | 0 | 1 |
| 211 | `frontend/src/components/products/config/productPageConfig.ts` | 0 | 9 | 0 | 0 |
| 212 | `frontend/src/components/products/forms/BranchStockAdjuster.jsx` | 3 | 1 | 2 | 1 |
| 213 | `frontend/src/components/products/forms/BulkAddStockModal.jsx` | 3 | 1 | 2 | 1 |
| 214 | `frontend/src/components/products/forms/ProductForm.jsx` | 9 | 1 | 7 | 1 |
| 215 | `frontend/src/components/products/forms/VariantFormModal.jsx` | 8 | 1 | 7 | 1 |
| 216 | `frontend/src/components/products/helpers/productDisplayHelpers.ts` | 1 | 7 | 1 | 0 |
| 217 | `frontend/src/components/products/helpers/productFilterHelpers.ts` | 2 | 4 | 2 | 0 |
| 218 | `frontend/src/components/products/helpers/productGalleryHelpers.ts` | 1 | 8 | 1 | 1 |
| 219 | `frontend/src/components/products/helpers/productGroupViewHelpers.ts` | 0 | 2 | 0 | 0 |
| 220 | `frontend/src/components/products/helpers/productMenuHelpers.ts` | 0 | 4 | 0 | 0 |
| 221 | `frontend/src/components/products/helpers/productPageHelpers.ts` | 1 | 4 | 0 | 0 |
| 222 | `frontend/src/components/products/helpers/productSelectionHelpers.ts` | 0 | 10 | 0 | 0 |
| 223 | `frontend/src/components/products/helpers/productWriteHelpers.ts` | 2 | 15 | 2 | 0 |
| 224 | `frontend/src/components/products/history/productHistoryHelpers.ts` | 0 | 2 | 0 | 2 |
| 225 | `frontend/src/components/products/import/BulkImportModal.jsx` | 6 | 1 | 4 | 1 |
| 226 | `frontend/src/components/products/import/productImportPlanner.ts` | 0 | 11 | 0 | 3 |
| 227 | `frontend/src/components/products/import/productImportWorker.ts` | 1 | 0 | 1 | 0 |
| 228 | `frontend/src/components/products/lookups/ManageBrandsModal.jsx` | 6 | 1 | 5 | 1 |
| 229 | `frontend/src/components/products/lookups/ManageCategoriesModal.jsx` | 6 | 1 | 5 | 1 |
| 230 | `frontend/src/components/products/lookups/ManageUnitsModal.jsx` | 6 | 1 | 5 | 1 |
| 231 | `frontend/src/components/products/lookups/productLookupSnapshots.ts` | 1 | 3 | 1 | 0 |
| 232 | `frontend/src/components/products/Products.jsx` | 32 | 1 | 30 | 1 |
| 233 | `frontend/src/components/products/scanning/barcodeImageScanner.ts` | 1 | 1 | 0 | 2 |
| 234 | `frontend/src/components/products/scanning/BarcodeScannerModal.jsx` | 7 | 1 | 4 | 1 |
| 235 | `frontend/src/components/products/scanning/barcodeScannerState.ts` | 0 | 1 | 0 | 2 |
| 236 | `frontend/src/components/products/scanning/scanbotScanner.ts` | 0 | 3 | 0 | 2 |
| 237 | `frontend/src/components/products/shared/primitives.jsx` | 3 | 0 | 1 | 9 |
| 238 | `frontend/src/components/products/surfaces/HeaderActions.jsx` | 3 | 1 | 2 | 1 |
| 239 | `frontend/src/components/products/surfaces/ProductDetailModal.jsx` | 5 | 1 | 4 | 1 |
| 240 | `frontend/src/components/products/surfaces/ProductRowParts.jsx` | 3 | 4 | 3 | 0 |
| 241 | `frontend/src/components/products/surfaces/ProductsListSurface.jsx` | 2 | 1 | 0 | 1 |
| 242 | `frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | 3 | 1 | 2 | 1 |
| 243 | `frontend/src/components/receipt-settings/constants.ts` | 0 | 3 | 0 | 4 |
| 244 | `frontend/src/components/receipt-settings/ErrorBoundary.jsx` | 1 | 1 | 0 | 1 |
| 245 | `frontend/src/components/receipt-settings/FieldOrderManager.jsx` | 2 | 1 | 0 | 1 |
| 246 | `frontend/src/components/receipt-settings/PrintSettings.jsx` | 3 | 1 | 1 | 1 |
| 247 | `frontend/src/components/receipt-settings/ReceiptPreview.jsx` | 3 | 1 | 2 | 1 |
| 248 | `frontend/src/components/receipt-settings/ReceiptSettings.jsx` | 12 | 1 | 10 | 1 |
| 249 | `frontend/src/components/receipt-settings/template.ts` | 1 | 2 | 1 | 3 |
| 250 | `frontend/src/components/receipt/Receipt.jsx` | 7 | 1 | 5 | 3 |
| 251 | `frontend/src/components/returns/EditReturnModal.jsx` | 4 | 1 | 3 | 1 |
| 252 | `frontend/src/components/returns/NewReturnModal.jsx` | 4 | 1 | 3 | 1 |
| 253 | `frontend/src/components/returns/NewSupplierReturnModal.jsx` | 3 | 1 | 2 | 1 |
| 254 | `frontend/src/components/returns/ReturnDetailModal.jsx` | 2 | 1 | 2 | 1 |
| 255 | `frontend/src/components/returns/Returns.jsx` | 19 | 1 | 17 | 1 |
| 256 | `frontend/src/components/returns/ReturnsListSurface.jsx` | 2 | 1 | 0 | 1 |
| 257 | `frontend/src/components/sales/ExportModal.jsx` | 5 | 1 | 3 | 1 |
| 258 | `frontend/src/components/sales/SaleDetailModal.jsx` | 3 | 1 | 2 | 1 |
| 259 | `frontend/src/components/sales/Sales.jsx` | 21 | 1 | 19 | 1 |
| 260 | `frontend/src/components/sales/SalesImportModal.jsx` | 5 | 1 | 4 | 1 |
| 261 | `frontend/src/components/sales/salesImportWorker.ts` | 1 | 0 | 1 | 0 |
| 262 | `frontend/src/components/sales/SalesListSurface.jsx` | 3 | 1 | 1 | 1 |
| 263 | `frontend/src/components/sales/StatusBadge.jsx` | 0 | 5 | 0 | 6 |
| 264 | `frontend/src/components/server/ServerPage.jsx` | 5 | 1 | 4 | 1 |
| 265 | `frontend/src/components/shared/ActionHistoryBar.jsx` | 3 | 1 | 1 | 17 |
| 266 | `frontend/src/components/shared/BackgroundImportTracker.jsx` | 7 | 1 | 5 | 1 |
| 267 | `frontend/src/components/shared/ExportMenu.jsx` | 2 | 1 | 1 | 7 |
| 268 | `frontend/src/components/shared/FilterMenu.jsx` | 2 | 1 | 1 | 8 |
| 269 | `frontend/src/components/shared/globalScroll.ts` | 0 | 2 | 0 | 2 |
| 270 | `frontend/src/components/shared/ImageGalleryLightbox.jsx` | 2 | 1 | 0 | 3 |
| 271 | `frontend/src/components/shared/LoadingWatchdog.jsx` | 1 | 1 | 0 | 6 |
| 272 | `frontend/src/components/shared/Modal.jsx` | 0 | 1 | 0 | 22 |
| 273 | `frontend/src/components/shared/navigationConfig.ts` | 0 | 4 | 0 | 3 |
| 274 | `frontend/src/components/shared/NotificationCenter.jsx` | 4 | 1 | 1 | 2 |
| 275 | `frontend/src/components/shared/pageActivity.ts` | 2 | 1 | 1 | 15 |
| 276 | `frontend/src/components/shared/PageHeader.jsx` | 0 | 1 | 0 | 6 |
| 277 | `frontend/src/components/shared/PaginationControls.jsx` | 2 | 4 | 0 | 8 |
| 278 | `frontend/src/components/shared/PortalMenu.jsx` | 3 | 2 | 0 | 7 |
| 279 | `frontend/src/components/shared/QuickPreferenceToggles.jsx` | 2 | 1 | 1 | 3 |
| 280 | `frontend/src/components/shared/SectionSwitcher.jsx` | 1 | 1 | 0 | 4 |
| 281 | `frontend/src/components/shared/WriteConflictModal.jsx` | 1 | 1 | 1 | 1 |
| 282 | `frontend/src/components/users/PermissionEditor.jsx` | 0 | 3 | 0 | 2 |
| 283 | `frontend/src/components/users/UserDetailSheet.jsx` | 2 | 1 | 2 | 1 |
| 284 | `frontend/src/components/users/UserProfileModal.jsx` | 10 | 1 | 8 | 2 |
| 285 | `frontend/src/components/users/Users.jsx` | 14 | 1 | 12 | 1 |
| 286 | `frontend/src/components/utils-settings/AuditLog.jsx` | 10 | 1 | 8 | 1 |
| 287 | `frontend/src/components/utils-settings/Backup.jsx` | 10 | 1 | 8 | 1 |
| 288 | `frontend/src/components/utils-settings/FontFamilyPicker.jsx` | 1 | 1 | 0 | 1 |
| 289 | `frontend/src/components/utils-settings/index.ts` | 0 | 0 | 0 | 0 |
| 290 | `frontend/src/components/utils-settings/OtpModal.jsx` | 3 | 1 | 2 | 2 |
| 291 | `frontend/src/components/utils-settings/ResetData.jsx` | 6 | 0 | 4 | 1 |
| 292 | `frontend/src/components/utils-settings/Settings.jsx` | 13 | 1 | 11 | 1 |
| 293 | `frontend/src/components/utils-settings/settingsConflict.ts` | 0 | 2 | 0 | 2 |
| 294 | `frontend/src/constants.ts` | 0 | 12 | 0 | 8 |
| 295 | `frontend/src/index.jsx` | 9 | 0 | 4 | 0 |
| 296 | `frontend/src/platform/runtime/clientRuntime.ts` | 2 | 8 | 2 | 2 |
| 297 | `frontend/src/platform/storage/storagePolicy.ts` | 0 | 8 | 0 | 0 |
| 298 | `frontend/src/runtime/runtimeErrorClassifier.ts` | 0 | 8 | 0 | 0 |
| 299 | `frontend/src/types/jsx-modules.d.ts` | 0 | 3 | 0 | 0 |
| 300 | `frontend/src/types/react.d.ts` | 0 | 5 | 0 | 0 |
| 301 | `frontend/src/types/receiptContracts.ts` | 0 | 0 | 0 | 2 |
| 302 | `frontend/src/types/settingsContracts.ts` | 0 | 1 | 0 | 1 |
| 303 | `frontend/src/utils/actionGuards.ts` | 0 | 6 | 0 | 33 |
| 304 | `frontend/src/utils/actionHistory.ts` | 2 | 1 | 1 | 16 |
| 305 | `frontend/src/utils/appRefresh.ts` | 0 | 3 | 0 | 5 |
| 306 | `frontend/src/utils/bulkOps.ts` | 0 | 1 | 0 | 8 |
| 307 | `frontend/src/utils/color.ts` | 0 | 1 | 0 | 2 |
| 308 | `frontend/src/utils/csv.ts` | 0 | 8 | 0 | 14 |
| 309 | `frontend/src/utils/csvExportWorker.ts` | 1 | 0 | 1 | 0 |
| 310 | `frontend/src/utils/csvImport.ts` | 1 | 11 | 1 | 3 |
| 311 | `frontend/src/utils/csvRowCounter.ts` | 0 | 1 | 0 | 9 |
| 312 | `frontend/src/utils/dateHelpers.ts` | 0 | 2 | 0 | 2 |
| 313 | `frontend/src/utils/deviceInfo.ts` | 0 | 2 | 0 | 7 |
| 314 | `frontend/src/utils/exportPackage.ts` | 1 | 2 | 1 | 3 |
| 315 | `frontend/src/utils/exportReports.jsx` | 3 | 1 | 2 | 2 |
| 316 | `frontend/src/utils/favicon.ts` | 0 | 1 | 0 | 3 |
| 317 | `frontend/src/utils/formatters.ts` | 0 | 4 | 0 | 17 |
| 318 | `frontend/src/utils/groupedRecords.ts` | 1 | 8 | 1 | 10 |
| 319 | `frontend/src/utils/historyHelpers.ts` | 0 | 3 | 0 | 11 |
| 320 | `frontend/src/utils/importJobRefresh.ts` | 0 | 3 | 0 | 1 |
| 321 | `frontend/src/utils/index.ts` | 0 | 0 | 0 | 0 |
| 322 | `frontend/src/utils/initials.ts` | 0 | 7 | 0 | 7 |
| 323 | `frontend/src/utils/loaders.ts` | 0 | 9 | 0 | 20 |
| 324 | `frontend/src/utils/mediaUpload.ts` | 1 | 5 | 1 | 3 |
| 325 | `frontend/src/utils/permissions.ts` | 0 | 1 | 0 | 2 |
| 326 | `frontend/src/utils/pricing.ts` | 0 | 8 | 0 | 17 |
| 327 | `frontend/src/utils/printReceipt.ts` | 1 | 12 | 1 | 2 |
| 328 | `frontend/src/utils/productBatches.ts` | 0 | 2 | 0 | 5 |
| 329 | `frontend/src/utils/productGrouping.ts` | 1 | 4 | 1 | 4 |
| 330 | `frontend/src/utils/publicAssetUrls.ts` | 1 | 2 | 1 | 7 |
| 331 | `frontend/src/utils/receiptAppliedConfig.ts` | 1 | 9 | 1 | 3 |
| 332 | `frontend/src/utils/scriptTypography.ts` | 0 | 3 | 0 | 6 |
| 333 | `frontend/src/utils/settingsRefresh.ts` | 1 | 3 | 1 | 0 |
| 334 | `frontend/src/utils/settingsWriteOptions.ts` | 1 | 1 | 1 | 1 |
| 335 | `frontend/src/web-api.js` | 0 | 0 | 0 | 1 |
| 336 | `frontend/src/web-api.ts` | 6 | 0 | 6 | 0 |
| 337 | `frontend/tailwind.config.ts` | 1 | 0 | 0 | 0 |
| 338 | `frontend/tests/actionGuards.test.ts` | 1 | 0 | 0 | 0 |
| 339 | `frontend/tests/actionStability.test.ts` | 4 | 0 | 0 | 0 |
| 340 | `frontend/tests/adminShellMediaGuards.test.ts` | 2 | 0 | 0 | 0 |
| 341 | `frontend/tests/apiHttp.test.ts` | 2 | 0 | 0 | 0 |
| 342 | `frontend/tests/appRefresh.test.ts` | 2 | 0 | 1 | 0 |
| 343 | `frontend/tests/appShellUtils.test.ts` | 3 | 0 | 1 | 0 |
| 344 | `frontend/tests/assetCompression.test.ts` | 4 | 0 | 0 | 0 |
| 345 | `frontend/tests/backupJobs.test.ts` | 2 | 0 | 0 | 0 |
| 346 | `frontend/tests/barcodeImageScanner.test.ts` | 2 | 0 | 1 | 0 |
| 347 | `frontend/tests/barcodeScannerState.test.ts` | 2 | 0 | 1 | 0 |
| 348 | `frontend/tests/bulkOps.test.ts` | 2 | 0 | 1 | 0 |
| 349 | `frontend/tests/contactImportWorker.test.ts` | 3 | 0 | 1 | 0 |
| 350 | `frontend/tests/csvImport.test.ts` | 3 | 0 | 1 | 0 |
| 351 | `frontend/tests/dashboardDataReliability.test.ts` | 2 | 0 | 0 | 0 |
| 352 | `frontend/tests/dateHelpers.test.ts` | 2 | 0 | 1 | 0 |
| 353 | `frontend/tests/deviceInfo.test.ts` | 2 | 0 | 1 | 0 |
| 354 | `frontend/tests/exportPackages.test.ts` | 4 | 0 | 2 | 0 |
| 355 | `frontend/tests/formatters.test.ts` | 2 | 0 | 1 | 0 |
| 356 | `frontend/tests/globalScroll.test.ts` | 2 | 0 | 0 | 0 |
| 357 | `frontend/tests/globalScrollControls.test.ts` | 2 | 0 | 1 | 0 |
| 358 | `frontend/tests/groupedRecords.test.ts` | 2 | 0 | 1 | 0 |
| 359 | `frontend/tests/historyHelpers.test.ts` | 1 | 0 | 0 | 0 |
| 360 | `frontend/tests/importJobRefresh.test.ts` | 1 | 0 | 0 | 0 |
| 361 | `frontend/tests/initials.test.ts` | 1 | 0 | 0 | 0 |
| 362 | `frontend/tests/inventoryImportWorker.test.ts` | 3 | 0 | 1 | 0 |
| 363 | `frontend/tests/inventoryMobileCardLayout.test.ts` | 2 | 0 | 0 | 0 |
| 364 | `frontend/tests/inventoryMovementGroups.test.ts` | 2 | 0 | 1 | 0 |
| 365 | `frontend/tests/inventoryRfidSection.test.ts` | 2 | 0 | 0 | 0 |
| 366 | `frontend/tests/jsxSyntaxCheck.ts` | 5 | 0 | 0 | 0 |
| 367 | `frontend/tests/loaders.test.ts` | 1 | 0 | 0 | 0 |
| 368 | `frontend/tests/mediaUploadHelpers.test.ts` | 2 | 0 | 1 | 0 |
| 369 | `frontend/tests/navigationConfig.test.ts` | 2 | 0 | 1 | 0 |
| 370 | `frontend/tests/notificationBadge.test.ts` | 2 | 0 | 0 | 0 |
| 371 | `frontend/tests/offlineSalesQueue.test.ts` | 2 | 0 | 0 | 0 |
| 372 | `frontend/tests/offlineSecurityHardening.test.ts` | 2 | 0 | 0 | 0 |
| 373 | `frontend/tests/offlineSyncArchitecture.test.ts` | 2 | 0 | 0 | 0 |
| 374 | `frontend/tests/ownedGoogleAuth.test.ts` | 2 | 0 | 0 | 0 |
| 375 | `frontend/tests/performanceLoadingUx.test.ts` | 2 | 0 | 0 | 0 |
| 376 | `frontend/tests/permissionEditor.test.ts` | 2 | 0 | 0 | 0 |
| 377 | `frontend/tests/permissions.test.ts` | 2 | 0 | 1 | 0 |
| 378 | `frontend/tests/portalCatalogDisplay.test.ts` | 2 | 0 | 0 | 0 |
| 379 | `frontend/tests/portalContentI18n.test.ts` | 1 | 0 | 0 | 0 |
| 380 | `frontend/tests/portalEditorUtils.test.ts` | 1 | 0 | 0 | 0 |
| 381 | `frontend/tests/portalFaqVocabulary.test.ts` | 1 | 0 | 0 | 0 |
| 382 | `frontend/tests/portalLanguagePacks.test.ts` | 1 | 0 | 0 | 0 |
| 383 | `frontend/tests/portalTranslateController.test.ts` | 1 | 0 | 0 | 0 |
| 384 | `frontend/tests/posCore.test.ts` | 1 | 0 | 0 | 0 |
| 385 | `frontend/tests/pricingContacts.test.ts` | 3 | 0 | 1 | 0 |
| 386 | `frontend/tests/productBatches.test.ts` | 2 | 0 | 1 | 0 |
| 387 | `frontend/tests/productDiscountUx.test.ts` | 2 | 0 | 0 | 0 |
| 388 | `frontend/tests/productDisplayHelpers.test.ts` | 1 | 0 | 0 | 0 |
| 389 | `frontend/tests/productFilterHelpers.test.ts` | 1 | 0 | 0 | 0 |
| 390 | `frontend/tests/productGalleryHelpers.test.ts` | 1 | 0 | 0 | 0 |
| 391 | `frontend/tests/productGrouping.test.ts` | 2 | 0 | 1 | 0 |
| 392 | `frontend/tests/productGroupViewHelpers.test.ts` | 1 | 0 | 0 | 0 |
| 393 | `frontend/tests/productHistoryHelpers.test.ts` | 2 | 0 | 1 | 0 |
| 394 | `frontend/tests/productImportPlanner.test.ts` | 3 | 0 | 1 | 0 |
| 395 | `frontend/tests/productImportWorkerFallback.test.ts` | 3 | 0 | 1 | 0 |
| 396 | `frontend/tests/productMenuHelpers.test.ts` | 1 | 0 | 0 | 0 |
| 397 | `frontend/tests/productPageHelpers.test.ts` | 1 | 0 | 0 | 0 |
| 398 | `frontend/tests/productSearchPagination.test.ts` | 2 | 0 | 0 | 0 |
| 399 | `frontend/tests/productSelectionHelpers.test.ts` | 1 | 0 | 0 | 0 |
| 400 | `frontend/tests/productWriteHelpers.test.ts` | 1 | 0 | 0 | 0 |
| 401 | `frontend/tests/publicErrorRecovery.test.ts` | 1 | 0 | 0 | 0 |
| 402 | `frontend/tests/receiptSettingsSync.test.ts` | 2 | 0 | 0 | 0 |
| 403 | `frontend/tests/receiptTemplate.test.ts` | 4 | 0 | 2 | 0 |
| 404 | `frontend/tests/returnsLayout.test.ts` | 2 | 0 | 0 | 0 |
| 405 | `frontend/tests/runtimeErrorClassifier.test.ts` | 1 | 0 | 0 | 0 |
| 406 | `frontend/tests/salesImportWorker.test.ts` | 3 | 0 | 1 | 0 |
| 407 | `frontend/tests/scanbotScanner.test.ts` | 2 | 0 | 1 | 0 |
| 408 | `frontend/tests/scriptTypography.test.ts` | 2 | 0 | 1 | 0 |
| 409 | `frontend/tests/sectionNavigation.test.ts` | 2 | 0 | 0 | 0 |
| 410 | `frontend/tests/settingsConflictHelpers.test.ts` | 2 | 0 | 1 | 0 |
| 411 | `frontend/tests/settingsRefresh.test.ts` | 1 | 0 | 0 | 0 |
| 412 | `frontend/tests/storagePolicy.test.ts` | 1 | 0 | 0 | 0 |
| 413 | `frontend/tests/utilsSettingsBarrel.test.ts` | 2 | 0 | 0 | 0 |
| 414 | `frontend/vite.config.ts` | 8 | 1 | 0 | 0 |
| 415 | `ops/scripts/architecture/generated-bulk-audit.ts` | 4 | 0 | 2 | 0 |
| 416 | `ops/scripts/architecture/language-runtime-audit.ts` | 4 | 0 | 2 | 0 |
| 417 | `ops/scripts/architecture/organization-audit.ts` | 4 | 0 | 2 | 0 |
| 418 | `ops/scripts/architecture/phase29-audit.ts` | 5 | 0 | 2 | 0 |
| 419 | `ops/scripts/backend/schema-audit.ts` | 2 | 0 | 0 | 0 |
| 420 | `ops/scripts/backend/schema-primary-key-preflight.ts` | 3 | 0 | 0 | 0 |
| 421 | `ops/scripts/backend/verify-data-integrity.ts` | 3 | 0 | 0 | 0 |
| 422 | `ops/scripts/frontend/verify-i18n.ts` | 2 | 0 | 1 | 0 |
| 423 | `ops/scripts/frontend/verify-performance.ts` | 3 | 0 | 0 | 0 |
| 424 | `ops/scripts/frontend/verify-ui.ts` | 3 | 0 | 1 | 0 |
| 425 | `ops/scripts/lib/fs-utils.ts` | 2 | 1 | 0 | 13 |
| 426 | `ops/scripts/lib/report-utils.ts` | 1 | 1 | 0 | 5 |
| 427 | `ops/scripts/runtime/audits/action-history-undo-redo-check.ts` | 4 | 0 | 1 | 0 |
| 428 | `ops/scripts/runtime/audits/audit-auth.ts` | 0 | 4 | 0 | 18 |
| 429 | `ops/scripts/runtime/audits/audit-manifest.ts` | 0 | 7 | 0 | 3 |
| 430 | `ops/scripts/runtime/audits/audit-report-html.ts` | 4 | 3 | 1 | 3 |
| 431 | `ops/scripts/runtime/audits/deep-live-audit.ts` | 9 | 0 | 3 | 0 |
| 432 | `ops/scripts/runtime/audits/full-app-audit.ts` | 9 | 0 | 3 | 0 |
| 433 | `ops/scripts/runtime/browser-action-smoke.ts` | 8 | 0 | 3 | 0 |
| 434 | `ops/scripts/runtime/cloudflare/rotate-cloudflare-tunnel-token.ts` | 4 | 0 | 0 | 0 |
| 435 | `ops/scripts/runtime/cloudflare/update-cloudflare-tunnel-origin.ts` | 3 | 0 | 0 | 0 |
| 436 | `ops/scripts/runtime/cloudflare/verify-cloudflare-automation.ts` | 4 | 0 | 1 | 0 |
| 437 | `ops/scripts/runtime/cloudflare/verify-r2-object-store.ts` | 4 | 0 | 0 | 0 |
| 438 | `ops/scripts/runtime/live-checks/live-check-utils.ts` | 0 | 7 | 0 | 14 |
| 439 | `ops/scripts/runtime/live-checks/phase84-branches-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 440 | `ops/scripts/runtime/live-checks/phase84-contacts-live-check.ts` | 6 | 0 | 2 | 0 |
| 441 | `ops/scripts/runtime/live-checks/phase84-files-providers-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 442 | `ops/scripts/runtime/live-checks/phase84-inventory-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 443 | `ops/scripts/runtime/live-checks/phase84-live-suite.ts` | 4 | 0 | 0 | 0 |
| 444 | `ops/scripts/runtime/live-checks/phase84-product-brands-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 445 | `ops/scripts/runtime/live-checks/phase84-product-categories-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 446 | `ops/scripts/runtime/live-checks/phase84-product-page-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 447 | `ops/scripts/runtime/live-checks/phase84-product-scanning-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 448 | `ops/scripts/runtime/live-checks/phase84-product-stock-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 449 | `ops/scripts/runtime/live-checks/phase84-product-units-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 450 | `ops/scripts/runtime/live-checks/phase84-product-variant-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 451 | `ops/scripts/runtime/live-checks/phase84-public-portal-cloudflare-check.ts` | 4 | 0 | 0 | 0 |
| 452 | `ops/scripts/runtime/live-checks/phase84-sales-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 453 | `ops/scripts/runtime/live-checks/phase84-ui-live-check.ts` | 6 | 0 | 2 | 0 |
| 454 | `ops/scripts/runtime/live-checks/phase84-users-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 455 | `ops/scripts/runtime/smoke/check-public-url.ts` | 2 | 0 | 0 | 0 |
| 456 | `ops/scripts/runtime/smoke/check-route-contract.ts` | 0 | 0 | 0 | 0 |
| 457 | `ops/scripts/runtime/smoke/live-smoke.ts` | 5 | 0 | 0 | 0 |
| 458 | `ops/scripts/runtime/smoke/post-start-diagnostics.ts` | 2 | 0 | 0 | 0 |
| 459 | `ops/scripts/runtime/storage/cleanup-integrity-backlog.ts` | 3 | 0 | 0 | 0 |
| 460 | `ops/scripts/runtime/storage/cleanup-test-data.ts` | 3 | 0 | 0 | 0 |
| 461 | `ops/scripts/runtime/storage/dataset-readiness.ts` | 3 | 0 | 0 | 0 |
| 462 | `ops/scripts/runtime/storage/post-live-hygiene.ts` | 3 | 0 | 0 | 0 |
| 463 | `ops/scripts/runtime/storage/prune-storage.ts` | 4 | 0 | 0 | 0 |
| 464 | `ops/scripts/runtime/storage/restore-candidates.ts` | 2 | 0 | 0 | 0 |
| 465 | `ops/scripts/runtime/storage/restore-rehearsal.ts` | 3 | 0 | 0 | 0 |
| 466 | `ops/scripts/verification/verify-backup-reliability.ts` | 3 | 0 | 1 | 0 |
| 467 | `ops/scripts/verification/verify-docker-release.ts` | 3 | 0 | 1 | 0 |
| 468 | `ops/scripts/verification/verify-hardening-policy.ts` | 4 | 0 | 1 | 0 |
| 469 | `ops/scripts/verification/verify-runtime-deps.ts` | 3 | 0 | 1 | 0 |
| 470 | `ops/scripts/verification/verify-scale-services.ts` | 4 | 0 | 1 | 0 |
| 471 | `ops/scripts/verification/verify-secret-hygiene.ts` | 4 | 0 | 1 | 0 |

## 3. Detailed File Dependency Commentary

### 3.1 `backend/server.js`

- Declared exports: none detected
- Imports (47)
  - `./src/analytics/duckdbRuntime`
  - `./src/config`
  - `./src/database`
  - `./src/fileAssets`
  - `./src/helpers`
  - `./src/maintenanceLock`
  - `./src/middleware`
  - `./src/objectStore`
  - `./src/organizationContext`
  - `./src/productBatches`
  - `./src/requestContext`
  - `./src/routes/actionHistory`
  - `./src/routes/ai`
  - `./src/routes/auth`
  - `./src/routes/branches`
  - `./src/routes/catalog`
  - `./src/routes/categories`
  - `./src/routes/contacts`
  - `./src/routes/customTables`
  - `./src/routes/files`
  - `./src/routes/importJobs`
  - `./src/routes/inventory`
  - `./src/routes/notifications`
  - `./src/routes/organizations`
  - `./src/routes/portal`
  - `./src/routes/products`
  - `./src/routes/returns`
  - `./src/routes/runtime`
  - `./src/routes/sales`
  - `./src/routes/settings`
  - `./src/routes/sync`
  - `./src/routes/system`
  - `./src/routes/units`
  - `./src/routes/users`
  - `./src/runtimeVersion`
  - `./src/serverUtils`
  - `./src/services/importJobs`
  - `./src/websocket`
  - `./src/workers/importWorker`
  - `./src/workers/mediaWorker`
  - `compression`
  - `cors`
  - `express`
  - `fs`
  - `http`
  - `path`
  - `stream`
- Internal dependencies (40)
  - `backend/src/analytics/duckdbRuntime.js`
  - `backend/src/config/index.js`
  - `backend/src/database.js`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/maintenanceLock.js`
  - `backend/src/middleware.js`
  - `backend/src/objectStore.js`
  - `backend/src/organizationContext/index.js`
  - `backend/src/productBatches.js`
  - `backend/src/requestContext.js`
  - `backend/src/routes/actionHistory.js`
  - `backend/src/routes/ai.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/branches.js`
  - `backend/src/routes/catalog.js`
  - `backend/src/routes/categories.js`
  - `backend/src/routes/contacts.js`
  - `backend/src/routes/customTables.js`
  - `backend/src/routes/files.js`
  - `backend/src/routes/importJobs.js`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/notifications.js`
  - `backend/src/routes/organizations.js`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/returns.js`
  - `backend/src/routes/runtime.js`
  - `backend/src/routes/sales.js`
  - `backend/src/routes/settings.js`
  - `backend/src/routes/sync.js`
  - `backend/src/routes/system/index.js`
  - `backend/src/routes/units.js`
  - `backend/src/routes/users.js`
  - `backend/src/runtimeVersion.js`
  - `backend/src/serverUtils.js`
  - `backend/src/services/importJobs.js`
  - `backend/src/websocket.js`
  - `backend/src/workers/importWorker.js`
  - `backend/src/workers/mediaWorker.js`
- Referenced by (0)
  - none

### 3.2 `backend/src/accessControl.js`

- Declared exports: `module.exports`
- Imports (2)
  - `./config`
  - `./security`
- Internal dependencies (2)
  - `backend/src/config/index.js`
  - `backend/src/security.js`
- Referenced by (4)
  - `backend/src/middleware.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/system/index.js`
  - `backend/test/accessControl.test.ts`

### 3.3 `backend/src/analytics/duckdbRuntime.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../config`
  - `path`
- Internal dependencies (1)
  - `backend/src/config/index.js`
- Referenced by (4)
  - `backend/server.js`
  - `backend/src/routes/system/index.js`
  - `backend/src/services/integrationDoctor.js`
  - `backend/test/analyticsRuntime.test.ts`

### 3.4 `backend/src/authOtpGuards.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./middleware`
- Internal dependencies (1)
  - `backend/src/middleware.js`
- Referenced by (2)
  - `backend/src/routes/auth.js`
  - `backend/test/authOtpGuards.test.ts`

### 3.5 `backend/src/backupSchema.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `backend/src/routes/system/index.js`
  - `backend/src/services/backupPackages.js`
  - `backend/test/backupSchema.test.ts`

### 3.6 `backend/src/businessMetrics.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./database`
- Internal dependencies (1)
  - `backend/src/database.js`
- Referenced by (5)
  - `backend/src/routes/branches.js`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/notifications.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/sales.js`

### 3.7 `backend/src/catalogTextIntegrity.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (7)
  - `backend/src/routes/categories.js`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/runtime.js`
  - `backend/src/routes/settings.js`
  - `backend/src/routes/units.js`
  - `backend/src/services/importJobs.js`

### 3.8 `backend/src/config/index.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../storage/organizationFolders`
  - `dotenv`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `backend/src/storage/organizationFolders.js`
- Referenced by (25)
  - `backend/server.js`
  - `backend/src/accessControl.js`
  - `backend/src/analytics/duckdbRuntime.js`
  - `backend/src/fileAssets.js`
  - `backend/src/middleware.js`
  - `backend/src/objectStore.js`
  - `backend/src/organizationContext/index.js`
  - `backend/src/postgresDatabase.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/importJobs.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/sync.js`
  - `backend/src/routes/system/index.js`
  - `backend/src/runtimeCache.js`
  - `backend/src/runtimeState/index.js`
  - `backend/src/serverUtils.js`
  - `backend/src/services/backupPackages.js`
  - `backend/src/services/googleDriveSync/index.js`
  - `backend/src/services/googleOauth.js`
  - `backend/src/services/importJobs.js`
  - `backend/src/services/integrationDoctor.js`
  - `backend/src/services/mediaQueue.js`
  - `backend/src/settingsSnapshot.js`
  - `backend/test/importJobStateMachine.test.ts`
  - `backend/test/serverUtils.test.ts`

### 3.9 `backend/src/conflictControl.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (12)
  - `backend/src/routes/ai.js`
  - `backend/src/routes/branches.js`
  - `backend/src/routes/categories.js`
  - `backend/src/routes/contacts.js`
  - `backend/src/routes/customTables.js`
  - `backend/src/routes/files.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/returns.js`
  - `backend/src/routes/sales.js`
  - `backend/src/routes/settings.js`
  - `backend/src/routes/units.js`
  - `backend/src/routes/users.js`

### 3.10 `backend/src/contactOptions.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `backend/src/routes/contacts.js`
  - `backend/src/services/importJobs.js`
  - `backend/test/contactOptions.test.ts`

### 3.11 `backend/src/database.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./postgresDatabase`
- Internal dependencies (1)
  - `backend/src/postgresDatabase.js`
- Referenced by (40)
  - `backend/server.js`
  - `backend/src/businessMetrics.js`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/organizationContext/index.js`
  - `backend/src/productBatches.js`
  - `backend/src/routes/actionHistory.js`
  - `backend/src/routes/ai.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/branches.js`
  - `backend/src/routes/catalog.js`
  - `backend/src/routes/categories.js`
  - `backend/src/routes/contacts.js`
  - `backend/src/routes/customTables.js`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/notifications.js`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/returns.js`
  - `backend/src/routes/runtime.js`
  - `backend/src/routes/sales.js`
  - `backend/src/routes/settings.js`
  - `backend/src/routes/system/index.js`
  - `backend/src/routes/units.js`
  - `backend/src/routes/users.js`
  - `backend/src/schemaMetadata.js`
  - `backend/src/services/backupPackages.js`
  - `backend/src/services/googleDriveSync/index.js`
  - `backend/src/services/importJobs.js`
  - `backend/src/services/integrationDoctor.js`
  - `backend/src/services/mediaQueue.js`
  - `backend/src/services/portalAi.js`
  - `backend/src/services/verification.js`
  - `backend/src/sessionAuth.js`
  - `backend/src/systemJobs.js`
  - `backend/src/workers/importWorker.js`
  - `backend/src/workers/mediaWorker.js`
  - `backend/test/authSecurityFlow.test.ts`
  - `backend/test/fileAssetUsageCache.test.ts`
  - `backend/test/importJobStateMachine.test.ts`

### 3.12 `backend/src/dataPath/index.js`

- Declared exports: `module.exports`
- Imports (2)
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `backend/src/organizationContext/index.js`
  - `backend/src/routes/system/index.js`
  - `backend/src/services/googleDriveSync/index.js`
  - `backend/src/systemFsWorker.js`
  - `backend/test/dataPath.test.ts`

### 3.13 `backend/src/db/cutoverReadiness.js`

- Declared exports: `module.exports`
- Imports (2)
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/routes/system/index.js`
  - `backend/test/postgresCutoverReadiness.test.ts`

### 3.14 `backend/src/db/postgresQueryCompat.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/postgresDatabase.js`
  - `backend/test/postgresQueryCompat.test.ts`

### 3.15 `backend/src/fileAssets.js`

- Declared exports: `module.exports`
- Imports (12)
  - `./config`
  - `./database`
  - `./objectStore`
  - `./optionalSharp`
  - `./settingsSnapshot`
  - `./uploadReferenceCleanup`
  - `./uploadSecurity`
  - `child_process`
  - `crypto`
  - `fs`
  - `path`
  - `stream/promises`
- Internal dependencies (7)
  - `backend/src/config/index.js`
  - `backend/src/database.js`
  - `backend/src/objectStore.js`
  - `backend/src/optionalSharp.js`
  - `backend/src/settingsSnapshot.js`
  - `backend/src/uploadReferenceCleanup.js`
  - `backend/src/uploadSecurity.js`
- Referenced by (15)
  - `backend/server.js`
  - `backend/src/middleware.js`
  - `backend/src/routes/files.js`
  - `backend/src/routes/importJobs.js`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/settings.js`
  - `backend/src/routes/system/index.js`
  - `backend/src/routes/users.js`
  - `backend/src/services/importJobs.js`
  - `backend/src/services/mediaQueue.js`
  - `backend/test/fileAssetStorageReconcile.test.ts`
  - `backend/test/fileAssetUsageCache.test.ts`
  - `backend/test/mediaOptimization.test.ts`
  - `backend/test/uploadSecurity.test.ts`

### 3.16 `backend/src/helpers.js`

- Declared exports: `module.exports`
- Imports (4)
  - `./database`
  - `./requestContext`
  - `./runtimeCache`
  - `./services/googleDriveSync`
- Internal dependencies (4)
  - `backend/src/database.js`
  - `backend/src/requestContext.js`
  - `backend/src/runtimeCache.js`
  - `backend/src/services/googleDriveSync/index.js`
- Referenced by (23)
  - `backend/server.js`
  - `backend/src/routes/actionHistory.js`
  - `backend/src/routes/ai.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/branches.js`
  - `backend/src/routes/catalog.js`
  - `backend/src/routes/categories.js`
  - `backend/src/routes/contacts.js`
  - `backend/src/routes/customTables.js`
  - `backend/src/routes/files.js`
  - `backend/src/routes/importJobs.js`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/returns.js`
  - `backend/src/routes/runtime.js`
  - `backend/src/routes/sales.js`
  - `backend/src/routes/settings.js`
  - `backend/src/routes/system/index.js`
  - `backend/src/routes/units.js`
  - `backend/src/routes/users.js`
  - `backend/src/services/importJobs.js`
  - `backend/src/websocket.js`

### 3.17 `backend/src/idempotency.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/returns.js`
  - `backend/src/routes/sales.js`
  - `backend/test/idempotency.test.ts`

### 3.18 `backend/src/importCsv.js`

- Declared exports: `module.exports`
- Imports (1)
  - `fs`
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `backend/src/services/importJobs.js`
  - `backend/test/importCsv.test.ts`
  - `backend/test/importScaleSmoke.test.ts`

### 3.19 `backend/src/importParsing.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./money`
- Internal dependencies (1)
  - `backend/src/money.js`
- Referenced by (3)
  - `backend/src/productImportPolicies.js`
  - `backend/test/importCsv.test.ts`
  - `backend/test/importScaleSmoke.test.ts`

### 3.20 `backend/src/initials.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/test/initials.test.ts`

### 3.21 `backend/src/maintenanceLock.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `backend/server.js`
  - `backend/src/routes/system/index.js`
  - `backend/src/services/googleDriveSync/index.js`

### 3.22 `backend/src/middleware.js`

- Declared exports: `module.exports`
- Imports (10)
  - `./accessControl`
  - `./config`
  - `./fileAssets`
  - `./permissions`
  - `./security`
  - `./sessionAuth`
  - `./uploadSecurity`
  - `fs`
  - `multer`
  - `path`
- Internal dependencies (7)
  - `backend/src/accessControl.js`
  - `backend/src/config/index.js`
  - `backend/src/fileAssets.js`
  - `backend/src/permissions.js`
  - `backend/src/security.js`
  - `backend/src/sessionAuth.js`
  - `backend/src/uploadSecurity.js`
- Referenced by (24)
  - `backend/server.js`
  - `backend/src/authOtpGuards.js`
  - `backend/src/routes/actionHistory.js`
  - `backend/src/routes/ai.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/branches.js`
  - `backend/src/routes/categories.js`
  - `backend/src/routes/contacts.js`
  - `backend/src/routes/customTables.js`
  - `backend/src/routes/files.js`
  - `backend/src/routes/importJobs.js`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/notifications.js`
  - `backend/src/routes/organizations.js`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/returns.js`
  - `backend/src/routes/runtime.js`
  - `backend/src/routes/sales.js`
  - `backend/src/routes/settings.js`
  - `backend/src/routes/sync.js`
  - `backend/src/routes/system/index.js`
  - `backend/src/routes/units.js`
  - `backend/src/routes/users.js`

### 3.23 `backend/src/money.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `backend/src/importParsing.js`
  - `backend/src/productDiscounts.js`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/products.js`
  - `backend/src/services/importJobs.js`

### 3.24 `backend/src/netSecurity.js`

- Declared exports: `module.exports`
- Imports (1)
  - `net`
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/src/services/aiGateway.js`
  - `backend/src/services/importJobs.js`
  - `backend/test/netSecurity.test.ts`

### 3.25 `backend/src/objectStore.js`

- Declared exports: `module.exports`
- Imports (7)
  - `./config`
  - `@aws-sdk/client-s3`
  - `@smithy/node-http-handler`
  - `fs`
  - `http`
  - `https`
  - `stream`
- Internal dependencies (1)
  - `backend/src/config/index.js`
- Referenced by (6)
  - `backend/server.js`
  - `backend/src/fileAssets.js`
  - `backend/src/routes/system/index.js`
  - `backend/src/services/backupPackages.js`
  - `backend/src/services/integrationDoctor.js`
  - `backend/src/settingsSnapshot.js`

### 3.26 `backend/src/optionalSharp.js`

- Declared exports: `module.exports`
- Imports (1)
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/fileAssets.js`
  - `backend/src/uploadSecurity.js`

### 3.27 `backend/src/organizationContext/index.js`

- Declared exports: `module.exports`
- Imports (7)
  - `../config`
  - `../dataPath`
  - `../database`
  - `../storage/organizationFolders`
  - `crypto`
  - `fs`
  - `path`
- Internal dependencies (4)
  - `backend/src/config/index.js`
  - `backend/src/dataPath/index.js`
  - `backend/src/database.js`
  - `backend/src/storage/organizationFolders.js`
- Referenced by (6)
  - `backend/server.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/organizations.js`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/system/index.js`
  - `backend/src/routes/users.js`

### 3.28 `backend/src/permissions.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `backend/src/middleware.js`
  - `backend/src/postgresDatabase.js`
  - `backend/src/routes/actionHistory.js`
  - `backend/test/permissionPolicy.test.ts`

### 3.29 `backend/src/portalUtils.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/routes/portal.js`
  - `backend/test/portalUtils.test.ts`

### 3.30 `backend/src/postgresDatabase.js`

- Declared exports: `module.exports`
- Imports (7)
  - `./config`
  - `./db/postgresQueryCompat`
  - `./permissions`
  - `bcryptjs`
  - `fs`
  - `path`
  - `pg-native`
- Internal dependencies (3)
  - `backend/src/config/index.js`
  - `backend/src/db/postgresQueryCompat.js`
  - `backend/src/permissions.js`
- Referenced by (2)
  - `backend/src/database.js`
  - `backend/test/postgresDatabase.test.ts`

### 3.31 `backend/src/productBatches.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./database`
- Internal dependencies (1)
  - `backend/src/database.js`
- Referenced by (6)
  - `backend/server.js`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/returns.js`
  - `backend/src/routes/sales.js`
  - `backend/src/services/importJobs.js`

### 3.32 `backend/src/productDiscounts.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./money`
- Internal dependencies (1)
  - `backend/src/money.js`
- Referenced by (3)
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/products.js`
  - `backend/src/services/importJobs.js`

### 3.33 `backend/src/productImportPolicies.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./importParsing`
- Internal dependencies (1)
  - `backend/src/importParsing.js`
- Referenced by (3)
  - `backend/src/routes/products.js`
  - `backend/src/services/importJobs.js`
  - `backend/test/productImportPolicies.test.ts`

### 3.34 `backend/src/requestContext.js`

- Declared exports: `module.exports`
- Imports (1)
  - `async_hooks`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/server.js`
  - `backend/src/helpers.js`

### 3.35 `backend/src/routes/actionHistory.js`

- Declared exports: `module.exports`
- Imports (5)
  - `../database`
  - `../helpers`
  - `../middleware`
  - `../permissions`
  - `express`
- Internal dependencies (4)
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/permissions.js`
- Referenced by (1)
  - `backend/server.js`

### 3.36 `backend/src/routes/ai.js`

- Declared exports: `module.exports`
- Imports (6)
  - `../conflictControl`
  - `../database`
  - `../helpers`
  - `../middleware`
  - `../services/aiGateway`
  - `express`
- Internal dependencies (5)
  - `backend/src/conflictControl.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/services/aiGateway.js`
- Referenced by (1)
  - `backend/server.js`

### 3.37 `backend/src/routes/auth.js`

- Declared exports: `module.exports`
- Imports (18)
  - `../accessControl`
  - `../authOtpGuards`
  - `../config`
  - `../database`
  - `../helpers`
  - `../middleware`
  - `../organizationContext`
  - `../runtimeState`
  - `../security`
  - `../services/googleOauth`
  - `../services/verification`
  - `../sessionAuth`
  - `../settingsSnapshot`
  - `bcryptjs`
  - `crypto`
  - `express`
  - `qrcode`
  - `speakeasy`
- Internal dependencies (13)
  - `backend/src/accessControl.js`
  - `backend/src/authOtpGuards.js`
  - `backend/src/config/index.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/organizationContext/index.js`
  - `backend/src/runtimeState/index.js`
  - `backend/src/security.js`
  - `backend/src/services/googleOauth.js`
  - `backend/src/services/verification.js`
  - `backend/src/sessionAuth.js`
  - `backend/src/settingsSnapshot.js`
- Referenced by (2)
  - `backend/server.js`
  - `backend/test/routeContracts.test.ts`

### 3.38 `backend/src/routes/branches.js`

- Declared exports: `module.exports`
- Imports (8)
  - `../businessMetrics`
  - `../conflictControl`
  - `../database`
  - `../helpers`
  - `../middleware`
  - `../schemaMetadata`
  - `crypto`
  - `express`
- Internal dependencies (6)
  - `backend/src/businessMetrics.js`
  - `backend/src/conflictControl.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/schemaMetadata.js`
- Referenced by (1)
  - `backend/server.js`

### 3.39 `backend/src/routes/catalog.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database`
  - `../helpers`
  - `../settingsSnapshot`
  - `express`
- Internal dependencies (3)
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/settingsSnapshot.js`
- Referenced by (1)
  - `backend/server.js`

### 3.40 `backend/src/routes/categories.js`

- Declared exports: `module.exports`
- Imports (6)
  - `../catalogTextIntegrity`
  - `../conflictControl`
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (5)
  - `backend/src/catalogTextIntegrity.js`
  - `backend/src/conflictControl.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
- Referenced by (1)
  - `backend/server.js`

### 3.41 `backend/src/routes/contacts.js`

- Declared exports: `module.exports`
- Imports (6)
  - `../conflictControl`
  - `../contactOptions`
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (5)
  - `backend/src/conflictControl.js`
  - `backend/src/contactOptions.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
- Referenced by (1)
  - `backend/server.js`

### 3.42 `backend/src/routes/customTables.js`

- Declared exports: `module.exports`
- Imports (6)
  - `../conflictControl`
  - `../database`
  - `../helpers`
  - `../middleware`
  - `../schemaMetadata`
  - `express`
- Internal dependencies (5)
  - `backend/src/conflictControl.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/schemaMetadata.js`
- Referenced by (1)
  - `backend/server.js`

### 3.43 `backend/src/routes/files.js`

- Declared exports: `module.exports`
- Imports (6)
  - `../conflictControl`
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `../services/mediaQueue`
  - `express`
- Internal dependencies (5)
  - `backend/src/conflictControl.js`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/services/mediaQueue.js`
- Referenced by (1)
  - `backend/server.js`

### 3.44 `backend/src/routes/importJobs.js`

- Declared exports: `module.exports`
- Imports (9)
  - `../config`
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `../services/importJobs`
  - `express`
  - `fs`
  - `multer`
  - `path`
- Internal dependencies (5)
  - `backend/src/config/index.js`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/services/importJobs.js`
- Referenced by (1)
  - `backend/server.js`

### 3.45 `backend/src/routes/inventory.js`

- Declared exports: `module.exports`
- Imports (12)
  - `../businessMetrics`
  - `../catalogTextIntegrity`
  - `../database`
  - `../helpers`
  - `../idempotency`
  - `../initials`
  - `../middleware`
  - `../money`
  - `../productBatches`
  - `../productDiscounts`
  - `../schemaMetadata`
  - `express`
- Internal dependencies (11)
  - `backend/src/businessMetrics.js`
  - `backend/src/catalogTextIntegrity.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/idempotency.js`
  - `backend/src/initials.js`
  - `backend/src/middleware.js`
  - `backend/src/money.js`
  - `backend/src/productBatches.js`
  - `backend/src/productDiscounts.js`
  - `backend/src/schemaMetadata.js`
- Referenced by (2)
  - `backend/server.js`
  - `backend/test/routeContracts.test.ts`

### 3.46 `backend/src/routes/notifications.js`

- Declared exports: `module.exports`
- Imports (5)
  - `../businessMetrics`
  - `../database`
  - `../middleware`
  - `../services/googleDriveSync`
  - `express`
- Internal dependencies (4)
  - `backend/src/businessMetrics.js`
  - `backend/src/database.js`
  - `backend/src/middleware.js`
  - `backend/src/services/googleDriveSync/index.js`
- Referenced by (2)
  - `backend/server.js`
  - `backend/test/notificationSummaryCache.test.ts`

### 3.47 `backend/src/routes/organizations.js`

- Declared exports: `module.exports`
- Imports (3)
  - `../middleware`
  - `../organizationContext`
  - `express`
- Internal dependencies (2)
  - `backend/src/middleware.js`
  - `backend/src/organizationContext/index.js`
- Referenced by (1)
  - `backend/server.js`

### 3.48 `backend/src/routes/portal.js`

- Declared exports: `module.exports`
- Imports (13)
  - `../database`
  - `../fileAssets`
  - `../helpers`
  - `../initials`
  - `../middleware`
  - `../netSecurity`
  - `../organizationContext`
  - `../portalUtils`
  - `../runtimeCache`
  - `../security`
  - `../services/portalAi`
  - `../settingsSnapshot`
  - `express`
- Internal dependencies (12)
  - `backend/src/database.js`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/initials.js`
  - `backend/src/middleware.js`
  - `backend/src/netSecurity.js`
  - `backend/src/organizationContext/index.js`
  - `backend/src/portalUtils.js`
  - `backend/src/runtimeCache.js`
  - `backend/src/security.js`
  - `backend/src/services/portalAi.js`
  - `backend/src/settingsSnapshot.js`
- Referenced by (2)
  - `backend/server.js`
  - `backend/test/routeContracts.test.ts`

### 3.49 `backend/src/routes/products.js`

- Declared exports: `module.exports`
- Imports (20)
  - `../businessMetrics`
  - `../catalogTextIntegrity`
  - `../config`
  - `../conflictControl`
  - `../database`
  - `../fileAssets`
  - `../helpers`
  - `../idempotency`
  - `../initials`
  - `../middleware`
  - `../money`
  - `../netSecurity`
  - `../productBatches`
  - `../productDiscounts`
  - `../productImportPolicies`
  - `../schemaMetadata`
  - `../settingsSnapshot`
  - `express`
  - `fs`
  - `path`
- Internal dependencies (17)
  - `backend/src/businessMetrics.js`
  - `backend/src/catalogTextIntegrity.js`
  - `backend/src/config/index.js`
  - `backend/src/conflictControl.js`
  - `backend/src/database.js`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/idempotency.js`
  - `backend/src/initials.js`
  - `backend/src/middleware.js`
  - `backend/src/money.js`
  - `backend/src/netSecurity.js`
  - `backend/src/productBatches.js`
  - `backend/src/productDiscounts.js`
  - `backend/src/productImportPolicies.js`
  - `backend/src/schemaMetadata.js`
  - `backend/src/settingsSnapshot.js`
- Referenced by (2)
  - `backend/server.js`
  - `backend/test/routeContracts.test.ts`

### 3.50 `backend/src/routes/returns.js`

- Declared exports: `module.exports`
- Imports (7)
  - `../conflictControl`
  - `../database`
  - `../helpers`
  - `../idempotency`
  - `../middleware`
  - `../productBatches`
  - `express`
- Internal dependencies (6)
  - `backend/src/conflictControl.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/idempotency.js`
  - `backend/src/middleware.js`
  - `backend/src/productBatches.js`
- Referenced by (1)
  - `backend/server.js`

### 3.51 `backend/src/routes/runtime.js`

- Declared exports: `module.exports`
- Imports (9)
  - `../catalogTextIntegrity`
  - `../database`
  - `../helpers`
  - `../middleware`
  - `../runtimeCache`
  - `../runtimeVersion`
  - `../services/importJobs`
  - `../services/mediaQueue`
  - `express`
- Internal dependencies (8)
  - `backend/src/catalogTextIntegrity.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/runtimeCache.js`
  - `backend/src/runtimeVersion.js`
  - `backend/src/services/importJobs.js`
  - `backend/src/services/mediaQueue.js`
- Referenced by (1)
  - `backend/server.js`

### 3.52 `backend/src/routes/sales.js`

- Declared exports: `module.exports`
- Imports (8)
  - `../businessMetrics`
  - `../conflictControl`
  - `../database`
  - `../helpers`
  - `../idempotency`
  - `../middleware`
  - `../productBatches`
  - `express`
- Internal dependencies (7)
  - `backend/src/businessMetrics.js`
  - `backend/src/conflictControl.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/idempotency.js`
  - `backend/src/middleware.js`
  - `backend/src/productBatches.js`
- Referenced by (1)
  - `backend/server.js`

### 3.53 `backend/src/routes/settings.js`

- Declared exports: `module.exports`
- Imports (9)
  - `../catalogTextIntegrity`
  - `../conflictControl`
  - `../database`
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `../schemaMetadata`
  - `../settingsSnapshot`
  - `express`
- Internal dependencies (8)
  - `backend/src/catalogTextIntegrity.js`
  - `backend/src/conflictControl.js`
  - `backend/src/database.js`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/schemaMetadata.js`
  - `backend/src/settingsSnapshot.js`
- Referenced by (1)
  - `backend/server.js`

### 3.54 `backend/src/routes/sync.js`

- Declared exports: `module.exports`
- Imports (7)
  - `../config`
  - `../middleware`
  - `../serverUtils`
  - `crypto`
  - `express`
  - `fs`
  - `path`
- Internal dependencies (3)
  - `backend/src/config/index.js`
  - `backend/src/middleware.js`
  - `backend/src/serverUtils.js`
- Referenced by (1)
  - `backend/server.js`

### 3.55 `backend/src/routes/system/index.js`

- Declared exports: `module.exports`
- Imports (24)
  - `../../accessControl`
  - `../../analytics/duckdbRuntime`
  - `../../backupSchema`
  - `../../config`
  - `../../dataPath`
  - `../../database`
  - `../../db/cutoverReadiness`
  - `../../fileAssets`
  - `../../helpers`
  - `../../maintenanceLock`
  - `../../middleware`
  - `../../objectStore`
  - `../../organizationContext`
  - `../../runtimeState`
  - `../../security`
  - `../../services/backupPackages`
  - `../../services/googleDriveSync`
  - `../../services/importJobs`
  - `../../services/integrationDoctor`
  - `../../systemJobs`
  - `child_process`
  - `express`
  - `fs`
  - `path`
- Internal dependencies (20)
  - `backend/src/accessControl.js`
  - `backend/src/analytics/duckdbRuntime.js`
  - `backend/src/backupSchema.js`
  - `backend/src/config/index.js`
  - `backend/src/dataPath/index.js`
  - `backend/src/database.js`
  - `backend/src/db/cutoverReadiness.js`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/maintenanceLock.js`
  - `backend/src/middleware.js`
  - `backend/src/objectStore.js`
  - `backend/src/organizationContext/index.js`
  - `backend/src/runtimeState/index.js`
  - `backend/src/security.js`
  - `backend/src/services/backupPackages.js`
  - `backend/src/services/googleDriveSync/index.js`
  - `backend/src/services/importJobs.js`
  - `backend/src/services/integrationDoctor.js`
  - `backend/src/systemJobs.js`
- Referenced by (2)
  - `backend/server.js`
  - `backend/test/routeContracts.test.ts`

### 3.56 `backend/src/routes/units.js`

- Declared exports: `module.exports`
- Imports (6)
  - `../catalogTextIntegrity`
  - `../conflictControl`
  - `../database`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (5)
  - `backend/src/catalogTextIntegrity.js`
  - `backend/src/conflictControl.js`
  - `backend/src/database.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
- Referenced by (1)
  - `backend/server.js`

### 3.57 `backend/src/routes/users.js`

- Declared exports: `module.exports`
- Imports (11)
  - `../conflictControl`
  - `../database`
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `../organizationContext`
  - `../services/googleOauth`
  - `../services/verification`
  - `../sessionAuth`
  - `bcryptjs`
  - `express`
- Internal dependencies (9)
  - `backend/src/conflictControl.js`
  - `backend/src/database.js`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/organizationContext/index.js`
  - `backend/src/services/googleOauth.js`
  - `backend/src/services/verification.js`
  - `backend/src/sessionAuth.js`
- Referenced by (1)
  - `backend/server.js`

### 3.58 `backend/src/runtimeCache.js`

- Declared exports: `module.exports`
- Imports (2)
  - `./config`
  - `ioredis`
- Internal dependencies (1)
  - `backend/src/config/index.js`
- Referenced by (4)
  - `backend/src/helpers.js`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/runtime.js`
  - `backend/test/runtimeCache.test.ts`

### 3.59 `backend/src/runtimeState/index.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../config`
  - `crypto`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `backend/src/config/index.js`
- Referenced by (2)
  - `backend/src/routes/auth.js`
  - `backend/src/routes/system/index.js`

### 3.60 `backend/src/runtimeVersion.js`

- Declared exports: `module.exports`
- Imports (5)
  - `../package.json`
  - `child_process`
  - `crypto`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `backend/package.json`
- Referenced by (4)
  - `backend/server.js`
  - `backend/src/routes/runtime.js`
  - `backend/src/services/googleDriveSync/index.js`
  - `backend/test/runtimeVersion.test.ts`

### 3.61 `backend/src/schemaMetadata.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./database`
- Internal dependencies (1)
  - `backend/src/database.js`
- Referenced by (6)
  - `backend/src/routes/branches.js`
  - `backend/src/routes/customTables.js`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/settings.js`
  - `backend/test/schemaMetadata.test.ts`

### 3.62 `backend/src/security.js`

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
  - `backend/src/routes/system/index.js`
  - `backend/src/services/aiGateway.js`
  - `backend/src/services/googleDriveSync/index.js`

### 3.63 `backend/src/serverUtils.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./config`
- Internal dependencies (1)
  - `backend/src/config/index.js`
- Referenced by (4)
  - `backend/server.js`
  - `backend/src/routes/sync.js`
  - `backend/src/websocket.js`
  - `backend/test/serverUtils.test.ts`

### 3.64 `backend/src/services/aiGateway.js`

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

### 3.65 `backend/src/services/backupPackages.js`

- Declared exports: `module.exports`
- Imports (9)
  - `../backupSchema`
  - `../config`
  - `../database`
  - `../objectStore`
  - `crypto`
  - `fs`
  - `path`
  - `stream`
  - `stream/promises`
- Internal dependencies (4)
  - `backend/src/backupSchema.js`
  - `backend/src/config/index.js`
  - `backend/src/database.js`
  - `backend/src/objectStore.js`
- Referenced by (4)
  - `backend/src/routes/system/index.js`
  - `backend/src/services/googleDriveSync/index.js`
  - `backend/src/services/integrationDoctor.js`
  - `backend/test/backupRetention.test.ts`

### 3.66 `backend/src/services/firebaseAuth.js`

- Declared exports: `module.exports`
- Imports (2)
  - `crypto`
  - `fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.67 `backend/src/services/googleDriveSync/index.js`

- Declared exports: `module.exports`
- Imports (12)
  - `../../config`
  - `../../dataPath`
  - `../../database`
  - `../../maintenanceLock`
  - `../../runtimeVersion`
  - `../../security`
  - `../backupPackages`
  - `./versioning`
  - `crypto`
  - `fs`
  - `os`
  - `path`
- Internal dependencies (8)
  - `backend/src/config/index.js`
  - `backend/src/dataPath/index.js`
  - `backend/src/database.js`
  - `backend/src/maintenanceLock.js`
  - `backend/src/runtimeVersion.js`
  - `backend/src/security.js`
  - `backend/src/services/backupPackages.js`
  - `backend/src/services/googleDriveSync/versioning.js`
- Referenced by (4)
  - `backend/src/helpers.js`
  - `backend/src/routes/notifications.js`
  - `backend/src/routes/system/index.js`
  - `backend/src/services/integrationDoctor.js`

### 3.68 `backend/src/services/googleDriveSync/versioning.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/services/googleDriveSync/index.js`
  - `backend/test/googleDriveSyncVersioning.test.ts`

### 3.69 `backend/src/services/googleOauth.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../config`
  - `crypto`
- Internal dependencies (1)
  - `backend/src/config/index.js`
- Referenced by (4)
  - `backend/src/routes/auth.js`
  - `backend/src/routes/users.js`
  - `backend/src/services/integrationDoctor.js`
  - `backend/test/ownedGoogleAuth.test.ts`

### 3.70 `backend/src/services/importJobs.js`

- Declared exports: `module.exports`
- Imports (20)
  - `../catalogTextIntegrity`
  - `../config`
  - `../contactOptions`
  - `../database`
  - `../fileAssets`
  - `../helpers`
  - `../importCsv`
  - `../money`
  - `../netSecurity`
  - `../productBatches`
  - `../productDiscounts`
  - `../productImportPolicies`
  - `../uploadSecurity`
  - `./mediaQueue`
  - `bullmq`
  - `crypto`
  - `fs`
  - `ioredis`
  - `path`
  - `yauzl`
- Internal dependencies (14)
  - `backend/src/catalogTextIntegrity.js`
  - `backend/src/config/index.js`
  - `backend/src/contactOptions.js`
  - `backend/src/database.js`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/importCsv.js`
  - `backend/src/money.js`
  - `backend/src/netSecurity.js`
  - `backend/src/productBatches.js`
  - `backend/src/productDiscounts.js`
  - `backend/src/productImportPolicies.js`
  - `backend/src/services/mediaQueue.js`
  - `backend/src/uploadSecurity.js`
- Referenced by (7)
  - `backend/server.js`
  - `backend/src/routes/importJobs.js`
  - `backend/src/routes/runtime.js`
  - `backend/src/routes/system/index.js`
  - `backend/src/services/integrationDoctor.js`
  - `backend/src/workers/importWorker.js`
  - `backend/test/importJobStateMachine.test.ts`

### 3.71 `backend/src/services/integrationDoctor.js`

- Declared exports: `module.exports`
- Imports (10)
  - `../analytics/duckdbRuntime`
  - `../config`
  - `../database`
  - `../objectStore`
  - `./backupPackages`
  - `./googleDriveSync`
  - `./googleOauth`
  - `./importJobs`
  - `fs`
  - `path`
- Internal dependencies (8)
  - `backend/src/analytics/duckdbRuntime.js`
  - `backend/src/config/index.js`
  - `backend/src/database.js`
  - `backend/src/objectStore.js`
  - `backend/src/services/backupPackages.js`
  - `backend/src/services/googleDriveSync/index.js`
  - `backend/src/services/googleOauth.js`
  - `backend/src/services/importJobs.js`
- Referenced by (2)
  - `backend/src/routes/system/index.js`
  - `backend/test/integrationDoctor.test.ts`

### 3.72 `backend/src/services/mediaQueue.js`

- Declared exports: `module.exports`
- Imports (5)
  - `../config`
  - `../database`
  - `../fileAssets`
  - `bullmq`
  - `ioredis`
- Internal dependencies (3)
  - `backend/src/config/index.js`
  - `backend/src/database.js`
  - `backend/src/fileAssets.js`
- Referenced by (5)
  - `backend/src/routes/files.js`
  - `backend/src/routes/runtime.js`
  - `backend/src/services/importJobs.js`
  - `backend/src/workers/mediaWorker.js`
  - `backend/test/importJobStateMachine.test.ts`

### 3.73 `backend/src/services/portalAi.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../database`
  - `./aiGateway`
- Internal dependencies (2)
  - `backend/src/database.js`
  - `backend/src/services/aiGateway.js`
- Referenced by (1)
  - `backend/src/routes/portal.js`

### 3.74 `backend/src/services/verification.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../database`
  - `crypto`
- Internal dependencies (1)
  - `backend/src/database.js`
- Referenced by (2)
  - `backend/src/routes/auth.js`
  - `backend/src/routes/users.js`

### 3.75 `backend/src/sessionAuth.js`

- Declared exports: `module.exports`
- Imports (2)
  - `./database`
  - `crypto`
- Internal dependencies (1)
  - `backend/src/database.js`
- Referenced by (4)
  - `backend/src/middleware.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/users.js`
  - `backend/src/websocket.js`

### 3.76 `backend/src/settingsSnapshot.js`

- Declared exports: `module.exports`
- Imports (4)
  - `./config`
  - `./objectStore`
  - `fs`
  - `path`
- Internal dependencies (2)
  - `backend/src/config/index.js`
  - `backend/src/objectStore.js`
- Referenced by (8)
  - `backend/src/fileAssets.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/catalog.js`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/settings.js`
  - `backend/src/uploadReferenceCleanup.js`
  - `backend/test/settingsSnapshotObjectStorage.test.ts`

### 3.77 `backend/src/storage/organizationFolders.js`

- Declared exports: `module.exports`
- Imports (2)
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/config/index.js`
  - `backend/src/organizationContext/index.js`

### 3.78 `backend/src/systemFsWorker.js`

- Declared exports: none detected
- Imports (3)
  - `./dataPath`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `backend/src/dataPath/index.js`
- Referenced by (0)
  - none

### 3.79 `backend/src/systemJobs.js`

- Declared exports: `module.exports`
- Imports (2)
  - `./database`
  - `crypto`
- Internal dependencies (1)
  - `backend/src/database.js`
- Referenced by (2)
  - `backend/src/routes/system/index.js`
  - `backend/test/systemJobs.test.ts`

### 3.80 `backend/src/uploadReferenceCleanup.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./settingsSnapshot`
- Internal dependencies (1)
  - `backend/src/settingsSnapshot.js`
- Referenced by (2)
  - `backend/src/fileAssets.js`
  - `backend/test/settingsSnapshotObjectStorage.test.ts`

### 3.81 `backend/src/uploadSecurity.js`

- Declared exports: `module.exports`
- Imports (2)
  - `./optionalSharp`
  - `fs`
- Internal dependencies (1)
  - `backend/src/optionalSharp.js`
- Referenced by (4)
  - `backend/src/fileAssets.js`
  - `backend/src/middleware.js`
  - `backend/src/services/importJobs.js`
  - `backend/test/uploadSecurity.test.ts`

### 3.82 `backend/src/websocket.js`

- Declared exports: `module.exports`
- Imports (5)
  - `./helpers`
  - `./serverUtils`
  - `./sessionAuth`
  - `http`
  - `ws`
- Internal dependencies (3)
  - `backend/src/helpers.js`
  - `backend/src/serverUtils.js`
  - `backend/src/sessionAuth.js`
- Referenced by (1)
  - `backend/server.js`

### 3.83 `backend/src/workers/importWorker.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../database`
  - `../services/importJobs`
- Internal dependencies (2)
  - `backend/src/database.js`
  - `backend/src/services/importJobs.js`
- Referenced by (1)
  - `backend/server.js`

### 3.84 `backend/src/workers/mediaWorker.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../database`
  - `../services/mediaQueue`
- Internal dependencies (2)
  - `backend/src/database.js`
  - `backend/src/services/mediaQueue.js`
- Referenced by (1)
  - `backend/server.js`

### 3.85 `backend/test/accessControl.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/accessControl`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/accessControl.js`
- Referenced by (0)
  - none

### 3.86 `backend/test/analyticsRuntime.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/analytics/duckdbRuntime`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/analytics/duckdbRuntime.js`
- Referenced by (0)
  - none

### 3.87 `backend/test/authOtpGuards.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/authOtpGuards`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/authOtpGuards.js`
- Referenced by (0)
  - none

### 3.88 `backend/test/authSecurityFlow.test.ts`

- Declared exports: none detected
- Imports (8)
  - `../src/database`
  - `bcryptjs`
  - `child_process`
  - `fs`
  - `net`
  - `node:assert/strict`
  - `os`
  - `path`
- Internal dependencies (1)
  - `backend/src/database.js`
- Referenced by (0)
  - none

### 3.89 `backend/test/backupDefaultDestination.test.ts`

- Declared exports: none detected
- Imports (3)
  - `fs`
  - `node:assert/strict`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.90 `backend/test/backupPerformanceHardening.test.ts`

- Declared exports: none detected
- Imports (3)
  - `node:assert/strict`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.91 `backend/test/backupRetention.test.ts`

- Declared exports: none detected
- Imports (5)
  - `../src/services/backupPackages`
  - `node:assert/strict`
  - `node:fs`
  - `node:os`
  - `node:path`
- Internal dependencies (1)
  - `backend/src/services/backupPackages.js`
- Referenced by (0)
  - none

### 3.92 `backend/test/backupSchema.test.ts`

- Declared exports: none detected
- Imports (4)
  - `../src/backupSchema`
  - `node:assert/strict`
  - `node:fs`
  - `node:path`
- Internal dependencies (1)
  - `backend/src/backupSchema.js`
- Referenced by (0)
  - none

### 3.93 `backend/test/branchStockSearch.test.ts`

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

### 3.94 `backend/test/contactOptions.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/contactOptions`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/contactOptions.js`
- Referenced by (0)
  - none

### 3.95 `backend/test/dataPath.test.ts`

- Declared exports: none detected
- Imports (5)
  - `../src/dataPath`
  - `fs`
  - `node:assert/strict`
  - `os`
  - `path`
- Internal dependencies (1)
  - `backend/src/dataPath/index.js`
- Referenced by (0)
  - none

### 3.96 `backend/test/defaultRoles.test.ts`

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

### 3.97 `backend/test/fileAssetStorageReconcile.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/fileAssets`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/fileAssets.js`
- Referenced by (0)
  - none

### 3.98 `backend/test/fileAssetUsageCache.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/database`
  - `../src/fileAssets`
  - `node:assert/strict`
- Internal dependencies (2)
  - `backend/src/database.js`
  - `backend/src/fileAssets.js`
- Referenced by (0)
  - none

### 3.99 `backend/test/fileRouteSecurityFlow.test.ts`

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

### 3.100 `backend/test/fullAutomation.test.ts`

- Declared exports: none detected
- Imports (3)
  - `node:assert/strict`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.101 `backend/test/googleDriveSyncVersioning.test.ts`

- Declared exports: none detected
- Imports (4)
  - `../src/services/googleDriveSync/versioning`
  - `node:assert/strict`
  - `node:fs`
  - `node:path`
- Internal dependencies (1)
  - `backend/src/services/googleDriveSync/versioning.js`
- Referenced by (0)
  - none

### 3.102 `backend/test/idempotency.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/idempotency`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/idempotency.js`
- Referenced by (0)
  - none

### 3.103 `backend/test/importCsv.test.ts`

- Declared exports: none detected
- Imports (6)
  - `../src/importCsv`
  - `../src/importParsing`
  - `fs`
  - `node:assert/strict`
  - `os`
  - `path`
- Internal dependencies (2)
  - `backend/src/importCsv.js`
  - `backend/src/importParsing.js`
- Referenced by (0)
  - none

### 3.104 `backend/test/importDecisionIntegrity.test.ts`

- Declared exports: none detected
- Imports (3)
  - `fs`
  - `node:assert/strict`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.105 `backend/test/importJobPerformanceHardening.test.ts`

- Declared exports: none detected
- Imports (3)
  - `node:assert/strict`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.106 `backend/test/importJobStateMachine.test.ts`

- Declared exports: none detected
- Imports (8)
  - `../src/config`
  - `../src/database`
  - `../src/services/importJobs`
  - `../src/services/mediaQueue`
  - `fs`
  - `node:assert/strict`
  - `os`
  - `path`
- Internal dependencies (4)
  - `backend/src/config/index.js`
  - `backend/src/database.js`
  - `backend/src/services/importJobs.js`
  - `backend/src/services/mediaQueue.js`
- Referenced by (0)
  - none

### 3.107 `backend/test/importScaleSmoke.test.ts`

- Declared exports: none detected
- Imports (6)
  - `../src/importCsv`
  - `../src/importParsing`
  - `fs`
  - `node:assert/strict`
  - `os`
  - `path`
- Internal dependencies (2)
  - `backend/src/importCsv.js`
  - `backend/src/importParsing.js`
- Referenced by (0)
  - none

### 3.108 `backend/test/initials.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/initials`
  - `assert`
- Internal dependencies (1)
  - `backend/src/initials.js`
- Referenced by (0)
  - none

### 3.109 `backend/test/integrationDoctor.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/services/integrationDoctor`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/services/integrationDoctor.js`
- Referenced by (0)
  - none

### 3.110 `backend/test/inventorySettingsMediaContracts.test.ts`

- Declared exports: none detected
- Imports (3)
  - `node:assert/strict`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.111 `backend/test/mediaOptimization.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/fileAssets`
  - `node:assert/strict`
  - `sharp`
- Internal dependencies (1)
  - `backend/src/fileAssets.js`
- Referenced by (0)
  - none

### 3.112 `backend/test/netSecurity.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/netSecurity`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/netSecurity.js`
- Referenced by (0)
  - none

### 3.113 `backend/test/notificationSummaryCache.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/routes/notifications`
  - `assert`
- Internal dependencies (1)
  - `backend/src/routes/notifications.js`
- Referenced by (0)
  - none

### 3.114 `backend/test/offlineSecurity.test.ts`

- Declared exports: none detected
- Imports (3)
  - `assert`
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.115 `backend/test/ownedGoogleAuth.test.ts`

- Declared exports: none detected
- Imports (4)
  - `../src/services/googleOauth`
  - `node:assert/strict`
  - `node:fs`
  - `node:path`
- Internal dependencies (1)
  - `backend/src/services/googleOauth.js`
- Referenced by (0)
  - none

### 3.116 `backend/test/permissionPolicy.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/permissions`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/permissions.js`
- Referenced by (0)
  - none

### 3.117 `backend/test/portalInventoryRegression.test.ts`

- Declared exports: none detected
- Imports (3)
  - `node:assert/strict`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.118 `backend/test/portalUtils.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/portalUtils`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/portalUtils.js`
- Referenced by (0)
  - none

### 3.119 `backend/test/postgresCutoverReadiness.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/db/cutoverReadiness`
  - `node:assert/strict`
  - `path`
- Internal dependencies (1)
  - `backend/src/db/cutoverReadiness.js`
- Referenced by (0)
  - none

### 3.120 `backend/test/postgresDatabase.test.ts`

- Declared exports: none detected
- Imports (4)
  - `../src/postgresDatabase`
  - `node:assert/strict`
  - `node:fs`
  - `node:path`
- Internal dependencies (1)
  - `backend/src/postgresDatabase.js`
- Referenced by (0)
  - none

### 3.121 `backend/test/postgresQueryCompat.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/db/postgresQueryCompat`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/db/postgresQueryCompat.js`
- Referenced by (0)
  - none

### 3.122 `backend/test/productBatchHierarchy.test.ts`

- Declared exports: none detected
- Imports (3)
  - `node:assert/strict`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.123 `backend/test/productExpiry.test.ts`

- Declared exports: none detected
- Imports (3)
  - `node:assert/strict`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.124 `backend/test/productImportPolicies.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/productImportPolicies`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/productImportPolicies.js`
- Referenced by (0)
  - none

### 3.125 `backend/test/productSearchPagination.test.ts`

- Declared exports: none detected
- Imports (3)
  - `assert`
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.126 `backend/test/rfidRoutes.test.ts`

- Declared exports: none detected
- Imports (3)
  - `fs`
  - `node:assert/strict`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.127 `backend/test/routeContracts.test.ts`

- Declared exports: none detected
- Imports (10)
  - `../src/routes/auth`
  - `../src/routes/inventory`
  - `../src/routes/portal`
  - `../src/routes/products`
  - `../src/routes/system`
  - `fs`
  - `node:assert/strict`
  - `node:fs`
  - `node:path`
  - `path`
- Internal dependencies (5)
  - `backend/src/routes/auth.js`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/system/index.js`
- Referenced by (0)
  - none

### 3.128 `backend/test/runtimeCache.test.ts`

- Declared exports: none detected
- Imports (5)
  - `../src/runtimeCache`
  - `fs`
  - `node:assert/strict`
  - `os`
  - `path`
- Internal dependencies (1)
  - `backend/src/runtimeCache.js`
- Referenced by (0)
  - none

### 3.129 `backend/test/runtimeVersion.test.ts`

- Declared exports: none detected
- Imports (5)
  - `../src/runtimeVersion`
  - `fs`
  - `node:assert/strict`
  - `os`
  - `path`
- Internal dependencies (1)
  - `backend/src/runtimeVersion.js`
- Referenced by (0)
  - none

### 3.130 `backend/test/schemaMetadata.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/schemaMetadata`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/schemaMetadata.js`
- Referenced by (0)
  - none

### 3.131 `backend/test/serverUtils.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/config`
  - `../src/serverUtils`
  - `node:assert/strict`
- Internal dependencies (2)
  - `backend/src/config/index.js`
  - `backend/src/serverUtils.js`
- Referenced by (0)
  - none

### 3.132 `backend/test/settingsSnapshotObjectStorage.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/settingsSnapshot`
  - `../src/uploadReferenceCleanup`
  - `node:assert/strict`
- Internal dependencies (2)
  - `backend/src/settingsSnapshot.js`
  - `backend/src/uploadReferenceCleanup.js`
- Referenced by (0)
  - none

### 3.133 `backend/test/systemJobs.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/systemJobs`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/systemJobs.js`
- Referenced by (0)
  - none

### 3.134 `backend/test/uploadSecurity.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/fileAssets`
  - `../src/uploadSecurity`
  - `node:assert/strict`
- Internal dependencies (2)
  - `backend/src/fileAssets.js`
  - `backend/src/uploadSecurity.js`
- Referenced by (0)
  - none

### 3.135 `frontend/public/runtime-noise-guard.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.136 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.137 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.worker.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.138 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd-threads.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.139 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.140 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.141 `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.142 `frontend/public/sw.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.143 `frontend/public/theme-bootstrap.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.144 `frontend/src/api/http.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (8)
  - `frontend/src/api/websocket.ts`
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/dashboard/Dashboard.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/shared/BackgroundImportTracker.jsx`
  - `frontend/src/utils/publicAssetUrls.ts`
  - `frontend/src/web-api.ts`

### 3.145 `frontend/src/api/http.ts`

- Declared exports: `FRONTEND_BUILD_INFO`, `__resetApiWriteDedupeForTests`, `apiFetch`, `buildApiRequestDedupeKey`, `cacheClearAll`, `cacheGet`, `cacheGetStale`, `cacheInvalidate`, `cacheSet`, `clearCallLog`, `createApiVersionMismatchError`, `getApiVersionMismatchCooldown`, `getCallLog`, `getSyncServerUrl`, `getSyncToken`, `isApiVersionMismatchError`, `isCloudflareAccessRedirectResponse`, `isInvalidSessionError`, `isNetErr`, `isReachableServerResponseStatus`, `isRequiredRuntimeApiPath`, `isServerOnline`, `isTransientGatewayError`, `isWriteBlockedError`, `isWriteConflictError`, `markApiVersionMismatch`, `requireLiveServerWrite`, `route`, `setSyncServerUrl`, `setSyncToken`, `shouldCompareRuntimeVersions`, `startHealthCheck`
- Imports (2)
  - `../constants.ts`
  - `../utils/deviceInfo.ts`
- Internal dependencies (2)
  - `frontend/src/constants.ts`
  - `frontend/src/utils/deviceInfo.ts`
- Referenced by (0)
  - none

### 3.146 `frontend/src/api/localDb.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `frontend/src/api/methods.js`
  - `frontend/src/platform/runtime/clientRuntime.ts`
  - `frontend/src/web-api.ts`

### 3.147 `frontend/src/api/localDb.ts`

- Declared exports: `buildCSVTemplate`, `clearLocalMirrorTables`, `dexieDb`, `localGetSettings`, `localGetSettingsMeta`, `localSaveSettings`, `localSaveSettingsMeta`, `parseCSV`, `replaceTableContents`, `resetLocalMirrorDb`
- Imports (3)
  - `../utils/csv.ts`
  - `../utils/csvImport.ts`
  - `dexie`
- Internal dependencies (2)
  - `frontend/src/utils/csv.ts`
  - `frontend/src/utils/csvImport.ts`
- Referenced by (0)
  - none

### 3.148 `frontend/src/api/methods.js`

- Declared exports: `adjustStock`, `applyRfidSession`, `approveImportJob`, `askPortalAi`, `attachSaleCustomer`, `browseDir`, `bulkImportCustomers`, `bulkImportDeliveryContacts`, `bulkImportProducts`, `bulkImportSuppliers`, `cancelImportJob`, `cancelSystemJob`, `changeUserPassword`, `completeGoogleOauth`, `completePasswordReset`, `createActionHistory`, `createAiProvider`, `createBranch`, `createCategory`, `createCustomTable`, `createCustomer`, `createDeliveryContact`, `createImportJob`, `createPortalSubmission`, `createProduct`, `createProductVariant`, `createReturn`, `createRfidSession`, `createRfidTag`, `createRole`, `createSale`, `createSupplier`, `createSupplierReturn`, `createUnit`, `createUser`, `deleteAiProvider`, `deleteAuditLogsRetention`, `deleteBranch`, `deleteCategory`, `deleteCustomRow`, `deleteCustomer`, `deleteDeliveryContact`, `deleteFileAsset`, `deleteImportJob`, `deleteProduct`, `deleteRole`, `deleteSupplier`, `deleteUnit`, `discardPendingSyncQueue`, `disconnectGoogleDriveSync`, `disconnectUserAuthProvider`, `downloadCustomerTemplate`, `downloadImportJobErrors`, `downloadImportTemplate`, `downloadSupplierTemplate`, `exportBackupFolder`, `factoryReset`, `forgetGoogleDriveSyncCredentials`, `getActionHistory`, `getAiProviders`, `getAiResponses`, `getAnalytics`, `getAppBootstrap`, `getAuditLogs`, `getBranchStock`, `getBranchStockIntegrity`, `getBranchSummary`, `getBranches`, `getCatalogMeta`, `getCatalogProducts`, `getCategories`, `getCurrentOrganization`, `getCustomTableData`, `getCustomTables`, `getCustomerPointSummaries`, `getCustomers`, `getDashboard`, `getDataPath`, `getDeliveryContacts`, `getFiles`, `getGoogleDriveSyncStatus`, `getImageDataUrl`, `getImportJob`, `getImportJobReview`, `getImportQueueStatus`, `getIntegrationDoctor`, `getInventoryMovements`, `getInventoryReasons`, `getInventoryStats`, `getInventorySummary`, `getNotificationSummary`, `getOrganizationBootstrap`, `getPendingSyncState`, `getPortalAiStatus`, `getPortalBootstrap`, `getPortalCatalogMeta`, `getPortalCatalogProducts`, `getPortalConfig`, `getPortalSubmissionsForReview`, `getProductFilters`, `getProductLookupUsage`, `getProducts`, `getProductsByIds`, `getReturn`, `getReturns`, `getRfidSessionReview`, `getRfidStatus`, `getRoles`, `getSales`, `getSalesExport`, `getScaleMigrationStatus`, `getSettings`, `getSuppliers`, `getSystemConfig`, `getSystemDebugLog`, `getSystemJob`, `getTransfers`, `getUnits`, `getUserAuthMethods`, `getUserProfile`, `getUsers`, `getVerificationCapabilities`, `importBackupFolder`, `insertCustomRow`, `listImportJobs`, `login`, `logout`, `lookupPortalMembership`, `moveStockRow`, `openCSVDialog`, `openFolderDialog`, `openImageDialog`, `openPath`, `otpConfirm`, `otpDisable`, `otpSetup`, `otpStatus`, `otpVerify`, `pollSystemJob`, `preflightImportJob`, `prepareScaleMigration`, `queueBackupFolderExport`, `queueBackupFolderRestore`, `queueGoogleDriveSyncNow`, `recordRfidSessionEvents`, `redoActionHistory`, `refreshOfflineDeviceSnapshot`, `repairBranchStockIntegrity`, `replaceProductLookupValues`, `requestPasswordResetEmail`, `resetData`, `resetDataPath`, `resetPassword`, `resetPasswordWithOtp`, `retryImportJob`, `retryPendingSyncNow`, `reviewPortalSubmission`, `runScaleMigration`, `saveGoogleDriveSyncPreferences`, `saveInventoryReasons`, `saveSettings`, `searchInventoryProducts`, `searchOrganizations`, `searchPortalCatalogProducts`, `searchProducts`, `searchRfidTags`, `setDataPath`, `startGoogleDriveSyncOauth`, `startGoogleOauth`, `startImportJob`, `syncGoogleDriveNow`, `testAiProvider`, `testSyncServer`, `transferInventoryStock`, `transferStock`, `undoActionHistory`, `unlinkGoogleOauth`, `updateActionHistory`, `updateAiProvider`, `updateBranch`, `updateCategory`, `updateCustomRow`, `updateCustomer`, `updateDeliveryContact`, `updateImportJobDecisions`, `updateProduct`, `updateReturn`, `updateRole`, `updateSaleStatus`, `updateSessionDuration`, `updateSupplier`, `updateUnit`, `updateUser`, `updateUserProfile`, `uploadFileAsset`, `uploadImportJobCsv`, `uploadImportJobImages`, `uploadImportJobZip`, `uploadProductImage`, `uploadUserAvatar`
- Imports (6)
  - `../constants`
  - `../platform/runtime/clientRuntime.ts`
  - `../utils/appRefresh.ts`
  - `../utils/csvImport.ts`
  - `../utils/deviceInfo.ts`
  - `./localDb.js`
- Internal dependencies (6)
  - `frontend/src/api/localDb.js`
  - `frontend/src/constants.ts`
  - `frontend/src/platform/runtime/clientRuntime.ts`
  - `frontend/src/utils/appRefresh.ts`
  - `frontend/src/utils/csvImport.ts`
  - `frontend/src/utils/deviceInfo.ts`
- Referenced by (1)
  - `frontend/src/web-api.ts`

### 3.149 `frontend/src/api/websocket.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/web-api.ts`

### 3.150 `frontend/src/api/websocket.ts`

- Declared exports: `connectWS`, `disconnectWS`, `isWSConnected`, `reconnectWS`
- Imports (2)
  - `../constants.ts`
  - `./http.js`
- Internal dependencies (2)
  - `frontend/src/api/http.js`
  - `frontend/src/constants.ts`
- Referenced by (0)
  - none

### 3.151 `frontend/src/App.jsx`

- Declared exports: `function`
- Imports (32)
  - `./AppContext`
  - `./app/appShellUtils.ts`
  - `./app/publicErrorRecovery.ts`
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
  - `./components/shared/BackgroundImportTracker`
  - `./components/shared/NotificationCenter`
  - `./components/shared/QuickPreferenceToggles`
  - `./components/shared/WriteConflictModal`
  - `./components/shared/globalScroll.ts`
  - `./components/users/Users`
  - `./components/utils-settings/AuditLog`
  - `./components/utils-settings/Backup`
  - `./components/utils-settings/Settings`
  - `./utils/favicon.ts`
  - `./utils/loaders.ts`
  - `lucide-react`
  - `react`
  - `react-dom`
- Internal dependencies (29)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/app/appShellUtils.ts`
  - `frontend/src/app/publicErrorRecovery.ts`
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
  - `frontend/src/components/shared/BackgroundImportTracker.jsx`
  - `frontend/src/components/shared/NotificationCenter.jsx`
  - `frontend/src/components/shared/QuickPreferenceToggles.jsx`
  - `frontend/src/components/shared/WriteConflictModal.jsx`
  - `frontend/src/components/shared/globalScroll.ts`
  - `frontend/src/components/users/Users.jsx`
  - `frontend/src/components/utils-settings/AuditLog.jsx`
  - `frontend/src/components/utils-settings/Backup.jsx`
  - `frontend/src/components/utils-settings/Settings.jsx`
  - `frontend/src/utils/favicon.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/index.jsx`

### 3.152 `frontend/src/app/appShellUtils.ts`

- Declared exports: `APP_NAVIGATION_EVENT`, `APP_PAGE_INTENT_EVENT`, `DESKTOP_WARMUP_BREAKPOINT`, `MAX_MOUNTED_PAGES`, `MOBILE_MAX_MOUNTED_PAGES`, `MOBILE_SHELL_BREAKPOINT`, `getAdminPageFromPath`, `getAdminPathForPage`, `getMountedPageLimit`, `getNotificationColor`, `getNotificationPrefix`, `isAdminAppPath`, `isPublicCatalogPath`, `normalizeAppPath`, `shouldWarmPageEntries`, `updateMountedPages`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `frontend/src/App.jsx`
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/navigation/Sidebar.jsx`
  - `frontend/src/index.jsx`
  - `frontend/tests/appShellUtils.test.ts`

### 3.153 `frontend/src/app/publicErrorRecovery.ts`

- Declared exports: `clearPublicDomRecoveryMarker`, `isPublicDomMutationError`, `shouldAttemptPublicDomRecovery`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.154 `frontend/src/AppContext.jsx`

- Declared exports: `AppProvider`, `isBrokenLocalizedString`, `useApp`, `useSync`, `useT`
- Imports (14)
  - `./api/http.js`
  - `./api/websocket.js`
  - `./app/appShellUtils.ts`
  - `./constants`
  - `./lang/en.json`
  - `./lang/km.json`
  - `./utils/appRefresh.ts`
  - `./utils/deviceInfo.ts`
  - `./utils/loaders.ts`
  - `./utils/permissions.ts`
  - `./utils/pricing.ts`
  - `./utils/settingsWriteOptions.ts`
  - `./web-api.js`
  - `react`
- Internal dependencies (13)
  - `frontend/src/api/http.js`
  - `frontend/src/api/websocket.js`
  - `frontend/src/app/appShellUtils.ts`
  - `frontend/src/constants.ts`
  - `frontend/src/lang/en.json`
  - `frontend/src/lang/km.json`
  - `frontend/src/utils/appRefresh.ts`
  - `frontend/src/utils/deviceInfo.ts`
  - `frontend/src/utils/loaders.ts`
  - `frontend/src/utils/permissions.ts`
  - `frontend/src/utils/pricing.ts`
  - `frontend/src/utils/settingsWriteOptions.ts`
  - `frontend/src/web-api.js`
- Referenced by (52)
  - `frontend/src/App.jsx`
  - `frontend/src/components/auth/Login.jsx`
  - `frontend/src/components/branches/Branches.jsx`
  - `frontend/src/components/branches/BranchForm.jsx`
  - `frontend/src/components/branches/TransferModal.jsx`
  - `frontend/src/components/catalog/CatalogPage.jsx`
  - `frontend/src/components/contacts/ContactImportModal.jsx`
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
  - `frontend/src/components/inventory/InventoryImportModal.jsx`
  - `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`
  - `frontend/src/components/navigation/Sidebar.jsx`
  - `frontend/src/components/pos/POS.jsx`
  - `frontend/src/components/products/forms/VariantFormModal.jsx`
  - `frontend/src/components/products/lookups/ManageBrandsModal.jsx`
  - `frontend/src/components/products/lookups/ManageCategoriesModal.jsx`
  - `frontend/src/components/products/lookups/ManageUnitsModal.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/receipt-settings/AllFieldsPanel.jsx`
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`
  - `frontend/src/components/receipt/Receipt.jsx`
  - `frontend/src/components/returns/EditReturnModal.jsx`
  - `frontend/src/components/returns/NewReturnModal.jsx`
  - `frontend/src/components/returns/NewSupplierReturnModal.jsx`
  - `frontend/src/components/returns/ReturnDetailModal.jsx`
  - `frontend/src/components/returns/Returns.jsx`
  - `frontend/src/components/sales/Sales.jsx`
  - `frontend/src/components/sales/SalesImportModal.jsx`
  - `frontend/src/components/server/ServerPage.jsx`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/BackgroundImportTracker.jsx`
  - `frontend/src/components/shared/NotificationCenter.jsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/components/shared/QuickPreferenceToggles.jsx`
  - `frontend/src/components/users/UserProfileModal.jsx`
  - `frontend/src/components/users/Users.jsx`
  - `frontend/src/components/utils-settings/AuditLog.jsx`
  - `frontend/src/components/utils-settings/Backup.jsx`
  - `frontend/src/components/utils-settings/OtpModal.jsx`
  - `frontend/src/components/utils-settings/ResetData.jsx`
  - `frontend/src/components/utils-settings/Settings.jsx`
  - `frontend/src/index.jsx`
  - `frontend/src/utils/actionHistory.ts`

### 3.155 `frontend/src/components/auth/Login.jsx`

- Declared exports: `function`
- Imports (5)
  - `../../AppContext`
  - `../../constants`
  - `../../utils/deviceInfo.ts`
  - `../shared/QuickPreferenceToggles`
  - `react`
- Internal dependencies (4)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/QuickPreferenceToggles.jsx`
  - `frontend/src/constants.ts`
  - `frontend/src/utils/deviceInfo.ts`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.156 `frontend/src/components/branches/Branches.jsx`

- Declared exports: `function`
- Imports (13)
  - `../../AppContext`
  - `../../utils/actionGuards.ts`
  - `../../utils/actionHistory.ts`
  - `../../utils/bulkOps.ts`
  - `../../utils/historyHelpers.ts`
  - `../shared/ActionHistoryBar.jsx`
  - `../shared/Modal`
  - `../shared/PageHeader`
  - `../shared/pageActivity`
  - `./BranchForm`
  - `./TransferModal`
  - `lucide-react`
  - `react`
- Internal dependencies (11)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/branches/BranchForm.jsx`
  - `frontend/src/components/branches/TransferModal.jsx`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/components/shared/PageHeader.jsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/utils/bulkOps.ts`
  - `frontend/src/utils/historyHelpers.ts`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.157 `frontend/src/components/branches/BranchForm.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (1)
  - `frontend/src/components/branches/Branches.jsx`

### 3.158 `frontend/src/components/branches/TransferModal.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `../../utils/actionGuards.ts`
  - `react`
- Internal dependencies (2)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/utils/actionGuards.ts`
- Referenced by (1)
  - `frontend/src/components/branches/Branches.jsx`

### 3.159 `frontend/src/components/catalog/CatalogEditorSurface.jsx`

- Declared exports: `function`
- Imports (5)
  - `../products/shared/primitives`
  - `./CatalogImageField`
  - `./CatalogPageContext`
  - `./catalogUi`
  - `lucide-react`
- Internal dependencies (4)
  - `frontend/src/components/catalog/CatalogImageField.jsx`
  - `frontend/src/components/catalog/CatalogPageContext.jsx`
  - `frontend/src/components/catalog/catalogUi.jsx`
  - `frontend/src/components/products/shared/primitives.jsx`
- Referenced by (1)
  - `frontend/src/components/catalog/CatalogPage.jsx`

### 3.160 `frontend/src/components/catalog/CatalogImageField.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../utils/mediaUpload.ts`
  - `lucide-react`
- Internal dependencies (1)
  - `frontend/src/utils/mediaUpload.ts`
- Referenced by (1)
  - `frontend/src/components/catalog/CatalogEditorSurface.jsx`

### 3.161 `frontend/src/components/catalog/CatalogPage.jsx`

- Declared exports: `function`
- Imports (12)
  - `../../AppContext`
  - `../../utils/actionGuards.ts`
  - `../../utils/favicon`
  - `../products/shared/primitives`
  - `../shared/pageActivity`
  - `./CatalogEditorSurface`
  - `./CatalogPageContext`
  - `./CatalogPreviewSurface`
  - `./CatalogProductsSection`
  - `./CatalogSecondaryTabs`
  - `./catalogUi`
  - `react`
- Internal dependencies (11)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/catalog/CatalogEditorSurface.jsx`
  - `frontend/src/components/catalog/CatalogPageContext.jsx`
  - `frontend/src/components/catalog/CatalogPreviewSurface.jsx`
  - `frontend/src/components/catalog/CatalogProductsSection.jsx`
  - `frontend/src/components/catalog/CatalogSecondaryTabs.jsx`
  - `frontend/src/components/catalog/catalogUi.jsx`
  - `frontend/src/components/products/shared/primitives.jsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/favicon.ts`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.162 `frontend/src/components/catalog/CatalogPageContext.jsx`

- Declared exports: `CatalogPageProvider`, `useCatalogPageContext`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/catalog/CatalogEditorSurface.jsx`
  - `frontend/src/components/catalog/CatalogPage.jsx`

### 3.163 `frontend/src/components/catalog/CatalogPreviewSurface.jsx`

- Declared exports: `function`
- Imports (6)
  - `../files/FilePickerModal`
  - `../products/shared/primitives`
  - `../shared/ImageGalleryLightbox`
  - `../shared/PortalMenu`
  - `lucide-react`
  - `react`
- Internal dependencies (4)
  - `frontend/src/components/files/FilePickerModal.jsx`
  - `frontend/src/components/products/shared/primitives.jsx`
  - `frontend/src/components/shared/ImageGalleryLightbox.jsx`
  - `frontend/src/components/shared/PortalMenu.jsx`
- Referenced by (1)
  - `frontend/src/components/catalog/CatalogPage.jsx`

### 3.164 `frontend/src/components/catalog/CatalogProductsSection.jsx`

- Declared exports: `function`
- Imports (8)
  - `../../utils/initials.ts`
  - `../../utils/scriptTypography.ts`
  - `../products/shared/primitives`
  - `../shared/PaginationControls.jsx`
  - `./catalogUi`
  - `./portalCatalogDisplay.ts`
  - `lucide-react`
  - `react`
- Internal dependencies (6)
  - `frontend/src/components/catalog/catalogUi.jsx`
  - `frontend/src/components/catalog/portalCatalogDisplay.ts`
  - `frontend/src/components/products/shared/primitives.jsx`
  - `frontend/src/components/shared/PaginationControls.jsx`
  - `frontend/src/utils/initials.ts`
  - `frontend/src/utils/scriptTypography.ts`
- Referenced by (1)
  - `frontend/src/components/catalog/CatalogPage.jsx`

### 3.165 `frontend/src/components/catalog/CatalogSecondaryTabs.jsx`

- Declared exports: `function`
- Imports (2)
  - `./catalogUi`
  - `react`
- Internal dependencies (1)
  - `frontend/src/components/catalog/catalogUi.jsx`
- Referenced by (1)
  - `frontend/src/components/catalog/CatalogPage.jsx`

### 3.166 `frontend/src/components/catalog/catalogUi.jsx`

- Declared exports: `SectionShell`, `StatusPill`, `SummaryTile`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `frontend/src/components/catalog/CatalogEditorSurface.jsx`
  - `frontend/src/components/catalog/CatalogPage.jsx`
  - `frontend/src/components/catalog/CatalogProductsSection.jsx`
  - `frontend/src/components/catalog/CatalogSecondaryTabs.jsx`

### 3.167 `frontend/src/components/catalog/portalCatalogDisplay.ts`

- Declared exports: `buildPortalHighlightBadges`, `buildPortalPricePresentation`, `getPortalGridClass`, `getPortalMobileGridClass`, `getPortalPromotionDetails`, `normalizeRecommendedProductIds`, `productMatchesPortalBranches`
- Imports (1)
  - `../../utils/pricing.ts`
- Internal dependencies (1)
  - `frontend/src/utils/pricing.ts`
- Referenced by (1)
  - `frontend/src/components/catalog/CatalogProductsSection.jsx`

### 3.168 `frontend/src/components/catalog/portalContentI18n.ts`

- Declared exports: `localizePortalConfig`, `localizePortalFaqText`, `localizePortalProduct`, `localizePortalProducts`, `normalizePortalTranslations`, `stringifyPortalTranslations`
- Imports (1)
  - `./portalLanguagePacks.ts`
- Internal dependencies (1)
  - `frontend/src/components/catalog/portalLanguagePacks.ts`
- Referenced by (0)
  - none

### 3.169 `frontend/src/components/catalog/portalEditorUtils.ts`

- Declared exports: `createAboutBlock`, `createPromoItem`, `extractGoogleMapsEmbedUrl`, `moveListItem`, `normalizeAboutBlocks`, `normalizeGoogleMapsEmbed`, `normalizePromoItems`, `serializeAboutBlocks`, `serializePromoItems`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.170 `frontend/src/components/catalog/portalLanguagePacks.ts`

- Declared exports: `FIRST_PARTY_PORTAL_LANGUAGE_OPTIONS`, `getPortalLanguageText`, `isFirstPartyPortalLanguage`, `normalizeFirstPartyPortalLanguage`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/catalog/portalContentI18n.ts`

### 3.171 `frontend/src/components/catalog/portalTranslateController.ts`

- Declared exports: `PORTAL_TRANSLATE_RELOAD_KEY`, `PORTAL_TRANSLATE_SCRIPT_ID`, `PORTAL_TRANSLATE_STORAGE_KEY`, `PORTAL_TRANSLATE_WIDGET_HOST_ID`, `applyGoogleTranslateSelection`, `canonicalTranslateLanguage`, `clearGoogleTranslateCookies`, `ensurePortalTranslateScript`, `ensurePortalTranslateWidgetHost`, `getPortalTranslateCookieTarget`, `hasPortalTranslatedMarker`, `isPortalTranslateApplied`, `normalizeTranslateTarget`, `readStoredTranslateTarget`, `removePortalTranslateWidgetHost`, `requestPortalTranslateReload`, `storePortalTranslatePreference`, `warmPortalTranslateNetwork`, `writePortalTranslateTarget`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.172 `frontend/src/components/contacts/ContactImportModal.jsx`

- Declared exports: `function`
- Imports (8)
  - `../../AppContext`
  - `../../utils/actionGuards.ts`
  - `../../utils/csvRowCounter.ts`
  - `../../utils/loaders.ts`
  - `../../utils/publicAssetUrls.ts`
  - `../files/FilePickerModal`
  - `../shared/Modal`
  - `react`
- Internal dependencies (7)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/files/FilePickerModal.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/csvRowCounter.ts`
  - `frontend/src/utils/loaders.ts`
  - `frontend/src/utils/publicAssetUrls.ts`
- Referenced by (4)
  - `frontend/src/components/contacts/Contacts.jsx`
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`

### 3.173 `frontend/src/components/contacts/contactImportWorker.ts`

- Declared exports: none detected
- Imports (1)
  - `../../utils/csvRowCounter`
- Internal dependencies (1)
  - `frontend/src/utils/csvRowCounter.ts`
- Referenced by (0)
  - none

### 3.174 `frontend/src/components/contacts/contactOptionUtils.ts`

- Declared exports: `CONTACT_OPTION_LIMIT`, `buildContactOptionSummary`, `createContactOption`, `getPrimaryContactOption`, `hasContactOptionData`, `limitContactOptions`, `parseContactOptionsFromImportRow`, `parseStoredContactOptions`, `serializeContactOptions`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.175 `frontend/src/components/contacts/Contacts.jsx`

- Declared exports: `function`
- Imports (12)
  - `../../AppContext`
  - `../../utils/csv`
  - `../../utils/loaders.ts`
  - `../shared/Modal`
  - `../shared/PageHeader`
  - `../shared/pageActivity`
  - `./ContactImportModal.jsx`
  - `./CustomersTab`
  - `./DeliveryTab.jsx`
  - `./SuppliersTab.jsx`
  - `lucide-react`
  - `react`
- Internal dependencies (10)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/contacts/ContactImportModal.jsx`
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/components/shared/PageHeader.jsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/csv.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.176 `frontend/src/components/contacts/CustomerFormModal.jsx`

- Declared exports: `function`
- Imports (3)
  - `../shared/Modal`
  - `./customerMembershipNumber`
  - `react`
- Internal dependencies (2)
  - `frontend/src/components/contacts/customerMembershipNumber.ts`
  - `frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `frontend/src/components/contacts/CustomersTab.jsx`

### 3.177 `frontend/src/components/contacts/customerMembershipNumber.ts`

- Declared exports: `generateCustomerMembershipNumber`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/contacts/CustomerFormModal.jsx`
  - `frontend/src/components/contacts/CustomersTab.jsx`

### 3.178 `frontend/src/components/contacts/CustomersTab.jsx`

- Declared exports: `parseContactOptions`, `serializeContactOptions`
- Imports (17)
  - `../../AppContext`
  - `../../utils/actionGuards.ts`
  - `../../utils/actionHistory.ts`
  - `../../utils/bulkOps.ts`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `../../utils/groupedRecords.ts`
  - `../../utils/historyHelpers.ts`
  - `../../utils/loaders.ts`
  - `../shared/ActionHistoryBar.jsx`
  - `../shared/FilterMenu`
  - `./ContactImportModal.jsx`
  - `./CustomerFormModal.jsx`
  - `./customerMembershipNumber`
  - `./shared`
  - `lucide-react`
  - `react`
- Internal dependencies (15)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/contacts/ContactImportModal.jsx`
  - `frontend/src/components/contacts/CustomerFormModal.jsx`
  - `frontend/src/components/contacts/customerMembershipNumber.ts`
  - `frontend/src/components/contacts/shared.jsx`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/FilterMenu.jsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/utils/bulkOps.ts`
  - `frontend/src/utils/csv.ts`
  - `frontend/src/utils/formatters.ts`
  - `frontend/src/utils/groupedRecords.ts`
  - `frontend/src/utils/historyHelpers.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (2)
  - `frontend/src/components/contacts/Contacts.jsx`
  - `frontend/src/components/pos/POS.jsx`

### 3.179 `frontend/src/components/contacts/DeliveryTab.jsx`

- Declared exports: `parseDeliveryOptions`, `serializeDeliveryOptions`
- Imports (16)
  - `../../AppContext`
  - `../../utils/actionGuards.ts`
  - `../../utils/actionHistory.ts`
  - `../../utils/bulkOps.ts`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `../../utils/groupedRecords.ts`
  - `../../utils/historyHelpers.ts`
  - `../../utils/loaders.ts`
  - `../shared/ActionHistoryBar.jsx`
  - `../shared/FilterMenu`
  - `../shared/Modal`
  - `./ContactImportModal.jsx`
  - `./shared`
  - `lucide-react`
  - `react`
- Internal dependencies (14)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/contacts/ContactImportModal.jsx`
  - `frontend/src/components/contacts/shared.jsx`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/FilterMenu.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/utils/bulkOps.ts`
  - `frontend/src/utils/csv.ts`
  - `frontend/src/utils/formatters.ts`
  - `frontend/src/utils/groupedRecords.ts`
  - `frontend/src/utils/historyHelpers.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/components/contacts/Contacts.jsx`

### 3.180 `frontend/src/components/contacts/shared.jsx`

- Declared exports: `ContactTable`, `DetailModal`, `ThreeDotMenu`, `buildSelectedSnapshots`, `countActiveFlags`, `useContactSelection`
- Imports (7)
  - `../../AppContext`
  - `../shared/LoadingWatchdog.jsx`
  - `../shared/Modal`
  - `../shared/PaginationControls.jsx`
  - `../shared/PortalMenu`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/LoadingWatchdog.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/components/shared/PaginationControls.jsx`
  - `frontend/src/components/shared/PortalMenu.jsx`
- Referenced by (3)
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`

### 3.181 `frontend/src/components/contacts/SuppliersTab.jsx`

- Declared exports: none detected
- Imports (16)
  - `../../AppContext`
  - `../../utils/actionGuards.ts`
  - `../../utils/actionHistory.ts`
  - `../../utils/bulkOps.ts`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `../../utils/groupedRecords.ts`
  - `../../utils/historyHelpers.ts`
  - `../../utils/loaders.ts`
  - `../shared/ActionHistoryBar.jsx`
  - `../shared/FilterMenu`
  - `../shared/Modal`
  - `./ContactImportModal.jsx`
  - `./shared`
  - `lucide-react`
  - `react`
- Internal dependencies (14)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/contacts/ContactImportModal.jsx`
  - `frontend/src/components/contacts/shared.jsx`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/FilterMenu.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/utils/bulkOps.ts`
  - `frontend/src/utils/csv.ts`
  - `frontend/src/utils/formatters.ts`
  - `frontend/src/utils/groupedRecords.ts`
  - `frontend/src/utils/historyHelpers.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/components/contacts/Contacts.jsx`

### 3.182 `frontend/src/components/custom-tables/CustomTables.jsx`

- Declared exports: `function`
- Imports (6)
  - `../../AppContext`
  - `../../utils/actionGuards.ts`
  - `../../utils/actionHistory.ts`
  - `../../utils/historyHelpers.ts`
  - `../shared/ActionHistoryBar.jsx`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/utils/historyHelpers.ts`
- Referenced by (0)
  - none

### 3.183 `frontend/src/components/dashboard/charts/BarChart.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../../utils/formatters`
  - `./NoData`
  - `react`
- Internal dependencies (2)
  - `frontend/src/components/dashboard/charts/NoData.jsx`
  - `frontend/src/utils/formatters.ts`
- Referenced by (0)
  - none

### 3.184 `frontend/src/components/dashboard/charts/DonutChart.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../../utils/formatters`
  - `./NoData`
  - `react`
- Internal dependencies (2)
  - `frontend/src/components/dashboard/charts/NoData.jsx`
  - `frontend/src/utils/formatters.ts`
- Referenced by (0)
  - none

### 3.185 `frontend/src/components/dashboard/charts/index.ts`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/dashboard/Dashboard.jsx`
  - `frontend/src/utils/exportReports.jsx`

### 3.186 `frontend/src/components/dashboard/charts/LineChart.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../../utils/formatters`
  - `./NoData`
  - `react`
- Internal dependencies (2)
  - `frontend/src/components/dashboard/charts/NoData.jsx`
  - `frontend/src/utils/formatters.ts`
- Referenced by (0)
  - none

### 3.187 `frontend/src/components/dashboard/charts/NoData.jsx`

- Declared exports: `function`
- Imports (1)
  - `../../../AppContext`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (3)
  - `frontend/src/components/dashboard/charts/BarChart.jsx`
  - `frontend/src/components/dashboard/charts/DonutChart.jsx`
  - `frontend/src/components/dashboard/charts/LineChart.jsx`

### 3.188 `frontend/src/components/dashboard/Dashboard.jsx`

- Declared exports: `function`
- Imports (16)
  - `../../AppContext`
  - `../../api/http.js`
  - `../../utils/csv`
  - `../../utils/dateHelpers`
  - `../../utils/exportPackage`
  - `../../utils/exportReports`
  - `../../utils/formatters`
  - `../../utils/loaders.ts`
  - `../../utils/pricing.ts`
  - `../shared/ExportMenu`
  - `../shared/LoadingWatchdog`
  - `../shared/pageActivity`
  - `./MiniStat`
  - `./charts`
  - `lucide-react`
  - `react`
- Internal dependencies (14)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/api/http.js`
  - `frontend/src/components/dashboard/MiniStat.jsx`
  - `frontend/src/components/dashboard/charts/index.ts`
  - `frontend/src/components/shared/ExportMenu.jsx`
  - `frontend/src/components/shared/LoadingWatchdog.jsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/csv.ts`
  - `frontend/src/utils/dateHelpers.ts`
  - `frontend/src/utils/exportPackage.ts`
  - `frontend/src/utils/exportReports.jsx`
  - `frontend/src/utils/formatters.ts`
  - `frontend/src/utils/loaders.ts`
  - `frontend/src/utils/pricing.ts`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.189 `frontend/src/components/dashboard/MiniStat.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/dashboard/Dashboard.jsx`

### 3.190 `frontend/src/components/files/FilePickerModal.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `../../utils/publicAssetUrls.ts`
  - `../shared/Modal`
  - `react`
- Internal dependencies (3)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/utils/publicAssetUrls.ts`
- Referenced by (5)
  - `frontend/src/components/catalog/CatalogPreviewSurface.jsx`
  - `frontend/src/components/contacts/ContactImportModal.jsx`
  - `frontend/src/components/products/forms/ProductForm.jsx`
  - `frontend/src/components/products/import/BulkImportModal.jsx`
  - `frontend/src/components/users/UserProfileModal.jsx`

### 3.191 `frontend/src/components/files/FilesPage.jsx`

- Declared exports: `function`
- Imports (11)
  - `../../AppContext`
  - `../../utils/actionGuards.ts`
  - `../../utils/actionHistory.ts`
  - `../../utils/historyHelpers.ts`
  - `../../utils/publicAssetUrls.ts`
  - `../shared/ActionHistoryBar.jsx`
  - `../shared/PageHeader`
  - `../shared/pageActivity`
  - `./FilesProvidersTab.jsx`
  - `./FilesResponsesTab.jsx`
  - `react`
- Internal dependencies (10)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/files/FilesProvidersTab.jsx`
  - `frontend/src/components/files/FilesResponsesTab.jsx`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/PageHeader.jsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/utils/historyHelpers.ts`
  - `frontend/src/utils/publicAssetUrls.ts`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.192 `frontend/src/components/files/FilesProvidersTab.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/files/FilesPage.jsx`

### 3.193 `frontend/src/components/files/FilesResponsesTab.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/files/FilesPage.jsx`

### 3.194 `frontend/src/components/inventory/DualMoney.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/inventory/InventoryProductsSurface.jsx`

### 3.195 `frontend/src/components/inventory/Inventory.jsx`

- Declared exports: `function`
- Imports (30)
  - `../../AppContext`
  - `../../api/http.js`
  - `../../utils/actionGuards.ts`
  - `../../utils/actionHistory.ts`
  - `../../utils/bulkOps.ts`
  - `../../utils/csv`
  - `../../utils/exportPackage`
  - `../../utils/exportReports`
  - `../../utils/formatters`
  - `../../utils/groupedRecords.ts`
  - `../../utils/historyHelpers.ts`
  - `../../utils/initials.ts`
  - `../../utils/pricing.ts`
  - `../../utils/productBatches.ts`
  - `../../utils/productGrouping.ts`
  - `../shared/ActionHistoryBar.jsx`
  - `../shared/ExportMenu`
  - `../shared/FilterMenu`
  - `../shared/LoadingWatchdog.jsx`
  - `../shared/PaginationControls.jsx`
  - `../shared/SectionSwitcher.jsx`
  - `../shared/pageActivity`
  - `./InventoryImportModal`
  - `./InventoryMovementsSurface`
  - `./InventoryProductsSurface`
  - `./InventoryRfidSurface`
  - `./ProductDetailModal`
  - `./movementGroups`
  - `lucide-react`
  - `react`
- Internal dependencies (28)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/api/http.js`
  - `frontend/src/components/inventory/InventoryImportModal.jsx`
  - `frontend/src/components/inventory/InventoryMovementsSurface.jsx`
  - `frontend/src/components/inventory/InventoryProductsSurface.jsx`
  - `frontend/src/components/inventory/InventoryRfidSurface.jsx`
  - `frontend/src/components/inventory/ProductDetailModal.jsx`
  - `frontend/src/components/inventory/movementGroups.ts`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/ExportMenu.jsx`
  - `frontend/src/components/shared/FilterMenu.jsx`
  - `frontend/src/components/shared/LoadingWatchdog.jsx`
  - `frontend/src/components/shared/PaginationControls.jsx`
  - `frontend/src/components/shared/SectionSwitcher.jsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/utils/bulkOps.ts`
  - `frontend/src/utils/csv.ts`
  - `frontend/src/utils/exportPackage.ts`
  - `frontend/src/utils/exportReports.jsx`
  - `frontend/src/utils/formatters.ts`
  - `frontend/src/utils/groupedRecords.ts`
  - `frontend/src/utils/historyHelpers.ts`
  - `frontend/src/utils/initials.ts`
  - `frontend/src/utils/pricing.ts`
  - `frontend/src/utils/productBatches.ts`
  - `frontend/src/utils/productGrouping.ts`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.196 `frontend/src/components/inventory/InventoryImportModal.jsx`

- Declared exports: `function`
- Imports (5)
  - `../../AppContext`
  - `../../utils/actionGuards.ts`
  - `../../utils/csvRowCounter.ts`
  - `../shared/Modal`
  - `react`
- Internal dependencies (4)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/csvRowCounter.ts`
- Referenced by (1)
  - `frontend/src/components/inventory/Inventory.jsx`

### 3.197 `frontend/src/components/inventory/inventoryImportWorker.ts`

- Declared exports: none detected
- Imports (1)
  - `../../utils/csvRowCounter`
- Internal dependencies (1)
  - `frontend/src/utils/csvRowCounter.ts`
- Referenced by (0)
  - none

### 3.198 `frontend/src/components/inventory/InventoryMovementsSurface.jsx`

- Declared exports: `function`
- Imports (4)
  - `../shared/ActionHistoryBar`
  - `../shared/ExportMenu`
  - `lucide-react`
  - `react`
- Internal dependencies (2)
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/ExportMenu.jsx`
- Referenced by (1)
  - `frontend/src/components/inventory/Inventory.jsx`

### 3.199 `frontend/src/components/inventory/InventoryProductsSurface.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../utils/scriptTypography.ts`
  - `./DualMoney`
  - `lucide-react`
  - `react`
- Internal dependencies (2)
  - `frontend/src/components/inventory/DualMoney.jsx`
  - `frontend/src/utils/scriptTypography.ts`
- Referenced by (1)
  - `frontend/src/components/inventory/Inventory.jsx`

### 3.200 `frontend/src/components/inventory/InventoryRfidSurface.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/inventory/Inventory.jsx`

### 3.201 `frontend/src/components/inventory/movementGroups.ts`

- Declared exports: `buildMovementGroups`, `getMovementGroupPage`, `movementGroupHaystack`, `normalizeMovementTimestamp`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/tests/inventoryMovementGroups.test.ts`

### 3.202 `frontend/src/components/inventory/ProductDetailModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../utils/pricing.ts`
  - `../../utils/productBatches.ts`
- Internal dependencies (2)
  - `frontend/src/utils/pricing.ts`
  - `frontend/src/utils/productBatches.ts`
- Referenced by (1)
  - `frontend/src/components/inventory/Inventory.jsx`

### 3.203 `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`

- Declared exports: `function`
- Imports (7)
  - `../../AppContext`
  - `../../utils/actionGuards.ts`
  - `../shared/LoadingWatchdog.jsx`
  - `../shared/SectionSwitcher.jsx`
  - `../shared/pageActivity`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/LoadingWatchdog.jsx`
  - `frontend/src/components/shared/SectionSwitcher.jsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/actionGuards.ts`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.204 `frontend/src/components/navigation/Sidebar.jsx`

- Declared exports: `function`
- Imports (7)
  - `../../AppContext`
  - `../../app/appShellUtils.ts`
  - `../shared/NotificationCenter`
  - `../shared/QuickPreferenceToggles`
  - `../shared/navigationConfig`
  - `../users/UserProfileModal`
  - `react`
- Internal dependencies (6)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/app/appShellUtils.ts`
  - `frontend/src/components/shared/NotificationCenter.jsx`
  - `frontend/src/components/shared/QuickPreferenceToggles.jsx`
  - `frontend/src/components/shared/navigationConfig.ts`
  - `frontend/src/components/users/UserProfileModal.jsx`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.205 `frontend/src/components/pos/CartItem.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../utils/pricing.ts`
  - `../../utils/scriptTypography.ts`
- Internal dependencies (2)
  - `frontend/src/utils/pricing.ts`
  - `frontend/src/utils/scriptTypography.ts`
- Referenced by (1)
  - `frontend/src/components/pos/POS.jsx`

### 3.206 `frontend/src/components/pos/FilterPanel.jsx`

- Declared exports: `function`
- Imports (1)
  - `lucide-react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/pos/POS.jsx`

### 3.207 `frontend/src/components/pos/POS.jsx`

- Declared exports: `function`
- Imports (18)
  - `../../AppContext`
  - `../../utils/deviceInfo`
  - `../../utils/initials.ts`
  - `../../utils/pricing.ts`
  - `../../utils/publicAssetUrls.ts`
  - `../../utils/scriptTypography.ts`
  - `../contacts/CustomersTab`
  - `../receipt/Receipt`
  - `../sales/StatusBadge`
  - `../shared/ImageGalleryLightbox`
  - `../shared/PaginationControls.jsx`
  - `../shared/pageActivity`
  - `./CartItem`
  - `./FilterPanel`
  - `./ProductImage`
  - `./QuickAddModal`
  - `lucide-react`
  - `react`
- Internal dependencies (16)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/pos/CartItem.jsx`
  - `frontend/src/components/pos/FilterPanel.jsx`
  - `frontend/src/components/pos/ProductImage.jsx`
  - `frontend/src/components/pos/QuickAddModal.jsx`
  - `frontend/src/components/receipt/Receipt.jsx`
  - `frontend/src/components/sales/StatusBadge.jsx`
  - `frontend/src/components/shared/ImageGalleryLightbox.jsx`
  - `frontend/src/components/shared/PaginationControls.jsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/deviceInfo.ts`
  - `frontend/src/utils/initials.ts`
  - `frontend/src/utils/pricing.ts`
  - `frontend/src/utils/publicAssetUrls.ts`
  - `frontend/src/utils/scriptTypography.ts`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.208 `frontend/src/components/pos/posCore.ts`

- Declared exports: `buildPosFilterMeta`, `buildProductsById`, `buildVariantChildrenByParentId`, `buildVisibleProductCards`, `findMatchingCartLineIndex`, `getCartLineId`, `getVariantChoices`, `getVariantRootProduct`, `resolveCartPriceValues`
- Imports (3)
  - `../../utils/initials.ts`
  - `../../utils/pricing.ts`
  - `../../utils/productGrouping.ts`
- Internal dependencies (3)
  - `frontend/src/utils/initials.ts`
  - `frontend/src/utils/pricing.ts`
  - `frontend/src/utils/productGrouping.ts`
- Referenced by (0)
  - none

### 3.209 `frontend/src/components/pos/ProductImage.jsx`

- Declared exports: `function`
- Imports (1)
  - `../products/shared/primitives`
- Internal dependencies (1)
  - `frontend/src/components/products/shared/primitives.jsx`
- Referenced by (1)
  - `frontend/src/components/pos/POS.jsx`

### 3.210 `frontend/src/components/pos/QuickAddModal.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/pos/POS.jsx`

### 3.211 `frontend/src/components/products/config/productPageConfig.ts`

- Declared exports: `CREATED_MONTH_OPTIONS`, `DEFAULT_META_PILL_COLOR`, `PRODUCTS_AUX_OPTIONS_TIMEOUT_MS`, `PRODUCTS_BY_ID_TIMEOUT_MS`, `PRODUCTS_FILTER_META_TIMEOUT_MS`, `PRODUCT_DELETE_MUTATION_TIMEOUT_MS`, `PRODUCT_IMAGE_UPLOAD_TIMEOUT_MS`, `PRODUCT_STOCK_MUTATION_TIMEOUT_MS`, `PRODUCT_WRITE_MUTATION_TIMEOUT_MS`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.212 `frontend/src/components/products/forms/BranchStockAdjuster.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../../utils/actionGuards.ts`
  - `../../../utils/loaders.ts`
  - `react`
- Internal dependencies (2)
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/components/products/forms/ProductForm.jsx`

### 3.213 `frontend/src/components/products/forms/BulkAddStockModal.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../../utils/actionGuards.ts`
  - `../../../utils/loaders.ts`
  - `react`
- Internal dependencies (2)
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.214 `frontend/src/components/products/forms/ProductForm.jsx`

- Declared exports: `function`
- Imports (9)
  - `../../../utils/mediaUpload.ts`
  - `../../../utils/pricing.ts`
  - `../../files/FilePickerModal`
  - `../../shared/Modal`
  - `../scanning/BarcodeScannerModal`
  - `../shared/primitives`
  - `./BranchStockAdjuster`
  - `lucide-react`
  - `react`
- Internal dependencies (7)
  - `frontend/src/components/files/FilePickerModal.jsx`
  - `frontend/src/components/products/forms/BranchStockAdjuster.jsx`
  - `frontend/src/components/products/scanning/BarcodeScannerModal.jsx`
  - `frontend/src/components/products/shared/primitives.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/utils/mediaUpload.ts`
  - `frontend/src/utils/pricing.ts`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.215 `frontend/src/components/products/forms/VariantFormModal.jsx`

- Declared exports: `function`
- Imports (8)
  - `../../../AppContext`
  - `../../../utils/actionGuards.ts`
  - `../../../utils/historyHelpers.ts`
  - `../../../utils/loaders.ts`
  - `../../../utils/pricing.ts`
  - `../../shared/Modal`
  - `../shared/primitives`
  - `react`
- Internal dependencies (7)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/products/shared/primitives.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/historyHelpers.ts`
  - `frontend/src/utils/loaders.ts`
  - `frontend/src/utils/pricing.ts`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.216 `frontend/src/components/products/helpers/productDisplayHelpers.ts`

- Declared exports: `PRODUCT_STOCK_STATUS_CLASS`, `buildBranchNameByIdMap`, `buildNameLookupMap`, `buildProductBranchSummaryLabel`, `buildProductBrandOptions`, `buildProductRowDisplayState`, `getProductStockStatus`
- Imports (1)
  - `../../../utils/pricing.ts`
- Internal dependencies (1)
  - `frontend/src/utils/pricing.ts`
- Referenced by (0)
  - none

### 3.217 `frontend/src/components/products/helpers/productFilterHelpers.ts`

- Declared exports: `buildProductExportRows`, `buildProductSearchTerms`, `filterProductsForPage`, `getProductBranchQuantity`
- Imports (2)
  - `../../../utils/groupedRecords.ts`
  - `../../../utils/pricing.ts`
- Internal dependencies (2)
  - `frontend/src/utils/groupedRecords.ts`
  - `frontend/src/utils/pricing.ts`
- Referenced by (0)
  - none

### 3.218 `frontend/src/components/products/helpers/productGalleryHelpers.ts`

- Declared exports: `buildProductLightboxGalleryInput`, `buildProductLightboxState`, `buildProductThumbnailState`, `clampProductLightboxIndex`, `getProductGalleryImages`, `normalizeProductGallery`, `resolveProductImageUrl`, `updateProductLightboxIndex`
- Imports (1)
  - `../../../utils/publicAssetUrls.ts`
- Internal dependencies (1)
  - `frontend/src/utils/publicAssetUrls.ts`
- Referenced by (1)
  - `frontend/src/components/products/helpers/productWriteHelpers.ts`

### 3.219 `frontend/src/components/products/helpers/productGroupViewHelpers.ts`

- Declared exports: `buildProductGroupPriceLabel`, `buildProductGroupSummaryParts`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.220 `frontend/src/components/products/helpers/productMenuHelpers.ts`

- Declared exports: `buildProductExportItems`, `buildProductFilterSections`, `buildProductSupplierOptions`, `countActiveProductFilters`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.221 `frontend/src/components/products/helpers/productPageHelpers.ts`

- Declared exports: `normalizeBrandLookup`, `parseBrandColorMap`, `useDebouncedValue`, `waitForNextFrame`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.222 `frontend/src/components/products/helpers/productSelectionHelpers.ts`

- Declared exports: `buildJumpTargetIdsByLetter`, `buildParentProductIdSet`, `buildProductIdMap`, `buildProductPaginationState`, `buildSelectedProducts`, `buildSelectedVisibleIds`, `buildVisibleProductIds`, `isSelectionScopeFullySelected`, `isSelectionScopePartiallySelected`, `normalizePositiveProductIds`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.223 `frontend/src/components/products/helpers/productWriteHelpers.ts`

- Declared exports: `buildDefinedProductUpdates`, `buildDeletedProductIdSet`, `buildProductBranchMovePlan`, `buildProductBranchStockAdjustments`, `buildProductBulkInfoUpdates`, `buildProductBulkPricingUpdates`, `buildProductBulkUpdatePayload`, `buildProductClearStockAdjustments`, `buildProductStockAdjustmentPayload`, `buildProductTransferStockPayload`, `buildProductWritePayload`, `getDefaultProductRestoreBranchId`, `getPreferredProductRestoreBranchId`, `resolveRestoredProductParentId`, `summarizeProductBulkRun`
- Imports (2)
  - `../../../utils/pricing.ts`
  - `./productGalleryHelpers.ts`
- Internal dependencies (2)
  - `frontend/src/components/products/helpers/productGalleryHelpers.ts`
  - `frontend/src/utils/pricing.ts`
- Referenced by (0)
  - none

### 3.224 `frontend/src/components/products/history/productHistoryHelpers.ts`

- Declared exports: `createProductHistoryRequestId`, `orderProductRestoreSnapshots`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/products/Products.jsx`
  - `frontend/tests/productHistoryHelpers.test.ts`

### 3.225 `frontend/src/components/products/import/BulkImportModal.jsx`

- Declared exports: `function`
- Imports (6)
  - `../../../utils/actionGuards.ts`
  - `../../../utils/loaders.ts`
  - `../../files/FilePickerModal`
  - `../../shared/Modal`
  - `lucide-react`
  - `react`
- Internal dependencies (4)
  - `frontend/src/components/files/FilePickerModal.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.226 `frontend/src/components/products/import/productImportPlanner.ts`

- Declared exports: `BLOCKING_PRODUCT_IMPORT_ISSUES`, `PRODUCT_MONEY_FIELDS`, `PRODUCT_NUMBER_FIELDS`, `PRODUCT_PERCENT_FIELDS`, `analyzeProductImportRows`, `analyzeProductImportText`, `getProductImportBarcodeIssue`, `getProductImportDetailSignature`, `isBlockingProductImportIssue`, `normalizeImportProductName`, `normalizeProductImportRow`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `frontend/src/components/products/import/productImportWorker.ts`
  - `frontend/tests/productImportPlanner.test.ts`
  - `frontend/tests/productImportWorkerFallback.test.ts`

### 3.227 `frontend/src/components/products/import/productImportWorker.ts`

- Declared exports: none detected
- Imports (1)
  - `./productImportPlanner`
- Internal dependencies (1)
  - `frontend/src/components/products/import/productImportPlanner.ts`
- Referenced by (0)
  - none

### 3.228 `frontend/src/components/products/lookups/ManageBrandsModal.jsx`

- Declared exports: `function`
- Imports (6)
  - `../../../AppContext`
  - `../../../utils/actionGuards.ts`
  - `../../../utils/actionHistory.ts`
  - `../../shared/ActionHistoryBar.jsx`
  - `../../shared/Modal`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.229 `frontend/src/components/products/lookups/ManageCategoriesModal.jsx`

- Declared exports: `function`
- Imports (6)
  - `../../../AppContext`
  - `../../../utils/actionGuards.ts`
  - `../../../utils/actionHistory.ts`
  - `../../shared/ActionHistoryBar.jsx`
  - `../../shared/Modal`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.230 `frontend/src/components/products/lookups/ManageUnitsModal.jsx`

- Declared exports: `function`
- Imports (6)
  - `../../../AppContext`
  - `../../../utils/actionGuards.ts`
  - `../../../utils/actionHistory.ts`
  - `../../shared/ActionHistoryBar.jsx`
  - `../../shared/Modal`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.231 `frontend/src/components/products/lookups/productLookupSnapshots.ts`

- Declared exports: `fetchLookupProductSnapshots`, `normalizeLookup`, `restoreLookupProductSnapshots`
- Imports (1)
  - `../../../utils/loaders`
- Internal dependencies (1)
  - `frontend/src/utils/loaders.ts`
- Referenced by (0)
  - none

### 3.232 `frontend/src/components/products/Products.jsx`

- Declared exports: `function`
- Imports (32)
  - `../../AppContext`
  - `../../api/http.js`
  - `../../utils/actionGuards.ts`
  - `../../utils/actionHistory.ts`
  - `../../utils/bulkOps.ts`
  - `../../utils/color.ts`
  - `../../utils/csv`
  - `../../utils/groupedRecords.ts`
  - `../../utils/historyHelpers.ts`
  - `../../utils/initials.ts`
  - `../../utils/productGrouping.ts`
  - `../../utils/scriptTypography.ts`
  - `../shared/ActionHistoryBar.jsx`
  - `../shared/FilterMenu`
  - `../shared/ImageGalleryLightbox`
  - `../shared/Modal`
  - `../shared/PaginationControls.jsx`
  - `../shared/pageActivity`
  - `./forms/BulkAddStockModal`
  - `./forms/ProductForm`
  - `./forms/VariantFormModal`
  - `./history/productHistoryHelpers.ts`
  - `./import/BulkImportModal`
  - `./lookups/ManageBrandsModal`
  - `./lookups/ManageCategoriesModal`
  - `./lookups/ManageUnitsModal`
  - `./shared/primitives`
  - `./surfaces/HeaderActions`
  - `./surfaces/ProductDetailModal`
  - `./surfaces/ProductsListSurface`
  - `lucide-react`
  - `react`
- Internal dependencies (30)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/api/http.js`
  - `frontend/src/components/products/forms/BulkAddStockModal.jsx`
  - `frontend/src/components/products/forms/ProductForm.jsx`
  - `frontend/src/components/products/forms/VariantFormModal.jsx`
  - `frontend/src/components/products/history/productHistoryHelpers.ts`
  - `frontend/src/components/products/import/BulkImportModal.jsx`
  - `frontend/src/components/products/lookups/ManageBrandsModal.jsx`
  - `frontend/src/components/products/lookups/ManageCategoriesModal.jsx`
  - `frontend/src/components/products/lookups/ManageUnitsModal.jsx`
  - `frontend/src/components/products/shared/primitives.jsx`
  - `frontend/src/components/products/surfaces/HeaderActions.jsx`
  - `frontend/src/components/products/surfaces/ProductDetailModal.jsx`
  - `frontend/src/components/products/surfaces/ProductsListSurface.jsx`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/FilterMenu.jsx`
  - `frontend/src/components/shared/ImageGalleryLightbox.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/components/shared/PaginationControls.jsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/utils/bulkOps.ts`
  - `frontend/src/utils/color.ts`
  - `frontend/src/utils/csv.ts`
  - `frontend/src/utils/groupedRecords.ts`
  - `frontend/src/utils/historyHelpers.ts`
  - `frontend/src/utils/initials.ts`
  - `frontend/src/utils/productGrouping.ts`
  - `frontend/src/utils/scriptTypography.ts`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.233 `frontend/src/components/products/scanning/barcodeImageScanner.ts`

- Declared exports: `scanBarcodeFromImageFile`
- Imports (1)
  - `@zxing/browser`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/products/scanning/BarcodeScannerModal.jsx`
  - `frontend/tests/barcodeImageScanner.test.ts`

### 3.234 `frontend/src/components/products/scanning/BarcodeScannerModal.jsx`

- Declared exports: `function`
- Imports (7)
  - `../../shared/Modal`
  - `./barcodeImageScanner.ts`
  - `./barcodeScannerState.ts`
  - `./scanbotScanner.ts`
  - `@zxing/browser`
  - `lucide-react`
  - `react`
- Internal dependencies (4)
  - `frontend/src/components/products/scanning/barcodeImageScanner.ts`
  - `frontend/src/components/products/scanning/barcodeScannerState.ts`
  - `frontend/src/components/products/scanning/scanbotScanner.ts`
  - `frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `frontend/src/components/products/forms/ProductForm.jsx`

### 3.235 `frontend/src/components/products/scanning/barcodeScannerState.ts`

- Declared exports: `deriveScannerPresentation`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/products/scanning/BarcodeScannerModal.jsx`
  - `frontend/tests/barcodeScannerState.test.ts`

### 3.236 `frontend/src/components/products/scanning/scanbotScanner.ts`

- Declared exports: `getPreferredScannerMode`, `isCameraBlockedByDocumentPolicy`, `scanBarcodeWithScanbot`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/products/scanning/BarcodeScannerModal.jsx`
  - `frontend/tests/scanbotScanner.test.ts`

### 3.237 `frontend/src/components/products/shared/primitives.jsx`

- Declared exports: none detected
- Imports (3)
  - `../../../utils/publicAssetUrls.ts`
  - `lucide-react`
  - `react`
- Internal dependencies (1)
  - `frontend/src/utils/publicAssetUrls.ts`
- Referenced by (9)
  - `frontend/src/components/catalog/CatalogEditorSurface.jsx`
  - `frontend/src/components/catalog/CatalogPage.jsx`
  - `frontend/src/components/catalog/CatalogPreviewSurface.jsx`
  - `frontend/src/components/catalog/CatalogProductsSection.jsx`
  - `frontend/src/components/pos/ProductImage.jsx`
  - `frontend/src/components/products/forms/ProductForm.jsx`
  - `frontend/src/components/products/forms/VariantFormModal.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/products/surfaces/ProductDetailModal.jsx`

### 3.238 `frontend/src/components/products/surfaces/HeaderActions.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../shared/ExportMenu`
  - `../../shared/PortalMenu`
  - `lucide-react`
- Internal dependencies (2)
  - `frontend/src/components/shared/ExportMenu.jsx`
  - `frontend/src/components/shared/PortalMenu.jsx`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.239 `frontend/src/components/products/surfaces/ProductDetailModal.jsx`

- Declared exports: `function`
- Imports (5)
  - `../../../utils/color.ts`
  - `../../../utils/pricing.ts`
  - `../../../utils/productBatches.ts`
  - `../shared/primitives`
  - `lucide-react`
- Internal dependencies (4)
  - `frontend/src/components/products/shared/primitives.jsx`
  - `frontend/src/utils/color.ts`
  - `frontend/src/utils/pricing.ts`
  - `frontend/src/utils/productBatches.ts`
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.240 `frontend/src/components/products/surfaces/ProductRowParts.jsx`

- Declared exports: `ProductBatchPreview`, `ProductDetailsCell`, `ProductDiscountBadge`, `ProductRowActions`
- Imports (3)
  - `../../../utils/pricing.ts`
  - `../../../utils/productBatches.ts`
  - `../../shared/PortalMenu`
- Internal dependencies (3)
  - `frontend/src/components/shared/PortalMenu.jsx`
  - `frontend/src/utils/pricing.ts`
  - `frontend/src/utils/productBatches.ts`
- Referenced by (0)
  - none

### 3.241 `frontend/src/components/products/surfaces/ProductsListSurface.jsx`

- Declared exports: `function`
- Imports (2)
  - `lucide-react`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/products/Products.jsx`

### 3.242 `frontend/src/components/receipt-settings/AllFieldsPanel.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `./constants`
  - `react`
- Internal dependencies (2)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/receipt-settings/constants.ts`
- Referenced by (1)
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.243 `frontend/src/components/receipt-settings/constants.ts`

- Declared exports: `ALL_FIELD_ITEMS`, `DEFAULT_TEMPLATE`, `getFieldItems`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `frontend/src/components/receipt-settings/AllFieldsPanel.jsx`
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`
  - `frontend/src/components/receipt-settings/template.ts`
  - `frontend/tests/receiptTemplate.test.ts`

### 3.244 `frontend/src/components/receipt-settings/ErrorBoundary.jsx`

- Declared exports: `class`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.245 `frontend/src/components/receipt-settings/FieldOrderManager.jsx`

- Declared exports: `function`
- Imports (2)
  - `lucide-react`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.246 `frontend/src/components/receipt-settings/PrintSettings.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../utils/printReceipt`
  - `lucide-react`
  - `react`
- Internal dependencies (1)
  - `frontend/src/utils/printReceipt.ts`
- Referenced by (1)
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.247 `frontend/src/components/receipt-settings/ReceiptPreview.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../utils/receiptAppliedConfig.ts`
  - `../receipt/Receipt`
  - `react`
- Internal dependencies (2)
  - `frontend/src/components/receipt/Receipt.jsx`
  - `frontend/src/utils/receiptAppliedConfig.ts`
- Referenced by (1)
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

### 3.248 `frontend/src/components/receipt-settings/ReceiptSettings.jsx`

- Declared exports: `function`
- Imports (12)
  - `../../AppContext`
  - `../../utils/loaders.ts`
  - `../../utils/receiptAppliedConfig.ts`
  - `./AllFieldsPanel`
  - `./ErrorBoundary`
  - `./FieldOrderManager`
  - `./PrintSettings`
  - `./ReceiptPreview`
  - `./constants`
  - `./template`
  - `lucide-react`
  - `react`
- Internal dependencies (10)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/receipt-settings/AllFieldsPanel.jsx`
  - `frontend/src/components/receipt-settings/ErrorBoundary.jsx`
  - `frontend/src/components/receipt-settings/FieldOrderManager.jsx`
  - `frontend/src/components/receipt-settings/PrintSettings.jsx`
  - `frontend/src/components/receipt-settings/ReceiptPreview.jsx`
  - `frontend/src/components/receipt-settings/constants.ts`
  - `frontend/src/components/receipt-settings/template.ts`
  - `frontend/src/utils/loaders.ts`
  - `frontend/src/utils/receiptAppliedConfig.ts`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.249 `frontend/src/components/receipt-settings/template.ts`

- Declared exports: `parseReceiptTemplate`, `serializeReceiptTemplate`
- Imports (1)
  - `./constants.ts`
- Internal dependencies (1)
  - `frontend/src/components/receipt-settings/constants.ts`
- Referenced by (3)
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`
  - `frontend/src/components/receipt/Receipt.jsx`
  - `frontend/tests/receiptTemplate.test.ts`

### 3.250 `frontend/src/components/receipt/Receipt.jsx`

- Declared exports: `function`
- Imports (7)
  - `../../AppContext`
  - `../../utils/printReceipt`
  - `../../utils/receiptAppliedConfig.ts`
  - `../receipt-settings/template`
  - `../sales/StatusBadge`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/receipt-settings/template.ts`
  - `frontend/src/components/sales/StatusBadge.jsx`
  - `frontend/src/utils/printReceipt.ts`
  - `frontend/src/utils/receiptAppliedConfig.ts`
- Referenced by (3)
  - `frontend/src/components/pos/POS.jsx`
  - `frontend/src/components/receipt-settings/ReceiptPreview.jsx`
  - `frontend/src/components/sales/Sales.jsx`

### 3.251 `frontend/src/components/returns/EditReturnModal.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `../../utils/actionGuards.ts`
  - `../../utils/loaders.ts`
  - `react`
- Internal dependencies (3)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/components/returns/Returns.jsx`

### 3.252 `frontend/src/components/returns/NewReturnModal.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `../../utils/actionGuards.ts`
  - `../../utils/formatters`
  - `react`
- Internal dependencies (3)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/formatters.ts`
- Referenced by (1)
  - `frontend/src/components/returns/Returns.jsx`

### 3.253 `frontend/src/components/returns/NewSupplierReturnModal.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `../../utils/actionGuards.ts`
  - `react`
- Internal dependencies (2)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/utils/actionGuards.ts`
- Referenced by (1)
  - `frontend/src/components/returns/Returns.jsx`

### 3.254 `frontend/src/components/returns/ReturnDetailModal.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `../../utils/formatters`
- Internal dependencies (2)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/utils/formatters.ts`
- Referenced by (1)
  - `frontend/src/components/returns/Returns.jsx`

### 3.255 `frontend/src/components/returns/Returns.jsx`

- Declared exports: `function`
- Imports (19)
  - `../../AppContext`
  - `../../utils/actionGuards.ts`
  - `../../utils/actionHistory.ts`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `../../utils/groupedRecords.ts`
  - `../../utils/historyHelpers.ts`
  - `../shared/ActionHistoryBar.jsx`
  - `../shared/ExportMenu`
  - `../shared/FilterMenu`
  - `../shared/PaginationControls.jsx`
  - `../shared/pageActivity`
  - `./EditReturnModal`
  - `./NewReturnModal`
  - `./NewSupplierReturnModal`
  - `./ReturnDetailModal`
  - `./ReturnsListSurface`
  - `lucide-react`
  - `react`
- Internal dependencies (17)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/returns/EditReturnModal.jsx`
  - `frontend/src/components/returns/NewReturnModal.jsx`
  - `frontend/src/components/returns/NewSupplierReturnModal.jsx`
  - `frontend/src/components/returns/ReturnDetailModal.jsx`
  - `frontend/src/components/returns/ReturnsListSurface.jsx`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/ExportMenu.jsx`
  - `frontend/src/components/shared/FilterMenu.jsx`
  - `frontend/src/components/shared/PaginationControls.jsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/utils/csv.ts`
  - `frontend/src/utils/formatters.ts`
  - `frontend/src/utils/groupedRecords.ts`
  - `frontend/src/utils/historyHelpers.ts`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.256 `frontend/src/components/returns/ReturnsListSurface.jsx`

- Declared exports: `function`
- Imports (2)
  - `lucide-react`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/returns/Returns.jsx`

### 3.257 `frontend/src/components/sales/ExportModal.jsx`

- Declared exports: `function`
- Imports (5)
  - `../../utils/loaders.ts`
  - `../shared/Modal`
  - `./StatusBadge`
  - `lucide-react`
  - `react`
- Internal dependencies (3)
  - `frontend/src/components/sales/StatusBadge.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/components/sales/Sales.jsx`

### 3.258 `frontend/src/components/sales/SaleDetailModal.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../utils/formatters`
  - `./StatusBadge`
  - `react`
- Internal dependencies (2)
  - `frontend/src/components/sales/StatusBadge.jsx`
  - `frontend/src/utils/formatters.ts`
- Referenced by (1)
  - `frontend/src/components/sales/Sales.jsx`

### 3.259 `frontend/src/components/sales/Sales.jsx`

- Declared exports: `function`
- Imports (21)
  - `../../AppContext`
  - `../../utils/actionGuards.ts`
  - `../../utils/actionHistory.ts`
  - `../../utils/bulkOps.ts`
  - `../../utils/csv`
  - `../../utils/deviceInfo`
  - `../../utils/formatters`
  - `../../utils/groupedRecords.ts`
  - `../receipt/Receipt`
  - `../shared/ActionHistoryBar.jsx`
  - `../shared/ExportMenu`
  - `../shared/FilterMenu`
  - `../shared/PaginationControls.jsx`
  - `../shared/pageActivity`
  - `./ExportModal`
  - `./SaleDetailModal`
  - `./SalesImportModal`
  - `./SalesListSurface`
  - `./StatusBadge`
  - `lucide-react`
  - `react`
- Internal dependencies (19)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/receipt/Receipt.jsx`
  - `frontend/src/components/sales/ExportModal.jsx`
  - `frontend/src/components/sales/SaleDetailModal.jsx`
  - `frontend/src/components/sales/SalesImportModal.jsx`
  - `frontend/src/components/sales/SalesListSurface.jsx`
  - `frontend/src/components/sales/StatusBadge.jsx`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/ExportMenu.jsx`
  - `frontend/src/components/shared/FilterMenu.jsx`
  - `frontend/src/components/shared/PaginationControls.jsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/utils/bulkOps.ts`
  - `frontend/src/utils/csv.ts`
  - `frontend/src/utils/deviceInfo.ts`
  - `frontend/src/utils/formatters.ts`
  - `frontend/src/utils/groupedRecords.ts`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.260 `frontend/src/components/sales/SalesImportModal.jsx`

- Declared exports: `function`
- Imports (5)
  - `../../AppContext`
  - `../../utils/actionGuards.ts`
  - `../../utils/csvRowCounter.ts`
  - `../shared/Modal`
  - `react`
- Internal dependencies (4)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/csvRowCounter.ts`
- Referenced by (1)
  - `frontend/src/components/sales/Sales.jsx`

### 3.261 `frontend/src/components/sales/salesImportWorker.ts`

- Declared exports: none detected
- Imports (1)
  - `../../utils/csvRowCounter`
- Internal dependencies (1)
  - `frontend/src/utils/csvRowCounter.ts`
- Referenced by (0)
  - none

### 3.262 `frontend/src/components/sales/SalesListSurface.jsx`

- Declared exports: `function`
- Imports (3)
  - `./StatusBadge`
  - `lucide-react`
  - `react`
- Internal dependencies (1)
  - `frontend/src/components/sales/StatusBadge.jsx`
- Referenced by (1)
  - `frontend/src/components/sales/Sales.jsx`

### 3.263 `frontend/src/components/sales/StatusBadge.jsx`

- Declared exports: `ALL_STATUSES`, `STATUS_COLORS`, `STATUS_LABELS`, `function`, `getStatusLabel`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (6)
  - `frontend/src/components/pos/POS.jsx`
  - `frontend/src/components/receipt/Receipt.jsx`
  - `frontend/src/components/sales/ExportModal.jsx`
  - `frontend/src/components/sales/SaleDetailModal.jsx`
  - `frontend/src/components/sales/Sales.jsx`
  - `frontend/src/components/sales/SalesListSurface.jsx`

### 3.264 `frontend/src/components/server/ServerPage.jsx`

- Declared exports: `function`
- Imports (5)
  - `../../AppContext`
  - `../../utils/actionGuards.ts`
  - `../shared/PageHeader`
  - `../shared/pageActivity`
  - `react`
- Internal dependencies (4)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/PageHeader.jsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/actionGuards.ts`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.265 `frontend/src/components/shared/ActionHistoryBar.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext.jsx`
  - `lucide-react`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (17)
  - `frontend/src/components/branches/Branches.jsx`
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`
  - `frontend/src/components/custom-tables/CustomTables.jsx`
  - `frontend/src/components/files/FilesPage.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/inventory/InventoryMovementsSurface.jsx`
  - `frontend/src/components/products/lookups/ManageBrandsModal.jsx`
  - `frontend/src/components/products/lookups/ManageCategoriesModal.jsx`
  - `frontend/src/components/products/lookups/ManageUnitsModal.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/returns/Returns.jsx`
  - `frontend/src/components/sales/Sales.jsx`
  - `frontend/src/components/users/UserProfileModal.jsx`
  - `frontend/src/components/users/Users.jsx`
  - `frontend/src/components/utils-settings/Backup.jsx`

### 3.266 `frontend/src/components/shared/BackgroundImportTracker.jsx`

- Declared exports: `function`
- Imports (7)
  - `../../AppContext`
  - `../../api/http.js`
  - `../../utils/actionGuards.ts`
  - `../../utils/importJobRefresh.ts`
  - `../../utils/loaders.ts`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/api/http.js`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/importJobRefresh.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.267 `frontend/src/components/shared/ExportMenu.jsx`

- Declared exports: `function`
- Imports (2)
  - `./PortalMenu`
  - `lucide-react`
- Internal dependencies (1)
  - `frontend/src/components/shared/PortalMenu.jsx`
- Referenced by (7)
  - `frontend/src/components/dashboard/Dashboard.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/inventory/InventoryMovementsSurface.jsx`
  - `frontend/src/components/products/surfaces/HeaderActions.jsx`
  - `frontend/src/components/returns/Returns.jsx`
  - `frontend/src/components/sales/Sales.jsx`
  - `frontend/src/components/utils-settings/AuditLog.jsx`

### 3.268 `frontend/src/components/shared/FilterMenu.jsx`

- Declared exports: `function`
- Imports (2)
  - `./PortalMenu`
  - `lucide-react`
- Internal dependencies (1)
  - `frontend/src/components/shared/PortalMenu.jsx`
- Referenced by (8)
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/returns/Returns.jsx`
  - `frontend/src/components/sales/Sales.jsx`
  - `frontend/src/components/utils-settings/AuditLog.jsx`

### 3.269 `frontend/src/components/shared/globalScroll.ts`

- Declared exports: `getScrollTarget`, `getScrollToPosition`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/App.jsx`
  - `frontend/tests/globalScrollControls.test.ts`

### 3.270 `frontend/src/components/shared/ImageGalleryLightbox.jsx`

- Declared exports: `function`
- Imports (2)
  - `lucide-react`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `frontend/src/components/catalog/CatalogPreviewSurface.jsx`
  - `frontend/src/components/pos/POS.jsx`
  - `frontend/src/components/products/Products.jsx`

### 3.271 `frontend/src/components/shared/LoadingWatchdog.jsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (6)
  - `frontend/src/components/contacts/shared.jsx`
  - `frontend/src/components/dashboard/Dashboard.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`
  - `frontend/src/components/utils-settings/Backup.jsx`
  - `frontend/src/components/utils-settings/Settings.jsx`

### 3.272 `frontend/src/components/shared/Modal.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (22)
  - `frontend/src/components/branches/Branches.jsx`
  - `frontend/src/components/contacts/ContactImportModal.jsx`
  - `frontend/src/components/contacts/Contacts.jsx`
  - `frontend/src/components/contacts/CustomerFormModal.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/shared.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`
  - `frontend/src/components/files/FilePickerModal.jsx`
  - `frontend/src/components/inventory/InventoryImportModal.jsx`
  - `frontend/src/components/products/forms/ProductForm.jsx`
  - `frontend/src/components/products/forms/VariantFormModal.jsx`
  - `frontend/src/components/products/import/BulkImportModal.jsx`
  - `frontend/src/components/products/lookups/ManageBrandsModal.jsx`
  - `frontend/src/components/products/lookups/ManageCategoriesModal.jsx`
  - `frontend/src/components/products/lookups/ManageUnitsModal.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/products/scanning/BarcodeScannerModal.jsx`
  - `frontend/src/components/sales/ExportModal.jsx`
  - `frontend/src/components/sales/SalesImportModal.jsx`
  - `frontend/src/components/shared/WriteConflictModal.jsx`
  - `frontend/src/components/users/UserProfileModal.jsx`
  - `frontend/src/components/users/Users.jsx`

### 3.273 `frontend/src/components/shared/navigationConfig.ts`

- Declared exports: `DEFAULT_MOBILE_PINNED`, `NAV_ITEMS`, `orderNavItems`, `parseNavSetting`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `frontend/src/components/navigation/Sidebar.jsx`
  - `frontend/src/components/utils-settings/Settings.jsx`
  - `frontend/tests/navigationConfig.test.ts`

### 3.274 `frontend/src/components/shared/NotificationCenter.jsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext`
  - `lucide-react`
  - `react`
  - `react-dom`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (2)
  - `frontend/src/App.jsx`
  - `frontend/src/components/navigation/Sidebar.jsx`

### 3.275 `frontend/src/components/shared/pageActivity.ts`

- Declared exports: `useIsPageActive`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (15)
  - `frontend/src/components/branches/Branches.jsx`
  - `frontend/src/components/catalog/CatalogPage.jsx`
  - `frontend/src/components/contacts/Contacts.jsx`
  - `frontend/src/components/dashboard/Dashboard.jsx`
  - `frontend/src/components/files/FilesPage.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`
  - `frontend/src/components/pos/POS.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/returns/Returns.jsx`
  - `frontend/src/components/sales/Sales.jsx`
  - `frontend/src/components/server/ServerPage.jsx`
  - `frontend/src/components/users/Users.jsx`
  - `frontend/src/components/utils-settings/AuditLog.jsx`
  - `frontend/src/components/utils-settings/Backup.jsx`

### 3.276 `frontend/src/components/shared/PageHeader.jsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (6)
  - `frontend/src/components/branches/Branches.jsx`
  - `frontend/src/components/contacts/Contacts.jsx`
  - `frontend/src/components/files/FilesPage.jsx`
  - `frontend/src/components/server/ServerPage.jsx`
  - `frontend/src/components/utils-settings/Backup.jsx`
  - `frontend/src/components/utils-settings/Settings.jsx`

### 3.277 `frontend/src/components/shared/PaginationControls.jsx`

- Declared exports: `PAGE_SIZE_OPTIONS`, `clampPage`, `function`, `paginateItems`
- Imports (2)
  - `lucide-react`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (8)
  - `frontend/src/components/catalog/CatalogProductsSection.jsx`
  - `frontend/src/components/contacts/shared.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/pos/POS.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/returns/Returns.jsx`
  - `frontend/src/components/sales/Sales.jsx`
  - `frontend/src/components/utils-settings/AuditLog.jsx`

### 3.278 `frontend/src/components/shared/PortalMenu.jsx`

- Declared exports: `ThreeDotPortal`, `function`
- Imports (3)
  - `lucide-react`
  - `react`
  - `react-dom`
- Internal dependencies (0)
  - none
- Referenced by (7)
  - `frontend/src/components/catalog/CatalogPreviewSurface.jsx`
  - `frontend/src/components/contacts/shared.jsx`
  - `frontend/src/components/products/surfaces/HeaderActions.jsx`
  - `frontend/src/components/products/surfaces/ProductRowParts.jsx`
  - `frontend/src/components/shared/ExportMenu.jsx`
  - `frontend/src/components/shared/FilterMenu.jsx`
  - `frontend/src/components/users/Users.jsx`

### 3.279 `frontend/src/components/shared/QuickPreferenceToggles.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext`
  - `lucide-react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (3)
  - `frontend/src/App.jsx`
  - `frontend/src/components/auth/Login.jsx`
  - `frontend/src/components/navigation/Sidebar.jsx`

### 3.280 `frontend/src/components/shared/SectionSwitcher.jsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`
  - `frontend/src/components/utils-settings/Backup.jsx`
  - `frontend/src/components/utils-settings/Settings.jsx`

### 3.281 `frontend/src/components/shared/WriteConflictModal.jsx`

- Declared exports: `function`
- Imports (1)
  - `./Modal`
- Internal dependencies (1)
  - `frontend/src/components/shared/Modal.jsx`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.282 `frontend/src/components/users/PermissionEditor.jsx`

- Declared exports: `PERMISSION_DEFS`, `PERMISSION_SECTIONS`, `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/users/UserDetailSheet.jsx`
  - `frontend/src/components/users/Users.jsx`

### 3.283 `frontend/src/components/users/UserDetailSheet.jsx`

- Declared exports: `function`
- Imports (2)
  - `../../utils/formatters`
  - `./PermissionEditor`
- Internal dependencies (2)
  - `frontend/src/components/users/PermissionEditor.jsx`
  - `frontend/src/utils/formatters.ts`
- Referenced by (1)
  - `frontend/src/components/users/Users.jsx`

### 3.284 `frontend/src/components/users/UserProfileModal.jsx`

- Declared exports: `function`
- Imports (10)
  - `../../AppContext`
  - `../../constants`
  - `../../utils/actionHistory.ts`
  - `../../utils/loaders.ts`
  - `../files/FilePickerModal`
  - `../shared/ActionHistoryBar`
  - `../shared/Modal`
  - `../utils-settings/OtpModal`
  - `lucide-react`
  - `react`
- Internal dependencies (8)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/files/FilePickerModal.jsx`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/components/utils-settings/OtpModal.jsx`
  - `frontend/src/constants.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (2)
  - `frontend/src/components/navigation/Sidebar.jsx`
  - `frontend/src/components/users/Users.jsx`

### 3.285 `frontend/src/components/users/Users.jsx`

- Declared exports: `function`
- Imports (14)
  - `../../AppContext`
  - `../../utils/actionGuards.ts`
  - `../../utils/actionHistory.ts`
  - `../../utils/formatters`
  - `../../utils/historyHelpers.ts`
  - `../shared/ActionHistoryBar.jsx`
  - `../shared/Modal`
  - `../shared/PortalMenu`
  - `../shared/pageActivity`
  - `./PermissionEditor`
  - `./UserDetailSheet`
  - `./UserProfileModal`
  - `lucide-react`
  - `react`
- Internal dependencies (12)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/Modal.jsx`
  - `frontend/src/components/shared/PortalMenu.jsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/components/users/PermissionEditor.jsx`
  - `frontend/src/components/users/UserDetailSheet.jsx`
  - `frontend/src/components/users/UserProfileModal.jsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/utils/formatters.ts`
  - `frontend/src/utils/historyHelpers.ts`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.286 `frontend/src/components/utils-settings/AuditLog.jsx`

- Declared exports: `function`
- Imports (10)
  - `../../AppContext`
  - `../../utils/actionGuards.ts`
  - `../../utils/csv`
  - `../../utils/groupedRecords.ts`
  - `../shared/ExportMenu`
  - `../shared/FilterMenu`
  - `../shared/PaginationControls.jsx`
  - `../shared/pageActivity`
  - `lucide-react`
  - `react`
- Internal dependencies (8)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/ExportMenu.jsx`
  - `frontend/src/components/shared/FilterMenu.jsx`
  - `frontend/src/components/shared/PaginationControls.jsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/csv.ts`
  - `frontend/src/utils/groupedRecords.ts`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.287 `frontend/src/components/utils-settings/Backup.jsx`

- Declared exports: `function`
- Imports (10)
  - `../../AppContext`
  - `../../utils/actionHistory.ts`
  - `../shared/ActionHistoryBar`
  - `../shared/LoadingWatchdog.jsx`
  - `../shared/PageHeader`
  - `../shared/SectionSwitcher.jsx`
  - `../shared/pageActivity`
  - `./ResetData`
  - `lucide-react`
  - `react`
- Internal dependencies (8)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/ActionHistoryBar.jsx`
  - `frontend/src/components/shared/LoadingWatchdog.jsx`
  - `frontend/src/components/shared/PageHeader.jsx`
  - `frontend/src/components/shared/SectionSwitcher.jsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/components/utils-settings/ResetData.jsx`
  - `frontend/src/utils/actionHistory.ts`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.288 `frontend/src/components/utils-settings/FontFamilyPicker.jsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/utils-settings/Settings.jsx`

### 3.289 `frontend/src/components/utils-settings/index.ts`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.290 `frontend/src/components/utils-settings/OtpModal.jsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext`
  - `../../utils/actionGuards.ts`
  - `react`
- Internal dependencies (2)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/utils/actionGuards.ts`
- Referenced by (2)
  - `frontend/src/components/users/UserProfileModal.jsx`
  - `frontend/src/components/utils-settings/Settings.jsx`

### 3.291 `frontend/src/components/utils-settings/ResetData.jsx`

- Declared exports: none detected
- Imports (6)
  - `../../AppContext`
  - `../../utils/actionGuards.ts`
  - `../../utils/appRefresh`
  - `../../utils/loaders.ts`
  - `lucide-react`
  - `react`
- Internal dependencies (4)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/appRefresh.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/components/utils-settings/Backup.jsx`

### 3.292 `frontend/src/components/utils-settings/Settings.jsx`

- Declared exports: `function`
- Imports (13)
  - `../../AppContext`
  - `../../utils/actionGuards.ts`
  - `../../utils/favicon.ts`
  - `../../utils/loaders.ts`
  - `../shared/LoadingWatchdog.jsx`
  - `../shared/PageHeader`
  - `../shared/SectionSwitcher.jsx`
  - `../shared/navigationConfig`
  - `./FontFamilyPicker`
  - `./OtpModal`
  - `./settingsConflict.ts`
  - `lucide-react`
  - `react`
- Internal dependencies (11)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/shared/LoadingWatchdog.jsx`
  - `frontend/src/components/shared/PageHeader.jsx`
  - `frontend/src/components/shared/SectionSwitcher.jsx`
  - `frontend/src/components/shared/navigationConfig.ts`
  - `frontend/src/components/utils-settings/FontFamilyPicker.jsx`
  - `frontend/src/components/utils-settings/OtpModal.jsx`
  - `frontend/src/components/utils-settings/settingsConflict.ts`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/favicon.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/App.jsx`

### 3.293 `frontend/src/components/utils-settings/settingsConflict.ts`

- Declared exports: `buildSettingsConflictState`, `diffSettingsConflictFields`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/utils-settings/Settings.jsx`
  - `frontend/tests/settingsConflictHelpers.test.ts`

### 3.294 `frontend/src/constants.ts`

- Declared exports: `CURRENCY`, `DELIVERY_FEE_PAYER`, `EMPTY_CUSTOMER`, `LAYOUT`, `PAYMENT_METHODS`, `STOCK`, `STORAGE_KEYS`, `SYNC`, `WRITE_CHANNELS`, `createEmptyOrder`, `formatDate`, `isNetworkError`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (8)
  - `frontend/src/api/http.ts`
  - `frontend/src/api/methods.js`
  - `frontend/src/api/websocket.ts`
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/auth/Login.jsx`
  - `frontend/src/components/users/UserProfileModal.jsx`
  - `frontend/src/platform/runtime/clientRuntime.ts`
  - `frontend/src/web-api.ts`

### 3.295 `frontend/src/index.jsx`

- Declared exports: none detected
- Imports (9)
  - `./App`
  - `./AppContext`
  - `./app/appShellUtils.ts`
  - `./styles/main.css`
  - `@fontsource/noto-sans-khmer/400.css`
  - `@fontsource/noto-sans-khmer/500.css`
  - `@fontsource/noto-sans-khmer/600.css`
  - `react`
  - `react-dom/client`
- Internal dependencies (4)
  - `frontend/src/App.jsx`
  - `frontend/src/AppContext.jsx`
  - `frontend/src/app/appShellUtils.ts`
  - `frontend/src/styles/main.css`
- Referenced by (0)
  - none

### 3.296 `frontend/src/platform/runtime/clientRuntime.ts`

- Declared exports: `buildQueuedOperationScope`, `doesQueuedScopeMatchCurrent`, `normalizeRuntimeDescriptor`, `readStoredRuntimeDescriptor`, `resetClientRuntimeState`, `sanitizeSyncServerUrl`, `shouldResetForRuntimeChange`, `writeStoredRuntimeDescriptor`
- Imports (2)
  - `../../api/localDb.js`
  - `../../constants.ts`
- Internal dependencies (2)
  - `frontend/src/api/localDb.js`
  - `frontend/src/constants.ts`
- Referenced by (2)
  - `frontend/src/api/methods.js`
  - `frontend/src/web-api.ts`

### 3.297 `frontend/src/platform/storage/storagePolicy.ts`

- Declared exports: `DRIVE_SYNC_STATUS_COOLDOWN_KEY`, `DRIVE_SYNC_STATUS_COOLDOWN_MS`, `LIVE_SERVER_SENSITIVE_MIRROR_TABLES`, `NOTIFICATION_SUMMARY_MISSING_TTL_MS`, `NOTIFICATION_SUMMARY_MISSING_UNTIL_KEY`, `isCooldownActive`, `maxStoredNumber`, `shouldPersistLocalMirror`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.298 `frontend/src/runtime/runtimeErrorClassifier.ts`

- Declared exports: `isFirstPartyBuiltAssetSource`, `isGuardableStyleSheetError`, `isKnownBridgeMessage`, `isKnownEvalCspNoise`, `isKnownStyleInjectionNoise`, `isLikelyInjectedRuntimeSource`, `shouldSuppressRuntimeError`, `shouldSuppressSecurityPolicyViolation`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.299 `frontend/src/types/jsx-modules.d.ts`

- Declared exports: `FactoryReset`, `ResetData`, `component`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.300 `frontend/src/types/react.d.ts`

- Declared exports: `useCallback`, `useEffect`, `useMemo`, `useRef`, `useState`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.301 `frontend/src/types/receiptContracts.ts`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/utils/printReceipt.ts`
  - `frontend/src/utils/receiptAppliedConfig.ts`

### 3.302 `frontend/src/types/settingsContracts.ts`

- Declared exports: `SETTINGS_REFRESH_CHANNELS`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/utils/settingsWriteOptions.ts`

### 3.303 `frontend/src/utils/actionGuards.ts`

- Declared exports: `beginKeyedAction`, `beginNamedAction`, `beginSingleAction`, `finishKeyedAction`, `finishNamedAction`, `finishSingleAction`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (33)
  - `frontend/src/components/branches/Branches.jsx`
  - `frontend/src/components/branches/TransferModal.jsx`
  - `frontend/src/components/catalog/CatalogPage.jsx`
  - `frontend/src/components/contacts/ContactImportModal.jsx`
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`
  - `frontend/src/components/custom-tables/CustomTables.jsx`
  - `frontend/src/components/files/FilesPage.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/inventory/InventoryImportModal.jsx`
  - `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx`
  - `frontend/src/components/products/forms/BranchStockAdjuster.jsx`
  - `frontend/src/components/products/forms/BulkAddStockModal.jsx`
  - `frontend/src/components/products/forms/VariantFormModal.jsx`
  - `frontend/src/components/products/import/BulkImportModal.jsx`
  - `frontend/src/components/products/lookups/ManageBrandsModal.jsx`
  - `frontend/src/components/products/lookups/ManageCategoriesModal.jsx`
  - `frontend/src/components/products/lookups/ManageUnitsModal.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/returns/EditReturnModal.jsx`
  - `frontend/src/components/returns/NewReturnModal.jsx`
  - `frontend/src/components/returns/NewSupplierReturnModal.jsx`
  - `frontend/src/components/returns/Returns.jsx`
  - `frontend/src/components/sales/Sales.jsx`
  - `frontend/src/components/sales/SalesImportModal.jsx`
  - `frontend/src/components/server/ServerPage.jsx`
  - `frontend/src/components/shared/BackgroundImportTracker.jsx`
  - `frontend/src/components/users/Users.jsx`
  - `frontend/src/components/utils-settings/AuditLog.jsx`
  - `frontend/src/components/utils-settings/OtpModal.jsx`
  - `frontend/src/components/utils-settings/ResetData.jsx`
  - `frontend/src/components/utils-settings/Settings.jsx`

### 3.304 `frontend/src/utils/actionHistory.ts`

- Declared exports: `useActionHistory`
- Imports (2)
  - `../AppContext.jsx`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.jsx`
- Referenced by (16)
  - `frontend/src/components/branches/Branches.jsx`
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`
  - `frontend/src/components/custom-tables/CustomTables.jsx`
  - `frontend/src/components/files/FilesPage.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/products/lookups/ManageBrandsModal.jsx`
  - `frontend/src/components/products/lookups/ManageCategoriesModal.jsx`
  - `frontend/src/components/products/lookups/ManageUnitsModal.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/returns/Returns.jsx`
  - `frontend/src/components/sales/Sales.jsx`
  - `frontend/src/components/users/UserProfileModal.jsx`
  - `frontend/src/components/users/Users.jsx`
  - `frontend/src/components/utils-settings/Backup.jsx`

### 3.305 `frontend/src/utils/appRefresh.ts`

- Declared exports: `DEFAULT_REFRESH_CHANNELS`, `normalizeRefreshChannels`, `refreshAppData`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `frontend/src/api/methods.js`
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/utils-settings/ResetData.jsx`
  - `frontend/src/utils/settingsRefresh.ts`
  - `frontend/tests/appRefresh.test.ts`

### 3.306 `frontend/src/utils/bulkOps.ts`

- Declared exports: `runConcurrentTasks`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (8)
  - `frontend/src/components/branches/Branches.jsx`
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/sales/Sales.jsx`
  - `frontend/tests/bulkOps.test.ts`

### 3.307 `frontend/src/utils/color.ts`

- Declared exports: `getContrastingTextColor`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/products/surfaces/ProductDetailModal.jsx`

### 3.308 `frontend/src/utils/csv.ts`

- Declared exports: `UTF8_BOM`, `buildCSV`, `buildZip`, `buildZipInWorker`, `downloadBlob`, `downloadCSV`, `downloadZipFiles`, `downloadZipFilesAsync`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (14)
  - `frontend/src/api/localDb.ts`
  - `frontend/src/components/contacts/Contacts.jsx`
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`
  - `frontend/src/components/dashboard/Dashboard.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/returns/Returns.jsx`
  - `frontend/src/components/sales/Sales.jsx`
  - `frontend/src/components/utils-settings/AuditLog.jsx`
  - `frontend/src/utils/csvExportWorker.ts`
  - `frontend/src/utils/exportPackage.ts`
  - `frontend/tests/exportPackages.test.ts`

### 3.309 `frontend/src/utils/csvExportWorker.ts`

- Declared exports: none detected
- Imports (1)
  - `./csv.ts`
- Internal dependencies (1)
  - `frontend/src/utils/csv.ts`
- Referenced by (0)
  - none

### 3.310 `frontend/src/utils/csvImport.ts`

- Declared exports: `decodeTextBuffer`, `detectCsvDelimiter`, `normalizeCsvKey`, `normalizeCsvMoney`, `normalizeCsvPercent`, `normalizeNumericText`, `parseCsvNumber`, `parseCsvRows`, `parseDelimitedRows`, `parseRequiredCsvNumber`, `splitCsvLine`
- Imports (1)
  - `./pricing.ts`
- Internal dependencies (1)
  - `frontend/src/utils/pricing.ts`
- Referenced by (3)
  - `frontend/src/api/localDb.ts`
  - `frontend/src/api/methods.js`
  - `frontend/tests/csvImport.test.ts`

### 3.311 `frontend/src/utils/csvRowCounter.ts`

- Declared exports: `countCsvDataRows`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (9)
  - `frontend/src/components/contacts/ContactImportModal.jsx`
  - `frontend/src/components/contacts/contactImportWorker.ts`
  - `frontend/src/components/inventory/InventoryImportModal.jsx`
  - `frontend/src/components/inventory/inventoryImportWorker.ts`
  - `frontend/src/components/sales/SalesImportModal.jsx`
  - `frontend/src/components/sales/salesImportWorker.ts`
  - `frontend/tests/contactImportWorker.test.ts`
  - `frontend/tests/inventoryImportWorker.test.ts`
  - `frontend/tests/salesImportWorker.test.ts`

### 3.312 `frontend/src/utils/dateHelpers.ts`

- Declared exports: `offsetDate`, `todayStr`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/dashboard/Dashboard.jsx`
  - `frontend/tests/dateHelpers.test.ts`

### 3.313 `frontend/src/utils/deviceInfo.ts`

- Declared exports: `getClientDeviceInfo`, `getClientMetaHeaders`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (7)
  - `frontend/src/api/http.ts`
  - `frontend/src/api/methods.js`
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/auth/Login.jsx`
  - `frontend/src/components/pos/POS.jsx`
  - `frontend/src/components/sales/Sales.jsx`
  - `frontend/tests/deviceInfo.test.ts`

### 3.314 `frontend/src/utils/exportPackage.ts`

- Declared exports: `buildReportManifestRows`, `buildReportPackageFiles`
- Imports (1)
  - `./csv.ts`
- Internal dependencies (1)
  - `frontend/src/utils/csv.ts`
- Referenced by (3)
  - `frontend/src/components/dashboard/Dashboard.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/tests/exportPackages.test.ts`

### 3.315 `frontend/src/utils/exportReports.jsx`

- Declared exports: `buildStandaloneReportHtml`
- Imports (3)
  - `../components/dashboard/charts`
  - `./formatters`
  - `react-dom/server`
- Internal dependencies (2)
  - `frontend/src/components/dashboard/charts/index.ts`
  - `frontend/src/utils/formatters.ts`
- Referenced by (2)
  - `frontend/src/components/dashboard/Dashboard.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`

### 3.316 `frontend/src/utils/favicon.ts`

- Declared exports: `createCircularFaviconDataUrl`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `frontend/src/App.jsx`
  - `frontend/src/components/catalog/CatalogPage.jsx`
  - `frontend/src/components/utils-settings/Settings.jsx`

### 3.317 `frontend/src/utils/formatters.ts`

- Declared exports: `fmtCount`, `fmtDate`, `fmtShort`, `fmtTime`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (17)
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
  - `frontend/src/utils/exportReports.jsx`
  - `frontend/tests/formatters.test.ts`

### 3.318 `frontend/src/utils/groupedRecords.ts`

- Declared exports: `buildAlphabetActionSections`, `buildTimeActionSections`, `getAlphabetInitialSection`, `getAvailableYears`, `getTimeGroupingMode`, `getTimeParts`, `matchesYearMonthFilters`, `toggleIdSet`
- Imports (1)
  - `./initials.ts`
- Internal dependencies (1)
  - `frontend/src/utils/initials.ts`
- Referenced by (10)
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/products/helpers/productFilterHelpers.ts`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/returns/Returns.jsx`
  - `frontend/src/components/sales/Sales.jsx`
  - `frontend/src/components/utils-settings/AuditLog.jsx`
  - `frontend/tests/groupedRecords.test.ts`

### 3.319 `frontend/src/utils/historyHelpers.ts`

- Declared exports: `cloneHistorySnapshot`, `extractHistoryResultId`, `resolveCreatedHistorySnapshot`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (11)
  - `frontend/src/components/branches/Branches.jsx`
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`
  - `frontend/src/components/custom-tables/CustomTables.jsx`
  - `frontend/src/components/files/FilesPage.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/products/forms/VariantFormModal.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/components/returns/Returns.jsx`
  - `frontend/src/components/users/Users.jsx`

### 3.320 `frontend/src/utils/importJobRefresh.ts`

- Declared exports: `dispatchImportCompletionRefresh`, `getImportCompletionRefreshChannels`, `shouldDispatchImportCompletionRefresh`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/shared/BackgroundImportTracker.jsx`

### 3.321 `frontend/src/utils/index.ts`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.322 `frontend/src/utils/initials.ts`

- Declared exports: `KHMER_INITIALS`, `aggregateInitialOptions`, `buildInitialOptionsFromProducts`, `compareInitialKeys`, `getInitialKey`, `getInitialType`, `normalizeInitialText`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (7)
  - `frontend/src/components/catalog/CatalogProductsSection.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/pos/POS.jsx`
  - `frontend/src/components/pos/posCore.ts`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/src/utils/groupedRecords.ts`
  - `frontend/src/utils/productGrouping.ts`

### 3.323 `frontend/src/utils/loaders.ts`

- Declared exports: `DEFAULT_LOADER_TIMEOUT_MS`, `beginTrackedRequest`, `createLoaderTimeoutError`, `getFirstLoaderError`, `getLoaderErrorMessage`, `invalidateTrackedRequest`, `isTrackedRequestCurrent`, `settleLoaderMap`, `withLoaderTimeout`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (20)
  - `frontend/src/App.jsx`
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/contacts/ContactImportModal.jsx`
  - `frontend/src/components/contacts/Contacts.jsx`
  - `frontend/src/components/contacts/CustomersTab.jsx`
  - `frontend/src/components/contacts/DeliveryTab.jsx`
  - `frontend/src/components/contacts/SuppliersTab.jsx`
  - `frontend/src/components/dashboard/Dashboard.jsx`
  - `frontend/src/components/products/forms/BranchStockAdjuster.jsx`
  - `frontend/src/components/products/forms/BulkAddStockModal.jsx`
  - `frontend/src/components/products/forms/VariantFormModal.jsx`
  - `frontend/src/components/products/import/BulkImportModal.jsx`
  - `frontend/src/components/products/lookups/productLookupSnapshots.ts`
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`
  - `frontend/src/components/returns/EditReturnModal.jsx`
  - `frontend/src/components/sales/ExportModal.jsx`
  - `frontend/src/components/shared/BackgroundImportTracker.jsx`
  - `frontend/src/components/users/UserProfileModal.jsx`
  - `frontend/src/components/utils-settings/ResetData.jsx`
  - `frontend/src/components/utils-settings/Settings.jsx`

### 3.324 `frontend/src/utils/mediaUpload.ts`

- Declared exports: `buildCacheBustedMediaPath`, `createInitialUploadState`, `isTemporaryPreviewUrl`, `reduceUploadState`, `sanitizePersistedMediaPath`
- Imports (1)
  - `./publicAssetUrls.ts`
- Internal dependencies (1)
  - `frontend/src/utils/publicAssetUrls.ts`
- Referenced by (3)
  - `frontend/src/components/catalog/CatalogImageField.jsx`
  - `frontend/src/components/products/forms/ProductForm.jsx`
  - `frontend/tests/mediaUploadHelpers.test.ts`

### 3.325 `frontend/src/utils/permissions.ts`

- Declared exports: `parsePermissionMap`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/AppContext.jsx`
  - `frontend/tests/permissions.test.ts`

### 3.326 `frontend/src/utils/pricing.ts`

- Declared exports: `calculateProductDiscount`, `formatPriceNumber`, `isProductDiscountActive`, `normalizeDiscountPercent`, `normalizeDiscountType`, `normalizePriceValue`, `roundUpToDecimals`, `toFiniteNumber`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (17)
  - `frontend/src/AppContext.jsx`
  - `frontend/src/components/catalog/portalCatalogDisplay.ts`
  - `frontend/src/components/dashboard/Dashboard.jsx`
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/inventory/ProductDetailModal.jsx`
  - `frontend/src/components/pos/CartItem.jsx`
  - `frontend/src/components/pos/POS.jsx`
  - `frontend/src/components/pos/posCore.ts`
  - `frontend/src/components/products/forms/ProductForm.jsx`
  - `frontend/src/components/products/forms/VariantFormModal.jsx`
  - `frontend/src/components/products/helpers/productDisplayHelpers.ts`
  - `frontend/src/components/products/helpers/productFilterHelpers.ts`
  - `frontend/src/components/products/helpers/productWriteHelpers.ts`
  - `frontend/src/components/products/surfaces/ProductDetailModal.jsx`
  - `frontend/src/components/products/surfaces/ProductRowParts.jsx`
  - `frontend/src/utils/csvImport.ts`
  - `frontend/tests/pricingContacts.test.ts`

### 3.327 `frontend/src/utils/printReceipt.ts`

- Declared exports: `PRINT_DEFAULTS`, `createReceiptImageBlob`, `createReceiptPdfBlob`, `downloadReceiptImage`, `downloadReceiptPdf`, `getPaperWidthMm`, `getPrintSettings`, `normalizeReceiptContentWidth`, `openPrintableReceiptPreview`, `openReceiptPdf`, `printReceipt`, `savePrintSettings`
- Imports (1)
  - `../types/receiptContracts`
- Internal dependencies (1)
  - `frontend/src/types/receiptContracts.ts`
- Referenced by (2)
  - `frontend/src/components/receipt-settings/PrintSettings.jsx`
  - `frontend/src/components/receipt/Receipt.jsx`

### 3.328 `frontend/src/utils/productBatches.ts`

- Declared exports: `buildBatchPreview`, `getVisibleProductBatches`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/inventory/ProductDetailModal.jsx`
  - `frontend/src/components/products/surfaces/ProductDetailModal.jsx`
  - `frontend/src/components/products/surfaces/ProductRowParts.jsx`
  - `frontend/tests/productBatches.test.ts`

### 3.329 `frontend/src/utils/productGrouping.ts`

- Declared exports: `buildProductGroupSections`, `buildProductGroups`, `getNameInitialSection`, `normalizeProductGroupName`
- Imports (1)
  - `./initials.ts`
- Internal dependencies (1)
  - `frontend/src/utils/initials.ts`
- Referenced by (4)
  - `frontend/src/components/inventory/Inventory.jsx`
  - `frontend/src/components/pos/posCore.ts`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/tests/productGrouping.test.ts`

### 3.330 `frontend/src/utils/publicAssetUrls.ts`

- Declared exports: `getStoredPublicAssetBaseUrl`, `resolvePublicAssetUrl`
- Imports (1)
  - `../api/http.js`
- Internal dependencies (1)
  - `frontend/src/api/http.js`
- Referenced by (7)
  - `frontend/src/components/contacts/ContactImportModal.jsx`
  - `frontend/src/components/files/FilePickerModal.jsx`
  - `frontend/src/components/files/FilesPage.jsx`
  - `frontend/src/components/pos/POS.jsx`
  - `frontend/src/components/products/helpers/productGalleryHelpers.ts`
  - `frontend/src/components/products/shared/primitives.jsx`
  - `frontend/src/utils/mediaUpload.ts`

### 3.331 `frontend/src/utils/receiptAppliedConfig.ts`

- Declared exports: `DEFAULT_RECEIPT_PRINT_SETTINGS`, `DEFAULT_RECEIPT_TEMPLATE`, `RECEIPT_PRINT_SETTINGS_STORAGE_KEY`, `buildAppliedReceiptConfig`, `normalizeReceiptPrintSettings`, `normalizeReceiptTemplate`, `readReceiptPrintSettingsFromSettings`, `serializeReceiptPrintSettings`, `serializeReceiptTemplateValue`
- Imports (1)
  - `../types/receiptContracts`
- Internal dependencies (1)
  - `frontend/src/types/receiptContracts.ts`
- Referenced by (3)
  - `frontend/src/components/receipt-settings/ReceiptPreview.jsx`
  - `frontend/src/components/receipt-settings/ReceiptSettings.jsx`
  - `frontend/src/components/receipt/Receipt.jsx`

### 3.332 `frontend/src/utils/scriptTypography.ts`

- Declared exports: `containsKhmerScript`, `getKhmerTextProps`, `withKhmerTextClass`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (6)
  - `frontend/src/components/catalog/CatalogProductsSection.jsx`
  - `frontend/src/components/inventory/InventoryProductsSurface.jsx`
  - `frontend/src/components/pos/CartItem.jsx`
  - `frontend/src/components/pos/POS.jsx`
  - `frontend/src/components/products/Products.jsx`
  - `frontend/tests/scriptTypography.test.ts`

### 3.333 `frontend/src/utils/settingsRefresh.ts`

- Declared exports: `CATEGORY_REFRESH_CHANNELS`, `UNIT_REFRESH_CHANNELS`, `getSettingsRefreshChannels`
- Imports (1)
  - `./appRefresh.ts`
- Internal dependencies (1)
  - `frontend/src/utils/appRefresh.ts`
- Referenced by (0)
  - none

### 3.334 `frontend/src/utils/settingsWriteOptions.ts`

- Declared exports: `normalizeSettingsWriteOptions`
- Imports (1)
  - `../types/settingsContracts`
- Internal dependencies (1)
  - `frontend/src/types/settingsContracts.ts`
- Referenced by (1)
  - `frontend/src/AppContext.jsx`

### 3.335 `frontend/src/web-api.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/AppContext.jsx`

### 3.336 `frontend/src/web-api.ts`

- Declared exports: none detected
- Imports (6)
  - `./api/http.js`
  - `./api/localDb.js`
  - `./api/methods.js`
  - `./api/websocket.js`
  - `./constants.ts`
  - `./platform/runtime/clientRuntime.ts`
- Internal dependencies (6)
  - `frontend/src/api/http.js`
  - `frontend/src/api/localDb.js`
  - `frontend/src/api/methods.js`
  - `frontend/src/api/websocket.js`
  - `frontend/src/constants.ts`
  - `frontend/src/platform/runtime/clientRuntime.ts`
- Referenced by (0)
  - none

### 3.337 `frontend/tailwind.config.ts`

- Declared exports: none detected
- Imports (1)
  - `tailwindcss`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.338 `frontend/tests/actionGuards.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.339 `frontend/tests/actionStability.test.ts`

- Declared exports: none detected
- Imports (4)
  - `node:assert/strict`
  - `node:fs`
  - `node:path`
  - `node:url`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.340 `frontend/tests/adminShellMediaGuards.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.341 `frontend/tests/apiHttp.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.342 `frontend/tests/appRefresh.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/appRefresh.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/appRefresh.ts`
- Referenced by (0)
  - none

### 3.343 `frontend/tests/appShellUtils.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/app/appShellUtils.ts`
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (1)
  - `frontend/src/app/appShellUtils.ts`
- Referenced by (0)
  - none

### 3.344 `frontend/tests/assetCompression.test.ts`

- Declared exports: none detected
- Imports (4)
  - `node:assert/strict`
  - `node:fs`
  - `node:path`
  - `node:url`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.345 `frontend/tests/backupJobs.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.346 `frontend/tests/barcodeImageScanner.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/components/products/scanning/barcodeImageScanner.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/products/scanning/barcodeImageScanner.ts`
- Referenced by (0)
  - none

### 3.347 `frontend/tests/barcodeScannerState.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/components/products/scanning/barcodeScannerState.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/products/scanning/barcodeScannerState.ts`
- Referenced by (0)
  - none

### 3.348 `frontend/tests/bulkOps.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/bulkOps.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/bulkOps.ts`
- Referenced by (0)
  - none

### 3.349 `frontend/tests/contactImportWorker.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/utils/csvRowCounter.ts`
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (1)
  - `frontend/src/utils/csvRowCounter.ts`
- Referenced by (0)
  - none

### 3.350 `frontend/tests/csvImport.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/utils/csvImport.ts`
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (1)
  - `frontend/src/utils/csvImport.ts`
- Referenced by (0)
  - none

### 3.351 `frontend/tests/dashboardDataReliability.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.352 `frontend/tests/dateHelpers.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/dateHelpers.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/dateHelpers.ts`
- Referenced by (0)
  - none

### 3.353 `frontend/tests/deviceInfo.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/deviceInfo.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/deviceInfo.ts`
- Referenced by (0)
  - none

### 3.354 `frontend/tests/exportPackages.test.ts`

- Declared exports: none detected
- Imports (4)
  - `../src/utils/csv.ts`
  - `../src/utils/exportPackage.ts`
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (2)
  - `frontend/src/utils/csv.ts`
  - `frontend/src/utils/exportPackage.ts`
- Referenced by (0)
  - none

### 3.355 `frontend/tests/formatters.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/formatters.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/formatters.ts`
- Referenced by (0)
  - none

### 3.356 `frontend/tests/globalScroll.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.357 `frontend/tests/globalScrollControls.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/components/shared/globalScroll.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/shared/globalScroll.ts`
- Referenced by (0)
  - none

### 3.358 `frontend/tests/groupedRecords.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/groupedRecords.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/groupedRecords.ts`
- Referenced by (0)
  - none

### 3.359 `frontend/tests/historyHelpers.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.360 `frontend/tests/importJobRefresh.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.361 `frontend/tests/initials.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.362 `frontend/tests/inventoryImportWorker.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/utils/csvRowCounter.ts`
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (1)
  - `frontend/src/utils/csvRowCounter.ts`
- Referenced by (0)
  - none

### 3.363 `frontend/tests/inventoryMobileCardLayout.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.364 `frontend/tests/inventoryMovementGroups.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/components/inventory/movementGroups.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/inventory/movementGroups.ts`
- Referenced by (0)
  - none

### 3.365 `frontend/tests/inventoryRfidSection.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.366 `frontend/tests/jsxSyntaxCheck.ts`

- Declared exports: none detected
- Imports (5)
  - `node:assert/strict`
  - `node:fs/promises`
  - `node:path`
  - `node:url`
  - `vite`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.367 `frontend/tests/loaders.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.368 `frontend/tests/mediaUploadHelpers.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/mediaUpload.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/mediaUpload.ts`
- Referenced by (0)
  - none

### 3.369 `frontend/tests/navigationConfig.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/components/shared/navigationConfig.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/shared/navigationConfig.ts`
- Referenced by (0)
  - none

### 3.370 `frontend/tests/notificationBadge.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.371 `frontend/tests/offlineSalesQueue.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.372 `frontend/tests/offlineSecurityHardening.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.373 `frontend/tests/offlineSyncArchitecture.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.374 `frontend/tests/ownedGoogleAuth.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.375 `frontend/tests/performanceLoadingUx.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.376 `frontend/tests/permissionEditor.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.377 `frontend/tests/permissions.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/permissions.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/permissions.ts`
- Referenced by (0)
  - none

### 3.378 `frontend/tests/portalCatalogDisplay.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.379 `frontend/tests/portalContentI18n.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.380 `frontend/tests/portalEditorUtils.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.381 `frontend/tests/portalFaqVocabulary.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.382 `frontend/tests/portalLanguagePacks.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.383 `frontend/tests/portalTranslateController.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.384 `frontend/tests/posCore.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.385 `frontend/tests/pricingContacts.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/utils/pricing.ts`
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (1)
  - `frontend/src/utils/pricing.ts`
- Referenced by (0)
  - none

### 3.386 `frontend/tests/productBatches.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/productBatches.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/productBatches.ts`
- Referenced by (0)
  - none

### 3.387 `frontend/tests/productDiscountUx.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.388 `frontend/tests/productDisplayHelpers.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.389 `frontend/tests/productFilterHelpers.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.390 `frontend/tests/productGalleryHelpers.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.391 `frontend/tests/productGrouping.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/productGrouping.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/productGrouping.ts`
- Referenced by (0)
  - none

### 3.392 `frontend/tests/productGroupViewHelpers.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.393 `frontend/tests/productHistoryHelpers.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/components/products/history/productHistoryHelpers.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/products/history/productHistoryHelpers.ts`
- Referenced by (0)
  - none

### 3.394 `frontend/tests/productImportPlanner.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/components/products/import/productImportPlanner.ts`
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (1)
  - `frontend/src/components/products/import/productImportPlanner.ts`
- Referenced by (0)
  - none

### 3.395 `frontend/tests/productImportWorkerFallback.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/components/products/import/productImportPlanner.ts`
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (1)
  - `frontend/src/components/products/import/productImportPlanner.ts`
- Referenced by (0)
  - none

### 3.396 `frontend/tests/productMenuHelpers.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.397 `frontend/tests/productPageHelpers.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.398 `frontend/tests/productSearchPagination.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.399 `frontend/tests/productSelectionHelpers.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.400 `frontend/tests/productWriteHelpers.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.401 `frontend/tests/publicErrorRecovery.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.402 `frontend/tests/receiptSettingsSync.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.403 `frontend/tests/receiptTemplate.test.ts`

- Declared exports: none detected
- Imports (4)
  - `../src/components/receipt-settings/constants.ts`
  - `../src/components/receipt-settings/template.ts`
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (2)
  - `frontend/src/components/receipt-settings/constants.ts`
  - `frontend/src/components/receipt-settings/template.ts`
- Referenced by (0)
  - none

### 3.404 `frontend/tests/returnsLayout.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.405 `frontend/tests/runtimeErrorClassifier.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.406 `frontend/tests/salesImportWorker.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/utils/csvRowCounter.ts`
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (1)
  - `frontend/src/utils/csvRowCounter.ts`
- Referenced by (0)
  - none

### 3.407 `frontend/tests/scanbotScanner.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/components/products/scanning/scanbotScanner.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/products/scanning/scanbotScanner.ts`
- Referenced by (0)
  - none

### 3.408 `frontend/tests/scriptTypography.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/scriptTypography.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/scriptTypography.ts`
- Referenced by (0)
  - none

### 3.409 `frontend/tests/sectionNavigation.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.410 `frontend/tests/settingsConflictHelpers.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/components/utils-settings/settingsConflict.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/utils-settings/settingsConflict.ts`
- Referenced by (0)
  - none

### 3.411 `frontend/tests/settingsRefresh.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.412 `frontend/tests/storagePolicy.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.413 `frontend/tests/utilsSettingsBarrel.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.414 `frontend/vite.config.ts`

- Declared exports: `defineConfig`
- Imports (8)
  - `@vitejs/plugin-react`
  - `autoprefixer`
  - `node:child_process`
  - `node:crypto`
  - `node:fs`
  - `node:path`
  - `tailwindcss`
  - `vite`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.415 `ops/scripts/architecture/generated-bulk-audit.ts`

- Declared exports: none detected
- Imports (4)
  - `../lib/fs-utils.ts`
  - `../lib/report-utils.ts`
  - `node:fs/promises`
  - `node:path`
- Internal dependencies (2)
  - `ops/scripts/lib/fs-utils.ts`
  - `ops/scripts/lib/report-utils.ts`
- Referenced by (0)
  - none

### 3.416 `ops/scripts/architecture/language-runtime-audit.ts`

- Declared exports: none detected
- Imports (4)
  - `../lib/fs-utils.ts`
  - `../lib/report-utils.ts`
  - `node:fs/promises`
  - `node:path`
- Internal dependencies (2)
  - `ops/scripts/lib/fs-utils.ts`
  - `ops/scripts/lib/report-utils.ts`
- Referenced by (0)
  - none

### 3.417 `ops/scripts/architecture/organization-audit.ts`

- Declared exports: none detected
- Imports (4)
  - `../lib/fs-utils.ts`
  - `../lib/report-utils.ts`
  - `node:fs/promises`
  - `node:path`
- Internal dependencies (2)
  - `ops/scripts/lib/fs-utils.ts`
  - `ops/scripts/lib/report-utils.ts`
- Referenced by (0)
  - none

### 3.418 `ops/scripts/architecture/phase29-audit.ts`

- Declared exports: none detected
- Imports (5)
  - `../lib/fs-utils.ts`
  - `../lib/report-utils.ts`
  - `node:child_process`
  - `node:fs/promises`
  - `node:path`
- Internal dependencies (2)
  - `ops/scripts/lib/fs-utils.ts`
  - `ops/scripts/lib/report-utils.ts`
- Referenced by (0)
  - none

### 3.419 `ops/scripts/backend/schema-audit.ts`

- Declared exports: none detected
- Imports (2)
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.420 `ops/scripts/backend/schema-primary-key-preflight.ts`

- Declared exports: none detected
- Imports (3)
  - `node:child_process`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.421 `ops/scripts/backend/verify-data-integrity.ts`

- Declared exports: none detected
- Imports (3)
  - `child_process`
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.422 `ops/scripts/frontend/verify-i18n.ts`

- Declared exports: none detected
- Imports (2)
  - `../lib/fs-utils.ts`
  - `path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.ts`
- Referenced by (0)
  - none

### 3.423 `ops/scripts/frontend/verify-performance.ts`

- Declared exports: none detected
- Imports (3)
  - `child_process`
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.424 `ops/scripts/frontend/verify-ui.ts`

- Declared exports: none detected
- Imports (3)
  - `../lib/fs-utils.ts`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.ts`
- Referenced by (0)
  - none

### 3.425 `ops/scripts/lib/fs-utils.ts`

- Declared exports: `module.exports`
- Imports (2)
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (13)
  - `ops/scripts/architecture/generated-bulk-audit.ts`
  - `ops/scripts/architecture/language-runtime-audit.ts`
  - `ops/scripts/architecture/organization-audit.ts`
  - `ops/scripts/architecture/phase29-audit.ts`
  - `ops/scripts/frontend/verify-i18n.ts`
  - `ops/scripts/frontend/verify-ui.ts`
  - `ops/scripts/runtime/cloudflare/verify-cloudflare-automation.ts`
  - `ops/scripts/verification/verify-backup-reliability.ts`
  - `ops/scripts/verification/verify-docker-release.ts`
  - `ops/scripts/verification/verify-hardening-policy.ts`
  - `ops/scripts/verification/verify-runtime-deps.ts`
  - `ops/scripts/verification/verify-scale-services.ts`
  - `ops/scripts/verification/verify-secret-hygiene.ts`

### 3.426 `ops/scripts/lib/report-utils.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `crypto`
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `ops/scripts/architecture/generated-bulk-audit.ts`
  - `ops/scripts/architecture/language-runtime-audit.ts`
  - `ops/scripts/architecture/organization-audit.ts`
  - `ops/scripts/architecture/phase29-audit.ts`
  - `ops/scripts/runtime/audits/audit-report-html.ts`

### 3.427 `ops/scripts/runtime/audits/action-history-undo-redo-check.ts`

- Declared exports: none detected
- Imports (4)
  - `./audit-auth.ts`
  - `node:child_process`
  - `node:fs`
  - `node:path`
- Internal dependencies (1)
  - `ops/scripts/runtime/audits/audit-auth.ts`
- Referenced by (0)
  - none

### 3.428 `ops/scripts/runtime/audits/audit-auth.ts`

- Declared exports: `applySessionToPlaywrightContext`, `buildBrowserStorageState`, `hydratePlaywrightPage`, `loginWithFetch`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (18)
  - `ops/scripts/runtime/audits/action-history-undo-redo-check.ts`
  - `ops/scripts/runtime/audits/deep-live-audit.ts`
  - `ops/scripts/runtime/audits/full-app-audit.ts`
  - `ops/scripts/runtime/browser-action-smoke.ts`
  - `ops/scripts/runtime/live-checks/phase84-branches-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-contacts-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-files-providers-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-inventory-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-brands-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-categories-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-page-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-scanning-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-stock-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-units-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-variant-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-sales-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-ui-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-users-actions-live-check.ts`

### 3.429 `ops/scripts/runtime/audits/audit-manifest.ts`

- Declared exports: `ADMIN_ROUTES`, `FULL_AUDIT_ROUTES`, `PUBLIC_ROUTES`, `ROUTE_MANIFEST`, `getAuditProfiles`, `getRouteManifest`, `resolveAuditRoutes`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `ops/scripts/runtime/audits/deep-live-audit.ts`
  - `ops/scripts/runtime/audits/full-app-audit.ts`
  - `ops/scripts/runtime/browser-action-smoke.ts`

### 3.430 `ops/scripts/runtime/audits/audit-report-html.ts`

- Declared exports: `writeBrowserActionHtmlReport`, `writeDeepAuditHtmlReport`, `writeFullAuditHtmlReport`
- Imports (4)
  - `../../lib/report-utils.ts`
  - `node:fs/promises`
  - `node:module`
  - `node:path`
- Internal dependencies (1)
  - `ops/scripts/lib/report-utils.ts`
- Referenced by (3)
  - `ops/scripts/runtime/audits/deep-live-audit.ts`
  - `ops/scripts/runtime/audits/full-app-audit.ts`
  - `ops/scripts/runtime/browser-action-smoke.ts`

### 3.431 `ops/scripts/runtime/audits/deep-live-audit.ts`

- Declared exports: none detected
- Imports (9)
  - `./audit-auth.ts`
  - `./audit-manifest.ts`
  - `./audit-report-html.ts`
  - `node:child_process`
  - `node:fs/promises`
  - `node:path`
  - `node:perf_hooks`
  - `node:url`
  - `playwright`
- Internal dependencies (3)
  - `ops/scripts/runtime/audits/audit-auth.ts`
  - `ops/scripts/runtime/audits/audit-manifest.ts`
  - `ops/scripts/runtime/audits/audit-report-html.ts`
- Referenced by (0)
  - none

### 3.432 `ops/scripts/runtime/audits/full-app-audit.ts`

- Declared exports: none detected
- Imports (9)
  - `./audit-auth.ts`
  - `./audit-manifest.ts`
  - `./audit-report-html.ts`
  - `node:child_process`
  - `node:fs/promises`
  - `node:os`
  - `node:path`
  - `node:perf_hooks`
  - `node:url`
- Internal dependencies (3)
  - `ops/scripts/runtime/audits/audit-auth.ts`
  - `ops/scripts/runtime/audits/audit-manifest.ts`
  - `ops/scripts/runtime/audits/audit-report-html.ts`
- Referenced by (0)
  - none

### 3.433 `ops/scripts/runtime/browser-action-smoke.ts`

- Declared exports: none detected
- Imports (8)
  - `./audits/audit-auth.ts`
  - `./audits/audit-manifest.ts`
  - `./audits/audit-report-html.ts`
  - `node:fs/promises`
  - `node:path`
  - `node:perf_hooks`
  - `node:url`
  - `playwright`
- Internal dependencies (3)
  - `ops/scripts/runtime/audits/audit-auth.ts`
  - `ops/scripts/runtime/audits/audit-manifest.ts`
  - `ops/scripts/runtime/audits/audit-report-html.ts`
- Referenced by (0)
  - none

### 3.434 `ops/scripts/runtime/cloudflare/rotate-cloudflare-tunnel-token.ts`

- Declared exports: none detected
- Imports (4)
  - `node:crypto`
  - `node:fs`
  - `node:https`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.435 `ops/scripts/runtime/cloudflare/update-cloudflare-tunnel-origin.ts`

- Declared exports: none detected
- Imports (3)
  - `node:fs`
  - `node:https`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.436 `ops/scripts/runtime/cloudflare/verify-cloudflare-automation.ts`

- Declared exports: none detected
- Imports (4)
  - `../../lib/fs-utils.ts`
  - `node:fs`
  - `node:https`
  - `node:path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.ts`
- Referenced by (0)
  - none

### 3.437 `ops/scripts/runtime/cloudflare/verify-r2-object-store.ts`

- Declared exports: none detected
- Imports (4)
  - `node:crypto`
  - `node:fs`
  - `node:module`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.438 `ops/scripts/runtime/live-checks/live-check-utils.ts`

- Declared exports: `attachConsoleCollector`, `closeTopModal`, `isIgnoredConsole`, `latestObservedStatus`, `readJson`, `readJsonStatus`, `waitForRead`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (14)
  - `ops/scripts/runtime/live-checks/phase84-branches-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-contacts-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-files-providers-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-inventory-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-brands-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-categories-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-page-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-scanning-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-stock-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-units-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-variant-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-sales-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-ui-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-users-actions-live-check.ts`

### 3.439 `ops/scripts/runtime/live-checks/phase84-branches-actions-live-check.ts`

- Declared exports: none detected
- Imports (6)
  - `../audits/audit-auth.ts`
  - `./live-check-utils.ts`
  - `node:fs/promises`
  - `node:path`
  - `node:url`
  - `playwright`
- Internal dependencies (2)
  - `ops/scripts/runtime/audits/audit-auth.ts`
  - `ops/scripts/runtime/live-checks/live-check-utils.ts`
- Referenced by (0)
  - none

### 3.440 `ops/scripts/runtime/live-checks/phase84-contacts-live-check.ts`

- Declared exports: none detected
- Imports (6)
  - `../audits/audit-auth.ts`
  - `./live-check-utils.ts`
  - `node:fs/promises`
  - `node:path`
  - `node:url`
  - `playwright`
- Internal dependencies (2)
  - `ops/scripts/runtime/audits/audit-auth.ts`
  - `ops/scripts/runtime/live-checks/live-check-utils.ts`
- Referenced by (0)
  - none

### 3.441 `ops/scripts/runtime/live-checks/phase84-files-providers-actions-live-check.ts`

- Declared exports: none detected
- Imports (6)
  - `../audits/audit-auth.ts`
  - `./live-check-utils.ts`
  - `node:fs/promises`
  - `node:path`
  - `node:url`
  - `playwright`
- Internal dependencies (2)
  - `ops/scripts/runtime/audits/audit-auth.ts`
  - `ops/scripts/runtime/live-checks/live-check-utils.ts`
- Referenced by (0)
  - none

### 3.442 `ops/scripts/runtime/live-checks/phase84-inventory-actions-live-check.ts`

- Declared exports: none detected
- Imports (6)
  - `../audits/audit-auth.ts`
  - `./live-check-utils.ts`
  - `node:fs/promises`
  - `node:path`
  - `node:url`
  - `playwright`
- Internal dependencies (2)
  - `ops/scripts/runtime/audits/audit-auth.ts`
  - `ops/scripts/runtime/live-checks/live-check-utils.ts`
- Referenced by (0)
  - none

### 3.443 `ops/scripts/runtime/live-checks/phase84-live-suite.ts`

- Declared exports: none detected
- Imports (4)
  - `node:child_process`
  - `node:fs`
  - `node:path`
  - `node:url`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.444 `ops/scripts/runtime/live-checks/phase84-product-brands-actions-live-check.ts`

- Declared exports: none detected
- Imports (6)
  - `../audits/audit-auth.ts`
  - `./live-check-utils.ts`
  - `node:fs/promises`
  - `node:path`
  - `node:url`
  - `playwright`
- Internal dependencies (2)
  - `ops/scripts/runtime/audits/audit-auth.ts`
  - `ops/scripts/runtime/live-checks/live-check-utils.ts`
- Referenced by (0)
  - none

### 3.445 `ops/scripts/runtime/live-checks/phase84-product-categories-actions-live-check.ts`

- Declared exports: none detected
- Imports (6)
  - `../audits/audit-auth.ts`
  - `./live-check-utils.ts`
  - `node:fs/promises`
  - `node:path`
  - `node:url`
  - `playwright`
- Internal dependencies (2)
  - `ops/scripts/runtime/audits/audit-auth.ts`
  - `ops/scripts/runtime/live-checks/live-check-utils.ts`
- Referenced by (0)
  - none

### 3.446 `ops/scripts/runtime/live-checks/phase84-product-page-actions-live-check.ts`

- Declared exports: none detected
- Imports (6)
  - `../audits/audit-auth.ts`
  - `./live-check-utils.ts`
  - `node:fs/promises`
  - `node:path`
  - `node:url`
  - `playwright`
- Internal dependencies (2)
  - `ops/scripts/runtime/audits/audit-auth.ts`
  - `ops/scripts/runtime/live-checks/live-check-utils.ts`
- Referenced by (0)
  - none

### 3.447 `ops/scripts/runtime/live-checks/phase84-product-scanning-actions-live-check.ts`

- Declared exports: none detected
- Imports (6)
  - `../audits/audit-auth.ts`
  - `./live-check-utils.ts`
  - `node:fs/promises`
  - `node:path`
  - `node:url`
  - `playwright`
- Internal dependencies (2)
  - `ops/scripts/runtime/audits/audit-auth.ts`
  - `ops/scripts/runtime/live-checks/live-check-utils.ts`
- Referenced by (0)
  - none

### 3.448 `ops/scripts/runtime/live-checks/phase84-product-stock-actions-live-check.ts`

- Declared exports: none detected
- Imports (6)
  - `../audits/audit-auth.ts`
  - `./live-check-utils.ts`
  - `node:fs/promises`
  - `node:path`
  - `node:url`
  - `playwright`
- Internal dependencies (2)
  - `ops/scripts/runtime/audits/audit-auth.ts`
  - `ops/scripts/runtime/live-checks/live-check-utils.ts`
- Referenced by (0)
  - none

### 3.449 `ops/scripts/runtime/live-checks/phase84-product-units-actions-live-check.ts`

- Declared exports: none detected
- Imports (6)
  - `../audits/audit-auth.ts`
  - `./live-check-utils.ts`
  - `node:fs/promises`
  - `node:path`
  - `node:url`
  - `playwright`
- Internal dependencies (2)
  - `ops/scripts/runtime/audits/audit-auth.ts`
  - `ops/scripts/runtime/live-checks/live-check-utils.ts`
- Referenced by (0)
  - none

### 3.450 `ops/scripts/runtime/live-checks/phase84-product-variant-actions-live-check.ts`

- Declared exports: none detected
- Imports (6)
  - `../audits/audit-auth.ts`
  - `./live-check-utils.ts`
  - `node:fs/promises`
  - `node:path`
  - `node:url`
  - `playwright`
- Internal dependencies (2)
  - `ops/scripts/runtime/audits/audit-auth.ts`
  - `ops/scripts/runtime/live-checks/live-check-utils.ts`
- Referenced by (0)
  - none

### 3.451 `ops/scripts/runtime/live-checks/phase84-public-portal-cloudflare-check.ts`

- Declared exports: none detected
- Imports (4)
  - `node:fs/promises`
  - `node:path`
  - `node:url`
  - `playwright`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.452 `ops/scripts/runtime/live-checks/phase84-sales-actions-live-check.ts`

- Declared exports: none detected
- Imports (6)
  - `../audits/audit-auth.ts`
  - `./live-check-utils.ts`
  - `node:fs/promises`
  - `node:path`
  - `node:url`
  - `playwright`
- Internal dependencies (2)
  - `ops/scripts/runtime/audits/audit-auth.ts`
  - `ops/scripts/runtime/live-checks/live-check-utils.ts`
- Referenced by (0)
  - none

### 3.453 `ops/scripts/runtime/live-checks/phase84-ui-live-check.ts`

- Declared exports: none detected
- Imports (6)
  - `../audits/audit-auth.ts`
  - `./live-check-utils.ts`
  - `node:fs/promises`
  - `node:path`
  - `node:url`
  - `playwright`
- Internal dependencies (2)
  - `ops/scripts/runtime/audits/audit-auth.ts`
  - `ops/scripts/runtime/live-checks/live-check-utils.ts`
- Referenced by (0)
  - none

### 3.454 `ops/scripts/runtime/live-checks/phase84-users-actions-live-check.ts`

- Declared exports: none detected
- Imports (6)
  - `../audits/audit-auth.ts`
  - `./live-check-utils.ts`
  - `node:fs/promises`
  - `node:path`
  - `node:url`
  - `playwright`
- Internal dependencies (2)
  - `ops/scripts/runtime/audits/audit-auth.ts`
  - `ops/scripts/runtime/live-checks/live-check-utils.ts`
- Referenced by (0)
  - none

### 3.455 `ops/scripts/runtime/smoke/check-public-url.ts`

- Declared exports: none detected
- Imports (2)
  - `node:https`
  - `node:net`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.456 `ops/scripts/runtime/smoke/check-route-contract.ts`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.457 `ops/scripts/runtime/smoke/live-smoke.ts`

- Declared exports: none detected
- Imports (5)
  - `node:child_process`
  - `node:fs/promises`
  - `node:os`
  - `node:path`
  - `node:perf_hooks`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.458 `ops/scripts/runtime/smoke/post-start-diagnostics.ts`

- Declared exports: none detected
- Imports (2)
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.459 `ops/scripts/runtime/storage/cleanup-integrity-backlog.ts`

- Declared exports: none detected
- Imports (3)
  - `node:child_process`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.460 `ops/scripts/runtime/storage/cleanup-test-data.ts`

- Declared exports: none detected
- Imports (3)
  - `node:child_process`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.461 `ops/scripts/runtime/storage/dataset-readiness.ts`

- Declared exports: none detected
- Imports (3)
  - `node:child_process`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.462 `ops/scripts/runtime/storage/post-live-hygiene.ts`

- Declared exports: none detected
- Imports (3)
  - `node:child_process`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.463 `ops/scripts/runtime/storage/prune-storage.ts`

- Declared exports: none detected
- Imports (4)
  - `node:child_process`
  - `node:fs`
  - `node:module`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.464 `ops/scripts/runtime/storage/restore-candidates.ts`

- Declared exports: none detected
- Imports (2)
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.465 `ops/scripts/runtime/storage/restore-rehearsal.ts`

- Declared exports: none detected
- Imports (3)
  - `node:child_process`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.466 `ops/scripts/verification/verify-backup-reliability.ts`

- Declared exports: none detected
- Imports (3)
  - `../lib/fs-utils.ts`
  - `node:fs`
  - `node:path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.ts`
- Referenced by (0)
  - none

### 3.467 `ops/scripts/verification/verify-docker-release.ts`

- Declared exports: none detected
- Imports (3)
  - `../lib/fs-utils.ts`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.ts`
- Referenced by (0)
  - none

### 3.468 `ops/scripts/verification/verify-hardening-policy.ts`

- Declared exports: none detected
- Imports (4)
  - `../lib/fs-utils.ts`
  - `node:child_process`
  - `node:fs`
  - `node:path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.ts`
- Referenced by (0)
  - none

### 3.469 `ops/scripts/verification/verify-runtime-deps.ts`

- Declared exports: none detected
- Imports (3)
  - `../lib/fs-utils.ts`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.ts`
- Referenced by (0)
  - none

### 3.470 `ops/scripts/verification/verify-scale-services.ts`

- Declared exports: none detected
- Imports (4)
  - `../lib/fs-utils.ts`
  - `child_process`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.ts`
- Referenced by (0)
  - none

### 3.471 `ops/scripts/verification/verify-secret-hygiene.ts`

- Declared exports: none detected
- Imports (4)
  - `../lib/fs-utils.ts`
  - `child_process`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.ts`
- Referenced by (0)
  - none

