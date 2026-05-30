# Backend Function Reference

Auto-generated symbol and route inventory for backend files. Regenerate with `node ops/scripts/docs/generate-doc-reference.ts`.

## 1. Coverage Summary

Total files documented: **1**

## 2. Symbol Count by File

| No. | File | Symbols | Route handlers |
|---:|---|---:|---:|
| 1 | `backend/server.js` | 23 | 0 |

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

