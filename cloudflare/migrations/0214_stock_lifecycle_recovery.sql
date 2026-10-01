CREATE TABLE stock_lifecycle_recovery_context(
 token TEXT PRIMARY KEY,
 table_name TEXT NOT NULL CHECK(table_name IN ('stock_disposition_sources','stock_funding_sources','stock_valuation_sources')),
 source_ids TEXT NOT NULL CHECK(json_valid(source_ids) AND json_type(source_ids)='array' AND json_array_length(source_ids)>0),
 maintenance_json TEXT NOT NULL CHECK(json_valid(maintenance_json))
);
CREATE TRIGGER stock_lifecycle_recovery_context_owned BEFORE INSERT ON stock_lifecycle_recovery_context
 WHEN EXISTS(SELECT 1 FROM stock_lifecycle_recovery_context)
 OR NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance' AND value=NEW.maintenance_json
 AND json_extract(value,'$.mode')='restore' AND json_extract(value,'$.token')=NEW.token)
 BEGIN SELECT RAISE(ABORT,'stock_recovery_owner_changed'); END;
CREATE TRIGGER stock_lifecycle_recovery_context_no_update BEFORE UPDATE ON stock_lifecycle_recovery_context
 BEGIN SELECT RAISE(ABORT,'stock_recovery_context_immutable'); END;
CREATE TRIGGER stock_lifecycle_recovery_context_enter AFTER INSERT ON stock_lifecycle_recovery_context
 BEGIN INSERT INTO system_flags(key,value,updated_at) VALUES('stock_lifecycle_recovery_admission',NEW.token,CURRENT_TIMESTAMP); END;
CREATE TRIGGER stock_lifecycle_recovery_context_leave AFTER DELETE ON stock_lifecycle_recovery_context
 BEGIN DELETE FROM system_flags WHERE key='stock_lifecycle_recovery_admission' AND value=OLD.token; END;
CREATE TRIGGER stock_lifecycle_recovery_v1_admission BEFORE INSERT ON stock_disposition_sources
 WHEN EXISTS(SELECT 1 FROM stock_lifecycle_recovery_context)
 AND NOT EXISTS(SELECT 1 FROM stock_lifecycle_recovery_context x,json_each(x.source_ids) j
 WHERE x.table_name='stock_disposition_sources' AND j.value=NEW.id
 AND NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance'))
 BEGIN SELECT RAISE(ABORT,'stock_recovery_scope_mismatch'); END;
CREATE TRIGGER stock_lifecycle_recovery_funding_admission BEFORE INSERT ON stock_funding_sources
 WHEN EXISTS(SELECT 1 FROM stock_lifecycle_recovery_context)
 AND NOT EXISTS(SELECT 1 FROM stock_lifecycle_recovery_context x,json_each(x.source_ids) j
 WHERE x.table_name='stock_funding_sources' AND j.value=NEW.id
 AND NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance'))
 BEGIN SELECT RAISE(ABORT,'stock_recovery_scope_mismatch'); END;
