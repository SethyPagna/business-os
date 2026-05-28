# Phase 29 Audit

Generated: 2026-05-28T03:49:32.205Z

Policy: `ops/automation/business-os-automation.json`

## Summary

- Checks: 21
- Failures: 0
- Cycles: 3
- Total child-check duration: 5657 ms
- Repeat consistency: stable
- Execution mode: contention-safe-reference-writers-then-bounded-guardrails
- Reference writer concurrency: 1
- Parallel child-check concurrency: 2
- Mode: non-mutating audit. This command measures and verifies; it does not delete files, move folders, run migrations, or prune remote storage.

## Checks

| Cycle | Check | Status | Duration | Command | Report output |
| --- | --- | --- | --- | --- | --- |
| 1 | Generated bulk audit | passed | 960 ms | `node.exe ops/scripts/architecture/generated-bulk-audit.ts --policy ops/automation/business-os-automation.json` | `ops/docs/reference/GENERATED-BULK-AUDIT.md`<br>`ops/docs/reference/GENERATED-BULK-AUDIT.json` |
| 1 | Schema audit | passed | 141 ms | `node.exe ops/scripts/backend/schema-audit.ts` | `ops/docs/reference/SCHEMA-AUDIT.md`<br>`ops/docs/reference/SCHEMA-AUDIT.json` |
| 1 | Performance/code-flow scan | passed | 182 ms | `node.exe ops/scripts/docs/performance-scan.ts` | `ops/docs/reference/PERFORMANCE-SCAN.md`<br>`ops/docs/reference/PERFORMANCE-SCAN.json` |
| 1 | Language/runtime audit | passed | 208 ms | `node.exe ops/scripts/architecture/language-runtime-audit.ts` | `ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.md`<br>`ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.json` |
| 1 | Docker release guardrail | passed | 129 ms | `node.exe ops/scripts/verification/verify-docker-release.ts` | `ops/docs/reference/DOCKER-RELEASE-GUARDRAIL.json` |
| 1 | Runtime dependency guardrail | passed | 131 ms | `node.exe ops/scripts/verification/verify-runtime-deps.ts` | `ops/docs/reference/RUNTIME-DEPS-GUARDRAIL.json` |
| 1 | Organization audit | passed | 256 ms | `node.exe ops/scripts/architecture/organization-audit.ts` | `ops/docs/reference/ORGANIZATION-AUDIT.md`<br>`ops/docs/reference/ORGANIZATION-AUDIT.json` |
| 2 | Generated bulk audit | passed | 811 ms | `node.exe ops/scripts/architecture/generated-bulk-audit.ts --policy ops/automation/business-os-automation.json` | `ops/docs/reference/GENERATED-BULK-AUDIT.md`<br>`ops/docs/reference/GENERATED-BULK-AUDIT.json` |
| 2 | Schema audit | passed | 121 ms | `node.exe ops/scripts/backend/schema-audit.ts` | `ops/docs/reference/SCHEMA-AUDIT.md`<br>`ops/docs/reference/SCHEMA-AUDIT.json` |
| 2 | Performance/code-flow scan | passed | 150 ms | `node.exe ops/scripts/docs/performance-scan.ts` | `ops/docs/reference/PERFORMANCE-SCAN.md`<br>`ops/docs/reference/PERFORMANCE-SCAN.json` |
| 2 | Language/runtime audit | passed | 195 ms | `node.exe ops/scripts/architecture/language-runtime-audit.ts` | `ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.md`<br>`ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.json` |
| 2 | Docker release guardrail | passed | 127 ms | `node.exe ops/scripts/verification/verify-docker-release.ts` | `ops/docs/reference/DOCKER-RELEASE-GUARDRAIL.json` |
| 2 | Runtime dependency guardrail | passed | 133 ms | `node.exe ops/scripts/verification/verify-runtime-deps.ts` | `ops/docs/reference/RUNTIME-DEPS-GUARDRAIL.json` |
| 2 | Organization audit | passed | 270 ms | `node.exe ops/scripts/architecture/organization-audit.ts` | `ops/docs/reference/ORGANIZATION-AUDIT.md`<br>`ops/docs/reference/ORGANIZATION-AUDIT.json` |
| 3 | Generated bulk audit | passed | 817 ms | `node.exe ops/scripts/architecture/generated-bulk-audit.ts --policy ops/automation/business-os-automation.json` | `ops/docs/reference/GENERATED-BULK-AUDIT.md`<br>`ops/docs/reference/GENERATED-BULK-AUDIT.json` |
| 3 | Schema audit | passed | 132 ms | `node.exe ops/scripts/backend/schema-audit.ts` | `ops/docs/reference/SCHEMA-AUDIT.md`<br>`ops/docs/reference/SCHEMA-AUDIT.json` |
| 3 | Performance/code-flow scan | passed | 150 ms | `node.exe ops/scripts/docs/performance-scan.ts` | `ops/docs/reference/PERFORMANCE-SCAN.md`<br>`ops/docs/reference/PERFORMANCE-SCAN.json` |
| 3 | Language/runtime audit | passed | 197 ms | `node.exe ops/scripts/architecture/language-runtime-audit.ts` | `ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.md`<br>`ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.json` |
| 3 | Docker release guardrail | passed | 121 ms | `node.exe ops/scripts/verification/verify-docker-release.ts` | `ops/docs/reference/DOCKER-RELEASE-GUARDRAIL.json` |
| 3 | Runtime dependency guardrail | passed | 132 ms | `node.exe ops/scripts/verification/verify-runtime-deps.ts` | `ops/docs/reference/RUNTIME-DEPS-GUARDRAIL.json` |
| 3 | Organization audit | passed | 294 ms | `node.exe ops/scripts/architecture/organization-audit.ts` | `ops/docs/reference/ORGANIZATION-AUDIT.md`<br>`ops/docs/reference/ORGANIZATION-AUDIT.json` |

