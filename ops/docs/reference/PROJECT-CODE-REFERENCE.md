# Project Script and Root Code Reference

Auto-generated symbol inventory for root-level code files and project scripts.

## 1. Coverage Summary

Total files documented: **24**

## 2. Symbol Count by File

| No. | File | Symbols |
|---:|---|---:|
| 1 | `ops/scripts/backend/schema-audit.js` | 25 |
| 2 | `ops/scripts/backend/verify-data-integrity.js` | 27 |
| 3 | `ops/scripts/docs/generate-doc-reference.js` | 15 |
| 4 | `ops/scripts/docs/generate-full-project-docs.js` | 19 |
| 5 | `ops/scripts/docs/performance-scan.js` | 8 |
| 6 | `ops/scripts/frontend/verify-i18n.js` | 6 |
| 7 | `ops/scripts/frontend/verify-performance.js` | 4 |
| 8 | `ops/scripts/frontend/verify-ui.js` | 11 |
| 9 | `ops/scripts/lib/fs-utils.js` | 16 |
| 10 | `ops/scripts/lib/report-utils.js` | 5 |
| 11 | `ops/scripts/powershell/clean-generated.ps1` | 0 |
| 12 | `ops/scripts/powershell/clear-stale-node-processes.ps1` | 0 |
| 13 | `ops/scripts/powershell/docker-release.ps1` | 1 |
| 14 | `ops/scripts/powershell/full-automation.ps1` | 1 |
| 15 | `ops/scripts/powershell/npm-install-mode.ps1` | 0 |
| 16 | `ops/scripts/powershell/runtime-bootstrap.ps1` | 1 |
| 17 | `ops/scripts/powershell/start-runtime.ps1` | 1 |
| 18 | `ops/scripts/powershell/tailscale-health-monitor.ps1` | 0 |
| 19 | `ops/scripts/verification/verify-backup-reliability.js` | 6 |
| 20 | `ops/scripts/verification/verify-docker-release.js` | 11 |
| 21 | `ops/scripts/verification/verify-hardening-policy.js` | 9 |
| 22 | `ops/scripts/verification/verify-runtime-deps.js` | 13 |
| 23 | `ops/scripts/verification/verify-scale-services.js` | 8 |
| 24 | `ops/scripts/verification/verify-secret-hygiene.js` | 0 |

## 3. Detailed Function Commentary

### 3.1 `ops/scripts/backend/schema-audit.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `read` | function | 33 |
| 2 | `uniqueSorted` | function | 37 |
| 3 | `getLineNumber` | function | 41 |
| 4 | `matchAllWithLine` | function | 45 |
| 5 | `parseSqlTables` | function | 54 |
| 6 | `parseAlteredPrimaryKeys` | function | 77 |
| 7 | `parseColumns` | function | 87 |
| 8 | `parsePrimaryKey` | function | 104 |
| 9 | `cleanColumnList` | function | 121 |
| 10 | `parseIndexes` | function | 128 |
| 11 | `parseRuntimeStatements` | function | 145 |
| 12 | `uniqueRuntimeRows` | function | 187 |
| 13 | `parseDexieStores` | function | 199 |
| 14 | `loadBackupSchema` | function | 220 |
| 15 | `countForeignKeyDeclarations` | function | 226 |
| 16 | `buildCoverage` | function | 233 |
| 17 | `buildBackupCoverage` | function | 242 |
| 18 | `renderList` | function | 264 |
| 19 | `renderRuntimeRows` | function | 269 |
| 20 | `renderTableCatalog` | function | 274 |
| 21 | `primaryKeyGapRows` | function | 280 |
| 22 | `renderPrimaryKeyGaps` | function | 293 |
| 23 | `renderReport` | function | 308 |
| 24 | `buildSummary` | function | 398 |
| 25 | `main` | function | 430 |

### 3.2 `ops/scripts/backend/verify-data-integrity.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `parseEnvFile` | function | 27 |
| 2 | `fail` | function | 59 |
| 3 | `pass` | function | 66 |
| 4 | `approxEqual` | function | 71 |
| 5 | `stripTrailingSemicolon` | function | 75 |
| 6 | `runPsql` | function | 79 |
| 7 | `queryRows` | function | 101 |
| 8 | `queryOne` | function | 110 |
| 9 | `queryScalarList` | function | 114 |
| 10 | `execSql` | function | 118 |
| 11 | `sqlString` | function | 122 |
| 12 | `sqlIdentifier` | function | 126 |
| 13 | `generatedTextMatch` | function | 130 |
| 14 | `checkNoNegativeStock` | function | 137 |
| 15 | `checkProductStockMatchesBranches` | function | 146 |
| 16 | `checkSaleItemTotals` | function | 191 |
| 17 | `checkReturnDoesNotExceedSold` | function | 201 |
| 18 | `addCleanupClassification` | function | 231 |
| 19 | `addCleanupCandidateIds` | function | 243 |
| 20 | `classifyIntegrityBacklog` | function | 253 |
| 21 | `checkProfitFormulaConsistency` | function | 405 |
| 22 | `checkCogsSnapshotVsCurrentProductCost` | function | 441 |
| 23 | `checkPostgresRuntimeTables` | function | 462 |
| 24 | `checkDatasetReadiness` | function | 491 |
| 25 | `checkRelationshipOrphans` | function | 529 |
| 26 | `writeReport` | function | 646 |
| 27 | `run` | function | 656 |

