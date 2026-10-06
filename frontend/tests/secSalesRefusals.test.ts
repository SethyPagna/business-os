// SEC-SALES (loophole review 2026-10-06): every new POST /api/sales refusal
// the till can meet is restated from the language pack by its stable code,
// so a Khmer till never shows the Worker's English.
//
// For each code this pins three things that must move together: the Worker
// still answers it (source of the refusal), both packs carry a real
// translation, and saleSubmitErrors.ts maps the code to that key. Dropping
// any one leaves the cashier with an English or generic error.
//
// Run: node tests/secSalesRefusals.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND = path.resolve(here, '..')
const WORKER_SRC = path.resolve(here, '..', '..', 'cloudflare', 'src')

type Pack = Record<string, unknown>
const readPack = (name: string): Pack => JSON.parse(fs.readFileSync(path.join(FRONTEND, 'src', 'lang', `${name}.json`), 'utf8')) as Pack
const EN = readPack('en')
const KM = readPack('km')
const workerSource = (rel: string) => fs.readFileSync(path.join(WORKER_SRC, rel), 'utf8')

function loadModule(rel: string): Record<string, any> {
  const code = transformSync(fs.readFileSync(path.join(FRONTEND, 'src', rel), 'utf8'), { loader: 'ts', format: 'cjs' }).code
  const mod = { exports: {} as Record<string, any> }
  new Function('module', 'exports', 'require', code)(mod, mod.exports, (request: string) => { throw new Error(`unexpected import ${request}`) })
  return mod.exports
}
const { saleSubmitRefusalText } = loadModule('api/saleSubmitErrors.ts')

// code -> the Worker file that defines the refusal (where the literal lives).
const REFUSALS: Array<{ code: string; workerFile: string }> = [
  { code: 'exchange_rate_out_of_range', workerFile: 'lib/saleExchangeRateBand.ts' },
]

const failures: string[] = []
function runCase(name: string, body: () => void) {
  try { body(); console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.log(`FAIL ${name}\n  ${String((error as Error)?.message || error)}`) }
}

for (const { code, workerFile } of REFUSALS) {
  runCase(`${code}: the Worker answers it`, () => {
    assert.ok(workerSource(workerFile).includes(`'${code}'`), `${workerFile} defines '${code}'`)
  })
  runCase(`${code}: both packs translate it`, () => {
    assert.equal(typeof EN[code], 'string', `en.json has ${code}`)
    const khmer = String(KM[code] || '')
    assert.match(khmer, /[ក-៿]/, `km.json ${code} is Khmer`)
    assert.notEqual(khmer, EN[code])
  })
  for (const [language, pack] of [['en', EN], ['km', KM]] as const) {
    runCase(`${code}: restated from the ${language} pack`, () => {
      const t = (key: string) => (typeof pack[key] === 'string' ? String(pack[key]) : undefined)
      const error = Object.assign(new Error('worker english'), { status: 409, code })
      assert.equal(saleSubmitRefusalText(error, t), pack[code])
    })
  }
}

if (failures.length) {
  console.error(`\n${failures.length} failing case(s)`)
  process.exit(1)
}
