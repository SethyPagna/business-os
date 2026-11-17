// The Website Editor's own Low / Out of stock levels: the Editor's rule and the Worker's write guard agree on one shared table.
//
// Owner rule of 16 Nov 2026 ("Website's own levels"): these two settings decide the storefront's badges, pills and what "hide out of stock" lists, so
// POST /api/settings must enforce what the Editor enforces (frontend CatalogPage.tsx websiteStockLevel): empty, or a finite number from 0 up. Anything
// else is refused with invalid_portal_stock_level and NOTHING in that save lands. The table below is written by hand from the rule, not computed by
// either implementation. Drives the real routes/settings.ts and lib/portalText.ts, and the Editor's function lifted out of the shipped source.
//
// Run from the cloudflare directory: node scripts/test-portal-stock-level-write-parity-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

let passed = 0
const failures = []
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}: ${String(error.message).split(/\r?\n/)[0]}`)
  }
}

const db = openDb(loadAll())
let sessionUser = null
const overrides = {
  '../lib/db': { getDb: (env) => env.DB },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', sessionUser); return next() } },
  '../lib/audit': {
    changedFields: (before, after) => ({ before, after }),
    auditChangeColumns: () => ({ old_value: null, new_value: null }),
    isSecretShapedAuditKey: () => false,
    audit: async () => {},
  },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {} },
}
function createLoader(moduleOverrides) {
  const cache = new Map()
  return function load(rel) {
    if (cache.has(rel)) return cache.get(rel).exports
    const sourcePath = path.join(__dirname, '..', 'src', rel)
    const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: sourcePath,
    }).outputText
    const mod = { exports: {} }
    cache.set(rel, mod)
    const localRequire = (request) => {
      if (Object.prototype.hasOwnProperty.call(moduleOverrides, request)) return moduleOverrides[request]
      if (!request.startsWith('.')) return require(request)
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
      return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
    }
    new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
    return mod.exports
  }
}
const load = createLoader(overrides)
const app = load('routes/settings.ts').default
const portalText = load('lib/portalText.ts')
const PORTAL_EDITOR = { id: 31, username: 'web', permissions: JSON.stringify({ customer_portal: true }), role_code: null, role_permissions: null }

// The Editor's own function, lifted from the shipped source and stripped of its types.
function loadEditorRule() {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'catalog', 'CatalogPage.tsx'), 'utf8').replace(/\r\n/g, '\n')
  const start = source.indexOf('function websiteStockLevel(')
  assert.ok(start > 0, 'CatalogPage.tsx must still define websiteStockLevel')
  const end = source.indexOf('\n}\n', start)
  const js = ts.transpileModule(source.slice(start, end + 3), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`${js}\nreturn websiteStockLevel`)()
}
const editorRule = loadEditorRule()

const LOW = 'customer_portal_low_stock_threshold'
const OUT = 'customer_portal_out_of_stock_threshold'

// [input, accepted]. Hand-written from the rule: empty, or a finite number from 0 up. Number() spellings count, exactly as the Editor and the read side treat them.
const TABLE = [
  ['', true], ['   ', true], ['0', true], ['5', true], ['2.5', true], ['.5', true], ['5.', true], [' 5 ', true], ['+5', true], ['0x10', true], ['1e3', true],
  ['1e21', true], ['-0', true], ['007', true],
  ['-1', false], ['-0.5', false], ['Infinity', false], ['-Infinity', false], ['1e999', false], ['NaN', false], ['abc', false], ['5px', false], ['1,5', false], ['--5', false], ['5 5', false],
  ['0x', false], ['١٢', false],
]
// Non-string payloads: the Editor only ever sends text, a JSON client may send anything.
const NON_TEXT = [[null, true], [5, true], [0, true], [2.5, true], [-1, false], [Number.NaN, false], [true, false], [false, false], [{}, false], [[], false], [['5'], false]]

async function save(body) {
  sessionUser = PORTAL_EDITOR
  const res = await app.request('/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { DB: db }, { waitUntil() {}, passThroughOnException() {} })
  return { status: res.status, body: await res.json() }
}
const stored = (key) => db.prepare('SELECT value FROM settings WHERE key = @key').get({ key })?.value ?? null
const seed = (key, value) => db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (@key, @value)').run({ key, value })

async function main() {
  await check('the Editor rule and the Worker rule agree on every row of the shared table', () => {
    for (const [input, accepted] of TABLE) {
      assert.equal(portalText.isPortalStockLevelValue(input), accepted, `worker rule: ${JSON.stringify(input)}`)
      const kept = editorRule(input)
      if (accepted) {
        // The Editor keeps a valid number (as the text of its value) and writes '' for an empty field.
        assert.equal(kept, input.trim() === '' ? '' : String(Number(input.trim())), `editor rule: ${JSON.stringify(input)}`)
        assert.equal(portalText.isPortalStockLevelValue(kept), true, `what the Editor saves is always accepted: ${JSON.stringify(kept)}`)
      } else {
        assert.equal(kept, '', `editor rule drops an invalid value: ${JSON.stringify(input)}`)
      }
    }
  })

  await check('POST /api/settings accepts exactly the accepted rows, for both keys, and stores the text as sent', async () => {
    for (const key of [LOW, OUT]) for (const [input, accepted] of TABLE) {
      seed(key, 'before')
      const res = await save({ [key]: input })
      if (accepted) {
        assert.equal(res.status, 200, `${key} ${JSON.stringify(input)}: ${JSON.stringify(res.body)}`)
        assert.equal(stored(key), input, `${key} ${JSON.stringify(input)}`)
      } else {
        assert.equal(res.status, 400, `${key} ${JSON.stringify(input)}: ${JSON.stringify(res.body)}`)
        assert.equal(res.body.code, 'invalid_portal_stock_level')
        assert.equal(res.body.key, key)
        assert.equal(stored(key), 'before', `${key} ${JSON.stringify(input)}: a refused save stores nothing`)
      }
    }
  })

  await check('non-text payloads follow the same rule', async () => {
    for (const [input, accepted] of NON_TEXT) {
      assert.equal(portalText.isPortalStockLevelValue(input), accepted, `worker rule: ${JSON.stringify(input)}`)
      if (typeof input === 'number' && !Number.isFinite(input)) continue // JSON carries NaN as null, so only the rule check above can see it
      seed(LOW, 'before')
      const res = await save({ [LOW]: input })
      assert.equal(res.status, accepted ? 200 : 400, `${JSON.stringify(input)} -> ${res.status}: ${JSON.stringify(res.body)}`)
    }
  })

  await check('a refused level refuses the whole save: nothing else in it lands, and the other level is not touched', async () => {
    seed(LOW, '4')
    seed(OUT, '1')
    seed('customer_portal_business_tagline', 'before')
    const res = await save({ [LOW]: '6', [OUT]: '-1', customer_portal_business_tagline: 'after' })
    assert.equal(res.status, 400, JSON.stringify(res.body))
    assert.equal(res.body.key, OUT, 'the offending key is named')
    assert.equal(stored(LOW), '4')
    assert.equal(stored(OUT), '1')
    assert.equal(stored('customer_portal_business_tagline'), 'before')
    const ok = await save({ [LOW]: '6', [OUT]: '2', customer_portal_business_tagline: 'after' })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.equal(stored(LOW), '6')
    assert.equal(stored(OUT), '2')
    assert.equal(stored('customer_portal_business_tagline'), 'after')
  })

  await check('a save that does not name a level is not judged by it', async () => {
    seed(LOW, 'junk-from-before')
    const res = await save({ customer_portal_business_tagline: 'tagline' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(stored(LOW), 'junk-from-before')
  })

  await check('the guard sits in the route, not only in the helper', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'settings.ts'), 'utf8')
    assert.ok(source.includes('invalidPortalStockLevelKey(body)') && source.includes("code: 'invalid_portal_stock_level'"))
  })

  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) { console.log(failures.join('\n')); process.exit(1) }
  console.log('All website stock level write checks passed')
}
main().catch((error) => { console.error(error); process.exit(1) })
