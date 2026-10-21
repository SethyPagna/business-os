// Client/server parity for the Add Product "already exists" preview (lane 6.0.940, item D).
//
// The Worker folds Khmer digits ០-៩ to 0-9 on every typed barcode save (digits only: no trim, no case change, no
// leading-zero strip; names and SKUs are never folded). The form's identity preview used to compare the raw typed
// value, so a barcode typed on the Khmer keyboard layout was previewed as a brand-new product while the server
// saved it onto the existing one. The preview and the lookup behind it now use the folded value; the value the
// form SENDS stays as typed (the server folds it).
//
// Run: node tests/createMatchKhmerDigits.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, propsOf } from './mountedComponentHarness.ts'
import { classifyCreateMatches, type CreateMatchCandidate } from '../src/components/products/helpers/productCreateMatch.ts'

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// ០១២៣៤៥៦៧៨៩ = 0123456789
const khmer = (digits: string): string => [...digits].map((digit) => (/\d/.test(digit) ? String.fromCharCode(0x17e0 + Number(digit)) : digit)).join('')

const ASCII_BARCODE = '8801234567890'
const rows: CreateMatchCandidate[] = [
  { id: 1, name: 'Aloe Vera Gel', barcode: ASCII_BARCODE, selling_price_usd: 5.5 },
  { id: 2, name: 'Rose Water Toner', barcode: '7700012345', selling_price_usd: 4 },
  { id: 3, name: '123 Serum', barcode: '' },
]

await runTest('a Khmer-digit barcode equal to an existing ASCII barcode is previewed as that product', () => {
  const typed = khmer(ASCII_BARCODE)
  assert.notEqual(typed, ASCII_BARCODE, 'the fixture really is Khmer digits')
  const other = classifyCreateMatches({ name: 'A different name', barcode: typed }, rows)
  assert.equal(other.kind, 'barcode_match')
  assert.equal(other.primary?.id, 1)
  assert.equal(other.allowProceedAsNew, true)
  const same = classifyCreateMatches({ name: 'Aloe Vera Gel', barcode: typed }, rows)
  assert.equal(same.kind, 'exact_twin', 'same name + same barcode is an exact twin, as for the ASCII digits')
  assert.equal(same.primary?.id, 1)
  assert.equal(same.allowProceedAsNew, false)
})

await runTest('the Khmer and ASCII spellings give the same verdict, and ASCII input is untouched', () => {
  for (const name of ['A different name', 'Aloe Vera Gel', '']) {
    const fromKhmer = classifyCreateMatches({ name, barcode: khmer(ASCII_BARCODE) }, rows)
    const fromAscii = classifyCreateMatches({ name, barcode: ASCII_BARCODE }, rows)
    assert.deepEqual(fromKhmer, fromAscii, `name ${JSON.stringify(name)}`)
  }
  assert.equal(classifyCreateMatches({ name: 'x', barcode: '4006381333931' }, rows).kind, null)
})

await runTest('the fold is digits only: leading zeros still fold through identity, letters and short codes stay unreal', () => {
  const padded = classifyCreateMatches({ name: 'Other', barcode: khmer(`00${ASCII_BARCODE}`) }, rows)
  assert.equal(padded.primary?.id, 1, 'identity (not the digit fold) is what folds past leading zeros')
  assert.equal(classifyCreateMatches({ name: 'Other', barcode: khmer('7700012') }, rows).kind, null, 'a prefix of a barcode is not that barcode')
  assert.equal(classifyCreateMatches({ name: 'Other', barcode: `AB${khmer('7700012345')}` }, rows).kind, null, 'letters make it a word, not a barcode')
  assert.equal(classifyCreateMatches({ name: 'Other', barcode: khmer('880') }, rows).kind, null, 'three digits is not a real barcode')
})

