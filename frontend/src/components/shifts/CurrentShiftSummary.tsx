import { useEffect, useState } from 'react'
import { useApp } from '../../AppContext.tsx'
import { SHIFT_BRANCH_CHANGED_EVENT, useSharedShift } from '../pos/ShiftGate.tsx'
import ShiftSummary from './ShiftSummary.tsx'

type Props = {
  className?: string
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
 * A failed/offline read renders nothing because shifts have no local mirror.
 */
function operationalBranchId(): number | null {
  if (typeof window === 'undefined') return null
  const first = (window.sessionStorage.getItem('pos_branch') || '').split(',')[0]?.trim()
  const parsed = Number(first)
  return first && Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export default function CurrentShiftSummary({ className = '' }: Props) {
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

  if (loading) return <div className={`rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-gray-400 ${className}`} aria-busy="true">{tr('shift_current_loading', 'Loading current shift…')}</div>
  if (failed) return <div className={`flex min-h-11 items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200 ${className}`} role="status"><span>{tr('shift_current_unavailable', 'Current shift unavailable')}</span><button type="button" className="min-h-11 rounded-lg px-3 font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500" onClick={() => void refresh()}>{tr('retry', 'Retry')}</button></div>
  if (!state?.shift) return <div className={`rounded-xl border border-dashed border-gray-300 p-3 text-sm text-gray-500 dark:border-zinc-700 dark:text-gray-400 ${className}`} role="status">{state?.exempt ? tr('shift_not_required', 'Shift not required') : tr('shift_none_current', 'No current shift')}</div>

  return (
    <div className={className}>
      <ShiftSummary shift={state.shift} compact title={tr('shift_current_title', 'Current shift')} />
      <p className="px-1 pt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{tr('shift_current_live_note', 'Live shift · not part of the selected report period')}</p>
    </div>
  )
}
