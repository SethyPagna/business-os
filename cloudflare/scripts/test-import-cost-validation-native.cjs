const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const harnessPath = path.join(__dirname, 'test-import-invocation-budget-native.cjs')
let harness = fs.readFileSync(harnessPath, 'utf8')
const mainStart = harness.indexOf('async function main()')
assert.ok(mainStart > 0, 'bounded harness must exclude stress main')
harness = harness.slice(0, mainStart)
harness = harness.replace('log: new Log(LogLevel.ERROR),', "outboundService: () => new Response('External requests blocked', { status: 503 }), log: new Log(LogLevel.ERROR),")
const module_ = { exports: {} }
new Function('require', '__dirname', 'module', harness + '\nmodule.exports = { world, waitFor, sub }')(createRequire(harnessPath), __dirname, module_)
const { world, waitFor, sub } = module_.exports
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function rows(h, id, phase) { return (await h.idb.prepare('SELECT row_number,action,result_json FROM import_job_rows WHERE job_id=? AND phase=? ORDER BY row_number').bind(id, phase).all()).results }
async function create(h, csv, policy = {}) {
  const result = await h.api('POST', '/api/import-jobs', { type: 'products', policy })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  const id = result.body.job.id
  const upload = await h.upload(`/api/import-jobs/${id}/csv`, 'external-cost.csv', csv)
  assert.equal(upload.status, 200, JSON.stringify(upload.body))
  return id
}
async function analyze(h, id) {
  assert.equal((await h.api('POST', `/api/import-jobs/${id}/start`, {})).status, 200)
  const job = await waitFor(h, id, ['awaiting_review'], 90000)
  assert.equal(job.status, 'awaiting_review', JSON.stringify(job))
}
async function apply(h, id, statuses = ['completed', 'completed_with_errors']) {
  const response = await h.api('POST', `/api/import-jobs/${id}/approve`, {})
  assert.equal(response.status, 200, JSON.stringify(response.body))
  const job = await waitFor(h, id, statuses, 90000)
  assert.ok(statuses.includes(job.status), JSON.stringify(job))
  return job
}
async function seed(h, name, cost = 7) { await h.db.prepare('INSERT INTO products(name,cost_price_usd,stock_quantity,is_active) VALUES(?,?,0,1)').bind(name, cost).run() }
async function product(h, name) { return h.q1('SELECT id,name,cost_price_usd,cost_price_khr,stock_quantity,is_active FROM products WHERE name=?', name) }
;(async () => {
  for (const plan of (process.env.IMPORT_COST_PLANS || 'free,paid').split(',')) {
    const h = await world({ plan, mutant: null })
    const cases = []
    try {
      await h.invocations(true)
      await seed(h, 'Keeper')
      await seed(h, 'Invalid target')
      await seed(h, 'Omitted keeper')
      const cap = plan === 'free' ? 125 : 500
      const csv = ['name,cost_usd,stock_quantity,_action', ...Array.from({ length: cap }, () => 'Keeper,,0,skip_row'), 'Invalid target,12oops,0,', 'Valid peer,5.1234,0,'].join('\n')
      const id = await create(h, csv)
      const preflight = await h.api('POST', `/api/import-jobs/${id}/preflight`, {})
      assert.equal(preflight.status, 200)
      assert.equal(preflight.body.checkedRows, cap)
      assert.equal(preflight.body.partial, true)
      assert.equal(preflight.body.failures.length, 0)
      await analyze(h, id)
      assert.equal((await rows(h, id, 'analyze')).find(row => row.row_number === cap + 2).action, 'error')
      await apply(h, id)
      assert.equal((await product(h, 'Invalid target')).cost_price_usd, 7)
      assert.equal((await product(h, 'Valid peer')).cost_price_usd, 5.1234)
      assert.equal((await product(h, 'Keeper')).stock_quantity, 0)
      const before = await h.q1('SELECT COUNT(*) AS n FROM inventory_movements')
      const retried = await h.api('POST', `/api/import-jobs/${id}/retry`, {})
      assert.equal(retried.status, 200, JSON.stringify(retried.body))
      const retryJob = await waitFor(h, id, ['awaiting_review'], 90000)
      assert.equal(retryJob.status, 'awaiting_review')
      await apply(h, id)
      assert.equal((await product(h, 'Invalid target')).cost_price_usd, 7)
      assert.equal((await h.q1('SELECT COUNT(*) AS n FROM inventory_movements')).n, before.n)
      cases.push('malformed beyond preflight, valid peer, retry preserves inventory movement count')

      const aliases = ['cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'purchase_price_khr', 'cost_usd', 'cost_khr']
      const invalidAliases = await create(h, ['name,' + aliases.join(','), ...aliases.map((field, index) => 'Alias invalid ' + index + ',' + aliases.map(key => key === field ? '12oops' : '').join(','))].join('\n'))
      await analyze(h, invalidAliases)
      assert.equal((await rows(h, invalidAliases, 'analyze')).filter(row => row.action === 'error').length, 6)
      await apply(h, invalidAliases)
      assert.equal((await h.q1("SELECT COUNT(*) AS n FROM products WHERE name LIKE 'Alias invalid %'")).n, 0)
      const tiny = await create(h, 'name,cost_usd\nTiny rejected,0.0000000000000000000000001')
      await analyze(h, tiny)
      const tinyRow = (await rows(h, tiny, 'analyze'))[0]
      assert.equal(tinyRow.action, 'error')
      assert.equal(JSON.parse(tinyRow.result_json).code, 'invalid_cost')
      await apply(h, tiny)
      assert.equal(await product(h, 'Tiny rejected'), null)
      cases.push('all six raw external aliases and tiny kernel rejection refuse invalid values')

      await seed(h, 'Old materialized')
      const old = await create(h, 'name,cost_usd\nOld materialized,7')
      await analyze(h, old)
      await h.idb.prepare("UPDATE import_job_source_rows SET data_json=json_set(data_json,'$.cost_usd','12oops') WHERE job_id=?").bind(old).run()
      await apply(h, old)
      assert.equal((await rows(h, old, 'apply'))[0].action, 'error')
      assert.equal((await product(h, 'Old materialized')).cost_price_usd, 7)
      cases.push('old materialized raw row revalidated during actual apply')

      const replacement = await create(h, 'name,cost_usd\nInvalid target,12oops\nReplacement peer,4.1234', { import_mode: 'replace_all' })
      await analyze(h, replacement)
      const replacementJob = await apply(h, replacement, ['failed'])
      assert.match(replacementJob.last_error, /cannot remove omitted products|product_replacement_incomplete/i)
      assert.equal((await product(h, 'Omitted keeper')).is_active, 1)
      assert.equal((await product(h, 'Invalid target')).is_active, 1)
      cases.push('replacement refusal preserves intended and omitted catalog')

      const skipped = await create(h, 'name,cost_usd\nInvalid target,12oops', { import_mode: 'replace_all' })
      await analyze(h, skipped)
      const decision = await h.api('PATCH', `/api/import-jobs/${skipped}/decisions`, { decisions: { '2': { action: 'skip' } } })
      assert.equal(decision.status, 200, JSON.stringify(decision.body))
      await apply(h, skipped)
      assert.equal((await product(h, 'Invalid target')).is_active, 1, 'explicit skip must preserve its matched malformed-cost target')
      cases.push('explicit skipped malformed target preserved')

      const metrics = await h.invocations(true)
      const maxima = { fetch: Math.max(0, ...metrics.filter(x => x.type === 'fetch').map(sub)), queue: Math.max(0, ...metrics.filter(x => x.type === 'queue').map(sub)) }
      assert.ok(metrics.every(x => sub(x) <= (plan === 'free' ? 50 : 1000)), JSON.stringify(maxima))
      console.log('PASS', plan, JSON.stringify({ cases, maxima, invocations: metrics.length }))
    } finally { await h.dispose() }
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
