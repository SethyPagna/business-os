-- forensics-completed-short-rows: the sales behind health-sale-money.completed_short, one row each
-- (DATA-MATCH DM-08 drill-down, lane 6.0.943). completed_short counts sales that read PAID
-- (lib/saleStatusResolution.ts saleStoredState: not Not Paid, not cancelled) and are not a historical
-- import, whose tender falls more than half a cent short of what they owe at the sale's own rate, after
-- the debt their active returns lowered (lib/returnRefundSplit.ts returnDebtLoweredSql), except a riel tender short by under
-- 100 riel, which is paid (owner ruling 27 Oct 2026; lib/saleStatusResolution.ts shortfallCovered). The CTE rr, the columns
-- of s the predicate reads and the WHERE of k are health-sale-money's own text; test-health-drilldown-rows-native.cjs
-- pins each fragment against the health query's text and asserts this list has exactly the rows that column counts.
-- Facts per sale, grouped by what each one confirms or refutes:
--   money                 total_usd, lowered_usd, owed_usd, paid_usd, paid_khr, tender_usd (paid_usd +
--                         paid_khr at the sale's rate), gap_usd (> 0.005 by construction), gap_khr
--   H1 half-cent edge     covered_by_worker_rule = 1: lib/saleStatusResolution.ts paymentCoversSaleTotalUnits (half a cent, or
--                         a riel tender short by under 100 riel, shortfallCovered)
--                         (exact integer units, 4 dp) calls it paid, so the health float rule over-flags
--   H2 return not netted  pre0260_refund_usd > 0 and gap_if_pre0260_netted <= 0.005: a return recorded
--                         before 0260 (refund_currency NULL) lowered the debt while the sale read Not
--                         Paid, the sale was then settled, and the row now reads as cash (the held 0265
--                         backfill would record it as cash too)
--   H3 return taken back  cancelled_lowered_usd > 0 and gap_if_cancelled_netted <= 0.005
--   H4 amended up         amendments / add_items_receipts / amendment_receipts > 0 with created_gap_usd <= 0.005
--                         and a first_amendment_total_before_usd the tender covered: the tender is frozen on an
--                         add-items or amendment (lib/saleLineAddition.ts DECISION 3), the status stays
--   H5 un-cancelled       uncancelled = 1 (a sale_status cancelled -> paid event): routes/sales.ts
--                         restores status_before_cancel, or completed when it is NULL, with no tender check
--   H6 legacy shape       money_precision_version 0 = pre-v1 (v1 is gated at creation), origin (creation
--                         snapshot: pos, offline_replay, stock_action_import, return_replacement; none =
--                         pre-snapshot), request_kind (client_request_id prefix only), business_day
--   H7 retired label      sale_status partial_return / returned with status_before_return NULL (any other
--                         status word, e.g. a legacy awaiting_delivery, also reads paid)
--   H8 settlement/undo    settlement_receipts, payment_events, last_event_kind / last_event_via
--   H9 other creators     origin stock_action_import / return_replacement write tender = total, so a
--                         positive on one means a later edit
--   last writer signal    updated_at, write_revision (sales writes), last_event_at (Sales Records),
--                         last_audit_at / last_audit_action (audit_logs entity sale)
-- Ids, dates, amounts and code-chosen tokens only: no customer, phone, note or free text. The list is
-- capped by LIMIT 201 against max-rows 200, so a longer list fails the check instead of truncating quietly.
-- ops:min-rows 0
-- ops:max-rows 200
WITH rr AS MATERIALIZED (
  SELECT sale_id, SUM(COALESCE(owed_reduction_usd, 0)) AS lowered
  FROM returns
  WHERE refund_currency IS NOT NULL AND COALESCE(return_scope, 'customer') = 'customer' AND COALESCE(status, 'completed') <> 'cancelled'
  GROUP BY sale_id
),
s AS MATERIALIZED (
  SELECT x.id,
    CASE WHEN x.sale_status = 'awaiting_payment' OR (x.sale_status IN ('partial_return', 'returned') AND x.status_before_return = 'awaiting_payment')
      THEN 'awaiting_payment' WHEN x.sale_status = 'cancelled' THEN 'cancelled' ELSE 'completed' END AS pay,
    COALESCE(x.total_usd, 0) AS total, x.exchange_rate AS rate,
    COALESCE(x.amount_paid_usd, 0) AS paid_usd, COALESCE(x.amount_paid_khr, 0) AS paid_khr,
    CASE WHEN COALESCE(x.legacy_receipt_number, '') <> '' OR (x.client_request_id >= 'sales-import:' AND x.client_request_id < 'sales-import;') THEN 1 ELSE 0 END AS imported,
    COALESCE(r.lowered, 0) AS lowered
  FROM sales x LEFT JOIN rr r ON r.sale_id = x.id
),
k AS MATERIALIZED (
  SELECT id, total, rate, paid_usd, paid_khr, lowered FROM s
  WHERE pay = 'completed' AND imported = 0 AND rate > 0 AND total - lowered - paid_usd - paid_khr / rate > 0.005000001 AND NOT (paid_khr > 0 AND (total - lowered - paid_usd) * rate - paid_khr < 99.9999)
),
f AS MATERIALIZED (
  SELECT k.id, k.total, k.rate, k.paid_usd, k.paid_khr, k.lowered,
    x.created_at, x.updated_at, x.sale_status, x.status_before_return, x.return_state, x.payment_currency,
    COALESCE(x.money_precision_version, 0) AS mpv,
    CASE WHEN json_valid(x.creation_snapshot_json) THEN json_extract(x.creation_snapshot_json, '$.origin') END AS origin,
    CASE WHEN json_valid(x.creation_snapshot_json) THEN json_extract(x.creation_snapshot_json, '$.total_usd') END AS created_total,
    CASE WHEN json_valid(x.creation_snapshot_json) THEN json_extract(x.creation_snapshot_json, '$.amount_paid_usd') END AS created_paid_usd,
    CASE WHEN json_valid(x.creation_snapshot_json) THEN json_extract(x.creation_snapshot_json, '$.amount_paid_khr') END AS created_paid_khr,
    CASE WHEN json_valid(x.creation_snapshot_json) THEN json_extract(x.creation_snapshot_json, '$.sale_status') END AS created_status,
    CASE WHEN COALESCE(x.client_request_id, '') = '' THEN 'none'
      WHEN instr(x.client_request_id, ':') BETWEEN 2 AND 25 AND substr(x.client_request_id, 1, instr(x.client_request_id, ':') - 1) NOT GLOB '*[^a-z-]*'
        THEN substr(x.client_request_id, 1, instr(x.client_request_id, ':') - 1) ELSE 'opaque' END AS request_kind
  FROM k CROSS JOIN sales x ON x.id = k.id
),
rs AS MATERIALIZED (
  SELECT r.sale_id,
    SUM(CASE WHEN COALESCE(r.status, 'completed') <> 'cancelled' THEN 1 ELSE 0 END) AS active_n,
    SUM(CASE WHEN COALESCE(r.status, 'completed') = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_n,
    SUM(CASE WHEN COALESCE(r.status, 'completed') <> 'cancelled' AND r.refund_currency IS NULL THEN COALESCE(r.total_refund_usd, 0) ELSE 0 END) AS pre0260_usd,
    SUM(CASE WHEN COALESCE(r.status, 'completed') = 'cancelled' AND r.refund_currency IS NOT NULL THEN COALESCE(r.owed_reduction_usd, 0) ELSE 0 END) AS cancelled_lowered_usd
  FROM k CROSS JOIN returns r ON r.sale_id = k.id
  WHERE COALESCE(r.return_scope, 'customer') = 'customer'
  GROUP BY r.sale_id
)
SELECT
  f.id AS sale_id, date(f.created_at, '+7 hours') AS business_day, f.created_at,
  CASE WHEN f.origin GLOB '*[^a-z_]*' OR length(f.origin) > 24 THEN 'unrecognised' ELSE COALESCE(f.origin, 'none') END AS origin,
  f.request_kind, f.mpv AS money_precision_version,
  f.sale_status, f.status_before_return, f.return_state, f.payment_currency,
  CASE WHEN f.paid_usd > 0 AND f.paid_khr > 0 THEN 'both' WHEN f.paid_khr > 0 THEN 'khr' WHEN f.paid_usd > 0 THEN 'usd' ELSE 'none' END AS tender_mix,
  f.rate AS exchange_rate,
  f.total AS total_usd, f.lowered AS lowered_usd, ROUND(f.total - f.lowered, 4) AS owed_usd,
  f.paid_usd, f.paid_khr, ROUND(f.paid_usd + f.paid_khr / f.rate, 4) AS tender_usd,
  ROUND(f.total - f.lowered - f.paid_usd - f.paid_khr / f.rate, 6) AS gap_usd,
  ROUND((f.total - f.lowered - f.paid_usd - f.paid_khr / f.rate) * f.rate, 2) AS gap_khr,
  CASE WHEN (CAST(ROUND(f.total * 10000) AS INTEGER) - CAST(ROUND(f.lowered * 10000) AS INTEGER) - CAST(ROUND(f.paid_usd * 10000) AS INTEGER)) * CAST(ROUND(f.rate * 10000) AS INTEGER)
    - CAST(ROUND(f.paid_khr * 10000) AS INTEGER) * 10000 <= 50 * CAST(ROUND(f.rate * 10000) AS INTEGER)
    OR (f.paid_khr > 0 AND (CAST(ROUND(f.total * 10000) AS INTEGER) - CAST(ROUND(f.lowered * 10000) AS INTEGER) - CAST(ROUND(f.paid_usd * 10000) AS INTEGER)) * CAST(ROUND(f.rate * 10000) AS INTEGER)
      - CAST(ROUND(f.paid_khr * 10000) AS INTEGER) * 10000 < 1000000 * 10000) THEN 1 ELSE 0 END AS covered_by_worker_rule,
  COALESCE(rs.active_n, 0) AS returns_active, COALESCE(rs.cancelled_n, 0) AS returns_cancelled,
  COALESCE(rs.pre0260_usd, 0) AS pre0260_refund_usd,
  ROUND(f.total - f.lowered - f.paid_usd - f.paid_khr / f.rate - COALESCE(rs.pre0260_usd, 0), 6) AS gap_if_pre0260_netted,
  COALESCE(rs.cancelled_lowered_usd, 0) AS cancelled_lowered_usd,
  ROUND(f.total - f.lowered - f.paid_usd - f.paid_khr / f.rate - COALESCE(rs.cancelled_lowered_usd, 0), 6) AS gap_if_cancelled_netted,
  f.created_status, f.created_total AS created_total_usd, f.created_paid_usd, f.created_paid_khr,
  ROUND(f.created_total - f.created_paid_usd - f.created_paid_khr / f.rate, 6) AS created_gap_usd,
  (SELECT COUNT(*) FROM sale_amendments a WHERE a.sale_id = f.id) AS amendments,
  (SELECT a.kind FROM sale_amendments a WHERE a.sale_id = f.id ORDER BY a.id DESC LIMIT 1) AS last_amendment_kind,
  (SELECT a.created_at FROM sale_amendments a WHERE a.sale_id = f.id ORDER BY a.id DESC LIMIT 1) AS last_amendment_at,
  (SELECT a.total_before_usd FROM sale_amendments a WHERE a.sale_id = f.id ORDER BY a.id LIMIT 1) AS first_amendment_total_before_usd,
  (SELECT a.total_after_usd FROM sale_amendments a WHERE a.sale_id = f.id ORDER BY a.id DESC LIMIT 1) AS last_amendment_total_after_usd,
  (SELECT COUNT(*) FROM sale_mutation_receipts m WHERE m.sale_id = f.id AND m.mutation_kind = 'add_items') AS add_items_receipts,
  (SELECT COUNT(*) FROM sale_mutation_receipts m WHERE m.sale_id = f.id AND m.mutation_kind = 'amendment') AS amendment_receipts,
  (SELECT COUNT(*) FROM sale_mutation_receipts m WHERE m.sale_id = f.id AND m.mutation_kind = 'settlement') AS settlement_receipts,
  (SELECT COUNT(*) FROM sale_record_events e WHERE e.sale_id = f.id AND e.kind IN ('payment_changed', 'payment_settled')) AS payment_events,
  EXISTS (SELECT 1 FROM sale_record_events e, json_each(e.changes_json) c WHERE e.sale_id = f.id
    AND json_extract(c.value, '$.field') = 'sale_status' AND json_extract(c.value, '$.before.value') = 'cancelled') AS uncancelled,
  (SELECT e.kind FROM sale_record_events e WHERE e.sale_id = f.id ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1) AS last_event_kind,
  (SELECT e.via FROM sale_record_events e WHERE e.sale_id = f.id ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1) AS last_event_via,
  (SELECT e.occurred_at FROM sale_record_events e WHERE e.sale_id = f.id ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1) AS last_event_at,
  f.updated_at, COALESCE((SELECT w.revision FROM sale_write_revisions w WHERE w.sale_id = f.id), 0) AS write_revision,
  (SELECT COUNT(*) FROM audit_logs a WHERE a.entity = 'sale' AND a.entity_id = CAST(f.id AS TEXT)) AS audit_rows,
  (SELECT a.created_at FROM audit_logs a WHERE a.entity = 'sale' AND a.entity_id = CAST(f.id AS TEXT) ORDER BY a.id DESC LIMIT 1) AS last_audit_at,
  (SELECT CASE WHEN a.action GLOB '*[^a-z_]*' THEN 'unrecognised' ELSE a.action END FROM audit_logs a
    WHERE a.entity = 'sale' AND a.entity_id = CAST(f.id AS TEXT) ORDER BY a.id DESC LIMIT 1) AS last_audit_action
FROM f LEFT JOIN rs ON rs.sale_id = f.id
ORDER BY f.id
LIMIT 201
