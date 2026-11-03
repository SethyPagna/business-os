'use strict'
// Rows the P0.1 read-budget seed lacks and the report_atomic parity needs, added to a booted read-budget world (synthetic ids only):
//   a riel refund today on a completed sale, a Not Paid return today that only lowers the debt (no cash out), a sale line with an unknown
//   cost, and a store-paid delivery with its linked fee. Returns what it touched so a test can assert the rows exist.
async function seedReportExtras(world, ctx) {
  const day = ctx.anchorDate
  const anchor = `'${ctx.anchor}'`
  const one = async (sql) => {
    const row = (await world.all(sql))[0]
    if (!row) throw new Error('seedReportExtras: no row for ' + sql.slice(0, 120))
    return row
  }
  const recent = (offset) => one(`SELECT s.id, s.receipt_number FROM sales s WHERE s.sale_status='completed' AND s.id<200000 AND s.created_at >= datetime(${anchor},'-6 hours') ORDER BY s.id DESC LIMIT 1 OFFSET ${offset}`)
  const khrSale = await one(`SELECT s.id, s.receipt_number FROM sales s WHERE s.sale_status='completed' AND s.id<200000 AND s.created_at BETWEEN datetime(${anchor},'-4 days') AND datetime(${anchor},'-2 days') ORDER BY s.id DESC LIMIT 1`)
  const notPaidSale = await one(`SELECT s.id, s.receipt_number FROM sales s WHERE s.sale_status='awaiting_payment' AND s.id<200000 AND s.created_at >= datetime(${anchor},'-20 days') ORDER BY s.id DESC LIMIT 1`)
  const unknownCostSale = await recent(2)
  const deliverySale = await recent(4)
  const returnRow = (id, sale, usd, khr, currency, owed, at) => world.db.prepare(`INSERT INTO returns(id,return_number,sale_id,receipt_number,cashier_id,cashier_name,customer_name,branch_id,branch_name,reason,
      total_refund_usd,total_refund_khr,exchange_rate,status,created_at,search_normalized,refund_currency,owed_reduction_usd)
    VALUES (?,?,?,?,901,'Budget Admin','Walk-in',1,'Main Shop','seed',?,?,4000,'completed',?,?,?,?)`).bind(id, 'RT' + String(id).padStart(6, '0'), sale.id, sale.receipt_number, usd, khr, `${day} ${at}`, 'rt' + id, currency, owed)
  const returnItem = (id, sale, usd) => world.db.prepare(`INSERT INTO return_items(return_id,sale_item_id,product_id,product_name,quantity,applied_price_usd,total_usd,return_to_stock,branch_id,batch_id)
    SELECT ?,si.id,si.product_id,si.product_name,1,?,?,1,1,si.batch_id FROM sale_items si WHERE si.id=(SELECT MIN(x.id) FROM sale_items x WHERE x.sale_id=?)`).bind(id, usd, usd, sale.id)
  const results = await world.db.batch([
    returnRow(9101, khrSale, 5, 20000, 'KHR', 0, '03:30:00'), returnItem(9101, khrSale, 5),
    returnRow(9102, notPaidSale, 3, 0, 'USD', 3, '03:45:00'), returnItem(9102, notPaidSale, 3),
    world.db.prepare('UPDATE sale_items SET cost_price_usd=NULL WHERE id=(SELECT MIN(x.id) FROM sale_items x WHERE x.sale_id=?)').bind(unknownCostSale.id),
    world.db.prepare("UPDATE sales SET is_delivery=1,delivery_fee_usd=2,delivery_fee_paid_by='store',delivery_actual_cost_usd=1.5 WHERE id=?").bind(deliverySale.id),
    world.db.prepare(`INSERT INTO fees(sale_id,fee_type,label,amount_usd,amount_khr,fee_date,branch_id,branch_name,created_by,created_by_name,created_at)
      VALUES (?,'delivery','Delivery',1.5,0,?,1,'Main Shop',901,'Budget Admin',?)`).bind(deliverySale.id, day, `${day} 03:00:00`),
  ])
  if (!results.every((r) => r.success)) throw new Error('seedReportExtras: a statement failed')
  return { khrSale: khrSale.id, notPaidSale: notPaidSale.id, unknownCostSale: unknownCostSale.id, deliverySale: deliverySale.id }
}

module.exports = { seedReportExtras }
