// stockLevelState / stockGroupLevel / isStockFamilyHeader (frontend/src/utils/lowStockSettings.ts) must give the SAME
// answer as every piece of Worker SQL that decides out / low / healthy -- owner ask 15 Nov 2026: a product is never
// "low" in one place and "healthy" in another.
//
// The Worker's own text is executed in node:sqlite (or, for the JS copies, transpiled and called) over a 504-row x
// 12-config matrix (quantity x both thresholds x alerts on/off x product/global mode, NULL / 0 / negative / fractional).
// What is re-typed here is the REFERENCE rule (refState) and nothing else: each Worker line is read from its source file
// and run as written, including the threshold COLUMN each caller passes to lowStockThresholdSql and the `stockExpr` the
// Products / Inventory filters compare (both the catalog sum and the selected-branch form):
//   - lowStockThresholdSql and isLowStock (lib/lowStockSettings.ts), classifyCrossing (lib/stockCrossingAlert.ts);
//   - getFamilyStockStats, getFamilyStockAlertPage and familyStockOverviewSql (the Dashboard / alert pages), called for
//     real, including which member of a family stands for it (the representative row);
//   - the bell's inventory SELECT (routes/notifications.ts), the Inventory / Products / Branches stock-state filters
//     (routes/inventory.ts, products.ts, branches.ts), the Inventory Check filters and family flags
//     (lib/inventoryCheckProducts.ts), the Telegram stock counts and filter (lib/telegram.ts) and the issue-state out
//     clause (lib/searchMatch.ts).
// Each copy's answer is compared with refState, and the client with the same. The family rule (stockGroupLevel) is
// compared with the Dashboard's has_healthy / has_low flags and the alert pages on multi-member fixtures, header rows
// included, and isStockFamilyHeader with the server's header expression.
// NOT run, only pinned by exact normalised text and occurrence count: the bell's JavaScript mapping (is_out -> label, the
// low count) and the Telegram row label. A census then reads EVERY comparison against a threshold in cloudflare/src
// (low_stock_threshold / out_of_stock_threshold, the low_threshold / __low / __out aliases, plain JS `<= low`) and fails
// when one is added, moved, edited or removed. Each known line names the check that runs it, and that check must have
// run. The public storefront (routes/portal.ts) has its OWN levels by owner decision of 16 Nov 2026: the Website Editor's
// thresholds when set, else the shop's rule. Its label and its three stock-state pills are run through the matrix below, with the
// website levels EMPTY (they must equal the shop rule) and with them SET (they must follow the website numbers); the AI assistant's
// copy (lib/portalAi.ts) and the hide-out-of-stock membership are listed as named exceptions, so a change to them is still noticed.
//
// Mutants are applied in memory to the REAL sources (frontend rule and every Worker file above) and must each turn the
// run red; a mutant that no longer matches its source fails the test (positive control). The Worker is only ever read.
// STOCK_PARITY_WORKER_ROOT points the run at a scratch copy of cloudflare/ (used to double-check the mutants on disk).
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import ts from 'typescript'

const frontendSource = readFileSync(new URL('../src/utils/lowStockSettings.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const WORKER_ROOT = process.env.STOCK_PARITY_WORKER_ROOT
  ? path.resolve(process.env.STOCK_PARITY_WORKER_ROOT)
  : fileURLToPath(new URL('../../cloudflare/', import.meta.url))
type Read = (rel: string) => string
const diskRead: Read = (rel) => readFileSync(path.join(WORKER_ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

function transpile(source: string, fileName: string): string {
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName }).outputText
}
function loadFrontend(source: string): any {
  const module = { exports: {} as any }
  new Function('exports', 'require', 'module', transpile(source, 'lowStockSettings.ts'))(module.exports, () => { throw new Error('unexpected require') }, module)
  return module.exports
}
function loadWorker(read: Read, rel: string, cache = new Map<string, { exports: any }>()): any {
  const hit = cache.get(rel)
  if (hit) return hit.exports
  const module = { exports: {} as any }
  cache.set(rel, module)
  const dir = path.posix.dirname(rel)
  new Function('exports', 'require', 'module', transpile(read(rel), rel))(module.exports, (request: string) => {
    if (request === './db') return { getDb: () => null }
    if (request.startsWith('.')) return loadWorker(read, `${path.posix.join(dir, request)}.ts`, cache)
    throw new Error(`unexpected require ${request} in ${rel}`)
  }, module)
  return module.exports
}

// One exported function lifted out of a Worker file's text and run (for a file whose imports we do not want to load).
function loadFunction(source: string, name: string): unknown {
  const module = { exports: {} as any }
  new Function('exports', 'module', transpile(source, `${name}.ts`))(module.exports, module)
  return module.exports[name]
}
const crossingQuantities = [-1, 0, 0.5, 2, 3, 5, 10, 11]

type Level = 'out' | 'low' | 'healthy'
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
const ids = rows.map((_, index) => index + 1)

// The reference rule, typed once, independent of both the client and the Worker.
function refLow(row: Row, config: Cfg): number {
  if (!config.enabled) return -1
  if (config.mode === 'global') return config.threshold
  return row.low ?? config.threshold
}
function refState(row: Row, config: Cfg): Level {
  const qty = row.qty ?? 0
  if (qty <= (row.out ?? 0)) return 'out'
  return qty <= refLow(row, config) ? 'low' : 'healthy'
}

// ---- Fixtures ----
type Spec = { id: number; key: string; qty: number | null; low: number | null; out: number | null; group?: number | null; parent?: number | null }
function makeDb(products: Spec[]): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, name_key TEXT, category TEXT, unit TEXT, is_active INTEGER NOT NULL DEFAULT 1,
      is_group INTEGER, parent_id INTEGER, stock_quantity REAL, low_stock_threshold REAL, out_of_stock_threshold REAL, cost_price_usd REAL, cost_price_khr REAL);
    CREATE TABLE branch_stock (product_id INTEGER, quantity REAL);
    CREATE TABLE product_batches (id INTEGER, variant_product_id INTEGER);
    CREATE TABLE branch_batch_stock (batch_id INTEGER, quantity REAL);
    CREATE TABLE damaged_stock_lots (product_id INTEGER, quantity_remaining REAL);
    CREATE INDEX idx_products_parent_pg ON products (parent_id, is_group);`)
  const insert = db.prepare('INSERT INTO products (id, name, name_key, is_active, is_group, parent_id, stock_quantity, low_stock_threshold, out_of_stock_threshold) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)')
  for (const p of products) insert.run(p.id, p.key, p.key, p.group ?? 0, p.parent ?? 0, p.qty, p.low, p.out)
  return db
}
// A D1-shaped handle over node:sqlite: only the named parameters the statement really uses are bound.
function d1(db: DatabaseSync): any {
  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql)
      const names = new Set([...sql.matchAll(/@(\w+)/g)].map((match) => match[1]))
      const pick = (params: Record<string, unknown> = {}): any => Object.fromEntries(Object.entries(params).filter(([key]) => names.has(key)))
      return { get: async (params?: Record<string, unknown>) => stmt.get(pick(params)), all: async (params?: Record<string, unknown>) => stmt.all(pick(params)) }
    },
  }
}
const matrixDb = makeDb(rows.map((row, index) => ({ id: index + 1, key: `n${index + 1}`, qty: row.qty, low: row.low, out: row.out })))
// The same rows with one branch_stock row each (none for a NULL quantity): what the Products / Inventory `stockExpr` sums and joins.
const catalogDb = makeDb(rows.map((row, index) => ({ id: index + 1, key: `n${index + 1}`, qty: row.qty, low: row.low, out: row.out })))
rows.forEach((row, index) => { if (row.qty != null) catalogDb.prepare('INSERT INTO branch_stock (product_id, quantity) VALUES (?, ?)').run(index + 1, row.qty) })

// Families: 1-4 members sharing one name key, some with a header row (group parent holding no stock) and header-only families.
const familyQty = [null, -1, 0, 2, 5, 10, 11, 50]
const familyLow = [null, 3, 10]
const familyOut = [null, 0, 2]
let seed = 20261115
const next = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >> 8) % n }
const familySpecs: Spec[] = []
let nextId = 1000
for (let f = 0; f < 320; f += 1) {
  const key = `fam${f}`
  const size = 1 + next(4)
  const headerOnly = f % 17 === 0
  const withHeader = headerOnly || f % 4 === 0
  let headerId = 0
  if (withHeader) { headerId = nextId++; familySpecs.push({ id: headerId, key, qty: [0, 500][next(2)], low: familyLow[next(3)], out: familyOut[next(3)], group: 1, parent: 0 }) }
  if (!headerOnly) {
    for (let m = 0; m < size; m += 1) {
      familySpecs.push({ id: nextId++, key, qty: familyQty[next(8)], low: familyLow[next(3)], out: familyOut[next(3)], group: 0, parent: headerId })
    }
  }
}
// The review's example: products 101 (8) and 102 (50), same name and barcode, threshold 10.
familySpecs.push({ id: 101, key: 'dup', qty: 8, low: 10, out: 0 }, { id: 102, key: 'dup', qty: 50, low: 10, out: 0 })
// Which member stands for a family on the alert pages: an out member below a low member must not be chosen for a LOW family,
// and when every member is out the one with the smallest quantity wins even if another is further under its own threshold.
familySpecs.push(
  { id: 5001, key: 'replow', qty: 0, low: 10, out: 0 }, { id: 5002, key: 'replow', qty: 10, low: 10, out: 0 },
  { id: 5003, key: 'repout', qty: 1, low: 10, out: 1 }, { id: 5004, key: 'repout', qty: 5, low: 10, out: 10 },
)
const familyDb = makeDb(familySpecs)

// ---- SQL extraction from the Worker's own source text ----
const norm = (text: string) => text.replace(/\s+/g, ' ').trim()
function occurrences(haystack: string, needle: string): number {
  const h = norm(haystack)
  const n = norm(needle)
  let count = 0
  for (let at = h.indexOf(n); at >= 0; at = h.indexOf(n, at + 1)) count += 1
  return count
}
function extract(source: string, pattern: RegExp, what: string): string {
  const match = pattern.exec(source)
  assert.ok(match, `could not find ${what} in the Worker source (its shape changed: update the extraction, do not delete the check)`)
  return match[1]
}
function substitute(sql: string, values: Record<string, string>, what: string): string {
  let out = sql
  for (const [token, value] of Object.entries(values)) out = out.split(token).join(value)
  assert.ok(!out.includes('${'), `${what}: unresolved placeholder left in ${norm(out).slice(0, 200)}`)
  return out
}
const STOCK_EXPR = 'COALESCE(p.stock_quantity, 0)'
const LOW_CALL = "${lowStockThresholdSql(lowStock, 'p.low_stock_threshold')}"
function pushClause(source: string, state: string, what: string): string {
  return extract(source, new RegExp(`if \\(stockState === '${state}'(?: \\|\\| stockState === '[a-z_]+')*\\) where\\.push\\(['\`](.*)['\`]\\)\\s*$`, 'm'), `${what} '${state}' filter`)
}
function ofIds(db: DatabaseSync, where: string): number[] {
  return (db.prepare(`SELECT id FROM products p WHERE (${where}) ORDER BY id`).all() as Array<{ id: number }>).map((r) => r.id)
}
// The route filters, with the two branch_stock aliases they use (selected_bs on Products / Inventory, bs on Branches); one row each.
function ofIdsCatalog(where: string): number[] {
  return (catalogDb.prepare(`SELECT p.id FROM products p LEFT JOIN branch_stock selected_bs ON selected_bs.product_id = p.id
    LEFT JOIN branch_stock bs ON bs.product_id = p.id WHERE (${where}) ORDER BY p.id`).all() as Array<{ id: number }>).map((r) => r.id)
}

