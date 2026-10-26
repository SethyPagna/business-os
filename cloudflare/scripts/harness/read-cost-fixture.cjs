// Production-shaped catalog for read-cost tests. P products (ids from 1000), ~12% in same-name families (a row per
// barcode), two branches, one lot per stocked row, galleries on some, customers with sales. Everything is generated in SQL.
function catalogFixture(P, customers) {
  return [
    "INSERT INTO system_flags(key,value) VALUES('stock_transaction_permit','legacy-separate-pool-v1')",
    "INSERT OR IGNORE INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1),(2,'Warehouse',1,0)",
    // name index n: ids sharing n % 8 groups share a name once every 8th product starts a family of 3
    `WITH RECURSIVE n(j) AS (SELECT 0 UNION ALL SELECT j+1 FROM n WHERE j<${P - 1}),
      shaped AS (SELECT j, 1000+j AS id, CASE WHEN j%8 IN (1,2) THEN j-j%8 ELSE j END AS nm FROM n)
      INSERT INTO products(id,name,barcode,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active,brand,category,low_stock_threshold,image_path,created_at)
      SELECT id,'Product '||nm||' '||(CASE nm%4 WHEN 0 THEN 'Serum' WHEN 1 THEN 'Cream' WHEN 2 THEN 'Powder' ELSE 'Balm' END),
        '885'||printf('%010d',id),'SKU-'||id,(CASE WHEN j%7=0 THEN 0 ELSE 5+j%30 END),
        5+j%20,(5+j%20)*4000,1+(j%9)/4.0,5000,1,'Brand'||(j%12),'Cat'||(j%6),CASE WHEN j%9=0 THEN 25 END,
        CASE WHEN j%3=0 THEN '/uploads/p'||id||'.webp' END,'2026-0'||(1+j%9)||'-1'||(j%9)||' 03:00:00' FROM shaped`,
    `INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,expiry_date)
      SELECT id+500000,id,'b-'||id,'L-'||id,'2026-0'||(1+(id-1000)%9)||'-01',1,1,'2027-06-01' FROM products WHERE id BETWEEN 1000 AND ${999 + P}`,
    `INSERT INTO branch_stock(product_id,branch_id,quantity) SELECT id,1,stock_quantity FROM products WHERE id BETWEEN 1000 AND ${999 + P} AND stock_quantity>0`,
    'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) SELECT product_id+500000,1,quantity FROM branch_stock WHERE branch_id=1',
    `INSERT INTO branch_stock(product_id,branch_id,quantity) SELECT id,2,4+(id-1000)%4 FROM products WHERE id BETWEEN 1000 AND ${999 + P} AND (id-1000)%3=0`,
    `INSERT INTO product_images(product_id,image_path,sort_order) SELECT id,'/uploads/g'||id||'.webp',0 FROM products WHERE id BETWEEN 1000 AND ${999 + P} AND (id-1000)%5=0`,
    `WITH RECURSIVE n(j) AS (SELECT 1 UNION ALL SELECT j+1 FROM n WHERE j<${customers}) INSERT INTO customers(id,name,phone,created_at) SELECT j,'Customer '||j,'0'||(10000000+j),'2026-0'||(1+j%9)||'-1'||(j%9)||' 03:00:00' FROM n`,
    `WITH RECURSIVE n(k) AS (SELECT 0 UNION ALL SELECT k+1 FROM n WHERE k<${Math.floor(customers * 1.5)})
      INSERT INTO sales(id,receipt_number,customer_id,customer_name,created_at,sale_status,subtotal_usd,total_usd)
      SELECT 900+k,'cost-'||k,1+k%${customers},'Customer '||(1+k%${customers}),'2026-10-1'||(k%9)||' 03:00:00','completed',8,8 FROM n`,
    `INSERT INTO sale_items(sale_id,product_id,branch_id,quantity,total_usd,total_khr,cost_price_usd,cost_price_khr)
      SELECT id,1000+(id*7)%${P},1,1+id%2,8,32000,1.75,5000 FROM sales WHERE id>=900`,
    // parent-linked variants (hand-made Variant modal), a discounted block, blank names and a live promotion rule
    `UPDATE products SET parent_id = id-(id-1000)%50, updated_at='2026-09-01 00:00:00' WHERE id BETWEEN 1000 AND ${999 + P} AND (id-1000)%50 IN (11,12) AND id-(id-1000)%50 >= 1000`,
    `UPDATE products SET is_group = 1 WHERE id BETWEEN 1000 AND ${999 + P} AND (id-1000)%50 = 0`,
    `UPDATE products SET discount_enabled=1, discount_type='percent', discount_percent=10 WHERE id BETWEEN 1000 AND ${999 + P} AND (id-1000)%40=3`,
    `UPDATE products SET updated_at='2026-09-01 00:00:00' WHERE id BETWEEN 1000 AND ${999 + P}`,
    `INSERT INTO products(id,name,barcode,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active,updated_at,created_at)
      VALUES(${1000 + P},'','8850000009991','SKU-BLANK-1',2,3,12000,1,4000,1,'2026-09-01 00:00:00','2026-09-02 00:00:00'),
            (${1001 + P},' ','8850000009992','SKU-BLANK-2',2,3,12000,1,4000,1,'2026-09-01 00:00:00','2026-09-02 00:00:00')`,
    // children of a blank-name parent: their family key is 'id:<parent id>', the only key shape with no name_key
    `UPDATE products SET parent_id=${1000 + P}, updated_at='2026-09-01 00:00:00' WHERE id IN (1005,1006,1007)`,
    // ~40 more blank-named rows with the SAME created_at: every family ties on name and date, so only the family key
    // (the terminal ORDER BY key) decides order, and the ties straddle page boundaries at every page size used
    `WITH RECURSIVE n(j) AS (SELECT 0 UNION ALL SELECT j+1 FROM n WHERE j<39)
      INSERT INTO products(id,name,barcode,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active,updated_at,created_at)
      SELECT ${1010 + P}+j,'','885000100'||printf('%04d',j),'SKU-TIE-'||j,0,3,12000,1,4000,1,'2026-09-01 00:00:00','2026-09-03 00:00:00' FROM n`,
    // 20 more ties whose ids change length (9990-9999, then 10001-10010): the family key is the STRING 'id:<id>', so key
    // order ('id:10001' < 'id:9990') disagrees with id order, and only the terminal family_root_id key puts them right
    `WITH RECURSIVE n(j) AS (SELECT 0 UNION ALL SELECT j+1 FROM n WHERE j<19)
      INSERT INTO products(id,name,barcode,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active,updated_at,created_at)
      SELECT CASE WHEN j<10 THEN 9990+j ELSE 10001+j-10 END,'','885000200'||printf('%04d',j),'SKU-TIE-LONG-'||j,0,3,12000,1,4000,1,'2026-09-01 00:00:00','2026-09-03 00:00:00' FROM n`,
    // Khmer names (one same-name family of two, one with a Latin word) and their search
    `INSERT INTO products(id,name,barcode,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active,brand,category,updated_at,created_at) VALUES
      (${1100 + P},'ក្រែមលាបមុខ','8850002000001','SKU-KM-1',0,4,16000,1,4000,1,'ម៉ាក','ថែរក្សាស្បែក','2026-09-01 00:00:00','2026-09-04 00:00:00'),
      (${1101 + P},'ក្រែមលាបមុខ','8850002000002','SKU-KM-2',0,5,20000,1,4000,1,'ម៉ាក','ថែរក្សាស្បែក','2026-09-01 00:00:00','2026-09-04 00:00:00'),
      (${1102 + P},'ក្រែមកក់ Serum','8850002000003','SKU-KM-3',0,6,24000,1,4000,1,'ម៉ាក','ថែរក្សាស្បែក','2026-09-01 00:00:00','2026-09-04 00:00:00'),
      (${1103 + P},'សាប៊ូ','8850002000004','SKU-KM-4',0,2,8000,1,4000,1,'ម៉ាក','ថែរក្សាស្បែក','2026-09-01 00:00:00','2026-09-04 00:00:00')`,
    // inactive rows: a family member (1009 shares its name with 1008), a parent whose children stay active (1050 is the
    // parent of 1061/1062), and loose inactive products. Stock is cleared first (stock never sits on an inactive product).
    `DELETE FROM branch_batch_stock WHERE batch_id IN (SELECT id FROM product_batches WHERE variant_product_id IN (1009,1050))`,
    `DELETE FROM branch_stock WHERE product_id IN (1009,1050)`,
    `UPDATE products SET stock_quantity=0 WHERE id IN (1009,1050)`,
    `UPDATE products SET is_active=0 WHERE id IN (1009,1050)`,
    `INSERT INTO products(id,name,barcode,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active,updated_at,created_at) VALUES
      (${1200 + P},'Retired Serum','8850003000001','SKU-OFF-1',0,3,12000,1,4000,0,'2026-09-01 00:00:00','2026-09-05 00:00:00'),
      (${1201 + P},'','8850003000002','SKU-OFF-2',0,3,12000,1,4000,0,'2026-09-01 00:00:00','2026-09-05 00:00:00')`,
    `INSERT INTO promotion_rules(id,title,rule_type,percent_off,scope_type,category,is_active,created_at,updated_at) VALUES(1,'Cat1 sale','percent_off',5,'category','Cat1',1,'2026-09-01 00:00:00','2026-09-01 00:00:00')`,
    "DELETE FROM system_flags WHERE key='stock_transaction_permit'",
  ]
}
module.exports = { catalogFixture }
