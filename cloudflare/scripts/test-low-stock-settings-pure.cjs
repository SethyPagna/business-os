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

  await check('the write guard rejects (never clamps) every shape the form can send', () => {
    const { validateLowStockSettingsWrite } = lowStock
    // A payload with none of the three keys is none of this guard's business.
    assert.strictEqual(validateLowStockSettingsWrite({ theme: 'dark' }), null)
    assert.strictEqual(validateLowStockSettingsWrite(null), null)
    // Accepted shapes.
    assert.strictEqual(validateLowStockSettingsWrite({
      [LOW_STOCK_ALERT_ENABLED_KEY]: 'true',
      [LOW_STOCK_THRESHOLD_MODE_KEY]: 'global',
      [LOW_STOCK_THRESHOLD_KEY]: '0',
    }), null)
    assert.strictEqual(validateLowStockSettingsWrite({ [LOW_STOCK_ALERT_ENABLED_KEY]: 'off' }), null)
    // Rejected shapes, each named by its own code.
    assert.strictEqual(validateLowStockSettingsWrite({ [LOW_STOCK_ALERT_ENABLED_KEY]: 'maybe' }), 'invalid_low_stock_alert_enabled')
    assert.strictEqual(validateLowStockSettingsWrite({ [LOW_STOCK_ALERT_ENABLED_KEY]: '' }), 'invalid_low_stock_alert_enabled')
    assert.strictEqual(validateLowStockSettingsWrite({ [LOW_STOCK_THRESHOLD_MODE_KEY]: 'everything' }), 'invalid_low_stock_threshold_mode')
    for (const bad of ['-4', '2.5', 'ten', '', MAX_LOW_STOCK_THRESHOLD + 1]) {
      assert.strictEqual(
        validateLowStockSettingsWrite({ [LOW_STOCK_THRESHOLD_KEY]: bad }),
        'invalid_low_stock_threshold',
        `${String(bad)} must be rejected by the write guard`,
      )
    }
    // An explicit null/undefined VALUE for the key is still a write of that
    // key, and still invalid -- hasOwnProperty, not truthiness.
    assert.strictEqual(validateLowStockSettingsWrite({ [LOW_STOCK_THRESHOLD_KEY]: null }), 'invalid_low_stock_threshold')
  })

  await check('POST /api/settings actually runs that guard before writing', () => {
    const route = readCf('routes/settings.ts')
    assert.match(route, /import \{[^}]*validateLowStockSettingsWrite[^}]*\} from '\.\.\/lib\/lowStockSettings'/)
    assert.match(route, /const lowStockError = validateLowStockSettingsWrite\(body\)/)
    assert.match(route, /code: lowStockError,\s*\}, 400\)/)
    // ...and before the rows are written, not after.
    assert.ok(
      route.indexOf('validateLowStockSettingsWrite(body)') < route.indexOf('VALUES (@key, @value, CURRENT_TIMESTAMP)'),
      'the guard must run before the upsert',
    )
    // Positive control: this file is capable of showing a key is UNguarded --
    // 'theme' is stored on trust like most keys, so the same search finds
    // nothing for it. Without this the assertions above would look just as
    // green against a route that validated nothing.
    assert.doesNotMatch(route, /validateTheme|invalid_theme_setting/)
  })


  // ---- against real SQLite ---------------------------------------------
  //
  // The fragment builder is only useful if the SQL it composes into actually
  // selects the rows it claims to. These run the SAME shapes the routes build
  // against a real SQLite catalog, on a fixture chosen so the old hardcoded 10
  // and each new mode DISAGREE about it.
  await check('the composed SQL selects different rows per mode, on real SQLite', () => {
    const Database = require('better-sqlite3')
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE products (
        id INTEGER PRIMARY KEY,
        name TEXT,
        is_active INTEGER DEFAULT 1,
        stock_quantity REAL,
        low_stock_threshold REAL DEFAULT 10,
        out_of_stock_threshold REAL DEFAULT 0
      );
      INSERT INTO products (id, name, stock_quantity, low_stock_threshold, out_of_stock_threshold) VALUES
        (1, 'low-today',  5,  10, 0),
        (2, 'out',        0,  10, 0),
        (3, 'healthy',   20,  10, 0),
        (4, 'no-limit',   5, NULL, 0);
    `)
    const names = (sql) => db.prepare(sql).all().map((row) => row.name).sort()

    // routes/products.ts + inventory.ts stockState=low
    const lowFilter = (config) => names(`
      SELECT name FROM products p WHERE p.is_active = 1
        AND COALESCE(p.stock_quantity, 0) > COALESCE(p.out_of_stock_threshold, 0)
        AND COALESCE(p.stock_quantity, 0) <= ${lowStockThresholdSql(config, 'p.low_stock_threshold')}
    `)
    assert.deepStrictEqual(lowFilter(DEFAULT_LOW_STOCK_CONFIG), ['low-today', 'no-limit'])
    // 'product' mode with a global of 3: the row storing its own 10 keeps it
    // and stays low; the row with no limit of its own drops out. The old
    // literal could not tell these two apart at all.
    assert.deepStrictEqual(lowFilter(PRODUCT_MODE), ['low-today'])
    // 'global' mode: both fall out, because 3 replaces every row's own limit.
    assert.deepStrictEqual(lowFilter(GLOBAL_MODE), [])
    assert.deepStrictEqual(lowFilter(ALERTS_OFF), [])

    // routes/products.ts stockState=healthy -- the complement, and the reason
    // 'off' is -1 rather than 0: the low tier has to fold back INTO healthy,
    // not leave a hole where those products used to be counted. The
    // out-of-stock term is stated rather than implied by "low >= out", an
    // assumption alerts-off breaks (every out row is above -1).
    const healthyFilter = (config) => names(`
      SELECT name FROM products p WHERE p.is_active = 1
        AND COALESCE(p.stock_quantity, 0) > COALESCE(p.out_of_stock_threshold, 0)
        AND COALESCE(p.stock_quantity, 0) > ${lowStockThresholdSql(config, 'p.low_stock_threshold')}
    `)
    assert.deepStrictEqual(healthyFilter(DEFAULT_LOW_STOCK_CONFIG), ['healthy'])
    assert.deepStrictEqual(healthyFilter(GLOBAL_MODE), ['healthy', 'low-today', 'no-limit'].sort())
    assert.deepStrictEqual(healthyFilter(ALERTS_OFF), ['healthy', 'low-today', 'no-limit'].sort())
    // Nothing moved into or out of the out-of-stock tier in any of them.
    for (const config of [DEFAULT_LOW_STOCK_CONFIG, PRODUCT_MODE, GLOBAL_MODE, ALERTS_OFF]) {
      assert.ok(!lowFilter(config).includes('out'), 'out-of-stock must never be counted as low')
      assert.ok(!healthyFilter(config).includes('out'), 'out-of-stock must never be counted as healthy')
    }

    // The bell / Telegram list, which fetches BOTH tiers in one query. This is
    // the case that made the OR necessary: without it, switching the
    // low-QUANTITY alert off would have silently deleted the out-of-stock
    // warnings too.
    const bothTiers = (config) => names(`
      SELECT name FROM products WHERE is_active = 1
        AND (COALESCE(stock_quantity, 0) <= ${lowStockThresholdSql(config, 'low_stock_threshold')}
             OR COALESCE(stock_quantity, 0) <= COALESCE(out_of_stock_threshold, 0))
    `)
    assert.deepStrictEqual(bothTiers(DEFAULT_LOW_STOCK_CONFIG), ['low-today', 'no-limit', 'out'].sort())
    assert.deepStrictEqual(bothTiers(ALERTS_OFF), ['out'])
    // Discriminating control: the shape WITHOUT the OR -- what these queries
    // carried before -- loses the out-of-stock row entirely.
    const withoutOr = names(`
      SELECT name FROM products WHERE is_active = 1
        AND COALESCE(stock_quantity, 0) <= ${lowStockThresholdSql(ALERTS_OFF, 'low_stock_threshold')}
    `)
    assert.deepStrictEqual(withoutOr, [])

    // familyStockStats' per-row tiering, same fixture.
    const tiers = (config) => db.prepare(`
      SELECT
        SUM(CASE WHEN qty > out_threshold AND qty > low_threshold THEN 1 ELSE 0 END) AS healthy,
        SUM(CASE WHEN qty > out_threshold AND qty <= low_threshold THEN 1 ELSE 0 END) AS low,
        SUM(CASE WHEN qty <= out_threshold THEN 1 ELSE 0 END) AS out
      FROM (
        SELECT COALESCE(p.stock_quantity, 0) AS qty,
               COALESCE(p.out_of_stock_threshold, 0) AS out_threshold,
               ${lowStockThresholdSql(config, 'p.low_stock_threshold')} AS low_threshold
        FROM products p WHERE p.is_active = 1
      )
    `).get()
    assert.deepStrictEqual(tiers(DEFAULT_LOW_STOCK_CONFIG), { healthy: 1, low: 2, out: 1 })
    assert.deepStrictEqual(tiers(GLOBAL_MODE), { healthy: 3, low: 0, out: 1 })
    // Alerts off: the low bucket empties into healthy and the out count is
    // byte-for-byte what it was -- the invariant the whole -1 trick exists for.
    assert.deepStrictEqual(tiers(ALERTS_OFF), { healthy: 3, low: 0, out: 1 })
    db.close()
  })
  // ---- consumer parity -------------------------------------------------
  //
  // The rule is only ONE rule if every reader actually goes through it. Every
  // server surface that decides "is this row low" is named here with the
  // expression it used to carry, so a new consumer copying the old literal
  // (or an old one being reverted to it) fails this file rather than shipping
  // a Dashboard card that disagrees with the list under it.
  const SERVER_LOW_STOCK_CONSUMERS = [
    ['lib/familyStockStats.ts', 'Dashboard tile, Inventory stats, Branches stats'],
    ['lib/telegram.ts', '/stock, /lowstock and /inventory bot replies'],
    ['routes/compat.ts', "Dashboard's low-stock card and drill list"],
    ['routes/inventory.ts', "Inventory's stockState=low filter"],
    ['routes/products.ts', "Products' stockState=low/healthy filters"],
    ['routes/branches.ts', "Branches' per-branch stockState filter"],
    ['routes/notifications.ts', 'the notification bell'],
  ]

  await check('every server low-stock reader goes through the shared rule', () => {
    for (const [relPath, surface] of SERVER_LOW_STOCK_CONSUMERS) {
      const text = readCf(relPath)
      assert.match(
        text,
        /from '(\.\.\/lib\/lowStockSettings|\.\/lowStockSettings)'/,
        `${relPath} (${surface}) must import the shared low-stock rule`,
      )
      assert.ok(
        /lowStockThresholdSql\(/.test(text) || /lowThresholdSql/.test(text),
        `${relPath} (${surface}) must build its threshold with lowStockThresholdSql`,
      )
      // ...and must no longer re-type the literal it replaced. This is the
      // discriminating half: before this lane every one of these files
      // matched, and each match was a surface the owner's setting could not
      // reach.
      assert.doesNotMatch(
        text,
        /low_stock_threshold,\s*10\)/,
        `${relPath} (${surface}) still hardcodes the old fallback of 10`,
      )
    }
  })

  await check('the two shapes that alerts-off would otherwise break stay stated', () => {
    // Both proved above on real SQLite; pinned here as source shape so a later
    // edit cannot quietly drop either term back to what it was.
    for (const relPath of ['routes/products.ts', 'routes/branches.ts']) {
      const healthy = readCf(relPath)
        .split(/\r?\n/)
        .filter((line) => line.includes("stockState === 'healthy'") && line.includes('where.push'))
      assert.strictEqual(healthy.length, 1, `${relPath} must have exactly one healthy clause`)
      assert.match(
        healthy[0],
        /out_of_stock_threshold, 0\) AND /,
        `${relPath}'s healthy clause must state the out-of-stock term, not imply it from low >= out`,
      )
    }
    // The bell and the bot fetch BOTH tiers in one query, so each needs the OR
    // that keeps out-of-stock alive when the low-quantity alert is off.
    for (const relPath of ['routes/notifications.ts', 'lib/telegram.ts']) {
      assert.match(
        readCf(relPath),
        /OR COALESCE\(stock_quantity, 0\) <= COALESCE\(out_of_stock_threshold, 0\)/,
        `${relPath} must keep out-of-stock rows when the low alert is off`,
      )
    }
  })

  await check('the parity sweep can tell a threaded file from an unthreaded one', () => {
    // Positive control. routes/portal.ts is the STOREFRONT, which ships its
    // own documented customer_portal_* threshold triple and is deliberately
    // NOT wired to the admin setting (frontend/src/lang/en.json's hint says
    // the portal values apply "on the customer portal only"). It therefore
    // still carries exactly the pattern the sweep above rejects -- proving
    // the sweep is capable of failing, and pinning the storefront's
    // independence as a decision rather than an oversight.
    const portal = readCf('routes/portal.ts')
    assert.match(portal, /low_stock_threshold,\s*10\)/, 'the storefront is expected to keep its own rule')
    assert.doesNotMatch(portal, /lowStockThresholdSql/)
  })

  await check('the Settings row is gated on the permission the Worker actually enforces', () => {
    // "Respect the settings permission key for who may change it": the three
    // keys carry no settings BUCKET (business_identity / sales_policy /
    // portal_*), so routes/settings.ts's POST falls through to the plain
    // "settings" grant. The form must therefore be shown to exactly that
    // holder -- gating it on isAdmin would hide from a manager with full
    // Settings a control the API would accept from them, and gating it wider
    // than the server would show a control whose save 403s.
    const settingsRoute = readCf('routes/settings.ts')
    for (const key of ['low_stock_alert_enabled', 'low_stock_threshold_mode', 'low_stock_threshold_default']) {
      assert.doesNotMatch(
        settingsRoute,
        new RegExp("'" + key + "'"),
        key + ' now appears in routes/settings.ts -- if it was put in a bucket set, the UI gate below must move with it',
      )
    }
    assert.match(settingsRoute, /return !hasPermission\(user, 'settings'\)/, 'the unbucketed fallback is the plain settings grant')

    const form = fs.readFileSync(path.join(FRONTEND_SRC, 'components', 'utils-settings', 'Settings.tsx'), 'utf8')
    assert.match(form, /const canEditSettings = getPermissionTier\('settings'\) === 'full'/, "the form's gate must read the 'settings' key")
    // The gate immediately above the Stock Alerts section, whichever way the
    // file is reordered later.
    const sectionAt = form.indexOf("<SettingsSection title={t('stock_alerts')}>")
    assert.ok(sectionAt > 0, 'the Stock Alerts section is gone')
    const gates = form.slice(0, sectionAt).match(/\{(?:isAdmin|canEditSettings) && showSettingsSection\('business'\) \? \(/g) || []
    assert.equal(
      gates[gates.length - 1],
      "{canEditSettings && showSettingsSection('business') ? (",
      'the Stock Alerts section must be gated on canEditSettings, not isAdmin',
    )
  })

  console.log(`\n${passed} checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
