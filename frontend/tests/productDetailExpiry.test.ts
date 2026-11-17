import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHarness, type MountedSurface } from './mountedComponentHarness.ts'
import { offsetDate } from '../src/utils/dateHelpers.ts'

// Owner rules: dates render dd/mm/yyyy, every word goes through both language packs. The shared ProductDetailModal (Products AND Inventory) printed the expiry as yyyy-mm-dd with an English "d"
// suffix and had lost the tiering the retired Inventory detail float had (Expired / Expires soon). This mounts the REAL modal with no extra props (exactly Products' call) and pins the date, the
// translated days-left, and the three tiers around their edges (-1, 0, 30, 31 days), in English and in Khmer from the real packs.

const pack = (name: string) => JSON.parse(fs.readFileSync(new URL(`../src/lang/${name}.json`, import.meta.url), 'utf8')) as Record<string, string>
const en = pack('en')
const km = pack('km')
const harness = await createHarness({})
const money = (value: unknown) => `$${Number(value).toFixed(2)}`
const app = { user: { id: 1, role_code: 'admin', permissions: {} }, getPermissionTier: () => 'full', can: () => false, t: (key: string) => key, settings: {} }
const live: MountedSurface[] = []
const dmy = (iso: string) => iso.split('-').reverse().join('/')
// The modal draws into a body-level portal, so a surface left mounted would be found by the next lookup: one at a time.
const mount = async (expiry: string, lang: Record<string, string> | null) => {
  for (const old of live.splice(0)) await old.unmount()
  const surface = await harness.mount({
    component: 'components/products/surfaces/ProductDetailModal.tsx',
    props: { p: { id: 41, name: 'Synthetic serum', unit: 'pcs', stock_quantity: 7, selling_price_usd: 12.5, expiry_date: expiry }, fmtUSD: money, fmtKHR: (v: unknown) => `${v}៛`, onClose: () => {}, ...(lang ? { t: (key: string) => lang[key] } : {}) },
    app,
    doubles: {},
  })
  live.push(surface)
  return surface
}
const expiryNode = (surface: MountedSurface) => surface.find(node => node.getAttribute('data-expiry') !== null, 'expiry value')
const flat = (surface: MountedSurface) => expiryNode(surface).textContent.replace(/\s+/g, ' ').trim()

const cases: Array<[string, () => Promise<void>]> = [
  ['the date is dd/mm/yyyy, never yyyy-mm-dd, with a translated days-left that has no bare English "d" in Khmer', async () => {
    const day = offsetDate(120)
    const english = await mount(day, en)
    assert.equal(flat(english), `${dmy(day)} 120d`, flat(english))
    assert.ok(!english.text().includes(day), 'the ISO form is nowhere on the sheet')
    const khmer = await mount(day, km)
    assert.equal(flat(khmer), `${dmy(day)} 120 ថ្ងៃ`, flat(khmer))
    assert.ok(!/\dd\b/.test(flat(khmer)), 'no English d suffix on a Khmer sheet')
  }],
  ['a datetime expiry keeps its date part, and an unparseable value is shown as typed with no days and no false tier', async () => {
    const day = offsetDate(90)
    assert.equal(flat(await mount(`${day} 00:00:00`, en)), `${dmy(day)} 90d`)
    const odd = await mount('soon-ish', en)
    assert.equal(flat(odd), 'soon-ish')
    assert.equal(expiryNode(odd).getAttribute('data-expiry'), 'ok')
  }],
  ['tiers: -1 Expired (red), 0 and 30 Expires soon (amber), 31 plain; the words come from the packs', async () => {
    for (const [offset, tier, english, khmer] of [
      [-1, 'expired', 'Expired · 1d', 'ផុតកំណត់ហើយ · 1 ថ្ងៃ'],
      [0, 'soon', 'Expires soon · 0d', 'ជិតផុតកំណត់ · 0 ថ្ងៃ'],
      [30, 'soon', 'Expires soon · 30d', 'ជិតផុតកំណត់ · 30 ថ្ងៃ'],
      [31, 'ok', '31d', '31 ថ្ងៃ'],
    ] as const) {
      const day = offsetDate(offset)
      const e = await mount(day, en)
      assert.equal(expiryNode(e).getAttribute('data-expiry'), tier, `en ${offset}`)
      assert.equal(flat(e), `${dmy(day)} ${english}`, `en ${offset}`)
      const cls = expiryNode(e).getAttribute('class') ?? ''
      assert.equal(tier === 'expired' ? cls.includes('text-red-600') : tier === 'soon' ? cls.includes('text-amber-600') : cls === '', true, `colour for ${tier}: "${cls}"`)
      assert.equal(flat(await mount(day, km)), `${dmy(day)} ${khmer}`, `km ${offset}`)
    }
  }],
  ['without a pack the English fallbacks still read the same (Products on a missing key)', async () => {
    const day = offsetDate(10)
    assert.equal(flat(await mount(day, null)), `${dmy(day)} Expires soon · 10d`)
  }],
]

const failures: string[] = []
try {
  for (const [name, run] of cases) {
    try { await run() } catch (cause) { failures.push(`${name}\n    ${(cause instanceof Error ? cause.message : String(cause)).split('\n').slice(0, 8).join(' | ')}`) } finally { for (const surface of live.splice(0)) await surface.unmount() }
  }
} finally { await harness.close() }
if (failures.length) throw new Error(`${failures.length} of ${cases.length} expiry cases failed:\n  - ${failures.join('\n  - ')}`)
console.log(`productDetailExpiry passed: ${cases.length} cases (dd/mm/yyyy, translated days, Expired / Expires soon tiers, en + km)`)
