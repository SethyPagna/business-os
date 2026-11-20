import assert from 'node:assert/strict'
import fs from 'node:fs'
import { BELL_FOLLOW_UP_SLACK_MS, createBellFollowUp, getSectionLifetimeSeconds, noteSectionLifetime } from '../src/api/bellFollowUp.ts'

// Lead decision, 21 Nov (reviewer C-A): after a reload a sync-channel event caused, the panel makes ONE plain follow-up read at
// (section lifetime + 5 s), so a device whose reload was served an entry older than the event still converges within the lifetime.
// The lifetime comes from the summary answer (sectionLifetimeSeconds), never from a literal here.

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r/g, '')

function harness(lifetime: number | null, hidden = false) {
  let now = 0
  let nextId = 1
  const timers = new Map<number, { at: number; run: () => void }>()
  const state = { hidden, reloads: [] as number[], lifetime }
  const followUp = createBellFollowUp({
    lifetimeSeconds: () => state.lifetime,
    setTimer: (run, delayMs) => { const id = nextId++; timers.set(id, { at: now + delayMs, run }); return id },
    clearTimer: (handle) => { timers.delete(handle as number) },
    isHidden: () => state.hidden,
    reload: () => { state.reloads.push(now) },
  })
  const advance = (ms: number) => {
    const target = now + ms
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      timers.delete(due[0])
      now = due[1].at
      due[1].run()
    }
    now = target
  }
  return { followUp, advance, state, timers: () => timers.size }
}

// 1. One follow-up at lifetime + 5 s, and it is a single read.
{
  const h = harness(300)
  h.followUp.armAfterEvent()
  assert.equal(h.timers(), 1)
  h.advance(300_000 + BELL_FOLLOW_UP_SLACK_MS - 1)
  assert.deepEqual(h.state.reloads, [], 'not before lifetime + 5 s')
  h.advance(1)
  assert.deepEqual(h.state.reloads, [305_000], 'exactly at lifetime + 5 s')
  h.advance(3_600_000)
  assert.equal(h.state.reloads.length, 1, 'it does not repeat or reschedule itself')
  assert.equal(h.timers(), 0)
  assert.equal(h.followUp.isPending(), false)
  h.followUp.armAfterEvent()
  assert.equal(h.timers(), 1, 'a later event arms the next one')
}
// the Free lifetime is whatever the answer says, not a constant
{
  const h = harness(45)
  h.followUp.armAfterEvent()
  h.advance(49_999)
  assert.equal(h.state.reloads.length, 0)
  h.advance(1)
  assert.deepEqual(h.state.reloads, [50_000], 'the lifetime in the answer is used (45 s + 5 s)')
}
// 2. Events during the wait neither extend nor duplicate it.
{
  const h = harness(300)
  h.followUp.armAfterEvent()
  h.advance(100_000)
  h.followUp.armAfterEvent()
  h.followUp.armAfterEvent()
  assert.equal(h.timers(), 1, 'no second timer')
  h.advance(205_000 - 1)
  assert.equal(h.state.reloads.length, 0, 'an event did not move it later')
  h.advance(1)
  assert.deepEqual(h.state.reloads, [305_000], 'it ran at the ORIGINAL time, once')
}
// 3. The controller owns its handle alone: the panel's other timers (loadSummary re-arming the idle refresh) are not its handle.
{
  const h = harness(300)
  h.followUp.armAfterEvent()
  const idle = setTimeout(() => {}, 0)
  clearTimeout(idle)
  assert.equal(h.timers(), 1)
  assert.equal(h.followUp.isPending(), true)
}
// 4. Unmount clears it.
{
  const h = harness(300)
  h.followUp.armAfterEvent()
  h.followUp.dispose()
  assert.equal(h.timers(), 0)
  h.advance(400_000)
  assert.equal(h.state.reloads.length, 0, 'nothing runs after dispose')
  const hidden = harness(300, true)
  hidden.followUp.armAfterEvent()
  hidden.advance(310_000)
  hidden.followUp.dispose()
  hidden.state.hidden = false
  hidden.followUp.onVisible()
  assert.equal(hidden.state.reloads.length, 0, 'a deferred one is dropped by dispose too')
}
// 5. A hidden tab defers it until the tab is shown; if it was not yet due, showing the tab does nothing.
{
  const h = harness(300, true)
  h.followUp.armAfterEvent()
  h.advance(100_000)
  h.state.hidden = false
  h.followUp.onVisible()
  assert.equal(h.state.reloads.length, 0, 'not due yet: showing the tab reads nothing')
  h.state.hidden = true
  h.advance(205_000)
  assert.equal(h.state.reloads.length, 0, 'due while hidden: no read')
  assert.equal(h.followUp.isPending(), true, 'still owed')
  h.followUp.armAfterEvent()
  assert.equal(h.timers(), 0, 'an event while it is owed arms nothing more')
  h.followUp.onVisible()
  assert.equal(h.state.reloads.length, 0, 'still hidden: onVisible waits')
  h.state.hidden = false
  h.followUp.onVisible()
  assert.equal(h.state.reloads.length, 1, 'shown again: one read')
  h.followUp.onVisible()
  assert.equal(h.state.reloads.length, 1, 'and only one')
  assert.equal(h.followUp.isPending(), false)
}
// 6. No field (an older Worker during the rollover), or a useless one, means no follow-up.
for (const lifetime of [null, 0, -5, Number.NaN]) {
  const h = harness(lifetime)
  h.followUp.armAfterEvent()
  assert.equal(h.timers(), 0, `lifetime ${lifetime}: no timer`)
}
noteSectionLifetime({ sections: [] })
assert.equal(getSectionLifetimeSeconds(), null, 'an answer without the field clears the lifetime')
noteSectionLifetime({ sectionLifetimeSeconds: 300 })
assert.equal(getSectionLifetimeSeconds(), 300)
noteSectionLifetime({ sectionLifetimeSeconds: 45 })
assert.equal(getSectionLifetimeSeconds(), 45)
noteSectionLifetime({ sectionLifetimeSeconds: 'x' })
assert.equal(getSectionLifetimeSeconds(), null)
noteSectionLifetime(null)
assert.equal(getSectionLifetimeSeconds(), null)

