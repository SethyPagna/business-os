# Phase 29 Audit

Generated: 2026-05-30T11:07:15.398Z

Policy: `ops/automation/business-os-automation.json`

## Summary

- Checks: 7
- Failures: 0
- Cycles: 1
- Total child-check duration: 2283 ms
- Repeat consistency: stable
- Execution mode: contention-safe-reference-writers-then-bounded-guardrails
- Reference writer concurrency: 1
- Parallel child-check concurrency: 2
- Mode: non-mutating audit. This command measures and verifies; it does not delete files, move folders, run migrations, or prune remote storage.

## Checks

| Cycle | Check | Status | Duration | Command | Report output |
| --- | --- | --- | --- | --- | --- |
| 1 | Generated bulk audit | passed | 1115 ms | `node.exe ops/scripts/architecture/generated-bulk-audit.ts --policy ops/automation/business-os-automation.json` | `ops/docs/reference/GENERATED-BULK-AUDIT.md`<br>`ops/docs/reference/GENERATED-BULK-AUDIT.json` |
| 1 | Schema audit | passed | 184 ms | `node.exe ops/scripts/backend/schema-audit.ts` | `ops/docs/reference/SCHEMA-AUDIT.md`<br>`ops/docs/reference/SCHEMA-AUDIT.json` |
| 1 | Performance/code-flow scan | passed | 188 ms | `node.exe ops/scripts/docs/performance-scan.ts` | `ops/docs/reference/PERFORMANCE-SCAN.md`<br>`ops/docs/reference/PERFORMANCE-SCAN.json` |
| 1 | Language/runtime audit | passed | 232 ms | `node.exe ops/scripts/architecture/language-runtime-audit.ts` | `ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.md`<br>`ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.json` |
| 1 | Docker release guardrail | passed | 141 ms | `node.exe ops/scripts/verification/verify-docker-release.ts` | `ops/docs/reference/DOCKER-RELEASE-GUARDRAIL.json` |
| 1 | Runtime dependency guardrail | passed | 131 ms | `node.exe ops/scripts/verification/verify-runtime-deps.ts` | `ops/docs/reference/RUNTIME-DEPS-GUARDRAIL.json` |
| 1 | Organization audit | passed | 292 ms | `node.exe ops/scripts/architecture/organization-audit.ts` | `ops/docs/reference/ORGANIZATION-AUDIT.md`<br>`ops/docs/reference/ORGANIZATION-AUDIT.json` |

## Duration Summary

| Check | Runs | Total | Average | Max |
| --- | --- | --- | --- | --- |
| Generated bulk audit | 1 | 1115 ms | 1115 ms | 1115 ms |
| Organization audit | 1 | 292 ms | 292 ms | 292 ms |
| Language/runtime audit | 1 | 232 ms | 232 ms | 232 ms |
| Performance/code-flow scan | 1 | 188 ms | 188 ms | 188 ms |
| Schema audit | 1 | 184 ms | 184 ms | 184 ms |
| Docker release guardrail | 1 | 141 ms | 141 ms | 141 ms |
| Runtime dependency guardrail | 1 | 131 ms | 131 ms | 131 ms |

## Slowest Runs

| Cycle | Check | Duration |
| --- | --- | --- |
| 1 | Generated bulk audit | 1115 ms |
| 1 | Organization audit | 292 ms |
| 1 | Language/runtime audit | 232 ms |
| 1 | Performance/code-flow scan | 188 ms |
| 1 | Schema audit | 184 ms |

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
