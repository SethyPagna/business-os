# Backend Function Reference

Auto-generated symbol and route inventory for backend files. Regenerate with `node ops/scripts/generate-doc-reference.js`.

## 1. Coverage Summary

Total files documented: **61**

## 2. Symbol Count by File

| No. | File | Symbols | Route handlers |
|---:|---|---:|---:|
| 1 | `backend/server.js` | 14 | 0 |
| 2 | `backend/src/accessControl.js` | 16 | 0 |
| 3 | `backend/src/authOtpGuards.js` | 3 | 0 |
| 4 | `backend/src/backupSchema.js` | 3 | 0 |
| 5 | `backend/src/config/index.js` | 23 | 0 |
| 6 | `backend/src/conflictControl.js` | 5 | 0 |
| 7 | `backend/src/contactOptions.js` | 8 | 0 |
| 8 | `backend/src/database.js` | 13 | 0 |
| 9 | `backend/src/dataPath/index.js` | 9 | 0 |
| 10 | `backend/src/fileAssets.js` | 24 | 0 |
| 11 | `backend/src/helpers.js` | 18 | 0 |
| 12 | `backend/src/idempotency.js` | 1 | 0 |
| 13 | `backend/src/importCsv.js` | 8 | 0 |
| 14 | `backend/src/importParsing.js` | 6 | 0 |
| 15 | `backend/src/middleware.js` | 21 | 0 |
| 16 | `backend/src/money.js` | 3 | 0 |
| 17 | `backend/src/netSecurity.js` | 7 | 0 |
| 18 | `backend/src/organizationContext/index.js` | 14 | 0 |
| 19 | `backend/src/portalUtils.js` | 6 | 0 |
| 20 | `backend/src/productDiscounts.js` | 9 | 0 |
| 21 | `backend/src/productImportPolicies.js` | 8 | 0 |
| 22 | `backend/src/requestContext.js` | 5 | 0 |
| 23 | `backend/src/routes/actionHistory.js` | 7 | 3 |
| 24 | `backend/src/routes/ai.js` | 2 | 6 |
| 25 | `backend/src/routes/auth.js` | 26 | 15 |
| 26 | `backend/src/routes/branches.js` | 2 | 7 |
| 27 | `backend/src/routes/catalog.js` | 0 | 2 |
| 28 | `backend/src/routes/categories.js` | 2 | 4 |
| 29 | `backend/src/routes/contacts.js` | 14 | 15 |
| 30 | `backend/src/routes/customTables.js` | 8 | 6 |
| 31 | `backend/src/routes/files.js` | 3 | 3 |
| 32 | `backend/src/routes/importJobs.js` | 6 | 11 |
| 33 | `backend/src/routes/inventory.js` | 4 | 4 |
| 34 | `backend/src/routes/notifications.js` | 10 | 1 |
| 35 | `backend/src/routes/organizations.js` | 0 | 3 |
| 36 | `backend/src/routes/portal.js` | 25 | 10 |
| 37 | `backend/src/routes/products.js` | 34 | 7 |
| 38 | `backend/src/routes/returns.js` | 7 | 5 |
| 39 | `backend/src/routes/sales.js` | 14 | 7 |
| 40 | `backend/src/routes/settings.js` | 5 | 3 |
| 41 | `backend/src/routes/system/index.js` | 30 | 28 |
| 42 | `backend/src/routes/units.js` | 3 | 0 |
| 43 | `backend/src/routes/users.js` | 21 | 16 |
| 44 | `backend/src/runtimeState/index.js` | 6 | 0 |
| 45 | `backend/src/security.js` | 13 | 0 |
| 46 | `backend/src/serverUtils.js` | 22 | 0 |
| 47 | `backend/src/services/aiGateway.js` | 12 | 0 |
| 48 | `backend/src/services/firebaseAuth.js` | 22 | 0 |
| 49 | `backend/src/services/googleDriveSync/index.js` | 49 | 0 |
| 50 | `backend/src/services/importJobs.js` | 57 | 0 |
| 51 | `backend/src/services/portalAi.js` | 29 | 0 |
| 52 | `backend/src/services/supabaseAuth.js` | 37 | 0 |
| 53 | `backend/src/services/verification.js` | 21 | 0 |
| 54 | `backend/src/sessionAuth.js` | 8 | 0 |
| 55 | `backend/src/settingsSnapshot.js` | 7 | 0 |
| 56 | `backend/src/storage/organizationFolders.js` | 5 | 0 |
| 57 | `backend/src/systemFsWorker.js` | 7 | 0 |
| 58 | `backend/src/uploadReferenceCleanup.js` | 2 | 0 |
| 59 | `backend/src/uploadSecurity.js` | 7 | 0 |
| 60 | `backend/src/websocket.js` | 1 | 0 |
| 61 | `ops/scripts/backend/verify-data-integrity.js` | 10 | 0 |

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
| 8 | `mountTransfersAlias` | function | 136 |
| 9 | `mountSpaFallback` | function | 151 |
| 10 | `mountErrorHandler` | function | 170 |
| 11 | `getStartupBanner` | function | 184 |
| 12 | `closeDatabase` | function | 205 |
| 13 | `registerShutdownHandlers` | function | 212 |
| 14 | `bootstrapServer` | function | 230 |

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

### 3.3 `backend/src/authOtpGuards.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeUserId` | function | 5 |
| 2 | `canManageOtpTarget` | function | 10 |
| 3 | `requiresSelfOtpDisablePassword` | function | 20 |

### 3.4 `backend/src/backupSchema.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `countRowsByTable` | function | 69 |
| 2 | `countCustomTableRows` | function | 77 |
| 3 | `buildBackupSummary` | function | 83 |

