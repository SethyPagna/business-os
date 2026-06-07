# Import / Export Reference

Auto-generated import/export and dependency-link coverage for frontend/backend code files.

## 1. Coverage Summary

Code files documented: **645**

## 2. Dependency Matrix

| No. | File | Imports | Exports | Internal deps | Referenced by |
|---:|---|---:|---:|---:|---:|
| 1 | `backend/.pkg-stage/server.js` | 47 | 0 | 40 | 0 |
| 2 | `backend/.pkg-stage/src/accessControl.js` | 1 | 1 | 1 | 3 |
| 3 | `backend/.pkg-stage/src/analytics/duckdbRuntime.js` | 2 | 1 | 1 | 3 |
| 4 | `backend/.pkg-stage/src/authOtpGuards.js` | 1 | 1 | 1 | 1 |
| 5 | `backend/.pkg-stage/src/backupSchema.js` | 0 | 1 | 0 | 2 |
| 6 | `backend/.pkg-stage/src/businessMetrics.js` | 1 | 1 | 1 | 5 |
| 7 | `backend/.pkg-stage/src/catalogTextIntegrity.js` | 0 | 1 | 0 | 7 |
| 8 | `backend/.pkg-stage/src/config/index.js` | 4 | 1 | 1 | 23 |
| 9 | `backend/.pkg-stage/src/conflictControl.js` | 0 | 1 | 0 | 12 |
| 10 | `backend/.pkg-stage/src/contactOptions.js` | 0 | 1 | 0 | 2 |
| 11 | `backend/.pkg-stage/src/database.js` | 1 | 1 | 1 | 37 |
| 12 | `backend/.pkg-stage/src/dataPath/index.js` | 2 | 1 | 0 | 4 |
| 13 | `backend/.pkg-stage/src/db/cutoverReadiness.js` | 2 | 1 | 0 | 1 |
| 14 | `backend/.pkg-stage/src/db/postgresQueryCompat.js` | 0 | 1 | 0 | 1 |
| 15 | `backend/.pkg-stage/src/fileAssets.js` | 12 | 1 | 7 | 11 |
| 16 | `backend/.pkg-stage/src/helpers.js` | 4 | 1 | 4 | 23 |
| 17 | `backend/.pkg-stage/src/idempotency.js` | 0 | 1 | 0 | 4 |
| 18 | `backend/.pkg-stage/src/importCsv.js` | 1 | 1 | 0 | 1 |
| 19 | `backend/.pkg-stage/src/importParsing.js` | 1 | 1 | 1 | 1 |
| 20 | `backend/.pkg-stage/src/initials.js` | 0 | 1 | 0 | 3 |
| 21 | `backend/.pkg-stage/src/maintenanceLock.js` | 0 | 1 | 0 | 3 |
| 22 | `backend/.pkg-stage/src/middleware.js` | 10 | 1 | 7 | 24 |
| 23 | `backend/.pkg-stage/src/money.js` | 0 | 1 | 0 | 5 |
| 24 | `backend/.pkg-stage/src/netSecurity.js` | 1 | 1 | 0 | 4 |
| 25 | `backend/.pkg-stage/src/objectStore.js` | 7 | 1 | 1 | 6 |
| 26 | `backend/.pkg-stage/src/optionalSharp.js` | 1 | 1 | 0 | 2 |
| 27 | `backend/.pkg-stage/src/organizationContext/index.js` | 7 | 1 | 4 | 6 |
| 28 | `backend/.pkg-stage/src/permissions.js` | 0 | 1 | 0 | 3 |
| 29 | `backend/.pkg-stage/src/portalUtils.js` | 0 | 1 | 0 | 1 |
| 30 | `backend/.pkg-stage/src/postgresDatabase.js` | 7 | 1 | 3 | 1 |
| 31 | `backend/.pkg-stage/src/productBatches.js` | 1 | 1 | 1 | 6 |
| 32 | `backend/.pkg-stage/src/productDiscounts.js` | 1 | 1 | 1 | 3 |
| 33 | `backend/.pkg-stage/src/productImportPolicies.js` | 1 | 1 | 1 | 2 |
| 34 | `backend/.pkg-stage/src/requestContext.js` | 1 | 1 | 0 | 2 |
| 35 | `backend/.pkg-stage/src/routes/actionHistory.js` | 5 | 1 | 4 | 1 |
| 36 | `backend/.pkg-stage/src/routes/ai.js` | 6 | 1 | 5 | 1 |
| 37 | `backend/.pkg-stage/src/routes/auth.js` | 19 | 1 | 14 | 1 |
| 38 | `backend/.pkg-stage/src/routes/branches.js` | 8 | 1 | 6 | 1 |
| 39 | `backend/.pkg-stage/src/routes/catalog.js` | 4 | 1 | 3 | 1 |
| 40 | `backend/.pkg-stage/src/routes/categories.js` | 6 | 1 | 5 | 1 |
| 41 | `backend/.pkg-stage/src/routes/contacts.js` | 6 | 1 | 5 | 1 |
| 42 | `backend/.pkg-stage/src/routes/customTables.js` | 6 | 1 | 5 | 1 |
| 43 | `backend/.pkg-stage/src/routes/files.js` | 6 | 1 | 5 | 1 |
| 44 | `backend/.pkg-stage/src/routes/importJobs.js` | 9 | 1 | 5 | 1 |
| 45 | `backend/.pkg-stage/src/routes/inventory.js` | 12 | 1 | 11 | 1 |
| 46 | `backend/.pkg-stage/src/routes/notifications.js` | 5 | 1 | 4 | 1 |
| 47 | `backend/.pkg-stage/src/routes/organizations.js` | 3 | 1 | 2 | 1 |
| 48 | `backend/.pkg-stage/src/routes/portal.js` | 13 | 1 | 12 | 1 |
| 49 | `backend/.pkg-stage/src/routes/products.js` | 20 | 1 | 17 | 1 |
| 50 | `backend/.pkg-stage/src/routes/returns.js` | 7 | 1 | 6 | 1 |
| 51 | `backend/.pkg-stage/src/routes/runtime.js` | 9 | 1 | 8 | 1 |
| 52 | `backend/.pkg-stage/src/routes/sales.js` | 8 | 1 | 7 | 1 |
| 53 | `backend/.pkg-stage/src/routes/settings.js` | 9 | 1 | 8 | 1 |
| 54 | `backend/.pkg-stage/src/routes/sync.js` | 7 | 1 | 3 | 1 |
| 55 | `backend/.pkg-stage/src/routes/system/index.js` | 24 | 1 | 20 | 1 |
| 56 | `backend/.pkg-stage/src/routes/units.js` | 6 | 1 | 5 | 1 |
| 57 | `backend/.pkg-stage/src/routes/users.js` | 11 | 1 | 9 | 1 |
| 58 | `backend/.pkg-stage/src/runtimeCache.js` | 2 | 1 | 1 | 3 |
| 59 | `backend/.pkg-stage/src/runtimeState/index.js` | 4 | 1 | 1 | 2 |
| 60 | `backend/.pkg-stage/src/runtimeVersion.js` | 5 | 1 | 1 | 4 |
| 61 | `backend/.pkg-stage/src/schemaMetadata.js` | 1 | 1 | 1 | 5 |
| 62 | `backend/.pkg-stage/src/security.js` | 1 | 1 | 0 | 6 |
| 63 | `backend/.pkg-stage/src/serverUtils.js` | 1 | 1 | 1 | 3 |
| 64 | `backend/.pkg-stage/src/services/aiGateway.js` | 2 | 1 | 2 | 2 |
| 65 | `backend/.pkg-stage/src/services/backupPackages.js` | 9 | 1 | 4 | 3 |
| 66 | `backend/.pkg-stage/src/services/firebaseAuth.js` | 2 | 1 | 0 | 0 |
| 67 | `backend/.pkg-stage/src/services/googleDriveSync/index.js` | 12 | 1 | 8 | 4 |
| 68 | `backend/.pkg-stage/src/services/googleDriveSync/versioning.js` | 0 | 1 | 0 | 1 |
| 69 | `backend/.pkg-stage/src/services/googleOauth.js` | 2 | 1 | 1 | 3 |
| 70 | `backend/.pkg-stage/src/services/importJobs.js` | 20 | 1 | 14 | 6 |
| 71 | `backend/.pkg-stage/src/services/integrationDoctor.js` | 10 | 1 | 8 | 1 |
| 72 | `backend/.pkg-stage/src/services/mediaQueue.js` | 5 | 1 | 3 | 4 |
| 73 | `backend/.pkg-stage/src/services/portalAi.js` | 2 | 1 | 2 | 1 |
| 74 | `backend/.pkg-stage/src/services/verification.js` | 2 | 1 | 1 | 2 |
| 75 | `backend/.pkg-stage/src/sessionAuth.js` | 2 | 1 | 1 | 4 |
| 76 | `backend/.pkg-stage/src/settingsSnapshot.js` | 4 | 1 | 2 | 7 |
| 77 | `backend/.pkg-stage/src/storage/organizationFolders.js` | 2 | 1 | 0 | 2 |
| 78 | `backend/.pkg-stage/src/systemFsWorker.js` | 3 | 0 | 1 | 0 |
| 79 | `backend/.pkg-stage/src/systemJobs.js` | 2 | 1 | 1 | 1 |
| 80 | `backend/.pkg-stage/src/uploadReferenceCleanup.js` | 1 | 1 | 1 | 1 |
| 81 | `backend/.pkg-stage/src/uploadSecurity.js` | 2 | 1 | 1 | 3 |
| 82 | `backend/.pkg-stage/src/websocket.js` | 5 | 1 | 3 | 1 |
| 83 | `backend/.pkg-stage/src/workers/importWorker.js` | 2 | 1 | 2 | 1 |
| 84 | `backend/.pkg-stage/src/workers/mediaWorker.js` | 2 | 1 | 2 | 1 |
| 85 | `backend/server.js` | 47 | 0 | 40 | 0 |
| 86 | `backend/server.ts` | 47 | 0 | 40 | 0 |
| 87 | `backend/src/accessControl.ts` | 1 | 1 | 1 | 4 |
| 88 | `backend/src/analytics/duckdbRuntime.ts` | 2 | 1 | 1 | 5 |
| 89 | `backend/src/authOtpGuards.ts` | 1 | 1 | 1 | 2 |
| 90 | `backend/src/backupSchema.ts` | 0 | 1 | 0 | 3 |
| 91 | `backend/src/businessMetrics.ts` | 1 | 1 | 1 | 5 |
| 92 | `backend/src/catalogTextIntegrity.ts` | 0 | 1 | 0 | 7 |
| 93 | `backend/src/config/index.ts` | 4 | 1 | 1 | 26 |
| 94 | `backend/src/conflictControl.ts` | 0 | 1 | 0 | 12 |
| 95 | `backend/src/contactOptions.ts` | 0 | 1 | 0 | 3 |
| 96 | `backend/src/database.ts` | 1 | 1 | 1 | 41 |
| 97 | `backend/src/dataPath/index.ts` | 2 | 1 | 0 | 5 |
| 98 | `backend/src/db/cutoverReadiness.ts` | 2 | 1 | 0 | 2 |
| 99 | `backend/src/db/postgresQueryCompat.ts` | 0 | 1 | 0 | 2 |
| 100 | `backend/src/fileAssets.ts` | 12 | 1 | 7 | 16 |
| 101 | `backend/src/helpers.ts` | 4 | 1 | 4 | 24 |
| 102 | `backend/src/idempotency.ts` | 0 | 1 | 0 | 5 |
| 103 | `backend/src/importCsv.ts` | 1 | 1 | 0 | 3 |
| 104 | `backend/src/importParsing.ts` | 1 | 1 | 1 | 3 |
| 105 | `backend/src/initials.ts` | 0 | 1 | 0 | 4 |
| 106 | `backend/src/maintenanceLock.ts` | 0 | 1 | 0 | 4 |
| 107 | `backend/src/middleware.ts` | 10 | 1 | 7 | 25 |
| 108 | `backend/src/money.ts` | 0 | 1 | 0 | 5 |
| 109 | `backend/src/netSecurity.ts` | 1 | 1 | 0 | 5 |
| 110 | `backend/src/objectStore.ts` | 7 | 1 | 1 | 7 |
| 111 | `backend/src/optionalSharp.ts` | 1 | 1 | 0 | 2 |
| 112 | `backend/src/organizationContext/index.ts` | 7 | 1 | 4 | 7 |
| 113 | `backend/src/permissions.ts` | 0 | 1 | 0 | 4 |
| 114 | `backend/src/portalUtils.ts` | 0 | 1 | 0 | 2 |
| 115 | `backend/src/postgresDatabase.ts` | 7 | 1 | 3 | 2 |
| 116 | `backend/src/productBatches.ts` | 1 | 1 | 1 | 7 |
| 117 | `backend/src/productDiscounts.ts` | 1 | 1 | 1 | 3 |
| 118 | `backend/src/productImportPolicies.ts` | 1 | 1 | 1 | 3 |
| 119 | `backend/src/requestContext.ts` | 1 | 1 | 0 | 3 |
| 120 | `backend/src/routes/actionHistory.ts` | 5 | 1 | 4 | 2 |
| 121 | `backend/src/routes/ai.ts` | 6 | 1 | 5 | 2 |
| 122 | `backend/src/routes/auth.ts` | 19 | 1 | 14 | 3 |
| 123 | `backend/src/routes/branches.ts` | 8 | 1 | 6 | 2 |
| 124 | `backend/src/routes/catalog.ts` | 4 | 1 | 3 | 3 |
| 125 | `backend/src/routes/categories.ts` | 6 | 1 | 5 | 3 |
| 126 | `backend/src/routes/contacts.ts` | 6 | 1 | 5 | 2 |
| 127 | `backend/src/routes/customTables.ts` | 6 | 1 | 5 | 2 |
| 128 | `backend/src/routes/files.ts` | 6 | 1 | 5 | 3 |
| 129 | `backend/src/routes/importJobs.ts` | 9 | 1 | 5 | 2 |
| 130 | `backend/src/routes/inventory.ts` | 12 | 1 | 11 | 3 |
| 131 | `backend/src/routes/notifications.ts` | 5 | 1 | 4 | 4 |
| 132 | `backend/src/routes/organizations.ts` | 3 | 1 | 2 | 3 |
| 133 | `backend/src/routes/portal.ts` | 13 | 1 | 12 | 3 |
| 134 | `backend/src/routes/products.ts` | 21 | 1 | 18 | 3 |
| 135 | `backend/src/routes/returns.ts` | 7 | 1 | 6 | 2 |
| 136 | `backend/src/routes/runtime.ts` | 9 | 1 | 8 | 3 |
| 137 | `backend/src/routes/sales.ts` | 8 | 1 | 7 | 3 |
| 138 | `backend/src/routes/settings.ts` | 9 | 1 | 8 | 3 |
| 139 | `backend/src/routes/sync.ts` | 7 | 1 | 3 | 2 |
| 140 | `backend/src/routes/system/index.ts` | 24 | 1 | 20 | 3 |
| 141 | `backend/src/routes/units.ts` | 6 | 1 | 5 | 3 |
| 142 | `backend/src/routes/users.ts` | 11 | 1 | 9 | 2 |
| 143 | `backend/src/runtimeCache.ts` | 2 | 1 | 1 | 5 |
| 144 | `backend/src/runtimeState/index.ts` | 4 | 1 | 1 | 2 |
| 145 | `backend/src/runtimeVersion.ts` | 5 | 1 | 1 | 6 |
| 146 | `backend/src/schemaMetadata.ts` | 1 | 1 | 1 | 6 |
| 147 | `backend/src/security.ts` | 1 | 1 | 0 | 7 |
| 148 | `backend/src/serverUtils.ts` | 1 | 1 | 1 | 5 |
| 149 | `backend/src/services/aiGateway.ts` | 2 | 1 | 2 | 2 |
| 150 | `backend/src/services/backupPackages.ts` | 9 | 1 | 4 | 4 |
| 151 | `backend/src/services/firebaseAuth.ts` | 2 | 1 | 0 | 0 |
| 152 | `backend/src/services/googleDriveSync/index.ts` | 12 | 1 | 8 | 4 |
| 153 | `backend/src/services/googleDriveSync/versioning.ts` | 0 | 1 | 0 | 2 |
| 154 | `backend/src/services/googleOauth.ts` | 2 | 1 | 1 | 4 |
| 155 | `backend/src/services/importJobs.ts` | 20 | 1 | 14 | 8 |
| 156 | `backend/src/services/integrationDoctor.ts` | 10 | 1 | 8 | 2 |
| 157 | `backend/src/services/mediaQueue.ts` | 5 | 1 | 3 | 5 |
| 158 | `backend/src/services/portalAi.ts` | 2 | 1 | 2 | 1 |
| 159 | `backend/src/services/verification.ts` | 2 | 1 | 1 | 2 |
| 160 | `backend/src/sessionAuth.ts` | 2 | 1 | 1 | 4 |
| 161 | `backend/src/settingsSnapshot.ts` | 4 | 1 | 2 | 8 |
| 162 | `backend/src/storage/organizationFolders.ts` | 2 | 1 | 0 | 2 |
| 163 | `backend/src/systemFsWorker.ts` | 3 | 0 | 1 | 0 |
| 164 | `backend/src/systemJobs.ts` | 2 | 1 | 1 | 2 |
| 165 | `backend/src/uploadReferenceCleanup.ts` | 1 | 1 | 1 | 2 |
| 166 | `backend/src/uploadSecurity.ts` | 2 | 1 | 1 | 4 |
| 167 | `backend/src/websocket.ts` | 5 | 1 | 3 | 3 |
| 168 | `backend/src/workers/importWorker.ts` | 2 | 1 | 2 | 2 |
| 169 | `backend/src/workers/mediaWorker.ts` | 2 | 1 | 2 | 2 |
| 170 | `backend/test/accessControl.test.ts` | 2 | 0 | 1 | 0 |
| 171 | `backend/test/analyticsRuntime.test.ts` | 2 | 0 | 1 | 0 |
| 172 | `backend/test/authOtpGuards.test.ts` | 2 | 0 | 1 | 0 |
| 173 | `backend/test/authSecurityFlow.test.ts` | 8 | 0 | 1 | 0 |
| 174 | `backend/test/backupDefaultDestination.test.ts` | 3 | 0 | 0 | 0 |
| 175 | `backend/test/backupPerformanceHardening.test.ts` | 3 | 0 | 0 | 0 |
| 176 | `backend/test/backupRetention.test.ts` | 5 | 0 | 1 | 0 |
| 177 | `backend/test/backupSchema.test.ts` | 4 | 0 | 1 | 0 |
| 178 | `backend/test/branchStockSearch.test.ts` | 6 | 0 | 0 | 0 |
| 179 | `backend/test/contactOptions.test.ts` | 2 | 0 | 1 | 0 |
| 180 | `backend/test/dataPath.test.ts` | 5 | 0 | 1 | 0 |
| 181 | `backend/test/defaultRoles.test.ts` | 6 | 0 | 0 | 0 |
| 182 | `backend/test/fileAssetStorageReconcile.test.ts` | 2 | 0 | 1 | 0 |
| 183 | `backend/test/fileAssetUsageCache.test.ts` | 3 | 0 | 2 | 0 |
| 184 | `backend/test/fileRouteSecurityFlow.test.ts` | 6 | 0 | 0 | 0 |
| 185 | `backend/test/fullAutomation.test.ts` | 3 | 0 | 0 | 0 |
| 186 | `backend/test/googleDriveSyncVersioning.test.ts` | 4 | 0 | 1 | 0 |
| 187 | `backend/test/idempotency.test.ts` | 2 | 0 | 1 | 0 |
| 188 | `backend/test/importCsv.test.ts` | 6 | 0 | 2 | 0 |
| 189 | `backend/test/importDecisionIntegrity.test.ts` | 3 | 0 | 0 | 0 |
| 190 | `backend/test/importJobPerformanceHardening.test.ts` | 3 | 0 | 0 | 0 |
| 191 | `backend/test/importJobStateMachine.test.ts` | 8 | 0 | 4 | 0 |
| 192 | `backend/test/importScaleSmoke.test.ts` | 6 | 0 | 2 | 0 |
| 193 | `backend/test/initials.test.ts` | 2 | 0 | 1 | 0 |
| 194 | `backend/test/integrationDoctor.test.ts` | 2 | 0 | 1 | 0 |
| 195 | `backend/test/inventorySettingsMediaContracts.test.ts` | 3 | 0 | 0 | 0 |
| 196 | `backend/test/mediaOptimization.test.ts` | 3 | 0 | 1 | 0 |
| 197 | `backend/test/netSecurity.test.ts` | 2 | 0 | 1 | 0 |
| 198 | `backend/test/notificationSummaryCache.test.ts` | 2 | 0 | 1 | 0 |
| 199 | `backend/test/offlineSecurity.test.ts` | 3 | 0 | 0 | 0 |
| 200 | `backend/test/ownedGoogleAuth.test.ts` | 4 | 0 | 1 | 0 |
| 201 | `backend/test/permissionPolicy.test.ts` | 2 | 0 | 1 | 0 |
| 202 | `backend/test/portalInventoryRegression.test.ts` | 3 | 0 | 0 | 0 |
| 203 | `backend/test/portalUtils.test.ts` | 2 | 0 | 1 | 0 |
| 204 | `backend/test/postgresCutoverReadiness.test.ts` | 3 | 0 | 1 | 0 |
| 205 | `backend/test/postgresDatabase.test.ts` | 4 | 0 | 1 | 0 |
| 206 | `backend/test/postgresQueryCompat.test.ts` | 2 | 0 | 1 | 0 |
| 207 | `backend/test/productBatchHierarchy.test.ts` | 3 | 0 | 0 | 0 |
| 208 | `backend/test/productExpiry.test.ts` | 3 | 0 | 0 | 0 |
| 209 | `backend/test/productImportPolicies.test.ts` | 2 | 0 | 1 | 0 |
| 210 | `backend/test/productSearchPagination.test.ts` | 4 | 0 | 0 | 0 |
| 211 | `backend/test/rfidRoutes.test.ts` | 3 | 0 | 0 | 0 |
| 212 | `backend/test/routeContracts.test.ts` | 19 | 0 | 14 | 0 |
| 213 | `backend/test/runtimeCache.test.ts` | 5 | 0 | 1 | 0 |
| 214 | `backend/test/runtimeVersion.test.ts` | 5 | 0 | 1 | 0 |
| 215 | `backend/test/schemaMetadata.test.ts` | 2 | 0 | 1 | 0 |
| 216 | `backend/test/security.test.ts` | 2 | 0 | 1 | 0 |
| 217 | `backend/test/serverUtils.test.ts` | 3 | 0 | 2 | 0 |
| 218 | `backend/test/settingsSnapshotObjectStorage.test.ts` | 3 | 0 | 2 | 0 |
| 219 | `backend/test/systemJobs.test.ts` | 2 | 0 | 1 | 0 |
| 220 | `backend/test/uploadSecurity.test.ts` | 3 | 0 | 2 | 0 |
| 221 | `backend/test/websocket.test.ts` | 2 | 0 | 1 | 0 |
| 222 | `frontend/public/runtime-noise-guard.js` | 0 | 0 | 0 | 0 |
| 223 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.js` | 0 | 0 | 0 | 0 |
| 224 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.worker.js` | 0 | 0 | 0 | 0 |
| 225 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd-threads.js` | 0 | 0 | 0 | 0 |
| 226 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd.js` | 0 | 0 | 0 | 0 |
| 227 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core.js` | 0 | 0 | 0 | 0 |
| 228 | `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js` | 0 | 0 | 0 | 0 |
| 229 | `frontend/public/sw.js` | 0 | 0 | 0 | 0 |
| 230 | `frontend/public/theme-bootstrap.js` | 0 | 0 | 0 | 0 |
| 231 | `frontend/src/AdminRoot.tsx` | 4 | 1 | 3 | 1 |
| 232 | `frontend/src/api/actionHistoryTransport.ts` | 3 | 6 | 3 | 3 |
| 233 | `frontend/src/api/actorQuery.ts` | 1 | 2 | 1 | 5 |
| 234 | `frontend/src/api/aiTransport.ts` | 2 | 6 | 2 | 1 |
| 235 | `frontend/src/api/appBootstrapTransport.ts` | 2 | 1 | 2 | 2 |
| 236 | `frontend/src/api/auditLogTransport.ts` | 4 | 2 | 4 | 0 |
| 237 | `frontend/src/api/authTransport.ts` | 2 | 18 | 2 | 2 |
| 238 | `frontend/src/api/branchTransport.ts` | 6 | 10 | 6 | 6 |
| 239 | `frontend/src/api/browserDialogs.ts` | 1 | 3 | 1 | 2 |
| 240 | `frontend/src/api/conflicts.ts` | 0 | 3 | 0 | 3 |
| 241 | `frontend/src/api/contactReadTransport.ts` | 4 | 3 | 4 | 7 |
| 242 | `frontend/src/api/contactsTransport.ts` | 9 | 18 | 9 | 3 |
| 243 | `frontend/src/api/contactWriteTransport.ts` | 3 | 9 | 3 | 4 |
| 244 | `frontend/src/api/cooldownFallbacks.ts` | 0 | 8 | 0 | 0 |
| 245 | `frontend/src/api/customTablesTransport.ts` | 2 | 6 | 2 | 1 |
| 246 | `frontend/src/api/dashboardTransport.ts` | 2 | 3 | 2 | 2 |
| 247 | `frontend/src/api/driveSync.ts` | 3 | 7 | 3 | 1 |
| 248 | `frontend/src/api/expectedUpdatedAt.ts` | 1 | 2 | 1 | 10 |
| 249 | `frontend/src/api/fileTransport.ts` | 4 | 4 | 4 | 1 |
| 250 | `frontend/src/api/http.ts` | 2 | 33 | 2 | 40 |
| 251 | `frontend/src/api/httpState.ts` | 0 | 4 | 0 | 1 |
| 252 | `frontend/src/api/importJobsTransport.ts` | 4 | 16 | 4 | 2 |
| 253 | `frontend/src/api/importTransport.ts` | 3 | 2 | 3 | 2 |
| 254 | `frontend/src/api/inventoryTransport.ts` | 4 | 6 | 4 | 4 |
| 255 | `frontend/src/api/inventoryWriteTransport.ts` | 3 | 4 | 3 | 3 |
| 256 | `frontend/src/api/lazyLocalDb.ts` | 1 | 2 | 1 | 15 |
| 257 | `frontend/src/api/localDb.ts` | 3 | 10 | 2 | 8 |
| 258 | `frontend/src/api/localMirrors.ts` | 3 | 5 | 3 | 12 |
| 259 | `frontend/src/api/lookupTransport.ts` | 4 | 8 | 4 | 5 |
| 260 | `frontend/src/api/methods.ts` | 35 | 192 | 35 | 1 |
| 261 | `frontend/src/api/multipartHeaders.ts` | 1 | 1 | 1 | 2 |
| 262 | `frontend/src/api/notificationSummary.ts` | 2 | 1 | 2 | 2 |
| 263 | `frontend/src/api/offlineSnapshotTransport.ts` | 10 | 1 | 10 | 2 |
| 264 | `frontend/src/api/pendingSyncTransport.ts` | 3 | 3 | 3 | 1 |
| 265 | `frontend/src/api/portalHttp.ts` | 1 | 2 | 1 | 2 |
| 266 | `frontend/src/api/portalTransport.ts` | 2 | 13 | 2 | 5 |
| 267 | `frontend/src/api/productImageUploadTransport.ts` | 1 | 1 | 1 | 2 |
| 268 | `frontend/src/api/productReadTransport.ts` | 5 | 7 | 5 | 5 |
| 269 | `frontend/src/api/productWriteTransport.ts` | 5 | 5 | 5 | 3 |
| 270 | `frontend/src/api/query.ts` | 0 | 3 | 0 | 21 |
| 271 | `frontend/src/api/queryCache.ts` | 1 | 4 | 1 | 5 |
| 272 | `frontend/src/api/requestIds.ts` | 0 | 2 | 0 | 5 |
| 273 | `frontend/src/api/returnsTransport.ts` | 8 | 5 | 8 | 4 |
| 274 | `frontend/src/api/rfidTransport.ts` | 3 | 7 | 3 | 2 |
| 275 | `frontend/src/api/salesTransport.ts` | 7 | 6 | 7 | 3 |
| 276 | `frontend/src/api/saleWriteTransport.ts` | 3 | 2 | 2 | 4 |
| 277 | `frontend/src/api/settingsTransport.ts` | 7 | 2 | 7 | 2 |
| 278 | `frontend/src/api/syncPreview.ts` | 0 | 2 | 0 | 2 |
| 279 | `frontend/src/api/syncRuntime.ts` | 1 | 7 | 1 | 3 |
| 280 | `frontend/src/api/systemJobs.ts` | 2 | 8 | 2 | 1 |
| 281 | `frontend/src/api/systemRuntime.ts` | 2 | 16 | 2 | 2 |
| 282 | `frontend/src/api/userAdminTransport.ts` | 5 | 13 | 5 | 1 |
| 283 | `frontend/src/api/userReadTransport.ts` | 3 | 1 | 3 | 5 |
| 284 | `frontend/src/api/websocket.ts` | 2 | 7 | 2 | 2 |
| 285 | `frontend/src/App.tsx` | 34 | 1 | 29 | 1 |
| 286 | `frontend/src/app/appShellUtils.ts` | 0 | 9 | 0 | 3 |
| 287 | `frontend/src/app/pathRouting.ts` | 0 | 7 | 0 | 2 |
| 288 | `frontend/src/app/publicErrorRecovery.ts` | 0 | 3 | 0 | 1 |
| 289 | `frontend/src/AppContext.tsx` | 14 | 5 | 13 | 53 |
| 290 | `frontend/src/components/auth/Login.tsx` | 16 | 1 | 5 | 1 |
| 291 | `frontend/src/components/branches/Branches.tsx` | 18 | 1 | 11 | 1 |
| 292 | `frontend/src/components/branches/BranchForm.tsx` | 2 | 1 | 1 | 1 |
| 293 | `frontend/src/components/branches/TransferModal.tsx` | 4 | 1 | 3 | 1 |
| 294 | `frontend/src/components/catalog/catalogAssetUrls.ts` | 0 | 1 | 0 | 2 |
| 295 | `frontend/src/components/catalog/CatalogEditorSurface.tsx` | 17 | 1 | 6 | 1 |
| 296 | `frontend/src/components/catalog/CatalogImageField.tsx` | 3 | 1 | 1 | 1 |
| 297 | `frontend/src/components/catalog/catalogImages.tsx` | 2 | 1 | 1 | 2 |
| 298 | `frontend/src/components/catalog/CatalogPage.tsx` | 43 | 1 | 16 | 2 |
| 299 | `frontend/src/components/catalog/CatalogPageContext.tsx` | 1 | 2 | 0 | 2 |
| 300 | `frontend/src/components/catalog/catalogPagination.tsx` | 2 | 2 | 1 | 1 |
| 301 | `frontend/src/components/catalog/CatalogPreviewSurface.tsx` | 10 | 1 | 4 | 1 |
| 302 | `frontend/src/components/catalog/CatalogProductsSection.tsx` | 17 | 1 | 6 | 1 |
| 303 | `frontend/src/components/catalog/CatalogSecondaryTabs.tsx` | 22 | 1 | 2 | 1 |
| 304 | `frontend/src/components/catalog/catalogUi.tsx` | 1 | 3 | 0 | 4 |
| 305 | `frontend/src/components/catalog/portalCatalogDisplay.ts` | 1 | 7 | 1 | 1 |
| 306 | `frontend/src/components/catalog/portalContentI18n.ts` | 1 | 6 | 1 | 1 |
| 307 | `frontend/src/components/catalog/portalEditorUtils.ts` | 0 | 9 | 0 | 0 |
| 308 | `frontend/src/components/catalog/portalLanguageOptions.ts` | 0 | 3 | 0 | 0 |
| 309 | `frontend/src/components/catalog/portalLanguagePacks.ts` | 0 | 4 | 0 | 2 |
| 310 | `frontend/src/components/catalog/portalTranslateController.ts` | 0 | 20 | 0 | 1 |
| 311 | `frontend/src/components/catalog/portalTranslationData.ts` | 0 | 2 | 0 | 0 |
| 312 | `frontend/src/components/contacts/ContactImportModal.tsx` | 9 | 1 | 8 | 4 |
| 313 | `frontend/src/components/contacts/contactImportWorker.ts` | 1 | 0 | 1 | 0 |
| 314 | `frontend/src/components/contacts/contactOptionUtils.ts` | 0 | 9 | 0 | 5 |
| 315 | `frontend/src/components/contacts/Contacts.tsx` | 19 | 1 | 12 | 1 |
| 316 | `frontend/src/components/contacts/CustomerFormModal.tsx` | 4 | 1 | 3 | 1 |
| 317 | `frontend/src/components/contacts/customerMembershipNumber.ts` | 0 | 1 | 0 | 2 |
| 318 | `frontend/src/components/contacts/CustomersTab.tsx` | 25 | 2 | 19 | 1 |
| 319 | `frontend/src/components/contacts/DeliveryTab.tsx` | 24 | 2 | 18 | 1 |
| 320 | `frontend/src/components/contacts/shared.tsx` | 8 | 6 | 5 | 3 |
| 321 | `frontend/src/components/contacts/SuppliersTab.tsx` | 24 | 0 | 18 | 1 |
| 322 | `frontend/src/components/custom-tables/CustomTables.tsx` | 8 | 1 | 7 | 0 |
| 323 | `frontend/src/components/dashboard/charts/BarChart.tsx` | 3 | 1 | 2 | 1 |
| 324 | `frontend/src/components/dashboard/charts/DonutChart.tsx` | 3 | 1 | 2 | 1 |
| 325 | `frontend/src/components/dashboard/charts/index.ts` | 0 | 0 | 0 | 1 |
| 326 | `frontend/src/components/dashboard/charts/LineChart.tsx` | 3 | 1 | 2 | 1 |
| 327 | `frontend/src/components/dashboard/charts/NoData.tsx` | 1 | 1 | 1 | 3 |
| 328 | `frontend/src/components/dashboard/Dashboard.tsx` | 18 | 1 | 15 | 1 |
| 329 | `frontend/src/components/dashboard/dashboardExport.ts` | 4 | 9 | 4 | 1 |
| 330 | `frontend/src/components/dashboard/MiniStat.tsx` | 1 | 1 | 0 | 1 |
| 331 | `frontend/src/components/files/FilePickerModal.tsx` | 4 | 1 | 3 | 5 |
| 332 | `frontend/src/components/files/FilesPage.tsx` | 22 | 1 | 11 | 1 |
| 333 | `frontend/src/components/files/FilesProvidersTab.tsx` | 8 | 1 | 1 | 1 |
| 334 | `frontend/src/components/files/FilesResponsesTab.tsx` | 7 | 1 | 0 | 1 |
| 335 | `frontend/src/components/inventory/DualMoney.tsx` | 0 | 1 | 0 | 1 |
| 336 | `frontend/src/components/inventory/Inventory.tsx` | 46 | 1 | 36 | 1 |
| 337 | `frontend/src/components/inventory/inventoryExport.ts` | 4 | 4 | 4 | 1 |
| 338 | `frontend/src/components/inventory/InventoryImportModal.tsx` | 5 | 1 | 4 | 1 |
| 339 | `frontend/src/components/inventory/inventoryImportWorker.ts` | 1 | 0 | 1 | 0 |
| 340 | `frontend/src/components/inventory/InventoryMovementsSurface.tsx` | 9 | 1 | 4 | 1 |
| 341 | `frontend/src/components/inventory/InventoryProductsSurface.tsx` | 5 | 1 | 2 | 1 |
| 342 | `frontend/src/components/inventory/InventoryRfidSurface.tsx` | 1 | 1 | 0 | 1 |
| 343 | `frontend/src/components/inventory/movementGroups.ts` | 0 | 4 | 0 | 2 |
| 344 | `frontend/src/components/inventory/ProductDetailModal.tsx` | 2 | 1 | 2 | 1 |
| 345 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx` | 14 | 1 | 8 | 1 |
| 346 | `frontend/src/components/navigation/Sidebar.tsx` | 26 | 1 | 5 | 1 |
| 347 | `frontend/src/components/pos/CartItem.tsx` | 3 | 1 | 3 | 1 |
| 348 | `frontend/src/components/pos/FilterPanel.tsx` | 8 | 1 | 0 | 1 |
| 349 | `frontend/src/components/pos/POS.tsx` | 27 | 1 | 23 | 1 |
| 350 | `frontend/src/components/pos/posCore.ts` | 3 | 9 | 3 | 0 |
| 351 | `frontend/src/components/pos/ProductImage.tsx` | 2 | 1 | 1 | 1 |
| 352 | `frontend/src/components/pos/QuickAddModal.tsx` | 1 | 1 | 0 | 1 |
| 353 | `frontend/src/components/products/config/productPageConfig.ts` | 0 | 9 | 0 | 0 |
| 354 | `frontend/src/components/products/forms/BranchStockAdjuster.tsx` | 4 | 1 | 3 | 1 |
| 355 | `frontend/src/components/products/forms/BulkAddStockModal.tsx` | 4 | 1 | 3 | 1 |
| 356 | `frontend/src/components/products/forms/ProductForm.tsx` | 12 | 1 | 10 | 1 |
| 357 | `frontend/src/components/products/forms/VariantFormModal.tsx` | 9 | 1 | 8 | 1 |
| 358 | `frontend/src/components/products/helpers/productDisplayHelpers.ts` | 1 | 7 | 1 | 1 |
| 359 | `frontend/src/components/products/helpers/productExport.ts` | 1 | 1 | 1 | 2 |
| 360 | `frontend/src/components/products/helpers/productFilterHelpers.ts` | 1 | 3 | 1 | 2 |
| 361 | `frontend/src/components/products/helpers/productGalleryHelpers.ts` | 1 | 8 | 1 | 1 |
| 362 | `frontend/src/components/products/helpers/productGroupViewHelpers.ts` | 0 | 2 | 0 | 0 |
| 363 | `frontend/src/components/products/helpers/productMenuHelpers.ts` | 0 | 4 | 0 | 1 |
| 364 | `frontend/src/components/products/helpers/productPageHelpers.ts` | 1 | 4 | 0 | 0 |
| 365 | `frontend/src/components/products/helpers/productSelectionHelpers.ts` | 0 | 10 | 0 | 0 |
| 366 | `frontend/src/components/products/helpers/productWriteHelpers.ts` | 2 | 15 | 2 | 0 |
| 367 | `frontend/src/components/products/history/productHistoryHelpers.ts` | 0 | 2 | 0 | 2 |
| 368 | `frontend/src/components/products/import/BulkImportModal.tsx` | 10 | 1 | 5 | 1 |
| 369 | `frontend/src/components/products/import/productImportPlanner.ts` | 0 | 11 | 0 | 3 |
| 370 | `frontend/src/components/products/import/productImportWorker.ts` | 1 | 0 | 1 | 0 |
| 371 | `frontend/src/components/products/lookups/ManageBrandsModal.tsx` | 6 | 1 | 5 | 1 |
| 372 | `frontend/src/components/products/lookups/ManageCategoriesModal.tsx` | 6 | 1 | 5 | 1 |
| 373 | `frontend/src/components/products/lookups/ManageUnitsModal.tsx` | 6 | 1 | 5 | 1 |
| 374 | `frontend/src/components/products/lookups/productLookupSnapshots.ts` | 1 | 3 | 1 | 0 |
| 375 | `frontend/src/components/products/Products.tsx` | 42 | 1 | 38 | 1 |
| 376 | `frontend/src/components/products/scanning/barcodeImageScanner.ts` | 1 | 1 | 0 | 2 |
| 377 | `frontend/src/components/products/scanning/BarcodeScannerModal.tsx` | 13 | 1 | 5 | 1 |
| 378 | `frontend/src/components/products/scanning/barcodeScannerState.ts` | 0 | 1 | 0 | 2 |
| 379 | `frontend/src/components/products/scanning/cameraPermission.ts` | 0 | 2 | 0 | 3 |
| 380 | `frontend/src/components/products/scanning/scanbotScanner.ts` | 1 | 3 | 1 | 2 |
| 381 | `frontend/src/components/products/shared/primitives.tsx` | 4 | 0 | 1 | 5 |
| 382 | `frontend/src/components/products/surfaces/HeaderActions.tsx` | 7 | 1 | 3 | 1 |
| 383 | `frontend/src/components/products/surfaces/ProductDetailModal.tsx` | 6 | 1 | 4 | 1 |
| 384 | `frontend/src/components/products/surfaces/ProductRowParts.tsx` | 6 | 4 | 4 | 0 |
| 385 | `frontend/src/components/products/surfaces/ProductsListSurface.tsx` | 3 | 1 | 0 | 1 |
| 386 | `frontend/src/components/receipt-settings/AllFieldsPanel.tsx` | 3 | 1 | 2 | 1 |
| 387 | `frontend/src/components/receipt-settings/constants.ts` | 0 | 3 | 0 | 4 |
| 388 | `frontend/src/components/receipt-settings/ErrorBoundary.tsx` | 1 | 1 | 0 | 1 |
| 389 | `frontend/src/components/receipt-settings/FieldOrderManager.tsx` | 7 | 1 | 0 | 1 |
| 390 | `frontend/src/components/receipt-settings/PrintSettings.tsx` | 9 | 1 | 2 | 1 |
| 391 | `frontend/src/components/receipt-settings/ReceiptPreview.tsx` | 4 | 1 | 3 | 1 |
| 392 | `frontend/src/components/receipt-settings/ReceiptSettings.tsx` | 20 | 1 | 10 | 1 |
| 393 | `frontend/src/components/receipt-settings/template.ts` | 1 | 2 | 1 | 4 |
| 394 | `frontend/src/components/receipt/Receipt.tsx` | 9 | 1 | 4 | 3 |
| 395 | `frontend/src/components/returns/EditReturnModal.tsx` | 5 | 1 | 4 | 1 |
| 396 | `frontend/src/components/returns/NewReturnModal.tsx` | 5 | 1 | 4 | 1 |
| 397 | `frontend/src/components/returns/NewSupplierReturnModal.tsx` | 8 | 1 | 7 | 1 |
| 398 | `frontend/src/components/returns/ReturnDetailModal.tsx` | 2 | 1 | 2 | 1 |
| 399 | `frontend/src/components/returns/Returns.tsx` | 23 | 1 | 18 | 1 |
| 400 | `frontend/src/components/returns/ReturnsListSurface.tsx` | 3 | 1 | 0 | 1 |
| 401 | `frontend/src/components/sales/ExportModal.tsx` | 8 | 1 | 3 | 1 |
| 402 | `frontend/src/components/sales/SaleDetailModal.tsx` | 4 | 1 | 3 | 1 |
| 403 | `frontend/src/components/sales/Sales.tsx` | 26 | 1 | 22 | 1 |
| 404 | `frontend/src/components/sales/SalesImportModal.tsx` | 5 | 1 | 4 | 1 |
| 405 | `frontend/src/components/sales/salesImportWorker.ts` | 1 | 0 | 1 | 0 |
| 406 | `frontend/src/components/sales/SalesListSurface.tsx` | 4 | 1 | 1 | 1 |
| 407 | `frontend/src/components/sales/StatusBadge.tsx` | 0 | 5 | 0 | 4 |
| 408 | `frontend/src/components/server/ServerPage.tsx` | 13 | 1 | 4 | 1 |
| 409 | `frontend/src/components/shared/ActionHistoryBar.tsx` | 6 | 1 | 2 | 17 |
| 410 | `frontend/src/components/shared/AppSelect.tsx` | 3 | 1 | 0 | 29 |
| 411 | `frontend/src/components/shared/BackgroundImportTracker.tsx` | 13 | 1 | 5 | 1 |
| 412 | `frontend/src/components/shared/ExportMenu.tsx` | 3 | 1 | 1 | 7 |
| 413 | `frontend/src/components/shared/FilterMenu.tsx` | 4 | 1 | 1 | 8 |
| 414 | `frontend/src/components/shared/globalScroll.ts` | 0 | 2 | 0 | 2 |
| 415 | `frontend/src/components/shared/ImageGalleryLightbox.tsx` | 4 | 1 | 0 | 3 |
| 416 | `frontend/src/components/shared/LazyPortalMenu.tsx` | 2 | 1 | 1 | 5 |
| 417 | `frontend/src/components/shared/LoadingWatchdog.tsx` | 1 | 1 | 0 | 6 |
| 418 | `frontend/src/components/shared/Modal.tsx` | 1 | 1 | 0 | 22 |
| 419 | `frontend/src/components/shared/navigationConfig.ts` | 0 | 4 | 0 | 3 |
| 420 | `frontend/src/components/shared/NotificationCenter.tsx` | 15 | 1 | 2 | 1 |
| 421 | `frontend/src/components/shared/pageActivity.ts` | 2 | 1 | 1 | 15 |
| 422 | `frontend/src/components/shared/PageHeader.tsx` | 1 | 1 | 0 | 6 |
| 423 | `frontend/src/components/shared/PaginationControls.tsx` | 4 | 4 | 1 | 8 |
| 424 | `frontend/src/components/shared/PortalMenu.tsx` | 3 | 2 | 0 | 7 |
| 425 | `frontend/src/components/shared/QuickPreferenceToggles.tsx` | 5 | 1 | 1 | 3 |
| 426 | `frontend/src/components/shared/SectionSwitcher.tsx` | 1 | 1 | 0 | 4 |
| 427 | `frontend/src/components/shared/WriteConflictModal.tsx` | 1 | 1 | 1 | 1 |
| 428 | `frontend/src/components/users/permissionDefinitions.ts` | 0 | 2 | 0 | 3 |
| 429 | `frontend/src/components/users/PermissionEditor.tsx` | 1 | 1 | 1 | 1 |
| 430 | `frontend/src/components/users/UserDetailSheet.tsx` | 2 | 1 | 2 | 1 |
| 431 | `frontend/src/components/users/UserProfileModal.tsx` | 15 | 1 | 9 | 2 |
| 432 | `frontend/src/components/users/Users.tsx` | 17 | 1 | 14 | 1 |
| 433 | `frontend/src/components/utils-settings/AuditLog.tsx` | 18 | 1 | 8 | 1 |
| 434 | `frontend/src/components/utils-settings/Backup.tsx` | 19 | 1 | 8 | 1 |
| 435 | `frontend/src/components/utils-settings/FontFamilyPicker.tsx` | 3 | 1 | 0 | 1 |
| 436 | `frontend/src/components/utils-settings/index.ts` | 0 | 0 | 0 | 0 |
| 437 | `frontend/src/components/utils-settings/OtpModal.tsx` | 3 | 1 | 2 | 2 |
| 438 | `frontend/src/components/utils-settings/ResetData.tsx` | 10 | 0 | 4 | 1 |
| 439 | `frontend/src/components/utils-settings/Settings.tsx` | 42 | 1 | 14 | 1 |
| 440 | `frontend/src/components/utils-settings/settingsConflict.ts` | 0 | 2 | 0 | 2 |
| 441 | `frontend/src/constants.ts` | 0 | 12 | 0 | 14 |
| 442 | `frontend/src/index.tsx` | 9 | 0 | 4 | 0 |
| 443 | `frontend/src/platform/runtime/clientRuntime.ts` | 2 | 8 | 2 | 2 |
| 444 | `frontend/src/platform/storage/storagePolicy.ts` | 0 | 8 | 0 | 3 |
| 445 | `frontend/src/public-runtime/runtime-noise-guard.ts` | 0 | 0 | 0 | 0 |
| 446 | `frontend/src/public-runtime/service-worker.ts` | 0 | 0 | 0 | 0 |
| 447 | `frontend/src/public-runtime/theme-bootstrap.ts` | 0 | 0 | 0 | 0 |
| 448 | `frontend/src/public-web-api.ts` | 1 | 0 | 1 | 1 |
| 449 | `frontend/src/PublicCatalogRoot.tsx` | 4 | 1 | 3 | 1 |
| 450 | `frontend/src/runtime/runtimeErrorClassifier.ts` | 0 | 8 | 0 | 0 |
| 451 | `frontend/src/types/lucide-react-icons.d.ts` | 1 | 1 | 0 | 0 |
| 452 | `frontend/src/types/receiptContracts.ts` | 0 | 0 | 0 | 4 |
| 453 | `frontend/src/types/settingsContracts.ts` | 0 | 1 | 0 | 2 |
| 454 | `frontend/src/utils/actionGuards.ts` | 0 | 6 | 0 | 33 |
| 455 | `frontend/src/utils/actionHistory.ts` | 3 | 1 | 2 | 16 |
| 456 | `frontend/src/utils/appRefresh.ts` | 0 | 3 | 0 | 6 |
| 457 | `frontend/src/utils/bulkOps.ts` | 0 | 1 | 0 | 8 |
| 458 | `frontend/src/utils/color.ts` | 0 | 1 | 0 | 2 |
| 459 | `frontend/src/utils/csv.ts` | 0 | 8 | 0 | 14 |
| 460 | `frontend/src/utils/csvExportWorker.ts` | 1 | 0 | 1 | 0 |
| 461 | `frontend/src/utils/csvImport.ts` | 1 | 11 | 1 | 3 |
| 462 | `frontend/src/utils/csvRowCounter.ts` | 0 | 1 | 0 | 9 |
| 463 | `frontend/src/utils/csvTemplate.ts` | 1 | 1 | 1 | 3 |
| 464 | `frontend/src/utils/dateHelpers.ts` | 0 | 2 | 0 | 2 |
| 465 | `frontend/src/utils/deviceInfo.ts` | 0 | 2 | 0 | 21 |
| 466 | `frontend/src/utils/exportPackage.ts` | 1 | 2 | 1 | 3 |
| 467 | `frontend/src/utils/exportReports.tsx` | 4 | 1 | 2 | 2 |
| 468 | `frontend/src/utils/favicon.ts` | 0 | 1 | 0 | 3 |
| 469 | `frontend/src/utils/formatters.ts` | 0 | 4 | 0 | 17 |
| 470 | `frontend/src/utils/groupedRecords.ts` | 1 | 8 | 1 | 10 |
| 471 | `frontend/src/utils/historyHelpers.ts` | 0 | 3 | 0 | 11 |
| 472 | `frontend/src/utils/importJobRefresh.ts` | 0 | 3 | 0 | 1 |
| 473 | `frontend/src/utils/index.ts` | 0 | 0 | 0 | 0 |
| 474 | `frontend/src/utils/initials.ts` | 0 | 7 | 0 | 8 |
| 475 | `frontend/src/utils/loaders.ts` | 0 | 9 | 0 | 20 |
| 476 | `frontend/src/utils/mediaUpload.ts` | 2 | 1 | 2 | 5 |
| 477 | `frontend/src/utils/mediaUploadState.ts` | 0 | 4 | 0 | 2 |
| 478 | `frontend/src/utils/permissions.ts` | 0 | 1 | 0 | 2 |
| 479 | `frontend/src/utils/pricing.ts` | 0 | 8 | 0 | 18 |
| 480 | `frontend/src/utils/printReceipt.ts` | 1 | 12 | 1 | 2 |
| 481 | `frontend/src/utils/productBatches.ts` | 0 | 2 | 0 | 5 |
| 482 | `frontend/src/utils/productGrouping.ts` | 1 | 4 | 1 | 4 |
| 483 | `frontend/src/utils/publicAssetUrls.ts` | 1 | 2 | 1 | 7 |
| 484 | `frontend/src/utils/receiptAppliedConfig.ts` | 1 | 9 | 1 | 3 |
| 485 | `frontend/src/utils/scriptTypography.ts` | 0 | 3 | 0 | 6 |
| 486 | `frontend/src/utils/settingsRefresh.ts` | 1 | 3 | 1 | 1 |
| 487 | `frontend/src/utils/settingsWriteOptions.ts` | 1 | 1 | 1 | 1 |
| 488 | `frontend/src/web-api.ts` | 20 | 0 | 20 | 1 |
| 489 | `frontend/tailwind.config.ts` | 1 | 0 | 0 | 0 |
| 490 | `frontend/tests/actionGuards.test.ts` | 1 | 0 | 0 | 0 |
| 491 | `frontend/tests/actionStability.test.ts` | 4 | 0 | 0 | 0 |
| 492 | `frontend/tests/adminShellMediaGuards.test.ts` | 2 | 0 | 0 | 0 |
| 493 | `frontend/tests/apiHttp.test.ts` | 15 | 0 | 13 | 0 |
| 494 | `frontend/tests/appRefresh.test.ts` | 2 | 0 | 1 | 0 |
| 495 | `frontend/tests/appShellUtils.test.ts` | 3 | 0 | 1 | 0 |
| 496 | `frontend/tests/assetCompression.test.ts` | 4 | 0 | 0 | 0 |
| 497 | `frontend/tests/backupJobs.test.ts` | 2 | 0 | 0 | 0 |
| 498 | `frontend/tests/barcodeImageScanner.test.ts` | 2 | 0 | 1 | 0 |
| 499 | `frontend/tests/barcodeScannerState.test.ts` | 2 | 0 | 1 | 0 |
| 500 | `frontend/tests/bulkOps.test.ts` | 2 | 0 | 1 | 0 |
| 501 | `frontend/tests/contactImportWorker.test.ts` | 3 | 0 | 1 | 0 |
| 502 | `frontend/tests/csvImport.test.ts` | 3 | 0 | 1 | 0 |
| 503 | `frontend/tests/dashboardDataReliability.test.ts` | 2 | 0 | 0 | 0 |
| 504 | `frontend/tests/dateHelpers.test.ts` | 2 | 0 | 1 | 0 |
| 505 | `frontend/tests/deviceInfo.test.ts` | 2 | 0 | 1 | 0 |
| 506 | `frontend/tests/exportPackages.test.ts` | 4 | 0 | 2 | 0 |
| 507 | `frontend/tests/formatters.test.ts` | 2 | 0 | 1 | 0 |
| 508 | `frontend/tests/globalScroll.test.ts` | 2 | 0 | 0 | 0 |
| 509 | `frontend/tests/globalScrollControls.test.ts` | 2 | 0 | 1 | 0 |
| 510 | `frontend/tests/groupedRecords.test.ts` | 2 | 0 | 1 | 0 |
| 511 | `frontend/tests/historyHelpers.test.ts` | 1 | 0 | 0 | 0 |
| 512 | `frontend/tests/importJobRefresh.test.ts` | 1 | 0 | 0 | 0 |
| 513 | `frontend/tests/initials.test.ts` | 1 | 0 | 0 | 0 |
| 514 | `frontend/tests/inventoryImportWorker.test.ts` | 3 | 0 | 1 | 0 |
| 515 | `frontend/tests/inventoryMobileCardLayout.test.ts` | 2 | 0 | 0 | 0 |
| 516 | `frontend/tests/inventoryMovementGroups.test.ts` | 2 | 0 | 1 | 0 |
| 517 | `frontend/tests/inventoryRfidSection.test.ts` | 2 | 0 | 0 | 0 |
| 518 | `frontend/tests/loaders.test.ts` | 1 | 0 | 0 | 0 |
| 519 | `frontend/tests/mediaUploadHelpers.test.ts` | 2 | 0 | 1 | 0 |
| 520 | `frontend/tests/navigationConfig.test.ts` | 2 | 0 | 1 | 0 |
| 521 | `frontend/tests/notificationBadge.test.ts` | 2 | 0 | 0 | 0 |
| 522 | `frontend/tests/offlineSalesQueue.test.ts` | 2 | 0 | 0 | 0 |
| 523 | `frontend/tests/offlineSecurityHardening.test.ts` | 2 | 0 | 0 | 0 |
| 524 | `frontend/tests/offlineSyncArchitecture.test.ts` | 2 | 0 | 0 | 0 |
| 525 | `frontend/tests/ownedGoogleAuth.test.ts` | 2 | 0 | 0 | 0 |
| 526 | `frontend/tests/performanceLoadingUx.test.ts` | 2 | 0 | 0 | 0 |
| 527 | `frontend/tests/permissionEditor.test.ts` | 2 | 0 | 0 | 0 |
| 528 | `frontend/tests/permissions.test.ts` | 2 | 0 | 1 | 0 |
| 529 | `frontend/tests/portalCatalogDisplay.test.ts` | 2 | 0 | 0 | 0 |
| 530 | `frontend/tests/portalContentI18n.test.ts` | 1 | 0 | 0 | 0 |
| 531 | `frontend/tests/portalEditorUtils.test.ts` | 1 | 0 | 0 | 0 |
| 532 | `frontend/tests/portalFaqVocabulary.test.ts` | 1 | 0 | 0 | 0 |
| 533 | `frontend/tests/portalLanguagePacks.test.ts` | 1 | 0 | 0 | 0 |
| 534 | `frontend/tests/portalTranslateController.test.ts` | 1 | 0 | 0 | 0 |
| 535 | `frontend/tests/posCore.test.ts` | 1 | 0 | 0 | 0 |
| 536 | `frontend/tests/pricingContacts.test.ts` | 3 | 0 | 1 | 0 |
| 537 | `frontend/tests/productBatches.test.ts` | 2 | 0 | 1 | 0 |
| 538 | `frontend/tests/productDiscountUx.test.ts` | 2 | 0 | 0 | 0 |
| 539 | `frontend/tests/productDisplayHelpers.test.ts` | 1 | 0 | 0 | 0 |
| 540 | `frontend/tests/productFilterHelpers.test.ts` | 2 | 0 | 1 | 0 |
| 541 | `frontend/tests/productGalleryHelpers.test.ts` | 1 | 0 | 0 | 0 |
| 542 | `frontend/tests/productGrouping.test.ts` | 2 | 0 | 1 | 0 |
| 543 | `frontend/tests/productGroupViewHelpers.test.ts` | 1 | 0 | 0 | 0 |
| 544 | `frontend/tests/productHistoryHelpers.test.ts` | 2 | 0 | 1 | 0 |
| 545 | `frontend/tests/productImportPlanner.test.ts` | 3 | 0 | 1 | 0 |
| 546 | `frontend/tests/productImportWorkerFallback.test.ts` | 3 | 0 | 1 | 0 |
| 547 | `frontend/tests/productMenuHelpers.test.ts` | 1 | 0 | 0 | 0 |
| 548 | `frontend/tests/productPageHelpers.test.ts` | 1 | 0 | 0 | 0 |
| 549 | `frontend/tests/productSearchPagination.test.ts` | 2 | 0 | 0 | 0 |
| 550 | `frontend/tests/productSelectionHelpers.test.ts` | 1 | 0 | 0 | 0 |
| 551 | `frontend/tests/productWriteHelpers.test.ts` | 1 | 0 | 0 | 0 |
| 552 | `frontend/tests/publicErrorRecovery.test.ts` | 1 | 0 | 0 | 0 |
| 553 | `frontend/tests/receiptSettingsSync.test.ts` | 2 | 0 | 0 | 0 |
| 554 | `frontend/tests/receiptTemplate.test.ts` | 4 | 0 | 2 | 0 |
| 555 | `frontend/tests/returnsLayout.test.ts` | 2 | 0 | 0 | 0 |
| 556 | `frontend/tests/runtimeErrorClassifier.test.ts` | 1 | 0 | 0 | 0 |
| 557 | `frontend/tests/salesImportWorker.test.ts` | 3 | 0 | 1 | 0 |
| 558 | `frontend/tests/scanbotScanner.test.ts` | 3 | 0 | 2 | 0 |
| 559 | `frontend/tests/scriptTypography.test.ts` | 2 | 0 | 1 | 0 |
| 560 | `frontend/tests/sectionNavigation.test.ts` | 2 | 0 | 0 | 0 |
| 561 | `frontend/tests/settingsConflictHelpers.test.ts` | 2 | 0 | 1 | 0 |
| 562 | `frontend/tests/settingsRefresh.test.ts` | 1 | 0 | 0 | 0 |
| 563 | `frontend/tests/sourceSyntaxCheck.ts` | 5 | 0 | 0 | 0 |
| 564 | `frontend/tests/storagePolicy.test.ts` | 1 | 0 | 0 | 0 |
| 565 | `frontend/tests/utilsSettingsBarrel.test.ts` | 2 | 0 | 0 | 0 |
| 566 | `frontend/vite.config.ts` | 8 | 1 | 0 | 0 |
| 567 | `ops/scripts/architecture/generated-bulk-audit.ts` | 4 | 0 | 2 | 0 |
| 568 | `ops/scripts/architecture/language-runtime-audit.ts` | 4 | 0 | 2 | 0 |
| 569 | `ops/scripts/architecture/organization-audit.ts` | 4 | 0 | 2 | 0 |
| 570 | `ops/scripts/architecture/phase29-audit.ts` | 5 | 0 | 2 | 0 |
| 571 | `ops/scripts/architecture/runtime-js-inventory.ts` | 4 | 0 | 2 | 0 |
| 572 | `ops/scripts/backend/build-package-stage.ts` | 2 | 0 | 0 | 0 |
| 573 | `ops/scripts/backend/build-server-entry.ts` | 4 | 0 | 0 | 0 |
| 574 | `ops/scripts/backend/schema-audit.ts` | 2 | 0 | 0 | 0 |
| 575 | `ops/scripts/backend/schema-primary-key-preflight.ts` | 3 | 0 | 0 | 0 |
| 576 | `ops/scripts/backend/verify-data-integrity.ts` | 3 | 0 | 0 | 0 |
| 577 | `ops/scripts/frontend/build-public-runtime-scripts.ts` | 3 | 0 | 0 | 0 |
| 578 | `ops/scripts/frontend/verify-i18n.ts` | 2 | 0 | 1 | 0 |
| 579 | `ops/scripts/frontend/verify-performance.ts` | 3 | 0 | 0 | 0 |
| 580 | `ops/scripts/frontend/verify-ui.ts` | 3 | 0 | 1 | 0 |
| 581 | `ops/scripts/lib/fs-utils.ts` | 2 | 1 | 0 | 14 |
| 582 | `ops/scripts/lib/report-utils.ts` | 1 | 1 | 0 | 6 |
| 583 | `ops/scripts/runtime/audits/action-history-undo-redo-check.ts` | 5 | 0 | 1 | 0 |
| 584 | `ops/scripts/runtime/audits/audit-auth.ts` | 0 | 4 | 0 | 33 |
| 585 | `ops/scripts/runtime/audits/audit-manifest.ts` | 0 | 7 | 0 | 5 |
| 586 | `ops/scripts/runtime/audits/audit-report-html.ts` | 4 | 3 | 1 | 3 |
| 587 | `ops/scripts/runtime/audits/deep-live-audit.ts` | 9 | 0 | 3 | 0 |
| 588 | `ops/scripts/runtime/audits/full-app-audit.ts` | 9 | 0 | 3 | 0 |
| 589 | `ops/scripts/runtime/browser-action-smoke.ts` | 8 | 0 | 3 | 0 |
| 590 | `ops/scripts/runtime/build-ecosystem-config.ts` | 3 | 0 | 0 | 0 |
| 591 | `ops/scripts/runtime/cloudflare/rotate-cloudflare-tunnel-token.ts` | 4 | 0 | 0 | 0 |
| 592 | `ops/scripts/runtime/cloudflare/update-cloudflare-tunnel-origin.ts` | 3 | 0 | 0 | 0 |
| 593 | `ops/scripts/runtime/cloudflare/verify-cloudflare-automation.ts` | 4 | 0 | 1 | 0 |
| 594 | `ops/scripts/runtime/cloudflare/verify-r2-object-store.ts` | 4 | 0 | 0 | 0 |
| 595 | `ops/scripts/runtime/cloudflare/warm-cloudflare-startup-assets.ts` | 3 | 0 | 0 | 0 |
| 596 | `ops/scripts/runtime/live-checks/all-pages-control-audit.ts` | 7 | 0 | 2 | 0 |
| 597 | `ops/scripts/runtime/live-checks/filter-burst-check.ts` | 5 | 0 | 1 | 0 |
| 598 | `ops/scripts/runtime/live-checks/live-check-utils.ts` | 0 | 7 | 0 | 27 |
| 599 | `ops/scripts/runtime/live-checks/move766-product-write-live-check.ts` | 6 | 0 | 2 | 0 |
| 600 | `ops/scripts/runtime/live-checks/phase84-account-loyalty-select-live-check.ts` | 6 | 0 | 2 | 0 |
| 601 | `ops/scripts/runtime/live-checks/phase84-branches-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 602 | `ops/scripts/runtime/live-checks/phase84-catalog-editor-select-live-check.ts` | 6 | 0 | 2 | 0 |
| 603 | `ops/scripts/runtime/live-checks/phase84-contacts-live-check.ts` | 6 | 0 | 2 | 0 |
| 604 | `ops/scripts/runtime/live-checks/phase84-files-providers-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 605 | `ops/scripts/runtime/live-checks/phase84-filter-menu-live-check.ts` | 6 | 0 | 2 | 0 |
| 606 | `ops/scripts/runtime/live-checks/phase84-inventory-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 607 | `ops/scripts/runtime/live-checks/phase84-inventory-section-restore-live-check.ts` | 6 | 0 | 2 | 0 |
| 608 | `ops/scripts/runtime/live-checks/phase84-live-suite.ts` | 4 | 0 | 0 | 0 |
| 609 | `ops/scripts/runtime/live-checks/phase84-loyalty-points-rollback-check.ts` | 6 | 0 | 2 | 0 |
| 610 | `ops/scripts/runtime/live-checks/phase84-product-brands-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 611 | `ops/scripts/runtime/live-checks/phase84-product-categories-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 612 | `ops/scripts/runtime/live-checks/phase84-product-form-dropdown-live-check.ts` | 6 | 0 | 2 | 0 |
| 613 | `ops/scripts/runtime/live-checks/phase84-product-page-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 614 | `ops/scripts/runtime/live-checks/phase84-product-scanning-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 615 | `ops/scripts/runtime/live-checks/phase84-product-stock-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 616 | `ops/scripts/runtime/live-checks/phase84-product-units-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 617 | `ops/scripts/runtime/live-checks/phase84-product-variant-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 618 | `ops/scripts/runtime/live-checks/phase84-public-assistant-select-live-check.ts` | 5 | 0 | 1 | 0 |
| 619 | `ops/scripts/runtime/live-checks/phase84-public-portal-cloudflare-check.ts` | 4 | 0 | 0 | 0 |
| 620 | `ops/scripts/runtime/live-checks/phase84-receipt-export-layout-check.ts` | 6 | 0 | 2 | 0 |
| 621 | `ops/scripts/runtime/live-checks/phase84-receipt-settings-rollback-check.ts` | 7 | 0 | 3 | 0 |
| 622 | `ops/scripts/runtime/live-checks/phase84-sales-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 623 | `ops/scripts/runtime/live-checks/phase84-settings-save-rollback-check.ts` | 6 | 0 | 2 | 0 |
| 624 | `ops/scripts/runtime/live-checks/phase84-settings-select-live-check.ts` | 6 | 0 | 2 | 0 |
| 625 | `ops/scripts/runtime/live-checks/phase84-shared-select-live-check.ts` | 6 | 0 | 2 | 0 |
| 626 | `ops/scripts/runtime/live-checks/phase84-ui-live-check.ts` | 6 | 0 | 2 | 0 |
| 627 | `ops/scripts/runtime/live-checks/phase84-users-actions-live-check.ts` | 6 | 0 | 2 | 0 |
| 628 | `ops/scripts/runtime/live-checks/route-load-trace.ts` | 7 | 0 | 2 | 0 |
| 629 | `ops/scripts/runtime/smoke/check-public-url.ts` | 2 | 0 | 0 | 0 |
| 630 | `ops/scripts/runtime/smoke/check-route-contract.ts` | 0 | 0 | 0 | 0 |
| 631 | `ops/scripts/runtime/smoke/live-smoke.ts` | 5 | 0 | 0 | 0 |
| 632 | `ops/scripts/runtime/smoke/post-start-diagnostics.ts` | 2 | 0 | 0 | 0 |
| 633 | `ops/scripts/runtime/storage/cleanup-integrity-backlog.ts` | 3 | 0 | 0 | 0 |
| 634 | `ops/scripts/runtime/storage/cleanup-test-data.ts` | 3 | 0 | 0 | 0 |
| 635 | `ops/scripts/runtime/storage/dataset-readiness.ts` | 3 | 0 | 0 | 0 |
| 636 | `ops/scripts/runtime/storage/post-live-hygiene.ts` | 3 | 0 | 0 | 0 |
| 637 | `ops/scripts/runtime/storage/prune-storage.ts` | 4 | 0 | 0 | 0 |
| 638 | `ops/scripts/runtime/storage/restore-candidates.ts` | 2 | 0 | 0 | 0 |
| 639 | `ops/scripts/runtime/storage/restore-rehearsal.ts` | 3 | 0 | 0 | 0 |
| 640 | `ops/scripts/verification/verify-backup-reliability.ts` | 3 | 0 | 1 | 0 |
| 641 | `ops/scripts/verification/verify-docker-release.ts` | 3 | 0 | 1 | 0 |
| 642 | `ops/scripts/verification/verify-hardening-policy.ts` | 4 | 0 | 1 | 0 |
| 643 | `ops/scripts/verification/verify-runtime-deps.ts` | 3 | 0 | 1 | 0 |
| 644 | `ops/scripts/verification/verify-scale-services.ts` | 4 | 0 | 1 | 0 |
| 645 | `ops/scripts/verification/verify-secret-hygiene.ts` | 4 | 0 | 1 | 0 |

## 3. Detailed File Dependency Commentary

### 3.1 `backend/.pkg-stage/server.js`

- Declared exports: none detected
- Imports (47)
  - `./src/analytics/duckdbRuntime.js`
  - `./src/config/index.js`
  - `./src/database.js`
  - `./src/fileAssets.js`
  - `./src/helpers.js`
  - `./src/maintenanceLock.js`
  - `./src/middleware.js`
  - `./src/objectStore.js`
  - `./src/organizationContext/index.js`
  - `./src/productBatches.js`
  - `./src/requestContext.js`
  - `./src/routes/actionHistory.js`
  - `./src/routes/ai.js`
  - `./src/routes/auth.js`
  - `./src/routes/branches.js`
  - `./src/routes/catalog.js`
  - `./src/routes/categories.js`
  - `./src/routes/contacts.js`
  - `./src/routes/customTables.js`
  - `./src/routes/files.js`
  - `./src/routes/importJobs.js`
  - `./src/routes/inventory.js`
  - `./src/routes/notifications.js`
  - `./src/routes/organizations.js`
  - `./src/routes/portal.js`
  - `./src/routes/products.js`
  - `./src/routes/returns.js`
  - `./src/routes/runtime.js`
  - `./src/routes/sales.js`
  - `./src/routes/settings.js`
  - `./src/routes/sync.js`
  - `./src/routes/system/index.js`
  - `./src/routes/units.js`
  - `./src/routes/users.js`
  - `./src/runtimeVersion.js`
  - `./src/serverUtils.js`
  - `./src/services/importJobs.js`
  - `./src/websocket.js`
  - `./src/workers/importWorker.js`
  - `./src/workers/mediaWorker.js`
  - `compression`
  - `cors`
  - `express`
  - `fs`
  - `http`
  - `path`
  - `stream`
- Internal dependencies (40)
  - `backend/.pkg-stage/src/analytics/duckdbRuntime.js`
  - `backend/.pkg-stage/src/config/index.js`
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/fileAssets.js`
  - `backend/.pkg-stage/src/helpers.js`
  - `backend/.pkg-stage/src/maintenanceLock.js`
  - `backend/.pkg-stage/src/middleware.js`
  - `backend/.pkg-stage/src/objectStore.js`
  - `backend/.pkg-stage/src/organizationContext/index.js`
  - `backend/.pkg-stage/src/productBatches.js`
  - `backend/.pkg-stage/src/requestContext.js`
  - `backend/.pkg-stage/src/routes/actionHistory.js`
  - `backend/.pkg-stage/src/routes/ai.js`
  - `backend/.pkg-stage/src/routes/auth.js`
  - `backend/.pkg-stage/src/routes/branches.js`
  - `backend/.pkg-stage/src/routes/catalog.js`
  - `backend/.pkg-stage/src/routes/categories.js`
  - `backend/.pkg-stage/src/routes/contacts.js`
  - `backend/.pkg-stage/src/routes/customTables.js`
  - `backend/.pkg-stage/src/routes/files.js`
  - `backend/.pkg-stage/src/routes/importJobs.js`
  - `backend/.pkg-stage/src/routes/inventory.js`
  - `backend/.pkg-stage/src/routes/notifications.js`
  - `backend/.pkg-stage/src/routes/organizations.js`
  - `backend/.pkg-stage/src/routes/portal.js`
  - `backend/.pkg-stage/src/routes/products.js`
  - `backend/.pkg-stage/src/routes/returns.js`
  - `backend/.pkg-stage/src/routes/runtime.js`
  - `backend/.pkg-stage/src/routes/sales.js`
  - `backend/.pkg-stage/src/routes/settings.js`
  - `backend/.pkg-stage/src/routes/sync.js`
  - `backend/.pkg-stage/src/routes/system/index.js`
  - `backend/.pkg-stage/src/routes/units.js`
  - `backend/.pkg-stage/src/routes/users.js`
  - `backend/.pkg-stage/src/runtimeVersion.js`
  - `backend/.pkg-stage/src/serverUtils.js`
  - `backend/.pkg-stage/src/services/importJobs.js`
  - `backend/.pkg-stage/src/websocket.js`
  - `backend/.pkg-stage/src/workers/importWorker.js`
  - `backend/.pkg-stage/src/workers/mediaWorker.js`
- Referenced by (0)
  - none

### 3.2 `backend/.pkg-stage/src/accessControl.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./config/index.js`
- Internal dependencies (1)
  - `backend/.pkg-stage/src/config/index.js`
- Referenced by (3)
  - `backend/.pkg-stage/src/middleware.js`
  - `backend/.pkg-stage/src/routes/auth.js`
  - `backend/.pkg-stage/src/routes/system/index.js`

### 3.3 `backend/.pkg-stage/src/analytics/duckdbRuntime.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../config/index.js`
  - `path`
- Internal dependencies (1)
  - `backend/.pkg-stage/src/config/index.js`
- Referenced by (3)
  - `backend/.pkg-stage/server.js`
  - `backend/.pkg-stage/src/routes/system/index.js`
  - `backend/.pkg-stage/src/services/integrationDoctor.js`

### 3.4 `backend/.pkg-stage/src/authOtpGuards.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./middleware.js`
- Internal dependencies (1)
  - `backend/.pkg-stage/src/middleware.js`
- Referenced by (1)
  - `backend/.pkg-stage/src/routes/auth.js`

### 3.5 `backend/.pkg-stage/src/backupSchema.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/.pkg-stage/src/routes/system/index.js`
  - `backend/.pkg-stage/src/services/backupPackages.js`

### 3.6 `backend/.pkg-stage/src/businessMetrics.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./database.js`
- Internal dependencies (1)
  - `backend/.pkg-stage/src/database.js`
- Referenced by (5)
  - `backend/.pkg-stage/src/routes/branches.js`
  - `backend/.pkg-stage/src/routes/inventory.js`
  - `backend/.pkg-stage/src/routes/notifications.js`
  - `backend/.pkg-stage/src/routes/products.js`
  - `backend/.pkg-stage/src/routes/sales.js`

### 3.7 `backend/.pkg-stage/src/catalogTextIntegrity.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (7)
  - `backend/.pkg-stage/src/routes/categories.js`
  - `backend/.pkg-stage/src/routes/inventory.js`
  - `backend/.pkg-stage/src/routes/products.js`
  - `backend/.pkg-stage/src/routes/runtime.js`
  - `backend/.pkg-stage/src/routes/settings.js`
  - `backend/.pkg-stage/src/routes/units.js`
  - `backend/.pkg-stage/src/services/importJobs.js`

### 3.8 `backend/.pkg-stage/src/config/index.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../storage/organizationFolders.js`
  - `dotenv`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `backend/.pkg-stage/src/storage/organizationFolders.js`
- Referenced by (23)
  - `backend/.pkg-stage/server.js`
  - `backend/.pkg-stage/src/accessControl.js`
  - `backend/.pkg-stage/src/analytics/duckdbRuntime.js`
  - `backend/.pkg-stage/src/fileAssets.js`
  - `backend/.pkg-stage/src/middleware.js`
  - `backend/.pkg-stage/src/objectStore.js`
  - `backend/.pkg-stage/src/organizationContext/index.js`
  - `backend/.pkg-stage/src/postgresDatabase.js`
  - `backend/.pkg-stage/src/routes/auth.js`
  - `backend/.pkg-stage/src/routes/importJobs.js`
  - `backend/.pkg-stage/src/routes/products.js`
  - `backend/.pkg-stage/src/routes/sync.js`
  - `backend/.pkg-stage/src/routes/system/index.js`
  - `backend/.pkg-stage/src/runtimeCache.js`
  - `backend/.pkg-stage/src/runtimeState/index.js`
  - `backend/.pkg-stage/src/serverUtils.js`
  - `backend/.pkg-stage/src/services/backupPackages.js`
  - `backend/.pkg-stage/src/services/googleDriveSync/index.js`
  - `backend/.pkg-stage/src/services/googleOauth.js`
  - `backend/.pkg-stage/src/services/importJobs.js`
  - `backend/.pkg-stage/src/services/integrationDoctor.js`
  - `backend/.pkg-stage/src/services/mediaQueue.js`
  - `backend/.pkg-stage/src/settingsSnapshot.js`

### 3.9 `backend/.pkg-stage/src/conflictControl.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (12)
  - `backend/.pkg-stage/src/routes/ai.js`
  - `backend/.pkg-stage/src/routes/branches.js`
  - `backend/.pkg-stage/src/routes/categories.js`
  - `backend/.pkg-stage/src/routes/contacts.js`
  - `backend/.pkg-stage/src/routes/customTables.js`
  - `backend/.pkg-stage/src/routes/files.js`
  - `backend/.pkg-stage/src/routes/products.js`
  - `backend/.pkg-stage/src/routes/returns.js`
  - `backend/.pkg-stage/src/routes/sales.js`
  - `backend/.pkg-stage/src/routes/settings.js`
  - `backend/.pkg-stage/src/routes/units.js`
  - `backend/.pkg-stage/src/routes/users.js`

### 3.10 `backend/.pkg-stage/src/contactOptions.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/.pkg-stage/src/routes/contacts.js`
  - `backend/.pkg-stage/src/services/importJobs.js`

### 3.11 `backend/.pkg-stage/src/database.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./postgresDatabase.js`
- Internal dependencies (1)
  - `backend/.pkg-stage/src/postgresDatabase.js`
- Referenced by (37)
  - `backend/.pkg-stage/server.js`
  - `backend/.pkg-stage/src/businessMetrics.js`
  - `backend/.pkg-stage/src/fileAssets.js`
  - `backend/.pkg-stage/src/helpers.js`
  - `backend/.pkg-stage/src/organizationContext/index.js`
  - `backend/.pkg-stage/src/productBatches.js`
  - `backend/.pkg-stage/src/routes/actionHistory.js`
  - `backend/.pkg-stage/src/routes/ai.js`
  - `backend/.pkg-stage/src/routes/auth.js`
  - `backend/.pkg-stage/src/routes/branches.js`
  - `backend/.pkg-stage/src/routes/catalog.js`
  - `backend/.pkg-stage/src/routes/categories.js`
  - `backend/.pkg-stage/src/routes/contacts.js`
  - `backend/.pkg-stage/src/routes/customTables.js`
  - `backend/.pkg-stage/src/routes/inventory.js`
  - `backend/.pkg-stage/src/routes/notifications.js`
  - `backend/.pkg-stage/src/routes/portal.js`
  - `backend/.pkg-stage/src/routes/products.js`
  - `backend/.pkg-stage/src/routes/returns.js`
  - `backend/.pkg-stage/src/routes/runtime.js`
  - `backend/.pkg-stage/src/routes/sales.js`
  - `backend/.pkg-stage/src/routes/settings.js`
  - `backend/.pkg-stage/src/routes/system/index.js`
  - `backend/.pkg-stage/src/routes/units.js`
  - `backend/.pkg-stage/src/routes/users.js`
  - `backend/.pkg-stage/src/schemaMetadata.js`
  - `backend/.pkg-stage/src/services/backupPackages.js`
  - `backend/.pkg-stage/src/services/googleDriveSync/index.js`
  - `backend/.pkg-stage/src/services/importJobs.js`
  - `backend/.pkg-stage/src/services/integrationDoctor.js`
  - `backend/.pkg-stage/src/services/mediaQueue.js`
  - `backend/.pkg-stage/src/services/portalAi.js`
  - `backend/.pkg-stage/src/services/verification.js`
  - `backend/.pkg-stage/src/sessionAuth.js`
  - `backend/.pkg-stage/src/systemJobs.js`
  - `backend/.pkg-stage/src/workers/importWorker.js`
  - `backend/.pkg-stage/src/workers/mediaWorker.js`

### 3.12 `backend/.pkg-stage/src/dataPath/index.js`

- Declared exports: `module.exports`
- Imports (2)
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `backend/.pkg-stage/src/organizationContext/index.js`
  - `backend/.pkg-stage/src/routes/system/index.js`
  - `backend/.pkg-stage/src/services/googleDriveSync/index.js`
  - `backend/.pkg-stage/src/systemFsWorker.js`

### 3.13 `backend/.pkg-stage/src/db/cutoverReadiness.js`

- Declared exports: `module.exports`
- Imports (2)
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `backend/.pkg-stage/src/routes/system/index.js`

### 3.14 `backend/.pkg-stage/src/db/postgresQueryCompat.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `backend/.pkg-stage/src/postgresDatabase.js`

### 3.15 `backend/.pkg-stage/src/fileAssets.js`

- Declared exports: `module.exports`
- Imports (12)
  - `./config/index.js`
  - `./database.js`
  - `./objectStore.js`
  - `./optionalSharp.js`
  - `./settingsSnapshot.js`
  - `./uploadReferenceCleanup.js`
  - `./uploadSecurity.js`
  - `child_process`
  - `crypto`
  - `fs`
  - `path`
  - `stream/promises`
- Internal dependencies (7)
  - `backend/.pkg-stage/src/config/index.js`
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/objectStore.js`
  - `backend/.pkg-stage/src/optionalSharp.js`
  - `backend/.pkg-stage/src/settingsSnapshot.js`
  - `backend/.pkg-stage/src/uploadReferenceCleanup.js`
  - `backend/.pkg-stage/src/uploadSecurity.js`
- Referenced by (11)
  - `backend/.pkg-stage/server.js`
  - `backend/.pkg-stage/src/middleware.js`
  - `backend/.pkg-stage/src/routes/files.js`
  - `backend/.pkg-stage/src/routes/importJobs.js`
  - `backend/.pkg-stage/src/routes/portal.js`
  - `backend/.pkg-stage/src/routes/products.js`
  - `backend/.pkg-stage/src/routes/settings.js`
  - `backend/.pkg-stage/src/routes/system/index.js`
  - `backend/.pkg-stage/src/routes/users.js`
  - `backend/.pkg-stage/src/services/importJobs.js`
  - `backend/.pkg-stage/src/services/mediaQueue.js`

### 3.16 `backend/.pkg-stage/src/helpers.js`

- Declared exports: `module.exports`
- Imports (4)
  - `./database.js`
  - `./requestContext.js`
  - `./runtimeCache.js`
  - `./services/googleDriveSync/index.js`
- Internal dependencies (4)
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/requestContext.js`
  - `backend/.pkg-stage/src/runtimeCache.js`
  - `backend/.pkg-stage/src/services/googleDriveSync/index.js`
- Referenced by (23)
  - `backend/.pkg-stage/server.js`
  - `backend/.pkg-stage/src/routes/actionHistory.js`
  - `backend/.pkg-stage/src/routes/ai.js`
  - `backend/.pkg-stage/src/routes/auth.js`
  - `backend/.pkg-stage/src/routes/branches.js`
  - `backend/.pkg-stage/src/routes/catalog.js`
  - `backend/.pkg-stage/src/routes/categories.js`
  - `backend/.pkg-stage/src/routes/contacts.js`
  - `backend/.pkg-stage/src/routes/customTables.js`
  - `backend/.pkg-stage/src/routes/files.js`
  - `backend/.pkg-stage/src/routes/importJobs.js`
  - `backend/.pkg-stage/src/routes/inventory.js`
  - `backend/.pkg-stage/src/routes/portal.js`
  - `backend/.pkg-stage/src/routes/products.js`
  - `backend/.pkg-stage/src/routes/returns.js`
  - `backend/.pkg-stage/src/routes/runtime.js`
  - `backend/.pkg-stage/src/routes/sales.js`
  - `backend/.pkg-stage/src/routes/settings.js`
  - `backend/.pkg-stage/src/routes/system/index.js`
  - `backend/.pkg-stage/src/routes/units.js`
  - `backend/.pkg-stage/src/routes/users.js`
  - `backend/.pkg-stage/src/services/importJobs.js`
  - `backend/.pkg-stage/src/websocket.js`

### 3.17 `backend/.pkg-stage/src/idempotency.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `backend/.pkg-stage/src/routes/inventory.js`
  - `backend/.pkg-stage/src/routes/products.js`
  - `backend/.pkg-stage/src/routes/returns.js`
  - `backend/.pkg-stage/src/routes/sales.js`

### 3.18 `backend/.pkg-stage/src/importCsv.js`

- Declared exports: `module.exports`
- Imports (1)
  - `fs`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `backend/.pkg-stage/src/services/importJobs.js`

### 3.19 `backend/.pkg-stage/src/importParsing.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./money.js`
- Internal dependencies (1)
  - `backend/.pkg-stage/src/money.js`
- Referenced by (1)
  - `backend/.pkg-stage/src/productImportPolicies.js`

### 3.20 `backend/.pkg-stage/src/initials.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `backend/.pkg-stage/src/routes/inventory.js`
  - `backend/.pkg-stage/src/routes/portal.js`
  - `backend/.pkg-stage/src/routes/products.js`

### 3.21 `backend/.pkg-stage/src/maintenanceLock.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `backend/.pkg-stage/server.js`
  - `backend/.pkg-stage/src/routes/system/index.js`
  - `backend/.pkg-stage/src/services/googleDriveSync/index.js`

### 3.22 `backend/.pkg-stage/src/middleware.js`

- Declared exports: `module.exports`
- Imports (10)
  - `./accessControl.js`
  - `./config/index.js`
  - `./fileAssets.js`
  - `./permissions.js`
  - `./security.js`
  - `./sessionAuth.js`
  - `./uploadSecurity.js`
  - `fs`
  - `multer`
  - `path`
- Internal dependencies (7)
  - `backend/.pkg-stage/src/accessControl.js`
  - `backend/.pkg-stage/src/config/index.js`
  - `backend/.pkg-stage/src/fileAssets.js`
  - `backend/.pkg-stage/src/permissions.js`
  - `backend/.pkg-stage/src/security.js`
  - `backend/.pkg-stage/src/sessionAuth.js`
  - `backend/.pkg-stage/src/uploadSecurity.js`
- Referenced by (24)
  - `backend/.pkg-stage/server.js`
  - `backend/.pkg-stage/src/authOtpGuards.js`
  - `backend/.pkg-stage/src/routes/actionHistory.js`
  - `backend/.pkg-stage/src/routes/ai.js`
  - `backend/.pkg-stage/src/routes/auth.js`
  - `backend/.pkg-stage/src/routes/branches.js`
  - `backend/.pkg-stage/src/routes/categories.js`
  - `backend/.pkg-stage/src/routes/contacts.js`
  - `backend/.pkg-stage/src/routes/customTables.js`
  - `backend/.pkg-stage/src/routes/files.js`
  - `backend/.pkg-stage/src/routes/importJobs.js`
  - `backend/.pkg-stage/src/routes/inventory.js`
  - `backend/.pkg-stage/src/routes/notifications.js`
  - `backend/.pkg-stage/src/routes/organizations.js`
  - `backend/.pkg-stage/src/routes/portal.js`
  - `backend/.pkg-stage/src/routes/products.js`
  - `backend/.pkg-stage/src/routes/returns.js`
  - `backend/.pkg-stage/src/routes/runtime.js`
  - `backend/.pkg-stage/src/routes/sales.js`
  - `backend/.pkg-stage/src/routes/settings.js`
  - `backend/.pkg-stage/src/routes/sync.js`
  - `backend/.pkg-stage/src/routes/system/index.js`
  - `backend/.pkg-stage/src/routes/units.js`
  - `backend/.pkg-stage/src/routes/users.js`

### 3.23 `backend/.pkg-stage/src/money.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `backend/.pkg-stage/src/importParsing.js`
  - `backend/.pkg-stage/src/productDiscounts.js`
  - `backend/.pkg-stage/src/routes/inventory.js`
  - `backend/.pkg-stage/src/routes/products.js`
  - `backend/.pkg-stage/src/services/importJobs.js`

### 3.24 `backend/.pkg-stage/src/netSecurity.js`

- Declared exports: `module.exports`
- Imports (1)
  - `net`
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `backend/.pkg-stage/src/routes/portal.js`
  - `backend/.pkg-stage/src/routes/products.js`
  - `backend/.pkg-stage/src/services/aiGateway.js`
  - `backend/.pkg-stage/src/services/importJobs.js`

### 3.25 `backend/.pkg-stage/src/objectStore.js`

- Declared exports: `module.exports`
- Imports (7)
  - `./config/index.js`
  - `@aws-sdk/client-s3`
  - `@smithy/node-http-handler`
  - `fs`
  - `http`
  - `https`
  - `stream`
- Internal dependencies (1)
  - `backend/.pkg-stage/src/config/index.js`
- Referenced by (6)
  - `backend/.pkg-stage/server.js`
  - `backend/.pkg-stage/src/fileAssets.js`
  - `backend/.pkg-stage/src/routes/system/index.js`
  - `backend/.pkg-stage/src/services/backupPackages.js`
  - `backend/.pkg-stage/src/services/integrationDoctor.js`
  - `backend/.pkg-stage/src/settingsSnapshot.js`

### 3.26 `backend/.pkg-stage/src/optionalSharp.js`

- Declared exports: `module.exports`
- Imports (1)
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/.pkg-stage/src/fileAssets.js`
  - `backend/.pkg-stage/src/uploadSecurity.js`

### 3.27 `backend/.pkg-stage/src/organizationContext/index.js`

- Declared exports: `module.exports`
- Imports (7)
  - `../config/index.js`
  - `../dataPath/index.js`
  - `../database.js`
  - `../storage/organizationFolders.js`
  - `crypto`
  - `fs`
  - `path`
- Internal dependencies (4)
  - `backend/.pkg-stage/src/config/index.js`
  - `backend/.pkg-stage/src/dataPath/index.js`
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/storage/organizationFolders.js`
- Referenced by (6)
  - `backend/.pkg-stage/server.js`
  - `backend/.pkg-stage/src/routes/auth.js`
  - `backend/.pkg-stage/src/routes/organizations.js`
  - `backend/.pkg-stage/src/routes/portal.js`
  - `backend/.pkg-stage/src/routes/system/index.js`
  - `backend/.pkg-stage/src/routes/users.js`

### 3.28 `backend/.pkg-stage/src/permissions.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `backend/.pkg-stage/src/middleware.js`
  - `backend/.pkg-stage/src/postgresDatabase.js`
  - `backend/.pkg-stage/src/routes/actionHistory.js`

### 3.29 `backend/.pkg-stage/src/portalUtils.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `backend/.pkg-stage/src/routes/portal.js`

### 3.30 `backend/.pkg-stage/src/postgresDatabase.js`

- Declared exports: `module.exports`
- Imports (7)
  - `./config/index.js`
  - `./db/postgresQueryCompat.js`
  - `./permissions.js`
  - `bcryptjs`
  - `fs`
  - `path`
  - `pg-native`
- Internal dependencies (3)
  - `backend/.pkg-stage/src/config/index.js`
  - `backend/.pkg-stage/src/db/postgresQueryCompat.js`
  - `backend/.pkg-stage/src/permissions.js`
- Referenced by (1)
  - `backend/.pkg-stage/src/database.js`

### 3.31 `backend/.pkg-stage/src/productBatches.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./database.js`
- Internal dependencies (1)
  - `backend/.pkg-stage/src/database.js`
- Referenced by (6)
  - `backend/.pkg-stage/server.js`
  - `backend/.pkg-stage/src/routes/inventory.js`
  - `backend/.pkg-stage/src/routes/products.js`
  - `backend/.pkg-stage/src/routes/returns.js`
  - `backend/.pkg-stage/src/routes/sales.js`
  - `backend/.pkg-stage/src/services/importJobs.js`

### 3.32 `backend/.pkg-stage/src/productDiscounts.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./money.js`
- Internal dependencies (1)
  - `backend/.pkg-stage/src/money.js`
- Referenced by (3)
  - `backend/.pkg-stage/src/routes/inventory.js`
  - `backend/.pkg-stage/src/routes/products.js`
  - `backend/.pkg-stage/src/services/importJobs.js`

### 3.33 `backend/.pkg-stage/src/productImportPolicies.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./importParsing.js`
- Internal dependencies (1)
  - `backend/.pkg-stage/src/importParsing.js`
- Referenced by (2)
  - `backend/.pkg-stage/src/routes/products.js`
  - `backend/.pkg-stage/src/services/importJobs.js`

### 3.34 `backend/.pkg-stage/src/requestContext.js`

- Declared exports: `module.exports`
- Imports (1)
  - `async_hooks`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/.pkg-stage/server.js`
  - `backend/.pkg-stage/src/helpers.js`

### 3.35 `backend/.pkg-stage/src/routes/actionHistory.js`

- Declared exports: `module.exports`
- Imports (5)
  - `../database.js`
  - `../helpers.js`
  - `../middleware.js`
  - `../permissions.js`
  - `express`
- Internal dependencies (4)
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/helpers.js`
  - `backend/.pkg-stage/src/middleware.js`
  - `backend/.pkg-stage/src/permissions.js`
- Referenced by (1)
  - `backend/.pkg-stage/server.js`

### 3.36 `backend/.pkg-stage/src/routes/ai.js`

- Declared exports: `module.exports`
- Imports (6)
  - `../conflictControl.js`
  - `../database.js`
  - `../helpers.js`
  - `../middleware.js`
  - `../services/aiGateway.js`
  - `express`
- Internal dependencies (5)
  - `backend/.pkg-stage/src/conflictControl.js`
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/helpers.js`
  - `backend/.pkg-stage/src/middleware.js`
  - `backend/.pkg-stage/src/services/aiGateway.js`
- Referenced by (1)
  - `backend/.pkg-stage/server.js`

### 3.37 `backend/.pkg-stage/src/routes/auth.js`

- Declared exports: `module.exports`
- Imports (19)
  - `../accessControl.js`
  - `../authOtpGuards.js`
  - `../config/index.js`
  - `../database.js`
  - `../helpers.js`
  - `../middleware.js`
  - `../organizationContext/index.js`
  - `../runtimeState/index.js`
  - `../runtimeVersion.js`
  - `../security.js`
  - `../services/googleOauth.js`
  - `../services/verification.js`
  - `../sessionAuth.js`
  - `../settingsSnapshot.js`
  - `bcryptjs`
  - `crypto`
  - `express`
  - `qrcode`
  - `speakeasy`
- Internal dependencies (14)
  - `backend/.pkg-stage/src/accessControl.js`
  - `backend/.pkg-stage/src/authOtpGuards.js`
  - `backend/.pkg-stage/src/config/index.js`
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/helpers.js`
  - `backend/.pkg-stage/src/middleware.js`
  - `backend/.pkg-stage/src/organizationContext/index.js`
  - `backend/.pkg-stage/src/runtimeState/index.js`
  - `backend/.pkg-stage/src/runtimeVersion.js`
  - `backend/.pkg-stage/src/security.js`
  - `backend/.pkg-stage/src/services/googleOauth.js`
  - `backend/.pkg-stage/src/services/verification.js`
  - `backend/.pkg-stage/src/sessionAuth.js`
  - `backend/.pkg-stage/src/settingsSnapshot.js`
- Referenced by (1)
  - `backend/.pkg-stage/server.js`

### 3.38 `backend/.pkg-stage/src/routes/branches.js`

- Declared exports: `module.exports`
- Imports (8)
  - `../businessMetrics.js`
  - `../conflictControl.js`
  - `../database.js`
  - `../helpers.js`
  - `../middleware.js`
  - `../schemaMetadata.js`
  - `crypto`
  - `express`
- Internal dependencies (6)
  - `backend/.pkg-stage/src/businessMetrics.js`
  - `backend/.pkg-stage/src/conflictControl.js`
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/helpers.js`
  - `backend/.pkg-stage/src/middleware.js`
  - `backend/.pkg-stage/src/schemaMetadata.js`
- Referenced by (1)
  - `backend/.pkg-stage/server.js`

### 3.39 `backend/.pkg-stage/src/routes/catalog.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../database.js`
  - `../helpers.js`
  - `../settingsSnapshot.js`
  - `express`
- Internal dependencies (3)
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/helpers.js`
  - `backend/.pkg-stage/src/settingsSnapshot.js`
- Referenced by (1)
  - `backend/.pkg-stage/server.js`

### 3.40 `backend/.pkg-stage/src/routes/categories.js`

- Declared exports: `module.exports`
- Imports (6)
  - `../catalogTextIntegrity.js`
  - `../conflictControl.js`
  - `../database.js`
  - `../helpers.js`
  - `../middleware.js`
  - `express`
- Internal dependencies (5)
  - `backend/.pkg-stage/src/catalogTextIntegrity.js`
  - `backend/.pkg-stage/src/conflictControl.js`
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/helpers.js`
  - `backend/.pkg-stage/src/middleware.js`
- Referenced by (1)
  - `backend/.pkg-stage/server.js`

### 3.41 `backend/.pkg-stage/src/routes/contacts.js`

- Declared exports: `module.exports`
- Imports (6)
  - `../conflictControl.js`
  - `../contactOptions.js`
  - `../database.js`
  - `../helpers.js`
  - `../middleware.js`
  - `express`
- Internal dependencies (5)
  - `backend/.pkg-stage/src/conflictControl.js`
  - `backend/.pkg-stage/src/contactOptions.js`
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/helpers.js`
  - `backend/.pkg-stage/src/middleware.js`
- Referenced by (1)
  - `backend/.pkg-stage/server.js`

### 3.42 `backend/.pkg-stage/src/routes/customTables.js`

- Declared exports: `module.exports`
- Imports (6)
  - `../conflictControl.js`
  - `../database.js`
  - `../helpers.js`
  - `../middleware.js`
  - `../schemaMetadata.js`
  - `express`
- Internal dependencies (5)
  - `backend/.pkg-stage/src/conflictControl.js`
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/helpers.js`
  - `backend/.pkg-stage/src/middleware.js`
  - `backend/.pkg-stage/src/schemaMetadata.js`
- Referenced by (1)
  - `backend/.pkg-stage/server.js`

### 3.43 `backend/.pkg-stage/src/routes/files.js`

- Declared exports: `module.exports`
- Imports (6)
  - `../conflictControl.js`
  - `../fileAssets.js`
  - `../helpers.js`
  - `../middleware.js`
  - `../services/mediaQueue.js`
  - `express`
- Internal dependencies (5)
  - `backend/.pkg-stage/src/conflictControl.js`
  - `backend/.pkg-stage/src/fileAssets.js`
  - `backend/.pkg-stage/src/helpers.js`
  - `backend/.pkg-stage/src/middleware.js`
  - `backend/.pkg-stage/src/services/mediaQueue.js`
- Referenced by (1)
  - `backend/.pkg-stage/server.js`

### 3.44 `backend/.pkg-stage/src/routes/importJobs.js`

- Declared exports: `module.exports`
- Imports (9)
  - `../config/index.js`
  - `../fileAssets.js`
  - `../helpers.js`
  - `../middleware.js`
  - `../services/importJobs.js`
  - `express`
  - `fs`
  - `multer`
  - `path`
- Internal dependencies (5)
  - `backend/.pkg-stage/src/config/index.js`
  - `backend/.pkg-stage/src/fileAssets.js`
  - `backend/.pkg-stage/src/helpers.js`
  - `backend/.pkg-stage/src/middleware.js`
  - `backend/.pkg-stage/src/services/importJobs.js`
- Referenced by (1)
  - `backend/.pkg-stage/server.js`

### 3.45 `backend/.pkg-stage/src/routes/inventory.js`

- Declared exports: `module.exports`
- Imports (12)
  - `../businessMetrics.js`
  - `../catalogTextIntegrity.js`
  - `../database.js`
  - `../helpers.js`
  - `../idempotency.js`
  - `../initials.js`
  - `../middleware.js`
  - `../money.js`
  - `../productBatches.js`
  - `../productDiscounts.js`
  - `../schemaMetadata.js`
  - `express`
- Internal dependencies (11)
  - `backend/.pkg-stage/src/businessMetrics.js`
  - `backend/.pkg-stage/src/catalogTextIntegrity.js`
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/helpers.js`
  - `backend/.pkg-stage/src/idempotency.js`
  - `backend/.pkg-stage/src/initials.js`
  - `backend/.pkg-stage/src/middleware.js`
  - `backend/.pkg-stage/src/money.js`
  - `backend/.pkg-stage/src/productBatches.js`
  - `backend/.pkg-stage/src/productDiscounts.js`
  - `backend/.pkg-stage/src/schemaMetadata.js`
- Referenced by (1)
  - `backend/.pkg-stage/server.js`

### 3.46 `backend/.pkg-stage/src/routes/notifications.js`

- Declared exports: `module.exports`
- Imports (5)
  - `../businessMetrics.js`
  - `../database.js`
  - `../middleware.js`
  - `../services/googleDriveSync/index.js`
  - `express`
- Internal dependencies (4)
  - `backend/.pkg-stage/src/businessMetrics.js`
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/middleware.js`
  - `backend/.pkg-stage/src/services/googleDriveSync/index.js`
- Referenced by (1)
  - `backend/.pkg-stage/server.js`

### 3.47 `backend/.pkg-stage/src/routes/organizations.js`

- Declared exports: `module.exports`
- Imports (3)
  - `../middleware.js`
  - `../organizationContext/index.js`
  - `express`
- Internal dependencies (2)
  - `backend/.pkg-stage/src/middleware.js`
  - `backend/.pkg-stage/src/organizationContext/index.js`
- Referenced by (1)
  - `backend/.pkg-stage/server.js`

### 3.48 `backend/.pkg-stage/src/routes/portal.js`

- Declared exports: `module.exports`
- Imports (13)
  - `../database.js`
  - `../fileAssets.js`
  - `../helpers.js`
  - `../initials.js`
  - `../middleware.js`
  - `../netSecurity.js`
  - `../organizationContext/index.js`
  - `../portalUtils.js`
  - `../runtimeCache.js`
  - `../security.js`
  - `../services/portalAi.js`
  - `../settingsSnapshot.js`
  - `express`
- Internal dependencies (12)
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/fileAssets.js`
  - `backend/.pkg-stage/src/helpers.js`
  - `backend/.pkg-stage/src/initials.js`
  - `backend/.pkg-stage/src/middleware.js`
  - `backend/.pkg-stage/src/netSecurity.js`
  - `backend/.pkg-stage/src/organizationContext/index.js`
  - `backend/.pkg-stage/src/portalUtils.js`
  - `backend/.pkg-stage/src/runtimeCache.js`
  - `backend/.pkg-stage/src/security.js`
  - `backend/.pkg-stage/src/services/portalAi.js`
  - `backend/.pkg-stage/src/settingsSnapshot.js`
- Referenced by (1)
  - `backend/.pkg-stage/server.js`

### 3.49 `backend/.pkg-stage/src/routes/products.js`

- Declared exports: `module.exports`
- Imports (20)
  - `../businessMetrics.js`
  - `../catalogTextIntegrity.js`
  - `../config/index.js`
  - `../conflictControl.js`
  - `../database.js`
  - `../fileAssets.js`
  - `../helpers.js`
  - `../idempotency.js`
  - `../initials.js`
  - `../middleware.js`
  - `../money.js`
  - `../netSecurity.js`
  - `../productBatches.js`
  - `../productDiscounts.js`
  - `../productImportPolicies.js`
  - `../schemaMetadata.js`
  - `../settingsSnapshot.js`
  - `express`
  - `fs`
  - `path`
- Internal dependencies (17)
  - `backend/.pkg-stage/src/businessMetrics.js`
  - `backend/.pkg-stage/src/catalogTextIntegrity.js`
  - `backend/.pkg-stage/src/config/index.js`
  - `backend/.pkg-stage/src/conflictControl.js`
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/fileAssets.js`
  - `backend/.pkg-stage/src/helpers.js`
  - `backend/.pkg-stage/src/idempotency.js`
  - `backend/.pkg-stage/src/initials.js`
  - `backend/.pkg-stage/src/middleware.js`
  - `backend/.pkg-stage/src/money.js`
  - `backend/.pkg-stage/src/netSecurity.js`
  - `backend/.pkg-stage/src/productBatches.js`
  - `backend/.pkg-stage/src/productDiscounts.js`
  - `backend/.pkg-stage/src/productImportPolicies.js`
  - `backend/.pkg-stage/src/schemaMetadata.js`
  - `backend/.pkg-stage/src/settingsSnapshot.js`
- Referenced by (1)
  - `backend/.pkg-stage/server.js`

### 3.50 `backend/.pkg-stage/src/routes/returns.js`

- Declared exports: `module.exports`
- Imports (7)
  - `../conflictControl.js`
  - `../database.js`
  - `../helpers.js`
  - `../idempotency.js`
  - `../middleware.js`
  - `../productBatches.js`
  - `express`
- Internal dependencies (6)
  - `backend/.pkg-stage/src/conflictControl.js`
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/helpers.js`
  - `backend/.pkg-stage/src/idempotency.js`
  - `backend/.pkg-stage/src/middleware.js`
  - `backend/.pkg-stage/src/productBatches.js`
- Referenced by (1)
  - `backend/.pkg-stage/server.js`

### 3.51 `backend/.pkg-stage/src/routes/runtime.js`

- Declared exports: `module.exports`
- Imports (9)
  - `../catalogTextIntegrity.js`
  - `../database.js`
  - `../helpers.js`
  - `../middleware.js`
  - `../runtimeCache.js`
  - `../runtimeVersion.js`
  - `../services/importJobs.js`
  - `../services/mediaQueue.js`
  - `express`
- Internal dependencies (8)
  - `backend/.pkg-stage/src/catalogTextIntegrity.js`
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/helpers.js`
  - `backend/.pkg-stage/src/middleware.js`
  - `backend/.pkg-stage/src/runtimeCache.js`
  - `backend/.pkg-stage/src/runtimeVersion.js`
  - `backend/.pkg-stage/src/services/importJobs.js`
  - `backend/.pkg-stage/src/services/mediaQueue.js`
- Referenced by (1)
  - `backend/.pkg-stage/server.js`

### 3.52 `backend/.pkg-stage/src/routes/sales.js`

- Declared exports: `module.exports`
- Imports (8)
  - `../businessMetrics.js`
  - `../conflictControl.js`
  - `../database.js`
  - `../helpers.js`
  - `../idempotency.js`
  - `../middleware.js`
  - `../productBatches.js`
  - `express`
- Internal dependencies (7)
  - `backend/.pkg-stage/src/businessMetrics.js`
  - `backend/.pkg-stage/src/conflictControl.js`
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/helpers.js`
  - `backend/.pkg-stage/src/idempotency.js`
  - `backend/.pkg-stage/src/middleware.js`
  - `backend/.pkg-stage/src/productBatches.js`
- Referenced by (1)
  - `backend/.pkg-stage/server.js`

### 3.53 `backend/.pkg-stage/src/routes/settings.js`

- Declared exports: `module.exports`
- Imports (9)
  - `../catalogTextIntegrity.js`
  - `../conflictControl.js`
  - `../database.js`
  - `../fileAssets.js`
  - `../helpers.js`
  - `../middleware.js`
  - `../schemaMetadata.js`
  - `../settingsSnapshot.js`
  - `express`
- Internal dependencies (8)
  - `backend/.pkg-stage/src/catalogTextIntegrity.js`
  - `backend/.pkg-stage/src/conflictControl.js`
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/fileAssets.js`
  - `backend/.pkg-stage/src/helpers.js`
  - `backend/.pkg-stage/src/middleware.js`
  - `backend/.pkg-stage/src/schemaMetadata.js`
  - `backend/.pkg-stage/src/settingsSnapshot.js`
- Referenced by (1)
  - `backend/.pkg-stage/server.js`

### 3.54 `backend/.pkg-stage/src/routes/sync.js`

- Declared exports: `module.exports`
- Imports (7)
  - `../config/index.js`
  - `../middleware.js`
  - `../serverUtils.js`
  - `crypto`
  - `express`
  - `fs`
  - `path`
- Internal dependencies (3)
  - `backend/.pkg-stage/src/config/index.js`
  - `backend/.pkg-stage/src/middleware.js`
  - `backend/.pkg-stage/src/serverUtils.js`
- Referenced by (1)
  - `backend/.pkg-stage/server.js`

### 3.55 `backend/.pkg-stage/src/routes/system/index.js`

- Declared exports: `module.exports`
- Imports (24)
  - `../../accessControl.js`
  - `../../analytics/duckdbRuntime.js`
  - `../../backupSchema.js`
  - `../../config/index.js`
  - `../../dataPath/index.js`
  - `../../database.js`
  - `../../db/cutoverReadiness.js`
  - `../../fileAssets.js`
  - `../../helpers.js`
  - `../../maintenanceLock.js`
  - `../../middleware.js`
  - `../../objectStore.js`
  - `../../organizationContext/index.js`
  - `../../runtimeState/index.js`
  - `../../security.js`
  - `../../services/backupPackages.js`
  - `../../services/googleDriveSync/index.js`
  - `../../services/importJobs.js`
  - `../../services/integrationDoctor.js`
  - `../../systemJobs.js`
  - `child_process`
  - `express`
  - `fs`
  - `path`
- Internal dependencies (20)
  - `backend/.pkg-stage/src/accessControl.js`
  - `backend/.pkg-stage/src/analytics/duckdbRuntime.js`
  - `backend/.pkg-stage/src/backupSchema.js`
  - `backend/.pkg-stage/src/config/index.js`
  - `backend/.pkg-stage/src/dataPath/index.js`
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/db/cutoverReadiness.js`
  - `backend/.pkg-stage/src/fileAssets.js`
  - `backend/.pkg-stage/src/helpers.js`
  - `backend/.pkg-stage/src/maintenanceLock.js`
  - `backend/.pkg-stage/src/middleware.js`
  - `backend/.pkg-stage/src/objectStore.js`
  - `backend/.pkg-stage/src/organizationContext/index.js`
  - `backend/.pkg-stage/src/runtimeState/index.js`
  - `backend/.pkg-stage/src/security.js`
  - `backend/.pkg-stage/src/services/backupPackages.js`
  - `backend/.pkg-stage/src/services/googleDriveSync/index.js`
  - `backend/.pkg-stage/src/services/importJobs.js`
  - `backend/.pkg-stage/src/services/integrationDoctor.js`
  - `backend/.pkg-stage/src/systemJobs.js`
- Referenced by (1)
  - `backend/.pkg-stage/server.js`

### 3.56 `backend/.pkg-stage/src/routes/units.js`

- Declared exports: `module.exports`
- Imports (6)
  - `../catalogTextIntegrity.js`
  - `../conflictControl.js`
  - `../database.js`
  - `../helpers.js`
  - `../middleware.js`
  - `express`
- Internal dependencies (5)
  - `backend/.pkg-stage/src/catalogTextIntegrity.js`
  - `backend/.pkg-stage/src/conflictControl.js`
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/helpers.js`
  - `backend/.pkg-stage/src/middleware.js`
- Referenced by (1)
  - `backend/.pkg-stage/server.js`

### 3.57 `backend/.pkg-stage/src/routes/users.js`

- Declared exports: `module.exports`
- Imports (11)
  - `../conflictControl.js`
  - `../database.js`
  - `../fileAssets.js`
  - `../helpers.js`
  - `../middleware.js`
  - `../organizationContext/index.js`
  - `../services/googleOauth.js`
  - `../services/verification.js`
  - `../sessionAuth.js`
  - `bcryptjs`
  - `express`
- Internal dependencies (9)
  - `backend/.pkg-stage/src/conflictControl.js`
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/fileAssets.js`
  - `backend/.pkg-stage/src/helpers.js`
  - `backend/.pkg-stage/src/middleware.js`
  - `backend/.pkg-stage/src/organizationContext/index.js`
  - `backend/.pkg-stage/src/services/googleOauth.js`
  - `backend/.pkg-stage/src/services/verification.js`
  - `backend/.pkg-stage/src/sessionAuth.js`
- Referenced by (1)
  - `backend/.pkg-stage/server.js`

### 3.58 `backend/.pkg-stage/src/runtimeCache.js`

- Declared exports: `module.exports`
- Imports (2)
  - `./config/index.js`
  - `ioredis`
- Internal dependencies (1)
  - `backend/.pkg-stage/src/config/index.js`
- Referenced by (3)
  - `backend/.pkg-stage/src/helpers.js`
  - `backend/.pkg-stage/src/routes/portal.js`
  - `backend/.pkg-stage/src/routes/runtime.js`

### 3.59 `backend/.pkg-stage/src/runtimeState/index.js`

- Declared exports: `module.exports`
- Imports (4)
  - `../config/index.js`
  - `crypto`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `backend/.pkg-stage/src/config/index.js`
- Referenced by (2)
  - `backend/.pkg-stage/src/routes/auth.js`
  - `backend/.pkg-stage/src/routes/system/index.js`

### 3.60 `backend/.pkg-stage/src/runtimeVersion.js`

- Declared exports: `module.exports`
- Imports (5)
  - `../package.json`
  - `child_process`
  - `crypto`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `backend/.pkg-stage/package.json`
- Referenced by (4)
  - `backend/.pkg-stage/server.js`
  - `backend/.pkg-stage/src/routes/auth.js`
  - `backend/.pkg-stage/src/routes/runtime.js`
  - `backend/.pkg-stage/src/services/googleDriveSync/index.js`

### 3.61 `backend/.pkg-stage/src/schemaMetadata.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./database.js`
- Internal dependencies (1)
  - `backend/.pkg-stage/src/database.js`
- Referenced by (5)
  - `backend/.pkg-stage/src/routes/branches.js`
  - `backend/.pkg-stage/src/routes/customTables.js`
  - `backend/.pkg-stage/src/routes/inventory.js`
  - `backend/.pkg-stage/src/routes/products.js`
  - `backend/.pkg-stage/src/routes/settings.js`

### 3.62 `backend/.pkg-stage/src/security.js`

- Declared exports: `module.exports`
- Imports (1)
  - `crypto`
- Internal dependencies (0)
  - none
- Referenced by (6)
  - `backend/.pkg-stage/src/middleware.js`
  - `backend/.pkg-stage/src/routes/auth.js`
  - `backend/.pkg-stage/src/routes/portal.js`
  - `backend/.pkg-stage/src/routes/system/index.js`
  - `backend/.pkg-stage/src/services/aiGateway.js`
  - `backend/.pkg-stage/src/services/googleDriveSync/index.js`

### 3.63 `backend/.pkg-stage/src/serverUtils.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./config/index.js`
- Internal dependencies (1)
  - `backend/.pkg-stage/src/config/index.js`
- Referenced by (3)
  - `backend/.pkg-stage/server.js`
  - `backend/.pkg-stage/src/routes/sync.js`
  - `backend/.pkg-stage/src/websocket.js`

### 3.64 `backend/.pkg-stage/src/services/aiGateway.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../netSecurity.js`
  - `../security.js`
- Internal dependencies (2)
  - `backend/.pkg-stage/src/netSecurity.js`
  - `backend/.pkg-stage/src/security.js`
- Referenced by (2)
  - `backend/.pkg-stage/src/routes/ai.js`
  - `backend/.pkg-stage/src/services/portalAi.js`

### 3.65 `backend/.pkg-stage/src/services/backupPackages.js`

- Declared exports: `module.exports`
- Imports (9)
  - `../backupSchema.js`
  - `../config/index.js`
  - `../database.js`
  - `../objectStore.js`
  - `crypto`
  - `fs`
  - `path`
  - `stream`
  - `stream/promises`
- Internal dependencies (4)
  - `backend/.pkg-stage/src/backupSchema.js`
  - `backend/.pkg-stage/src/config/index.js`
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/objectStore.js`
- Referenced by (3)
  - `backend/.pkg-stage/src/routes/system/index.js`
  - `backend/.pkg-stage/src/services/googleDriveSync/index.js`
  - `backend/.pkg-stage/src/services/integrationDoctor.js`

### 3.66 `backend/.pkg-stage/src/services/firebaseAuth.js`

- Declared exports: `module.exports`
- Imports (2)
  - `crypto`
  - `fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.67 `backend/.pkg-stage/src/services/googleDriveSync/index.js`

- Declared exports: `module.exports`
- Imports (12)
  - `../../config/index.js`
  - `../../dataPath/index.js`
  - `../../database.js`
  - `../../maintenanceLock.js`
  - `../../runtimeVersion.js`
  - `../../security.js`
  - `../backupPackages.js`
  - `./versioning.js`
  - `crypto`
  - `fs`
  - `os`
  - `path`
- Internal dependencies (8)
  - `backend/.pkg-stage/src/config/index.js`
  - `backend/.pkg-stage/src/dataPath/index.js`
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/maintenanceLock.js`
  - `backend/.pkg-stage/src/runtimeVersion.js`
  - `backend/.pkg-stage/src/security.js`
  - `backend/.pkg-stage/src/services/backupPackages.js`
  - `backend/.pkg-stage/src/services/googleDriveSync/versioning.js`
- Referenced by (4)
  - `backend/.pkg-stage/src/helpers.js`
  - `backend/.pkg-stage/src/routes/notifications.js`
  - `backend/.pkg-stage/src/routes/system/index.js`
  - `backend/.pkg-stage/src/services/integrationDoctor.js`

### 3.68 `backend/.pkg-stage/src/services/googleDriveSync/versioning.js`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `backend/.pkg-stage/src/services/googleDriveSync/index.js`

### 3.69 `backend/.pkg-stage/src/services/googleOauth.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../config/index.js`
  - `crypto`
- Internal dependencies (1)
  - `backend/.pkg-stage/src/config/index.js`
- Referenced by (3)
  - `backend/.pkg-stage/src/routes/auth.js`
  - `backend/.pkg-stage/src/routes/users.js`
  - `backend/.pkg-stage/src/services/integrationDoctor.js`

### 3.70 `backend/.pkg-stage/src/services/importJobs.js`

- Declared exports: `module.exports`
- Imports (20)
  - `../catalogTextIntegrity.js`
  - `../config/index.js`
  - `../contactOptions.js`
  - `../database.js`
  - `../fileAssets.js`
  - `../helpers.js`
  - `../importCsv.js`
  - `../money.js`
  - `../netSecurity.js`
  - `../productBatches.js`
  - `../productDiscounts.js`
  - `../productImportPolicies.js`
  - `../uploadSecurity.js`
  - `./mediaQueue.js`
  - `bullmq`
  - `crypto`
  - `fs`
  - `ioredis`
  - `path`
  - `yauzl`
- Internal dependencies (14)
  - `backend/.pkg-stage/src/catalogTextIntegrity.js`
  - `backend/.pkg-stage/src/config/index.js`
  - `backend/.pkg-stage/src/contactOptions.js`
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/fileAssets.js`
  - `backend/.pkg-stage/src/helpers.js`
  - `backend/.pkg-stage/src/importCsv.js`
  - `backend/.pkg-stage/src/money.js`
  - `backend/.pkg-stage/src/netSecurity.js`
  - `backend/.pkg-stage/src/productBatches.js`
  - `backend/.pkg-stage/src/productDiscounts.js`
  - `backend/.pkg-stage/src/productImportPolicies.js`
  - `backend/.pkg-stage/src/services/mediaQueue.js`
  - `backend/.pkg-stage/src/uploadSecurity.js`
- Referenced by (6)
  - `backend/.pkg-stage/server.js`
  - `backend/.pkg-stage/src/routes/importJobs.js`
  - `backend/.pkg-stage/src/routes/runtime.js`
  - `backend/.pkg-stage/src/routes/system/index.js`
  - `backend/.pkg-stage/src/services/integrationDoctor.js`
  - `backend/.pkg-stage/src/workers/importWorker.js`

### 3.71 `backend/.pkg-stage/src/services/integrationDoctor.js`

- Declared exports: `module.exports`
- Imports (10)
  - `../analytics/duckdbRuntime.js`
  - `../config/index.js`
  - `../database.js`
  - `../objectStore.js`
  - `./backupPackages.js`
  - `./googleDriveSync/index.js`
  - `./googleOauth.js`
  - `./importJobs.js`
  - `fs`
  - `path`
- Internal dependencies (8)
  - `backend/.pkg-stage/src/analytics/duckdbRuntime.js`
  - `backend/.pkg-stage/src/config/index.js`
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/objectStore.js`
  - `backend/.pkg-stage/src/services/backupPackages.js`
  - `backend/.pkg-stage/src/services/googleDriveSync/index.js`
  - `backend/.pkg-stage/src/services/googleOauth.js`
  - `backend/.pkg-stage/src/services/importJobs.js`
- Referenced by (1)
  - `backend/.pkg-stage/src/routes/system/index.js`

### 3.72 `backend/.pkg-stage/src/services/mediaQueue.js`

- Declared exports: `module.exports`
- Imports (5)
  - `../config/index.js`
  - `../database.js`
  - `../fileAssets.js`
  - `bullmq`
  - `ioredis`
- Internal dependencies (3)
  - `backend/.pkg-stage/src/config/index.js`
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/fileAssets.js`
- Referenced by (4)
  - `backend/.pkg-stage/src/routes/files.js`
  - `backend/.pkg-stage/src/routes/runtime.js`
  - `backend/.pkg-stage/src/services/importJobs.js`
  - `backend/.pkg-stage/src/workers/mediaWorker.js`

### 3.73 `backend/.pkg-stage/src/services/portalAi.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../database.js`
  - `./aiGateway.js`
- Internal dependencies (2)
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/services/aiGateway.js`
- Referenced by (1)
  - `backend/.pkg-stage/src/routes/portal.js`

### 3.74 `backend/.pkg-stage/src/services/verification.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../database.js`
  - `crypto`
- Internal dependencies (1)
  - `backend/.pkg-stage/src/database.js`
- Referenced by (2)
  - `backend/.pkg-stage/src/routes/auth.js`
  - `backend/.pkg-stage/src/routes/users.js`

### 3.75 `backend/.pkg-stage/src/sessionAuth.js`

- Declared exports: `module.exports`
- Imports (2)
  - `./database.js`
  - `crypto`
- Internal dependencies (1)
  - `backend/.pkg-stage/src/database.js`
- Referenced by (4)
  - `backend/.pkg-stage/src/middleware.js`
  - `backend/.pkg-stage/src/routes/auth.js`
  - `backend/.pkg-stage/src/routes/users.js`
  - `backend/.pkg-stage/src/websocket.js`

### 3.76 `backend/.pkg-stage/src/settingsSnapshot.js`

- Declared exports: `module.exports`
- Imports (4)
  - `./config/index.js`
  - `./objectStore.js`
  - `fs`
  - `path`
- Internal dependencies (2)
  - `backend/.pkg-stage/src/config/index.js`
  - `backend/.pkg-stage/src/objectStore.js`
- Referenced by (7)
  - `backend/.pkg-stage/src/fileAssets.js`
  - `backend/.pkg-stage/src/routes/auth.js`
  - `backend/.pkg-stage/src/routes/catalog.js`
  - `backend/.pkg-stage/src/routes/portal.js`
  - `backend/.pkg-stage/src/routes/products.js`
  - `backend/.pkg-stage/src/routes/settings.js`
  - `backend/.pkg-stage/src/uploadReferenceCleanup.js`

### 3.77 `backend/.pkg-stage/src/storage/organizationFolders.js`

- Declared exports: `module.exports`
- Imports (2)
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/.pkg-stage/src/config/index.js`
  - `backend/.pkg-stage/src/organizationContext/index.js`

### 3.78 `backend/.pkg-stage/src/systemFsWorker.js`

- Declared exports: none detected
- Imports (3)
  - `./dataPath/index.js`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `backend/.pkg-stage/src/dataPath/index.js`
- Referenced by (0)
  - none

### 3.79 `backend/.pkg-stage/src/systemJobs.js`

- Declared exports: `module.exports`
- Imports (2)
  - `./database.js`
  - `crypto`
- Internal dependencies (1)
  - `backend/.pkg-stage/src/database.js`
- Referenced by (1)
  - `backend/.pkg-stage/src/routes/system/index.js`

### 3.80 `backend/.pkg-stage/src/uploadReferenceCleanup.js`

- Declared exports: `module.exports`
- Imports (1)
  - `./settingsSnapshot.js`
- Internal dependencies (1)
  - `backend/.pkg-stage/src/settingsSnapshot.js`
- Referenced by (1)
  - `backend/.pkg-stage/src/fileAssets.js`

### 3.81 `backend/.pkg-stage/src/uploadSecurity.js`

- Declared exports: `module.exports`
- Imports (2)
  - `./optionalSharp.js`
  - `fs`
- Internal dependencies (1)
  - `backend/.pkg-stage/src/optionalSharp.js`
- Referenced by (3)
  - `backend/.pkg-stage/src/fileAssets.js`
  - `backend/.pkg-stage/src/middleware.js`
  - `backend/.pkg-stage/src/services/importJobs.js`

### 3.82 `backend/.pkg-stage/src/websocket.js`

- Declared exports: `module.exports`
- Imports (5)
  - `./helpers.js`
  - `./serverUtils.js`
  - `./sessionAuth.js`
  - `http`
  - `ws`
- Internal dependencies (3)
  - `backend/.pkg-stage/src/helpers.js`
  - `backend/.pkg-stage/src/serverUtils.js`
  - `backend/.pkg-stage/src/sessionAuth.js`
- Referenced by (1)
  - `backend/.pkg-stage/server.js`

### 3.83 `backend/.pkg-stage/src/workers/importWorker.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../database.js`
  - `../services/importJobs.js`
- Internal dependencies (2)
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/services/importJobs.js`
- Referenced by (1)
  - `backend/.pkg-stage/server.js`

### 3.84 `backend/.pkg-stage/src/workers/mediaWorker.js`

- Declared exports: `module.exports`
- Imports (2)
  - `../database.js`
  - `../services/mediaQueue.js`
- Internal dependencies (2)
  - `backend/.pkg-stage/src/database.js`
  - `backend/.pkg-stage/src/services/mediaQueue.js`
- Referenced by (1)
  - `backend/.pkg-stage/server.js`

### 3.85 `backend/server.js`

- Declared exports: none detected
- Imports (47)
  - `./src/analytics/duckdbRuntime.ts`
  - `./src/config/index.ts`
  - `./src/database.ts`
  - `./src/fileAssets.ts`
  - `./src/helpers.ts`
  - `./src/maintenanceLock.ts`
  - `./src/middleware.ts`
  - `./src/objectStore.ts`
  - `./src/organizationContext/index.ts`
  - `./src/productBatches.ts`
  - `./src/requestContext.ts`
  - `./src/routes/actionHistory.ts`
  - `./src/routes/ai.ts`
  - `./src/routes/auth.ts`
  - `./src/routes/branches.ts`
  - `./src/routes/catalog.ts`
  - `./src/routes/categories.ts`
  - `./src/routes/contacts.ts`
  - `./src/routes/customTables.ts`
  - `./src/routes/files.ts`
  - `./src/routes/importJobs.ts`
  - `./src/routes/inventory.ts`
  - `./src/routes/notifications.ts`
  - `./src/routes/organizations.ts`
  - `./src/routes/portal.ts`
  - `./src/routes/products.ts`
  - `./src/routes/returns.ts`
  - `./src/routes/runtime.ts`
  - `./src/routes/sales.ts`
  - `./src/routes/settings.ts`
  - `./src/routes/sync.ts`
  - `./src/routes/system/index.ts`
  - `./src/routes/units.ts`
  - `./src/routes/users.ts`
  - `./src/runtimeVersion.ts`
  - `./src/serverUtils.ts`
  - `./src/services/importJobs.ts`
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
  - `backend/src/config/index.ts`
  - `backend/src/database.ts`
  - `backend/src/fileAssets.ts`
  - `backend/src/helpers.ts`
  - `backend/src/maintenanceLock.ts`
  - `backend/src/middleware.ts`
  - `backend/src/objectStore.ts`
  - `backend/src/organizationContext/index.ts`
  - `backend/src/productBatches.ts`
  - `backend/src/requestContext.ts`
  - `backend/src/routes/actionHistory.ts`
  - `backend/src/routes/ai.ts`
  - `backend/src/routes/auth.ts`
  - `backend/src/routes/branches.ts`
  - `backend/src/routes/catalog.ts`
  - `backend/src/routes/categories.ts`
  - `backend/src/routes/contacts.ts`
  - `backend/src/routes/customTables.ts`
  - `backend/src/routes/files.ts`
  - `backend/src/routes/importJobs.ts`
  - `backend/src/routes/inventory.ts`
  - `backend/src/routes/notifications.ts`
  - `backend/src/routes/organizations.ts`
  - `backend/src/routes/portal.ts`
  - `backend/src/routes/products.ts`
  - `backend/src/routes/returns.ts`
  - `backend/src/routes/runtime.ts`
  - `backend/src/routes/sales.ts`
  - `backend/src/routes/settings.ts`
  - `backend/src/routes/sync.ts`
  - `backend/src/routes/system/index.ts`
  - `backend/src/routes/units.ts`
  - `backend/src/routes/users.ts`
  - `backend/src/runtimeVersion.ts`
  - `backend/src/serverUtils.ts`
  - `backend/src/services/importJobs.ts`
  - `backend/src/websocket.ts`
  - `backend/src/workers/importWorker.ts`
  - `backend/src/workers/mediaWorker.ts`
- Referenced by (0)
  - none

### 3.86 `backend/server.ts`

- Declared exports: none detected
- Imports (47)
  - `./src/analytics/duckdbRuntime.ts`
  - `./src/config/index.ts`
  - `./src/database.ts`
  - `./src/fileAssets.ts`
  - `./src/helpers.ts`
  - `./src/maintenanceLock.ts`
  - `./src/middleware.ts`
  - `./src/objectStore.ts`
  - `./src/organizationContext/index.ts`
  - `./src/productBatches.ts`
  - `./src/requestContext.ts`
  - `./src/routes/actionHistory.ts`
  - `./src/routes/ai.ts`
  - `./src/routes/auth.ts`
  - `./src/routes/branches.ts`
  - `./src/routes/catalog.ts`
  - `./src/routes/categories.ts`
  - `./src/routes/contacts.ts`
  - `./src/routes/customTables.ts`
  - `./src/routes/files.ts`
  - `./src/routes/importJobs.ts`
  - `./src/routes/inventory.ts`
  - `./src/routes/notifications.ts`
  - `./src/routes/organizations.ts`
  - `./src/routes/portal.ts`
  - `./src/routes/products.ts`
  - `./src/routes/returns.ts`
  - `./src/routes/runtime.ts`
  - `./src/routes/sales.ts`
  - `./src/routes/settings.ts`
  - `./src/routes/sync.ts`
  - `./src/routes/system/index.ts`
  - `./src/routes/units.ts`
  - `./src/routes/users.ts`
  - `./src/runtimeVersion.ts`
  - `./src/serverUtils.ts`
  - `./src/services/importJobs.ts`
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
  - `backend/src/config/index.ts`
  - `backend/src/database.ts`
  - `backend/src/fileAssets.ts`
  - `backend/src/helpers.ts`
  - `backend/src/maintenanceLock.ts`
  - `backend/src/middleware.ts`
  - `backend/src/objectStore.ts`
  - `backend/src/organizationContext/index.ts`
  - `backend/src/productBatches.ts`
  - `backend/src/requestContext.ts`
  - `backend/src/routes/actionHistory.ts`
  - `backend/src/routes/ai.ts`
  - `backend/src/routes/auth.ts`
  - `backend/src/routes/branches.ts`
  - `backend/src/routes/catalog.ts`
  - `backend/src/routes/categories.ts`
  - `backend/src/routes/contacts.ts`
  - `backend/src/routes/customTables.ts`
  - `backend/src/routes/files.ts`
  - `backend/src/routes/importJobs.ts`
  - `backend/src/routes/inventory.ts`
  - `backend/src/routes/notifications.ts`
  - `backend/src/routes/organizations.ts`
  - `backend/src/routes/portal.ts`
  - `backend/src/routes/products.ts`
  - `backend/src/routes/returns.ts`
  - `backend/src/routes/runtime.ts`
  - `backend/src/routes/sales.ts`
  - `backend/src/routes/settings.ts`
  - `backend/src/routes/sync.ts`
  - `backend/src/routes/system/index.ts`
  - `backend/src/routes/units.ts`
  - `backend/src/routes/users.ts`
  - `backend/src/runtimeVersion.ts`
  - `backend/src/serverUtils.ts`
  - `backend/src/services/importJobs.ts`
  - `backend/src/websocket.ts`
  - `backend/src/workers/importWorker.ts`
  - `backend/src/workers/mediaWorker.ts`
- Referenced by (0)
  - none

### 3.87 `backend/src/accessControl.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `./config/index.ts`
- Internal dependencies (1)
  - `backend/src/config/index.ts`
- Referenced by (4)
  - `backend/src/middleware.ts`
  - `backend/src/routes/auth.ts`
  - `backend/src/routes/system/index.ts`
  - `backend/test/accessControl.test.ts`

### 3.88 `backend/src/analytics/duckdbRuntime.ts`

- Declared exports: `module.exports`
- Imports (2)
  - `../config/index.ts`
  - `path`
- Internal dependencies (1)
  - `backend/src/config/index.ts`
- Referenced by (5)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/src/routes/system/index.ts`
  - `backend/src/services/integrationDoctor.ts`
  - `backend/test/analyticsRuntime.test.ts`

### 3.89 `backend/src/authOtpGuards.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `./middleware.ts`
- Internal dependencies (1)
  - `backend/src/middleware.ts`
- Referenced by (2)
  - `backend/src/routes/auth.ts`
  - `backend/test/authOtpGuards.test.ts`

### 3.90 `backend/src/backupSchema.ts`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `backend/src/routes/system/index.ts`
  - `backend/src/services/backupPackages.ts`
  - `backend/test/backupSchema.test.ts`

### 3.91 `backend/src/businessMetrics.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `./database.ts`
- Internal dependencies (1)
  - `backend/src/database.ts`
- Referenced by (5)
  - `backend/src/routes/branches.ts`
  - `backend/src/routes/inventory.ts`
  - `backend/src/routes/notifications.ts`
  - `backend/src/routes/products.ts`
  - `backend/src/routes/sales.ts`

### 3.92 `backend/src/catalogTextIntegrity.ts`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (7)
  - `backend/src/routes/categories.ts`
  - `backend/src/routes/inventory.ts`
  - `backend/src/routes/products.ts`
  - `backend/src/routes/runtime.ts`
  - `backend/src/routes/settings.ts`
  - `backend/src/routes/units.ts`
  - `backend/src/services/importJobs.ts`

### 3.93 `backend/src/config/index.ts`

- Declared exports: `module.exports`
- Imports (4)
  - `../storage/organizationFolders.ts`
  - `dotenv`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `backend/src/storage/organizationFolders.ts`
- Referenced by (26)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/src/accessControl.ts`
  - `backend/src/analytics/duckdbRuntime.ts`
  - `backend/src/fileAssets.ts`
  - `backend/src/middleware.ts`
  - `backend/src/objectStore.ts`
  - `backend/src/organizationContext/index.ts`
  - `backend/src/postgresDatabase.ts`
  - `backend/src/routes/auth.ts`
  - `backend/src/routes/importJobs.ts`
  - `backend/src/routes/products.ts`
  - `backend/src/routes/sync.ts`
  - `backend/src/routes/system/index.ts`
  - `backend/src/runtimeCache.ts`
  - `backend/src/runtimeState/index.ts`
  - `backend/src/serverUtils.ts`
  - `backend/src/services/backupPackages.ts`
  - `backend/src/services/googleDriveSync/index.ts`
  - `backend/src/services/googleOauth.ts`
  - `backend/src/services/importJobs.ts`
  - `backend/src/services/integrationDoctor.ts`
  - `backend/src/services/mediaQueue.ts`
  - `backend/src/settingsSnapshot.ts`
  - `backend/test/importJobStateMachine.test.ts`
  - `backend/test/serverUtils.test.ts`

### 3.94 `backend/src/conflictControl.ts`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (12)
  - `backend/src/routes/ai.ts`
  - `backend/src/routes/branches.ts`
  - `backend/src/routes/categories.ts`
  - `backend/src/routes/contacts.ts`
  - `backend/src/routes/customTables.ts`
  - `backend/src/routes/files.ts`
  - `backend/src/routes/products.ts`
  - `backend/src/routes/returns.ts`
  - `backend/src/routes/sales.ts`
  - `backend/src/routes/settings.ts`
  - `backend/src/routes/units.ts`
  - `backend/src/routes/users.ts`

### 3.95 `backend/src/contactOptions.ts`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `backend/src/routes/contacts.ts`
  - `backend/src/services/importJobs.ts`
  - `backend/test/contactOptions.test.ts`

### 3.96 `backend/src/database.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `./postgresDatabase.ts`
- Internal dependencies (1)
  - `backend/src/postgresDatabase.ts`
- Referenced by (41)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/src/businessMetrics.ts`
  - `backend/src/fileAssets.ts`
  - `backend/src/helpers.ts`
  - `backend/src/organizationContext/index.ts`
  - `backend/src/productBatches.ts`
  - `backend/src/routes/actionHistory.ts`
  - `backend/src/routes/ai.ts`
  - `backend/src/routes/auth.ts`
  - `backend/src/routes/branches.ts`
  - `backend/src/routes/catalog.ts`
  - `backend/src/routes/categories.ts`
  - `backend/src/routes/contacts.ts`
  - `backend/src/routes/customTables.ts`
  - `backend/src/routes/inventory.ts`
  - `backend/src/routes/notifications.ts`
  - `backend/src/routes/portal.ts`
  - `backend/src/routes/products.ts`
  - `backend/src/routes/returns.ts`
  - `backend/src/routes/runtime.ts`
  - `backend/src/routes/sales.ts`
  - `backend/src/routes/settings.ts`
  - `backend/src/routes/system/index.ts`
  - `backend/src/routes/units.ts`
  - `backend/src/routes/users.ts`
  - `backend/src/schemaMetadata.ts`
  - `backend/src/services/backupPackages.ts`
  - `backend/src/services/googleDriveSync/index.ts`
  - `backend/src/services/importJobs.ts`
  - `backend/src/services/integrationDoctor.ts`
  - `backend/src/services/mediaQueue.ts`
  - `backend/src/services/portalAi.ts`
  - `backend/src/services/verification.ts`
  - `backend/src/sessionAuth.ts`
  - `backend/src/systemJobs.ts`
  - `backend/src/workers/importWorker.ts`
  - `backend/src/workers/mediaWorker.ts`
  - `backend/test/authSecurityFlow.test.ts`
  - `backend/test/fileAssetUsageCache.test.ts`
  - `backend/test/importJobStateMachine.test.ts`

### 3.97 `backend/src/dataPath/index.ts`

- Declared exports: `module.exports`
- Imports (2)
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `backend/src/organizationContext/index.ts`
  - `backend/src/routes/system/index.ts`
  - `backend/src/services/googleDriveSync/index.ts`
  - `backend/src/systemFsWorker.ts`
  - `backend/test/dataPath.test.ts`

### 3.98 `backend/src/db/cutoverReadiness.ts`

- Declared exports: `module.exports`
- Imports (2)
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/routes/system/index.ts`
  - `backend/test/postgresCutoverReadiness.test.ts`

### 3.99 `backend/src/db/postgresQueryCompat.ts`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/postgresDatabase.ts`
  - `backend/test/postgresQueryCompat.test.ts`

### 3.100 `backend/src/fileAssets.ts`

- Declared exports: `module.exports`
- Imports (12)
  - `./config/index.ts`
  - `./database.ts`
  - `./objectStore.ts`
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
  - `backend/src/config/index.ts`
  - `backend/src/database.ts`
  - `backend/src/objectStore.ts`
  - `backend/src/optionalSharp.ts`
  - `backend/src/settingsSnapshot.ts`
  - `backend/src/uploadReferenceCleanup.ts`
  - `backend/src/uploadSecurity.ts`
- Referenced by (16)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/src/middleware.ts`
  - `backend/src/routes/files.ts`
  - `backend/src/routes/importJobs.ts`
  - `backend/src/routes/portal.ts`
  - `backend/src/routes/products.ts`
  - `backend/src/routes/settings.ts`
  - `backend/src/routes/system/index.ts`
  - `backend/src/routes/users.ts`
  - `backend/src/services/importJobs.ts`
  - `backend/src/services/mediaQueue.ts`
  - `backend/test/fileAssetStorageReconcile.test.ts`
  - `backend/test/fileAssetUsageCache.test.ts`
  - `backend/test/mediaOptimization.test.ts`
  - `backend/test/uploadSecurity.test.ts`

### 3.101 `backend/src/helpers.ts`

- Declared exports: `module.exports`
- Imports (4)
  - `./database.ts`
  - `./requestContext.ts`
  - `./runtimeCache.ts`
  - `./services/googleDriveSync/index.ts`
- Internal dependencies (4)
  - `backend/src/database.ts`
  - `backend/src/requestContext.ts`
  - `backend/src/runtimeCache.ts`
  - `backend/src/services/googleDriveSync/index.ts`
- Referenced by (24)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/src/routes/actionHistory.ts`
  - `backend/src/routes/ai.ts`
  - `backend/src/routes/auth.ts`
  - `backend/src/routes/branches.ts`
  - `backend/src/routes/catalog.ts`
  - `backend/src/routes/categories.ts`
  - `backend/src/routes/contacts.ts`
  - `backend/src/routes/customTables.ts`
  - `backend/src/routes/files.ts`
  - `backend/src/routes/importJobs.ts`
  - `backend/src/routes/inventory.ts`
  - `backend/src/routes/portal.ts`
  - `backend/src/routes/products.ts`
  - `backend/src/routes/returns.ts`
  - `backend/src/routes/runtime.ts`
  - `backend/src/routes/sales.ts`
  - `backend/src/routes/settings.ts`
  - `backend/src/routes/system/index.ts`
  - `backend/src/routes/units.ts`
  - `backend/src/routes/users.ts`
  - `backend/src/services/importJobs.ts`
  - `backend/src/websocket.ts`

### 3.102 `backend/src/idempotency.ts`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `backend/src/routes/inventory.ts`
  - `backend/src/routes/products.ts`
  - `backend/src/routes/returns.ts`
  - `backend/src/routes/sales.ts`
  - `backend/test/idempotency.test.ts`

### 3.103 `backend/src/importCsv.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `fs`
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `backend/src/services/importJobs.ts`
  - `backend/test/importCsv.test.ts`
  - `backend/test/importScaleSmoke.test.ts`

### 3.104 `backend/src/importParsing.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `./money.ts`
- Internal dependencies (1)
  - `backend/src/money.ts`
- Referenced by (3)
  - `backend/src/productImportPolicies.ts`
  - `backend/test/importCsv.test.ts`
  - `backend/test/importScaleSmoke.test.ts`

### 3.105 `backend/src/initials.ts`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `backend/src/routes/inventory.ts`
  - `backend/src/routes/portal.ts`
  - `backend/src/routes/products.ts`
  - `backend/test/initials.test.ts`

### 3.106 `backend/src/maintenanceLock.ts`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/src/routes/system/index.ts`
  - `backend/src/services/googleDriveSync/index.ts`

### 3.107 `backend/src/middleware.ts`

- Declared exports: `module.exports`
- Imports (10)
  - `./accessControl.ts`
  - `./config/index.ts`
  - `./fileAssets.ts`
  - `./permissions.ts`
  - `./security.ts`
  - `./sessionAuth.ts`
  - `./uploadSecurity.ts`
  - `fs`
  - `multer`
  - `path`
- Internal dependencies (7)
  - `backend/src/accessControl.ts`
  - `backend/src/config/index.ts`
  - `backend/src/fileAssets.ts`
  - `backend/src/permissions.ts`
  - `backend/src/security.ts`
  - `backend/src/sessionAuth.ts`
  - `backend/src/uploadSecurity.ts`
- Referenced by (25)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/src/authOtpGuards.ts`
  - `backend/src/routes/actionHistory.ts`
  - `backend/src/routes/ai.ts`
  - `backend/src/routes/auth.ts`
  - `backend/src/routes/branches.ts`
  - `backend/src/routes/categories.ts`
  - `backend/src/routes/contacts.ts`
  - `backend/src/routes/customTables.ts`
  - `backend/src/routes/files.ts`
  - `backend/src/routes/importJobs.ts`
  - `backend/src/routes/inventory.ts`
  - `backend/src/routes/notifications.ts`
  - `backend/src/routes/organizations.ts`
  - `backend/src/routes/portal.ts`
  - `backend/src/routes/products.ts`
  - `backend/src/routes/returns.ts`
  - `backend/src/routes/runtime.ts`
  - `backend/src/routes/sales.ts`
  - `backend/src/routes/settings.ts`
  - `backend/src/routes/sync.ts`
  - `backend/src/routes/system/index.ts`
  - `backend/src/routes/units.ts`
  - `backend/src/routes/users.ts`

### 3.108 `backend/src/money.ts`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `backend/src/importParsing.ts`
  - `backend/src/productDiscounts.ts`
  - `backend/src/routes/inventory.ts`
  - `backend/src/routes/products.ts`
  - `backend/src/services/importJobs.ts`

### 3.109 `backend/src/netSecurity.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `net`
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `backend/src/routes/portal.ts`
  - `backend/src/routes/products.ts`
  - `backend/src/services/aiGateway.ts`
  - `backend/src/services/importJobs.ts`
  - `backend/test/netSecurity.test.ts`

### 3.110 `backend/src/objectStore.ts`

- Declared exports: `module.exports`
- Imports (7)
  - `./config/index.ts`
  - `@aws-sdk/client-s3`
  - `@smithy/node-http-handler`
  - `fs`
  - `http`
  - `https`
  - `stream`
- Internal dependencies (1)
  - `backend/src/config/index.ts`
- Referenced by (7)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/src/fileAssets.ts`
  - `backend/src/routes/system/index.ts`
  - `backend/src/services/backupPackages.ts`
  - `backend/src/services/integrationDoctor.ts`
  - `backend/src/settingsSnapshot.ts`

### 3.111 `backend/src/optionalSharp.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/fileAssets.ts`
  - `backend/src/uploadSecurity.ts`

### 3.112 `backend/src/organizationContext/index.ts`

- Declared exports: `module.exports`
- Imports (7)
  - `../config/index.ts`
  - `../dataPath/index.ts`
  - `../database.ts`
  - `../storage/organizationFolders.ts`
  - `crypto`
  - `fs`
  - `path`
- Internal dependencies (4)
  - `backend/src/config/index.ts`
  - `backend/src/dataPath/index.ts`
  - `backend/src/database.ts`
  - `backend/src/storage/organizationFolders.ts`
- Referenced by (7)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/src/routes/auth.ts`
  - `backend/src/routes/organizations.ts`
  - `backend/src/routes/portal.ts`
  - `backend/src/routes/system/index.ts`
  - `backend/src/routes/users.ts`

### 3.113 `backend/src/permissions.ts`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `backend/src/middleware.ts`
  - `backend/src/postgresDatabase.ts`
  - `backend/src/routes/actionHistory.ts`
  - `backend/test/permissionPolicy.test.ts`

### 3.114 `backend/src/portalUtils.ts`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/routes/portal.ts`
  - `backend/test/portalUtils.test.ts`

### 3.115 `backend/src/postgresDatabase.ts`

- Declared exports: `module.exports`
- Imports (7)
  - `./config/index.ts`
  - `./db/postgresQueryCompat.ts`
  - `./permissions.ts`
  - `bcryptjs`
  - `fs`
  - `path`
  - `pg-native`
- Internal dependencies (3)
  - `backend/src/config/index.ts`
  - `backend/src/db/postgresQueryCompat.ts`
  - `backend/src/permissions.ts`
- Referenced by (2)
  - `backend/src/database.ts`
  - `backend/test/postgresDatabase.test.ts`

### 3.116 `backend/src/productBatches.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `./database.ts`
- Internal dependencies (1)
  - `backend/src/database.ts`
- Referenced by (7)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/src/routes/inventory.ts`
  - `backend/src/routes/products.ts`
  - `backend/src/routes/returns.ts`
  - `backend/src/routes/sales.ts`
  - `backend/src/services/importJobs.ts`

### 3.117 `backend/src/productDiscounts.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `./money.ts`
- Internal dependencies (1)
  - `backend/src/money.ts`
- Referenced by (3)
  - `backend/src/routes/inventory.ts`
  - `backend/src/routes/products.ts`
  - `backend/src/services/importJobs.ts`

### 3.118 `backend/src/productImportPolicies.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `./importParsing.ts`
- Internal dependencies (1)
  - `backend/src/importParsing.ts`
- Referenced by (3)
  - `backend/src/routes/products.ts`
  - `backend/src/services/importJobs.ts`
  - `backend/test/productImportPolicies.test.ts`

### 3.119 `backend/src/requestContext.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `async_hooks`
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/src/helpers.ts`

### 3.120 `backend/src/routes/actionHistory.ts`

- Declared exports: `module.exports`
- Imports (5)
  - `../database.ts`
  - `../helpers.ts`
  - `../middleware.ts`
  - `../permissions.ts`
  - `express`
- Internal dependencies (4)
  - `backend/src/database.ts`
  - `backend/src/helpers.ts`
  - `backend/src/middleware.ts`
  - `backend/src/permissions.ts`
- Referenced by (2)
  - `backend/server.js`
  - `backend/server.ts`

### 3.121 `backend/src/routes/ai.ts`

- Declared exports: `module.exports`
- Imports (6)
  - `../conflictControl.ts`
  - `../database.ts`
  - `../helpers.ts`
  - `../middleware.ts`
  - `../services/aiGateway.ts`
  - `express`
- Internal dependencies (5)
  - `backend/src/conflictControl.ts`
  - `backend/src/database.ts`
  - `backend/src/helpers.ts`
  - `backend/src/middleware.ts`
  - `backend/src/services/aiGateway.ts`
- Referenced by (2)
  - `backend/server.js`
  - `backend/server.ts`

### 3.122 `backend/src/routes/auth.ts`

- Declared exports: `module.exports`
- Imports (19)
  - `../accessControl.ts`
  - `../authOtpGuards.ts`
  - `../config/index.ts`
  - `../database.ts`
  - `../helpers.ts`
  - `../middleware.ts`
  - `../organizationContext/index.ts`
  - `../runtimeState/index.ts`
  - `../runtimeVersion.ts`
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
- Internal dependencies (14)
  - `backend/src/accessControl.ts`
  - `backend/src/authOtpGuards.ts`
  - `backend/src/config/index.ts`
  - `backend/src/database.ts`
  - `backend/src/helpers.ts`
  - `backend/src/middleware.ts`
  - `backend/src/organizationContext/index.ts`
  - `backend/src/runtimeState/index.ts`
  - `backend/src/runtimeVersion.ts`
  - `backend/src/security.ts`
  - `backend/src/services/googleOauth.ts`
  - `backend/src/services/verification.ts`
  - `backend/src/sessionAuth.ts`
  - `backend/src/settingsSnapshot.ts`
- Referenced by (3)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/test/routeContracts.test.ts`

### 3.123 `backend/src/routes/branches.ts`

- Declared exports: `module.exports`
- Imports (8)
  - `../businessMetrics.ts`
  - `../conflictControl.ts`
  - `../database.ts`
  - `../helpers.ts`
  - `../middleware.ts`
  - `../schemaMetadata.ts`
  - `crypto`
  - `express`
- Internal dependencies (6)
  - `backend/src/businessMetrics.ts`
  - `backend/src/conflictControl.ts`
  - `backend/src/database.ts`
  - `backend/src/helpers.ts`
  - `backend/src/middleware.ts`
  - `backend/src/schemaMetadata.ts`
- Referenced by (2)
  - `backend/server.js`
  - `backend/server.ts`

### 3.124 `backend/src/routes/catalog.ts`

- Declared exports: `module.exports`
- Imports (4)
  - `../database.ts`
  - `../helpers.ts`
  - `../settingsSnapshot.ts`
  - `express`
- Internal dependencies (3)
  - `backend/src/database.ts`
  - `backend/src/helpers.ts`
  - `backend/src/settingsSnapshot.ts`
- Referenced by (3)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/test/routeContracts.test.ts`

### 3.125 `backend/src/routes/categories.ts`

- Declared exports: `module.exports`
- Imports (6)
  - `../catalogTextIntegrity.ts`
  - `../conflictControl.ts`
  - `../database.ts`
  - `../helpers.ts`
  - `../middleware.ts`
  - `express`
- Internal dependencies (5)
  - `backend/src/catalogTextIntegrity.ts`
  - `backend/src/conflictControl.ts`
  - `backend/src/database.ts`
  - `backend/src/helpers.ts`
  - `backend/src/middleware.ts`
- Referenced by (3)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/test/routeContracts.test.ts`

### 3.126 `backend/src/routes/contacts.ts`

- Declared exports: `module.exports`
- Imports (6)
  - `../conflictControl.ts`
  - `../contactOptions.ts`
  - `../database.ts`
  - `../helpers.ts`
  - `../middleware.ts`
  - `express`
- Internal dependencies (5)
  - `backend/src/conflictControl.ts`
  - `backend/src/contactOptions.ts`
  - `backend/src/database.ts`
  - `backend/src/helpers.ts`
  - `backend/src/middleware.ts`
- Referenced by (2)
  - `backend/server.js`
  - `backend/server.ts`

### 3.127 `backend/src/routes/customTables.ts`

- Declared exports: `module.exports`
- Imports (6)
  - `../conflictControl.ts`
  - `../database.ts`
  - `../helpers.ts`
  - `../middleware.ts`
  - `../schemaMetadata.ts`
  - `express`
- Internal dependencies (5)
  - `backend/src/conflictControl.ts`
  - `backend/src/database.ts`
  - `backend/src/helpers.ts`
  - `backend/src/middleware.ts`
  - `backend/src/schemaMetadata.ts`
- Referenced by (2)
  - `backend/server.js`
  - `backend/server.ts`

### 3.128 `backend/src/routes/files.ts`

- Declared exports: `module.exports`
- Imports (6)
  - `../conflictControl.ts`
  - `../fileAssets.ts`
  - `../helpers.ts`
  - `../middleware.ts`
  - `../services/mediaQueue.ts`
  - `express`
- Internal dependencies (5)
  - `backend/src/conflictControl.ts`
  - `backend/src/fileAssets.ts`
  - `backend/src/helpers.ts`
  - `backend/src/middleware.ts`
  - `backend/src/services/mediaQueue.ts`
- Referenced by (3)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/test/routeContracts.test.ts`

### 3.129 `backend/src/routes/importJobs.ts`

- Declared exports: `module.exports`
- Imports (9)
  - `../config/index.ts`
  - `../fileAssets.ts`
  - `../helpers.ts`
  - `../middleware.ts`
  - `../services/importJobs.ts`
  - `express`
  - `fs`
  - `multer`
  - `path`
- Internal dependencies (5)
  - `backend/src/config/index.ts`
  - `backend/src/fileAssets.ts`
  - `backend/src/helpers.ts`
  - `backend/src/middleware.ts`
  - `backend/src/services/importJobs.ts`
- Referenced by (2)
  - `backend/server.js`
  - `backend/server.ts`

### 3.130 `backend/src/routes/inventory.ts`

- Declared exports: `module.exports`
- Imports (12)
  - `../businessMetrics.ts`
  - `../catalogTextIntegrity.ts`
  - `../database.ts`
  - `../helpers.ts`
  - `../idempotency.ts`
  - `../initials.ts`
  - `../middleware.ts`
  - `../money.ts`
  - `../productBatches.ts`
  - `../productDiscounts.ts`
  - `../schemaMetadata.ts`
  - `express`
- Internal dependencies (11)
  - `backend/src/businessMetrics.ts`
  - `backend/src/catalogTextIntegrity.ts`
  - `backend/src/database.ts`
  - `backend/src/helpers.ts`
  - `backend/src/idempotency.ts`
  - `backend/src/initials.ts`
  - `backend/src/middleware.ts`
  - `backend/src/money.ts`
  - `backend/src/productBatches.ts`
  - `backend/src/productDiscounts.ts`
  - `backend/src/schemaMetadata.ts`
- Referenced by (3)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/test/routeContracts.test.ts`

### 3.131 `backend/src/routes/notifications.ts`

- Declared exports: `module.exports`
- Imports (5)
  - `../businessMetrics.ts`
  - `../database.ts`
  - `../middleware.ts`
  - `../services/googleDriveSync/index.ts`
  - `express`
- Internal dependencies (4)
  - `backend/src/businessMetrics.ts`
  - `backend/src/database.ts`
  - `backend/src/middleware.ts`
  - `backend/src/services/googleDriveSync/index.ts`
- Referenced by (4)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/test/notificationSummaryCache.test.ts`
  - `backend/test/routeContracts.test.ts`

### 3.132 `backend/src/routes/organizations.ts`

- Declared exports: `module.exports`
- Imports (3)
  - `../middleware.ts`
  - `../organizationContext/index.ts`
  - `express`
- Internal dependencies (2)
  - `backend/src/middleware.ts`
  - `backend/src/organizationContext/index.ts`
- Referenced by (3)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/test/routeContracts.test.ts`

### 3.133 `backend/src/routes/portal.ts`

- Declared exports: `module.exports`
- Imports (13)
  - `../database.ts`
  - `../fileAssets.ts`
  - `../helpers.ts`
  - `../initials.ts`
  - `../middleware.ts`
  - `../netSecurity.ts`
  - `../organizationContext/index.ts`
  - `../portalUtils.ts`
  - `../runtimeCache.ts`
  - `../security.ts`
  - `../services/portalAi.ts`
  - `../settingsSnapshot.ts`
  - `express`
- Internal dependencies (12)
  - `backend/src/database.ts`
  - `backend/src/fileAssets.ts`
  - `backend/src/helpers.ts`
  - `backend/src/initials.ts`
  - `backend/src/middleware.ts`
  - `backend/src/netSecurity.ts`
  - `backend/src/organizationContext/index.ts`
  - `backend/src/portalUtils.ts`
  - `backend/src/runtimeCache.ts`
  - `backend/src/security.ts`
  - `backend/src/services/portalAi.ts`
  - `backend/src/settingsSnapshot.ts`
- Referenced by (3)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/test/routeContracts.test.ts`

### 3.134 `backend/src/routes/products.ts`

- Declared exports: `module.exports`
- Imports (21)
  - `../businessMetrics.ts`
  - `../catalogTextIntegrity.ts`
  - `../config/index.ts`
  - `../conflictControl.ts`
  - `../database.ts`
  - `../fileAssets.ts`
  - `../helpers.ts`
  - `../idempotency.ts`
  - `../initials.ts`
  - `../middleware.ts`
  - `../money.ts`
  - `../netSecurity.ts`
  - `../productBatches.ts`
  - `../productDiscounts.ts`
  - `../productImportPolicies.ts`
  - `../runtimeCache.ts`
  - `../schemaMetadata.ts`
  - `../settingsSnapshot.ts`
  - `express`
  - `fs`
  - `path`
- Internal dependencies (18)
  - `backend/src/businessMetrics.ts`
  - `backend/src/catalogTextIntegrity.ts`
  - `backend/src/config/index.ts`
  - `backend/src/conflictControl.ts`
  - `backend/src/database.ts`
  - `backend/src/fileAssets.ts`
  - `backend/src/helpers.ts`
  - `backend/src/idempotency.ts`
  - `backend/src/initials.ts`
  - `backend/src/middleware.ts`
  - `backend/src/money.ts`
  - `backend/src/netSecurity.ts`
  - `backend/src/productBatches.ts`
  - `backend/src/productDiscounts.ts`
  - `backend/src/productImportPolicies.ts`
  - `backend/src/runtimeCache.ts`
  - `backend/src/schemaMetadata.ts`
  - `backend/src/settingsSnapshot.ts`
- Referenced by (3)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/test/routeContracts.test.ts`

### 3.135 `backend/src/routes/returns.ts`

- Declared exports: `module.exports`
- Imports (7)
  - `../conflictControl.ts`
  - `../database.ts`
  - `../helpers.ts`
  - `../idempotency.ts`
  - `../middleware.ts`
  - `../productBatches.ts`
  - `express`
- Internal dependencies (6)
  - `backend/src/conflictControl.ts`
  - `backend/src/database.ts`
  - `backend/src/helpers.ts`
  - `backend/src/idempotency.ts`
  - `backend/src/middleware.ts`
  - `backend/src/productBatches.ts`
- Referenced by (2)
  - `backend/server.js`
  - `backend/server.ts`

### 3.136 `backend/src/routes/runtime.ts`

- Declared exports: `module.exports`
- Imports (9)
  - `../catalogTextIntegrity.ts`
  - `../database.ts`
  - `../helpers.ts`
  - `../middleware.ts`
  - `../runtimeCache.ts`
  - `../runtimeVersion.ts`
  - `../services/importJobs.ts`
  - `../services/mediaQueue.ts`
  - `express`
- Internal dependencies (8)
  - `backend/src/catalogTextIntegrity.ts`
  - `backend/src/database.ts`
  - `backend/src/helpers.ts`
  - `backend/src/middleware.ts`
  - `backend/src/runtimeCache.ts`
  - `backend/src/runtimeVersion.ts`
  - `backend/src/services/importJobs.ts`
  - `backend/src/services/mediaQueue.ts`
- Referenced by (3)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/test/routeContracts.test.ts`

### 3.137 `backend/src/routes/sales.ts`

- Declared exports: `module.exports`
- Imports (8)
  - `../businessMetrics.ts`
  - `../conflictControl.ts`
  - `../database.ts`
  - `../helpers.ts`
  - `../idempotency.ts`
  - `../middleware.ts`
  - `../productBatches.ts`
  - `express`
- Internal dependencies (7)
  - `backend/src/businessMetrics.ts`
  - `backend/src/conflictControl.ts`
  - `backend/src/database.ts`
  - `backend/src/helpers.ts`
  - `backend/src/idempotency.ts`
  - `backend/src/middleware.ts`
  - `backend/src/productBatches.ts`
- Referenced by (3)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/test/routeContracts.test.ts`

### 3.138 `backend/src/routes/settings.ts`

- Declared exports: `module.exports`
- Imports (9)
  - `../catalogTextIntegrity.ts`
  - `../conflictControl.ts`
  - `../database.ts`
  - `../fileAssets.ts`
  - `../helpers.ts`
  - `../middleware.ts`
  - `../schemaMetadata.ts`
  - `../settingsSnapshot.ts`
  - `express`
- Internal dependencies (8)
  - `backend/src/catalogTextIntegrity.ts`
  - `backend/src/conflictControl.ts`
  - `backend/src/database.ts`
  - `backend/src/fileAssets.ts`
  - `backend/src/helpers.ts`
  - `backend/src/middleware.ts`
  - `backend/src/schemaMetadata.ts`
  - `backend/src/settingsSnapshot.ts`
- Referenced by (3)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/test/routeContracts.test.ts`

### 3.139 `backend/src/routes/sync.ts`

- Declared exports: `module.exports`
- Imports (7)
  - `../config/index.ts`
  - `../middleware.ts`
  - `../serverUtils.ts`
  - `crypto`
  - `express`
  - `fs`
  - `path`
- Internal dependencies (3)
  - `backend/src/config/index.ts`
  - `backend/src/middleware.ts`
  - `backend/src/serverUtils.ts`
- Referenced by (2)
  - `backend/server.js`
  - `backend/server.ts`

### 3.140 `backend/src/routes/system/index.ts`

- Declared exports: `module.exports`
- Imports (24)
  - `../../accessControl.ts`
  - `../../analytics/duckdbRuntime.ts`
  - `../../backupSchema.ts`
  - `../../config/index.ts`
  - `../../dataPath/index.ts`
  - `../../database.ts`
  - `../../db/cutoverReadiness.ts`
  - `../../fileAssets.ts`
  - `../../helpers.ts`
  - `../../maintenanceLock.ts`
  - `../../middleware.ts`
  - `../../objectStore.ts`
  - `../../organizationContext/index.ts`
  - `../../runtimeState/index.ts`
  - `../../security.ts`
  - `../../services/backupPackages.ts`
  - `../../services/googleDriveSync/index.ts`
  - `../../services/importJobs.ts`
  - `../../services/integrationDoctor.ts`
  - `../../systemJobs.ts`
  - `child_process`
  - `express`
  - `fs`
  - `path`
- Internal dependencies (20)
  - `backend/src/accessControl.ts`
  - `backend/src/analytics/duckdbRuntime.ts`
  - `backend/src/backupSchema.ts`
  - `backend/src/config/index.ts`
  - `backend/src/dataPath/index.ts`
  - `backend/src/database.ts`
  - `backend/src/db/cutoverReadiness.ts`
  - `backend/src/fileAssets.ts`
  - `backend/src/helpers.ts`
  - `backend/src/maintenanceLock.ts`
  - `backend/src/middleware.ts`
  - `backend/src/objectStore.ts`
  - `backend/src/organizationContext/index.ts`
  - `backend/src/runtimeState/index.ts`
  - `backend/src/security.ts`
  - `backend/src/services/backupPackages.ts`
  - `backend/src/services/googleDriveSync/index.ts`
  - `backend/src/services/importJobs.ts`
  - `backend/src/services/integrationDoctor.ts`
  - `backend/src/systemJobs.ts`
- Referenced by (3)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/test/routeContracts.test.ts`

### 3.141 `backend/src/routes/units.ts`

- Declared exports: `module.exports`
- Imports (6)
  - `../catalogTextIntegrity.ts`
  - `../conflictControl.ts`
  - `../database.ts`
  - `../helpers.ts`
  - `../middleware.ts`
  - `express`
- Internal dependencies (5)
  - `backend/src/catalogTextIntegrity.ts`
  - `backend/src/conflictControl.ts`
  - `backend/src/database.ts`
  - `backend/src/helpers.ts`
  - `backend/src/middleware.ts`
- Referenced by (3)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/test/routeContracts.test.ts`

### 3.142 `backend/src/routes/users.ts`

- Declared exports: `module.exports`
- Imports (11)
  - `../conflictControl.ts`
  - `../database.ts`
  - `../fileAssets.ts`
  - `../helpers.ts`
  - `../middleware.ts`
  - `../organizationContext/index.ts`
  - `../services/googleOauth.ts`
  - `../services/verification.ts`
  - `../sessionAuth.ts`
  - `bcryptjs`
  - `express`
- Internal dependencies (9)
  - `backend/src/conflictControl.ts`
  - `backend/src/database.ts`
  - `backend/src/fileAssets.ts`
  - `backend/src/helpers.ts`
  - `backend/src/middleware.ts`
  - `backend/src/organizationContext/index.ts`
  - `backend/src/services/googleOauth.ts`
  - `backend/src/services/verification.ts`
  - `backend/src/sessionAuth.ts`
- Referenced by (2)
  - `backend/server.js`
  - `backend/server.ts`

### 3.143 `backend/src/runtimeCache.ts`

- Declared exports: `module.exports`
- Imports (2)
  - `./config/index.ts`
  - `ioredis`
- Internal dependencies (1)
  - `backend/src/config/index.ts`
- Referenced by (5)
  - `backend/src/helpers.ts`
  - `backend/src/routes/portal.ts`
  - `backend/src/routes/products.ts`
  - `backend/src/routes/runtime.ts`
  - `backend/test/runtimeCache.test.ts`

### 3.144 `backend/src/runtimeState/index.ts`

- Declared exports: `module.exports`
- Imports (4)
  - `../config/index.ts`
  - `crypto`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `backend/src/config/index.ts`
- Referenced by (2)
  - `backend/src/routes/auth.ts`
  - `backend/src/routes/system/index.ts`

### 3.145 `backend/src/runtimeVersion.ts`

- Declared exports: `module.exports`
- Imports (5)
  - `../package.json`
  - `child_process`
  - `crypto`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `backend/package.json`
- Referenced by (6)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/src/routes/auth.ts`
  - `backend/src/routes/runtime.ts`
  - `backend/src/services/googleDriveSync/index.ts`
  - `backend/test/runtimeVersion.test.ts`

### 3.146 `backend/src/schemaMetadata.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `./database.ts`
- Internal dependencies (1)
  - `backend/src/database.ts`
- Referenced by (6)
  - `backend/src/routes/branches.ts`
  - `backend/src/routes/customTables.ts`
  - `backend/src/routes/inventory.ts`
  - `backend/src/routes/products.ts`
  - `backend/src/routes/settings.ts`
  - `backend/test/schemaMetadata.test.ts`

### 3.147 `backend/src/security.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `crypto`
- Internal dependencies (0)
  - none
- Referenced by (7)
  - `backend/src/middleware.ts`
  - `backend/src/routes/auth.ts`
  - `backend/src/routes/portal.ts`
  - `backend/src/routes/system/index.ts`
  - `backend/src/services/aiGateway.ts`
  - `backend/src/services/googleDriveSync/index.ts`
  - `backend/test/security.test.ts`

### 3.148 `backend/src/serverUtils.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `./config/index.ts`
- Internal dependencies (1)
  - `backend/src/config/index.ts`
- Referenced by (5)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/src/routes/sync.ts`
  - `backend/src/websocket.ts`
  - `backend/test/serverUtils.test.ts`

### 3.149 `backend/src/services/aiGateway.ts`

- Declared exports: `module.exports`
- Imports (2)
  - `../netSecurity.ts`
  - `../security.ts`
- Internal dependencies (2)
  - `backend/src/netSecurity.ts`
  - `backend/src/security.ts`
- Referenced by (2)
  - `backend/src/routes/ai.ts`
  - `backend/src/services/portalAi.ts`

### 3.150 `backend/src/services/backupPackages.ts`

- Declared exports: `module.exports`
- Imports (9)
  - `../backupSchema.ts`
  - `../config/index.ts`
  - `../database.ts`
  - `../objectStore.ts`
  - `crypto`
  - `fs`
  - `path`
  - `stream`
  - `stream/promises`
- Internal dependencies (4)
  - `backend/src/backupSchema.ts`
  - `backend/src/config/index.ts`
  - `backend/src/database.ts`
  - `backend/src/objectStore.ts`
- Referenced by (4)
  - `backend/src/routes/system/index.ts`
  - `backend/src/services/googleDriveSync/index.ts`
  - `backend/src/services/integrationDoctor.ts`
  - `backend/test/backupRetention.test.ts`

### 3.151 `backend/src/services/firebaseAuth.ts`

- Declared exports: `module.exports`
- Imports (2)
  - `crypto`
  - `fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.152 `backend/src/services/googleDriveSync/index.ts`

- Declared exports: `module.exports`
- Imports (12)
  - `../../config/index.ts`
  - `../../dataPath/index.ts`
  - `../../database.ts`
  - `../../maintenanceLock.ts`
  - `../../runtimeVersion.ts`
  - `../../security.ts`
  - `../backupPackages.ts`
  - `./versioning.ts`
  - `crypto`
  - `fs`
  - `os`
  - `path`
- Internal dependencies (8)
  - `backend/src/config/index.ts`
  - `backend/src/dataPath/index.ts`
  - `backend/src/database.ts`
  - `backend/src/maintenanceLock.ts`
  - `backend/src/runtimeVersion.ts`
  - `backend/src/security.ts`
  - `backend/src/services/backupPackages.ts`
  - `backend/src/services/googleDriveSync/versioning.ts`
- Referenced by (4)
  - `backend/src/helpers.ts`
  - `backend/src/routes/notifications.ts`
  - `backend/src/routes/system/index.ts`
  - `backend/src/services/integrationDoctor.ts`

### 3.153 `backend/src/services/googleDriveSync/versioning.ts`

- Declared exports: `module.exports`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/services/googleDriveSync/index.ts`
  - `backend/test/googleDriveSyncVersioning.test.ts`

### 3.154 `backend/src/services/googleOauth.ts`

- Declared exports: `module.exports`
- Imports (2)
  - `../config/index.ts`
  - `crypto`
- Internal dependencies (1)
  - `backend/src/config/index.ts`
- Referenced by (4)
  - `backend/src/routes/auth.ts`
  - `backend/src/routes/users.ts`
  - `backend/src/services/integrationDoctor.ts`
  - `backend/test/ownedGoogleAuth.test.ts`

### 3.155 `backend/src/services/importJobs.ts`

- Declared exports: `module.exports`
- Imports (20)
  - `../catalogTextIntegrity.ts`
  - `../config/index.ts`
  - `../contactOptions.ts`
  - `../database.ts`
  - `../fileAssets.ts`
  - `../helpers.ts`
  - `../importCsv.ts`
  - `../money.ts`
  - `../netSecurity.ts`
  - `../productBatches.ts`
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
  - `backend/src/config/index.ts`
  - `backend/src/contactOptions.ts`
  - `backend/src/database.ts`
  - `backend/src/fileAssets.ts`
  - `backend/src/helpers.ts`
  - `backend/src/importCsv.ts`
  - `backend/src/money.ts`
  - `backend/src/netSecurity.ts`
  - `backend/src/productBatches.ts`
  - `backend/src/productDiscounts.ts`
  - `backend/src/productImportPolicies.ts`
  - `backend/src/services/mediaQueue.ts`
  - `backend/src/uploadSecurity.ts`
- Referenced by (8)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/src/routes/importJobs.ts`
  - `backend/src/routes/runtime.ts`
  - `backend/src/routes/system/index.ts`
  - `backend/src/services/integrationDoctor.ts`
  - `backend/src/workers/importWorker.ts`
  - `backend/test/importJobStateMachine.test.ts`

### 3.156 `backend/src/services/integrationDoctor.ts`

- Declared exports: `module.exports`
- Imports (10)
  - `../analytics/duckdbRuntime.ts`
  - `../config/index.ts`
  - `../database.ts`
  - `../objectStore.ts`
  - `./backupPackages.ts`
  - `./googleDriveSync/index.ts`
  - `./googleOauth.ts`
  - `./importJobs.ts`
  - `fs`
  - `path`
- Internal dependencies (8)
  - `backend/src/analytics/duckdbRuntime.ts`
  - `backend/src/config/index.ts`
  - `backend/src/database.ts`
  - `backend/src/objectStore.ts`
  - `backend/src/services/backupPackages.ts`
  - `backend/src/services/googleDriveSync/index.ts`
  - `backend/src/services/googleOauth.ts`
  - `backend/src/services/importJobs.ts`
- Referenced by (2)
  - `backend/src/routes/system/index.ts`
  - `backend/test/integrationDoctor.test.ts`

### 3.157 `backend/src/services/mediaQueue.ts`

- Declared exports: `module.exports`
- Imports (5)
  - `../config/index.ts`
  - `../database.ts`
  - `../fileAssets.ts`
  - `bullmq`
  - `ioredis`
- Internal dependencies (3)
  - `backend/src/config/index.ts`
  - `backend/src/database.ts`
  - `backend/src/fileAssets.ts`
- Referenced by (5)
  - `backend/src/routes/files.ts`
  - `backend/src/routes/runtime.ts`
  - `backend/src/services/importJobs.ts`
  - `backend/src/workers/mediaWorker.ts`
  - `backend/test/importJobStateMachine.test.ts`

### 3.158 `backend/src/services/portalAi.ts`

- Declared exports: `module.exports`
- Imports (2)
  - `../database.ts`
  - `./aiGateway.ts`
- Internal dependencies (2)
  - `backend/src/database.ts`
  - `backend/src/services/aiGateway.ts`
- Referenced by (1)
  - `backend/src/routes/portal.ts`

### 3.159 `backend/src/services/verification.ts`

- Declared exports: `module.exports`
- Imports (2)
  - `../database.ts`
  - `crypto`
- Internal dependencies (1)
  - `backend/src/database.ts`
- Referenced by (2)
  - `backend/src/routes/auth.ts`
  - `backend/src/routes/users.ts`

### 3.160 `backend/src/sessionAuth.ts`

- Declared exports: `module.exports`
- Imports (2)
  - `./database.ts`
  - `crypto`
- Internal dependencies (1)
  - `backend/src/database.ts`
- Referenced by (4)
  - `backend/src/middleware.ts`
  - `backend/src/routes/auth.ts`
  - `backend/src/routes/users.ts`
  - `backend/src/websocket.ts`

### 3.161 `backend/src/settingsSnapshot.ts`

- Declared exports: `module.exports`
- Imports (4)
  - `./config/index.ts`
  - `./objectStore.ts`
  - `fs`
  - `path`
- Internal dependencies (2)
  - `backend/src/config/index.ts`
  - `backend/src/objectStore.ts`
- Referenced by (8)
  - `backend/src/fileAssets.ts`
  - `backend/src/routes/auth.ts`
  - `backend/src/routes/catalog.ts`
  - `backend/src/routes/portal.ts`
  - `backend/src/routes/products.ts`
  - `backend/src/routes/settings.ts`
  - `backend/src/uploadReferenceCleanup.ts`
  - `backend/test/settingsSnapshotObjectStorage.test.ts`

### 3.162 `backend/src/storage/organizationFolders.ts`

- Declared exports: `module.exports`
- Imports (2)
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `backend/src/config/index.ts`
  - `backend/src/organizationContext/index.ts`

### 3.163 `backend/src/systemFsWorker.ts`

- Declared exports: none detected
- Imports (3)
  - `./dataPath/index.ts`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `backend/src/dataPath/index.ts`
- Referenced by (0)
  - none

### 3.164 `backend/src/systemJobs.ts`

- Declared exports: `module.exports`
- Imports (2)
  - `./database.ts`
  - `crypto`
- Internal dependencies (1)
  - `backend/src/database.ts`
- Referenced by (2)
  - `backend/src/routes/system/index.ts`
  - `backend/test/systemJobs.test.ts`

### 3.165 `backend/src/uploadReferenceCleanup.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `./settingsSnapshot.ts`
- Internal dependencies (1)
  - `backend/src/settingsSnapshot.ts`
- Referenced by (2)
  - `backend/src/fileAssets.ts`
  - `backend/test/settingsSnapshotObjectStorage.test.ts`

### 3.166 `backend/src/uploadSecurity.ts`

- Declared exports: `module.exports`
- Imports (2)
  - `./optionalSharp.ts`
  - `fs`
- Internal dependencies (1)
  - `backend/src/optionalSharp.ts`
- Referenced by (4)
  - `backend/src/fileAssets.ts`
  - `backend/src/middleware.ts`
  - `backend/src/services/importJobs.ts`
  - `backend/test/uploadSecurity.test.ts`

### 3.167 `backend/src/websocket.ts`

- Declared exports: `module.exports`
- Imports (5)
  - `./helpers.ts`
  - `./serverUtils.ts`
  - `./sessionAuth.ts`
  - `http`
  - `ws`
- Internal dependencies (3)
  - `backend/src/helpers.ts`
  - `backend/src/serverUtils.ts`
  - `backend/src/sessionAuth.ts`
- Referenced by (3)
  - `backend/server.js`
  - `backend/server.ts`
  - `backend/test/websocket.test.ts`

### 3.168 `backend/src/workers/importWorker.ts`

- Declared exports: `module.exports`
- Imports (2)
  - `../database.ts`
  - `../services/importJobs.ts`
- Internal dependencies (2)
  - `backend/src/database.ts`
  - `backend/src/services/importJobs.ts`
- Referenced by (2)
  - `backend/server.js`
  - `backend/server.ts`

### 3.169 `backend/src/workers/mediaWorker.ts`

- Declared exports: `module.exports`
- Imports (2)
  - `../database.ts`
  - `../services/mediaQueue.ts`
- Internal dependencies (2)
  - `backend/src/database.ts`
  - `backend/src/services/mediaQueue.ts`
- Referenced by (2)
  - `backend/server.js`
  - `backend/server.ts`

### 3.170 `backend/test/accessControl.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/accessControl.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/accessControl.ts`
- Referenced by (0)
  - none

### 3.171 `backend/test/analyticsRuntime.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/analytics/duckdbRuntime.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/analytics/duckdbRuntime.ts`
- Referenced by (0)
  - none

### 3.172 `backend/test/authOtpGuards.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/authOtpGuards.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/authOtpGuards.ts`
- Referenced by (0)
  - none

### 3.173 `backend/test/authSecurityFlow.test.ts`

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

### 3.174 `backend/test/backupDefaultDestination.test.ts`

- Declared exports: none detected
- Imports (3)
  - `fs`
  - `node:assert/strict`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.175 `backend/test/backupPerformanceHardening.test.ts`

- Declared exports: none detected
- Imports (3)
  - `node:assert/strict`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.176 `backend/test/backupRetention.test.ts`

- Declared exports: none detected
- Imports (5)
  - `../src/services/backupPackages.ts`
  - `node:assert/strict`
  - `node:fs`
  - `node:os`
  - `node:path`
- Internal dependencies (1)
  - `backend/src/services/backupPackages.ts`
- Referenced by (0)
  - none

### 3.177 `backend/test/backupSchema.test.ts`

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

### 3.178 `backend/test/branchStockSearch.test.ts`

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

### 3.179 `backend/test/contactOptions.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/contactOptions.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/contactOptions.ts`
- Referenced by (0)
  - none

### 3.180 `backend/test/dataPath.test.ts`

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

### 3.181 `backend/test/defaultRoles.test.ts`

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

### 3.182 `backend/test/fileAssetStorageReconcile.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/fileAssets.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/fileAssets.ts`
- Referenced by (0)
  - none

### 3.183 `backend/test/fileAssetUsageCache.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/database.ts`
  - `../src/fileAssets.ts`
  - `node:assert/strict`
- Internal dependencies (2)
  - `backend/src/database.ts`
  - `backend/src/fileAssets.ts`
- Referenced by (0)
  - none

### 3.184 `backend/test/fileRouteSecurityFlow.test.ts`

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

### 3.185 `backend/test/fullAutomation.test.ts`

- Declared exports: none detected
- Imports (3)
  - `node:assert/strict`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.186 `backend/test/googleDriveSyncVersioning.test.ts`

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

### 3.187 `backend/test/idempotency.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/idempotency.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/idempotency.ts`
- Referenced by (0)
  - none

### 3.188 `backend/test/importCsv.test.ts`

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

### 3.189 `backend/test/importDecisionIntegrity.test.ts`

- Declared exports: none detected
- Imports (3)
  - `fs`
  - `node:assert/strict`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.190 `backend/test/importJobPerformanceHardening.test.ts`

- Declared exports: none detected
- Imports (3)
  - `node:assert/strict`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.191 `backend/test/importJobStateMachine.test.ts`

- Declared exports: none detected
- Imports (8)
  - `../src/config/index.ts`
  - `../src/database.ts`
  - `../src/services/importJobs.ts`
  - `../src/services/mediaQueue.ts`
  - `fs`
  - `node:assert/strict`
  - `os`
  - `path`
- Internal dependencies (4)
  - `backend/src/config/index.ts`
  - `backend/src/database.ts`
  - `backend/src/services/importJobs.ts`
  - `backend/src/services/mediaQueue.ts`
- Referenced by (0)
  - none

### 3.192 `backend/test/importScaleSmoke.test.ts`

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

### 3.193 `backend/test/initials.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/initials.ts`
  - `assert`
- Internal dependencies (1)
  - `backend/src/initials.ts`
- Referenced by (0)
  - none

### 3.194 `backend/test/integrationDoctor.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/services/integrationDoctor.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/services/integrationDoctor.ts`
- Referenced by (0)
  - none

### 3.195 `backend/test/inventorySettingsMediaContracts.test.ts`

- Declared exports: none detected
- Imports (3)
  - `node:assert/strict`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.196 `backend/test/mediaOptimization.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/fileAssets.ts`
  - `node:assert/strict`
  - `sharp`
- Internal dependencies (1)
  - `backend/src/fileAssets.ts`
- Referenced by (0)
  - none

### 3.197 `backend/test/netSecurity.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/netSecurity.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/netSecurity.ts`
- Referenced by (0)
  - none

### 3.198 `backend/test/notificationSummaryCache.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/routes/notifications.ts`
  - `assert`
- Internal dependencies (1)
  - `backend/src/routes/notifications.ts`
- Referenced by (0)
  - none

### 3.199 `backend/test/offlineSecurity.test.ts`

- Declared exports: none detected
- Imports (3)
  - `assert`
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.200 `backend/test/ownedGoogleAuth.test.ts`

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

### 3.201 `backend/test/permissionPolicy.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/permissions.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/permissions.ts`
- Referenced by (0)
  - none

### 3.202 `backend/test/portalInventoryRegression.test.ts`

- Declared exports: none detected
- Imports (3)
  - `node:assert/strict`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.203 `backend/test/portalUtils.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/portalUtils.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/portalUtils.ts`
- Referenced by (0)
  - none

### 3.204 `backend/test/postgresCutoverReadiness.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/db/cutoverReadiness.ts`
  - `node:assert/strict`
  - `path`
- Internal dependencies (1)
  - `backend/src/db/cutoverReadiness.ts`
- Referenced by (0)
  - none

### 3.205 `backend/test/postgresDatabase.test.ts`

- Declared exports: none detected
- Imports (4)
  - `../src/postgresDatabase.ts`
  - `node:assert/strict`
  - `node:fs`
  - `node:path`
- Internal dependencies (1)
  - `backend/src/postgresDatabase.ts`
- Referenced by (0)
  - none

### 3.206 `backend/test/postgresQueryCompat.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/db/postgresQueryCompat.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/db/postgresQueryCompat.ts`
- Referenced by (0)
  - none

### 3.207 `backend/test/productBatchHierarchy.test.ts`

- Declared exports: none detected
- Imports (3)
  - `node:assert/strict`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.208 `backend/test/productExpiry.test.ts`

- Declared exports: none detected
- Imports (3)
  - `node:assert/strict`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.209 `backend/test/productImportPolicies.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/productImportPolicies.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/productImportPolicies.ts`
- Referenced by (0)
  - none

### 3.210 `backend/test/productSearchPagination.test.ts`

- Declared exports: none detected
- Imports (4)
  - `../runtimeCache.ts`
  - `assert`
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.211 `backend/test/rfidRoutes.test.ts`

- Declared exports: none detected
- Imports (3)
  - `fs`
  - `node:assert/strict`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.212 `backend/test/routeContracts.test.ts`

- Declared exports: none detected
- Imports (19)
  - `../src/routes/auth.ts`
  - `../src/routes/catalog.ts`
  - `../src/routes/categories.ts`
  - `../src/routes/files.ts`
  - `../src/routes/inventory.ts`
  - `../src/routes/notifications.ts`
  - `../src/routes/organizations.ts`
  - `../src/routes/portal.ts`
  - `../src/routes/products.ts`
  - `../src/routes/runtime.ts`
  - `../src/routes/sales.ts`
  - `../src/routes/settings.ts`
  - `../src/routes/system/index.ts`
  - `../src/routes/units.ts`
  - `fs`
  - `node:assert/strict`
  - `node:fs`
  - `node:path`
  - `path`
- Internal dependencies (14)
  - `backend/src/routes/auth.ts`
  - `backend/src/routes/catalog.ts`
  - `backend/src/routes/categories.ts`
  - `backend/src/routes/files.ts`
  - `backend/src/routes/inventory.ts`
  - `backend/src/routes/notifications.ts`
  - `backend/src/routes/organizations.ts`
  - `backend/src/routes/portal.ts`
  - `backend/src/routes/products.ts`
  - `backend/src/routes/runtime.ts`
  - `backend/src/routes/sales.ts`
  - `backend/src/routes/settings.ts`
  - `backend/src/routes/system/index.ts`
  - `backend/src/routes/units.ts`
- Referenced by (0)
  - none

### 3.213 `backend/test/runtimeCache.test.ts`

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

### 3.214 `backend/test/runtimeVersion.test.ts`

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

### 3.215 `backend/test/schemaMetadata.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/schemaMetadata.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/schemaMetadata.ts`
- Referenced by (0)
  - none

### 3.216 `backend/test/security.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/security.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/security.ts`
- Referenced by (0)
  - none

### 3.217 `backend/test/serverUtils.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/config/index.ts`
  - `../src/serverUtils.ts`
  - `node:assert/strict`
- Internal dependencies (2)
  - `backend/src/config/index.ts`
  - `backend/src/serverUtils.ts`
- Referenced by (0)
  - none

### 3.218 `backend/test/settingsSnapshotObjectStorage.test.ts`

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

### 3.219 `backend/test/systemJobs.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/systemJobs.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/systemJobs.ts`
- Referenced by (0)
  - none

### 3.220 `backend/test/uploadSecurity.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/fileAssets.ts`
  - `../src/uploadSecurity.ts`
  - `node:assert/strict`
- Internal dependencies (2)
  - `backend/src/fileAssets.ts`
  - `backend/src/uploadSecurity.ts`
- Referenced by (0)
  - none

### 3.221 `backend/test/websocket.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/websocket.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `backend/src/websocket.ts`
- Referenced by (0)
  - none

### 3.222 `frontend/public/runtime-noise-guard.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.223 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.224 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.worker.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.225 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd-threads.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.226 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.227 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.228 `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.229 `frontend/public/sw.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.230 `frontend/public/theme-bootstrap.js`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.231 `frontend/src/AdminRoot.tsx`

- Declared exports: `function`
- Imports (4)
  - `./App.tsx`
  - `./AppContext.tsx`
  - `./web-api.ts`
  - `react`
- Internal dependencies (3)
  - `frontend/src/App.tsx`
  - `frontend/src/AppContext.tsx`
  - `frontend/src/web-api.ts`
- Referenced by (1)
  - `frontend/src/index.tsx`

### 3.232 `frontend/src/api/actionHistoryTransport.ts`

- Declared exports: `createActionHistory`, `getActionHistory`, `getActionHistoryUsers`, `redoActionHistory`, `undoActionHistory`, `updateActionHistory`
- Imports (3)
  - `../utils/deviceInfo.ts`
  - `./http.ts`
  - `./query.ts`
- Internal dependencies (3)
  - `frontend/src/api/http.ts`
  - `frontend/src/api/query.ts`
  - `frontend/src/utils/deviceInfo.ts`
- Referenced by (3)
  - `frontend/src/api/methods.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/web-api.ts`

### 3.233 `frontend/src/api/actorQuery.ts`

- Declared exports: `appendActorQuery`, `getCurrentUserContext`
- Imports (1)
  - `../constants.ts`
- Internal dependencies (1)
  - `frontend/src/constants.ts`
- Referenced by (5)
  - `frontend/src/api/aiTransport.ts`
  - `frontend/src/api/fileTransport.ts`
  - `frontend/src/api/userAdminTransport.ts`
  - `frontend/src/api/userReadTransport.ts`
  - `frontend/tests/apiHttp.test.ts`

### 3.234 `frontend/src/api/aiTransport.ts`

- Declared exports: `createAiProvider`, `deleteAiProvider`, `getAiProviders`, `getAiResponses`, `testAiProvider`, `updateAiProvider`
- Imports (2)
  - `./actorQuery.ts`
  - `./http.ts`
- Internal dependencies (2)
  - `frontend/src/api/actorQuery.ts`
  - `frontend/src/api/http.ts`
- Referenced by (1)
  - `frontend/src/api/methods.ts`

### 3.235 `frontend/src/api/appBootstrapTransport.ts`

- Declared exports: `getAppBootstrap`
- Imports (2)
  - `../constants`
  - `./syncRuntime.ts`
- Internal dependencies (2)
  - `frontend/src/api/syncRuntime.ts`
  - `frontend/src/constants.ts`
- Referenced by (2)
  - `frontend/src/api/methods.ts`
  - `frontend/src/web-api.ts`

### 3.236 `frontend/src/api/auditLogTransport.ts`

- Declared exports: `deleteAuditLogsRetention`, `getAuditLogs`
- Imports (4)
  - `./http.ts`
  - `./lazyLocalDb.ts`
  - `./localMirrors.ts`
  - `./query.ts`
- Internal dependencies (4)
  - `frontend/src/api/http.ts`
  - `frontend/src/api/lazyLocalDb.ts`
  - `frontend/src/api/localMirrors.ts`
  - `frontend/src/api/query.ts`
- Referenced by (0)
  - none

### 3.237 `frontend/src/api/authTransport.ts`

- Declared exports: `completeGoogleOauth`, `completePasswordReset`, `getCurrentOrganization`, `getOrganizationBootstrap`, `getVerificationCapabilities`, `login`, `logout`, `otpConfirm`, `otpDisable`, `otpSetup`, `otpStatus`, `otpVerify`, `requestPasswordResetEmail`, `resetPasswordWithOtp`, `searchOrganizations`, `startGoogleOauth`, `unlinkGoogleOauth`, `updateSessionDuration`
- Imports (2)
  - `../utils/deviceInfo.ts`
  - `./http.ts`
- Internal dependencies (2)
  - `frontend/src/api/http.ts`
  - `frontend/src/utils/deviceInfo.ts`
- Referenced by (2)
  - `frontend/src/api/methods.ts`
  - `frontend/src/web-api.ts`

### 3.238 `frontend/src/api/branchTransport.ts`

- Declared exports: `createBranch`, `deleteBranch`, `getBranchStock`, `getBranchStockIntegrity`, `getBranchSummary`, `getBranches`, `getTransfers`, `repairBranchStockIntegrity`, `transferStock`, `updateBranch`
- Imports (6)
  - `../utils/deviceInfo.ts`
  - `./expectedUpdatedAt.ts`
  - `./http.ts`
  - `./lazyLocalDb.ts`
  - `./localMirrors.ts`
  - `./query.ts`
- Internal dependencies (6)
  - `frontend/src/api/expectedUpdatedAt.ts`
  - `frontend/src/api/http.ts`
  - `frontend/src/api/lazyLocalDb.ts`
  - `frontend/src/api/localMirrors.ts`
  - `frontend/src/api/query.ts`
  - `frontend/src/utils/deviceInfo.ts`
- Referenced by (6)
  - `frontend/src/api/methods.ts`
  - `frontend/src/api/offlineSnapshotTransport.ts`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/products/Products.tsx`
  - `frontend/src/components/returns/NewSupplierReturnModal.tsx`
  - `frontend/src/web-api.ts`

### 3.239 `frontend/src/api/browserDialogs.ts`

- Declared exports: `getImageDataUrl`, `openCSVDialog`, `openImageDialog`
- Imports (1)
  - `../utils/csvImport.ts`
- Internal dependencies (1)
  - `frontend/src/utils/csvImport.ts`
- Referenced by (2)
  - `frontend/src/api/methods.ts`
  - `frontend/tests/apiHttp.test.ts`

### 3.240 `frontend/src/api/conflicts.ts`

- Declared exports: `SETTINGS_CONFLICT_META_KEYS`, `buildAttemptedReturnItems`, `buildAttemptedSettings`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `frontend/src/api/returnsTransport.ts`
  - `frontend/src/api/settingsTransport.ts`
  - `frontend/tests/apiHttp.test.ts`

### 3.241 `frontend/src/api/contactReadTransport.ts`

- Declared exports: `getCustomers`, `getDeliveryContacts`, `getSuppliers`
- Imports (4)
  - `./http.ts`
  - `./lazyLocalDb.ts`
  - `./localMirrors.ts`
  - `./query.ts`
- Internal dependencies (4)
  - `frontend/src/api/http.ts`
  - `frontend/src/api/lazyLocalDb.ts`
  - `frontend/src/api/localMirrors.ts`
  - `frontend/src/api/query.ts`
- Referenced by (7)
  - `frontend/src/components/contacts/Contacts.tsx`
  - `frontend/src/components/contacts/CustomersTab.tsx`
  - `frontend/src/components/contacts/DeliveryTab.tsx`
  - `frontend/src/components/contacts/SuppliersTab.tsx`
  - `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx`
  - `frontend/src/components/pos/POS.tsx`
  - `frontend/src/components/returns/NewSupplierReturnModal.tsx`

### 3.242 `frontend/src/api/contactsTransport.ts`

- Declared exports: `bulkImportCustomers`, `bulkImportDeliveryContacts`, `bulkImportSuppliers`, `createCustomer`, `createDeliveryContact`, `createSupplier`, `deleteCustomer`, `deleteDeliveryContact`, `deleteSupplier`, `downloadCustomerTemplate`, `downloadSupplierTemplate`, `getCustomerPointSummaries`, `getCustomers`, `getDeliveryContacts`, `getSuppliers`, `updateCustomer`, `updateDeliveryContact`, `updateSupplier`
- Imports (9)
  - `../utils/csvTemplate.ts`
  - `../utils/deviceInfo.ts`
  - `./expectedUpdatedAt.ts`
  - `./http.ts`
  - `./localDb.ts`
  - `./localMirrors.ts`
  - `./query.ts`
  - `./queryCache.ts`
  - `./requestIds.ts`
- Internal dependencies (9)
  - `frontend/src/api/expectedUpdatedAt.ts`
  - `frontend/src/api/http.ts`
  - `frontend/src/api/localDb.ts`
  - `frontend/src/api/localMirrors.ts`
  - `frontend/src/api/query.ts`
  - `frontend/src/api/queryCache.ts`
  - `frontend/src/api/requestIds.ts`
  - `frontend/src/utils/csvTemplate.ts`
  - `frontend/src/utils/deviceInfo.ts`
- Referenced by (3)
  - `frontend/src/api/methods.ts`
  - `frontend/src/api/offlineSnapshotTransport.ts`
  - `frontend/src/components/products/forms/ProductForm.tsx`

### 3.243 `frontend/src/api/contactWriteTransport.ts`

- Declared exports: `createCustomer`, `createDeliveryContact`, `createSupplier`, `deleteCustomer`, `deleteDeliveryContact`, `deleteSupplier`, `updateCustomer`, `updateDeliveryContact`, `updateSupplier`
- Imports (3)
  - `../utils/deviceInfo.ts`
  - `./expectedUpdatedAt.ts`
  - `./http.ts`
- Internal dependencies (3)
  - `frontend/src/api/expectedUpdatedAt.ts`
  - `frontend/src/api/http.ts`
  - `frontend/src/utils/deviceInfo.ts`
- Referenced by (4)
  - `frontend/src/components/contacts/CustomersTab.tsx`
  - `frontend/src/components/contacts/DeliveryTab.tsx`
  - `frontend/src/components/contacts/SuppliersTab.tsx`
  - `frontend/src/components/pos/POS.tsx`

### 3.244 `frontend/src/api/cooldownFallbacks.ts`

- Declared exports: `clearDriveSyncStatusCooldown`, `clearNotificationSummaryMissing`, `getDriveSyncStatusFallback`, `getNotificationSummaryFallback`, `markDriveSyncStatusCooldown`, `markNotificationSummaryMissing`, `readDriveSyncStatusCooldown`, `readNotificationSummaryMissingUntil`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.245 `frontend/src/api/customTablesTransport.ts`

- Declared exports: `createCustomTable`, `deleteCustomRow`, `getCustomTableData`, `getCustomTables`, `insertCustomRow`, `updateCustomRow`
- Imports (2)
  - `./http.ts`
  - `./lazyLocalDb.ts`
- Internal dependencies (2)
  - `frontend/src/api/http.ts`
  - `frontend/src/api/lazyLocalDb.ts`
- Referenced by (1)
  - `frontend/src/components/custom-tables/CustomTables.tsx`

### 3.246 `frontend/src/api/dashboardTransport.ts`

- Declared exports: `getAnalytics`, `getDashboard`, `getDashboardStartup`
- Imports (2)
  - `./http.ts`
  - `./query.ts`
- Internal dependencies (2)
  - `frontend/src/api/http.ts`
  - `frontend/src/api/query.ts`
- Referenced by (2)
  - `frontend/src/components/dashboard/Dashboard.tsx`
  - `frontend/src/components/inventory/Inventory.tsx`

### 3.247 `frontend/src/api/driveSync.ts`

- Declared exports: `disconnectGoogleDriveSync`, `forgetGoogleDriveSyncCredentials`, `getGoogleDriveSyncStatus`, `queueGoogleDriveSyncNow`, `saveGoogleDriveSyncPreferences`, `startGoogleDriveSyncOauth`, `syncGoogleDriveNow`
- Imports (3)
  - `../constants.ts`
  - `../platform/storage/storagePolicy.ts`
  - `./http.ts`
- Internal dependencies (3)
  - `frontend/src/api/http.ts`
  - `frontend/src/constants.ts`
  - `frontend/src/platform/storage/storagePolicy.ts`
- Referenced by (1)
  - `frontend/src/api/methods.ts`

### 3.248 `frontend/src/api/expectedUpdatedAt.ts`

- Declared exports: `withExpectedUpdatedAt`, `withSettingsExpectedUpdatedAt`
- Imports (1)
  - `./localDb.ts`
- Internal dependencies (1)
  - `frontend/src/api/localDb.ts`
- Referenced by (10)
  - `frontend/src/api/branchTransport.ts`
  - `frontend/src/api/contactsTransport.ts`
  - `frontend/src/api/contactWriteTransport.ts`
  - `frontend/src/api/lookupTransport.ts`
  - `frontend/src/api/productWriteTransport.ts`
  - `frontend/src/api/returnsTransport.ts`
  - `frontend/src/api/salesTransport.ts`
  - `frontend/src/api/settingsTransport.ts`
  - `frontend/src/api/userAdminTransport.ts`
  - `frontend/tests/apiHttp.test.ts`

### 3.249 `frontend/src/api/fileTransport.ts`

- Declared exports: `deleteFileAsset`, `getFiles`, `uploadFileAsset`, `uploadUserAvatar`
- Imports (4)
  - `../utils/deviceInfo.ts`
  - `./actorQuery.ts`
  - `./multipartHeaders.ts`
  - `./query.ts`
- Internal dependencies (4)
  - `frontend/src/api/actorQuery.ts`
  - `frontend/src/api/multipartHeaders.ts`
  - `frontend/src/api/query.ts`
  - `frontend/src/utils/deviceInfo.ts`
- Referenced by (1)
  - `frontend/src/api/methods.ts`

### 3.250 `frontend/src/api/http.ts`

- Declared exports: `FRONTEND_BUILD_INFO`, `__resetApiHealthForTests`, `__resetApiWriteDedupeForTests`, `apiFetch`, `buildApiRequestDedupeKey`, `cacheClearAll`, `cacheGet`, `cacheGetStale`, `cacheInvalidate`, `cacheSet`, `clearCallLog`, `createApiVersionMismatchError`, `ensureHealthLifecycleListeners`, `ensureSyncUpdateCacheListener`, `getApiVersionMismatchCooldown`, `getCallLog`, `isApiVersionMismatchError`, `isCloudflareAccessRedirectResponse`, `isInvalidSessionError`, `isNetErr`, `isReachableServerResponseStatus`, `isRequiredRuntimeApiPath`, `isServerOnline`, `isTransientGatewayError`, `isWriteBlockedError`, `isWriteConflictError`, `markApiVersionMismatch`, `pingServerHealth`, `primeServerHealthFromRuntime`, `requireLiveServerWrite`, `route`, `shouldCompareRuntimeVersions`, `startHealthCheck`
- Imports (2)
  - `../constants.ts`
  - `../utils/deviceInfo.ts`
- Internal dependencies (2)
  - `frontend/src/constants.ts`
  - `frontend/src/utils/deviceInfo.ts`
- Referenced by (40)
  - `frontend/src/api/actionHistoryTransport.ts`
  - `frontend/src/api/aiTransport.ts`
  - `frontend/src/api/auditLogTransport.ts`
  - `frontend/src/api/authTransport.ts`
  - `frontend/src/api/branchTransport.ts`
  - `frontend/src/api/contactReadTransport.ts`
  - `frontend/src/api/contactsTransport.ts`
  - `frontend/src/api/contactWriteTransport.ts`
  - `frontend/src/api/customTablesTransport.ts`
  - `frontend/src/api/dashboardTransport.ts`
  - `frontend/src/api/driveSync.ts`
  - `frontend/src/api/importJobsTransport.ts`
  - `frontend/src/api/importTransport.ts`
  - `frontend/src/api/inventoryTransport.ts`
  - `frontend/src/api/inventoryWriteTransport.ts`
  - `frontend/src/api/localMirrors.ts`
  - `frontend/src/api/lookupTransport.ts`
  - `frontend/src/api/methods.ts`
  - `frontend/src/api/notificationSummary.ts`
  - `frontend/src/api/offlineSnapshotTransport.ts`
  - `frontend/src/api/portalHttp.ts`
  - `frontend/src/api/productImageUploadTransport.ts`
  - `frontend/src/api/productReadTransport.ts`
  - `frontend/src/api/productWriteTransport.ts`
  - `frontend/src/api/returnsTransport.ts`
  - `frontend/src/api/rfidTransport.ts`
  - `frontend/src/api/salesTransport.ts`
  - `frontend/src/api/settingsTransport.ts`
  - `frontend/src/api/systemJobs.ts`
  - `frontend/src/api/systemRuntime.ts`
  - `frontend/src/api/userAdminTransport.ts`
  - `frontend/src/api/userReadTransport.ts`
  - `frontend/src/api/websocket.ts`
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/dashboard/Dashboard.tsx`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/products/Products.tsx`
  - `frontend/src/components/shared/BackgroundImportTracker.tsx`
  - `frontend/src/utils/publicAssetUrls.ts`
  - `frontend/src/web-api.ts`

### 3.251 `frontend/src/api/httpState.ts`

- Declared exports: `getSyncServerUrl`, `getSyncToken`, `setSyncServerUrl`, `setSyncToken`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/api/methods.ts`

### 3.252 `frontend/src/api/importJobsTransport.ts`

- Declared exports: `approveImportJob`, `cancelImportJob`, `createImportJob`, `deleteImportJob`, `downloadImportJobErrors`, `getImportJob`, `getImportJobReview`, `getImportQueueStatus`, `listImportJobs`, `preflightImportJob`, `retryImportJob`, `startImportJob`, `updateImportJobDecisions`, `uploadImportJobCsv`, `uploadImportJobImages`, `uploadImportJobZip`
- Imports (4)
  - `../utils/deviceInfo.ts`
  - `./http.ts`
  - `./importTransport.ts`
  - `./query.ts`
- Internal dependencies (4)
  - `frontend/src/api/http.ts`
  - `frontend/src/api/importTransport.ts`
  - `frontend/src/api/query.ts`
  - `frontend/src/utils/deviceInfo.ts`
- Referenced by (2)
  - `frontend/src/api/methods.ts`
  - `frontend/tests/apiHttp.test.ts`

### 3.253 `frontend/src/api/importTransport.ts`

- Declared exports: `apiFormPost`, `withImportDeviceInfo`
- Imports (3)
  - `../utils/deviceInfo.ts`
  - `./http.ts`
  - `./multipartHeaders.ts`
- Internal dependencies (3)
  - `frontend/src/api/http.ts`
  - `frontend/src/api/multipartHeaders.ts`
  - `frontend/src/utils/deviceInfo.ts`
- Referenced by (2)
  - `frontend/src/api/importJobsTransport.ts`
  - `frontend/tests/apiHttp.test.ts`

### 3.254 `frontend/src/api/inventoryTransport.ts`

- Declared exports: `getInventoryBootstrap`, `getInventoryMovements`, `getInventoryReasons`, `getInventoryStats`, `getInventorySummary`, `searchInventoryProducts`
- Imports (4)
  - `./http.ts`
  - `./localMirrors.ts`
  - `./query.ts`
  - `./queryCache.ts`
- Internal dependencies (4)
  - `frontend/src/api/http.ts`
  - `frontend/src/api/localMirrors.ts`
  - `frontend/src/api/query.ts`
  - `frontend/src/api/queryCache.ts`
- Referenced by (4)
  - `frontend/src/api/methods.ts`
  - `frontend/src/api/offlineSnapshotTransport.ts`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/returns/NewSupplierReturnModal.tsx`

### 3.255 `frontend/src/api/inventoryWriteTransport.ts`

- Declared exports: `adjustStock`, `moveStockRow`, `saveInventoryReasons`, `transferInventoryStock`
- Imports (3)
  - `../utils/deviceInfo.ts`
  - `./http.ts`
  - `./requestIds.ts`
- Internal dependencies (3)
  - `frontend/src/api/http.ts`
  - `frontend/src/api/requestIds.ts`
  - `frontend/src/utils/deviceInfo.ts`
- Referenced by (3)
  - `frontend/src/api/methods.ts`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/products/Products.tsx`

### 3.256 `frontend/src/api/lazyLocalDb.ts`

- Declared exports: `getLocalDb`, `getLocalDbModule`
- Imports (1)
  - `./localDb.ts`
- Internal dependencies (1)
  - `frontend/src/api/localDb.ts`
- Referenced by (15)
  - `frontend/src/api/auditLogTransport.ts`
  - `frontend/src/api/branchTransport.ts`
  - `frontend/src/api/contactReadTransport.ts`
  - `frontend/src/api/customTablesTransport.ts`
  - `frontend/src/api/lookupTransport.ts`
  - `frontend/src/api/offlineSnapshotTransport.ts`
  - `frontend/src/api/pendingSyncTransport.ts`
  - `frontend/src/api/productReadTransport.ts`
  - `frontend/src/api/productWriteTransport.ts`
  - `frontend/src/api/queryCache.ts`
  - `frontend/src/api/returnsTransport.ts`
  - `frontend/src/api/salesTransport.ts`
  - `frontend/src/api/saleWriteTransport.ts`
  - `frontend/src/api/userAdminTransport.ts`
  - `frontend/src/api/userReadTransport.ts`

### 3.257 `frontend/src/api/localDb.ts`

- Declared exports: `buildCSVTemplate`, `clearLocalMirrorTables`, `dexieDb`, `localGetSettings`, `localGetSettingsMeta`, `localSaveSettings`, `localSaveSettingsMeta`, `parseCSV`, `replaceTableContents`, `resetLocalMirrorDb`
- Imports (3)
  - `../utils/csvImport.ts`
  - `../utils/csvTemplate.ts`
  - `dexie`
- Internal dependencies (2)
  - `frontend/src/utils/csvImport.ts`
  - `frontend/src/utils/csvTemplate.ts`
- Referenced by (8)
  - `frontend/src/api/contactsTransport.ts`
  - `frontend/src/api/expectedUpdatedAt.ts`
  - `frontend/src/api/lazyLocalDb.ts`
  - `frontend/src/api/localMirrors.ts`
  - `frontend/src/api/offlineSnapshotTransport.ts`
  - `frontend/src/api/settingsTransport.ts`
  - `frontend/src/platform/runtime/clientRuntime.ts`
  - `frontend/src/web-api.ts`

### 3.258 `frontend/src/api/localMirrors.ts`

- Declared exports: `mirrorReadResult`, `mirrorTable`, `purgeSensitiveLiveServerMirrors`, `routeMirrored`, `shouldPersistLocalMirror`
- Imports (3)
  - `../platform/storage/storagePolicy.ts`
  - `./http.ts`
  - `./localDb.ts`
- Internal dependencies (3)
  - `frontend/src/api/http.ts`
  - `frontend/src/api/localDb.ts`
  - `frontend/src/platform/storage/storagePolicy.ts`
- Referenced by (12)
  - `frontend/src/api/auditLogTransport.ts`
  - `frontend/src/api/branchTransport.ts`
  - `frontend/src/api/contactReadTransport.ts`
  - `frontend/src/api/contactsTransport.ts`
  - `frontend/src/api/inventoryTransport.ts`
  - `frontend/src/api/lookupTransport.ts`
  - `frontend/src/api/methods.ts`
  - `frontend/src/api/productReadTransport.ts`
  - `frontend/src/api/returnsTransport.ts`
  - `frontend/src/api/salesTransport.ts`
  - `frontend/src/api/settingsTransport.ts`
  - `frontend/tests/apiHttp.test.ts`

### 3.259 `frontend/src/api/lookupTransport.ts`

- Declared exports: `createCategory`, `createUnit`, `deleteCategory`, `deleteUnit`, `getCategories`, `getUnits`, `updateCategory`, `updateUnit`
- Imports (4)
  - `./expectedUpdatedAt.ts`
  - `./http.ts`
  - `./lazyLocalDb.ts`
  - `./localMirrors.ts`
- Internal dependencies (4)
  - `frontend/src/api/expectedUpdatedAt.ts`
  - `frontend/src/api/http.ts`
  - `frontend/src/api/lazyLocalDb.ts`
  - `frontend/src/api/localMirrors.ts`
- Referenced by (5)
  - `frontend/src/api/methods.ts`
  - `frontend/src/api/offlineSnapshotTransport.ts`
  - `frontend/src/components/pos/POS.tsx`
  - `frontend/src/components/products/Products.tsx`
  - `frontend/src/web-api.ts`

### 3.260 `frontend/src/api/methods.ts`

- Declared exports: `adjustStock`, `applyRfidSession`, `approveImportJob`, `askPortalAi`, `attachSaleCustomer`, `browseDir`, `bulkImportCustomers`, `bulkImportDeliveryContacts`, `bulkImportProducts`, `bulkImportSuppliers`, `cancelImportJob`, `cancelSystemJob`, `changeUserPassword`, `completeGoogleOauth`, `completePasswordReset`, `createActionHistory`, `createAiProvider`, `createBranch`, `createCategory`, `createCustomer`, `createDeliveryContact`, `createImportJob`, `createPortalSubmission`, `createProduct`, `createProductVariant`, `createReturn`, `createRfidSession`, `createRfidTag`, `createRole`, `createSale`, `createSupplier`, `createSupplierReturn`, `createUnit`, `createUser`, `deleteAiProvider`, `deleteBranch`, `deleteCategory`, `deleteCustomer`, `deleteDeliveryContact`, `deleteFileAsset`, `deleteImportJob`, `deleteProduct`, `deleteRole`, `deleteSupplier`, `deleteUnit`, `discardPendingSyncQueue`, `disconnectGoogleDriveSync`, `disconnectUserAuthProvider`, `downloadCustomerTemplate`, `downloadImportJobErrors`, `downloadImportTemplate`, `downloadSupplierTemplate`, `exportBackupFolder`, `factoryReset`, `forgetGoogleDriveSyncCredentials`, `getActionHistory`, `getAiProviders`, `getAiResponses`, `getAppBootstrap`, `getBranchStock`, `getBranchStockIntegrity`, `getBranchSummary`, `getBranches`, `getCatalogMeta`, `getCatalogProducts`, `getCategories`, `getCurrentOrganization`, `getCustomerPointSummaries`, `getCustomers`, `getDataPath`, `getDeliveryContacts`, `getFiles`, `getGoogleDriveSyncStatus`, `getImageDataUrl`, `getImportJob`, `getImportJobReview`, `getImportQueueStatus`, `getIntegrationDoctor`, `getInventoryBootstrap`, `getInventoryMovements`, `getInventoryReasons`, `getInventoryStats`, `getInventorySummary`, `getNotificationSummary`, `getOrganizationBootstrap`, `getPendingSyncState`, `getPortalAiStatus`, `getPortalBootstrap`, `getPortalCatalogMeta`, `getPortalCatalogProducts`, `getPortalConfig`, `getPortalSubmissionsForReview`, `getProductBootstrap`, `getProductFilters`, `getProductLookupUsage`, `getProducts`, `getProductsByIds`, `getReturn`, `getReturns`, `getRfidSessionReview`, `getRfidStatus`, `getRoles`, `getSales`, `getSalesExport`, `getScaleMigrationStatus`, `getSettings`, `getSuppliers`, `getSystemBootstrap`, `getSystemConfig`, `getSystemDebugLog`, `getSystemJob`, `getTransfers`, `getUnits`, `getUserAuthMethods`, `getUserProfile`, `getUsers`, `getVerificationCapabilities`, `importBackupFolder`, `listImportJobs`, `login`, `logout`, `lookupPortalMembership`, `moveStockRow`, `openCSVDialog`, `openFolderDialog`, `openImageDialog`, `openPath`, `otpConfirm`, `otpDisable`, `otpSetup`, `otpStatus`, `otpVerify`, `pollSystemJob`, `preflightImportJob`, `prepareScaleMigration`, `queueBackupFolderExport`, `queueBackupFolderRestore`, `queueGoogleDriveSyncNow`, `recordRfidSessionEvents`, `redoActionHistory`, `refreshOfflineDeviceSnapshot`, `repairBranchStockIntegrity`, `replaceProductLookupValues`, `requestPasswordResetEmail`, `resetData`, `resetDataPath`, `resetPassword`, `resetPasswordWithOtp`, `retryImportJob`, `retryPendingSyncNow`, `reviewPortalSubmission`, `runScaleMigration`, `saveGoogleDriveSyncPreferences`, `saveInventoryReasons`, `saveSettings`, `searchInventoryProducts`, `searchOrganizations`, `searchPortalCatalogProducts`, `searchProducts`, `searchRfidTags`, `setDataPath`, `startGoogleDriveSyncOauth`, `startGoogleOauth`, `startImportJob`, `syncGoogleDriveNow`, `testAiProvider`, `testSyncServer`, `transferInventoryStock`, `transferStock`, `undoActionHistory`, `unlinkGoogleOauth`, `updateActionHistory`, `updateAiProvider`, `updateBranch`, `updateCategory`, `updateCustomer`, `updateDeliveryContact`, `updateImportJobDecisions`, `updateProduct`, `updateReturn`, `updateRole`, `updateSaleStatus`, `updateSessionDuration`, `updateSupplier`, `updateUnit`, `updateUser`, `updateUserProfile`, `uploadFileAsset`, `uploadImportJobCsv`, `uploadImportJobImages`, `uploadImportJobZip`, `uploadUserAvatar`
- Imports (35)
  - `../platform/runtime/clientRuntime.ts`
  - `../utils/appRefresh.ts`
  - `../utils/csvTemplate.ts`
  - `./actionHistoryTransport.ts`
  - `./aiTransport.ts`
  - `./appBootstrapTransport.ts`
  - `./authTransport.ts`
  - `./branchTransport.ts`
  - `./browserDialogs.ts`
  - `./contactsTransport.ts`
  - `./driveSync.ts`
  - `./fileTransport.ts`
  - `./http.ts`
  - `./httpState.ts`
  - `./importJobsTransport.ts`
  - `./inventoryTransport.ts`
  - `./inventoryWriteTransport.ts`
  - `./localMirrors.ts`
  - `./lookupTransport.ts`
  - `./notificationSummary.ts`
  - `./offlineSnapshotTransport.ts`
  - `./pendingSyncTransport.ts`
  - `./portalTransport.ts`
  - `./productReadTransport.ts`
  - `./productWriteTransport.ts`
  - `./queryCache.ts`
  - `./returnsTransport.ts`
  - `./rfidTransport.ts`
  - `./saleWriteTransport.ts`
  - `./salesTransport.ts`
  - `./settingsTransport.ts`
  - `./systemJobs.ts`
  - `./systemRuntime.ts`
  - `./userAdminTransport.ts`
  - `./userReadTransport.ts`
- Internal dependencies (35)
  - `frontend/src/api/actionHistoryTransport.ts`
  - `frontend/src/api/aiTransport.ts`
  - `frontend/src/api/appBootstrapTransport.ts`
  - `frontend/src/api/authTransport.ts`
  - `frontend/src/api/branchTransport.ts`
  - `frontend/src/api/browserDialogs.ts`
  - `frontend/src/api/contactsTransport.ts`
  - `frontend/src/api/driveSync.ts`
  - `frontend/src/api/fileTransport.ts`
  - `frontend/src/api/http.ts`
  - `frontend/src/api/httpState.ts`
  - `frontend/src/api/importJobsTransport.ts`
  - `frontend/src/api/inventoryTransport.ts`
  - `frontend/src/api/inventoryWriteTransport.ts`
  - `frontend/src/api/localMirrors.ts`
  - `frontend/src/api/lookupTransport.ts`
  - `frontend/src/api/notificationSummary.ts`
  - `frontend/src/api/offlineSnapshotTransport.ts`
  - `frontend/src/api/pendingSyncTransport.ts`
  - `frontend/src/api/portalTransport.ts`
  - `frontend/src/api/productReadTransport.ts`
  - `frontend/src/api/productWriteTransport.ts`
  - `frontend/src/api/queryCache.ts`
  - `frontend/src/api/returnsTransport.ts`
  - `frontend/src/api/rfidTransport.ts`
  - `frontend/src/api/saleWriteTransport.ts`
  - `frontend/src/api/salesTransport.ts`
  - `frontend/src/api/settingsTransport.ts`
  - `frontend/src/api/systemJobs.ts`
  - `frontend/src/api/systemRuntime.ts`
  - `frontend/src/api/userAdminTransport.ts`
  - `frontend/src/api/userReadTransport.ts`
  - `frontend/src/platform/runtime/clientRuntime.ts`
  - `frontend/src/utils/appRefresh.ts`
  - `frontend/src/utils/csvTemplate.ts`
- Referenced by (1)
  - `frontend/src/web-api.ts`

### 3.261 `frontend/src/api/multipartHeaders.ts`

- Declared exports: `buildMultipartHeaders`
- Imports (1)
  - `../utils/deviceInfo.ts`
- Internal dependencies (1)
  - `frontend/src/utils/deviceInfo.ts`
- Referenced by (2)
  - `frontend/src/api/fileTransport.ts`
  - `frontend/src/api/importTransport.ts`

### 3.262 `frontend/src/api/notificationSummary.ts`

- Declared exports: `getNotificationSummary`
- Imports (2)
  - `../platform/storage/storagePolicy.ts`
  - `./http.ts`
- Internal dependencies (2)
  - `frontend/src/api/http.ts`
  - `frontend/src/platform/storage/storagePolicy.ts`
- Referenced by (2)
  - `frontend/src/api/methods.ts`
  - `frontend/src/web-api.ts`

### 3.263 `frontend/src/api/offlineSnapshotTransport.ts`

- Declared exports: `refreshOfflineDeviceSnapshot`
- Imports (10)
  - `./branchTransport.ts`
  - `./contactsTransport.ts`
  - `./http.ts`
  - `./inventoryTransport.ts`
  - `./lazyLocalDb.ts`
  - `./localDb.ts`
  - `./lookupTransport.ts`
  - `./productReadTransport.ts`
  - `./salesTransport.ts`
  - `./syncRuntime.ts`
- Internal dependencies (10)
  - `frontend/src/api/branchTransport.ts`
  - `frontend/src/api/contactsTransport.ts`
  - `frontend/src/api/http.ts`
  - `frontend/src/api/inventoryTransport.ts`
  - `frontend/src/api/lazyLocalDb.ts`
  - `frontend/src/api/localDb.ts`
  - `frontend/src/api/lookupTransport.ts`
  - `frontend/src/api/productReadTransport.ts`
  - `frontend/src/api/salesTransport.ts`
  - `frontend/src/api/syncRuntime.ts`
- Referenced by (2)
  - `frontend/src/api/methods.ts`
  - `frontend/src/web-api.ts`

### 3.264 `frontend/src/api/pendingSyncTransport.ts`

- Declared exports: `discardPendingSyncQueue`, `getPendingSyncState`, `retryPendingSyncNow`
- Imports (3)
  - `./lazyLocalDb.ts`
  - `./saleWriteTransport.ts`
  - `./syncPreview.ts`
- Internal dependencies (3)
  - `frontend/src/api/lazyLocalDb.ts`
  - `frontend/src/api/saleWriteTransport.ts`
  - `frontend/src/api/syncPreview.ts`
- Referenced by (1)
  - `frontend/src/api/methods.ts`

### 3.265 `frontend/src/api/portalHttp.ts`

- Declared exports: `fetchJsonWithTimeout`, `getPortalBaseUrl`
- Imports (1)
  - `./http.ts`
- Internal dependencies (1)
  - `frontend/src/api/http.ts`
- Referenced by (2)
  - `frontend/src/api/portalTransport.ts`
  - `frontend/tests/apiHttp.test.ts`

### 3.266 `frontend/src/api/portalTransport.ts`

- Declared exports: `askPortalAi`, `createPortalSubmission`, `getCatalogMeta`, `getCatalogProducts`, `getPortalAiStatus`, `getPortalBootstrap`, `getPortalCatalogMeta`, `getPortalCatalogProducts`, `getPortalConfig`, `getPortalSubmissionsForReview`, `lookupPortalMembership`, `reviewPortalSubmission`, `searchPortalCatalogProducts`
- Imports (2)
  - `./portalHttp.ts`
  - `./query.ts`
- Internal dependencies (2)
  - `frontend/src/api/portalHttp.ts`
  - `frontend/src/api/query.ts`
- Referenced by (5)
  - `frontend/src/api/methods.ts`
  - `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx`
  - `frontend/src/components/pos/POS.tsx`
  - `frontend/src/public-web-api.ts`
  - `frontend/src/web-api.ts`

### 3.267 `frontend/src/api/productImageUploadTransport.ts`

- Declared exports: `uploadProductImage`
- Imports (1)
  - `./http.ts`
- Internal dependencies (1)
  - `frontend/src/api/http.ts`
- Referenced by (2)
  - `frontend/src/components/products/forms/ProductForm.tsx`
  - `frontend/src/components/products/Products.tsx`

### 3.268 `frontend/src/api/productReadTransport.ts`

- Declared exports: `getProductBootstrap`, `getProductFilters`, `getProductLookupUsage`, `getProducts`, `getProductsByIds`, `replaceProductLookupValues`, `searchProducts`
- Imports (5)
  - `./http.ts`
  - `./lazyLocalDb.ts`
  - `./localMirrors.ts`
  - `./query.ts`
  - `./queryCache.ts`
- Internal dependencies (5)
  - `frontend/src/api/http.ts`
  - `frontend/src/api/lazyLocalDb.ts`
  - `frontend/src/api/localMirrors.ts`
  - `frontend/src/api/query.ts`
  - `frontend/src/api/queryCache.ts`
- Referenced by (5)
  - `frontend/src/api/methods.ts`
  - `frontend/src/api/offlineSnapshotTransport.ts`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/products/Products.tsx`
  - `frontend/src/web-api.ts`

### 3.269 `frontend/src/api/productWriteTransport.ts`

- Declared exports: `bulkImportProducts`, `createProduct`, `createProductVariant`, `deleteProduct`, `updateProduct`
- Imports (5)
  - `../utils/deviceInfo.ts`
  - `./expectedUpdatedAt.ts`
  - `./http.ts`
  - `./lazyLocalDb.ts`
  - `./requestIds.ts`
- Internal dependencies (5)
  - `frontend/src/api/expectedUpdatedAt.ts`
  - `frontend/src/api/http.ts`
  - `frontend/src/api/lazyLocalDb.ts`
  - `frontend/src/api/requestIds.ts`
  - `frontend/src/utils/deviceInfo.ts`
- Referenced by (3)
  - `frontend/src/api/methods.ts`
  - `frontend/src/components/products/Products.tsx`
  - `frontend/src/web-api.ts`

### 3.270 `frontend/src/api/query.ts`

- Declared exports: `appendQuery`, `buildQueryString`, `normalizePositiveUniqueIds`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (21)
  - `frontend/src/api/actionHistoryTransport.ts`
  - `frontend/src/api/auditLogTransport.ts`
  - `frontend/src/api/branchTransport.ts`
  - `frontend/src/api/contactReadTransport.ts`
  - `frontend/src/api/contactsTransport.ts`
  - `frontend/src/api/dashboardTransport.ts`
  - `frontend/src/api/fileTransport.ts`
  - `frontend/src/api/importJobsTransport.ts`
  - `frontend/src/api/inventoryTransport.ts`
  - `frontend/src/api/portalTransport.ts`
  - `frontend/src/api/productReadTransport.ts`
  - `frontend/src/api/returnsTransport.ts`
  - `frontend/src/api/rfidTransport.ts`
  - `frontend/src/api/salesTransport.ts`
  - `frontend/src/components/contacts/Contacts.tsx`
  - `frontend/src/components/contacts/CustomersTab.tsx`
  - `frontend/src/components/contacts/DeliveryTab.tsx`
  - `frontend/src/components/contacts/SuppliersTab.tsx`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/pos/POS.tsx`
  - `frontend/tests/apiHttp.test.ts`

### 3.271 `frontend/src/api/queryCache.ts`

- Declared exports: `buildQueryCacheStorageKey`, `clearCachedQueryResults`, `readCachedQueryResult`, `writeCachedQueryResult`
- Imports (1)
  - `./lazyLocalDb.ts`
- Internal dependencies (1)
  - `frontend/src/api/lazyLocalDb.ts`
- Referenced by (5)
  - `frontend/src/api/contactsTransport.ts`
  - `frontend/src/api/inventoryTransport.ts`
  - `frontend/src/api/methods.ts`
  - `frontend/src/api/productReadTransport.ts`
  - `frontend/tests/apiHttp.test.ts`

### 3.272 `frontend/src/api/requestIds.ts`

- Declared exports: `createClientRequestId`, `ensureClientRequestId`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `frontend/src/api/contactsTransport.ts`
  - `frontend/src/api/inventoryWriteTransport.ts`
  - `frontend/src/api/productWriteTransport.ts`
  - `frontend/src/api/returnsTransport.ts`
  - `frontend/tests/apiHttp.test.ts`

### 3.273 `frontend/src/api/returnsTransport.ts`

- Declared exports: `createReturn`, `createSupplierReturn`, `getReturn`, `getReturns`, `updateReturn`
- Imports (8)
  - `../utils/deviceInfo.ts`
  - `./conflicts.ts`
  - `./expectedUpdatedAt.ts`
  - `./http.ts`
  - `./lazyLocalDb.ts`
  - `./localMirrors.ts`
  - `./query.ts`
  - `./requestIds.ts`
- Internal dependencies (8)
  - `frontend/src/api/conflicts.ts`
  - `frontend/src/api/expectedUpdatedAt.ts`
  - `frontend/src/api/http.ts`
  - `frontend/src/api/lazyLocalDb.ts`
  - `frontend/src/api/localMirrors.ts`
  - `frontend/src/api/query.ts`
  - `frontend/src/api/requestIds.ts`
  - `frontend/src/utils/deviceInfo.ts`
- Referenced by (4)
  - `frontend/src/api/methods.ts`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/returns/NewSupplierReturnModal.tsx`
  - `frontend/src/components/returns/Returns.tsx`

### 3.274 `frontend/src/api/rfidTransport.ts`

- Declared exports: `applyRfidSession`, `createRfidSession`, `createRfidTag`, `getRfidSessionReview`, `getRfidStatus`, `recordRfidSessionEvents`, `searchRfidTags`
- Imports (3)
  - `../utils/deviceInfo.ts`
  - `./http.ts`
  - `./query.ts`
- Internal dependencies (3)
  - `frontend/src/api/http.ts`
  - `frontend/src/api/query.ts`
  - `frontend/src/utils/deviceInfo.ts`
- Referenced by (2)
  - `frontend/src/api/methods.ts`
  - `frontend/src/components/inventory/Inventory.tsx`

### 3.275 `frontend/src/api/salesTransport.ts`

- Declared exports: `attachSaleCustomer`, `createSale`, `createSaleWithoutWriteDedupe`, `getSales`, `getSalesExport`, `updateSaleStatus`
- Imports (7)
  - `../constants.ts`
  - `../utils/deviceInfo.ts`
  - `./expectedUpdatedAt.ts`
  - `./http.ts`
  - `./lazyLocalDb.ts`
  - `./localMirrors.ts`
  - `./query.ts`
- Internal dependencies (7)
  - `frontend/src/api/expectedUpdatedAt.ts`
  - `frontend/src/api/http.ts`
  - `frontend/src/api/lazyLocalDb.ts`
  - `frontend/src/api/localMirrors.ts`
  - `frontend/src/api/query.ts`
  - `frontend/src/constants.ts`
  - `frontend/src/utils/deviceInfo.ts`
- Referenced by (3)
  - `frontend/src/api/methods.ts`
  - `frontend/src/api/offlineSnapshotTransport.ts`
  - `frontend/src/components/sales/Sales.tsx`

### 3.276 `frontend/src/api/saleWriteTransport.ts`

- Declared exports: `createSale`, `syncPendingSalesQueue`
- Imports (3)
  - `../utils/deviceInfo.ts`
  - `./lazyLocalDb.ts`
  - `dexie`
- Internal dependencies (2)
  - `frontend/src/api/lazyLocalDb.ts`
  - `frontend/src/utils/deviceInfo.ts`
- Referenced by (4)
  - `frontend/src/api/methods.ts`
  - `frontend/src/api/pendingSyncTransport.ts`
  - `frontend/src/components/pos/POS.tsx`
  - `frontend/src/web-api.ts`

### 3.277 `frontend/src/api/settingsTransport.ts`

- Declared exports: `getSettings`, `saveSettings`
- Imports (7)
  - `../utils/appRefresh.ts`
  - `../utils/settingsRefresh.ts`
  - `./conflicts.ts`
  - `./expectedUpdatedAt.ts`
  - `./http.ts`
  - `./localDb.ts`
  - `./localMirrors.ts`
- Internal dependencies (7)
  - `frontend/src/api/conflicts.ts`
  - `frontend/src/api/expectedUpdatedAt.ts`
  - `frontend/src/api/http.ts`
  - `frontend/src/api/localDb.ts`
  - `frontend/src/api/localMirrors.ts`
  - `frontend/src/utils/appRefresh.ts`
  - `frontend/src/utils/settingsRefresh.ts`
- Referenced by (2)
  - `frontend/src/api/methods.ts`
  - `frontend/src/web-api.ts`

### 3.278 `frontend/src/api/syncPreview.ts`

- Declared exports: `PENDING_SYNC_PREVIEW_LIMIT`, `serializePendingSyncPreview`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/api/pendingSyncTransport.ts`
  - `frontend/tests/apiHttp.test.ts`

### 3.279 `frontend/src/api/syncRuntime.ts`

- Declared exports: `DISCARD_SYNC_UPDATE_CHANNELS`, `OFFLINE_SALE_SYNC_UPDATE_CHANNELS`, `OUTBOX_SYNC_TAG`, `dispatchSyncUpdates`, `emitSyncQueueChanged`, `hasStoredUserSession`, `registerOutboxBackgroundSync`
- Imports (1)
  - `../constants.ts`
- Internal dependencies (1)
  - `frontend/src/constants.ts`
- Referenced by (3)
  - `frontend/src/api/appBootstrapTransport.ts`
  - `frontend/src/api/offlineSnapshotTransport.ts`
  - `frontend/tests/apiHttp.test.ts`

### 3.280 `frontend/src/api/systemJobs.ts`

- Declared exports: `LONG_SYSTEM_ACTION_TIMEOUT_MS`, `cancelSystemJob`, `exportBackupFolder`, `getSystemJob`, `importBackupFolder`, `pollSystemJob`, `queueBackupFolderExport`, `queueBackupFolderRestore`
- Imports (2)
  - `../constants.ts`
  - `./http.ts`
- Internal dependencies (2)
  - `frontend/src/api/http.ts`
  - `frontend/src/constants.ts`
- Referenced by (1)
  - `frontend/src/api/methods.ts`

### 3.281 `frontend/src/api/systemRuntime.ts`

- Declared exports: `browseDir`, `factoryReset`, `getDataPath`, `getIntegrationDoctor`, `getScaleMigrationStatus`, `getSystemBootstrap`, `getSystemConfig`, `getSystemDebugLog`, `openFolderDialog`, `openPath`, `prepareScaleMigration`, `resetData`, `resetDataPath`, `runScaleMigration`, `setDataPath`, `testSyncServer`
- Imports (2)
  - `../constants`
  - `./http.ts`
- Internal dependencies (2)
  - `frontend/src/api/http.ts`
  - `frontend/src/constants.ts`
- Referenced by (2)
  - `frontend/src/api/methods.ts`
  - `frontend/src/web-api.ts`

### 3.282 `frontend/src/api/userAdminTransport.ts`

- Declared exports: `changeUserPassword`, `createRole`, `createUser`, `deleteRole`, `disconnectUserAuthProvider`, `getRoles`, `getUserAuthMethods`, `getUserProfile`, `getUsers`, `resetPassword`, `updateRole`, `updateUser`, `updateUserProfile`
- Imports (5)
  - `./actorQuery.ts`
  - `./expectedUpdatedAt.ts`
  - `./http.ts`
  - `./lazyLocalDb.ts`
  - `./userReadTransport.ts`
- Internal dependencies (5)
  - `frontend/src/api/actorQuery.ts`
  - `frontend/src/api/expectedUpdatedAt.ts`
  - `frontend/src/api/http.ts`
  - `frontend/src/api/lazyLocalDb.ts`
  - `frontend/src/api/userReadTransport.ts`
- Referenced by (1)
  - `frontend/src/api/methods.ts`

### 3.283 `frontend/src/api/userReadTransport.ts`

- Declared exports: `getUsers`
- Imports (3)
  - `./actorQuery.ts`
  - `./http.ts`
  - `./lazyLocalDb.ts`
- Internal dependencies (3)
  - `frontend/src/api/actorQuery.ts`
  - `frontend/src/api/http.ts`
  - `frontend/src/api/lazyLocalDb.ts`
- Referenced by (5)
  - `frontend/src/api/methods.ts`
  - `frontend/src/api/userAdminTransport.ts`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/sales/Sales.tsx`
  - `frontend/src/web-api.ts`

### 3.284 `frontend/src/api/websocket.ts`

- Declared exports: `connectWS`, `disconnectWS`, `ensureWebSocketLifecycleListeners`, `isWSConnected`, `reconnectWS`, `resumeWS`, `scheduleConnectWS`
- Imports (2)
  - `../constants.ts`
  - `./http.ts`
- Internal dependencies (2)
  - `frontend/src/api/http.ts`
  - `frontend/src/constants.ts`
- Referenced by (2)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/web-api.ts`

### 3.285 `frontend/src/App.tsx`

- Declared exports: `function`
- Imports (34)
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
  - `lucide-react/dist/esm/icons/arrow-down.js`
  - `lucide-react/dist/esm/icons/arrow-up.js`
  - `lucide-react/dist/esm/icons/bell.js`
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
  - `frontend/src/AdminRoot.tsx`

### 3.286 `frontend/src/app/appShellUtils.ts`

- Declared exports: `DESKTOP_WARMUP_BREAKPOINT`, `MAX_MOUNTED_PAGES`, `MOBILE_MAX_MOUNTED_PAGES`, `MOBILE_SHELL_BREAKPOINT`, `getMountedPageLimit`, `getNotificationColor`, `getNotificationPrefix`, `shouldWarmPageEntries`, `updateMountedPages`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `frontend/src/App.tsx`
  - `frontend/src/components/navigation/Sidebar.tsx`
  - `frontend/tests/appShellUtils.test.ts`

### 3.287 `frontend/src/app/pathRouting.ts`

- Declared exports: `APP_NAVIGATION_EVENT`, `APP_PAGE_INTENT_EVENT`, `getAdminPageFromPath`, `getAdminPathForPage`, `isAdminAppPath`, `isPublicCatalogPath`, `normalizeAppPath`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/index.tsx`

### 3.288 `frontend/src/app/publicErrorRecovery.ts`

- Declared exports: `clearPublicDomRecoveryMarker`, `isPublicDomMutationError`, `shouldAttemptPublicDomRecovery`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.289 `frontend/src/AppContext.tsx`

- Declared exports: `AppProvider`, `isBrokenLocalizedString`, `useApp`, `useSync`, `useT`
- Imports (14)
  - `./api/http.ts`
  - `./api/websocket.ts`
  - `./app/pathRouting.ts`
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
  - `react`
- Internal dependencies (13)
  - `frontend/src/api/http.ts`
  - `frontend/src/api/websocket.ts`
  - `frontend/src/app/pathRouting.ts`
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
- Referenced by (53)
  - `frontend/src/AdminRoot.tsx`
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
  - `frontend/src/PublicCatalogRoot.tsx`
  - `frontend/src/utils/actionHistory.ts`

### 3.290 `frontend/src/components/auth/Login.tsx`

- Declared exports: `function`
- Imports (16)
  - `../../AppContext.tsx`
  - `../../constants`
  - `../../utils/deviceInfo.ts`
  - `../shared/AppSelect.tsx`
  - `../shared/QuickPreferenceToggles`
  - `lucide-react/dist/esm/icons/arrow-left.js`
  - `lucide-react/dist/esm/icons/building-2.js`
  - `lucide-react/dist/esm/icons/chevron-down.js`
  - `lucide-react/dist/esm/icons/chevron-up.js`
  - `lucide-react/dist/esm/icons/chrome.js`
  - `lucide-react/dist/esm/icons/key-round.js`
  - `lucide-react/dist/esm/icons/loader-2.js`
  - `lucide-react/dist/esm/icons/lock-keyhole.js`
  - `lucide-react/dist/esm/icons/mail.js`
  - `lucide-react/dist/esm/icons/shield-check.js`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/shared/AppSelect.tsx`
  - `frontend/src/components/shared/QuickPreferenceToggles.tsx`
  - `frontend/src/constants.ts`
  - `frontend/src/utils/deviceInfo.ts`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.291 `frontend/src/components/branches/Branches.tsx`

- Declared exports: `function`
- Imports (18)
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
  - `lucide-react/dist/esm/icons/arrow-right-left.js`
  - `lucide-react/dist/esm/icons/building-2.js`
  - `lucide-react/dist/esm/icons/pencil.js`
  - `lucide-react/dist/esm/icons/plus.js`
  - `lucide-react/dist/esm/icons/trash-2.js`
  - `lucide-react/dist/esm/icons/warehouse.js`
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

### 3.292 `frontend/src/components/branches/BranchForm.tsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext.tsx`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.tsx`
- Referenced by (1)
  - `frontend/src/components/branches/Branches.tsx`

### 3.293 `frontend/src/components/branches/TransferModal.tsx`

- Declared exports: `function`
- Imports (4)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../shared/AppSelect.tsx`
  - `react`
- Internal dependencies (3)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/shared/AppSelect.tsx`
  - `frontend/src/utils/actionGuards.ts`
- Referenced by (1)
  - `frontend/src/components/branches/Branches.tsx`

### 3.294 `frontend/src/components/catalog/catalogAssetUrls.ts`

- Declared exports: `resolveCatalogAssetUrl`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/catalog/catalogImages.tsx`
  - `frontend/src/components/catalog/CatalogPage.tsx`

### 3.295 `frontend/src/components/catalog/CatalogEditorSurface.tsx`

- Declared exports: `function`
- Imports (17)
  - `../../utils/mediaUpload.ts`
  - `../products/shared/primitives`
  - `../shared/AppSelect.tsx`
  - `./CatalogImageField`
  - `./CatalogPageContext`
  - `./catalogUi`
  - `lucide-react/dist/esm/icons/bot.js`
  - `lucide-react/dist/esm/icons/external-link.js`
  - `lucide-react/dist/esm/icons/eye.js`
  - `lucide-react/dist/esm/icons/images.js`
  - `lucide-react/dist/esm/icons/plus.js`
  - `lucide-react/dist/esm/icons/save.js`
  - `lucide-react/dist/esm/icons/search.js`
  - `lucide-react/dist/esm/icons/shopping-bag.js`
  - `lucide-react/dist/esm/icons/sparkles.js`
  - `lucide-react/dist/esm/icons/upload.js`
  - `react`
- Internal dependencies (6)
  - `frontend/src/components/catalog/CatalogImageField.tsx`
  - `frontend/src/components/catalog/CatalogPageContext.tsx`
  - `frontend/src/components/catalog/catalogUi.tsx`
  - `frontend/src/components/products/shared/primitives.tsx`
  - `frontend/src/components/shared/AppSelect.tsx`
  - `frontend/src/utils/mediaUpload.ts`
- Referenced by (1)
  - `frontend/src/components/catalog/CatalogPage.tsx`

### 3.296 `frontend/src/components/catalog/CatalogImageField.tsx`

- Declared exports: `function`
- Imports (3)
  - `../../utils/mediaUpload.ts`
  - `lucide-react/dist/esm/icons/eye.js`
  - `lucide-react/dist/esm/icons/upload.js`
- Internal dependencies (1)
  - `frontend/src/utils/mediaUpload.ts`
- Referenced by (1)
  - `frontend/src/components/catalog/CatalogEditorSurface.tsx`

### 3.297 `frontend/src/components/catalog/catalogImages.tsx`

- Declared exports: `function`
- Imports (2)
  - `./catalogAssetUrls`
  - `react`
- Internal dependencies (1)
  - `frontend/src/components/catalog/catalogAssetUrls.ts`
- Referenced by (2)
  - `frontend/src/components/catalog/CatalogPreviewSurface.tsx`
  - `frontend/src/components/catalog/CatalogProductsSection.tsx`

### 3.298 `frontend/src/components/catalog/CatalogPage.tsx`

- Declared exports: `function`
- Imports (43)
  - `../../AppContext`
  - `../../utils/actionGuards.ts`
  - `../../utils/favicon.ts`
  - `../../utils/initials.ts`
  - `../products/helpers/productFilterHelpers.ts`
  - `../shared/pageActivity`
  - `./CatalogEditorSurface`
  - `./CatalogPageContext`
  - `./CatalogPreviewSurface`
  - `./CatalogProductsSection`
  - `./CatalogSecondaryTabs`
  - `./catalogAssetUrls`
  - `./catalogUi`
  - `./portalContentI18n.ts`
  - `./portalLanguagePacks.ts`
  - `./portalTranslateController.ts`
  - `lucide-react`
  - `lucide-react/dist/esm/icons/badge-dollar-sign.js`
  - `lucide-react/dist/esm/icons/bot.js`
  - `lucide-react/dist/esm/icons/chevron-down.js`
  - `lucide-react/dist/esm/icons/chevron-up.js`
  - `lucide-react/dist/esm/icons/external-link.js`
  - `lucide-react/dist/esm/icons/eye-off.js`
  - `lucide-react/dist/esm/icons/eye.js`
  - `lucide-react/dist/esm/icons/facebook.js`
  - `lucide-react/dist/esm/icons/globe.js`
  - `lucide-react/dist/esm/icons/help-circle.js`
  - `lucide-react/dist/esm/icons/images.js`
  - `lucide-react/dist/esm/icons/instagram.js`
  - `lucide-react/dist/esm/icons/mail.js`
  - `lucide-react/dist/esm/icons/map-pin.js`
  - `lucide-react/dist/esm/icons/phone.js`
  - `lucide-react/dist/esm/icons/plus.js`
  - `lucide-react/dist/esm/icons/rotate-ccw.js`
  - `lucide-react/dist/esm/icons/save.js`
  - `lucide-react/dist/esm/icons/search.js`
  - `lucide-react/dist/esm/icons/send.js`
  - `lucide-react/dist/esm/icons/shopping-bag.js`
  - `lucide-react/dist/esm/icons/sparkles.js`
  - `lucide-react/dist/esm/icons/store.js`
  - `lucide-react/dist/esm/icons/ticket.js`
  - `lucide-react/dist/esm/icons/upload.js`
  - `react`
- Internal dependencies (16)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/catalog/CatalogEditorSurface.tsx`
  - `frontend/src/components/catalog/CatalogPageContext.tsx`
  - `frontend/src/components/catalog/CatalogPreviewSurface.tsx`
  - `frontend/src/components/catalog/CatalogProductsSection.tsx`
  - `frontend/src/components/catalog/CatalogSecondaryTabs.tsx`
  - `frontend/src/components/catalog/catalogAssetUrls.ts`
  - `frontend/src/components/catalog/catalogUi.tsx`
  - `frontend/src/components/catalog/portalContentI18n.ts`
  - `frontend/src/components/catalog/portalLanguagePacks.ts`
  - `frontend/src/components/catalog/portalTranslateController.ts`
  - `frontend/src/components/products/helpers/productFilterHelpers.ts`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/favicon.ts`
  - `frontend/src/utils/initials.ts`
- Referenced by (2)
  - `frontend/src/App.tsx`
  - `frontend/src/PublicCatalogRoot.tsx`

### 3.299 `frontend/src/components/catalog/CatalogPageContext.tsx`

- Declared exports: `CatalogPageProvider`, `useCatalogPageContext`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/catalog/CatalogEditorSurface.tsx`
  - `frontend/src/components/catalog/CatalogPage.tsx`

### 3.300 `frontend/src/components/catalog/catalogPagination.tsx`

- Declared exports: `function`, `paginateCatalogItems`
- Imports (2)
  - `../shared/AppSelect`
  - `react`
- Internal dependencies (1)
  - `frontend/src/components/shared/AppSelect.tsx`
- Referenced by (1)
  - `frontend/src/components/catalog/CatalogProductsSection.tsx`

### 3.301 `frontend/src/components/catalog/CatalogPreviewSurface.tsx`

- Declared exports: `function`
- Imports (10)
  - `../files/FilePickerModal`
  - `../shared/ImageGalleryLightbox`
  - `../shared/LazyPortalMenu`
  - `./catalogImages`
  - `lucide-react/dist/esm/icons/arrow-down.js`
  - `lucide-react/dist/esm/icons/arrow-up.js`
  - `lucide-react/dist/esm/icons/globe.js`
  - `lucide-react/dist/esm/icons/moon.js`
  - `lucide-react/dist/esm/icons/sun.js`
  - `react`
- Internal dependencies (4)
  - `frontend/src/components/catalog/catalogImages.tsx`
  - `frontend/src/components/files/FilePickerModal.tsx`
  - `frontend/src/components/shared/ImageGalleryLightbox.tsx`
  - `frontend/src/components/shared/LazyPortalMenu.tsx`
- Referenced by (1)
  - `frontend/src/components/catalog/CatalogPage.tsx`

### 3.302 `frontend/src/components/catalog/CatalogProductsSection.tsx`

- Declared exports: `function`
- Imports (17)
  - `../../utils/initials.ts`
  - `../../utils/scriptTypography.ts`
  - `./catalogImages`
  - `./catalogPagination`
  - `./catalogUi`
  - `./portalCatalogDisplay.ts`
  - `lucide-react`
  - `lucide-react/dist/esm/icons/arrow-right.js`
  - `lucide-react/dist/esm/icons/badge-check.js`
  - `lucide-react/dist/esm/icons/badge-percent.js`
  - `lucide-react/dist/esm/icons/flame.js`
  - `lucide-react/dist/esm/icons/medal.js`
  - `lucide-react/dist/esm/icons/search.js`
  - `lucide-react/dist/esm/icons/shopping-bag.js`
  - `lucide-react/dist/esm/icons/sparkles.js`
  - `lucide-react/dist/esm/icons/trophy.js`
  - `react`
- Internal dependencies (6)
  - `frontend/src/components/catalog/catalogImages.tsx`
  - `frontend/src/components/catalog/catalogPagination.tsx`
  - `frontend/src/components/catalog/catalogUi.tsx`
  - `frontend/src/components/catalog/portalCatalogDisplay.ts`
  - `frontend/src/utils/initials.ts`
  - `frontend/src/utils/scriptTypography.ts`
- Referenced by (1)
  - `frontend/src/components/catalog/CatalogPage.tsx`

### 3.303 `frontend/src/components/catalog/CatalogSecondaryTabs.tsx`

- Declared exports: `function`
- Imports (22)
  - `../shared/AppSelect.tsx`
  - `./catalogUi`
  - `lucide-react/dist/esm/icons/badge-dollar-sign.js`
  - `lucide-react/dist/esm/icons/bot.js`
  - `lucide-react/dist/esm/icons/chevron-down.js`
  - `lucide-react/dist/esm/icons/chevron-up.js`
  - `lucide-react/dist/esm/icons/facebook.js`
  - `lucide-react/dist/esm/icons/globe.js`
  - `lucide-react/dist/esm/icons/help-circle.js`
  - `lucide-react/dist/esm/icons/instagram.js`
  - `lucide-react/dist/esm/icons/mail.js`
  - `lucide-react/dist/esm/icons/map-pin.js`
  - `lucide-react/dist/esm/icons/phone.js`
  - `lucide-react/dist/esm/icons/rotate-ccw.js`
  - `lucide-react/dist/esm/icons/search.js`
  - `lucide-react/dist/esm/icons/send.js`
  - `lucide-react/dist/esm/icons/shopping-bag.js`
  - `lucide-react/dist/esm/icons/sparkles.js`
  - `lucide-react/dist/esm/icons/store.js`
  - `lucide-react/dist/esm/icons/ticket.js`
  - `lucide-react/dist/esm/icons/upload.js`
  - `react`
- Internal dependencies (2)
  - `frontend/src/components/catalog/catalogUi.tsx`
  - `frontend/src/components/shared/AppSelect.tsx`
- Referenced by (1)
  - `frontend/src/components/catalog/CatalogPage.tsx`

### 3.304 `frontend/src/components/catalog/catalogUi.tsx`

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

### 3.305 `frontend/src/components/catalog/portalCatalogDisplay.ts`

- Declared exports: `buildPortalHighlightBadges`, `buildPortalPricePresentation`, `getPortalGridClass`, `getPortalMobileGridClass`, `getPortalPromotionDetails`, `normalizeRecommendedProductIds`, `productMatchesPortalBranches`
- Imports (1)
  - `../../utils/pricing.ts`
- Internal dependencies (1)
  - `frontend/src/utils/pricing.ts`
- Referenced by (1)
  - `frontend/src/components/catalog/CatalogProductsSection.tsx`

### 3.306 `frontend/src/components/catalog/portalContentI18n.ts`

- Declared exports: `localizePortalConfig`, `localizePortalFaqText`, `localizePortalProduct`, `localizePortalProducts`, `normalizePortalTranslations`, `stringifyPortalTranslations`
- Imports (1)
  - `./portalLanguagePacks.ts`
- Internal dependencies (1)
  - `frontend/src/components/catalog/portalLanguagePacks.ts`
- Referenced by (1)
  - `frontend/src/components/catalog/CatalogPage.tsx`

### 3.307 `frontend/src/components/catalog/portalEditorUtils.ts`

- Declared exports: `createAboutBlock`, `createPromoItem`, `extractGoogleMapsEmbedUrl`, `moveListItem`, `normalizeAboutBlocks`, `normalizeGoogleMapsEmbed`, `normalizePromoItems`, `serializeAboutBlocks`, `serializePromoItems`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.308 `frontend/src/components/catalog/portalLanguageOptions.ts`

- Declared exports: `FIRST_PARTY_PORTAL_LANGUAGE_OPTIONS`, `isFirstPartyPortalLanguage`, `normalizeFirstPartyPortalLanguage`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.309 `frontend/src/components/catalog/portalLanguagePacks.ts`

- Declared exports: `FIRST_PARTY_PORTAL_LANGUAGE_OPTIONS`, `getPortalLanguageText`, `isFirstPartyPortalLanguage`, `normalizeFirstPartyPortalLanguage`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/catalog/CatalogPage.tsx`
  - `frontend/src/components/catalog/portalContentI18n.ts`

### 3.310 `frontend/src/components/catalog/portalTranslateController.ts`

- Declared exports: `PORTAL_TRANSLATE_RELOAD_KEY`, `PORTAL_TRANSLATE_SCRIPT_ID`, `PORTAL_TRANSLATE_STORAGE_KEY`, `PORTAL_TRANSLATE_WIDGET_HOST_ID`, `applyGoogleTranslateSelection`, `canonicalTranslateLanguage`, `clearGoogleTranslateCookies`, `ensurePortalTranslateScript`, `ensurePortalTranslateWidgetHost`, `getPortalTranslateCookieTarget`, `hasPortalTranslatedMarker`, `isPortalTranslateApplied`, `normalizeTranslateTarget`, `readStoredTranslateTarget`, `removePortalTranslateWidgetHost`, `requestPortalTranslateReload`, `setupPortalExternalTranslateWidget`, `storePortalTranslatePreference`, `warmPortalTranslateNetwork`, `writePortalTranslateTarget`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/catalog/CatalogPage.tsx`

### 3.311 `frontend/src/components/catalog/portalTranslationData.ts`

- Declared exports: `normalizePortalTranslations`, `stringifyPortalTranslations`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.312 `frontend/src/components/contacts/ContactImportModal.tsx`

- Declared exports: `function`
- Imports (9)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../../utils/csvRowCounter.ts`
  - `../../utils/loaders.ts`
  - `../../utils/publicAssetUrls.ts`
  - `../files/FilePickerModal`
  - `../shared/AppSelect.tsx`
  - `../shared/Modal`
  - `react`
- Internal dependencies (8)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/files/FilePickerModal.tsx`
  - `frontend/src/components/shared/AppSelect.tsx`
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

### 3.313 `frontend/src/components/contacts/contactImportWorker.ts`

- Declared exports: none detected
- Imports (1)
  - `../../utils/csvRowCounter`
- Internal dependencies (1)
  - `frontend/src/utils/csvRowCounter.ts`
- Referenced by (0)
  - none

### 3.314 `frontend/src/components/contacts/contactOptionUtils.ts`

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

### 3.315 `frontend/src/components/contacts/Contacts.tsx`

- Declared exports: `function`
- Imports (19)
  - `../../AppContext.tsx`
  - `../../api/contactReadTransport.ts`
  - `../../api/query.ts`
  - `../../utils/csv`
  - `../../utils/loaders.ts`
  - `../shared/Modal`
  - `../shared/PageHeader`
  - `../shared/pageActivity`
  - `./ContactImportModal`
  - `./CustomersTab`
  - `./DeliveryTab`
  - `./SuppliersTab`
  - `lucide-react/dist/esm/icons/book-user.js`
  - `lucide-react/dist/esm/icons/download.js`
  - `lucide-react/dist/esm/icons/truck.js`
  - `lucide-react/dist/esm/icons/upload.js`
  - `lucide-react/dist/esm/icons/users.js`
  - `lucide-react/dist/esm/icons/warehouse.js`
  - `react`
- Internal dependencies (12)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/api/contactReadTransport.ts`
  - `frontend/src/api/query.ts`
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

### 3.316 `frontend/src/components/contacts/CustomerFormModal.tsx`

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

### 3.317 `frontend/src/components/contacts/customerMembershipNumber.ts`

- Declared exports: `generateCustomerMembershipNumber`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/contacts/CustomerFormModal.tsx`
  - `frontend/src/components/contacts/CustomersTab.tsx`

### 3.318 `frontend/src/components/contacts/CustomersTab.tsx`

- Declared exports: `parseContactOptions`, `serializeContactOptions`
- Imports (25)
  - `../../AppContext.tsx`
  - `../../api/contactReadTransport.ts`
  - `../../api/contactWriteTransport.ts`
  - `../../api/query.ts`
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
  - `lucide-react/dist/esm/icons/chevron-down.js`
  - `lucide-react/dist/esm/icons/chevron-right.js`
  - `lucide-react/dist/esm/icons/download.js`
  - `lucide-react/dist/esm/icons/plus.js`
  - `lucide-react/dist/esm/icons/upload.js`
  - `react`
- Internal dependencies (19)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/api/contactReadTransport.ts`
  - `frontend/src/api/contactWriteTransport.ts`
  - `frontend/src/api/query.ts`
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
- Referenced by (1)
  - `frontend/src/components/contacts/Contacts.tsx`

### 3.319 `frontend/src/components/contacts/DeliveryTab.tsx`

- Declared exports: `parseDeliveryOptions`, `serializeDeliveryOptions`
- Imports (24)
  - `../../AppContext.tsx`
  - `../../api/contactReadTransport.ts`
  - `../../api/contactWriteTransport.ts`
  - `../../api/query.ts`
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
  - `lucide-react/dist/esm/icons/chevron-down.js`
  - `lucide-react/dist/esm/icons/chevron-right.js`
  - `lucide-react/dist/esm/icons/download.js`
  - `lucide-react/dist/esm/icons/plus.js`
  - `lucide-react/dist/esm/icons/upload.js`
  - `react`
- Internal dependencies (18)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/api/contactReadTransport.ts`
  - `frontend/src/api/contactWriteTransport.ts`
  - `frontend/src/api/query.ts`
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

### 3.320 `frontend/src/components/contacts/shared.tsx`

- Declared exports: `ContactTable`, `DetailModal`, `ThreeDotMenu`, `buildSelectedSnapshots`, `countActiveFlags`, `useContactSelection`
- Imports (8)
  - `../../AppContext.tsx`
  - `../shared/LazyPortalMenu`
  - `../shared/LoadingWatchdog`
  - `../shared/Modal`
  - `../shared/PaginationControls`
  - `lucide-react/dist/esm/icons/more-horizontal.js`
  - `lucide-react/dist/esm/icons/x.js`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/shared/LazyPortalMenu.tsx`
  - `frontend/src/components/shared/LoadingWatchdog.tsx`
  - `frontend/src/components/shared/Modal.tsx`
  - `frontend/src/components/shared/PaginationControls.tsx`
- Referenced by (3)
  - `frontend/src/components/contacts/CustomersTab.tsx`
  - `frontend/src/components/contacts/DeliveryTab.tsx`
  - `frontend/src/components/contacts/SuppliersTab.tsx`

### 3.321 `frontend/src/components/contacts/SuppliersTab.tsx`

- Declared exports: none detected
- Imports (24)
  - `../../AppContext.tsx`
  - `../../api/contactReadTransport.ts`
  - `../../api/contactWriteTransport.ts`
  - `../../api/query.ts`
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
  - `lucide-react/dist/esm/icons/chevron-down.js`
  - `lucide-react/dist/esm/icons/chevron-right.js`
  - `lucide-react/dist/esm/icons/download.js`
  - `lucide-react/dist/esm/icons/plus.js`
  - `lucide-react/dist/esm/icons/upload.js`
  - `react`
- Internal dependencies (18)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/api/contactReadTransport.ts`
  - `frontend/src/api/contactWriteTransport.ts`
  - `frontend/src/api/query.ts`
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

### 3.322 `frontend/src/components/custom-tables/CustomTables.tsx`

- Declared exports: `function`
- Imports (8)
  - `../../AppContext.tsx`
  - `../../api/customTablesTransport.ts`
  - `../../utils/actionGuards.ts`
  - `../../utils/actionHistory.ts`
  - `../../utils/historyHelpers.ts`
  - `../shared/ActionHistoryBar`
  - `../shared/AppSelect.tsx`
  - `react`
- Internal dependencies (7)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/api/customTablesTransport.ts`
  - `frontend/src/components/shared/ActionHistoryBar.tsx`
  - `frontend/src/components/shared/AppSelect.tsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/utils/historyHelpers.ts`
- Referenced by (0)
  - none

### 3.323 `frontend/src/components/dashboard/charts/BarChart.tsx`

- Declared exports: `function`
- Imports (3)
  - `../../../utils/formatters`
  - `./NoData`
  - `react`
- Internal dependencies (2)
  - `frontend/src/components/dashboard/charts/NoData.tsx`
  - `frontend/src/utils/formatters.ts`
- Referenced by (1)
  - `frontend/src/components/dashboard/Dashboard.tsx`

### 3.324 `frontend/src/components/dashboard/charts/DonutChart.tsx`

- Declared exports: `function`
- Imports (3)
  - `../../../utils/formatters`
  - `./NoData`
  - `react`
- Internal dependencies (2)
  - `frontend/src/components/dashboard/charts/NoData.tsx`
  - `frontend/src/utils/formatters.ts`
- Referenced by (1)
  - `frontend/src/components/dashboard/Dashboard.tsx`

### 3.325 `frontend/src/components/dashboard/charts/index.ts`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/utils/exportReports.tsx`

### 3.326 `frontend/src/components/dashboard/charts/LineChart.tsx`

- Declared exports: `function`
- Imports (3)
  - `../../../utils/formatters`
  - `./NoData`
  - `react`
- Internal dependencies (2)
  - `frontend/src/components/dashboard/charts/NoData.tsx`
  - `frontend/src/utils/formatters.ts`
- Referenced by (1)
  - `frontend/src/components/dashboard/Dashboard.tsx`

### 3.327 `frontend/src/components/dashboard/charts/NoData.tsx`

- Declared exports: `function`
- Imports (1)
  - `../../../AppContext.tsx`
- Internal dependencies (1)
  - `frontend/src/AppContext.tsx`
- Referenced by (3)
  - `frontend/src/components/dashboard/charts/BarChart.tsx`
  - `frontend/src/components/dashboard/charts/DonutChart.tsx`
  - `frontend/src/components/dashboard/charts/LineChart.tsx`

### 3.328 `frontend/src/components/dashboard/Dashboard.tsx`

- Declared exports: `function`
- Imports (18)
  - `../../AppContext.tsx`
  - `../../api/dashboardTransport.ts`
  - `../../api/http.ts`
  - `../../utils/dateHelpers`
  - `../../utils/formatters`
  - `../../utils/loaders.ts`
  - `../shared/AppSelect`
  - `../shared/ExportMenu`
  - `../shared/LoadingWatchdog`
  - `../shared/pageActivity`
  - `./MiniStat`
  - `./charts/BarChart`
  - `./charts/DonutChart`
  - `./charts/LineChart`
  - `./dashboardExport.ts`
  - `lucide-react/dist/esm/icons/layout-dashboard.js`
  - `lucide-react/dist/esm/icons/refresh-cw.js`
  - `react`
- Internal dependencies (15)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/api/dashboardTransport.ts`
  - `frontend/src/api/http.ts`
  - `frontend/src/components/dashboard/MiniStat.tsx`
  - `frontend/src/components/dashboard/charts/BarChart.tsx`
  - `frontend/src/components/dashboard/charts/DonutChart.tsx`
  - `frontend/src/components/dashboard/charts/LineChart.tsx`
  - `frontend/src/components/dashboard/dashboardExport.ts`
  - `frontend/src/components/shared/AppSelect.tsx`
  - `frontend/src/components/shared/ExportMenu.tsx`
  - `frontend/src/components/shared/LoadingWatchdog.tsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/dateHelpers.ts`
  - `frontend/src/utils/formatters.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.329 `frontend/src/components/dashboard/dashboardExport.ts`

- Declared exports: `exportDashboardBranches`, `exportDashboardFull`, `exportDashboardKpis`, `exportDashboardPackage`, `exportDashboardPaymentMethods`, `exportDashboardSalesChart`, `exportDashboardStats`, `exportDashboardTopCustomers`, `exportDashboardTopProducts`
- Imports (4)
  - `../../utils/csv.ts`
  - `../../utils/exportPackage.ts`
  - `../../utils/exportReports.tsx`
  - `../../utils/pricing.ts`
- Internal dependencies (4)
  - `frontend/src/utils/csv.ts`
  - `frontend/src/utils/exportPackage.ts`
  - `frontend/src/utils/exportReports.tsx`
  - `frontend/src/utils/pricing.ts`
- Referenced by (1)
  - `frontend/src/components/dashboard/Dashboard.tsx`

### 3.330 `frontend/src/components/dashboard/MiniStat.tsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/dashboard/Dashboard.tsx`

### 3.331 `frontend/src/components/files/FilePickerModal.tsx`

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

### 3.332 `frontend/src/components/files/FilesPage.tsx`

- Declared exports: `function`
- Imports (22)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../../utils/actionHistory.ts`
  - `../../utils/historyHelpers.ts`
  - `../../utils/publicAssetUrls.ts`
  - `../shared/ActionHistoryBar`
  - `../shared/AppSelect`
  - `../shared/PageHeader`
  - `../shared/pageActivity`
  - `./FilesProvidersTab.tsx`
  - `./FilesResponsesTab`
  - `lucide-react/dist/esm/icons/check-square.js`
  - `lucide-react/dist/esm/icons/copy.js`
  - `lucide-react/dist/esm/icons/download.js`
  - `lucide-react/dist/esm/icons/folder-open.js`
  - `lucide-react/dist/esm/icons/history.js`
  - `lucide-react/dist/esm/icons/key-round.js`
  - `lucide-react/dist/esm/icons/refresh-ccw.js`
  - `lucide-react/dist/esm/icons/square.js`
  - `lucide-react/dist/esm/icons/trash-2.js`
  - `lucide-react/dist/esm/icons/upload.js`
  - `react`
- Internal dependencies (11)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/files/FilesProvidersTab.tsx`
  - `frontend/src/components/files/FilesResponsesTab.tsx`
  - `frontend/src/components/shared/ActionHistoryBar.tsx`
  - `frontend/src/components/shared/AppSelect.tsx`
  - `frontend/src/components/shared/PageHeader.tsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/utils/historyHelpers.ts`
  - `frontend/src/utils/publicAssetUrls.ts`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.333 `frontend/src/components/files/FilesProvidersTab.tsx`

- Declared exports: `function`
- Imports (8)
  - `../shared/AppSelect.tsx`
  - `lucide-react/dist/esm/icons/key-round.js`
  - `lucide-react/dist/esm/icons/refresh-ccw.js`
  - `lucide-react/dist/esm/icons/save.js`
  - `lucide-react/dist/esm/icons/shield-check.js`
  - `lucide-react/dist/esm/icons/test-tube-2.js`
  - `lucide-react/dist/esm/icons/trash-2.js`
  - `react`
- Internal dependencies (1)
  - `frontend/src/components/shared/AppSelect.tsx`
- Referenced by (1)
  - `frontend/src/components/files/FilesPage.tsx`

### 3.334 `frontend/src/components/files/FilesResponsesTab.tsx`

- Declared exports: `function`
- Imports (7)
  - `lucide-react/dist/esm/icons/brain.js`
  - `lucide-react/dist/esm/icons/chevron-down.js`
  - `lucide-react/dist/esm/icons/chevron-up.js`
  - `lucide-react/dist/esm/icons/history.js`
  - `lucide-react/dist/esm/icons/image.js`
  - `lucide-react/dist/esm/icons/refresh-ccw.js`
  - `lucide-react/dist/esm/icons/sparkles.js`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/files/FilesPage.tsx`

### 3.335 `frontend/src/components/inventory/DualMoney.tsx`

- Declared exports: `function`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/inventory/InventoryProductsSurface.tsx`

### 3.336 `frontend/src/components/inventory/Inventory.tsx`

- Declared exports: `function`
- Imports (46)
  - `../../AppContext`
  - `../../api/branchTransport.ts`
  - `../../api/dashboardTransport.ts`
  - `../../api/http.ts`
  - `../../api/inventoryTransport.ts`
  - `../../api/inventoryWriteTransport.ts`
  - `../../api/productReadTransport.ts`
  - `../../api/query.ts`
  - `../../api/returnsTransport.ts`
  - `../../api/rfidTransport.ts`
  - `../../api/userReadTransport.ts`
  - `../../utils/actionGuards.ts`
  - `../../utils/actionHistory.ts`
  - `../../utils/bulkOps.ts`
  - `../../utils/formatters`
  - `../../utils/groupedRecords.ts`
  - `../../utils/historyHelpers.ts`
  - `../../utils/initials.ts`
  - `../../utils/pricing.ts`
  - `../../utils/productBatches.ts`
  - `../../utils/productGrouping.ts`
  - `../shared/ActionHistoryBar`
  - `../shared/AppSelect`
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
  - `./inventoryExport.ts`
  - `./movementGroups`
  - `lucide-react/dist/esm/icons/arrow-right-left.js`
  - `lucide-react/dist/esm/icons/boxes.js`
  - `lucide-react/dist/esm/icons/chevron-down.js`
  - `lucide-react/dist/esm/icons/chevron-left.js`
  - `lucide-react/dist/esm/icons/chevron-right.js`
  - `lucide-react/dist/esm/icons/clipboard-list.js`
  - `lucide-react/dist/esm/icons/package.js`
  - `lucide-react/dist/esm/icons/upload.js`
  - `lucide-react/dist/esm/icons/x.js`
  - `react`
- Internal dependencies (36)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/api/branchTransport.ts`
  - `frontend/src/api/dashboardTransport.ts`
  - `frontend/src/api/http.ts`
  - `frontend/src/api/inventoryTransport.ts`
  - `frontend/src/api/inventoryWriteTransport.ts`
  - `frontend/src/api/productReadTransport.ts`
  - `frontend/src/api/query.ts`
  - `frontend/src/api/returnsTransport.ts`
  - `frontend/src/api/rfidTransport.ts`
  - `frontend/src/api/userReadTransport.ts`
  - `frontend/src/components/inventory/InventoryImportModal.tsx`
  - `frontend/src/components/inventory/InventoryMovementsSurface.tsx`
  - `frontend/src/components/inventory/InventoryProductsSurface.tsx`
  - `frontend/src/components/inventory/InventoryRfidSurface.tsx`
  - `frontend/src/components/inventory/ProductDetailModal.tsx`
  - `frontend/src/components/inventory/inventoryExport.ts`
  - `frontend/src/components/inventory/movementGroups.ts`
  - `frontend/src/components/shared/ActionHistoryBar.tsx`
  - `frontend/src/components/shared/AppSelect.tsx`
  - `frontend/src/components/shared/ExportMenu.tsx`
  - `frontend/src/components/shared/FilterMenu.tsx`
  - `frontend/src/components/shared/LoadingWatchdog.tsx`
  - `frontend/src/components/shared/PaginationControls.tsx`
  - `frontend/src/components/shared/SectionSwitcher.tsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/utils/bulkOps.ts`
  - `frontend/src/utils/formatters.ts`
  - `frontend/src/utils/groupedRecords.ts`
  - `frontend/src/utils/historyHelpers.ts`
  - `frontend/src/utils/initials.ts`
  - `frontend/src/utils/pricing.ts`
  - `frontend/src/utils/productBatches.ts`
  - `frontend/src/utils/productGrouping.ts`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.337 `frontend/src/components/inventory/inventoryExport.ts`

- Declared exports: `exportInventoryMovementGroups`, `exportInventoryPackage`, `exportInventoryStats`, `exportInventorySummary`
- Imports (4)
  - `../../utils/csv`
  - `../../utils/exportPackage`
  - `../../utils/exportReports`
  - `../../utils/pricing.ts`
- Internal dependencies (4)
  - `frontend/src/utils/csv.ts`
  - `frontend/src/utils/exportPackage.ts`
  - `frontend/src/utils/exportReports.tsx`
  - `frontend/src/utils/pricing.ts`
- Referenced by (1)
  - `frontend/src/components/inventory/Inventory.tsx`

### 3.338 `frontend/src/components/inventory/InventoryImportModal.tsx`

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

### 3.339 `frontend/src/components/inventory/inventoryImportWorker.ts`

- Declared exports: none detected
- Imports (1)
  - `../../utils/csvRowCounter`
- Internal dependencies (1)
  - `frontend/src/utils/csvRowCounter.ts`
- Referenced by (0)
  - none

### 3.340 `frontend/src/components/inventory/InventoryMovementsSurface.tsx`

- Declared exports: `function`
- Imports (9)
  - `../shared/ActionHistoryBar`
  - `../shared/ExportMenu`
  - `../shared/PaginationControls`
  - `../shared/PortalMenu`
  - `lucide-react/dist/esm/icons/chevron-down.js`
  - `lucide-react/dist/esm/icons/chevron-right.js`
  - `lucide-react/dist/esm/icons/info.js`
  - `lucide-react/dist/esm/icons/package.js`
  - `react`
- Internal dependencies (4)
  - `frontend/src/components/shared/ActionHistoryBar.tsx`
  - `frontend/src/components/shared/ExportMenu.tsx`
  - `frontend/src/components/shared/PaginationControls.tsx`
  - `frontend/src/components/shared/PortalMenu.tsx`
- Referenced by (1)
  - `frontend/src/components/inventory/Inventory.tsx`

### 3.341 `frontend/src/components/inventory/InventoryProductsSurface.tsx`

- Declared exports: `function`
- Imports (5)
  - `../../utils/scriptTypography.ts`
  - `./DualMoney`
  - `lucide-react/dist/esm/icons/chevron-down.js`
  - `lucide-react/dist/esm/icons/chevron-right.js`
  - `react`
- Internal dependencies (2)
  - `frontend/src/components/inventory/DualMoney.tsx`
  - `frontend/src/utils/scriptTypography.ts`
- Referenced by (1)
  - `frontend/src/components/inventory/Inventory.tsx`

### 3.342 `frontend/src/components/inventory/InventoryRfidSurface.tsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/inventory/Inventory.tsx`

### 3.343 `frontend/src/components/inventory/movementGroups.ts`

- Declared exports: `buildMovementGroups`, `getMovementGroupPage`, `movementGroupHaystack`, `normalizeMovementTimestamp`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/tests/inventoryMovementGroups.test.ts`

### 3.344 `frontend/src/components/inventory/ProductDetailModal.tsx`

- Declared exports: `function`
- Imports (2)
  - `../../utils/pricing.ts`
  - `../../utils/productBatches.ts`
- Internal dependencies (2)
  - `frontend/src/utils/pricing.ts`
  - `frontend/src/utils/productBatches.ts`
- Referenced by (1)
  - `frontend/src/components/inventory/Inventory.tsx`

### 3.345 `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx`

- Declared exports: `function`
- Imports (14)
  - `../../AppContext.tsx`
  - `../../api/contactReadTransport.ts`
  - `../../api/portalTransport.ts`
  - `../../utils/actionGuards.ts`
  - `../shared/AppSelect.tsx`
  - `../shared/LoadingWatchdog`
  - `../shared/SectionSwitcher`
  - `../shared/pageActivity`
  - `lucide-react/dist/esm/icons/badge-dollar-sign.js`
  - `lucide-react/dist/esm/icons/gift.js`
  - `lucide-react/dist/esm/icons/save.js`
  - `lucide-react/dist/esm/icons/search.js`
  - `lucide-react/dist/esm/icons/ticket.js`
  - `react`
- Internal dependencies (8)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/api/contactReadTransport.ts`
  - `frontend/src/api/portalTransport.ts`
  - `frontend/src/components/shared/AppSelect.tsx`
  - `frontend/src/components/shared/LoadingWatchdog.tsx`
  - `frontend/src/components/shared/SectionSwitcher.tsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/actionGuards.ts`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.346 `frontend/src/components/navigation/Sidebar.tsx`

- Declared exports: `function`
- Imports (26)
  - `../../AppContext.tsx`
  - `../../app/appShellUtils.ts`
  - `../shared/QuickPreferenceToggles`
  - `../shared/navigationConfig`
  - `../users/UserProfileModal`
  - `lucide-react`
  - `lucide-react/dist/esm/icons/badge-dollar-sign.js`
  - `lucide-react/dist/esm/icons/book-user.js`
  - `lucide-react/dist/esm/icons/boxes.js`
  - `lucide-react/dist/esm/icons/building-2.js`
  - `lucide-react/dist/esm/icons/clipboard-list.js`
  - `lucide-react/dist/esm/icons/database-backup.js`
  - `lucide-react/dist/esm/icons/folder-open.js`
  - `lucide-react/dist/esm/icons/layout-dashboard.js`
  - `lucide-react/dist/esm/icons/log-out.js`
  - `lucide-react/dist/esm/icons/more-horizontal.js`
  - `lucide-react/dist/esm/icons/package.js`
  - `lucide-react/dist/esm/icons/receipt.js`
  - `lucide-react/dist/esm/icons/rotate-ccw.js`
  - `lucide-react/dist/esm/icons/server.js`
  - `lucide-react/dist/esm/icons/settings.js`
  - `lucide-react/dist/esm/icons/shopping-bag.js`
  - `lucide-react/dist/esm/icons/shopping-cart.js`
  - `lucide-react/dist/esm/icons/ticket.js`
  - `lucide-react/dist/esm/icons/users.js`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/app/appShellUtils.ts`
  - `frontend/src/components/shared/QuickPreferenceToggles.tsx`
  - `frontend/src/components/shared/navigationConfig.ts`
  - `frontend/src/components/users/UserProfileModal.tsx`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.347 `frontend/src/components/pos/CartItem.tsx`

- Declared exports: `function`
- Imports (3)
  - `../../utils/pricing.ts`
  - `../../utils/scriptTypography.ts`
  - `../shared/AppSelect`
- Internal dependencies (3)
  - `frontend/src/components/shared/AppSelect.tsx`
  - `frontend/src/utils/pricing.ts`
  - `frontend/src/utils/scriptTypography.ts`
- Referenced by (1)
  - `frontend/src/components/pos/POS.tsx`

### 3.348 `frontend/src/components/pos/FilterPanel.tsx`

- Declared exports: `function`
- Imports (8)
  - `lucide-react`
  - `lucide-react/dist/esm/icons/boxes.js`
  - `lucide-react/dist/esm/icons/building-2.js`
  - `lucide-react/dist/esm/icons/package.js`
  - `lucide-react/dist/esm/icons/tags.js`
  - `lucide-react/dist/esm/icons/truck.js`
  - `lucide-react/dist/esm/icons/x.js`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/pos/POS.tsx`

### 3.349 `frontend/src/components/pos/POS.tsx`

- Declared exports: `function`
- Imports (27)
  - `../../AppContext`
  - `../../api/contactReadTransport.ts`
  - `../../api/contactWriteTransport.ts`
  - `../../api/lookupTransport.ts`
  - `../../api/portalTransport.ts`
  - `../../api/query.ts`
  - `../../api/saleWriteTransport.ts`
  - `../../utils/deviceInfo`
  - `../../utils/initials.ts`
  - `../../utils/pricing.ts`
  - `../../utils/scriptTypography.ts`
  - `../contacts/contactOptionUtils`
  - `../products/helpers/productDisplayHelpers.ts`
  - `../products/helpers/productFilterHelpers.ts`
  - `../products/helpers/productMenuHelpers.ts`
  - `../receipt/Receipt`
  - `../shared/ImageGalleryLightbox`
  - `../shared/PaginationControls`
  - `../shared/pageActivity`
  - `./CartItem`
  - `./FilterPanel`
  - `./ProductImage`
  - `./QuickAddModal`
  - `lucide-react/dist/esm/icons/image-off.js`
  - `lucide-react/dist/esm/icons/info.js`
  - `lucide-react/dist/esm/icons/x.js`
  - `react`
- Internal dependencies (23)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/api/contactReadTransport.ts`
  - `frontend/src/api/contactWriteTransport.ts`
  - `frontend/src/api/lookupTransport.ts`
  - `frontend/src/api/portalTransport.ts`
  - `frontend/src/api/query.ts`
  - `frontend/src/api/saleWriteTransport.ts`
  - `frontend/src/components/contacts/contactOptionUtils.ts`
  - `frontend/src/components/pos/CartItem.tsx`
  - `frontend/src/components/pos/FilterPanel.tsx`
  - `frontend/src/components/pos/ProductImage.tsx`
  - `frontend/src/components/pos/QuickAddModal.tsx`
  - `frontend/src/components/products/helpers/productDisplayHelpers.ts`
  - `frontend/src/components/products/helpers/productFilterHelpers.ts`
  - `frontend/src/components/products/helpers/productMenuHelpers.ts`
  - `frontend/src/components/receipt/Receipt.tsx`
  - `frontend/src/components/shared/ImageGalleryLightbox.tsx`
  - `frontend/src/components/shared/PaginationControls.tsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/deviceInfo.ts`
  - `frontend/src/utils/initials.ts`
  - `frontend/src/utils/pricing.ts`
  - `frontend/src/utils/scriptTypography.ts`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.350 `frontend/src/components/pos/posCore.ts`

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

### 3.351 `frontend/src/components/pos/ProductImage.tsx`

- Declared exports: `function`
- Imports (2)
  - `../../utils/publicAssetUrls.ts`
  - `react`
- Internal dependencies (1)
  - `frontend/src/utils/publicAssetUrls.ts`
- Referenced by (1)
  - `frontend/src/components/pos/POS.tsx`

### 3.352 `frontend/src/components/pos/QuickAddModal.tsx`

- Declared exports: `function`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/pos/POS.tsx`

### 3.353 `frontend/src/components/products/config/productPageConfig.ts`

- Declared exports: `CREATED_MONTH_OPTIONS`, `DEFAULT_META_PILL_COLOR`, `PRODUCTS_AUX_OPTIONS_TIMEOUT_MS`, `PRODUCTS_BY_ID_TIMEOUT_MS`, `PRODUCTS_FILTER_META_TIMEOUT_MS`, `PRODUCT_DELETE_MUTATION_TIMEOUT_MS`, `PRODUCT_IMAGE_UPLOAD_TIMEOUT_MS`, `PRODUCT_STOCK_MUTATION_TIMEOUT_MS`, `PRODUCT_WRITE_MUTATION_TIMEOUT_MS`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.354 `frontend/src/components/products/forms/BranchStockAdjuster.tsx`

- Declared exports: `function`
- Imports (4)
  - `../../../utils/actionGuards.ts`
  - `../../../utils/loaders.ts`
  - `../../shared/AppSelect.tsx`
  - `react`
- Internal dependencies (3)
  - `frontend/src/components/shared/AppSelect.tsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/components/products/forms/ProductForm.tsx`

### 3.355 `frontend/src/components/products/forms/BulkAddStockModal.tsx`

- Declared exports: `function`
- Imports (4)
  - `../../../utils/actionGuards.ts`
  - `../../../utils/loaders.ts`
  - `../../shared/AppSelect.tsx`
  - `react`
- Internal dependencies (3)
  - `frontend/src/components/shared/AppSelect.tsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/components/products/Products.tsx`

### 3.356 `frontend/src/components/products/forms/ProductForm.tsx`

- Declared exports: `function`
- Imports (12)
  - `../../../api/contactsTransport.ts`
  - `../../../api/productImageUploadTransport.ts`
  - `../../../utils/mediaUpload.ts`
  - `../../../utils/pricing.ts`
  - `../../files/FilePickerModal`
  - `../../shared/AppSelect.tsx`
  - `../../shared/Modal`
  - `../scanning/BarcodeScannerModal`
  - `../shared/primitives`
  - `./BranchStockAdjuster`
  - `lucide-react/dist/esm/icons/scan-line.js`
  - `react`
- Internal dependencies (10)
  - `frontend/src/api/contactsTransport.ts`
  - `frontend/src/api/productImageUploadTransport.ts`
  - `frontend/src/components/files/FilePickerModal.tsx`
  - `frontend/src/components/products/forms/BranchStockAdjuster.tsx`
  - `frontend/src/components/products/scanning/BarcodeScannerModal.tsx`
  - `frontend/src/components/products/shared/primitives.tsx`
  - `frontend/src/components/shared/AppSelect.tsx`
  - `frontend/src/components/shared/Modal.tsx`
  - `frontend/src/utils/mediaUpload.ts`
  - `frontend/src/utils/pricing.ts`
- Referenced by (1)
  - `frontend/src/components/products/Products.tsx`

### 3.357 `frontend/src/components/products/forms/VariantFormModal.tsx`

- Declared exports: `function`
- Imports (9)
  - `../../../AppContext.tsx`
  - `../../../utils/actionGuards.ts`
  - `../../../utils/historyHelpers.ts`
  - `../../../utils/loaders.ts`
  - `../../../utils/pricing.ts`
  - `../../shared/AppSelect.tsx`
  - `../../shared/Modal`
  - `../shared/primitives`
  - `react`
- Internal dependencies (8)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/products/shared/primitives.tsx`
  - `frontend/src/components/shared/AppSelect.tsx`
  - `frontend/src/components/shared/Modal.tsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/historyHelpers.ts`
  - `frontend/src/utils/loaders.ts`
  - `frontend/src/utils/pricing.ts`
- Referenced by (1)
  - `frontend/src/components/products/Products.tsx`

### 3.358 `frontend/src/components/products/helpers/productDisplayHelpers.ts`

- Declared exports: `PRODUCT_STOCK_STATUS_CLASS`, `buildBranchNameByIdMap`, `buildNameLookupMap`, `buildProductBranchSummaryLabel`, `buildProductBrandOptions`, `buildProductRowDisplayState`, `getProductStockStatus`
- Imports (1)
  - `../../../utils/pricing.ts`
- Internal dependencies (1)
  - `frontend/src/utils/pricing.ts`
- Referenced by (1)
  - `frontend/src/components/pos/POS.tsx`

### 3.359 `frontend/src/components/products/helpers/productExport.ts`

- Declared exports: `buildProductExportRows`
- Imports (1)
  - `../../../utils/pricing.ts`
- Internal dependencies (1)
  - `frontend/src/utils/pricing.ts`
- Referenced by (2)
  - `frontend/src/components/products/Products.tsx`
  - `frontend/tests/productFilterHelpers.test.ts`

### 3.360 `frontend/src/components/products/helpers/productFilterHelpers.ts`

- Declared exports: `buildProductSearchTerms`, `filterProductsForPage`, `getProductBranchQuantity`
- Imports (1)
  - `../../../utils/groupedRecords.ts`
- Internal dependencies (1)
  - `frontend/src/utils/groupedRecords.ts`
- Referenced by (2)
  - `frontend/src/components/catalog/CatalogPage.tsx`
  - `frontend/src/components/pos/POS.tsx`

### 3.361 `frontend/src/components/products/helpers/productGalleryHelpers.ts`

- Declared exports: `buildProductLightboxGalleryInput`, `buildProductLightboxState`, `buildProductThumbnailState`, `clampProductLightboxIndex`, `getProductGalleryImages`, `normalizeProductGallery`, `resolveProductImageUrl`, `updateProductLightboxIndex`
- Imports (1)
  - `../../../utils/publicAssetUrls.ts`
- Internal dependencies (1)
  - `frontend/src/utils/publicAssetUrls.ts`
- Referenced by (1)
  - `frontend/src/components/products/helpers/productWriteHelpers.ts`

### 3.362 `frontend/src/components/products/helpers/productGroupViewHelpers.ts`

- Declared exports: `buildProductGroupPriceLabel`, `buildProductGroupSummaryParts`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.363 `frontend/src/components/products/helpers/productMenuHelpers.ts`

- Declared exports: `buildProductExportItems`, `buildProductFilterSections`, `buildProductSupplierOptions`, `countActiveProductFilters`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/pos/POS.tsx`

### 3.364 `frontend/src/components/products/helpers/productPageHelpers.ts`

- Declared exports: `normalizeBrandLookup`, `parseBrandColorMap`, `useDebouncedValue`, `waitForNextFrame`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.365 `frontend/src/components/products/helpers/productSelectionHelpers.ts`

- Declared exports: `buildJumpTargetIdsByLetter`, `buildParentProductIdSet`, `buildProductIdMap`, `buildProductPaginationState`, `buildSelectedProducts`, `buildSelectedVisibleIds`, `buildVisibleProductIds`, `isSelectionScopeFullySelected`, `isSelectionScopePartiallySelected`, `normalizePositiveProductIds`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.366 `frontend/src/components/products/helpers/productWriteHelpers.ts`

- Declared exports: `buildDefinedProductUpdates`, `buildDeletedProductIdSet`, `buildProductBranchMovePlan`, `buildProductBranchStockAdjustments`, `buildProductBulkInfoUpdates`, `buildProductBulkPricingUpdates`, `buildProductBulkUpdatePayload`, `buildProductClearStockAdjustments`, `buildProductStockAdjustmentPayload`, `buildProductTransferStockPayload`, `buildProductWritePayload`, `getDefaultProductRestoreBranchId`, `getPreferredProductRestoreBranchId`, `resolveRestoredProductParentId`, `summarizeProductBulkRun`
- Imports (2)
  - `../../../utils/pricing.ts`
  - `./productGalleryHelpers.ts`
- Internal dependencies (2)
  - `frontend/src/components/products/helpers/productGalleryHelpers.ts`
  - `frontend/src/utils/pricing.ts`
- Referenced by (0)
  - none

### 3.367 `frontend/src/components/products/history/productHistoryHelpers.ts`

- Declared exports: `createProductHistoryRequestId`, `orderProductRestoreSnapshots`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/products/Products.tsx`
  - `frontend/tests/productHistoryHelpers.test.ts`

### 3.368 `frontend/src/components/products/import/BulkImportModal.tsx`

- Declared exports: `function`
- Imports (10)
  - `../../../utils/actionGuards.ts`
  - `../../../utils/loaders.ts`
  - `../../files/FilePickerModal`
  - `../../shared/AppSelect`
  - `../../shared/Modal`
  - `lucide-react/dist/esm/icons/chevron-down.js`
  - `lucide-react/dist/esm/icons/chevron-right.js`
  - `lucide-react/dist/esm/icons/info.js`
  - `lucide-react/dist/esm/icons/undo-2.js`
  - `react`
- Internal dependencies (5)
  - `frontend/src/components/files/FilePickerModal.tsx`
  - `frontend/src/components/shared/AppSelect.tsx`
  - `frontend/src/components/shared/Modal.tsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/components/products/Products.tsx`

### 3.369 `frontend/src/components/products/import/productImportPlanner.ts`

- Declared exports: `BLOCKING_PRODUCT_IMPORT_ISSUES`, `PRODUCT_MONEY_FIELDS`, `PRODUCT_NUMBER_FIELDS`, `PRODUCT_PERCENT_FIELDS`, `analyzeProductImportRows`, `analyzeProductImportText`, `getProductImportBarcodeIssue`, `getProductImportDetailSignature`, `isBlockingProductImportIssue`, `normalizeImportProductName`, `normalizeProductImportRow`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `frontend/src/components/products/import/productImportWorker.ts`
  - `frontend/tests/productImportPlanner.test.ts`
  - `frontend/tests/productImportWorkerFallback.test.ts`

### 3.370 `frontend/src/components/products/import/productImportWorker.ts`

- Declared exports: none detected
- Imports (1)
  - `./productImportPlanner`
- Internal dependencies (1)
  - `frontend/src/components/products/import/productImportPlanner.ts`
- Referenced by (0)
  - none

### 3.371 `frontend/src/components/products/lookups/ManageBrandsModal.tsx`

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

### 3.372 `frontend/src/components/products/lookups/ManageCategoriesModal.tsx`

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

### 3.373 `frontend/src/components/products/lookups/ManageUnitsModal.tsx`

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

### 3.374 `frontend/src/components/products/lookups/productLookupSnapshots.ts`

- Declared exports: `fetchLookupProductSnapshots`, `normalizeLookup`, `restoreLookupProductSnapshots`
- Imports (1)
  - `../../../utils/loaders`
- Internal dependencies (1)
  - `frontend/src/utils/loaders.ts`
- Referenced by (0)
  - none

### 3.375 `frontend/src/components/products/Products.tsx`

- Declared exports: `function`
- Imports (42)
  - `../../AppContext`
  - `../../api/branchTransport.ts`
  - `../../api/http.ts`
  - `../../api/inventoryWriteTransport.ts`
  - `../../api/lookupTransport.ts`
  - `../../api/productImageUploadTransport.ts`
  - `../../api/productReadTransport.ts`
  - `../../api/productWriteTransport.ts`
  - `../../utils/actionGuards.ts`
  - `../../utils/actionHistory.ts`
  - `../../utils/bulkOps.ts`
  - `../../utils/color.ts`
  - `../../utils/csv.ts`
  - `../../utils/groupedRecords.ts`
  - `../../utils/historyHelpers.ts`
  - `../../utils/initials.ts`
  - `../../utils/productGrouping.ts`
  - `../../utils/scriptTypography.ts`
  - `../shared/ActionHistoryBar`
  - `../shared/AppSelect`
  - `../shared/FilterMenu`
  - `../shared/ImageGalleryLightbox`
  - `../shared/Modal`
  - `../shared/PaginationControls`
  - `../shared/pageActivity`
  - `./forms/BulkAddStockModal`
  - `./forms/ProductForm`
  - `./forms/VariantFormModal`
  - `./helpers/productExport.ts`
  - `./history/productHistoryHelpers.ts`
  - `./import/BulkImportModal`
  - `./lookups/ManageBrandsModal`
  - `./lookups/ManageCategoriesModal`
  - `./lookups/ManageUnitsModal`
  - `./shared/primitives`
  - `./surfaces/HeaderActions`
  - `./surfaces/ProductDetailModal`
  - `./surfaces/ProductsListSurface`
  - `lucide-react/dist/esm/icons/chevron-left.js`
  - `lucide-react/dist/esm/icons/chevron-right.js`
  - `lucide-react/dist/esm/icons/package-search.js`
  - `react`
- Internal dependencies (38)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/api/branchTransport.ts`
  - `frontend/src/api/http.ts`
  - `frontend/src/api/inventoryWriteTransport.ts`
  - `frontend/src/api/lookupTransport.ts`
  - `frontend/src/api/productImageUploadTransport.ts`
  - `frontend/src/api/productReadTransport.ts`
  - `frontend/src/api/productWriteTransport.ts`
  - `frontend/src/components/products/forms/BulkAddStockModal.tsx`
  - `frontend/src/components/products/forms/ProductForm.tsx`
  - `frontend/src/components/products/forms/VariantFormModal.tsx`
  - `frontend/src/components/products/helpers/productExport.ts`
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
  - `frontend/src/components/shared/AppSelect.tsx`
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

### 3.376 `frontend/src/components/products/scanning/barcodeImageScanner.ts`

- Declared exports: `scanBarcodeFromImageFile`
- Imports (1)
  - `@zxing/browser`
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/products/scanning/BarcodeScannerModal.tsx`
  - `frontend/tests/barcodeImageScanner.test.ts`

### 3.377 `frontend/src/components/products/scanning/BarcodeScannerModal.tsx`

- Declared exports: `function`
- Imports (13)
  - `../../shared/Modal`
  - `./barcodeImageScanner.ts`
  - `./barcodeScannerState.ts`
  - `./cameraPermission.ts`
  - `./scanbotScanner.ts`
  - `@zxing/browser`
  - `lucide-react/dist/esm/icons/alert-circle.js`
  - `lucide-react/dist/esm/icons/camera.js`
  - `lucide-react/dist/esm/icons/check-circle-2.js`
  - `lucide-react/dist/esm/icons/keyboard.js`
  - `lucide-react/dist/esm/icons/scan-line.js`
  - `lucide-react/dist/esm/icons/shield-alert.js`
  - `react`
- Internal dependencies (5)
  - `frontend/src/components/products/scanning/barcodeImageScanner.ts`
  - `frontend/src/components/products/scanning/barcodeScannerState.ts`
  - `frontend/src/components/products/scanning/cameraPermission.ts`
  - `frontend/src/components/products/scanning/scanbotScanner.ts`
  - `frontend/src/components/shared/Modal.tsx`
- Referenced by (1)
  - `frontend/src/components/products/forms/ProductForm.tsx`

### 3.378 `frontend/src/components/products/scanning/barcodeScannerState.ts`

- Declared exports: `deriveScannerPresentation`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/products/scanning/BarcodeScannerModal.tsx`
  - `frontend/tests/barcodeScannerState.test.ts`

### 3.379 `frontend/src/components/products/scanning/cameraPermission.ts`

- Declared exports: `readCameraPermissionState`, `watchCameraPermission`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `frontend/src/components/products/scanning/BarcodeScannerModal.tsx`
  - `frontend/src/components/products/scanning/scanbotScanner.ts`
  - `frontend/tests/scanbotScanner.test.ts`

### 3.380 `frontend/src/components/products/scanning/scanbotScanner.ts`

- Declared exports: `getPreferredScannerMode`, `isCameraBlockedByDocumentPolicy`, `scanBarcodeWithScanbot`
- Imports (1)
  - `./cameraPermission.ts`
- Internal dependencies (1)
  - `frontend/src/components/products/scanning/cameraPermission.ts`
- Referenced by (2)
  - `frontend/src/components/products/scanning/BarcodeScannerModal.tsx`
  - `frontend/tests/scanbotScanner.test.ts`

### 3.381 `frontend/src/components/products/shared/primitives.tsx`

- Declared exports: none detected
- Imports (4)
  - `../../../utils/publicAssetUrls.ts`
  - `lucide-react/dist/esm/icons/alert-triangle.js`
  - `lucide-react/dist/esm/icons/image-off.js`
  - `react`
- Internal dependencies (1)
  - `frontend/src/utils/publicAssetUrls.ts`
- Referenced by (5)
  - `frontend/src/components/catalog/CatalogEditorSurface.tsx`
  - `frontend/src/components/products/forms/ProductForm.tsx`
  - `frontend/src/components/products/forms/VariantFormModal.tsx`
  - `frontend/src/components/products/Products.tsx`
  - `frontend/src/components/products/surfaces/ProductDetailModal.tsx`

### 3.382 `frontend/src/components/products/surfaces/HeaderActions.tsx`

- Declared exports: `function`
- Imports (7)
  - `../../shared/ExportMenu`
  - `../../shared/LazyPortalMenu`
  - `../../shared/PortalMenu`
  - `lucide-react/dist/esm/icons/download.js`
  - `lucide-react/dist/esm/icons/package-plus.js`
  - `lucide-react/dist/esm/icons/settings-2.js`
  - `lucide-react/dist/esm/icons/upload.js`
- Internal dependencies (3)
  - `frontend/src/components/shared/ExportMenu.tsx`
  - `frontend/src/components/shared/LazyPortalMenu.tsx`
  - `frontend/src/components/shared/PortalMenu.tsx`
- Referenced by (1)
  - `frontend/src/components/products/Products.tsx`

### 3.383 `frontend/src/components/products/surfaces/ProductDetailModal.tsx`

- Declared exports: `function`
- Imports (6)
  - `../../../utils/color.ts`
  - `../../../utils/pricing.ts`
  - `../../../utils/productBatches.ts`
  - `../shared/primitives`
  - `lucide-react/dist/esm/icons/x.js`
  - `react`
- Internal dependencies (4)
  - `frontend/src/components/products/shared/primitives.tsx`
  - `frontend/src/utils/color.ts`
  - `frontend/src/utils/pricing.ts`
  - `frontend/src/utils/productBatches.ts`
- Referenced by (1)
  - `frontend/src/components/products/Products.tsx`

### 3.384 `frontend/src/components/products/surfaces/ProductRowParts.tsx`

- Declared exports: `ProductBatchPreview`, `ProductDetailsCell`, `ProductDiscountBadge`, `ProductRowActions`
- Imports (6)
  - `../../../utils/pricing.ts`
  - `../../../utils/productBatches.ts`
  - `../../shared/LazyPortalMenu`
  - `../../shared/PortalMenu`
  - `lucide-react/dist/esm/icons/more-horizontal.js`
  - `react`
- Internal dependencies (4)
  - `frontend/src/components/shared/LazyPortalMenu.tsx`
  - `frontend/src/components/shared/PortalMenu.tsx`
  - `frontend/src/utils/pricing.ts`
  - `frontend/src/utils/productBatches.ts`
- Referenced by (0)
  - none

### 3.385 `frontend/src/components/products/surfaces/ProductsListSurface.tsx`

- Declared exports: `function`
- Imports (3)
  - `lucide-react/dist/esm/icons/chevron-down.js`
  - `lucide-react/dist/esm/icons/chevron-right.js`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/products/Products.tsx`

### 3.386 `frontend/src/components/receipt-settings/AllFieldsPanel.tsx`

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

### 3.387 `frontend/src/components/receipt-settings/constants.ts`

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

### 3.388 `frontend/src/components/receipt-settings/ErrorBoundary.tsx`

- Declared exports: `class`
- Imports (1)
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/receipt-settings/ReceiptSettings.tsx`

### 3.389 `frontend/src/components/receipt-settings/FieldOrderManager.tsx`

- Declared exports: `function`
- Imports (7)
  - `lucide-react/dist/esm/icons/chevron-down.js`
  - `lucide-react/dist/esm/icons/chevron-up.js`
  - `lucide-react/dist/esm/icons/grip-vertical.js`
  - `lucide-react/dist/esm/icons/minus.js`
  - `lucide-react/dist/esm/icons/plus.js`
  - `lucide-react/dist/esm/icons/trash-2.js`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/receipt-settings/ReceiptSettings.tsx`

### 3.390 `frontend/src/components/receipt-settings/PrintSettings.tsx`

- Declared exports: `function`
- Imports (9)
  - `../../types/receiptContracts`
  - `../../utils/printReceipt`
  - `lucide-react`
  - `lucide-react/dist/esm/icons/download.js`
  - `lucide-react/dist/esm/icons/printer.js`
  - `lucide-react/dist/esm/icons/ruler.js`
  - `lucide-react/dist/esm/icons/scaling.js`
  - `lucide-react/dist/esm/icons/test-tube-2.js`
  - `react`
- Internal dependencies (2)
  - `frontend/src/types/receiptContracts.ts`
  - `frontend/src/utils/printReceipt.ts`
- Referenced by (1)
  - `frontend/src/components/receipt-settings/ReceiptSettings.tsx`

### 3.391 `frontend/src/components/receipt-settings/ReceiptPreview.tsx`

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

### 3.392 `frontend/src/components/receipt-settings/ReceiptSettings.tsx`

- Declared exports: `function`
- Imports (20)
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
  - `lucide-react/dist/esm/icons/eye.js`
  - `lucide-react/dist/esm/icons/globe.js`
  - `lucide-react/dist/esm/icons/layout-list.js`
  - `lucide-react/dist/esm/icons/palette.js`
  - `lucide-react/dist/esm/icons/printer.js`
  - `lucide-react/dist/esm/icons/save.js`
  - `lucide-react/dist/esm/icons/truck.js`
  - `lucide-react/dist/esm/icons/type.js`
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

### 3.393 `frontend/src/components/receipt-settings/template.ts`

- Declared exports: `parseReceiptTemplate`, `serializeReceiptTemplate`
- Imports (1)
  - `./constants.ts`
- Internal dependencies (1)
  - `frontend/src/components/receipt-settings/constants.ts`
- Referenced by (4)
  - `frontend/src/components/receipt-settings/ReceiptSettings.tsx`
  - `frontend/src/components/receipt/Receipt.tsx`
  - `frontend/tests/receiptTemplate.test.ts`
  - `ops/scripts/runtime/live-checks/phase84-receipt-settings-rollback-check.ts`

### 3.394 `frontend/src/components/receipt/Receipt.tsx`

- Declared exports: `function`
- Imports (9)
  - `../../AppContext.tsx`
  - `../../utils/printReceipt`
  - `../../utils/receiptAppliedConfig.ts`
  - `../receipt-settings/template`
  - `lucide-react/dist/esm/icons/arrow-left.js`
  - `lucide-react/dist/esm/icons/file-text.js`
  - `lucide-react/dist/esm/icons/image-down.js`
  - `lucide-react/dist/esm/icons/printer.js`
  - `react`
- Internal dependencies (4)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/receipt-settings/template.ts`
  - `frontend/src/utils/printReceipt.ts`
  - `frontend/src/utils/receiptAppliedConfig.ts`
- Referenced by (3)
  - `frontend/src/components/pos/POS.tsx`
  - `frontend/src/components/receipt-settings/ReceiptPreview.tsx`
  - `frontend/src/components/sales/Sales.tsx`

### 3.395 `frontend/src/components/returns/EditReturnModal.tsx`

- Declared exports: `function`
- Imports (5)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../../utils/loaders.ts`
  - `../shared/AppSelect.tsx`
  - `react`
- Internal dependencies (4)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/shared/AppSelect.tsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/components/returns/Returns.tsx`

### 3.396 `frontend/src/components/returns/NewReturnModal.tsx`

- Declared exports: `function`
- Imports (5)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../../utils/formatters`
  - `../shared/AppSelect.tsx`
  - `react`
- Internal dependencies (4)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/shared/AppSelect.tsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/formatters.ts`
- Referenced by (1)
  - `frontend/src/components/returns/Returns.tsx`

### 3.397 `frontend/src/components/returns/NewSupplierReturnModal.tsx`

- Declared exports: `function`
- Imports (8)
  - `../../AppContext.tsx`
  - `../../api/branchTransport.ts`
  - `../../api/contactReadTransport.ts`
  - `../../api/inventoryTransport.ts`
  - `../../api/returnsTransport.ts`
  - `../../utils/actionGuards.ts`
  - `../shared/AppSelect.tsx`
  - `react`
- Internal dependencies (7)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/api/branchTransport.ts`
  - `frontend/src/api/contactReadTransport.ts`
  - `frontend/src/api/inventoryTransport.ts`
  - `frontend/src/api/returnsTransport.ts`
  - `frontend/src/components/shared/AppSelect.tsx`
  - `frontend/src/utils/actionGuards.ts`
- Referenced by (1)
  - `frontend/src/components/returns/Returns.tsx`

### 3.398 `frontend/src/components/returns/ReturnDetailModal.tsx`

- Declared exports: `function`
- Imports (2)
  - `../../AppContext.tsx`
  - `../../utils/formatters.ts`
- Internal dependencies (2)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/utils/formatters.ts`
- Referenced by (1)
  - `frontend/src/components/returns/Returns.tsx`

### 3.399 `frontend/src/components/returns/Returns.tsx`

- Declared exports: `function`
- Imports (23)
  - `../../AppContext.tsx`
  - `../../api/returnsTransport.ts`
  - `../../utils/actionGuards.ts`
  - `../../utils/actionHistory.ts`
  - `../../utils/csv.ts`
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
  - `lucide-react/dist/esm/icons/download.js`
  - `lucide-react/dist/esm/icons/rotate-ccw.js`
  - `lucide-react/dist/esm/icons/search.js`
  - `lucide-react/dist/esm/icons/undo-2.js`
  - `react`
- Internal dependencies (18)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/api/returnsTransport.ts`
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

### 3.400 `frontend/src/components/returns/ReturnsListSurface.tsx`

- Declared exports: `function`
- Imports (3)
  - `lucide-react/dist/esm/icons/chevron-down.js`
  - `lucide-react/dist/esm/icons/chevron-right.js`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/returns/Returns.tsx`

### 3.401 `frontend/src/components/sales/ExportModal.tsx`

- Declared exports: `function`
- Imports (8)
  - `../../utils/loaders.ts`
  - `../shared/Modal`
  - `./StatusBadge`
  - `lucide-react/dist/esm/icons/calendar-range.js`
  - `lucide-react/dist/esm/icons/eye.js`
  - `lucide-react/dist/esm/icons/file-spreadsheet.js`
  - `lucide-react/dist/esm/icons/upload.js`
  - `react`
- Internal dependencies (3)
  - `frontend/src/components/sales/StatusBadge.tsx`
  - `frontend/src/components/shared/Modal.tsx`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/components/sales/Sales.tsx`

### 3.402 `frontend/src/components/sales/SaleDetailModal.tsx`

- Declared exports: `function`
- Imports (4)
  - `../../utils/formatters.ts`
  - `../shared/AppSelect.tsx`
  - `./StatusBadge.tsx`
  - `react`
- Internal dependencies (3)
  - `frontend/src/components/sales/StatusBadge.tsx`
  - `frontend/src/components/shared/AppSelect.tsx`
  - `frontend/src/utils/formatters.ts`
- Referenced by (1)
  - `frontend/src/components/sales/Sales.tsx`

### 3.403 `frontend/src/components/sales/Sales.tsx`

- Declared exports: `function`
- Imports (26)
  - `../../AppContext.tsx`
  - `../../api/salesTransport.ts`
  - `../../api/userReadTransport.ts`
  - `../../utils/actionGuards.ts`
  - `../../utils/actionHistory.ts`
  - `../../utils/bulkOps.ts`
  - `../../utils/csv.ts`
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
  - `lucide-react/dist/esm/icons/search.js`
  - `lucide-react/dist/esm/icons/shopping-bag.js`
  - `lucide-react/dist/esm/icons/upload.js`
  - `react`
- Internal dependencies (22)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/api/salesTransport.ts`
  - `frontend/src/api/userReadTransport.ts`
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

### 3.404 `frontend/src/components/sales/SalesImportModal.tsx`

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

### 3.405 `frontend/src/components/sales/salesImportWorker.ts`

- Declared exports: none detected
- Imports (1)
  - `../../utils/csvRowCounter`
- Internal dependencies (1)
  - `frontend/src/utils/csvRowCounter.ts`
- Referenced by (0)
  - none

### 3.406 `frontend/src/components/sales/SalesListSurface.tsx`

- Declared exports: `function`
- Imports (4)
  - `./StatusBadge.tsx`
  - `lucide-react/dist/esm/icons/chevron-down.js`
  - `lucide-react/dist/esm/icons/chevron-right.js`
  - `react`
- Internal dependencies (1)
  - `frontend/src/components/sales/StatusBadge.tsx`
- Referenced by (1)
  - `frontend/src/components/sales/Sales.tsx`

### 3.407 `frontend/src/components/sales/StatusBadge.tsx`

- Declared exports: `ALL_STATUSES`, `STATUS_COLORS`, `STATUS_LABELS`, `function`, `getStatusLabel`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (4)
  - `frontend/src/components/sales/ExportModal.tsx`
  - `frontend/src/components/sales/SaleDetailModal.tsx`
  - `frontend/src/components/sales/Sales.tsx`
  - `frontend/src/components/sales/SalesListSurface.tsx`

### 3.408 `frontend/src/components/server/ServerPage.tsx`

- Declared exports: `function`
- Imports (13)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../shared/PageHeader`
  - `../shared/pageActivity`
  - `lucide-react/dist/esm/icons/alert-triangle.js`
  - `lucide-react/dist/esm/icons/check-circle-2.js`
  - `lucide-react/dist/esm/icons/chevron-down.js`
  - `lucide-react/dist/esm/icons/chevron-up.js`
  - `lucide-react/dist/esm/icons/refresh-cw.js`
  - `lucide-react/dist/esm/icons/server.js`
  - `lucide-react/dist/esm/icons/wifi-off.js`
  - `lucide-react/dist/esm/icons/wifi.js`
  - `react`
- Internal dependencies (4)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/shared/PageHeader.tsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/utils/actionGuards.ts`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.409 `frontend/src/components/shared/ActionHistoryBar.tsx`

- Declared exports: `function`
- Imports (6)
  - `../../AppContext.tsx`
  - `./AppSelect`
  - `lucide-react/dist/esm/icons/corner-down-left.js`
  - `lucide-react/dist/esm/icons/corner-down-right.js`
  - `lucide-react/dist/esm/icons/history.js`
  - `react`
- Internal dependencies (2)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/shared/AppSelect.tsx`
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

### 3.410 `frontend/src/components/shared/AppSelect.tsx`

- Declared exports: `function`
- Imports (3)
  - `lucide-react/dist/esm/icons/chevron-down.js`
  - `react`
  - `react-dom`
- Internal dependencies (0)
  - none
- Referenced by (29)
  - `frontend/src/components/auth/Login.tsx`
  - `frontend/src/components/branches/TransferModal.tsx`
  - `frontend/src/components/catalog/CatalogEditorSurface.tsx`
  - `frontend/src/components/catalog/catalogPagination.tsx`
  - `frontend/src/components/catalog/CatalogSecondaryTabs.tsx`
  - `frontend/src/components/contacts/ContactImportModal.tsx`
  - `frontend/src/components/custom-tables/CustomTables.tsx`
  - `frontend/src/components/dashboard/Dashboard.tsx`
  - `frontend/src/components/files/FilesPage.tsx`
  - `frontend/src/components/files/FilesProvidersTab.tsx`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx`
  - `frontend/src/components/pos/CartItem.tsx`
  - `frontend/src/components/products/forms/BranchStockAdjuster.tsx`
  - `frontend/src/components/products/forms/BulkAddStockModal.tsx`
  - `frontend/src/components/products/forms/ProductForm.tsx`
  - `frontend/src/components/products/forms/VariantFormModal.tsx`
  - `frontend/src/components/products/import/BulkImportModal.tsx`
  - `frontend/src/components/products/Products.tsx`
  - `frontend/src/components/returns/EditReturnModal.tsx`
  - `frontend/src/components/returns/NewReturnModal.tsx`
  - `frontend/src/components/returns/NewSupplierReturnModal.tsx`
  - `frontend/src/components/sales/SaleDetailModal.tsx`
  - `frontend/src/components/shared/ActionHistoryBar.tsx`
  - `frontend/src/components/shared/NotificationCenter.tsx`
  - `frontend/src/components/shared/PaginationControls.tsx`
  - `frontend/src/components/users/UserProfileModal.tsx`
  - `frontend/src/components/users/Users.tsx`
  - `frontend/src/components/utils-settings/Settings.tsx`

### 3.411 `frontend/src/components/shared/BackgroundImportTracker.tsx`

- Declared exports: `function`
- Imports (13)
  - `../../AppContext.tsx`
  - `../../api/http.ts`
  - `../../utils/actionGuards.ts`
  - `../../utils/importJobRefresh.ts`
  - `../../utils/loaders.ts`
  - `lucide-react/dist/esm/icons/alert-triangle.js`
  - `lucide-react/dist/esm/icons/check-circle-2.js`
  - `lucide-react/dist/esm/icons/file-down.js`
  - `lucide-react/dist/esm/icons/loader-2.js`
  - `lucide-react/dist/esm/icons/play-circle.js`
  - `lucide-react/dist/esm/icons/rotate-ccw.js`
  - `lucide-react/dist/esm/icons/x-circle.js`
  - `react`
- Internal dependencies (5)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/api/http.ts`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/importJobRefresh.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.412 `frontend/src/components/shared/ExportMenu.tsx`

- Declared exports: `function`
- Imports (3)
  - `./PortalMenu`
  - `lucide-react/dist/esm/icons/download.js`
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

### 3.413 `frontend/src/components/shared/FilterMenu.tsx`

- Declared exports: `function`
- Imports (4)
  - `./LazyPortalMenu`
  - `lucide-react/dist/esm/icons/filter.js`
  - `lucide-react/dist/esm/icons/x.js`
  - `react`
- Internal dependencies (1)
  - `frontend/src/components/shared/LazyPortalMenu.tsx`
- Referenced by (8)
  - `frontend/src/components/contacts/CustomersTab.tsx`
  - `frontend/src/components/contacts/DeliveryTab.tsx`
  - `frontend/src/components/contacts/SuppliersTab.tsx`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/products/Products.tsx`
  - `frontend/src/components/returns/Returns.tsx`
  - `frontend/src/components/sales/Sales.tsx`
  - `frontend/src/components/utils-settings/AuditLog.tsx`

### 3.414 `frontend/src/components/shared/globalScroll.ts`

- Declared exports: `getScrollTarget`, `getScrollToPosition`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/App.tsx`
  - `frontend/tests/globalScrollControls.test.ts`

### 3.415 `frontend/src/components/shared/ImageGalleryLightbox.tsx`

- Declared exports: `function`
- Imports (4)
  - `lucide-react/dist/esm/icons/chevron-left.js`
  - `lucide-react/dist/esm/icons/chevron-right.js`
  - `lucide-react/dist/esm/icons/x.js`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `frontend/src/components/catalog/CatalogPreviewSurface.tsx`
  - `frontend/src/components/pos/POS.tsx`
  - `frontend/src/components/products/Products.tsx`

### 3.416 `frontend/src/components/shared/LazyPortalMenu.tsx`

- Declared exports: `function`
- Imports (2)
  - `./PortalMenu`
  - `react`
- Internal dependencies (1)
  - `frontend/src/components/shared/PortalMenu.tsx`
- Referenced by (5)
  - `frontend/src/components/catalog/CatalogPreviewSurface.tsx`
  - `frontend/src/components/contacts/shared.tsx`
  - `frontend/src/components/products/surfaces/HeaderActions.tsx`
  - `frontend/src/components/products/surfaces/ProductRowParts.tsx`
  - `frontend/src/components/shared/FilterMenu.tsx`

### 3.417 `frontend/src/components/shared/LoadingWatchdog.tsx`

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

### 3.418 `frontend/src/components/shared/Modal.tsx`

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

### 3.419 `frontend/src/components/shared/navigationConfig.ts`

- Declared exports: `DEFAULT_MOBILE_PINNED`, `NAV_ITEMS`, `orderNavItems`, `parseNavSetting`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `frontend/src/components/navigation/Sidebar.tsx`
  - `frontend/src/components/utils-settings/Settings.tsx`
  - `frontend/tests/navigationConfig.test.ts`

### 3.420 `frontend/src/components/shared/NotificationCenter.tsx`

- Declared exports: `function`
- Imports (15)
  - `../../AppContext.tsx`
  - `./AppSelect`
  - `lucide-react`
  - `lucide-react/dist/esm/icons/alert-circle.js`
  - `lucide-react/dist/esm/icons/alert-triangle.js`
  - `lucide-react/dist/esm/icons/bell.js`
  - `lucide-react/dist/esm/icons/check-circle-2.js`
  - `lucide-react/dist/esm/icons/chevron-down.js`
  - `lucide-react/dist/esm/icons/external-link.js`
  - `lucide-react/dist/esm/icons/info.js`
  - `lucide-react/dist/esm/icons/search.js`
  - `lucide-react/dist/esm/icons/settings-2.js`
  - `lucide-react/dist/esm/icons/x.js`
  - `react`
  - `react-dom`
- Internal dependencies (2)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/shared/AppSelect.tsx`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.421 `frontend/src/components/shared/pageActivity.ts`

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

### 3.422 `frontend/src/components/shared/PageHeader.tsx`

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

### 3.423 `frontend/src/components/shared/PaginationControls.tsx`

- Declared exports: `PAGE_SIZE_OPTIONS`, `clampPage`, `function`, `paginateItems`
- Imports (4)
  - `./AppSelect`
  - `lucide-react/dist/esm/icons/chevron-left.js`
  - `lucide-react/dist/esm/icons/chevron-right.js`
  - `react`
- Internal dependencies (1)
  - `frontend/src/components/shared/AppSelect.tsx`
- Referenced by (8)
  - `frontend/src/components/contacts/shared.tsx`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/inventory/InventoryMovementsSurface.tsx`
  - `frontend/src/components/pos/POS.tsx`
  - `frontend/src/components/products/Products.tsx`
  - `frontend/src/components/returns/Returns.tsx`
  - `frontend/src/components/sales/Sales.tsx`
  - `frontend/src/components/utils-settings/AuditLog.tsx`

### 3.424 `frontend/src/components/shared/PortalMenu.tsx`

- Declared exports: `ThreeDotPortal`, `function`
- Imports (3)
  - `lucide-react/dist/esm/icons/more-horizontal.js`
  - `react`
  - `react-dom`
- Internal dependencies (0)
  - none
- Referenced by (7)
  - `frontend/src/components/inventory/InventoryMovementsSurface.tsx`
  - `frontend/src/components/products/surfaces/HeaderActions.tsx`
  - `frontend/src/components/products/surfaces/ProductRowParts.tsx`
  - `frontend/src/components/sales/Sales.tsx`
  - `frontend/src/components/shared/ExportMenu.tsx`
  - `frontend/src/components/shared/LazyPortalMenu.tsx`
  - `frontend/src/components/users/Users.tsx`

### 3.425 `frontend/src/components/shared/QuickPreferenceToggles.tsx`

- Declared exports: `function`
- Imports (5)
  - `../../AppContext.tsx`
  - `lucide-react/dist/esm/icons/languages.js`
  - `lucide-react/dist/esm/icons/moon.js`
  - `lucide-react/dist/esm/icons/sun.js`
  - `react`
- Internal dependencies (1)
  - `frontend/src/AppContext.tsx`
- Referenced by (3)
  - `frontend/src/App.tsx`
  - `frontend/src/components/auth/Login.tsx`
  - `frontend/src/components/navigation/Sidebar.tsx`

### 3.426 `frontend/src/components/shared/SectionSwitcher.tsx`

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

### 3.427 `frontend/src/components/shared/WriteConflictModal.tsx`

- Declared exports: `function`
- Imports (1)
  - `./Modal`
- Internal dependencies (1)
  - `frontend/src/components/shared/Modal.tsx`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.428 `frontend/src/components/users/permissionDefinitions.ts`

- Declared exports: `PERMISSION_DEFS`, `PERMISSION_SECTIONS`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `frontend/src/components/users/PermissionEditor.tsx`
  - `frontend/src/components/users/UserDetailSheet.tsx`
  - `frontend/src/components/users/Users.tsx`

### 3.429 `frontend/src/components/users/PermissionEditor.tsx`

- Declared exports: `function`
- Imports (1)
  - `./permissionDefinitions`
- Internal dependencies (1)
  - `frontend/src/components/users/permissionDefinitions.ts`
- Referenced by (1)
  - `frontend/src/components/users/Users.tsx`

### 3.430 `frontend/src/components/users/UserDetailSheet.tsx`

- Declared exports: `function`
- Imports (2)
  - `../../utils/formatters`
  - `./permissionDefinitions`
- Internal dependencies (2)
  - `frontend/src/components/users/permissionDefinitions.ts`
  - `frontend/src/utils/formatters.ts`
- Referenced by (1)
  - `frontend/src/components/users/Users.tsx`

### 3.431 `frontend/src/components/users/UserProfileModal.tsx`

- Declared exports: `function`
- Imports (15)
  - `../../AppContext.tsx`
  - `../../constants`
  - `../../utils/actionHistory.ts`
  - `../../utils/loaders.ts`
  - `../files/FilePickerModal`
  - `../shared/ActionHistoryBar`
  - `../shared/AppSelect.tsx`
  - `../shared/Modal`
  - `../utils-settings/OtpModal`
  - `lucide-react/dist/esm/icons/chrome.js`
  - `lucide-react/dist/esm/icons/link-2.js`
  - `lucide-react/dist/esm/icons/log-out.js`
  - `lucide-react/dist/esm/icons/mail.js`
  - `lucide-react/dist/esm/icons/shield-check.js`
  - `react`
- Internal dependencies (9)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/files/FilePickerModal.tsx`
  - `frontend/src/components/shared/ActionHistoryBar.tsx`
  - `frontend/src/components/shared/AppSelect.tsx`
  - `frontend/src/components/shared/Modal.tsx`
  - `frontend/src/components/utils-settings/OtpModal.tsx`
  - `frontend/src/constants.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (2)
  - `frontend/src/components/navigation/Sidebar.tsx`
  - `frontend/src/components/users/Users.tsx`

### 3.432 `frontend/src/components/users/Users.tsx`

- Declared exports: `function`
- Imports (17)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../../utils/actionHistory.ts`
  - `../../utils/formatters`
  - `../../utils/historyHelpers.ts`
  - `../shared/ActionHistoryBar`
  - `../shared/AppSelect.tsx`
  - `../shared/Modal`
  - `../shared/PortalMenu`
  - `../shared/pageActivity`
  - `./PermissionEditor`
  - `./UserDetailSheet`
  - `./UserProfileModal`
  - `./permissionDefinitions`
  - `lucide-react/dist/esm/icons/circle-user-round.js`
  - `lucide-react/dist/esm/icons/user-plus.js`
  - `react`
- Internal dependencies (14)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/shared/ActionHistoryBar.tsx`
  - `frontend/src/components/shared/AppSelect.tsx`
  - `frontend/src/components/shared/Modal.tsx`
  - `frontend/src/components/shared/PortalMenu.tsx`
  - `frontend/src/components/shared/pageActivity.ts`
  - `frontend/src/components/users/PermissionEditor.tsx`
  - `frontend/src/components/users/UserDetailSheet.tsx`
  - `frontend/src/components/users/UserProfileModal.tsx`
  - `frontend/src/components/users/permissionDefinitions.ts`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/actionHistory.ts`
  - `frontend/src/utils/formatters.ts`
  - `frontend/src/utils/historyHelpers.ts`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.433 `frontend/src/components/utils-settings/AuditLog.tsx`

- Declared exports: `function`
- Imports (18)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../../utils/csv`
  - `../../utils/groupedRecords.ts`
  - `../shared/ExportMenu`
  - `../shared/FilterMenu`
  - `../shared/PaginationControls`
  - `../shared/pageActivity`
  - `lucide-react/dist/esm/icons/chevron-down.js`
  - `lucide-react/dist/esm/icons/chevron-right.js`
  - `lucide-react/dist/esm/icons/clipboard-list.js`
  - `lucide-react/dist/esm/icons/clock-3.js`
  - `lucide-react/dist/esm/icons/monitor-smartphone.js`
  - `lucide-react/dist/esm/icons/refresh-cw.js`
  - `lucide-react/dist/esm/icons/search.js`
  - `lucide-react/dist/esm/icons/user-round.js`
  - `lucide-react/dist/esm/icons/x.js`
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

### 3.434 `frontend/src/components/utils-settings/Backup.tsx`

- Declared exports: `function`
- Imports (19)
  - `../../AppContext.tsx`
  - `../../utils/actionHistory.ts`
  - `../shared/ActionHistoryBar`
  - `../shared/LoadingWatchdog`
  - `../shared/PageHeader`
  - `../shared/SectionSwitcher`
  - `../shared/pageActivity`
  - `./ResetData`
  - `lucide-react/dist/esm/icons/archive-restore.js`
  - `lucide-react/dist/esm/icons/check-circle-2.js`
  - `lucide-react/dist/esm/icons/cloud.js`
  - `lucide-react/dist/esm/icons/folder-input.js`
  - `lucide-react/dist/esm/icons/folder-output.js`
  - `lucide-react/dist/esm/icons/hard-drive-download.js`
  - `lucide-react/dist/esm/icons/link-2-off.js`
  - `lucide-react/dist/esm/icons/link-2.js`
  - `lucide-react/dist/esm/icons/refresh-cw.js`
  - `lucide-react/dist/esm/icons/upload.js`
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

### 3.435 `frontend/src/components/utils-settings/FontFamilyPicker.tsx`

- Declared exports: `function`
- Imports (3)
  - `lucide-react/dist/esm/icons/chevron-down.js`
  - `lucide-react/dist/esm/icons/chevron-up.js`
  - `react`
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/utils-settings/Settings.tsx`

### 3.436 `frontend/src/components/utils-settings/index.ts`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.437 `frontend/src/components/utils-settings/OtpModal.tsx`

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

### 3.438 `frontend/src/components/utils-settings/ResetData.tsx`

- Declared exports: none detected
- Imports (10)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../../utils/appRefresh`
  - `../../utils/loaders.ts`
  - `lucide-react`
  - `lucide-react/dist/esm/icons/alert-triangle.js`
  - `lucide-react/dist/esm/icons/rotate-ccw.js`
  - `lucide-react/dist/esm/icons/shield-alert.js`
  - `lucide-react/dist/esm/icons/trash-2.js`
  - `react`
- Internal dependencies (4)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/utils/actionGuards.ts`
  - `frontend/src/utils/appRefresh.ts`
  - `frontend/src/utils/loaders.ts`
- Referenced by (1)
  - `frontend/src/components/utils-settings/Backup.tsx`

### 3.439 `frontend/src/components/utils-settings/Settings.tsx`

- Declared exports: `function`
- Imports (42)
  - `../../AppContext.tsx`
  - `../../utils/actionGuards.ts`
  - `../../utils/favicon.ts`
  - `../../utils/loaders.ts`
  - `../../utils/mediaUpload.ts`
  - `../../utils/mediaUploadState.ts`
  - `../shared/AppSelect.tsx`
  - `../shared/LoadingWatchdog`
  - `../shared/PageHeader`
  - `../shared/SectionSwitcher`
  - `../shared/navigationConfig`
  - `./FontFamilyPicker`
  - `./OtpModal`
  - `./settingsConflict.ts`
  - `lucide-react/dist/esm/icons/arrow-down.js`
  - `lucide-react/dist/esm/icons/arrow-up.js`
  - `lucide-react/dist/esm/icons/badge-dollar-sign.js`
  - `lucide-react/dist/esm/icons/book-user.js`
  - `lucide-react/dist/esm/icons/boxes.js`
  - `lucide-react/dist/esm/icons/building-2.js`
  - `lucide-react/dist/esm/icons/chevron-down.js`
  - `lucide-react/dist/esm/icons/clipboard-list.js`
  - `lucide-react/dist/esm/icons/database-backup.js`
  - `lucide-react/dist/esm/icons/folder-open.js`
  - `lucide-react/dist/esm/icons/grip-vertical.js`
  - `lucide-react/dist/esm/icons/image-plus.js`
  - `lucide-react/dist/esm/icons/layout-dashboard.js`
  - `lucide-react/dist/esm/icons/monitor-smartphone.js`
  - `lucide-react/dist/esm/icons/package.js`
  - `lucide-react/dist/esm/icons/pin-off.js`
  - `lucide-react/dist/esm/icons/pin.js`
  - `lucide-react/dist/esm/icons/receipt.js`
  - `lucide-react/dist/esm/icons/rotate-ccw.js`
  - `lucide-react/dist/esm/icons/save.js`
  - `lucide-react/dist/esm/icons/server.js`
  - `lucide-react/dist/esm/icons/settings.js`
  - `lucide-react/dist/esm/icons/shopping-bag.js`
  - `lucide-react/dist/esm/icons/shopping-cart.js`
  - `lucide-react/dist/esm/icons/ticket.js`
  - `lucide-react/dist/esm/icons/trash-2.js`
  - `lucide-react/dist/esm/icons/users.js`
  - `react`
- Internal dependencies (14)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/shared/AppSelect.tsx`
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
  - `frontend/src/utils/mediaUpload.ts`
  - `frontend/src/utils/mediaUploadState.ts`
- Referenced by (1)
  - `frontend/src/App.tsx`

### 3.440 `frontend/src/components/utils-settings/settingsConflict.ts`

- Declared exports: `buildSettingsConflictState`, `diffSettingsConflictFields`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/utils-settings/Settings.tsx`
  - `frontend/tests/settingsConflictHelpers.test.ts`

### 3.441 `frontend/src/constants.ts`

- Declared exports: `CURRENCY`, `DELIVERY_FEE_PAYER`, `EMPTY_CUSTOMER`, `LAYOUT`, `PAYMENT_METHODS`, `STOCK`, `STORAGE_KEYS`, `SYNC`, `WRITE_CHANNELS`, `createEmptyOrder`, `formatDate`, `isNetworkError`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (14)
  - `frontend/src/api/actorQuery.ts`
  - `frontend/src/api/appBootstrapTransport.ts`
  - `frontend/src/api/driveSync.ts`
  - `frontend/src/api/http.ts`
  - `frontend/src/api/salesTransport.ts`
  - `frontend/src/api/syncRuntime.ts`
  - `frontend/src/api/systemJobs.ts`
  - `frontend/src/api/systemRuntime.ts`
  - `frontend/src/api/websocket.ts`
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/auth/Login.tsx`
  - `frontend/src/components/users/UserProfileModal.tsx`
  - `frontend/src/platform/runtime/clientRuntime.ts`
  - `frontend/src/web-api.ts`

### 3.442 `frontend/src/index.tsx`

- Declared exports: none detected
- Imports (9)
  - `./AdminRoot.tsx`
  - `./PublicCatalogRoot.tsx`
  - `./app/pathRouting.ts`
  - `./styles/main.css`
  - `@fontsource/noto-sans-khmer/400.css`
  - `@fontsource/noto-sans-khmer/500.css`
  - `@fontsource/noto-sans-khmer/600.css`
  - `react`
  - `react-dom/client`
- Internal dependencies (4)
  - `frontend/src/AdminRoot.tsx`
  - `frontend/src/PublicCatalogRoot.tsx`
  - `frontend/src/app/pathRouting.ts`
  - `frontend/src/styles/main.css`
- Referenced by (0)
  - none

### 3.443 `frontend/src/platform/runtime/clientRuntime.ts`

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

### 3.444 `frontend/src/platform/storage/storagePolicy.ts`

- Declared exports: `DRIVE_SYNC_STATUS_COOLDOWN_KEY`, `DRIVE_SYNC_STATUS_COOLDOWN_MS`, `LIVE_SERVER_SENSITIVE_MIRROR_TABLES`, `NOTIFICATION_SUMMARY_MISSING_TTL_MS`, `NOTIFICATION_SUMMARY_MISSING_UNTIL_KEY`, `isCooldownActive`, `maxStoredNumber`, `shouldPersistLocalMirror`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `frontend/src/api/driveSync.ts`
  - `frontend/src/api/localMirrors.ts`
  - `frontend/src/api/notificationSummary.ts`

### 3.445 `frontend/src/public-runtime/runtime-noise-guard.ts`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.446 `frontend/src/public-runtime/service-worker.ts`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.447 `frontend/src/public-runtime/theme-bootstrap.ts`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.448 `frontend/src/public-web-api.ts`

- Declared exports: none detected
- Imports (1)
  - `./api/portalTransport.ts`
- Internal dependencies (1)
  - `frontend/src/api/portalTransport.ts`
- Referenced by (1)
  - `frontend/src/PublicCatalogRoot.tsx`

### 3.449 `frontend/src/PublicCatalogRoot.tsx`

- Declared exports: `function`
- Imports (4)
  - `./AppContext.tsx`
  - `./components/catalog/CatalogPage.tsx`
  - `./public-web-api.ts`
  - `react`
- Internal dependencies (3)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/catalog/CatalogPage.tsx`
  - `frontend/src/public-web-api.ts`
- Referenced by (1)
  - `frontend/src/index.tsx`

### 3.450 `frontend/src/runtime/runtimeErrorClassifier.ts`

- Declared exports: `isFirstPartyBuiltAssetSource`, `isGuardableStyleSheetError`, `isKnownBridgeMessage`, `isKnownEvalCspNoise`, `isKnownStyleInjectionNoise`, `isLikelyInjectedRuntimeSource`, `shouldSuppressRuntimeError`, `shouldSuppressSecurityPolicyViolation`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.451 `frontend/src/types/lucide-react-icons.d.ts`

- Declared exports: `Icon`
- Imports (1)
  - `lucide-react`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.452 `frontend/src/types/receiptContracts.ts`

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

### 3.453 `frontend/src/types/settingsContracts.ts`

- Declared exports: `SETTINGS_REFRESH_CHANNELS`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/utils/settingsWriteOptions.ts`

### 3.454 `frontend/src/utils/actionGuards.ts`

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

### 3.455 `frontend/src/utils/actionHistory.ts`

- Declared exports: `useActionHistory`
- Imports (3)
  - `../AppContext.tsx`
  - `../api/actionHistoryTransport.ts`
  - `react`
- Internal dependencies (2)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/api/actionHistoryTransport.ts`
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

### 3.456 `frontend/src/utils/appRefresh.ts`

- Declared exports: `DEFAULT_REFRESH_CHANNELS`, `normalizeRefreshChannels`, `refreshAppData`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (6)
  - `frontend/src/api/methods.ts`
  - `frontend/src/api/settingsTransport.ts`
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/utils-settings/ResetData.tsx`
  - `frontend/src/utils/settingsRefresh.ts`
  - `frontend/tests/appRefresh.test.ts`

### 3.457 `frontend/src/utils/bulkOps.ts`

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

### 3.458 `frontend/src/utils/color.ts`

- Declared exports: `getContrastingTextColor`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/products/Products.tsx`
  - `frontend/src/components/products/surfaces/ProductDetailModal.tsx`

### 3.459 `frontend/src/utils/csv.ts`

- Declared exports: `UTF8_BOM`, `buildCSV`, `buildZip`, `buildZipInWorker`, `downloadBlob`, `downloadCSV`, `downloadZipFiles`, `downloadZipFilesAsync`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (14)
  - `frontend/src/components/contacts/Contacts.tsx`
  - `frontend/src/components/contacts/CustomersTab.tsx`
  - `frontend/src/components/contacts/DeliveryTab.tsx`
  - `frontend/src/components/contacts/SuppliersTab.tsx`
  - `frontend/src/components/dashboard/dashboardExport.ts`
  - `frontend/src/components/inventory/inventoryExport.ts`
  - `frontend/src/components/products/Products.tsx`
  - `frontend/src/components/returns/Returns.tsx`
  - `frontend/src/components/sales/Sales.tsx`
  - `frontend/src/components/utils-settings/AuditLog.tsx`
  - `frontend/src/utils/csvExportWorker.ts`
  - `frontend/src/utils/csvTemplate.ts`
  - `frontend/src/utils/exportPackage.ts`
  - `frontend/tests/exportPackages.test.ts`

### 3.460 `frontend/src/utils/csvExportWorker.ts`

- Declared exports: none detected
- Imports (1)
  - `./csv.ts`
- Internal dependencies (1)
  - `frontend/src/utils/csv.ts`
- Referenced by (0)
  - none

### 3.461 `frontend/src/utils/csvImport.ts`

- Declared exports: `decodeTextBuffer`, `detectCsvDelimiter`, `normalizeCsvKey`, `normalizeCsvMoney`, `normalizeCsvPercent`, `normalizeNumericText`, `parseCsvNumber`, `parseCsvRows`, `parseDelimitedRows`, `parseRequiredCsvNumber`, `splitCsvLine`
- Imports (1)
  - `./pricing.ts`
- Internal dependencies (1)
  - `frontend/src/utils/pricing.ts`
- Referenced by (3)
  - `frontend/src/api/browserDialogs.ts`
  - `frontend/src/api/localDb.ts`
  - `frontend/tests/csvImport.test.ts`

### 3.462 `frontend/src/utils/csvRowCounter.ts`

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

### 3.463 `frontend/src/utils/csvTemplate.ts`

- Declared exports: `buildCSVTemplate`
- Imports (1)
  - `./csv.ts`
- Internal dependencies (1)
  - `frontend/src/utils/csv.ts`
- Referenced by (3)
  - `frontend/src/api/contactsTransport.ts`
  - `frontend/src/api/localDb.ts`
  - `frontend/src/api/methods.ts`

### 3.464 `frontend/src/utils/dateHelpers.ts`

- Declared exports: `offsetDate`, `todayStr`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/dashboard/Dashboard.tsx`
  - `frontend/tests/dateHelpers.test.ts`

### 3.465 `frontend/src/utils/deviceInfo.ts`

- Declared exports: `getClientDeviceInfo`, `getClientMetaHeaders`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (21)
  - `frontend/src/api/actionHistoryTransport.ts`
  - `frontend/src/api/authTransport.ts`
  - `frontend/src/api/branchTransport.ts`
  - `frontend/src/api/contactsTransport.ts`
  - `frontend/src/api/contactWriteTransport.ts`
  - `frontend/src/api/fileTransport.ts`
  - `frontend/src/api/http.ts`
  - `frontend/src/api/importJobsTransport.ts`
  - `frontend/src/api/importTransport.ts`
  - `frontend/src/api/inventoryWriteTransport.ts`
  - `frontend/src/api/multipartHeaders.ts`
  - `frontend/src/api/productWriteTransport.ts`
  - `frontend/src/api/returnsTransport.ts`
  - `frontend/src/api/rfidTransport.ts`
  - `frontend/src/api/salesTransport.ts`
  - `frontend/src/api/saleWriteTransport.ts`
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/auth/Login.tsx`
  - `frontend/src/components/pos/POS.tsx`
  - `frontend/src/components/sales/Sales.tsx`
  - `frontend/tests/deviceInfo.test.ts`

### 3.466 `frontend/src/utils/exportPackage.ts`

- Declared exports: `buildReportManifestRows`, `buildReportPackageFiles`
- Imports (1)
  - `./csv.ts`
- Internal dependencies (1)
  - `frontend/src/utils/csv.ts`
- Referenced by (3)
  - `frontend/src/components/dashboard/dashboardExport.ts`
  - `frontend/src/components/inventory/inventoryExport.ts`
  - `frontend/tests/exportPackages.test.ts`

### 3.467 `frontend/src/utils/exportReports.tsx`

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
  - `frontend/src/components/dashboard/dashboardExport.ts`
  - `frontend/src/components/inventory/inventoryExport.ts`

### 3.468 `frontend/src/utils/favicon.ts`

- Declared exports: `createCircularFaviconDataUrl`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (3)
  - `frontend/src/App.tsx`
  - `frontend/src/components/catalog/CatalogPage.tsx`
  - `frontend/src/components/utils-settings/Settings.tsx`

### 3.469 `frontend/src/utils/formatters.ts`

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

### 3.470 `frontend/src/utils/groupedRecords.ts`

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

### 3.471 `frontend/src/utils/historyHelpers.ts`

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

### 3.472 `frontend/src/utils/importJobRefresh.ts`

- Declared exports: `dispatchImportCompletionRefresh`, `getImportCompletionRefreshChannels`, `shouldDispatchImportCompletionRefresh`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (1)
  - `frontend/src/components/shared/BackgroundImportTracker.tsx`

### 3.473 `frontend/src/utils/index.ts`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.474 `frontend/src/utils/initials.ts`

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

### 3.475 `frontend/src/utils/loaders.ts`

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

### 3.476 `frontend/src/utils/mediaUpload.ts`

- Declared exports: `buildCacheBustedMediaPath`
- Imports (2)
  - `./mediaUploadState.ts`
  - `./publicAssetUrls.ts`
- Internal dependencies (2)
  - `frontend/src/utils/mediaUploadState.ts`
  - `frontend/src/utils/publicAssetUrls.ts`
- Referenced by (5)
  - `frontend/src/components/catalog/CatalogEditorSurface.tsx`
  - `frontend/src/components/catalog/CatalogImageField.tsx`
  - `frontend/src/components/products/forms/ProductForm.tsx`
  - `frontend/src/components/utils-settings/Settings.tsx`
  - `frontend/tests/mediaUploadHelpers.test.ts`

### 3.477 `frontend/src/utils/mediaUploadState.ts`

- Declared exports: `createInitialUploadState`, `isTemporaryPreviewUrl`, `reduceUploadState`, `sanitizePersistedMediaPath`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/components/utils-settings/Settings.tsx`
  - `frontend/src/utils/mediaUpload.ts`

### 3.478 `frontend/src/utils/permissions.ts`

- Declared exports: `parsePermissionMap`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (2)
  - `frontend/src/AppContext.tsx`
  - `frontend/tests/permissions.test.ts`

### 3.479 `frontend/src/utils/pricing.ts`

- Declared exports: `calculateProductDiscount`, `formatPriceNumber`, `isProductDiscountActive`, `normalizeDiscountPercent`, `normalizeDiscountType`, `normalizePriceValue`, `roundUpToDecimals`, `toFiniteNumber`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (18)
  - `frontend/src/AppContext.tsx`
  - `frontend/src/components/catalog/portalCatalogDisplay.ts`
  - `frontend/src/components/dashboard/dashboardExport.ts`
  - `frontend/src/components/inventory/Inventory.tsx`
  - `frontend/src/components/inventory/inventoryExport.ts`
  - `frontend/src/components/inventory/ProductDetailModal.tsx`
  - `frontend/src/components/pos/CartItem.tsx`
  - `frontend/src/components/pos/POS.tsx`
  - `frontend/src/components/pos/posCore.ts`
  - `frontend/src/components/products/forms/ProductForm.tsx`
  - `frontend/src/components/products/forms/VariantFormModal.tsx`
  - `frontend/src/components/products/helpers/productDisplayHelpers.ts`
  - `frontend/src/components/products/helpers/productExport.ts`
  - `frontend/src/components/products/helpers/productWriteHelpers.ts`
  - `frontend/src/components/products/surfaces/ProductDetailModal.tsx`
  - `frontend/src/components/products/surfaces/ProductRowParts.tsx`
  - `frontend/src/utils/csvImport.ts`
  - `frontend/tests/pricingContacts.test.ts`

### 3.480 `frontend/src/utils/printReceipt.ts`

- Declared exports: `PRINT_DEFAULTS`, `createReceiptImageBlob`, `createReceiptPdfBlob`, `downloadReceiptImage`, `downloadReceiptPdf`, `getPaperWidthMm`, `getPrintSettings`, `normalizeReceiptContentWidth`, `openPrintableReceiptPreview`, `openReceiptPdf`, `printReceipt`, `savePrintSettings`
- Imports (1)
  - `../types/receiptContracts`
- Internal dependencies (1)
  - `frontend/src/types/receiptContracts.ts`
- Referenced by (2)
  - `frontend/src/components/receipt-settings/PrintSettings.tsx`
  - `frontend/src/components/receipt/Receipt.tsx`

### 3.481 `frontend/src/utils/productBatches.ts`

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

### 3.482 `frontend/src/utils/productGrouping.ts`

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

### 3.483 `frontend/src/utils/publicAssetUrls.ts`

- Declared exports: `getStoredPublicAssetBaseUrl`, `resolvePublicAssetUrl`
- Imports (1)
  - `../api/http.ts`
- Internal dependencies (1)
  - `frontend/src/api/http.ts`
- Referenced by (7)
  - `frontend/src/components/contacts/ContactImportModal.tsx`
  - `frontend/src/components/files/FilePickerModal.tsx`
  - `frontend/src/components/files/FilesPage.tsx`
  - `frontend/src/components/pos/ProductImage.tsx`
  - `frontend/src/components/products/helpers/productGalleryHelpers.ts`
  - `frontend/src/components/products/shared/primitives.tsx`
  - `frontend/src/utils/mediaUpload.ts`

### 3.484 `frontend/src/utils/receiptAppliedConfig.ts`

- Declared exports: `DEFAULT_RECEIPT_PRINT_SETTINGS`, `DEFAULT_RECEIPT_TEMPLATE`, `RECEIPT_PRINT_SETTINGS_STORAGE_KEY`, `buildAppliedReceiptConfig`, `normalizeReceiptPrintSettings`, `normalizeReceiptTemplate`, `readReceiptPrintSettingsFromSettings`, `serializeReceiptPrintSettings`, `serializeReceiptTemplateValue`
- Imports (1)
  - `../types/receiptContracts`
- Internal dependencies (1)
  - `frontend/src/types/receiptContracts.ts`
- Referenced by (3)
  - `frontend/src/components/receipt-settings/ReceiptPreview.tsx`
  - `frontend/src/components/receipt-settings/ReceiptSettings.tsx`
  - `frontend/src/components/receipt/Receipt.tsx`

### 3.485 `frontend/src/utils/scriptTypography.ts`

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

### 3.486 `frontend/src/utils/settingsRefresh.ts`

- Declared exports: `CATEGORY_REFRESH_CHANNELS`, `UNIT_REFRESH_CHANNELS`, `getSettingsRefreshChannels`
- Imports (1)
  - `./appRefresh.ts`
- Internal dependencies (1)
  - `frontend/src/utils/appRefresh.ts`
- Referenced by (1)
  - `frontend/src/api/settingsTransport.ts`

### 3.487 `frontend/src/utils/settingsWriteOptions.ts`

- Declared exports: `normalizeSettingsWriteOptions`
- Imports (1)
  - `../types/settingsContracts`
- Internal dependencies (1)
  - `frontend/src/types/settingsContracts.ts`
- Referenced by (1)
  - `frontend/src/AppContext.tsx`

### 3.488 `frontend/src/web-api.ts`

- Declared exports: none detected
- Imports (20)
  - `./api/actionHistoryTransport.ts`
  - `./api/appBootstrapTransport.ts`
  - `./api/authTransport.ts`
  - `./api/branchTransport.ts`
  - `./api/http.ts`
  - `./api/localDb.ts`
  - `./api/lookupTransport.ts`
  - `./api/methods.ts`
  - `./api/notificationSummary.ts`
  - `./api/offlineSnapshotTransport.ts`
  - `./api/portalTransport.ts`
  - `./api/productReadTransport.ts`
  - `./api/productWriteTransport.ts`
  - `./api/saleWriteTransport.ts`
  - `./api/settingsTransport.ts`
  - `./api/systemRuntime.ts`
  - `./api/userReadTransport.ts`
  - `./api/websocket.ts`
  - `./constants.ts`
  - `./platform/runtime/clientRuntime.ts`
- Internal dependencies (20)
  - `frontend/src/api/actionHistoryTransport.ts`
  - `frontend/src/api/appBootstrapTransport.ts`
  - `frontend/src/api/authTransport.ts`
  - `frontend/src/api/branchTransport.ts`
  - `frontend/src/api/http.ts`
  - `frontend/src/api/localDb.ts`
  - `frontend/src/api/lookupTransport.ts`
  - `frontend/src/api/methods.ts`
  - `frontend/src/api/notificationSummary.ts`
  - `frontend/src/api/offlineSnapshotTransport.ts`
  - `frontend/src/api/portalTransport.ts`
  - `frontend/src/api/productReadTransport.ts`
  - `frontend/src/api/productWriteTransport.ts`
  - `frontend/src/api/saleWriteTransport.ts`
  - `frontend/src/api/settingsTransport.ts`
  - `frontend/src/api/systemRuntime.ts`
  - `frontend/src/api/userReadTransport.ts`
  - `frontend/src/api/websocket.ts`
  - `frontend/src/constants.ts`
  - `frontend/src/platform/runtime/clientRuntime.ts`
- Referenced by (1)
  - `frontend/src/AdminRoot.tsx`

### 3.489 `frontend/tailwind.config.ts`

- Declared exports: none detected
- Imports (1)
  - `tailwindcss`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.490 `frontend/tests/actionGuards.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.491 `frontend/tests/actionStability.test.ts`

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

### 3.492 `frontend/tests/adminShellMediaGuards.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.493 `frontend/tests/apiHttp.test.ts`

- Declared exports: none detected
- Imports (15)
  - `../src/api/actorQuery.ts`
  - `../src/api/browserDialogs.ts`
  - `../src/api/conflicts.ts`
  - `../src/api/expectedUpdatedAt.ts`
  - `../src/api/importJobsTransport.ts`
  - `../src/api/importTransport.ts`
  - `../src/api/localMirrors.ts`
  - `../src/api/portalHttp.ts`
  - `../src/api/query.ts`
  - `../src/api/queryCache.ts`
  - `../src/api/requestIds.ts`
  - `../src/api/syncPreview.ts`
  - `../src/api/syncRuntime.ts`
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (13)
  - `frontend/src/api/actorQuery.ts`
  - `frontend/src/api/browserDialogs.ts`
  - `frontend/src/api/conflicts.ts`
  - `frontend/src/api/expectedUpdatedAt.ts`
  - `frontend/src/api/importJobsTransport.ts`
  - `frontend/src/api/importTransport.ts`
  - `frontend/src/api/localMirrors.ts`
  - `frontend/src/api/portalHttp.ts`
  - `frontend/src/api/query.ts`
  - `frontend/src/api/queryCache.ts`
  - `frontend/src/api/requestIds.ts`
  - `frontend/src/api/syncPreview.ts`
  - `frontend/src/api/syncRuntime.ts`
- Referenced by (0)
  - none

### 3.494 `frontend/tests/appRefresh.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/appRefresh.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/appRefresh.ts`
- Referenced by (0)
  - none

### 3.495 `frontend/tests/appShellUtils.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/app/appShellUtils.ts`
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (1)
  - `frontend/src/app/appShellUtils.ts`
- Referenced by (0)
  - none

### 3.496 `frontend/tests/assetCompression.test.ts`

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

### 3.497 `frontend/tests/backupJobs.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.498 `frontend/tests/barcodeImageScanner.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/components/products/scanning/barcodeImageScanner.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/products/scanning/barcodeImageScanner.ts`
- Referenced by (0)
  - none

### 3.499 `frontend/tests/barcodeScannerState.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/components/products/scanning/barcodeScannerState.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/products/scanning/barcodeScannerState.ts`
- Referenced by (0)
  - none

### 3.500 `frontend/tests/bulkOps.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/bulkOps.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/bulkOps.ts`
- Referenced by (0)
  - none

### 3.501 `frontend/tests/contactImportWorker.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/utils/csvRowCounter.ts`
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (1)
  - `frontend/src/utils/csvRowCounter.ts`
- Referenced by (0)
  - none

### 3.502 `frontend/tests/csvImport.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/utils/csvImport.ts`
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (1)
  - `frontend/src/utils/csvImport.ts`
- Referenced by (0)
  - none

### 3.503 `frontend/tests/dashboardDataReliability.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.504 `frontend/tests/dateHelpers.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/dateHelpers.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/dateHelpers.ts`
- Referenced by (0)
  - none

### 3.505 `frontend/tests/deviceInfo.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/deviceInfo.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/deviceInfo.ts`
- Referenced by (0)
  - none

### 3.506 `frontend/tests/exportPackages.test.ts`

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

### 3.507 `frontend/tests/formatters.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/formatters.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/formatters.ts`
- Referenced by (0)
  - none

### 3.508 `frontend/tests/globalScroll.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.509 `frontend/tests/globalScrollControls.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/components/shared/globalScroll.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/shared/globalScroll.ts`
- Referenced by (0)
  - none

### 3.510 `frontend/tests/groupedRecords.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/groupedRecords.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/groupedRecords.ts`
- Referenced by (0)
  - none

### 3.511 `frontend/tests/historyHelpers.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.512 `frontend/tests/importJobRefresh.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.513 `frontend/tests/initials.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.514 `frontend/tests/inventoryImportWorker.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/utils/csvRowCounter.ts`
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (1)
  - `frontend/src/utils/csvRowCounter.ts`
- Referenced by (0)
  - none

### 3.515 `frontend/tests/inventoryMobileCardLayout.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.516 `frontend/tests/inventoryMovementGroups.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/components/inventory/movementGroups.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/inventory/movementGroups.ts`
- Referenced by (0)
  - none

### 3.517 `frontend/tests/inventoryRfidSection.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.518 `frontend/tests/loaders.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.519 `frontend/tests/mediaUploadHelpers.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/mediaUpload.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/mediaUpload.ts`
- Referenced by (0)
  - none

### 3.520 `frontend/tests/navigationConfig.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/components/shared/navigationConfig.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/shared/navigationConfig.ts`
- Referenced by (0)
  - none

### 3.521 `frontend/tests/notificationBadge.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.522 `frontend/tests/offlineSalesQueue.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.523 `frontend/tests/offlineSecurityHardening.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.524 `frontend/tests/offlineSyncArchitecture.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.525 `frontend/tests/ownedGoogleAuth.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.526 `frontend/tests/performanceLoadingUx.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.527 `frontend/tests/permissionEditor.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.528 `frontend/tests/permissions.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/permissions.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/permissions.ts`
- Referenced by (0)
  - none

### 3.529 `frontend/tests/portalCatalogDisplay.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.530 `frontend/tests/portalContentI18n.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.531 `frontend/tests/portalEditorUtils.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.532 `frontend/tests/portalFaqVocabulary.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.533 `frontend/tests/portalLanguagePacks.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.534 `frontend/tests/portalTranslateController.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.535 `frontend/tests/posCore.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.536 `frontend/tests/pricingContacts.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/utils/pricing.ts`
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (1)
  - `frontend/src/utils/pricing.ts`
- Referenced by (0)
  - none

### 3.537 `frontend/tests/productBatches.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/productBatches.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/productBatches.ts`
- Referenced by (0)
  - none

### 3.538 `frontend/tests/productDiscountUx.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.539 `frontend/tests/productDisplayHelpers.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.540 `frontend/tests/productFilterHelpers.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/components/products/helpers/productExport.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/products/helpers/productExport.ts`
- Referenced by (0)
  - none

### 3.541 `frontend/tests/productGalleryHelpers.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.542 `frontend/tests/productGrouping.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/productGrouping.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/productGrouping.ts`
- Referenced by (0)
  - none

### 3.543 `frontend/tests/productGroupViewHelpers.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.544 `frontend/tests/productHistoryHelpers.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/components/products/history/productHistoryHelpers.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/products/history/productHistoryHelpers.ts`
- Referenced by (0)
  - none

### 3.545 `frontend/tests/productImportPlanner.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/components/products/import/productImportPlanner.ts`
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (1)
  - `frontend/src/components/products/import/productImportPlanner.ts`
- Referenced by (0)
  - none

### 3.546 `frontend/tests/productImportWorkerFallback.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/components/products/import/productImportPlanner.ts`
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (1)
  - `frontend/src/components/products/import/productImportPlanner.ts`
- Referenced by (0)
  - none

### 3.547 `frontend/tests/productMenuHelpers.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.548 `frontend/tests/productPageHelpers.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.549 `frontend/tests/productSearchPagination.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.550 `frontend/tests/productSelectionHelpers.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.551 `frontend/tests/productWriteHelpers.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.552 `frontend/tests/publicErrorRecovery.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.553 `frontend/tests/receiptSettingsSync.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.554 `frontend/tests/receiptTemplate.test.ts`

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

### 3.555 `frontend/tests/returnsLayout.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.556 `frontend/tests/runtimeErrorClassifier.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.557 `frontend/tests/salesImportWorker.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/utils/csvRowCounter.ts`
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (1)
  - `frontend/src/utils/csvRowCounter.ts`
- Referenced by (0)
  - none

### 3.558 `frontend/tests/scanbotScanner.test.ts`

- Declared exports: none detected
- Imports (3)
  - `../src/components/products/scanning/cameraPermission.ts`
  - `../src/components/products/scanning/scanbotScanner.ts`
  - `node:assert/strict`
- Internal dependencies (2)
  - `frontend/src/components/products/scanning/cameraPermission.ts`
  - `frontend/src/components/products/scanning/scanbotScanner.ts`
- Referenced by (0)
  - none

### 3.559 `frontend/tests/scriptTypography.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/utils/scriptTypography.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/utils/scriptTypography.ts`
- Referenced by (0)
  - none

### 3.560 `frontend/tests/sectionNavigation.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.561 `frontend/tests/settingsConflictHelpers.test.ts`

- Declared exports: none detected
- Imports (2)
  - `../src/components/utils-settings/settingsConflict.ts`
  - `node:assert/strict`
- Internal dependencies (1)
  - `frontend/src/components/utils-settings/settingsConflict.ts`
- Referenced by (0)
  - none

### 3.562 `frontend/tests/settingsRefresh.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.563 `frontend/tests/sourceSyntaxCheck.ts`

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

### 3.564 `frontend/tests/storagePolicy.test.ts`

- Declared exports: none detected
- Imports (1)
  - `node:assert/strict`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.565 `frontend/tests/utilsSettingsBarrel.test.ts`

- Declared exports: none detected
- Imports (2)
  - `node:assert/strict`
  - `node:fs`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.566 `frontend/vite.config.ts`

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

### 3.567 `ops/scripts/architecture/generated-bulk-audit.ts`

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

### 3.568 `ops/scripts/architecture/language-runtime-audit.ts`

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

### 3.569 `ops/scripts/architecture/organization-audit.ts`

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

### 3.570 `ops/scripts/architecture/phase29-audit.ts`

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

### 3.571 `ops/scripts/architecture/runtime-js-inventory.ts`

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

### 3.572 `ops/scripts/backend/build-package-stage.ts`

- Declared exports: none detected
- Imports (2)
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.573 `ops/scripts/backend/build-server-entry.ts`

- Declared exports: none detected
- Imports (4)
  - `fs`
  - `module`
  - `path`
  - `typescript`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.574 `ops/scripts/backend/schema-audit.ts`

- Declared exports: none detected
- Imports (2)
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.575 `ops/scripts/backend/schema-primary-key-preflight.ts`

- Declared exports: none detected
- Imports (3)
  - `node:child_process`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.576 `ops/scripts/backend/verify-data-integrity.ts`

- Declared exports: none detected
- Imports (3)
  - `child_process`
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.577 `ops/scripts/frontend/build-public-runtime-scripts.ts`

- Declared exports: none detected
- Imports (3)
  - `fs`
  - `module`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.578 `ops/scripts/frontend/verify-i18n.ts`

- Declared exports: none detected
- Imports (2)
  - `../lib/fs-utils.ts`
  - `path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.ts`
- Referenced by (0)
  - none

### 3.579 `ops/scripts/frontend/verify-performance.ts`

- Declared exports: none detected
- Imports (3)
  - `child_process`
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.580 `ops/scripts/frontend/verify-ui.ts`

- Declared exports: none detected
- Imports (3)
  - `../lib/fs-utils.ts`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.ts`
- Referenced by (0)
  - none

### 3.581 `ops/scripts/lib/fs-utils.ts`

- Declared exports: `module.exports`
- Imports (2)
  - `fs`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (14)
  - `ops/scripts/architecture/generated-bulk-audit.ts`
  - `ops/scripts/architecture/language-runtime-audit.ts`
  - `ops/scripts/architecture/organization-audit.ts`
  - `ops/scripts/architecture/phase29-audit.ts`
  - `ops/scripts/architecture/runtime-js-inventory.ts`
  - `ops/scripts/frontend/verify-i18n.ts`
  - `ops/scripts/frontend/verify-ui.ts`
  - `ops/scripts/runtime/cloudflare/verify-cloudflare-automation.ts`
  - `ops/scripts/verification/verify-backup-reliability.ts`
  - `ops/scripts/verification/verify-docker-release.ts`
  - `ops/scripts/verification/verify-hardening-policy.ts`
  - `ops/scripts/verification/verify-runtime-deps.ts`
  - `ops/scripts/verification/verify-scale-services.ts`
  - `ops/scripts/verification/verify-secret-hygiene.ts`

### 3.582 `ops/scripts/lib/report-utils.ts`

- Declared exports: `module.exports`
- Imports (1)
  - `crypto`
- Internal dependencies (0)
  - none
- Referenced by (6)
  - `ops/scripts/architecture/generated-bulk-audit.ts`
  - `ops/scripts/architecture/language-runtime-audit.ts`
  - `ops/scripts/architecture/organization-audit.ts`
  - `ops/scripts/architecture/phase29-audit.ts`
  - `ops/scripts/architecture/runtime-js-inventory.ts`
  - `ops/scripts/runtime/audits/audit-report-html.ts`

### 3.583 `ops/scripts/runtime/audits/action-history-undo-redo-check.ts`

- Declared exports: none detected
- Imports (5)
  - `./audit-auth.ts`
  - `node:child_process`
  - `node:fs`
  - `node:path`
  - `node:url`
- Internal dependencies (1)
  - `ops/scripts/runtime/audits/audit-auth.ts`
- Referenced by (0)
  - none

### 3.584 `ops/scripts/runtime/audits/audit-auth.ts`

- Declared exports: `applySessionToPlaywrightContext`, `buildBrowserStorageState`, `hydratePlaywrightPage`, `loginWithFetch`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (33)
  - `ops/scripts/runtime/audits/action-history-undo-redo-check.ts`
  - `ops/scripts/runtime/audits/deep-live-audit.ts`
  - `ops/scripts/runtime/audits/full-app-audit.ts`
  - `ops/scripts/runtime/browser-action-smoke.ts`
  - `ops/scripts/runtime/live-checks/all-pages-control-audit.ts`
  - `ops/scripts/runtime/live-checks/filter-burst-check.ts`
  - `ops/scripts/runtime/live-checks/move766-product-write-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-account-loyalty-select-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-branches-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-catalog-editor-select-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-contacts-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-files-providers-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-filter-menu-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-inventory-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-inventory-section-restore-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-loyalty-points-rollback-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-brands-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-categories-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-form-dropdown-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-page-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-scanning-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-stock-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-units-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-variant-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-receipt-export-layout-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-receipt-settings-rollback-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-sales-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-settings-save-rollback-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-settings-select-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-shared-select-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-ui-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-users-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/route-load-trace.ts`

### 3.585 `ops/scripts/runtime/audits/audit-manifest.ts`

- Declared exports: `ADMIN_ROUTES`, `FULL_AUDIT_ROUTES`, `PUBLIC_ROUTES`, `ROUTE_MANIFEST`, `getAuditProfiles`, `getRouteManifest`, `resolveAuditRoutes`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (5)
  - `ops/scripts/runtime/audits/deep-live-audit.ts`
  - `ops/scripts/runtime/audits/full-app-audit.ts`
  - `ops/scripts/runtime/browser-action-smoke.ts`
  - `ops/scripts/runtime/live-checks/all-pages-control-audit.ts`
  - `ops/scripts/runtime/live-checks/route-load-trace.ts`

### 3.586 `ops/scripts/runtime/audits/audit-report-html.ts`

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

### 3.587 `ops/scripts/runtime/audits/deep-live-audit.ts`

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

### 3.588 `ops/scripts/runtime/audits/full-app-audit.ts`

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

### 3.589 `ops/scripts/runtime/browser-action-smoke.ts`

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

### 3.590 `ops/scripts/runtime/build-ecosystem-config.ts`

- Declared exports: none detected
- Imports (3)
  - `fs`
  - `module`
  - `path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.591 `ops/scripts/runtime/cloudflare/rotate-cloudflare-tunnel-token.ts`

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

### 3.592 `ops/scripts/runtime/cloudflare/update-cloudflare-tunnel-origin.ts`

- Declared exports: none detected
- Imports (3)
  - `node:fs`
  - `node:https`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.593 `ops/scripts/runtime/cloudflare/verify-cloudflare-automation.ts`

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

### 3.594 `ops/scripts/runtime/cloudflare/verify-r2-object-store.ts`

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

### 3.595 `ops/scripts/runtime/cloudflare/warm-cloudflare-startup-assets.ts`

- Declared exports: none detected
- Imports (3)
  - `node:fs`
  - `node:path`
  - `node:perf_hooks`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.596 `ops/scripts/runtime/live-checks/all-pages-control-audit.ts`

- Declared exports: none detected
- Imports (7)
  - `../audits/audit-auth.ts`
  - `../audits/audit-manifest.ts`
  - `node:fs/promises`
  - `node:path`
  - `node:perf_hooks`
  - `node:url`
  - `playwright`
- Internal dependencies (2)
  - `ops/scripts/runtime/audits/audit-auth.ts`
  - `ops/scripts/runtime/audits/audit-manifest.ts`
- Referenced by (0)
  - none

### 3.597 `ops/scripts/runtime/live-checks/filter-burst-check.ts`

- Declared exports: none detected
- Imports (5)
  - `../audits/audit-auth.ts`
  - `node:fs/promises`
  - `node:path`
  - `node:url`
  - `playwright`
- Internal dependencies (1)
  - `ops/scripts/runtime/audits/audit-auth.ts`
- Referenced by (0)
  - none

### 3.598 `ops/scripts/runtime/live-checks/live-check-utils.ts`

- Declared exports: `attachConsoleCollector`, `closeTopModal`, `isIgnoredConsole`, `latestObservedStatus`, `readJson`, `readJsonStatus`, `waitForRead`
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (27)
  - `ops/scripts/runtime/live-checks/move766-product-write-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-account-loyalty-select-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-branches-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-catalog-editor-select-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-contacts-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-files-providers-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-filter-menu-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-inventory-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-inventory-section-restore-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-loyalty-points-rollback-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-brands-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-categories-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-form-dropdown-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-page-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-scanning-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-stock-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-units-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-product-variant-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-public-assistant-select-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-receipt-export-layout-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-receipt-settings-rollback-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-sales-actions-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-settings-save-rollback-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-settings-select-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-shared-select-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-ui-live-check.ts`
  - `ops/scripts/runtime/live-checks/phase84-users-actions-live-check.ts`

### 3.599 `ops/scripts/runtime/live-checks/move766-product-write-live-check.ts`

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

### 3.600 `ops/scripts/runtime/live-checks/phase84-account-loyalty-select-live-check.ts`

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

### 3.601 `ops/scripts/runtime/live-checks/phase84-branches-actions-live-check.ts`

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

### 3.602 `ops/scripts/runtime/live-checks/phase84-catalog-editor-select-live-check.ts`

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

### 3.603 `ops/scripts/runtime/live-checks/phase84-contacts-live-check.ts`

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

### 3.604 `ops/scripts/runtime/live-checks/phase84-files-providers-actions-live-check.ts`

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

### 3.605 `ops/scripts/runtime/live-checks/phase84-filter-menu-live-check.ts`

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

### 3.606 `ops/scripts/runtime/live-checks/phase84-inventory-actions-live-check.ts`

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

### 3.607 `ops/scripts/runtime/live-checks/phase84-inventory-section-restore-live-check.ts`

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

### 3.608 `ops/scripts/runtime/live-checks/phase84-live-suite.ts`

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

### 3.609 `ops/scripts/runtime/live-checks/phase84-loyalty-points-rollback-check.ts`

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

### 3.610 `ops/scripts/runtime/live-checks/phase84-product-brands-actions-live-check.ts`

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

### 3.611 `ops/scripts/runtime/live-checks/phase84-product-categories-actions-live-check.ts`

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

### 3.612 `ops/scripts/runtime/live-checks/phase84-product-form-dropdown-live-check.ts`

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

### 3.613 `ops/scripts/runtime/live-checks/phase84-product-page-actions-live-check.ts`

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

### 3.614 `ops/scripts/runtime/live-checks/phase84-product-scanning-actions-live-check.ts`

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

### 3.615 `ops/scripts/runtime/live-checks/phase84-product-stock-actions-live-check.ts`

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

### 3.616 `ops/scripts/runtime/live-checks/phase84-product-units-actions-live-check.ts`

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

### 3.617 `ops/scripts/runtime/live-checks/phase84-product-variant-actions-live-check.ts`

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

### 3.618 `ops/scripts/runtime/live-checks/phase84-public-assistant-select-live-check.ts`

- Declared exports: none detected
- Imports (5)
  - `./live-check-utils.ts`
  - `node:fs/promises`
  - `node:path`
  - `node:url`
  - `playwright`
- Internal dependencies (1)
  - `ops/scripts/runtime/live-checks/live-check-utils.ts`
- Referenced by (0)
  - none

### 3.619 `ops/scripts/runtime/live-checks/phase84-public-portal-cloudflare-check.ts`

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

### 3.620 `ops/scripts/runtime/live-checks/phase84-receipt-export-layout-check.ts`

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

### 3.621 `ops/scripts/runtime/live-checks/phase84-receipt-settings-rollback-check.ts`

- Declared exports: none detected
- Imports (7)
  - `../../../../frontend/src/components/receipt-settings/template.ts`
  - `../audits/audit-auth.ts`
  - `./live-check-utils.ts`
  - `node:fs/promises`
  - `node:path`
  - `node:url`
  - `playwright`
- Internal dependencies (3)
  - `frontend/src/components/receipt-settings/template.ts`
  - `ops/scripts/runtime/audits/audit-auth.ts`
  - `ops/scripts/runtime/live-checks/live-check-utils.ts`
- Referenced by (0)
  - none

### 3.622 `ops/scripts/runtime/live-checks/phase84-sales-actions-live-check.ts`

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

### 3.623 `ops/scripts/runtime/live-checks/phase84-settings-save-rollback-check.ts`

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

### 3.624 `ops/scripts/runtime/live-checks/phase84-settings-select-live-check.ts`

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

### 3.625 `ops/scripts/runtime/live-checks/phase84-shared-select-live-check.ts`

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

### 3.626 `ops/scripts/runtime/live-checks/phase84-ui-live-check.ts`

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

### 3.627 `ops/scripts/runtime/live-checks/phase84-users-actions-live-check.ts`

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

### 3.628 `ops/scripts/runtime/live-checks/route-load-trace.ts`

- Declared exports: none detected
- Imports (7)
  - `../audits/audit-auth.ts`
  - `../audits/audit-manifest.ts`
  - `node:fs/promises`
  - `node:path`
  - `node:perf_hooks`
  - `node:url`
  - `playwright`
- Internal dependencies (2)
  - `ops/scripts/runtime/audits/audit-auth.ts`
  - `ops/scripts/runtime/audits/audit-manifest.ts`
- Referenced by (0)
  - none

### 3.629 `ops/scripts/runtime/smoke/check-public-url.ts`

- Declared exports: none detected
- Imports (2)
  - `node:https`
  - `node:net`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.630 `ops/scripts/runtime/smoke/check-route-contract.ts`

- Declared exports: none detected
- Imports (0)
  - none
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.631 `ops/scripts/runtime/smoke/live-smoke.ts`

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

### 3.632 `ops/scripts/runtime/smoke/post-start-diagnostics.ts`

- Declared exports: none detected
- Imports (2)
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.633 `ops/scripts/runtime/storage/cleanup-integrity-backlog.ts`

- Declared exports: none detected
- Imports (3)
  - `node:child_process`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.634 `ops/scripts/runtime/storage/cleanup-test-data.ts`

- Declared exports: none detected
- Imports (3)
  - `node:child_process`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.635 `ops/scripts/runtime/storage/dataset-readiness.ts`

- Declared exports: none detected
- Imports (3)
  - `node:child_process`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.636 `ops/scripts/runtime/storage/post-live-hygiene.ts`

- Declared exports: none detected
- Imports (3)
  - `node:child_process`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.637 `ops/scripts/runtime/storage/prune-storage.ts`

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

### 3.638 `ops/scripts/runtime/storage/restore-candidates.ts`

- Declared exports: none detected
- Imports (2)
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.639 `ops/scripts/runtime/storage/restore-rehearsal.ts`

- Declared exports: none detected
- Imports (3)
  - `node:child_process`
  - `node:fs`
  - `node:path`
- Internal dependencies (0)
  - none
- Referenced by (0)
  - none

### 3.640 `ops/scripts/verification/verify-backup-reliability.ts`

- Declared exports: none detected
- Imports (3)
  - `../lib/fs-utils.ts`
  - `node:fs`
  - `node:path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.ts`
- Referenced by (0)
  - none

### 3.641 `ops/scripts/verification/verify-docker-release.ts`

- Declared exports: none detected
- Imports (3)
  - `../lib/fs-utils.ts`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.ts`
- Referenced by (0)
  - none

### 3.642 `ops/scripts/verification/verify-hardening-policy.ts`

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

### 3.643 `ops/scripts/verification/verify-runtime-deps.ts`

- Declared exports: none detected
- Imports (3)
  - `../lib/fs-utils.ts`
  - `fs`
  - `path`
- Internal dependencies (1)
  - `ops/scripts/lib/fs-utils.ts`
- Referenced by (0)
  - none

### 3.644 `ops/scripts/verification/verify-scale-services.ts`

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

### 3.645 `ops/scripts/verification/verify-secret-hygiene.ts`

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

