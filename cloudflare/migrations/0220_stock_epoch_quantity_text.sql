CREATE TRIGGER stock_epoch_sources_quantity_bytes_insert BEFORE INSERT ON stock_epoch_sources
WHEN instr(CAST(NEW.quantity AS BLOB),x'00')>0 OR instr(CAST(NEW.free_quantity AS BLOB),x'00')>0
BEGIN SELECT RAISE(ABORT,'epoch quantity text bytes'); END;
CREATE TRIGGER stock_epoch_sources_quantity_bytes_update BEFORE UPDATE OF quantity,free_quantity ON stock_epoch_sources
WHEN instr(CAST(NEW.quantity AS BLOB),x'00')>0 OR instr(CAST(NEW.free_quantity AS BLOB),x'00')>0
BEGIN SELECT RAISE(ABORT,'epoch quantity text bytes'); END;

CREATE TRIGGER stock_epoch_segments_quantity_bytes_insert BEFORE INSERT ON stock_epoch_segments
WHEN instr(CAST(NEW.quantity AS BLOB),x'00')>0
BEGIN SELECT RAISE(ABORT,'epoch quantity text bytes'); END;
CREATE TRIGGER stock_epoch_segments_quantity_bytes_update BEFORE UPDATE OF quantity ON stock_epoch_segments
WHEN instr(CAST(NEW.quantity AS BLOB),x'00')>0
BEGIN SELECT RAISE(ABORT,'epoch quantity text bytes'); END;

CREATE TRIGGER stock_epoch_lines_quantity_bytes_insert BEFORE INSERT ON stock_epoch_lines
WHEN instr(CAST(NEW.original_quantity AS BLOB),x'00')>0
BEGIN SELECT RAISE(ABORT,'epoch quantity text bytes'); END;
CREATE TRIGGER stock_epoch_lines_quantity_bytes_update BEFORE UPDATE OF original_quantity ON stock_epoch_lines
WHEN instr(CAST(NEW.original_quantity AS BLOB),x'00')>0
BEGIN SELECT RAISE(ABORT,'epoch quantity text bytes'); END;

CREATE TRIGGER stock_epoch_line_allocations_quantity_bytes_insert BEFORE INSERT ON stock_epoch_line_allocations
WHEN instr(CAST(NEW.original_quantity AS BLOB),x'00')>0
BEGIN SELECT RAISE(ABORT,'epoch quantity text bytes'); END;
CREATE TRIGGER stock_epoch_line_allocations_quantity_bytes_update BEFORE UPDATE OF original_quantity ON stock_epoch_line_allocations
WHEN instr(CAST(NEW.original_quantity AS BLOB),x'00')>0
BEGIN SELECT RAISE(ABORT,'epoch quantity text bytes'); END;

CREATE TRIGGER stock_epoch_epochs_quantity_bytes_insert BEFORE INSERT ON stock_epoch_epochs
WHEN instr(CAST(NEW.target_quantity AS BLOB),x'00')>0 OR instr(CAST(NEW.returned_quantity AS BLOB),x'00')>0
BEGIN SELECT RAISE(ABORT,'epoch quantity text bytes'); END;
CREATE TRIGGER stock_epoch_epochs_quantity_bytes_update BEFORE UPDATE OF target_quantity,returned_quantity ON stock_epoch_epochs
WHEN instr(CAST(NEW.target_quantity AS BLOB),x'00')>0 OR instr(CAST(NEW.returned_quantity AS BLOB),x'00')>0
BEGIN SELECT RAISE(ABORT,'epoch quantity text bytes'); END;

CREATE TRIGGER stock_epoch_assignments_quantity_bytes_insert BEFORE INSERT ON stock_epoch_assignments
WHEN instr(CAST(NEW.quantity AS BLOB),x'00')>0
BEGIN SELECT RAISE(ABORT,'epoch quantity text bytes'); END;
CREATE TRIGGER stock_epoch_assignments_quantity_bytes_update BEFORE UPDATE OF quantity ON stock_epoch_assignments
WHEN instr(CAST(NEW.quantity AS BLOB),x'00')>0
BEGIN SELECT RAISE(ABORT,'epoch quantity text bytes'); END;

