-- AUDIT-LOG-ORG: the audit page pages by keyset over (created_at, id) inside a bounded
-- time window (routes/compat.ts via lib/auditLogPage.ts), and its per-user scope filters
-- on user_id. audit_logs.id is the rowid, so an index on created_at already orders by
-- (created_at, id) for the keyset walk. 0196 indexes (entity, entity_id) and
-- (action, created_at); neither serves an unfiltered time walk or a per-user walk.
--
-- Purely additive and idempotent: CREATE INDEX IF NOT EXISTS on existing columns. No
-- row is read back or changed; only query plans change. Without it the page is still
-- correct (the sargable created_at prefilter just scans), it only costs more reads.
--
-- Pre-assert:  SELECT COUNT(*) FROM sqlite_master WHERE type='index'
--                AND name IN ('idx_audit_logs_created','idx_audit_logs_user_created')
--              -- expected 0; also SELECT COUNT(*) FROM audit_logs (record it).
-- Post-assert: the same sqlite_master query -> 2; SELECT COUNT(*) FROM audit_logs unchanged.
-- Deploy order: EITHER. No code names these indexes; the planner picks them up.
-- Recovery:    DROP INDEX IF EXISTS idx_audit_logs_created;
--              DROP INDEX IF EXISTS idx_audit_logs_user_created;
--              removes only the seek paths, never data.

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created ON audit_logs(user_id, created_at);
