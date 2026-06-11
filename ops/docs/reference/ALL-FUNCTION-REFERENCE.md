# All Function Reference (Project First-Party Code)

Auto-generated function/class symbol commentary for all first-party code files (frontend, backend, root scripts/config code).

## 1. Coverage Summary

Code files scanned: **662**

## 2. Symbol Count by File

| No. | File | Symbols |
|---:|---|---:|
| 1 | `backend/.pkg-stage/server.js` | 24 |
| 2 | `backend/.pkg-stage/src/accessControl.js` | 18 |
| 3 | `backend/.pkg-stage/src/analytics/duckdbRuntime.js` | 3 |
| 4 | `backend/.pkg-stage/src/authOtpGuards.js` | 3 |
| 5 | `backend/.pkg-stage/src/backupSchema.js` | 4 |
| 6 | `backend/.pkg-stage/src/businessMetrics.js` | 9 |
| 7 | `backend/.pkg-stage/src/catalogTextIntegrity.js` | 5 |
| 8 | `backend/.pkg-stage/src/config/index.js` | 11 |
| 9 | `backend/.pkg-stage/src/conflictControl.js` | 6 |
| 10 | `backend/.pkg-stage/src/contactOptions.js` | 10 |
| 11 | `backend/.pkg-stage/src/database.js` | 0 |
| 12 | `backend/.pkg-stage/src/dataPath/index.js` | 11 |
| 13 | `backend/.pkg-stage/src/db/cutoverReadiness.js` | 10 |
| 14 | `backend/.pkg-stage/src/db/postgresQueryCompat.js` | 12 |
| 15 | `backend/.pkg-stage/src/fileAssets.js` | 61 |
| 16 | `backend/.pkg-stage/src/helpers.js` | 30 |
| 17 | `backend/.pkg-stage/src/idempotency.js` | 1 |
| 18 | `backend/.pkg-stage/src/importCsv.js` | 16 |
| 19 | `backend/.pkg-stage/src/importParsing.js` | 6 |
| 20 | `backend/.pkg-stage/src/initials.js` | 7 |
| 21 | `backend/.pkg-stage/src/maintenanceLock.js` | 9 |
| 22 | `backend/.pkg-stage/src/middleware.js` | 21 |
| 23 | `backend/.pkg-stage/src/money.js` | 3 |
| 24 | `backend/.pkg-stage/src/netSecurity.js` | 7 |
| 25 | `backend/.pkg-stage/src/objectStore.js` | 29 |
| 26 | `backend/.pkg-stage/src/optionalSharp.js` | 1 |
| 27 | `backend/.pkg-stage/src/organizationContext/index.js` | 14 |
| 28 | `backend/.pkg-stage/src/permissions.js` | 7 |
| 29 | `backend/.pkg-stage/src/portalUtils.js` | 6 |
| 30 | `backend/.pkg-stage/src/postgresDatabase.js` | 14 |
| 31 | `backend/.pkg-stage/src/productBatches.js` | 34 |
| 32 | `backend/.pkg-stage/src/productDiscounts.js` | 9 |
| 33 | `backend/.pkg-stage/src/productImportPolicies.js` | 10 |
| 34 | `backend/.pkg-stage/src/requestContext.js` | 5 |
| 35 | `backend/.pkg-stage/src/routes/actionHistory.js` | 12 |
| 36 | `backend/.pkg-stage/src/routes/ai.js` | 3 |
| 37 | `backend/.pkg-stage/src/routes/auth.js` | 31 |
| 38 | `backend/.pkg-stage/src/routes/branches.js` | 10 |
| 39 | `backend/.pkg-stage/src/routes/catalog.js` | 4 |
| 40 | `backend/.pkg-stage/src/routes/categories.js` | 2 |
| 41 | `backend/.pkg-stage/src/routes/contacts.js` | 34 |
| 42 | `backend/.pkg-stage/src/routes/customTables.js` | 9 |
| 43 | `backend/.pkg-stage/src/routes/files.js` | 3 |
| 44 | `backend/.pkg-stage/src/routes/importJobs.js` | 16 |
| 45 | `backend/.pkg-stage/src/routes/inventory.js` | 32 |
| 46 | `backend/.pkg-stage/src/routes/notifications.js` | 27 |
| 47 | `backend/.pkg-stage/src/routes/organizations.js` | 0 |
| 48 | `backend/.pkg-stage/src/routes/portal.js` | 60 |
| 49 | `backend/.pkg-stage/src/routes/products.js` | 64 |
| 50 | `backend/.pkg-stage/src/routes/returns.js` | 10 |
| 51 | `backend/.pkg-stage/src/routes/runtime.js` | 6 |
| 52 | `backend/.pkg-stage/src/routes/sales.js` | 26 |
| 53 | `backend/.pkg-stage/src/routes/settings.js` | 10 |
| 54 | `backend/.pkg-stage/src/routes/sync.js` | 12 |
| 55 | `backend/.pkg-stage/src/routes/system/index.js` | 44 |
| 56 | `backend/.pkg-stage/src/routes/units.js` | 3 |
| 57 | `backend/.pkg-stage/src/routes/users.js` | 26 |
| 58 | `backend/.pkg-stage/src/runtimeCache.js` | 12 |
| 59 | `backend/.pkg-stage/src/runtimeState/index.js` | 6 |
| 60 | `backend/.pkg-stage/src/runtimeVersion.js` | 8 |
| 61 | `backend/.pkg-stage/src/schemaMetadata.js` | 9 |
| 62 | `backend/.pkg-stage/src/security.js` | 14 |
| 63 | `backend/.pkg-stage/src/serverUtils.js` | 26 |
| 64 | `backend/.pkg-stage/src/services/aiGateway.js` | 17 |
| 65 | `backend/.pkg-stage/src/services/backupPackages.js` | 59 |
| 66 | `backend/.pkg-stage/src/services/firebaseAuth.js` | 22 |
| 67 | `backend/.pkg-stage/src/services/googleDriveSync/index.js` | 75 |
| 68 | `backend/.pkg-stage/src/services/googleDriveSync/versioning.js` | 7 |
| 69 | `backend/.pkg-stage/src/services/googleOauth.js` | 17 |
| 70 | `backend/.pkg-stage/src/services/importJobs.js` | 175 |
| 71 | `backend/.pkg-stage/src/services/integrationDoctor.js` | 14 |
| 72 | `backend/.pkg-stage/src/services/mediaQueue.js` | 10 |
| 73 | `backend/.pkg-stage/src/services/portalAi.js` | 42 |
| 74 | `backend/.pkg-stage/src/services/verification.js` | 21 |
| 75 | `backend/.pkg-stage/src/sessionAuth.js` | 13 |
| 76 | `backend/.pkg-stage/src/settingsSnapshot.js` | 12 |
| 77 | `backend/.pkg-stage/src/storage/organizationFolders.js` | 5 |
| 78 | `backend/.pkg-stage/src/systemFsWorker.js` | 7 |
| 79 | `backend/.pkg-stage/src/systemJobs.js` | 28 |
| 80 | `backend/.pkg-stage/src/uploadReferenceCleanup.js` | 3 |
| 81 | `backend/.pkg-stage/src/uploadSecurity.js` | 7 |
| 82 | `backend/.pkg-stage/src/websocket.js` | 1 |
| 83 | `backend/.pkg-stage/src/workers/importWorker.js` | 2 |
| 84 | `backend/.pkg-stage/src/workers/mediaWorker.js` | 2 |
| 85 | `backend/server.js` | 42 |
| 86 | `backend/server.ts` | 42 |
| 87 | `backend/src/accessControl.ts` | 18 |
| 88 | `backend/src/analytics/duckdbRuntime.ts` | 3 |
| 89 | `backend/src/authOtpGuards.ts` | 3 |
| 90 | `backend/src/backupSchema.ts` | 4 |
| 91 | `backend/src/businessMetrics.ts` | 9 |
| 92 | `backend/src/catalogTextIntegrity.ts` | 5 |
| 93 | `backend/src/config/index.ts` | 11 |
| 94 | `backend/src/conflictControl.ts` | 6 |
| 95 | `backend/src/contactOptions.ts` | 10 |
| 96 | `backend/src/database.ts` | 0 |
| 97 | `backend/src/dataPath/index.ts` | 11 |
| 98 | `backend/src/db/cutoverReadiness.ts` | 10 |
| 99 | `backend/src/db/postgresQueryCompat.ts` | 12 |
| 100 | `backend/src/fileAssets.ts` | 67 |
| 101 | `backend/src/helpers.ts` | 30 |
| 102 | `backend/src/idempotency.ts` | 1 |
| 103 | `backend/src/importCsv.ts` | 16 |
| 104 | `backend/src/importParsing.ts` | 6 |
| 105 | `backend/src/initials.ts` | 7 |
| 106 | `backend/src/maintenanceLock.ts` | 9 |
| 107 | `backend/src/middleware.ts` | 21 |
| 108 | `backend/src/money.ts` | 3 |
| 109 | `backend/src/netSecurity.ts` | 7 |
| 110 | `backend/src/objectStore.ts` | 29 |
| 111 | `backend/src/optionalSharp.ts` | 1 |
| 112 | `backend/src/organizationContext/index.ts` | 14 |
| 113 | `backend/src/permissions.ts` | 7 |
| 114 | `backend/src/portalUtils.ts` | 6 |
| 115 | `backend/src/postgresDatabase.ts` | 14 |
| 116 | `backend/src/productBatches.ts` | 34 |
| 117 | `backend/src/productDiscounts.ts` | 9 |
| 118 | `backend/src/productImportPolicies.ts` | 10 |
| 119 | `backend/src/requestContext.ts` | 5 |
| 120 | `backend/src/routes/actionHistory.ts` | 12 |
| 121 | `backend/src/routes/ai.ts` | 3 |
| 122 | `backend/src/routes/auth.ts` | 33 |
| 123 | `backend/src/routes/branches.ts` | 10 |
| 124 | `backend/src/routes/catalog.ts` | 4 |
| 125 | `backend/src/routes/categories.ts` | 2 |
| 126 | `backend/src/routes/contacts.ts` | 34 |
| 127 | `backend/src/routes/customTables.ts` | 9 |
| 128 | `backend/src/routes/files.ts` | 3 |
| 129 | `backend/src/routes/importJobs.ts` | 16 |
| 130 | `backend/src/routes/inventory.ts` | 40 |
| 131 | `backend/src/routes/notifications.ts` | 27 |
| 132 | `backend/src/routes/organizations.ts` | 0 |
| 133 | `backend/src/routes/portal.ts` | 64 |
| 134 | `backend/src/routes/products.ts` | 75 |
| 135 | `backend/src/routes/returns.ts` | 16 |
| 136 | `backend/src/routes/runtime.ts` | 6 |
| 137 | `backend/src/routes/sales.ts` | 26 |
| 138 | `backend/src/routes/settings.ts` | 10 |
| 139 | `backend/src/routes/sync.ts` | 12 |
| 140 | `backend/src/routes/system/index.ts` | 46 |
| 141 | `backend/src/routes/units.ts` | 3 |
| 142 | `backend/src/routes/users.ts` | 26 |
| 143 | `backend/src/runtimeCache.ts` | 12 |
| 144 | `backend/src/runtimeState/index.ts` | 7 |
| 145 | `backend/src/runtimeVersion.ts` | 8 |
| 146 | `backend/src/schemaMetadata.ts` | 9 |
| 147 | `backend/src/security.ts` | 14 |
| 148 | `backend/src/serverUtils.ts` | 28 |
| 149 | `backend/src/services/aiGateway.ts` | 17 |
| 150 | `backend/src/services/backupPackages.ts` | 59 |
| 151 | `backend/src/services/firebaseAuth.ts` | 22 |
| 152 | `backend/src/services/googleDriveSync/index.ts` | 75 |
| 153 | `backend/src/services/googleDriveSync/versioning.ts` | 7 |
| 154 | `backend/src/services/googleOauth.ts` | 17 |
| 155 | `backend/src/services/importJobs.ts` | 175 |
| 156 | `backend/src/services/integrationDoctor.ts` | 14 |
| 157 | `backend/src/services/mediaQueue.ts` | 10 |
| 158 | `backend/src/services/portalAi.ts` | 42 |
| 159 | `backend/src/services/verification.ts` | 21 |
| 160 | `backend/src/sessionAuth.ts` | 15 |
| 161 | `backend/src/settingsSnapshot.ts` | 12 |
| 162 | `backend/src/storage/organizationFolders.ts` | 5 |
| 163 | `backend/src/systemFsWorker.ts` | 7 |
| 164 | `backend/src/systemJobs.ts` | 28 |
| 165 | `backend/src/uploadReferenceCleanup.ts` | 3 |
| 166 | `backend/src/uploadSecurity.ts` | 7 |
| 167 | `backend/src/websocket.ts` | 1 |
| 168 | `backend/src/workers/importWorker.ts` | 2 |
| 169 | `backend/src/workers/mediaWorker.ts` | 2 |
| 170 | `backend/test/accessControl.test.ts` | 2 |
| 171 | `backend/test/analyticsRuntime.test.ts` | 1 |
| 172 | `backend/test/authOtpGuards.test.ts` | 1 |
| 173 | `backend/test/authSecurityFlow.test.ts` | 14 |
| 174 | `backend/test/backupDefaultDestination.test.ts` | 0 |
| 175 | `backend/test/backupPerformanceHardening.test.ts` | 1 |
| 176 | `backend/test/backupRetention.test.ts` | 1 |
| 177 | `backend/test/backupSchema.test.ts` | 1 |
| 178 | `backend/test/branchStockSearch.test.ts` | 10 |
| 179 | `backend/test/contactOptions.test.ts` | 1 |
| 180 | `backend/test/dataPath.test.ts` | 2 |
| 181 | `backend/test/defaultRoles.test.ts` | 8 |
| 182 | `backend/test/fileAssetStorageReconcile.test.ts` | 1 |
| 183 | `backend/test/fileAssetUsageCache.test.ts` | 1 |
| 184 | `backend/test/fileRouteSecurityFlow.test.ts` | 9 |
| 185 | `backend/test/fullAutomation.test.ts` | 2 |
| 186 | `backend/test/googleDriveSyncVersioning.test.ts` | 1 |
| 187 | `backend/test/idempotency.test.ts` | 1 |
| 188 | `backend/test/importCsv.test.ts` | 2 |
| 189 | `backend/test/importDecisionIntegrity.test.ts` | 0 |
| 190 | `backend/test/importJobPerformanceHardening.test.ts` | 1 |
| 191 | `backend/test/importJobStateMachine.test.ts` | 4 |
| 192 | `backend/test/importScaleSmoke.test.ts` | 3 |
| 193 | `backend/test/initials.test.ts` | 0 |
| 194 | `backend/test/integrationDoctor.test.ts` | 1 |
| 195 | `backend/test/inventorySettingsMediaContracts.test.ts` | 2 |
| 196 | `backend/test/mediaOptimization.test.ts` | 3 |
| 197 | `backend/test/netSecurity.test.ts` | 1 |
| 198 | `backend/test/notificationSummaryCache.test.ts` | 1 |
| 199 | `backend/test/offlineSecurity.test.ts` | 2 |
| 200 | `backend/test/ownedGoogleAuth.test.ts` | 2 |
| 201 | `backend/test/permissionPolicy.test.ts` | 0 |
| 202 | `backend/test/portalInventoryRegression.test.ts` | 2 |
| 203 | `backend/test/portalUtils.test.ts` | 1 |
| 204 | `backend/test/postgresCutoverReadiness.test.ts` | 1 |
| 205 | `backend/test/postgresDatabase.test.ts` | 3 |
| 206 | `backend/test/postgresQueryCompat.test.ts` | 1 |
| 207 | `backend/test/productBatchHierarchy.test.ts` | 2 |
| 208 | `backend/test/productExpiry.test.ts` | 1 |
| 209 | `backend/test/productImportPolicies.test.ts` | 1 |
| 210 | `backend/test/productSearchPagination.test.ts` | 0 |
| 211 | `backend/test/returnsListCache.test.ts` | 1 |
| 212 | `backend/test/rfidRoutes.test.ts` | 1 |
| 213 | `backend/test/routeContracts.test.ts` | 2 |
| 214 | `backend/test/runtimeCache.test.ts` | 2 |
| 215 | `backend/test/runtimeVersion.test.ts` | 1 |
| 216 | `backend/test/schemaMetadata.test.ts` | 3 |
| 217 | `backend/test/security.test.ts` | 1 |
| 218 | `backend/test/serverUtils.test.ts` | 3 |
| 219 | `backend/test/settingsSnapshotObjectStorage.test.ts` | 4 |
| 220 | `backend/test/systemJobs.test.ts` | 3 |
| 221 | `backend/test/uploadSecurity.test.ts` | 1 |
| 222 | `backend/test/websocket.test.ts` | 0 |
| 223 | `frontend/public/runtime-noise-guard.js` | 8 |
| 224 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.js` | 0 |
| 225 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.worker.js` | 0 |
| 226 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd-threads.js` | 0 |
| 227 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd.js` | 0 |
| 228 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core.js` | 0 |
| 229 | `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js` | 0 |
| 230 | `frontend/public/sw.js` | 26 |
| 231 | `frontend/public/theme-bootstrap.js` | 15 |
| 232 | `frontend/src/AdminRoot.tsx` | 1 |
| 233 | `frontend/src/api/actionHistoryTransport.ts` | 7 |
| 234 | `frontend/src/api/actorQuery.ts` | 2 |
| 235 | `frontend/src/api/aiTransport.ts` | 6 |
| 236 | `frontend/src/api/appBootstrapTransport.ts` | 8 |
| 237 | `frontend/src/api/auditLogTransport.ts` | 6 |
| 238 | `frontend/src/api/authTransport.ts` | 18 |
| 239 | `frontend/src/api/branchTransport.ts` | 12 |
| 240 | `frontend/src/api/browserDialogs.ts` | 3 |
| 241 | `frontend/src/api/conflicts.ts` | 2 |
| 242 | `frontend/src/api/contactReadTransport.ts` | 12 |
| 243 | `frontend/src/api/contactsTransport.ts` | 30 |
| 244 | `frontend/src/api/contactWriteTransport.ts` | 15 |
| 245 | `frontend/src/api/cooldownFallbacks.ts` | 11 |
| 246 | `frontend/src/api/customTablesTransport.ts` | 9 |
| 247 | `frontend/src/api/dashboardTransport.ts` | 3 |
| 248 | `frontend/src/api/driveSync.ts` | 7 |
| 249 | `frontend/src/api/expectedUpdatedAt.ts` | 4 |
| 250 | `frontend/src/api/fileTransport.ts` | 9 |
| 251 | `frontend/src/api/http.ts` | 64 |
| 252 | `frontend/src/api/httpState.ts` | 4 |
| 253 | `frontend/src/api/importJobsTransport.ts` | 21 |
| 254 | `frontend/src/api/importTransport.ts` | 1 |
| 255 | `frontend/src/api/inventoryTransport.ts` | 9 |
| 256 | `frontend/src/api/inventoryWriteTransport.ts` | 5 |
| 257 | `frontend/src/api/lazyLocalDb.ts` | 2 |
| 258 | `frontend/src/api/localDb.ts` | 10 |
| 259 | `frontend/src/api/localMirrors.ts` | 6 |
| 260 | `frontend/src/api/lookupTransport.ts` | 12 |
| 261 | `frontend/src/api/methods.ts` | 201 |
| 262 | `frontend/src/api/multipartHeaders.ts` | 1 |
| 263 | `frontend/src/api/notificationSummary.ts` | 2 |
| 264 | `frontend/src/api/offlineSnapshotTransport.ts` | 8 |
| 265 | `frontend/src/api/pendingSyncTransport.ts` | 3 |
| 266 | `frontend/src/api/portalHttp.ts` | 2 |
| 267 | `frontend/src/api/portalPublicTransport.ts` | 18 |
| 268 | `frontend/src/api/portalTransport.ts` | 15 |
| 269 | `frontend/src/api/productImageUploadTransport.ts` | 2 |
| 270 | `frontend/src/api/productReadTransport.ts` | 11 |
| 271 | `frontend/src/api/productWriteTransport.ts` | 8 |
| 272 | `frontend/src/api/query.ts` | 4 |
| 273 | `frontend/src/api/queryCache.ts` | 2 |
| 274 | `frontend/src/api/requestIds.ts` | 1 |
| 275 | `frontend/src/api/returnsReadTransport.ts` | 3 |
| 276 | `frontend/src/api/returnsTransport.ts` | 8 |
| 277 | `frontend/src/api/rfidTransport.ts` | 9 |
| 278 | `frontend/src/api/salesTransport.ts` | 10 |
| 279 | `frontend/src/api/saleWriteTransport.ts` | 18 |
| 280 | `frontend/src/api/settingsTransport.ts` | 8 |
| 281 | `frontend/src/api/syncPreview.ts` | 1 |
| 282 | `frontend/src/api/syncRuntime.ts` | 4 |
| 283 | `frontend/src/api/systemJobs.ts` | 10 |
| 284 | `frontend/src/api/systemRuntime.ts` | 16 |
| 285 | `frontend/src/api/userAdminTransport.ts` | 14 |
| 286 | `frontend/src/api/userReadTransport.ts` | 1 |
| 287 | `frontend/src/api/websocket.ts` | 15 |
| 288 | `frontend/src/App.tsx` | 89 |
| 289 | `frontend/src/app/AppContextCore.tsx` | 2 |
| 290 | `frontend/src/app/appShellUtils.ts` | 5 |
| 291 | `frontend/src/app/pathRouting.ts` | 5 |
| 292 | `frontend/src/app/PublicCatalogAppProvider.tsx` | 1 |
| 293 | `frontend/src/app/publicErrorRecovery.ts` | 4 |
| 294 | `frontend/src/AppContext.tsx` | 44 |
| 295 | `frontend/src/components/auth/Login.tsx` | 23 |
| 296 | `frontend/src/components/branches/Branches.tsx` | 15 |
| 297 | `frontend/src/components/branches/BranchForm.tsx` | 2 |
| 298 | `frontend/src/components/branches/TransferModal.tsx` | 6 |
| 299 | `frontend/src/components/catalog/catalogAssetUrls.ts` | 8 |
| 300 | `frontend/src/components/catalog/CatalogEditorSurface.tsx` | 3 |
| 301 | `frontend/src/components/catalog/CatalogImageField.tsx` | 1 |
| 302 | `frontend/src/components/catalog/catalogImages.tsx` | 5 |
| 303 | `frontend/src/components/catalog/CatalogPage.tsx` | 127 |
| 304 | `frontend/src/components/catalog/CatalogPageContext.tsx` | 1 |
| 305 | `frontend/src/components/catalog/catalogPagination.tsx` | 5 |
| 306 | `frontend/src/components/catalog/CatalogPreviewSurface.tsx` | 2 |
| 307 | `frontend/src/components/catalog/CatalogProductsSection.tsx` | 4 |
| 308 | `frontend/src/components/catalog/CatalogSecondaryTabs.tsx` | 7 |
| 309 | `frontend/src/components/catalog/catalogUi.tsx` | 4 |
| 310 | `frontend/src/components/catalog/portalCatalogDisplay.ts` | 14 |
| 311 | `frontend/src/components/catalog/portalContentI18n.ts` | 18 |
| 312 | `frontend/src/components/catalog/portalEditorUtils.ts` | 10 |
| 313 | `frontend/src/components/catalog/portalLanguageOptions.ts` | 2 |
| 314 | `frontend/src/components/catalog/portalLanguagePacks.ts` | 3 |
| 315 | `frontend/src/components/catalog/portalTranslateController.ts` | 20 |
| 316 | `frontend/src/components/catalog/portalTranslationData.ts` | 3 |
| 317 | `frontend/src/components/catalog/PublicCatalogPage.tsx` | 41 |
| 318 | `frontend/src/components/contacts/ContactImportModal.tsx` | 8 |
| 319 | `frontend/src/components/contacts/contactImportWorker.ts` | 1 |
| 320 | `frontend/src/components/contacts/contactOptionUtils.ts` | 10 |
| 321 | `frontend/src/components/contacts/Contacts.tsx` | 13 |
| 322 | `frontend/src/components/contacts/CustomerFormModal.tsx` | 10 |
| 323 | `frontend/src/components/contacts/customerMembershipNumber.ts` | 1 |
| 324 | `frontend/src/components/contacts/CustomersTab.tsx` | 21 |
| 325 | `frontend/src/components/contacts/DeliveryTab.tsx` | 30 |
| 326 | `frontend/src/components/contacts/shared.tsx` | 6 |
| 327 | `frontend/src/components/contacts/SuppliersTab.tsx` | 23 |
| 328 | `frontend/src/components/custom-tables/CustomTables.tsx` | 25 |
| 329 | `frontend/src/components/dashboard/charts/BarChart.tsx` | 5 |
| 330 | `frontend/src/components/dashboard/charts/DonutChart.tsx` | 1 |
| 331 | `frontend/src/components/dashboard/charts/index.ts` | 0 |
| 332 | `frontend/src/components/dashboard/charts/LineChart.tsx` | 7 |
| 333 | `frontend/src/components/dashboard/charts/NoData.tsx` | 1 |
| 334 | `frontend/src/components/dashboard/Dashboard.tsx` | 17 |
| 335 | `frontend/src/components/dashboard/dashboardExport.ts` | 25 |
| 336 | `frontend/src/components/dashboard/MiniStat.tsx` | 1 |
| 337 | `frontend/src/components/files/FilePickerModal.tsx` | 9 |
| 338 | `frontend/src/components/files/FilesPage.tsx` | 27 |
| 339 | `frontend/src/components/files/FilesProvidersTab.tsx` | 4 |
| 340 | `frontend/src/components/files/FilesResponsesTab.tsx` | 1 |
| 341 | `frontend/src/components/inventory/DualMoney.tsx` | 1 |
| 342 | `frontend/src/components/inventory/Inventory.tsx` | 32 |
| 343 | `frontend/src/components/inventory/InventoryBatchModal.tsx` | 3 |
| 344 | `frontend/src/components/inventory/inventoryExport.ts` | 18 |
| 345 | `frontend/src/components/inventory/InventoryImportModal.tsx` | 9 |
| 346 | `frontend/src/components/inventory/inventoryImportWorker.ts` | 1 |
| 347 | `frontend/src/components/inventory/InventoryMovementsSurface.tsx` | 1 |
| 348 | `frontend/src/components/inventory/InventoryProductsSurface.tsx` | 3 |
| 349 | `frontend/src/components/inventory/InventoryReasonManagerModal.tsx` | 2 |
| 350 | `frontend/src/components/inventory/InventoryRfidSurface.tsx` | 1 |
| 351 | `frontend/src/components/inventory/InventoryStatDetailModal.tsx` | 1 |
| 352 | `frontend/src/components/inventory/InventoryStockModals.tsx` | 1 |
| 353 | `frontend/src/components/inventory/movementGroups.ts` | 15 |
| 354 | `frontend/src/components/inventory/ProductDetailModal.tsx` | 2 |
| 355 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx` | 11 |
| 356 | `frontend/src/components/navigation/Sidebar.tsx` | 9 |
| 357 | `frontend/src/components/pos/CartItem.tsx` | 2 |
| 358 | `frontend/src/components/pos/FilterPanel.tsx` | 5 |
| 359 | `frontend/src/components/pos/POS.tsx` | 52 |
| 360 | `frontend/src/components/pos/posCore.ts` | 10 |
| 361 | `frontend/src/components/pos/POSQuickAddModals.tsx` | 1 |
| 362 | `frontend/src/components/pos/ProductDetailSheet.tsx` | 2 |
| 363 | `frontend/src/components/pos/ProductImage.tsx` | 5 |
| 364 | `frontend/src/components/pos/QuickAddModal.tsx` | 2 |
| 365 | `frontend/src/components/products/config/productPageConfig.ts` | 0 |
| 366 | `frontend/src/components/products/forms/BranchStockAdjuster.tsx` | 6 |
| 367 | `frontend/src/components/products/forms/BulkAddStockModal.tsx` | 6 |
| 368 | `frontend/src/components/products/forms/ProductForm.tsx` | 19 |
| 369 | `frontend/src/components/products/forms/VariantFormModal.tsx` | 3 |
| 370 | `frontend/src/components/products/helpers/productDisplayHelpers.ts` | 6 |
| 371 | `frontend/src/components/products/helpers/productExport.ts` | 6 |
| 372 | `frontend/src/components/products/helpers/productFilterHelpers.ts` | 4 |
| 373 | `frontend/src/components/products/helpers/productGalleryHelpers.ts` | 8 |
| 374 | `frontend/src/components/products/helpers/productGroupViewHelpers.ts` | 2 |
| 375 | `frontend/src/components/products/helpers/productMenuHelpers.ts` | 6 |
| 376 | `frontend/src/components/products/helpers/productPageHelpers.ts` | 2 |
| 377 | `frontend/src/components/products/helpers/productSelectionHelpers.ts` | 7 |
| 378 | `frontend/src/components/products/helpers/productSupplierOptions.ts` | 1 |
| 379 | `frontend/src/components/products/helpers/productWriteHelpers.ts` | 18 |
| 380 | `frontend/src/components/products/history/productHistoryHelpers.ts` | 1 |
| 381 | `frontend/src/components/products/import/BulkImportModal.tsx` | 51 |
| 382 | `frontend/src/components/products/import/productImportPlanner.ts` | 18 |
| 383 | `frontend/src/components/products/import/productImportWorker.ts` | 3 |
| 384 | `frontend/src/components/products/lookups/ManageBrandsModal.tsx` | 10 |
| 385 | `frontend/src/components/products/lookups/ManageCategoriesModal.tsx` | 5 |
| 386 | `frontend/src/components/products/lookups/ManageUnitsModal.tsx` | 5 |
| 387 | `frontend/src/components/products/lookups/productLookupSnapshots.ts` | 10 |
| 388 | `frontend/src/components/products/Products.tsx` | 31 |
| 389 | `frontend/src/components/products/scanning/barcodeImageScanner.ts` | 5 |
| 390 | `frontend/src/components/products/scanning/BarcodeScannerModal.tsx` | 4 |
| 391 | `frontend/src/components/products/scanning/barcodeScannerState.ts` | 1 |
| 392 | `frontend/src/components/products/scanning/cameraPermission.ts` | 5 |
| 393 | `frontend/src/components/products/scanning/scanbotScanner.ts` | 8 |
| 394 | `frontend/src/components/products/shared/primitives.tsx` | 12 |
| 395 | `frontend/src/components/products/surfaces/HeaderActions.tsx` | 2 |
| 396 | `frontend/src/components/products/surfaces/ProductDetailModal.tsx` | 3 |
| 397 | `frontend/src/components/products/surfaces/ProductRowParts.tsx` | 5 |
| 398 | `frontend/src/components/products/surfaces/ProductsListSurface.tsx` | 3 |
| 399 | `frontend/src/components/receipt-settings/AllFieldsPanel.tsx` | 4 |
| 400 | `frontend/src/components/receipt-settings/constants.ts` | 2 |
| 401 | `frontend/src/components/receipt-settings/ErrorBoundary.tsx` | 1 |
| 402 | `frontend/src/components/receipt-settings/FieldOrderManager.tsx` | 9 |
| 403 | `frontend/src/components/receipt-settings/PrintSettings.tsx` | 8 |
| 404 | `frontend/src/components/receipt-settings/ReceiptPreview.tsx` | 3 |
| 405 | `frontend/src/components/receipt-settings/ReceiptSettings.tsx` | 4 |
| 406 | `frontend/src/components/receipt-settings/template.ts` | 4 |
| 407 | `frontend/src/components/receipt/Receipt.tsx` | 12 |
| 408 | `frontend/src/components/returns/EditReturnModal.tsx` | 8 |
| 409 | `frontend/src/components/returns/NewReturnModal.tsx` | 18 |
| 410 | `frontend/src/components/returns/NewSupplierReturnModal.tsx` | 14 |
| 411 | `frontend/src/components/returns/ReturnDetailModal.tsx` | 4 |
| 412 | `frontend/src/components/returns/Returns.tsx` | 13 |
| 413 | `frontend/src/components/returns/ReturnsListSurface.tsx` | 5 |
| 414 | `frontend/src/components/sales/ExportModal.tsx` | 5 |
| 415 | `frontend/src/components/sales/SaleDetailModal.tsx` | 4 |
| 416 | `frontend/src/components/sales/Sales.tsx` | 16 |
| 417 | `frontend/src/components/sales/SalesImportModal.tsx` | 8 |
| 418 | `frontend/src/components/sales/salesImportWorker.ts` | 1 |
| 419 | `frontend/src/components/sales/SalesListSurface.tsx` | 2 |
| 420 | `frontend/src/components/sales/StatusBadge.tsx` | 3 |
| 421 | `frontend/src/components/server/ServerPage.tsx` | 21 |
| 422 | `frontend/src/components/shared/ActionHistoryBar.tsx` | 3 |
| 423 | `frontend/src/components/shared/AppSelect.tsx` | 8 |
| 424 | `frontend/src/components/shared/BackgroundImportTracker.tsx` | 21 |
| 425 | `frontend/src/components/shared/ExportMenu.tsx` | 1 |
| 426 | `frontend/src/components/shared/FilterMenu.tsx` | 4 |
| 427 | `frontend/src/components/shared/globalScroll.ts` | 5 |
| 428 | `frontend/src/components/shared/ImageGalleryLightbox.tsx` | 5 |
| 429 | `frontend/src/components/shared/LazyPortalMenu.tsx` | 1 |
| 430 | `frontend/src/components/shared/LoadingWatchdog.tsx` | 1 |
| 431 | `frontend/src/components/shared/Modal.tsx` | 1 |
| 432 | `frontend/src/components/shared/navigationConfig.ts` | 1 |
| 433 | `frontend/src/components/shared/NotificationCenter.tsx` | 8 |
| 434 | `frontend/src/components/shared/pageActivity.ts` | 1 |
| 435 | `frontend/src/components/shared/PageHeader.tsx` | 1 |
| 436 | `frontend/src/components/shared/PaginationControls.tsx` | 4 |
| 437 | `frontend/src/components/shared/PortalMenu.tsx` | 7 |
| 438 | `frontend/src/components/shared/QuickPreferenceToggles.tsx` | 3 |
| 439 | `frontend/src/components/shared/SectionSwitcher.tsx` | 3 |
| 440 | `frontend/src/components/shared/WriteConflictModal.tsx` | 10 |
| 441 | `frontend/src/components/users/permissionDefinitions.ts` | 0 |
| 442 | `frontend/src/components/users/PermissionEditor.tsx` | 3 |
| 443 | `frontend/src/components/users/UserDetailSheet.tsx` | 4 |
| 444 | `frontend/src/components/users/UserProfileModal.tsx` | 14 |
| 445 | `frontend/src/components/users/Users.tsx` | 19 |
| 446 | `frontend/src/components/utils-settings/AuditLog.tsx` | 20 |
| 447 | `frontend/src/components/utils-settings/Backup.tsx` | 34 |
| 448 | `frontend/src/components/utils-settings/FontFamilyPicker.tsx` | 1 |
| 449 | `frontend/src/components/utils-settings/index.ts` | 0 |
| 450 | `frontend/src/components/utils-settings/OtpModal.tsx` | 4 |
| 451 | `frontend/src/components/utils-settings/ResetData.tsx` | 10 |
| 452 | `frontend/src/components/utils-settings/Settings.tsx` | 27 |
| 453 | `frontend/src/components/utils-settings/settingsConflict.ts` | 3 |
| 454 | `frontend/src/constants.ts` | 3 |
| 455 | `frontend/src/index.tsx` | 13 |
| 456 | `frontend/src/platform/runtime/clientRuntime.ts` | 17 |
| 457 | `frontend/src/platform/storage/storagePolicy.ts` | 3 |
| 458 | `frontend/src/public-runtime/runtime-noise-guard.ts` | 8 |
| 459 | `frontend/src/public-runtime/service-worker.ts` | 26 |
| 460 | `frontend/src/public-runtime/theme-bootstrap.ts` | 15 |
| 461 | `frontend/src/public-web-api.ts` | 2 |
| 462 | `frontend/src/PublicCatalogRoot.tsx` | 2 |
| 463 | `frontend/src/runtime/runtimeErrorClassifier.ts` | 13 |
| 464 | `frontend/src/types/lucide-react-icons.d.ts` | 0 |
| 465 | `frontend/src/types/receiptContracts.ts` | 0 |
| 466 | `frontend/src/types/settingsContracts.ts` | 0 |
| 467 | `frontend/src/utils/actionGuards.ts` | 5 |
| 468 | `frontend/src/utils/actionHistory.ts` | 7 |
| 469 | `frontend/src/utils/appRefresh.ts` | 2 |
| 470 | `frontend/src/utils/bulkOps.ts` | 1 |
| 471 | `frontend/src/utils/color.ts` | 3 |
| 472 | `frontend/src/utils/csv.ts` | 15 |
| 473 | `frontend/src/utils/csvExportWorker.ts` | 1 |
| 474 | `frontend/src/utils/csvImport.ts` | 19 |
| 475 | `frontend/src/utils/csvRowCounter.ts` | 2 |
| 476 | `frontend/src/utils/csvTemplate.ts` | 1 |
| 477 | `frontend/src/utils/dateHelpers.ts` | 3 |
| 478 | `frontend/src/utils/deviceInfo.ts` | 4 |
| 479 | `frontend/src/utils/exportPackage.ts` | 2 |
| 480 | `frontend/src/utils/exportReports.tsx` | 9 |
| 481 | `frontend/src/utils/favicon.ts` | 4 |
| 482 | `frontend/src/utils/formatters.ts` | 5 |
| 483 | `frontend/src/utils/groupedRecords.ts` | 3 |
| 484 | `frontend/src/utils/historyHelpers.ts` | 2 |
| 485 | `frontend/src/utils/importJobRefresh.ts` | 7 |
| 486 | `frontend/src/utils/index.ts` | 0 |
| 487 | `frontend/src/utils/initials.ts` | 7 |
| 488 | `frontend/src/utils/loaders.ts` | 7 |
| 489 | `frontend/src/utils/mediaUpload.ts` | 1 |
| 490 | `frontend/src/utils/mediaUploadState.ts` | 4 |
| 491 | `frontend/src/utils/permissions.ts` | 2 |
| 492 | `frontend/src/utils/pricing.ts` | 8 |
| 493 | `frontend/src/utils/printReceipt.ts` | 45 |
| 494 | `frontend/src/utils/productBatches.ts` | 3 |
| 495 | `frontend/src/utils/productGrouping.ts` | 13 |
| 496 | `frontend/src/utils/publicAssetUrls.ts` | 8 |
| 497 | `frontend/src/utils/receiptAppliedConfig.ts` | 7 |
| 498 | `frontend/src/utils/recordFilters.ts` | 5 |
| 499 | `frontend/src/utils/scriptTypography.ts` | 3 |
| 500 | `frontend/src/utils/searchTerms.ts` | 1 |
| 501 | `frontend/src/utils/settingsRefresh.ts` | 2 |
| 502 | `frontend/src/utils/settingsWriteOptions.ts` | 1 |
| 503 | `frontend/src/web-api.ts` | 58 |
| 504 | `frontend/tailwind.config.ts` | 0 |
| 505 | `frontend/tests/actionGuards.test.ts` | 1 |
| 506 | `frontend/tests/actionStability.test.ts` | 3 |
| 507 | `frontend/tests/adminShellMediaGuards.test.ts` | 0 |
| 508 | `frontend/tests/apiHttp.test.ts` | 3 |
| 509 | `frontend/tests/appRefresh.test.ts` | 2 |
| 510 | `frontend/tests/appShellUtils.test.ts` | 1 |
| 511 | `frontend/tests/assetCompression.test.ts` | 1 |
| 512 | `frontend/tests/backupJobs.test.ts` | 0 |
| 513 | `frontend/tests/barcodeImageScanner.test.ts` | 2 |
| 514 | `frontend/tests/barcodeScannerState.test.ts` | 1 |
| 515 | `frontend/tests/bulkOps.test.ts` | 1 |
| 516 | `frontend/tests/contactImportWorker.test.ts` | 1 |
| 517 | `frontend/tests/csvImport.test.ts` | 1 |
| 518 | `frontend/tests/dashboardDataReliability.test.ts` | 0 |
| 519 | `frontend/tests/dateHelpers.test.ts` | 2 |
| 520 | `frontend/tests/deviceInfo.test.ts` | 2 |
| 521 | `frontend/tests/exportPackages.test.ts` | 1 |
| 522 | `frontend/tests/formatters.test.ts` | 1 |
| 523 | `frontend/tests/globalScroll.test.ts` | 0 |
| 524 | `frontend/tests/globalScrollControls.test.ts` | 1 |
| 525 | `frontend/tests/groupedRecords.test.ts` | 1 |
| 526 | `frontend/tests/historyHelpers.test.ts` | 1 |
| 527 | `frontend/tests/importJobRefresh.test.ts` | 4 |
| 528 | `frontend/tests/initials.test.ts` | 1 |
| 529 | `frontend/tests/inventoryImportWorker.test.ts` | 1 |
| 530 | `frontend/tests/inventoryMobileCardLayout.test.ts` | 0 |
| 531 | `frontend/tests/inventoryMovementGroups.test.ts` | 1 |
| 532 | `frontend/tests/inventoryRfidSection.test.ts` | 0 |
| 533 | `frontend/tests/loaders.test.ts` | 1 |
| 534 | `frontend/tests/mediaUploadHelpers.test.ts` | 1 |
| 535 | `frontend/tests/navigationConfig.test.ts` | 1 |
| 536 | `frontend/tests/notificationBadge.test.ts` | 0 |
| 537 | `frontend/tests/offlineSalesQueue.test.ts` | 1 |
| 538 | `frontend/tests/offlineSecurityHardening.test.ts` | 1 |
| 539 | `frontend/tests/offlineSyncArchitecture.test.ts` | 1 |
| 540 | `frontend/tests/ownedGoogleAuth.test.ts` | 1 |
| 541 | `frontend/tests/performanceLoadingUx.test.ts` | 1 |
| 542 | `frontend/tests/permissionEditor.test.ts` | 0 |
| 543 | `frontend/tests/permissions.test.ts` | 0 |
| 544 | `frontend/tests/portalCatalogDisplay.test.ts` | 1 |
| 545 | `frontend/tests/portalContentI18n.test.ts` | 0 |
| 546 | `frontend/tests/portalEditorUtils.test.ts` | 1 |
| 547 | `frontend/tests/portalFaqVocabulary.test.ts` | 0 |
| 548 | `frontend/tests/portalLanguagePacks.test.ts` | 0 |
| 549 | `frontend/tests/portalTranslateController.test.ts` | 3 |
| 550 | `frontend/tests/posCore.test.ts` | 1 |
| 551 | `frontend/tests/pricingContacts.test.ts` | 1 |
| 552 | `frontend/tests/productBatches.test.ts` | 0 |
| 553 | `frontend/tests/productDiscountUx.test.ts` | 1 |
| 554 | `frontend/tests/productDisplayHelpers.test.ts` | 0 |
| 555 | `frontend/tests/productFilterHelpers.test.ts` | 0 |
| 556 | `frontend/tests/productGalleryHelpers.test.ts` | 0 |
| 557 | `frontend/tests/productGrouping.test.ts` | 1 |
| 558 | `frontend/tests/productGroupViewHelpers.test.ts` | 2 |
| 559 | `frontend/tests/productHistoryHelpers.test.ts` | 1 |
| 560 | `frontend/tests/productImportPlanner.test.ts` | 1 |
| 561 | `frontend/tests/productImportWorkerFallback.test.ts` | 1 |
| 562 | `frontend/tests/productMenuHelpers.test.ts` | 5 |
| 563 | `frontend/tests/productPageHelpers.test.ts` | 0 |
| 564 | `frontend/tests/productSearchPagination.test.ts` | 0 |
| 565 | `frontend/tests/productSelectionHelpers.test.ts` | 0 |
| 566 | `frontend/tests/productWriteHelpers.test.ts` | 0 |
| 567 | `frontend/tests/publicErrorRecovery.test.ts` | 1 |
| 568 | `frontend/tests/receiptSettingsSync.test.ts` | 0 |
| 569 | `frontend/tests/receiptTemplate.test.ts` | 1 |
| 570 | `frontend/tests/returnsLayout.test.ts` | 0 |
| 571 | `frontend/tests/runtimeErrorClassifier.test.ts` | 0 |
| 572 | `frontend/tests/salesImportWorker.test.ts` | 1 |
| 573 | `frontend/tests/scanbotScanner.test.ts` | 2 |
| 574 | `frontend/tests/scriptTypography.test.ts` | 0 |
| 575 | `frontend/tests/sectionNavigation.test.ts` | 0 |
| 576 | `frontend/tests/settingsConflictHelpers.test.ts` | 1 |
| 577 | `frontend/tests/settingsRefresh.test.ts` | 0 |
| 578 | `frontend/tests/sourceSyntaxCheck.ts` | 1 |
| 579 | `frontend/tests/storagePolicy.test.ts` | 1 |
| 580 | `frontend/tests/utilsSettingsBarrel.test.ts` | 0 |
| 581 | `frontend/vite.config.ts` | 19 |
| 582 | `ops/scripts/architecture/generated-bulk-audit.ts` | 18 |
| 583 | `ops/scripts/architecture/language-runtime-audit.ts` | 20 |
| 584 | `ops/scripts/architecture/organization-audit.ts` | 14 |
| 585 | `ops/scripts/architecture/phase29-audit.ts` | 14 |
| 586 | `ops/scripts/architecture/runtime-js-inventory.ts` | 6 |
| 587 | `ops/scripts/backend/build-package-stage.ts` | 10 |
| 588 | `ops/scripts/backend/build-server-entry.ts` | 5 |
| 589 | `ops/scripts/backend/schema-audit.ts` | 25 |
| 590 | `ops/scripts/backend/schema-primary-key-preflight.ts` | 5 |
| 591 | `ops/scripts/backend/verify-data-integrity.ts` | 27 |
| 592 | `ops/scripts/frontend/build-public-runtime-scripts.ts` | 5 |
| 593 | `ops/scripts/frontend/verify-i18n.ts` | 6 |
| 594 | `ops/scripts/frontend/verify-performance.ts` | 4 |
| 595 | `ops/scripts/frontend/verify-ui.ts` | 11 |
| 596 | `ops/scripts/lib/fs-utils.ts` | 13 |
| 597 | `ops/scripts/lib/report-utils.ts` | 5 |
| 598 | `ops/scripts/runtime/audits/action-history-undo-redo-check.ts` | 5 |
| 599 | `ops/scripts/runtime/audits/audit-auth.ts` | 6 |
| 600 | `ops/scripts/runtime/audits/audit-manifest.ts` | 3 |
| 601 | `ops/scripts/runtime/audits/audit-report-html.ts` | 11 |
| 602 | `ops/scripts/runtime/audits/deep-live-audit.ts` | 42 |
| 603 | `ops/scripts/runtime/audits/full-app-audit.ts` | 22 |
| 604 | `ops/scripts/runtime/browser-action-smoke.ts` | 32 |
| 605 | `ops/scripts/runtime/build-ecosystem-config.ts` | 5 |
| 606 | `ops/scripts/runtime/cloudflare/cloudflare-tunnel-watchdog.ts` | 12 |
| 607 | `ops/scripts/runtime/cloudflare/rotate-cloudflare-tunnel-token.ts` | 16 |
| 608 | `ops/scripts/runtime/cloudflare/update-cloudflare-tunnel-origin.ts` | 6 |
| 609 | `ops/scripts/runtime/cloudflare/verify-cloudflare-automation.ts` | 16 |
| 610 | `ops/scripts/runtime/cloudflare/verify-r2-object-store.ts` | 8 |
| 611 | `ops/scripts/runtime/cloudflare/warm-cloudflare-startup-assets.ts` | 25 |
| 612 | `ops/scripts/runtime/live-checks/all-pages-control-audit.ts` | 47 |
| 613 | `ops/scripts/runtime/live-checks/filter-burst-check.ts` | 5 |
| 614 | `ops/scripts/runtime/live-checks/lcp-route-trace.ts` | 11 |
| 615 | `ops/scripts/runtime/live-checks/live-check-utils.ts` | 8 |
| 616 | `ops/scripts/runtime/live-checks/move766-product-write-live-check.ts` | 8 |
| 617 | `ops/scripts/runtime/live-checks/phase84-account-loyalty-select-live-check.ts` | 3 |
| 618 | `ops/scripts/runtime/live-checks/phase84-branches-actions-live-check.ts` | 4 |
| 619 | `ops/scripts/runtime/live-checks/phase84-catalog-editor-select-live-check.ts` | 4 |
| 620 | `ops/scripts/runtime/live-checks/phase84-contacts-live-check.ts` | 2 |
| 621 | `ops/scripts/runtime/live-checks/phase84-files-providers-actions-live-check.ts` | 3 |
| 622 | `ops/scripts/runtime/live-checks/phase84-filter-menu-live-check.ts` | 7 |
| 623 | `ops/scripts/runtime/live-checks/phase84-inventory-actions-live-check.ts` | 3 |
| 624 | `ops/scripts/runtime/live-checks/phase84-inventory-section-restore-live-check.ts` | 3 |
| 625 | `ops/scripts/runtime/live-checks/phase84-live-suite.ts` | 11 |
| 626 | `ops/scripts/runtime/live-checks/phase84-loyalty-points-rollback-check.ts` | 9 |
| 627 | `ops/scripts/runtime/live-checks/phase84-product-brands-actions-live-check.ts` | 3 |
| 628 | `ops/scripts/runtime/live-checks/phase84-product-categories-actions-live-check.ts` | 2 |
| 629 | `ops/scripts/runtime/live-checks/phase84-product-form-dropdown-live-check.ts` | 4 |
| 630 | `ops/scripts/runtime/live-checks/phase84-product-page-actions-live-check.ts` | 3 |
| 631 | `ops/scripts/runtime/live-checks/phase84-product-scanning-actions-live-check.ts` | 2 |
| 632 | `ops/scripts/runtime/live-checks/phase84-product-stock-actions-live-check.ts` | 2 |
| 633 | `ops/scripts/runtime/live-checks/phase84-product-units-actions-live-check.ts` | 2 |
| 634 | `ops/scripts/runtime/live-checks/phase84-product-variant-actions-live-check.ts` | 3 |
| 635 | `ops/scripts/runtime/live-checks/phase84-public-assistant-select-live-check.ts` | 3 |
| 636 | `ops/scripts/runtime/live-checks/phase84-public-portal-cloudflare-check.ts` | 5 |
| 637 | `ops/scripts/runtime/live-checks/phase84-receipt-export-layout-check.ts` | 9 |
| 638 | `ops/scripts/runtime/live-checks/phase84-receipt-settings-rollback-check.ts` | 9 |
| 639 | `ops/scripts/runtime/live-checks/phase84-sales-actions-live-check.ts` | 2 |
| 640 | `ops/scripts/runtime/live-checks/phase84-settings-save-rollback-check.ts` | 7 |
| 641 | `ops/scripts/runtime/live-checks/phase84-settings-select-live-check.ts` | 5 |
| 642 | `ops/scripts/runtime/live-checks/phase84-shared-select-live-check.ts` | 4 |
| 643 | `ops/scripts/runtime/live-checks/phase84-ui-live-check.ts` | 4 |
| 644 | `ops/scripts/runtime/live-checks/phase84-users-actions-live-check.ts` | 2 |
| 645 | `ops/scripts/runtime/live-checks/route-load-trace.ts` | 8 |
| 646 | `ops/scripts/runtime/smoke/check-public-url.ts` | 11 |
| 647 | `ops/scripts/runtime/smoke/check-route-contract.ts` | 3 |
| 648 | `ops/scripts/runtime/smoke/live-smoke.ts` | 6 |
| 649 | `ops/scripts/runtime/smoke/post-start-diagnostics.ts` | 7 |
| 650 | `ops/scripts/runtime/storage/cleanup-integrity-backlog.ts` | 8 |
| 651 | `ops/scripts/runtime/storage/cleanup-test-data.ts` | 21 |
| 652 | `ops/scripts/runtime/storage/dataset-readiness.ts` | 5 |
| 653 | `ops/scripts/runtime/storage/post-live-hygiene.ts` | 11 |
| 654 | `ops/scripts/runtime/storage/prune-storage.ts` | 20 |
| 655 | `ops/scripts/runtime/storage/restore-candidates.ts` | 8 |
| 656 | `ops/scripts/runtime/storage/restore-rehearsal.ts` | 14 |
| 657 | `ops/scripts/verification/verify-backup-reliability.ts` | 6 |
| 658 | `ops/scripts/verification/verify-docker-release.ts` | 11 |
| 659 | `ops/scripts/verification/verify-hardening-policy.ts` | 10 |
| 660 | `ops/scripts/verification/verify-runtime-deps.ts` | 15 |
| 661 | `ops/scripts/verification/verify-scale-services.ts` | 9 |
| 662 | `ops/scripts/verification/verify-secret-hygiene.ts` | 1 |

## 3. Detailed Function Commentary

### 3.1 `backend/.pkg-stage/server.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `startRequestedWorkerRole` | function | 6 |
| 2 | `listFrontendAssetFiles` | function | 69 |
| 3 | `resolveFrontendAssetPath` | function | 80 |
| 4 | `loadCompressionMiddleware` | function | 106 |
| 5 | `applySecurityHeaders` | function | 115 |
| 6 | `applyRequestPolicy` | function | 120 |
| 7 | `applyCoreMiddleware` | function | 129 |
| 8 | `normalizeUploadFileName` | function | 143 |
| 9 | `getSafeActiveUploadPath` | function | 150 |
| 10 | `findBackupUploadFallback` | function | 160 |
| 11 | `inferUploadContentType` | function | 214 |
| 12 | `serveLocalUpload` | function | 230 |
| 13 | `getObjectStreamWithTimeout` | function | 247 |
| 14 | `mountStaticAssets` | function | 262 |
| 15 | `mountHealthRoute` | function | 340 |
| 16 | `mountApiRoutes` | function | 368 |
| 17 | `mountTransfersAlias` | function | 403 |
| 18 | `mountSpaFallback` | function | 417 |
| 19 | `mountErrorHandler` | function | 435 |
| 20 | `getStartupBanner` | function | 448 |
| 21 | `closeDatabase` | function | 471 |
| 22 | `startDatabaseMaintenanceTimer` | function | 482 |
| 23 | `registerShutdownHandlers` | function | 490 |
| 24 | `bootstrapServer` | function | 504 |

### 3.2 `backend/.pkg-stage/src/accessControl.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 45 |
| 2 | `normalizeHostname` | function | 49 |
| 3 | `getConfiguredSyncToken` | function | 55 |
| 4 | `getRemoteAccessProvider` | function | 59 |
| 5 | `isLegacyTailscaleEnabled` | function | 63 |
| 6 | `getRequestHost` | function | 70 |
| 7 | `getRemoteAddress` | function | 79 |
| 8 | `isLoopbackAddress` | function | 87 |
| 9 | `getPresentedSyncToken` | function | 97 |
| 10 | `getTailscaleIdentity` | function | 106 |
| 11 | `hasTrustedTailscaleIdentity` | function | 118 |
| 12 | `isLocalHostRequest` | function | 129 |
| 13 | `isTsNetHost` | function | 134 |
| 14 | `getConfiguredTailscaleHost` | function | 139 |
| 15 | `isPublicRemoteRequest` | function | 146 |
| 16 | `isPublicApiRequest` | function | 157 |
| 17 | `classifyRequestAccess` | function | 170 |
| 18 | `authorizeProtectedRequest` | function | 202 |

### 3.3 `backend/.pkg-stage/src/analytics/duckdbRuntime.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `tryRequireDuckDbPackage` | function | 30 |
| 2 | `probeDuckDbPackage` | function | 44 |
| 3 | `getDuckDbRuntimeStatus` | function | 74 |

### 3.4 `backend/.pkg-stage/src/authOtpGuards.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeUserId` | function | 6 |
| 2 | `canManageOtpTarget` | function | 12 |
| 3 | `requiresSelfOtpDisablePassword` | function | 23 |

### 3.5 `backend/.pkg-stage/src/backupSchema.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `countRowsByTable` | function | 102 |
| 2 | `countCustomTableRows` | function | 114 |
| 3 | `buildBackupSummary` | function | 125 |
| 4 | `buildBackupSummaryFromCounts` | function | 133 |

### 3.6 `backend/.pkg-stage/src/businessMetrics.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sellableProductWhere` | function | 14 |
| 2 | `effectiveCostExpr` | function | 25 |
| 3 | `stockQuantityExpr` | function | 34 |
| 4 | `normalizeMetricRow` | function | 41 |
| 5 | `getStockMetrics` | function | 56 |
| 6 | `getLowStockProducts` | function | 94 |
| 7 | `getOutOfStockProducts` | function | 111 |
| 8 | `getStockAlertProducts` | function | 127 |
| 9 | `getExpiringProducts` | function | 152 |

### 3.7 `backend/.pkg-stage/src/catalogTextIntegrity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeCatalogText` | function | 16 |
| 2 | `hasSuspiciousCatalogText` | function | 31 |
| 3 | `listSuspiciousCatalogFields` | function | 46 |
| 4 | `assertCatalogTextIntegrity` | function | 63 |
| 5 | `normalizeOptionList` | function | 73 |

### 3.8 `backend/.pkg-stage/src/config/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildEnvCandidates` | function | 25 |
| 2 | `isDefaultDataMarker` | function | 54 |
| 3 | `resolveStoredDataDir` | function | 59 |
| 4 | `normalizeSelectedDataDir` | function | 66 |
| 5 | `readDataLocation` | function | 78 |
| 6 | `writeDataLocation` | function | 89 |
| 7 | `ensureDirectory` | function | 105 |
| 8 | `readSecretFileValue` | function | 109 |
| 9 | `ensureOrganizationRuntimeLayout` | function | 121 |
| 10 | `normalizeOrganizationSeed` | function | 128 |
| 11 | `STORAGE_ROOT` | const arrow | 135 |

### 3.9 `backend/.pkg-stage/src/conflictControl.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `WriteConflictError` | class | 8 |
| 2 | `normalizeUpdatedAt` | function | 32 |
| 3 | `getExpectedUpdatedAt` | function | 41 |
| 4 | `assertUpdatedAtMatch` | function | 56 |
| 5 | `sendWriteConflict` | function | 73 |
| 6 | `sendSettingsConflict` | function | 93 |

### 3.10 `backend/.pkg-stage/src/contactOptions.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cleanText` | function | 9 |
| 2 | `normalizeContactOption` | function | 41 |
| 3 | `hasContactOptionData` | function | 57 |
| 4 | `collectNormalizedContactOptions` | function | 72 |
| 5 | `collectLegacyContactOptions` | function | 89 |
| 6 | `parseStoredContactOptions` | function | 111 |
| 7 | `parseImportContactOptions` | function | 135 |
| 8 | `serializeContactOptions` | function | 156 |
| 9 | `getPrimaryContactOption` | function | 166 |
| 10 | `buildImportedContactState` | function | 178 |

### 3.11 `backend/.pkg-stage/src/database.js`

- No top-level named symbols detected.

### 3.12 `backend/.pkg-stage/src/dataPath/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizePathForCompare` | function | 32 |
| 2 | `isSamePath` | function | 38 |
| 3 | `isSubPath` | function | 42 |
| 4 | `ensureDataRootLayout` | function | 47 |
| 5 | `walkFiles` | function | 58 |
| 6 | `summarizeDataRoot` | function | 80 |
| 7 | `copyDirectoryContents` | function | 123 |
| 8 | `buildArchivedTargetPath` | function | 160 |
| 9 | `waitForFileSystemRetry` | function | 177 |
| 10 | `renameDirectoryWithRetry` | function | 183 |
| 11 | `relocateDataRoot` | function | 202 |

### 3.13 `backend/.pkg-stage/src/db/cutoverReadiness.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeRelative` | function | 44 |
| 2 | `toRelative` | function | 48 |
| 3 | `shouldSkipDir` | function | 52 |
| 4 | `listSourceFiles` | function | 60 |
| 5 | `analyzeFile` | function | 74 |
| 6 | `incrementCount` | function | 95 |
| 7 | `mapCountsToRows` | function | 99 |
| 8 | `summarizeBlockers` | function | 107 |
| 9 | `analyzeFiles` | function | 124 |
| 10 | `analyzePostgresCutoverReadiness` | function | 134 |

### 3.14 `backend/.pkg-stage/src/db/postgresQueryCompat.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `countPositionalPlaceholders` | function | 63 |
| 2 | `stripTrailingSemicolon` | function | 88 |
| 3 | `replacePositionalParams` | function | 92 |
| 4 | `normalizePortableSqlFunctions` | function | 126 |
| 5 | `translateInsertOrIgnore` | function | 137 |
| 6 | `translateParameters` | function | 141 |
| 7 | `appendReturning` | function | 166 |
| 8 | `isNumericFieldName` | function | 178 |
| 9 | `getInsertTableName` | function | 185 |
| 10 | `translateSql` | function | 195 |
| 11 | `coerceRowValue` | function | 213 |
| 12 | `coerceRow` | function | 226 |

### 3.15 `backend/.pkg-stage/src/fileAssets.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDb` | function | 59 |
| 2 | `buildAssetExtToMime` | function | 63 |
| 3 | `ensureUploadsDirectory` | function | 73 |
| 4 | `getMimeTypeFromName` | function | 77 |
| 5 | `getMediaType` | function | 82 |
| 6 | `sanitizeOriginalFileName` | function | 91 |
| 7 | `preserveOriginalDisplayName` | function | 105 |
| 8 | `buildUniqueStoredName` | function | 113 |
| 9 | `shouldCompressImage` | function | 130 |
| 10 | `compressBufferForAsset` | function | 136 |
| 11 | `encodeImageCandidate` | function | 220 |
| 12 | `readImageDimensions` | function | 249 |
| 13 | `getFfmpegPath` | function | 262 |
| 14 | `buildVideoOptimizationArgs` | function | 270 |
| 15 | `optimizeStoredVideo` | function | 308 |
| 16 | `createFileAssetRecord` | function | 374 |
| 17 | `getFileAssetByPublicPath` | function | 454 |
| 18 | `buildFileAssetFilterParams` | function | 463 |
| 19 | `listAssetRows` | function | 470 |
| 20 | `countAssetRows` | function | 495 |
| 21 | `writeObjectBodyToFile` | function | 515 |
| 22 | `ensureStoredAssetAvailableLocally` | function | 533 |
| 23 | `collectUploadPathsFromValue` | function | 543 |
| 24 | `pruneInvalidReferenceBackfillAssets` | function | 571 |
| 25 | `collectReferencedUploadPaths` | function | 579 |
| 26 | `add` | const arrow | 581 |
| 27 | `ensureReferencedAssetsRegistered` | function | 592 |
| 28 | `getUploadFilePath` | function | 625 |
| 29 | `toUploadPublicPathFromObjectKey` | function | 630 |
| 30 | `findUploadStorageOrphans` | function | 636 |
| 31 | `collectTrackedUploadPublicPaths` | function | 654 |
| 32 | `add` | const arrow | 656 |
| 33 | `collectObjectKeys` | function | 673 |
| 34 | `listLocalUploadFiles` | function | 682 |
| 35 | `reconcileUploadStorage` | function | 690 |
| 36 | `requestUploadStorageReconcile` | function | 750 |
| 37 | `ensureFileAssetListingWarm` | function | 754 |
| 38 | `prewarmFileAssetListing` | function | 772 |
| 39 | `deleteAllStoredUploads` | function | 783 |
| 40 | `buildInClausePlaceholders` | function | 804 |
| 41 | `normalizeUniquePublicPaths` | function | 810 |
| 42 | `createUsageMap` | function | 822 |
| 43 | `addReferencedRowUsages` | function | 830 |
| 44 | `buildUploadReferenceUsageMap` | function | 840 |
| 45 | `getCachedSettingsUsageReferences` | function | 862 |
| 46 | `getCachedSubmissionUsageReferences` | function | 882 |
| 47 | `mergeUsageReferences` | function | 902 |
| 48 | `collectUsagesByPublicPath` | function | 911 |
| 49 | `addUsage` | const arrow | 917 |
| 50 | `collectUsage` | function | 987 |
| 51 | `resolveBrowserPublicPath` | function | 991 |
| 52 | `serializeAssetRow` | function | 998 |
| 53 | `serializeAssetRows` | function | 1012 |
| 54 | `registerStoredAsset` | function | 1026 |
| 55 | `registerUploadFromRequest` | function | 1103 |
| 56 | `optimizeStoredAssetFromQueue` | function | 1117 |
| 57 | `storeDataUrlAsset` | function | 1149 |
| 58 | `backfillUploadAssets` | function | 1175 |
| 59 | `listFileAssets` | function | 1192 |
| 60 | `getFileAssetById` | function | 1215 |
| 61 | `deleteFileAsset` | function | 1220 |

### 3.16 `backend/.pkg-stage/src/helpers.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `logOp` | function | 21 |
| 2 | `getServerLog` | function | 26 |
| 3 | `ok` | function | 30 |
| 4 | `err` | function | 35 |
| 5 | `audit` | function | 50 |
| 6 | `safeHistoryPayload` | function | 99 |
| 7 | `recordActionHistory` | function | 109 |
| 8 | `broadcast` | function | 164 |
| 9 | `tryParse` | function | 181 |
| 10 | `today` | function | 186 |
| 11 | `nonEmptyCsvLines` | function | 190 |
| 12 | `normalizeCsvHeaders` | function | 198 |
| 13 | `normalizeCsvCell` | function | 206 |
| 14 | `buildCsvRow` | function | 210 |
| 15 | `buildParsedCsvRows` | function | 218 |
| 16 | `parseCSVRows` | function | 237 |
| 17 | `bulkImportCSV` | function | 254 |
| 18 | `parseCSVLine` | function | 280 |
| 19 | `buildPlaceholders` | function | 294 |
| 20 | `rowValuesForColumns` | function | 300 |
| 21 | `importRows` | function | 314 |
| 22 | `verifyAndRepairStockQuantities` | function | 329 |
| 23 | `mapReturnedQuantities` | function | 382 |
| 24 | `areAllSaleItemsReturned` | function | 390 |
| 25 | `verifyAndRepairSaleStatuses` | function | 402 |
| 26 | `verifyAndRepairCostPrices` | function | 461 |
| 27 | `runDataIntegrityCheck` | function | 543 |
| 28 | `hasRepairMessages` | function | 567 |
| 29 | `getSafeCostPrice` | function | 577 |
| 30 | `calculateSaleProfit` | function | 588 |

### 3.17 `backend/.pkg-stage/src/idempotency.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeClientRequestId` | function | 4 |

### 3.18 `backend/.pkg-stage/src/importCsv.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `stripBom` | function | 15 |
| 2 | `normalizeDigit` | function | 22 |
| 3 | `normalizeNumericText` | function | 33 |
| 4 | `countDelimiter` | function | 44 |
| 5 | `detectCsvDelimiter` | function | 66 |
| 6 | `parseDelimitedRows` | function | 85 |
| 7 | `normalizeCsvKey` | function | 130 |
| 8 | `normalizeCsvHeaders` | function | 141 |
| 9 | `hasDelimitedRowContent` | function | 152 |
| 10 | `hasParsedCsvRowContent` | function | 162 |
| 11 | `buildParsedCsvRows` | function | 172 |
| 12 | `parseCsvRows` | function | 186 |
| 13 | `detectCsvDelimiterFromFile` | function | 196 |
| 14 | `csvValuesToRow` | function | 212 |
| 15 | `hasCsvContent` | function | 226 |
| 16 | `emitRecord` | const function | 248 |

### 3.19 `backend/.pkg-stage/src/importParsing.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeDigit` | function | 13 |
| 2 | `normalizeNumericText` | function | 24 |
| 3 | `removeCurrencyNoise` | function | 34 |
| 4 | `normalizeNumberSeparators` | function | 44 |
| 5 | `parseImportNumericValue` | function | 83 |
| 6 | `normalizeImportMoney` | function | 102 |

### 3.20 `backend/.pkg-stage/src/initials.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildKhmerOrder` | function | 21 |
| 2 | `normalizeInitialText` | function | 34 |
| 3 | `getInitialKey` | function | 39 |
| 4 | `getInitialType` | function | 51 |
| 5 | `compareInitialKeys` | function | 61 |
| 6 | `rank` | const arrow | 66 |
| 7 | `aggregateInitialRows` | function | 87 |

### 3.21 `backend/.pkg-stage/src/maintenanceLock.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 15 |
| 2 | `getMaintenanceLock` | function | 22 |
| 3 | `isMaintenanceLocked` | function | 29 |
| 4 | `acquireMaintenanceLock` | function | 37 |
| 5 | `releaseMaintenanceLock` | function | 53 |
| 6 | `withMaintenanceLock` | function | 66 |
| 7 | `isReadOnlyMethod` | function | 79 |
| 8 | `isMaintenanceWriteAllowed` | function | 87 |
| 9 | `maintenanceWriteGuard` | function | 109 |

### 3.22 `backend/.pkg-stage/src/middleware.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `authToken` | function | 14 |
| 2 | `networkAccessGuard` | function | 27 |
| 3 | `sanitiseFilename` | function | 32 |
| 4 | `compressImageFile` | function | 64 |
| 5 | `compressImageBuffer` | function | 99 |
| 6 | `getClientKey` | function | 106 |
| 7 | `routeRateLimit` | function | 112 |
| 8 | `createStorage` | function | 124 |
| 9 | `buildUpload` | function | 140 |
| 10 | `parsePermissionsValue` | function | 172 |
| 11 | `getMergedPermissions` | function | 182 |
| 12 | `isAdminControlUser` | function | 189 |
| 13 | `hasPermission` | function | 197 |
| 14 | `requirePermission` | function | 204 |
| 15 | `requireAnyPermission` | function | 216 |
| 16 | `readAuditTextValue` | function | 234 |
| 17 | `getAuditRequestMeta` | function | 240 |
| 18 | `getAuditActor` | function | 269 |
| 19 | `compressUpload` | function | 285 |
| 20 | `validateUploadedFile` | function | 303 |
| 21 | `validateUploadBufferPayload` | function | 314 |

### 3.23 `backend/.pkg-stage/src/money.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toFiniteNumber` | function | 4 |
| 2 | `roundUpToDecimals` | function | 10 |
| 3 | `normalizePriceValue` | function | 20 |

### 3.24 `backend/.pkg-stage/src/netSecurity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 29 |
| 2 | `normalizeHostname` | function | 36 |
| 3 | `isPrivateIpv4` | function | 43 |
| 4 | `isPrivateIpv6` | function | 64 |
| 5 | `isBlockedHostname` | function | 78 |
| 6 | `assertSafeOutboundUrl` | function | 99 |
| 7 | `isSafeExternalImageReference` | function | 130 |

### 3.25 `backend/.pkg-stage/src/objectStore.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getS3RequestHandler` | function | 18 |
| 2 | `getObjectStorageDriver` | function | 29 |
| 3 | `isObjectStorageEnabled` | function | 33 |
| 4 | `isR2Enabled` | function | 37 |
| 5 | `isMinioEnabled` | function | 41 |
| 6 | `trim` | function | 45 |
| 7 | `getCloudflareAccountId` | function | 49 |
| 8 | `getCloudflareApiToken` | function | 56 |
| 9 | `canUseCloudflareR2Api` | function | 68 |
| 10 | `buildR2ApiObjectUrl` | function | 72 |
| 11 | `cloudflareR2ApiRequest` | function | 87 |
| 12 | `shouldFallbackToR2Api` | function | 125 |
| 13 | `isMissingObjectError` | function | 135 |
| 14 | `getS3Client` | function | 145 |
| 15 | `normalizeObjectKey` | function | 164 |
| 16 | `normalizeUniqueObjectKeys` | function | 168 |
| 17 | `buildDeleteObjectRefs` | function | 180 |
| 18 | `serializeCloudflareObjectList` | function | 188 |
| 19 | `serializeS3ObjectList` | function | 201 |
| 20 | `ensureBucket` | function | 214 |
| 21 | `putObject` | function | 232 |
| 22 | `sendWithTimeout` | function | 267 |
| 23 | `getObjectStream` | function | 279 |
| 24 | `objectExists` | function | 312 |
| 25 | `deleteObject` | function | 345 |
| 26 | `deleteObjects` | function | 364 |
| 27 | `listObjects` | function | 397 |
| 28 | `testObjectStore` | function | 433 |
| 29 | `bufferToStream` | function | 448 |

### 3.26 `backend/.pkg-stage/src/optionalSharp.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadSharp` | function | 9 |

### 3.27 `backend/.pkg-stage/src/organizationContext/index.js`

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
| 13 | `ensureOrganizationFilesystemLayout` | function | 157 |
| 14 | `getOrganizationStorageStatus` | function | 226 |

### 3.28 `backend/.pkg-stage/src/permissions.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildPermissionDefinitions` | function | 51 |
| 2 | `normalizeKey` | function | 148 |
| 3 | `getPermissionDefinition` | function | 155 |
| 4 | `isSensitivePermissionKey` | function | 166 |
| 5 | `permissionForActionHistory` | function | 176 |
| 6 | `isSensitiveActionHistory` | function | 187 |
| 7 | `hasPermissionValue` | function | 206 |

### 3.29 `backend/.pkg-stage/src/portalUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toTrimmedString` | function | 14 |
| 2 | `safeJsonParse` | function | 23 |
| 3 | `createAboutBlock` | function | 36 |
| 4 | `normalizeAboutBlocks` | function | 51 |
| 5 | `extractGoogleMapsEmbedUrl` | function | 78 |
| 6 | `normalizeGoogleMapsEmbed` | function | 90 |

### 3.30 `backend/.pkg-stage/src/postgresDatabase.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadPgNative` | function | 13 |
| 2 | `normalizeQueryRows` | function | 30 |
| 3 | `buildRunResult` | function | 37 |
| 4 | `normalizeStatementArgs` | function | 46 |
| 5 | `splitSqlStatements` | function | 55 |
| 6 | `PostgresCompatStatement` | class | 65 |
| 7 | `PostgresCompatDatabase` | class | 89 |
| 8 | `createPostgresDatabase` | function | 531 |
| 9 | `runDatabaseMaintenance` | function | 535 |
| 10 | `ensureCoreDataInvariants` | function | 539 |
| 11 | `ensureDefaultOrganizationAndGroup` | function | 543 |
| 12 | `ensurePrimaryAdminRoleAndUser` | function | 547 |
| 13 | `getDb` | function | 553 |
| 14 | `closeDatabase` | function | 581 |

### 3.31 `backend/.pkg-stage/src/productBatches.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeExpiryDate` | function | 23 |
| 2 | `normalizeLotCode` | function | 28 |
| 3 | `isSellableProduct` | function | 33 |
| 4 | `buildBatchKey` | function | 37 |
| 5 | `getProductById` | function | 46 |
| 6 | `rowsToIds` | function | 52 |
| 7 | `normalizePositiveIds` | function | 60 |
| 8 | `buildPlaceholders` | function | 72 |
| 9 | `sumQuantities` | function | 78 |
| 10 | `hasTrackedBatch` | function | 86 |
| 11 | `getProductBatchIds` | function | 93 |
| 12 | `getBatchRowsForProduct` | function | 97 |
| 13 | `getLegacyBatchBackfillCandidates` | function | 106 |
| 14 | `createOrFindProductBatch` | function | 119 |
| 15 | `setBranchBatchQuantity` | function | 176 |
| 16 | `incrementBranchBatchQuantity` | function | 186 |
| 17 | `getBatchStockRows` | function | 197 |
| 18 | `listProductBatches` | function | 237 |
| 19 | `syncProductBatchRollups` | function | 308 |
| 20 | `migrateLegacyProductToBatches` | function | 353 |
| 21 | `migrateAllLegacyProductsToBatches` | function | 397 |
| 22 | `scheduleLegacyBatchBackfill` | function | 409 |
| 23 | `runNextChunk` | const arrow | 415 |
| 24 | `getLegacyBatchBackfillStatus` | function | 445 |
| 25 | `getAvailableProductQuantity` | function | 454 |
| 26 | `allocateProductBatches` | function | 459 |
| 27 | `increaseProductBatchStock` | function | 499 |
| 28 | `restoreBatchAllocations` | function | 516 |
| 29 | `cloneAllocationsToProduct` | function | 531 |
| 30 | `getSaleItemAllocations` | function | 555 |
| 31 | `markSaleItemAllocationsReleased` | function | 567 |
| 32 | `getAvailableSaleAllocationRows` | function | 575 |
| 33 | `getReturnItemAllocations` | function | 598 |
| 34 | `markReturnItemAllocationsReversed` | function | 610 |

### 3.32 `backend/.pkg-stage/src/productDiscounts.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeBooleanFlag` | function | 41 |
| 2 | `normalizePercent` | function | 54 |
| 3 | `normalizeDiscountType` | function | 64 |
| 4 | `normalizeHexColor` | function | 74 |
| 5 | `normalizeDateText` | function | 83 |
| 6 | `pick` | function | 97 |
| 7 | `normalizeProductDiscount` | function | 106 |
| 8 | `isDiscountActive` | function | 133 |
| 9 | `calculateDiscountedPrice` | function | 152 |

### 3.33 `backend/.pkg-stage/src/productImportPolicies.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseImportNumber` | function | 17 |
| 2 | `parseImportFlag` | function | 31 |
| 3 | `hasImportValue` | function | 45 |
| 4 | `normalizeFieldRule` | function | 55 |
| 5 | `splitUniqueImportValues` | function | 66 |
| 6 | `collectImportListValues` | function | 83 |
| 7 | `buildLowercaseSet` | function | 96 |
| 8 | `appendUniqueImportValue` | function | 110 |
| 9 | `resolveImportValue` | function | 135 |
| 10 | `normalizeImageConflictMode` | function | 155 |

### 3.34 `backend/.pkg-stage/src/requestContext.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cleanText` | function | 10 |
| 2 | `readHeader` | function | 17 |
| 3 | `extractRequestMeta` | function | 24 |
| 4 | `requestContextMiddleware` | function | 51 |
| 5 | `getRequestMeta` | function | 57 |

### 3.35 `backend/.pkg-stage/src/routes/actionHistory.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseJson` | function | 14 |
| 2 | `normalizeLimit` | function | 24 |
| 3 | `normalizeText` | function | 29 |
| 4 | `serializePayload` | function | 34 |
| 5 | `canReadAllHistory` | function | 43 |
| 6 | `getOwnedHistoryRow` | function | 47 |
| 7 | `canOperateHistoryRow` | function | 53 |
| 8 | `canRecordHistory` | function | 67 |
| 9 | `getHistoryRow` | function | 87 |
| 10 | `mapRow` | function | 94 |
| 11 | `mapHistoryRows` | function | 103 |
| 12 | `completeServerHistoryTransition` | function | 214 |

### 3.36 `backend/.pkg-stage/src/routes/ai.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `listProviders` | function | 19 |
| 2 | `getProviderRow` | function | 32 |
| 3 | `serializeResponseRows` | function | 244 |

### 3.37 `backend/.pkg-stage/src/routes/auth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getClientKey` | function | 92 |
| 2 | `applyRateLimit` | function | 105 |
| 3 | `getLoginLockKey` | function | 117 |
| 4 | `isReasonableCredentialLength` | function | 121 |
| 5 | `normalizeLookupText` | function | 126 |
| 6 | `isHttpUrl` | function | 130 |
| 7 | `buildPublicBaseUrl` | function | 134 |
| 8 | `isLocalOrigin` | function | 141 |
| 9 | `resolvePublicAssetBaseUrl` | function | 150 |
| 10 | `resolvePasswordResetRedirect` | function | 156 |
| 11 | `findFirstHttpUrl` | function | 169 |
| 12 | `loginIdentifierPreview` | function | 179 |
| 13 | `rejectLogin` | function | 193 |
| 14 | `getOtpSecret` | function | 215 |
| 15 | `requireOtpActor` | function | 219 |
| 16 | `getOtpTargetUser` | function | 225 |
| 17 | `buildUserPayload` | function | 240 |
| 18 | `resolveOrganizationLookup` | function | 272 |
| 19 | `findUserByIdentifier` | function | 278 |
| 20 | `getExactActiveUserById` | function | 347 |
| 21 | `normalizeOauthMode` | function | 362 |
| 22 | `isEmailIdentifier` | function | 367 |
| 23 | `getUserById` | function | 371 |
| 24 | `getSettingsSnapshot` | function | 375 |
| 25 | `getBootstrapSystemSnapshot` | function | 384 |
| 26 | `buildAuthenticatedBootstrap` | function | 423 |
| 27 | `generateTemporaryAuthPassword` | function | 452 |
| 28 | `issueAuthSession` | function | 456 |
| 29 | `updateLocalUserGoogleIdentity` | function | 467 |
| 30 | `completeGoogleLogin` | function | 616 |
| 31 | `buildOauthCallbackHtml` | function | 702 |

### 3.38 `backend/.pkg-stage/src/routes/branches.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toDbBool` | function | 13 |
| 2 | `getStockTransferNoteColumn` | function | 21 |
| 3 | `normalizePositiveInt` | function | 25 |
| 4 | `getDefaultBranch` | function | 31 |
| 5 | `getSellableProductWhere` | function | 35 |
| 6 | `buildStockIntegrityPreview` | function | 41 |
| 7 | `buildSqlPlaceholders` | function | 53 |
| 8 | `quoteSqlColumns` | function | 61 |
| 9 | `buildBranchStockWhere` | function | 69 |
| 10 | `hasPagedStockQuery` | function | 93 |

### 3.39 `backend/.pkg-stage/src/routes/catalog.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `collectProductIds` | function | 10 |
| 2 | `buildPlaceholders` | function | 18 |
| 3 | `buildImageMap` | function | 26 |
| 4 | `buildCatalogProductPayloads` | function | 35 |

### 3.40 `backend/.pkg-stage/src/routes/categories.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLookup` | function | 12 |
| 2 | `normalizeColor` | function | 16 |

### 3.41 `backend/.pkg-stage/src/routes/contacts.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLegacyMembershipNumber` | function | 20 |
| 2 | `cleanMembershipNumber` | function | 26 |
| 3 | `requireMembershipNumber` | function | 30 |
| 4 | `assertUniqueMembershipNumber` | function | 36 |
| 5 | `ensureMembershipNumber` | function | 50 |
| 6 | `ensureOrGenerateMembershipNumber` | function | 55 |
| 7 | `generateCustomerMembershipNumber` | function | 61 |
| 8 | `normalizeFieldRule` | function | 75 |
| 9 | `resolveFieldValue` | function | 82 |
| 10 | `buildImportRows` | function | 93 |
| 11 | `buildProvidedImportRows` | function | 103 |
| 12 | `normalizeConflictMode` | function | 112 |
| 13 | `toNumber` | function | 117 |
| 14 | `normalizePositiveInt` | function | 122 |
| 15 | `parseDateFilterParams` | function | 128 |
| 16 | `buildContactListFilters` | function | 152 |
| 17 | `buildSearchHaystack` | function | 176 |
| 18 | `parseScopedIds` | function | 185 |
| 19 | `addPositiveId` | function | 201 |
| 20 | `collectPositiveIds` | function | 208 |
| 21 | `buildSqlPlaceholders` | function | 217 |
| 22 | `loadPointPolicy` | function | 225 |
| 23 | `calculatePolicyPoints` | function | 253 |
| 24 | `wantsExpandedPoints` | function | 258 |
| 25 | `buildCustomerPointSummaries` | function | 263 |
| 26 | `buildCustomerRowMap` | function | 336 |
| 27 | `collectPointSummarySourceIds` | function | 345 |
| 28 | `defaultPointSummary` | function | 356 |
| 29 | `buildPointSummaryList` | function | 367 |
| 30 | `attachPointSummaries` | function | 375 |
| 31 | `collectCustomerIdsFromRows` | function | 387 |
| 32 | `findExisting` | const arrow | 560 |
| 33 | `findExisting` | const arrow | 775 |
| 34 | `findExisting` | const arrow | 969 |

### 3.42 `backend/.pkg-stage/src/routes/customTables.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `humanizeTableName` | function | 13 |
| 2 | `serializeCustomTable` | function | 21 |
| 3 | `sanitizeCustomTableName` | function | 29 |
| 4 | `resolveCustomTableRow` | function | 35 |
| 5 | `escapeIdentifier` | function | 44 |
| 6 | `normalizeCustomTableSchema` | function | 48 |
| 7 | `tableHasColumn` | function | 71 |
| 8 | `ensureCustomTableRowVersioning` | function | 75 |
| 9 | `getWritableCustomTableKeys` | function | 92 |

### 3.43 `backend/.pkg-stage/src/routes/files.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseFileAssetId` | function | 22 |
| 2 | `getFileListFilters` | function | 30 |
| 3 | `getDeviceMeta` | function | 53 |

### 3.44 `backend/.pkg-stage/src/routes/importJobs.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `permissionForImportType` | function | 34 |
| 2 | `requireImportPermission` | function | 42 |
| 3 | `hasAnyImportPermission` | function | 55 |
| 4 | `getPermittedImportTypes` | function | 63 |
| 5 | `requireAnyImportPermission` | function | 71 |
| 6 | `ensureDir` | function | 81 |
| 7 | `getJobUploadRoot` | function | 85 |
| 8 | `getJobOr404` | function | 90 |
| 9 | `serializeJobFile` | function | 99 |
| 10 | `serializeJobFiles` | function | 111 |
| 11 | `saveImageJobFiles` | function | 120 |
| 12 | `isAllowedImportFile` | function | 149 |
| 13 | `parsePolicy` | function | 173 |
| 14 | `parseRelativePaths` | function | 179 |
| 15 | `shouldForceDelete` | function | 190 |
| 16 | `auditImportJobEvent` | function | 195 |

### 3.45 `backend/.pkg-stage/src/routes/inventory.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeImportedTimestamp` | function | 28 |
| 2 | `recalcProductStock` | function | 36 |
| 3 | `findTransferByClientRequestId` | function | 40 |
| 4 | `getStockTransferNoteColumn` | function | 54 |
| 5 | `buildActiveBranchIndex` | function | 58 |
| 6 | `collectSetValues` | function | 73 |
| 7 | `compareInventoryProductRows` | function | 81 |
| 8 | `insertInventoryProductRowSorted` | function | 89 |
| 9 | `collectSortedInventoryProductRows` | function | 97 |
| 10 | `cleanMoveReason` | function | 105 |
| 11 | `normalizePositiveInt` | function | 111 |
| 12 | `hasInventoryStatsFilter` | function | 117 |
| 13 | `cleanInventoryReasonEntry` | function | 125 |
| 14 | `normalizeInventoryReasonList` | function | 139 |
| 15 | `loadSavedInventoryReasons` | function | 161 |
| 16 | `persistSavedInventoryReasons` | function | 172 |
| 17 | `splitSearchTerms` | function | 182 |
| 18 | `normalizeMovementDisplayText` | function | 198 |
| 19 | `sanitizeInventoryResponseProduct` | function | 209 |
| 20 | `appendInventoryProductFilters` | function | 222 |
| 21 | `hydrateInventoryProducts` | function | 278 |
| 22 | `appendAllocationMovementEntries` | function | 301 |
| 23 | `buildInsertColumnSql` | function | 316 |
| 24 | `buildInventoryFinancialJoinSql` | function | 329 |
| 25 | `inventoryFinancialSelectSql` | function | 435 |
| 26 | `getFilteredInventoryStats` | function | 449 |
| 27 | `normalizeRfidId` | function | 1231 |
| 28 | `getRfidSession` | function | 1235 |
| 29 | `getBranchLedgerQty` | function | 1239 |
| 30 | `refreshRfidSessionCounts` | function | 1243 |
| 31 | `upsertRfidSessionItem` | function | 1278 |
| 32 | `recordRfidEvent` | function | 1303 |

### 3.46 `backend/.pkg-stage/src/routes/notifications.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeBoolean` | function | 26 |
| 2 | `toNumber` | function | 34 |
| 3 | `pruneNotificationSummaryCache` | function | 39 |
| 4 | `getNotificationSummaryCacheKey` | function | 47 |
| 5 | `cloneNotificationSummaryPayload` | function | 60 |
| 6 | `getCachedNotificationSummary` | function | 64 |
| 7 | `setCachedNotificationSummary` | function | 73 |
| 8 | `buildPlaceholders` | function | 80 |
| 9 | `rowsToSettingMap` | function | 88 |
| 10 | `joinNotificationSummary` | function | 96 |
| 11 | `loadNotificationPreferences` | function | 104 |
| 12 | `loadPointPolicy` | function | 127 |
| 13 | `calculatePolicyPoints` | function | 152 |
| 14 | `buildInventoryItems` | function | 157 |
| 15 | `buildInventorySection` | function | 186 |
| 16 | `buildExpiryItems` | function | 209 |
| 17 | `buildExpirySection` | function | 229 |
| 18 | `buildSalesItems` | function | 251 |
| 19 | `buildSalesSection` | function | 280 |
| 20 | `rowsByCustomerId` | function | 326 |
| 21 | `buildLoyaltyMatches` | function | 334 |
| 22 | `buildLoyaltyItems` | function | 357 |
| 23 | `buildLoyaltySection` | function | 376 |
| 24 | `buildPortalItems` | function | 435 |
| 25 | `buildPortalSection` | function | 452 |
| 26 | `buildSystemSection` | function | 480 |
| 27 | `sumSectionCounts` | function | 510 |

### 3.47 `backend/.pkg-stage/src/routes/organizations.js`

- No top-level named symbols detected.

### 3.48 `backend/.pkg-stage/src/routes/portal.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `asyncRoute` | function | 24 |
| 2 | `toNumber` | function | 29 |
| 3 | `normalizeBoolean` | function | 35 |
| 4 | `normalizePhone` | function | 41 |
| 5 | `normalizePublicPath` | function | 46 |
| 6 | `normalizeUrl` | function | 60 |
| 7 | `normalizeRedeemValueUsd` | function | 75 |
| 8 | `normalizeRedeemValueKhr` | function | 80 |
| 9 | `normalizeHexColor` | function | 87 |
| 10 | `normalizeFaqItems` | function | 93 |
| 11 | `normalizePortalTranslations` | function | 111 |
| 12 | `normalizeProductIdList` | function | 125 |
| 13 | `loadSettingsMap` | function | 140 |
| 14 | `buildPortalConfig` | function | 150 |
| 15 | `buildRankMap` | function | 276 |
| 16 | `buildEmptyPortalMetric` | function | 297 |
| 17 | `collectPortalSignalRows` | function | 309 |
| 18 | `buildIdRankMap` | function | 322 |
| 19 | `buildRecommendedRankMap` | function | 331 |
| 20 | `getPortalProductSignals` | function | 339 |
| 21 | `buildPlaceholders` | function | 415 |
| 22 | `collectProductIds` | function | 421 |
| 23 | `getPortalProductAssets` | function | 427 |
| 24 | `buildPortalProductPayload` | function | 467 |
| 25 | `buildPortalProductPayloads` | function | 484 |
| 26 | `calculatePointsValue` | function | 493 |
| 27 | `summarizePoints` | function | 503 |
| 28 | `joinWrappedClauses` | function | 543 |
| 29 | `normalizePortalSubmissionRows` | function | 550 |
| 30 | `summarizeMembershipTotals` | function | 562 |
| 31 | `getPortalProducts` | function | 593 |
| 32 | `cacheTtl` | function | 632 |
| 33 | `normalizePositiveInt` | function | 636 |
| 34 | `splitSearchTerms` | function | 642 |
| 35 | `splitFilterValues` | function | 653 |
| 36 | `parsePositiveIds` | function | 664 |
| 37 | `buildNamedPlaceholders` | function | 673 |
| 38 | `appendSearchTermFilters` | function | 681 |
| 39 | `appendNamedFilter` | function | 697 |
| 40 | `normalizeLowerValues` | function | 713 |
| 41 | `appendPortalProductSearchFilters` | function | 719 |
| 42 | `collectRowValues` | function | 759 |
| 43 | `normalizeStringList` | function | 765 |
| 44 | `uniqueSortedStrings` | function | 776 |
| 45 | `getPortalCatalogSearchMetadata` | function | 790 |
| 46 | `distinctField` | const arrow | 795 |
| 47 | `getPortalCatalogProductPage` | function | 819 |
| 48 | `getCachedPortalConfig` | function | 882 |
| 49 | `getCachedPortalMeta` | function | 886 |
| 50 | `getCachedPortalProducts` | function | 890 |
| 51 | `getPortalCatalogMeta` | function | 895 |
| 52 | `findCustomerByMembership` | function | 935 |
| 53 | `sanitizeScreenshots` | function | 945 |
| 54 | `materializePortalScreenshots` | function | 958 |
| 55 | `sanitizeAiProfile` | function | 976 |
| 56 | `hasAiProfilePreference` | function | 987 |
| 57 | `getVisitorFingerprint` | function | 995 |
| 58 | `getClientKey` | function | 1001 |
| 59 | `applyPortalRateLimit` | function | 1006 |
| 60 | `collectRecommendationCitations` | function | 1014 |

### 3.49 `backend/.pkg-stage/src/routes/products.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getActiveBranches` | function | 53 |
| 2 | `settingsHasUpdatedAt` | function | 57 |
| 3 | `getDefaultBranch` | function | 61 |
| 4 | `getBranchById` | function | 70 |
| 5 | `findBranchByName` | function | 77 |
| 6 | `seedBranchRows` | function | 86 |
| 7 | `recalcProductStock` | function | 93 |
| 8 | `normalizeImageGallery` | function | 97 |
| 9 | `syncProductImageGallery` | function | 104 |
| 10 | `loadProductImageMap` | function | 123 |
| 11 | `attachImageGallery` | function | 144 |
| 12 | `findProductByClientRequestId` | function | 162 |
| 13 | `assertUniqueProductFields` | function | 172 |
| 14 | `normalizeProductIdentifier` | function | 220 |
| 15 | `hasOwnField` | function | 225 |
| 16 | `pickField` | function | 229 |
| 17 | `ensureParentProductExists` | function | 233 |
| 18 | `markParentProductAsGroup` | function | 243 |
| 19 | `normalizeImportLookup` | function | 248 |
| 20 | `normalizeLookup` | function | 252 |
| 21 | `collectUniquePositiveIds` | function | 256 |
| 22 | `collectNormalizedTokens` | function | 269 |
| 23 | `collectBoundedValues` | function | 283 |
| 24 | `collectSortedMapValues` | function | 292 |
| 25 | `insertSortedValue` | function | 300 |
| 26 | `normalizeImportFlagValue` | function | 308 |
| 27 | `getProductImportDetailSignature` | function | 341 |
| 28 | `chooseImportParentProduct` | function | 362 |
| 29 | `compareImportParentProduct` | function | 370 |
| 30 | `findImportProductWithSignature` | function | 383 |
| 31 | `normalizeImportAction` | function | 391 |
| 32 | `parseOptionalImportId` | function | 399 |
| 33 | `discountInsertColumns` | function | 406 |
| 34 | `discountValues` | function | 410 |
| 35 | `normalizeExpiryFields` | function | 425 |
| 36 | `normalizeBatchFields` | function | 436 |
| 37 | `seedOpeningBatch` | function | 443 |
| 38 | `normalizePositiveInt` | function | 458 |
| 39 | `parseInclude` | function | 464 |
| 40 | `splitSearchTerms` | function | 468 |
| 41 | `getProductCatalogSnapshotVersion` | function | 472 |
| 42 | `parseBrandOptionsSetting` | function | 485 |
| 43 | `sanitizeProductLookupPayload` | function | 495 |
| 44 | `buildLookupUsageEntries` | function | 508 |
| 45 | `buildLookupUsageSummary` | function | 575 |
| 46 | `appendProductSearchFilters` | function | 604 |
| 47 | `getProductSearchMetadata` | function | 681 |
| 48 | `distinctField` | const arrow | 686 |
| 49 | `attachBranchStock` | function | 717 |
| 50 | `expandProductFamilyRows` | function | 754 |
| 51 | `bindList` | const arrow | 778 |
| 52 | `normalizeLookup` | const arrow | 1510 |
| 53 | `resolveImage` | const arrow | 1620 |
| 54 | `ensureCategory` | const arrow | 1636 |
| 55 | `ensureUnit` | const arrow | 1651 |
| 56 | `ensureBrand` | const arrow | 1666 |
| 57 | `ensureSupplier` | const arrow | 1679 |
| 58 | `determineBranch` | const arrow | 1691 |
| 59 | `handleBranch` | const arrow | 1710 |
| 60 | `resetBatchStock` | const arrow | 1713 |
| 61 | `isDirectImageRef` | const arrow | 1750 |
| 62 | `normalizeDirectImageRef` | const arrow | 1761 |
| 63 | `parseIncomingImageRefs` | const arrow | 1768 |
| 64 | `loadCurrentGallery` | const arrow | 1804 |

### 3.50 `backend/.pkg-stage/src/routes/returns.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `deductBranchStock` | function | 24 |
| 2 | `restoreBranchStock` | function | 32 |
| 3 | `normalizeMovementProductName` | function | 43 |
| 4 | `refreshProductStockQuantity` | function | 54 |
| 5 | `refreshProductStockQuantities` | function | 58 |
| 6 | `normalizeScope` | function | 68 |
| 7 | `toNumber` | function | 76 |
| 8 | `findReturnByClientRequestId` | function | 81 |
| 9 | `assertReturnableItems` | function | 91 |
| 10 | `assertSupplierReturnableStock` | function | 535 |

### 3.51 `backend/.pkg-stage/src/routes/runtime.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createProductFieldCounts` | function | 18 |
| 2 | `collectSuspiciousProductFields` | function | 26 |
| 3 | `summarizeSuspiciousProducts` | function | 36 |
| 4 | `parseJsonArray` | function | 62 |
| 5 | `summarizeSuspiciousTextValues` | function | 71 |
| 6 | `requireRuntimePermission` | function | 91 |

### 3.52 `backend/.pkg-stage/src/routes/sales.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `periodExpression` | function | 30 |
| 2 | `hourExpression` | function | 37 |
| 3 | `toDayBounds` | function | 41 |
| 4 | `readCachedDashboardSummary` | function | 51 |
| 5 | `writeCachedDashboardSummary` | function | 58 |
| 6 | `readCachedDashboardAnalytics` | function | 66 |
| 7 | `writeCachedDashboardAnalytics` | function | 73 |
| 8 | `normalizeImportedTimestamp` | function | 81 |
| 9 | `getSaleItemCosts` | function | 89 |
| 10 | `assertSaleStockAvailable` | function | 115 |
| 11 | `findSaleItemForProduct` | function | 142 |
| 12 | `findCustomerForSaleAssignment` | function | 149 |
| 13 | `parseBranchId` | function | 170 |
| 14 | `getActiveBranchContext` | function | 175 |
| 15 | `requireActiveBranch` | function | 197 |
| 16 | `resolveSaleItemBranchId` | function | 204 |
| 17 | `normalizeSaleItems` | function | 215 |
| 18 | `summarizeSaleBranch` | function | 249 |
| 19 | `refreshProductStockQuantity` | function | 281 |
| 20 | `refreshProductStockQuantities` | function | 285 |
| 21 | `deductBranchStock` | function | 292 |
| 22 | `restoreBranchStock` | function | 300 |
| 23 | `fetchSaleItemsWithBranches` | function | 308 |
| 24 | `findSaleByClientRequestId` | function | 317 |
| 25 | `buildDashboardSummary` | function | 1105 |
| 26 | `buildDashboardAnalytics` | function | 1232 |

### 3.53 `backend/.pkg-stage/src/routes/settings.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLookup` | function | 21 |
| 2 | `normalizeBrandOptionsValue` | function | 25 |
| 3 | `hasSuspiciousCatalogValue` | function | 47 |
| 4 | `normalizeBrandColorMapValue` | function | 54 |
| 5 | `settingsHasUpdatedAt` | function | 83 |
| 6 | `getSettingsSnapshot` | function | 87 |
| 7 | `collectAttemptedSettings` | function | 94 |
| 8 | `getSettingsUpdatedAt` | function | 106 |
| 9 | `parseUpdatedAtMs` | function | 131 |
| 10 | `isExpectedOlderThanCurrent` | function | 145 |

### 3.54 `backend/.pkg-stage/src/routes/sync.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `stableStringify` | function | 47 |
| 2 | `sha256` | function | 65 |
| 3 | `verifyOperationDigest` | function | 69 |
| 4 | `normalizeOperation` | function | 76 |
| 5 | `normalizeOperations` | function | 89 |
| 6 | `hasWriteConflict` | function | 98 |
| 7 | `hasResultCode` | function | 105 |
| 8 | `hasBlockingReplayResult` | function | 112 |
| 9 | `buildReplayUrl` | function | 120 |
| 10 | `replayOperation` | function | 124 |
| 11 | `getUploadDir` | function | 218 |
| 12 | `readManifest` | function | 222 |

### 3.55 `backend/.pkg-stage/src/routes/system/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `auditWithActorMeta` | function | 87 |
| 2 | `q` | function | 105 |
| 3 | `buildSqlPlaceholders` | function | 109 |
| 4 | `joinRemainingImportJobIds` | function | 117 |
| 5 | `collectSystemSettingKeys` | function | 125 |
| 6 | `buildSettingsMap` | function | 133 |
| 7 | `buildSystemSettingEntries` | function | 141 |
| 8 | `sumNumericValues` | function | 149 |
| 9 | `getCustomTableNames` | function | 157 |
| 10 | `broadcastMany` | function | 166 |
| 11 | `dropCustomTables` | function | 172 |
| 12 | `clearTables` | function | 179 |
| 13 | `collectAppliedOperationIds` | function | 185 |
| 14 | `collectSortedSetValues` | function | 193 |
| 15 | `buildFolderEntries` | function | 202 |
| 16 | `buildExistingFavoriteFolders` | function | 214 |
| 17 | `listVisibleDirectories` | function | 226 |
| 18 | `buildPickerScript` | function | 237 |
| 19 | `getClientKey` | function | 252 |
| 20 | `applyRouteRateLimit` | function | 258 |
| 21 | `stopImportsBeforeDestructiveAction` | function | 270 |
| 22 | `runFsWorker` | function | 285 |
| 23 | `finish` | const arrow | 297 |
| 24 | `getHostUiAvailability` | function | 341 |
| 25 | `buildRequestBaseUrl` | function | 350 |
| 26 | `resolveDriveRedirectUri` | function | 357 |
| 27 | `getSafeTableCount` | function | 364 |
| 28 | `buildMigrationTableCounts` | function | 372 |
| 29 | `safeJsonParse` | function | 392 |
| 30 | `readSystemSettings` | function | 401 |
| 31 | `writeSystemSettings` | function | 409 |
| 32 | `getMigrationSafetyBackupDestination` | function | 425 |
| 33 | `getMigrationSafetyState` | function | 429 |
| 34 | `createMigrationSafetyBackup` | function | 451 |
| 35 | `runMigrationSafetyDriveSync` | function | 468 |
| 36 | `runMigrationSafetyAutomation` | function | 506 |
| 37 | `buildScaleMigrationStatus` | function | 521 |
| 38 | `readFinalBackupManifest` | function | 590 |
| 39 | `getDefaultBackupDestinationDir` | function | 594 |
| 40 | `createFolderBackup` | function | 600 |
| 41 | `restoreFolderBackup` | function | 637 |
| 42 | `sendBackupVersions` | function | 1007 |
| 43 | `listWindowsFsRoots` | const arrow | 1510 |
| 44 | `listDriveRoots` | const arrow | 1525 |

### 3.56 `backend/.pkg-stage/src/routes/units.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLookup` | function | 13 |
| 2 | `normalizeUnitColor` | function | 17 |
| 3 | `updateUnitHandler` | function | 52 |

### 3.57 `backend/.pkg-stage/src/routes/users.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isGoogleAuthConfigured` | function | 35 |
| 2 | `getGoogleAuthPublicConfig` | function | 39 |
| 3 | `getClientKey` | function | 53 |
| 4 | `parseJson` | function | 59 |
| 5 | `normalizeLookupText` | function | 67 |
| 6 | `normalizePhoneLookup` | function | 71 |
| 7 | `findUserIdentityConflict` | function | 75 |
| 8 | `getMergedPermissions` | function | 143 |
| 9 | `isPrimaryAdmin` | function | 152 |
| 10 | `hasAdminControl` | function | 159 |
| 11 | `canManageTarget` | function | 172 |
| 12 | `getActorFromRequest` | function | 185 |
| 13 | `requireAdminControl` | function | 192 |
| 14 | `getUserSecurityContext` | function | 205 |
| 15 | `getUserWithRole` | function | 215 |
| 16 | `syncLocalEmailVerification` | function | 230 |
| 17 | `repairGoogleIdentityForUser` | function | 261 |
| 18 | `sanitizeUserRow` | function | 290 |
| 19 | `sanitizeUserRows` | function | 306 |
| 20 | `isValidEmail` | function | 314 |
| 21 | `getAuthIdentityList` | function | 319 |
| 22 | `isUuid` | function | 325 |
| 23 | `resolveAuthIdentityUuid` | function | 329 |
| 24 | `findFirstUuid` | function | 337 |
| 25 | `findProviderIdentity` | function | 344 |
| 26 | `buildAuthMethodsPayload` | function | 352 |

### 3.58 `backend/.pkg-stage/src/runtimeCache.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `enabled` | function | 32 |
| 2 | `namespacedKey` | function | 40 |
| 3 | `getClient` | function | 48 |
| 4 | `getJson` | function | 90 |
| 5 | `setJson` | function | 109 |
| 6 | `getOrSetJson` | function | 129 |
| 7 | `deleteByPrefix` | function | 141 |
| 8 | `deletePrefixesInOrder` | function | 164 |
| 9 | `prefixesForChannel` | function | 176 |
| 10 | `invalidateForChannel` | function | 201 |
| 11 | `pingRuntimeCache` | function | 213 |
| 12 | `getRuntimeCacheStatus` | function | 227 |

### 3.59 `backend/.pkg-stage/src/runtimeState/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ensureRuntimeMetaDir` | function | 16 |
| 2 | `readRuntimeState` | function | 23 |
| 3 | `writeRuntimeState` | function | 44 |
| 4 | `getRuntimeState` | function | 53 |
| 5 | `bumpStorageVersion` | function | 67 |
| 6 | `buildRuntimeDescriptor` | function | 80 |

### 3.60 `backend/.pkg-stage/src/runtimeVersion.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `firstExistingDir` | function | 27 |
| 2 | `collectExistingFiles` | function | 38 |
| 3 | `readGitRevision` | function | 50 |
| 4 | `collectFiles` | function | 70 |
| 5 | `computeSourceHash` | function | 87 |
| 6 | `emptyFrontendBuildInfo` | function | 114 |
| 7 | `readFrontendBuildInfoFromRoot` | function | 126 |
| 8 | `getRuntimeVersion` | function | 165 |

### 3.61 `backend/.pkg-stage/src/schemaMetadata.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeName` | function | 16 |
| 2 | `columnKey` | function | 25 |
| 3 | `normalizeNames` | function | 33 |
| 4 | `normalizeColumnRows` | function | 46 |
| 5 | `candidateKey` | function | 60 |
| 6 | `listColumns` | function | 68 |
| 7 | `hasColumn` | function | 83 |
| 8 | `firstExistingColumn` | function | 108 |
| 9 | `markColumnPresent` | function | 140 |

### 3.62 `backend/.pkg-stage/src/security.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeEncryptionKey` | function | 28 |
| 2 | `isEncryptionConfigured` | function | 48 |
| 3 | `encryptSecret` | function | 52 |
| 4 | `decryptSecret` | function | 65 |
| 5 | `pruneRateBucket` | function | 86 |
| 6 | `keepRecentTimestamps` | function | 98 |
| 7 | `checkRateLimit` | function | 113 |
| 8 | `resetRateLimit` | function | 142 |
| 9 | `safeCompare` | function | 149 |
| 10 | `getAbuseBucket` | function | 160 |
| 11 | `pruneAbuseBucket` | function | 170 |
| 12 | `checkAbuseLock` | function | 188 |
| 13 | `recordAbuseFailure` | function | 211 |
| 14 | `clearAbuseFailure` | function | 235 |

### 3.63 `backend/.pkg-stage/src/serverUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildOriginFromParts` | function | 13 |
| 2 | `parseOriginHost` | function | 24 |
| 3 | `normalizeConfiguredHost` | function | 34 |
| 4 | `getConfiguredPublicHosts` | function | 44 |
| 5 | `getConfiguredCustomerPortalHosts` | function | 55 |
| 6 | `isConfiguredCustomerPortalHost` | function | 67 |
| 7 | `isAllowedRequestOrigin` | function | 77 |
| 8 | `isAllowedWebSocketOrigin` | function | 86 |
| 9 | `hostIsLoopbackPair` | function | 103 |
| 10 | `getTrustedDocumentOrigins` | function | 108 |
| 11 | `addOrigin` | const arrow | 110 |
| 12 | `buildPermissionsPolicy` | function | 139 |
| 13 | `getCloudflareAccessDiagnostics` | function | 166 |
| 14 | `sanitizeObjectKeys` | function | 192 |
| 15 | `sanitizeStringValue` | function | 215 |
| 16 | `sanitizeRequestPayload` | function | 221 |
| 17 | `sanitizeDeepStrings` | function | 228 |
| 18 | `isApiOrHealthPath` | function | 245 |
| 19 | `isSpaFallbackEligible` | function | 249 |
| 20 | `setNoStoreHeaders` | function | 257 |
| 21 | `setHtmlNoCacheHeaders` | function | 263 |
| 22 | `isCustomerPortalRoutePath` | function | 270 |
| 23 | `setTunnelSecurityHeaders` | function | 275 |
| 24 | `setFrontendStaticHeaders` | function | 318 |
| 25 | `setUploadStaticHeaders` | function | 368 |
| 26 | `mapServerError` | function | 378 |

### 3.64 `backend/.pkg-stage/src/services/aiGateway.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 6 |
| 2 | `trim` | function | 10 |
| 3 | `parseJsonSafe` | function | 14 |
| 4 | `clamp` | function | 22 |
| 5 | `maskApiKey` | function | 26 |
| 6 | `normalizeTextList` | function | 33 |
| 7 | `getProviderMeta` | function | 106 |
| 8 | `normalizeProviderPayload` | function | 110 |
| 9 | `serializeProviderRow` | function | 137 |
| 10 | `providerCanUseWebResearch` | function | 170 |
| 11 | `resolveProviderEndpoint` | function | 175 |
| 12 | `buildProviderHttpError` | function | 182 |
| 13 | `host` | const arrow | 185 |
| 14 | `buildGoogleMessageContents` | function | 198 |
| 15 | `joinGoogleTextParts` | function | 209 |
| 16 | `callChatProvider` | function | 218 |
| 17 | `testProviderConfig` | function | 307 |

### 3.65 `backend/.pkg-stage/src/services/backupPackages.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readCachedBackupVersions` | function | 30 |
| 2 | `writeCachedBackupVersions` | function | 39 |
| 3 | `clearBackupVersionCaches` | function | 53 |
| 4 | `getDb` | function | 58 |
| 5 | `q` | function | 62 |
| 6 | `nowSafeId` | function | 66 |
| 7 | `sha256` | function | 70 |
| 8 | `createSha256` | function | 74 |
| 9 | `sha256File` | function | 78 |
| 10 | `readTableRows` | function | 88 |
| 11 | `yieldToEventLoop` | function | 105 |
| 12 | `throwIfAborted` | function | 109 |
| 13 | `collectSetValues` | function | 117 |
| 14 | `startWorkerPromises` | function | 125 |
| 15 | `getManagedWritableState` | function | 133 |
| 16 | `writeStream` | function | 164 |
| 17 | `closeWriteStream` | function | 178 |
| 18 | `handleFinish` | const arrow | 182 |
| 19 | `handleError` | const arrow | 187 |
| 20 | `cleanup` | const arrow | 191 |
| 21 | `createProgressReporter` | function | 201 |
| 22 | `getSafeTableCount` | function | 240 |
| 23 | `streamBackupDataFile` | function | 248 |
| 24 | `buildObjectManifest` | function | 308 |
| 25 | `buildPackageMetadata` | function | 326 |
| 26 | `writeTextFileWithChecksum` | function | 380 |
| 27 | `writeJsonLinesFileWithChecksum` | function | 385 |
| 28 | `uploadPackageFile` | function | 398 |
| 29 | `writeAndUploadMetadataFiles` | function | 418 |
| 30 | `retryOperation` | function | 444 |
| 31 | `writeDestinationChunk` | function | 459 |
| 32 | `endDestination` | function | 472 |
| 33 | `handleFinish` | const arrow | 476 |
| 34 | `handleError` | const arrow | 481 |
| 35 | `cleanup` | const arrow | 485 |
| 36 | `copyOnePackageObject` | function | 495 |
| 37 | `abortCopy` | const arrow | 507 |
| 38 | `copyPackageObjects` | function | 534 |
| 39 | `worker` | function | 543 |
| 40 | `createFinalBackupPackage` | function | 585 |
| 41 | `validateLocalBackupPackage` | function | 700 |
| 42 | `getLocalBackupRoot` | function | 724 |
| 43 | `isDockerReleaseBackupRoot` | function | 729 |
| 44 | `isLocalBackupDirectoryName` | function | 734 |
| 45 | `listLocalBackupDirectories` | function | 740 |
| 46 | `getDirectoryBytes` | function | 761 |
| 47 | `planBackupPackageRetention` | function | 787 |
| 48 | `pruneLocalBackupVersions` | function | 807 |
| 49 | `groupRemoteBackupObjects` | function | 833 |
| 50 | `packageIds` | function | 855 |
| 51 | `summarizeRemovedRemotePackages` | function | 863 |
| 52 | `collectRemoteDeleteKeys` | function | 878 |
| 53 | `sortBackupVersionsByPackageId` | function | 888 |
| 54 | `pruneRemoteBackupVersions` | function | 894 |
| 55 | `pruneBackupVersions` | function | 918 |
| 56 | `readReusableLocalBackupPackage` | function | 935 |
| 57 | `findReusableLocalBackupPackage` | function | 960 |
| 58 | `listLocalBackupVersions` | function | 971 |
| 59 | `listBackupVersions` | function | 1003 |

### 3.66 `backend/.pkg-stage/src/services/firebaseAuth.js`

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

### 3.67 `backend/.pkg-stage/src/services/googleDriveSync/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 80 |
| 2 | `trim` | function | 84 |
| 3 | `toBool` | function | 88 |
| 4 | `clamp` | function | 96 |
| 5 | `escapeDriveQueryValue` | function | 102 |
| 6 | `buildPlaceholders` | function | 106 |
| 7 | `readSettingsMap` | function | 114 |
| 8 | `writeSettingsMap` | function | 125 |
| 9 | `clearDriveSyncMappings` | function | 147 |
| 10 | `resetDriveSyncRootState` | function | 151 |
| 11 | `getDriveSyncConfig` | function | 161 |
| 12 | `getDriveSyncEntriesMap` | function | 197 |
| 13 | `hasCanonicalDriveLayout` | function | 210 |
| 14 | `upsertDriveSyncEntry` | function | 218 |
| 15 | `deleteDriveSyncEntry` | function | 255 |
| 16 | `deleteDriveSyncEntriesUnder` | function | 259 |
| 17 | `inferMimeType` | function | 266 |
| 18 | `hashFile` | function | 281 |
| 19 | `hashFileMany` | function | 291 |
| 20 | `yieldToEventLoop` | function | 315 |
| 21 | `sleep` | function | 319 |
| 22 | `buildAccessTokenKey` | function | 323 |
| 23 | `clearCachedAccessToken` | function | 330 |
| 24 | `describeFetchFailure` | function | 337 |
| 25 | `joinNonEmptyParts` | function | 351 |
| 26 | `fetchWithTimeout` | function | 359 |
| 27 | `exchangeRefreshToken` | function | 386 |
| 28 | `exchangeAuthorizationCode` | function | 428 |
| 29 | `driveApiRequest` | function | 451 |
| 30 | `driveApiUpload` | function | 468 |
| 31 | `fetchDriveUserProfile` | function | 484 |
| 32 | `findDriveItem` | function | 499 |
| 33 | `findDriveItems` | function | 504 |
| 34 | `listDriveChildren` | function | 519 |
| 35 | `getDriveFileIfExists` | function | 528 |
| 36 | `removeDuplicateDriveItems` | function | 540 |
| 37 | `buildSortedDirectoryList` | function | 552 |
| 38 | `getNonFolderDriveItems` | function | 561 |
| 39 | `getFirstNonFolderDriveItem` | function | 571 |
| 40 | `buildLiveSyncPathSet` | function | 578 |
| 41 | `selectStaleDriveMappings` | function | 589 |
| 42 | `createDriveFolder` | function | 598 |
| 43 | `ensureRootFolder` | function | 610 |
| 44 | `ensureDriveVersionFolder` | function | 629 |
| 45 | `writeSnapshotManifest` | function | 676 |
| 46 | `buildManagedSnapshotRoot` | function | 710 |
| 47 | `ensureSnapshotLayout` | function | 714 |
| 48 | `shouldSkipSnapshotFile` | function | 720 |
| 49 | `createDataRootSnapshot` | function | 727 |
| 50 | `collectSnapshotItems` | function | 769 |
| 51 | `ensureRemoteDirectories` | function | 819 |
| 52 | `updateRuntimeUploadProgress` | function | 870 |
| 53 | `clearRuntimeUploadProgress` | function | 877 |
| 54 | `initiateDriveResumableSession` | function | 884 |
| 55 | `queryResumableOffset` | function | 912 |
| 56 | `isInvalidUploadRequest` | function | 940 |
| 57 | `isDriveNotFoundError` | function | 944 |
| 58 | `isDriveWriteAccessError` | function | 948 |
| 59 | `canRecoverDriveItemWrite` | function | 956 |
| 60 | `putResumableChunk` | function | 960 |
| 61 | `uploadDriveFileResumable` | function | 995 |
| 62 | `uploadDriveFile` | function | 1069 |
| 63 | `updateDriveFile` | function | 1074 |
| 64 | `removeDriveFile` | function | 1079 |
| 65 | `runDriveSync` | function | 1091 |
| 66 | `runDriveSyncInternal` | function | 1102 |
| 67 | `scheduleDriveSync` | function | 1341 |
| 68 | `getDriveSyncStatus` | function | 1363 |
| 69 | `beginGoogleDriveOAuth` | function | 1412 |
| 70 | `prunePendingOauthStates` | function | 1436 |
| 71 | `finalizeGoogleDriveOAuth` | function | 1443 |
| 72 | `saveDriveSyncPreferences` | function | 1486 |
| 73 | `disconnectDriveSync` | function | 1507 |
| 74 | `forgetDriveSyncCredentials` | function | 1527 |
| 75 | `schedulePeriodicDriveSync` | function | 1535 |

### 3.68 `backend/.pkg-stage/src/services/googleDriveSync/versioning.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toSafeDate` | function | 25 |
| 2 | `toSafeVersionNumber` | function | 30 |
| 3 | `resolveDriveSyncVersionState` | function | 36 |
| 4 | `parseVersionName` | function | 75 |
| 5 | `buildDriveSyncVersionRows` | function | 81 |
| 6 | `selectDateExpiredVersions` | function | 101 |
| 7 | `selectExpiredDriveSyncVersions` | function | 113 |

### 3.69 `backend/.pkg-stage/src/services/googleOauth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 27 |
| 2 | `unique` | function | 31 |
| 3 | `appendCallbackPath` | function | 43 |
| 4 | `getGoogleLoginOrigins` | function | 53 |
| 5 | `getGoogleLoginRedirectUris` | function | 62 |
| 6 | `getPrimaryRedirectUri` | function | 70 |
| 7 | `getDefaultReturnPath` | function | 74 |
| 8 | `normalizeReturnTarget` | function | 80 |
| 9 | `base64url` | function | 117 |
| 10 | `sha256Base64Url` | function | 122 |
| 11 | `getStateSecret` | function | 126 |
| 12 | `signState` | function | 130 |
| 13 | `verifyState` | function | 136 |
| 14 | `getGoogleLoginPublicConfig` | function | 152 |
| 15 | `buildGoogleOauthStartUrl` | function | 165 |
| 16 | `exchangeGoogleOauthCode` | function | 196 |
| 17 | `getGoogleUserFromTokens` | function | 219 |

### 3.70 `backend/.pkg-stage/src/services/importJobs.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 65 |
| 2 | `wait` | function | 69 |
| 3 | `yieldImportWorker` | function | 73 |
| 4 | `countCsvRowsFromFile` | function | 78 |
| 5 | `safeJson` | function | 123 |
| 6 | `normalizeImportJobListLimit` | function | 128 |
| 7 | `clearImportJobListCache` | function | 132 |
| 8 | `readCachedImportJobList` | function | 136 |
| 9 | `canCacheImportJobList` | function | 144 |
| 10 | `writeCachedImportJobList` | function | 148 |
| 11 | `stringify` | function | 161 |
| 12 | `cleanAuditActorText` | function | 165 |
| 13 | `normalizeAuditActor` | function | 171 |
| 14 | `attachInternalPolicyMetadata` | function | 181 |
| 15 | `stripInternalPolicyMetadata` | function | 192 |
| 16 | `getPersistedAuditActor` | function | 198 |
| 17 | `mergeAuditActors` | function | 203 |
| 18 | `auditWithActor` | function | 213 |
| 19 | `decorateImportJobRow` | function | 231 |
| 20 | `isCancelRequested` | function | 241 |
| 21 | `isImportJobStale` | function | 248 |
| 22 | `isImportJobWorkDrained` | function | 254 |
| 23 | `markStoredImportFilesCancelled` | function | 266 |
| 24 | `reconcileImportJobRow` | function | 276 |
| 25 | `ensureDir` | function | 297 |
| 26 | `ensureImportRoot` | function | 301 |
| 27 | `getJobRoot` | function | 305 |
| 28 | `assertSafeImportPath` | function | 309 |
| 29 | `deleteImportJobFiles` | function | 318 |
| 30 | `clearImportRuntimeFiles` | function | 325 |
| 31 | `createImportJob` | function | 336 |
| 32 | `getImportJob` | function | 357 |
| 33 | `buildSqlPlaceholders` | function | 363 |
| 34 | `collectRowIds` | function | 371 |
| 35 | `decorateImportJobRows` | function | 379 |
| 36 | `listImportJobs` | function | 388 |
| 37 | `updateJob` | function | 421 |
| 38 | `addJobError` | function | 457 |
| 39 | `getJobErrors` | function | 464 |
| 40 | `normalizeReviewText` | function | 474 |
| 41 | `normalizeReviewIdentifier` | function | 478 |
| 42 | `getBarcodeReviewIssue` | function | 482 |
| 43 | `isBlockingBarcodeIssue` | function | 499 |
| 44 | `buildProductImportReviewState` | function | 503 |
| 45 | `add` | const arrow | 507 |
| 46 | `duplicateGroupCount` | const arrow | 520 |
| 47 | `hasReviewQueryMatch` | function | 537 |
| 48 | `normalizeReviewFilter` | function | 557 |
| 49 | `matchesReviewFilter` | function | 565 |
| 50 | `hasAnyIdentifierField` | function | 573 |
| 51 | `buildProductReviewLabels` | function | 580 |
| 52 | `buildContactReviewLabels` | function | 604 |
| 53 | `hasMeaningfulImportRowValue` | function | 613 |
| 54 | `addReviewConflictCounts` | function | 621 |
| 55 | `normalizeGroupDecisions` | function | 635 |
| 56 | `addSetValues` | function | 645 |
| 57 | `setValuesToArray` | function | 651 |
| 58 | `firstRowNumber` | function | 659 |
| 59 | `buildProductReviewIndex` | function | 663 |
| 60 | `getProductConflictForReview` | function | 690 |
| 61 | `getReviewRowNumber` | function | 773 |
| 62 | `summarizeImportReviewRow` | function | 778 |
| 63 | `addProductReviewGroup` | function | 798 |
| 64 | `finalizeProductReviewSubgroups` | function | 843 |
| 65 | `finalizeProductReviewGroups` | function | 868 |
| 66 | `buildContactReviewIndex` | function | 890 |
| 67 | `getContactConflictForReview` | function | 910 |
| 68 | `getGenericImportConflictForReview` | function | 956 |
| 69 | `applyImportDecisionToRow` | function | 969 |
| 70 | `getImportDecisionMap` | function | 1037 |
| 71 | `getImportJobReview` | function | 1046 |
| 72 | `updateImportJobDecisions` | function | 1146 |
| 73 | `addJobFile` | function | 1174 |
| 74 | `getJobFiles` | function | 1194 |
| 75 | `markJobCancelled` | function | 1199 |
| 76 | `isCancelled` | function | 1203 |
| 77 | `waitForQueuedImportMedia` | function | 1209 |
| 78 | `finalizeSkippedImportImages` | function | 1236 |
| 79 | `normalizeLookup` | function | 1253 |
| 80 | `normalizeText` | function | 1257 |
| 81 | `getMimeTypeFromName` | function | 1261 |
| 82 | `normalizeProductSignature` | function | 1329 |
| 83 | `findProductWithSignature` | function | 1340 |
| 84 | `chooseParentProduct` | function | 1348 |
| 85 | `compareParentProductCandidate` | function | 1357 |
| 86 | `normalizeImportAction` | function | 1369 |
| 87 | `parseOptionalImportId` | function | 1377 |
| 88 | `parseIncomingImageRefs` | function | 1382 |
| 89 | `syncProductImageGallery` | function | 1413 |
| 90 | `loadCurrentGallery` | function | 1439 |
| 91 | `ensureParentProductExists` | function | 1451 |
| 92 | `assertUniqueProductFields` | function | 1460 |
| 93 | `findProductIdentifierConflict` | function | 1503 |
| 94 | `normalizeIdentifierConflictMode` | function | 1533 |
| 95 | `resolveNewProductIdentifiers` | function | 1541 |
| 96 | `copyImageIntoAssets` | function | 1578 |
| 97 | `resolveImageGallery` | function | 1617 |
| 98 | `ensureSettingOptionMap` | function | 1673 |
| 99 | `buildLookupMap` | function | 1692 |
| 100 | `getDefaultBranch` | function | 1700 |
| 101 | `upsertSettingJson` | function | 1709 |
| 102 | `normalizeRowForProduct` | function | 1716 |
| 103 | `createProductContext` | function | 1764 |
| 104 | `sortProductImportRows` | function | 1793 |
| 105 | `compareProductImportRows` | function | 1801 |
| 106 | `insertProductImportRow` | function | 1811 |
| 107 | `getProductsByNameForImport` | function | 1828 |
| 108 | `rememberProductForImport` | function | 1843 |
| 109 | `buildImportSignatureKey` | function | 1850 |
| 110 | `ensureCategory` | function | 1856 |
| 111 | `ensureUnit` | function | 1869 |
| 112 | `ensureBrand` | function | 1881 |
| 113 | `ensureSupplier` | function | 1894 |
| 114 | `determineBranch` | function | 1908 |
| 115 | `clearBranchBatchStockForProduct` | function | 1925 |
| 116 | `handleBranchStock` | function | 1936 |
| 117 | `recalcProductStock` | function | 1953 |
| 118 | `insertInventoryMovement` | function | 1957 |
| 119 | `seedBranchRows` | function | 1985 |
| 120 | `processProductRow` | function | 1992 |
| 121 | `processProductRowBatches` | function | 2282 |
| 122 | `flushProgress` | const arrow | 2294 |
| 123 | `processProductRows` | function | 2395 |
| 124 | `buildSafeCatalogOptionList` | function | 2405 |
| 125 | `preflightImportJob` | function | 2414 |
| 126 | `addFailure` | const arrow | 2428 |
| 127 | `buildImageLookup` | function | 2521 |
| 128 | `addImageLookupCandidate` | function | 2531 |
| 129 | `normalizeImageMatchKey` | function | 2536 |
| 130 | `processImageOnlyFiles` | function | 2546 |
| 131 | `addImageProductKey` | function | 2607 |
| 132 | `normalizeContactMode` | function | 2612 |
| 133 | `resolveContactValue` | function | 2617 |
| 134 | `parseFieldRules` | function | 2625 |
| 135 | `generateCustomerMembershipNumber` | function | 2631 |
| 136 | `normalizeImportedMembershipNumber` | function | 2647 |
| 137 | `processContactRowBatches` | function | 2653 |
| 138 | `processContactRows` | function | 2822 |
| 139 | `normalizeInventoryAction` | function | 2832 |
| 140 | `addCsvLookupValue` | function | 2839 |
| 141 | `buildProductCsvLookupMap` | function | 2845 |
| 142 | `buildBranchCsvLookupMap` | function | 2856 |
| 143 | `processInventoryRowBatches` | function | 2865 |
| 144 | `processInventoryRows` | function | 2955 |
| 145 | `processSalesRowBatches` | function | 2964 |
| 146 | `processSalesRows` | function | 3167 |
| 147 | `extractZipImages` | function | 3176 |
| 148 | `processImportJob` | function | 3246 |
| 149 | `runLocalJob` | function | 3384 |
| 150 | `normalizeQueueMode` | function | 3391 |
| 151 | `queueNameForMode` | function | 3395 |
| 152 | `configuredQueueDriver` | function | 3399 |
| 153 | `getImportQueueConcurrency` | function | 3404 |
| 154 | `hasBullProducer` | function | 3408 |
| 155 | `hasBullWorkers` | function | 3412 |
| 156 | `removeQueuedBullJobsForImport` | function | 3416 |
| 157 | `getBullConnection` | function | 3439 |
| 158 | `initializeBullQueue` | function | 3452 |
| 159 | `startImportWorkers` | function | 3471 |
| 160 | `startWorker` | const arrow | 3478 |
| 161 | `enqueueImportJob` | function | 3514 |
| 162 | `resetImportJobForRetry` | function | 3557 |
| 163 | `cancelImportJob` | function | 3610 |
| 164 | `listCancellableImportJobs` | function | 3643 |
| 165 | `waitForImportJobsToStop` | function | 3652 |
| 166 | `cancelAllImportJobs` | function | 3680 |
| 167 | `deleteImportJob` | function | 3712 |
| 168 | `deleteAllImportJobs` | function | 3743 |
| 169 | `approveImportJob` | function | 3760 |
| 170 | `recoverImportJobs` | function | 3784 |
| 171 | `getUnprocessedJobFiles` | function | 3806 |
| 172 | `getQueueStatus` | function | 3814 |
| 173 | `buildErrorsCsv` | function | 3831 |
| 174 | `escape` | const arrow | 3833 |
| 175 | `joinEscapedCsvRow` | function | 3846 |

### 3.71 `backend/.pkg-stage/src/services/integrationDoctor.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 44 |
| 2 | `hasValue` | function | 48 |
| 3 | `redactPresence` | function | 52 |
| 4 | `status` | function | 59 |
| 5 | `allCriticalChecksOk` | function | 67 |
| 6 | `unique` | function | 80 |
| 7 | `buildExpectedOauthChecklist` | function | 92 |
| 8 | `probeDatabase` | function | 120 |
| 9 | `getSafeTableCount` | function | 130 |
| 10 | `readCurrentBusinessCounts` | function | 139 |
| 11 | `findLatestVerifiedReleaseBackup` | function | 153 |
| 12 | `probeQueue` | function | 178 |
| 13 | `probeBackups` | function | 199 |
| 14 | `buildIntegrationDoctor` | function | 216 |

### 3.72 `backend/.pkg-stage/src/services/mediaQueue.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `wait` | function | 19 |
| 2 | `queueDriverRequired` | function | 23 |
| 3 | `isImportJobCancelled` | function | 27 |
| 4 | `getMediaConnection` | function | 34 |
| 5 | `initializeMediaQueue` | function | 47 |
| 6 | `processMediaOptimizationJob` | function | 65 |
| 7 | `runLocalMediaJob` | function | 119 |
| 8 | `enqueueMediaOptimization` | function | 131 |
| 9 | `startMediaWorker` | function | 157 |
| 10 | `getMediaQueueStatus` | function | 181 |

### 3.73 `backend/.pkg-stage/src/services/portalAi.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 15 |
| 2 | `toNumber` | function | 19 |
| 3 | `tokenize` | function | 24 |
| 4 | `nowMs` | function | 36 |
| 5 | `getProviderPriority` | function | 40 |
| 6 | `getProviderCapacity` | function | 45 |
| 7 | `getProviderMaxInputChars` | function | 50 |
| 8 | `getProviderMaxCompletionTokens` | function | 55 |
| 9 | `getProviderTimeoutMs` | function | 60 |
| 10 | `getProviderCooldownMs` | function | 65 |
| 11 | `getRuntimeState` | function | 71 |
| 12 | `pruneProviderState` | function | 86 |
| 13 | `keepRecentTimestamps` | function | 92 |
| 14 | `pruneVisitorActivity` | function | 100 |
| 15 | `registerVisitorActivity` | function | 108 |
| 16 | `countActiveVisitors` | function | 118 |
| 17 | `getVisitorMinuteCount` | function | 123 |
| 18 | `summarizeProfile` | function | 130 |
| 19 | `sanitizeQuestion` | function | 140 |
| 20 | `scoreProduct` | function | 144 |
| 21 | `buildQueryTermSet` | function | 176 |
| 22 | `productMatchesPreference` | function | 185 |
| 23 | `toPromptCandidate` | function | 195 |
| 24 | `selectCandidateProducts` | function | 212 |
| 25 | `buildPrompt` | function | 236 |
| 26 | `takeTrimmedStrings` | function | 266 |
| 27 | `normalizeCitations` | function | 277 |
| 28 | `buildRecommendationPayloads` | function | 293 |
| 29 | `parseAssistantPayload` | function | 322 |
| 30 | `listEnabledChatProviders` | function | 351 |
| 31 | `chooseProviderForAttempt` | function | 373 |
| 32 | `markProviderStart` | function | 395 |
| 33 | `markProviderSuccess` | function | 403 |
| 34 | `markProviderFailure` | function | 410 |
| 35 | `sumProviderCapacity` | function | 418 |
| 36 | `buildProviderUsageItems` | function | 426 |
| 37 | `getPortalAiUsageStatus` | function | 445 |
| 38 | `minProviderInputChars` | function | 460 |
| 39 | `hasAnyProfileValue` | function | 468 |
| 40 | `productsById` | function | 475 |
| 41 | `remainingProviders` | function | 483 |
| 42 | `generatePortalAiResponse` | function | 491 |

### 3.74 `backend/.pkg-stage/src/services/verification.js`

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

### 3.75 `backend/.pkg-stage/src/sessionAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDb` | function | 14 |
| 2 | `hashToken` | function | 18 |
| 3 | `buildSessionExpiry` | function | 22 |
| 4 | `createAuthSession` | function | 38 |
| 5 | `isSecureRequest` | function | 59 |
| 6 | `buildSessionCookieOptions` | function | 69 |
| 7 | `setAuthSessionCookie` | function | 79 |
| 8 | `clearAuthSessionCookie` | function | 85 |
| 9 | `buildRevocationTimestamp` | function | 95 |
| 10 | `getPresentedSessionToken` | function | 100 |
| 11 | `getSessionUser` | function | 112 |
| 12 | `revokeAuthSession` | function | 175 |
| 13 | `revokeUserSessions` | function | 187 |

### 3.76 `backend/.pkg-stage/src/settingsSnapshot.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeUploadPublicPath` | function | 16 |
| 2 | `isUploadPublicPath` | function | 33 |
| 3 | `toUploadObjectKey` | function | 41 |
| 4 | `sanitizeMediaPath` | function | 52 |
| 5 | `sanitizeMediaPathAsync` | function | 65 |
| 6 | `sanitizeMediaList` | function | 84 |
| 7 | `sanitizeMediaListAsync` | function | 101 |
| 8 | `uploadPublicPathExists` | function | 117 |
| 9 | `sanitizeSettingValue` | function | 132 |
| 10 | `sanitizeSettingValueAsync` | function | 140 |
| 11 | `sanitizeSettingsSnapshot` | function | 147 |
| 12 | `sanitizeSettingsSnapshotAsync` | function | 158 |

### 3.77 `backend/.pkg-stage/src/storage/organizationFolders.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 7 |
| 2 | `sanitizeOrganizationFolderLabel` | function | 12 |
| 3 | `buildOrganizationFolderName` | function | 23 |
| 4 | `extractOrganizationPublicId` | function | 30 |
| 5 | `findOrganizationFolderByPublicId` | function | 38 |

### 3.78 `backend/.pkg-stage/src/systemFsWorker.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatBackupStamp` | function | 23 |
| 2 | `pad` | const arrow | 25 |
| 3 | `respond` | function | 33 |
| 4 | `fail` | function | 41 |
| 5 | `runExportFolder` | function | 50 |
| 6 | `runRelocateDataRoot` | function | 94 |
| 7 | `main` | function | 104 |

### 3.79 `backend/.pkg-stage/src/systemJobs.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 12 |
| 2 | `makeJobId` | function | 16 |
| 3 | `publicJob` | function | 20 |
| 4 | `findActiveJob` | function | 44 |
| 5 | `safeJsonParse` | function | 55 |
| 6 | `getDb` | function | 64 |
| 7 | `ensureTable` | function | 68 |
| 8 | `persistJob` | function | 124 |
| 9 | `collectFinishedJobs` | function | 171 |
| 10 | `removeOldFinishedJobs` | function | 182 |
| 11 | `serializeJobRows` | function | 188 |
| 12 | `listActiveJobs` | function | 198 |
| 13 | `cleanupJobs` | function | 207 |
| 14 | `buildPersistSignature` | function | 224 |
| 15 | `markPersisted` | function | 239 |
| 16 | `flushPersistJob` | function | 244 |
| 17 | `shouldPersistJob` | function | 256 |
| 18 | `schedulePersistJob` | function | 274 |
| 19 | `updateJob` | function | 285 |
| 20 | `SystemJobCancelledError` | class | 302 |
| 21 | `startSystemJob` | function | 310 |
| 22 | `runWorker` | const arrow | 339 |
| 23 | `isCancelled` | const arrow | 358 |
| 24 | `throwIfCancelled` | const arrow | 359 |
| 25 | `progress` | const arrow | 362 |
| 26 | `cancelSystemJob` | function | 415 |
| 27 | `getSystemJob` | function | 432 |
| 28 | `listSystemJobs` | function | 444 |

### 3.80 `backend/.pkg-stage/src/uploadReferenceCleanup.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `safeJsonArray` | function | 13 |
| 2 | `repairMissingUploadReferences` | function | 22 |
| 3 | `repairMissingUploadReferencesAsync` | function | 134 |

### 3.81 `backend/.pkg-stage/src/uploadSecurity.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `bufferStartsWith` | function | 16 |
| 2 | `isLikelyCsvBuffer` | function | 26 |
| 3 | `detectBufferKind` | function | 42 |
| 4 | `getExpectedUploadedKind` | function | 63 |
| 5 | `validateImageMetadata` | function | 75 |
| 6 | `validateUploadedBuffer` | function | 93 |
| 7 | `validateUploadedPath` | function | 108 |

### 3.82 `backend/.pkg-stage/src/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `attachWss` | function | 24 |

### 3.83 `backend/.pkg-stage/src/workers/importWorker.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `start` | function | 13 |
| 2 | `shutdown` | function | 23 |

### 3.84 `backend/.pkg-stage/src/workers/mediaWorker.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `start` | function | 13 |
| 2 | `shutdown` | function | 22 |

### 3.85 `backend/server.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `startRequestedWorkerRole` | function | 6 |
| 2 | `listFrontendAssetFiles` | function | 157 |
| 3 | `resolveFrontendAssetPath` | function | 168 |
| 4 | `resolveFrontendChunkAssetName` | function | 192 |
| 5 | `getSpaModulePreloadChunks` | function | 222 |
| 6 | `appendLinkHeader` | function | 233 |
| 7 | `appendSpaModulePreloadHeaders` | function | 242 |
| 8 | `resolveFrontendStyleAssetNames` | function | 251 |
| 9 | `appendSpaStylePreloadHeaders` | function | 271 |
| 10 | `resolveFrontendPublicFontPreloadAssetNames` | function | 278 |
| 11 | `appendPublicFontPreloadHeaders` | function | 289 |
| 12 | `normalizePublicSpaHtmlTtl` | function | 294 |
| 13 | `setPublicSpaHtmlCacheHeaders` | function | 297 |
| 14 | `isPublicSpaRoutePath` | function | 305 |
| 15 | `escapeInlineJson` | function | 309 |
| 16 | `injectPublicPortalBootstrap` | function | 317 |
| 17 | `injectAdminAuthBootstrap` | function | 325 |
| 18 | `readAdminSpaTemplate` | function | 336 |
| 19 | `sendPublicSpaIndex` | function | 346 |
| 20 | `sendAdminSpaIndex` | function | 372 |
| 21 | `sendSpaIndex` | function | 396 |
| 22 | `loadCompressionMiddleware` | function | 411 |
| 23 | `applySecurityHeaders` | function | 420 |
| 24 | `applyRequestPolicy` | function | 425 |
| 25 | `applyCoreMiddleware` | function | 434 |
| 26 | `normalizeUploadFileName` | function | 448 |
| 27 | `getSafeActiveUploadPath` | function | 455 |
| 28 | `findBackupUploadFallback` | function | 465 |
| 29 | `inferUploadContentType` | function | 519 |
| 30 | `serveLocalUpload` | function | 535 |
| 31 | `getObjectStreamWithTimeout` | function | 552 |
| 32 | `mountStaticAssets` | function | 567 |
| 33 | `mountHealthRoute` | function | 646 |
| 34 | `mountApiRoutes` | function | 674 |
| 35 | `mountTransfersAlias` | function | 709 |
| 36 | `mountSpaFallback` | function | 723 |
| 37 | `mountErrorHandler` | function | 740 |
| 38 | `getStartupBanner` | function | 753 |
| 39 | `closeDatabase` | function | 776 |
| 40 | `startDatabaseMaintenanceTimer` | function | 787 |
| 41 | `registerShutdownHandlers` | function | 795 |
| 42 | `bootstrapServer` | function | 809 |

### 3.86 `backend/server.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `startRequestedWorkerRole` | function | 3 |
| 2 | `listFrontendAssetFiles` | function | 188 |
| 3 | `resolveFrontendAssetPath` | function | 198 |
| 4 | `resolveFrontendChunkAssetName` | function | 219 |
| 5 | `getSpaModulePreloadChunks` | function | 248 |
| 6 | `appendLinkHeader` | function | 260 |
| 7 | `appendSpaModulePreloadHeaders` | function | 270 |
| 8 | `resolveFrontendStyleAssetNames` | function | 279 |
| 9 | `appendSpaStylePreloadHeaders` | function | 297 |
| 10 | `resolveFrontendPublicFontPreloadAssetNames` | function | 304 |
| 11 | `appendPublicFontPreloadHeaders` | function | 314 |
| 12 | `normalizePublicSpaHtmlTtl` | function | 320 |
| 13 | `setPublicSpaHtmlCacheHeaders` | function | 324 |
| 14 | `isPublicSpaRoutePath` | function | 333 |
| 15 | `escapeInlineJson` | function | 338 |
| 16 | `injectPublicPortalBootstrap` | function | 347 |
| 17 | `injectAdminAuthBootstrap` | function | 355 |
| 18 | `readAdminSpaTemplate` | function | 366 |
| 19 | `sendPublicSpaIndex` | function | 377 |
| 20 | `sendAdminSpaIndex` | function | 405 |
| 21 | `sendSpaIndex` | function | 427 |
| 22 | `loadCompressionMiddleware` | function | 443 |
| 23 | `applySecurityHeaders` | function | 452 |
| 24 | `applyRequestPolicy` | function | 458 |
| 25 | `applyCoreMiddleware` | function | 468 |
| 26 | `normalizeUploadFileName` | function | 482 |
| 27 | `getSafeActiveUploadPath` | function | 490 |
| 28 | `findBackupUploadFallback` | function | 499 |
| 29 | `inferUploadContentType` | function | 545 |
| 30 | `serveLocalUpload` | function | 556 |
| 31 | `getObjectStreamWithTimeout` | function | 573 |
| 32 | `mountStaticAssets` | function | 587 |
| 33 | `mountHealthRoute` | function | 654 |
| 34 | `mountApiRoutes` | function | 683 |
| 35 | `mountTransfersAlias` | function | 721 |
| 36 | `mountSpaFallback` | function | 736 |
| 37 | `mountErrorHandler` | function | 754 |
| 38 | `getStartupBanner` | function | 768 |
| 39 | `closeDatabase` | function | 793 |
| 40 | `startDatabaseMaintenanceTimer` | function | 803 |
| 41 | `registerShutdownHandlers` | function | 811 |
| 42 | `bootstrapServer` | function | 828 |

### 3.87 `backend/src/accessControl.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 45 |
| 2 | `normalizeHostname` | function | 49 |
| 3 | `getConfiguredSyncToken` | function | 55 |
| 4 | `getRemoteAccessProvider` | function | 59 |
| 5 | `isLegacyTailscaleEnabled` | function | 63 |
| 6 | `getRequestHost` | function | 70 |
| 7 | `getRemoteAddress` | function | 79 |
| 8 | `isLoopbackAddress` | function | 87 |
| 9 | `getPresentedSyncToken` | function | 97 |
| 10 | `getTailscaleIdentity` | function | 106 |
| 11 | `hasTrustedTailscaleIdentity` | function | 118 |
| 12 | `isLocalHostRequest` | function | 129 |
| 13 | `isTsNetHost` | function | 134 |
| 14 | `getConfiguredTailscaleHost` | function | 139 |
| 15 | `isPublicRemoteRequest` | function | 146 |
| 16 | `isPublicApiRequest` | function | 157 |
| 17 | `classifyRequestAccess` | function | 170 |
| 18 | `authorizeProtectedRequest` | function | 202 |

### 3.88 `backend/src/analytics/duckdbRuntime.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `tryRequireDuckDbPackage` | function | 30 |
| 2 | `probeDuckDbPackage` | function | 44 |
| 3 | `getDuckDbRuntimeStatus` | function | 74 |

### 3.89 `backend/src/authOtpGuards.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeUserId` | function | 6 |
| 2 | `canManageOtpTarget` | function | 12 |
| 3 | `requiresSelfOtpDisablePassword` | function | 23 |

### 3.90 `backend/src/backupSchema.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `countRowsByTable` | function | 102 |
| 2 | `countCustomTableRows` | function | 114 |
| 3 | `buildBackupSummary` | function | 125 |
| 4 | `buildBackupSummaryFromCounts` | function | 133 |

### 3.91 `backend/src/businessMetrics.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sellableProductWhere` | function | 14 |
| 2 | `effectiveCostExpr` | function | 25 |
| 3 | `stockQuantityExpr` | function | 34 |
| 4 | `normalizeMetricRow` | function | 41 |
| 5 | `getStockMetrics` | function | 56 |
| 6 | `getLowStockProducts` | function | 94 |
| 7 | `getOutOfStockProducts` | function | 111 |
| 8 | `getStockAlertProducts` | function | 127 |
| 9 | `getExpiringProducts` | function | 152 |

### 3.92 `backend/src/catalogTextIntegrity.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeCatalogText` | function | 16 |
| 2 | `hasSuspiciousCatalogText` | function | 31 |
| 3 | `listSuspiciousCatalogFields` | function | 46 |
| 4 | `assertCatalogTextIntegrity` | function | 63 |
| 5 | `normalizeOptionList` | function | 73 |

### 3.93 `backend/src/config/index.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildEnvCandidates` | function | 25 |
| 2 | `isDefaultDataMarker` | function | 54 |
| 3 | `resolveStoredDataDir` | function | 59 |
| 4 | `normalizeSelectedDataDir` | function | 66 |
| 5 | `readDataLocation` | function | 78 |
| 6 | `writeDataLocation` | function | 89 |
| 7 | `ensureDirectory` | function | 105 |
| 8 | `readSecretFileValue` | function | 109 |
| 9 | `ensureOrganizationRuntimeLayout` | function | 121 |
| 10 | `normalizeOrganizationSeed` | function | 128 |
| 11 | `STORAGE_ROOT` | const arrow | 135 |

### 3.94 `backend/src/conflictControl.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `WriteConflictError` | class | 8 |
| 2 | `normalizeUpdatedAt` | function | 32 |
| 3 | `getExpectedUpdatedAt` | function | 41 |
| 4 | `assertUpdatedAtMatch` | function | 56 |
| 5 | `sendWriteConflict` | function | 73 |
| 6 | `sendSettingsConflict` | function | 93 |

### 3.95 `backend/src/contactOptions.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cleanText` | function | 9 |
| 2 | `normalizeContactOption` | function | 41 |
| 3 | `hasContactOptionData` | function | 57 |
| 4 | `collectNormalizedContactOptions` | function | 72 |
| 5 | `collectLegacyContactOptions` | function | 89 |
| 6 | `parseStoredContactOptions` | function | 111 |
| 7 | `parseImportContactOptions` | function | 135 |
| 8 | `serializeContactOptions` | function | 156 |
| 9 | `getPrimaryContactOption` | function | 166 |
| 10 | `buildImportedContactState` | function | 178 |

### 3.96 `backend/src/database.ts`

- No top-level named symbols detected.

### 3.97 `backend/src/dataPath/index.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizePathForCompare` | function | 32 |
| 2 | `isSamePath` | function | 38 |
| 3 | `isSubPath` | function | 42 |
| 4 | `ensureDataRootLayout` | function | 47 |
| 5 | `walkFiles` | function | 58 |
| 6 | `summarizeDataRoot` | function | 80 |
| 7 | `copyDirectoryContents` | function | 123 |
| 8 | `buildArchivedTargetPath` | function | 160 |
| 9 | `waitForFileSystemRetry` | function | 177 |
| 10 | `renameDirectoryWithRetry` | function | 183 |
| 11 | `relocateDataRoot` | function | 202 |

### 3.98 `backend/src/db/cutoverReadiness.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeRelative` | function | 44 |
| 2 | `toRelative` | function | 48 |
| 3 | `shouldSkipDir` | function | 52 |
| 4 | `listSourceFiles` | function | 60 |
| 5 | `analyzeFile` | function | 74 |
| 6 | `incrementCount` | function | 95 |
| 7 | `mapCountsToRows` | function | 99 |
| 8 | `summarizeBlockers` | function | 107 |
| 9 | `analyzeFiles` | function | 124 |
| 10 | `analyzePostgresCutoverReadiness` | function | 134 |

### 3.99 `backend/src/db/postgresQueryCompat.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `countPositionalPlaceholders` | function | 63 |
| 2 | `stripTrailingSemicolon` | function | 88 |
| 3 | `replacePositionalParams` | function | 92 |
| 4 | `normalizePortableSqlFunctions` | function | 126 |
| 5 | `translateInsertOrIgnore` | function | 137 |
| 6 | `translateParameters` | function | 141 |
| 7 | `appendReturning` | function | 166 |
| 8 | `isNumericFieldName` | function | 178 |
| 9 | `getInsertTableName` | function | 185 |
| 10 | `translateSql` | function | 195 |
| 11 | `coerceRowValue` | function | 213 |
| 12 | `coerceRow` | function | 226 |

### 3.100 `backend/src/fileAssets.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDb` | function | 62 |
| 2 | `buildAssetExtToMime` | function | 66 |
| 3 | `ensureUploadsDirectory` | function | 76 |
| 4 | `getMimeTypeFromName` | function | 80 |
| 5 | `getMediaType` | function | 85 |
| 6 | `sanitizeOriginalFileName` | function | 94 |
| 7 | `preserveOriginalDisplayName` | function | 108 |
| 8 | `buildUniqueStoredName` | function | 116 |
| 9 | `shouldCompressImage` | function | 133 |
| 10 | `compressBufferForAsset` | function | 139 |
| 11 | `encodeImageCandidate` | function | 223 |
| 12 | `readImageDimensions` | function | 252 |
| 13 | `getFfmpegPath` | function | 265 |
| 14 | `buildVideoOptimizationArgs` | function | 273 |
| 15 | `optimizeStoredVideo` | function | 311 |
| 16 | `createFileAssetRecord` | function | 377 |
| 17 | `getFileAssetByPublicPath` | function | 458 |
| 18 | `buildFileAssetFilterParams` | function | 467 |
| 19 | `buildFileAssetListCacheKey` | function | 474 |
| 20 | `cloneUsageList` | function | 484 |
| 21 | `cloneFileAssetListPayload` | function | 488 |
| 22 | `clearFileAssetListCache` | function | 500 |
| 23 | `readCachedFileAssetList` | function | 504 |
| 24 | `writeCachedFileAssetList` | function | 515 |
| 25 | `listAssetRows` | function | 527 |
| 26 | `countAssetRows` | function | 552 |
| 27 | `writeObjectBodyToFile` | function | 572 |
| 28 | `ensureStoredAssetAvailableLocally` | function | 590 |
| 29 | `collectUploadPathsFromValue` | function | 600 |
| 30 | `pruneInvalidReferenceBackfillAssets` | function | 628 |
| 31 | `collectReferencedUploadPaths` | function | 637 |
| 32 | `add` | const arrow | 639 |
| 33 | `ensureReferencedAssetsRegistered` | function | 650 |
| 34 | `getUploadFilePath` | function | 683 |
| 35 | `toUploadPublicPathFromObjectKey` | function | 688 |
| 36 | `findUploadStorageOrphans` | function | 694 |
| 37 | `collectTrackedUploadPublicPaths` | function | 712 |
| 38 | `add` | const arrow | 714 |
| 39 | `collectObjectKeys` | function | 731 |
| 40 | `listLocalUploadFiles` | function | 740 |
| 41 | `reconcileUploadStorage` | function | 748 |
| 42 | `requestUploadStorageReconcile` | function | 808 |
| 43 | `ensureFileAssetListingWarm` | function | 812 |
| 44 | `prewarmFileAssetListing` | function | 830 |
| 45 | `deleteAllStoredUploads` | function | 841 |
| 46 | `buildInClausePlaceholders` | function | 862 |
| 47 | `normalizeUniquePublicPaths` | function | 868 |
| 48 | `createUsageMap` | function | 880 |
| 49 | `addReferencedRowUsages` | function | 888 |
| 50 | `buildUploadReferenceUsageMap` | function | 898 |
| 51 | `getCachedSettingsUsageReferences` | function | 920 |
| 52 | `getCachedSubmissionUsageReferences` | function | 940 |
| 53 | `mergeUsageReferences` | function | 960 |
| 54 | `collectUsagesByPublicPath` | function | 969 |
| 55 | `addUsage` | const arrow | 975 |
| 56 | `collectUsage` | function | 1045 |
| 57 | `resolveBrowserPublicPath` | function | 1049 |
| 58 | `serializeAssetRow` | function | 1056 |
| 59 | `serializeAssetRows` | function | 1070 |
| 60 | `registerStoredAsset` | function | 1084 |
| 61 | `registerUploadFromRequest` | function | 1161 |
| 62 | `optimizeStoredAssetFromQueue` | function | 1175 |
| 63 | `storeDataUrlAsset` | function | 1207 |
| 64 | `backfillUploadAssets` | function | 1233 |
| 65 | `listFileAssets` | function | 1250 |
| 66 | `getFileAssetById` | function | 1288 |
| 67 | `deleteFileAsset` | function | 1293 |

### 3.101 `backend/src/helpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `logOp` | function | 21 |
| 2 | `getServerLog` | function | 26 |
| 3 | `ok` | function | 30 |
| 4 | `err` | function | 35 |
| 5 | `audit` | function | 50 |
| 6 | `safeHistoryPayload` | function | 99 |
| 7 | `recordActionHistory` | function | 109 |
| 8 | `broadcast` | function | 164 |
| 9 | `tryParse` | function | 181 |
| 10 | `today` | function | 186 |
| 11 | `nonEmptyCsvLines` | function | 190 |
| 12 | `normalizeCsvHeaders` | function | 198 |
| 13 | `normalizeCsvCell` | function | 206 |
| 14 | `buildCsvRow` | function | 210 |
| 15 | `buildParsedCsvRows` | function | 218 |
| 16 | `parseCSVRows` | function | 237 |
| 17 | `bulkImportCSV` | function | 254 |
| 18 | `parseCSVLine` | function | 280 |
| 19 | `buildPlaceholders` | function | 294 |
| 20 | `rowValuesForColumns` | function | 300 |
| 21 | `importRows` | function | 314 |
| 22 | `verifyAndRepairStockQuantities` | function | 329 |
| 23 | `mapReturnedQuantities` | function | 382 |
| 24 | `areAllSaleItemsReturned` | function | 390 |
| 25 | `verifyAndRepairSaleStatuses` | function | 402 |
| 26 | `verifyAndRepairCostPrices` | function | 461 |
| 27 | `runDataIntegrityCheck` | function | 543 |
| 28 | `hasRepairMessages` | function | 567 |
| 29 | `getSafeCostPrice` | function | 577 |
| 30 | `calculateSaleProfit` | function | 588 |

### 3.102 `backend/src/idempotency.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeClientRequestId` | function | 4 |

### 3.103 `backend/src/importCsv.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `stripBom` | function | 15 |
| 2 | `normalizeDigit` | function | 22 |
| 3 | `normalizeNumericText` | function | 33 |
| 4 | `countDelimiter` | function | 44 |
| 5 | `detectCsvDelimiter` | function | 66 |
| 6 | `parseDelimitedRows` | function | 85 |
| 7 | `normalizeCsvKey` | function | 130 |
| 8 | `normalizeCsvHeaders` | function | 141 |
| 9 | `hasDelimitedRowContent` | function | 152 |
| 10 | `hasParsedCsvRowContent` | function | 162 |
| 11 | `buildParsedCsvRows` | function | 172 |
| 12 | `parseCsvRows` | function | 186 |
| 13 | `detectCsvDelimiterFromFile` | function | 196 |
| 14 | `csvValuesToRow` | function | 212 |
| 15 | `hasCsvContent` | function | 226 |
| 16 | `emitRecord` | const function | 248 |

### 3.104 `backend/src/importParsing.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeDigit` | function | 13 |
| 2 | `normalizeNumericText` | function | 24 |
| 3 | `removeCurrencyNoise` | function | 34 |
| 4 | `normalizeNumberSeparators` | function | 44 |
| 5 | `parseImportNumericValue` | function | 83 |
| 6 | `normalizeImportMoney` | function | 102 |

### 3.105 `backend/src/initials.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildKhmerOrder` | function | 21 |
| 2 | `normalizeInitialText` | function | 34 |
| 3 | `getInitialKey` | function | 39 |
| 4 | `getInitialType` | function | 51 |
| 5 | `compareInitialKeys` | function | 61 |
| 6 | `rank` | const arrow | 66 |
| 7 | `aggregateInitialRows` | function | 87 |

### 3.106 `backend/src/maintenanceLock.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 15 |
| 2 | `getMaintenanceLock` | function | 22 |
| 3 | `isMaintenanceLocked` | function | 29 |
| 4 | `acquireMaintenanceLock` | function | 37 |
| 5 | `releaseMaintenanceLock` | function | 53 |
| 6 | `withMaintenanceLock` | function | 66 |
| 7 | `isReadOnlyMethod` | function | 79 |
| 8 | `isMaintenanceWriteAllowed` | function | 87 |
| 9 | `maintenanceWriteGuard` | function | 109 |

### 3.107 `backend/src/middleware.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `authToken` | function | 14 |
| 2 | `networkAccessGuard` | function | 27 |
| 3 | `sanitiseFilename` | function | 32 |
| 4 | `compressImageFile` | function | 64 |
| 5 | `compressImageBuffer` | function | 99 |
| 6 | `getClientKey` | function | 106 |
| 7 | `routeRateLimit` | function | 112 |
| 8 | `createStorage` | function | 124 |
| 9 | `buildUpload` | function | 140 |
| 10 | `parsePermissionsValue` | function | 172 |
| 11 | `getMergedPermissions` | function | 182 |
| 12 | `isAdminControlUser` | function | 189 |
| 13 | `hasPermission` | function | 197 |
| 14 | `requirePermission` | function | 204 |
| 15 | `requireAnyPermission` | function | 216 |
| 16 | `readAuditTextValue` | function | 234 |
| 17 | `getAuditRequestMeta` | function | 240 |
| 18 | `getAuditActor` | function | 269 |
| 19 | `compressUpload` | function | 285 |
| 20 | `validateUploadedFile` | function | 303 |
| 21 | `validateUploadBufferPayload` | function | 314 |

### 3.108 `backend/src/money.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toFiniteNumber` | function | 4 |
| 2 | `roundUpToDecimals` | function | 10 |
| 3 | `normalizePriceValue` | function | 20 |

### 3.109 `backend/src/netSecurity.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 29 |
| 2 | `normalizeHostname` | function | 36 |
| 3 | `isPrivateIpv4` | function | 43 |
| 4 | `isPrivateIpv6` | function | 64 |
| 5 | `isBlockedHostname` | function | 78 |
| 6 | `assertSafeOutboundUrl` | function | 99 |
| 7 | `isSafeExternalImageReference` | function | 130 |

### 3.110 `backend/src/objectStore.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getS3RequestHandler` | function | 18 |
| 2 | `getObjectStorageDriver` | function | 29 |
| 3 | `isObjectStorageEnabled` | function | 33 |
| 4 | `isR2Enabled` | function | 37 |
| 5 | `isMinioEnabled` | function | 41 |
| 6 | `trim` | function | 45 |
| 7 | `getCloudflareAccountId` | function | 49 |
| 8 | `getCloudflareApiToken` | function | 56 |
| 9 | `canUseCloudflareR2Api` | function | 68 |
| 10 | `buildR2ApiObjectUrl` | function | 72 |
| 11 | `cloudflareR2ApiRequest` | function | 87 |
| 12 | `shouldFallbackToR2Api` | function | 125 |
| 13 | `isMissingObjectError` | function | 135 |
| 14 | `getS3Client` | function | 145 |
| 15 | `normalizeObjectKey` | function | 164 |
| 16 | `normalizeUniqueObjectKeys` | function | 168 |
| 17 | `buildDeleteObjectRefs` | function | 180 |
| 18 | `serializeCloudflareObjectList` | function | 188 |
| 19 | `serializeS3ObjectList` | function | 201 |
| 20 | `ensureBucket` | function | 214 |
| 21 | `putObject` | function | 232 |
| 22 | `sendWithTimeout` | function | 267 |
| 23 | `getObjectStream` | function | 279 |
| 24 | `objectExists` | function | 312 |
| 25 | `deleteObject` | function | 345 |
| 26 | `deleteObjects` | function | 364 |
| 27 | `listObjects` | function | 397 |
| 28 | `testObjectStore` | function | 433 |
| 29 | `bufferToStream` | function | 448 |

### 3.111 `backend/src/optionalSharp.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadSharp` | function | 9 |

### 3.112 `backend/src/organizationContext/index.ts`

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
| 13 | `ensureOrganizationFilesystemLayout` | function | 157 |
| 14 | `getOrganizationStorageStatus` | function | 226 |

### 3.113 `backend/src/permissions.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildPermissionDefinitions` | function | 51 |
| 2 | `normalizeKey` | function | 148 |
| 3 | `getPermissionDefinition` | function | 155 |
| 4 | `isSensitivePermissionKey` | function | 166 |
| 5 | `permissionForActionHistory` | function | 176 |
| 6 | `isSensitiveActionHistory` | function | 187 |
| 7 | `hasPermissionValue` | function | 206 |

### 3.114 `backend/src/portalUtils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toTrimmedString` | function | 14 |
| 2 | `safeJsonParse` | function | 23 |
| 3 | `createAboutBlock` | function | 36 |
| 4 | `normalizeAboutBlocks` | function | 51 |
| 5 | `extractGoogleMapsEmbedUrl` | function | 78 |
| 6 | `normalizeGoogleMapsEmbed` | function | 90 |

### 3.115 `backend/src/postgresDatabase.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadPgNative` | function | 13 |
| 2 | `normalizeQueryRows` | function | 30 |
| 3 | `buildRunResult` | function | 37 |
| 4 | `normalizeStatementArgs` | function | 46 |
| 5 | `splitSqlStatements` | function | 55 |
| 6 | `PostgresCompatStatement` | class | 65 |
| 7 | `PostgresCompatDatabase` | class | 89 |
| 8 | `createPostgresDatabase` | function | 537 |
| 9 | `runDatabaseMaintenance` | function | 541 |
| 10 | `ensureCoreDataInvariants` | function | 545 |
| 11 | `ensureDefaultOrganizationAndGroup` | function | 549 |
| 12 | `ensurePrimaryAdminRoleAndUser` | function | 553 |
| 13 | `getDb` | function | 559 |
| 14 | `closeDatabase` | function | 587 |

### 3.116 `backend/src/productBatches.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeExpiryDate` | function | 23 |
| 2 | `normalizeLotCode` | function | 28 |
| 3 | `isSellableProduct` | function | 33 |
| 4 | `buildBatchKey` | function | 37 |
| 5 | `getProductById` | function | 46 |
| 6 | `rowsToIds` | function | 52 |
| 7 | `normalizePositiveIds` | function | 60 |
| 8 | `buildPlaceholders` | function | 72 |
| 9 | `sumQuantities` | function | 78 |
| 10 | `hasTrackedBatch` | function | 86 |
| 11 | `getProductBatchIds` | function | 93 |
| 12 | `getBatchRowsForProduct` | function | 97 |
| 13 | `getLegacyBatchBackfillCandidates` | function | 106 |
| 14 | `createOrFindProductBatch` | function | 119 |
| 15 | `setBranchBatchQuantity` | function | 176 |
| 16 | `incrementBranchBatchQuantity` | function | 186 |
| 17 | `getBatchStockRows` | function | 197 |
| 18 | `listProductBatches` | function | 237 |
| 19 | `syncProductBatchRollups` | function | 308 |
| 20 | `migrateLegacyProductToBatches` | function | 353 |
| 21 | `migrateAllLegacyProductsToBatches` | function | 397 |
| 22 | `scheduleLegacyBatchBackfill` | function | 409 |
| 23 | `runNextChunk` | const arrow | 415 |
| 24 | `getLegacyBatchBackfillStatus` | function | 445 |
| 25 | `getAvailableProductQuantity` | function | 454 |
| 26 | `allocateProductBatches` | function | 459 |
| 27 | `increaseProductBatchStock` | function | 499 |
| 28 | `restoreBatchAllocations` | function | 516 |
| 29 | `cloneAllocationsToProduct` | function | 531 |
| 30 | `getSaleItemAllocations` | function | 555 |
| 31 | `markSaleItemAllocationsReleased` | function | 567 |
| 32 | `getAvailableSaleAllocationRows` | function | 575 |
| 33 | `getReturnItemAllocations` | function | 598 |
| 34 | `markReturnItemAllocationsReversed` | function | 610 |

### 3.117 `backend/src/productDiscounts.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeBooleanFlag` | function | 41 |
| 2 | `normalizePercent` | function | 54 |
| 3 | `normalizeDiscountType` | function | 64 |
| 4 | `normalizeHexColor` | function | 74 |
| 5 | `normalizeDateText` | function | 83 |
| 6 | `pick` | function | 97 |
| 7 | `normalizeProductDiscount` | function | 106 |
| 8 | `isDiscountActive` | function | 133 |
| 9 | `calculateDiscountedPrice` | function | 152 |

### 3.118 `backend/src/productImportPolicies.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseImportNumber` | function | 17 |
| 2 | `parseImportFlag` | function | 31 |
| 3 | `hasImportValue` | function | 45 |
| 4 | `normalizeFieldRule` | function | 55 |
| 5 | `splitUniqueImportValues` | function | 66 |
| 6 | `collectImportListValues` | function | 83 |
| 7 | `buildLowercaseSet` | function | 96 |
| 8 | `appendUniqueImportValue` | function | 110 |
| 9 | `resolveImportValue` | function | 135 |
| 10 | `normalizeImageConflictMode` | function | 155 |

### 3.119 `backend/src/requestContext.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `cleanText` | function | 10 |
| 2 | `readHeader` | function | 17 |
| 3 | `extractRequestMeta` | function | 24 |
| 4 | `requestContextMiddleware` | function | 51 |
| 5 | `getRequestMeta` | function | 57 |

### 3.120 `backend/src/routes/actionHistory.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseJson` | function | 14 |
| 2 | `normalizeLimit` | function | 24 |
| 3 | `normalizeText` | function | 29 |
| 4 | `serializePayload` | function | 34 |
| 5 | `canReadAllHistory` | function | 43 |
| 6 | `getOwnedHistoryRow` | function | 47 |
| 7 | `canOperateHistoryRow` | function | 53 |
| 8 | `canRecordHistory` | function | 67 |
| 9 | `getHistoryRow` | function | 87 |
| 10 | `mapRow` | function | 94 |
| 11 | `mapHistoryRows` | function | 103 |
| 12 | `completeServerHistoryTransition` | function | 214 |

### 3.121 `backend/src/routes/ai.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `listProviders` | function | 19 |
| 2 | `getProviderRow` | function | 32 |
| 3 | `serializeResponseRows` | function | 244 |

### 3.122 `backend/src/routes/auth.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getClientKey` | function | 98 |
| 2 | `applyRateLimit` | function | 111 |
| 3 | `getLoginLockKey` | function | 123 |
| 4 | `isReasonableCredentialLength` | function | 127 |
| 5 | `normalizeLookupText` | function | 132 |
| 6 | `isHttpUrl` | function | 136 |
| 7 | `buildPublicBaseUrl` | function | 140 |
| 8 | `isLocalOrigin` | function | 147 |
| 9 | `resolvePublicAssetBaseUrl` | function | 156 |
| 10 | `resolvePasswordResetRedirect` | function | 162 |
| 11 | `findFirstHttpUrl` | function | 175 |
| 12 | `loginIdentifierPreview` | function | 185 |
| 13 | `rejectLogin` | function | 199 |
| 14 | `getOtpSecret` | function | 221 |
| 15 | `requireOtpActor` | function | 225 |
| 16 | `getOtpTargetUser` | function | 231 |
| 17 | `getJoinedOrganizationContext` | function | 241 |
| 18 | `buildUserPayload` | function | 259 |
| 19 | `resolveOrganizationLookup` | function | 298 |
| 20 | `findUserByIdentifier` | function | 304 |
| 21 | `getExactActiveUserById` | function | 373 |
| 22 | `normalizeOauthMode` | function | 388 |
| 23 | `isEmailIdentifier` | function | 393 |
| 24 | `getUserById` | function | 397 |
| 25 | `getSettingsSnapshotVersion` | function | 401 |
| 26 | `getSettingsSnapshot` | function | 414 |
| 27 | `getBootstrapSystemSnapshot` | function | 441 |
| 28 | `buildAuthenticatedBootstrap` | function | 480 |
| 29 | `generateTemporaryAuthPassword` | function | 511 |
| 30 | `issueAuthSession` | function | 515 |
| 31 | `updateLocalUserGoogleIdentity` | function | 526 |
| 32 | `completeGoogleLogin` | function | 675 |
| 33 | `buildOauthCallbackHtml` | function | 761 |

### 3.123 `backend/src/routes/branches.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toDbBool` | function | 13 |
| 2 | `getStockTransferNoteColumn` | function | 21 |
| 3 | `normalizePositiveInt` | function | 25 |
| 4 | `getDefaultBranch` | function | 31 |
| 5 | `getSellableProductWhere` | function | 35 |
| 6 | `buildStockIntegrityPreview` | function | 41 |
| 7 | `buildSqlPlaceholders` | function | 53 |
| 8 | `quoteSqlColumns` | function | 61 |
| 9 | `buildBranchStockWhere` | function | 69 |
| 10 | `hasPagedStockQuery` | function | 93 |

### 3.124 `backend/src/routes/catalog.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `collectProductIds` | function | 10 |
| 2 | `buildPlaceholders` | function | 18 |
| 3 | `buildImageMap` | function | 26 |
| 4 | `buildCatalogProductPayloads` | function | 35 |

### 3.125 `backend/src/routes/categories.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLookup` | function | 12 |
| 2 | `normalizeColor` | function | 16 |

### 3.126 `backend/src/routes/contacts.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLegacyMembershipNumber` | function | 20 |
| 2 | `cleanMembershipNumber` | function | 26 |
| 3 | `requireMembershipNumber` | function | 30 |
| 4 | `assertUniqueMembershipNumber` | function | 36 |
| 5 | `ensureMembershipNumber` | function | 50 |
| 6 | `ensureOrGenerateMembershipNumber` | function | 55 |
| 7 | `generateCustomerMembershipNumber` | function | 61 |
| 8 | `normalizeFieldRule` | function | 75 |
| 9 | `resolveFieldValue` | function | 82 |
| 10 | `buildImportRows` | function | 93 |
| 11 | `buildProvidedImportRows` | function | 103 |
| 12 | `normalizeConflictMode` | function | 112 |
| 13 | `toNumber` | function | 117 |
| 14 | `normalizePositiveInt` | function | 122 |
| 15 | `parseDateFilterParams` | function | 128 |
| 16 | `buildContactListFilters` | function | 152 |
| 17 | `buildSearchHaystack` | function | 176 |
| 18 | `parseScopedIds` | function | 185 |
| 19 | `addPositiveId` | function | 201 |
| 20 | `collectPositiveIds` | function | 208 |
| 21 | `buildSqlPlaceholders` | function | 217 |
| 22 | `loadPointPolicy` | function | 225 |
| 23 | `calculatePolicyPoints` | function | 253 |
| 24 | `wantsExpandedPoints` | function | 258 |
| 25 | `buildCustomerPointSummaries` | function | 263 |
| 26 | `buildCustomerRowMap` | function | 336 |
| 27 | `collectPointSummarySourceIds` | function | 345 |
| 28 | `defaultPointSummary` | function | 356 |
| 29 | `buildPointSummaryList` | function | 367 |
| 30 | `attachPointSummaries` | function | 375 |
| 31 | `collectCustomerIdsFromRows` | function | 387 |
| 32 | `findExisting` | const arrow | 560 |
| 33 | `findExisting` | const arrow | 775 |
| 34 | `findExisting` | const arrow | 969 |

### 3.127 `backend/src/routes/customTables.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `humanizeTableName` | function | 13 |
| 2 | `serializeCustomTable` | function | 21 |
| 3 | `sanitizeCustomTableName` | function | 29 |
| 4 | `resolveCustomTableRow` | function | 35 |
| 5 | `escapeIdentifier` | function | 44 |
| 6 | `normalizeCustomTableSchema` | function | 48 |
| 7 | `tableHasColumn` | function | 71 |
| 8 | `ensureCustomTableRowVersioning` | function | 75 |
| 9 | `getWritableCustomTableKeys` | function | 92 |

### 3.128 `backend/src/routes/files.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseFileAssetId` | function | 22 |
| 2 | `getFileListFilters` | function | 30 |
| 3 | `getDeviceMeta` | function | 53 |

### 3.129 `backend/src/routes/importJobs.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `permissionForImportType` | function | 34 |
| 2 | `requireImportPermission` | function | 42 |
| 3 | `hasAnyImportPermission` | function | 55 |
| 4 | `getPermittedImportTypes` | function | 63 |
| 5 | `requireAnyImportPermission` | function | 71 |
| 6 | `ensureDir` | function | 81 |
| 7 | `getJobUploadRoot` | function | 85 |
| 8 | `getJobOr404` | function | 90 |
| 9 | `serializeJobFile` | function | 99 |
| 10 | `serializeJobFiles` | function | 111 |
| 11 | `saveImageJobFiles` | function | 120 |
| 12 | `isAllowedImportFile` | function | 149 |
| 13 | `parsePolicy` | function | 173 |
| 14 | `parseRelativePaths` | function | 179 |
| 15 | `shouldForceDelete` | function | 190 |
| 16 | `auditImportJobEvent` | function | 195 |

### 3.130 `backend/src/routes/inventory.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `asyncRoute` | function | 31 |
| 2 | `normalizeImportedTimestamp` | function | 35 |
| 3 | `recalcProductStock` | function | 43 |
| 4 | `findTransferByClientRequestId` | function | 47 |
| 5 | `getStockTransferNoteColumn` | function | 61 |
| 6 | `buildActiveBranchIndex` | function | 65 |
| 7 | `collectSetValues` | function | 80 |
| 8 | `compareInventoryProductRows` | function | 88 |
| 9 | `insertInventoryProductRowSorted` | function | 96 |
| 10 | `collectSortedInventoryProductRows` | function | 104 |
| 11 | `cleanMoveReason` | function | 112 |
| 12 | `normalizePositiveInt` | function | 118 |
| 13 | `hasInventoryStatsFilter` | function | 124 |
| 14 | `cleanInventoryReasonEntry` | function | 132 |
| 15 | `normalizeInventoryReasonList` | function | 146 |
| 16 | `loadSavedInventoryReasons` | function | 168 |
| 17 | `persistSavedInventoryReasons` | function | 179 |
| 18 | `splitSearchTerms` | function | 189 |
| 19 | `normalizeMovementDisplayText` | function | 205 |
| 20 | `sanitizeInventoryResponseProduct` | function | 216 |
| 21 | `appendInventoryProductFilters` | function | 229 |
| 22 | `getInventoryBootstrapBranches` | function | 285 |
| 23 | `getInventoryProductSnapshotVersion` | function | 289 |
| 24 | `normalizeInventoryReadCacheValue` | function | 310 |
| 25 | `buildInventoryProductReadCacheKey` | function | 315 |
| 26 | `getCachedInventoryProductSearchPayload` | function | 328 |
| 27 | `getInventoryProductMetadata` | function | 332 |
| 28 | `buildInventoryProductSearchPayload` | function | 361 |
| 29 | `hydrateInventoryProducts` | function | 468 |
| 30 | `appendAllocationMovementEntries` | function | 491 |
| 31 | `buildInsertColumnSql` | function | 506 |
| 32 | `buildInventoryFinancialJoinSql` | function | 519 |
| 33 | `inventoryFinancialSelectSql` | function | 625 |
| 34 | `getFilteredInventoryStats` | function | 639 |
| 35 | `normalizeRfidId` | function | 1312 |
| 36 | `getRfidSession` | function | 1316 |
| 37 | `getBranchLedgerQty` | function | 1320 |
| 38 | `refreshRfidSessionCounts` | function | 1324 |
| 39 | `upsertRfidSessionItem` | function | 1359 |
| 40 | `recordRfidEvent` | function | 1384 |

### 3.131 `backend/src/routes/notifications.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeBoolean` | function | 26 |
| 2 | `toNumber` | function | 34 |
| 3 | `pruneNotificationSummaryCache` | function | 39 |
| 4 | `getNotificationSummaryCacheKey` | function | 47 |
| 5 | `cloneNotificationSummaryPayload` | function | 60 |
| 6 | `getCachedNotificationSummary` | function | 64 |
| 7 | `setCachedNotificationSummary` | function | 73 |
| 8 | `buildPlaceholders` | function | 80 |
| 9 | `rowsToSettingMap` | function | 88 |
| 10 | `joinNotificationSummary` | function | 96 |
| 11 | `loadNotificationPreferences` | function | 104 |
| 12 | `loadPointPolicy` | function | 127 |
| 13 | `calculatePolicyPoints` | function | 152 |
| 14 | `buildInventoryItems` | function | 157 |
| 15 | `buildInventorySection` | function | 186 |
| 16 | `buildExpiryItems` | function | 209 |
| 17 | `buildExpirySection` | function | 229 |
| 18 | `buildSalesItems` | function | 251 |
| 19 | `buildSalesSection` | function | 280 |
| 20 | `rowsByCustomerId` | function | 326 |
| 21 | `buildLoyaltyMatches` | function | 334 |
| 22 | `buildLoyaltyItems` | function | 357 |
| 23 | `buildLoyaltySection` | function | 376 |
| 24 | `buildPortalItems` | function | 435 |
| 25 | `buildPortalSection` | function | 452 |
| 26 | `buildSystemSection` | function | 480 |
| 27 | `sumSectionCounts` | function | 510 |

### 3.132 `backend/src/routes/organizations.ts`

- No top-level named symbols detected.

### 3.133 `backend/src/routes/portal.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `asyncRoute` | function | 24 |
| 2 | `toNumber` | function | 29 |
| 3 | `normalizeBoolean` | function | 35 |
| 4 | `normalizePhone` | function | 41 |
| 5 | `normalizePublicPath` | function | 46 |
| 6 | `normalizeUrl` | function | 60 |
| 7 | `normalizeRedeemValueUsd` | function | 75 |
| 8 | `normalizeRedeemValueKhr` | function | 80 |
| 9 | `normalizeHexColor` | function | 87 |
| 10 | `normalizeFaqItems` | function | 93 |
| 11 | `normalizePortalTranslations` | function | 111 |
| 12 | `normalizeProductIdList` | function | 125 |
| 13 | `loadSettingsMap` | function | 140 |
| 14 | `buildPortalConfig` | function | 150 |
| 15 | `buildRankMap` | function | 276 |
| 16 | `buildEmptyPortalMetric` | function | 297 |
| 17 | `collectPortalSignalRows` | function | 309 |
| 18 | `buildIdRankMap` | function | 322 |
| 19 | `buildRecommendedRankMap` | function | 331 |
| 20 | `getPortalProductSignals` | function | 339 |
| 21 | `buildPlaceholders` | function | 415 |
| 22 | `collectProductIds` | function | 421 |
| 23 | `getPortalProductAssets` | function | 427 |
| 24 | `buildPortalProductPayload` | function | 467 |
| 25 | `buildPortalProductPayloads` | function | 484 |
| 26 | `calculatePointsValue` | function | 493 |
| 27 | `summarizePoints` | function | 503 |
| 28 | `joinWrappedClauses` | function | 543 |
| 29 | `normalizePortalSubmissionRows` | function | 550 |
| 30 | `summarizeMembershipTotals` | function | 562 |
| 31 | `getPortalProducts` | function | 593 |
| 32 | `cacheTtl` | function | 632 |
| 33 | `setPublicPortalCacheHeaders` | function | 636 |
| 34 | `normalizePositiveInt` | function | 652 |
| 35 | `splitSearchTerms` | function | 658 |
| 36 | `splitFilterValues` | function | 669 |
| 37 | `parsePositiveIds` | function | 680 |
| 38 | `buildNamedPlaceholders` | function | 689 |
| 39 | `appendSearchTermFilters` | function | 697 |
| 40 | `appendNamedFilter` | function | 713 |
| 41 | `normalizeLowerValues` | function | 729 |
| 42 | `appendPortalProductSearchFilters` | function | 735 |
| 43 | `collectRowValues` | function | 775 |
| 44 | `normalizeStringList` | function | 781 |
| 45 | `uniqueSortedStrings` | function | 792 |
| 46 | `getPortalCatalogSearchMetadata` | function | 806 |
| 47 | `distinctField` | const arrow | 811 |
| 48 | `getPortalCatalogProductPage` | function | 835 |
| 49 | `getCachedPortalConfig` | function | 898 |
| 50 | `getCachedPortalMeta` | function | 902 |
| 51 | `getCachedPortalProducts` | function | 906 |
| 52 | `buildFreshPublicPortalBootstrapPayload` | function | 919 |
| 53 | `buildPublicPortalBootstrapPayload` | function | 929 |
| 54 | `getPublicPortalBootstrapCacheStatus` | function | 958 |
| 55 | `getPortalCatalogMeta` | function | 963 |
| 56 | `findCustomerByMembership` | function | 1003 |
| 57 | `sanitizeScreenshots` | function | 1013 |
| 58 | `materializePortalScreenshots` | function | 1026 |
| 59 | `sanitizeAiProfile` | function | 1044 |
| 60 | `hasAiProfilePreference` | function | 1055 |
| 61 | `getVisitorFingerprint` | function | 1063 |
| 62 | `getClientKey` | function | 1069 |
| 63 | `applyPortalRateLimit` | function | 1074 |
| 64 | `collectRecommendationCitations` | function | 1082 |

### 3.134 `backend/src/routes/products.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `asyncRoute` | function | 50 |
| 2 | `getActiveBranches` | function | 62 |
| 3 | `getBranchListForBootstrap` | function | 66 |
| 4 | `settingsHasUpdatedAt` | function | 76 |
| 5 | `getDefaultBranch` | function | 80 |
| 6 | `getBranchById` | function | 89 |
| 7 | `findBranchByName` | function | 96 |
| 8 | `seedBranchRows` | function | 105 |
| 9 | `recalcProductStock` | function | 112 |
| 10 | `normalizeImageGallery` | function | 116 |
| 11 | `syncProductImageGallery` | function | 123 |
| 12 | `loadProductImageMap` | function | 142 |
| 13 | `attachImageGallery` | function | 163 |
| 14 | `findProductByClientRequestId` | function | 181 |
| 15 | `assertUniqueProductFields` | function | 191 |
| 16 | `normalizeProductIdentifier` | function | 239 |
| 17 | `hasOwnField` | function | 244 |
| 18 | `pickField` | function | 248 |
| 19 | `ensureParentProductExists` | function | 252 |
| 20 | `markParentProductAsGroup` | function | 262 |
| 21 | `normalizeImportLookup` | function | 267 |
| 22 | `normalizeLookup` | function | 271 |
| 23 | `collectUniquePositiveIds` | function | 275 |
| 24 | `collectNormalizedTokens` | function | 288 |
| 25 | `collectBoundedValues` | function | 302 |
| 26 | `collectSortedMapValues` | function | 311 |
| 27 | `insertSortedValue` | function | 319 |
| 28 | `normalizeImportFlagValue` | function | 327 |
| 29 | `getProductImportDetailSignature` | function | 360 |
| 30 | `chooseImportParentProduct` | function | 381 |
| 31 | `compareImportParentProduct` | function | 389 |
| 32 | `findImportProductWithSignature` | function | 402 |
| 33 | `normalizeImportAction` | function | 410 |
| 34 | `parseOptionalImportId` | function | 418 |
| 35 | `discountInsertColumns` | function | 425 |
| 36 | `discountValues` | function | 429 |
| 37 | `normalizeExpiryFields` | function | 444 |
| 38 | `normalizeBatchFields` | function | 455 |
| 39 | `seedOpeningBatch` | function | 462 |
| 40 | `normalizePositiveInt` | function | 477 |
| 41 | `parseInclude` | function | 483 |
| 42 | `splitSearchTerms` | function | 487 |
| 43 | `getProductCatalogSnapshotVersion` | function | 491 |
| 44 | `invalidateProductCatalogSnapshotVersion` | function | 513 |
| 45 | `broadcastProductsUpdate` | function | 518 |
| 46 | `normalizeProductReadCacheValue` | function | 523 |
| 47 | `buildProductReadCacheKey` | function | 528 |
| 48 | `getCachedProductSearchPayload` | function | 541 |
| 49 | `getCachedProductBootstrapPayload` | function | 545 |
| 50 | `getCachedProductFilters` | function | 552 |
| 51 | `parseBrandOptionsSetting` | function | 560 |
| 52 | `sanitizeProductLookupPayload` | function | 570 |
| 53 | `buildLookupUsageEntries` | function | 583 |
| 54 | `buildLookupUsageSummary` | function | 650 |
| 55 | `appendProductSearchFilters` | function | 679 |
| 56 | `getProductSearchMetadata` | function | 756 |
| 57 | `distinctField` | const arrow | 761 |
| 58 | `shouldIncludeProductSearchMetadata` | function | 792 |
| 59 | `attachBranchStock` | function | 797 |
| 60 | `expandProductFamilyRows` | function | 834 |
| 61 | `bindList` | const arrow | 858 |
| 62 | `buildProductSearchPayload` | function | 902 |
| 63 | `normalizeLookup` | const arrow | 1602 |
| 64 | `resolveImage` | const arrow | 1712 |
| 65 | `ensureCategory` | const arrow | 1728 |
| 66 | `ensureUnit` | const arrow | 1743 |
| 67 | `ensureBrand` | const arrow | 1758 |
| 68 | `ensureSupplier` | const arrow | 1771 |
| 69 | `determineBranch` | const arrow | 1783 |
| 70 | `handleBranch` | const arrow | 1802 |
| 71 | `resetBatchStock` | const arrow | 1805 |
| 72 | `isDirectImageRef` | const arrow | 1842 |
| 73 | `normalizeDirectImageRef` | const arrow | 1853 |
| 74 | `parseIncomingImageRefs` | const arrow | 1860 |
| 75 | `loadCurrentGallery` | const arrow | 1896 |

### 3.135 `backend/src/routes/returns.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `deductBranchStock` | function | 24 |
| 2 | `restoreBranchStock` | function | 32 |
| 3 | `cloneReturnRows` | function | 46 |
| 4 | `buildReturnsListCacheKey` | function | 54 |
| 5 | `readCachedReturnsList` | function | 67 |
| 6 | `setCachedReturnsList` | function | 77 |
| 7 | `getReturnItemsByReturnId` | function | 88 |
| 8 | `invalidateReturnsListCache` | function | 117 |
| 9 | `normalizeMovementProductName` | function | 121 |
| 10 | `refreshProductStockQuantity` | function | 132 |
| 11 | `refreshProductStockQuantities` | function | 136 |
| 12 | `normalizeScope` | function | 146 |
| 13 | `toNumber` | function | 154 |
| 14 | `findReturnByClientRequestId` | function | 159 |
| 15 | `assertReturnableItems` | function | 169 |
| 16 | `assertSupplierReturnableStock` | function | 623 |

### 3.136 `backend/src/routes/runtime.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createProductFieldCounts` | function | 18 |
| 2 | `collectSuspiciousProductFields` | function | 26 |
| 3 | `summarizeSuspiciousProducts` | function | 36 |
| 4 | `parseJsonArray` | function | 62 |
| 5 | `summarizeSuspiciousTextValues` | function | 71 |
| 6 | `requireRuntimePermission` | function | 91 |

### 3.137 `backend/src/routes/sales.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `periodExpression` | function | 30 |
| 2 | `hourExpression` | function | 37 |
| 3 | `toDayBounds` | function | 41 |
| 4 | `readCachedDashboardSummary` | function | 51 |
| 5 | `writeCachedDashboardSummary` | function | 58 |
| 6 | `readCachedDashboardAnalytics` | function | 66 |
| 7 | `writeCachedDashboardAnalytics` | function | 73 |
| 8 | `normalizeImportedTimestamp` | function | 81 |
| 9 | `getSaleItemCosts` | function | 89 |
| 10 | `assertSaleStockAvailable` | function | 115 |
| 11 | `findSaleItemForProduct` | function | 142 |
| 12 | `findCustomerForSaleAssignment` | function | 149 |
| 13 | `parseBranchId` | function | 170 |
| 14 | `getActiveBranchContext` | function | 175 |
| 15 | `requireActiveBranch` | function | 197 |
| 16 | `resolveSaleItemBranchId` | function | 204 |
| 17 | `normalizeSaleItems` | function | 215 |
| 18 | `summarizeSaleBranch` | function | 249 |
| 19 | `refreshProductStockQuantity` | function | 281 |
| 20 | `refreshProductStockQuantities` | function | 285 |
| 21 | `deductBranchStock` | function | 292 |
| 22 | `restoreBranchStock` | function | 300 |
| 23 | `fetchSaleItemsWithBranches` | function | 308 |
| 24 | `findSaleByClientRequestId` | function | 317 |
| 25 | `buildDashboardSummary` | function | 1105 |
| 26 | `buildDashboardAnalytics` | function | 1232 |

### 3.138 `backend/src/routes/settings.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLookup` | function | 21 |
| 2 | `normalizeBrandOptionsValue` | function | 25 |
| 3 | `hasSuspiciousCatalogValue` | function | 47 |
| 4 | `normalizeBrandColorMapValue` | function | 54 |
| 5 | `settingsHasUpdatedAt` | function | 83 |
| 6 | `getSettingsSnapshot` | function | 87 |
| 7 | `collectAttemptedSettings` | function | 94 |
| 8 | `getSettingsUpdatedAt` | function | 106 |
| 9 | `parseUpdatedAtMs` | function | 131 |
| 10 | `isExpectedOlderThanCurrent` | function | 145 |

### 3.139 `backend/src/routes/sync.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `stableStringify` | function | 47 |
| 2 | `sha256` | function | 65 |
| 3 | `verifyOperationDigest` | function | 69 |
| 4 | `normalizeOperation` | function | 76 |
| 5 | `normalizeOperations` | function | 89 |
| 6 | `hasWriteConflict` | function | 98 |
| 7 | `hasResultCode` | function | 105 |
| 8 | `hasBlockingReplayResult` | function | 112 |
| 9 | `buildReplayUrl` | function | 120 |
| 10 | `replayOperation` | function | 124 |
| 11 | `getUploadDir` | function | 218 |
| 12 | `readManifest` | function | 222 |

### 3.140 `backend/src/routes/system/index.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `auditWithActorMeta` | function | 87 |
| 2 | `q` | function | 105 |
| 3 | `buildSqlPlaceholders` | function | 109 |
| 4 | `joinRemainingImportJobIds` | function | 117 |
| 5 | `collectSystemSettingKeys` | function | 125 |
| 6 | `buildSettingsMap` | function | 133 |
| 7 | `buildSystemSettingEntries` | function | 141 |
| 8 | `sumNumericValues` | function | 149 |
| 9 | `getCustomTableNames` | function | 157 |
| 10 | `broadcastMany` | function | 166 |
| 11 | `dropCustomTables` | function | 172 |
| 12 | `clearTables` | function | 179 |
| 13 | `collectAppliedOperationIds` | function | 185 |
| 14 | `collectSortedSetValues` | function | 193 |
| 15 | `buildFolderEntries` | function | 202 |
| 16 | `buildExistingFavoriteFolders` | function | 214 |
| 17 | `listVisibleDirectories` | function | 226 |
| 18 | `buildPickerScript` | function | 237 |
| 19 | `getClientKey` | function | 252 |
| 20 | `applyRouteRateLimit` | function | 258 |
| 21 | `stopImportsBeforeDestructiveAction` | function | 270 |
| 22 | `runFsWorker` | function | 285 |
| 23 | `finish` | const arrow | 297 |
| 24 | `getHostUiAvailability` | function | 341 |
| 25 | `buildRequestBaseUrl` | function | 350 |
| 26 | `resolveDriveRedirectUri` | function | 357 |
| 27 | `getSafeTableCount` | function | 364 |
| 28 | `buildMigrationTableCounts` | function | 372 |
| 29 | `safeJsonParse` | function | 392 |
| 30 | `readSystemSettings` | function | 401 |
| 31 | `writeSystemSettings` | function | 409 |
| 32 | `getMigrationSafetyBackupDestination` | function | 425 |
| 33 | `getMigrationSafetyState` | function | 429 |
| 34 | `createMigrationSafetyBackup` | function | 451 |
| 35 | `runMigrationSafetyDriveSync` | function | 468 |
| 36 | `runMigrationSafetyAutomation` | function | 506 |
| 37 | `buildScaleMigrationStatus` | function | 521 |
| 38 | `readFinalBackupManifest` | function | 590 |
| 39 | `getDefaultBackupDestinationDir` | function | 594 |
| 40 | `createFolderBackup` | function | 600 |
| 41 | `restoreFolderBackup` | function | 637 |
| 42 | `buildSystemDebugLogPayload` | function | 767 |
| 43 | `buildSystemConfigPayload` | function | 773 |
| 44 | `sendBackupVersions` | function | 1022 |
| 45 | `listWindowsFsRoots` | const arrow | 1525 |
| 46 | `listDriveRoots` | const arrow | 1540 |

### 3.141 `backend/src/routes/units.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLookup` | function | 13 |
| 2 | `normalizeUnitColor` | function | 17 |
| 3 | `updateUnitHandler` | function | 52 |

### 3.142 `backend/src/routes/users.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isGoogleAuthConfigured` | function | 35 |
| 2 | `getGoogleAuthPublicConfig` | function | 39 |
| 3 | `getClientKey` | function | 53 |
| 4 | `parseJson` | function | 59 |
| 5 | `normalizeLookupText` | function | 67 |
| 6 | `normalizePhoneLookup` | function | 71 |
| 7 | `findUserIdentityConflict` | function | 75 |
| 8 | `getMergedPermissions` | function | 143 |
| 9 | `isPrimaryAdmin` | function | 152 |
| 10 | `hasAdminControl` | function | 159 |
| 11 | `canManageTarget` | function | 172 |
| 12 | `getActorFromRequest` | function | 185 |
| 13 | `requireAdminControl` | function | 192 |
| 14 | `getUserSecurityContext` | function | 205 |
| 15 | `getUserWithRole` | function | 215 |
| 16 | `syncLocalEmailVerification` | function | 230 |
| 17 | `repairGoogleIdentityForUser` | function | 261 |
| 18 | `sanitizeUserRow` | function | 290 |
| 19 | `sanitizeUserRows` | function | 306 |
| 20 | `isValidEmail` | function | 314 |
| 21 | `getAuthIdentityList` | function | 319 |
| 22 | `isUuid` | function | 325 |
| 23 | `resolveAuthIdentityUuid` | function | 329 |
| 24 | `findFirstUuid` | function | 337 |
| 25 | `findProviderIdentity` | function | 344 |
| 26 | `buildAuthMethodsPayload` | function | 352 |

### 3.143 `backend/src/runtimeCache.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `enabled` | function | 32 |
| 2 | `namespacedKey` | function | 40 |
| 3 | `getClient` | function | 48 |
| 4 | `getJson` | function | 90 |
| 5 | `setJson` | function | 109 |
| 6 | `getOrSetJson` | function | 129 |
| 7 | `deleteByPrefix` | function | 141 |
| 8 | `deletePrefixesInOrder` | function | 164 |
| 9 | `prefixesForChannel` | function | 176 |
| 10 | `invalidateForChannel` | function | 201 |
| 11 | `pingRuntimeCache` | function | 213 |
| 12 | `getRuntimeCacheStatus` | function | 227 |

### 3.144 `backend/src/runtimeState/index.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ensureRuntimeMetaDir` | function | 19 |
| 2 | `cloneRuntimeState` | function | 23 |
| 3 | `readRuntimeState` | function | 34 |
| 4 | `writeRuntimeState` | function | 55 |
| 5 | `getRuntimeState` | function | 66 |
| 6 | `bumpStorageVersion` | function | 87 |
| 7 | `buildRuntimeDescriptor` | function | 100 |

### 3.145 `backend/src/runtimeVersion.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `firstExistingDir` | function | 27 |
| 2 | `collectExistingFiles` | function | 38 |
| 3 | `readGitRevision` | function | 50 |
| 4 | `collectFiles` | function | 70 |
| 5 | `computeSourceHash` | function | 87 |
| 6 | `emptyFrontendBuildInfo` | function | 114 |
| 7 | `readFrontendBuildInfoFromRoot` | function | 126 |
| 8 | `getRuntimeVersion` | function | 165 |

### 3.146 `backend/src/schemaMetadata.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeName` | function | 16 |
| 2 | `columnKey` | function | 25 |
| 3 | `normalizeNames` | function | 33 |
| 4 | `normalizeColumnRows` | function | 46 |
| 5 | `candidateKey` | function | 60 |
| 6 | `listColumns` | function | 68 |
| 7 | `hasColumn` | function | 83 |
| 8 | `firstExistingColumn` | function | 108 |
| 9 | `markColumnPresent` | function | 140 |

### 3.147 `backend/src/security.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeEncryptionKey` | function | 28 |
| 2 | `isEncryptionConfigured` | function | 48 |
| 3 | `encryptSecret` | function | 52 |
| 4 | `decryptSecret` | function | 65 |
| 5 | `pruneRateBucket` | function | 86 |
| 6 | `keepRecentTimestamps` | function | 98 |
| 7 | `checkRateLimit` | function | 113 |
| 8 | `resetRateLimit` | function | 142 |
| 9 | `safeCompare` | function | 149 |
| 10 | `getAbuseBucket` | function | 160 |
| 11 | `pruneAbuseBucket` | function | 170 |
| 12 | `checkAbuseLock` | function | 188 |
| 13 | `recordAbuseFailure` | function | 211 |
| 14 | `clearAbuseFailure` | function | 235 |

### 3.148 `backend/src/serverUtils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isAdminAuthBootstrapPreloadEnabled` | function | 13 |
| 2 | `buildOriginFromParts` | function | 17 |
| 3 | `parseOriginHost` | function | 28 |
| 4 | `normalizeConfiguredHost` | function | 38 |
| 5 | `getConfiguredPublicHosts` | function | 48 |
| 6 | `getConfiguredCustomerPortalHosts` | function | 59 |
| 7 | `isConfiguredCustomerPortalHost` | function | 71 |
| 8 | `isAllowedRequestOrigin` | function | 81 |
| 9 | `isAllowedWebSocketOrigin` | function | 90 |
| 10 | `hostIsLoopbackPair` | function | 107 |
| 11 | `getTrustedDocumentOrigins` | function | 112 |
| 12 | `addOrigin` | const arrow | 114 |
| 13 | `buildPermissionsPolicy` | function | 143 |
| 14 | `getCloudflareAccessDiagnostics` | function | 170 |
| 15 | `sanitizeObjectKeys` | function | 196 |
| 16 | `sanitizeStringValue` | function | 219 |
| 17 | `sanitizeRequestPayload` | function | 225 |
| 18 | `sanitizeDeepStrings` | function | 232 |
| 19 | `isApiOrHealthPath` | function | 249 |
| 20 | `isSpaFallbackEligible` | function | 253 |
| 21 | `setNoStoreHeaders` | function | 261 |
| 22 | `setHtmlNoCacheHeaders` | function | 267 |
| 23 | `isCustomerPortalRoutePath` | function | 274 |
| 24 | `setAdminSpaHtmlHeaders` | function | 279 |
| 25 | `setTunnelSecurityHeaders` | function | 297 |
| 26 | `setFrontendStaticHeaders` | function | 340 |
| 27 | `setUploadStaticHeaders` | function | 395 |
| 28 | `mapServerError` | function | 405 |

### 3.149 `backend/src/services/aiGateway.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 6 |
| 2 | `trim` | function | 10 |
| 3 | `parseJsonSafe` | function | 14 |
| 4 | `clamp` | function | 22 |
| 5 | `maskApiKey` | function | 26 |
| 6 | `normalizeTextList` | function | 33 |
| 7 | `getProviderMeta` | function | 106 |
| 8 | `normalizeProviderPayload` | function | 110 |
| 9 | `serializeProviderRow` | function | 137 |
| 10 | `providerCanUseWebResearch` | function | 170 |
| 11 | `resolveProviderEndpoint` | function | 175 |
| 12 | `buildProviderHttpError` | function | 182 |
| 13 | `host` | const arrow | 185 |
| 14 | `buildGoogleMessageContents` | function | 198 |
| 15 | `joinGoogleTextParts` | function | 209 |
| 16 | `callChatProvider` | function | 218 |
| 17 | `testProviderConfig` | function | 307 |

### 3.150 `backend/src/services/backupPackages.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readCachedBackupVersions` | function | 30 |
| 2 | `writeCachedBackupVersions` | function | 39 |
| 3 | `clearBackupVersionCaches` | function | 53 |
| 4 | `getDb` | function | 58 |
| 5 | `q` | function | 62 |
| 6 | `nowSafeId` | function | 66 |
| 7 | `sha256` | function | 70 |
| 8 | `createSha256` | function | 74 |
| 9 | `sha256File` | function | 78 |
| 10 | `readTableRows` | function | 88 |
| 11 | `yieldToEventLoop` | function | 105 |
| 12 | `throwIfAborted` | function | 109 |
| 13 | `collectSetValues` | function | 117 |
| 14 | `startWorkerPromises` | function | 125 |
| 15 | `getManagedWritableState` | function | 133 |
| 16 | `writeStream` | function | 164 |
| 17 | `closeWriteStream` | function | 178 |
| 18 | `handleFinish` | const arrow | 182 |
| 19 | `handleError` | const arrow | 187 |
| 20 | `cleanup` | const arrow | 191 |
| 21 | `createProgressReporter` | function | 201 |
| 22 | `getSafeTableCount` | function | 240 |
| 23 | `streamBackupDataFile` | function | 248 |
| 24 | `buildObjectManifest` | function | 308 |
| 25 | `buildPackageMetadata` | function | 326 |
| 26 | `writeTextFileWithChecksum` | function | 380 |
| 27 | `writeJsonLinesFileWithChecksum` | function | 385 |
| 28 | `uploadPackageFile` | function | 398 |
| 29 | `writeAndUploadMetadataFiles` | function | 418 |
| 30 | `retryOperation` | function | 444 |
| 31 | `writeDestinationChunk` | function | 459 |
| 32 | `endDestination` | function | 472 |
| 33 | `handleFinish` | const arrow | 476 |
| 34 | `handleError` | const arrow | 481 |
| 35 | `cleanup` | const arrow | 485 |
| 36 | `copyOnePackageObject` | function | 495 |
| 37 | `abortCopy` | const arrow | 507 |
| 38 | `copyPackageObjects` | function | 534 |
| 39 | `worker` | function | 543 |
| 40 | `createFinalBackupPackage` | function | 585 |
| 41 | `validateLocalBackupPackage` | function | 700 |
| 42 | `getLocalBackupRoot` | function | 724 |
| 43 | `isDockerReleaseBackupRoot` | function | 729 |
| 44 | `isLocalBackupDirectoryName` | function | 734 |
| 45 | `listLocalBackupDirectories` | function | 740 |
| 46 | `getDirectoryBytes` | function | 761 |
| 47 | `planBackupPackageRetention` | function | 787 |
| 48 | `pruneLocalBackupVersions` | function | 807 |
| 49 | `groupRemoteBackupObjects` | function | 833 |
| 50 | `packageIds` | function | 855 |
| 51 | `summarizeRemovedRemotePackages` | function | 863 |
| 52 | `collectRemoteDeleteKeys` | function | 878 |
| 53 | `sortBackupVersionsByPackageId` | function | 888 |
| 54 | `pruneRemoteBackupVersions` | function | 894 |
| 55 | `pruneBackupVersions` | function | 918 |
| 56 | `readReusableLocalBackupPackage` | function | 935 |
| 57 | `findReusableLocalBackupPackage` | function | 960 |
| 58 | `listLocalBackupVersions` | function | 971 |
| 59 | `listBackupVersions` | function | 1003 |

### 3.151 `backend/src/services/firebaseAuth.ts`

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

### 3.152 `backend/src/services/googleDriveSync/index.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 80 |
| 2 | `trim` | function | 84 |
| 3 | `toBool` | function | 88 |
| 4 | `clamp` | function | 96 |
| 5 | `escapeDriveQueryValue` | function | 102 |
| 6 | `buildPlaceholders` | function | 106 |
| 7 | `readSettingsMap` | function | 114 |
| 8 | `writeSettingsMap` | function | 125 |
| 9 | `clearDriveSyncMappings` | function | 147 |
| 10 | `resetDriveSyncRootState` | function | 151 |
| 11 | `getDriveSyncConfig` | function | 161 |
| 12 | `getDriveSyncEntriesMap` | function | 197 |
| 13 | `hasCanonicalDriveLayout` | function | 210 |
| 14 | `upsertDriveSyncEntry` | function | 218 |
| 15 | `deleteDriveSyncEntry` | function | 255 |
| 16 | `deleteDriveSyncEntriesUnder` | function | 259 |
| 17 | `inferMimeType` | function | 266 |
| 18 | `hashFile` | function | 281 |
| 19 | `hashFileMany` | function | 291 |
| 20 | `yieldToEventLoop` | function | 315 |
| 21 | `sleep` | function | 319 |
| 22 | `buildAccessTokenKey` | function | 323 |
| 23 | `clearCachedAccessToken` | function | 330 |
| 24 | `describeFetchFailure` | function | 337 |
| 25 | `joinNonEmptyParts` | function | 351 |
| 26 | `fetchWithTimeout` | function | 359 |
| 27 | `exchangeRefreshToken` | function | 386 |
| 28 | `exchangeAuthorizationCode` | function | 428 |
| 29 | `driveApiRequest` | function | 451 |
| 30 | `driveApiUpload` | function | 468 |
| 31 | `fetchDriveUserProfile` | function | 484 |
| 32 | `findDriveItem` | function | 499 |
| 33 | `findDriveItems` | function | 504 |
| 34 | `listDriveChildren` | function | 519 |
| 35 | `getDriveFileIfExists` | function | 528 |
| 36 | `removeDuplicateDriveItems` | function | 540 |
| 37 | `buildSortedDirectoryList` | function | 552 |
| 38 | `getNonFolderDriveItems` | function | 561 |
| 39 | `getFirstNonFolderDriveItem` | function | 571 |
| 40 | `buildLiveSyncPathSet` | function | 578 |
| 41 | `selectStaleDriveMappings` | function | 589 |
| 42 | `createDriveFolder` | function | 598 |
| 43 | `ensureRootFolder` | function | 610 |
| 44 | `ensureDriveVersionFolder` | function | 629 |
| 45 | `writeSnapshotManifest` | function | 676 |
| 46 | `buildManagedSnapshotRoot` | function | 710 |
| 47 | `ensureSnapshotLayout` | function | 714 |
| 48 | `shouldSkipSnapshotFile` | function | 720 |
| 49 | `createDataRootSnapshot` | function | 727 |
| 50 | `collectSnapshotItems` | function | 769 |
| 51 | `ensureRemoteDirectories` | function | 819 |
| 52 | `updateRuntimeUploadProgress` | function | 870 |
| 53 | `clearRuntimeUploadProgress` | function | 877 |
| 54 | `initiateDriveResumableSession` | function | 884 |
| 55 | `queryResumableOffset` | function | 912 |
| 56 | `isInvalidUploadRequest` | function | 940 |
| 57 | `isDriveNotFoundError` | function | 944 |
| 58 | `isDriveWriteAccessError` | function | 948 |
| 59 | `canRecoverDriveItemWrite` | function | 956 |
| 60 | `putResumableChunk` | function | 960 |
| 61 | `uploadDriveFileResumable` | function | 995 |
| 62 | `uploadDriveFile` | function | 1069 |
| 63 | `updateDriveFile` | function | 1074 |
| 64 | `removeDriveFile` | function | 1079 |
| 65 | `runDriveSync` | function | 1091 |
| 66 | `runDriveSyncInternal` | function | 1102 |
| 67 | `scheduleDriveSync` | function | 1341 |
| 68 | `getDriveSyncStatus` | function | 1363 |
| 69 | `beginGoogleDriveOAuth` | function | 1412 |
| 70 | `prunePendingOauthStates` | function | 1436 |
| 71 | `finalizeGoogleDriveOAuth` | function | 1443 |
| 72 | `saveDriveSyncPreferences` | function | 1486 |
| 73 | `disconnectDriveSync` | function | 1507 |
| 74 | `forgetDriveSyncCredentials` | function | 1527 |
| 75 | `schedulePeriodicDriveSync` | function | 1535 |

### 3.153 `backend/src/services/googleDriveSync/versioning.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toSafeDate` | function | 25 |
| 2 | `toSafeVersionNumber` | function | 30 |
| 3 | `resolveDriveSyncVersionState` | function | 36 |
| 4 | `parseVersionName` | function | 75 |
| 5 | `buildDriveSyncVersionRows` | function | 81 |
| 6 | `selectDateExpiredVersions` | function | 101 |
| 7 | `selectExpiredDriveSyncVersions` | function | 113 |

### 3.154 `backend/src/services/googleOauth.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 27 |
| 2 | `unique` | function | 31 |
| 3 | `appendCallbackPath` | function | 43 |
| 4 | `getGoogleLoginOrigins` | function | 53 |
| 5 | `getGoogleLoginRedirectUris` | function | 62 |
| 6 | `getPrimaryRedirectUri` | function | 70 |
| 7 | `getDefaultReturnPath` | function | 74 |
| 8 | `normalizeReturnTarget` | function | 80 |
| 9 | `base64url` | function | 117 |
| 10 | `sha256Base64Url` | function | 122 |
| 11 | `getStateSecret` | function | 126 |
| 12 | `signState` | function | 130 |
| 13 | `verifyState` | function | 136 |
| 14 | `getGoogleLoginPublicConfig` | function | 152 |
| 15 | `buildGoogleOauthStartUrl` | function | 165 |
| 16 | `exchangeGoogleOauthCode` | function | 196 |
| 17 | `getGoogleUserFromTokens` | function | 219 |

### 3.155 `backend/src/services/importJobs.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 65 |
| 2 | `wait` | function | 69 |
| 3 | `yieldImportWorker` | function | 73 |
| 4 | `countCsvRowsFromFile` | function | 78 |
| 5 | `safeJson` | function | 123 |
| 6 | `normalizeImportJobListLimit` | function | 128 |
| 7 | `clearImportJobListCache` | function | 132 |
| 8 | `readCachedImportJobList` | function | 136 |
| 9 | `canCacheImportJobList` | function | 144 |
| 10 | `writeCachedImportJobList` | function | 148 |
| 11 | `stringify` | function | 161 |
| 12 | `cleanAuditActorText` | function | 165 |
| 13 | `normalizeAuditActor` | function | 171 |
| 14 | `attachInternalPolicyMetadata` | function | 181 |
| 15 | `stripInternalPolicyMetadata` | function | 192 |
| 16 | `getPersistedAuditActor` | function | 198 |
| 17 | `mergeAuditActors` | function | 203 |
| 18 | `auditWithActor` | function | 213 |
| 19 | `decorateImportJobRow` | function | 231 |
| 20 | `isCancelRequested` | function | 241 |
| 21 | `isImportJobStale` | function | 248 |
| 22 | `isImportJobWorkDrained` | function | 254 |
| 23 | `markStoredImportFilesCancelled` | function | 266 |
| 24 | `reconcileImportJobRow` | function | 276 |
| 25 | `ensureDir` | function | 297 |
| 26 | `ensureImportRoot` | function | 301 |
| 27 | `getJobRoot` | function | 305 |
| 28 | `assertSafeImportPath` | function | 309 |
| 29 | `deleteImportJobFiles` | function | 318 |
| 30 | `clearImportRuntimeFiles` | function | 325 |
| 31 | `createImportJob` | function | 336 |
| 32 | `getImportJob` | function | 357 |
| 33 | `buildSqlPlaceholders` | function | 363 |
| 34 | `collectRowIds` | function | 371 |
| 35 | `decorateImportJobRows` | function | 379 |
| 36 | `listImportJobs` | function | 388 |
| 37 | `updateJob` | function | 421 |
| 38 | `addJobError` | function | 457 |
| 39 | `getJobErrors` | function | 464 |
| 40 | `normalizeReviewText` | function | 474 |
| 41 | `normalizeReviewIdentifier` | function | 478 |
| 42 | `getBarcodeReviewIssue` | function | 482 |
| 43 | `isBlockingBarcodeIssue` | function | 499 |
| 44 | `buildProductImportReviewState` | function | 503 |
| 45 | `add` | const arrow | 507 |
| 46 | `duplicateGroupCount` | const arrow | 520 |
| 47 | `hasReviewQueryMatch` | function | 537 |
| 48 | `normalizeReviewFilter` | function | 557 |
| 49 | `matchesReviewFilter` | function | 565 |
| 50 | `hasAnyIdentifierField` | function | 573 |
| 51 | `buildProductReviewLabels` | function | 580 |
| 52 | `buildContactReviewLabels` | function | 604 |
| 53 | `hasMeaningfulImportRowValue` | function | 613 |
| 54 | `addReviewConflictCounts` | function | 621 |
| 55 | `normalizeGroupDecisions` | function | 635 |
| 56 | `addSetValues` | function | 645 |
| 57 | `setValuesToArray` | function | 651 |
| 58 | `firstRowNumber` | function | 659 |
| 59 | `buildProductReviewIndex` | function | 663 |
| 60 | `getProductConflictForReview` | function | 690 |
| 61 | `getReviewRowNumber` | function | 773 |
| 62 | `summarizeImportReviewRow` | function | 778 |
| 63 | `addProductReviewGroup` | function | 798 |
| 64 | `finalizeProductReviewSubgroups` | function | 843 |
| 65 | `finalizeProductReviewGroups` | function | 868 |
| 66 | `buildContactReviewIndex` | function | 890 |
| 67 | `getContactConflictForReview` | function | 910 |
| 68 | `getGenericImportConflictForReview` | function | 956 |
| 69 | `applyImportDecisionToRow` | function | 969 |
| 70 | `getImportDecisionMap` | function | 1037 |
| 71 | `getImportJobReview` | function | 1046 |
| 72 | `updateImportJobDecisions` | function | 1146 |
| 73 | `addJobFile` | function | 1174 |
| 74 | `getJobFiles` | function | 1194 |
| 75 | `markJobCancelled` | function | 1199 |
| 76 | `isCancelled` | function | 1203 |
| 77 | `waitForQueuedImportMedia` | function | 1209 |
| 78 | `finalizeSkippedImportImages` | function | 1236 |
| 79 | `normalizeLookup` | function | 1253 |
| 80 | `normalizeText` | function | 1257 |
| 81 | `getMimeTypeFromName` | function | 1261 |
| 82 | `normalizeProductSignature` | function | 1329 |
| 83 | `findProductWithSignature` | function | 1340 |
| 84 | `chooseParentProduct` | function | 1348 |
| 85 | `compareParentProductCandidate` | function | 1357 |
| 86 | `normalizeImportAction` | function | 1369 |
| 87 | `parseOptionalImportId` | function | 1377 |
| 88 | `parseIncomingImageRefs` | function | 1382 |
| 89 | `syncProductImageGallery` | function | 1413 |
| 90 | `loadCurrentGallery` | function | 1439 |
| 91 | `ensureParentProductExists` | function | 1451 |
| 92 | `assertUniqueProductFields` | function | 1460 |
| 93 | `findProductIdentifierConflict` | function | 1503 |
| 94 | `normalizeIdentifierConflictMode` | function | 1533 |
| 95 | `resolveNewProductIdentifiers` | function | 1541 |
| 96 | `copyImageIntoAssets` | function | 1578 |
| 97 | `resolveImageGallery` | function | 1617 |
| 98 | `ensureSettingOptionMap` | function | 1673 |
| 99 | `buildLookupMap` | function | 1692 |
| 100 | `getDefaultBranch` | function | 1700 |
| 101 | `upsertSettingJson` | function | 1709 |
| 102 | `normalizeRowForProduct` | function | 1716 |
| 103 | `createProductContext` | function | 1764 |
| 104 | `sortProductImportRows` | function | 1793 |
| 105 | `compareProductImportRows` | function | 1801 |
| 106 | `insertProductImportRow` | function | 1811 |
| 107 | `getProductsByNameForImport` | function | 1828 |
| 108 | `rememberProductForImport` | function | 1843 |
| 109 | `buildImportSignatureKey` | function | 1850 |
| 110 | `ensureCategory` | function | 1856 |
| 111 | `ensureUnit` | function | 1869 |
| 112 | `ensureBrand` | function | 1881 |
| 113 | `ensureSupplier` | function | 1894 |
| 114 | `determineBranch` | function | 1908 |
| 115 | `clearBranchBatchStockForProduct` | function | 1925 |
| 116 | `handleBranchStock` | function | 1936 |
| 117 | `recalcProductStock` | function | 1953 |
| 118 | `insertInventoryMovement` | function | 1957 |
| 119 | `seedBranchRows` | function | 1985 |
| 120 | `processProductRow` | function | 1992 |
| 121 | `processProductRowBatches` | function | 2282 |
| 122 | `flushProgress` | const arrow | 2294 |
| 123 | `processProductRows` | function | 2395 |
| 124 | `buildSafeCatalogOptionList` | function | 2405 |
| 125 | `preflightImportJob` | function | 2414 |
| 126 | `addFailure` | const arrow | 2428 |
| 127 | `buildImageLookup` | function | 2521 |
| 128 | `addImageLookupCandidate` | function | 2531 |
| 129 | `normalizeImageMatchKey` | function | 2536 |
| 130 | `processImageOnlyFiles` | function | 2546 |
| 131 | `addImageProductKey` | function | 2607 |
| 132 | `normalizeContactMode` | function | 2612 |
| 133 | `resolveContactValue` | function | 2617 |
| 134 | `parseFieldRules` | function | 2625 |
| 135 | `generateCustomerMembershipNumber` | function | 2631 |
| 136 | `normalizeImportedMembershipNumber` | function | 2647 |
| 137 | `processContactRowBatches` | function | 2653 |
| 138 | `processContactRows` | function | 2822 |
| 139 | `normalizeInventoryAction` | function | 2832 |
| 140 | `addCsvLookupValue` | function | 2839 |
| 141 | `buildProductCsvLookupMap` | function | 2845 |
| 142 | `buildBranchCsvLookupMap` | function | 2856 |
| 143 | `processInventoryRowBatches` | function | 2865 |
| 144 | `processInventoryRows` | function | 2955 |
| 145 | `processSalesRowBatches` | function | 2964 |
| 146 | `processSalesRows` | function | 3167 |
| 147 | `extractZipImages` | function | 3176 |
| 148 | `processImportJob` | function | 3246 |
| 149 | `runLocalJob` | function | 3384 |
| 150 | `normalizeQueueMode` | function | 3391 |
| 151 | `queueNameForMode` | function | 3395 |
| 152 | `configuredQueueDriver` | function | 3399 |
| 153 | `getImportQueueConcurrency` | function | 3404 |
| 154 | `hasBullProducer` | function | 3408 |
| 155 | `hasBullWorkers` | function | 3412 |
| 156 | `removeQueuedBullJobsForImport` | function | 3416 |
| 157 | `getBullConnection` | function | 3439 |
| 158 | `initializeBullQueue` | function | 3452 |
| 159 | `startImportWorkers` | function | 3471 |
| 160 | `startWorker` | const arrow | 3478 |
| 161 | `enqueueImportJob` | function | 3514 |
| 162 | `resetImportJobForRetry` | function | 3557 |
| 163 | `cancelImportJob` | function | 3610 |
| 164 | `listCancellableImportJobs` | function | 3643 |
| 165 | `waitForImportJobsToStop` | function | 3652 |
| 166 | `cancelAllImportJobs` | function | 3680 |
| 167 | `deleteImportJob` | function | 3712 |
| 168 | `deleteAllImportJobs` | function | 3743 |
| 169 | `approveImportJob` | function | 3760 |
| 170 | `recoverImportJobs` | function | 3784 |
| 171 | `getUnprocessedJobFiles` | function | 3806 |
| 172 | `getQueueStatus` | function | 3814 |
| 173 | `buildErrorsCsv` | function | 3831 |
| 174 | `escape` | const arrow | 3833 |
| 175 | `joinEscapedCsvRow` | function | 3846 |

### 3.156 `backend/src/services/integrationDoctor.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 44 |
| 2 | `hasValue` | function | 48 |
| 3 | `redactPresence` | function | 52 |
| 4 | `status` | function | 59 |
| 5 | `allCriticalChecksOk` | function | 67 |
| 6 | `unique` | function | 80 |
| 7 | `buildExpectedOauthChecklist` | function | 92 |
| 8 | `probeDatabase` | function | 120 |
| 9 | `getSafeTableCount` | function | 130 |
| 10 | `readCurrentBusinessCounts` | function | 139 |
| 11 | `findLatestVerifiedReleaseBackup` | function | 153 |
| 12 | `probeQueue` | function | 178 |
| 13 | `probeBackups` | function | 199 |
| 14 | `buildIntegrationDoctor` | function | 216 |

### 3.157 `backend/src/services/mediaQueue.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `wait` | function | 19 |
| 2 | `queueDriverRequired` | function | 23 |
| 3 | `isImportJobCancelled` | function | 27 |
| 4 | `getMediaConnection` | function | 34 |
| 5 | `initializeMediaQueue` | function | 47 |
| 6 | `processMediaOptimizationJob` | function | 65 |
| 7 | `runLocalMediaJob` | function | 119 |
| 8 | `enqueueMediaOptimization` | function | 131 |
| 9 | `startMediaWorker` | function | 157 |
| 10 | `getMediaQueueStatus` | function | 181 |

### 3.158 `backend/src/services/portalAi.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 15 |
| 2 | `toNumber` | function | 19 |
| 3 | `tokenize` | function | 24 |
| 4 | `nowMs` | function | 36 |
| 5 | `getProviderPriority` | function | 40 |
| 6 | `getProviderCapacity` | function | 45 |
| 7 | `getProviderMaxInputChars` | function | 50 |
| 8 | `getProviderMaxCompletionTokens` | function | 55 |
| 9 | `getProviderTimeoutMs` | function | 60 |
| 10 | `getProviderCooldownMs` | function | 65 |
| 11 | `getRuntimeState` | function | 71 |
| 12 | `pruneProviderState` | function | 86 |
| 13 | `keepRecentTimestamps` | function | 92 |
| 14 | `pruneVisitorActivity` | function | 100 |
| 15 | `registerVisitorActivity` | function | 108 |
| 16 | `countActiveVisitors` | function | 118 |
| 17 | `getVisitorMinuteCount` | function | 123 |
| 18 | `summarizeProfile` | function | 130 |
| 19 | `sanitizeQuestion` | function | 140 |
| 20 | `scoreProduct` | function | 144 |
| 21 | `buildQueryTermSet` | function | 176 |
| 22 | `productMatchesPreference` | function | 185 |
| 23 | `toPromptCandidate` | function | 195 |
| 24 | `selectCandidateProducts` | function | 212 |
| 25 | `buildPrompt` | function | 236 |
| 26 | `takeTrimmedStrings` | function | 266 |
| 27 | `normalizeCitations` | function | 277 |
| 28 | `buildRecommendationPayloads` | function | 293 |
| 29 | `parseAssistantPayload` | function | 322 |
| 30 | `listEnabledChatProviders` | function | 351 |
| 31 | `chooseProviderForAttempt` | function | 373 |
| 32 | `markProviderStart` | function | 395 |
| 33 | `markProviderSuccess` | function | 403 |
| 34 | `markProviderFailure` | function | 410 |
| 35 | `sumProviderCapacity` | function | 418 |
| 36 | `buildProviderUsageItems` | function | 426 |
| 37 | `getPortalAiUsageStatus` | function | 445 |
| 38 | `minProviderInputChars` | function | 460 |
| 39 | `hasAnyProfileValue` | function | 468 |
| 40 | `productsById` | function | 475 |
| 41 | `remainingProviders` | function | 483 |
| 42 | `generatePortalAiResponse` | function | 491 |

### 3.159 `backend/src/services/verification.ts`

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

### 3.160 `backend/src/sessionAuth.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDb` | function | 17 |
| 2 | `hashToken` | function | 21 |
| 3 | `buildSessionExpiry` | function | 25 |
| 4 | `createAuthSession` | function | 41 |
| 5 | `isSecureRequest` | function | 62 |
| 6 | `buildSessionCookieOptions` | function | 72 |
| 7 | `setAuthSessionCookie` | function | 82 |
| 8 | `clearAuthSessionCookie` | function | 88 |
| 9 | `buildRevocationTimestamp` | function | 98 |
| 10 | `getPresentedSessionToken` | function | 103 |
| 11 | `pruneSessionTouchCache` | function | 115 |
| 12 | `touchSessionIfDue` | function | 125 |
| 13 | `getSessionUser` | function | 146 |
| 14 | `revokeAuthSession` | function | 199 |
| 15 | `revokeUserSessions` | function | 211 |

### 3.161 `backend/src/settingsSnapshot.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeUploadPublicPath` | function | 16 |
| 2 | `isUploadPublicPath` | function | 33 |
| 3 | `toUploadObjectKey` | function | 41 |
| 4 | `sanitizeMediaPath` | function | 52 |
| 5 | `sanitizeMediaPathAsync` | function | 65 |
| 6 | `sanitizeMediaList` | function | 84 |
| 7 | `sanitizeMediaListAsync` | function | 101 |
| 8 | `uploadPublicPathExists` | function | 117 |
| 9 | `sanitizeSettingValue` | function | 132 |
| 10 | `sanitizeSettingValueAsync` | function | 140 |
| 11 | `sanitizeSettingsSnapshot` | function | 147 |
| 12 | `sanitizeSettingsSnapshotAsync` | function | 158 |

### 3.162 `backend/src/storage/organizationFolders.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trim` | function | 7 |
| 2 | `sanitizeOrganizationFolderLabel` | function | 12 |
| 3 | `buildOrganizationFolderName` | function | 23 |
| 4 | `extractOrganizationPublicId` | function | 30 |
| 5 | `findOrganizationFolderByPublicId` | function | 38 |

### 3.163 `backend/src/systemFsWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatBackupStamp` | function | 23 |
| 2 | `pad` | const arrow | 25 |
| 3 | `respond` | function | 33 |
| 4 | `fail` | function | 41 |
| 5 | `runExportFolder` | function | 50 |
| 6 | `runRelocateDataRoot` | function | 94 |
| 7 | `main` | function | 104 |

### 3.164 `backend/src/systemJobs.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `nowIso` | function | 12 |
| 2 | `makeJobId` | function | 16 |
| 3 | `publicJob` | function | 20 |
| 4 | `findActiveJob` | function | 44 |
| 5 | `safeJsonParse` | function | 55 |
| 6 | `getDb` | function | 64 |
| 7 | `ensureTable` | function | 68 |
| 8 | `persistJob` | function | 124 |
| 9 | `collectFinishedJobs` | function | 171 |
| 10 | `removeOldFinishedJobs` | function | 182 |
| 11 | `serializeJobRows` | function | 188 |
| 12 | `listActiveJobs` | function | 198 |
| 13 | `cleanupJobs` | function | 207 |
| 14 | `buildPersistSignature` | function | 224 |
| 15 | `markPersisted` | function | 239 |
| 16 | `flushPersistJob` | function | 244 |
| 17 | `shouldPersistJob` | function | 256 |
| 18 | `schedulePersistJob` | function | 274 |
| 19 | `updateJob` | function | 285 |
| 20 | `SystemJobCancelledError` | class | 302 |
| 21 | `startSystemJob` | function | 310 |
| 22 | `runWorker` | const arrow | 339 |
| 23 | `isCancelled` | const arrow | 358 |
| 24 | `throwIfCancelled` | const arrow | 359 |
| 25 | `progress` | const arrow | 362 |
| 26 | `cancelSystemJob` | function | 415 |
| 27 | `getSystemJob` | function | 432 |
| 28 | `listSystemJobs` | function | 444 |

### 3.165 `backend/src/uploadReferenceCleanup.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `safeJsonArray` | function | 13 |
| 2 | `repairMissingUploadReferences` | function | 22 |
| 3 | `repairMissingUploadReferencesAsync` | function | 134 |

### 3.166 `backend/src/uploadSecurity.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `bufferStartsWith` | function | 16 |
| 2 | `isLikelyCsvBuffer` | function | 26 |
| 3 | `detectBufferKind` | function | 42 |
| 4 | `getExpectedUploadedKind` | function | 63 |
| 5 | `validateImageMetadata` | function | 75 |
| 6 | `validateUploadedBuffer` | function | 93 |
| 7 | `validateUploadedPath` | function | 108 |

### 3.167 `backend/src/websocket.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `attachWss` | function | 24 |

### 3.168 `backend/src/workers/importWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `start` | function | 13 |
| 2 | `shutdown` | function | 23 |

### 3.169 `backend/src/workers/mediaWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `start` | function | 13 |
| 2 | `shutdown` | function | 22 |

### 3.170 `backend/test/accessControl.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |
| 2 | `makeReq` | function | 22 |

### 3.171 `backend/test/analyticsRuntime.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |

### 3.172 `backend/test/authOtpGuards.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 11 |

### 3.173 `backend/test/authSecurityFlow.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 19 |
| 2 | `runTests` | function | 23 |
| 3 | `makeTempRoot` | function | 37 |
| 4 | `getFreePort` | function | 41 |
| 5 | `waitForHealth` | function | 52 |
| 6 | `startServer` | function | 64 |
| 7 | `captureOutput` | const arrow | 67 |
| 8 | `stopServer` | function | 93 |
| 9 | `fetchJson` | function | 107 |
| 10 | `getDefaultOrganizationIds` | function | 119 |
| 11 | `cleanupTestUser` | function | 143 |
| 12 | `createTestUser` | function | 152 |
| 13 | `extractSessionCookie` | function | 171 |
| 14 | `login` | function | 178 |

### 3.174 `backend/test/backupDefaultDestination.test.ts`

- No top-level named symbols detected.

### 3.175 `backend/test/backupPerformanceHardening.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |

### 3.176 `backend/test/backupRetention.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.177 `backend/test/backupSchema.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 17 |

### 3.178 `backend/test/branchStockSearch.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 15 |
| 2 | `makeTempRoot` | function | 26 |
| 3 | `getFreePort` | function | 30 |
| 4 | `waitForHealth` | function | 41 |
| 5 | `startServer` | function | 53 |
| 6 | `stopServer` | function | 72 |
| 7 | `fetchJson` | function | 86 |
| 8 | `extractSessionCookie` | function | 98 |
| 9 | `loginAsAdmin` | function | 105 |
| 10 | `main` | function | 125 |

### 3.179 `backend/test/contactOptions.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.180 `backend/test/dataPath.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 16 |
| 2 | `makeTempRoot` | function | 27 |

### 3.181 `backend/test/defaultRoles.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `makeTempRoot` | function | 13 |
| 2 | `getFreePort` | function | 17 |
| 3 | `waitForHealth` | function | 28 |
| 4 | `startServer` | function | 40 |
| 5 | `stopServer` | function | 59 |
| 6 | `fetchJson` | function | 73 |
| 7 | `login` | function | 82 |
| 8 | `main` | function | 103 |

### 3.182 `backend/test/fileAssetStorageReconcile.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |

### 3.183 `backend/test/fileAssetUsageCache.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 15 |

### 3.184 `backend/test/fileRouteSecurityFlow.test.ts`

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
| 9 | `buildForm` | function | 129 |

### 3.185 `backend/test/fullAutomation.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `read` | function | 9 |
| 2 | `runTest` | function | 13 |

### 3.186 `backend/test/googleDriveSyncVersioning.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 15 |

### 3.187 `backend/test/idempotency.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.188 `backend/test/importCsv.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 13 |
| 2 | `collectBatches` | function | 26 |

### 3.189 `backend/test/importDecisionIntegrity.test.ts`

- No top-level named symbols detected.

### 3.190 `backend/test/importJobPerformanceHardening.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |

### 3.191 `backend/test/importJobStateMachine.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 35 |
| 2 | `writeImportFile` | function | 46 |
| 3 | `writeJobFile` | function | 53 |
| 4 | `main` | function | 60 |

### 3.192 `backend/test/importScaleSmoke.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |
| 2 | `makeLargeCsv` | function | 23 |
| 3 | `assertLargeCsvSmoke` | function | 38 |

### 3.193 `backend/test/initials.test.ts`

- No top-level named symbols detected.

### 3.194 `backend/test/integrationDoctor.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |

### 3.195 `backend/test/inventorySettingsMediaContracts.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |
| 2 | `readSource` | function | 20 |

### 3.196 `backend/test/mediaOptimization.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |
| 2 | `buildDeterministicPixels` | function | 34 |
| 3 | `buildLogoPixels` | function | 44 |

### 3.197 `backend/test/netSecurity.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |

### 3.198 `backend/test/notificationSummaryCache.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 16 |

### 3.199 `backend/test/offlineSecurity.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `read` | function | 5 |
| 2 | `runTest` | function | 9 |

### 3.200 `backend/test/ownedGoogleAuth.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `read` | function | 9 |
| 2 | `runTest` | function | 13 |

### 3.201 `backend/test/permissionPolicy.test.ts`

- No top-level named symbols detected.

### 3.202 `backend/test/portalInventoryRegression.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |
| 2 | `readSource` | function | 20 |

### 3.203 `backend/test/portalUtils.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.204 `backend/test/postgresCutoverReadiness.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 10 |

### 3.205 `backend/test/postgresDatabase.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 10 |
| 2 | `FakeClient` | class | 21 |
| 3 | `createFakeDb` | function | 37 |

### 3.206 `backend/test/postgresQueryCompat.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.207 `backend/test/productBatchHierarchy.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |
| 2 | `readSource` | function | 20 |

### 3.208 `backend/test/productExpiry.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |

### 3.209 `backend/test/productImportPolicies.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 15 |

### 3.210 `backend/test/productSearchPagination.test.ts`

- No top-level named symbols detected.

### 3.211 `backend/test/returnsListCache.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 19 |

### 3.212 `backend/test/rfidRoutes.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 7 |

### 3.213 `backend/test/routeContracts.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |
| 2 | `getRoutePaths` | function | 20 |

### 3.214 `backend/test/runtimeCache.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 24 |
| 2 | `main` | function | 35 |

### 3.215 `backend/test/runtimeVersion.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |

### 3.216 `backend/test/schemaMetadata.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 7 |
| 2 | `loadSchemaMetadataWithColumns` | function | 18 |
| 3 | `cleanup` | const arrow | 46 |

### 3.217 `backend/test/security.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 18 |

### 3.218 `backend/test/serverUtils.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 23 |
| 2 | `collectHeaders` | const arrow | 231 |
| 3 | `collectHeaders` | const arrow | 291 |

### 3.219 `backend/test/settingsSnapshotObjectStorage.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 7 |
| 2 | `withObjectStoreStub` | function | 23 |
| 3 | `restore` | const arrow | 38 |
| 4 | `createFakeCleanupDb` | function | 51 |

### 3.220 `backend/test/systemJobs.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `wait` | function | 6 |
| 2 | `waitForStatus` | function | 10 |
| 3 | `main` | function | 20 |

### 3.221 `backend/test/uploadSecurity.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.222 `backend/test/websocket.test.ts`

- No top-level named symbols detected.

### 3.223 `frontend/public/runtime-noise-guard.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `text` | function | 15 |
| 2 | `sourceFromEvent` | function | 18 |
| 3 | `isFirstPartyAsset` | function | 27 |
| 4 | `isInjectedSource` | function | 30 |
| 5 | `isKnownNoise` | function | 34 |
| 6 | `suppress` | function | 47 |
| 7 | `guardedInsertRule` | const function | 85 |
| 8 | `guardedCssRulesGetter` | const function | 101 |

### 3.224 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.js`

- No top-level named symbols detected.

### 3.225 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.worker.js`

- No top-level named symbols detected.

### 3.226 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd-threads.js`

- No top-level named symbols detected.

### 3.227 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd.js`

- No top-level named symbols detected.

### 3.228 `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core.js`

- No top-level named symbols detected.

### 3.229 `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js`

- No top-level named symbols detected.

### 3.230 `frontend/public/sw.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `openBusinessDb` | function | 27 |
| 2 | `txDone` | function | 34 |
| 3 | `requestResult` | function | 41 |
| 4 | `readSetting` | function | 47 |
| 5 | `stableStringify` | function | 54 |
| 6 | `sha256` | function | 61 |
| 7 | `readQueuedBusinessOutbox` | function | 68 |
| 8 | `putBusinessOutboxRow` | function | 77 |
| 9 | `deleteBusinessOutboxRow` | function | 84 |
| 10 | `readPendingFileChunks` | function | 91 |
| 11 | `readQueuedSales` | function | 100 |
| 12 | `putQueueRow` | function | 113 |
| 13 | `deleteQueueRow` | function | 124 |
| 14 | `broadcastSyncEvent` | function | 131 |
| 15 | `nextRetryAt` | function | 141 |
| 16 | `markQueueFailure` | function | 149 |
| 17 | `replayQueuedSale` | function | 157 |
| 18 | `responsePayload` | const arrow | 179 |
| 19 | `syncOutbox` | function | 220 |
| 20 | `isSameOrigin` | function | 339 |
| 21 | `isNeverCachedPath` | function | 347 |
| 22 | `isCacheableStaticPath` | function | 354 |
| 23 | `isHashedBuildAsset` | function | 360 |
| 24 | `appShellFallback` | function | 363 |
| 25 | `networkFirstStatic` | function | 383 |
| 26 | `cacheFirstStatic` | function | 402 |

### 3.231 `frontend/public/theme-bootstrap.js`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `text` | function | 14 |
| 2 | `normalizeTheme` | function | 17 |
| 3 | `readJsonObject` | function | 21 |
| 4 | `isKnownBridgeNoise` | function | 30 |
| 5 | `isKnownEvalNoise` | function | 38 |
| 6 | `isKnownStyleNoise` | function | 43 |
| 7 | `isStaleModuleGraphError` | function | 52 |
| 8 | `requestStaleModuleReload` | function | 58 |
| 9 | `isFirstPartyBuiltAssetSource` | function | 76 |
| 10 | `hasInjectedBundleSource` | function | 83 |
| 11 | `isGuardableSheetError` | function | 95 |
| 12 | `shouldSuppressRuntimeError` | function | 98 |
| 13 | `installStyleSheetGuards` | function | 110 |
| 14 | `safeInsertRule` | const function | 116 |
| 15 | `safeCssRulesGetter` | const function | 132 |

### 3.232 `frontend/src/AdminRoot.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `AdminRoot` | export default function | 6 |

### 3.233 `frontend/src/api/actionHistoryTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDevicePayload` | function | 7 |
| 2 | `getActionHistory` | export function | 11 |
| 3 | `getActionHistoryUsers` | export function | 24 |
| 4 | `createActionHistory` | export function | 32 |
| 5 | `updateActionHistory` | export function | 41 |
| 6 | `undoActionHistory` | export function | 50 |
| 7 | `redoActionHistory` | export function | 59 |

### 3.234 `frontend/src/api/actorQuery.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getCurrentUserContext` | export function | 10 |
| 2 | `appendActorQuery` | export function | 25 |

### 3.235 `frontend/src/api/aiTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getAiProviders` | export function | 6 |
| 2 | `createAiProvider` | export function | 14 |
| 3 | `updateAiProvider` | export function | 18 |
| 4 | `deleteAiProvider` | export function | 22 |
| 5 | `testAiProvider` | export function | 26 |
| 6 | `getAiResponses` | export function | 30 |

### 3.236 `frontend/src/api/appBootstrapTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `emptyBootstrap` | function | 31 |
| 2 | `readStoredUser` | function | 43 |
| 3 | `readErrorField` | function | 53 |
| 4 | `ensureBootstrapServerUrl` | function | 58 |
| 5 | `buildLocalBootstrap` | function | 69 |
| 6 | `takeEarlyAuthBootstrapPromise` | function | 81 |
| 7 | `takeEmbeddedAuthBootstrapPayload` | function | 90 |
| 8 | `getAppBootstrap` | export function | 104 |

### 3.237 `frontend/src/api/auditLogTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getLocalDbModule` | function | 13 |
| 2 | `getLocalMirrorsModule` | function | 18 |
| 3 | `scheduleAuditLogMirror` | function | 23 |
| 4 | `normalizeAuditPageSize` | function | 36 |
| 5 | `getAuditLogs` | export function | 41 |
| 6 | `deleteAuditLogsRetention` | export function | 71 |

### 3.238 `frontend/src/api/authTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `login` | export function | 16 |
| 2 | `logout` | export function | 37 |
| 3 | `resetPasswordWithOtp` | export function | 41 |
| 4 | `requestPasswordResetEmail` | export function | 45 |
| 5 | `completePasswordReset` | export function | 49 |
| 6 | `updateSessionDuration` | export function | 53 |
| 7 | `getVerificationCapabilities` | export function | 57 |
| 8 | `otpSetup` | export function | 65 |
| 9 | `otpConfirm` | export function | 69 |
| 10 | `otpDisable` | export function | 73 |
| 11 | `otpVerify` | export function | 77 |
| 12 | `otpStatus` | export function | 81 |
| 13 | `startGoogleOauth` | export function | 85 |
| 14 | `completeGoogleOauth` | export function | 89 |
| 15 | `unlinkGoogleOauth` | export function | 93 |
| 16 | `getOrganizationBootstrap` | export function | 97 |
| 17 | `searchOrganizations` | export function | 105 |
| 18 | `getCurrentOrganization` | export function | 110 |

### 3.239 `frontend/src/api/branchTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDevicePayload` | function | 9 |
| 2 | `encodeId` | function | 13 |
| 3 | `getBranches` | export function | 17 |
| 4 | `getBranchSummary` | export function | 40 |
| 5 | `createBranch` | export function | 56 |
| 6 | `updateBranch` | export function | 65 |
| 7 | `deleteBranch` | export function | 75 |
| 8 | `getBranchStock` | export function | 89 |
| 9 | `getTransfers` | export function | 98 |
| 10 | `transferStock` | export function | 111 |
| 11 | `getBranchStockIntegrity` | export function | 120 |
| 12 | `repairBranchStockIntegrity` | export function | 128 |

### 3.240 `frontend/src/api/browserDialogs.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `openCSVDialog` | export function | 8 |
| 2 | `openImageDialog` | export function | 28 |
| 3 | `getImageDataUrl` | export function | 32 |

### 3.241 `frontend/src/api/conflicts.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildAttemptedSettings` | export function | 22 |
| 2 | `buildAttemptedReturnItems` | export function | 31 |

### 3.242 `frontend/src/api/contactReadTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readLocalContacts` | function | 43 |
| 2 | `buildQueryString` | function | 49 |
| 3 | `appendQuery` | function | 64 |
| 4 | `getCachedRead` | function | 69 |
| 5 | `setCachedRead` | function | 75 |
| 6 | `scheduleLateMirror` | function | 80 |
| 7 | `run` | const arrow | 83 |
| 8 | `idle` | const arrow | 87 |
| 9 | `readContacts` | function | 96 |
| 10 | `getCustomers` | export function | 125 |
| 11 | `getSuppliers` | export function | 129 |
| 12 | `getDeliveryContacts` | export function | 133 |

### 3.243 `frontend/src/api/contactsTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getLocalDbModule` | function | 42 |
| 2 | `getCsvTemplateModule` | function | 47 |
| 3 | `buildContactCsvTemplate` | function | 52 |
| 4 | `getDevicePayload` | function | 57 |
| 5 | `encodeId` | function | 61 |
| 6 | `hasPagedParams` | function | 65 |
| 7 | `localSortedRows` | function | 70 |
| 8 | `readContactList` | function | 75 |
| 9 | `createContact` | function | 97 |
| 10 | `updateContact` | function | 107 |
| 11 | `deleteContact` | function | 121 |
| 12 | `bulkImportContact` | function | 131 |
| 13 | `getCustomers` | export function | 140 |
| 14 | `getCustomerPointSummaries` | export function | 144 |
| 15 | `createCustomer` | export function | 153 |
| 16 | `updateCustomer` | export function | 157 |
| 17 | `deleteCustomer` | export function | 161 |
| 18 | `bulkImportCustomers` | export function | 165 |
| 19 | `downloadCustomerTemplate` | export function | 169 |
| 20 | `getSuppliers` | export function | 179 |
| 21 | `createSupplier` | export function | 183 |
| 22 | `updateSupplier` | export function | 187 |
| 23 | `deleteSupplier` | export function | 191 |
| 24 | `bulkImportSuppliers` | export function | 195 |
| 25 | `downloadSupplierTemplate` | export function | 199 |
| 26 | `getDeliveryContacts` | export function | 209 |
| 27 | `createDeliveryContact` | export function | 213 |
| 28 | `updateDeliveryContact` | export function | 217 |
| 29 | `deleteDeliveryContact` | export function | 221 |
| 30 | `bulkImportDeliveryContacts` | export function | 225 |

### 3.244 `frontend/src/api/contactWriteTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createContactClientRequestId` | function | 7 |
| 2 | `ensureContactClientRequestId` | function | 14 |
| 3 | `buildContactWritePayload` | function | 23 |
| 4 | `createContact` | function | 36 |
| 5 | `updateContact` | function | 51 |
| 6 | `deleteContact` | function | 68 |
| 7 | `createCustomer` | export function | 84 |
| 8 | `updateCustomer` | export function | 88 |
| 9 | `deleteCustomer` | export function | 92 |
| 10 | `createSupplier` | export function | 96 |
| 11 | `updateSupplier` | export function | 100 |
| 12 | `deleteSupplier` | export function | 104 |
| 13 | `createDeliveryContact` | export function | 108 |
| 14 | `updateDeliveryContact` | export function | 112 |
| 15 | `deleteDeliveryContact` | export function | 116 |

### 3.245 `frontend/src/api/cooldownFallbacks.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readBrowserStoredNumber` | function | 23 |
| 2 | `writeBrowserStoredNumber` | function | 36 |
| 3 | `clearBrowserStoredNumber` | function | 44 |
| 4 | `getNotificationSummaryFallback` | export function | 52 |
| 5 | `readNotificationSummaryMissingUntil` | export function | 63 |
| 6 | `markNotificationSummaryMissing` | export function | 70 |
| 7 | `clearNotificationSummaryMissing` | export function | 76 |
| 8 | `getDriveSyncStatusFallback` | export function | 81 |
| 9 | `readDriveSyncStatusCooldown` | export function | 89 |
| 10 | `markDriveSyncStatusCooldown` | export function | 96 |
| 11 | `clearDriveSyncStatusCooldown` | export function | 102 |

### 3.246 `frontend/src/api/customTablesTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `encodePathSegment` | function | 24 |
| 2 | `tableDataPath` | function | 28 |
| 3 | `tableRowPath` | function | 32 |
| 4 | `getCustomTables` | export function | 36 |
| 5 | `createCustomTable` | export function | 47 |
| 6 | `getCustomTableData` | export function | 56 |
| 7 | `insertCustomRow` | export function | 64 |
| 8 | `updateCustomRow` | export function | 73 |
| 9 | `deleteCustomRow` | export function | 82 |

### 3.247 `frontend/src/api/dashboardTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDashboard` | export function | 4 |
| 2 | `getAnalytics` | export function | 11 |
| 3 | `getDashboardStartup` | export function | 19 |

### 3.248 `frontend/src/api/driveSync.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getGoogleDriveSyncStatus` | export function | 15 |
| 2 | `saveGoogleDriveSyncPreferences` | export function | 49 |
| 3 | `startGoogleDriveSyncOauth` | export function | 58 |
| 4 | `disconnectGoogleDriveSync` | export function | 67 |
| 5 | `forgetGoogleDriveSyncCredentials` | export function | 76 |
| 6 | `queueGoogleDriveSyncNow` | export function | 85 |
| 7 | `syncGoogleDriveNow` | export function | 94 |

### 3.249 `frontend/src/api/expectedUpdatedAt.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getLocalDbModule` | function | 13 |
| 2 | `hasExpectedUpdatedAt` | function | 18 |
| 3 | `withExpectedUpdatedAt` | export function | 22 |
| 4 | `withSettingsExpectedUpdatedAt` | export function | 42 |

### 3.250 `frontend/src/api/fileTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeFileListResult` | function | 57 |
| 2 | `appendUserAndDeviceFields` | function | 71 |
| 3 | `dataUrlToBlob` | function | 80 |
| 4 | `parseJsonResponse` | function | 87 |
| 5 | `getFiles` | export function | 95 |
| 6 | `uploadFileAsset` | export function | 105 |
| 7 | `finish` | const arrow | 122 |
| 8 | `deleteFileAsset` | export function | 172 |
| 9 | `uploadUserAvatar` | export function | 184 |

### 3.251 `frontend/src/api/http.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSameOriginApiBaseUrl` | function | 94 |
| 2 | `getReadServerBaseUrl` | function | 103 |
| 3 | `hasStoredAuthSession` | function | 107 |
| 4 | `isProtectedAdminHost` | function | 116 |
| 5 | `normalizeApiPath` | function | 133 |
| 6 | `isRequiredRuntimeApiPath` | export function | 145 |
| 7 | `getApiMismatchKey` | function | 150 |
| 8 | `getApiVersionMismatchCooldown` | export function | 154 |
| 9 | `dispatchApiVersionMismatch` | function | 165 |
| 10 | `createApiVersionMismatchError` | export function | 179 |
| 11 | `isApiVersionMismatchError` | export function | 190 |
| 12 | `markApiVersionMismatch` | export function | 194 |
| 13 | `cacheGet` | export function | 204 |
| 14 | `cacheSet` | export function | 208 |
| 15 | `cacheInvalidate` | export function | 209 |
| 16 | `cacheClearAll` | export function | 212 |
| 17 | `ensureSyncUpdateCacheListener` | export function | 225 |
| 18 | `logCall` | function | 244 |
| 19 | `getCallLog` | export function | 249 |
| 20 | `clearCallLog` | export function | 250 |
| 21 | `getClientMetaHeaders` | function | 252 |
| 22 | `createApiError` | function | 256 |
| 23 | `isCloudflareAccessRedirectResponse` | export function | 272 |
| 24 | `createCloudflareAccessError` | function | 285 |
| 25 | `dispatchUnauthorized` | function | 295 |
| 26 | `shouldCompareRuntimeVersions` | export function | 307 |
| 27 | `dispatchRuntimeVersionMismatch` | function | 323 |
| 28 | `checkRuntimeVersionFromHealth` | function | 335 |
| 29 | `createWriteBlockedError` | function | 342 |
| 30 | `dispatchWriteBlocked` | function | 353 |
| 31 | `dispatchTransientGatewayOutage` | function | 368 |
| 32 | `isWriteConflictError` | export function | 384 |
| 33 | `isWriteBlockedError` | export function | 388 |
| 34 | `isInvalidSessionError` | export function | 392 |
| 35 | `requireLiveServerWrite` | export function | 401 |
| 36 | `getConflictRefreshChannels` | function | 434 |
| 37 | `dispatchGlobalDataRefresh` | function | 443 |
| 38 | `sleep` | function | 452 |
| 39 | `hasUsableLocalData` | function | 456 |
| 40 | `noteReadFailure` | function | 482 |
| 41 | `stableStringifyForDedupe` | function | 503 |
| 42 | `clampDedupeBody` | function | 513 |
| 43 | `buildApiRequestDedupeKey` | export function | 519 |
| 44 | `methodAllowsRequestBody` | function | 525 |
| 45 | `__resetApiWriteDedupeForTests` | export function | 530 |
| 46 | `__resetApiHealthForTests` | export function | 534 |
| 47 | `apiFetch` | export function | 546 |
| 48 | `parsed` | const arrow | 606 |
| 49 | `isNetErr` | export function | 645 |
| 50 | `isTransientGatewayError` | export function | 651 |
| 51 | `isReachableServerResponseStatus` | export function | 656 |
| 52 | `shouldDispatchUnauthorized` | function | 667 |
| 53 | `isConnectivityError` | function | 680 |
| 54 | `isServerOnline` | export function | 706 |
| 55 | `setServerHealth` | function | 708 |
| 56 | `pingServerHealth` | export function | 723 |
| 57 | `primeServerHealthFromRuntime` | export function | 795 |
| 58 | `startHealthCheck` | export function | 816 |
| 59 | `ensureHealthLifecycleListeners` | export function | 828 |
| 60 | `cacheGetStale` | export function | 839 |
| 61 | `getChannelRefreshKey` | function | 848 |
| 62 | `emitCacheRefresh` | function | 853 |
| 63 | `clearInflight` | function | 867 |
| 64 | `hasReusableInflight` | function | 872 |

### 3.252 `frontend/src/api/httpState.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSyncServerUrl` | export function | 4 |
| 2 | `getSyncToken` | export function | 8 |
| 3 | `setSyncServerUrl` | export function | 12 |
| 4 | `setSyncToken` | export function | 16 |

### 3.253 `frontend/src/api/importJobsTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `encodeId` | function | 38 |
| 2 | `getSource` | function | 42 |
| 3 | `appendDeviceFields` | function | 46 |
| 4 | `notifyImportJobActivity` | function | 53 |
| 5 | `createImportJob` | export function | 63 |
| 6 | `listImportJobs` | export function | 73 |
| 7 | `getImportJob` | export function | 86 |
| 8 | `getImportJobReview` | export function | 94 |
| 9 | `updateImportJobDecisions` | export function | 103 |
| 10 | `preflightImportJob` | export function | 112 |
| 11 | `runImportJobAction` | function | 121 |
| 12 | `startImportJob` | export function | 131 |
| 13 | `approveImportJob` | export function | 135 |
| 14 | `cancelImportJob` | export function | 139 |
| 15 | `retryImportJob` | export function | 143 |
| 16 | `deleteImportJob` | export function | 147 |
| 17 | `getImportQueueStatus` | export function | 177 |
| 18 | `downloadImportJobErrors` | export function | 185 |
| 19 | `uploadImportJobCsv` | export function | 205 |
| 20 | `uploadImportJobZip` | export function | 214 |
| 21 | `uploadImportJobImages` | export function | 223 |

### 3.254 `frontend/src/api/importTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `apiFormPost` | export function | 15 |

### 3.255 `frontend/src/api/inventoryTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `scheduleInventoryCacheWrite` | function | 17 |
| 2 | `readInventoryCache` | function | 30 |
| 3 | `routeCachedInventoryQuery` | function | 34 |
| 4 | `getInventorySummary` | export function | 47 |
| 5 | `getInventoryStats` | export function | 56 |
| 6 | `searchInventoryProducts` | export function | 65 |
| 7 | `getInventoryBootstrap` | export function | 71 |
| 8 | `getInventoryMovements` | export function | 77 |
| 9 | `getInventoryReasons` | export function | 112 |

### 3.256 `frontend/src/api/inventoryWriteTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDevicePayload` | function | 7 |
| 2 | `adjustStock` | export function | 11 |
| 3 | `transferInventoryStock` | export function | 20 |
| 4 | `moveStockRow` | export function | 33 |
| 5 | `saveInventoryReasons` | export function | 42 |

### 3.257 `frontend/src/api/lazyLocalDb.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getLocalDbModule` | export function | 5 |
| 2 | `getLocalDb` | export function | 10 |

### 3.258 `frontend/src/api/localDb.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `localGetSettings` | export function | 148 |
| 2 | `localSaveSettings` | export function | 155 |
| 3 | `localGetSettingsMeta` | export function | 163 |
| 4 | `localSaveSettingsMeta` | export function | 167 |
| 5 | `replaceTableContents` | export function | 177 |
| 6 | `resetLocalMirrorDb` | export function | 221 |
| 7 | `clearLocalMirrorTables` | export function | 236 |
| 8 | `parseCSV` | export function | 264 |
| 9 | `splitCSVLine` | function | 268 |
| 10 | `buildCSVTemplate` | export function | 279 |

### 3.259 `frontend/src/api/localMirrors.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getLocalDbModule` | function | 13 |
| 2 | `scheduleMirrorWrite` | function | 18 |
| 3 | `idle` | const arrow | 24 |
| 4 | `shouldPersistLocalMirror` | export function | 53 |
| 5 | `purgeSensitiveLiveServerMirrors` | export function | 57 |
| 6 | `mirrorTable` | export function | 69 |

### 3.260 `frontend/src/api/lookupTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `listLookupRows` | function | 25 |
| 2 | `createLookupRow` | function | 48 |
| 3 | `updateLookupRow` | function | 57 |
| 4 | `deleteLookupRow` | function | 70 |
| 5 | `getCategories` | export function | 83 |
| 6 | `createCategory` | export function | 87 |
| 7 | `updateCategory` | export function | 91 |
| 8 | `deleteCategory` | export function | 95 |
| 9 | `getUnits` | export function | 99 |
| 10 | `createUnit` | export function | 103 |
| 11 | `updateUnit` | export function | 107 |
| 12 | `deleteUnit` | export function | 111 |

### 3.261 `frontend/src/api/methods.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadPortalTransport` | function | 42 |
| 2 | `loadSaleWriteTransport` | function | 47 |
| 3 | `loadCsvTemplateModule` | function | 52 |
| 4 | `loadBrowserDialogsModule` | function | 57 |
| 5 | `loadAiTransport` | function | 62 |
| 6 | `loadActionHistoryTransport` | function | 67 |
| 7 | `loadAuthTransport` | function | 72 |
| 8 | `loadContactsTransport` | function | 77 |
| 9 | `loadFileTransport` | function | 82 |
| 10 | `loadBranchTransport` | function | 87 |
| 11 | `loadInventoryTransport` | function | 92 |
| 12 | `loadInventoryWriteTransport` | function | 97 |
| 13 | `loadImportJobsTransport` | function | 102 |
| 14 | `loadProductWriteTransport` | function | 107 |
| 15 | `loadRfidTransport` | function | 112 |
| 16 | `loadSalesTransport` | function | 117 |
| 17 | `loadSettingsTransport` | function | 122 |
| 18 | `loadOfflineSnapshotTransport` | function | 127 |
| 19 | `loadReturnsTransport` | function | 132 |
| 20 | `loadPendingSyncTransport` | function | 137 |
| 21 | `loadDriveSyncTransport` | function | 142 |
| 22 | `loadNotificationSummaryTransport` | function | 147 |
| 23 | `loadSystemJobsTransport` | function | 152 |
| 24 | `loadLookupTransport` | function | 157 |
| 25 | `loadProductReadTransport` | function | 162 |
| 26 | `loadQueryCacheModule` | function | 167 |
| 27 | `loadLocalMirrorsModule` | function | 172 |
| 28 | `loadUserAdminTransport` | function | 177 |
| 29 | `loadUserReadTransport` | function | 182 |
| 30 | `loadClientRuntimeModule` | function | 187 |
| 31 | `loadAppRefreshModule` | function | 192 |
| 32 | `loadHttpCoreModule` | function | 197 |
| 33 | `buildImportCsvTemplate` | function | 202 |
| 34 | `openCSVDialog` | export function | 215 |
| 35 | `openImageDialog` | export function | 220 |
| 36 | `getImageDataUrl` | export function | 225 |
| 37 | `loadSystemRuntimeModule` | function | 234 |
| 38 | `callSystemRuntimeMethod` | function | 239 |
| 39 | `scheduleSensitiveMirrorPurge` | function | 246 |
| 40 | `run` | const arrow | 247 |
| 41 | `discardPendingSyncQueue` | export function | 265 |
| 42 | `getPendingSyncState` | export function | 270 |
| 43 | `retryPendingSyncNow` | export function | 275 |
| 44 | `refreshOfflineDeviceSnapshot` | export function | 280 |
| 45 | `invalidateClientRuntimeState` | function | 285 |
| 46 | `dispatchRefreshAppData` | function | 303 |
| 47 | `login` | const arrow | 327 |
| 48 | `logout` | const arrow | 331 |
| 49 | `resetPasswordWithOtp` | const arrow | 335 |
| 50 | `requestPasswordResetEmail` | const arrow | 339 |
| 51 | `completePasswordReset` | const arrow | 343 |
| 52 | `updateSessionDuration` | const arrow | 347 |
| 53 | `getVerificationCapabilities` | const arrow | 351 |
| 54 | `getSystemConfig` | const arrow | 355 |
| 55 | `getSystemBootstrap` | const arrow | 357 |
| 56 | `getNotificationSummary` | export function | 359 |
| 57 | `getSystemDebugLog` | const arrow | 363 |
| 58 | `startGoogleOauth` | const arrow | 365 |
| 59 | `completeGoogleOauth` | const arrow | 369 |
| 60 | `unlinkGoogleOauth` | const arrow | 373 |
| 61 | `getAppBootstrap` | const arrow | 377 |
| 62 | `getOrganizationBootstrap` | const arrow | 381 |
| 63 | `searchOrganizations` | const arrow | 385 |
| 64 | `getCurrentOrganization` | const arrow | 389 |
| 65 | `getSettings` | export function | 395 |
| 66 | `saveSettings` | export function | 400 |
| 67 | `getCategories` | const arrow | 406 |
| 68 | `updateCategory` | const arrow | 416 |
| 69 | `deleteCategory` | const arrow | 422 |
| 70 | `getUnits` | const arrow | 430 |
| 71 | `updateUnit` | const arrow | 440 |
| 72 | `deleteUnit` | const arrow | 446 |
| 73 | `getBranches` | const arrow | 454 |
| 74 | `getBranchSummary` | const arrow | 458 |
| 75 | `updateBranch` | const arrow | 466 |
| 76 | `deleteBranch` | const arrow | 470 |
| 77 | `getBranchStock` | const arrow | 474 |
| 78 | `getTransfers` | const arrow | 478 |
| 79 | `getBranchStockIntegrity` | const arrow | 486 |
| 80 | `getProducts` | const arrow | 496 |
| 81 | `searchProducts` | const arrow | 500 |
| 82 | `getProductBootstrap` | const arrow | 504 |
| 83 | `getProductsByIds` | const arrow | 508 |
| 84 | `getProductFilters` | const arrow | 512 |
| 85 | `getProductLookupUsage` | const arrow | 516 |
| 86 | `replaceProductLookupValues` | const arrow | 520 |
| 87 | `getCatalogMeta` | export function | 524 |
| 88 | `getCatalogProducts` | export function | 528 |
| 89 | `getPortalConfig` | export function | 532 |
| 90 | `getPortalBootstrap` | export function | 536 |
| 91 | `getPortalCatalogMeta` | export function | 540 |
| 92 | `getPortalCatalogProducts` | export function | 544 |
| 93 | `searchPortalCatalogProducts` | export function | 548 |
| 94 | `lookupPortalMembership` | export function | 552 |
| 95 | `createPortalSubmission` | export function | 556 |
| 96 | `getPortalAiStatus` | export function | 560 |
| 97 | `askPortalAi` | export function | 564 |
| 98 | `getPortalSubmissionsForReview` | const arrow | 568 |
| 99 | `reviewPortalSubmission` | const arrow | 572 |
| 100 | `getAiProviders` | const arrow | 577 |
| 101 | `createAiProvider` | const arrow | 581 |
| 102 | `updateAiProvider` | const arrow | 585 |
| 103 | `deleteAiProvider` | const arrow | 589 |
| 104 | `testAiProvider` | const arrow | 593 |
| 105 | `getAiResponses` | const arrow | 597 |
| 106 | `createProduct` | const arrow | 601 |
| 107 | `updateProduct` | const arrow | 605 |
| 108 | `deleteProduct` | const arrow | 609 |
| 109 | `otpSetup` | const arrow | 615 |
| 110 | `otpConfirm` | const arrow | 619 |
| 111 | `otpDisable` | const arrow | 623 |
| 112 | `otpVerify` | const arrow | 627 |
| 113 | `otpStatus` | const arrow | 631 |
| 114 | `listImportJobs` | const arrow | 651 |
| 115 | `getImportJobReview` | const arrow | 659 |
| 116 | `updateImportJobDecisions` | const arrow | 663 |
| 117 | `startImportJob` | const arrow | 671 |
| 118 | `approveImportJob` | const arrow | 675 |
| 119 | `cancelImportJob` | const arrow | 679 |
| 120 | `retryImportJob` | const arrow | 683 |
| 121 | `deleteImportJob` | const arrow | 687 |
| 122 | `getImportQueueStatus` | const arrow | 691 |
| 123 | `getFiles` | const arrow | 712 |
| 124 | `deleteFileAsset` | const arrow | 722 |
| 125 | `getActionHistory` | const arrow | 767 |
| 126 | `updateActionHistory` | const arrow | 775 |
| 127 | `getInventorySummary` | const arrow | 787 |
| 128 | `getInventoryStats` | const arrow | 791 |
| 129 | `getInventoryBootstrap` | const arrow | 795 |
| 130 | `searchInventoryProducts` | const arrow | 799 |
| 131 | `getInventoryMovements` | const arrow | 803 |
| 132 | `getInventoryReasons` | const arrow | 807 |
| 133 | `saveInventoryReasons` | const arrow | 811 |
| 134 | `getRfidStatus` | const arrow | 816 |
| 135 | `searchRfidTags` | const arrow | 824 |
| 136 | `recordRfidSessionEvents` | const arrow | 832 |
| 137 | `applyRfidSession` | const arrow | 840 |
| 138 | `createSale` | export function | 846 |
| 139 | `getSales` | const arrow | 851 |
| 140 | `getCustomers` | const arrow | 858 |
| 141 | `getCustomerPointSummaries` | const arrow | 862 |
| 142 | `createCustomer` | export function | 866 |
| 143 | `updateCustomer` | const arrow | 870 |
| 144 | `deleteCustomer` | const arrow | 874 |
| 145 | `downloadCustomerTemplate` | const arrow | 882 |
| 146 | `getSuppliers` | const arrow | 888 |
| 147 | `createSupplier` | export function | 892 |
| 148 | `updateSupplier` | const arrow | 896 |
| 149 | `deleteSupplier` | const arrow | 900 |
| 150 | `downloadSupplierTemplate` | const arrow | 908 |
| 151 | `getDeliveryContacts` | const arrow | 914 |
| 152 | `createDeliveryContact` | export function | 918 |
| 153 | `updateDeliveryContact` | const arrow | 922 |
| 154 | `deleteDeliveryContact` | const arrow | 926 |
| 155 | `getUsers` | const arrow | 936 |
| 156 | `updateUser` | const arrow | 944 |
| 157 | `getUserProfile` | const arrow | 948 |
| 158 | `getUserAuthMethods` | const arrow | 952 |
| 159 | `updateUserProfile` | const arrow | 956 |
| 160 | `disconnectUserAuthProvider` | const arrow | 960 |
| 161 | `changeUserPassword` | const arrow | 964 |
| 162 | `resetPassword` | const arrow | 968 |
| 163 | `getRoles` | const arrow | 974 |
| 164 | `updateRole` | const arrow | 982 |
| 165 | `deleteRole` | const arrow | 986 |
| 166 | `getSystemJob` | export function | 992 |
| 167 | `cancelSystemJob` | export function | 997 |
| 168 | `pollSystemJob` | export function | 1002 |
| 169 | `getIntegrationDoctor` | const arrow | 1007 |
| 170 | `queueBackupFolderExport` | export function | 1010 |
| 171 | `exportBackupFolder` | export function | 1015 |
| 172 | `queueBackupFolderRestore` | export function | 1019 |
| 173 | `importBackupFolder` | export function | 1024 |
| 174 | `getGoogleDriveSyncStatus` | const arrow | 1032 |
| 175 | `saveGoogleDriveSyncPreferences` | const arrow | 1037 |
| 176 | `startGoogleDriveSyncOauth` | const arrow | 1042 |
| 177 | `disconnectGoogleDriveSync` | const arrow | 1047 |
| 178 | `forgetGoogleDriveSyncCredentials` | const arrow | 1052 |
| 179 | `queueGoogleDriveSyncNow` | const arrow | 1057 |
| 180 | `syncGoogleDriveNow` | const arrow | 1062 |
| 181 | `resetData` | export function | 1067 |
| 182 | `factoryReset` | export function | 1073 |
| 183 | `downloadImportTemplate` | export function | 1080 |
| 184 | `openPath` | const arrow | 1127 |
| 185 | `getReturns` | const arrow | 1131 |
| 186 | `createReturn` | export function | 1135 |
| 187 | `createSupplierReturn` | export function | 1139 |
| 188 | `getReturn` | const arrow | 1143 |
| 189 | `updateSaleStatus` | const arrow | 1149 |
| 190 | `attachSaleCustomer` | const arrow | 1155 |
| 191 | `getSalesExport` | const arrow | 1160 |
| 192 | `updateReturn` | const arrow | 1164 |
| 193 | `testSyncServer` | const arrow | 1171 |
| 194 | `openFolderDialog` | const arrow | 1176 |
| 195 | `getDataPath` | const arrow | 1180 |
| 196 | `getScaleMigrationStatus` | const arrow | 1182 |
| 197 | `prepareScaleMigration` | const arrow | 1184 |
| 198 | `runScaleMigration` | const arrow | 1186 |
| 199 | `setDataPath` | export function | 1188 |
| 200 | `resetDataPath` | export function | 1193 |
| 201 | `browseDir` | const arrow | 1198 |

### 3.262 `frontend/src/api/multipartHeaders.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildMultipartHeaders` | export function | 10 |

### 3.263 `frontend/src/api/notificationSummary.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildNotificationSummaryFallback` | function | 12 |
| 2 | `getNotificationSummary` | export function | 22 |

### 3.264 `frontend/src/api/offlineSnapshotTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `canRefreshOfflineDeviceSnapshot` | function | 26 |
| 2 | `readOfflineDeviceSnapshotMeta` | function | 33 |
| 3 | `writeOfflineDeviceSnapshotMeta` | function | 42 |
| 4 | `getSettingsSnapshot` | function | 60 |
| 5 | `getReturnsSnapshot` | function | 69 |
| 6 | `runOfflineSnapshotStep` | function | 73 |
| 7 | `refreshOfflineDeviceSnapshot` | export function | 85 |
| 8 | `previousMeta` | const arrow | 93 |

### 3.265 `frontend/src/api/pendingSyncTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `discardPendingSyncQueue` | export function | 21 |
| 2 | `getPendingSyncState` | export function | 38 |
| 3 | `retryPendingSyncNow` | export function | 67 |

### 3.266 `frontend/src/api/portalHttp.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getPortalBaseUrl` | export function | 3 |
| 2 | `fetchJsonWithTimeout` | export function | 8 |

### 3.267 `frontend/src/api/portalPublicTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readJsonObject` | function | 12 |
| 2 | `getPortalBaseUrl` | function | 16 |
| 3 | `buildQueryString` | function | 20 |
| 4 | `appendQuery` | function | 32 |
| 5 | `appendQueryValue` | function | 36 |
| 6 | `fetchJsonWithTimeout` | function | 41 |
| 7 | `fetchPortalJson` | function | 63 |
| 8 | `getCatalogMeta` | export function | 72 |
| 9 | `getCatalogProducts` | export function | 76 |
| 10 | `getPortalConfig` | export function | 80 |
| 11 | `getPortalBootstrap` | export function | 84 |
| 12 | `getPortalCatalogMeta` | export function | 88 |
| 13 | `getPortalCatalogProducts` | export function | 92 |
| 14 | `searchPortalCatalogProducts` | export function | 96 |
| 15 | `lookupPortalMembership` | export function | 106 |
| 16 | `createPortalSubmission` | export function | 117 |
| 17 | `getPortalAiStatus` | export function | 129 |
| 18 | `askPortalAi` | export function | 133 |

### 3.268 `frontend/src/api/portalTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readJsonObject` | function | 18 |
| 2 | `fetchPortalJson` | function | 22 |
| 3 | `getCatalogMeta` | export function | 31 |
| 4 | `getCatalogProducts` | export function | 35 |
| 5 | `getPortalConfig` | export function | 39 |
| 6 | `getPortalBootstrap` | export function | 43 |
| 7 | `getPortalCatalogMeta` | export function | 47 |
| 8 | `getPortalCatalogProducts` | export function | 51 |
| 9 | `searchPortalCatalogProducts` | export function | 55 |
| 10 | `lookupPortalMembership` | export function | 70 |
| 11 | `createPortalSubmission` | export function | 81 |
| 12 | `getPortalAiStatus` | export function | 93 |
| 13 | `askPortalAi` | export function | 97 |
| 14 | `getPortalSubmissionsForReview` | export function | 109 |
| 15 | `reviewPortalSubmission` | export function | 113 |

### 3.269 `frontend/src/api/productImageUploadTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `dataUrlToBlob` | function | 10 |
| 2 | `uploadProductImage` | export function | 19 |

### 3.270 `frontend/src/api/productReadTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `scheduleProductCacheWrite` | function | 14 |
| 2 | `scheduleProductsMirror` | function | 27 |
| 3 | `readProductCache` | function | 40 |
| 4 | `routeCachedProductQuery` | function | 44 |
| 5 | `getProducts` | export function | 57 |
| 6 | `searchProducts` | export function | 74 |
| 7 | `getProductBootstrap` | export function | 80 |
| 8 | `getProductsByIds` | export function | 86 |
| 9 | `getProductFilters` | export function | 98 |
| 10 | `getProductLookupUsage` | export function | 104 |
| 11 | `replaceProductLookupValues` | export function | 109 |

### 3.271 `frontend/src/api/productWriteTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDevicePayload` | function | 9 |
| 2 | `encodeId` | function | 13 |
| 3 | `ensureSupplierExists` | function | 17 |
| 4 | `createProduct` | export function | 38 |
| 5 | `updateProduct` | export function | 49 |
| 6 | `deleteProduct` | export function | 60 |
| 7 | `createProductVariant` | export function | 70 |
| 8 | `bulkImportProducts` | export function | 79 |

### 3.272 `frontend/src/api/query.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildQueryString` | export function | 9 |
| 2 | `appendQuery` | export function | 27 |
| 3 | `normalizePositiveUniqueIds` | export function | 31 |
| 4 | `appendQueryValue` | function | 44 |

### 3.273 `frontend/src/api/queryCache.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildQueryCacheStorageKey` | export function | 6 |
| 2 | `clearCachedQueryResults` | export function | 40 |

### 3.274 `frontend/src/api/requestIds.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createClientRequestId` | export function | 3 |

### 3.275 `frontend/src/api/returnsReadTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `encodeId` | function | 4 |
| 2 | `getReturns` | export function | 8 |
| 3 | `getReturn` | export function | 18 |

### 3.276 `frontend/src/api/returnsTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `encodeId` | function | 21 |
| 2 | `getDevicePayload` | function | 25 |
| 3 | `getResultTimestamp` | function | 29 |
| 4 | `buildReturnNumber` | function | 34 |
| 5 | `attachAttemptedReturnUpdate` | function | 38 |
| 6 | `createReturn` | export function | 55 |
| 7 | `createSupplierReturn` | export function | 68 |
| 8 | `updateReturn` | export function | 81 |

### 3.277 `frontend/src/api/rfidTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDevicePayload` | function | 7 |
| 2 | `encodeId` | function | 11 |
| 3 | `getRfidStatus` | export function | 15 |
| 4 | `createRfidTag` | export function | 24 |
| 5 | `searchRfidTags` | export function | 33 |
| 6 | `createRfidSession` | export function | 42 |
| 7 | `recordRfidSessionEvents` | export function | 51 |
| 8 | `getRfidSessionReview` | export function | 63 |
| 9 | `applyRfidSession` | export function | 71 |

### 3.278 `frontend/src/api/salesTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `encodeId` | function | 21 |
| 2 | `getDevicePayload` | function | 25 |
| 3 | `getResultTimestamp` | function | 29 |
| 4 | `attachAttempted` | function | 34 |
| 5 | `createSale` | export function | 42 |
| 6 | `createSaleWithoutWriteDedupe` | export function | 51 |
| 7 | `getSales` | export function | 61 |
| 8 | `updateSaleStatus` | export function | 75 |
| 9 | `attachSaleCustomer` | export function | 103 |
| 10 | `getSalesExport` | export function | 135 |

### 3.279 `frontend/src/api/saleWriteTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `asText` | function | 27 |
| 2 | `createSaleClientRequestId` | function | 31 |
| 3 | `ensureSaleClientRequestId` | function | 38 |
| 4 | `localTable` | function | 44 |
| 5 | `buildOfflineSaleReceiptNumber` | function | 48 |
| 6 | `isRetryableOfflineSaleError` | function | 54 |
| 7 | `findQueuedSale` | function | 64 |
| 8 | `putOfflineSaleMirror` | function | 72 |
| 9 | `queueOfflineSale` | function | 98 |
| 10 | `queuedSaleBackoffMs` | function | 157 |
| 11 | `updateQueuedRow` | function | 162 |
| 12 | `completeQueuedSale` | function | 172 |
| 13 | `failQueuedSale` | function | 201 |
| 14 | `markQueuedSaleConflict` | function | 215 |
| 15 | `createSaleRequest` | function | 238 |
| 16 | `createSaleWithoutWriteDedupe` | function | 247 |
| 17 | `syncPendingSalesQueue` | export function | 257 |
| 18 | `createSale` | export function | 301 |

### 3.280 `frontend/src/api/settingsTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `asSettingsPayload` | function | 27 |
| 2 | `asSettingsConflictError` | function | 31 |
| 3 | `saveSettingsLocally` | function | 35 |
| 4 | `saveSettingsMeta` | function | 39 |
| 5 | `getServerSettings` | function | 43 |
| 6 | `getSettings` | export function | 50 |
| 7 | `saveSettingsOnce` | function | 64 |
| 8 | `saveSettings` | export function | 113 |

### 3.281 `frontend/src/api/syncPreview.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `serializePendingSyncPreview` | export function | 33 |

### 3.282 `frontend/src/api/syncRuntime.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `dispatchSyncUpdates` | export function | 15 |
| 2 | `emitSyncQueueChanged` | export function | 25 |
| 3 | `hasStoredUserSession` | export function | 32 |
| 4 | `registerOutboxBackgroundSync` | export function | 41 |

### 3.283 `frontend/src/api/systemJobs.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `wait` | function | 25 |
| 2 | `requireJobId` | function | 29 |
| 3 | `unwrapSystemJob` | function | 35 |
| 4 | `getSystemJob` | export function | 39 |
| 5 | `cancelSystemJob` | export function | 43 |
| 6 | `pollSystemJob` | export function | 55 |
| 7 | `queueBackupFolderExport` | export function | 83 |
| 8 | `exportBackupFolder` | export function | 92 |
| 9 | `queueBackupFolderRestore` | export function | 96 |
| 10 | `importBackupFolder` | export function | 103 |

### 3.284 `frontend/src/api/systemRuntime.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSystemConfig` | export function | 8 |
| 2 | `getSystemBootstrap` | export function | 12 |
| 3 | `getSystemDebugLog` | export function | 16 |
| 4 | `getIntegrationDoctor` | export function | 20 |
| 5 | `resetData` | export function | 31 |
| 6 | `factoryReset` | export function | 40 |
| 7 | `openPath` | export function | 49 |
| 8 | `testSyncServer` | export function | 57 |
| 9 | `openFolderDialog` | export function | 75 |
| 10 | `getDataPath` | export function | 87 |
| 11 | `getScaleMigrationStatus` | export function | 91 |
| 12 | `prepareScaleMigration` | export function | 95 |
| 13 | `runScaleMigration` | export function | 104 |
| 14 | `setDataPath` | export function | 113 |
| 15 | `resetDataPath` | export function | 122 |
| 16 | `browseDir` | export function | 131 |

### 3.285 `frontend/src/api/userAdminTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `encodeId` | function | 8 |
| 2 | `getUsers` | export function | 12 |
| 3 | `getRoles` | export function | 16 |
| 4 | `getUserProfile` | export function | 29 |
| 5 | `getUserAuthMethods` | export function | 37 |
| 6 | `createUser` | export function | 45 |
| 7 | `updateUser` | export function | 54 |
| 8 | `updateUserProfile` | export function | 64 |
| 9 | `disconnectUserAuthProvider` | export function | 74 |
| 10 | `changeUserPassword` | export function | 83 |
| 11 | `resetPassword` | export function | 92 |
| 12 | `createRole` | export function | 101 |
| 13 | `updateRole` | export function | 110 |
| 14 | `deleteRole` | export function | 120 |

### 3.286 `frontend/src/api/userReadTransport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getUsers` | export function | 4 |

### 3.287 `frontend/src/api/websocket.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `clearReconnectTimer` | function | 25 |
| 2 | `clearPingTimer` | function | 31 |
| 3 | `clearDeferredConnectTimer` | function | 37 |
| 4 | `hasStoredAuthSession` | function | 43 |
| 5 | `isProtectedAdminHost` | function | 52 |
| 6 | `shouldDebugWs` | function | 62 |
| 7 | `logWs` | function | 72 |
| 8 | `connectWS` | export function | 78 |
| 9 | `scheduleConnectWS` | export function | 170 |
| 10 | `disconnectWS` | export function | 180 |
| 11 | `reconnectWS` | export function | 201 |
| 12 | `resumeWS` | export function | 206 |
| 13 | `scheduleReconnect` | function | 212 |
| 14 | `isWSConnected` | export function | 231 |
| 15 | `ensureWebSocketLifecycleListeners` | export function | 235 |

### 3.288 `frontend/src/App.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `asPageModule` | function | 187 |
| 2 | `getAppShellApi` | function | 191 |
| 3 | `readStorageValue` | function | 195 |
| 4 | `hasUsableStoredAuthSession` | function | 203 |
| 5 | `getConnection` | function | 221 |
| 6 | `isPageId` | function | 227 |
| 7 | `normalizePageId` | function | 231 |
| 8 | `getErrorMessage` | function | 235 |
| 9 | `getChunkErrorMessage` | function | 336 |
| 10 | `isChunkLoadError` | function | 341 |
| 11 | `createChunkTimeoutError` | function | 350 |
| 12 | `isRetryableImportError` | function | 356 |
| 13 | `importWithTimeout` | function | 364 |
| 14 | `clearRetryMarker` | function | 380 |
| 15 | `buildChunkRecoveryUrl` | function | 387 |
| 16 | `deleteStaleShellCaches` | function | 398 |
| 17 | `clearStaleShellCaches` | function | 411 |
| 18 | `triggerChunkRecoveryReload` | function | 421 |
| 19 | `reload` | const arrow | 428 |
| 20 | `createChunkReloadStallError` | function | 438 |
| 21 | `shouldRetryChunk` | function | 444 |
| 22 | `lazyWithRetry` | function | 454 |
| 23 | `getWarmupImporters` | function | 532 |
| 24 | `shouldSkipBackgroundWarmup` | function | 543 |
| 25 | `shouldSkipIntentWarmup` | function | 552 |
| 26 | `getIntentPageId` | function | 561 |
| 27 | `scheduleIntentChunkLoad` | function | 567 |
| 28 | `run` | const arrow | 574 |
| 29 | `scheduleInitialPendingSyncRefresh` | function | 598 |
| 30 | `run` | const arrow | 604 |
| 31 | `scheduleDeferredPendingSyncPolling` | function | 626 |
| 32 | `isImportTrackerWakeEvent` | function | 640 |
| 33 | `isNotificationCenterWakeEvent` | function | 655 |
| 34 | `getDataWarmupLoaders` | function | 673 |
| 35 | `createWarmupLoader` | function | 682 |
| 36 | `runWarmupBatches` | function | 687 |
| 37 | `scheduleWarmupAfterLoad` | function | 696 |
| 38 | `run` | const arrow | 701 |
| 39 | `getPageEntryWarmupLoaders` | function | 719 |
| 40 | `useMountedPages` | function | 726 |
| 41 | `syncProfile` | const arrow | 740 |
| 42 | `useSyncErrorBanner` | function | 769 |
| 43 | `refreshPendingSync` | const arrow | 789 |
| 44 | `onSyncError` | const arrow | 794 |
| 45 | `onTransientOutage` | const arrow | 800 |
| 46 | `onSyncRecovered` | const arrow | 808 |
| 47 | `onQueueChanged` | const arrow | 816 |
| 48 | `onVaultLocked` | const arrow | 817 |
| 49 | `onAppUpdate` | const arrow | 818 |
| 50 | `onConflictReview` | const arrow | 819 |
| 51 | `useDeferredImportTrackerMount` | function | 867 |
| 52 | `enable` | const arrow | 880 |
| 53 | `enableWhenVisible` | const arrow | 884 |
| 54 | `onImportJobActivity` | const arrow | 889 |
| 55 | `useDeferredQuickPreferencesMount` | function | 914 |
| 56 | `enable` | const arrow | 927 |
| 57 | `useDeferredNotificationCenterMount` | function | 951 |
| 58 | `enable` | const arrow | 970 |
| 59 | `enableWhenVisible` | const arrow | 974 |
| 60 | `onSyncUpdate` | const arrow | 978 |
| 61 | `onNotificationActivity` | const arrow | 981 |
| 62 | `useVisibilityRecovery` | function | 1016 |
| 63 | `onVisible` | const arrow | 1021 |
| 64 | `onFocus` | const arrow | 1031 |
| 65 | `useChunkWarmup` | function | 1049 |
| 66 | `runWarmup` | const arrow | 1060 |
| 67 | `useIntentChunkWarmup` | function | 1102 |
| 68 | `warmIntentPage` | const arrow | 1109 |
| 69 | `useDataWarmup` | function | 1129 |
| 70 | `runWarmup` | const arrow | 1141 |
| 71 | `usePageEntryWarmup` | function | 1166 |
| 72 | `run` | const arrow | 1196 |
| 73 | `PageErrorBoundary` | class | 1225 |
| 74 | `Notification` | function | 1278 |
| 75 | `SyncErrorBanner` | function | 1291 |
| 76 | `GlobalScrollControls` | function | 1313 |
| 77 | `scrollTo` | const arrow | 1314 |
| 78 | `formatSyncTimestamp` | function | 1351 |
| 79 | `OfflineModeBanner` | function | 1366 |
| 80 | `PageLoader` | function | 1515 |
| 81 | `NotificationCenterFallback` | function | 1576 |
| 82 | `PageSlot` | function | 1591 |
| 83 | `PublicCatalogView` | function | 1617 |
| 84 | `App` | export default function | 1627 |
| 85 | `cleanupRecoveryStorageMarkers` | const arrow | 1705 |
| 86 | `onQueued` | const arrow | 1734 |
| 87 | `onSynced` | const arrow | 1747 |
| 88 | `handleLocationChange` | const arrow | 1772 |
| 89 | `processFavicon` | function | 1820 |

### 3.289 `frontend/src/app/AppContextCore.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizePriceValue` | function | 62 |
| 2 | `isBrokenLocalizedString` | export function | 68 |

### 3.290 `frontend/src/app/appShellUtils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `updateMountedPages` | export function | 18 |
| 2 | `getMountedPageLimit` | export function | 38 |
| 3 | `shouldWarmPageEntries` | export function | 56 |
| 4 | `getNotificationPrefix` | export function | 63 |
| 5 | `getNotificationColor` | export function | 70 |

### 3.291 `frontend/src/app/pathRouting.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeAppPath` | export function | 55 |
| 2 | `getAdminPageFromPath` | export function | 65 |
| 3 | `getAdminPathForPage` | export function | 72 |
| 4 | `isAdminAppPath` | export function | 76 |
| 5 | `isPublicCatalogPath` | export function | 83 |

### 3.292 `frontend/src/app/PublicCatalogAppProvider.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PublicCatalogAppProvider` | export function | 14 |

### 3.293 `frontend/src/app/publicErrorRecovery.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getRecoveryStorage` | function | 6 |
| 2 | `isPublicDomMutationError` | export function | 11 |
| 3 | `shouldAttemptPublicDomRecovery` | export function | 16 |
| 4 | `clearPublicDomRecoveryMarker` | export function | 32 |

### 3.294 `frontend/src/AppContext.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getAppApi` | function | 204 |
| 2 | `getErrorMessage` | function | 214 |
| 3 | `flattenTranslationTree` | function | 218 |
| 4 | `safeStorageGet` | function | 377 |
| 5 | `safeStorageSet` | function | 385 |
| 6 | `safeStorageRemove` | function | 391 |
| 7 | `getStoredUserPayload` | function | 397 |
| 8 | `getStoredUserExpiry` | function | 401 |
| 9 | `clearPersistedAuthState` | function | 405 |
| 10 | `persistAuthState` | function | 418 |
| 11 | `computeSessionExpiryMs` | function | 440 |
| 12 | `readDeviceSettings` | function | 456 |
| 13 | `writeDeviceSettings` | function | 465 |
| 14 | `writeStoredSessionDuration` | function | 471 |
| 15 | `readPendingOauthLink` | function | 479 |
| 16 | `clearPendingOauthLink` | function | 493 |
| 17 | `readOauthCallbackResult` | function | 499 |
| 18 | `clearOauthCallbackResult` | function | 510 |
| 19 | `mergeSettingsWithDeviceOverrides` | function | 516 |
| 20 | `normalizeDateInput` | function | 520 |
| 21 | `buildRuntimeDescriptorFromBootstrap` | function | 526 |
| 22 | `getInitialAdminPage` | function | 555 |
| 23 | `LoadingScreen` | function | 560 |
| 24 | `AccessDenied` | function | 573 |
| 25 | `AppProvider` | export function | 585 |
| 26 | `persistAutoSyncUrl` | const arrow | 667 |
| 27 | `onUpdate` | const arrow | 865 |
| 28 | `onStatus` | const arrow | 897 |
| 29 | `poll` | const arrow | 906 |
| 30 | `onError` | const arrow | 926 |
| 31 | `onWriteBlocked` | const arrow | 948 |
| 32 | `onRuntimeMismatch` | const arrow | 958 |
| 33 | `onConflict` | const arrow | 978 |
| 34 | `onUnauthorized` | const arrow | 1047 |
| 35 | `handleOtpLogin` | const arrow | 1106 |
| 36 | `handleUserUpdated` | const arrow | 1148 |
| 37 | `discoverSyncUrl` | const arrow | 1185 |
| 38 | `runStartupHealthProbe` | const arrow | 1208 |
| 39 | `loadLanguagePack` | const arrow | 1302 |
| 40 | `scheduleDeferredLanguagePack` | const arrow | 1313 |
| 41 | `runWhenIdle` | const arrow | 1314 |
| 42 | `clearCallbackUrl` | const arrow | 1618 |
| 43 | `clearPendingLink` | const arrow | 1622 |
| 44 | `run` | const arrow | 1626 |

### 3.295 `frontend/src/components/auth/Login.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getAuthApi` | function | 177 |
| 2 | `getErrorMessage` | function | 182 |
| 3 | `readPendingOauthLogin` | function | 186 |
| 4 | `clearPendingOauthLogin` | function | 200 |
| 5 | `readOauthCallbackResult` | function | 206 |
| 6 | `clearOauthCallbackResult` | function | 217 |
| 7 | `OauthButton` | function | 223 |
| 8 | `ModeBackButton` | function | 237 |
| 9 | `Login` | export default function | 250 |
| 10 | `rememberOrganization` | const arrow | 322 |
| 11 | `loadCapabilities` | const arrow | 358 |
| 12 | `bootstrap` | const arrow | 378 |
| 13 | `clearCallbackUrl` | const arrow | 457 |
| 14 | `run` | const arrow | 462 |
| 15 | `rememberedOrg` | const arrow | 517 |
| 16 | `handleLogin` | const arrow | 571 |
| 17 | `handleOtp` | const arrow | 601 |
| 18 | `handleOtpInput` | const arrow | 635 |
| 19 | `handleResetWithOtp` | const arrow | 640 |
| 20 | `handleResetWithEmail` | const arrow | 677 |
| 21 | `handleCompleteEmailReset` | const arrow | 706 |
| 22 | `handleStartOauth` | const arrow | 739 |
| 23 | `closeAuxMode` | const arrow | 787 |

### 3.296 `frontend/src/components/branches/Branches.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBranchApi` | function | 205 |
| 2 | `getErrorMessage` | function | 217 |
| 3 | `isBranchRecord` | function | 221 |
| 4 | `isTransferRecord` | function | 225 |
| 5 | `BranchStatTile` | function | 229 |
| 6 | `formatTransferDate` | function | 246 |
| 7 | `Branches` | export default function | 263 |
| 8 | `promise` | const arrow | 315 |
| 9 | `loadBranchStock` | const arrow | 462 |
| 10 | `loadMoreBranchStock` | const arrow | 483 |
| 11 | `handleSaveBranch` | const arrow | 514 |
| 12 | `handleDelete` | const arrow | 588 |
| 13 | `handleBulkDelete` | const arrow | 636 |
| 14 | `toggleSelect` | const arrow | 722 |
| 15 | `toggleSelectAll` | const arrow | 731 |

### 3.297 `frontend/src/components/branches/BranchForm.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `BranchForm` | export default function | 37 |
| 2 | `handleSave` | const arrow | 57 |

### 3.298 `frontend/src/components/branches/TransferModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getTransferApi` | function | 76 |
| 2 | `getErrorMessage` | function | 83 |
| 3 | `normalizeTransferStockRows` | function | 87 |
| 4 | `TransferModal` | export default function | 101 |
| 5 | `loadStock` | function | 165 |
| 6 | `handleTransfer` | const arrow | 213 |

### 3.299 `frontend/src/components/catalog/catalogAssetUrls.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trimBaseUrl` | function | 9 |
| 2 | `normalizeUploadPath` | function | 13 |
| 3 | `isLocalLikeHostname` | function | 21 |
| 4 | `getSafeCurrentOrigin` | function | 25 |
| 5 | `getStoredCatalogAssetBaseUrl` | function | 37 |
| 6 | `api` | const arrow | 40 |
| 7 | `appendAssetVersion` | function | 51 |
| 8 | `resolveCatalogAssetUrl` | export function | 66 |

### 3.300 `frontend/src/components/catalog/CatalogEditorSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toAiProviderOptions` | function | 118 |
| 2 | `CatalogEditorSurface` | export default function | 219 |
| 3 | `CatalogEditorSurfaceContent` | function | 227 |

### 3.301 `frontend/src/components/catalog/CatalogImageField.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CatalogImageField` | export default function | 29 |

### 3.302 `frontend/src/components/catalog/catalogImages.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getImageApi` | function | 19 |
| 2 | `isRecentlyBrokenCatalogImage` | function | 23 |
| 3 | `markBrokenCatalogImage` | function | 31 |
| 4 | `CatalogProductImage` | export default function | 36 |
| 5 | `loadImageData` | function | 78 |

### 3.303 `frontend/src/components/catalog/CatalogPage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadCatalogEditorSurface` | const arrow | 48 |
| 2 | `loadCatalogProductsSection` | const arrow | 49 |
| 3 | `loadCatalogSecondaryTabs` | const arrow | 50 |
| 4 | `loadPortalTranslateControllerModule` | function | 57 |
| 5 | `loadPortalLanguagePacksModule` | function | 63 |
| 6 | `loadPortalContentI18nModule` | function | 69 |
| 7 | `getCatalogApi` | function | 202 |
| 8 | `getCatalogErrorMessage` | function | 206 |
| 9 | `createInitialUploadState` | function | 210 |
| 10 | `isTemporaryPreviewUrl` | function | 224 |
| 11 | `sanitizePersistedMediaPath` | function | 229 |
| 12 | `buildCacheBustedMediaPath` | function | 236 |
| 13 | `reduceUploadState` | function | 254 |
| 14 | `normalizePortalInitialOptions` | function | 321 |
| 15 | `normalizeCatalogOptions` | function | 330 |
| 16 | `normalizeBrandOptions` | function | 341 |
| 17 | `getAboutBlockLabel` | function | 346 |
| 18 | `withAssetVersion` | function | 352 |
| 19 | `sanitizePortalMediaValue` | function | 362 |
| 20 | `tt` | function | 372 |
| 21 | `toBoolean` | function | 386 |
| 22 | `toNumber` | function | 393 |
| 23 | `normalizePriceDisplay` | function | 400 |
| 24 | `normalizeHexColor` | function | 406 |
| 25 | `normalizeExternalUrl` | function | 412 |
| 26 | `createFaqId` | function | 428 |
| 27 | `normalizeFaqItems` | function | 432 |
| 28 | `translatedPortalText` | function | 488 |
| 29 | `translateConfiguredFaqText` | function | 494 |
| 30 | `localizeConfiguredFaqItems` | function | 501 |
| 31 | `buildFaqStarterItems` | function | 509 |
| 32 | `buildAiFaqStarterItems` | function | 518 |
| 33 | `hexToRgba` | function | 528 |
| 34 | `readPortalCache` | function | 539 |
| 35 | `writePortalCache` | function | 574 |
| 36 | `normalizePortalPath` | function | 592 |
| 37 | `isReservedPortalPath` | function | 605 |
| 38 | `getPortalTabs` | function | 609 |
| 39 | `resolvePortalActiveTab` | function | 620 |
| 40 | `buildDraft` | function | 628 |
| 41 | `applyDraft` | function | 728 |
| 42 | `getBranchQty` | function | 852 |
| 43 | `getStockStatus` | function | 859 |
| 44 | `normalizeProductGallery` | function | 870 |
| 45 | `normalizePortalProductSearch` | function | 887 |
| 46 | `buildRecommendedProductOption` | function | 891 |
| 47 | `productMatchesRecommendedSearch` | function | 901 |
| 48 | `formatDateTime` | function | 916 |
| 49 | `formatPortalPrice` | function | 924 |
| 50 | `readImageFileAsDataUrl` | function | 936 |
| 51 | `readImageFilesAsDataUrls` | function | 945 |
| 52 | `pickImageAsDataUrl` | function | 968 |
| 53 | `pickMultipleImagesAsDataUrls` | function | 981 |
| 54 | `replaceVars` | function | 994 |
| 55 | `canonicalPortalTranslateLanguage` | function | 1033 |
| 56 | `normalizeExternalTranslateTarget` | function | 1042 |
| 57 | `isFirstPartyTranslateTarget` | function | 1048 |
| 58 | `normalizePortalTranslateChoice` | function | 1055 |
| 59 | `readGoogleTranslateCookieTarget` | function | 1063 |
| 60 | `readStoredTranslateTargetLocal` | function | 1077 |
| 61 | `removePortalTranslateWidgetHostLocal` | function | 1090 |
| 62 | `isDocumentVisible` | function | 1095 |
| 63 | `sleep` | function | 1100 |
| 64 | `CatalogPage` | export default function | 1206 |
| 65 | `updateMediaUploadState` | const arrow | 1492 |
| 66 | `forgetMediaUploadState` | const arrow | 1499 |
| 67 | `loadAssistantStatus` | function | 1551 |
| 68 | `openProductGallery` | function | 1574 |
| 69 | `changeTranslateTarget` | function | 1587 |
| 70 | `isPortalLoadCurrent` | function | 1647 |
| 71 | `loadPortalEditorData` | function | 1651 |
| 72 | `refreshPortalView` | function | 1693 |
| 73 | `loadPortal` | function | 1722 |
| 74 | `ensureLink` | const arrow | 1986 |
| 75 | `renderRoundedFavicon` | const arrow | 2026 |
| 76 | `updateVisibility` | const arrow | 2103 |
| 77 | `handleScroll` | const arrow | 2133 |
| 78 | `setupExternalTranslateWidget` | function | 2177 |
| 79 | `toggleFilterValue` | function | 2290 |
| 80 | `clearPortalFilters` | function | 2298 |
| 81 | `setDraft` | function | 2306 |
| 82 | `toggleRecommendedProduct` | function | 2311 |
| 83 | `openPortalImage` | function | 2320 |
| 84 | `setAboutBlocksDraft` | function | 2331 |
| 85 | `setPromoItemsDraft` | function | 2335 |
| 86 | `getPortalMediaValue` | function | 2339 |
| 87 | `setPortalMediaValue` | function | 2353 |
| 88 | `clearPortalUploadPreview` | function | 2367 |
| 89 | `clearPortalMediaTarget` | function | 2373 |
| 90 | `uploadPortalMedia` | function | 2384 |
| 91 | `cancelPortalMediaUpload` | function | 2455 |
| 92 | `updateAboutBlock` | function | 2461 |
| 93 | `updatePromoItem` | function | 2467 |
| 94 | `addAboutBlock` | function | 2473 |
| 95 | `addPromoItem` | function | 2477 |
| 96 | `moveAboutBlockBefore` | function | 2481 |
| 97 | `removeAboutBlock` | function | 2493 |
| 98 | `movePromoItemBefore` | function | 2504 |
| 99 | `removePromoItem` | function | 2516 |
| 100 | `setFaqDraft` | function | 2527 |
| 101 | `addFaqItem` | function | 2531 |
| 102 | `mergeFaqStarterItems` | function | 2542 |
| 103 | `addFaqStarterSet` | function | 2555 |
| 104 | `addAiFaqStarterSet` | function | 2559 |
| 105 | `updateFaqItem` | function | 2563 |
| 106 | `removeFaqItem` | function | 2569 |
| 107 | `clearAssistantState` | function | 2573 |
| 108 | `uploadDraftImage` | function | 2588 |
| 109 | `uploadAboutBlockMedia` | function | 2592 |
| 110 | `uploadPromoItemMedia` | function | 2598 |
| 111 | `openFilePicker` | function | 2602 |
| 112 | `handleFilePickerSelect` | function | 2606 |
| 113 | `savePortalDraft` | function | 2634 |
| 114 | `askAssistant` | function | 2826 |
| 115 | `refreshMembershipData` | function | 2872 |
| 116 | `handleMembershipLookup` | function | 2914 |
| 117 | `addSubmissionImages` | function | 2927 |
| 118 | `handleSubmissionPaste` | function | 2937 |
| 119 | `handleSubmitShareProof` | function | 2953 |
| 120 | `handleReviewSubmission` | function | 3000 |
| 121 | `renderCatalogSection` | function | 3160 |
| 122 | `handleUploadSubmissionImages` | const arrow | 3183 |
| 123 | `handlePortalTabChange` | const arrow | 3239 |
| 124 | `renderSecondaryTabPanel` | function | 3247 |
| 125 | `renderSecondaryTabFallback` | function | 3259 |
| 126 | `renderSecondaryTabSection` | function | 3283 |
| 127 | `scrollPublicPortal` | const arrow | 3408 |

### 3.304 `frontend/src/components/catalog/CatalogPageContext.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CatalogPageProvider` | export function | 10 |

### 3.305 `frontend/src/components/catalog/catalogPagination.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `clampCatalogPage` | function | 26 |
| 2 | `CatalogPageSizeSelect` | function | 40 |
| 3 | `CatalogPaginationControls` | export default function | 80 |
| 4 | `commitPageDraft` | const arrow | 106 |
| 5 | `handlePageInputKeyDown` | const arrow | 117 |

### 3.306 `frontend/src/components/catalog/CatalogPreviewSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `CatalogPreviewSurface` | export default function | 114 |
| 2 | `handlePortalTabClick` | const arrow | 152 |

### 3.307 `frontend/src/components/catalog/CatalogProductsSection.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBadgeIcon` | function | 120 |
| 2 | `getBadgeToneClass` | function | 128 |
| 3 | `getProductInitial` | function | 137 |
| 4 | `CatalogProductsSection` | export default function | 145 |

### 3.308 `frontend/src/components/catalog/CatalogSecondaryTabs.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toAssistantSelectOptions` | function | 204 |
| 2 | `normalizePortalColor` | function | 275 |
| 3 | `CatalogMembershipSection` | function | 280 |
| 4 | `CatalogAboutSection` | function | 626 |
| 5 | `CatalogFaqSection` | function | 847 |
| 6 | `CatalogAiSection` | function | 901 |
| 7 | `CatalogSecondaryTabs` | export default function | 1109 |

### 3.309 `frontend/src/components/catalog/catalogUi.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `statusClass` | function | 22 |
| 2 | `SectionShell` | export function | 29 |
| 3 | `SummaryTile` | export function | 45 |
| 4 | `StatusPill` | export function | 69 |

### 3.310 `frontend/src/components/catalog/portalCatalogDisplay.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toFiniteNumber` | function | 25 |
| 2 | `normalizePriceValue` | function | 30 |
| 3 | `normalizeDiscountPercent` | function | 36 |
| 4 | `isPortalDiscountActive` | function | 40 |
| 5 | `calculatePortalDiscount` | function | 53 |
| 6 | `normalizeRecommendedProductIds` | export function | 91 |
| 7 | `getPortalGridClass` | export function | 114 |
| 8 | `getPortalMobileGridClass` | export function | 127 |
| 9 | `productMatchesPortalBranches` | export function | 134 |
| 10 | `getPortalPromotionDetails` | export function | 142 |
| 11 | `buildPortalPricePresentation` | export function | 155 |
| 12 | `buildPortalHighlightBadges` | export function | 173 |
| 13 | `replaceRankVars` | function | 237 |
| 14 | `normalizeRankBadgeLabel` | function | 241 |

### 3.311 `frontend/src/components/catalog/portalContentI18n.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isPlainObject` | function | 558 |
| 2 | `normalizeLanguageKey` | function | 562 |
| 3 | `normalizeText` | function | 571 |
| 4 | `normalizePortalTranslations` | export function | 575 |
| 5 | `stringifyPortalTranslations` | export function | 589 |
| 6 | `getLanguageBlock` | function | 595 |
| 7 | `pickTranslatedText` | function | 607 |
| 8 | `pickDefaultFirstPartyText` | function | 623 |
| 9 | `getCollectionEntry` | function | 630 |
| 10 | `localizeCollectionItems` | function | 647 |
| 11 | `getLanguageMap` | function | 665 |
| 12 | `escapeRegExp` | function | 674 |
| 13 | `protectPublicCopyTerms` | function | 678 |
| 14 | `restorePublicCopyTerms` | function | 692 |
| 15 | `localizePortalFaqText` | export function | 696 |
| 16 | `localizeFaqItems` | function | 722 |
| 17 | `localizePortalConfig` | export function | 737 |
| 18 | `getProductTranslationBlock` | function | 762 |

### 3.312 `frontend/src/components/catalog/portalEditorUtils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isPlainObject` | function | 47 |
| 2 | `toTrimmedString` | function | 51 |
| 3 | `createAboutBlock` | export function | 63 |
| 4 | `normalizeAboutBlocks` | export function | 75 |
| 5 | `serializeAboutBlocks` | export function | 95 |
| 6 | `createPromoItem` | export function | 99 |
| 7 | `normalizePromoItems` | export function | 113 |
| 8 | `serializePromoItems` | export function | 137 |
| 9 | `extractGoogleMapsEmbedUrl` | export function | 154 |
| 10 | `normalizeGoogleMapsEmbed` | export function | 162 |

### 3.313 `frontend/src/components/catalog/portalLanguageOptions.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeFirstPartyPortalLanguage` | export function | 35 |
| 2 | `isFirstPartyPortalLanguage` | export function | 40 |

### 3.314 `frontend/src/components/catalog/portalLanguagePacks.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeFirstPartyPortalLanguage` | export function | 1334 |
| 2 | `isFirstPartyPortalLanguage` | export function | 1339 |
| 3 | `getPortalLanguageText` | export function | 1343 |

### 3.315 `frontend/src/components/catalog/portalTranslateController.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLanguage` | function | 39 |
| 2 | `canonicalTranslateLanguage` | export function | 43 |
| 3 | `normalizeTranslateTarget` | export function | 52 |
| 4 | `getPortalTranslateCookieTarget` | export function | 58 |
| 5 | `hasPortalTranslatedMarker` | export function | 72 |
| 6 | `clearGoogleTranslateCookies` | export function | 78 |
| 7 | `writePortalTranslateTarget` | export function | 96 |
| 8 | `storePortalTranslatePreference` | export function | 118 |
| 9 | `ensureLinkHint` | function | 131 |
| 10 | `warmPortalTranslateNetwork` | export function | 142 |
| 11 | `ensurePortalTranslateScript` | export function | 147 |
| 12 | `ensurePortalTranslateWidgetHost` | export function | 168 |
| 13 | `removePortalTranslateWidgetHost` | export function | 191 |
| 14 | `setupPortalExternalTranslateWidget` | export function | 196 |
| 15 | `initWidget` | const arrow | 216 |
| 16 | `waitForWidget` | const arrow | 233 |
| 17 | `applyGoogleTranslateSelection` | export function | 271 |
| 18 | `isPortalTranslateApplied` | export function | 286 |
| 19 | `readStoredTranslateTarget` | export function | 295 |
| 20 | `requestPortalTranslateReload` | export function | 312 |

### 3.316 `frontend/src/components/catalog/portalTranslationData.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isPlainObject` | function | 3 |
| 2 | `normalizePortalTranslations` | export function | 7 |
| 3 | `stringifyPortalTranslations` | export function | 21 |

### 3.317 `frontend/src/components/catalog/PublicCatalogPage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadCatalogProductsSection` | const arrow | 20 |
| 2 | `getCatalogApi` | function | 197 |
| 3 | `getErrorMessage` | function | 201 |
| 4 | `toNumber` | function | 205 |
| 5 | `normalizePriceDisplay` | function | 211 |
| 6 | `normalizeHexColor` | function | 216 |
| 7 | `hexToRgba` | function | 221 |
| 8 | `normalizeExternalUrl` | function | 230 |
| 9 | `normalizeCatalogOptions` | function | 245 |
| 10 | `normalizeBrandOptions` | function | 253 |
| 11 | `normalizePortalInitialOptions` | function | 258 |
| 12 | `normalizeFaqItems` | function | 263 |
| 13 | `readPortalCache` | function | 274 |
| 14 | `writePortalCache` | function | 308 |
| 15 | `readEmbeddedPortalBootstrap` | function | 321 |
| 16 | `withAssetVersion` | function | 342 |
| 17 | `buildPortalBackground` | function | 349 |
| 18 | `getPortalTabs` | function | 360 |
| 19 | `resolvePortalActiveTab` | function | 371 |
| 20 | `getBranchQty` | function | 376 |
| 21 | `getStockStatus` | function | 382 |
| 22 | `normalizeProductGallery` | function | 392 |
| 23 | `formatPortalPrice` | function | 407 |
| 24 | `formatDateTime` | function | 419 |
| 25 | `replaceVars` | function | 426 |
| 26 | `readImageFileAsDataUrl` | function | 430 |
| 27 | `readImageFilesAsDataUrls` | function | 439 |
| 28 | `pickMultipleImagesAsDataUrls` | function | 457 |
| 29 | `normalizeBootstrapPayload` | function | 469 |
| 30 | `PublicCatalogPage` | export default function | 482 |
| 31 | `toggleFilterValue` | const arrow | 680 |
| 32 | `clearPortalFilters` | const arrow | 683 |
| 33 | `openProductGallery` | const arrow | 691 |
| 34 | `openPortalImage` | const arrow | 696 |
| 35 | `handleMembershipLookup` | const arrow | 701 |
| 36 | `handleSubmissionPaste` | const arrow | 717 |
| 37 | `handleUploadSubmissionImages` | const arrow | 725 |
| 38 | `handleSubmitShareProof` | const arrow | 730 |
| 39 | `clearAssistantState` | const arrow | 745 |
| 40 | `askAssistant` | const arrow | 750 |
| 41 | `scrollPublicPortal` | const arrow | 882 |

### 3.318 `frontend/src/components/contacts/ContactImportModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getContactImportApi` | function | 115 |
| 2 | `getErrorMessage` | function | 120 |
| 3 | `countCsvDataRowsInWorker` | function | 124 |
| 4 | `cleanup` | const arrow | 136 |
| 5 | `ContactImportModal` | export default function | 156 |
| 6 | `handleDownloadTemplate` | const arrow | 228 |
| 7 | `applyContactRulePreset` | const arrow | 232 |
| 8 | `handleImport` | const arrow | 242 |

### 3.319 `frontend/src/components/contacts/contactImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.320 `frontend/src/components/contacts/contactOptionUtils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isPlainRecord` | function | 24 |
| 2 | `readStringField` | function | 28 |
| 3 | `createContactOption` | export function | 33 |
| 4 | `normalizeOption` | function | 45 |
| 5 | `parseStoredContactOptions` | export function | 61 |
| 6 | `hasContactOptionData` | export function | 82 |
| 7 | `serializeContactOptions` | export function | 93 |
| 8 | `buildContactOptionSummary` | export function | 100 |
| 9 | `parseContactOptionsFromImportRow` | export function | 110 |
| 10 | `getPrimaryContactOption` | export function | 126 |

### 3.321 `frontend/src/components/contacts/Contacts.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadContactReadTransportModule` | function | 95 |
| 2 | `loadCsvUtilsModule` | function | 100 |
| 3 | `getContactApi` | function | 105 |
| 4 | `getErrorMessage` | function | 113 |
| 5 | `asExportValue` | function | 117 |
| 6 | `normalizeContactExportRows` | function | 121 |
| 7 | `ContactTabFallback` | function | 152 |
| 8 | `ImportTypePicker` | function | 201 |
| 9 | `Contacts` | export default function | 241 |
| 10 | `handleExportAll` | const arrow | 259 |
| 11 | `openImportPicker` | const arrow | 348 |
| 12 | `handleTypeSelected` | const arrow | 350 |
| 13 | `handleImportDone` | const arrow | 355 |

### 3.322 `frontend/src/components/contacts/CustomerFormModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `tr` | function | 50 |
| 2 | `parseContactOptions` | function | 55 |
| 3 | `OptionEditor` | function | 59 |
| 4 | `setField` | const arrow | 60 |
| 5 | `fieldId` | const arrow | 61 |
| 6 | `CustomerFormModal` | export default function | 104 |
| 7 | `addOption` | const arrow | 125 |
| 8 | `removeOption` | const arrow | 129 |
| 9 | `updateOption` | const arrow | 130 |
| 10 | `handleSubmit` | const arrow | 131 |

### 3.323 `frontend/src/components/contacts/customerMembershipNumber.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `generateCustomerMembershipNumber` | export function | 4 |

### 3.324 `frontend/src/components/contacts/CustomersTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadContactReadTransportModule` | function | 129 |
| 2 | `loadContactWriteTransportModule` | function | 134 |
| 3 | `loadCsvUtilsModule` | function | 139 |
| 4 | `getCustomerApi` | function | 144 |
| 5 | `isSectionRow` | function | 153 |
| 6 | `normalizeCustomerRows` | function | 157 |
| 7 | `getApiListPayload` | function | 164 |
| 8 | `getErrorMessage` | function | 168 |
| 9 | `formatPoints` | function | 172 |
| 10 | `parseContactOptions` | export function | 176 |
| 11 | `serializeContactOptions` | export function | 180 |
| 12 | `tr` | function | 184 |
| 13 | `CustomersTab` | function | 193 |
| 14 | `toggleSectionCollapsed` | const arrow | 356 |
| 15 | `isSectionFullySelected` | const arrow | 362 |
| 16 | `isSectionPartiallySelected` | const arrow | 363 |
| 17 | `toggleSectionSelection` | const arrow | 364 |
| 18 | `promise` | const arrow | 398 |
| 19 | `handleSave` | const arrow | 482 |
| 20 | `handleDelete` | const arrow | 559 |
| 21 | `handleBulkDelete` | const arrow | 598 |

### 3.325 `frontend/src/components/contacts/DeliveryTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadContactReadTransportModule` | function | 124 |
| 2 | `loadContactWriteTransportModule` | function | 129 |
| 3 | `loadCsvUtilsModule` | function | 134 |
| 4 | `getDeliveryApi` | function | 139 |
| 5 | `normalizeDeliveryRows` | function | 148 |
| 6 | `isSectionRow` | function | 156 |
| 7 | `getErrorMessage` | function | 160 |
| 8 | `parseDeliveryOptions` | export function | 169 |
| 9 | `serializeDeliveryOptions` | export function | 173 |
| 10 | `BLANK_OPTION` | const arrow | 177 |
| 11 | `OptionEditor` | function | 188 |
| 12 | `set` | const arrow | 189 |
| 13 | `fieldId` | const arrow | 190 |
| 14 | `DeliveryForm` | function | 235 |
| 15 | `set` | const arrow | 244 |
| 16 | `addOption` | const arrow | 245 |
| 17 | `updateOption` | const arrow | 249 |
| 18 | `removeOption` | const arrow | 250 |
| 19 | `handleSave` | const arrow | 251 |
| 20 | `OptionsDisplay` | function | 321 |
| 21 | `OptionsBadge` | function | 338 |
| 22 | `DeliveryTab` | function | 349 |
| 23 | `toggleSectionCollapsed` | const arrow | 490 |
| 24 | `isSectionFullySelected` | const arrow | 496 |
| 25 | `isSectionPartiallySelected` | const arrow | 497 |
| 26 | `toggleSectionSelection` | const arrow | 498 |
| 27 | `promise` | const arrow | 530 |
| 28 | `handleSave` | const arrow | 601 |
| 29 | `handleDelete` | const arrow | 663 |
| 30 | `handleBulkDelete` | const arrow | 700 |

### 3.326 `frontend/src/components/contacts/shared.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toggleOne` | const arrow | 100 |
| 2 | `clearSelection` | const arrow | 111 |
| 3 | `countActiveFlags` | export function | 134 |
| 4 | `ThreeDotMenu` | export function | 156 |
| 5 | `menuContent` | const arrow | 165 |
| 6 | `DetailModal` | export function | 224 |

### 3.327 `frontend/src/components/contacts/SuppliersTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadContactReadTransportModule` | function | 127 |
| 2 | `loadContactWriteTransportModule` | function | 132 |
| 3 | `loadCsvUtilsModule` | function | 137 |
| 4 | `getSupplierApi` | function | 142 |
| 5 | `normalizeSupplierRows` | function | 151 |
| 6 | `isSectionRow` | function | 159 |
| 7 | `getErrorMessage` | function | 163 |
| 8 | `SupplierForm` | function | 174 |
| 9 | `set` | const arrow | 190 |
| 10 | `addOption` | const arrow | 191 |
| 11 | `updateOption` | const arrow | 195 |
| 12 | `removeOption` | const arrow | 196 |
| 13 | `handleSubmit` | const arrow | 197 |
| 14 | `fieldId` | const arrow | 245 |
| 15 | `SuppliersTab` | function | 291 |
| 16 | `toggleSectionCollapsed` | const arrow | 439 |
| 17 | `isSectionFullySelected` | const arrow | 445 |
| 18 | `isSectionPartiallySelected` | const arrow | 446 |
| 19 | `toggleSectionSelection` | const arrow | 447 |
| 20 | `promise` | const arrow | 481 |
| 21 | `handleSave` | const arrow | 553 |
| 22 | `handleDelete` | const arrow | 623 |
| 23 | `handleBulkDelete` | const arrow | 662 |

### 3.328 `frontend/src/components/custom-tables/CustomTables.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadCustomTablesApi` | function | 64 |
| 2 | `getCustomTablesRequest` | function | 69 |
| 3 | `createCustomTableRequest` | function | 73 |
| 4 | `getCustomTableDataRequest` | function | 77 |
| 5 | `insertCustomRowRequest` | function | 81 |
| 6 | `updateCustomRowRequest` | function | 85 |
| 7 | `deleteCustomRowRequest` | function | 95 |
| 8 | `getErrorMessage` | function | 103 |
| 9 | `getHistoryResultId` | function | 107 |
| 10 | `formatCellValue` | function | 111 |
| 11 | `toInputValue` | function | 118 |
| 12 | `normalizeRowValue` | function | 125 |
| 13 | `normalizeCustomTable` | function | 138 |
| 14 | `parseSchema` | function | 151 |
| 15 | `normalizeRows` | function | 172 |
| 16 | `buildRowPayload` | function | 178 |
| 17 | `CustomTables` | export default function | 187 |
| 18 | `addColumn` | const arrow | 303 |
| 19 | `updateColumn` | const arrow | 310 |
| 20 | `removeColumn` | const arrow | 319 |
| 21 | `handleCreateTable` | const arrow | 326 |
| 22 | `handleSaveRow` | const arrow | 373 |
| 23 | `handleDeleteRow` | const arrow | 454 |
| 24 | `openAddRow` | const arrow | 502 |
| 25 | `openEditRow` | const arrow | 509 |

### 3.329 `frontend/src/components/dashboard/charts/BarChart.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `chartLabelsNeedYear` | function | 23 |
| 2 | `formatAxisLabel` | function | 32 |
| 3 | `BarChart` | export default function | 45 |
| 4 | `updateWidth` | const arrow | 53 |
| 5 | `yPx` | function | 89 |

### 3.330 `frontend/src/components/dashboard/charts/DonutChart.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `DonutChart` | export default function | 22 |

### 3.331 `frontend/src/components/dashboard/charts/index.ts`

- No top-level named symbols detected.

### 3.332 `frontend/src/components/dashboard/charts/LineChart.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `chartLabelsNeedYear` | function | 28 |
| 2 | `formatAxisLabel` | function | 37 |
| 3 | `LineChart` | export default function | 50 |
| 4 | `updateWidth` | const arrow | 58 |
| 5 | `xPx` | function | 100 |
| 6 | `yPx` | function | 104 |
| 7 | `handleMouseMove` | const arrow | 114 |

### 3.333 `frontend/src/components/dashboard/charts/NoData.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `NoData` | export default function | 1 |

### 3.334 `frontend/src/components/dashboard/Dashboard.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDashboardApi` | function | 233 |
| 2 | `getErrorMessage` | function | 237 |
| 3 | `getDashboardFilterStorageKey` | function | 286 |
| 4 | `readDashboardFilterPrefs` | function | 291 |
| 5 | `downsampleChartRows` | function | 314 |
| 6 | `normalizeDashboardRangeId` | function | 325 |
| 7 | `compactDashboardMetaParts` | function | 332 |
| 8 | `formatDashboardHourLabel` | function | 338 |
| 9 | `getSaleStatusTone` | function | 345 |
| 10 | `isDashboardSummaryPayload` | function | 352 |
| 11 | `isDashboardAnalyticsPayload` | function | 364 |
| 12 | `normalizeDashboardSummaryPayload` | function | 377 |
| 13 | `normalizeDashboardAnalyticsPayload` | function | 390 |
| 14 | `Dashboard` | export default function | 410 |
| 15 | `calcTrend` | const arrow | 716 |
| 16 | `rangeLabel` | const arrow | 760 |
| 17 | `periodShort` | const arrow | 766 |

### 3.335 `frontend/src/components/dashboard/dashboardExport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `priceCsv` | function | 91 |
| 2 | `totals` | function | 95 |
| 3 | `periodReturns` | function | 99 |
| 4 | `periodSupplierReturns` | function | 103 |
| 5 | `buildDashboardKpiRows` | function | 107 |
| 6 | `buildDashboardFormulaRows` | function | 135 |
| 7 | `buildDashboardManifestEntries` | function | 163 |
| 8 | `buildDashboardSalesRows` | function | 178 |
| 9 | `buildDashboardTopProductRows` | function | 193 |
| 10 | `buildDashboardTopCustomerRows` | function | 202 |
| 11 | `buildDashboardPaymentRows` | function | 215 |
| 12 | `buildDashboardBranchRows` | function | 223 |
| 13 | `buildDashboardLowStockRows` | function | 231 |
| 14 | `buildDashboardOutStockRows` | function | 239 |
| 15 | `buildDashboardRecentRows` | function | 247 |
| 16 | `hasDashboardExportData` | function | 258 |
| 17 | `exportDashboardFull` | export function | 262 |
| 18 | `exportDashboardStats` | export function | 286 |
| 19 | `exportDashboardKpis` | export function | 314 |
| 20 | `exportDashboardSalesChart` | export function | 319 |
| 21 | `exportDashboardTopProducts` | export function | 335 |
| 22 | `exportDashboardTopCustomers` | export function | 339 |
| 23 | `exportDashboardPaymentMethods` | export function | 344 |
| 24 | `exportDashboardBranches` | export function | 349 |
| 25 | `exportDashboardPackage` | export function | 354 |

### 3.336 `frontend/src/components/dashboard/MiniStat.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `MiniStat` | export default function | 13 |

### 3.337 `frontend/src/components/files/FilePickerModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getErrorMessage` | function | 60 |
| 2 | `normalizeFileAssets` | function | 64 |
| 3 | `uploadFileAssetRequest` | function | 68 |
| 4 | `deleteFileAssetRequest` | function | 72 |
| 5 | `AssetPreview` | function | 76 |
| 6 | `FilePickerModal` | export default function | 99 |
| 7 | `toggleSelectedPath` | function | 176 |
| 8 | `handleUpload` | function | 186 |
| 9 | `handleDelete` | function | 228 |

### 3.338 `frontend/src/components/files/FilesPage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadFilesProvidersTab` | const arrow | 42 |
| 2 | `loadFilesResponsesTab` | const arrow | 43 |
| 3 | `getFilesApi` | function | 250 |
| 4 | `getErrorMessage` | function | 254 |
| 5 | `hasMojibake` | function | 258 |
| 6 | `sanitizeFallback` | function | 262 |
| 7 | `AssetPreview` | function | 266 |
| 8 | `AssetCardSkeleton` | function | 289 |
| 9 | `formatDateTime` | function | 315 |
| 10 | `formatFileSize` | function | 325 |
| 11 | `emptyProviderForm` | function | 333 |
| 12 | `compactTabLabel` | function | 356 |
| 13 | `getDefaultFilesPageSize` | function | 362 |
| 14 | `downloadAssetFile` | function | 367 |
| 15 | `FilesPage` | export default function | 379 |
| 16 | `handleUpload` | function | 671 |
| 17 | `handleDeleteAsset` | function | 694 |
| 18 | `toggleAssetSelection` | function | 722 |
| 19 | `toggleSelectAllAssets` | function | 733 |
| 20 | `handleCopySelectedPaths` | function | 740 |
| 21 | `handleDownloadSelected` | function | 755 |
| 22 | `handleDeleteSelectedAssets` | function | 763 |
| 23 | `startCreateProvider` | function | 809 |
| 24 | `startEditProvider` | function | 825 |
| 25 | `saveProvider` | function | 850 |
| 26 | `testProvider` | function | 934 |
| 27 | `removeProvider` | function | 955 |

### 3.339 `frontend/src/components/files/FilesProvidersTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toProviderSelectOptions` | function | 47 |
| 2 | `toProviderTypeOptions` | function | 51 |
| 3 | `ProviderStatus` | function | 130 |
| 4 | `FilesProvidersTab` | export default function | 141 |

### 3.340 `frontend/src/components/files/FilesResponsesTab.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `FilesResponsesTab` | export default function | 64 |

### 3.341 `frontend/src/components/inventory/DualMoney.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `DualMoney` | export default function | 8 |

### 3.342 `frontend/src/components/inventory/Inventory.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `scheduleInventoryMetadataRead` | function | 213 |
| 2 | `loadBranchTransport` | function | 231 |
| 3 | `loadDashboardTransport` | function | 236 |
| 4 | `loadInventoryTransport` | function | 241 |
| 5 | `loadInventoryWriteTransport` | function | 246 |
| 6 | `loadProductReadTransport` | function | 251 |
| 7 | `loadReturnsReadTransport` | function | 256 |
| 8 | `loadRfidTransport` | function | 261 |
| 9 | `loadUserReadTransport` | function | 266 |
| 10 | `loadInventoryExportModule` | function | 271 |
| 11 | `getInventoryApi` | function | 276 |
| 12 | `normalizeFiniteIds` | function | 328 |
| 13 | `countActiveFlags` | function | 332 |
| 14 | `countSelectedIds` | function | 340 |
| 15 | `buildDestinationProductOptions` | function | 348 |
| 16 | `limitInventorySectionsForMobile` | function | 361 |
| 17 | `parseInventoryTimestamp` | function | 388 |
| 18 | `InventoryDiscountBadge` | function | 402 |
| 19 | `InventoryBatchPreview` | function | 413 |
| 20 | `label` | const arrow | 425 |
| 21 | `Inventory` | export default function | 478 |
| 22 | `promise` | const arrow | 728 |
| 23 | `loadInventoryBootstrap` | const arrow | 766 |
| 24 | `handleAdjust` | const arrow | 1209 |
| 25 | `openAdjust` | const arrow | 1291 |
| 26 | `openMove` | const arrow | 1298 |
| 27 | `openTransfer` | const arrow | 1321 |
| 28 | `handleMoveStock` | const arrow | 1376 |
| 29 | `handleTransferStock` | const arrow | 1449 |
| 30 | `syncViewport` | const arrow | 1613 |
| 31 | `statsValue` | const arrow | 2220 |
| 32 | `selectInventorySection` | const arrow | 2946 |

### 3.343 `frontend/src/components/inventory/InventoryBatchModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildDestinationProductOptions` | function | 68 |
| 2 | `InventoryBatchModal` | export default function | 79 |
| 3 | `closeIfIdle` | const arrow | 97 |

### 3.344 `frontend/src/components/inventory/inventoryExport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadInventoryExportTools` | function | 57 |
| 2 | `priceCsv` | function | 72 |
| 3 | `parseExportTimestamp` | function | 76 |
| 4 | `getMovementActivityRows` | function | 90 |
| 5 | `getMovementVolumeRows` | function | 108 |
| 6 | `getStockStatusRows` | function | 126 |
| 7 | `getTopStockValueRows` | function | 134 |
| 8 | `getBranchComparisonRows` | function | 147 |
| 9 | `buildInventoryStatsRows` | function | 171 |
| 10 | `buildInventoryFormulaRows` | function | 205 |
| 11 | `buildMovementFilterRows` | function | 246 |
| 12 | `buildInventoryExportContextRows` | function | 261 |
| 13 | `buildMovementRows` | function | 281 |
| 14 | `buildInventoryProductRows` | function | 295 |
| 15 | `exportInventoryMovementGroups` | export function | 327 |
| 16 | `exportInventorySummary` | export function | 332 |
| 17 | `exportInventoryStats` | export function | 337 |
| 18 | `exportInventoryPackage` | export function | 366 |

### 3.345 `frontend/src/components/inventory/InventoryImportModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isBrokenLocalizedString` | function | 68 |
| 2 | `getImportApi` | function | 80 |
| 3 | `getErrorMessage` | function | 85 |
| 4 | `countInventoryCsvRowsInWorker` | function | 89 |
| 5 | `cleanup` | const arrow | 101 |
| 6 | `InventoryImportModal` | export default function | 121 |
| 7 | `handlePickFile` | const arrow | 175 |
| 8 | `handleDownloadTemplate` | const arrow | 181 |
| 9 | `handleImport` | const arrow | 185 |

### 3.346 `frontend/src/components/inventory/inventoryImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.347 `frontend/src/components/inventory/InventoryMovementsSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `InventoryMovementsSurface` | export default function | 143 |

### 3.348 `frontend/src/components/inventory/InventoryProductsSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `InventoryProductsSurface` | export default function | 103 |
| 2 | `renderDesktopTableHead` | const arrow | 142 |
| 3 | `renderDesktopLoadingShell` | const arrow | 164 |

### 3.349 `frontend/src/components/inventory/InventoryReasonManagerModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `InventoryReasonManagerModal` | export default function | 35 |
| 2 | `close` | const arrow | 50 |

### 3.350 `frontend/src/components/inventory/InventoryRfidSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `InventoryRfidSurface` | export default function | 55 |

### 3.351 `frontend/src/components/inventory/InventoryStatDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `InventoryStatDetailModal` | export default function | 23 |

### 3.352 `frontend/src/components/inventory/InventoryStockModals.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `InventoryStockModals` | export default function | 101 |

### 3.353 `frontend/src/components/inventory/movementGroups.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isMovementRecord` | function | 40 |
| 2 | `normalizeMovementTimeValue` | function | 44 |
| 3 | `minuteBucket` | function | 57 |
| 4 | `normalizeText` | function | 65 |
| 5 | `canonicalMovementType` | function | 72 |
| 6 | `buildGroupKey` | function | 78 |
| 7 | `describeMovementType` | function | 94 |
| 8 | `movementSign` | function | 105 |
| 9 | `movementSignedValue` | function | 111 |
| 10 | `movementAbsoluteValue` | function | 117 |
| 11 | `parseMovementTime` | function | 123 |
| 12 | `normalizeMovementTimestamp` | export function | 130 |
| 13 | `buildMovementGroups` | export function | 145 |
| 14 | `getMovementGroupPage` | export function | 257 |
| 15 | `movementGroupHaystack` | export function | 273 |

### 3.354 `frontend/src/components/inventory/ProductDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBranchStockKey` | function | 61 |
| 2 | `ProductDetailModal` | export default function | 65 |

### 3.355 `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getPortalTransport` | function | 191 |
| 2 | `lookupLoyaltyPortalMembership` | function | 196 |
| 3 | `toCustomerPointRows` | function | 201 |
| 4 | `getErrorMessage` | function | 205 |
| 5 | `sanitizeInteger` | function | 209 |
| 6 | `sanitizeKhr` | function | 214 |
| 7 | `formatLookupValue` | function | 220 |
| 8 | `normalizeLoyaltySection` | function | 224 |
| 9 | `LoyaltyPointsPage` | export default function | 228 |
| 10 | `handleSave` | function | 337 |
| 11 | `handleLookup` | function | 361 |

### 3.356 `frontend/src/components/navigation/Sidebar.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getFallbackLabel` | function | 98 |
| 2 | `getNavLabel` | function | 106 |
| 3 | `isDarkColor` | function | 122 |
| 4 | `withAlpha` | function | 132 |
| 5 | `mergeStyles` | function | 138 |
| 6 | `announcePageIntent` | function | 142 |
| 7 | `getIconForItem` | function | 149 |
| 8 | `isNavigationItemWithIcon` | function | 153 |
| 9 | `Sidebar` | export default function | 157 |

### 3.357 `frontend/src/components/pos/CartItem.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `translate` | function | 42 |
| 2 | `CartItem` | export default function | 46 |

### 3.358 `frontend/src/components/pos/FilterPanel.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `countActiveFlags` | function | 47 |
| 2 | `SectionLabel` | function | 55 |
| 3 | `POSFilterPanel` | export default function | 66 |
| 4 | `clearAll` | const arrow | 100 |
| 5 | `chip` | const arrow | 109 |

### 3.359 `frontend/src/components/pos/POS.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getPosStatusLabel` | function | 96 |
| 2 | `loadContactOptionUtilsModule` | function | 102 |
| 3 | `parseContactOptions` | function | 133 |
| 4 | `isPlainRecord` | function | 324 |
| 5 | `normalizeCategory` | function | 328 |
| 6 | `getProductReadTransport` | function | 350 |
| 7 | `getLookupTransport` | function | 355 |
| 8 | `getContactReadTransport` | function | 360 |
| 9 | `getContactWriteTransport` | function | 365 |
| 10 | `getPortalTransport` | function | 370 |
| 11 | `getSaleWriteTransport` | function | 375 |
| 12 | `loadPosProductBootstrap` | function | 380 |
| 13 | `searchPosCatalogProducts` | function | 385 |
| 14 | `loadPosProductFilters` | function | 390 |
| 15 | `loadPosCategories` | function | 395 |
| 16 | `loadPosCustomers` | function | 400 |
| 17 | `loadPosDeliveryContacts` | function | 405 |
| 18 | `createPosCustomer` | function | 410 |
| 19 | `createPosDeliveryContact` | function | 415 |
| 20 | `lookupPosPortalMembership` | function | 420 |
| 21 | `createPosSale` | function | 425 |
| 22 | `normalizeOrder` | function | 430 |
| 23 | `getErrorMessage` | function | 441 |
| 24 | `asText` | function | 445 |
| 25 | `asNumber` | function | 449 |
| 26 | `ProductDiscountBadge` | function | 462 |
| 27 | `POS` | export default function | 482 |
| 28 | `setPersistedCat` | const arrow | 513 |
| 29 | `setPersistedBrand` | const arrow | 514 |
| 30 | `setPersistedBranch` | const arrow | 515 |
| 31 | `setPersistedStock` | const arrow | 516 |
| 32 | `setPersistedGroup` | const arrow | 517 |
| 33 | `setPersistedSupplier` | const arrow | 518 |
| 34 | `setPersistedInitial` | const arrow | 519 |
| 35 | `addNewOrder` | const arrow | 580 |
| 36 | `closeOrder` | const arrow | 592 |
| 37 | `promise` | const arrow | 734 |
| 38 | `selectCustomer` | const arrow | 1059 |
| 39 | `applyCustomerOption` | const arrow | 1107 |
| 40 | `clearCustomer` | const arrow | 1121 |
| 41 | `handleAddCustomer` | const arrow | 1129 |
| 42 | `selectDelivery` | const arrow | 1166 |
| 43 | `clearDelivery` | const arrow | 1171 |
| 44 | `handleAddDelivery` | const arrow | 1173 |
| 45 | `addToCart` | function | 1402 |
| 46 | `updateQty` | const arrow | 1441 |
| 47 | `updatePrice` | const arrow | 1449 |
| 48 | `updateItemBranch` | const arrow | 1473 |
| 49 | `handleDiscountUsd` | const arrow | 1542 |
| 50 | `handleDiscountKhr` | const arrow | 1543 |
| 51 | `handleMembershipUnits` | const arrow | 1544 |
| 52 | `handleCheckout` | const arrow | 1583 |

### 3.360 `frontend/src/components/pos/posCore.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeNumber` | function | 48 |
| 2 | `buildProductsById` | export function | 52 |
| 3 | `buildVariantChildrenByParentId` | export function | 61 |
| 4 | `getVariantRootProduct` | export function | 73 |
| 5 | `buildVisibleProductCards` | export function | 80 |
| 6 | `getVariantChoices` | export function | 96 |
| 7 | `buildPosFilterMeta` | export function | 104 |
| 8 | `resolveCartPriceValues` | export function | 113 |
| 9 | `getCartLineId` | export function | 153 |
| 10 | `findMatchingCartLineIndex` | export function | 160 |

### 3.361 `frontend/src/components/pos/POSQuickAddModals.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `POSQuickAddModals` | export default function | 37 |

### 3.362 `frontend/src/components/pos/ProductDetailSheet.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductDetailSheet` | export default function | 87 |
| 2 | `closeAfterAdd` | const arrow | 113 |

### 3.363 `frontend/src/components/pos/ProductImage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getImageApi` | function | 17 |
| 2 | `isRecentlyBrokenProductImage` | function | 21 |
| 3 | `markBrokenProductImage` | function | 29 |
| 4 | `ProductImage` | export default function | 34 |
| 5 | `loadImageData` | function | 71 |

### 3.364 `frontend/src/components/pos/QuickAddModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `QuickAddModal` | export default function | 12 |
| 2 | `T` | const arrow | 13 |

### 3.365 `frontend/src/components/products/config/productPageConfig.ts`

- No top-level named symbols detected.

### 3.366 `frontend/src/components/products/forms/BranchStockAdjuster.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getProductApi` | function | 73 |
| 2 | `parseStockDelta` | function | 77 |
| 3 | `BranchStockAdjuster` | export default function | 82 |
| 4 | `T` | const arrow | 103 |
| 5 | `setRow` | const arrow | 109 |
| 6 | `handleSave` | const arrow | 115 |

### 3.367 `frontend/src/components/products/forms/BulkAddStockModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getProductApi` | function | 69 |
| 2 | `parsePositiveQuantity` | function | 73 |
| 3 | `normalizeBranchId` | function | 78 |
| 4 | `normalizeProductId` | function | 84 |
| 5 | `BulkAddStockModal` | export default function | 89 |
| 6 | `handleSave` | const arrow | 109 |

### 3.368 `frontend/src/components/products/forms/ProductForm.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadContactsTransportModule` | function | 186 |
| 2 | `loadProductImageUploadTransportModule` | function | 191 |
| 3 | `getErrorMessage` | function | 198 |
| 4 | `normalizeGallery` | function | 202 |
| 5 | `editablePrice` | function | 218 |
| 6 | `pickImageFiles` | function | 223 |
| 7 | `ProductForm` | export default function | 242 |
| 8 | `loadSuppliers` | function | 423 |
| 9 | `setField` | function | 448 |
| 10 | `setNumericField` | function | 452 |
| 11 | `addImages` | function | 456 |
| 12 | `addPhoto` | function | 461 |
| 13 | `uploadPickedImages` | function | 466 |
| 14 | `removeImage` | function | 511 |
| 15 | `setPrimaryImage` | function | 515 |
| 16 | `saveForm` | function | 525 |
| 17 | `openScanner` | function | 576 |
| 18 | `closeScanner` | function | 581 |
| 19 | `applyScannedValue` | function | 585 |

### 3.369 `frontend/src/components/products/forms/VariantFormModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getProductVariantApi` | function | 105 |
| 2 | `getErrorMessage` | function | 109 |
| 3 | `VariantFormModal` | export default function | 113 |

### 3.370 `frontend/src/components/products/helpers/productDisplayHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toNumber` | function | 57 |
| 2 | `buildBranchNameByIdMap` | export function | 72 |
| 3 | `buildProductBrandOptions` | export function | 76 |
| 4 | `buildProductBranchSummaryLabel` | export function | 90 |
| 5 | `getProductStockStatus` | export function | 101 |
| 6 | `buildProductRowDisplayState` | export function | 111 |

### 3.371 `frontend/src/components/products/helpers/productExport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toNumber` | function | 49 |
| 2 | `getImageGallery` | function | 54 |
| 3 | `buildProductExportRows` | export function | 58 |
| 4 | `toImageName` | const arrow | 59 |
| 5 | `toImageUrl` | const arrow | 60 |
| 6 | `priceCsv` | const arrow | 61 |

### 3.372 `frontend/src/components/products/helpers/productFilterHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toNumber` | function | 44 |
| 2 | `normalizeFilterValue` | function | 49 |
| 3 | `getProductBranchQuantity` | export function | 53 |
| 4 | `filterProductsForPage` | export function | 58 |

### 3.373 `frontend/src/components/products/helpers/productGalleryHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeProductGallery` | export function | 27 |
| 2 | `getProductGalleryImages` | export function | 58 |
| 3 | `buildProductThumbnailState` | export function | 62 |
| 4 | `resolveProductImageUrl` | export function | 71 |
| 5 | `clampProductLightboxIndex` | export function | 77 |
| 6 | `buildProductLightboxState` | export function | 85 |
| 7 | `buildProductLightboxGalleryInput` | export function | 96 |
| 8 | `updateProductLightboxIndex` | export function | 102 |

### 3.374 `frontend/src/components/products/helpers/productGroupViewHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildProductGroupPriceLabel` | export function | 22 |
| 2 | `buildProductGroupSummaryParts` | export function | 32 |

### 3.375 `frontend/src/components/products/helpers/productMenuHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `asString` | function | 85 |
| 2 | `normalizeOptionValue` | function | 89 |
| 3 | `safeFilterLabel` | function | 93 |
| 4 | `buildProductExportItems` | export function | 101 |
| 5 | `countActiveProductFilters` | export function | 129 |
| 6 | `buildProductFilterSections` | export function | 155 |

### 3.376 `frontend/src/components/products/helpers/productPageHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseBrandColorMap` | export function | 12 |
| 2 | `normalizeBrandLookup` | export function | 22 |

### 3.377 `frontend/src/components/products/helpers/productSelectionHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildVisibleProductIds` | export function | 51 |
| 2 | `buildParentProductIdSet` | export function | 69 |
| 3 | `buildSelectedVisibleIds` | export function | 78 |
| 4 | `buildProductPaginationState` | export function | 83 |
| 5 | `buildJumpTargetIdsByLetter` | export function | 115 |
| 6 | `isSelectionScopeFullySelected` | export function | 132 |
| 7 | `isSelectionScopePartiallySelected` | export function | 136 |

### 3.378 `frontend/src/components/products/helpers/productSupplierOptions.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildProductSupplierOptions` | export function | 1 |

### 3.379 `frontend/src/components/products/helpers/productWriteHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toFiniteNumber` | function | 123 |
| 2 | `hasBulkFormValue` | function | 128 |
| 3 | `stringOrEmpty` | function | 132 |
| 4 | `buildProductWritePayload` | export function | 136 |
| 5 | `buildProductBranchStockAdjustments` | export function | 168 |
| 6 | `buildProductClearStockAdjustments` | export function | 198 |
| 7 | `buildProductStockAdjustmentPayload` | export function | 216 |
| 8 | `buildProductBranchMovePlan` | export function | 233 |
| 9 | `buildProductTransferStockPayload` | export function | 261 |
| 10 | `summarizeProductBulkRun` | export function | 274 |
| 11 | `buildDefinedProductUpdates` | export function | 289 |
| 12 | `buildProductBulkUpdatePayload` | export function | 295 |
| 13 | `buildProductBulkInfoUpdates` | export function | 311 |
| 14 | `buildProductBulkPricingUpdates` | export function | 324 |
| 15 | `getDefaultProductRestoreBranchId` | export function | 339 |
| 16 | `buildDeletedProductIdSet` | export function | 345 |
| 17 | `getPreferredProductRestoreBranchId` | export function | 353 |
| 18 | `resolveRestoredProductParentId` | export function | 361 |

### 3.380 `frontend/src/components/products/history/productHistoryHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createProductHistoryRequestId` | export function | 43 |

### 3.381 `frontend/src/components/products/import/BulkImportModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getProductImportApi` | function | 251 |
| 2 | `getErrorMessage` | function | 255 |
| 3 | `getBaseName` | function | 259 |
| 4 | `analyzeProductCsvInWorker` | function | 267 |
| 5 | `runFallbackAnalysis` | const arrow | 276 |
| 6 | `cleanup` | const arrow | 288 |
| 7 | `complete` | const arrow | 296 |
| 8 | `getIncomingImageFilenames` | function | 345 |
| 9 | `getExistingImageFilenames` | function | 378 |
| 10 | `csvEscape` | function | 407 |
| 11 | `compactImportValue` | function | 437 |
| 12 | `isBlankImportValue` | function | 442 |
| 13 | `hasPriceReviewIssue` | function | 446 |
| 14 | `getProductImportIssueLabel` | function | 451 |
| 15 | `getProductImportIssueHint` | function | 460 |
| 16 | `getProductImportRowIssueDetails` | function | 468 |
| 17 | `valuesDiffer` | function | 523 |
| 18 | `normalizeImageMatchKey` | function | 527 |
| 19 | `getImageReference` | function | 540 |
| 20 | `findImageReferenceForRow` | function | 549 |
| 21 | `getDecisionLabel` | function | 560 |
| 22 | `getFamilyKeyForRow` | function | 564 |
| 23 | `summarizeRowNumbers` | function | 568 |
| 24 | `summarizeSubgroup` | function | 575 |
| 25 | `getImportActionTargetSummary` | function | 580 |
| 26 | `createFamilyContextEntry` | function | 613 |
| 27 | `buildVisibleFamilyRows` | function | 634 |
| 28 | `InlineImportDetailGrid` | function | 653 |
| 29 | `buildImageOnlyCsv` | function | 694 |
| 30 | `getBrowserImageEntries` | function | 712 |
| 31 | `BulkImportModal` | export default function | 721 |
| 32 | `resetCsvState` | const arrow | 852 |
| 33 | `pickImageDirectory` | const arrow | 880 |
| 34 | `pickImageZip` | const arrow | 905 |
| 35 | `addLibraryImages` | const arrow | 919 |
| 36 | `handleCancelCurrentJob` | const arrow | 1003 |
| 37 | `handleRetryCurrentJob` | const arrow | 1024 |
| 38 | `handleDeleteCurrentJob` | const arrow | 1048 |
| 39 | `handleImageOnlyImport` | const arrow | 1075 |
| 40 | `handlePickCSV` | const arrow | 1170 |
| 41 | `handleImport` | const arrow | 1234 |
| 42 | `toggleFamilyCollapse` | const arrow | 1484 |
| 43 | `toggleInlineDetails` | const arrow | 1493 |
| 44 | `toggleConflictSelection` | const arrow | 1502 |
| 45 | `toggleSelectAllConflicts` | const arrow | 1511 |
| 46 | `applyDecisionToSelection` | const arrow | 1519 |
| 47 | `applyImageDecisionToSelection` | const arrow | 1529 |
| 48 | `applyIdentifierDecisionToSelection` | const arrow | 1546 |
| 49 | `applyFieldRulePreset` | const arrow | 1558 |
| 50 | `renderConflictRow` | const arrow | 1571 |
| 51 | `updateEditedRow` | const arrow | 1579 |

### 3.382 `frontend/src/components/products/import/productImportPlanner.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeText` | function | 142 |
| 2 | `normalizeImportProductName` | export function | 146 |
| 3 | `normalizeComparableText` | function | 150 |
| 4 | `isBlockingProductImportIssue` | export function | 161 |
| 5 | `getProductImportBarcodeIssue` | export function | 165 |
| 6 | `hasSuspiciousEncodingCorruption` | function | 176 |
| 7 | `getCorruptedTextFields` | function | 185 |
| 8 | `getBlockingIssueMessage` | function | 189 |
| 9 | `normalizeFlag` | function | 201 |
| 10 | `normalizeProductImportRow` | export function | 209 |
| 11 | `normalizeProductForSignature` | function | 249 |
| 12 | `getProductImportDetailSignature` | export function | 274 |
| 13 | `chooseParentProduct` | function | 286 |
| 14 | `buildExistingIndex` | function | 302 |
| 15 | `buildImportedIdentifierIndex` | function | 320 |
| 16 | `buildProductImportReviewGroups` | function | 336 |
| 17 | `analyzeProductImportRows` | export function | 457 |
| 18 | `analyzeProductImportText` | export function | 631 |

### 3.383 `frontend/src/components/products/import/productImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `post` | function | 39 |
| 2 | `waitForNextTask` | function | 43 |
| 3 | `getErrorMessage` | function | 49 |

### 3.384 `frontend/src/components/products/lookups/ManageBrandsModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBrandApi` | function | 116 |
| 2 | `getErrorMessage` | function | 120 |
| 3 | `parseBrandOptions` | function | 124 |
| 4 | `parseBrandColorMap` | function | 137 |
| 5 | `toTitleCase` | function | 152 |
| 6 | `getBrandReviewRule` | function | 160 |
| 7 | `hasActiveBrandUsage` | function | 164 |
| 8 | `getBrandSortScore` | function | 170 |
| 9 | `buildSavedLibrary` | function | 176 |
| 10 | `ManageBrandsModal` | export default function | 198 |

### 3.385 `frontend/src/components/products/lookups/ManageCategoriesModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getCategoryApi` | function | 113 |
| 2 | `getErrorMessage` | function | 117 |
| 3 | `normalizeCategoryRows` | function | 121 |
| 4 | `mergeCategoryUsage` | function | 136 |
| 5 | `ManageCategoriesModal` | export default function | 165 |

### 3.386 `frontend/src/components/products/lookups/ManageUnitsModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getUnitApi` | function | 113 |
| 2 | `getErrorMessage` | function | 117 |
| 3 | `normalizeUnitRows` | function | 121 |
| 4 | `mergeUnitUsage` | function | 136 |
| 5 | `ManageUnitsModal` | export default function | 165 |

### 3.387 `frontend/src/components/products/lookups/productLookupSnapshots.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeLookup` | export function | 53 |
| 2 | `getFallbackApiClient` | function | 57 |
| 3 | `normalizeProductRows` | function | 63 |
| 4 | `getPayloadNumber` | function | 70 |
| 5 | `snapshotLookupProducts` | function | 75 |
| 6 | `mergeUniqueSnapshots` | function | 89 |
| 7 | `fetchLookupProductSnapshotsForName` | function | 113 |
| 8 | `fetchLookupProductSnapshots` | export function | 149 |
| 9 | `fetchProductsByIds` | function | 165 |
| 10 | `restoreLookupProductSnapshots` | export function | 194 |

### 3.388 `frontend/src/components/products/Products.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadProductReadModule` | function | 328 |
| 2 | `loadProductWriteModule` | function | 333 |
| 3 | `loadLookupModule` | function | 338 |
| 4 | `loadBranchModule` | function | 343 |
| 5 | `loadInventoryWriteModule` | function | 348 |
| 6 | `loadProductImageUploadModule` | function | 353 |
| 7 | `getProductApi` | function | 385 |
| 8 | `getErrorMessage` | function | 389 |
| 9 | `isObjectRecord` | function | 393 |
| 10 | `toProductApiResponse` | function | 397 |
| 11 | `scrollNodeWithOffset` | function | 401 |
| 12 | `loadProductWriteHelpers` | function | 409 |
| 13 | `summarizeProductRun` | function | 414 |
| 14 | `aggregateProductInitials` | function | 429 |
| 15 | `toModalProduct` | function | 440 |
| 16 | `toVariantParentProduct` | function | 452 |
| 17 | `toLightboxState` | function | 458 |
| 18 | `Products` | export default function | 468 |
| 19 | `promise` | const arrow | 565 |
| 20 | `handleSave` | const arrow | 821 |
| 21 | `handleSaveWithGallery` | const arrow | 871 |
| 22 | `handleBulkDelete` | const arrow | 938 |
| 23 | `handleBulkOutOfStock` | const arrow | 985 |
| 24 | `handleBulkChangeBranch` | const arrow | 1028 |
| 25 | `handleBulkAddStock` | const arrow | 1058 |
| 26 | `toggleSelect` | const arrow | 1066 |
| 27 | `toggleSelectAll` | const arrow | 1073 |
| 28 | `handleDelete` | const arrow | 1080 |
| 29 | `renderUnitChip` | const arrow | 1167 |
| 30 | `openLightbox` | const arrow | 1181 |
| 31 | `getStockBadge` | const arrow | 1188 |

### 3.389 `frontend/src/components/products/scanning/barcodeImageScanner.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readFileAsDataUrl` | function | 37 |
| 2 | `createImageElement` | function | 62 |
| 3 | `loadImageSource` | function | 66 |
| 4 | `detectWithNativeBarcodeDetector` | function | 75 |
| 5 | `scanBarcodeFromImageFile` | export function | 101 |

### 3.390 `frontend/src/components/products/scanning/BarcodeScannerModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getNativeBarcodeDetector` | function | 100 |
| 2 | `getScanErrorText` | function | 107 |
| 3 | `stopStream` | function | 112 |
| 4 | `BarcodeScannerModal` | export default function | 118 |

### 3.391 `frontend/src/components/products/scanning/barcodeScannerState.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `deriveScannerPresentation` | export function | 31 |

### 3.392 `frontend/src/components/products/scanning/cameraPermission.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeCameraPermissionState` | function | 9 |
| 2 | `queryCameraPermission` | function | 16 |
| 3 | `readCameraPermissionState` | export function | 25 |
| 4 | `watchCameraPermission` | export function | 30 |
| 5 | `handleChange` | const arrow | 35 |

### 3.393 `frontend/src/components/products/scanning/scanbotScanner.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `publicBasePath` | const arrow | 37 |
| 2 | `getScanbotGlobal` | function | 49 |
| 3 | `isCameraBlockedByDocumentPolicy` | export function | 54 |
| 4 | `normalizeScanbotError` | function | 68 |
| 5 | `loadScanbotScript` | function | 82 |
| 6 | `getPreferredScannerMode` | export function | 111 |
| 7 | `getInitializedScanbot` | function | 135 |
| 8 | `scanBarcodeWithScanbot` | export function | 150 |

### 3.394 `frontend/src/components/products/shared/primitives.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getImageApi` | function | 50 |
| 2 | `isRecentlyBrokenProductImage` | function | 54 |
| 3 | `markBrokenProductImage` | function | 62 |
| 4 | `sanitizeNumericInput` | function | 67 |
| 5 | `parseNumericInput` | function | 77 |
| 6 | `ProductImg` | function | 83 |
| 7 | `loadImageData` | function | 126 |
| 8 | `ProductImagePlaceholder` | function | 170 |
| 9 | `MarginCard` | function | 178 |
| 10 | `DualPriceInput` | function | 210 |
| 11 | `handleUsdChange` | const arrow | 211 |
| 12 | `handleKhrChange` | const arrow | 212 |

### 3.395 `frontend/src/components/products/surfaces/HeaderActions.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductsHeaderActions` | export default function | 22 |
| 2 | `tr` | const arrow | 32 |

### 3.396 `frontend/src/components/products/surfaces/ProductDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductDetailModal` | export default function | 79 |
| 2 | `T` | const arrow | 95 |
| 3 | `Row` | const arrow | 121 |

### 3.397 `frontend/src/components/products/surfaces/ProductRowParts.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductDiscountBadge` | export function | 75 |
| 2 | `ProductRowActions` | export function | 95 |
| 3 | `label` | const arrow | 104 |
| 4 | `ProductBatchPreview` | export function | 129 |
| 5 | `ProductDetailsCell` | export function | 163 |

### 3.398 `frontend/src/components/products/surfaces/ProductsListSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ProductsListSurface` | export default function | 62 |
| 2 | `renderDesktopTableHead` | const arrow | 105 |
| 3 | `renderDesktopLoadingShell` | const arrow | 134 |

### 3.399 `frontend/src/components/receipt-settings/AllFieldsPanel.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Toggle` | function | 30 |
| 2 | `AllFieldsPanel` | export default function | 46 |
| 3 | `T` | const arrow | 49 |
| 4 | `toggleSection` | const arrow | 68 |

### 3.400 `frontend/src/components/receipt-settings/constants.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getFieldItems` | export function | 109 |
| 2 | `T` | const arrow | 110 |

### 3.401 `frontend/src/components/receipt-settings/ErrorBoundary.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatError` | function | 11 |

### 3.402 `frontend/src/components/receipt-settings/FieldOrderManager.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSectionOrderItems` | function | 25 |
| 2 | `buildList` | function | 44 |
| 3 | `toKeys` | function | 69 |
| 4 | `FieldOrderManager` | export default function | 73 |
| 5 | `moveItem` | const arrow | 87 |
| 6 | `addDivider` | const arrow | 95 |
| 7 | `removeDivider` | const arrow | 106 |
| 8 | `handleDragStart` | const arrow | 112 |
| 9 | `handleDragOver` | const arrow | 117 |

### 3.403 `frontend/src/components/receipt-settings/PrintSettings.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Section` | function | 35 |
| 2 | `buildFallbackPreviewHtml` | function | 47 |
| 3 | `buildSafePreviewSource` | function | 65 |
| 4 | `PrintSettings` | export default function | 77 |
| 5 | `persistPrintSettings` | const arrow | 100 |
| 6 | `setValue` | const arrow | 116 |
| 7 | `resetMargins` | const arrow | 125 |
| 8 | `getPreviewSource` | const arrow | 148 |

### 3.404 `frontend/src/components/receipt-settings/ReceiptPreview.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatLoadError` | function | 34 |
| 2 | `ReceiptPreview` | export default function | 39 |
| 3 | `loadPreview` | function | 50 |

### 3.405 `frontend/src/components/receipt-settings/ReceiptSettings.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getErrorMessage` | function | 80 |
| 2 | `Section` | function | 85 |
| 3 | `Toggle` | function | 96 |
| 4 | `ReceiptSettings` | export default function | 111 |

### 3.406 `frontend/src/components/receipt-settings/template.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isRecord` | function | 6 |
| 2 | `parseTemplateInput` | function | 10 |
| 3 | `parseReceiptTemplate` | export function | 19 |
| 4 | `serializeReceiptTemplate` | export function | 30 |

### 3.407 `frontend/src/components/receipt/Receipt.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadReceiptPrintModule` | function | 108 |
| 2 | `toNumber` | function | 113 |
| 3 | `stripEmoji` | function | 118 |
| 4 | `stripEmoji` | function | 120 |
| 5 | `displayAddress` | function | 125 |
| 6 | `parseItems` | function | 134 |
| 7 | `getErrorMessage` | function | 145 |
| 8 | `getReceiptPaperWidthMm` | function | 149 |
| 9 | `labelFor` | function | 217 |
| 10 | `Row` | function | 222 |
| 11 | `Receipt` | export default function | 234 |
| 12 | `exportReceiptPdf` | const arrow | 450 |

### 3.408 `frontend/src/components/returns/EditReturnModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadReturnsTransport` | function | 91 |
| 2 | `updateReturnRequest` | function | 96 |
| 3 | `toNumber` | function | 101 |
| 4 | `clampReturnQuantity` | function | 106 |
| 5 | `isWriteConflict` | function | 112 |
| 6 | `EditReturnModal` | export default function | 117 |
| 7 | `updateQty` | const arrow | 150 |
| 8 | `updateRestock` | const arrow | 153 |

### 3.409 `frontend/src/components/returns/NewReturnModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadSalesTransport` | function | 122 |
| 2 | `loadReturnsTransport` | function | 127 |
| 3 | `loadReturnsReadTransport` | function | 132 |
| 4 | `searchReturnSales` | function | 137 |
| 5 | `loadExistingSaleReturns` | function | 143 |
| 6 | `createReturnRequest` | function | 149 |
| 7 | `toNumber` | function | 154 |
| 8 | `clampReturnQuantity` | function | 159 |
| 9 | `getSaleItemKey` | function | 165 |
| 10 | `NewReturnModal` | export default function | 169 |
| 11 | `handleSearch` | const arrow | 202 |
| 12 | `handleReturnTypeChange` | const arrow | 267 |
| 13 | `toggleIncluded` | const arrow | 272 |
| 14 | `updateItemQty` | const arrow | 280 |
| 15 | `updateItemRestock` | const arrow | 288 |
| 16 | `selectAll` | const arrow | 292 |
| 17 | `clearAll` | const arrow | 295 |
| 18 | `handleSubmit` | const arrow | 302 |

### 3.410 `frontend/src/components/returns/NewSupplierReturnModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isSupplierReturnItem` | function | 85 |
| 2 | `loadBranchTransport` | function | 104 |
| 3 | `loadContactReadTransport` | function | 109 |
| 4 | `loadInventoryTransport` | function | 114 |
| 5 | `loadReturnsTransport` | function | 119 |
| 6 | `loadSupplierReturnSetup` | function | 124 |
| 7 | `loadSupplierReturnInventory` | function | 139 |
| 8 | `createSupplierReturnRequest` | function | 145 |
| 9 | `NewSupplierReturnModal` | export default function | 150 |
| 10 | `clearSetupWatchdog` | const arrow | 200 |
| 11 | `loadSetup` | function | 203 |
| 12 | `loadInventory` | function | 257 |
| 13 | `updateQty` | const arrow | 341 |
| 14 | `submit` | const arrow | 347 |

### 3.411 `frontend/src/components/returns/ReturnDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeScope` | function | 52 |
| 2 | `coerceMoney` | function | 56 |
| 3 | `isPositiveMoney` | function | 60 |
| 4 | `ReturnDetailModal` | export default function | 64 |

### 3.412 `frontend/src/components/returns/Returns.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadReturnsWriteTransport` | function | 47 |
| 2 | `updateReturnRequest` | function | 116 |
| 3 | `normalizeScope` | function | 168 |
| 4 | `getReturnTypeKey` | function | 172 |
| 5 | `getReturnTypeLabel` | function | 178 |
| 6 | `normalizeFiniteIds` | function | 194 |
| 7 | `countSelectedIds` | function | 198 |
| 8 | `countActiveFlags` | function | 206 |
| 9 | `toNumericAmount` | function | 214 |
| 10 | `exportReturnRows` | function | 219 |
| 11 | `getInitialReturnPageSize` | function | 237 |
| 12 | `Returns` | export default function | 242 |
| 13 | `promise` | const arrow | 316 |

### 3.413 `frontend/src/components/returns/ReturnsListSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `detectMobileViewport` | function | 71 |
| 2 | `ReturnsDesktopSkeletonRows` | function | 76 |
| 3 | `ReturnsMobileSkeletonCards` | function | 93 |
| 4 | `ReturnsListSurface` | export default function | 113 |
| 5 | `apply` | const arrow | 144 |

### 3.414 `frontend/src/components/sales/ExportModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSalesExportApi` | function | 71 |
| 2 | `getErrorMessage` | function | 76 |
| 3 | `ExportModal` | export default function | 80 |
| 4 | `handlePreview` | const arrow | 154 |
| 5 | `handleExportCSV` | const arrow | 172 |

### 3.415 `frontend/src/components/sales/SaleDetailModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toNumber` | function | 74 |
| 2 | `InfoBlock` | function | 79 |
| 3 | `parseItems` | function | 95 |
| 4 | `SaleDetailModal` | export default function | 106 |

### 3.416 `frontend/src/components/sales/Sales.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSalesApi` | function | 127 |
| 2 | `normalizeSaleRows` | function | 132 |
| 3 | `normalizeUserOptions` | function | 140 |
| 4 | `getErrorMessage` | function | 145 |
| 5 | `isWriteConflict` | function | 149 |
| 6 | `multiMatch` | function | 156 |
| 7 | `normalizeFiniteIds` | function | 168 |
| 8 | `countSelectedIds` | function | 172 |
| 9 | `countActiveFlags` | function | 180 |
| 10 | `getSaleBranchLabel` | function | 188 |
| 11 | `buildSaleExportRows` | function | 196 |
| 12 | `Sales` | export default function | 212 |
| 13 | `promise` | const arrow | 303 |
| 14 | `toggleSelected` | const arrow | 650 |
| 15 | `toggleSelectAll` | const arrow | 656 |
| 16 | `handleBulkStatusUpdate` | const arrow | 732 |

### 3.417 `frontend/src/components/sales/SalesImportModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getImportApi` | function | 69 |
| 2 | `getErrorMessage` | function | 74 |
| 3 | `countSalesCsvRowsInWorker` | function | 78 |
| 4 | `cleanup` | const arrow | 90 |
| 5 | `SalesImportModal` | export default function | 110 |
| 6 | `handlePickFile` | const arrow | 163 |
| 7 | `handleDownloadTemplate` | const arrow | 169 |
| 8 | `handleImport` | const arrow | 173 |

### 3.418 `frontend/src/components/sales/salesImportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getErrorMessage` | function | 27 |

### 3.419 `frontend/src/components/sales/SalesListSurface.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSaleItems` | function | 67 |
| 2 | `SalesListSurface` | export default function | 71 |

### 3.420 `frontend/src/components/sales/StatusBadge.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isSaleStatus` | function | 24 |
| 2 | `getStatusLabel` | export function | 28 |
| 3 | `StatusBadge` | export default function | 50 |

### 3.421 `frontend/src/components/server/ServerPage.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getServerApi` | function | 139 |
| 2 | `getErrorMessage` | function | 143 |
| 3 | `normalizePendingSyncState` | function | 147 |
| 4 | `normalizeSystemDebugLog` | function | 158 |
| 5 | `normalizeSystemConfig` | function | 167 |
| 6 | `normalizeSystemBootstrap` | function | 171 |
| 7 | `useLocalCopy` | function | 179 |
| 8 | `isAutoDetected` | function | 190 |
| 9 | `StatusRow` | function | 197 |
| 10 | `InfoTab` | function | 209 |
| 11 | `DiagnosticsPanel` | function | 362 |
| 12 | `onErr` | const arrow | 401 |
| 13 | `onQueueChanged` | const arrow | 406 |
| 14 | `handleRetryQueue` | function | 464 |
| 15 | `handleDiscardQueue` | function | 481 |
| 16 | `ServerPage` | export default function | 672 |
| 17 | `check` | const arrow | 700 |
| 18 | `loadServerBootstrap` | const arrow | 731 |
| 19 | `handleTest` | function | 766 |
| 20 | `handleSave` | function | 795 |
| 21 | `handleDisconnect` | function | 802 |

### 3.422 `frontend/src/components/shared/ActionHistoryBar.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `formatHistoryList` | function | 46 |
| 2 | `formatServerStatus` | function | 50 |
| 3 | `ActionHistoryBar` | export default function | 57 |

### 3.423 `frontend/src/components/shared/AppSelect.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `optionValue` | function | 26 |
| 2 | `AppSelect` | export default function | 30 |
| 3 | `scheduleReposition` | const arrow | 80 |
| 4 | `closeIfOutside` | const arrow | 87 |
| 5 | `closeIfEscape` | const arrow | 93 |
| 6 | `chooseOption` | const arrow | 115 |
| 7 | `moveActive` | const arrow | 121 |
| 8 | `handleKeyDown` | const arrow | 131 |

### 3.424 `frontend/src/components/shared/BackgroundImportTracker.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getImportTrackerApi` | function | 105 |
| 2 | `getErrorMessage` | function | 110 |
| 3 | `nextImportTrackerBackoff` | function | 114 |
| 4 | `normalizeJobStatus` | function | 121 |
| 5 | `dedupeJobsById` | function | 125 |
| 6 | `isRecent` | function | 137 |
| 7 | `normalizeImportJobListResult` | function | 143 |
| 8 | `getJobProgressDetails` | function | 158 |
| 9 | `getJobLabel` | function | 226 |
| 10 | `getJobResultSummary` | function | 232 |
| 11 | `add` | const arrow | 235 |
| 12 | `getRowsDisplay` | function | 248 |
| 13 | `buildJobsSignature` | function | 264 |
| 14 | `BackgroundImportTracker` | export default function | 279 |
| 15 | `finishTrackerAction` | const arrow | 418 |
| 16 | `handleCancel` | const arrow | 423 |
| 17 | `handleRetry` | const arrow | 442 |
| 18 | `handleApprove` | const arrow | 461 |
| 19 | `handleDownloadErrors` | const arrow | 491 |
| 20 | `handleRemove` | const arrow | 508 |
| 21 | `handleDismiss` | const arrow | 546 |

### 3.425 `frontend/src/components/shared/ExportMenu.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ExportMenu` | export default function | 17 |

### 3.426 `frontend/src/components/shared/FilterMenu.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sectionButtonClass` | function | 56 |
| 2 | `getSectionFallbackLabel` | function | 62 |
| 3 | `resolveSectionLabel` | function | 73 |
| 4 | `FilterMenu` | export default function | 82 |

### 3.427 `frontend/src/components/shared/globalScroll.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getDocumentLike` | function | 21 |
| 2 | `getPageScrollCandidates` | function | 25 |
| 3 | `isVisibleScrollNode` | function | 38 |
| 4 | `getScrollTarget` | export function | 46 |
| 5 | `getScrollToPosition` | export function | 63 |

### 3.428 `frontend/src/components/shared/ImageGalleryLightbox.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ImageGalleryLightbox` | export default function | 31 |
| 2 | `formatLabel` | function | 53 |
| 3 | `setIndex` | function | 57 |
| 4 | `renderGalleryImage` | function | 63 |
| 5 | `onKeyDown` | function | 70 |

### 3.429 `frontend/src/components/shared/LazyPortalMenu.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `LazyPortalMenu` | export default function | 7 |

### 3.430 `frontend/src/components/shared/LoadingWatchdog.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `LoadingWatchdog` | export default function | 14 |

### 3.431 `frontend/src/components/shared/Modal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `Modal` | export default function | 13 |

### 3.432 `frontend/src/components/shared/navigationConfig.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseNavSetting` | export function | 42 |

### 3.433 `frontend/src/components/shared/NotificationCenter.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getErrorMessage` | function | 109 |
| 2 | `preferenceValue` | function | 236 |
| 3 | `matchesVisibilityMode` | function | 244 |
| 4 | `NotificationSeverityIcon` | function | 251 |
| 5 | `NotificationCenter` | export default function | 266 |
| 6 | `syncVisibility` | const arrow | 301 |
| 7 | `onVisible` | const arrow | 376 |
| 8 | `handleClickOutside` | const arrow | 400 |

### 3.434 `frontend/src/components/shared/pageActivity.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `useIsPageActive` | export function | 8 |

### 3.435 `frontend/src/components/shared/PageHeader.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PageHeader` | export default function | 26 |

### 3.436 `frontend/src/components/shared/PaginationControls.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `clampPage` | export function | 28 |
| 2 | `PaginationControls` | export default function | 42 |
| 3 | `commitPageDraft` | const arrow | 73 |
| 4 | `handlePageInputKeyDown` | const arrow | 84 |

### 3.437 `frontend/src/components/shared/PortalMenu.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isPortalMenuItem` | function | 50 |
| 2 | `PortalMenu` | export default function | 60 |
| 3 | `closeIfClickedOutside` | const arrow | 125 |
| 4 | `closeMenu` | const arrow | 133 |
| 5 | `scheduleReposition` | const arrow | 134 |
| 6 | `closeIfEscape` | const arrow | 141 |
| 7 | `ThreeDotPortal` | export function | 251 |

### 3.438 `frontend/src/components/shared/QuickPreferenceToggles.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ToggleButton` | function | 26 |
| 2 | `QuickPreferenceToggles` | export default function | 45 |
| 3 | `tr` | const arrow | 48 |

### 3.439 `frontend/src/components/shared/SectionSwitcher.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readStoredSection` | function | 20 |
| 2 | `SectionSwitcher` | export default function | 29 |
| 3 | `selectValue` | const arrow | 58 |

### 3.440 `frontend/src/components/shared/WriteConflictModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `asConflictRecord` | function | 34 |
| 2 | `isConflictSummaryRow` | function | 38 |
| 3 | `isVisibleFieldRow` | function | 42 |
| 4 | `formatConflictTime` | function | 46 |
| 5 | `valueToString` | function | 53 |
| 6 | `summarizeCurrentValue` | function | 57 |
| 7 | `formatValue` | function | 114 |
| 8 | `formatItemSummary` | function | 121 |
| 9 | `getConflictFieldRows` | function | 132 |
| 10 | `WriteConflictModal` | export default function | 226 |

### 3.441 `frontend/src/components/users/permissionDefinitions.ts`

- No top-level named symbols detected.

### 3.442 `frontend/src/components/users/PermissionEditor.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parsePermissionState` | function | 11 |
| 2 | `PermissionEditor` | export default function | 25 |
| 3 | `toggle` | const arrow | 40 |

### 3.443 `frontend/src/components/users/UserDetailSheet.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `translateLabel` | function | 43 |
| 2 | `buildRowData` | function | 48 |
| 3 | `parsePermissions` | function | 60 |
| 4 | `UserDetailSheet` | export default function | 71 |

### 3.444 `frontend/src/components/users/UserProfileModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getProfileApi` | function | 155 |
| 2 | `getErrorMessage` | function | 160 |
| 3 | `parseStoredOrganization` | function | 164 |
| 4 | `AvatarPreview` | function | 181 |
| 5 | `ProfileSectionButton` | function | 199 |
| 6 | `clamp` | function | 309 |
| 7 | `loadImageElement` | function | 313 |
| 8 | `renderAvatarCropBlob` | function | 328 |
| 9 | `AvatarEditorModal` | function | 354 |
| 10 | `UserProfileModal` | export default function | 415 |
| 11 | `handleProfileSave` | const arrow | 583 |
| 12 | `handlePasswordSave` | const arrow | 647 |
| 13 | `handleSessionSave` | const arrow | 686 |
| 14 | `refreshOtpState` | const arrow | 706 |

### 3.445 `frontend/src/components/users/Users.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getUsersApi` | function | 144 |
| 2 | `normalizeUsers` | function | 157 |
| 3 | `normalizeRoles` | function | 161 |
| 4 | `normalizePermissionState` | function | 165 |
| 5 | `getErrorMessage` | function | 180 |
| 6 | `clearTimeoutRef` | function | 184 |
| 7 | `scheduleUsersSecondaryRead` | function | 190 |
| 8 | `ThreeDot` | function | 219 |
| 9 | `formatContactValue` | function | 263 |
| 10 | `UsersDesktopSkeletonRows` | function | 268 |
| 11 | `UsersMobileSkeletonCards` | function | 292 |
| 12 | `Users` | export default function | 306 |
| 13 | `promise` | const arrow | 375 |
| 14 | `promise` | const arrow | 413 |
| 15 | `openCreateUser` | const arrow | 552 |
| 16 | `openCreateRole` | const arrow | 582 |
| 17 | `handleSaveUser` | const arrow | 643 |
| 18 | `handleResetPassword` | const arrow | 713 |
| 19 | `handleSaveRole` | const arrow | 770 |

### 3.446 `frontend/src/components/utils-settings/AuditLog.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadCsvUtilsModule` | function | 103 |
| 2 | `isRecord` | function | 108 |
| 3 | `getErrorMessage` | function | 112 |
| 4 | `toIso` | function | 144 |
| 5 | `formatDateTime` | function | 151 |
| 6 | `formatLogTime` | function | 172 |
| 7 | `auditDeviceLabel` | function | 176 |
| 8 | `auditTimezoneLabel` | function | 184 |
| 9 | `getLogEpoch` | function | 192 |
| 10 | `formatJsonPretty` | function | 199 |
| 11 | `parseLogJson` | function | 207 |
| 12 | `flattenSummaryValue` | function | 215 |
| 13 | `formatEntityName` | function | 234 |
| 14 | `readableSummary` | function | 240 |
| 15 | `normalizeFiniteIds` | function | 268 |
| 16 | `countSelectedIds` | function | 272 |
| 17 | `countActiveFlags` | function | 280 |
| 18 | `DetailRow` | function | 288 |
| 19 | `AuditLog` | export default function | 300 |
| 20 | `sessionEntryLabel` | function | 665 |

### 3.447 `frontend/src/components/utils-settings/Backup.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBackupApi` | function | 247 |
| 2 | `getErrorMessage` | function | 251 |
| 3 | `unwrapJob` | function | 255 |
| 4 | `isBackupSectionId` | function | 292 |
| 5 | `PathActionButton` | function | 341 |
| 6 | `PrimaryActionButton` | function | 353 |
| 7 | `formatElapsed` | function | 365 |
| 8 | `JobProgressCard` | function | 374 |
| 9 | `DoctorStatusPill` | function | 434 |
| 10 | `IntegrationDoctorCard` | function | 458 |
| 11 | `useCopy` | function | 564 |
| 12 | `formatDateTime` | function | 580 |
| 13 | `formatBytes` | function | 596 |
| 14 | `yieldToBrowser` | function | 605 |
| 15 | `getJobSignature` | function | 613 |
| 16 | `startJobWatcher` | function | 632 |
| 17 | `stop` | const arrow | 648 |
| 18 | `scheduleTick` | const arrow | 654 |
| 19 | `tick` | const arrow | 660 |
| 20 | `SectionChip` | function | 717 |
| 21 | `secondsToSyncMinutes` | function | 739 |
| 22 | `minutesToSyncSeconds` | function | 748 |
| 23 | `GoogleDriveSyncSection` | function | 756 |
| 24 | `handler` | const arrow | 878 |
| 25 | `savePreferences` | const arrow | 963 |
| 26 | `connectGoogleDrive` | const arrow | 993 |
| 27 | `syncNow` | const arrow | 1038 |
| 28 | `disconnect` | const arrow | 1075 |
| 29 | `forgetCredentials` | const arrow | 1100 |
| 30 | `BackupOverview` | function | 1330 |
| 31 | `Backup` | export default function | 1402 |
| 32 | `showBackupSection` | const arrow | 1418 |
| 33 | `handleFolderExport` | const arrow | 1453 |
| 34 | `handleFolderImport` | const arrow | 1522 |

### 3.448 `frontend/src/components/utils-settings/FontFamilyPicker.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `FontFamilyPicker` | export default function | 30 |

### 3.449 `frontend/src/components/utils-settings/index.ts`

- No top-level named symbols detected.

### 3.450 `frontend/src/components/utils-settings/OtpModal.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getOtpApi` | function | 45 |
| 2 | `getErrorMessage` | function | 49 |
| 3 | `OtpModal` | export default function | 53 |
| 4 | `loadSetup` | function | 88 |

### 3.451 `frontend/src/components/utils-settings/ResetData.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ConfirmReset` | function | 75 |
| 2 | `T` | const arrow | 88 |
| 3 | `getResetApi` | function | 156 |
| 4 | `getErrorMessage` | function | 160 |
| 5 | `ResetData` | function | 164 |
| 6 | `T` | const arrow | 166 |
| 7 | `doReset` | const arrow | 194 |
| 8 | `FactoryReset` | function | 264 |
| 9 | `T` | const arrow | 266 |
| 10 | `doFactoryReset` | function | 273 |

### 3.452 `frontend/src/components/utils-settings/Settings.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSettingsApi` | function | 133 |
| 2 | `getErrorMessage` | function | 137 |
| 3 | `toStringValue` | function | 141 |
| 4 | `toNumberValue` | function | 146 |
| 5 | `isSettingsSectionId` | function | 236 |
| 6 | `parseStoredColors` | function | 252 |
| 7 | `buildColorChoices` | function | 263 |
| 8 | `useCopy` | function | 354 |
| 9 | `getSettingsNavLabel` | function | 362 |
| 10 | `SwatchPicker` | function | 379 |
| 11 | `SettingsSection` | function | 462 |
| 12 | `Settings` | export default function | 492 |
| 13 | `showSettingsSection` | const arrow | 518 |
| 14 | `loadOtpStatus` | function | 588 |
| 15 | `loadFaviconPreview` | function | 620 |
| 16 | `scheduleIdlePreview` | const arrow | 635 |
| 17 | `setValue` | const arrow | 689 |
| 18 | `formatPreviewDateTime` | const arrow | 715 |
| 19 | `moveNavItem` | const arrow | 731 |
| 20 | `toggleMobilePinned` | const arrow | 741 |
| 21 | `movePinnedItem` | const arrow | 753 |
| 22 | `movePinnedBefore` | const arrow | 763 |
| 23 | `resetNavigationLayout` | const arrow | 775 |
| 24 | `field` | const arrow | 780 |
| 25 | `savePaymentMethods` | const arrow | 802 |
| 26 | `uploadImageSetting` | const arrow | 822 |
| 27 | `handleSaveSettings` | const arrow | 889 |

### 3.453 `frontend/src/components/utils-settings/settingsConflict.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeObject` | function | 28 |
| 2 | `buildSettingsConflictState` | export function | 32 |
| 3 | `diffSettingsConflictFields` | export function | 46 |

### 3.454 `frontend/src/constants.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createEmptyOrder` | export function | 128 |
| 2 | `formatDate` | export function | 152 |
| 3 | `isNetworkError` | export function | 181 |

### 3.455 `frontend/src/index.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `scheduleAfterLoadIdle` | function | 24 |
| 2 | `schedule` | const arrow | 27 |
| 3 | `registerOfflineAppShell` | function | 43 |
| 4 | `register` | const arrow | 46 |
| 5 | `installFormFieldAccessibility` | function | 60 |
| 6 | `escapeSelectorValue` | const arrow | 65 |
| 7 | `wireField` | const arrow | 70 |
| 8 | `scan` | const arrow | 92 |
| 9 | `safeInsertRule` | const function | 130 |
| 10 | `safeCssRulesGetter` | const function | 148 |
| 11 | `stopKnownStartupNoise` | const arrow | 164 |
| 12 | `scheduleFormFieldAccessibility` | function | 199 |
| 13 | `InitialShellFallback` | function | 212 |

### 3.456 `frontend/src/platform/runtime/clientRuntime.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `canUseBrowserStorage` | function | 30 |
| 2 | `isBusinessOsStorageKey` | function | 34 |
| 3 | `sanitizeText` | function | 39 |
| 4 | `sanitizeSyncServerUrl` | export function | 43 |
| 5 | `normalizeRuntimeDescriptor` | export function | 55 |
| 6 | `readStoredRuntimeDescriptor` | export function | 64 |
| 7 | `writeStoredRuntimeDescriptor` | export function | 75 |
| 8 | `shouldResetForRuntimeChange` | export function | 89 |
| 9 | `buildQueuedOperationScope` | export function | 106 |
| 10 | `doesQueuedScopeMatchCurrent` | export function | 114 |
| 11 | `unregisterServiceWorkers` | function | 151 |
| 12 | `deleteBusinessOsCaches` | function | 155 |
| 13 | `clearServiceWorkersAndCaches` | function | 161 |
| 14 | `snapshotStorage` | function | 177 |
| 15 | `clearStorage` | function | 190 |
| 16 | `restoreStorage` | function | 203 |
| 17 | `resetClientRuntimeState` | export function | 213 |

### 3.457 `frontend/src/platform/storage/storagePolicy.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `shouldPersistLocalMirror` | export function | 22 |
| 2 | `maxStoredNumber` | export function | 29 |
| 3 | `isCooldownActive` | export function | 36 |

### 3.458 `frontend/src/public-runtime/runtime-noise-guard.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `text` | function | 22 |
| 2 | `sourceFromEvent` | function | 26 |
| 3 | `isFirstPartyAsset` | function | 36 |
| 4 | `isInjectedSource` | function | 40 |
| 5 | `isKnownNoise` | function | 45 |
| 6 | `suppress` | function | 58 |
| 7 | `guardedInsertRule` | const function | 89 |
| 8 | `guardedCssRulesGetter` | const function | 104 |

### 3.459 `frontend/src/public-runtime/service-worker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `openBusinessDb` | function | 25 |
| 2 | `txDone` | function | 33 |
| 3 | `requestResult` | function | 41 |
| 4 | `readSetting` | function | 48 |
| 5 | `stableStringify` | function | 55 |
| 6 | `sha256` | function | 61 |
| 7 | `readQueuedBusinessOutbox` | function | 69 |
| 8 | `putBusinessOutboxRow` | function | 78 |
| 9 | `deleteBusinessOutboxRow` | function | 85 |
| 10 | `readPendingFileChunks` | function | 92 |
| 11 | `readQueuedSales` | function | 101 |
| 12 | `putQueueRow` | function | 114 |
| 13 | `deleteQueueRow` | function | 125 |
| 14 | `broadcastSyncEvent` | function | 132 |
| 15 | `nextRetryAt` | function | 143 |
| 16 | `markQueueFailure` | function | 152 |
| 17 | `replayQueuedSale` | function | 161 |
| 18 | `responsePayload` | const arrow | 183 |
| 19 | `syncOutbox` | function | 224 |
| 20 | `isSameOrigin` | function | 347 |
| 21 | `isNeverCachedPath` | function | 355 |
| 22 | `isCacheableStaticPath` | function | 363 |
| 23 | `isHashedBuildAsset` | function | 370 |
| 24 | `appShellFallback` | function | 374 |
| 25 | `networkFirstStatic` | function | 393 |
| 26 | `cacheFirstStatic` | function | 412 |

### 3.460 `frontend/src/public-runtime/theme-bootstrap.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `text` | function | 21 |
| 2 | `normalizeTheme` | function | 25 |
| 3 | `readJsonObject` | function | 30 |
| 4 | `isKnownBridgeNoise` | function | 39 |
| 5 | `isKnownEvalNoise` | function | 48 |
| 6 | `isKnownStyleNoise` | function | 54 |
| 7 | `isStaleModuleGraphError` | function | 70 |
| 8 | `requestStaleModuleReload` | function | 77 |
| 9 | `isFirstPartyBuiltAssetSource` | function | 94 |
| 10 | `hasInjectedBundleSource` | function | 102 |
| 11 | `isGuardableSheetError` | function | 112 |
| 12 | `shouldSuppressRuntimeError` | function | 116 |
| 13 | `installStyleSheetGuards` | function | 126 |
| 14 | `safeInsertRule` | const function | 132 |
| 15 | `safeCssRulesGetter` | const function | 147 |

### 3.461 `frontend/src/public-web-api.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadPortalTransport` | function | 18 |
| 2 | `getPortalMethod` | function | 23 |

### 3.462 `frontend/src/PublicCatalogRoot.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `PublicCatalogFallback` | function | 6 |
| 2 | `PublicCatalogRoot` | export default function | 16 |

### 3.463 `frontend/src/runtime/runtimeErrorClassifier.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `messageOf` | function | 27 |
| 2 | `stackOf` | function | 31 |
| 3 | `toText` | function | 35 |
| 4 | `includesExtensionOrigin` | function | 39 |
| 5 | `getPathname` | function | 44 |
| 6 | `isFirstPartyBuiltAssetSource` | export function | 54 |
| 7 | `isLikelyInjectedRuntimeSource` | export function | 64 |
| 8 | `isKnownBridgeMessage` | export function | 75 |
| 9 | `isKnownStyleInjectionNoise` | export function | 86 |
| 10 | `isKnownEvalCspNoise` | export function | 105 |
| 11 | `shouldSuppressRuntimeError` | export function | 112 |
| 12 | `shouldSuppressSecurityPolicyViolation` | export function | 134 |
| 13 | `isGuardableStyleSheetError` | export function | 148 |

### 3.464 `frontend/src/types/lucide-react-icons.d.ts`

- No top-level named symbols detected.

### 3.465 `frontend/src/types/receiptContracts.ts`

- No top-level named symbols detected.

### 3.466 `frontend/src/types/settingsContracts.ts`

- No top-level named symbols detected.

### 3.467 `frontend/src/utils/actionGuards.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `hasOwn` | function | 18 |
| 2 | `beginNamedAction` | export function | 41 |
| 3 | `finishNamedAction` | export function | 52 |
| 4 | `beginKeyedAction` | export function | 58 |
| 5 | `finishKeyedAction` | export function | 70 |

### 3.468 `frontend/src/utils/actionHistory.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadActionHistoryTransport` | function | 85 |
| 2 | `scheduleActionHistoryRead` | function | 90 |
| 3 | `normalizeActionHistoryId` | function | 108 |
| 4 | `normalizeEntry` | function | 114 |
| 5 | `parsePermissions` | function | 127 |
| 6 | `getErrorMessage` | function | 139 |
| 7 | `useActionHistory` | export function | 143 |

### 3.469 `frontend/src/utils/appRefresh.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeRefreshChannels` | export function | 20 |
| 2 | `refreshAppData` | export function | 28 |

### 3.470 `frontend/src/utils/bulkOps.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runner` | function | 47 |

### 3.471 `frontend/src/utils/color.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeHex` | function | 1 |
| 2 | `relativeLuminance` | function | 12 |
| 3 | `getContrastingTextColor` | export function | 29 |

### 3.472 `frontend/src/utils/csv.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `escapeCsvValue` | function | 17 |
| 2 | `buildCSV` | export function | 28 |
| 3 | `downloadBlob` | export function | 40 |
| 4 | `downloadCSV` | export function | 48 |
| 5 | `normalizeZipFile` | function | 54 |
| 6 | `CRC32_TABLE` | const arrow | 66 |
| 7 | `crc32` | function | 78 |
| 8 | `writeUint16` | function | 86 |
| 9 | `writeUint32` | function | 90 |
| 10 | `toBlobPart` | function | 94 |
| 11 | `encodeZipTimestamp` | function | 100 |
| 12 | `buildZip` | export function | 113 |
| 13 | `buildZipInWorker` | export function | 190 |
| 14 | `downloadZipFiles` | export function | 219 |
| 15 | `downloadZipFilesAsync` | export function | 225 |

### 3.473 `frontend/src/utils/csvExportWorker.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getErrorMessage` | function | 20 |

### 3.474 `frontend/src/utils/csvImport.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `stripBom` | function | 24 |
| 2 | `toUint8Array` | function | 28 |
| 3 | `detectUtf16Encoding` | function | 35 |
| 4 | `decodeUtf16Be` | function | 56 |
| 5 | `decodeTextBuffer` | export function | 66 |
| 6 | `normalizeDigit` | function | 89 |
| 7 | `normalizeNumericText` | export function | 97 |
| 8 | `countDelimiter` | function | 104 |
| 9 | `detectCsvDelimiter` | export function | 123 |
| 10 | `splitCsvLine` | export function | 131 |
| 11 | `parseDelimitedRows` | export function | 165 |
| 12 | `normalizeCsvKey` | export function | 210 |
| 13 | `parseCsvRows` | export function | 218 |
| 14 | `removeCurrencyNoise` | function | 237 |
| 15 | `normalizeNumberSeparators` | function | 244 |
| 16 | `parseCsvNumber` | export function | 280 |
| 17 | `parseRequiredCsvNumber` | export function | 290 |
| 18 | `normalizeCsvMoney` | export function | 299 |
| 19 | `normalizeCsvPercent` | export function | 303 |

### 3.475 `frontend/src/utils/csvRowCounter.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `countCsvDataRows` | export function | 1 |
| 2 | `finishRecord` | const arrow | 7 |

### 3.476 `frontend/src/utils/csvTemplate.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildCSVTemplate` | export function | 3 |

### 3.477 `frontend/src/utils/dateHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toLocalDateString` | function | 4 |
| 2 | `todayStr` | export function | 8 |
| 3 | `offsetDate` | export function | 13 |

### 3.478 `frontend/src/utils/deviceInfo.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getBrowserName` | function | 13 |
| 2 | `getOperatingSystemName` | function | 21 |
| 3 | `getClientDeviceInfo` | export function | 30 |
| 4 | `getClientMetaHeaders` | export function | 42 |

### 3.479 `frontend/src/utils/exportPackage.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildReportManifestRows` | export function | 30 |
| 2 | `buildReportPackageFiles` | export function | 38 |

### 3.480 `frontend/src/utils/exportReports.tsx`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `escapeHtml` | function | 255 |
| 2 | `formatCellValue` | function | 264 |
| 3 | `renderChartMarkup` | function | 269 |
| 4 | `renderMetadataGroups` | function | 285 |
| 5 | `renderSummaryCards` | function | 307 |
| 6 | `renderCharts` | function | 322 |
| 7 | `renderTables` | function | 340 |
| 8 | `renderNotes` | function | 374 |
| 9 | `buildStandaloneReportHtml` | export function | 386 |

### 3.481 `frontend/src/utils/favicon.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `clamp` | function | 11 |
| 2 | `shouldUseAnonymousCors` | function | 18 |
| 3 | `loadImage` | function | 29 |
| 4 | `createCircularFaviconDataUrl` | export function | 49 |

### 3.482 `frontend/src/utils/formatters.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeTimestampInput` | function | 6 |
| 2 | `fmtTime` | export function | 28 |
| 3 | `fmtDate` | export function | 52 |
| 4 | `fmtShort` | export function | 73 |
| 5 | `fmtCount` | export function | 85 |

### 3.483 `frontend/src/utils/groupedRecords.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeName` | function | 33 |
| 2 | `getAlphabetInitialSection` | export function | 37 |
| 3 | `compareAlphabetLabels` | function | 41 |

### 3.484 `frontend/src/utils/historyHelpers.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `extractHistoryResultId` | export function | 26 |
| 2 | `resolveCreatedHistorySnapshot` | export function | 36 |

### 3.485 `frontend/src/utils/importJobRefresh.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeImportJobStatus` | function | 24 |
| 2 | `normalizeImportJobType` | function | 28 |
| 3 | `uniqueChannels` | function | 32 |
| 4 | `dispatchSyncUpdate` | function | 41 |
| 5 | `getImportCompletionRefreshChannels` | export function | 45 |
| 6 | `shouldDispatchImportCompletionRefresh` | export function | 68 |
| 7 | `dispatchImportCompletionRefresh` | export function | 79 |

### 3.486 `frontend/src/utils/index.ts`

- No top-level named symbols detected.

### 3.487 `frontend/src/utils/initials.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeInitialText` | export function | 30 |
| 2 | `getInitialKey` | export function | 34 |
| 3 | `getInitialType` | export function | 45 |
| 4 | `getInitialRank` | function | 54 |
| 5 | `compareInitialKeys` | export function | 64 |
| 6 | `aggregateInitialOptions` | export function | 79 |
| 7 | `buildInitialOptionsFromProducts` | export function | 97 |

### 3.488 `frontend/src/utils/loaders.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `settleLoaderMap` | export function | 20 |
| 2 | `beginTrackedRequest` | export function | 47 |
| 3 | `isTrackedRequestCurrent` | export function | 53 |
| 4 | `invalidateTrackedRequest` | export function | 57 |
| 5 | `createLoaderTimeoutError` | export function | 63 |
| 6 | `getLoaderErrorMessage` | export function | 93 |
| 7 | `getFirstLoaderError` | export function | 97 |

### 3.489 `frontend/src/utils/mediaUpload.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildCacheBustedMediaPath` | export function | 11 |

### 3.490 `frontend/src/utils/mediaUploadState.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createInitialUploadState` | export function | 31 |
| 2 | `isTemporaryPreviewUrl` | export function | 45 |
| 3 | `sanitizePersistedMediaPath` | export function | 50 |
| 4 | `reduceUploadState` | export function | 57 |

### 3.491 `frontend/src/utils/permissions.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isPermissionMap` | function | 3 |
| 2 | `parsePermissionMap` | export function | 7 |

### 3.492 `frontend/src/utils/pricing.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toFiniteNumber` | export function | 15 |
| 2 | `roundUpToDecimals` | export function | 20 |
| 3 | `normalizePriceValue` | export function | 32 |
| 4 | `formatPriceNumber` | export function | 36 |
| 5 | `normalizeDiscountPercent` | export function | 43 |
| 6 | `normalizeDiscountType` | export function | 48 |
| 7 | `isProductDiscountActive` | export function | 52 |
| 8 | `calculateProductDiscount` | export function | 65 |

### 3.493 `frontend/src/utils/printReceipt.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parsePrintNumber` | function | 46 |
| 2 | `cloneElementWithInlineStyles` | function | 119 |
| 3 | `escapeHtml` | function | 165 |
| 4 | `blobToDataUrl` | function | 174 |
| 5 | `inlineImageNodeSources` | function | 197 |
| 6 | `extractUrlsFromCssValue` | function | 220 |
| 7 | `inlineStyleAssetUrls` | function | 226 |
| 8 | `normalizePrintableRoot` | function | 260 |
| 9 | `mmToPt` | function | 277 |
| 10 | `dataUrlToBytes` | function | 281 |
| 11 | `bytesToBlobPart` | function | 291 |
| 12 | `joinPdfChunks` | function | 295 |
| 13 | `buildPdfStream` | function | 306 |
| 14 | `buildSingleImagePdf` | function | 315 |
| 15 | `escapePdfText` | function | 353 |
| 16 | `wrapTextLine` | function | 360 |
| 17 | `buildTextOnlyPdf` | function | 379 |
| 18 | `buildReceiptFileName` | function | 432 |
| 19 | `wrapReceiptFallbackLine` | function | 443 |
| 20 | `classifyReceiptFallbackLine` | function | 470 |
| 21 | `measureWrappedReceiptHeight` | function | 482 |
| 22 | `wrapCanvasText` | function | 490 |
| 23 | `drawClippedText` | function | 526 |
| 24 | `createTextOnlyReceiptCanvas` | function | 535 |
| 25 | `canvasToPngBlob` | function | 638 |
| 26 | `waitForElementAssets` | function | 651 |
| 27 | `renderElementToCanvas` | function | 680 |
| 28 | `createPrintableReceiptMarkup` | function | 791 |
| 29 | `buildPrintablePreviewDocument` | function | 814 |
| 30 | `attachPrintablePreviewActions` | function | 969 |
| 31 | `schedulePrint` | const arrow | 978 |
| 32 | `openPrintableReceiptPreview` | export function | 983 |
| 33 | `downloadBlob` | function | 996 |
| 34 | `getPrintSettings` | export function | 1007 |
| 35 | `savePrintSettings` | export function | 1020 |
| 36 | `getPaperWidthMm` | export function | 1028 |
| 37 | `createReceiptPdfBlob` | export function | 1038 |
| 38 | `buildTextOnlyReceiptBlob` | const arrow | 1044 |
| 39 | `renderPdfBlob` | const arrow | 1058 |
| 40 | `createReceiptImageBlob` | export function | 1093 |
| 41 | `extractReceiptLines` | function | 1114 |
| 42 | `downloadReceiptPdf` | export function | 1212 |
| 43 | `downloadReceiptImage` | export function | 1231 |
| 44 | `openReceiptPdf` | export function | 1238 |
| 45 | `printReceipt` | export function | 1262 |

### 3.494 `frontend/src/utils/productBatches.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeBranchId` | function | 26 |
| 2 | `getVisibleProductBatches` | export function | 32 |
| 3 | `buildBatchPreview` | export function | 53 |

### 3.495 `frontend/src/utils/productGrouping.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeText` | function | 63 |
| 2 | `toProductId` | function | 67 |
| 3 | `normalizeProductGroupName` | export function | 72 |
| 4 | `getNameInitialSection` | export function | 76 |
| 5 | `compareSectionLabels` | function | 80 |
| 6 | `compareProducts` | function | 84 |
| 7 | `buildChildrenByParentId` | function | 107 |
| 8 | `resolveRootProduct` | function | 118 |
| 9 | `resolveFamilyRootId` | function | 136 |
| 10 | `compareProductsWithinGroup` | function | 140 |
| 11 | `resolveGroupKey` | function | 155 |
| 12 | `buildProductGroups` | export function | 175 |
| 13 | `buildProductGroupSections` | export function | 275 |

### 3.496 `frontend/src/utils/publicAssetUrls.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `trimBaseUrl` | function | 11 |
| 2 | `normalizeUploadPath` | function | 15 |
| 3 | `appendAssetVersion` | function | 23 |
| 4 | `isLocalLikeHostname` | function | 38 |
| 5 | `getSafeCurrentOrigin` | function | 42 |
| 6 | `getStoredPublicAssetBaseUrl` | export function | 54 |
| 7 | `api` | const arrow | 57 |
| 8 | `resolvePublicAssetUrl` | export function | 68 |

### 3.497 `frontend/src/utils/receiptAppliedConfig.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseObject` | function | 67 |
| 2 | `normalizeReceiptTemplate` | export function | 85 |
| 3 | `serializeReceiptTemplateValue` | export function | 92 |
| 4 | `normalizeReceiptPrintSettings` | export function | 96 |
| 5 | `serializeReceiptPrintSettings` | export function | 110 |
| 6 | `readReceiptPrintSettingsFromSettings` | export function | 114 |
| 7 | `buildAppliedReceiptConfig` | export function | 118 |

### 3.498 `frontend/src/utils/recordFilters.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toDate` | function | 15 |
| 2 | `getTimeParts` | export function | 34 |
| 3 | `matchesYearMonthFilters` | export function | 66 |
| 4 | `getTimeGroupingMode` | export function | 85 |
| 5 | `toggleIdSet` | export function | 91 |

### 3.499 `frontend/src/utils/scriptTypography.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `containsKhmerScript` | export function | 8 |
| 2 | `withKhmerTextClass` | export function | 12 |
| 3 | `getKhmerTextProps` | export function | 18 |

### 3.500 `frontend/src/utils/searchTerms.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `buildProductSearchTerms` | export function | 1 |

### 3.501 `frontend/src/utils/settingsRefresh.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeSettingKeys` | function | 62 |
| 2 | `getSettingsRefreshChannels` | export function | 70 |

### 3.502 `frontend/src/utils/settingsWriteOptions.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeSettingsWriteOptions` | export function | 3 |

### 3.503 `frontend/src/web-api.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `sanitizeBaseUrl` | function | 119 |
| 2 | `isPublicRuntimePath` | function | 123 |
| 3 | `getOfflineDb` | function | 129 |
| 4 | `loadMethodsModule` | function | 134 |
| 5 | `loadAppBootstrapModule` | function | 139 |
| 6 | `loadAuthTransportModule` | function | 144 |
| 7 | `loadPortalTransportModule` | function | 149 |
| 8 | `loadSystemRuntimeModule` | function | 154 |
| 9 | `loadSaleWriteTransportModule` | function | 159 |
| 10 | `loadOfflineSnapshotTransportModule` | function | 164 |
| 11 | `loadNotificationSummaryModule` | function | 169 |
| 12 | `loadSettingsTransportModule` | function | 174 |
| 13 | `loadProductReadTransportModule` | function | 179 |
| 14 | `loadProductWriteTransportModule` | function | 184 |
| 15 | `loadLookupTransportModule` | function | 189 |
| 16 | `loadBranchTransportModule` | function | 194 |
| 17 | `loadUserReadTransportModule` | function | 199 |
| 18 | `loadActionHistoryTransportModule` | function | 204 |
| 19 | `getLazyApiMethod` | function | 242 |
| 20 | `serializePendingSyncPreview` | function | 256 |
| 21 | `mapOfflineFileChunkStatusUpdates` | function | 279 |
| 22 | `asArrayBuffer` | function | 295 |
| 23 | `bytesToBase64` | function | 299 |
| 24 | `base64ToBytes` | function | 310 |
| 25 | `stableStringify` | function | 317 |
| 26 | `sha256Hex` | function | 323 |
| 27 | `deriveOfflineVaultKey` | function | 331 |
| 28 | `encryptOfflineVaultValue` | function | 348 |
| 29 | `decryptOfflineVaultValue` | function | 356 |
| 30 | `requestOfflinePersistentStorage` | function | 366 |
| 31 | `dispatchVaultLocked` | function | 373 |
| 32 | `scheduleOfflineVaultIdleLock` | function | 378 |
| 33 | `lockOfflineVault` | function | 384 |
| 34 | `unlockOfflineVault` | function | 392 |
| 35 | `queueBusinessOutboxOperation` | function | 418 |
| 36 | `queueOfflineFileChunks` | function | 455 |
| 37 | `dispatchOutboxProgress` | function | 509 |
| 38 | `dispatchOutboxFileProgress` | function | 516 |
| 39 | `dispatchOutboxConflict` | function | 523 |
| 40 | `getSyncOutboxKey` | function | 530 |
| 41 | `syncUnlockedOfflineOutbox` | function | 534 |
| 42 | `syncUnlockedOfflineFileChunks` | function | 644 |
| 43 | `refreshOfflineSnapshotSoon` | function | 706 |
| 44 | `run` | const arrow | 716 |
| 45 | `refreshServiceWorkerSoon` | function | 737 |
| 46 | `runOfflineMaintenance` | function | 747 |
| 47 | `startOfflineMaintenanceLoop` | function | 762 |
| 48 | `scheduleInitialOfflineMaintenance` | function | 770 |
| 49 | `run` | const arrow | 774 |
| 50 | `scheduleIdle` | const arrow | 778 |
| 51 | `ensureSessionRecoveryListeners` | function | 795 |
| 52 | `scheduleBootstrapStorageMaintenance` | function | 820 |
| 53 | `run` | const arrow | 826 |
| 54 | `scheduleBootstrapOfflineDbWrite` | function | 843 |
| 55 | `run` | const arrow | 849 |
| 56 | `write` | const arrow | 851 |
| 57 | `forwardServiceWorkerOutboxEvent` | function | 870 |
| 58 | `forwardServiceWorkerAppEvent` | function | 958 |

### 3.504 `frontend/tailwind.config.ts`

- No top-level named symbols detected.

### 3.505 `frontend/tests/actionGuards.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 15 |

### 3.506 `frontend/tests/actionStability.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readFrontend` | function | 12 |
| 2 | `readRepo` | function | 16 |
| 3 | `runTest` | function | 22 |

### 3.507 `frontend/tests/adminShellMediaGuards.test.ts`

- No top-level named symbols detected.

### 3.508 `frontend/tests/apiHttp.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 50 |
| 2 | `createDeferredResponse` | function | 61 |
| 3 | `resetApiState` | function | 72 |

### 3.509 `frontend/tests/appRefresh.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `testNormalizeRefreshChannels` | function | 10 |
| 2 | `testRefreshAppDataDispatchesMergedDetail` | function | 17 |

### 3.510 `frontend/tests/appShellUtils.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 12 |

### 3.511 `frontend/tests/assetCompression.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `collectMediaFiles` | function | 12 |

### 3.512 `frontend/tests/backupJobs.test.ts`

- No top-level named symbols detected.

### 3.513 `frontend/tests/barcodeImageScanner.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createLoadedImage` | function | 13 |
| 2 | `runTest` | function | 29 |

### 3.514 `frontend/tests/barcodeScannerState.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.515 `frontend/tests/bulkOps.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.516 `frontend/tests/contactImportWorker.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |

### 3.517 `frontend/tests/csvImport.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |

### 3.518 `frontend/tests/dashboardDataReliability.test.ts`

- No top-level named symbols detected.

### 3.519 `frontend/tests/dateHelpers.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |
| 2 | `parseLocalDate` | function | 19 |

### 3.520 `frontend/tests/deviceInfo.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |
| 2 | `withNavigator` | function | 19 |

### 3.521 `frontend/tests/exportPackages.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 10 |

### 3.522 `frontend/tests/formatters.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.523 `frontend/tests/globalScroll.test.ts`

- No top-level named symbols detected.

### 3.524 `frontend/tests/globalScrollControls.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.525 `frontend/tests/groupedRecords.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.526 `frontend/tests/historyHelpers.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 13 |

### 3.527 `frontend/tests/importJobRefresh.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `testProductImportChannels` | function | 14 |
| 2 | `testSupplierImportChannels` | function | 21 |
| 3 | `testDispatchOnlyOnTerminalTransition` | function | 28 |
| 4 | `testDispatchEmitsExpectedEvents` | function | 52 |

### 3.528 `frontend/tests/initials.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 14 |

### 3.529 `frontend/tests/inventoryImportWorker.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |

### 3.530 `frontend/tests/inventoryMobileCardLayout.test.ts`

- No top-level named symbols detected.

### 3.531 `frontend/tests/inventoryMovementGroups.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.532 `frontend/tests/inventoryRfidSection.test.ts`

- No top-level named symbols detected.

### 3.533 `frontend/tests/loaders.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 16 |

### 3.534 `frontend/tests/mediaUploadHelpers.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.535 `frontend/tests/navigationConfig.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.536 `frontend/tests/notificationBadge.test.ts`

- No top-level named symbols detected.

### 3.537 `frontend/tests/offlineSalesQueue.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.538 `frontend/tests/offlineSecurityHardening.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.539 `frontend/tests/offlineSyncArchitecture.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.540 `frontend/tests/ownedGoogleAuth.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.541 `frontend/tests/performanceLoadingUx.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assertLoadWatchdogKeepsLoading` | function | 123 |

### 3.542 `frontend/tests/permissionEditor.test.ts`

- No top-level named symbols detected.

### 3.543 `frontend/tests/permissions.test.ts`

- No top-level named symbols detected.

### 3.544 `frontend/tests/portalCatalogDisplay.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 22 |

### 3.545 `frontend/tests/portalContentI18n.test.ts`

- No top-level named symbols detected.

### 3.546 `frontend/tests/portalEditorUtils.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 13 |

### 3.547 `frontend/tests/portalFaqVocabulary.test.ts`

- No top-level named symbols detected.

### 3.548 `frontend/tests/portalLanguagePacks.test.ts`

- No top-level named symbols detected.

### 3.549 `frontend/tests/portalTranslateController.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createStorage` | function | 46 |
| 2 | `createDocument` | function | 61 |
| 3 | `TestEvent` | class | 132 |

### 3.550 `frontend/tests/posCore.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 18 |

### 3.551 `frontend/tests/pricingContacts.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 15 |

### 3.552 `frontend/tests/productBatches.test.ts`

- No top-level named symbols detected.

### 3.553 `frontend/tests/productDiscountUx.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.554 `frontend/tests/productDisplayHelpers.test.ts`

- No top-level named symbols detected.

### 3.555 `frontend/tests/productFilterHelpers.test.ts`

- No top-level named symbols detected.

### 3.556 `frontend/tests/productGalleryHelpers.test.ts`

- No top-level named symbols detected.

### 3.557 `frontend/tests/productGrouping.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.558 `frontend/tests/productGroupViewHelpers.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fmtUSD` | const arrow | 7 |
| 2 | `t` | const arrow | 8 |

### 3.559 `frontend/tests/productHistoryHelpers.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.560 `frontend/tests/productImportPlanner.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 15 |

### 3.561 `frontend/tests/productImportWorkerFallback.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |

### 3.562 `frontend/tests/productMenuHelpers.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `exportProductsCsv` | const arrow | 16 |
| 2 | `tr` | const arrow | 19 |
| 3 | `asActionItem` | function | 21 |
| 4 | `requireSection` | function | 27 |
| 5 | `action` | const arrow | 108 |

### 3.563 `frontend/tests/productPageHelpers.test.ts`

- No top-level named symbols detected.

### 3.564 `frontend/tests/productSearchPagination.test.ts`

- No top-level named symbols detected.

### 3.565 `frontend/tests/productSelectionHelpers.test.ts`

- No top-level named symbols detected.

### 3.566 `frontend/tests/productWriteHelpers.test.ts`

- No top-level named symbols detected.

### 3.567 `frontend/tests/publicErrorRecovery.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `createStorage` | function | 10 |

### 3.568 `frontend/tests/receiptSettingsSync.test.ts`

- No top-level named symbols detected.

### 3.569 `frontend/tests/receiptTemplate.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 10 |

### 3.570 `frontend/tests/returnsLayout.test.ts`

- No top-level named symbols detected.

### 3.571 `frontend/tests/runtimeErrorClassifier.test.ts`

- No top-level named symbols detected.

### 3.572 `frontend/tests/salesImportWorker.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 9 |

### 3.573 `frontend/tests/scanbotScanner.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `setNavigator` | function | 19 |
| 2 | `run` | function | 27 |

### 3.574 `frontend/tests/scriptTypography.test.ts`

- No top-level named symbols detected.

### 3.575 `frontend/tests/sectionNavigation.test.ts`

- No top-level named symbols detected.

### 3.576 `frontend/tests/settingsConflictHelpers.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 8 |

### 3.577 `frontend/tests/settingsRefresh.test.ts`

- No top-level named symbols detected.

### 3.578 `frontend/tests/sourceSyntaxCheck.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `listSourceFiles` | function | 17 |

### 3.579 `frontend/tests/storagePolicy.test.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `runTest` | function | 15 |

### 3.580 `frontend/tests/utilsSettingsBarrel.test.ts`

- No top-level named symbols detected.

### 3.581 `frontend/vite.config.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readGitRevision` | function | 12 |
| 2 | `escapeInlineScript` | function | 54 |
| 3 | `inlinePublicRuntimeScripts` | function | 60 |
| 4 | `fixCrossorigin` | function | 85 |
| 5 | `emitBuildManifest` | function | 110 |
| 6 | `isBundleChunk` | function | 226 |
| 7 | `toRoutePreloadFiles` | function | 230 |
| 8 | `buildRoutePreloadScript` | function | 242 |
| 9 | `normalizePath` | function | 245 |
| 10 | `isAdminAppPath` | function | 253 |
| 11 | `isLoginPath` | function | 286 |
| 12 | `isPublicCatalogPath` | function | 289 |
| 13 | `hasEmbeddedAuthBootstrap` | function | 295 |
| 14 | `routePreloadKey` | function | 298 |
| 15 | `injectRouteAwareModulePreloads` | function | 352 |
| 16 | `deferRenderBlockingStylesheets` | function | 373 |
| 17 | `activate` | function | 396 |
| 18 | `shouldDeferModulePreload` | function | 595 |
| 19 | `manualChunks` | function | 599 |

### 3.582 `ops/scripts/architecture/generated-bulk-audit.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseArgs` | function | 157 |
| 2 | `walkPathStats` | function | 171 |
| 3 | `recursivePathStats` | function | 208 |
| 4 | `pathStats` | function | 237 |
| 5 | `hasAnyToken` | function | 258 |
| 6 | `toPowerShellTargetToken` | function | 262 |
| 7 | `compactTargetRows` | function | 266 |
| 8 | `compactTimedRows` | function | 281 |
| 9 | `summarizeByDisposition` | function | 297 |
| 10 | `dispositionRows` | function | 312 |
| 11 | `isNestedTarget` | function | 324 |
| 12 | `collectTargetOverlaps` | function | 330 |
| 13 | `manifestHasInstallDeps` | function | 346 |
| 14 | `recordExists` | function | 355 |
| 15 | `buildDependencyTopology` | function | 359 |
| 16 | `buildSummary` | function | 393 |
| 17 | `renderReport` | function | 453 |
| 18 | `main` | function | 534 |

### 3.583 `ops/scripts/architecture/language-runtime-audit.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `walkFiles` | function | 42 |
| 2 | `countBy` | function | 66 |
| 3 | `hasReactOrDomBoundary` | function | 75 |
| 4 | `hasWorkerCandidateWork` | function | 79 |
| 5 | `hasSqlOrAnalyticsWork` | function | 83 |
| 6 | `scoreTypeScriptCandidate` | function | 87 |
| 7 | `scoreWorkerCandidate` | function | 102 |
| 8 | `scoreSqlCandidate` | function | 112 |
| 9 | `compactCandidates` | function | 121 |
| 10 | `verificationMatrix` | function | 129 |
| 11 | `buildFirstExecutableSlices` | function | 167 |
| 12 | `collectFocusedTestCoverage` | function | 1195 |
| 13 | `collectConvertedTypeScriptSlices` | function | 1210 |
| 14 | `collectCompletedWebWorkerSlices` | function | 1232 |
| 15 | `collectCompletedDataPathSlices` | function | 1256 |
| 16 | `collectProofCommandCoverage` | function | 1272 |
| 17 | `collectRecords` | function | 1326 |
| 18 | `renderReport` | function | 1343 |
| 19 | `buildSummary` | function | 1502 |
| 20 | `main` | function | 1581 |

### 3.584 `ops/scripts/architecture/organization-audit.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `walkFiles` | function | 81 |
| 2 | `getArea` | function | 103 |
| 3 | `extractRelativeImports` | function | 143 |
| 4 | `collectFileRecords` | function | 158 |
| 5 | `nonEmptyLines` | function | 192 |
| 6 | `extractWrapperTarget` | function | 196 |
| 7 | `collectCompatibilityWrappers` | function | 209 |
| 8 | `countOccurrences` | function | 232 |
| 9 | `wrapperReferenceCandidates` | function | 243 |
| 10 | `collectWrapperReferenceDetails` | function | 263 |
| 11 | `renderReferenceFiles` | function | 290 |
| 12 | `renderReport` | function | 298 |
| 13 | `buildSummary` | function | 387 |
| 14 | `main` | function | 421 |

### 3.585 `ops/scripts/architecture/phase29-audit.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseArgs` | function | 171 |
| 2 | `isParsedObject` | function | 188 |
| 3 | `parseLastJsonObject` | function | 192 |
| 4 | `runChildProcess` | function | 205 |
| 5 | `runCheck` | function | 233 |
| 6 | `runCheckGroup` | function | 258 |
| 7 | `flattenCycles` | function | 268 |
| 8 | `buildDurationSummary` | function | 272 |
| 9 | `renderReport` | function | 307 |
| 10 | `comparableValue` | function | 398 |
| 11 | `collectParsedByCycle` | function | 410 |
| 12 | `buildRepeatConsistency` | function | 416 |
| 13 | `buildSummary` | function | 608 |
| 14 | `main` | function | 646 |

### 3.586 `ops/scripts/architecture/runtime-js-inventory.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `shouldSkipDirectory` | function | 80 |
| 2 | `collectRuntimeJsFiles` | function | 87 |
| 3 | `classifyRuntimeJs` | function | 107 |
| 4 | `verifyRuntimeSources` | function | 127 |
| 5 | `renderReport` | function | 142 |
| 6 | `main` | function | 183 |

### 3.587 `ops/scripts/backend/build-package-stage.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toPosix` | function | 16 |
| 2 | `removeDir` | function | 20 |
| 3 | `ensureDir` | function | 29 |
| 4 | `copyEntry` | function | 33 |
| 5 | `walkFiles` | function | 47 |
| 6 | `rewriteRuntimeRequires` | function | 59 |
| 7 | `rewriteStageSourceFiles` | function | 65 |
| 8 | `buildStagePackageJson` | function | 82 |
| 9 | `assertStage` | function | 109 |
| 10 | `main` | function | 131 |

### 3.588 `ops/scripts/backend/build-server-entry.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toProjectPath` | function | 26 |
| 2 | `formatDiagnostic` | function | 30 |
| 3 | `transpileServerEntry` | function | 37 |
| 4 | `writeIfChanged` | function | 59 |
| 5 | `main` | function | 66 |

### 3.589 `ops/scripts/backend/schema-audit.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `read` | function | 33 |
| 2 | `uniqueSorted` | function | 37 |
| 3 | `getLineNumber` | function | 41 |
| 4 | `matchAllWithLine` | function | 45 |
| 5 | `parseSqlTables` | function | 54 |
| 6 | `parseAlteredPrimaryKeys` | function | 77 |
| 7 | `parseColumns` | function | 87 |
| 8 | `parsePrimaryKey` | function | 104 |
| 9 | `cleanColumnList` | function | 121 |
| 10 | `parseIndexes` | function | 128 |
| 11 | `parseRuntimeStatements` | function | 145 |
| 12 | `uniqueRuntimeRows` | function | 187 |
| 13 | `parseDexieStores` | function | 199 |
| 14 | `loadBackupSchema` | function | 220 |
| 15 | `countForeignKeyDeclarations` | function | 226 |
| 16 | `buildCoverage` | function | 233 |
| 17 | `buildBackupCoverage` | function | 242 |
| 18 | `renderList` | function | 264 |
| 19 | `renderRuntimeRows` | function | 269 |
| 20 | `renderTableCatalog` | function | 274 |
| 21 | `primaryKeyGapRows` | function | 280 |
| 22 | `renderPrimaryKeyGaps` | function | 293 |
| 23 | `renderReport` | function | 308 |
| 24 | `buildSummary` | function | 398 |
| 25 | `main` | function | 430 |

### 3.590 `ops/scripts/backend/schema-primary-key-preflight.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseArgs` | function | 30 |
| 2 | `assertInsideWorkspace` | function | 53 |
| 3 | `runPsql` | function | 59 |
| 4 | `buildPreflightSql` | function | 70 |
| 5 | `summarize` | function | 178 |

### 3.591 `ops/scripts/backend/verify-data-integrity.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseEnvFile` | function | 27 |
| 2 | `fail` | function | 59 |
| 3 | `pass` | function | 66 |
| 4 | `approxEqual` | function | 71 |
| 5 | `stripTrailingSemicolon` | function | 75 |
| 6 | `runPsql` | function | 79 |
| 7 | `queryRows` | function | 101 |
| 8 | `queryOne` | function | 110 |
| 9 | `queryScalarList` | function | 114 |
| 10 | `execSql` | function | 118 |
| 11 | `sqlString` | function | 122 |
| 12 | `sqlIdentifier` | function | 126 |
| 13 | `generatedTextMatch` | function | 130 |
| 14 | `checkNoNegativeStock` | function | 137 |
| 15 | `checkProductStockMatchesBranches` | function | 146 |
| 16 | `checkSaleItemTotals` | function | 191 |
| 17 | `checkReturnDoesNotExceedSold` | function | 201 |
| 18 | `addCleanupClassification` | function | 231 |
| 19 | `addCleanupCandidateIds` | function | 243 |
| 20 | `classifyIntegrityBacklog` | function | 253 |
| 21 | `checkProfitFormulaConsistency` | function | 405 |
| 22 | `checkCogsSnapshotVsCurrentProductCost` | function | 441 |
| 23 | `checkPostgresRuntimeTables` | function | 462 |
| 24 | `checkDatasetReadiness` | function | 491 |
| 25 | `checkRelationshipOrphans` | function | 529 |
| 26 | `writeReport` | function | 646 |
| 27 | `run` | function | 656 |

### 3.592 `ops/scripts/frontend/build-public-runtime-scripts.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toProjectPath` | function | 36 |
| 2 | `formatDiagnostic` | function | 40 |
| 3 | `transpileRuntimeScript` | function | 47 |
| 4 | `writeIfChanged` | function | 67 |
| 5 | `main` | function | 74 |

### 3.593 `ops/scripts/frontend/verify-i18n.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `collectUsedKeys` | function | 29 |
| 2 | `flattenTranslationTree` | function | 69 |
| 3 | `listMissing` | function | 83 |
| 4 | `listEmptyValues` | function | 88 |
| 5 | `printList` | function | 95 |
| 6 | `main` | function | 102 |

### 3.594 `ops/scripts/frontend/verify-performance.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `read` | function | 15 |
| 2 | `walk` | function | 19 |
| 3 | `trackedFiles` | function | 37 |
| 4 | `assert` | function | 47 |

### 3.595 `ops/scripts/frontend/verify-ui.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `flatten` | function | 62 |
| 2 | `walkFiles` | function | 75 |
| 3 | `isIntentionalLatin` | function | 87 |
| 4 | `report` | function | 95 |
| 5 | `checkKhmerQuality` | function | 101 |
| 6 | `checkPortalDarkModeContracts` | function | 125 |
| 7 | `checkPortalVisibleStrings` | function | 147 |
| 8 | `checkFormControlLabels` | function | 169 |
| 9 | `checkVerificationWiring` | function | 189 |
| 10 | `printAuditSummary` | function | 202 |
| 11 | `main` | function | 220 |

### 3.596 `ops/scripts/lib/fs-utils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toPosix` | function | 45 |
| 2 | `resolveProjectRoot` | function | 49 |
| 3 | `relFrom` | function | 64 |
| 4 | `readUtf8` | function | 68 |
| 5 | `readUtf8Async` | function | 84 |
| 6 | `lineCount` | function | 100 |
| 7 | `pathExists` | function | 105 |
| 8 | `worker` | function | 119 |
| 9 | `shouldSkipDirectory` | function | 131 |
| 10 | `walkFilesRecursive` | function | 135 |
| 11 | `collectFilesAndFolders` | function | 163 |
| 12 | `collectRootFiles` | function | 193 |
| 13 | `isProbablyText` | function | 212 |

### 3.597 `ops/scripts/lib/report-utils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `markdownTable` | function | 18 |
| 2 | `stableDigest` | function | 26 |
| 3 | `summarizeReportValue` | function | 30 |
| 4 | `outputTail` | function | 44 |
| 5 | `formatBytes` | function | 51 |

### 3.598 `ops/scripts/runtime/audits/action-history-undo-redo-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 65 |
| 2 | `request` | function | 69 |
| 3 | `runCleanupCommand` | function | 94 |
| 4 | `cleanupActionHistoryData` | function | 111 |
| 5 | `main` | function | 144 |

### 3.599 `ops/scripts/runtime/audits/audit-auth.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getSetCookieHeaders` | function | 63 |
| 2 | `extractSessionCookie` | function | 72 |
| 3 | `buildBrowserStorageState` | export function | 82 |
| 4 | `loginWithFetch` | export function | 90 |
| 5 | `applySessionToPlaywrightContext` | export function | 155 |
| 6 | `hydratePlaywrightPage` | export function | 181 |

### 3.600 `ops/scripts/runtime/audits/audit-manifest.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `getRouteManifest` | export function | 249 |
| 2 | `resolveAuditRoutes` | export function | 256 |
| 3 | `getAuditProfiles` | export function | 297 |

### 3.601 `ops/scripts/runtime/audits/audit-report-html.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `escapeHtml` | function | 98 |
| 2 | `formatMs` | function | 107 |
| 3 | `formatCls` | function | 113 |
| 4 | `formatCount` | function | 119 |
| 5 | `toRelativeLink` | function | 124 |
| 6 | `inferHotPath` | function | 130 |
| 7 | `renderFindings` | function | 150 |
| 8 | `renderSummaryCards` | function | 174 |
| 9 | `writeDeepAuditHtmlReport` | export function | 189 |
| 10 | `writeFullAuditHtmlReport` | export function | 307 |
| 11 | `writeBrowserActionHtmlReport` | export function | 368 |

### 3.602 `ops/scripts/runtime/audits/deep-live-audit.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readArg` | function | 88 |
| 2 | `readArgs` | function | 95 |
| 3 | `safeName` | function | 111 |
| 4 | `escapeRegExp` | function | 115 |
| 5 | `addFinding` | function | 119 |
| 6 | `assetFileName` | function | 128 |
| 7 | `getScriptBudgetBytes` | function | 136 |
| 8 | `isFailingFinding` | function | 157 |
| 9 | `appOwnedUrl` | function | 161 |
| 10 | `externalNoise` | function | 171 |
| 11 | `isAppConsoleIssue` | function | 175 |
| 12 | `isNavigationAbort` | function | 182 |
| 13 | `writeJson` | function | 189 |
| 14 | `requestJson` | function | 193 |
| 15 | `runCommand` | function | 214 |
| 16 | `captureHealth` | function | 251 |
| 17 | `runFullApiAudit` | function | 267 |
| 18 | `primeDirectRouteProbeMap` | function | 337 |
| 19 | `loginForAudit` | function | 376 |
| 20 | `isLoginScreen` | function | 390 |
| 21 | `ensureAuditLogin` | function | 396 |
| 22 | `installPerfObservers` | function | 430 |
| 23 | `bosSelectorFor` | const arrow | 432 |
| 24 | `createBrowserHarness` | function | 534 |
| 25 | `createContext` | const arrow | 538 |
| 26 | `attachCollectors` | function | 549 |
| 27 | `resetBrowserState` | function | 637 |
| 28 | `waitForRouteReady` | function | 653 |
| 29 | `collectPerfSnapshot` | function | 680 |
| 30 | `saveScreenshot` | function | 740 |
| 31 | `performSearchInteraction` | function | 747 |
| 32 | `dismissTransientUi` | function | 782 |
| 33 | `clickNamedButton` | function | 800 |
| 34 | `clickTestIdButton` | function | 835 |
| 35 | `runRouteInteractions` | function | 880 |
| 36 | `analyzeRoute` | function | 896 |
| 37 | `auditRoute` | function | 1004 |
| 38 | `auditBrowserProfile` | function | 1207 |
| 39 | `auditRemoteReadOnly` | function | 1271 |
| 40 | `captureDockerStateAndLogs` | function | 1309 |
| 41 | `compareWithPreviousBaseline` | function | 1357 |
| 42 | `main` | function | 1405 |

### 3.603 `ops/scripts/runtime/audits/full-app-audit.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `wait` | function | 61 |
| 2 | `pushFinding` | function | 65 |
| 3 | `assert` | function | 74 |
| 4 | `isJsonResponse` | function | 78 |
| 5 | `fetchWithTimeout` | function | 82 |
| 6 | `request` | function | 92 |
| 7 | `recordApi` | function | 138 |
| 8 | `login` | function | 156 |
| 9 | `captureHealth` | function | 169 |
| 10 | `auditHtmlRoutes` | function | 183 |
| 11 | `auditReadEndpoints` | function | 210 |
| 12 | `getActiveBranches` | function | 244 |
| 13 | `runFefoWriteFlow` | function | 253 |
| 14 | `runImportFlow` | function | 408 |
| 15 | `tinyPngBytes` | function | 458 |
| 16 | `runFilesFlow` | function | 465 |
| 17 | `runBackupFlow` | function | 480 |
| 18 | `pollSystemJob` | function | 517 |
| 19 | `cleanupAuditData` | function | 535 |
| 20 | `auditRemotePublic` | function | 566 |
| 21 | `writeSummary` | function | 601 |
| 22 | `main` | function | 612 |

### 3.604 `ops/scripts/runtime/browser-action-smoke.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readArg` | function | 131 |
| 2 | `readArgs` | function | 138 |
| 3 | `safeName` | function | 154 |
| 4 | `escapeRegExp` | function | 158 |
| 5 | `addFinding` | function | 162 |
| 6 | `isExternalConsoleNoise` | function | 171 |
| 7 | `isAppConsoleIssue` | function | 175 |
| 8 | `requestJson` | function | 181 |
| 9 | `captureHealth` | function | 193 |
| 10 | `buildContextOptions` | function | 206 |
| 11 | `attachConsoleCapture` | function | 215 |
| 12 | `saveScreenshot` | function | 236 |
| 13 | `waitForRouteReady` | function | 243 |
| 14 | `getActiveRouteRoot` | function | 264 |
| 15 | `dismissTransientUi` | function | 268 |
| 16 | `clickWithFallback` | function | 286 |
| 17 | `countVisibleDialogs` | function | 296 |
| 18 | `countVisibleNamedButtons` | function | 312 |
| 19 | `countVisiblePortalLayers` | function | 324 |
| 20 | `clickVisibleButton` | function | 337 |
| 21 | `findButtonInLocator` | function | 356 |
| 22 | `openMobileMoreDrawer` | function | 377 |
| 23 | `navigateViaUi` | function | 386 |
| 24 | `verifyExpectation` | function | 501 |
| 25 | `clickNamedButton` | function | 568 |
| 26 | `clickTestIdButton` | function | 620 |
| 27 | `performSearchInteraction` | function | 670 |
| 28 | `findSearchInput` | function | 673 |
| 29 | `runRouteInteractions` | function | 741 |
| 30 | `bootstrapProfile` | function | 755 |
| 31 | `runProfile` | function | 772 |
| 32 | `main` | function | 840 |

### 3.605 `ops/scripts/runtime/build-ecosystem-config.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `toProjectPath` | function | 23 |
| 2 | `formatDiagnostic` | function | 27 |
| 3 | `transpileEcosystemConfig` | function | 34 |
| 4 | `writeIfChanged` | function | 56 |
| 5 | `main` | function | 63 |

### 3.606 `ops/scripts/runtime/cloudflare/cloudflare-tunnel-watchdog.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeBaseUrl` | function | 57 |
| 2 | `parsePositiveInt` | function | 62 |
| 3 | `assertInsideWorkspace` | function | 67 |
| 4 | `parseArgs` | function | 76 |
| 5 | `sleep` | function | 108 |
| 6 | `probe` | function | 112 |
| 7 | `probeAll` | function | 145 |
| 8 | `needsTunnelRestart` | function | 155 |
| 9 | `restartContainer` | function | 160 |
| 10 | `runStartupWarmup` | function | 174 |
| 11 | `writeReport` | function | 188 |
| 12 | `main` | function | 194 |

### 3.607 `ops/scripts/runtime/cloudflare/rotate-cloudflare-tunnel-token.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readEnvFile` | function | 15 |
| 2 | `readEnv` | function | 30 |
| 3 | `parseArgs` | function | 34 |
| 4 | `readSecret` | function | 54 |
| 5 | `writeSecret` | function | 58 |
| 6 | `ensureIngress` | function | 63 |
| 7 | `extractTunnelToken` | function | 73 |
| 8 | `getCloudflareError` | function | 81 |
| 9 | `readCurrentTunnel` | function | 87 |
| 10 | `readTunnelConfig` | function | 95 |
| 11 | `rotateTunnelSecret` | function | 103 |
| 12 | `fetchTunnelToken` | function | 114 |
| 13 | `updateTunnelIngress` | function | 124 |
| 14 | `disconnectTunnelConnections` | function | 142 |
| 15 | `main` | function | 150 |
| 16 | `requestJson` | function | 205 |

### 3.608 `ops/scripts/runtime/cloudflare/update-cloudflare-tunnel-origin.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readEnvFile` | function | 10 |
| 2 | `parseArgs` | function | 25 |
| 3 | `readToken` | function | 36 |
| 4 | `ensureIngress` | function | 42 |
| 5 | `main` | function | 58 |
| 6 | `requestJson` | function | 103 |

### 3.609 `ops/scripts/runtime/cloudflare/verify-cloudflare-automation.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseArgs` | function | 11 |
| 2 | `readToken` | function | 23 |
| 3 | `cleanToken` | const arrow | 24 |
| 4 | `readAllowedEmails` | function | 30 |
| 5 | `normalizeAdminAccessMode` | function | 38 |
| 6 | `requestJson` | function | 44 |
| 7 | `summarizeFailure` | function | 79 |
| 8 | `cloudflareErrors` | function | 86 |
| 9 | `assertSuccess` | function | 92 |
| 10 | `buildAccessPolicies` | function | 99 |
| 11 | `upsertAccessApp` | function | 120 |
| 12 | `getEntrypointRuleset` | function | 145 |
| 13 | `upsertEntrypointRuleset` | function | 151 |
| 14 | `tryApplyRuleset` | function | 170 |
| 15 | `applyCloudflareAutomation` | function | 181 |
| 16 | `main` | function | 249 |

### 3.610 `ops/scripts/runtime/cloudflare/verify-r2-object-store.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `loadEnvFile` | function | 18 |
| 2 | `readConfig` | function | 36 |
| 3 | `bodyToString` | function | 59 |
| 4 | `isMissingObjectError` | function | 67 |
| 5 | `isAuthLikeError` | function | 73 |
| 6 | `canUseApiFallback` | function | 82 |
| 7 | `verifyRuntimeObjectStoreFallback` | function | 86 |
| 8 | `main` | function | 94 |

### 3.611 `ops/scripts/runtime/cloudflare/warm-cloudflare-startup-assets.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assertInsideWorkspace` | function | 22 |
| 2 | `normalizeBaseUrl` | function | 28 |
| 3 | `parsePositiveInt` | function | 34 |
| 4 | `normalizeRoutePath` | function | 39 |
| 5 | `parseRouteList` | function | 52 |
| 6 | `sleep` | function | 60 |
| 7 | `shouldRetryDocumentFetch` | function | 64 |
| 8 | `shouldRetryAssetFetch` | function | 68 |
| 9 | `parseArgs` | function | 72 |
| 10 | `asAbsoluteUrl` | function | 111 |
| 11 | `isWarmableAsset` | function | 119 |
| 12 | `extractStartupAssets` | function | 131 |
| 13 | `extractLinkHeaderAssets` | function | 151 |
| 14 | `routePreloadKey` | function | 164 |
| 15 | `parseInlineRoutePreloadMap` | function | 173 |
| 16 | `extractInlineRoutePreloadAssets` | function | 186 |
| 17 | `extractFetchedChunkDependencies` | function | 201 |
| 18 | `warmAssetsWithGraph` | function | 215 |
| 19 | `fetchWithTimeout` | function | 245 |
| 20 | `runLimited` | function | 290 |
| 21 | `fetchDocumentWithRetry` | function | 304 |
| 22 | `fetchAssetWithRetry` | function | 334 |
| 23 | `warmSurface` | function | 364 |
| 24 | `summarizeCache` | function | 397 |
| 25 | `main` | function | 406 |

### 3.612 `ops/scripts/runtime/live-checks/all-pages-control-audit.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readArg` | function | 207 |
| 2 | `readArgs` | function | 214 |
| 3 | `safeName` | function | 230 |
| 4 | `addFinding` | function | 237 |
| 5 | `isExternalNoise` | function | 241 |
| 6 | `isAppConsoleIssue` | function | 245 |
| 7 | `isAppNetworkIssue` | function | 252 |
| 8 | `routeRoot` | function | 258 |
| 9 | `textForLabel` | function | 263 |
| 10 | `buttonSkipReason` | function | 267 |
| 11 | `expectedButtonNavigation` | function | 277 |
| 12 | `buttonMayOpenFileChooser` | function | 282 |
| 13 | `buttonInteractionPriority` | function | 286 |
| 14 | `timeBudgetExceeded` | function | 293 |
| 15 | `escapeRegExp` | function | 297 |
| 16 | `attachCollectors` | function | 301 |
| 17 | `writeJson` | function | 336 |
| 18 | `writeText` | function | 341 |
| 19 | `incrementCount` | function | 346 |
| 20 | `markdownCell` | function | 350 |
| 21 | `markdownTable` | function | 356 |
| 22 | `percentage` | function | 363 |
| 23 | `computeControlCoverage` | function | 368 |
| 24 | `routeCoverageRows` | function | 410 |
| 25 | `seededRollbackCategory` | function | 422 |
| 26 | `seededRollbackHarness` | function | 436 |
| 27 | `seededRollbackCandidates` | function | 445 |
| 28 | `seededRollbackSummaryRows` | function | 478 |
| 29 | `renderSeededRollbackMarkdown` | function | 488 |
| 30 | `renderCoverageMarkdown` | function | 521 |
| 31 | `addCoverageGateFindings` | function | 581 |
| 32 | `persistSummary` | function | 641 |
| 33 | `saveScreenshot` | function | 672 |
| 34 | `dismissTransientUi` | function | 679 |
| 35 | `waitForRouteReady` | function | 697 |
| 36 | `navigateRoute` | function | 713 |
| 37 | `countVisible` | function | 730 |
| 38 | `activeButtonCandidates` | function | 739 |
| 39 | `clickButtonCandidate` | function | 775 |
| 40 | `exerciseSearchInputs` | function | 865 |
| 41 | `exerciseSelects` | function | 909 |
| 42 | `collectLayoutIssues` | function | 966 |
| 43 | `hasScrollableAncestor` | const arrow | 1002 |
| 44 | `runRoute` | function | 1041 |
| 45 | `createAuthedPage` | function | 1111 |
| 46 | `runProfile` | function | 1130 |
| 47 | `main` | function | 1175 |

### 3.613 `ops/scripts/runtime/live-checks/filter-burst-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `waitForPage` | function | 25 |
| 2 | `clickIfPresent` | function | 33 |
| 3 | `runBurst` | function | 40 |
| 4 | `onResponse` | const arrow | 43 |
| 5 | `main` | function | 75 |

### 3.614 `ops/scripts/runtime/live-checks/lcp-route-trace.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readArgs` | function | 71 |
| 2 | `normalizeRouteNames` | function | 87 |
| 3 | `absoluteUrl` | function | 95 |
| 4 | `isExternalNoise` | function | 99 |
| 5 | `recordResponse` | function | 103 |
| 6 | `waitForRouteReady` | function | 118 |
| 7 | `installPerfObservers` | function | 134 |
| 8 | `readPerfMetrics` | function | 178 |
| 9 | `traceRoute` | function | 207 |
| 10 | `maybeLogin` | function | 277 |
| 11 | `main` | function | 283 |

### 3.615 `ops/scripts/runtime/live-checks/live-check-utils.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fetchJsonResponse` | function | 48 |
| 2 | `readJson` | export function | 64 |
| 3 | `readJsonStatus` | export function | 69 |
| 4 | `isIgnoredConsole` | export function | 75 |
| 5 | `attachConsoleCollector` | export function | 79 |
| 6 | `latestObservedStatus` | export function | 96 |
| 7 | `waitForRead` | export function | 101 |
| 8 | `closeTopModal` | export function | 118 |

### 3.616 `ops/scripts/runtime/live-checks/move766-product-write-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 24 |
| 2 | `assetName` | function | 28 |
| 3 | `observeResponse` | function | 36 |
| 4 | `openAddProductModal` | function | 51 |
| 5 | `saveNewProduct` | function | 58 |
| 6 | `searchProduct` | function | 72 |
| 7 | `deleteVisibleProduct` | function | 82 |
| 8 | `main` | function | 97 |

### 3.617 `ops/scripts/runtime/live-checks/phase84-account-loyalty-select-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 34 |
| 2 | `openSharedSelect` | function | 38 |
| 3 | `main` | function | 54 |

### 3.618 `ops/scripts/runtime/live-checks/phase84-branches-actions-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 33 |
| 2 | `readFirstActiveBranch` | function | 37 |
| 3 | `api` | const arrow | 39 |
| 4 | `main` | function | 48 |

### 3.619 `ops/scripts/runtime/live-checks/phase84-catalog-editor-select-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 35 |
| 2 | `openSharedSelect` | function | 39 |
| 3 | `showEditorSection` | function | 55 |
| 4 | `main` | function | 62 |

### 3.620 `ops/scripts/runtime/live-checks/phase84-contacts-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 28 |
| 2 | `main` | function | 36 |

### 3.621 `ops/scripts/runtime/live-checks/phase84-files-providers-actions-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 35 |
| 2 | `openAppSelect` | function | 39 |
| 3 | `main` | function | 53 |

### 3.622 `ops/scripts/runtime/live-checks/phase84-filter-menu-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 58 |
| 2 | `openFilters` | function | 62 |
| 3 | `readFilterMenu` | function | 71 |
| 4 | `openSharedSelect` | function | 95 |
| 5 | `openDashboardCustomRange` | function | 116 |
| 6 | `readPosFilterPanel` | function | 148 |
| 7 | `main` | function | 170 |

### 3.623 `ops/scripts/runtime/live-checks/phase84-inventory-actions-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 29 |
| 2 | `openFirstProductDetail` | function | 37 |
| 3 | `main` | function | 46 |

### 3.624 `ops/scripts/runtime/live-checks/phase84-inventory-section-restore-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 28 |
| 2 | `matchingRequests` | function | 32 |
| 3 | `main` | function | 36 |

### 3.625 `ops/scripts/runtime/live-checks/phase84-live-suite.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseArgs` | function | 97 |
| 2 | `assertInsideWorkspace` | function | 122 |
| 3 | `tail` | function | 128 |
| 4 | `readJsonIfExists` | function | 132 |
| 5 | `latestReportPathForPrefix` | function | 137 |
| 6 | `relativePath` | function | 155 |
| 7 | `summarizeReport` | function | 160 |
| 8 | `readStepReport` | function | 203 |
| 9 | `runNodeStep` | function | 213 |
| 10 | `skippedStep` | function | 233 |
| 11 | `runSuite` | function | 243 |

### 3.626 `ops/scripts/runtime/live-checks/phase84-loyalty-points-rollback-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 48 |
| 2 | `headers` | function | 52 |
| 3 | `getSettings` | function | 74 |
| 4 | `saveSettings` | function | 80 |
| 5 | `loyaltySnapshot` | function | 86 |
| 6 | `waitForSettingsPost` | function | 90 |
| 7 | `chooseBasis` | function | 97 |
| 8 | `clickSave` | function | 104 |
| 9 | `main` | function | 112 |

### 3.627 `ops/scripts/runtime/live-checks/phase84-product-brands-actions-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 41 |
| 2 | `verifiedContextGet` | function | 47 |
| 3 | `main` | function | 60 |

### 3.628 `ops/scripts/runtime/live-checks/phase84-product-categories-actions-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 28 |
| 2 | `main` | function | 35 |

### 3.629 `ops/scripts/runtime/live-checks/phase84-product-form-dropdown-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 36 |
| 2 | `getProductForm` | function | 40 |
| 3 | `openDropdown` | function | 48 |
| 4 | `main` | function | 62 |

### 3.630 `ops/scripts/runtime/live-checks/phase84-product-page-actions-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 30 |
| 2 | `openFirstActionMenu` | function | 37 |
| 3 | `main` | function | 46 |

### 3.631 `ops/scripts/runtime/live-checks/phase84-product-scanning-actions-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 29 |
| 2 | `main` | function | 36 |

### 3.632 `ops/scripts/runtime/live-checks/phase84-product-stock-actions-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 28 |
| 2 | `main` | function | 36 |

### 3.633 `ops/scripts/runtime/live-checks/phase84-product-units-actions-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 28 |
| 2 | `main` | function | 35 |

### 3.634 `ops/scripts/runtime/live-checks/phase84-product-variant-actions-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 29 |
| 2 | `openFirstVariantModal` | function | 36 |
| 3 | `main` | function | 56 |

### 3.635 `ops/scripts/runtime/live-checks/phase84-public-assistant-select-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 33 |
| 2 | `openSharedSelect` | function | 37 |
| 3 | `main` | function | 53 |

### 3.636 `ops/scripts/runtime/live-checks/phase84-public-portal-cloudflare-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 60 |
| 2 | `isRelevantConsole` | function | 64 |
| 3 | `isCloudflareScriptMonitorReportOnlyCsp` | function | 68 |
| 4 | `endpointStatus` | function | 73 |
| 5 | `main` | function | 77 |

### 3.637 `ops/scripts/runtime/live-checks/phase84-receipt-export-layout-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 35 |
| 2 | `waitForAppSettled` | function | 39 |
| 3 | `getReceiptOverflow` | function | 45 |
| 4 | `assertReceiptNotOverflowing` | function | 84 |
| 5 | `assertReceiptContentPolicy` | function | 92 |
| 6 | `screenshot` | function | 99 |
| 7 | `openReceiptPrintPreview` | function | 106 |
| 8 | `downloadReceiptImage` | function | 118 |
| 9 | `main` | function | 139 |

### 3.638 `ops/scripts/runtime/live-checks/phase84-receipt-settings-rollback-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 44 |
| 2 | `headers` | function | 48 |
| 3 | `getSettings` | function | 70 |
| 4 | `saveSettings` | function | 76 |
| 5 | `waitForSettingsPost` | function | 88 |
| 6 | `waitForReceiptLanguage` | function | 95 |
| 7 | `dismissRuntimeVersionMismatchToast` | function | 106 |
| 8 | `clickLanguage` | function | 115 |
| 9 | `main` | function | 125 |

### 3.639 `ops/scripts/runtime/live-checks/phase84-sales-actions-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 33 |
| 2 | `main` | function | 40 |

### 3.640 `ops/scripts/runtime/live-checks/phase84-settings-save-rollback-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 36 |
| 2 | `headers` | function | 40 |
| 3 | `getSettings` | function | 62 |
| 4 | `saveSettings` | function | 68 |
| 5 | `waitForSettingsPost` | function | 74 |
| 6 | `clickSave` | function | 81 |
| 7 | `main` | function | 89 |

### 3.641 `ops/scripts/runtime/live-checks/phase84-settings-select-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 35 |
| 2 | `getSessionUserId` | function | 39 |
| 3 | `openSectionForControl` | function | 45 |
| 4 | `openSharedSelect` | function | 55 |
| 5 | `main` | function | 70 |

### 3.642 `ops/scripts/runtime/live-checks/phase84-shared-select-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 36 |
| 2 | `openAppSelect` | function | 40 |
| 3 | `openNotificationPageSizeSelect` | function | 54 |
| 4 | `main` | function | 71 |

### 3.643 `ops/scripts/runtime/live-checks/phase84-ui-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 34 |
| 2 | `readFirstActiveBranch` | function | 38 |
| 3 | `api` | const arrow | 40 |
| 4 | `main` | function | 49 |

### 3.644 `ops/scripts/runtime/live-checks/phase84-users-actions-live-check.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 32 |
| 2 | `main` | function | 40 |

### 3.645 `ops/scripts/runtime/live-checks/route-load-trace.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readArgs` | function | 53 |
| 2 | `normalizeRouteNames` | function | 69 |
| 3 | `absoluteUrl` | function | 77 |
| 4 | `isExternalNoise` | function | 81 |
| 5 | `waitForRouteReady` | function | 85 |
| 6 | `recordResponse` | function | 101 |
| 7 | `traceRoute` | function | 114 |
| 8 | `main` | function | 175 |

### 3.646 `ops/scripts/runtime/smoke/check-public-url.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeBaseUrl` | function | 8 |
| 2 | `normalizePath` | function | 14 |
| 3 | `fetchWithTimeout` | function | 21 |
| 4 | `isPrivateIpv4` | function | 38 |
| 5 | `isPrivateIpv6` | function | 50 |
| 6 | `shouldCheckPublicIngress` | function | 59 |
| 7 | `shouldRequirePublicIngress` | function | 71 |
| 8 | `fetchJsonWithTimeout` | function | 83 |
| 9 | `resolvePublicIngress` | function | 98 |
| 10 | `checkHttpsViaIp` | function | 123 |
| 11 | `main` | function | 160 |

### 3.647 `ops/scripts/runtime/smoke/check-route-contract.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `fail` | function | 35 |
| 2 | `checkRoute` | function | 40 |
| 3 | `main` | function | 67 |

### 3.648 `ops/scripts/runtime/smoke/live-smoke.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `assert` | function | 15 |
| 2 | `request` | function | 19 |
| 3 | `login` | function | 48 |
| 4 | `cleanupLiveSmokeData` | function | 61 |
| 5 | `main` | function | 86 |
| 6 | `record` | const arrow | 91 |

### 3.649 `ops/scripts/runtime/smoke/post-start-diagnostics.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseArgs` | function | 38 |
| 2 | `readResponse` | function | 64 |
| 3 | `hasBuildInfo` | function | 97 |
| 4 | `asRecord` | function | 106 |
| 5 | `mkdirForFile` | function | 110 |
| 6 | `writeReport` | function | 115 |
| 7 | `main` | function | 121 |

### 3.650 `ops/scripts/runtime/storage/cleanup-integrity-backlog.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseArgs` | function | 8 |
| 2 | `assertInsideWorkspace` | function | 30 |
| 3 | `generatedTextMatch` | function | 36 |
| 4 | `buildTempTablesSql` | function | 43 |
| 5 | `buildCountsSql` | function | 144 |
| 6 | `buildDeleteSql` | function | 162 |
| 7 | `buildSql` | function | 191 |
| 8 | `runPsql` | function | 200 |

### 3.651 `ops/scripts/runtime/storage/cleanup-test-data.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseArgs` | function | 8 |
| 2 | `assertInsideWorkspace` | function | 38 |
| 3 | `sqlString` | function | 44 |
| 4 | `likeEscape` | function | 48 |
| 5 | `productSeedWhere` | function | 52 |
| 6 | `textQaWhere` | function | 72 |
| 7 | `lookupNameWhere` | function | 84 |
| 8 | `buildTempTablesSql` | function | 96 |
| 9 | `textMatch` | const arrow | 97 |
| 10 | `lookupNameMatch` | const arrow | 98 |
| 11 | `buildCountsSelectSql` | function | 218 |
| 12 | `buildDeleteSql` | function | 242 |
| 13 | `buildSql` | function | 303 |
| 14 | `runPsql` | function | 307 |
| 15 | `pathIsInside` | function | 319 |
| 16 | `measurePathBytes` | function | 324 |
| 17 | `walkFiles` | function | 335 |
| 18 | `fileMatchesGeneratedImport` | function | 344 |
| 19 | `findGeneratedImportDirectories` | function | 350 |
| 20 | `cleanupAuditImportFiles` | function | 376 |
| 21 | `countMatchedRows` | function | 399 |

### 3.652 `ops/scripts/runtime/storage/dataset-readiness.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseArgs` | function | 18 |
| 2 | `assertInsideWorkspace` | function | 39 |
| 3 | `runPsql` | function | 45 |
| 4 | `buildCountsSql` | function | 56 |
| 5 | `summarizeDataset` | function | 74 |

### 3.653 `ops/scripts/runtime/storage/post-live-hygiene.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseArgs` | function | 11 |
| 2 | `assertInsideWorkspace` | function | 26 |
| 3 | `runCheck` | function | 32 |
| 4 | `appendBounded` | const arrow | 42 |
| 5 | `readJsonReport` | function | 76 |
| 6 | `sumMatchedCounts` | function | 82 |
| 7 | `withReportCheck` | function | 87 |
| 8 | `nodeCheck` | function | 110 |
| 9 | `buildCheckPlan` | function | 114 |
| 10 | `runChecks` | function | 184 |
| 11 | `main` | function | 192 |

### 3.654 `ops/scripts/runtime/storage/prune-storage.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readJsonFile` | function | 12 |
| 2 | `numberFromPolicy` | function | 20 |
| 3 | `parseArgs` | function | 25 |
| 4 | `runDockerCommand` | function | 115 |
| 5 | `pruneDockerSafe` | function | 123 |
| 6 | `parseDockerImageRows` | function | 170 |
| 7 | `parseDockerRunningImageRefs` | function | 189 |
| 8 | `pruneDockerBusinessOsImages` | function | 193 |
| 9 | `loadEnvFile` | function | 255 |
| 10 | `loadRuntimeEnv` | function | 273 |
| 11 | `assertInsideWorkspace` | function | 282 |
| 12 | `directoryBytes` | function | 291 |
| 13 | `pathBytes` | function | 317 |
| 14 | `pruneDirectoryChildren` | function | 326 |
| 15 | `pruneDirectoryEntries` | function | 330 |
| 16 | `collectLogFiles` | function | 367 |
| 17 | `compactLogFile` | function | 395 |
| 18 | `compactRuntimeLogs` | function | 423 |
| 19 | `findBackupRoots` | function | 456 |
| 20 | `main` | function | 470 |

### 3.655 `ops/scripts/runtime/storage/restore-candidates.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseArgs` | function | 48 |
| 2 | `assertInsideWorkspace` | function | 67 |
| 3 | `readJson` | function | 73 |
| 4 | `countSqlCopyRows` | function | 85 |
| 5 | `summarizeCounts` | function | 106 |
| 6 | `inspectBackupPackage` | function | 116 |
| 7 | `findBackupPackages` | function | 136 |
| 8 | `chooseRecommendation` | function | 150 |

### 3.656 `ops/scripts/runtime/storage/restore-rehearsal.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `parseArgs` | function | 36 |
| 2 | `assertInsideWorkspace` | function | 60 |
| 3 | `readJson` | function | 66 |
| 4 | `resolveRecommendedBackupPath` | function | 74 |
| 5 | `countSqlCopyRows` | function | 84 |
| 6 | `runDocker` | function | 104 |
| 7 | `runPsql` | function | 116 |
| 8 | `createTempDatabaseName` | function | 123 |
| 9 | `quoteIdentifier` | function | 127 |
| 10 | `createDatabase` | function | 131 |
| 11 | `dropDatabase` | function | 135 |
| 12 | `restoreSql` | function | 144 |
| 13 | `countRestoredTables` | function | 152 |
| 14 | `compareCounts` | function | 159 |

### 3.657 `ops/scripts/verification/verify-backup-reliability.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `read` | function | 29 |
| 2 | `lineFor` | function | 33 |
| 3 | `requireText` | function | 39 |
| 4 | `forbidText` | function | 43 |
| 5 | `checkNeedles` | function | 47 |
| 6 | `main` | function | 58 |

### 3.658 `ops/scripts/verification/verify-docker-release.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `read` | function | 64 |
| 2 | `rel` | function | 68 |
| 3 | `requireFile` | function | 72 |
| 4 | `requireToken` | function | 76 |
| 5 | `buildCloudflareRuntimeCoverage` | function | 80 |
| 6 | `assertCloudflareRuntimeCoverage` | function | 200 |
| 7 | `walk` | function | 202 |
| 8 | `buildTestDataCleanupCoverage` | function | 215 |
| 9 | `assertBooleanCoverage` | function | 316 |
| 10 | `walk` | function | 318 |
| 11 | `main` | function | 329 |

### 3.659 `ops/scripts/verification/verify-hardening-policy.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `normalizeRelativePath` | function | 30 |
| 2 | `readPolicy` | function | 34 |
| 3 | `readWithLocalImports` | function | 42 |
| 4 | `listTrackedOrPendingFiles` | function | 56 |
| 5 | `lineFor` | function | 63 |
| 6 | `assertContains` | function | 69 |
| 7 | `assertNotContains` | function | 75 |
| 8 | `assertNoApiCachingRegression` | function | 81 |
| 9 | `assertFullAutomationIncludesPolicy` | function | 102 |
| 10 | `main` | function | 118 |

### 3.660 `ops/scripts/verification/verify-runtime-deps.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `readPackageJson` | function | 89 |
| 2 | `readPackageLock` | function | 93 |
| 3 | `assertTrackedFile` | function | 97 |
| 4 | `rel` | function | 103 |
| 5 | `requireToken` | function | 107 |
| 6 | `hasLockDependency` | function | 113 |
| 7 | `readIncludes` | function | 119 |
| 8 | `packageLockVersion` | function | 123 |
| 9 | `buildVersionConsistency` | function | 127 |
| 10 | `assertVersionConsistency` | function | 153 |
| 11 | `assertRuntimeVersionGuardWiring` | function | 159 |
| 12 | `assertBuildManifestShapeWhenPresent` | function | 227 |
| 13 | `buildLocalVerificationCoverage` | function | 244 |
| 14 | `assertCoverageComplete` | function | 292 |
| 15 | `main` | function | 305 |

### 3.661 `ops/scripts/verification/verify-scale-services.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `ensureDir` | function | 27 |
| 2 | `run` | function | 31 |
| 3 | `firstExisting` | function | 49 |
| 4 | `whereDocker` | function | 53 |
| 5 | `resolveDocker` | function | 66 |
| 6 | `checkSecretIgnoreRules` | function | 76 |
| 7 | `trackedLicenses` | const arrow | 77 |
| 8 | `pushDockerAvailabilityMessage` | function | 103 |
| 9 | `main` | function | 108 |

### 3.662 `ops/scripts/verification/verify-secret-hygiene.ts`

| No. | Symbol | Kind | Line |
|---:|---|---|---:|
| 1 | `isUnsafeSecretAssignment` | function | 35 |

