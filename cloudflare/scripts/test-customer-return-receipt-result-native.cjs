const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const file = path.join(__dirname, 'test-customer-return-budget-native.cjs')
const source = fs.readFileSync(file, 'utf8')
const harness = new Module(file, module)
harness.filename = file
harness.paths = module.paths
harness._compile(source.slice(0, source.indexOf('async function main()')) + '\nmodule.exports={fixture,meter,request}', file)
const { fixture, meter, request } = harness.exports

async function main() {
  for (const scenario of ['success', 'cold-retries', 'lost-ack', 'lost-ack-receipt-unreadable',
    'missing-results', 'wrong-digest', 'failed-postcondition']) {
    const f = await fixture(1)
    const options = scenario === 'cold-retries' ? { transient: true, quotaTransient: true }
      : scenario === 'lost-ack-receipt-unreadable' ? { lostAck: true, receiptFailure: true }
      : scenario === 'lost-ack' ? { lostAck: true } : {}
    if (scenario === 'cold-retries') {
      f.raw.prepare('DELETE FROM cache_versions').run()
      f.env.CACHE.put = async () => { throw new Error('fixture KV unavailable') }
    }
    if (scenario === 'failed-postcondition') {
      f.raw.exec('CREATE TRIGGER invalidate_receipt AFTER INSERT ON return_create_receipts BEGIN DELETE FROM return_create_receipts WHERE id=NEW.id; END;')
    }
    const observed = meter(f.raw, 50, 10, options)
    if (scenario === 'missing-results' || scenario === 'wrong-digest') {
      const commit = observed.db.batchOnce.bind(observed.db)
      observed.db.batchOnce = async (...args) => {
        const results = await commit(...args)
        if (scenario === 'missing-results') return []
        return results.map(result => ({ ...result, results: result.results?.map(row =>
          typeof row.request_digest === 'string' ? { ...row, request_digest: 'wrong-digest' } : row) }))
      }
    }
    const result = await request(observed.db, '/', f.body, f.env)
    const rolledBack = scenario === 'failed-postcondition'
    const unknown = ['lost-ack-receipt-unreadable', 'missing-results', 'wrong-digest'].includes(scenario)
    assert.equal(result.status, rolledBack ? 409 : unknown ? 503 : 200, JSON.stringify(result))
    if (unknown) assert.equal(result.body.code, 'unknown_outcome')
    assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM returns').get().n, rolledBack ? 0 : 1)
    assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM return_create_receipts').get().n, rolledBack ? 0 : 1)
    assert.equal(f.raw.prepare('SELECT stock_quantity FROM products WHERE id=10').get().stock_quantity, rolledBack ? 0 : 1)
    const receiptReads = observed.events.filter(event => event.kind === 'read' && /JOIN return_create_receipts/.test(event.sql)).length
    if (scenario === 'success' || scenario === 'cold-retries') assert.equal(receiptReads, 1, 'successful commit must reuse its returned durable receipt')
    if (scenario === 'cold-retries') assert.equal(observed.used(), 49, 'one statement remains for the stock bridge')
    if (!rolledBack) {
      const retry = meter(f.raw, 50, 10)
      const replay = await request(retry.db, '/', f.body, f.env)
      assert.equal(replay.status, 200)
      assert.equal(retry.events.length, 1)
      assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM returns').get().n, 1)
      assert.equal(f.raw.prepare('SELECT stock_quantity FROM products WHERE id=10').get().stock_quantity, 1)
    }
    f.raw.db.close()
    console.log(`PASS customer return receipt result ${scenario}: ${observed.used()} attempted statements`)
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
