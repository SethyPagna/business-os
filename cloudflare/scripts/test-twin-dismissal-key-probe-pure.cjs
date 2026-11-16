'use strict'
// Review r5, M1, as an exhaustive probe over the REAL Worker sweep, the REAL dismissals read and the REAL client rule (no route, no D1: a fake database serves the rows
// the sweep's own SELECTs ask for, with the name_key SQLite's lower(trim(name)) gives, which is what the 0010 triggers store).
//
//   M1  "Keep both" must be able to clear the tag. For every small name group, every Conflicts cluster the sweep lists is dismissed the way POST
//       /possible-duplicates/dismiss stores it (normalizeProductClusterKey over the cluster's own value); the tag must then be gone from the rows. Names: no inner
//       space, an inner run of spaces, an accented capital, Khmer with an inner run. A dismissal key that collapsed whitespace or folded accents (the old key) leaves
//       most inner-space and accent cases tagged for ever, which the control below turns red.
//
// Run (from cloudflare/scripts): node test-twin-dismissal-key-probe-pure.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { build } = require('esbuild')

const CF = path.join(__dirname, '..')
const FRONTEND = path.join(__dirname, '../../frontend')
const sqlite = new DatabaseSync(':memory:')
const nameKeyStatement = sqlite.prepare('SELECT lower(trim(?)) AS k')
const nameKeys = new Map()
const nameKeyOf = (name) => { if (!nameKeys.has(name)) nameKeys.set(name, nameKeyStatement.get(name).k); return nameKeys.get(name) }

