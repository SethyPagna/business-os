-- Customer returns whose damaged handling an undo or redo may have turned into plain restock (lane 6.0.999).
-- Read-only. Before 6.0.999 the undo/redo body of a return edit sent only return_to_stock, so a damaged or
-- no-restock line came back as restock. A row with damage_reversals > 0 and lots_now = 0 is a damaged line
-- that is now sellable stock; replay_note marks returns whose last write was an Undo/Redo of an edit.
-- Returns no customer data, only return ids, numbers and counts.
-- ops:min-rows 0
-- ops:max-rows 500
SELECT r.id, r.return_number, r.status, r.updated_at,
  CASE WHEN r.notes IN ('Undo return edit','Redo return edit') THEN 1 ELSE 0 END AS replay_note,
  (SELECT COUNT(*) FROM inventory_movements m WHERE CAST(m.reference_id AS TEXT)=CAST(r.id AS TEXT) AND m.movement_type='damage_reversal') AS damage_reversals,
  (SELECT COUNT(*) FROM damaged_stock_lots l WHERE l.return_id=r.id) AS lots_now,
  (SELECT COUNT(*) FROM return_items i WHERE i.return_id=r.id AND i.stock_action='damaged') AS damaged_lines_now,
  (SELECT COUNT(*) FROM return_items i WHERE i.return_id=r.id AND i.stock_action='restock') AS restock_lines_now
FROM returns r
WHERE COALESCE(r.return_scope,'customer')='customer'
ORDER BY r.updated_at DESC
LIMIT 500;
