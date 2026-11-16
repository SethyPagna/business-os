// Owner, 16 Nov 2026: "Keep both" is a ruling the person chose for ONE pair. Round 6 review B1 and round 7 review B2: Products' Keep both must never silence another pair. A ruling is keyed
// wider than the cluster the person looked at (a name by its name_key, a leading-zero cluster by the folded code alone ACROSS every product name), so keepBothPlan (utils/
// exactDuplicateProducts.ts) rules the pair's barcode cluster always, and a name or leading-zero cluster only when every row any such ruling reaches is in the pair.
// This runs the REAL handler body (keepBothDuplicate, compiled from its source) over the REAL Worker sweep (cloudflare productIdentity.ts, over an in-memory database that applies each
// dismissal) and the REAL client twin rule, in three exhaustive domains: one name over 8 spellings plus a neighbour row, TWO names over 8 spellings (both row orders, the leading-zero
// spellings of one code under both names), and one name typed with one or two inner spaces. Every offered pair is also run through the CONTROL (production's barcode-only Keep both),
// case by case: no pair the control keeps may be lost, no overlapping pair may lose its tag or listing, and neither toast may be false. Mutants edit the real sources and must each
// turn a behavioural check red, not only a count.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { transformSync } from 'esbuild'
import * as grouping from '../src/utils/productGrouping.ts'
import * as store from '../src/utils/productTwinDismissals.ts'
import * as exact from '../src/utils/exactDuplicateProducts.ts'
import * as detail from '../src/utils/productDetailRule.ts'

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
const multisets = <T>(domain: readonly T[], k: number, start = 0): T[][] => {
  if (!k) return [[]]
  const found: T[][] = []
  for (let i = start; i < domain.length; i += 1) for (const rest of multisets(domain, k - 1, i)) found.push([domain[i], ...rest])
  return found
}
const NEIGHBOURS = [null, { name: 'Probe-Name', barcode: '' }, { name: 'Probe-Name', barcode: REAL }, { name: 'Other Thing', barcode: REAL }]

type World = { rows: Row[]; label: string }
const row = (id: number, name: string, barcode: string): Row => ({ id, name, barcode, stock_quantity: 0, is_active: 1, is_group: 0 })

// Domain A: one product name, every multiset of up to five rows over eight spellings, plus a neighbour row.
function* oneName(): Generator<World> {
  for (const k of [2, 3, 4, 5]) for (const codes of multisets(DOMAIN, k)) for (const nb of (k <= 3 ? NEIGHBOURS : [null, NEIGHBOURS[1]])) {
    const rows = codes.map((barcode, i) => row(i + 1, 'Probe Name', barcode))
    if (nb) rows.push(row(99, nb.name, nb.barcode))
    yield { rows, label: `codes ${JSON.stringify(codes)}${nb ? ` + id 99 ${JSON.stringify(nb.name)}/${JSON.stringify(nb.barcode)}` : ''}` }
  }
}
// Domain B: TWO product names (round 7 review, B2), two or three rows each, over codes that include the leading-zero spellings of one code and of a 3-digit code, so the
// leading-zero cluster of one name and the one of the other name share a folded code in every arrangement and in both row orders.
const TWO_NAME_CODES = ['', REAL, `0${REAL}`, `00${REAL}`, OTHER, '601', '0601', '00601']
function* twoNames(): Generator<World> {
  for (const ka of [2, 3]) for (const kb of [2, 3]) for (const ca of multisets(TWO_NAME_CODES, ka)) for (const cb of multisets(TWO_NAME_CODES, kb)) {
    yield { rows: [...ca.map((c, i) => row(i + 1, 'Name A', c)), ...cb.map((c, i) => row(ka + i + 1, 'Name B', c))], label: `A ${JSON.stringify(ca)} B ${JSON.stringify(cb)}` }
  }
}
// Domain C: one display name typed with one or two inner spaces (the Worker keys them apart, name_key keeps inner whitespace), three codes.
function* whitespace(): Generator<World> {
  const spec: Array<[string, string]> = []
  for (const n of ['Probe Name', 'Probe  Name']) for (const c of ['', REAL, OTHER]) spec.push([n, c])
  for (const k of [2, 3, 4]) for (const combo of multisets(spec.map((_, i) => i), k)) {
    yield { rows: combo.map((i, at) => row(at + 1, spec[i][0], spec[i][1])), label: `rows ${JSON.stringify(combo.map((i) => spec[i]))}` }
  }
}

type Totals = { worlds: number; pairs: number; failures: string[]; laneLost: number; controlLost: number; extraLost: number; overlapLost: number; falsePlain: number; falseStill: number; stillListedToasts: number; plainToasts: number }

