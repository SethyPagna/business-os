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
const shiftModal = read('src/components/shifts/ShiftHistoryModal.tsx')

let checks = 0
const ok = (cond: unknown, label: string) => {
  assert.ok(cond, label)
  checks += 1
  console.log(`  ok - ${label}`)
}

// ---- 1. The prompt is not dismissible -------------------------------------
// End-anchored on the DECLARATION, not the bare identifier: the identifier
// also appears in prose above the overlay, and anchoring on it silently
// collapsed this slice to empty (failing an unrelated check) the moment a
// comment mentioned the component by name.
const registerBlock = gate.slice(
  gate.indexOf('needsRegistration && ('),
  gate.indexOf('export function EndShiftButton'),
)
ok(registerBlock.length > 200, 'the registration overlay was located in the source')
ok(/onClose=\{\(\) => \{[^}]*\}\}/.test(registerBlock),
  'the registration prompt wires onClose to a no-op -- it cannot be dismissed')
ok(!/setNeedsRegistration|onClose=\{\(\) => set/.test(registerBlock),
  'and nothing in the overlay closes it locally without registering')

// ---- 2. A failed read must not read as registered --------------------------
// The catch drives the shared state to null, and the prompt condition is an
// explicit `=== true` on the server's own flag -- so null cannot satisfy it
// either way.
//
// Asserted on the BEHAVIOUR (the failure path ends at a null shift state), not
// on the spelling: this previously pinned the literal `setState(null)`, which
// went red when the two components were merged onto one shared store even
// though the behaviour was unchanged. A check that fails on a rename is
// pinning the implementation, not the rule.
ok(/catch\b[\s\S]{0,400}publishShift\(key, null\)/.test(gate),
  'a failed read resets shift state to null rather than assuming a shift exists')
ok(/needs_registration === true/.test(gate),
  'the prompt condition tests the server flag with ===, so null/undefined never suppresses it')
ok(/if \(!state\) throw new Error/.test(transport),
  'the transport throws when route() resolves null instead of returning a shapeless state')

// ---- 3. End Shift only exists while a shift is open ------------------------
// The TRIGGER is what carries "end only once": no open shift, no button. The
// PANEL is exempt, because the closing time only exists on the response to the
// close -- see section 3b. So the early return has to survive a shift that has
// just been closed while its summary is still on screen, and the button
// itself has to be gated separately.
ok(/const canCloseCurrent = state\?\.is_open === true && state\.shift\?\.capabilities\.can_close === true/.test(gate),
  'the current close action consumes the server can_close capability')
ok(/SHIFT_STATE_CHANGED_EVENT/.test(gate) && /addEventListener\(SHIFT_STATE_CHANGED_EVENT/.test(gate),
  'mounted current-shift consumers refresh after popup lifecycle writes')
ok(/if \(!canCloseCurrent && !closed\) return null/.test(gate),
  'EndShiftButton renders nothing when there is neither an open shift nor a summary to show')
const endIdx = gate.indexOf('if (!canCloseCurrent && !closed) return null')
ok(endIdx > 0 && gate.indexOf('<button', endIdx) > endIdx,
  'and the early return sits BEFORE the button markup, not after it')
ok(/\{canCloseCurrent && \(\s*\n\s*<button/.test(gate),
  'the End Shift button itself is gated on can_close -- a closed or foreign shift offers no press')

// ---- 3b. The shift's two moments are rendered, not implied -----------------
//
// The owner, 2026-09-04: "sales open and closing time... currently, it only
// shows open time". Before this, the close panel printed no formatted time at
// all -- the one thing on it that read as a time was the shift CODE
// (S-YYYYMMDD-HHMM, generated from opened_at), and the closing moment appeared
// nowhere, because the component unmounted itself the instant `can_end` went
// false and threw the close response away.
//
// So: both moments are formatted through the app's shared day-first 24-hour
// formatter, they are on screen from first paint (not after some field is
// answered), and the close keeps the panel up to show what was actually
// written.
const endBody = gate.slice(gate.indexOf('export function EndShiftButton'))
ok(/import \{ fmtDateTime24, parseServerTimestampMs \} from '\.\.\/\.\.\/utils\/formatters\.ts'/.test(gate),
  'times are formatted through the shared formatters, not a second local date format')
ok(/fmtDateTime24\(shift\.opened_at\)/.test(endBody),
  'the close panel prints the OPENING moment as a formatted date and time')
ok(/fmtDateTime24\(closed\?\.closed_at \|\| now\)/.test(endBody),
  'and the CLOSING moment: the stamped closed_at once it exists, the live clock before that')
ok(/setClosed\(next\.shift\)/.test(endBody),
  'a successful close keeps the server row so the panel can summarise it')
ok(!/publishShift\(next\)\s*\n\s*setOpen\(false\)/.test(endBody),
  'the close no longer discards its own response by closing the panel outright')
ok(/t\('shift_opened_with'\)/.test(endBody) && /t\('shift_counted_close'\)/.test(endBody),
  'the summary shows the drawer BEFORE (opening float) and AFTER (counted at close)')
ok(/dirty: !closed &&/.test(endBody),
  'and dismissing the summary raises no discard prompt -- there is nothing unsaved left')
// The registration prompt names the moment it is about to stamp too, so a
// device with a wrong clock is caught before the day is filed under it.
ok(/t\('shift_starts_at'\)/.test(registerBlock) && /fmtDateTime24\(now\)/.test(registerBlock),
  'the registration prompt shows the moment the shift will be opened at')
ok(/function useWallClock\(/.test(gate) && /window\.setInterval/.test(gate),
  'the not-yet-stamped moment is a live clock, not a value frozen when the panel opened')
ok(/parseShiftCount\(floatUsd\)/.test(gate) && /openingFloatUsd == null \|\| openingFloatKhr == null/.test(gate),
  'a new day rejects blank, invalid, infinite, and negative opening counts')
ok(/disabled=\{busy \|\| parseShiftCount\(floatUsd\) == null \|\| parseShiftCount\(floatKhr\) == null\}/.test(registerBlock),
  'the Start Shift control enables only for two finite non-negative native counts')
ok(/parseShiftCount\(countedUsd\)/.test(endBody) && /closingCountedUsd == null \|\| closingCountedKhr == null/.test(endBody),
  'current-day close also rejects blank, invalid, infinite, and negative counts')
ok(!/Number\((?:float|counted)[^)]+\) \|\| 0/.test(gate),
  'POS shift forms never coerce an invalid or blank count to zero')

// ---- 4. No offline mirror for a physical cash count ------------------------
for (const method of ['openShift', 'closeShift', 'amendShift', 'closeShiftById', 'reopenShift', 'cancelShift']) {
  const start = transport.indexOf(`export async function ${method}`)
  const end = transport.indexOf('\nexport ', start + 1)
  const body = transport.slice(start, end > start ? end : undefined)
  ok(start >= 0 && /null,\s*\n\s*true,/.test(body), `${method} is an online-only write with no offline fallback`)
}
// Comments stripped first: this file's own prose explains WHY there is no
// local fallback, and matching that prose would make the check pass or fail
// on the documentation rather than on the code.
const transportCode = transport
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
ok(/route<ShiftState>/.test(transportCode), 'comment stripping left the transport code intact')
ok(!/localFn|readLocal|offlineQueue|enqueue|localStorage/.test(transportCode),
  'the shift transport never queues or answers a shift from local storage')
// ---- 5. POS mounts the gate, current close, and persistent history --------
ok(/import ShiftGate, \{ EndShiftButton \} from '\.\/ShiftGate'/.test(pos),
  'POS imports the gate and the end-shift control')
ok(/<ShiftGate\b/.test(pos), 'POS mounts the registration prompt')
ok(/<EndShiftButton\b/.test(pos), 'POS mounts the End Shift control')
ok(/import ShiftHistoryPanel from '\.\.\/shifts\/ShiftHistoryPanel\.tsx'/.test(pos), 'POS imports the shared shift popup launcher')
ok(/<ShiftHistoryPanel branchId=\{primaryBranchFilterId\} compact label=\{t\('shift_code'\)\}/.test(pos),
  'POS keeps a Shift button visible independently of the current close capability')
ok(!/canCloseCurrent[\s\S]{0,300}<ShiftHistoryPanel/.test(pos), 'the persistent Shift button is not hidden behind the current-close condition')

// ---- 6. Every key the gate asks for exists in BOTH packs -------------------
// verify:i18n covers this repo-wide, but a shift key missing from km would
// show a raw snake_case string to a Khmer cashier at the one moment they
// cannot dismiss the dialog, so it is worth failing here too.
const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>
const used = [...new Set([...`${gate}\n${shiftModal}`.matchAll(/\bt\('([^']+)'\)/g)].map((m) => m[1]))]
ok(used.length >= 14, `the gate's translation keys were found (${used.length})`)
const missingEn = used.filter((k) => !(k in en))
const missingKm = used.filter((k) => !(k in km))
ok(missingEn.length === 0, `every key resolves in en.json${missingEn.length ? ': ' + missingEn.join(', ') : ''}`)
ok(missingKm.length === 0, `every key resolves in km.json${missingKm.length ? ': ' + missingKm.join(', ') : ''}`)
ok(used.every((k) => !k.includes('.')),
  'the gate uses flat snake_case keys, matching the packs (no dotted namespaces)')


// ---- 8. One shift state, not two -----------------------------------------
//
// The 2026-09-04 defect: ShiftGate and the End Shift control each held their
// own useState and each fetched once on mount. The control asked BEFORE the
// shift existed, got can_end:false, rendered nothing, and never asked again --
// registering the drawer updated only the gate's copy, so End Shift stayed
// invisible until a full page reload. Reported by the owner as "shift are not
// seen with option to close shift".
//
// The property that must hold: both components read ONE state, and every write
// publishes to it.
ok(/function useSharedShift\(/.test(gate), 'there is a single shared shift-state hook')
ok(/export function publishShift\(/.test(gate), 'and a single publish path for writes')
ok(/export function shiftCacheKey\(/.test(gate), 'the shared state has an explicit composite cache key')
ok(/userId[\s\S]{0,200}branchId[\s\S]{0,200}scopeMode/.test(gate), 'the cache key includes user, branch, and policy mode')
ok(/const sharedShifts = new Map<string, ShiftState \| null>/.test(gate), 'shift states are partitioned instead of one process-global row')
ok(/ShiftGate\(\{ children, branchId = null, branchName = null \}/.test(gate), 'the POS gate accepts the active branch identity')
ok(/EndShiftButton\(\{ onEnded, branchId = null \}/.test(gate), 'the close control accepts the same active branch identity')

{
  const gateStart = gate.indexOf('export default function ShiftGate')
  const endStart = gate.indexOf('export function EndShiftButton')
  ok(gateStart > 0 && endStart > gateStart, 'both component bodies were located')
  const bodies = [
    ['ShiftGate', gate.slice(gateStart, endStart)],
    ['EndShiftButton', gate.slice(endStart)],
  ] as const
  for (const [name, body] of bodies) {
    ok(/useSharedShift\(branchId, user\?\.id, settings\?\.shift_scope_mode\)/.test(body), name + ' reads the correctly scoped shared shift state')
    ok(!/useState<ShiftState/.test(body), name + ' keeps no private copy of the shift state')
    ok(!/fetchCurrentShift\(/.test(body), name + ' does not fetch the shift itself')
    // A write must reach the OTHER component, which only publishing does.
    ok(/publish\(next\)/.test(body), name + ' publishes its write, so the other surface updates at once')
  }
}

// Both components mount together on POS open, so the mount fetch is de-duped.
ok(/shiftInflight/.test(gate), 'the shared hook de-dupes the mount fetch per composite key')

// A failed read must still not read as "registered".
ok(/publishShift\(key, null\)/.test(gate), 'a failed shift read publishes null, never a registered-looking state')

console.log(`\nshiftGate: all ${checks} checks passed`)
