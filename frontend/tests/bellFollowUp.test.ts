import assert from 'node:assert/strict'
import fs from 'node:fs'
import { BELL_FOLLOW_UP_JITTER_MS, createBellFollowUp, getSectionLifetimeSeconds, noteSectionLifetime, onBellAnswer } from '../src/api/bellFollowUp.ts'

// Lead decisions, 21 Nov (reviewer C-A, N-B1, N-B2): the panel remembers the latest sync event it saw. Whenever a bell answer arrives that is OLDER than that
// event, the device is still behind, and ONE plain reload is armed for when that answer's entry will have expired (its generatedAt + the section lifetime + 5 s +
// a 0-30 s jitter), never sooner than 1 s from now. An answer not older than the event arms nothing. The lifetime comes from the summary answer, never a literal here.

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r/g, '')
const T0 = 1_800_000_000_000
const S = 1000

// Time `t` is true time in ms since T0. The Worker's clock is true time; the device clock reads t + skew.
function harness(lifetime: number | null, options: { hidden?: boolean; skew?: number; jitter?: number; answerAge?: number } = {}) {
  let t = 0
  let nextId = 1
  const timers = new Map<number, { at: number; run: () => void }>()
  const state = { hidden: options.hidden === true, reloads: [] as number[], lifetime, jitter: options.jitter ?? 0, randomCalls: 0, delays: [] as number[] }
  const skew = options.skew ?? 0
  const followUp = createBellFollowUp({
    lifetimeSeconds: () => state.lifetime,
    setTimer: (run, delayMs) => { const id = nextId++; state.delays.push(delayMs); timers.set(id, { at: t + delayMs, run }); return id },
    clearTimer: (handle) => { timers.delete(handle as number) },
    isHidden: () => state.hidden,
    reload: () => { state.reloads.push(t); if (options.answerAge !== undefined) followUp.onAnswer(T0 + t - options.answerAge) },
    now: () => T0 + t + skew,
    random: () => { state.randomCalls += 1; return state.jitter },
  })
  const advance = (ms: number) => {
    const target = t + ms
    for (;;) {
      const due = [...timers.entries()].filter(([, x]) => x.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      timers.delete(due[0])
      t = due[1].at
      due[1].run()
    }
    t = target
  }
  const answerAged = (ageMs: number) => followUp.onAnswer(T0 + t - ageMs)
  return { followUp, advance, answerAged, state, timers: () => timers.size }
}

// 1. The event's own answer is older than the event: one follow-up, timed from that answer's generatedAt (not from now), and a single read.
{
  const h = harness(300)
  h.followUp.noteEvent()
  h.answerAged(100 * S)
  assert.equal(h.timers(), 1)
  h.advance(205 * S - 1)
  assert.deepEqual(h.state.reloads, [], 'not before generatedAt + 300 s + 5 s (205 s from now)')
  h.advance(1)
  assert.deepEqual(h.state.reloads, [205 * S], 'exactly at generatedAt + lifetime + 5 s')
  h.answerAged(0)
  assert.equal(h.timers(), 0, 'the follow-up answer is newer than the event: nothing more is armed')
  h.advance(3_600 * S)
  assert.equal(h.state.reloads.length, 1, 'it does not repeat')
  assert.equal(h.followUp.isPending(), false)
}
// the lifetime is whatever the answer says, not a constant; and the 1 s floor
{
  const h = harness(45)
  h.followUp.noteEvent()
  h.answerAged(10 * S)
  h.advance(40 * S - 1)
  assert.equal(h.state.reloads.length, 0)
  h.advance(1)
  assert.deepEqual(h.state.reloads, [40 * S], 'the lifetime in the answer is used (45 s + 5 s - 10 s old)')
  const floor = harness(300)
  floor.followUp.noteEvent()
  floor.answerAged(304 * S + 500)
  assert.deepEqual(floor.state.delays, [S], 'an entry about to expire is still asked for no sooner than 1 s from now')
}
// 2. An answer that is not older than the latest event arms nothing; so does an answer before any event, and one with no time.
{
  const h = harness(300)
  h.answerAged(100 * S)
  assert.equal(h.timers(), 0, 'no event seen yet: an idle read arms nothing')
  h.advance(10 * S)
  h.followUp.noteEvent()
  h.answerAged(0)
  assert.equal(h.timers(), 0, 'generatedAt equal to the event: not older')
  h.answerAged(-S)
  assert.equal(h.timers(), 0, 'newer than the event')
  h.followUp.onAnswer(null)
  assert.equal(h.timers(), 0, 'an answer without a time says nothing')
  h.followUp.onAnswer(Number.NaN)
  assert.equal(h.timers(), 0)
}
// 3. A second event during the wait, answered stale: exactly one more reload, timed from THAT answer's generatedAt. Never two timers.
{
  const h = harness(300)
  h.followUp.noteEvent()
  h.answerAged(100 * S)
  h.advance(100 * S)
  h.followUp.noteEvent()
  h.answerAged(80 * S)
  h.answerAged(90 * S)
  assert.equal(h.timers(), 1, 'stale answers while one is pending add no second timer')
  assert.equal(h.state.delays.length, 1)
  h.advance(105 * S - 1)
  assert.equal(h.state.reloads.length, 0, 'the second event did not move it')
  h.advance(1)
  assert.deepEqual(h.state.reloads, [205 * S], 'the pending follow-up ran at its own time, once')
  h.answerAged(150 * S)
  assert.equal(h.timers(), 1, 'its answer is an entry from before the second event: one more is armed')
  assert.equal(h.state.delays[1], 155 * S, 'timed from that answer: generatedAt + 300 s + 5 s')
  h.advance(155 * S - 1)
  assert.equal(h.state.reloads.length, 1)
  h.advance(1)
  assert.deepEqual(h.state.reloads, [205 * S, 360 * S])
  h.answerAged(0)
  assert.equal(h.timers(), 0, 'the entry is now newer than both events: converged')
  h.advance(3_600 * S)
  assert.equal(h.state.reloads.length, 2)
}
// an older event never lowers the latest one
{
  const h = harness(300)
  h.followUp.noteEvent(T0 + 50 * S)
  h.followUp.noteEvent(T0 + 10 * S)
  h.advance(60 * S)
  h.answerAged(5 * S)
  assert.equal(h.timers(), 0, 'an answer from 55 s is newer than the 50 s event')
  h.answerAged(20 * S)
  assert.equal(h.timers(), 1, 'an answer from 40 s is older than the 50 s event')
}
// 4. Device clock 10 minutes AHEAD: one event leads to at most 2 follow-ups, no loop.
{
  const h = harness(300, { skew: 600 * S, answerAge: 0 })
  h.followUp.noteEvent()
  h.answerAged(100 * S)
  for (let i = 0; i < 50; i += 1) { h.advance(300 * S); h.answerAged(0) }
  assert.ok(h.state.reloads.length >= 1 && h.state.reloads.length <= 2, `ahead 10 min: ${h.state.reloads.length} follow-ups`)
  assert.equal(h.state.delays[0], 305 * S, 'a disagreeing clock waits a whole lifetime from now')
}
// a device an hour ahead would keep seeing every answer as older than its event: still one follow-up, not one per lifetime
{
  const h = harness(300, { skew: 3600 * S, answerAge: 0 })
  h.followUp.noteEvent()
  h.answerAged(100 * S)
  for (let i = 0; i < 100; i += 1) h.advance(300 * S)
  assert.equal(h.state.reloads.length, 1, 'ahead 1 h: ' + h.state.reloads.length + ' follow-ups')
}
// a smaller skew that goes undetected and gets the same entry back: still at most 2
{
  const h = harness(300, { skew: 100 * S })
  h.followUp.noteEvent()
  const entryAt = T0 - 50 * S
  h.followUp.onAnswer(entryAt)
  h.advance(155 * S)
  assert.equal(h.state.reloads.length, 1, 'early by the skew')
  h.followUp.onAnswer(entryAt)
  for (let i = 0; i < 50; i += 1) { h.advance(300 * S); h.answerAged(0) }
  assert.ok(Number(h.state.reloads.length) === 2, `ahead 100 s: ${h.state.reloads.length} follow-ups`)
}
// 5. Device clock 10 minutes BEHIND: bounded too (the device-clock event is early, so the answer is not older and nothing is armed).
{
  const h = harness(300, { skew: -600 * S })
  h.followUp.noteEvent()
  h.answerAged(100 * S)
  for (let i = 0; i < 50; i += 1) { h.advance(300 * S); h.answerAged(0) }
  assert.ok(h.state.reloads.length <= 2, `behind 10 min: ${h.state.reloads.length} follow-ups`)
  // with the broadcast's own server time the staleness is seen even then
  const s = harness(300, { skew: -600 * S, answerAge: 0 })
  s.followUp.noteEvent(new Date(T0).toISOString())
  s.advance(10 * S)
  s.answerAged(100 * S)
  for (let i = 0; i < 50; i += 1) { s.advance(300 * S); s.answerAged(0) }
  assert.ok(s.state.reloads.length >= 1 && s.state.reloads.length <= 2, `behind 10 min with server time: ${s.state.reloads.length} follow-ups`)
}
// 6. Jitter: base + injected jitter, drawn once per arming.
{
  const h = harness(300, { jitter: 0.5 })
  h.followUp.noteEvent()
  h.answerAged(100 * S)
  assert.equal(h.state.delays[0], 205 * S + 0.5 * BELL_FOLLOW_UP_JITTER_MS, 'delay = base + injected jitter')
  assert.equal(h.state.randomCalls, 1, 'drawn once for this arming')
  h.answerAged(100 * S)
  h.answerAged(100 * S)
  assert.equal(h.state.randomCalls, 1, 'answers while pending draw nothing')
  assert.equal(BELL_FOLLOW_UP_JITTER_MS, 30000)
  const top = harness(300, { jitter: 1 })
  top.followUp.noteEvent()
  top.answerAged(100 * S)
  assert.equal(top.state.delays[0], 205 * S + 30 * S, 'jitter spans 0 to 30 s')
}
// 7. The controller owns its handle alone.
{
  const h = harness(300)
  h.followUp.noteEvent()
  h.answerAged(100 * S)
  const idle = setTimeout(() => {}, 0)
  clearTimeout(idle)
  assert.equal(h.timers(), 1)
  assert.equal(h.followUp.isPending(), true)
}
// 8. Unmount clears it, and drops a deferred one too.
{
  const h = harness(300)
  h.followUp.noteEvent()
  h.answerAged(100 * S)
  h.followUp.dispose()
  assert.equal(h.timers(), 0)
  h.advance(400 * S)
  assert.equal(h.state.reloads.length, 0, 'nothing runs after dispose')
  const hidden = harness(300, { hidden: true })
  hidden.followUp.noteEvent()
  hidden.answerAged(100 * S)
  hidden.advance(210 * S)
  hidden.followUp.dispose()
  hidden.state.hidden = false
  hidden.followUp.onVisible()
  assert.equal(hidden.state.reloads.length, 0, 'a deferred one is dropped by dispose too')
}
// 9. A hidden tab defers it until the tab is shown; if it was not yet due, showing the tab does nothing.
{
  const h = harness(300, { hidden: true })
  h.followUp.noteEvent()
  h.answerAged(100 * S)
  h.advance(100 * S)
  h.state.hidden = false
  h.followUp.onVisible()
  assert.equal(h.state.reloads.length, 0, 'not due yet: showing the tab reads nothing')
  h.state.hidden = true
  h.advance(105 * S)
  assert.equal(h.state.reloads.length, 0, 'due while hidden: no read')
  assert.equal(h.followUp.isPending(), true, 'still owed')
  h.answerAged(100 * S)
  assert.equal(h.timers(), 0, 'an answer while it is owed arms nothing more')
  h.followUp.onVisible()
  assert.equal(h.state.reloads.length, 0, 'still hidden: onVisible waits')
  h.state.hidden = false
  h.followUp.onVisible()
  assert.equal(h.state.reloads.length, 1, 'shown again: one read')
  h.followUp.onVisible()
  assert.equal(h.state.reloads.length, 1, 'and only one')
  assert.equal(h.followUp.isPending(), false)
}
// 10. No lifetime field (an older Worker during the rollover) or a useless one: NO timer, whatever the generatedAt and the events (the pinned-alert spec relies on it).
for (const lifetime of [null, 0, -5, Number.NaN]) {
  const h = harness(lifetime)
  h.followUp.noteEvent()
  h.answerAged(100 * S)
  assert.equal(h.timers(), 0, `lifetime ${lifetime}: no timer`)
  h.advance(10 * S)
  h.followUp.noteEvent()
  h.answerAged(3_600 * S)
  assert.equal(h.timers(), 0, `lifetime ${lifetime}: still none after a later event and a past generatedAt`)
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
// every answer is announced with its generatedAt, until the listener is removed
{
  const seen: Array<number | null> = []
  const stop = onBellAnswer((at) => { seen.push(at) })
  noteSectionLifetime({ sectionLifetimeSeconds: 300, generatedAt: new Date(T0).toISOString() })
  noteSectionLifetime({ sectionLifetimeSeconds: 300 })
  stop()
  noteSectionLifetime({ sectionLifetimeSeconds: 300, generatedAt: new Date(T0).toISOString() })
  assert.deepEqual(seen, [T0, null])
}

// 11. Source shape: the follow-up is a plain read on its own handle, fed by the answers, with no lifetime literal; loadSummary's own timers are untouched.
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
assert.ok(/onBellAnswer\(\(generatedAtMs\) => followUp\.onAnswer\(generatedAtMs\)\)/.test(effect), 'every bell answer reaches the controller')
assert.ok(/followUp\.dispose\(\)/.test(effect) && /stopAnswers\(\)/.test(effect), 'unmount disposes it and stops listening')
assert.ok(!/refreshTimerRef|scheduleRefresh/.test(effect), 'it never touches the idle timer')
assert.ok(/else scheduleRefresh\(plan\.delayMs\)\n\s*bellFollowUpRef\.current\?\.noteEvent\(syncChannel\.serverTime\)/.test(panel), 'a listed sync event is noted after its own reload decision, with the broadcast server time')
assert.ok(!/BELL_FOLLOW_UP_JITTER_MS|Math\.random/.test(panel.replace(effect, '')), 'no jitter anywhere in the panel outside the follow-up effect')
const noting = read('../src/api/notificationSummary.ts')
assert.ok(/apiFetch\('GET', bellPath\('\/api\/notifications\/summary', fresh\)\)\n\s*noteSectionLifetime\(result\)/.test(noting), 'the summary answer feeds the lifetime and the controller')

console.log('bellFollowUp.test.ts: ok')
