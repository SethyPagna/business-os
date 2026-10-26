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
    `INSERT INTO promotion_rules(id,title,rule_type,percent_off,scope_type,category,is_active,created_at,updated_at) VALUES(1,'Cat1 sale','percent_off',5,'category','Cat1',1,'2026-09-01 00:00:00','2026-09-01 00:00:00')`,
    "DELETE FROM system_flags WHERE key='stock_transaction_permit'",
  ]
}
module.exports = { catalogFixture }
