# Phase 29 Audit

Generated: 2026-05-27T21:29:06.290Z

Policy: `ops/automation/business-os-automation.json`

## Summary

- Checks: 21
- Failures: 0
- Cycles: 3
- Total child-check duration: 5048 ms
- Repeat consistency: stable
- Execution mode: contention-safe-reference-writers-then-bounded-guardrails
- Reference writer concurrency: 1
- Parallel child-check concurrency: 2
- Mode: non-mutating audit. This command measures and verifies; it does not delete files, move folders, run migrations, or prune remote storage.

## Checks

| Cycle | Check | Status | Duration | Command | Report output |
| --- | --- | --- | --- | --- | --- |
| 1 | Generated bulk audit | passed | 905 ms | `node.exe ops/scripts/architecture/generated-bulk-audit.mjs --policy ops/automation/business-os-automation.json` | `ops/docs/reference/GENERATED-BULK-AUDIT.md`<br>`ops/docs/reference/GENERATED-BULK-AUDIT.json` |
| 1 | Schema audit | passed | 107 ms | `node.exe ops/scripts/backend/schema-audit.js` | `ops/docs/reference/SCHEMA-AUDIT.md`<br>`ops/docs/reference/SCHEMA-AUDIT.json` |
| 1 | Performance/code-flow scan | passed | 142 ms | `node.exe ops/scripts/docs/performance-scan.js` | `ops/docs/reference/PERFORMANCE-SCAN.md`<br>`ops/docs/reference/PERFORMANCE-SCAN.json` |
| 1 | Language/runtime audit | passed | 185 ms | `node.exe ops/scripts/architecture/language-runtime-audit.mjs` | `ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.md`<br>`ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.json` |
| 1 | Docker release guardrail | passed | 93 ms | `node.exe ops/scripts/verification/verify-docker-release.js` | `ops/docs/reference/DOCKER-RELEASE-GUARDRAIL.json` |
| 1 | Runtime dependency guardrail | passed | 94 ms | `node.exe ops/scripts/verification/verify-runtime-deps.js` | `ops/docs/reference/RUNTIME-DEPS-GUARDRAIL.json` |
| 1 | Organization audit | passed | 241 ms | `node.exe ops/scripts/architecture/organization-audit.mjs` | `ops/docs/reference/ORGANIZATION-AUDIT.md`<br>`ops/docs/reference/ORGANIZATION-AUDIT.json` |
| 2 | Generated bulk audit | passed | 928 ms | `node.exe ops/scripts/architecture/generated-bulk-audit.mjs --policy ops/automation/business-os-automation.json` | `ops/docs/reference/GENERATED-BULK-AUDIT.md`<br>`ops/docs/reference/GENERATED-BULK-AUDIT.json` |
| 2 | Schema audit | passed | 93 ms | `node.exe ops/scripts/backend/schema-audit.js` | `ops/docs/reference/SCHEMA-AUDIT.md`<br>`ops/docs/reference/SCHEMA-AUDIT.json` |
| 2 | Performance/code-flow scan | passed | 129 ms | `node.exe ops/scripts/docs/performance-scan.js` | `ops/docs/reference/PERFORMANCE-SCAN.md`<br>`ops/docs/reference/PERFORMANCE-SCAN.json` |
| 2 | Language/runtime audit | passed | 170 ms | `node.exe ops/scripts/architecture/language-runtime-audit.mjs` | `ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.md`<br>`ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.json` |
| 2 | Docker release guardrail | passed | 79 ms | `node.exe ops/scripts/verification/verify-docker-release.js` | `ops/docs/reference/DOCKER-RELEASE-GUARDRAIL.json` |
| 2 | Runtime dependency guardrail | passed | 77 ms | `node.exe ops/scripts/verification/verify-runtime-deps.js` | `ops/docs/reference/RUNTIME-DEPS-GUARDRAIL.json` |
| 2 | Organization audit | passed | 233 ms | `node.exe ops/scripts/architecture/organization-audit.mjs` | `ops/docs/reference/ORGANIZATION-AUDIT.md`<br>`ops/docs/reference/ORGANIZATION-AUDIT.json` |
| 3 | Generated bulk audit | passed | 803 ms | `node.exe ops/scripts/architecture/generated-bulk-audit.mjs --policy ops/automation/business-os-automation.json` | `ops/docs/reference/GENERATED-BULK-AUDIT.md`<br>`ops/docs/reference/GENERATED-BULK-AUDIT.json` |
| 3 | Schema audit | passed | 86 ms | `node.exe ops/scripts/backend/schema-audit.js` | `ops/docs/reference/SCHEMA-AUDIT.md`<br>`ops/docs/reference/SCHEMA-AUDIT.json` |
| 3 | Performance/code-flow scan | passed | 123 ms | `node.exe ops/scripts/docs/performance-scan.js` | `ops/docs/reference/PERFORMANCE-SCAN.md`<br>`ops/docs/reference/PERFORMANCE-SCAN.json` |
| 3 | Language/runtime audit | passed | 165 ms | `node.exe ops/scripts/architecture/language-runtime-audit.mjs` | `ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.md`<br>`ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.json` |
| 3 | Docker release guardrail | passed | 81 ms | `node.exe ops/scripts/verification/verify-docker-release.js` | `ops/docs/reference/DOCKER-RELEASE-GUARDRAIL.json` |
| 3 | Runtime dependency guardrail | passed | 84 ms | `node.exe ops/scripts/verification/verify-runtime-deps.js` | `ops/docs/reference/RUNTIME-DEPS-GUARDRAIL.json` |
| 3 | Organization audit | passed | 230 ms | `node.exe ops/scripts/architecture/organization-audit.mjs` | `ops/docs/reference/ORGANIZATION-AUDIT.md`<br>`ops/docs/reference/ORGANIZATION-AUDIT.json` |