// Every comparison against a stock threshold in cloudflare/src, as [file, occurrences, the check that runs it, exact normalised line].
// A new one, or a moved, edited or removed one, means a copy of the rule changed: look at it, run it through the matrix above
// (or pin it), then update this table -- do not just bump a number. 'by' must be the start of a check label that really ran.
// 'storefront' is not a check here: those lines are run by the Worker's own tests (the AI assistant's copy by
// scripts/test-portal-ai-stock-status-pure.cjs; the hide-out-of-stock membership is the per-product out threshold, as before).
// Named so that any edit to them is noticed.
const STOREFRONT = 'storefront'
const STOREFRONT_REASON = 'storefront line run by the Worker tests, not here'
// The public storefront's label and filter pills ARE run here (see 'storefront label and filter pills').
const STOREFRONT_RUN = 'storefront label and filter pills'
// 'notThreshold' is not a check either: the line only looks like a threshold comparison. Named so that any edit to it is noticed.
const NOT_A_THRESHOLD = 'notThreshold'
const NOT_A_THRESHOLD_REASON = 'binary search bound, not a stock threshold'
const KNOWN_COMPARISONS: Array<[file: string, count: number, by: string, text: string]> = [
  ["lib/familyStockStats.ts", 1, "familyStockOverviewSql", "${both('MAX', `CASE WHEN ${qty} > COALESCE(p.out_of_stock_threshold, 0) AND ${qty} <= ${lowThresholdSql} THEN 1 ELSE 0 END`, 'has_low')},"],
  ["lib/familyStockStats.ts", 1, "familyStockOverviewSql", "${both('MAX', `CASE WHEN ${qty} > COALESCE(p.out_of_stock_threshold, 0) AND ${qty} > ${lowThresholdSql} THEN 1 ELSE 0 END`, 'has_healthy')},"],
  ["lib/familyStockStats.ts", 1, "Dashboard family flags", "MAX(CASE WHEN qty > out_threshold AND qty <= low_threshold THEN 1 ELSE 0 END) AS has_low,"],
  ["lib/familyStockStats.ts", 1, "Dashboard family flags", "MAX(CASE WHEN qty > out_threshold AND qty <= low_threshold THEN 1 ELSE 0 END) AS has_low"],
  ["lib/familyStockStats.ts", 2, "Dashboard family flags", "MAX(CASE WHEN qty > out_threshold AND qty > low_threshold THEN 1 ELSE 0 END) AS has_healthy,"],
  ["lib/familyStockStats.ts", 1, "family representatives (alert page)", "WHEN @__alertState = 'low' AND m.qty > m.out_threshold AND m.qty <= m.low_threshold THEN 0"],
  ["lib/familyStockStats.ts", 1, "family representatives (alert page)", "WHEN @__alertState = 'out' AND m.qty <= m.out_threshold THEN 0"],
  ["lib/familyStockStats.ts", 1, "family representatives (overview)", "WHEN v.alert_state = 'low' AND m.qty > m.out_threshold AND m.qty <= m.low_threshold THEN 0"],
  ["lib/familyStockStats.ts", 1, "family representatives (overview)", "WHEN v.alert_state = 'out' AND m.qty <= m.out_threshold THEN 0"],
  ["lib/inventoryCheckProducts.ts", 1, "inventory check family flags", "MAX(CASE WHEN c.__quantity>c.__out AND c.__quantity<=c.__low THEN 1 ELSE 0 END) AS low,"],
  ["lib/inventoryCheckProducts.ts", 1, "inventory check family flags", "MAX(CASE WHEN c.__quantity>c.__out AND c.__quantity>c.__low THEN 1 ELSE 0 END) AS healthy,"],
  ["lib/inventoryCheckProducts.ts", 1, "inventory check filters", "if (query.stockState === 'in_stock') stockConditions.push('p.__quantity>p.__out')"],
  ["lib/inventoryCheckProducts.ts", 1, "inventory check filters", "if (query.stockState === 'low_stock') stockConditions.push('p.__quantity>p.__out AND p.__quantity<=p.__low')"],
  ["lib/inventoryCheckProducts.ts", 1, "inventory check filters", "if (query.stockState === 'out_of_stock') stockConditions.push('p.__quantity<=p.__out')"],
  ["lib/lowStockSettings.ts", 1, "worker isLowStock", "if (qty <= (Number.isFinite(out) ? out : 0)) return false"],
  ["lib/lowStockSettings.ts", 1, "worker isLowStock", "return qty <= effectiveLowStockThreshold(config, productLowThreshold)"],
  ["lib/portalAi.ts", 1, STOREFRONT, "if (quantity <= lowThreshold) return 'low_stock'"],
  ["lib/portalAi.ts", 1, STOREFRONT, "if (quantity <= outThreshold) return 'out_of_stock'"],
  ["lib/salesAnalytics.ts", 1, NOT_A_THRESHOLD, "while (low < high) {"], // NOT_A_THRESHOLD_REASON
  ["lib/searchMatch.ts", 1, "searchMatch issue 'out_of_stock'", "return `${stockExpr} <= COALESCE(p.out_of_stock_threshold, 0)`"],
  ["lib/stockCrossingAlert.ts", 1, "classifyCrossing", "if (before > low && after <= low && after > out) return 'low'"],
  ["lib/stockCrossingAlert.ts", 1, "classifyCrossing", "if (before > out && after <= out) return 'out'"],
  ["lib/telegram.ts", 1, "telegram counts", "COALESCE(SUM(CASE WHEN COALESCE(stock_quantity, 0) <= COALESCE(out_of_stock_threshold, 0) THEN 1 ELSE 0 END), 0) AS out_of_stock,"],
  ["lib/telegram.ts", 1, "telegram counts", "COALESCE(SUM(CASE WHEN COALESCE(stock_quantity, 0) > COALESCE(out_of_stock_threshold, 0) AND COALESCE(stock_quantity, 0) <= ${lowThresholdSql} THEN 1 ELSE 0 END), 0) AS low_stock"],
  ["lib/telegram.ts", 1, "telegram lowOrOutOfStockSql", "`(COALESCE(stock_quantity, 0) <= ${lowThresholdSql} OR COALESCE(stock_quantity, 0) <= COALESCE(out_of_stock_threshold, 0))`"],
  ["lib/telegram.ts", 1, "pin telegram lowStockRowLines out test", "const out = Number(row.stock_quantity || 0) <= Number(row.out_of_stock_threshold || 0)"],
  ["routes/branches.ts", 1, "branches.ts", "if (stockState === 'healthy') where.push(`COALESCE(bs.quantity, 0) > COALESCE(p.out_of_stock_threshold, 0) AND COALESCE(bs.quantity, 0) > ${lowStockThresholdSql(lowStock, 'p.low_stock_threshold')}`)"],
  ["routes/branches.ts", 1, "branches.ts", "if (stockState === 'low') where.push(`COALESCE(bs.quantity, 0) > COALESCE(p.out_of_stock_threshold, 0) AND COALESCE(bs.quantity, 0) <= ${lowStockThresholdSql(lowStock, 'p.low_stock_threshold')}`)"],
  ["routes/branches.ts", 1, "branches.ts", "if (stockState === 'out' || stockState === 'out_of_stock') where.push('COALESCE(bs.quantity, 0) <= COALESCE(p.out_of_stock_threshold, 0)')"],
  ["routes/branches.ts", 1, "branches.ts", "if (stockState === 'positive' || stockState === 'in_stock') where.push('COALESCE(bs.quantity, 0) > COALESCE(p.out_of_stock_threshold, 0)')"],
  ["routes/inventory.ts", 1, "inventory.ts", "if (stockState === 'in_stock' || stockState === 'positive') where.push(`${stockExpr} > COALESCE(p.out_of_stock_threshold, 0)`)"],
  ["routes/inventory.ts", 1, "inventory.ts", "if (stockState === 'low') where.push(`${stockExpr} > COALESCE(p.out_of_stock_threshold, 0) AND ${stockExpr} <= ${lowStockThresholdSql(lowStock, 'p.low_stock_threshold')}`)"],
  ["routes/inventory.ts", 1, "inventory.ts", "if (stockState === 'out') where.push(`${stockExpr} <= COALESCE(p.out_of_stock_threshold, 0)`)"],
  ["routes/notifications.ts", 1, "bell inventory SELECT", "AND (COALESCE(stock_quantity, 0) <= ${lowThresholdSql}"],
  ["routes/notifications.ts", 1, "bell inventory SELECT", "CASE WHEN COALESCE(stock_quantity, 0) <= COALESCE(out_of_stock_threshold, 0) THEN 1 ELSE 0 END AS is_out,"],
  ["routes/notifications.ts", 1, "bell inventory SELECT", "OR COALESCE(stock_quantity, 0) <= COALESCE(out_of_stock_threshold, 0))"],
  ["routes/notifications.ts", 1, "bell inventory SELECT", "SUM(CASE WHEN COALESCE(stock_quantity, 0) <= COALESCE(out_of_stock_threshold, 0) THEN 1 ELSE 0 END) OVER () AS out_total,"],
  ["routes/portal.ts", 1, STOREFRONT, ": `p.is_active = 1 AND COALESCE(p.stock_quantity, 0) > ${portalStockLevelSql(rule).out}`"],
  ["routes/portal.ts", 1, STOREFRONT_RUN, "if (quantity <= low) return 'low_stock'"],
  ["routes/portal.ts", 1, STOREFRONT_RUN, "if (quantity <= out) return 'out_of_stock'"],
  ["routes/portal.ts", 1, STOREFRONT_RUN, "if (state === 'in_stock') return `${stockExpr} > ${level.out} AND ${stockExpr} > ${level.low}`"],
  ["routes/portal.ts", 1, STOREFRONT_RUN, "if (state === 'low_stock') return `${stockExpr} > ${level.out} AND ${stockExpr} <= ${level.low}`"],
  ["routes/portal.ts", 1, STOREFRONT_RUN, "if (state === 'out_of_stock') return `${stockExpr} <= ${level.out}`"],
  ["routes/portal.ts", 1, STOREFRONT, "where.push(`${stockExpr} > ${level.out}`)"],
  ["routes/products.ts", 1, "products.ts", "if (stockState === 'healthy') where.push(`${stockExpr} > COALESCE(p.out_of_stock_threshold, 0) AND ${stockExpr} > ${lowStockThresholdSql(lowStock, 'p.low_stock_threshold')}`)"],
  ["routes/products.ts", 1, "products.ts", "if (stockState === 'in_stock' || stockState === 'positive') where.push(`${stockExpr} > COALESCE(p.out_of_stock_threshold, 0)`)"],
  ["routes/products.ts", 1, "products.ts", "if (stockState === 'low') where.push(`${stockExpr} > COALESCE(p.out_of_stock_threshold, 0) AND ${stockExpr} <= ${lowStockThresholdSql(lowStock, 'p.low_stock_threshold')}`)"],
  ["routes/products.ts", 1, "products.ts", "if (stockState === 'out') where.push(`${stockExpr} <= COALESCE(p.out_of_stock_threshold, 0)`)"],
]
// A comparison operator next to a threshold, on either side: the columns and aliases, '${low...}' fragments, plain JS
// 'low' / 'out' variables, effectiveLowStockThreshold(...) and the isFinite-guarded out threshold.
const THRESHOLD_TOKEN = String.raw`(?:COALESCE\(|Number\(|toNumber\()?(?:[\w.]*(?:low_stock_threshold|out_of_stock_threshold|low_threshold|out_threshold|__low|__out)\b|\$\{\s*low\w*\s*\}|\$\{\s*lowStockThresholdSql|\$\{\s*level\.(?:low|out)\s*\}|\$\{\s*portalStockLevelSql\([^)]*\)\.out\s*\}|effectiveLowStockThreshold\(|\(Number\.isFinite\(out\)|\blow\b|\bout\b|\blowThreshold\b|\boutThreshold\b)`
const COMPARE_OPERATOR = String.raw`(?<![=\-<>])(?:<=|>=|<|>)(?![=>])`
const COMPARISON = new RegExp(`${COMPARE_OPERATOR}\\s*${THRESHOLD_TOKEN}|${THRESHOLD_TOKEN}\\s*${COMPARE_OPERATOR}`)
function listTs(dir: string, base = ''): string[] {
  return readdirSync(path.join(dir, base), { withFileTypes: true }).flatMap((entry) => {
    const rel = base ? `${base}/${entry.name}` : entry.name
    return entry.isDirectory() ? listTs(dir, rel) : rel.endsWith('.ts') ? [rel] : []
  })
}

