'use strict'
// W3 Slice A (bump-before-response). A cache-version bump for products / stock / returns (and the sales version a stock-moving write
// moves with them) must be AWAITED after the commit and BEFORE the response. Run inside `waitUntil` it races the next read by the same actor
// (the bell's version-gated fresh read, a stock-filtered product list): the read keys on the old version and serves the old body, and a
// broadcast that shares the waitUntil can reach a peer before the bump lands.
//
// This is an AST census of every bumpVersion / bumpVersions call in cloudflare/src:
//   * a call with a waitUntil ancestor must be on the CLASSIFIED list below (a namespace that is not products / stock / returns), and
//   * no waitUntil argument may call a notify helper whose body bumps products / stock / returns (the helper is split into bump... + announce...).
// A new waitUntil-bump of a protected namespace is red; a new classified one needs a line in DEFERRED_NOT_PROTECTED with its reason.
//
// Run (from cloudflare/): node scripts/test-bump-before-response-pure.cjs
// BUMP_SRC_ROOT=<dir containing src/> points it at another checkout (used for the required-red run on the old code).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = process.env.BUMP_SRC_ROOT || path.join(__dirname, '..')
const srcDir = path.join(root, 'src')
const files = []
;(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (full.endsWith('.ts')) files.push(full)
  }
})(srcDir)

const PROTECTED = /'(products|stock|returns)'|RETURN_WRITE_CACHE_NAMESPACES|MAINTENANCE_CACHE_NAMESPACES/
const isBump = (name) => /^(bumpVersions?)$/.test(name)

// Deferred bumps that are NOT products / stock / returns, each with the reason it may stay off the response path.
const DEFERRED_NOT_PROTECTED = [
  ['src/routes/contacts.ts', "bumpVersion(c.env, config.table)", 'customers / suppliers / delivery_contacts create'],
  ['src/routes/contacts.ts', "bumpVersion(c.env, 'customers')", 'customers list (3 handlers)'],
  ['src/routes/portal.ts', "bumpVersion(c.env, 'customers')", 'portal sign-up customers list'],
  ['src/routes/pos.ts', "bumpVersion(c.env, 'settings')", 'POS settings'],
  ['src/routes/promotions.ts', "bumpVersion(c.env, 'promotions')", 'promotion CRUD; checkout re-reads prices live'],
  ['src/routes/returns.ts', "bumpVersion(c.env, 'settings')", 'return reason presets'],
  ['src/routes/sales.ts', "bumpVersion(c.env, 'settings')", 'a payment method typed at the till joins the settings list'],
  ['src/routes/settings.ts', "bumpVersion(c.env, 'settings')", 'settings writers'],
  ['src/routes/settings.ts', "bumpVersion(c.env, 'sales')", 'settings write that also moves the sales list (no stock)'],
  ['src/routes/system.ts', "bumpVersion(c.env, section)", 'section reset of customers / suppliers / delivery contacts'],
  ['src/routes/system.ts', "bumpVersion(c.env, 'sales')", 'legacy subtotal repair changes sales only'],
  ['src/lib/telegramTopicSetting.ts', "bumpVersion(env, 'settings')", 'Telegram topic setting'],
]

