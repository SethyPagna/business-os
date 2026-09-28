-- SCAN1 STK-C past records: stock that left the lot ledger with no movement row.
--
-- Before the FX-stock-adjust fix, a removal that mixed lotted and legacy
-- (unlotted) stock -- POST /inventory/adjust type remove auto-routed across
-- lots, and POST /inventory/move-row -- ran removeStockAcrossBatches, which
-- committed the lot drain in a db.batch of its own (every available lot of the
-- product at that branch drained to 0, branch_stock and products.stock_quantity
-- decremented by the drained units), and THEN sent the unlotted remainder
-- through applyStockDelta's negative UPSERT. SQLite checks CHECK(quantity >= 0)
-- on the UPSERT's candidate row before ON CONFLICT, so that always failed:
-- /adjust answered 400, /move-row 500, and no inventory_movements row was ever
-- written for units that had already left both stock ledgers. The on-hand
-- figures agree with each other; they disagree with the movement ledger and
-- with the shelf (the units are still there).
--
-- Two independent signals, one row each (review both; they can corroborate):
--   receipt       a stock_mutation_receipts row (migration 0192) that wrote
--                 stock and then failed: written = 1 and a stored status of
--                 400 or more, or still unfinished more than 120 s after it
--                 was claimed. This is exactly what the old /adjust kernel
--                 left for a client that sent a client_request_id; the
--                 request's productId / branchId / type / quantity come from
--                 the stored request fingerprint.
--   orphan_drain  a lot at 0 whose last write (updated_at) has no movement
--                 row for its product and branch within 120 s. A mixed
--                 removal always drained EVERY available lot to 0 before it
--                 failed, so a lot still above 0 is never this bug. Limits: a
--                 lot touched again later has lost the timestamp (the receipt
--                 signal still has it); an unrelated movement of the same
--                 product and branch inside the window hides a real one; a
--                 migration or merge that zeroed lots can show up here --
--                 check the timestamp against the migration dates.
--
-- Columns: signal, product_id, branch_id, batch_id, batch_key, observed_at,
-- request_type, quantity (the request's quantity for a receipt, the lot's
-- received_quantity for an orphan drain), receipt_id, response_status, detail
-- (first 200 characters of the stored response), branch_stock_now,
-- lot_stock_now. Ids, timestamps and quantities only. Read-only.
--
-- Compensation is NOT done here: see the FX-stock-adjust lane result. After a
-- physical count confirms the units are still on the shelf, the operator
-- re-records them through the app (Stock Adjust, Add, reason
-- "STK-C compensation"), which writes the movement the failed request never
-- did.
-- ops:min-rows 0
-- ops:max-rows 2000
WITH receipt_fields AS (
  SELECT
    r.id AS receipt_id,
    r.response_status,
    r.response_json,
    r.created_at,
    CAST((SELECT json_extract(e.value, '$[1]') FROM json_each(r.request_json) e
      WHERE json_extract(e.value, '$[0]') IN ('productId', 'product_id') LIMIT 1) AS INTEGER) AS product_id,
    CAST((SELECT json_extract(e.value, '$[1]') FROM json_each(r.request_json) e
      WHERE json_extract(e.value, '$[0]') IN ('branchId', 'branch_id') LIMIT 1) AS INTEGER) AS branch_id,
    (SELECT json_extract(e.value, '$[1]') FROM json_each(r.request_json) e
      WHERE json_extract(e.value, '$[0]') = 'type' LIMIT 1) AS request_type,
    (SELECT json_extract(e.value, '$[1]') FROM json_each(r.request_json) e
      WHERE json_extract(e.value, '$[0]') = 'quantity' LIMIT 1) AS quantity
  FROM stock_mutation_receipts r
  WHERE r.written = 1
    AND json_valid(r.request_json)
    AND (
      COALESCE(r.response_status, 0) >= 400
      OR (r.completed_at IS NULL AND julianday('now') - julianday(r.created_at) > 120.0 / 86400.0)
    )
),
lot_now AS (
  SELECT pb.variant_product_id AS product_id, bbs.branch_id AS branch_id, SUM(bbs.quantity) AS lot_quantity
  FROM branch_batch_stock bbs
  JOIN product_batches pb ON pb.id = bbs.batch_id
  GROUP BY pb.variant_product_id, bbs.branch_id
),
orphan AS (
  SELECT pb.variant_product_id AS product_id, bbs.branch_id AS branch_id, bbs.batch_id AS batch_id,
    pb.batch_key AS batch_key, pb.received_quantity AS received_quantity, bbs.updated_at AS updated_at
  FROM branch_batch_stock bbs
  JOIN product_batches pb ON pb.id = bbs.batch_id
  WHERE bbs.quantity = 0
    AND julianday(bbs.updated_at) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM inventory_movements m
      WHERE m.product_id = pb.variant_product_id
        AND m.branch_id = bbs.branch_id
        AND ABS(julianday(m.created_at) - julianday(bbs.updated_at)) <= 120.0 / 86400.0
    )
)
SELECT
  'receipt' AS signal,
  rf.product_id AS product_id,
  rf.branch_id AS branch_id,
  NULL AS batch_id,
  NULL AS batch_key,
  rf.created_at AS observed_at,
  rf.request_type AS request_type,
  rf.quantity AS quantity,
  rf.receipt_id AS receipt_id,
  rf.response_status AS response_status,
  substr(COALESCE(rf.response_json, ''), 1, 200) AS detail,
  bs.quantity AS branch_stock_now,
  ln.lot_quantity AS lot_stock_now
FROM receipt_fields rf
LEFT JOIN branch_stock bs ON bs.product_id = rf.product_id AND bs.branch_id = rf.branch_id
LEFT JOIN lot_now ln ON ln.product_id = rf.product_id AND ln.branch_id = rf.branch_id
UNION ALL
SELECT
  'orphan_drain',
  o.product_id,
  o.branch_id,
  o.batch_id,
  o.batch_key,
  o.updated_at,
  NULL,
  o.received_quantity,
  NULL,
  NULL,
  'lot at 0; no movement for its product and branch within 120 s of its last write',
  bs.quantity,
  ln.lot_quantity
FROM orphan o
LEFT JOIN branch_stock bs ON bs.product_id = o.product_id AND bs.branch_id = o.branch_id
LEFT JOIN lot_now ln ON ln.product_id = o.product_id AND ln.branch_id = o.branch_id
ORDER BY observed_at DESC, signal, product_id, branch_id
LIMIT 2000