### 3.5 `backend/src/config/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `isDefaultDataMarker` | function | 49 |
| 2 | `resolveStoredDataDir` | function | 54 |
| 3 | `normalizeSelectedDataDir` | function | 61 |
| 4 | `readDataLocation` | function | 73 |
| 5 | `writeDataLocation` | function | 84 |
| 6 | `pathExists` | function | 100 |
| 7 | `normalizeOrganizationSeed` | function | 104 |
| 8 | `readPrimaryOrganizationSeed` | function | 111 |
| 9 | `ensureDirectory` | function | 143 |
| 10 | `copyTree` | function | 147 |
| 11 | `normalizePathForCompare` | function | 162 |
| 12 | `isSamePath` | function | 166 |
| 13 | `getOrganizationDbPath` | function | 170 |
| 14 | `isHealthySqliteDatabase` | function | 174 |
| 15 | `isOrganizationRuntimeRoot` | function | 187 |
| 16 | `ensureOrganizationRuntimeLayout` | function | 192 |
| 17 | `writeMigrationMarker` | function | 198 |
| 18 | `moveOrganizationRootPreservingSource` | function | 208 |
| 19 | `migrateLegacySharedRootToOrganization` | function | 239 |
| 20 | `detectExistingOrganizationRuntimeRoot` | function | 259 |
| 21 | `STORAGE_ROOT` | const arrow | 271 |
| 22 | `PRIMARY_ORGANIZATION_SEED` | const arrow | 279 |
| 23 | `DATA_ROOT` | const arrow | 303 |

### 3.6 `backend/src/conflictControl.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `WriteConflictError` | class | 3 |
| 2 | `normalizeUpdatedAt` | function | 17 |
| 3 | `getExpectedUpdatedAt` | function | 22 |
| 4 | `assertUpdatedAtMatch` | function | 31 |
| 5 | `sendWriteConflict` | function | 43 |

### 3.7 `backend/src/contactOptions.js`

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

### 3.8 `backend/src/database.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `tableHasColumn` | function | 830 |
| 2 | `ensureColumn` | function | 840 |
| 3 | `normalizeUserPhoneLookup` | function | 861 |
| 4 | `slugifyOrgName` | function | 866 |
| 5 | `generateOrgPublicId` | function | 875 |
| 6 | `seedIfEmpty` | function | 1004 |
| 7 | `ensureDefaultOrganizationAndGroup` | function | 1015 |
| 8 | `ensurePrimaryAdminRoleAndUser` | function | 1087 |
| 9 | `buildDefaultSettingsSeed` | function | 1138 |
| 10 | `ensureDefaultSettings` | function | 1268 |
| 11 | `ensureDefaultBranches` | function | 1279 |
| 12 | `ensureDefaultUnits` | function | 1285 |
| 13 | `ensureCoreDataInvariants` | function | 1291 |

### 3.9 `backend/src/dataPath/index.js`

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

### 3.10 `backend/src/fileAssets.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ensureUploadsDirectory` | function | 48 |
| 2 | `getMimeTypeFromName` | function | 52 |
| 3 | `getMediaType` | function | 57 |
| 4 | `sanitizeOriginalFileName` | function | 66 |
| 5 | `preserveOriginalDisplayName` | function | 79 |
| 6 | `buildUniqueStoredName` | function | 87 |
| 7 | `shouldCompressImage` | function | 101 |
| 8 | `compressBufferForAsset` | function | 107 |
| 9 | `readImageDimensions` | function | 147 |
| 10 | `getFfmpegPath` | function | 160 |
| 11 | `optimizeStoredVideo` | function | 168 |
| 12 | `createFileAssetRecord` | function | 234 |
| 13 | `getFileAssetByPublicPath` | function | 314 |
| 14 | `listAssetRows` | function | 323 |
| 15 | `getUploadFilePath` | function | 345 |
| 16 | `collectUsage` | function | 350 |
| 17 | `serializeAssetRow` | function | 379 |
| 18 | `registerStoredAsset` | function | 389 |
| 19 | `registerUploadFromRequest` | function | 447 |
| 20 | `storeDataUrlAsset` | function | 460 |
| 21 | `backfillUploadAssets` | function | 483 |
| 22 | `listFileAssets` | function | 501 |
| 23 | `getFileAssetById` | function | 507 |
| 24 | `deleteFileAsset` | function | 512 |

### 3.11 `backend/src/helpers.js`

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
| 9 | `parseCSVRows` | function | 138 |
| 10 | `bulkImportCSV` | function | 162 |
| 11 | `parseCSVLine` | function | 188 |
| 12 | `importRows` | function | 208 |
| 13 | `verifyAndRepairStockQuantities` | function | 223 |
| 14 | `verifyAndRepairSaleStatuses` | function | 281 |
| 15 | `verifyAndRepairCostPrices` | function | 341 |
| 16 | `runDataIntegrityCheck` | function | 423 |
| 17 | `getSafeCostPrice` | function | 450 |
| 18 | `calculateSaleProfit` | function | 461 |

### 3.12 `backend/src/idempotency.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeClientRequestId` | function | 3 |

### 3.13 `backend/src/importCsv.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `stripBom` | function | 7 |
| 2 | `normalizeDigit` | function | 11 |
| 3 | `normalizeNumericText` | function | 19 |
| 4 | `countDelimiter` | function | 26 |
| 5 | `detectCsvDelimiter` | function | 45 |
| 6 | `parseDelimitedRows` | function | 52 |
| 7 | `normalizeCsvKey` | function | 97 |
| 8 | `parseCsvRows` | function | 105 |

### 3.14 `backend/src/importParsing.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeDigit` | function | 9 |
| 2 | `normalizeNumericText` | function | 17 |
| 3 | `removeCurrencyNoise` | function | 24 |
| 4 | `normalizeNumberSeparators` | function | 31 |
| 5 | `parseImportNumericValue` | function | 65 |
| 6 | `normalizeImportMoney` | function | 80 |

