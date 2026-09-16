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
-- Follow-up owner correction (same day, verbatim): "edit can override cost
-- so before might be (n+n1+n2)/3, after override just becomes n. this means
-- if future add stock have different price it will take from this n then
-- add the new cost price / by that number of cost price... and override is
-- in edit -> price -> cost in product section product page." So a manual
-- edit is not one more distinct cost folded into the existing lots' average
-- -- it REPLACES the average as the new baseline, and only lots received
-- AFTER that edit count again from then on.
--
-- ============================== RULE =====================================
-- One row per manual cost-price edit (routes/products.ts PUT /:id, source
-- 'manual'). The LATEST row for a product is an OVERRIDE baseline, not one
-- more input: the cost formula (lib/catalogCostRecompute.ts) is the latest
-- entry's cost_usd, combined only with active lots received AFTER it
-- (product_batches.id > baseline_batch_id) -- lots from before the override
-- no longer count. baseline_batch_id is the highest product_batches.id that
-- already existed for this product at the moment of the edit (0 when the
-- product had no lots yet), captured once at insert so a later lot never
-- retroactively changes what an earlier override's baseline was. Older
-- manual rows for the same product are history only, kept for the record,
-- never re-entering the formula. Append-only: nothing here is ever updated,
-- only inserted.
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
  baseline_batch_id INTEGER NOT NULL DEFAULT 0,  -- MAX(product_batches.id) for this product at edit time (0 = none yet); only lots with id > this count again
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_product_cost_entries_product ON product_cost_entries(product_id, id);
