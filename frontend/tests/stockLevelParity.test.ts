// stockLevelState (frontend/src/utils/lowStockSettings.ts) must give the SAME answer as the SQL the
// bell, the Dashboard overview and the low/out alert pages run -- owner ask 15 Nov 2026: a product is
// never "low" in one place and "healthy" in another.
//
// The server side is not re-typed here. lowStockThresholdSql is loaded from the Worker's own source
// (transpiled, './db' stubbed) and wrapped in the exact comparisons the readers use (out = COALESCE(qty,0)
// <= COALESCE(out_of_stock_threshold,0); low = qty > out AND qty <= the effective threshold), then run in
// node:sqlite over a matrix of quantity x both thresholds x config. The columns are REAL, like
// production's. The readers' own text is pinned so a server edit cannot leave this oracle stale.
//
// Mutants are applied to the REAL frontend source text and must each go red against the matrix; a
// mutant that no longer matches the source fails the test (positive control).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import ts from 'typescript'

const frontendSource = readFileSync(new URL('../src/utils/lowStockSettings.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const serverSource = readFileSync(new URL('../../cloudflare/src/lib/lowStockSettings.ts', import.meta.url), 'utf8')

function load(source: string, fileName: string, stubs: Record<string, unknown> = {}): any {
  const out = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName }).outputText
  const module = { exports: {} as any }
  new Function('exports', 'require', 'module', out)(module.exports, (request: string) => {
    if (request in stubs) return stubs[request]
    throw new Error(`unexpected require ${request}`)
  }, module)
  return module.exports
}
const server = load(serverSource, 'serverLowStock.ts', { './db': { getDb: () => null } })

type Cfg = { enabled: boolean; mode: 'product' | 'global'; threshold: number }
const configs: Cfg[] = []
for (const threshold of [0, 3, 10]) {
  configs.push(
    { enabled: true, mode: 'product', threshold }, { enabled: true, mode: 'global', threshold },
    { enabled: false, mode: 'product', threshold }, { enabled: false, mode: 'global', threshold },
  )
}

const quantities = [null, -3, -0.5, 0, 0.5, 1, 2, 2.5, 3, 5, 10, 10.5, 11, 1000]
const outs = [null, 0, -1, 0.5, 2, 2.5]
const lows = [null, 0, -1, 2.5, 3, 10]

type Row = { qty: number | null; low: number | null; out: number | null }
const rows: Row[] = []
for (const qty of quantities) for (const out of outs) for (const low of lows) rows.push({ qty, low, out })

function oracle(config: Cfg): Array<'out' | 'low' | 'healthy'> {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE p (id INTEGER PRIMARY KEY, stock_quantity REAL, low_stock_threshold REAL, out_of_stock_threshold REAL)')
  const insert = db.prepare('INSERT INTO p (id, stock_quantity, low_stock_threshold, out_of_stock_threshold) VALUES (?, ?, ?, ?)')
  rows.forEach((row, index) => insert.run(index, row.qty, row.low, row.out))
  const low = server.lowStockThresholdSql(config, 'p.low_stock_threshold')
  // The comparisons exactly as familyStockStats.ts (has_healthy / has_low) and notifications.ts (is_out) write them.
  const sql = `SELECT CASE
      WHEN COALESCE(p.stock_quantity, 0) <= COALESCE(p.out_of_stock_threshold, 0) THEN 'out'
      WHEN COALESCE(p.stock_quantity, 0) > COALESCE(p.out_of_stock_threshold, 0) AND COALESCE(p.stock_quantity, 0) <= ${low} THEN 'low'
      ELSE 'healthy' END AS state FROM p ORDER BY id`
  const result = db.prepare(sql).all().map((r: any) => r.state)
  db.close()
  return result
}

const oracles = configs.map(oracle)
// Positive controls: the matrix must exercise all three outcomes, or a green run proves nothing.
for (const states of oracles) assert.ok(new Set(states).size >= 2, 'a config produced a single outcome')
assert.deepEqual([...new Set(oracles.flat())].sort(), ['healthy', 'low', 'out'])
assert.ok(rows.length >= 500)

function mismatches(mod: any): number {
  let bad = 0
  configs.forEach((config, c) => rows.forEach((row, r) => {
    const got = mod.stockLevelState(row.qty, { low_stock_threshold: row.low, out_of_stock_threshold: row.out }, config)
    if (got !== oracles[c][r]) bad += 1
  }))
  return bad
}

