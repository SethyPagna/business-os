import { useCallback, useEffect, useRef, useState } from 'react'
import { NOTIFICATION_MAX_VISIBLE, subscribeToasts } from '../components/shared/toastChannel.ts'

export type Toast = {
  key: string
  message: string
  type: string
  duration: number
  onActivate?: () => void
  // Drawn from the context's own slot: dismissing it tells the context.
  fromSlot?: boolean
}

// The context's own single `notification` slot (write-conflict notices, the forced sign-out error). Its
// lifetime belongs to the context, which clears it; the stack only draws it, above the pop-ups.
type Slot = { id?: number; message: string; type?: string } | null
type Timer = { handle: number | null; left: number; startedAt: number }

export function slotToast(slot: Slot): Toast | null {
  if (!slot?.message) return null
  return { key: `slot-${slot.id ?? 0}`, message: slot.message, type: slot.type || 'info', duration: Infinity, fromSlot: true }
}

// The newest message is always on screen. At most NOTIFICATION_MAX_VISIBLE show at once; a further one pushes
// the oldest off at once (there is no waiting list). A message identical to one already showing does not add a
// second pop-up, it restarts that pop-up's clock. Every clock starts when its pop-up is shown.
export function useToastStack(slot: Slot) {
  const [items, setItems] = useState<Toast[]>([])
  const list = useRef<Toast[]>([])
  const timers = useRef(new Map<string, Timer>())
  const seq = useRef(0)

  const commit = useCallback((next: Toast[]) => {
    list.current = next
    setItems(next)
  }, [])

  const stop = useCallback((key: string) => {
    const timer = timers.current.get(key)
    if (timer?.handle != null) window.clearTimeout(timer.handle)
    timers.current.delete(key)
  }, [])

  const dismiss = useCallback((key: string) => {
    stop(key)
    if (list.current.some((item) => item.key === key)) commit(list.current.filter((item) => item.key !== key))
  }, [commit, stop])

  const start = useCallback((key: string, ms: number) => {
    stop(key)
    const entry: Timer = { handle: null, left: ms, startedAt: Date.now() }
    entry.handle = window.setTimeout(() => dismiss(key), ms)
    timers.current.set(key, entry)
  }, [dismiss, stop])

  useEffect(() => subscribeToasts((request) => {
    const ms = Number.isFinite(request.duration) ? Math.max(0, request.duration) : 0
    const current = list.current
    const same = current.find((item) => item.message === request.message && item.type === request.type)
    if (same) {
      start(same.key, ms)
      commit(current.map((item) => (item === same ? { ...item, duration: ms, onActivate: request.onActivate || item.onActivate } : item)))
      return
    }
    seq.current += 1
    const key = `toast-${seq.current}`
    const next = [...current, { key, ...request, duration: ms }]
    while (next.length > NOTIFICATION_MAX_VISIBLE) {
      const evicted = next.shift()
      if (evicted) stop(evicted.key)
    }
    commit(next)
    start(key, ms)
  }), [commit, start, stop])

  useEffect(() => () => {
    for (const timer of timers.current.values()) if (timer.handle != null) window.clearTimeout(timer.handle)
    timers.current.clear()
  }, [])

  const pause = useCallback((key: string) => {
    const timer = timers.current.get(key)
    if (!timer || timer.handle == null) return
    window.clearTimeout(timer.handle)
    timer.handle = null
    timer.left = Math.max(0, timer.left - (Date.now() - timer.startedAt))
  }, [])

  const resume = useCallback((key: string) => {
    const timer = timers.current.get(key)
    if (!timer || timer.handle != null) return
    start(key, timer.left)
  }, [start])

  return { visible: [...items].reverse(), slot: slotToast(slot), dismiss, pause, resume }
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
