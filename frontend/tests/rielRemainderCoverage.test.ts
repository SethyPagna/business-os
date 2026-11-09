// A riel payment that leaves under 100 riel unpaid is fully paid (owner ruling, 27 Oct 2026; lane 6.0.982).
//
// The POS gate and status picker, the settlement editor's Outstanding row and the Worker all ask the one coverage
// answer in utils/saleStatusResolution.ts (held byte-identical to the Worker's by saleStatusResolutionParity). A $10
// sale at 4,000 is 40,000 riel: 39,901 riel is paid, 39,900 riel still owes 100 riel, and a USD-only tender keeps the
// half-cent band. Each rule is also run against a mutant of the source, and each mutant must turn its check red.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

type Patch = { file: string; from: string; to: string }
const require = createRequire(import.meta.url)

async function load<T>(entry: string, patches: Patch[] = []): Promise<T> {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
    plugins: [{ name: 'mutants', setup(builder) {
      builder.onLoad({ filter: /\.ts$/ }, (args) => {
        const mine = patches.filter((patch) => args.path.replace(/\\/g, '/').endsWith(patch.file))
        if (!mine.length) return undefined
        let text = fs.readFileSync(args.path, 'utf8').replace(/\r\n/g, '\n')
        for (const patch of mine) {
          assert.equal(text.split(patch.from).length, 2, `mutant anchor must occur once in ${patch.file}`)
          text = text.replace(patch.from, () => patch.to)
        }
        return { contents: text, loader: 'ts' }
      })
    } }],
  })
  const module = { exports: {} as T }
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports)
  return module.exports
}

type Resolution = typeof import('../src/utils/saleStatusResolution.ts')
type Settlement = typeof import('../src/components/sales/saleSettlement.ts')
const sale = { totalUsd: 10, exchangeRate: 4000, moneyPrecisionVersion: 1 }

function ruleHolds(R: Resolution, S: Settlement): string | null {
  try {
    // 99 riel short: paid, owing nothing, a Not Paid request resolves to Completed (the POS status).
    assert.equal(R.paymentCoversSaleTotal({ ...sale, paidUsd: 0, paidKhr: 39901 }), true, '39,901 riel covers a $10 sale')
    assert.equal(R.saleOutstandingUsd({ ...sale, paidUsd: 0, paidKhr: 39901 }), 0, '39,901 riel owes nothing')
    assert.equal(R.resolvePaidSaleStatus({ ...sale, requestedStatus: 'awaiting_payment', paidUsd: 0, paidKhr: 39901, isDelivery: false }), 'completed')
    // Mixed: $9 + 3,901 riel is also 99 riel short.
    assert.equal(R.paymentCoversSaleTotal({ ...sale, paidUsd: 9, paidKhr: 3901 }), true, 'a mixed tender 99 riel short is paid')
    // 100 riel short: still owes $0.025.
    assert.equal(R.paymentCoversSaleTotal({ ...sale, paidUsd: 0, paidKhr: 39900 }), false, '39,900 riel does not cover')
    assert.equal(R.saleOutstandingUsd({ ...sale, paidUsd: 0, paidKhr: 39900 }), 0.025)
    assert.equal(R.resolvePaidSaleStatus({ ...sale, requestedStatus: 'awaiting_payment', paidUsd: 0, paidKhr: 39900, isDelivery: false }), 'awaiting_payment')
    // USD only keeps the half-cent band: $9.99 owes a cent.
    assert.equal(R.paymentCoversSaleTotal({ ...sale, paidUsd: 9.99, paidKhr: 0 }), false, 'a USD tender a cent short is not paid')
    // The settlement editor's Outstanding row (settle, instalment and correction forms).
    const rows = (khr: string) => [{ id: 'settlement-new', method: 'Cash', usd: '', khr }]
    assert.equal(S.settlementOutstandingUsd(rows('39901'), sale as never), 0, 'the settlement form shows nothing outstanding at 99 riel short')
    assert.equal(S.settlementOutstandingUsd(rows('39900'), sale as never), 0.025, 'the settlement form shows the 100-riel remainder')
    return null
  } catch (error) {
    return String((error as Error).message).split('\n')[0].slice(0, 160)
  }
}

const R = await load<Resolution>('../src/utils/saleStatusResolution.ts')
const S = await load<Settlement>('../src/components/sales/saleSettlement.ts')
assert.equal(ruleHolds(R, S), null, `the riel remainder rule: ${ruleHolds(R, S)}`)
console.log('PASS 99 riel short is paid (POS status, outstanding, settlement form); 100 riel short owes; USD keeps the half-cent band')

const FILE = 'src/utils/saleStatusResolution.ts'
const RULE = 'return paidKhrUnits > 0n && scaled < RIEL_REMAINDER_ACCEPTED_KHR_UNITS * ratio.denominator'
for (const mutant of [
  { name: 'riel rule dropped', patches: [{ file: FILE, from: RULE, to: 'return false' }] },
  { name: '100 riel short counted as paid', patches: [{ file: FILE, from: RULE, to: 'return paidKhrUnits > 0n && scaled <= RIEL_REMAINDER_ACCEPTED_KHR_UNITS * ratio.denominator' }] },
  { name: 'rule applied to USD-only tenders', patches: [{ file: FILE, from: RULE, to: 'return scaled < RIEL_REMAINDER_ACCEPTED_KHR_UNITS * ratio.denominator' }] },
]) {
  const result = ruleHolds(await load<Resolution>('../src/utils/saleStatusResolution.ts', mutant.patches), await load<Settlement>('../src/components/sales/saleSettlement.ts', mutant.patches))
  assert.notEqual(result, null, `mutant "${mutant.name}" must turn the check red`)
  console.log(`PASS mutant "${mutant.name}" is caught: ${result}`)
}
