import assert from 'node:assert/strict'

type Timer = { id: number; due: number; callback: () => void }

let now = 1_000_000
let nextTimerId = 1
let timers: Timer[] = []
let authStored = true
let visibilityState = 'visible'
let online = true
const listeners = new Map<string, Set<(event: { type: string; detail?: unknown }) => void>>()

const originalDateNow = Date.now
const originalMathRandom = Math.random
const originalSetTimeout = globalThis.setTimeout
const originalClearTimeout = globalThis.clearTimeout
const originalSetInterval = globalThis.setInterval
const originalClearInterval = globalThis.clearInterval

Date.now = () => now
Math.random = () => 0.5
globalThis.setTimeout = ((callback: () => void, delay = 0) => {
  const timer = { id: nextTimerId++, due: now + Number(delay), callback }
  timers.push(timer)
  return timer.id
}) as typeof setTimeout
globalThis.clearTimeout = ((id: number) => {
  timers = timers.filter((timer) => timer.id !== Number(id))
}) as typeof clearTimeout
globalThis.setInterval = (() => 1) as unknown as typeof setInterval
globalThis.clearInterval = (() => {}) as typeof clearInterval

const fakeWindow = {
  sessionStorage: { getItem: () => authStored ? '{"id":1}' : null },
  localStorage: { getItem: () => null },
  location: { hostname: 'admin.leangbeauty.com' },
  addEventListener(type: string, listener: (event: { type: string; detail?: unknown }) => void) {
    const group = listeners.get(type) || new Set()
    group.add(listener)
    listeners.set(type, group)
  },
  dispatchEvent(event: { type: string; detail?: unknown }) {
    for (const listener of listeners.get(event.type) || []) listener(event)
    return true
  },
}

Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow })
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { get visibilityState() { return visibilityState } },
})
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { get onLine() { return online } },
})
Object.defineProperty(globalThis, 'CustomEvent', {
  configurable: true,
  value: class CustomEvent {
    type: string
    detail: unknown
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type
      this.detail = init?.detail
    }
  },
})

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readyState = FakeWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  readonly url: string

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(): void {}

  close(code = 1000, reason = ''): void {
    this.readyState = FakeWebSocket.CLOSED
    const handler = this.onclose
    if (handler) handler({ code, reason })
  }
}

Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FakeWebSocket })

function nextDelay(): number | null {
  if (!timers.length) return null
  return Math.min(...timers.map((timer) => timer.due)) - now
}

function advance(ms: number): void {
  const target = now + ms
  while (true) {
    const next = [...timers].sort((left, right) => left.due - right.due || left.id - right.id)[0]
    if (!next || next.due > target) break
    timers = timers.filter((timer) => timer.id !== next.id)
    now = next.due
    next.callback()
  }
  now = target
}

function failLatest(code = 1006): void {
  const socket = FakeWebSocket.instances.at(-1)
  assert.ok(socket, 'expected an active WebSocket attempt')
  socket.readyState = FakeWebSocket.CLOSED
  socket.onclose?.({ code, reason: '' })
}

try {
  const { setSyncServerUrl } = await import('../src/api/httpState.ts')
  const { connectWS, disconnectWS, resumeWS } = await import('../src/api/websocket.ts')
  setSyncServerUrl('https://admin.leangbeauty.com')

  connectWS()
  assert.equal(FakeWebSocket.instances.length, 1)

  failLatest()
  assert.equal(nextDelay(), 9_000, 'first failure should retain exponential backoff')
  advance(9_000)
  assert.equal(FakeWebSocket.instances.length, 2)

  failLatest()
  assert.equal(nextDelay(), 16_200, 'second failure should retain exponential backoff')
  advance(16_200)
  assert.equal(FakeWebSocket.instances.length, 3)

  failLatest()
  assert.equal(nextDelay(), 60_000, 'third failure should schedule one cooldown-expiry wake-up')
  advance(59_999)
  assert.equal(FakeWebSocket.instances.length, 3, 'cooldown must suppress early reconnects')
  assert.equal(timers.length, 1, 'cooldown must retain exactly one wake-up')
  advance(1)
  assert.equal(FakeWebSocket.instances.length, 4, 'foreground session should reconnect when cooldown expires')
  assert.equal(timers.length, 0)

  failLatest()
  assert.equal(timers.length, 1)
  disconnectWS()
  assert.equal(timers.length, 0, 'logout/manual disconnect must cancel the cooldown wake-up')
  advance(120_000)
  assert.equal(FakeWebSocket.instances.length, 4, 'a cancelled cooldown must not reconnect later')

  visibilityState = 'hidden'
  resumeWS()
  assert.equal(FakeWebSocket.instances.length, 4, 'hidden documents remain lifecycle-gated')
  visibilityState = 'visible'
  online = false
  resumeWS()
  assert.equal(FakeWebSocket.instances.length, 4, 'offline browsers remain lifecycle-gated')
  online = true
  resumeWS()
  assert.equal(FakeWebSocket.instances.length, 5, 'online lifecycle resume should reconnect immediately')

  failLatest(4001)
  assert.equal(timers.length, 0, 'invalid sessions must not schedule a reconnect')
  advance(120_000)
  assert.equal(FakeWebSocket.instances.length, 5, 'invalid sessions stay disconnected without login recovery')
  authStored = true
  resumeWS()
  assert.equal(FakeWebSocket.instances.length, 6, 'successful login lifecycle can clear auth suppression')
  disconnectWS()

  console.log('websocket reconnect lifecycle tests passed')
} finally {
  Date.now = originalDateNow
  Math.random = originalMathRandom
  globalThis.setTimeout = originalSetTimeout
  globalThis.clearTimeout = originalClearTimeout
  globalThis.setInterval = originalSetInterval
  globalThis.clearInterval = originalClearInterval
}
