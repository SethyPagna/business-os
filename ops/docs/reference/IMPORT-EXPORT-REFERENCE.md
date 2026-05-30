# Import / Export Reference

Auto-generated import/export and dependency-link coverage for frontend/backend code files.

## 1. Coverage Summary

Code files documented: **468**

## 2. Dependency Matrix

| No. | File | Imports | Exports | Internal deps | Referenced by |
|---:|---|---:|---:|---:|---:|
| 1 | `backend/server.js` | 47 | 0 | 40 | 0 |
| 2 | `backend/src/accessControl.ts` | 1 | 1 | 1 | 4 |
| 3 | `backend/src/analytics/duckdbRuntime.ts` | 2 | 1 | 1 | 4 |
| 4 | `backend/src/authOtpGuards.ts` | 1 | 1 | 1 | 2 |
| 5 | `backend/src/backupSchema.ts` | 0 | 1 | 0 | 3 |
| 6 | `backend/src/businessMetrics.ts` | 1 | 1 | 1 | 5 |
| 7 | `backend/src/catalogTextIntegrity.ts` | 0 | 1 | 0 | 7 |
| 8 | `backend/src/config/index.js` | 4 | 1 | 1 | 25 |
| 9 | `backend/src/conflictControl.ts` | 0 | 1 | 0 | 12 |
| 10 | `backend/src/contactOptions.ts` | 0 | 1 | 0 | 3 |
| 11 | `backend/src/database.ts` | 1 | 1 | 1 | 40 |
| 12 | `backend/src/dataPath/index.ts` | 2 | 1 | 0 | 5 |
| 13 | `backend/src/db/cutoverReadiness.ts` | 2 | 1 | 0 | 2 |
| 14 | `backend/src/db/postgresQueryCompat.ts` | 0 | 1 | 0 | 2 |
| 15 | `backend/src/fileAssets.js` | 12 | 1 | 7 | 15 |
| 16 | `backend/src/helpers.js` | 4 | 1 | 4 | 23 |
| 17 | `backend/src/idempotency.ts` | 0 | 1 | 0 | 5 |
| 18 | `backend/src/importCsv.ts` | 1 | 1 | 0 | 3 |
| 19 | `backend/src/importParsing.ts` | 1 | 1 | 1 | 3 |
| 20 | `backend/src/initials.ts` | 0 | 1 | 0 | 4 |
| 21 | `backend/src/maintenanceLock.ts` | 0 | 1 | 0 | 3 |
| 22 | `backend/src/middleware.js` | 10 | 1 | 7 | 24 |
| 23 | `backend/src/money.ts` | 0 | 1 | 0 | 5 |
| 24 | `backend/src/netSecurity.ts` | 1 | 1 | 0 | 5 |
| 25 | `backend/src/objectStore.js` | 7 | 1 | 1 | 6 |
| 26 | `backend/src/optionalSharp.ts` | 1 | 1 | 0 | 2 |
| 27 | `backend/src/organizationContext/index.ts` | 7 | 1 | 4 | 6 |
| 28 | `backend/src/permissions.ts` | 0 | 1 | 0 | 4 |
| 29 | `backend/src/portalUtils.ts` | 0 | 1 | 0 | 2 |
| 30 | `backend/src/postgresDatabase.js` | 7 | 1 | 3 | 2 |
| 31 | `backend/src/productBatches.js` | 1 | 1 | 1 | 6 |
| 32 | `backend/src/productDiscounts.ts` | 1 | 1 | 1 | 3 |
| 33 | `backend/src/productImportPolicies.ts` | 1 | 1 | 1 | 3 |
| 34 | `backend/src/requestContext.ts` | 1 | 1 | 0 | 2 |
| 35 | `backend/src/routes/actionHistory.ts` | 5 | 1 | 4 | 1 |
| 36 | `backend/src/routes/ai.ts` | 6 | 1 | 5 | 1 |
| 37 | `backend/src/routes/auth.js` | 18 | 1 | 13 | 2 |
| 38 | `backend/src/routes/branches.js` | 8 | 1 | 6 | 1 |
| 39 | `backend/src/routes/catalog.ts` | 4 | 1 | 3 | 2 |
| 40 | `backend/src/routes/categories.ts` | 6 | 1 | 5 | 2 |
| 41 | `backend/src/routes/contacts.js` | 6 | 1 | 5 | 1 |
| 42 | `backend/src/routes/customTables.js` | 6 | 1 | 5 | 1 |
| 43 | `backend/src/routes/files.ts` | 6 | 1 | 5 | 2 |
| 44 | `backend/src/routes/importJobs.js` | 9 | 1 | 5 | 1 |
| 45 | `backend/src/routes/inventory.js` | 12 | 1 | 11 | 2 |
| 46 | `backend/src/routes/notifications.ts` | 5 | 1 | 4 | 3 |
| 47 | `backend/src/routes/organizations.ts` | 3 | 1 | 2 | 2 |
| 48 | `backend/src/routes/portal.js` | 13 | 1 | 12 | 2 |
| 49 | `backend/src/routes/products.js` | 20 | 1 | 17 | 2 |
| 50 | `backend/src/routes/returns.js` | 7 | 1 | 6 | 1 |
| 51 | `backend/src/routes/runtime.ts` | 9 | 1 | 8 | 2 |
| 52 | `backend/src/routes/sales.js` | 8 | 1 | 7 | 1 |
| 53 | `backend/src/routes/settings.ts` | 9 | 1 | 8 | 2 |
| 54 | `backend/src/routes/sync.js` | 7 | 1 | 3 | 1 |
| 55 | `backend/src/routes/system/index.js` | 24 | 1 | 20 | 2 |
| 56 | `backend/src/routes/units.ts` | 6 | 1 | 5 | 2 |
| 57 | `backend/src/routes/users.js` | 11 | 1 | 9 | 1 |
| 58 | `backend/src/runtimeCache.ts` | 2 | 1 | 1 | 4 |
| 59 | `backend/src/runtimeState/index.ts` | 4 | 1 | 1 | 2 |
| 60 | `backend/src/runtimeVersion.ts` | 5 | 1 | 1 | 4 |
| 61 | `backend/src/schemaMetadata.ts` | 1 | 1 | 1 | 6 |
| 62 | `backend/src/security.ts` | 1 | 1 | 0 | 7 |
| 63 | `backend/src/serverUtils.js` | 1 | 1 | 1 | 4 |
| 64 | `backend/src/services/aiGateway.js` | 2 | 1 | 2 | 2 |
| 65 | `backend/src/services/backupPackages.js` | 9 | 1 | 4 | 4 |
| 66 | `backend/src/services/firebaseAuth.js` | 2 | 1 | 0 | 0 |
| 67 | `backend/src/services/googleDriveSync/index.js` | 12 | 1 | 8 | 4 |
| 68 | `backend/src/services/googleDriveSync/versioning.ts` | 0 | 1 | 0 | 2 |
| 69 | `backend/src/services/googleOauth.ts` | 2 | 1 | 1 | 4 |
| 70 | `backend/src/services/importJobs.js` | 20 | 1 | 14 | 7 |
| 71 | `backend/src/services/integrationDoctor.js` | 10 | 1 | 8 | 2 |
| 72 | `backend/src/services/mediaQueue.ts` | 5 | 1 | 3 | 5 |
| 73 | `backend/src/services/portalAi.js` | 2 | 1 | 2 | 1 |
| 74 | `backend/src/services/verification.ts` | 2 | 1 | 1 | 2 |
| 75 | `backend/src/sessionAuth.ts` | 2 | 1 | 1 | 4 |
| 76 | `backend/src/settingsSnapshot.ts` | 4 | 1 | 2 | 8 |
| 77 | `backend/src/storage/organizationFolders.ts` | 2 | 1 | 0 | 2 |
| 78 | `backend/src/systemFsWorker.ts` | 3 | 0 | 1 | 0 |
| 79 | `backend/src/systemJobs.js` | 2 | 1 | 1 | 2 |
| 80 | `backend/src/uploadReferenceCleanup.ts` | 1 | 1 | 1 | 2 |
| 81 | `backend/src/uploadSecurity.ts` | 2 | 1 | 1 | 4 |
| 82 | `backend/src/websocket.ts` | 5 | 1 | 3 | 2 |
| 83 | `backend/src/workers/importWorker.ts` | 2 | 1 | 2 | 1 |
| 84 | `backend/src/workers/mediaWorker.ts` | 2 | 1 | 2 | 1 |
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
| 127 | `backend/test/routeContracts.test.ts` | 18 | 0 | 13 | 0 |
| 128 | `backend/test/runtimeCache.test.ts` | 5 | 0 | 1 | 0 |
| 129 | `backend/test/runtimeVersion.test.ts` | 5 | 0 | 1 | 0 |
| 130 | `backend/test/schemaMetadata.test.ts` | 2 | 0 | 1 | 0 |
| 131 | `backend/test/security.test.ts` | 2 | 0 | 1 | 0 |
| 132 | `backend/test/serverUtils.test.ts` | 3 | 0 | 2 | 0 |
| 133 | `backend/test/settingsSnapshotObjectStorage.test.ts` | 3 | 0 | 2 | 0 |
| 134 | `backend/test/systemJobs.test.ts` | 2 | 0 | 1 | 0 |
| 135 | `backend/test/uploadSecurity.test.ts` | 3 | 0 | 2 | 0 |
| 136 | `backend/test/websocket.test.ts` | 2 | 0 | 1 | 0 |
| 137 | `frontend/public/runtime-noise-guard.js` | 0 | 0 | 0 | 0 |
| 138 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.js` | 0 | 0 | 0 | 0 |
| 139 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.worker.js` | 0 | 0 | 0 | 0 |
| 140 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd-threads.js` | 0 | 0 | 0 | 0 |
| 141 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd.js` | 0 | 0 | 0 | 0 |
| 142 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core.js` | 0 | 0 | 0 | 0 |
| 143 | `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js` | 0 | 0 | 0 | 0 |
| 144 | `frontend/public/sw.js` | 0 | 0 | 0 | 0 |
| 145 | `frontend/public/theme-bootstrap.js` | 0 | 0 | 0 | 0 |
| 146 | `frontend/src/api/http.ts` | 2 | 32 | 2 | 8 |
| 147 | `frontend/src/api/localDb.ts` | 3 | 10 | 2 | 3 |
| 148 | `frontend/src/api/methods.ts` | 6 | 200 | 6 | 1 |
| 149 | `frontend/src/api/websocket.ts` | 2 | 4 | 2 | 2 |
| 150 | `frontend/src/App.tsx` | 32 | 1 | 29 | 1 |
| 151 | `frontend/src/app/appShellUtils.ts` | 0 | 16 | 0 | 5 |
| 152 | `frontend/src/app/publicErrorRecovery.ts` | 0 | 3 | 0 | 1 |
| 153 | `frontend/src/AppContext.tsx` | 15 | 5 | 14 | 52 |
| 154 | `frontend/src/components/auth/Login.tsx` | 5 | 1 | 4 | 1 |
| 155 | `frontend/src/components/branches/Branches.tsx` | 13 | 1 | 11 | 1 |
| 156 | `frontend/src/components/branches/BranchForm.tsx` | 2 | 1 | 1 | 1 |
| 157 | `frontend/src/components/branches/TransferModal.tsx` | 3 | 1 | 2 | 1 |
| 158 | `frontend/src/components/catalog/CatalogEditorSurface.tsx` | 7 | 1 | 5 | 1 |
| 159 | `frontend/src/components/catalog/CatalogImageField.tsx` | 2 | 1 | 1 | 1 |
| 160 | `frontend/src/components/catalog/CatalogPage.tsx` | 14 | 1 | 12 | 1 |
| 161 | `frontend/src/components/catalog/CatalogPageContext.tsx` | 1 | 2 | 0 | 2 |
| 162 | `frontend/src/components/catalog/CatalogPreviewSurface.tsx` | 6 | 1 | 4 | 1 |
| 163 | `frontend/src/components/catalog/CatalogProductsSection.tsx` | 8 | 1 | 6 | 1 |
| 164 | `frontend/src/components/catalog/CatalogSecondaryTabs.tsx` | 2 | 1 | 1 | 1 |
| 165 | `frontend/src/components/catalog/catalogUi.tsx` | 1 | 3 | 0 | 4 |
| 166 | `frontend/src/components/catalog/portalCatalogDisplay.ts` | 1 | 7 | 1 | 1 |
| 167 | `frontend/src/components/catalog/portalContentI18n.ts` | 1 | 6 | 1 | 0 |
| 168 | `frontend/src/components/catalog/portalEditorUtils.ts` | 0 | 9 | 0 | 0 |
| 169 | `frontend/src/components/catalog/portalLanguagePacks.ts` | 0 | 4 | 0 | 1 |
| 170 | `frontend/src/components/catalog/portalTranslateController.ts` | 0 | 19 | 0 | 0 |
| 171 | `frontend/src/components/contacts/ContactImportModal.tsx` | 8 | 1 | 7 | 4 |
| 172 | `frontend/src/components/contacts/contactImportWorker.ts` | 1 | 0 | 1 | 0 |
| 173 | `frontend/src/components/contacts/contactOptionUtils.ts` | 0 | 9 | 0 | 5 |
| 174 | `frontend/src/components/contacts/Contacts.tsx` | 12 | 1 | 10 | 1 |
| 175 | `frontend/src/components/contacts/CustomerFormModal.tsx` | 4 | 1 | 3 | 1 |
| 176 | `frontend/src/components/contacts/customerMembershipNumber.ts` | 0 | 1 | 0 | 2 |
| 177 | `frontend/src/components/contacts/CustomersTab.tsx` | 18 | 2 | 16 | 2 |
| 178 | `frontend/src/components/contacts/DeliveryTab.tsx` | 17 | 2 | 15 | 1 |
| 179 | `frontend/src/components/contacts/shared.tsx` | 7 | 6 | 5 | 3 |
| 180 | `frontend/src/components/contacts/SuppliersTab.tsx` | 17 | 0 | 15 | 1 |
| 181 | `frontend/src/components/custom-tables/CustomTables.tsx` | 6 | 1 | 5 | 0 |
| 182 | `frontend/src/components/dashboard/charts/BarChart.tsx` | 3 | 1 | 2 | 0 |
| 183 | `frontend/src/components/dashboard/charts/DonutChart.tsx` | 3 | 1 | 2 | 0 |
| 184 | `frontend/src/components/dashboard/charts/index.ts` | 0 | 0 | 0 | 2 |
| 185 | `frontend/src/components/dashboard/charts/LineChart.tsx` | 3 | 1 | 2 | 0 |
| 186 | `frontend/src/components/dashboard/charts/NoData.tsx` | 1 | 1 | 1 | 3 |
| 187 | `frontend/src/components/dashboard/Dashboard.tsx` | 16 | 1 | 14 | 1 |
| 188 | `frontend/src/components/dashboard/MiniStat.tsx` | 1 | 1 | 0 | 1 |
| 189 | `frontend/src/components/files/FilePickerModal.tsx` | 4 | 1 | 3 | 5 |
| 190 | `frontend/src/components/files/FilesPage.tsx` | 11 | 1 | 10 | 1 |
| 191 | `frontend/src/components/files/FilesProvidersTab.tsx` | 1 | 1 | 0 | 1 |
| 192 | `frontend/src/components/files/FilesResponsesTab.tsx` | 0 | 1 | 0 | 1 |
| 193 | `frontend/src/components/inventory/DualMoney.tsx` | 0 | 1 | 0 | 1 |
| 194 | `frontend/src/components/inventory/Inventory.tsx` | 30 | 1 | 28 | 1 |
| 195 | `frontend/src/components/inventory/InventoryImportModal.tsx` | 5 | 1 | 4 | 1 |
| 196 | `frontend/src/components/inventory/inventoryImportWorker.ts` | 1 | 0 | 1 | 0 |
| 197 | `frontend/src/components/inventory/InventoryMovementsSurface.tsx` | 6 | 1 | 4 | 1 |
| 198 | `frontend/src/components/inventory/InventoryProductsSurface.tsx` | 4 | 1 | 2 | 1 |
| 199 | `frontend/src/components/inventory/InventoryRfidSurface.tsx` | 1 | 1 | 0 | 1 |
| 200 | `frontend/src/components/inventory/movementGroups.ts` | 0 | 4 | 0 | 2 |
| 201 | `frontend/src/components/inventory/ProductDetailModal.tsx` | 2 | 1 | 2 | 1 |
| 202 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx` | 7 | 1 | 5 | 1 |
| 203 | `frontend/src/components/navigation/Sidebar.tsx` | 8 | 1 | 6 | 1 |
| 204 | `frontend/src/components/pos/CartItem.tsx` | 2 | 1 | 2 | 1 |
| 205 | `frontend/src/components/pos/FilterPanel.tsx` | 2 | 1 | 0 | 1 |
| 206 | `frontend/src/components/pos/POS.tsx` | 19 | 1 | 17 | 1 |
| 207 | `frontend/src/components/pos/posCore.ts` | 3 | 9 | 3 | 0 |
| 208 | `frontend/src/components/pos/ProductImage.tsx` | 1 | 1 | 1 | 1 |
| 209 | `frontend/src/components/pos/QuickAddModal.tsx` | 1 | 1 | 0 | 1 |
| 210 | `frontend/src/components/products/config/productPageConfig.ts` | 0 | 9 | 0 | 0 |
| 211 | `frontend/src/components/products/forms/BranchStockAdjuster.tsx` | 3 | 1 | 2 | 1 |
| 212 | `frontend/src/components/products/forms/BulkAddStockModal.tsx` | 3 | 1 | 2 | 1 |
| 213 | `frontend/src/components/products/forms/ProductForm.tsx` | 9 | 1 | 7 | 1 |
| 214 | `frontend/src/components/products/forms/VariantFormModal.tsx` | 8 | 1 | 7 | 1 |
| 215 | `frontend/src/components/products/helpers/productDisplayHelpers.ts` | 1 | 7 | 1 | 0 |
| 216 | `frontend/src/components/products/helpers/productFilterHelpers.ts` | 2 | 4 | 2 | 0 |
| 217 | `frontend/src/components/products/helpers/productGalleryHelpers.ts` | 1 | 8 | 1 | 1 |
| 218 | `frontend/src/components/products/helpers/productGroupViewHelpers.ts` | 0 | 2 | 0 | 0 |
| 219 | `frontend/src/components/products/helpers/productMenuHelpers.ts` | 0 | 4 | 0 | 0 |
| 220 | `frontend/src/components/products/helpers/productPageHelpers.ts` | 1 | 4 | 0 | 0 |
| 221 | `frontend/src/components/products/helpers/productSelectionHelpers.ts` | 0 | 10 | 0 | 0 |
| 222 | `frontend/src/components/products/helpers/productWriteHelpers.ts` | 2 | 15 | 2 | 0 |
| 223 | `frontend/src/components/products/history/productHistoryHelpers.ts` | 0 | 2 | 0 | 2 |
| 224 | `frontend/src/components/products/import/BulkImportModal.tsx` | 6 | 1 | 4 | 1 |
| 225 | `frontend/src/components/products/import/productImportPlanner.ts` | 0 | 11 | 0 | 3 |
| 226 | `frontend/src/components/products/import/productImportWorker.ts` | 1 | 0 | 1 | 0 |
| 227 | `frontend/src/components/products/lookups/ManageBrandsModal.tsx` | 6 | 1 | 5 | 1 |
| 228 | `frontend/src/components/products/lookups/ManageCategoriesModal.tsx` | 6 | 1 | 5 | 1 |
| 229 | `frontend/src/components/products/lookups/ManageUnitsModal.tsx` | 6 | 1 | 5 | 1 |
| 230 | `frontend/src/components/products/lookups/productLookupSnapshots.ts` | 1 | 3 | 1 | 0 |
| 231 | `frontend/src/components/products/Products.tsx` | 32 | 1 | 30 | 1 |
| 232 | `frontend/src/components/products/scanning/barcodeImageScanner.ts` | 1 | 1 | 0 | 2 |
| 233 | `frontend/src/components/products/scanning/BarcodeScannerModal.tsx` | 7 | 1 | 4 | 1 |
| 234 | `frontend/src/components/products/scanning/barcodeScannerState.ts` | 0 | 1 | 0 | 2 |
| 235 | `frontend/src/components/products/scanning/scanbotScanner.ts` | 0 | 3 | 0 | 2 |
| 236 | `frontend/src/components/products/shared/primitives.tsx` | 3 | 0 | 1 | 9 |
| 237 | `frontend/src/components/products/surfaces/HeaderActions.tsx` | 3 | 1 | 2 | 1 |
| 238 | `frontend/src/components/products/surfaces/ProductDetailModal.tsx` | 6 | 1 | 4 | 1 |
| 239 | `frontend/src/components/products/surfaces/ProductRowParts.tsx` | 4 | 4 | 3 | 0 |
| 240 | `frontend/src/components/products/surfaces/ProductsListSurface.tsx` | 2 | 1 | 0 | 1 |
| 241 | `frontend/src/components/receipt-settings/AllFieldsPanel.tsx` | 3 | 1 | 2 | 1 |
| 242 | `frontend/src/components/receipt-settings/constants.ts` | 0 | 3 | 0 | 4 |
| 243 | `frontend/src/components/receipt-settings/ErrorBoundary.tsx` | 1 | 1 | 0 | 1 |
| 244 | `frontend/src/components/receipt-settings/FieldOrderManager.tsx` | 2 | 1 | 0 | 1 |
| 245 | `frontend/src/components/receipt-settings/PrintSettings.tsx` | 4 | 1 | 2 | 1 |
| 246 | `frontend/src/components/receipt-settings/ReceiptPreview.tsx` | 4 | 1 | 3 | 1 |
| 247 | `frontend/src/components/receipt-settings/ReceiptSettings.tsx` | 12 | 1 | 10 | 1 |
| 248 | `frontend/src/components/receipt-settings/template.ts` | 1 | 2 | 1 | 3 |
| 249 | `frontend/src/components/receipt/Receipt.tsx` | 7 | 1 | 5 | 3 |
| 250 | `frontend/src/components/returns/EditReturnModal.tsx` | 4 | 1 | 3 | 1 |
| 251 | `frontend/src/components/returns/NewReturnModal.tsx` | 4 | 1 | 3 | 1 |
| 252 | `frontend/src/components/returns/NewSupplierReturnModal.tsx` | 3 | 1 | 2 | 1 |
| 253 | `frontend/src/components/returns/ReturnDetailModal.tsx` | 2 | 1 | 2 | 1 |
| 254 | `frontend/src/components/returns/Returns.tsx` | 19 | 1 | 17 | 1 |
| 255 | `frontend/src/components/returns/ReturnsListSurface.tsx` | 2 | 1 | 0 | 1 |
| 256 | `frontend/src/components/sales/ExportModal.tsx` | 5 | 1 | 3 | 1 |
| 257 | `frontend/src/components/sales/SaleDetailModal.tsx` | 3 | 1 | 2 | 1 |
| 258 | `frontend/src/components/sales/Sales.tsx` | 22 | 1 | 20 | 1 |
| 259 | `frontend/src/components/sales/SalesImportModal.tsx` | 5 | 1 | 4 | 1 |
| 260 | `frontend/src/components/sales/salesImportWorker.ts` | 1 | 0 | 1 | 0 |
| 261 | `frontend/src/components/sales/SalesListSurface.tsx` | 3 | 1 | 1 | 1 |
| 262 | `frontend/src/components/sales/StatusBadge.tsx` | 0 | 5 | 0 | 6 |
| 263 | `frontend/src/components/server/ServerPage.tsx` | 5 | 1 | 4 | 1 |
| 264 | `frontend/src/components/shared/ActionHistoryBar.tsx` | 3 | 1 | 1 | 17 |
| 265 | `frontend/src/components/shared/BackgroundImportTracker.tsx` | 7 | 1 | 5 | 1 |
| 266 | `frontend/src/components/shared/ExportMenu.tsx` | 3 | 1 | 1 | 7 |
| 267 | `frontend/src/components/shared/FilterMenu.tsx` | 3 | 1 | 1 | 8 |
| 268 | `frontend/src/components/shared/globalScroll.ts` | 0 | 2 | 0 | 2 |
| 269 | `frontend/src/components/shared/ImageGalleryLightbox.tsx` | 2 | 1 | 0 | 3 |
| 270 | `frontend/src/components/shared/LoadingWatchdog.tsx` | 1 | 1 | 0 | 6 |
| 271 | `frontend/src/components/shared/Modal.tsx` | 1 | 1 | 0 | 22 |
| 272 | `frontend/src/components/shared/navigationConfig.ts` | 0 | 4 | 0 | 3 |
| 273 | `frontend/src/components/shared/NotificationCenter.tsx` | 4 | 1 | 1 | 2 |
| 274 | `frontend/src/components/shared/pageActivity.ts` | 2 | 1 | 1 | 15 |
| 275 | `frontend/src/components/shared/PageHeader.tsx` | 1 | 1 | 0 | 6 |
| 276 | `frontend/src/components/shared/PaginationControls.tsx` | 2 | 4 | 0 | 9 |
| 277 | `frontend/src/components/shared/PortalMenu.tsx` | 3 | 2 | 0 | 9 |
| 278 | `frontend/src/components/shared/QuickPreferenceToggles.tsx` | 3 | 1 | 1 | 3 |
| 279 | `frontend/src/components/shared/SectionSwitcher.tsx` | 1 | 1 | 0 | 4 |
| 280 | `frontend/src/components/shared/WriteConflictModal.tsx` | 1 | 1 | 1 | 1 |
| 281 | `frontend/src/components/users/PermissionEditor.tsx` | 0 | 3 | 0 | 2 |
| 282 | `frontend/src/components/users/UserDetailSheet.tsx` | 2 | 1 | 2 | 1 |
| 283 | `frontend/src/components/users/UserProfileModal.tsx` | 10 | 1 | 8 | 2 |
| 284 | `frontend/src/components/users/Users.tsx` | 14 | 1 | 12 | 1 |
| 285 | `frontend/src/components/utils-settings/AuditLog.tsx` | 10 | 1 | 8 | 1 |
| 286 | `frontend/src/components/utils-settings/Backup.tsx` | 10 | 1 | 8 | 1 |
| 287 | `frontend/src/components/utils-settings/FontFamilyPicker.tsx` | 2 | 1 | 0 | 1 |
| 288 | `frontend/src/components/utils-settings/index.ts` | 0 | 0 | 0 | 0 |
| 289 | `frontend/src/components/utils-settings/OtpModal.tsx` | 3 | 1 | 2 | 2 |
| 290 | `frontend/src/components/utils-settings/ResetData.tsx` | 6 | 0 | 4 | 1 |
| 291 | `frontend/src/components/utils-settings/Settings.tsx` | 13 | 1 | 11 | 1 |
| 292 | `frontend/src/components/utils-settings/settingsConflict.ts` | 0 | 2 | 0 | 2 |
| 293 | `frontend/src/constants.ts` | 0 | 12 | 0 | 8 |
| 294 | `frontend/src/index.tsx` | 9 | 0 | 4 | 0 |
| 295 | `frontend/src/platform/runtime/clientRuntime.ts` | 2 | 8 | 2 | 2 |
| 296 | `frontend/src/platform/storage/storagePolicy.ts` | 0 | 8 | 0 | 0 |
| 297 | `frontend/src/runtime/runtimeErrorClassifier.ts` | 0 | 8 | 0 | 0 |
| 298 | `frontend/src/types/jsx-modules.d.ts` | 0 | 11 | 0 | 0 |
| 299 | `frontend/src/types/receiptContracts.ts` | 0 | 0 | 0 | 4 |
| 300 | `frontend/src/types/settingsContracts.ts` | 0 | 1 | 0 | 2 |
| 301 | `frontend/src/utils/actionGuards.ts` | 0 | 6 | 0 | 33 |
| 302 | `frontend/src/utils/actionHistory.ts` | 2 | 1 | 1 | 16 |
| 303 | `frontend/src/utils/appRefresh.ts` | 0 | 3 | 0 | 5 |
| 304 | `frontend/src/utils/bulkOps.ts` | 0 | 1 | 0 | 8 |
| 305 | `frontend/src/utils/color.ts` | 0 | 1 | 0 | 2 |
| 306 | `frontend/src/utils/csv.ts` | 0 | 8 | 0 | 14 |
| 307 | `frontend/src/utils/csvExportWorker.ts` | 1 | 0 | 1 | 0 |
| 308 | `frontend/src/utils/csvImport.ts` | 1 | 11 | 1 | 3 |
| 309 | `frontend/src/utils/csvRowCounter.ts` | 0 | 1 | 0 | 9 |
| 310 | `frontend/src/utils/dateHelpers.ts` | 0 | 2 | 0 | 2 |
| 311 | `frontend/src/utils/deviceInfo.ts` | 0 | 2 | 0 | 7 |
| 312 | `frontend/src/utils/exportPackage.ts` | 1 | 2 | 1 | 3 |
| 313 | `frontend/src/utils/exportReports.tsx` | 4 | 1 | 2 | 2 |
| 314 | `frontend/src/utils/favicon.ts` | 0 | 1 | 0 | 3 |
| 315 | `frontend/src/utils/formatters.ts` | 0 | 4 | 0 | 17 |
| 316 | `frontend/src/utils/groupedRecords.ts` | 1 | 8 | 1 | 10 |
| 317 | `frontend/src/utils/historyHelpers.ts` | 0 | 3 | 0 | 11 |
| 318 | `frontend/src/utils/importJobRefresh.ts` | 0 | 3 | 0 | 1 |
| 319 | `frontend/src/utils/index.ts` | 0 | 0 | 0 | 0 |
| 320 | `frontend/src/utils/initials.ts` | 0 | 7 | 0 | 8 |
| 321 | `frontend/src/utils/loaders.ts` | 0 | 9 | 0 | 20 |
| 322 | `frontend/src/utils/mediaUpload.ts` | 1 | 5 | 1 | 4 |
| 323 | `frontend/src/utils/permissions.ts` | 0 | 1 | 0 | 2 |
| 324 | `frontend/src/utils/pricing.ts` | 0 | 8 | 0 | 17 |
| 325 | `frontend/src/utils/printReceipt.ts` | 1 | 12 | 1 | 2 |
| 326 | `frontend/src/utils/productBatches.ts` | 0 | 2 | 0 | 5 |
| 327 | `frontend/src/utils/productGrouping.ts` | 1 | 4 | 1 | 4 |
| 328 | `frontend/src/utils/publicAssetUrls.ts` | 1 | 2 | 1 | 7 |
| 329 | `frontend/src/utils/receiptAppliedConfig.ts` | 1 | 9 | 1 | 3 |
| 330 | `frontend/src/utils/scriptTypography.ts` | 0 | 3 | 0 | 6 |
| 331 | `frontend/src/utils/settingsRefresh.ts` | 1 | 3 | 1 | 0 |
| 332 | `frontend/src/utils/settingsWriteOptions.ts` | 1 | 1 | 1 | 1 |
| 333 | `frontend/src/web-api.ts` | 6 | 0 | 6 | 1 |
| 334 | `frontend/tailwind.config.ts` | 1 | 0 | 0 | 0 |
| 335 | `frontend/tests/actionGuards.test.ts` | 1 | 0 | 0 | 0 |
| 336 | `frontend/tests/actionStability.test.ts` | 4 | 0 | 0 | 0 |
| 337 | `frontend/tests/adminShellMediaGuards.test.ts` | 2 | 0 | 0 | 0 |
| 338 | `frontend/tests/apiHttp.test.ts` | 2 | 0 | 0 | 0 |
| 339 | `frontend/tests/appRefresh.test.ts` | 2 | 0 | 1 | 0 |
| 340 | `frontend/tests/appShellUtils.test.ts` | 3 | 0 | 1 | 0 |
| 341 | `frontend/tests/assetCompression.test.ts` | 4 | 0 | 0 | 0 |
| 342 | `frontend/tests/backupJobs.test.ts` | 2 | 0 | 0 | 0 |
| 343 | `frontend/tests/barcodeImageScanner.test.ts` | 2 | 0 | 1 | 0 |
| 344 | `frontend/tests/barcodeScannerState.test.ts` | 2 | 0 | 1 | 0 |
| 345 | `frontend/tests/bulkOps.test.ts` | 2 | 0 | 1 | 0 |
| 346 | `frontend/tests/contactImportWorker.test.ts` | 3 | 0 | 1 | 0 |
| 347 | `frontend/tests/csvImport.test.ts` | 3 | 0 | 1 | 0 |
| 348 | `frontend/tests/dashboardDataReliability.test.ts` | 2 | 0 | 0 | 0 |
| 349 | `frontend/tests/dateHelpers.test.ts` | 2 | 0 | 1 | 0 |
| 350 | `frontend/tests/deviceInfo.test.ts` | 2 | 0 | 1 | 0 |
| 351 | `frontend/tests/exportPackages.test.ts` | 4 | 0 | 2 | 0 |
| 352 | `frontend/tests/formatters.test.ts` | 2 | 0 | 1 | 0 |
| 353 | `frontend/tests/globalScroll.test.ts` | 2 | 0 | 0 | 0 |
| 354 | `frontend/tests/globalScrollControls.test.ts` | 2 | 0 | 1 | 0 |
| 355 | `frontend/tests/groupedRecords.test.ts` | 2 | 0 | 1 | 0 |
| 356 | `frontend/tests/historyHelpers.test.ts` | 1 | 0 | 0 | 0 |
| 357 | `frontend/tests/importJobRefresh.test.ts` | 1 | 0 | 0 | 0 |
| 358 | `frontend/tests/initials.test.ts` | 1 | 0 | 0 | 0 |
| 359 | `frontend/tests/inventoryImportWorker.test.ts` | 3 | 0 | 1 | 0 |
| 360 | `frontend/tests/inventoryMobileCardLayout.test.ts` | 2 | 0 | 0 | 0 |
| 361 | `frontend/tests/inventoryMovementGroups.test.ts` | 2 | 0 | 1 | 0 |
| 362 | `frontend/tests/inventoryRfidSection.test.ts` | 2 | 0 | 0 | 0 |
| 363 | `frontend/tests/jsxSyntaxCheck.ts` | 5 | 0 | 0 | 0 |
| 364 | `frontend/tests/loaders.test.ts` | 1 | 0 | 0 | 0 |
| 365 | `frontend/tests/mediaUploadHelpers.test.ts` | 2 | 0 | 1 | 0 |
| 366 | `frontend/tests/navigationConfig.test.ts` | 2 | 0 | 1 | 0 |
| 367 | `frontend/tests/notificationBadge.test.ts` | 2 | 0 | 0 | 0 |
| 368 | `frontend/tests/offlineSalesQueue.test.ts` | 2 | 0 | 0 | 0 |
| 369 | `frontend/tests/offlineSecurityHardening.test.ts` | 2 | 0 | 0 | 0 |
| 370 | `frontend/tests/offlineSyncArchitecture.test.ts` | 2 | 0 | 0 | 0 |
| 371 | `frontend/tests/ownedGoogleAuth.test.ts` | 2 | 0 | 0 | 0 |
| 372 | `frontend/tests/performanceLoadingUx.test.ts` | 2 | 0 | 0 | 0 |
| 373 | `frontend/tests/permissionEditor.test.ts` | 2 | 0 | 0 | 0 |
| 374 | `frontend/tests/permissions.test.ts` | 2 | 0 | 1 | 0 |
| 375 | `frontend/tests/portalCatalogDisplay.test.ts` | 2 | 0 | 0 | 0 |
| 376 | `frontend/tests/portalContentI18n.test.ts` | 1 | 0 | 0 | 0 |
| 377 | `frontend/tests/portalEditorUtils.test.ts` | 1 | 0 | 0 | 0 |
| 378 | `frontend/tests/portalFaqVocabulary.test.ts` | 1 | 0 | 0 | 0 |
| 379 | `frontend/tests/portalLanguagePacks.test.ts` | 1 | 0 | 0 | 0 |
| 380 | `frontend/tests/portalTranslateController.test.ts` | 1 | 0 | 0 | 0 |
| 381 | `frontend/tests/posCore.test.ts` | 1 | 0 | 0 | 0 |
| 382 | `frontend/tests/pricingContacts.test.ts` | 3 | 0 | 1 | 0 |
| 383 | `frontend/tests/productBatches.test.ts` | 2 | 0 | 1 | 0 |
| 384 | `frontend/tests/productDiscountUx.test.ts` | 2 | 0 | 0 | 0 |
| 385 | `frontend/tests/productDisplayHelpers.test.ts` | 1 | 0 | 0 | 0 |
| 386 | `frontend/tests/productFilterHelpers.test.ts` | 1 | 0 | 0 | 0 |
| 387 | `frontend/tests/productGalleryHelpers.test.ts` | 1 | 0 | 0 | 0 |
| 388 | `frontend/tests/productGrouping.test.ts` | 2 | 0 | 1 | 0 |
| 389 | `frontend/tests/productGroupViewHelpers.test.ts` | 1 | 0 | 0 | 0 |
| 390 | `frontend/tests/productHistoryHelpers.test.ts` | 2 | 0 | 1 | 0 |
| 391 | `frontend/tests/productImportPlanner.test.ts` | 3 | 0 | 1 | 0 |
| 392 | `frontend/tests/productImportWorkerFallback.test.ts` | 3 | 0 | 1 | 0 |
| 393 | `frontend/tests/productMenuHelpers.test.ts` | 1 | 0 | 0 | 0 |
| 394 | `frontend/tests/productPageHelpers.test.ts` | 1 | 0 | 0 | 0 |
| 395 | `frontend/tests/productSearchPagination.test.ts` | 2 | 0 | 0 | 0 |
| 396 | `frontend/tests/productSelectionHelpers.test.ts` | 1 | 0 | 0 | 0 |
| 397 | `frontend/tests/productWriteHelpers.test.ts` | 1 | 0 | 0 | 0 |
| 398 | `frontend/tests/publicErrorRecovery.test.ts` | 1 | 0 | 0 | 0 |
| 399 | `frontend/tests/receiptSettingsSync.test.ts` | 2 | 0 | 0 | 0 |
| 400 | `frontend/tests/receiptTemplate.test.ts` | 4 | 0 | 2 | 0 |
| 401 | `frontend/tests/returnsLayout.test.ts` | 2 | 0 | 0 | 0 |
| 402 | `frontend/tests/runtimeErrorClassifier.test.ts` | 1 | 0 | 0 | 0 |
| 403 | `frontend/tests/salesImportWorker.test.ts` | 3 | 0 | 1 | 0 |
| 404 | `frontend/tests/scanbotScanner.test.ts` | 2 | 0 | 1 | 0 |
| 405 | `frontend/tests/scriptTypography.test.ts` | 2 | 0 | 1 | 0 |
| 406 | `frontend/tests/sectionNavigation.test.ts` | 2 | 0 | 0 | 0 |
| 407 | `frontend/tests/settingsConflictHelpers.test.ts` | 2 | 0 | 1 | 0 |
| 408 | `frontend/tests/settingsRefresh.test.ts` | 1 | 0 | 0 | 0 |
| 409 | `frontend/tests/storagePolicy.test.ts` | 1 | 0 | 0 | 0 |
| 410 | `frontend/tests/utilsSettingsBarrel.test.ts` | 2 | 0 | 0 | 0 |
| 411 | `frontend/vite.config.ts` | 8 | 1 | 0 | 0 |
| 412 | `ops/scripts/architecture/generated-bulk-audit.ts` | 4 | 0 | 2 | 0 |
| 413 | `ops/scripts/architecture/language-runtime-audit.ts` | 4 | 0 | 2 | 0 |
| 414 | `ops/scripts/architecture/organization-audit.ts` | 4 | 0 | 2 | 0 |
| 415 | `ops/scripts/architecture/phase29-audit.ts` | 5 | 0 | 2 | 0 |
| 416 | `ops/scripts/backend/schema-audit.ts` | 2 | 0 | 0 | 0 |
| 417 | `ops/scripts/backend/schema-primary-key-preflight.ts` | 3 | 0 | 0 | 0 |
| 418 | `ops/scripts/backend/verify-data-integrity.ts` | 3 | 0 | 0 | 0 |
| 419 | `ops/scripts/frontend/verify-i18n.ts` | 2 | 0 | 1 | 0 |
| 420 | `ops/scripts/frontend/verify-performance.ts` | 3 | 0 | 0 | 0 |
| 421 | `ops/scripts/frontend/verify-ui.ts` | 3 | 0 | 1 | 0 |
| 422 | `ops/scripts/lib/fs-utils.ts` | 2 | 1 | 0 | 13 |
| 423 | `ops/scripts/lib/report-utils.ts` | 1 | 1 | 0 | 5 |
| 424 | `ops/scripts/runtime/audits/action-history-undo-redo-check.ts` | 4 | 0 | 1 | 0 |
| 425 | `ops/scripts/runtime/audits/audit-auth.ts` | 0 | 4 | 0 | 18 |
| 426 | `ops/scripts/runtime/audits/audit-manifest.ts` | 0 | 7 | 0 | 3 |
| 427 | `ops/scripts/runtime/audits/audit-report-html.ts` | 4 | 3 | 1 | 3 |
| 428 | `ops/scripts/runtime/audits/deep-live-audit.ts` | 9 | 0 | 3 | 0 |
| 429 | `ops/scripts/runtime/audits/full-app-audit.ts` | 9 | 0 | 3 | 0 |
| 430 | `ops/scripts/runtime/browser-action-smoke.ts` | 8 | 0 | 3 | 0 |
| 431 | `ops/scripts/runtime/cloudflare/rotate-cloudflare-tunnel-token.ts` | 4 | 0 | 0 | 0 |
| 432 | `ops/scripts/runtime/cloudflare/update-cloudflare-tunnel-origin.ts` | 3 | 0 | 0 | 0 |
| 433 | `ops/scripts/runtime/cloudflare/verify-cloudflare-automation.ts` | 4 | 0 | 1 | 0 |
| 434 | `ops/scripts/runtime/cloudflare/verify-r2-object-store.ts` | 4 | 0 | 0 | 0 |
| 435 | `ops/scripts/runtime/live-checks/live-check-utils.ts` | 0 | 7 | 0 | 14 |
| 436 | `ops/scripts/runtime/live-checks/phase84-branches-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 437 | `ops/scripts/runtime/live-checks/phase84-contacts-live-check.ts` | 6 | 0 | 2 | 0 |
| 438 | `ops/scripts/runtime/live-checks/phase84-files-providers-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 439 | `ops/scripts/runtime/live-checks/phase84-inventory-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 440 | `ops/scripts/runtime/live-checks/phase84-live-suite.ts` | 4 | 0 | 0 | 0 |
| 441 | `ops/scripts/runtime/live-checks/phase84-product-brands-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 442 | `ops/scripts/runtime/live-checks/phase84-product-categories-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 443 | `ops/scripts/runtime/live-checks/phase84-product-page-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 444 | `ops/scripts/runtime/live-checks/phase84-product-scanning-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 445 | `ops/scripts/runtime/live-checks/phase84-product-stock-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 446 | `ops/scripts/runtime/live-checks/phase84-product-units-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 447 | `ops/scripts/runtime/live-checks/phase84-product-variant-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 448 | `ops/scripts/runtime/live-checks/phase84-public-portal-cloudflare-check.ts` | 4 | 0 | 0 | 0 |
| 449 | `ops/scripts/runtime/live-checks/phase84-sales-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 450 | `ops/scripts/runtime/live-checks/phase84-ui-live-check.ts` | 6 | 0 | 2 | 0 |
| 451 | `ops/scripts/runtime/live-checks/phase84-users-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 452 | `ops/scripts/runtime/smoke/check-public-url.ts` | 2 | 0 | 0 | 0 |
| 453 | `ops/scripts/runtime/smoke/check-route-contract.ts` | 0 | 0 | 0 | 0 |
| 454 | `ops/scripts/runtime/smoke/live-smoke.ts` | 5 | 0 | 0 | 0 |
| 455 | `ops/scripts/runtime/smoke/post-start-diagnostics.ts` | 2 | 0 | 0 | 0 |
| 456 | `ops/scripts/runtime/storage/cleanup-integrity-backlog.ts` | 3 | 0 | 0 | 0 |
| 457 | `ops/scripts/runtime/storage/cleanup-test-data.ts` | 3 | 0 | 0 | 0 |
| 458 | `ops/scripts/runtime/storage/dataset-readiness.ts` | 3 | 0 | 0 | 0 |
| 459 | `ops/scripts/runtime/storage/post-live-hygiene.ts` | 3 | 0 | 0 | 0 |
| 460 | `ops/scripts/runtime/storage/prune-storage.ts` | 4 | 0 | 0 | 0 |
| 461 | `ops/scripts/runtime/storage/restore-candidates.ts` | 2 | 0 | 0 | 0 |
| 462 | `ops/scripts/runtime/storage/restore-rehearsal.ts` | 3 | 0 | 0 | 0 |
| 463 | `ops/scripts/verification/verify-backup-reliability.ts` | 3 | 0 | 1 | 0 |
| 464 | `ops/scripts/verification/verify-docker-release.ts` | 3 | 0 | 1 | 0 |
| 465 | `ops/scripts/verification/verify-hardening-policy.ts` | 4 | 0 | 1 | 0 |
| 466 | `ops/scripts/verification/verify-runtime-deps.ts` | 3 | 0 | 1 | 0 |
| 467 | `ops/scripts/verification/verify-scale-services.ts` | 4 | 0 | 1 | 0 |
| 468 | `ops/scripts/verification/verify-secret-hygiene.ts` | 4 | 0 | 1 | 0 |