// ---- The whole parity run, over a Worker source reader and a client module ----
async function failuresOf(read: Read, fe: any, firstOnly = false): Promise<string[]> {
  const failures: string[] = []
  // The checks that actually ran (label up to its config tag): the census below requires each known copy's runner to be here.
  const ran = new Set<string>()
  const check = async (label: string, fn: () => unknown) => {
    if (firstOnly && failures.length) return
    ran.add(label.replace(/ cfg\d+.*$/, ''))
    try { await fn() } catch (error: any) { failures.push(`${label}: ${String(error?.message || error).split('\n')[0].slice(0, 170)}`) }
  }
  const lowSettings = loadWorker(read, 'src/lib/lowStockSettings.ts')
  const family = loadWorker(read, 'src/lib/familyStockStats.ts')
  const guard = loadWorker(read, 'src/lib/productStockGuard.ts')
  const read2 = (rel: string) => read(`src/${rel}`)
  const bellSource = read2('routes/notifications.ts')
  const sameSet = (got: number[], want: number[], label = 'ids') => assert.deepEqual([...got].sort((a, b) => a - b), want, label)

  for (const [c, config] of configs.entries()) {
    const tag = `cfg${c} ${config.enabled ? 'on' : 'off'}/${config.mode}/${config.threshold}`
    const refs = rows.map((row) => refState(row, config))
    const want = (level: Level) => ids.filter((_, index) => refs[index] === level)
    const lowSql: string = lowSettings.lowStockThresholdSql(config, 'p.low_stock_threshold')

    // The client rule (and the three-tier helper that delegates to it).
    await check(`client stockLevelState ${tag}`, () => rows.forEach((row, index) => {
      const got = fe.stockLevelState(row.qty, { low_stock_threshold: row.low, out_of_stock_threshold: row.out }, config)
      assert.equal(got, refs[index], `row ${JSON.stringify(row)}`)
      const tier = fe.resolveStockTier(config, row.qty, row.low, row.out)
      assert.equal(tier, refs[index] === 'out' ? 'out_of_stock' : refs[index] === 'low' ? 'low_stock' : 'in_stock', `resolveStockTier ${JSON.stringify(row)}`)
    }))
    // The threshold fragment itself.
    await check(`lowStockThresholdSql ${tag}`, () => {
      const got = (matrixDb.prepare(`SELECT ${lowSql} AS t FROM products p ORDER BY id`).all() as Array<{ t: number }>).map((r) => r.t)
      assert.deepEqual(got, rows.map((row) => refLow(row, config)))
    })

    // Dashboard / Inventory / Branches stat tiles: getFamilyStockStats on each reference subset must classify the whole subset alike.
    for (const level of ['out', 'low', 'healthy'] as const) {
      const subset = want(level)
      if (!subset.length) continue
      await check(`getFamilyStockStats ${level} ${tag}`, async () => {
        const stats = await family.getFamilyStockStats({ db: d1(matrixDb), joinSql: '', whereSql: 'WHERE p.id IN (SELECT value FROM json_each(@ids))', params: { ids: JSON.stringify(subset) }, qtyExpr: STOCK_EXPR, lowStock: config })
        assert.deepEqual([stats.total_products, stats.out_of_stock, stats.low_stock, stats.healthy], [subset.length, level === 'out' ? subset.length : 0, level === 'low' ? subset.length : 0, level === 'healthy' ? subset.length : 0])
      })
    }
    // The low / out alert pages.
    for (const level of ['low', 'out'] as const) {
      await check(`getFamilyStockAlertPage ${level} ${tag}`, async () => {
        const page = await family.getFamilyStockAlertPage({ db: d1(matrixDb), lowStock: config, state: level, page: 1, pageSize: 5000 })
        sameSet(page.items.map((item: { id: number }) => item.id), want(level))
        assert.equal(page.total, want(level).length)
      })
    }
    // The Dashboard overview statement.
    await check(`familyStockOverviewSql ${tag}`, async () => {
      const result = await d1(matrixDb).prepare(family.familyStockOverviewSql(lowSql)).all({ previewSize: 5000 }) as Array<Record<string, any>>
      for (const level of ['low', 'out'] as const) sameSet(result.filter((r) => r.row_kind === 'alert' && r.alert_state === level).map((r) => r.id), want(level), `${level} alert rows`)
      const stats = result.find((r) => r.row_kind === 'stats') as Record<string, number>
      assert.deepEqual([stats.total_products, stats.out_of_stock, stats.low_stock, stats.healthy], [rows.length, want('out').length, want('low').length, want('healthy').length])
    })

    // The bell: the literal SELECT out of buildInventorySection.
    await check(`bell inventory SELECT ${tag}`, async () => {
      // The threshold column is the one the bell itself passes, read from its source.
      const bellLow: string = lowSettings.lowStockThresholdSql(config, extract(bellSource, /const lowThresholdSql = lowStockThresholdSql\(config, '([\w.]+)'\)/, 'the bell threshold column'))
      const sql = substitute(extract(bellSource, /async function buildInventorySection[\s\S]*?db\.prepare\(`([\s\S]*?)`\)\.all</, 'the bell inventory SELECT'),
        { '${lowThresholdSql}': bellLow, '${stockVisibleProductSql()}': guard.stockVisibleProductSql() }, 'bell')
      const listed = new Map((matrixDb.prepare(sql).all({ itemLimit: 100000 }) as Array<Record<string, number>>).map((r) => [r.id, r]))
      const got = ids.map((id) => { const hit = listed.get(id); return !hit ? 'healthy' : hit.is_out === 1 ? 'out' : 'low' })
      assert.deepEqual(got, refs)
      const first = [...listed.values()][0]
      if (first) {
        assert.equal(first.out_total, want('out').length, 'out_total')
        assert.equal(first.flagged_total, want('out').length + want('low').length, 'flagged_total')
      }
    })

    // Stock-state filters, run as written.
    const filters: Array<[string, string, Array<[string, number[]]>]> = [
      ['inventory.ts', 'routes/inventory.ts', [['low', want('low')], ['out', want('out')], ['in_stock', [...want('low'), ...want('healthy')]]]],
      ['products.ts', 'routes/products.ts', [['low', want('low')], ['out', want('out')], ['in_stock', [...want('low'), ...want('healthy')]], ['healthy', want('healthy')]]],
      ['branches.ts', 'routes/branches.ts', [['low', want('low')], ['out', want('out')], ['positive', [...want('low'), ...want('healthy')]], ['healthy', want('healthy')]]],
    ]
    for (const [label, rel, states] of filters) {
      const source = read2(rel)
      // The stock figure the filter compares is the route's own `stockExpr` (selected branch / whole-catalog sum), read from its
      // source and run in both forms; branches.ts writes COALESCE(bs.quantity, 0) inline, so it runs as written.
      const exprs: Array<[string, string]> = /const stockExpr = /.test(source)
        ? (() => {
            const found = /const stockExpr = params\.branchId \? '([^']*)'\s*:\s*'([^']*)'/.exec(source)
            assert.ok(found, `${label}: could not find stockExpr (its shape changed: update the extraction, do not delete the check)`)
            return [['branch', found[1]], ['catalog', found[2]]] as Array<[string, string]>
          })()
        : [['inline', '']]
      for (const [variant, expr] of exprs) {
        for (const [state, expected] of states) {
          await check(`${label} '${state}' filter [${variant}] ${tag}`, () => {
            const clause = substitute(pushClause(source, state, label), { '${stockExpr}': expr, [LOW_CALL]: lowSql }, label)
            sameSet(ofIdsCatalog(clause), [...expected].sort((a, b) => a - b), `${label} ${state} ${variant}`)
          })
        }
      }
    }
    // Telegram: the two stock counts and the low-or-out list filter.
    const telegram = read2('lib/telegram.ts')
    // The threshold column is the one each Telegram function itself passes to lowStockThresholdSql, read from its source.
    const telegramLow = (fn: string): string => lowSettings.lowStockThresholdSql(config, extract(telegram, new RegExp(`function ${fn}\\([^]*?lowStockThresholdSql\\(await loadLowStockConfig\\(env\\), '([\\w.]+)'\\)`), `the ${fn} threshold column`))
    await check(`telegram counts ${tag}`, () => {
      const countLow = telegramLow('inventorySummaryReport')
      const out = substitute(extract(telegram, /SUM\(CASE WHEN (.+?) THEN 1 ELSE 0 END\), 0\) AS out_of_stock/, 'the telegram out count'), { '${lowThresholdSql}': countLow }, 'telegram out')
      const low = substitute(extract(telegram, /SUM\(CASE WHEN (.+?) THEN 1 ELSE 0 END\), 0\) AS low_stock/, 'the telegram low count'), { '${lowThresholdSql}': countLow }, 'telegram low')
      sameSet(ofIds(matrixDb, out), want('out'), 'telegram out')
      sameSet(ofIds(matrixDb, low), want('low'), 'telegram low')
    })
    // lowOrOutOfStockSql serves two callers (/stock and the day's movers), each with its own threshold column.
    for (const caller of ['inventoryReport', 'lowStockMovedOnDay']) {
      await check(`telegram lowOrOutOfStockSql [${caller}] ${tag}`, () => {
        const clause = substitute(extract(telegram, /const lowOrOutOfStockSql = \(lowThresholdSql: string\): string =>\s*`([^`]*)`/, 'lowOrOutOfStockSql'), { '${lowThresholdSql}': telegramLow(caller) }, 'telegram list')
        sameSet(ofIds(matrixDb, clause), [...want('out'), ...want('low')].sort((a, b) => a - b), 'telegram list')
      })
    }
    await check(`searchMatch issue 'out_of_stock' ${tag}`, () => {
      const clause = substitute(extract(read2('lib/searchMatch.ts'), /case 'out_of_stock':\s*return `([^`]*)`/, "the 'out_of_stock' issue clause"), { '${stockExpr}': STOCK_EXPR }, 'searchMatch')
      sameSet(ofIds(matrixDb, clause), want('out'), 'searchMatch out')
    })

    // The public storefront (routes/portal.ts), owner decision of 16 Nov 2026: its OWN levels. Its label function and its three
    // stock-state pills are lifted out of the source and run as written, twice: with the website levels EMPTY the storefront IS the
    // shop rule (refs), and with the website levels SET (low 3, out 1) it follows those two numbers whatever the shop says.
    const portalSource = read2('routes/portal.ts')
    type PortalLabel = (rule: unknown, qty: number, low: unknown, out: unknown) => string
    await check(`${STOREFRONT_RUN} (website levels empty or set) ${tag}`, () => {
      const labelFn = extract(portalSource, /(export function portalStockStatusFor[\s\S]*?\n\})\n/, 'portalStockStatusFor')
      const exportsBox: { portalStockStatusFor?: PortalLabel } = {}
      new Function('exports', 'effectiveLowStockThreshold', transpile(labelFn, 'portalStockStatusFor.ts'))(exportsBox, lowSettings.effectiveLowStockThreshold)
      const label = exportsBox.portalStockStatusFor as PortalLabel
      // The SQL levels the pills compare against, from the storefront's own portalStockLevelSql (run as written).
      const levelsBox: { portalStockLevelSql?: (rule: unknown) => { out: string; low: string } } = {}
      new Function('lowStockThresholdSql', 'box', `${transpile(extract(portalSource, /(function portalStockLevelSql[\s\S]*?\n\})\n/, 'portalStockLevelSql'), 'portalStockLevelSql.ts')}\nbox.portalStockLevelSql = portalStockLevelSql`)(lowSettings.lowStockThresholdSql, levelsBox)
      const levelsFor = levelsBox.portalStockLevelSql as (rule: unknown) => { out: string; low: string }
      const pill = (state: string, rule: unknown): number[] => {
        const text = extract(portalSource, new RegExp(`if \\(state === '${state}'\\) return \`([^\`]*)\``), `the storefront '${state}' pill`)
        const level = levelsFor(rule)
        return ofIds(matrixDb, substitute(text, { '${stockExpr}': STOCK_EXPR, '${level.out}': level.out, '${level.low}': level.low }, 'storefront pill'))
      }
      const asState: Record<Level, string> = { out: 'out_of_stock', low: 'low_stock', healthy: 'in_stock' }
      // Website levels empty: the shop's rule, exactly.
      const emptyRule = { shop: config, low: null, out: null }
      rows.forEach((row, index) => assert.equal(label(emptyRule, row.qty ?? 0, row.low, row.out), asState[refs[index]], `label ${JSON.stringify(row)}`))
      sameSet(pill('out_of_stock', emptyRule), want('out'), 'storefront out pill')
      sameSet(pill('low_stock', emptyRule), want('low'), 'storefront low pill')
      sameSet(pill('in_stock', emptyRule), want('healthy'), 'storefront in_stock pill')
      // Website levels set: low 3, out 1, whatever the shop and the product say.
      const setRule = { shop: config, low: 3, out: 1 }
      const websiteState = (row: Row): Level => ((row.qty ?? 0) <= 1 ? 'out' : (row.qty ?? 0) <= 3 ? 'low' : 'healthy')
      rows.forEach((row) => assert.equal(label(setRule, row.qty ?? 0, row.low, row.out), asState[websiteState(row)], `website label ${JSON.stringify(row)}`))
      const wantWebsite = (level: Level) => ids.filter((_, index) => websiteState(rows[index]) === level)
      sameSet(pill('out_of_stock', setRule), wantWebsite('out'), 'storefront website out pill')
      sameSet(pill('low_stock', setRule), wantWebsite('low'), 'storefront website low pill')
      sameSet(pill('in_stock', setRule), wantWebsite('healthy'), 'storefront website in_stock pill')
    })

    // Inventory Check (lib/inventoryCheckProducts.ts): the three stock filters and the family flags, read from its source. __out and
    // __low are the columns the same file defines (its own threshold column is read too); __quantity is the figure, a NULL read as 0.
    const checkSource = read2('lib/inventoryCheckProducts.ts')
    const checkColumns = (): string => {
      const outExpr = extract(checkSource, /(COALESCE\(p\.out_of_stock_threshold,0\)) AS __out/, 'the Inventory Check __out column')
      const lowColumn = extract(checkSource, /\$\{lowStockThresholdSql\(lowStock, '([\w.]+)'\)\} AS __low/, 'the Inventory Check __low column')
      return `(SELECT p.id, COALESCE(p.stock_quantity, 0) AS __quantity, ${outExpr} AS __out, ${lowSettings.lowStockThresholdSql(config, lowColumn)} AS __low FROM products p)`
    }
    for (const [state, level] of [['in_stock', 'in'], ['low_stock', 'low'], ['out_of_stock', 'out']] as const) {
      await check(`inventory check filters '${state}' ${tag}`, () => {
        const condition = extract(checkSource, new RegExp(`query\\.stockState === '${state}'\\) stockConditions\\.push\\('([^']*)'\\)`), `the Inventory Check '${state}' filter`)
        const got = (matrixDb.prepare(`SELECT p.id FROM ${checkColumns()} p WHERE ${condition} ORDER BY p.id`).all() as Array<{ id: number }>).map((r) => r.id)
        sameSet(got, level === 'in' ? [...want('low'), ...want('healthy')].sort((a, b) => a - b) : want(level), `inventory check ${state}`)
      })
    }
    await check(`inventory check family flags ${tag}`, () => {
      const healthy = extract(checkSource, /MAX\(CASE WHEN (.+?) THEN 1 ELSE 0 END\) AS healthy,/, 'the Inventory Check healthy flag')
      const low = extract(checkSource, /MAX\(CASE WHEN (.+?) THEN 1 ELSE 0 END\) AS low,/, 'the Inventory Check low flag')
      const flags = matrixDb.prepare(`SELECT c.id, CASE WHEN ${healthy} THEN 1 ELSE 0 END AS healthy, CASE WHEN ${low} THEN 1 ELSE 0 END AS low FROM ${checkColumns()} c ORDER BY c.id`).all() as Array<{ id: number; healthy: number; low: number }>
      assert.deepEqual(flags.map((flag) => (flag.healthy === 1 ? 'healthy' : flag.low === 1 ? 'low' : 'out')), refs)
    })

    // The Worker's own JS copies: isLowStock, and classifyCrossing (the Telegram "now low / out" alert) lifted out of its source file
    // (importing it would pull the Telegram module graph in).
    await check(`worker isLowStock ${tag}`, () => rows.forEach((row, index) => {
      assert.equal(lowSettings.isLowStock(config, row.qty, row.low, row.out), refs[index] === 'low', `row ${JSON.stringify(row)}`)
    }))
    await check(`classifyCrossing ${tag}`, () => {
      const crossing = extract(read2('lib/stockCrossingAlert.ts'), /(export function classifyCrossing[\s\S]*?\n\})/, 'classifyCrossing')
      const classify = loadFunction(crossing, 'classifyCrossing') as (before: number, after: number, low: number, out: number) => string | null
      for (const row of rows) {
        const low = refLow(row, config)
        const out = row.out ?? 0
        for (const before of crossingQuantities) for (const after of crossingQuantities) {
          const was = refState({ ...row, qty: before }, config)
          const now = refState({ ...row, qty: after }, config)
          const want = !(before > after) ? null : now === 'out' && was !== 'out' ? 'out' : now === 'low' && was === 'healthy' ? 'low' : null
          assert.equal(classify(before, after, low, out), want, `row ${JSON.stringify(row)} ${before} -> ${after}`)
        }
      }
    })
  }

  // Pinned text (not runnable in isolation): exact normalised text and occurrence count.
  await check('pin telegram lowStockRowLines out test', () => {
    assert.equal(occurrences(read2('lib/telegram.ts'), 'const out = Number(row.stock_quantity || 0) <= Number(row.out_of_stock_threshold || 0)'), 1)
  })
  // The bell's JS: which row is "out" (is_out), and the low count (flagged minus out). The SELECT feeding them is run above.
  await check('pin bell JS mapping and counts', () => {
    for (const line of ['const outCount = Number(rows[0].out_total || 0)', 'const lowCount = Math.max(0, Number(rows[0].flagged_total || 0) - outCount)', 'rows.map((product) => (Number(product.is_out) === 1']) {
      assert.equal(occurrences(bellSource, line), 1, line)
    }
  })

  // The family rule: stockGroupLevel against the Dashboard's has_healthy / has_low flags, the stats tile and the alert pages.
  const familyOf = new Map<number, string>(familySpecs.map((spec) => [spec.id, spec.key]))
  const membersOf = new Map<string, Spec[]>()
  for (const spec of familySpecs) membersOf.set(spec.key, [...(membersOf.get(spec.key) || []), spec])
  for (const [c, config] of configs.entries()) {
    const tag = `cfg${c} ${config.enabled ? 'on' : 'off'}/${config.mode}/${config.threshold}`
    const lowSql: string = lowSettings.lowStockThresholdSql(config, 'p.low_stock_threshold')
    const expected = new Map<string, Level>([...membersOf].map(([key, members]) => [key, fe.stockGroupLevel(
      members.map((m) => ({ qty: m.qty, product: { low_stock_threshold: m.low, out_of_stock_threshold: m.out, is_group: m.group, parent_id: m.parent } })), config)]))
    await check(`Dashboard family flags vs stockGroupLevel ${tag}`, () => {
      const full: string = family.familyStockOverviewSql(lowSql)
      const cut = full.indexOf('eligible AS (')
      assert.ok(cut > 0, 'the overview statement no longer has an eligible CTE (update the extraction)')
      const sql = `${full.slice(0, cut).replace(/,\s*$/, '')} SELECT family_root_id, has_healthy, has_low FROM family_agg`
      const flags = familyDb.prepare(sql).all() as Array<{ family_root_id: string; has_healthy: number; has_low: number }>
      assert.equal(flags.length, membersOf.size, 'one flag row per family')
      for (const flag of flags) {
        const level: Level = flag.has_healthy === 1 ? 'healthy' : flag.has_low === 1 ? 'low' : 'out'
        assert.equal(level, expected.get(flag.family_root_id), `family ${flag.family_root_id}`)
      }
    })
    await check(`family alert pages + stats tile vs stockGroupLevel ${tag}`, async () => {
      for (const level of ['low', 'out'] as const) {
        const page = await family.getFamilyStockAlertPage({ db: d1(familyDb), lowStock: config, state: level, page: 1, pageSize: 5000 })
        const got = page.items.map((item: { id: number }) => familyOf.get(item.id)).sort()
        const want = [...expected].filter(([, l]) => l === level).map(([key]) => key).sort()
        assert.deepEqual(got, want, `${level} alert families`)
      }
      const stats = await family.getFamilyStockStats({ db: d1(familyDb), joinSql: '', whereSql: 'WHERE p.is_active = 1', params: {}, qtyExpr: STOCK_EXPR, lowStock: config })
      const count = (level: Level) => [...expected.values()].filter((l) => l === level).length
      assert.deepEqual([stats.total_products, stats.out_of_stock, stats.low_stock, stats.healthy], [expected.size, count('out'), count('low'), count('healthy')])
    })
    // Which member stands for a family on an alert page: among the real (non-header) members that are themselves in the alert's
    // state, the one with the fewest units (then the lowest id); if none is, the fewest units overall.
    const representative = (key: string, level: Level): number => {
      const all = membersOf.get(key) as Spec[]
      const real = all.filter((m) => !((m.group ?? 0) === 1 && (m.parent ?? 0) === 0))
      const pool = real.length ? real : all
      const matching = pool.filter((m) => refState({ qty: m.qty, low: m.low, out: m.out }, config) === level)
      return [...(matching.length ? matching : pool)].sort((a, b) => (a.qty ?? 0) - (b.qty ?? 0) || a.id - b.id)[0].id
    }
    const wantReps = (level: Level) => [...expected].filter(([, l]) => l === level).map(([key]) => `${key}=${representative(key, level)}`).sort()
    await check(`family representatives (alert page) ${tag}`, async () => {
      for (const level of ['low', 'out'] as const) {
        const page = await family.getFamilyStockAlertPage({ db: d1(familyDb), lowStock: config, state: level, page: 1, pageSize: 5000 })
        assert.deepEqual(page.items.map((item: { id: number }) => `${familyOf.get(item.id)}=${item.id}`).sort(), wantReps(level), `${level} alert representatives`)
      }
    })
    await check(`family representatives (overview) ${tag}`, async () => {
      const result = await d1(familyDb).prepare(family.familyStockOverviewSql(lowSql)).all({ previewSize: 5000 }) as Array<Record<string, any>>
      for (const level of ['low', 'out'] as const) {
        const got = result.filter((r) => r.row_kind === 'alert' && r.alert_state === level).map((r) => `${familyOf.get(r.id)}=${r.id}`).sort()
        assert.deepEqual(got, wantReps(level), `${level} overview representatives`)
      }
    })
  }

  // The review's example, side by side: products 101 (8) and 102 (50), threshold 10.
  await check('merged 101 + 102: bell lists 101 only, Dashboard and the row are healthy', async () => {
    const config: Cfg = { enabled: true, mode: 'product', threshold: 10 }
    const lowSql: string = lowSettings.lowStockThresholdSql(config, 'low_stock_threshold')
    const bellSql = substitute(extract(bellSource, /async function buildInventorySection[\s\S]*?db\.prepare\(`([\s\S]*?)`\)\.all</, 'the bell inventory SELECT'),
      { '${lowThresholdSql}': lowSql, '${stockVisibleProductSql()}': guard.stockVisibleProductSql() }, 'bell')
    const pair = makeDb(familySpecs.filter((spec) => spec.key === 'dup'))
    const listed = pair.prepare(bellSql).all({ itemLimit: 50 }) as Array<{ id: number; is_out: number }>
    assert.deepEqual(listed.map((r) => [r.id, r.is_out]), [[101, 0]], 'the bell lists product 101 alone, as low')
    const flags = pair.prepare(`${family.familyStockOverviewSql(lowSettings.lowStockThresholdSql(config, 'p.low_stock_threshold')).split('eligible AS (')[0].replace(/,\s*$/, '')} SELECT has_healthy, has_low FROM family_agg`).all() as Array<Record<string, number>>
    assert.deepEqual(flags.map((flag) => ({ ...flag })), [{ has_healthy: 1, has_low: 1 }], 'the Dashboard flags the family healthy (and low)')
    const product = { low_stock_threshold: 10, out_of_stock_threshold: 0 }
    assert.equal(fe.stockGroupLevel([{ qty: 8, product }, { qty: 50, product }], config), 'healthy', 'the merged row')
    assert.equal(fe.stockLevelState(8, product, config), 'low', 'product 101 alone')
  })

  // The header-row check against the server's expression, over NULL / 0 / 1 / other values.
  await check('isStockFamilyHeader vs the server header expression', () => {
    const header = extract(read2('lib/familyStockStats.ts'), /const header = '([^']*)'/, 'the header expression')
    const probe = matrixDb.prepare(`SELECT ${header} AS h FROM (SELECT @is_group AS is_group, @parent_id AS parent_id) p`)
    for (const isGroup of [null, 0, 1, 2, -1, 0.5]) {
      for (const parentId of [null, 0, 1, -1, 0.5, 5]) {
        const server = (probe.get({ is_group: isGroup, parent_id: parentId }) as { h: number }).h === 1
        assert.equal(fe.isStockFamilyHeader({ is_group: isGroup, parent_id: parentId }), server, `is_group=${isGroup} parent_id=${parentId}`)
        assert.equal(fe.isStockFamilyHeader({ is_group: isGroup === null ? undefined : isGroup, parent_id: parentId === null ? undefined : parentId }), server, `undefined form is_group=${isGroup} parent_id=${parentId}`)
      }
    }
    assert.equal(fe.isStockFamilyHeader(null), false)
  })

  // Census: every comparison against a threshold in the Worker is accounted for, by exact text and count, and each runnable one
  // names a check that ran in this very pass.
  await check('census of threshold comparisons', () => {
    const found = new Map<string, number>()
    for (const rel of listTs(path.join(WORKER_ROOT, 'src'))) {
      for (const line of read2(rel).split('\n')) {
        if (/^\s*(\/\/|\*|\/\*)/.test(line) || !COMPARISON.test(line)) continue
        const key = `${rel}\u0000${norm(line)}`
        found.set(key, (found.get(key) || 0) + 1)
      }
    }
    const known = new Map(KNOWN_COMPARISONS.map(([file, count, , text]) => [`${file}\u0000${text}`, count] as const))
    const show = (map: Map<string, number>) => [...map].map(([key, count]) => `${key.replace('\u0000', ' :: ')} x${count}`).sort()
    assert.deepEqual(show(found), show(known), `a threshold comparison appeared, moved, changed or vanished: look at it, run it through the matrix (or pin it), then update KNOWN_COMPARISONS (the shop-front lines are "${STOREFRONT_REASON}"; the binary search bound is "${NOT_A_THRESHOLD_REASON}")`)
    for (const [file, , by, text] of KNOWN_COMPARISONS) {
      if (by === STOREFRONT || by === NOT_A_THRESHOLD) continue
      assert.ok([...ran].some((label) => label.startsWith(by)), `${file}: "${text.slice(0, 60)}" names the check "${by}", which did not run`)
    }
  })
  return failures
}

