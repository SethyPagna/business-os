# Backend Function Reference

Auto-generated symbol and route inventory for backend files. Regenerate with `node ops/scripts/generate-doc-reference.js`.

## 1. Coverage Summary

Total files documented: **44**

## 2. Symbol Count by File

| No. | File | Symbols | Route handlers |
|---:|---|---:|---:|
| 1 | `backend/server.js` | 14 | 0 |
| 2 | `backend/src/accessControl.js` | 16 | 0 |
| 3 | `backend/src/backupSchema.js` | 3 | 0 |
| 4 | `backend/src/config.js` | 5 | 0 |
| 5 | `backend/src/database.js` | 8 | 0 |
| 6 | `backend/src/dataPath.js` | 9 | 0 |
| 7 | `backend/src/fileAssets.js` | 22 | 0 |
| 8 | `backend/src/helpers.js` | 17 | 0 |
| 9 | `backend/src/middleware.js` | 14 | 0 |
| 10 | `backend/src/netSecurity.js` | 7 | 0 |
| 11 | `backend/src/organizationContext.js` | 12 | 0 |
| 12 | `backend/src/portalUtils.js` | 6 | 0 |
| 13 | `backend/src/requestContext.js` | 5 | 0 |
| 14 | `backend/src/routes/ai.js` | 3 | 6 |
| 15 | `backend/src/routes/auth.js` | 17 | 13 |
| 16 | `backend/src/routes/branches.js` | 1 | 7 |
| 17 | `backend/src/routes/catalog.js` | 0 | 2 |
| 18 | `backend/src/routes/categories.js` | 0 | 4 |
| 19 | `backend/src/routes/contacts.js` | 9 | 15 |
| 20 | `backend/src/routes/customTables.js` | 2 | 6 |
| 21 | `backend/src/routes/files.js` | 2 | 3 |
| 22 | `backend/src/routes/inventory.js` | 1 | 3 |
| 23 | `backend/src/routes/organizations.js` | 0 | 3 |
| 24 | `backend/src/routes/portal.js` | 21 | 9 |
| 25 | `backend/src/routes/products.js` | 17 | 7 |
| 26 | `backend/src/routes/returns.js` | 4 | 5 |
| 27 | `backend/src/routes/sales.js` | 12 | 7 |
| 28 | `backend/src/routes/settings.js` | 0 | 2 |
| 29 | `backend/src/routes/system.js` | 27 | 24 |
| 30 | `backend/src/routes/units.js` | 0 | 0 |
| 31 | `backend/src/routes/users.js` | 19 | 16 |
| 32 | `backend/src/security.js` | 13 | 0 |
| 33 | `backend/src/serverUtils.js` | 12 | 0 |
| 34 | `backend/src/services/aiGateway.js` | 12 | 0 |
| 35 | `backend/src/services/firebaseAuth.js` | 22 | 0 |
| 36 | `backend/src/services/googleDriveSync.js` | 46 | 0 |
| 37 | `backend/src/services/portalAi.js` | 29 | 0 |
| 38 | `backend/src/services/supabaseAuth.js` | 37 | 0 |
| 39 | `backend/src/services/verification.js` | 21 | 0 |
| 40 | `backend/src/sessionAuth.js` | 6 | 0 |
| 41 | `backend/src/systemFsWorker.js` | 7 | 0 |
| 42 | `backend/src/uploadSecurity.js` | 7 | 0 |
| 43 | `backend/src/websocket.js` | 1 | 0 |
| 44 | `ops/scripts/backend/verify-data-integrity.js` | 10 | 0 |

## 3. Detailed Function Commentary

### 3.1 `backend/server.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `loadCompressionMiddleware` | function | 41 |
| 2 | `applySecurityHeaders` | function | 50 |
| 3 | `applyRequestPolicy` | function | 56 |
| 4 | `applyCoreMiddleware` | function | 66 |
| 5 | `mountStaticAssets` | function | 80 |
| 6 | `mountHealthRoute` | function | 94 |
| 7 | `mountApiRoutes` | function | 106 |
| 8 | `mountTransfersAlias` | function | 134 |
| 9 | `mountSpaFallback` | function | 149 |
| 10 | `mountErrorHandler` | function | 168 |
| 11 | `getStartupBanner` | function | 182 |
| 12 | `closeDatabase` | function | 202 |
| 13 | `registerShutdownHandlers` | function | 209 |
| 14 | `bootstrapServer` | function | 227 |

