// The Worker half of the app-wide day-first date rule.
//
// Owner, Sep 6 2026, verbatim: "i asked to change already dd/mm/yyyy. this is
// the rule moving forward." The DISPLAY side moved on Sep 4 (fmtDate,
// fmtDateTime24, DateEntryInput). What this file guards is the half that was
// left behind: the Worker still READ a slash date the operator typed as
// month-first, and still told them to type mm/dd/yyyy, while the field that
// produced the string was day-first. For every day <= 12 both readings are
// real dates, so nothing on screen would show the disagreement.
//
// How far that got, traced rather than assumed: DateEntryInput.commit only
// ever calls onChange with ISO ('YYYY-MM-DD') or '', at every call site, so
// no in-app path has handed these routes a slash date and no stored row is
// known to be wrong. The defect was LATENT -- a parser that disagreed with
// its own UI, and a refusal message that named the wrong order to an operator
// who had just been rejected. Both are worth closing (the next sender need
// not be a React field: an integration, a retry of a raw body, or a new form
// that posts what was typed), and the message half is reachable today. This
// is not a report of damaged data, and nothing here calls for a repair sweep.
//
// Two questions look identical and are not:
//
//   A TYPED date   -- a person typed it into this app's own day-first field
//                     (DateEntryInput). Read it day-first: normalizeTypedDate.
//   A SPREADSHEET  -- a cell in a file the shop already owns. Its order comes
//   cell             from its own column header, never from today's display
//                     convention: normalizeToIsoDate(value, order).
//
// Getting these the wrong way round corrupts data in opposite directions, so
// every call site must SAY which question it is asking. That is the invariant
// swept below, and it is swept with a positive control: a sweep that reports
// every case the same way is indistinguishable from a broken instrument.
//
// Run (from cloudflare/): node scripts/test-typed-date-day-first-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

const SRC = path.join(__dirname, '..', 'src')
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8')

// --- 1. the kernel itself, executed for real --------------------------------

function loadModule(rel) {
  const sourcePath = path.join(SRC, rel)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(sourcePath),
  })
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
  )
  return moduleObj.exports
}

const batchCode = loadModule('lib/batchCode.ts')

// 03/09/2026 is the discriminating input throughout this file: both fields are
// <= 12, so BOTH orders produce a real date and only the answer separates them.
assert.strictEqual(
  batchCode.normalizeTypedDate('03/09/2026'), '2026-09-03',
  'a date a person typed is 3 September, the way the field that produced it reads',
)
assert.strictEqual(
  batchCode.normalizeToIsoDate('03/09/2026'), '2026-03-09',
  'the spreadsheet default is still 9 March -- deliberately NOT moved, because re-reading a file the shop already owns under a new order rewrites its stock silently',
)
// A day past the 12th proves the order rather than assuming it, and exactly
// ONE order is accepted -- a parser that tried both would turn a typo into a
// plausible wrong date.
assert.strictEqual(batchCode.normalizeTypedDate('25/12/2026'), '2026-12-25')
assert.strictEqual(batchCode.normalizeTypedDate('12/25/2026'), null, 'the other order fails loudly rather than being guessed')
assert.strictEqual(batchCode.normalizeTypedDate('2026-09-03'), '2026-09-03', 'ISO is what every UI field actually stores')
assert.strictEqual(batchCode.normalizeTypedDate(''), null)
assert.strictEqual(batchCode.normalizeTypedDate('not-a-date'), null)
// The identifier half is untouched: a lot code is matched, not read.
assert.strictEqual(batchCode.dateToBatchCode('2026-09-03'), '09032026', 'lot codes stay MMDDYYYY identifiers')
// readBatchDateCell now names the header it read, so a message can quote it.
assert.deepStrictEqual(
  batchCode.readBatchDateCell({ 'batch(dd/mm/yyyy)': '25/12/2026' }),
  { raw: '25/12/2026', order: 'day-first', header: 'batch(dd/mm/yyyy)' },
)
assert.deepStrictEqual(
  batchCode.readBatchDateCell({ name: 'no date column' }),
  { raw: '', order: 'month-first', header: '' },
)
console.log('PASS kernel: normalizeTypedDate is day-first, the spreadsheet default is unchanged, and the two carry separate names')

// --- 2. every call site says which question it is asking --------------------

