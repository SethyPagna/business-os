import { SYNC } from '../../constants.ts'

// The Sales page listens to eight channels and used to reload the list, the
// header totals and the period strip once per published event. One sale,
// amendment or resume publishes several channels, so each change read three
// aggregates several times over. This merges a burst into one reload.

export const SALES_PAGE_SYNC_SOURCE = 'sales-page'

export const SALES_RELOAD_CHANNELS: readonly string[] = [
  'sales', 'returns', 'fees', 'customers', 'deliveryContacts', 'users', 'products', 'settings',
]

export type SalesReloadPlan = {
  /** The list and the header totals, which always move together. */
  rowsAndTotals: boolean
  strip: boolean
  userOptions: boolean
}

export type SalesReloadEvent = {
  channel: string
  /** Published by this page's own write, which already re-read the list and the totals itself. */
  source?: string | null
}

type TimerHost = {
  setTimeout: (callback: () => void, delayMs: number) => number
  clearTimeout: (timer: number) => void
  now: () => number
}

/**
 * Trailing edge: every event restarts the quiet window, so the reload always
 * starts after the last event of a burst. A steady stream still reloads once
 * per `maxWaitMs`. A burst made only of this page's own echoes reloads just
 * the strip, the one read its own write does not do directly.
 */
export function createSalesReloadCoalescer(
  host: TimerHost,
  run: (plan: SalesReloadPlan) => void,
  quietMs: number = SYNC.EVENT_DEBOUNCE_MS,
  maxWaitMs: number = SYNC.REMOTE_EVENT_COALESCE_MS,
) {
  let plan: SalesReloadPlan | null = null
  let timer: number | null = null
  let burstStartedAt = 0
  const fire = () => {
    const ready = plan
    plan = null
    timer = null
    if (ready) run(ready)
  }
  return {
    note(event: SalesReloadEvent): void {
      if (!SALES_RELOAD_CHANNELS.includes(event.channel)) return
      const own = event.source === SALES_PAGE_SYNC_SOURCE
      if (!plan) { plan = { rowsAndTotals: false, strip: false, userOptions: false }; burstStartedAt = host.now() }
      plan.strip = true
      if (!own) plan.rowsAndTotals = true
      if (event.channel === 'users') plan.userOptions = true
      if (timer !== null) host.clearTimeout(timer)
      const wait = Math.max(0, Math.min(quietMs, burstStartedAt + maxWaitMs - host.now()))
      timer = host.setTimeout(fire, wait)
    },
    dispose(): void {
      if (timer !== null) host.clearTimeout(timer)
      timer = null
      plan = null
    },
  }
}