// ---- Baseline: the real sources agree ----
const realFrontend = loadFrontend(frontendSource)
const base = await failuresOf(diskRead, realFrontend)
assert.deepEqual(base, [], `the parity run is red on the unmodified sources:\n${base.join('\n')}`)
// Positive controls: the matrix must exercise all three outcomes in every config, or a green run proves nothing.
for (const config of configs) assert.ok(new Set(rows.map((row) => refState(row, config))).size >= 2, 'a config produced a single outcome')
assert.deepEqual([...new Set(configs.flatMap((config) => rows.map((row) => refState(row, config))))].sort(), ['healthy', 'low', 'out'])
assert.ok(rows.length >= 500 && configs.length === 12)

// ---- Client mutants (applied to the real client source) ----
const clientMutants: Array<{ name: string; from: string; to: string }> = [
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
  { name: 'header check treats parent_id -1 as a header (the old rule)', from: 'return group === 1 && parent === 0', to: 'return group === 1 && !(Number.isFinite(parent) && parent > 0)' },
  { name: 'header check ignores the parent', from: 'return group === 1 && parent === 0', to: 'return group === 1' },
  { name: 'family rule: worst member wins instead of best', from: "if (level === 'healthy') return 'healthy'\n    if (level === 'low') best = 'low'", to: "if (level === 'out') return 'out'\n    if (level === 'low') best = 'low'" },
  { name: 'family rule: headers are not skipped', from: 'const real = members.filter((member) => !isStockFamilyHeader(member.product))', to: 'const real = members' },
]
const results: Array<[string, string]> = []
for (const mutant of clientMutants) {
  assert.ok(frontendSource.includes(mutant.from), `client mutant "${mutant.name}" no longer matches the source (stale mutant)`)
  const failed = await failuresOf(diskRead, loadFrontend(frontendSource.replace(mutant.from, mutant.to)), true)
  assert.ok(failed.length > 0, `client mutant survived: ${mutant.name}`)
  results.push([`client: ${mutant.name}`, failed[0].split(':')[0]])
}

