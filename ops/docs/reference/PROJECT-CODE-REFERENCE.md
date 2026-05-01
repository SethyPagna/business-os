# Project Script and Root Code Reference

Auto-generated symbol inventory for root-level code files and project scripts.

## 1. Coverage Summary

Total files documented: **14**

## 2. Symbol Count by File

| No. | File | Symbols |
|---:|---|---:|
| 1 | `clean-generated.ps1` | 0 |
| 2 | `ops/scripts/backend/verify-data-integrity.js` | 10 |
| 3 | `ops/scripts/frontend/verify-i18n.js` | 6 |
| 4 | `ops/scripts/frontend/verify-performance.js` | 4 |
| 5 | `ops/scripts/frontend/verify-ui.js` | 13 |
| 6 | `ops/scripts/generate-doc-reference.js` | 18 |
| 7 | `ops/scripts/generate-full-project-docs.js` | 26 |
| 8 | `ops/scripts/lib/fs-utils.js` | 8 |
| 9 | `ops/scripts/performance-scan.js` | 3 |
| 10 | `ops/scripts/powershell/clean-generated.ps1` | 0 |
| 11 | `ops/scripts/powershell/runtime-bootstrap.ps1` | 1 |
| 12 | `ops/scripts/sync-firebase-release-env.ps1` | 0 |
| 13 | `ops/scripts/verify-runtime-deps.js` | 4 |
| 14 | `ops/scripts/verify-scale-services.js` | 8 |

## 3. Detailed Function Commentary

### 3.1 `clean-generated.ps1`

- No top-level named function/class symbols detected.

### 3.2 `ops/scripts/backend/verify-data-integrity.js`

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

### 3.3 `ops/scripts/frontend/verify-i18n.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `collectUsedKeys` | function | 29 |
| 2 | `flattenTranslationTree` | function | 69 |
| 3 | `listMissing` | function | 83 |
| 4 | `listEmptyValues` | function | 88 |
| 5 | `printList` | function | 95 |
| 6 | `main` | function | 102 |

### 3.4 `ops/scripts/frontend/verify-performance.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `read` | function | 15 |
| 2 | `walk` | function | 19 |
| 3 | `trackedFiles` | function | 37 |
| 4 | `assert` | function | 47 |

### 3.5 `ops/scripts/frontend/verify-ui.js`

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

### 3.6 `ops/scripts/generate-doc-reference.js`

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
| 16 | `writeModuleNamingGuide` | function | 375 |
| 17 | `writeProjectCodeReference` | function | 423 |
| 18 | `main` | function | 464 |

### 3.7 `ops/scripts/generate-full-project-docs.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ensureDir` | function | 48 |
| 2 | `toPosix` | function | 52 |
| 3 | `rel` | function | 56 |
| 4 | `shouldSkipDir` | function | 60 |
| 5 | `collectFilesAndFolders` | function | 64 |
| 6 | `getAllProjectFilesAndFolders` | function | 85 |
| 7 | `isProbablyText` | function | 108 |
| 8 | `readText` | function | 121 |
| 9 | `lineCount` | function | 129 |
| 10 | `fileCategory` | function | 134 |
| 11 | `inferPurpose` | function | 155 |
| 12 | `markdownHeader` | function | 180 |
| 13 | `markdownSection` | function | 184 |
| 14 | `extractImportsExports` | function | 188 |
| 15 | `findSymbols` | function | 228 |
| 16 | `writeAllFunctionReference` | function | 254 |
| 17 | `resolveInternalImport` | function | 292 |
| 18 | `writeAllFileInventory` | function | 315 |
| 19 | `folderPurpose` | function | 337 |
| 20 | `writeFolderCoverage` | function | 355 |
| 21 | `writeImportExportReference` | function | 414 |
| 22 | `readJsonObject` | function | 488 |
| 23 | `translationSectionForKey` | function | 496 |
| 24 | `writeTranslationSectionReference` | function | 547 |
| 25 | `writeMainCoverageSummary` | function | 596 |
| 26 | `main` | function | 625 |

### 3.8 `ops/scripts/lib/fs-utils.js`

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

### 3.9 `ops/scripts/performance-scan.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `kb` | function | 43 |
| 2 | `topN` | function | 48 |
| 3 | `main` | function | 56 |

### 3.10 `ops/scripts/powershell/clean-generated.ps1`

- No top-level named function/class symbols detected.

### 3.11 `ops/scripts/powershell/runtime-bootstrap.ps1`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Fail` | function | 25 |

### 3.12 `ops/scripts/sync-firebase-release-env.ps1`

- No top-level named function/class symbols detected.

### 3.13 `ops/scripts/verify-runtime-deps.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readJson` | function | 22 |
| 2 | `assertTrackedFile` | function | 26 |
| 3 | `hasLockDependency` | function | 32 |
| 4 | `main` | function | 38 |

### 3.14 `ops/scripts/verify-scale-services.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ensureDir` | function | 17 |
| 2 | `run` | function | 21 |
| 3 | `firstExisting` | function | 39 |
| 4 | `whereDocker` | function | 43 |
| 5 | `resolveDocker` | function | 56 |
| 6 | `checkSecretIgnoreRules` | function | 66 |
| 7 | `trackedLicenses` | const arrow | 67 |
| 8 | `main` | function | 93 |

