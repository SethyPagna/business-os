# Project Script and Root Code Reference

Auto-generated symbol inventory for root-level code files and project scripts.

## 1. Coverage Summary

Total files documented: **17**

## 2. Symbol Count by File

| No. | File | Symbols |
|---:|---|---:|
| 1 | `ops/scripts/backend/verify-data-integrity.js` | 10 |
| 2 | `ops/scripts/frontend/verify-i18n.js` | 6 |
| 3 | `ops/scripts/frontend/verify-performance.js` | 4 |
| 4 | `ops/scripts/frontend/verify-ui.js` | 13 |
| 5 | `ops/scripts/generate-doc-reference.js` | 18 |
| 6 | `ops/scripts/generate-full-project-docs.js` | 26 |
| 7 | `ops/scripts/lib/fs-utils.js` | 8 |
| 8 | `ops/scripts/performance-scan.js` | 3 |
| 9 | `ops/scripts/powershell/clean-generated.ps1` | 0 |
| 10 | `ops/scripts/powershell/docker-release.ps1` | 1 |
| 11 | `ops/scripts/powershell/runtime-bootstrap.ps1` | 1 |
| 12 | `ops/scripts/powershell/start-runtime.ps1` | 1 |
| 13 | `ops/scripts/powershell/tailscale-health-monitor.ps1` | 0 |
| 14 | `ops/scripts/sync-firebase-release-env.ps1` | 0 |
| 15 | `ops/scripts/verify-docker-release.js` | 3 |
| 16 | `ops/scripts/verify-runtime-deps.js` | 4 |
| 17 | `ops/scripts/verify-scale-services.js` | 8 |

## 3. Detailed Function Commentary

### 3.1 `ops/scripts/backend/verify-data-integrity.js`

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

### 3.2 `ops/scripts/frontend/verify-i18n.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `collectUsedKeys` | function | 29 |
| 2 | `flattenTranslationTree` | function | 69 |
| 3 | `listMissing` | function | 83 |
| 4 | `listEmptyValues` | function | 88 |
| 5 | `printList` | function | 95 |
| 6 | `main` | function | 102 |

### 3.3 `ops/scripts/frontend/verify-performance.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `read` | function | 15 |
| 2 | `walk` | function | 19 |
| 3 | `trackedFiles` | function | 37 |
| 4 | `assert` | function | 47 |

### 3.4 `ops/scripts/frontend/verify-ui.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readText` | function | 61 |
| 2 | `readJson` | function | 65 |
| 3 | `flatten` | function | 69 |
| 4 | `walkFiles` | function | 82 |
| 5 | `isIntentionalLatin` | function | 94 |
| 6 | `report` | function | 102 |
| 7 | `checkKhmerQuality` | function | 108 |
| 8 | `checkPortalDarkModeContracts` | function | 132 |
| 9 | `checkPortalVisibleStrings` | function | 154 |
| 10 | `checkFormControlLabels` | function | 176 |
| 11 | `checkVerificationWiring` | function | 196 |
| 12 | `printAuditSummary` | function | 209 |
| 13 | `main` | function | 227 |

### 3.5 `ops/scripts/generate-doc-reference.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ensureDir` | function | 17 |
| 2 | `normalizePath` | function | 21 |
| 3 | `getFilesRecursive` | function | 25 |
| 4 | `getRootCodeFiles` | function | 45 |
| 5 | `findSymbols` | function | 54 |
| 6 | `findRouteHandlers` | function | 83 |
| 7 | `collectScriptMetadata` | function | 99 |
| 8 | `markdownHeader` | function | 122 |
| 9 | `markdownSection` | function | 126 |
| 10 | `writeBackendReference` | function | 130 |
| 11 | `writeFrontendReference` | function | 185 |
| 12 | `readJsonObject` | function | 228 |
| 13 | `groupByPrefix` | function | 234 |
| 14 | `writeTranslationReference` | function | 243 |
| 15 | `writeRunReleaseReference` | function | 299 |
| 16 | `writeModuleNamingGuide` | function | 374 |
| 17 | `writeProjectCodeReference` | function | 422 |
| 18 | `main` | function | 463 |