### 3.2 `backend/src/accessControl.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `trim` | function | 19 |
| 2 | `normalizeHostname` | function | 23 |
| 3 | `getConfiguredSyncToken` | function | 29 |
| 4 | `getRequestHost` | function | 33 |
| 5 | `getRemoteAddress` | function | 39 |
| 6 | `isLoopbackAddress` | function | 47 |
| 7 | `getPresentedSyncToken` | function | 54 |
| 8 | `getTailscaleIdentity` | function | 60 |
| 9 | `hasTrustedTailscaleIdentity` | function | 69 |
| 10 | `isLocalHostRequest` | function | 76 |
| 11 | `isTsNetHost` | function | 81 |
| 12 | `getConfiguredTailscaleHost` | function | 86 |
| 13 | `isPublicRemoteRequest` | function | 90 |
| 14 | `isPublicApiRequest` | function | 98 |
| 15 | `classifyRequestAccess` | function | 104 |
| 16 | `authorizeProtectedRequest` | function | 132 |

### 3.3 `backend/src/backupSchema.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `countRowsByTable` | function | 61 |
| 2 | `countCustomTableRows` | function | 69 |
| 3 | `buildBackupSummary` | function | 75 |

### 3.4 `backend/src/config.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isDefaultDataMarker` | function | 42 |
| 2 | `resolveStoredDataDir` | function | 47 |
| 3 | `normalizeSelectedDataDir` | function | 54 |
| 4 | `readDataLocation` | function | 68 |
| 5 | `writeDataLocation` | function | 82 |

### 3.5 `backend/src/database.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `tableHasColumn` | function | 655 |
| 2 | `ensureColumn` | function | 665 |
| 3 | `normalizeUserPhoneLookup` | function | 677 |
| 4 | `slugifyOrgName` | function | 682 |
| 5 | `generateOrgPublicId` | function | 691 |
| 6 | `seedIfEmpty` | function | 785 |
| 7 | `ensureDefaultOrganizationAndGroup` | function | 796 |
| 8 | `ensurePrimaryAdminRoleAndUser` | function | 867 |

### 3.6 `backend/src/dataPath.js`

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

### 3.7 `backend/src/fileAssets.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ensureUploadsDirectory` | function | 43 |
| 2 | `getMimeTypeFromName` | function | 47 |
| 3 | `getMediaType` | function | 52 |
| 4 | `sanitizeOriginalFileName` | function | 61 |
| 5 | `preserveOriginalDisplayName` | function | 73 |
| 6 | `buildUniqueStoredName` | function | 80 |
| 7 | `shouldCompressImage` | function | 94 |
| 8 | `compressBufferForAsset` | function | 100 |
| 9 | `readImageDimensions` | function | 116 |
| 10 | `createFileAssetRecord` | function | 129 |
| 11 | `getFileAssetByPublicPath` | function | 189 |
| 12 | `listAssetRows` | function | 198 |
| 13 | `getUploadFilePath` | function | 220 |
| 14 | `collectUsage` | function | 225 |
| 15 | `serializeAssetRow` | function | 254 |
| 16 | `registerStoredAsset` | function | 264 |
| 17 | `registerUploadFromRequest` | function | 292 |
| 18 | `storeDataUrlAsset` | function | 304 |
| 19 | `backfillUploadAssets` | function | 326 |
| 20 | `listFileAssets` | function | 344 |
| 21 | `getFileAssetById` | function | 349 |
| 22 | `deleteFileAsset` | function | 354 |

