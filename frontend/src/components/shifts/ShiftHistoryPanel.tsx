import type { ReactNode } from 'react'
import ShiftHistoryModal from './ShiftHistoryModal.tsx'

type Props = {
  userId?: number | string | null
  branchId?: number | null
  limit?: number
  compact?: boolean
  layer?: 'default' | 'nested'
  label?: ReactNode
  notify?: (message: string, tone?: string) => void
}

/**
 * Compatibility launcher retained for Profile and page mounts. The server's
 * per-row can_edit/can_close/can_reopen/can_cancel capabilities alone decide
 * which lifecycle actions are visible.
 */
export default function ShiftHistoryPanel({ userId, branchId, limit, compact, layer, label, notify }: Props) {
  return (
    <ShiftHistoryModal
      userId={userId}
      branchId={branchId}
      limit={limit}
      layer={layer}
      label={label}
      notify={notify}
      buttonClassName={compact ? 'btn-secondary min-h-11 px-3 text-xs' : undefined}
    />
  )
}
