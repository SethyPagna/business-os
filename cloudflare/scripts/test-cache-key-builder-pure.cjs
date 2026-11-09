'use strict'
// CACHE-LIFECYCLE R1 / R2 (lane 6.0.1048): there is ONE server cache-key builder and nothing writes around it.
//   A. Every cachedJsonResponse() call in src/ passes cacheIdentity(...) as its identity. A call without one would compute uncached
//      for ever (silently turning a cache off) or, worse, tempt the next author to build a key by hand.
//   B. Only the files below touch the Cache API. A new one must go through lib/cacheKey.ts and be added here with its key.
//   C. Each part of the key (layer, build, org, epoch, scope, params, versions, switch salt, time) changes the key; the request Host and
//      the cache-version parameter do not.
//   D. The statement that rotates the epoch inserts when there is no row, replaces the value when there is, always stores 32 lower-case hex
//      and never repeats; the cutover's release batch carries it immediately before the release.
// Every checker runs on planted violations first (positive controls), so a checker that cannot fail cannot pass.
//
// Run: node scripts/test-cache-key-builder-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')

const SRC = path.join(__dirname, '..', 'src')
const lf = (text) => text.split('\r\n').join('\n')
const read = (relative) => lf(fs.readFileSync(path.join(SRC, relative), 'utf8'))
let passed = 0
async function check(name, run) { try { await run(); passed += 1; console.log(`PASS ${name}`) } catch (error) { process.exitCode = 1; console.error(`FAIL ${name}\n  ${error && error.message}`) } }

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (
    entry.isDirectory() ? sourceFiles(path.join(directory, entry.name)) : entry.name.endsWith('.ts') ? [path.join(directory, entry.name)] : []))
}

/** The calls of `cachedJsonResponse(...)` in one source text and whether each passes cacheIdentity(...) as its sixth argument. */
function cachedCalls(text, fileName = 'planted.ts') {
  const parsed = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true)
  const out = []
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'cachedJsonResponse') {
      const sixth = node.arguments[5]
      const identified = !!sixth && ts.isCallExpression(sixth) && ts.isIdentifier(sixth.expression) && sixth.expression.text === 'cacheIdentity'
      out.push({ line: parsed.getLineAndCharacterOfPosition(node.getStart()).line + 1, identified })
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return out
}

/** True when the code (not a comment or a string) names the Cache API: `caches`, `globalThis.caches`, `typeof caches`. */
function usesCachesApi(text) {
  const parsed = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true)
  let found = false
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === 'caches') found = true
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return found
}

const CACHE_API_USERS = {
  'lib/cache.ts': 'cachedJsonResponse: the builder (lib/cacheKey.ts)',
  'lib/dashboardRankingsCache.ts': 'dashboard rankings: build + epoch + versions in the key',
  'lib/dashboardStockOverview.ts': 'dashboard stock overview: build + epoch + versions + business date in the key',
  'routes/portal.ts': 'storefront edge entries: deploy id + epoch + versions in the key',
  'routes/products.ts': 'image-only facets: build + epoch + versions + statements hashed into the key',
  'routes/notifications.ts': 'notification sections: through cachedJsonResponse',
  'lib/r2.ts': '/uploads read-through: immutable stored names, 1 year, no staff data',
  'lib/imageVariantStore.ts': '/uploads variants: immutable stored names',
}

