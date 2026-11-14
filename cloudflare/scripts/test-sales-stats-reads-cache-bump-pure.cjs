'use strict'
// lane/sales-stats-reads items 7 and 8 (audit #25, writes audit C3).
//   7. getSalesReadCacheVersion reads its five namespaces with ONE getVersionsWithFallback call: the same tokens as five getVersionWithFallback reads, with at
//      most one D1 statement for the namespaces KV does not hold (the single reader paid one statement per missing namespace).
//   8. The settings version bump that follows a newly registered payment method is awaited before the sale responds (a bump left in waitUntil can land after a
//      peer's refetch re-cached the old list).
// Runs the REAL lib/cache.ts and lib/cacheKey.ts with a fake KV and a fake D1; a mutant of the plural reader must be caught by the equivalence matrix.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function load(relative, requireFor, patch) {
  const filename = path.join(__dirname, '..', 'src', relative)
  let text = fs.readFileSync(filename, 'utf8')
  if (patch) {
    assert.equal(text.split(patch.from).length, 2, 'mutant anchor must occur once: ' + patch.from)
    text = text.replace(patch.from, () => patch.to)
  }
  const { outputText } = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename })
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(mod.exports, requireFor, mod, filename, path.dirname(filename))
  return mod.exports
}

const NAMESPACES = ['sales', 'returns', 'customers', 'products', 'stock']
const UNSAFE = /^unsafe:/
// a world: kv rows, d1 rows, and what fails. Counts D1 statements.
function world({ kv = {}, d1 = {}, kvFails = false, d1Fails = false }, patch) {
  const calls = { d1: 0 }
  const db = {
    prepare() {
      return {
        async get(params) { calls.d1++; if (d1Fails) throw new Error('D1 unavailable'); return params.namespace in d1 ? { version: d1[params.namespace] } : undefined },
        async all(params) { calls.d1++; if (d1Fails) throw new Error('D1 unavailable'); return JSON.parse(params.namespaces).filter((n) => n in d1).map((n) => ({ namespace: n, version: d1[n] })) },
      }
    },
  }
  const cacheKey = load('lib/cacheKey.ts', (id) => (id === './readSwitches' ? { readDataEpoch: async () => 'a'.repeat(32) } : require(id)))
  const cache = load('lib/cache.ts', (id) => (id === './db' ? { getDb: () => db } : id === './quotaGuard' ? { consumeQuota: async () => ({ zone: 'ok' }) } : id === './cacheKey' ? cacheKey : require(id)), patch)
  const env = { CACHE: { async get(key) { if (kvFails) throw new Error('KV unavailable'); const ns = NAMESPACES.find((n) => key.includes(n)); return ns && ns in kv ? String(kv[ns]) : null } } }
  return { cache, env, calls, cacheKey }
}
const settle = async (promise) => { try { return { ok: await promise } } catch (error) { return { threw: String(error.message) } } }
// an unsafe token is unique per call by design: equal means "both unsafe"
const norm = (tokens) => (Array.isArray(tokens) ? tokens.map((t) => (UNSAFE.test(String(t)) ? 'UNSAFE' : t)) : tokens)

async function matrix(patch) {
  const rows = []
  const kvStates = [{}, { sales: 7, returns: 3, customers: 5, products: 9, stock: 2 }, { sales: 7, customers: 5, stock: 2 }]
  const d1States = [{}, { sales: 70, returns: 30, customers: 50, products: 90, stock: 20 }, { returns: 30, products: 90 }]
  for (const kv of kvStates) for (const d1 of d1States) for (const kvFails of [false, true]) for (const d1Fails of [false, true]) {
    const single = world({ kv, d1, kvFails, d1Fails })
    const plural = world({ kv, d1, kvFails, d1Fails }, patch)
    const a = await settle(Promise.all(NAMESPACES.map((ns) => single.cache.getVersionWithFallback(single.env, ns))))
    const b = await settle(plural.cache.getVersionsWithFallback(plural.env, NAMESPACES))
    rows.push({ label: JSON.stringify({ kv, d1, kvFails, d1Fails }), a: a.threw ? { threw: true } : { ok: norm(a.ok) }, b: b.threw ? { threw: true } : { ok: norm(b.ok) }, singleCalls: single.calls.d1, pluralCalls: plural.calls.d1 })
  }
  return rows
}

