import Info from 'lucide-react/dist/esm/icons/info.js'
import type { ReactNode } from 'react'
import LazyPortalMenu from './LazyPortalMenu'

export interface ButtonGuideEntry {
  icon?: ReactNode
  label: string
  description: string
}

type ButtonGuidePopoverProps = {
  title: string
  entries: ButtonGuideEntry[]
  align?: 'left' | 'right' | 'auto'
  // aria-label for the trigger button itself (distinct from `title`, the
  // panel heading) -- kept optional with a sane default so most callers
  // don't need to think about it.
  triggerLabel?: string
}

// One small "?" trigger that opens a floating panel listing every button
// in a toolbar/menu next to it, each with a one-line plain-language
// explanation of what it does. Deliberately generic/reusable (icon+label+
// description rows only) rather than owned by any one page, so it can be
// dropped next to any button row -- Products' Manage/Import/Export/Add row
// is the first caller (Aug 2026 polish pass, user-requested "explain what
// this button does" toolkit), but nothing here is Products-specific.
export default function ButtonGuidePopover({ title, entries, align = 'auto', triggerLabel }: ButtonGuidePopoverProps) {
  return (
    <LazyPortalMenu
      align={align}
      compact
      menuClassName="max-h-[70vh] overflow-auto p-3 w-72"
      trigger={(
        <button
          type="button"
          aria-label={triggerLabel || title}
          title={title}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 dark:border-neutral-700 dark:text-gray-400 dark:hover:bg-neutral-800 dark:hover:text-gray-200"
        >
          <Info className="h-4 w-4" />
        </button>
      )}
      content={() => (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</p>
          <div className="space-y-2.5">
            {entries.map((entry, index) => (
              <div key={index} className="flex items-start gap-2">
                {entry.icon ? <span className="mt-0.5 shrink-0 text-gray-500 dark:text-gray-400">{entry.icon}</span> : null}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{entry.label}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{entry.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    />
  )
}
