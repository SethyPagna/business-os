# Project Script and Root Code Reference

Auto-generated symbol inventory for root-level code files and project scripts.

## 1. Coverage Summary

Total files documented: **8**

## 2. Symbol Count by File

| No. | File | Symbols |
|---:|---|---:|
| 1 | `temp-vite-build.mjs` | 0 |
| 2 | `ops/scripts/backend/verify-data-integrity.js` | 10 |
| 3 | `ops/scripts/frontend/verify-i18n.js` | 5 |
| 4 | `ops/scripts/generate-doc-reference.js` | 18 |
| 5 | `ops/scripts/generate-full-project-docs.js` | 26 |
| 6 | `ops/scripts/lib/fs-utils.js` | 8 |
| 7 | `ops/scripts/performance-scan.js` | 3 |
| 8 | `ops/scripts/sync-firebase-release-env.ps1` | 0 |

## 3. Detailed Function Commentary

### 3.1 `temp-vite-build.mjs`

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
| 2 | `listMissing` | function | 69 |
| 3 | `listEmptyValues` | function | 74 |
| 4 | `printList` | function | 81 |
| 5 | `main` | function | 88 |

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
| 1 | `ensureDir` | function | 45 |
| 2 | `toPosix` | function | 49 |
| 3 | `rel` | function | 53 |
| 4 | `shouldSkipDir` | function | 57 |
| 5 | `collectFilesAndFolders` | function | 61 |
| 6 | `getAllProjectFilesAndFolders` | function | 82 |
| 7 | `isProbablyText` | function | 105 |
| 8 | `readText` | function | 118 |
| 9 | `lineCount` | function | 126 |
| 10 | `fileCategory` | function | 131 |
| 11 | `inferPurpose` | function | 151 |
| 12 | `markdownHeader` | function | 176 |
| 13 | `markdownSection` | function | 180 |
| 14 | `extractImportsExports` | function | 184 |
| 15 | `findSymbols` | function | 224 |
| 16 | `writeAllFunctionReference` | function | 250 |
| 17 | `resolveInternalImport` | function | 288 |
| 18 | `writeAllFileInventory` | function | 313 |
| 19 | `folderPurpose` | function | 335 |
| 20 | `writeFolderCoverage` | function | 350 |
| 21 | `writeImportExportReference` | function | 409 |
| 22 | `readJsonObject` | function | 483 |
| 23 | `translationSectionForKey` | function | 491 |
| 24 | `writeTranslationSectionReference` | function | 542 |
| 25 | `writeMainCoverageSummary` | function | 591 |
| 26 | `main` | function | 620 |

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
| 1 | `kb` | function | 44 |
| 2 | `topN` | function | 49 |
| 3 | `main` | function | 57 |

### 3.8 `ops/scripts/sync-firebase-release-env.ps1`

- No top-level named function/class symbols detected.