const REAL_TRANSPORT = read('components/shared/twinDismissalsTransport.ts')
const REAL_PLAN = read('utils/exactDuplicateProducts.ts')
const edit = (source: string, from: string, to: string, name: string): string => { assert.ok(source.includes(from), `mutant "${name}" no longer matches the source (stale mutant)`); return source.replace(from, () => to) }
// The control is production before this lane: Keep both rules the pair's barcode cluster only.
const CONTROL_TRANSPORT = edit(REAL_TRANSPORT, 'dismissProductClustersAndRefresh(rulings)', 'dismissProductClustersAndRefresh(rulings.slice(0, 1))', 'control')

let current: { rows: Row[]; dismissals: Dismissal[] } = { rows: [], dismissals: [] }
function build(sources: Sources) {
  const plan = sources.plan ? compile(sources.plan, (id) => (id.endsWith('productGrouping.ts') ? grouping : id.endsWith('productDetailRule.ts') ? detail : (() => { throw new Error(`unexpected require ${id}`) })())) : exact
  const transport = compile(sources.transport ?? REAL_TRANSPORT, (id) => {
    if (id.endsWith('http.ts')) return { apiFetch: async () => ({ dismissals: await sweep.listTwinDismissals(fakeDb(current.rows, current.dismissals)) }) }
    if (id.endsWith('productWriteTransport.ts')) {
      return { dismissProductDuplicateCluster: async (type: string, value: string) => { current.dismissals.push({ cluster_type: type, cluster_value: sweep.normalizeProductClusterKey(type, value) }); return { success: true } } }
    }
    if (id.endsWith('productTwinDismissals.ts')) return store
    if (id.endsWith('exactDuplicateProducts.ts')) return plan
    throw new Error(`unexpected require ${id}`)
  })
  return { plan, transport }
}

const holds = (clusters: any[], ids: number[]) => clusters.some((c) => ids.every((id) => c.products.some((p: { id: number }) => Number(p.id) === id)))
const twinClusters = (items: Row[]): number[][] => {
  const keys = grouping.unmergedTwinKeys(items as never)
  const byKey = new Map<string, number[]>()
  items.forEach((item, i) => { if (keys[i]) byKey.set(keys[i], [...(byKey.get(keys[i]) || []), item.id]) })
  return [...byKey.values()].map((ids) => ids.sort((a, b) => a - b))
}

