import { useCallback, useEffect, useRef, useState } from 'react'
import { NOTIFICATION_MAX_VISIBLE, subscribeToasts } from '../components/shared/toastChannel.ts'

export type Toast = {
  key: string
  message: string
  type: string
  duration: number
  onActivate?: () => void
  // Raised through the context's single `notification` slot, which clears itself; the stack never times it.
  fromSlot?: boolean
}

type Slot = { id?: number; message: string; type?: string } | null
type Timer = { handle: number | null; left: number; startedAt: number }

// At most NOTIFICATION_MAX_VISIBLE pop-ups show at once, newest on top; the rest wait in arrival
// order and each one's clock starts only when it appears. Hover or focus pauses that pop-up's clock.
export function useToastStack(slot: Slot) {
  const [items, setItems] = useState<Toast[]>([])
  const timers = useRef(new Map<string, Timer>())
  const seq = useRef(0)

  const dismiss = useCallback((key: string) => {
    const timer = timers.current.get(key)
    if (timer?.handle != null) window.clearTimeout(timer.handle)
    timers.current.delete(key)
    setItems((current) => current.filter((item) => item.key !== key))
  }, [])

  useEffect(() => subscribeToasts((request) => {
    seq.current += 1
    const key = `toast-${seq.current}`
    setItems((current) => [...current, { key, ...request }])
  }), [])

  useEffect(() => {
    setItems((current) => {
      const rest = current.filter((item) => !item.fromSlot)
      if (!slot?.message) return rest.length === current.length ? current : rest
      return [...rest, { key: `slot-${slot.id ?? 0}`, message: slot.message, type: slot.type || 'info', duration: Infinity, fromSlot: true }]
    })
  }, [slot])

  const start = useCallback((key: string, ms: number) => {
    const entry: Timer = { handle: null, left: ms, startedAt: Date.now() }
    entry.handle = window.setTimeout(() => dismiss(key), ms)
    timers.current.set(key, entry)
  }, [dismiss])

  useEffect(() => {
    const visible = items.slice(0, NOTIFICATION_MAX_VISIBLE)
    const present = new Set(items.map((item) => item.key))
    for (const [key, timer] of timers.current) {
      if (present.has(key)) continue
      if (timer.handle != null) window.clearTimeout(timer.handle)
      timers.current.delete(key)
    }
    for (const item of visible) {
      if (item.fromSlot || !Number.isFinite(item.duration) || timers.current.has(item.key)) continue
      start(item.key, Math.max(0, item.duration))
    }
  }, [items, start])

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

  return { visible: items.slice(0, NOTIFICATION_MAX_VISIBLE).reverse(), dismiss, pause, resume }
}
