# Backend Function Reference

Auto-generated symbol and route inventory for backend files. Regenerate with `node ops/scripts/docs/generate-doc-reference.ts`.

## 1. Coverage Summary

Total files documented: **45**

## 2. Symbol Count by File

| No. | File | Symbols | Route handlers |
|---:|---|---:|---:|
| 1 | `backend/server.js` | 23 | 0 |
| 2 | `backend/src/config/index.js` | 11 | 0 |
| 3 | `backend/src/fileAssets.js` | 61 | 0 |
| 4 | `backend/src/helpers.js` | 30 | 0 |
| 5 | `backend/src/middleware.js` | 21 | 0 |
| 6 | `backend/src/objectStore.js` | 29 | 0 |
| 7 | `backend/src/organizationContext/index.js` | 14 | 0 |
| 8 | `backend/src/postgresDatabase.js` | 14 | 0 |
| 9 | `backend/src/productBatches.js` | 34 | 0 |
| 10 | `backend/src/routes/actionHistory.js` | 12 | 5 |
| 11 | `backend/src/routes/ai.js` | 3 | 6 |
| 12 | `backend/src/routes/auth.js` | 31 | 17 |
| 13 | `backend/src/routes/branches.js` | 10 | 10 |
| 14 | `backend/src/routes/categories.js` | 2 | 4 |
| 15 | `backend/src/routes/contacts.js` | 34 | 16 |
| 16 | `backend/src/routes/customTables.js` | 9 | 6 |
| 17 | `backend/src/routes/files.js` | 3 | 3 |
| 18 | `backend/src/routes/importJobs.js` | 16 | 17 |
| 19 | `backend/src/routes/inventory.js` | 32 | 16 |
| 20 | `backend/src/routes/notifications.js` | 27 | 1 |
| 21 | `backend/src/routes/portal.js` | 60 | 11 |
| 22 | `backend/src/routes/products.js` | 64 | 12 |
| 23 | `backend/src/routes/returns.js` | 10 | 5 |
| 24 | `backend/src/routes/runtime.js` | 6 | 3 |
| 25 | `backend/src/routes/sales.js` | 24 | 7 |
| 26 | `backend/src/routes/settings.js` | 8 | 3 |
| 27 | `backend/src/routes/sync.js` | 12 | 4 |
| 28 | `backend/src/routes/system/index.js` | 44 | 38 |
| 29 | `backend/src/routes/units.js` | 3 | 0 |
| 30 | `backend/src/routes/users.js` | 26 | 16 |
| 31 | `backend/src/serverUtils.js` | 26 | 0 |
| 32 | `backend/src/services/aiGateway.js` | 17 | 0 |
| 33 | `backend/src/services/backupPackages.js` | 59 | 0 |
| 34 | `backend/src/services/firebaseAuth.js` | 22 | 0 |
| 35 | `backend/src/services/googleDriveSync/index.js` | 75 | 0 |
| 36 | `backend/src/services/googleOauth.js` | 17 | 0 |
| 37 | `backend/src/services/importJobs.js` | 175 | 0 |
| 38 | `backend/src/services/integrationDoctor.js` | 14 | 0 |
| 39 | `backend/src/services/mediaQueue.js` | 10 | 0 |
| 40 | `backend/src/services/portalAi.js` | 42 | 0 |
| 41 | `backend/src/services/verification.js` | 21 | 0 |
| 42 | `backend/src/sessionAuth.js` | 13 | 0 |
| 43 | `backend/src/systemJobs.js` | 28 | 0 |
| 44 | `backend/src/uploadReferenceCleanup.js` | 3 | 0 |
| 45 | `backend/src/websocket.js` | 1 | 0 |

## 3. Detailed Function Commentary

### 3.1 `backend/server.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `listFrontendAssetFiles` | function | 94 |
| 2 | `resolveFrontendAssetPath` | function | 104 |
| 3 | `loadCompressionMiddleware` | function | 127 |
| 4 | `applySecurityHeaders` | function | 136 |
| 5 | `applyRequestPolicy` | function | 142 |
| 6 | `applyCoreMiddleware` | function | 152 |
| 7 | `normalizeUploadFileName` | function | 166 |
| 8 | `getSafeActiveUploadPath` | function | 174 |
| 9 | `findBackupUploadFallback` | function | 183 |
| 10 | `inferUploadContentType` | function | 229 |
| 11 | `serveLocalUpload` | function | 240 |
| 12 | `getObjectStreamWithTimeout` | function | 257 |
| 13 | `mountStaticAssets` | function | 271 |
| 14 | `mountHealthRoute` | function | 336 |
| 15 | `mountApiRoutes` | function | 365 |
| 16 | `mountTransfersAlias` | function | 403 |
| 17 | `mountSpaFallback` | function | 418 |
| 18 | `mountErrorHandler` | function | 437 |
| 19 | `getStartupBanner` | function | 451 |
| 20 | `closeDatabase` | function | 476 |
| 21 | `startDatabaseMaintenanceTimer` | function | 486 |
| 22 | `registerShutdownHandlers` | function | 494 |
| 23 | `bootstrapServer` | function | 511 |

