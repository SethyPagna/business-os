-- Migration files production D1 has recorded as applied, in order. Like every
-- query here, its row count stays in the encrypted file: the public log shows
-- no table's size.
-- ops:min-rows 1
SELECT name FROM d1_migrations ORDER BY id
