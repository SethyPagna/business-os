# Backend Function Reference

Auto-generated symbol and route inventory for backend files. Regenerate with `node ops/scripts/docs/generate-doc-reference.ts`.

## 1. Coverage Summary

Total files documented: **1**

## 2. Symbol Count by File

| No. | File | Symbols | Route handlers |
|---:|---|---:|---:|
| 1 | `backend/server.js` | 38 | 0 |

## 3. Detailed Function Commentary

### 3.1 `backend/server.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `startRequestedWorkerRole` | function | 6 |
| 2 | `listFrontendAssetFiles` | function | 133 |
| 3 | `resolveFrontendAssetPath` | function | 144 |
| 4 | `resolveFrontendChunkAssetName` | function | 168 |
| 5 | `getSpaModulePreloadChunks` | function | 198 |
| 6 | `appendLinkHeader` | function | 207 |
| 7 | `appendSpaModulePreloadHeaders` | function | 216 |
| 8 | `resolveFrontendStyleAssetNames` | function | 225 |
| 9 | `appendSpaStylePreloadHeaders` | function | 245 |
| 10 | `resolveFrontendPublicFontPreloadAssetNames` | function | 250 |
| 11 | `appendPublicFontPreloadHeaders` | function | 261 |
| 12 | `setPublicSpaHtmlCacheHeaders` | function | 266 |
| 13 | `isPublicSpaRoutePath` | function | 274 |
| 14 | `escapeInlineJson` | function | 278 |
| 15 | `injectPublicPortalBootstrap` | function | 286 |
| 16 | `sendPublicSpaIndex` | function | 294 |
| 17 | `sendSpaIndex` | function | 307 |
| 18 | `loadCompressionMiddleware` | function | 322 |
| 19 | `applySecurityHeaders` | function | 331 |
| 20 | `applyRequestPolicy` | function | 336 |
| 21 | `applyCoreMiddleware` | function | 345 |
| 22 | `normalizeUploadFileName` | function | 359 |
| 23 | `getSafeActiveUploadPath` | function | 366 |
| 24 | `findBackupUploadFallback` | function | 376 |
| 25 | `inferUploadContentType` | function | 430 |
| 26 | `serveLocalUpload` | function | 446 |
| 27 | `getObjectStreamWithTimeout` | function | 463 |
| 28 | `mountStaticAssets` | function | 478 |
| 29 | `mountHealthRoute` | function | 557 |
| 30 | `mountApiRoutes` | function | 585 |
| 31 | `mountTransfersAlias` | function | 620 |
| 32 | `mountSpaFallback` | function | 634 |
| 33 | `mountErrorHandler` | function | 651 |
| 34 | `getStartupBanner` | function | 664 |
| 35 | `closeDatabase` | function | 687 |
| 36 | `startDatabaseMaintenanceTimer` | function | 698 |
| 37 | `registerShutdownHandlers` | function | 706 |
| 38 | `bootstrapServer` | function | 720 |