### 3.8 `backend/src/helpers.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `logOp` | function | 21 |
| 2 | `getServerLog` | function | 26 |
| 3 | `ok` | function | 30 |
| 4 | `err` | function | 35 |
| 5 | `audit` | function | 50 |
| 6 | `broadcast` | function | 108 |
| 7 | `tryParse` | function | 121 |
| 8 | `today` | function | 126 |
| 9 | `bulkImportCSV` | function | 138 |
| 10 | `parseCSVLine` | function | 168 |
| 11 | `importRows` | function | 188 |
| 12 | `verifyAndRepairStockQuantities` | function | 203 |
| 13 | `verifyAndRepairSaleStatuses` | function | 272 |
| 14 | `verifyAndRepairCostPrices` | function | 332 |
| 15 | `runDataIntegrityCheck` | function | 402 |
| 16 | `getSafeCostPrice` | function | 429 |
| 17 | `calculateSaleProfit` | function | 440 |

### 3.9 `backend/src/middleware.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `authToken` | function | 16 |
| 2 | `networkAccessGuard` | function | 29 |
| 3 | `sanitiseFilename` | function | 34 |
| 4 | `resolveExtension` | function | 66 |
| 5 | `compressibleImageFormat` | function | 78 |
| 6 | `compressImageFile` | function | 83 |
| 7 | `compressImageBuffer` | function | 105 |
| 8 | `getClientKey` | function | 127 |
| 9 | `routeRateLimit` | function | 133 |
| 10 | `createStorage` | function | 145 |
| 11 | `buildUpload` | function | 161 |
| 12 | `compressUpload` | function | 193 |
| 13 | `validateUploadedFile` | function | 198 |
| 14 | `validateUploadBufferPayload` | function | 209 |

### 3.10 `backend/src/netSecurity.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `trim` | function | 26 |
| 2 | `normalizeHostname` | function | 30 |
| 3 | `isPrivateIpv4` | function | 34 |
| 4 | `isPrivateIpv6` | function | 47 |
| 5 | `isBlockedHostname` | function | 58 |
| 6 | `assertSafeOutboundUrl` | function | 69 |
| 7 | `isSafeExternalImageReference` | function | 97 |

### 3.11 `backend/src/organizationContext.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `trim` | function | 9 |
| 2 | `slugify` | function | 13 |
| 3 | `generateOrganizationPublicId` | function | 21 |
| 4 | `getDefaultOrganization` | function | 25 |
| 5 | `getOrganizationById` | function | 34 |
| 6 | `findOrganizationByLookup` | function | 43 |
| 7 | `searchOrganizations` | function | 58 |
| 8 | `getOrganizationGroup` | function | 91 |
| 9 | `getDefaultOrganizationGroup` | function | 101 |
| 10 | `getOrganizationContextForUser` | function | 113 |
| 11 | `getPortalPublicPath` | function | 131 |
| 12 | `ensureOrganizationFilesystemLayout` | function | 136 |

### 3.12 `backend/src/portalUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toTrimmedString` | function | 5 |
| 2 | `safeJsonParse` | function | 9 |
| 3 | `createAboutBlock` | function | 17 |
| 4 | `normalizeAboutBlocks` | function | 28 |
| 5 | `extractGoogleMapsEmbedUrl` | function | 47 |
| 6 | `normalizeGoogleMapsEmbed` | function | 55 |

### 3.13 `backend/src/requestContext.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `cleanText` | function | 7 |
| 2 | `readHeader` | function | 13 |
| 3 | `extractRequestMeta` | function | 19 |
| 4 | `requestContextMiddleware` | function | 45 |
| 5 | `getRequestMeta` | function | 50 |

### 3.14 `backend/src/routes/ai.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getActor` | function | 18 |
| 2 | `listProviders` | function | 25 |
| 3 | `getProviderRow` | function | 34 |

#### 3.14.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/providers` | 38 |
| 2 | POST | `/providers` | 45 |
| 3 | PUT | `/providers/:id` | 99 |
| 4 | POST | `/providers/:id/test` | 163 |
| 5 | DELETE | `/providers/:id` | 199 |
| 6 | GET | `/responses` | 217 |