## 3. Detailed File Dependency Commentary

### 3.1 `backend/server.js`

- Declared exports: none detected
- Imports (47)
  - `./src/analytics/duckdbRuntime.ts`
  - `./src/config`
  - `./src/database.ts`
  - `./src/fileAssets`
  - `./src/helpers`
  - `./src/maintenanceLock.ts`
  - `./src/middleware`
  - `./src/objectStore`
  - `./src/organizationContext/index.ts`
  - `./src/productBatches`
  - `./src/requestContext.ts`
  - `./src/routes/actionHistory.ts`
  - `./src/routes/ai.ts`
  - `./src/routes/auth`
  - `./src/routes/branches`
  - `./src/routes/catalog.ts`
  - `./src/routes/categories.ts`
  - `./src/routes/contacts`
  - `./src/routes/customTables`
  - `./src/routes/files.ts`
  - `./src/routes/importJobs`
  - `./src/routes/inventory`
  - `./src/routes/notifications.ts`
  - `./src/routes/organizations.ts`
  - `./src/routes/portal`
  - `./src/routes/products`
  - `./src/routes/returns`
  - `./src/routes/runtime.ts`
  - `./src/routes/sales`
  - `./src/routes/settings.ts`
  - `./src/routes/sync`
  - `./src/routes/system`
  - `./src/routes/units.ts`
  - `./src/routes/users`
  - `./src/runtimeVersion.ts`
  - `./src/serverUtils`
  - `./src/services/importJobs`
  - `./src/websocket.ts`
  - `./src/workers/importWorker.ts`
  - `./src/workers/mediaWorker.ts`
  - `compression`
  - `cors`
  - `express`
  - `fs`
  - `http`
  - `path`
  - `stream`
- Internal dependencies (40)
  - `backend/src/analytics/duckdbRuntime.ts`
  - `backend/src/config/index.js`
  - `backend/src/database.ts`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/maintenanceLock.ts`
  - `backend/src/middleware.js`
  - `backend/src/objectStore.js`
  - `backend/src/organizationContext/index.ts`
  - `backend/src/productBatches.js`
  - `backend/src/requestContext.ts`
  - `backend/src/routes/actionHistory.ts`
  - `backend/src/routes/ai.ts`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/branches.js`
  - `backend/src/routes/catalog.ts`
  - `backend/src/routes/categories.ts`
  - `backend/src/routes/contacts.js`
  - `backend/src/routes/customTables.js`
  - `backend/src/routes/files.ts`
  - `backend/src/routes/importJobs.js`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/notifications.ts`
  - `backend/src/routes/organizations.ts`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/returns.js`
  - `backend/src/routes/runtime.ts`
  - `backend/src/routes/sales.js`
  - `backend/src/routes/settings.ts`
  - `backend/src/routes/sync.js`
  - `backend/src/routes/system/index.js`
  - `backend/src/routes/units.ts`
  - `backend/src/routes/users.js`
  - `backend/src/runtimeVersion.ts`
  - `backend/src/serverUtils.js`
  - `backend/src/services/importJobs.js`
  - `backend/src/websocket.ts`
  - `backend/src/workers/importWorker.ts`
  - `backend/src/workers/mediaWorker.ts`
- Referenced by (0)
  - none

### 3.2 `backend/src/accessControl.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `./config`
- Internal dependencies (1)
  - `backend/src/config/index.js`
- Referenced by (4)
  - `backend/src/middleware.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/system/index.js`
  - `backend/test/accessControl.test.ts`

### 3.3 `backend/src/analytics/duckdbRuntime.ts`

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

### 3.4 `backend/src/authOtpGuards.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `./middleware`
- Internal dependencies (1)
  - `backend/src/middleware.js`
- Referenced by (2)
  - `backend/src/routes/auth.js`
  - `backend/test/authOtpGuards.test.ts`

### 3.5 `backend/src/backupSchema.ts`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `backend/src/routes/system/index.js`
  - `backend/src/services/backupPackages.js`
  - `backend/test/backupSchema.test.ts`

### 3.6 `backend/src/businessMetrics.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `./database.ts`
- Internal dependencies (1)
  - `backend/src/database.ts`
- Referenced by (5)
  - `backend/src/routes/branches.js`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/notifications.ts`
  - `backend/src/routes/products.js`
  - `backend/src/routes/sales.js`

### 3.7 `backend/src/catalogTextIntegrity.ts`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (7)
  - `backend/src/routes/categories.ts`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/runtime.ts`
  - `backend/src/routes/settings.ts`
  - `backend/src/routes/units.ts`
  - `backend/src/services/importJobs.js`

### 3.8 `backend/src/config/index.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../storage/organizationFolders.ts`
  - `dotenv`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `backend/src/storage/organizationFolders.ts`
- Referenced by (25)
  - `backend/server.js`
  - `backend/src/accessControl.ts`
  - `backend/src/analytics/duckdbRuntime.ts`
  - `backend/src/fileAssets.js`
  - `backend/src/middleware.js`
  - `backend/src/objectStore.js`
  - `backend/src/organizationContext/index.ts`
  - `backend/src/postgresDatabase.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/importJobs.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/sync.js`
  - `backend/src/routes/system/index.js`
  - `backend/src/runtimeCache.ts`
  - `backend/src/runtimeState/index.ts`
  - `backend/src/serverUtils.js`
  - `backend/src/services/backupPackages.js`
  - `backend/src/services/googleDriveSync/index.js`
  - `backend/src/services/googleOauth.ts`
  - `backend/src/services/importJobs.js`
  - `backend/src/services/integrationDoctor.js`
  - `backend/src/services/mediaQueue.ts`
  - `backend/src/settingsSnapshot.ts`
  - `backend/test/importJobStateMachine.test.ts`
  - `backend/test/serverUtils.test.ts`

### 3.9 `backend/src/conflictControl.ts`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (12)
  - `backend/src/routes/ai.ts`
  - `backend/src/routes/branches.js`
  - `backend/src/routes/categories.ts`
  - `backend/src/routes/contacts.js`
  - `backend/src/routes/customTables.js`
  - `backend/src/routes/files.ts`
  - `backend/src/routes/products.js`
  - `backend/src/routes/returns.js`
  - `backend/src/routes/sales.js`
  - `backend/src/routes/settings.ts`
  - `backend/src/routes/units.ts`
  - `backend/src/routes/users.js`

### 3.10 `backend/src/contactOptions.ts`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `backend/src/routes/contacts.js`
  - `backend/src/services/importJobs.js`
  - `backend/test/contactOptions.test.ts`

### 3.11 `backend/src/database.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `./postgresDatabase`
- Internal dependencies (1)
  - `backend/src/postgresDatabase.js`
- Referenced by (40)
  - `backend/server.js`
  - `backend/src/businessMetrics.ts`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/organizationContext/index.ts`
  - `backend/src/productBatches.js`
  - `backend/src/routes/actionHistory.ts`
  - `backend/src/routes/ai.ts`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/branches.js`
  - `backend/src/routes/catalog.ts`
  - `backend/src/routes/categories.ts`
  - `backend/src/routes/contacts.js`
  - `backend/src/routes/customTables.js`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/notifications.ts`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/returns.js`
  - `backend/src/routes/runtime.ts`
  - `backend/src/routes/sales.js`
  - `backend/src/routes/settings.ts`
  - `backend/src/routes/system/index.js`
  - `backend/src/routes/units.ts`
  - `backend/src/routes/users.js`
  - `backend/src/schemaMetadata.ts`
  - `backend/src/services/backupPackages.js`
  - `backend/src/services/googleDriveSync/index.js`
  - `backend/src/services/importJobs.js`
  - `backend/src/services/integrationDoctor.js`
  - `backend/src/services/mediaQueue.ts`
  - `backend/src/services/portalAi.js`
  - `backend/src/services/verification.ts`
  - `backend/src/sessionAuth.ts`
  - `backend/src/systemJobs.js`
  - `backend/src/workers/importWorker.ts`
  - `backend/src/workers/mediaWorker.ts`
  - `backend/test/authSecurityFlow.test.ts`
  - `backend/test/fileAssetUsageCache.test.ts`
  - `backend/test/importJobStateMachine.test.ts`

### 3.12 `backend/src/dataPath/index.ts`

- Declared exports: `module.exports`
- Imports (2)
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `backend/src/organizationContext/index.ts`
  - `backend/src/routes/system/index.js`
  - `backend/src/services/googleDriveSync/index.js`
  - `backend/src/systemFsWorker.ts`
  - `backend/test/dataPath.test.ts`

### 3.13 `backend/src/db/cutoverReadiness.ts`

- Declared exports: `module.exports`
- Imports (2)
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/routes/system/index.js`
  - `backend/test/postgresCutoverReadiness.test.ts`

### 3.14 `backend/src/db/postgresQueryCompat.ts`

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
  - `./database.ts`
  - `./objectStore`
  - `./optionalSharp.ts`
  - `./settingsSnapshot.ts`
  - `./uploadReferenceCleanup.ts`
  - `./uploadSecurity.ts`
  - `child_process`
  - `crypto`
  - `fs`
  - `path`
  - `stream/promises`
- Internal dependencies (7)
  - `backend/src/config/index.js`
  - `backend/src/database.ts`
  - `backend/src/objectStore.js`
  - `backend/src/optionalSharp.ts`
  - `backend/src/settingsSnapshot.ts`
  - `backend/src/uploadReferenceCleanup.ts`
  - `backend/src/uploadSecurity.ts`
- Referenced by (15)
  - `backend/server.js`
  - `backend/src/middleware.js`
  - `backend/src/routes/files.ts`
  - `backend/src/routes/importJobs.js`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/settings.ts`
  - `backend/src/routes/system/index.js`
  - `backend/src/routes/users.js`
  - `backend/src/services/importJobs.js`
  - `backend/src/services/mediaQueue.ts`
  - `backend/test/fileAssetStorageReconcile.test.ts`
  - `backend/test/fileAssetUsageCache.test.ts`
  - `backend/test/mediaOptimization.test.ts`
  - `backend/test/uploadSecurity.test.ts`

### 3.16 `backend/src/helpers.js`

- Declared exports: `module.exports`
- Imports (4)
  - `./database.ts`
  - `./requestContext.ts`
  - `./runtimeCache.ts`
  - `./services/googleDriveSync`
