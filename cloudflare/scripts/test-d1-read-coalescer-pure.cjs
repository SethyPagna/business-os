// Lane 6.0.1007. lib/d1ReadCoalescer.ts: reads asked in the same turn go to D1 as ONE db.batch (Cloudflare Free: 50 calls per
// invocation, a batch counts as one). The REAL coalescer and the REAL lib/db.ts (D1Compat) over a D1-shaped stand-in on
// node:sqlite that counts every call the way the binding is counted: prepared-statement all/first/run/raw = 1, batch = 1.
//
// Run (from cloudflare/): node scripts/test-d1-read-coalescer-pure.cjs
// Mutants: each rule has one that must turn this file red (MUTANTS at the end).
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { DatabaseSync } = require('node:sqlite')

const root = path.join(__dirname, '..')
function loadReal(relPath, overrides = {}, mutate = (text) => text) {
  const sourcePath = path.join(root, 'src', relPath)
  const { outputText } = ts.transpileModule(mutate(fs.readFileSync(sourcePath, 'utf8')), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath,
  })
  const original = Module._load
  Module._load = function (request, parent, main) { return request in overrides ? overrides[request] : original.call(this, request, parent, main) }
  const mod = { exports: {} }
  try { new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(mod.exports, require, mod, sourcePath, path.dirname(sourcePath)) }
  finally { Module._load = original }
  return mod.exports
}
const dbModule = loadReal('lib/db.ts', { './importMaintenanceFence': {} })

const { d1Binding } = require('./harness/d1-binding-shim.cjs')
function fakeD1(options) {
  const raw = new DatabaseSync(':memory:')
  raw.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO t VALUES (1,'one'),(2,'two'),(3,'three');")
  const { d1, log } = d1Binding(raw, options)
  return { d1, log, raw, calls: () => log.length }
}

let passed = 0
const check = (name, cond, detail) => { assert.ok(cond, detail ? `${name}\n${detail}` : name); passed += 1; console.log(`PASS ${name}`) }
const kinds = (world) => world.log.map(([kind]) => kind).join(',')
const row = (id) => `SELECT name FROM t WHERE id = ${id}`

async function suite(coalescer, label) {
  const results = []
  const record = (name, ok, detail) => results.push({ name, ok: !!ok, detail })
  const { coalesceD1Reads } = coalescer

  { // 1. independent reads of one turn: one batch, each caller gets its own rows
    const world = fakeD1(); const env = coalesceD1Reads({ DB: world.d1 }); const db = dbModule.getDb(env)
    const [a, b, c] = await Promise.all([db.prepare(row(1)).get(), db.prepare(row(2)).all(), db.prepare('SELECT name FROM t WHERE id = @id').get({ id: 3 })])
    record('three reads of one turn: one batch call with each caller\'s own rows', kinds(world) === 'batch' && a.name === 'one' && b[0].name === 'two' && c.name === 'three', `${kinds(world)} ${JSON.stringify([a, b, c])}`)
  }
  { // 2. a helper that waits a tick before its first read still travels with the others
    const world = fakeD1(); const env = coalesceD1Reads({ DB: world.d1 }); const db = dbModule.getDb(env)
    const late = async () => { await null; await null; return db.prepare(row(2)).get() }
    const [a, b] = await Promise.all([db.prepare(row(1)).get(), late()])
    record('a helper that awaits before its first read joins the same batch', kinds(world) === 'batch' && a.name === 'one' && b.name === 'two', kinds(world))
  }
  { // 3. one read is one plain call
    const world = fakeD1(); const db = dbModule.getDb(coalesceD1Reads({ DB: world.d1 }))
    const only = await db.prepare(row(1)).get()
    record('a lone read is sent as itself, not as a one-statement batch', kinds(world) === 'all' && only.name === 'one', kinds(world))
  }
  { // 4. a read that needs the previous answer is the next call
    const world = fakeD1(); const db = dbModule.getDb(coalesceD1Reads({ DB: world.d1 }))
    const first = await db.prepare(row(1)).get(); const second = await db.prepare(row(2)).get()
    record('dependent reads stay in order, one call each', kinds(world) === 'all,all' && first.name === 'one' && second.name === 'two', kinds(world))
  }
  { // 5. writes are never held back or batched; first(column) and raw() answer like D1
    const world = fakeD1(); const env = coalesceD1Reads({ DB: world.d1 })
    const [wrote, r1, r2] = await Promise.all([env.DB.prepare("INSERT INTO t VALUES (9, 'nine')").run(), env.DB.prepare(row(1)).first('name'), env.DB.prepare(row(9)).first()])
    record('run() goes straight through (so it lands before the batched reads of its turn); first(column) returns the value, first() the row',
      kinds(world) === 'run,batch' && wrote.meta.changes === 1 && r1 === 'one' && r2 && r2.name === 'nine', `${kinds(world)} ${JSON.stringify([r1, r2])}`)
    const raw = await env.DB.prepare('SELECT id, name FROM t WHERE id = 2').raw()
    record('raw() passes through', JSON.stringify(raw) === '[[2,"two"]]' && kinds(world).endsWith('raw'), JSON.stringify(raw))
  }
  { // 6. one failing read does not take its neighbours down
    const world = fakeD1({ failOn: 'BOOM' }); const db = dbModule.getDb(coalesceD1Reads({ DB: world.d1 }))
    const settled = await Promise.allSettled([db.prepare(row(1)).get(), db.prepare('SELECT BOOM FROM t').get(), db.prepare(row(3)).get()])
    record('a read that fails rejects only itself; the others still answer (batch replayed read by read)',
      settled[0].status === 'fulfilled' && settled[0].value.name === 'one' && settled[1].status === 'rejected' && /forced failure/.test(String(settled[1].reason)) && settled[2].status === 'fulfilled' && settled[2].value.name === 'three',
      JSON.stringify(settled.map((s) => s.status)))
    record('...and the replay is the batch plus one call per read', kinds(world) === 'batch,all,all,all', kinds(world))
    const before = world.calls()
    await Promise.all([db.prepare(row(1)).get(), db.prepare(row(2)).get()])
    record('a genuinely bad statement does not switch batching off: the next turn batches again', world.log.slice(before).map(([kind]) => kind).join(',') === 'batch', kinds(world))
  }
  { // 7. D1 refusing a batch that holds only good reads: replay, then stop batching on this binding
    const world = fakeD1({ refuseBatchWhen: /PRAGMA/ }); const db = dbModule.getDb(coalesceD1Reads({ DB: world.d1 }))
    const [pragma, one] = await Promise.all([db.prepare('PRAGMA table_info(t)').all(), db.prepare(row(1)).get()])
    record('a batch D1 refuses is replayed and every read still answers', pragma.length === 2 && one.name === 'one', kinds(world))
    const before = world.calls()
    await Promise.all([db.prepare(row(1)).get(), db.prepare(row(2)).get()])
    record('...and the binding stops batching, so the refusal is paid once, not on every turn', world.log.slice(before).map(([kind]) => kind).join(',') === 'all,all', world.log.slice(before).map(([kind]) => kind).join(','))
  }
  { // 8. big turns are split
    const world = fakeD1(); const db = dbModule.getDb(coalesceD1Reads({ DB: world.d1 }))
    const all = await Promise.all(Array.from({ length: 120 }, (_, i) => db.prepare(`SELECT ${i} AS n`).get()))
    record('120 reads of one turn go out as three batches of at most 50', kinds(world) === 'batch,batch,batch' && world.log.map(([, sql]) => sql.length).join() === '50,50,20' && all.every((r, i) => r.n === i), `${kinds(world)} ${world.log.map(([, sql]) => sql.length)}`)
  }
  { // 9. wrapping rules
    const world = fakeD1(); const env = coalesceD1Reads({ DB: world.d1, KEEP: 'x' })
    record('idempotent: wrapping a wrapped env changes nothing', coalesceD1Reads(env) === env && env.KEEP === 'x' && env.DB !== world.d1)
    const handMade = { DB: { prepare() { return { get() {}, all() {}, run() {} } }, batch() {} } }
    record('a hand-made compat object (no exec) is returned untouched', coalesceD1Reads(handMade) === handMade)
    const hybrid = { DB: { prepare() { return { bind() { return this }, get() {}, all() {}, run() {} } }, batch() {}, exec() {} } }
    record('a harness object with exec/batch whose statements have get() (D1Compat-like) is returned untouched', coalesceD1Reads(hybrid) === hybrid)
    const direct = await env.DB.batch([env.DB.prepare(row(1)).bind(), world.d1.prepare(row(2))])
    record('a caller\'s own db.batch is forwarded as it is (mixed wrapped and real statements)', direct.length === 2 && direct[0].results[0].name === 'one' && direct[1].results[0].name === 'two' && kinds(world) === 'batch')
  }
  return results
}

