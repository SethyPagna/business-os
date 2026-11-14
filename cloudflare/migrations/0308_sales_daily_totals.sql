-- 0308: stored daily sales totals (slice 1 of the stored-totals design, lane/sales-daily-totals).
--
-- One DERIVED row per Cambodia business date holds the report kernel's own running totals for that day (exact fractions, written by the
-- sales-daily-recompute cron step, never by a request). The table is a cache of what the sales tables already say: nothing existing is
-- changed, no sale, money or stock value is read for update, and a reader uses a stored day only while state = 0 AND the read switch
-- 'sales_daily' is on. The switch is OFF by default, so installing this changes nothing a user can see.
--
-- state: 0 clean, 1 dirty, 2 being recomputed. claim_gen / kernel_version / data_epoch / refusal / payload are written by the recompute only.
-- business_date '' holds sales whose created_at is NULL or unreadable (every dated window excludes them, all-time includes them).
--
-- Four triggers only MARK a day dirty (they never compute). Two hang off sale_write_revisions (migration 0120), which already fires for every
-- insert, update and delete of sales, sale_items, line allocations, returns, return items, return allocations, amendments and fees, so every
-- writer is covered whatever its source (route, import, undo, ops script, migration). Two more cover what a revision row cannot name: a
-- deleted sale (its row is gone when the revision trigger looks the date up) and a sale whose created_at moved (the OLD day). All four skip
-- restore mode exactly as 0120 does (a restore rotates the data epoch, which invalidates every stored day). They write only on a state change:
-- the second and later writes of a dirty day add no row. A trigger never raises: COALESCE, a constant state, no NOT NULL risk.
--
-- The table keeps its rowid (no WITHOUT ROWID): backups and the d1 table census rely on it. LF-only. Derived data: not in backups.
--
-- PRE:  sales_daily_totals does not exist (CREATE TABLE aborts otherwise).
-- POST: every day that has a sale has a row; the four triggers and two indexes exist; the coverage row exists. Asserted at the end.
-- RECOVERY: DROP the four triggers, then the table and both indexes, then DELETE the 'sales_daily_coverage' and 'sales_daily_quarantine'
--       flags. Nothing else depends on them while the read switch is off.
CREATE TABLE sales_daily_totals (
  id INTEGER PRIMARY KEY,
  business_date TEXT NOT NULL UNIQUE,
  state INTEGER NOT NULL DEFAULT 1 CHECK (state IN (0, 1, 2)),
  claim_gen INTEGER NOT NULL DEFAULT 0,
  kernel_version INTEGER NOT NULL DEFAULT 0,
  data_epoch TEXT NOT NULL DEFAULT '',
  refusal TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  source_rows INTEGER NOT NULL DEFAULT 0,
  computed_at TEXT
);

CREATE INDEX idx_sales_daily_totals_pending ON sales_daily_totals(business_date) WHERE state <> 0;

CREATE INDEX idx_customers_anonymous ON customers(id) WHERE COALESCE(is_anonymous, 0) <> 0;

CREATE TRIGGER sales_daily_mark_revision_insert AFTER INSERT ON sale_write_revisions
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sales_daily_totals(business_date, state)
 SELECT COALESCE(date(created_at, '+7 hours'), ''), 1 FROM sales WHERE id = NEW.sale_id
 ON CONFLICT(business_date) DO UPDATE SET state = 1 WHERE state <> 1;
END;

CREATE TRIGGER sales_daily_mark_revision_update AFTER UPDATE ON sale_write_revisions
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sales_daily_totals(business_date, state)
 SELECT COALESCE(date(created_at, '+7 hours'), ''), 1 FROM sales WHERE id = NEW.sale_id
 ON CONFLICT(business_date) DO UPDATE SET state = 1 WHERE state <> 1;
END;

CREATE TRIGGER sales_daily_mark_sale_delete AFTER DELETE ON sales
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sales_daily_totals(business_date, state)
 SELECT COALESCE(date(OLD.created_at, '+7 hours'), ''), 1 WHERE 1
 ON CONFLICT(business_date) DO UPDATE SET state = 1 WHERE state <> 1;
END;

CREATE TRIGGER sales_daily_mark_sale_moved AFTER UPDATE OF created_at ON sales
WHEN OLD.created_at IS NOT NEW.created_at AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sales_daily_totals(business_date, state)
 SELECT COALESCE(date(OLD.created_at, '+7 hours'), ''), 1 WHERE 1
 ON CONFLICT(business_date) DO UPDATE SET state = 1 WHERE state <> 1;
END;

INSERT INTO sales_daily_totals(business_date, state)
SELECT DISTINCT COALESCE(date(created_at, '+7 hours'), ''), 1 FROM sales WHERE 1
ON CONFLICT(business_date) DO NOTHING;

INSERT INTO system_flags (key, value, updated_at)
VALUES ('sales_daily_coverage', json_object('epoch', (SELECT value FROM system_flags WHERE key = 'data_epoch')), CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;

SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sales s WHERE NOT EXISTS (SELECT 1 FROM sales_daily_totals t WHERE t.business_date = COALESCE(date(s.created_at, '+7 hours'), '')))
  AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name IN ('sales_daily_mark_revision_insert', 'sales_daily_mark_revision_update', 'sales_daily_mark_sale_delete', 'sales_daily_mark_sale_moved')) = 4
  AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN ('idx_sales_daily_totals_pending', 'idx_customers_anonymous')) = 2
  AND (SELECT COUNT(*) FROM system_flags WHERE key = 'sales_daily_coverage') = 1
THEN 1 ELSE json_extract('[]','$[sales_daily_totals_0308_post]') END;
