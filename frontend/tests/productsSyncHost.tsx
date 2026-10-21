// Host for the REAL Products page in request-count tests (component: '../tests/productsSyncHost.tsx'). The harness
// provides only the app context, so this adds what AppContext does with a sync:update event: it becomes the
// `syncChannel` the page reads. A test pushes an event with window.dispatchEvent(new CustomEvent("sync:update", ...)).
import { createElement, useEffect, useState, type ReactElement } from 'react'
import Products from '../src/components/products/Products.tsx'
import { SyncContext } from '../src/app/AppContextCore.tsx'

export default function ProductsSyncHost(): ReactElement {
  const [syncChannel, setSyncChannel] = useState<Record<string, unknown> | null>(null)
  useEffect(() => {
    const target = window as unknown as { dispatchEvent: (event: Event) => boolean }
    const original = target.dispatchEvent
    target.dispatchEvent = (event: Event) => {
      if (event.type === 'sync:update') {
        const detail = (event as CustomEvent<{ channel?: string; source?: string }>).detail || {}
        setSyncChannel({ channel: detail.channel, ts: Date.now(), reason: null, source: detail.source || null })
      }
      return true
    }
    return () => { target.dispatchEvent = original }
  }, [])
  return createElement(SyncContext.Provider, { value: { syncConnected: true, syncChannel, syncServerUnreachable: false } as never }, createElement(Products))
}