### 3.2 `backend/src/config/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.3 `backend/src/fileAssets.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.4 `backend/src/helpers.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.5 `backend/src/middleware.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.6 `backend/src/objectStore.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.7 `backend/src/organizationContext/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.8 `backend/src/postgresDatabase.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.9 `backend/src/productBatches.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.10 `backend/src/routes/actionHistory.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

#### 3.10.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 111 |
| 2 | POST | `/` | 148 |
| 3 | PATCH | `/:id` | 180 |
| 4 | POST | `/:id/undo` | 252 |
| 5 | POST | `/:id/redo` | 253 |

### 3.11 `backend/src/routes/ai.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `listProviders` | function | 19 |
| 2 | `getProviderRow` | function | 32 |
| 3 | `serializeResponseRows` | function | 244 |

#### 3.11.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/providers` | 36 |
| 2 | POST | `/providers` | 43 |
| 3 | PUT | `/providers/:id` | 98 |
| 4 | POST | `/providers/:id/test` | 165 |
| 5 | DELETE | `/providers/:id` | 209 |
| 6 | GET | `/responses` | 230 |

### 3.12 `backend/src/routes/auth.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getClientKey` | function | 91 |
| 2 | `applyRateLimit` | function | 104 |
| 3 | `getLoginLockKey` | function | 116 |
| 4 | `isReasonableCredentialLength` | function | 120 |
| 5 | `normalizeLookupText` | function | 125 |
| 6 | `isHttpUrl` | function | 129 |
| 7 | `buildPublicBaseUrl` | function | 133 |
| 8 | `isLocalOrigin` | function | 140 |
| 9 | `resolvePublicAssetBaseUrl` | function | 149 |
| 10 | `resolvePasswordResetRedirect` | function | 155 |
| 11 | `findFirstHttpUrl` | function | 168 |
| 12 | `loginIdentifierPreview` | function | 178 |
| 13 | `rejectLogin` | function | 192 |
| 14 | `getOtpSecret` | function | 214 |
| 15 | `requireOtpActor` | function | 218 |
| 16 | `getOtpTargetUser` | function | 224 |
| 17 | `buildUserPayload` | function | 239 |
| 18 | `resolveOrganizationLookup` | function | 271 |
| 19 | `findUserByIdentifier` | function | 277 |
| 20 | `getExactActiveUserById` | function | 346 |
| 21 | `normalizeOauthMode` | function | 361 |
| 22 | `isEmailIdentifier` | function | 366 |
| 23 | `getUserById` | function | 370 |
| 24 | `getSettingsSnapshot` | function | 374 |
| 25 | `getBootstrapSystemSnapshot` | function | 383 |
| 26 | `buildAuthenticatedBootstrap` | function | 415 |
| 27 | `generateTemporaryAuthPassword` | function | 444 |
| 28 | `issueAuthSession` | function | 448 |
| 29 | `updateLocalUserGoogleIdentity` | function | 459 |
| 30 | `completeGoogleLogin` | function | 608 |
| 31 | `buildOauthCallbackHtml` | function | 694 |

#### 3.12.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/verification-capabilities` | 488 |
| 2 | GET | `/bootstrap` | 501 |
| 3 | POST | `/login` | 510 |
| 4 | POST | `/oauth/start` | 586 |
| 5 | GET | `/oauth/callback` | 734 |
| 6 | POST | `/oauth/complete` | 843 |
| 7 | POST | `/oauth/unlink` | 847 |
| 8 | POST | `/otp/verify` | 869 |
| 9 | POST | `/logout` | 925 |
| 10 | POST | `/session-duration` | 933 |
| 11 | POST | `/otp/setup` | 971 |
| 12 | POST | `/otp/confirm` | 995 |
| 13 | POST | `/otp/disable` | 1030 |
| 14 | GET | `/otp/status/:userId` | 1056 |
| 15 | POST | `/password-reset/otp` | 1066 |
| 16 | POST | `/password-reset/email` | 1113 |
| 17 | POST | `/password-reset/complete` | 1143 |

