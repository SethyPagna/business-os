-- Migration files production D1 has recorded as applied, in order. The list
-- mirrors cloudflare/migrations/ in this public repository, so its row count
-- is not a business figure and may be shown in the public log.
-- ops:min-rows 1
-- ops:public-row-count
SELECT name FROM d1_migrations ORDER BY id
