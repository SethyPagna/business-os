-- ops:min-rows 0
-- Exchange refund-credit rows whose method was relabelled or renamed away from a cash method before the pay-p0 fix (read-only, SELECT only).
-- An exchange books its refund credit as a tender row flagged refund_credit under the shop's cash method. A bulk payment relabel or a Settings
-- method rename used to rewrite that row like any customer row, so a credit row whose method no longer reads as cash is a row the old code moved.
-- Heuristic and its limit: "reads as cash" is a name test (the method contains 'cash', any case). A rename between two cash-named methods is
-- not listed; a credit row relabelled to a non-cash name is. Review the rows before any repair; this query repairs nothing.
-- Columns: relabelled_total (all matching rows, repeated on every row), sale_id, row_id (position of the row inside the sale's payment_details),
-- current_method (the row's method), current_label (the sale's payment_method label). No customer, phone, address, receipt or amount fields.
-- ops:max-rows-read 17438
SELECT
  COUNT(*) OVER () AS relabelled_total,
  s.id AS sale_id,
  CAST(detail.key AS INTEGER) AS row_id,
  json_extract(detail.value, '$.method') AS current_method,
  s.payment_method AS current_label
FROM sales s, json_each(CASE WHEN json_valid(s.payment_details) THEN s.payment_details ELSE '[]' END) AS detail
WHERE s.payment_details LIKE '%refund_credit%'
  AND json_type(detail.value) = 'object'
  AND json_extract(detail.value, '$.refund_credit') = 1
  AND lower(COALESCE(json_extract(detail.value, '$.method'), '')) NOT LIKE '%cash%'
ORDER BY s.id, row_id
