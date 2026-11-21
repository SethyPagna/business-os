import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  BELL_EVENT_MERGE_MS,
  BELL_FOLLOW_UP_JITTER_MS,
  BELL_FOLLOW_UP_MIN_DELAY_MS,
  BELL_FOLLOW_UP_SLACK_MS,
  createBellFollowUp,
  getSectionLifetimeSeconds,
  noteSectionLifetime,
} from '../src/api/bellFollowUp.ts'

// Bell catch-up (deploy 11, SPEC-bell-catchup.md section A). The panel keeps the device times of the sync events no read has covered yet. One timer fires at the
// oldest of them + the section lifetime + 25 s + jitter (0 to 20 s); the read it makes drops every event it covered and the timer re-arms for the oldest left.
// The lifetime comes from the summary answer (sectionLifetimeSeconds), never from a literal here. Every case asserts exact read times on a fake clock.

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r/g, '')
const K = (lifetime: number) => lifetime * 1000 + BELL_FOLLOW_UP_SLACK_MS

function harness(lifetime: number | null, options: { hidden?: boolean; random?: number | (() => number) } = {}) {
  let now = 0
  let nextId = 1
  const timers = new Map<number, { at: number; run: () => void }>()
  const state = {
    hidden: options.hidden ?? false,
    reloads: [] as number[],
    lifetime,
    random: options.random ?? 0,
    onReload: null as null | (() => void),
  }
  const followUp = createBellFollowUp({
    lifetimeSeconds: () => state.lifetime,
    now: () => now,
    random: () => (typeof state.random === 'function' ? state.random() : state.random),
    setTimer: (run, delayMs) => { const id = nextId++; timers.set(id, { at: now + delayMs, run }); return id },
    clearTimer: (handle) => { timers.delete(handle as number) },
    isHidden: () => state.hidden,
    reload: () => { state.reloads.push(now); state.onReload?.() },
  })
  const advanceTo = (target: number) => {
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      timers.delete(due[0])
      now = due[1].at
      due[1].run()
    }
    now = target
  }
  const advance = (ms: number) => advanceTo(now + ms)
  return { followUp, advance, advanceTo, state, now: () => now, timers: () => timers.size }
}

