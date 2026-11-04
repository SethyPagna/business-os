export type ReadSwitchState = 'off' | 'on' | 'shadow'
export type ReadSwitchRow = { name: string; state: ReadSwitchState; rate: number }
export type ReadSwitchListing = { epoch: number; switches: ReadSwitchRow[]; memoSeconds: number }
export type ReadSwitchOutcome = 'cancelled' | 'changed' | 'stale' | 'maintenance' | 'failed'

type Translate = (key: string) => string | undefined

export type ReadSwitchFlowDeps = {
  t: Translate
  ask: (request: { title: string; message: string }) => Promise<boolean>
  set: (payload: { name: string; state: 'on' | 'off'; expectedEpoch: number }) => Promise<unknown>
  reload: () => Promise<void>
  notify: (message: string, type?: string) => void
}

const STATES = new Set<string>(['off', 'on', 'shadow'])

export function normalizeReadSwitches(value: unknown): ReadSwitchListing | null {
  const body = value as { epoch?: unknown; switches?: unknown; memoSeconds?: unknown } | null
  if (!body || typeof body !== 'object' || !Number.isSafeInteger(body.epoch) || !Array.isArray(body.switches)) return null
  const switches = body.switches.flatMap((row: unknown): ReadSwitchRow[] => {
    const entry = row as { name?: unknown; state?: unknown; rate?: unknown } | null
    if (!entry || typeof entry.name !== 'string' || !entry.name || typeof entry.state !== 'string' || !STATES.has(entry.state)) return []
    return [{ name: entry.name, state: entry.state as ReadSwitchState, rate: Number(entry.rate) || 0 }]
  })
  return { epoch: body.epoch as number, switches, memoSeconds: Number(body.memoSeconds) || 15 }
}

/** A switch that is on or sampling turns off; a switch that is off turns on. */
export const targetState = (row: ReadSwitchRow): 'on' | 'off' => (row.state === 'off' ? 'on' : 'off')

const word = (t: Translate, key: string, fallback: string) => t(key) || fallback
const fill = (text: string, name: string) => text.replace('{name}', name)

/** One confirmed flip: ask through the shared dialog, send the epoch this page loaded, then show what the server now holds. */
export async function changeReadSwitch(deps: ReadSwitchFlowDeps, listing: ReadSwitchListing, row: ReadSwitchRow): Promise<ReadSwitchOutcome> {
  const { t } = deps
  const to = targetState(row)
  const label = word(t, `read_switch_name_${row.name}`, row.name)
  const confirmed = await deps.ask({
    title: fill(word(t, to === 'on' ? 'read_switch_confirm_on' : 'read_switch_confirm_off', to === 'on' ? 'Turn on {name}?' : 'Turn off {name}?'), label),
    message: fill(word(t, 'read_switch_confirm_note', 'Other devices follow within {n} seconds.'), label).replace('{n}', String(listing.memoSeconds)),
  })
  if (!confirmed) return 'cancelled'
  try {
    await deps.set({ name: row.name, state: to, expectedEpoch: listing.epoch })
    deps.notify(word(t, 'read_switch_changed', 'Switch updated'), 'success')
    await deps.reload()
    return 'changed'
  } catch (error) {
    const failure = error as { status?: number; code?: string } | null
    if (failure?.status === 409 || failure?.code === 'read_switch_epoch_stale') {
      deps.notify(word(t, 'read_switch_stale', 'The switches changed elsewhere. Showing the current ones.'), 'warning')
      await deps.reload()
      return 'stale'
    }
    if (failure?.code === 'read_switch_maintenance') {
      deps.notify(word(t, 'read_switch_maintenance', 'Only Off is allowed while writes are held.'), 'warning')
      return 'maintenance'
    }
    deps.notify(word(t, 'read_switch_failed', 'Could not change the switch.'), 'error')
    return 'failed'
  }
}
