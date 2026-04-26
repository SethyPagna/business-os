# Backend Function Reference

Auto-generated symbol and route inventory for backend files. Regenerate with `node ops/scripts/generate-doc-reference.js`.

## 1. Coverage Summary

Total files documented: **33**

## 2. Symbol Count by File

| No. | File | Symbols | Route handlers |
|---:|---|---:|---:|
| 1 | `backend/server.js` | 14 | 0 |
| 2 | `backend/src/backupSchema.js` | 3 | 0 |
| 3 | `backend/src/config.js` | 5 | 0 |
| 4 | `backend/src/database.js` | 4 | 0 |
| 5 | `backend/src/dataPath.js` | 9 | 0 |
| 6 | `backend/src/fileAssets.js` | 22 | 0 |
| 7 | `backend/src/helpers.js` | 17 | 0 |
| 8 | `backend/src/middleware.js` | 9 | 0 |
| 9 | `backend/src/portalUtils.js` | 6 | 0 |
| 10 | `backend/src/requestContext.js` | 5 | 0 |
| 11 | `backend/src/routes/auth.js` | 13 | 13 |
| 12 | `backend/src/routes/branches.js` | 1 | 7 |
| 13 | `backend/src/routes/catalog.js` | 0 | 2 |
| 14 | `backend/src/routes/categories.js` | 0 | 4 |
| 15 | `backend/src/routes/contacts.js` | 9 | 15 |
| 16 | `backend/src/routes/customTables.js` | 2 | 6 |
| 17 | `backend/src/routes/files.js` | 2 | 3 |
| 18 | `backend/src/routes/inventory.js` | 1 | 3 |
| 19 | `backend/src/routes/portal.js` | 15 | 7 |
| 20 | `backend/src/routes/products.js` | 17 | 7 |
| 21 | `backend/src/routes/returns.js` | 4 | 5 |
| 22 | `backend/src/routes/sales.js` | 12 | 7 |
| 23 | `backend/src/routes/settings.js` | 0 | 2 |
| 24 | `backend/src/routes/system.js` | 25 | 18 |
| 25 | `backend/src/routes/units.js` | 0 | 0 |
| 26 | `backend/src/routes/users.js` | 14 | 15 |
| 27 | `backend/src/security.js` | 13 | 0 |
| 28 | `backend/src/serverUtils.js` | 9 | 0 |
| 29 | `backend/src/services/firebaseAuth.js` | 22 | 0 |
| 30 | `backend/src/services/supabaseAuth.js` | 31 | 0 |
| 31 | `backend/src/services/verification.js` | 20 | 0 |
| 32 | `backend/src/websocket.js` | 1 | 0 |
| 33 | `ops/scripts/backend/verify-data-integrity.js` | 10 | 0 |

## 3. Detailed Function Commentary

### 3.1 `backend/server.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadCompressionMiddleware` | function | 39 |
| 2 | `applySecurityHeaders` | function | 48 |
| 3 | `applyRequestPolicy` | function | 54 |
| 4 | `applyCoreMiddleware` | function | 64 |
| 5 | `mountStaticAssets` | function | 78 |
| 6 | `mountHealthRoute` | function | 91 |
| 7 | `mountApiRoutes` | function | 103 |
| 8 | `mountTransfersAlias` | function | 127 |
| 9 | `mountSpaFallback` | function | 142 |
| 10 | `mountErrorHandler` | function | 154 |
| 11 | `getStartupBanner` | function | 168 |
| 12 | `closeDatabase` | function | 188 |
| 13 | `registerShutdownHandlers` | function | 195 |
| 14 | `bootstrapServer` | function | 213 |

### 3.2 `backend/src/backupSchema.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `countRowsByTable` | function | 61 |
| 2 | `countCustomTableRows` | function | 69 |
| 3 | `buildBackupSummary` | function | 75 |

### 3.3 `backend/src/config.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isDefaultDataMarker` | function | 42 |
| 2 | `resolveStoredDataDir` | function | 47 |
| 3 | `normalizeSelectedDataDir` | function | 54 |
| 4 | `readDataLocation` | function | 68 |
| 5 | `writeDataLocation` | function | 82 |

### 3.4 `backend/src/database.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `tableHasColumn` | function | 536 |
| 2 | `ensureColumn` | function | 546 |
| 3 | `seedIfEmpty` | function | 602 |
| 4 | `ensurePrimaryAdminRoleAndUser` | function | 613 |

