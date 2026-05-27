# Backend Function Reference

Auto-generated symbol and route inventory for backend files. Regenerate with `node ops/scripts/docs/generate-doc-reference.js`.

## 1. Coverage Summary

Total files documented: **86**

## 2. Symbol Count by File

| No. | File | Symbols | Route handlers |
|---:|---|---:|---:|
| 1 | `backend/server.js` | 23 | 0 |
| 2 | `backend/src/accessControl.js` | 18 | 0 |
| 3 | `backend/src/analytics/duckdbRuntime.js` | 3 | 0 |
| 4 | `backend/src/authOtpGuards.js` | 3 | 0 |
| 5 | `backend/src/backupSchema.js` | 4 | 0 |
| 6 | `backend/src/businessMetrics.js` | 9 | 0 |
| 7 | `backend/src/catalogTextIntegrity.js` | 5 | 0 |
| 8 | `backend/src/config/index.js` | 10 | 0 |
| 9 | `backend/src/conflictControl.js` | 6 | 0 |
| 10 | `backend/src/contactOptions.js` | 8 | 0 |
| 11 | `backend/src/database.js` | 0 | 0 |
| 12 | `backend/src/dataPath/index.js` | 9 | 0 |
| 13 | `backend/src/db/cutoverReadiness.js` | 7 | 0 |
| 14 | `backend/src/db/postgresQueryCompat.js` | 11 | 0 |
| 15 | `backend/src/fileAssets.js` | 51 | 0 |
| 16 | `backend/src/helpers.js` | 20 | 0 |
| 17 | `backend/src/idempotency.js` | 1 | 0 |
| 18 | `backend/src/importCsv.js` | 12 | 0 |
| 19 | `backend/src/importParsing.js` | 6 | 0 |
| 20 | `backend/src/initials.js` | 6 | 0 |
| 21 | `backend/src/maintenanceLock.js` | 7 | 0 |
| 22 | `backend/src/middleware.js` | 21 | 0 |
| 23 | `backend/src/money.js` | 3 | 0 |
| 24 | `backend/src/netSecurity.js` | 7 | 0 |
| 25 | `backend/src/objectStore.js` | 23 | 0 |
| 26 | `backend/src/optionalSharp.js` | 1 | 0 |
| 27 | `backend/src/organizationContext/index.js` | 14 | 0 |
| 28 | `backend/src/permissions.js` | 6 | 0 |
| 29 | `backend/src/portalUtils.js` | 6 | 0 |
| 30 | `backend/src/postgresDatabase.js` | 13 | 0 |
| 31 | `backend/src/productBatches.js` | 29 | 0 |
| 32 | `backend/src/productDiscounts.js` | 9 | 0 |
| 33 | `backend/src/productImportPolicies.js` | 8 | 0 |
| 34 | `backend/src/requestContext.js` | 5 | 0 |
| 35 | `backend/src/routes/actionHistory.js` | 11 | 5 |
| 36 | `backend/src/routes/ai.js` | 2 | 6 |
| 37 | `backend/src/routes/auth.js` | 30 | 17 |
| 38 | `backend/src/routes/branches.js` | 6 | 10 |
| 39 | `backend/src/routes/catalog.js` | 0 | 2 |
| 40 | `backend/src/routes/categories.js` | 2 | 4 |
| 41 | `backend/src/routes/contacts.js` | 23 | 16 |
| 42 | `backend/src/routes/customTables.js` | 8 | 6 |
| 43 | `backend/src/routes/files.js` | 3 | 3 |
| 44 | `backend/src/routes/importJobs.js` | 13 | 17 |
| 45 | `backend/src/routes/inventory.js` | 24 | 16 |
| 46 | `backend/src/routes/notifications.js` | 11 | 1 |
| 47 | `backend/src/routes/organizations.js` | 0 | 3 |
| 48 | `backend/src/routes/portal.js` | 40 | 11 |
| 49 | `backend/src/routes/products.js` | 54 | 12 |
| 50 | `backend/src/routes/returns.js` | 10 | 5 |
| 51 | `backend/src/routes/runtime.js` | 1 | 3 |
| 52 | `backend/src/routes/sales.js` | 23 | 7 |
| 53 | `backend/src/routes/settings.js` | 6 | 3 |
| 54 | `backend/src/routes/sync.js` | 9 | 4 |
| 55 | `backend/src/routes/system/index.js` | 29 | 38 |
| 56 | `backend/src/routes/units.js` | 3 | 0 |
| 57 | `backend/src/routes/users.js` | 23 | 16 |
| 58 | `backend/src/runtimeCache.js` | 12 | 0 |
| 59 | `backend/src/runtimeState/index.js` | 6 | 0 |
| 60 | `backend/src/runtimeVersion.js` | 7 | 0 |
| 61 | `backend/src/schemaMetadata.js` | 7 | 0 |
| 62 | `backend/src/security.js` | 13 | 0 |
| 63 | `backend/src/serverUtils.js` | 26 | 0 |
| 64 | `backend/src/services/aiGateway.js` | 14 | 0 |
| 65 | `backend/src/services/backupPackages.js` | 53 | 0 |
| 66 | `backend/src/services/firebaseAuth.js` | 22 | 0 |
| 67 | `backend/src/services/googleDriveSync/index.js` | 67 | 0 |
| 68 | `backend/src/services/googleDriveSync/versioning.js` | 5 | 0 |
| 69 | `backend/src/services/googleOauth.js` | 16 | 0 |
| 70 | `backend/src/services/importJobs.js` | 142 | 0 |
| 71 | `backend/src/services/integrationDoctor.js` | 13 | 0 |
| 72 | `backend/src/services/mediaQueue.js` | 10 | 0 |
| 73 | `backend/src/services/portalAi.js` | 29 | 0 |
| 74 | `backend/src/services/verification.js` | 21 | 0 |
| 75 | `backend/src/sessionAuth.js` | 13 | 0 |
| 76 | `backend/src/settingsSnapshot.js` | 7 | 0 |
| 77 | `backend/src/storage/organizationFolders.js` | 5 | 0 |
| 78 | `backend/src/systemFsWorker.js` | 7 | 0 |
| 79 | `backend/src/systemJobs.js` | 24 | 0 |
| 80 | `backend/src/uploadReferenceCleanup.js` | 2 | 0 |
| 81 | `backend/src/uploadSecurity.js` | 7 | 0 |
| 82 | `backend/src/websocket.js` | 1 | 0 |
| 83 | `backend/src/workers/importWorker.js` | 2 | 0 |
| 84 | `backend/src/workers/mediaWorker.js` | 2 | 0 |
| 85 | `ops/scripts/backend/schema-audit.js` | 25 | 0 |
| 86 | `ops/scripts/backend/verify-data-integrity.js` | 27 | 0 |

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

### 3.2 `backend/src/accessControl.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `trim` | function | 19 |
| 2 | `normalizeHostname` | function | 23 |
| 3 | `getConfiguredSyncToken` | function | 29 |
| 4 | `getRemoteAccessProvider` | function | 33 |
| 5 | `isLegacyTailscaleEnabled` | function | 37 |
| 6 | `getRequestHost` | function | 41 |
| 7 | `getRemoteAddress` | function | 47 |
| 8 | `isLoopbackAddress` | function | 55 |
| 9 | `getPresentedSyncToken` | function | 62 |
| 10 | `getTailscaleIdentity` | function | 68 |
| 11 | `hasTrustedTailscaleIdentity` | function | 77 |
| 12 | `isLocalHostRequest` | function | 85 |
| 13 | `isTsNetHost` | function | 90 |
| 14 | `getConfiguredTailscaleHost` | function | 95 |
| 15 | `isPublicRemoteRequest` | function | 99 |
| 16 | `isPublicApiRequest` | function | 107 |
| 17 | `classifyRequestAccess` | function | 113 |
| 18 | `authorizeProtectedRequest` | function | 142 |

### 3.3 `backend/src/analytics/duckdbRuntime.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `tryRequireDuckDbPackage` | function | 14 |
| 2 | `probeDuckDbPackage` | function | 27 |
| 3 | `getDuckDbRuntimeStatus` | function | 56 |

### 3.4 `backend/src/authOtpGuards.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeUserId` | function | 5 |
| 2 | `canManageOtpTarget` | function | 10 |
| 3 | `requiresSelfOtpDisablePassword` | function | 20 |

### 3.5 `backend/src/backupSchema.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `countRowsByTable` | function | 90 |
| 2 | `countCustomTableRows` | function | 98 |
| 3 | `buildBackupSummary` | function | 104 |
| 4 | `buildBackupSummaryFromCounts` | function | 109 |

### 3.6 `backend/src/businessMetrics.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `sellableProductWhere` | function | 5 |
| 2 | `effectiveCostExpr` | function | 12 |
| 3 | `stockQuantityExpr` | function | 18 |
| 4 | `normalizeMetricRow` | function | 22 |
| 5 | `getStockMetrics` | function | 34 |
| 6 | `getLowStockProducts` | function | 69 |
| 7 | `getOutOfStockProducts` | function | 83 |
| 8 | `getStockAlertProducts` | function | 96 |
| 9 | `getExpiringProducts` | function | 118 |

### 3.7 `backend/src/catalogTextIntegrity.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeCatalogText` | function | 7 |
| 2 | `hasSuspiciousCatalogText` | function | 18 |
| 3 | `listSuspiciousCatalogFields` | function | 28 |
| 4 | `assertCatalogTextIntegrity` | function | 35 |
| 5 | `normalizeOptionList` | function | 41 |