// ---- Worker mutants (applied in memory to scratch text; the Worker is never edited) ----
type WorkerMutant = { name: string; file: string; from: string; to: string }
const BELL = 'src/routes/notifications.ts'
const STATS = 'src/lib/familyStockStats.ts'
const workerMutants: WorkerMutant[] = [
  { name: 'uses 0 instead of the global number when a product has no threshold', file: 'src/lib/lowStockSettings.ts', from: 'return `COALESCE(${column}, ${global})`', to: 'return `COALESCE(${column}, 0)`' },
  { name: 'global mode honours the product threshold', file: 'src/lib/lowStockSettings.ts', from: "if (config.mode === 'global') return String(global)", to: "if (config.mode === 'global' && !column) return String(global)" },
  { name: 'Dashboard overview has_low uses <', file: STATS, from: '${qty} <= ${lowThresholdSql} THEN 1 ELSE 0 END', to: '${qty} < ${lowThresholdSql} THEN 1 ELSE 0 END' },
  { name: 'bell low filter uses <', file: BELL, from: 'AND (COALESCE(stock_quantity, 0) <= ${lowThresholdSql}', to: 'AND (COALESCE(stock_quantity, 0) < ${lowThresholdSql}' },
  { name: 'S3: bell is_out column only uses <', file: BELL, from: 'CASE WHEN COALESCE(stock_quantity, 0) <= COALESCE(out_of_stock_threshold, 0) THEN 1 ELSE 0 END AS is_out', to: 'CASE WHEN COALESCE(stock_quantity, 0) < COALESCE(out_of_stock_threshold, 0) THEN 1 ELSE 0 END AS is_out' },
  { name: 'S4: alert-page has_low uses <', file: STATS, from: 'qty <= low_threshold THEN 1 ELSE 0 END) AS has_low\n', to: 'qty < low_threshold THEN 1 ELSE 0 END) AS has_low\n' },
  { name: 'alert-page has_healthy uses >=', file: STATS, from: 'qty > low_threshold THEN 1 ELSE 0 END) AS has_healthy,\n        MAX(CASE WHEN qty > out_threshold AND qty <= low_threshold THEN 1 ELSE 0 END) AS has_low\n', to: 'qty >= low_threshold THEN 1 ELSE 0 END) AS has_healthy,\n        MAX(CASE WHEN qty > out_threshold AND qty <= low_threshold THEN 1 ELSE 0 END) AS has_low\n' },
  { name: 'stats-tile has_low uses < (first of two identical-looking lines)', file: STATS, from: 'qty <= low_threshold THEN 1 ELSE 0 END) AS has_low,', to: 'qty < low_threshold THEN 1 ELSE 0 END) AS has_low,' },
  { name: 'stats-tile has_healthy uses >=', file: STATS, from: 'qty > low_threshold THEN 1 ELSE 0 END) AS has_healthy,\n        MAX(CASE WHEN qty > out_threshold AND qty <= low_threshold THEN 1 ELSE 0 END) AS has_low,', to: 'qty >= low_threshold THEN 1 ELSE 0 END) AS has_healthy,\n        MAX(CASE WHEN qty > out_threshold AND qty <= low_threshold THEN 1 ELSE 0 END) AS has_low,' },
  { name: 'Dashboard overview has_healthy ignores the out threshold', file: STATS, from: '${both(\'MAX\', `CASE WHEN ${qty} > COALESCE(p.out_of_stock_threshold, 0) AND ${qty} > ${lowThresholdSql}', to: '${both(\'MAX\', `CASE WHEN ${qty} > 0 AND ${qty} > ${lowThresholdSql}' },
  { name: 'header expression treats a negative parent as a header', file: STATS, from: "const header = '(COALESCE(p.is_group, 0) = 1 AND COALESCE(p.parent_id, 0) = 0)'", to: "const header = '(COALESCE(p.is_group, 0) = 1 AND COALESCE(p.parent_id, 0) <= 0)'" },
  { name: 'members CTE keeps header rows (alert pages)', file: STATS, from: 'WHERE NOT (m.is_group = 1 AND m.parent_id = 0)\n         OR m.family_root_id NOT IN (SELECT family_root_id FROM non_header_families)\n    ),\n    family_agg AS (\n      SELECT\n        family_root_id,\n        MIN(', to: 'WHERE 1 = 1\n    ),\n    family_agg AS (\n      SELECT\n        family_root_id,\n        MIN(' },
  { name: 'bell out_total column only uses < (second of two identical-looking lines)', file: BELL, from: 'SUM(CASE WHEN COALESCE(stock_quantity, 0) <= COALESCE(out_of_stock_threshold, 0)', to: 'SUM(CASE WHEN COALESCE(stock_quantity, 0) < COALESCE(out_of_stock_threshold, 0)' },
  { name: 'bell WHERE out clause uses <', file: BELL, from: 'OR COALESCE(stock_quantity, 0) <= COALESCE(out_of_stock_threshold, 0))', to: 'OR COALESCE(stock_quantity, 0) < COALESCE(out_of_stock_threshold, 0))' },
  { name: 'Inventory low filter uses <', file: 'src/routes/inventory.ts', from: "AND ${stockExpr} <= ${lowStockThresholdSql(lowStock, 'p.low_stock_threshold')}`)", to: "AND ${stockExpr} < ${lowStockThresholdSql(lowStock, 'p.low_stock_threshold')}`)" },
  { name: 'Inventory out filter uses <', file: 'src/routes/inventory.ts', from: "if (stockState === 'out') where.push(`${stockExpr} <= COALESCE", to: "if (stockState === 'out') where.push(`${stockExpr} < COALESCE" },
  { name: 'Inventory in_stock filter uses >=', file: 'src/routes/inventory.ts', from: "'positive') where.push(`${stockExpr} > COALESCE", to: "'positive') where.push(`${stockExpr} >= COALESCE" },
  { name: 'Products low filter ignores the out threshold', file: 'src/routes/products.ts', from: "if (stockState === 'low') where.push(`${stockExpr} > COALESCE(p.out_of_stock_threshold, 0) AND", to: "if (stockState === 'low') where.push(`${stockExpr} > -1000 AND" },
  { name: 'Products out filter uses <', file: 'src/routes/products.ts', from: "if (stockState === 'out') where.push(`${stockExpr} <= COALESCE", to: "if (stockState === 'out') where.push(`${stockExpr} < COALESCE" },
  { name: 'Products healthy filter uses >=', file: 'src/routes/products.ts', from: "AND ${stockExpr} > ${lowStockThresholdSql(lowStock, 'p.low_stock_threshold')}`)", to: "AND ${stockExpr} >= ${lowStockThresholdSql(lowStock, 'p.low_stock_threshold')}`)" },
  { name: 'Branches low filter uses <', file: 'src/routes/branches.ts', from: "AND COALESCE(bs.quantity, 0) <= ${lowStockThresholdSql(lowStock, 'p.low_stock_threshold')}`)", to: "AND COALESCE(bs.quantity, 0) < ${lowStockThresholdSql(lowStock, 'p.low_stock_threshold')}`)" },
  { name: 'Branches out filter uses <', file: 'src/routes/branches.ts', from: "where.push('COALESCE(bs.quantity, 0) <= COALESCE(p.out_of_stock_threshold, 0)')", to: "where.push('COALESCE(bs.quantity, 0) < COALESCE(p.out_of_stock_threshold, 0)')" },
  { name: 'Telegram out count uses <', file: 'src/lib/telegram.ts', from: 'SUM(CASE WHEN COALESCE(stock_quantity, 0) <= COALESCE(out_of_stock_threshold, 0) THEN 1', to: 'SUM(CASE WHEN COALESCE(stock_quantity, 0) < COALESCE(out_of_stock_threshold, 0) THEN 1' },
  { name: 'Telegram low count uses <', file: 'src/lib/telegram.ts', from: 'AND COALESCE(stock_quantity, 0) <= ${lowThresholdSql} THEN 1', to: 'AND COALESCE(stock_quantity, 0) < ${lowThresholdSql} THEN 1' },
  { name: 'Telegram low-or-out list drops the out half', file: 'src/lib/telegram.ts', from: ' OR COALESCE(stock_quantity, 0) <= COALESCE(out_of_stock_threshold, 0))`', to: ')`' },
  { name: 'Telegram row label (pinned line) uses <', file: 'src/lib/telegram.ts', from: 'const out = Number(row.stock_quantity || 0) <= Number', to: 'const out = Number(row.stock_quantity || 0) < Number' },
  { name: 'issue-state out_of_stock clause uses <', file: 'src/lib/searchMatch.ts', from: "return `${stockExpr} <= COALESCE(p.out_of_stock_threshold, 0)`", to: "return `${stockExpr} < COALESCE(p.out_of_stock_threshold, 0)`" },
  // Copies the first version of this test could not see: Inventory Check, the crossing alert, the threshold column each caller passes, the bell JS, stockExpr, the representative row, a new copy in another style, the storefront lines.
  { name: 'Inventory Check low filter uses <', file: 'src/lib/inventoryCheckProducts.ts', from: "stockConditions.push('p.__quantity>p.__out AND p.__quantity<=p.__low')", to: "stockConditions.push('p.__quantity>p.__out AND p.__quantity<p.__low')" },
  { name: 'Inventory Check family low flag uses <', file: 'src/lib/inventoryCheckProducts.ts', from: 'c.__quantity>c.__out AND c.__quantity<=c.__low THEN 1 ELSE 0 END) AS low,', to: 'c.__quantity>c.__out AND c.__quantity<c.__low THEN 1 ELSE 0 END) AS low,' },
  { name: 'Telegram "now low" crossing uses <', file: 'src/lib/stockCrossingAlert.ts', from: 'if (before > low && after <= low && after > out) return', to: 'if (before > low && after < low && after > out) return' },
  { name: 'Worker isLowStock uses <', file: 'src/lib/lowStockSettings.ts', from: 'return qty <= effectiveLowStockThreshold(config, productLowThreshold)', to: 'return qty < effectiveLowStockThreshold(config, productLowThreshold)' },
  { name: 'bell passes the OUT threshold column to lowStockThresholdSql', file: BELL, from: "const lowThresholdSql = lowStockThresholdSql(config, 'low_stock_threshold')", to: "const lowThresholdSql = lowStockThresholdSql(config, 'out_of_stock_threshold')" },
  { name: 'Telegram counts pass the OUT threshold column', file: 'src/lib/telegram.ts', from: "Promise<string> {\n  const lowThresholdSql = lowStockThresholdSql(await loadLowStockConfig(env), 'low_stock_threshold')\n  const row = ", to: "Promise<string> {\n  const lowThresholdSql = lowStockThresholdSql(await loadLowStockConfig(env), 'out_of_stock_threshold')\n  const row = " },
  { name: 'Telegram /stock list passes the OUT threshold column', file: 'src/lib/telegram.ts', from: "Promise<string> {\n  const db = getDb(env)\n  const lowThresholdSql = lowStockThresholdSql(await loadLowStockConfig(env), 'low_stock_threshold')", to: "Promise<string> {\n  const db = getDb(env)\n  const lowThresholdSql = lowStockThresholdSql(await loadLowStockConfig(env), 'out_of_stock_threshold')" },
  { name: 'Telegram day-movers list passes the OUT threshold column', file: 'src/lib/telegram.ts', from: "more: number }> {\n  const lowThresholdSql = lowStockThresholdSql(await loadLowStockConfig(env), 'low_stock_threshold')", to: "more: number }> {\n  const lowThresholdSql = lowStockThresholdSql(await loadLowStockConfig(env), 'out_of_stock_threshold')" },
  { name: 'bell is_out mapping judges by quantity alone', file: BELL, from: 'rows.map((product) => (Number(product.is_out) === 1', to: 'rows.map((product) => (Number(product.stock_quantity || 0) <= 0' },
  { name: 'bell low count forgets to subtract the out rows', file: BELL, from: 'const lowCount = Math.max(0, Number(rows[0].flagged_total || 0) - outCount)', to: 'const lowCount = Math.max(0, Number(rows[0].flagged_total || 0))' },
  { name: 'Products catalog stockExpr without COALESCE', file: 'src/routes/products.ts', from: ": '(SELECT COALESCE(SUM(catalog_bs.quantity), 0) FROM branch_stock catalog_bs WHERE catalog_bs.product_id = p.id)'", to: ": '(SELECT SUM(catalog_bs.quantity) FROM branch_stock catalog_bs WHERE catalog_bs.product_id = p.id)'" },
  { name: 'alert-page representative: low member needs < (a low member at its threshold loses to an out one)', file: STATS, from: "WHEN @__alertState = 'low' AND m.qty > m.out_threshold AND m.qty <= m.low_threshold THEN 0", to: "WHEN @__alertState = 'low' AND m.qty > m.out_threshold AND m.qty < m.low_threshold THEN 0" },
  { name: 'alert-page representative: out member needs <', file: STATS, from: "WHEN @__alertState = 'out' AND m.qty <= m.out_threshold THEN 0", to: "WHEN @__alertState = 'out' AND m.qty < m.out_threshold THEN 0" },
  { name: 'overview representative: low member needs <', file: STATS, from: "WHEN v.alert_state = 'low' AND m.qty > m.out_threshold AND m.qty <= m.low_threshold THEN 0", to: "WHEN v.alert_state = 'low' AND m.qty > m.out_threshold AND m.qty < m.low_threshold THEN 0" },
  { name: 'overview representative: out member needs <', file: STATS, from: "WHEN v.alert_state = 'out' AND m.qty <= m.out_threshold THEN 0", to: "WHEN v.alert_state = 'out' AND m.qty < m.out_threshold THEN 0" },
  { name: 'a new copy in another style appears (census)', file: 'src/routes/products.ts', from: "  if (stockState === 'out') where.push(`${stockExpr} <= COALESCE", to: "  if (stockState === 'low_only') where.push(`${stockExpr} <= COALESCE(p.low_stock_threshold, 10)`)\n  if (stockState === 'out') where.push(`${stockExpr} <= COALESCE" },
  { name: 'the storefront label uses < for low', file: 'src/routes/portal.ts', from: "if (quantity <= low) return 'low_stock'", to: "if (quantity < low) return 'low_stock'" },
  { name: 'the storefront label uses < for out', file: 'src/routes/portal.ts', from: "if (quantity <= out) return 'out_of_stock'", to: "if (quantity < out) return 'out_of_stock'" },
  { name: 'the storefront label ignores the website low level', file: 'src/routes/portal.ts', from: 'const low = rule.low ?? effectiveLowStockThreshold(rule.shop, rawLow)', to: 'const low = effectiveLowStockThreshold(rule.shop, rawLow)' },
  { name: 'the storefront label ignores the website out level', file: 'src/routes/portal.ts', from: 'const out = rule.out ?? (Number.isFinite(productOut) ? productOut : 0)', to: 'const out = Number.isFinite(productOut) ? productOut : 0' },
  { name: 'the storefront label falls back to a literal 10', file: 'src/routes/portal.ts', from: 'const low = rule.low ?? effectiveLowStockThreshold(rule.shop, rawLow)', to: 'const low = rule.low ?? Number(rawLow || 10)' },
  { name: 'the storefront in_stock pill forgets the out clause', file: 'src/routes/portal.ts', from: "if (state === 'in_stock') return `${stockExpr} > ${level.out} AND ${stockExpr} > ${level.low}`", to: "if (state === 'in_stock') return `${stockExpr} > ${level.low}`" },
  { name: 'the storefront low pill uses <', file: 'src/routes/portal.ts', from: 'AND ${stockExpr} <= ${level.low}`', to: 'AND ${stockExpr} < ${level.low}`' },
  { name: 'the storefront pills ignore the website out level', file: 'src/routes/portal.ts', from: "out: rule.out === null ? 'COALESCE(p.out_of_stock_threshold, 0)' : String(rule.out),", to: "out: 'COALESCE(p.out_of_stock_threshold, 0)'," },
  { name: 'the storefront pills ignore the website low level', file: 'src/routes/portal.ts', from: "low: rule.low === null ? lowStockThresholdSql(rule.shop, 'p.low_stock_threshold') : String(rule.low),", to: "low: lowStockThresholdSql(rule.shop, 'p.low_stock_threshold')," },
  { name: 'the storefront pills fall back to a literal 10', file: 'src/routes/portal.ts', from: "low: rule.low === null ? lowStockThresholdSql(rule.shop, 'p.low_stock_threshold') : String(rule.low),", to: "low: rule.low === null ? 'COALESCE(p.low_stock_threshold, 10)' : String(rule.low)," },
  { name: 'a new storefront comparison appears (census)', file: 'src/routes/portal.ts', from: "if (quantity <= out) return 'out_of_stock'", to: "if (quantity <= out || quantity <= low) return 'out_of_stock'" },
  { name: 'the AI assistant copy changes (census, named exception)', file: 'src/lib/portalAi.ts', from: "if (quantity <= outThreshold) return 'out_of_stock'", to: "if (quantity < outThreshold) return 'out_of_stock'" },
  { name: 'the other AI assistant copy changes (census, named exception)', file: 'src/lib/portalAi.ts', from: "if (quantity <= lowThreshold) return 'low_stock'", to: "if (quantity < lowThreshold) return 'low_stock'" },
  { name: 'a new copy appears (census)', file: 'src/lib/searchMatch.ts', from: "function issueStateClause(key: string, stockExpr: string): string | undefined {", to: "const stray = (q: string) => `${q} <= COALESCE(p.out_of_stock_threshold, 0)`\nfunction issueStateClause(key: string, stockExpr: string): string | undefined {" },
]
for (const mutant of workerMutants) {
  const original = diskRead(mutant.file)
  assert.equal(original.split(mutant.from).length - 1, 1, `Worker mutant "${mutant.name}" must match its source exactly once (stale or ambiguous mutant)`)
  const mutated: Read = (rel) => (rel === mutant.file ? original.replace(mutant.from, () => mutant.to) : diskRead(rel))
  const failed = await failuresOf(mutated, realFrontend, true)
  assert.ok(failed.length > 0, `Worker mutant survived: ${mutant.name}`)
  results.push([`worker: ${mutant.name}`, failed[0].split(':')[0]])
}
if (process.env.STOCK_PARITY_VERBOSE) for (const [name, caught] of results) console.log(`  killed  ${name}  <- ${caught}`)

console.log(`PASS stock state parity: ${rows.length} rows x ${configs.length} configs through every Worker copy, ${familySpecs.length} family fixtures; ${clientMutants.length} client + ${workerMutants.length} Worker mutants killed`)