### 3.3 `ops/scripts/docs/generate-doc-reference.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `getFilesRecursive` | function | 25 |
| 2 | `getRootCodeFiles` | function | 30 |
| 3 | `findSymbols` | function | 35 |
| 4 | `findRouteHandlers` | function | 64 |
| 5 | `collectScriptMetadata` | function | 80 |
| 6 | `markdownHeader` | function | 103 |
| 7 | `markdownSection` | function | 107 |
| 8 | `writeBackendReference` | function | 111 |
| 9 | `writeFrontendReference` | function | 166 |
| 10 | `groupByPrefix` | function | 208 |
| 11 | `writeTranslationReference` | function | 217 |
| 12 | `writeRunReleaseReference` | function | 273 |
| 13 | `writeModuleNamingGuide` | function | 347 |
| 14 | `writeProjectCodeReference` | function | 395 |
| 15 | `main` | function | 436 |

### 3.4 `ops/scripts/docs/generate-full-project-docs.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `rel` | function | 53 |
| 2 | `shouldSkipDir` | function | 57 |
| 3 | `getAllProjectFilesAndFolders` | function | 61 |
| 4 | `fileCategory` | function | 80 |
| 5 | `inferPurpose` | function | 101 |
| 6 | `markdownHeader` | function | 125 |
| 7 | `markdownSection` | function | 129 |
| 8 | `extractImportsExports` | function | 133 |
| 9 | `findSymbols` | function | 173 |
| 10 | `writeAllFunctionReference` | function | 199 |
| 11 | `resolveInternalImport` | function | 237 |
| 12 | `writeAllFileInventory` | function | 260 |
| 13 | `folderPurpose` | function | 282 |
| 14 | `writeFolderCoverage` | function | 299 |
| 15 | `writeImportExportReference` | function | 358 |
| 16 | `translationSectionForKey` | function | 432 |
| 17 | `writeTranslationSectionReference` | function | 483 |
| 18 | `writeMainCoverageSummary` | function | 532 |
| 19 | `main` | function | 561 |

### 3.5 `ops/scripts/docs/performance-scan.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `kb` | function | 65 |
| 2 | `topN` | function | 70 |
| 3 | `compactRows` | function | 78 |
| 4 | `readSourceRow` | function | 86 |
| 5 | `readChunkRow` | function | 98 |
| 6 | `readManualNotes` | function | 103 |
| 7 | `buildPerformanceSummary` | function | 123 |
| 8 | `main` | function | 157 |

### 3.6 `ops/scripts/frontend/verify-i18n.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `collectUsedKeys` | function | 29 |
| 2 | `flattenTranslationTree` | function | 69 |
| 3 | `listMissing` | function | 83 |
| 4 | `listEmptyValues` | function | 88 |
| 5 | `printList` | function | 95 |
| 6 | `main` | function | 102 |

### 3.7 `ops/scripts/frontend/verify-performance.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `read` | function | 15 |
| 2 | `walk` | function | 19 |
| 3 | `trackedFiles` | function | 37 |
| 4 | `assert` | function | 47 |

### 3.8 `ops/scripts/frontend/verify-ui.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `flatten` | function | 62 |
| 2 | `walkFiles` | function | 75 |
| 3 | `isIntentionalLatin` | function | 87 |
| 4 | `report` | function | 95 |
| 5 | `checkKhmerQuality` | function | 101 |
| 6 | `checkPortalDarkModeContracts` | function | 125 |
| 7 | `checkPortalVisibleStrings` | function | 147 |
| 8 | `checkFormControlLabels` | function | 169 |
| 9 | `checkVerificationWiring` | function | 189 |
| 10 | `printAuditSummary` | function | 202 |
| 11 | `main` | function | 220 |