## Duration Summary

| Check | Runs | Total | Average | Max |
| --- | --- | --- | --- | --- |
| Generated bulk audit | 3 | 2588 ms | 863 ms | 960 ms |
| Organization audit | 3 | 820 ms | 273 ms | 294 ms |
| Language/runtime audit | 3 | 600 ms | 200 ms | 208 ms |
| Performance/code-flow scan | 3 | 482 ms | 161 ms | 182 ms |
| Runtime dependency guardrail | 3 | 396 ms | 132 ms | 133 ms |
| Schema audit | 3 | 394 ms | 131 ms | 141 ms |
| Docker release guardrail | 3 | 377 ms | 126 ms | 129 ms |

## Slowest Runs

| Cycle | Check | Duration |
| --- | --- | --- |
| 1 | Generated bulk audit | 960 ms |
| 3 | Generated bulk audit | 817 ms |
| 2 | Generated bulk audit | 811 ms |
| 3 | Organization audit | 294 ms |
| 2 | Organization audit | 270 ms |

## Repeat Consistency

| Check | Field | Status | Values |
| --- | --- | --- | --- |
| Generated bulk audit | totalBytes | stable | cycle 1: `692396918`<br>cycle 2: `692396918`<br>cycle 3: `692396918` |
| Generated bulk audit | protectedBytes | stable | cycle 1: `369964480`<br>cycle 2: `369964480`<br>cycle 3: `369964480` |
| Generated bulk audit | cleanupCandidateBytes | stable | cycle 1: `322432438`<br>cycle 2: `322432438`<br>cycle 3: `322432438` |
| Generated bulk audit | nestedTargetOverlaps | stable | cycle 1: `items:2; sha256:042742607550; preview:[{"parent":"business-os-data","child":"business-os-data/organizations/org_leangcosmetics (Leang ...`<br>cycle 2: `items:2; sha256:042742607550; preview:[{"parent":"business-os-data","child":"business-os-data/organizations/org_leangcosmetics (Leang ...`<br>cycle 3: `items:2; sha256:042742607550; preview:[{"parent":"business-os-data","child":"business-os-data/organizations/org_leangcosmetics (Leang ...` |
| Generated bulk audit | nestedOverlapBytes | stable | cycle 1: `15496556`<br>cycle 2: `15496556`<br>cycle 3: `15496556` |
| Generated bulk audit | adjustedTotalBytes | stable | cycle 1: `676900362`<br>cycle 2: `676900362`<br>cycle 3: `676900362` |
| Generated bulk audit | adjustedProtectedBytes | stable | cycle 1: `354467924`<br>cycle 2: `354467924`<br>cycle 3: `354467924` |
| Generated bulk audit | adjustedCleanupCandidateBytes | stable | cycle 1: `322432438`<br>cycle 2: `322432438`<br>cycle 3: `322432438` |
| Generated bulk audit | largestProtectedTargets | stable | cycle 1: `items:4; sha256:702ac1676977; preview:[{"path":"ops/runtime","bytes":191160554,"files":535,"folders":74,"category":"runtime state","di...`<br>cycle 2: `items:4; sha256:702ac1676977; preview:[{"path":"ops/runtime","bytes":191160554,"files":535,"folders":74,"category":"runtime state","di...`<br>cycle 3: `items:4; sha256:702ac1676977; preview:[{"path":"ops/runtime","bytes":191160554,"files":535,"folders":74,"category":"runtime state","di...` |
| Generated bulk audit | largestCleanupTargets | stable | cycle 1: `items:4; sha256:1e3fbf8b4156; preview:[{"path":"frontend/node_modules","bytes":156437173,"files":11226,"folders":981,"category":"depen...`<br>cycle 2: `items:4; sha256:1e3fbf8b4156; preview:[{"path":"frontend/node_modules","bytes":156437173,"files":11226,"folders":981,"category":"depen...`<br>cycle 3: `items:4; sha256:1e3fbf8b4156; preview:[{"path":"frontend/node_modules","bytes":156437173,"files":11226,"folders":981,"category":"depen...` |
| Generated bulk audit | dispositionTotals | stable | cycle 1: `keys:5; sha256:8e8c6c91415f; preview:{"preserve":{"bytes":178803926,"files":68,"folders":37,"targets":3},"retention":{"bytes":1911605...`<br>cycle 2: `keys:5; sha256:8e8c6c91415f; preview:{"preserve":{"bytes":178803926,"files":68,"folders":37,"targets":3},"retention":{"bytes":1911605...`<br>cycle 3: `keys:5; sha256:8e8c6c91415f; preview:{"preserve":{"bytes":178803926,"files":68,"folders":37,"targets":3},"retention":{"bytes":1911605...` |
| Generated bulk audit | generatedBulkCandidateMaxBytes | stable | cycle 1: `536870912`<br>cycle 2: `536870912`<br>cycle 3: `536870912` |
| Generated bulk audit | thresholdExceeded | stable | cycle 1: `false`<br>cycle 2: `false`<br>cycle 3: `false` |
| Generated bulk audit | measurementMode | stable | cycle 1: `bounded-parallel-targets`<br>cycle 2: `bounded-parallel-targets`<br>cycle 3: `bounded-parallel-targets` |
| Generated bulk audit | measuredTargetsInParallel | stable | cycle 1: `true`<br>cycle 2: `true`<br>cycle 3: `true` |
| Generated bulk audit | targetMeasureConcurrency | stable | cycle 1: `4`<br>cycle 2: `4`<br>cycle 3: `4` |
| Generated bulk audit | fileStatMode | stable | cycle 1: `recursive-fast-path-with-walk-fallback`<br>cycle 2: `recursive-fast-path-with-walk-fallback`<br>cycle 3: `recursive-fast-path-with-walk-fallback` |
| Generated bulk audit | fileStatConcurrency | stable | cycle 1: `32`<br>cycle 2: `32`<br>cycle 3: `32` |
| Generated bulk audit | missingIgnoreCoverage | stable | cycle 1: `[]`<br>cycle 2: `[]`<br>cycle 3: `[]` |
| Generated bulk audit | protectedCleanupDrift | stable | cycle 1: `[]`<br>cycle 2: `[]`<br>cycle 3: `[]` |
| Generated bulk audit | cleanupCoverageGaps | stable | cycle 1: `[]`<br>cycle 2: `[]`<br>cycle 3: `[]` |
| Generated bulk audit | dependencyTopology | stable | cycle 1: `keys:6; sha256:fc1021165cd3; preview:{"mode":"separate-install-roots-with-orphan-root-cleanup","mergePolicy":"Do not merge frontend/b...`<br>cycle 2: `keys:6; sha256:fc1021165cd3; preview:{"mode":"separate-install-roots-with-orphan-root-cleanup","mergePolicy":"Do not merge frontend/b...`<br>cycle 3: `keys:6; sha256:fc1021165cd3; preview:{"mode":"separate-install-roots-with-orphan-root-cleanup","mergePolicy":"Do not merge frontend/b...` |
| Organization audit | filesScanned | stable | cycle 1: `565`<br>cycle 2: `565`<br>cycle 3: `565` |
| Organization audit | largeFiles | stable | cycle 1: `71`<br>cycle 2: `71`<br>cycle 3: `71` |
| Organization audit | compatibilityWrappers | stable | cycle 1: `0`<br>cycle 2: `0`<br>cycle 3: `0` |
| Organization audit | brokenCompatibilityWrappers | stable | cycle 1: `0`<br>cycle 2: `0`<br>cycle 3: `0` |
| Organization audit | wrapperRemovalCandidates | stable | cycle 1: `0`<br>cycle 2: `0`<br>cycle 3: `0` |
| Organization audit | generatedOnlyWrapperReferences | stable | cycle 1: `0`<br>cycle 2: `0`<br>cycle 3: `0` |
| Organization audit | scanRoots | stable | cycle 1: `["frontend/src","frontend/tests","backend/src","backend/test","ops/scripts","ops/docs","run"]`<br>cycle 2: `["frontend/src","frontend/tests","backend/src","backend/test","ops/scripts","ops/docs","run"]`<br>cycle 3: `["frontend/src","frontend/tests","backend/src","backend/test","ops/scripts","ops/docs","run"]` |
| Organization audit | scanFiles | stable | cycle 1: `["package.json","backend/package.json","frontend/package.json","ops/package.json","docker-compose.yml","Dockerfile"]`<br>cycle 2: `["package.json","backend/package.json","frontend/package.json","ops/package.json","docker-compose.yml","Dockerfile"]`<br>cycle 3: `["package.json","backend/package.json","frontend/package.json","ops/package.json","docker-compose.yml","Dockerfile"]` |
| Organization audit | fileReadMode | stable | cycle 1: `bounded-parallel`<br>cycle 2: `bounded-parallel`<br>cycle 3: `bounded-parallel` |
| Organization audit | rootWalkMode | stable | cycle 1: `bounded-parallel`<br>cycle 2: `bounded-parallel`<br>cycle 3: `bounded-parallel` |
| Organization audit | rootWalkConcurrency | stable | cycle 1: `3`<br>cycle 2: `3`<br>cycle 3: `3` |
| Organization audit | fileReadConcurrency | stable | cycle 1: `24`<br>cycle 2: `24`<br>cycle 3: `24` |
| Organization audit | largeFileThreshold | stable | cycle 1: `700`<br>cycle 2: `700`<br>cycle 3: `700` |
| Organization audit | largestAreas | stable | cycle 1: `items:30; sha256:6015ff0b0f9b; preview:[["frontend/utils",41],["frontend/components/products",31],["ops/docs/reference",30],["backend/r...`<br>cycle 2: `items:30; sha256:6015ff0b0f9b; preview:[["frontend/utils",41],["frontend/components/products",31],["ops/docs/reference",30],["backend/r...`<br>cycle 3: `items:30; sha256:6015ff0b0f9b; preview:[["frontend/utils",41],["frontend/components/products",31],["ops/docs/reference",30],["backend/r...` |
| Organization audit | largeFilePaths | stable | cycle 1: `items:71; sha256:41ebda9d59f8; preview:["backend/src/db/postgresSchema.sql","backend/src/fileAssets.js","backend/src/routes/auth.js","b...`<br>cycle 2: `items:71; sha256:41ebda9d59f8; preview:["backend/src/db/postgresSchema.sql","backend/src/fileAssets.js","backend/src/routes/auth.js","b...`<br>cycle 3: `items:71; sha256:41ebda9d59f8; preview:["backend/src/db/postgresSchema.sql","backend/src/fileAssets.js","backend/src/routes/auth.js","b...` |
| Organization audit | wrapperFiles | stable | cycle 1: `[]`<br>cycle 2: `[]`<br>cycle 3: `[]` |
| Organization audit | brokenWrapperFiles | stable | cycle 1: `[]`<br>cycle 2: `[]`<br>cycle 3: `[]` |
| Organization audit | removableWrapperFiles | stable | cycle 1: `[]`<br>cycle 2: `[]`<br>cycle 3: `[]` |
| Schema audit | staticTables | stable | cycle 1: `45`<br>cycle 2: `45`<br>cycle 3: `45` |
| Schema audit | runtimeCreateTables | stable | cycle 1: `9`<br>cycle 2: `9`<br>cycle 3: `9` |
| Schema audit | runtimeAlterColumns | stable | cycle 1: `21`<br>cycle 2: `21`<br>cycle 3: `21` |
| Schema audit | runtimeIndexes | stable | cycle 1: `58`<br>cycle 2: `58`<br>cycle 3: `58` |
| Schema audit | runtimeUniqueIndexes | stable | cycle 1: `21`<br>cycle 2: `21`<br>cycle 3: `21` |
| Schema audit | dexieLatestVersion | stable | cycle 1: `5`<br>cycle 2: `5`<br>cycle 3: `5` |
| Schema audit | dexieLatestStores | stable | cycle 1: `24`<br>cycle 2: `24`<br>cycle 3: `24` |
| Schema audit | backupTables | stable | cycle 1: `37`<br>cycle 2: `37`<br>cycle 3: `37` |
| Schema audit | foreignKeyDeclarations | stable | cycle 1: `0`<br>cycle 2: `0`<br>cycle 3: `0` |
| Schema audit | relationshipDocRequiredEntities | stable | cycle 1: `47`<br>cycle 2: `47`<br>cycle 3: `47` |
| Schema audit | relationshipDocMissingEntities | stable | cycle 1: `0`<br>cycle 2: `0`<br>cycle 3: `0` |
| Schema audit | backupActionNeededGaps | stable | cycle 1: `0`<br>cycle 2: `0`<br>cycle 3: `0` |
| Schema audit | staticPrimaryKeyGaps | stable | cycle 1: `0`<br>cycle 2: `0`<br>cycle 3: `0` |
| Schema audit | missingRelationshipEntities | stable | cycle 1: `[]`<br>cycle 2: `[]`<br>cycle 3: `[]` |
| Schema audit | backupActionNeededTables | stable | cycle 1: `[]`<br>cycle 2: `[]`<br>cycle 3: `[]` |
| Schema audit | staticPrimaryKeyGapTables | stable | cycle 1: `[]`<br>cycle 2: `[]`<br>cycle 3: `[]` |
| Schema audit | staticPrimaryKeyGapDetails | stable | cycle 1: `[]`<br>cycle 2: `[]`<br>cycle 3: `[]` |
| Schema audit | staticTableNames | stable | cycle 1: `items:45; sha256:f7f3f7581f45; preview:["action_history","ai_provider_configs","ai_response_logs","audit_logs","branch_batch_stock","br...`<br>cycle 2: `items:45; sha256:f7f3f7581f45; preview:["action_history","ai_provider_configs","ai_response_logs","audit_logs","branch_batch_stock","br...`<br>cycle 3: `items:45; sha256:f7f3f7581f45; preview:["action_history","ai_provider_configs","ai_response_logs","audit_logs","branch_batch_stock","br...` |
| Schema audit | runtimeCreateTableNames | stable | cycle 1: `items:9; sha256:9e998644891b; preview:["branch_batch_stock","product_batches","return_item_batch_allocations","rfid_events","rfid_scan...`<br>cycle 2: `items:9; sha256:9e998644891b; preview:["branch_batch_stock","product_batches","return_item_batch_allocations","rfid_events","rfid_scan...`<br>cycle 3: `items:9; sha256:9e998644891b; preview:["branch_batch_stock","product_batches","return_item_batch_allocations","rfid_events","rfid_scan...` |
| Schema audit | runtimeIndexNames | stable | cycle 1: `items:58; sha256:9f2e0826611e; preview:["idx_action_history_created_pg","idx_action_history_scope_updated_pg","idx_action_history_scope...`<br>cycle 2: `items:58; sha256:9f2e0826611e; preview:["idx_action_history_created_pg","idx_action_history_scope_updated_pg","idx_action_history_scope...`<br>cycle 3: `items:58; sha256:9f2e0826611e; preview:["idx_action_history_created_pg","idx_action_history_scope_updated_pg","idx_action_history_scope...` |
| Schema audit | latestDexieStoreNames | stable | cycle 1: `items:24; sha256:d4ee5c2f4737; preview:["audit_logs","branch_stock","branches","categories","custom_fields","custom_tables","customers"...`<br>cycle 2: `items:24; sha256:d4ee5c2f4737; preview:["audit_logs","branch_stock","branches","categories","custom_fields","custom_tables","customers"...`<br>cycle 3: `items:24; sha256:d4ee5c2f4737; preview:["audit_logs","branch_stock","branches","categories","custom_fields","custom_tables","customers"...` |
| Performance/code-flow scan | sourceFiles | stable | cycle 1: `371`<br>cycle 2: `371`<br>cycle 3: `371` |
| Performance/code-flow scan | distAssets | stable | cycle 1: `87`<br>cycle 2: `87`<br>cycle 3: `87` |
| Performance/code-flow scan | totalSourceBytes | stable | cycle 1: `6135079`<br>cycle 2: `6135079`<br>cycle 3: `6135079` |
| Performance/code-flow scan | totalSourceLines | stable | cycle 1: `136211`<br>cycle 2: `136211`<br>cycle 3: `136211` |
| Performance/code-flow scan | largestSourceFile | stable | cycle 1: `frontend/src/lang/km.json`<br>cycle 2: `frontend/src/lang/km.json`<br>cycle 3: `frontend/src/lang/km.json` |
| Performance/code-flow scan | largestSourceLinesFile | stable | cycle 1: `frontend/src/components/inventory/Inventory.jsx`<br>cycle 2: `frontend/src/components/inventory/Inventory.jsx`<br>cycle 3: `frontend/src/components/inventory/Inventory.jsx` |
| Performance/code-flow scan | largestBuiltChunk | stable | cycle 1: `frontend/dist/assets/vendor-zxing-BxcS2Ffh.js`<br>cycle 2: `frontend/dist/assets/vendor-zxing-BxcS2Ffh.js`<br>cycle 3: `frontend/dist/assets/vendor-zxing-BxcS2Ffh.js` |
| Performance/code-flow scan | oversizedSourceFiles | stable | cycle 1: `items:19; sha256:dcd36a03ea3e; preview:["backend/src/routes/inventory.js","backend/src/routes/products.js","backend/src/routes/sales.js...`<br>cycle 2: `items:19; sha256:dcd36a03ea3e; preview:["backend/src/routes/inventory.js","backend/src/routes/products.js","backend/src/routes/sales.js...`<br>cycle 3: `items:19; sha256:dcd36a03ea3e; preview:["backend/src/routes/inventory.js","backend/src/routes/products.js","backend/src/routes/sales.js...` |
| Performance/code-flow scan | oversizedBuiltChunks | stable | cycle 1: `items:5; sha256:271b2fe41b92; preview:["frontend/dist/assets/catalog-BOSw5ORL.js","frontend/dist/assets/index-DQztsXP7.css","frontend/...`<br>cycle 2: `items:5; sha256:271b2fe41b92; preview:["frontend/dist/assets/catalog-BOSw5ORL.js","frontend/dist/assets/index-DQztsXP7.css","frontend/...`<br>cycle 3: `items:5; sha256:271b2fe41b92; preview:["frontend/dist/assets/catalog-BOSw5ORL.js","frontend/dist/assets/index-DQztsXP7.css","frontend/...` |
| Performance/code-flow scan | topSourceBySize | stable | cycle 1: `items:25; sha256:5799f7468471; preview:[{"file":"frontend/src/lang/km.json","size":252664,"lines":2730},{"file":"frontend/src/component...`<br>cycle 2: `items:25; sha256:5799f7468471; preview:[{"file":"frontend/src/lang/km.json","size":252664,"lines":2730},{"file":"frontend/src/component...`<br>cycle 3: `items:25; sha256:5799f7468471; preview:[{"file":"frontend/src/lang/km.json","size":252664,"lines":2730},{"file":"frontend/src/component...` |
| Performance/code-flow scan | topSourceByLines | stable | cycle 1: `items:25; sha256:5470fef95680; preview:[{"file":"frontend/src/components/inventory/Inventory.jsx","size":213980,"lines":4123},{"file":"...`<br>cycle 2: `items:25; sha256:5470fef95680; preview:[{"file":"frontend/src/components/inventory/Inventory.jsx","size":213980,"lines":4123},{"file":"...`<br>cycle 3: `items:25; sha256:5470fef95680; preview:[{"file":"frontend/src/components/inventory/Inventory.jsx","size":213980,"lines":4123},{"file":"...` |
| Performance/code-flow scan | topBuiltChunks | stable | cycle 1: `items:25; sha256:f49393fe3592; preview:[{"file":"frontend/dist/assets/vendor-zxing-BxcS2Ffh.js","size":446639,"lines":0},{"file":"front...`<br>cycle 2: `items:25; sha256:f49393fe3592; preview:[{"file":"frontend/dist/assets/vendor-zxing-BxcS2Ffh.js","size":446639,"lines":0},{"file":"front...`<br>cycle 3: `items:25; sha256:f49393fe3592; preview:[{"file":"frontend/dist/assets/vendor-zxing-BxcS2Ffh.js","size":446639,"lines":0},{"file":"front...` |
| Performance/code-flow scan | manualNotesPreserved | stable | cycle 1: `true`<br>cycle 2: `true`<br>cycle 3: `true` |
| Performance/code-flow scan | manualNotesLines | stable | cycle 1: `966`<br>cycle 2: `966`<br>cycle 3: `966` |
| Performance/code-flow scan | sourceReadMode | stable | cycle 1: `bounded-parallel`<br>cycle 2: `bounded-parallel`<br>cycle 3: `bounded-parallel` |
| Performance/code-flow scan | sourceReadConcurrency | stable | cycle 1: `24`<br>cycle 2: `24`<br>cycle 3: `24` |
| Performance/code-flow scan | chunkStatConcurrency | stable | cycle 1: `32`<br>cycle 2: `32`<br>cycle 3: `32` |
| Language/runtime audit | mode | stable | cycle 1: `non-mutating`<br>cycle 2: `non-mutating`<br>cycle 3: `non-mutating` |
| Language/runtime audit | scanRoots | stable | cycle 1: `["frontend/src","frontend/tests","backend/src","backend/test","ops/scripts","run"]`<br>cycle 2: `["frontend/src","frontend/tests","backend/src","backend/test","ops/scripts","run"]`<br>cycle 3: `["frontend/src","frontend/tests","backend/src","backend/test","ops/scripts","run"]` |
| Language/runtime audit | sourceFiles | stable | cycle 1: `468`<br>cycle 2: `468`<br>cycle 3: `468` |
| Language/runtime audit | fileReadMode | stable | cycle 1: `bounded-parallel`<br>cycle 2: `bounded-parallel`<br>cycle 3: `bounded-parallel` |
| Language/runtime audit | rootWalkMode | stable | cycle 1: `bounded-parallel`<br>cycle 2: `bounded-parallel`<br>cycle 3: `bounded-parallel` |
| Language/runtime audit | rootWalkConcurrency | stable | cycle 1: `3`<br>cycle 2: `3`<br>cycle 3: `3` |
| Language/runtime audit | matrixCheckMode | stable | cycle 1: `bounded-parallel`<br>cycle 2: `bounded-parallel`<br>cycle 3: `bounded-parallel` |
| Language/runtime audit | matrixCheckConcurrency | stable | cycle 1: `8`<br>cycle 2: `8`<br>cycle 3: `8` |
| Language/runtime audit | fileReadConcurrency | stable | cycle 1: `24`<br>cycle 2: `24`<br>cycle 3: `24` |
| Language/runtime audit | languageCounts | stable | cycle 1: `items:9; sha256:ca6c0586d4fa; preview:[["TypeScript",228],["React JSX",107],["JavaScript",101],["Windows batch",16],["PowerShell",8],[...`<br>cycle 2: `items:9; sha256:ca6c0586d4fa; preview:[["TypeScript",228],["React JSX",107],["JavaScript",101],["Windows batch",16],["PowerShell",8],[...`<br>cycle 3: `items:9; sha256:ca6c0586d4fa; preview:[["TypeScript",228],["React JSX",107],["JavaScript",101],["Windows batch",16],["PowerShell",8],[...` |
| Language/runtime audit | extensionCounts | stable | cycle 1: `[[".ts",228],[".jsx",107],[".js",101],[".bat",16],[".ps1",8],[".sh",3],[".json",2],[".sql",2],[".css",1]]`<br>cycle 2: `[[".ts",228],[".jsx",107],[".js",101],[".bat",16],[".ps1",8],[".sh",3],[".json",2],[".sql",2],[".css",1]]`<br>cycle 3: `[[".ts",228],[".jsx",107],[".js",101],[".bat",16],[".ps1",8],[".sh",3],[".json",2],[".sql",2],[".css",1]]` |
| Language/runtime audit | defaults | stable | cycle 1: `keys:5; sha256:23699dab93e2; preview:{"frontend":"React/JavaScript","backend":"Node.js","heavyData":"SQL/DuckDB before new general-pu...`<br>cycle 2: `keys:5; sha256:23699dab93e2; preview:{"frontend":"React/JavaScript","backend":"Node.js","heavyData":"SQL/DuckDB before new general-pu...`<br>cycle 3: `keys:5; sha256:23699dab93e2; preview:{"frontend":"React/JavaScript","backend":"Node.js","heavyData":"SQL/DuckDB before new general-pu...` |
| Language/runtime audit | packagingGate | stable | cycle 1: `No backend language/runtime conversion without release packaging and rollback proof.`<br>cycle 2: `No backend language/runtime conversion without release packaging and rollback proof.`<br>cycle 3: `No backend language/runtime conversion without release packaging and rollback proof.` |
| Language/runtime audit | runtimePolicy | stable | cycle 1: `items:5; sha256:fc7bab5f41f4; preview:[{"runtime":"TypeScript","decision":"target pure helpers first","evidenceRequired":"typecheck, f...`<br>cycle 2: `items:5; sha256:fc7bab5f41f4; preview:[{"runtime":"TypeScript","decision":"target pure helpers first","evidenceRequired":"typecheck, f...`<br>cycle 3: `items:5; sha256:fc7bab5f41f4; preview:[{"runtime":"TypeScript","decision":"target pure helpers first","evidenceRequired":"typecheck, f...` |
| Language/runtime audit | rejectedRuntimeFamilies | stable | cycle 1: `items:4; sha256:355071f9d529; preview:[{"runtime":"Rust","reason":"No benchmark-backed hot path currently requires native compilation....`<br>cycle 2: `items:4; sha256:355071f9d529; preview:[{"runtime":"Rust","reason":"No benchmark-backed hot path currently requires native compilation....`<br>cycle 3: `items:4; sha256:355071f9d529; preview:[{"runtime":"Rust","reason":"No benchmark-backed hot path currently requires native compilation....` |
| Language/runtime audit | verificationMatrix | stable | cycle 1: `items:3; sha256:eb61ff18471b; preview:[{"track":"TypeScript utility conversion","requiredProof":["npm.cmd --prefix frontend run typech...`<br>cycle 2: `items:3; sha256:eb61ff18471b; preview:[{"track":"TypeScript utility conversion","requiredProof":["npm.cmd --prefix frontend run typech...`<br>cycle 3: `items:3; sha256:eb61ff18471b; preview:[{"track":"TypeScript utility conversion","requiredProof":["npm.cmd --prefix frontend run typech...` |
| Language/runtime audit | firstExecutableSlices | stable | cycle 1: `items:3; sha256:86e8ab50402c; preview:[{"track":"TypeScript utility conversion","firstCandidate":"","score":0,"lines":0,"requiredProof...`<br>cycle 2: `items:3; sha256:86e8ab50402c; preview:[{"track":"TypeScript utility conversion","firstCandidate":"","score":0,"lines":0,"requiredProof...`<br>cycle 3: `items:3; sha256:86e8ab50402c; preview:[{"track":"TypeScript utility conversion","firstCandidate":"","score":0,"lines":0,"requiredProof...` |
| Language/runtime audit | proofCommandCoverage | stable | cycle 1: `items:12; sha256:74575772e0e2; preview:[{"track":"TypeScript utility conversion","proof":"npm.cmd --prefix frontend run typecheck","typ...`<br>cycle 2: `items:12; sha256:74575772e0e2; preview:[{"track":"TypeScript utility conversion","proof":"npm.cmd --prefix frontend run typecheck","typ...`<br>cycle 3: `items:12; sha256:74575772e0e2; preview:[{"track":"TypeScript utility conversion","proof":"npm.cmd --prefix frontend run typecheck","typ...` |
| Language/runtime audit | missingProofCommands | stable | cycle 1: `[]`<br>cycle 2: `[]`<br>cycle 3: `[]` |
| Language/runtime audit | focusedTestCoverage | stable | cycle 1: `items:5; sha256:b08b47e2566c; preview:[{"track":"Completed TypeScript utility conversion","candidate":"frontend/src/utils/csvImport.ts...`<br>cycle 2: `items:5; sha256:b08b47e2566c; preview:[{"track":"Completed TypeScript utility conversion","candidate":"frontend/src/utils/csvImport.ts...`<br>cycle 3: `items:5; sha256:b08b47e2566c; preview:[{"track":"Completed TypeScript utility conversion","candidate":"frontend/src/utils/csvImport.ts...` |
| Language/runtime audit | focusedTestCoverageGaps | stable | cycle 1: `[]`<br>cycle 2: `[]`<br>cycle 3: `[]` |
| Language/runtime audit | convertedTypeScriptSlices | stable | cycle 1: `items:51; sha256:7a550bd4f75b; preview:[{"implementation":"frontend/src/app/appShellUtils.ts","compatibilityWrapper":"","wrapperStatus"...`<br>cycle 2: `items:51; sha256:7a550bd4f75b; preview:[{"implementation":"frontend/src/app/appShellUtils.ts","compatibilityWrapper":"","wrapperStatus"...`<br>cycle 3: `items:51; sha256:7a550bd4f75b; preview:[{"implementation":"frontend/src/app/appShellUtils.ts","compatibilityWrapper":"","wrapperStatus"...` |
| Language/runtime audit | convertedTypeScriptCoverageGaps | stable | cycle 1: `[]`<br>cycle 2: `[]`<br>cycle 3: `[]` |
| Language/runtime audit | conversionCandidates | stable | cycle 1: `items:2; sha256:b37d0ce3a505; preview:[{"file":"frontend/src/utils/csv.ts","lines":234,"score":6,"track":"Web Worker extraction","rule...`<br>cycle 2: `items:2; sha256:b37d0ce3a505; preview:[{"file":"frontend/src/utils/csv.ts","lines":234,"score":6,"track":"Web Worker extraction","rule...`<br>cycle 3: `items:2; sha256:b37d0ce3a505; preview:[{"file":"frontend/src/utils/csv.ts","lines":234,"score":6,"track":"Web Worker extraction","rule...` |
| Docker release guardrail | requiredFiles | stable | cycle 1: `30`<br>cycle 2: `30`<br>cycle 3: `30` |
| Docker release guardrail | missingRequiredFiles | stable | cycle 1: `[]`<br>cycle 2: `[]`<br>cycle 3: `[]` |
| Docker release guardrail | releaseWrappers | stable | cycle 1: `8`<br>cycle 2: `8`<br>cycle 3: `8` |
| Docker release guardrail | retiredArtifactsPresent | stable | cycle 1: `[]`<br>cycle 2: `[]`<br>cycle 3: `[]` |
| Docker release guardrail | dockerignoreRequiredEntries | stable | cycle 1: `12`<br>cycle 2: `12`<br>cycle 3: `12` |
| Docker release guardrail | dockerignoreCoverageMissing | stable | cycle 1: `[]`<br>cycle 2: `[]`<br>cycle 3: `[]` |
| Docker release guardrail | gitignoreRequiredEntries | stable | cycle 1: `4`<br>cycle 2: `4`<br>cycle 3: `4` |
| Docker release guardrail | gitignoreCoverageMissing | stable | cycle 1: `[]`<br>cycle 2: `[]`<br>cycle 3: `[]` |
| Docker release guardrail | pruneRequiredEntries | stable | cycle 1: `4`<br>cycle 2: `4`<br>cycle 3: `4` |
| Docker release guardrail | pruneCoverageMissing | stable | cycle 1: `[]`<br>cycle 2: `[]`<br>cycle 3: `[]` |
| Docker release guardrail | unsafeDockerPruneTokensPresent | stable | cycle 1: `[]`<br>cycle 2: `[]`<br>cycle 3: `[]` |
| Docker release guardrail | dockerSafePruneFlagInAutomation | stable | cycle 1: `true`<br>cycle 2: `true`<br>cycle 3: `true` |
| Docker release guardrail | fullAutomationPolicyPrune | stable | cycle 1: `true`<br>cycle 2: `true`<br>cycle 3: `true` |
| Docker release guardrail | dockerSafePrunePolicy | stable | cycle 1: `true`<br>cycle 2: `true`<br>cycle 3: `true` |
| Docker release guardrail | postStartDiagnosticsCoverage | stable | cycle 1: `keys:6; sha256:899225d31220; preview:{"scriptPresent":true,"releaseHealthCheck":true,"startRuntimeCheck":true,"localVerifyCheck":true...`<br>cycle 2: `keys:6; sha256:899225d31220; preview:{"scriptPresent":true,"releaseHealthCheck":true,"startRuntimeCheck":true,"localVerifyCheck":true...`<br>cycle 3: `keys:6; sha256:899225d31220; preview:{"scriptPresent":true,"releaseHealthCheck":true,"startRuntimeCheck":true,"localVerifyCheck":true...` |
| Docker release guardrail | cloudflareRuntimeCoverage | stable | cycle 1: `keys:10; sha256:7273a2b79b1d; preview:{"mode":"local-runtime-and-cloudflare-retention-guardrail","scriptsPresent":{"rotateToken":true,...`<br>cycle 2: `keys:10; sha256:7273a2b79b1d; preview:{"mode":"local-runtime-and-cloudflare-retention-guardrail","scriptsPresent":{"rotateToken":true,...`<br>cycle 3: `keys:10; sha256:7273a2b79b1d; preview:{"mode":"local-runtime-and-cloudflare-retention-guardrail","scriptsPresent":{"rotateToken":true,...` |
| Docker release guardrail | testDataCleanupCoverage | stable | cycle 1: `keys:24; sha256:0a8a9602f6cc; preview:{"mode":"qa-smoke-test-data-cleanup-guardrail","scriptPresent":true,"actionHistoryCheckPresent":...`<br>cycle 2: `keys:24; sha256:0a8a9602f6cc; preview:{"mode":"qa-smoke-test-data-cleanup-guardrail","scriptPresent":true,"actionHistoryCheckPresent":...`<br>cycle 3: `keys:24; sha256:0a8a9602f6cc; preview:{"mode":"qa-smoke-test-data-cleanup-guardrail","scriptPresent":true,"actionHistoryCheckPresent":...` |
| Docker release guardrail | policyParseError | stable | cycle 1: ``<br>cycle 2: ``<br>cycle 3: `` |
| Runtime dependency guardrail | appVersion | stable | cycle 1: `6.0.0`<br>cycle 2: `6.0.0`<br>cycle 3: `6.0.0` |
| Runtime dependency guardrail | backendVersion | stable | cycle 1: `6.0.0`<br>cycle 2: `6.0.0`<br>cycle 3: `6.0.0` |
| Runtime dependency guardrail | frontendVersion | stable | cycle 1: `6.0.0`<br>cycle 2: `6.0.0`<br>cycle 3: `6.0.0` |
| Runtime dependency guardrail | opsVersion | stable | cycle 1: `6.0.0`<br>cycle 2: `6.0.0`<br>cycle 3: `6.0.0` |
| Runtime dependency guardrail | versionConsistency | stable | cycle 1: `keys:6; sha256:87b46a055d7a; preview:{"appVersion":"6.0.0","versions":{"backendPackage":"6.0.0","backendLock":"6.0.0","frontendPackag...`<br>cycle 2: `keys:6; sha256:87b46a055d7a; preview:{"appVersion":"6.0.0","versions":{"backendPackage":"6.0.0","backendLock":"6.0.0","frontendPackag...`<br>cycle 3: `keys:6; sha256:87b46a055d7a; preview:{"appVersion":"6.0.0","versions":{"backendPackage":"6.0.0","backendLock":"6.0.0","frontendPackag...` |
| Runtime dependency guardrail | requiredFrontendDeps | stable | cycle 1: `["@zxing/browser","@zxing/library"]`<br>cycle 2: `["@zxing/browser","@zxing/library"]`<br>cycle 3: `["@zxing/browser","@zxing/library"]` |
| Runtime dependency guardrail | missingFrontendDeps | stable | cycle 1: `[]`<br>cycle 2: `[]`<br>cycle 3: `[]` |
| Runtime dependency guardrail | missingLockDeps | stable | cycle 1: `[]`<br>cycle 2: `[]`<br>cycle 3: `[]` |
| Runtime dependency guardrail | forbiddenTrackedConfigsPresent | stable | cycle 1: `[]`<br>cycle 2: `[]`<br>cycle 3: `[]` |
| Runtime dependency guardrail | runtimeVersionGuardCoverage | stable | cycle 1: `keys:9; sha256:8c77d51fcff5; preview:{"viteBuildManifest":true,"viteDefinesFrontendBuild":true,"viteOwnsPostcssPipeline":true,"servic...`<br>cycle 2: `keys:9; sha256:8c77d51fcff5; preview:{"viteBuildManifest":true,"viteDefinesFrontendBuild":true,"viteOwnsPostcssPipeline":true,"servic...`<br>cycle 3: `keys:9; sha256:8c77d51fcff5; preview:{"viteBuildManifest":true,"viteDefinesFrontendBuild":true,"viteOwnsPostcssPipeline":true,"servic...` |
| Runtime dependency guardrail | localVerificationCoverage | stable | cycle 1: `keys:17; sha256:d4ae4ecb26e1; preview:{"progressLabelCoverage":{"preflightStart":true,"preflightEnd":true,"frontendStart":true,"fronte...`<br>cycle 2: `keys:17; sha256:d4ae4ecb26e1; preview:{"progressLabelCoverage":{"preflightStart":true,"preflightEnd":true,"frontendStart":true,"fronte...`<br>cycle 3: `keys:17; sha256:d4ae4ecb26e1; preview:{"progressLabelCoverage":{"preflightStart":true,"preflightEnd":true,"frontendStart":true,"fronte...` |

Full repeat values are retained in `ops/docs/reference/PHASE29-AUDIT.json`; this Markdown report summarizes long arrays and objects with counts, hashes, and previews.

## Boundary

- Generated/runtime bulk is measured through the generated-bulk audit and guarded by policy.
- Folder/schema consistency is checked through organization and schema audits.
- Reference-producing checks run one at a time to avoid Windows file-lock
  contention on generated Markdown/JSON reports; bounded-parallel guardrails run
  after them, then organization audit scans a coherent docs/reference tree.
- Code-flow and large-module candidates are measured through the performance/code-flow scan.
- Language/runtime conversion candidates are measured through the language/runtime audit.
- Docker/release cleanup boundaries are checked by the Docker release verifier.
- Destructive cleanup still requires an explicit cleanup command or retention script, never this audit.
- Console output is concise by default; run with `--verbose` to stream full child-check output while debugging.
