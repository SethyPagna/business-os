# Returns statement export implementation contract

Base: 46b9cf137e911478fa9d7c2d6d27c1e18f57693a. Branch: codex/returns-statement-export-20260920. Assigned owner: date-controls-fix. No production/migration authority.

Custom start/end dates are primary; optional existing presets are convenience, not mandatory calendar blocks. Server requires a positive canonical half-open interval in Asia/Phnom_Penh no longer than one calendar year from local start. Proposed precise anniversary rule clamps Feb29 to Feb28 in the following year; full-day end includes its whole day, timed end includes its whole selected minute. Validate canonical SQL bounds, not cosmetic dates alone.

Additive /api/returns/export preserves legacy / list and /report contracts. Enforce view/export/cost authority each page. Reuse search/type/scope/range predicate. Sequential pages <=500 with frozen filters, high-water ID, timestamp/id cursor, deterministic ordering and full matching count. No arbitrary total-row cap. Preserve cancellation list inclusion and contextual summaries unchanged.

Frontend full-cohort export fetches all pages instead of the loaded 500/1000 rows. Page/selected export remains explicitly page-scoped. Capture actor scope before awaiting and assert every page plus immediately before output; abort on revocation/account/session/runtime change, invalidation, duplicate or stalled cursor, inconsistent final count, failed request, cancellation/unmount/replaced job. No output success until all pages succeed.

Concurrency requirement from lead follow-up: do NOT wire an endpoint that can silently mix versions. Investigate existing authoritative revisions; if coverage is incomplete, retain useful helper work and stop endpoint wiring. Array-based formatter is not constant-memory merely because range <=1 year; report that limitation explicitly.

Owned source/test paths are recorded in team-state. No shared or i18n expansion without parent approval. Verification: >1000 actual-handler rows, calendar/leap/invalid/over-year tests, customer/supplier/cancel/search parity, frontend executed pagination/actor/failure tests, affected typechecks and focused siblings. Independent review by parent after commit.

## Local candidate result / wiring stop

Implemented three unused, testable helpers: backend `returnExportWindow.ts`, frontend `returnsExportWindow.ts`, and `returnsStatementTransport.ts`. The separate transport module avoids changing the existing legacy reader/import graph before backend coverage is certified. No Returns.tsx or route edits; no new endpoint, no UI claim of complete export, no migrations.

Actual migration trigger evidence in `test-returns-statement-export-native.cjs`:

- 0125 return_write_revisions increments for header cancellation and return-item changes; retained delete revisions are usable. SUM of ALL retained revisions (not MAX) could conservatively fence those tables, but scanning the whole revision table for every export page has a Free-tier cost.
- 0124 stock_session_revisions has `(product_catalog,all)` updated synchronously on EVERY product insert/update/delete. This covers joined product-search changes without a migration.
- 0120 sale_write_revisions covers sales changes such as replacement receipt text, if the export response keeps that otherwise unused joined field.
- Customer `is_anonymous` affects exportReturnRows via customerDisplayName. Migration0141 adds only a CHECK-constrained marker, not a customer revision trigger. Native UPDATE of that marker changes live projection while ALL return/product/sale revisions remain byte-identical. This is a schema coverage counterexample, not a claim that ordinary contact edit UI permits changing the marker.
- Restore mode explicitly skips all three trigger families. The native test changes return status/product SKU under maintenance with unchanged revision maps. Maintenance start/end flags are transient; checking only current absence is not an epoch across two requests. `backups.ts` audits restore after it runs, not a synchronous guard attached to every restored row.
- `cache.ts` uses asynchronous cache-version bumps with best-effort D1 fallback. `audit.ts` supports retention deletion and ordinary audits are not universal transactional revision triggers. Neither is a proven authoritative replacement.

Smallest stronger follow-up proposal for root review: transactionally maintained export dependency generation for customers (or specifically anonymous identity changes), plus a durable restore/data epoch not overwritten by restore. Reuse existing product_catalog guard; add an aggregate Returns generation if avoiding full-table SUM scans is required. Check generation + projected rows in the same DB transaction/snapshot for every page, and revalidate before finalization. Ensure customer insert/delete as well as marker updates are covered; restores advance the epoch BEFORE mutation and exports fail closed while maintenance is active. This proposal requires separately approved schema/writer ownership, not silently added here. An immutable materialized statement is the larger alternative.

Transport contract requires an authoritative snapshotToken on every page and a final verification callback; no default HTTP endpoint is supplied. Actual tests traverse 21,001 rows in 43 sequential requests; detect changed token/count, duplicate IDs, cursor loops, network failure, abort, per-entity invalidation, account change and same-user permission change. It returns no rows until successful completion and exposes assertCurrent for the final delayed-file boundary; it does not itself format/download a file. Full browser formatter/download fencing, memory-bounded output and actual paginated handler certification remain OPEN.

Backend/frontend parity tests cover leap/nonleap years, clamped Feb29 anniversary, custom same-minute windows, ISO offset/UTC conversion, malformed/unpaired/reversed/over-year/conflicting bounds, and adjacent statement boundaries using native SQLite. The new test is native Node SQLite, NOT workerd and NOT an actual newly wired endpoint. Existing actual Returns GET/report tests still pass unchanged.