### 3.8 `backend/src/config/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isDefaultDataMarker` | function | 46 |
| 2 | `resolveStoredDataDir` | function | 51 |
| 3 | `normalizeSelectedDataDir` | function | 58 |
| 4 | `readDataLocation` | function | 70 |
| 5 | `writeDataLocation` | function | 81 |
| 6 | `ensureDirectory` | function | 97 |
| 7 | `readSecretFileValue` | function | 101 |
| 8 | `ensureOrganizationRuntimeLayout` | function | 113 |
| 9 | `normalizeOrganizationSeed` | function | 119 |
| 10 | `STORAGE_ROOT` | const arrow | 126 |

### 3.9 `backend/src/conflictControl.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `WriteConflictError` | class | 3 |
| 2 | `normalizeUpdatedAt` | function | 17 |
| 3 | `getExpectedUpdatedAt` | function | 22 |
| 4 | `assertUpdatedAtMatch` | function | 31 |
| 5 | `sendWriteConflict` | function | 43 |
| 6 | `sendSettingsConflict` | function | 57 |

### 3.10 `backend/src/contactOptions.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `cleanText` | function | 5 |
| 2 | `normalizeContactOption` | function | 10 |
| 3 | `hasContactOptionData` | function | 21 |
| 4 | `parseStoredContactOptions` | function | 28 |
| 5 | `parseImportContactOptions` | function | 56 |
| 6 | `serializeContactOptions` | function | 72 |
| 7 | `getPrimaryContactOption` | function | 80 |
| 8 | `buildImportedContactState` | function | 85 |

### 3.11 `backend/src/database.js`

- No top-level named function/class symbols detected.

### 3.12 `backend/src/dataPath/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizePathForCompare` | function | 9 |
| 2 | `isSamePath` | function | 15 |
| 3 | `isSubPath` | function | 19 |
| 4 | `ensureDataRootLayout` | function | 24 |
| 5 | `walkFiles` | function | 30 |
| 6 | `summarizeDataRoot` | function | 48 |
| 7 | `copyDirectoryContents` | function | 91 |
| 8 | `buildArchivedTargetPath` | function | 128 |
| 9 | `relocateDataRoot` | function | 145 |

### 3.13 `backend/src/db/cutoverReadiness.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeRelative` | function | 36 |
| 2 | `toRelative` | function | 40 |
| 3 | `shouldSkipDir` | function | 44 |
| 4 | `listJavaScriptFiles` | function | 52 |
| 5 | `analyzeFile` | function | 66 |
| 6 | `summarizeBlockers` | function | 86 |
| 7 | `analyzePostgresCutoverReadiness` | function | 103 |

### 3.14 `backend/src/db/postgresQueryCompat.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `countPositionalPlaceholders` | function | 57 |
| 2 | `stripTrailingSemicolon` | function | 82 |
| 3 | `replacePositionalParams` | function | 86 |
| 4 | `normalizePortableSqlFunctions` | function | 120 |
| 5 | `translateInsertOrIgnore` | function | 131 |
| 6 | `translateParameters` | function | 135 |
| 7 | `appendReturning` | function | 160 |
| 8 | `getInsertTableName` | function | 172 |
| 9 | `translateSql` | function | 177 |
| 10 | `coerceRowValue` | function | 195 |
| 11 | `coerceRow` | function | 208 |

### 3.15 `backend/src/fileAssets.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getDb` | function | 56 |
| 2 | `ensureUploadsDirectory` | function | 65 |
| 3 | `getMimeTypeFromName` | function | 69 |
| 4 | `getMediaType` | function | 74 |
| 5 | `sanitizeOriginalFileName` | function | 83 |
| 6 | `preserveOriginalDisplayName` | function | 96 |
| 7 | `buildUniqueStoredName` | function | 104 |
| 8 | `shouldCompressImage` | function | 121 |
| 9 | `compressBufferForAsset` | function | 127 |
| 10 | `encodeImageCandidate` | function | 211 |
| 11 | `readImageDimensions` | function | 240 |
| 12 | `getFfmpegPath` | function | 253 |
| 13 | `buildVideoOptimizationArgs` | function | 261 |
| 14 | `optimizeStoredVideo` | function | 299 |
| 15 | `createFileAssetRecord` | function | 365 |
| 16 | `getFileAssetByPublicPath` | function | 445 |
| 17 | `buildFileAssetFilterParams` | function | 454 |
| 18 | `listAssetRows` | function | 461 |
| 19 | `countAssetRows` | function | 486 |
| 20 | `writeObjectBodyToFile` | function | 506 |
| 21 | `ensureStoredAssetAvailableLocally` | function | 524 |
| 22 | `collectUploadPathsFromValue` | function | 534 |
| 23 | `pruneInvalidReferenceBackfillAssets` | function | 558 |
| 24 | `collectReferencedUploadPaths` | function | 566 |
| 25 | `add` | const arrow | 568 |
| 26 | `ensureReferencedAssetsRegistered` | function | 579 |
| 27 | `getUploadFilePath` | function | 612 |
| 28 | `toUploadPublicPathFromObjectKey` | function | 617 |
| 29 | `findUploadStorageOrphans` | function | 623 |
| 30 | `collectTrackedUploadPublicPaths` | function | 633 |
| 31 | `add` | const arrow | 635 |
| 32 | `reconcileUploadStorage` | function | 648 |
| 33 | `requestUploadStorageReconcile` | function | 710 |
| 34 | `ensureFileAssetListingWarm` | function | 714 |
| 35 | `prewarmFileAssetListing` | function | 732 |
| 36 | `deleteAllStoredUploads` | function | 741 |
| 37 | `buildInClausePlaceholders` | function | 762 |
| 38 | `collectUsagesByPublicPath` | function | 766 |
| 39 | `addUsage` | const arrow | 774 |
| 40 | `collectUsage` | function | 839 |
| 41 | `resolveBrowserPublicPath` | function | 843 |
| 42 | `serializeAssetRow` | function | 850 |
| 43 | `serializeAssetRows` | function | 864 |
| 44 | `registerStoredAsset` | function | 870 |
| 45 | `registerUploadFromRequest` | function | 947 |
| 46 | `optimizeStoredAssetFromQueue` | function | 961 |
| 47 | `storeDataUrlAsset` | function | 993 |
| 48 | `backfillUploadAssets` | function | 1019 |
| 49 | `listFileAssets` | function | 1038 |
| 50 | `getFileAssetById` | function | 1061 |
| 51 | `deleteFileAsset` | function | 1066 |

### 3.16 `backend/src/helpers.js`

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
| 11 | `parseCSVRows` | function | 198 |
| 12 | `bulkImportCSV` | function | 222 |
| 13 | `parseCSVLine` | function | 248 |
| 14 | `importRows` | function | 268 |
| 15 | `verifyAndRepairStockQuantities` | function | 283 |
| 16 | `verifyAndRepairSaleStatuses` | function | 341 |
| 17 | `verifyAndRepairCostPrices` | function | 401 |
| 18 | `runDataIntegrityCheck` | function | 483 |
| 19 | `getSafeCostPrice` | function | 510 |
| 20 | `calculateSaleProfit` | function | 521 |

### 3.17 `backend/src/idempotency.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeClientRequestId` | function | 3 |

### 3.18 `backend/src/importCsv.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `stripBom` | function | 9 |
| 2 | `normalizeDigit` | function | 13 |
| 3 | `normalizeNumericText` | function | 21 |
| 4 | `countDelimiter` | function | 28 |
| 5 | `detectCsvDelimiter` | function | 47 |
| 6 | `parseDelimitedRows` | function | 54 |
| 7 | `normalizeCsvKey` | function | 99 |
| 8 | `parseCsvRows` | function | 107 |
| 9 | `detectCsvDelimiterFromFile` | function | 126 |
| 10 | `csvValuesToRow` | function | 137 |
| 11 | `hasCsvContent` | function | 147 |
| 12 | `emitRecord` | const function | 165 |

### 3.19 `backend/src/importParsing.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeDigit` | function | 9 |
| 2 | `normalizeNumericText` | function | 17 |
| 3 | `removeCurrencyNoise` | function | 24 |
| 4 | `normalizeNumberSeparators` | function | 31 |
| 5 | `parseImportNumericValue` | function | 65 |
| 6 | `normalizeImportMoney` | function | 80 |

### 3.20 `backend/src/initials.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeInitialText` | function | 16 |
| 2 | `getInitialKey` | function | 20 |
| 3 | `getInitialType` | function | 31 |
| 4 | `compareInitialKeys` | function | 40 |
| 5 | `rank` | const arrow | 44 |
| 6 | `aggregateInitialRows` | function | 64 |

### 3.21 `backend/src/maintenanceLock.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `nowIso` | function | 5 |
| 2 | `getMaintenanceLock` | function | 9 |
| 3 | `isMaintenanceLocked` | function | 13 |
| 4 | `acquireMaintenanceLock` | function | 17 |
| 5 | `releaseMaintenanceLock` | function | 29 |
| 6 | `withMaintenanceLock` | function | 37 |
| 7 | `maintenanceWriteGuard` | function | 46 |

### 3.22 `backend/src/middleware.js`

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
| 16 | `readAuditTextValue` | function | 229 |
| 17 | `getAuditRequestMeta` | function | 235 |
| 18 | `getAuditActor` | function | 264 |
| 19 | `compressUpload` | function | 280 |
| 20 | `validateUploadedFile` | function | 298 |
| 21 | `validateUploadBufferPayload` | function | 309 |

### 3.23 `backend/src/money.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toFiniteNumber` | function | 3 |
| 2 | `roundUpToDecimals` | function | 8 |
| 3 | `normalizePriceValue` | function | 17 |

### 3.24 `backend/src/netSecurity.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `trim` | function | 26 |
| 2 | `normalizeHostname` | function | 30 |
| 3 | `isPrivateIpv4` | function | 34 |
| 4 | `isPrivateIpv6` | function | 47 |
| 5 | `isBlockedHostname` | function | 58 |
| 6 | `assertSafeOutboundUrl` | function | 69 |
| 7 | `isSafeExternalImageReference` | function | 97 |