;(async () => {
  const rows = await matrix()
  assert.ok(rows.length === 3 * 3 * 2 * 2)
  for (const row of rows) {
    assert.deepEqual(row.b, row.a, 'the plural reader must return exactly the single reader tokens (or refuse exactly when it refuses): ' + row.label)
    assert.ok(row.pluralCalls <= 1, 'at most one D1 statement for the namespaces KV does not hold: ' + row.label)
    assert.ok(row.pluralCalls <= row.singleCalls, 'never more statements than the single reads: ' + row.label)
  }
  const saved = rows.filter((row) => row.pluralCalls < row.singleCalls)
  assert.ok(saved.length >= 4, 'the matrix must hold states where KV misses several namespaces (the saving), has ' + saved.length)
  assert.ok(rows.some((row) => row.a.ok && row.a.ok.includes('UNSAFE')), 'the matrix must cover the unsafe-token state (D1 fails, KV holds nothing)')
  assert.ok(rows.some((row) => row.a.threw), 'the matrix must cover the refusal state (KV fails and D1 holds nothing)')
  console.log(`ok    7a: ${rows.length} states, same tokens/refusals; D1 statements ${Math.max(...rows.map((r) => r.singleCalls))} -> ${Math.max(...rows.map((r) => r.pluralCalls))} at worst, saved in ${saved.length} states`)

  // required reds: a plural reader that changes a token must be caught
  for (const [label, patch] of [
    ['d1 token labelled as kv', { from: "token = kv.value != null ? cacheVersionToken('kv', kv.value) : d1 != null ? cacheVersionToken('d1', d1) : null", to: "token = kv.value != null ? cacheVersionToken('kv', kv.value) : d1 != null ? cacheVersionToken('kv', d1) : null" }],
    ['never-bumped namespace gets another zero', { from: "read.set(namespace, token ?? (d1Failed.value ? unsafeVersionToken() : cacheVersionToken('kv', '0')))", to: "read.set(namespace, token ?? (d1Failed.value ? unsafeVersionToken() : cacheVersionToken('kv', '1')))" }],
    ['a failed D1 read invents the zero token', { from: "read.set(namespace, token ?? (d1Failed.value ? unsafeVersionToken() : cacheVersionToken('kv', '0')))", to: "read.set(namespace, token ?? cacheVersionToken('kv', '0'))" }],
  ]) {
    let caught = false
    try {
      for (const row of await matrix(patch)) { try { assert.deepEqual(row.b, row.a) } catch { caught = true; break } }
    } catch (error) { caught = true }
    assert.ok(caught, 'required red not caught: ' + label)
    console.log(`ok    7b: required red caught: ${label}`)
  }

  // the route reads through the plural reader, with the namespaces unchanged
  const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'sales.ts'), 'utf8').replace(/\r\n/g, '\n')
  const fn = route.slice(route.indexOf('async function getSalesReadCacheVersion'), route.indexOf('function appendLocalTimeRange'))
  assert.match(fn, /const namespaces = \['sales', 'returns', 'customers', 'products', 'stock'\] as const/)
  assert.match(fn, /await getVersionsWithFallback\(env, namespaces\)/, 'one plural read')
  assert.doesNotMatch(fn, /getVersionWithFallback\(/, 'no per-namespace reads')
  assert.match(fn, /versions\.map\(\(version, index\) => `\$\{namespaces\[index\]\}:\$\{version\}`\)\.join\('\|'\)/, 'the folded key text is unchanged')
  console.log('ok    7c: getSalesReadCacheVersion uses one getVersionsWithFallback and folds the same key text')

  // 8: the settings bump is awaited in the request, guarded so it cannot fail the sale, and no longer lives in waitUntil
  const create = route.slice(route.indexOf("app.post('/', async (c)"), route.indexOf("app.post('/', async (c)") + 200000)
  const at = create.indexOf('registerUsedPaymentMethods(c.env')
  assert.ok(at > 0)
  const block = create.slice(at - 80, at + 700)
  assert.match(block, /const addedPaymentMethods = await registerUsedPaymentMethods\(c\.env, \{ payment_method: paymentMethod, payment_details: effectivePaymentDetails \}\)/, 'the registration is awaited')
  assert.match(block, /if \(addedPaymentMethods\.length\) \{\n\s+try \{ await bumpVersion\(c\.env, 'settings'\) \} catch/, 'the bump is awaited and guarded (a failed bump must not fail a recorded sale)')
  assert.doesNotMatch(block, /waitUntil\(\s*registerUsedPaymentMethods/, 'the registration/bump must not be handed to waitUntil')
  assert.doesNotMatch(block, /\.then\(\(added\)/, 'the bump must not hang off a then() in waitUntil')
  // the order the sale already used for its own bump: bump awaited first, the broadcast/telegram after, off the response path
  const sale = create.slice(create.indexOf("await bumpVersions(c.env, ['stock', 'sales'])"), at + 700)
  assert.ok(sale.indexOf("await bumpVersions(c.env, ['stock', 'sales'])") < sale.indexOf('waitUntil(broadcast(c.env'), "the sale's own bump precedes its broadcast")
  const afterBump = create.slice(at, at + 2500)
  assert.ok(afterBump.indexOf("await bumpVersion(c.env, 'settings')") < afterBump.indexOf('waitUntil(sendTelegramEvent'), 'the Telegram send (waitUntil) follows the awaited bump')
  console.log('ok    8: the settings bump is awaited and guarded, before the response; Telegram stays after it')
  console.log('\nall green')
})().catch((error) => { console.error(error); process.exit(1) })
