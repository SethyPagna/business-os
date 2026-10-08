const assert = require('node:assert/strict')
const { setup } = require('./test-intake-atomic-native.cjs')

function pauseAfter(f, pattern, method) {
  let reached, resume, once = true
  const entered = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Pause point not reached: ${pattern}`)), 20_000)
    timer.unref()
    reached = () => { clearTimeout(timer); resolve() }
  })
  const held = new Promise(resolve => { resume = resolve })
  const prepare = f.env.DB.prepare
  f.env.DB.prepare = text => {
    const wrap = statement => new Proxy(statement, { get(target, key) {
      if (key === 'bind') return (...params) => wrap(target.bind(...params))
      if (key === method) return async (...args) => {
        const result = await target[method](...args)
        if (once && pattern.test(text)) { once = false; reached(); await held }
        return result
      }
      return target[key]
    } })
    return wrap(prepare(text))
  }
  return { entered, resume: () => resume() }
}

function totals(f) {
  return {
    stock: f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity,
    movements: f.sql.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n,
    receipts: f.sql.prepare('SELECT COUNT(*) AS n FROM stock_mutation_receipts').get().n,
  }
}

let passed = 0, failed = 0
async function check(name, run) {
  try { await run(); passed++; console.log(`PASS ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}\n${error.stack}`) }
}

async function main() {
  for (const mode of ['add', 'correction', 'receive']) {
    for (const stale of [false, true]) await check(`${mode}: ${stale ? 'stale live' : 'ordinary'} overlapping claim`, async () => {
      const f = await setup(mode)
      const firstClaim = pauseAfter(f, /INSERT INTO stock_mutation_receipts/, 'all')
      const original = f.send()
      await firstClaim.entered
      if (stale) f.sql.exec("UPDATE stock_mutation_receipts SET created_at=datetime('now','-121 seconds')")
      const retry = await f.send()
      firstClaim.resume()
      const first = await original
      assert.deepEqual(totals(f), { stock: 8, movements: 1, receipts: 1 }, JSON.stringify({ first, retry }))
      assert.equal(stale ? retry.status : first.status, 200)
      assert.equal(stale ? first.status : retry.status, 409)
      assert.equal((await f.send()).body.replayed, true)
      f.sql.close()
    })
    await check(`${mode}: original commits while reclaimed retry is paused`, async () => {
      const f = await setup(mode)
      const firstClaim = pauseAfter(f, /INSERT INTO stock_mutation_receipts/, 'all')
      const original = f.send()
      await firstClaim.entered
      f.sql.exec("UPDATE stock_mutation_receipts SET created_at=datetime('now','-121 seconds')")
      const takeover = pauseAfter(f, /UPDATE stock_mutation_receipts SET created_at/, 'run')
      const retry = f.send()
      await takeover.entered
      firstClaim.resume()
      assert.equal((await original).status, 200)
      takeover.resume()
      assert.equal((await retry).status, 409)
      assert.deepEqual(totals(f), { stock: 8, movements: 1, receipts: 1 })
      assert.equal((await f.send()).body.replayed, true)
      f.sql.close()
    })
    await check(`${mode}: two reclaim attempts and live original still commit once`, async () => {
      const f = await setup(mode)
      const firstClaim = pauseAfter(f, /INSERT INTO stock_mutation_receipts/, 'all')
      const original = f.send()
      await firstClaim.entered
      f.sql.exec("UPDATE stock_mutation_receipts SET created_at=datetime('now','-121 seconds')")
      const retries = await Promise.all([f.send(), f.send()])
      firstClaim.resume()
      const first = await original
      assert.equal(first.status, 409)
      assert.equal(retries.filter(result => result.status === 200 && !result.body.replayed).length, 1)
      assert.deepEqual(totals(f), { stock: 8, movements: 1, receipts: 1 })
      f.sql.close()
    })
    for (const [name, sql] of [
      ['missing', 'DELETE FROM stock_mutation_receipts'],
      ['written', 'UPDATE stock_mutation_receipts SET written=1'],
      ['completed', "UPDATE stock_mutation_receipts SET completed_at=CURRENT_TIMESTAMP,response_status=200,response_json='{}'"],
      ['different payload', "UPDATE stock_mutation_receipts SET request_json='[]'"],
      ['different actor', 'UPDATE stock_mutation_receipts SET actor_id=99'],
      ['different kind', `UPDATE stock_mutation_receipts SET kind='${mode === 'receive' ? 'adjust' : 'receive'}'`],
    ]) await check(`${mode}: ${name} receipt refuses and rolls back the physical batch`, async () => {
      const f = await setup(mode)
      const before = f.state()
      let changedReceipt
      f.beforeCommit(() => {
        f.sql.exec(sql)
        changedReceipt = JSON.stringify(f.sql.prepare('SELECT * FROM stock_mutation_receipts').all())
      })
      const result = await f.send()
      assert.equal(result.status, 409, JSON.stringify(result))
      assert.equal(result.body.code, 'stock_request_in_flight')
      assert.equal(f.state(), before)
      assert.equal(JSON.stringify(f.sql.prepare('SELECT * FROM stock_mutation_receipts').all()), changedReceipt)
      if (name === 'missing') assert.equal((await f.send()).status, 200)
      f.sql.close()
    })
  }
  await check('standalone legacy mark also rejects an overlapping second writer', async () => {
    const f = await setup('correction')
    const db = f.load('lib/db.ts').getDb(f.env)
    const { withStockMutationReceipt } = f.load('lib/stockMutationReceipt.ts')
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
    const send = () => withStockMutationReceipt(() => db, 1, 'adjust', { client_request_id: 'legacy-overlap-fixture', quantity: 3 }, json,
      async mark => { await mark(); f.sql.exec('UPDATE branch_stock SET quantity=quantity+3'); return json({ success: true }) },
      { requireReceipt: true })
    const firstClaim = pauseAfter(f, /INSERT INTO stock_mutation_receipts/, 'all')
    const original = send()
    await firstClaim.entered
    f.sql.exec("UPDATE stock_mutation_receipts SET created_at=datetime('now','-121 seconds')")
    assert.equal((await send()).status, 200)
    firstClaim.resume()
    assert.equal((await original).status, 409)
    assert.equal(totals(f).stock, 8)
    f.sql.close()
  })
  console.log(JSON.stringify({ passed, failed }))
  if (failed) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 })