### 3.5 `backend/src/dataPath.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizePathForCompare` | function | 10 |
| 2 | `isSamePath` | function | 16 |
| 3 | `isSubPath` | function | 20 |
| 4 | `ensureDataRootLayout` | function | 25 |
| 5 | `walkFiles` | function | 30 |
| 6 | `summarizeDataRoot` | function | 48 |
| 7 | `copyDirectoryContents` | function | 89 |
| 8 | `buildArchivedTargetPath` | function | 126 |
| 9 | `relocateDataRoot` | function | 143 |

### 3.6 `backend/src/fileAssets.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ensureUploadsDirectory` | function | 42 |
| 2 | `getMimeTypeFromName` | function | 46 |
| 3 | `getMediaType` | function | 51 |
| 4 | `sanitizeOriginalFileName` | function | 60 |
| 5 | `preserveOriginalDisplayName` | function | 72 |
| 6 | `buildUniqueStoredName` | function | 79 |
| 7 | `shouldCompressImage` | function | 93 |
| 8 | `compressBufferForAsset` | function | 99 |
| 9 | `readImageDimensions` | function | 115 |
| 10 | `createFileAssetRecord` | function | 128 |
| 11 | `getFileAssetByPublicPath` | function | 188 |
| 12 | `listAssetRows` | function | 197 |
| 13 | `getUploadFilePath` | function | 219 |
| 14 | `collectUsage` | function | 224 |
| 15 | `serializeAssetRow` | function | 253 |
| 16 | `registerStoredAsset` | function | 263 |
| 17 | `registerUploadFromRequest` | function | 291 |
| 18 | `storeDataUrlAsset` | function | 303 |
| 19 | `backfillUploadAssets` | function | 324 |
| 20 | `listFileAssets` | function | 342 |
| 21 | `getFileAssetById` | function | 347 |
| 22 | `deleteFileAsset` | function | 352 |

### 3.7 `backend/src/helpers.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `logOp` | function | 21 |
| 2 | `getServerLog` | function | 26 |
| 3 | `ok` | function | 30 |
| 4 | `err` | function | 35 |
| 5 | `audit` | function | 50 |
| 6 | `broadcast` | function | 108 |
| 7 | `tryParse` | function | 117 |
| 8 | `today` | function | 122 |
| 9 | `bulkImportCSV` | function | 134 |
| 10 | `parseCSVLine` | function | 164 |
| 11 | `importRows` | function | 184 |
| 12 | `verifyAndRepairStockQuantities` | function | 199 |
| 13 | `verifyAndRepairSaleStatuses` | function | 268 |
| 14 | `verifyAndRepairCostPrices` | function | 328 |
| 15 | `runDataIntegrityCheck` | function | 398 |
| 16 | `getSafeCostPrice` | function | 425 |
| 17 | `calculateSaleProfit` | function | 436 |

### 3.8 `backend/src/middleware.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `authToken` | function | 13 |
| 2 | `sanitiseFilename` | function | 28 |
| 3 | `resolveExtension` | function | 60 |
| 4 | `compressibleImageFormat` | function | 72 |
| 5 | `compressImageFile` | function | 77 |
| 6 | `compressImageBuffer` | function | 99 |
| 7 | `createStorage` | function | 121 |
| 8 | `buildUpload` | function | 137 |
| 9 | `compressUpload` | function | 162 |

### 3.9 `backend/src/portalUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toTrimmedString` | function | 5 |
| 2 | `safeJsonParse` | function | 9 |
| 3 | `createAboutBlock` | function | 17 |
| 4 | `normalizeAboutBlocks` | function | 28 |
| 5 | `extractGoogleMapsEmbedUrl` | function | 47 |
| 6 | `normalizeGoogleMapsEmbed` | function | 55 |

### 3.10 `backend/src/requestContext.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `cleanText` | function | 7 |
| 2 | `readHeader` | function | 13 |
| 3 | `extractRequestMeta` | function | 19 |
| 4 | `requestContextMiddleware` | function | 45 |
| 5 | `getRequestMeta` | function | 50 |

### 3.11 `backend/src/routes/auth.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getClientKey` | function | 70 |
| 2 | `applyRateLimit` | function | 83 |
| 3 | `getLoginLockKey` | function | 95 |
| 4 | `loginIdentifierPreview` | function | 102 |
| 5 | `rejectLogin` | function | 116 |
| 6 | `getOtpSecret` | function | 138 |
| 7 | `buildUserPayload` | function | 147 |
| 8 | `findUserByIdentifier` | function | 167 |
| 9 | `normalizeVerificationMethod` | function | 191 |
| 10 | `normalizeOauthMode` | function | 197 |
| 11 | `isEmailIdentifier` | function | 202 |
| 12 | `getUserById` | function | 206 |
| 13 | `updateLocalUserSupabaseIdentity` | function | 210 |

