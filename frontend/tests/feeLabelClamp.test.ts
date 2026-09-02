// Fee/expense label caps: FeeForm.tsx clamps the label live (6 words /
// 60 chars) and routes/fees.ts enforces the same cap server-side. This
// test pins BOTH the client clamp's behavior and the client<->server cap
// parity, extracting the pure functions from source the same way the
// cloudflare pure tests do (FeeForm.tsx builds a React component at module
// load, so importing it here is not an option).
//
// Run: node tests/feeLabelClamp.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientSource = fs.readFileSync(path.join(here, '..', 'src', 'components', 'fees', 'FeeForm.tsx'), 'utf8')
const serverSource = fs.readFileSync(path.join(here, '..', '..', 'cloudflare', 'src', 'routes', 'fees.ts'), 'utf8')
const feesPageSource = fs.readFileSync(path.join(here, '..', 'src', 'components', 'fees', 'FeesPage.tsx'), 'utf8').replace(/\r\n/g, '\n')
const feesTransportSource = fs.readFileSync(path.join(here, '..', 'src', 'api', 'feesTransport.ts'), 'utf8').replace(/\r\n/g, '\n')
const expenseLabelManagerSource = fs.readFileSync(path.join(here, '..', 'src', 'components', 'fees', 'ExpenseLabelManagerModal.tsx'), 'utf8').replace(/\r\n/g, '\n')
const expenseReportSource = fs.readFileSync(path.join(here, '..', 'src', 'components', 'sales', 'FeesReportSection.tsx'), 'utf8').replace(/\r\n/g, '\n')

function extractFunction(source: string, name: string): string {
  const re = new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`)
  const match = source.match(re)
  assert.ok(match, `${name} not found -- source may have changed`)
  return match![0]
}

function extractNumericConst(source: string, name: string): number {
  const re = new RegExp(`const ${name} = (\\d+)`)
  const match = source.match(re)
  assert.ok(match, `${name} not found -- source may have changed`)
  return Number(match![1])
}

const clientWords = extractNumericConst(clientSource, 'FEE_LABEL_MAX_WORDS')
const clientChars = extractNumericConst(clientSource, 'FEE_LABEL_MAX_CHARS')

const combined = `const FEE_LABEL_MAX_WORDS = ${clientWords}\nconst FEE_LABEL_MAX_CHARS = ${clientChars}\n`
  + extractFunction(clientSource, 'clampFeeLabel') + '\n'
  + extractFunction(clientSource, 'feeLabelWordCount') + '\n'
  + 'export { clampFeeLabel, feeLabelWordCount }\n'

const { outputText } = ts.transpileModule(combined, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'fee-label-clamp.ts',
})
const moduleObj: { exports: Record<string, (value: string) => string | number> } = { exports: {} }
new Function('exports', outputText)(moduleObj.exports)
const clampFeeLabel = moduleObj.exports.clampFeeLabel as (value: string) => string
const feeLabelWordCount = moduleObj.exports.feeLabelWordCount as (value: string) => number

let passed = 0
function check(name: string, fn: () => void): void {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

check('client and server enforce the SAME word/char caps', () => {
  assert.strictEqual(extractNumericConst(serverSource, 'FEE_LABEL_MAX_WORDS'), clientWords)
  assert.strictEqual(extractNumericConst(serverSource, 'FEE_LABEL_MAX_CHARS'), clientChars)
})

check('clampFeeLabel cuts a sentence down to the word cap', () => {
  assert.strictEqual(
    clampFeeLabel('one two three four five six seven eight nine'),
    'one two three four five six',
  )
})

check('clampFeeLabel keeps a trailing space (a word in progress) but trims the lead', () => {
  assert.strictEqual(clampFeeLabel('Grab '), 'Grab ')
  assert.strictEqual(clampFeeLabel('   Grab'), 'Grab')
})

check('clampFeeLabel enforces the char cap (bounds unspaced Khmer too)', () => {
  assert.strictEqual(clampFeeLabel('a'.repeat(200)).length, clientChars)
  // Short real labels round-trip untouched.
  for (const label of ['Capital Express', 'ទឹកភ្លើង', 'J&T Express', 'ប្រាក់ខែបុគ្គលិក']) {
    assert.strictEqual(clampFeeLabel(label), label)
  }
})

check('feeLabelWordCount counts words, ignoring extra whitespace', () => {
  assert.strictEqual(feeLabelWordCount(''), 0)
  assert.strictEqual(feeLabelWordCount('  '), 0)
  assert.strictEqual(feeLabelWordCount(' a  b '), 2)
  assert.strictEqual(feeLabelWordCount('one two three four five six'), 6)
})

check('Expenses export covers visible, filtered-all, and all-record scopes with paginated loading', () => {
  const builderSource = extractFunction(feesPageSource, 'buildFeeExportRows')
  const transpiled = ts.transpileModule(`${builderSource}\nmodule.exports = { buildFeeExportRows }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exportModule: { exports: { buildFeeExportRows?: (rows: unknown[], label: (type: string) => string) => Array<Record<string, unknown>> } } = { exports: {} }
  new Function('exports', 'module', transpiled)(exportModule.exports, exportModule)
  const rows = exportModule.exports.buildFeeExportRows!([{
    fee_date: '2026-09-01', fee_type: 'delivery', label: 'Grab', amount_usd: 2.5,
    amount_khr: 0, sale_receipt_number: 'R-7', branch_name: 'Shop', notes: 'Courier',
    created_by_name: 'Dara', created_at: '2026-09-01T02:00:00Z',
  }], (type) => type.toUpperCase())
  assert.deepStrictEqual(rows, [{
    date: '2026-09-01', type: 'DELIVERY', label: 'Grab', amount_usd: 2.5,
    amount_khr: 0, sale_receipt: 'R-7', branch: 'Shop', notes: 'Courier',
    created_by: 'Dara', created_at: '2026-09-01T02:00:00Z',
  }])
  assert.match(feesTransportSource, /export async function getAllFeesForExport/)
  assert.match(feesTransportSource, /const PAGE = 500/)
  assert.match(feesTransportSource, /offset \+= PAGE/)
  assert.match(feesPageSource, /openFeeExport\('visible'\)/)
  assert.match(feesPageSource, /openFeeExport\('filtered'\)/)
  assert.match(feesPageSource, /openFeeExport\('all'\)/)
  assert.match(feesPageSource, /<ExportOptionsDialog/)
})

