const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')
const src = path.join(__dirname, '..', 'src', 'lib')
function load(name, dependencies) {
  const mod = { exports: {} }
  const file = path.join(src, name + '.ts')
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('exports', 'require', 'module', code)(mod.exports, id => {
    if (Object.hasOwn(dependencies, id)) return dependencies[id]
    throw new Error('Unexpected dependency ' + id)
  }, mod)
  return mod.exports
}
const { D1Compat } = load('db', { './importMaintenanceFence': {} })
function fixture(options = {}) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('CREATE TABLE cache_versions(namespace TEXT PRIMARY KEY, version INTEGER NOT NULL, updated_at TEXT NOT NULL)')
  const kv = new Map(options.kv || [])
  const attempts = [], kvEffects = [], quota = []
  let failedRead = false, failedWrite = false
  const perform = (sql, values, write) => {
    attempts.push(sql)
    if (!write && options.retry && !failedRead) { failedRead = true; throw new Error('D1_ERROR: internal error') }
    if (write && options.retry && !failedWrite) { failedWrite = true; throw new Error('D1_ERROR: internal error') }
    if (write && options.race) sqlite.prepare("UPDATE cache_versions SET version=99 WHERE namespace='products'").run()
    const stmt = sqlite.prepare(sql)
    if (!write) return { results: stmt.all(...values), meta: {} }
    const result = stmt.run(...values)
    return { results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
  }
  const raw = {
    prepare(sql) { return { bind(...values) { return { all: async () => perform(sql, values, false), run: async () => perform(sql, values, true), sql, values } } } },
    async batch(statements) {
      sqlite.exec('BEGIN')
      try { const results = statements.map(s => perform(s.sql, s.values, true)); sqlite.exec('COMMIT'); if(options.lostAck && !failedWrite){failedWrite=true;throw new Error('D1_ERROR: internal error lost acknowledgement')} return results }
      catch (error) { if(sqlite.isTransaction) sqlite.exec('ROLLBACK'); throw error }
    },
  }
  const cache = load('cache', {
    './db': { getDb: () => new D1Compat(raw) },
    './quotaGuard': { consumeQuota: async (_env, resource, count) => { quota.push({ resource, count }); return { zone: options.zone || 'ok' } } },
  })
  const env = { CACHE: {
    get: async key => { if (options.kvReadFailure) throw new Error('KV unavailable'); return kv.get(key) ?? null },
    put: async (key, value) => { kvEffects.push(['put', key, value]); if (options.kvWriteFailure) throw new Error('KV unavailable'); kv.set(key, value) },
    delete: async key => { kvEffects.push(['delete', key]); kv.delete(key) },
  } }
  const seed = (namespace, version) => sqlite.prepare("INSERT INTO cache_versions VALUES(?,?,'old')").run(namespace, version)
  const state = () => sqlite.prepare('SELECT namespace,version,updated_at FROM cache_versions ORDER BY namespace').all()
  return { sqlite, cache, env, seed, state, attempts, quota, kvEffects, kv }
}
;(async () => {
  for (const retry of [false, true]) {
    const f = fixture({ retry })
    for (const [namespace, version] of [['products', 40], ['returns', 0], ['sales', 100], ['untouched', 9]]) f.seed(namespace, version)
    await f.cache.bumpVersions(f.env, ['products', 'sales', 'returns', 'products', ''])
    assert.deepEqual(f.state().map(({ namespace, version }) => [namespace, version]), [['products',41],['returns',1],['sales',101],['untouched',9]])
    assert.equal(f.state().find(r => r.namespace === 'untouched').updated_at, 'old')
    assert.equal(f.quota.length, 0, 'permanent D1 fallback spends no KV quota')
    assert.deepEqual(f.kvEffects, [])
    console.log(JSON.stringify({ threeNamespacePhysicalStatements: f.attempts.length, retry }))
    assert.equal(f.attempts.length, retry ? 4 : 2, 'three namespace fallback uses two statements, four including both real adapter retries')
    f.sqlite.close()
  }
  for (const zone of ['critical', 'exhausted']) {
    const f = fixture({ zone, kv: [['v2:products','50'],['v2:sales','4']] })
    f.seed('products', 80); f.seed('untouched', 12)
    await f.cache.bumpVersions(f.env, ['products', 'sales', "quoted'ជ", 'products'])
    assert.deepEqual(f.state().map(r => [r.namespace,r.version]), [['products',81],["quoted'ជ",1],['sales',5],['untouched',12]])
    assert.equal(f.quota.length, 3)
    assert.equal(f.attempts.length, 2)
    assert.equal(f.kv.size, 0)
    f.quota.length=0;f.attempts.length=0;f.kvEffects.length=0
    await f.cache.bumpVersions(f.env, ['products', 'sales', "quoted'ជ"])
    assert.equal(f.quota.length,0); assert.equal(f.attempts.length,2);assert.deepEqual(f.kvEffects,[])
    f.sqlite.close()
  }
  const healthy=fixture({kv:[['v2:products','0'],['v2:sales','7']]})
  await healthy.cache.bumpVersions(healthy.env,['products','sales'])
  assert.deepEqual([...healthy.kv],[['v2:products','1'],['v2:sales','8']]);assert.equal(healthy.attempts.length,0);assert.equal(healthy.quota.length,2)
  await healthy.cache.bumpVersions(healthy.env,[]);assert.equal(healthy.quota.length,2)
  healthy.sqlite.close()
  const mixed=fixture({kv:[['v2:sales','5']],kvWriteFailure:true})
  mixed.seed('products',10)
  await mixed.cache.bumpVersions(mixed.env,['products','sales'])
  assert.deepEqual(mixed.state().map(r=>[r.namespace,r.version]),[['products',11],['sales',6]])
  assert.equal(mixed.quota.length,1);assert.equal(mixed.kv.has('v2:sales'),false);assert.equal(mixed.attempts.length,2)
  mixed.sqlite.close()
  const race=fixture({race:true});race.seed('products',1)
  await race.cache.bumpVersions(race.env,['products'])
  assert.equal(race.state()[0].version,100,'concurrent newer version wins MAX instead of regressing')
  race.sqlite.close()
  const lostAck=fixture({lostAck:true});lostAck.seed('products',5);lostAck.seed('sales',8);lostAck.seed('returns',1)
  await lostAck.cache.bumpVersions(lostAck.env,['products','sales','returns'])
  assert.deepEqual(lostAck.state().map(r=>[r.namespace,r.version]),[['products',7],['returns',3],['sales',10]],'existing retry semantics advance monotonically after committed write loses acknowledgement')
  assert.equal(lostAck.attempts.length,3);assert.equal(lostAck.quota.length,0)
  lostAck.sqlite.close()
  console.log('PASS real cache + D1Compat two/four physical statement budget, full state, quota/handoff, KV failures and namespace isolation')
})().catch(error=>{console.error(error);process.exitCode=1})
