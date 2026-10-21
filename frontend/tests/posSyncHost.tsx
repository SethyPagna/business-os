// Host for the REAL POS in request-count tests (component: '../tests/posSyncHost.tsx'). The harness provides only the
// app context, so this adds what AppContext does with a sync:update event: it becomes the `syncChannel` the till reads
// (channel, ts, source). Every sync:update the till dispatches is also recorded, so a test sees what other pages would hear.
import { createElement, useEffect, useState, type ReactElement } from 'react'
import POS from '../src/components/pos/POS.tsx'
import { SyncContext } from '../src/app/AppContextCore.tsx'

export const HEARD = Symbol.for('posSyncHost.heard')

export default function PosSyncHost(): ReactElement {
  const [syncChannel, setSyncChannel] = useState<Record<string, unknown> | null>(null)
  useEffect(() => {
    const target = window as unknown as { dispatchEvent: (event: Event) => boolean }
    const original = target.dispatchEvent
    const heard: unknown[] = []
    ;(globalThis as Record<symbol, unknown>)[HEARD] = heard
    target.dispatchEvent = (event: Event) => {
      if (event.type === 'sync:update') {
        const detail = (event as CustomEvent<{ channel?: string; source?: string }>).detail || {}
        heard.push(detail)
        setSyncChannel({ channel: detail.channel, ts: Date.now(), reason: null, source: detail.source || null })
      }
      return true
    }
    return () => { target.dispatchEvent = original }
  }, [])
  return createElement(SyncContext.Provider, { value: { syncConnected: true, syncChannel, syncServerUnreachable: false } as never }, createElement(POS))
}