#### 3.11.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/verification-capabilities` | 227 |
| 2 | POST | `/login` | 243 |
| 3 | POST | `/login/request-code` | 311 |
| 4 | POST | `/login/verify-code` | 365 |
| 5 | POST | `/oauth/start` | 411 |
| 6 | POST | `/oauth/complete` | 426 |
| 7 | POST | `/otp/verify` | 539 |
| 8 | POST | `/otp/setup` | 578 |
| 9 | POST | `/otp/confirm` | 595 |
| 10 | POST | `/otp/disable` | 617 |
| 11 | GET | `/otp/status/:userId` | 629 |
| 12 | POST | `/password-reset/request` | 636 |
| 13 | POST | `/password-reset/complete` | 693 |

### 3.12 `backend/src/routes/branches.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toDbBool` | function | 9 |

#### 3.12.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 18 |
| 2 | POST | `/` | 23 |
| 3 | PUT | `/:id` | 44 |
| 4 | DELETE | `/:id` | 63 |
| 5 | GET | `/:id/stock` | 85 |
| 6 | GET | `/transfers/list` | 99 |
| 7 | POST | `/transfer` | 111 |

### 3.13 `backend/src/routes/catalog.js`

- No top-level named function/class symbols detected.

#### 3.13.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/meta` | 9 |
| 2 | GET | `/products` | 26 |

### 3.14 `backend/src/routes/categories.js`

- No top-level named function/class symbols detected.

#### 3.14.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 9 |
| 2 | POST | `/` | 13 |
| 3 | PUT | `/:id` | 27 |
| 4 | DELETE | `/:id` | 36 |

### 3.15 `backend/src/routes/contacts.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `cleanMembershipNumber` | function | 9 |
| 2 | `assertUniqueMembershipNumber` | function | 14 |
| 3 | `normalizeConflictMode` | function | 28 |
| 4 | `toNumber` | function | 33 |
| 5 | `loadPointPolicy` | function | 38 |
| 6 | `calculatePolicyPoints` | function | 64 |
| 7 | `findExisting` | const arrow | 201 |
| 8 | `findExisting` | const arrow | 353 |
| 9 | `findExisting` | const arrow | 502 |

#### 3.15.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/customers` | 70 |
| 2 | POST | `/customers` | 138 |
| 3 | PUT | `/customers/:id` | 151 |
| 4 | DELETE | `/customers/:id` | 163 |
| 5 | POST | `/customers/bulk-import` | 169 |
| 6 | GET | `/suppliers` | 299 |
| 7 | POST | `/suppliers` | 303 |
| 8 | PUT | `/suppliers/:id` | 313 |
| 9 | DELETE | `/suppliers/:id` | 321 |
| 10 | POST | `/suppliers/bulk-import` | 327 |
| 11 | GET | `/delivery-contacts` | 442 |
| 12 | POST | `/delivery-contacts` | 446 |
| 13 | PUT | `/delivery-contacts/:id` | 458 |
| 14 | DELETE | `/delivery-contacts/:id` | 470 |
| 15 | POST | `/delivery-contacts/bulk-import` | 476 |

### 3.16 `backend/src/routes/customTables.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `humanizeTableName` | function | 9 |
| 2 | `serializeCustomTable` | function | 18 |

#### 3.16.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 27 |
| 2 | POST | `/` | 33 |
| 3 | GET | `/:name/data` | 60 |
| 4 | POST | `/:name/rows` | 67 |
| 5 | PUT | `/:name/rows/:id` | 81 |
| 6 | DELETE | `/:name/rows/:id` | 95 |

### 3.17 `backend/src/routes/files.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getActor` | function | 14 |
| 2 | `getDeviceMeta` | function | 21 |

#### 3.17.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 29 |
| 2 | POST | `/upload` | 41 |
| 3 | DELETE | `/:id` | 59 |

### 3.18 `backend/src/routes/inventory.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBranchQty` | const arrow | 33 |

#### 3.18.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | POST | `/adjust` | 10 |
| 2 | GET | `/summary` | 157 |
| 3 | GET | `/movements` | 326 |

