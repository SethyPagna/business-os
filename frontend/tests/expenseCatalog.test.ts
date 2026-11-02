// Lane 6.0.1053: the Expenses page manages its own labels and types, and also lists the courier cost recorded on sales.
// Pins (1) the pure transport helpers for the type choices and the create body, (2) the translated refusals, (3) the list/export
// helpers for sale rows, (4) the shape of the manager, the types section and the page (what each surface may and may not offer),
// (5) both language packs. The Worker half is pinned by cloudflare/scripts/test-fees-catalog-native.cjs and
// test-expenses-sale-rows-native.cjs.
//
// Run: node tests/expenseCatalog.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripTypeScriptTypes } from 'node:module'
import {
  BUILTIN_FEE_TYPES,
  FEE_TYPE_NAME_MAX_CHARS,
  feeTypeChoices,
  feeTypeIsChoosable,
  normalizeFeeCreateBody,
  type FeeTypeEntry,
} from '../src/api/feesTransport.ts'
import { catalogFailureText, catalogRefusalText } from '../src/components/fees/expenseCatalogErrors.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => fs.readFileSync(path.resolve(here, relative), 'utf8').replace(/\r\n/g, '\n')
const page = read('../src/components/fees/FeesPage.tsx')
const form = read('../src/components/fees/FeeForm.tsx')
const manager = read('../src/components/fees/ExpenseLabelManagerModal.tsx')
const typesSection = read('../src/components/fees/ExpenseTypesSection.tsx')
const transport = read('../src/api/feesTransport.ts')
const editor = read('../src/components/shared/ReasonListEditor.tsx')

let passed = 0
function check(name: string, run: () => void) { run(); passed += 1; console.log(`PASS ${name}`) }

const entry = (value: string, extra: Partial<FeeTypeEntry> = {}): FeeTypeEntry => ({ value, name: value, builtin: false, id: 1, registered: true, archived: false, ...extra })

// ---------------------------------------------------------------- 1. type choices and the create body
check('the picker offers the five built-in types, then the active custom ones, never an archived one', () => {
  const choices = feeTypeChoices([entry('Rent'), entry('Old', { archived: true }), entry('tax', { builtin: true, id: null })])
  assert.deepEqual(choices.map((c) => c.value), [...BUILTIN_FEE_TYPES, 'Rent'])
  assert.deepEqual(choices.filter((c) => !c.builtin).map((c) => c.value), ['Rent'])
})
check('the type an open expense already carries stays selectable even when archived or unknown (editing never drops it)', () => {
  assert.ok(feeTypeChoices([entry('Old', { archived: true })], 'Old').some((c) => c.value === 'Old'))
  assert.ok(feeTypeChoices(null, 'Legacy').some((c) => c.value === 'Legacy'))
  assert.equal(feeTypeChoices(null, 'delivery').filter((c) => c.value === 'delivery').length, 1, 'a built-in current type is not listed twice')
  assert.equal(feeTypeChoices([entry('RENT')]).filter((c) => c.value.toLowerCase() === 'rent').length, 1)
})
check('a type is choosable when built in or active in the catalog (case-insensitive); archived and unknown are not', () => {
  const list = [entry('Rent'), entry('Old', { archived: true })]
  assert.equal(feeTypeIsChoosable(list, 'DELIVERY'), true)
  assert.equal(feeTypeIsChoosable(list, ' rent '), true)
  assert.equal(feeTypeIsChoosable(list, 'Old'), false)
  assert.equal(feeTypeIsChoosable(list, 'Nope'), false)
  assert.equal(feeTypeIsChoosable(null, 'Rent'), false)
})
check('a create body keeps a custom type as typed, lower-cases a built-in one, and falls back to other for empty or over-long text', () => {
  const body = (feeType: unknown) => normalizeFeeCreateBody({ fee_type: feeType, label: 'x', amount_usd: 1, amount_khr: 0, fee_date: '2026-11-02', sale_id: null, branch_id: 1, delivery_contact_id: null, notes: null } as never)
  const typeOf = (feeType: unknown) => (body(feeType) as { fee_type?: string } | null)?.fee_type
  assert.equal(typeOf('Rent'), 'Rent')
  assert.equal(typeOf('  Staff   meals '), 'Staff meals')
  assert.equal(typeOf('DELIVERY'), 'delivery')
  assert.equal(typeOf(''), 'other')
  assert.equal(typeOf('x'.repeat(FEE_TYPE_NAME_MAX_CHARS + 1)), 'other')
  assert.equal(typeOf('x'.repeat(FEE_TYPE_NAME_MAX_CHARS)), 'x'.repeat(FEE_TYPE_NAME_MAX_CHARS))
})

