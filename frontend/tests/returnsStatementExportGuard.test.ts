import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const source = fs.readFileSync(new URL('../src/components/shared/ExportOptionsDialog.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('ExportOptionsDialog.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let expression = ''
function visit(node: ts.Node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'runExport') expression = node.initializer!.getText(ast); ts.forEachChild(node, visit) }
visit(ast); assert.ok(expression)
const compiled = ts.transpileModule(`const run = ${expression.replaceAll('import(', 'loadModule(')};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
function deferred() { let resolve!: (value?: any) => void, reject!: (reason?: any) => void; const promise = new Promise<any>((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
function fixture(format: string) {
  let allowed = true, downloads = 0, closes = 0, verifications = 0, imports = 0
  const busy: boolean[] = [], errors: string[] = []
  const env: any = {
    format, selected: new Set(['id']), rows: [{ id: 1 }], columns: [{ key: 'id', label: 'ID' }], fileBaseName: 'returns', rememberKey: 'returns', title: 'Returns',
    t: (key: string) => key, tr: (_t: unknown, _key: string, fallback: string) => fallback,
    exportBusyRef: { current: false }, mountedRef: { current: true }, exportAuthorityRef: { current: () => allowed },
    beforeExportRef: { current: async () => { verifications++ } }, exportAllowed: () => env.mountedRef.current && allowed,
    setBusy: (value: boolean) => busy.push(value), notify: (message: string) => errors.push(message),
    projectExportRows: (rows: unknown) => rows, saveRememberedColumns: () => {}, onClose: () => { closes++ },
    openPrintExport: () => { downloads++; return true }, loadModule: async () => { imports++; return { downloadCSV: () => { downloads++ }, downloadXLSX: () => { downloads++ } } },
  }
  const run = new Function('env', `with(env){${compiled};return run}`)(env)
  return { env, run, busy, errors, counts: () => ({ downloads, closes, verifications, imports }), deny: () => { allowed = false } }
}
for (const format of ['csv', 'xlsx', 'pdf']) {
  const f = fixture(format); await f.run(); assert.equal(f.counts().downloads, 1); assert.equal(f.counts().verifications, 1); assert.deepEqual(f.busy, [true, false])
  const failing = fixture(format); failing.env.beforeExportRef.current = async () => { throw new Error('snapshot changed') }; await failing.run(); assert.equal(failing.counts().downloads, 0); assert.deepEqual(failing.errors, ['snapshot changed']); assert.equal(failing.env.exportBusyRef.current, false)
  const delayed = fixture(format), verification = deferred(); delayed.env.beforeExportRef.current = () => verification.promise
  const first = delayed.run(); await Promise.resolve(); await Promise.resolve(); const second = delayed.run()
  delayed.deny(); verification.resolve(); await Promise.all([first, second]); assert.equal(delayed.counts().downloads, 0); assert.equal(delayed.counts().closes, 0); assert.equal(delayed.env.exportBusyRef.current, false)
  const cancel = fixture(format); cancel.env.beforeExportRef.current = async () => { const error = new Error('cancel'); error.name = 'AbortError'; throw error }; await cancel.run(); assert.equal(cancel.counts().downloads, 0); assert.deepEqual(cancel.errors, [])
}
const importing = fixture('xlsx'), moduleReady = deferred(); importing.env.loadModule = () => moduleReady.promise
const pending = importing.run(); await importing.run(); importing.deny(); moduleReady.resolve({ downloadXLSX: () => { throw new Error('must not download') } }); await pending
assert.equal(importing.counts().verifications, 0, 'revoked during lazy import does not even verify/download')
const duplicate = fixture('csv'), gate = deferred(); duplicate.env.beforeExportRef.current = () => gate.promise
const first = duplicate.run(); const second = duplicate.run(); await Promise.resolve(); gate.resolve(); await Promise.all([first, second]); assert.equal(duplicate.counts().downloads, 1); assert.equal(duplicate.counts().imports, 1)
console.log('PASS actual export-dialog callbacks: three formats, delayed imports/verification, revocation, cancellation, failure cleanup and single-flight clicks')

const page = fs.readFileSync(new URL('../src/components/returns/Returns.tsx', import.meta.url), 'utf8')
const pageAst = ts.createSourceFile('Returns.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let statementCallback = ''
function findStatement(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(pageAst) === 'exportStatement') statementCallback = (node.initializer as ts.CallExpression).arguments[0].getText(pageAst)
  ts.forEachChild(node, findStatement)
}
findStatement(pageAst); assert.ok(statementCallback)
const statementCode = ts.transpileModule(`const run = ${statementCallback.replaceAll('import(', 'loadModule(')};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
function statementFixture() {
  const requests: any[] = [], messages: string[] = []
  let dialog: any = null, progress: any = null, next: Promise<any> | null = null
  const env: any = {
    exportRequestRef: { current: null }, exportScope: 'A', exportScopeRef: { current: 'A' }, isActive: true, isKhmer: false, canViewReturns: true, canExportReturns: true,
    captureActorReadScope: () => 'A', assertActorReadScope: () => {}, user: { id: 1 }, canViewAcquisitionCosts: () => false,
    scope: 'customer', SUPPLIER_SCOPE: 'supplier', search: 'current search', typeFilter: 'damaged', returnsDateRange: { startDate: '2026-09-20', endDate: '2026-09-20', startTime: '08:00', endTime: '09:00' },
    tr: (_key: string, fallback: string) => fallback, notify: (message: string) => messages.push(message), exportReturnRows: (rows: unknown) => rows,
    setExportProgress: (value: unknown) => { progress = value }, setExportDialog: (value: unknown) => { dialog = value },
    closeExport: () => { env.exportRequestRef.current?.controller.abort(); env.exportRequestRef.current = null; progress = null; dialog = null },
    loadModule: async () => ({ loadReturnStatement: async (range: unknown, filters: any, options: any) => {
      requests.push({ range, filters, options }); options.assertAllowed()
      if (next) return next
      const rows = options.expectedIds ? options.expectedIds.map((id: number) => ({ id })) : Array.from({ length: 1001 }, (_, i) => ({ id: i + 1 }))
      options.onProgress(rows.length, rows.length)
      return { rows, assertCurrent: () => {}, verifyBeforeExport: async () => {} }
    } }),
  }
  const run = new Function('env', `with(env){${statementCode};return run}`)(env)
  return { env, run, requests, messages, dialog: () => dialog, progress: () => progress, defer: (value: Promise<any>) => { next = value } }
}
const full = statementFixture(); await full.run('returns-filtered')
assert.equal(full.dialog().rows.length, 1001, 'complete-scope UI does not reuse the bounded loaded list')
assert.deepEqual(full.requests[0].filters, { scope: 'customer', search: 'current search', type: 'damaged' })
assert.equal(full.requests[0].range.startTime, '08:00'); assert.equal(full.dialog().allowed(), true)
full.env.exportScopeRef.current = 'B'; assert.equal(full.dialog().allowed(), false, 'mounted stale dialog cannot publish after actor/filter scope change')
const exact = statementFixture(); await exact.run('returns-selected', [{ id: 9 }, { id: 2 }, { id: 9 }], false)
assert.deepEqual(exact.requests[0].options.expectedIds, [2, 9]); assert.deepEqual(exact.dialog().rows, [{ id: 2 }, { id: 9 }]); assert.equal(exact.requests[0].filters.type, undefined)
const stale = statementFixture(), incoming = deferred(); stale.defer(incoming.promise)
const loading = stale.run('returns-filtered'); await Promise.resolve(); await Promise.resolve(); stale.env.exportScopeRef.current = 'B'
incoming.resolve({ rows: [{ id: 1 }], assertCurrent: () => {}, verifyBeforeExport: async () => {} }); await loading
assert.equal(stale.dialog(), null); assert.equal(stale.progress(), null)
const failed = statementFixture(); failed.defer(Promise.reject(new Error('partial page failed'))); await failed.run('returns-filtered'); assert.equal(failed.dialog(), null); assert.deepEqual(failed.messages, ['partial page failed'])
console.log('PASS actual Returns page callback: complete-vs-selected scope, exact IDs, timed filters, progress cleanup and stale/partial no-dialog handoff')
