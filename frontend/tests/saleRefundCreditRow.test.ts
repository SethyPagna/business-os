// The exchange refund credit row in the payment forms (lane 6.0.982, release review P2 "no trap").
//
// A replacement sale's tender holds a refund_credit row (not money the customer handed over). The Worker
// (cloudflare/src/lib/paymentSettlement.ts) refuses a settlement or a payment correction that drops or alters it
// (refund_credit_row_required) and accepts it with its STORED method even when that method is no longer configured.
// So the form must carry the row locked, labelled, and send it back exactly as stored -- in correction mode too,
// where every other row is editable. Before this, the cash method renamed to "Cash USD" trapped staff: the form
// refused the stored "Cash" credit, and changing it to "Cash USD" was refused by the Worker.
//
// End to end: the form's rows -> its issue check -> its payload -> the Worker's real planner (bundled from source).
// Every check also runs against a mutant of the source it depends on, and each mutant must turn that check red.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

type Patch = { file: string; from: string; to: string }
const require = createRequire(import.meta.url)

async function load<T>(entry: string, patches: Patch[] = [], external: string[] = []): Promise<T> {
  const entryPath = fileURLToPath(new URL(entry, import.meta.url))
  const bundle = await build({
    entryPoints: [entryPath], bundle: true, platform: 'node', format: 'cjs', write: false, external, logLevel: 'silent',
    plugins: [{ name: 'mutants', setup(builder) {
      builder.onLoad({ filter: /\.(ts|tsx)$/ }, (args) => {
        const mine = patches.filter((patch) => args.path.replace(/\\/g, '/').endsWith(patch.file))
        if (!mine.length) return undefined
        let text = fs.readFileSync(args.path, 'utf8').replace(/\r\n/g, '\n')
        for (const patch of mine) {
          assert.equal(text.split(patch.from).length, 2, `mutant anchor must occur once in ${patch.file}: ${patch.from.slice(0, 80)}`)
          text = text.replace(patch.from, () => patch.to)
        }
        return { contents: text, loader: args.path.endsWith('x') ? 'tsx' : 'ts' }
      })
    } }],
  })
  const module = { exports: {} as T }
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports)
  return module.exports
}

type Settlement = typeof import('../src/components/sales/saleSettlement.ts')
type Planner = typeof import('../../cloudflare/src/lib/paymentSettlement.ts')
const planner = await load<Planner>('../../cloudflare/src/lib/paymentSettlement.ts')

// A replacement sale: $5.1234 refund credit stored under "Cash", then $11 ABA. Cash has since been renamed "Cash USD".
const STORED = '[{"method":"Cash","amount_usd":5.1234,"amount_khr":0,"refund_credit":true},{"method":"ABA","amount_usd":11,"amount_khr":0}]'
const CONFIGURED = ['Cash USD', 'ABA']
const TOTAL = 16.1234

function failure(error: unknown): string {
  const code = (error as { code?: string }).code
  return String(code && code !== 'ERR_ASSERTION' ? code : (error as Error).message).split('\n')[0].slice(0, 160)
}

function correctionEndToEnd(S: Settlement): string | null {
  try {
    const rows = S.initialSettlementRows({ paymentDetails: STORED, amountPaidUsd: 16.1234, amountPaidKhr: 0, totalUsd: TOTAL, exchangeRate: 4000, moneyPrecisionVersion: 1, configuredMethods: CONFIGURED })
    const credit = rows.find((row) => row.refundCredit === true)
    assert.ok(credit, 'the credit row carries its flag into the form')
    assert.equal(credit.method, 'Cash', 'the credit keeps its stored method')
    // The cashier corrects the $11: ABA was wrong, it was paid in cash.
    const corrected = rows.map((row) => row.refundCredit ? row : { ...row, method: 'Cash USD' })
    assert.equal(S.settlementRowsIssue(corrected, CONFIGURED, true), null, 'correction mode accepts the stored credit row')
    const payload = S.buildSettlementPayload(corrected, CONFIGURED, true)
    assert.ok(payload)
    assert.deepEqual(payload.payment_details[0], { method: 'Cash', amount_usd: 5.1234, amount_khr: 0, refund_credit: true }, 'the credit is sent exactly as stored')
    // The Worker, as the correction route calls it: the credit rows are the recorded payment the request must repeat.
    const plan = planner.planSaleSettlement({
      moneyPrecisionVersion: 1, configuredMethodsRaw: JSON.stringify(CONFIGURED), paymentDetailsRaw: payload.payment_details,
      existingPaidUsd: 5.1234, existingPaidKhr: 0, existingPaymentDetailsRaw: '[{"method":"Cash","amount_usd":5.1234,"amount_khr":0,"refund_credit":true}]',
      totalUsd: TOTAL, exchangeRate: 4000,
    })
    assert.deepEqual(plan.paymentDetails, [{ refund_credit: true, method: 'Cash', amount_usd: 5.1234, amount_khr: 0 }, { method: 'Cash USD', amount_usd: 11, amount_khr: 0 }])
    assert.deepEqual(plan.addedDetails, [{ method: 'Cash USD', amount_usd: 11, amount_khr: 0 }])
    return null
  } catch (error) {
    return failure(error)
  }
}

