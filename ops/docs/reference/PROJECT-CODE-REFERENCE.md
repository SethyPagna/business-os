# Project Script and Root Code Reference

Auto-generated symbol inventory for root-level code files and project scripts.

## 1. Coverage Summary

Total files documented: **10**

## 2. Symbol Count by File

| No. | File | Symbols |
|---:|---|---:|
| 1 | `clean-generated.ps1` | 0 |
| 2 | `ops/scripts/backend/verify-data-integrity.js` | 10 |
| 3 | `ops/scripts/frontend/verify-i18n.js` | 6 |
| 4 | `ops/scripts/generate-doc-reference.js` | 18 |
| 5 | `ops/scripts/generate-full-project-docs.js` | 26 |
| 6 | `ops/scripts/lib/fs-utils.js` | 8 |
| 7 | `ops/scripts/performance-scan.js` | 3 |
| 8 | `ops/scripts/powershell/clean-generated.ps1` | 0 |
| 9 | `ops/scripts/sync-firebase-release-env.ps1` | 0 |
| 10 | `ops/scripts/verify-runtime-deps.js` | 4 |

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

### 3.4 `ops/scripts/generate-doc-reference.js`

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
| 16 | `writeModuleNamingGuide` | function | 364 |
| 17 | `writeProjectCodeReference` | function | 412 |
| 18 | `main` | function | 453 |

### 3.5 `ops/scripts/generate-full-project-docs.js`

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
| 11 | `inferPurpose` | function | 154 |
| 12 | `markdownHeader` | function | 179 |
| 13 | `markdownSection` | function | 183 |
| 14 | `extractImportsExports` | function | 187 |
| 15 | `findSymbols` | function | 227 |
| 16 | `writeAllFunctionReference` | function | 253 |
| 17 | `resolveInternalImport` | function | 291 |
| 18 | `writeAllFileInventory` | function | 314 |
| 19 | `folderPurpose` | function | 336 |
| 20 | `writeFolderCoverage` | function | 351 |
| 21 | `writeImportExportReference` | function | 410 |
| 22 | `readJsonObject` | function | 484 |
| 23 | `translationSectionForKey` | function | 492 |
| 24 | `writeTranslationSectionReference` | function | 543 |
| 25 | `writeMainCoverageSummary` | function | 592 |
| 26 | `main` | function | 621 |

### 3.6 `ops/scripts/lib/fs-utils.js`

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

### 3.7 `ops/scripts/performance-scan.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `kb` | function | 43 |
| 2 | `topN` | function | 48 |
| 3 | `main` | function | 56 |

### 3.8 `ops/scripts/powershell/clean-generated.ps1`

- No top-level named function/class symbols detected.

### 3.9 `ops/scripts/sync-firebase-release-env.ps1`

- No top-level named function/class symbols detected.

### 3.10 `ops/scripts/verify-runtime-deps.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `readJson` | function | 22 |
| 2 | `assertTrackedFile` | function | 26 |
| 3 | `hasLockDependency` | function | 32 |
| 4 | `main` | function | 38 |

