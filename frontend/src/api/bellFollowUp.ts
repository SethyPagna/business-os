// A reload for a sync event can be served a section entry older than the event; the Worker keeps an entry for the lifetime the summary answer states, counted from
// the start of its computation. So a plain read that starts at least that lifetime (plus slack) after an event includes it. The panel keeps the device times of the
// events no read has covered yet, and one timer fires for the oldest of them; a read then drops every event it covered and the timer re-arms for the oldest left.
export const BELL_FOLLOW_UP_SLACK_MS = 25_000
export const BELL_FOLLOW_UP_JITTER_MS = 20_000
export const BELL_FOLLOW_UP_MIN_DELAY_MS = 1_000
export const BELL_EVENT_MERGE_MS = 1_000

let sectionLifetimeSeconds: number | null = null

export function noteSectionLifetime(answer: unknown): void {
  const value = Number((answer as { sectionLifetimeSeconds?: unknown } | null)?.sectionLifetimeSeconds)
  sectionLifetimeSeconds = Number.isFinite(value) && value > 0 ? value : null
}

export function getSectionLifetimeSeconds(): number | null {
  return sectionLifetimeSeconds
}

export type BellFollowUpDeps = {
  lifetimeSeconds: () => number | null
  /** Monotonic milliseconds: only times taken on this device are compared. */
  now: () => number
  /** In [0, 1). */
  random: () => number
  setTimer: (run: () => void, delayMs: number) => unknown
  clearTimer: (handle: unknown) => void
  isHidden: () => boolean
  reload: () => void
}

export type BellFollowUp = {
  armAfterEvent: () => void
  onVisible: () => void
  isPending: () => boolean
  dispose: () => void
}

const validLifetime = (seconds: number | null): seconds is number => seconds !== null && Number.isFinite(seconds) && seconds > 0

export function createBellFollowUp(deps: BellFollowUpDeps): BellFollowUp {
  let events: number[] = []
  let handle: unknown = null
  let owed = false
  let reading = false
  const coverage = (seconds: number) => seconds * 1000 + BELL_FOLLOW_UP_SLACK_MS

  const schedule = () => {
    if (events.length === 0) return
    const seconds = deps.lifetimeSeconds()
    if (!validLifetime(seconds)) {
      events = []
      return
    }
    const delay = Math.max(BELL_FOLLOW_UP_MIN_DELAY_MS, events[0] + coverage(seconds) + deps.random() * BELL_FOLLOW_UP_JITTER_MS - deps.now())
    handle = deps.setTimer(run, delay)
  }
  const read = () => {
    const startedAt = deps.now()
    reading = true
    try { deps.reload() } finally { reading = false }
    const seconds = deps.lifetimeSeconds()
    events = validLifetime(seconds) ? events.filter((at) => at > startedAt - coverage(seconds)) : []
    schedule()
  }
  const run = () => {
    handle = null
    if (deps.isHidden()) {
      owed = true
      return
    }
    read()
  }

  return {
    armAfterEvent() {
      const seconds = deps.lifetimeSeconds()
      if (!validLifetime(seconds)) return
      const at = deps.now()
      if (events.length > 0 && at - events[events.length - 1] < BELL_EVENT_MERGE_MS) events[events.length - 1] = at
      else events.push(at)
      if (handle === null && !owed && !reading) schedule()
    },
    onVisible() {
      if (!owed || deps.isHidden()) return
      owed = false
      read()
    },
    isPending: () => handle !== null || owed,
    dispose() {
      if (handle !== null) deps.clearTimer(handle)
      handle = null
      owed = false
      events = []
    },
  }
}
