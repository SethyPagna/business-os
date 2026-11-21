import { useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import LazyPortalMenu from '../shared/LazyPortalMenu'
import { PortalContactRows } from './PortalSocialRow.tsx'
import type { PortalContactEntry } from './portalSocialLinks.ts'

type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string

type ContactFocusNode = { isConnected: boolean; focus: () => void }
type ContactFocusHost = { querySelector: (selector: string) => unknown }

export const PORTAL_CONTACT_TRIGGER_SELECTOR = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

/**
 * Where focus goes when the Contact menu closes: nowhere if the visitor already put focus on something else, else the element that
 * opened the menu if it is still on the page, else the trigger now inside the menu's host.
 */
export function resolveContactFocusTarget<T extends ContactFocusNode>(opener: T | null, host: ContactFocusHost | null, active: unknown, body: unknown): T | null {
  const focusIsFree = !active || active === body || (active as ContactFocusNode).isConnected === false
  if (!focusIsFree) return null
  if (opener?.isConnected) return opener
  return (host?.querySelector(PORTAL_CONTACT_TRIGGER_SELECTOR) as T | null | undefined) ?? null
}

/**
 * The Contact panel behind the dock's Contact button: no title row, the chat entries only (Phone, Messenger, Telegram, WhatsApp), each the
 * platform icon and the real name or number. Focus goes back to the opener when the panel closes (Esc, a tap outside, the button).
 */
export default function PortalContactMenu({ entries, copy, trigger, align = 'auto' }: {
  entries: readonly PortalContactEntry[]
  copy: CopyFn
  trigger: ReactNode
  align?: 'left' | 'right' | 'auto'
}) {
  const openerRef = useRef<HTMLElement | null>(null)
  const hostRef = useRef<HTMLSpanElement | null>(null)

  const handleOpenChange = useCallback((open: boolean) => {
    if (open) {
      if (openerRef.current) return
      const active = typeof document === 'undefined' ? null : document.activeElement
      openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null
      return
    }
    const opener = openerRef.current
    openerRef.current = null
    // LazyPortalMenu mounts a new trigger node when it opens and again when it closes, so the button that was clicked is gone by now.
    // Wait for that swap, then focus the trigger that is on the page. Focus the visitor moved elsewhere (a click outside) is left alone.
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const target = resolveContactFocusTarget<HTMLElement>(opener, hostRef.current, document.activeElement, document.body)
      target?.focus({ preventScroll: true })
    }))
  }, [])

  if (!entries.length) return null
  return (
    <span ref={hostRef} style={{ display: 'contents' }}>
      <LazyPortalMenu
        align={align}
        trigger={trigger}
        content={({ closeMenu }) => <PortalContactRows entries={entries} copy={copy} onNavigate={closeMenu} className="w-72 max-w-[85vw] py-1" />}
        onOpenChange={handleOpenChange}
      />
    </span>
  )
}
