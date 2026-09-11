-- 0153: evidence-pinned received-date saleability repair, September 11 2026.
-- PRE: pause writes and retain a D1 recovery bookmark/database export. Every
-- signature below must match the fresh production census. Partial signatures
-- abort, including an otherwise-empty DB with just one incident row. An empty
-- new installation has no incident rows and receives no data changes.
-- POST: nine duplicate historical deductions reversed; 11 active products
-- (plus inactive Olay sibling 47155 = 12 identities) have Shop lot coverage
-- equal to branch stock. Clarins/Olay aggregate quantities and all existing
-- received dates, costs and other branches remain unchanged.
-- RECOVERY: audit_logs.old_value records every changed value and new_value
-- identifies inserted rows. Prefer the preflight D1 bookmark during the same
-- write pause. Otherwise restore only recorded fields, delete inserted rows,
-- and retain the audit as recovery evidence. Never reverse after new sales
-- without rechecking their allocations. Do not delete the completion audit
-- to force a rerun. Application rollback requires no data reversal.
-- All business changes execute inside ONE trigger invocation: RAISE(ABORT)
-- rolls them all back even when SQL is executed without an outer transaction.
-- Wrangler's splitter requires whitespace before CASE and after END, even
-- inside expressions. Keep these token boundaries when editing this trigger.