### 3.15 `backend/src/routes/auth.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getClientKey` | function | 71 |
| 2 | `applyRateLimit` | function | 84 |
| 3 | `getLoginLockKey` | function | 96 |
| 4 | `normalizeLookupText` | function | 100 |
| 5 | `loginIdentifierPreview` | function | 107 |
| 6 | `rejectLogin` | function | 121 |
| 7 | `getOtpSecret` | function | 143 |
| 8 | `buildUserPayload` | function | 152 |
| 9 | `resolveOrganizationLookup` | function | 184 |
| 10 | `findUserByIdentifier` | function | 190 |
| 11 | `getExactActiveUserById` | function | 259 |
| 12 | `normalizeOauthMode` | function | 274 |
| 13 | `isEmailIdentifier` | function | 279 |
| 14 | `getUserById` | function | 283 |
| 15 | `generateTemporaryAuthPassword` | function | 287 |
| 16 | `issueAuthSession` | function | 291 |
| 17 | `updateLocalUserSupabaseIdentity` | function | 302 |

#### 3.15.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/verification-capabilities` | 328 |
| 2 | POST | `/login` | 345 |
| 3 | POST | `/oauth/start` | 417 |
| 4 | POST | `/oauth/complete` | 432 |
| 5 | POST | `/otp/verify` | 597 |
| 6 | POST | `/logout` | 644 |
| 7 | POST | `/otp/setup` | 651 |
| 8 | POST | `/otp/confirm` | 672 |
| 9 | POST | `/otp/disable` | 701 |
| 10 | GET | `/otp/status/:userId` | 720 |
| 11 | POST | `/password-reset/otp` | 727 |
| 12 | POST | `/password-reset/email` | 790 |
| 13 | POST | `/password-reset/complete` | 838 |

### 3.16 `backend/src/routes/branches.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toDbBool` | function | 9 |

#### 3.16.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 18 |
| 2 | POST | `/` | 23 |
| 3 | PUT | `/:id` | 44 |
| 4 | DELETE | `/:id` | 63 |
| 5 | GET | `/:id/stock` | 85 |
| 6 | GET | `/transfers/list` | 99 |
| 7 | POST | `/transfer` | 111 |

### 3.17 `backend/src/routes/catalog.js`

- No top-level named function/class symbols detected.

#### 3.17.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/meta` | 9 |
| 2 | GET | `/products` | 26 |

### 3.18 `backend/src/routes/categories.js`

- No top-level named function/class symbols detected.

#### 3.18.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 9 |
| 2 | POST | `/` | 13 |
| 3 | PUT | `/:id` | 27 |
| 4 | DELETE | `/:id` | 36 |

### 3.19 `backend/src/routes/contacts.js`

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

#### 3.19.1 Route Handlers

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

### 3.20 `backend/src/routes/customTables.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `humanizeTableName` | function | 9 |
| 2 | `serializeCustomTable` | function | 18 |

#### 3.20.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 27 |
| 2 | POST | `/` | 33 |
| 3 | GET | `/:name/data` | 60 |
| 4 | POST | `/:name/rows` | 67 |
| 5 | PUT | `/:name/rows/:id` | 81 |
| 6 | DELETE | `/:name/rows/:id` | 95 |

### 3.21 `backend/src/routes/files.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getActor` | function | 14 |
| 2 | `getDeviceMeta` | function | 21 |

#### 3.21.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 29 |
| 2 | POST | `/upload` | 41 |
| 3 | DELETE | `/:id` | 59 |

### 3.22 `backend/src/routes/inventory.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getBranchQty` | const arrow | 33 |

#### 3.22.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | POST | `/adjust` | 10 |
| 2 | GET | `/summary` | 157 |
| 3 | GET | `/movements` | 326 |

### 3.23 `backend/src/routes/organizations.js`

- No top-level named function/class symbols detected.

#### 3.23.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/bootstrap` | 14 |
| 2 | GET | `/search` | 24 |
| 3 | GET | `/current` | 30 |