### 3.15 `backend/src/middleware.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `authToken` | function | 16 |
| 2 | `networkAccessGuard` | function | 29 |
| 3 | `sanitiseFilename` | function | 34 |
| 4 | `resolveExtension` | function | 66 |
| 5 | `compressibleImageFormat` | function | 78 |
| 6 | `compressImageFile` | function | 83 |
| 7 | `compressImageBuffer` | function | 132 |
| 8 | `getClientKey` | function | 178 |
| 9 | `routeRateLimit` | function | 184 |
| 10 | `createStorage` | function | 196 |
| 11 | `buildUpload` | function | 212 |
| 12 | `parsePermissionsValue` | function | 244 |
| 13 | `getMergedPermissions` | function | 254 |
| 14 | `isAdminControlUser` | function | 261 |
| 15 | `hasPermission` | function | 269 |
| 16 | `requirePermission` | function | 276 |
| 17 | `requireAnyPermission` | function | 288 |
| 18 | `getAuditActor` | function | 301 |
| 19 | `compressUpload` | function | 314 |
| 20 | `validateUploadedFile` | function | 328 |
| 21 | `validateUploadBufferPayload` | function | 339 |

### 3.16 `backend/src/money.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toFiniteNumber` | function | 3 |
| 2 | `roundUpToDecimals` | function | 8 |
| 3 | `normalizePriceValue` | function | 17 |

### 3.17 `backend/src/netSecurity.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `trim` | function | 26 |
| 2 | `normalizeHostname` | function | 30 |
| 3 | `isPrivateIpv4` | function | 34 |
| 4 | `isPrivateIpv6` | function | 47 |
| 5 | `isBlockedHostname` | function | 58 |
| 6 | `assertSafeOutboundUrl` | function | 69 |
| 7 | `isSafeExternalImageReference` | function | 97 |

### 3.18 `backend/src/organizationContext/index.js`

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
| 13 | `ensureOrganizationFilesystemLayout` | function | 158 |
| 14 | `getOrganizationStorageStatus` | function | 226 |

### 3.19 `backend/src/portalUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toTrimmedString` | function | 5 |
| 2 | `safeJsonParse` | function | 9 |
| 3 | `createAboutBlock` | function | 17 |
| 4 | `normalizeAboutBlocks` | function | 28 |
| 5 | `extractGoogleMapsEmbedUrl` | function | 47 |
| 6 | `normalizeGoogleMapsEmbed` | function | 55 |

### 3.20 `backend/src/productDiscounts.js`

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

### 3.21 `backend/src/productImportPolicies.js`

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

### 3.22 `backend/src/requestContext.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `cleanText` | function | 7 |
| 2 | `readHeader` | function | 13 |
| 3 | `extractRequestMeta` | function | 19 |
| 4 | `requestContextMiddleware` | function | 45 |
| 5 | `getRequestMeta` | function | 50 |

### 3.23 `backend/src/routes/actionHistory.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `parseJson` | function | 10 |
| 2 | `normalizeLimit` | function | 20 |
| 3 | `normalizeText` | function | 25 |
| 4 | `serializePayload` | function | 30 |
| 5 | `canReadAllHistory` | function | 39 |
| 6 | `getOwnedHistoryRow` | function | 43 |
| 7 | `mapRow` | function | 49 |

#### 3.23.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 58 |
| 2 | POST | `/` | 84 |
| 3 | PATCH | `/:id` | 115 |

### 3.24 `backend/src/routes/ai.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `listProviders` | function | 19 |
| 2 | `getProviderRow` | function | 28 |

#### 3.24.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/providers` | 32 |
| 2 | POST | `/providers` | 39 |
| 3 | PUT | `/providers/:id` | 94 |
| 4 | POST | `/providers/:id/test` | 161 |
| 5 | DELETE | `/providers/:id` | 199 |
| 6 | GET | `/responses` | 220 |

### 3.25 `backend/src/routes/auth.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getClientKey` | function | 90 |
| 2 | `applyRateLimit` | function | 103 |
| 3 | `getLoginLockKey` | function | 115 |
| 4 | `isReasonableCredentialLength` | function | 119 |
| 5 | `normalizeLookupText` | function | 124 |
| 6 | `isHttpUrl` | function | 128 |
| 7 | `buildPublicBaseUrl` | function | 132 |
| 8 | `resolvePasswordResetRedirect` | function | 139 |
| 9 | `loginIdentifierPreview` | function | 153 |
| 10 | `rejectLogin` | function | 167 |
| 11 | `getOtpSecret` | function | 189 |
| 12 | `requireOtpActor` | function | 193 |
| 13 | `getOtpTargetUser` | function | 199 |
| 14 | `buildUserPayload` | function | 214 |
| 15 | `resolveOrganizationLookup` | function | 246 |
| 16 | `findUserByIdentifier` | function | 252 |
| 17 | `getExactActiveUserById` | function | 321 |
| 18 | `normalizeOauthMode` | function | 336 |
| 19 | `isEmailIdentifier` | function | 341 |
| 20 | `getUserById` | function | 345 |
| 21 | `getSettingsSnapshot` | function | 349 |
| 22 | `getBootstrapSystemSnapshot` | function | 358 |
| 23 | `buildAuthenticatedBootstrap` | function | 390 |
| 24 | `generateTemporaryAuthPassword` | function | 419 |
| 25 | `issueAuthSession` | function | 423 |
| 26 | `updateLocalUserSupabaseIdentity` | function | 434 |

#### 3.25.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/verification-capabilities` | 460 |
| 2 | GET | `/bootstrap` | 476 |
| 3 | POST | `/login` | 485 |
| 4 | POST | `/oauth/start` | 572 |
| 5 | POST | `/oauth/complete` | 587 |
| 6 | POST | `/otp/verify` | 752 |
| 7 | POST | `/logout` | 807 |
| 8 | POST | `/session-duration` | 814 |
| 9 | POST | `/otp/setup` | 851 |
| 10 | POST | `/otp/confirm` | 875 |
| 11 | POST | `/otp/disable` | 910 |
| 12 | GET | `/otp/status/:userId` | 936 |
| 13 | POST | `/password-reset/otp` | 946 |
| 14 | POST | `/password-reset/email` | 1010 |
| 15 | POST | `/password-reset/complete` | 1066 |

### 3.26 `backend/src/routes/branches.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toDbBool` | function | 10 |
| 2 | `getStockTransferNoteColumn` | function | 18 |

