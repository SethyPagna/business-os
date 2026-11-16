// Owner, 16 Nov 2026: "Keep both" is a ruling the person chose for ONE pair. Round 6 review B1, round 7 review B2, round 8 review E1: Products' Keep both must never silence another pair.
// A name or leading-zero ruling is keyed wider than the cluster the person looked at (a name by its name_key, a leading-zero cluster by the folded code ACROSS every product name), so
// keepBothPlan (utils/exactDuplicateProducts.ts) rules the pair's barcode cluster and nothing else, and says "still listed" when any name or leading-zero cluster holds two or more of the
// members. The resolver groups names with the COLLAPSING key, as the Products list does; keying it as the Worker does split one display group into several resolvers and the barcode ruling
// then cleared them all (E1).
// This runs the REAL handler body (keepBothDuplicate, compiled from its source) over the REAL Worker sweep (cloudflare productIdentity.ts, over an in-memory database that applies each
// dismissal) and the REAL client twin rule, in six exhaustive domains (A one name, B two names, C inner spaces, D three names, E name spellings: case, edge space, inner space, tab,
// non-ASCII case, F padded and letter-case barcodes). The control is production before this lane, written out in the test (not taken from the module under test): its index and its
// barcode-only click. The module must offer Keep both on exactly the groups production offers, and each click is compared with the control's case by case: no pair the production click
// keeps may be lost, no overlapping pair may lose its tag and its listing, neither toast may be false. Mutants edit the real sources and must each turn a behavioural check red.
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
const REAL = '8851234567890', OTHER = '8859999999999', TAB = String.fromCharCode(9)
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

// Every domain below is exhaustive over its alphabet. A: one name, 8 spellings plus a neighbour row. B: two names (round 7 review, B2), both row orders, leading-zero spellings of one code
// under both names. C: one name typed with one or two inner spaces. D: three names. E: name spellings that the Products list groups as ONE name but the Worker keys apart (round 8 review,
// E1): case, edge space, inner space, trailing tab, non-ASCII case. F: padded and letter-case barcodes under two names.
function* oneName(): Generator<World> {
  for (const k of [2, 3, 4, 5]) for (const codes of multisets(DOMAIN, k)) for (const nb of (k <= 3 ? NEIGHBOURS : [null, NEIGHBOURS[1]])) {
    const rows = codes.map((barcode, i) => row(i + 1, 'Probe Name', barcode))
    if (nb) rows.push(row(99, nb.name, nb.barcode))
    yield { rows, label: `codes ${JSON.stringify(codes)}${nb ? ` + id 99 ${JSON.stringify(nb.name)}/${JSON.stringify(nb.barcode)}` : ''}` }
  }
}
function* twoNames(codesOf: readonly string[] = ['', REAL, `0${REAL}`, `00${REAL}`, OTHER, '601', '0601', '00601']): Generator<World> {
  for (const ka of [2, 3]) for (const kb of [2, 3]) for (const ca of multisets(codesOf, ka)) for (const cb of multisets(codesOf, kb)) {
    yield { rows: [...ca.map((c, i) => row(i + 1, 'Name A', c)), ...cb.map((c, i) => row(ka + i + 1, 'Name B', c))], label: `A ${JSON.stringify(ca)} B ${JSON.stringify(cb)}` }
  }
}
function* spellings(names: readonly string[], codes: readonly string[]): Generator<World> {
  const spec: Array<[string, string]> = []
  for (const n of names) for (const c of codes) spec.push([n, c])
  for (const k of [2, 3, 4]) for (const combo of multisets(spec.map((_, i) => i), k)) {
    yield { rows: combo.map((i, at) => row(at + 1, spec[i][0], spec[i][1])), label: `rows ${JSON.stringify(combo.map((i) => spec[i]))}` }
  }
}
const innerSpace = () => spellings(['Probe Name', 'Probe  Name'], ['', REAL, OTHER])
const nameSpellings = () => spellings(['Probe Name', 'probe name', ' Probe Name', 'Probe Name ', 'Probe  Name', `Probe Name${TAB}`, `Pr${String.fromCharCode(0xf3)}be Name`, `PR${String.fromCharCode(0xd3)}BE NAME`], ['', REAL, OTHER])
function* threeNames(): Generator<World> {
  const codes = ['', REAL, `0${REAL}`, '601', '0601', OTHER]
  for (const ca of multisets(codes, 2)) for (const cb of multisets(codes, 2)) for (const cc of multisets(codes, 2)) {
    yield { rows: [...ca.map((c, i) => row(i + 1, 'Name A', c)), ...cb.map((c, i) => row(i + 3, 'Name B', c)), ...cc.map((c, i) => row(i + 5, 'Name C', c))], label: `A ${JSON.stringify(ca)} B ${JSON.stringify(cb)} C ${JSON.stringify(cc)}` }
  }
}
const padded = () => twoNames([' 0601', '0601', '601 ', 'ABC1', 'abc1', ' ABC1', REAL, ` ${REAL}`])