### 3.25 `backend/src/objectStore.js`

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
| 12 | `shouldFallbackToR2Api` | function | 123 |
| 13 | `getS3Client` | function | 133 |
| 14 | `normalizeObjectKey` | function | 152 |
| 15 | `ensureBucket` | function | 156 |
| 16 | `putObject` | function | 174 |
| 17 | `sendWithTimeout` | function | 209 |
| 18 | `getObjectStream` | function | 221 |
| 19 | `deleteObject` | function | 254 |
| 20 | `deleteObjects` | function | 273 |
| 21 | `listObjects` | function | 308 |
| 22 | `testObjectStore` | function | 359 |
| 23 | `bufferToStream` | function | 374 |

### 3.26 `backend/src/optionalSharp.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadSharp` | function | 7 |

### 3.27 `backend/src/organizationContext/index.js`

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

### 3.28 `backend/src/permissions.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeKey` | function | 127 |
| 2 | `getPermissionDefinition` | function | 131 |
| 3 | `isSensitivePermissionKey` | function | 136 |
| 4 | `permissionForActionHistory` | function | 143 |
| 5 | `isSensitiveActionHistory` | function | 151 |
| 6 | `hasPermissionValue` | function | 166 |

### 3.29 `backend/src/portalUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toTrimmedString` | function | 5 |
| 2 | `safeJsonParse` | function | 9 |
| 3 | `createAboutBlock` | function | 17 |
| 4 | `normalizeAboutBlocks` | function | 28 |
| 5 | `extractGoogleMapsEmbedUrl` | function | 47 |
| 6 | `normalizeGoogleMapsEmbed` | function | 55 |

### 3.30 `backend/src/postgresDatabase.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadPgNative` | function | 13 |
| 2 | `normalizeQueryRows` | function | 30 |
| 3 | `buildRunResult` | function | 35 |
| 4 | `normalizeStatementArgs` | function | 44 |
| 5 | `PostgresCompatStatement` | class | 53 |
| 6 | `PostgresCompatDatabase` | class | 77 |
| 7 | `createPostgresDatabase` | function | 522 |
| 8 | `runDatabaseMaintenance` | function | 526 |
| 9 | `ensureCoreDataInvariants` | function | 530 |
| 10 | `ensureDefaultOrganizationAndGroup` | function | 534 |
| 11 | `ensurePrimaryAdminRoleAndUser` | function | 538 |
| 12 | `getDb` | function | 544 |
| 13 | `closeDatabase` | function | 572 |

### 3.31 `backend/src/productBatches.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeExpiryDate` | function | 23 |
| 2 | `normalizeLotCode` | function | 28 |
| 3 | `isSellableProduct` | function | 33 |
| 4 | `buildBatchKey` | function | 37 |
| 5 | `getProductById` | function | 46 |
| 6 | `getProductBatchIds` | function | 52 |
| 7 | `getBatchRowsForProduct` | function | 56 |
| 8 | `getLegacyBatchBackfillCandidates` | function | 65 |
| 9 | `createOrFindProductBatch` | function | 78 |
| 10 | `setBranchBatchQuantity` | function | 135 |
| 11 | `incrementBranchBatchQuantity` | function | 145 |
| 12 | `getBatchStockRows` | function | 156 |
| 13 | `listProductBatches` | function | 196 |
| 14 | `syncProductBatchRollups` | function | 267 |
| 15 | `migrateLegacyProductToBatches` | function | 306 |
| 16 | `migrateAllLegacyProductsToBatches` | function | 350 |
| 17 | `scheduleLegacyBatchBackfill` | function | 362 |
| 18 | `runNextChunk` | const arrow | 368 |
| 19 | `getLegacyBatchBackfillStatus` | function | 398 |
| 20 | `getAvailableProductQuantity` | function | 407 |
| 21 | `allocateProductBatches` | function | 412 |
| 22 | `increaseProductBatchStock` | function | 452 |
| 23 | `restoreBatchAllocations` | function | 469 |
| 24 | `cloneAllocationsToProduct` | function | 484 |
| 25 | `getSaleItemAllocations` | function | 508 |
| 26 | `markSaleItemAllocationsReleased` | function | 520 |
| 27 | `getAvailableSaleAllocationRows` | function | 528 |
| 28 | `getReturnItemAllocations` | function | 551 |
| 29 | `markReturnItemAllocationsReversed` | function | 563 |

### 3.32 `backend/src/productDiscounts.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeBooleanFlag` | function | 8 |
| 2 | `normalizePercent` | function | 17 |
| 3 | `normalizeDiscountType` | function | 23 |
| 4 | `normalizeHexColor` | function | 28 |
| 5 | `normalizeDateText` | function | 33 |
| 6 | `pick` | function | 41 |
| 7 | `normalizeProductDiscount` | function | 45 |
| 8 | `isDiscountActive` | function | 67 |
| 9 | `calculateDiscountedPrice` | function | 81 |

### 3.33 `backend/src/productImportPolicies.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `parseImportNumber` | function | 5 |
| 2 | `parseImportFlag` | function | 13 |
| 3 | `hasImportValue` | function | 22 |
| 4 | `normalizeFieldRule` | function | 27 |
| 5 | `splitUniqueImportValues` | function | 34 |
| 6 | `appendUniqueImportValue` | function | 50 |
| 7 | `resolveImportValue` | function | 67 |
| 8 | `normalizeImageConflictMode` | function | 81 |

### 3.34 `backend/src/requestContext.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `cleanText` | function | 7 |
| 2 | `readHeader` | function | 13 |
| 3 | `extractRequestMeta` | function | 19 |
| 4 | `requestContextMiddleware` | function | 45 |
| 5 | `getRequestMeta` | function | 50 |

### 3.35 `backend/src/routes/actionHistory.js`

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
| 11 | `completeServerHistoryTransition` | function | 206 |

#### 3.35.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 103 |
| 2 | POST | `/` | 140 |
| 3 | PATCH | `/:id` | 172 |
| 4 | POST | `/:id/undo` | 244 |
| 5 | POST | `/:id/redo` | 245 |

### 3.36 `backend/src/routes/ai.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `listProviders` | function | 19 |
| 2 | `getProviderRow` | function | 28 |

#### 3.36.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/providers` | 32 |
| 2 | POST | `/providers` | 39 |
| 3 | PUT | `/providers/:id` | 94 |
| 4 | POST | `/providers/:id/test` | 161 |
| 5 | DELETE | `/providers/:id` | 205 |
| 6 | GET | `/responses` | 226 |

### 3.37 `backend/src/routes/auth.js`

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
| 11 | `loginIdentifierPreview` | function | 171 |
| 12 | `rejectLogin` | function | 185 |
| 13 | `getOtpSecret` | function | 207 |
| 14 | `requireOtpActor` | function | 211 |
| 15 | `getOtpTargetUser` | function | 217 |
| 16 | `buildUserPayload` | function | 232 |
| 17 | `resolveOrganizationLookup` | function | 264 |
| 18 | `findUserByIdentifier` | function | 270 |
| 19 | `getExactActiveUserById` | function | 339 |
| 20 | `normalizeOauthMode` | function | 354 |
| 21 | `isEmailIdentifier` | function | 359 |
| 22 | `getUserById` | function | 363 |
| 23 | `getSettingsSnapshot` | function | 367 |
| 24 | `getBootstrapSystemSnapshot` | function | 376 |
| 25 | `buildAuthenticatedBootstrap` | function | 408 |
| 26 | `generateTemporaryAuthPassword` | function | 437 |
| 27 | `issueAuthSession` | function | 441 |
| 28 | `updateLocalUserGoogleIdentity` | function | 452 |
| 29 | `completeGoogleLogin` | function | 601 |
| 30 | `buildOauthCallbackHtml` | function | 687 |

#### 3.37.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/verification-capabilities` | 481 |
| 2 | GET | `/bootstrap` | 494 |
| 3 | POST | `/login` | 503 |
| 4 | POST | `/oauth/start` | 579 |
| 5 | GET | `/oauth/callback` | 727 |
| 6 | POST | `/oauth/complete` | 836 |
| 7 | POST | `/oauth/unlink` | 840 |
| 8 | POST | `/otp/verify` | 862 |
| 9 | POST | `/logout` | 918 |
| 10 | POST | `/session-duration` | 926 |
| 11 | POST | `/otp/setup` | 964 |
| 12 | POST | `/otp/confirm` | 988 |
| 13 | POST | `/otp/disable` | 1023 |
| 14 | GET | `/otp/status/:userId` | 1049 |
| 15 | POST | `/password-reset/otp` | 1059 |
| 16 | POST | `/password-reset/email` | 1106 |
| 17 | POST | `/password-reset/complete` | 1136 |

### 3.38 `backend/src/routes/branches.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toDbBool` | function | 12 |
| 2 | `getStockTransferNoteColumn` | function | 20 |
| 3 | `normalizePositiveInt` | function | 24 |
| 4 | `getDefaultBranch` | function | 30 |
| 5 | `getSellableProductWhere` | function | 34 |
| 6 | `buildBranchStockWhere` | function | 40 |

#### 3.38.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 65 |
| 2 | GET | `/summary` | 70 |
| 3 | GET | `/stock-integrity` | 79 |
| 4 | POST | `/stock-integrity/repair` | 109 |
| 5 | POST | `/` | 160 |
| 6 | PUT | `/:id` | 182 |
| 7 | DELETE | `/:id` | 210 |
| 8 | GET | `/:id/stock` | 241 |
| 9 | GET | `/transfers/list` | 306 |
| 10 | POST | `/transfer` | 320 |

### 3.39 `backend/src/routes/catalog.js`

- No top-level named function/class symbols detected.

#### 3.39.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/meta` | 10 |
| 2 | GET | `/products` | 27 |

