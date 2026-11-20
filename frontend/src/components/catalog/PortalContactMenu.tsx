import { useCallback, useEffect, useRef } from 'react'
import type { ComponentType, ReactNode } from 'react'
import Mail from 'lucide-react/dist/esm/icons/mail.js'
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js'
import LazyPortalMenu from '../shared/LazyPortalMenu'
import { PORTAL_SOCIAL_ICONS, PortalSocialText } from './PortalSocialRow.tsx'
import type { PortalContactEntry, PortalContactPlatform } from './portalSocialLinks.ts'

type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string
type IconComponent = ComponentType<{ className?: string }>

const ICONS: Record<PortalContactPlatform, IconComponent> = { ...PORTAL_SOCIAL_ICONS, email: Mail, map: MapPin }

/** A screen rectangle to open at, for callers that have no trigger of their own (the FAQ and About buttons call the page's `openContactSheet`). */
export type PortalContactAnchor = { top: number; left: number; width: number; height: number; opener: HTMLElement | null }

/**
 * The one Contact menu (spec section 3): no title row, one row per way to reach the shop in the order Phone, Messenger, Telegram, Instagram,
 * Facebook, TikTok, WhatsApp, Website, Email, Map. A row is the brand icon and the account name, number or address; the platform word is
 * only the accessible name. The entries come from buildPortalContactEntries, so every surface shows the same names.
 *
 * Pass `trigger` to open from a button of your own, or `anchor` (with `onClose`) to open already open beside an element that has gone.
 * Focus goes back to the opener when the menu closes.
 */
export default function PortalContactMenu({ entries, copy, trigger, align = 'auto', anchor, onClose }: {
  entries: readonly PortalContactEntry[]
  copy: CopyFn
  trigger?: ReactNode
  align?: 'left' | 'right' | 'auto'
  anchor?: PortalContactAnchor | null
  onClose?: () => void
}) {
  const openerRef = useRef<HTMLElement | null>(null)
  const anchorOpener = anchor?.opener ?? null

  const handleOpenChange = useCallback((open: boolean) => {
    if (open) {
      if (openerRef.current) return
      const active = typeof document === 'undefined' ? null : document.activeElement
      openerRef.current = anchorOpener || (active instanceof HTMLElement && active !== document.body ? active : null)
      return
    }
    const opener = openerRef.current
    openerRef.current = null
    if (opener?.isConnected) window.requestAnimationFrame(() => opener.focus())
    onClose?.()
  }, [anchorOpener, onClose])

  // An anchored menu does not follow the page, so a scroll closes it rather than leaving it beside nothing.
  useEffect(() => {
    if (!anchor || !onClose || typeof window === 'undefined') return undefined
    window.addEventListener('scroll', onClose, { passive: true, once: true })
    return () => window.removeEventListener('scroll', onClose)
  }, [anchor, onClose])

  if (!entries.length) return null
  const label = copy('contactUs', 'Contact us', 'ទាក់ទងយើង')

  const content = ({ closeMenu }: { closeMenu: () => void }) => (
    <ul className="w-72 max-w-[85vw] py-1" aria-label={label} data-portal-contact-menu="true">
      {entries.map((entry) => {
        const Icon = ICONS[entry.platform]
        const external = !/^(?:tel|mailto):/i.test(entry.href)
        return (
          <li key={entry.key}>
            <a
              href={entry.href}
              target={external ? '_blank' : undefined}
              rel={external ? 'noreferrer noopener' : undefined}
              onClick={closeMenu}
              aria-label={entry.accessibleName}
              data-portal-contact-platform={entry.platform}
              className="flex min-h-11 items-center gap-3 px-4 py-2 text-sm text-[#23201b] transition hover:bg-stone-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              <Icon className="h-4 w-4 shrink-0 text-[#9c7a3c] dark:text-amber-300" />
              <PortalSocialText text={entry.label} latin={entry.latin} />
            </a>
          </li>
        )
      })}
    </ul>
  )

  if (anchor) {
    return (
      <div aria-hidden="true" className="pointer-events-none fixed flex" style={{ top: anchor.top, left: anchor.left, width: anchor.width, height: anchor.height }}>
        <LazyPortalMenu defaultOpen align={align} triggerWrapperClassName="h-full w-full" trigger={<span className="block h-full w-full" />} content={content} onOpenChange={handleOpenChange} />
      </div>
    )
  }
  return <LazyPortalMenu align={align} trigger={trigger} content={content} onOpenChange={handleOpenChange} />
}