### 3.13 `backend/src/routes/branches.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

#### 3.13.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 102 |
| 2 | GET | `/summary` | 107 |
| 3 | GET | `/stock-integrity` | 116 |
| 4 | POST | `/stock-integrity/repair` | 145 |
| 5 | POST | `/` | 197 |
| 6 | PUT | `/:id` | 219 |
| 7 | DELETE | `/:id` | 247 |
| 8 | GET | `/:id/stock` | 278 |
| 9 | GET | `/transfers/list` | 343 |
| 10 | POST | `/transfer` | 357 |

### 3.14 `backend/src/routes/categories.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeLookup` | function | 12 |
| 2 | `normalizeColor` | function | 16 |

#### 3.14.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 21 |
| 2 | POST | `/` | 25 |
| 3 | PUT | `/:id` | 50 |
| 4 | DELETE | `/:id` | 123 |

### 3.15 `backend/src/routes/contacts.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

#### 3.15.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/customers` | 392 |
| 2 | GET | `/customers/points-summary` | 445 |
| 3 | POST | `/customers` | 466 |
| 4 | PUT | `/customers/:id` | 489 |
| 5 | DELETE | `/customers/:id` | 510 |
| 6 | POST | `/customers/bulk-import` | 526 |
| 7 | GET | `/suppliers` | 670 |
| 8 | POST | `/suppliers` | 684 |
| 9 | PUT | `/suppliers/:id` | 704 |
| 10 | DELETE | `/suppliers/:id` | 732 |
| 11 | POST | `/suppliers/bulk-import` | 748 |
| 12 | GET | `/delivery-contacts` | 872 |
| 13 | POST | `/delivery-contacts` | 886 |
| 14 | PUT | `/delivery-contacts/:id` | 902 |
| 15 | DELETE | `/delivery-contacts/:id` | 926 |
| 16 | POST | `/delivery-contacts/bulk-import` | 942 |

### 3.16 `backend/src/routes/customTables.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `humanizeTableName` | function | 13 |
| 2 | `serializeCustomTable` | function | 21 |
| 3 | `sanitizeCustomTableName` | function | 29 |
| 4 | `resolveCustomTableRow` | function | 35 |
| 5 | `escapeIdentifier` | function | 44 |
| 6 | `normalizeCustomTableSchema` | function | 48 |
| 7 | `tableHasColumn` | function | 71 |
| 8 | `ensureCustomTableRowVersioning` | function | 75 |
| 9 | `getWritableCustomTableKeys` | function | 92 |

#### 3.16.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 102 |
| 2 | POST | `/` | 109 |
| 3 | GET | `/:name/data` | 164 |
| 4 | POST | `/:name/rows` | 174 |
| 5 | PUT | `/:name/rows/:id` | 205 |
| 6 | DELETE | `/:name/rows/:id` | 238 |

### 3.17 `backend/src/routes/files.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `parseFileAssetId` | function | 22 |
| 2 | `getFileListFilters` | function | 30 |
| 3 | `getDeviceMeta` | function | 53 |

#### 3.17.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 61 |
| 2 | POST | `/upload` | 71 |
| 3 | DELETE | `/:id` | 112 |

### 3.18 `backend/src/routes/importJobs.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

#### 3.18.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/queue/status` | 230 |
| 2 | GET | `/` | 234 |
| 3 | POST | `/` | 242 |
| 4 | GET | `/:id` | 262 |
| 5 | GET | `/:id/review` | 272 |
| 6 | PATCH | `/:id/decisions` | 288 |
| 7 | POST | `/:id/preflight` | 304 |
| 8 | POST | `/:id/csv` | 319 |
| 9 | POST | `/:id/zip` | 339 |
| 10 | POST | `/:id/images` | 360 |
| 11 | POST | `/:id/start` | 382 |
| 12 | POST | `/:id/approve` | 408 |
| 13 | POST | `/:id/cancel` | 423 |
| 14 | DELETE | `/:id` | 438 |
| 15 | POST | `/:id/delete` | 453 |
| 16 | POST | `/:id/retry` | 468 |
| 17 | GET | `/:id/errors.csv` | 492 |

### 3.19 `backend/src/routes/inventory.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

