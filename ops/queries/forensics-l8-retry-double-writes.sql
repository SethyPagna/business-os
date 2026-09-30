-- L8 forensics (SCAN1 F2 / F5): writes likely applied TWICE because the UI
-- stopped waiting (12-15 s, "Please try again") while the POST lived on (up
-- to 45 s) and committed, and the operator's retry went out under a NEW
-- client_request_id (legacy customer return, supplier return, loyalty award)
-- or none at all (Inventory Adjust add/remove). Each row is one PAIR: an
-- earlier row and a later twin with the same subject, the same contents and
-- the same actor, at most 120 seconds apart. Before the fix both twins carry
-- different request ids (returns) or none (ledger rows), so the pair itself
-- is the only trace.
-- Read-only. Ids, dates, quantities, points and USD amounts only.
--   kind              customer_return | supplier_return | loyalty_award | stock_adjust
--   first_id, second_id    returns.id | loyalty_point_adjustments.id | inventory_movements.id
--   first_at, second_at, gap_seconds
--   subject_id        sale_id | supplier_id | customer_id | product_id
--   branch_id, actor_id    (cashier_id / created_by_id / user_id)
--   amount            the second twin's refund USD | supplier compensation USD |
--                     points | signed quantity (outflows negative)
--   signature         the matched contents: return lines as
--                     sale_item:product x qty (customer) or product:batch x qty
--                     (supplier); points; movement type x quantity
--   same_reference    stock_adjust only: 1 when both movements carry the same
--                     reference_id (an Inventory Adjust stock-in carries the
--                     sheet's session, minted once per opening), NULL when a
--                     side has none. Pairs whose references DIFFER are two
--                     separate sheets or sessions and are not listed.
--   request_ids_differ  returns only: 1 when both twins stored a request id
--                     (they always differ: the column is UNIQUE)
--   both_active       0 when either twin was since cancelled (return), voided
--                     (points) or reverted (movement) -- already compensated.
--                     A movement counts as reverted by a 'revert:<id>' row, or
--                     by the Inventory page's Undo: an 'Undo: ...' movement of
--                     the same product, branch and quantity in the opposite
--                     direction after the first twin. The Undo names no
--                     movement, so an Undo of another such adjust counts too.
--   suggested_class   a: gap <= 60 s, both active, and for stock_adjust the same
--                        session (stock-in) or no session on either side (outflow)
--                     b: any other active pair (owner review)
--                     c: one twin already cancelled, voided, reverted or undone
-- Proposed repair (NOT run by this query): per class-a pair, cancel the second
-- return through the Returns page bulk Cancel (restores stock and the refund
-- through the app's own guards), void the second points row with reason
-- 'SCAN1 F2 duplicate retry', and post the opposite stock movement for the
-- second adjust with reason 'SCAN1 F5 duplicate retry'; class b and c go to the
-- owner row by row (in class c, a later 'Redo: ...' movement re-applies an
-- undone twin).
-- Audit first, back up, and record each id pair used.
-- ops:min-rows 0
-- ops:max-rows 2000
WITH cr AS (
  SELECT a.id AS first_id, b.id AS second_id, a.created_at AS a_at, b.created_at AS b_at,
    a.sale_id AS subject_id, b.branch_id, b.cashier_id AS actor_id, b.total_refund_usd AS amount,
    (SELECT group_concat(k, ';') FROM (SELECT COALESCE(ri.sale_item_id, 0) || ':' || COALESCE(ri.product_id, 0) || 'x' || printf('%g', ri.quantity) AS k
      FROM return_items ri WHERE ri.return_id = a.id ORDER BY 1)) AS sig_a,
    (SELECT group_concat(k, ';') FROM (SELECT COALESCE(ri.sale_item_id, 0) || ':' || COALESCE(ri.product_id, 0) || 'x' || printf('%g', ri.quantity) AS k
      FROM return_items ri WHERE ri.return_id = b.id ORDER BY 1)) AS sig_b,
    CASE WHEN COALESCE(a.client_request_id, '') <> '' AND COALESCE(b.client_request_id, '') <> '' THEN 1 ELSE 0 END AS request_ids_differ,
    CASE WHEN COALESCE(a.status, '') = 'cancelled' OR COALESCE(b.status, '') = 'cancelled' THEN 0 ELSE 1 END AS both_active
  FROM returns a
  JOIN returns b ON b.sale_id = a.sale_id AND b.id > a.id
  WHERE a.sale_id IS NOT NULL
    AND COALESCE(a.return_scope, 'customer') = 'customer' AND COALESCE(b.return_scope, 'customer') = 'customer'
    AND b.cashier_id IS a.cashier_id
    AND b.created_at >= date(a.created_at, '-1 day') AND b.created_at < date(a.created_at, '+2 days')
    AND ABS(julianday(b.created_at) - julianday(a.created_at)) * 86400 <= 120
),
sr AS (
  SELECT a.id AS first_id, b.id AS second_id, a.created_at AS a_at, b.created_at AS b_at,
    a.supplier_id AS subject_id, b.branch_id, b.cashier_id AS actor_id, b.supplier_compensation_usd AS amount,
    (SELECT group_concat(k, ';') FROM (SELECT COALESCE(ri.product_id, 0) || ':' || COALESCE(ri.batch_id, 0) || 'x' || printf('%g', ri.quantity) AS k
      FROM return_items ri WHERE ri.return_id = a.id ORDER BY 1)) AS sig_a,
    (SELECT group_concat(k, ';') FROM (SELECT COALESCE(ri.product_id, 0) || ':' || COALESCE(ri.batch_id, 0) || 'x' || printf('%g', ri.quantity) AS k
      FROM return_items ri WHERE ri.return_id = b.id ORDER BY 1)) AS sig_b,
    CASE WHEN COALESCE(a.client_request_id, '') <> '' AND COALESCE(b.client_request_id, '') <> '' THEN 1 ELSE 0 END AS request_ids_differ,
    CASE WHEN COALESCE(a.status, '') = 'cancelled' OR COALESCE(b.status, '') = 'cancelled' THEN 0 ELSE 1 END AS both_active
  FROM returns a
  JOIN returns b ON COALESCE(b.return_scope, 'customer') = 'supplier'
    AND b.created_at >= date(a.created_at, '-1 day') AND b.created_at < date(a.created_at, '+2 days')
    AND b.id > a.id AND b.supplier_id = a.supplier_id AND b.branch_id IS a.branch_id
  WHERE COALESCE(a.return_scope, 'customer') = 'supplier' AND a.supplier_id IS NOT NULL
    AND b.cashier_id IS a.cashier_id
    AND ABS(COALESCE(b.supplier_compensation_usd, 0) - COALESCE(a.supplier_compensation_usd, 0)) < 0.005
    AND ABS(julianday(b.created_at) - julianday(a.created_at)) * 86400 <= 120
),
la AS (
  SELECT a.id AS first_id, b.id AS second_id, a.created_at AS a_at, b.created_at AS b_at,
    a.customer_id AS subject_id, NULL AS branch_id, b.created_by_id AS actor_id, b.points AS amount,
    CASE WHEN a.voided_at IS NOT NULL OR b.voided_at IS NOT NULL THEN 0 ELSE 1 END AS both_active
  FROM loyalty_point_adjustments a
  JOIN loyalty_point_adjustments b ON b.customer_id = a.customer_id AND b.id > a.id
  WHERE a.points > 0 AND b.points = a.points AND b.note IS a.note AND b.created_by_id IS a.created_by_id
    AND b.created_at >= date(a.created_at, '-1 day') AND b.created_at < date(a.created_at, '+2 days')
    AND ABS(julianday(b.created_at) - julianday(a.created_at)) * 86400 <= 120
),
sa AS (
  SELECT a.id AS first_id, b.id AS second_id, a.created_at AS a_at, b.created_at AS b_at,
    a.product_id AS subject_id, b.branch_id, b.user_id AS actor_id,
    CASE WHEN b.movement_type IN ('remove', 'damage_out', 'write_off') THEN -ABS(COALESCE(b.quantity, 0)) ELSE ABS(COALESCE(b.quantity, 0)) END AS amount,
    b.movement_type || 'x' || printf('%g', b.quantity) AS signature,
    CASE WHEN a.reference_id IS NULL OR b.reference_id IS NULL THEN NULL
      WHEN CAST(a.reference_id AS TEXT) = CAST(b.reference_id AS TEXT) THEN 1 ELSE 0 END AS same_reference,
    CASE WHEN EXISTS (SELECT 1 FROM inventory_movements x WHERE x.reference_id IN ('revert:' || a.id, 'revert:' || b.id))
      OR EXISTS (
        SELECT 1 FROM inventory_movements u
        WHERE u.product_id = a.product_id AND u.branch_id IS a.branch_id AND u.id > a.id
          AND ABS(u.quantity) = ABS(a.quantity) AND u.reason LIKE 'Undo: %'
          AND CASE WHEN a.movement_type IN ('remove', 'damage_out', 'write_off')
            THEN u.movement_type IN ('add', 'adjustment')
            ELSE u.movement_type IN ('remove', 'damage_out', 'write_off') END
      )
      THEN 0 ELSE 1 END AS both_active
  FROM inventory_movements a
  JOIN inventory_movements b ON b.product_id = a.product_id
    AND b.created_at >= date(a.created_at, '-1 day') AND b.created_at < date(a.created_at, '+2 days')
    AND b.id > a.id
  WHERE a.movement_type IN ('add', 'remove', 'adjustment', 'damage_out', 'write_off')
    AND b.movement_type = a.movement_type AND b.quantity = a.quantity
    AND b.branch_id IS a.branch_id AND b.batch_id IS a.batch_id AND b.user_id IS a.user_id AND b.reason IS a.reason
    AND COALESCE(a.reason, '') <> 'Dated stock count import'
    AND ABS(julianday(b.created_at) - julianday(a.created_at)) * 86400 <= 120
),
pairs AS (
  SELECT 'customer_return' AS kind, first_id, second_id, a_at, b_at, subject_id, branch_id, actor_id, amount,
    sig_b AS signature, NULL AS same_reference, request_ids_differ, both_active
  FROM cr WHERE sig_a IS sig_b
  UNION ALL
  SELECT 'supplier_return', first_id, second_id, a_at, b_at, subject_id, branch_id, actor_id, amount,
    sig_b, NULL, request_ids_differ, both_active
  FROM sr WHERE sig_a IS sig_b
  UNION ALL
  SELECT 'loyalty_award', first_id, second_id, a_at, b_at, subject_id, branch_id, actor_id, amount,
    'points=' || printf('%g', amount), NULL, NULL, both_active
  FROM la
  UNION ALL
  SELECT 'stock_adjust', first_id, second_id, a_at, b_at, subject_id, branch_id, actor_id, amount,
    signature, same_reference, NULL, both_active
  FROM sa WHERE same_reference IS NULL OR same_reference = 1
)
SELECT
  p.kind, p.first_id, p.second_id,
  COALESCE(strftime('%Y-%m-%d %H:%M:%S', p.a_at), p.a_at) AS first_at,
  COALESCE(strftime('%Y-%m-%d %H:%M:%S', p.b_at), p.b_at) AS second_at,
  CAST(ROUND(ABS(julianday(p.b_at) - julianday(p.a_at)) * 86400) AS INTEGER) AS gap_seconds,
  p.subject_id, p.branch_id, p.actor_id, p.amount, p.signature, p.same_reference, p.request_ids_differ, p.both_active,
  CASE
    WHEN p.both_active = 0 THEN 'c'
    WHEN ABS(julianday(p.b_at) - julianday(p.a_at)) * 86400 <= 60
      AND (p.kind <> 'stock_adjust' OR p.same_reference = 1 OR (p.same_reference IS NULL AND p.amount < 0)) THEN 'a'
    ELSE 'b'
  END AS suggested_class
FROM pairs p
ORDER BY first_at, p.kind, p.first_id, p.second_id
LIMIT 2000
