import { useEffect, useState } from 'react'
import { useApp } from '../../AppContext.tsx'
import { SHIFT_BRANCH_CHANGED_EVENT, useSharedShift } from '../pos/ShiftGate.tsx'
import ShiftSummary from './ShiftSummary.tsx'
import ShiftHistoryPanel from './ShiftHistoryPanel.tsx'

type Props = {
  className?: string
  showHistory?: boolean
}

type CurrentShiftContext = {
  t: (key: string) => string
  user?: { id?: string | number | null }
  settings?: { shift_scope_mode?: unknown }
}

/**
 * The current, server-backed shift identity shared with POS.
 *
 * Transaction pages deliberately show identity and timing only. Drawer
 * counts, notes, costs and profit remain confined to authorized shift flows.
 * A failed/offline read shows an explicit retry state.
 */
function operationalBranchId(): number | null {
  if (typeof window === 'undefined') return null
  try {
    const first = (window.sessionStorage.getItem('pos_branch') || '').split(',')[0]?.trim()
    const parsed = Number(first)
    return first && Number.isInteger(parsed) && parsed > 0 ? parsed : null
  } catch { return null }
}

export default function CurrentShiftSummary({ className = '', showHistory = true }: Props) {
  const { t, user, settings } = useApp() as CurrentShiftContext
  const [branchId, setBranchId] = useState(operationalBranchId)
  useEffect(() => {
    const syncBranch = () => setBranchId(operationalBranchId())
    window.addEventListener(SHIFT_BRANCH_CHANGED_EVENT, syncBranch)
    window.addEventListener('focus', syncBranch)
    return () => {
      window.removeEventListener(SHIFT_BRANCH_CHANGED_EVENT, syncBranch)
      window.removeEventListener('focus', syncBranch)
    }
  }, [])
  const { state, loading, failed, refresh } = useSharedShift(branchId, user?.id, settings?.shift_scope_mode)
  const tr = (key: string, fallback: string) => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {loading ? <p aria-busy="true" className="text-sm text-gray-500">{tr('shift_current_loading', 'Loading current shift…')}</p>
        : failed ? <div role="status" className="flex flex-wrap items-center gap-2 text-sm text-amber-700 dark:text-amber-300"><span>{tr('shift_current_unavailable', 'Current shift unavailable')}</span><button type="button" className="btn-secondary min-h-11" onClick={() => void refresh()}>{tr('retry', 'Retry')}</button></div>
        : state?.shift ? <ShiftSummary shift={state.shift} />
        : <p role="status" className="text-sm text-gray-500 dark:text-gray-400">{state?.exempt ? tr('shift_not_required', 'Shift not required') : tr('shift_none_current', 'No current shift')}</p>}
      <p className="px-1 pt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{tr('shift_current_live_note', 'Live shift · not part of the selected report period')}</p>
      {showHistory ? <ShiftHistoryPanel branchId={branchId} compact limit={50} /> : null}
    </div>
  )
}
