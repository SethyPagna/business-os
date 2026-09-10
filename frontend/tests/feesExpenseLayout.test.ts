import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { fmtClock24 } from '../src/utils/formatters.ts'

const read = (path: string) => fs.readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const page = read('components/fees/FeesPage.tsx')
const transport = read('api/feesTransport.ts')

const groupSource = page.slice(page.indexOf('export function groupFeesByDate'), page.indexOf('export function feeTypeToneClass'))
const groupFeesByDate = new Function(`${stripTypeScriptTypes(groupSource.replace('export ', ''))}; return groupFeesByDate`)() as (
  rows: Array<{ fee_date: string; id: number }>,
) => Array<{ date: string; rows: Array<{ id: number }> }>
const grouped = groupFeesByDate([
  { id: 3, fee_date: '2026-09-11' },
  { id: 2, fee_date: '2026-09-11' },
  { id: 1, fee_date: '2026-09-10' },
])
assert.deepEqual(grouped.map((group) => [group.date, group.rows.map((row) => row.id)]), [
  ['2026-09-11', [3, 2]],
  ['2026-09-10', [1]],
], 'already ordered expense rows stay grouped by their recorded business date')
assert.equal(fmtClock24('2026-09-10T17:00:00.000Z'), '00:00', 'row time uses the Phnom Penh 24-hour clock')

assert.doesNotMatch(page, /import StatsRangeRow/, 'Expenses does not render a second standalone date row')
assert.match(page, /<StatsStrip[\s\S]*?range=\{stripRange\}[\s\S]*?onRangeChange=\{setStripRange\}/, 'Stats owns the shared date/actions row and preset rail')
assert.match(page, /toolbarIconButtonClassName/, 'Add and Export use the shared icon-only toolbar height contract')
assert.match(page, /aria-label=\{tr\('add_fee', 'Add Expense'\)\}/)
assert.match(page, /<ExportMenu[\s\S]*?iconOnly/, 'Export is icon-only with its accessible label retained')
assert.equal((page.match(/<PaginationControls/g) || []).length, 2, 'the same compact pager appears above and below results')
assert.match(page, /group\.rows\.map\(\(fee\)/, 'desktop and mobile render day-group rows')
assert.match(page, /\{fmtClock24\(fee\.created_at\)\}/, 'rows show time rather than repeating their group date')
assert.equal((page.match(/data-expense-line=/g) || []).length, 2, 'a narrow expense card has at most two information rows')
assert.match(page, /fee\.sale_receipt_number \|\| fee\.sale_id/, 'linked rows expose receipt/sale identity')
assert.match(page, /fee\.branch_name \?/, 'branch metadata is conditional so unavailable manual metadata stays omitted')

assert.match(transport, /PENDING_FEE_CREATE_KEY/)
assert.match(transport, /storage\.setItem\(PENDING_FEE_CREATE_KEY, serialized\)/, 'request body is persisted before route() starts')
assert.match(transport, /fees:create:\$\{prepared\.client_request_id\}/, 'retry transport identity includes the durable request id')
assert.match(transport, /status >= 400 && status < 500/, 'unknown timeout/network outcomes retain the saved request')

console.log('PASS expense day grouping, compact rows, shared controls, pagers and saved create identity')
