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