const rel = (file) => path.relative(root, file).split(path.sep).join('/')
const sites = []
const waitUntilNotify = []
const bumpingHelpers = new Set()

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true)
  // lib helpers: a bump<X> helper bumps a protected namespace; a notify<X> helper bumps if its body does, or calls a protected bump<X> helper
  if (rel(file).startsWith('src/lib/')) {
    const decls = []
    const collect = (node) => {
      if (ts.isFunctionDeclaration(node) && node.name && node.body) decls.push(node)
      ts.forEachChild(node, collect)
    }
    collect(sf)
    const bumps = (decl, known) => {
      let found = false
      const scan = (n) => {
        if (ts.isCallExpression(n)) {
          const callee = n.expression.getText(sf)
          if (isBump(callee) && PROTECTED.test(n.getText(sf))) found = true
          if (known.has(callee)) found = true
        }
        ts.forEachChild(n, scan)
      }
      scan(decl.body)
      return found
    }
    const protectedBumpers = new Set(decls.filter((d) => /^bump[A-Z]/.test(d.name.text) && bumps(d, new Set())).map((d) => d.name.text))
    for (const d of decls) if (/^notify[A-Z]/.test(d.name.text) && bumps(d, protectedBumpers)) bumpingHelpers.add(d.name.text)
    for (const name of protectedBumpers) bumpingHelpers.add(name)
  }
}

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true)
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf)
      if (isBump(callee) && rel(file) !== 'src/lib/cache.ts') {
        let deferred = false, awaited = false
        for (let p = node.parent; p; p = p.parent) {
          if (ts.isCallExpression(p) && /(^|\.)waitUntil$/.test(p.expression.getText(sf))) deferred = true
          if (ts.isAwaitExpression(p)) awaited = true
        }
        sites.push({ file: rel(file), line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, call: node.getText(sf).replace(/\s+/g, ' '), deferred, awaited, protectedNs: PROTECTED.test(node.getText(sf)) })
      }
      if (/(^|\.)waitUntil$/.test(callee)) {
        const arg = node.arguments.map((a) => a.getText(sf)).join(',')
        waitUntilNotify.push({ file: rel(file), line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, arg })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

let passed = 0
const check = (name, run) => { run(); passed += 1; console.log(`PASS ${name}`) }

check('the census sees the writers (a broken scanner would pass everything)', () => {
  assert.ok(sites.length >= 100, `expected 100+ bump call sites, found ${sites.length}`)
  assert.ok(sites.filter((s) => s.protectedNs && s.awaited).length >= 20, 'awaited protected bumps')
  assert.ok(bumpingHelpers.size >= 5, `notify helpers that bump products/stock/returns: ${[...bumpingHelpers].join(', ')}`)
})

check('no products / stock / returns bump runs inside waitUntil', () => {
  const bad = sites.filter((s) => s.deferred && !DEFERRED_NOT_PROTECTED.some(([f, call]) => f === s.file && call === s.call))
  assert.deepEqual(bad.map((s) => `${s.file}:${s.line} ${s.call}`), [], 'bump before the response: await bumpVersions(...) after the commit, then waitUntil(broadcast(...))')
})

check('every classified deferred bump still exists and is not a protected namespace', () => {
  for (const [file, call] of DEFERRED_NOT_PROTECTED) {
    const hit = sites.filter((s) => s.file === file && s.call === call)
    assert.ok(hit.length >= 1, `stale classification ${file} ${call}`)
    for (const s of hit) assert.ok(!s.protectedNs || s.awaited, `${file}:${s.line} classified as not protected but names a protected namespace`)
  }
})

check('no waitUntil argument calls a notify helper that bumps products / stock / returns', () => {
  const bad = waitUntilNotify.filter((w) => [...bumpingHelpers].some((name) => new RegExp(`\\b${name}\\(`).test(w.arg)))
  assert.deepEqual(bad.map((w) => `${w.file}:${w.line}`), [], 'split the helper: await bump...(env), then waitUntil(announce...(env))')
})

check('W1: POST /api/system/repair-integrity awaits a products + stock bump when it repaired something, and only then', () => {
  const text = fs.readFileSync(path.join(srcDir, 'routes/system.ts'), 'utf8').split(String.fromCharCode(13)).join('')
  const start = text.indexOf("app.post('/repair-integrity'")
  assert.ok(start >= 0, 'the route exists')
  const handler = text.slice(start, text.indexOf('export default app', start))
  const repaired = handler.indexOf('if (result.repairs > 0) {')
  assert.ok(repaired > 0, 'repairs are tested')
  const bump = /await bumpVersions\(c\.env, \[([^\]]*)\]\)/.exec(handler)
  assert.ok(bump, 'an awaited bumpVersions call')
  assert.ok(bump.index > repaired, 'inside the repairs > 0 branch (a clean check bumps nothing)')
  assert.ok(bump[1].includes("'products'") && bump[1].includes("'stock'"), 'it names products and stock')
  assert.ok(bump.index < handler.indexOf('return c.json({ ...result, success: true })'), 'before the answer')
})

