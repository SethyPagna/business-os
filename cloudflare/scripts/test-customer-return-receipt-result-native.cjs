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
    'missing-results', 'missing-results-receipt-unreadable', 'missing-receipt-datum', 'wrong-digest', 'failed-postcondition']) {
    const f = await fixture(1)
    const options = scenario === 'cold-retries' ? { transient: true, quotaTransient: true }
      : scenario === 'lost-ack-receipt-unreadable' ? { lostAck: true, receiptFailure: true }
      : scenario === 'lost-ack' ? { lostAck: true }
      : scenario === 'missing-results-receipt-unreadable' ? { receiptFailure: true } : {}
    if (scenario === 'cold-retries') {
      f.raw.prepare('DELETE FROM cache_versions').run()
      f.env.CACHE.put = async () => { throw new Error('fixture KV unavailable') }
    }
    if (scenario === 'failed-postcondition') {
      f.raw.exec('CREATE TRIGGER invalidate_receipt AFTER INSERT ON return_create_receipts BEGIN DELETE FROM return_create_receipts WHERE id=NEW.id; END;')
    }
    const observed = meter(f.raw, 50, 10, options)
    let injectedBatches = 0
    const injectResult = ['missing-results', 'missing-results-receipt-unreadable', 'missing-receipt-datum', 'wrong-digest'].includes(scenario)
    if (injectResult) {
      const commit = observed.db.batchOnce.bind(observed.db)
      observed.db.batchOnce = async (...args) => {
        const results = await commit(...args)
        injectedBatches++
        if (scenario.startsWith('missing-results')) return []
        if (scenario === 'missing-receipt-datum') {
          const receiptIndices = results.flatMap((result, index) => result.results?.some(row => typeof row.request_digest === 'string') ? [index] : [])
          assert.equal(receiptIndices.length, 1)
          return results.map((result, index) => index === receiptIndices[0] ? { ...result, results: [] } : result)
        }
        return results.map(result => ({ ...result, results: result.results?.map(row =>
          typeof row.request_digest === 'string' ? { ...row, request_digest: 'wrong-digest' } : row) }))
      }
    }
    const result = await request(observed.db, '/', f.body, f.env)
    const rolledBack = scenario === 'failed-postcondition'
    const unknown = ['lost-ack-receipt-unreadable', 'missing-results-receipt-unreadable', 'missing-receipt-datum', 'wrong-digest'].includes(scenario)
    assert.equal(result.status, rolledBack ? 409 : unknown ? 503 : 200, JSON.stringify(result))
    if (unknown) assert.equal(result.body.code, 'unknown_outcome')
    if (injectResult) assert.equal(injectedBatches, 1)
    assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
    assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM returns').get().n, rolledBack ? 0 : 1)
    assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM return_create_receipts').get().n, rolledBack ? 0 : 1)
    assert.equal(f.raw.prepare('SELECT stock_quantity FROM products WHERE id=10').get().stock_quantity, rolledBack ? 0 : 1)
    const receiptReads = observed.events.filter(event => event.kind === 'read' && /JOIN return_create_receipts/.test(event.sql)).length
    if (scenario === 'success' || scenario === 'cold-retries') assert.equal(receiptReads, 1, 'successful commit must reuse its returned durable receipt')
    if (scenario.startsWith('missing-results')) assert.equal(receiptReads, 2)
    if (scenario === 'missing-receipt-datum' || scenario === 'wrong-digest') assert.equal(receiptReads, 1)
    if (scenario === 'missing-results') {
      const durable = f.raw.prepare('SELECT response_json FROM return_create_receipts').get()
      assert.deepEqual(result.body, JSON.parse(durable.response_json))
    }
    // 6.0.905: the return alert reads its lines in one statement after the settings read (was two reads before it):
    // four fewer attempts with transient retries, so the same worst case now lands at 46 of the Free 50.
    if (scenario === 'cold-retries') assert.equal(observed.used(), 46, 'stock admission consumes the historical one-statement reserve within the Free limit')
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
