import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const filename = fileURLToPath(new URL('../src/api/productWriteTransport.ts', import.meta.url))
const require = createRequire(import.meta.url)
const calls: Array<{ method: string; path: string; body: Record<string, unknown> }> = []
const routes: unknown[][] = []
let sequence = 0
const stubs: Record<string, unknown> = {
  './http.ts': {
    cacheInvalidate() {},
    apiFetch(method: string, path: string, body: Record<string, unknown>) {
      calls.push({ method, path, body }); return Promise.resolve({ success: true })
    },
    route(channel: string, send: () => Promise<unknown>, fallback: unknown, write: boolean) {
      routes.push([channel, fallback, write]); return send()
    },
  },
  './requestIds.ts': { ensureClientRequestId: (body: object, prefix: string) => ({ ...body, client_request_id: `${prefix}_${++sequence}` }) },
  './actorReadScope.ts': {},
  '../utils/deviceInfo.ts': {},
}
const output = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const exports: Record<string, (...args: any[]) => any> = {}
new Function('exports', 'require', output)(exports, (name: string) => stubs[name] ?? require(name))

const prepared = exports.prepareProductPairMergeRequest(1, 2, 'merge')
await exports.mergeProductPairRequest(prepared)
await exports.mergeProductPairRequest(prepared)
assert.deepEqual(calls[0], calls[1], 'prepared request retries keep every field and the original key')
assert.equal(sequence, 1, 'sending never generates a second request identity')
assert.deepEqual(prepared, { keepId: 1, mergeId: 2, stock: 'merge', client_request_id: 'product_merge_1' })

await exports.mergePossiblySameProducts(3, 4)
assert.deepEqual(calls[2].body, { keepId: 3, mergeId: 4, client_request_id: 'product_merge_2' })
await exports.mergePossiblySameProducts(5, 6, 'write_off')
assert.equal(calls[3].body.stock, 'write_off')

const resolve = { requestId: 'reviewed-group', reviewedDigest: 'digest', steps: [{ mergeId: 8, stock: 'merge' }] }
const choices = { name: { kind: 'value', value: 'Reviewed name' } }
await exports.mergePossiblySameProducts(7, 8, 'merge', { resolve, choices, cost_price_usd: 1.25, cost_price_khr: 5000 })
assert.deepEqual(calls[4].body, { keepId: 7, mergeId: 8, stock: 'merge', keep: true, resolve, choices, cost_price_usd: 1.25, cost_price_khr: 5000 })
assert.equal(sequence, 3, 'reviewed group keeps its own request token without an ordinary-pair key')
await exports.mergePossiblySameProducts(9, 10, undefined, { choices })
assert.deepEqual(calls[5].body, { keepId: 9, mergeId: 10, keep: true }, 'unreviewed choices stay omitted')
for (const call of calls) {
  assert.equal(call.method, 'POST')
  assert.equal(call.path, '/api/products/possible-duplicates/merge')
}
assert.ok(routes.every(route => JSON.stringify(route) === JSON.stringify(['products:mergePossiblySame', null, true])))
console.log('PASS prepared pair retries, positional compatibility, legacy write-off and reviewed group payload preservation')
