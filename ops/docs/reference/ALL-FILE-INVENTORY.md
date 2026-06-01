# All File Inventory (Project First-Party Files)

Auto-generated file-level commentary for all first-party project files (frontend, backend, scripts, and root run/config files; excluding dependencies/build artifacts).

## 1. Coverage Summary

Total files documented: **580**

## 2. File Commentary Matrix

| No. | File | Category | Lines | Size (KB) | Purpose |
|---:|---|---|---:|---:|---|
| 1 | `.npmrc` | project-root | 14 | 0.4 | Project source/support file |
| 2 | `backend/.env` | backend-root | 67 | 3.0 | Project source/support file |
| 3 | `backend/.npmrc` | backend-root | 14 | 0.4 | Project source/support file |
| 4 | `backend/package-lock.json` | backend-root | 6225 | 224.7 | Configuration/data manifest |
| 5 | `backend/package.json` | backend-root | 69 | 4.0 | Configuration/data manifest |
| 6 | `backend/README.md` | backend-root | 14 | 0.7 | Documentation |
| 7 | `backend/server.js` | backend-root | 564 | 24.1 | Backend server entrypoint |
| 8 | `backend/server.ts` | backend-root | 577 | 20.0 | Project source/support file |
| 9 | `backend/src/accessControl.ts` | backend-core | 218 | 6.2 | Project source/support file |
| 10 | `backend/src/analytics/duckdbRuntime.ts` | backend-core | 109 | 3.0 | Project source/support file |
| 11 | `backend/src/authOtpGuards.ts` | backend-core | 34 | 1.2 | Project source/support file |
| 12 | `backend/src/backupSchema.ts` | backend-core | 165 | 3.8 | Project source/support file |
| 13 | `backend/src/businessMetrics.ts` | backend-core | 192 | 7.0 | Project source/support file |
| 14 | `backend/src/catalogTextIntegrity.ts` | backend-core | 96 | 3.0 | Project source/support file |
| 15 | `backend/src/config/index.ts` | backend-core | 303 | 12.3 | Project source/support file |
| 16 | `backend/src/conflictControl.ts` | backend-core | 117 | 3.4 | Project source/support file |
| 17 | `backend/src/contactOptions.ts` | backend-core | 211 | 6.5 | Project source/support file |
| 18 | `backend/src/database.ts` | backend-core | 4 | 0.1 | Schema/migrations and DB bootstrap |
| 19 | `backend/src/dataPath/index.ts` | backend-core | 258 | 7.3 | Project source/support file |
| 20 | `backend/src/db/cutoverReadiness.ts` | backend-core | 173 | 5.5 | Project source/support file |
| 21 | `backend/src/db/postgresQueryCompat.ts` | backend-core | 240 | 6.7 | Project source/support file |
| 22 | `backend/src/db/postgresSchema.sql` | backend-core | 2148 | 54.6 | Project source/support file |
| 23 | `backend/src/fileAssets.ts` | backend-core | 1261 | 43.9 | Project source/support file |
| 24 | `backend/src/helpers.ts` | backend-core | 625 | 21.0 | Project source/support file |
| 25 | `backend/src/idempotency.ts` | backend-core | 14 | 0.3 | Project source/support file |
| 26 | `backend/src/importCsv.ts` | backend-core | 343 | 8.4 | Project source/support file |
| 27 | `backend/src/importParsing.ts` | backend-core | 111 | 3.6 | Project source/support file |
| 28 | `backend/src/initials.ts` | backend-core | 120 | 3.7 | Project source/support file |
| 29 | `backend/src/maintenanceLock.ts` | backend-core | 131 | 3.3 | Project source/support file |
| 30 | `backend/src/middleware.ts` | backend-core | 336 | 10.3 | Project source/support file |
| 31 | `backend/src/money.ts` | backend-core | 29 | 0.8 | Project source/support file |
| 32 | `backend/src/netSecurity.ts` | backend-core | 148 | 3.6 | Project source/support file |
| 33 | `backend/src/objectStore.ts` | backend-core | 468 | 15.1 | Project source/support file |
| 34 | `backend/src/optionalSharp.ts` | backend-core | 32 | 0.7 | Project source/support file |
| 35 | `backend/src/organizationContext/index.ts` | backend-core | 264 | 8.2 | Project source/support file |
| 36 | `backend/src/permissions.ts` | backend-core | 227 | 7.0 | Project source/support file |
| 37 | `backend/src/portalUtils.ts` | backend-core | 122 | 3.1 | Project source/support file |
| 38 | `backend/src/postgresDatabase.ts` | backend-core | 596 | 25.4 | Project source/support file |
| 39 | `backend/src/productBatches.ts` | backend-core | 646 | 21.5 | Project source/support file |
| 40 | `backend/src/productDiscounts.ts` | backend-core | 200 | 6.8 | Project source/support file |
| 41 | `backend/src/productImportPolicies.ts` | backend-core | 174 | 5.4 | Project source/support file |
| 42 | `backend/src/README.md` | backend-core | 12 | 0.7 | Documentation |
| 43 | `backend/src/requestContext.ts` | backend-core | 65 | 1.7 | Project source/support file |
| 44 | `backend/src/routes/actionHistory.ts` | backend-routes | 256 | 9.0 | API route handler |
| 45 | `backend/src/routes/ai.ts` | backend-routes | 270 | 9.2 | API route handler |
| 46 | `backend/src/routes/auth.ts` | backend-routes | 1148 | 40.6 | API route handler |
| 47 | `backend/src/routes/branches.ts` | backend-routes | 452 | 19.7 | API route handler |
| 48 | `backend/src/routes/catalog.ts` | backend-routes | 110 | 3.0 | API route handler |
| 49 | `backend/src/routes/categories.ts` | backend-routes | 147 | 5.8 | API route handler |
| 50 | `backend/src/routes/contacts.ts` | backend-routes | 1053 | 41.9 | API route handler |
| 51 | `backend/src/routes/customTables.ts` | backend-routes | 259 | 9.5 | API route handler |
| 52 | `backend/src/routes/files.ts` | backend-routes | 133 | 5.2 | API route handler |
| 53 | `backend/src/routes/importJobs.ts` | backend-routes | 501 | 17.3 | API route handler |
| 54 | `backend/src/routes/inventory.ts` | backend-routes | 1881 | 83.8 | API route handler |
| 55 | `backend/src/routes/notifications.ts` | backend-routes | 581 | 19.6 | API route handler |
| 56 | `backend/src/routes/organizations.ts` | backend-routes | 68 | 2.0 | API route handler |
| 57 | `backend/src/routes/portal.ts` | backend-routes | 1407 | 51.5 | API route handler |
| 58 | `backend/src/routes/products.ts` | backend-routes | 2218 | 99.1 | API route handler |
| 59 | `backend/src/routes/README.md` | backend-routes | 37 | 1.5 | API route handler |
| 60 | `backend/src/routes/returns.ts` | backend-routes | 1050 | 41.4 | API route handler |
| 61 | `backend/src/routes/runtime.ts` | backend-routes | 157 | 4.7 | API route handler |
| 62 | `backend/src/routes/sales.ts` | backend-routes | 1573 | 64.6 | API route handler |
| 63 | `backend/src/routes/settings.ts` | backend-routes | 249 | 8.9 | API route handler |
| 64 | `backend/src/routes/sync.ts` | backend-routes | 301 | 13.3 | API route handler |
| 65 | `backend/src/routes/system/index.ts` | backend-routes | 1659 | 65.3 | API route handler |
| 66 | `backend/src/routes/units.ts` | backend-routes | 151 | 5.9 | API route handler |
| 67 | `backend/src/routes/users.ts` | backend-routes | 1086 | 44.5 | API route handler |
| 68 | `backend/src/runtimeCache.ts` | backend-core | 248 | 6.2 | Project source/support file |
| 69 | `backend/src/runtimeState/index.ts` | backend-core | 97 | 2.7 | Project source/support file |
| 70 | `backend/src/runtimeVersion.ts` | backend-core | 176 | 4.4 | Project source/support file |
| 71 | `backend/src/schemaMetadata.ts` | backend-core | 155 | 3.7 | Project source/support file |
| 72 | `backend/src/security.ts` | backend-core | 253 | 7.1 | Project source/support file |
| 73 | `backend/src/serverUtils.ts` | backend-core | 431 | 15.5 | Project source/support file |
| 74 | `backend/src/services/aiGateway.ts` | backend-services | 364 | 13.6 | Integration/service layer |
| 75 | `backend/src/services/backupPackages.ts` | backend-services | 1060 | 36.3 | Integration/service layer |
| 76 | `backend/src/services/firebaseAuth.ts` | backend-services | 384 | 14.3 | Integration/service layer |
| 77 | `backend/src/services/googleDriveSync/index.ts` | backend-services | 1564 | 57.8 | Integration/service layer |
| 78 | `backend/src/services/googleDriveSync/versioning.ts` | backend-services | 135 | 4.0 | Integration/service layer |
| 79 | `backend/src/services/googleOauth.ts` | backend-services | 252 | 8.8 | Integration/service layer |
| 80 | `backend/src/services/importJobs.ts` | backend-services | 3880 | 157.1 | Integration/service layer |
| 81 | `backend/src/services/integrationDoctor.ts` | backend-services | 353 | 11.8 | Integration/service layer |
| 82 | `backend/src/services/mediaQueue.ts` | backend-services | 200 | 7.2 | Integration/service layer |
| 83 | `backend/src/services/portalAi.ts` | backend-services | 621 | 21.8 | Integration/service layer |
| 84 | `backend/src/services/README.md` | backend-services | 29 | 1.0 | Integration/service layer |
| 85 | `backend/src/services/verification.ts` | backend-services | 272 | 8.4 | Integration/service layer |
| 86 | `backend/src/sessionAuth.ts` | backend-core | 215 | 6.8 | Project source/support file |
| 87 | `backend/src/settingsSnapshot.ts` | backend-core | 181 | 5.0 | Project source/support file |
| 88 | `backend/src/storage/organizationFolders.ts` | backend-core | 59 | 2.0 | Project source/support file |
| 89 | `backend/src/systemFsWorker.ts` | backend-core | 122 | 3.6 | Project source/support file |
| 90 | `backend/src/systemJobs.ts` | backend-core | 467 | 14.5 | Project source/support file |
| 91 | `backend/src/uploadReferenceCleanup.ts` | backend-core | 245 | 8.2 | Project source/support file |
| 92 | `backend/src/uploadSecurity.ts` | backend-core | 119 | 4.1 | Project source/support file |
| 93 | `backend/src/websocket.ts` | backend-core | 94 | 3.6 | Project source/support file |
| 94 | `backend/src/workers/importWorker.ts` | backend-core | 42 | 1.1 | Project source/support file |
| 95 | `backend/src/workers/mediaWorker.ts` | backend-core | 41 | 1.0 | Project source/support file |
| 96 | `backend/test/accessControl.test.ts` | backend-root | 127 | 4.0 | Project source/support file |
| 97 | `backend/test/analyticsRuntime.test.ts` | backend-root | 49 | 1.2 | Project source/support file |
| 98 | `backend/test/authOtpGuards.test.ts` | backend-root | 71 | 1.7 | Project source/support file |
| 99 | `backend/test/authSecurityFlow.test.ts` | backend-root | 283 | 9.0 | Project source/support file |
| 100 | `backend/test/backupDefaultDestination.test.ts` | backend-root | 15 | 0.6 | Project source/support file |
| 101 | `backend/test/backupPerformanceHardening.test.ts` | backend-root | 177 | 9.9 | Project source/support file |
| 102 | `backend/test/backupRetention.test.ts` | backend-root | 91 | 3.8 | Project source/support file |
| 103 | `backend/test/backupSchema.test.ts` | backend-root | 111 | 4.4 | Project source/support file |
| 104 | `backend/test/branchStockSearch.test.ts` | backend-root | 271 | 9.8 | Project source/support file |
| 105 | `backend/test/contactOptions.test.ts` | backend-root | 82 | 2.3 | Project source/support file |
| 106 | `backend/test/dataPath.test.ts` | backend-root | 87 | 3.1 | Project source/support file |
| 107 | `backend/test/defaultRoles.test.ts` | backend-root | 145 | 4.9 | Project source/support file |
| 108 | `backend/test/fileAssetStorageReconcile.test.ts` | backend-root | 57 | 1.4 | Project source/support file |
| 109 | `backend/test/fileAssetUsageCache.test.ts` | backend-root | 120 | 3.6 | Project source/support file |
| 110 | `backend/test/fileRouteSecurityFlow.test.ts` | backend-root | 217 | 7.2 | Project source/support file |
| 111 | `backend/test/fullAutomation.test.ts` | backend-root | 970 | 38.0 | Project source/support file |
| 112 | `backend/test/googleDriveSyncVersioning.test.ts` | backend-root | 121 | 5.1 | Project source/support file |
| 113 | `backend/test/idempotency.test.ts` | backend-root | 32 | 0.7 | Project source/support file |
| 114 | `backend/test/importCsv.test.ts` | backend-root | 83 | 3.0 | Project source/support file |
| 115 | `backend/test/importDecisionIntegrity.test.ts` | backend-root | 167 | 5.6 | Project source/support file |
| 116 | `backend/test/importJobPerformanceHardening.test.ts` | backend-root | 39 | 1.5 | Project source/support file |
| 117 | `backend/test/importJobStateMachine.test.ts` | backend-root | 420 | 21.0 | Project source/support file |
| 118 | `backend/test/importScaleSmoke.test.ts` | backend-root | 79 | 2.7 | Project source/support file |
| 119 | `backend/test/initials.test.ts` | backend-root | 24 | 0.8 | Project source/support file |
| 120 | `backend/test/integrationDoctor.test.ts` | backend-root | 50 | 1.6 | Project source/support file |
| 121 | `backend/test/inventorySettingsMediaContracts.test.ts` | backend-root | 62 | 3.0 | Project source/support file |
| 122 | `backend/test/mediaOptimization.test.ts` | backend-root | 118 | 3.9 | Project source/support file |
| 123 | `backend/test/netSecurity.test.ts` | backend-root | 45 | 1.5 | Project source/support file |
| 124 | `backend/test/notificationSummaryCache.test.ts` | backend-root | 95 | 2.8 | Project source/support file |
| 125 | `backend/test/offlineSecurity.test.ts` | backend-root | 87 | 3.7 | Project source/support file |
| 126 | `backend/test/ownedGoogleAuth.test.ts` | backend-root | 98 | 4.0 | Project source/support file |
| 127 | `backend/test/permissionPolicy.test.ts` | backend-root | 34 | 1.7 | Project source/support file |
| 128 | `backend/test/portalInventoryRegression.test.ts` | backend-root | 103 | 8.8 | Project source/support file |
| 129 | `backend/test/portalUtils.test.ts` | backend-root | 40 | 1.2 | Project source/support file |
| 130 | `backend/test/postgresCutoverReadiness.test.ts` | backend-root | 56 | 1.6 | Project source/support file |
| 131 | `backend/test/postgresDatabase.test.ts` | backend-root | 123 | 4.1 | Project source/support file |
| 132 | `backend/test/postgresQueryCompat.test.ts` | backend-root | 98 | 3.5 | Project source/support file |
| 133 | `backend/test/productBatchHierarchy.test.ts` | backend-root | 104 | 4.8 | Project source/support file |
| 134 | `backend/test/productExpiry.test.ts` | backend-root | 68 | 2.8 | Project source/support file |
| 135 | `backend/test/productImportPolicies.test.ts` | backend-root | 72 | 3.0 | Project source/support file |
| 136 | `backend/test/productSearchPagination.test.ts` | backend-root | 19 | 1.6 | Project source/support file |
| 137 | `backend/test/rfidRoutes.test.ts` | backend-root | 59 | 3.0 | Project source/support file |
| 138 | `backend/test/routeContracts.test.ts` | backend-root | 311 | 16.7 | Project source/support file |
| 139 | `backend/test/runtimeCache.test.ts` | backend-root | 65 | 2.0 | Project source/support file |
| 140 | `backend/test/runtimeVersion.test.ts` | backend-root | 51 | 1.4 | Project source/support file |
| 141 | `backend/test/schemaMetadata.test.ts` | backend-root | 117 | 3.9 | Project source/support file |
| 142 | `backend/test/security.test.ts` | backend-root | 84 | 2.6 | Project source/support file |
| 143 | `backend/test/serverUtils.test.ts` | backend-root | 283 | 10.3 | Project source/support file |
| 144 | `backend/test/settingsSnapshotObjectStorage.test.ts` | backend-root | 173 | 5.7 | Project source/support file |
| 145 | `backend/test/systemJobs.test.ts` | backend-root | 97 | 3.5 | Project source/support file |
| 146 | `backend/test/uploadSecurity.test.ts` | backend-root | 59 | 2.0 | Project source/support file |
| 147 | `backend/test/websocket.test.ts` | backend-root | 9 | 0.3 | Project source/support file |
| 148 | `frontend/.npmrc` | frontend-root | 14 | 0.4 | Project source/support file |
| 149 | `frontend/index.html` | frontend-root | 24 | 1.0 | Project source/support file |
| 150 | `frontend/package-lock.json` | frontend-root | 3833 | 131.7 | Configuration/data manifest |
| 151 | `frontend/package.json` | frontend-root | 47 | 4.4 | Configuration/data manifest |
| 152 | `frontend/public/favicon.ico` | frontend-root | 0 | 11.4 | Project source/support file |
| 153 | `frontend/public/icon.png` | frontend-root | 0 | 11.4 | Project source/support file |
| 154 | `frontend/public/manifest.json` | frontend-root | 17 | 0.3 | Configuration/data manifest |
| 155 | `frontend/public/runtime-noise-guard.js` | frontend-root | 119 | 4.9 | Project source/support file |
| 156 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.js` | frontend-root | 1 | 94.8 | Project source/support file |
| 157 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.wasm` | frontend-root | 0 | 8726.7 | Project source/support file |
| 158 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.worker.js` | frontend-root | 1 | 1.9 | Project source/support file |
| 159 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd.wasm` | frontend-root | 0 | 8782.2 | Project source/support file |
| 160 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm.wasm` | frontend-root | 0 | 8192.9 | Project source/support file |
| 161 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd-threads.js` | frontend-root | 1 | 146.4 | Project source/support file |
| 162 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd.js` | frontend-root | 1 | 135.5 | Project source/support file |
| 163 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core.js` | frontend-root | 1 | 135.5 | Project source/support file |
| 164 | `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js` | frontend-root | 187 | 1007.0 | Project source/support file |
| 165 | `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js.LICENSE.txt` | frontend-root | 24 | 0.5 | Project source/support file |
| 166 | `frontend/public/sw.js` | frontend-root | 416 | 16.4 | Project source/support file |
| 167 | `frontend/public/theme-bootstrap.js` | frontend-root | 218 | 9.2 | Project source/support file |
| 168 | `frontend/README.md` | frontend-root | 13 | 0.5 | Documentation |
| 169 | `frontend/src/api/accessControlTransport.ts` | frontend-api | 131 | 3.6 | Frontend API/sync helper |
| 170 | `frontend/src/api/actionHistoryTransport.ts` | frontend-api | 59 | 1.7 | Frontend API/sync helper |
| 171 | `frontend/src/api/actorQuery.ts` | frontend-api | 39 | 1.3 | Frontend API/sync helper |
| 172 | `frontend/src/api/aiTransport.ts` | frontend-api | 37 | 1.4 | Frontend API/sync helper |
| 173 | `frontend/src/api/appBootstrapTransport.ts` | frontend-api | 91 | 2.4 | Frontend API/sync helper |
| 174 | `frontend/src/api/auditLogTransport.ts` | frontend-api | 51 | 1.6 | Frontend API/sync helper |
| 175 | `frontend/src/api/authTransport.ts` | frontend-api | 105 | 3.3 | Frontend API/sync helper |
| 176 | `frontend/src/api/branchTransport.ts` | frontend-api | 117 | 3.2 | Frontend API/sync helper |
| 177 | `frontend/src/api/browserDialogs.ts` | frontend-api | 35 | 0.9 | Frontend API/sync helper |
| 178 | `frontend/src/api/conflicts.ts` | frontend-api | 43 | 1.2 | Frontend API/sync helper |
| 179 | `frontend/src/api/contactsTransport.ts` | frontend-api | 209 | 7.2 | Frontend API/sync helper |
| 180 | `frontend/src/api/cooldownFallbacks.ts` | frontend-api | 106 | 3.1 | Frontend API/sync helper |
| 181 | `frontend/src/api/customTablesTransport.ts` | frontend-api | 87 | 2.3 | Frontend API/sync helper |
| 182 | `frontend/src/api/dashboardTransport.ts` | frontend-api | 18 | 0.5 | Frontend API/sync helper |
| 183 | `frontend/src/api/driveSync.ts` | frontend-api | 97 | 3.1 | Frontend API/sync helper |
| 184 | `frontend/src/api/expectedUpdatedAt.ts` | frontend-api | 47 | 1.4 | Frontend API/sync helper |
| 185 | `frontend/src/api/fileTransport.ts` | frontend-api | 260 | 8.1 | Frontend API/sync helper |
| 186 | `frontend/src/api/http.ts` | frontend-api | 1093 | 41.3 | Frontend API/sync helper |
| 187 | `frontend/src/api/importJobsTransport.ts` | frontend-api | 236 | 8.2 | Frontend API/sync helper |
| 188 | `frontend/src/api/importTransport.ts` | frontend-api | 51 | 1.6 | Frontend API/sync helper |
| 189 | `frontend/src/api/inventoryTransport.ts` | frontend-api | 132 | 3.7 | Frontend API/sync helper |
| 190 | `frontend/src/api/localDb.ts` | frontend-api | 287 | 11.0 | Frontend API/sync helper |
| 191 | `frontend/src/api/localMirrors.ts` | frontend-api | 57 | 2.0 | Frontend API/sync helper |
| 192 | `frontend/src/api/lookupTransport.ts` | frontend-api | 101 | 2.8 | Frontend API/sync helper |
| 193 | `frontend/src/api/methods.ts` | frontend-api | 1420 | 58.1 | Frontend API/sync helper |
| 194 | `frontend/src/api/notificationSummary.ts` | frontend-api | 61 | 2.0 | Frontend API/sync helper |
| 195 | `frontend/src/api/portalHttp.ts` | frontend-api | 29 | 0.8 | Frontend API/sync helper |
| 196 | `frontend/src/api/portalTransport.ts` | frontend-api | 121 | 4.1 | Frontend API/sync helper |
| 197 | `frontend/src/api/productReadTransport.ts` | frontend-api | 85 | 2.6 | Frontend API/sync helper |
| 198 | `frontend/src/api/productWriteTransport.ts` | frontend-api | 86 | 2.6 | Frontend API/sync helper |
| 199 | `frontend/src/api/query.ts` | frontend-api | 54 | 1.5 | Frontend API/sync helper |
| 200 | `frontend/src/api/queryCache.ts` | frontend-api | 60 | 1.9 | Frontend API/sync helper |
| 201 | `frontend/src/api/README.md` | frontend-api | 176 | 9.1 | Frontend API/sync helper |
| 202 | `frontend/src/api/requestIds.ts` | frontend-api | 19 | 0.7 | Frontend API/sync helper |
| 203 | `frontend/src/api/rfidTransport.ts` | frontend-api | 82 | 2.4 | Frontend API/sync helper |
| 204 | `frontend/src/api/salesTransport.ts` | frontend-api | 38 | 1.1 | Frontend API/sync helper |
| 205 | `frontend/src/api/syncPreview.ts` | frontend-api | 55 | 1.5 | Frontend API/sync helper |
| 206 | `frontend/src/api/syncRuntime.ts` | frontend-api | 53 | 1.8 | Frontend API/sync helper |
| 207 | `frontend/src/api/systemJobs.ts` | frontend-api | 106 | 3.2 | Frontend API/sync helper |
| 208 | `frontend/src/api/systemRuntime.ts` | frontend-api | 130 | 4.3 | Frontend API/sync helper |
| 209 | `frontend/src/api/websocket.ts` | frontend-api | 230 | 7.6 | Frontend API/sync helper |
| 210 | `frontend/src/App.tsx` | frontend-core | 1827 | 68.5 | Main app shell and page mounting |
| 211 | `frontend/src/app/appShellUtils.ts` | frontend-core | 159 | 5.2 | Project source/support file |
| 212 | `frontend/src/app/publicErrorRecovery.ts` | frontend-core | 35 | 1.3 | Project source/support file |
| 213 | `frontend/src/AppContext.tsx` | frontend-core | 1853 | 74.6 | Global app state/context provider |
| 214 | `frontend/src/components/auth/Login.tsx` | frontend-ui | 1245 | 53.8 | UI component/page |
| 215 | `frontend/src/components/branches/Branches.tsx` | frontend-ui | 1076 | 49.6 | UI component/page |
| 216 | `frontend/src/components/branches/BranchForm.tsx` | frontend-ui | 202 | 6.4 | UI component/page |
| 217 | `frontend/src/components/branches/TransferModal.tsx` | frontend-ui | 415 | 16.0 | UI component/page |
| 218 | `frontend/src/components/catalog/CatalogEditorSurface.tsx` | frontend-ui | 1479 | 102.5 | UI component/page |
| 219 | `frontend/src/components/catalog/CatalogImageField.tsx` | frontend-ui | 115 | 4.6 | UI component/page |
| 220 | `frontend/src/components/catalog/CatalogPage.tsx` | frontend-ui | 3396 | 148.3 | UI component/page |
| 221 | `frontend/src/components/catalog/CatalogPageContext.tsx` | frontend-ui | 25 | 0.6 | UI component/page |
| 222 | `frontend/src/components/catalog/CatalogPreviewSurface.tsx` | frontend-ui | 454 | 21.5 | UI component/page |
| 223 | `frontend/src/components/catalog/CatalogProductsSection.tsx` | frontend-ui | 614 | 30.3 | UI component/page |
| 224 | `frontend/src/components/catalog/CatalogSecondaryTabs.tsx` | frontend-ui | 1081 | 56.3 | UI component/page |
| 225 | `frontend/src/components/catalog/catalogUi.tsx` | frontend-ui | 82 | 3.0 | UI component/page |
| 226 | `frontend/src/components/catalog/portalCatalogDisplay.ts` | frontend-ui | 183 | 6.2 | UI component/page |
| 227 | `frontend/src/components/catalog/portalContentI18n.ts` | frontend-ui | 788 | 49.4 | UI component/page |
| 228 | `frontend/src/components/catalog/portalEditorUtils.ts` | frontend-ui | 189 | 5.8 | UI component/page |
| 229 | `frontend/src/components/catalog/portalLanguagePacks.ts` | frontend-ui | 1349 | 62.5 | UI component/page |
| 230 | `frontend/src/components/catalog/portalTranslateController.ts` | frontend-ui | 224 | 9.0 | UI component/page |
| 231 | `frontend/src/components/contacts/ContactImportModal.tsx` | frontend-ui | 418 | 15.8 | UI component/page |
| 232 | `frontend/src/components/contacts/contactImportWorker.ts` | frontend-ui | 39 | 1.0 | UI component/page |
| 233 | `frontend/src/components/contacts/contactOptionUtils.ts` | frontend-ui | 131 | 4.9 | UI component/page |
| 234 | `frontend/src/components/contacts/Contacts.tsx` | frontend-ui | 415 | 15.9 | UI component/page |
| 235 | `frontend/src/components/contacts/CustomerFormModal.tsx` | frontend-ui | 248 | 11.2 | UI component/page |
| 236 | `frontend/src/components/contacts/customerMembershipNumber.ts` | frontend-ui | 11 | 0.4 | UI component/page |
| 237 | `frontend/src/components/contacts/CustomersTab.tsx` | frontend-ui | 920 | 44.0 | UI component/page |
| 238 | `frontend/src/components/contacts/DeliveryTab.tsx` | frontend-ui | 952 | 47.4 | UI component/page |
| 239 | `frontend/src/components/contacts/shared.tsx` | frontend-ui | 435 | 15.8 | UI component/page |
| 240 | `frontend/src/components/contacts/SuppliersTab.tsx` | frontend-ui | 958 | 47.3 | UI component/page |
| 241 | `frontend/src/components/custom-tables/CustomTables.tsx` | frontend-ui | 715 | 31.3 | UI component/page |
| 242 | `frontend/src/components/dashboard/charts/BarChart.tsx` | frontend-ui | 178 | 6.3 | UI component/page |
| 243 | `frontend/src/components/dashboard/charts/DonutChart.tsx` | frontend-ui | 120 | 4.3 | UI component/page |
| 244 | `frontend/src/components/dashboard/charts/index.ts` | frontend-ui | 5 | 0.2 | UI component/page |
| 245 | `frontend/src/components/dashboard/charts/LineChart.tsx` | frontend-ui | 245 | 9.6 | UI component/page |
| 246 | `frontend/src/components/dashboard/charts/NoData.tsx` | frontend-ui | 15 | 0.4 | UI component/page |
| 247 | `frontend/src/components/dashboard/Dashboard.tsx` | frontend-ui | 2304 | 115.1 | UI component/page |
| 248 | `frontend/src/components/dashboard/MiniStat.tsx` | frontend-ui | 53 | 2.0 | UI component/page |
| 249 | `frontend/src/components/files/FilePickerModal.tsx` | frontend-ui | 333 | 13.7 | UI component/page |
| 250 | `frontend/src/components/files/FilesPage.tsx` | frontend-ui | 1192 | 53.7 | UI component/page |
| 251 | `frontend/src/components/files/FilesProvidersTab.tsx` | frontend-ui | 335 | 19.5 | UI component/page |
| 252 | `frontend/src/components/files/FilesResponsesTab.tsx` | frontend-ui | 197 | 11.0 | UI component/page |
| 253 | `frontend/src/components/inventory/DualMoney.tsx` | frontend-ui | 16 | 0.4 | UI component/page |
| 254 | `frontend/src/components/inventory/Inventory.tsx` | frontend-ui | 4281 | 216.0 | UI component/page |
| 255 | `frontend/src/components/inventory/InventoryImportModal.tsx` | frontend-ui | 299 | 13.0 | UI component/page |
| 256 | `frontend/src/components/inventory/inventoryImportWorker.ts` | frontend-ui | 39 | 1.0 | UI component/page |
| 257 | `frontend/src/components/inventory/InventoryMovementsSurface.tsx` | frontend-ui | 674 | 38.5 | UI component/page |
| 258 | `frontend/src/components/inventory/InventoryProductsSurface.tsx` | frontend-ui | 565 | 34.5 | UI component/page |
| 259 | `frontend/src/components/inventory/InventoryRfidSurface.tsx` | frontend-ui | 180 | 9.6 | UI component/page |
| 260 | `frontend/src/components/inventory/movementGroups.ts` | frontend-ui | 287 | 12.9 | UI component/page |
| 261 | `frontend/src/components/inventory/ProductDetailModal.tsx` | frontend-ui | 267 | 15.0 | UI component/page |
| 262 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx` | frontend-ui | 717 | 39.5 | UI component/page |
| 263 | `frontend/src/components/navigation/Sidebar.tsx` | frontend-ui | 386 | 17.1 | UI component/page |
| 264 | `frontend/src/components/pos/CartItem.tsx` | frontend-ui | 158 | 6.3 | UI component/page |
| 265 | `frontend/src/components/pos/FilterPanel.tsx` | frontend-ui | 289 | 9.3 | UI component/page |
| 266 | `frontend/src/components/pos/POS.tsx` | frontend-ui | 2218 | 117.4 | UI component/page |
| 267 | `frontend/src/components/pos/posCore.ts` | frontend-ui | 167 | 6.4 | UI component/page |
| 268 | `frontend/src/components/pos/ProductImage.tsx` | frontend-ui | 12 | 0.3 | UI component/page |
| 269 | `frontend/src/components/pos/QuickAddModal.tsx` | frontend-ui | 49 | 1.8 | UI component/page |
| 270 | `frontend/src/components/products/config/productPageConfig.ts` | frontend-ui | 24 | 0.7 | UI component/page |
| 271 | `frontend/src/components/products/forms/BranchStockAdjuster.tsx` | frontend-ui | 193 | 6.6 | UI component/page |
| 272 | `frontend/src/components/products/forms/BulkAddStockModal.tsx` | frontend-ui | 180 | 6.2 | UI component/page |
| 273 | `frontend/src/components/products/forms/ProductForm.tsx` | frontend-ui | 1129 | 52.2 | UI component/page |
| 274 | `frontend/src/components/products/forms/VariantFormModal.tsx` | frontend-ui | 376 | 15.7 | UI component/page |
| 275 | `frontend/src/components/products/helpers/productDisplayHelpers.ts` | frontend-ui | 156 | 5.8 | UI component/page |
| 276 | `frontend/src/components/products/helpers/productFilterHelpers.ts` | frontend-ui | 216 | 9.0 | UI component/page |
| 277 | `frontend/src/components/products/helpers/productGalleryHelpers.ts` | frontend-ui | 101 | 3.1 | UI component/page |
| 278 | `frontend/src/components/products/helpers/productGroupViewHelpers.ts` | frontend-ui | 46 | 1.6 | UI component/page |
| 279 | `frontend/src/components/products/helpers/productMenuHelpers.ts` | frontend-ui | 292 | 11.0 | UI component/page |
| 280 | `frontend/src/components/products/helpers/productPageHelpers.ts` | frontend-ui | 32 | 1.0 | UI component/page |
| 281 | `frontend/src/components/products/helpers/productSelectionHelpers.ts` | frontend-ui | 139 | 4.2 | UI component/page |
| 282 | `frontend/src/components/products/helpers/productWriteHelpers.ts` | frontend-ui | 372 | 12.7 | UI component/page |
| 283 | `frontend/src/components/products/history/productHistoryHelpers.ts` | frontend-ui | 46 | 1.4 | UI component/page |
| 284 | `frontend/src/components/products/import/BulkImportModal.tsx` | frontend-ui | 2144 | 101.0 | UI component/page |
| 285 | `frontend/src/components/products/import/productImportPlanner.ts` | frontend-ui | 634 | 25.3 | UI component/page |
| 286 | `frontend/src/components/products/import/productImportWorker.ts` | frontend-ui | 68 | 1.9 | UI component/page |
| 287 | `frontend/src/components/products/lookups/ManageBrandsModal.tsx` | frontend-ui | 777 | 31.6 | UI component/page |
| 288 | `frontend/src/components/products/lookups/ManageCategoriesModal.tsx` | frontend-ui | 603 | 25.0 | UI component/page |
| 289 | `frontend/src/components/products/lookups/ManageUnitsModal.tsx` | frontend-ui | 603 | 24.0 | UI component/page |
| 290 | `frontend/src/components/products/lookups/productLookupSnapshots.ts` | frontend-ui | 229 | 7.3 | UI component/page |
| 291 | `frontend/src/components/products/Products.tsx` | frontend-ui | 2344 | 109.7 | UI component/page |
| 292 | `frontend/src/components/products/scanning/barcodeImageScanner.ts` | frontend-ui | 125 | 4.1 | UI component/page |
| 293 | `frontend/src/components/products/scanning/BarcodeScannerModal.tsx` | frontend-ui | 643 | 30.0 | UI component/page |
| 294 | `frontend/src/components/products/scanning/barcodeScannerState.ts` | frontend-ui | 82 | 2.5 | UI component/page |
| 295 | `frontend/src/components/products/scanning/cameraPermission.ts` | frontend-ui | 40 | 1.4 | UI component/page |
| 296 | `frontend/src/components/products/scanning/scanbotScanner.ts` | frontend-ui | 172 | 5.8 | UI component/page |
| 297 | `frontend/src/components/products/shared/primitives.tsx` | frontend-ui | 250 | 8.1 | UI component/page |
| 298 | `frontend/src/components/products/surfaces/HeaderActions.tsx` | frontend-ui | 154 | 5.8 | UI component/page |
| 299 | `frontend/src/components/products/surfaces/ProductDetailModal.tsx` | frontend-ui | 327 | 14.6 | UI component/page |
| 300 | `frontend/src/components/products/surfaces/ProductRowParts.tsx` | frontend-ui | 196 | 6.4 | UI component/page |
| 301 | `frontend/src/components/products/surfaces/ProductsListSurface.tsx` | frontend-ui | 391 | 20.5 | UI component/page |
| 302 | `frontend/src/components/README.md` | frontend-ui | 37 | 1.9 | UI component/page |
| 303 | `frontend/src/components/receipt-settings/AllFieldsPanel.tsx` | frontend-ui | 121 | 4.5 | UI component/page |
| 304 | `frontend/src/components/receipt-settings/constants.ts` | frontend-ui | 156 | 7.9 | UI component/page |
| 305 | `frontend/src/components/receipt-settings/ErrorBoundary.tsx` | frontend-ui | 45 | 1.2 | UI component/page |
| 306 | `frontend/src/components/receipt-settings/FieldOrderManager.tsx` | frontend-ui | 206 | 10.0 | UI component/page |
| 307 | `frontend/src/components/receipt-settings/PrintSettings.tsx` | frontend-ui | 274 | 12.3 | UI component/page |
| 308 | `frontend/src/components/receipt-settings/ReceiptPreview.tsx` | frontend-ui | 131 | 4.3 | UI component/page |
| 309 | `frontend/src/components/receipt-settings/ReceiptSettings.tsx` | frontend-ui | 529 | 29.0 | UI component/page |
| 310 | `frontend/src/components/receipt-settings/template.ts` | frontend-ui | 33 | 0.9 | UI component/page |
| 311 | `frontend/src/components/receipt/Receipt.tsx` | frontend-ui | 578 | 26.2 | UI component/page |
| 312 | `frontend/src/components/returns/EditReturnModal.tsx` | frontend-ui | 349 | 16.3 | UI component/page |
| 313 | `frontend/src/components/returns/NewReturnModal.tsx` | frontend-ui | 618 | 31.8 | UI component/page |
| 314 | `frontend/src/components/returns/NewSupplierReturnModal.tsx` | frontend-ui | 494 | 23.8 | UI component/page |
| 315 | `frontend/src/components/returns/ReturnDetailModal.tsx` | frontend-ui | 186 | 8.5 | UI component/page |
| 316 | `frontend/src/components/returns/Returns.tsx` | frontend-ui | 1034 | 44.3 | UI component/page |
| 317 | `frontend/src/components/returns/ReturnsListSurface.tsx` | frontend-ui | 384 | 19.2 | UI component/page |
| 318 | `frontend/src/components/sales/ExportModal.tsx` | frontend-ui | 318 | 13.2 | UI component/page |
| 319 | `frontend/src/components/sales/SaleDetailModal.tsx` | frontend-ui | 408 | 18.4 | UI component/page |
| 320 | `frontend/src/components/sales/Sales.tsx` | frontend-ui | 1038 | 45.1 | UI component/page |
| 321 | `frontend/src/components/sales/SalesImportModal.tsx` | frontend-ui | 288 | 12.2 | UI component/page |
| 322 | `frontend/src/components/sales/salesImportWorker.ts` | frontend-ui | 39 | 1.0 | UI component/page |
| 323 | `frontend/src/components/sales/SalesListSurface.tsx` | frontend-ui | 383 | 20.8 | UI component/page |
| 324 | `frontend/src/components/sales/StatusBadge.tsx` | frontend-ui | 58 | 2.1 | UI component/page |
| 325 | `frontend/src/components/server/ServerPage.tsx` | frontend-ui | 923 | 42.9 | UI component/page |
| 326 | `frontend/src/components/shared/ActionHistoryBar.tsx` | frontend-ui | 195 | 9.2 | UI component/page |
| 327 | `frontend/src/components/shared/BackgroundImportTracker.tsx` | frontend-ui | 652 | 27.6 | UI component/page |
| 328 | `frontend/src/components/shared/ExportMenu.tsx` | frontend-ui | 47 | 1.7 | UI component/page |
| 329 | `frontend/src/components/shared/FilterMenu.tsx` | frontend-ui | 143 | 5.6 | UI component/page |
| 330 | `frontend/src/components/shared/globalScroll.ts` | frontend-ui | 72 | 2.7 | UI component/page |
| 331 | `frontend/src/components/shared/ImageGalleryLightbox.tsx` | frontend-ui | 140 | 5.5 | UI component/page |
| 332 | `frontend/src/components/shared/LoadingWatchdog.tsx` | frontend-ui | 74 | 2.2 | UI component/page |
| 333 | `frontend/src/components/shared/Modal.tsx` | frontend-ui | 38 | 1.3 | UI component/page |
| 334 | `frontend/src/components/shared/navigationConfig.ts` | frontend-ui | 66 | 2.3 | UI component/page |
| 335 | `frontend/src/components/shared/NotificationCenter.tsx` | frontend-ui | 695 | 33.4 | UI component/page |
| 336 | `frontend/src/components/shared/pageActivity.ts` | frontend-ui | 12 | 0.3 | UI component/page |
| 337 | `frontend/src/components/shared/PageHeader.tsx` | frontend-ui | 72 | 2.5 | UI component/page |
| 338 | `frontend/src/components/shared/PaginationControls.tsx` | frontend-ui | 222 | 10.3 | UI component/page |
| 339 | `frontend/src/components/shared/PortalMenu.tsx` | frontend-ui | 271 | 8.9 | UI component/page |
| 340 | `frontend/src/components/shared/QuickPreferenceToggles.tsx` | frontend-ui | 77 | 2.5 | UI component/page |
| 341 | `frontend/src/components/shared/SectionSwitcher.tsx` | frontend-ui | 88 | 3.2 | UI component/page |
| 342 | `frontend/src/components/shared/WriteConflictModal.tsx` | frontend-ui | 321 | 12.5 | UI component/page |
| 343 | `frontend/src/components/users/PermissionEditor.tsx` | frontend-ui | 192 | 8.3 | UI component/page |
| 344 | `frontend/src/components/users/UserDetailSheet.tsx` | frontend-ui | 145 | 6.1 | UI component/page |
| 345 | `frontend/src/components/users/UserProfileModal.tsx` | frontend-ui | 1311 | 67.7 | UI component/page |
| 346 | `frontend/src/components/users/Users.tsx` | frontend-ui | 1182 | 54.9 | UI component/page |
| 347 | `frontend/src/components/utils-settings/AuditLog.tsx` | frontend-ui | 1292 | 59.1 | UI component/page |
| 348 | `frontend/src/components/utils-settings/Backup.tsx` | frontend-ui | 1732 | 78.5 | UI component/page |
| 349 | `frontend/src/components/utils-settings/FontFamilyPicker.tsx` | frontend-ui | 73 | 3.0 | UI component/page |
| 350 | `frontend/src/components/utils-settings/index.ts` | frontend-ui | 7 | 0.3 | UI component/page |
| 351 | `frontend/src/components/utils-settings/OtpModal.tsx` | frontend-ui | 294 | 11.6 | UI component/page |
| 352 | `frontend/src/components/utils-settings/ResetData.tsx` | frontend-ui | 366 | 15.4 | UI component/page |
| 353 | `frontend/src/components/utils-settings/Settings.tsx` | frontend-ui | 1846 | 85.1 | UI component/page |
| 354 | `frontend/src/components/utils-settings/settingsConflict.ts` | frontend-ui | 64 | 1.8 | UI component/page |
| 355 | `frontend/src/constants.ts` | frontend-core | 185 | 4.6 | Project source/support file |
| 356 | `frontend/src/index.tsx` | frontend-core | 227 | 7.8 | Project source/support file |
| 357 | `frontend/src/lang/en.json` | frontend-i18n | 2721 | 134.5 | Localization dictionary |
| 358 | `frontend/src/lang/km.json` | frontend-i18n | 2730 | 246.7 | Localization dictionary |
| 359 | `frontend/src/platform/runtime/clientRuntime.ts` | frontend-core | 249 | 9.1 | Project source/support file |
| 360 | `frontend/src/platform/storage/storagePolicy.ts` | frontend-core | 40 | 1.3 | Project source/support file |
| 361 | `frontend/src/public-runtime/runtime-noise-guard.ts` | frontend-core | 120 | 4.9 | Project source/support file |
| 362 | `frontend/src/public-runtime/service-worker.ts` | frontend-core | 424 | 14.7 | Project source/support file |
| 363 | `frontend/src/public-runtime/theme-bootstrap.ts` | frontend-core | 232 | 8.6 | Project source/support file |
| 364 | `frontend/src/README.md` | frontend-core | 37 | 1.5 | Documentation |
| 365 | `frontend/src/runtime/runtimeErrorClassifier.ts` | frontend-core | 154 | 5.4 | Project source/support file |
| 366 | `frontend/src/styles/main.css` | frontend-style | 741 | 29.9 | Project source/support file |
| 367 | `frontend/src/types/receiptContracts.ts` | frontend-core | 67 | 1.6 | Project source/support file |
| 368 | `frontend/src/types/settingsContracts.ts` | frontend-core | 28 | 0.5 | Project source/support file |
| 369 | `frontend/src/utils/actionGuards.ts` | frontend-utils | 76 | 2.2 | Utility helper |
| 370 | `frontend/src/utils/actionHistory.ts` | frontend-utils | 293 | 10.6 | Utility helper |
| 371 | `frontend/src/utils/appRefresh.ts` | frontend-utils | 38 | 1.0 | Utility helper |
| 372 | `frontend/src/utils/bulkOps.ts` | frontend-utils | 69 | 1.9 | Utility helper |
| 373 | `frontend/src/utils/color.ts` | frontend-utils | 34 | 1.0 | Utility helper |
| 374 | `frontend/src/utils/csv.ts` | frontend-utils | 234 | 7.6 | Utility helper |
| 375 | `frontend/src/utils/csvExportWorker.ts` | frontend-utils | 35 | 1.0 | Utility helper |
| 376 | `frontend/src/utils/csvImport.ts` | frontend-utils | 306 | 10.1 | Utility helper |
| 377 | `frontend/src/utils/csvRowCounter.d.mts` | frontend-utils | 2 | 0.1 | Utility helper |
| 378 | `frontend/src/utils/csvRowCounter.ts` | frontend-utils | 40 | 0.9 | Utility helper |
| 379 | `frontend/src/utils/dateHelpers.ts` | frontend-utils | 18 | 0.6 | Utility helper |
| 380 | `frontend/src/utils/deviceInfo.ts` | frontend-utils | 54 | 1.5 | Utility helper |
| 381 | `frontend/src/utils/exportPackage.ts` | frontend-utils | 61 | 1.4 | Utility helper |
| 382 | `frontend/src/utils/exportReports.tsx` | frontend-utils | 423 | 11.2 | Utility helper |
| 383 | `frontend/src/utils/favicon.ts` | frontend-utils | 101 | 3.1 | Utility helper |
| 384 | `frontend/src/utils/formatters.ts` | frontend-utils | 89 | 2.7 | Utility helper |
| 385 | `frontend/src/utils/groupedRecords.ts` | frontend-utils | 330 | 11.2 | Utility helper |
| 386 | `frontend/src/utils/historyHelpers.ts` | frontend-utils | 61 | 1.8 | Utility helper |
| 387 | `frontend/src/utils/importJobRefresh.ts` | frontend-utils | 106 | 3.1 | Utility helper |
| 388 | `frontend/src/utils/index.ts` | frontend-utils | 6 | 0.2 | Utility helper |
| 389 | `frontend/src/utils/initials.ts` | frontend-utils | 105 | 3.5 | Utility helper |
| 390 | `frontend/src/utils/loaders.ts` | frontend-utils | 101 | 3.1 | Utility helper |
| 391 | `frontend/src/utils/mediaUpload.ts` | frontend-utils | 145 | 4.1 | Utility helper |
| 392 | `frontend/src/utils/permissions.ts` | frontend-utils | 22 | 0.6 | Utility helper |
| 393 | `frontend/src/utils/pricing.ts` | frontend-utils | 102 | 4.0 | Utility helper |
| 394 | `frontend/src/utils/printReceipt.ts` | frontend-utils | 1016 | 36.0 | Utility helper |
| 395 | `frontend/src/utils/productBatches.ts` | frontend-utils | 61 | 1.8 | Utility helper |
| 396 | `frontend/src/utils/productGrouping.ts` | frontend-utils | 315 | 11.3 | Utility helper |
| 397 | `frontend/src/utils/publicAssetUrls.ts` | frontend-utils | 80 | 3.1 | Utility helper |
| 398 | `frontend/src/utils/receiptAppliedConfig.ts` | frontend-utils | 147 | 4.5 | Utility helper |
| 399 | `frontend/src/utils/scriptTypography.ts` | frontend-utils | 27 | 0.7 | Utility helper |
| 400 | `frontend/src/utils/settingsRefresh.ts` | frontend-utils | 84 | 2.5 | Utility helper |
| 401 | `frontend/src/utils/settingsWriteOptions.ts` | frontend-utils | 14 | 0.6 | Utility helper |
| 402 | `frontend/src/web-api.ts` | frontend-core | 907 | 35.1 | Project source/support file |
| 403 | `frontend/tailwind.config.ts` | frontend-root | 19 | 0.5 | Project source/support file |
| 404 | `frontend/tests/actionGuards.test.ts` | frontend-root | 74 | 2.3 | Project source/support file |
| 405 | `frontend/tests/actionStability.test.ts` | frontend-root | 744 | 60.7 | Project source/support file |
| 406 | `frontend/tests/adminShellMediaGuards.test.ts` | frontend-root | 147 | 5.5 | Project source/support file |
| 407 | `frontend/tests/apiHttp.test.ts` | frontend-root | 1002 | 54.0 | Project source/support file |
| 408 | `frontend/tests/appRefresh.test.ts` | frontend-root | 55 | 1.5 | Project source/support file |
| 409 | `frontend/tests/appShellUtils.test.ts` | frontend-root | 116 | 5.1 | Project source/support file |
| 410 | `frontend/tests/assetCompression.test.ts` | frontend-root | 36 | 1.5 | Project source/support file |
| 411 | `frontend/tests/backupJobs.test.ts` | frontend-root | 137 | 9.1 | Project source/support file |
| 412 | `frontend/tests/barcodeImageScanner.test.ts` | frontend-root | 119 | 3.2 | Project source/support file |
| 413 | `frontend/tests/barcodeScannerState.test.ts` | frontend-root | 64 | 2.6 | Project source/support file |
| 414 | `frontend/tests/bulkOps.test.ts` | frontend-root | 62 | 2.1 | Project source/support file |
| 415 | `frontend/tests/contactImportWorker.test.ts` | frontend-root | 41 | 1.7 | Project source/support file |
| 416 | `frontend/tests/csvImport.test.ts` | frontend-root | 86 | 3.5 | Project source/support file |
| 417 | `frontend/tests/dashboardDataReliability.test.ts` | frontend-root | 31 | 3.2 | Project source/support file |
| 418 | `frontend/tests/dateHelpers.test.ts` | frontend-root | 41 | 1.1 | Project source/support file |
| 419 | `frontend/tests/deviceInfo.test.ts` | frontend-root | 63 | 1.9 | Project source/support file |
| 420 | `frontend/tests/exportPackages.test.ts` | frontend-root | 105 | 4.0 | Project source/support file |
| 421 | `frontend/tests/formatters.test.ts` | frontend-root | 38 | 1.0 | Project source/support file |
| 422 | `frontend/tests/globalScroll.test.ts` | frontend-root | 25 | 0.7 | Project source/support file |
| 423 | `frontend/tests/globalScrollControls.test.ts` | frontend-root | 34 | 1.2 | Project source/support file |
| 424 | `frontend/tests/groupedRecords.test.ts` | frontend-root | 117 | 3.8 | Project source/support file |
| 425 | `frontend/tests/historyHelpers.test.ts` | frontend-root | 75 | 2.3 | Project source/support file |
| 426 | `frontend/tests/importJobRefresh.test.ts` | frontend-root | 95 | 2.8 | Project source/support file |
| 427 | `frontend/tests/initials.test.ts` | frontend-root | 68 | 2.2 | Project source/support file |
| 428 | `frontend/tests/inventoryImportWorker.test.ts` | frontend-root | 41 | 1.8 | Project source/support file |
| 429 | `frontend/tests/inventoryMobileCardLayout.test.ts` | frontend-root | 43 | 2.3 | Project source/support file |
| 430 | `frontend/tests/inventoryMovementGroups.test.ts` | frontend-root | 67 | 2.4 | Project source/support file |
| 431 | `frontend/tests/inventoryRfidSection.test.ts` | frontend-root | 23 | 1.1 | Project source/support file |
| 432 | `frontend/tests/loaders.test.ts` | frontend-root | 85 | 2.7 | Project source/support file |
| 433 | `frontend/tests/mediaUploadHelpers.test.ts` | frontend-root | 38 | 1.4 | Project source/support file |
| 434 | `frontend/tests/navigationConfig.test.ts` | frontend-root | 43 | 1.4 | Project source/support file |
| 435 | `frontend/tests/notificationBadge.test.ts` | frontend-root | 16 | 0.7 | Project source/support file |
| 436 | `frontend/tests/offlineSalesQueue.test.ts` | frontend-root | 82 | 3.8 | Project source/support file |
| 437 | `frontend/tests/offlineSecurityHardening.test.ts` | frontend-root | 95 | 4.2 | Project source/support file |
| 438 | `frontend/tests/offlineSyncArchitecture.test.ts` | frontend-root | 97 | 4.8 | Project source/support file |
| 439 | `frontend/tests/ownedGoogleAuth.test.ts` | frontend-root | 58 | 2.6 | Project source/support file |
| 440 | `frontend/tests/performanceLoadingUx.test.ts` | frontend-root | 2163 | 108.2 | Project source/support file |
| 441 | `frontend/tests/permissionEditor.test.ts` | frontend-root | 36 | 1.3 | Project source/support file |
| 442 | `frontend/tests/permissions.test.ts` | frontend-root | 18 | 0.6 | Project source/support file |
| 443 | `frontend/tests/portalCatalogDisplay.test.ts` | frontend-root | 126 | 4.6 | Project source/support file |
| 444 | `frontend/tests/portalContentI18n.test.ts` | frontend-root | 115 | 3.9 | Project source/support file |
| 445 | `frontend/tests/portalEditorUtils.test.ts` | frontend-root | 59 | 1.9 | Project source/support file |
| 446 | `frontend/tests/portalFaqVocabulary.test.ts` | frontend-root | 110 | 5.1 | Project source/support file |
| 447 | `frontend/tests/portalLanguagePacks.test.ts` | frontend-root | 50 | 3.1 | Project source/support file |
| 448 | `frontend/tests/portalTranslateController.test.ts` | frontend-root | 182 | 5.8 | Project source/support file |
| 449 | `frontend/tests/posCore.test.ts` | frontend-root | 169 | 6.3 | Project source/support file |
| 450 | `frontend/tests/pricingContacts.test.ts` | frontend-root | 110 | 4.0 | Project source/support file |
| 451 | `frontend/tests/productBatches.test.ts` | frontend-root | 55 | 1.3 | Project source/support file |
| 452 | `frontend/tests/productDiscountUx.test.ts` | frontend-root | 54 | 2.4 | Project source/support file |
| 453 | `frontend/tests/productDisplayHelpers.test.ts` | frontend-root | 107 | 3.5 | Project source/support file |
| 454 | `frontend/tests/productFilterHelpers.test.ts` | frontend-root | 108 | 3.1 | Project source/support file |
| 455 | `frontend/tests/productGalleryHelpers.test.ts` | frontend-root | 141 | 4.3 | Project source/support file |
| 456 | `frontend/tests/productGrouping.test.ts` | frontend-root | 114 | 5.1 | Project source/support file |
| 457 | `frontend/tests/productGroupViewHelpers.test.ts` | frontend-root | 53 | 1.5 | Project source/support file |
| 458 | `frontend/tests/productHistoryHelpers.test.ts` | frontend-root | 46 | 1.4 | Project source/support file |
| 459 | `frontend/tests/productImportPlanner.test.ts` | frontend-root | 290 | 13.9 | Project source/support file |
| 460 | `frontend/tests/productImportWorkerFallback.test.ts` | frontend-root | 43 | 2.0 | Project source/support file |
| 461 | `frontend/tests/productMenuHelpers.test.ts` | frontend-root | 188 | 5.9 | Project source/support file |
| 462 | `frontend/tests/productPageHelpers.test.ts` | frontend-root | 23 | 0.8 | Project source/support file |
| 463 | `frontend/tests/productSearchPagination.test.ts` | frontend-root | 141 | 5.7 | Project source/support file |
| 464 | `frontend/tests/productSelectionHelpers.test.ts` | frontend-root | 73 | 2.8 | Project source/support file |
| 465 | `frontend/tests/productWriteHelpers.test.ts` | frontend-root | 517 | 13.0 | Project source/support file |
| 466 | `frontend/tests/publicErrorRecovery.test.ts` | frontend-root | 37 | 1.4 | Project source/support file |
| 467 | `frontend/tests/receiptSettingsSync.test.ts` | frontend-root | 43 | 3.1 | Project source/support file |
| 468 | `frontend/tests/receiptTemplate.test.ts` | frontend-root | 83 | 3.6 | Project source/support file |
| 469 | `frontend/tests/returnsLayout.test.ts` | frontend-root | 23 | 1.6 | Project source/support file |
| 470 | `frontend/tests/runtimeErrorClassifier.test.ts` | frontend-root | 63 | 2.5 | Project source/support file |
| 471 | `frontend/tests/salesImportWorker.test.ts` | frontend-root | 41 | 1.8 | Project source/support file |
| 472 | `frontend/tests/scanbotScanner.test.ts` | frontend-root | 155 | 4.7 | Project source/support file |
| 473 | `frontend/tests/scriptTypography.test.ts` | frontend-root | 17 | 0.9 | Project source/support file |
| 474 | `frontend/tests/sectionNavigation.test.ts` | frontend-root | 48 | 2.4 | Project source/support file |
| 475 | `frontend/tests/settingsConflictHelpers.test.ts` | frontend-root | 45 | 1.4 | Project source/support file |
| 476 | `frontend/tests/settingsRefresh.test.ts` | frontend-root | 73 | 1.6 | Project source/support file |
| 477 | `frontend/tests/sourceSyntaxCheck.ts` | frontend-root | 58 | 2.2 | Project source/support file |
| 478 | `frontend/tests/storagePolicy.test.ts` | frontend-root | 44 | 1.4 | Project source/support file |
| 479 | `frontend/tests/utilsSettingsBarrel.test.ts` | frontend-root | 16 | 0.8 | Project source/support file |
| 480 | `frontend/tsconfig.json` | frontend-root | 47 | 1.3 | Configuration/data manifest |
| 481 | `frontend/vite.config.ts` | frontend-root | 260 | 10.0 | Project source/support file |
| 482 | `ops/scripts/architecture/generated-bulk-audit.ts` | project-scripts | 603 | 22.8 | Project source/support file |
| 483 | `ops/scripts/architecture/language-runtime-audit.ts` | project-scripts | 1666 | 71.6 | Project source/support file |
| 484 | `ops/scripts/architecture/organization-audit.ts` | project-scripts | 446 | 18.9 | Project source/support file |
| 485 | `ops/scripts/architecture/phase29-audit.ts` | project-scripts | 682 | 22.8 | Project source/support file |
| 486 | `ops/scripts/architecture/runtime-js-inventory.ts` | project-scripts | 220 | 7.5 | Project source/support file |
| 487 | `ops/scripts/backend/build-package-stage.ts` | project-scripts | 142 | 3.9 | Project source/support file |
| 488 | `ops/scripts/backend/build-server-entry.ts` | project-scripts | 89 | 3.0 | Project source/support file |
| 489 | `ops/scripts/backend/schema-audit.ts` | project-scripts | 496 | 16.9 | Project source/support file |
| 490 | `ops/scripts/backend/schema-primary-key-preflight.ts` | project-scripts | 216 | 8.3 | Project source/support file |
| 491 | `ops/scripts/backend/schema-primary-key-rollback.sql` | project-scripts | 15 | 0.5 | Project source/support file |
| 492 | `ops/scripts/backend/verify-data-integrity.ts` | project-scripts | 689 | 29.0 | Project source/support file |
| 493 | `ops/scripts/frontend/build-public-runtime-scripts.ts` | project-scripts | 110 | 3.6 | Project source/support file |
| 494 | `ops/scripts/frontend/verify-i18n.ts` | project-scripts | 145 | 4.3 | Project source/support file |
| 495 | `ops/scripts/frontend/verify-performance.ts` | project-scripts | 144 | 9.6 | Project source/support file |
| 496 | `ops/scripts/frontend/verify-ui.ts` | project-scripts | 243 | 8.7 | Project source/support file |
| 497 | `ops/scripts/lib/fs-utils.ts` | project-scripts | 241 | 6.8 | Project source/support file |
| 498 | `ops/scripts/lib/report-utils.ts` | project-scripts | 70 | 2.1 | Project source/support file |
| 499 | `ops/scripts/powershell/clean-generated.ps1` | project-scripts | 265 | 7.9 | Project source/support file |
| 500 | `ops/scripts/powershell/clear-stale-node-processes.ps1` | project-scripts | 92 | 2.8 | Project source/support file |
| 501 | `ops/scripts/powershell/docker-release.ps1` | project-scripts | 1011 | 48.0 | Project source/support file |
| 502 | `ops/scripts/powershell/full-automation.ps1` | project-scripts | 214 | 8.1 | Project source/support file |
| 503 | `ops/scripts/powershell/npm-install-mode.ps1` | project-scripts | 28 | 0.8 | Project source/support file |
| 504 | `ops/scripts/powershell/runtime-bootstrap.ps1` | project-scripts | 592 | 21.6 | Project source/support file |
| 505 | `ops/scripts/powershell/start-runtime.ps1` | project-scripts | 377 | 16.3 | Project source/support file |
| 506 | `ops/scripts/powershell/tailscale-health-monitor.ps1` | project-scripts | 240 | 7.8 | Project source/support file |
| 507 | `ops/scripts/runtime/audits/action-history-undo-redo-check.ts` | project-scripts | 209 | 7.3 | Project source/support file |
| 508 | `ops/scripts/runtime/audits/audit-auth.ts` | project-scripts | 191 | 6.0 | Project source/support file |
| 509 | `ops/scripts/runtime/audits/audit-manifest.ts` | project-scripts | 302 | 8.7 | Project source/support file |
| 510 | `ops/scripts/runtime/audits/audit-report-html.ts` | project-scripts | 446 | 15.9 | Project source/support file |
| 511 | `ops/scripts/runtime/audits/deep-live-audit.ts` | project-scripts | 1463 | 55.3 | Project source/support file |
| 512 | `ops/scripts/runtime/audits/full-app-audit.ts` | project-scripts | 652 | 28.6 | Project source/support file |
| 513 | `ops/scripts/runtime/audits/package.json` | project-scripts | 5 | 0.0 | Configuration/data manifest |
| 514 | `ops/scripts/runtime/browser-action-smoke.ts` | project-scripts | 869 | 31.2 | Project source/support file |
| 515 | `ops/scripts/runtime/build-ecosystem-config.ts` | project-scripts | 86 | 2.8 | Project source/support file |
| 516 | `ops/scripts/runtime/cloudflare/rotate-cloudflare-tunnel-token.ts` | project-scripts | 244 | 10.8 | Project source/support file |
| 517 | `ops/scripts/runtime/cloudflare/update-cloudflare-tunnel-origin.ts` | project-scripts | 144 | 6.0 | Project source/support file |
| 518 | `ops/scripts/runtime/cloudflare/verify-cloudflare-automation.ts` | project-scripts | 285 | 12.0 | Project source/support file |
| 519 | `ops/scripts/runtime/cloudflare/verify-r2-object-store.ts` | project-scripts | 155 | 6.0 | Project source/support file |
| 520 | `ops/scripts/runtime/live-checks/all-pages-control-audit.ts` | project-scripts | 1161 | 43.6 | Project source/support file |
| 521 | `ops/scripts/runtime/live-checks/live-check-utils.ts` | project-scripts | 123 | 3.6 | Project source/support file |
| 522 | `ops/scripts/runtime/live-checks/package.json` | project-scripts | 5 | 0.0 | Configuration/data manifest |
| 523 | `ops/scripts/runtime/live-checks/phase84-branches-actions-live-check.ts` | project-scripts | 139 | 6.5 | Project source/support file |
| 524 | `ops/scripts/runtime/live-checks/phase84-contacts-live-check.ts` | project-scripts | 136 | 6.0 | Project source/support file |
| 525 | `ops/scripts/runtime/live-checks/phase84-files-providers-actions-live-check.ts` | project-scripts | 136 | 6.3 | Project source/support file |
| 526 | `ops/scripts/runtime/live-checks/phase84-inventory-actions-live-check.ts` | project-scripts | 165 | 8.1 | Project source/support file |
| 527 | `ops/scripts/runtime/live-checks/phase84-live-suite.ts` | project-scripts | 247 | 7.6 | Project source/support file |
| 528 | `ops/scripts/runtime/live-checks/phase84-product-brands-actions-live-check.ts` | project-scripts | 140 | 6.7 | Project source/support file |
| 529 | `ops/scripts/runtime/live-checks/phase84-product-categories-actions-live-check.ts` | project-scripts | 129 | 6.1 | Project source/support file |
| 530 | `ops/scripts/runtime/live-checks/phase84-product-page-actions-live-check.ts` | project-scripts | 144 | 6.6 | Project source/support file |
| 531 | `ops/scripts/runtime/live-checks/phase84-product-scanning-actions-live-check.ts` | project-scripts | 127 | 6.0 | Project source/support file |
| 532 | `ops/scripts/runtime/live-checks/phase84-product-stock-actions-live-check.ts` | project-scripts | 139 | 6.7 | Project source/support file |
| 533 | `ops/scripts/runtime/live-checks/phase84-product-units-actions-live-check.ts` | project-scripts | 129 | 6.0 | Project source/support file |
| 534 | `ops/scripts/runtime/live-checks/phase84-product-variant-actions-live-check.ts` | project-scripts | 139 | 6.0 | Project source/support file |
| 535 | `ops/scripts/runtime/live-checks/phase84-public-portal-cloudflare-check.ts` | project-scripts | 176 | 7.3 | Project source/support file |
| 536 | `ops/scripts/runtime/live-checks/phase84-receipt-settings-rollback-check.ts` | project-scripts | 204 | 8.2 | Project source/support file |
| 537 | `ops/scripts/runtime/live-checks/phase84-sales-actions-live-check.ts` | project-scripts | 137 | 6.1 | Project source/support file |
| 538 | `ops/scripts/runtime/live-checks/phase84-ui-live-check.ts` | project-scripts | 865 | 56.8 | Project source/support file |
| 539 | `ops/scripts/runtime/live-checks/phase84-users-actions-live-check.ts` | project-scripts | 164 | 7.9 | Project source/support file |
| 540 | `ops/scripts/runtime/smoke/check-public-url.ts` | project-scripts | 239 | 8.2 | Project source/support file |
| 541 | `ops/scripts/runtime/smoke/check-route-contract.ts` | project-scripts | 86 | 3.9 | Project source/support file |
| 542 | `ops/scripts/runtime/smoke/live-smoke.ts` | project-scripts | 318 | 13.4 | Project source/support file |
| 543 | `ops/scripts/runtime/smoke/post-start-diagnostics.ts` | project-scripts | 213 | 6.9 | Project source/support file |
| 544 | `ops/scripts/runtime/storage/cleanup-integrity-backlog.ts` | project-scripts | 230 | 9.6 | Project source/support file |
| 545 | `ops/scripts/runtime/storage/cleanup-test-data.ts` | project-scripts | 430 | 18.8 | Project source/support file |
| 546 | `ops/scripts/runtime/storage/dataset-readiness.ts` | project-scripts | 117 | 4.5 | Project source/support file |
| 547 | `ops/scripts/runtime/storage/post-live-hygiene.ts` | project-scripts | 211 | 6.7 | Project source/support file |
| 548 | `ops/scripts/runtime/storage/prune-storage.ts` | project-scripts | 464 | 15.7 | Project source/support file |
| 549 | `ops/scripts/runtime/storage/restore-candidates.ts` | project-scripts | 213 | 7.5 | Project source/support file |
| 550 | `ops/scripts/runtime/storage/restore-rehearsal.ts` | project-scripts | 219 | 7.9 | Project source/support file |
| 551 | `ops/scripts/verification/verify-backup-reliability.ts` | project-scripts | 162 | 5.7 | Project source/support file |
| 552 | `ops/scripts/verification/verify-docker-release.ts` | project-scripts | 696 | 33.5 | Project source/support file |
| 553 | `ops/scripts/verification/verify-hardening-policy.ts` | project-scripts | 165 | 6.2 | Project source/support file |
| 554 | `ops/scripts/verification/verify-runtime-deps.ts` | project-scripts | 410 | 16.6 | Project source/support file |
| 555 | `ops/scripts/verification/verify-scale-services.ts` | project-scripts | 180 | 6.7 | Project source/support file |
| 556 | `ops/scripts/verification/verify-secret-hygiene.ts` | project-scripts | 71 | 2.4 | Project source/support file |
| 557 | `package.json` | project-root | 22 | 0.6 | Configuration/data manifest |
| 558 | `README.md` | project-root | 159 | 11.6 | Project documentation entrypoint |
| 559 | `run/build-release.bat` | project-scripts | 54 | 1.7 | Final Docker release build wrapper |
| 560 | `run/clean-generated.bat` | project-scripts | 60 | 1.8 | Project source/support file |
| 561 | `run/cloudflare-origin.bat` | project-scripts | 34 | 1.1 | Project source/support file |
| 562 | `run/docker/backup.bat` | project-scripts | 15 | 0.6 | Project source/support file |
| 563 | `run/docker/doctor.bat` | project-scripts | 15 | 0.5 | Project source/support file |
| 564 | `run/docker/install.bat` | project-scripts | 15 | 0.5 | Project source/support file |
| 565 | `run/docker/README.md` | project-scripts | 44 | 3.1 | Documentation |
| 566 | `run/docker/release.bat` | project-scripts | 15 | 0.5 | Project source/support file |
| 567 | `run/docker/restore.bat` | project-scripts | 29 | 1.0 | Project source/support file |
| 568 | `run/docker/rotate-cloudflare.bat` | project-scripts | 15 | 0.5 | Project source/support file |
| 569 | `run/docker/start.bat` | project-scripts | 15 | 0.6 | Project source/support file |
| 570 | `run/docker/update.bat` | project-scripts | 15 | 0.5 | Project source/support file |
| 571 | `run/full-automation.bat` | project-scripts | 22 | 0.6 | Project source/support file |
| 572 | `run/README.md` | project-scripts | 47 | 2.9 | Documentation |
| 573 | `run/setup.bat` | project-scripts | 349 | 16.2 | Project source/support file |
| 574 | `run/sh/setup.sh` | project-scripts | 116 | 3.3 | Project source/support file |
| 575 | `run/sh/start-server.sh` | project-scripts | 147 | 5.6 | Project source/support file |
| 576 | `run/sh/stop-server.sh` | project-scripts | 62 | 1.6 | Project source/support file |
| 577 | `run/start-server.bat` | project-scripts | 570 | 29.3 | Project source/support file |
| 578 | `run/stop-server.bat` | project-scripts | 183 | 8.4 | Project source/support file |
| 579 | `run/verify-local.bat` | project-scripts | 148 | 4.9 | Project source/support file |
| 580 | `Start Business OS.bat` | project-root | 38 | 1.3 | Project source/support file |