### 3.19 `backend/src/routes/portal.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toNumber` | function | 17 |
| 2 | `normalizeBoolean` | function | 23 |
| 3 | `normalizePhone` | function | 29 |
| 4 | `normalizePublicPath` | function | 34 |
| 5 | `normalizeUrl` | function | 48 |
| 6 | `normalizeRedeemValueUsd` | function | 61 |
| 7 | `normalizeRedeemValueKhr` | function | 66 |
| 8 | `normalizeHexColor` | function | 73 |
| 9 | `loadSettingsMap` | function | 79 |
| 10 | `buildPortalConfig` | function | 87 |
| 11 | `calculatePointsValue` | function | 181 |
| 12 | `summarizePoints` | function | 191 |
| 13 | `getPortalProducts` | function | 231 |
| 14 | `findCustomerByMembership` | function | 288 |
| 15 | `sanitizeScreenshots` | function | 298 |

#### 3.19.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/config` | 307 |
| 2 | GET | `/catalog/meta` | 311 |
| 3 | GET | `/catalog/products` | 356 |
| 4 | GET | `/membership/:membershipNumber` | 360 |
| 5 | POST | `/submissions` | 502 |
| 6 | GET | `/submissions/review` | 543 |
| 7 | PATCH | `/submissions/:id/review` | 576 |

### 3.20 `backend/src/routes/products.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getActiveBranches` | function | 13 |
| 2 | `getDefaultBranch` | function | 17 |
| 3 | `seedBranchRows` | function | 21 |
| 4 | `recalcProductStock` | function | 26 |
| 5 | `normalizeImageGallery` | function | 35 |
| 6 | `syncProductImageGallery` | function | 52 |
| 7 | `loadProductImageMap` | function | 70 |
| 8 | `attachImageGallery` | function | 88 |
| 9 | `assertUniqueProductFields` | function | 100 |
| 10 | `resolveImage` | const arrow | 492 |
| 11 | `determineBranch` | const arrow | 508 |
| 12 | `handleBranch` | const arrow | 523 |
| 13 | `isDirectImageRef` | const arrow | 547 |
| 14 | `normalizeDirectImageRef` | const arrow | 558 |
| 15 | `parseIncomingImageRefs` | const arrow | 565 |
| 16 | `normalizeImageConflictMode` | const arrow | 598 |
| 17 | `loadCurrentGallery` | const arrow | 608 |

#### 3.20.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 128 |
| 2 | POST | `/variant` | 155 |
| 3 | POST | `/` | 218 |
| 4 | PUT | `/:id` | 270 |
| 5 | DELETE | `/:id` | 394 |
| 6 | POST | `/upload-image` | 417 |
| 7 | POST | `/bulk-import` | 425 |

### 3.21 `backend/src/routes/returns.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeScope` | function | 11 |
| 2 | `toNumber` | function | 19 |
| 3 | `assertReturnableItems` | function | 24 |
| 4 | `assertSupplierReturnableStock` | function | 315 |

#### 3.21.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/returns` | 98 |
| 2 | GET | `/returns/:id` | 116 |
| 3 | POST | `/returns` | 124 |
| 4 | POST | `/returns/supplier` | 336 |
| 5 | PATCH | `/returns/:id` | 503 |

### 3.22 `backend/src/routes/sales.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getSaleItemCosts` | function | 9 |
| 2 | `assertSaleStockAvailable` | function | 35 |
| 3 | `findCustomerForSaleAssignment` | function | 64 |
| 4 | `parseBranchId` | function | 85 |
| 5 | `getActiveBranchContext` | function | 90 |
| 6 | `requireActiveBranch` | function | 105 |
| 7 | `resolveSaleItemBranchId` | function | 112 |
| 8 | `normalizeSaleItems` | function | 123 |
| 9 | `summarizeSaleBranch` | function | 153 |
| 10 | `refreshProductStockQuantity` | function | 177 |
| 11 | `refreshProductStockQuantities` | function | 190 |
| 12 | `fetchSaleItemsWithBranches` | function | 197 |

#### 3.22.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | POST | `/sales` | 207 |
| 2 | PATCH | `/sales/:id/status` | 352 |
| 3 | PATCH | `/sales/:id/customer` | 481 |
| 4 | GET | `/sales` | 565 |
| 5 | GET | `/sales/export` | 631 |
| 6 | GET | `/dashboard` | 799 |
| 7 | GET | `/analytics` | 896 |

### 3.23 `backend/src/routes/settings.js`

