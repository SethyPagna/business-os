# Phase 29 Audit

Generated: 2026-05-30T07:31:32.691Z

Policy: `ops/automation/business-os-automation.json`

## Summary

- Checks: 7
- Failures: 0
- Cycles: 1
- Total child-check duration: 1648 ms
- Repeat consistency: stable
- Execution mode: contention-safe-reference-writers-then-bounded-guardrails
- Reference writer concurrency: 1
- Parallel child-check concurrency: 2
- Mode: non-mutating audit. This command measures and verifies; it does not delete files, move folders, run migrations, or prune remote storage.

## Checks

| Cycle | Check | Status | Duration | Command | Report output |
| --- | --- | --- | --- | --- | --- |
| 1 | Generated bulk audit | passed | 688 ms | `node.exe ops/scripts/architecture/generated-bulk-audit.ts --policy ops/automation/business-os-automation.json` | `ops/docs/reference/GENERATED-BULK-AUDIT.md`<br>`ops/docs/reference/GENERATED-BULK-AUDIT.json` |
| 1 | Schema audit | passed | 126 ms | `node.exe ops/scripts/backend/schema-audit.ts` | `ops/docs/reference/SCHEMA-AUDIT.md`<br>`ops/docs/reference/SCHEMA-AUDIT.json` |
| 1 | Performance/code-flow scan | passed | 145 ms | `node.exe ops/scripts/docs/performance-scan.ts` | `ops/docs/reference/PERFORMANCE-SCAN.md`<br>`ops/docs/reference/PERFORMANCE-SCAN.json` |
| 1 | Language/runtime audit | passed | 208 ms | `node.exe ops/scripts/architecture/language-runtime-audit.ts` | `ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.md`<br>`ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.json` |
| 1 | Docker release guardrail | passed | 117 ms | `node.exe ops/scripts/verification/verify-docker-release.ts` | `ops/docs/reference/DOCKER-RELEASE-GUARDRAIL.json` |
| 1 | Runtime dependency guardrail | passed | 112 ms | `node.exe ops/scripts/verification/verify-runtime-deps.ts` | `ops/docs/reference/RUNTIME-DEPS-GUARDRAIL.json` |
| 1 | Organization audit | passed | 252 ms | `node.exe ops/scripts/architecture/organization-audit.ts` | `ops/docs/reference/ORGANIZATION-AUDIT.md`<br>`ops/docs/reference/ORGANIZATION-AUDIT.json` |

## Duration Summary

| Check | Runs | Total | Average | Max |
| --- | --- | --- | --- | --- |
| Generated bulk audit | 1 | 688 ms | 688 ms | 688 ms |
| Organization audit | 1 | 252 ms | 252 ms | 252 ms |
| Language/runtime audit | 1 | 208 ms | 208 ms | 208 ms |
| Performance/code-flow scan | 1 | 145 ms | 145 ms | 145 ms |
| Schema audit | 1 | 126 ms | 126 ms | 126 ms |
| Docker release guardrail | 1 | 117 ms | 117 ms | 117 ms |
| Runtime dependency guardrail | 1 | 112 ms | 112 ms | 112 ms |

## Slowest Runs

| Cycle | Check | Duration |
| --- | --- | --- |
| 1 | Generated bulk audit | 688 ms |
| 1 | Organization audit | 252 ms |
| 1 | Language/runtime audit | 208 ms |
| 1 | Performance/code-flow scan | 145 ms |
| 1 | Schema audit | 126 ms |

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
