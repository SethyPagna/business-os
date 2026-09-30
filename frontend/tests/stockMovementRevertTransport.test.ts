import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const calls: Array<{ method: string; url: string; body: unknown }> = []
const routes: Array<{ channel: string; local: unknown; fresh: unknown }> = []
let refusal: Error | null = null
const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8'))
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8'))
const reply = { success: true, revert: { kind: 'stock_set', movementId: 81, historyId: 43, direction: 'undo', expectedGeneration: 0, operationId: 'synthetic-op', lineCount: 3 } }
const stubs: Record<string, unknown> = {
  './http.ts': {
    apiFetch: async (method: string, url: string, body: unknown) => { calls.push({ method, url, body }); if (refusal) throw refusal; return reply },
    route: async (channel: string, server: () => unknown, local: unknown, fresh: unknown) => { routes.push({ channel, local, fresh }); return server() },
  },
  './query.ts': {},
  '../utils/deviceInfo.ts': { getClientDeviceInfo: () => ({ device_id: 'synthetic-device' }) },
  '../lang/en.json': en,
  '../lang/km.json': km,
}
const module = { exports: {} as Record<string, (...args: any[]) => Promise<unknown>> }
const source = readFileSync(new URL('../src/api/actionHistoryTransport.ts', import.meta.url), 'utf8')
new Function('module', 'exports', 'require', transformSync(source, { loader: 'ts', format: 'cjs', supported: { 'dynamic-import': false } }).code)(module, module.exports, (name: string) => {
  assert.ok(Object.hasOwn(stubs, name), name)
  return stubs[name]
})
assert.equal(await module.exports.getStockMovementRevertPreview(81), reply)
assert.deepEqual(calls, [{ method: 'GET', url: '/api/action-history/movements/81/revert-preview', body: undefined }])
assert.deepEqual(routes, [], 'preview bypasses route cache and write-outcome handling; no cached generation or local fallback')
for (const direction of ['undo', 'redo']) {
  await module.exports[`${direction}ActionHistory`](43, { require_applied: true, expected_generation: 0 })
  assert.deepEqual(calls.at(-1), { method: 'POST', url: `/api/action-history/43/${direction}`, body: { device_id: 'synthetic-device', require_applied: true, expected_generation: 0 } })
}
for (const lang of ['en', 'km']) {
  Object.assign(globalThis, { document: { documentElement: { getAttribute: () => lang } } })
  for (const code of ['undo_history_stale', 'undo_history_unusable']) {
    refusal = Object.assign(new Error('Synthetic server refusal'), { status: 409, code })
    const expected = (lang === 'km' ? km : en)[code.replace('undo_', 'undo_refused_')]
    await assert.rejects(module.exports.getStockMovementRevertPreview(81), (error: unknown) => error === refusal && refusal?.message === expected)
  }
}
refusal = Object.assign(new Error('Forbidden'), { status: 403 })
await assert.rejects(module.exports.getStockMovementRevertPreview(81), (error: unknown) => error === refusal && refusal?.message === 'Forbidden')
console.log('PASS actual movement preview and History transports: read-only preview, captured zero generation, device attribution and require_applied')
