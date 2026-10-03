CREATE TRIGGER branch_cutovers_no_active_insert BEFORE INSERT ON branch_cutovers
WHEN EXISTS (SELECT 1 FROM branch_cutovers WHERE phase NOT IN ('completed','aborted'))
BEGIN SELECT RAISE(ABORT, 'branch_cutover_active_insert_refused'); END;
