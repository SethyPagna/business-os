// The date kernel exists twice: cloudflare/src/lib/batchCode.ts (authoritative,
// reads every typed field and CSV cell) and frontend/src/utils/batchCode.ts
// (preview in the receive/edit modals). The frontend test
// tests/dateFormatDayFirst.test.ts compares the two bodies, but the Worker gate
// (this directory) never runs frontend tests -- so a Worker-only edit would be
// green here and red only in the frontend gate. This file puts the comparison
// in the Worker gate too, and then pins the Worker kernel's reading rules.
//
// The kernel's accepted window must also match the field a person types into
// (frontend/src/utils/dateEntry.ts): years 1970-2999, 2- or 4-digit slash
// years, and nothing but a time-of-day after an ISO date.
//
// Run (from cloudflare/): node scripts/test-batchcode-kernel-parity-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

const WORKER = path.join(__dirname, '..', 'src', 'lib', 'batchCode.ts')
const MIRROR = path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'batchCode.ts')
const eol = (text) => text.replace(/\r\n/g, '\n')

function load(file) {
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(file),
  })
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', outputText)(moduleObj.exports, require, moduleObj)
  return moduleObj.exports
}

let failures = 0
function check(name, fn) {
  try { fn(); console.log(`ok   ${name}`) } catch (error) { failures += 1; console.error(`FAIL ${name}\n     ${error.message}`) }
}

const worker = load(WORKER)
const mirror = load(MIRROR)

// --- 1. the two bodies are the same text -------------------------------------

check('Worker and frontend batchCode share a byte-identical body', () => {
  const marker = ' * Which way round a slash'
  const a = eol(fs.readFileSync(WORKER, 'utf8'))
  const b = eol(fs.readFileSync(MIRROR, 'utf8'))
  assert.ok(a.includes(marker) && b.includes(marker), 'both files must still carry the shared-body marker')
  assert.strictEqual(b.slice(b.indexOf(marker)), a.slice(a.indexOf(marker)),
    'the kernels drifted -- change one, change the other in the same commit')
})

// Positive control: the comparison above must be able to fail. Drop one
// character from a copy of the body and prove the same comparison notices.
check('control: the body comparison detects a one-character drift', () => {
  const marker = ' * Which way round a slash'
  const a = eol(fs.readFileSync(WORKER, 'utf8'))
  const drifted = a.replace('MIN_DATE_YEAR = 1970', 'MIN_DATE_YEAR = 1971')
  assert.notStrictEqual(drifted, a, 'the control edit must change the text')
  assert.notStrictEqual(drifted.slice(drifted.indexOf(marker)), a.slice(a.indexOf(marker)))
})

// --- 2. behavioural parity on the same inputs --------------------------------

const INPUTS = [
  '2026-10-06', '2026-1-6', '2026-10-06 14:30', '2026-10-06T14:30:00', '2026-10-06T14:30:00.123Z', '2026-10-06T21:30:00+07:00',
  '2026-10-06garbage', '2026-10-061', '2026-10-06 25:99x', '2026-02-30', '2026-13-01',
  '1969-12-31', '1970-01-01', '2999-12-31', '3000-01-01', '0099-01-01', '9999-12-31',
  '25/12/2026', '3/4/2026', '03/04/26', '9/3/026', '13/13/2026', '31/04/2026', '29/02/2028', '29/02/2027', '25/12/1969', '25/12/3000',
  '25/12/2026 14:30', '25/12/2026T14:30:59', '', '   ', null, undefined, 'x', '25-12-2026', '2026/12/25',
]

for (const order of ['day-first', 'month-first']) {
  check(`Worker and frontend read every input identically (${order})`, () => {
    for (const input of INPUTS) {
      assert.strictEqual(worker.normalizeToIsoDate(input, order), mirror.normalizeToIsoDate(input, order), `${JSON.stringify(input)} under ${order}`)
    }
  })
}
check('Worker and frontend dateToBatchCode / normalizeTypedDate agree', () => {
  for (const input of INPUTS) {
    assert.strictEqual(worker.dateToBatchCode(input), mirror.dateToBatchCode(input), `dateToBatchCode ${JSON.stringify(input)}`)
    assert.strictEqual(worker.normalizeTypedDate(input), mirror.normalizeTypedDate(input), `normalizeTypedDate ${JSON.stringify(input)}`)
  }
})

// --- 3. the tightened rules, stated as expectations --------------------------

check('an ISO date followed by anything but a time is refused (end anchor)', () => {
  assert.strictEqual(worker.normalizeToIsoDate('2026-09-03garbage'), null)
  assert.strictEqual(worker.normalizeToIsoDate('2026-09-031'), null)
  assert.strictEqual(worker.normalizeToIsoDate('2026-09-03 and more'), null)
})
check('the timestamp shapes D1 and JSON.stringify(Date) emit still read as their date part', () => {
  assert.strictEqual(worker.normalizeToIsoDate('2026-09-03'), '2026-09-03')
  assert.strictEqual(worker.normalizeToIsoDate('2026-09-03 14:30:59'), '2026-09-03')
  assert.strictEqual(worker.normalizeToIsoDate('2026-09-03T14:30:59.123Z'), '2026-09-03')
  assert.strictEqual(worker.normalizeToIsoDate('2026-09-03T14:30:59+07:00'), '2026-09-03')
})
check('years outside 1970-2999 are refused, the edges are kept', () => {
  assert.strictEqual(worker.normalizeToIsoDate('1969-12-31'), null)
  assert.strictEqual(worker.normalizeToIsoDate('1970-01-01'), '1970-01-01')
  assert.strictEqual(worker.normalizeToIsoDate('2999-12-31'), '2999-12-31')
  assert.strictEqual(worker.normalizeToIsoDate('3000-01-01'), null)
  assert.strictEqual(worker.normalizeToIsoDate('0099-01-01'), null)
  assert.strictEqual(worker.normalizeToIsoDate('25/12/1969', 'day-first'), null)
})
check('a three-digit slash year is refused, 2- and 4-digit years read', () => {
  assert.strictEqual(worker.normalizeToIsoDate('9/3/026', 'day-first'), null)
  assert.strictEqual(worker.normalizeToIsoDate('9/3/26', 'day-first'), '2026-03-09')
  assert.strictEqual(worker.normalizeToIsoDate('9/3/2026', 'day-first'), '2026-03-09')
})
check('typed dates read day-first: 25/12/2026 accepted, 13/13/2026 refused', () => {
  assert.strictEqual(worker.normalizeTypedDate('25/12/2026'), '2026-12-25')
  assert.strictEqual(worker.normalizeTypedDate('13/13/2026'), null)
  assert.strictEqual(worker.normalizeTypedDate('03/04/2026'), '2026-04-03')
})

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nbatchcode-kernel-parity: all checks passed')
