import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const calls: Array<{ method: string; url: string; body: unknown }> = []
const routes: Array<{ channel: string; local: unknown; fresh: unknown }> = []
const reply = { success: true, revert: { kind: 'stock_set', movementId: 81, historyId: 43, direction: 'undo', expectedGeneration: 0, operationId: 'synthetic-op', lineCount: 3 } }
const stubs: Record<string, unknown> = {
  './http.ts': {
    apiFetch: async (method: string, url: string, body: unknown) => { calls.push({ method, url, body }); return reply },
    route: async (channel: string, server: () => unknown, local: unknown, fresh: unknown) => { routes.push({ channel, local, fresh }); return server() },
  },
  './query.ts': {},
  '../utils/deviceInfo.ts': { getClientDeviceInfo: () => ({ device_id: 'synthetic-device' }) },
}
const module = { exports: {} as Record<string, (...args: any[]) => Promise<unknown>> }
const source = readFileSync(new URL('../src/api/actionHistoryTransport.ts', import.meta.url), 'utf8')
new Function('module', 'exports', 'require', transformSync(source, { loader: 'ts', format: 'cjs' }).code)(module, module.exports, (name: string) => {
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
console.log('PASS actual movement preview and History transports: read-only preview, captured zero generation, device attribution and require_applied')
