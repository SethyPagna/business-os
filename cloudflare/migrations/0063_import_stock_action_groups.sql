-- Sale-group bookkeeping for the DIRECT-mode continuation apply (M4).
--
-- The engine first kept the group_key -> group_index map and the poisoned
-- group set in chunk_state_json; test-chunk-state-size-pure correctly
-- rejected that — both scale with the file, the exact pathology migrations
-- 0051/0052 removed from chunk state. They live here instead: one small row
-- per DISTINCT sale receipt in the sheet, written during the windowed
-- classify phase and read back during dispatch. Cleared when a fresh apply
-- run begins (the continuation engine deletes by job_id when it initializes
-- its state), and bounded by the engine's own group caps.
CREATE TABLE IF NOT EXISTS import_stock_action_groups (
  job_id TEXT NOT NULL,
  group_key TEXT NOT NULL,
  group_index INTEGER NOT NULL,
  poisoned INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (job_id, group_key)
);