- Internal dependencies (4)
  - `backend/src/database.ts`
  - `backend/src/requestContext.ts`
  - `backend/src/runtimeCache.ts`
  - `backend/src/services/googleDriveSync/index.js`
- Referenced by (23)
  - `backend/server.js`
  - `backend/src/routes/actionHistory.ts`
  - `backend/src/routes/ai.ts`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/branches.js`
  - `backend/src/routes/catalog.ts`
  - `backend/src/routes/categories.ts`
  - `backend/src/routes/contacts.js`
  - `backend/src/routes/customTables.js`
  - `backend/src/routes/files.ts`
  - `backend/src/routes/importJobs.js`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/returns.js`
  - `backend/src/routes/runtime.ts`
  - `backend/src/routes/sales.js`
  - `backend/src/routes/settings.ts`
  - `backend/src/routes/system/index.js`
  - `backend/src/routes/units.ts`
  - `backend/src/routes/users.js`
  - `backend/src/services/importJobs.js`
  - `backend/src/websocket.ts`

### 3.17 `backend/src/idempotency.ts`

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

### 3.18 `backend/src/importCsv.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `fs`
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `backend/src/services/importJobs.js`
  - `backend/test/importCsv.test.ts`
  - `backend/test/importScaleSmoke.test.ts`

### 3.19 `backend/src/importParsing.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `./money.ts`
- Internal dependencies (1)
  - `backend/src/money.ts`
- Referenced by (3)
  - `backend/src/productImportPolicies.ts`
  - `backend/test/importCsv.test.ts`
  - `backend/test/importScaleSmoke.test.ts`

### 3.20 `backend/src/initials.ts`

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

### 3.21 `backend/src/maintenanceLock.ts`

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
  - `./accessControl.ts`
  - `./config`
  - `./fileAssets`
  - `./permissions.ts`
  - `./security.ts`
  - `./sessionAuth.ts`
  - `./uploadSecurity.ts`
  - `fs`
  - `multer`
  - `path`
- Internal dependencies (7)
  - `backend/src/accessControl.ts`
  - `backend/src/config/index.js`
  - `backend/src/fileAssets.js`
  - `backend/src/permissions.ts`
  - `backend/src/security.ts`
  - `backend/src/sessionAuth.ts`
  - `backend/src/uploadSecurity.ts`
- Referenced by (24)
  - `backend/server.js`
  - `backend/src/authOtpGuards.ts`
  - `backend/src/routes/actionHistory.ts`
  - `backend/src/routes/ai.ts`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/branches.js`
  - `backend/src/routes/categories.ts`
  - `backend/src/routes/contacts.js`
  - `backend/src/routes/customTables.js`
  - `backend/src/routes/files.ts`
  - `backend/src/routes/importJobs.js`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/notifications.ts`
  - `backend/src/routes/organizations.ts`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/returns.js`
  - `backend/src/routes/runtime.ts`
  - `backend/src/routes/sales.js`
  - `backend/src/routes/settings.ts`
  - `backend/src/routes/sync.js`
  - `backend/src/routes/system/index.js`
  - `backend/src/routes/units.ts`
  - `backend/src/routes/users.js`

### 3.23 `backend/src/money.ts`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `backend/src/importParsing.ts`
  - `backend/src/productDiscounts.ts`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/products.js`
  - `backend/src/services/importJobs.js`

### 3.24 `backend/src/netSecurity.ts`

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
  - `backend/src/settingsSnapshot.ts`

### 3.26 `backend/src/optionalSharp.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/fileAssets.js`
  - `backend/src/uploadSecurity.ts`

### 3.27 `backend/src/organizationContext/index.ts`

- Declared exports: `module.exports`
- Imports (7)
  - `../config`
  - `../dataPath/index.ts`
  - `../database.ts`
  - `../storage/organizationFolders.ts`
  - `crypto`
  - `fs`
  - `path`
- Internal dependencies (4)
  - `backend/src/config/index.js`
  - `backend/src/dataPath/index.ts`
  - `backend/src/database.ts`
  - `backend/src/storage/organizationFolders.ts`
- Referenced by (6)
  - `backend/server.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/organizations.ts`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/system/index.js`
  - `backend/src/routes/users.js`

### 3.28 `backend/src/permissions.ts`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `backend/src/middleware.js`
  - `backend/src/postgresDatabase.js`
  - `backend/src/routes/actionHistory.ts`
  - `backend/test/permissionPolicy.test.ts`

### 3.29 `backend/src/portalUtils.ts`

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
  - `./db/postgresQueryCompat.ts`
  - `./permissions.ts`
  - `bcryptjs`
  - `fs`
  - `path`
  - `pg-native`
- Internal dependencies (3)
  - `backend/src/config/index.js`
  - `backend/src/db/postgresQueryCompat.ts`
  - `backend/src/permissions.ts`
- Referenced by (2)
  - `backend/src/database.ts`
  - `backend/test/postgresDatabase.test.ts`

### 3.31 `backend/src/productBatches.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./database.ts`
- Internal dependencies (1)
  - `backend/src/database.ts`
- Referenced by (6)
  - `backend/server.js`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/returns.js`
  - `backend/src/routes/sales.js`
  - `backend/src/services/importJobs.js`

### 3.32 `backend/src/productDiscounts.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `./money.ts`
- Internal dependencies (1)
  - `backend/src/money.ts`
- Referenced by (3)
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/products.js`
  - `backend/src/services/importJobs.js`

### 3.33 `backend/src/productImportPolicies.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `./importParsing.ts`
- Internal dependencies (1)
  - `backend/src/importParsing.ts`
- Referenced by (3)
  - `backend/src/routes/products.js`
  - `backend/src/services/importJobs.js`
  - `backend/test/productImportPolicies.test.ts`

### 3.34 `backend/src/requestContext.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `async_hooks`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/server.js`
  - `backend/src/helpers.js`

### 3.35 `backend/src/routes/actionHistory.ts`

- Declared exports: `module.exports`
- Imports (5)
  - `../database.ts`
  - `../helpers`
  - `../middleware`
  - `../permissions.ts`
  - `express`
- Internal dependencies (4)
  - `backend/src/database.ts`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/permissions.ts`
- Referenced by (1)
  - `backend/server.js`

### 3.36 `backend/src/routes/ai.ts`

- Declared exports: `module.exports`
- Imports (6)
  - `../conflictControl.ts`
  - `../database.ts`
  - `../helpers`
  - `../middleware`
  - `../services/aiGateway`
  - `express`
- Internal dependencies (5)
  - `backend/src/conflictControl.ts`
  - `backend/src/database.ts`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/services/aiGateway.js`
- Referenced by (1)
  - `backend/server.js`

### 3.37 `backend/src/routes/auth.js`

- Declared exports: `module.exports`
- Imports (18)
  - `../accessControl.ts`
  - `../authOtpGuards.ts`
  - `../config`
  - `../database.ts`
  - `../helpers`
  - `../middleware`
  - `../organizationContext/index.ts`
  - `../runtimeState/index.ts`
  - `../security.ts`
  - `../services/googleOauth.ts`
  - `../services/verification.ts`
  - `../sessionAuth.ts`
  - `../settingsSnapshot.ts`
  - `bcryptjs`
  - `crypto`
  - `express`
  - `qrcode`
  - `speakeasy`
- Internal dependencies (13)
  - `backend/src/accessControl.ts`
  - `backend/src/authOtpGuards.ts`
  - `backend/src/config/index.js`
  - `backend/src/database.ts`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/organizationContext/index.ts`
  - `backend/src/runtimeState/index.ts`
  - `backend/src/security.ts`
  - `backend/src/services/googleOauth.ts`
  - `backend/src/services/verification.ts`
  - `backend/src/sessionAuth.ts`
  - `backend/src/settingsSnapshot.ts`
- Referenced by (2)
  - `backend/server.js`
  - `backend/test/routeContracts.test.ts`

### 3.38 `backend/src/routes/branches.js`

- Declared exports: `module.exports`
- Imports (8)
  - `../businessMetrics.ts`
  - `../conflictControl.ts`
  - `../database.ts`
  - `../helpers`
  - `../middleware`
  - `../schemaMetadata.ts`
  - `crypto`
  - `express`
- Internal dependencies (6)
  - `backend/src/businessMetrics.ts`
  - `backend/src/conflictControl.ts`
  - `backend/src/database.ts`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/schemaMetadata.ts`
- Referenced by (1)
  - `backend/server.js`

### 3.39 `backend/src/routes/catalog.ts`

- Declared exports: `module.exports`
- Imports (4)
  - `../database.ts`
  - `../helpers`
  - `../settingsSnapshot.ts`
  - `express`
- Internal dependencies (3)
  - `backend/src/database.ts`
  - `backend/src/helpers.js`
  - `backend/src/settingsSnapshot.ts`
- Referenced by (2)
  - `backend/server.js`
  - `backend/test/routeContracts.test.ts`

### 3.40 `backend/src/routes/categories.ts`

- Declared exports: `module.exports`
- Imports (6)
  - `../catalogTextIntegrity.ts`
  - `../conflictControl.ts`
  - `../database.ts`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (5)
  - `backend/src/catalogTextIntegrity.ts`
  - `backend/src/conflictControl.ts`
  - `backend/src/database.ts`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
- Referenced by (2)
  - `backend/server.js`
  - `backend/test/routeContracts.test.ts`

### 3.41 `backend/src/routes/contacts.js`

- Declared exports: `module.exports`
- Imports (6)
  - `../conflictControl.ts`
  - `../contactOptions.ts`
  - `../database.ts`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (5)
  - `backend/src/conflictControl.ts`
  - `backend/src/contactOptions.ts`
  - `backend/src/database.ts`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
- Referenced by (1)
  - `backend/server.js`

### 3.42 `backend/src/routes/customTables.js`

- Declared exports: `module.exports`
- Imports (6)
  - `../conflictControl.ts`
  - `../database.ts`
  - `../helpers`
  - `../middleware`
  - `../schemaMetadata.ts`
  - `express`
- Internal dependencies (5)
  - `backend/src/conflictControl.ts`
  - `backend/src/database.ts`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/schemaMetadata.ts`
- Referenced by (1)
  - `backend/server.js`

### 3.43 `backend/src/routes/files.ts`

- Declared exports: `module.exports`
- Imports (6)
  - `../conflictControl.ts`
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `../services/mediaQueue.ts`
  - `express`
- Internal dependencies (5)
  - `backend/src/conflictControl.ts`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/services/mediaQueue.ts`
- Referenced by (2)
  - `backend/server.js`
  - `backend/test/routeContracts.test.ts`

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
  - `../businessMetrics.ts`
  - `../catalogTextIntegrity.ts`
  - `../database.ts`
  - `../helpers`
  - `../idempotency.ts`
  - `../initials.ts`
  - `../middleware`
  - `../money.ts`
  - `../productBatches`
  - `../productDiscounts.ts`
  - `../schemaMetadata.ts`
  - `express`
- Internal dependencies (11)
  - `backend/src/businessMetrics.ts`
  - `backend/src/catalogTextIntegrity.ts`
  - `backend/src/database.ts`
  - `backend/src/helpers.js`
  - `backend/src/idempotency.ts`
  - `backend/src/initials.ts`
  - `backend/src/middleware.js`
  - `backend/src/money.ts`
  - `backend/src/productBatches.js`
  - `backend/src/productDiscounts.ts`
  - `backend/src/schemaMetadata.ts`
- Referenced by (2)
  - `backend/server.js`
  - `backend/test/routeContracts.test.ts`

### 3.46 `backend/src/routes/notifications.ts`

- Declared exports: `module.exports`
- Imports (5)
  - `../businessMetrics.ts`
  - `../database.ts`
  - `../middleware`
  - `../services/googleDriveSync`
  - `express`
- Internal dependencies (4)
  - `backend/src/businessMetrics.ts`
  - `backend/src/database.ts`
  - `backend/src/middleware.js`
  - `backend/src/services/googleDriveSync/index.js`
- Referenced by (3)
  - `backend/server.js`
  - `backend/test/notificationSummaryCache.test.ts`
  - `backend/test/routeContracts.test.ts`

### 3.47 `backend/src/routes/organizations.ts`

- Declared exports: `module.exports`
- Imports (3)
  - `../middleware`
  - `../organizationContext/index.ts`
  - `express`
- Internal dependencies (2)
  - `backend/src/middleware.js`
  - `backend/src/organizationContext/index.ts`
- Referenced by (2)
  - `backend/server.js`
  - `backend/test/routeContracts.test.ts`

### 3.48 `backend/src/routes/portal.js`

- Declared exports: `module.exports`
- Imports (13)
  - `../database.ts`
  - `../fileAssets`
  - `../helpers`
  - `../initials.ts`
  - `../middleware`
  - `../netSecurity.ts`
  - `../organizationContext/index.ts`
  - `../portalUtils.ts`
  - `../runtimeCache.ts`
  - `../security.ts`
  - `../services/portalAi`
  - `../settingsSnapshot.ts`
  - `express`
- Internal dependencies (12)
  - `backend/src/database.ts`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/initials.ts`
  - `backend/src/middleware.js`
  - `backend/src/netSecurity.ts`
  - `backend/src/organizationContext/index.ts`
  - `backend/src/portalUtils.ts`
  - `backend/src/runtimeCache.ts`
  - `backend/src/security.ts`
  - `backend/src/services/portalAi.js`
  - `backend/src/settingsSnapshot.ts`
- Referenced by (2)
  - `backend/server.js`
  - `backend/test/routeContracts.test.ts`

### 3.49 `backend/src/routes/products.js`

- Declared exports: `module.exports`
- Imports (20)
  - `../businessMetrics.ts`
  - `../catalogTextIntegrity.ts`
  - `../config`
  - `../conflictControl.ts`
  - `../database.ts`
  - `../fileAssets`
  - `../helpers`
  - `../idempotency.ts`
  - `../initials.ts`
  - `../middleware`
  - `../money.ts`
  - `../netSecurity.ts`
  - `../productBatches`
  - `../productDiscounts.ts`
  - `../productImportPolicies.ts`
  - `../schemaMetadata.ts`
  - `../settingsSnapshot.ts`
  - `express`
  - `fs`
  - `path`
- Internal dependencies (17)
  - `backend/src/businessMetrics.ts`
  - `backend/src/catalogTextIntegrity.ts`
  - `backend/src/config/index.js`
  - `backend/src/conflictControl.ts`
  - `backend/src/database.ts`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/idempotency.ts`
  - `backend/src/initials.ts`
  - `backend/src/middleware.js`
  - `backend/src/money.ts`
  - `backend/src/netSecurity.ts`
  - `backend/src/productBatches.js`
  - `backend/src/productDiscounts.ts`
  - `backend/src/productImportPolicies.ts`
  - `backend/src/schemaMetadata.ts`
  - `backend/src/settingsSnapshot.ts`
- Referenced by (2)
  - `backend/server.js`
  - `backend/test/routeContracts.test.ts`

### 3.50 `backend/src/routes/returns.js`

- Declared exports: `module.exports`
- Imports (7)
  - `../conflictControl.ts`
  - `../database.ts`
  - `../helpers`
  - `../idempotency.ts`
  - `../middleware`
  - `../productBatches`
  - `express`
- Internal dependencies (6)
  - `backend/src/conflictControl.ts`
  - `backend/src/database.ts`
  - `backend/src/helpers.js`
  - `backend/src/idempotency.ts`
  - `backend/src/middleware.js`
  - `backend/src/productBatches.js`
- Referenced by (1)
  - `backend/server.js`

### 3.51 `backend/src/routes/runtime.ts`

- Declared exports: `module.exports`
- Imports (9)
  - `../catalogTextIntegrity.ts`
  - `../database.ts`
  - `../helpers`
  - `../middleware`
  - `../runtimeCache.ts`
  - `../runtimeVersion.ts`
  - `../services/importJobs`
  - `../services/mediaQueue.ts`
  - `express`
- Internal dependencies (8)
  - `backend/src/catalogTextIntegrity.ts`
  - `backend/src/database.ts`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/runtimeCache.ts`
  - `backend/src/runtimeVersion.ts`
  - `backend/src/services/importJobs.js`
  - `backend/src/services/mediaQueue.ts`
- Referenced by (2)
  - `backend/server.js`
  - `backend/test/routeContracts.test.ts`

### 3.52 `backend/src/routes/sales.js`

- Declared exports: `module.exports`
- Imports (8)
  - `../businessMetrics.ts`
  - `../conflictControl.ts`
  - `../database.ts`
  - `../helpers`
  - `../idempotency.ts`
  - `../middleware`
  - `../productBatches`
  - `express`
- Internal dependencies (7)
  - `backend/src/businessMetrics.ts`
  - `backend/src/conflictControl.ts`
  - `backend/src/database.ts`
  - `backend/src/helpers.js`
  - `backend/src/idempotency.ts`
  - `backend/src/middleware.js`
  - `backend/src/productBatches.js`
- Referenced by (1)
  - `backend/server.js`

### 3.53 `backend/src/routes/settings.ts`

- Declared exports: `module.exports`
- Imports (9)
  - `../catalogTextIntegrity.ts`
  - `../conflictControl.ts`
  - `../database.ts`
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `../schemaMetadata.ts`
  - `../settingsSnapshot.ts`
  - `express`
- Internal dependencies (8)
  - `backend/src/catalogTextIntegrity.ts`
  - `backend/src/conflictControl.ts`
  - `backend/src/database.ts`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/schemaMetadata.ts`
  - `backend/src/settingsSnapshot.ts`
- Referenced by (2)
  - `backend/server.js`
  - `backend/test/routeContracts.test.ts`

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
  - `../../accessControl.ts`
  - `../../analytics/duckdbRuntime.ts`
  - `../../backupSchema.ts`
  - `../../config`
  - `../../dataPath/index.ts`
  - `../../database.ts`
  - `../../db/cutoverReadiness.ts`
  - `../../fileAssets`
  - `../../helpers`
  - `../../maintenanceLock.ts`
  - `../../middleware`
  - `../../objectStore`
  - `../../organizationContext/index.ts`
  - `../../runtimeState/index.ts`
  - `../../security.ts`
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
  - `backend/src/accessControl.ts`
  - `backend/src/analytics/duckdbRuntime.ts`
  - `backend/src/backupSchema.ts`
  - `backend/src/config/index.js`
  - `backend/src/dataPath/index.ts`
  - `backend/src/database.ts`
  - `backend/src/db/cutoverReadiness.ts`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/maintenanceLock.ts`
  - `backend/src/middleware.js`
  - `backend/src/objectStore.js`
  - `backend/src/organizationContext/index.ts`
  - `backend/src/runtimeState/index.ts`
  - `backend/src/security.ts`
  - `backend/src/services/backupPackages.js`
  - `backend/src/services/googleDriveSync/index.js`
  - `backend/src/services/importJobs.js`
  - `backend/src/services/integrationDoctor.js`
  - `backend/src/systemJobs.js`
- Referenced by (2)
  - `backend/server.js`
  - `backend/test/routeContracts.test.ts`

### 3.56 `backend/src/routes/units.ts`

- Declared exports: `module.exports`
- Imports (6)
  - `../catalogTextIntegrity.ts`
  - `../conflictControl.ts`
  - `../database.ts`
  - `../helpers`
  - `../middleware`
  - `express`
- Internal dependencies (5)
  - `backend/src/catalogTextIntegrity.ts`
  - `backend/src/conflictControl.ts`
  - `backend/src/database.ts`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
- Referenced by (2)
  - `backend/server.js`
  - `backend/test/routeContracts.test.ts`

### 3.57 `backend/src/routes/users.js`

- Declared exports: `module.exports`
- Imports (11)
  - `../conflictControl.ts`
  - `../database.ts`
  - `../fileAssets`
  - `../helpers`
  - `../middleware`
  - `../organizationContext/index.ts`
  - `../services/googleOauth.ts`
  - `../services/verification.ts`
  - `../sessionAuth.ts`
  - `bcryptjs`
  - `express`
- Internal dependencies (9)
  - `backend/src/conflictControl.ts`
  - `backend/src/database.ts`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/middleware.js`
  - `backend/src/organizationContext/index.ts`
  - `backend/src/services/googleOauth.ts`
  - `backend/src/services/verification.ts`
  - `backend/src/sessionAuth.ts`
- Referenced by (1)
  - `backend/server.js`

### 3.58 `backend/src/runtimeCache.ts`

- Declared exports: `module.exports`
- Imports (2)
  - `./config`
  - `ioredis`
- Internal dependencies (1)
  - `backend/src/config/index.js`
- Referenced by (4)
  - `backend/src/helpers.js`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/runtime.ts`
  - `backend/test/runtimeCache.test.ts`

### 3.59 `backend/src/runtimeState/index.ts`

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

### 3.60 `backend/src/runtimeVersion.ts`

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
  - `backend/src/routes/runtime.ts`
  - `backend/src/services/googleDriveSync/index.js`
  - `backend/test/runtimeVersion.test.ts`

### 3.61 `backend/src/schemaMetadata.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `./database.ts`
- Internal dependencies (1)
  - `backend/src/database.ts`
- Referenced by (6)
  - `backend/src/routes/branches.js`
  - `backend/src/routes/customTables.js`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/settings.ts`
  - `backend/test/schemaMetadata.test.ts`

### 3.62 `backend/src/security.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `crypto`
- Internal dependencies (0)
  - none
- Referenced by (7)
  - `backend/src/middleware.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/system/index.js`
  - `backend/src/services/aiGateway.js`
  - `backend/src/services/googleDriveSync/index.js`
  - `backend/test/security.test.ts`

### 3.63 `backend/src/serverUtils.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./config`
- Internal dependencies (1)
  - `backend/src/config/index.js`
- Referenced by (4)
  - `backend/server.js`
  - `backend/src/routes/sync.js`
  - `backend/src/websocket.ts`
  - `backend/test/serverUtils.test.ts`

### 3.64 `backend/src/services/aiGateway.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../netSecurity.ts`
  - `../security.ts`
- Internal dependencies (2)
  - `backend/src/netSecurity.ts`
  - `backend/src/security.ts`
- Referenced by (2)
  - `backend/src/routes/ai.ts`
  - `backend/src/services/portalAi.js`

### 3.65 `backend/src/services/backupPackages.js`

- Declared exports: `module.exports`
- Imports (9)
  - `../backupSchema.ts`
  - `../config`
  - `../database.ts`
  - `../objectStore`
  - `crypto`
  - `fs`
  - `path`
  - `stream`
  - `stream/promises`
- Internal dependencies (4)
  - `backend/src/backupSchema.ts`
  - `backend/src/config/index.js`
  - `backend/src/database.ts`
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
  - `../../dataPath/index.ts`
  - `../../database.ts`
  - `../../maintenanceLock.ts`
  - `../../runtimeVersion.ts`
  - `../../security.ts`
  - `../backupPackages`
  - `./versioning.ts`
  - `crypto`
  - `fs`
  - `os`
  - `path`
- Internal dependencies (8)
  - `backend/src/config/index.js`
  - `backend/src/dataPath/index.ts`
  - `backend/src/database.ts`
  - `backend/src/maintenanceLock.ts`
  - `backend/src/runtimeVersion.ts`
  - `backend/src/security.ts`
  - `backend/src/services/backupPackages.js`
  - `backend/src/services/googleDriveSync/versioning.ts`
- Referenced by (4)
  - `backend/src/helpers.js`
  - `backend/src/routes/notifications.ts`
  - `backend/src/routes/system/index.js`
  - `backend/src/services/integrationDoctor.js`

### 3.68 `backend/src/services/googleDriveSync/versioning.ts`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/services/googleDriveSync/index.js`
  - `backend/test/googleDriveSyncVersioning.test.ts`

### 3.69 `backend/src/services/googleOauth.ts`

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
  - `../catalogTextIntegrity.ts`
  - `../config`
  - `../contactOptions.ts`
  - `../database.ts`
  - `../fileAssets`
  - `../helpers`
  - `../importCsv.ts`
  - `../money.ts`
  - `../netSecurity.ts`
  - `../productBatches`
  - `../productDiscounts.ts`
  - `../productImportPolicies.ts`
  - `../uploadSecurity.ts`
  - `./mediaQueue.ts`
  - `bullmq`
  - `crypto`
  - `fs`
  - `ioredis`
  - `path`
  - `yauzl`
- Internal dependencies (14)
  - `backend/src/catalogTextIntegrity.ts`
  - `backend/src/config/index.js`
  - `backend/src/contactOptions.ts`
  - `backend/src/database.ts`
  - `backend/src/fileAssets.js`
  - `backend/src/helpers.js`
  - `backend/src/importCsv.ts`
  - `backend/src/money.ts`
  - `backend/src/netSecurity.ts`
  - `backend/src/productBatches.js`
  - `backend/src/productDiscounts.ts`
  - `backend/src/productImportPolicies.ts`
  - `backend/src/services/mediaQueue.ts`
  - `backend/src/uploadSecurity.ts`
- Referenced by (7)
  - `backend/server.js`
  - `backend/src/routes/importJobs.js`
  - `backend/src/routes/runtime.ts`
  - `backend/src/routes/system/index.js`
  - `backend/src/services/integrationDoctor.js`
  - `backend/src/workers/importWorker.ts`
  - `backend/test/importJobStateMachine.test.ts`

### 3.71 `backend/src/services/integrationDoctor.js`

- Declared exports: `module.exports`
- Imports (10)
  - `../analytics/duckdbRuntime.ts`
  - `../config`
  - `../database.ts`
  - `../objectStore`
  - `./backupPackages`
  - `./googleDriveSync`
  - `./googleOauth.ts`
  - `./importJobs`
  - `fs`
  - `path`
- Internal dependencies (8)
  - `backend/src/analytics/duckdbRuntime.ts`
  - `backend/src/config/index.js`
  - `backend/src/database.ts`
  - `backend/src/objectStore.js`
  - `backend/src/services/backupPackages.js`
  - `backend/src/services/googleDriveSync/index.js`
  - `backend/src/services/googleOauth.ts`
  - `backend/src/services/importJobs.js`
- Referenced by (2)
  - `backend/src/routes/system/index.js`
  - `backend/test/integrationDoctor.test.ts`

### 3.72 `backend/src/services/mediaQueue.ts`

- Declared exports: `module.exports`
- Imports (5)
  - `../config`
  - `../database.ts`
  - `../fileAssets`
  - `bullmq`
  - `ioredis`
- Internal dependencies (3)
  - `backend/src/config/index.js`
  - `backend/src/database.ts`
  - `backend/src/fileAssets.js`
- Referenced by (5)
  - `backend/src/routes/files.ts`
  - `backend/src/routes/runtime.ts`
  - `backend/src/services/importJobs.js`
  - `backend/src/workers/mediaWorker.ts`
  - `backend/test/importJobStateMachine.test.ts`

### 3.73 `backend/src/services/portalAi.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../database.ts`
  - `./aiGateway`
- Internal dependencies (2)
  - `backend/src/database.ts`
  - `backend/src/services/aiGateway.js`
- Referenced by (1)
  - `backend/src/routes/portal.js`

### 3.74 `backend/src/services/verification.ts`

- Declared exports: `module.exports`
- Imports (2)
  - `../database.ts`
  - `crypto`
- Internal dependencies (1)
  - `backend/src/database.ts`
- Referenced by (2)
  - `backend/src/routes/auth.js`
  - `backend/src/routes/users.js`

### 3.75 `backend/src/sessionAuth.ts`

- Declared exports: `module.exports`
- Imports (2)
  - `./database.ts`
  - `crypto`
- Internal dependencies (1)
  - `backend/src/database.ts`
- Referenced by (4)
  - `backend/src/middleware.js`
  - `backend/src/routes/auth.js`
  - `backend/src/routes/users.js`
  - `backend/src/websocket.ts`

