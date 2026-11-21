-- Positive branch stock whose lot is missing or inactive (read-only, SELECT only). Healthy = no rows.
-- The invariant behind migrations 0154 and 0155: stock above zero sits only on an active lot that exists. Migration 0320 removed
-- 0155's per-insert orphan scan (a REPLACE of a lot row is now refused by the Worker before it is sent, lib/db.ts guardD1), so this
-- check, run after each deploy and weekly, is what notices a lot that was lost some other way (a manual write, a restore, an old code path).
-- Same statement as the pre/postflight query in the header of 0155 and of 0320, with the lot state added.
-- Selects ids, a quantity and a lot state only: no customer, supplier, product name or any personal field.
-- INDEXED BY pins the partial index idx_branch_batch_stock_positive_batch_0155, which bounds the scan to positive stock (the planner
-- otherwise walks every stock row, zero history included); the lot is a primary key probe.
-- LIMIT keeps a damaged database from printing every row: the first 50 are enough to start from.
-- ops:min-rows 0
-- ops:max-rows 0
-- ops:max-rows-read 8753
SELECT bbs.id AS branch_batch_stock_id, bbs.batch_id, bbs.branch_id, bbs.quantity,
       CASE WHEN pb.id IS NULL THEN 'lot_missing' ELSE 'lot_inactive' END AS problem
FROM branch_batch_stock bbs INDEXED BY idx_branch_batch_stock_positive_batch_0155
LEFT JOIN product_batches pb ON pb.id = bbs.batch_id
WHERE bbs.quantity > 0 AND (pb.id IS NULL OR pb.is_active IS NOT 1)
ORDER BY bbs.id
LIMIT 50