#### 3.26.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 28 |
| 2 | POST | `/` | 33 |
| 3 | PUT | `/:id` | 55 |
| 4 | DELETE | `/:id` | 83 |
| 5 | GET | `/:id/stock` | 110 |
| 6 | GET | `/transfers/list` | 124 |
| 7 | POST | `/transfer` | 138 |

### 3.27 `backend/src/routes/catalog.js`

- No top-level named function/class symbols detected.

#### 3.27.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/meta` | 10 |
| 2 | GET | `/products` | 27 |

### 3.28 `backend/src/routes/categories.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeLookup` | function | 11 |
| 2 | `normalizeColor` | function | 15 |

#### 3.28.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 20 |
| 2 | POST | `/` | 24 |
| 3 | PUT | `/:id` | 48 |
| 4 | DELETE | `/:id` | 120 |

### 3.29 `backend/src/routes/contacts.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `cleanMembershipNumber` | function | 19 |
| 2 | `requireMembershipNumber` | function | 23 |
| 3 | `assertUniqueMembershipNumber` | function | 29 |
| 4 | `ensureMembershipNumber` | function | 43 |
| 5 | `normalizeFieldRule` | function | 48 |
| 6 | `resolveFieldValue` | function | 55 |
| 7 | `buildImportRows` | function | 66 |
| 8 | `normalizeConflictMode` | function | 76 |
| 9 | `toNumber` | function | 81 |
| 10 | `loadPointPolicy` | function | 86 |
| 11 | `calculatePolicyPoints` | function | 112 |
| 12 | `findExisting` | const arrow | 271 |
| 13 | `findExisting` | const arrow | 481 |
| 14 | `findExisting` | const arrow | 665 |

#### 3.29.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/customers` | 118 |
| 2 | POST | `/customers` | 186 |
| 3 | PUT | `/customers/:id` | 201 |
| 4 | DELETE | `/customers/:id` | 222 |
| 5 | POST | `/customers/bulk-import` | 238 |
| 6 | GET | `/suppliers` | 386 |
| 7 | POST | `/suppliers` | 390 |
| 8 | PUT | `/suppliers/:id` | 410 |
| 9 | DELETE | `/suppliers/:id` | 438 |
| 10 | POST | `/suppliers/bulk-import` | 454 |
| 11 | GET | `/delivery-contacts` | 578 |
| 12 | POST | `/delivery-contacts` | 582 |
| 13 | PUT | `/delivery-contacts/:id` | 598 |
| 14 | DELETE | `/delivery-contacts/:id` | 622 |
| 15 | POST | `/delivery-contacts/bulk-import` | 638 |

### 3.30 `backend/src/routes/customTables.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `humanizeTableName` | function | 11 |
| 2 | `serializeCustomTable` | function | 20 |
| 3 | `sanitizeCustomTableName` | function | 28 |
| 4 | `resolveCustomTableRow` | function | 34 |
| 5 | `escapeIdentifier` | function | 43 |
| 6 | `normalizeCustomTableSchema` | function | 47 |
| 7 | `tableHasColumn` | function | 68 |
| 8 | `ensureCustomTableRowVersioning` | function | 73 |

#### 3.30.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 85 |
| 2 | POST | `/` | 90 |
| 3 | GET | `/:name/data` | 142 |
| 4 | POST | `/:name/rows` | 152 |
| 5 | PUT | `/:name/rows/:id` | 175 |
| 6 | DELETE | `/:name/rows/:id` | 200 |

### 3.31 `backend/src/routes/files.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `parseFileAssetId` | function | 18 |
| 2 | `getFileListFilters` | function | 26 |
| 3 | `getDeviceMeta` | function | 38 |

#### 3.31.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 46 |
| 2 | POST | `/upload` | 56 |
| 3 | DELETE | `/:id` | 74 |

### 3.32 `backend/src/routes/importJobs.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ensureDir` | function | 28 |
| 2 | `getJobUploadRoot` | function | 32 |
| 3 | `getJobOr404` | function | 37 |
| 4 | `isAllowedImportFile` | function | 66 |
| 5 | `parsePolicy` | function | 90 |
| 6 | `parseRelativePaths` | function | 96 |

#### 3.32.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/queue/status` | 107 |
| 2 | GET | `/` | 111 |
| 3 | POST | `/` | 115 |
| 4 | GET | `/:id` | 132 |
| 5 | POST | `/:id/csv` | 150 |
| 6 | POST | `/:id/zip` | 164 |
| 7 | POST | `/:id/images` | 178 |
| 8 | POST | `/:id/start` | 191 |
| 9 | POST | `/:id/cancel` | 203 |
| 10 | POST | `/:id/retry` | 209 |
| 11 | GET | `/:id/errors.csv` | 220 |

### 3.33 `backend/src/routes/inventory.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeImportedTimestamp` | function | 11 |
| 2 | `recalcProductStock` | function | 19 |
| 3 | `cleanMoveReason` | function | 28 |
| 4 | `getBranchQty` | const arrow | 60 |

#### 3.33.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | POST | `/adjust` | 35 |
| 2 | POST | `/move-row` | 189 |
| 3 | GET | `/summary` | 370 |
| 4 | GET | `/movements` | 539 |

### 3.34 `backend/src/routes/notifications.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeBoolean` | function | 19 |
| 2 | `toNumber` | function | 27 |
| 3 | `loadNotificationPreferences` | function | 32 |
| 4 | `loadPointPolicy` | function | 55 |
| 5 | `calculatePolicyPoints` | function | 81 |
| 6 | `buildInventorySection` | function | 86 |
| 7 | `buildSalesSection` | function | 162 |
| 8 | `buildLoyaltySection` | function | 229 |
| 9 | `buildPortalSection` | function | 316 |
| 10 | `buildSystemSection` | function | 353 |

#### 3.34.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/summary` | 383 |

### 3.35 `backend/src/routes/organizations.js`

- No top-level named function/class symbols detected.