#### 3.19.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | POST | `/adjust` | 500 |
| 2 | POST | `/transfer` | 695 |
| 3 | GET | `/reasons` | 863 |
| 4 | PUT | `/reasons` | 871 |
| 5 | POST | `/move-row` | 884 |
| 6 | GET | `/products/search` | 1100 |
| 7 | GET | `/rfid/status` | 1358 |
| 8 | POST | `/rfid/tags` | 1385 |
| 9 | GET | `/rfid/tags/search` | 1422 |
| 10 | POST | `/rfid/sessions` | 1451 |
| 11 | POST | `/rfid/sessions/:id/events` | 1472 |
| 12 | GET | `/rfid/sessions/:id/review` | 1494 |
| 13 | POST | `/rfid/sessions/:id/apply` | 1514 |
| 14 | GET | `/stats` | 1597 |
| 15 | GET | `/summary` | 1611 |
| 16 | GET | `/movements` | 1779 |

### 3.20 `backend/src/routes/notifications.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

#### 3.20.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/summary` | 518 |

### 3.21 `backend/src/routes/portal.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

#### 3.21.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/config` | 1023 |
| 2 | GET | `/bootstrap` | 1027 |
| 3 | GET | `/catalog/meta` | 1038 |
| 4 | GET | `/catalog/products` | 1042 |
| 5 | GET | `/catalog/products/search` | 1047 |
| 6 | GET | `/ai/status` | 1052 |
| 7 | POST | `/ai/chat` | 1064 |
| 8 | GET | `/membership/:membershipNumber` | 1140 |
| 9 | POST | `/submissions` | 1292 |
| 10 | GET | `/submissions/review` | 1339 |
| 11 | PATCH | `/submissions/:id/review` | 1369 |

### 3.22 `backend/src/routes/products.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

#### 3.22.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/stats` | 45 |
| 2 | GET | `/search` | 823 |
| 3 | GET | `/filters` | 905 |
| 4 | GET | `/lookups/usage` | 915 |
| 5 | POST | `/lookups/replace` | 923 |
| 6 | GET | `/` | 986 |
| 7 | POST | `/variant` | 1029 |
| 8 | POST | `/` | 1109 |
| 9 | PUT | `/:id` | 1192 |
| 10 | DELETE | `/:id` | 1451 |
| 11 | POST | `/upload-image` | 1487 |
| 12 | POST | `/bulk-import` | 1505 |

### 3.23 `backend/src/routes/returns.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

#### 3.23.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/returns` | 165 |
| 2 | GET | `/returns/:id` | 224 |
| 3 | POST | `/returns` | 232 |
| 4 | POST | `/returns/supplier` | 552 |
| 5 | PATCH | `/returns/:id` | 792 |

### 3.24 `backend/src/routes/runtime.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `createProductFieldCounts` | function | 18 |
| 2 | `collectSuspiciousProductFields` | function | 26 |
| 3 | `summarizeSuspiciousProducts` | function | 36 |
| 4 | `parseJsonArray` | function | 62 |
| 5 | `summarizeSuspiciousTextValues` | function | 71 |
| 6 | `requireRuntimePermission` | function | 91 |

#### 3.24.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/version` | 87 |
| 2 | GET | `/queues/status` | 96 |
| 3 | GET | `/catalog-integrity` | 124 |

### 3.25 `backend/src/routes/sales.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

#### 3.25.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | POST | `/sales` | 328 |
| 2 | PATCH | `/sales/:id/status` | 555 |
| 3 | PATCH | `/sales/:id/customer` | 716 |
| 4 | GET | `/sales` | 810 |
| 5 | GET | `/sales/export` | 911 |
| 6 | GET | `/dashboard` | 1106 |
| 7 | GET | `/analytics` | 1229 |

### 3.26 `backend/src/routes/settings.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeLookup` | function | 21 |
| 2 | `normalizeBrandOptionsValue` | function | 25 |
| 3 | `hasSuspiciousCatalogValue` | function | 47 |
| 4 | `normalizeBrandColorMapValue` | function | 54 |
| 5 | `settingsHasUpdatedAt` | function | 83 |
| 6 | `getSettingsSnapshot` | function | 87 |
| 7 | `collectAttemptedSettings` | function | 94 |
| 8 | `getSettingsUpdatedAt` | function | 106 |

#### 3.26.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 118 |
| 2 | GET | `/meta` | 126 |
| 3 | POST | `/` | 133 |

### 3.27 `backend/src/routes/sync.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

#### 3.27.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | POST | `/outbox` | 162 |
| 2 | POST | `/files/chunks/init` | 226 |
| 3 | POST | `/files/chunks/:uploadId/chunk` | 249 |
| 4 | POST | `/files/chunks/:uploadId/complete` | 275 |

