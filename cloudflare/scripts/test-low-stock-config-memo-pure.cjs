// loadLowStockConfig is memoised per isolate (src/lib/lowStockSettings.ts) so the ~17 routes that
// need the three low-stock settings stop paying a D1 round trip each.
//
// A memo is only safe if it can be wrong for a bounded, small time, so this file proves the
// INVALIDATION half, not just the hit rate. Each case counts real D1 statements against a real
// SQLite settings table (node:sqlite) and a fake KV that holds the `settings` cache version:
//   - without a memo, N calls = N statements (the baseline this replaced);
//   - with it, N calls inside the window = 1 statement;
//   - a settings save (version bump, or the isolate-local invalidate) re-reads at once;
//   - a writer that bumps nothing is still picked up once MAX_AGE passes;
//   - no CACHE binding, an unreadable version, or a missing version = never memoised.
//
// Run: node scripts/test-low-stock-config-memo-pure.cjs
'use strict'
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')

const SRC = path.join(__dirname, '..', 'src')
let dbStub = null
function load(rel) {
  const output = ts.transpileModule(fs.readFileSync(path.join(SRC, rel), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(rel),
  }).outputText
  const module = { exports: {} }
  new Function('exports', 'require', 'module', output)(module.exports, (request) => (request === './db' ? { getDb: () => dbStub } : require(request)), module)
  return module.exports
}

const lowStock = load('lib/lowStockSettings.ts')
const { loadLowStockConfig, invalidateLowStockConfigMemo, LOW_STOCK_CONFIG_MEMO_FRESH_MS, LOW_STOCK_CONFIG_MEMO_MAX_AGE_MS, SETTINGS_VERSION_KV_KEY } = lowStock

// A real settings table behind a statement-counting D1 stand-in.
function makeShop() {
  const raw = new DatabaseSync(':memory:')
  raw.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)')
  const shop = {
    statements: 0,
    set(key, value) { raw.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value) },
  }
  dbStub = {
    prepare(sql) {
      return { all: async (params) => { shop.statements += 1; return raw.prepare(sql).all(...params) } }
    },
  }
  return shop
}

function makeEnv(initialVersion = '1') {
  const kv = new Map()
  if (initialVersion !== null) kv.set(SETTINGS_VERSION_KV_KEY, initialVersion)
  return {
    CACHE: {
      reads: 0,
      fail: false,
      async get(key) { this.reads += 1; if (this.fail) throw new Error('kv down'); return kv.has(key) ? kv.get(key) : null },
    },
    bump() { kv.set(SETTINGS_VERSION_KV_KEY, String(Number(kv.get(SETTINGS_VERSION_KV_KEY) || 0) + 1)) },
  }
}

