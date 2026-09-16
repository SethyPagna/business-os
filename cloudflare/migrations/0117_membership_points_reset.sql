-- Zero every membership-points balance in the system.
--
-- Ask (user, Sep 4 2026): "zero all the membership points, make the membership
-- points on off in settings." The switch is code (settings key
-- `loyalty_points_enabled`, honoured by summarizePoints and by the checkout
-- re-validation). This migration is the other half: the DATA reset.
--
-- WHY THIS IS NOT "UPDATE customers SET points = 0". There is no such column.
-- `customers` stores only `membership_number`; a balance is COMPUTED on every
-- lookup from five independent event sources (portal.ts summarizePoints):
--
--     balance = max(0, earned - deducted - redeemed + rewarded + adjusted)
--
--     earned    SUM(sales.total)   WHERE COALESCE(loyalty_accrual,1)=1
--                                    AND sale_status NOT IN (cancelled, awaiting_payment)
--     deducted  SUM(returns refunds)
--     redeemed  SUM(sales.membership_points_redeemed)
--     rewarded  SUM(customer_share_submissions.reward_points) WHERE status='approved'
--     adjusted  SUM(loyalty_point_adjustments.points)
--
-- 0028's own header says so: "Balances remain calculated from immutable events
-- rather than stored as a mutable customer total." So a reset has to neutralise
-- the three terms that ADD. `deducted` and `redeemed` only subtract, and the
-- formula floors at zero, so they are left completely alone -- rewriting them
-- would destroy the record of what customers actually spent for no effect on
-- the result.
--
-- WHY VOID COLUMNS INSTEAD OF DELETE. `loyalty_point_adjustments.points`
-- carries CHECK (points > 0), so a compensating negative row is not merely
-- discouraged here, it is impossible -- the schema rejects it. That leaves
-- deleting the ledger, which destroys an audit trail an administrator issued
-- by hand, or marking it. This marks it: every voided row is still readable,
-- still says who issued it and when, and a single UPDATE clearing `voided_at`
-- restores every balance exactly. The reset is recorded rather than silent.
--
-- REVERSIBILITY, precisely. `loyalty_points_reset_log` stores the id list of
-- the sales this migration flipped -- NOT "all sales", because ~15k rows
-- include imported history that was ALREADY non-accruing (loyalty_accrual = 0
-- by deliberate choice: legacy imports, the Sep-2/3 batch, POS opt-outs). Undo
-- must restore exactly the rows this changed and no others, or it would grant
-- points to history that never earned any -- the standing rule that historical
-- sales never accrue. Undo is in the log row's own `undo_sql` column.
--
-- READ THAT SCOPING CAREFULLY BEFORE CALLING IT NARROWER THAN APPROVED. The
-- ask the owner approved was described as zeroing every historical balance,
-- and this touches only the rows that were still accruing. Those are the same
-- thing GOING FORWARD -- a row already at 0 contributes 0 to `earned` either
-- way, so every balance lands at zero regardless. The difference is only in
-- what an undo can resurrect: a blanket flip to 1 would hand points to
-- imported history that never earned any and cannot be told apart afterwards.
-- Narrower in what it can wrongly restore, identical in what it zeroes.
--
-- KNOWN DRIFT THIS RESET WILL HIDE -- someone needs to own this separately.
-- Four sites compute a points balance independently. Three of them apply the
-- formula above in full. The fourth, `buildLoyaltySection` in
-- cloudflare/src/routes/notifications.ts (~line 349, the "N customers reached
-- X+ points" alert), queries sales, returns and share rewards only: it OMITS
-- the `adjusted` term entirely, so its balance already disagrees with the
-- customer portal, the contacts table and the POS today. That is pre-existing
-- and out of this migration's scope.
--
-- The trap: after this runs, all four sites read zero, so the disagreement
-- becomes unobservable. It returns the first time anyone issues a new manual
-- adjustment -- at which point nothing will connect it to this reset. It is
-- recorded here, in the session log Part entry and on the progress.md board so
-- it is found by someone looking at the reset rather than only by accident.

CREATE TABLE IF NOT EXISTS loyalty_points_reset_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reset_at TEXT DEFAULT CURRENT_TIMESTAMP,
  reason TEXT NOT NULL,
  sales_reset_count INTEGER NOT NULL DEFAULT 0,
  sales_reset_ids TEXT,
  adjustments_voided_count INTEGER NOT NULL DEFAULT 0,
  submissions_voided_count INTEGER NOT NULL DEFAULT 0,
  undo_sql TEXT
);

-- Void markers. Nullable with no default, so the ALTER is instant on D1 and
-- every existing row reads as "not voided" until this migration says otherwise.
ALTER TABLE loyalty_point_adjustments ADD COLUMN voided_at TEXT;
ALTER TABLE loyalty_point_adjustments ADD COLUMN voided_reason TEXT;
ALTER TABLE customer_share_submissions ADD COLUMN reward_points_voided_at TEXT;
ALTER TABLE customer_share_submissions ADD COLUMN reward_points_voided_reason TEXT;

-- Record what is about to change, BEFORE changing it. Written first on purpose:
-- after the UPDATE below there is no way left to tell which sales this
-- migration flipped and which were already zero.
INSERT INTO loyalty_points_reset_log (reason, sales_reset_count, sales_reset_ids, adjustments_voided_count, submissions_voided_count, undo_sql)
SELECT
  'membership_points_reset_2026_09_04',
  (SELECT COUNT(*) FROM sales WHERE COALESCE(loyalty_accrual, 1) = 1),
  (SELECT group_concat(id) FROM sales WHERE COALESCE(loyalty_accrual, 1) = 1),
  (SELECT COUNT(*) FROM loyalty_point_adjustments WHERE voided_at IS NULL),
  (SELECT COUNT(*) FROM customer_share_submissions WHERE reward_points_voided_at IS NULL AND status = 'approved'),
  'UPDATE sales SET loyalty_accrual = 1 WHERE id IN (SELECT value FROM json_each(''['' || (SELECT sales_reset_ids FROM loyalty_points_reset_log WHERE reason = ''membership_points_reset_2026_09_04'') || '']'')); UPDATE loyalty_point_adjustments SET voided_at = NULL, voided_reason = NULL WHERE voided_reason = ''membership_points_reset_2026_09_04''; UPDATE customer_share_submissions SET reward_points_voided_at = NULL, reward_points_voided_reason = NULL WHERE reward_points_voided_reason = ''membership_points_reset_2026_09_04'';';

-- 1. Sales stop earning. This is the dominant term and the one the owner named.
UPDATE sales SET loyalty_accrual = 0 WHERE COALESCE(loyalty_accrual, 1) = 1;

-- 2. Hand-issued adjustments stop counting.
UPDATE loyalty_point_adjustments
   SET voided_at = CURRENT_TIMESTAMP, voided_reason = 'membership_points_reset_2026_09_04'
 WHERE voided_at IS NULL;

-- 3. Share-and-reward points stop counting. `reward_points` itself is left
--    intact so the submission still records what it was worth when approved.
UPDATE customer_share_submissions
   SET reward_points_voided_at = CURRENT_TIMESTAMP, reward_points_voided_reason = 'membership_points_reset_2026_09_04'
 WHERE reward_points_voided_at IS NULL;
