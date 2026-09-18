-- Owner approved September 18, 2026: mark the four reviewed legacy invoices paid.
-- This is a historical balance correction, NOT a new expense or bank payment.
-- Fresh production preflight: ids 315/531/612/813, outstanding 29+12+438+10=489.
-- Exact identity/amount guards fail closed if the reviewed rows change.
-- Empty databases are a no-op; audit before-images support scoped recovery.
-- Recovery (only after checking there have been no later edits): restore
-- amount_paid_usd, outstanding_balance_usd and status from audit_logs.old_value
-- for action='owner_settle_legacy_supplier_0183', matching record_id to invoice id.
-- Do not delete the audit records when recovering; append a reversal audit.

CREATE TABLE _guard_supplier_settlement_0183 (ok INTEGER NOT NULL CHECK(ok=1));
CREATE TABLE _expected_supplier_settlement_0183 (
  id INTEGER PRIMARY KEY, supplier_id INTEGER, supplier_name TEXT,
  invoice_date TEXT, legacy_id INTEGER, source_row INTEGER,
  total REAL, paid REAL, outstanding REAL
);
INSERT INTO _expected_supplier_settlement_0183 VALUES
 (315,22,'ចែ USA','2024-08-26T09:52:00.000Z',28,29,203,174,29),
 (531,22,'ចែ USA','2024-12-20T04:20:00.000Z',244,245,177,165,12),
 (612,19,'Dane japan','2025-02-28T05:31:00.000Z',325,326,1373,935,438),
 (813,28,'naomi','2025-05-28T09:28:00.000Z',526,527,260,250,10);

INSERT INTO _guard_supplier_settlement_0183
SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM supplier_invoices)
 OR (SELECT COUNT(*) FROM supplier_invoices s JOIN _expected_supplier_settlement_0183 e ON e.id=s.id
 WHERE s.supplier_id=e.supplier_id AND s.supplier_name=e.supplier_name
 AND s.invoice_date=e.invoice_date AND s.legacy_id=e.legacy_id AND s.source_row=e.source_row
 AND s.source_branch='shop' AND s.source_file='shop-account-payable-report-all.xls'
 AND s.invoice_no IS NULL AND s.total_amount_usd=e.total
 AND ((s.status='Outstanding' AND s.amount_paid_usd=e.paid AND s.outstanding_balance_usd=e.outstanding)
 OR (s.status='Paid' AND s.amount_paid_usd=e.total AND s.outstanding_balance_usd=0
 AND EXISTS(SELECT 1 FROM audit_logs a WHERE a.action='owner_settle_legacy_supplier_0183'
 AND a.table_name='supplier_invoices' AND a.record_id=CAST(s.id AS TEXT)))))=4
 THEN 1 ELSE 0 END;

INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,old_value,new_value)
SELECT NULL,'owner-approved:migration:0183','owner_settle_legacy_supplier_0183',
 'supplier_invoices',CAST(s.id AS TEXT),
 json_object('reason','Owner confirmed legacy invoice paid on 2026-09-18; no new cash movement',
 'source_file',s.source_file,'source_row',s.source_row,'supplier_name',s.supplier_name,'invoice_date',s.invoice_date),
 'supplier_invoices',CAST(s.id AS TEXT),
 json_object('amount_paid_usd',s.amount_paid_usd,'outstanding_balance_usd',s.outstanding_balance_usd,'status',s.status),
 json_object('amount_paid_usd',s.total_amount_usd,'outstanding_balance_usd',0,'status','Paid')
FROM supplier_invoices s JOIN _expected_supplier_settlement_0183 e ON e.id=s.id
WHERE s.status='Outstanding'
 AND NOT EXISTS(SELECT 1 FROM audit_logs a WHERE a.action='owner_settle_legacy_supplier_0183'
 AND a.table_name='supplier_invoices' AND a.record_id=CAST(s.id AS TEXT));

UPDATE supplier_invoices SET amount_paid_usd=total_amount_usd,outstanding_balance_usd=0,status='Paid'
WHERE id IN (SELECT id FROM _expected_supplier_settlement_0183) AND status='Outstanding';

INSERT INTO _guard_supplier_settlement_0183
SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM supplier_invoices)
 OR ((SELECT COUNT(*) FROM supplier_invoices s JOIN _expected_supplier_settlement_0183 e ON e.id=s.id
 WHERE s.status='Paid' AND s.amount_paid_usd=e.total AND s.outstanding_balance_usd=0)=4
 AND (SELECT COUNT(*) FROM audit_logs WHERE action='owner_settle_legacy_supplier_0183')=4)
 THEN 1 ELSE 0 END;
DROP TABLE _expected_supplier_settlement_0183;
DROP TABLE _guard_supplier_settlement_0183;
