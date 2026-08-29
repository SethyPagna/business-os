-- 0081: reconcile the lot ledger to branch stock for MULTI-lot products --
-- the successor 0079 needs, because 0079 went inert.
--
-- 0079 fixed exactly this divergence and is applied, but its guard is
-- `n = 1`, written when (its own words) "every one of the ~6,100 products has
-- exactly ONE active lot". The Aug-28 stock-history import then created
-- 19,914 more lots: today 6,007 products carry multiple lots (up to 57) and
-- only 97 remain single-lot, so 0079 now skips 98% of the catalog.
--
-- What is actually wrong, measured on production. `branch_stock` totals
-- 23,113 units; `branch_batch_stock` totals 12,725. Per product x branch:
-- 10,943 pairs agree, 1,257 are short by 10,415 units, and 8 are the reverse
-- (27 units of lot stock standing against zero branch stock). Cause: the
-- products import's default path REPLACES a branch's quantity and never
-- touches product_batches, and only the FIRST csv row per product takes the
-- new-product path that creates a lot -- so the 6,104 "Received via product
-- import" opening lots sit 5,927 at Shop and 177 at Warehouse. The migration
-- pack's Step 4d re-imported through that same default path, rebuilding
-- branch_stock and leaving the lot ledger where it was.
--
-- Why it matters beyond tidiness: every product carries an active batch, so
-- the POS treats all of them as batch-tracked and requires a lot with stock
-- before the add button enables. 30 Shop products (109 units) were therefore
-- unsellable while plainly showing stock -- e.g. Morphe Fluidity Concealer
-- C2.65, 11 on hand, 0 in any lot -- and the Warehouse had 1,225 rows /
-- 10,298 units with no lot at all.
--
-- The rule, and why it is unambiguous. `branch_stock` is authoritative: it is
-- what the template snapshot rebuilt and what every stock figure in the app
-- reads. The difference at each product x branch is the opening quantity the
-- import never lotted, and every product has exactly one "Received via
-- product import" lot to carry it (verified on production: 6,104 products,
-- 6,104 such lots, none inactive, none duplicated). So the opening lot
-- absorbs the whole difference in both directions. Historical "Unified stock
-- import" lots are never touched, which keeps them parked at 0 exactly as the
-- pack's Step 4e intended -- this migration and 4e are complementary, and
-- re-running 4e after it stays a no-op.
--
-- Only when the OTHER lots alone already claim more than the branch really
-- holds (the 8 reversed pairs) is that impossible; there the other lots are
-- zeroed and the opening lot takes the whole branch quantity, because a lot
-- ledger claiming stock the branch does not have lets the POS put units in a
-- cart that the CHECK (quantity >= 0) on branch_stock then refuses at sale
-- time.
--
-- Written entirely against pre-aggregated helper tables rather than
-- correlated subqueries: the correlated form re-walks branch_batch_stock per
-- candidate pair and D1 answers it with "exceeded its CPU time limit" at this
-- data size (confirmed by running the read-only equivalent against
-- production before writing this). Every join below is on a primary key.
--
-- Idempotent: rows are only planned where the ledger actually disagrees, so a
-- second run plans nothing. Helpers are dropped first so a retry after a
-- partially-applied run finishes instead of failing on "table already
-- exists".

DROP TABLE IF EXISTS _lot_ledger_reconcile;
DROP TABLE IF EXISTS _lot_ledger_zero_batches;
DROP TABLE IF EXISTS _lot_ledger_opening;
DROP TABLE IF EXISTS _lot_ledger_totals;

-- What the lot ledger currently holds per product x branch, and how much of
-- that sits on the opening lot. One pass over branch_batch_stock.
CREATE TABLE _lot_ledger_totals (
  product_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  lot_qty REAL NOT NULL,
  opening_qty REAL NOT NULL,
  PRIMARY KEY (product_id, branch_id)
);

INSERT INTO _lot_ledger_totals (product_id, branch_id, lot_qty, opening_qty)
SELECT pb.variant_product_id,
       bbs.branch_id,
       SUM(bbs.quantity),
       SUM(CASE WHEN pb.notes = 'Received via product import' THEN bbs.quantity ELSE 0 END)
FROM branch_batch_stock bbs
JOIN product_batches pb ON pb.id = bbs.batch_id AND pb.is_active = 1
GROUP BY pb.variant_product_id, bbs.branch_id;

-- The lot that absorbs the difference: the product's opening-stock lot,
-- falling back to its lowest-id active lot for any product that has none
-- (nothing in production today, but a product created by another path must
-- not silently drop out of the reconciliation).
CREATE TABLE _lot_ledger_opening (
  product_id INTEGER PRIMARY KEY,
  batch_id INTEGER NOT NULL
);

INSERT INTO _lot_ledger_opening (product_id, batch_id)
SELECT variant_product_id,
       COALESCE(MIN(CASE WHEN notes = 'Received via product import' THEN id END), MIN(id))
FROM product_batches
WHERE is_active = 1
GROUP BY variant_product_id;

