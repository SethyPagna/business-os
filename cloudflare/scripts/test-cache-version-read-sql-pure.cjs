'use strict'
// The D1 fallback read of cache versions (lib/cache.ts readD1Versions, behind getVersionsWithFallback) must be ONE statement with one bound
// placeholder per distinct namespace. It used to filter with `IN (SELECT value FROM json_each(@namespaces))`, and D1 meters the json_each rows as
// rows read: about 2N extra rows per request for N namespaces when KV misses (3 namespaces cost 9 rows, 4 cost 12). Bound placeholders are not metered.
//
// Pins: no json_each on the version read, placeholder count == deduplicated namespace count, statement count == 1 (0 for no namespaces), the result
// order and shape unchanged, and the fail-closed behaviour (a D1 failure is an unsafe token, or a throw when requireReadableD1 is set) unchanged.
// Mutation controls patch the source in memory.
//
// Run (from cloudflare/): node scripts/test-cache-version-read-sql-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const srcDir = path.join(__dirname, '..', 'src')
function loadCache(patch) {
  const filename = path.join(srcDir, 'lib/cache.ts')
  let text = fs.readFileSync(filename, 'utf8').replace(/\r\n/g, '\n')
  if (patch) {
    assert.equal(text.split(patch.from).length - 1, 1, `mutant anchor must occur once: ${patch.from.slice(0, 60)}`)
    text = text.replace(patch.from, () => patch.to)
  }
  const { outputText } = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename })
  const state = { prepares: [], rows: [], fail: false }
  const fakeDb = {
    prepare(sql) {
      const entry = { sql, params: undefined }
      state.prepares.push(entry)
      return {
        all: async (params) => { entry.params = params; if (state.fail) throw new Error('D1 down'); return state.rows },
        get: async () => undefined,
      }
    },
    batch: async () => [],
  }
  const cacheKey = loadPlain('lib/cacheKey.ts')
  const stubs = {
    './db': { getDb: () => fakeDb },
    './quotaGuard': { consumeQuota: async () => ({ zone: 'ok' }) },
    './cacheKey': cacheKey,
  }
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(mod.exports, (id) => (id in stubs ? stubs[id] : require(id)), mod, filename, path.dirname(filename))
  return { cache: mod.exports, state, cacheKey }
}
function loadPlain(rel) {
  const filename = path.join(srcDir, rel)
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename })
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(mod.exports, (id) => (id === './readSwitches' ? { readDataEpoch: async () => 'e' } : require(id)), mod, filename, path.dirname(filename))
  return mod.exports
}
// KV always misses, so every namespace falls through to the D1 read.
const missingKv = { CACHE: { get: async () => null, put: async () => {}, delete: async () => {} } }

async function scenarios(patch) {
  const run = async (namespaces, rows = [], options = {}, fail = false) => {
    const { cache, state, cacheKey } = loadCache(patch)
    state.rows = rows
    state.fail = fail
    let result, error
    try { result = await cache.getVersionsWithFallback(missingKv, namespaces, options) } catch (e) { error = e }
    return { result, error, state, cacheKey }
  }

  { // three distinct namespaces: one statement, three placeholders, no json_each
    const { state } = await run(['sales', 'returns', 'customers'])
    assert.equal(state.prepares.length, 1, 'one statement for every namespace KV does not hold')
    const sql = state.prepares[0].sql
    assert.ok(!/json_each/i.test(sql), 'no json_each on the version read (D1 meters its rows)')
    assert.equal((sql.match(/\?/g) || []).length, 3, 'one placeholder per namespace')
    assert.ok(/namespace IN \(\?,\?,\?\)/.test(sql.replace(/\s+/g, ' ')), sql)
    assert.deepEqual(state.prepares[0].params, ['sales', 'returns', 'customers'], 'bound positionally, in the given order')
  }
  { // duplicates are removed first: the placeholder count is the DEDUPED count
    const { state } = await run(['sales', 'returns', 'sales', 'returns', 'sales'])
    assert.equal(state.prepares.length, 1)
    assert.equal((state.prepares[0].sql.match(/\?/g) || []).length, 2, 'two distinct namespaces, two placeholders')
    assert.deepEqual(state.prepares[0].params, ['sales', 'returns'])
  }
  { // one namespace
    const { state } = await run(['products'])
    assert.equal(state.prepares.length, 1)
    assert.ok(/namespace IN \(\?\)/.test(state.prepares[0].sql.replace(/\s+/g, ' ')))
    assert.deepEqual(state.prepares[0].params, ['products'])
  }
  { // none: no statement at all, empty answer
    const { result, state } = await run([])
    assert.equal(state.prepares.length, 0, 'no namespaces, no D1 read')
    assert.deepEqual(result, [])
  }
  { // result order and shape: one token per requested namespace, in request order, D1 rows as d-tokens, a namespace with no row as the zero kv token
    const { result, cacheKey } = await run(['sales', 'returns', 'sales', 'customers'], [{ namespace: 'returns', version: 7 }, { namespace: 'sales', version: 3 }])
    assert.equal(result.length, 4, 'one entry per requested namespace, duplicates included')
    assert.equal(result[0], result[2], 'a repeated namespace gets the same token')
    assert.notEqual(result[0], result[1])
    assert.ok(result[0].includes('3') && result[1].includes('7'), `${result.join(' | ')}`)
    assert.ok(!cacheKey.isUnsafeVersion(result[0]) && !cacheKey.isUnsafeVersion(result[3]), 'never-bumped is the safe zero token')
  }
  { // fail-closed: D1 down => unsafe tokens (compute, cache nothing); requireReadableD1 => throws
    const down = await run(['sales', 'returns'], [], {}, true)
    assert.ok(down.result.every((token) => down.cacheKey.isUnsafeVersion(token)), 'a failed D1 read is never the shared zero token')
    const strict = await run(['sales'], [], { requireReadableD1: true }, true)
    assert.ok(strict.error, 'requireReadableD1 propagates the failure')
  }
}

async function main() {
  await scenarios(null)
  console.log('PASS version fallback read: one statement, bound placeholders (deduped), no json_each, order/shape and fail-closed unchanged')

  const FROM = "WHERE namespace IN (${distinct.map(() => '?').join(',')})`)\n      .all<{ namespace: string; version: number }>(distinct)"
  const mutants = [
    ['json_each list again', FROM, "WHERE namespace IN (SELECT value FROM json_each(@namespaces))`)\n      .all<{ namespace: string; version: number }>({ namespaces: JSON.stringify(distinct) })"],
    ['placeholders per requested (not deduped) namespace', "const distinct = [...new Set(namespaces)]", "const distinct = [...namespaces]"],
    ['one statement per namespace', FROM, "WHERE namespace = ?`)\n      .all<{ namespace: string; version: number }>([distinct[0]])"],
    ['read swallowed instead of fail-closed', "if (requireReadable) throw error", "if (false) throw error"],
  ]
  for (const [name, from, to] of mutants) {
    let red = false
    try { await scenarios({ from, to }) } catch (error) {
      if (/mutant anchor/.test(String(error && error.message))) throw error
      red = true
    }
    assert.ok(red, `mutant survived: ${name}`)
    console.log(`MUTANT killed: ${name}`)
  }
  console.log(`all checks passed; ${mutants.length} mutants killed`)
}
main().catch((error) => { console.error(error); process.exit(1) })