### 3.28 `backend/src/routes/system/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

#### 3.28.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/audit-logs` | 682 |
| 2 | DELETE | `/audit-logs/retention` | 744 |
| 3 | GET | `/debug/log` | 767 |
| 4 | GET | `/config` | 773 |
| 5 | GET | `/drive-sync/status` | 811 |
| 6 | GET | `/jobs/:id` | 817 |
| 7 | GET | `/jobs` | 823 |
| 8 | POST | `/jobs/:id/cancel` | 827 |
| 9 | POST | `/drive-sync/preferences` | 833 |
| 10 | POST | `/drive-sync/oauth/start` | 844 |
| 11 | GET | `/drive-sync/oauth/callback` | 888 |
| 12 | POST | `/drive-sync/disconnect` | 916 |
| 13 | POST | `/drive-sync/forget-credentials` | 925 |
| 14 | POST | `/drive-sync/jobs` | 942 |
| 15 | POST | `/drive-sync/sync-now` | 972 |
| 16 | GET | `/backups/versions` | 1020 |
| 17 | GET | `/backups/versions/list` | 1021 |
| 18 | GET | `/backups/:id` | 1023 |
| 19 | GET | `/object-storage/doctor` | 1029 |
| 20 | POST | `/object-storage/test-write` | 1037 |
| 21 | GET | `/integration-doctor` | 1045 |
| 22 | POST | `/backups` | 1058 |
| 23 | POST | `/backups/:id/restore` | 1106 |
| 24 | POST | `/reset-data` | 1131 |
| 25 | POST | `/factory-reset` | 1191 |
| 26 | POST | `/sync/push` | 1236 |
| 27 | GET | `/verify-integrity` | 1246 |
| 28 | POST | `/repair-integrity` | 1275 |
| 29 | GET | `/data-path` | 1305 |
| 30 | GET | `/storage-mode` | 1326 |
| 31 | GET | `/scale-migration/status` | 1361 |
| 32 | POST | `/scale-migration/prepare` | 1370 |
| 33 | POST | `/scale-migration/run` | 1400 |
| 34 | POST | `/data-path` | 1418 |
| 35 | DELETE | `/data-path` | 1477 |
| 36 | POST | `/browse-dir` | 1507 |
| 37 | POST | `/open-path` | 1564 |
| 38 | POST | `/pick-folder` | 1593 |

### 3.29 `backend/src/routes/units.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeLookup` | function | 13 |
| 2 | `normalizeUnitColor` | function | 17 |
| 3 | `updateUnitHandler` | function | 52 |

### 3.30 `backend/src/routes/users.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

#### 3.30.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/users` | 384 |
| 2 | GET | `/users/:id/profile` | 405 |
| 3 | GET | `/users/:id/auth-methods` | 424 |
| 4 | POST | `/users/:id/provider-disconnect` | 454 |
| 5 | POST | `/users/avatar-upload` | 541 |
| 6 | POST | `/users/:id/contact-verification/request` | 553 |
| 7 | POST | `/users/:id/contact-verification/confirm` | 557 |
| 8 | POST | `/users` | 564 |
| 9 | PUT | `/users/:id` | 661 |
| 10 | PUT | `/users/:id/profile` | 781 |
| 11 | POST | `/users/:id/change-password` | 925 |
| 12 | POST | `/users/:id/reset-password` | 968 |
| 13 | GET | `/roles` | 1006 |
| 14 | POST | `/roles` | 1016 |
| 15 | PUT | `/roles/:id` | 1034 |
| 16 | DELETE | `/roles/:id` | 1064 |

### 3.31 `backend/src/serverUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.32 `backend/src/services/aiGateway.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.33 `backend/src/services/backupPackages.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.34 `backend/src/services/firebaseAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.35 `backend/src/services/googleDriveSync/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.36 `backend/src/services/googleOauth.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.37 `backend/src/services/importJobs.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.38 `backend/src/services/integrationDoctor.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.39 `backend/src/services/mediaQueue.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.40 `backend/src/services/portalAi.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.41 `backend/src/services/verification.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.42 `backend/src/sessionAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.43 `backend/src/systemJobs.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.44 `backend/src/uploadReferenceCleanup.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `safeJsonArray` | function | 13 |
| 2 | `repairMissingUploadReferences` | function | 22 |
| 3 | `repairMissingUploadReferencesAsync` | function | 134 |

### 3.45 `backend/src/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `attachWss` | function | 24 |

