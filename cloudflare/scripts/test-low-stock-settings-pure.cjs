// The one low-stock rule, Worker side (src/lib/lowStockSettings.ts).
//
// Three things are locked here:
//   1. the rule itself, on the REAL transpiled module (not a reimplementation);
//   2. the SQL fragment builder every route composes into its counts/filters;
//   3. that the shared block is byte-identical to the frontend twin
//      (frontend/src/utils/lowStockSettings.ts) -- the whole point of the
//      duplication is that the till and the SQL that counts it can never
//      disagree, and nothing but a comparison enforces that.
//
// Every rule case is DISCRIMINATING against what this replaced: the literal
// 10 re-typed at ~35 call sites. A product storing the schema default 10 with
// 5 in stock used to have exactly one answer (low); here it has three.
//
// Run: node scripts/test-low-stock-settings-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

const CF_SRC = path.join(__dirname, '..', 'src')
const FRONTEND_SRC = path.join(__dirname, '..', '..', 'frontend', 'src')

function readCf(relPath) {
  return fs.readFileSync(path.join(CF_SRC, relPath), 'utf8')
}

function transpile(relPath) {
  return ts.transpileModule(readCf(relPath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(relPath),
  }).outputText
}

// './db' is stubbed: getDb is only reached through loadLowStockConfig, which
// is exercised below with an explicit fake database.
let dbStub = null
function stubRequire(request) {
  if (request === './db') return { getDb: () => dbStub }
  return require(request)
}

function loadModule(relPath) {
  const module = { exports: {} }
  new Function('exports', 'require', 'module', transpile(relPath))(module.exports, stubRequire, module)
  return module.exports
}

const lowStock = loadModule('lib/lowStockSettings.ts')
const {
  DEFAULT_LOW_STOCK_CONFIG,
  DEFAULT_LOW_STOCK_THRESHOLD,
  LOW_STOCK_ALERT_ENABLED_KEY,
  LOW_STOCK_THRESHOLD_KEY,
  LOW_STOCK_THRESHOLD_MODE_KEY,
  MAX_LOW_STOCK_THRESHOLD,
  NO_LOW_STOCK_THRESHOLD,
  effectiveLowStockThreshold,
  isLowStock,
  loadLowStockConfig,
  lowStockThresholdSql,
  normalizeLowStockThreshold,
  resolveLowStockConfig,
} = lowStock

let passed = 0
function check(name, fn) {
  const result = fn()
  if (result && typeof result.then === 'function') {
    return result.then(() => {
      passed += 1
      console.log(`PASS ${name}`)
    })
  }
  passed += 1
  console.log(`PASS ${name}`)
  return Promise.resolve()
}

const PRODUCT_MODE = { enabled: true, mode: 'product', threshold: 3 }
const GLOBAL_MODE = { enabled: true, mode: 'global', threshold: 3 }
const ALERTS_OFF = { enabled: false, mode: 'product', threshold: 10 }