### 3.24 `backend/src/routes/portal.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toNumber` | function | 22 |
| 2 | `normalizeBoolean` | function | 28 |
| 3 | `normalizePhone` | function | 34 |
| 4 | `normalizePublicPath` | function | 39 |
| 5 | `normalizeUrl` | function | 53 |
| 6 | `normalizeRedeemValueUsd` | function | 68 |
| 7 | `normalizeRedeemValueKhr` | function | 73 |
| 8 | `normalizeHexColor` | function | 80 |
| 9 | `normalizeFaqItems` | function | 86 |
| 10 | `loadSettingsMap` | function | 100 |
| 11 | `buildPortalConfig` | function | 108 |
| 12 | `calculatePointsValue` | function | 226 |
| 13 | `summarizePoints` | function | 236 |
| 14 | `getPortalProducts` | function | 276 |
| 15 | `findCustomerByMembership` | function | 333 |
| 16 | `sanitizeScreenshots` | function | 343 |
| 17 | `materializePortalScreenshots` | function | 352 |
| 18 | `sanitizeAiProfile` | function | 370 |
| 19 | `getVisitorFingerprint` | function | 382 |
| 20 | `getClientKey` | function | 388 |
| 21 | `applyPortalRateLimit` | function | 393 |

#### 3.24.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/config` | 401 |
| 2 | GET | `/catalog/meta` | 405 |
| 3 | GET | `/catalog/products` | 450 |
| 4 | GET | `/ai/status` | 454 |
| 5 | POST | `/ai/chat` | 466 |
| 6 | GET | `/membership/:membershipNumber` | 542 |
| 7 | POST | `/submissions` | 685 |
| 8 | GET | `/submissions/review` | 732 |
| 9 | PATCH | `/submissions/:id/review` | 765 |

### 3.25 `backend/src/routes/products.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getActiveBranches` | function | 14 |
| 2 | `getDefaultBranch` | function | 18 |
| 3 | `seedBranchRows` | function | 22 |
| 4 | `recalcProductStock` | function | 27 |
| 5 | `normalizeImageGallery` | function | 36 |
| 6 | `syncProductImageGallery` | function | 53 |
| 7 | `loadProductImageMap` | function | 71 |
| 8 | `attachImageGallery` | function | 89 |
| 9 | `assertUniqueProductFields` | function | 101 |
| 10 | `resolveImage` | const arrow | 493 |
| 11 | `determineBranch` | const arrow | 509 |
| 12 | `handleBranch` | const arrow | 524 |
| 13 | `isDirectImageRef` | const arrow | 548 |
| 14 | `normalizeDirectImageRef` | const arrow | 559 |
| 15 | `parseIncomingImageRefs` | const arrow | 566 |
| 16 | `normalizeImageConflictMode` | const arrow | 599 |
| 17 | `loadCurrentGallery` | const arrow | 609 |

#### 3.25.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 129 |
| 2 | POST | `/variant` | 156 |
| 3 | POST | `/` | 219 |
| 4 | PUT | `/:id` | 271 |
| 5 | DELETE | `/:id` | 395 |
| 6 | POST | `/upload-image` | 418 |
| 7 | POST | `/bulk-import` | 426 |

### 3.26 `backend/src/routes/returns.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeScope` | function | 11 |
| 2 | `toNumber` | function | 19 |
| 3 | `assertReturnableItems` | function | 24 |
| 4 | `assertSupplierReturnableStock` | function | 315 |

#### 3.26.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/returns` | 98 |
| 2 | GET | `/returns/:id` | 116 |
| 3 | POST | `/returns` | 124 |
| 4 | POST | `/returns/supplier` | 336 |
| 5 | PATCH | `/returns/:id` | 503 |

### 3.27 `backend/src/routes/sales.js`

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

#### 3.27.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | POST | `/sales` | 207 |
| 2 | PATCH | `/sales/:id/status` | 352 |
| 3 | PATCH | `/sales/:id/customer` | 481 |
| 4 | GET | `/sales` | 565 |
| 5 | GET | `/sales/export` | 631 |
| 6 | GET | `/dashboard` | 799 |
| 7 | GET | `/analytics` | 896 |

### 3.28 `backend/src/routes/settings.js`

- No top-level named function/class symbols detected.

#### 3.28.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 10 |
| 2 | POST | `/` | 18 |

