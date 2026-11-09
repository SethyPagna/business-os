'use strict'
// Shared by the Free-plan call-budget tests (lane P1.2): a loader that runs the REAL src modules (transpiled, not
// re-implemented), a D1 that counts every call and refuses call 51 as Cloudflare does, and the mutant runner.
//
// P12_SRC=<dir> points every test at another src tree (the base commit exported with `git archive`): that is how a
// check is proven red before the change. P12_ONLY_MUTANT=<text of its name> runs one mutant only.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const SRC = process.env.P12_SRC ? path.resolve(process.env.P12_SRC) : path.join(__dirname, '..', '..', 'src')
const LIMIT = 50
const REFUSAL = 'D1_ERROR: Too many API requests by single Worker invocation.'
// A check that legitimately needs more than 50 calls (one sale a page) still refuses a scan that never ends, e.g. a
// mutant whose page predicate re-reads the edge row for ever.
const RUNAWAY = 2000

class MutantAnchorError extends Error {}
// Set by runSuite while a mutant is being tried, so every world built meanwhile uses the deliberately wrong source.
const mutation = { active: [] }

function makeLoader(overrides) {
  const cache = new Map()
  const load = (rel) => {
    if (cache.has(rel)) return cache.get(rel).exports
    const file = path.join(SRC, rel)
    let text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    for (const patch of mutation.active.filter((p) => p.file === rel)) {
      if (text.split(patch.from).length - 1 !== 1) throw new MutantAnchorError(`mutant anchor must occur exactly once in ${rel}: ${patch.from.slice(0, 70)}`)
      text = text.replace(patch.from, () => patch.to)
    }
    const output = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file }).outputText
    const mod = { exports: {} }
    cache.set(rel, mod)
    const localRequire = (request) => {
      if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
      if (!request.startsWith('.')) return require(request)
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
      return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
    }
    new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
    return mod.exports
  }
  return load
}

// A D1 whose every call (prepare().all/get/run, batch) is counted, and call `limit`+1 is refused. beforeBatch lets a
// check run something at the exact moment between a read and the batch that depends on it.
function countingDb(db) {
  const state = { calls: 0, limit: LIMIT, statements: [], beforeBatch: null }
  const gate = () => { state.calls += 1; if (state.calls > state.limit) throw new Error(REFUSAL) }
  const wrapped = {
    prepare(sql) {
      const stmt = db.prepare(sql)
      const self = {
        bind(params) { stmt.bind(params); return self },
        all(params) { gate(); state.statements.push(sql); return stmt.all(params) },
        get(params) { gate(); state.statements.push(sql); return stmt.get(params) },
        run(params) { gate(); state.statements.push(sql); return stmt.run(params) },
      }
      return self
    },
    async batch(items) { gate(); state.statements.push('BATCH'); if (state.beforeBatch) state.beforeBatch(items); return db.batch(items) },
    async batchOnce(items) { return wrapped.batch(items) },
  }
  return { state, db: wrapped }
}

// node:sqlite rows have a null prototype; strict deepEqual wants plain objects.
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))
// A refused or failed chunk is logged with console.error; the checks that provoke it keep the output readable.
async function quietly(fn) { const original = console.error; console.error = () => {}; try { return await fn() } finally { console.error = original } }

// Runs the checks, then every mutant: each is a wrong implementation applied to the source in memory and must turn at
// least one of the checks it names red. A mutant whose anchor no longer matches is an error, never a kill.
async function runSuite(tests, mutants) {
  const only = process.env.P12_ONLY_MUTANT
  let passed = 0
  for (const test of only ? [] : tests) {
    try { await test.fn(); passed += 1; console.log('PASS', test.name) } catch (error) {
      console.log('FAIL', test.name, '-', String(error && error.message || error).split('\n').slice(0, 4).join(' | ')); process.exitCode = 1
    }
  }
  if (!only) console.log(`\n${passed} of ${tests.length} checks passed.`)
  if (process.exitCode || process.env.P12_SKIP_MUTANTS) return
  for (const mutant of mutants.filter((m) => !only || m.name.includes(only))) {
    mutation.active = [{ file: mutant.file, from: mutant.from, to: mutant.to }]
    const killed = []
    let lost = null
    for (const id of mutant.catches) {
      const test = tests.find((t) => t.name.startsWith(`${id} `))
      assert.ok(test, `mutant names an unknown check: ${id}`)
      try { await test.fn() } catch (error) {
        if (error instanceof MutantAnchorError) { lost = error.message; break }
        killed.push(id)
      }
    }
    mutation.active = []
    if (lost) { console.log(`ANCHOR LOST for mutant "${mutant.name}": ${lost}`); process.exitCode = 1; continue }
    console.log(`${killed.length ? 'KILLED  ' : 'SURVIVED'} mutant: ${mutant.name}${killed.length ? ` (red: ${killed.join(', ')})` : ''}`)
    if (!killed.length) process.exitCode = 1
  }
}

module.exports = { SRC, LIMIT, RUNAWAY, REFUSAL, makeLoader, countingDb, plain, quietly, runSuite }
