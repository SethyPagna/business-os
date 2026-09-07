// The badge itself. The vocabulary it renders lives in utils/saleStatus.ts so
// that non-JSX callers (the Dashboard's chip, the pure tests) read the SAME
// list instead of keeping a private copy that drifts.
import { getStatusLabel, isSaleStatus, STATUS_COLORS, type SaleStatus, type TranslateFn } from '../../utils/saleStatus.ts'

export { ALL_STATUSES, getStatusLabel, isSaleStatus, STATUS_COLORS, STATUS_LABEL_KEYS, STATUS_LABELS } from '../../utils/saleStatus.ts'
export type { SaleStatus } from '../../utils/saleStatus.ts'

type StatusBadgeProps = {
  status?: unknown
  t?: TranslateFn
}

export default function StatusBadge({ status, t }: StatusBadgeProps) {
  const s: SaleStatus = isSaleStatus(status) ? status : 'completed'
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[s]}`}>
      {getStatusLabel(s, t)}
    </span>
  )
}
