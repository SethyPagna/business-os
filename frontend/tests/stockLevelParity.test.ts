// stockLevelState / stockGroupLevel / isStockFamilyHeader (frontend/src/utils/lowStockSettings.ts) must give the SAME
// answer as every piece of Worker SQL that decides out / low / healthy -- owner ask 15 Nov 2026: a product is never
// "low" in one place and "healthy" in another.
//
// Nothing server-side is re-typed here. The Worker's own text is executed in node:sqlite over a 504-row x 12-config
// matrix (quantity x both thresholds x alerts on/off x product/global mode, NULL / 0 / negative / fractional):
//   - lowStockThresholdSql, loaded from the source (transpiled);
//   - getFamilyStockStats, getFamilyStockAlertPage and familyStockOverviewSql (the Dashboard / alert pages), called for real;
//   - the bell's inventory SELECT (routes/notifications.ts), the Inventory / Products / Branches stock-state filters
//     (routes/inventory.ts, products.ts, branches.ts), the Telegram stock counts and filter (lib/telegram.ts) and the
//     issue-state out clause (lib/searchMatch.ts), each EXTRACTED from its source text and run unchanged.
// Each copy's answer is compared with a hand-typed reference rule (refState below), and the client with the same.
// The family rule (stockGroupLevel) is compared with the Dashboard's has_healthy / has_low flags and the alert pages
// on multi-member fixtures, header rows included, and isStockFamilyHeader with the server's header expression.
// Where a line cannot be run it is pinned by exact normalised text AND occurrence count, and a census of every
// threshold comparison in the Worker fails when a new copy appears that nobody has looked at.
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

// Every threshold comparison in the Worker, by file. A new one means a new copy of the rule: look at it, then add it here
// (and to the parity run above) -- do not just bump the number.
const KNOWN_COMPARISONS: Record<string, number> = {
  'lib/familyStockStats.ts': 10, // 134-135, 238-239 (run), 337-338 (run), 267-268 / 400-401 are the representative-row ranking only
  'lib/searchMatch.ts': 1, // issue-state 'out_of_stock' (run)
  'lib/telegram.ts': 4, // lowOrOutOfStockSql (run), lowStockRowLines (pinned), the two stock counts (run)
  'routes/branches.ts': 4, // in_stock / healthy / low / out filters (run)
  'routes/inventory.ts': 3, // low / out / in_stock filters (run)
  'routes/notifications.ts': 4, // the bell (run)
  'routes/portal.ts': 4, // the public storefront: its own rule (in_stock, out, low with a literal 10), NOT a staff surface; named in the lane report
  'routes/products.ts': 4, // low / out / in_stock / healthy filters (run)
}
const COMPARISON = /(<=|>=|<|>)\s*(COALESCE\([\w.]*out_of_stock_threshold|Number\([\w.]*out_of_stock_threshold|[\w.]*out_threshold|[\w.]*low_threshold|\$\{low\w*\}|\$\{lowStockThresholdSql)/
function listTs(dir: string, base = ''): string[] {
  return readdirSync(path.join(dir, base), { withFileTypes: true }).flatMap((entry) => {
    const rel = base ? `${base}/${entry.name}` : entry.name
    return entry.isDirectory() ? listTs(dir, rel) : rel.endsWith('.ts') ? [rel] : []
  })
}

// ---- The whole parity run, over a Worker source reader and a client module ----
async function failuresOf(read: Read, fe: any, firstOnly = false): Promise<string[]> {
  const failures: string[] = []
  const check = async (label: string, fn: () => unknown) => {
    if (firstOnly && failures.length) return
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
      const sql = substitute(extract(bellSource, /async function buildInventorySection[\s\S]*?db\.prepare\(`([\s\S]*?)`\)\.all</, 'the bell inventory SELECT'),
        { '${lowThresholdSql}': lowSql, '${stockVisibleProductSql()}': guard.stockVisibleProductSql() }, 'bell')
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
      for (const [state, expected] of states) {
        await check(`${label} '${state}' filter ${tag}`, () => {
          const clause = substitute(pushClause(source, state, label), { '${stockExpr}': STOCK_EXPR, 'COALESCE(bs.quantity, 0)': STOCK_EXPR, [LOW_CALL]: lowSql }, label)
          sameSet(ofIds(matrixDb, clause), [...expected].sort((a, b) => a - b), `${label} ${state}`)
        })
      }
    }
    // Telegram: the two stock counts and the low-or-out list filter.
    const telegram = read2('lib/telegram.ts')
    await check(`telegram counts ${tag}`, () => {
      const out = substitute(extract(telegram, /SUM\(CASE WHEN (.+?) THEN 1 ELSE 0 END\), 0\) AS out_of_stock/, 'the telegram out count'), { '${lowThresholdSql}': lowSql }, 'telegram out')
      const low = substitute(extract(telegram, /SUM\(CASE WHEN (.+?) THEN 1 ELSE 0 END\), 0\) AS low_stock/, 'the telegram low count'), { '${lowThresholdSql}': lowSql }, 'telegram low')
      sameSet(ofIds(matrixDb, out), want('out'), 'telegram out')
      sameSet(ofIds(matrixDb, low), want('low'), 'telegram low')
    })
    await check(`telegram lowOrOutOfStockSql ${tag}`, () => {
      const clause = substitute(extract(telegram, /const lowOrOutOfStockSql = \(lowThresholdSql: string\): string =>\s*`([^`]*)`/, 'lowOrOutOfStockSql'), { '${lowThresholdSql}': lowSql }, 'telegram list')
      sameSet(ofIds(matrixDb, clause), [...want('out'), ...want('low')].sort((a, b) => a - b), 'telegram list')
    })
    await check(`searchMatch issue 'out_of_stock' ${tag}`, () => {
      const clause = substitute(extract(read2('lib/searchMatch.ts'), /case 'out_of_stock':\s*return `([^`]*)`/, "the 'out_of_stock' issue clause"), { '${stockExpr}': STOCK_EXPR }, 'searchMatch')
      sameSet(ofIds(matrixDb, clause), want('out'), 'searchMatch out')
    })
  }

  // Pinned text (not runnable in isolation): exact normalised text and occurrence count.
  await check('pin telegram lowStockRowLines out test', () => {
    assert.equal(occurrences(read2('lib/telegram.ts'), 'const out = Number(row.stock_quantity || 0) <= Number(row.out_of_stock_threshold || 0)'), 1)
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

  // Census: every threshold comparison in the Worker is accounted for.
  await check('census of threshold comparisons', () => {
    const found: Record<string, number> = {}
    for (const rel of listTs(path.join(WORKER_ROOT, 'src'))) {
      const lines = read2(rel).split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && COMPARISON.test(line))
      if (lines.length) found[rel] = lines.length
    }
    assert.deepEqual(found, KNOWN_COMPARISONS, 'a threshold comparison appeared, moved or vanished: look at it, add it to the parity run, then update KNOWN_COMPARISONS')
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
