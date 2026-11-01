import { useCallback, useEffect, useState } from 'react'
import Power from 'lucide-react/dist/esm/icons/power.js'
import SlidersHorizontal from 'lucide-react/dist/esm/icons/sliders-horizontal.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
import { useConfirmDialog } from '../shared/useConfirmDialog'
import { changeReadSwitch, normalizeReadSwitches, targetState, type ReadSwitchListing, type ReadSwitchRow } from './readSwitchesFlow.ts'

type PanelApp = { t: (key: string) => string | undefined; notify: (message: string, type?: string) => void }
type ReadSwitchApi = {
  getReadSwitches: () => Promise<unknown>
  setReadSwitch: (payload: { name: string; state: 'on' | 'off'; expectedEpoch: number }) => Promise<unknown>
}

const useApp = useAppHook as () => PanelApp
const readSwitchApi = (): ReadSwitchApi => (window as unknown as { api: ReadSwitchApi }).api

// Administrators only: ServerPage mounts this behind isAdminControlUser, and the Worker refuses anyone else.
export default function ReadSwitchesPanel() {
  const { t, notify } = useApp()
  const { askToConfirm, confirmDialog } = useConfirmDialog(t)
  const [listing, setListing] = useState<ReadSwitchListing | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setListing(normalizeReadSwitches(await readSwitchApi().getReadSwitches()))
    } catch {
      setListing(null)
      notify(t('read_switch_load_failed') || 'Could not load the switches.', 'error')
    }
  }, [notify, t])

  useEffect(() => { void load() }, [load])

  async function flip(row: ReadSwitchRow) {
    if (!listing || busy) return
    setBusy(true)
    try {
      await changeReadSwitch({ t, notify, ask: (request) => askToConfirm(request), set: (payload) => readSwitchApi().setReadSwitch(payload), reload: load }, listing, row)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <SlidersHorizontal className="h-4 w-4" />
        {t('read_switches_title') || 'Read switches'}
      </div>
      <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">{t('read_switches_desc') || 'Turn a speed-up off at once if it ever shows wrong data. Off always means the normal way.'}</p>
      {listing ? (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
          {listing.switches.map((row) => {
            const to = targetState(row)
            const action = to === 'on' ? (t('read_switch_turn_on') || 'Turn on') : (t('read_switch_turn_off') || 'Turn off')
            return (
              <li key={row.name} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-200">{t(`read_switch_name_${row.name}`) || row.name}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${row.state === 'on' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>
                  {t(`read_switch_state_${row.state}`) || row.state}
                </span>
                <button type="button" className="btn-secondary p-1.5" disabled={busy} title={action} aria-label={action} onClick={() => { void flip(row) }}>
                  <Power className="h-4 w-4" />
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
      {confirmDialog}
    </div>
  )
}
