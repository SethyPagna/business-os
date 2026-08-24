import type { ComponentType, ReactNode } from 'react'

type StockStatus = 'out_of_stock' | 'low_stock' | 'in_stock' | string
type SummaryTone = 'blue' | 'dark' | 'green' | 'amber'
type SectionShellProps = {
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  children: ReactNode
}
type SummaryTileProps = {
  icon: ComponentType<{ className?: string }>
  label: ReactNode
  value: ReactNode
  tone?: SummaryTone
}
type StatusPillProps = {
  status: StockStatus
  copy: (key: string, fallback?: string) => ReactNode
}

function statusClass(status: StockStatus): string {
  if (status === 'out_of_stock') return 'text-rose-700 dark:text-rose-300'
  if (status === 'low_stock') return 'text-amber-700 dark:text-amber-300'
  return 'text-emerald-700 dark:text-emerald-300'
}

function statusDotClass(status: StockStatus): string {
  if (status === 'out_of_stock') return 'bg-rose-500'
  if (status === 'low_stock') return 'bg-amber-500'
  return 'bg-emerald-500'
}

/** Shared shell block for portal sections. */
export function SectionShell({ title, subtitle, action, children }: SectionShellProps) {
  return (
    <section className="py-5">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/** Summary metric tile used in top-level portal overview cards. */
export function SummaryTile({ icon: Icon, label, value, tone = 'dark' }: SummaryTileProps) {
  const tones = {
    blue: 'from-amber-500 to-amber-600 text-white dark:from-amber-500 dark:to-amber-600 dark:text-neutral-950',
    dark: 'from-slate-900 to-slate-700 text-white dark:from-neutral-800 dark:to-neutral-950 dark:border dark:border-amber-500/10',
    green: 'from-emerald-600 to-teal-600 text-white',
    amber: 'from-amber-500 to-orange-500 text-white',
  }

  return (
    <div className={`rounded-[24px] bg-gradient-to-br p-4 shadow-sm ${tones[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] opacity-80">{label}</div>
          <div className="mt-2 text-2xl font-semibold">{value}</div>
        </div>
        <div className="rounded-2xl bg-white/15 p-3">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}

/** Stock status badge component for product and membership cards. */
export function StatusPill({ status, copy }: StatusPillProps) {
  const labelKey = status === 'out_of_stock'
    ? 'outOfStock'
    : status === 'low_stock'
      ? 'lowStock'
      : 'inStock'

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide shadow-sm backdrop-blur dark:bg-neutral-900/90 ${statusClass(status)}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass(status)}`} />
      {copy(labelKey, labelKey)}
    </span>
  )
}