await runTest('a Khmer-digit NAME is never folded: it does not match its ASCII twin, and still matches itself', () => {
  const khmerName = `${khmer('123')} Serum`
  assert.equal(classifyCreateMatches({ name: khmerName }, rows).kind, null, '"១២៣ Serum" is not "123 Serum"')
  const control = classifyCreateMatches({ name: '123 Serum' }, rows)
  assert.equal(control.primary?.id, 3, 'control: the ASCII name does match its row (an empty typed barcode is a wildcard inside a name group)')
  const twins: CreateMatchCandidate[] = [{ id: 9, name: khmerName, barcode: '' }]
  assert.equal(classifyCreateMatches({ name: khmerName }, twins).kind, 'exact_twin', 'the same Khmer name still matches itself')
})

// ---- the real form: the lookup it sends and the hint it shows ----

const queries: string[] = []
const harness = await createHarness({ observe: ['api/methods.ts'] })
try {
  const user = { id: 1, organization_id: 1, role_code: 'admin', role_permissions: { all: true } }
  const app = { user, page: 'products', t: () => '', notify() {}, settings: {}, language: 'en', can: () => true, hasPermission: () => true, getPermissionTier: () => 'all', canWriteToServer: true }
  const props = { product: null, categories: [], units: [], branches: [], user, t: () => '', usdSymbol: '$', khrSymbol: '៛', exchangeRate: 4100, onClose() {}, onSave: async () => ({ success: true }) }
  let forms = 0
  async function mountForm(answer: (query: string) => CreateMatchCandidate[]) {
    queries.length = 0
    // Its own draft each time: an unmounted form leaves what was typed in the draft store, and the next one restores it.
    forms += 1
    return harness.mount({
      component: 'components/products/forms/ProductForm.tsx', props: { ...props, draftScope: `khmer-digits-${forms}` }, app,
      doubles: { 'api/methods.ts': {
        searchProducts: async (params: { query?: string }) => { queries.push(String(params.query)); return { items: answer(String(params.query)) } },
        getProductFilters: async () => ({ categories: [], brands: [] }),
      } },
    })
  }
  const typeInto = async (form: Awaited<ReturnType<typeof mountForm>>, id: string, value: string): Promise<void> => {
    await form.type(form.find((node) => node.id === id, id), value)
    await form.settle()
  }

  await runTest('form: a Khmer-digit barcode asks the catalog for the ASCII barcode and previews the product it will really match', async () => {
    const form = await mountForm(() => [rows[0]])
    try {
      await typeInto(form, 'product-barcode', khmer(ASCII_BARCODE))
      assert.deepEqual(queries, [ASCII_BARCODE], 'the lookup carries the folded barcode, never the Khmer digits')
      assert.ok(form.text().includes('This barcode is already on "Aloe Vera Gel".'), 'the hint names the existing product')
      assert.equal(propsOf(form.field('product-barcode')).value, khmer(ASCII_BARCODE), 'the field keeps what was typed (the server folds it)')
    } finally {
      await form.unmount()
    }
  })

  await runTest('form: a Khmer-digit name is looked up as typed and not folded onto its ASCII twin', async () => {
    const form = await mountForm(() => [rows[2]])
    try {
      await typeInto(form, 'product-name', `${khmer('123')} Serum`)
      assert.deepEqual(queries, [`${khmer('123')} Serum`], 'the name lookup is the raw name')
      assert.ok(!form.text().includes('This name already exists'), 'no "name exists" hint for a different name')
    } finally {
      await form.unmount()
    }
  })
} finally {
  await harness.close()
}

await runTest('the preview helper folds only through foldNativeDigits, and the form folds its lookup the same way', () => {
  const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const helper = read('../src/components/products/helpers/productCreateMatch.ts')
  assert.match(helper, /import \{ foldNativeDigits \} from '\.\.\/\.\.\/\.\.\/utils\/searchMatch\.ts'/)
  assert.equal((helper.match(/typed\.barcode/g) || []).length, 1, 'every use of the typed barcode goes through the folded value')
  const form = read('../src/components/products/forms/ProductForm.tsx')
  assert.match(form, /const barcode = foldNativeDigits\(form\.barcode\)\.trim\(\)/)
  assert.doesNotMatch(form, /foldNativeDigits\(form\.name\)/, 'names are never folded')
})

if (failed > 0) process.exitCode = 1
