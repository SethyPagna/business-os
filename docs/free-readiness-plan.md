# Free-plan recovery and read-efficiency plan

Updated 30 October 2026. Work one verified slice at a time; design stays last.

## Current incident

The owner reported failed Dashboard, Products and organization discovery after the Paid subscription expired and the Free D1 daily read allowance was exhausted. The owner upgraded to Paid. Production's runtime identity and organization bootstrap subsequently returned HTTP 200 on the same RC3 source, `a9ba6f20a3cc`; this recovery was not a code deployment. Paid is temporary operating headroom, not completion of Free readiness.

Cloudflare counts rows scanned, not only returned rows or HTTP requests. Free includes 5 million reads per day, resetting at 00:00 UTC. The live six-hour query ranking showed approximately 1.11 million category-option reads across 93 executions and 641 thousand brand-option reads across 55. Those SQL fingerprints can have several callers; they do not attribute every execution to one page. The separate 24-hour and subscription-period counters must not be added or treated as the same window.

## Ordered implementation

1. **Urgent image-only Products fix.** Cache only brand/category option results for an identical authorized structural cohort, independently of search text, pagination and sort. Keep product, stock, settings and promotion version dependencies, received-date boundaries and permission projections. Cache failure must fall back to one ordinary read; failed database reads must never become cached success. Remove the duplicate in-page Products title and explanatory paragraph explicitly identified by the owner. Verify the exact candidate and deploy under the owner's emergency authorization, without unrelated migrations or design changes.
2. **Inventory Check default reads.** The 24-hour fingerprints showing approximately 9.7M reads/12 executions and 4.37M/6 match `cloudflare/src/lib/inventoryCheckProducts.ts`. Its default all-time, name-sorted count/page/summary share full-cohort financial ledger work. Measure the three statements, then count/rank the lightweight cohort and hydrate page metrics for returned IDs where parity is proved. Preserve the authoritative full summary and financial-sort fallback. A remaining full-summary scan can still exceed a daily budget; this slice needs measured cold and warm costs before a readiness claim.
3. **Cache authority and remaining option scans.** Measure Products/POS/Inventory/Branches and lookup callers individually. Cache products-derived used lookup values while reading managed lookup rows fresh: lookup create/copy does not always bump the products version. Preserve rename, color, source tags and removal behavior. Review legacy readers that still map unavailable version authority to a zero token; the urgent fix enables strict authority only for its new cache. Narrow invalidation dependencies only after proving what each result reads. Do not cache arbitrary user filter combinations in Workers KV.
4. **Incremental reads.** Extend the existing actor-scoped product search index, which already stores pages/hashes and revalidates changed pages; repeated page-zero requests alone do not prove full database rereads. Use durable versions and change signals to skip unchanged work. Add bounded change cursors only where deletions, imports, merge/undo, restore, account/role changes and missed push events have an explicit invalidation or resynchronization path. Paginate large changes and retain a verified full resync fallback. Cookies may remember preferences; they are not authority for prices, stock, permissions or financial state.
5. **Prepared database reads.** Measure query plans and rows scanned for default searches, catalog diagnostics, Dashboard and Sales. Prefer targeted indexes and maintained projections where they materially reduce reads. New projections require atomic writers, backfill/rebuild, parity checks and rollback before adoption; never infer their correctness from a cache hit. Keep existing financial definitions, audits, idempotency and stock ledgers authoritative.
6. **Compose the preserved takeover fixes.** The separate local takeover through 6.0.1032 remains preserved and undeployed. Integrate only independently verified slices, respecting payment/return dependencies and held migrations. Do not ship that whole tree as an emergency shortcut.
7. **Prove Free operation.** Check physical D1 calls, daily scanned rows, CPU, memory, result size, storage, KV reads/writes, concurrency and cache-miss costs. Measure actual default workflows and cold starts as well as warm repeated reads. Test Free and Paid separately, including quota refusal and account switching. Retain encrypted external backup/recovery and physical-device acceptance requirements.
8. **Design last.** Preserve the preferred POS and main Dashboard layout. Other visible changes still require page-specific prototype review before implementation.

## Cache acceptance rules

- Authorize each request before cache access; isolate different permission grants and structural cohorts.
- Cache read-only derived data. Financial and stock mutations validate current server state and retain conflict, audit and idempotency guards.
- Keys include every dependency and a generation tag; writes, imports, undo, maintenance and restore invalidate affected generations.
- Keep existing bounded freshness; account for time-based promotion and date transitions. Never present stale values as verified current results.
- The urgent facet cache has a five-minute maximum TTL and inherits KV version propagation lag. It caches option strings only. If fallback version authority cannot be read, it bypasses the cache rather than reusing a zero-generation entry; product rows continue through their normal read path.
- Cache outages, malformed entries and eviction must remain safe; errors cannot poison the cache or trigger duplicate database work.
- Record old-source failure, candidate success, exact response parity, cache-hit query savings and invalidation tests. A local cache result does not prove global daily quota readiness.

## Release evidence

Record implementation, focused tests, package gates, independent review, exact deployed source/Worker identity and postflight separately in `progress.md`. The owner's urgent deployment authorization is already given. Protected production approval and repository release gates still apply. Never mark a deploy complete until the live result is verified.

Sources: [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).