### 3.76 `backend/src/settingsSnapshot.ts`

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
  - `backend/src/routes/catalog.ts`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/settings.ts`
  - `backend/src/uploadReferenceCleanup.ts`
  - `backend/test/settingsSnapshotObjectStorage.test.ts`

### 3.77 `backend/src/storage/organizationFolders.ts`

- Declared exports: `module.exports`
- Imports (2)
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/config/index.js`
  - `backend/src/organizationContext/index.ts`

### 3.78 `backend/src/systemFsWorker.ts`

- Declared exports: none detected
- Imports (3)
  - `./dataPath/index.ts`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `backend/src/dataPath/index.ts`
- Referenced by (0)
  - none

### 3.79 `backend/src/systemJobs.js`

- Declared exports: `module.exports`
- Imports (2)
  - `./database.ts`
  - `crypto`
- Internal dependencies (1)
  - `backend/src/database.ts`
- Referenced by (2)
  - `backend/src/routes/system/index.js`
  - `backend/test/systemJobs.test.ts`

### 3.80 `backend/src/uploadReferenceCleanup.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `./settingsSnapshot.ts`
- Internal dependencies (1)
  - `backend/src/settingsSnapshot.ts`
- Referenced by (2)
  - `backend/src/fileAssets.js`
  - `backend/test/settingsSnapshotObjectStorage.test.ts`

### 3.81 `backend/src/uploadSecurity.ts`

- Declared exports: `module.exports`
- Imports (2)
  - `./optionalSharp.ts`
  - `fs`
- Internal dependencies (1)
  - `backend/src/optionalSharp.ts`
- Referenced by (4)
  - `backend/src/fileAssets.js`
  - `backend/src/middleware.js`
  - `backend/src/services/importJobs.js`
  - `backend/test/uploadSecurity.test.ts`

### 3.82 `backend/src/websocket.ts`

- Declared exports: `module.exports`
- Imports (5)
  - `./helpers`
  - `./serverUtils`
  - `./sessionAuth.ts`
  - `http`
  - `ws`
- Internal dependencies (3)
  - `backend/src/helpers.js`
  - `backend/src/serverUtils.js`
  - `backend/src/sessionAuth.ts`
- Referenced by (2)
  - `backend/server.js`
  - `backend/test/websocket.test.ts`

### 3.83 `backend/src/workers/importWorker.ts`

- Declared exports: `module.exports`
- Imports (2)
  - `../database.ts`
  - `../services/importJobs`
- Internal dependencies (2)
  - `backend/src/database.ts`
  - `backend/src/services/importJobs.js`
- Referenced by (1)
  - `backend/server.js`

### 3.84 `backend/src/workers/mediaWorker.ts`

- Declared exports: `module.exports`
- Imports (2)
  - `../database.ts`
  - `../services/mediaQueue.ts`
- Internal dependencies (2)
  - `backend/src/database.ts`
  - `backend/src/services/mediaQueue.ts`
- Referenced by (1)
  - `backend/server.js`

### 3.85 `backend/test/accessControl.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/accessControl.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/accessControl.ts`
- Referenced by (0)
  - none

### 3.86 `backend/test/analyticsRuntime.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/analytics/duckdbRuntime.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/analytics/duckdbRuntime.ts`
- Referenced by (0)
  - none

### 3.87 `backend/test/authOtpGuards.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/authOtpGuards.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/authOtpGuards.ts`
- Referenced by (0)
  - none

### 3.88 `backend/test/authSecurityFlow.test.ts`

- Declared exports: none detected
- Imports (8)
  - `../src/database.ts`
  - `bcryptjs`
  - `child_process`
  - `fs`
  - `net`
  - `node:assert/strict`
  - `os`
  - `path`
- Internal dependencies (1)
  - `backend/src/database.ts`
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
  - `../src/backupSchema.ts`
  - `node:assert/strict`
  - `node:fs`
  - `node:path`
- Internal dependencies (1)
  - `backend/src/backupSchema.ts`
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
  - `../src/contactOptions.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/contactOptions.ts`
- Referenced by (0)
  - none

### 3.95 `backend/test/dataPath.test.ts`

- Declared exports: none detected
- Imports (5)
  - `../src/dataPath/index.ts`
  - `fs`
  - `node:assert/strict`
  - `os`
  - `path`
- Internal dependencies (1)
  - `backend/src/dataPath/index.ts`
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
  - `../src/database.ts`
  - `../src/fileAssets`
  - `node:assert/strict`
- Internal dependencies (2)
  - `backend/src/database.ts`
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
  - `../src/services/googleDriveSync/versioning.ts`
  - `node:assert/strict`
  - `node:fs`
  - `node:path`
- Internal dependencies (1)
  - `backend/src/services/googleDriveSync/versioning.ts`
- Referenced by (0)
  - none

### 3.102 `backend/test/idempotency.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/idempotency.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/idempotency.ts`
- Referenced by (0)
  - none

### 3.103 `backend/test/importCsv.test.ts`

- Declared exports: none detected
- Imports (6)
  - `../src/importCsv.ts`
  - `../src/importParsing.ts`
  - `fs`
  - `node:assert/strict`
  - `os`
  - `path`
- Internal dependencies (2)
  - `backend/src/importCsv.ts`
  - `backend/src/importParsing.ts`
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
  - `../src/database.ts`
  - `../src/services/importJobs`
  - `../src/services/mediaQueue.ts`
  - `fs`
  - `node:assert/strict`
  - `os`
  - `path`
- Internal dependencies (4)
  - `backend/src/config/index.js`
  - `backend/src/database.ts`
  - `backend/src/services/importJobs.js`
  - `backend/src/services/mediaQueue.ts`
- Referenced by (0)
  - none

### 3.107 `backend/test/importScaleSmoke.test.ts`

- Declared exports: none detected
- Imports (6)
  - `../src/importCsv.ts`
  - `../src/importParsing.ts`
  - `fs`
  - `node:assert/strict`
  - `os`
  - `path`
- Internal dependencies (2)
  - `backend/src/importCsv.ts`
  - `backend/src/importParsing.ts`
- Referenced by (0)
  - none

### 3.108 `backend/test/initials.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/initials.ts`
  - `assert`
- Internal dependencies (1)
  - `backend/src/initials.ts`
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
  - `../src/netSecurity.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/netSecurity.ts`
- Referenced by (0)
  - none

### 3.113 `backend/test/notificationSummaryCache.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/routes/notifications.ts`
  - `assert`
- Internal dependencies (1)
  - `backend/src/routes/notifications.ts`
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
  - `../src/services/googleOauth.ts`
  - `node:assert/strict`
  - `node:fs`
  - `node:path`
- Internal dependencies (1)
  - `backend/src/services/googleOauth.ts`
- Referenced by (0)
  - none

### 3.116 `backend/test/permissionPolicy.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/permissions.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/permissions.ts`
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
  - `../src/portalUtils.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/portalUtils.ts`
- Referenced by (0)
  - none

### 3.119 `backend/test/postgresCutoverReadiness.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/db/cutoverReadiness.ts`
  - `node:assert/strict`
  - `path`
- Internal dependencies (1)
  - `backend/src/db/cutoverReadiness.ts`
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
  - `../src/db/postgresQueryCompat.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/db/postgresQueryCompat.ts`
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
  - `../src/productImportPolicies.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/productImportPolicies.ts`
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
- Imports (18)
  - `../src/routes/auth`
  - `../src/routes/catalog.ts`
  - `../src/routes/categories.ts`
  - `../src/routes/files.ts`
  - `../src/routes/inventory`
  - `../src/routes/notifications.ts`
  - `../src/routes/organizations.ts`
  - `../src/routes/portal`
  - `../src/routes/products`
  - `../src/routes/runtime.ts`
  - `../src/routes/settings.ts`
  - `../src/routes/system`
  - `../src/routes/units.ts`
  - `fs`
  - `node:assert/strict`
  - `node:fs`
  - `node:path`
  - `path`
- Internal dependencies (13)
  - `backend/src/routes/auth.js`
  - `backend/src/routes/catalog.ts`
  - `backend/src/routes/categories.ts`
  - `backend/src/routes/files.ts`
  - `backend/src/routes/inventory.js`
  - `backend/src/routes/notifications.ts`
  - `backend/src/routes/organizations.ts`
  - `backend/src/routes/portal.js`
  - `backend/src/routes/products.js`
  - `backend/src/routes/runtime.ts`
  - `backend/src/routes/settings.ts`
  - `backend/src/routes/system/index.js`
  - `backend/src/routes/units.ts`
- Referenced by (0)
  - none

### 3.128 `backend/test/runtimeCache.test.ts`

- Declared exports: none detected
- Imports (5)
  - `../src/runtimeCache.ts`
  - `fs`
  - `node:assert/strict`
  - `os`
  - `path`
- Internal dependencies (1)
  - `backend/src/runtimeCache.ts`
- Referenced by (0)
  - none

### 3.129 `backend/test/runtimeVersion.test.ts`

- Declared exports: none detected
- Imports (5)
  - `../src/runtimeVersion.ts`
  - `fs`
  - `node:assert/strict`
  - `os`
  - `path`
- Internal dependencies (1)
  - `backend/src/runtimeVersion.ts`
- Referenced by (0)
  - none

### 3.130 `backend/test/schemaMetadata.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/schemaMetadata.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/schemaMetadata.ts`
- Referenced by (0)
  - none

### 3.131 `backend/test/security.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/security.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/security.ts`
- Referenced by (0)
  - none

### 3.132 `backend/test/serverUtils.test.ts`

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

### 3.133 `backend/test/settingsSnapshotObjectStorage.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/settingsSnapshot.ts`
  - `../src/uploadReferenceCleanup.ts`
  - `node:assert/strict`
- Internal dependencies (2)
  - `backend/src/settingsSnapshot.ts`
  - `backend/src/uploadReferenceCleanup.ts`
- Referenced by (0)
  - none

### 3.134 `backend/test/systemJobs.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/systemJobs`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/systemJobs.js`
- Referenced by (0)
  - none

### 3.135 `backend/test/uploadSecurity.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/fileAssets`
  - `../src/uploadSecurity.ts`
  - `node:assert/strict`
- Internal dependencies (2)
  - `backend/src/fileAssets.js`
  - `backend/src/uploadSecurity.ts`
- Referenced by (0)
  - none

### 3.136 `backend/test/websocket.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/websocket.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/websocket.ts`
- Referenced by (0)
  - none

### 3.137 `frontend/public/runtime-noise-guard.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.138 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.139 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.worker.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.140 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd-threads.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.141 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.142 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.143 `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.144 `frontend/public/sw.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.145 `frontend/public/theme-bootstrap.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.146 `frontend/src/api/http.ts`

- Declared exports: `FRONTEND_BUILD_INFO`, `__resetApiWriteDedupeForTests`, `apiFetch`, `buildApiRequestDedupeKey`, `cacheClearAll`, `cacheGet`, `cacheGetStale`, `cacheInvalidate`, `cacheSet`, `clearCallLog`, `createApiVersionMismatchError`, `getApiVersionMismatchCooldown`, `getCallLog`, `getSyncServerUrl`, `getSyncToken`, `isApiVersionMismatchError`, `isCloudflareAccessRedirectResponse`, `isInvalidSessionError`, `isNetErr`, `isReachableServerResponseStatus`, `isRequiredRuntimeApiPath`, `isServerOnline`, `isTransientGatewayError`, `isWriteBlockedError`, `isWriteConflictError`, `markApiVersionMismatch`, `requireLiveServerWrite`, `route`, `setSyncServerUrl`, `setSyncToken`, `shouldCompareRuntimeVersions`, `startHealthCheck`
- Imports (2)
  - `../constants.ts`
  - `../utils/deviceInfo.ts`
- Internal dependencies (2)
  - `frontend/src/constants.ts`
  - `frontend/src/utils/deviceInfo.ts`
- Referenced by (8)
  - `frontend/src/api/websocket.ts`
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/dashboard/Dashboard.tsx`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/products/Products.tsx`
  - `frontend/src/components/shared/BackgroundImportTracker.tsx`
  - `frontend/src/utils/publicAssetUrls.ts`
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
- Referenced by (3)
  - `frontend/src/api/methods.ts`
  - `frontend/src/platform/runtime/clientRuntime.ts`
  - `frontend/src/web-api.ts`

### 3.148 `frontend/src/api/methods.ts`

- Declared exports: `adjustStock`, `applyRfidSession`, `approveImportJob`, `askPortalAi`, `attachSaleCustomer`, `browseDir`, `bulkImportCustomers`, `bulkImportDeliveryContacts`, `bulkImportProducts`, `bulkImportSuppliers`, `cancelImportJob`, `cancelSystemJob`, `changeUserPassword`, `completeGoogleOauth`, `completePasswordReset`, `createActionHistory`, `createAiProvider`, `createBranch`, `createCategory`, `createCustomTable`, `createCustomer`, `createDeliveryContact`, `createImportJob`, `createPortalSubmission`, `createProduct`, `createProductVariant`, `createReturn`, `createRfidSession`, `createRfidTag`, `createRole`, `createSale`, `createSupplier`, `createSupplierReturn`, `createUnit`, `createUser`, `deleteAiProvider`, `deleteAuditLogsRetention`, `deleteBranch`, `deleteCategory`, `deleteCustomRow`, `deleteCustomer`, `deleteDeliveryContact`, `deleteFileAsset`, `deleteImportJob`, `deleteProduct`, `deleteRole`, `deleteSupplier`, `deleteUnit`, `discardPendingSyncQueue`, `disconnectGoogleDriveSync`, `disconnectUserAuthProvider`, `downloadCustomerTemplate`, `downloadImportJobErrors`, `downloadImportTemplate`, `downloadSupplierTemplate`, `exportBackupFolder`, `factoryReset`, `forgetGoogleDriveSyncCredentials`, `getActionHistory`, `getAiProviders`, `getAiResponses`, `getAnalytics`, `getAppBootstrap`, `getAuditLogs`, `getBranchStock`, `getBranchStockIntegrity`, `getBranchSummary`, `getBranches`, `getCatalogMeta`, `getCatalogProducts`, `getCategories`, `getCurrentOrganization`, `getCustomTableData`, `getCustomTables`, `getCustomerPointSummaries`, `getCustomers`, `getDashboard`, `getDataPath`, `getDeliveryContacts`, `getFiles`, `getGoogleDriveSyncStatus`, `getImageDataUrl`, `getImportJob`, `getImportJobReview`, `getImportQueueStatus`, `getIntegrationDoctor`, `getInventoryMovements`, `getInventoryReasons`, `getInventoryStats`, `getInventorySummary`, `getNotificationSummary`, `getOrganizationBootstrap`, `getPendingSyncState`, `getPortalAiStatus`, `getPortalBootstrap`, `getPortalCatalogMeta`, `getPortalCatalogProducts`, `getPortalConfig`, `getPortalSubmissionsForReview`, `getProductFilters`, `getProductLookupUsage`, `getProducts`, `getProductsByIds`, `getReturn`, `getReturns`, `getRfidSessionReview`, `getRfidStatus`, `getRoles`, `getSales`, `getSalesExport`, `getScaleMigrationStatus`, `getSettings`, `getSuppliers`, `getSystemConfig`, `getSystemDebugLog`, `getSystemJob`, `getTransfers`, `getUnits`, `getUserAuthMethods`, `getUserProfile`, `getUsers`, `getVerificationCapabilities`, `importBackupFolder`, `insertCustomRow`, `listImportJobs`, `login`, `logout`, `lookupPortalMembership`, `moveStockRow`, `openCSVDialog`, `openFolderDialog`, `openImageDialog`, `openPath`, `otpConfirm`, `otpDisable`, `otpSetup`, `otpStatus`, `otpVerify`, `pollSystemJob`, `preflightImportJob`, `prepareScaleMigration`, `queueBackupFolderExport`, `queueBackupFolderRestore`, `queueGoogleDriveSyncNow`, `recordRfidSessionEvents`, `redoActionHistory`, `refreshOfflineDeviceSnapshot`, `repairBranchStockIntegrity`, `replaceProductLookupValues`, `requestPasswordResetEmail`, `resetData`, `resetDataPath`, `resetPassword`, `resetPasswordWithOtp`, `retryImportJob`, `retryPendingSyncNow`, `reviewPortalSubmission`, `runScaleMigration`, `saveGoogleDriveSyncPreferences`, `saveInventoryReasons`, `saveSettings`, `searchInventoryProducts`, `searchOrganizations`, `searchPortalCatalogProducts`, `searchProducts`, `searchRfidTags`, `setDataPath`, `startGoogleDriveSyncOauth`, `startGoogleOauth`, `startImportJob`, `syncGoogleDriveNow`, `testAiProvider`, `testSyncServer`, `transferInventoryStock`, `transferStock`, `undoActionHistory`, `unlinkGoogleOauth`, `updateActionHistory`, `updateAiProvider`, `updateBranch`, `updateCategory`, `updateCustomRow`, `updateCustomer`, `updateDeliveryContact`, `updateImportJobDecisions`, `updateProduct`, `updateReturn`, `updateRole`, `updateSaleStatus`, `updateSessionDuration`, `updateSupplier`, `updateUnit`, `updateUser`, `updateUserProfile`, `uploadFileAsset`, `uploadImportJobCsv`, `uploadImportJobImages`, `uploadImportJobZip`, `uploadProductImage`, `uploadUserAvatar`
- Imports (6)
  - `../constants`
  - `../platform/runtime/clientRuntime.ts`
  - `../utils/appRefresh.ts`
  - `../utils/csvImport.ts`
  - `../utils/deviceInfo.ts`
  - `./localDb.ts`
- Internal dependencies (6)
  - `frontend/src/api/localDb.ts`
  - `frontend/src/constants.ts`
  - `frontend/src/platform/runtime/clientRuntime.ts`
  - `frontend/src/utils/appRefresh.ts`
  - `frontend/src/utils/csvImport.ts`
  - `frontend/src/utils/deviceInfo.ts`
- Referenced by (1)
  - `frontend/src/web-api.ts`

### 3.149 `frontend/src/api/websocket.ts`

- Declared exports: `connectWS`, `disconnectWS`, `isWSConnected`, `reconnectWS`
- Imports (2)
  - `../constants.ts`
  - `./http.ts`
- Internal dependencies (2)
  - `frontend/src/api/http.ts`
  - `frontend/src/constants.ts`
- Referenced by (2)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/web-api.ts`

### 3.150 `frontend/src/App.tsx`

- Declared exports: `function`
- Imports (32)
  - `./AppContext.tsx`
  - `./app/appShellUtils.ts`
  - `./app/publicErrorRecovery.ts`
  - `./components/auth/Login`
  - `./components/branches/Branches`
  - `./components/catalog/CatalogPage.tsx`
  - `./components/contacts/Contacts`
  - `./components/dashboard/Dashboard`
  - `./components/files/FilesPage`
  - `./components/inventory/Inventory.tsx`
  - `./components/loyalty-points/LoyaltyPointsPage`
  - `./components/navigation/Sidebar`
  - `./components/pos/POS.tsx`
  - `./components/products/Products.tsx`
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
  - `frontend/src/AppContext.tsx`
  - `frontend/src/app/appShellUtils.ts`
  - `frontend/src/app/publicErrorRecovery.ts`
  - `frontend/src/components/auth/Login.tsx`
  - `frontend/src/components/branches/Branches.tsx`
  - `frontend/src/components/catalog/CatalogPage.tsx`
  - `frontend/src/components/contacts/Contacts.tsx`
  - `frontend/src/components/dashboard/Dashboard.tsx`
  - `frontend/src/components/files/FilesPage.tsx`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx`
  - `frontend/src/components/navigation/Sidebar.tsx`
  - `frontend/src/components/pos/POS.tsx`
  - `frontend/src/components/products/Products.tsx`
  - `frontend/src/components/receipt-settings/ReceiptSettings.tsx`
  - `frontend/src/components/returns/Returns.tsx`
  - `frontend/src/components/sales/Sales.tsx`
  - `frontend/src/components/server/ServerPage.tsx`
  - `frontend/src/components/shared/BackgroundImportTracker.tsx`
  - `frontend/src/components/shared/NotificationCenter.tsx`
  - `frontend/src/components/shared/QuickPreferenceToggles.tsx`
  - `frontend/src/components/shared/WriteConflictModal.tsx`
  - `frontend/src/components/shared/globalScroll.ts`
  - `frontend/src/components/users/Users.tsx`
  - `frontend/src/components/utils-settings/AuditLog.tsx`
  - `frontend/src/components/utils-settings/Backup.tsx`
  - `frontend/src/components/utils-settings/Settings.tsx`
  - `frontend/src/utils/favicon.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/index.tsx`

### 3.151 `frontend/src/app/appShellUtils.ts`

- Declared exports: `APP_NAVIGATION_EVENT`, `APP_PAGE_INTENT_EVENT`, `DESKTOP_WARMUP_BREAKPOINT`, `MAX_MOUNTED_PAGES`, `MOBILE_MAX_MOUNTED_PAGES`, `MOBILE_SHELL_BREAKPOINT`, `getAdminPageFromPath`, `getAdminPathForPage`, `getMountedPageLimit`, `getNotificationColor`, `getNotificationPrefix`, `isAdminAppPath`, `isPublicCatalogPath`, `normalizeAppPath`, `shouldWarmPageEntries`, `updateMountedPages`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `frontend/src/App.tsx`
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/navigation/Sidebar.tsx`
  - `frontend/src/index.tsx`
  - `frontend/tests/appShellUtils.test.ts`

### 3.152 `frontend/src/app/publicErrorRecovery.ts`

- Declared exports: `clearPublicDomRecoveryMarker`, `isPublicDomMutationError`, `shouldAttemptPublicDomRecovery`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.153 `frontend/src/AppContext.tsx`

- Declared exports: `AppProvider`, `isBrokenLocalizedString`, `useApp`, `useSync`, `useT`
- Imports (15)
  - `./api/http.ts`
  - `./api/websocket.ts`
  - `./app/appShellUtils.ts`
  - `./constants`
  - `./lang/en.json`
  - `./lang/km.json`
  - `./types/settingsContracts.ts`
  - `./utils/appRefresh.ts`
  - `./utils/deviceInfo.ts`
  - `./utils/loaders.ts`
  - `./utils/permissions.ts`
  - `./utils/pricing.ts`
  - `./utils/settingsWriteOptions.ts`
  - `./web-api.ts`
  - `react`
- Internal dependencies (14)
  - `frontend/src/api/http.ts`
  - `frontend/src/api/websocket.ts`
  - `frontend/src/app/appShellUtils.ts`
  - `frontend/src/constants.ts`
  - `frontend/src/lang/en.json`
  - `frontend/src/lang/km.json`
  - `frontend/src/types/settingsContracts.ts`
  - `frontend/src/utils/appRefresh.ts`
  - `frontend/src/utils/deviceInfo.ts`
  - `frontend/src/utils/loaders.ts`
  - `frontend/src/utils/permissions.ts`
  - `frontend/src/utils/pricing.ts`
  - `frontend/src/utils/settingsWriteOptions.ts`
  - `frontend/src/web-api.ts`
- Referenced by (52)
  - `frontend/src/App.tsx`
  - `frontend/src/components/auth/Login.tsx`
  - `frontend/src/components/branches/Branches.tsx`
  - `frontend/src/components/branches/BranchForm.tsx`
  - `frontend/src/components/branches/TransferModal.tsx`
  - `frontend/src/components/catalog/CatalogPage.tsx`
  - `frontend/src/components/contacts/ContactImportModal.tsx`
  - `frontend/src/components/contacts/Contacts.tsx`
  - `frontend/src/components/contacts/CustomersTab.tsx`
  - `frontend/src/components/contacts/DeliveryTab.tsx`
  - `frontend/src/components/contacts/shared.tsx`
  - `frontend/src/components/contacts/SuppliersTab.tsx`
  - `frontend/src/components/custom-tables/CustomTables.tsx`
  - `frontend/src/components/dashboard/charts/NoData.tsx`
  - `frontend/src/components/dashboard/Dashboard.tsx`
  - `frontend/src/components/files/FilePickerModal.tsx`
  - `frontend/src/components/files/FilesPage.tsx`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/inventory/InventoryImportModal.tsx`
  - `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx`
  - `frontend/src/components/navigation/Sidebar.tsx`
  - `frontend/src/components/pos/POS.tsx`
  - `frontend/src/components/products/forms/VariantFormModal.tsx`
  - `frontend/src/components/products/lookups/ManageBrandsModal.tsx`
  - `frontend/src/components/products/lookups/ManageCategoriesModal.tsx`
  - `frontend/src/components/products/lookups/ManageUnitsModal.tsx`
  - `frontend/src/components/products/Products.tsx`
  - `frontend/src/components/receipt-settings/AllFieldsPanel.tsx`
  - `frontend/src/components/receipt-settings/ReceiptSettings.tsx`
  - `frontend/src/components/receipt/Receipt.tsx`
  - `frontend/src/components/returns/EditReturnModal.tsx`
  - `frontend/src/components/returns/NewReturnModal.tsx`
  - `frontend/src/components/returns/NewSupplierReturnModal.tsx`
  - `frontend/src/components/returns/ReturnDetailModal.tsx`
  - `frontend/src/components/returns/Returns.tsx`
  - `frontend/src/components/sales/Sales.tsx`
  - `frontend/src/components/sales/SalesImportModal.tsx`
  - `frontend/src/components/server/ServerPage.tsx`
  - `frontend/src/components/shared/ActionHistoryBar.tsx`
  - `frontend/src/components/shared/BackgroundImportTracker.tsx`
  - `frontend/src/components/shared/NotificationCenter.tsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/components/shared/QuickPreferenceToggles.tsx`
  - `frontend/src/components/users/UserProfileModal.tsx`
  - `frontend/src/components/users/Users.tsx`
  - `frontend/src/components/utils-settings/AuditLog.tsx`
  - `frontend/src/components/utils-settings/Backup.tsx`
  - `frontend/src/components/utils-settings/OtpModal.tsx`
  - `frontend/src/components/utils-settings/ResetData.tsx`
  - `frontend/src/components/utils-settings/Settings.tsx`
  - `frontend/src/index.tsx`
  - `frontend/src/utils/actionHistory.ts`

### 3.154 `frontend/src/components/auth/Login.tsx`

- Declared exports: `function`
- Imports (5)
  - `../../AppContext.tsx`
  - `../../constants`
  - `../../utils/deviceInfo.ts`
  - `../shared/QuickPreferenceToggles`
  - `react`
- Internal dependencies (4)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/shared/QuickPreferenceToggles.tsx`
  - `frontend/src/constants.ts`
  - `frontend/src/utils/deviceInfo.ts`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.155 `frontend/src/components/branches/Branches.tsx`

- Declared exports: `function`
- Imports (13)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../../utils/actionHistory.ts`
  - `../../utils/bulkOps.ts`
  - `../../utils/historyHelpers.ts`
  - `../shared/ActionHistoryBar`
  - `../shared/Modal`
  - `../shared/PageHeader`
  - `../shared/pageActivity`
  - `./BranchForm`
  - `./TransferModal`
  - `lucide-react`
  - `react`
- Internal dependencies (11)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/branches/BranchForm.tsx`
  - `frontend/src/components/branches/TransferModal.tsx`
  - `frontend/src/components/shared/ActionHistoryBar.tsx`
  - `frontend/src/components/shared/Modal.tsx`
  - `frontend/src/components/shared/PageHeader.tsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/utils/bulkOps.ts`
  - `frontend/src/utils/historyHelpers.ts`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.156 `frontend/src/components/branches/BranchForm.tsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext.tsx`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.tsx`
- Referenced by (1)
  - `frontend/src/components/branches/Branches.tsx`

