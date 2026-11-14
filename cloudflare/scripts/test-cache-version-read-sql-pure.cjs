'use strict'
// The D1 fallback read of cache versions (lib/cache.ts readD1Versions, behind getVersionsWithFallback) must be ONE batch (one round trip) of one
// primary-key lookup per distinct namespace. It used to filter with `IN (SELECT value FROM json_each(@namespaces))` (about 2N extra rows read), and
// the round-2 form `IN (?,?)` still costs one metered row per list entry even when nothing matches (the ephemeral IN table: customers-phone-search
// read 41 rows against a budget of 39). A lookup per namespace costs only the rows it finds.
//
// Pins: no json_each and no IN list on the version read, one lookup per DEDUPLICATED namespace in one batch (nothing at all for no namespaces), the
// result order and shape unchanged, and the fail-closed behaviour (a D1 failure is an unsafe token, or a throw when requireReadableD1 is set) unchanged.
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
  const state = { prepares: [], batches: [], rows: [], fail: false }
  const fakeDb = {
    prepare(sql) {
      const entry = { sql, params: undefined }
      state.prepares.push(entry)
      return {
        all: async (params) => { entry.params = params; if (state.fail) throw new Error('D1 down'); return state.rows },
        get: async () => undefined,
      }
    },
    // One result per statement, holding the rows whose namespace that statement binds.
    batch: async (statements) => {
      state.batches.push(statements)
      if (state.fail) throw new Error('D1 down')
      return statements.map((statement) => {
        const bound = Array.isArray(statement.params) ? statement.params[0] : statement.params && statement.params.namespace
        return { results: state.rows.filter((row) => row.namespace === bound) }
      })
    },
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

  const lookups = (state) => state.batches[0].map((statement) => ({ sql: statement.sql.replace(/\s+/g, ' '), bound: Array.isArray(statement.params) ? statement.params[0] : statement.params.namespace }))
  { // three distinct namespaces: one batch, one primary-key lookup each, no IN list, no json_each
    const { state } = await run(['sales', 'returns', 'customers'])
    assert.equal(state.batches.length, 1, 'one round trip for every namespace KV does not hold')
    assert.equal(state.prepares.length, 0, 'no stand-alone statement beside the batch')
    const found = lookups(state)
    assert.equal(found.length, 3, 'one lookup per namespace')
    for (const { sql } of found) {
      assert.ok(!/json_each/i.test(sql), 'no json_each on the version read (D1 meters its rows)')
      assert.ok(!/\bIN\b/i.test(sql), 'no IN list: D1 meters its entries as rows read even when nothing matches')
      assert.ok(/WHERE namespace = [@?]/.test(sql), sql)
    }
    assert.deepEqual(found.map((f) => f.bound), ['sales', 'returns', 'customers'], 'in the given order')
  }
  { // duplicates are removed first: the lookup count is the DEDUPED count
    const { state } = await run(['sales', 'returns', 'sales', 'returns', 'sales'])
    assert.equal(state.batches.length, 1)
    assert.deepEqual(lookups(state).map((f) => f.bound), ['sales', 'returns'], 'two distinct namespaces, two lookups')
  }
  { // one namespace
    const { state } = await run(['products'])
    assert.equal(state.batches.length, 1)
    assert.deepEqual(lookups(state).map((f) => f.bound), ['products'])
  }
  { // none: no statement at all, empty answer
    const { result, state } = await run([])
    assert.equal(state.prepares.length + state.batches.length, 0, 'no namespaces, no D1 read')
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
  console.log('PASS version fallback read: one batch of per-namespace lookups (deduped), no IN list, no json_each, order/shape and fail-closed unchanged')

  const LOOKUP = "WHERE namespace = @namespace'"
  const mutants = [
    ['IN list again (metered per entry)', LOOKUP, "WHERE namespace IN (@namespace)'"],
    ['json_each list again', LOOKUP, "WHERE namespace IN (SELECT value FROM json_each(@namespace))'"],
    ['lookups per requested (not deduped) namespace', "const distinct = [...new Set(namespaces)]", "const distinct = [...namespaces]"],
    ['only the first namespace is read', "distinct.map((namespace) => ({", "distinct.slice(0, 1).map((namespace) => ({"],
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
