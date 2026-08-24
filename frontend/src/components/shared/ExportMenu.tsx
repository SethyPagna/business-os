// Export = data leaving the app outward to a file, so the icon's arrow
// points outward/up (mirrors the Import icon's inward/down arrow -- see
// the Import buttons across the app that use the down-pointing icon).
import Upload from 'lucide-react/dist/esm/icons/upload.js'
import { useCallback, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PortalMenuItem } from './PortalMenu'
import { isBrokenLocalizedString, useApp } from '../../AppContext.tsx'

type ExportMenuProps = {
  label?: string
  items?: Array<PortalMenuItem | null | undefined | false>
  compact?: boolean
  primary?: boolean
  triggerClassName?: string
  triggerWrapperClassName?: string
  // Icon-only trigger (no visible text label) -- used by toolbar rows that
  // were consolidated down to icon buttons. The label is still applied as
  // aria-label/title so the control stays accessible.
  iconOnly?: boolean
  // Icon-only on narrow screens, icon+label once there's room (sm+). Lets a
  // toolbar row show full button names when space allows instead of always
  // collapsing to icons -- matches FilterMenu's mobileIconOnly behavior.
  mobileIconOnly?: boolean
}

type PortalMenuComponent = typeof import('./PortalMenu').default

export default function ExportMenu({
  label,
  items = [],
  compact = false,
  primary = false,
  triggerClassName = '',
  triggerWrapperClassName = '',
  iconOnly = false,
  mobileIconOnly = false,
}: ExportMenuProps) {
  const { t } = useApp() as { t?: (key: string) => string }
  const portalMenuPromiseRef = useRef<Promise<PortalMenuComponent> | null>(null)
  const [PortalMenu, setPortalMenu] = useState<PortalMenuComponent | null>(null)
  const [openOnLoad, setOpenOnLoad] = useState(false)
  const translatedExport = typeof t === 'function' ? t('export') : ''
  const resolvedLabel = label || (translatedExport && translatedExport !== 'export' && !isBrokenLocalizedString(translatedExport) ? translatedExport : 'Export')

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

  const iconClassName = compact || iconOnly ? 'h-3.5 w-3.5' : 'h-4 w-4'
  const buttonClass = primary
    ? 'border-blue-700 bg-blue-600 text-white shadow-sm hover:bg-blue-700 hover:border-blue-800'
    : 'border-slate-300 bg-white text-slate-700 shadow-sm hover:border-blue-400 hover:text-blue-700 hover:bg-blue-50/60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-blue-500 dark:hover:text-blue-300 dark:hover:bg-slate-700/80'

  const trigger = (
    <button
      type="button"
      className={
        iconOnly
          ? `inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition-colors ${buttonClass} ${triggerClassName}`
          : mobileIconOnly
            ? `inline-flex h-8 w-8 shrink-0 items-center justify-center gap-1.5 rounded-xl border px-1.5 text-xs font-semibold transition-colors sm:h-auto sm:w-auto sm:min-w-[5.75rem] sm:px-3 sm:py-1.5 sm:text-sm ${buttonClass} ${triggerClassName}`
            : `inline-flex min-w-[5.75rem] items-center justify-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors sm:min-w-[6.5rem] sm:text-sm ${buttonClass} ${compact ? 'min-w-0 gap-1 px-1.5 py-2 text-[10px] sm:text-[11px]' : ''} ${triggerClassName}`
      }
      aria-label={resolvedLabel}
      title={iconOnly || mobileIconOnly ? resolvedLabel : undefined}
      aria-haspopup="true"
      aria-expanded={PortalMenu ? undefined : openOnLoad}
      onPointerEnter={PortalMenu ? undefined : () => loadPortalMenu(false)}
      onFocus={PortalMenu ? undefined : () => loadPortalMenu(false)}
      onClick={PortalMenu ? undefined : () => loadPortalMenu(true)}
    >
      <Upload className={iconClassName} />
      {iconOnly ? null : (
        <span className={`${compact ? 'shrink-0 whitespace-nowrap' : 'min-w-0 truncate whitespace-nowrap'} ${mobileIconOnly ? 'hidden sm:inline' : ''}`}>{resolvedLabel}</span>
      )}
    </button>
  )

  if (!PortalMenu) {
    return trigger
  }

  return (
    <PortalMenu
      align="right"
      items={items}
      compact
      menuClassName="w-[13rem]"
      defaultOpen={openOnLoad}
      triggerWrapperClassName={triggerWrapperClassName}
      onOpenChange={(open) => {
        if (!open) setOpenOnLoad(false)
      }}
      trigger={trigger}
    />
  )
}
