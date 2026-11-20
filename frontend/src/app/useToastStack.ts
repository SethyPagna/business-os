import { useEffect, useState } from 'react'
import { dismissToast, getToastStack, pauseToast, resumeToast, subscribeToastStack, type StackToast } from '../components/shared/toastChannel.ts'

export type Toast = StackToast & {
  // Drawn from the context's own slot: dismissing it tells the context.
  fromSlot?: boolean
}

// The context's own single `notification` slot (write-conflict notices, the forced sign-out error). Its
// lifetime belongs to the context, which clears it; the stack only draws it, above the pop-ups.
type Slot = { id?: number; message: string; type?: string } | null

export function slotToast(slot: Slot): Toast | null {
  if (!slot?.message) return null
  return { key: `slot-${slot.id ?? 0}`, message: slot.message, type: slot.type || 'info', duration: Infinity, fromSlot: true }
}

// A view of the channel's list. The list and every clock live in toastChannel.ts, not here, so a screen swap
// (App mounts a different <Notification> on boot, sign-in, forced password change and in the shell) draws the
// same pop-ups with the same clocks. Unmounting stops nothing.
export function useToastStack(slot: Slot) {
  const [items, setItems] = useState<StackToast[]>(getToastStack)

  useEffect(() => {
    const sync = () => setItems(getToastStack())
    const stop = subscribeToastStack(sync)
    sync()
    return stop
  }, [])

  return { visible: [...items].reverse(), slot: slotToast(slot), dismiss: dismissToast, pause: pauseToast, resume: resumeToast }
}

// While a modal dialog is open a pop-up is display-only (a dialog's Close sits where a pop-up's controls would),
// and below the tablet width only the newest one shows at all. It still leaves on its own clock.
export function limitForDialog<T>(visible: T[], dialogOpen: boolean, narrow: boolean): T[] {
  return dialogOpen && narrow ? visible.slice(0, 1) : visible
}

type DialogCandidate = { getClientRects?: () => { length: number } }
type DialogDocument = {
  body: object
  querySelectorAll: (selector: string) => ArrayLike<DialogCandidate>
}
type ObserverFactory = new (callback: () => void) => { observe: (target: never, options: object) => void; disconnect: () => void }

// Event-driven: one observer on the document while a pop-up is showing, and none otherwise. It re-checks
// only when the DOM changes, and the check is one selector lookup over the (few) dialogs.
export function observeDialogOpen(doc: DialogDocument, Observer: ObserverFactory | undefined, onChange: (open: boolean) => void): () => void {
  // A dialog that is not drawn (display:none, like the session-quarantine host that always sits in the body) is not open.
  const read = () => {
    const nodes = doc.querySelectorAll('[aria-modal="true"]')
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      if (!node.getClientRects || node.getClientRects().length > 0) return onChange(true)
    }
    onChange(false)
  }
  read()
  if (!Observer) return () => {}
  const observer = new Observer(read)
  observer.observe(doc.body as never, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal', 'style', 'hidden', 'class'] })
  return () => observer.disconnect()
}

export function useDialogOpen(active: boolean): boolean {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!active || typeof document === 'undefined') {
      setOpen(false)
      return undefined
    }
    return observeDialogOpen(document, typeof MutationObserver === 'undefined' ? undefined : MutationObserver as unknown as ObserverFactory, setOpen)
  }, [active])
  return open
}

export function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(max-width: 767px)').matches)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const query = window.matchMedia('(max-width: 767px)')
    const sync = () => setNarrow(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])
  return narrow
}