check('a broadcast never precedes the awaited bump in the same handler block (source order)', () => {
  // Statement-level: inside one block, a waitUntil(broadcast(...)) that comes BEFORE the awaited bump of that block would
  // let a peer refetch against the old version. Checked per block, per file.
  const offenders = []
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true)
    const visit = (node) => {
      if (ts.isBlock(node)) {
        let sawBroadcast = null
        for (const stmt of node.statements) {
          const t = stmt.getText(sf)
          const isAwaitedBump = ts.isExpressionStatement(stmt) && ts.isAwaitExpression(stmt.expression) && ts.isCallExpression(stmt.expression.expression)
            && isBump(stmt.expression.expression.expression.getText(sf)) && PROTECTED.test(t)
          if (isAwaitedBump && sawBroadcast) offenders.push(`${rel(file)}:${sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1} (broadcast first at line ${sawBroadcast})`)
          if (/^(?:if \(.*\) )?c\.executionCtx\.waitUntil\(broadcast\(/.test(t) && !sawBroadcast) sawBroadcast = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  assert.deepEqual(offenders, [], 'hoist the awaited bump above the broadcasts')
})

// --- behaviour of the shared bump on the real lib/cache.ts (fake KV, fake D1, stubbed quota guard) ---
const load = (relative, requireFor) => {
  const filename = path.join(srcDir, relative)
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename })
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(mod.exports, requireFor, mod, filename, path.dirname(filename))
  return mod.exports
}
const quotaCalls = []
const fakeD1 = { prepare: () => ({ get: async () => undefined, all: async () => [] }), batch: async () => [] }
const stubs = {
  './db': { getDb: () => fakeD1 },
  './quotaGuard': { consumeQuota: async (_env, resource, amount) => { quotaCalls.push([resource, amount]); return { zone: 'ok' } } },
  './cacheKey': { cacheIdentity: () => undefined, deploymentId: () => 'dev', isUnsafeVersion: () => false, readDataEpoch: async () => 'e' },
}
const cacheLib = load('lib/cache.ts', (id) => (id in stubs ? stubs[id] : require(id)))
const kvStore = new Map()
const env = { CACHE: { get: async (key) => (kvStore.has(key) ? kvStore.get(key) : null), put: async (key, value) => { kvStore.set(key, value) }, delete: async (key) => { kvStore.delete(key) } } }

process.exitCode = 0
;(async () => {
  await (async () => {
    quotaCalls.length = 0
    await cacheLib.bumpVersions(env, ['stock', 'sales', 'products'])
    assert.equal(quotaCalls.length, 1, 'one quota admission for a three-namespace bump')
    assert.deepEqual(quotaCalls[0], ['kv_write', 3])
    quotaCalls.length = 0
    await cacheLib.bumpVersion(env, 'stock'); await cacheLib.bumpVersion(env, 'sales')
    assert.equal(quotaCalls.length, 2, 'control: two separate calls are two admissions (why a site makes ONE bumpVersions call)')
    passed += 1; console.log('PASS one bumpVersions call is one quota admission (the Free quota_usage upsert), however many namespaces')
  })()
  await (async () => {
    const failing = { CACHE: { get: async () => { throw new Error('KV down') }, put: async () => { throw new Error('KV down') }, delete: async () => { throw new Error('KV down') } } }
    const original = console.error
    const logged = []
    console.error = (...args) => { logged.push(args) }
    try {
      const broken = load('lib/cache.ts', (id) => (id === './quotaGuard' ? { consumeQuota: async () => { throw new Error('quota guard down') } } : id in stubs ? stubs[id] : require(id)))
      await broken.bumpVersions(failing, ['products', 'stock'])
      await broken.bumpVersion(failing, 'products')
    } finally { console.error = original }
    assert.ok(logged.length >= 1, 'a failed bump is logged')
    passed += 1; console.log('PASS a bump that fails is logged and never rejects (a committed write is never turned into a non-2xx)')
  })()
  summary()
})().catch((error) => { console.error(error); process.exit(1) })
function summary() {
console.log(`${passed} checks passed; ${sites.length} bump call sites (${sites.filter((s) => s.deferred).length} deferred and classified, ${sites.filter((s) => s.protectedNs && s.awaited).length} protected and awaited), ${bumpingHelpers.size} bumping notify helpers.`)
}