const real = load(frontendSource, 'lowStockSettings.ts')
assert.equal(mismatches(real), 0, 'stockLevelState disagrees with the server SQL')

// The shipped three-tier helper delegates to the same rule, so no second copy can drift.
configs.forEach((config, c) => rows.forEach((row, r) => {
  const tier = real.resolveStockTier(config, row.qty, row.low, row.out)
  const expected = oracles[c][r] === 'out' ? 'out_of_stock' : oracles[c][r] === 'low' ? 'low_stock' : 'in_stock'
  assert.equal(tier, expected, `resolveStockTier diverged at ${JSON.stringify({ config, row })}`)
}))

// Pin the readers' own comparisons so the oracle above cannot silently go stale.
const stats = readFileSync(new URL('../../cloudflare/src/lib/familyStockStats.ts', import.meta.url), 'utf8')
const bell = readFileSync(new URL('../../cloudflare/src/routes/notifications.ts', import.meta.url), 'utf8')
assert.ok(stats.includes('${qty} > COALESCE(p.out_of_stock_threshold, 0) AND ${qty} > ${lowThresholdSql}'), 'familyStockStats has_healthy changed')
assert.ok(stats.includes('${qty} > COALESCE(p.out_of_stock_threshold, 0) AND ${qty} <= ${lowThresholdSql}'), 'familyStockStats has_low changed')
assert.ok(bell.includes('COALESCE(stock_quantity, 0) <= COALESCE(out_of_stock_threshold, 0)'), 'notifications is_out changed')
assert.ok(bell.includes('COALESCE(stock_quantity, 0) <= ${lowThresholdSql}'), 'notifications low comparison changed')

// ---- Mutants: each edits the real source and must turn the matrix red ----
const mutants: Array<{ name: string; from: string; to: string }> = [
  { name: 'out uses < instead of <=', from: 'if (have <= out) return', to: 'if (have < out) return' },
  { name: 'low uses < instead of <=', from: 'if (have <= effectiveLowStockThreshold(', to: 'if (have < effectiveLowStockThreshold(' },
  { name: 'out threshold ignored (qty <= 0)', from: 'if (have <= out) return', to: 'if (have <= 0) return' },
  { name: 'NULL out threshold treated as 1', from: 'const out = Number.isFinite(outNumber) ? outNumber : 0', to: 'const out = Number.isFinite(outNumber) ? outNumber : 1' },
  { name: 'global mode honours the product threshold', from: "if (config.mode === 'global') return global", to: "if (config.mode === 'global' && !Number.isFinite(Number(productThreshold))) return global" },
  { name: 'alerts-off does not suppress low', from: 'if (!config.enabled) return NO_LOW_STOCK_THRESHOLD', to: 'if (false) return NO_LOW_STOCK_THRESHOLD' },
  { name: 'alerts-off threshold is 0 instead of -1', from: 'export const NO_LOW_STOCK_THRESHOLD = -1', to: 'export const NO_LOW_STOCK_THRESHOLD = 0' },
  { name: 'product mode ignores the product threshold', from: 'return Number.isFinite(own) ? own : global', to: 'return global' },
  { name: 'NULL quantity is not 0', from: "const asNumber = qty == null || qty === '' ? 0 : Number(qty)", to: "const asNumber = qty == null || qty === '' ? 99 : Number(qty)" },
  { name: 'healthy answer becomes low', from: "  return 'healthy'\n}\n\n/** A product-family header", to: "  return 'low'\n}\n\n/** A product-family header" },
]
for (const mutant of mutants) {
  assert.ok(frontendSource.includes(mutant.from), `mutant "${mutant.name}" no longer matches the source (stale mutant)`)
  const mutated = load(frontendSource.replace(mutant.from, mutant.to), 'mutant.ts')
  assert.ok(mismatches(mutated) > 0, `mutant survived: ${mutant.name}`)
}

// Precomputed status: honoured only when it is a real status; never invents a state otherwise.
assert.equal(real.stockLevelState(0, null, configs[0], 'healthy'), 'healthy')
assert.equal(real.stockLevelState(100, null, configs[0], 2), 'out')
assert.equal(real.stockLevelState(100, null, configs[0], 1), 'low')
assert.equal(real.stockLevelState(100, null, configs[0], 'bogus'), 'healthy')
assert.equal(real.stockLevelState(0, null, configs[0], undefined), 'out')

console.log(`PASS stockLevelState matches the server SQL on ${rows.length} rows x ${configs.length} configs; ${mutants.length} mutants killed`)