#### 3.35.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/bootstrap` | 15 |
| 2 | GET | `/search` | 27 |
| 3 | GET | `/current` | 33 |

### 3.36 `backend/src/routes/portal.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toNumber` | function | 23 |
| 2 | `normalizeBoolean` | function | 29 |
| 3 | `normalizePhone` | function | 35 |
| 4 | `normalizePublicPath` | function | 40 |
| 5 | `normalizeUrl` | function | 54 |
| 6 | `normalizeRedeemValueUsd` | function | 69 |
| 7 | `normalizeRedeemValueKhr` | function | 74 |
| 8 | `normalizeHexColor` | function | 81 |
| 9 | `normalizeFaqItems` | function | 87 |
| 10 | `normalizeProductIdList` | function | 100 |
| 11 | `loadSettingsMap` | function | 115 |
| 12 | `buildPortalConfig` | function | 123 |
| 13 | `buildRankMap` | function | 248 |
| 14 | `getPortalProductSignals` | function | 267 |
| 15 | `calculatePointsValue` | function | 365 |
| 16 | `summarizePoints` | function | 375 |
| 17 | `getPortalProducts` | function | 415 |
| 18 | `getPortalCatalogMeta` | function | 490 |
| 19 | `findCustomerByMembership` | function | 536 |
| 20 | `sanitizeScreenshots` | function | 546 |
| 21 | `materializePortalScreenshots` | function | 555 |
| 22 | `sanitizeAiProfile` | function | 573 |
| 23 | `getVisitorFingerprint` | function | 585 |
| 24 | `getClientKey` | function | 591 |
| 25 | `applyPortalRateLimit` | function | 596 |

#### 3.36.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/config` | 604 |
| 2 | GET | `/bootstrap` | 608 |
| 3 | GET | `/catalog/meta` | 617 |
| 4 | GET | `/catalog/products` | 621 |
| 5 | GET | `/ai/status` | 626 |
| 6 | POST | `/ai/chat` | 638 |
| 7 | GET | `/membership/:membershipNumber` | 714 |
| 8 | POST | `/submissions` | 857 |
| 9 | GET | `/submissions/review` | 904 |
| 10 | PATCH | `/submissions/:id/review` | 937 |

### 3.37 `backend/src/routes/products.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getActiveBranches` | function | 27 |
| 2 | `getDefaultBranch` | function | 31 |
| 3 | `seedBranchRows` | function | 35 |
| 4 | `recalcProductStock` | function | 40 |
| 5 | `normalizeImageGallery` | function | 49 |
| 6 | `syncProductImageGallery` | function | 56 |
| 7 | `loadProductImageMap` | function | 74 |
| 8 | `attachImageGallery` | function | 92 |
| 9 | `findProductByClientRequestId` | function | 104 |
| 10 | `assertUniqueProductFields` | function | 114 |
| 11 | `hasOwnField` | function | 141 |
| 12 | `pickField` | function | 145 |
| 13 | `ensureParentProductExists` | function | 149 |
| 14 | `markParentProductAsGroup` | function | 159 |
| 15 | `normalizeImportLookup` | function | 164 |
| 16 | `normalizeImportFlagValue` | function | 168 |
| 17 | `getProductImportDetailSignature` | function | 217 |
| 18 | `chooseImportParentProduct` | function | 227 |
| 19 | `normalizeImportAction` | function | 242 |
| 20 | `parseOptionalImportId` | function | 250 |
| 21 | `discountInsertColumns` | function | 257 |
| 22 | `discountValues` | function | 261 |
| 23 | `normalizeLookup` | const arrow | 675 |
| 24 | `resolveImage` | const arrow | 772 |
| 25 | `ensureCategory` | const arrow | 788 |
| 26 | `ensureUnit` | const arrow | 802 |
| 27 | `ensureBrand` | const arrow | 816 |
| 28 | `ensureSupplier` | const arrow | 828 |
| 29 | `determineBranch` | const arrow | 839 |
| 30 | `handleBranch` | const arrow | 858 |
| 31 | `isDirectImageRef` | const arrow | 883 |
| 32 | `normalizeDirectImageRef` | const arrow | 894 |
| 33 | `parseIncomingImageRefs` | const arrow | 901 |
| 34 | `loadCurrentGallery` | const arrow | 934 |

#### 3.37.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 277 |
| 2 | POST | `/variant` | 304 |
| 3 | POST | `/` | 372 |
| 4 | PUT | `/:id` | 444 |
| 5 | DELETE | `/:id` | 634 |
| 6 | POST | `/upload-image` | 662 |
| 7 | POST | `/bulk-import` | 670 |

### 3.38 `backend/src/routes/returns.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `refreshProductStockQuantity` | function | 13 |
| 2 | `refreshProductStockQuantities` | function | 26 |
| 3 | `normalizeScope` | function | 36 |
| 4 | `toNumber` | function | 44 |
| 5 | `findReturnByClientRequestId` | function | 49 |
| 6 | `assertReturnableItems` | function | 59 |
| 7 | `assertSupplierReturnableStock` | function | 374 |

#### 3.38.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/returns` | 133 |
| 2 | GET | `/returns/:id` | 151 |
| 3 | POST | `/returns` | 159 |
| 4 | POST | `/returns/supplier` | 395 |
| 5 | PATCH | `/returns/:id` | 582 |

### 3.39 `backend/src/routes/sales.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeImportedTimestamp` | function | 11 |
| 2 | `getSaleItemCosts` | function | 19 |
| 3 | `assertSaleStockAvailable` | function | 45 |
| 4 | `findCustomerForSaleAssignment` | function | 74 |
| 5 | `parseBranchId` | function | 95 |
| 6 | `getActiveBranchContext` | function | 100 |
| 7 | `requireActiveBranch` | function | 115 |
| 8 | `resolveSaleItemBranchId` | function | 122 |
| 9 | `normalizeSaleItems` | function | 133 |
| 10 | `summarizeSaleBranch` | function | 163 |
| 11 | `refreshProductStockQuantity` | function | 187 |
| 12 | `refreshProductStockQuantities` | function | 200 |
| 13 | `fetchSaleItemsWithBranches` | function | 207 |
| 14 | `findSaleByClientRequestId` | function | 216 |