async function main() {
  await check('A. every cachedJsonResponse() call in src/ passes cacheIdentity(...)', () => {
    const offenders = []
    let total = 0
    for (const file of sourceFiles(SRC)) {
      const relative = path.relative(SRC, file).split(path.sep).join('/')
      if (relative === 'lib/cache.ts') continue
      for (const call of cachedCalls(lf(fs.readFileSync(file, 'utf8')), relative)) { total += 1; if (!call.identified) offenders.push(`${relative}:${call.line}`) }
    }
    assert.ok(total >= 15, `the scan found only ${total} calls; it is looking in the wrong place`)
    assert.deepEqual(offenders, [], 'these calls compute uncached for ever or build a key by hand')
  })

  await check('A. positive controls: the checker flags a call with no identity, a literal one, undefined, and accepts cacheIdentity(c)', () => {
    const flagged = (code) => cachedCalls(`async function f(c) { ${code} }`).map((call) => call.identified)
    assert.deepEqual(flagged('await cachedJsonResponse(req, ctx, v, 20, () => 1)'), [false])
    assert.deepEqual(flagged('await cachedJsonResponse(req, ctx, v, 20, () => 1, undefined)'), [false])
    assert.deepEqual(flagged("await cachedJsonResponse(req, ctx, v, 20, () => 1, { org: '1' } as never)"), [false])
    assert.deepEqual(flagged('await cachedJsonResponse(req, ctx, v, 20, () => 1, cacheIdentity(c))'), [true])
    assert.deepEqual(flagged('await cachedJsonResponse(req, ctx, v, 20, async () => { await x(); return 1 }, cacheIdentity(c, { scope: "s" }))'), [true])
  })

  await check('B. only the listed files touch the Cache API', () => {
    const users = []
    for (const file of sourceFiles(SRC)) {
      const relative = path.relative(SRC, file).split(path.sep).join('/')
      if (usesCachesApi(lf(fs.readFileSync(file, 'utf8')))) users.push(relative)
    }
    const unknown = users.filter((relative) => !(relative in CACHE_API_USERS))
    assert.deepEqual(unknown, [], 'a new Cache API user must key through lib/cacheKey.ts (build, org, epoch, scope, params, versions, salt, time) and be listed here')
    for (const listed of ['lib/cache.ts', 'lib/dashboardRankingsCache.ts', 'lib/dashboardStockOverview.ts', 'routes/portal.ts', 'routes/products.ts']) assert.ok(users.includes(listed), `${listed} no longer uses the Cache API; update the list`)
  })

  await check('B. positive control: a planted file that calls caches.default is not in the list', () => {
    assert.ok(usesCachesApi('const c = caches.default'))
    assert.ok(usesCachesApi('const s = (globalThis as { caches?: { default?: Cache } }).caches?.default ?? null'))
    assert.ok(usesCachesApi("if (typeof caches === 'undefined') return"))
    assert.ok(!usesCachesApi('// so sessions and caches see the change\nconst x = "caches"'), 'a comment or a string is not a use')
    assert.ok(!('lib/plantedCache.ts' in CACHE_API_USERS))
  })

  // C. the builder, with the real transpiled lib/cacheKey.ts
  const load = (relative, requireFor) => {
    const filename = path.join(SRC, relative)
    const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename })
    const mod = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(mod.exports, requireFor, mod, filename, path.dirname(filename))
    return mod.exports
  }
  let epoch = 'a'.repeat(32)
  const cacheKey = load('lib/cacheKey.ts', (id) => (id === './readSwitches' ? { readDataEpoch: async () => epoch } : require(id)))
  const env = { CF_VERSION_METADATA: { id: 'build-1' } }
  const baseIdentity = () => cacheKey.cacheIdentity({ env, get: () => ({ organization_id: 1 }) })
  const keyOf = async (overrides = {}, url = 'https://admin.example.test/api/sales?a=1&b=2', version = 'sales:d2:4') => (await cacheKey.cacheKeyRequest(url, version, { ...baseIdentity(), ...overrides })).url

  await check('C. each part of the key changes it: build, org, epoch, scope, params, versions, switch salt, time; the Host, the _v parameter and parameter order do not', async () => {
    const base = await keyOf()
    assert.equal(base, await keyOf({}, 'https://another-host.example.test/api/sales?b=2&_v=zzz&a=1'), 'Host, order and _v are not part of the key')
    const changed = {
      build: await keyOf({ env: { CF_VERSION_METADATA: { id: 'build-2' } } }),
      org: await keyOf({ org: '2' }),
      scope: await keyOf({ scope: 'grants:cost' }),
      params: await keyOf({}, 'https://admin.example.test/api/sales?a=1&b=3'),
      path: await keyOf({}, 'https://admin.example.test/api/sales/stats?a=1&b=2'),
      versions: await keyOf({}, 'https://admin.example.test/api/sales?a=1&b=2', 'sales:d2:5'),
      salt: await keyOf({ salt: 'sw3' }),
      time: await keyOf({ time: '2026-11-02' }),
    }
    for (const [part, key] of Object.entries(changed)) assert.notEqual(key, base, `${part} must change the key`)
    epoch = 'b'.repeat(32)
    assert.notEqual(await keyOf(), base, 'the epoch must change the key')
    epoch = 'a'.repeat(32)
    assert.equal(new Set([base, ...Object.values(changed)]).size, 9, 'no two single-part changes collide')
  })

  await check('C. no safe key: no identity, an unsafe version, no epoch', async () => {
    assert.equal(await cacheKey.cacheKeyRequest('https://x.test/api/a', 'v', undefined), null)
    assert.equal(await cacheKey.cacheKeyRequest('https://x.test/api/a', cacheKey.unsafeVersionToken(), baseIdentity()), null)
    assert.equal(await cacheKey.cacheKeyRequest('https://x.test/api/a', `a:1|b:${cacheKey.unsafeVersionToken()}`, baseIdentity()), null)
    const saved = epoch
    epoch = null
    assert.equal(await cacheKey.cacheKeyRequest('https://x.test/api/a', 'v', baseIdentity()), null)
    epoch = saved
    assert.notEqual(cacheKey.unsafeVersionToken(), cacheKey.unsafeVersionToken(), 'an unsafe token is unique to its call, never a shared value')
  })

  await check('C. the entry lives on the configured origin of the deployment (admin, then public, then a fixed fallback), never on the request Host', async () => {
    const originOf = async (extraEnv, url = 'https://hostile-host.example.test/api/sales?a=1') => new URL((await cacheKey.cacheKeyRequest(url, 'sales:d2:4', cacheKey.cacheIdentity({ env: { ...env, ...extraEnv }, get: () => ({ organization_id: 1 }) }))).url).origin
    assert.equal(await originOf({ BUSINESS_OS_ADMIN_URL: 'https://admin.leang.test/', BUSINESS_OS_PUBLIC_URL: 'https://leang.test' }), 'https://admin.leang.test')
    assert.equal(await originOf({ BUSINESS_OS_ADMIN_URL: '', BUSINESS_OS_PUBLIC_URL: 'https://leang.test/x' }), 'https://leang.test')
    assert.equal(await originOf({ BUSINESS_OS_ADMIN_URL: 'not a url', BUSINESS_OS_PUBLIC_URL: 'ftp://leang.test' }), 'https://cache.bos.invalid')
    assert.equal(await originOf({}), 'https://cache.bos.invalid')
    assert.equal(await originOf({ BUSINESS_OS_ADMIN_URL: 'https://admin.leang.test' }, 'https://admin.leang.test/api/sales?a=1'), await originOf({ BUSINESS_OS_ADMIN_URL: 'https://admin.leang.test' }), 'the request Host never steers the origin')
  })

  await check('C. a mutant builder without the deployment, the organisation or the epoch is caught by the same assertions', async () => {
    const mutate = (from, to) => {
      const filename = path.join(SRC, 'lib/cacheKey.ts')
      const text = lf(fs.readFileSync(filename, 'utf8'))
      assert.ok(text.includes(from), `mutation anchor missing: ${from}`)
      const { outputText } = ts.transpileModule(text.replace(from, to), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename })
      const mod = { exports: {} }
      new Function('exports', 'require', 'module', outputText)(mod.exports, (id) => (id === './readSwitches' ? { readDataEpoch: async () => epoch } : require(id)), mod)
      return mod.exports
    }
    const distinct = async (builder, overrides) => {
      const make = (extra = {}) => builder.cacheKeyRequest('https://admin.example.test/api/sales?a=1', 'sales:d2:4', { ...builder.cacheIdentity({ env, get: () => ({ organization_id: 1 }) }), ...extra })
      return (await make()).url !== (await make(overrides)).url
    }
    const noBuild = mutate("build: deploymentId(identity.env)", "build: 'dev'")
    assert.equal(await distinct(noBuild, { env: { CF_VERSION_METADATA: { id: 'build-2' } } }), false, 'mutant: the deployment is ignored')
    assert.equal(await distinct(cacheKey, { env: { CF_VERSION_METADATA: { id: 'build-2' } } }), true)
    const noOrg = mutate('org: identity.org,', "org: '',")
    assert.equal(await distinct(noOrg, { org: '2' }), false, 'mutant: the organisation is ignored')
    assert.equal(await distinct(cacheKey, { org: '2' }), true)
    const noEpoch = mutate('epoch, scope: identity.scope', "epoch: '', scope: identity.scope")
    const one = await noEpoch.cacheKeyRequest('https://admin.example.test/api/sales', 'v', noEpoch.cacheIdentity({ env, get: () => ({}) }))
    epoch = 'c'.repeat(32)
    const two = await noEpoch.cacheKeyRequest('https://admin.example.test/api/sales', 'v', noEpoch.cacheIdentity({ env, get: () => ({}) }))
    epoch = 'a'.repeat(32)
    assert.equal(one.url, two.url, 'mutant: the epoch is ignored')
  })

  // D. the rotation statement
  const { ROTATE_DATA_EPOCH_SQL } = load('lib/dataEpochSql.ts', require)
  const flags = () => { const db = new Database(':memory:'); db.exec('CREATE TABLE system_flags (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT)'); return db }
  const epochOf = (db) => db.prepare("SELECT value FROM system_flags WHERE key = 'data_epoch'").all().map((row) => row.value)

  await check('D. the rotation statement inserts when there is no row, replaces the value when there is, stores 32 hex and never repeats', () => {
    const db = flags()
    assert.deepEqual(epochOf(db), [])
    db.exec(ROTATE_DATA_EPOCH_SQL)
    assert.equal(epochOf(db).length, 1)
    assert.match(epochOf(db)[0], /^[0-9a-f]{32}$/)
    const seen = new Set(epochOf(db))
    for (let index = 0; index < 200; index += 1) { db.exec(ROTATE_DATA_EPOCH_SQL); assert.equal(epochOf(db).length, 1); assert.match(epochOf(db)[0], /^[0-9a-f]{32}$/); seen.add(epochOf(db)[0]) }
    assert.equal(seen.size, 201, 'every rotation produced a value never seen before')
  })

  await check('D. it touches no other flag, and a locked row refuses the rotation (so a caller can keep its hold)', () => {
    const db = flags()
    db.exec("INSERT INTO system_flags VALUES ('maintenance', '{}', 'x'), ('read_switches', '{}', 'x')")
    db.exec(ROTATE_DATA_EPOCH_SQL)
    assert.deepEqual(db.prepare("SELECT key, value FROM system_flags WHERE key <> 'data_epoch' ORDER BY key").all(), [{ key: 'maintenance', value: '{}' }, { key: 'read_switches', value: '{}' }])
    db.exec("CREATE TRIGGER refuse BEFORE UPDATE ON system_flags WHEN NEW.key = 'data_epoch' BEGIN SELECT RAISE(ABORT, 'locked'); END")
    assert.throws(() => db.exec(ROTATE_DATA_EPOCH_SQL), /locked/)
  })

  await check("D. the cutover's release batch rotates the epoch in the same batch, immediately before it releases the hold", () => {
    const releaseBatch = (text) => {
      const at = text.indexOf('if (clearOwnedFlag) statements.push(')
      assert.ok(at >= 0, 'the clearOwnedFlag branch moved')
      return text.slice(at, text.indexOf('\n', at))
    }
    const real = releaseBatch(read('lib/branchCutoverJournal.ts'))
    assert.ok(real.indexOf('ROTATE_DATA_EPOCH_SQL') >= 0 && real.indexOf('ROTATE_DATA_EPOCH_SQL') < real.indexOf("DELETE FROM system_flags WHERE key='maintenance'"), real)
    const swapped = "if (clearOwnedFlag) statements.push({ sql: \"DELETE FROM system_flags WHERE key='maintenance' AND value=@flag\", params }, { sql: ROTATE_DATA_EPOCH_SQL, params: {} })"
    assert.ok(!(swapped.indexOf('ROTATE_DATA_EPOCH_SQL') < swapped.indexOf("DELETE FROM system_flags WHERE key='maintenance'")), 'positive control: a rotation after the release is not accepted by the same test')
    assert.ok(!releaseBatch('if (clearOwnedFlag) statements.push({ sql: "DELETE FROM system_flags WHERE key=\'maintenance\' AND value=@flag", params })\n').includes('ROTATE_DATA_EPOCH_SQL'), 'positive control: a release with no rotation is not accepted')
  })

  console.log(`${passed} checks passed`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
