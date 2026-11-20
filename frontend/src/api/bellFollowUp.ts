// The Worker keeps each bell section for at most this long (the summary answer says how long). A device whose reload for a sync event was served
// an entry older than the event is therefore correct again one lifetime later: the panel asks once more then, on a timer of its own.
export const BELL_FOLLOW_UP_SLACK_MS = 5000
// Devices that got the same broadcast spread their follow-ups over this window, so the first one warms the entry for the rest.
export const BELL_FOLLOW_UP_JITTER_MS = 30000
const BELL_FOLLOW_UP_MIN_DELAY_MS = 1000

let sectionLifetimeSeconds: number | null = null
const answerListeners = new Set<(generatedAtMs: number | null) => void>()

export function noteSectionLifetime(answer: unknown): void {
  const value = Number((answer as { sectionLifetimeSeconds?: unknown } | null)?.sectionLifetimeSeconds)
  sectionLifetimeSeconds = Number.isFinite(value) && value > 0 ? value : null
  const generatedAt = Date.parse(String((answer as { generatedAt?: unknown } | null)?.generatedAt ?? ''))
  const generatedAtMs = Number.isFinite(generatedAt) ? generatedAt : null
  answerListeners.forEach((listener) => listener(generatedAtMs))
}

export function onBellAnswer(listener: (generatedAtMs: number | null) => void): () => void {
  answerListeners.add(listener)
  return () => { answerListeners.delete(listener) }
}

export function getSectionLifetimeSeconds(): number | null {
  return sectionLifetimeSeconds
}

export type BellFollowUpDeps = {
  lifetimeSeconds: () => number | null
  setTimer: (run: () => void, delayMs: number) => unknown
  clearTimer: (handle: unknown) => void
  isHidden: () => boolean
  reload: () => void
  now: () => number
  random: () => number
}

export type BellFollowUp = {
  noteEvent: (serverTime?: unknown) => void
  onAnswer: (generatedAtMs: number | null) => void
  onVisible: () => void
  isPending: () => boolean
  dispose: () => void
}

function eventMs(serverTime: unknown): number | null {
  const parsed = typeof serverTime === 'number' ? serverTime : Date.parse(String(serverTime ?? ''))
  return Number.isFinite(parsed) ? parsed : null
}

export function createBellFollowUp(deps: BellFollowUpDeps): BellFollowUp {
  let handle: unknown = null
  let dueWhileHidden = false
  let latestEventMs: number | null = null
  let coveredEventMs: number | null = null
  let armedFromMs: number | null = null
  let armedConservatively = false
  const isPending = () => handle !== null || dueWhileHidden
  const run = () => {
    handle = null
    if (deps.isHidden()) {
      dueWhileHidden = true
      return
    }
    deps.reload()
  }
  const arm = (generatedAtMs: number, lifetimeMs: number, conservative: boolean) => {
    const jitter = deps.random() * BELL_FOLLOW_UP_JITTER_MS
    const now = deps.now()
    // The answer's clock is the Worker's. An answer older than a lifetime or from the future of this device's clock means the clocks disagree: wait a whole
    // lifetime from now instead, which is after every entry that exists now has expired whatever either clock says.
    const skewed = now - generatedAtMs > lifetimeMs + BELL_FOLLOW_UP_SLACK_MS || generatedAtMs - now > BELL_FOLLOW_UP_SLACK_MS
    const useNow = conservative || skewed
    const delay = useNow
      ? lifetimeMs + BELL_FOLLOW_UP_SLACK_MS + jitter
      : Math.max(BELL_FOLLOW_UP_MIN_DELAY_MS, generatedAtMs + lifetimeMs + BELL_FOLLOW_UP_SLACK_MS + jitter - now)
    coveredEventMs = latestEventMs
    armedFromMs = generatedAtMs
    armedConservatively = useNow
    handle = deps.setTimer(run, delay)
  }
  return {
    // The event's own time: the broadcast's server timestamp when it carries one, else this device's clock (a wrong device clock cannot loop, see onAnswer).
    noteEvent(serverTime) {
      const at = eventMs(serverTime) ?? deps.now()
      if (latestEventMs === null || at > latestEventMs) latestEventMs = at
    },
    // Every bell answer comes here. Behind the latest event means the device is still stale: ask once more when that entry will have expired.
    // Once armed for an event, a second try is allowed only if the follow-up came back with the very same entry (clocks that disagree), and then it waits a full lifetime.
    onAnswer(generatedAtMs) {
      if (latestEventMs === null || generatedAtMs === null || !Number.isFinite(generatedAtMs) || isPending()) return
      const seconds = deps.lifetimeSeconds()
      if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return
      if (generatedAtMs >= latestEventMs) return
      if (coveredEventMs === latestEventMs) {
        if (generatedAtMs === armedFromMs && !armedConservatively) arm(generatedAtMs, seconds * 1000, true)
        return
      }
      arm(generatedAtMs, seconds * 1000, false)
    },
    onVisible() {
      if (!dueWhileHidden || deps.isHidden()) return
      dueWhileHidden = false
      deps.reload()
    },
    isPending,
    dispose() {
      if (handle !== null) deps.clearTimer(handle)
      handle = null
      dueWhileHidden = false
    },
  }
}
