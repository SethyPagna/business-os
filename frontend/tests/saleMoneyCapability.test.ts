import assert from 'node:assert/strict'
import fs from 'node:fs'
import { transformSync } from 'esbuild'

// Execute the production hook module, not a copied effect. The small scheduler
// models React's dependency cleanup and rerenders without importing the app.
let actor = 'A', revision = 1, cursor = 0
const slots: any[] = [], effects: (() => void)[] = [], requests: any[] = []
const hooks = {
  useRef(value: unknown) { const i = cursor++; return slots[i] ??= { current: value } },
  useState(value: unknown) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], (next: any) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next }] },
  useEffect(callback: any, deps: any[]) { const i = cursor++; const old = slots[i]; if (!old || deps.some((x, j) => !Object.is(x, old.deps[j]))) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: callback() } }) },
}
const module = { exports: {} as any }
const source = fs.readFileSync(new URL('../src/components/sales/useSaleMoneyCapability.ts', import.meta.url), 'utf8')
new Function('require', 'module', 'exports', transformSync(source, { loader: 'ts', format: 'cjs' }).code)(
  (name: string) => name === 'react' ? hooks : name.includes('actorReadScope') ? {
    captureActorReadScope: () => ({ authority: actor, revision }),
    isActorReadScopeCurrent: (scope: any) => scope.authority === actor && scope.revision === revision,
  } : { apiFetch: (...args: any[]) => new Promise((resolve, reject) => requests.push({ args, resolve, reject })) }, module, module.exports,
)
let enabled = true, security = 'sales-full'
const render = () => { cursor = 0; const result = module.exports.useSaleMoneyCapability(enabled, security); effects.splice(0).forEach(run => run()); return result }
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
assert.equal(render().ready, false)
assert.equal(requests[0].args[1], '/api/sales/money-precision-capability')
actor = 'B'; render()
assert.equal(requests[0].args[4].signal.aborted, true)
requests[0].resolve({ money_precision_version: 1, schema_ready: true }); await flush()
assert.equal(render().ready, false, 'old actor cannot publish readiness')
requests[1].resolve({ money_precision_version: 1, schema_ready: true }); await flush()
const oldReady = render(); assert.equal(oldReady.ready, true)
revision++; assert.throws(oldReady.assertReady, /money_precision_unavailable/, 'captured callback rechecks session after async work')
render(); requests[2].resolve({ money_precision_version: 1, schema_ready: true }); await flush()
assert.equal(render().ready, true)
security = 'sales-denied'; assert.equal(render().ready, false, 'same actor permission change invalidates')
requests[3].reject(new Error('403')); await flush()
const failed = render(); assert.equal(failed.failed, true); assert.equal(failed.ready, false)
failed.retry(); render(); requests[4].resolve({ money_precision_version: 1, schema_ready: false }); await flush()
assert.equal(render().ready, false, 'schema false never activates')
render().retry(); render(); enabled = false; render()
requests[5].resolve({ money_precision_version: 1, schema_ready: true }); await flush()
assert.equal(render().ready, false, 'disabled/unmounted effect cannot publish late success')
assert.equal(requests[5].args[4].signal.aborted, true)
console.log('PASS production capability hook: actor/session/permission/disabled late responses and retry')
