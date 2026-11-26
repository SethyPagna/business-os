// R40: cash needs an open shift. The rule has one definition, the Worker's lib/cashShiftRule.ts; the till needs the same
// answer, so src/utils/cashShiftRule.ts is a copy that differs ONLY in its import line. This test fails when either copy
// changes alone, and drives both through the one shared rule table (cloudflare/scripts/fixtures/cash-shift-rule-table.json).
// Mutants killed: the copies drift apart; a closed row treated as open; a zero Cash row refused; an exempt user refused.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

import * as ui from '../src/utils/cashShiftRule.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const workerPath = path.join(here, '..', '..', 'cloudflare', 'src', 'lib', 'cashShiftRule.ts')
const uiPath = path.join(here, '..', 'src', 'utils', 'cashShiftRule.ts')
const tablePath = path.join(here, '..', '..', 'cloudflare', 'scripts', 'fixtures', 'cash-shift-rule-table.json')

function withoutImports(file: string): string {
  return readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n').filter((line) => !/^import\s/.test(line)).join('\n')
}

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

type Table = {
  verdicts: Array<{ name: string; cash: { usd: number; khr: number }; exempt: boolean; row: { closed: boolean; cancelled: boolean } | null; direction: 'in' | 'out'; allowed: boolean; shift_state?: string }>
  reopenWho: Array<{ state: 'open' | 'closed' | 'cancelled' | 'none'; canReopen: boolean; who: string | null }>
  cashTakenNow: Array<{ name: string; kinds?: Record<string, 'cash' | 'digital'>; before: unknown[]; after: unknown[]; cash: { usd: number; khr: number } }>
}
const table = JSON.parse(readFileSync(tablePath, 'utf8')) as Table

await runTest('the frontend copy of the cash shift rule is byte-identical to the Worker module except its import line', () => {
  assert.equal(withoutImports(uiPath), withoutImports(workerPath))
})

await runTest('both copies answer the shared rule table alike, and correctly', async () => {
  const registryUrl = pathToFileURL(path.join(here, '..', 'src', 'utils', 'paymentMethodKind.ts')).href
  const workerJs = ts.transpileModule(readFileSync(workerPath, 'utf8').replace("'./paymentMethodRegistry'", JSON.stringify(registryUrl)), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const worker = await import('data:text/javascript;base64,' + Buffer.from(workerJs).toString('base64')) as typeof ui
  for (const copy of [ui, worker]) {
    for (const row of table.verdicts) {
      const verdict = copy.cashShiftVerdict({ cash: row.cash, exempt: row.exempt, state: copy.currentShiftState(row.row), direction: row.direction })
      assert.equal(verdict.allowed, row.allowed, row.name)
      if (!verdict.allowed) {
        assert.equal(verdict.shift_state, row.shift_state, row.name)
        assert.equal(verdict.direction, row.direction, row.name)
      }
    }
    for (const row of table.reopenWho) assert.equal(copy.cashShiftReopenWho(row.state, row.canReopen), row.who, `${row.state}/${row.canReopen}`)
    for (const row of table.cashTakenNow) {
      assert.deepEqual(copy.cashTakenNow(row.before as never, row.after as never, row.kinds || {}), row.cash, row.name)
    }
  }
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
