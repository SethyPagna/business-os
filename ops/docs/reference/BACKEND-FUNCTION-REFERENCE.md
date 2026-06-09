# Backend Function Reference

Auto-generated symbol and route inventory for backend files. Regenerate with `node ops/scripts/docs/generate-doc-reference.ts`.

## 1. Coverage Summary

Total files documented: **1**

## 2. Symbol Count by File

| No. | File | Symbols | Route handlers |
|---:|---|---:|---:|
| 1 | `backend/server.js` | 29 | 0 |

## 3. Detailed Function Commentary

### 3.1 `backend/server.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `startRequestedWorkerRole` | function | 6 |
| 2 | `listFrontendAssetFiles` | function | 93 |
| 3 | `resolveFrontendAssetPath` | function | 104 |
| 4 | `resolveFrontendChunkAssetName` | function | 130 |
| 5 | `getSpaModulePreloadChunks` | function | 151 |
| 6 | `appendLinkHeader` | function | 160 |
| 7 | `appendSpaModulePreloadHeaders` | function | 169 |
| 8 | `sendSpaIndex` | function | 178 |
| 9 | `loadCompressionMiddleware` | function | 183 |
| 10 | `applySecurityHeaders` | function | 192 |
| 11 | `applyRequestPolicy` | function | 197 |
| 12 | `applyCoreMiddleware` | function | 206 |
| 13 | `normalizeUploadFileName` | function | 220 |
| 14 | `getSafeActiveUploadPath` | function | 227 |
| 15 | `findBackupUploadFallback` | function | 237 |
| 16 | `inferUploadContentType` | function | 291 |
| 17 | `serveLocalUpload` | function | 307 |
| 18 | `getObjectStreamWithTimeout` | function | 324 |
| 19 | `mountStaticAssets` | function | 339 |
| 20 | `mountHealthRoute` | function | 418 |
| 21 | `mountApiRoutes` | function | 446 |
| 22 | `mountTransfersAlias` | function | 481 |
| 23 | `mountSpaFallback` | function | 495 |
| 24 | `mountErrorHandler` | function | 512 |
| 25 | `getStartupBanner` | function | 525 |
| 26 | `closeDatabase` | function | 548 |
| 27 | `startDatabaseMaintenanceTimer` | function | 559 |
| 28 | `registerShutdownHandlers` | function | 567 |
| 29 | `bootstrapServer` | function | 581 |

