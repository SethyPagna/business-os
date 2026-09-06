// Tax settings must be read the SAME way by the till (this package's
// src/utils/taxSettings.ts) and the Worker's amendment engine
// (cloudflare/src/lib/saleAmendments.ts, resolveTaxSettings). taxSettings.ts
// names this pairing explicitly and says changing one of the two without the
// other "is the bug this pairing exists to prevent" -- but until this file,
// nothing enforced it: only cloudflare/scripts/test-sale-amendments-pure.cjs
// exercised the Worker copy, and no frontend test imported taxSettings.ts at
// all, so the two could silently diverge (e.g. one side learning a new
// off-token like 'disabled') without any test noticing.
//
// This test feeds one case table of raw setting values to BOTH
// implementations and asserts they resolve to the identical {enabled, rate}
// shape. resolveTaxSettings has no external module dependencies, so it is
// extracted and transpiled standalone -- the same extract/transpile approach
// tests/feeLabelClamp.test.ts uses for a client-side cap, and the Worker's
// own pure tests use for every function under cloudflare/src/lib.
//
// Run: node tests/taxSettingsParity.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { resolveTaxEnabled, resolveTaxRate } from '../src/utils/taxSettings.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const workerSource = fs.readFileSync(
  path.resolve(here, '..', '..', 'cloudflare', 'src', 'lib', 'saleAmendments.ts'),
  'utf8',
)

function extractFunction(source: string, name: string): string {
  const re = new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`)
  const match = source.match(re)
  assert.ok(match, `${name} not found in saleAmendments.ts -- source may have changed`)
  return match![0]
}

const combined = extractFunction(workerSource, 'resolveTaxSettings') + '\nexport { resolveTaxSettings }\n'
const { outputText } = ts.transpileModule(combined, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'resolve-tax-settings.ts',
})
type WorkerTaxSettings = { enabled: boolean; rate: number }
const moduleObj: { exports: { resolveTaxSettings: (rawEnabled: unknown, rawRate: unknown) => WorkerTaxSettings } } =
  { exports: { resolveTaxSettings: null as unknown as (rawEnabled: unknown, rawRate: unknown) => WorkerTaxSettings } }
new Function('exports', outputText)(moduleObj.exports)
const workerResolveTaxSettings = moduleObj.exports.resolveTaxSettings
assert.equal(typeof workerResolveTaxSettings, 'function', 'resolveTaxSettings must extract to a callable function')

// One case table shared by both implementations: every off-token the switch
// itself recognizes, plus on-tokens, unrecognised near-miss tokens that MUST
// still read as on on both sides (a side quietly learning one of these as a
// new off-token is exactly the drift this pairing exists to prevent), the
// absent/blank key, and rates given as a whole percent, a fraction, blank,
// garbage, negative, and above-100% (a one-sided clamp must not go unnoticed).
const enabledCases: unknown[] = [
  '0', 'false', 'off', 'no', // exact off-tokens
  'FALSE', 'Off', 'NO', ' no ', // case- and whitespace-insensitive off-tokens
  '', // absent key -> falls back to the rate
  'true', 'TRUE', '1', 'yes', 'enabled', // anything else reads as on
  // Unrecognised tokens that are near-misses for "off" but are NOT in either
  // side's off-token list -- both sides must read these as ON. If one side
  // ever grows a wider off-token list than the other, these are what catch it.
  'disabled', 'none', 'n', 'DISABLED',
  undefined, null,
]
const rateCases: unknown[] = [
  '10', '7.5', // percent strings
  '0.1', // a fraction typed where a percent is expected -- still just text to both sides
  '0', '', // no rate
  'abc', // garbage
  '-5', // negative
  ' 12 ', // padded
  '150', // above 100% -- a one-sided clamp to 100 must be caught
  '0.5', '10.005', // sub-1-percent and fractional-percent precision
  undefined, null,
]

let compared = 0
for (const rawEnabled of enabledCases) {
  for (const rawRate of rateCases) {
    const fromWorker = workerResolveTaxSettings(rawEnabled, rawRate)
    const fromClient = { enabled: resolveTaxEnabled(rawEnabled, rawRate), rate: resolveTaxRate(rawRate) }
    assert.deepStrictEqual(
      fromClient,
      fromWorker,
      `till and Worker disagree for rawEnabled=${JSON.stringify(rawEnabled)} rawRate=${JSON.stringify(rawRate)}: `
        + `client=${JSON.stringify(fromClient)} worker=${JSON.stringify(fromWorker)}`,
    )
    compared += 1
  }
}
// A literal floor, not `enabledCases.length * rateCases.length` -- comparing
// the loop counter against the product of the very arrays the loop walks can
// never fail, even if the case table is gutted to one entry. This number
// must be updated deliberately if the table is intentionally narrowed.
assert.ok(compared >= 160, `only ${compared} combinations compared -- the case table was narrowed`)

console.log(`PASS tax settings parity: till and Worker agree on ${compared} enabled/rate combinations`)