// ---------------------------------------------------------------- 2. refusals in the operator's language
check('a known catalog refusal is translated by its code; an unknown one keeps the server sentence', () => {
  const tr = (key: string, fallback: string) => `[${key}]`
  assert.equal(catalogRefusalText({ code: 'label_exists' }, tr), '[expense_err_label_exists]')
  assert.equal(catalogRefusalText({ code: 'fee_type_archived' }, tr), '[expense_err_type_archived]')
  assert.equal(catalogRefusalText({ code: 'toString' }, tr), null, 'a prototype name is not a code')
  assert.equal(catalogRefusalText(new Error('boom'), tr), null)
  assert.equal(catalogFailureText(Object.assign(new Error('English sentence'), { code: 'type_exists' }), tr, 'expense_type_add_failed', 'x'), '[expense_type_add_failed]: [expense_err_type_exists]')
  assert.equal(catalogFailureText(new Error('English sentence'), tr, 'expense_type_add_failed', 'x'), '[expense_type_add_failed]: English sentence')
  assert.equal(catalogFailureText(null, tr, 'expense_type_add_failed', 'x'), '[expense_type_add_failed]')
})

// ---------------------------------------------------------------- 3. list helpers for sale rows
function extractFunction(source: string, name: string): string {
  const match = source.match(new RegExp(`(?:export )?function ${name}\\([\\s\\S]*?\\n\\}`))
  assert.ok(match, `${name} not found`)
  return stripTypeScriptTypes(match[0].replace('export ', ''))
}
const pageHelpers = new Function(`${extractFunction(page, 'buildFeeExportRows')}
const feeRowKey = ${stripTypeScriptTypes((page.match(/export const feeRowKey = ([^\n]+)/) || [])[1] ?? 'null')}
return { buildFeeExportRows, feeRowKey }`)() as {
  buildFeeExportRows: (rows: unknown[], label: (type: string) => string, sources?: { recorded: string; sale: string }) => Array<Record<string, unknown>>
  feeRowKey: (fee: { id: number; kind?: string }) => string
}
check('an expense id and a sale id never share a list key', () => {
  assert.notEqual(pageHelpers.feeRowKey({ id: 5 }), pageHelpers.feeRowKey({ id: 5, kind: 'sale_delivery' }))
  assert.equal(pageHelpers.feeRowKey({ id: 5, kind: 'expense' }), pageHelpers.feeRowKey({ id: 5 }))
})
check('the export gains a source column only when a sale row is in it', () => {
  const expense = { id: 1, fee_type: 'other', label: 'Tape', fee_date: '2026-11-01', amount_usd: 2, amount_khr: 0 }
  const sale = { id: 9, kind: 'sale_delivery', fee_type: 'delivery', label: 'Grab', fee_date: '2026-11-01', amount_usd: 3, amount_khr: 0, sale_receipt_number: 'R-9' }
  const labels = { recorded: 'Expense', sale: 'Courier cost' }
  const mixed = pageHelpers.buildFeeExportRows([expense, sale], (type) => type, labels)
  assert.deepEqual(mixed.map((row) => row.source), ['Expense', 'Courier cost'])
  assert.equal(mixed[1].sale_receipt, 'R-9')
  assert.ok(!('source' in pageHelpers.buildFeeExportRows([expense], (type) => type, labels)[0]), 'stored expenses only: the original columns')
  assert.ok(!('source' in pageHelpers.buildFeeExportRows([expense, sale], (type) => type)[0]), 'no labels given: the original columns')
})

