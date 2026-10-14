import { ConflictIcon, CONFLICT_ICON_CLASS } from './ConflictIcon.ts'
import { allUnknownCostNote, knownCost, partialCostNote, unknownCostLabel } from '../../utils/costDisplay.ts'

type CostValueProps = {
  value: unknown
  fmt: (amount: number) => string
  t: (key: string) => string | undefined
  unknownCount?: number
  className?: string
}

export default function CostValue({ value, fmt, t, unknownCount = 0, className = '' }: CostValueProps) {
  const cost = knownCost(value)
  const wrapper = `inline-flex min-w-0 flex-wrap items-center gap-1 tabular-nums ${className}`
  if (cost === null) {
    const label = unknownCostLabel(t)
    return (
      <span className={wrapper} title={unknownCount > 0 ? allUnknownCostNote(unknownCount, t) : label}>
        <ConflictIcon aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${CONFLICT_ICON_CLASS}`} />
        <span>{label}</span>
      </span>
    )
  }
  const note = partialCostNote(unknownCount, t)
  return (
    <span className={wrapper}>
      <span>{fmt(cost)}</span>
      {note && <span className={`text-[11px] font-medium ${CONFLICT_ICON_CLASS}`}>{note}</span>}
    </span>
  )
}