function settleKeepsCredit(S: Settlement): string | null {
  // Not Paid replacement sale (credit only), settled with a new row: the credit is sent as stored there too.
  try {
    const stored = '[{"method":"Cash","amount_usd":5.1234,"amount_khr":0,"refund_credit":true}]'
    const rows = S.initialSettlementRows({ paymentDetails: stored, amountPaidUsd: 5.1234, amountPaidKhr: 0, totalUsd: TOTAL, exchangeRate: 4000, moneyPrecisionVersion: 1, configuredMethods: CONFIGURED })
    assert.equal(S.settlementRowsIssue(rows, CONFIGURED, false), null)
    const payload = S.buildSettlementPayload(rows, CONFIGURED, false)
    assert.ok(payload)
    planner.planSaleSettlement({ moneyPrecisionVersion: 1, configuredMethodsRaw: JSON.stringify(CONFIGURED), paymentDetailsRaw: payload.payment_details,
      existingPaidUsd: 5.1234, existingPaidKhr: 0, existingPaymentDetailsRaw: stored, totalUsd: TOTAL, exchangeRate: 4000 })
    return null
  } catch (error) {
    return failure(error)
  }
}

type EditorModule = { default: React.ComponentType<Record<string, unknown>> }
function editorLocksCredit(Editor: EditorModule['default'], S: Settlement): string | null {
  const rows = S.initialSettlementRows({ paymentDetails: STORED, amountPaidUsd: 16.1234, amountPaidKhr: 0, totalUsd: TOTAL, exchangeRate: 4000, moneyPrecisionVersion: 1, configuredMethods: CONFIGURED })
  const problems: string[] = []
  for (const allowRecordedEdits of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(Editor, {
      rows, configuredMethods: CONFIGURED, exchangeRate: 4000, totalUsd: TOTAL, moneyPrecisionVersion: 1, saving: false, error: '', recordedIssue: null,
      allowRecordedEdits, translate: (_key: string, english: string) => english, fmtUSD: (value: unknown) => `$${value}`, fmtKHR: (value: unknown) => `${value}៛`, onChange: () => {},
    }))
    const tag = (pattern: RegExp) => html.match(pattern)?.[0] ?? ''
    // The attribute, not the class: the buttons carry a disabled:opacity-40 utility class.
    const isDisabled = (element: string) => {
      assert.ok(element, 'the control is rendered')
      return / disabled=""/.test(element)
    }
    const creditUsd = tag(/<input[^>]*aria-label="Cash USD 1"[^>]*>/)
    const creditKhr = tag(/<input[^>]*aria-label="Cash KHR 1"[^>]*>/)
    const creditRemove = tag(/<button[^>]*aria-label="Remove Cash"[^>]*>/)
    const abaUsd = tag(/<input[^>]*aria-label="ABA USD 2"[^>]*>/)
    if (!html.includes('Refund credit')) problems.push(`${allowRecordedEdits}: no Refund credit label`)
    if (!isDisabled(creditUsd) || !isDisabled(creditKhr)) problems.push(`${allowRecordedEdits}: credit amounts editable`)
    if (!isDisabled(creditRemove)) problems.push(`${allowRecordedEdits}: credit row removable`)
    // Control: in correction mode the customer's row IS editable (the lock is the credit's, not the whole form's).
    if (allowRecordedEdits && isDisabled(abaUsd)) problems.push('correction mode locked the customer row too')
    if (/Choose an active configured payment method/.test(html)) problems.push(`${allowRecordedEdits}: the credit's retired method is flagged`)
  }
  return problems.length ? problems.join('; ') : null
}