- No top-level named function/class symbols detected.

#### 3.23.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 10 |
| 2 | POST | `/` | 18 |

### 3.24 `backend/src/routes/system.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `q` | function | 49 |
| 2 | `getClientKey` | function | 53 |
| 3 | `applyRouteRateLimit` | function | 59 |
| 4 | `getTableColumns` | function | 71 |
| 5 | `extractUploadPathsFromText` | function | 75 |
| 6 | `collectBackupUploads` | function | 84 |
| 7 | `addUpload` | const arrow | 88 |
| 8 | `restoreBackupUploads` | function | 118 |
| 9 | `deleteAllUploads` | function | 128 |
| 10 | `formatBackupStamp` | function | 137 |
| 11 | `pad` | const arrow | 139 |
| 12 | `getBackupDataRootCandidate` | function | 143 |
| 13 | `readBackupTablesFromDataRoot` | function | 155 |
| 14 | `restoreUploadsFromDataRoot` | function | 188 |
| 15 | `restoreSnapshotTables` | function | 202 |
| 16 | `ensurePrimaryAdminRoleAndUser` | function | 254 |
| 17 | `replaceTableRows` | function | 319 |
| 18 | `normaliseBackupTables` | function | 354 |
| 19 | `normaliseBackupCustomTableRows` | function | 383 |
| 20 | `repairRelationalConsistency` | function | 388 |
| 21 | `getCustomTableNames` | function | 396 |
| 22 | `parseCustomTableDefinition` | function | 402 |
| 23 | `recreateCustomTable` | function | 445 |
| 24 | `listWindowsFsRoots` | const arrow | 865 |
| 25 | `listDriveRoots` | const arrow | 915 |

#### 3.24.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/audit-logs` | 456 |
| 2 | GET | `/debug/log` | 460 |
| 3 | GET | `/config` | 467 |
| 4 | GET | `/backup/export` | 472 |
| 5 | POST | `/backup/export-folder` | 500 |
| 6 | POST | `/backup/import` | 551 |
| 7 | POST | `/backup/import-folder` | 573 |
| 8 | POST | `/reset-data` | 614 |
| 9 | POST | `/factory-reset` | 655 |
| 10 | POST | `/sync/push` | 686 |
| 11 | GET | `/verify-integrity` | 696 |
| 12 | POST | `/repair-integrity` | 715 |
| 13 | GET | `/data-path` | 744 |
| 14 | POST | `/data-path` | 764 |
| 15 | DELETE | `/data-path` | 829 |
| 16 | POST | `/browse-dir` | 862 |
| 17 | POST | `/open-path` | 949 |
| 18 | POST | `/pick-folder` | 969 |

### 3.25 `backend/src/routes/units.js`

- No top-level named function/class symbols detected.

### 3.26 `backend/src/routes/users.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getClientKey` | function | 49 |
| 2 | `parseJson` | function | 55 |
| 3 | `getMergedPermissions` | function | 67 |
| 4 | `isPrimaryAdmin` | function | 76 |
| 5 | `hasAdminControl` | function | 83 |
| 6 | `canManageTarget` | function | 96 |
| 7 | `getActorFromPayload` | function | 109 |
| 8 | `getActorFromRequest` | function | 120 |
| 9 | `requireAdminControl` | function | 127 |
| 10 | `getUserSecurityContext` | function | 140 |
| 11 | `resolveVerificationContext` | function | 152 |
| 12 | `getUserWithRole` | function | 160 |
| 13 | `sanitizeUserRow` | function | 171 |
| 14 | `isValidEmail` | function | 187 |

#### 3.26.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/users` | 195 |
| 2 | GET | `/users/:id/profile` | 212 |
| 3 | GET | `/users/:id/auth-methods` | 228 |
| 4 | POST | `/users/avatar-upload` | 276 |
| 5 | POST | `/users/:id/contact-verification/request` | 287 |
| 6 | POST | `/users/:id/contact-verification/confirm` | 346 |
| 7 | POST | `/users` | 395 |
| 8 | PUT | `/users/:id` | 469 |
| 9 | PUT | `/users/:id/profile` | 570 |
| 10 | POST | `/users/:id/change-password` | 666 |
| 11 | POST | `/users/:id/reset-password` | 708 |
| 12 | GET | `/roles` | 745 |
| 13 | POST | `/roles` | 751 |
| 14 | PUT | `/roles/:id` | 769 |
| 15 | DELETE | `/roles/:id` | 788 |