### 3.29 `backend/src/routes/system.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `q` | function | 59 |
| 2 | `getClientKey` | function | 63 |
| 3 | `applyRouteRateLimit` | function | 69 |
| 4 | `runFsWorker` | function | 81 |
| 5 | `finish` | const arrow | 93 |
| 6 | `getHostUiAvailability` | function | 137 |
| 7 | `buildRequestBaseUrl` | function | 146 |
| 8 | `getTableColumns` | function | 153 |
| 9 | `extractUploadPathsFromText` | function | 157 |
| 10 | `collectBackupUploads` | function | 166 |
| 11 | `addUpload` | const arrow | 170 |
| 12 | `restoreBackupUploads` | function | 200 |
| 13 | `deleteAllUploads` | function | 210 |
| 14 | `getBackupDataRootCandidate` | function | 219 |
| 15 | `readBackupTablesFromDataRoot` | function | 231 |
| 16 | `restoreUploadsFromDataRoot` | function | 264 |
| 17 | `restoreSnapshotTables` | function | 278 |
| 18 | `ensurePrimaryAdminRoleAndUser` | function | 330 |
| 19 | `replaceTableRows` | function | 395 |
| 20 | `normaliseBackupTables` | function | 430 |
| 21 | `normaliseBackupCustomTableRows` | function | 459 |
| 22 | `repairRelationalConsistency` | function | 464 |
| 23 | `getCustomTableNames` | function | 472 |
| 24 | `parseCustomTableDefinition` | function | 478 |
| 25 | `recreateCustomTable` | function | 521 |
| 26 | `listWindowsFsRoots` | const arrow | 1061 |
| 27 | `listDriveRoots` | const arrow | 1078 |

#### 3.29.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/audit-logs` | 532 |
| 2 | GET | `/debug/log` | 536 |
| 3 | GET | `/config` | 543 |
| 4 | GET | `/drive-sync/status` | 571 |
| 5 | POST | `/drive-sync/preferences` | 578 |
| 6 | POST | `/drive-sync/oauth/start` | 590 |
| 7 | GET | `/drive-sync/oauth/callback` | 633 |
| 8 | POST | `/drive-sync/disconnect` | 661 |
| 9 | POST | `/drive-sync/sync-now` | 670 |
| 10 | GET | `/backup/export` | 682 |
| 11 | POST | `/backup/export-folder` | 710 |
| 12 | POST | `/backup/import` | 749 |
| 13 | POST | `/backup/import-folder` | 771 |
| 14 | POST | `/reset-data` | 812 |
| 15 | POST | `/factory-reset` | 853 |
| 16 | POST | `/sync/push` | 884 |
| 17 | GET | `/verify-integrity` | 894 |
| 18 | POST | `/repair-integrity` | 913 |
| 19 | GET | `/data-path` | 942 |
| 20 | POST | `/data-path` | 962 |
| 21 | DELETE | `/data-path` | 1025 |
| 22 | POST | `/browse-dir` | 1058 |
| 23 | POST | `/open-path` | 1125 |
| 24 | POST | `/pick-folder` | 1154 |

### 3.30 `backend/src/routes/units.js`

- No top-level named function/class symbols detected.

### 3.31 `backend/src/routes/users.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getClientKey` | function | 47 |
| 2 | `parseJson` | function | 53 |
| 3 | `normalizeLookupText` | function | 61 |
| 4 | `normalizePhoneLookup` | function | 65 |
| 5 | `findUserIdentityConflict` | function | 69 |
| 6 | `getMergedPermissions` | function | 137 |
| 7 | `isPrimaryAdmin` | function | 146 |
| 8 | `hasAdminControl` | function | 153 |
| 9 | `canManageTarget` | function | 166 |
| 10 | `getActorFromRequest` | function | 179 |
| 11 | `requireAdminControl` | function | 186 |
| 12 | `getUserSecurityContext` | function | 199 |
| 13 | `getUserWithRole` | function | 209 |
| 14 | `syncLocalEmailVerification` | function | 224 |
| 15 | `repairSupabaseIdentityForUser` | function | 255 |
| 16 | `sanitizeUserRow` | function | 284 |
| 17 | `isValidEmail` | function | 300 |
| 18 | `getAuthIdentityList` | function | 305 |
| 19 | `buildAuthMethodsPayload` | function | 309 |

