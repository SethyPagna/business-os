-- Same-day reopening is an appended segment, never an edit that clears a
-- historical close. Existing rows remain root segments with NULL parent.
ALTER TABLE shift_sessions ADD COLUMN parent_shift_id INTEGER
  REFERENCES shift_sessions(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE shift_sessions ADD COLUMN reopen_reason TEXT;
ALTER TABLE shift_sessions ADD COLUMN reopened_by_user_id INTEGER;
ALTER TABLE shift_sessions ADD COLUMN reopened_by_user_name TEXT;
ALTER TABLE shift_sessions ADD COLUMN cancelled_at TEXT;
ALTER TABLE shift_sessions ADD COLUMN cancelled_by_user_id INTEGER;
ALTER TABLE shift_sessions ADD COLUMN cancelled_by_user_name TEXT;
ALTER TABLE shift_sessions ADD COLUMN cancel_reason TEXT;

-- Keep the original once-per-day promise for roots while allowing a closed
-- root to have one linked continuation. Each segment can have at most one
-- child, producing a linear, append-only chain under concurrent requests.
DROP INDEX IF EXISTS idx_shift_sessions_account_day;
DROP INDEX IF EXISTS idx_shift_sessions_shop_day;
CREATE UNIQUE INDEX idx_shift_sessions_account_day
  ON shift_sessions(user_id, COALESCE(branch_id, -1), business_date)
  WHERE scope_mode = 'per_account' AND parent_shift_id IS NULL;
CREATE UNIQUE INDEX idx_shift_sessions_shop_day
  ON shift_sessions(COALESCE(branch_id, -1), business_date)
  WHERE scope_mode = 'shop_wide' AND parent_shift_id IS NULL;
CREATE UNIQUE INDEX idx_shift_sessions_parent
  ON shift_sessions(parent_shift_id) WHERE parent_shift_id IS NOT NULL;

CREATE TRIGGER shift_reopen_root_has_no_provenance
BEFORE INSERT ON shift_sessions
WHEN NEW.parent_shift_id IS NULL AND (
  NEW.reopen_reason IS NOT NULL OR NEW.reopened_by_user_id IS NOT NULL OR NEW.reopened_by_user_name IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'root shift cannot carry reopen provenance');
END;

CREATE TRIGGER shift_reopen_segment_validate_insert
BEFORE INSERT ON shift_sessions
WHEN NEW.parent_shift_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM system_flags
  WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore'
)
BEGIN
  SELECT CASE WHEN TRIM(COALESCE(NEW.reopen_reason, '')) = ''
      OR LENGTH(TRIM(NEW.reopen_reason)) > 500 OR NEW.reopened_by_user_id IS NULL
    THEN RAISE(ABORT, 'reopen reason and actor are required') END;
  SELECT CASE WHEN NEW.closed_at IS NOT NULL OR NEW.closing_counted_usd IS NOT NULL
      OR NEW.closing_counted_khr IS NOT NULL OR NEW.closing_note IS NOT NULL
    THEN RAISE(ABORT, 'reopen segment must start open') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM shift_sessions parent
    WHERE parent.id = NEW.parent_shift_id
      AND COALESCE(parent.cancelled_at, parent.closed_at) IS NOT NULL
      AND parent.user_id = NEW.user_id
      AND parent.scope_mode = NEW.scope_mode
      AND parent.business_date = NEW.business_date
      AND ((parent.branch_id IS NULL AND NEW.branch_id IS NULL) OR parent.branch_id = NEW.branch_id)
      AND NEW.opened_at >= COALESCE(parent.cancelled_at, parent.closed_at)
  ) THEN RAISE(ABORT, 'invalid reopen parent') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM shift_sessions child WHERE child.parent_shift_id = NEW.parent_shift_id
  ) THEN RAISE(ABORT, 'shift segment was already reopened') END;
END;

-- Lineage and reason/actor provenance never change after insertion.
CREATE TRIGGER shift_reopen_provenance_immutable
BEFORE UPDATE ON shift_sessions
WHEN OLD.parent_shift_id IS NOT NEW.parent_shift_id
  OR OLD.reopen_reason IS NOT NEW.reopen_reason
  OR OLD.reopened_by_user_id IS NOT NEW.reopened_by_user_id
  OR OLD.reopened_by_user_name IS NOT NEW.reopened_by_user_name
BEGIN
  SELECT RAISE(ABORT, 'shift reopen provenance is immutable');
END;