#### 3.39.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | POST | `/sales` | 227 |
| 2 | PATCH | `/sales/:id/status` | 413 |
| 3 | PATCH | `/sales/:id/customer` | 552 |
| 4 | GET | `/sales` | 647 |
| 5 | GET | `/sales/export` | 713 |
| 6 | GET | `/dashboard` | 881 |
| 7 | GET | `/analytics` | 980 |

### 3.40 `backend/src/routes/settings.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeLookup` | function | 11 |
| 2 | `normalizeBrandOptionsValue` | function | 15 |
| 3 | `settingsHasUpdatedAt` | function | 39 |
| 4 | `getSettingsSnapshot` | function | 48 |
| 5 | `getSettingsUpdatedAt` | function | 55 |

#### 3.40.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/` | 67 |
| 2 | GET | `/meta` | 72 |
| 3 | POST | `/` | 79 |

### 3.41 `backend/src/routes/system/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `q` | function | 75 |
| 2 | `getClientKey` | function | 79 |
| 3 | `applyRouteRateLimit` | function | 85 |
| 4 | `runFsWorker` | function | 97 |
| 5 | `finish` | const arrow | 109 |
| 6 | `getHostUiAvailability` | function | 153 |
| 7 | `buildRequestBaseUrl` | function | 162 |
| 8 | `resolveDriveRedirectUri` | function | 169 |
| 9 | `getTableColumns` | function | 176 |
| 10 | `getSafeTableCount` | function | 180 |
| 11 | `buildMigrationTableCounts` | function | 188 |
| 12 | `buildScaleMigrationStatus` | function | 196 |
| 13 | `extractUploadPathsFromText` | function | 245 |
| 14 | `collectBackupUploads` | function | 254 |
| 15 | `addUpload` | const arrow | 258 |
| 16 | `restoreBackupUploads` | function | 288 |
| 17 | `deleteAllUploads` | function | 298 |
| 18 | `getBackupDataRootCandidate` | function | 307 |
| 19 | `readBackupTablesFromDataRoot` | function | 319 |
| 20 | `restoreUploadsFromDataRoot` | function | 352 |
| 21 | `restoreSnapshotTables` | function | 366 |
| 22 | `replaceTableRows` | function | 422 |
| 23 | `normaliseBackupTables` | function | 457 |
| 24 | `normaliseBackupCustomTableRows` | function | 486 |
| 25 | `repairRelationalConsistency` | function | 491 |
| 26 | `getCustomTableNames` | function | 499 |
| 27 | `parseCustomTableDefinition` | function | 505 |
| 28 | `recreateCustomTable` | function | 548 |
| 29 | `listWindowsFsRoots` | const arrow | 1183 |
| 30 | `listDriveRoots` | const arrow | 1200 |

#### 3.41.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/audit-logs` | 559 |
| 2 | GET | `/debug/log` | 563 |
| 3 | GET | `/config` | 569 |
| 4 | GET | `/drive-sync/status` | 602 |
| 5 | POST | `/drive-sync/preferences` | 608 |
| 6 | POST | `/drive-sync/oauth/start` | 619 |
| 7 | GET | `/drive-sync/oauth/callback` | 662 |
| 8 | POST | `/drive-sync/disconnect` | 690 |
| 9 | POST | `/drive-sync/forget-credentials` | 699 |
| 10 | POST | `/drive-sync/sync-now` | 716 |
| 11 | GET | `/backup/export` | 728 |
| 12 | POST | `/backup/export-folder` | 756 |
| 13 | POST | `/backup/import` | 795 |
| 14 | POST | `/backup/import-folder` | 818 |
| 15 | POST | `/reset-data` | 860 |
| 16 | POST | `/factory-reset` | 903 |
| 17 | POST | `/sync/push` | 943 |
| 18 | GET | `/verify-integrity` | 953 |
| 19 | POST | `/repair-integrity` | 982 |
| 20 | GET | `/data-path` | 1012 |
| 21 | GET | `/scale-migration/status` | 1033 |
| 22 | POST | `/scale-migration/prepare` | 1042 |
| 23 | POST | `/scale-migration/run` | 1066 |
| 24 | POST | `/data-path` | 1084 |
| 25 | DELETE | `/data-path` | 1147 |
| 26 | POST | `/browse-dir` | 1180 |
| 27 | POST | `/open-path` | 1247 |
| 28 | POST | `/pick-folder` | 1276 |

### 3.42 `backend/src/routes/units.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeLookup` | function | 12 |
| 2 | `normalizeUnitColor` | function | 16 |
| 3 | `updateUnitHandler` | function | 50 |

### 3.43 `backend/src/routes/users.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getClientKey` | function | 49 |
| 2 | `parseJson` | function | 55 |
| 3 | `normalizeLookupText` | function | 63 |
| 4 | `normalizePhoneLookup` | function | 67 |
| 5 | `findUserIdentityConflict` | function | 71 |
| 6 | `getMergedPermissions` | function | 139 |
| 7 | `isPrimaryAdmin` | function | 148 |
| 8 | `hasAdminControl` | function | 155 |
| 9 | `canManageTarget` | function | 168 |
| 10 | `getActorFromRequest` | function | 181 |
| 11 | `requireAdminControl` | function | 188 |
| 12 | `getUserSecurityContext` | function | 201 |
| 13 | `getUserWithRole` | function | 211 |
| 14 | `syncLocalEmailVerification` | function | 226 |
| 15 | `repairSupabaseIdentityForUser` | function | 257 |
| 16 | `sanitizeUserRow` | function | 286 |
| 17 | `isValidEmail` | function | 302 |
| 18 | `getAuthIdentityList` | function | 307 |
| 19 | `isUuid` | function | 313 |
| 20 | `resolveAuthIdentityUuid` | function | 317 |
| 21 | `buildAuthMethodsPayload` | function | 326 |

