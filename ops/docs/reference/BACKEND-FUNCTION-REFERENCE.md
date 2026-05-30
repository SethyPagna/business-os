# Backend Function Reference

Auto-generated symbol and route inventory for backend files. Regenerate with `node ops/scripts/docs/generate-doc-reference.ts`.

## 1. Coverage Summary

Total files documented: **5**

## 2. Symbol Count by File

| No. | File | Symbols | Route handlers |
|---:|---|---:|---:|
| 1 | `backend/server.js` | 23 | 0 |
| 2 | `backend/src/routes/inventory.js` | 32 | 16 |
| 3 | `backend/src/routes/products.js` | 64 | 12 |
| 4 | `backend/src/routes/system/index.js` | 44 | 38 |
| 5 | `backend/src/services/importJobs.js` | 175 | 0 |

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

### 3.2 `backend/src/routes/inventory.js`

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

#### 3.2.1 Route Handlers

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

### 3.3 `backend/src/routes/products.js`

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

#### 3.3.1 Route Handlers

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

### 3.4 `backend/src/routes/system/index.js`

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

#### 3.4.1 Route Handlers

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

### 3.5 `backend/src/services/importJobs.js`

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

