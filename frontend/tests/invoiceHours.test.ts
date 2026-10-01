import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { transformSync } from 'esbuild'
import { invoiceRangeParams } from '../src/utils/invoiceRangeParams.ts'

const read = (name: string) => fs.readFileSync(new URL(`../src/components/contacts/${name}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
for (const [file, api] of [['ApInvoicesSection.tsx', 'getSupplierApInvoices'], ['ArInvoicesSection.tsx', 'getCustomerReceivables']]) {
  test(`${file} actual picker callback refuses missing dates without changing applied filters`, () => {
    const source = read(file), begin = source.indexOf('  const changeRange ='), end = source.indexOf('\n\n  /**', begin)
    assert.ok(begin >= 0 && end > begin)
    const code = transformSync(source.slice(begin, end), { loader: 'tsx', target: 'es2022' }).code
    const updates: string[] = [], notices: string[] = []
    const handler = new Function('ctx', `with(ctx){${code}; return changeRange}`)({
      invoiceRangeParams, notify: (message: string) => notices.push(message), tr: (key: string) => key,
      changeFilter: (fn: () => void) => fn(),
      setFromDate: (value: string) => updates.push(value), setToDate: (value: string) => updates.push(value),
      setStartTime: (value: string) => updates.push(value), setEndTime: (value: string) => updates.push(value),
    })
    assert.doesNotThrow(() => handler({ startDate: '', endDate: '', startTime: '09:00', endTime: '11:00' }))
    assert.deepEqual(updates, [])
    assert.deepEqual(notices, ['please_select_start_end_dates'])
    handler({ startDate: '2026-09-01', endDate: '2026-09-01', startTime: '09:00', endTime: '11:00' })
    assert.deepEqual(updates, ['2026-09-01', '2026-09-01', '09:00', '11:00'])
    updates.length = 0
    handler({ startDate: '', endDate: '', startTime: '', endTime: '' })
    assert.deepEqual(updates, ['', '', '', ''])
  })
  test(`${file} actual request effect forwards exact hours and all-time stays empty`, async () => {
    const source = read(file), begin = source.indexOf('  useEffect(() => {\n    const requestId = ++requestRef.current'), end = source.indexOf('\n\n  const totals', begin)
    assert.ok(begin >= 0 && end > begin)
    const code = transformSync(source.slice(begin, end), { loader: 'tsx', target: 'es2022' }).code
    let sent: any
    const create = new Function('ctx', `with(ctx){${code}}`)
    const context = {
      useEffect: (fn: () => unknown) => fn(), aliveRef: { current: true }, requestRef: { current: 0 },
      setLoading() {}, setError() {}, setPage() {}, setData() {}, branch: 'all', supplier: 'all', customer: 'all', status: 'all', page: 1, pageSize: 20, refreshToken: 0,
      invoiceRangeParams, tr: (_: string, fallback: string) => fallback,
      [api]: async (params: any) => { sent = params; return { total_invoices: 3 } }, clampPage: (page: number) => page,
    }
    create({ ...context, fromDate: '2026-09-01', toDate: '2026-09-01', startTime: '09:00', endTime: '11:00' })
    assert.equal(sent.createdFrom, '2026-09-01 02:00:00')
    assert.equal(sent.createdTo, '2026-09-01 04:01:00')
    create({ ...context, fromDate: '', toDate: '', startTime: '', endTime: '' })
    assert.equal(sent.from, '')
    assert.equal(sent.to, '')
    assert.equal(sent.createdFrom, undefined)
    assert.match(source, /\[fromDate, setFromDate\] = useState\(''\)/)
    assert.match(source, /\[toDate, setToDate\] = useState\(''\)/)
    assert.match(source, /\[startTime, setStartTime\] = useState\(''\)/)
    assert.match(source, /\[endTime, setEndTime\] = useState\(''\)/)
    assert.match(source, /showTime continuous/)
    assert.match(source, /invoice_unknown_time_included/)
    await Promise.resolve()
  })
}

test('full-day and all-time invoice ranges retain the legacy date-only protocol', () => {
  assert.deepEqual(invoiceRangeParams({}), { from: '', to: '' })
  assert.deepEqual(invoiceRangeParams({ startTime: '00:00', endTime: '23:59' }), { from: '', to: '' })
  assert.deepEqual(invoiceRangeParams({ startDate: '2026-09-01', endDate: '2026-09-02', startTime: '00:00', endTime: '23:59' }), { from: '2026-09-01', to: '2026-09-02' })
  for (const range of [
    { startTime: '09:00', endTime: '11:00' },
    { startDate: '2026-02-30', endDate: '2026-09-01', startTime: '09:00', endTime: '11:00' },
    { startDate: '2026-09-01', endDate: '2026-09-01', startTime: '11:00', endTime: '09:00' },
  ]) assert.throws(() => invoiceRangeParams(range), RangeError)
})
