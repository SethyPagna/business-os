# All File Inventory (Project First-Party Files)

Auto-generated file-level commentary for all first-party project files (frontend, backend, scripts, and root run/config files; excluding dependencies/build artifacts).

## 1. Coverage Summary

Total files documented: **569**

## 2. File Commentary Matrix

| No. | File | Category | Lines | Size (KB) | Purpose |
|---:|---|---|---:|---:|---|
| 1 | `.npmrc` | project-root | 14 | 0.4 | Project source/support file |
| 2 | `backend/.env` | backend-root | 67 | 3.0 | Project source/support file |
| 3 | `backend/.npmrc` | backend-root | 14 | 0.4 | Project source/support file |
| 4 | `backend/package-lock.json` | backend-root | 6225 | 224.7 | Configuration/data manifest |
| 5 | `backend/package.json` | backend-root | 66 | 3.6 | Configuration/data manifest |
| 6 | `backend/README.md` | backend-root | 13 | 0.6 | Documentation |
| 7 | `backend/server.js` | backend-root | 570 | 19.8 | Backend server entrypoint |
| 8 | `backend/src/accessControl.js` | backend-core | 161 | 5.0 | Project source/support file |
| 9 | `backend/src/analytics/duckdbRuntime.js` | backend-core | 91 | 2.7 | Project source/support file |
| 10 | `backend/src/authOtpGuards.js` | backend-core | 31 | 0.9 | Project source/support file |
| 11 | `backend/src/backupSchema.js` | backend-core | 144 | 3.2 | Project source/support file |
| 12 | `backend/src/businessMetrics.js` | backend-core | 158 | 6.1 | Project source/support file |
| 13 | `backend/src/catalogTextIntegrity.js` | backend-core | 68 | 2.4 | Project source/support file |
| 14 | `backend/src/config/index.js` | backend-core | 303 | 12.3 | Project source/support file |
| 15 | `backend/src/conflictControl.js` | backend-core | 81 | 2.5 | Project source/support file |
| 16 | `backend/src/contactOptions.js` | backend-core | 140 | 4.7 | Project source/support file |
| 17 | `backend/src/database.js` | backend-core | 4 | 0.1 | Schema/migrations and DB bootstrap |
| 18 | `backend/src/dataPath/index.js` | backend-core | 201 | 6.0 | Project source/support file |
| 19 | `backend/src/db/cutoverReadiness.js` | backend-core | 164 | 5.3 | Project source/support file |
| 20 | `backend/src/db/postgresQueryCompat.js` | backend-core | 229 | 6.5 | Project source/support file |
| 21 | `backend/src/db/postgresSchema.sql` | backend-core | 2148 | 54.6 | Project source/support file |
| 22 | `backend/src/fileAssets.js` | backend-core | 1261 | 43.9 | Project source/support file |
| 23 | `backend/src/helpers.js` | backend-core | 625 | 21.0 | Project source/support file |
| 24 | `backend/src/idempotency.js` | backend-core | 13 | 0.3 | Project source/support file |
| 25 | `backend/src/importCsv.js` | backend-core | 296 | 7.7 | Project source/support file |
| 26 | `backend/src/importParsing.js` | backend-core | 89 | 3.2 | Project source/support file |
| 27 | `backend/src/initials.js` | backend-core | 103 | 3.0 | Project source/support file |
| 28 | `backend/src/maintenanceLock.js` | backend-core | 88 | 2.3 | Project source/support file |
| 29 | `backend/src/middleware.js` | backend-core | 336 | 10.3 | Project source/support file |
| 30 | `backend/src/money.js` | backend-core | 26 | 0.6 | Project source/support file |
| 31 | `backend/src/netSecurity.js` | backend-core | 122 | 3.3 | Project source/support file |
| 32 | `backend/src/objectStore.js` | backend-core | 468 | 15.1 | Project source/support file |
| 33 | `backend/src/optionalSharp.js` | backend-core | 30 | 0.7 | Project source/support file |
| 34 | `backend/src/organizationContext/index.js` | backend-core | 264 | 8.1 | Project source/support file |
| 35 | `backend/src/permissions.js` | backend-core | 198 | 6.3 | Project source/support file |
| 36 | `backend/src/portalUtils.js` | backend-core | 91 | 2.5 | Project source/support file |
| 37 | `backend/src/postgresDatabase.js` | backend-core | 596 | 25.4 | Project source/support file |
| 38 | `backend/src/productBatches.js` | backend-core | 646 | 21.5 | Project source/support file |
| 39 | `backend/src/productDiscounts.js` | backend-core | 129 | 5.1 | Project source/support file |
| 40 | `backend/src/productImportPolicies.js` | backend-core | 114 | 4.0 | Project source/support file |
| 41 | `backend/src/README.md` | backend-core | 12 | 0.7 | Documentation |
| 42 | `backend/src/requestContext.js` | backend-core | 59 | 1.2 | Project source/support file |
| 43 | `backend/src/routes/actionHistory.js` | backend-routes | 256 | 9.0 | API route handler |
| 44 | `backend/src/routes/ai.js` | backend-routes | 270 | 9.2 | API route handler |
| 45 | `backend/src/routes/auth.js` | backend-routes | 1148 | 40.6 | API route handler |
| 46 | `backend/src/routes/branches.js` | backend-routes | 452 | 19.7 | API route handler |
| 47 | `backend/src/routes/catalog.js` | backend-routes | 110 | 3.0 | API route handler |
| 48 | `backend/src/routes/categories.js` | backend-routes | 147 | 5.8 | API route handler |
| 49 | `backend/src/routes/contacts.js` | backend-routes | 1053 | 41.9 | API route handler |
| 50 | `backend/src/routes/customTables.js` | backend-routes | 259 | 9.5 | API route handler |
| 51 | `backend/src/routes/files.js` | backend-routes | 133 | 5.2 | API route handler |
| 52 | `backend/src/routes/importJobs.js` | backend-routes | 501 | 17.3 | API route handler |
| 53 | `backend/src/routes/inventory.js` | backend-routes | 1881 | 83.8 | API route handler |
| 54 | `backend/src/routes/notifications.js` | backend-routes | 581 | 19.6 | API route handler |
| 55 | `backend/src/routes/organizations.js` | backend-routes | 63 | 1.8 | API route handler |
| 56 | `backend/src/routes/portal.js` | backend-routes | 1407 | 51.4 | API route handler |
| 57 | `backend/src/routes/products.js` | backend-routes | 2218 | 99.1 | API route handler |
| 58 | `backend/src/routes/README.md` | backend-routes | 37 | 1.5 | API route handler |
| 59 | `backend/src/routes/returns.js` | backend-routes | 1050 | 41.4 | API route handler |
| 60 | `backend/src/routes/runtime.js` | backend-routes | 157 | 4.7 | API route handler |
| 61 | `backend/src/routes/sales.js` | backend-routes | 1573 | 64.6 | API route handler |
| 62 | `backend/src/routes/settings.js` | backend-routes | 210 | 7.3 | API route handler |
| 63 | `backend/src/routes/sync.js` | backend-routes | 301 | 13.3 | API route handler |
| 64 | `backend/src/routes/system/index.js` | backend-routes | 1659 | 65.3 | API route handler |
| 65 | `backend/src/routes/units.js` | backend-routes | 151 | 5.9 | API route handler |
| 66 | `backend/src/routes/users.js` | backend-routes | 1086 | 44.5 | API route handler |
| 67 | `backend/src/runtimeCache.js` | backend-core | 187 | 5.1 | Project source/support file |
| 68 | `backend/src/runtimeState/index.js` | backend-core | 74 | 2.2 | Project source/support file |
| 69 | `backend/src/runtimeVersion.js` | backend-core | 134 | 3.7 | Project source/support file |
| 70 | `backend/src/schemaMetadata.js` | backend-core | 110 | 3.0 | Project source/support file |
| 71 | `backend/src/security.js` | backend-core | 215 | 6.4 | Project source/support file |
| 72 | `backend/src/serverUtils.js` | backend-core | 431 | 15.5 | Project source/support file |
| 73 | `backend/src/services/aiGateway.js` | backend-services | 364 | 13.6 | Integration/service layer |
| 74 | `backend/src/services/backupPackages.js` | backend-services | 1060 | 36.2 | Integration/service layer |
| 75 | `backend/src/services/firebaseAuth.js` | backend-services | 384 | 14.3 | Integration/service layer |
| 76 | `backend/src/services/googleDriveSync/index.js` | backend-services | 1564 | 57.8 | Integration/service layer |
| 77 | `backend/src/services/googleDriveSync/versioning.js` | backend-services | 114 | 3.6 | Integration/service layer |
| 78 | `backend/src/services/googleOauth.js` | backend-services | 252 | 8.8 | Integration/service layer |
| 79 | `backend/src/services/importJobs.js` | backend-services | 3880 | 157.1 | Integration/service layer |
| 80 | `backend/src/services/integrationDoctor.js` | backend-services | 353 | 11.8 | Integration/service layer |
| 81 | `backend/src/services/mediaQueue.js` | backend-services | 200 | 7.2 | Integration/service layer |
| 82 | `backend/src/services/portalAi.js` | backend-services | 621 | 21.7 | Integration/service layer |
| 83 | `backend/src/services/README.md` | backend-services | 29 | 1.0 | Integration/service layer |
| 84 | `backend/src/services/verification.js` | backend-services | 272 | 8.4 | Integration/service layer |
| 85 | `backend/src/sessionAuth.js` | backend-core | 215 | 6.8 | Project source/support file |
| 86 | `backend/src/settingsSnapshot.js` | backend-core | 135 | 4.2 | Project source/support file |
| 87 | `backend/src/storage/organizationFolders.js` | backend-core | 54 | 1.7 | Project source/support file |
| 88 | `backend/src/systemFsWorker.js` | backend-core | 95 | 3.0 | Project source/support file |
| 89 | `backend/src/systemJobs.js` | backend-core | 467 | 14.5 | Project source/support file |
| 90 | `backend/src/uploadReferenceCleanup.js` | backend-core | 245 | 8.2 | Project source/support file |
| 91 | `backend/src/uploadSecurity.js` | backend-core | 91 | 3.6 | Project source/support file |
| 92 | `backend/src/websocket.js` | backend-core | 94 | 3.6 | Project source/support file |
| 93 | `backend/src/workers/importWorker.js` | backend-core | 35 | 1.0 | Project source/support file |
| 94 | `backend/src/workers/mediaWorker.js` | backend-core | 34 | 0.9 | Project source/support file |
| 95 | `backend/test/accessControl.test.js` | backend-root | 127 | 4.0 | Project source/support file |
| 96 | `backend/test/analyticsRuntime.test.js` | backend-root | 49 | 1.2 | Project source/support file |
| 97 | `backend/test/authOtpGuards.test.js` | backend-root | 71 | 1.6 | Project source/support file |
| 98 | `backend/test/authSecurityFlow.test.js` | backend-root | 283 | 9.0 | Project source/support file |
| 99 | `backend/test/backupDefaultDestination.test.js` | backend-root | 15 | 0.6 | Project source/support file |
| 100 | `backend/test/backupPerformanceHardening.test.js` | backend-root | 177 | 9.9 | Project source/support file |
| 101 | `backend/test/backupRetention.test.js` | backend-root | 91 | 3.8 | Project source/support file |
| 102 | `backend/test/backupSchema.test.js` | backend-root | 111 | 4.4 | Project source/support file |
| 103 | `backend/test/branchStockSearch.test.js` | backend-root | 271 | 9.8 | Project source/support file |
| 104 | `backend/test/contactOptions.test.js` | backend-root | 82 | 2.3 | Project source/support file |
| 105 | `backend/test/dataPath.test.js` | backend-root | 87 | 3.1 | Project source/support file |
| 106 | `backend/test/defaultRoles.test.js` | backend-root | 145 | 4.9 | Project source/support file |
| 107 | `backend/test/fileAssetStorageReconcile.test.js` | backend-root | 57 | 1.4 | Project source/support file |
| 108 | `backend/test/fileAssetUsageCache.test.js` | backend-root | 120 | 3.6 | Project source/support file |
| 109 | `backend/test/fileRouteSecurityFlow.test.js` | backend-root | 217 | 7.2 | Project source/support file |
| 110 | `backend/test/fullAutomation.test.js` | backend-root | 970 | 38.0 | Project source/support file |
| 111 | `backend/test/googleDriveSyncVersioning.test.js` | backend-root | 121 | 5.1 | Project source/support file |
| 112 | `backend/test/idempotency.test.js` | backend-root | 32 | 0.7 | Project source/support file |
| 113 | `backend/test/importCsv.test.js` | backend-root | 83 | 3.0 | Project source/support file |
| 114 | `backend/test/importDecisionIntegrity.test.js` | backend-root | 167 | 5.6 | Project source/support file |
| 115 | `backend/test/importJobPerformanceHardening.test.js` | backend-root | 39 | 1.5 | Project source/support file |
| 116 | `backend/test/importJobStateMachine.test.js` | backend-root | 420 | 21.0 | Project source/support file |
| 117 | `backend/test/importScaleSmoke.test.js` | backend-root | 79 | 2.7 | Project source/support file |
| 118 | `backend/test/initials.test.js` | backend-root | 24 | 0.8 | Project source/support file |
| 119 | `backend/test/integrationDoctor.test.js` | backend-root | 50 | 1.6 | Project source/support file |
| 120 | `backend/test/inventorySettingsMediaContracts.test.js` | backend-root | 62 | 3.0 | Project source/support file |
| 121 | `backend/test/mediaOptimization.test.js` | backend-root | 118 | 3.9 | Project source/support file |
| 122 | `backend/test/netSecurity.test.js` | backend-root | 45 | 1.5 | Project source/support file |
| 123 | `backend/test/notificationSummaryCache.test.js` | backend-root | 95 | 2.8 | Project source/support file |
| 124 | `backend/test/offlineSecurity.test.js` | backend-root | 87 | 3.7 | Project source/support file |
| 125 | `backend/test/ownedGoogleAuth.test.js` | backend-root | 98 | 4.0 | Project source/support file |
| 126 | `backend/test/permissionPolicy.test.js` | backend-root | 34 | 1.7 | Project source/support file |
| 127 | `backend/test/portalInventoryRegression.test.js` | backend-root | 103 | 8.8 | Project source/support file |
| 128 | `backend/test/portalUtils.test.js` | backend-root | 40 | 1.2 | Project source/support file |
| 129 | `backend/test/postgresCutoverReadiness.test.js` | backend-root | 56 | 1.6 | Project source/support file |
| 130 | `backend/test/postgresDatabase.test.js` | backend-root | 123 | 4.1 | Project source/support file |
| 131 | `backend/test/postgresQueryCompat.test.js` | backend-root | 98 | 3.5 | Project source/support file |
| 132 | `backend/test/productBatchHierarchy.test.js` | backend-root | 104 | 4.8 | Project source/support file |
| 133 | `backend/test/productExpiry.test.js` | backend-root | 68 | 2.8 | Project source/support file |
| 134 | `backend/test/productImportPolicies.test.js` | backend-root | 72 | 2.9 | Project source/support file |
| 135 | `backend/test/productSearchPagination.test.js` | backend-root | 19 | 1.6 | Project source/support file |
| 136 | `backend/test/rfidRoutes.test.js` | backend-root | 59 | 3.0 | Project source/support file |
| 137 | `backend/test/routeContracts.test.js` | backend-root | 256 | 14.1 | Project source/support file |
| 138 | `backend/test/runtimeCache.test.js` | backend-root | 65 | 2.0 | Project source/support file |
| 139 | `backend/test/runtimeVersion.test.js` | backend-root | 51 | 1.4 | Project source/support file |
| 140 | `backend/test/schemaMetadata.test.js` | backend-root | 117 | 3.9 | Project source/support file |
| 141 | `backend/test/serverUtils.test.js` | backend-root | 283 | 10.3 | Project source/support file |
| 142 | `backend/test/settingsSnapshotObjectStorage.test.js` | backend-root | 173 | 5.7 | Project source/support file |
| 143 | `backend/test/systemJobs.test.js` | backend-root | 97 | 3.5 | Project source/support file |
| 144 | `backend/test/uploadSecurity.test.js` | backend-root | 59 | 2.0 | Project source/support file |
| 145 | `frontend/.npmrc` | frontend-root | 14 | 0.4 | Project source/support file |
| 146 | `frontend/index.html` | frontend-root | 24 | 1.0 | Project source/support file |
| 147 | `frontend/package-lock.json` | frontend-root | 3804 | 130.6 | Configuration/data manifest |
| 148 | `frontend/package.json` | frontend-root | 41 | 4.1 | Configuration/data manifest |
| 149 | `frontend/public/favicon.ico` | frontend-root | 0 | 11.4 | Project source/support file |
| 150 | `frontend/public/icon.png` | frontend-root | 0 | 11.4 | Project source/support file |
| 151 | `frontend/public/manifest.json` | frontend-root | 17 | 0.3 | Configuration/data manifest |
| 152 | `frontend/public/runtime-noise-guard.js` | frontend-root | 105 | 4.1 | Project source/support file |
| 153 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.js` | frontend-root | 1 | 94.8 | Project source/support file |
| 154 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.wasm` | frontend-root | 0 | 8726.7 | Project source/support file |
| 155 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.worker.js` | frontend-root | 1 | 1.9 | Project source/support file |
| 156 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd.wasm` | frontend-root | 0 | 8782.2 | Project source/support file |
| 157 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm.wasm` | frontend-root | 0 | 8192.9 | Project source/support file |
| 158 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd-threads.js` | frontend-root | 1 | 146.4 | Project source/support file |
| 159 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd.js` | frontend-root | 1 | 135.5 | Project source/support file |
| 160 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core.js` | frontend-root | 1 | 135.5 | Project source/support file |
| 161 | `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js` | frontend-root | 187 | 1007.0 | Project source/support file |
| 162 | `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js.LICENSE.txt` | frontend-root | 24 | 0.5 | Project source/support file |
| 163 | `frontend/public/sw.js` | frontend-root | 424 | 14.7 | Project source/support file |
| 164 | `frontend/public/theme-bootstrap.js` | frontend-root | 219 | 7.9 | Project source/support file |
| 165 | `frontend/README.md` | frontend-root | 13 | 0.5 | Documentation |
| 166 | `frontend/src/api/http.js` | frontend-api | 2 | 0.0 | Frontend API/sync helper |
| 167 | `frontend/src/api/http.ts` | frontend-api | 1093 | 41.2 | Frontend API/sync helper |
| 168 | `frontend/src/api/localDb.js` | frontend-api | 2 | 0.0 | Frontend API/sync helper |
| 169 | `frontend/src/api/localDb.ts` | frontend-api | 287 | 11.0 | Frontend API/sync helper |
| 170 | `frontend/src/api/methods.js` | frontend-api | 2346 | 102.6 | Frontend API/sync helper |
| 171 | `frontend/src/api/README.md` | frontend-api | 32 | 1.5 | Frontend API/sync helper |
| 172 | `frontend/src/api/websocket.js` | frontend-api | 2 | 0.0 | Frontend API/sync helper |
| 173 | `frontend/src/api/websocket.ts` | frontend-api | 230 | 7.6 | Frontend API/sync helper |
| 174 | `frontend/src/App.jsx` | frontend-core | 1387 | 53.2 | Main app shell and page mounting |
| 175 | `frontend/src/app/appShellUtils.ts` | frontend-core | 159 | 5.2 | Project source/support file |
| 176 | `frontend/src/app/publicErrorRecovery.ts` | frontend-core | 35 | 1.3 | Project source/support file |
| 177 | `frontend/src/AppContext.jsx` | frontend-core | 1603 | 64.2 | Global app state/context provider |
| 178 | `frontend/src/components/auth/Login.jsx` | frontend-ui | 1084 | 49.4 | UI component/page |
| 179 | `frontend/src/components/branches/Branches.jsx` | frontend-ui | 907 | 43.4 | UI component/page |
| 180 | `frontend/src/components/branches/BranchForm.jsx` | frontend-ui | 190 | 6.4 | UI component/page |
| 181 | `frontend/src/components/branches/TransferModal.jsx` | frontend-ui | 346 | 14.2 | UI component/page |
| 182 | `frontend/src/components/catalog/CatalogEditorSurface.jsx` | frontend-ui | 1295 | 95.9 | UI component/page |
| 183 | `frontend/src/components/catalog/CatalogImageField.jsx` | frontend-ui | 91 | 4.0 | UI component/page |
| 184 | `frontend/src/components/catalog/CatalogPage.jsx` | frontend-ui | 3218 | 139.2 | UI component/page |
| 185 | `frontend/src/components/catalog/CatalogPageContext.jsx` | frontend-ui | 21 | 0.5 | UI component/page |
| 186 | `frontend/src/components/catalog/CatalogPreviewSurface.jsx` | frontend-ui | 354 | 19.0 | UI component/page |
| 187 | `frontend/src/components/catalog/CatalogProductsSection.jsx` | frontend-ui | 511 | 26.8 | UI component/page |
| 188 | `frontend/src/components/catalog/CatalogSecondaryTabs.jsx` | frontend-ui | 837 | 50.4 | UI component/page |
| 189 | `frontend/src/components/catalog/catalogUi.jsx` | frontend-ui | 63 | 2.5 | UI component/page |
| 190 | `frontend/src/components/catalog/portalCatalogDisplay.ts` | frontend-ui | 183 | 6.2 | UI component/page |
| 191 | `frontend/src/components/catalog/portalContentI18n.ts` | frontend-ui | 788 | 49.4 | UI component/page |
| 192 | `frontend/src/components/catalog/portalEditorUtils.ts` | frontend-ui | 189 | 5.8 | UI component/page |
| 193 | `frontend/src/components/catalog/portalLanguagePacks.ts` | frontend-ui | 1349 | 62.5 | UI component/page |
| 194 | `frontend/src/components/catalog/portalTranslateController.ts` | frontend-ui | 224 | 9.0 | UI component/page |
| 195 | `frontend/src/components/contacts/ContactImportModal.jsx` | frontend-ui | 326 | 13.0 | UI component/page |
| 196 | `frontend/src/components/contacts/contactImportWorker.ts` | frontend-ui | 39 | 1.0 | UI component/page |
| 197 | `frontend/src/components/contacts/contactOptionUtils.js` | frontend-ui | 2 | 0.0 | UI component/page |
| 198 | `frontend/src/components/contacts/contactOptionUtils.ts` | frontend-ui | 131 | 4.9 | UI component/page |
| 199 | `frontend/src/components/contacts/Contacts.jsx` | frontend-ui | 322 | 13.1 | UI component/page |
| 200 | `frontend/src/components/contacts/CustomerFormModal.jsx` | frontend-ui | 201 | 9.7 | UI component/page |
| 201 | `frontend/src/components/contacts/customerMembershipNumber.js` | frontend-ui | 2 | 0.0 | UI component/page |
| 202 | `frontend/src/components/contacts/customerMembershipNumber.ts` | frontend-ui | 11 | 0.4 | UI component/page |
| 203 | `frontend/src/components/contacts/CustomersTab.jsx` | frontend-ui | 796 | 39.4 | UI component/page |
| 204 | `frontend/src/components/contacts/DeliveryTab.jsx` | frontend-ui | 819 | 42.8 | UI component/page |
| 205 | `frontend/src/components/contacts/shared.jsx` | frontend-ui | 378 | 14.5 | UI component/page |
| 206 | `frontend/src/components/contacts/SuppliersTab.jsx` | frontend-ui | 836 | 43.1 | UI component/page |
| 207 | `frontend/src/components/custom-tables/CustomTables.jsx` | frontend-ui | 589 | 26.5 | UI component/page |
| 208 | `frontend/src/components/dashboard/charts/BarChart.jsx` | frontend-ui | 149 | 6.5 | UI component/page |
| 209 | `frontend/src/components/dashboard/charts/DonutChart.jsx` | frontend-ui | 93 | 4.2 | UI component/page |
| 210 | `frontend/src/components/dashboard/charts/index.js` | frontend-ui | 2 | 0.0 | UI component/page |
| 211 | `frontend/src/components/dashboard/charts/index.ts` | frontend-ui | 5 | 0.2 | UI component/page |
| 212 | `frontend/src/components/dashboard/charts/LineChart.jsx` | frontend-ui | 197 | 9.1 | UI component/page |
| 213 | `frontend/src/components/dashboard/charts/NoData.jsx` | frontend-ui | 15 | 0.6 | UI component/page |
| 214 | `frontend/src/components/dashboard/Dashboard.jsx` | frontend-ui | 2063 | 107.5 | UI component/page |
| 215 | `frontend/src/components/dashboard/MiniStat.jsx` | frontend-ui | 36 | 1.7 | UI component/page |
| 216 | `frontend/src/components/files/FilePickerModal.jsx` | frontend-ui | 270 | 11.5 | UI component/page |
| 217 | `frontend/src/components/files/FilesPage.jsx` | frontend-ui | 990 | 47.4 | UI component/page |
| 218 | `frontend/src/components/files/FilesProvidersTab.jsx` | frontend-ui | 222 | 16.6 | UI component/page |
| 219 | `frontend/src/components/files/FilesResponsesTab.jsx` | frontend-ui | 142 | 9.5 | UI component/page |
| 220 | `frontend/src/components/inventory/DualMoney.jsx` | frontend-ui | 14 | 0.6 | UI component/page |
| 221 | `frontend/src/components/inventory/Inventory.jsx` | frontend-ui | 4123 | 209.0 | UI component/page |
| 222 | `frontend/src/components/inventory/InventoryImportModal.jsx` | frontend-ui | 228 | 10.5 | UI component/page |
| 223 | `frontend/src/components/inventory/inventoryImportWorker.ts` | frontend-ui | 39 | 1.0 | UI component/page |
| 224 | `frontend/src/components/inventory/InventoryMovementsSurface.jsx` | frontend-ui | 540 | 34.3 | UI component/page |
| 225 | `frontend/src/components/inventory/InventoryProductsSurface.jsx` | frontend-ui | 467 | 31.6 | UI component/page |
| 226 | `frontend/src/components/inventory/InventoryRfidSurface.jsx` | frontend-ui | 126 | 8.4 | UI component/page |
| 227 | `frontend/src/components/inventory/movementGroups.js` | frontend-ui | 2 | 0.0 | UI component/page |
| 228 | `frontend/src/components/inventory/movementGroups.ts` | frontend-ui | 287 | 12.9 | UI component/page |
| 229 | `frontend/src/components/inventory/ProductDetailModal.jsx` | frontend-ui | 202 | 13.4 | UI component/page |
| 230 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | frontend-ui | 625 | 35.7 | UI component/page |
| 231 | `frontend/src/components/navigation/Sidebar.jsx` | frontend-ui | 335 | 15.3 | UI component/page |
| 232 | `frontend/src/components/pos/CartItem.jsx` | frontend-ui | 106 | 5.2 | UI component/page |
| 233 | `frontend/src/components/pos/FilterPanel.jsx` | frontend-ui | 237 | 8.3 | UI component/page |
| 234 | `frontend/src/components/pos/POS.jsx` | frontend-ui | 1919 | 107.6 | UI component/page |
| 235 | `frontend/src/components/pos/posCore.ts` | frontend-ui | 167 | 6.4 | UI component/page |
| 236 | `frontend/src/components/pos/ProductImage.jsx` | frontend-ui | 6 | 0.2 | UI component/page |
| 237 | `frontend/src/components/pos/QuickAddModal.jsx` | frontend-ui | 38 | 1.6 | UI component/page |
| 238 | `frontend/src/components/products/config/productPageConfig.ts` | frontend-ui | 24 | 0.7 | UI component/page |
| 239 | `frontend/src/components/products/forms/BranchStockAdjuster.jsx` | frontend-ui | 119 | 5.0 | UI component/page |
| 240 | `frontend/src/components/products/forms/BulkAddStockModal.jsx` | frontend-ui | 91 | 4.3 | UI component/page |
| 241 | `frontend/src/components/products/forms/ProductForm.jsx` | frontend-ui | 940 | 46.9 | UI component/page |
| 242 | `frontend/src/components/products/forms/VariantFormModal.jsx` | frontend-ui | 274 | 13.4 | UI component/page |
| 243 | `frontend/src/components/products/helpers/productDisplayHelpers.ts` | frontend-ui | 156 | 5.8 | UI component/page |
| 244 | `frontend/src/components/products/helpers/productFilterHelpers.ts` | frontend-ui | 216 | 9.0 | UI component/page |
| 245 | `frontend/src/components/products/helpers/productGalleryHelpers.ts` | frontend-ui | 101 | 3.1 | UI component/page |
| 246 | `frontend/src/components/products/helpers/productGroupViewHelpers.ts` | frontend-ui | 46 | 1.6 | UI component/page |
| 247 | `frontend/src/components/products/helpers/productMenuHelpers.ts` | frontend-ui | 292 | 11.0 | UI component/page |
| 248 | `frontend/src/components/products/helpers/productPageHelpers.ts` | frontend-ui | 32 | 1.0 | UI component/page |
| 249 | `frontend/src/components/products/helpers/productSelectionHelpers.ts` | frontend-ui | 139 | 4.2 | UI component/page |
| 250 | `frontend/src/components/products/helpers/productWriteHelpers.ts` | frontend-ui | 372 | 12.7 | UI component/page |
| 251 | `frontend/src/components/products/history/productHistoryHelpers.ts` | frontend-ui | 46 | 1.4 | UI component/page |
| 252 | `frontend/src/components/products/import/BulkImportModal.jsx` | frontend-ui | 1907 | 91.8 | UI component/page |
| 253 | `frontend/src/components/products/import/productImportPlanner.ts` | frontend-ui | 634 | 25.3 | UI component/page |
| 254 | `frontend/src/components/products/import/productImportWorker.ts` | frontend-ui | 68 | 1.9 | UI component/page |
| 255 | `frontend/src/components/products/lookups/ManageBrandsModal.jsx` | frontend-ui | 680 | 28.5 | UI component/page |
| 256 | `frontend/src/components/products/lookups/ManageCategoriesModal.jsx` | frontend-ui | 502 | 21.7 | UI component/page |
| 257 | `frontend/src/components/products/lookups/ManageUnitsModal.jsx` | frontend-ui | 494 | 21.0 | UI component/page |
| 258 | `frontend/src/components/products/lookups/productLookupSnapshots.ts` | frontend-ui | 229 | 7.3 | UI component/page |
| 259 | `frontend/src/components/products/Products.jsx` | frontend-ui | 2006 | 96.3 | UI component/page |
| 260 | `frontend/src/components/products/scanning/barcodeImageScanner.ts` | frontend-ui | 125 | 4.1 | UI component/page |
| 261 | `frontend/src/components/products/scanning/BarcodeScannerModal.jsx` | frontend-ui | 581 | 28.0 | UI component/page |
| 262 | `frontend/src/components/products/scanning/barcodeScannerState.ts` | frontend-ui | 82 | 2.5 | UI component/page |
| 263 | `frontend/src/components/products/scanning/scanbotScanner.ts` | frontend-ui | 180 | 6.0 | UI component/page |
| 264 | `frontend/src/components/products/shared/primitives.jsx` | frontend-ui | 207 | 7.2 | UI component/page |
| 265 | `frontend/src/components/products/surfaces/HeaderActions.jsx` | frontend-ui | 140 | 5.9 | UI component/page |
| 266 | `frontend/src/components/products/surfaces/ProductDetailModal.jsx` | frontend-ui | 241 | 12.2 | UI component/page |
| 267 | `frontend/src/components/products/surfaces/ProductRowParts.jsx` | frontend-ui | 84 | 4.5 | UI component/page |
| 268 | `frontend/src/components/products/surfaces/ProductsListSurface.jsx` | frontend-ui | 334 | 18.7 | UI component/page |
| 269 | `frontend/src/components/README.md` | frontend-ui | 37 | 1.9 | UI component/page |
| 270 | `frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | frontend-ui | 95 | 3.8 | UI component/page |
| 271 | `frontend/src/components/receipt-settings/constants.js` | frontend-ui | 2 | 0.0 | UI component/page |
| 272 | `frontend/src/components/receipt-settings/constants.ts` | frontend-ui | 156 | 7.9 | UI component/page |
| 273 | `frontend/src/components/receipt-settings/ErrorBoundary.jsx` | frontend-ui | 28 | 0.9 | UI component/page |
| 274 | `frontend/src/components/receipt-settings/FieldOrderManager.jsx` | frontend-ui | 190 | 9.4 | UI component/page |
| 275 | `frontend/src/components/receipt-settings/PrintSettings.jsx` | frontend-ui | 245 | 11.0 | UI component/page |
| 276 | `frontend/src/components/receipt-settings/ReceiptPreview.jsx` | frontend-ui | 104 | 3.6 | UI component/page |
| 277 | `frontend/src/components/receipt-settings/ReceiptSettings.jsx` | frontend-ui | 443 | 26.3 | UI component/page |
| 278 | `frontend/src/components/receipt-settings/template.js` | frontend-ui | 2 | 0.0 | UI component/page |
| 279 | `frontend/src/components/receipt-settings/template.ts` | frontend-ui | 33 | 0.9 | UI component/page |
| 280 | `frontend/src/components/receipt/Receipt.jsx` | frontend-ui | 470 | 22.3 | UI component/page |
| 281 | `frontend/src/components/returns/EditReturnModal.jsx` | frontend-ui | 241 | 12.9 | UI component/page |
| 282 | `frontend/src/components/returns/NewReturnModal.jsx` | frontend-ui | 492 | 27.9 | UI component/page |
| 283 | `frontend/src/components/returns/NewSupplierReturnModal.jsx` | frontend-ui | 394 | 20.8 | UI component/page |
| 284 | `frontend/src/components/returns/ReturnDetailModal.jsx` | frontend-ui | 132 | 6.8 | UI component/page |
| 285 | `frontend/src/components/returns/Returns.jsx` | frontend-ui | 888 | 38.8 | UI component/page |
| 286 | `frontend/src/components/returns/ReturnsListSurface.jsx` | frontend-ui | 328 | 17.6 | UI component/page |
| 287 | `frontend/src/components/sales/ExportModal.jsx` | frontend-ui | 250 | 11.2 | UI component/page |
| 288 | `frontend/src/components/sales/SaleDetailModal.jsx` | frontend-ui | 332 | 15.7 | UI component/page |
| 289 | `frontend/src/components/sales/Sales.jsx` | frontend-ui | 908 | 40.2 | UI component/page |
| 290 | `frontend/src/components/sales/SalesImportModal.jsx` | frontend-ui | 228 | 10.4 | UI component/page |
| 291 | `frontend/src/components/sales/salesImportWorker.ts` | frontend-ui | 39 | 1.0 | UI component/page |
| 292 | `frontend/src/components/sales/SalesListSurface.jsx` | frontend-ui | 318 | 19.2 | UI component/page |
| 293 | `frontend/src/components/sales/StatusBadge.jsx` | frontend-ui | 47 | 1.6 | UI component/page |
| 294 | `frontend/src/components/server/ServerPage.jsx` | frontend-ui | 781 | 38.6 | UI component/page |
| 295 | `frontend/src/components/shared/ActionHistoryBar.jsx` | frontend-ui | 151 | 8.1 | UI component/page |
| 296 | `frontend/src/components/shared/BackgroundImportTracker.jsx` | frontend-ui | 546 | 24.4 | UI component/page |
| 297 | `frontend/src/components/shared/ExportMenu.jsx` | frontend-ui | 36 | 1.5 | UI component/page |
| 298 | `frontend/src/components/shared/FilterMenu.jsx` | frontend-ui | 113 | 4.8 | UI component/page |
| 299 | `frontend/src/components/shared/globalScroll.js` | frontend-ui | 2 | 0.0 | UI component/page |
| 300 | `frontend/src/components/shared/globalScroll.ts` | frontend-ui | 72 | 2.7 | UI component/page |
| 301 | `frontend/src/components/shared/ImageGalleryLightbox.jsx` | frontend-ui | 119 | 4.9 | UI component/page |
| 302 | `frontend/src/components/shared/LoadingWatchdog.jsx` | frontend-ui | 63 | 2.0 | UI component/page |
| 303 | `frontend/src/components/shared/Modal.jsx` | frontend-ui | 34 | 1.8 | UI component/page |
| 304 | `frontend/src/components/shared/navigationConfig.js` | frontend-ui | 2 | 0.0 | UI component/page |
| 305 | `frontend/src/components/shared/navigationConfig.ts` | frontend-ui | 66 | 2.3 | UI component/page |
| 306 | `frontend/src/components/shared/NotificationCenter.jsx` | frontend-ui | 594 | 30.3 | UI component/page |
| 307 | `frontend/src/components/shared/pageActivity.js` | frontend-ui | 2 | 0.0 | UI component/page |
| 308 | `frontend/src/components/shared/pageActivity.ts` | frontend-ui | 9 | 0.3 | UI component/page |
| 309 | `frontend/src/components/shared/PageHeader.jsx` | frontend-ui | 55 | 2.2 | UI component/page |
| 310 | `frontend/src/components/shared/PaginationControls.jsx` | frontend-ui | 202 | 9.6 | UI component/page |
| 311 | `frontend/src/components/shared/PortalMenu.jsx` | frontend-ui | 221 | 7.3 | UI component/page |
| 312 | `frontend/src/components/shared/QuickPreferenceToggles.jsx` | frontend-ui | 56 | 2.0 | UI component/page |
| 313 | `frontend/src/components/shared/SectionSwitcher.jsx` | frontend-ui | 72 | 2.8 | UI component/page |
| 314 | `frontend/src/components/shared/WriteConflictModal.jsx` | frontend-ui | 266 | 11.0 | UI component/page |
| 315 | `frontend/src/components/users/PermissionEditor.jsx` | frontend-ui | 152 | 7.3 | UI component/page |
| 316 | `frontend/src/components/users/UserDetailSheet.jsx` | frontend-ui | 103 | 5.0 | UI component/page |
| 317 | `frontend/src/components/users/UserProfileModal.jsx` | frontend-ui | 1158 | 62.4 | UI component/page |
| 318 | `frontend/src/components/users/Users.jsx` | frontend-ui | 1036 | 50.4 | UI component/page |
| 319 | `frontend/src/components/utils-settings/AuditLog.jsx` | frontend-ui | 1198 | 56.2 | UI component/page |
| 320 | `frontend/src/components/utils-settings/Backup.jsx` | frontend-ui | 1490 | 70.6 | UI component/page |
| 321 | `frontend/src/components/utils-settings/FontFamilyPicker.jsx` | frontend-ui | 58 | 3.0 | UI component/page |
| 322 | `frontend/src/components/utils-settings/index.js` | frontend-ui | 2 | 0.0 | UI component/page |
| 323 | `frontend/src/components/utils-settings/index.ts` | frontend-ui | 7 | 0.3 | UI component/page |
| 324 | `frontend/src/components/utils-settings/OtpModal.jsx` | frontend-ui | 258 | 10.2 | UI component/page |
| 325 | `frontend/src/components/utils-settings/ResetData.jsx` | frontend-ui | 297 | 13.5 | UI component/page |
| 326 | `frontend/src/components/utils-settings/Settings.jsx` | frontend-ui | 1730 | 80.6 | UI component/page |
| 327 | `frontend/src/components/utils-settings/settingsConflict.js` | frontend-ui | 2 | 0.0 | UI component/page |
| 328 | `frontend/src/components/utils-settings/settingsConflict.ts` | frontend-ui | 64 | 1.8 | UI component/page |
| 329 | `frontend/src/constants.js` | frontend-core | 2 | 0.0 | Project source/support file |
| 330 | `frontend/src/constants.ts` | frontend-core | 185 | 4.6 | Project source/support file |
| 331 | `frontend/src/index.jsx` | frontend-core | 194 | 6.4 | Project source/support file |
| 332 | `frontend/src/lang/en.json` | frontend-i18n | 2721 | 134.5 | Localization dictionary |
| 333 | `frontend/src/lang/km.json` | frontend-i18n | 2715 | 244.9 | Localization dictionary |
| 334 | `frontend/src/platform/runtime/clientRuntime.js` | frontend-core | 2 | 0.0 | Project source/support file |
| 335 | `frontend/src/platform/runtime/clientRuntime.ts` | frontend-core | 249 | 9.1 | Project source/support file |
| 336 | `frontend/src/platform/storage/storagePolicy.ts` | frontend-core | 40 | 1.3 | Project source/support file |
| 337 | `frontend/src/README.md` | frontend-core | 37 | 1.5 | Documentation |
| 338 | `frontend/src/runtime/runtimeErrorClassifier.ts` | frontend-core | 154 | 5.4 | Project source/support file |
| 339 | `frontend/src/styles/main.css` | frontend-style | 741 | 29.9 | Project source/support file |
| 340 | `frontend/src/types/jsx-modules.d.ts` | frontend-core | 7 | 0.2 | Project source/support file |
| 341 | `frontend/src/types/react.d.ts` | frontend-core | 13 | 0.6 | Project source/support file |
| 342 | `frontend/src/types/receiptContracts.ts` | frontend-core | 67 | 1.6 | Project source/support file |
| 343 | `frontend/src/types/settingsContracts.ts` | frontend-core | 27 | 0.5 | Project source/support file |
| 344 | `frontend/src/utils/actionGuards.ts` | frontend-utils | 76 | 2.2 | Utility helper |
| 345 | `frontend/src/utils/actionHistory.ts` | frontend-utils | 282 | 10.5 | Utility helper |
| 346 | `frontend/src/utils/appRefresh.d.ts` | frontend-utils | 4 | 0.2 | Utility helper |
| 347 | `frontend/src/utils/appRefresh.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 348 | `frontend/src/utils/appRefresh.ts` | frontend-utils | 38 | 1.0 | Utility helper |
| 349 | `frontend/src/utils/bulkOps.ts` | frontend-utils | 69 | 1.9 | Utility helper |
| 350 | `frontend/src/utils/color.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 351 | `frontend/src/utils/color.ts` | frontend-utils | 34 | 1.0 | Utility helper |
| 352 | `frontend/src/utils/csv.d.ts` | frontend-utils | 8 | 0.8 | Utility helper |
| 353 | `frontend/src/utils/csv.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 354 | `frontend/src/utils/csv.ts` | frontend-utils | 234 | 7.6 | Utility helper |
| 355 | `frontend/src/utils/csvExportWorker.ts` | frontend-utils | 35 | 1.0 | Utility helper |
| 356 | `frontend/src/utils/csvImport.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 357 | `frontend/src/utils/csvImport.ts` | frontend-utils | 306 | 10.1 | Utility helper |
| 358 | `frontend/src/utils/csvRowCounter.d.mts` | frontend-utils | 2 | 0.1 | Utility helper |
| 359 | `frontend/src/utils/csvRowCounter.ts` | frontend-utils | 40 | 0.9 | Utility helper |
| 360 | `frontend/src/utils/dateHelpers.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 361 | `frontend/src/utils/dateHelpers.ts` | frontend-utils | 18 | 0.6 | Utility helper |
| 362 | `frontend/src/utils/deviceInfo.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 363 | `frontend/src/utils/deviceInfo.ts` | frontend-utils | 54 | 1.5 | Utility helper |
| 364 | `frontend/src/utils/exportPackage.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 365 | `frontend/src/utils/exportPackage.ts` | frontend-utils | 61 | 1.4 | Utility helper |
| 366 | `frontend/src/utils/exportReports.jsx` | frontend-utils | 366 | 9.9 | Utility helper |
| 367 | `frontend/src/utils/favicon.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 368 | `frontend/src/utils/favicon.ts` | frontend-utils | 101 | 3.1 | Utility helper |
| 369 | `frontend/src/utils/formatters.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 370 | `frontend/src/utils/formatters.ts` | frontend-utils | 89 | 2.7 | Utility helper |
| 371 | `frontend/src/utils/groupedRecords.ts` | frontend-utils | 330 | 11.2 | Utility helper |
| 372 | `frontend/src/utils/historyHelpers.ts` | frontend-utils | 61 | 1.8 | Utility helper |
| 373 | `frontend/src/utils/importJobRefresh.js` | frontend-utils | 6 | 0.2 | Utility helper |
| 374 | `frontend/src/utils/importJobRefresh.ts` | frontend-utils | 106 | 3.1 | Utility helper |
| 375 | `frontend/src/utils/index.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 376 | `frontend/src/utils/index.ts` | frontend-utils | 6 | 0.2 | Utility helper |
| 377 | `frontend/src/utils/initials.ts` | frontend-utils | 105 | 3.5 | Utility helper |
| 378 | `frontend/src/utils/loaders.ts` | frontend-utils | 101 | 3.1 | Utility helper |
| 379 | `frontend/src/utils/mediaUpload.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 380 | `frontend/src/utils/mediaUpload.ts` | frontend-utils | 145 | 4.1 | Utility helper |
| 381 | `frontend/src/utils/permissions.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 382 | `frontend/src/utils/permissions.ts` | frontend-utils | 22 | 0.6 | Utility helper |
| 383 | `frontend/src/utils/pricing.d.ts` | frontend-utils | 16 | 0.8 | Utility helper |
| 384 | `frontend/src/utils/pricing.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 385 | `frontend/src/utils/pricing.ts` | frontend-utils | 102 | 4.0 | Utility helper |
| 386 | `frontend/src/utils/printReceipt.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 387 | `frontend/src/utils/printReceipt.ts` | frontend-utils | 1016 | 36.0 | Utility helper |
| 388 | `frontend/src/utils/productBatches.ts` | frontend-utils | 61 | 1.8 | Utility helper |
| 389 | `frontend/src/utils/productGrouping.ts` | frontend-utils | 315 | 11.3 | Utility helper |
| 390 | `frontend/src/utils/publicAssetUrls.d.ts` | frontend-utils | 2 | 0.1 | Utility helper |
| 391 | `frontend/src/utils/publicAssetUrls.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 392 | `frontend/src/utils/publicAssetUrls.ts` | frontend-utils | 80 | 3.1 | Utility helper |
| 393 | `frontend/src/utils/receiptAppliedConfig.ts` | frontend-utils | 147 | 4.5 | Utility helper |
| 394 | `frontend/src/utils/scriptTypography.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 395 | `frontend/src/utils/scriptTypography.ts` | frontend-utils | 27 | 0.7 | Utility helper |
| 396 | `frontend/src/utils/settingsRefresh.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 397 | `frontend/src/utils/settingsRefresh.ts` | frontend-utils | 84 | 2.5 | Utility helper |
| 398 | `frontend/src/utils/settingsWriteOptions.ts` | frontend-utils | 13 | 0.5 | Utility helper |
| 399 | `frontend/src/web-api.js` | frontend-core | 2 | 0.0 | Project source/support file |
| 400 | `frontend/src/web-api.ts` | frontend-core | 852 | 33.5 | Project source/support file |
| 401 | `frontend/tailwind.config.ts` | frontend-root | 19 | 0.5 | Project source/support file |
| 402 | `frontend/tests/actionGuards.test.ts` | frontend-root | 74 | 2.3 | Project source/support file |
| 403 | `frontend/tests/actionStability.test.ts` | frontend-root | 731 | 58.7 | Project source/support file |
| 404 | `frontend/tests/adminShellMediaGuards.test.ts` | frontend-root | 147 | 5.5 | Project source/support file |
| 405 | `frontend/tests/apiHttp.test.ts` | frontend-root | 440 | 19.0 | Project source/support file |
| 406 | `frontend/tests/appRefresh.test.ts` | frontend-root | 55 | 1.5 | Project source/support file |
| 407 | `frontend/tests/appShellUtils.test.ts` | frontend-root | 116 | 5.1 | Project source/support file |
| 408 | `frontend/tests/assetCompression.test.ts` | frontend-root | 36 | 1.5 | Project source/support file |
| 409 | `frontend/tests/backupJobs.test.ts` | frontend-root | 136 | 9.0 | Project source/support file |
| 410 | `frontend/tests/barcodeImageScanner.test.ts` | frontend-root | 119 | 3.2 | Project source/support file |
| 411 | `frontend/tests/barcodeScannerState.test.ts` | frontend-root | 64 | 2.6 | Project source/support file |
| 412 | `frontend/tests/bulkOps.test.ts` | frontend-root | 62 | 2.1 | Project source/support file |
| 413 | `frontend/tests/contactImportWorker.test.ts` | frontend-root | 41 | 1.7 | Project source/support file |
| 414 | `frontend/tests/csvImport.test.ts` | frontend-root | 86 | 3.5 | Project source/support file |
| 415 | `frontend/tests/dashboardDataReliability.test.ts` | frontend-root | 31 | 3.2 | Project source/support file |
| 416 | `frontend/tests/dateHelpers.test.ts` | frontend-root | 41 | 1.1 | Project source/support file |
| 417 | `frontend/tests/deviceInfo.test.ts` | frontend-root | 63 | 1.9 | Project source/support file |
| 418 | `frontend/tests/exportPackages.test.ts` | frontend-root | 105 | 4.0 | Project source/support file |
| 419 | `frontend/tests/formatters.test.ts` | frontend-root | 38 | 1.0 | Project source/support file |
| 420 | `frontend/tests/globalScroll.test.ts` | frontend-root | 25 | 0.7 | Project source/support file |
| 421 | `frontend/tests/globalScrollControls.test.ts` | frontend-root | 34 | 1.2 | Project source/support file |
| 422 | `frontend/tests/groupedRecords.test.ts` | frontend-root | 117 | 3.8 | Project source/support file |
| 423 | `frontend/tests/historyHelpers.test.ts` | frontend-root | 75 | 2.3 | Project source/support file |
| 424 | `frontend/tests/importJobRefresh.test.ts` | frontend-root | 95 | 2.8 | Project source/support file |
| 425 | `frontend/tests/initials.test.ts` | frontend-root | 68 | 2.2 | Project source/support file |
| 426 | `frontend/tests/inventoryImportWorker.test.ts` | frontend-root | 41 | 1.8 | Project source/support file |
| 427 | `frontend/tests/inventoryMobileCardLayout.test.ts` | frontend-root | 43 | 2.3 | Project source/support file |
| 428 | `frontend/tests/inventoryMovementGroups.test.ts` | frontend-root | 67 | 2.4 | Project source/support file |
| 429 | `frontend/tests/inventoryRfidSection.test.ts` | frontend-root | 23 | 1.1 | Project source/support file |
| 430 | `frontend/tests/jsxSyntaxCheck.ts` | frontend-root | 36 | 1.3 | Project source/support file |
| 431 | `frontend/tests/loaders.test.ts` | frontend-root | 85 | 2.7 | Project source/support file |
| 432 | `frontend/tests/mediaUploadHelpers.test.ts` | frontend-root | 38 | 1.4 | Project source/support file |
| 433 | `frontend/tests/navigationConfig.test.ts` | frontend-root | 43 | 1.4 | Project source/support file |
| 434 | `frontend/tests/notificationBadge.test.ts` | frontend-root | 16 | 0.7 | Project source/support file |
| 435 | `frontend/tests/offlineSalesQueue.test.ts` | frontend-root | 80 | 3.6 | Project source/support file |
| 436 | `frontend/tests/offlineSecurityHardening.test.ts` | frontend-root | 95 | 4.2 | Project source/support file |
| 437 | `frontend/tests/offlineSyncArchitecture.test.ts` | frontend-root | 94 | 4.6 | Project source/support file |
| 438 | `frontend/tests/ownedGoogleAuth.test.ts` | frontend-root | 58 | 2.6 | Project source/support file |
| 439 | `frontend/tests/performanceLoadingUx.test.ts` | frontend-root | 2079 | 92.9 | Project source/support file |
| 440 | `frontend/tests/permissionEditor.test.ts` | frontend-root | 36 | 1.3 | Project source/support file |
| 441 | `frontend/tests/permissions.test.ts` | frontend-root | 18 | 0.6 | Project source/support file |
| 442 | `frontend/tests/portalCatalogDisplay.test.ts` | frontend-root | 126 | 4.6 | Project source/support file |
| 443 | `frontend/tests/portalContentI18n.test.ts` | frontend-root | 115 | 3.9 | Project source/support file |
| 444 | `frontend/tests/portalEditorUtils.test.ts` | frontend-root | 59 | 1.9 | Project source/support file |
| 445 | `frontend/tests/portalFaqVocabulary.test.ts` | frontend-root | 110 | 5.1 | Project source/support file |
| 446 | `frontend/tests/portalLanguagePacks.test.ts` | frontend-root | 50 | 3.1 | Project source/support file |
| 447 | `frontend/tests/portalTranslateController.test.ts` | frontend-root | 182 | 5.8 | Project source/support file |
| 448 | `frontend/tests/posCore.test.ts` | frontend-root | 169 | 6.3 | Project source/support file |
| 449 | `frontend/tests/pricingContacts.test.ts` | frontend-root | 110 | 4.0 | Project source/support file |
| 450 | `frontend/tests/productBatches.test.ts` | frontend-root | 55 | 1.3 | Project source/support file |
| 451 | `frontend/tests/productDiscountUx.test.ts` | frontend-root | 54 | 2.4 | Project source/support file |
| 452 | `frontend/tests/productDisplayHelpers.test.ts` | frontend-root | 107 | 3.5 | Project source/support file |
| 453 | `frontend/tests/productFilterHelpers.test.ts` | frontend-root | 108 | 3.1 | Project source/support file |
| 454 | `frontend/tests/productGalleryHelpers.test.ts` | frontend-root | 141 | 4.3 | Project source/support file |
| 455 | `frontend/tests/productGrouping.test.ts` | frontend-root | 114 | 5.1 | Project source/support file |
| 456 | `frontend/tests/productGroupViewHelpers.test.ts` | frontend-root | 53 | 1.5 | Project source/support file |
| 457 | `frontend/tests/productHistoryHelpers.test.ts` | frontend-root | 46 | 1.4 | Project source/support file |
| 458 | `frontend/tests/productImportPlanner.test.ts` | frontend-root | 290 | 13.9 | Project source/support file |
| 459 | `frontend/tests/productImportWorkerFallback.test.ts` | frontend-root | 43 | 2.0 | Project source/support file |
| 460 | `frontend/tests/productMenuHelpers.test.ts` | frontend-root | 188 | 5.9 | Project source/support file |
| 461 | `frontend/tests/productPageHelpers.test.ts` | frontend-root | 23 | 0.8 | Project source/support file |
| 462 | `frontend/tests/productSearchPagination.test.ts` | frontend-root | 140 | 5.4 | Project source/support file |
| 463 | `frontend/tests/productSelectionHelpers.test.ts` | frontend-root | 73 | 2.8 | Project source/support file |
| 464 | `frontend/tests/productWriteHelpers.test.ts` | frontend-root | 517 | 13.0 | Project source/support file |
| 465 | `frontend/tests/publicErrorRecovery.test.ts` | frontend-root | 37 | 1.4 | Project source/support file |
| 466 | `frontend/tests/receiptSettingsSync.test.ts` | frontend-root | 43 | 3.1 | Project source/support file |
| 467 | `frontend/tests/receiptTemplate.test.ts` | frontend-root | 83 | 3.6 | Project source/support file |
| 468 | `frontend/tests/returnsLayout.test.ts` | frontend-root | 23 | 1.6 | Project source/support file |
| 469 | `frontend/tests/runtimeErrorClassifier.test.ts` | frontend-root | 63 | 2.5 | Project source/support file |
| 470 | `frontend/tests/salesImportWorker.test.ts` | frontend-root | 41 | 1.8 | Project source/support file |
| 471 | `frontend/tests/scanbotScanner.test.ts` | frontend-root | 121 | 3.4 | Project source/support file |
| 472 | `frontend/tests/scriptTypography.test.ts` | frontend-root | 17 | 0.9 | Project source/support file |
| 473 | `frontend/tests/sectionNavigation.test.ts` | frontend-root | 48 | 2.4 | Project source/support file |
| 474 | `frontend/tests/settingsConflictHelpers.test.ts` | frontend-root | 45 | 1.4 | Project source/support file |
| 475 | `frontend/tests/settingsRefresh.test.ts` | frontend-root | 73 | 1.6 | Project source/support file |
| 476 | `frontend/tests/storagePolicy.test.ts` | frontend-root | 44 | 1.4 | Project source/support file |
| 477 | `frontend/tests/utilsSettingsBarrel.test.ts` | frontend-root | 19 | 1.1 | Project source/support file |
| 478 | `frontend/tsconfig.json` | frontend-root | 45 | 1.2 | Configuration/data manifest |
| 479 | `frontend/vite.config.ts` | frontend-root | 246 | 9.5 | Project source/support file |
| 480 | `ops/scripts/architecture/generated-bulk-audit.ts` | project-scripts | 603 | 22.8 | Project source/support file |
| 481 | `ops/scripts/architecture/language-runtime-audit.ts` | project-scripts | 1574 | 67.9 | Project source/support file |
| 482 | `ops/scripts/architecture/organization-audit.ts` | project-scripts | 381 | 16.9 | Project source/support file |
| 483 | `ops/scripts/architecture/phase29-audit.ts` | project-scripts | 572 | 19.9 | Project source/support file |
| 484 | `ops/scripts/backend/schema-audit.js` | project-scripts | 496 | 16.9 | Project source/support file |
| 485 | `ops/scripts/backend/schema-primary-key-preflight.ts` | project-scripts | 216 | 8.3 | Project source/support file |
| 486 | `ops/scripts/backend/schema-primary-key-rollback.sql` | project-scripts | 15 | 0.5 | Project source/support file |
| 487 | `ops/scripts/backend/verify-data-integrity.js` | project-scripts | 689 | 29.0 | Project source/support file |
| 488 | `ops/scripts/frontend/verify-i18n.js` | project-scripts | 145 | 4.3 | Project source/support file |
| 489 | `ops/scripts/frontend/verify-performance.js` | project-scripts | 144 | 9.6 | Project source/support file |
| 490 | `ops/scripts/frontend/verify-ui.js` | project-scripts | 243 | 8.7 | Project source/support file |
| 491 | `ops/scripts/lib/fs-utils.js` | project-scripts | 214 | 5.3 | Project source/support file |
| 492 | `ops/scripts/lib/report-utils.js` | project-scripts | 57 | 1.5 | Project source/support file |
| 493 | `ops/scripts/powershell/clean-generated.ps1` | project-scripts | 265 | 7.9 | Project source/support file |
| 494 | `ops/scripts/powershell/clear-stale-node-processes.ps1` | project-scripts | 92 | 2.8 | Project source/support file |
| 495 | `ops/scripts/powershell/docker-release.ps1` | project-scripts | 1011 | 48.0 | Project source/support file |
| 496 | `ops/scripts/powershell/full-automation.ps1` | project-scripts | 214 | 8.1 | Project source/support file |
| 497 | `ops/scripts/powershell/npm-install-mode.ps1` | project-scripts | 28 | 0.8 | Project source/support file |
| 498 | `ops/scripts/powershell/runtime-bootstrap.ps1` | project-scripts | 592 | 21.6 | Project source/support file |
| 499 | `ops/scripts/powershell/start-runtime.ps1` | project-scripts | 377 | 16.3 | Project source/support file |
| 500 | `ops/scripts/powershell/tailscale-health-monitor.ps1` | project-scripts | 240 | 7.8 | Project source/support file |
| 501 | `ops/scripts/runtime/audits/action-history-undo-redo-check.ts` | project-scripts | 206 | 7.1 | Project source/support file |
| 502 | `ops/scripts/runtime/audits/audit-auth.ts` | project-scripts | 191 | 6.0 | Project source/support file |
| 503 | `ops/scripts/runtime/audits/audit-manifest.ts` | project-scripts | 302 | 8.7 | Project source/support file |
| 504 | `ops/scripts/runtime/audits/audit-report-html.ts` | project-scripts | 446 | 15.9 | Project source/support file |
| 505 | `ops/scripts/runtime/audits/deep-live-audit.mjs` | project-scripts | 1425 | 53.8 | Project source/support file |
| 506 | `ops/scripts/runtime/audits/full-app-audit.mjs` | project-scripts | 621 | 27.5 | Project source/support file |
| 507 | `ops/scripts/runtime/browser-action-smoke.ts` | project-scripts | 869 | 31.2 | Project source/support file |
| 508 | `ops/scripts/runtime/cloudflare/rotate-cloudflare-tunnel-token.ts` | project-scripts | 244 | 10.8 | Project source/support file |
| 509 | `ops/scripts/runtime/cloudflare/update-cloudflare-tunnel-origin.ts` | project-scripts | 144 | 6.0 | Project source/support file |
| 510 | `ops/scripts/runtime/cloudflare/verify-cloudflare-automation.ts` | project-scripts | 285 | 12.0 | Project source/support file |
| 511 | `ops/scripts/runtime/cloudflare/verify-r2-object-store.ts` | project-scripts | 155 | 6.0 | Project source/support file |
| 512 | `ops/scripts/runtime/live-checks/live-check-utils.ts` | project-scripts | 123 | 3.6 | Project source/support file |
| 513 | `ops/scripts/runtime/live-checks/phase84-branches-actions-live-check.ts` | project-scripts | 139 | 6.5 | Project source/support file |
| 514 | `ops/scripts/runtime/live-checks/phase84-contacts-live-check.ts` | project-scripts | 136 | 6.0 | Project source/support file |
| 515 | `ops/scripts/runtime/live-checks/phase84-files-providers-actions-live-check.ts` | project-scripts | 136 | 6.3 | Project source/support file |
| 516 | `ops/scripts/runtime/live-checks/phase84-inventory-actions-live-check.ts` | project-scripts | 165 | 8.1 | Project source/support file |
| 517 | `ops/scripts/runtime/live-checks/phase84-live-suite.ts` | project-scripts | 247 | 7.6 | Project source/support file |
| 518 | `ops/scripts/runtime/live-checks/phase84-product-brands-actions-live-check.ts` | project-scripts | 140 | 6.7 | Project source/support file |
| 519 | `ops/scripts/runtime/live-checks/phase84-product-categories-actions-live-check.ts` | project-scripts | 129 | 6.1 | Project source/support file |
| 520 | `ops/scripts/runtime/live-checks/phase84-product-page-actions-live-check.ts` | project-scripts | 144 | 6.6 | Project source/support file |
| 521 | `ops/scripts/runtime/live-checks/phase84-product-scanning-actions-live-check.ts` | project-scripts | 127 | 6.0 | Project source/support file |
| 522 | `ops/scripts/runtime/live-checks/phase84-product-stock-actions-live-check.ts` | project-scripts | 139 | 6.7 | Project source/support file |
| 523 | `ops/scripts/runtime/live-checks/phase84-product-units-actions-live-check.ts` | project-scripts | 129 | 6.0 | Project source/support file |
| 524 | `ops/scripts/runtime/live-checks/phase84-product-variant-actions-live-check.ts` | project-scripts | 139 | 6.0 | Project source/support file |
| 525 | `ops/scripts/runtime/live-checks/phase84-public-portal-cloudflare-check.ts` | project-scripts | 176 | 7.3 | Project source/support file |
| 526 | `ops/scripts/runtime/live-checks/phase84-sales-actions-live-check.ts` | project-scripts | 137 | 6.1 | Project source/support file |
| 527 | `ops/scripts/runtime/live-checks/phase84-ui-live-check.mjs` | project-scripts | 855 | 56.5 | Project source/support file |
| 528 | `ops/scripts/runtime/live-checks/phase84-users-actions-live-check.ts` | project-scripts | 164 | 7.9 | Project source/support file |
| 529 | `ops/scripts/runtime/smoke/check-public-url.ts` | project-scripts | 239 | 8.2 | Project source/support file |
| 530 | `ops/scripts/runtime/smoke/check-route-contract.ts` | project-scripts | 86 | 3.9 | Project source/support file |
| 531 | `ops/scripts/runtime/smoke/live-smoke.ts` | project-scripts | 318 | 13.4 | Project source/support file |
| 532 | `ops/scripts/runtime/smoke/post-start-diagnostics.ts` | project-scripts | 213 | 6.9 | Project source/support file |
| 533 | `ops/scripts/runtime/storage/cleanup-integrity-backlog.ts` | project-scripts | 230 | 9.6 | Project source/support file |
| 534 | `ops/scripts/runtime/storage/cleanup-test-data.ts` | project-scripts | 430 | 18.8 | Project source/support file |
| 535 | `ops/scripts/runtime/storage/dataset-readiness.ts` | project-scripts | 117 | 4.5 | Project source/support file |
| 536 | `ops/scripts/runtime/storage/post-live-hygiene.ts` | project-scripts | 211 | 6.7 | Project source/support file |
| 537 | `ops/scripts/runtime/storage/prune-storage.ts` | project-scripts | 464 | 15.7 | Project source/support file |
| 538 | `ops/scripts/runtime/storage/restore-candidates.ts` | project-scripts | 213 | 7.5 | Project source/support file |
| 539 | `ops/scripts/runtime/storage/restore-rehearsal.ts` | project-scripts | 219 | 7.9 | Project source/support file |
| 540 | `ops/scripts/verification/verify-backup-reliability.js` | project-scripts | 140 | 5.0 | Project source/support file |
| 541 | `ops/scripts/verification/verify-docker-release.js` | project-scripts | 651 | 30.7 | Project source/support file |
| 542 | `ops/scripts/verification/verify-hardening-policy.js` | project-scripts | 140 | 5.5 | Project source/support file |
| 543 | `ops/scripts/verification/verify-runtime-deps.js` | project-scripts | 352 | 14.9 | Project source/support file |
| 544 | `ops/scripts/verification/verify-scale-services.js` | project-scripts | 175 | 6.5 | Project source/support file |
| 545 | `ops/scripts/verification/verify-secret-hygiene.js` | project-scripts | 56 | 2.0 | Project source/support file |
| 546 | `package.json` | project-root | 22 | 0.6 | Configuration/data manifest |
| 547 | `README.md` | project-root | 159 | 11.5 | Project documentation entrypoint |
| 548 | `run/build-release.bat` | project-scripts | 54 | 1.7 | Final Docker release build wrapper |
| 549 | `run/clean-generated.bat` | project-scripts | 60 | 1.8 | Project source/support file |
| 550 | `run/cloudflare-origin.bat` | project-scripts | 34 | 1.1 | Project source/support file |
| 551 | `run/docker/backup.bat` | project-scripts | 15 | 0.6 | Project source/support file |
| 552 | `run/docker/doctor.bat` | project-scripts | 15 | 0.5 | Project source/support file |
| 553 | `run/docker/install.bat` | project-scripts | 15 | 0.5 | Project source/support file |
| 554 | `run/docker/README.md` | project-scripts | 44 | 3.1 | Documentation |
| 555 | `run/docker/release.bat` | project-scripts | 15 | 0.5 | Project source/support file |
| 556 | `run/docker/restore.bat` | project-scripts | 29 | 1.0 | Project source/support file |
| 557 | `run/docker/rotate-cloudflare.bat` | project-scripts | 15 | 0.5 | Project source/support file |
| 558 | `run/docker/start.bat` | project-scripts | 15 | 0.6 | Project source/support file |
| 559 | `run/docker/update.bat` | project-scripts | 15 | 0.5 | Project source/support file |
| 560 | `run/full-automation.bat` | project-scripts | 22 | 0.6 | Project source/support file |
| 561 | `run/README.md` | project-scripts | 47 | 2.9 | Documentation |
| 562 | `run/setup.bat` | project-scripts | 349 | 16.2 | Project source/support file |
| 563 | `run/sh/setup.sh` | project-scripts | 116 | 3.3 | Project source/support file |
| 564 | `run/sh/start-server.sh` | project-scripts | 147 | 5.6 | Project source/support file |
| 565 | `run/sh/stop-server.sh` | project-scripts | 62 | 1.6 | Project source/support file |
| 566 | `run/start-server.bat` | project-scripts | 570 | 29.3 | Project source/support file |
| 567 | `run/stop-server.bat` | project-scripts | 183 | 8.4 | Project source/support file |
| 568 | `run/verify-local.bat` | project-scripts | 148 | 4.9 | Project source/support file |
| 569 | `Start Business OS.bat` | project-root | 38 | 1.3 | Project source/support file |