async function main() {
  const real = loadReal('lib/d1ReadCoalescer.ts')
  const outcome = await suite(real, 'real')
  for (const { name, ok, detail } of outcome) check(name, ok, detail)

  const MUTANTS = [
    ['immediate flush (microtask) instead of the end of the turn', (text) => text.replace('setTimeout(() => this.flush(), 0)', 'queueMicrotask(() => this.flush())')],
    ['no replay: a failing batch rejects every read in it', (text) => text.replace('if ((await Promise.all(group.map(alone))).every(Boolean)) this.batching = false', 'group.forEach((waiting) => waiting.reject(new Error("batch failed")))')],
    ['never stops batching after a refused batch', (text) => text.replace('this.batching = false', 'void 0')],
    ['stops batching after any failed batch', (text) => text.replace('.every(Boolean)) this.batching = false', '.length) this.batching = false')],
    ['no chunking', (text) => text.replace('const MAX_BATCH = 50', 'const MAX_BATCH = 100000')],
    ['writes are held back with the reads', (text) => text.replace('run(): Promise<D1Result> { return this.real(this.owner.d1).run() }', 'run(): Promise<D1Result> { return this.owner.read(this) }')],
    ['takes any object with prepare/batch/exec for a D1 binding', (text) => text.replace("verdict = typeof statement.bind === 'function' && typeof statement.first === 'function' && typeof statement.get !== 'function'", 'verdict = true')],
    ['no batching at all (every read its own group)', (text) => text.replace('const MAX_BATCH = 50', 'const MAX_BATCH = 1')],
  ]
  for (const [name, mutate] of MUTANTS) {
    const source = fs.readFileSync(path.join(root, 'src', 'lib', 'd1ReadCoalescer.ts'), 'utf8')
    assert.notStrictEqual(mutate(source), source, `positive control: mutant "${name}" must change the source`)
    let failed
    try { failed = (await suite(loadReal('lib/d1ReadCoalescer.ts', {}, mutate), name)).filter((result) => !result.ok).map((result) => result.name) } catch (error) { failed = [`threw: ${error.message}`] }
    check(`mutant "${name}": the suite goes red (${failed.length} check${failed.length === 1 ? '' : 's'})`, failed.length > 0, 'the mutant passed')
  }
  console.log(`\n${passed} checks passed.`)
}

main().catch((error) => { console.error(error); process.exit(1) })