### 3.6 `ops/scripts/generate-full-project-docs.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ensureDir` | function | 44 |
| 2 | `toPosix` | function | 48 |
| 3 | `rel` | function | 52 |
| 4 | `shouldSkipDir` | function | 56 |
| 5 | `collectFilesAndFolders` | function | 60 |
| 6 | `getAllProjectFilesAndFolders` | function | 81 |
| 7 | `isProbablyText` | function | 104 |
| 8 | `readText` | function | 117 |
| 9 | `lineCount` | function | 125 |
| 10 | `fileCategory` | function | 130 |
| 11 | `inferPurpose` | function | 151 |
| 12 | `markdownHeader` | function | 175 |
| 13 | `markdownSection` | function | 179 |
| 14 | `extractImportsExports` | function | 183 |
| 15 | `findSymbols` | function | 223 |
| 16 | `writeAllFunctionReference` | function | 249 |
| 17 | `resolveInternalImport` | function | 287 |
| 18 | `writeAllFileInventory` | function | 310 |
| 19 | `folderPurpose` | function | 332 |
| 20 | `writeFolderCoverage` | function | 350 |
| 21 | `writeImportExportReference` | function | 409 |
| 22 | `readJsonObject` | function | 483 |
| 23 | `translationSectionForKey` | function | 491 |
| 24 | `writeTranslationSectionReference` | function | 542 |
| 25 | `writeMainCoverageSummary` | function | 591 |
| 26 | `main` | function | 620 |

### 3.7 `ops/scripts/lib/fs-utils.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toPosix` | function | 16 |
| 2 | `resolveProjectRoot` | function | 20 |
| 3 | `relFrom` | function | 35 |
| 4 | `readUtf8` | function | 42 |
| 5 | `readJson` | function | 50 |
| 6 | `lineCount` | function | 58 |
| 7 | `walkFilesRecursive` | function | 66 |
| 8 | `collectRootFiles` | function | 93 |

### 3.8 `ops/scripts/performance-scan.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `kb` | function | 43 |
| 2 | `topN` | function | 48 |
| 3 | `main` | function | 56 |

### 3.9 `ops/scripts/powershell/clean-generated.ps1`

- No top-level named function/class symbols detected.

### 3.10 `ops/scripts/powershell/docker-release.ps1`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Fail` | function | 14 |

### 3.11 `ops/scripts/powershell/runtime-bootstrap.ps1`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Fail` | function | 25 |

### 3.12 `ops/scripts/powershell/start-runtime.ps1`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Fail` | function | 11 |

### 3.13 `ops/scripts/powershell/tailscale-health-monitor.ps1`

- No top-level named function/class symbols detected.

### 3.14 `ops/scripts/sync-firebase-release-env.ps1`

- No top-level named function/class symbols detected.

### 3.15 `ops/scripts/verify-docker-release.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `read` | function | 33 |
| 2 | `requireFile` | function | 37 |
| 3 | `main` | function | 41 |

### 3.16 `ops/scripts/verify-runtime-deps.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readJson` | function | 22 |
| 2 | `assertTrackedFile` | function | 26 |
| 3 | `hasLockDependency` | function | 32 |
| 4 | `main` | function | 38 |

### 3.17 `ops/scripts/verify-scale-services.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ensureDir` | function | 18 |
| 2 | `run` | function | 22 |
| 3 | `firstExisting` | function | 40 |
| 4 | `whereDocker` | function | 44 |
| 5 | `resolveDocker` | function | 57 |
| 6 | `checkSecretIgnoreRules` | function | 67 |
| 7 | `trackedLicenses` | const arrow | 68 |
| 8 | `main` | function | 94 |