### 3.40 `backend/src/routes/categories.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeLookup` | function | 12 |
| 2 | `normalizeColor` | function | 16 |

#### 3.40.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 21 |
| 2 | POST | `/` | 25 |
| 3 | PUT | `/:id` | 50 |
| 4 | DELETE | `/:id` | 123 |

### 3.41 `backend/src/routes/contacts.js`

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
| 11 | `normalizeConflictMode` | function | 103 |
| 12 | `toNumber` | function | 108 |
| 13 | `normalizePositiveInt` | function | 113 |
| 14 | `parseDateFilterParams` | function | 119 |
| 15 | `buildContactListFilters` | function | 143 |
| 16 | `parseScopedIds` | function | 169 |
| 17 | `loadPointPolicy` | function | 177 |
| 18 | `calculatePolicyPoints` | function | 203 |
| 19 | `wantsExpandedPoints` | function | 208 |
| 20 | `buildCustomerPointSummaries` | function | 213 |
| 21 | `findExisting` | const arrow | 489 |
| 22 | `findExisting` | const arrow | 704 |
| 23 | `findExisting` | const arrow | 898 |

#### 3.41.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/customers` | 295 |
| 2 | GET | `/customers/points-summary` | 357 |
| 3 | POST | `/customers` | 395 |
| 4 | PUT | `/customers/:id` | 418 |
| 5 | DELETE | `/customers/:id` | 439 |
| 6 | POST | `/customers/bulk-import` | 455 |
| 7 | GET | `/suppliers` | 599 |
| 8 | POST | `/suppliers` | 613 |
| 9 | PUT | `/suppliers/:id` | 633 |
| 10 | DELETE | `/suppliers/:id` | 661 |
| 11 | POST | `/suppliers/bulk-import` | 677 |
| 12 | GET | `/delivery-contacts` | 801 |
| 13 | POST | `/delivery-contacts` | 815 |
| 14 | PUT | `/delivery-contacts/:id` | 831 |
| 15 | DELETE | `/delivery-contacts/:id` | 855 |
| 16 | POST | `/delivery-contacts/bulk-import` | 871 |

### 3.42 `backend/src/routes/customTables.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `humanizeTableName` | function | 12 |
| 2 | `serializeCustomTable` | function | 21 |
| 3 | `sanitizeCustomTableName` | function | 29 |
| 4 | `resolveCustomTableRow` | function | 35 |
| 5 | `escapeIdentifier` | function | 44 |
| 6 | `normalizeCustomTableSchema` | function | 48 |
| 7 | `tableHasColumn` | function | 69 |
| 8 | `ensureCustomTableRowVersioning` | function | 73 |

#### 3.42.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 90 |
| 2 | POST | `/` | 95 |
| 3 | GET | `/:name/data` | 148 |
| 4 | POST | `/:name/rows` | 158 |
| 5 | PUT | `/:name/rows/:id` | 181 |
| 6 | DELETE | `/:name/rows/:id` | 206 |

### 3.43 `backend/src/routes/files.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `parseFileAssetId` | function | 22 |
| 2 | `getFileListFilters` | function | 30 |
| 3 | `getDeviceMeta` | function | 53 |

#### 3.43.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 61 |
| 2 | POST | `/upload` | 71 |
| 3 | DELETE | `/:id` | 112 |

### 3.44 `backend/src/routes/importJobs.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `permissionForImportType` | function | 34 |
| 2 | `requireImportPermission` | function | 42 |
| 3 | `hasAnyImportPermission` | function | 55 |
| 4 | `getPermittedImportTypes` | function | 59 |
| 5 | `requireAnyImportPermission` | function | 63 |
| 6 | `ensureDir` | function | 73 |
| 7 | `getJobUploadRoot` | function | 77 |
| 8 | `getJobOr404` | function | 82 |
| 9 | `isAllowedImportFile` | function | 111 |
| 10 | `parsePolicy` | function | 135 |
| 11 | `parseRelativePaths` | function | 141 |
| 12 | `shouldForceDelete` | function | 152 |
| 13 | `auditImportJobEvent` | function | 157 |

#### 3.44.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/queue/status` | 192 |
| 2 | GET | `/` | 196 |
| 3 | POST | `/` | 204 |
| 4 | GET | `/:id` | 224 |
| 5 | GET | `/:id/review` | 242 |
| 6 | PATCH | `/:id/decisions` | 258 |
| 7 | POST | `/:id/preflight` | 274 |
| 8 | POST | `/:id/csv` | 289 |
| 9 | POST | `/:id/zip` | 309 |
| 10 | POST | `/:id/images` | 330 |
| 11 | POST | `/:id/start` | 352 |
| 12 | POST | `/:id/approve` | 378 |
| 13 | POST | `/:id/cancel` | 393 |
| 14 | DELETE | `/:id` | 408 |
| 15 | POST | `/:id/delete` | 423 |
| 16 | POST | `/:id/retry` | 438 |
| 17 | GET | `/:id/errors.csv` | 462 |

### 3.45 `backend/src/routes/inventory.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeImportedTimestamp` | function | 28 |
| 2 | `recalcProductStock` | function | 36 |
| 3 | `findTransferByClientRequestId` | function | 40 |
| 4 | `getStockTransferNoteColumn` | function | 54 |
| 5 | `buildActiveBranchIndex` | function | 58 |
| 6 | `cleanMoveReason` | function | 73 |
| 7 | `normalizePositiveInt` | function | 79 |
| 8 | `cleanInventoryReasonEntry` | function | 85 |
| 9 | `loadSavedInventoryReasons` | function | 99 |
| 10 | `persistSavedInventoryReasons` | function | 113 |
| 11 | `splitSearchTerms` | function | 131 |
| 12 | `normalizeMovementDisplayText` | function | 143 |
| 13 | `sanitizeInventoryResponseProduct` | function | 154 |
| 14 | `appendInventoryProductFilters` | function | 167 |
| 15 | `hydrateInventoryProducts` | function | 220 |
| 16 | `buildInventoryFinancialJoinSql` | function | 240 |
| 17 | `inventoryFinancialSelectSql` | function | 346 |
| 18 | `getFilteredInventoryStats` | function | 360 |
| 19 | `normalizeRfidId` | function | 1161 |
| 20 | `getRfidSession` | function | 1165 |
| 21 | `getBranchLedgerQty` | function | 1169 |
| 22 | `refreshRfidSessionCounts` | function | 1173 |
| 23 | `upsertRfidSessionItem` | function | 1208 |
| 24 | `recordRfidEvent` | function | 1233 |

#### 3.45.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | POST | `/adjust` | 411 |
| 2 | POST | `/transfer` | 637 |
| 3 | GET | `/reasons` | 806 |
| 4 | PUT | `/reasons` | 814 |
| 5 | POST | `/move-row` | 827 |
| 6 | GET | `/products/search` | 1039 |
| 7 | GET | `/rfid/status` | 1288 |
| 8 | POST | `/rfid/tags` | 1315 |
| 9 | GET | `/rfid/tags/search` | 1352 |
| 10 | POST | `/rfid/sessions` | 1381 |
| 11 | POST | `/rfid/sessions/:id/events` | 1402 |
| 12 | GET | `/rfid/sessions/:id/review` | 1417 |
| 13 | POST | `/rfid/sessions/:id/apply` | 1437 |
| 14 | GET | `/stats` | 1518 |
| 15 | GET | `/summary` | 1533 |
| 16 | GET | `/movements` | 1702 |

### 3.46 `backend/src/routes/notifications.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeBoolean` | function | 23 |
| 2 | `toNumber` | function | 31 |
| 3 | `loadNotificationPreferences` | function | 36 |
| 4 | `loadPointPolicy` | function | 62 |
| 5 | `calculatePolicyPoints` | function | 88 |
| 6 | `buildInventorySection` | function | 93 |
| 7 | `buildExpirySection` | function | 137 |
| 8 | `buildSalesSection` | function | 171 |
| 9 | `buildLoyaltySection` | function | 238 |
| 10 | `buildPortalSection` | function | 325 |
| 11 | `buildSystemSection` | function | 362 |

#### 3.46.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/summary` | 392 |

### 3.47 `backend/src/routes/organizations.js`

- No top-level named function/class symbols detected.

#### 3.47.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/bootstrap` | 15 |
| 2 | GET | `/search` | 27 |
| 3 | GET | `/current` | 33 |

### 3.48 `backend/src/routes/portal.js`

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
| 11 | `normalizePortalTranslations` | function | 107 |
| 12 | `normalizeProductIdList` | function | 121 |
| 13 | `loadSettingsMap` | function | 136 |
| 14 | `buildPortalConfig` | function | 144 |
| 15 | `buildRankMap` | function | 270 |
| 16 | `getPortalProductSignals` | function | 289 |
| 17 | `getPortalProductAssets` | function | 386 |
| 18 | `buildPortalProductPayload` | function | 426 |
| 19 | `calculatePointsValue` | function | 444 |
| 20 | `summarizePoints` | function | 454 |
| 21 | `getPortalProducts` | function | 494 |
| 22 | `cacheTtl` | function | 533 |
| 23 | `normalizePositiveInt` | function | 537 |
| 24 | `splitSearchTerms` | function | 543 |
| 25 | `splitFilterValues` | function | 552 |
| 26 | `appendPortalProductSearchFilters` | function | 561 |
| 27 | `getPortalCatalogSearchMetadata` | function | 629 |
| 28 | `distinctField` | const arrow | 634 |
| 29 | `getPortalCatalogProductPage` | function | 658 |
| 30 | `getCachedPortalConfig` | function | 721 |
| 31 | `getCachedPortalMeta` | function | 725 |
| 32 | `getCachedPortalProducts` | function | 729 |
| 33 | `getPortalCatalogMeta` | function | 734 |
| 34 | `findCustomerByMembership` | function | 780 |
| 35 | `sanitizeScreenshots` | function | 790 |
| 36 | `materializePortalScreenshots` | function | 799 |
| 37 | `sanitizeAiProfile` | function | 817 |
| 38 | `getVisitorFingerprint` | function | 829 |
| 39 | `getClientKey` | function | 835 |
| 40 | `applyPortalRateLimit` | function | 840 |

