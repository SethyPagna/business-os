ALTER TABLE customer_share_submissions ADD COLUMN loyalty_eligible INTEGER NOT NULL DEFAULT 0 CHECK (loyalty_eligible IN (0,1));

-- Restore preserves captured birth flags; normal writes remain fenced while the old Worker serves traffic.
CREATE TRIGGER loyalty_sale_birth_off AFTER INSERT ON sales
WHEN (NOT (lower(trim(COALESCE((SELECT value FROM settings WHERE key = 'loyalty_points_enabled'), ''))) IN ('1','true','yes','on')) AND NOT (EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore'))) OR EXISTS (SELECT 1 FROM system_flags WHERE key = printf('loyalty_sale_earning:%d:%s',NEW.id,hex(NEW.client_request_id)) AND value = 'skipped')
BEGIN
  UPDATE sales SET loyalty_accrual = 0 WHERE id = NEW.id;
END;

CREATE TRIGGER loyalty_sale_birth_immutable BEFORE UPDATE OF loyalty_accrual ON sales
WHEN COALESCE(NEW.loyalty_accrual,1) <> 0 AND (COALESCE(OLD.loyalty_accrual,1) = 0 OR EXISTS (SELECT 1 FROM system_flags WHERE key = printf('loyalty_sale_earning:%d:%s',NEW.id,hex(NEW.client_request_id)) AND value = 'skipped'))
BEGIN
  SELECT RAISE(ABORT, 'loyalty_creation_eligibility_immutable');
END;

CREATE TRIGGER loyalty_sale_request_identity_immutable BEFORE UPDATE OF client_request_id ON sales
WHEN NEW.client_request_id IS NOT OLD.client_request_id
BEGIN
  SELECT RAISE(ABORT, 'loyalty_sale_identity_immutable');
END;

CREATE TRIGGER loyalty_sale_earning_on_insert AFTER INSERT ON sales
WHEN NEW.loyalty_accrual = 1 AND NULLIF(NEW.client_request_id,'') IS NOT NULL
  AND COALESCE(NULLIF(NEW.sale_status,''),'completed') NOT IN ('awaiting_payment','cancelled')
  AND ((lower(trim(COALESCE((SELECT value FROM settings WHERE key = 'loyalty_points_enabled'), ''))) IN ('1','true','yes','on')) OR EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')) AND NOT (EXISTS (SELECT 1 FROM system_flags WHERE key = printf('loyalty_sale_earning:%d:%s',NEW.id,hex(NEW.client_request_id)) AND value = 'skipped'))
BEGIN
  INSERT OR IGNORE INTO system_flags(key,value,updated_at)
    VALUES(printf('loyalty_sale_earning:%d:%s',NEW.id,hex(NEW.client_request_id)),'earned',CURRENT_TIMESTAMP);
END;

-- The first earning decision survives restoring an older unpaid sale snapshot.
CREATE TRIGGER loyalty_sale_first_earning AFTER UPDATE OF sale_status ON sales
WHEN NEW.loyalty_accrual = 1 AND COALESCE(NULLIF(NEW.sale_status,''),'completed') NOT IN ('awaiting_payment','cancelled') AND NOT (EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore'))
BEGIN
  INSERT OR IGNORE INTO system_flags(key,value,updated_at)
    SELECT printf('loyalty_sale_earning:%d:%s',NEW.id,hex(NEW.client_request_id)),CASE WHEN lower(trim(COALESCE((SELECT value FROM settings WHERE key = 'loyalty_points_enabled'), ''))) IN ('1','true','yes','on') THEN 'earned' ELSE 'skipped' END,CURRENT_TIMESTAMP
    WHERE NULLIF(NEW.client_request_id,'') IS NOT NULL OR NOT (lower(trim(COALESCE((SELECT value FROM settings WHERE key = 'loyalty_points_enabled'), ''))) IN ('1','true','yes','on'));
  UPDATE sales SET loyalty_accrual = 0 WHERE id = NEW.id AND EXISTS (SELECT 1 FROM system_flags WHERE key = printf('loyalty_sale_earning:%d:%s',NEW.id,hex(NEW.client_request_id)) AND value = 'skipped');
END;

CREATE TRIGGER loyalty_submission_birth_off AFTER INSERT ON customer_share_submissions
WHEN NOT (lower(trim(COALESCE((SELECT value FROM settings WHERE key = 'loyalty_points_enabled'), ''))) IN ('1','true','yes','on')) AND NOT (EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore'))
BEGIN
  UPDATE customer_share_submissions SET loyalty_eligible = 0 WHERE id = NEW.id;
END;

CREATE TRIGGER loyalty_submission_birth_immutable BEFORE UPDATE OF loyalty_eligible ON customer_share_submissions
WHEN NEW.loyalty_eligible <> OLD.loyalty_eligible AND NOT (OLD.loyalty_eligible = 1 AND NEW.loyalty_eligible = 0 AND NOT (lower(trim(COALESCE((SELECT value FROM settings WHERE key = 'loyalty_points_enabled'), ''))) IN ('1','true','yes','on')))
BEGIN
  SELECT RAISE(ABORT, 'loyalty_creation_eligibility_immutable');
END;

CREATE TRIGGER loyalty_award_on_insert BEFORE INSERT ON loyalty_point_adjustments
WHEN NEW.points > 0 AND NOT (lower(trim(COALESCE((SELECT value FROM settings WHERE key = 'loyalty_points_enabled'), ''))) IN ('1','true','yes','on')) AND NOT (EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore'))
BEGIN
  SELECT RAISE(ABORT, 'loyalty_points_disabled');
END;

CREATE TRIGGER loyalty_reward_on_update BEFORE UPDATE OF status, reward_points ON customer_share_submissions
WHEN NEW.status = 'approved' AND NEW.reward_points > 0
  AND (OLD.status <> 'approved' OR NEW.reward_points > OLD.reward_points)
  AND (NEW.loyalty_eligible <> 1
    OR NEW.id <= COALESCE((SELECT json_extract(value,'$.submissions') FROM system_flags WHERE key='loyalty_points_reset'),0)
    OR NOT (lower(trim(COALESCE((SELECT value FROM settings WHERE key = 'loyalty_points_enabled'), ''))) IN ('1','true','yes','on')))
  AND NOT (EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore'))
BEGIN
  SELECT RAISE(ABORT, 'loyalty_points_disabled');
END;

-- Reset existing loyalty without rewriting business history. AUTOINCREMENT IDs
-- distinguish creation from editable dates, approvals and later payments.
-- system_flags survives restore and cannot be edited through Settings.
-- Reapplying preserves the checkpoint, subsequent earnings and switch choice.
INSERT INTO settings (key, value, updated_at)
SELECT 'loyalty_points_enabled', 'false', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'loyalty_points_reset')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;

INSERT OR IGNORE INTO system_flags (key, value, updated_at)
SELECT 'loyalty_points_reset', json_object(
  'version', 1,
  'reset_at', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  'sales', (SELECT COALESCE(MAX(id), 0) FROM sales),
  'returns', (SELECT COALESCE(MAX(id), 0) FROM returns),
  'submissions', (SELECT COALESCE(MAX(id), 0) FROM customer_share_submissions),
  'adjustments', (SELECT COALESCE(MAX(id), 0) FROM loyalty_point_adjustments)
), CURRENT_TIMESTAMP;

INSERT INTO audit_logs (action, entity, details, table_name, record_id, new_value)
SELECT 'reset_data', 'system', json_object('section', 'loyalty', 'migration', '0251', 'checkpoint', json(value)),
  'system_flags', 'loyalty_points_reset', value
FROM system_flags WHERE key = 'loyalty_points_reset'
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs WHERE action = 'reset_data' AND entity = 'system'
      AND table_name = 'system_flags' AND record_id = 'loyalty_points_reset'
  );
