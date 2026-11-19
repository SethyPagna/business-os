'use strict'
// Measures the D1 calls and the table rows written of each count-task route, over the real routes and migrations in an in-memory SQLite (harness/inv-app.cjs).
// A call is one round trip to D1: a prepared statement run on its own, or one batch (however many statements it holds). Rows written are the table rows the route's statements changed
// (total_changes(); the index entries a row writes are not counted). Rows READ are not measured here: the in-memory engine does not report them (the plans are pinned by
// test-migration-0318-inventory-check-task-index-pure.cjs). "cold" clears the Cache API entries first; "warm" repeats the same request.
//
// Run: node scripts/measure-inventory-check-tasks.cjs [--json]
const { createInvApp, USERS, person } = require('./harness/inv-app.cjs')

const COUNTER = { inventory_checks: true, inventory_check_show_stock: true, inventory_check_show_brand: true, inventory_check_show_category: true }
const users = { ...USERS, issuer: person(78, 'employee', { ...COUNTER, inventory_check_issue: true }), picker2: person(80, 'employee', COUNTER) }
const PRODUCTS = Number(process.env.TASK_PRODUCTS || 300)
const app = createInvApp({ users, mount: { '/api/products': 'routes/products.ts', '/api/inventory-checks': 'routes/inventoryChecks.ts' },
  seed(raw, seedStockFixture) {
    seedStockFixture(raw.db, () => {
      for (let id = 100; id < 100 + PRODUCTS; id++) {
        raw.prepare(`INSERT INTO products(id,name,sku,barcode,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,brand,category,is_active,created_at,updated_at) VALUES(?,?,?,?,?,9.5,38000,4,16000,?,?,1,'2026-09-01 00:00:00','2026-09-01 00:00:00')`)
          .run([id, `Item ${id}`, `SKU${id}`, `88500${id}`, 10, 'A', 'Cat'])
        raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,10)').run([id])
      }
    })
  } })
for (const name of ['ic_wired', 'ic_simple', 'ic_fix_stock', 'ic_lot_counts']) app.setSwitch(name, 'on')

let calls = 0
for (const name of ['prepare', 'batch', 'batchOnce']) { const original = app.env.DB[name]; app.env.DB[name] = (...args) => { calls++; return original.apply(app.env.DB, args) } }
const changes = () => Number(app.raw.db.prepare('SELECT total_changes() AS n').get().n)
const results = []
let n = 0
async function measure(label, run) {
  const c0 = calls, w0 = changes(), r = await run()
  results.push({ label, status: r.status, calls: calls - c0, rowsWritten: changes() - w0 })
  return r
}
;(async () => {
  const as = (key) => app.setUser(app.users[key])
  const send = (method, url, body) => app.send(method, `/api/inventory-checks${url}`, body)
  const ids = Array.from({ length: PRODUCTS }, (_, i) => 100 + i)
  as('admin')
  const issued = await measure(`issue ${PRODUCTS} products by id`, () => send('POST', '/tasks', { branchId: 1, requestId: `measure-issue-${++n}`, productIds: ids }))
  const task = issued.json.item.id
  await measure('issue by filter (brand) -> resolved ids', () => send('POST', '/tasks', { branchId: 1, requestId: `measure-issue-${++n}`, filters: { brand: 'A' } }))
  app.clearCaches()
  await measure('GET /tasks cold (2 open tasks)', () => app.get('/api/inventory-checks/tasks?branchId=1'))
  await measure('GET /tasks warm', () => app.get('/api/inventory-checks/tasks?branchId=1'))
  app.clearCaches()
  await measure('GET /list cold (no task, the base of the next two lines)', () => app.get('/api/inventory-checks/list?branchId=1&pageSize=50'))
  await measure('GET /list warm (no task)', () => app.get('/api/inventory-checks/list?branchId=1&pageSize=50'))
  app.clearCaches()
  await measure('GET /list?taskId= cold', () => app.get(`/api/inventory-checks/list?branchId=1&taskId=${task}&pageSize=50`))
  await measure('GET /list?taskId= warm', () => app.get(`/api/inventory-checks/list?branchId=1&taskId=${task}&pageSize=50`))
  as('checker')
  const picked = await measure('POST /tasks/:id/pickup', () => send('POST', `/tasks/${task}/pickup`, { requestId: `measure-pickup-${++n}` }))
  await measure('POST /tasks/:id/release', () => send('POST', `/tasks/${task}/release`, { requestId: `measure-release-${++n}` }))
  await send('POST', `/tasks/${task}/pickup`, { requestId: `measure-pickup-${++n}` })
  const lines = (from, to) => ids.slice(from, to).map((productId) => ({ productId, countedQuantity: 10, seenQuantity: 10 }))
  await measure('POST /submissions 40 products naming a task (task not complete)', () => send('POST', '/submissions', { branchId: 1, requestId: `measure-submit-${++n}`, taskId: task, lines: lines(0, 40) }))
  await measure('POST /submissions 40 products, no task (baseline of the same write)', () => send('POST', '/submissions', { branchId: 1, requestId: `measure-submit-${++n}`, lines: lines(40, 80) }))
  // Count the rest outside the task, leaving the last (at most 40) products to a submission that names it, so that one completes it.
  let from = 80
  while (PRODUCTS - from > 40) { await send('POST', '/submissions', { branchId: 1, requestId: `measure-submit-${++n}`, lines: lines(from, from + 40) }); from += 40 }
  const last = await measure(`POST /submissions ${PRODUCTS - from} products that complete the task (auto-close, pickup open)`, () => send('POST', '/submissions', { branchId: 1, requestId: `measure-submit-${++n}`, taskId: task, lines: lines(from, PRODUCTS) }))
  as('admin')
  const second = await send('POST', '/tasks', { branchId: 1, requestId: `measure-issue-${++n}`, productIds: ids.slice(0, 10) })
  await send('POST', `/tasks/${second.json.item.id}/pickup`, { requestId: `measure-pickup-${++n}` })
  await measure('PATCH /sessions/:id close a task with a pickup open', () => send('PATCH', `/sessions/${second.json.item.id}`, { expectedRevision: 0, requestId: `measure-close-${++n}`, action: 'close' }))
  as('checker')
  await measure('GET /sessions?mine=1 (one pickup row, board cold)', () => { app.clearCaches(); return app.get('/api/inventory-checks/sessions?mine=1') })
  const closedNote = last.json && last.json.task ? `(task closed: ${last.json.task.closed}, pickup answer ${picked.status})` : ''
  if (process.argv.includes('--json')) console.log(JSON.stringify(results, null, 1))
  else { console.log(`D1 calls and table rows written per request, ${PRODUCTS}-product world ${closedNote}`); for (const r of results) console.log(`${String(r.status).padEnd(4)} calls ${String(r.calls).padStart(3)}  rows written ${String(r.rowsWritten).padStart(5)}  ${r.label}`) }
})().catch((error) => { console.error(error); process.exit(1) })