#### 3.48.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/config` | 848 |
| 2 | GET | `/bootstrap` | 852 |
| 3 | GET | `/catalog/meta` | 863 |
| 4 | GET | `/catalog/products` | 867 |
| 5 | GET | `/catalog/products/search` | 872 |
| 6 | GET | `/ai/status` | 877 |
| 7 | POST | `/ai/chat` | 889 |
| 8 | GET | `/membership/:membershipNumber` | 965 |
| 9 | POST | `/submissions` | 1128 |
| 10 | GET | `/submissions/review` | 1175 |
| 11 | PATCH | `/submissions/:id/review` | 1208 |

### 3.49 `backend/src/routes/products.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getActiveBranches` | function | 53 |
| 2 | `settingsHasUpdatedAt` | function | 57 |
| 3 | `getDefaultBranch` | function | 61 |
| 4 | `seedBranchRows` | function | 65 |
| 5 | `recalcProductStock` | function | 70 |
| 6 | `normalizeImageGallery` | function | 74 |
| 7 | `syncProductImageGallery` | function | 81 |
| 8 | `loadProductImageMap` | function | 99 |
| 9 | `attachImageGallery` | function | 117 |
| 10 | `findProductByClientRequestId` | function | 129 |
| 11 | `assertUniqueProductFields` | function | 139 |
| 12 | `normalizeProductIdentifier` | function | 187 |
| 13 | `hasOwnField` | function | 192 |
| 14 | `pickField` | function | 196 |
| 15 | `ensureParentProductExists` | function | 200 |
| 16 | `markParentProductAsGroup` | function | 210 |
| 17 | `normalizeImportLookup` | function | 215 |
| 18 | `normalizeLookup` | function | 219 |
| 19 | `normalizeImportFlagValue` | function | 223 |
| 20 | `getProductImportDetailSignature` | function | 256 |
| 21 | `chooseImportParentProduct` | function | 266 |
| 22 | `normalizeImportAction` | function | 281 |
| 23 | `parseOptionalImportId` | function | 289 |
| 24 | `discountInsertColumns` | function | 296 |
| 25 | `discountValues` | function | 300 |
| 26 | `normalizeExpiryFields` | function | 315 |
| 27 | `normalizeBatchFields` | function | 326 |
| 28 | `seedOpeningBatch` | function | 333 |
| 29 | `normalizePositiveInt` | function | 348 |
| 30 | `parseInclude` | function | 354 |
| 31 | `splitSearchTerms` | function | 358 |
| 32 | `getProductCatalogSnapshotVersion` | function | 366 |
| 33 | `parseBrandOptionsSetting` | function | 379 |
| 34 | `sanitizeProductLookupPayload` | function | 385 |
| 35 | `buildLookupUsageEntries` | function | 398 |
| 36 | `buildLookupUsageSummary` | function | 460 |
| 37 | `appendProductSearchFilters` | function | 487 |
| 38 | `getProductSearchMetadata` | function | 562 |
| 39 | `distinctField` | const arrow | 567 |
| 40 | `attachBranchStock` | function | 591 |
| 41 | `expandProductFamilyRows` | function | 618 |
| 42 | `bindList` | const arrow | 637 |
| 43 | `normalizeLookup` | const arrow | 1324 |
| 44 | `resolveImage` | const arrow | 1436 |
| 45 | `ensureCategory` | const arrow | 1452 |
| 46 | `ensureUnit` | const arrow | 1467 |
| 47 | `ensureBrand` | const arrow | 1482 |
| 48 | `ensureSupplier` | const arrow | 1495 |
| 49 | `determineBranch` | const arrow | 1507 |
| 50 | `handleBranch` | const arrow | 1527 |
| 51 | `isDirectImageRef` | const arrow | 1563 |
| 52 | `normalizeDirectImageRef` | const arrow | 1574 |
| 53 | `parseIncomingImageRefs` | const arrow | 1581 |
| 54 | `loadCurrentGallery` | const arrow | 1614 |

#### 3.49.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/stats` | 45 |
| 2 | GET | `/search` | 676 |
| 3 | GET | `/filters` | 746 |
| 4 | GET | `/lookups/usage` | 756 |
| 5 | POST | `/lookups/replace` | 764 |
| 6 | GET | `/` | 816 |
| 7 | POST | `/variant` | 848 |
| 8 | POST | `/` | 928 |
| 9 | PUT | `/:id` | 1011 |
| 10 | DELETE | `/:id` | 1265 |
| 11 | POST | `/upload-image` | 1301 |
| 12 | POST | `/bulk-import` | 1319 |

### 3.50 `backend/src/routes/returns.js`

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
| 10 | `assertSupplierReturnableStock` | function | 515 |

#### 3.50.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/returns` | 165 |
| 2 | GET | `/returns/:id` | 217 |
| 3 | POST | `/returns` | 225 |
| 4 | POST | `/returns/supplier` | 532 |
| 5 | PATCH | `/returns/:id` | 762 |

### 3.51 `backend/src/routes/runtime.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `requireRuntimePermission` | function | 19 |

#### 3.51.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/version` | 15 |
| 2 | GET | `/queues/status` | 24 |
| 3 | GET | `/catalog-integrity` | 52 |

### 3.52 `backend/src/routes/sales.js`

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
| 11 | `findCustomerForSaleAssignment` | function | 142 |
| 12 | `parseBranchId` | function | 163 |
| 13 | `getActiveBranchContext` | function | 168 |
| 14 | `requireActiveBranch` | function | 183 |
| 15 | `resolveSaleItemBranchId` | function | 190 |
| 16 | `normalizeSaleItems` | function | 201 |
| 17 | `summarizeSaleBranch` | function | 231 |
| 18 | `refreshProductStockQuantity` | function | 255 |
| 19 | `refreshProductStockQuantities` | function | 259 |
| 20 | `deductBranchStock` | function | 266 |
| 21 | `restoreBranchStock` | function | 274 |
| 22 | `fetchSaleItemsWithBranches` | function | 282 |
| 23 | `findSaleByClientRequestId` | function | 291 |

#### 3.52.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | POST | `/sales` | 302 |
| 2 | PATCH | `/sales/:id/status` | 520 |
| 3 | PATCH | `/sales/:id/customer` | 681 |
| 4 | GET | `/sales` | 775 |
| 5 | GET | `/sales/export` | 869 |
| 6 | GET | `/dashboard` | 1037 |
| 7 | GET | `/analytics` | 1160 |

### 3.53 `backend/src/routes/settings.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeLookup` | function | 20 |
| 2 | `normalizeBrandOptionsValue` | function | 24 |
| 3 | `normalizeBrandColorMapValue` | function | 44 |
| 4 | `settingsHasUpdatedAt` | function | 68 |
| 5 | `getSettingsSnapshot` | function | 72 |
| 6 | `getSettingsUpdatedAt` | function | 79 |

#### 3.53.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 91 |
| 2 | GET | `/meta` | 99 |
| 3 | POST | `/` | 106 |

### 3.54 `backend/src/routes/sync.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `stableStringify` | function | 47 |
| 2 | `sha256` | function | 53 |
| 3 | `verifyOperationDigest` | function | 57 |
| 4 | `normalizeOperation` | function | 64 |
| 5 | `hasWriteConflict` | function | 77 |
| 6 | `buildReplayUrl` | function | 84 |
| 7 | `replayOperation` | function | 88 |
| 8 | `getUploadDir` | function | 182 |
| 9 | `readManifest` | function | 186 |

#### 3.54.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | POST | `/outbox` | 126 |
| 2 | POST | `/files/chunks/init` | 190 |
| 3 | POST | `/files/chunks/:uploadId/chunk` | 213 |
| 4 | POST | `/files/chunks/:uploadId/complete` | 239 |

### 3.55 `backend/src/routes/system/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `auditWithActorMeta` | function | 86 |
| 2 | `q` | function | 104 |
| 3 | `getClientKey` | function | 108 |
| 4 | `applyRouteRateLimit` | function | 114 |
| 5 | `stopImportsBeforeDestructiveAction` | function | 126 |
| 6 | `runFsWorker` | function | 141 |
| 7 | `finish` | const arrow | 153 |
| 8 | `getHostUiAvailability` | function | 197 |
| 9 | `buildRequestBaseUrl` | function | 206 |
| 10 | `resolveDriveRedirectUri` | function | 213 |
| 11 | `getSafeTableCount` | function | 220 |
| 12 | `buildMigrationTableCounts` | function | 228 |
| 13 | `safeJsonParse` | function | 248 |
| 14 | `readSystemSettings` | function | 257 |
| 15 | `writeSystemSettings` | function | 268 |
| 16 | `getMigrationSafetyBackupDestination` | function | 284 |
| 17 | `getMigrationSafetyState` | function | 288 |
| 18 | `createMigrationSafetyBackup` | function | 310 |
| 19 | `runMigrationSafetyDriveSync` | function | 327 |
| 20 | `runMigrationSafetyAutomation` | function | 365 |
| 21 | `buildScaleMigrationStatus` | function | 380 |
| 22 | `readFinalBackupManifest` | function | 449 |
| 23 | `getCustomTableNames` | function | 453 |
| 24 | `getDefaultBackupDestinationDir` | function | 459 |
| 25 | `createFolderBackup` | function | 465 |
| 26 | `restoreFolderBackup` | function | 502 |
| 27 | `sendBackupVersions` | function | 872 |
| 28 | `listWindowsFsRoots` | const arrow | 1372 |
| 29 | `listDriveRoots` | const arrow | 1389 |