// A bare `normalizeToIsoDate(x)` outside batchCode.ts is the defect: it
// silently inherits the SPREADSHEET order for whatever the caller happens to be
// holding. Found by scanning to the matching close paren rather than by a
// regex, so a nested call inside the argument cannot truncate the reading.
// "States its order" means a SECOND argument is present at all -- a literal
// ('month-first') or the variable readBatchDateCell handed back. What is being
// enforced is that the caller answered the question, not which answer it gave.
function statesOrder(args) {
  let depth = 0
  for (let i = 0; i < args.length; i += 1) {
    const ch = args[i]
    if (ch === '(' || ch === '[' || ch === '{') depth += 1
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1
    else if (ch === ',' && depth === 0) return true
  }
  return false
}

function callSites(text) {
  const needle = 'normalizeToIsoDate('
  const found = []
  let at = text.indexOf(needle)
  while (at !== -1) {
    let depth = 0
    let end = at + needle.length - 1
    for (; end < text.length; end += 1) {
      if (text[end] === '(') depth += 1
      else if (text[end] === ')') { depth -= 1; if (depth === 0) break }
    }
    const args = text.slice(at + needle.length, end)
    found.push({ call: text.slice(at, end + 1), statesOrder: statesOrder(args) })
    at = text.indexOf(needle, end + 1)
  }
  return found
}

// Positive control FIRST: if this scanner cannot see a bare call in a line
// written to contain one, every "clean" verdict below is meaningless.
{
  const control = callSites([
    "const a = normalizeToIsoDate(row.date) || ''",
    "const b = normalizeToIsoDate(row.date, 'month-first') || ''",
    "const c = normalizeToIsoDate(text(raw.date), 'day-first')",
    'const d = normalizeToIsoDate(raw, order)',
  ].join('\n'))
  assert.strictEqual(control.length, 4, 'the scanner must find all four calls, nested argument included')
  assert.deepStrictEqual(
    control.map((entry) => entry.statesOrder), [false, true, true, true],
    'and must tell a bare call from one that states its order -- literal or variable',
  )
}

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

const relative = (full) => path.relative(SRC, full).split(path.sep).join('/')

const offenders = []
let sweptCallSites = 0
for (const full of walk(SRC)) {
  const rel = relative(full)
  if (rel === 'lib/batchCode.ts') continue // the kernel is where the default lives
  for (const site of callSites(fs.readFileSync(full, 'utf8'))) {
    sweptCallSites += 1
    if (!site.statesOrder) offenders.push(rel + ': ' + site.call)
  }
}
assert.ok(sweptCallSites >= 6, 'the sweep must have found real call sites to judge, saw ' + sweptCallSites)
assert.deepStrictEqual(
  offenders, [],
  'every normalizeToIsoDate call outside the kernel must state its order (or be normalizeTypedDate):\n' + offenders.join('\n'),
)
console.log('PASS sweep: ' + sweptCallSites + ' normalizeToIsoDate call sites, every one of them states the order it reads')

// --- 3. the typed-date surfaces use the typed-date reader -------------------

// Each of these parses a value a person typed into a day-first DateEntryInput.
// Named one by one rather than pattern-matched, so adding a new typed-date
// endpoint stays a deliberate decision recorded here.
const TYPED_DATE_SITES = [
  ['routes/inventory.ts', 'POST /inventory/adjust receivedDate (Inventory Adjust, fast stock-in)'],
  ['routes/batches.ts', 'POST /batches received_at (Receive Batch modal)'],
  ['routes/promotions.ts', 'promotion starts_at / ends_at (Promotions page)'],
  ['lib/productBatches.ts', 'receiveBatchStock -- the shared receive kernel'],
  ['lib/stockSession.ts', 'the dates on a stock-in session'],
  ['routes/fees.ts', 'fee_date on POST/PATCH /api/fees (Expenses form)'],
]
for (const [rel, what] of TYPED_DATE_SITES) {
  const text = read(rel)
  assert.ok(text.includes('normalizeTypedDate'), rel + ' (' + what + ') must read a typed date day-first')
  assert.ok(
    callSites(text).every((site) => site.statesOrder),
    rel + ' must not also fall back to the spreadsheet default',
  )
}
console.log('PASS routes: ' + TYPED_DATE_SITES.length + ' typed-date surfaces read the way the field that feeds them writes')

// --- 4. what the messages tell a person to type -----------------------------

// A message is the only place an operator learns the order. It must name the
// order actually parsed, or it is worse than no message at all.
const MONTH_FIRST_ALLOWED = new Map([
  // The column header IS the format. Stated data, not advice.
  ['lib/batchCode.ts', /BATCH_DATE_COLUMN_MONTH_FIRST = 'batch\(mm\/dd\/yyyy\)'/],
  // The warning quotes whichever order the row's own header dictates.
  ['lib/importEngine.ts', /receivedDateOrder === 'day-first' \? 'dd\/mm\/yyyy' : 'mm\/dd\/yyyy'/],
  // The unified stock sheet's bare `date` column is month-first forever, and
  // the message says so in those words. Client mirror:
  // frontend/src/components/products/import/unifiedStockImport.ts.
  ['lib/stockActionImport.ts', /month first, as this column has always been/],
])