CREATE TABLE IF NOT EXISTS _received_date_repair_0153 (id INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS _received_date_manifest_0153 (
 product_id INTEGER PRIMARY KEY, stock REAL, shop REAL, batch_id INTEGER,
 movement_id INTEGER, sale_id INTEGER, sale_item_id INTEGER, occurred_at TEXT
);
DELETE FROM _received_date_manifest_0153;
INSERT INTO _received_date_manifest_0153 VALUES
 (165,9,0,56007,46189,16786,40033,'2026-09-03 14:48:57'),
 (238,0,0,51164,46194,16795,40058,'2026-09-03 14:49:00'),
 (939,7,7,53519,46197,16801,40071,'2026-09-03 14:49:02'),
 (955,2,2,53526,46196,16798,40061,'2026-09-03 14:49:01'),
 (3924,5,5,54618,46195,16796,40059,'2026-09-03 14:49:00'),
 (4115,16,1,54771,46192,16789,40044,'2026-09-03 14:48:57'),
 (4259,82,26,54816,46193,16791,40053,'2026-09-03 14:48:58'),
 (5067,5,1,55159,46191,16786,40035,'2026-09-03 14:48:57'),
 (5196,8,2,56824,46190,16786,40034,'2026-09-03 14:48:57');

CREATE TRIGGER IF NOT EXISTS received_date_repair_0153_apply
AFTER INSERT ON _received_date_repair_0153
WHEN NOT EXISTS(SELECT 1 FROM audit_logs WHERE action='received_date_saleability_repair' AND entity_id='0153')
 AND (EXISTS(SELECT 1 FROM products WHERE id IN (165,238,939,955,3924,4115,4259,5067,5196,1244,4758,47155))
 OR EXISTS(SELECT 1 FROM product_batches WHERE id IN (56007,51164,53519,53526,54618,54771,54816,55159,56824,61020,61029))
 OR EXISTS(SELECT 1 FROM inventory_movements WHERE id BETWEEN 46187 AND 46197)
 OR EXISTS(SELECT 1 FROM sale_items WHERE id IN (40033,40058,40071,40061,40059,40044,40053,40035,40034,40261,40286))
 OR EXISTS(SELECT 1 FROM return_items WHERE id=3)
 OR EXISTS(SELECT 1 FROM returns WHERE id=1)
 OR EXISTS(SELECT 1 FROM branch_stock WHERE product_id IN (165,238,939,955,3924,4115,4259,5067,5196,1244,4758,47155))
 OR EXISTS(SELECT 1 FROM sale_item_batch_allocations WHERE sale_item_id IN (40261,40286))
 OR EXISTS(SELECT 1 FROM return_item_batch_allocations WHERE return_item_id=3)
 OR EXISTS(SELECT 1 FROM sales WHERE id IN (16786,16789,16791,16795,16796,16798,16801,16790,16903)))
BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM branches WHERE id=2 AND name='Shop' AND is_active=1)!=1
 THEN RAISE(ABORT,'0153: Shop identity changed') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM _received_date_manifest_0153 f
 JOIN products p ON p.id=f.product_id AND p.is_active=1 AND p.stock_quantity=f.stock
 JOIN branch_stock bs ON bs.product_id=p.id AND bs.branch_id=2 AND bs.quantity=f.shop
 JOIN product_batches pb ON pb.id=f.batch_id AND pb.variant_product_id=p.id AND pb.is_active=1
   AND date(pb.received_at) IS NOT NULL
 JOIN branch_batch_stock bbs ON bbs.batch_id=pb.id AND bbs.branch_id=2 AND bbs.quantity=f.shop+1
 JOIN inventory_movements im ON im.id=f.movement_id AND im.product_id=p.id AND im.branch_id=2
   AND im.movement_type='sale' AND im.quantity=-1 AND im.reference_id=f.sale_id AND im.batch_id IS NULL
   AND im.reason='Sale status changed from awaiting_payment to completed' AND im.created_at=f.occurred_at
 JOIN sale_items si ON si.id=f.sale_item_id AND si.sale_id=f.sale_id AND si.product_id=p.id
   AND si.quantity=1 AND si.branch_id=2 AND si.batch_id IS NULL
 JOIN sales s ON s.id=f.sale_id AND s.branch_id=2 AND s.sale_status='completed' AND s.stock_skipped=1
 WHERE p.stock_quantity=(SELECT SUM(quantity) FROM branch_stock WHERE product_id=p.id)
 AND f.shop+1=(SELECT COALESCE(SUM(x.quantity),0) FROM branch_batch_stock x
   JOIN product_batches b ON b.id=x.batch_id WHERE b.variant_product_id=p.id AND b.is_active=1 AND x.branch_id=2 AND x.quantity>0)
 AND NOT EXISTS(SELECT 1 FROM sale_item_batch_allocations a WHERE a.sale_item_id=si.id))!=9
 THEN RAISE(ABORT,'0153: duplicate-deduction signature changed') END;

 SELECT CASE WHEN (SELECT COUNT(*) FROM products WHERE (id=1244 AND is_active=1 AND stock_quantity=5)
 OR (id=4758 AND is_active=1 AND stock_quantity=27) OR (id=47155 AND is_active=0 AND stock_quantity=28))!=3
 OR (SELECT COUNT(*) FROM branch_stock WHERE (product_id=1244 AND ((branch_id=1 AND quantity=4) OR (branch_id=2 AND quantity=1)))
 OR (product_id=4758 AND ((branch_id=1 AND quantity=10) OR (branch_id=2 AND quantity=17))))!=4
 OR EXISTS(SELECT 1 FROM branch_stock WHERE product_id=47155)
 OR (SELECT COUNT(*) FROM branch_stock WHERE product_id IN (1244,4758))!=4
 THEN RAISE(ABORT,'0153: Clarins/Olay aggregate signature changed') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM product_batches WHERE id=61020 AND variant_product_id=47155
 AND batch_key='09032026' AND lot_code='09032026' AND expiry_date='2029' AND received_at='2026-09-03'
 AND is_active=1 AND synthetic=0 AND unit_cost_usd=17.5 AND received_quantity=28 AND received_cost_usd=490
 AND received_branch_id=2 AND supplier_id=20 AND batch_number=1)!=1
 OR (SELECT COUNT(*) FROM inventory_movements WHERE id=46182 AND product_id=4758 AND branch_id=2
 AND movement_type='add' AND quantity=28 AND batch_id=61020 AND reference_id=1788409077320
 AND unit_cost_usd=17.5 AND total_cost_usd=490 AND created_at='2026-09-03 05:34:29')!=1
 OR (SELECT COUNT(*) FROM branch_batch_stock WHERE batch_id=61020)!=1
 OR (SELECT COUNT(*) FROM branch_batch_stock WHERE id=77792 AND batch_id=61020 AND branch_id=2 AND quantity=28)!=1
 OR (SELECT COUNT(*) FROM product_batches WHERE id=61029 AND variant_product_id=4758 AND is_active=1 AND date(received_at) IS NOT NULL)!=1
 OR (SELECT COUNT(*) FROM branch_batch_stock WHERE batch_id=61029 AND ((branch_id=1 AND quantity=10) OR (branch_id=2 AND quantity=10)))!=2
 OR EXISTS(SELECT 1 FROM product_batches WHERE variant_product_id=4758 AND batch_key='09032026')
 OR EXISTS(SELECT 1 FROM sale_item_batch_allocations WHERE batch_id=61020)
 OR EXISTS(SELECT 1 FROM return_item_batch_allocations WHERE batch_id=61020)
 THEN RAISE(ABORT,'0153: Olay lot identity or allocations changed') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM sale_items si JOIN sales s ON s.id=si.sale_id
 WHERE si.product_id=4758 AND si.branch_id=2 AND si.batch_id IS NULL AND si.damaged_lot_id IS NULL
 AND COALESCE(si.returned_quantity,0)=0 AND s.sale_status='completed' AND s.branch_id=2
 AND ((si.id=40261 AND si.sale_id=16790 AND si.quantity=20 AND s.stock_skipped=1)
 OR (si.id=40286 AND si.sale_id=16903 AND si.quantity=1 AND s.stock_skipped=0)))!=2
 OR EXISTS(SELECT 1 FROM sale_item_batch_allocations WHERE sale_item_id IN (40261,40286))
 OR (SELECT COUNT(*) FROM inventory_movements WHERE product_id=4758 AND branch_id=2
 AND movement_type='sale' AND batch_id IS NULL AND
 ((id=46271 AND reference_id=16790 AND quantity=-20 AND created_at='2026-09-05 04:38:38')
 OR (id=46304 AND reference_id=16903 AND quantity=-1 AND created_at='2026-09-05 09:50:28')))!=2
 THEN RAISE(ABORT,'0153: Olay legitimate-sale signature changed') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM return_items ri JOIN returns r ON r.id=ri.return_id
 WHERE ri.id=3 AND ri.return_id=1 AND ri.sale_item_id=39876 AND ri.product_id=1244
 AND ri.quantity=1 AND ri.return_to_stock=1 AND ri.branch_id=2 AND ri.batch_id IS NULL
 AND ri.cost_price_usd=61 AND r.id=1 AND r.sale_id=16671 AND r.branch_id=2 AND r.status='completed'
 AND r.return_number='RET-20260903-140759')!=1
 OR EXISTS(SELECT 1 FROM return_item_batch_allocations WHERE return_item_id=3)
 OR (SELECT COUNT(*) FROM inventory_movements WHERE id=46187 AND product_id=1244 AND branch_id=2
 AND reference_id=1 AND quantity=1 AND movement_type='return' AND batch_id IS NULL
 AND created_at='2026-09-03 07:19:07')!=1
 OR EXISTS(SELECT 1 FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id=bbs.batch_id
 WHERE pb.variant_product_id=1244 AND pb.is_active=1 AND bbs.branch_id=2 AND bbs.quantity>0)
 OR EXISTS(SELECT 1 FROM product_batches WHERE batch_key='repair-0153-return-1-item-3')
 THEN RAISE(ABORT,'0153: Clarins return signature changed') END;

 INSERT INTO audit_logs(user_name,action,entity,entity_id,details,old_value)
 VALUES('System repair 0153','received_date_saleability_repair','inventory','0153',
 'Nine duplicate deductions reversed; Olay merged lot and 21 legitimate sold units relinked; Clarins return received 2026-09-03, original supplier received date unknown.',
 json_object(
  'products',(SELECT json_group_array(json_object('id',id,'name',name,'sku',sku,'barcode',barcode,'category',category,'unit',unit,'description',description,'selling_price_usd',selling_price_usd,'selling_price_khr',selling_price_khr,'purchase_price_usd',purchase_price_usd,'purchase_price_khr',purchase_price_khr,'cost_price_usd',cost_price_usd,'cost_price_khr',cost_price_khr,'stock_quantity',stock_quantity,'rfid_confirmed_qty',rfid_confirmed_qty,'low_stock_threshold',low_stock_threshold,'out_of_stock_threshold',out_of_stock_threshold,'image_path',image_path,'is_active',is_active,'supplier',supplier,'custom_fields',custom_fields,'parent_id',parent_id,'created_at',created_at,'updated_at',updated_at,'brand',brand,'client_request_id',client_request_id,'special_price_usd',special_price_usd,'special_price_khr',special_price_khr,'is_group',is_group,'discount_enabled',discount_enabled,'discount_type',discount_type,'discount_percent',discount_percent,'discount_amount_usd',discount_amount_usd,'discount_amount_khr',discount_amount_khr,'discount_label',discount_label,'discount_badge_color',discount_badge_color,'discount_starts_at',discount_starts_at,'discount_ends_at',discount_ends_at,'expiry_date',expiry_date,'expiry_alert_days',expiry_alert_days,'name_key',name_key,'is_grouped_cached',is_grouped_cached,'categories',categories,'brands',brands,'name_normalized',name_normalized,'unit_normalized',unit_normalized,'brand_compact',brand_compact,'tag_label',tag_label,'auto_merged_count',auto_merged_count,'wholesale_price_usd',wholesale_price_usd,'wholesale_price_khr',wholesale_price_khr)) FROM products WHERE id IN (165,238,939,955,3924,4115,4259,5067,5196,1244,4758,47155)),
  'branch_stock',(SELECT json_group_array(json_object('id',id,'product_id',product_id,'branch_id',branch_id,'quantity',quantity,'rfid_confirmed_qty',rfid_confirmed_qty)) FROM branch_stock WHERE product_id IN (165,238,939,955,3924,4115,4259,5067,5196,1244,4758,47155)),
  'product_batches',(SELECT json_group_array(json_object('id',id,'variant_product_id',variant_product_id,'batch_key',batch_key,'lot_code',lot_code,'expiry_date',expiry_date,'received_at',received_at,'is_active',is_active,'notes',notes,'synthetic',synthetic,'created_at',created_at,'updated_at',updated_at,'batch_number',batch_number,'supplier_id',supplier_id,'supplier_name',supplier_name,'payment_status',payment_status,'credit_due_date',credit_due_date,'unit_cost_usd',unit_cost_usd,'received_quantity',received_quantity,'received_branch_id',received_branch_id,'received_cost_usd',received_cost_usd)) FROM product_batches WHERE variant_product_id IN (165,238,939,955,3924,4115,4259,5067,5196,1244,4758,47155)),
  'branch_batch_stock',(SELECT json_group_array(json_object('id',id,'batch_id',batch_id,'branch_id',branch_id,'quantity',quantity,'created_at',created_at,'updated_at',updated_at)) FROM branch_batch_stock WHERE batch_id IN (SELECT id FROM product_batches WHERE variant_product_id IN (165,238,939,955,3924,4115,4259,5067,5196,1244,4758,47155))),
  'sale_items',(SELECT json_group_array(json_object('id',id,'sale_id',sale_id,'product_id',product_id,'product_name',product_name,'sku',sku,'quantity',quantity,'unit',unit,'applied_price_usd',applied_price_usd,'applied_price_khr',applied_price_khr,'cost_price_usd',cost_price_usd,'cost_price_khr',cost_price_khr,'total_usd',total_usd,'total_khr',total_khr,'branch_id',branch_id,'price_mode',price_mode,'product_discount_type',product_discount_type,'product_discount_label',product_discount_label,'product_discount_usd',product_discount_usd,'product_discount_khr',product_discount_khr,'base_price_usd',base_price_usd,'base_price_khr',base_price_khr,'manual_discount_type',manual_discount_type,'manual_discount_value',manual_discount_value,'manual_discount_usd',manual_discount_usd,'manual_discount_khr',manual_discount_khr,'batch_id',batch_id,'batch_label',batch_label,'batch_expiry_date',batch_expiry_date,'returned_quantity',returned_quantity,'damaged_lot_id',damaged_lot_id)) FROM sale_items WHERE id IN (40261,40286)),
  'return_items',(SELECT json_group_array(json_object('id',id,'return_id',return_id,'sale_item_id',sale_item_id,'product_id',product_id,'product_name',product_name,'quantity',quantity,'applied_price_usd',applied_price_usd,'applied_price_khr',applied_price_khr,'cost_price_usd',cost_price_usd,'cost_price_khr',cost_price_khr,'total_usd',total_usd,'total_khr',total_khr,'return_to_stock',return_to_stock,'branch_id',branch_id,'batch_id',batch_id,'stock_action',stock_action)) FROM return_items WHERE id=3),
  'inventory_movements',(SELECT json_group_array(json_object('id',id,'product_id',product_id,'product_name',product_name,'branch_id',branch_id,'branch_name',branch_name,'movement_type',movement_type,'quantity',quantity,'unit_cost_usd',unit_cost_usd,'unit_cost_khr',unit_cost_khr,'total_cost_usd',total_cost_usd,'total_cost_khr',total_cost_khr,'reason',reason,'reference_id',reference_id,'user_id',user_id,'user_name',user_name,'created_at',created_at,'batch_id',batch_id)) FROM inventory_movements WHERE id IN (46187,46271,46304))
 ));

 UPDATE branch_stock SET quantity=quantity+1
 WHERE branch_id=2 AND product_id IN (SELECT product_id FROM _received_date_manifest_0153);
 UPDATE products SET stock_quantity=(SELECT COALESCE(SUM(quantity),0) FROM branch_stock WHERE product_id=products.id)
 WHERE id IN (SELECT product_id FROM _received_date_manifest_0153) OR id=47155;
 INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,movement_type,quantity,
 unit_cost_usd,unit_cost_khr,total_cost_usd,total_cost_khr,reason,reference_id,user_name)
 SELECT im.product_id,im.product_name,im.branch_id,im.branch_name,'adjustment',1,
 im.unit_cost_usd,im.unit_cost_khr,im.unit_cost_usd,im.unit_cost_khr,
 '0153: reverse duplicate historical status deduction; original movement '||im.id,im.reference_id,'System repair 0153'
 FROM inventory_movements im JOIN _received_date_manifest_0153 f ON f.movement_id=im.id;

 -- Legacy RECON text must not win MAX and coerce the next ordinal to 1.
 -- INTEGER affinity already stores well-formed numeric text numerically.
 INSERT INTO product_batches(variant_product_id,batch_key,lot_code,received_at,is_active,notes,synthetic,batch_number,
 unit_cost_usd,received_quantity,received_branch_id,received_cost_usd,created_at,updated_at)
 SELECT 1244,'repair-0153-return-1-item-3',NULL,'2026-09-03',1,
 'Customer return received 2026-09-03 (return 1, item 3, movement 46187). Original supplier received date unknown.',
 1,COALESCE((SELECT MAX(batch_number) FROM product_batches WHERE variant_product_id=1244 AND typeof(batch_number) IN ('integer','real')),0)+1,
 cost_price_usd,0,2,0,'2026-09-03 07:19:07','2026-09-03 07:19:07'
 FROM return_items WHERE id=3;
 INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)
 SELECT id,2,1 FROM product_batches WHERE batch_key='repair-0153-return-1-item-3';
 UPDATE return_items SET batch_id=(SELECT id FROM product_batches WHERE batch_key='repair-0153-return-1-item-3') WHERE id=3;
 INSERT INTO return_item_batch_allocations(return_item_id,sale_item_id,batch_id,branch_id,quantity,created_at)
 SELECT id,sale_item_id,batch_id,branch_id,quantity,'2026-09-03 07:19:07' FROM return_items WHERE id=3;
 UPDATE inventory_movements SET batch_id=(SELECT batch_id FROM return_items WHERE id=3) WHERE id=46187;

 UPDATE product_batches SET variant_product_id=4758,
 batch_number=(SELECT COALESCE(MAX(batch_number),0)+1 FROM product_batches WHERE variant_product_id=4758 AND typeof(batch_number) IN ('integer','real'))
 WHERE id=61020;
 UPDATE branch_batch_stock SET quantity=7 WHERE id=77792;
 UPDATE sale_items SET batch_id=61020,batch_label='09032026',batch_expiry_date='2029' WHERE id IN (40261,40286);
 INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,lot_code,expiry_date,created_at)
 SELECT id,61020,2,quantity,'09032026','2029',
 CASE id WHEN 40261 THEN '2026-09-05 04:38:38' ELSE '2026-09-05 09:50:28' END
 FROM sale_items WHERE id IN (40261,40286);
 UPDATE inventory_movements SET batch_id=61020 WHERE id IN (46271,46304);

 SELECT CASE WHEN EXISTS(SELECT 1 FROM products p WHERE p.id IN (165,238,939,955,3924,4115,4259,5067,5196,1244,4758,47155) AND
 p.stock_quantity!=(SELECT COALESCE(SUM(quantity),0) FROM branch_stock WHERE product_id=p.id))
 OR (SELECT COUNT(*) FROM products p JOIN branch_stock bs ON bs.product_id=p.id AND bs.branch_id=2
 WHERE p.id IN (165,238,939,955,3924,4115,4259,5067,5196,1244,4758,47155) AND p.is_active=1 AND bs.quantity=
 (SELECT COALESCE(SUM(bbs.quantity),0) FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id=bbs.batch_id
 WHERE pb.variant_product_id=p.id AND pb.is_active=1 AND bbs.branch_id=2 AND bbs.quantity>0 AND date(pb.received_at) IS NOT NULL))!=11
 THEN RAISE(ABORT,'0153: final aggregate/dated Shop coverage mismatch') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM audit_logs log,json_each(log.old_value,'$.products') old
 LEFT JOIN products current ON current.id=json_extract(old.value,'$.id')
 WHERE log.action='received_date_saleability_repair' AND log.entity_id='0153'
 AND (current.id IS NULL OR json_remove(json_object('id',current.id,'name',current.name,'sku',current.sku,'barcode',current.barcode,'category',current.category,'unit',current.unit,'description',current.description,'selling_price_usd',current.selling_price_usd,'selling_price_khr',current.selling_price_khr,'purchase_price_usd',current.purchase_price_usd,'purchase_price_khr',current.purchase_price_khr,'cost_price_usd',current.cost_price_usd,'cost_price_khr',current.cost_price_khr,'stock_quantity',current.stock_quantity,'rfid_confirmed_qty',current.rfid_confirmed_qty,'low_stock_threshold',current.low_stock_threshold,'out_of_stock_threshold',current.out_of_stock_threshold,'image_path',current.image_path,'is_active',current.is_active,'supplier',current.supplier,'custom_fields',current.custom_fields,'parent_id',current.parent_id,'created_at',current.created_at,'updated_at',current.updated_at,'brand',current.brand,'client_request_id',current.client_request_id,'special_price_usd',current.special_price_usd,'special_price_khr',current.special_price_khr,'is_group',current.is_group,'discount_enabled',current.discount_enabled,'discount_type',current.discount_type,'discount_percent',current.discount_percent,'discount_amount_usd',current.discount_amount_usd,'discount_amount_khr',current.discount_amount_khr,'discount_label',current.discount_label,'discount_badge_color',current.discount_badge_color,'discount_starts_at',current.discount_starts_at,'discount_ends_at',current.discount_ends_at,'expiry_date',current.expiry_date,'expiry_alert_days',current.expiry_alert_days,'name_key',current.name_key,'is_grouped_cached',current.is_grouped_cached,'categories',current.categories,'brands',current.brands,'name_normalized',current.name_normalized,'unit_normalized',current.unit_normalized,'brand_compact',current.brand_compact,'tag_label',current.tag_label,'auto_merged_count',current.auto_merged_count,'wholesale_price_usd',current.wholesale_price_usd,'wholesale_price_khr',current.wholesale_price_khr),'$.stock_quantity')!=json_remove(old.value,'$.stock_quantity')))
 THEN RAISE(ABORT,'0153: immutable products fields changed') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM audit_logs log,json_each(log.old_value,'$.branch_stock') old
 LEFT JOIN branch_stock current ON current.id=json_extract(old.value,'$.id')
 WHERE log.action='received_date_saleability_repair' AND log.entity_id='0153'
 AND (current.id IS NULL OR json_remove(json_object('id',current.id,'product_id',current.product_id,'branch_id',current.branch_id,'quantity',current.quantity,'rfid_confirmed_qty',current.rfid_confirmed_qty),'$.quantity')!=json_remove(old.value,'$.quantity')))
 THEN RAISE(ABORT,'0153: immutable branch_stock fields changed') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM audit_logs log,json_each(log.old_value,'$.product_batches') old
 LEFT JOIN product_batches current ON current.id=json_extract(old.value,'$.id')
 WHERE log.action='received_date_saleability_repair' AND log.entity_id='0153'
 AND (current.id IS NULL OR json_remove(json_object('id',current.id,'variant_product_id',current.variant_product_id,'batch_key',current.batch_key,'lot_code',current.lot_code,'expiry_date',current.expiry_date,'received_at',current.received_at,'is_active',current.is_active,'notes',current.notes,'synthetic',current.synthetic,'created_at',current.created_at,'updated_at',current.updated_at,'batch_number',current.batch_number,'supplier_id',current.supplier_id,'supplier_name',current.supplier_name,'payment_status',current.payment_status,'credit_due_date',current.credit_due_date,'unit_cost_usd',current.unit_cost_usd,'received_quantity',current.received_quantity,'received_branch_id',current.received_branch_id,'received_cost_usd',current.received_cost_usd),'$.variant_product_id','$.batch_number')!=json_remove(old.value,'$.variant_product_id','$.batch_number')))
 THEN RAISE(ABORT,'0153: immutable product_batches fields changed') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM audit_logs log,json_each(log.old_value,'$.branch_batch_stock') old
 LEFT JOIN branch_batch_stock current ON current.id=json_extract(old.value,'$.id')
 WHERE log.action='received_date_saleability_repair' AND log.entity_id='0153'
 AND (current.id IS NULL OR json_remove(json_object('id',current.id,'batch_id',current.batch_id,'branch_id',current.branch_id,'quantity',current.quantity,'created_at',current.created_at,'updated_at',current.updated_at),'$.quantity')!=json_remove(old.value,'$.quantity')))
 THEN RAISE(ABORT,'0153: immutable branch_batch_stock fields changed') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM audit_logs log,json_each(log.old_value,'$.sale_items') old
 LEFT JOIN sale_items current ON current.id=json_extract(old.value,'$.id')
 WHERE log.action='received_date_saleability_repair' AND log.entity_id='0153'
 AND (current.id IS NULL OR json_remove(json_object('id',current.id,'sale_id',current.sale_id,'product_id',current.product_id,'product_name',current.product_name,'sku',current.sku,'quantity',current.quantity,'unit',current.unit,'applied_price_usd',current.applied_price_usd,'applied_price_khr',current.applied_price_khr,'cost_price_usd',current.cost_price_usd,'cost_price_khr',current.cost_price_khr,'total_usd',current.total_usd,'total_khr',current.total_khr,'branch_id',current.branch_id,'price_mode',current.price_mode,'product_discount_type',current.product_discount_type,'product_discount_label',current.product_discount_label,'product_discount_usd',current.product_discount_usd,'product_discount_khr',current.product_discount_khr,'base_price_usd',current.base_price_usd,'base_price_khr',current.base_price_khr,'manual_discount_type',current.manual_discount_type,'manual_discount_value',current.manual_discount_value,'manual_discount_usd',current.manual_discount_usd,'manual_discount_khr',current.manual_discount_khr,'batch_id',current.batch_id,'batch_label',current.batch_label,'batch_expiry_date',current.batch_expiry_date,'returned_quantity',current.returned_quantity,'damaged_lot_id',current.damaged_lot_id),'$.batch_id','$.batch_label','$.batch_expiry_date')!=json_remove(old.value,'$.batch_id','$.batch_label','$.batch_expiry_date')))
 THEN RAISE(ABORT,'0153: immutable sale_items fields changed') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM audit_logs log,json_each(log.old_value,'$.return_items') old
 LEFT JOIN return_items current ON current.id=json_extract(old.value,'$.id')
 WHERE log.action='received_date_saleability_repair' AND log.entity_id='0153'
 AND (current.id IS NULL OR json_remove(json_object('id',current.id,'return_id',current.return_id,'sale_item_id',current.sale_item_id,'product_id',current.product_id,'product_name',current.product_name,'quantity',current.quantity,'applied_price_usd',current.applied_price_usd,'applied_price_khr',current.applied_price_khr,'cost_price_usd',current.cost_price_usd,'cost_price_khr',current.cost_price_khr,'total_usd',current.total_usd,'total_khr',current.total_khr,'return_to_stock',current.return_to_stock,'branch_id',current.branch_id,'batch_id',current.batch_id,'stock_action',current.stock_action),'$.batch_id')!=json_remove(old.value,'$.batch_id')))
 THEN RAISE(ABORT,'0153: immutable return_items fields changed') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM audit_logs log,json_each(log.old_value,'$.inventory_movements') old
 LEFT JOIN inventory_movements current ON current.id=json_extract(old.value,'$.id')
 WHERE log.action='received_date_saleability_repair' AND log.entity_id='0153'
 AND (current.id IS NULL OR json_remove(json_object('id',current.id,'product_id',current.product_id,'product_name',current.product_name,'branch_id',current.branch_id,'branch_name',current.branch_name,'movement_type',current.movement_type,'quantity',current.quantity,'unit_cost_usd',current.unit_cost_usd,'unit_cost_khr',current.unit_cost_khr,'total_cost_usd',current.total_cost_usd,'total_cost_khr',current.total_cost_khr,'reason',current.reason,'reference_id',current.reference_id,'user_id',current.user_id,'user_name',current.user_name,'created_at',current.created_at,'batch_id',current.batch_id),'$.batch_id')!=json_remove(old.value,'$.batch_id')))
 THEN RAISE(ABORT,'0153: immutable inventory_movements fields changed') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM audit_logs log,json_each(log.old_value,'$.branch_stock') old
 JOIN branch_stock current ON current.id=json_extract(old.value,'$.id')
 WHERE log.action='received_date_saleability_repair' AND log.entity_id='0153'
 AND current.quantity!=json_extract(old.value,'$.quantity')+
 CASE WHEN current.branch_id=2 AND current.product_id IN (SELECT product_id FROM _received_date_manifest_0153) THEN 1 ELSE 0 END )
 OR EXISTS(SELECT 1 FROM audit_logs log,json_each(log.old_value,'$.branch_batch_stock') old
 JOIN branch_batch_stock current ON current.id=json_extract(old.value,'$.id')
 WHERE log.action='received_date_saleability_repair' AND log.entity_id='0153'
 AND current.quantity!= CASE WHEN current.id=77792 THEN 7 ELSE json_extract(old.value,'$.quantity') END )
 THEN RAISE(ABORT,'0153: unrelated branch quantity changed') END;
 -- D1 limits LIKE patterns to 50 bytes; use exact prefixes for our generated
 -- correction reasons here and in the replay guard below.
 UPDATE audit_logs SET new_value=json_object(
 'return_batch_id',(SELECT batch_id FROM return_items WHERE id=3),
 'correction_movement_ids',(SELECT json_group_array(id) FROM inventory_movements WHERE user_name='System repair 0153' AND instr(reason,'0153: reverse duplicate historical status deduction;')=1),
 'sale_allocation_ids',(SELECT json_group_array(id) FROM sale_item_batch_allocations WHERE sale_item_id IN (40261,40286)),
 'return_allocation_ids',(SELECT json_group_array(id) FROM return_item_batch_allocations WHERE return_item_id=3),
 'stock_delta',9,'olay_sold_quantity',21,'original_supplier_received_date_known',json('false'))
 WHERE action='received_date_saleability_repair' AND entity_id='0153';