type Totals = {
  worlds: number; pairs: number; failures: string[]
  laneLost: number; controlLost: number // separate pairs (no row in the clicked group) that lost their tag or listing
  extraLost: number // a pair the production click keeps, lost by this click
  overlapLost: number // a pair that shares a row with the clicked group, has a row outside it, and lost BOTH tag and listing
  offeredDifferent: number // a clicked group the production index does not offer, or one it offers that this index does not
  falsePlain: number; falseStill: number; stillListedToasts: number; plainToasts: number
}

const REAL_TRANSPORT = read('components/shared/twinDismissalsTransport.ts')
const REAL_PLAN = read('utils/exactDuplicateProducts.ts')
const edit = (source: string, from: string, to: string, name: string): string => { assert.ok(source.includes(from), `mutant "${name}" no longer matches the source (stale mutant)`); return source.replace(from, () => to) }

// The TRUE control is production before this lane (main's exactDuplicateProducts.ts buildExactDuplicateIndex and its Keep both): the index buckets a barcode cluster by the COLLAPSING
// name key (normalizeProductGroupName, the key the Products list groups by), and Keep both dismisses the pair's barcode cluster and nothing else. It is written out here, not taken from
// the module under test, so that a change to the module's index or plan shows up as a difference from it.
function controlIndex(clusters: Array<{ type: string; value: string; products: Array<{ id: number; name: string | null }> }>): Map<number, { key: string; barcode: string; members: Array<{ id: number }> }> {
  const index = new Map<number, { key: string; barcode: string; members: Array<{ id: number }> }>()
  for (const cluster of clusters) {
    if (cluster.type !== 'barcode') continue
    const barcode = String(cluster.value || '').trim()
    if (!barcode) continue
    const byName = new Map<string, Array<{ id: number }>>()
    for (const product of cluster.products || []) {
      const nameKey = grouping.normalizeProductGroupName(product?.name || '')
      if (!nameKey) continue
      if (!byName.has(nameKey)) byName.set(nameKey, [])
      byName.get(nameKey)!.push(product)
    }
    for (const [nameKey, members] of byName) {
      if (members.length < 2) continue
      const info = { key: `${barcode}|${nameKey}`, barcode, members }
      for (const member of members) index.set(Number(member.id), info)
    }
  }
  return index
}
const CONTROL_PLAN = { keepBothPlan: (_clusters: unknown, _ids: unknown, barcode: string) => ({ rulings: [{ type: 'barcode', value: barcode }], stillListed: false }) }

