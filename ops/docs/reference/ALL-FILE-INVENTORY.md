# All File Inventory (Project First-Party Files)

Auto-generated file-level commentary for all first-party project files (frontend, backend, scripts, and root run/config files; excluding dependencies/build artifacts).

## 1. Coverage Summary

Total files documented: **573**

## 2. File Commentary Matrix

| No. | File | Category | Lines | Size (KB) | Purpose |
|---:|---|---|---:|---:|---|
| 1 | `.npmrc` | project-root | 14 | 0.4 | Project source/support file |
| 2 | `backend/.env` | backend-root | 67 | 3.0 | Project source/support file |
| 3 | `backend/.npmrc` | backend-root | 14 | 0.4 | Project source/support file |
| 4 | `backend/package-lock.json` | backend-root | 6225 | 224.7 | Configuration/data manifest |
| 5 | `backend/package.json` | backend-root | 65 | 3.2 | Configuration/data manifest |
| 6 | `backend/README.md` | backend-root | 13 | 0.6 | Documentation |
| 7 | `backend/server.js` | backend-root | 570 | 19.8 | Backend server entrypoint |
| 8 | `backend/src/accessControl.js` | backend-core | 158 | 4.8 | Project source/support file |
| 9 | `backend/src/analytics/duckdbRuntime.js` | backend-core | 91 | 2.7 | Project source/support file |
| 10 | `backend/src/authOtpGuards.js` | backend-core | 31 | 0.9 | Project source/support file |
| 11 | `backend/src/backupSchema.js` | backend-core | 139 | 3.2 | Project source/support file |
| 12 | `backend/src/businessMetrics.js` | backend-core | 158 | 6.1 | Project source/support file |
| 13 | `backend/src/catalogTextIntegrity.js` | backend-core | 60 | 2.3 | Project source/support file |
| 14 | `backend/src/config/index.js` | backend-core | 294 | 12.1 | Project source/support file |
| 15 | `backend/src/conflictControl.js` | backend-core | 81 | 2.5 | Project source/support file |
| 16 | `backend/src/contactOptions.js` | backend-core | 118 | 4.1 | Project source/support file |
| 17 | `backend/src/database.js` | backend-core | 4 | 0.1 | Schema/migrations and DB bootstrap |
| 18 | `backend/src/dataPath/index.js` | backend-core | 200 | 5.9 | Project source/support file |
| 19 | `backend/src/db/cutoverReadiness.js` | backend-core | 142 | 4.8 | Project source/support file |
| 20 | `backend/src/db/postgresQueryCompat.js` | backend-core | 221 | 6.3 | Project source/support file |
| 21 | `backend/src/db/postgresSchema.sql` | backend-core | 2020 | 50.7 | Project source/support file |
| 22 | `backend/src/fileAssets.js` | backend-core | 1101 | 38.8 | Project source/support file |
| 23 | `backend/src/helpers.js` | backend-core | 558 | 19.6 | Project source/support file |
| 24 | `backend/src/idempotency.js` | backend-core | 13 | 0.3 | Project source/support file |
| 25 | `backend/src/importCsv.js` | backend-core | 260 | 6.8 | Project source/support file |
| 26 | `backend/src/importParsing.js` | backend-core | 89 | 3.2 | Project source/support file |
| 27 | `backend/src/initials.js` | backend-core | 89 | 2.8 | Project source/support file |
| 28 | `backend/src/maintenanceLock.js` | backend-core | 77 | 2.0 | Project source/support file |
| 29 | `backend/src/middleware.js` | backend-core | 331 | 10.2 | Project source/support file |
| 30 | `backend/src/money.js` | backend-core | 26 | 0.6 | Project source/support file |
| 31 | `backend/src/netSecurity.js` | backend-core | 115 | 3.1 | Project source/support file |
| 32 | `backend/src/objectStore.js` | backend-core | 393 | 12.6 | Project source/support file |
| 33 | `backend/src/optionalSharp.js` | backend-core | 30 | 0.7 | Project source/support file |
| 34 | `backend/src/organizationContext/index.js` | backend-core | 264 | 8.1 | Project source/support file |
| 35 | `backend/src/permissions.js` | backend-core | 187 | 6.0 | Project source/support file |
| 36 | `backend/src/portalUtils.js` | backend-core | 87 | 2.3 | Project source/support file |
| 37 | `backend/src/postgresDatabase.js` | backend-core | 525 | 22.0 | Project source/support file |
| 38 | `backend/src/productBatches.js` | backend-core | 599 | 20.2 | Project source/support file |
| 39 | `backend/src/productDiscounts.js` | backend-core | 129 | 5.1 | Project source/support file |
| 40 | `backend/src/productImportPolicies.js` | backend-core | 100 | 3.6 | Project source/support file |
| 41 | `backend/src/README.md` | backend-core | 12 | 0.7 | Documentation |
| 42 | `backend/src/requestContext.js` | backend-core | 59 | 1.2 | Project source/support file |
| 43 | `backend/src/routes/actionHistory.js` | backend-routes | 248 | 8.9 | API route handler |
| 44 | `backend/src/routes/ai.js` | backend-routes | 258 | 8.9 | API route handler |
| 45 | `backend/src/routes/auth.js` | backend-routes | 1141 | 40.4 | API route handler |
| 46 | `backend/src/routes/branches.js` | backend-routes | 425 | 19.3 | API route handler |
| 47 | `backend/src/routes/catalog.js` | backend-routes | 85 | 2.4 | API route handler |
| 48 | `backend/src/routes/categories.js` | backend-routes | 147 | 5.8 | API route handler |
| 49 | `backend/src/routes/contacts.js` | backend-routes | 982 | 40.5 | API route handler |
| 50 | `backend/src/routes/customTables.js` | backend-routes | 231 | 9.1 | API route handler |
| 51 | `backend/src/routes/files.js` | backend-routes | 133 | 5.2 | API route handler |
| 52 | `backend/src/routes/importJobs.js` | backend-routes | 465 | 16.6 | API route handler |
| 53 | `backend/src/routes/inventory.js` | backend-routes | 1780 | 81.9 | API route handler |
| 54 | `backend/src/routes/notifications.js` | backend-routes | 437 | 15.6 | API route handler |
| 55 | `backend/src/routes/organizations.js` | backend-routes | 63 | 1.8 | API route handler |
| 56 | `backend/src/routes/portal.js` | backend-routes | 1291 | 49.2 | API route handler |
| 57 | `backend/src/routes/products.js` | backend-routes | 2026 | 94.8 | API route handler |
| 58 | `backend/src/routes/README.md` | backend-routes | 37 | 1.5 | API route handler |
| 59 | `backend/src/routes/returns.js` | backend-routes | 1014 | 40.3 | API route handler |
| 60 | `backend/src/routes/runtime.js` | backend-routes | 108 | 3.7 | API route handler |
| 61 | `backend/src/routes/sales.js` | backend-routes | 1504 | 63.1 | API route handler |
| 62 | `backend/src/routes/settings.js` | backend-routes | 194 | 6.8 | API route handler |
| 63 | `backend/src/routes/sync.js` | backend-routes | 265 | 12.4 | API route handler |
| 64 | `backend/src/routes/system/index.js` | backend-routes | 1538 | 62.8 | API route handler |
| 65 | `backend/src/routes/units.js` | backend-routes | 151 | 5.9 | API route handler |
| 66 | `backend/src/routes/users.js` | backend-routes | 1064 | 44.0 | API route handler |
| 67 | `backend/src/runtimeCache.js` | backend-core | 180 | 5.0 | Project source/support file |
| 68 | `backend/src/runtimeState/index.js` | backend-core | 74 | 2.2 | Project source/support file |
| 69 | `backend/src/runtimeVersion.js` | backend-core | 123 | 3.4 | Project source/support file |
| 70 | `backend/src/security.js` | backend-core | 207 | 6.0 | Project source/support file |
| 71 | `backend/src/serverUtils.js` | backend-core | 419 | 15.2 | Project source/support file |
| 72 | `backend/src/services/aiGateway.js` | backend-services | 342 | 13.0 | Integration/service layer |
| 73 | `backend/src/services/backupPackages.js` | backend-services | 991 | 34.0 | Integration/service layer |
| 74 | `backend/src/services/firebaseAuth.js` | backend-services | 384 | 14.3 | Integration/service layer |
| 75 | `backend/src/services/googleDriveSync/index.js` | backend-services | 1490 | 56.1 | Integration/service layer |
| 76 | `backend/src/services/googleDriveSync/versioning.js` | backend-services | 91 | 2.9 | Integration/service layer |
| 77 | `backend/src/services/googleOauth.js` | backend-services | 233 | 8.3 | Integration/service layer |
| 78 | `backend/src/services/importJobs.js` | backend-services | 3505 | 148.5 | Integration/service layer |
| 79 | `backend/src/services/integrationDoctor.js` | backend-services | 337 | 11.5 | Integration/service layer |
| 80 | `backend/src/services/mediaQueue.js` | backend-services | 200 | 7.2 | Integration/service layer |
| 81 | `backend/src/services/portalAi.js` | backend-services | 511 | 18.9 | Integration/service layer |
| 82 | `backend/src/services/README.md` | backend-services | 29 | 1.0 | Integration/service layer |
| 83 | `backend/src/services/verification.js` | backend-services | 272 | 8.4 | Integration/service layer |
| 84 | `backend/src/sessionAuth.js` | backend-core | 215 | 6.8 | Project source/support file |
| 85 | `backend/src/settingsSnapshot.js` | backend-core | 81 | 2.2 | Project source/support file |
| 86 | `backend/src/storage/organizationFolders.js` | backend-core | 56 | 1.7 | Project source/support file |
| 87 | `backend/src/systemFsWorker.js` | backend-core | 95 | 3.0 | Project source/support file |
| 88 | `backend/src/systemJobs.js` | backend-core | 435 | 13.6 | Project source/support file |
| 89 | `backend/src/uploadReferenceCleanup.js` | backend-core | 128 | 4.0 | Project source/support file |
| 90 | `backend/src/uploadSecurity.js` | backend-core | 88 | 3.6 | Project source/support file |
| 91 | `backend/src/websocket.js` | backend-core | 94 | 3.6 | Project source/support file |
| 92 | `backend/src/workers/importWorker.js` | backend-core | 35 | 1.0 | Project source/support file |
| 93 | `backend/src/workers/mediaWorker.js` | backend-core | 34 | 0.9 | Project source/support file |
| 94 | `backend/test/accessControl.test.js` | backend-root | 127 | 4.0 | Project source/support file |
| 95 | `backend/test/analyticsRuntime.test.js` | backend-root | 49 | 1.2 | Project source/support file |
| 96 | `backend/test/authOtpGuards.test.js` | backend-root | 71 | 1.6 | Project source/support file |
| 97 | `backend/test/authSecurityFlow.test.js` | backend-root | 211 | 6.5 | Project source/support file |
| 98 | `backend/test/backupDefaultDestination.test.js` | backend-root | 15 | 0.6 | Project source/support file |
| 99 | `backend/test/backupPerformanceHardening.test.js` | backend-root | 171 | 9.3 | Project source/support file |
| 100 | `backend/test/backupRetention.test.js` | backend-root | 91 | 3.7 | Project source/support file |
| 101 | `backend/test/backupSchema.test.js` | backend-root | 111 | 4.3 | Project source/support file |
| 102 | `backend/test/branchStockSearch.test.js` | backend-root | 271 | 9.8 | Project source/support file |
| 103 | `backend/test/contactOptions.test.js` | backend-root | 82 | 2.3 | Project source/support file |
| 104 | `backend/test/dataPath.test.js` | backend-root | 87 | 3.1 | Project source/support file |
| 105 | `backend/test/defaultRoles.test.js` | backend-root | 145 | 4.9 | Project source/support file |
| 106 | `backend/test/fileAssetStorageReconcile.test.js` | backend-root | 57 | 1.4 | Project source/support file |
| 107 | `backend/test/fileRouteSecurityFlow.test.js` | backend-root | 217 | 7.2 | Project source/support file |
| 108 | `backend/test/fullAutomation.test.js` | backend-root | 278 | 10.4 | Project source/support file |
| 109 | `backend/test/googleDriveSyncVersioning.test.js` | backend-root | 121 | 5.1 | Project source/support file |
| 110 | `backend/test/idempotency.test.js` | backend-root | 32 | 0.7 | Project source/support file |
| 111 | `backend/test/importCsv.test.js` | backend-root | 83 | 3.0 | Project source/support file |
| 112 | `backend/test/importDecisionIntegrity.test.js` | backend-root | 117 | 3.8 | Project source/support file |
| 113 | `backend/test/importJobStateMachine.test.js` | backend-root | 420 | 21.0 | Project source/support file |
| 114 | `backend/test/importScaleSmoke.test.js` | backend-root | 79 | 2.7 | Project source/support file |
| 115 | `backend/test/initials.test.js` | backend-root | 24 | 0.8 | Project source/support file |
| 116 | `backend/test/integrationDoctor.test.js` | backend-root | 50 | 1.6 | Project source/support file |
| 117 | `backend/test/inventorySettingsMediaContracts.test.js` | backend-root | 62 | 3.0 | Project source/support file |
| 118 | `backend/test/mediaOptimization.test.js` | backend-root | 118 | 3.9 | Project source/support file |
| 119 | `backend/test/netSecurity.test.js` | backend-root | 45 | 1.5 | Project source/support file |
| 120 | `backend/test/offlineSecurity.test.js` | backend-root | 87 | 3.7 | Project source/support file |
| 121 | `backend/test/ownedGoogleAuth.test.js` | backend-root | 98 | 3.9 | Project source/support file |
| 122 | `backend/test/permissionPolicy.test.js` | backend-root | 34 | 1.7 | Project source/support file |
| 123 | `backend/test/portalInventoryRegression.test.js` | backend-root | 88 | 6.9 | Project source/support file |
| 124 | `backend/test/portalUtils.test.js` | backend-root | 40 | 1.2 | Project source/support file |
| 125 | `backend/test/postgresCutoverReadiness.test.js` | backend-root | 56 | 1.6 | Project source/support file |
| 126 | `backend/test/postgresDatabase.test.js` | backend-root | 111 | 3.6 | Project source/support file |
| 127 | `backend/test/postgresQueryCompat.test.js` | backend-root | 98 | 3.5 | Project source/support file |
| 128 | `backend/test/productBatchHierarchy.test.js` | backend-root | 101 | 4.4 | Project source/support file |
| 129 | `backend/test/productExpiry.test.js` | backend-root | 68 | 2.8 | Project source/support file |
| 130 | `backend/test/productImportPolicies.test.js` | backend-root | 72 | 2.9 | Project source/support file |
| 131 | `backend/test/productSearchPagination.test.js` | backend-root | 16 | 1.1 | Project source/support file |
| 132 | `backend/test/rfidRoutes.test.js` | backend-root | 46 | 1.9 | Project source/support file |
| 133 | `backend/test/routeContracts.test.js` | backend-root | 167 | 8.9 | Project source/support file |
| 134 | `backend/test/runtimeCache.test.js` | backend-root | 52 | 1.3 | Project source/support file |
| 135 | `backend/test/runtimeVersion.test.js` | backend-root | 51 | 1.4 | Project source/support file |
| 136 | `backend/test/serverUtils.test.js` | backend-root | 283 | 10.3 | Project source/support file |
| 137 | `backend/test/systemJobs.test.js` | backend-root | 97 | 3.5 | Project source/support file |
| 138 | `backend/test/uploadSecurity.test.js` | backend-root | 59 | 2.0 | Project source/support file |
| 139 | `frontend/.npmrc` | frontend-root | 14 | 0.4 | Project source/support file |
| 140 | `frontend/index.html` | frontend-root | 24 | 1.0 | Project source/support file |
| 141 | `frontend/package-lock.json` | frontend-root | 3803 | 130.5 | Configuration/data manifest |
| 142 | `frontend/package.json` | frontend-root | 40 | 4.1 | Configuration/data manifest |
| 143 | `frontend/postcss.config.mjs` | frontend-root | 7 | 0.1 | Project source/support file |
| 144 | `frontend/public/favicon.ico` | frontend-root | 0 | 11.4 | Project source/support file |
| 145 | `frontend/public/icon.png` | frontend-root | 0 | 11.4 | Project source/support file |
| 146 | `frontend/public/manifest.json` | frontend-root | 17 | 0.3 | Configuration/data manifest |
| 147 | `frontend/public/runtime-noise-guard.js` | frontend-root | 105 | 4.1 | Project source/support file |
| 148 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.js` | frontend-root | 1 | 94.8 | Project source/support file |
| 149 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.wasm` | frontend-root | 0 | 8726.7 | Project source/support file |
| 150 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.worker.js` | frontend-root | 1 | 1.9 | Project source/support file |
| 151 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd.wasm` | frontend-root | 0 | 8782.2 | Project source/support file |
| 152 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm.wasm` | frontend-root | 0 | 8192.9 | Project source/support file |
| 153 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd-threads.js` | frontend-root | 1 | 146.4 | Project source/support file |
| 154 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd.js` | frontend-root | 1 | 135.5 | Project source/support file |
| 155 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core.js` | frontend-root | 1 | 135.5 | Project source/support file |
| 156 | `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js` | frontend-root | 187 | 1007.0 | Project source/support file |
| 157 | `frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js.LICENSE.txt` | frontend-root | 24 | 0.5 | Project source/support file |
| 158 | `frontend/public/sw.js` | frontend-root | 424 | 14.7 | Project source/support file |
| 159 | `frontend/public/theme-bootstrap.js` | frontend-root | 219 | 7.9 | Project source/support file |
| 160 | `frontend/README.md` | frontend-root | 13 | 0.5 | Documentation |
| 161 | `frontend/src/api/http.js` | frontend-api | 1070 | 38.5 | Frontend API/sync helper |
| 162 | `frontend/src/api/localDb.js` | frontend-api | 276 | 10.2 | Frontend API/sync helper |
| 163 | `frontend/src/api/methods.js` | frontend-api | 2274 | 102.6 | Frontend API/sync helper |
| 164 | `frontend/src/api/README.md` | frontend-api | 26 | 0.8 | Frontend API/sync helper |
| 165 | `frontend/src/api/websocket.js` | frontend-api | 220 | 7.2 | Frontend API/sync helper |
| 166 | `frontend/src/App.jsx` | frontend-core | 1301 | 50.1 | Main app shell and page mounting |
| 167 | `frontend/src/app/appShellUtils.mjs` | frontend-core | 2 | 0.0 | Project source/support file |
| 168 | `frontend/src/app/appShellUtils.ts` | frontend-core | 158 | 5.1 | Project source/support file |
| 169 | `frontend/src/app/publicErrorRecovery.mjs` | frontend-core | 23 | 1.0 | Project source/support file |
| 170 | `frontend/src/AppContext.jsx` | frontend-core | 1598 | 62.6 | Global app state/context provider |
| 171 | `frontend/src/components/auth/Login.jsx` | frontend-ui | 1084 | 49.4 | UI component/page |
| 172 | `frontend/src/components/branches/Branches.jsx` | frontend-ui | 860 | 40.0 | UI component/page |
| 173 | `frontend/src/components/branches/BranchForm.jsx` | frontend-ui | 190 | 6.4 | UI component/page |
| 174 | `frontend/src/components/branches/TransferModal.jsx` | frontend-ui | 346 | 13.8 | UI component/page |
| 175 | `frontend/src/components/catalog/CatalogEditorSurface.jsx` | frontend-ui | 1295 | 94.7 | UI component/page |
| 176 | `frontend/src/components/catalog/CatalogImageField.jsx` | frontend-ui | 91 | 4.0 | UI component/page |
| 177 | `frontend/src/components/catalog/CatalogPage.jsx` | frontend-ui | 3224 | 139.1 | UI component/page |
| 178 | `frontend/src/components/catalog/CatalogPageContext.jsx` | frontend-ui | 21 | 0.5 | UI component/page |
| 179 | `frontend/src/components/catalog/CatalogPreviewSurface.jsx` | frontend-ui | 347 | 18.6 | UI component/page |
| 180 | `frontend/src/components/catalog/CatalogProductsSection.jsx` | frontend-ui | 511 | 26.8 | UI component/page |
| 181 | `frontend/src/components/catalog/CatalogSecondaryTabs.jsx` | frontend-ui | 837 | 50.4 | UI component/page |
| 182 | `frontend/src/components/catalog/catalogUi.jsx` | frontend-ui | 63 | 2.5 | UI component/page |
| 183 | `frontend/src/components/catalog/portalCatalogDisplay.mjs` | frontend-ui | 2 | 0.0 | UI component/page |
| 184 | `frontend/src/components/catalog/portalCatalogDisplay.ts` | frontend-ui | 183 | 6.0 | UI component/page |
| 185 | `frontend/src/components/catalog/portalContentI18n.mjs` | frontend-ui | 2 | 0.0 | UI component/page |
| 186 | `frontend/src/components/catalog/portalContentI18n.ts` | frontend-ui | 788 | 49.3 | UI component/page |
| 187 | `frontend/src/components/catalog/portalEditorUtils.mjs` | frontend-ui | 2 | 0.0 | UI component/page |
| 188 | `frontend/src/components/catalog/portalEditorUtils.ts` | frontend-ui | 189 | 5.7 | UI component/page |
| 189 | `frontend/src/components/catalog/portalLanguagePacks.d.mts` | frontend-ui | 13 | 0.4 | UI component/page |
| 190 | `frontend/src/components/catalog/portalLanguagePacks.mjs` | frontend-ui | 2 | 0.0 | UI component/page |
| 191 | `frontend/src/components/catalog/portalLanguagePacks.ts` | frontend-ui | 1349 | 62.5 | UI component/page |
| 192 | `frontend/src/components/catalog/portalTranslateController.mjs` | frontend-ui | 224 | 8.6 | UI component/page |
| 193 | `frontend/src/components/contacts/ContactImportModal.jsx` | frontend-ui | 326 | 12.9 | UI component/page |
| 194 | `frontend/src/components/contacts/contactImportParser.mjs` | frontend-ui | 2 | 0.0 | UI component/page |
| 195 | `frontend/src/components/contacts/contactImportParser.ts` | frontend-ui | 2 | 0.1 | UI component/page |
| 196 | `frontend/src/components/contacts/contactImportWorker.mjs` | frontend-ui | 2 | 0.0 | UI component/page |
| 197 | `frontend/src/components/contacts/contactImportWorker.ts` | frontend-ui | 39 | 1.0 | UI component/page |
| 198 | `frontend/src/components/contacts/contactOptionUtils.js` | frontend-ui | 2 | 0.0 | UI component/page |
| 199 | `frontend/src/components/contacts/contactOptionUtils.ts` | frontend-ui | 131 | 4.8 | UI component/page |
| 200 | `frontend/src/components/contacts/Contacts.jsx` | frontend-ui | 316 | 12.9 | UI component/page |
| 201 | `frontend/src/components/contacts/CustomerFormModal.jsx` | frontend-ui | 201 | 9.7 | UI component/page |
| 202 | `frontend/src/components/contacts/customerMembershipNumber.js` | frontend-ui | 2 | 0.0 | UI component/page |
| 203 | `frontend/src/components/contacts/customerMembershipNumber.ts` | frontend-ui | 11 | 0.4 | UI component/page |
| 204 | `frontend/src/components/contacts/CustomersTab.jsx` | frontend-ui | 795 | 39.2 | UI component/page |
| 205 | `frontend/src/components/contacts/DeliveryTab.jsx` | frontend-ui | 818 | 42.7 | UI component/page |
| 206 | `frontend/src/components/contacts/shared.jsx` | frontend-ui | 356 | 13.9 | UI component/page |
| 207 | `frontend/src/components/contacts/SuppliersTab.jsx` | frontend-ui | 835 | 43.0 | UI component/page |
| 208 | `frontend/src/components/custom-tables/CustomTables.jsx` | frontend-ui | 589 | 25.9 | UI component/page |
| 209 | `frontend/src/components/dashboard/charts/BarChart.jsx` | frontend-ui | 149 | 6.4 | UI component/page |
| 210 | `frontend/src/components/dashboard/charts/DonutChart.jsx` | frontend-ui | 93 | 4.2 | UI component/page |
| 211 | `frontend/src/components/dashboard/charts/index.js` | frontend-ui | 2 | 0.0 | UI component/page |
| 212 | `frontend/src/components/dashboard/charts/index.ts` | frontend-ui | 5 | 0.2 | UI component/page |
| 213 | `frontend/src/components/dashboard/charts/LineChart.jsx` | frontend-ui | 197 | 8.9 | UI component/page |
| 214 | `frontend/src/components/dashboard/charts/NoData.jsx` | frontend-ui | 15 | 0.6 | UI component/page |
| 215 | `frontend/src/components/dashboard/Dashboard.jsx` | frontend-ui | 2003 | 104.8 | UI component/page |
| 216 | `frontend/src/components/dashboard/MiniStat.jsx` | frontend-ui | 36 | 1.7 | UI component/page |
| 217 | `frontend/src/components/files/FilePickerModal.jsx` | frontend-ui | 270 | 11.5 | UI component/page |
| 218 | `frontend/src/components/files/FilesPage.jsx` | frontend-ui | 990 | 47.1 | UI component/page |
| 219 | `frontend/src/components/files/FilesProvidersTab.jsx` | frontend-ui | 222 | 16.4 | UI component/page |
| 220 | `frontend/src/components/files/FilesResponsesTab.jsx` | frontend-ui | 142 | 9.5 | UI component/page |
| 221 | `frontend/src/components/inventory/DualMoney.jsx` | frontend-ui | 14 | 0.6 | UI component/page |
| 222 | `frontend/src/components/inventory/Inventory.jsx` | frontend-ui | 4023 | 207.0 | UI component/page |
| 223 | `frontend/src/components/inventory/InventoryImportModal.jsx` | frontend-ui | 228 | 10.4 | UI component/page |
| 224 | `frontend/src/components/inventory/inventoryImportWorker.mjs` | frontend-ui | 2 | 0.0 | UI component/page |
| 225 | `frontend/src/components/inventory/inventoryImportWorker.ts` | frontend-ui | 39 | 1.0 | UI component/page |
| 226 | `frontend/src/components/inventory/InventoryMovementsSurface.jsx` | frontend-ui | 529 | 33.7 | UI component/page |
| 227 | `frontend/src/components/inventory/InventoryProductsSurface.jsx` | frontend-ui | 467 | 31.6 | UI component/page |
| 228 | `frontend/src/components/inventory/InventoryRfidSurface.jsx` | frontend-ui | 126 | 8.4 | UI component/page |
| 229 | `frontend/src/components/inventory/movementGroups.js` | frontend-ui | 2 | 0.0 | UI component/page |
| 230 | `frontend/src/components/inventory/movementGroups.ts` | frontend-ui | 287 | 12.6 | UI component/page |
| 231 | `frontend/src/components/inventory/ProductDetailModal.jsx` | frontend-ui | 202 | 13.2 | UI component/page |
| 232 | `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | frontend-ui | 625 | 35.7 | UI component/page |
| 233 | `frontend/src/components/navigation/Sidebar.jsx` | frontend-ui | 319 | 14.4 | UI component/page |
| 234 | `frontend/src/components/pos/CartItem.jsx` | frontend-ui | 106 | 5.2 | UI component/page |
| 235 | `frontend/src/components/pos/FilterPanel.jsx` | frontend-ui | 229 | 7.9 | UI component/page |
| 236 | `frontend/src/components/pos/POS.jsx` | frontend-ui | 1918 | 107.4 | UI component/page |
| 237 | `frontend/src/components/pos/posCore.mjs` | frontend-ui | 2 | 0.0 | UI component/page |
| 238 | `frontend/src/components/pos/posCore.ts` | frontend-ui | 143 | 5.5 | UI component/page |
| 239 | `frontend/src/components/pos/ProductImage.jsx` | frontend-ui | 6 | 0.2 | UI component/page |
| 240 | `frontend/src/components/pos/QuickAddModal.jsx` | frontend-ui | 38 | 1.6 | UI component/page |
| 241 | `frontend/src/components/products/config/productPageConfig.mjs` | frontend-ui | 2 | 0.0 | UI component/page |
| 242 | `frontend/src/components/products/config/productPageConfig.ts` | frontend-ui | 24 | 0.7 | UI component/page |
| 243 | `frontend/src/components/products/forms/BranchStockAdjuster.jsx` | frontend-ui | 119 | 4.9 | UI component/page |
| 244 | `frontend/src/components/products/forms/BulkAddStockModal.jsx` | frontend-ui | 91 | 4.3 | UI component/page |
| 245 | `frontend/src/components/products/forms/ProductForm.jsx` | frontend-ui | 940 | 46.8 | UI component/page |
| 246 | `frontend/src/components/products/forms/VariantFormModal.jsx` | frontend-ui | 274 | 13.2 | UI component/page |
| 247 | `frontend/src/components/products/helpers/productDisplayHelpers.mjs` | frontend-ui | 2 | 0.0 | UI component/page |
| 248 | `frontend/src/components/products/helpers/productDisplayHelpers.ts` | frontend-ui | 156 | 5.7 | UI component/page |
| 249 | `frontend/src/components/products/helpers/productFilterHelpers.mjs` | frontend-ui | 2 | 0.0 | UI component/page |
| 250 | `frontend/src/components/products/helpers/productFilterHelpers.ts` | frontend-ui | 214 | 8.7 | UI component/page |
| 251 | `frontend/src/components/products/helpers/productGalleryHelpers.d.mts` | frontend-ui | 25 | 1.0 | UI component/page |
| 252 | `frontend/src/components/products/helpers/productGalleryHelpers.mjs` | frontend-ui | 2 | 0.0 | UI component/page |
| 253 | `frontend/src/components/products/helpers/productGalleryHelpers.ts` | frontend-ui | 101 | 3.0 | UI component/page |
| 254 | `frontend/src/components/products/helpers/productGroupViewHelpers.mjs` | frontend-ui | 2 | 0.0 | UI component/page |
| 255 | `frontend/src/components/products/helpers/productGroupViewHelpers.ts` | frontend-ui | 46 | 1.6 | UI component/page |
| 256 | `frontend/src/components/products/helpers/productMenuHelpers.mjs` | frontend-ui | 2 | 0.0 | UI component/page |
| 257 | `frontend/src/components/products/helpers/productMenuHelpers.ts` | frontend-ui | 292 | 10.7 | UI component/page |
| 258 | `frontend/src/components/products/helpers/productPageHelpers.mjs` | frontend-ui | 32 | 0.9 | UI component/page |
| 259 | `frontend/src/components/products/helpers/productSelectionHelpers.mjs` | frontend-ui | 2 | 0.0 | UI component/page |
| 260 | `frontend/src/components/products/helpers/productSelectionHelpers.ts` | frontend-ui | 122 | 3.6 | UI component/page |
| 261 | `frontend/src/components/products/helpers/productWriteHelpers.mjs` | frontend-ui | 2 | 0.0 | UI component/page |
| 262 | `frontend/src/components/products/helpers/productWriteHelpers.ts` | frontend-ui | 372 | 12.3 | UI component/page |
| 263 | `frontend/src/components/products/history/productHistoryHelpers.mjs` | frontend-ui | 2 | 0.0 | UI component/page |
| 264 | `frontend/src/components/products/history/productHistoryHelpers.ts` | frontend-ui | 46 | 1.3 | UI component/page |
| 265 | `frontend/src/components/products/import/BulkImportModal.jsx` | frontend-ui | 1890 | 91.5 | UI component/page |
| 266 | `frontend/src/components/products/import/productImportPlanner.mjs` | frontend-ui | 2 | 0.0 | UI component/page |
| 267 | `frontend/src/components/products/import/productImportPlanner.ts` | frontend-ui | 634 | 25.1 | UI component/page |
| 268 | `frontend/src/components/products/import/productImportWorker.mjs` | frontend-ui | 2 | 0.0 | UI component/page |
| 269 | `frontend/src/components/products/import/productImportWorker.ts` | frontend-ui | 68 | 1.8 | UI component/page |
| 270 | `frontend/src/components/products/lookups/ManageBrandsModal.jsx` | frontend-ui | 670 | 27.9 | UI component/page |
| 271 | `frontend/src/components/products/lookups/ManageCategoriesModal.jsx` | frontend-ui | 496 | 21.4 | UI component/page |
| 272 | `frontend/src/components/products/lookups/ManageUnitsModal.jsx` | frontend-ui | 488 | 20.7 | UI component/page |
| 273 | `frontend/src/components/products/lookups/productLookupSnapshots.mjs` | frontend-ui | 129 | 4.3 | UI component/page |
| 274 | `frontend/src/components/products/Products.jsx` | frontend-ui | 2024 | 96.3 | UI component/page |
| 275 | `frontend/src/components/products/scanning/barcodeImageScanner.mjs` | frontend-ui | 2 | 0.0 | UI component/page |
| 276 | `frontend/src/components/products/scanning/barcodeImageScanner.ts` | frontend-ui | 125 | 3.9 | UI component/page |
| 277 | `frontend/src/components/products/scanning/BarcodeScannerModal.jsx` | frontend-ui | 581 | 27.7 | UI component/page |
| 278 | `frontend/src/components/products/scanning/barcodeScannerState.mjs` | frontend-ui | 2 | 0.0 | UI component/page |
| 279 | `frontend/src/components/products/scanning/barcodeScannerState.ts` | frontend-ui | 82 | 2.4 | UI component/page |
| 280 | `frontend/src/components/products/scanning/scanbotScanner.mjs` | frontend-ui | 137 | 4.5 | UI component/page |
| 281 | `frontend/src/components/products/shared/primitives.jsx` | frontend-ui | 207 | 7.2 | UI component/page |
| 282 | `frontend/src/components/products/surfaces/HeaderActions.jsx` | frontend-ui | 140 | 5.9 | UI component/page |
| 283 | `frontend/src/components/products/surfaces/ProductDetailModal.jsx` | frontend-ui | 241 | 12.2 | UI component/page |
| 284 | `frontend/src/components/products/surfaces/ProductRowParts.jsx` | frontend-ui | 84 | 4.5 | UI component/page |
| 285 | `frontend/src/components/products/surfaces/ProductsListSurface.jsx` | frontend-ui | 334 | 18.6 | UI component/page |
| 286 | `frontend/src/components/README.md` | frontend-ui | 37 | 1.9 | UI component/page |
| 287 | `frontend/src/components/receipt-settings/AllFieldsPanel.jsx` | frontend-ui | 99 | 4.0 | UI component/page |
| 288 | `frontend/src/components/receipt-settings/constants.js` | frontend-ui | 2 | 0.0 | UI component/page |
| 289 | `frontend/src/components/receipt-settings/constants.ts` | frontend-ui | 156 | 7.8 | UI component/page |
| 290 | `frontend/src/components/receipt-settings/ErrorBoundary.jsx` | frontend-ui | 28 | 0.9 | UI component/page |
| 291 | `frontend/src/components/receipt-settings/FieldOrderManager.jsx` | frontend-ui | 190 | 9.4 | UI component/page |
| 292 | `frontend/src/components/receipt-settings/PrintSettings.jsx` | frontend-ui | 245 | 11.0 | UI component/page |
| 293 | `frontend/src/components/receipt-settings/ReceiptPreview.jsx` | frontend-ui | 104 | 3.5 | UI component/page |
| 294 | `frontend/src/components/receipt-settings/ReceiptSettings.jsx` | frontend-ui | 440 | 26.0 | UI component/page |
| 295 | `frontend/src/components/receipt-settings/template.js` | frontend-ui | 2 | 0.0 | UI component/page |
| 296 | `frontend/src/components/receipt-settings/template.ts` | frontend-ui | 33 | 0.9 | UI component/page |
| 297 | `frontend/src/components/receipt/Receipt.jsx` | frontend-ui | 470 | 22.3 | UI component/page |
| 298 | `frontend/src/components/returns/EditReturnModal.jsx` | frontend-ui | 241 | 12.9 | UI component/page |
| 299 | `frontend/src/components/returns/NewReturnModal.jsx` | frontend-ui | 492 | 27.8 | UI component/page |
| 300 | `frontend/src/components/returns/NewSupplierReturnModal.jsx` | frontend-ui | 394 | 20.8 | UI component/page |
| 301 | `frontend/src/components/returns/ReturnDetailModal.jsx` | frontend-ui | 132 | 6.8 | UI component/page |
| 302 | `frontend/src/components/returns/Returns.jsx` | frontend-ui | 812 | 35.9 | UI component/page |
| 303 | `frontend/src/components/returns/ReturnsListSurface.jsx` | frontend-ui | 328 | 17.6 | UI component/page |
| 304 | `frontend/src/components/sales/ExportModal.jsx` | frontend-ui | 250 | 11.2 | UI component/page |
| 305 | `frontend/src/components/sales/SaleDetailModal.jsx` | frontend-ui | 332 | 15.7 | UI component/page |
| 306 | `frontend/src/components/sales/Sales.jsx` | frontend-ui | 872 | 39.2 | UI component/page |
| 307 | `frontend/src/components/sales/SalesImportModal.jsx` | frontend-ui | 228 | 10.3 | UI component/page |
| 308 | `frontend/src/components/sales/salesImportWorker.mjs` | frontend-ui | 2 | 0.0 | UI component/page |
| 309 | `frontend/src/components/sales/salesImportWorker.ts` | frontend-ui | 39 | 1.0 | UI component/page |
| 310 | `frontend/src/components/sales/SalesListSurface.jsx` | frontend-ui | 318 | 19.2 | UI component/page |
| 311 | `frontend/src/components/sales/StatusBadge.jsx` | frontend-ui | 47 | 1.6 | UI component/page |
| 312 | `frontend/src/components/server/ServerPage.jsx` | frontend-ui | 781 | 38.5 | UI component/page |
| 313 | `frontend/src/components/shared/ActionHistoryBar.jsx` | frontend-ui | 151 | 8.1 | UI component/page |
| 314 | `frontend/src/components/shared/BackgroundImportTracker.jsx` | frontend-ui | 546 | 24.2 | UI component/page |
| 315 | `frontend/src/components/shared/ExportMenu.jsx` | frontend-ui | 36 | 1.5 | UI component/page |
| 316 | `frontend/src/components/shared/FilterMenu.jsx` | frontend-ui | 113 | 4.8 | UI component/page |
| 317 | `frontend/src/components/shared/globalScroll.js` | frontend-ui | 29 | 1.4 | UI component/page |
| 318 | `frontend/src/components/shared/ImageGalleryLightbox.jsx` | frontend-ui | 119 | 4.9 | UI component/page |
| 319 | `frontend/src/components/shared/LoadingWatchdog.jsx` | frontend-ui | 63 | 2.0 | UI component/page |
| 320 | `frontend/src/components/shared/Modal.jsx` | frontend-ui | 34 | 1.8 | UI component/page |
| 321 | `frontend/src/components/shared/navigationConfig.js` | frontend-ui | 2 | 0.0 | UI component/page |
| 322 | `frontend/src/components/shared/navigationConfig.ts` | frontend-ui | 66 | 2.2 | UI component/page |
| 323 | `frontend/src/components/shared/NotificationCenter.jsx` | frontend-ui | 594 | 30.0 | UI component/page |
| 324 | `frontend/src/components/shared/pageActivity.js` | frontend-ui | 8 | 0.2 | UI component/page |
| 325 | `frontend/src/components/shared/PageHeader.jsx` | frontend-ui | 47 | 1.9 | UI component/page |
| 326 | `frontend/src/components/shared/PaginationControls.jsx` | frontend-ui | 202 | 9.6 | UI component/page |
| 327 | `frontend/src/components/shared/PortalMenu.jsx` | frontend-ui | 221 | 7.3 | UI component/page |
| 328 | `frontend/src/components/shared/QuickPreferenceToggles.jsx` | frontend-ui | 56 | 2.0 | UI component/page |
| 329 | `frontend/src/components/shared/SectionSwitcher.jsx` | frontend-ui | 72 | 2.8 | UI component/page |
| 330 | `frontend/src/components/shared/WriteConflictModal.jsx` | frontend-ui | 266 | 11.0 | UI component/page |
| 331 | `frontend/src/components/users/PermissionEditor.jsx` | frontend-ui | 152 | 7.3 | UI component/page |
| 332 | `frontend/src/components/users/UserDetailSheet.jsx` | frontend-ui | 103 | 5.0 | UI component/page |
| 333 | `frontend/src/components/users/UserProfileModal.jsx` | frontend-ui | 1158 | 62.4 | UI component/page |
| 334 | `frontend/src/components/users/Users.jsx` | frontend-ui | 1036 | 49.8 | UI component/page |
| 335 | `frontend/src/components/utils-settings/AuditLog.jsx` | frontend-ui | 1161 | 55.2 | UI component/page |
| 336 | `frontend/src/components/utils-settings/Backup.jsx` | frontend-ui | 1490 | 69.1 | UI component/page |
| 337 | `frontend/src/components/utils-settings/FontFamilyPicker.jsx` | frontend-ui | 58 | 3.0 | UI component/page |
| 338 | `frontend/src/components/utils-settings/index.js` | frontend-ui | 2 | 0.0 | UI component/page |
| 339 | `frontend/src/components/utils-settings/index.ts` | frontend-ui | 7 | 0.3 | UI component/page |
| 340 | `frontend/src/components/utils-settings/OtpModal.jsx` | frontend-ui | 258 | 10.0 | UI component/page |
| 341 | `frontend/src/components/utils-settings/ResetData.jsx` | frontend-ui | 297 | 13.3 | UI component/page |
| 342 | `frontend/src/components/utils-settings/Settings.jsx` | frontend-ui | 1730 | 80.5 | UI component/page |
| 343 | `frontend/src/components/utils-settings/settingsConflict.js` | frontend-ui | 2 | 0.0 | UI component/page |
| 344 | `frontend/src/components/utils-settings/settingsConflict.ts` | frontend-ui | 64 | 1.7 | UI component/page |
| 345 | `frontend/src/constants.js` | frontend-core | 182 | 8.6 | Project source/support file |
| 346 | `frontend/src/index.jsx` | frontend-core | 194 | 6.4 | Project source/support file |
| 347 | `frontend/src/lang/en.json` | frontend-i18n | 2676 | 132.4 | Localization dictionary |
| 348 | `frontend/src/lang/km.json` | frontend-i18n | 2685 | 243.1 | Localization dictionary |
| 349 | `frontend/src/platform/runtime/clientRuntime.js` | frontend-core | 193 | 7.0 | Project source/support file |
| 350 | `frontend/src/platform/storage/storagePolicy.mjs` | frontend-core | 2 | 0.0 | Project source/support file |
| 351 | `frontend/src/platform/storage/storagePolicy.ts` | frontend-core | 40 | 1.2 | Project source/support file |
| 352 | `frontend/src/README.md` | frontend-core | 38 | 1.3 | Documentation |
| 353 | `frontend/src/runtime/runtimeErrorClassifier.mjs` | frontend-core | 127 | 4.7 | Project source/support file |
| 354 | `frontend/src/styles/main.css` | frontend-style | 741 | 29.8 | Project source/support file |
| 355 | `frontend/src/types/jsx-modules.d.ts` | frontend-core | 7 | 0.1 | Project source/support file |
| 356 | `frontend/src/types/receiptContracts.ts` | frontend-core | 67 | 1.6 | Project source/support file |
| 357 | `frontend/src/types/settingsContracts.ts` | frontend-core | 27 | 0.5 | Project source/support file |
| 358 | `frontend/src/utils/actionGuards.mjs` | frontend-utils | 2 | 0.0 | Utility helper |
| 359 | `frontend/src/utils/actionGuards.ts` | frontend-utils | 76 | 2.1 | Utility helper |
| 360 | `frontend/src/utils/actionHistory.mjs` | frontend-utils | 191 | 7.9 | Utility helper |
| 361 | `frontend/src/utils/appRefresh.d.ts` | frontend-utils | 4 | 0.2 | Utility helper |
| 362 | `frontend/src/utils/appRefresh.js` | frontend-utils | 38 | 0.9 | Utility helper |
| 363 | `frontend/src/utils/bulkOps.mjs` | frontend-utils | 2 | 0.0 | Utility helper |
| 364 | `frontend/src/utils/bulkOps.ts` | frontend-utils | 69 | 1.9 | Utility helper |
| 365 | `frontend/src/utils/color.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 366 | `frontend/src/utils/color.ts` | frontend-utils | 34 | 1.0 | Utility helper |
| 367 | `frontend/src/utils/csv.d.ts` | frontend-utils | 8 | 0.8 | Utility helper |
| 368 | `frontend/src/utils/csv.js` | frontend-utils | 216 | 7.0 | Utility helper |
| 369 | `frontend/src/utils/csvExportWorker.mjs` | frontend-utils | 2 | 0.0 | Utility helper |
| 370 | `frontend/src/utils/csvExportWorker.ts` | frontend-utils | 35 | 1.0 | Utility helper |
| 371 | `frontend/src/utils/csvImport.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 372 | `frontend/src/utils/csvImport.ts` | frontend-utils | 306 | 10.0 | Utility helper |
| 373 | `frontend/src/utils/csvRowCounter.d.mts` | frontend-utils | 2 | 0.1 | Utility helper |
| 374 | `frontend/src/utils/csvRowCounter.mjs` | frontend-utils | 2 | 0.0 | Utility helper |
| 375 | `frontend/src/utils/csvRowCounter.ts` | frontend-utils | 40 | 0.9 | Utility helper |
| 376 | `frontend/src/utils/dateHelpers.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 377 | `frontend/src/utils/dateHelpers.ts` | frontend-utils | 18 | 0.6 | Utility helper |
| 378 | `frontend/src/utils/deviceInfo.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 379 | `frontend/src/utils/deviceInfo.ts` | frontend-utils | 54 | 1.5 | Utility helper |
| 380 | `frontend/src/utils/exportPackage.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 381 | `frontend/src/utils/exportPackage.ts` | frontend-utils | 61 | 1.3 | Utility helper |
| 382 | `frontend/src/utils/exportReports.jsx` | frontend-utils | 366 | 9.9 | Utility helper |
| 383 | `frontend/src/utils/favicon.js` | frontend-utils | 88 | 2.7 | Utility helper |
| 384 | `frontend/src/utils/formatters.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 385 | `frontend/src/utils/formatters.ts` | frontend-utils | 89 | 2.6 | Utility helper |
| 386 | `frontend/src/utils/groupedRecords.d.mts` | frontend-utils | 66 | 1.8 | Utility helper |
| 387 | `frontend/src/utils/groupedRecords.mjs` | frontend-utils | 2 | 0.0 | Utility helper |
| 388 | `frontend/src/utils/groupedRecords.ts` | frontend-utils | 330 | 10.9 | Utility helper |
| 389 | `frontend/src/utils/historyHelpers.mjs` | frontend-utils | 2 | 0.0 | Utility helper |
| 390 | `frontend/src/utils/historyHelpers.ts` | frontend-utils | 61 | 1.8 | Utility helper |
| 391 | `frontend/src/utils/importJobRefresh.js` | frontend-utils | 72 | 2.3 | Utility helper |
| 392 | `frontend/src/utils/index.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 393 | `frontend/src/utils/index.ts` | frontend-utils | 6 | 0.2 | Utility helper |
| 394 | `frontend/src/utils/initials.d.mts` | frontend-utils | 27 | 0.8 | Utility helper |
| 395 | `frontend/src/utils/initials.mjs` | frontend-utils | 2 | 0.0 | Utility helper |
| 396 | `frontend/src/utils/initials.ts` | frontend-utils | 105 | 3.4 | Utility helper |
| 397 | `frontend/src/utils/loaders.mjs` | frontend-utils | 84 | 2.5 | Utility helper |
| 398 | `frontend/src/utils/mediaUpload.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 399 | `frontend/src/utils/mediaUpload.ts` | frontend-utils | 145 | 4.0 | Utility helper |
| 400 | `frontend/src/utils/permissions.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 401 | `frontend/src/utils/permissions.ts` | frontend-utils | 22 | 0.5 | Utility helper |
| 402 | `frontend/src/utils/pricing.d.ts` | frontend-utils | 16 | 0.8 | Utility helper |
| 403 | `frontend/src/utils/pricing.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 404 | `frontend/src/utils/pricing.ts` | frontend-utils | 102 | 3.9 | Utility helper |
| 405 | `frontend/src/utils/printReceipt.js` | frontend-utils | 960 | 33.0 | Utility helper |
| 406 | `frontend/src/utils/productBatches.mjs` | frontend-utils | 2 | 0.0 | Utility helper |
| 407 | `frontend/src/utils/productBatches.ts` | frontend-utils | 61 | 1.7 | Utility helper |
| 408 | `frontend/src/utils/productGrouping.d.mts` | frontend-utils | 55 | 1.4 | Utility helper |
| 409 | `frontend/src/utils/productGrouping.mjs` | frontend-utils | 2 | 0.0 | Utility helper |
| 410 | `frontend/src/utils/productGrouping.ts` | frontend-utils | 315 | 11.0 | Utility helper |
| 411 | `frontend/src/utils/publicAssetUrls.d.ts` | frontend-utils | 2 | 0.1 | Utility helper |
| 412 | `frontend/src/utils/publicAssetUrls.js` | frontend-utils | 72 | 2.8 | Utility helper |
| 413 | `frontend/src/utils/receiptAppliedConfig.ts` | frontend-utils | 147 | 4.5 | Utility helper |
| 414 | `frontend/src/utils/scriptTypography.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 415 | `frontend/src/utils/scriptTypography.ts` | frontend-utils | 27 | 0.7 | Utility helper |
| 416 | `frontend/src/utils/settingsRefresh.js` | frontend-utils | 2 | 0.0 | Utility helper |
| 417 | `frontend/src/utils/settingsRefresh.ts` | frontend-utils | 84 | 2.4 | Utility helper |
| 418 | `frontend/src/utils/settingsWriteOptions.ts` | frontend-utils | 13 | 0.5 | Utility helper |
| 419 | `frontend/src/web-api.js` | frontend-core | 785 | 30.5 | Project source/support file |
| 420 | `frontend/tailwind.config.mjs` | frontend-root | 17 | 0.4 | Project source/support file |
| 421 | `frontend/tests/actionGuards.test.mjs` | frontend-root | 72 | 2.1 | Project source/support file |
| 422 | `frontend/tests/actionStability.test.mjs` | frontend-root | 729 | 57.9 | Project source/support file |
| 423 | `frontend/tests/adminShellMediaGuards.test.mjs` | frontend-root | 105 | 3.9 | Project source/support file |
| 424 | `frontend/tests/apiHttp.test.mjs` | frontend-root | 393 | 15.8 | Project source/support file |
| 425 | `frontend/tests/appRefresh.test.mjs` | frontend-root | 47 | 1.2 | Project source/support file |
| 426 | `frontend/tests/appShellUtils.test.mjs` | frontend-root | 114 | 5.0 | Project source/support file |
| 427 | `frontend/tests/assetCompression.test.mjs` | frontend-root | 35 | 1.5 | Project source/support file |
| 428 | `frontend/tests/backupJobs.test.mjs` | frontend-root | 136 | 9.0 | Project source/support file |
| 429 | `frontend/tests/barcodeImageScanner.test.mjs` | frontend-root | 120 | 3.0 | Project source/support file |
| 430 | `frontend/tests/barcodeScannerState.test.mjs` | frontend-root | 62 | 2.5 | Project source/support file |
| 431 | `frontend/tests/bulkOps.test.mjs` | frontend-root | 58 | 1.8 | Project source/support file |
| 432 | `frontend/tests/contactImportWorker.test.mjs` | frontend-root | 39 | 1.6 | Project source/support file |
| 433 | `frontend/tests/csvImport.test.mjs` | frontend-root | 84 | 3.4 | Project source/support file |
| 434 | `frontend/tests/dashboardDataReliability.test.mjs` | frontend-root | 31 | 3.1 | Project source/support file |
| 435 | `frontend/tests/dateHelpers.test.mjs` | frontend-root | 39 | 1.0 | Project source/support file |
| 436 | `frontend/tests/deviceInfo.test.mjs` | frontend-root | 61 | 1.7 | Project source/support file |
| 437 | `frontend/tests/exportPackages.test.mjs` | frontend-root | 103 | 3.8 | Project source/support file |
| 438 | `frontend/tests/formatters.test.mjs` | frontend-root | 36 | 0.9 | Project source/support file |
| 439 | `frontend/tests/globalScroll.test.mjs` | frontend-root | 25 | 0.8 | Project source/support file |
| 440 | `frontend/tests/globalScrollControls.test.mjs` | frontend-root | 32 | 1.1 | Project source/support file |
| 441 | `frontend/tests/groupedRecords.test.mjs` | frontend-root | 115 | 3.7 | Project source/support file |
| 442 | `frontend/tests/historyHelpers.test.mjs` | frontend-root | 72 | 2.1 | Project source/support file |
| 443 | `frontend/tests/importJobRefresh.test.mjs` | frontend-root | 87 | 2.4 | Project source/support file |
| 444 | `frontend/tests/initials.test.mjs` | frontend-root | 66 | 2.0 | Project source/support file |
| 445 | `frontend/tests/inventoryImportWorker.test.mjs` | frontend-root | 39 | 1.7 | Project source/support file |
| 446 | `frontend/tests/inventoryMobileCardLayout.test.mjs` | frontend-root | 43 | 2.3 | Project source/support file |
| 447 | `frontend/tests/inventoryMovementGroups.test.mjs` | frontend-root | 64 | 2.3 | Project source/support file |
| 448 | `frontend/tests/inventoryRfidSection.test.mjs` | frontend-root | 23 | 1.1 | Project source/support file |
| 449 | `frontend/tests/jsxSyntaxCheck.mjs` | frontend-root | 36 | 1.2 | Project source/support file |
| 450 | `frontend/tests/loaders.test.mjs` | frontend-root | 82 | 2.4 | Project source/support file |
| 451 | `frontend/tests/mediaUploadHelpers.test.mjs` | frontend-root | 36 | 1.3 | Project source/support file |
| 452 | `frontend/tests/navigationConfig.test.mjs` | frontend-root | 41 | 1.3 | Project source/support file |
| 453 | `frontend/tests/notificationBadge.test.mjs` | frontend-root | 16 | 0.6 | Project source/support file |
| 454 | `frontend/tests/offlineSalesQueue.test.mjs` | frontend-root | 78 | 3.5 | Project source/support file |
| 455 | `frontend/tests/offlineSecurityHardening.test.mjs` | frontend-root | 93 | 4.1 | Project source/support file |
| 456 | `frontend/tests/offlineSyncArchitecture.test.mjs` | frontend-root | 84 | 3.9 | Project source/support file |
| 457 | `frontend/tests/ownedGoogleAuth.test.mjs` | frontend-root | 56 | 2.4 | Project source/support file |
| 458 | `frontend/tests/performanceLoadingUx.test.mjs` | frontend-root | 1620 | 70.0 | Project source/support file |
| 459 | `frontend/tests/permissionEditor.test.mjs` | frontend-root | 36 | 1.3 | Project source/support file |
| 460 | `frontend/tests/permissions.test.mjs` | frontend-root | 18 | 0.6 | Project source/support file |
| 461 | `frontend/tests/portalCatalogDisplay.test.mjs` | frontend-root | 124 | 4.4 | Project source/support file |
| 462 | `frontend/tests/portalContentI18n.test.mjs` | frontend-root | 94 | 3.3 | Project source/support file |
| 463 | `frontend/tests/portalEditorUtils.test.mjs` | frontend-root | 57 | 1.9 | Project source/support file |
| 464 | `frontend/tests/portalFaqVocabulary.test.mjs` | frontend-root | 104 | 4.9 | Project source/support file |
| 465 | `frontend/tests/portalLanguagePacks.test.mjs` | frontend-root | 50 | 3.1 | Project source/support file |
| 466 | `frontend/tests/portalTranslateController.test.mjs` | frontend-root | 145 | 4.5 | Project source/support file |
| 467 | `frontend/tests/posCore.test.mjs` | frontend-root | 136 | 5.1 | Project source/support file |
| 468 | `frontend/tests/pricingContacts.test.mjs` | frontend-root | 108 | 3.8 | Project source/support file |
| 469 | `frontend/tests/productBatches.test.mjs` | frontend-root | 55 | 1.3 | Project source/support file |
| 470 | `frontend/tests/productDiscountUx.test.mjs` | frontend-root | 52 | 2.3 | Project source/support file |
| 471 | `frontend/tests/productDisplayHelpers.test.mjs` | frontend-root | 107 | 3.4 | Project source/support file |
| 472 | `frontend/tests/productFilterHelpers.test.mjs` | frontend-root | 108 | 3.0 | Project source/support file |
| 473 | `frontend/tests/productGalleryHelpers.test.mjs` | frontend-root | 141 | 4.2 | Project source/support file |
| 474 | `frontend/tests/productGrouping.test.mjs` | frontend-root | 112 | 4.8 | Project source/support file |
| 475 | `frontend/tests/productGroupViewHelpers.test.mjs` | frontend-root | 53 | 1.4 | Project source/support file |
| 476 | `frontend/tests/productHistoryHelpers.test.mjs` | frontend-root | 44 | 1.3 | Project source/support file |
| 477 | `frontend/tests/productImportPlanner.test.mjs` | frontend-root | 276 | 13.4 | Project source/support file |
| 478 | `frontend/tests/productImportWorkerFallback.test.mjs` | frontend-root | 41 | 1.9 | Project source/support file |
| 479 | `frontend/tests/productMenuHelpers.test.mjs` | frontend-root | 168 | 5.1 | Project source/support file |
| 480 | `frontend/tests/productPageHelpers.test.mjs` | frontend-root | 23 | 0.8 | Project source/support file |
| 481 | `frontend/tests/productSearchPagination.test.mjs` | frontend-root | 140 | 5.3 | Project source/support file |
| 482 | `frontend/tests/productSelectionHelpers.test.mjs` | frontend-root | 67 | 2.4 | Project source/support file |
| 483 | `frontend/tests/productWriteHelpers.test.mjs` | frontend-root | 517 | 12.4 | Project source/support file |
| 484 | `frontend/tests/publicErrorRecovery.test.mjs` | frontend-root | 35 | 1.2 | Project source/support file |
| 485 | `frontend/tests/receiptSettingsSync.test.mjs` | frontend-root | 43 | 3.1 | Project source/support file |
| 486 | `frontend/tests/receiptTemplate.test.mjs` | frontend-root | 70 | 2.8 | Project source/support file |
| 487 | `frontend/tests/returnsLayout.test.mjs` | frontend-root | 23 | 1.6 | Project source/support file |
| 488 | `frontend/tests/runtimeErrorClassifier.test.mjs` | frontend-root | 63 | 2.5 | Project source/support file |
| 489 | `frontend/tests/salesImportWorker.test.mjs` | frontend-root | 39 | 1.6 | Project source/support file |
| 490 | `frontend/tests/scanbotScanner.test.mjs` | frontend-root | 111 | 2.9 | Project source/support file |
| 491 | `frontend/tests/scriptTypography.test.mjs` | frontend-root | 17 | 0.8 | Project source/support file |
| 492 | `frontend/tests/sectionNavigation.test.mjs` | frontend-root | 48 | 2.4 | Project source/support file |
| 493 | `frontend/tests/settingsConflictHelpers.test.mjs` | frontend-root | 43 | 1.4 | Project source/support file |
| 494 | `frontend/tests/settingsRefresh.test.mjs` | frontend-root | 73 | 1.6 | Project source/support file |
| 495 | `frontend/tests/storagePolicy.test.mjs` | frontend-root | 42 | 1.3 | Project source/support file |
| 496 | `frontend/tests/utilsSettingsBarrel.test.mjs` | frontend-root | 19 | 1.1 | Project source/support file |
| 497 | `frontend/tsconfig.json` | frontend-root | 36 | 1.0 | Configuration/data manifest |
| 498 | `frontend/vite.config.mjs` | frontend-root | 234 | 9.1 | Project source/support file |
| 499 | `ops/scripts/architecture/generated-bulk-audit.mjs` | project-scripts | 531 | 18.8 | Project source/support file |
| 500 | `ops/scripts/architecture/language-runtime-audit.mjs` | project-scripts | 1255 | 49.0 | Project source/support file |
| 501 | `ops/scripts/architecture/organization-audit.mjs` | project-scripts | 412 | 17.2 | Project source/support file |
| 502 | `ops/scripts/architecture/phase29-audit.mjs` | project-scripts | 511 | 16.3 | Project source/support file |
| 503 | `ops/scripts/backend/schema-audit.js` | project-scripts | 444 | 14.6 | Project source/support file |
| 504 | `ops/scripts/backend/verify-data-integrity.js` | project-scripts | 300 | 10.0 | Project source/support file |
| 505 | `ops/scripts/frontend/verify-i18n.js` | project-scripts | 145 | 4.3 | Project source/support file |
| 506 | `ops/scripts/frontend/verify-performance.js` | project-scripts | 135 | 8.4 | Project source/support file |
| 507 | `ops/scripts/frontend/verify-ui.js` | project-scripts | 250 | 8.8 | Project source/support file |
| 508 | `ops/scripts/lib/fs-utils.js` | project-scripts | 170 | 4.2 | Project source/support file |
| 509 | `ops/scripts/powershell/clean-generated.ps1` | project-scripts | 199 | 5.6 | Project source/support file |
| 510 | `ops/scripts/powershell/docker-release.ps1` | project-scripts | 953 | 45.4 | Project source/support file |
| 511 | `ops/scripts/powershell/full-automation.ps1` | project-scripts | 199 | 7.3 | Project source/support file |
| 512 | `ops/scripts/powershell/runtime-bootstrap.ps1` | project-scripts | 592 | 21.6 | Project source/support file |
| 513 | `ops/scripts/powershell/start-runtime.ps1` | project-scripts | 337 | 14.8 | Project source/support file |
| 514 | `ops/scripts/powershell/tailscale-health-monitor.ps1` | project-scripts | 240 | 7.8 | Project source/support file |
| 515 | `ops/scripts/runtime/audits/audit-auth.mjs` | project-scripts | 127 | 4.5 | Project source/support file |
| 516 | `ops/scripts/runtime/audits/audit-manifest.mjs` | project-scripts | 215 | 6.4 | Project source/support file |
| 517 | `ops/scripts/runtime/audits/audit-report-html.mjs` | project-scripts | 281 | 11.0 | Project source/support file |
| 518 | `ops/scripts/runtime/audits/deep-live-audit.mjs` | project-scripts | 1401 | 52.7 | Project source/support file |
| 519 | `ops/scripts/runtime/audits/full-app-audit.mjs` | project-scripts | 584 | 26.3 | Project source/support file |
| 520 | `ops/scripts/runtime/cloudflare/rotate-cloudflare-tunnel-token.mjs` | project-scripts | 244 | 10.8 | Project source/support file |
| 521 | `ops/scripts/runtime/cloudflare/update-cloudflare-tunnel-origin.mjs` | project-scripts | 144 | 6.1 | Project source/support file |
| 522 | `ops/scripts/runtime/cloudflare/verify-cloudflare-automation.mjs` | project-scripts | 269 | 11.3 | Project source/support file |
| 523 | `ops/scripts/runtime/cloudflare/verify-r2-object-store.mjs` | project-scripts | 121 | 4.2 | Project source/support file |
| 524 | `ops/scripts/runtime/live-checks/live-check-utils.mjs` | project-scripts | 67 | 2.3 | Project source/support file |
| 525 | `ops/scripts/runtime/live-checks/phase84-branches-actions-live-check.mjs` | project-scripts | 129 | 6.0 | Project source/support file |
| 526 | `ops/scripts/runtime/live-checks/phase84-contacts-live-check.mjs` | project-scripts | 126 | 5.5 | Project source/support file |
| 527 | `ops/scripts/runtime/live-checks/phase84-files-providers-actions-live-check.mjs` | project-scripts | 125 | 5.8 | Project source/support file |
| 528 | `ops/scripts/runtime/live-checks/phase84-inventory-actions-live-check.mjs` | project-scripts | 154 | 7.6 | Project source/support file |
| 529 | `ops/scripts/runtime/live-checks/phase84-product-brands-actions-live-check.mjs` | project-scripts | 125 | 6.1 | Project source/support file |
| 530 | `ops/scripts/runtime/live-checks/phase84-product-categories-actions-live-check.mjs` | project-scripts | 119 | 5.6 | Project source/support file |
| 531 | `ops/scripts/runtime/live-checks/phase84-product-page-actions-live-check.mjs` | project-scripts | 132 | 6.0 | Project source/support file |
| 532 | `ops/scripts/runtime/live-checks/phase84-product-scanning-actions-live-check.mjs` | project-scripts | 117 | 5.6 | Project source/support file |
| 533 | `ops/scripts/runtime/live-checks/phase84-product-stock-actions-live-check.mjs` | project-scripts | 129 | 6.3 | Project source/support file |
| 534 | `ops/scripts/runtime/live-checks/phase84-product-units-actions-live-check.mjs` | project-scripts | 119 | 5.6 | Project source/support file |
| 535 | `ops/scripts/runtime/live-checks/phase84-product-variant-actions-live-check.mjs` | project-scripts | 128 | 5.5 | Project source/support file |
| 536 | `ops/scripts/runtime/live-checks/phase84-public-portal-cloudflare-check.mjs` | project-scripts | 127 | 5.8 | Project source/support file |
| 537 | `ops/scripts/runtime/live-checks/phase84-sales-actions-live-check.mjs` | project-scripts | 122 | 5.6 | Project source/support file |
| 538 | `ops/scripts/runtime/live-checks/phase84-ui-live-check.mjs` | project-scripts | 846 | 54.8 | Project source/support file |
| 539 | `ops/scripts/runtime/live-checks/phase84-users-actions-live-check.mjs` | project-scripts | 150 | 7.3 | Project source/support file |
| 540 | `ops/scripts/runtime/smoke/check-public-url.mjs` | project-scripts | 239 | 8.2 | Project source/support file |
| 541 | `ops/scripts/runtime/smoke/check-route-contract.mjs` | project-scripts | 78 | 3.7 | Project source/support file |
| 542 | `ops/scripts/runtime/smoke/live-smoke.mjs` | project-scripts | 286 | 12.4 | Project source/support file |
| 543 | `ops/scripts/runtime/storage/prune-storage.mjs` | project-scripts | 302 | 9.6 | Project source/support file |
| 544 | `ops/scripts/verification/verify-backup-reliability.js` | project-scripts | 120 | 7.6 | Project source/support file |
| 545 | `ops/scripts/verification/verify-docker-release.js` | project-scripts | 244 | 9.4 | Project source/support file |
| 546 | `ops/scripts/verification/verify-hardening-policy.js` | project-scripts | 147 | 5.4 | Project source/support file |
| 547 | `ops/scripts/verification/verify-runtime-deps.js` | project-scripts | 81 | 2.6 | Project source/support file |
| 548 | `ops/scripts/verification/verify-scale-services.js` | project-scripts | 158 | 5.4 | Project source/support file |
| 549 | `ops/scripts/verification/verify-secret-hygiene.js` | project-scripts | 55 | 2.0 | Project source/support file |
| 550 | `package.json` | project-root | 22 | 0.6 | Configuration/data manifest |
| 551 | `README.md` | project-root | 151 | 10.4 | Project documentation entrypoint |
| 552 | `run/build-release.bat` | project-scripts | 54 | 1.7 | Final Docker release build wrapper |
| 553 | `run/clean-generated.bat` | project-scripts | 60 | 1.8 | Project source/support file |
| 554 | `run/cloudflare-origin.bat` | project-scripts | 34 | 1.1 | Project source/support file |
| 555 | `run/docker/backup.bat` | project-scripts | 15 | 0.6 | Project source/support file |
| 556 | `run/docker/doctor.bat` | project-scripts | 15 | 0.5 | Project source/support file |
| 557 | `run/docker/install.bat` | project-scripts | 15 | 0.5 | Project source/support file |
| 558 | `run/docker/README.md` | project-scripts | 44 | 3.1 | Documentation |
| 559 | `run/docker/release.bat` | project-scripts | 15 | 0.5 | Project source/support file |
| 560 | `run/docker/restore.bat` | project-scripts | 29 | 1.0 | Project source/support file |
| 561 | `run/docker/rotate-cloudflare.bat` | project-scripts | 15 | 0.5 | Project source/support file |
| 562 | `run/docker/start.bat` | project-scripts | 15 | 0.6 | Project source/support file |
| 563 | `run/docker/update.bat` | project-scripts | 15 | 0.5 | Project source/support file |
| 564 | `run/full-automation.bat` | project-scripts | 22 | 0.6 | Project source/support file |
| 565 | `run/README.md` | project-scripts | 47 | 2.9 | Documentation |
| 566 | `run/setup.bat` | project-scripts | 349 | 16.9 | Project source/support file |
| 567 | `run/sh/setup.sh` | project-scripts | 116 | 3.3 | Project source/support file |
| 568 | `run/sh/start-server.sh` | project-scripts | 147 | 5.6 | Project source/support file |
| 569 | `run/sh/stop-server.sh` | project-scripts | 62 | 1.6 | Project source/support file |
| 570 | `run/start-server.bat` | project-scripts | 570 | 29.3 | Project source/support file |
| 571 | `run/stop-server.bat` | project-scripts | 183 | 8.4 | Project source/support file |
| 572 | `run/verify-local.bat` | project-scripts | 142 | 5.2 | Project source/support file |
| 573 | `Start Business OS.bat` | project-root | 38 | 1.3 | Project source/support file |
