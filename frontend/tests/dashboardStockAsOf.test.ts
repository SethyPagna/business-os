import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { stockAsOfText } from '../src/components/dashboard/stockAsOf.ts'

// TIME-1 / P1.8b (owner, 27 Oct and 1 Nov): the Dashboard stock overview may be up to 5 minutes old and "shows the time it was calculated,
// as of 14:05". The Worker stamps `stock_as_of` (UTC ISO) when it computes the figures; the Dashboard prints it in business time, 24-hour,
// in both languages, and prints nothing when the Worker sent none (never the device clock).

const frontendRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(frontendRoot, '..')
const frontend = (path: string) => readFileSync(resolve(frontendRoot, path), 'utf8').replace(/\r\n/g, '\n')
const repo = (path: string) => readFileSync(resolve(repoRoot, path), 'utf8').replace(/\r\n/g, '\n')
const en = JSON.parse(frontend('src/lang/en.json')) as Record<string, string>
const km = JSON.parse(frontend('src/lang/km.json')) as Record<string, string>

// ---- the helper: business time, 24-hour, both languages ---------------------------------------------------------------------------------
assert.equal(stockAsOfText('2026-10-05T07:05:00.000Z', 'Stock as of {time}'), 'Stock as of 14:05', 'UTC 07:05 is 14:05 in Phnom Penh')
assert.equal(stockAsOfText('2026-10-05T16:59:59.999Z', 'Stock as of {time}'), 'Stock as of 23:59')
assert.equal(stockAsOfText('2026-10-05T17:00:00.000Z', 'Stock as of {time}'), 'Stock as of 00:00', 'business midnight')
assert.equal(stockAsOfText('2026-10-05T07:05:00.000Z', 'ស្តុក ត្រឹម {time}'), 'ស្តុក ត្រឹម 14:05', 'the Khmer sentence takes the same Latin digits')
assert.equal(stockAsOfText('2026-10-05 07:05:00', '{time}'), '14:05', 'a database-format stamp is UTC too')

const realNow = Date.now
try {
  // The device clock is never consulted: the same input prints the same time whatever the clock says.
  Date.now = () => Date.UTC(2031, 0, 1, 23, 59, 0)
  assert.equal(stockAsOfText('2026-10-05T07:05:00.000Z', 'Stock as of {time}'), 'Stock as of 14:05')
} finally {
  Date.now = realNow
}

// Nothing to print, so no line: absent, empty, unreadable, or not a string.
for (const bad of [undefined, null, '', '   ', 'yesterday', 'not-a-time', 1759647900000, {}, []]) {
  assert.equal(stockAsOfText(bad, 'Stock as of {time}'), null, `no line for ${JSON.stringify(bad)}`)
}

// ---- the Dashboard wires it, from the Worker's field only ---------------------------------------------------------------------------------
const dashboard = frontend('src/components/dashboard/Dashboard.tsx')
assert.match(dashboard, /^\s*stock_as_of\?: string$/m, 'the summary type names the field and makes it optional (an older Worker sends none)')
assert.match(dashboard, /const stockAsOfLine = stockAsOfText\(summary\?\.stock_as_of, translateOr\('dashboard_stock_as_of', 'Stock as of \{time\}', 'ស្តុក ត្រឹម \{time\}'\)\)/,
  'the line is built from the summary field and the translated sentence')
const source = ts.createSourceFile('Dashboard.tsx', dashboard, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let stripSummary = ''
const visit = (node: ts.Node) => {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'StatsStrip') {
    for (const attribute of node.attributes.properties) {
      if (ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'summary') stripSummary = attribute.initializer?.getText(source) ?? ''
    }
  }
  ts.forEachChild(node, visit)
}
visit(source)
assert.equal(stripSummary, '{stockAsOfLine}', 'the Dashboard StatsStrip shows the line under the date range')
assert.doesNotMatch(dashboard.slice(dashboard.indexOf('const stockAsOfLine'), dashboard.indexOf('const stockAsOfLine') + 400), /new Date\(|Date\.now\(/, 'no device clock in the as-of line')

// ---- both packs: the sentence and the switch name, Khmer short, no English placeholder in km ----------------------------------------------
assert.equal(en.dashboard_stock_as_of, 'Stock as of {time}')
assert.match(km.dashboard_stock_as_of, /\{time\}/, 'the Khmer sentence keeps the time slot')
assert.match(km.dashboard_stock_as_of, /[ក-៿]/, 'and is Khmer')
assert.doesNotMatch(km.dashboard_stock_as_of.replace('{time}', ''), /[A-Za-z]/, 'with no English left in it')
assert.ok(km.dashboard_stock_as_of.length <= 20, `short (${km.dashboard_stock_as_of.length} characters)`)

// every read switch the Worker knows has a name on the Server page, in both packs
const names = JSON.parse(repo('cloudflare/src/lib/readSwitches.ts').match(/KNOWN_READ_SWITCHES = (\[[^\]]*\])/)![1].replace(/'/g, '"')) as string[]
assert.ok(names.includes('dash_overview_5m'), 'the switch is registered in the Worker')
for (const name of names) {
  assert.ok(en[`read_switch_name_${name}`], `English name for switch ${name}`)
  assert.ok(km[`read_switch_name_${name}`], `Khmer name for switch ${name}`)
  assert.match(km[`read_switch_name_${name}`], /[ក-៿]/, `${name}: the Khmer name is Khmer`)
}

console.log('dashboard stock as-of: business-time clock, both languages, wired to the summary field, every read switch named')
