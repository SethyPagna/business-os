// Owner, 16 Nov 2026: "Keep both" is a ruling the person chose for ONE pair. Round 6 review, B1: Products' Keep both dismissed every barcode, name and leading-zero cluster that listed
// the pair, and a name cluster can also be the only listing of a DIFFERENT twin pair of the same name, which then silently lost its Duplicate tag and its Conflicts listing (no
// undismiss route, no review). The rule now (utils/exactDuplicateProducts.ts keepBothPlan): the barcode cluster always; a name or leading-zero cluster only when it holds no twin cluster
// apart from the pair's own; and the toast says "still in a duplicate group" when one was left listed.
// This runs the REAL handler body (keepBothDuplicate, compiled from its source) over the REAL Worker sweep (cloudflare productIdentity.ts, over an in-memory database that applies each
// dismissal) and the REAL client twin rule, for every multiset of up to five same-name rows over 8 barcode spellings plus a neighbour row (2,868 cases, 1,740 pairs), and checks what the
// person is left with. Mutants edit the real sources and must each turn it red.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { transformSync } from 'esbuild'
import * as grouping from '../src/utils/productGrouping.ts'
import * as store from '../src/utils/productTwinDismissals.ts'
import * as exact from '../src/utils/exactDuplicateProducts.ts'

