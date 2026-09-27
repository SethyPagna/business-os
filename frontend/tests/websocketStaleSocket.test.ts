// F2: AppContext now learns the socket state only from websocket.ts's
// sync:status events (it used to poll isWSConnected() every 3 s, which hid
// this). A browser delivers a socket's close event asynchronously, so when
// resumeWS() replaces a stale socket, the old socket's close arrives after
// the new one is open. Before F2 that late close announced "disconnected",
// nulled the live socket and cleared its ping timer.
import assert from 'node:assert/strict'

type Listener = (event: { type: string; detail?: unknown }) => void
const listeners = new Map<string, Set<Listener>>()
const statuses: boolean[] = []
let now = 10_000_000
const timers: Array<{ id: number; callback: () => void }> = []
let nextId = 1

const originalDateNow = Date.now
const originalSetTimeout = globalThis.setTimeout
const originalClearTimeout = globalThis.clearTimeout
const originalSetInterval = globalThis.setInterval
const originalClearInterval = globalThis.clearInterval
Date.now = () => now
globalThis.setTimeout = ((callback: () => void) => { const id = nextId++; timers.push({ id, callback }); return id }) as unknown as typeof setTimeout
globalThis.clearTimeout = ((id: number) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1) }) as typeof clearTimeout
globalThis.setInterval = (() => nextId++) as unknown as typeof setInterval
globalThis.clearInterval = (() => {}) as typeof clearInterval

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    sessionStorage: { getItem: () => '{"id":1}' },
    localStorage: { getItem: () => null },
    location: { hostname: 'admin.example.test' },
    addEventListener(type: string, listener: Listener) {
      const group = listeners.get(type) || new Set()
      group.add(listener)
      listeners.set(type, group)
    },
    dispatchEvent(event: { type: string; detail?: { connected?: boolean } }) {
      if (event.type === 'sync:status') statuses.push(event.detail?.connected === true)
      for (const listener of listeners.get(event.type) || []) listener(event)
      return true
    },
  },
})
Object.defineProperty(globalThis, 'document', { configurable: true, value: { visibilityState: 'visible' } })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } })
Object.defineProperty(globalThis, 'CustomEvent', {
  configurable: true,
  value: class CustomEvent {
    type: string
    detail: unknown
    constructor(type: string, init?: { detail?: unknown }) { this.type = type; this.detail = init?.detail }
  },
})

// Closes like a browser: the close event is queued, not delivered inside close().
class AsyncCloseWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: AsyncCloseWebSocket[] = []
  readyState = AsyncCloseWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  pendingClose: { code: number; reason: string } | null = null
  sent: string[] = []
  readonly url: string
  constructor(url: string) { this.url = url; AsyncCloseWebSocket.instances.push(this) }
  send(data: string): void { this.sent.push(data) }
  open(): void { this.readyState = AsyncCloseWebSocket.OPEN; this.onopen?.() }
  close(code = 1000, reason = ''): void {
    if (this.readyState === AsyncCloseWebSocket.CLOSED) return
    this.readyState = AsyncCloseWebSocket.CLOSING
    this.pendingClose = { code, reason }
  }
  deliverClose(code?: number): void {
    const event = code ? { code, reason: '' } : this.pendingClose || { code: 1006, reason: '' }
    this.readyState = AsyncCloseWebSocket.CLOSED
    this.pendingClose = null
    this.onclose?.(event)
  }
}
Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: AsyncCloseWebSocket })

try {
  const { setSyncServerUrl } = await import('../src/api/httpState.ts')
  const { connectWS, disconnectWS, isWSConnected, resumeWS } = await import('../src/api/websocket.ts')
  setSyncServerUrl('https://admin.example.test')

  connectWS()
  const first = AsyncCloseWebSocket.instances[0]
  first.open()
  assert.equal(isWSConnected(), true)

  // The socket went quiet (e.g. a suspended phone): resume replaces it.
  now += 60_000
  resumeWS()
  assert.equal(AsyncCloseWebSocket.instances.length, 2, 'resume must open a replacement socket')
  const second = AsyncCloseWebSocket.instances[1]
  second.open()
  assert.equal(statuses.at(-1), true)

  // Only now does the browser deliver the stale socket's close.
  first.deliverClose()
  assert.equal(isWSConnected(), true, 'a replaced socket closing late must not detach the live socket')
  assert.equal(statuses.at(-1), true, 'a replaced socket closing late must not announce "disconnected"')

  // A disconnect followed at once by a new connection: the intentional close
  // belongs to the old socket and must not swallow the new socket's real drop.
  disconnectWS()
  connectWS()
  const third = AsyncCloseWebSocket.instances[2]
  third.open()
  second.deliverClose()
  assert.equal(isWSConnected(), true)
  const timersBefore = timers.length
  third.deliverClose(1006)
  assert.equal(statuses.at(-1), false, 'the live socket dropping is announced')
  assert.ok(timers.length > timersBefore, 'the live socket dropping must schedule a reconnect')

  disconnectWS()
  console.log('websocket stale socket tests passed')
} finally {
  Date.now = originalDateNow
  globalThis.setTimeout = originalSetTimeout
  globalThis.clearTimeout = originalClearTimeout
  globalThis.setInterval = originalSetInterval
  globalThis.clearInterval = originalClearInterval
}
