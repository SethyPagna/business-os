import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import ImagePlus from 'lucide-react/dist/esm/icons/image-plus.js'
import Layers from 'lucide-react/dist/esm/icons/layers.js'
import Repeat2 from 'lucide-react/dist/esm/icons/repeat-2.js'
import type { ComponentType } from 'react'
import InfoHint from '../../shared/InfoHint'

export type ProductImportTopMode = 'general' | 'replace' | 'stock_actions' | 'images'

const MODES = [
  { id: 'general', label: 'Add / Update', icon: Layers, tone: 'blue' },
  { id: 'replace', label: 'Replace', icon: AlertTriangle, tone: 'red' },
  { id: 'stock_actions', label: 'Stock Actions', icon: Repeat2, tone: 'emerald' },
  { id: 'images', label: 'Images Only', icon: ImagePlus, tone: 'violet' },
] as const

export default function ProductImportModeTabs({ value, onChange }: {
  value: ProductImportTopMode
  onChange: (value: ProductImportTopMode) => void
}) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-1.5 rounded-xl bg-slate-100 p-1 sm:grid-cols-4 dark:bg-slate-800/60" aria-label="Product import mode">
      {MODES.map(({ id, label, icon: Icon, tone }) => {
        const active = value === id
        const activeClass = tone === 'red'
          ? 'bg-white text-red-700 shadow dark:bg-slate-900 dark:text-red-400'
          : tone === 'emerald'
            ? 'bg-white text-emerald-700 shadow dark:bg-slate-900 dark:text-emerald-400'
            : tone === 'violet'
              ? 'bg-white text-violet-700 shadow dark:bg-slate-900 dark:text-violet-400'
              : 'bg-white text-blue-700 shadow dark:bg-slate-900 dark:text-blue-400'
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(id)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition ${active ? activeClass : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        )
      })}
    </div>
  )
}

export function ProductImportOptionCard({ active, dangerous = false, icon: Icon, title, description, onClick }: {
  active: boolean
  dangerous?: boolean
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <div className={`flex items-center gap-3 rounded-xl border-2 p-3 transition ${active ? (dangerous ? 'border-red-500 bg-red-50 dark:bg-red-950/20' : 'border-blue-500 bg-blue-50 dark:bg-blue-950/20') : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'}`}>
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-pressed={active}>
        <Icon className={`h-4 w-4 shrink-0 ${dangerous ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`} />
        <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</span>
      </button>
      <InfoHint text={description} label={`About ${title}`} />
    </div>
  )
}
