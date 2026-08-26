-- Single-writer lease for import jobs.
--
-- Cloudflare Queues is AT-LEAST-ONCE: the same message can be delivered more
-- than once, and a retry can overlap the invocation it is retrying. Nothing
-- prevented two invocations of the SAME job from running a chunk together.
--
-- The consequence was not a slow import, it was wrong data. Both invocations
-- read the same chunk_cursor, classified the same ~150 rows, both saw "no
-- existing product matches" for every create, and both INSERTed -- producing
-- duplicate products that no later pass would reconcile, because each one
-- looks like a legitimately distinct row. On the sales path the same overlap
-- writes a receipt twice.
--
-- It was always possible; running two imports at once makes it likely, since
-- queue pressure is what provokes redelivery in the first place.
--
-- A lease rather than a status flag: a status can be left set forever by an
-- invocation that died mid-chunk (CPU limit, isolate eviction), wedging the
-- job with no way back. An expiring lease self-heals -- the worst case is
-- that the job waits out the remaining lease and then continues.
ALTER TABLE import_jobs ADD COLUMN lease_token TEXT;

-- ISO-8601 UTC. Compared as text, which sorts correctly for this format and
-- avoids depending on any particular date function being available.
ALTER TABLE import_jobs ADD COLUMN lease_expires_at TEXT;