// 1. One event: one read at the oldest + L + 25 s + jitter, nothing after it.
{
  const h = harness(300)
  h.followUp.armAfterEvent()
  assert.equal(h.timers(), 1)
  h.advance(K(300) - 1)
  assert.deepEqual(h.state.reloads, [], 'not before lifetime + 25 s')
  h.advance(1)
  assert.deepEqual(h.state.reloads, [325_000], 'random 0: exactly at lifetime + 25 s')
  h.advance(3_600_000)
  assert.equal(h.state.reloads.length, 1, 'nothing after it: the read covered the only event')
  assert.equal(h.timers(), 0)
  assert.equal(h.followUp.isPending(), false)
  h.followUp.armAfterEvent()
  assert.equal(h.timers(), 1, 'a later event arms the next one')

  const half = harness(300, { random: 0.5 })
  half.followUp.armAfterEvent()
  half.advance(3_600_000)
  assert.deepEqual(half.state.reloads, [335_000], 'random 0.5: 10 s of jitter')

  const top = harness(300, { random: 0.999 })
  top.followUp.armAfterEvent()
  top.advance(3_600_000)
  assert.equal(top.state.reloads.length, 1)
  assert.ok(top.state.reloads[0] > 344_000 && top.state.reloads[0] < 345_000, 'random 0.999: just under the 20 s jitter cap ' + top.state.reloads[0])
  assert.equal(BELL_FOLLOW_UP_JITTER_MS, 20_000)
}
// 2. A burst longer than the lifetime: every event is followed by a read within [e + K, e + K + 20 s]; reads never exceed events.
{
  const h = harness(300, { random: 0.5 })
  const events: number[] = []
  for (let i = 0; i <= 20; i += 1) {
    events.push(h.now())
    h.followUp.armAfterEvent()
    h.advance(60_000)
  }
  h.advance(3_600_000)
  for (const e of events) {
    const reads = h.state.reloads.filter((r) => r >= e + K(300) && r <= e + K(300) + BELL_FOLLOW_UP_JITTER_MS)
    assert.ok(reads.length >= 1, 'event at ' + e + ' has a read inside its window; reads ' + h.state.reloads.join(','))
  }
  assert.ok(h.state.reloads.length <= events.length, 'reads ' + h.state.reloads.length + ' never exceed events ' + events.length)
  assert.equal(h.timers(), 0, 'and it ends')
}
// 3. An event while a timer is pending does not move it and is not lost: a second read follows for it.
{
  const h = harness(300)
  h.followUp.armAfterEvent()
  h.advance(250_000)
  h.followUp.armAfterEvent()
  assert.equal(h.timers(), 1, 'no second timer')
  h.advance(3_600_000)
  assert.deepEqual(h.state.reloads, [325_000, 575_000])
}
// 4. Covered by the same read: events 10 s apart with 15 s of jitter get one read.
{
  const h = harness(300, { random: 0.75 })
  h.followUp.armAfterEvent()
  h.advance(10_000)
  h.followUp.armAfterEvent()
  h.advance(3_600_000)
  assert.deepEqual(h.state.reloads, [340_000], 'the read started at 340 s covers everything up to 15 s')
}
// 5. An event that arrives while a read is in flight does not count as covered by it.
{
  const h = harness(300)
  h.followUp.armAfterEvent()
  let injected = false
  h.state.onReload = () => { if (!injected) { injected = true; h.followUp.armAfterEvent() } }
  h.advance(3_600_000)
  assert.deepEqual(h.state.reloads, [325_000, 650_000], 'the in-flight event gets its own read one window later')
}
// 6. A hidden tab: no read while hidden; an event while owed arms nothing; shown, one read, then a re-arm only for events newer than read start - K.
{
  const h = harness(300, { hidden: true })
  h.followUp.armAfterEvent()
  h.advance(400_000)
  assert.deepEqual(h.state.reloads, [], 'due while hidden: no read')
  assert.equal(h.followUp.isPending(), true, 'still owed')
  h.followUp.armAfterEvent()
  assert.equal(h.timers(), 0, 'an event while it is owed arms no timer')
  h.followUp.onVisible()
  assert.deepEqual(h.state.reloads, [], 'still hidden: onVisible waits')
  h.state.hidden = false
  h.followUp.onVisible()
  assert.deepEqual(h.state.reloads, [400_000], 'shown again: one read')
  h.followUp.onVisible()
  assert.deepEqual(h.state.reloads, [400_000], 'and only one')
  assert.equal(h.timers(), 1, 'the event kept while owed (400 s) is newer than 400 s - K, so it re-arms')
  h.advance(3_600_000)
  assert.deepEqual(h.state.reloads, [400_000, 725_000], 'and its read covers it')
  assert.equal(h.followUp.isPending(), false)

  const early = harness(300, { hidden: true })
  early.followUp.armAfterEvent()
  early.advance(100_000)
  early.state.hidden = false
  early.followUp.onVisible()
  assert.deepEqual(early.state.reloads, [], 'not due yet: showing the tab reads nothing')

  const late = harness(300, { hidden: true })
  late.followUp.armAfterEvent()
  late.advance(330_000)
  late.followUp.armAfterEvent()
  late.advanceTo(654_500)
  late.state.hidden = false
  late.followUp.onVisible()
  assert.deepEqual(late.state.reloads, [654_500])
  late.advance(3_600_000)
  assert.deepEqual(late.state.reloads, [654_500, 654_500 + BELL_FOLLOW_UP_MIN_DELAY_MS], 'a re-arm that is almost due waits at least the minimum delay')
}
// 7. Dispose clears the timer, the owed flag and the list: nothing runs afterwards and nothing old comes back.
{
  const h = harness(300)
  h.followUp.armAfterEvent()
  h.followUp.dispose()
  assert.equal(h.timers(), 0)
  h.advance(400_000)
  assert.equal(h.state.reloads.length, 0, 'nothing runs after dispose')
  h.followUp.armAfterEvent()
  h.advance(3_600_000)
  assert.deepEqual(h.state.reloads, [400_000 + 325_000], 'the list was cleared: only the new event is read for')

  const hidden = harness(300, { hidden: true })
  hidden.followUp.armAfterEvent()
  hidden.advance(330_000)
  hidden.followUp.dispose()
  hidden.state.hidden = false
  hidden.followUp.onVisible()
  assert.equal(hidden.state.reloads.length, 0, 'a deferred one is dropped by dispose too')
  assert.equal(hidden.followUp.isPending(), false)
}
// 8. No field (an older Worker during the rollover), or a useless one: no timer and nothing kept.
for (const lifetime of [null, 0, -5, Number.NaN]) {
  const h = harness(lifetime)
  h.followUp.armAfterEvent()
  assert.equal(h.timers(), 0, `lifetime ${lifetime}: no timer`)
  h.state.lifetime = 300
  h.advance(10_000)
  h.followUp.armAfterEvent()
  h.advance(3_600_000)
  assert.deepEqual(h.state.reloads, [10_000 + 325_000], `lifetime ${lifetime}: the earlier event was not kept`)
}
{
  const h = harness(300)
  h.followUp.armAfterEvent()
  h.state.lifetime = null
  h.advance(3_600_000)
  assert.equal(h.state.reloads.length, 1, 'the timer already armed still reads once')
  h.followUp.armAfterEvent()
  assert.equal(h.timers(), 0, 'and with the lifetime gone no new one is armed')
}
// 9. Events less than 1 s apart are one (the later one is kept); 1 s apart they are two. Observed through the owed path, where no timer is armed in between.
{
  const owedWith = (gap: number) => {
    const h = harness(300, { hidden: true })
    h.followUp.armAfterEvent()
    h.advance(400_000)
    h.followUp.armAfterEvent()
    h.advance(gap)
    h.followUp.armAfterEvent()
    h.state.hidden = false
    h.followUp.onVisible()
    h.advance(3_600_000)
    return h.state.reloads
  }
  assert.deepEqual(owedWith(BELL_EVENT_MERGE_MS - 600), [400_400, 400_400 + 325_000], 'merged into the later one: one more read, scheduled from it')
  assert.deepEqual(owedWith(BELL_EVENT_MERGE_MS), [401_000, 725_000, 726_000], 'a second apart: both kept, two more reads')
  const pending = harness(300)
  pending.followUp.armAfterEvent()
  pending.advance(400)
  pending.followUp.armAfterEvent()
  pending.advance(3_600_000)
  assert.deepEqual(pending.state.reloads, [325_000, 326_000], 'a merge does not move the timer already armed; the later event gets the next read')
}
// 10. The lifetime is the answer's, not a constant (the Free lifetime may differ).
{
  const h = harness(45, { random: 0.25 })
  h.followUp.armAfterEvent()
  h.advance(3_600_000)
  assert.deepEqual(h.state.reloads, [70_000 + 5_000], '45 s + 25 s + a quarter of the jitter')
}
noteSectionLifetime({ sections: [] })
assert.equal(getSectionLifetimeSeconds(), null, 'an answer without the field clears the lifetime')
noteSectionLifetime({ sectionLifetimeSeconds: 255 })
assert.equal(getSectionLifetimeSeconds(), 255)
noteSectionLifetime({ sectionLifetimeSeconds: 45 })
assert.equal(getSectionLifetimeSeconds(), 45)
noteSectionLifetime({ sectionLifetimeSeconds: 'x' })
assert.equal(getSectionLifetimeSeconds(), null)
noteSectionLifetime(null)
assert.equal(getSectionLifetimeSeconds(), null)

