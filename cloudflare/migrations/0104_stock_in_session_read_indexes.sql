-- Opening a stock-in receipt must be a small indexed lookup.  The history
-- contains legacy receipt rows whose key is derived from created_at/user/
-- branch plus a modern reference_id key; neither access pattern was covered
-- by the original page-order indexes.
CREATE INDEX IF NOT EXISTS idx_inventory_movements_reference_type_id
  ON inventory_movements (reference_id, movement_type, id);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_created_type_user_branch_id
  ON inventory_movements (created_at, movement_type, user_id, branch_id, id);
