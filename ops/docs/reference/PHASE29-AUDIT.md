# Phase 29 Audit

Generated: 2026-06-07T09:11:26.118Z

Policy: `ops/automation/business-os-automation.json`

## Summary

- Checks: 9
- Failures: 0
- Cycles: 1
- Total child-check duration: 2518 ms
- Repeat consistency: stable
- Execution mode: contention-safe-reference-writers-then-bounded-guardrails
- Reference writer concurrency: 1
- Parallel child-check concurrency: 2
- Mode: non-mutating audit. This command measures and verifies; it does not delete files, move folders, run migrations, or prune remote storage.

## Checks

| Cycle | Check | Status | Duration | Command | Report output |
| --- | --- | --- | --- | --- | --- |
| 1 | Generated bulk audit | passed | 948 ms | `node.exe ops/scripts/architecture/generated-bulk-audit.ts --policy ops/automation/business-os-automation.json` | `ops/docs/reference/GENERATED-BULK-AUDIT.md`<br>`ops/docs/reference/GENERATED-BULK-AUDIT.json` |
| 1 | Schema audit | passed | 143 ms | `node.exe ops/scripts/backend/schema-audit.ts` | `ops/docs/reference/SCHEMA-AUDIT.md`<br>`ops/docs/reference/SCHEMA-AUDIT.json` |
| 1 | Performance/code-flow scan | passed | 185 ms | `node.exe ops/scripts/docs/performance-scan.ts` | `ops/docs/reference/PERFORMANCE-SCAN.md`<br>`ops/docs/reference/PERFORMANCE-SCAN.json` |
| 1 | Language/runtime audit | passed | 242 ms | `node.exe ops/scripts/architecture/language-runtime-audit.ts` | `ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.md`<br>`ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.json` |
| 1 | Runtime JavaScript inventory | passed | 143 ms | `node.exe ops/scripts/architecture/runtime-js-inventory.ts` | `ops/docs/reference/RUNTIME-JS-INVENTORY.md`<br>`ops/docs/reference/RUNTIME-JS-INVENTORY.json` |
| 1 | Docker release guardrail | passed | 123 ms | `node.exe ops/scripts/verification/verify-docker-release.ts` | `ops/docs/reference/DOCKER-RELEASE-GUARDRAIL.json` |
| 1 | Runtime dependency guardrail | passed | 126 ms | `node.exe ops/scripts/verification/verify-runtime-deps.ts` | `ops/docs/reference/RUNTIME-DEPS-GUARDRAIL.json` |
| 1 | PM2 ecosystem config guardrail | passed | 311 ms | `node.exe ops/scripts/runtime/build-ecosystem-config.ts --check` | none |
| 1 | Organization audit | passed | 297 ms | `node.exe ops/scripts/architecture/organization-audit.ts` | `ops/docs/reference/ORGANIZATION-AUDIT.md`<br>`ops/docs/reference/ORGANIZATION-AUDIT.json` |

## Duration Summary

| Check | Runs | Total | Average | Max |
| --- | --- | --- | --- | --- |
| Generated bulk audit | 1 | 948 ms | 948 ms | 948 ms |
| PM2 ecosystem config guardrail | 1 | 311 ms | 311 ms | 311 ms |
| Organization audit | 1 | 297 ms | 297 ms | 297 ms |
| Language/runtime audit | 1 | 242 ms | 242 ms | 242 ms |
| Performance/code-flow scan | 1 | 185 ms | 185 ms | 185 ms |
| Runtime JavaScript inventory | 1 | 143 ms | 143 ms | 143 ms |
| Schema audit | 1 | 143 ms | 143 ms | 143 ms |
| Runtime dependency guardrail | 1 | 126 ms | 126 ms | 126 ms |
| Docker release guardrail | 1 | 123 ms | 123 ms | 123 ms |

## Slowest Runs

| Cycle | Check | Duration |
| --- | --- | --- |
| 1 | Generated bulk audit | 948 ms |
| 1 | PM2 ecosystem config guardrail | 311 ms |
| 1 | Organization audit | 297 ms |
| 1 | Language/runtime audit | 242 ms |
| 1 | Performance/code-flow scan | 185 ms |

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