let now = 1_000_000
const realNow = Date.now
Date.now = () => now
let passed = 0
async function check(name, fn) {
  invalidateLowStockConfigMemo()
  now += 10 * 60 * 1000
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  await check('the KV key matches what lib/cache.ts bumpVersion writes for the settings namespace', () => {
    const cache = fs.readFileSync(path.join(SRC, 'lib', 'cache.ts'), 'utf8')
    const prefix = cache.match(/const CACHE_VERSION_KEY_PREFIX = '([^']+)'/)
    assert.ok(prefix, 'cache.ts still defines CACHE_VERSION_KEY_PREFIX')
    assert.ok(/function cacheVersionKey\(namespace: string\): string \{\s*return `\$\{CACHE_VERSION_KEY_PREFIX\}\$\{namespace\}`/.test(cache), 'cacheVersionKey is prefix + namespace')
    assert.strictEqual(SETTINGS_VERSION_KV_KEY, `${prefix[1]}settings`)
  })

  await check('baseline: without a CACHE binding every call is a D1 statement (nothing to validate a memo against)', async () => {
    const shop = makeShop()
    for (let i = 0; i < 5; i += 1) await loadLowStockConfig({})
    assert.strictEqual(shop.statements, 5)
  })

  await check('17 readers in one burst cost one statement, not 17', async () => {
    const shop = makeShop(); const env = makeEnv()
    shop.set('low_stock_threshold_default', '7')
    const results = await Promise.all(Array.from({ length: 17 }, () => loadLowStockConfig(env)))
    assert.strictEqual(shop.statements, 1, 'concurrent callers share one read')
    for (const config of results) assert.strictEqual(config.threshold, 7)
    for (let i = 0; i < 17; i += 1) await loadLowStockConfig(env)
    assert.strictEqual(shop.statements, 1, 'sequential callers inside the fresh window cost no I/O')
    assert.strictEqual(env.CACHE.reads, 1, 'and no KV read either')
  })

  await check('after the fresh window the version is re-confirmed with one KV read, still no D1 read', async () => {
    const shop = makeShop(); const env = makeEnv()
    await loadLowStockConfig(env)
    now += LOW_STOCK_CONFIG_MEMO_FRESH_MS + 1
    await loadLowStockConfig(env)
    await loadLowStockConfig(env)
    assert.strictEqual(shop.statements, 1)
    assert.strictEqual(env.CACHE.reads, 2)
  })

  await check('a settings save in ANOTHER isolate (version bump) is picked up at the next check, not served stale', async () => {
    const shop = makeShop(); const env = makeEnv()
    shop.set('low_stock_threshold_default', '5')
    assert.strictEqual((await loadLowStockConfig(env)).threshold, 5)
    shop.set('low_stock_threshold_default', '25'); env.bump()
    now += LOW_STOCK_CONFIG_MEMO_FRESH_MS + 1
    const after = await loadLowStockConfig(env)
    assert.strictEqual(after.threshold, 25, 'a memo that ignored the version would still say 5')
    assert.strictEqual(shop.statements, 2)
  })

  await check('the isolate that served the save sees it immediately (invalidate), inside the fresh window', async () => {
    const shop = makeShop(); const env = makeEnv()
    shop.set('low_stock_alert_enabled', 'true')
    assert.strictEqual((await loadLowStockConfig(env)).enabled, true)
    shop.set('low_stock_alert_enabled', 'false')
    assert.strictEqual((await loadLowStockConfig(env)).enabled, true, 'control: without the invalidate the fresh memo still answers')
    invalidateLowStockConfigMemo()
    assert.strictEqual((await loadLowStockConfig(env)).enabled, false)
  })

  await check('a read already in flight when the save lands cannot be written back over the invalidation', async () => {
    const shop = makeShop(); const env = makeEnv()
    shop.set('low_stock_threshold_default', '5')
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const realPrepare = dbStub.prepare
    dbStub.prepare = (sql) => ({ all: async (params) => { const rows = await realPrepare(sql).all(params); await gate; return rows } })
    const slow = loadLowStockConfig(env) // reads threshold 5, then waits
    await new Promise((resolve) => setImmediate(resolve))
    shop.set('low_stock_threshold_default', '99'); invalidateLowStockConfigMemo()
    release()
    await slow
    dbStub.prepare = realPrepare
    assert.strictEqual((await loadLowStockConfig(env)).threshold, 99, 'the pre-save read must not become the memo')
  })

  await check('a writer that bumps nothing (restore, manual edit) is still picked up after MAX_AGE', async () => {
    const shop = makeShop(); const env = makeEnv()
    shop.set('low_stock_threshold_default', '5')
    await loadLowStockConfig(env)
    shop.set('low_stock_threshold_default', '40') // no env.bump()
    now += LOW_STOCK_CONFIG_MEMO_MAX_AGE_MS - 1000
    assert.strictEqual((await loadLowStockConfig(env)).threshold, 5, 'inside the backstop the unversioned write is hidden (bounded)')
    now += 2000
    assert.strictEqual((await loadLowStockConfig(env)).threshold, 40, 'the backstop bounds it')
  })

  await check('re-confirming the version does not extend the backstop (checkedAt moves, readAt does not)', async () => {
    const shop = makeShop(); const env = makeEnv()
    await loadLowStockConfig(env)
    for (let i = 0; i < 20; i += 1) { now += 4000; await loadLowStockConfig(env) } // 80 s of steady use
    assert.strictEqual(shop.statements, 2, 'one read at start, one at the 60 s backstop -- steady polling cannot keep one memo alive past MAX_AGE')
  })

  await check('an unreadable or missing settings version means no memo (read D1 every time)', async () => {
    const shop = makeShop(); const env = makeEnv(null)
    await loadLowStockConfig(env); now += LOW_STOCK_CONFIG_MEMO_FRESH_MS + 1
    await loadLowStockConfig(env)
    assert.strictEqual(shop.statements, 2, 'no version key: cannot confirm, so do not trust')
    const shop2 = makeShop(); const env2 = makeEnv(); env2.CACHE.fail = true
    await loadLowStockConfig(env2); now += LOW_STOCK_CONFIG_MEMO_FRESH_MS + 1
    await loadLowStockConfig(env2)
    assert.strictEqual(shop2.statements, 2, 'KV failure falls through to D1, never throws')
  })

  await check('a different env (another deployment/test) never reads this one memo', async () => {
    const shop = makeShop(); const a = makeEnv(); const b = makeEnv()
    shop.set('low_stock_threshold_default', '3')
    await loadLowStockConfig(a)
    shop.set('low_stock_threshold_default', '8')
    assert.strictEqual((await loadLowStockConfig(b)).threshold, 8)
  })

  await check('the Settings POST invalidates this isolate after a save and still bumps the version', () => {
    const settings = fs.readFileSync(path.join(SRC, 'routes', 'settings.ts'), 'utf8').replace(/\r\n/g, '\n')
    assert.ok(
      settings.includes("invalidateLowStockConfigMemo()\n  c.executionCtx.waitUntil(bumpVersion(c.env, 'settings'))"),
      'invalidate sits next to the settings bump in POST /api/settings',
    )
    assert.match(settings, /import \{ invalidateLowStockConfigMemo, [^}]*\} from '\.\.\/lib\/lowStockSettings'/)
  })

  Date.now = realNow
  console.log(`\n${passed} passed`)
}

main().catch((error) => { Date.now = realNow; console.error(error); process.exit(1) })