### 3.27 `backend/src/security.js`

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

### 3.28 `backend/src/serverUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `sanitizeObjectKeys` | function | 24 |
| 2 | `sanitizeRequestPayload` | function | 43 |
| 3 | `isApiOrHealthPath` | function | 48 |
| 4 | `isSpaFallbackEligible` | function | 52 |
| 5 | `setNoStoreHeaders` | function | 60 |
| 6 | `setHtmlNoCacheHeaders` | function | 64 |
| 7 | `setTunnelSecurityHeaders` | function | 70 |
| 8 | `setFrontendStaticHeaders` | function | 81 |
| 9 | `mapServerError` | function | 96 |

### 3.29 `backend/src/services/firebaseAuth.js`

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

### 3.30 `backend/src/services/supabaseAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `truthy` | function | 13 |
| 2 | `trim` | function | 17 |
| 3 | `parseJsonSafe` | function | 21 |
| 4 | `normalizeSupabaseUrl` | function | 29 |
| 5 | `normalizeEmail` | function | 33 |
| 6 | `isPlainObject` | function | 38 |
| 7 | `clampPassword` | function | 42 |
| 8 | `isAllowedOauthProvider` | function | 46 |
| 9 | `isHttpUrl` | function | 50 |
| 10 | `isSupabaseAuthConfigured` | function | 65 |
| 11 | `hasSupabaseAdminCredentials` | function | 69 |
| 12 | `hasSupabasePublicCredentials` | function | 73 |
| 13 | `buildSupabaseUrl` | function | 77 |
| 14 | `getSupabaseAuthPublicConfig` | function | 81 |
| 15 | `normalizeProviderError` | function | 97 |
| 16 | `parseResponseData` | function | 114 |
| 17 | `callSupabasePublic` | function | 122 |
| 18 | `callSupabaseAdmin` | function | 155 |
| 19 | `getBanDurationForActiveState` | function | 189 |
| 20 | `buildUserMetadata` | function | 193 |
| 21 | `buildAppMetadata` | function | 201 |
| 22 | `getIdentityProviders` | function | 209 |
| 23 | `summarizeAuthUser` | function | 230 |
| 24 | `isLocalUserActive` | function | 247 |
| 25 | `getAuthUserById` | function | 251 |
| 26 | `getAuthUserFromAccessToken` | function | 259 |
| 27 | `createOrUpdateAuthUser` | function | 269 |
| 28 | `updateAuthPassword` | function | 309 |
| 29 | `setAuthUserActive` | function | 328 |
| 30 | `verifyPasswordWithSupabase` | function | 343 |
| 31 | `buildOauthStartUrl` | function | 362 |

### 3.31 `backend/src/services/verification.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `nowMs` | function | 8 |
| 2 | `toIso` | function | 12 |
| 3 | `parseBool` | function | 16 |
| 4 | `isEmailProviderConfigured` | function | 23 |
| 5 | `getVerificationCapabilities` | function | 30 |
| 6 | `normalizeEmail` | function | 37 |
| 7 | `normalizePhone` | function | 44 |
| 8 | `maskDestination` | function | 54 |
| 9 | `generateCode` | function | 67 |
| 10 | `hashCode` | function | 71 |
| 11 | `resolveChannel` | function | 75 |
| 12 | `getDestinationForChannel` | function | 85 |
| 13 | `cleanupExpiredCodes` | function | 90 |
| 14 | `createVerificationRecord` | function | 98 |
| 15 | `findActiveCode` | function | 124 |
| 16 | `consumeCode` | function | 139 |
| 17 | `verifyCode` | function | 143 |
| 18 | `messageForPurpose` | function | 152 |
| 19 | `sendEmail` | function | 171 |
| 20 | `requestVerificationCode` | function | 235 |

### 3.32 `backend/src/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `attachWss` | function | 20 |

### 3.33 `ops/scripts/backend/verify-data-integrity.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `fail` | function | 20 |
| 2 | `pass` | function | 25 |
| 3 | `approxEqual` | function | 29 |
| 4 | `checkNoNegativeStock` | function | 36 |
| 5 | `checkProductStockMatchesBranches` | function | 45 |
| 6 | `checkSaleItemTotals` | function | 94 |
| 7 | `checkReturnDoesNotExceedSold` | function | 104 |
| 8 | `checkProfitFormulaConsistency` | function | 130 |
| 9 | `checkCogsSnapshotVsCurrentProductCost` | function | 166 |
| 10 | `run` | function | 190 |