const messageOffenders = []
let monthFirstMentions = 0
for (const full of walk(SRC)) {
  const rel = relative(full)
  for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue
    if (!line.includes('mm/dd/yyyy')) continue
    monthFirstMentions += 1
    const allowed = MONTH_FIRST_ALLOWED.get(rel)
    if (!allowed || !allowed.test(line)) messageOffenders.push(rel + ': ' + trimmed)
  }
}
assert.ok(monthFirstMentions >= 3, 'the message sweep must have found the known month-first strings, saw ' + monthFirstMentions)
assert.deepStrictEqual(
  messageOffenders, [],
  'a live string still tells someone to type month-first:\n' + messageOffenders.join('\n'),
)

// And the messages this lane rewrote really do say day-first now.
assert.ok(
  read('routes/inventory.ts').includes('Received date must be a readable date (dd/mm/yyyy)'),
  'POST /inventory/adjust names the order it parses',
)
assert.ok(read('routes/promotions.ts').includes('Start date is not a real date (use dd/mm/yyyy)'))
assert.ok(read('routes/promotions.ts').includes('End date is not a real date (use dd/mm/yyyy)'))
assert.ok(read('lib/stockSession.ts').includes('must be a valid date (dd/mm/yyyy)'))

// Parity, swept rather than remembered. The four asserts above name the
// messages this lane happened to rewrite; a FIFTH typed-date surface that
// refuses a date without naming an order is the same defect and no assert
// above would notice it. So every refusal on every typed-date file must
// carry the order -- which is how routes/batches.ts's bare "received_at is
// not a valid date" was caught: it parses day-first like its siblings, but
// told the operator nothing about which order to retype in, on the one
// screen (Manage Batches) where getting it wrong moves stock into the wrong
// lot.
const REFUSAL = /(?:not a (?:valid|real|readable) date|must be a (?:valid|readable) date)/
const silentRefusals = []
let sweptRefusals = 0
for (const [rel] of TYPED_DATE_SITES) {
  for (const line of read(rel).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue
    if (!REFUSAL.test(trimmed)) continue
    sweptRefusals += 1
    if (!trimmed.includes('dd/mm/yyyy')) silentRefusals.push(rel + ': ' + trimmed)
  }
}
assert.ok(sweptRefusals >= 4, 'the refusal sweep must have found real messages to judge, saw ' + sweptRefusals)
assert.deepStrictEqual(
  silentRefusals, [],
  'a typed-date surface refuses a date without saying which order to retype it in:\n' + silentRefusals.join('\n'),
)
// Positive control: the detector must be able to report a negative. Handed
// the exact string this sweep was written to catch, it has to catch it.
assert.ok(
  REFUSAL.test("return c.json({ error: 'received_at is not a valid date' }, 400)"),
  'control: the refusal pattern matches the bare message this sweep exists for',
)
assert.equal(
  REFUSAL.test("params.received_at = resolvedIso"), false,
  'control: and does not match an ordinary line',
)
// The importer's warning quotes the column it read and that column's order,
// instead of asserting one fixed order for every header.
assert.ok(
  read('lib/importEngine.ts').includes('${receivedDateHeader} column, which is read ${expected}'),
  'the unreadable_batch_date warning names the header it read and the order it used',
)
console.log('PASS messages: ' + monthFirstMentions + ' month-first strings remain, all naming a spreadsheet column rather than advising a person')

// --- 5. the Telegram feed speaks one date order -----------------------------

const telegramLang = read('lib/telegramLang.ts')
assert.ok(
  telegramLang.includes("'$3/$2/$1')"),
  'the Expenses Date line reorders ISO day-first, like every other Date line in the feed',
)
assert.ok(
  !telegramLang.includes("'$2/$3/$1')"),
  'and not month-first, which is what it did until Sep 6 2026',
)
assert.ok(
  read('lib/telegram.ts').includes('pad(local.getUTCDate())'),
  'formatBusinessDateTime -- the formatter those other lines use -- is day-first',
)
// The bot's own help text must name the order parseReportDate accepts.
assert.ok(telegramLang.includes('dd/mm/yyyy'), 'the /report date help names dd/mm/yyyy')
assert.ok(
  telegramLang.includes('the DAY comes first'),
  'and leads with the order rather than merely listing shapes',
)
console.log('PASS telegram: one date order across the feed, and the help text names it')

console.log('\ntyped-date day-first tests passed')
