-- ops:min-rows 0
-- Exchange refund credits that the pre-fix code moved or unflagged (read-only, SELECT only; literal table names; no customer fields).
-- A one-step exchange books its refund credit as row 0 of the replacement sale's payment_details, flagged refund_credit, under the shop's first
-- cash-kind method, and copies that row (method and amounts, without the flag) into the sale's immutable creation snapshot (migration 0134).
-- Before the fix two writers damaged it:
--   method_changed  a bulk payment relabel or a Settings method rename rewrote the credit row's method. Found by comparing the credit's current method
--                   with the method in the creation snapshot, so a Khmer cash name, a method pinned to cash in the kinds setting and a digital method whose
--                   name contains "cash" are all judged by what they were booked as, not by a name test.
--   flag_lost       a settle of a Not Paid exchange or a payment correction rebuilt every row as {method, amount_usd, amount_khr} and dropped the flag, so
--                   an exchange cancel cannot find the credit and leaves it as a cash tender while the refund's cash-out is reversed.
--   flag_lost_cancelled  the same lost flag on an exchange that was cancelled afterwards: the cancel could not find the credit, so the sale still holds it as
--                   a cash tender although the refund was reversed. Listed when the sale has no flagged row and its payment_details still hold a row equal to
--                   the creation snapshot's row 0 (same method ignoring case and spacing, same USD and riel amounts). A cancel that worked removed that row.
--                   Known false positive: after a proper cancel the customer later paid exactly the credit's amount in the same method.
-- Only replacement sales of ONE-STEP exchanges are read (their create receipt carries exchange_payment). The joins are CROSS JOINs on purpose: SQLite
-- then keeps the written order (returns, then sales by primary key, then the receipt by its unique return_id) even without table statistics, which
-- production does not have; the planner's own order scanned all of sales there. Cancelled sales are left out. A cancelled return is read only
-- for flag_lost_cancelled (a cancel that worked removed the credit on purpose; a refused cancel leaves the flagged row and is healthy). A flag_lost row needs the return to have owed a refund (total_refund_usd - owed_reduction_usd > 0)
-- and a creation snapshot whose row 0 exists.
-- Limit: run it BEFORE the same-kind rename fix is deployed. After it, a cash to cash rename renames the credit with the rest and shows here as
-- method_changed although nothing is wrong; compare current_method with the shop's cash methods before repairing anything. It repairs nothing.
-- Columns: sale_id, row_id (position of the flagged row in payment_details; NULL for flag_lost), current_method (the flagged row's method; for flag_lost
-- the method of row 0, NULL when payment_details cannot be read), snapshot_method (row 0 of the creation snapshot), damage ('method_changed', 'flag_lost' or 'flag_lost_cancelled').
-- ops:max-rows-read 10
SELECT
  s.id AS sale_id,
  CAST(credit.key AS INTEGER) AS row_id,
  CASE WHEN credit.key IS NULL THEN CASE WHEN json_valid(s.payment_details) THEN json_extract(s.payment_details, '$[0].method') END ELSE json_extract(credit.value, '$.method') END AS current_method,
  json_extract(s.creation_snapshot_json, '$.payment_details[0].method') AS snapshot_method,
  CASE WHEN credit.key IS NOT NULL THEN 'method_changed' WHEN r.status = 'cancelled' THEN 'flag_lost_cancelled' ELSE 'flag_lost' END AS damage
FROM returns r
CROSS JOIN sales s ON s.id = r.replacement_sale_id AND s.source_return_id = r.id
CROSS JOIN return_create_receipts rc ON rc.return_id = r.id
LEFT JOIN json_each(CASE WHEN json_valid(s.payment_details) AND json_type(s.payment_details) = 'array' THEN s.payment_details ELSE '[]' END) AS credit
  ON json_type(credit.value) = 'object' AND json_extract(credit.value, '$.refund_credit') = 1
WHERE r.replacement_sale_id > 0
  AND json_valid(rc.request_json) AND json_type(rc.request_json, '$.exchange_payment') = 'object'
  AND s.money_precision_version = 1
  AND COALESCE(s.sale_status, '') <> 'cancelled'
  AND COALESCE(r.total_refund_usd, 0) - COALESCE(r.owed_reduction_usd, 0) > 0
  AND json_valid(s.creation_snapshot_json)
  AND json_type(s.creation_snapshot_json, '$.payment_details[0]') = 'object'
  AND (
    (credit.key IS NOT NULL AND COALESCE(r.status, 'completed') <> 'cancelled'
       AND lower(trim(COALESCE(json_extract(credit.value, '$.method'), '')))
       IS NOT lower(trim(COALESCE(json_extract(s.creation_snapshot_json, '$.payment_details[0].method'), ''))))
    OR (credit.key IS NULL AND COALESCE(r.status, 'completed') <> 'cancelled' AND NOT EXISTS (
      SELECT 1 FROM json_each(CASE WHEN json_valid(s.payment_details) AND json_type(s.payment_details) = 'array' THEN s.payment_details ELSE '[]' END) d
      WHERE json_type(d.value) = 'object' AND json_extract(d.value, '$.refund_credit') = 1))
    OR (credit.key IS NULL AND r.status = 'cancelled' AND EXISTS (
      SELECT 1 FROM json_each(CASE WHEN json_valid(s.payment_details) AND json_type(s.payment_details) = 'array' THEN s.payment_details ELSE '[]' END) d
      WHERE json_type(d.value) = 'object'
        AND lower(trim(COALESCE(json_extract(d.value, '$.method'), ''))) = lower(trim(COALESCE(json_extract(s.creation_snapshot_json, '$.payment_details[0].method'), '')))
        AND COALESCE(json_extract(d.value, '$.amount_usd'), 0) = COALESCE(json_extract(s.creation_snapshot_json, '$.payment_details[0].amount_usd'), 0)
        AND COALESCE(json_extract(d.value, '$.amount_khr'), 0) = COALESCE(json_extract(s.creation_snapshot_json, '$.payment_details[0].amount_khr'), 0)))
  )
ORDER BY s.id, row_id
