-- DATA-AUDIT lane B (stock & cost), query 15 of 15: received-date and expiry-date sanity of the lots.
-- Owner ask 7 Oct 2026: "compare all the backend data for any inconsistencies or logic that isn't consistent".
--
-- Owner rule (lot identity 29 Aug; cutover 6 Oct): a lot is identified by its received DATE (the business day, UTC+7), whatever text stored it, and an expiry date keeps
-- lots apart. A received date that has no business day can never merge or sort; an expiry that is not a date can never be warned about; an expiry before the day the
-- stock arrived, or a receipt dated in the future, is a typing or import error. The business-day expression is branchCutoverParent.ts cutoverLotDaySql, verbatim (as in
-- cutover-fold-preview.sql). The SHAPE census (how many lots use ISO / ISO-T / datetime) is received-date-format-census.sql; this query does not repeat it.
-- Expiry is stored as text; the accepted shape is a calendar date YYYY-MM-DD (optionally followed by a time part).
--
-- One row, over ACTIVE lots. Zero-expected:
--   lots_received_unparseable     lots whose received_at yields no business day (NULL, empty or not a date)
--   lots_expiry_unparseable       lots with a non-empty expiry_date that is not a valid calendar date
--   lots_expiry_before_received   lots whose expiry date is earlier than their received business day
--   lots_received_in_future       lots whose received business day is later than today's Cambodia date plus one day (clock skew allowance)
--   Info columns:
--   lots_active                   the lots read
--   lots_with_expiry              lots carrying an expiry date
--   expired_lots_with_stock       lots holding stock whose expiry date is before today (Cambodia): stock the shop should not sell
--   expired_units_on_hand         the units on those lots
--   expiry_within_30_days_lots    lots holding stock that expire within the next 30 days
--   examples                      up to 5 [lot_id, product_id, received_at, expiry_date, kind] over the zero-expected kinds, lowest lot id first
-- Measured cost: one pass over product_batches (day text evaluated once per row) and one over positive branch_batch_stock; see the scale test output
-- (test-audit-b-scale-workerd.cjs).
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero lots_received_unparseable,lots_expiry_unparseable,lots_expiry_before_received,lots_received_in_future
WITH pos AS MATERIALIZED (
  SELECT batch_id, SUM(quantity) AS q FROM branch_batch_stock WHERE quantity > 0 GROUP BY batch_id
), lt AS MATERIALIZED (
  SELECT b.id AS id, b.variant_product_id AS p, b.received_at AS received_at, b.expiry_date AS expiry_date,
    CASE WHEN trim(b.received_at) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN trim(b.received_at) WHEN substr(trim(b.received_at),1,10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(trim(b.received_at),11,2) GLOB '[T ][0-9]' AND NOT substr(trim(b.received_at),13) GLOB '*[^!-~]*' THEN date(trim(b.received_at), '+7 hours') WHEN date(CASE WHEN trim(b.received_at) GLOB '[0-9][0-9]/[0-9][0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),7,4)||'-'||substr(trim(b.received_at),1,2)||'-'||substr(trim(b.received_at),4,2) WHEN trim(b.received_at) GLOB '[0-9]/[0-9][0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),6,4)||'-0'||substr(trim(b.received_at),1,1)||'-'||substr(trim(b.received_at),3,2) WHEN trim(b.received_at) GLOB '[0-9][0-9]/[0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),6,4)||'-'||substr(trim(b.received_at),1,2)||'-0'||substr(trim(b.received_at),4,1) WHEN trim(b.received_at) GLOB '[0-9]/[0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),5,4)||'-0'||substr(trim(b.received_at),1,1)||'-0'||substr(trim(b.received_at),3,1) END)=CASE WHEN trim(b.received_at) GLOB '[0-9][0-9]/[0-9][0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),7,4)||'-'||substr(trim(b.received_at),1,2)||'-'||substr(trim(b.received_at),4,2) WHEN trim(b.received_at) GLOB '[0-9]/[0-9][0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),6,4)||'-0'||substr(trim(b.received_at),1,1)||'-'||substr(trim(b.received_at),3,2) WHEN trim(b.received_at) GLOB '[0-9][0-9]/[0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),6,4)||'-'||substr(trim(b.received_at),1,2)||'-0'||substr(trim(b.received_at),4,1) WHEN trim(b.received_at) GLOB '[0-9]/[0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),5,4)||'-0'||substr(trim(b.received_at),1,1)||'-0'||substr(trim(b.received_at),3,1) END THEN CASE WHEN trim(b.received_at) GLOB '[0-9][0-9]/[0-9][0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),7,4)||'-'||substr(trim(b.received_at),1,2)||'-'||substr(trim(b.received_at),4,2) WHEN trim(b.received_at) GLOB '[0-9]/[0-9][0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),6,4)||'-0'||substr(trim(b.received_at),1,1)||'-'||substr(trim(b.received_at),3,2) WHEN trim(b.received_at) GLOB '[0-9][0-9]/[0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),6,4)||'-'||substr(trim(b.received_at),1,2)||'-0'||substr(trim(b.received_at),4,1) WHEN trim(b.received_at) GLOB '[0-9]/[0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),5,4)||'-0'||substr(trim(b.received_at),1,1)||'-0'||substr(trim(b.received_at),3,1) END END AS day,
    CASE WHEN trim(COALESCE(b.expiry_date, '')) = '' THEN NULL ELSE date(substr(trim(b.expiry_date), 1, 10)) END AS ex,
    trim(COALESCE(b.expiry_date, '')) AS ex_raw,
    COALESCE(pos.q, 0) AS q
  FROM product_batches b
  LEFT JOIN pos ON pos.batch_id = b.id
  WHERE b.is_active = 1
), today AS (
  SELECT date('now', '+7 hours') AS d
), bad AS MATERIALIZED (
  SELECT id, p, received_at, expiry_date,
    CASE WHEN day IS NULL THEN 'received_unparseable'
         WHEN ex_raw <> '' AND ex IS NULL THEN 'expiry_unparseable'
         WHEN ex IS NOT NULL AND ex < day THEN 'expiry_before_received'
         WHEN day > (SELECT date(d, '+1 day') FROM today) THEN 'received_in_future' END AS kind
  FROM lt
)
SELECT
  (SELECT COUNT(*) FROM lt WHERE day IS NULL) AS lots_received_unparseable,
  (SELECT COUNT(*) FROM lt WHERE ex_raw <> '' AND ex IS NULL) AS lots_expiry_unparseable,
  (SELECT COUNT(*) FROM lt WHERE ex IS NOT NULL AND day IS NOT NULL AND ex < day) AS lots_expiry_before_received,
  (SELECT COUNT(*) FROM lt WHERE day IS NOT NULL AND day > (SELECT date(d, '+1 day') FROM today)) AS lots_received_in_future,
  (SELECT COUNT(*) FROM lt) AS lots_active,
  (SELECT COUNT(*) FROM lt WHERE ex_raw <> '') AS lots_with_expiry,
  (SELECT COUNT(*) FROM lt WHERE q > 0 AND ex IS NOT NULL AND ex < (SELECT d FROM today)) AS expired_lots_with_stock,
  (SELECT COALESCE(SUM(q), 0) FROM lt WHERE q > 0 AND ex IS NOT NULL AND ex < (SELECT d FROM today)) AS expired_units_on_hand,
  (SELECT COUNT(*) FROM lt WHERE q > 0 AND ex IS NOT NULL AND ex >= (SELECT d FROM today) AND ex <= (SELECT date(d, '+30 days') FROM today)) AS expiry_within_30_days_lots,
  (SELECT COALESCE(json_group_array(json_array(id, p, received_at, expiry_date, kind)), '[]')
    FROM (SELECT id, p, received_at, expiry_date, kind FROM bad WHERE kind IS NOT NULL ORDER BY id LIMIT 5)) AS examples
