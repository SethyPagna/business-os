-- SCAN1 M2: shifts whose drawer expectation took each refund out twice.
-- lib/shiftReconciliation.ts shiftRefunds summed total_refund_usd AND
-- total_refund_khr and subtracted both, but total_refund_khr is the riel
-- equivalent of the same refund (customerReturnEntitlement: multiplyMoney4(usd,
-- rate); the legacy path sums the sale lines' riel twins). A shift whose window
-- held such a return showed expected riel too low by the twin, so its riel
-- difference read as a surplus (or hid a real shortage).
-- Nothing is STORED wrong: shift_sessions has no expected/difference column and
-- every app surface recomputes on read, so the app corrects itself once the fix
-- is live. The Telegram shift reports already sent for these shifts (close,
-- cancel, amend, reopen) cannot be corrected.
-- Window = shiftFilters + salesAnalytics.shiftWindowWhere: returns.created_at in
-- [opened_at, closed_at or cancelled_at), the shift's branch when it has one,
-- and the shift's cashier unless the shift is shop_wide.
-- Counts and dates only: no cash figures, names or notes.
--   ended_shifts               shifts that were closed or cancelled
--   affected_shifts            ... whose window held a customer return with a riel twin
--   affected_closed_shifts     ... of those, closed (the close sent the Telegram report)
--   affected_with_riel_count   ... of those, a riel count was entered, so the
--                              difference line printed a phantom riel figure
--   affected_returns           distinct returns inside an affected window
--   riel_only_returns          PRECONDITION for the dollars-only fixes: customer
--                              returns with no dollar refund but a riel figure.
--                              Must be 0; any such row is a refund the fixed
--                              drawer no longer subtracts and the Reports hub
--                              (M3, refund_usd only) shows as $0.00.
--   first_affected_date, last_affected_date   business_date range
-- Proposed repair (NOT run): none to stored data -- the fixed loader recomputes
-- every affected shift correctly once deployed. Tell the owner how many closed
-- shifts' Telegram reports carried a wrong riel expected/difference, and over
-- which dates. If riel_only_returns is ever non-zero, stop: those returns need
-- an owner decision before the dollars-only drawer and report ship.
-- Proof: cloudflare/scripts/test-forensics-m2-shift-refund-twin-pure.cjs
-- ops:min-rows 1
-- ops:max-rows 1
WITH ended AS (
  SELECT s.id, s.business_date, s.branch_id, s.user_id, s.closed_at, s.closing_counted_khr,
    COALESCE(s.scope_mode, 'per_account') AS scope_mode,
    datetime(s.opened_at) AS win_from,
    datetime(COALESCE(s.closed_at, s.cancelled_at)) AS win_to
  FROM shift_sessions s
  WHERE s.closed_at IS NOT NULL OR s.cancelled_at IS NOT NULL
),
hit AS (
  SELECT ended.id AS shift_id, r.id AS return_id
  FROM ended JOIN returns r
    ON datetime(r.created_at) >= ended.win_from AND datetime(r.created_at) < ended.win_to
   AND (ended.branch_id IS NULL OR r.branch_id = ended.branch_id)
   AND (ended.scope_mode = 'shop_wide' OR r.cashier_id = ended.user_id)
  WHERE COALESCE(r.status, 'completed') <> 'cancelled'
    AND COALESCE(r.return_scope, 'customer') = 'customer'
    AND COALESCE(r.total_refund_khr, 0) <> 0
),
affected AS (
  SELECT ended.* FROM ended WHERE ended.id IN (SELECT shift_id FROM hit)
)
SELECT
  (SELECT COUNT(*) FROM ended) AS ended_shifts,
  (SELECT COUNT(*) FROM affected) AS affected_shifts,
  (SELECT COUNT(*) FROM affected WHERE closed_at IS NOT NULL) AS affected_closed_shifts,
  (SELECT COUNT(*) FROM affected WHERE closed_at IS NOT NULL AND closing_counted_khr IS NOT NULL) AS affected_with_riel_count,
  (SELECT COUNT(DISTINCT return_id) FROM hit) AS affected_returns,
  (SELECT COUNT(*) FROM returns
    WHERE COALESCE(return_scope, 'customer') = 'customer' AND COALESCE(status, 'completed') <> 'cancelled'
      AND COALESCE(total_refund_usd, 0) = 0 AND COALESCE(total_refund_khr, 0) <> 0) AS riel_only_returns,
  (SELECT MIN(business_date) FROM affected) AS first_affected_date,
  (SELECT MAX(business_date) FROM affected) AS last_affected_date
