-- Transaction-local assertions for grouped stock-import writes.
--
-- D1 batch() rolls the whole transaction back when a statement raises, but
-- an UPDATE that affects zero rows is still a successful statement.  The
-- CHECK below turns live stock/batch preconditions into real SQLite errors,
-- so a concurrent sale can never make an import silently clamp or oversell.
CREATE TABLE IF NOT EXISTS import_stock_action_guards (
  job_id TEXT NOT NULL,
  action_key TEXT NOT NULL,
  guard_key TEXT NOT NULL,
  guard_value INTEGER NOT NULL CHECK (guard_value = 1),
  PRIMARY KEY (job_id, action_key, guard_key)
);

