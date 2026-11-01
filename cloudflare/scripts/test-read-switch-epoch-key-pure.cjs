'use strict'
// A flip rotates the key salt: what a buggy producer cached before an OFF can never be reached after a later ON.
// The salt is derived from the stored epoch, which the flip serializer raises by one, so off-then-on always lands on a
// salt no earlier entry carries.
//
// Run: node scripts/test-read-switch-epoch-key-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function load(relative, requireFor = require) {
  const filename = path.join(__dirname, '..', 'src', relative)
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename })
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(mod.exports, requireFor, mod, filename, path.dirname(filename))
  return mod.exports
}
const sw = load('lib/readSwitches.ts', (id) => (id === './db' ? { getDb() { throw new Error('no database') } } : id === './analytics' ? { recordAnalytics() {} } : require(id)))

let clock = 1_000_000
const store = sw.createReadSwitchStore({ now: () => clock })
let raw = null
let passed = 0
function check(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`) }
function flip(token, setBy = 1) {
  const previous = sw.parseReadSwitches(raw)
  raw = sw.serializeReadSwitches(raw, { name: 'probe', entry: sw.parseFlipState(token) }, { epoch: previous.epoch + 1, setAt: new Date(clock).toISOString(), setBy })
  store.prime(sw.parseReadSwitches(raw))
  return store.salt()
}

check('off then on gives a salt no earlier entry carries, and every flip gives a new one', () => {
  const salts = [flip('on'), flip('off'), flip('on'), flip('shadow:0.05'), flip('off'), flip('on')]
  assert.deepEqual(salts, ['sw1', 'sw2', 'sw3', 'sw4', 'sw5', 'sw6'])
  assert.equal(new Set(salts).size, salts.length)
})
check('the salt follows the stored epoch only: the same state under a new epoch is a new salt', () => {
  const before = store.salt()
  assert.notEqual(flip('on'), before)
})
check('two states under one epoch share a salt (the epoch is the only input), so the route must raise the epoch on every state change', () => {
  const a = sw.createReadSwitchStore({ now: () => clock })
  const b = sw.createReadSwitchStore({ now: () => clock })
  a.prime(sw.parseReadSwitches(JSON.stringify({ epoch: 4, switches: { probe: 'on' } })))
  b.prime(sw.parseReadSwitches(JSON.stringify({ epoch: 4, switches: { probe: 'off' } })))
  assert.equal(a.salt(), b.salt())
})
check('a salt is only offered for a fresh readable memo (null is "compute uncached, store nothing")', () => {
  clock += 15_000
  assert.equal(store.salt(), null)
  assert.equal(sw.createReadSwitchStore({ now: () => clock }).salt(), null)
})
check('source: the salt is built from the memo epoch with no constant fallback', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'readSwitches.ts'), 'utf8').replace(/\r\n/g, '\n')
  assert.match(source, /salt\(\): string \| null \{ return memo && memo\.readable && fresh\(now\(\)\) \? `sw\$\{memo\.value\.epoch\}` : null \}/)
  assert.ok(!/sw0/.test(source), 'no zero-token fallback')
})
console.log(`${passed} checks passed`)
