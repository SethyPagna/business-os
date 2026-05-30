# Phase 29 Audit

Generated: 2026-05-30T00:46:04.063Z

Policy: `ops/automation/business-os-automation.json`

## Summary

- Checks: 21
- Failures: 0
- Cycles: 3
- Total child-check duration: 5852 ms
- Repeat consistency: stable
- Execution mode: contention-safe-reference-writers-then-bounded-guardrails
- Reference writer concurrency: 1
- Parallel child-check concurrency: 2
- Mode: non-mutating audit. This command measures and verifies; it does not delete files, move folders, run migrations, or prune remote storage.

## Checks

| Cycle | Check | Status | Duration | Command | Report output |
| --- | --- | --- | --- | --- | --- |
| 1 | Generated bulk audit | passed | 875 ms | `node.exe ops/scripts/architecture/generated-bulk-audit.ts --policy ops/automation/business-os-automation.json` | `ops/docs/reference/GENERATED-BULK-AUDIT.md`<br>`ops/docs/reference/GENERATED-BULK-AUDIT.json` |
| 1 | Schema audit | passed | 122 ms | `node.exe ops/scripts/backend/schema-audit.ts` | `ops/docs/reference/SCHEMA-AUDIT.md`<br>`ops/docs/reference/SCHEMA-AUDIT.json` |
| 1 | Performance/code-flow scan | passed | 180 ms | `node.exe ops/scripts/docs/performance-scan.ts` | `ops/docs/reference/PERFORMANCE-SCAN.md`<br>`ops/docs/reference/PERFORMANCE-SCAN.json` |
| 1 | Language/runtime audit | passed | 202 ms | `node.exe ops/scripts/architecture/language-runtime-audit.ts` | `ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.md`<br>`ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.json` |
| 1 | Docker release guardrail | passed | 126 ms | `node.exe ops/scripts/verification/verify-docker-release.ts` | `ops/docs/reference/DOCKER-RELEASE-GUARDRAIL.json` |
| 1 | Runtime dependency guardrail | passed | 131 ms | `node.exe ops/scripts/verification/verify-runtime-deps.ts` | `ops/docs/reference/RUNTIME-DEPS-GUARDRAIL.json` |
| 1 | Organization audit | passed | 286 ms | `node.exe ops/scripts/architecture/organization-audit.ts` | `ops/docs/reference/ORGANIZATION-AUDIT.md`<br>`ops/docs/reference/ORGANIZATION-AUDIT.json` |
| 2 | Generated bulk audit | passed | 911 ms | `node.exe ops/scripts/architecture/generated-bulk-audit.ts --policy ops/automation/business-os-automation.json` | `ops/docs/reference/GENERATED-BULK-AUDIT.md`<br>`ops/docs/reference/GENERATED-BULK-AUDIT.json` |
| 2 | Schema audit | passed | 137 ms | `node.exe ops/scripts/backend/schema-audit.ts` | `ops/docs/reference/SCHEMA-AUDIT.md`<br>`ops/docs/reference/SCHEMA-AUDIT.json` |
| 2 | Performance/code-flow scan | passed | 180 ms | `node.exe ops/scripts/docs/performance-scan.ts` | `ops/docs/reference/PERFORMANCE-SCAN.md`<br>`ops/docs/reference/PERFORMANCE-SCAN.json` |
| 2 | Language/runtime audit | passed | 231 ms | `node.exe ops/scripts/architecture/language-runtime-audit.ts` | `ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.md`<br>`ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.json` |
| 2 | Docker release guardrail | passed | 133 ms | `node.exe ops/scripts/verification/verify-docker-release.ts` | `ops/docs/reference/DOCKER-RELEASE-GUARDRAIL.json` |
| 2 | Runtime dependency guardrail | passed | 123 ms | `node.exe ops/scripts/verification/verify-runtime-deps.ts` | `ops/docs/reference/RUNTIME-DEPS-GUARDRAIL.json` |
| 2 | Organization audit | passed | 277 ms | `node.exe ops/scripts/architecture/organization-audit.ts` | `ops/docs/reference/ORGANIZATION-AUDIT.md`<br>`ops/docs/reference/ORGANIZATION-AUDIT.json` |
| 3 | Generated bulk audit | passed | 911 ms | `node.exe ops/scripts/architecture/generated-bulk-audit.ts --policy ops/automation/business-os-automation.json` | `ops/docs/reference/GENERATED-BULK-AUDIT.md`<br>`ops/docs/reference/GENERATED-BULK-AUDIT.json` |
| 3 | Schema audit | passed | 135 ms | `node.exe ops/scripts/backend/schema-audit.ts` | `ops/docs/reference/SCHEMA-AUDIT.md`<br>`ops/docs/reference/SCHEMA-AUDIT.json` |
| 3 | Performance/code-flow scan | passed | 164 ms | `node.exe ops/scripts/docs/performance-scan.ts` | `ops/docs/reference/PERFORMANCE-SCAN.md`<br>`ops/docs/reference/PERFORMANCE-SCAN.json` |
| 3 | Language/runtime audit | passed | 208 ms | `node.exe ops/scripts/architecture/language-runtime-audit.ts` | `ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.md`<br>`ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.json` |
| 3 | Docker release guardrail | passed | 128 ms | `node.exe ops/scripts/verification/verify-docker-release.ts` | `ops/docs/reference/DOCKER-RELEASE-GUARDRAIL.json` |
| 3 | Runtime dependency guardrail | passed | 119 ms | `node.exe ops/scripts/verification/verify-runtime-deps.ts` | `ops/docs/reference/RUNTIME-DEPS-GUARDRAIL.json` |
| 3 | Organization audit | passed | 273 ms | `node.exe ops/scripts/architecture/organization-audit.ts` | `ops/docs/reference/ORGANIZATION-AUDIT.md`<br>`ops/docs/reference/ORGANIZATION-AUDIT.json` |