const S = await load<Settlement>('../src/components/sales/saleSettlement.ts')
const Editor = (await load<EditorModule>('../src/components/sales/SaleSettlementEditor.tsx', [], ['react', 'react-dom'])).default

assert.equal(correctionEndToEnd(S), null, `correction with a renamed cash method succeeds end to end: ${correctionEndToEnd(S)}`)
console.log('PASS a correction after the cash method was renamed carries the credit as stored and the Worker planner accepts it')
assert.equal(settleKeepsCredit(S), null, `settling keeps the credit: ${settleKeepsCredit(S)}`)
console.log('PASS settling a credit-only sale sends the credit as stored (4 decimals, stored method)')
assert.equal(editorLocksCredit(Editor, S), null, `the editor locks the credit row: ${editorLocksCredit(Editor, S)}`)
console.log('PASS the credit row is labelled "Refund credit" and locked in settle and correction mode; the customer row stays editable')

// Mutation controls: each must turn its check red.
const SETTLEMENT = 'src/components/sales/saleSettlement.ts'
const EDITOR = 'src/components/sales/SaleSettlementEditor.tsx'
const mutants: Array<{ name: string; patches: Patch[]; check: 'correction' | 'settle' | 'editor' }> = [
  { name: 'flag not carried into the form', check: 'correction', patches: [{ file: SETTLEMENT, from: '      ...(refundCredit ? { refundCredit: true as const } : {}),\n', to: '' }] },
  { name: 'issue check treats the credit as a new row', check: 'correction', patches: [{ file: SETTLEMENT, from: 'const recorded = row.refundCredit === true || (row.id.startsWith', to: 'const recorded = (row.id.startsWith' }] },
  { name: 'payload rounds the credit to cents', check: 'correction', patches: [{ file: SETTLEMENT, from: 'amount_usd: roundUsd(amount(row.usd)), amount_khr: roundLegacyKhr(amount(row.khr)), refund_credit: true as const }', to: 'amount_usd: Math.round(amount(row.usd) * 100) / 100, amount_khr: roundLegacyKhr(amount(row.khr)), refund_credit: true as const }' }] },
  { name: 'payload rounds the credit to cents (settle)', check: 'settle', patches: [{ file: SETTLEMENT, from: 'amount_usd: roundUsd(amount(row.usd)), amount_khr: roundLegacyKhr(amount(row.khr)), refund_credit: true as const }', to: 'amount_usd: Math.round(amount(row.usd) * 100) / 100, amount_khr: roundLegacyKhr(amount(row.khr)), refund_credit: true as const }' }] },
  { name: 'editor unlocks the credit in correction mode', check: 'editor', patches: [{ file: EDITOR, from: 'const locked = row.refundCredit === true || (', to: 'const locked = (' }] },
  { name: 'editor lets the credit be removed', check: 'editor', patches: [{ file: EDITOR, from: 'disabled={saving || row.refundCredit === true || (', to: 'disabled={saving || (' }] },
  { name: 'editor drops the Refund credit label', check: 'editor', patches: [{ file: EDITOR, from: "translate('sale_refund_credit_row', 'Refund credit', 'ឥណទានសងវិញ')", to: "translate('recorded', 'Recorded', 'បានកត់ត្រា')" }] },
]
for (const mutant of mutants) {
  const mutatedS = await load<Settlement>('../src/components/sales/saleSettlement.ts', mutant.patches)
  const result = mutant.check === 'correction' ? correctionEndToEnd(mutatedS)
    : mutant.check === 'settle' ? settleKeepsCredit(mutatedS)
      : editorLocksCredit((await load<EditorModule>('../src/components/sales/SaleSettlementEditor.tsx', mutant.patches, ['react', 'react-dom'])).default, mutatedS)
  assert.notEqual(result, null, `mutant "${mutant.name}" must turn the ${mutant.check} check red`)
  console.log(`PASS mutant "${mutant.name}" is caught: ${result}`)
}
