import { Download } from 'lucide-react'
import PortalMenu from './PortalMenu'

export default function ExportMenu({
  label = 'Export',
  items = [],
  compact = false,
  primary = false,
}) {
  const buttonClass = primary
    ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700'
    : 'border-gray-300 bg-white text-gray-600 hover:border-blue-400 hover:text-blue-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-blue-500 dark:hover:text-blue-300'

  return (
    <PortalMenu
      align="right"
      items={items}
      menuClassName="min-w-[14rem]"
      trigger={(
        <button
          type="button"
          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium sm:text-sm ${buttonClass} ${compact ? 'px-2.5 py-1.5' : ''}`}
          aria-label={label}
        >
          <Download className="h-4 w-4" />
          <span className="whitespace-nowrap">{label}</span>
        </button>
      )}
    />
  )
}