// ---------------------------------------------------------------- 4. what each surface offers
check('labels can be added, renamed, re-typed and archived in the manager, and nothing there deletes', () => {
  assert.match(manager, /<ReasonListEditor[\s\S]*?onAdd=\{addLabel\}/, 'the Labels section has an add row')
  assert.match(manager, /addFeeLabel\(label\)/)
  assert.match(manager, /setFeeLabelArchived\(entry\.label, archived\)/)
  assert.match(manager, /onRename=\{\(entry, to\) => rename\(entry, to\)\}/)
  assert.match(manager, /classifyFeeLabel\(entry\.label, feeType\)/)
  assert.doesNotMatch(manager + typesSection, /Trash2|onDelete=|deleteFee|\bDELETE\b/, 'no hard delete in the catalog surfaces')
  assert.match(manager, /data-expense-catalog-tab=\{id\}/)
  assert.match(manager, /<ExpenseTypesSection/, 'the Types section lives in the same manager')
})
check('every catalog write re-checks live authority before it starts and before it reports', () => {
  assert.ok((manager.match(/if \(!canEdit\(\)\) return/g) || []).length >= 12, 'manager: every step re-checks')
  assert.ok((typesSection.match(/if \(!canEdit\(\)\) return/g) || []).length >= 8, 'types: every step re-checks')
  assert.match(typesSection, /getFeeTypeImpact\(entry\.name\)\n\s*if \(!canEdit\(\)\) return false\n[\s\S]*?askToConfirm[\s\S]*?if \(!canEdit\(\)\) return false\n\s*await renameFeeType\(entry\.name, to\)/, 'authority is re-checked after the preview and again after the confirmation, before the write')
  assert.match(typesSection, /setFeeTypeArchived\(entry\.name, archived\)/)
})
check('built-in and unregistered types are not renamable or archivable; archived rows are faded and cannot be renamed', () => {
  assert.match(typesSection, /canRename=\{\(item\) => item\.registered && !item\.builtin && !item\.archived\}/)
  assert.match(typesSection, /item\.builtin \|\| !item\.registered \? null/)
  assert.match(manager, /canRename=\{\(entry\) => entry\.archived !== true\}/)
  assert.match(editor, /canRename \? canRename\(item\) : true/, 'the shared editor shows rename on every row unless a host narrows it')
  assert.match(editor, /item\.muted \? ' opacity-60'/)
})
check('archive asks first, restore does not, and the reason explains that nothing is lost', () => {
  assert.match(manager, /if \(archived\) \{\s*if \(!\(await askToConfirm\(\{[\s\S]*expense_archive_note/)
  assert.match(typesSection, /if \(archived\) \{\s*if \(!\(await askToConfirm\(\{[\s\S]*expense_archive_note/)
})
check('the form offers the live type list and keeps a restored draft\'s custom type', () => {
  assert.match(form, /feeTypeChoices\(feeTypes, form\.fee_type\)/)
  assert.match(form, /getFeeTypes\(\)/)
  assert.doesNotMatch(form, /FEE_TYPE_OPTIONS\.some\(\(option\) => option\.value === draft\.fee_type\)/, 'a draft with a custom type is no longer reset')
  assert.match(form, /feeTypeIsChoosable\(feeTypes, match\.fee_type\)/, 'a label only adopts a type that is still a choice')
})
check('the page asks for sale rows and totals, tags them, and gives them a read-only surface', () => {
  assert.match(page, /source: 'all',\s*fee_type: typeFilter/, 'the list asks for stored expenses plus sale courier rows')
  assert.match(page, /include: 'sales',/, 'the totals strip asks for the sale courier block')
  assert.match(page, /key=\{feeRowKey\(fee\)\}/, 'rows are keyed by kind and id')
  assert.match(page, /row\.kind === 'sale_delivery' \? \{ \.\.\.row, id: -Math\.abs\(row\.id\)/, 'a sale row never carries an expense id, so no expense pending-review tag can match it')
  assert.equal((page.match(/<PendingReviewTag section="fees" entityType="fee" ids=\{\[fee\.id\]\}/g) || []).length, 2, 'the review tags still look rows up by id')
  const saleSurface = page.slice(page.indexOf("{selected?.kind === 'sale_delivery' && modal === 'detail'"), page.indexOf('{showLabelManager && canEditFee'))
  assert.ok(saleSurface.length > 400, 'the sale surface exists')
  assert.doesNotMatch(saleSurface, /canEditFee|canDeleteFee|Pencil|Trash2|openEdit|handleDelete/, 'a courier cost on a sale cannot be edited or deleted here')
  assert.match(saleSurface, /canViewSales && navigateTo/, 'the link to the sale needs the sales view permission')
  assert.match(saleSurface, /<EntityLink page="sales" anchor="hub:sales:sales"/)
  assert.match(page, /\{modal === 'detail' && selected && selected\.kind !== 'sale_delivery' \? \(/, 'the expense detail never opens for a sale row')
  assert.match(page, /row\.kind !== 'sale_delivery'\)\.map\(\(row\) => String\(row\.label/, 'a courier name is never offered as an expense label')
})
check('the total is the recorded total plus the sale courier cost, with both components shown', () => {
  assert.match(page, /fmtMoney\(Math\.round\(\(amountUsd \+ saleUsd\) \* 100\) \/ 100, amountKhr \+ saleKhr\)/)
  assert.match(page, /expense_recorded_stat/)
  assert.match(page, /expense_sale_delivery_stat/)
  assert.match(page, /value: String\(count \+ saleCount\)/, 'the count matches the list total')
})
check('the Type filter lists built-in, custom and archived types; a save refusal reads in the operator\'s language', () => {
  assert.match(page, /getFeeTypes\(\{ includeArchived: true \}\)/)
  assert.match(page, /\.\.\.typeFilterValues\.map\(\(value\): FilterOption/)
  assert.match(page, /for \(const entry of feeTypes\) if \(!entry\.builtin && /, 'custom types join the filter list')
  assert.match(page, /catalogRefusalText\(error, tr\) \?\?/)
})
check('catalog writes are real writes: they ride route(), so offline refuses them and every cached fees read is dropped', () => {
  assert.match(transport, /function feeCatalogWrite<T>\(channel: string, path: string, body: unknown\): Promise<T> \{\s*return route\(channel, \(\) => apiFetch\('POST', path, body\), null, true\)/)
  assert.doesNotMatch(transport, /apiFetch\('POST', '\/api\/fees\/(labels|types)/, 'no catalog write bypasses route()')
  assert.ok((transport.match(/feeCatalogWrite[<(]/g) || []).length >= 8, 'the definition and seven catalog writes')
})

// ---------------------------------------------------------------- 5. language packs
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
check('every key this lane uses is in both packs, Khmer is Khmer, and placeholders agree', () => {
  const used = new Set<string>()
  for (const source of [page, manager, typesSection, read('../src/components/fees/expenseCatalogErrors.ts')]) {
    for (const match of source.matchAll(/'((?:expense_|stats_fees_total_with_sales_hint)[a-z_]+)'/g)) used.add(match[1])
  }
  assert.ok(used.size >= 30, `found ${used.size} keys`)
  for (const key of used) {
    assert.ok(typeof en[key] === 'string' && en[key], `en has ${key}`)
    assert.ok(typeof km[key] === 'string' && km[key], `km has ${key}`)
    assert.match(km[key], /[ក-៿]/, `${key}: the Khmer pack holds Khmer text`)
    assert.deepEqual(en[key].match(/\{\w+\}/g) || [], km[key].match(/\{\w+\}/g) || [], `${key}: placeholders agree`)
  }
  assert.equal(en.manage_expense_labels, 'Expense labels and types')
})

console.log(`\nexpenseCatalog: ${passed} check(s) passed.`)
