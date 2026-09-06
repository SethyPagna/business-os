-- 0128: normalise the unified stock-in session's movement rows onto the
-- ledger's canonical receipt type, and index the column a New/Existing
-- lookup joins on.
--
-- WHY. lib/stockSession.ts wrote the session MODE ('stock_in') into
-- inventory_movements.movement_type instead of the ledger's receipt type
-- ('add' -- what POST /api/inventory/adjust, POST /api/batches and this same
-- file's own redo path all write). Every reader that means "a receipt"
-- filtered movement_type='add', so sessions committed through the Products
-- page's "Add products" entry were invisible in Stock-in Sessions, absent
-- from the shared-lot receipt counter, and missing from the Telegram stock-in
-- digest. The writer now emits 'add'; this migration brings the rows already
-- committed under the old string onto the same string so the compatibility
-- alias in stockInSessionsQuery.ts can eventually be retired.
--
-- Rows touched are exactly those inventory_movements whose movement_type is
-- the literal 'stock_in'. No other writer in this repository has ever emitted
-- that string (git grep "'stock_in'" over cloudflare/src: only stockSession's
-- mode plumbing and this one INSERT).
--
-- PRE-ASSERTIONS (run before applying; record the numbers):
--   SELECT COUNT(*) AS legacy_rows FROM inventory_movements WHERE movement_type = 'stock_in';
--   SELECT COUNT(*) AS canonical_rows FROM inventory_movements WHERE movement_type = 'add';
--   SELECT COUNT(DISTINCT reference_id) AS legacy_sessions FROM inventory_movements WHERE movement_type = 'stock_in';
--
-- POST-ASSERTIONS (must hold after applying):
--   SELECT COUNT(*) FROM inventory_movements WHERE movement_type = 'stock_in';  -- must be 0
--   SELECT COUNT(*) FROM inventory_movements WHERE movement_type = 'add';       -- must equal canonical_rows + legacy_rows
--   -- every legacy session now appears in the sessions list:
--   SELECT COUNT(DISTINCT 'session:' || CAST(reference_id AS TEXT)) FROM inventory_movements
--     WHERE movement_type = 'add' AND reference_id IS NOT NULL;                 -- must be >= legacy_sessions
--
-- RECOVERY. The change is a pure string rewrite of one column on an
-- identifiable row set. To undo, re-mark the same rows from their session
-- membership:
--   UPDATE inventory_movements SET movement_type = 'stock_in'
--   WHERE id IN (SELECT movement_id FROM stock_session_members WHERE movement_id IS NOT NULL)
--     AND movement_type = 'add';
-- (Only correct while no post-fix session has written 'add' rows; capture the
-- id list from the pre-assertion query before applying if in doubt.)

UPDATE inventory_movements SET movement_type = 'add' WHERE movement_type = 'stock_in';

-- stock_session_members.movement_id is the only path from a movement row back
-- to the fact that recorded whether the product was CREATED by that session
-- (product_created / command_kind). 0124 indexed product and batch but not
-- movement_id, so the Stock-in Sessions line query's New/Existing join had no
-- index to use.
CREATE INDEX IF NOT EXISTS idx_stock_session_members_movement
  ON stock_session_members(movement_id) WHERE movement_id IS NOT NULL;
