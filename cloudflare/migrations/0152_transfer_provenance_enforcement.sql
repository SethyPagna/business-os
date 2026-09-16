-- PRE: freeze production writes through the existing maintenance gate; record
-- stock and receipt counts/sums. Apply with 0151 before opening writes again.
-- POST: balances and legacy receipts unchanged; new default-0 receipts rejected.
-- RECOVERY: retain this guard on code rollback. Old Workers cannot safely move
-- stock while it is installed. Restore legacy rows only under tokened restore.
CREATE TRIGGER transfer_receipts_require_provenance_insert
BEFORE INSERT ON transfer_operation_receipts
WHEN COALESCE(NEW.provenance_version,0)<>1
 AND NOT EXISTS(
   SELECT 1 FROM system_flags WHERE key='maintenance'
   AND json_extract(CASE WHEN json_valid(value) THEN value ELSE '{}' END,'$.mode')='restore'
   AND json_type(CASE WHEN json_valid(value) THEN value ELSE '{}' END,'$.token')='text'
   AND length(trim(COALESCE(json_extract(CASE WHEN json_valid(value) THEN value ELSE '{}' END,'$.token'),'')))>0
   AND COALESCE(json_extract(CASE WHEN json_valid(value) THEN value ELSE '{}' END,'$.backupKey'),'') NOT LIKE 'deployment:%'
 )
BEGIN SELECT RAISE(ABORT,'transfer provenance version 1 required: upgrade Worker'); END;

-- Close the 0151-to-0152 history gap only for structurally identified legacy
-- transfers. Exact new receipts retain server replay. Never infer from labels
-- or anonymous legacy payloads; existing legacy receipt rows remain untouched.
UPDATE action_history SET reversible=0,status='recorded'
WHERE (entity IN ('stock_transfer','stock_transfers')
 OR (scope IN ('branches','inventory') AND json_extract(CASE WHEN json_valid(undo_payload) THEN undo_payload ELSE '{}' END,'$.type')='transfer'))
 AND NOT EXISTS(SELECT 1 FROM transfer_operation_receipts r
   WHERE r.action_history_id=action_history.id AND r.provenance_version=1);
