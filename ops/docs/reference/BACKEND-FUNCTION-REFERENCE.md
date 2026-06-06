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
| 6 | `appendLinkHeader` | function | 158 |
| 7 | `appendSpaModulePreloadHeaders` | function | 167 |
| 8 | `sendSpaIndex` | function | 176 |
| 9 | `loadCompressionMiddleware` | function | 181 |
| 10 | `applySecurityHeaders` | function | 190 |
| 11 | `applyRequestPolicy` | function | 195 |
| 12 | `applyCoreMiddleware` | function | 204 |
| 13 | `normalizeUploadFileName` | function | 218 |
| 14 | `getSafeActiveUploadPath` | function | 225 |
| 15 | `findBackupUploadFallback` | function | 235 |
| 16 | `inferUploadContentType` | function | 289 |
| 17 | `serveLocalUpload` | function | 305 |
| 18 | `getObjectStreamWithTimeout` | function | 322 |
| 19 | `mountStaticAssets` | function | 337 |
| 20 | `mountHealthRoute` | function | 416 |
| 21 | `mountApiRoutes` | function | 444 |
| 22 | `mountTransfersAlias` | function | 479 |
| 23 | `mountSpaFallback` | function | 493 |
| 24 | `mountErrorHandler` | function | 510 |
| 25 | `getStartupBanner` | function | 523 |
| 26 | `closeDatabase` | function | 546 |
| 27 | `startDatabaseMaintenanceTimer` | function | 557 |
| 28 | `registerShutdownHandlers` | function | 565 |
| 29 | `bootstrapServer` | function | 579 |