async function bundle(contents, resolveDir, patches = []) {
  const patcher = { name: 'patches', setup(b) {
    b.onLoad({ filter: /\.ts$/ }, (args) => {
      let text = require('node:fs').readFileSync(args.path, 'utf8').replace(/\r\n/g, '\n')
      for (const [from, to] of patches) if (text.includes(from)) text = text.replace(from, () => to)
      return { contents: text, loader: 'ts' }
    })
  } }
  const out = await build({ stdin: { contents, resolveDir, loader: 'ts' }, plugins: [patcher], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022', logLevel: 'error' })
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', out.outputFiles[0].text)(require, mod, mod.exports)
  return mod.exports
}

const REAL = '8851234567890'
const DOMAIN = ['', '0', 'Mask', 'NoBox188', '601', '0601', '00601', '12345', REAL, '0' + REAL, ' ' + REAL, '8859999999999']
const subsets = (list) => list.reduce((all, item) => all.concat(all.map((set) => [...set, item])), [[]])
function multisets(domain, size, start = 0) {
  if (!size) return [[]]
  const out = []
  for (let i = start; i < domain.length; i += 1) for (const rest of multisets(domain, size - 1, i)) out.push([domain[i], ...rest])
  return out
}
const fakeDb = (rows, dismissals) => ({ prepare(sql) { return { all: async () => {
  if (/FROM products p/.test(sql)) return rows.map((r) => ({ id: r.id, name: r.name, barcode: r.barcode, cost_price_usd: 0, cost_price_khr: 0, selling_price_usd: 0, stock_quantity: r.stock_quantity, image_path: null, name_key: nameKeyOf(r.name) }))
  if (/product_duplicate_dismissals WHERE cluster_type IN/.test(sql)) return dismissals.filter((d) => ['name', 'barcode', 'leadingzero'].includes(d.cluster_type)).sort((a, b) => (`${a.cluster_type}\u0001${a.cluster_value}` < `${b.cluster_type}\u0001${b.cluster_value}` ? -1 : 1))
  if (/product_duplicate_dismissals/.test(sql)) return dismissals
  throw new Error(`unexpected sql ${sql}`)
} } } })
const holds = (clusters, ids) => clusters.some((cluster) => ids.every((id) => cluster.products.some((p) => Number(p.id) === id)))

async function main() {
  const load = async (identityPatches) => ({
    identity: await bundle("export * from './lib/productIdentity.ts'", path.join(CF, 'src'), identityPatches),
    client: await bundle("export * from './utils/productGrouping.ts'\nexport * from './utils/productTwinDismissals.ts'\n", path.join(FRONTEND, 'src')),
  })
  const { identity, client } = await load([])
  const twinClusters = (items) => {
    const keys = client.unmergedTwinKeys(items)
    const byKey = new Map()
    items.forEach((item, index) => { if (keys[index]) byKey.set(keys[index], [...(byKey.get(keys[index]) || []), item.id]) })
    return [...byKey.values()].map((ids) => ids.sort((a, b) => a - b))
  }
  const rowsOf = (name, codes, stock) => codes.map((barcode, index) => ({ id: index + 1, name, barcode, stock_quantity: stock(index, codes.length), is_active: 1, is_group: 0 }))
  const stockPatterns = [(i) => (i === 0 ? 9 : 0), (i, n) => (i === n - 1 ? 9 : 0)]
  let failed = 0
  const check = async (name, fn) => { try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.log(`FAIL ${name}\n  ${String(error && error.stack || error).split('\n').slice(0, 8).join('\n  ')}`) } }

  // Every listed cluster dismissed through `keyOf` (the dismiss route's key): the groups that are still tagged afterwards.
  async function stillTagged(name, keyOf, api = { identity, client }) {
    let cases = 0
    const stuck = []
    for (const size of [2, 3]) {
      for (const codes of multisets(DOMAIN, size)) {
        for (const stock of stockPatterns) {
          cases += 1
          const rows = rowsOf(name, codes, stock)
          const listed = await api.identity.findPossiblySameProductClusters(fakeDb(rows, []))
          const dismissals = listed.map((cluster) => ({ cluster_type: cluster.type, cluster_value: keyOf(api.identity, cluster.type, cluster.value) }))
          api.client.setTwinDismissals(api.client.parseTwinDismissals({ dismissals: await api.identity.listTwinDismissals(fakeDb(rows, dismissals)) }))
          const tagged = twinClusters(rows)
          if (tagged.length) stuck.push(`${JSON.stringify(codes)} stock ${JSON.stringify(rows.map((r) => r.stock_quantity))}: still tagged ${JSON.stringify(tagged)}, still listed ${JSON.stringify((await api.identity.findPossiblySameProductClusters(fakeDb(rows, dismissals))).map((c) => `${c.type}:${c.value}`))}`)
        }
      }
    }
    api.client.setTwinDismissals(api.client.NO_TWIN_DISMISSALS)
    return { cases, stuck }
  }
  const routeKey = (id, type, value) => id.normalizeProductClusterKey(type, value)

  const NAMES = ['Probe Name', 'Probe  Name', 'Probe\tName', 'Crème Éclat', 'ក្រែម  លាប', '  Padded Name  ']
  for (const name of NAMES) {
    await check(`Keep both on every listed cluster clears the tag for ${JSON.stringify(name)} (name_key ${JSON.stringify(nameKeyOf(name))}), over every group of 2 and 3 rows`, async () => {
      const { cases, stuck } = await stillTagged(name, routeKey)
      assert.ok(cases > 800, `cases ${cases}`)
      assert.deepEqual(stuck.slice(0, 3), [], `${stuck.length} of ${cases} cases stay tagged`)
    })
  }

  await check('the dismiss key of a name is the products.name_key column itself (SQLite lower(trim(name))): the same for every name above and for the edge cases', async () => {
    for (const name of [...NAMES, 'A', ' a ', 'MiXeD  CaSe', ' Nbsp ', 'Tab\there', 'Line\nbreak', 'ÀÉÎ', 'ᏣᎳᎩ']) assert.equal(identity.normalizeProductClusterKey('name', name), nameKeyOf(name), JSON.stringify(name))
    // The sweep sends the raw display name of a cluster as its value, and a cluster key is echoed back unchanged by the tab: the key is its own fixed point.
    for (const name of NAMES) assert.equal(identity.normalizeProductClusterKey('name', identity.normalizeProductClusterKey('name', name)), identity.normalizeProductClusterKey('name', name))
  })

  await check('CONTROL, the old key (whitespace collapsed, JS lower-case) leaves inner-space, tab, accent and Khmer names tagged after every cluster is dismissed, and not the plain name', async () => {
    const detailRule = await bundle("export * from './lib/productDetailRule.ts'", path.join(CF, 'src'))
    const old = (id, type, value) => (type === 'name' ? detailRule.normalizeProductGroupName(value) : id.normalizeProductClusterKey(type, value))
    const patched = identity
    const plain = await stillTagged('Probe Name', old, { identity: patched, client })
    assert.equal(plain.stuck.length, 0, 'the plain name is cleared by either key')
    for (const name of ['Probe  Name', 'Crème Éclat', 'ក្រែម  លាប']) {
      const result = await stillTagged(name, old, { identity: patched, client })
      assert.ok(result.stuck.length > 0, `the old key must leave ${JSON.stringify(name)} stuck (it did not, so this probe cannot tell the keys apart)`)
    }
  })

  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
  process.exitCode = failed ? 1 : 0
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