// Every world: every pair the plan offers Keep both is run through the real handler, and the same pair through the control. What the person is left with must be
//   1. no worse than the control for any OTHER twin pair (a separate pair, or one that shares a row with the pair): the lane may never lose a tag or a listing the control keeps,
//   2. the toast must be true in both directions.
async function exhaustive(worlds: Iterable<World>, sources: Sources = {}): Promise<Totals> {
  const t: Totals = { worlds: 0, pairs: 0, failures: [], laneLost: 0, controlLost: 0, extraLost: 0, overlapLost: 0, falsePlain: 0, falseStill: 0, stillListedToasts: 0, plainToasts: 0 }
  const note = (message: string) => { if (t.failures.length < 6) t.failures.push(message) }
  const lane = build(sources)
  const control = build({ transport: CONTROL_TRANSPORT })
  for (const world of worlds) {
    t.worlds += 1
    const { rows } = world
    const L0 = await sweep.findPossiblySameProductClusters(fakeDb(rows, []))
    store.setTwinDismissals(store.NO_TWIN_DISMISSALS)
    const T0 = twinClusters(rows).filter((T) => holds(L0, T))
    const payload = lane.plan.extractDuplicateClusters({ clusters: L0 })
    const seen = new Set<string>()
    for (const info of lane.plan.buildExactDuplicateIndex(payload).values()) {
      if (seen.has(info.key)) continue
      seen.add(info.key)
      t.pairs += 1
      const ids: number[] = info.members.map((m: { id: number }) => Number(m.id))
      const lostBy = async (transport: any, toasts: string[]) => {
        current = { rows, dismissals: [] }
        store.setTwinDismissals(store.NO_TWIN_DISMISSALS)
        await transport.keepBothDuplicate(payload, info, (m: string) => toasts.push(m), (key: string) => key, async () => {})
        const LS = await sweep.findPossiblySameProductClusters(fakeDb(rows, current.dismissals))
        const TS = twinClusters(rows)
        const lost = new Set<string>()
        const both = new Set<string>()
        for (const T of T0) {
          const untagged = !TS.some((x) => x.join() === T.join()), unlisted = !holds(LS, T)
          if (untagged || unlisted) lost.add(T.join())
          if (untagged && unlisted) both.add(T.join())
        }
        return { LS, TS, lost, both, ruled: current.dismissals.map((d) => `${d.cluster_type}:${d.cluster_value}`) }
      }
      const controlToasts: string[] = []
      const ctl = await lostBy(control.transport, controlToasts)
      const toasts: string[] = []
      const got = await lostBy(lane.transport, toasts)
      const where = `${world.label}, Keep both on ${ids}, ruled ${JSON.stringify(got.ruled)}`
      // 1. nothing the control keeps may be lost
      for (const key of got.lost) {
        const T = key.split(',').map(Number)
        if (T.every((id) => ids.includes(id))) continue // the pair's own tag and listing are what Keep both ends
        const overlaps = T.some((id) => ids.includes(id))
        if (overlaps) { if (got.both.has(key)) t.overlapLost += 1 }
        else t.laneLost += 1
        if (!ctl.lost.has(key)) { t.extraLost += 1; note(`${overlaps ? 'an overlapping' : 'a separate'} pair ${key} lost its tag or its listing, which the control keeps: ${where}`) }
      }
      for (const key of ctl.lost) if (!key.split(',').some((id) => ids.includes(Number(id)))) t.controlLost += 1
      // 2. the toast is true
      const listedByNameOrZero = got.LS.some((c: any) => c.type !== 'barcode' && c.type !== 'similar' && ids.every((id) => c.products.some((p: { id: number }) => Number(p.id) === id)))
      const flaggedIndex = exact.buildExactDuplicateIndex(exact.extractDuplicateClusters({ clusters: got.LS }))
      const flagged = ids.some((id) => flaggedIndex.has(id))
      const tagged = got.TS.some((x) => ids.filter((id) => x.includes(id)).length >= 2)
      if (toasts.length !== 1) { note(`${toasts.length} toasts: ${where}`); continue }
      if (toasts[0] === 'product_duplicate_kept_both') {
        t.plainToasts += 1
        if (flagged || tagged || listedByNameOrZero) { t.falsePlain += 1; note(`"no longer flagged" but the pair is still flagged (index ${flagged}, tag ${tagged}, listed ${listedByNameOrZero}): ${where}`) }
      } else if (toasts[0] === 'product_duplicate_kept_still_listed') {
        t.stillListedToasts += 1
        if (!listedByNameOrZero) { t.falseStill += 1; note(`"still in a group" but no name or leading-zero cluster lists the pair: ${where}`) }
      } else note(`unexpected toast ${toasts[0]}: ${where}`)
    }
  }
  store.setTwinDismissals(store.NO_TWIN_DISMISSALS)
  return t
}

const real = {
  one: await exhaustive(oneName()),
  two: await exhaustive(twoNames()),
  ws: await exhaustive(whitespace()),
}
for (const [name, r] of Object.entries(real)) {
  assert.deepEqual(r.failures, [], `the real handler, domain ${name}`)
  assert.equal(r.extraLost, 0, `domain ${name}: no pair the control keeps is lost`)
  assert.equal(r.overlapLost, 0, `domain ${name}: no overlapping pair loses its tag or listing`)
  assert.equal(r.falsePlain + r.falseStill, 0, `domain ${name}: no false toast of either kind`)
  assert.ok(r.laneLost <= r.controlLost, `domain ${name}: lane collateral ${r.laneLost} must not exceed the control's ${r.controlLost}`)
}
assert.ok(real.one.pairs >= 1700, `swept ${real.one.pairs} one-name pairs (the sweep must stay exhaustive)`)
assert.ok(real.two.worlds >= 12000 && real.two.pairs >= 8000, `swept ${real.two.worlds} two-name worlds, ${real.two.pairs} pairs`)
assert.ok(real.ws.worlds >= 200 && real.ws.pairs >= 100, `swept ${real.ws.worlds} whitespace worlds, ${real.ws.pairs} pairs`)
assert.ok(real.two.controlLost > 0 && real.two.laneLost === real.two.controlLost, `the cross-name barcode ruling the control already has is the only collateral (${real.two.laneLost} against ${real.two.controlLost}); the lane adds none`)
for (const r of Object.values(real)) assert.ok(r.stillListedToasts > 0 && r.plainToasts > 0, 'both toasts are exercised in every domain')

