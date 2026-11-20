// The Worker keeps each bell section for at most this long (the summary answer says how long). A device whose reload for a sync event was served
// an entry older than the event is therefore correct again one lifetime later: the panel asks once more then, on a timer of its own.
export const BELL_FOLLOW_UP_SLACK_MS = 5000

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

export function createBellFollowUp(deps: BellFollowUpDeps): BellFollowUp {
  let handle: unknown = null
  let dueWhileHidden = false
  const isPending = () => handle !== null || dueWhileHidden
  const run = () => {
    handle = null
    if (deps.isHidden()) {
      dueWhileHidden = true
      return
    }
    deps.reload()
  }
  return {
    armAfterEvent() {
      if (isPending()) return
      const seconds = deps.lifetimeSeconds()
      if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return
      handle = deps.setTimer(run, seconds * 1000 + BELL_FOLLOW_UP_SLACK_MS)
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