#### 3.31.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/users` | 341 |
| 2 | GET | `/users/:id/profile` | 362 |
| 3 | GET | `/users/:id/auth-methods` | 381 |
| 4 | POST | `/users/:id/provider-disconnect` | 411 |
| 5 | POST | `/users/avatar-upload` | 497 |
| 6 | POST | `/users/:id/contact-verification/request` | 509 |
| 7 | POST | `/users/:id/contact-verification/confirm` | 513 |
| 8 | POST | `/users` | 520 |
| 9 | PUT | `/users/:id` | 617 |
| 10 | PUT | `/users/:id/profile` | 735 |
| 11 | POST | `/users/:id/change-password` | 874 |
| 12 | POST | `/users/:id/reset-password` | 916 |
| 13 | GET | `/roles` | 953 |
| 14 | POST | `/roles` | 959 |
| 15 | PUT | `/roles/:id` | 977 |
| 16 | DELETE | `/roles/:id` | 996 |

### 3.32 `backend/src/security.js`

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

### 3.33 `backend/src/serverUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `sanitizeObjectKeys` | function | 27 |
| 2 | `sanitizeStringValue` | function | 46 |
| 3 | `sanitizeRequestPayload` | function | 52 |
| 4 | `sanitizeDeepStrings` | function | 59 |
| 5 | `isApiOrHealthPath` | function | 76 |
| 6 | `isSpaFallbackEligible` | function | 80 |
| 7 | `setNoStoreHeaders` | function | 88 |
| 8 | `setHtmlNoCacheHeaders` | function | 92 |
| 9 | `setTunnelSecurityHeaders` | function | 98 |
| 10 | `setFrontendStaticHeaders` | function | 131 |
| 11 | `setUploadStaticHeaders` | function | 149 |
| 12 | `mapServerError` | function | 156 |

### 3.34 `backend/src/services/aiGateway.js`

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
| 11 | `callChatProvider` | function | 177 |
| 12 | `testProviderConfig` | function | 269 |

### 3.35 `backend/src/services/firebaseAuth.js`

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

### 3.36 `backend/src/services/googleDriveSync.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `nowIso` | function | 45 |
| 2 | `trim` | function | 49 |
| 3 | `toBool` | function | 53 |
| 4 | `clamp` | function | 61 |
| 5 | `escapeDriveQueryValue` | function | 67 |
| 6 | `readSettingsMap` | function | 71 |
| 7 | `writeSettingsMap` | function | 81 |
| 8 | `clearDriveSyncMappings` | function | 99 |
| 9 | `resetDriveSyncRootState` | function | 103 |
| 10 | `getDriveSyncConfig` | function | 110 |
| 11 | `getDriveSyncEntriesMap` | function | 131 |
| 12 | `upsertDriveSyncEntry` | function | 142 |
| 13 | `deleteDriveSyncEntry` | function | 168 |
| 14 | `deleteDriveSyncEntriesUnder` | function | 172 |
| 15 | `inferMimeType` | function | 179 |
| 16 | `md5File` | function | 194 |
| 17 | `buildMultipartBody` | function | 200 |
| 18 | `exchangeRefreshToken` | function | 217 |
| 19 | `exchangeAuthorizationCode` | function | 236 |
| 20 | `driveApiRequest` | function | 259 |
| 21 | `driveApiUpload` | function | 276 |
| 22 | `fetchDriveUserProfile` | function | 292 |
| 23 | `findDriveItem` | function | 307 |
| 24 | `findDriveItems` | function | 312 |
| 25 | `listDriveChildren` | function | 327 |
| 26 | `getDriveFileIfExists` | function | 336 |
| 27 | `removeDuplicateDriveItems` | function | 348 |
| 28 | `createDriveFolder` | function | 360 |
| 29 | `ensureRootFolder` | function | 372 |
| 30 | `ensureSnapshotLayout` | function | 391 |
| 31 | `shouldSkipSnapshotFile` | function | 397 |
| 32 | `createDataRootSnapshot` | function | 402 |
| 33 | `collectSnapshotItems` | function | 432 |
| 34 | `ensureRemoteDirectories` | function | 461 |
| 35 | `uploadDriveFile` | function | 496 |
| 36 | `updateDriveFile` | function | 511 |
| 37 | `removeDriveFile` | function | 522 |
| 38 | `runDriveSync` | function | 534 |
| 39 | `scheduleDriveSync` | function | 689 |
| 40 | `getDriveSyncStatus` | function | 712 |
| 41 | `beginGoogleDriveOAuth` | function | 743 |
| 42 | `prunePendingOauthStates` | function | 762 |
| 43 | `finalizeGoogleDriveOAuth` | function | 769 |
| 44 | `saveDriveSyncPreferences` | function | 811 |
| 45 | `disconnectDriveSync` | function | 830 |
| 46 | `schedulePeriodicDriveSync` | function | 848 |

