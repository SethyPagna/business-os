-- Finish the membership-points shutdown the owner asked for on Sep 4 2026.
--
-- Owner (Sep 4 2026): "zero all the membership points, make the membership
-- points on off in settings."
-- Owner (Sep 17 2026, P10-13): "some still have membership points not zeroed".
--
-- WHAT WAS LEFT UNDONE. Migration 0117 did the DATA half correctly: it
-- flipped the 48 sales that were still accruing, voided the adjustment and
-- share-reward ledgers, and recorded all of it in `loyalty_points_reset_log`
-- so it can be undone exactly. Its own header says the OTHER half -- the
-- master switch -- "is code (settings key `loyalty_points_enabled`)", and it
-- left writing that row to the Settings screen. The row was never written.
-- Every reader treats an ABSENT key as ON (routes/sales.ts:837,
-- routes/portal.ts:404, routes/notifications.ts:366,
-- lib/saleCustomerAssignmentGuard.ts:40), so the programme has been on the
-- whole time and every sale since Sep 4 has accrued again.
--
-- The state this repairs, measured in production on Sep 17 2026:
--   * settings.loyalty_points_enabled            -- 0 rows (absent = ON)
--   * customers holding points again             -- 78
--   * points held                                -- 6,815.5
--   * pre-reset sales still accruing             -- 0  (0117 held)
--   * un-voided adjustments / share rewards      -- 0  (0117 held)
-- So the whole residue is post-reset accrual through a switch that should
-- have been off. Nothing 0117 did has come undone.
--
-- WHY THE SWITCH GOES FIRST. Written before the data half below, so there is
-- no instant at which the ledgers are zero while the checkout is still
-- willing to accrue onto them.
--
-- WHY THIS IS NOT "UPDATE customers SET points = 0". There is no such column;
-- a balance is COMPUTED from five event sources on every lookup. 0117's
-- header explains the full formula and why only the three ADDING terms are
-- neutralised. This migration applies exactly the same rule to the rows that
-- have appeared since, and records them in the same log table under its own
-- reason, so the two resets can be undone independently.
--
-- SCOPE, precisely. `loyalty_accrual = 0` is flipped only on rows that are
-- still 1 -- never a blanket rewrite -- because an undo must restore exactly
-- what this changed and no more. Imported history is already 0 by deliberate
-- choice (the standing rule that historical sales never accrue) and must not
-- be handed points by a careless undo.
--
-- PRE ASSERTIONS (run read-only immediately before applying):
--   SELECT COUNT(*) FROM settings WHERE key = 'loyalty_points_enabled';   -- expected 0
--   SELECT COUNT(*) FROM sales WHERE COALESCE(loyalty_accrual, 1) = 1;    -- expected 190
--   SELECT COUNT(*) FROM loyalty_point_adjustments WHERE voided_at IS NULL;              -- expected 0
--   SELECT COUNT(*) FROM customer_share_submissions WHERE reward_points_voided_at IS NULL; -- expected 0
-- POST ASSERTIONS:
--   SELECT value FROM settings WHERE key = 'loyalty_points_enabled';      -- expected 'false'
--   SELECT COUNT(*) FROM sales WHERE COALESCE(loyalty_accrual, 1) = 1;    -- expected 0
--   SELECT COUNT(*) FROM loyalty_points_reset_log
--    WHERE reason = 'membership_points_switch_off_2026_09_17';            -- expected 1
--   -- and the computed balance, which must be 0 for every customer:
--   SELECT COUNT(*) FROM (
--     SELECT customer_id, SUM(COALESCE(total_usd,0)) - SUM(COALESCE(membership_points_redeemed,0)) AS pts
--       FROM sales WHERE customer_id IS NOT NULL AND COALESCE(loyalty_accrual,1) = 1
--        AND COALESCE(sale_status,'completed') <> 'cancelled'
--      GROUP BY customer_id HAVING pts > 0);                              -- expected 0

-- 1. The master switch the Sep 4 ask named. Written as the same string the
--    Settings screen writes ('true'/'false', LoyaltyPointsPage.tsx:516) so
--    the page reads its own state back correctly and the owner can turn the
--    programme on again from the UI without a migration.
INSERT INTO settings (key, value, updated_at)
VALUES ('loyalty_points_enabled', 'false', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = 'false', updated_at = CURRENT_TIMESTAMP;

-- 2. Record what is about to change, BEFORE changing it -- after the UPDATE
--    there is no way left to tell which sales this flipped and which were
--    already 0. Same shape and same undo contract as 0117's log row.
INSERT INTO loyalty_points_reset_log (reason, sales_reset_count, sales_reset_ids, adjustments_voided_count, submissions_voided_count, undo_sql)
SELECT
  'membership_points_switch_off_2026_09_17',
  (SELECT COUNT(*) FROM sales WHERE COALESCE(loyalty_accrual, 1) = 1),
  (SELECT group_concat(id) FROM sales WHERE COALESCE(loyalty_accrual, 1) = 1),
  (SELECT COUNT(*) FROM loyalty_point_adjustments WHERE voided_at IS NULL),
  (SELECT COUNT(*) FROM customer_share_submissions WHERE reward_points_voided_at IS NULL),
  'UPDATE sales SET loyalty_accrual = 1 WHERE id IN (SELECT value FROM json_each(''['' || (SELECT sales_reset_ids FROM loyalty_points_reset_log WHERE reason = ''membership_points_switch_off_2026_09_17'') || '']'')); UPDATE loyalty_point_adjustments SET voided_at = NULL, voided_reason = NULL WHERE voided_reason = ''membership_points_switch_off_2026_09_17''; UPDATE customer_share_submissions SET reward_points_voided_at = NULL, reward_points_voided_reason = NULL WHERE reward_points_voided_reason = ''membership_points_switch_off_2026_09_17''; DELETE FROM settings WHERE key = ''loyalty_points_enabled'';'
WHERE NOT EXISTS (
  SELECT 1 FROM loyalty_points_reset_log WHERE reason = 'membership_points_switch_off_2026_09_17'
);

-- 3. Sales stop earning again. The dominant term, and the one that produced
--    the 6,815.5 points the owner is still seeing.
UPDATE sales SET loyalty_accrual = 0 WHERE COALESCE(loyalty_accrual, 1) = 1;

-- 4. Hand-issued adjustments stop counting. None exist today; the statement
--    is here so an adjustment issued between this file being written and
--    being applied is not missed.
UPDATE loyalty_point_adjustments
   SET voided_at = CURRENT_TIMESTAMP, voided_reason = 'membership_points_switch_off_2026_09_17'
 WHERE voided_at IS NULL;

-- 5. Share-and-reward points stop counting. `reward_points` itself is left
--    intact so the submission still records what it was worth when approved.
UPDATE customer_share_submissions
   SET reward_points_voided_at = CURRENT_TIMESTAMP, reward_points_voided_reason = 'membership_points_switch_off_2026_09_17'
 WHERE reward_points_voided_at IS NULL;