// Mutants edit the real sources and must each turn a BEHAVIOURAL check red (a collateral loss the control does not have, a false toast, or an overlap loss) -- never only a count.
const mutants: Array<{ name: string; sources: Sources; kills: (t: Totals) => boolean }> = []
const BEHAVIOUR = (t: Totals): boolean => t.extraLost > 0 || t.overlapLost > 0 || t.falsePlain > 0 || t.falseStill > 0
const REACHED = "const reached = clusters.some((cluster) => cluster.type === ruling.type && keyOf(cluster.type, cluster.value) === key && (cluster.products || []).some(outside))"
const FOLD = /const sharesFold = [^\n]*\n/
mutants.push({ name: 'rules every name and leading-zero cluster that lists the pair (round 6)', sources: { plan: edit(REAL_PLAN, 'if (reached || sharesFold) stillListed = true\n    else rulings.push(ruling)', 'rulings.push(ruling)', 'whole') }, kills: BEHAVIOUR })
const FIRST_ONLY = ['const first = clusters.find((cluster) => cluster.type === ruling.type && cluster.value === ruling.value)', '    const firstRows = first?.products || []', '    const firstKeys = unmergedTwinKeys(firstRows as never)', "    const firstOwn = new Set(firstRows.map((r, i) => (wanted.has(Number(r.id)) ? firstKeys[i] : '')))", '    const reached = firstKeys.some((k) => k && !firstOwn.has(k))'].join('\n')
mutants.push({ name: 'the ruling checks only the first cluster of its type and value, by twin keys (round 7, row-order dependent)', sources: { plan: edit(REAL_PLAN, REACHED, FIRST_ONLY, 'first-only').replace('import { serverNameKey }', 'import { serverNameKey, unmergedTwinKeys }').replace(FOLD, 'const sharesFold = false\n') }, kills: BEHAVIOUR })
mutants.push({ name: 'never reports still listed', sources: { plan: edit(REAL_PLAN, 'if (reached || sharesFold) stillListed = true\n    else rulings.push(ruling)', 'if (!(reached || sharesFold)) rulings.push(ruling)', 'silent') }, kills: BEHAVIOUR })
mutants.push({ name: 'always reports still listed', sources: { plan: edit(REAL_PLAN, 'return { rulings, stillListed }', 'return { rulings, stillListed: true }', 'always') }, kills: BEHAVIOUR })
mutants.push({ name: 'names compare with whitespace collapsed (the pre-round-8 key)', sources: { plan: edit(REAL_PLAN, 'const nameKey = serverNameKey(product?.name)', "const nameKey = String(product?.name ?? '').replace(/\\s+/g, ' ').trim().toLowerCase()", 'collapse') }, kills: BEHAVIOUR })
mutants.push({ name: 'toast inverted', sources: { transport: edit(REAL_TRANSPORT, 'notify(stillListed ?', 'notify(!stillListed ?', 'inverted') }, kills: BEHAVIOUR })
mutants.push({ name: 'always the plain toast', sources: { transport: edit(REAL_TRANSPORT, 'notify(stillListed ?', 'notify(false ?', 'plain') }, kills: BEHAVIOUR })
mutants.push({ name: 'always the still-listed toast', sources: { transport: edit(REAL_TRANSPORT, 'notify(stillListed ?', 'notify(true ?', 'still') }, kills: BEHAVIOUR })
mutants.push({ name: 'the pair\'s barcode is not always ruled', sources: { plan: edit(REAL_PLAN, "const rulings: Array<{ type: 'barcode' | 'name' | 'leadingzero'; value: string }> = [{ type: 'barcode', value: barcode }]", "const rulings: Array<{ type: 'barcode' | 'name' | 'leadingzero'; value: string }> = []", 'no barcode') }, kills: BEHAVIOUR })
const killedBy: string[] = []
for (const mutant of mutants) {
  // The one-name and whitespace domains are small; the two-name domain is the one that exposes the cross-name rulings, so a mutant gets all three.
  const results = [await exhaustive(oneName(), mutant.sources), await exhaustive(whitespace(), mutant.sources), await exhaustive(twoNames(), mutant.sources)]
  assert.ok(results.some((r) => mutant.kills(r) && r.failures.length > 0), `mutant survived (no behavioural check went red): ${mutant.name}`)
  killedBy.push(`${mutant.name}: ${results.map((r) => `${r.extraLost}/${r.overlapLost}/${r.falsePlain}/${r.falseStill}`).join(' ')}`)
}
const line = (name: string, r: Totals) => `${name} ${r.worlds} worlds ${r.pairs} pairs, collateral lane ${r.laneLost} control ${r.controlLost}, overlap lost ${r.overlapLost}, false toasts ${r.falsePlain + r.falseStill}, toasts plain ${r.plainToasts} still-listed ${r.stillListedToasts}`
console.log(`keepBothNarrow: ${line('one-name', real.one)}; ${line('two-name', real.two)}; ${line('whitespace', real.ws)}; ${mutants.length} mutants killed`)
if (process.env.KEEP_BOTH_VERBOSE) console.log(killedBy.join('\n'))
