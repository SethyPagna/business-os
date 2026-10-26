import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import * as query from '../src/api/query.ts'
import * as transport from '../src/api/returnsStatementTransport.ts'

const source = fs.readFileSync(new URL('../src/api/returnsStatementApi.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const range = { startDate: '2026-09-20', endDate: '2026-09-20' }
const rows = Array.from({ length: 1001 }, (_, i) => ({ id: i + 1 }))
function fixture() {
  let allowed = true, failPage = false, changeToken = false, mutateDuringVerify = false
  const controller = new AbortController(), calls: URL[] = [], progress: number[] = []
  const module = { exports: {} as any }
  const http = { apiFetch: async (method: string, path: string, _body: unknown, timeout: number, options: { signal: AbortSignal }) => {
    assert.equal(method, 'GET'); assert.equal(timeout, 30000); assert.equal(options.signal, controller.signal)
    const url = new URL(path, 'https://fixture'); calls.push(url)
    assert.equal(url.pathname, '/api/returns/export'); assert.equal(url.searchParams.get('createdFrom'), '2026-09-19 17:00:00')
    if (url.searchParams.get('verify') === '1') {
      if (mutateDuringVerify) allowed = false
      return { rows: [], total: rows.length, snapshotToken: 'token', nextCursor: null }
    }
    const start = Number(url.searchParams.get('cursor') || 0)
    if (start && failPage) throw new Error('page failed')
    return { rows: rows.slice(start, start + 500), total: rows.length, snapshotToken: changeToken && start ? 'changed' : 'token', nextCursor: start + 500 < rows.length ? String(start + 500) : null }
  } }
  new Function('require', 'module', 'exports', code)((name: string) => name.includes('http') ? http : name.includes('query') ? query : transport, module, module.exports)
  const options = { signal: controller.signal, assertAllowed: () => { if (!allowed || controller.signal.aborted) throw new Error('authority changed') }, onProgress: (received: number) => progress.push(received) }
  return { load: module.exports.loadReturnStatement, options, calls, progress, controller, deny: () => { allowed = false }, fail: () => { failPage = true }, change: () => { changeToken = true }, revokeDuringVerify: () => { mutateDuringVerify = true } }
}
const happy = fixture()
const result = await happy.load(range, { scope: 'supplier', type: 'refund' }, happy.options)
assert.equal(result.rows.length, 1001); assert.deepEqual(happy.progress, [500, 1000, 1001]); assert.equal(happy.calls.length, 4)
await result.verifyBeforeExport(); assert.equal(happy.calls.length, 5, 'file-click revalidates again after dialog waiting')
assert.ok(happy.calls.every(url => url.searchParams.get('scope') === 'supplier' && url.searchParams.get('type') === 'refund'))
happy.deny(); await assert.rejects(result.verifyBeforeExport(), /authority changed/); assert.equal(happy.calls.length, 5)
for (const behavior of ['fail', 'change', 'revokeDuringVerify'] as const) {
  const f = fixture(); f[behavior]()
  await assert.rejects(f.load(range, {}, f.options), /page failed|changed|authority/)
}
const cancelled = fixture(); cancelled.controller.abort(); await assert.rejects(cancelled.load(range, {}, cancelled.options)); assert.equal(cancelled.calls.length, 0)
const missing = fixture(); await assert.rejects(missing.load(range, { ids: '1,2' }, { ...missing.options, expectedIds: [1, 2] }), /Selected returns changed/)
const invalid = fixture(); await assert.rejects(invalid.load({ startDate: '', endDate: '' }, {}, invalid.options), RangeError); assert.equal(invalid.calls.length, 0)
console.log('PASS real Returns statement adapter: complete paging, URL filters, final/file-click verification, cancellation, stale/failed pages, authority loss and exact selections')
