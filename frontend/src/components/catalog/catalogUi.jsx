import React from 'react'

function statusClass(status) {
  if (status === 'out_of_stock') return 'border-rose-200 bg-rose-50 text-rose-700'
  if (status === 'low_stock') return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-emerald-200 bg-emerald-50 text-emerald-700'
}

/** Shared shell block for portal sections. */
export function SectionShell({ title, subtitle, action, children }) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/** Summary metric tile used in top-level portal overview cards. */
export function SummaryTile({ icon: Icon, label, value, tone }) {
  const tones = {
    blue: 'from-sky-600 to-blue-700 text-white',
    dark: 'from-slate-900 to-slate-700 text-white',
    green: 'from-emerald-600 to-teal-600 text-white',
    amber: 'from-amber-500 to-orange-500 text-white',
  }

  return (
    <div className={`rounded-[24px] bg-gradient-to-br p-4 shadow-sm ${tones[tone] || tones.dark}`}>
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
export function StatusPill({ status, copy }) {
  const labelKey = status === 'out_of_stock'
    ? 'outOfStock'
    : status === 'low_stock'
      ? 'lowStock'
      : 'inStock'

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass(status)}`}>
      {copy(labelKey, labelKey)}
    </span>
  )
}
