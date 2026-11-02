'use strict'
// Synthetic production-scale seed for the read-budget gate. Every name, phone, barcode and id is generated here:
// nothing is copied from production. Sizes follow the production counts of 1 Nov 2026: products 8,652, product_batches
// 36,870, branch_stock 16,757, sales 15,848, sale_items 38,337, customers 5,164, positive lots 3,978 (all in the one
// active branch). Branch 2 is inactive with successor 1; variant `twoActive` keeps both branches active.
// Dates hang off one anchor (today, 12:00 in the business timezone, UTC+7) so every run of one day sees the same data.
const ADMIN = { username: 'budget_admin', password: 'budget-password-1', bootstrapPassword: 'Budget-Admin-Pass-2026' }
const P = 8652, C = 5164, S = 15848, FIRST_SALE = 100000, POSITIVE_LOTS = 3978, BRANCH_STOCK_ROWS = 16757
const BIG_SALE_K = 40, BIG_SALE_LINES = 86

function seedContext(now = new Date()) {
  const local = new Date(now.getTime() + 7 * 3600e3)
  const anchorDate = local.toISOString().slice(0, 10)
  const day = (back) => new Date(Date.parse(anchorDate + 'T00:00:00Z') - back * 86400e3).toISOString().slice(0, 10)
  return { anchorDate, anchor: `${anchorDate} 05:00:00`, today: anchorDate, week: day(6), month: day(29), year: day(364), bigSaleId: FIRST_SALE + S - 1 - BIG_SALE_K, firstSaleId: FIRST_SALE, lastSaleId: FIRST_SALE + S - 1 }
}

// Lines per sale from the sale's age index k: ~2.3% big sales (10-22 lines), the rest mostly 1-3, one 86-line sale.
const linesSql = (k) => `(CASE WHEN ${k} = ${BIG_SALE_K} THEN ${BIG_SALE_LINES} WHEN ${k} % 1000 < 23 THEN 10 + ${k} % 13
  WHEN ${k} % 100 < 41 THEN 1 WHEN ${k} % 100 < 70 THEN 2 WHEN ${k} % 100 < 87 THEN 3 WHEN ${k} % 100 < 95 THEN 4 ELSE 5 END)`