#### 3.55.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/audit-logs` | 547 |
| 2 | DELETE | `/audit-logs/retention` | 609 |
| 3 | GET | `/debug/log` | 632 |
| 4 | GET | `/config` | 638 |
| 5 | GET | `/drive-sync/status` | 676 |
| 6 | GET | `/jobs/:id` | 682 |
| 7 | GET | `/jobs` | 688 |
| 8 | POST | `/jobs/:id/cancel` | 692 |
| 9 | POST | `/drive-sync/preferences` | 698 |
| 10 | POST | `/drive-sync/oauth/start` | 709 |
| 11 | GET | `/drive-sync/oauth/callback` | 753 |
| 12 | POST | `/drive-sync/disconnect` | 781 |
| 13 | POST | `/drive-sync/forget-credentials` | 790 |
| 14 | POST | `/drive-sync/jobs` | 807 |
| 15 | POST | `/drive-sync/sync-now` | 837 |
| 16 | GET | `/backups/versions` | 880 |
| 17 | GET | `/backups/versions/list` | 881 |
| 18 | GET | `/backups/:id` | 883 |
| 19 | GET | `/object-storage/doctor` | 889 |
| 20 | POST | `/object-storage/test-write` | 897 |
| 21 | GET | `/integration-doctor` | 905 |
| 22 | POST | `/backups` | 918 |
| 23 | POST | `/backups/:id/restore` | 966 |
| 24 | POST | `/reset-data` | 991 |
| 25 | POST | `/factory-reset` | 1051 |
| 26 | POST | `/sync/push` | 1098 |
| 27 | GET | `/verify-integrity` | 1108 |
| 28 | POST | `/repair-integrity` | 1137 |
| 29 | GET | `/data-path` | 1167 |
| 30 | GET | `/storage-mode` | 1188 |
| 31 | GET | `/scale-migration/status` | 1223 |
| 32 | POST | `/scale-migration/prepare` | 1232 |
| 33 | POST | `/scale-migration/run` | 1262 |
| 34 | POST | `/data-path` | 1280 |
| 35 | DELETE | `/data-path` | 1339 |
| 36 | POST | `/browse-dir` | 1369 |
| 37 | POST | `/open-path` | 1436 |
| 38 | POST | `/pick-folder` | 1465 |

### 3.56 `backend/src/routes/units.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeLookup` | function | 13 |
| 2 | `normalizeUnitColor` | function | 17 |
| 3 | `updateUnitHandler` | function | 52 |

### 3.57 `backend/src/routes/users.js`

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
| 19 | `isValidEmail` | function | 306 |
| 20 | `getAuthIdentityList` | function | 311 |
| 21 | `isUuid` | function | 317 |
| 22 | `resolveAuthIdentityUuid` | function | 321 |
| 23 | `buildAuthMethodsPayload` | function | 330 |

#### 3.57.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/users` | 362 |
| 2 | GET | `/users/:id/profile` | 383 |
| 3 | GET | `/users/:id/auth-methods` | 402 |
| 4 | POST | `/users/:id/provider-disconnect` | 432 |
| 5 | POST | `/users/avatar-upload` | 519 |
| 6 | POST | `/users/:id/contact-verification/request` | 531 |
| 7 | POST | `/users/:id/contact-verification/confirm` | 535 |
| 8 | POST | `/users` | 542 |
| 9 | PUT | `/users/:id` | 639 |
| 10 | PUT | `/users/:id/profile` | 759 |
| 11 | POST | `/users/:id/change-password` | 903 |
| 12 | POST | `/users/:id/reset-password` | 946 |
| 13 | GET | `/roles` | 984 |
| 14 | POST | `/roles` | 994 |
| 15 | PUT | `/roles/:id` | 1012 |
| 16 | DELETE | `/roles/:id` | 1042 |

### 3.58 `backend/src/runtimeCache.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `enabled` | function | 17 |
| 2 | `namespacedKey` | function | 21 |
| 3 | `getClient` | function | 26 |
| 4 | `getJson` | function | 64 |
| 5 | `setJson` | function | 77 |
| 6 | `getOrSetJson` | function | 90 |
| 7 | `deleteByPrefix` | function | 98 |
| 8 | `deletePrefixesInOrder` | function | 117 |
| 9 | `prefixesForChannel` | function | 125 |
| 10 | `invalidateForChannel` | function | 146 |
| 11 | `pingRuntimeCache` | function | 155 |
| 12 | `getRuntimeCacheStatus` | function | 166 |

### 3.59 `backend/src/runtimeState/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ensureRuntimeMetaDir` | function | 11 |
| 2 | `readRuntimeState` | function | 15 |
| 3 | `writeRuntimeState` | function | 32 |
| 4 | `getRuntimeState` | function | 38 |
| 5 | `bumpStorageVersion` | function | 48 |
| 6 | `buildRuntimeDescriptor` | function | 57 |

### 3.60 `backend/src/runtimeVersion.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `firstExistingDir` | function | 11 |
| 2 | `readGitRevision` | function | 15 |
| 3 | `collectFiles` | function | 30 |
| 4 | `computeSourceHash` | function | 44 |
| 5 | `emptyFrontendBuildInfo` | function | 69 |
| 6 | `readFrontendBuildInfoFromRoot` | function | 77 |
| 7 | `getRuntimeVersion` | function | 112 |

### 3.61 `backend/src/schemaMetadata.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeName` | function | 8 |
| 2 | `columnKey` | function | 12 |
| 3 | `candidateKey` | function | 16 |
| 4 | `listColumns` | function | 20 |
| 5 | `hasColumn` | function | 30 |
| 6 | `firstExistingColumn` | function | 44 |
| 7 | `markColumnPresent` | function | 61 |

### 3.62 `backend/src/security.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.63 `backend/src/serverUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `buildOriginFromParts` | function | 13 |
| 2 | `parseOriginHost` | function | 24 |
| 3 | `normalizeConfiguredHost` | function | 34 |
| 4 | `getConfiguredPublicHosts` | function | 44 |
| 5 | `getConfiguredCustomerPortalHosts` | function | 52 |
| 6 | `isConfiguredCustomerPortalHost` | function | 59 |
| 7 | `isAllowedRequestOrigin` | function | 69 |
| 8 | `isAllowedWebSocketOrigin` | function | 78 |
| 9 | `hostIsLoopbackPair` | function | 95 |
| 10 | `getTrustedDocumentOrigins` | function | 100 |
| 11 | `addOrigin` | const arrow | 102 |
| 12 | `buildPermissionsPolicy` | function | 131 |
| 13 | `getCloudflareAccessDiagnostics` | function | 158 |
| 14 | `sanitizeObjectKeys` | function | 184 |
| 15 | `sanitizeStringValue` | function | 203 |
| 16 | `sanitizeRequestPayload` | function | 209 |
| 17 | `sanitizeDeepStrings` | function | 216 |
| 18 | `isApiOrHealthPath` | function | 233 |
| 19 | `isSpaFallbackEligible` | function | 237 |
| 20 | `setNoStoreHeaders` | function | 245 |
| 21 | `setHtmlNoCacheHeaders` | function | 251 |
| 22 | `isCustomerPortalRoutePath` | function | 258 |
| 23 | `setTunnelSecurityHeaders` | function | 263 |
| 24 | `setFrontendStaticHeaders` | function | 306 |
| 25 | `setUploadStaticHeaders` | function | 356 |
| 26 | `mapServerError` | function | 366 |

### 3.64 `backend/src/services/aiGateway.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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
| 11 | `buildProviderHttpError` | function | 177 |
| 12 | `host` | const arrow | 180 |
| 13 | `callChatProvider` | function | 193 |
| 14 | `testProviderConfig` | function | 285 |

### 3.65 `backend/src/services/backupPackages.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readCachedBackupVersions` | function | 30 |
| 2 | `writeCachedBackupVersions` | function | 39 |
| 3 | `clearBackupVersionCaches` | function | 47 |
| 4 | `getDb` | function | 52 |
| 5 | `q` | function | 56 |
| 6 | `nowSafeId` | function | 60 |
| 7 | `sha256` | function | 64 |
| 8 | `createSha256` | function | 68 |
| 9 | `sha256File` | function | 72 |
| 10 | `readTableRows` | function | 82 |
| 11 | `yieldToEventLoop` | function | 99 |
| 12 | `throwIfAborted` | function | 103 |
| 13 | `getManagedWritableState` | function | 111 |
| 14 | `writeStream` | function | 142 |
| 15 | `closeWriteStream` | function | 156 |
| 16 | `handleFinish` | const arrow | 160 |
| 17 | `handleError` | const arrow | 165 |
| 18 | `cleanup` | const arrow | 169 |
| 19 | `createProgressReporter` | function | 179 |
| 20 | `getSafeTableCount` | function | 218 |
| 21 | `streamBackupDataFile` | function | 226 |
| 22 | `buildObjectManifest` | function | 286 |
| 23 | `buildPackageMetadata` | function | 303 |
| 24 | `writeTextFileWithChecksum` | function | 357 |
| 25 | `writeJsonLinesFileWithChecksum` | function | 362 |
| 26 | `uploadPackageFile` | function | 375 |
| 27 | `writeAndUploadMetadataFiles` | function | 395 |
| 28 | `retryOperation` | function | 421 |
| 29 | `writeDestinationChunk` | function | 436 |
| 30 | `endDestination` | function | 449 |
| 31 | `handleFinish` | const arrow | 453 |
| 32 | `handleError` | const arrow | 458 |
| 33 | `cleanup` | const arrow | 462 |
| 34 | `copyOnePackageObject` | function | 472 |
| 35 | `abortCopy` | const arrow | 484 |
| 36 | `copyPackageObjects` | function | 511 |
| 37 | `worker` | function | 520 |
| 38 | `createFinalBackupPackage` | function | 562 |
| 39 | `validateLocalBackupPackage` | function | 677 |
| 40 | `getLocalBackupRoot` | function | 701 |
| 41 | `isDockerReleaseBackupRoot` | function | 706 |
| 42 | `isLocalBackupDirectoryName` | function | 711 |
| 43 | `listLocalBackupDirectories` | function | 717 |
| 44 | `getDirectoryBytes` | function | 737 |
| 45 | `planBackupPackageRetention` | function | 763 |
| 46 | `pruneLocalBackupVersions` | function | 780 |
| 47 | `groupRemoteBackupObjects` | function | 806 |
| 48 | `pruneRemoteBackupVersions` | function | 828 |
| 49 | `pruneBackupVersions` | function | 855 |
| 50 | `readReusableLocalBackupPackage` | function | 872 |
| 51 | `findReusableLocalBackupPackage` | function | 897 |
| 52 | `listLocalBackupVersions` | function | 908 |
| 53 | `listBackupVersions` | function | 938 |

