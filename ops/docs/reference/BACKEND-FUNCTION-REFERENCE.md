# Backend Function Reference

Auto-generated symbol and route inventory for backend files. Regenerate with `node ops/scripts/docs/generate-doc-reference.ts`.

## 1. Coverage Summary

Total files documented: **1**

## 2. Symbol Count by File

| No. | File | Symbols | Route handlers |
|---:|---|---:|---:|
| 1 | `backend/server.js` | 42 | 0 |

## 3. Detailed Function Commentary

### 3.1 `backend/server.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `startRequestedWorkerRole` | function | 6 |
| 2 | `listFrontendAssetFiles` | function | 156 |
| 3 | `resolveFrontendAssetPath` | function | 167 |
| 4 | `resolveFrontendChunkAssetName` | function | 191 |
| 5 | `getSpaModulePreloadChunks` | function | 221 |
| 6 | `appendLinkHeader` | function | 232 |
| 7 | `appendSpaModulePreloadHeaders` | function | 241 |
| 8 | `resolveFrontendStyleAssetNames` | function | 250 |
| 9 | `appendSpaStylePreloadHeaders` | function | 270 |
| 10 | `resolveFrontendPublicFontPreloadAssetNames` | function | 277 |
| 11 | `appendPublicFontPreloadHeaders` | function | 288 |
| 12 | `normalizePublicSpaHtmlTtl` | function | 293 |
| 13 | `setPublicSpaHtmlCacheHeaders` | function | 296 |
| 14 | `isPublicSpaRoutePath` | function | 304 |
| 15 | `escapeInlineJson` | function | 308 |
| 16 | `injectPublicPortalBootstrap` | function | 316 |
| 17 | `injectAdminAuthBootstrap` | function | 324 |
| 18 | `readAdminSpaTemplate` | function | 335 |
| 19 | `sendPublicSpaIndex` | function | 345 |
| 20 | `sendAdminSpaIndex` | function | 371 |
| 21 | `sendSpaIndex` | function | 395 |
| 22 | `loadCompressionMiddleware` | function | 410 |
| 23 | `applySecurityHeaders` | function | 419 |
| 24 | `applyRequestPolicy` | function | 424 |
| 25 | `applyCoreMiddleware` | function | 433 |
| 26 | `normalizeUploadFileName` | function | 447 |
| 27 | `getSafeActiveUploadPath` | function | 454 |
| 28 | `findBackupUploadFallback` | function | 464 |
| 29 | `inferUploadContentType` | function | 518 |
| 30 | `serveLocalUpload` | function | 534 |
| 31 | `getObjectStreamWithTimeout` | function | 551 |
| 32 | `mountStaticAssets` | function | 566 |
| 33 | `mountHealthRoute` | function | 645 |
| 34 | `mountApiRoutes` | function | 673 |
| 35 | `mountTransfersAlias` | function | 708 |
| 36 | `mountSpaFallback` | function | 722 |
| 37 | `mountErrorHandler` | function | 739 |
| 38 | `getStartupBanner` | function | 752 |
| 39 | `closeDatabase` | function | 775 |
| 40 | `startDatabaseMaintenanceTimer` | function | 786 |
| 41 | `registerShutdownHandlers` | function | 794 |
| 42 | `bootstrapServer` | function | 808 |