function seedSql({ variant = 'base' } = {}) {
  const { anchor, anchorDate } = seedContext()
  const A = `'${anchor}'`
  const AD = `'${anchorDate}'`
  const ago = (expr, unit) => `strftime('%Y-%m-%d %H:%M:%S',datetime(${A},'-'||(${expr})||' ${unit}'))`
  const twoActive = variant === 'twoActive'
  const sk = `(${FIRST_SALE + S - 1} - s.id)`
  return [
    "INSERT INTO system_flags(key,value) VALUES('stock_transaction_permit','legacy-separate-pool-v1')",
    `INSERT INTO system_flags(key,value) VALUES('maintenance','{"mode":"restore","token":"seed","backupKey":"seed"}')`,
    "INSERT OR IGNORE INTO branches(id,name,is_active,is_default) VALUES(1,'Main Shop',1,1),(2,'Second Store',1,0)",
    "UPDATE branches SET name='Main Shop',role='shop',canonical_key='shop',is_active=1,is_default=1 WHERE id=1",
    twoActive ? "UPDATE branches SET name='Second Store',role='warehouse',canonical_key='warehouse',is_active=1,is_default=0 WHERE id=2"
      : "UPDATE branches SET name='Old Store',role='warehouse',canonical_key='warehouse',is_active=0,is_default=0,successor_branch_id=1 WHERE id=2",
    `WITH RECURSIVE n(j) AS (SELECT 1 UNION ALL SELECT j+1 FROM n WHERE j<120)
      INSERT INTO suppliers(id,name,phone,created_at) SELECT j,'Supplier '||j,'000'||printf('%07d',j),'2025-01-01 00:00:00' FROM n`,
    `WITH RECURSIVE n(j) AS (SELECT 0 UNION ALL SELECT j+1 FROM n WHERE j<${P - 1}),
      shaped AS (SELECT j, 1000+j AS id, CASE WHEN j%8 IN (1,2) THEN j-j%8 ELSE j END AS nm FROM n),
      named AS (SELECT j,id,'Product '||nm||' '||(CASE nm%4 WHEN 0 THEN 'Serum' WHEN 1 THEN 'Cream' WHEN 2 THEN 'Powder' ELSE 'Balm' END) AS name FROM shaped)
      INSERT INTO products(id,name,name_key,name_normalized,barcode,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,purchase_price_usd,is_active,brand,brand_compact,category,supplier,low_stock_threshold,image_path,created_at,updated_at)
      SELECT id,name,lower(name),lower(name),'885'||printf('%010d',id),'SKU-'||id,0,
        5+j%20,(5+j%20)*4000,1+(j%9)/4.0,(1+(j%9)/4.0)*4000,1+(j%9)/4.0,CASE WHEN j%25=24 THEN 0 ELSE 1 END,'Brand '||(j%60),'brand'||(j%60),'Category '||(j%30),'Supplier '||(1+j%120),CASE WHEN j%9=0 THEN 3 ELSE 2 END,
        CASE WHEN j%3=0 THEN '/uploads/p'||id||'.webp' END,'2025-0'||(1+j%9)||'-1'||(j%9)||' 03:00:00',${A} FROM named`,
    // 4 lots per product, a fifth for 26% of them: 36,870 lots.
    `WITH RECURSIVE l(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM l WHERE i<4)
      INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,expiry_date,unit_cost_usd,supplier_id,supplier_name,received_quantity,received_branch_id,received_cost_usd,received_branch_name)
      SELECT 500000+(p.id-1000)*5+l.i,p.id,'b-'||p.id||'-'||l.i,'L-'||p.id||'-'||l.i,date(${AD},'-'||((4-l.i)*90+(p.id%60))||' days'),1,l.i+1,'2027-0'||(1+l.i)||'-01',
        p.cost_price_usd,1+(p.id+l.i)%120,'Supplier '||(1+(p.id+l.i)%120),24,1,p.cost_price_usd*24,'Main Shop'
      FROM products p JOIN l ON l.i < 4 + (CASE WHEN (p.id-1000)%100 < 26 THEN 1 ELSE 0 END) WHERE p.id BETWEEN 1000 AND ${999 + P}`,
    // Branch 1 holds every lot; positive stock sits on the newest lot (and one older lot in five), trimmed to exactly 3,978 lots.
    `INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)
      SELECT b.id,1,CASE WHEN (b.variant_product_id-1000)%7=0 OR (b.variant_product_id-1000)%25=24 THEN 0
        WHEN b.batch_number=(SELECT MAX(x.batch_number) FROM product_batches x WHERE x.variant_product_id=b.variant_product_id) AND (b.variant_product_id-1000)%100 < 56 THEN 5+(b.variant_product_id-1000)%30
        WHEN b.batch_number=(SELECT MAX(x.batch_number) FROM product_batches x WHERE x.variant_product_id=b.variant_product_id)-1 AND (b.variant_product_id-1000)%10=0 THEN 3 ELSE 0 END
      FROM product_batches b`,
    `UPDATE branch_batch_stock SET quantity=0 WHERE rowid IN (SELECT rowid FROM branch_batch_stock WHERE branch_id=1 AND quantity>0 ORDER BY rowid DESC
      LIMIT MAX(0,(SELECT COUNT(*) FROM branch_batch_stock WHERE quantity>0)-${POSITIVE_LOTS}))`,
    `INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)
      SELECT b.id,2,${twoActive ? "CASE WHEN b.batch_number=(SELECT MAX(x.batch_number) FROM product_batches x WHERE x.variant_product_id=b.variant_product_id) AND (b.variant_product_id-1000)%3=0 THEN 30 ELSE 0 END" : '0'}
      FROM product_batches b WHERE (b.variant_product_id+b.batch_number)%3=0`,
    // branch_stock: one row per product in branch 1, and in branch 2 for all but a few, trimmed to exactly 16,757 rows.
    `INSERT INTO branch_stock(product_id,branch_id,quantity)
      SELECT p.id,br.id,COALESCE(agg.q,0) FROM products p CROSS JOIN branches br
      LEFT JOIN (SELECT b.variant_product_id pid,bbs.branch_id bid,SUM(bbs.quantity) q FROM branch_batch_stock bbs JOIN product_batches b ON b.id=bbs.batch_id GROUP BY 1,2) agg ON agg.pid=p.id AND agg.bid=br.id
      WHERE p.id BETWEEN 1000 AND ${999 + P} AND br.id IN (1,2) ORDER BY br.id, p.id LIMIT ${BRANCH_STOCK_ROWS}`,
    'UPDATE products SET stock_quantity=(SELECT COALESCE(SUM(quantity),0) FROM branch_stock bs WHERE bs.product_id=products.id)',
    `INSERT INTO product_images(product_id,image_path,sort_order) SELECT id,'/uploads/g'||id||'.webp',0 FROM products WHERE id BETWEEN 1000 AND ${999 + P} AND (id-1000)%5=0`,
    `WITH RECURSIVE n(j) AS (SELECT 1 UNION ALL SELECT j+1 FROM n WHERE j<${C})
      INSERT INTO customers(id,name,phone,phone_normalized,created_at) SELECT j,'Customer '||j,'000'||printf('%07d',j),'000'||printf('%07d',j),${ago('j%360', 'days')} FROM n`,
    // sale k is k*32.8 minutes before the anchor; 88% completed, 6% awaiting_payment, 6% cancelled; the recent 3,000 sales are all branch 1.
    `WITH RECURSIVE n(k) AS (SELECT 0 UNION ALL SELECT k+1 FROM n WHERE k<${S - 1})
      INSERT INTO sales(id,receipt_number,cashier_id,cashier_name,branch_id,branch_name,customer_id,customer_name,customer_phone,payment_method,exchange_rate,
        sale_status,created_at,updated_at,money_precision_version,loyalty_accrual,search_normalized,stock_skipped)
      SELECT ${FIRST_SALE}+${S - 1}-k,'R'||printf('%07d',${FIRST_SALE}+${S - 1}-k),901,'Budget Admin',CASE WHEN k>=3000 AND k%10=9 THEN 2 ELSE 1 END,CASE WHEN k>=3000 AND k%10=9 THEN 'Old Store' ELSE 'Main Shop' END,
        CASE WHEN k%5<3 THEN 1+k%${C} END,CASE WHEN k%5<3 THEN 'Customer '||(1+k%${C}) ELSE 'Walk-in' END,CASE WHEN k%5<3 THEN '000'||printf('%07d',1+k%${C}) END,
        CASE WHEN k%4=0 THEN 'ABA' ELSE 'Cash' END,4000,
        CASE WHEN k%50 IN (7,23,41) THEN 'awaiting_payment' WHEN k%50 IN (11,31,44) THEN 'cancelled' ELSE 'completed' END,
        ${ago('CAST(k*32.8 AS INTEGER)', 'minutes')},${ago('CAST(k*32.8 AS INTEGER)', 'minutes')},
        0,0,lower('r'||printf('%07d',${FIRST_SALE}+${S - 1}-k)||' customer '||(1+k%${C})),0 FROM n ORDER BY k DESC`,
    `WITH RECURSIVE l(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM l WHERE i<${BIG_SALE_LINES - 1})
      INSERT INTO sale_items(sale_id,product_id,product_name,sku,quantity,applied_price_usd,applied_price_khr,base_price_usd,base_price_khr,cost_price_usd,cost_price_khr,total_usd,total_khr,branch_id,batch_id,price_mode)
      SELECT s.id,p.id,p.name,p.sku,1+(s.id+l.i)%2,p.selling_price_usd,p.selling_price_khr,p.selling_price_usd,p.selling_price_khr,p.cost_price_usd,p.cost_price_khr,
        p.selling_price_usd*(1+(s.id+l.i)%2),p.selling_price_khr*(1+(s.id+l.i)%2),s.branch_id,500000+(p.id-1000)*5+3,'selling'
      FROM sales s JOIN l ON l.i < ${linesSql(sk)}
      JOIN products p ON p.id = 1000 + ((s.id*13 + l.i*977) % ${P})
      WHERE s.id >= ${FIRST_SALE} AND s.id <> ${FIRST_SALE + S - 1 - BIG_SALE_K}`,
    // The 86-line sale sells 86 distinct active products, so it can be cancelled and un-cancelled.
    `INSERT INTO sale_items(sale_id,product_id,product_name,sku,quantity,applied_price_usd,applied_price_khr,base_price_usd,base_price_khr,cost_price_usd,cost_price_khr,total_usd,total_khr,branch_id,batch_id,price_mode)
      SELECT ${FIRST_SALE + S - 1 - BIG_SALE_K},p.id,p.name,p.sku,1+p.id%2,p.selling_price_usd,p.selling_price_khr,p.selling_price_usd,p.selling_price_khr,p.cost_price_usd,p.cost_price_khr,
        p.selling_price_usd*(1+p.id%2),p.selling_price_khr*(1+p.id%2),1,500000+(p.id-1000)*5+3,'selling'
      FROM (SELECT * FROM products WHERE is_active=1 AND (id-1000)%8 NOT IN (1,2) ORDER BY id LIMIT ${BIG_SALE_LINES} OFFSET 3000) p`,
    `UPDATE sales SET subtotal_usd=(SELECT SUM(total_usd) FROM sale_items si WHERE si.sale_id=sales.id), total_usd=(SELECT SUM(total_usd) FROM sale_items si WHERE si.sale_id=sales.id),
       subtotal_khr=(SELECT SUM(total_khr) FROM sale_items si WHERE si.sale_id=sales.id), total_khr=(SELECT SUM(total_khr) FROM sale_items si WHERE si.sale_id=sales.id) WHERE id>=${FIRST_SALE}`,
    `UPDATE sales SET amount_paid_usd=CASE WHEN sale_status='awaiting_payment' THEN 0 ELSE total_usd END WHERE id>=${FIRST_SALE}`,
    `INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,lot_code,created_at)
      SELECT si.id,si.batch_id,si.branch_id,si.quantity,'L',s.created_at FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.created_at >= datetime(${A},'-60 days') AND s.sale_status<>'cancelled'`,
    `INSERT INTO sale_payment_events(event_id,sale_id,direction,origin,payment_method,payment_details,amount_paid_usd,exchange_rate,received_at,branch_id,cashier_id,cashier_name,created_at)
      SELECT 'ev-'||s.id,s.id,'in','checkout',s.payment_method,'[]',s.amount_paid_usd,4000,s.created_at,s.branch_id,901,'Budget Admin',s.created_at FROM sales s WHERE s.created_at >= datetime(${A},'-14 days') AND s.amount_paid_usd>0`,
    `WITH RECURSIVE n(k) AS (SELECT 0 UNION ALL SELECT k+1 FROM n WHERE k<4454)
      INSERT INTO fees(sale_id,fee_type,label,amount_usd,amount_khr,fee_date,branch_id,branch_name,created_by,created_by_name,created_at)
      SELECT CASE WHEN k%3=0 THEN ${FIRST_SALE}+(k*3)%${S} END,CASE WHEN k%3=0 THEN 'delivery' ELSE 'other' END,'Fee '||k,1+k%7,(1+k%7)*4000,date(${AD},'-'||(k*117/1440)||' days'),1,'Main Shop',901,'Budget Admin',${ago('k*117', 'minutes')} FROM n ORDER BY k DESC`,
    `WITH RECURSIVE n(k) AS (SELECT 0 UNION ALL SELECT k+1 FROM n WHERE k<33513)
      INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,movement_type,quantity,reason,reference_id,user_id,user_name,created_at,batch_id)
      SELECT 1000+(k*7)%${P},'Product',1,'Main Shop',CASE WHEN k%4=0 THEN 'stock_in' ELSE 'sale' END,CASE WHEN k%4=0 THEN 5 ELSE -1 END,'seed',k,901,'Budget Admin',${ago('k*15', 'minutes')},500000+((k*7)%${P})*5+3 FROM n ORDER BY k DESC`,
    `WITH RECURSIVE n(k) AS (SELECT 0 UNION ALL SELECT k+1 FROM n WHERE k<12400)
      INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,created_at)
      SELECT 901,'Budget Admin',CASE k%3 WHEN 0 THEN 'create' WHEN 1 THEN 'update' ELSE 'delete' END,CASE k%4 WHEN 0 THEN 'sale' WHEN 1 THEN 'product' WHEN 2 THEN 'inventory' ELSE 'customer' END,${FIRST_SALE}+k,'{}',${ago('k*40', 'minutes')} FROM n ORDER BY k DESC`,
    `WITH RECURSIVE n(k) AS (SELECT 0 UNION ALL SELECT k+1 FROM n WHERE k<6270)
      INSERT INTO action_history(scope,entity,entity_id,label,status,created_by_id,created_by_name,created_at,updated_at)
      SELECT 'global',CASE k%3 WHEN 0 THEN 'sale' WHEN 1 THEN 'product' ELSE 'inventory' END,CAST(${FIRST_SALE}+k AS TEXT),'Action '||k,'undoable',901,'Budget Admin',${ago('k*80', 'minutes')},${ago('k*80', 'minutes')} FROM n ORDER BY k DESC`,
    `WITH RECURSIVE n(k) AS (SELECT 0 UNION ALL SELECT k+1 FROM n WHERE k<3546)
      INSERT INTO stock_transfers(from_branch_id,to_branch_id,product_id,product_name,quantity,notes,user_id,user_name,created_at,from_branch_name,to_branch_name)
      SELECT 2,1,1000+(k*11)%${P},'Product',2,'seed',901,'Budget Admin',${ago('k*140', 'minutes')},'Old Store','Main Shop' FROM n ORDER BY k DESC`,
    `WITH RECURSIVE n(k) AS (SELECT 1 UNION ALL SELECT k+1 FROM n WHERE k<3426)
      INSERT INTO transfer_operation_receipts(id,actor_id,request_id,request_digest,request_json,response_json,status,created_at,updated_at,operation_id,provenance_version)
      SELECT k,901,'tr-'||k,'d'||k,'{}','{}','committed',${ago('(3427-k)*140', 'minutes')},${ago('(3427-k)*140', 'minutes')},'op-'||k,1 FROM n`,
    `INSERT INTO transfer_operation_members(receipt_id,ordinal,source_product_id,destination_product_id,source_branch_id,destination_branch_id,quantity,untracked_quantity,source_snapshot,destination_snapshot,allocations_json)
      SELECT id,0,1000+(id*11)%${P},1000+(id*11)%${P},2,1,2,0,'{}','{}','[]' FROM transfer_operation_receipts`,
    `INSERT INTO transfer_operation_members(receipt_id,ordinal,source_product_id,destination_product_id,source_branch_id,destination_branch_id,quantity,untracked_quantity,source_snapshot,destination_snapshot,allocations_json)
      SELECT id,1,1000+(id*17)%${P},1000+(id*17)%${P},2,1,1,0,'{}','{}','[]' FROM transfer_operation_receipts WHERE id<=12`,
    `WITH RECURSIVE n(k) AS (SELECT 1 UNION ALL SELECT k+1 FROM n WHERE k<900)
      INSERT INTO stock_session_operations(id,actor_id,request_id,mode,request_json,receipt_json,created_at)
      SELECT 'ss-'||k,901,'req-'||k,'stock_in','{}','{}',${ago('(901-k)*576', 'minutes')} FROM n`,
    `WITH RECURSIVE l(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM l WHERE i<5)
      INSERT INTO stock_session_members(operation_id,line_id,command_kind,product_id,branch_id,batch_id,quantity,unit_cost_usd,branch_name)
      SELECT o.id,'l'||l.i,'receive',1000+((CAST(substr(o.id,4) AS INTEGER)*31+l.i*101)%${P}),1,500000+((CAST(substr(o.id,4) AS INTEGER)*31+l.i*101)%${P})*5+3,6,1.5,'Main Shop'
      FROM stock_session_operations o JOIN l ON l.i < 1+(CAST(substr(o.id,4) AS INTEGER)%6)`,
    // Production has 8 returns of one line each. Today's boundary rows follow.
    `INSERT INTO returns(id,return_number,sale_id,receipt_number,cashier_id,cashier_name,customer_name,branch_id,branch_name,reason,total_refund_usd,total_refund_khr,exchange_rate,status,created_at,customer_id,search_normalized)
      SELECT ROW_NUMBER() OVER (ORDER BY s.id),'RT'||printf('%06d',ROW_NUMBER() OVER (ORDER BY s.id)),s.id,s.receipt_number,901,'Budget Admin',COALESCE(s.customer_name,'Walk-in'),1,'Main Shop','seed',8,32000,4000,'completed',
        ${ago('ROW_NUMBER() OVER (ORDER BY s.id)*1300', 'minutes')},s.customer_id,'rt'||printf('%06d',ROW_NUMBER() OVER (ORDER BY s.id))
      FROM (SELECT id,receipt_number,customer_name,customer_id FROM sales WHERE sale_status='completed' AND id%1500=0 AND id>=${FIRST_SALE} ORDER BY id LIMIT 8) s`,
    `INSERT INTO return_items(return_id,sale_item_id,product_id,product_name,quantity,applied_price_usd,total_usd,return_to_stock,branch_id,batch_id)
      SELECT r.id,si.id,si.product_id,si.product_name,1,si.applied_price_usd,si.applied_price_usd,1,1,si.batch_id FROM returns r
      JOIN sale_items si ON si.id=(SELECT MIN(x.id) FROM sale_items x WHERE x.sale_id=r.sale_id)`,
    `WITH RECURSIVE n(k) AS (SELECT 1 UNION ALL SELECT k+1 FROM n WHERE k<360)
      INSERT INTO shift_sessions(shift_code,user_id,user_name,branch_id,branch_name,business_date,opened_at,closed_at,closing_counted_usd,closing_counted_khr)
      SELECT 'SH'||k,901,'Budget Admin',1,'Main Shop',date(${AD},'-'||(361-k)||' days'),${ago('361-k', 'days')},strftime('%Y-%m-%d %H:%M:%S',datetime(${A},'-'||(361-k)||' days','+8 hours')),100,0 FROM n`,
    `WITH RECURSIVE n(k) AS (SELECT 0 UNION ALL SELECT k+1 FROM n WHERE k<13303)
      INSERT INTO customer_receivables(legacy_id,customer_id,customer_code,customer_name,invoice_no,invoice_date,total_amount_usd,amount_paid_usd,outstanding_balance_usd,status,source_file,source_row)
      SELECT 'L'||k,1+k%${C},'C'||(1+k%${C}),'Customer '||(1+k%${C}),'INV'||k,date(${AD},'-'||(400+k%300)||' days'),10,10,0,'paid','seed.xls',k FROM n`,
    "INSERT OR IGNORE INTO stock_session_revisions(entity_type,entity_key,revision) SELECT 'branch_batch_stock',CAST(batch_id AS TEXT)||':'||CAST(branch_id AS TEXT),1 FROM branch_batch_stock",
    "INSERT OR IGNORE INTO stock_session_revisions(entity_type,entity_key,revision) SELECT 'product',CAST(id AS TEXT),1 FROM products",
    "INSERT OR IGNORE INTO stock_session_revisions(entity_type,entity_key,revision) SELECT 'batch_identity',CAST(id AS TEXT),1 FROM product_batches ORDER BY id LIMIT 7354",
    "INSERT OR IGNORE INTO sale_write_revisions(sale_id,revision) SELECT id,1 FROM sales",
    `WITH RECURSIVE n(k) AS (SELECT 1 UNION ALL SELECT k+1 FROM n WHERE k<60)
      INSERT INTO delivery_contacts(name,phone,area) SELECT 'Courier '||k,'000'||printf('%07d',5000+k),'Area' FROM n`,
    `WITH RECURSIVE n(k) AS (SELECT 1 UNION ALL SELECT k+1 FROM n WHERE k<40)
      INSERT INTO damaged_stock_lots(product_id,product_name,branch_id,batch_id,quantity,quantity_remaining,reason,condition_tag,source,created_at)
      SELECT 1000+k*97,'Product',1,500000+(k*97)*5,1,0,'seed','damaged','return',${ago('k', 'days')} FROM n`,
    // Business-day boundary rows: sales at 16:59:59 and 17:00:00 UTC, a return today on a 40-day-old sale, an old sale cancelled
    // today, a payment today on a month-old Not Paid sale.
    `INSERT INTO sales(id,receipt_number,cashier_id,cashier_name,branch_id,branch_name,payment_method,exchange_rate,sale_status,created_at,updated_at,money_precision_version,loyalty_accrual,search_normalized,stock_skipped,
        subtotal_usd,total_usd,subtotal_khr,total_khr,amount_paid_usd)
      VALUES (200001,'RB0000001',901,'Budget Admin',1,'Main Shop','Cash',4000,'completed',strftime('%Y-%m-%d','${anchorDate}','-1 day')||' 16:59:59',strftime('%Y-%m-%d','${anchorDate}','-1 day')||' 16:59:59',0,0,'rb0000001',0,10,10,40000,40000,10),
        (200002,'RB0000002',901,'Budget Admin',1,'Main Shop','Cash',4000,'completed',strftime('%Y-%m-%d','${anchorDate}','-1 day')||' 17:00:00',strftime('%Y-%m-%d','${anchorDate}','-1 day')||' 17:00:00',0,0,'rb0000002',0,10,10,40000,40000,10)`,
    `INSERT INTO sale_items(sale_id,product_id,product_name,sku,quantity,applied_price_usd,applied_price_khr,base_price_usd,base_price_khr,cost_price_usd,cost_price_khr,total_usd,total_khr,branch_id,batch_id,price_mode)
      SELECT 200001+(p.id%2),p.id,p.name,p.sku,1,10,40000,10,40000,p.cost_price_usd,p.cost_price_khr,10,40000,1,500000+(p.id-1000)*5+3,'selling' FROM products p WHERE p.id IN (1010,1011)`,
    `INSERT INTO returns(id,return_number,sale_id,receipt_number,cashier_id,cashier_name,customer_name,branch_id,branch_name,reason,total_refund_usd,total_refund_khr,exchange_rate,status,created_at,search_normalized)
      SELECT 9,'RT000009',s.id,s.receipt_number,901,'Budget Admin','Walk-in',1,'Main Shop','seed',8,32000,4000,'completed','${anchorDate} 04:00:00','rt000009'
      FROM sales s WHERE s.id=(SELECT MAX(id) FROM sales WHERE sale_status='completed' AND id<200000 AND created_at<=datetime(${A},'-40 days'))`,
    `INSERT INTO return_items(return_id,sale_item_id,product_id,product_name,quantity,applied_price_usd,total_usd,return_to_stock,branch_id,batch_id)
      SELECT 9,si.id,si.product_id,si.product_name,1,si.applied_price_usd,si.applied_price_usd,1,1,si.batch_id FROM sale_items si
      WHERE si.id=(SELECT MIN(x.id) FROM sale_items x WHERE x.sale_id=(SELECT sale_id FROM returns WHERE id=9))`,
    `UPDATE sales SET sale_status='cancelled',status_before_cancel='completed',cancel_reason='seed',cancelled_at='${anchorDate} 03:00:00',updated_at='${anchorDate} 03:00:00'
      WHERE id=(SELECT MAX(id) FROM sales WHERE sale_status='completed' AND id<200000 AND created_at<=datetime(${A},'-45 days'))`,
    `INSERT INTO sale_payment_events(event_id,sale_id,direction,origin,payment_method,payment_details,amount_paid_usd,exchange_rate,received_at,branch_id,cashier_id,cashier_name,created_at)
      SELECT 'ev-late-1',s.id,'in','late_record','Cash','[]',5,4000,'${anchorDate} 02:00:00',1,901,'Budget Admin','${anchorDate} 02:00:00'
      FROM sales s WHERE s.id=(SELECT MAX(id) FROM sales WHERE sale_status='awaiting_payment' AND id<200000 AND created_at<=datetime(${A},'-30 days'))`,
    "DELETE FROM system_flags WHERE key='stock_transaction_permit'",
    "DELETE FROM system_flags WHERE key='maintenance'",
    "INSERT INTO settings(key,value) VALUES('exchange_rate','4000'),('change_exchange_rate','4000'),('pos_payment_methods','[\"Cash\",\"ABA\"]') ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ]
}

module.exports = { seedSql, seedContext, ADMIN, P, C, S, POSITIVE_LOTS, BRANCH_STOCK_ROWS }
