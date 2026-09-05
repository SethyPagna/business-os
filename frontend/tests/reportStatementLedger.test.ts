// The Overview's excel statement is a three-column ledger: label, an INNER
// "Detail" amount for the lines that build a total, and an OUTER "Amount" for
// the totals themselves -- the shape of the old POS profit report the owner
// supplied as the layout reference (Sep 5 2026, screenshot #13). This pins
// that shape so a later edit cannot quietly fold it back into one amount
// column, and pins the two invariants that must survive it: the shared group
// order/labels/tint still come from the model, and the Not Paid block is
// still tinted by its data attribute (the CSS rule keys on it).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => fs.readFileSync(path.join(rootPath, rel), 'utf8')
const overview = read('src/components/sales/reports/OverviewReport.tsx')
const excel = overview.slice(overview.indexOf('<DenseTable fit>'), overview.indexOf('</DenseTable>'))
assert.ok(excel.length > 0, 'the excel statement renders through DenseTable')

// Three header cells before the compare pair, in ledger order.
const heads = [...excel.matchAll(/<th[^>]*>\{tr\('([^']+)'/g)].map((m) => m[1])
assert.deepEqual(heads, ['rpt_line', 'rpt_detail', 'amount', 'rpt_prev_period', 'rpt_change'])
assert.match(overview, /const cols = compare \? 5 : 3/, 'caption rows span every column')

// Detail lines: indented, operator glyph inside the label, figure in the inner
// column and NOTHING in the outer one. Totals: the reverse.
assert.match(excel, /const total = l\.kind === 'total'/)
assert.match(excel, /total \? '' : 'pl-\[calc\(var\(--ui-cell-px,12px\)\+1rem\)\]/, 'detail lines indent under their total')
assert.match(excel, /\{total \? null : <span[^>]*>\{statementOperator\(l\.kind\)\}<\/span>\}/, 'the operator sits inside the label, only on detail lines')
assert.match(excel, /<td[^>]*>\{total \? '' : amount\}<\/td>/, 'inner column carries detail amounts only')
assert.match(excel, /\{total \? \([\s\S]*?\) : ''\}/, 'outer column carries totals only')
assert.match(excel, /l\.headline\s*\?\s*<span[^>]*bg-\[var\(--ui-ink\)\][^>]*>\{amount\}<\/span>/, 'the headline total is badged')
assert.equal((excel.match(/fmtMoney\(l\.usd, l\.khr\)/g) || []).length, 1, 'one formatter call per line feeds both columns')

// Caption rows survive only for the two memo groups; arithmetic groups are
// named by their total line.
assert.match(overview, /const captioned = \(g: StatementGroup\) => g === 'delivery' \|\| g === 'pending'/)
assert.match(excel, /\{captioned\(g\) \? \(\s*<tr[^>]*data-statement-group=\{g\}/)

// The tint is keyed on the attribute, not on an inline class, so every line
// row must still carry data-statement-group.
assert.match(excel, /<tr\s+key=\{l\.key\}[\s\S]*?data-statement-group=\{g\}[\s\S]*?data-statement-kind=\{l\.kind\}/)
assert.doesNotMatch(excel, /bg-\[var\(--ui-warn-soft\)\]/, 'no inline warn tint duplicates the CSS rule')
const css = read('src/components/sales/reports/reports-surface.css')
assert.ok(css.includes("tr[data-statement-group='pending'] > td"), 'the CSS still tints the Not Paid rows by attribute')

// Both packs carry the new column label.
const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>
assert.equal(en.rpt_detail, 'Detail')
assert.ok(km.rpt_detail && km.rpt_detail.trim(), 'km.json carries rpt_detail')

console.log('PASS report statement ledger')
