# Project Script and Root Code Reference

Auto-generated symbol inventory for root-level code files and project scripts.

## 1. Coverage Summary

Total files documented: **12**

## 2. Symbol Count by File

| No. | File | Symbols |
|---:|---|---:|
| 1 | `ops/scripts/backend/schema-audit.js` | 25 |
| 2 | `ops/scripts/backend/verify-data-integrity.js` | 27 |
| 3 | `ops/scripts/lib/fs-utils.js` | 16 |
| 4 | `ops/scripts/lib/report-utils.js` | 5 |
| 5 | `ops/scripts/powershell/clean-generated.ps1` | 0 |
| 6 | `ops/scripts/powershell/clear-stale-node-processes.ps1` | 0 |
| 7 | `ops/scripts/powershell/docker-release.ps1` | 1 |
| 8 | `ops/scripts/powershell/full-automation.ps1` | 1 |
| 9 | `ops/scripts/powershell/npm-install-mode.ps1` | 0 |
| 10 | `ops/scripts/powershell/runtime-bootstrap.ps1` | 1 |
| 11 | `ops/scripts/powershell/start-runtime.ps1` | 1 |
| 12 | `ops/scripts/powershell/tailscale-health-monitor.ps1` | 0 |

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

### 3.3 `ops/scripts/lib/fs-utils.js`

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

### 3.4 `ops/scripts/lib/report-utils.js`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `markdownTable` | function | 5 |
| 2 | `stableDigest` | function | 13 |
| 3 | `summarizeReportValue` | function | 17 |
| 4 | `outputTail` | function | 31 |
| 5 | `formatBytes` | function | 38 |

### 3.5 `ops/scripts/powershell/clean-generated.ps1`

- No top-level named function/class symbols detected.

### 3.6 `ops/scripts/powershell/clear-stale-node-processes.ps1`

- No top-level named function/class symbols detected.

### 3.7 `ops/scripts/powershell/docker-release.ps1`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Fail` | function | 14 |

### 3.8 `ops/scripts/powershell/full-automation.ps1`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Fail` | function | 33 |

### 3.9 `ops/scripts/powershell/npm-install-mode.ps1`

- No top-level named function/class symbols detected.

### 3.10 `ops/scripts/powershell/runtime-bootstrap.ps1`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Fail` | function | 25 |

### 3.11 `ops/scripts/powershell/start-runtime.ps1`

| No. | Symbol | Kind | Line |
|---:|---|---:|---:|
| 1 | `Fail` | function | 11 |

### 3.12 `ops/scripts/powershell/tailscale-health-monitor.ps1`

- No top-level named function/class symbols detected.