### 3.66 `backend/src/services/firebaseAuth.js`

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

### 3.67 `backend/src/services/googleDriveSync/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `nowIso` | function | 80 |
| 2 | `trim` | function | 84 |
| 3 | `toBool` | function | 88 |
| 4 | `clamp` | function | 96 |
| 5 | `escapeDriveQueryValue` | function | 102 |
| 6 | `readSettingsMap` | function | 106 |
| 7 | `writeSettingsMap` | function | 116 |
| 8 | `clearDriveSyncMappings` | function | 134 |
| 9 | `resetDriveSyncRootState` | function | 138 |
| 10 | `getDriveSyncConfig` | function | 148 |
| 11 | `getDriveSyncEntriesMap` | function | 184 |
| 12 | `upsertDriveSyncEntry` | function | 196 |
| 13 | `deleteDriveSyncEntry` | function | 233 |
| 14 | `deleteDriveSyncEntriesUnder` | function | 237 |
| 15 | `inferMimeType` | function | 244 |
| 16 | `hashFile` | function | 259 |
| 17 | `hashFileMany` | function | 269 |
| 18 | `yieldToEventLoop` | function | 289 |
| 19 | `sleep` | function | 293 |
| 20 | `buildAccessTokenKey` | function | 297 |
| 21 | `clearCachedAccessToken` | function | 304 |
| 22 | `describeFetchFailure` | function | 311 |
| 23 | `fetchWithTimeout` | function | 325 |
| 24 | `exchangeRefreshToken` | function | 352 |
| 25 | `exchangeAuthorizationCode` | function | 394 |
| 26 | `driveApiRequest` | function | 417 |
| 27 | `driveApiUpload` | function | 434 |
| 28 | `fetchDriveUserProfile` | function | 450 |
| 29 | `findDriveItem` | function | 465 |
| 30 | `findDriveItems` | function | 470 |
| 31 | `listDriveChildren` | function | 485 |
| 32 | `getDriveFileIfExists` | function | 494 |
| 33 | `removeDuplicateDriveItems` | function | 506 |
| 34 | `createDriveFolder` | function | 518 |
| 35 | `ensureRootFolder` | function | 530 |
| 36 | `ensureDriveVersionFolder` | function | 549 |
| 37 | `writeSnapshotManifest` | function | 596 |
| 38 | `buildManagedSnapshotRoot` | function | 630 |
| 39 | `ensureSnapshotLayout` | function | 634 |
| 40 | `shouldSkipSnapshotFile` | function | 640 |
| 41 | `createDataRootSnapshot` | function | 647 |
| 42 | `collectSnapshotItems` | function | 689 |
| 43 | `ensureRemoteDirectories` | function | 739 |
| 44 | `updateRuntimeUploadProgress` | function | 790 |
| 45 | `clearRuntimeUploadProgress` | function | 797 |
| 46 | `initiateDriveResumableSession` | function | 804 |
| 47 | `queryResumableOffset` | function | 832 |
| 48 | `isInvalidUploadRequest` | function | 860 |
| 49 | `isDriveNotFoundError` | function | 864 |
| 50 | `isDriveWriteAccessError` | function | 868 |
| 51 | `canRecoverDriveItemWrite` | function | 876 |
| 52 | `putResumableChunk` | function | 880 |
| 53 | `uploadDriveFileResumable` | function | 915 |
| 54 | `uploadDriveFile` | function | 989 |
| 55 | `updateDriveFile` | function | 994 |
| 56 | `removeDriveFile` | function | 999 |
| 57 | `runDriveSync` | function | 1011 |
| 58 | `runDriveSyncInternal` | function | 1022 |
| 59 | `scheduleDriveSync` | function | 1267 |
| 60 | `getDriveSyncStatus` | function | 1289 |
| 61 | `beginGoogleDriveOAuth` | function | 1338 |
| 62 | `prunePendingOauthStates` | function | 1362 |
| 63 | `finalizeGoogleDriveOAuth` | function | 1369 |
| 64 | `saveDriveSyncPreferences` | function | 1412 |
| 65 | `disconnectDriveSync` | function | 1433 |
| 66 | `forgetDriveSyncCredentials` | function | 1453 |
| 67 | `schedulePeriodicDriveSync` | function | 1461 |

### 3.68 `backend/src/services/googleDriveSync/versioning.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toSafeDate` | function | 7 |
| 2 | `toSafeVersionNumber` | function | 12 |
| 3 | `resolveDriveSyncVersionState` | function | 17 |
| 4 | `parseVersionName` | function | 56 |
| 5 | `selectExpiredDriveSyncVersions` | function | 61 |

### 3.69 `backend/src/services/googleOauth.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `trim` | function | 27 |
| 2 | `unique` | function | 31 |
| 3 | `getGoogleLoginOrigins` | function | 35 |
| 4 | `getGoogleLoginRedirectUris` | function | 44 |
| 5 | `getPrimaryRedirectUri` | function | 52 |
| 6 | `getDefaultReturnPath` | function | 56 |
| 7 | `normalizeReturnTarget` | function | 62 |
| 8 | `base64url` | function | 99 |
| 9 | `sha256Base64Url` | function | 104 |
| 10 | `getStateSecret` | function | 108 |
| 11 | `signState` | function | 112 |
| 12 | `verifyState` | function | 118 |
| 13 | `getGoogleLoginPublicConfig` | function | 134 |
| 14 | `buildGoogleOauthStartUrl` | function | 147 |
| 15 | `exchangeGoogleOauthCode` | function | 178 |
| 16 | `getGoogleUserFromTokens` | function | 201 |