## Duration Summary

| Check | Runs | Total | Average | Max |
| --- | --- | --- | --- | --- |
| Generated bulk audit | 3 | 2636 ms | 879 ms | 928 ms |
| Organization audit | 3 | 704 ms | 235 ms | 241 ms |
| Language/runtime audit | 3 | 520 ms | 173 ms | 185 ms |
| Performance/code-flow scan | 3 | 394 ms | 131 ms | 142 ms |
| Schema audit | 3 | 286 ms | 95 ms | 107 ms |
| Runtime dependency guardrail | 3 | 255 ms | 85 ms | 94 ms |
| Docker release guardrail | 3 | 253 ms | 84 ms | 93 ms |

## Slowest Runs

| Cycle | Check | Duration |
| --- | --- | --- |
| 2 | Generated bulk audit | 928 ms |
| 1 | Generated bulk audit | 905 ms |
| 3 | Generated bulk audit | 803 ms |
| 1 | Organization audit | 241 ms |
| 2 | Organization audit | 233 ms |

## Repeat Consistency

| Check | Field | Status | Values |
| --- | --- | --- | --- |
| Generated bulk audit | totalBytes | stable | cycle 1: `537204744`<br>cycle 2: `537204744`<br>cycle 3: `537204744` |
| Generated bulk audit | protectedBytes | stable | cycle 1: `214958972`<br>cycle 2: `214958972`<br>cycle 3: `214958972` |
| Generated bulk audit | cleanupCandidateBytes | stable | cycle 1: `322245772`<br>cycle 2: `322245772`<br>cycle 3: `322245772` |
| Generated bulk audit | nestedTargetOverlaps | stable | cycle 1: `items:2; sha256:042742607550; preview:[{"parent":"business-os-data","child":"business-os-data/organizations/org_leangcosmetics (Leang ...`<br>cycle 2: `items:2; sha256:042742607550; preview:[{"parent":"business-os-data","child":"business-os-data/organizations/org_leangcosmetics (Leang ...`<br>cycle 3: `items:2; sha256:042742607550; preview:[{"parent":"business-os-data","child":"business-os-data/organizations/org_leangcosmetics (Leang ...` |
| Generated bulk audit | nestedOverlapBytes | stable | cycle 1: `15496556`<br>cycle 2: `15496556`<br>cycle 3: `15496556` |
| Generated bulk audit | adjustedTotalBytes | stable | cycle 1: `521708188`<br>cycle 2: `521708188`<br>cycle 3: `521708188` |
| Generated bulk audit | adjustedProtectedBytes | stable | cycle 1: `199462416`<br>cycle 2: `199462416`<br>cycle 3: `199462416` |
| Generated bulk audit | adjustedCleanupCandidateBytes | stable | cycle 1: `322245772`<br>cycle 2: `322245772`<br>cycle 3: `322245772` |
| Generated bulk audit | largestProtectedTargets | stable | cycle 1: `items:4; sha256:84b0028c7bd3; preview:[{"path":"business-os-data","bytes":163307370,"files":52,"folders":35,"category":"business data"...`<br>cycle 2: `items:4; sha256:84b0028c7bd3; preview:[{"path":"business-os-data","bytes":163307370,"files":52,"folders":35,"category":"business data"...`<br>cycle 3: `items:4; sha256:84b0028c7bd3; preview:[{"path":"business-os-data","bytes":163307370,"files":52,"folders":35,"category":"business data"...` |
| Generated bulk audit | largestCleanupTargets | stable | cycle 1: `items:4; sha256:e72af01adea7; preview:[{"path":"frontend/node_modules","bytes":156252794,"files":11241,"folders":985,"category":"depen...`<br>cycle 2: `items:4; sha256:e72af01adea7; preview:[{"path":"frontend/node_modules","bytes":156252794,"files":11241,"folders":985,"category":"depen...`<br>cycle 3: `items:4; sha256:e72af01adea7; preview:[{"path":"frontend/node_modules","bytes":156252794,"files":11241,"folders":985,"category":"depen...` |
| Generated bulk audit | dispositionTotals | stable | cycle 1: `keys:5; sha256:f0cd8654bb85; preview:{"preserve":{"bytes":178803926,"files":68,"folders":37,"targets":3},"retention":{"bytes":3615504...`<br>cycle 2: `keys:5; sha256:f0cd8654bb85; preview:{"preserve":{"bytes":178803926,"files":68,"folders":37,"targets":3},"retention":{"bytes":3615504...`<br>cycle 3: `keys:5; sha256:f0cd8654bb85; preview:{"preserve":{"bytes":178803926,"files":68,"folders":37,"targets":3},"retention":{"bytes":3615504...` |
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
| Organization audit | filesScanned | stable | cycle 1: `626`<br>cycle 2: `626`<br>cycle 3: `626` |
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
| Organization audit | largestAreas | stable | cycle 1: `items:30; sha256:381d209ea89b; preview:[["frontend/utils",65],["frontend/components/products",47],["ops/docs/reference",30],["backend/r...`<br>cycle 2: `items:30; sha256:381d209ea89b; preview:[["frontend/utils",65],["frontend/components/products",47],["ops/docs/reference",30],["backend/r...`<br>cycle 3: `items:30; sha256:381d209ea89b; preview:[["frontend/utils",65],["frontend/components/products",47],["ops/docs/reference",30],["backend/r...` |
| Organization audit | largeFilePaths | stable | cycle 1: `items:71; sha256:6c63fe6c056d; preview:["backend/src/db/postgresSchema.sql","backend/src/fileAssets.js","backend/src/routes/auth.js","b...`<br>cycle 2: `items:71; sha256:6c63fe6c056d; preview:["backend/src/db/postgresSchema.sql","backend/src/fileAssets.js","backend/src/routes/auth.js","b...`<br>cycle 3: `items:71; sha256:6c63fe6c056d; preview:["backend/src/db/postgresSchema.sql","backend/src/fileAssets.js","backend/src/routes/auth.js","b...` |
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
| Performance/code-flow scan | sourceFiles | stable | cycle 1: `349`<br>cycle 2: `349`<br>cycle 3: `349` |
| Performance/code-flow scan | distAssets | stable | cycle 1: `87`<br>cycle 2: `87`<br>cycle 3: `87` |
| Performance/code-flow scan | totalSourceBytes | stable | cycle 1: `5531043`<br>cycle 2: `5531043`<br>cycle 3: `5531043` |
| Performance/code-flow scan | totalSourceLines | stable | cycle 1: `121847`<br>cycle 2: `121847`<br>cycle 3: `121847` |
| Performance/code-flow scan | largestSourceFile | stable | cycle 1: `frontend/src/lang/km.json`<br>cycle 2: `frontend/src/lang/km.json`<br>cycle 3: `frontend/src/lang/km.json` |
| Performance/code-flow scan | largestSourceLinesFile | stable | cycle 1: `frontend/src/components/inventory/Inventory.jsx`<br>cycle 2: `frontend/src/components/inventory/Inventory.jsx`<br>cycle 3: `frontend/src/components/inventory/Inventory.jsx` |
| Performance/code-flow scan | largestBuiltChunk | stable | cycle 1: `frontend/dist/assets/vendor-zxing-BxcS2Ffh.js`<br>cycle 2: `frontend/dist/assets/vendor-zxing-BxcS2Ffh.js`<br>cycle 3: `frontend/dist/assets/vendor-zxing-BxcS2Ffh.js` |
| Performance/code-flow scan | oversizedSourceFiles | stable | cycle 1: `items:18; sha256:adeb496fee59; preview:["backend/src/routes/inventory.js","backend/src/routes/products.js","backend/src/routes/sales.js...`<br>cycle 2: `items:18; sha256:adeb496fee59; preview:["backend/src/routes/inventory.js","backend/src/routes/products.js","backend/src/routes/sales.js...`<br>cycle 3: `items:18; sha256:adeb496fee59; preview:["backend/src/routes/inventory.js","backend/src/routes/products.js","backend/src/routes/sales.js...` |
| Performance/code-flow scan | oversizedBuiltChunks | stable | cycle 1: `items:5; sha256:2d933595bed2; preview:["frontend/dist/assets/catalog-DGWibL8A.js","frontend/dist/assets/index-DQztsXP7.css","frontend/...`<br>cycle 2: `items:5; sha256:2d933595bed2; preview:["frontend/dist/assets/catalog-DGWibL8A.js","frontend/dist/assets/index-DQztsXP7.css","frontend/...`<br>cycle 3: `items:5; sha256:2d933595bed2; preview:["frontend/dist/assets/catalog-DGWibL8A.js","frontend/dist/assets/index-DQztsXP7.css","frontend/...` |
| Performance/code-flow scan | topSourceBySize | stable | cycle 1: `items:25; sha256:ba7b8649cc38; preview:[{"file":"frontend/src/lang/km.json","size":250756,"lines":2715},{"file":"frontend/src/component...`<br>cycle 2: `items:25; sha256:ba7b8649cc38; preview:[{"file":"frontend/src/lang/km.json","size":250756,"lines":2715},{"file":"frontend/src/component...`<br>cycle 3: `items:25; sha256:ba7b8649cc38; preview:[{"file":"frontend/src/lang/km.json","size":250756,"lines":2715},{"file":"frontend/src/component...` |
| Performance/code-flow scan | topSourceByLines | stable | cycle 1: `items:25; sha256:fe737ebe3c2a; preview:[{"file":"frontend/src/components/inventory/Inventory.jsx","size":213992,"lines":4123},{"file":"...`<br>cycle 2: `items:25; sha256:fe737ebe3c2a; preview:[{"file":"frontend/src/components/inventory/Inventory.jsx","size":213992,"lines":4123},{"file":"...`<br>cycle 3: `items:25; sha256:fe737ebe3c2a; preview:[{"file":"frontend/src/components/inventory/Inventory.jsx","size":213992,"lines":4123},{"file":"...` |
| Performance/code-flow scan | topBuiltChunks | stable | cycle 1: `items:25; sha256:10a8ca94a798; preview:[{"file":"frontend/dist/assets/vendor-zxing-BxcS2Ffh.js","size":446639,"lines":0},{"file":"front...`<br>cycle 2: `items:25; sha256:10a8ca94a798; preview:[{"file":"frontend/dist/assets/vendor-zxing-BxcS2Ffh.js","size":446639,"lines":0},{"file":"front...`<br>cycle 3: `items:25; sha256:10a8ca94a798; preview:[{"file":"frontend/dist/assets/vendor-zxing-BxcS2Ffh.js","size":446639,"lines":0},{"file":"front...` |
| Performance/code-flow scan | manualNotesPreserved | stable | cycle 1: `true`<br>cycle 2: `true`<br>cycle 3: `true` |
| Performance/code-flow scan | manualNotesLines | stable | cycle 1: `966`<br>cycle 2: `966`<br>cycle 3: `966` |
| Performance/code-flow scan | sourceReadMode | stable | cycle 1: `bounded-parallel`<br>cycle 2: `bounded-parallel`<br>cycle 3: `bounded-parallel` |
| Performance/code-flow scan | sourceReadConcurrency | stable | cycle 1: `24`<br>cycle 2: `24`<br>cycle 3: `24` |
| Performance/code-flow scan | chunkStatConcurrency | stable | cycle 1: `32`<br>cycle 2: `32`<br>cycle 3: `32` |
| Language/runtime audit | mode | stable | cycle 1: `non-mutating`<br>cycle 2: `non-mutating`<br>cycle 3: `non-mutating` |
| Language/runtime audit | scanRoots | stable | cycle 1: `["frontend/src","frontend/tests","backend/src","backend/test","ops/scripts","run"]`<br>cycle 2: `["frontend/src","frontend/tests","backend/src","backend/test","ops/scripts","run"]`<br>cycle 3: `["frontend/src","frontend/tests","backend/src","backend/test","ops/scripts","run"]` |
| Language/runtime audit | sourceFiles | stable | cycle 1: `528`<br>cycle 2: `528`<br>cycle 3: `528` |
| Language/runtime audit | fileReadMode | stable | cycle 1: `bounded-parallel`<br>cycle 2: `bounded-parallel`<br>cycle 3: `bounded-parallel` |
| Language/runtime audit | rootWalkMode | stable | cycle 1: `bounded-parallel`<br>cycle 2: `bounded-parallel`<br>cycle 3: `bounded-parallel` |
| Language/runtime audit | rootWalkConcurrency | stable | cycle 1: `3`<br>cycle 2: `3`<br>cycle 3: `3` |
| Language/runtime audit | matrixCheckMode | stable | cycle 1: `bounded-parallel`<br>cycle 2: `bounded-parallel`<br>cycle 3: `bounded-parallel` |
| Language/runtime audit | matrixCheckConcurrency | stable | cycle 1: `8`<br>cycle 2: `8`<br>cycle 3: `8` |
| Language/runtime audit | fileReadConcurrency | stable | cycle 1: `24`<br>cycle 2: `24`<br>cycle 3: `24` |
| Language/runtime audit | languageCounts | stable | cycle 1: `items:10; sha256:ef024df2156b; preview:[["JavaScript",184],["JavaScript modules",120],["React JSX",107],["TypeScript",85],["Windows bat...`<br>cycle 2: `items:10; sha256:ef024df2156b; preview:[["JavaScript",184],["JavaScript modules",120],["React JSX",107],["TypeScript",85],["Windows bat...`<br>cycle 3: `items:10; sha256:ef024df2156b; preview:[["JavaScript",184],["JavaScript modules",120],["React JSX",107],["TypeScript",85],["Windows bat...` |
| Language/runtime audit | extensionCounts | stable | cycle 1: `[[".js",184],[".mjs",120],[".jsx",107],[".ts",85],[".bat",16],[".ps1",8],[".sh",3],[".json",2],[".sql",2],[".css",1]]`<br>cycle 2: `[[".js",184],[".mjs",120],[".jsx",107],[".ts",85],[".bat",16],[".ps1",8],[".sh",3],[".json",2],[".sql",2],[".css",1]]`<br>cycle 3: `[[".js",184],[".mjs",120],[".jsx",107],[".ts",85],[".bat",16],[".ps1",8],[".sh",3],[".json",2],[".sql",2],[".css",1]]` |
| Language/runtime audit | defaults | stable | cycle 1: `keys:5; sha256:23699dab93e2; preview:{"frontend":"React/JavaScript","backend":"Node.js","heavyData":"SQL/DuckDB before new general-pu...`<br>cycle 2: `keys:5; sha256:23699dab93e2; preview:{"frontend":"React/JavaScript","backend":"Node.js","heavyData":"SQL/DuckDB before new general-pu...`<br>cycle 3: `keys:5; sha256:23699dab93e2; preview:{"frontend":"React/JavaScript","backend":"Node.js","heavyData":"SQL/DuckDB before new general-pu...` |
| Language/runtime audit | packagingGate | stable | cycle 1: `No backend language/runtime conversion without release packaging and rollback proof.`<br>cycle 2: `No backend language/runtime conversion without release packaging and rollback proof.`<br>cycle 3: `No backend language/runtime conversion without release packaging and rollback proof.` |
| Language/runtime audit | runtimePolicy | stable | cycle 1: `items:5; sha256:fc7bab5f41f4; preview:[{"runtime":"TypeScript","decision":"target pure helpers first","evidenceRequired":"typecheck, f...`<br>cycle 2: `items:5; sha256:fc7bab5f41f4; preview:[{"runtime":"TypeScript","decision":"target pure helpers first","evidenceRequired":"typecheck, f...`<br>cycle 3: `items:5; sha256:fc7bab5f41f4; preview:[{"runtime":"TypeScript","decision":"target pure helpers first","evidenceRequired":"typecheck, f...` |
| Language/runtime audit | rejectedRuntimeFamilies | stable | cycle 1: `items:4; sha256:355071f9d529; preview:[{"runtime":"Rust","reason":"No benchmark-backed hot path currently requires native compilation....`<br>cycle 2: `items:4; sha256:355071f9d529; preview:[{"runtime":"Rust","reason":"No benchmark-backed hot path currently requires native compilation....`<br>cycle 3: `items:4; sha256:355071f9d529; preview:[{"runtime":"Rust","reason":"No benchmark-backed hot path currently requires native compilation....` |
| Language/runtime audit | verificationMatrix | stable | cycle 1: `items:3; sha256:4dd7bc43d21d; preview:[{"track":"TypeScript utility conversion","requiredProof":["npm.cmd --prefix frontend run typech...`<br>cycle 2: `items:3; sha256:4dd7bc43d21d; preview:[{"track":"TypeScript utility conversion","requiredProof":["npm.cmd --prefix frontend run typech...`<br>cycle 3: `items:3; sha256:4dd7bc43d21d; preview:[{"track":"TypeScript utility conversion","requiredProof":["npm.cmd --prefix frontend run typech...` |
| Language/runtime audit | firstExecutableSlices | stable | cycle 1: `items:3; sha256:de057ce60935; preview:[{"track":"TypeScript utility conversion","firstCandidate":"","score":0,"lines":0,"requiredProof...`<br>cycle 2: `items:3; sha256:de057ce60935; preview:[{"track":"TypeScript utility conversion","firstCandidate":"","score":0,"lines":0,"requiredProof...`<br>cycle 3: `items:3; sha256:de057ce60935; preview:[{"track":"TypeScript utility conversion","firstCandidate":"","score":0,"lines":0,"requiredProof...` |
| Language/runtime audit | proofCommandCoverage | stable | cycle 1: `items:12; sha256:ec75b5e6c9df; preview:[{"track":"TypeScript utility conversion","proof":"npm.cmd --prefix frontend run typecheck","typ...`<br>cycle 2: `items:12; sha256:ec75b5e6c9df; preview:[{"track":"TypeScript utility conversion","proof":"npm.cmd --prefix frontend run typecheck","typ...`<br>cycle 3: `items:12; sha256:ec75b5e6c9df; preview:[{"track":"TypeScript utility conversion","proof":"npm.cmd --prefix frontend run typecheck","typ...` |
| Language/runtime audit | missingProofCommands | stable | cycle 1: `[]`<br>cycle 2: `[]`<br>cycle 3: `[]` |
| Language/runtime audit | focusedTestCoverage | stable | cycle 1: `items:5; sha256:0cf0bbaf4c23; preview:[{"track":"Completed TypeScript utility conversion","candidate":"frontend/src/utils/csvImport.ts...`<br>cycle 2: `items:5; sha256:0cf0bbaf4c23; preview:[{"track":"Completed TypeScript utility conversion","candidate":"frontend/src/utils/csvImport.ts...`<br>cycle 3: `items:5; sha256:0cf0bbaf4c23; preview:[{"track":"Completed TypeScript utility conversion","candidate":"frontend/src/utils/csvImport.ts...` |
| Language/runtime audit | focusedTestCoverageGaps | stable | cycle 1: `[]`<br>cycle 2: `[]`<br>cycle 3: `[]` |
| Language/runtime audit | convertedTypeScriptSlices | stable | cycle 1: `items:50; sha256:bc22816060c0; preview:[{"implementation":"frontend/src/app/appShellUtils.ts","compatibilityWrapper":"","wrapperStatus"...`<br>cycle 2: `items:50; sha256:bc22816060c0; preview:[{"implementation":"frontend/src/app/appShellUtils.ts","compatibilityWrapper":"","wrapperStatus"...`<br>cycle 3: `items:50; sha256:bc22816060c0; preview:[{"implementation":"frontend/src/app/appShellUtils.ts","compatibilityWrapper":"","wrapperStatus"...` |
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
| Runtime dependency guardrail | runtimeVersionGuardCoverage | stable | cycle 1: `keys:8; sha256:4f9815155f26; preview:{"viteBuildManifest":true,"viteDefinesFrontendBuild":true,"serviceWorkerBuildHash":true,"fronten...`<br>cycle 2: `keys:8; sha256:4f9815155f26; preview:{"viteBuildManifest":true,"viteDefinesFrontendBuild":true,"serviceWorkerBuildHash":true,"fronten...`<br>cycle 3: `keys:8; sha256:4f9815155f26; preview:{"viteBuildManifest":true,"viteDefinesFrontendBuild":true,"serviceWorkerBuildHash":true,"fronten...` |
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
