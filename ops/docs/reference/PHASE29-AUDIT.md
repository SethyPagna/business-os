# Phase 29 Audit

Generated: 2026-06-07T00:03:46.072Z

Policy: `ops/automation/business-os-automation.json`

## Summary

- Checks: 9
- Failures: 0
- Cycles: 1
- Total child-check duration: 3172 ms
- Repeat consistency: stable
- Execution mode: contention-safe-reference-writers-then-bounded-guardrails
- Reference writer concurrency: 1
- Parallel child-check concurrency: 2
- Mode: non-mutating audit. This command measures and verifies; it does not delete files, move folders, run migrations, or prune remote storage.

## Checks

| Cycle | Check | Status | Duration | Command | Report output |
| --- | --- | --- | --- | --- | --- |
| 1 | Generated bulk audit | passed | 1096 ms | `node.exe ops/scripts/architecture/generated-bulk-audit.ts --policy ops/automation/business-os-automation.json` | `ops/docs/reference/GENERATED-BULK-AUDIT.md`<br>`ops/docs/reference/GENERATED-BULK-AUDIT.json` |
| 1 | Schema audit | passed | 154 ms | `node.exe ops/scripts/backend/schema-audit.ts` | `ops/docs/reference/SCHEMA-AUDIT.md`<br>`ops/docs/reference/SCHEMA-AUDIT.json` |
| 1 | Performance/code-flow scan | passed | 252 ms | `node.exe ops/scripts/docs/performance-scan.ts` | `ops/docs/reference/PERFORMANCE-SCAN.md`<br>`ops/docs/reference/PERFORMANCE-SCAN.json` |
| 1 | Language/runtime audit | passed | 333 ms | `node.exe ops/scripts/architecture/language-runtime-audit.ts` | `ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.md`<br>`ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.json` |
| 1 | Runtime JavaScript inventory | passed | 157 ms | `node.exe ops/scripts/architecture/runtime-js-inventory.ts` | `ops/docs/reference/RUNTIME-JS-INVENTORY.md`<br>`ops/docs/reference/RUNTIME-JS-INVENTORY.json` |
| 1 | Docker release guardrail | passed | 143 ms | `node.exe ops/scripts/verification/verify-docker-release.ts` | `ops/docs/reference/DOCKER-RELEASE-GUARDRAIL.json` |
| 1 | Runtime dependency guardrail | passed | 145 ms | `node.exe ops/scripts/verification/verify-runtime-deps.ts` | `ops/docs/reference/RUNTIME-DEPS-GUARDRAIL.json` |
| 1 | PM2 ecosystem config guardrail | passed | 442 ms | `node.exe ops/scripts/runtime/build-ecosystem-config.ts --check` | none |
| 1 | Organization audit | passed | 450 ms | `node.exe ops/scripts/architecture/organization-audit.ts` | `ops/docs/reference/ORGANIZATION-AUDIT.md`<br>`ops/docs/reference/ORGANIZATION-AUDIT.json` |

## Duration Summary

| Check | Runs | Total | Average | Max |
| --- | --- | --- | --- | --- |
| Generated bulk audit | 1 | 1096 ms | 1096 ms | 1096 ms |
| Organization audit | 1 | 450 ms | 450 ms | 450 ms |
| PM2 ecosystem config guardrail | 1 | 442 ms | 442 ms | 442 ms |
| Language/runtime audit | 1 | 333 ms | 333 ms | 333 ms |
| Performance/code-flow scan | 1 | 252 ms | 252 ms | 252 ms |
| Runtime JavaScript inventory | 1 | 157 ms | 157 ms | 157 ms |
| Schema audit | 1 | 154 ms | 154 ms | 154 ms |
| Runtime dependency guardrail | 1 | 145 ms | 145 ms | 145 ms |
| Docker release guardrail | 1 | 143 ms | 143 ms | 143 ms |

## Slowest Runs

| Cycle | Check | Duration |
| --- | --- | --- |
| 1 | Generated bulk audit | 1096 ms |
| 1 | Organization audit | 450 ms |
| 1 | PM2 ecosystem config guardrail | 442 ms |
| 1 | Language/runtime audit | 333 ms |
| 1 | Performance/code-flow scan | 252 ms |

## Repeat Consistency

Repeat consistency checks are skipped for single-cycle runs.

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
