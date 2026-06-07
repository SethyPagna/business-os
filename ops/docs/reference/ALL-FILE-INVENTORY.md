# All File Inventory (Project First-Party Files)

Auto-generated file-level commentary for all first-party project files (frontend, backend, scripts, and root run/config files; excluding dependencies/build artifacts).

## 1. Coverage Summary

Total files documented: **715**

## 2. File Commentary Matrix

| No. | File | Category | Lines | Size (KB) | Purpose |
|---:|---|---|---:|---:|---|
| 1 | `.npmrc` | project-root | 14 | 0.4 | Project source/support file |
| 2 | `backend/.env` | backend-root | 67 | 3.0 | Project source/support file |
| 3 | `backend/.npmrc` | backend-root | 14 | 0.4 | Project source/support file |
| 4 | `backend/.pkg-stage/package.json` | backend-root | 58 | 1.2 | Configuration/data manifest |
| 5 | `backend/.pkg-stage/server.js` | backend-root | 564 | 24.1 | Backend server entrypoint |
| 6 | `backend/.pkg-stage/src/accessControl.js` | backend-root | 218 | 6.2 | Project source/support file |
| 7 | `backend/.pkg-stage/src/analytics/duckdbRuntime.js` | backend-root | 109 | 3.0 | Project source/support file |
| 8 | `backend/.pkg-stage/src/authOtpGuards.js` | backend-root | 34 | 1.2 | Project source/support file |
| 9 | `backend/.pkg-stage/src/backupSchema.js` | backend-root | 165 | 3.8 | Project source/support file |
| 10 | `backend/.pkg-stage/src/businessMetrics.js` | backend-root | 192 | 7.0 | Project source/support file |
| 11 | `backend/.pkg-stage/src/catalogTextIntegrity.js` | backend-root | 96 | 3.0 | Project source/support file |
| 12 | `backend/.pkg-stage/src/config/index.js` | backend-root | 303 | 12.3 | Project source/support file |
| 13 | `backend/.pkg-stage/src/conflictControl.js` | backend-root | 117 | 3.4 | Project source/support file |
| 14 | `backend/.pkg-stage/src/contactOptions.js` | backend-root | 211 | 6.5 | Project source/support file |
| 15 | `backend/.pkg-stage/src/database.js` | backend-root | 4 | 0.1 | Project source/support file |
| 16 | `backend/.pkg-stage/src/dataPath/index.js` | backend-root | 258 | 7.3 | Project source/support file |
| 17 | `backend/.pkg-stage/src/db/cutoverReadiness.js` | backend-root | 173 | 5.5 | Project source/support file |
| 18 | `backend/.pkg-stage/src/db/postgresQueryCompat.js` | backend-root | 240 | 6.7 | Project source/support file |
| 19 | `backend/.pkg-stage/src/db/postgresSchema.sql` | backend-root | 2148 | 54.6 | Project source/support file |
| 20 | `backend/.pkg-stage/src/fileAssets.js` | backend-root | 1261 | 43.9 | Project source/support file |
| 21 | `backend/.pkg-stage/src/helpers.js` | backend-root | 625 | 21.0 | Project source/support file |
| 22 | `backend/.pkg-stage/src/idempotency.js` | backend-root | 14 | 0.3 | Project source/support file |
| 23 | `backend/.pkg-stage/src/importCsv.js` | backend-root | 343 | 8.4 | Project source/support file |
| 24 | `backend/.pkg-stage/src/importParsing.js` | backend-root | 111 | 3.6 | Project source/support file |
| 25 | `backend/.pkg-stage/src/initials.js` | backend-root | 120 | 3.7 | Project source/support file |
| 26 | `backend/.pkg-stage/src/maintenanceLock.js` | backend-root | 131 | 3.3 | Project source/support file |
| 27 | `backend/.pkg-stage/src/middleware.js` | backend-root | 336 | 10.3 | Project source/support file |
| 28 | `backend/.pkg-stage/src/money.js` | backend-root | 29 | 0.8 | Project source/support file |
| 29 | `backend/.pkg-stage/src/netSecurity.js` | backend-root | 148 | 3.6 | Project source/support file |
| 30 | `backend/.pkg-stage/src/objectStore.js` | backend-root | 468 | 15.1 | Project source/support file |
| 31 | `backend/.pkg-stage/src/optionalSharp.js` | backend-root | 32 | 0.7 | Project source/support file |
| 32 | `backend/.pkg-stage/src/organizationContext/index.js` | backend-root | 264 | 8.2 | Project source/support file |
| 33 | `backend/.pkg-stage/src/permissions.js` | backend-root | 227 | 7.0 | Project source/support file |
| 34 | `backend/.pkg-stage/src/portalUtils.js` | backend-root | 122 | 3.1 | Project source/support file |
| 35 | `backend/.pkg-stage/src/postgresDatabase.js` | backend-root | 596 | 25.4 | Project source/support file |
| 36 | `backend/.pkg-stage/src/productBatches.js` | backend-root | 646 | 21.5 | Project source/support file |
| 37 | `backend/.pkg-stage/src/productDiscounts.js` | backend-root | 200 | 6.8 | Project source/support file |
| 38 | `backend/.pkg-stage/src/productImportPolicies.js` | backend-root | 174 | 5.4 | Project source/support file |
| 39 | `backend/.pkg-stage/src/README.md` | backend-root | 12 | 0.7 | Documentation |
| 40 | `backend/.pkg-stage/src/requestContext.js` | backend-root | 65 | 1.7 | Project source/support file |
| 41 | `backend/.pkg-stage/src/routes/actionHistory.js` | backend-root | 256 | 9.0 | API route handler |
| 42 | `backend/.pkg-stage/src/routes/ai.js` | backend-root | 270 | 9.2 | API route handler |
| 43 | `backend/.pkg-stage/src/routes/auth.js` | backend-root | 1156 | 40.9 | API route handler |
| 44 | `backend/.pkg-stage/src/routes/branches.js` | backend-root | 452 | 19.7 | API route handler |
| 45 | `backend/.pkg-stage/src/routes/catalog.js` | backend-root | 110 | 3.0 | API route handler |
| 46 | `backend/.pkg-stage/src/routes/categories.js` | backend-root | 147 | 5.8 | API route handler |
| 47 | `backend/.pkg-stage/src/routes/contacts.js` | backend-root | 1053 | 41.9 | API route handler |
| 48 | `backend/.pkg-stage/src/routes/customTables.js` | backend-root | 259 | 9.5 | API route handler |
| 49 | `backend/.pkg-stage/src/routes/files.js` | backend-root | 133 | 5.2 | API route handler |
| 50 | `backend/.pkg-stage/src/routes/importJobs.js` | backend-root | 501 | 17.3 | API route handler |
| 51 | `backend/.pkg-stage/src/routes/inventory.js` | backend-root | 1881 | 83.8 | API route handler |
| 52 | `backend/.pkg-stage/src/routes/notifications.js` | backend-root | 581 | 19.6 | API route handler |
| 53 | `backend/.pkg-stage/src/routes/organizations.js` | backend-root | 68 | 2.0 | API route handler |
| 54 | `backend/.pkg-stage/src/routes/portal.js` | backend-root | 1407 | 51.5 | API route handler |
| 55 | `backend/.pkg-stage/src/routes/products.js` | backend-root | 2218 | 99.1 | API route handler |
| 56 | `backend/.pkg-stage/src/routes/README.md` | backend-root | 37 | 1.5 | API route handler |
| 57 | `backend/.pkg-stage/src/routes/returns.js` | backend-root | 1050 | 41.4 | API route handler |
| 58 | `backend/.pkg-stage/src/routes/runtime.js` | backend-root | 157 | 4.7 | API route handler |
| 59 | `backend/.pkg-stage/src/routes/sales.js` | backend-root | 1591 | 65.2 | API route handler |
| 60 | `backend/.pkg-stage/src/routes/settings.js` | backend-root | 249 | 8.9 | API route handler |
| 61 | `backend/.pkg-stage/src/routes/sync.js` | backend-root | 301 | 13.3 | API route handler |
| 62 | `backend/.pkg-stage/src/routes/system/index.js` | backend-root | 1659 | 65.3 | API route handler |
| 63 | `backend/.pkg-stage/src/routes/units.js` | backend-root | 151 | 5.9 | API route handler |
| 64 | `backend/.pkg-stage/src/routes/users.js` | backend-root | 1086 | 44.5 | API route handler |
| 65 | `backend/.pkg-stage/src/runtimeCache.js` | backend-root | 248 | 6.2 | Project source/support file |
| 66 | `backend/.pkg-stage/src/runtimeState/index.js` | backend-root | 97 | 2.7 | Project source/support file |
| 67 | `backend/.pkg-stage/src/runtimeVersion.js` | backend-root | 176 | 4.4 | Project source/support file |
| 68 | `backend/.pkg-stage/src/schemaMetadata.js` | backend-root | 155 | 3.7 | Project source/support file |
| 69 | `backend/.pkg-stage/src/security.js` | backend-root | 253 | 7.1 | Project source/support file |
| 70 | `backend/.pkg-stage/src/serverUtils.js` | backend-root | 431 | 15.5 | Project source/support file |
| 71 | `backend/.pkg-stage/src/services/aiGateway.js` | backend-root | 364 | 13.6 | Integration/service layer |
| 72 | `backend/.pkg-stage/src/services/backupPackages.js` | backend-root | 1060 | 36.3 | Integration/service layer |
| 73 | `backend/.pkg-stage/src/services/firebaseAuth.js` | backend-root | 384 | 14.3 | Integration/service layer |
| 74 | `backend/.pkg-stage/src/services/googleDriveSync/index.js` | backend-root | 1564 | 57.8 | Integration/service layer |
| 75 | `backend/.pkg-stage/src/services/googleDriveSync/versioning.js` | backend-root | 135 | 4.0 | Integration/service layer |
| 76 | `backend/.pkg-stage/src/services/googleOauth.js` | backend-root | 252 | 8.8 | Integration/service layer |
| 77 | `backend/.pkg-stage/src/services/importJobs.js` | backend-root | 3880 | 157.1 | Integration/service layer |
| 78 | `backend/.pkg-stage/src/services/integrationDoctor.js` | backend-root | 353 | 11.8 | Integration/service layer |
| 79 | `backend/.pkg-stage/src/services/mediaQueue.js` | backend-root | 200 | 7.2 | Integration/service layer |
| 80 | `backend/.pkg-stage/src/services/portalAi.js` | backend-root | 621 | 21.8 | Integration/service layer |
| 81 | `backend/.pkg-stage/src/services/README.md` | backend-root | 29 | 1.0 | Integration/service layer |
| 82 | `backend/.pkg-stage/src/services/verification.js` | backend-root | 272 | 8.4 | Integration/service layer |
| 83 | `backend/.pkg-stage/src/sessionAuth.js` | backend-root | 215 | 6.8 | Project source/support file |
| 84 | `backend/.pkg-stage/src/settingsSnapshot.js` | backend-root | 181 | 5.0 | Project source/support file |
| 85 | `backend/.pkg-stage/src/storage/organizationFolders.js` | backend-root | 59 | 2.0 | Project source/support file |
| 86 | `backend/.pkg-stage/src/systemFsWorker.js` | backend-root | 122 | 3.6 | Project source/support file |
| 87 | `backend/.pkg-stage/src/systemJobs.js` | backend-root | 467 | 14.5 | Project source/support file |
| 88 | `backend/.pkg-stage/src/uploadReferenceCleanup.js` | backend-root | 245 | 8.2 | Project source/support file |
| 89 | `backend/.pkg-stage/src/uploadSecurity.js` | backend-root | 119 | 4.1 | Project source/support file |
| 90 | `backend/.pkg-stage/src/websocket.js` | backend-root | 94 | 3.6 | Project source/support file |
| 91 | `backend/.pkg-stage/src/workers/importWorker.js` | backend-root | 42 | 1.1 | Project source/support file |
| 92 | `backend/.pkg-stage/src/workers/mediaWorker.js` | backend-root | 41 | 1.0 | Project source/support file |
| 93 | `backend/package-lock.json` | backend-root | 6225 | 224.7 | Configuration/data manifest |
| 94 | `backend/package.json` | backend-root | 69 | 4.0 | Configuration/data manifest |
| 95 | `backend/README.md` | backend-root | 14 | 0.7 | Documentation |
| 96 | `backend/server.js` | backend-root | 639 | 28.4 | Backend server entrypoint |
| 97 | `backend/server.ts` | backend-root | 656 | 23.8 | Project source/support file |
| 98 | `backend/src/accessControl.ts` | backend-core | 218 | 6.2 | Project source/support file |
| 99 | `backend/src/analytics/duckdbRuntime.ts` | backend-core | 109 | 3.0 | Project source/support file |
| 100 | `backend/src/authOtpGuards.ts` | backend-core | 34 | 1.2 | Project source/support file |
| 101 | `backend/src/backupSchema.ts` | backend-core | 165 | 3.8 | Project source/support file |
| 102 | `backend/src/businessMetrics.ts` | backend-core | 192 | 7.0 | Project source/support file |
| 103 | `backend/src/catalogTextIntegrity.ts` | backend-core | 96 | 3.0 | Project source/support file |
| 104 | `backend/src/config/index.ts` | backend-core | 303 | 12.3 | Project source/support file |
| 105 | `backend/src/conflictControl.ts` | backend-core | 117 | 3.4 | Project source/support file |
| 106 | `backend/src/contactOptions.ts` | backend-core | 211 | 6.5 | Project source/support file |
| 107 | `backend/src/database.ts` | backend-core | 4 | 0.1 | Schema/migrations and DB bootstrap |
| 108 | `backend/src/dataPath/index.ts` | backend-core | 258 | 7.3 | Project source/support file |
| 109 | `backend/src/db/cutoverReadiness.ts` | backend-core | 173 | 5.5 | Project source/support file |
| 110 | `backend/src/db/postgresQueryCompat.ts` | backend-core | 240 | 6.7 | Project source/support file |
| 111 | `backend/src/db/postgresSchema.sql` | backend-core | 2148 | 54.6 | Project source/support file |
| 112 | `backend/src/fileAssets.ts` | backend-core | 1261 | 43.9 | Project source/support file |
| 113 | `backend/src/helpers.ts` | backend-core | 625 | 21.0 | Project source/support file |
| 114 | `backend/src/idempotency.ts` | backend-core | 14 | 0.3 | Project source/support file |
| 115 | `backend/src/importCsv.ts` | backend-core | 343 | 8.4 | Project source/support file |
| 116 | `backend/src/importParsing.ts` | backend-core | 111 | 3.6 | Project source/support file |
| 117 | `backend/src/initials.ts` | backend-core | 120 | 3.7 | Project source/support file |
| 118 | `backend/src/maintenanceLock.ts` | backend-core | 131 | 3.3 | Project source/support file |
| 119 | `backend/src/middleware.ts` | backend-core | 336 | 10.3 | Project source/support file |
| 120 | `backend/src/money.ts` | backend-core | 29 | 0.8 | Project source/support file |
| 121 | `backend/src/netSecurity.ts` | backend-core | 148 | 3.6 | Project source/support file |
| 122 | `backend/src/objectStore.ts` | backend-core | 468 | 15.1 | Project source/support file |
| 123 | `backend/src/optionalSharp.ts` | backend-core | 32 | 0.7 | Project source/support file |
| 124 | `backend/src/organizationContext/index.ts` | backend-core | 264 | 8.2 | Project source/support file |
| 125 | `backend/src/permissions.ts` | backend-core | 227 | 7.0 | Project source/support file |
| 126 | `backend/src/portalUtils.ts` | backend-core | 122 | 3.1 | Project source/support file |
| 127 | `backend/src/postgresDatabase.ts` | backend-core | 596 | 25.4 | Project source/support file |
| 128 | `backend/src/productBatches.ts` | backend-core | 646 | 21.5 | Project source/support file |
| 129 | `backend/src/productDiscounts.ts` | backend-core | 200 | 6.8 | Project source/support file |
| 130 | `backend/src/productImportPolicies.ts` | backend-core | 174 | 5.4 | Project source/support file |
| 131 | `backend/src/README.md` | backend-core | 12 | 0.7 | Documentation |
| 132 | `backend/src/requestContext.ts` | backend-core | 65 | 1.7 | Project source/support file |
| 133 | `backend/src/routes/actionHistory.ts` | backend-routes | 256 | 9.0 | API route handler |
| 134 | `backend/src/routes/ai.ts` | backend-routes | 270 | 9.2 | API route handler |
| 135 | `backend/src/routes/auth.ts` | backend-routes | 1156 | 40.9 | API route handler |
| 136 | `backend/src/routes/branches.ts` | backend-routes | 452 | 19.7 | API route handler |
| 137 | `backend/src/routes/catalog.ts` | backend-routes | 110 | 3.0 | API route handler |
| 138 | `backend/src/routes/categories.ts` | backend-routes | 147 | 5.8 | API route handler |
| 139 | `backend/src/routes/contacts.ts` | backend-routes | 1053 | 41.9 | API route handler |
| 140 | `backend/src/routes/customTables.ts` | backend-routes | 259 | 9.5 | API route handler |
| 141 | `backend/src/routes/files.ts` | backend-routes | 133 | 5.2 | API route handler |
| 142 | `backend/src/routes/importJobs.ts` | backend-routes | 501 | 17.3 | API route handler |
| 143 | `backend/src/routes/inventory.ts` | backend-routes | 1902 | 84.2 | API route handler |
| 144 | `backend/src/routes/notifications.ts` | backend-routes | 581 | 19.6 | API route handler |
| 145 | `backend/src/routes/organizations.ts` | backend-routes | 68 | 2.0 | API route handler |
| 146 | `backend/src/routes/portal.ts` | backend-routes | 1407 | 51.5 | API route handler |
| 147 | `backend/src/routes/products.ts` | backend-routes | 2277 | 101.0 | API route handler |
| 148 | `backend/src/routes/README.md` | backend-routes | 37 | 1.5 | API route handler |
| 149 | `backend/src/routes/returns.ts` | backend-routes | 1050 | 41.4 | API route handler |
| 150 | `backend/src/routes/runtime.ts` | backend-routes | 157 | 4.7 | API route handler |
| 151 | `backend/src/routes/sales.ts` | backend-routes | 1591 | 65.2 | API route handler |
| 152 | `backend/src/routes/settings.ts` | backend-routes | 249 | 8.9 | API route handler |
| 153 | `backend/src/routes/sync.ts` | backend-routes | 301 | 13.3 | API route handler |
| 154 | `backend/src/routes/system/index.ts` | backend-routes | 1674 | 65.6 | API route handler |
| 155 | `backend/src/routes/units.ts` | backend-routes | 151 | 5.9 | API route handler |
| 156 | `backend/src/routes/users.ts` | backend-routes | 1086 | 44.5 | API route handler |
| 157 | `backend/src/runtimeCache.ts` | backend-core | 248 | 6.2 | Project source/support file |
| 158 | `backend/src/runtimeState/index.ts` | backend-core | 97 | 2.7 | Project source/support file |
| 159 | `backend/src/runtimeVersion.ts` | backend-core | 176 | 4.4 | Project source/support file |
| 160 | `backend/src/schemaMetadata.ts` | backend-core | 155 | 3.7 | Project source/support file |
| 161 | `backend/src/security.ts` | backend-core | 253 | 7.1 | Project source/support file |
| 162 | `backend/src/serverUtils.ts` | backend-core | 451 | 16.3 | Project source/support file |
| 163 | `backend/src/services/aiGateway.ts` | backend-services | 364 | 13.6 | Integration/service layer |
| 164 | `backend/src/services/backupPackages.ts` | backend-services | 1060 | 36.3 | Integration/service layer |
| 165 | `backend/src/services/firebaseAuth.ts` | backend-services | 384 | 14.3 | Integration/service layer |
| 166 | `backend/src/services/googleDriveSync/index.ts` | backend-services | 1564 | 57.8 | Integration/service layer |
| 167 | `backend/src/services/googleDriveSync/versioning.ts` | backend-services | 135 | 4.0 | Integration/service layer |
| 168 | `backend/src/services/googleOauth.ts` | backend-services | 252 | 8.8 | Integration/service layer |
| 169 | `backend/src/services/importJobs.ts` | backend-services | 3880 | 157.1 | Integration/service layer |
| 170 | `backend/src/services/integrationDoctor.ts` | backend-services | 353 | 11.8 | Integration/service layer |
| 171 | `backend/src/services/mediaQueue.ts` | backend-services | 200 | 7.2 | Integration/service layer |
| 172 | `backend/src/services/portalAi.ts` | backend-services | 621 | 21.8 | Integration/service layer |
| 173 | `backend/src/services/README.md` | backend-services | 29 | 1.0 | Integration/service layer |
| 174 | `backend/src/services/verification.ts` | backend-services | 272 | 8.4 | Integration/service layer |
| 175 | `backend/src/sessionAuth.ts` | backend-core | 215 | 6.8 | Project source/support file |
| 176 | `backend/src/settingsSnapshot.ts` | backend-core | 181 | 5.0 | Project source/support file |
| 177 | `backend/src/storage/organizationFolders.ts` | backend-core | 59 | 2.0 | Project source/support file |
| 178 | `backend/src/systemFsWorker.ts` | backend-core | 122 | 3.6 | Project source/support file |
| 179 | `backend/src/systemJobs.ts` | backend-core | 467 | 14.5 | Project source/support file |
| 180 | `backend/src/uploadReferenceCleanup.ts` | backend-core | 245 | 8.2 | Project source/support file |
| 181 | `backend/src/uploadSecurity.ts` | backend-core | 119 | 4.1 | Project source/support file |
| 182 | `backend/src/websocket.ts` | backend-core | 94 | 3.6 | Project source/support file |
| 183 | `backend/src/workers/importWorker.ts` | backend-core | 42 | 1.1 | Project source/support file |
| 184 | `backend/src/workers/mediaWorker.ts` | backend-core | 41 | 1.0 | Project source/support file |
| 185 | `backend/test/accessControl.test.ts` | backend-root | 127 | 4.0 | Project source/support file |
| 186 | `backend/test/analyticsRuntime.test.ts` | backend-root | 49 | 1.2 | Project source/support file |
| 187 | `backend/test/authOtpGuards.test.ts` | backend-root | 71 | 1.7 | Project source/support file |
| 188 | `backend/test/authSecurityFlow.test.ts` | backend-root | 283 | 9.0 | Project source/support file |
| 189 | `backend/test/backupDefaultDestination.test.ts` | backend-root | 15 | 0.6 | Project source/support file |
| 190 | `backend/test/backupPerformanceHardening.test.ts` | backend-root | 177 | 9.9 | Project source/support file |
| 191 | `backend/test/backupRetention.test.ts` | backend-root | 91 | 3.8 | Project source/support file |
| 192 | `backend/test/backupSchema.test.ts` | backend-root | 111 | 4.4 | Project source/support file |
| 193 | `backend/test/branchStockSearch.test.ts` | backend-root | 271 | 9.8 | Project source/support file |
| 194 | `backend/test/contactOptions.test.ts` | backend-root | 82 | 2.3 | Project source/support file |
| 195 | `backend/test/dataPath.test.ts` | backend-root | 87 | 3.1 | Project source/support file |
| 196 | `backend/test/defaultRoles.test.ts` | backend-root | 145 | 4.9 | Project source/support file |
| 197 | `backend/test/fileAssetStorageReconcile.test.ts` | backend-root | 57 | 1.4 | Project source/support file |
| 198 | `backend/test/fileAssetUsageCache.test.ts` | backend-root | 120 | 3.6 | Project source/support file |
| 199 | `backend/test/fileRouteSecurityFlow.test.ts` | backend-root | 217 | 7.2 | Project source/support file |
| 200 | `backend/test/fullAutomation.test.ts` | backend-root | 989 | 38.7 | Project source/support file |
| 201 | `backend/test/googleDriveSyncVersioning.test.ts` | backend-root | 121 | 5.1 | Project source/support file |
| 202 | `backend/test/idempotency.test.ts` | backend-root | 32 | 0.7 | Project source/support file |
| 203 | `backend/test/importCsv.test.ts` | backend-root | 83 | 3.0 | Project source/support file |
| 204 | `backend/test/importDecisionIntegrity.test.ts` | backend-root | 167 | 5.6 | Project source/support file |
| 205 | `backend/test/importJobPerformanceHardening.test.ts` | backend-root | 39 | 1.5 | Project source/support file |
| 206 | `backend/test/importJobStateMachine.test.ts` | backend-root | 420 | 21.0 | Project source/support file |
| 207 | `backend/test/importScaleSmoke.test.ts` | backend-root | 79 | 2.7 | Project source/support file |
| 208 | `backend/test/initials.test.ts` | backend-root | 24 | 0.8 | Project source/support file |
| 209 | `backend/test/integrationDoctor.test.ts` | backend-root | 50 | 1.6 | Project source/support file |
| 210 | `backend/test/inventorySettingsMediaContracts.test.ts` | backend-root | 62 | 3.0 | Project source/support file |
| 211 | `backend/test/mediaOptimization.test.ts` | backend-root | 118 | 3.9 | Project source/support file |
| 212 | `backend/test/netSecurity.test.ts` | backend-root | 45 | 1.5 | Project source/support file |
| 213 | `backend/test/notificationSummaryCache.test.ts` | backend-root | 95 | 2.8 | Project source/support file |
| 214 | `backend/test/offlineSecurity.test.ts` | backend-root | 87 | 3.7 | Project source/support file |
| 215 | `backend/test/ownedGoogleAuth.test.ts` | backend-root | 98 | 4.0 | Project source/support file |
| 216 | `backend/test/permissionPolicy.test.ts` | backend-root | 34 | 1.7 | Project source/support file |
| 217 | `backend/test/portalInventoryRegression.test.ts` | backend-root | 103 | 8.8 | Project source/support file |
| 218 | `backend/test/portalUtils.test.ts` | backend-root | 40 | 1.2 | Project source/support file |
| 219 | `backend/test/postgresCutoverReadiness.test.ts` | backend-root | 56 | 1.6 | Project source/support file |
| 220 | `backend/test/postgresDatabase.test.ts` | backend-root | 123 | 4.1 | Project source/support file |
| 221 | `backend/test/postgresQueryCompat.test.ts` | backend-root | 98 | 3.5 | Project source/support file |
| 222 | `backend/test/productBatchHierarchy.test.ts` | backend-root | 104 | 4.8 | Project source/support file |
| 223 | `backend/test/productExpiry.test.ts` | backend-root | 68 | 2.8 | Project source/support file |
| 224 | `backend/test/productImportPolicies.test.ts` | backend-root | 72 | 3.0 | Project source/support file |
| 225 | `backend/test/productSearchPagination.test.ts` | backend-root | 22 | 2.1 | Project source/support file |
| 226 | `backend/test/rfidRoutes.test.ts` | backend-root | 59 | 3.0 | Project source/support file |
| 227 | `backend/test/routeContracts.test.ts` | backend-root | 342 | 19.0 | Project source/support file |
| 228 | `backend/test/runtimeCache.test.ts` | backend-root | 65 | 2.0 | Project source/support file |
| 229 | `backend/test/runtimeVersion.test.ts` | backend-root | 51 | 1.4 | Project source/support file |
| 230 | `backend/test/schemaMetadata.test.ts` | backend-root | 117 | 3.9 | Project source/support file |
| 231 | `backend/test/security.test.ts` | backend-root | 84 | 2.6 | Project source/support file |
| 232 | `backend/test/serverUtils.test.ts` | backend-root | 325 | 12.1 | Project source/support file |
| 233 | `backend/test/settingsSnapshotObjectStorage.test.ts` | backend-root | 173 | 5.7 | Project source/support file |
| 234 | `backend/test/systemJobs.test.ts` | backend-root | 97 | 3.5 | Project source/support file |
| 235 | `backend/test/uploadSecurity.test.ts` | backend-root | 59 | 2.0 | Project source/support file |
| 236 | `backend/test/websocket.test.ts` | backend-root | 9 | 0.3 | Project source/support file |
| 237 | `frontend/.npmrc` | frontend-root | 14 | 0.4 | Project source/support file |
| 238 | `frontend/index.html` | frontend-root | 24 | 1.0 | Project source/support file |
| 239 | `frontend/package-lock.json` | frontend-root | 3833 | 131.7 | Configuration/data manifest |
| 240 | `frontend/package.json` | frontend-root | 47 | 4.4 | Configuration/data manifest |
| 241 | `frontend/public/favicon.ico` | frontend-root | 0 | 11.4 | Project source/support file |
| 242 | `frontend/public/icon.png` | frontend-root | 0 | 11.4 | Project source/support file |
| 243 | `frontend/public/manifest.json` | frontend-root | 17 | 0.3 | Configuration/data manifest |
| 244 | `frontend/public/runtime-noise-guard.js` | frontend-root | 119 | 4.9 | Project source/support file |
| 245 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.js` | frontend-root | 1 | 94.8 | Project source/support file |
| 246 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.wasm` | frontend-root | 0 | 8726.7 | Project source/support file |
| 247 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.worker.js` | frontend-root | 1 | 1.9 | Project source/support file |
| 248 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd.wasm` | frontend-root | 0 | 8782.2 | Project source/support file |
| 249 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm.wasm` | frontend-root | 0 | 8192.9 | Project source/support file |
| 250 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd-threads.js` | frontend-root | 1 | 146.4 | Project source/support file |
| 251 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd.js` | frontend-root | 1 | 135.5 | Project source/support file |
| 252 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core.js` | frontend-root | 1 | 135.5 | Project source/support file |
| 253 | `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js` | frontend-root | 187 | 1007.0 | Project source/support file |
| 254 | `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js.LICENSE.txt` | frontend-root | 24 | 0.5 | Project source/support file |
| 255 | `frontend/public/sw.js` | frontend-root | 416 | 16.4 | Project source/support file |
| 256 | `frontend/public/theme-bootstrap.js` | frontend-root | 218 | 9.2 | Project source/support file |
| 257 | `frontend/README.md` | frontend-root | 13 | 0.5 | Documentation |
| 258 | `frontend/src/AdminRoot.tsx` | frontend-core | 13 | 0.3 | Project source/support file |
| 259 | `frontend/src/api/actionHistoryTransport.ts` | frontend-api | 67 | 1.8 | Frontend API/sync helper |
| 260 | `frontend/src/api/actorQuery.ts` | frontend-api | 39 | 1.3 | Frontend API/sync helper |
| 261 | `frontend/src/api/aiTransport.ts` | frontend-api | 37 | 1.4 | Frontend API/sync helper |
| 262 | `frontend/src/api/appBootstrapTransport.ts` | frontend-api | 111 | 2.9 | Frontend API/sync helper |
| 263 | `frontend/src/api/auditLogTransport.ts` | frontend-api | 79 | 2.6 | Frontend API/sync helper |
| 264 | `frontend/src/api/authTransport.ts` | frontend-api | 105 | 3.3 | Frontend API/sync helper |
| 265 | `frontend/src/api/branchTransport.ts` | frontend-api | 123 | 3.4 | Frontend API/sync helper |
| 266 | `frontend/src/api/browserDialogs.ts` | frontend-api | 35 | 0.9 | Frontend API/sync helper |
| 267 | `frontend/src/api/conflicts.ts` | frontend-api | 43 | 1.2 | Frontend API/sync helper |
| 268 | `frontend/src/api/contactReadTransport.ts` | frontend-api | 136 | 4.0 | Frontend API/sync helper |
| 269 | `frontend/src/api/contactsTransport.ts` | frontend-api | 228 | 8.0 | Frontend API/sync helper |
| 270 | `frontend/src/api/contactWriteTransport.ts` | frontend-api | 119 | 3.9 | Frontend API/sync helper |
| 271 | `frontend/src/api/cooldownFallbacks.ts` | frontend-api | 106 | 3.1 | Frontend API/sync helper |
| 272 | `frontend/src/api/customTablesTransport.ts` | frontend-api | 90 | 2.3 | Frontend API/sync helper |
| 273 | `frontend/src/api/dashboardTransport.ts` | frontend-api | 26 | 0.8 | Frontend API/sync helper |
| 274 | `frontend/src/api/driveSync.ts` | frontend-api | 97 | 3.1 | Frontend API/sync helper |
| 275 | `frontend/src/api/expectedUpdatedAt.ts` | frontend-api | 54 | 1.7 | Frontend API/sync helper |
| 276 | `frontend/src/api/fileTransport.ts` | frontend-api | 216 | 6.8 | Frontend API/sync helper |
| 277 | `frontend/src/api/http.ts` | frontend-api | 1146 | 42.4 | Frontend API/sync helper |
| 278 | `frontend/src/api/httpState.ts` | frontend-api | 19 | 0.4 | Frontend API/sync helper |
| 279 | `frontend/src/api/importJobsTransport.ts` | frontend-api | 257 | 8.9 | Frontend API/sync helper |
| 280 | `frontend/src/api/importTransport.ts` | frontend-api | 37 | 1.3 | Frontend API/sync helper |
| 281 | `frontend/src/api/inventoryTransport.ts` | frontend-api | 95 | 2.9 | Frontend API/sync helper |
| 282 | `frontend/src/api/inventoryWriteTransport.ts` | frontend-api | 50 | 1.3 | Frontend API/sync helper |
| 283 | `frontend/src/api/lazyLocalDb.ts` | frontend-api | 14 | 0.4 | Frontend API/sync helper |
| 284 | `frontend/src/api/localDb.ts` | frontend-api | 282 | 10.8 | Frontend API/sync helper |
| 285 | `frontend/src/api/localMirrors.ts` | frontend-api | 83 | 2.9 | Frontend API/sync helper |
| 286 | `frontend/src/api/lookupTransport.ts` | frontend-api | 104 | 2.9 | Frontend API/sync helper |
| 287 | `frontend/src/api/methods.ts` | frontend-api | 1200 | 48.9 | Frontend API/sync helper |
| 288 | `frontend/src/api/multipartHeaders.ts` | frontend-api | 19 | 0.5 | Frontend API/sync helper |
| 289 | `frontend/src/api/notificationSummary.ts` | frontend-api | 61 | 2.0 | Frontend API/sync helper |
| 290 | `frontend/src/api/offlineSnapshotTransport.ts` | frontend-api | 137 | 5.1 | Frontend API/sync helper |
| 291 | `frontend/src/api/pendingSyncTransport.ts` | frontend-api | 70 | 2.2 | Frontend API/sync helper |
| 292 | `frontend/src/api/portalHttp.ts` | frontend-api | 29 | 0.8 | Frontend API/sync helper |
| 293 | `frontend/src/api/portalTransport.ts` | frontend-api | 121 | 4.1 | Frontend API/sync helper |
| 294 | `frontend/src/api/productImageUploadTransport.ts` | frontend-api | 61 | 2.0 | Frontend API/sync helper |
| 295 | `frontend/src/api/productReadTransport.ts` | frontend-api | 99 | 3.1 | Frontend API/sync helper |
| 296 | `frontend/src/api/productWriteTransport.ts` | frontend-api | 87 | 2.6 | Frontend API/sync helper |
| 297 | `frontend/src/api/query.ts` | frontend-api | 54 | 1.5 | Frontend API/sync helper |
| 298 | `frontend/src/api/queryCache.ts` | frontend-api | 63 | 2.0 | Frontend API/sync helper |
| 299 | `frontend/src/api/README.md` | frontend-api | 184 | 9.5 | Frontend API/sync helper |
| 300 | `frontend/src/api/requestIds.ts` | frontend-api | 19 | 0.7 | Frontend API/sync helper |
| 301 | `frontend/src/api/returnsTransport.ts` | frontend-api | 122 | 3.9 | Frontend API/sync helper |
| 302 | `frontend/src/api/rfidTransport.ts` | frontend-api | 82 | 2.4 | Frontend API/sync helper |
| 303 | `frontend/src/api/salesTransport.ts` | frontend-api | 143 | 4.3 | Frontend API/sync helper |
| 304 | `frontend/src/api/saleWriteTransport.ts` | frontend-api | 313 | 11.2 | Frontend API/sync helper |
| 305 | `frontend/src/api/settingsTransport.ts` | frontend-api | 118 | 4.7 | Frontend API/sync helper |
| 306 | `frontend/src/api/syncPreview.ts` | frontend-api | 55 | 1.5 | Frontend API/sync helper |
| 307 | `frontend/src/api/syncRuntime.ts` | frontend-api | 53 | 1.8 | Frontend API/sync helper |
| 308 | `frontend/src/api/systemJobs.ts` | frontend-api | 106 | 3.2 | Frontend API/sync helper |
| 309 | `frontend/src/api/systemRuntime.ts` | frontend-api | 134 | 4.5 | Frontend API/sync helper |
| 310 | `frontend/src/api/userAdminTransport.ts` | frontend-api | 128 | 3.5 | Frontend API/sync helper |
| 311 | `frontend/src/api/userReadTransport.ts` | frontend-api | 15 | 0.4 | Frontend API/sync helper |
| 312 | `frontend/src/api/websocket.ts` | frontend-api | 247 | 8.1 | Frontend API/sync helper |
| 313 | `frontend/src/App.tsx` | frontend-core | 1905 | 71.7 | Main app shell and page mounting |
| 314 | `frontend/src/app/appShellUtils.ts` | frontend-core | 77 | 2.4 | Project source/support file |
| 315 | `frontend/src/app/pathRouting.ts` | frontend-core | 93 | 2.9 | Project source/support file |
| 316 | `frontend/src/app/publicErrorRecovery.ts` | frontend-core | 35 | 1.3 | Project source/support file |
| 317 | `frontend/src/AppContext.tsx` | frontend-core | 1978 | 78.4 | Global app state/context provider |
| 318 | `frontend/src/components/auth/Login.tsx` | frontend-ui | 1254 | 54.5 | UI component/page |
| 319 | `frontend/src/components/branches/Branches.tsx` | frontend-ui | 1133 | 51.7 | UI component/page |
| 320 | `frontend/src/components/branches/BranchForm.tsx` | frontend-ui | 202 | 6.4 | UI component/page |
| 321 | `frontend/src/components/branches/TransferModal.tsx` | frontend-ui | 436 | 16.5 | UI component/page |
| 322 | `frontend/src/components/catalog/catalogAssetUrls.ts` | frontend-ui | 78 | 3.0 | UI component/page |
| 323 | `frontend/src/components/catalog/CatalogEditorSurface.tsx` | frontend-ui | 1543 | 104.6 | UI component/page |
| 324 | `frontend/src/components/catalog/CatalogImageField.tsx` | frontend-ui | 116 | 4.7 | UI component/page |
| 325 | `frontend/src/components/catalog/catalogImages.tsx` | frontend-ui | 122 | 3.1 | UI component/page |
| 326 | `frontend/src/components/catalog/CatalogPage.tsx` | frontend-ui | 3623 | 158.0 | UI component/page |
| 327 | `frontend/src/components/catalog/CatalogPageContext.tsx` | frontend-ui | 25 | 0.6 | UI component/page |
| 328 | `frontend/src/components/catalog/catalogPagination.tsx` | frontend-ui | 139 | 6.1 | UI component/page |
| 329 | `frontend/src/components/catalog/CatalogPreviewSurface.tsx` | frontend-ui | 450 | 20.9 | UI component/page |
| 330 | `frontend/src/components/catalog/CatalogProductsSection.tsx` | frontend-ui | 626 | 30.8 | UI component/page |
| 331 | `frontend/src/components/catalog/CatalogSecondaryTabs.tsx` | frontend-ui | 1116 | 59.2 | UI component/page |
| 332 | `frontend/src/components/catalog/catalogUi.tsx` | frontend-ui | 82 | 3.0 | UI component/page |
| 333 | `frontend/src/components/catalog/portalCatalogDisplay.ts` | frontend-ui | 183 | 6.2 | UI component/page |
| 334 | `frontend/src/components/catalog/portalContentI18n.ts` | frontend-ui | 788 | 49.4 | UI component/page |
| 335 | `frontend/src/components/catalog/portalEditorUtils.ts` | frontend-ui | 189 | 5.8 | UI component/page |
| 336 | `frontend/src/components/catalog/portalLanguageOptions.ts` | frontend-ui | 43 | 2.5 | UI component/page |
| 337 | `frontend/src/components/catalog/portalLanguagePacks.ts` | frontend-ui | 1349 | 62.5 | UI component/page |
| 338 | `frontend/src/components/catalog/portalTranslateController.ts` | frontend-ui | 322 | 11.5 | UI component/page |
| 339 | `frontend/src/components/catalog/portalTranslationData.ts` | frontend-ui | 26 | 0.7 | UI component/page |
| 340 | `frontend/src/components/contacts/ContactImportModal.tsx` | frontend-ui | 429 | 16.2 | UI component/page |
| 341 | `frontend/src/components/contacts/contactImportWorker.ts` | frontend-ui | 39 | 1.0 | UI component/page |
| 342 | `frontend/src/components/contacts/contactOptionUtils.ts` | frontend-ui | 131 | 4.9 | UI component/page |
| 343 | `frontend/src/components/contacts/Contacts.tsx` | frontend-ui | 448 | 17.8 | UI component/page |
| 344 | `frontend/src/components/contacts/CustomerFormModal.tsx` | frontend-ui | 248 | 11.2 | UI component/page |
| 345 | `frontend/src/components/contacts/customerMembershipNumber.ts` | frontend-ui | 11 | 0.4 | UI component/page |
| 346 | `frontend/src/components/contacts/CustomersTab.tsx` | frontend-ui | 954 | 45.7 | UI component/page |
| 347 | `frontend/src/components/contacts/DeliveryTab.tsx` | frontend-ui | 998 | 49.7 | UI component/page |
| 348 | `frontend/src/components/contacts/shared.tsx` | frontend-ui | 436 | 15.9 | UI component/page |
| 349 | `frontend/src/components/contacts/SuppliersTab.tsx` | frontend-ui | 1004 | 49.5 | UI component/page |
| 350 | `frontend/src/components/custom-tables/CustomTables.tsx` | frontend-ui | 724 | 31.7 | UI component/page |
| 351 | `frontend/src/components/dashboard/charts/BarChart.tsx` | frontend-ui | 178 | 6.3 | UI component/page |
| 352 | `frontend/src/components/dashboard/charts/DonutChart.tsx` | frontend-ui | 120 | 4.3 | UI component/page |
| 353 | `frontend/src/components/dashboard/charts/index.ts` | frontend-ui | 5 | 0.2 | UI component/page |
| 354 | `frontend/src/components/dashboard/charts/LineChart.tsx` | frontend-ui | 245 | 9.6 | UI component/page |
| 355 | `frontend/src/components/dashboard/charts/NoData.tsx` | frontend-ui | 15 | 0.4 | UI component/page |
| 356 | `frontend/src/components/dashboard/Dashboard.tsx` | frontend-ui | 1984 | 101.5 | UI component/page |
| 357 | `frontend/src/components/dashboard/dashboardExport.ts` | frontend-ui | 486 | 19.6 | UI component/page |
| 358 | `frontend/src/components/dashboard/MiniStat.tsx` | frontend-ui | 53 | 2.0 | UI component/page |
| 359 | `frontend/src/components/files/FilePickerModal.tsx` | frontend-ui | 333 | 13.7 | UI component/page |
| 360 | `frontend/src/components/files/FilesPage.tsx` | frontend-ui | 1227 | 55.1 | UI component/page |
| 361 | `frontend/src/components/files/FilesProvidersTab.tsx` | frontend-ui | 348 | 20.3 | UI component/page |
| 362 | `frontend/src/components/files/FilesResponsesTab.tsx` | frontend-ui | 195 | 11.3 | UI component/page |
| 363 | `frontend/src/components/inventory/DualMoney.tsx` | frontend-ui | 16 | 0.4 | UI component/page |
| 364 | `frontend/src/components/inventory/Inventory.tsx` | frontend-ui | 4006 | 198.4 | UI component/page |
| 365 | `frontend/src/components/inventory/inventoryExport.ts` | frontend-ui | 496 | 24.8 | UI component/page |
| 366 | `frontend/src/components/inventory/InventoryImportModal.tsx` | frontend-ui | 299 | 13.0 | UI component/page |
| 367 | `frontend/src/components/inventory/inventoryImportWorker.ts` | frontend-ui | 39 | 1.0 | UI component/page |
| 368 | `frontend/src/components/inventory/InventoryMovementsSurface.tsx` | frontend-ui | 677 | 38.7 | UI component/page |
| 369 | `frontend/src/components/inventory/InventoryProductsSurface.tsx` | frontend-ui | 566 | 34.5 | UI component/page |
| 370 | `frontend/src/components/inventory/InventoryRfidSurface.tsx` | frontend-ui | 180 | 9.6 | UI component/page |
| 371 | `frontend/src/components/inventory/movementGroups.ts` | frontend-ui | 287 | 12.9 | UI component/page |
| 372 | `frontend/src/components/inventory/ProductDetailModal.tsx` | frontend-ui | 267 | 15.0 | UI component/page |
| 373 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx` | frontend-ui | 731 | 40.2 | UI component/page |
| 374 | `frontend/src/components/navigation/Sidebar.tsx` | frontend-ui | 392 | 18.1 | UI component/page |
| 375 | `frontend/src/components/pos/CartItem.tsx` | frontend-ui | 160 | 6.5 | UI component/page |
| 376 | `frontend/src/components/pos/FilterPanel.tsx` | frontend-ui | 305 | 12.4 | UI component/page |
| 377 | `frontend/src/components/pos/POS.tsx` | frontend-ui | 2453 | 126.4 | UI component/page |
| 378 | `frontend/src/components/pos/posCore.ts` | frontend-ui | 167 | 6.4 | UI component/page |
| 379 | `frontend/src/components/pos/ProductImage.tsx` | frontend-ui | 113 | 2.9 | UI component/page |
| 380 | `frontend/src/components/pos/QuickAddModal.tsx` | frontend-ui | 49 | 1.8 | UI component/page |
| 381 | `frontend/src/components/products/config/productPageConfig.ts` | frontend-ui | 24 | 0.7 | UI component/page |
| 382 | `frontend/src/components/products/forms/BranchStockAdjuster.tsx` | frontend-ui | 199 | 6.8 | UI component/page |
| 383 | `frontend/src/components/products/forms/BulkAddStockModal.tsx` | frontend-ui | 193 | 6.5 | UI component/page |
| 384 | `frontend/src/components/products/forms/ProductForm.tsx` | frontend-ui | 1192 | 55.2 | UI component/page |
| 385 | `frontend/src/components/products/forms/VariantFormModal.tsx` | frontend-ui | 399 | 16.3 | UI component/page |
| 386 | `frontend/src/components/products/helpers/productDisplayHelpers.ts` | frontend-ui | 156 | 5.8 | UI component/page |
| 387 | `frontend/src/components/products/helpers/productExport.ts` | frontend-ui | 121 | 5.0 | UI component/page |
| 388 | `frontend/src/components/products/helpers/productFilterHelpers.ts` | frontend-ui | 128 | 4.8 | UI component/page |
| 389 | `frontend/src/components/products/helpers/productGalleryHelpers.ts` | frontend-ui | 112 | 3.3 | UI component/page |
| 390 | `frontend/src/components/products/helpers/productGroupViewHelpers.ts` | frontend-ui | 46 | 1.6 | UI component/page |
| 391 | `frontend/src/components/products/helpers/productMenuHelpers.ts` | frontend-ui | 304 | 11.5 | UI component/page |
| 392 | `frontend/src/components/products/helpers/productPageHelpers.ts` | frontend-ui | 32 | 1.0 | UI component/page |
| 393 | `frontend/src/components/products/helpers/productSelectionHelpers.ts` | frontend-ui | 139 | 4.2 | UI component/page |
| 394 | `frontend/src/components/products/helpers/productWriteHelpers.ts` | frontend-ui | 372 | 12.7 | UI component/page |
| 395 | `frontend/src/components/products/history/productHistoryHelpers.ts` | frontend-ui | 46 | 1.4 | UI component/page |
| 396 | `frontend/src/components/products/import/BulkImportModal.tsx` | frontend-ui | 2170 | 101.2 | UI component/page |
| 397 | `frontend/src/components/products/import/productImportPlanner.ts` | frontend-ui | 634 | 25.3 | UI component/page |
| 398 | `frontend/src/components/products/import/productImportWorker.ts` | frontend-ui | 68 | 1.9 | UI component/page |
| 399 | `frontend/src/components/products/lookups/ManageBrandsModal.tsx` | frontend-ui | 838 | 34.8 | UI component/page |
| 400 | `frontend/src/components/products/lookups/ManageCategoriesModal.tsx` | frontend-ui | 603 | 25.0 | UI component/page |
| 401 | `frontend/src/components/products/lookups/ManageUnitsModal.tsx` | frontend-ui | 603 | 24.0 | UI component/page |
| 402 | `frontend/src/components/products/lookups/productLookupSnapshots.ts` | frontend-ui | 229 | 7.3 | UI component/page |
| 403 | `frontend/src/components/products/Products.tsx` | frontend-ui | 2553 | 118.2 | UI component/page |
| 404 | `frontend/src/components/products/scanning/barcodeImageScanner.ts` | frontend-ui | 125 | 4.1 | UI component/page |
| 405 | `frontend/src/components/products/scanning/BarcodeScannerModal.tsx` | frontend-ui | 648 | 30.3 | UI component/page |
| 406 | `frontend/src/components/products/scanning/barcodeScannerState.ts` | frontend-ui | 82 | 2.5 | UI component/page |
| 407 | `frontend/src/components/products/scanning/cameraPermission.ts` | frontend-ui | 40 | 1.4 | UI component/page |
| 408 | `frontend/src/components/products/scanning/scanbotScanner.ts` | frontend-ui | 172 | 5.8 | UI component/page |
| 409 | `frontend/src/components/products/shared/primitives.tsx` | frontend-ui | 251 | 8.2 | UI component/page |
| 410 | `frontend/src/components/products/surfaces/HeaderActions.tsx` | frontend-ui | 157 | 6.0 | UI component/page |
| 411 | `frontend/src/components/products/surfaces/ProductDetailModal.tsx` | frontend-ui | 327 | 14.6 | UI component/page |
| 412 | `frontend/src/components/products/surfaces/ProductRowParts.tsx` | frontend-ui | 198 | 6.8 | UI component/page |
| 413 | `frontend/src/components/products/surfaces/ProductsListSurface.tsx` | frontend-ui | 392 | 20.5 | UI component/page |
| 414 | `frontend/src/components/README.md` | frontend-ui | 37 | 1.9 | UI component/page |
| 415 | `frontend/src/components/receipt-settings/AllFieldsPanel.tsx` | frontend-ui | 121 | 4.5 | UI component/page |
| 416 | `frontend/src/components/receipt-settings/constants.ts` | frontend-ui | 156 | 7.9 | UI component/page |
| 417 | `frontend/src/components/receipt-settings/ErrorBoundary.tsx` | frontend-ui | 45 | 1.2 | UI component/page |
| 418 | `frontend/src/components/receipt-settings/FieldOrderManager.tsx` | frontend-ui | 211 | 10.3 | UI component/page |
| 419 | `frontend/src/components/receipt-settings/PrintSettings.tsx` | frontend-ui | 278 | 12.6 | UI component/page |
| 420 | `frontend/src/components/receipt-settings/ReceiptPreview.tsx` | frontend-ui | 131 | 4.3 | UI component/page |
| 421 | `frontend/src/components/receipt-settings/ReceiptSettings.tsx` | frontend-ui | 536 | 29.4 | UI component/page |
| 422 | `frontend/src/components/receipt-settings/template.ts` | frontend-ui | 33 | 0.9 | UI component/page |
| 423 | `frontend/src/components/receipt/Receipt.tsx` | frontend-ui | 584 | 27.9 | UI component/page |
| 424 | `frontend/src/components/returns/EditReturnModal.tsx` | frontend-ui | 357 | 16.5 | UI component/page |
| 425 | `frontend/src/components/returns/NewReturnModal.tsx` | frontend-ui | 626 | 32.1 | UI component/page |
| 426 | `frontend/src/components/returns/NewSupplierReturnModal.tsx` | frontend-ui | 586 | 27.0 | UI component/page |
| 427 | `frontend/src/components/returns/ReturnDetailModal.tsx` | frontend-ui | 186 | 8.5 | UI component/page |
| 428 | `frontend/src/components/returns/Returns.tsx` | frontend-ui | 1052 | 45.0 | UI component/page |
| 429 | `frontend/src/components/returns/ReturnsListSurface.tsx` | frontend-ui | 385 | 19.3 | UI component/page |
| 430 | `frontend/src/components/sales/ExportModal.tsx` | frontend-ui | 321 | 13.4 | UI component/page |
| 431 | `frontend/src/components/sales/SaleDetailModal.tsx` | frontend-ui | 412 | 18.6 | UI component/page |
| 432 | `frontend/src/components/sales/Sales.tsx` | frontend-ui | 1048 | 45.4 | UI component/page |
| 433 | `frontend/src/components/sales/SalesImportModal.tsx` | frontend-ui | 288 | 12.2 | UI component/page |
| 434 | `frontend/src/components/sales/salesImportWorker.ts` | frontend-ui | 39 | 1.0 | UI component/page |
| 435 | `frontend/src/components/sales/SalesListSurface.tsx` | frontend-ui | 384 | 20.9 | UI component/page |
| 436 | `frontend/src/components/sales/StatusBadge.tsx` | frontend-ui | 58 | 2.1 | UI component/page |
| 437 | `frontend/src/components/server/ServerPage.tsx` | frontend-ui | 970 | 45.1 | UI component/page |
| 438 | `frontend/src/components/shared/ActionHistoryBar.tsx` | frontend-ui | 203 | 9.4 | UI component/page |
| 439 | `frontend/src/components/shared/AppSelect.tsx` | frontend-ui | 225 | 8.5 | UI component/page |
| 440 | `frontend/src/components/shared/BackgroundImportTracker.tsx` | frontend-ui | 658 | 28.0 | UI component/page |
| 441 | `frontend/src/components/shared/ExportMenu.tsx` | frontend-ui | 81 | 2.9 | UI component/page |
| 442 | `frontend/src/components/shared/FilterMenu.tsx` | frontend-ui | 192 | 7.8 | UI component/page |
| 443 | `frontend/src/components/shared/globalScroll.ts` | frontend-ui | 72 | 2.7 | UI component/page |
| 444 | `frontend/src/components/shared/ImageGalleryLightbox.tsx` | frontend-ui | 142 | 5.6 | UI component/page |
| 445 | `frontend/src/components/shared/LazyPortalMenu.tsx` | frontend-ui | 59 | 1.7 | UI component/page |
| 446 | `frontend/src/components/shared/LoadingWatchdog.tsx` | frontend-ui | 74 | 2.2 | UI component/page |
| 447 | `frontend/src/components/shared/Modal.tsx` | frontend-ui | 38 | 1.3 | UI component/page |
| 448 | `frontend/src/components/shared/navigationConfig.ts` | frontend-ui | 66 | 2.3 | UI component/page |
| 449 | `frontend/src/components/shared/NotificationCenter.tsx` | frontend-ui | 719 | 34.3 | UI component/page |
| 450 | `frontend/src/components/shared/pageActivity.ts` | frontend-ui | 12 | 0.3 | UI component/page |
| 451 | `frontend/src/components/shared/PageHeader.tsx` | frontend-ui | 72 | 2.5 | UI component/page |
| 452 | `frontend/src/components/shared/PaginationControls.tsx` | frontend-ui | 222 | 10.1 | UI component/page |
| 453 | `frontend/src/components/shared/PortalMenu.tsx` | frontend-ui | 279 | 9.1 | UI component/page |
| 454 | `frontend/src/components/shared/QuickPreferenceToggles.tsx` | frontend-ui | 79 | 2.7 | UI component/page |
| 455 | `frontend/src/components/shared/SectionSwitcher.tsx` | frontend-ui | 91 | 3.4 | UI component/page |
| 456 | `frontend/src/components/shared/WriteConflictModal.tsx` | frontend-ui | 321 | 12.5 | UI component/page |
| 457 | `frontend/src/components/users/permissionDefinitions.ts` | frontend-ui | 66 | 3.0 | UI component/page |
| 458 | `frontend/src/components/users/PermissionEditor.tsx` | frontend-ui | 128 | 5.4 | UI component/page |
| 459 | `frontend/src/components/users/UserDetailSheet.tsx` | frontend-ui | 145 | 6.1 | UI component/page |
| 460 | `frontend/src/components/users/UserProfileModal.tsx` | frontend-ui | 1326 | 68.2 | UI component/page |
| 461 | `frontend/src/components/users/Users.tsx` | frontend-ui | 1245 | 57.5 | UI component/page |
| 462 | `frontend/src/components/utils-settings/AuditLog.tsx` | frontend-ui | 1322 | 60.5 | UI component/page |
| 463 | `frontend/src/components/utils-settings/Backup.tsx` | frontend-ui | 1775 | 80.1 | UI component/page |
| 464 | `frontend/src/components/utils-settings/FontFamilyPicker.tsx` | frontend-ui | 74 | 3.1 | UI component/page |
| 465 | `frontend/src/components/utils-settings/index.ts` | frontend-ui | 7 | 0.3 | UI component/page |
| 466 | `frontend/src/components/utils-settings/OtpModal.tsx` | frontend-ui | 294 | 11.6 | UI component/page |
| 467 | `frontend/src/components/utils-settings/ResetData.tsx` | frontend-ui | 369 | 15.6 | UI component/page |
| 468 | `frontend/src/components/utils-settings/Settings.tsx` | frontend-ui | 1911 | 88.1 | UI component/page |
| 469 | `frontend/src/components/utils-settings/settingsConflict.ts` | frontend-ui | 64 | 1.8 | UI component/page |
| 470 | `frontend/src/constants.ts` | frontend-core | 185 | 4.6 | Project source/support file |
| 471 | `frontend/src/index.tsx` | frontend-core | 226 | 7.8 | Project source/support file |
| 472 | `frontend/src/lang/en.json` | frontend-i18n | 2721 | 134.5 | Localization dictionary |
| 473 | `frontend/src/lang/km.json` | frontend-i18n | 2730 | 246.7 | Localization dictionary |
| 474 | `frontend/src/platform/runtime/clientRuntime.ts` | frontend-core | 249 | 9.1 | Project source/support file |
| 475 | `frontend/src/platform/storage/storagePolicy.ts` | frontend-core | 40 | 1.3 | Project source/support file |
| 476 | `frontend/src/public-runtime/runtime-noise-guard.ts` | frontend-core | 120 | 4.9 | Project source/support file |
| 477 | `frontend/src/public-runtime/service-worker.ts` | frontend-core | 424 | 14.7 | Project source/support file |
| 478 | `frontend/src/public-runtime/theme-bootstrap.ts` | frontend-core | 232 | 8.6 | Project source/support file |
| 479 | `frontend/src/public-web-api.ts` | frontend-core | 49 | 1.6 | Project source/support file |
| 480 | `frontend/src/PublicCatalogRoot.tsx` | frontend-core | 25 | 0.7 | Project source/support file |
| 481 | `frontend/src/README.md` | frontend-core | 37 | 1.5 | Documentation |
| 482 | `frontend/src/runtime/runtimeErrorClassifier.ts` | frontend-core | 154 | 5.4 | Project source/support file |
| 483 | `frontend/src/styles/main.css` | frontend-style | 792 | 31.1 | Project source/support file |
| 484 | `frontend/src/types/lucide-react-icons.d.ts` | frontend-core | 7 | 0.1 | Project source/support file |
| 485 | `frontend/src/types/receiptContracts.ts` | frontend-core | 67 | 1.6 | Project source/support file |
| 486 | `frontend/src/types/settingsContracts.ts` | frontend-core | 28 | 0.5 | Project source/support file |
| 487 | `frontend/src/utils/actionGuards.ts` | frontend-utils | 76 | 2.2 | Utility helper |
| 488 | `frontend/src/utils/actionHistory.ts` | frontend-utils | 278 | 9.9 | Utility helper |
| 489 | `frontend/src/utils/appRefresh.ts` | frontend-utils | 38 | 1.0 | Utility helper |
| 490 | `frontend/src/utils/bulkOps.ts` | frontend-utils | 69 | 1.9 | Utility helper |
| 491 | `frontend/src/utils/color.ts` | frontend-utils | 34 | 1.0 | Utility helper |
| 492 | `frontend/src/utils/csv.ts` | frontend-utils | 234 | 7.6 | Utility helper |
| 493 | `frontend/src/utils/csvExportWorker.ts` | frontend-utils | 35 | 1.0 | Utility helper |
| 494 | `frontend/src/utils/csvImport.ts` | frontend-utils | 306 | 10.1 | Utility helper |
| 495 | `frontend/src/utils/csvRowCounter.d.mts` | frontend-utils | 2 | 0.1 | Utility helper |
| 496 | `frontend/src/utils/csvRowCounter.ts` | frontend-utils | 40 | 0.9 | Utility helper |
| 497 | `frontend/src/utils/csvTemplate.ts` | frontend-utils | 11 | 0.4 | Utility helper |
| 498 | `frontend/src/utils/dateHelpers.ts` | frontend-utils | 18 | 0.6 | Utility helper |
| 499 | `frontend/src/utils/deviceInfo.ts` | frontend-utils | 54 | 1.5 | Utility helper |
| 500 | `frontend/src/utils/exportPackage.ts` | frontend-utils | 61 | 1.4 | Utility helper |
| 501 | `frontend/src/utils/exportReports.tsx` | frontend-utils | 423 | 11.2 | Utility helper |
| 502 | `frontend/src/utils/favicon.ts` | frontend-utils | 101 | 3.1 | Utility helper |
| 503 | `frontend/src/utils/formatters.ts` | frontend-utils | 89 | 2.7 | Utility helper |
| 504 | `frontend/src/utils/groupedRecords.ts` | frontend-utils | 330 | 11.2 | Utility helper |
| 505 | `frontend/src/utils/historyHelpers.ts` | frontend-utils | 61 | 1.8 | Utility helper |
| 506 | `frontend/src/utils/importJobRefresh.ts` | frontend-utils | 106 | 3.1 | Utility helper |
| 507 | `frontend/src/utils/index.ts` | frontend-utils | 6 | 0.2 | Utility helper |
| 508 | `frontend/src/utils/initials.ts` | frontend-utils | 105 | 3.5 | Utility helper |
| 509 | `frontend/src/utils/loaders.ts` | frontend-utils | 101 | 3.1 | Utility helper |
| 510 | `frontend/src/utils/mediaUpload.ts` | frontend-utils | 28 | 1.2 | Utility helper |
| 511 | `frontend/src/utils/mediaUploadState.ts` | frontend-utils | 125 | 3.1 | Utility helper |
| 512 | `frontend/src/utils/permissions.ts` | frontend-utils | 22 | 0.6 | Utility helper |
| 513 | `frontend/src/utils/pricing.ts` | frontend-utils | 102 | 4.0 | Utility helper |
| 514 | `frontend/src/utils/printReceipt.ts` | frontend-utils | 1270 | 45.5 | Utility helper |
| 515 | `frontend/src/utils/productBatches.ts` | frontend-utils | 61 | 1.8 | Utility helper |
| 516 | `frontend/src/utils/productGrouping.ts` | frontend-utils | 315 | 11.3 | Utility helper |
| 517 | `frontend/src/utils/publicAssetUrls.ts` | frontend-utils | 80 | 3.1 | Utility helper |
| 518 | `frontend/src/utils/receiptAppliedConfig.ts` | frontend-utils | 147 | 4.5 | Utility helper |
| 519 | `frontend/src/utils/scriptTypography.ts` | frontend-utils | 27 | 0.7 | Utility helper |
| 520 | `frontend/src/utils/settingsRefresh.ts` | frontend-utils | 84 | 2.5 | Utility helper |
| 521 | `frontend/src/utils/settingsWriteOptions.ts` | frontend-utils | 14 | 0.6 | Utility helper |
| 522 | `frontend/src/web-api.ts` | frontend-core | 1328 | 52.2 | Project source/support file |
| 523 | `frontend/tailwind.config.ts` | frontend-root | 19 | 0.5 | Project source/support file |
| 524 | `frontend/tests/actionGuards.test.ts` | frontend-root | 74 | 2.3 | Project source/support file |
| 525 | `frontend/tests/actionStability.test.ts` | frontend-root | 755 | 61.7 | Project source/support file |
| 526 | `frontend/tests/adminShellMediaGuards.test.ts` | frontend-root | 147 | 5.5 | Project source/support file |
| 527 | `frontend/tests/apiHttp.test.ts` | frontend-root | 1241 | 75.0 | Project source/support file |
| 528 | `frontend/tests/appRefresh.test.ts` | frontend-root | 55 | 1.5 | Project source/support file |
| 529 | `frontend/tests/appShellUtils.test.ts` | frontend-root | 127 | 6.5 | Project source/support file |
| 530 | `frontend/tests/assetCompression.test.ts` | frontend-root | 36 | 1.5 | Project source/support file |
| 531 | `frontend/tests/backupJobs.test.ts` | frontend-root | 137 | 9.1 | Project source/support file |
| 532 | `frontend/tests/barcodeImageScanner.test.ts` | frontend-root | 119 | 3.2 | Project source/support file |
| 533 | `frontend/tests/barcodeScannerState.test.ts` | frontend-root | 64 | 2.6 | Project source/support file |
| 534 | `frontend/tests/bulkOps.test.ts` | frontend-root | 62 | 2.1 | Project source/support file |
| 535 | `frontend/tests/contactImportWorker.test.ts` | frontend-root | 41 | 1.7 | Project source/support file |
| 536 | `frontend/tests/csvImport.test.ts` | frontend-root | 86 | 3.5 | Project source/support file |
| 537 | `frontend/tests/dashboardDataReliability.test.ts` | frontend-root | 31 | 3.2 | Project source/support file |
| 538 | `frontend/tests/dateHelpers.test.ts` | frontend-root | 41 | 1.1 | Project source/support file |
| 539 | `frontend/tests/deviceInfo.test.ts` | frontend-root | 63 | 1.9 | Project source/support file |
| 540 | `frontend/tests/exportPackages.test.ts` | frontend-root | 105 | 4.0 | Project source/support file |
| 541 | `frontend/tests/formatters.test.ts` | frontend-root | 38 | 1.0 | Project source/support file |
| 542 | `frontend/tests/globalScroll.test.ts` | frontend-root | 25 | 0.7 | Project source/support file |
| 543 | `frontend/tests/globalScrollControls.test.ts` | frontend-root | 34 | 1.2 | Project source/support file |
| 544 | `frontend/tests/groupedRecords.test.ts` | frontend-root | 117 | 3.8 | Project source/support file |
| 545 | `frontend/tests/historyHelpers.test.ts` | frontend-root | 75 | 2.3 | Project source/support file |
| 546 | `frontend/tests/importJobRefresh.test.ts` | frontend-root | 95 | 2.8 | Project source/support file |
| 547 | `frontend/tests/initials.test.ts` | frontend-root | 68 | 2.2 | Project source/support file |
| 548 | `frontend/tests/inventoryImportWorker.test.ts` | frontend-root | 41 | 1.8 | Project source/support file |
| 549 | `frontend/tests/inventoryMobileCardLayout.test.ts` | frontend-root | 43 | 2.3 | Project source/support file |
| 550 | `frontend/tests/inventoryMovementGroups.test.ts` | frontend-root | 67 | 2.4 | Project source/support file |
| 551 | `frontend/tests/inventoryRfidSection.test.ts` | frontend-root | 23 | 1.1 | Project source/support file |
| 552 | `frontend/tests/loaders.test.ts` | frontend-root | 85 | 2.7 | Project source/support file |
| 553 | `frontend/tests/mediaUploadHelpers.test.ts` | frontend-root | 38 | 1.4 | Project source/support file |
| 554 | `frontend/tests/navigationConfig.test.ts` | frontend-root | 43 | 1.4 | Project source/support file |
| 555 | `frontend/tests/notificationBadge.test.ts` | frontend-root | 16 | 0.7 | Project source/support file |
| 556 | `frontend/tests/offlineSalesQueue.test.ts` | frontend-root | 90 | 4.8 | Project source/support file |
| 557 | `frontend/tests/offlineSecurityHardening.test.ts` | frontend-root | 95 | 4.2 | Project source/support file |
| 558 | `frontend/tests/offlineSyncArchitecture.test.ts` | frontend-root | 100 | 5.1 | Project source/support file |
| 559 | `frontend/tests/ownedGoogleAuth.test.ts` | frontend-root | 58 | 2.6 | Project source/support file |
| 560 | `frontend/tests/performanceLoadingUx.test.ts` | frontend-root | 3385 | 235.9 | Project source/support file |
| 561 | `frontend/tests/permissionEditor.test.ts` | frontend-root | 39 | 1.5 | Project source/support file |
| 562 | `frontend/tests/permissions.test.ts` | frontend-root | 18 | 0.6 | Project source/support file |
| 563 | `frontend/tests/portalCatalogDisplay.test.ts` | frontend-root | 140 | 6.5 | Project source/support file |
| 564 | `frontend/tests/portalContentI18n.test.ts` | frontend-root | 115 | 3.9 | Project source/support file |
| 565 | `frontend/tests/portalEditorUtils.test.ts` | frontend-root | 59 | 1.9 | Project source/support file |
| 566 | `frontend/tests/portalFaqVocabulary.test.ts` | frontend-root | 110 | 5.1 | Project source/support file |
| 567 | `frontend/tests/portalLanguagePacks.test.ts` | frontend-root | 50 | 3.1 | Project source/support file |
| 568 | `frontend/tests/portalTranslateController.test.ts` | frontend-root | 182 | 5.8 | Project source/support file |
| 569 | `frontend/tests/posCore.test.ts` | frontend-root | 169 | 6.3 | Project source/support file |
| 570 | `frontend/tests/pricingContacts.test.ts` | frontend-root | 110 | 4.0 | Project source/support file |
| 571 | `frontend/tests/productBatches.test.ts` | frontend-root | 55 | 1.3 | Project source/support file |
| 572 | `frontend/tests/productDiscountUx.test.ts` | frontend-root | 54 | 2.4 | Project source/support file |
| 573 | `frontend/tests/productDisplayHelpers.test.ts` | frontend-root | 107 | 3.5 | Project source/support file |
| 574 | `frontend/tests/productFilterHelpers.test.ts` | frontend-root | 117 | 3.4 | Project source/support file |
| 575 | `frontend/tests/productGalleryHelpers.test.ts` | frontend-root | 153 | 4.7 | Project source/support file |
| 576 | `frontend/tests/productGrouping.test.ts` | frontend-root | 114 | 5.1 | Project source/support file |
| 577 | `frontend/tests/productGroupViewHelpers.test.ts` | frontend-root | 53 | 1.5 | Project source/support file |
| 578 | `frontend/tests/productHistoryHelpers.test.ts` | frontend-root | 46 | 1.4 | Project source/support file |
| 579 | `frontend/tests/productImportPlanner.test.ts` | frontend-root | 290 | 13.9 | Project source/support file |
| 580 | `frontend/tests/productImportWorkerFallback.test.ts` | frontend-root | 43 | 2.0 | Project source/support file |
| 581 | `frontend/tests/productMenuHelpers.test.ts` | frontend-root | 188 | 5.9 | Project source/support file |
| 582 | `frontend/tests/productPageHelpers.test.ts` | frontend-root | 23 | 0.8 | Project source/support file |
| 583 | `frontend/tests/productSearchPagination.test.ts` | frontend-root | 156 | 6.2 | Project source/support file |
| 584 | `frontend/tests/productSelectionHelpers.test.ts` | frontend-root | 73 | 2.8 | Project source/support file |
| 585 | `frontend/tests/productWriteHelpers.test.ts` | frontend-root | 517 | 13.0 | Project source/support file |
| 586 | `frontend/tests/publicErrorRecovery.test.ts` | frontend-root | 37 | 1.4 | Project source/support file |
| 587 | `frontend/tests/receiptSettingsSync.test.ts` | frontend-root | 43 | 3.1 | Project source/support file |
| 588 | `frontend/tests/receiptTemplate.test.ts` | frontend-root | 106 | 5.2 | Project source/support file |
| 589 | `frontend/tests/returnsLayout.test.ts` | frontend-root | 23 | 1.6 | Project source/support file |
| 590 | `frontend/tests/runtimeErrorClassifier.test.ts` | frontend-root | 63 | 2.5 | Project source/support file |
| 591 | `frontend/tests/salesImportWorker.test.ts` | frontend-root | 41 | 1.8 | Project source/support file |
| 592 | `frontend/tests/scanbotScanner.test.ts` | frontend-root | 155 | 4.7 | Project source/support file |
| 593 | `frontend/tests/scriptTypography.test.ts` | frontend-root | 17 | 0.9 | Project source/support file |
| 594 | `frontend/tests/sectionNavigation.test.ts` | frontend-root | 49 | 2.5 | Project source/support file |
| 595 | `frontend/tests/settingsConflictHelpers.test.ts` | frontend-root | 45 | 1.4 | Project source/support file |
| 596 | `frontend/tests/settingsRefresh.test.ts` | frontend-root | 73 | 1.6 | Project source/support file |
| 597 | `frontend/tests/sourceSyntaxCheck.ts` | frontend-root | 67 | 2.5 | Project source/support file |
| 598 | `frontend/tests/storagePolicy.test.ts` | frontend-root | 44 | 1.4 | Project source/support file |
| 599 | `frontend/tests/utilsSettingsBarrel.test.ts` | frontend-root | 16 | 0.8 | Project source/support file |
| 600 | `frontend/tsconfig.json` | frontend-root | 47 | 1.3 | Configuration/data manifest |
| 601 | `frontend/vite.config.ts` | frontend-root | 564 | 21.2 | Project source/support file |
| 602 | `ops/scripts/architecture/generated-bulk-audit.ts` | project-scripts | 603 | 22.8 | Project source/support file |
| 603 | `ops/scripts/architecture/language-runtime-audit.ts` | project-scripts | 1666 | 71.6 | Project source/support file |
| 604 | `ops/scripts/architecture/organization-audit.ts` | project-scripts | 446 | 18.9 | Project source/support file |
| 605 | `ops/scripts/architecture/phase29-audit.ts` | project-scripts | 682 | 22.8 | Project source/support file |
| 606 | `ops/scripts/architecture/runtime-js-inventory.ts` | project-scripts | 220 | 7.5 | Project source/support file |
| 607 | `ops/scripts/backend/build-package-stage.ts` | project-scripts | 142 | 3.9 | Project source/support file |
| 608 | `ops/scripts/backend/build-server-entry.ts` | project-scripts | 89 | 3.0 | Project source/support file |
| 609 | `ops/scripts/backend/schema-audit.ts` | project-scripts | 496 | 16.9 | Project source/support file |
| 610 | `ops/scripts/backend/schema-primary-key-preflight.ts` | project-scripts | 216 | 8.3 | Project source/support file |
| 611 | `ops/scripts/backend/schema-primary-key-rollback.sql` | project-scripts | 15 | 0.5 | Project source/support file |
| 612 | `ops/scripts/backend/verify-data-integrity.ts` | project-scripts | 689 | 29.0 | Project source/support file |
| 613 | `ops/scripts/frontend/build-public-runtime-scripts.ts` | project-scripts | 110 | 3.6 | Project source/support file |
| 614 | `ops/scripts/frontend/verify-i18n.ts` | project-scripts | 145 | 4.3 | Project source/support file |
| 615 | `ops/scripts/frontend/verify-performance.ts` | project-scripts | 149 | 10.2 | Project source/support file |
| 616 | `ops/scripts/frontend/verify-ui.ts` | project-scripts | 243 | 8.7 | Project source/support file |
| 617 | `ops/scripts/lib/fs-utils.ts` | project-scripts | 241 | 6.8 | Project source/support file |
| 618 | `ops/scripts/lib/report-utils.ts` | project-scripts | 70 | 2.1 | Project source/support file |
| 619 | `ops/scripts/powershell/clean-generated.ps1` | project-scripts | 265 | 7.9 | Project source/support file |
| 620 | `ops/scripts/powershell/clear-stale-node-processes.ps1` | project-scripts | 92 | 2.8 | Project source/support file |
| 621 | `ops/scripts/powershell/docker-release.ps1` | project-scripts | 1031 | 49.4 | Project source/support file |
| 622 | `ops/scripts/powershell/full-automation.ps1` | project-scripts | 214 | 8.1 | Project source/support file |
| 623 | `ops/scripts/powershell/npm-install-mode.ps1` | project-scripts | 28 | 0.8 | Project source/support file |
| 624 | `ops/scripts/powershell/runtime-bootstrap.ps1` | project-scripts | 592 | 21.6 | Project source/support file |
| 625 | `ops/scripts/powershell/start-runtime.ps1` | project-scripts | 377 | 16.3 | Project source/support file |
| 626 | `ops/scripts/powershell/tailscale-health-monitor.ps1` | project-scripts | 240 | 7.8 | Project source/support file |
| 627 | `ops/scripts/runtime/audits/action-history-undo-redo-check.ts` | project-scripts | 209 | 7.3 | Project source/support file |
| 628 | `ops/scripts/runtime/audits/audit-auth.ts` | project-scripts | 191 | 6.0 | Project source/support file |
| 629 | `ops/scripts/runtime/audits/audit-manifest.ts` | project-scripts | 302 | 8.7 | Project source/support file |
| 630 | `ops/scripts/runtime/audits/audit-report-html.ts` | project-scripts | 446 | 15.9 | Project source/support file |
| 631 | `ops/scripts/runtime/audits/deep-live-audit.ts` | project-scripts | 1463 | 55.3 | Project source/support file |
| 632 | `ops/scripts/runtime/audits/full-app-audit.ts` | project-scripts | 652 | 28.6 | Project source/support file |
| 633 | `ops/scripts/runtime/audits/package.json` | project-scripts | 5 | 0.0 | Configuration/data manifest |
| 634 | `ops/scripts/runtime/browser-action-smoke.ts` | project-scripts | 869 | 31.2 | Project source/support file |
| 635 | `ops/scripts/runtime/build-ecosystem-config.ts` | project-scripts | 86 | 2.8 | Project source/support file |
| 636 | `ops/scripts/runtime/cloudflare/rotate-cloudflare-tunnel-token.ts` | project-scripts | 244 | 10.8 | Project source/support file |
| 637 | `ops/scripts/runtime/cloudflare/update-cloudflare-tunnel-origin.ts` | project-scripts | 144 | 6.0 | Project source/support file |
| 638 | `ops/scripts/runtime/cloudflare/verify-cloudflare-automation.ts` | project-scripts | 285 | 12.0 | Project source/support file |
| 639 | `ops/scripts/runtime/cloudflare/verify-r2-object-store.ts` | project-scripts | 155 | 6.0 | Project source/support file |
| 640 | `ops/scripts/runtime/cloudflare/warm-cloudflare-startup-assets.ts` | project-scripts | 277 | 9.7 | Project source/support file |
| 641 | `ops/scripts/runtime/live-checks/all-pages-control-audit.ts` | project-scripts | 1233 | 46.6 | Project source/support file |
| 642 | `ops/scripts/runtime/live-checks/filter-burst-check.ts` | project-scripts | 134 | 5.1 | Project source/support file |
| 643 | `ops/scripts/runtime/live-checks/live-check-utils.ts` | project-scripts | 123 | 3.6 | Project source/support file |
| 644 | `ops/scripts/runtime/live-checks/move766-product-write-live-check.ts` | project-scripts | 216 | 10.0 | Project source/support file |
| 645 | `ops/scripts/runtime/live-checks/package.json` | project-scripts | 5 | 0.0 | Configuration/data manifest |
| 646 | `ops/scripts/runtime/live-checks/phase84-account-loyalty-select-live-check.ts` | project-scripts | 167 | 8.3 | Project source/support file |
| 647 | `ops/scripts/runtime/live-checks/phase84-branches-actions-live-check.ts` | project-scripts | 149 | 7.0 | Project source/support file |
| 648 | `ops/scripts/runtime/live-checks/phase84-catalog-editor-select-live-check.ts` | project-scripts | 148 | 6.7 | Project source/support file |
| 649 | `ops/scripts/runtime/live-checks/phase84-contacts-live-check.ts` | project-scripts | 136 | 6.0 | Project source/support file |
| 650 | `ops/scripts/runtime/live-checks/phase84-files-providers-actions-live-check.ts` | project-scripts | 136 | 6.3 | Project source/support file |
| 651 | `ops/scripts/runtime/live-checks/phase84-filter-menu-live-check.ts` | project-scripts | 292 | 14.2 | Project source/support file |
| 652 | `ops/scripts/runtime/live-checks/phase84-inventory-actions-live-check.ts` | project-scripts | 165 | 8.1 | Project source/support file |
| 653 | `ops/scripts/runtime/live-checks/phase84-inventory-section-restore-live-check.ts` | project-scripts | 139 | 7.1 | Project source/support file |
| 654 | `ops/scripts/runtime/live-checks/phase84-live-suite.ts` | project-scripts | 279 | 8.8 | Project source/support file |
| 655 | `ops/scripts/runtime/live-checks/phase84-loyalty-points-rollback-check.ts` | project-scripts | 205 | 8.4 | Project source/support file |
| 656 | `ops/scripts/runtime/live-checks/phase84-product-brands-actions-live-check.ts` | project-scripts | 160 | 7.8 | Project source/support file |
| 657 | `ops/scripts/runtime/live-checks/phase84-product-categories-actions-live-check.ts` | project-scripts | 129 | 6.1 | Project source/support file |
| 658 | `ops/scripts/runtime/live-checks/phase84-product-form-dropdown-live-check.ts` | project-scripts | 145 | 6.5 | Project source/support file |
| 659 | `ops/scripts/runtime/live-checks/phase84-product-page-actions-live-check.ts` | project-scripts | 144 | 6.6 | Project source/support file |
| 660 | `ops/scripts/runtime/live-checks/phase84-product-scanning-actions-live-check.ts` | project-scripts | 127 | 6.0 | Project source/support file |
| 661 | `ops/scripts/runtime/live-checks/phase84-product-stock-actions-live-check.ts` | project-scripts | 139 | 6.7 | Project source/support file |
| 662 | `ops/scripts/runtime/live-checks/phase84-product-units-actions-live-check.ts` | project-scripts | 129 | 6.0 | Project source/support file |
| 663 | `ops/scripts/runtime/live-checks/phase84-product-variant-actions-live-check.ts` | project-scripts | 152 | 6.7 | Project source/support file |
| 664 | `ops/scripts/runtime/live-checks/phase84-public-assistant-select-live-check.ts` | project-scripts | 128 | 5.5 | Project source/support file |
| 665 | `ops/scripts/runtime/live-checks/phase84-public-portal-cloudflare-check.ts` | project-scripts | 223 | 10.3 | Project source/support file |
| 666 | `ops/scripts/runtime/live-checks/phase84-receipt-export-layout-check.ts` | project-scripts | 208 | 10.4 | Project source/support file |
| 667 | `ops/scripts/runtime/live-checks/phase84-receipt-settings-rollback-check.ts` | project-scripts | 204 | 8.2 | Project source/support file |
| 668 | `ops/scripts/runtime/live-checks/phase84-sales-actions-live-check.ts` | project-scripts | 137 | 6.1 | Project source/support file |
| 669 | `ops/scripts/runtime/live-checks/phase84-settings-save-rollback-check.ts` | project-scripts | 166 | 6.7 | Project source/support file |
| 670 | `ops/scripts/runtime/live-checks/phase84-settings-select-live-check.ts` | project-scripts | 167 | 7.2 | Project source/support file |
| 671 | `ops/scripts/runtime/live-checks/phase84-shared-select-live-check.ts` | project-scripts | 154 | 7.2 | Project source/support file |
| 672 | `ops/scripts/runtime/live-checks/phase84-ui-live-check.ts` | project-scripts | 830 | 54.1 | Project source/support file |
| 673 | `ops/scripts/runtime/live-checks/phase84-users-actions-live-check.ts` | project-scripts | 164 | 7.9 | Project source/support file |
| 674 | `ops/scripts/runtime/live-checks/route-load-trace.ts` | project-scripts | 207 | 7.5 | Project source/support file |
| 675 | `ops/scripts/runtime/smoke/check-public-url.ts` | project-scripts | 239 | 8.2 | Project source/support file |
| 676 | `ops/scripts/runtime/smoke/check-route-contract.ts` | project-scripts | 86 | 3.9 | Project source/support file |
| 677 | `ops/scripts/runtime/smoke/live-smoke.ts` | project-scripts | 318 | 13.4 | Project source/support file |
| 678 | `ops/scripts/runtime/smoke/post-start-diagnostics.ts` | project-scripts | 213 | 6.9 | Project source/support file |
| 679 | `ops/scripts/runtime/storage/cleanup-integrity-backlog.ts` | project-scripts | 230 | 9.6 | Project source/support file |
| 680 | `ops/scripts/runtime/storage/cleanup-test-data.ts` | project-scripts | 430 | 18.8 | Project source/support file |
| 681 | `ops/scripts/runtime/storage/dataset-readiness.ts` | project-scripts | 117 | 4.5 | Project source/support file |
| 682 | `ops/scripts/runtime/storage/post-live-hygiene.ts` | project-scripts | 211 | 6.7 | Project source/support file |
| 683 | `ops/scripts/runtime/storage/prune-storage.ts` | project-scripts | 567 | 19.9 | Project source/support file |
| 684 | `ops/scripts/runtime/storage/restore-candidates.ts` | project-scripts | 213 | 7.5 | Project source/support file |
| 685 | `ops/scripts/runtime/storage/restore-rehearsal.ts` | project-scripts | 219 | 7.9 | Project source/support file |
| 686 | `ops/scripts/verification/verify-backup-reliability.ts` | project-scripts | 162 | 5.7 | Project source/support file |
| 687 | `ops/scripts/verification/verify-docker-release.ts` | project-scripts | 731 | 35.3 | Project source/support file |
| 688 | `ops/scripts/verification/verify-hardening-policy.ts` | project-scripts | 165 | 6.2 | Project source/support file |
| 689 | `ops/scripts/verification/verify-runtime-deps.ts` | project-scripts | 410 | 16.6 | Project source/support file |
| 690 | `ops/scripts/verification/verify-scale-services.ts` | project-scripts | 180 | 6.7 | Project source/support file |
| 691 | `ops/scripts/verification/verify-secret-hygiene.ts` | project-scripts | 71 | 2.4 | Project source/support file |
| 692 | `package.json` | project-root | 22 | 0.6 | Configuration/data manifest |
| 693 | `README.md` | project-root | 159 | 11.6 | Project documentation entrypoint |
| 694 | `run/build-release.bat` | project-scripts | 54 | 1.7 | Final Docker release build wrapper |
| 695 | `run/clean-generated.bat` | project-scripts | 60 | 1.8 | Project source/support file |
| 696 | `run/cloudflare-origin.bat` | project-scripts | 34 | 1.1 | Project source/support file |
| 697 | `run/docker/backup.bat` | project-scripts | 15 | 0.6 | Project source/support file |
| 698 | `run/docker/doctor.bat` | project-scripts | 15 | 0.5 | Project source/support file |
| 699 | `run/docker/install.bat` | project-scripts | 15 | 0.5 | Project source/support file |
| 700 | `run/docker/README.md` | project-scripts | 44 | 3.1 | Documentation |
| 701 | `run/docker/release.bat` | project-scripts | 15 | 0.5 | Project source/support file |
| 702 | `run/docker/restore.bat` | project-scripts | 29 | 1.0 | Project source/support file |
| 703 | `run/docker/rotate-cloudflare.bat` | project-scripts | 15 | 0.5 | Project source/support file |
| 704 | `run/docker/start.bat` | project-scripts | 15 | 0.6 | Project source/support file |
| 705 | `run/docker/update.bat` | project-scripts | 15 | 0.5 | Project source/support file |
| 706 | `run/full-automation.bat` | project-scripts | 22 | 0.6 | Project source/support file |
| 707 | `run/README.md` | project-scripts | 47 | 2.9 | Documentation |
| 708 | `run/setup.bat` | project-scripts | 349 | 16.2 | Project source/support file |
| 709 | `run/sh/setup.sh` | project-scripts | 116 | 3.3 | Project source/support file |
| 710 | `run/sh/start-server.sh` | project-scripts | 147 | 5.6 | Project source/support file |
| 711 | `run/sh/stop-server.sh` | project-scripts | 62 | 1.6 | Project source/support file |
| 712 | `run/start-server.bat` | project-scripts | 570 | 29.3 | Project source/support file |
| 713 | `run/stop-server.bat` | project-scripts | 183 | 8.4 | Project source/support file |
| 714 | `run/verify-local.bat` | project-scripts | 148 | 4.9 | Project source/support file |
| 715 | `Start Business OS.bat` | project-root | 38 | 1.3 | Project source/support file |