#### 3.43.1 Route Handlers

| No. | Method | Path | Line |
|---:|---|---|---:|
| 1 | GET | `/users` | 358 |
| 2 | GET | `/users/:id/profile` | 379 |
| 3 | GET | `/users/:id/auth-methods` | 398 |
| 4 | POST | `/users/:id/provider-disconnect` | 428 |
| 5 | POST | `/users/avatar-upload` | 515 |
| 6 | POST | `/users/:id/contact-verification/request` | 527 |
| 7 | POST | `/users/:id/contact-verification/confirm` | 531 |
| 8 | POST | `/users` | 538 |
| 9 | PUT | `/users/:id` | 635 |
| 10 | PUT | `/users/:id/profile` | 755 |
| 11 | POST | `/users/:id/change-password` | 899 |
| 12 | POST | `/users/:id/reset-password` | 942 |
| 13 | GET | `/roles` | 980 |
| 14 | POST | `/roles` | 990 |
| 15 | PUT | `/roles/:id` | 1008 |
| 16 | DELETE | `/roles/:id` | 1038 |

### 3.44 `backend/src/runtimeState/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ensureRuntimeMetaDir` | function | 11 |
| 2 | `readRuntimeState` | function | 15 |
| 3 | `writeRuntimeState` | function | 32 |
| 4 | `getRuntimeState` | function | 38 |
| 5 | `bumpStorageVersion` | function | 48 |
| 6 | `buildRuntimeDescriptor` | function | 57 |

### 3.45 `backend/src/security.js`

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

### 3.46 `backend/src/serverUtils.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `buildOriginFromParts` | function | 13 |
| 2 | `parseOriginHost` | function | 24 |
| 3 | `normalizeConfiguredHost` | function | 34 |
| 4 | `isAllowedRequestOrigin` | function | 44 |
| 5 | `isAllowedWebSocketOrigin` | function | 54 |
| 6 | `hostIsLoopbackPair` | function | 72 |
| 7 | `getTrustedDocumentOrigins` | function | 77 |
| 8 | `addOrigin` | const arrow | 79 |
| 9 | `buildPermissionsPolicy` | function | 105 |
| 10 | `sanitizeObjectKeys` | function | 134 |
| 11 | `sanitizeStringValue` | function | 153 |
| 12 | `sanitizeRequestPayload` | function | 159 |
| 13 | `sanitizeDeepStrings` | function | 166 |
| 14 | `isApiOrHealthPath` | function | 183 |
| 15 | `isSpaFallbackEligible` | function | 187 |
| 16 | `setNoStoreHeaders` | function | 195 |
| 17 | `setHtmlNoCacheHeaders` | function | 199 |
| 18 | `isCustomerPortalRoutePath` | function | 205 |
| 19 | `setTunnelSecurityHeaders` | function | 210 |
| 20 | `setFrontendStaticHeaders` | function | 251 |
| 21 | `setUploadStaticHeaders` | function | 269 |
| 22 | `mapServerError` | function | 276 |

### 3.47 `backend/src/services/aiGateway.js`

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

### 3.48 `backend/src/services/firebaseAuth.js`

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

### 3.49 `backend/src/services/googleDriveSync/index.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `nowIso` | function | 53 |
| 2 | `trim` | function | 57 |
| 3 | `toBool` | function | 61 |
| 4 | `clamp` | function | 69 |
| 5 | `escapeDriveQueryValue` | function | 75 |
| 6 | `readSettingsMap` | function | 79 |
| 7 | `writeSettingsMap` | function | 89 |
| 8 | `clearDriveSyncMappings` | function | 107 |
| 9 | `resetDriveSyncRootState` | function | 111 |
| 10 | `getDriveSyncConfig` | function | 118 |
| 11 | `getDriveSyncEntriesMap` | function | 145 |
| 12 | `upsertDriveSyncEntry` | function | 156 |
| 13 | `deleteDriveSyncEntry` | function | 182 |
| 14 | `deleteDriveSyncEntriesUnder` | function | 186 |
| 15 | `inferMimeType` | function | 193 |
| 16 | `md5File` | function | 208 |
| 17 | `buildMultipartBody` | function | 214 |
| 18 | `exchangeRefreshToken` | function | 231 |
| 19 | `exchangeAuthorizationCode` | function | 250 |
| 20 | `driveApiRequest` | function | 273 |
| 21 | `driveApiUpload` | function | 290 |
| 22 | `fetchDriveUserProfile` | function | 306 |
| 23 | `findDriveItem` | function | 321 |
| 24 | `findDriveItems` | function | 326 |
| 25 | `listDriveChildren` | function | 341 |
| 26 | `getDriveFileIfExists` | function | 350 |
| 27 | `removeDuplicateDriveItems` | function | 362 |
| 28 | `createDriveFolder` | function | 374 |
| 29 | `ensureRootFolder` | function | 386 |
| 30 | `buildManagedSnapshotRoot` | function | 405 |
| 31 | `ensureSnapshotLayout` | function | 409 |
| 32 | `shouldSkipSnapshotFile` | function | 415 |
| 33 | `createDataRootSnapshot` | function | 420 |
| 34 | `collectSnapshotItems` | function | 450 |
| 35 | `ensureRemoteDirectories` | function | 479 |
| 36 | `uploadDriveFile` | function | 514 |
| 37 | `updateDriveFile` | function | 529 |
| 38 | `removeDriveFile` | function | 540 |
| 39 | `runDriveSync` | function | 552 |
| 40 | `scheduleDriveSync` | function | 706 |
| 41 | `getDriveSyncStatus` | function | 729 |
| 42 | `beginGoogleDriveOAuth` | function | 760 |
| 43 | `prunePendingOauthStates` | function | 779 |
| 44 | `finalizeGoogleDriveOAuth` | function | 786 |
| 45 | `saveDriveSyncPreferences` | function | 828 |
| 46 | `disconnectDriveSync` | function | 847 |
| 47 | `updateEnvSettingLines` | function | 863 |
| 48 | `forgetDriveSyncCredentials` | function | 876 |
| 49 | `schedulePeriodicDriveSync` | function | 891 |

