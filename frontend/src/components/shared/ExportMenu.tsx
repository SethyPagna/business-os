import Download from 'lucide-react/dist/esm/icons/download.js'
import { useCallback, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PortalMenuItem } from './PortalMenu'

type ExportMenuProps = {
  label?: string
  items?: Array<PortalMenuItem | null | undefined | false>
  compact?: boolean
  primary?: boolean
  triggerClassName?: string
  triggerWrapperClassName?: string
}

type PortalMenuComponent = typeof import('./PortalMenu').default

export default function ExportMenu({
  label = 'Export',
  items = [],
  compact = false,
  primary = false,
  triggerClassName = '',
  triggerWrapperClassName = '',
}: ExportMenuProps) {
  const portalMenuPromiseRef = useRef<Promise<PortalMenuComponent> | null>(null)
  const [PortalMenu, setPortalMenu] = useState<PortalMenuComponent | null>(null)
  const [openOnLoad, setOpenOnLoad] = useState(false)

  const loadPortalMenu = useCallback((shouldOpen = false) => {
    if (shouldOpen) setOpenOnLoad(true)
    if (PortalMenu) return
    if (!portalMenuPromiseRef.current) {
      portalMenuPromiseRef.current = import('./PortalMenu').then((module) => module.default)
    }
    portalMenuPromiseRef.current
      .then((component) => setPortalMenu(() => component))
      .catch(() => {
        if (shouldOpen) setOpenOnLoad(false)
      })
  }, [PortalMenu])

  const iconClassName = compact ? 'h-3.5 w-3.5' : 'h-4 w-4'
  const buttonClass = primary
    ? 'border-blue-700 bg-blue-600 text-white shadow-sm hover:bg-blue-700 hover:border-blue-800'
    : 'border-slate-300 bg-white text-slate-700 shadow-sm hover:border-blue-400 hover:text-blue-700 hover:bg-blue-50/60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-blue-500 dark:hover:text-blue-300 dark:hover:bg-slate-700/80'

  const trigger = (
    <button
      type="button"
      className={`inline-flex min-w-[5.75rem] items-center justify-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors sm:min-w-[6.5rem] sm:text-sm ${buttonClass} ${compact ? 'min-w-0 gap-1 px-1.5 py-2 text-[10px] sm:text-[11px]' : ''} ${triggerClassName}`}
      aria-label={label}
      aria-haspopup="true"
      aria-expanded={PortalMenu ? undefined : openOnLoad}
      onPointerEnter={PortalMenu ? undefined : () => loadPortalMenu(false)}
      onFocus={PortalMenu ? undefined : () => loadPortalMenu(false)}
      onClick={PortalMenu ? undefined : () => loadPortalMenu(true)}
    >
      <Download className={iconClassName} />
      <span className={compact ? 'shrink-0 whitespace-nowrap' : 'min-w-0 truncate whitespace-nowrap'}>{label}</span>
    </button>
  )

  if (!PortalMenu) {
    return trigger
  }

  return (
    <PortalMenu
      align="right"
      items={items}
      menuClassName="min-w-[14rem]"
      defaultOpen={openOnLoad}
      triggerWrapperClassName={triggerWrapperClassName}
      onOpenChange={(open) => {
        if (!open) setOpenOnLoad(false)
      }}
      trigger={trigger}
    />
  )
}
