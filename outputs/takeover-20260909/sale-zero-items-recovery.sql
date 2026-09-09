-- READ-ONLY REVIEW QUERIES ONLY. DO NOT EXECUTE A RECOVERY WITH RAW SQL.
-- The write path is /api/system/sale-incident-recovery-20260909/apply because
-- Worker env.DB.batch is the reviewed atomic primitive. Wrangler/D1 REST
-- multi-statement execution is not assumed to have that rollback contract.
SELECT s.id,s.receipt_number,s.sale_status,s.subtotal_usd,s.total_usd,r.revision,
  (SELECT COUNT(*) FROM sale_items i WHERE i.sale_id=s.id) AS item_count,
  (SELECT COUNT(*) FROM inventory_movements m WHERE m.reference_id=s.id AND m.movement_type='sale') AS movement_count
FROM sales s LEFT JOIN sale_write_revisions r ON r.sale_id=s.id
WHERE s.id IN (16951,16952,16953,16954) ORDER BY s.id;

SELECT incident_key,request_digest,actor_id,actor_name,created_at
FROM sale_incident_recovery_receipts
WHERE incident_key='sale-zero-items-20260909-v1';

SELECT operation_id,sale_id,history_id,before_json,after_json
FROM sale_incident_recovery_members ORDER BY sale_id;
