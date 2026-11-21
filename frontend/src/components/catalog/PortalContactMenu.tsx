import { useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import LazyPortalMenu from '../shared/LazyPortalMenu'
import { PortalContactRows } from './PortalSocialRow.tsx'
import { resolveContactFocusTarget } from './portalSocialLinks.ts'
import type { PortalContactEntry } from './portalSocialLinks.ts'

type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string

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