### 3.70 `backend/src/services/importJobs.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `nowIso` | function | 62 |
| 2 | `wait` | function | 66 |
| 3 | `yieldImportWorker` | function | 70 |
| 4 | `countCsvRowsFromFile` | function | 75 |
| 5 | `safeJson` | function | 120 |
| 6 | `stringify` | function | 125 |
| 7 | `cleanAuditActorText` | function | 129 |
| 8 | `normalizeAuditActor` | function | 135 |
| 9 | `attachInternalPolicyMetadata` | function | 145 |
| 10 | `stripInternalPolicyMetadata` | function | 156 |
| 11 | `getPersistedAuditActor` | function | 162 |
| 12 | `mergeAuditActors` | function | 167 |
| 13 | `auditWithActor` | function | 177 |
| 14 | `decorateImportJobRow` | function | 195 |
| 15 | `isCancelRequested` | function | 205 |
| 16 | `isImportJobStale` | function | 212 |
| 17 | `isImportJobWorkDrained` | function | 218 |
| 18 | `markStoredImportFilesCancelled` | function | 230 |
| 19 | `reconcileImportJobRow` | function | 240 |
| 20 | `ensureDir` | function | 261 |
| 21 | `ensureImportRoot` | function | 265 |
| 22 | `getJobRoot` | function | 269 |
| 23 | `assertSafeImportPath` | function | 273 |
| 24 | `deleteImportJobFiles` | function | 282 |
| 25 | `clearImportRuntimeFiles` | function | 289 |
| 26 | `createImportJob` | function | 300 |
| 27 | `getImportJob` | function | 320 |
| 28 | `listImportJobs` | function | 326 |
| 29 | `updateJob` | function | 346 |
| 30 | `addJobError` | function | 372 |
| 31 | `getJobErrors` | function | 379 |
| 32 | `normalizeReviewText` | function | 389 |
| 33 | `normalizeReviewIdentifier` | function | 393 |
| 34 | `getBarcodeReviewIssue` | function | 397 |
| 35 | `isBlockingBarcodeIssue` | function | 414 |
| 36 | `buildProductImportReviewState` | function | 418 |
| 37 | `add` | const arrow | 422 |
| 38 | `duplicateGroupCount` | const arrow | 435 |
| 39 | `hasReviewQueryMatch` | function | 446 |
| 40 | `normalizeReviewFilter` | function | 466 |
| 41 | `matchesReviewFilter` | function | 474 |
| 42 | `buildProductReviewIndex` | function | 482 |
| 43 | `getProductConflictForReview` | function | 509 |
| 44 | `getReviewRowNumber` | function | 597 |
| 45 | `summarizeImportReviewRow` | function | 602 |
| 46 | `addProductReviewGroup` | function | 622 |
| 47 | `finalizeProductReviewGroups` | function | 666 |
| 48 | `buildContactReviewIndex` | function | 700 |
| 49 | `getContactConflictForReview` | function | 720 |
| 50 | `getGenericImportConflictForReview` | function | 771 |
| 51 | `applyImportDecisionToRow` | function | 784 |
| 52 | `getImportDecisionMap` | function | 852 |
| 53 | `getImportJobReview` | function | 861 |
| 54 | `updateImportJobDecisions` | function | 971 |
| 55 | `addJobFile` | function | 1004 |
| 56 | `getJobFiles` | function | 1023 |
| 57 | `markJobCancelled` | function | 1028 |
| 58 | `isCancelled` | function | 1032 |
| 59 | `waitForQueuedImportMedia` | function | 1038 |
| 60 | `finalizeSkippedImportImages` | function | 1065 |
| 61 | `normalizeLookup` | function | 1082 |
| 62 | `normalizeText` | function | 1086 |
| 63 | `getMimeTypeFromName` | function | 1090 |
| 64 | `normalizeProductSignature` | function | 1126 |
| 65 | `chooseParentProduct` | function | 1134 |
| 66 | `normalizeImportAction` | function | 1148 |
| 67 | `parseOptionalImportId` | function | 1156 |
| 68 | `parseIncomingImageRefs` | function | 1161 |
| 69 | `syncProductImageGallery` | function | 1195 |
| 70 | `loadCurrentGallery` | function | 1218 |
| 71 | `ensureParentProductExists` | function | 1225 |
| 72 | `assertUniqueProductFields` | function | 1234 |
| 73 | `findProductIdentifierConflict` | function | 1277 |
| 74 | `normalizeIdentifierConflictMode` | function | 1307 |
| 75 | `resolveNewProductIdentifiers` | function | 1315 |
| 76 | `copyImageIntoAssets` | function | 1352 |
| 77 | `resolveImageGallery` | function | 1391 |
| 78 | `ensureSettingOptionMap` | function | 1447 |
| 79 | `upsertSettingJson` | function | 1457 |
| 80 | `normalizeRowForProduct` | function | 1464 |
| 81 | `createProductContext` | function | 1512 |
| 82 | `sortProductImportRows` | function | 1541 |
| 83 | `getProductsByNameForImport` | function | 1553 |
| 84 | `rememberProductForImport` | function | 1568 |
| 85 | `buildImportSignatureKey` | function | 1577 |
| 86 | `ensureCategory` | function | 1583 |
| 87 | `ensureUnit` | function | 1596 |
| 88 | `ensureBrand` | function | 1608 |
| 89 | `ensureSupplier` | function | 1621 |
| 90 | `determineBranch` | function | 1635 |
| 91 | `handleBranchStock` | function | 1652 |
| 92 | `recalcProductStock` | function | 1681 |
| 93 | `insertInventoryMovement` | function | 1685 |
| 94 | `seedBranchRows` | function | 1713 |
| 95 | `processProductRow` | function | 1720 |
| 96 | `processProductRowBatches` | function | 2010 |
| 97 | `flushProgress` | const arrow | 2022 |
| 98 | `processProductRows` | function | 2127 |
| 99 | `preflightImportJob` | function | 2137 |
| 100 | `addFailure` | const arrow | 2151 |
| 101 | `buildImageLookup` | function | 2244 |
| 102 | `normalizeImageMatchKey` | function | 2259 |
| 103 | `processImageOnlyFiles` | function | 2269 |
| 104 | `normalizeContactMode` | function | 2331 |
| 105 | `resolveContactValue` | function | 2336 |
| 106 | `parseFieldRules` | function | 2344 |
| 107 | `generateCustomerMembershipNumber` | function | 2350 |
| 108 | `normalizeImportedMembershipNumber` | function | 2366 |
| 109 | `processContactRowBatches` | function | 2372 |
| 110 | `processContactRows` | function | 2541 |
| 111 | `normalizeInventoryAction` | function | 2551 |
| 112 | `processInventoryRowBatches` | function | 2558 |
| 113 | `processInventoryRows` | function | 2660 |
| 114 | `processSalesRowBatches` | function | 2669 |
| 115 | `processSalesRows` | function | 2884 |
| 116 | `extractZipImages` | function | 2893 |
| 117 | `processImportJob` | function | 2963 |
| 118 | `runLocalJob` | function | 3101 |
| 119 | `normalizeQueueMode` | function | 3108 |
| 120 | `queueNameForMode` | function | 3112 |
| 121 | `configuredQueueDriver` | function | 3116 |
| 122 | `getImportQueueConcurrency` | function | 3121 |
| 123 | `hasBullProducer` | function | 3125 |
| 124 | `hasBullWorkers` | function | 3129 |
| 125 | `removeQueuedBullJobsForImport` | function | 3133 |
| 126 | `getBullConnection` | function | 3156 |
| 127 | `initializeBullQueue` | function | 3169 |
| 128 | `startImportWorkers` | function | 3188 |
| 129 | `startWorker` | const arrow | 3195 |
| 130 | `enqueueImportJob` | function | 3231 |
| 131 | `resetImportJobForRetry` | function | 3274 |
| 132 | `cancelImportJob` | function | 3326 |
| 133 | `listCancellableImportJobs` | function | 3359 |
| 134 | `waitForImportJobsToStop` | function | 3368 |
| 135 | `cancelAllImportJobs` | function | 3390 |
| 136 | `deleteImportJob` | function | 3421 |
| 137 | `deleteAllImportJobs` | function | 3451 |
| 138 | `approveImportJob` | function | 3467 |
| 139 | `recoverImportJobs` | function | 3491 |
| 140 | `getQueueStatus` | function | 3513 |
| 141 | `buildErrorsCsv` | function | 3530 |
| 142 | `escape` | const arrow | 3532 |

### 3.71 `backend/src/services/integrationDoctor.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `trim` | function | 39 |
| 2 | `hasValue` | function | 43 |
| 3 | `redactPresence` | function | 47 |
| 4 | `status` | function | 54 |
| 5 | `unique` | function | 62 |
| 6 | `buildExpectedOauthChecklist` | function | 66 |
| 7 | `probeDatabase` | function | 100 |
| 8 | `getSafeTableCount` | function | 110 |
| 9 | `readCurrentBusinessCounts` | function | 119 |
| 10 | `findLatestVerifiedReleaseBackup` | function | 133 |
| 11 | `probeQueue` | function | 157 |
| 12 | `probeBackups` | function | 178 |
| 13 | `buildIntegrationDoctor` | function | 195 |

### 3.72 `backend/src/services/mediaQueue.js`

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

### 3.73 `backend/src/services/portalAi.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.74 `backend/src/services/verification.js`

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

### 3.75 `backend/src/sessionAuth.js`

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

### 3.76 `backend/src/settingsSnapshot.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeUploadPublicPath` | function | 8 |
| 2 | `isUploadPublicPath` | function | 22 |
| 3 | `sanitizeMediaPath` | function | 27 |
| 4 | `sanitizeMediaList` | function | 35 |
| 5 | `uploadPublicPathExists` | function | 48 |
| 6 | `sanitizeSettingValue` | function | 60 |
| 7 | `sanitizeSettingsSnapshot` | function | 64 |

### 3.77 `backend/src/storage/organizationFolders.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `trim` | function | 6 |
| 2 | `sanitizeOrganizationFolderLabel` | function | 10 |
| 3 | `buildOrganizationFolderName` | function | 20 |
| 4 | `extractOrganizationPublicId` | function | 26 |
| 5 | `findOrganizationFolderByPublicId` | function | 33 |

### 3.78 `backend/src/systemFsWorker.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatBackupStamp` | function | 15 |
| 2 | `pad` | const arrow | 17 |
| 3 | `respond` | function | 21 |
| 4 | `fail` | function | 25 |
| 5 | `runExportFolder` | function | 30 |
| 6 | `runRelocateDataRoot` | function | 70 |
| 7 | `main` | function | 77 |

### 3.79 `backend/src/systemJobs.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `nowIso` | function | 12 |
| 2 | `makeJobId` | function | 16 |
| 3 | `publicJob` | function | 20 |
| 4 | `findActiveJob` | function | 44 |
| 5 | `safeJsonParse` | function | 55 |
| 6 | `getDb` | function | 64 |
| 7 | `ensureTable` | function | 68 |
| 8 | `persistJob` | function | 123 |
| 9 | `cleanupJobs` | function | 170 |
| 10 | `buildPersistSignature` | function | 190 |
| 11 | `markPersisted` | function | 205 |
| 12 | `flushPersistJob` | function | 210 |
| 13 | `shouldPersistJob` | function | 222 |
| 14 | `schedulePersistJob` | function | 240 |
| 15 | `updateJob` | function | 251 |
| 16 | `SystemJobCancelledError` | class | 268 |
| 17 | `startSystemJob` | function | 276 |
| 18 | `runWorker` | const arrow | 305 |
| 19 | `isCancelled` | const arrow | 324 |
| 20 | `throwIfCancelled` | const arrow | 325 |
| 21 | `progress` | const arrow | 328 |
| 22 | `cancelSystemJob` | function | 381 |
| 23 | `getSystemJob` | function | 398 |
| 24 | `listSystemJobs` | function | 410 |

### 3.80 `backend/src/uploadReferenceCleanup.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `safeJsonArray` | function | 10 |
| 2 | `repairMissingUploadReferences` | function | 19 |

### 3.81 `backend/src/uploadSecurity.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `bufferStartsWith` | function | 12 |
| 2 | `isLikelyCsvBuffer` | function | 16 |
| 3 | `detectBufferKind` | function | 29 |
| 4 | `getExpectedUploadedKind` | function | 43 |
| 5 | `validateImageMetadata` | function | 52 |
| 6 | `validateUploadedBuffer` | function | 66 |
| 7 | `validateUploadedPath` | function | 77 |

### 3.82 `backend/src/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `attachWss` | function | 24 |

### 3.83 `backend/src/workers/importWorker.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `start` | function | 10 |
| 2 | `shutdown` | function | 16 |

### 3.84 `backend/src/workers/mediaWorker.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `start` | function | 10 |
| 2 | `shutdown` | function | 15 |

### 3.85 `ops/scripts/backend/schema-audit.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

### 3.86 `ops/scripts/backend/verify-data-integrity.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
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

