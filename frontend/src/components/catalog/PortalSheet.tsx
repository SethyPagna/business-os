import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import X from 'lucide-react/dist/esm/icons/x.js'
import { nextTrapIndex, PORTAL_FOCUSABLE_SELECTOR } from './portalFocusTrap.ts'

type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string

/** The first row of the content takes this right padding so it never runs under the corner buttons (close, and the install icon). */
export const PORTAL_SHEET_CORNER_PAD = 'min-h-10 pr-24'

/**
 * The storefront's one sheet (the Account sheet): a bottom sheet on a phone, a centred card from sm up. No header strip and no title row:
 * the close button sits in the top corner (with any `corner` actions beside it), and the content starts at the top edge. The surface is the
 * solid recipe (white card, visible line); the scrim behind it dims the page and carries nothing.
 *
 * It renders its content at once. Escape and a tap on the scrim close it; focus moves into the sheet when it opens and goes back to the
 * control that opened it when it closes.
 */
export default function PortalSheet({ label, copy, onClose, corner, children }: {
  /** The accessible name of the dialog (there is no visible title). */
  label: string
  copy: CopyFn
  onClose: () => void
  /** Small icon actions that sit beside the close button. */
  corner?: ReactNode
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus({ preventScroll: true })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab' && !event.defaultPrevented) {
        const panel = panelRef.current
        // A menu layered above the sheet owns its own keys.
        if (!panel || document.querySelector('[data-portal-menu-content]')) return
        const focusable = Array.from(panel.querySelectorAll<HTMLElement>(PORTAL_FOCUSABLE_SELECTOR)).filter((element) => element.getClientRects().length > 0)
        event.preventDefault()
        const next = nextTrapIndex(focusable.length, focusable.indexOf(document.activeElement as HTMLElement), event.shiftKey)
        if (next >= 0) focusable[next].focus()
        else panel.focus({ preventScroll: true })
        return
      }
      if (event.key !== 'Escape' || event.defaultPrevented) return
      // A menu or dialog layered above the sheet takes Escape first.
      if (document.querySelector('[data-portal-menu-content]')) return
      event.preventDefault()
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/50 sm:items-center" onClick={onClose}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-portal-sheet="true"
        onClick={(event) => event.stopPropagation()}
        className="relative max-h-modal-85 w-full max-w-md overflow-hidden rounded-t-2xl border border-stone-300 bg-white pb-[env(safe-area-inset-bottom)] shadow-sm outline-none dark:border-neutral-700 dark:bg-neutral-900 sm:rounded-2xl sm:pb-0"
      >
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
          {corner}
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-stone-600 transition hover:bg-stone-100 hover:text-[#23201b] dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            onClick={onClose}
            aria-label={copy('close', 'Close')}
            title={copy('close', 'Close')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[calc(85*var(--app-vh))] overflow-y-auto overscroll-contain px-5 pb-5 pt-3">{children}</div>
      </div>
    </div>
  )
}
