# Backend Function Reference

Auto-generated symbol and route inventory for backend files. Regenerate with `node ops/scripts/docs/generate-doc-reference.ts`.

## 1. Coverage Summary

Total files documented: **1**

## 2. Symbol Count by File

| No. | File | Symbols | Route handlers |
|---:|---|---:|---:|
| 1 | `backend/server.js` | 24 | 0 |

## 3. Detailed Function Commentary

### 3.1 `backend/server.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `startRequestedWorkerRole` | function | 6 |
| 2 | `listFrontendAssetFiles` | function | 69 |
| 3 | `resolveFrontendAssetPath` | function | 80 |
| 4 | `loadCompressionMiddleware` | function | 106 |
| 5 | `applySecurityHeaders` | function | 115 |
| 6 | `applyRequestPolicy` | function | 120 |
| 7 | `applyCoreMiddleware` | function | 129 |
| 8 | `normalizeUploadFileName` | function | 143 |
| 9 | `getSafeActiveUploadPath` | function | 150 |
| 10 | `findBackupUploadFallback` | function | 160 |
| 11 | `inferUploadContentType` | function | 214 |
| 12 | `serveLocalUpload` | function | 230 |
| 13 | `getObjectStreamWithTimeout` | function | 247 |
| 14 | `mountStaticAssets` | function | 262 |
| 15 | `mountHealthRoute` | function | 340 |
| 16 | `mountApiRoutes` | function | 368 |
| 17 | `mountTransfersAlias` | function | 403 |
| 18 | `mountSpaFallback` | function | 417 |
| 19 | `mountErrorHandler` | function | 435 |
| 20 | `getStartupBanner` | function | 448 |
| 21 | `closeDatabase` | function | 471 |
| 22 | `startDatabaseMaintenanceTimer` | function | 482 |
| 23 | `registerShutdownHandlers` | function | 490 |
| 24 | `bootstrapServer` | function | 504 |

