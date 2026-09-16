-- 0177: a durable record of every MANUAL cost-price edit (product edit
-- form), so the cost calculation float can show it as an input alongside
-- the row's active lots instead of the edit vanishing into
-- products.cost_price_usd with no trace.
--
-- ============================== WHY ======================================
-- Owner ruling (2026-09-17, verbatim): "the cost price should also add the
-- changed if i manually change the cost price, the cost price should be
-- updated in record. also in the record it should also show the lot.
-- currently, it just says list number and shop... make them compact one
-- row per each... make it clear and concise."
--
-- Today PUT /api/products/:id writes body.cost_price_usd straight onto
-- products.cost_price_usd (routes/products.ts, updateRow) with no ledger
-- entry, and the very next add-stock recompute (recomputeCatalogCost /
-- catalogCostRecomputeStatement, wired into inventory.ts, batches.ts,
-- stockActionCommit.ts and stockSession.ts) silently overwrites it from the
-- product's active lots -- the manual figure never counted as an input and
-- never left a trace once overwritten.
--
-- ============================== RULE =====================================
-- One row per manual cost-price edit (routes/products.ts PUT /:id, source
-- 'manual'). The LATEST row for a product participates in the cost formula
-- as one more distinct cost alongside the product's active lots (see
-- lib/catalogCostRecompute.ts); older rows for the same product are history
-- only, kept for the record, never averaged in again. Append-only: nothing
-- here is ever updated, only inserted.
--
-- ============================== PRE-ASSERTION ============================
--   SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='product_cost_entries'; -- 0 on a DB below 0177
--
-- ============================== POST-ASSERTION ===========================
--   SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='product_cost_entries'; -- 1
--   SELECT COUNT(*) FROM product_cost_entries; -- 0 (no backfill -- nothing to backfill; past manual
--                                               --    edits left no trace to recover)
--
-- ============================== RECOVERY ==================================
--   DROP TABLE IF EXISTS product_cost_entries;
--
-- No-op on an empty DB (CREATE TABLE/INDEX IF NOT EXISTS) and on re-run.

CREATE TABLE IF NOT EXISTS product_cost_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  cost_khr REAL,
  source TEXT NOT NULL,            -- 'manual' (product edit form)
  user_id INTEGER,
  user_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_product_cost_entries_product ON product_cost_entries(product_id, id);
