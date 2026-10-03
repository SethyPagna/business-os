-- ops:min-rows 0
WITH lots AS (
  SELECT pb.variant_product_id AS product_id, s.branch_id, SUM(s.quantity) AS quantity
  FROM branch_batch_stock s
  JOIN product_batches pb ON pb.id=s.batch_id
  GROUP BY pb.variant_product_id, s.branch_id
), pairs AS (
  SELECT product_id, branch_id FROM branch_stock
  UNION SELECT product_id, branch_id FROM lots
), balances AS (
  SELECT p.product_id, p.branch_id, COALESCE(s.quantity,0) AS stock_quantity, COALESCE(l.quantity,0) AS lot_quantity
  FROM pairs p
  LEFT JOIN branch_stock s ON s.product_id=p.product_id AND s.branch_id=p.branch_id
  LEFT JOIN lots l ON l.product_id=p.product_id AND l.branch_id=p.branch_id
)
SELECT
  b.id AS branch_id, b.name, b.is_active, b.is_default,
  (SELECT COUNT(*) FROM branch_stock s WHERE s.branch_id=b.id) AS stock_rows,
  (SELECT COUNT(*) FROM branch_stock s WHERE s.branch_id=b.id AND s.quantity>0) AS positive_products,
  (SELECT COALESCE(SUM(s.quantity),0) FROM branch_stock s WHERE s.branch_id=b.id) AS stock_quantity,
  (SELECT COUNT(*) FROM branch_stock s WHERE s.branch_id=b.id AND s.quantity<>CAST(s.quantity AS INTEGER)) AS fractional_stock_rows,
  (SELECT COUNT(*) FROM branch_batch_stock s WHERE s.branch_id=b.id AND s.quantity>0) AS positive_lot_rows,
  (SELECT COALESCE(SUM(s.quantity),0) FROM branch_batch_stock s WHERE s.branch_id=b.id) AS lot_quantity,
  (SELECT COALESCE(SUM(MAX(x.stock_quantity-x.lot_quantity,0)),0) FROM balances x WHERE x.branch_id=b.id) AS positive_untracked_quantity,
  (SELECT COUNT(*) FROM balances x WHERE x.branch_id=b.id AND x.lot_quantity>x.stock_quantity) AS lots_exceed_stock_pairs,
  (SELECT COUNT(*) FROM branch_batch_stock s LEFT JOIN product_batches pb ON pb.id=s.batch_id WHERE s.branch_id=b.id AND pb.id IS NULL) AS missing_batch_rows,
  (SELECT COUNT(*) FROM branch_batch_stock s WHERE s.branch_id=b.id AND s.quantity>0
    AND EXISTS(SELECT 1 FROM branch_batch_stock peer JOIN branches known ON known.id=peer.branch_id
      WHERE peer.batch_id=s.batch_id AND peer.branch_id<>b.id AND peer.quantity>0)) AS positive_shared_batch_rows,
  (SELECT COUNT(*) FROM branch_batch_stock s LEFT JOIN product_batches pb ON pb.id=s.batch_id
    WHERE s.branch_id=b.id AND s.quantity>0 AND TRIM(COALESCE(pb.received_at,''))='') AS unknown_received_date_rows,
  (SELECT MIN(pb.received_at) FROM branch_batch_stock s JOIN product_batches pb ON pb.id=s.batch_id
    WHERE s.branch_id=b.id AND s.quantity>0 AND TRIM(COALESCE(pb.received_at,''))<>'') AS first_received_at,
  (SELECT MAX(pb.received_at) FROM branch_batch_stock s JOIN product_batches pb ON pb.id=s.batch_id
    WHERE s.branch_id=b.id AND s.quantity>0 AND TRIM(COALESCE(pb.received_at,''))<>'') AS last_received_at,
  (SELECT COALESCE(SUM(s.quantity_remaining),0) FROM damaged_stock_lots s WHERE s.branch_id=b.id) AS damaged_remaining,
  (SELECT COUNT(*) FROM rfid_tags s WHERE s.branch_id=b.id AND s.status='active') AS active_rfid_tags,
  (SELECT COUNT(*) FROM shift_sessions s WHERE s.branch_id=b.id AND s.closed_at IS NULL AND s.cancelled_at IS NULL) AS open_shifts,
  (SELECT COUNT(*) FROM stock_transfers s WHERE s.from_branch_id=b.id OR s.to_branch_id=b.id) AS transfer_rows,
  (SELECT COUNT(*) FROM stock_session_members s WHERE s.branch_id=b.id) AS stock_session_members,
  (SELECT COUNT(*) FROM branch_stock s LEFT JOIN branches known ON known.id=s.branch_id WHERE known.id IS NULL) AS orphan_branch_stock_rows,
  (SELECT COUNT(*) FROM branch_batch_stock s LEFT JOIN branches known ON known.id=s.branch_id WHERE known.id IS NULL) AS orphan_branch_lot_rows
FROM branches b
ORDER BY b.id