### 3.9 `ops/scripts/lib/fs-utils.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `toPosix` | function | 16 |
| 2 | `resolveProjectRoot` | function | 20 |
| 3 | `relFrom` | function | 35 |
| 4 | `readUtf8` | function | 42 |
| 5 | `readJson` | function | 50 |
| 6 | `readUtf8Async` | function | 58 |
| 7 | `readJsonAsync` | function | 66 |
| 8 | `lineCount` | function | 74 |
| 9 | `pathExists` | function | 79 |
| 10 | `mapLimit` | function | 88 |
| 11 | `worker` | function | 91 |
| 12 | `shouldSkipDirectory` | function | 106 |
| 13 | `walkFilesRecursive` | function | 110 |
| 14 | `collectFilesAndFolders` | function | 137 |
| 15 | `collectRootFiles` | function | 166 |
| 16 | `isProbablyText` | function | 185 |

### 3.10 `ops/scripts/lib/report-utils.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `markdownTable` | function | 5 |
| 2 | `stableDigest` | function | 13 |
| 3 | `summarizeReportValue` | function | 17 |
| 4 | `outputTail` | function | 31 |
| 5 | `formatBytes` | function | 38 |

### 3.11 `ops/scripts/powershell/clean-generated.ps1`

- No top-level named function/class symbols detected.

### 3.12 `ops/scripts/powershell/clear-stale-node-processes.ps1`

- No top-level named function/class symbols detected.

### 3.13 `ops/scripts/powershell/docker-release.ps1`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Fail` | function | 14 |

### 3.14 `ops/scripts/powershell/full-automation.ps1`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Fail` | function | 33 |

### 3.15 `ops/scripts/powershell/npm-install-mode.ps1`

- No top-level named function/class symbols detected.

### 3.16 `ops/scripts/powershell/runtime-bootstrap.ps1`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Fail` | function | 25 |

### 3.17 `ops/scripts/powershell/start-runtime.ps1`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Fail` | function | 11 |

### 3.18 `ops/scripts/powershell/tailscale-health-monitor.ps1`

- No top-level named function/class symbols detected.

### 3.19 `ops/scripts/verification/verify-backup-reliability.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `read` | function | 11 |
| 2 | `lineFor` | function | 15 |
| 3 | `requireText` | function | 21 |
| 4 | `forbidText` | function | 25 |
| 5 | `checkNeedles` | function | 29 |
| 6 | `main` | function | 36 |

### 3.20 `ops/scripts/verification/verify-docker-release.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `read` | function | 60 |
| 2 | `rel` | function | 64 |
| 3 | `requireFile` | function | 68 |
| 4 | `requireToken` | function | 72 |
| 5 | `buildCloudflareRuntimeCoverage` | function | 76 |
| 6 | `assertCloudflareRuntimeCoverage` | function | 196 |
| 7 | `walk` | function | 198 |
| 8 | `buildTestDataCleanupCoverage` | function | 211 |
| 9 | `assertBooleanCoverage` | function | 312 |
| 10 | `walk` | function | 314 |
| 11 | `main` | function | 325 |

### 3.21 `ops/scripts/verification/verify-hardening-policy.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `normalizeRelativePath` | function | 13 |
| 2 | `readWithLocalImports` | function | 17 |
| 3 | `listTrackedOrPendingFiles` | function | 31 |
| 4 | `lineFor` | function | 38 |
| 5 | `assertContains` | function | 44 |
| 6 | `assertNotContains` | function | 50 |
| 7 | `assertNoApiCachingRegression` | function | 56 |
| 8 | `assertFullAutomationIncludesPolicy` | function | 77 |
| 9 | `main` | function | 93 |

### 3.22 `ops/scripts/verification/verify-runtime-deps.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `assertTrackedFile` | function | 38 |
| 2 | `rel` | function | 44 |
| 3 | `requireToken` | function | 48 |
| 4 | `hasLockDependency` | function | 54 |
| 5 | `readIncludes` | function | 60 |
| 6 | `packageLockVersion` | function | 64 |
| 7 | `buildVersionConsistency` | function | 68 |
| 8 | `assertVersionConsistency` | function | 94 |
| 9 | `assertRuntimeVersionGuardWiring` | function | 100 |
| 10 | `assertBuildManifestShapeWhenPresent` | function | 169 |
| 11 | `buildLocalVerificationCoverage` | function | 186 |
| 12 | `assertCoverageComplete` | function | 234 |
| 13 | `main` | function | 247 |

### 3.23 `ops/scripts/verification/verify-scale-services.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `ensureDir` | function | 19 |
| 2 | `run` | function | 23 |
| 3 | `firstExisting` | function | 41 |
| 4 | `whereDocker` | function | 45 |
| 5 | `resolveDocker` | function | 58 |
| 6 | `checkSecretIgnoreRules` | function | 68 |
| 7 | `trackedLicenses` | const arrow | 69 |
| 8 | `main` | function | 95 |

### 3.24 `ops/scripts/verification/verify-secret-hygiene.js`

- No top-level named function/class symbols detected.