### 3.50 `backend/src/services/importJobs.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `nowIso` | function | 42 |
| 2 | `safeJson` | function | 46 |
| 3 | `stringify` | function | 51 |
| 4 | `ensureDir` | function | 55 |
| 5 | `ensureImportRoot` | function | 59 |
| 6 | `getJobRoot` | function | 63 |
| 7 | `createImportJob` | function | 67 |
| 8 | `getImportJob` | function | 87 |
| 9 | `listImportJobs` | function | 97 |
| 10 | `updateJob` | function | 110 |
| 11 | `addJobError` | function | 135 |
| 12 | `getJobErrors` | function | 142 |
| 13 | `addJobFile` | function | 152 |
| 14 | `getJobFiles` | function | 171 |
| 15 | `markJobCancelled` | function | 176 |
| 16 | `isCancelled` | function | 180 |
| 17 | `normalizeLookup` | function | 184 |
| 18 | `normalizeText` | function | 188 |
| 19 | `getMimeTypeFromName` | function | 192 |
| 20 | `normalizeProductSignature` | function | 246 |
| 21 | `chooseParentProduct` | function | 254 |
| 22 | `normalizeImportAction` | function | 268 |
| 23 | `parseOptionalImportId` | function | 276 |
| 24 | `parseIncomingImageRefs` | function | 281 |
| 25 | `syncProductImageGallery` | function | 315 |
| 26 | `loadCurrentGallery` | function | 338 |
| 27 | `ensureParentProductExists` | function | 345 |
| 28 | `assertUniqueProductFields` | function | 354 |
| 29 | `copyImageIntoAssets` | function | 380 |
| 30 | `resolveImageGallery` | function | 398 |
| 31 | `ensureSettingOptionMap` | function | 444 |
| 32 | `upsertSettingJson` | function | 454 |
| 33 | `normalizeRowForProduct` | function | 461 |
| 34 | `createProductContext` | function | 506 |
| 35 | `ensureCategory` | function | 528 |
| 36 | `ensureUnit` | function | 540 |
| 37 | `ensureBrand` | function | 551 |
| 38 | `ensureSupplier` | function | 563 |
| 39 | `determineBranch` | function | 574 |
| 40 | `handleBranchStock` | function | 589 |
| 41 | `recalcProductStock` | function | 607 |
| 42 | `insertInventoryMovement` | function | 616 |
| 43 | `seedBranchRows` | function | 640 |
| 44 | `processProductRow` | function | 645 |
| 45 | `processProductRows` | function | 863 |
| 46 | `buildImageLookup` | function | 926 |
| 47 | `normalizeImageMatchKey` | function | 941 |
| 48 | `processImageOnlyFiles` | function | 951 |
| 49 | `extractZipImages` | function | 1009 |
| 50 | `processImportJob` | function | 1079 |
| 51 | `runLocalJob` | function | 1137 |
| 52 | `initializeBullQueue` | function | 1143 |
| 53 | `enqueueImportJob` | function | 1176 |
| 54 | `recoverImportJobs` | function | 1203 |
| 55 | `getQueueStatus` | function | 1217 |
| 56 | `buildErrorsCsv` | function | 1227 |
| 57 | `escape` | const arrow | 1229 |

### 3.51 `backend/src/services/portalAi.js`

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

### 3.52 `backend/src/services/supabaseAuth.js`

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

### 3.53 `backend/src/services/verification.js`

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

### 3.54 `backend/src/sessionAuth.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `hashToken` | function | 15 |
| 2 | `buildSessionExpiry` | function | 19 |
| 3 | `createAuthSession` | function | 35 |
| 4 | `buildRevocationTimestamp` | function | 56 |
| 5 | `getPresentedSessionToken` | function | 61 |
| 6 | `getSessionUser` | function | 86 |
| 7 | `revokeAuthSession` | function | 149 |
| 8 | `revokeUserSessions` | function | 161 |

### 3.55 `backend/src/settingsSnapshot.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeUploadPublicPath` | function | 7 |
| 2 | `isUploadPublicPath` | function | 15 |
| 3 | `sanitizeMediaPath` | function | 20 |
| 4 | `sanitizeMediaList` | function | 27 |
| 5 | `uploadPublicPathExists` | function | 40 |
| 6 | `sanitizeSettingValue` | function | 52 |
| 7 | `sanitizeSettingsSnapshot` | function | 56 |

### 3.56 `backend/src/storage/organizationFolders.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `trim` | function | 6 |
| 2 | `sanitizeOrganizationFolderLabel` | function | 10 |
| 3 | `buildOrganizationFolderName` | function | 20 |
| 4 | `extractOrganizationPublicId` | function | 26 |
| 5 | `findOrganizationFolderByPublicId` | function | 33 |

### 3.57 `backend/src/systemFsWorker.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `formatBackupStamp` | function | 15 |
| 2 | `pad` | const arrow | 17 |
| 3 | `respond` | function | 21 |
| 4 | `fail` | function | 25 |
| 5 | `runExportFolder` | function | 30 |
| 6 | `runRelocateDataRoot` | function | 70 |
| 7 | `main` | function | 77 |

### 3.58 `backend/src/uploadReferenceCleanup.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `safeJsonArray` | function | 10 |
| 2 | `repairMissingUploadReferences` | function | 19 |

### 3.59 `backend/src/uploadSecurity.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `bufferStartsWith` | function | 11 |
| 2 | `isLikelyCsvBuffer` | function | 15 |
| 3 | `detectBufferKind` | function | 28 |
| 4 | `getExpectedUploadedKind` | function | 42 |
| 5 | `validateImageMetadata` | function | 51 |
| 6 | `validateUploadedBuffer` | function | 65 |
| 7 | `validateUploadedPath` | function | 76 |

### 3.60 `backend/src/websocket.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `attachWss` | function | 24 |

### 3.61 `ops/scripts/backend/verify-data-integrity.js`

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