async function main() {
  await check('an untouched install behaves exactly like the old hardcoded 10', () => {
    assert.strictEqual(DEFAULT_LOW_STOCK_THRESHOLD, 10)
    assert.deepStrictEqual(resolveLowStockConfig({}), DEFAULT_LOW_STOCK_CONFIG)
    assert.deepStrictEqual(DEFAULT_LOW_STOCK_CONFIG, { enabled: true, mode: 'product', threshold: 10 })
    assert.strictEqual(lowStockThresholdSql(DEFAULT_LOW_STOCK_CONFIG, 'p.low_stock_threshold'), 'COALESCE(p.low_stock_threshold, 10)')
  })

  await check('the threshold is validated, never clamped', () => {
    assert.strictEqual(normalizeLowStockThreshold('0'), 0)
    assert.strictEqual(normalizeLowStockThreshold('25'), 25)
    assert.strictEqual(normalizeLowStockThreshold(MAX_LOW_STOCK_THRESHOLD), MAX_LOW_STOCK_THRESHOLD)
    for (const bad of ['', null, undefined, '-1', -1, '2.5', 2.5, 'abc', '1e3', ' ', MAX_LOW_STOCK_THRESHOLD + 1, NaN, Infinity]) {
      assert.strictEqual(normalizeLowStockThreshold(bad), null, `${String(bad)} must be rejected`)
    }
  })

  await check('the same stored row gets three different answers -- the setting is not inert', () => {
    // stock 5, product row storing the schema DEFAULT 10.
    assert.strictEqual(isLowStock(PRODUCT_MODE, 5, 10, 0), true)
    assert.strictEqual(isLowStock(GLOBAL_MODE, 5, 10, 0), false)
    assert.strictEqual(isLowStock(ALERTS_OFF, 5, 10, 0), false)
    assert.strictEqual(effectiveLowStockThreshold(PRODUCT_MODE, 10), 10)
    assert.strictEqual(effectiveLowStockThreshold(GLOBAL_MODE, 10), 3)
    assert.strictEqual(effectiveLowStockThreshold(ALERTS_OFF, 10), NO_LOW_STOCK_THRESHOLD)
    // The global still replaces the old literal where the row has none.
    assert.strictEqual(effectiveLowStockThreshold(PRODUCT_MODE, null), 3)
  })

  await check('the SQL fragment carries the mode, and alerts-off empties the low tier', () => {
    assert.strictEqual(lowStockThresholdSql(PRODUCT_MODE, 'p.low_stock_threshold'), 'COALESCE(p.low_stock_threshold, 3)')
    assert.strictEqual(lowStockThresholdSql(GLOBAL_MODE, 'p.low_stock_threshold'), '3')
    assert.strictEqual(lowStockThresholdSql(ALERTS_OFF, 'p.low_stock_threshold'), '-1')
    // -1 is what makes "off" need no branch at any call site: no quantity is
    // <= -1, and a quantity above the out-of-stock threshold is always > -1.
    assert.strictEqual(NO_LOW_STOCK_THRESHOLD, -1)
    // A poisoned stored value can never reach the SQL string.
    assert.strictEqual(lowStockThresholdSql({ enabled: true, mode: 'product', threshold: '3); DROP TABLE products--' }, 'p.low_stock_threshold'), 'COALESCE(p.low_stock_threshold, 10)')
    assert.strictEqual(lowStockThresholdSql({ enabled: true, mode: 'global', threshold: -5 }, 'p.low_stock_threshold'), '10')
  })

  await check('loadLowStockConfig reads exactly the three settings rows', async () => {
    let seenSql = ''
    let seenParams = null
    dbStub = {
      prepare(sql) {
        seenSql = sql
        return {
          all: async (params) => {
            seenParams = params
            return [
              { key: LOW_STOCK_ALERT_ENABLED_KEY, value: 'false' },
              { key: LOW_STOCK_THRESHOLD_MODE_KEY, value: 'global' },
              { key: LOW_STOCK_THRESHOLD_KEY, value: '4' },
            ]
          },
        }
      },
    }
    const config = await loadLowStockConfig({})
    assert.match(seenSql, /SELECT key, value FROM settings WHERE key IN \(\?,\?,\?\)/)
    assert.deepStrictEqual(Array.from(seenParams), [
      'low_stock_alert_enabled',
      'low_stock_threshold_mode',
      'low_stock_threshold_default',
    ])
    assert.deepStrictEqual(config, { enabled: false, mode: 'global', threshold: 4 })

    dbStub = { prepare: () => ({ all: async () => [] }) }
    assert.deepStrictEqual(await loadLowStockConfig({}), DEFAULT_LOW_STOCK_CONFIG)
  })

  await check('the shared rule block is byte-identical in the frontend twin', () => {
    const OPEN = '// >>> SHARED LOW-STOCK RULE >>>'
    const CLOSE = '// <<< SHARED LOW-STOCK RULE <<<'
    const extract = (text, label) => {
      const start = text.indexOf(OPEN)
      const end = text.indexOf(CLOSE)
      assert.ok(start >= 0 && end > start, `${label} must carry the shared-rule markers`)
      // Line endings are normalized: this checkout has core.autocrlf=true, so
      // the two files can legitimately differ in CR bytes without differing
      // in a single character of rule.
      return text.slice(start, end + CLOSE.length).replace(/\r\n/g, '\n')
    }
    const worker = extract(readCf('lib/lowStockSettings.ts'), 'Worker module')
    const frontend = extract(fs.readFileSync(path.join(FRONTEND_SRC, 'utils', 'lowStockSettings.ts'), 'utf8'), 'frontend module')
    assert.strictEqual(worker, frontend, 'the shared low-stock rule has drifted between the Worker and the frontend')
    // Positive control: the comparison is capable of failing. Without this the
    // assertion above would pass just as happily on two empty strings.
    assert.notStrictEqual(worker.replace('qty <= effectiveLowStockThreshold', 'qty < effectiveLowStockThreshold'), frontend)
    assert.ok(worker.includes('export function isLowStock('), 'the extracted block must actually contain the rule')
  })

  console.log(`\n${passed} checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