check('Expenses keeps reliable filtered paging and responsive dense rows', () => {
  assert.match(feesPageSource, /const nextPage = clampPage\(page, nextResult\.total, pageSize\)/, 'deleted or filtered final pages must clamp from the server total')
  assert.match(feesPageSource, /if \(nextPage !== page\)[\s\S]*setPage\(nextPage\)[\s\S]*return[\s\S]*setResult\(nextResult\)/, 'valid-page loading must happen before accepting stale empty rows')
  assert.match(feesPageSource, /rangeAsPageSize[\s\S]*page=\{page\}[\s\S]*totalItems=\{result\.total\}/, 'Back, Next, page and page-size must use filtered totals')
  assert.match(feesPageSource, /\.\.\.\(branchFilter \? \{ branchId: branchFilter \} : \{\}\)/, 'report totals must follow the branch filter')
  assert.match(feesPageSource, /className="dense-data-table min-w-\[720px\]"/, 'desktop must use the shared dense table')
  assert.match(feesPageSource, /dense-data-shell hidden overflow-x-auto md:block/, 'the table must start at the safe desktop breakpoint')
  assert.match(feesPageSource, /space-y-2 md:hidden/, 'mobile must retain dedicated cards')
  assert.match(feesPageSource, /data-tone="violet"[\s\S]*data-tone="blue"[\s\S]*data-tone="emerald"/, 'type, category and amount headers must use semantic tones')
})

check('saved expense labels are the one editable category source', () => {
  assert.match(expenseLabelManagerSource, /getFeeLabelTypeImpact\(entry\.label\)/, 'category changes must preview linked records')
  assert.match(expenseLabelManagerSource, /classifyFeeLabel\(entry\.label, feeType\)/, 'the saved-label manager must own category changes')
  assert.match(expenseLabelManagerSource, /source label and audit history remain unchanged/i, 'the confirmation must explain preserved history')
  assert.match(feesTransportSource, /\/api\/fees\/labels\/classify/, 'classification must use the wired label endpoint')
  assert.match(expenseReportSource, /by_category/, 'the Reports surface must expose category totals')
  assert.match(expenseReportSource, /expenses-report-/, 'user-facing filenames must use Expenses vocabulary')
})

console.log(`\nfeeLabelClamp: ${passed} check(s) passed.`)
