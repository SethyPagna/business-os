const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { transformSync } = require('esbuild')

const root = path.resolve(__dirname, '..')
const cache = new Map()
function load(relative) {
  const file = path.resolve(root, relative)
  if (cache.has(file)) return cache.get(file).exports
  const source = fs.readFileSync(file, 'utf8')
  const mod = { exports: {} }
  cache.set(file, mod)
  const compiled = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  new Function('require', 'module', 'exports', compiled)((id) => {
    if (id.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(file), id)) + '.ts')
    return require(id)
  }, mod, mod.exports)
  return mod.exports
}

const { ReportMoneyAccumulator, ReportMoneyPrecisionError } = load('src/lib/reportMoneyPrecision.ts')
const scalar = (id, channel, value_usd, version = 1) => ({ kind: 'saved_scalar', id, channel, value_usd, money_precision_version: version })
const cost = (id, cost_price_usd, quantity, version = 1) => ({ kind: 'item_cost', id, channel: 'cost_of_goods', cost_price_usd, quantity, money_precision_version: version })
const refusal = (code, fn) => assert.throws(fn, (error) => error instanceof ReportMoneyPrecisionError && error.code === code)

const exact = new ReportMoneyAccumulator()
exact.addPage([cost('line:1', '1.2345', '.3333')])
assert.equal(exact.totals().cost_of_goods, '0.4115')
const unrounded = new ReportMoneyAccumulator(); unrounded.addPage([cost('line:precise', '1.2345', '.33335')])
assert.equal(unrounded.totals().cost_of_goods, '0.4115')
for (const tiny of [1e-10, '1e-10']) {
  const accumulator = new ReportMoneyAccumulator(); accumulator.addPage([cost(`tiny:${String(tiny)}:${typeof tiny}`, '1.2345', tiny)])
  assert.equal(accumulator.totals().cost_of_goods, '0.0000')
}

const whole = new ReportMoneyAccumulator()
whole.addPage([scalar('d1', 'sale_calculated_total', '1.2345')])
whole.addPage([scalar('d2', 'sale_calculated_total', '1.2345')])
assert.equal(whole.totals().sale_calculated_total, '2.4690')
assert.equal(Number(Number(whole.totals().sale_calculated_total).toFixed(2)), 2.47)
const partition = new ReportMoneyAccumulator()
partition.addPage([scalar('day:a', 'sale_calculated_total', '0.1000')])
partition.addPage([scalar('day:b', 'sale_calculated_total', '0.2000')])
assert.equal(partition.totals().sale_calculated_total, '0.3000')

const signed = new ReportMoneyAccumulator()
signed.addPage([
  scalar('sale:1:raw', 'sale_calculated_total', '10.0045'),
  scalar('sale:1:adjustment', 'sale_rounding_adjustment', '-0.0045'),
  scalar('sale:1:cancel', 'cancellation', '-10.0000'),
])
assert.deepEqual(signed.totals(), { sale_calculated_total: '10.0045', sale_rounding_adjustment: '-0.0045', refund_payout: '0.0000', cancellation: '-10.0000', cost_of_goods: '0.0000' })
refusal('duplicate_row', () => signed.addPage([scalar('sale:1:adjustment', 'sale_rounding_adjustment', '-0.0045')]))

const unknown = new ReportMoneyAccumulator()
unknown.addPage([cost('unknown:1', null, '2')])
assert.equal(unknown.totals().cost_of_goods, '0.0000')
assert.deepEqual(unknown.diagnostics(), [{ code: 'unknown_cost', row_id: 'unknown:1' }])
assert.equal(unknown.complete(), false)

