import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

// delivery_contact_missing: the Worker refuses a sale (409) or an expense (400) whose delivery person was deleted. Both the till and the
// expense form restate it from the language packs (en + km), never the server's English.
const here = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND = path.resolve(here, '..')
const WORKER = path.resolve(here, '..', '..', 'cloudflare')
const pack = (name: string) => JSON.parse(fs.readFileSync(path.join(FRONTEND, 'src', 'lang', `${name}.json`), 'utf8')) as Record<string, string>
const EN = pack('en'); const KM = pack('km')

function load(rel: string, mutate: (s: string) => string = (s) => s): Record<string, any> {
  const source = mutate(fs.readFileSync(path.join(FRONTEND, 'src', rel), 'utf8').split('\r\n').join('\n'))
  const code = transformSync(source, { loader: 'ts', format: 'cjs' }).code
  const mod = { exports: {} as Record<string, any> }
  new Function('module', 'exports', 'require', code)(mod, mod.exports, (r: string) => { throw new Error('unexpected import ' + r) })
  return mod.exports
}

const refusal = Object.assign(new Error('That delivery driver no longer exists. Choose another driver.'), { code: 'delivery_contact_missing' })
function checks(sale: Record<string, any>, fees: Record<string, any>) {
  for (const [name, p] of [['en', EN], ['km', KM]] as const) {
    assert.ok(p.delivery_contact_missing && (name === 'en' || /\p{Script=Khmer}/u.test(p.delivery_contact_missing)), `${name}: pack text exists`)
    assert.equal(sale.saleSubmitRefusalText(refusal, (k: string) => p[k]), p.delivery_contact_missing, `${name}: till shows the pack text`)
    assert.equal(fees.catalogRefusalText(refusal, (k: string, f: string) => p[k] || f), p.delivery_contact_missing, `${name}: expense form shows the pack text`)
  }
}
checks(load('api/saleSubmitErrors.ts'), load('components/fees/expenseCatalogErrors.ts'))

// Mutants: dropping either mapping must be caught.
assert.throws(() => checks(load('api/saleSubmitErrors.ts', (s) => s.replace("  'delivery_contact_missing',\n", '')), load('components/fees/expenseCatalogErrors.ts')), 'till mapping removed')
assert.throws(() => checks(load('api/saleSubmitErrors.ts'), load('components/fees/expenseCatalogErrors.ts', (s) => s.replace(/  delivery_contact_missing: \[[^\n]*\n/, ''))), 'fee mapping removed')

// The code is what the Worker actually sends.
const sales = fs.readFileSync(path.join(WORKER, 'src/routes/sales.ts'), 'utf8')
const fees = fs.readFileSync(path.join(WORKER, 'src/routes/fees.ts'), 'utf8')
assert.ok(/DELIVERY_CONTACT_MISSING_CODE/.test(sales) && /DELIVERY_CONTACT_MISSING_CODE/.test(fees))
assert.ok(/DELIVERY_CONTACT_MISSING_CODE = 'delivery_contact_missing'/.test(fs.readFileSync(path.join(WORKER, 'src/lib/contactDeleteGuard.ts'), 'utf8')))
console.log('deliveryMissingRefusal: ok')