-- One row per disagreeing product x branch. `others` is what the product's
-- lots OTHER than its opening lot hold at that branch; the opening lot then
-- takes whatever is left of the branch's real quantity. When `others` alone
-- exceeds it, that is impossible and zero_others fires instead.
CREATE TABLE _lot_ledger_reconcile (
  product_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  opening_batch_id INTEGER NOT NULL,
  opening_target REAL NOT NULL,
  zero_others INTEGER NOT NULL,
  PRIMARY KEY (product_id, branch_id)
);

INSERT INTO _lot_ledger_reconcile (product_id, branch_id, opening_batch_id, opening_target, zero_others)
SELECT p.product_id,
       p.branch_id,
       ol.batch_id,
       CASE WHEN p.branch_qty >= p.lot_qty - p.opening_qty
            THEN p.branch_qty - (p.lot_qty - p.opening_qty)
            ELSE p.branch_qty END,
       CASE WHEN p.branch_qty >= p.lot_qty - p.opening_qty THEN 0 ELSE 1 END
FROM (
  -- Every pair either side knows about. Both directions are needed: a branch
  -- with stock and no lot row at all (the Warehouse shape), and a lot row
  -- standing against a branch_stock row that does not exist.
  SELECT bs.product_id AS product_id,
         bs.branch_id AS branch_id,
         bs.quantity AS branch_qty,
         COALESCE(t.lot_qty, 0) AS lot_qty,
         COALESCE(t.opening_qty, 0) AS opening_qty
  FROM branch_stock bs
  LEFT JOIN _lot_ledger_totals t ON t.product_id = bs.product_id AND t.branch_id = bs.branch_id
  UNION
  SELECT t.product_id,
         t.branch_id,
         COALESCE(bs.quantity, 0),
         t.lot_qty,
         t.opening_qty
  FROM _lot_ledger_totals t
  LEFT JOIN branch_stock bs ON bs.product_id = t.product_id AND bs.branch_id = t.branch_id
) p
JOIN _lot_ledger_opening ol ON ol.product_id = p.product_id
WHERE p.branch_qty <> p.lot_qty;

-- The final opening-lot UPDATE probes this helper by opening batch + branch,
-- not by its product + branch primary key. Without this index D1 scans all
-- ~1,265 planned rows once for every branch_batch_stock row (~26k), which is
-- exactly the production-scale path that exceeded the CPU limit on the first
-- 0081 apply attempt.
CREATE INDEX _lot_ledger_reconcile_open_idx
  ON _lot_ledger_reconcile (opening_batch_id, branch_id);

-- The opening lot may have no row at that branch yet -- that IS the common
-- shortfall case (5,927 opening lots live at Shop, 177 at Warehouse, so a
-- product's other branch usually has none).
INSERT INTO branch_batch_stock (batch_id, branch_id, quantity)
SELECT r.opening_batch_id, r.branch_id, 0
FROM _lot_ledger_reconcile r
WHERE NOT EXISTS (
  SELECT 1 FROM branch_batch_stock bbs
  WHERE bbs.batch_id = r.opening_batch_id AND bbs.branch_id = r.branch_id
);

-- Materialize the tiny set of other lot rows that must be zeroed. The old
-- correlated IN form rejoined/scanned branch_batch_stock from inside an
-- UPDATE of that same table; this primary-keyed helper turns the UPDATE into
-- one indexed existence probe per row.
CREATE TABLE _lot_ledger_zero_batches (
  batch_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  PRIMARY KEY (batch_id, branch_id)
);

INSERT INTO _lot_ledger_zero_batches (batch_id, branch_id)
SELECT bbs.batch_id, bbs.branch_id
FROM branch_batch_stock bbs
JOIN product_batches pb ON pb.id = bbs.batch_id
JOIN _lot_ledger_reconcile r
  ON r.product_id = pb.variant_product_id
 AND r.branch_id = bbs.branch_id
 AND r.zero_others = 1
 AND bbs.batch_id <> r.opening_batch_id;

-- Zero the other lots first, only for the pairs that need it, so the opening
-- lot's target below lands on a ledger that already agrees with it.
UPDATE branch_batch_stock
SET quantity = 0, updated_at = datetime('now')
WHERE EXISTS (
  SELECT 1 FROM _lot_ledger_zero_batches z
  WHERE z.batch_id = branch_batch_stock.batch_id
    AND z.branch_id = branch_batch_stock.branch_id
);

UPDATE branch_batch_stock
SET quantity = (SELECT r.opening_target FROM _lot_ledger_reconcile r
                WHERE r.opening_batch_id = branch_batch_stock.batch_id
                  AND r.branch_id = branch_batch_stock.branch_id),
    updated_at = datetime('now')
WHERE EXISTS (
  SELECT 1 FROM _lot_ledger_reconcile r
  WHERE r.opening_batch_id = branch_batch_stock.batch_id
    AND r.branch_id = branch_batch_stock.branch_id
);

DROP TABLE _lot_ledger_reconcile;
DROP TABLE _lot_ledger_zero_batches;
DROP TABLE _lot_ledger_opening;
DROP TABLE _lot_ledger_totals;
