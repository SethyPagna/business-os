// S4R4-5 -- the POS side of the cash-drawer shift rules.
//
// migration 0116 and test-shift-sessions-pure.cjs prove the SERVER keeps its
// three promises (register once a day, end once, prompt until registered).
// None of that helps if the till never shows the prompt, or shows one the
// cashier can dismiss. These are the promises that live only in the frontend:
//
//   1. The prompt cannot be dismissed. A closable prompt is one the till
//      never registers, and "will prompt until it is registered" is the whole
//      requirement.
//   2. A failed read is NOT treated as registered. Reading a transport error
//      as "already done" would skip the prompt silently for the rest of the
//      day -- the worst possible failure, because nothing looks wrong.
//   3. End Shift is invisible unless a shift is actually open, so "end only
//      once" is true in the UI and not just in the UPDATE.
//   4. The shift transport never falls back to a local/offline answer.
//
// Source-shape assertions, deliberately: these are wiring facts, and the
// behaviour underneath them is proved on the Worker side against real SQL.
//
// Run: node tests/shiftGate.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (p: string) => fs.readFileSync(path.join(here, '..', p), 'utf8')

const gate = read('src/components/pos/ShiftGate.tsx')
const transport = read('src/api/shiftTransport.ts')
const pos = read('src/components/pos/POS.tsx')

let checks = 0
const ok = (cond: unknown, label: string) => {
  assert.ok(cond, label)
  checks += 1
  console.log(`  ok - ${label}`)
}

// ---- 1. The prompt is not dismissible -------------------------------------
const registerBlock = gate.slice(gate.indexOf('needsRegistration && ('), gate.indexOf('EndShiftButton'))
ok(registerBlock.length > 200, 'the registration overlay was located in the source')
ok(/onClose=\{\(\) => \{[^}]*\}\}/.test(registerBlock),
  'the registration prompt wires onClose to a no-op -- it cannot be dismissed')
ok(!/setNeedsRegistration|onClose=\{\(\) => set/.test(registerBlock),
  'and nothing in the overlay closes it locally without registering')

// ---- 2. A failed read must not read as registered --------------------------
// The catch sets state to null, and the prompt condition is an explicit
// `=== true` on the server's own flag -- so null cannot satisfy it either way.
ok(/catch \{[\s\S]{0,400}setState\(null\)/.test(gate),
  'a failed read resets shift state to null rather than assuming a shift exists')
ok(/needs_registration === true/.test(gate),
  'the prompt condition tests the server flag with ===, so null/undefined never suppresses it')
ok(/if \(!state\) throw new Error/.test(transport),
  'the transport throws when route() resolves null instead of returning a shapeless state')

// ---- 3. End Shift only exists while a shift is open ------------------------
ok(/if \(!state\?\.can_end\) return null/.test(gate),
  'EndShiftButton renders nothing unless the server says the shift can be ended')
const endIdx = gate.indexOf('if (!state?.can_end) return null')
ok(endIdx > 0 && gate.indexOf('<button', endIdx) > endIdx,
  'and the early return sits BEFORE the button markup, not after it')

// ---- 4. No offline mirror for a physical cash count ------------------------
const routeCalls = [...transport.matchAll(/route<ShiftState>\(\s*[\s\S]*?\n\s{4}null,/g)]
ok(routeCalls.length === 3,
  `all three shift calls pass null as the local fallback (found ${routeCalls.length})`)
// Comments stripped first: this file's own prose explains WHY there is no
// local fallback, and matching that prose would make the check pass or fail
// on the documentation rather than on the code.
const transportCode = transport
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
ok(/route<ShiftState>/.test(transportCode), 'comment stripping left the transport code intact')
ok(!/localFn|readLocal|offlineQueue|enqueue|localStorage/.test(transportCode),
  'the shift transport never queues or answers a shift from local storage')
const writes = [...transport.matchAll(/route<ShiftState>\([\s\S]*?null,\s*\n\s*true,/g)]
ok(writes.length === 2,
  `open and close are both marked isWrite so they must reach the server (found ${writes.length})`)

// ---- 5. POS actually mounts both ------------------------------------------
ok(/import ShiftGate, \{ EndShiftButton \} from '\.\/ShiftGate'/.test(pos),
  'POS imports the gate and the end-shift control')
ok(/<ShiftGate \/>/.test(pos), 'POS mounts the registration prompt')
ok(/<EndShiftButton \/>/.test(pos), 'POS mounts the End Shift control')

// ---- 6. Every key the gate asks for exists in BOTH packs -------------------
// verify:i18n covers this repo-wide, but a shift key missing from km would
// show a raw snake_case string to a Khmer cashier at the one moment they
// cannot dismiss the dialog, so it is worth failing here too.
const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>
const used = [...new Set([...gate.matchAll(/\bt\('([^']+)'\)/g)].map((m) => m[1]))]
ok(used.length >= 14, `the gate's translation keys were found (${used.length})`)
const missingEn = used.filter((k) => !(k in en))
const missingKm = used.filter((k) => !(k in km))
ok(missingEn.length === 0, `every key resolves in en.json${missingEn.length ? ': ' + missingEn.join(', ') : ''}`)
ok(missingKm.length === 0, `every key resolves in km.json${missingKm.length ? ': ' + missingKm.join(', ') : ''}`)
ok(used.every((k) => !k.includes('.')),
  'the gate uses flat snake_case keys, matching the packs (no dotted namespaces)')

console.log(`\nshiftGate: all ${checks} checks passed`)