// 7. Source shape: the follow-up is a plain read on its own handle, fed by the answer, with no lifetime literal.
const controller = read('../src/api/bellFollowUp.ts').replace(/\/\/.*$/gm, '')
assert.ok(!/\b(300|45|300_000|300000)\b/.test(controller), 'no lifetime literal in the helper')
assert.ok(!/fresh/i.test(controller), 'the follow-up asks for nothing fresh')
const panel = read('../src/components/shared/NotificationCenter.tsx')
const effectStart = panel.indexOf('const bellFollowUpRef')
const effectEnd = panel.indexOf('}, [loadSummary, visibilityActive])', effectStart)
const effect = panel.slice(effectStart, effectEnd)
assert.ok(effectStart > 0 && effectEnd > effectStart, 'the follow-up effect exists')
assert.ok(/lifetimeSeconds: getSectionLifetimeSeconds/.test(effect), 'the lifetime comes from the answer')
assert.ok(/reload: \(\) => \{ if \(aliveRef\.current\) void loadSummary\(true\) \}/.test(effect), 'the follow-up is a plain loadSummary read')
assert.ok(/followUp\.dispose\(\)/.test(effect), 'unmount disposes it')
assert.ok(!/refreshTimerRef|scheduleRefresh/.test(effect), 'it never touches the idle timer')
assert.ok(/else scheduleRefresh\(plan\.delayMs\)\n\s*bellFollowUpRef\.current\?\.armAfterEvent\(\)/.test(panel), 'a listed sync event arms the follow-up after its own reload decision')
const noting = read('../src/api/notificationSummary.ts')
assert.ok(/apiFetch\('GET', bellPath\('\/api\/notifications\/summary', fresh\)\)\n\s*noteSectionLifetime\(result\)/.test(noting), 'the summary answer feeds the lifetime')

console.log('bellFollowUp.test.ts: ok')
