import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { changeReadSwitch, normalizeReadSwitches, targetState, type ReadSwitchFlowDeps, type ReadSwitchListing, type ReadSwitchRow } from '../src/components/server/readSwitchesFlow.ts'

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>

const listing: ReadSwitchListing = { epoch: 4, memoSeconds: 15, switches: [{ name: 'probe', state: 'off', rate: 0 }] }
const offRow: ReadSwitchRow = { name: 'probe', state: 'off', rate: 0 }
const onRow: ReadSwitchRow = { name: 'probe', state: 'on', rate: 0 }

function harness(overrides: Partial<ReadSwitchFlowDeps> = {}) {
  const log: string[] = []
  const sent: unknown[] = []
  const asked: Array<{ title: string; message: string }> = []
  const deps: ReadSwitchFlowDeps = {
    t: (key) => en[key],
    ask: async (request) => { log.push('ask'); asked.push(request); return true },
    set: async (payload) => { log.push('set'); sent.push(payload); return { success: true } },
    reload: async () => { log.push('reload') },
    notify: (message, type) => { log.push(`notify:${type}`); void message },
    ...overrides,
  }
  return { deps, log, sent, asked }
}

test('turning a switch ON or OFF asks through the shared dialog first, then sends the epoch this page loaded', async () => {
  for (const [row, state] of [[offRow, 'on'], [onRow, 'off']] as const) {
    const h = harness()
    assert.equal(await changeReadSwitch(h.deps, listing, row), 'changed')
    assert.deepEqual(h.log, ['ask', 'set', 'notify:success', 'reload'])
    assert.deepEqual(h.sent, [{ name: 'probe', state, expectedEpoch: 4 }])
    assert.match(h.asked[0].title, state === 'on' ? /^Turn on Test switch\?$/ : /^Turn off Test switch\?$/)
    assert.match(h.asked[0].message, /within 15 seconds/)
  }
})

test('cancelling the dialog sends nothing and changes nothing', async () => {
  const h = harness({ ask: async () => false })
  assert.equal(await changeReadSwitch(h.deps, listing, onRow), 'cancelled')
  assert.deepEqual(h.log, [])
  assert.deepEqual(h.sent, [])
})

test('a switch that is sampling (shadow) turns OFF, never ON; only OFF turns ON', () => {
  assert.equal(targetState({ name: 'probe', state: 'shadow', rate: 0.05 }), 'off')
  assert.equal(targetState(onRow), 'off')
  assert.equal(targetState(offRow), 'on')
})

test('a stale epoch (409) reloads the list and says so; the maintenance refusal says only Off is allowed; any other failure is an error', async () => {
  const stale = harness({ set: async () => { throw Object.assign(new Error('x'), { status: 409, code: 'read_switch_epoch_stale' }) } })
  assert.equal(await changeReadSwitch(stale.deps, listing, offRow), 'stale')
  assert.deepEqual(stale.log, ['ask', 'notify:warning', 'reload'])
  const held = harness({ set: async () => { throw Object.assign(new Error('x'), { status: 503, code: 'read_switch_maintenance' }) } })
  assert.equal(await changeReadSwitch(held.deps, listing, offRow), 'maintenance')
  assert.deepEqual(held.log, ['ask', 'notify:warning'])
  const failed = harness({ set: async () => { throw new Error('network') } })
  assert.equal(await changeReadSwitch(failed.deps, listing, offRow), 'failed')
  assert.deepEqual(failed.log, ['ask', 'notify:error'])
})

test('the listing reads only a well formed answer: an unknown state or a missing epoch is dropped, not guessed', () => {
  assert.equal(normalizeReadSwitches(null), null)
  assert.equal(normalizeReadSwitches({ switches: [] }), null)
  assert.equal(normalizeReadSwitches({ epoch: 1.5, switches: [] }), null)
  const parsed = normalizeReadSwitches({ epoch: 2, memoSeconds: 15, switches: [{ name: 'probe', state: 'ON' }, { name: 'probe', state: 'on', rate: 0 }, { state: 'on' }, null] })
  assert.deepEqual(parsed?.switches, [{ name: 'probe', state: 'on', rate: 0 }])
})

test('the list is mounted for administrators only, and the panel talks to the Worker only through the confirmed flow', () => {
  const page = read('../src/components/server/ServerPage.tsx')
  assert.match(page, /\{isAdminControlUser\(user\) \? <ReadSwitchesPanel \/> : null\}/)
  const panel = read('../src/components/server/ReadSwitchesPanel.tsx')
  assert.match(panel, /useConfirmDialog/)
  assert.doesNotMatch(panel, /window\.confirm|\bconfirm\(/)
  assert.equal((panel.match(/setReadSwitch\(/g) || []).length, 1, 'one write call, inside the confirmed flow')
  assert.match(panel, /ask: \(request\) => askToConfirm\(request\)/)
})

test('button policy: the per-row control is icon-only with a translated tooltip and label', () => {
  const panel = read('../src/components/server/ReadSwitchesPanel.tsx')
  assert.match(panel, /title=\{action\} aria-label=\{action\}/)
  assert.doesNotMatch(panel, /<button[^>]*>\s*\{?[^<]*[A-Za-z]{3,}[^<]*<\/button>/, 'no text on the row button')
})

test('every key the panel and the flow use exists in both language packs, in a form that is not the English text', () => {
  const sources = read('../src/components/server/ReadSwitchesPanel.tsx') + read('../src/components/server/readSwitchesFlow.ts')
  const used = new Set([...sources.matchAll(/'(read_switch[a-z_]*)'/g)].map((m) => m[1]))
  for (const key of ['read_switches_title', 'read_switches_desc', 'read_switch_turn_on', 'read_switch_turn_off', 'read_switch_changed', 'read_switch_stale', 'read_switch_failed', 'read_switch_maintenance', 'read_switch_load_failed', 'read_switch_confirm_on', 'read_switch_confirm_off', 'read_switch_confirm_note', 'read_switch_name_probe', 'read_switch_state_off', 'read_switch_state_on', 'read_switch_state_shadow']) {
    assert.ok(typeof en[key] === 'string' && en[key].length > 0, `en has ${key}`)
    assert.ok(typeof km[key] === 'string' && km[key].length > 0, `km has ${key}`)
    assert.notEqual(km[key], en[key], `km ${key} is translated`)
  }
  for (const key of used) if (key !== 'read_switch_epoch_stale') assert.ok(en[key] && km[key], `${key} is in both packs`)
  assert.equal(km.read_switch_confirm_note.includes('{n}'), true, 'the placeholder survives in km')
  assert.equal(km.read_switch_confirm_on.includes('{name}'), true)
})
