import { Download } from 'lucide-react'
import PortalMenu from './PortalMenu'

export default function ExportMenu({
  label = 'Export',
  items = [],
  compact = false,
  primary = false,
}) {
  const buttonClass = primary
    ? 'border-blue-700 bg-blue-600 text-white shadow-sm hover:bg-blue-700 hover:border-blue-800'
    : 'border-slate-300 bg-white text-slate-700 shadow-sm hover:border-blue-400 hover:text-blue-700 hover:bg-blue-50/60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-blue-500 dark:hover:text-blue-300 dark:hover:bg-slate-700/80'

  return (
    <PortalMenu
      align="right"
      items={items}
      menuClassName="min-w-[14rem]"
      trigger={(
        <button
          type="button"
          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors sm:text-sm ${buttonClass} ${compact ? 'px-2.5 py-1.5' : ''}`}
          aria-label={label}
        >
          <Download className="h-4 w-4" />
          <span className="whitespace-nowrap">{label}</span>
        </button>
      )}
    />
  )
}
