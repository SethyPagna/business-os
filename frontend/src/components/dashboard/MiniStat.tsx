import type { ReactNode } from 'react'

type MiniStatProps = {
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  color?: string
  trend?: number | null
  onClick?: () => void
  className?: string
}

export default function MiniStat({ label, value, sub, color, trend, onClick, className = '' }: MiniStatProps) {
  const trendUp = typeof trend === 'number' && trend > 0
  const trendNone = trend === undefined || trend === null
  const subIsText = typeof sub === 'string'
  const hasSub = Boolean(sub)
  const normalizedSub = subIsText ? sub.trim() : sub
  const subLineClass = 'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] leading-3.5 text-gray-500 dark:text-gray-400'
  const classNames = `card flex flex-col gap-0 px-3 py-2 text-left sm:px-3.5 sm:py-2.5 ${onClick ? 'transition hover:ring-2 hover:ring-blue-200 dark:hover:ring-blue-800/60' : ''} ${className}`

  const content = (
    <>
      <div className="text-[11px] font-medium leading-4 text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`text-lg font-bold leading-6 tracking-tight sm:text-[1.2rem] ${color || 'text-gray-900 dark:text-white'}`}>{value}</div>
      {hasSub ? (
        <div
          className={subIsText ? subLineClass : 'min-w-0 overflow-hidden text-[11px] leading-4 text-gray-500 dark:text-gray-400'}
          title={subIsText ? String(normalizedSub) : undefined}
        >
          {normalizedSub}
        </div>
      ) : null}
      {!trendNone ? (
        <div className={`mt-0.5 flex items-center gap-1 text-[11px] font-semibold leading-4 ${trendUp ? 'text-green-600' : Number(trend) < 0 ? 'text-red-500' : 'text-gray-400'}`}>
          <span>{trendUp ? '->' : Number(trend) < 0 ? '<-' : '--'}</span>
          <span>{Math.abs(Number(trend)).toFixed(1)}% vs prev period</span>
        </div>
      ) : null}
    </>
  )

  return onClick ? (
    <button type="button" onClick={onClick} className={classNames}>
      {content}
    </button>
  ) : (
    <div className={classNames}>
      {content}
    </div>
  )
}