// 11. Source shape: a plain read on its own handle, fed by the answer, timed by the device's monotonic clock, with no lifetime literal.
const controller = read('../src/api/bellFollowUp.ts').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
assert.ok(!/\b(300|255|45|300_000|300000)\b/.test(controller), 'no lifetime literal in the helper')
assert.ok(!/fresh/i.test(controller), 'the follow-up asks for nothing fresh')
assert.ok(!/Date\.now|new Date/.test(controller), 'the controller reads only the injected clock')
assert.equal(BELL_FOLLOW_UP_SLACK_MS, 25_000)
const panel = read('../src/components/shared/NotificationCenter.tsx')
const effectStart = panel.indexOf('const bellFollowUpRef')
const effectEnd = panel.indexOf('}, [loadSummary, visibilityActive])', effectStart)
const effect = panel.slice(effectStart, effectEnd)
assert.ok(effectStart > 0 && effectEnd > effectStart, 'the follow-up effect exists')
assert.ok(/lifetimeSeconds: getSectionLifetimeSeconds/.test(effect), 'the lifetime comes from the answer')
assert.ok(/now: \(\) => performance\.now\(\)/.test(effect), 'the clock is the monotonic one')
assert.ok(/random: Math\.random/.test(effect), 'the jitter is Math.random')
assert.ok(/reload: \(\) => \{ if \(aliveRef\.current\) void loadSummary\(true\) \}/.test(effect), 'the follow-up is a plain loadSummary read')
assert.ok(/followUp\.dispose\(\)/.test(effect), 'unmount disposes it')
assert.ok(!/refreshTimerRef|scheduleRefresh/.test(effect), 'it never touches the idle timer')
assert.ok(/else scheduleRefresh\(plan\.delayMs\)\n\s*bellFollowUpRef\.current\?\.armAfterEvent\(\)/.test(panel), 'a listed sync event arms the follow-up after its own reload decision')
const noting = read('../src/api/notificationSummary.ts')
assert.ok(/apiFetch\('GET', bellPath\('\/api\/notifications\/summary', fresh\)\)\n\s*noteSectionLifetime\(result\)/.test(noting), 'the summary answer feeds the lifetime')

console.log('bellFollowUp.test.ts: ok')
