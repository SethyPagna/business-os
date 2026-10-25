-- forensics-payment-events-mismatch-rows: the sales behind health-sale-money.payment_events_mismatch, one row each
-- (lane 6.0.974, slice S3 of DESIGN-SALE-ADDITIONS-PAYMENTS). A payments_version 1 sale is one whose payments are
-- recorded in sale_payment_events; the events (in minus out) must equal amount_paid_usd and amount_paid_khr. The CTE pe
-- is health-sale-money's own text and the WHERE below is its column's predicate; test-health-drilldown-rows-native.cjs
-- pins both against the health query and asserts this list has exactly the rows that column counts.
-- Facts per sale:
--   money         paid_usd, paid_khr (the sale columns), ev_usd, ev_khr (events in minus out), gap_usd, gap_khr
--   events        event_count, in_count, out_count, first_event_at, last_event_at, last_origin
--   sale          sale_status, total_usd, created_at, updated_at, write_revision
-- Ids, dates, amounts and code-chosen tokens only. Capped by LIMIT 201 against max-rows 200.
-- ops:min-rows 0
-- ops:max-rows 200
WITH pe AS MATERIALIZED (
  SELECT x.id, COALESCE(x.amount_paid_usd, 0) AS paid_usd, COALESCE(x.amount_paid_khr, 0) AS paid_khr,
    COALESCE(e.usd, 0) AS ev_usd, COALESCE(e.khr, 0) AS ev_khr
  FROM sales x LEFT JOIN (
    SELECT sale_id, SUM(CASE WHEN direction = 'out' THEN -amount_paid_usd ELSE amount_paid_usd END) AS usd,
      SUM(CASE WHEN direction = 'out' THEN -amount_paid_khr ELSE amount_paid_khr END) AS khr
    FROM sale_payment_events GROUP BY sale_id
  ) e ON e.sale_id = x.id
  WHERE x.payments_version = 1
),
k AS MATERIALIZED (
  SELECT id, paid_usd, paid_khr, ev_usd, ev_khr FROM pe WHERE ABS(ev_usd - paid_usd) > 0.00005 OR ABS(ev_khr - paid_khr) > 0.5
)
SELECT k.id AS sale_id, x.sale_status, x.total_usd, k.paid_usd, k.paid_khr, k.ev_usd, k.ev_khr,
  ROUND(k.paid_usd - k.ev_usd, 4) AS gap_usd, k.paid_khr - k.ev_khr AS gap_khr,
  (SELECT COUNT(*) FROM sale_payment_events e WHERE e.sale_id = k.id) AS event_count,
  (SELECT COUNT(*) FROM sale_payment_events e WHERE e.sale_id = k.id AND e.direction = 'in') AS in_count,
  (SELECT COUNT(*) FROM sale_payment_events e WHERE e.sale_id = k.id AND e.direction = 'out') AS out_count,
  (SELECT MIN(e.received_at) FROM sale_payment_events e WHERE e.sale_id = k.id) AS first_event_at,
  (SELECT MAX(e.received_at) FROM sale_payment_events e WHERE e.sale_id = k.id) AS last_event_at,
  (SELECT e.origin FROM sale_payment_events e WHERE e.sale_id = k.id ORDER BY e.id DESC LIMIT 1) AS last_origin,
  x.created_at, x.updated_at, COALESCE((SELECT w.revision FROM sale_write_revisions w WHERE w.sale_id = k.id), 0) AS write_revision
FROM k JOIN sales x ON x.id = k.id
ORDER BY k.id
LIMIT 201