for (const bad of [null, '', 'NaN', 'Infinity', '1.00000', 1 / 3]) {
  refusal('invalid_saved_money4', () => new ReportMoneyAccumulator().addPage([scalar(`bad:${String(bad)}`, 'refund_payout', bad)]))
}
refusal('unsupported_precision_version', () => new ReportMoneyAccumulator().addPage([scalar('legacy', 'refund_payout', '1.0000', 0)]))
refusal('unsupported_row', () => new ReportMoneyAccumulator().addPage([{ ...scalar('channel', 'refund_payout', '1.0000'), channel: 'other' }]))
refusal('invalid_quantity', () => new ReportMoneyAccumulator().addPage([cost('bad-q', '1.0000', 'Infinity')]))
refusal('invalid_quantity', () => new ReportMoneyAccumulator().addPage([cost('unknown-bad-q', null, 'Infinity')]))
for (const zero of [0, '0', '0e-10']) refusal('invalid_quantity', () => new ReportMoneyAccumulator().addPage([cost(`zero:${String(zero)}`, '1.0000', zero)]))
refusal('invalid_saved_money4', () => new ReportMoneyAccumulator().addPage([cost('missing-cost', undefined, '1')]))
refusal('invalid_saved_money4', () => new ReportMoneyAccumulator().addPage([cost('negative-cost', '-1.0000', '1')]))
refusal('too_many_rows', () => new ReportMoneyAccumulator(1).addPage([scalar('a', 'refund_payout', 1), scalar('b', 'refund_payout', 1)]))
const samePageOverflow = new ReportMoneyAccumulator()
samePageOverflow.addPage([scalar('max', 'refund_payout', '100000000000.0000'), scalar('more', 'refund_payout', '0.0001')])
refusal('aggregate_overflow', () => samePageOverflow.totals())
refusal('aggregate_overflow', () => new ReportMoneyAccumulator().addPage([cost('product-overflow', '100000000000.0000', '2')]))
for (const ordered of [[['plus', '0.0001'], ['minus', '-0.0001']], [['minus', '-0.0001'], ['plus', '0.0001']]]) {
  const boundary = new ReportMoneyAccumulator()
  boundary.addPage([scalar('base', 'refund_payout', '100000000000.0000')])
  boundary.addPage(ordered.map(([id, value]) => scalar(id, 'refund_payout', value)))
  assert.equal(boundary.totals().refund_payout, '100000000000.0000')
}
for (const ordered of [[['plus', '0.0001'], ['minus', '-0.0001']], [['minus', '-0.0001'], ['plus', '0.0001']]]) {
  const boundary = new ReportMoneyAccumulator()
  boundary.addPage([scalar('cross-base', 'refund_payout', '100000000000.0000')])
  for (const [id, value] of ordered) boundary.addPage([scalar(`cross:${id}`, 'refund_payout', value)])
  assert.equal(boundary.totals().refund_payout, '100000000000.0000')
}
const finalOverflow = new ReportMoneyAccumulator()
finalOverflow.addPage([scalar('overflow-base', 'refund_payout', '100000000000.0000')])
finalOverflow.addPage([scalar('overflow-extra', 'refund_payout', '0.0001')])
refusal('aggregate_overflow', () => finalOverflow.totals())

const atomic = new ReportMoneyAccumulator()
refusal('invalid_saved_money4', () => atomic.addPage([scalar('valid', 'refund_payout', '1.0000'), scalar('bad', 'refund_payout', '1.00000')]))
assert.equal(atomic.rowCount(), 0)

const started = process.hrtime.bigint()
const memoryBefore = process.memoryUsage().heapUsed
const benchmark = new ReportMoneyAccumulator(65_000)
const rows = []
for (let i = 0; i < 15_000; i++) rows.push(scalar(`header:${i}`, 'sale_calculated_total', '1.2345'))
for (let i = 0; i < 50_000; i++) rows.push(cost(`item:${i}`, '1.2345', '.3333'))
for (let offset = 0; offset < rows.length; offset += 500) benchmark.addPage(rows.slice(offset, offset + 500))
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6
const heapDeltaMiB = (process.memoryUsage().heapUsed - memoryBefore) / 1024 / 1024
assert.equal(benchmark.rowCount(), 65_000)
assert.equal(benchmark.totals().sale_calculated_total, '18517.5000')
assert.equal(benchmark.totals().cost_of_goods, '20575.0000')
console.log(`PASS synthetic 15k headers + 50k items, pages=500, elapsed_ms=${elapsedMs.toFixed(1)}, heap_delta_mib=${heapDeltaMiB.toFixed(1)} (in-memory only; excludes D1 query latency)`)
console.log('report money precision pure: all cases pass')