### 3.157 `frontend/src/components/branches/TransferModal.tsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `react`
- Internal dependencies (2)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/utils/actionGuards.ts`
- Referenced by (1)
  - `frontend/src/components/branches/Branches.tsx`

### 3.158 `frontend/src/components/catalog/CatalogEditorSurface.tsx`

- Declared exports: `function`
- Imports (7)
  - `../../utils/mediaUpload.ts`
  - `../products/shared/primitives`
  - `./CatalogImageField`
  - `./CatalogPageContext`
  - `./catalogUi`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `frontend/src/components/catalog/CatalogImageField.tsx`
  - `frontend/src/components/catalog/CatalogPageContext.tsx`
  - `frontend/src/components/catalog/catalogUi.tsx`
  - `frontend/src/components/products/shared/primitives.tsx`
  - `frontend/src/utils/mediaUpload.ts`
- Referenced by (1)
  - `frontend/src/components/catalog/CatalogPage.tsx`

### 3.159 `frontend/src/components/catalog/CatalogImageField.tsx`

- Declared exports: `function`
- Imports (2)
  - `../../utils/mediaUpload.ts`
  - `lucide-react`
- Internal dependencies (1)
  - `frontend/src/utils/mediaUpload.ts`
- Referenced by (1)
  - `frontend/src/components/catalog/CatalogEditorSurface.tsx`

### 3.160 `frontend/src/components/catalog/CatalogPage.tsx`

- Declared exports: `function`
- Imports (14)
  - `../../AppContext`
  - `../../utils/actionGuards.ts`
  - `../../utils/favicon`
  - `../../utils/initials.ts`
  - `../products/shared/primitives`
  - `../shared/pageActivity`
  - `./CatalogEditorSurface`
  - `./CatalogPageContext`
  - `./CatalogPreviewSurface`
  - `./CatalogProductsSection`
  - `./CatalogSecondaryTabs`
  - `./catalogUi`
  - `lucide-react`
  - `react`
- Internal dependencies (12)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/catalog/CatalogEditorSurface.tsx`
  - `frontend/src/components/catalog/CatalogPageContext.tsx`
  - `frontend/src/components/catalog/CatalogPreviewSurface.tsx`
  - `frontend/src/components/catalog/CatalogProductsSection.tsx`
  - `frontend/src/components/catalog/CatalogSecondaryTabs.tsx`
  - `frontend/src/components/catalog/catalogUi.tsx`
  - `frontend/src/components/products/shared/primitives.tsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/favicon.ts`
  - `frontend/src/utils/initials.ts`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.161 `frontend/src/components/catalog/CatalogPageContext.tsx`

- Declared exports: `CatalogPageProvider`, `useCatalogPageContext`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/catalog/CatalogEditorSurface.tsx`
  - `frontend/src/components/catalog/CatalogPage.tsx`

### 3.162 `frontend/src/components/catalog/CatalogPreviewSurface.tsx`

- Declared exports: `function`
- Imports (6)
  - `../files/FilePickerModal`
  - `../products/shared/primitives`
  - `../shared/ImageGalleryLightbox`
  - `../shared/PortalMenu`
  - `lucide-react`
  - `react`
- Internal dependencies (4)
  - `frontend/src/components/files/FilePickerModal.tsx`
  - `frontend/src/components/products/shared/primitives.tsx`
  - `frontend/src/components/shared/ImageGalleryLightbox.tsx`
  - `frontend/src/components/shared/PortalMenu.tsx`
- Referenced by (1)
  - `frontend/src/components/catalog/CatalogPage.tsx`

### 3.163 `frontend/src/components/catalog/CatalogProductsSection.tsx`

- Declared exports: `function`
- Imports (8)
  - `../../utils/initials.ts`
  - `../../utils/scriptTypography.ts`
  - `../products/shared/primitives`
  - `../shared/PaginationControls`
  - `./catalogUi`
  - `./portalCatalogDisplay.ts`
  - `lucide-react`
  - `react`
- Internal dependencies (6)
  - `frontend/src/components/catalog/catalogUi.tsx`
  - `frontend/src/components/catalog/portalCatalogDisplay.ts`
  - `frontend/src/components/products/shared/primitives.tsx`
  - `frontend/src/components/shared/PaginationControls.tsx`
  - `frontend/src/utils/initials.ts`
  - `frontend/src/utils/scriptTypography.ts`
- Referenced by (1)
  - `frontend/src/components/catalog/CatalogPage.tsx`

### 3.164 `frontend/src/components/catalog/CatalogSecondaryTabs.tsx`

- Declared exports: `function`
- Imports (2)
  - `./catalogUi`
  - `react`
- Internal dependencies (1)
  - `frontend/src/components/catalog/catalogUi.tsx`
- Referenced by (1)
  - `frontend/src/components/catalog/CatalogPage.tsx`

### 3.165 `frontend/src/components/catalog/catalogUi.tsx`

- Declared exports: `SectionShell`, `StatusPill`, `SummaryTile`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `frontend/src/components/catalog/CatalogEditorSurface.tsx`
  - `frontend/src/components/catalog/CatalogPage.tsx`
  - `frontend/src/components/catalog/CatalogProductsSection.tsx`
  - `frontend/src/components/catalog/CatalogSecondaryTabs.tsx`

### 3.166 `frontend/src/components/catalog/portalCatalogDisplay.ts`

- Declared exports: `buildPortalHighlightBadges`, `buildPortalPricePresentation`, `getPortalGridClass`, `getPortalMobileGridClass`, `getPortalPromotionDetails`, `normalizeRecommendedProductIds`, `productMatchesPortalBranches`
- Imports (1)
  - `../../utils/pricing.ts`
- Internal dependencies (1)
  - `frontend/src/utils/pricing.ts`
- Referenced by (1)
  - `frontend/src/components/catalog/CatalogProductsSection.tsx`

### 3.167 `frontend/src/components/catalog/portalContentI18n.ts`

- Declared exports: `localizePortalConfig`, `localizePortalFaqText`, `localizePortalProduct`, `localizePortalProducts`, `normalizePortalTranslations`, `stringifyPortalTranslations`
- Imports (1)
  - `./portalLanguagePacks.ts`
- Internal dependencies (1)
  - `frontend/src/components/catalog/portalLanguagePacks.ts`
- Referenced by (0)
  - none

### 3.168 `frontend/src/components/catalog/portalEditorUtils.ts`

- Declared exports: `createAboutBlock`, `createPromoItem`, `extractGoogleMapsEmbedUrl`, `moveListItem`, `normalizeAboutBlocks`, `normalizeGoogleMapsEmbed`, `normalizePromoItems`, `serializeAboutBlocks`, `serializePromoItems`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.169 `frontend/src/components/catalog/portalLanguagePacks.ts`

- Declared exports: `FIRST_PARTY_PORTAL_LANGUAGE_OPTIONS`, `getPortalLanguageText`, `isFirstPartyPortalLanguage`, `normalizeFirstPartyPortalLanguage`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/catalog/portalContentI18n.ts`

### 3.170 `frontend/src/components/catalog/portalTranslateController.ts`

- Declared exports: `PORTAL_TRANSLATE_RELOAD_KEY`, `PORTAL_TRANSLATE_SCRIPT_ID`, `PORTAL_TRANSLATE_STORAGE_KEY`, `PORTAL_TRANSLATE_WIDGET_HOST_ID`, `applyGoogleTranslateSelection`, `canonicalTranslateLanguage`, `clearGoogleTranslateCookies`, `ensurePortalTranslateScript`, `ensurePortalTranslateWidgetHost`, `getPortalTranslateCookieTarget`, `hasPortalTranslatedMarker`, `isPortalTranslateApplied`, `normalizeTranslateTarget`, `readStoredTranslateTarget`, `removePortalTranslateWidgetHost`, `requestPortalTranslateReload`, `storePortalTranslatePreference`, `warmPortalTranslateNetwork`, `writePortalTranslateTarget`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.171 `frontend/src/components/contacts/ContactImportModal.tsx`

- Declared exports: `function`
- Imports (8)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../../utils/csvRowCounter.ts`
  - `../../utils/loaders.ts`
  - `../../utils/publicAssetUrls.ts`
  - `../files/FilePickerModal`
  - `../shared/Modal`
  - `react`
- Internal dependencies (7)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/files/FilePickerModal.tsx`
  - `frontend/src/components/shared/Modal.tsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/csvRowCounter.ts`
  - `frontend/src/utils/loaders.ts`
  - `frontend/src/utils/publicAssetUrls.ts`
- Referenced by (4)
  - `frontend/src/components/contacts/Contacts.tsx`
  - `frontend/src/components/contacts/CustomersTab.tsx`
  - `frontend/src/components/contacts/DeliveryTab.tsx`
  - `frontend/src/components/contacts/SuppliersTab.tsx`

### 3.172 `frontend/src/components/contacts/contactImportWorker.ts`

- Declared exports: none detected
- Imports (1)
  - `../../utils/csvRowCounter`
- Internal dependencies (1)
  - `frontend/src/utils/csvRowCounter.ts`
- Referenced by (0)
  - none

### 3.173 `frontend/src/components/contacts/contactOptionUtils.ts`

- Declared exports: `CONTACT_OPTION_LIMIT`, `buildContactOptionSummary`, `createContactOption`, `getPrimaryContactOption`, `hasContactOptionData`, `limitContactOptions`, `parseContactOptionsFromImportRow`, `parseStoredContactOptions`, `serializeContactOptions`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `frontend/src/components/contacts/CustomerFormModal.tsx`
  - `frontend/src/components/contacts/CustomersTab.tsx`
  - `frontend/src/components/contacts/DeliveryTab.tsx`
  - `frontend/src/components/contacts/SuppliersTab.tsx`
  - `frontend/src/components/pos/POS.tsx`

### 3.174 `frontend/src/components/contacts/Contacts.tsx`

- Declared exports: `function`
- Imports (12)
  - `../../AppContext.tsx`
  - `../../utils/csv`
  - `../../utils/loaders.ts`
  - `../shared/Modal`
  - `../shared/PageHeader`
  - `../shared/pageActivity`
  - `./ContactImportModal`
  - `./CustomersTab`
  - `./DeliveryTab`
  - `./SuppliersTab`
  - `lucide-react`
  - `react`
- Internal dependencies (10)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/contacts/ContactImportModal.tsx`
  - `frontend/src/components/contacts/CustomersTab.tsx`
  - `frontend/src/components/contacts/DeliveryTab.tsx`
  - `frontend/src/components/contacts/SuppliersTab.tsx`
  - `frontend/src/components/shared/Modal.tsx`
  - `frontend/src/components/shared/PageHeader.tsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/csv.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.175 `frontend/src/components/contacts/CustomerFormModal.tsx`

- Declared exports: `function`
- Imports (4)
  - `../shared/Modal`
  - `./contactOptionUtils`
  - `./customerMembershipNumber`
  - `react`
- Internal dependencies (3)
  - `frontend/src/components/contacts/contactOptionUtils.ts`
  - `frontend/src/components/contacts/customerMembershipNumber.ts`
  - `frontend/src/components/shared/Modal.tsx`
- Referenced by (1)
  - `frontend/src/components/contacts/CustomersTab.tsx`

### 3.176 `frontend/src/components/contacts/customerMembershipNumber.ts`

- Declared exports: `generateCustomerMembershipNumber`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/contacts/CustomerFormModal.tsx`
  - `frontend/src/components/contacts/CustomersTab.tsx`

### 3.177 `frontend/src/components/contacts/CustomersTab.tsx`

- Declared exports: `parseContactOptions`, `serializeContactOptions`
- Imports (18)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../../utils/actionHistory.ts`
  - `../../utils/bulkOps.ts`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `../../utils/groupedRecords.ts`
  - `../../utils/historyHelpers.ts`
  - `../../utils/loaders.ts`
  - `../shared/ActionHistoryBar`
  - `../shared/FilterMenu`
  - `./ContactImportModal`
  - `./CustomerFormModal`
  - `./contactOptionUtils`
  - `./customerMembershipNumber`
  - `./shared`
  - `lucide-react`
  - `react`
- Internal dependencies (16)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/contacts/ContactImportModal.tsx`
  - `frontend/src/components/contacts/CustomerFormModal.tsx`
  - `frontend/src/components/contacts/contactOptionUtils.ts`
  - `frontend/src/components/contacts/customerMembershipNumber.ts`
  - `frontend/src/components/contacts/shared.tsx`
  - `frontend/src/components/shared/ActionHistoryBar.tsx`
  - `frontend/src/components/shared/FilterMenu.tsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/utils/bulkOps.ts`
  - `frontend/src/utils/csv.ts`
  - `frontend/src/utils/formatters.ts`
  - `frontend/src/utils/groupedRecords.ts`
  - `frontend/src/utils/historyHelpers.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (2)
  - `frontend/src/components/contacts/Contacts.tsx`
  - `frontend/src/components/pos/POS.tsx`

### 3.178 `frontend/src/components/contacts/DeliveryTab.tsx`

- Declared exports: `parseDeliveryOptions`, `serializeDeliveryOptions`
- Imports (17)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../../utils/actionHistory.ts`
  - `../../utils/bulkOps.ts`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `../../utils/groupedRecords.ts`
  - `../../utils/historyHelpers.ts`
  - `../../utils/loaders.ts`
  - `../shared/ActionHistoryBar`
  - `../shared/FilterMenu`
  - `../shared/Modal`
  - `./ContactImportModal`
  - `./contactOptionUtils`
  - `./shared`
  - `lucide-react`
  - `react`
- Internal dependencies (15)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/contacts/ContactImportModal.tsx`
  - `frontend/src/components/contacts/contactOptionUtils.ts`
  - `frontend/src/components/contacts/shared.tsx`
  - `frontend/src/components/shared/ActionHistoryBar.tsx`
  - `frontend/src/components/shared/FilterMenu.tsx`
  - `frontend/src/components/shared/Modal.tsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/utils/bulkOps.ts`
  - `frontend/src/utils/csv.ts`
  - `frontend/src/utils/formatters.ts`
  - `frontend/src/utils/groupedRecords.ts`
  - `frontend/src/utils/historyHelpers.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/components/contacts/Contacts.tsx`

### 3.179 `frontend/src/components/contacts/shared.tsx`

- Declared exports: `ContactTable`, `DetailModal`, `ThreeDotMenu`, `buildSelectedSnapshots`, `countActiveFlags`, `useContactSelection`
- Imports (7)
  - `../../AppContext.tsx`
  - `../shared/LoadingWatchdog`
  - `../shared/Modal`
  - `../shared/PaginationControls`
  - `../shared/PortalMenu`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/shared/LoadingWatchdog.tsx`
  - `frontend/src/components/shared/Modal.tsx`
  - `frontend/src/components/shared/PaginationControls.tsx`
  - `frontend/src/components/shared/PortalMenu.tsx`
- Referenced by (3)
  - `frontend/src/components/contacts/CustomersTab.tsx`
  - `frontend/src/components/contacts/DeliveryTab.tsx`
  - `frontend/src/components/contacts/SuppliersTab.tsx`

### 3.180 `frontend/src/components/contacts/SuppliersTab.tsx`

- Declared exports: none detected
- Imports (17)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../../utils/actionHistory.ts`
  - `../../utils/bulkOps.ts`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `../../utils/groupedRecords.ts`
  - `../../utils/historyHelpers.ts`
  - `../../utils/loaders.ts`
  - `../shared/ActionHistoryBar`
  - `../shared/FilterMenu`
  - `../shared/Modal`
  - `./ContactImportModal`
  - `./contactOptionUtils`
  - `./shared`
  - `lucide-react`
  - `react`
- Internal dependencies (15)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/contacts/ContactImportModal.tsx`
  - `frontend/src/components/contacts/contactOptionUtils.ts`
  - `frontend/src/components/contacts/shared.tsx`
  - `frontend/src/components/shared/ActionHistoryBar.tsx`
  - `frontend/src/components/shared/FilterMenu.tsx`
  - `frontend/src/components/shared/Modal.tsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/utils/bulkOps.ts`
  - `frontend/src/utils/csv.ts`
  - `frontend/src/utils/formatters.ts`
  - `frontend/src/utils/groupedRecords.ts`
  - `frontend/src/utils/historyHelpers.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/components/contacts/Contacts.tsx`

### 3.181 `frontend/src/components/custom-tables/CustomTables.tsx`

- Declared exports: `function`
- Imports (6)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../../utils/actionHistory.ts`
  - `../../utils/historyHelpers.ts`
  - `../shared/ActionHistoryBar`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/shared/ActionHistoryBar.tsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/utils/historyHelpers.ts`
- Referenced by (0)
  - none

### 3.182 `frontend/src/components/dashboard/charts/BarChart.tsx`

- Declared exports: `function`
- Imports (3)
  - `../../../utils/formatters`
  - `./NoData`
  - `react`
- Internal dependencies (2)
  - `frontend/src/components/dashboard/charts/NoData.tsx`
  - `frontend/src/utils/formatters.ts`
- Referenced by (0)
  - none

### 3.183 `frontend/src/components/dashboard/charts/DonutChart.tsx`

- Declared exports: `function`
- Imports (3)
  - `../../../utils/formatters`
  - `./NoData`
  - `react`
- Internal dependencies (2)
  - `frontend/src/components/dashboard/charts/NoData.tsx`
  - `frontend/src/utils/formatters.ts`
- Referenced by (0)
  - none

### 3.184 `frontend/src/components/dashboard/charts/index.ts`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/dashboard/Dashboard.tsx`
  - `frontend/src/utils/exportReports.tsx`

### 3.185 `frontend/src/components/dashboard/charts/LineChart.tsx`

- Declared exports: `function`
- Imports (3)
  - `../../../utils/formatters`
  - `./NoData`
  - `react`
- Internal dependencies (2)
  - `frontend/src/components/dashboard/charts/NoData.tsx`
  - `frontend/src/utils/formatters.ts`
- Referenced by (0)
  - none

### 3.186 `frontend/src/components/dashboard/charts/NoData.tsx`

- Declared exports: `function`
- Imports (1)
  - `../../../AppContext.tsx`
- Internal dependencies (1)
  - `frontend/src/AppContext.tsx`
- Referenced by (3)
  - `frontend/src/components/dashboard/charts/BarChart.tsx`
  - `frontend/src/components/dashboard/charts/DonutChart.tsx`
  - `frontend/src/components/dashboard/charts/LineChart.tsx`

### 3.187 `frontend/src/components/dashboard/Dashboard.tsx`

- Declared exports: `function`
- Imports (16)
  - `../../AppContext.tsx`
  - `../../api/http.ts`
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
  - `frontend/src/AppContext.tsx`
  - `frontend/src/api/http.ts`
  - `frontend/src/components/dashboard/MiniStat.tsx`
  - `frontend/src/components/dashboard/charts/index.ts`
  - `frontend/src/components/shared/ExportMenu.tsx`
  - `frontend/src/components/shared/LoadingWatchdog.tsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/csv.ts`
  - `frontend/src/utils/dateHelpers.ts`
  - `frontend/src/utils/exportPackage.ts`
  - `frontend/src/utils/exportReports.tsx`
  - `frontend/src/utils/formatters.ts`
  - `frontend/src/utils/loaders.ts`
  - `frontend/src/utils/pricing.ts`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.188 `frontend/src/components/dashboard/MiniStat.tsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/dashboard/Dashboard.tsx`

### 3.189 `frontend/src/components/files/FilePickerModal.tsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext.tsx`
  - `../../utils/publicAssetUrls.ts`
  - `../shared/Modal`
  - `react`
- Internal dependencies (3)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/shared/Modal.tsx`
  - `frontend/src/utils/publicAssetUrls.ts`
- Referenced by (5)
  - `frontend/src/components/catalog/CatalogPreviewSurface.tsx`
  - `frontend/src/components/contacts/ContactImportModal.tsx`
  - `frontend/src/components/products/forms/ProductForm.tsx`
  - `frontend/src/components/products/import/BulkImportModal.tsx`
  - `frontend/src/components/users/UserProfileModal.tsx`

### 3.190 `frontend/src/components/files/FilesPage.tsx`

- Declared exports: `function`
- Imports (11)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../../utils/actionHistory.ts`
  - `../../utils/historyHelpers.ts`
  - `../../utils/publicAssetUrls.ts`
  - `../shared/ActionHistoryBar`
  - `../shared/PageHeader`
  - `../shared/pageActivity`
  - `./FilesProvidersTab.tsx`
  - `./FilesResponsesTab`
  - `react`
- Internal dependencies (10)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/files/FilesProvidersTab.tsx`
  - `frontend/src/components/files/FilesResponsesTab.tsx`
  - `frontend/src/components/shared/ActionHistoryBar.tsx`
  - `frontend/src/components/shared/PageHeader.tsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/utils/historyHelpers.ts`
  - `frontend/src/utils/publicAssetUrls.ts`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.191 `frontend/src/components/files/FilesProvidersTab.tsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/files/FilesPage.tsx`

### 3.192 `frontend/src/components/files/FilesResponsesTab.tsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/files/FilesPage.tsx`

### 3.193 `frontend/src/components/inventory/DualMoney.tsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/inventory/InventoryProductsSurface.tsx`

### 3.194 `frontend/src/components/inventory/Inventory.tsx`

- Declared exports: `function`
- Imports (30)
  - `../../AppContext`
  - `../../api/http.ts`
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
  - `../shared/ActionHistoryBar`
  - `../shared/ExportMenu`
  - `../shared/FilterMenu`
  - `../shared/LoadingWatchdog`
  - `../shared/PaginationControls`
  - `../shared/SectionSwitcher`
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
  - `frontend/src/AppContext.tsx`
  - `frontend/src/api/http.ts`
  - `frontend/src/components/inventory/InventoryImportModal.tsx`
  - `frontend/src/components/inventory/InventoryMovementsSurface.tsx`
  - `frontend/src/components/inventory/InventoryProductsSurface.tsx`
  - `frontend/src/components/inventory/InventoryRfidSurface.tsx`
  - `frontend/src/components/inventory/ProductDetailModal.tsx`
  - `frontend/src/components/inventory/movementGroups.ts`
  - `frontend/src/components/shared/ActionHistoryBar.tsx`
  - `frontend/src/components/shared/ExportMenu.tsx`
  - `frontend/src/components/shared/FilterMenu.tsx`
  - `frontend/src/components/shared/LoadingWatchdog.tsx`
  - `frontend/src/components/shared/PaginationControls.tsx`
  - `frontend/src/components/shared/SectionSwitcher.tsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/utils/bulkOps.ts`
  - `frontend/src/utils/csv.ts`
  - `frontend/src/utils/exportPackage.ts`
  - `frontend/src/utils/exportReports.tsx`
  - `frontend/src/utils/formatters.ts`
  - `frontend/src/utils/groupedRecords.ts`
  - `frontend/src/utils/historyHelpers.ts`
  - `frontend/src/utils/initials.ts`
  - `frontend/src/utils/pricing.ts`
  - `frontend/src/utils/productBatches.ts`
  - `frontend/src/utils/productGrouping.ts`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.195 `frontend/src/components/inventory/InventoryImportModal.tsx`

- Declared exports: `function`
- Imports (5)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../../utils/csvRowCounter.ts`
  - `../shared/Modal`
  - `react`
- Internal dependencies (4)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/shared/Modal.tsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/csvRowCounter.ts`
- Referenced by (1)
  - `frontend/src/components/inventory/Inventory.tsx`

### 3.196 `frontend/src/components/inventory/inventoryImportWorker.ts`

- Declared exports: none detected
- Imports (1)
  - `../../utils/csvRowCounter`
- Internal dependencies (1)
  - `frontend/src/utils/csvRowCounter.ts`
- Referenced by (0)
  - none

### 3.197 `frontend/src/components/inventory/InventoryMovementsSurface.tsx`

- Declared exports: `function`
- Imports (6)
  - `../shared/ActionHistoryBar`
  - `../shared/ExportMenu`
  - `../shared/PaginationControls`
  - `../shared/PortalMenu`
  - `lucide-react`
  - `react`
- Internal dependencies (4)
  - `frontend/src/components/shared/ActionHistoryBar.tsx`
  - `frontend/src/components/shared/ExportMenu.tsx`
  - `frontend/src/components/shared/PaginationControls.tsx`
  - `frontend/src/components/shared/PortalMenu.tsx`
- Referenced by (1)
  - `frontend/src/components/inventory/Inventory.tsx`

### 3.198 `frontend/src/components/inventory/InventoryProductsSurface.tsx`

- Declared exports: `function`
- Imports (4)
  - `../../utils/scriptTypography.ts`
  - `./DualMoney`
  - `lucide-react`
  - `react`
- Internal dependencies (2)
  - `frontend/src/components/inventory/DualMoney.tsx`
  - `frontend/src/utils/scriptTypography.ts`
- Referenced by (1)
  - `frontend/src/components/inventory/Inventory.tsx`

### 3.199 `frontend/src/components/inventory/InventoryRfidSurface.tsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/inventory/Inventory.tsx`

### 3.200 `frontend/src/components/inventory/movementGroups.ts`

- Declared exports: `buildMovementGroups`, `getMovementGroupPage`, `movementGroupHaystack`, `normalizeMovementTimestamp`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/tests/inventoryMovementGroups.test.ts`

### 3.201 `frontend/src/components/inventory/ProductDetailModal.tsx`

- Declared exports: `function`
- Imports (2)
  - `../../utils/pricing.ts`
  - `../../utils/productBatches.ts`
- Internal dependencies (2)
  - `frontend/src/utils/pricing.ts`
  - `frontend/src/utils/productBatches.ts`
- Referenced by (1)
  - `frontend/src/components/inventory/Inventory.tsx`

### 3.202 `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx`

- Declared exports: `function`
- Imports (7)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../shared/LoadingWatchdog`
  - `../shared/SectionSwitcher`
  - `../shared/pageActivity`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/shared/LoadingWatchdog.tsx`
  - `frontend/src/components/shared/SectionSwitcher.tsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/actionGuards.ts`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.203 `frontend/src/components/navigation/Sidebar.tsx`

- Declared exports: `function`
- Imports (8)
  - `../../AppContext.tsx`
  - `../../app/appShellUtils.ts`
  - `../shared/NotificationCenter`
  - `../shared/QuickPreferenceToggles`
  - `../shared/navigationConfig`
  - `../users/UserProfileModal`
  - `lucide-react`
  - `react`
- Internal dependencies (6)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/app/appShellUtils.ts`
  - `frontend/src/components/shared/NotificationCenter.tsx`
  - `frontend/src/components/shared/QuickPreferenceToggles.tsx`
  - `frontend/src/components/shared/navigationConfig.ts`
  - `frontend/src/components/users/UserProfileModal.tsx`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.204 `frontend/src/components/pos/CartItem.tsx`

- Declared exports: `function`
- Imports (2)
  - `../../utils/pricing.ts`
  - `../../utils/scriptTypography.ts`
- Internal dependencies (2)
  - `frontend/src/utils/pricing.ts`
  - `frontend/src/utils/scriptTypography.ts`
- Referenced by (1)
  - `frontend/src/components/pos/POS.tsx`

### 3.205 `frontend/src/components/pos/FilterPanel.tsx`

- Declared exports: `function`
- Imports (2)
  - `lucide-react`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/pos/POS.tsx`

### 3.206 `frontend/src/components/pos/POS.tsx`

- Declared exports: `function`
- Imports (19)
  - `../../AppContext`
  - `../../utils/deviceInfo`
  - `../../utils/initials.ts`
  - `../../utils/pricing.ts`
  - `../../utils/publicAssetUrls.ts`
  - `../../utils/scriptTypography.ts`
  - `../contacts/CustomersTab`
  - `../contacts/contactOptionUtils`
  - `../receipt/Receipt`
  - `../sales/StatusBadge`
  - `../shared/ImageGalleryLightbox`
  - `../shared/PaginationControls`
  - `../shared/pageActivity`
  - `./CartItem`
  - `./FilterPanel`
  - `./ProductImage`
  - `./QuickAddModal`
  - `lucide-react`
  - `react`