CREATE TRIGGER stock_epoch_source_states_quantity_bytes_insert BEFORE INSERT ON stock_epoch_source_states
WHEN instr(CAST(NEW.sellable_quantity AS BLOB),x'00')>0 OR instr(CAST(NEW.held_quantity AS BLOB),x'00')>0 OR instr(CAST(NEW.disposed_quantity AS BLOB),x'00')>0 OR instr(CAST(NEW.consumed_quantity AS BLOB),x'00')>0
BEGIN SELECT RAISE(ABORT,'epoch quantity text bytes'); END;
CREATE TRIGGER stock_epoch_source_states_quantity_bytes_update BEFORE UPDATE OF sellable_quantity,held_quantity,disposed_quantity,consumed_quantity ON stock_epoch_source_states
WHEN instr(CAST(NEW.sellable_quantity AS BLOB),x'00')>0 OR instr(CAST(NEW.held_quantity AS BLOB),x'00')>0 OR instr(CAST(NEW.disposed_quantity AS BLOB),x'00')>0 OR instr(CAST(NEW.consumed_quantity AS BLOB),x'00')>0
BEGIN SELECT RAISE(ABORT,'epoch quantity text bytes'); END;

CREATE TRIGGER stock_epoch_lot_heads_quantity_bytes_insert BEFORE INSERT ON stock_epoch_lot_heads
WHEN instr(CAST(NEW.quantity AS BLOB),x'00')>0 OR instr(CAST(NEW.received_quantity AS BLOB),x'00')>0
BEGIN SELECT RAISE(ABORT,'epoch quantity text bytes'); END;
CREATE TRIGGER stock_epoch_lot_heads_quantity_bytes_update BEFORE UPDATE OF quantity,received_quantity ON stock_epoch_lot_heads
WHEN instr(CAST(NEW.quantity AS BLOB),x'00')>0 OR instr(CAST(NEW.received_quantity AS BLOB),x'00')>0
BEGIN SELECT RAISE(ABORT,'epoch quantity text bytes'); END;

CREATE TRIGGER stock_epoch_lot_effects_quantity_bytes_insert BEFORE INSERT ON stock_epoch_lot_effects
WHEN instr(CAST(NEW.quantity_before AS BLOB),x'00')>0 OR instr(CAST(NEW.quantity_after AS BLOB),x'00')>0 OR instr(CAST(NEW.received_before AS BLOB),x'00')>0 OR instr(CAST(NEW.received_after AS BLOB),x'00')>0
BEGIN SELECT RAISE(ABORT,'epoch quantity text bytes'); END;
CREATE TRIGGER stock_epoch_lot_effects_quantity_bytes_update BEFORE UPDATE OF quantity_before,quantity_after,received_before,received_after ON stock_epoch_lot_effects
WHEN instr(CAST(NEW.quantity_before AS BLOB),x'00')>0 OR instr(CAST(NEW.quantity_after AS BLOB),x'00')>0 OR instr(CAST(NEW.received_before AS BLOB),x'00')>0 OR instr(CAST(NEW.received_after AS BLOB),x'00')>0
BEGIN SELECT RAISE(ABORT,'epoch quantity text bytes'); END;

CREATE TRIGGER stock_epoch_commands_quantity_bytes_insert BEFORE INSERT ON stock_epoch_commands
WHEN instr(CAST(NEW.quantity_before AS BLOB),x'00')>0 OR instr(CAST(NEW.quantity_after AS BLOB),x'00')>0 OR instr(CAST(NEW.branch_before AS BLOB),x'00')>0 OR instr(CAST(NEW.branch_after AS BLOB),x'00')>0 OR instr(CAST(NEW.product_before AS BLOB),x'00')>0 OR instr(CAST(NEW.product_after AS BLOB),x'00')>0
BEGIN SELECT RAISE(ABORT,'epoch quantity text bytes'); END;
CREATE TRIGGER stock_epoch_commands_quantity_bytes_update BEFORE UPDATE OF quantity_before,quantity_after,branch_before,branch_after,product_before,product_after ON stock_epoch_commands
WHEN instr(CAST(NEW.quantity_before AS BLOB),x'00')>0 OR instr(CAST(NEW.quantity_after AS BLOB),x'00')>0 OR instr(CAST(NEW.branch_before AS BLOB),x'00')>0 OR instr(CAST(NEW.branch_after AS BLOB),x'00')>0 OR instr(CAST(NEW.product_before AS BLOB),x'00')>0 OR instr(CAST(NEW.product_after AS BLOB),x'00')>0
BEGIN SELECT RAISE(ABORT,'epoch quantity text bytes'); END;
