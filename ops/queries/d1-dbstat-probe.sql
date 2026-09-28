-- d1-dbstat-probe: bytes and pages per table and per index, from SQLite's
-- dbstat virtual table. PROBE FIRST: Cloudflare's D1 docs do not say whether
-- dbstat is compiled in. If D1 refuses it the task fails with an error and
-- nothing is read; fall back to d1-table-rows plus the database size the task
-- already records in the encrypted meta (size_after). PRAGMA page_count and
-- freelist_count are refused by ops-sql-guard, so the free-page share is
-- estimated as size_after minus the sum below.
-- Names only (schema is in the public repo), no row data.
-- ops:min-rows 1
SELECT
  d.name AS object,
  COALESCE(m.type, 'internal') AS kind,
  COALESCE(m.tbl_name, d.name) AS owner_table,
  COUNT(*) AS pages,
  SUM(d.pgsize) AS bytes,
  SUM(d.unused) AS unused_bytes,
  SUM(CASE WHEN d.pagetype = 'leaf' THEN d.ncell ELSE 0 END) AS leaf_cells
FROM dbstat d
LEFT JOIN sqlite_master m ON m.name = d.name
GROUP BY d.name
ORDER BY bytes DESC;