- Internal dependencies (17)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/contacts/CustomersTab.tsx`
  - `frontend/src/components/contacts/contactOptionUtils.ts`
  - `frontend/src/components/pos/CartItem.tsx`
  - `frontend/src/components/pos/FilterPanel.tsx`
  - `frontend/src/components/pos/ProductImage.tsx`
  - `frontend/src/components/pos/QuickAddModal.tsx`
  - `frontend/src/components/receipt/Receipt.tsx`
  - `frontend/src/components/sales/StatusBadge.tsx`
  - `frontend/src/components/shared/ImageGalleryLightbox.tsx`
  - `frontend/src/components/shared/PaginationControls.tsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/deviceInfo.ts`
  - `frontend/src/utils/initials.ts`
  - `frontend/src/utils/pricing.ts`
  - `frontend/src/utils/publicAssetUrls.ts`
  - `frontend/src/utils/scriptTypography.ts`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.207 `frontend/src/components/pos/posCore.ts`

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

### 3.208 `frontend/src/components/pos/ProductImage.tsx`

- Declared exports: `function`
- Imports (1)
  - `../products/shared/primitives`
- Internal dependencies (1)
  - `frontend/src/components/products/shared/primitives.tsx`
- Referenced by (1)
  - `frontend/src/components/pos/POS.tsx`

### 3.209 `frontend/src/components/pos/QuickAddModal.tsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/pos/POS.tsx`

### 3.210 `frontend/src/components/products/config/productPageConfig.ts`

- Declared exports: `CREATED_MONTH_OPTIONS`, `DEFAULT_META_PILL_COLOR`, `PRODUCTS_AUX_OPTIONS_TIMEOUT_MS`, `PRODUCTS_BY_ID_TIMEOUT_MS`, `PRODUCTS_FILTER_META_TIMEOUT_MS`, `PRODUCT_DELETE_MUTATION_TIMEOUT_MS`, `PRODUCT_IMAGE_UPLOAD_TIMEOUT_MS`, `PRODUCT_STOCK_MUTATION_TIMEOUT_MS`, `PRODUCT_WRITE_MUTATION_TIMEOUT_MS`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.211 `frontend/src/components/products/forms/BranchStockAdjuster.tsx`

- Declared exports: `function`
- Imports (3)
  - `../../../utils/actionGuards.ts`
  - `../../../utils/loaders.ts`
  - `react`
- Internal dependencies (2)
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/components/products/forms/ProductForm.tsx`

### 3.212 `frontend/src/components/products/forms/BulkAddStockModal.tsx`

- Declared exports: `function`
- Imports (3)
  - `../../../utils/actionGuards.ts`
  - `../../../utils/loaders.ts`
  - `react`
- Internal dependencies (2)
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/components/products/Products.tsx`

### 3.213 `frontend/src/components/products/forms/ProductForm.tsx`

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
  - `frontend/src/components/files/FilePickerModal.tsx`
  - `frontend/src/components/products/forms/BranchStockAdjuster.tsx`
  - `frontend/src/components/products/scanning/BarcodeScannerModal.tsx`
  - `frontend/src/components/products/shared/primitives.tsx`
  - `frontend/src/components/shared/Modal.tsx`
  - `frontend/src/utils/mediaUpload.ts`
  - `frontend/src/utils/pricing.ts`
- Referenced by (1)
  - `frontend/src/components/products/Products.tsx`

### 3.214 `frontend/src/components/products/forms/VariantFormModal.tsx`

- Declared exports: `function`
- Imports (8)
  - `../../../AppContext.tsx`
  - `../../../utils/actionGuards.ts`
  - `../../../utils/historyHelpers.ts`
  - `../../../utils/loaders.ts`
  - `../../../utils/pricing.ts`
  - `../../shared/Modal`
  - `../shared/primitives`
  - `react`
- Internal dependencies (7)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/products/shared/primitives.tsx`
  - `frontend/src/components/shared/Modal.tsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/historyHelpers.ts`
  - `frontend/src/utils/loaders.ts`
  - `frontend/src/utils/pricing.ts`
- Referenced by (1)
  - `frontend/src/components/products/Products.tsx`

### 3.215 `frontend/src/components/products/helpers/productDisplayHelpers.ts`

- Declared exports: `PRODUCT_STOCK_STATUS_CLASS`, `buildBranchNameByIdMap`, `buildNameLookupMap`, `buildProductBranchSummaryLabel`, `buildProductBrandOptions`, `buildProductRowDisplayState`, `getProductStockStatus`
- Imports (1)
  - `../../../utils/pricing.ts`
- Internal dependencies (1)
  - `frontend/src/utils/pricing.ts`
- Referenced by (0)
  - none

### 3.216 `frontend/src/components/products/helpers/productFilterHelpers.ts`

- Declared exports: `buildProductExportRows`, `buildProductSearchTerms`, `filterProductsForPage`, `getProductBranchQuantity`
- Imports (2)
  - `../../../utils/groupedRecords.ts`
  - `../../../utils/pricing.ts`
- Internal dependencies (2)
  - `frontend/src/utils/groupedRecords.ts`
  - `frontend/src/utils/pricing.ts`
- Referenced by (0)
  - none

### 3.217 `frontend/src/components/products/helpers/productGalleryHelpers.ts`

- Declared exports: `buildProductLightboxGalleryInput`, `buildProductLightboxState`, `buildProductThumbnailState`, `clampProductLightboxIndex`, `getProductGalleryImages`, `normalizeProductGallery`, `resolveProductImageUrl`, `updateProductLightboxIndex`
- Imports (1)
  - `../../../utils/publicAssetUrls.ts`
- Internal dependencies (1)
  - `frontend/src/utils/publicAssetUrls.ts`
- Referenced by (1)
  - `frontend/src/components/products/helpers/productWriteHelpers.ts`

### 3.218 `frontend/src/components/products/helpers/productGroupViewHelpers.ts`

- Declared exports: `buildProductGroupPriceLabel`, `buildProductGroupSummaryParts`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.219 `frontend/src/components/products/helpers/productMenuHelpers.ts`

- Declared exports: `buildProductExportItems`, `buildProductFilterSections`, `buildProductSupplierOptions`, `countActiveProductFilters`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.220 `frontend/src/components/products/helpers/productPageHelpers.ts`

- Declared exports: `normalizeBrandLookup`, `parseBrandColorMap`, `useDebouncedValue`, `waitForNextFrame`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.221 `frontend/src/components/products/helpers/productSelectionHelpers.ts`

- Declared exports: `buildJumpTargetIdsByLetter`, `buildParentProductIdSet`, `buildProductIdMap`, `buildProductPaginationState`, `buildSelectedProducts`, `buildSelectedVisibleIds`, `buildVisibleProductIds`, `isSelectionScopeFullySelected`, `isSelectionScopePartiallySelected`, `normalizePositiveProductIds`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.222 `frontend/src/components/products/helpers/productWriteHelpers.ts`

- Declared exports: `buildDefinedProductUpdates`, `buildDeletedProductIdSet`, `buildProductBranchMovePlan`, `buildProductBranchStockAdjustments`, `buildProductBulkInfoUpdates`, `buildProductBulkPricingUpdates`, `buildProductBulkUpdatePayload`, `buildProductClearStockAdjustments`, `buildProductStockAdjustmentPayload`, `buildProductTransferStockPayload`, `buildProductWritePayload`, `getDefaultProductRestoreBranchId`, `getPreferredProductRestoreBranchId`, `resolveRestoredProductParentId`, `summarizeProductBulkRun`
- Imports (2)
  - `../../../utils/pricing.ts`
  - `./productGalleryHelpers.ts`
- Internal dependencies (2)
  - `frontend/src/components/products/helpers/productGalleryHelpers.ts`
  - `frontend/src/utils/pricing.ts`
- Referenced by (0)
  - none

### 3.223 `frontend/src/components/products/history/productHistoryHelpers.ts`

- Declared exports: `createProductHistoryRequestId`, `orderProductRestoreSnapshots`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/products/Products.tsx`
  - `frontend/tests/productHistoryHelpers.test.ts`

### 3.224 `frontend/src/components/products/import/BulkImportModal.tsx`

- Declared exports: `function`
- Imports (6)
  - `../../../utils/actionGuards.ts`
  - `../../../utils/loaders.ts`
  - `../../files/FilePickerModal`
  - `../../shared/Modal`
  - `lucide-react`
  - `react`
- Internal dependencies (4)
  - `frontend/src/components/files/FilePickerModal.tsx`
  - `frontend/src/components/shared/Modal.tsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/components/products/Products.tsx`

### 3.225 `frontend/src/components/products/import/productImportPlanner.ts`

- Declared exports: `BLOCKING_PRODUCT_IMPORT_ISSUES`, `PRODUCT_MONEY_FIELDS`, `PRODUCT_NUMBER_FIELDS`, `PRODUCT_PERCENT_FIELDS`, `analyzeProductImportRows`, `analyzeProductImportText`, `getProductImportBarcodeIssue`, `getProductImportDetailSignature`, `isBlockingProductImportIssue`, `normalizeImportProductName`, `normalizeProductImportRow`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `frontend/src/components/products/import/productImportWorker.ts`
  - `frontend/tests/productImportPlanner.test.ts`
  - `frontend/tests/productImportWorkerFallback.test.ts`

### 3.226 `frontend/src/components/products/import/productImportWorker.ts`

- Declared exports: none detected
- Imports (1)
  - `./productImportPlanner`
- Internal dependencies (1)
  - `frontend/src/components/products/import/productImportPlanner.ts`
- Referenced by (0)
  - none

### 3.227 `frontend/src/components/products/lookups/ManageBrandsModal.tsx`

- Declared exports: `function`
- Imports (6)
  - `../../../AppContext.tsx`
  - `../../../utils/actionGuards.ts`
  - `../../../utils/actionHistory.ts`
  - `../../shared/ActionHistoryBar`
  - `../../shared/Modal`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/shared/ActionHistoryBar.tsx`
  - `frontend/src/components/shared/Modal.tsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
- Referenced by (1)
  - `frontend/src/components/products/Products.tsx`

### 3.228 `frontend/src/components/products/lookups/ManageCategoriesModal.tsx`

- Declared exports: `function`
- Imports (6)
  - `../../../AppContext.tsx`
  - `../../../utils/actionGuards.ts`
  - `../../../utils/actionHistory.ts`
  - `../../shared/ActionHistoryBar`
  - `../../shared/Modal`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/shared/ActionHistoryBar.tsx`
  - `frontend/src/components/shared/Modal.tsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
- Referenced by (1)
  - `frontend/src/components/products/Products.tsx`

### 3.229 `frontend/src/components/products/lookups/ManageUnitsModal.tsx`

- Declared exports: `function`
- Imports (6)
  - `../../../AppContext.tsx`
  - `../../../utils/actionGuards.ts`
  - `../../../utils/actionHistory.ts`
  - `../../shared/ActionHistoryBar`
  - `../../shared/Modal`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/shared/ActionHistoryBar.tsx`
  - `frontend/src/components/shared/Modal.tsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
- Referenced by (1)
  - `frontend/src/components/products/Products.tsx`

### 3.230 `frontend/src/components/products/lookups/productLookupSnapshots.ts`

- Declared exports: `fetchLookupProductSnapshots`, `normalizeLookup`, `restoreLookupProductSnapshots`
- Imports (1)
  - `../../../utils/loaders`
- Internal dependencies (1)
  - `frontend/src/utils/loaders.ts`
- Referenced by (0)
  - none

### 3.231 `frontend/src/components/products/Products.tsx`

- Declared exports: `function`
- Imports (32)
  - `../../AppContext`
  - `../../api/http.ts`
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
  - `../shared/ActionHistoryBar`
  - `../shared/FilterMenu`
  - `../shared/ImageGalleryLightbox`
  - `../shared/Modal`
  - `../shared/PaginationControls`
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
  - `frontend/src/AppContext.tsx`
  - `frontend/src/api/http.ts`
  - `frontend/src/components/products/forms/BulkAddStockModal.tsx`
  - `frontend/src/components/products/forms/ProductForm.tsx`
  - `frontend/src/components/products/forms/VariantFormModal.tsx`
  - `frontend/src/components/products/history/productHistoryHelpers.ts`
  - `frontend/src/components/products/import/BulkImportModal.tsx`
  - `frontend/src/components/products/lookups/ManageBrandsModal.tsx`
  - `frontend/src/components/products/lookups/ManageCategoriesModal.tsx`
  - `frontend/src/components/products/lookups/ManageUnitsModal.tsx`
  - `frontend/src/components/products/shared/primitives.tsx`
  - `frontend/src/components/products/surfaces/HeaderActions.tsx`
  - `frontend/src/components/products/surfaces/ProductDetailModal.tsx`
  - `frontend/src/components/products/surfaces/ProductsListSurface.tsx`
  - `frontend/src/components/shared/ActionHistoryBar.tsx`
  - `frontend/src/components/shared/FilterMenu.tsx`
  - `frontend/src/components/shared/ImageGalleryLightbox.tsx`
  - `frontend/src/components/shared/Modal.tsx`
  - `frontend/src/components/shared/PaginationControls.tsx`
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
  - `frontend/src/App.tsx`

### 3.232 `frontend/src/components/products/scanning/barcodeImageScanner.ts`

- Declared exports: `scanBarcodeFromImageFile`
- Imports (1)
  - `@zxing/browser`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/products/scanning/BarcodeScannerModal.tsx`
  - `frontend/tests/barcodeImageScanner.test.ts`

### 3.233 `frontend/src/components/products/scanning/BarcodeScannerModal.tsx`

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
  - `frontend/src/components/shared/Modal.tsx`
- Referenced by (1)
  - `frontend/src/components/products/forms/ProductForm.tsx`

### 3.234 `frontend/src/components/products/scanning/barcodeScannerState.ts`

- Declared exports: `deriveScannerPresentation`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/products/scanning/BarcodeScannerModal.tsx`
  - `frontend/tests/barcodeScannerState.test.ts`

### 3.235 `frontend/src/components/products/scanning/scanbotScanner.ts`

- Declared exports: `getPreferredScannerMode`, `isCameraBlockedByDocumentPolicy`, `scanBarcodeWithScanbot`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/products/scanning/BarcodeScannerModal.tsx`
  - `frontend/tests/scanbotScanner.test.ts`

### 3.236 `frontend/src/components/products/shared/primitives.tsx`

- Declared exports: none detected
- Imports (3)
  - `../../../utils/publicAssetUrls.ts`
  - `lucide-react`
  - `react`
- Internal dependencies (1)
  - `frontend/src/utils/publicAssetUrls.ts`
- Referenced by (9)
  - `frontend/src/components/catalog/CatalogEditorSurface.tsx`
  - `frontend/src/components/catalog/CatalogPage.tsx`
  - `frontend/src/components/catalog/CatalogPreviewSurface.tsx`
  - `frontend/src/components/catalog/CatalogProductsSection.tsx`
  - `frontend/src/components/pos/ProductImage.tsx`
  - `frontend/src/components/products/forms/ProductForm.tsx`
  - `frontend/src/components/products/forms/VariantFormModal.tsx`
  - `frontend/src/components/products/Products.tsx`
  - `frontend/src/components/products/surfaces/ProductDetailModal.tsx`

### 3.237 `frontend/src/components/products/surfaces/HeaderActions.tsx`

- Declared exports: `function`
- Imports (3)
  - `../../shared/ExportMenu`
  - `../../shared/PortalMenu`
  - `lucide-react`
- Internal dependencies (2)
  - `frontend/src/components/shared/ExportMenu.tsx`
  - `frontend/src/components/shared/PortalMenu.tsx`
- Referenced by (1)
  - `frontend/src/components/products/Products.tsx`

### 3.238 `frontend/src/components/products/surfaces/ProductDetailModal.tsx`

- Declared exports: `function`
- Imports (6)
  - `../../../utils/color.ts`
  - `../../../utils/pricing.ts`
  - `../../../utils/productBatches.ts`
  - `../shared/primitives`
  - `lucide-react`
  - `react`
- Internal dependencies (4)
  - `frontend/src/components/products/shared/primitives.tsx`
  - `frontend/src/utils/color.ts`
  - `frontend/src/utils/pricing.ts`
  - `frontend/src/utils/productBatches.ts`
- Referenced by (1)
  - `frontend/src/components/products/Products.tsx`

### 3.239 `frontend/src/components/products/surfaces/ProductRowParts.tsx`

- Declared exports: `ProductBatchPreview`, `ProductDetailsCell`, `ProductDiscountBadge`, `ProductRowActions`
- Imports (4)
  - `../../../utils/pricing.ts`
  - `../../../utils/productBatches.ts`
  - `../../shared/PortalMenu`
  - `react`
- Internal dependencies (3)
  - `frontend/src/components/shared/PortalMenu.tsx`
  - `frontend/src/utils/pricing.ts`
  - `frontend/src/utils/productBatches.ts`
- Referenced by (0)
  - none

### 3.240 `frontend/src/components/products/surfaces/ProductsListSurface.tsx`

- Declared exports: `function`
- Imports (2)
  - `lucide-react`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/products/Products.tsx`

### 3.241 `frontend/src/components/receipt-settings/AllFieldsPanel.tsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext.tsx`
  - `./constants`
  - `react`
- Internal dependencies (2)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/receipt-settings/constants.ts`
- Referenced by (1)
  - `frontend/src/components/receipt-settings/ReceiptSettings.tsx`

### 3.242 `frontend/src/components/receipt-settings/constants.ts`

- Declared exports: `ALL_FIELD_ITEMS`, `DEFAULT_TEMPLATE`, `getFieldItems`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `frontend/src/components/receipt-settings/AllFieldsPanel.tsx`
  - `frontend/src/components/receipt-settings/ReceiptSettings.tsx`
  - `frontend/src/components/receipt-settings/template.ts`
  - `frontend/tests/receiptTemplate.test.ts`

### 3.243 `frontend/src/components/receipt-settings/ErrorBoundary.tsx`

- Declared exports: `class`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/receipt-settings/ReceiptSettings.tsx`

### 3.244 `frontend/src/components/receipt-settings/FieldOrderManager.tsx`

- Declared exports: `function`
- Imports (2)
  - `lucide-react`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/receipt-settings/ReceiptSettings.tsx`

### 3.245 `frontend/src/components/receipt-settings/PrintSettings.tsx`

- Declared exports: `function`
- Imports (4)
  - `../../types/receiptContracts`
  - `../../utils/printReceipt`
  - `lucide-react`
  - `react`
- Internal dependencies (2)
  - `frontend/src/types/receiptContracts.ts`
  - `frontend/src/utils/printReceipt.ts`
- Referenced by (1)
  - `frontend/src/components/receipt-settings/ReceiptSettings.tsx`

### 3.246 `frontend/src/components/receipt-settings/ReceiptPreview.tsx`

- Declared exports: `function`
- Imports (4)
  - `../../types/receiptContracts.ts`
  - `../../utils/receiptAppliedConfig.ts`
  - `../receipt/Receipt.tsx`
  - `react`
- Internal dependencies (3)
  - `frontend/src/components/receipt/Receipt.tsx`
  - `frontend/src/types/receiptContracts.ts`
  - `frontend/src/utils/receiptAppliedConfig.ts`
- Referenced by (1)
  - `frontend/src/components/receipt-settings/ReceiptSettings.tsx`

### 3.247 `frontend/src/components/receipt-settings/ReceiptSettings.tsx`

- Declared exports: `function`
- Imports (12)
  - `../../AppContext.tsx`
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
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/receipt-settings/AllFieldsPanel.tsx`
  - `frontend/src/components/receipt-settings/ErrorBoundary.tsx`
  - `frontend/src/components/receipt-settings/FieldOrderManager.tsx`
  - `frontend/src/components/receipt-settings/PrintSettings.tsx`
  - `frontend/src/components/receipt-settings/ReceiptPreview.tsx`
  - `frontend/src/components/receipt-settings/constants.ts`
  - `frontend/src/components/receipt-settings/template.ts`
  - `frontend/src/utils/loaders.ts`
  - `frontend/src/utils/receiptAppliedConfig.ts`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.248 `frontend/src/components/receipt-settings/template.ts`

- Declared exports: `parseReceiptTemplate`, `serializeReceiptTemplate`
- Imports (1)
  - `./constants.ts`
- Internal dependencies (1)
  - `frontend/src/components/receipt-settings/constants.ts`
- Referenced by (3)
  - `frontend/src/components/receipt-settings/ReceiptSettings.tsx`
  - `frontend/src/components/receipt/Receipt.tsx`
  - `frontend/tests/receiptTemplate.test.ts`

### 3.249 `frontend/src/components/receipt/Receipt.tsx`

- Declared exports: `function`
- Imports (7)
  - `../../AppContext.tsx`
  - `../../utils/printReceipt`
  - `../../utils/receiptAppliedConfig.ts`
  - `../receipt-settings/template`
  - `../sales/StatusBadge`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/receipt-settings/template.ts`
  - `frontend/src/components/sales/StatusBadge.tsx`
  - `frontend/src/utils/printReceipt.ts`
  - `frontend/src/utils/receiptAppliedConfig.ts`
- Referenced by (3)
  - `frontend/src/components/pos/POS.tsx`
  - `frontend/src/components/receipt-settings/ReceiptPreview.tsx`
  - `frontend/src/components/sales/Sales.tsx`

### 3.250 `frontend/src/components/returns/EditReturnModal.tsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../../utils/loaders.ts`
  - `react`
- Internal dependencies (3)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/components/returns/Returns.tsx`

### 3.251 `frontend/src/components/returns/NewReturnModal.tsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../../utils/formatters`
  - `react`
- Internal dependencies (3)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/formatters.ts`
- Referenced by (1)
  - `frontend/src/components/returns/Returns.tsx`

### 3.252 `frontend/src/components/returns/NewSupplierReturnModal.tsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `react`
- Internal dependencies (2)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/utils/actionGuards.ts`
- Referenced by (1)
  - `frontend/src/components/returns/Returns.tsx`

### 3.253 `frontend/src/components/returns/ReturnDetailModal.tsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext.tsx`
  - `../../utils/formatters.ts`
- Internal dependencies (2)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/utils/formatters.ts`
- Referenced by (1)
  - `frontend/src/components/returns/Returns.tsx`

### 3.254 `frontend/src/components/returns/Returns.tsx`

- Declared exports: `function`
- Imports (19)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../../utils/actionHistory.ts`
  - `../../utils/csv`
  - `../../utils/formatters`
  - `../../utils/groupedRecords.ts`
  - `../../utils/historyHelpers.ts`
  - `../shared/ActionHistoryBar`
  - `../shared/ExportMenu`
  - `../shared/FilterMenu`
  - `../shared/PaginationControls`
  - `../shared/pageActivity`
  - `./EditReturnModal`
  - `./NewReturnModal`
  - `./NewSupplierReturnModal`
  - `./ReturnDetailModal`
  - `./ReturnsListSurface`
  - `lucide-react`
  - `react`
- Internal dependencies (17)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/returns/EditReturnModal.tsx`
  - `frontend/src/components/returns/NewReturnModal.tsx`
  - `frontend/src/components/returns/NewSupplierReturnModal.tsx`
  - `frontend/src/components/returns/ReturnDetailModal.tsx`
  - `frontend/src/components/returns/ReturnsListSurface.tsx`
  - `frontend/src/components/shared/ActionHistoryBar.tsx`
  - `frontend/src/components/shared/ExportMenu.tsx`
  - `frontend/src/components/shared/FilterMenu.tsx`
  - `frontend/src/components/shared/PaginationControls.tsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/utils/csv.ts`
  - `frontend/src/utils/formatters.ts`
  - `frontend/src/utils/groupedRecords.ts`
  - `frontend/src/utils/historyHelpers.ts`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.255 `frontend/src/components/returns/ReturnsListSurface.tsx`

- Declared exports: `function`
- Imports (2)
  - `lucide-react`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/returns/Returns.tsx`

### 3.256 `frontend/src/components/sales/ExportModal.tsx`

- Declared exports: `function`
- Imports (5)
  - `../../utils/loaders.ts`
  - `../shared/Modal`
  - `./StatusBadge`
  - `lucide-react`
  - `react`
- Internal dependencies (3)
  - `frontend/src/components/sales/StatusBadge.tsx`
  - `frontend/src/components/shared/Modal.tsx`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/components/sales/Sales.tsx`

### 3.257 `frontend/src/components/sales/SaleDetailModal.tsx`

- Declared exports: `function`
- Imports (3)
  - `../../utils/formatters.ts`
  - `./StatusBadge.tsx`
  - `react`
- Internal dependencies (2)
  - `frontend/src/components/sales/StatusBadge.tsx`
  - `frontend/src/utils/formatters.ts`
- Referenced by (1)
  - `frontend/src/components/sales/Sales.tsx`

### 3.258 `frontend/src/components/sales/Sales.tsx`

- Declared exports: `function`
- Imports (22)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../../utils/actionHistory.ts`
  - `../../utils/bulkOps.ts`
  - `../../utils/csv`
  - `../../utils/deviceInfo`
  - `../../utils/formatters`
  - `../../utils/groupedRecords.ts`
  - `../receipt/Receipt`
  - `../shared/ActionHistoryBar`
  - `../shared/ExportMenu`
  - `../shared/FilterMenu`
  - `../shared/PaginationControls`
  - `../shared/PortalMenu`
  - `../shared/pageActivity`
  - `./ExportModal`
  - `./SaleDetailModal`
  - `./SalesImportModal`
  - `./SalesListSurface`
  - `./StatusBadge`
  - `lucide-react`
  - `react`
- Internal dependencies (20)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/receipt/Receipt.tsx`
  - `frontend/src/components/sales/ExportModal.tsx`
  - `frontend/src/components/sales/SaleDetailModal.tsx`
  - `frontend/src/components/sales/SalesImportModal.tsx`
  - `frontend/src/components/sales/SalesListSurface.tsx`
  - `frontend/src/components/sales/StatusBadge.tsx`
  - `frontend/src/components/shared/ActionHistoryBar.tsx`
  - `frontend/src/components/shared/ExportMenu.tsx`
  - `frontend/src/components/shared/FilterMenu.tsx`
  - `frontend/src/components/shared/PaginationControls.tsx`
  - `frontend/src/components/shared/PortalMenu.tsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/utils/bulkOps.ts`
  - `frontend/src/utils/csv.ts`
  - `frontend/src/utils/deviceInfo.ts`
  - `frontend/src/utils/formatters.ts`
  - `frontend/src/utils/groupedRecords.ts`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.259 `frontend/src/components/sales/SalesImportModal.tsx`

- Declared exports: `function`
- Imports (5)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../../utils/csvRowCounter.ts`
  - `../shared/Modal`
  - `react`
- Internal dependencies (4)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/shared/Modal.tsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/csvRowCounter.ts`
- Referenced by (1)
  - `frontend/src/components/sales/Sales.tsx`

### 3.260 `frontend/src/components/sales/salesImportWorker.ts`

- Declared exports: none detected
- Imports (1)
  - `../../utils/csvRowCounter`
- Internal dependencies (1)
  - `frontend/src/utils/csvRowCounter.ts`
- Referenced by (0)
  - none

### 3.261 `frontend/src/components/sales/SalesListSurface.tsx`

- Declared exports: `function`
- Imports (3)
  - `./StatusBadge.tsx`
  - `lucide-react`
  - `react`
- Internal dependencies (1)
  - `frontend/src/components/sales/StatusBadge.tsx`
- Referenced by (1)
  - `frontend/src/components/sales/Sales.tsx`

### 3.262 `frontend/src/components/sales/StatusBadge.tsx`

- Declared exports: `ALL_STATUSES`, `STATUS_COLORS`, `STATUS_LABELS`, `function`, `getStatusLabel`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (6)
  - `frontend/src/components/pos/POS.tsx`
  - `frontend/src/components/receipt/Receipt.tsx`
  - `frontend/src/components/sales/ExportModal.tsx`
  - `frontend/src/components/sales/SaleDetailModal.tsx`
  - `frontend/src/components/sales/Sales.tsx`
  - `frontend/src/components/sales/SalesListSurface.tsx`

### 3.263 `frontend/src/components/server/ServerPage.tsx`

