'use strict'
// GET /api/notifications/summary reads fewer than 500 rows on a production-sized database.
//
// Measured live on 27 Oct 2026: 56,283 rows read per call, 11 statements. Two causes, both gone: the sales queues
// (OR predicates walked all of `sales` once the database has ANALYZE statistics; test-notifications-sales-queues-pure.cjs)
// and the standing low / out-of-stock list (an 18k-row recompute; the bell now lists recorded crossings,
// test-notifications-stock-alerts-pure.cjs). This drives the REAL Worker under Miniflare, so the figure is D1's own
// rows_read from the Server-Timing header, on a database with ~8.7k products (a third of them low or empty), ~15.8k sales
// of which a few are unpaid or awaiting delivery, 12k audit rows, 3k recorded crossings over 30 days, and statistics.
//
// Run (from cloudflare/): node scripts/test-notifications-summary-rows-native.cjs
const { randomBytes } = require('node:crypto')
const { bootWorld, createReporter } = require('./harness/real_worker_world.cjs')

const SEED = [
  `WITH RECURSIVE n(j) AS (SELECT 0 UNION ALL SELECT j+1 FROM n WHERE j<8700)
   INSERT INTO products(id,name,barcode,sku,stock_quantity,selling_price_usd,cost_price_usd,is_active,low_stock_threshold,out_of_stock_threshold,created_at)
   SELECT 1000+j,'Product '||j,'885'||printf('%010d',j),'SKU-'||j,CASE WHEN j%3=0 THEN 0 WHEN j%3=1 THEN 6 ELSE 40 END,5,2,1,10,0,'2026-09-01 00:00:00' FROM n`,
  `WITH RECURSIVE n(k) AS (SELECT 0 UNION ALL SELECT k+1 FROM n WHERE k<15800)
   INSERT INTO sales(id,receipt_number,created_at,sale_status,total_usd)
   SELECT 20000+k,'S-'||k,'2026-09-0'||(1+k%9)||' 0'||(k%9)||':00:00',CASE WHEN k%900=0 THEN 'awaiting_payment' WHEN k%1300=0 THEN 'awaiting_delivery' ELSE 'completed' END,8 FROM n`,
  `WITH RECURSIVE n(k) AS (SELECT 0 UNION ALL SELECT k+1 FROM n WHERE k<12000)
   INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,created_at) SELECT 1,'admin','sale_create','sale',k,'{}',datetime('now','-'||(k/10)||' hours') FROM n`,
  `WITH RECURSIVE n(k) AS (SELECT 0 UNION ALL SELECT k+1 FROM n WHERE k<3000)
   INSERT INTO stock_crossing_alerts(alert_key,product_id,branch_id,tier,sale_id,quantity_before,quantity_after,created_at)
   SELECT 'k-'||k,1000+(k%8000),1,CASE WHEN k%4=0 THEN 'out' ELSE 'low' END,20000+k,12,CASE WHEN k%4=0 THEN 0 ELSE 8 END,strftime('%Y-%m-%dT%H:%M:%fZ','now','-'||(k*15)||' minutes') FROM n`,
]

async function main() {
  const world = await bootWorld({ adminPassword: randomBytes(12).toString('base64url') })
  const { check, finish } = createReporter()
  try {
    const cache = await world.mf.getKVNamespace('CACHE')
    void cache
    await world.run("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
    for (const sql of SEED) await world.run(sql)
    await world.run("DELETE FROM system_flags WHERE key='stock_transaction_permit'")
    await world.run('ANALYZE')

    const timing = async () => {
      const response = await world.mf.dispatchFetch('http://localhost/api/notifications/summary', { headers: { cookie: `bos_session=${world.tokens.admin}` } })
      const text = await response.text()
      const header = response.headers.get('server-timing') || ''
      return {
        status: response.status, json: JSON.parse(text),
        rows: Number(/rr=(\d+)/.exec(header)?.[1]), statements: Number(/q=(\d+)/.exec(header)?.[1]), trips: Number(/d1n;desc="(\d+)"/.exec(header)?.[1]),
      }
    }

    await check('the summary reads fewer than 500 rows on the seeded database, cold and warm', async (t) => {
      await timing() // the first request of the isolate also seeds and probes
      const first = await timing()
      const second = await timing()
      console.log(`        measured: ${first.statements} statements, ${first.trips} round trips, ${first.rows} rows read (second call ${second.rows})`)
      t.eq('status', first.status, 200)
      t.ok('rows read < 500', first.rows < 500, first)
      t.ok('rows read < 500 on the second call', second.rows < 500, second)
      t.ok('round trips <= 4', first.trips <= 4, first)
    })

    await check('the bell lists the newest crossings of the last day, not the 3k-row log and not a standing list', async (t) => {
      const { json } = await timing()
      const inventory = (json.sections || []).find((entry) => entry.id === 'inventory')
      t.ok('inventory section present', !!inventory)
      t.eq('listed', inventory?.items.length, 50)
      t.ok('all are crossings', (inventory?.items || []).every((item) => /^crossing-\d+$/.test(item.id)))
      t.ok('none is a plain low-stock product', !(inventory?.items || []).some((item) => /^(low|out)-/.test(item.id)))
    })
  } finally {
    await world.dispose()
  }
  finish('notification summary rows read')
}

main().catch((error) => { console.error(error); process.exit(1) })
