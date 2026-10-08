const assert = require('node:assert/strict')
const { setup } = require('./test-intake-atomic-native.cjs')

function pauseAfter(f, pattern, method) {
  let reached, resume, once = true
  const entered = new Promise(resolve => { reached = resolve })
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
  }
  console.log(JSON.stringify({ passed, failed }))
  if (failed) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 })
