'use strict'
// Count tasks, the property tester's mutants: each plant (planted in the Worker source at load time by test-inventory-check-tasks-property-native.cjs --mutant=NAME) must be FOUND by the
// random sequences within a few seeds. A plant the sequences do not find, a crash and an unmatched anchor are all red. The unmutated run is the control and must stay green.
// Run: node scripts/test-inventory-check-tasks-property-mutants-native.cjs
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const property = path.join(__dirname, 'test-inventory-check-tasks-property-native.cjs')
const NAMES = ['set-autoclose', 'undo-ticks', 'undo-no-takeback', 'redo-now', 'reopen-hand', 'plain-revert-no-takeback', 'cap-outside']
const FOCUS = { 'reopen-hand': ['--focus=takeback'], 'plain-revert-no-takeback': ['--focus=takeback'], 'undo-no-takeback': ['--focus=takeback'], 'cap-outside': ['--focus=cap'] } // the sequences that reach the plant: a take-back of a closed task, a race for the last slot
const run = (args) => spawnSync(process.execPath, [property, ...args], { encoding: 'utf8', timeout: 540000, maxBuffer: 64 * 1024 * 1024 })
const failures = []
for (const name of NAMES) {
  const r = run([`--mutant=${name}`, '--seeds=1..12', '--steps=60', ...(FOCUS[name] || [])])
  const out = `${r.stdout || ''}${r.stderr || ''}`
  const unmatched = /source edit must match once/.test(out), found = r.status === 0 && /MUTANT \S+ FOUND/.test(out) && /seed \d+: FAIL at step/.test(out) // the property run exits 0 when it found the plant
  if (unmatched || !found) { failures.push(name); console.log(`RED ${name}: ${unmatched ? 'its anchor no longer matches' : `not found (exit ${r.status})`}`); continue }
  console.log(`KILLED ${name}`)
}
if (failures.length) { console.log(`\n${failures.length} plant(s) survived or crashed: ${failures.join(', ')}`); process.exit(1) }
console.log(`\nall ${NAMES.length} plants found`)