END;

-- A completion marker may only suppress a replay when the repaired links and
-- quantities still match. A marker left by a manual partial repair is an error.
CREATE TRIGGER IF NOT EXISTS received_date_repair_0153_replay
BEFORE INSERT ON _received_date_repair_0153
WHEN EXISTS(SELECT 1 FROM audit_logs WHERE action='received_date_saleability_repair' AND entity_id='0153')
BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM audit_logs WHERE action='received_date_saleability_repair' AND entity_id='0153')!=1
 OR (SELECT COUNT(*) FROM _received_date_manifest_0153 f JOIN products p ON p.id=f.product_id
 JOIN branch_stock bs ON bs.product_id=p.id AND bs.branch_id=2
 WHERE p.stock_quantity=f.stock+1 AND bs.quantity=f.shop+1)!=9
 OR (SELECT COUNT(*) FROM products WHERE (id=1244 AND stock_quantity=5) OR (id=4758 AND stock_quantity=27)
 OR (id=47155 AND stock_quantity=0 AND is_active=0))!=3
 OR (SELECT COUNT(*) FROM product_batches WHERE id=61020 AND variant_product_id=4758 AND received_at='2026-09-03')!=1
 OR (SELECT COUNT(*) FROM branch_batch_stock WHERE id=77792 AND quantity=7)!=1
 OR (SELECT COUNT(*) FROM sale_item_batch_allocations WHERE batch_id=61020 AND branch_id=2 AND released_at IS NULL
 AND ((sale_item_id=40261 AND quantity=20) OR (sale_item_id=40286 AND quantity=1)))!=2
 OR (SELECT COUNT(*) FROM inventory_movements WHERE id IN (46271,46304) AND batch_id=61020)!=2
 OR (SELECT COUNT(*) FROM return_items ri JOIN product_batches pb ON pb.id=ri.batch_id
 JOIN return_item_batch_allocations a ON a.return_item_id=ri.id AND a.batch_id=pb.id
 JOIN inventory_movements im ON im.id=46187 AND im.batch_id=pb.id
 WHERE ri.id=3 AND pb.batch_key='repair-0153-return-1-item-3' AND pb.received_at='2026-09-03'
 AND a.quantity=1 AND a.branch_id=2 AND a.reversed_at IS NULL)!=1
 OR (SELECT COUNT(*) FROM inventory_movements WHERE user_name='System repair 0153'
 AND instr(reason,'0153: reverse duplicate historical status deduction;')=1)!=9
 THEN RAISE(ABORT,'0153: completed repair has changed; investigate before replay') END;
END;

INSERT INTO _received_date_repair_0153 DEFAULT VALUES;
DROP TRIGGER received_date_repair_0153_apply;
DROP TRIGGER received_date_repair_0153_replay;
DROP TABLE _received_date_repair_0153;
DROP TABLE _received_date_manifest_0153;
