import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { createRequire } from 'node:module'
import { feeRangeParams } from '../src/api/feesTransport.ts'
import { reportQueryParams, REPORT_VIEWS } from '../src/components/sales/reports/reportModel.ts'

const range = { startDate: '2026-09-20', endDate: '2026-09-21', startTime: '22:00', endTime: '02:00' }
const exact = feeRangeParams(range)
assert.deepEqual(exact, { from: '2026-09-20', to: '2026-09-21', createdFrom: '2026-09-20 15:00:00', createdTo: '2026-09-20 19:01:00' })
const report = reportQueryParams({ ...range, branchId: '', status: '', paymentMethod: '' }, REPORT_VIEWS.find(view => view.supportsTime)!)
assert.equal(exact.createdFrom, report.createdFrom)
assert.equal(exact.createdTo, report.createdTo)
assert.deepEqual(feeRangeParams({ ...range, startTime: '00:00', endTime: '23:59' }), { from: range.startDate, to: range.endDate })
assert.equal(feeRangeParams({ ...range, startDate: '2026-09-20', endDate: '2026-09-20', startTime: '00:00', endTime: '00:00' }).createdFrom, '2026-09-19 17:00:00')
for (const invalid of [{ ...range, endDate: range.startDate }, { ...range, startDate: '' }, { ...range, startTime: '25:00' }, { ...range, startDate: '2026-02-30' }]) {
  assert.throws(() => feeRangeParams(invalid), RangeError)
}

const require = createRequire(import.meta.url)
const source = fs.readFileSync(new URL('../src/api/feesTransport.ts', import.meta.url), 'utf8')
const channels: string[] = []
const paths: string[] = []
const module = { exports: {} as any }
new Function('exports', 'require', 'module', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(module.exports, (id: string) => {
  if (id === './http.ts') return {
    route: (channel: string, work: () => unknown) => { channels.push(channel); return work() },
    apiFetch: async (_method: string, path: string) => {
      paths.push(path)
      const url = new URL(path, 'https://test.invalid')
      const count = url.searchParams.get('limit') === '500' ? (url.searchParams.get('offset') === '0' ? 500 : 1) : 1
      return { fees: Array.from({ length: count }, (_, id) => ({ id })), total: 501, summary: [] }
    },
  }
  if (id === './query.ts') return require('../src/api/query.ts')
  if (id.includes('moneyPrecision')) return require('../src/utils/moneyPrecision.ts')
  if (id.includes('reportModel')) return require('../src/components/sales/reports/reportModel.ts')
  if (id.includes('syncProblemLifecycle')) return {}
  throw new Error(id)
}, module)
await module.exports.getFees({ ...exact, limit: 25, offset: 0 })
await module.exports.getFees({ ...exact, createdFrom: '2026-09-20 16:00:00', limit: 25, offset: 0 })
await module.exports.getFeesReport(exact)
assert.notEqual(channels[0], channels[1], 'time-only change changes the cache and in-flight key')
assert.ok(channels.every(channel => channel.includes('createdFrom=') && channel.includes('createdTo=')))
const rows = await module.exports.getAllFeesForExport(exact)
assert.equal(rows.length, 501)
for (const path of paths.slice(-2)) {
  const query = new URL(path, 'https://test.invalid').searchParams
  assert.equal(query.get('createdFrom'), exact.createdFrom)
  assert.equal(query.get('createdTo'), exact.createdTo)
}
assert.deepEqual(paths.slice(-2).map(path => new URL(path, 'https://test.invalid').searchParams.get('offset')), ['0', '500'])
const page = fs.readFileSync(new URL('../src/components/fees/FeesPage.tsx', import.meta.url), 'utf8')
assert.equal((page.match(/\.\.\.feeRangeParams\(stripRange\)/g) || []).length, 3, 'list, statistics, and filtered export share one range')
assert.equal((page.match(/\}, \[[^\n]*stripRange\.startTime[^\n]*stripRange\.endTime/g) || []).length, 4, 'list, statistics, reset-page, and export callbacks react to both times')
assert.match(page, /range=\{stripRange\}\s+showTime/)
console.log('PASS expense timed ranges: Reports parity, UTC+7, inclusive end minute, cache keys, pagination and filtered export')