let current: { rows: Row[]; dismissals: Dismissal[] } = { rows: [], dismissals: [] }
function build(sources: Sources, controlPlan = false) {
  const plan = sources.plan ? compile(sources.plan, (id) => (id.endsWith('productGrouping.ts') ? grouping : id.endsWith('productDetailRule.ts') ? detail : (() => { throw new Error(`unexpected require ${id}`) })())) : exact
  const transport = compile(sources.transport ?? REAL_TRANSPORT, (id) => {
    if (id.endsWith('http.ts')) return { apiFetch: async () => ({ dismissals: await sweep.listTwinDismissals(fakeDb(current.rows, current.dismissals)) }) }
    if (id.endsWith('productWriteTransport.ts')) {
      return { dismissProductDuplicateCluster: async (type: string, value: string) => { current.dismissals.push({ cluster_type: type, cluster_value: sweep.normalizeProductClusterKey(type, value) }); return { success: true } } }
    }
    if (id.endsWith('productTwinDismissals.ts')) return store
    if (id.endsWith('exactDuplicateProducts.ts')) return controlPlan ? CONTROL_PLAN : plan
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
const uniqueGroups = <T extends { key: string; members: Array<{ id: number }> }>(index: Map<number, T>): Map<string, T> => { const out = new Map<string, T>(); for (const info of index.values()) out.set(info.key, info); return out }
const idsOf = (info: { members: Array<{ id: number }> }): number[] => info.members.map((m) => Number(m.id)).sort((a, b) => a - b)

// Every world: the groups the module offers Keep both on must be exactly the groups production offers. Each one is clicked through the real handler, and the same group through the
// control (production's click). What the person is left with must be
//   1. no worse than the control for any other twin pair: a pair the control keeps may never be lost, and a pair that shares no row with the clicked group but sits in no group the
//      control would have clicked together with it is collateral the control does not have,
//   2. the toast true in both directions.
async function exhaustive(worlds: Iterable<World>, sources: Sources = {}): Promise<Totals> {
  const t: Totals = { worlds: 0, pairs: 0, failures: [], laneLost: 0, controlLost: 0, extraLost: 0, overlapLost: 0, offeredDifferent: 0, falsePlain: 0, falseStill: 0, stillListedToasts: 0, plainToasts: 0 }
  const note = (message: string) => { if (t.failures.length < 6) t.failures.push(message) }
  const lane = build(sources)
  const control = build({}, true)
  for (const world of worlds) {
    t.worlds += 1
    const { rows } = world
    const L0 = await sweep.findPossiblySameProductClusters(fakeDb(rows, []))
    store.setTwinDismissals(store.NO_TWIN_DISMISSALS)
    const T0 = twinClusters(rows).filter((T) => holds(L0, T))
    const payload = lane.plan.extractDuplicateClusters({ clusters: L0 })
    const laneGroups = uniqueGroups(lane.plan.buildExactDuplicateIndex(payload) as Map<number, any>)
    const ctlIndex = controlIndex(payload)
    const ctlGroups = uniqueGroups(ctlIndex)
    const sameSet = (a: Map<string, any>, b: Map<string, any>) => a.size === b.size && [...a.keys()].every((k) => b.has(k) && idsOf(a.get(k)).join() === idsOf(b.get(k)).join())
    if (!sameSet(laneGroups, ctlGroups)) {
      t.offeredDifferent += 1
      note(`Keep both is offered on ${JSON.stringify([...laneGroups.values()].map(idsOf))}, production offers ${JSON.stringify([...ctlGroups.values()].map(idsOf))}: ${world.label}`)
    }
    for (const info of laneGroups.values()) {
      t.pairs += 1
      const ids = idsOf(info)
      const ctlInfo = ctlIndex.get(ids[0])
      const ctlIds = ctlInfo ? idsOf(ctlInfo) : ids
      const click = async (transport: any, group: any, toasts: string[]) => {
        current = { rows, dismissals: [] }
        store.setTwinDismissals(store.NO_TWIN_DISMISSALS)
        await transport.keepBothDuplicate(payload, group, (m: string) => toasts.push(m), (key: string) => key, async () => {})
        const LS = await sweep.findPossiblySameProductClusters(fakeDb(rows, current.dismissals))
        const TS = twinClusters(rows)
        const lost = new Set<string>(), both = new Set<string>()
        for (const T of T0) {
          const untagged = !TS.some((x) => x.join() === T.join()), unlisted = !holds(LS, T)
          if (untagged || unlisted) lost.add(T.join())
          if (untagged && unlisted) both.add(T.join())
        }
        return { LS, TS, lost, both, ruled: current.dismissals.map((d) => `${d.cluster_type}:${d.cluster_value}`) }
      }
      const ctl = await click(control.transport, ctlInfo || info, [])
      const toasts: string[] = []
      const got = await click(lane.transport, info, toasts)
      const where = `${world.label}, Keep both on ${ids} (production group ${ctlIds}), ruled ${JSON.stringify(got.ruled)}`
      // 1. nothing the production click keeps may be lost; a pair the production group holds but this group does not is collateral too
      for (const key of got.lost) {
        const T = key.split(',').map(Number)
        if (T.every((id) => ids.includes(id))) continue // the clicked group's own tag and listing are what Keep both ends
        const overlaps = T.some((id) => ids.includes(id))
        const insideControlGroup = T.every((id) => ctlIds.includes(id))
        if (overlaps) { if (got.both.has(key)) t.overlapLost += 1 } else t.laneLost += 1
        if (!ctl.lost.has(key) || insideControlGroup) { t.extraLost += 1; note(`${overlaps ? 'an overlapping' : 'a separate'} pair ${key} lost its tag or its listing, which the production click keeps: ${where}`) }
      }
      for (const key of ctl.lost) if (!key.split(',').some((id) => ctlIds.includes(Number(id)))) t.controlLost += 1
      // 2. the toast is true
      const listedTogether = got.LS.some((c: any) => c.type !== 'barcode' && c.type !== 'similar' && c.products.filter((p: { id: number }) => ids.includes(Number(p.id))).length >= 2)
      const flaggedIndex = exact.buildExactDuplicateIndex(exact.extractDuplicateClusters({ clusters: got.LS }))
      const flagged = ids.some((id) => flaggedIndex.has(id))
      const tagged = got.TS.some((x) => ids.filter((id) => x.includes(id)).length >= 2)
      if (toasts.length !== 1) { note(`${toasts.length} toasts: ${where}`); continue }
      if (toasts[0] === 'product_duplicate_kept_both') {
        t.plainToasts += 1
        if (flagged || tagged || listedTogether) { t.falsePlain += 1; note(`"no longer flagged" but the group is still flagged (index ${flagged}, tag ${tagged}, two or more listed together ${listedTogether}): ${where}`) }
      } else if (toasts[0] === 'product_duplicate_kept_still_listed') {
        t.stillListedToasts += 1
        if (!listedTogether) { t.falseStill += 1; note(`"still in a group" but no name or leading-zero cluster lists two or more of them: ${where}`) }
      } else note(`unexpected toast ${toasts[0]}: ${where}`)
    }
  }
  store.setTwinDismissals(store.NO_TWIN_DISMISSALS)
  return t
}

const DOMAINS: Array<[string, () => Iterable<World>, { worlds: number; pairs: number }]> = [
  ['A one name', oneName, { worlds: 2800, pairs: 1700 }],
  ['B two names', () => twoNames(), { worlds: 24000, pairs: 16000 }],
  ['C inner spaces', innerSpace, { worlds: 200, pairs: 100 }],
  ['D three names', threeNames, { worlds: 9000, pairs: 5000 }],
  ['E name spellings', nameSpellings, { worlds: 8000, pairs: 5000 }],
  ['F padded codes', padded, { worlds: 24000, pairs: 20000 }],
]
const real: Record<string, Totals> = {}
for (const [name, make, floor] of DOMAINS) {
  const r = await exhaustive(make())
  real[name] = r
  assert.deepEqual(r.failures, [], `the real handler, domain ${name}`)
  assert.equal(r.offeredDifferent, 0, `domain ${name}: Keep both is offered on exactly the groups production offers`)
  assert.equal(r.extraLost, 0, `domain ${name}: no pair the production click keeps is lost`)
  assert.equal(r.overlapLost, 0, `domain ${name}: no overlapping pair loses its tag and its listing`)
  assert.equal(r.falsePlain + r.falseStill, 0, `domain ${name}: no false toast of either kind`)
  assert.equal(r.laneLost, r.controlLost, `domain ${name}: collateral ${r.laneLost} equals the production click's ${r.controlLost}`)
  assert.ok(r.worlds >= floor.worlds && r.pairs >= floor.pairs, `domain ${name}: swept ${r.worlds} worlds, ${r.pairs} pairs (the sweep must stay exhaustive)`)
  assert.ok(r.stillListedToasts + r.plainToasts === r.pairs, `domain ${name}: every pair gets one toast`)
}
assert.ok(real['B two names'].controlLost > 0, 'the cross-name barcode ruling production already has is present in the control, so the comparison is not vacuous')
assert.ok(real['E name spellings'].stillListedToasts > 0 && real['E name spellings'].plainToasts > 0, 'both toasts are exercised in the spellings domain')

// Mutants edit the real sources and must each turn a BEHAVIOURAL check red (a different offered group, a loss the production click does not have, or a false toast), never a count.
const mutants: Array<{ name: string; sources: Sources }> = []
const EACH = "const stillListed = clusters.some((cluster) => (cluster.type === 'name' || cluster.type === 'leadingzero')\n    && (cluster.products || []).filter((product) => wanted.has(Number(product?.id))).length >= 2)"
const KEY = "const nameKey = normalizeProductGroupName(product?.name || '')"
mutants.push({ name: 'round 8 key: the resolver groups names as the Worker keys them (E1)', sources: { plan: edit(REAL_PLAN, KEY, 'const nameKey = serverNameKey(product?.name)', 'serverNameKey').replace("import { normalizeProductGroupName }", 'import { normalizeProductGroupName, serverNameKey }') } })
mutants.push({ name: 'stillListed only when ONE cluster holds every member (the collapsing key alone)', sources: { plan: edit(REAL_PLAN, '.length >= 2)', '.length >= wanted.size)', 'all members') } })
mutants.push({ name: 'stillListed ignores leading-zero clusters', sources: { plan: edit(REAL_PLAN, "(cluster.type === 'name' || cluster.type === 'leadingzero')", "cluster.type === 'name'", 'no leading zero') } })
mutants.push({ name: 'stillListed ignores name clusters', sources: { plan: edit(REAL_PLAN, "(cluster.type === 'name' || cluster.type === 'leadingzero')", "cluster.type === 'leadingzero'", 'no name') } })
mutants.push({ name: 'never reports still listed', sources: { plan: edit(REAL_PLAN, EACH, 'const stillListed = false', 'never') } })
mutants.push({ name: 'always reports still listed', sources: { plan: edit(REAL_PLAN, EACH, 'const stillListed = true', 'always') } })
mutants.push({ name: 'also rules every name and leading-zero cluster that lists the pair (round 6)', sources: { plan: edit(REAL_PLAN, "return { rulings: [{ type: 'barcode', value: barcode }], stillListed }", "return { rulings: [{ type: 'barcode', value: barcode }, ...clustersListingProducts(clusters, ids).filter((ruling) => ruling.type !== 'barcode')], stillListed }", 'whole') } })
mutants.push({ name: "the pair's barcode is not ruled", sources: { plan: edit(REAL_PLAN, "return { rulings: [{ type: 'barcode', value: barcode }], stillListed }", 'return { rulings: [], stillListed }', 'no barcode') } })
mutants.push({ name: 'toast inverted', sources: { transport: edit(REAL_TRANSPORT, 'notify(stillListed ?', 'notify(!stillListed ?', 'inverted') } })
mutants.push({ name: 'always the plain toast', sources: { transport: edit(REAL_TRANSPORT, 'notify(stillListed ?', 'notify(false ?', 'plain') } })
mutants.push({ name: 'always the still-listed toast', sources: { transport: edit(REAL_TRANSPORT, 'notify(stillListed ?', 'notify(true ?', 'still') } })
const killedBy: string[] = []
for (const mutant of mutants) {
  const results: Totals[] = []
  for (const [, make] of DOMAINS) results.push(await exhaustive(make(), mutant.sources))
  assert.ok(results.some((r) => r.offeredDifferent > 0 || r.extraLost > 0 || r.overlapLost > 0 || r.falsePlain > 0 || r.falseStill > 0), `mutant survived (no behavioural check went red): ${mutant.name}`)
  killedBy.push(`${mutant.name}: ${results.map((r) => `${r.offeredDifferent}/${r.extraLost}/${r.overlapLost}/${r.falsePlain}/${r.falseStill}`).join(' ')}`)
}
const line = (name: string, r: Totals) => `${name} ${r.worlds}w ${r.pairs}p collateral ${r.laneLost}=${r.controlLost}`
console.log(`keepBothNarrow: ${Object.entries(real).map(([n, r]) => line(n, r)).join('; ')}; 0 offered-group differences, 0 extra losses, 0 overlap losses, 0 false toasts; ${mutants.length} mutants killed`)
if (process.env.KEEP_BOTH_VERBOSE) console.log(`offered/extra/overlap/falsePlain/falseStill per domain A-F\n${killedBy.join('\n')}`)