-- Later amendments cannot make either side of an existing link contradict
-- the closed-parent-before-open-child invariant.
CREATE TRIGGER shift_reopen_child_update_validate
BEFORE UPDATE ON shift_sessions
WHEN OLD.parent_shift_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM shift_sessions parent
    WHERE parent.id = OLD.parent_shift_id
      AND COALESCE(parent.cancelled_at, parent.closed_at) IS NOT NULL
      AND parent.user_id = NEW.user_id
      AND parent.scope_mode = NEW.scope_mode
      AND parent.business_date = NEW.business_date
      AND ((parent.branch_id IS NULL AND NEW.branch_id IS NULL) OR parent.branch_id = NEW.branch_id)
      AND NEW.opened_at >= COALESCE(parent.cancelled_at, parent.closed_at)
  ) THEN RAISE(ABORT, 'amendment breaks reopen lineage') END;
END;

CREATE TRIGGER shift_reopen_parent_update_validate
BEFORE UPDATE ON shift_sessions
WHEN EXISTS (SELECT 1 FROM shift_sessions child WHERE child.parent_shift_id = OLD.id)
BEGIN
  SELECT CASE WHEN COALESCE(NEW.cancelled_at, NEW.closed_at) IS NULL OR EXISTS (
    SELECT 1 FROM shift_sessions child
    WHERE child.parent_shift_id = OLD.id AND (
      child.user_id != NEW.user_id
      OR child.scope_mode != NEW.scope_mode
      OR child.business_date != NEW.business_date
      OR NOT ((child.branch_id IS NULL AND NEW.branch_id IS NULL) OR child.branch_id = NEW.branch_id)
      OR child.opened_at < COALESCE(NEW.cancelled_at, NEW.closed_at)
    )
  ) THEN RAISE(ABORT, 'amendment breaks reopened child') END;
END;

CREATE TRIGGER shift_cancel_validate_insert
BEFORE INSERT ON shift_sessions
WHEN NEW.cancelled_at IS NOT NULL AND (
  NEW.cancelled_by_user_id IS NULL OR TRIM(COALESCE(NEW.cancel_reason, '')) = ''
  OR LENGTH(TRIM(NEW.cancel_reason)) > 500
)
BEGIN
  SELECT RAISE(ABORT, 'cancel reason and actor are required');
END;

CREATE TRIGGER shift_cancel_validate_update
BEFORE UPDATE ON shift_sessions
WHEN NEW.cancelled_at IS NOT NULL AND (
  NEW.cancelled_by_user_id IS NULL OR TRIM(COALESCE(NEW.cancel_reason, '')) = ''
  OR LENGTH(TRIM(NEW.cancel_reason)) > 500
)
BEGIN
  SELECT RAISE(ABORT, 'cancel reason and actor are required');
END;

CREATE TRIGGER shift_cancel_original_details_immutable
BEFORE UPDATE ON shift_sessions
WHEN OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL AND (
  OLD.shift_code IS NOT NEW.shift_code OR OLD.scope_mode IS NOT NEW.scope_mode
  OR OLD.user_id IS NOT NEW.user_id OR OLD.user_name IS NOT NEW.user_name
  OR OLD.branch_id IS NOT NEW.branch_id OR OLD.branch_name IS NOT NEW.branch_name
  OR OLD.business_date IS NOT NEW.business_date OR OLD.opened_at IS NOT NEW.opened_at
  OR OLD.opening_float_usd IS NOT NEW.opening_float_usd OR OLD.opening_float_khr IS NOT NEW.opening_float_khr
  OR OLD.opening_note IS NOT NEW.opening_note OR OLD.closed_at IS NOT NEW.closed_at
  OR OLD.closing_counted_usd IS NOT NEW.closing_counted_usd OR OLD.closing_counted_khr IS NOT NEW.closing_counted_khr
  OR OLD.closing_note IS NOT NEW.closing_note OR OLD.closed_by_user_id IS NOT NEW.closed_by_user_id
  OR OLD.closed_by_user_name IS NOT NEW.closed_by_user_name
)
BEGIN
  SELECT RAISE(ABORT, 'cancelling cannot rewrite shift details');
END;

CREATE TRIGGER shift_cancel_provenance_immutable
BEFORE UPDATE ON shift_sessions
WHEN OLD.cancelled_at IS NOT NULL AND (
  OLD.cancelled_at IS NOT NEW.cancelled_at
  OR OLD.cancelled_by_user_id IS NOT NEW.cancelled_by_user_id
  OR OLD.cancelled_by_user_name IS NOT NEW.cancelled_by_user_name
  OR OLD.cancel_reason IS NOT NEW.cancel_reason
)
BEGIN
  SELECT RAISE(ABORT, 'shift cancellation is immutable');
END;