### 3.37 `backend/src/services/portalAi.js`

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

### 3.38 `backend/src/services/supabaseAuth.js`

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
| 10 | `isSupabaseAuthConfigured` | function | 64 |
| 11 | `hasSupabaseAdminCredentials` | function | 68 |
| 12 | `hasSupabasePublicCredentials` | function | 72 |
| 13 | `buildSupabaseUrl` | function | 76 |
| 14 | `normalizeRedirectTo` | function | 80 |
| 15 | `getSupabaseAuthPublicConfig` | function | 85 |
| 16 | `normalizeProviderError` | function | 101 |
| 17 | `parseResponseData` | function | 118 |
| 18 | `callSupabasePublic` | function | 126 |
| 19 | `callSupabaseAdmin` | function | 159 |
| 20 | `getBanDurationForActiveState` | function | 193 |
| 21 | `buildUserMetadata` | function | 197 |
| 22 | `buildAppMetadata` | function | 207 |
| 23 | `getIdentityProviders` | function | 216 |
| 24 | `summarizeAuthUser` | function | 237 |
| 25 | `isLocalUserActive` | function | 254 |
| 26 | `getAuthUserById` | function | 258 |
| 27 | `getAuthUserFromAccessToken` | function | 266 |
| 28 | `listAuthUsersPage` | function | 276 |
| 29 | `findAuthUserByEmail` | function | 295 |
| 30 | `createOrUpdateAuthUser` | function | 315 |
| 31 | `updateAuthPassword` | function | 365 |
| 32 | `setAuthUserActive` | function | 384 |
| 33 | `verifyPasswordWithSupabase` | function | 399 |
| 34 | `unlinkAuthIdentity` | function | 424 |
| 35 | `sendSupabaseVerificationEmail` | function | 438 |
| 36 | `sendSupabasePasswordRecoveryEmail` | function | 477 |
| 37 | `buildOauthStartUrl` | function | 501 |

### 3.39 `backend/src/services/verification.js`

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

### 3.40 `backend/src/sessionAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `hashToken` | function | 11 |
| 2 | `buildSessionExpiry` | function | 15 |
| 3 | `createAuthSession` | function | 25 |
| 4 | `getPresentedSessionToken` | function | 46 |
| 5 | `getSessionUser` | function | 70 |
| 6 | `revokeAuthSession` | function | 133 |

### 3.41 `backend/src/systemFsWorker.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatBackupStamp` | function | 15 |
| 2 | `pad` | const arrow | 17 |
| 3 | `respond` | function | 21 |
| 4 | `fail` | function | 25 |
| 5 | `runExportFolder` | function | 30 |
| 6 | `runRelocateDataRoot` | function | 70 |
| 7 | `main` | function | 77 |

### 3.42 `backend/src/uploadSecurity.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `bufferStartsWith` | function | 11 |
| 2 | `isLikelyCsvBuffer` | function | 15 |
| 3 | `detectBufferKind` | function | 28 |
| 4 | `getExpectedUploadedKind` | function | 42 |
| 5 | `validateImageMetadata` | function | 51 |
| 6 | `validateUploadedBuffer` | function | 65 |
| 7 | `validateUploadedPath` | function | 76 |

### 3.43 `backend/src/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `attachWss` | function | 19 |

### 3.44 `ops/scripts/backend/verify-data-integrity.js`

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