- Declared exports: `function`
- Imports (5)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../shared/PageHeader`
  - `../shared/pageActivity`
  - `react`
- Internal dependencies (4)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/shared/PageHeader.tsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/actionGuards.ts`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.264 `frontend/src/components/shared/ActionHistoryBar.tsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext.tsx`
  - `lucide-react`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.tsx`
- Referenced by (17)
  - `frontend/src/components/branches/Branches.tsx`
  - `frontend/src/components/contacts/CustomersTab.tsx`
  - `frontend/src/components/contacts/DeliveryTab.tsx`
  - `frontend/src/components/contacts/SuppliersTab.tsx`
  - `frontend/src/components/custom-tables/CustomTables.tsx`
  - `frontend/src/components/files/FilesPage.tsx`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/inventory/InventoryMovementsSurface.tsx`
  - `frontend/src/components/products/lookups/ManageBrandsModal.tsx`
  - `frontend/src/components/products/lookups/ManageCategoriesModal.tsx`
  - `frontend/src/components/products/lookups/ManageUnitsModal.tsx`
  - `frontend/src/components/products/Products.tsx`
  - `frontend/src/components/returns/Returns.tsx`
  - `frontend/src/components/sales/Sales.tsx`
  - `frontend/src/components/users/UserProfileModal.tsx`
  - `frontend/src/components/users/Users.tsx`
  - `frontend/src/components/utils-settings/Backup.tsx`

### 3.265 `frontend/src/components/shared/BackgroundImportTracker.tsx`

- Declared exports: `function`
- Imports (7)
  - `../../AppContext.tsx`
  - `../../api/http.ts`
  - `../../utils/actionGuards.ts`
  - `../../utils/importJobRefresh.ts`
  - `../../utils/loaders.ts`
  - `lucide-react`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/api/http.ts`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/importJobRefresh.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.266 `frontend/src/components/shared/ExportMenu.tsx`

- Declared exports: `function`
- Imports (3)
  - `./PortalMenu`
  - `lucide-react`
  - `react`
- Internal dependencies (1)
  - `frontend/src/components/shared/PortalMenu.tsx`
- Referenced by (7)
  - `frontend/src/components/dashboard/Dashboard.tsx`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/inventory/InventoryMovementsSurface.tsx`
  - `frontend/src/components/products/surfaces/HeaderActions.tsx`
  - `frontend/src/components/returns/Returns.tsx`
  - `frontend/src/components/sales/Sales.tsx`
  - `frontend/src/components/utils-settings/AuditLog.tsx`

### 3.267 `frontend/src/components/shared/FilterMenu.tsx`

- Declared exports: `function`
- Imports (3)
  - `./PortalMenu`
  - `lucide-react`
  - `react`
- Internal dependencies (1)
  - `frontend/src/components/shared/PortalMenu.tsx`
- Referenced by (8)
  - `frontend/src/components/contacts/CustomersTab.tsx`
  - `frontend/src/components/contacts/DeliveryTab.tsx`
  - `frontend/src/components/contacts/SuppliersTab.tsx`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/products/Products.tsx`
  - `frontend/src/components/returns/Returns.tsx`
  - `frontend/src/components/sales/Sales.tsx`
  - `frontend/src/components/utils-settings/AuditLog.tsx`

### 3.268 `frontend/src/components/shared/globalScroll.ts`

- Declared exports: `getScrollTarget`, `getScrollToPosition`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/App.tsx`
  - `frontend/tests/globalScrollControls.test.ts`

### 3.269 `frontend/src/components/shared/ImageGalleryLightbox.tsx`

- Declared exports: `function`
- Imports (2)
  - `lucide-react`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `frontend/src/components/catalog/CatalogPreviewSurface.tsx`
  - `frontend/src/components/pos/POS.tsx`
  - `frontend/src/components/products/Products.tsx`

### 3.270 `frontend/src/components/shared/LoadingWatchdog.tsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (6)
  - `frontend/src/components/contacts/shared.tsx`
  - `frontend/src/components/dashboard/Dashboard.tsx`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx`
  - `frontend/src/components/utils-settings/Backup.tsx`
  - `frontend/src/components/utils-settings/Settings.tsx`

### 3.271 `frontend/src/components/shared/Modal.tsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (22)
  - `frontend/src/components/branches/Branches.tsx`
  - `frontend/src/components/contacts/ContactImportModal.tsx`
  - `frontend/src/components/contacts/Contacts.tsx`
  - `frontend/src/components/contacts/CustomerFormModal.tsx`
  - `frontend/src/components/contacts/DeliveryTab.tsx`
  - `frontend/src/components/contacts/shared.tsx`
  - `frontend/src/components/contacts/SuppliersTab.tsx`
  - `frontend/src/components/files/FilePickerModal.tsx`
  - `frontend/src/components/inventory/InventoryImportModal.tsx`
  - `frontend/src/components/products/forms/ProductForm.tsx`
  - `frontend/src/components/products/forms/VariantFormModal.tsx`
  - `frontend/src/components/products/import/BulkImportModal.tsx`
  - `frontend/src/components/products/lookups/ManageBrandsModal.tsx`
  - `frontend/src/components/products/lookups/ManageCategoriesModal.tsx`
  - `frontend/src/components/products/lookups/ManageUnitsModal.tsx`
  - `frontend/src/components/products/Products.tsx`
  - `frontend/src/components/products/scanning/BarcodeScannerModal.tsx`
  - `frontend/src/components/sales/ExportModal.tsx`
  - `frontend/src/components/sales/SalesImportModal.tsx`
  - `frontend/src/components/shared/WriteConflictModal.tsx`
  - `frontend/src/components/users/UserProfileModal.tsx`
  - `frontend/src/components/users/Users.tsx`

### 3.272 `frontend/src/components/shared/navigationConfig.ts`

- Declared exports: `DEFAULT_MOBILE_PINNED`, `NAV_ITEMS`, `orderNavItems`, `parseNavSetting`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `frontend/src/components/navigation/Sidebar.tsx`
  - `frontend/src/components/utils-settings/Settings.tsx`
  - `frontend/tests/navigationConfig.test.ts`

### 3.273 `frontend/src/components/shared/NotificationCenter.tsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext.tsx`
  - `lucide-react`
  - `react`
  - `react-dom`
- Internal dependencies (1)
  - `frontend/src/AppContext.tsx`
- Referenced by (2)
  - `frontend/src/App.tsx`
  - `frontend/src/components/navigation/Sidebar.tsx`

### 3.274 `frontend/src/components/shared/pageActivity.ts`

- Declared exports: `useIsPageActive`
- Imports (2)
  - `../../AppContext`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.tsx`
- Referenced by (15)
  - `frontend/src/components/branches/Branches.tsx`
  - `frontend/src/components/catalog/CatalogPage.tsx`
  - `frontend/src/components/contacts/Contacts.tsx`
  - `frontend/src/components/dashboard/Dashboard.tsx`
  - `frontend/src/components/files/FilesPage.tsx`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx`
  - `frontend/src/components/pos/POS.tsx`
  - `frontend/src/components/products/Products.tsx`
  - `frontend/src/components/returns/Returns.tsx`
  - `frontend/src/components/sales/Sales.tsx`
  - `frontend/src/components/server/ServerPage.tsx`
  - `frontend/src/components/users/Users.tsx`
  - `frontend/src/components/utils-settings/AuditLog.tsx`
  - `frontend/src/components/utils-settings/Backup.tsx`

### 3.275 `frontend/src/components/shared/PageHeader.tsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (6)
  - `frontend/src/components/branches/Branches.tsx`
  - `frontend/src/components/contacts/Contacts.tsx`
  - `frontend/src/components/files/FilesPage.tsx`
  - `frontend/src/components/server/ServerPage.tsx`
  - `frontend/src/components/utils-settings/Backup.tsx`
  - `frontend/src/components/utils-settings/Settings.tsx`

### 3.276 `frontend/src/components/shared/PaginationControls.tsx`

- Declared exports: `PAGE_SIZE_OPTIONS`, `clampPage`, `function`, `paginateItems`
- Imports (2)
  - `lucide-react`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (9)
  - `frontend/src/components/catalog/CatalogProductsSection.tsx`
  - `frontend/src/components/contacts/shared.tsx`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/inventory/InventoryMovementsSurface.tsx`
  - `frontend/src/components/pos/POS.tsx`
  - `frontend/src/components/products/Products.tsx`
  - `frontend/src/components/returns/Returns.tsx`
  - `frontend/src/components/sales/Sales.tsx`
  - `frontend/src/components/utils-settings/AuditLog.tsx`

### 3.277 `frontend/src/components/shared/PortalMenu.tsx`

- Declared exports: `ThreeDotPortal`, `function`
- Imports (3)
  - `lucide-react`
  - `react`
  - `react-dom`
- Internal dependencies (0)
  - none
- Referenced by (9)
  - `frontend/src/components/catalog/CatalogPreviewSurface.tsx`
  - `frontend/src/components/contacts/shared.tsx`
  - `frontend/src/components/inventory/InventoryMovementsSurface.tsx`
  - `frontend/src/components/products/surfaces/HeaderActions.tsx`
  - `frontend/src/components/products/surfaces/ProductRowParts.tsx`
  - `frontend/src/components/sales/Sales.tsx`
  - `frontend/src/components/shared/ExportMenu.tsx`
  - `frontend/src/components/shared/FilterMenu.tsx`
  - `frontend/src/components/users/Users.tsx`

### 3.278 `frontend/src/components/shared/QuickPreferenceToggles.tsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext.tsx`
  - `lucide-react`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.tsx`
- Referenced by (3)
  - `frontend/src/App.tsx`
  - `frontend/src/components/auth/Login.tsx`
  - `frontend/src/components/navigation/Sidebar.tsx`

### 3.279 `frontend/src/components/shared/SectionSwitcher.tsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx`
  - `frontend/src/components/utils-settings/Backup.tsx`
  - `frontend/src/components/utils-settings/Settings.tsx`

### 3.280 `frontend/src/components/shared/WriteConflictModal.tsx`

- Declared exports: `function`
- Imports (1)
  - `./Modal`
- Internal dependencies (1)
  - `frontend/src/components/shared/Modal.tsx`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.281 `frontend/src/components/users/PermissionEditor.tsx`

- Declared exports: `PERMISSION_DEFS`, `PERMISSION_SECTIONS`, `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/users/UserDetailSheet.tsx`
  - `frontend/src/components/users/Users.tsx`

### 3.282 `frontend/src/components/users/UserDetailSheet.tsx`

- Declared exports: `function`
- Imports (2)
  - `../../utils/formatters`
  - `./PermissionEditor`
- Internal dependencies (2)
  - `frontend/src/components/users/PermissionEditor.tsx`
  - `frontend/src/utils/formatters.ts`
- Referenced by (1)
  - `frontend/src/components/users/Users.tsx`

### 3.283 `frontend/src/components/users/UserProfileModal.tsx`

- Declared exports: `function`
- Imports (10)
  - `../../AppContext.tsx`
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
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/files/FilePickerModal.tsx`
  - `frontend/src/components/shared/ActionHistoryBar.tsx`
  - `frontend/src/components/shared/Modal.tsx`
  - `frontend/src/components/utils-settings/OtpModal.tsx`
  - `frontend/src/constants.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (2)
  - `frontend/src/components/navigation/Sidebar.tsx`
  - `frontend/src/components/users/Users.tsx`

### 3.284 `frontend/src/components/users/Users.tsx`

- Declared exports: `function`
- Imports (14)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../../utils/actionHistory.ts`
  - `../../utils/formatters`
  - `../../utils/historyHelpers.ts`
  - `../shared/ActionHistoryBar`
  - `../shared/Modal`
  - `../shared/PortalMenu`
  - `../shared/pageActivity`
  - `./PermissionEditor`
  - `./UserDetailSheet`
  - `./UserProfileModal`
  - `lucide-react`
  - `react`
- Internal dependencies (12)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/shared/ActionHistoryBar.tsx`
  - `frontend/src/components/shared/Modal.tsx`
  - `frontend/src/components/shared/PortalMenu.tsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/components/users/PermissionEditor.tsx`
  - `frontend/src/components/users/UserDetailSheet.tsx`
  - `frontend/src/components/users/UserProfileModal.tsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/utils/formatters.ts`
  - `frontend/src/utils/historyHelpers.ts`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.285 `frontend/src/components/utils-settings/AuditLog.tsx`

- Declared exports: `function`
- Imports (10)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../../utils/csv`
  - `../../utils/groupedRecords.ts`
  - `../shared/ExportMenu`
  - `../shared/FilterMenu`
  - `../shared/PaginationControls`
  - `../shared/pageActivity`
  - `lucide-react`
  - `react`
- Internal dependencies (8)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/shared/ExportMenu.tsx`
  - `frontend/src/components/shared/FilterMenu.tsx`
  - `frontend/src/components/shared/PaginationControls.tsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/csv.ts`
  - `frontend/src/utils/groupedRecords.ts`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.286 `frontend/src/components/utils-settings/Backup.tsx`

- Declared exports: `function`
- Imports (10)
  - `../../AppContext.tsx`
  - `../../utils/actionHistory.ts`
  - `../shared/ActionHistoryBar`
  - `../shared/LoadingWatchdog`
  - `../shared/PageHeader`
  - `../shared/SectionSwitcher`
  - `../shared/pageActivity`
  - `./ResetData`
  - `lucide-react`
  - `react`
- Internal dependencies (8)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/shared/ActionHistoryBar.tsx`
  - `frontend/src/components/shared/LoadingWatchdog.tsx`
  - `frontend/src/components/shared/PageHeader.tsx`
  - `frontend/src/components/shared/SectionSwitcher.tsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/components/utils-settings/ResetData.tsx`
  - `frontend/src/utils/actionHistory.ts`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.287 `frontend/src/components/utils-settings/FontFamilyPicker.tsx`

- Declared exports: `function`
- Imports (2)
  - `lucide-react`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/utils-settings/Settings.tsx`

### 3.288 `frontend/src/components/utils-settings/index.ts`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.289 `frontend/src/components/utils-settings/OtpModal.tsx`

- Declared exports: `function`
- Imports (3)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `react`
- Internal dependencies (2)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/utils/actionGuards.ts`
- Referenced by (2)
  - `frontend/src/components/users/UserProfileModal.tsx`
  - `frontend/src/components/utils-settings/Settings.tsx`

### 3.290 `frontend/src/components/utils-settings/ResetData.tsx`

- Declared exports: none detected
- Imports (6)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../../utils/appRefresh`
  - `../../utils/loaders.ts`
  - `lucide-react`
  - `react`
- Internal dependencies (4)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/appRefresh.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/components/utils-settings/Backup.tsx`

### 3.291 `frontend/src/components/utils-settings/Settings.tsx`

- Declared exports: `function`
- Imports (13)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../../utils/favicon.ts`
  - `../../utils/loaders.ts`
  - `../shared/LoadingWatchdog`
  - `../shared/PageHeader`
  - `../shared/SectionSwitcher`
  - `../shared/navigationConfig`
  - `./FontFamilyPicker`
  - `./OtpModal`
  - `./settingsConflict.ts`
  - `lucide-react`
  - `react`
- Internal dependencies (11)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/shared/LoadingWatchdog.tsx`
  - `frontend/src/components/shared/PageHeader.tsx`
  - `frontend/src/components/shared/SectionSwitcher.tsx`
  - `frontend/src/components/shared/navigationConfig.ts`
  - `frontend/src/components/utils-settings/FontFamilyPicker.tsx`
  - `frontend/src/components/utils-settings/OtpModal.tsx`
  - `frontend/src/components/utils-settings/settingsConflict.ts`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/favicon.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.292 `frontend/src/components/utils-settings/settingsConflict.ts`

- Declared exports: `buildSettingsConflictState`, `diffSettingsConflictFields`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/utils-settings/Settings.tsx`
  - `frontend/tests/settingsConflictHelpers.test.ts`

### 3.293 `frontend/src/constants.ts`

- Declared exports: `CURRENCY`, `DELIVERY_FEE_PAYER`, `EMPTY_CUSTOMER`, `LAYOUT`, `PAYMENT_METHODS`, `STOCK`, `STORAGE_KEYS`, `SYNC`, `WRITE_CHANNELS`, `createEmptyOrder`, `formatDate`, `isNetworkError`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (8)
  - `frontend/src/api/http.ts`
  - `frontend/src/api/methods.ts`
  - `frontend/src/api/websocket.ts`
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/auth/Login.tsx`
  - `frontend/src/components/users/UserProfileModal.tsx`
  - `frontend/src/platform/runtime/clientRuntime.ts`
  - `frontend/src/web-api.ts`

### 3.294 `frontend/src/index.tsx`

- Declared exports: none detected
- Imports (9)
  - `./App.tsx`
  - `./AppContext.tsx`
  - `./app/appShellUtils.ts`
  - `./styles/main.css`
  - `@fontsource/noto-sans-khmer/400.css`
  - `@fontsource/noto-sans-khmer/500.css`
  - `@fontsource/noto-sans-khmer/600.css`
  - `react`
  - `react-dom/client`
- Internal dependencies (4)
  - `frontend/src/App.tsx`
  - `frontend/src/AppContext.tsx`
  - `frontend/src/app/appShellUtils.ts`
  - `frontend/src/styles/main.css`
- Referenced by (0)
  - none

### 3.295 `frontend/src/platform/runtime/clientRuntime.ts`

- Declared exports: `buildQueuedOperationScope`, `doesQueuedScopeMatchCurrent`, `normalizeRuntimeDescriptor`, `readStoredRuntimeDescriptor`, `resetClientRuntimeState`, `sanitizeSyncServerUrl`, `shouldResetForRuntimeChange`, `writeStoredRuntimeDescriptor`
- Imports (2)
  - `../../api/localDb.ts`
  - `../../constants.ts`
- Internal dependencies (2)
  - `frontend/src/api/localDb.ts`
  - `frontend/src/constants.ts`
- Referenced by (2)
  - `frontend/src/api/methods.ts`
  - `frontend/src/web-api.ts`

### 3.296 `frontend/src/platform/storage/storagePolicy.ts`

- Declared exports: `DRIVE_SYNC_STATUS_COOLDOWN_KEY`, `DRIVE_SYNC_STATUS_COOLDOWN_MS`, `LIVE_SERVER_SENSITIVE_MIRROR_TABLES`, `NOTIFICATION_SUMMARY_MISSING_TTL_MS`, `NOTIFICATION_SUMMARY_MISSING_UNTIL_KEY`, `isCooldownActive`, `maxStoredNumber`, `shouldPersistLocalMirror`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.297 `frontend/src/runtime/runtimeErrorClassifier.ts`

- Declared exports: `isFirstPartyBuiltAssetSource`, `isGuardableStyleSheetError`, `isKnownBridgeMessage`, `isKnownEvalCspNoise`, `isKnownStyleInjectionNoise`, `isLikelyInjectedRuntimeSource`, `shouldSuppressRuntimeError`, `shouldSuppressSecurityPolicyViolation`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.298 `frontend/src/types/jsx-modules.d.ts`

- Declared exports: `AppProvider`, `CustomersTab`, `DeliveryTab`, `PERMISSION_DEFS`, `ProductImagePlaceholder`, `ProductImg`, `SuppliersTab`, `component`, `isBrokenLocalizedString`, `useApp`, `useSync`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.299 `frontend/src/types/receiptContracts.ts`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `frontend/src/components/receipt-settings/PrintSettings.tsx`
  - `frontend/src/components/receipt-settings/ReceiptPreview.tsx`
  - `frontend/src/utils/printReceipt.ts`
  - `frontend/src/utils/receiptAppliedConfig.ts`

### 3.300 `frontend/src/types/settingsContracts.ts`

- Declared exports: `SETTINGS_REFRESH_CHANNELS`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/utils/settingsWriteOptions.ts`

### 3.301 `frontend/src/utils/actionGuards.ts`

- Declared exports: `beginKeyedAction`, `beginNamedAction`, `beginSingleAction`, `finishKeyedAction`, `finishNamedAction`, `finishSingleAction`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (33)
  - `frontend/src/components/branches/Branches.tsx`
  - `frontend/src/components/branches/TransferModal.tsx`
  - `frontend/src/components/catalog/CatalogPage.tsx`
  - `frontend/src/components/contacts/ContactImportModal.tsx`
  - `frontend/src/components/contacts/CustomersTab.tsx`
  - `frontend/src/components/contacts/DeliveryTab.tsx`
  - `frontend/src/components/contacts/SuppliersTab.tsx`
  - `frontend/src/components/custom-tables/CustomTables.tsx`
  - `frontend/src/components/files/FilesPage.tsx`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/inventory/InventoryImportModal.tsx`
  - `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx`
  - `frontend/src/components/products/forms/BranchStockAdjuster.tsx`
  - `frontend/src/components/products/forms/BulkAddStockModal.tsx`
  - `frontend/src/components/products/forms/VariantFormModal.tsx`
  - `frontend/src/components/products/import/BulkImportModal.tsx`
  - `frontend/src/components/products/lookups/ManageBrandsModal.tsx`
  - `frontend/src/components/products/lookups/ManageCategoriesModal.tsx`
  - `frontend/src/components/products/lookups/ManageUnitsModal.tsx`
  - `frontend/src/components/products/Products.tsx`
  - `frontend/src/components/returns/EditReturnModal.tsx`
  - `frontend/src/components/returns/NewReturnModal.tsx`
  - `frontend/src/components/returns/NewSupplierReturnModal.tsx`
  - `frontend/src/components/returns/Returns.tsx`
  - `frontend/src/components/sales/Sales.tsx`
  - `frontend/src/components/sales/SalesImportModal.tsx`
  - `frontend/src/components/server/ServerPage.tsx`
  - `frontend/src/components/shared/BackgroundImportTracker.tsx`
  - `frontend/src/components/users/Users.tsx`
  - `frontend/src/components/utils-settings/AuditLog.tsx`
  - `frontend/src/components/utils-settings/OtpModal.tsx`
  - `frontend/src/components/utils-settings/ResetData.tsx`
  - `frontend/src/components/utils-settings/Settings.tsx`

### 3.302 `frontend/src/utils/actionHistory.ts`

- Declared exports: `useActionHistory`
- Imports (2)
  - `../AppContext.tsx`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.tsx`
- Referenced by (16)
  - `frontend/src/components/branches/Branches.tsx`
  - `frontend/src/components/contacts/CustomersTab.tsx`
  - `frontend/src/components/contacts/DeliveryTab.tsx`
  - `frontend/src/components/contacts/SuppliersTab.tsx`
  - `frontend/src/components/custom-tables/CustomTables.tsx`
  - `frontend/src/components/files/FilesPage.tsx`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/products/lookups/ManageBrandsModal.tsx`
  - `frontend/src/components/products/lookups/ManageCategoriesModal.tsx`
  - `frontend/src/components/products/lookups/ManageUnitsModal.tsx`
  - `frontend/src/components/products/Products.tsx`
  - `frontend/src/components/returns/Returns.tsx`
  - `frontend/src/components/sales/Sales.tsx`
  - `frontend/src/components/users/UserProfileModal.tsx`
  - `frontend/src/components/users/Users.tsx`
  - `frontend/src/components/utils-settings/Backup.tsx`

### 3.303 `frontend/src/utils/appRefresh.ts`

- Declared exports: `DEFAULT_REFRESH_CHANNELS`, `normalizeRefreshChannels`, `refreshAppData`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `frontend/src/api/methods.ts`
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/utils-settings/ResetData.tsx`
  - `frontend/src/utils/settingsRefresh.ts`
  - `frontend/tests/appRefresh.test.ts`

### 3.304 `frontend/src/utils/bulkOps.ts`

- Declared exports: `runConcurrentTasks`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (8)
  - `frontend/src/components/branches/Branches.tsx`
  - `frontend/src/components/contacts/CustomersTab.tsx`
  - `frontend/src/components/contacts/DeliveryTab.tsx`
  - `frontend/src/components/contacts/SuppliersTab.tsx`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/products/Products.tsx`
  - `frontend/src/components/sales/Sales.tsx`
  - `frontend/tests/bulkOps.test.ts`

### 3.305 `frontend/src/utils/color.ts`

- Declared exports: `getContrastingTextColor`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/products/Products.tsx`
  - `frontend/src/components/products/surfaces/ProductDetailModal.tsx`

### 3.306 `frontend/src/utils/csv.ts`

- Declared exports: `UTF8_BOM`, `buildCSV`, `buildZip`, `buildZipInWorker`, `downloadBlob`, `downloadCSV`, `downloadZipFiles`, `downloadZipFilesAsync`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (14)
  - `frontend/src/api/localDb.ts`
  - `frontend/src/components/contacts/Contacts.tsx`
  - `frontend/src/components/contacts/CustomersTab.tsx`
  - `frontend/src/components/contacts/DeliveryTab.tsx`
  - `frontend/src/components/contacts/SuppliersTab.tsx`
  - `frontend/src/components/dashboard/Dashboard.tsx`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/products/Products.tsx`
  - `frontend/src/components/returns/Returns.tsx`
  - `frontend/src/components/sales/Sales.tsx`
  - `frontend/src/components/utils-settings/AuditLog.tsx`
  - `frontend/src/utils/csvExportWorker.ts`
  - `frontend/src/utils/exportPackage.ts`
  - `frontend/tests/exportPackages.test.ts`

### 3.307 `frontend/src/utils/csvExportWorker.ts`

- Declared exports: none detected
- Imports (1)
  - `./csv.ts`
- Internal dependencies (1)
  - `frontend/src/utils/csv.ts`
- Referenced by (0)
  - none

### 3.308 `frontend/src/utils/csvImport.ts`

- Declared exports: `decodeTextBuffer`, `detectCsvDelimiter`, `normalizeCsvKey`, `normalizeCsvMoney`, `normalizeCsvPercent`, `normalizeNumericText`, `parseCsvNumber`, `parseCsvRows`, `parseDelimitedRows`, `parseRequiredCsvNumber`, `splitCsvLine`
- Imports (1)
  - `./pricing.ts`
- Internal dependencies (1)
  - `frontend/src/utils/pricing.ts`
- Referenced by (3)
  - `frontend/src/api/localDb.ts`
  - `frontend/src/api/methods.ts`
  - `frontend/tests/csvImport.test.ts`

### 3.309 `frontend/src/utils/csvRowCounter.ts`

- Declared exports: `countCsvDataRows`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (9)
  - `frontend/src/components/contacts/ContactImportModal.tsx`
  - `frontend/src/components/contacts/contactImportWorker.ts`
  - `frontend/src/components/inventory/InventoryImportModal.tsx`
  - `frontend/src/components/inventory/inventoryImportWorker.ts`
  - `frontend/src/components/sales/SalesImportModal.tsx`
  - `frontend/src/components/sales/salesImportWorker.ts`
  - `frontend/tests/contactImportWorker.test.ts`
  - `frontend/tests/inventoryImportWorker.test.ts`
  - `frontend/tests/salesImportWorker.test.ts`

### 3.310 `frontend/src/utils/dateHelpers.ts`

- Declared exports: `offsetDate`, `todayStr`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/dashboard/Dashboard.tsx`
  - `frontend/tests/dateHelpers.test.ts`

### 3.311 `frontend/src/utils/deviceInfo.ts`

- Declared exports: `getClientDeviceInfo`, `getClientMetaHeaders`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (7)
  - `frontend/src/api/http.ts`
  - `frontend/src/api/methods.ts`
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/auth/Login.tsx`
  - `frontend/src/components/pos/POS.tsx`
  - `frontend/src/components/sales/Sales.tsx`
  - `frontend/tests/deviceInfo.test.ts`

### 3.312 `frontend/src/utils/exportPackage.ts`

- Declared exports: `buildReportManifestRows`, `buildReportPackageFiles`
- Imports (1)
  - `./csv.ts`
- Internal dependencies (1)
  - `frontend/src/utils/csv.ts`
- Referenced by (3)
  - `frontend/src/components/dashboard/Dashboard.tsx`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/tests/exportPackages.test.ts`

