-- Free-tier quota accounting, plus a D1-backed fallback for cache versions.
--
-- Two tables, one problem: KV's free ceiling of 1,000 writes/day is the
-- tightest limit this app runs against, and it is spent almost entirely by
-- bumpVersion() -- a KV write fired on every product, sale, inventory and
-- branch mutation, from 31 call sites. A moderately busy shop exhausts it
-- well before closing time.
--
-- What made that dangerous rather than merely annoying: when KV writes start
-- failing, bumpVersion fails SILENTLY. The cached version stops advancing,
-- cachedJsonResponse keeps serving the old payload, and the shop is shown
-- stale stock and prices with nothing on screen indicating it. A quota
-- ceiling turned into a correctness bug.
--
-- KV also caps writes at ONE PER SECOND PER KEY, and every product mutation
-- writes the same key (`version:products`), so concurrent sales contend on a
-- single hot key long before the daily budget runs out.

-- Usage counters. One row per resource per window (day or month).
CREATE TABLE IF NOT EXISTS quota_usage (
  resource   TEXT NOT NULL,
  -- 'YYYY-MM-DD' for daily resources, 'YYYY-MM' for monthly ones. Old rows
  -- are harmless: they simply stop being read once the window rolls over.
  window_key TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (resource, window_key)
);

-- D1-backed cache versions -- the fallback bumpVersion uses once the KV write
-- budget enters its critical zone.
--
-- D1 is the right home for this: 100,000 writes/day rather than 1,000, no
-- per-key write ceiling, and strong consistency, which cache invalidation
-- actually wants. KV is eventually consistent, so a version bump could take
-- seconds to propagate to the edge that serves the next read -- tolerable as
-- a cache hint, but never ideal for "this data just changed".
--
-- Reads still prefer KV (sub-millisecond, and 100,000 reads/day is generous);
-- this is only consulted when the KV value is missing or stale relative to
-- what D1 records.
CREATE TABLE IF NOT EXISTS cache_versions (
  namespace  TEXT PRIMARY KEY,
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