## Duration Summary

| Check | Runs | Total | Average | Max |
| --- | --- | --- | --- | --- |
| Generated bulk audit | 3 | 2697 ms | 899 ms | 911 ms |
| Organization audit | 3 | 836 ms | 279 ms | 286 ms |
| Language/runtime audit | 3 | 641 ms | 214 ms | 231 ms |
| Performance/code-flow scan | 3 | 524 ms | 175 ms | 180 ms |
| Schema audit | 3 | 394 ms | 131 ms | 137 ms |
| Docker release guardrail | 3 | 387 ms | 129 ms | 133 ms |
| Runtime dependency guardrail | 3 | 373 ms | 124 ms | 131 ms |

## Slowest Runs

| Cycle | Check | Duration |
| --- | --- | --- |
| 2 | Generated bulk audit | 911 ms |
| 3 | Generated bulk audit | 911 ms |
| 1 | Generated bulk audit | 875 ms |
| 1 | Organization audit | 286 ms |
| 2 | Organization audit | 277 ms |

## Repeat Consistency

| Check | Field | Status | Values |
| --- | --- | --- | --- |
| Generated bulk audit | totalBytes | stable | cycle 1: `540023252`<br>cycle 2: `540023252`<br>cycle 3: `540023252` |
| Generated bulk audit | protectedBytes | stable | cycle 1: `215889818`<br>cycle 2: `215889818`<br>cycle 3: `215889818` |
| Generated bulk audit | cleanupCandidateBytes | stable | cycle 1: `324133434`<br>cycle 2: `324133434`<br>cycle 3: `324133434` |
| Generated bulk audit | nestedTargetOverlaps | stable | cycle 1: `items:2; sha256:042742607550; preview:[{"parent":"business-os-data","child":"business-os-data/organizations/org_leangcosmetics (Leang ...`<br>cycle 2: `items:2; sha256:042742607550; preview:[{"parent":"business-os-data","child":"business-os-data/organizations/org_leangcosmetics (Leang ...`<br>cycle 3: `items:2; sha256:042742607550; preview:[{"parent":"business-os-data","child":"business-os-data/organizations/org_leangcosmetics (Leang ...` |
| Generated bulk audit | nestedOverlapBytes | stable | cycle 1: `15496556`<br>cycle 2: `15496556`<br>cycle 3: `15496556` |
| Generated bulk audit | adjustedTotalBytes | stable | cycle 1: `524526696`<br>cycle 2: `524526696`<br>cycle 3: `524526696` |
| Generated bulk audit | adjustedProtectedBytes | stable | cycle 1: `200393262`<br>cycle 2: `200393262`<br>cycle 3: `200393262` |
| Generated bulk audit | adjustedCleanupCandidateBytes | stable | cycle 1: `324133434`<br>cycle 2: `324133434`<br>cycle 3: `324133434` |
| Generated bulk audit | largestProtectedTargets | stable | cycle 1: `items:4; sha256:5c8b81fa1891; preview:[{"path":"business-os-data","bytes":163307370,"files":52,"folders":35,"category":"business data"...`<br>cycle 2: `items:4; sha256:5c8b81fa1891; preview:[{"path":"business-os-data","bytes":163307370,"files":52,"folders":35,"category":"business data"...`<br>cycle 3: `items:4; sha256:5c8b81fa1891; preview:[{"path":"business-os-data","bytes":163307370,"files":52,"folders":35,"category":"business data"...` |
| Generated bulk audit | largestCleanupTargets | stable | cycle 1: `items:4; sha256:971d0a9f6450; preview:[{"path":"frontend/node_modules","bytes":158132222,"files":11264,"folders":986,"category":"depen...`<br>cycle 2: `items:4; sha256:971d0a9f6450; preview:[{"path":"frontend/node_modules","bytes":158132222,"files":11264,"folders":986,"category":"depen...`<br>cycle 3: `items:4; sha256:971d0a9f6450; preview:[{"path":"frontend/node_modules","bytes":158132222,"files":11264,"folders":986,"category":"depen...` |
| Generated bulk audit | dispositionTotals | stable | cycle 1: `keys:5; sha256:85d03524401a; preview:{"preserve":{"bytes":178803926,"files":68,"folders":37,"targets":3},"retention":{"bytes":3708589...`<br>cycle 2: `keys:5; sha256:85d03524401a; preview:{"preserve":{"bytes":178803926,"files":68,"folders":37,"targets":3},"retention":{"bytes":3708589...`<br>cycle 3: `keys:5; sha256:85d03524401a; preview:{"preserve":{"bytes":178803926,"files":68,"folders":37,"targets":3},"retention":{"bytes":3708589...` |
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
| Organization audit | filesScanned | stable | cycle 1: `545`<br>cycle 2: `545`<br>cycle 3: `545` |
| Organization audit | largeFiles | stable | cycle 1: `75`<br>cycle 2: `75`<br>cycle 3: `75` |
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
| Organization audit | largestAreas | stable | cycle 1: `items:30; sha256:6ed6c26769bb; preview:[["frontend/utils",32],["frontend/components/products",31],["ops/docs/reference",30],["backend/r...`<br>cycle 2: `items:30; sha256:6ed6c26769bb; preview:[["frontend/utils",32],["frontend/components/products",31],["ops/docs/reference",30],["backend/r...`<br>cycle 3: `items:30; sha256:6ed6c26769bb; preview:[["frontend/utils",32],["frontend/components/products",31],["ops/docs/reference",30],["backend/r...` |
| Organization audit | largeFilePaths | stable | cycle 1: `items:75; sha256:bdb4d3834f09; preview:["backend/src/db/postgresSchema.sql","backend/src/fileAssets.js","backend/src/routes/auth.js","b...`<br>cycle 2: `items:75; sha256:bdb4d3834f09; preview:["backend/src/db/postgresSchema.sql","backend/src/fileAssets.js","backend/src/routes/auth.js","b...`<br>cycle 3: `items:75; sha256:bdb4d3834f09; preview:["backend/src/db/postgresSchema.sql","backend/src/fileAssets.js","backend/src/routes/auth.js","b...` |
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
| Performance/code-flow scan | sourceFiles | stable | cycle 1: `351`<br>cycle 2: `351`<br>cycle 3: `351` |
| Performance/code-flow scan | distAssets | stable | cycle 1: `84`<br>cycle 2: `84`<br>cycle 3: `84` |
| Performance/code-flow scan | totalSourceBytes | stable | cycle 1: `6328352`<br>cycle 2: `6328352`<br>cycle 3: `6328352` |
| Performance/code-flow scan | totalSourceLines | stable | cycle 1: `142699`<br>cycle 2: `142699`<br>cycle 3: `142699` |
| Performance/code-flow scan | largestSourceFile | stable | cycle 1: `frontend/src/lang/km.json`<br>cycle 2: `frontend/src/lang/km.json`<br>cycle 3: `frontend/src/lang/km.json` |
| Performance/code-flow scan | largestSourceLinesFile | stable | cycle 1: `frontend/src/components/inventory/Inventory.jsx`<br>cycle 2: `frontend/src/components/inventory/Inventory.jsx`<br>cycle 3: `frontend/src/components/inventory/Inventory.jsx` |
| Performance/code-flow scan | largestBuiltChunk | stable | cycle 1: `frontend/dist/assets/vendor-zxing-BxcS2Ffh.js`<br>cycle 2: `frontend/dist/assets/vendor-zxing-BxcS2Ffh.js`<br>cycle 3: `frontend/dist/assets/vendor-zxing-BxcS2Ffh.js` |
| Performance/code-flow scan | oversizedSourceFiles | stable | cycle 1: `items:19; sha256:d1eba2bacc47; preview:["backend/src/routes/inventory.js","backend/src/routes/products.js","backend/src/routes/sales.js...`<br>cycle 2: `items:19; sha256:d1eba2bacc47; preview:["backend/src/routes/inventory.js","backend/src/routes/products.js","backend/src/routes/sales.js...`<br>cycle 3: `items:19; sha256:d1eba2bacc47; preview:["backend/src/routes/inventory.js","backend/src/routes/products.js","backend/src/routes/sales.js...` |
| Performance/code-flow scan | oversizedBuiltChunks | stable | cycle 1: `items:5; sha256:86c828befc84; preview:["frontend/dist/assets/catalog-Dc0uS5F3.js","frontend/dist/assets/index-DQztsXP7.css","frontend/...`<br>cycle 2: `items:5; sha256:86c828befc84; preview:["frontend/dist/assets/catalog-Dc0uS5F3.js","frontend/dist/assets/index-DQztsXP7.css","frontend/...`<br>cycle 3: `items:5; sha256:86c828befc84; preview:["frontend/dist/assets/catalog-Dc0uS5F3.js","frontend/dist/assets/index-DQztsXP7.css","frontend/...` |
| Performance/code-flow scan | topSourceBySize | stable | cycle 1: `items:25; sha256:ab747a1c9701; preview:[{"file":"frontend/src/lang/km.json","size":252664,"lines":2730},{"file":"frontend/src/component...`<br>cycle 2: `items:25; sha256:ab747a1c9701; preview:[{"file":"frontend/src/lang/km.json","size":252664,"lines":2730},{"file":"frontend/src/component...`<br>cycle 3: `items:25; sha256:ab747a1c9701; preview:[{"file":"frontend/src/lang/km.json","size":252664,"lines":2730},{"file":"frontend/src/component...` |
| Performance/code-flow scan | topSourceByLines | stable | cycle 1: `items:25; sha256:9db7c5002382; preview:[{"file":"frontend/src/components/inventory/Inventory.jsx","size":213963,"lines":4123},{"file":"...`<br>cycle 2: `items:25; sha256:9db7c5002382; preview:[{"file":"frontend/src/components/inventory/Inventory.jsx","size":213963,"lines":4123},{"file":"...`<br>cycle 3: `items:25; sha256:9db7c5002382; preview:[{"file":"frontend/src/components/inventory/Inventory.jsx","size":213963,"lines":4123},{"file":"...` |
| Performance/code-flow scan | topBuiltChunks | stable | cycle 1: `items:25; sha256:c9af475d5b02; preview:[{"file":"frontend/dist/assets/vendor-zxing-BxcS2Ffh.js","size":446639,"lines":0},{"file":"front...`<br>cycle 2: `items:25; sha256:c9af475d5b02; preview:[{"file":"frontend/dist/assets/vendor-zxing-BxcS2Ffh.js","size":446639,"lines":0},{"file":"front...`<br>cycle 3: `items:25; sha256:c9af475d5b02; preview:[{"file":"frontend/dist/assets/vendor-zxing-BxcS2Ffh.js","size":446639,"lines":0},{"file":"front...` |
| Performance/code-flow scan | manualNotesPreserved | stable | cycle 1: `true`<br>cycle 2: `true`<br>cycle 3: `true` |
| Performance/code-flow scan | manualNotesLines | stable | cycle 1: `966`<br>cycle 2: `966`<br>cycle 3: `966` |
| Performance/code-flow scan | sourceReadMode | stable | cycle 1: `bounded-parallel`<br>cycle 2: `bounded-parallel`<br>cycle 3: `bounded-parallel` |
| Performance/code-flow scan | sourceReadConcurrency | stable | cycle 1: `24`<br>cycle 2: `24`<br>cycle 3: `24` |
| Performance/code-flow scan | chunkStatConcurrency | stable | cycle 1: `32`<br>cycle 2: `32`<br>cycle 3: `32` |
| Language/runtime audit | mode | stable | cycle 1: `non-mutating`<br>cycle 2: `non-mutating`<br>cycle 3: `non-mutating` |
| Language/runtime audit | scanRoots | stable | cycle 1: `["frontend/src","frontend/tests","backend/src","backend/test","ops/scripts","run"]`<br>cycle 2: `["frontend/src","frontend/tests","backend/src","backend/test","ops/scripts","run"]`<br>cycle 3: `["frontend/src","frontend/tests","backend/src","backend/test","ops/scripts","run"]` |
| Language/runtime audit | sourceFiles | stable | cycle 1: `448`<br>cycle 2: `448`<br>cycle 3: `448` |
| Language/runtime audit | fileReadMode | stable | cycle 1: `bounded-parallel`<br>cycle 2: `bounded-parallel`<br>cycle 3: `bounded-parallel` |
| Language/runtime audit | rootWalkMode | stable | cycle 1: `bounded-parallel`<br>cycle 2: `bounded-parallel`<br>cycle 3: `bounded-parallel` |
| Language/runtime audit | rootWalkConcurrency | stable | cycle 1: `3`<br>cycle 2: `3`<br>cycle 3: `3` |
| Language/runtime audit | matrixCheckMode | stable | cycle 1: `bounded-parallel`<br>cycle 2: `bounded-parallel`<br>cycle 3: `bounded-parallel` |
| Language/runtime audit | matrixCheckConcurrency | stable | cycle 1: `8`<br>cycle 2: `8`<br>cycle 3: `8` |
| Language/runtime audit | fileReadConcurrency | stable | cycle 1: `24`<br>cycle 2: `24`<br>cycle 3: `24` |
| Language/runtime audit | languageCounts | stable | cycle 1: `items:10; sha256:3c802a76f00b; preview:[["TypeScript",225],["React TSX",94],["JavaScript",84],["Windows batch",16],["React JSX",13],["P...`<br>cycle 2: `items:10; sha256:3c802a76f00b; preview:[["TypeScript",225],["React TSX",94],["JavaScript",84],["Windows batch",16],["React JSX",13],["P...`<br>cycle 3: `items:10; sha256:3c802a76f00b; preview:[["TypeScript",225],["React TSX",94],["JavaScript",84],["Windows batch",16],["React JSX",13],["P...` |
| Language/runtime audit | extensionCounts | stable | cycle 1: `[[".ts",225],[".tsx",94],[".js",84],[".bat",16],[".jsx",13],[".ps1",8],[".sh",3],[".json",2],[".sql",2],[".css",1]]`<br>cycle 2: `[[".ts",225],[".tsx",94],[".js",84],[".bat",16],[".jsx",13],[".ps1",8],[".sh",3],[".json",2],[".sql",2],[".css",1]]`<br>cycle 3: `[[".ts",225],[".tsx",94],[".js",84],[".bat",16],[".jsx",13],[".ps1",8],[".sh",3],[".json",2],[".sql",2],[".css",1]]` |
| Language/runtime audit | defaults | stable | cycle 1: `keys:5; sha256:23699dab93e2; preview:{"frontend":"React/JavaScript","backend":"Node.js","heavyData":"SQL/DuckDB before new general-pu...`<br>cycle 2: `keys:5; sha256:23699dab93e2; preview:{"frontend":"React/JavaScript","backend":"Node.js","heavyData":"SQL/DuckDB before new general-pu...`<br>cycle 3: `keys:5; sha256:23699dab93e2; preview:{"frontend":"React/JavaScript","backend":"Node.js","heavyData":"SQL/DuckDB before new general-pu...` |
| Language/runtime audit | packagingGate | stable | cycle 1: `No backend language/runtime conversion without release packaging and rollback proof.`<br>cycle 2: `No backend language/runtime conversion without release packaging and rollback proof.`<br>cycle 3: `No backend language/runtime conversion without release packaging and rollback proof.` |
| Language/runtime audit | runtimePolicy | stable | cycle 1: `items:5; sha256:fc7bab5f41f4; preview:[{"runtime":"TypeScript","decision":"target pure helpers first","evidenceRequired":"typecheck, f...`<br>cycle 2: `items:5; sha256:fc7bab5f41f4; preview:[{"runtime":"TypeScript","decision":"target pure helpers first","evidenceRequired":"typecheck, f...`<br>cycle 3: `items:5; sha256:fc7bab5f41f4; preview:[{"runtime":"TypeScript","decision":"target pure helpers first","evidenceRequired":"typecheck, f...` |
| Language/runtime audit | rejectedRuntimeFamilies | stable | cycle 1: `items:4; sha256:355071f9d529; preview:[{"runtime":"Rust","reason":"No benchmark-backed hot path currently requires native compilation....`<br>cycle 2: `items:4; sha256:355071f9d529; preview:[{"runtime":"Rust","reason":"No benchmark-backed hot path currently requires native compilation....`<br>cycle 3: `items:4; sha256:355071f9d529; preview:[{"runtime":"Rust","reason":"No benchmark-backed hot path currently requires native compilation....` |
| Language/runtime audit | verificationMatrix | stable | cycle 1: `items:3; sha256:eb61ff18471b; preview:[{"track":"TypeScript utility conversion","requiredProof":["npm.cmd --prefix frontend run typech...`<br>cycle 2: `items:3; sha256:eb61ff18471b; preview:[{"track":"TypeScript utility conversion","requiredProof":["npm.cmd --prefix frontend run typech...`<br>cycle 3: `items:3; sha256:eb61ff18471b; preview:[{"track":"TypeScript utility conversion","requiredProof":["npm.cmd --prefix frontend run typech...` |
| Language/runtime audit | firstExecutableSlices | stable | cycle 1: `items:3; sha256:2f7f621cad28; preview:[{"track":"TypeScript utility conversion","firstCandidate":"","score":0,"lines":0,"requiredProof...`<br>cycle 2: `items:3; sha256:2f7f621cad28; preview:[{"track":"TypeScript utility conversion","firstCandidate":"","score":0,"lines":0,"requiredProof...`<br>cycle 3: `items:3; sha256:2f7f621cad28; preview:[{"track":"TypeScript utility conversion","firstCandidate":"","score":0,"lines":0,"requiredProof...` |
| Language/runtime audit | proofCommandCoverage | stable | cycle 1: `items:12; sha256:74575772e0e2; preview:[{"track":"TypeScript utility conversion","proof":"npm.cmd --prefix frontend run typecheck","typ...`<br>cycle 2: `items:12; sha256:74575772e0e2; preview:[{"track":"TypeScript utility conversion","proof":"npm.cmd --prefix frontend run typecheck","typ...`<br>cycle 3: `items:12; sha256:74575772e0e2; preview:[{"track":"TypeScript utility conversion","proof":"npm.cmd --prefix frontend run typecheck","typ...` |
| Language/runtime audit | missingProofCommands | stable | cycle 1: `[]`<br>cycle 2: `[]`<br>cycle 3: `[]` |
| Language/runtime audit | focusedTestCoverage | stable | cycle 1: `items:5; sha256:aa8cf8dab372; preview:[{"track":"Completed TypeScript utility conversion","candidate":"frontend/src/utils/csvImport.ts...`<br>cycle 2: `items:5; sha256:aa8cf8dab372; preview:[{"track":"Completed TypeScript utility conversion","candidate":"frontend/src/utils/csvImport.ts...`<br>cycle 3: `items:5; sha256:aa8cf8dab372; preview:[{"track":"Completed TypeScript utility conversion","candidate":"frontend/src/utils/csvImport.ts...` |
| Language/runtime audit | focusedTestCoverageGaps | stable | cycle 1: `[]`<br>cycle 2: `[]`<br>cycle 3: `[]` |
| Language/runtime audit | convertedTypeScriptSlices | stable | cycle 1: `items:51; sha256:f8e47fa3495b; preview:[{"implementation":"frontend/src/app/appShellUtils.ts","compatibilityWrapper":"","wrapperStatus"...`<br>cycle 2: `items:51; sha256:f8e47fa3495b; preview:[{"implementation":"frontend/src/app/appShellUtils.ts","compatibilityWrapper":"","wrapperStatus"...`<br>cycle 3: `items:51; sha256:f8e47fa3495b; preview:[{"implementation":"frontend/src/app/appShellUtils.ts","compatibilityWrapper":"","wrapperStatus"...` |
| Language/runtime audit | convertedTypeScriptCoverageGaps | stable | cycle 1: `[]`<br>cycle 2: `[]`<br>cycle 3: `[]` |
| Language/runtime audit | conversionCandidates | stable | cycle 1: `items:1; sha256:c0595d41c250; preview:[{"file":"frontend/src/components/products/scanning/scanbotScanner.ts","lines":180,"score":5,"tr...`<br>cycle 2: `items:1; sha256:c0595d41c250; preview:[{"file":"frontend/src/components/products/scanning/scanbotScanner.ts","lines":180,"score":5,"tr...`<br>cycle 3: `items:1; sha256:c0595d41c250; preview:[{"file":"frontend/src/components/products/scanning/scanbotScanner.ts","lines":180,"score":5,"tr...` |
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