### 3.313 `frontend/src/utils/exportReports.tsx`

- Declared exports: `buildStandaloneReportHtml`
- Imports (4)
  - `../components/dashboard/charts`
  - `./formatters`
  - `react`
  - `react-dom/server`
- Internal dependencies (2)
  - `frontend/src/components/dashboard/charts/index.ts`
  - `frontend/src/utils/formatters.ts`
- Referenced by (2)
  - `frontend/src/components/dashboard/Dashboard.tsx`
  - `frontend/src/components/inventory/Inventory.tsx`

### 3.314 `frontend/src/utils/favicon.ts`

- Declared exports: `createCircularFaviconDataUrl`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `frontend/src/App.tsx`
  - `frontend/src/components/catalog/CatalogPage.tsx`
  - `frontend/src/components/utils-settings/Settings.tsx`

### 3.315 `frontend/src/utils/formatters.ts`

- Declared exports: `fmtCount`, `fmtDate`, `fmtShort`, `fmtTime`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (17)
  - `frontend/src/components/contacts/CustomersTab.tsx`
  - `frontend/src/components/contacts/DeliveryTab.tsx`
  - `frontend/src/components/contacts/SuppliersTab.tsx`
  - `frontend/src/components/dashboard/charts/BarChart.tsx`
  - `frontend/src/components/dashboard/charts/DonutChart.tsx`
  - `frontend/src/components/dashboard/charts/LineChart.tsx`
  - `frontend/src/components/dashboard/Dashboard.tsx`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/returns/NewReturnModal.tsx`
  - `frontend/src/components/returns/ReturnDetailModal.tsx`
  - `frontend/src/components/returns/Returns.tsx`
  - `frontend/src/components/sales/SaleDetailModal.tsx`
  - `frontend/src/components/sales/Sales.tsx`
  - `frontend/src/components/users/UserDetailSheet.tsx`
  - `frontend/src/components/users/Users.tsx`
  - `frontend/src/utils/exportReports.tsx`
  - `frontend/tests/formatters.test.ts`

### 3.316 `frontend/src/utils/groupedRecords.ts`

- Declared exports: `buildAlphabetActionSections`, `buildTimeActionSections`, `getAlphabetInitialSection`, `getAvailableYears`, `getTimeGroupingMode`, `getTimeParts`, `matchesYearMonthFilters`, `toggleIdSet`
- Imports (1)
  - `./initials.ts`
- Internal dependencies (1)
  - `frontend/src/utils/initials.ts`
- Referenced by (10)
  - `frontend/src/components/contacts/CustomersTab.tsx`
  - `frontend/src/components/contacts/DeliveryTab.tsx`
  - `frontend/src/components/contacts/SuppliersTab.tsx`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/products/helpers/productFilterHelpers.ts`
  - `frontend/src/components/products/Products.tsx`
  - `frontend/src/components/returns/Returns.tsx`
  - `frontend/src/components/sales/Sales.tsx`
  - `frontend/src/components/utils-settings/AuditLog.tsx`
  - `frontend/tests/groupedRecords.test.ts`

### 3.317 `frontend/src/utils/historyHelpers.ts`

- Declared exports: `cloneHistorySnapshot`, `extractHistoryResultId`, `resolveCreatedHistorySnapshot`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (11)
  - `frontend/src/components/branches/Branches.tsx`
  - `frontend/src/components/contacts/CustomersTab.tsx`
  - `frontend/src/components/contacts/DeliveryTab.tsx`
  - `frontend/src/components/contacts/SuppliersTab.tsx`
  - `frontend/src/components/custom-tables/CustomTables.tsx`
  - `frontend/src/components/files/FilesPage.tsx`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/products/forms/VariantFormModal.tsx`
  - `frontend/src/components/products/Products.tsx`
  - `frontend/src/components/returns/Returns.tsx`
  - `frontend/src/components/users/Users.tsx`

### 3.318 `frontend/src/utils/importJobRefresh.ts`

- Declared exports: `dispatchImportCompletionRefresh`, `getImportCompletionRefreshChannels`, `shouldDispatchImportCompletionRefresh`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/shared/BackgroundImportTracker.tsx`

### 3.319 `frontend/src/utils/index.ts`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.320 `frontend/src/utils/initials.ts`

- Declared exports: `KHMER_INITIALS`, `aggregateInitialOptions`, `buildInitialOptionsFromProducts`, `compareInitialKeys`, `getInitialKey`, `getInitialType`, `normalizeInitialText`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (8)
  - `frontend/src/components/catalog/CatalogPage.tsx`
  - `frontend/src/components/catalog/CatalogProductsSection.tsx`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/pos/POS.tsx`
  - `frontend/src/components/pos/posCore.ts`
  - `frontend/src/components/products/Products.tsx`
  - `frontend/src/utils/groupedRecords.ts`
  - `frontend/src/utils/productGrouping.ts`

### 3.321 `frontend/src/utils/loaders.ts`

- Declared exports: `DEFAULT_LOADER_TIMEOUT_MS`, `beginTrackedRequest`, `createLoaderTimeoutError`, `getFirstLoaderError`, `getLoaderErrorMessage`, `invalidateTrackedRequest`, `isTrackedRequestCurrent`, `settleLoaderMap`, `withLoaderTimeout`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (20)
  - `frontend/src/App.tsx`
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/contacts/ContactImportModal.tsx`
  - `frontend/src/components/contacts/Contacts.tsx`
  - `frontend/src/components/contacts/CustomersTab.tsx`
  - `frontend/src/components/contacts/DeliveryTab.tsx`
  - `frontend/src/components/contacts/SuppliersTab.tsx`
  - `frontend/src/components/dashboard/Dashboard.tsx`
  - `frontend/src/components/products/forms/BranchStockAdjuster.tsx`
  - `frontend/src/components/products/forms/BulkAddStockModal.tsx`
  - `frontend/src/components/products/forms/VariantFormModal.tsx`
  - `frontend/src/components/products/import/BulkImportModal.tsx`
  - `frontend/src/components/products/lookups/productLookupSnapshots.ts`
  - `frontend/src/components/receipt-settings/ReceiptSettings.tsx`
  - `frontend/src/components/returns/EditReturnModal.tsx`
  - `frontend/src/components/sales/ExportModal.tsx`
  - `frontend/src/components/shared/BackgroundImportTracker.tsx`
  - `frontend/src/components/users/UserProfileModal.tsx`
  - `frontend/src/components/utils-settings/ResetData.tsx`
  - `frontend/src/components/utils-settings/Settings.tsx`

### 3.322 `frontend/src/utils/mediaUpload.ts`

- Declared exports: `buildCacheBustedMediaPath`, `createInitialUploadState`, `isTemporaryPreviewUrl`, `reduceUploadState`, `sanitizePersistedMediaPath`
- Imports (1)
  - `./publicAssetUrls.ts`
- Internal dependencies (1)
  - `frontend/src/utils/publicAssetUrls.ts`
- Referenced by (4)
  - `frontend/src/components/catalog/CatalogEditorSurface.tsx`
  - `frontend/src/components/catalog/CatalogImageField.tsx`
  - `frontend/src/components/products/forms/ProductForm.tsx`
  - `frontend/tests/mediaUploadHelpers.test.ts`

### 3.323 `frontend/src/utils/permissions.ts`

- Declared exports: `parsePermissionMap`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/AppContext.tsx`
  - `frontend/tests/permissions.test.ts`

### 3.324 `frontend/src/utils/pricing.ts`

- Declared exports: `calculateProductDiscount`, `formatPriceNumber`, `isProductDiscountActive`, `normalizeDiscountPercent`, `normalizeDiscountType`, `normalizePriceValue`, `roundUpToDecimals`, `toFiniteNumber`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (17)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/catalog/portalCatalogDisplay.ts`
  - `frontend/src/components/dashboard/Dashboard.tsx`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/inventory/ProductDetailModal.tsx`
  - `frontend/src/components/pos/CartItem.tsx`
  - `frontend/src/components/pos/POS.tsx`
  - `frontend/src/components/pos/posCore.ts`
  - `frontend/src/components/products/forms/ProductForm.tsx`
  - `frontend/src/components/products/forms/VariantFormModal.tsx`
  - `frontend/src/components/products/helpers/productDisplayHelpers.ts`
  - `frontend/src/components/products/helpers/productFilterHelpers.ts`
  - `frontend/src/components/products/helpers/productWriteHelpers.ts`
  - `frontend/src/components/products/surfaces/ProductDetailModal.tsx`
  - `frontend/src/components/products/surfaces/ProductRowParts.tsx`
  - `frontend/src/utils/csvImport.ts`
  - `frontend/tests/pricingContacts.test.ts`

### 3.325 `frontend/src/utils/printReceipt.ts`

- Declared exports: `PRINT_DEFAULTS`, `createReceiptImageBlob`, `createReceiptPdfBlob`, `downloadReceiptImage`, `downloadReceiptPdf`, `getPaperWidthMm`, `getPrintSettings`, `normalizeReceiptContentWidth`, `openPrintableReceiptPreview`, `openReceiptPdf`, `printReceipt`, `savePrintSettings`
- Imports (1)
  - `../types/receiptContracts`
- Internal dependencies (1)
  - `frontend/src/types/receiptContracts.ts`
- Referenced by (2)
  - `frontend/src/components/receipt-settings/PrintSettings.tsx`
  - `frontend/src/components/receipt/Receipt.tsx`

### 3.326 `frontend/src/utils/productBatches.ts`

- Declared exports: `buildBatchPreview`, `getVisibleProductBatches`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/inventory/ProductDetailModal.tsx`
  - `frontend/src/components/products/surfaces/ProductDetailModal.tsx`
  - `frontend/src/components/products/surfaces/ProductRowParts.tsx`
  - `frontend/tests/productBatches.test.ts`

### 3.327 `frontend/src/utils/productGrouping.ts`

- Declared exports: `buildProductGroupSections`, `buildProductGroups`, `getNameInitialSection`, `normalizeProductGroupName`
- Imports (1)
  - `./initials.ts`
- Internal dependencies (1)
  - `frontend/src/utils/initials.ts`
- Referenced by (4)
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/pos/posCore.ts`
  - `frontend/src/components/products/Products.tsx`
  - `frontend/tests/productGrouping.test.ts`

### 3.328 `frontend/src/utils/publicAssetUrls.ts`

- Declared exports: `getStoredPublicAssetBaseUrl`, `resolvePublicAssetUrl`
- Imports (1)
  - `../api/http.ts`
- Internal dependencies (1)
  - `frontend/src/api/http.ts`
- Referenced by (7)
  - `frontend/src/components/contacts/ContactImportModal.tsx`
  - `frontend/src/components/files/FilePickerModal.tsx`
  - `frontend/src/components/files/FilesPage.tsx`
  - `frontend/src/components/pos/POS.tsx`
  - `frontend/src/components/products/helpers/productGalleryHelpers.ts`
  - `frontend/src/components/products/shared/primitives.tsx`
  - `frontend/src/utils/mediaUpload.ts`

### 3.329 `frontend/src/utils/receiptAppliedConfig.ts`

- Declared exports: `DEFAULT_RECEIPT_PRINT_SETTINGS`, `DEFAULT_RECEIPT_TEMPLATE`, `RECEIPT_PRINT_SETTINGS_STORAGE_KEY`, `buildAppliedReceiptConfig`, `normalizeReceiptPrintSettings`, `normalizeReceiptTemplate`, `readReceiptPrintSettingsFromSettings`, `serializeReceiptPrintSettings`, `serializeReceiptTemplateValue`
- Imports (1)
  - `../types/receiptContracts`
- Internal dependencies (1)
  - `frontend/src/types/receiptContracts.ts`
- Referenced by (3)
  - `frontend/src/components/receipt-settings/ReceiptPreview.tsx`
  - `frontend/src/components/receipt-settings/ReceiptSettings.tsx`
  - `frontend/src/components/receipt/Receipt.tsx`

### 3.330 `frontend/src/utils/scriptTypography.ts`

- Declared exports: `containsKhmerScript`, `getKhmerTextProps`, `withKhmerTextClass`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (6)
  - `frontend/src/components/catalog/CatalogProductsSection.tsx`
  - `frontend/src/components/inventory/InventoryProductsSurface.tsx`
  - `frontend/src/components/pos/CartItem.tsx`
  - `frontend/src/components/pos/POS.tsx`
  - `frontend/src/components/products/Products.tsx`
  - `frontend/tests/scriptTypography.test.ts`

### 3.331 `frontend/src/utils/settingsRefresh.ts`

- Declared exports: `CATEGORY_REFRESH_CHANNELS`, `UNIT_REFRESH_CHANNELS`, `getSettingsRefreshChannels`
- Imports (1)
  - `./appRefresh.ts`
- Internal dependencies (1)
  - `frontend/src/utils/appRefresh.ts`
- Referenced by (0)
  - none

### 3.332 `frontend/src/utils/settingsWriteOptions.ts`

- Declared exports: `normalizeSettingsWriteOptions`
- Imports (1)
  - `../types/settingsContracts`
- Internal dependencies (1)
  - `frontend/src/types/settingsContracts.ts`
- Referenced by (1)
  - `frontend/src/AppContext.tsx`

### 3.333 `frontend/src/web-api.ts`

- Declared exports: none detected
- Imports (6)
  - `./api/http.ts`
  - `./api/localDb.ts`
  - `./api/methods.ts`
  - `./api/websocket.ts`
  - `./constants.ts`
  - `./platform/runtime/clientRuntime.ts`
- Internal dependencies (6)
  - `frontend/src/api/http.ts`
  - `frontend/src/api/localDb.ts`
  - `frontend/src/api/methods.ts`
  - `frontend/src/api/websocket.ts`
  - `frontend/src/constants.ts`
  - `frontend/src/platform/runtime/clientRuntime.ts`
- Referenced by (1)
  - `frontend/src/AppContext.tsx`

### 3.334 `frontend/tailwind.config.ts`

- Declared exports: none detected
- Imports (1)
  - `tailwindcss`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.335 `frontend/tests/actionGuards.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.336 `frontend/tests/actionStability.test.ts`

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

### 3.337 `frontend/tests/adminShellMediaGuards.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.338 `frontend/tests/apiHttp.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.339 `frontend/tests/appRefresh.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/appRefresh.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/appRefresh.ts`
- Referenced by (0)
  - none

### 3.340 `frontend/tests/appShellUtils.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/app/appShellUtils.ts`
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (1)
  - `frontend/src/app/appShellUtils.ts`
- Referenced by (0)
  - none

### 3.341 `frontend/tests/assetCompression.test.ts`

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

### 3.342 `frontend/tests/backupJobs.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.343 `frontend/tests/barcodeImageScanner.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/components/products/scanning/barcodeImageScanner.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/products/scanning/barcodeImageScanner.ts`
- Referenced by (0)
  - none

### 3.344 `frontend/tests/barcodeScannerState.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/components/products/scanning/barcodeScannerState.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/products/scanning/barcodeScannerState.ts`
- Referenced by (0)
  - none

### 3.345 `frontend/tests/bulkOps.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/bulkOps.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/bulkOps.ts`
- Referenced by (0)
  - none

### 3.346 `frontend/tests/contactImportWorker.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/utils/csvRowCounter.ts`
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (1)
  - `frontend/src/utils/csvRowCounter.ts`
- Referenced by (0)
  - none

### 3.347 `frontend/tests/csvImport.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/utils/csvImport.ts`
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (1)
  - `frontend/src/utils/csvImport.ts`
- Referenced by (0)
  - none

### 3.348 `frontend/tests/dashboardDataReliability.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.349 `frontend/tests/dateHelpers.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/dateHelpers.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/dateHelpers.ts`
- Referenced by (0)
  - none

### 3.350 `frontend/tests/deviceInfo.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/deviceInfo.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/deviceInfo.ts`
- Referenced by (0)
  - none

### 3.351 `frontend/tests/exportPackages.test.ts`

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

### 3.352 `frontend/tests/formatters.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/formatters.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/formatters.ts`
- Referenced by (0)
  - none

### 3.353 `frontend/tests/globalScroll.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.354 `frontend/tests/globalScrollControls.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/components/shared/globalScroll.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/shared/globalScroll.ts`
- Referenced by (0)
  - none

### 3.355 `frontend/tests/groupedRecords.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/groupedRecords.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/groupedRecords.ts`
- Referenced by (0)
  - none

### 3.356 `frontend/tests/historyHelpers.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.357 `frontend/tests/importJobRefresh.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.358 `frontend/tests/initials.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.359 `frontend/tests/inventoryImportWorker.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/utils/csvRowCounter.ts`
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (1)
  - `frontend/src/utils/csvRowCounter.ts`
- Referenced by (0)
  - none

### 3.360 `frontend/tests/inventoryMobileCardLayout.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.361 `frontend/tests/inventoryMovementGroups.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/components/inventory/movementGroups.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/inventory/movementGroups.ts`
- Referenced by (0)
  - none

### 3.362 `frontend/tests/inventoryRfidSection.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.363 `frontend/tests/jsxSyntaxCheck.ts`

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

### 3.364 `frontend/tests/loaders.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.365 `frontend/tests/mediaUploadHelpers.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/mediaUpload.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/mediaUpload.ts`
- Referenced by (0)
  - none

### 3.366 `frontend/tests/navigationConfig.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/components/shared/navigationConfig.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/shared/navigationConfig.ts`
- Referenced by (0)
  - none

### 3.367 `frontend/tests/notificationBadge.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.368 `frontend/tests/offlineSalesQueue.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.369 `frontend/tests/offlineSecurityHardening.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.370 `frontend/tests/offlineSyncArchitecture.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.371 `frontend/tests/ownedGoogleAuth.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.372 `frontend/tests/performanceLoadingUx.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.373 `frontend/tests/permissionEditor.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.374 `frontend/tests/permissions.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/permissions.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/permissions.ts`
- Referenced by (0)
  - none

### 3.375 `frontend/tests/portalCatalogDisplay.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.376 `frontend/tests/portalContentI18n.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.377 `frontend/tests/portalEditorUtils.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.378 `frontend/tests/portalFaqVocabulary.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.379 `frontend/tests/portalLanguagePacks.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.380 `frontend/tests/portalTranslateController.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.381 `frontend/tests/posCore.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.382 `frontend/tests/pricingContacts.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/utils/pricing.ts`
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (1)
  - `frontend/src/utils/pricing.ts`
- Referenced by (0)
  - none

### 3.383 `frontend/tests/productBatches.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/productBatches.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/productBatches.ts`
- Referenced by (0)
  - none

### 3.384 `frontend/tests/productDiscountUx.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.385 `frontend/tests/productDisplayHelpers.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.386 `frontend/tests/productFilterHelpers.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.387 `frontend/tests/productGalleryHelpers.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.388 `frontend/tests/productGrouping.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/productGrouping.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/productGrouping.ts`
- Referenced by (0)
  - none

### 3.389 `frontend/tests/productGroupViewHelpers.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.390 `frontend/tests/productHistoryHelpers.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/components/products/history/productHistoryHelpers.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/products/history/productHistoryHelpers.ts`
- Referenced by (0)
  - none

### 3.391 `frontend/tests/productImportPlanner.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/components/products/import/productImportPlanner.ts`
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (1)
  - `frontend/src/components/products/import/productImportPlanner.ts`
- Referenced by (0)
  - none

### 3.392 `frontend/tests/productImportWorkerFallback.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/components/products/import/productImportPlanner.ts`
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (1)
  - `frontend/src/components/products/import/productImportPlanner.ts`
- Referenced by (0)
  - none

### 3.393 `frontend/tests/productMenuHelpers.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.394 `frontend/tests/productPageHelpers.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.395 `frontend/tests/productSearchPagination.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.396 `frontend/tests/productSelectionHelpers.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.397 `frontend/tests/productWriteHelpers.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.398 `frontend/tests/publicErrorRecovery.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.399 `frontend/tests/receiptSettingsSync.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.400 `frontend/tests/receiptTemplate.test.ts`

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

### 3.401 `frontend/tests/returnsLayout.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.402 `frontend/tests/runtimeErrorClassifier.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.403 `frontend/tests/salesImportWorker.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/utils/csvRowCounter.ts`
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (1)
  - `frontend/src/utils/csvRowCounter.ts`
- Referenced by (0)
  - none

### 3.404 `frontend/tests/scanbotScanner.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/components/products/scanning/scanbotScanner.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/products/scanning/scanbotScanner.ts`
- Referenced by (0)
  - none

### 3.405 `frontend/tests/scriptTypography.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/scriptTypography.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/scriptTypography.ts`
- Referenced by (0)
  - none

### 3.406 `frontend/tests/sectionNavigation.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.407 `frontend/tests/settingsConflictHelpers.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/components/utils-settings/settingsConflict.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/utils-settings/settingsConflict.ts`
- Referenced by (0)
  - none

### 3.408 `frontend/tests/settingsRefresh.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.409 `frontend/tests/storagePolicy.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.410 `frontend/tests/utilsSettingsBarrel.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.411 `frontend/vite.config.ts`

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

### 3.412 `ops/scripts/architecture/generated-bulk-audit.ts`

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

### 3.413 `ops/scripts/architecture/language-runtime-audit.ts`

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

### 3.414 `ops/scripts/architecture/organization-audit.ts`

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

### 3.415 `ops/scripts/architecture/phase29-audit.ts`

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

### 3.416 `ops/scripts/backend/schema-audit.ts`

- Declared exports: none detected
- Imports (2)
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.417 `ops/scripts/backend/schema-primary-key-preflight.ts`

- Declared exports: none detected
- Imports (3)
  - `node:child_process`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.418 `ops/scripts/backend/verify-data-integrity.ts`

- Declared exports: none detected
- Imports (3)
  - `child_process`
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.419 `ops/scripts/frontend/verify-i18n.ts`

- Declared exports: none detected
- Imports (2)
  - `../lib/fs-utils.ts`
  - `path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.ts`
- Referenced by (0)
  - none

### 3.420 `ops/scripts/frontend/verify-performance.ts`

- Declared exports: none detected
- Imports (3)
  - `child_process`
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.421 `ops/scripts/frontend/verify-ui.ts`

- Declared exports: none detected
- Imports (3)
  - `../lib/fs-utils.ts`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.ts`
- Referenced by (0)
  - none

### 3.422 `ops/scripts/lib/fs-utils.ts`

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

### 3.423 `ops/scripts/lib/report-utils.ts`

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

### 3.424 `ops/scripts/runtime/audits/action-history-undo-redo-check.ts`

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

### 3.425 `ops/scripts/runtime/audits/audit-auth.ts`

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

### 3.426 `ops/scripts/runtime/audits/audit-manifest.ts`

- Declared exports: `ADMIN_ROUTES`, `FULL_AUDIT_ROUTES`, `PUBLIC_ROUTES`, `ROUTE_MANIFEST`, `getAuditProfiles`, `getRouteManifest`, `resolveAuditRoutes`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `ops/scripts/runtime/audits/deep-live-audit.ts`
  - `ops/scripts/runtime/audits/full-app-audit.ts`
  - `ops/scripts/runtime/browser-action-smoke.ts`

### 3.427 `ops/scripts/runtime/audits/audit-report-html.ts`

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

### 3.428 `ops/scripts/runtime/audits/deep-live-audit.ts`

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

### 3.429 `ops/scripts/runtime/audits/full-app-audit.ts`

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

### 3.430 `ops/scripts/runtime/browser-action-smoke.ts`

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

### 3.431 `ops/scripts/runtime/cloudflare/rotate-cloudflare-tunnel-token.ts`

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

### 3.432 `ops/scripts/runtime/cloudflare/update-cloudflare-tunnel-origin.ts`

- Declared exports: none detected
- Imports (3)
  - `node:fs`
  - `node:https`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.433 `ops/scripts/runtime/cloudflare/verify-cloudflare-automation.ts`

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

### 3.434 `ops/scripts/runtime/cloudflare/verify-r2-object-store.ts`

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

### 3.435 `ops/scripts/runtime/live-checks/live-check-utils.ts`

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

### 3.436 `ops/scripts/runtime/live-checks/phase84-branches-actions-live-check.ts`

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

### 3.437 `ops/scripts/runtime/live-checks/phase84-contacts-live-check.ts`

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

### 3.438 `ops/scripts/runtime/live-checks/phase84-files-providers-actions-live-check.ts`

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

### 3.439 `ops/scripts/runtime/live-checks/phase84-inventory-actions-live-check.ts`

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

### 3.440 `ops/scripts/runtime/live-checks/phase84-live-suite.ts`

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

### 3.441 `ops/scripts/runtime/live-checks/phase84-product-brands-actions-live-check.ts`

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

### 3.442 `ops/scripts/runtime/live-checks/phase84-product-categories-actions-live-check.ts`

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

### 3.443 `ops/scripts/runtime/live-checks/phase84-product-page-actions-live-check.ts`

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

### 3.444 `ops/scripts/runtime/live-checks/phase84-product-scanning-actions-live-check.ts`

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

### 3.445 `ops/scripts/runtime/live-checks/phase84-product-stock-actions-live-check.ts`

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

### 3.446 `ops/scripts/runtime/live-checks/phase84-product-units-actions-live-check.ts`

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

### 3.447 `ops/scripts/runtime/live-checks/phase84-product-variant-actions-live-check.ts`

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

### 3.448 `ops/scripts/runtime/live-checks/phase84-public-portal-cloudflare-check.ts`

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

### 3.449 `ops/scripts/runtime/live-checks/phase84-sales-actions-live-check.ts`

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

### 3.450 `ops/scripts/runtime/live-checks/phase84-ui-live-check.ts`

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

### 3.451 `ops/scripts/runtime/live-checks/phase84-users-actions-live-check.ts`

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

### 3.452 `ops/scripts/runtime/smoke/check-public-url.ts`

- Declared exports: none detected
- Imports (2)
  - `node:https`
  - `node:net`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.453 `ops/scripts/runtime/smoke/check-route-contract.ts`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.454 `ops/scripts/runtime/smoke/live-smoke.ts`

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

### 3.455 `ops/scripts/runtime/smoke/post-start-diagnostics.ts`

- Declared exports: none detected
- Imports (2)
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.456 `ops/scripts/runtime/storage/cleanup-integrity-backlog.ts`

- Declared exports: none detected
- Imports (3)
  - `node:child_process`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.457 `ops/scripts/runtime/storage/cleanup-test-data.ts`

- Declared exports: none detected
- Imports (3)
  - `node:child_process`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.458 `ops/scripts/runtime/storage/dataset-readiness.ts`

- Declared exports: none detected
- Imports (3)
  - `node:child_process`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.459 `ops/scripts/runtime/storage/post-live-hygiene.ts`

- Declared exports: none detected
- Imports (3)
  - `node:child_process`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.460 `ops/scripts/runtime/storage/prune-storage.ts`

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

### 3.461 `ops/scripts/runtime/storage/restore-candidates.ts`

- Declared exports: none detected
- Imports (2)
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.462 `ops/scripts/runtime/storage/restore-rehearsal.ts`

- Declared exports: none detected
- Imports (3)
  - `node:child_process`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.463 `ops/scripts/verification/verify-backup-reliability.ts`

- Declared exports: none detected
- Imports (3)
  - `../lib/fs-utils.ts`
  - `node:fs`
  - `node:path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.ts`
- Referenced by (0)
  - none

### 3.464 `ops/scripts/verification/verify-docker-release.ts`

- Declared exports: none detected
- Imports (3)
  - `../lib/fs-utils.ts`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.ts`
- Referenced by (0)
  - none

### 3.465 `ops/scripts/verification/verify-hardening-policy.ts`

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

### 3.466 `ops/scripts/verification/verify-runtime-deps.ts`

- Declared exports: none detected
- Imports (3)
  - `../lib/fs-utils.ts`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.ts`
- Referenced by (0)
  - none

### 3.467 `ops/scripts/verification/verify-scale-services.ts`

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

### 3.468 `ops/scripts/verification/verify-secret-hygiene.ts`

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