const require = createRequire(import.meta.url)
const cfRequire = createRequire(new URL('../../cloudflare/package.json', import.meta.url))
const { buildSync } = cfRequire('esbuild')
const read = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const out = buildSync({ stdin: { contents: "export * from './lib/productIdentity.ts'", resolveDir: fileURLToPath(new URL('../../cloudflare/src', import.meta.url)), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022', logLevel: 'error' })
const sweep: any = (() => { const m = { exports: {} as any }; new Function('require', 'module', 'exports', out.outputFiles[0].text)(require, m, m.exports); return m.exports })()

const sq = new DatabaseSync(':memory:')
const nkStmt = sq.prepare('SELECT lower(trim(?)) AS k')
const nkMemo = new Map<string, string>()
const nameKeyOf = (name: string): string => { if (!nkMemo.has(name)) nkMemo.set(name, (nkStmt.get(name) as { k: string }).k); return nkMemo.get(name)! }

type Row = { id: number; name: string; barcode: string; stock_quantity: number; is_active: number; is_group: number }
type Dismissal = { cluster_type: string; cluster_value: string }
const fakeDb = (rows: Row[], dismissals: Dismissal[]) => ({ prepare(sql: string) { return { all: async () => {
  if (/FROM products p/.test(sql)) return rows.map((r) => ({ id: r.id, name: r.name, barcode: r.barcode, cost_price_usd: 0, cost_price_khr: 0, selling_price_usd: 0, stock_quantity: 0, image_path: null, name_key: nameKeyOf(r.name) }))
  if (/product_duplicate_dismissals WHERE cluster_type IN/.test(sql)) return dismissals.filter((d) => ['name', 'barcode', 'leadingzero'].includes(d.cluster_type))
  if (/product_duplicate_dismissals/.test(sql)) return dismissals
  throw new Error(`unexpected sql ${sql}`)
} } } })

function compile(code: string, resolve: (id: string) => unknown): Record<string, any> {
  const mod: { exports: Record<string, any> } = { exports: {} }
  new Function('require', 'module', 'exports', transformSync(code, { loader: 'ts', format: 'cjs' }).code)((id: string) => resolve(id), mod, mod.exports)
  return mod.exports
}

type Sources = { transport?: string; plan?: string }
const REAL = '8851234567890', OTHER = '8859999999999'
const DOMAIN = ['', '0', 'Mask', '601', '0601', REAL, `0${REAL}`, OTHER]
const multisets = (domain: string[], k: number, start = 0): string[][] => {
  if (!k) return [[]]
  const found: string[][] = []
  for (let i = start; i < domain.length; i += 1) for (const rest of multisets(domain, k - 1, i)) found.push([domain[i], ...rest])
  return found
}
const NEIGHBOURS = [null, { name: 'Probe-Name', barcode: '' }, { name: 'Probe-Name', barcode: REAL }, { name: 'Other Thing', barcode: REAL }]

async function exhaustive(sources: Sources = {}): Promise<{ failures: string[]; pairs: number; disjointLost: number; stillListedToasts: number; plainToasts: number }> {
  const failures: string[] = []
  const note = (message: string) => { if (failures.length < 6) failures.push(message) }
  let current: { rows: Row[]; dismissals: Dismissal[] } = { rows: [], dismissals: [] }
  const plan = sources.plan ? compile(sources.plan, (id) => (id.endsWith('productGrouping.ts') ? grouping : (() => { throw new Error(`unexpected require ${id}`) })())) : exact
  const transport = compile(sources.transport ?? read('components/shared/twinDismissalsTransport.ts'), (id) => {
    if (id.endsWith('http.ts')) return { apiFetch: async () => ({ dismissals: await sweep.listTwinDismissals(fakeDb(current.rows, current.dismissals)) }) }
    if (id.endsWith('productWriteTransport.ts')) {
      return { dismissProductDuplicateCluster: async (type: string, value: string) => { current.dismissals.push({ cluster_type: type, cluster_value: sweep.normalizeProductClusterKey(type, value) }); return { success: true } } }
    }
    if (id.endsWith('productTwinDismissals.ts')) return store
    if (id.endsWith('exactDuplicateProducts.ts')) return plan
    throw new Error(`unexpected require ${id}`)
  })
  const holds = (clusters: any[], ids: number[]) => clusters.some((c) => ids.every((id) => c.products.some((p: { id: number }) => Number(p.id) === id)))
  const twinClusters = (items: Row[]): number[][] => {
    const keys = grouping.unmergedTwinKeys(items as never)
    const byKey = new Map<string, number[]>()
    items.forEach((item, i) => { if (keys[i]) byKey.set(keys[i], [...(byKey.get(keys[i]) || []), item.id]) })
    return [...byKey.values()].map((ids) => ids.sort((a, b) => a - b))
  }
  let pairs = 0, disjointLost = 0, stillListedToasts = 0, plainToasts = 0
  for (const k of [2, 3, 4, 5]) for (const codes of multisets(DOMAIN, k)) for (const nb of (k <= 3 ? NEIGHBOURS : [null, NEIGHBOURS[1]])) {
    const rows: Row[] = codes.map((barcode, i) => ({ id: i + 1, name: 'Probe Name', barcode, stock_quantity: 0, is_active: 1, is_group: 0 }))
    if (nb) rows.push({ id: 99, name: nb.name, barcode: nb.barcode, stock_quantity: 0, is_active: 1, is_group: 0 })
    const L0 = await sweep.findPossiblySameProductClusters(fakeDb(rows, []))
    store.setTwinDismissals(store.NO_TWIN_DISMISSALS)
    const T0 = twinClusters(rows)
    const payload = exact.extractDuplicateClusters({ clusters: L0 })
    const seen = new Set<string>()
    for (const info of exact.buildExactDuplicateIndex(payload).values()) {
      if (seen.has(info.key)) continue
      seen.add(info.key)
      pairs += 1
      const ids = info.members.map((m) => Number(m.id))
      current = { rows, dismissals: [] }
      store.setTwinDismissals(store.NO_TWIN_DISMISSALS)
      const toasts: string[] = []
      await transport.keepBothDuplicate(payload, info, (m: string) => toasts.push(m), (key: string) => key, async () => {})
      const LS = await sweep.findPossiblySameProductClusters(fakeDb(rows, current.dismissals))
      const TS = twinClusters(rows)
      const where = `codes ${JSON.stringify(rows.map((r) => r.barcode))}${nb ? ` + id 99 ${JSON.stringify(nb.name)}` : ''}, Keep both on ${ids}, ruled ${JSON.stringify(current.dismissals.map((d) => `${d.cluster_type}:${d.cluster_value}`))}`
      // 1. never another pair the person did not choose: a twin cluster that shares no row with the pair keeps its tag or its listing
      for (const T of T0) {
        if (T.some((id) => ids.includes(id)) || !holds(L0, T)) continue
        if (TS.some((t) => t.join() === T.join()) || holds(LS, T)) continue
        disjointLost += 1
        note(`a separate pair ${JSON.stringify(T)} lost its tag and its listing: ${where}`)
      }
      // 2. the toast is true
      const listedByNameOrZero = LS.some((c: any) => c.type !== 'barcode' && c.type !== 'similar' && ids.every((id) => c.products.some((p: { id: number }) => Number(p.id) === id)))
      const flagged = exact.buildExactDuplicateIndex(exact.extractDuplicateClusters({ clusters: LS })).size > 0 && ids.some((id) => exact.buildExactDuplicateIndex(exact.extractDuplicateClusters({ clusters: LS })).has(id))
      const tagged = TS.some((t) => ids.filter((id) => t.includes(id)).length >= 2)
      if (toasts.length !== 1) { note(`${toasts.length} toasts: ${where}`); continue }
      if (toasts[0] === 'product_duplicate_kept_both') {
        plainToasts += 1
        if (flagged || tagged || listedByNameOrZero) note(`"no longer flagged" but the pair is still flagged (control ${flagged}, tag ${tagged}, listed ${listedByNameOrZero}): ${where}`)
      } else if (toasts[0] === 'product_duplicate_kept_still_listed') {
        stillListedToasts += 1
        if (!listedByNameOrZero) note(`"still in a group" but no name or leading-zero cluster lists the pair: ${where}`)
      } else note(`unexpected toast ${toasts[0]}: ${where}`)
    }
  }
  store.setTwinDismissals(store.NO_TWIN_DISMISSALS)
  return { failures, pairs, disjointLost, stillListedToasts, plainToasts }
}

const REAL_TRANSPORT = read('components/shared/twinDismissalsTransport.ts')
const REAL_PLAN = read('utils/exactDuplicateProducts.ts')

const real = await exhaustive()
assert.deepEqual(real.failures, [], 'the real handler')
assert.ok(real.pairs >= 1700, `swept ${real.pairs} pairs (the sweep must stay exhaustive)`)
assert.equal(real.disjointLost, 0, 'no separate pair is ruled')
assert.ok(real.stillListedToasts > 100 && real.plainToasts > 1000, `both toasts are exercised (${real.stillListedToasts} still-listed, ${real.plainToasts} plain)`)

const mutants: Array<{ name: string; sources: Sources }> = []
const edit = (source: string, from: string, to: string, name: string): string => { assert.ok(source.includes(from), `mutant "${name}" no longer matches the source (stale mutant)`); return source.replace(from, to) }
mutants.push({ name: 'barcode-only (N2)', sources: { transport: edit(REAL_TRANSPORT, 'dismissProductClustersAndRefresh(rulings)', 'dismissProductClustersAndRefresh(rulings.slice(0, 1))', 'barcode-only') } })
mutants.push({ name: 'rules the whole name cluster (round 6)', sources: { plan: edit(REAL_PLAN, 'if (keys.some((key) => key && !own.has(key))) stillListed = true\n    else rulings.push(ruling)', 'rulings.push(ruling)', 'whole cluster') } })
mutants.push({ name: 'toast inverted', sources: { transport: edit(REAL_TRANSPORT, 'notify(stillListed ?', 'notify(!stillListed ?', 'inverted') } })
mutants.push({ name: 'always the plain toast', sources: { transport: edit(REAL_TRANSPORT, 'notify(stillListed ?', 'notify(false ?', 'plain') } })
mutants.push({ name: 'always the still-listed toast', sources: { transport: edit(REAL_TRANSPORT, 'notify(stillListed ?', 'notify(true ?', 'still') } })
for (const mutant of mutants) {
  const result = await exhaustive(mutant.sources)
  assert.ok(result.failures.length > 0, `mutant survived: ${mutant.name}`)
}
console.log(`keepBothNarrow: ${real.pairs} pairs, ${real.plainToasts} plain toasts, ${real.stillListedToasts} still-listed toasts, ${real.disjointLost} separate pairs lost; ${mutants.length} mutants killed`)
