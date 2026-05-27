# Rust Rewrite Assessment

Current plan position: Phase 8.4 active; Phase 26 at fifty-one completed
moves; Phase 28 active; Phase 29 active as of Move 332.

## Recommendation

Do not start a full deep Rust rewrite now.

Use Rust only as a measured, isolated acceleration layer after a benchmark proves
that Node.js, SQL/DuckDB, Web Workers, and existing native packages cannot meet
the target.

The current system is already a mixed-runtime application:

- Frontend: React, JavaScript, TypeScript, Vite, Web Workers, Dexie.
- Backend: Node.js, Express, pg-native/libpq, BullMQ, Redis, R2/S3, DuckDB,
  sharp, WebSockets, packaged into a Linux executable for Docker.
- Ops: PowerShell, batch launchers, Docker release scripts, Cloudflare tunnel,
  runtime pruning, backup/restore, live Playwright checks.

A full Rust rewrite would replace much more than syntax. It would reimplement
the HTTP API, auth/session security, permission policy, import worker queue,
media pipeline, backup/restore format, R2 integration, Drive sync, WebSocket
events, schema bootstrap, tests, Docker release packaging, and live verification
tooling. That is high blast radius and does not currently have benchmark proof.

## Where Rust Could Be Good Later

Rust may be useful for narrow modules with all of these properties:

- CPU-bound rather than database/network-bound.
- Pure input/output contract with no React or Express lifecycle.
- Large enough data volume to beat JavaScript plus SQL/DuckDB/Web Worker paths.
- Easy rollback to the existing Node/TypeScript implementation.
- Docker packaging proof and Windows developer workflow proof.
- Before/after benchmark on the same fixture.

Good Rust spike candidates:

| Candidate | Why It Might Help | Required Proof |
| --- | --- | --- |
| CSV/import analyzer core | Large product/contact/inventory/sales imports can be CPU-heavy. | Same-row-count diff, decision diff, timing fixture, worker fallback retained. |
| Backup package checksum/manifest verification | Can be CPU and file-IO heavy. | Restore rehearsal, package diff, checksum diff, timing fixture. |
| Media metadata probe only | Some image/video metadata paths can be CPU-heavy. | Must not replace sharp unless quality and size contracts match. |
| Integrity/orphan scan report generation | Large reports may benefit from compiled scanners, though SQL is usually better. | Compare against Postgres/DuckDB query output and timing. |

## Where Rust Is Not A Good Fit Now

| Area | Keep Current Runtime | Reason |
| --- | --- | --- |
| React UI | React/TypeScript | Rust would not simplify the browser UI and would add WASM packaging. |
| HTTP routes | Node.js/Express | Existing auth, middleware, tests, and route contracts are already proven. |
| Database queries | SQL/Postgres/DuckDB | Query performance belongs in indexes, SQL shape, and DuckDB paths first. |
| R2/S3 and Drive sync | Node.js services | Current SDK integrations, retries, and backup format already exist. |
| Media transforms | sharp/native package | Rust rewrite would need to match sharp quality, formats, limits, and packaging. |
| Queue workers | BullMQ/Redis | Rust would require a new queue client contract and worker deployment model. |
| Ops launchers | PowerShell/batch | Windows operator convenience is part of the product requirement. |

## Full Rewrite Risk

A full Rust rewrite would introduce these risks:

- Data-loss risk during backup/restore and import/apply rewrites.
- Permission and auth regression risk.
- Public/admin API compatibility risk.
- Longer release cycle while two backends coexist.
- New Docker image and local Windows build complexity.
- Larger verification matrix: Node old path, Rust new path, migrations,
  packaging, Cloudflare tunnel, R2, Drive, Redis, Postgres, DuckDB, workers.
- Feature freeze pressure while parity is rebuilt.

## Safe Rust Spike Protocol

Before any Rust production path is accepted:

1. Pick one pure module.
2. Save an input/output fixture from the current implementation.
3. Build a Rust CLI or native addon prototype behind an opt-in flag.
4. Keep the existing Node/TypeScript path as the oracle and fallback.
5. Run correctness diff on every fixture.
6. Run before/after timing on the same machine.
7. Prove Docker release packaging and Windows developer execution.
8. Run backend/frontend utility tests as applicable.
9. Run Phase 29 repeat audit.
10. Run Docker release, health, Phase 8.4 live UI, public portal, and storage
    prune checks before enabling by default.

## Decision Gate

Rust is approved only if one of these is true:

- It gives at least a 2x speedup on a real hot path and does not increase
  operational complexity beyond the measured gain.
- It removes a stability problem that cannot be solved with SQL/DuckDB,
  Web Workers, Node streaming, queue shaping, or existing native packages.
- It materially reduces release image size or runtime memory after packaging
  proof, not just in a local microbenchmark.

Until then, the better strategy is:

- Continue TypeScript conversion for pure frontend helpers.
- Continue direct-loop and single-pass cleanup in hot UI/backend paths.
- Continue SQL/index/DuckDB rewires for data-heavy work.
- Continue Web Worker extraction for browser CPU/file parsing.
- Keep Node.js as the backend shell and Rust as a future opt-in accelerator.
