// Shared stage for the scanner's mounted tests (barcodeScannerState,
// barcodeCameraCleanup, scannerIdleMounted): an in-memory DOM, a fake camera
// whose every track is counted, a fake permission status, and a stand-in for
// the decode Worker that runs the REAL frame handler (barcodeDecodeHandler.ts)
// on top of stand-ins for the ZXing readers, behind real structured cloning, so
// a buffer the page touches after transferring it is visibly gone.
//
// One stage per test process: the globals it installs are the process's.
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import react from '@vitejs/plugin-react'
import { createServer, type ViteDevServer } from 'vite'
import type { DecodeReply, DecodeRequest } from '../src/components/products/scanning/barcodeFrameDecoder.ts'

type Listener = (...args: unknown[]) => unknown

/** What the page does to the stage, in order. */
export const events: string[] = []
Object.defineProperty(globalThis, '__scannerEvents', { configurable: true, value: events })

/** Switches the tests flip. */
export const stage = {
  // Off by default so the permission tests keep their idle loop; the read
  // tests turn it on to give the scan loop a playing video.
  liveVideoFrames: false,
  // Whether <video> offers requestVideoFrameCallback (Chrome, Safari 15.4+) or only requestAnimationFrame is left.
  videoFrameCallbacks: false,
  videoFrameCallbackCalls: 0,
  videoFrameCallbackCancels: 0,
  // Every drawImage the page made onto the canvas that reads frames out.
  draws: [] as Array<{ sx: number; sy: number; sw: number; sh: number }>,
}

class MemoryNode {
  nodeType: number
  nodeName: string
  tagName: string
  ownerDocument: MemoryDocument
  parentNode: MemoryNode | null = null
  childNodes: MemoryNode[] = []
  style: Record<string, string> = {}
  namespaceURI: string
  nodeValue = ''
  // <video> surface the scanner touches: it plays the stream and polls readiness.
  readyState = 0
  videoWidth = 0
  videoHeight = 0
  width = 0
  height = 0
  srcObject: unknown = null
  muted = false
  requestVideoFrameCallback?: (callback: () => void) => number
  cancelVideoFrameCallback?: (id: number) => void
  private ownText = ''
  private attributes = new Map<string, string>()

  constructor(nodeType: number, nodeName: string, ownerDocument: MemoryDocument, namespaceURI = 'http://www.w3.org/1999/xhtml') {
    this.nodeType = nodeType
    this.nodeName = nodeName
    this.tagName = nodeName
    this.ownerDocument = ownerDocument
    this.namespaceURI = namespaceURI
    if (nodeName === 'VIDEO' && stage.liveVideoFrames) {
      this.readyState = 4
      this.videoWidth = 64
      this.videoHeight = 48
    }
    if (nodeName === 'VIDEO' && stage.videoFrameCallbacks) {
      this.requestVideoFrameCallback = (callback) => {
        stage.videoFrameCallbackCalls += 1
        return scheduleFrame(callback)
      }
      this.cancelVideoFrameCallback = (id) => {
        stage.videoFrameCallbackCancels += 1
        cancelFrame(id)
      }
    }
  }

  // The scan loop grabs frames through a canvas; record each grab.
  getContext(): unknown {
    if (this.nodeName !== 'CANVAS') return null
    return {
      drawImage: (source: MemoryNode, sx: number, sy: number, sw: number, sh: number) => {
        events.push(`frame-from-${source.nodeName.toLowerCase()}`)
        stage.draws.push({ sx, sy, sw, sh })
      },
      getImageData: (_x: number, _y: number, width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4).fill(128) }),
    }
  }

  appendChild(child: MemoryNode): MemoryNode { child.parentNode = this; this.ownText = ''; this.childNodes.push(child); return child }
  insertBefore(child: MemoryNode, before: MemoryNode): MemoryNode {
    child.parentNode = this; this.ownText = ''
    const index = this.childNodes.indexOf(before)
    if (index < 0) this.childNodes.push(child); else this.childNodes.splice(index, 0, child)
    return child
  }
  removeChild(child: MemoryNode): MemoryNode {
    const index = this.childNodes.indexOf(child)
    if (index >= 0) this.childNodes.splice(index, 1)
    child.parentNode = null
    return child
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  setAttribute(name: string, value: unknown): void { this.attributes.set(name, String(value)) }
  removeAttribute(name: string): void { this.attributes.delete(name) }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null }
  // The one class operation the page performs itself (scanFeedback.ts flashes the view), kept in the class attribute.
  classList = {
    add: (name: string): void => {
      const classes = (this.getAttribute('class') ?? '').split(' ').filter(Boolean)
      if (!classes.includes(name)) this.setAttribute('class', [...classes, name].join(' '))
    },
  }
  focus(): void { this.ownerDocument.activeElement = this }
  click(): void { events.push('photo-input-click') }
  play(): Promise<void> { return Promise.resolve() }
  pause(): void { events.push('video-pause') }
  contains(target: MemoryNode | null): boolean { return target === this || this.childNodes.some((child) => child.contains(target)) }
  get firstChild(): MemoryNode | null { return this.childNodes[0] ?? null }
  get lastChild(): MemoryNode | null { return this.childNodes[this.childNodes.length - 1] ?? null }
  get nextSibling(): MemoryNode | null {
    if (!this.parentNode) return null
    const index = this.parentNode.childNodes.indexOf(this)
    return this.parentNode.childNodes[index + 1] ?? null
  }
  set textContent(value: string) { this.ownText = String(value); this.childNodes = [] }
  get textContent(): string {
    if (this.nodeType === 3) return this.nodeValue
    return this.childNodes.length ? this.childNodes.map((child) => child.textContent).join('') : this.ownText
  }
}

type MemoryDocument = {
  nodeType: number
  nodeName: string
  documentElement: MemoryNode
  body: MemoryNode
  activeElement: MemoryNode | null
  defaultView: Record<string, unknown> | null
  visibilityState: string
  createElement: (name: string) => MemoryNode
  createElementNS: (namespaceURI: string, name: string) => MemoryNode
  createTextNode: (text: string) => MemoryNode
  addEventListener: (type: string, listener: Listener) => void
  removeEventListener: (type: string, listener: Listener) => void
}

// The listeners the page registers, so a test can fire visibilitychange or pagehide.
const listeners = { document: new Map<string, Set<Listener>>(), window: new Map<string, Set<Listener>>() }
const track = (store: Map<string, Set<Listener>>) => ({
  add(type: string, listener: Listener) { store.set(type, (store.get(type) ?? new Set()).add(listener)) },
  remove(type: string, listener: Listener) { store.get(type)?.delete(listener) },
})

const memoryDocument = {} as MemoryDocument
memoryDocument.nodeType = 9
memoryDocument.nodeName = '#document'
memoryDocument.defaultView = null
memoryDocument.visibilityState = 'visible'
memoryDocument.createElement = (name) => new MemoryNode(1, name.toUpperCase(), memoryDocument)
memoryDocument.createElementNS = (namespaceURI, name) => new MemoryNode(1, name, memoryDocument, namespaceURI)
memoryDocument.createTextNode = (text) => {
  const node = new MemoryNode(3, '#text', memoryDocument)
  node.nodeValue = String(text)
  return node
}
memoryDocument.addEventListener = track(listeners.document).add
memoryDocument.removeEventListener = track(listeners.document).remove
memoryDocument.documentElement = memoryDocument.createElement('html')
memoryDocument.body = memoryDocument.createElement('body')
memoryDocument.documentElement.appendChild(memoryDocument.body)
memoryDocument.activeElement = memoryDocument.documentElement

/** Fires every listener the page registered for `type` on `target`. */
export function fire(target: 'document' | 'window', type: string): void {
  for (const listener of [...(listeners[target].get(type) ?? [])]) listener({ type })
}

export function setVisibility(state: 'visible' | 'hidden'): void {
  memoryDocument.visibilityState = state
}

export function listenerCount(target: 'document' | 'window', type: string): number {
  return listeners[target].get(type)?.size ?? 0
}

// A fake native BarcodeDetector keeps the run on the native path, so the
// assertion is about getUserMedia and not about loading ZXing.
class FakeBarcodeDetector {
  static async getSupportedFormats(): Promise<string[]> { return ['ean_13'] }
  async detect(): Promise<Array<{ rawValue?: unknown }>> { return [] }
}

// Typed loosely so BarcodeDetector can be removed again: WebKit has none, and
// that absence is what sends iOS down the ZXing path.
const memoryWindow: Record<string, unknown> = {
  document: memoryDocument,
  HTMLElement: MemoryNode,
  HTMLIFrameElement: class {},
  BarcodeDetector: FakeBarcodeDetector,
  addEventListener: track(listeners.window).add,
  removeEventListener: track(listeners.window).remove,
  getSelection() { return null },
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
}
memoryDocument.defaultView = memoryWindow

// The scan loop reschedules itself forever; give it a budget so an assertion
// failure cannot turn into a hung test file.
const DEFAULT_FRAME_BUDGET = 120
let framesLeft = DEFAULT_FRAME_BUDGET
let frameBudget = DEFAULT_FRAME_BUDGET

/** Raises the frame budget for the next scenario, for tests that must run for a while. */
export function setFrameBudget(frames: number): void {
  frameBudget = frames
  framesLeft = frames
}
const frameTimers = new Map<number, ReturnType<typeof setTimeout>>()
let nextFrameId = 1

function scheduleFrame(callback: () => void): number {
  const id = nextFrameId++
  if (framesLeft-- <= 0) return id
  frameTimers.set(id, setTimeout(callback, 0))
  return id
}

function cancelFrame(id: number): void {
  const timer = frameTimers.get(id)
  if (timer) clearTimeout(timer)
  frameTimers.delete(id)
}

Object.defineProperty(globalThis, 'window', { configurable: true, value: memoryWindow })
Object.defineProperty(globalThis, 'document', { configurable: true, value: memoryDocument })
Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: MemoryNode })
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: scheduleFrame })
Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: cancelFrame })

export interface FakeTrack {
  readyState: string
  stopCount: number
  stop: () => void
  getCapabilities?: () => Record<string, unknown>
  applyConstraints?: (constraints: unknown) => Promise<void>
}

export interface CameraProbe {
  getUserMediaCalls: number
  tracks: FakeTrack[]
  requested: unknown[]
  applied: unknown[]
  /** The permission status the page watches; set `state` and call the listeners to revoke it. */
  permission: { state: string; listeners: Array<() => void> }
}

export interface CameraOptions {
  native?: boolean
  detector?: unknown
  capabilities?: Record<string, unknown>
  rejectTorch?: boolean
  /** Makes getUserMedia reject once, with this error name (e.g. 'NotAllowedError'). */
  rejectCamera?: string
}

export function installCamera(
  permissionState: 'granted' | 'prompt' | 'denied',
  { native = true, detector, capabilities, rejectTorch = false, rejectCamera }: CameraOptions = {},
): CameraProbe {
  const probe: CameraProbe = { getUserMediaCalls: 0, tracks: [], requested: [], applied: [], permission: { state: permissionState, listeners: [] } }
  events.length = 0
  stage.draws.length = 0
  stage.videoFrameCallbackCalls = 0
  stage.videoFrameCallbackCancels = 0
  framesLeft = frameBudget
  FakeWorker.reset()
  if (native) memoryWindow.BarcodeDetector = detector ?? FakeBarcodeDetector
  else delete memoryWindow.BarcodeDetector
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      permissions: {
        query: async () => ({
          get state() { return probe.permission.state },
          addEventListener(_type: string, listener: () => void) { probe.permission.listeners.push(listener) },
          removeEventListener(_type: string, listener: () => void) { probe.permission.listeners = probe.permission.listeners.filter((entry) => entry !== listener) },
        }),
      },
      mediaDevices: {
        getUserMedia: async (constraints: unknown) => {
          probe.getUserMediaCalls += 1
          probe.requested.push(constraints)
          events.push('getUserMedia')
          if (rejectCamera) {
            const failure = new Error(rejectCamera)
            failure.name = rejectCamera
            throw failure
          }
          const cameraTrack: FakeTrack = {
            readyState: 'live',
            stopCount: 0,
            stop() { this.stopCount += 1; this.readyState = 'ended' },
          }
          if (capabilities) {
            cameraTrack.getCapabilities = () => capabilities
            cameraTrack.applyConstraints = async (next: unknown) => {
              probe.applied.push(next)
              if (rejectTorch && JSON.stringify(next).includes('torch')) throw new Error('OverconstrainedError')
            }
          }
          probe.tracks.push(cameraTrack)
          return { getTracks: () => [cameraTrack], getVideoTracks: () => [cameraTrack] }
        },
      },
    },
  })
  return probe
}

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CORE = '/src/components/products/scanning'

// Stand-ins for the retail ZXing modules the worker's decoder imports by deep
// path. BarcodeFormat is evaluated by every decoder load, so it records the
// moment the decoder is built; each decode hands out the next queued read (an
// EAN-13 value from globalThis.__zxingReads) or reports nothing found.
const ZXING_DEEP_PREFIX = '@zxing/library/esm/core/'
const emptyClass = (name: string) => `export default class ${name} {}`
const ZXING_STUBS: Record<string, string> = {
  BarcodeFormat: `globalThis.__scannerEvents.push('zxing-module-evaluated')
    export default { EAN_13: 7, EAN_8: 6, UPC_A: 14, UPC_E: 15, CODE_128: 4, CODE_39: 2, ITF: 8 }`,
  DecodeHintType: 'export default { POSSIBLE_FORMATS: 2, TRY_HARDER: 3 }',
  NotFoundException: 'export default class NotFoundException extends Error {}',
  ChecksumException: 'export default class ChecksumException extends Error {}',
  FormatException: 'export default class FormatException extends Error {}',
  RGBLuminanceSource: emptyClass('RGBLuminanceSource'),
  BinaryBitmap: emptyClass('BinaryBitmap'),
  'common/HybridBinarizer': emptyClass('HybridBinarizer'),
  'oned/MultiFormatUPCEANReader': emptyClass('MultiFormatUPCEANReader'),
  'oned/Code39Reader': emptyClass('Code39Reader'),
  'oned/Code128Reader': emptyClass('Code128Reader'),
  'oned/ITFReader': emptyClass('ITFReader'),
  'oned/OneDReader': `import NotFoundException from '${ZXING_DEEP_PREFIX}NotFoundException'
    export default class OneDReader {
      constructor() { globalThis.__scannerEvents.push('zxing-reader-created') }
      decode() {
        const text = (globalThis.__zxingReads || []).shift()
        if (!text) throw new NotFoundException()
        return { getText: () => text, getBarcodeFormat: () => 7 }
      }
    }`,
}

/** Reads the stand-in ZXing hands out, one per decode call, in order. */
export function queueZxingReads(reads: string[]): void {
  ;(globalThis as { __zxingReads?: string[] }).__zxingReads = reads
}

/** The Worker the page gets. `FakeWorker.mode` decides how its boot goes. */
export class FakeWorker {
  static instances: FakeWorker[] = []
  /** 'ready': decoder loads and replies. 'never': it never answers. 'fails': it reports it cannot start. */
  static mode: 'ready' | 'never' | 'fails' = 'ready'
  /** How long a reply takes, so a test can hold a frame in flight. */
  static replyDelayMs = 0
  static reset(): void {
    FakeWorker.instances = []
    FakeWorker.mode = 'ready'
    FakeWorker.replyDelayMs = 0
  }

  onmessage: ((event: { data: DecodeReply }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminateCalls = 0
  /** The most requests that were ever waiting for an answer at once. */
  maxOutstanding = 0
  private outstanding = 0
  /** Every request the page sent, as the worker received it (a real structured clone). */
  received: DecodeRequest[] = []
  private handle: ((request: DecodeRequest) => DecodeReply) | null = null
  private chain: Promise<void> = Promise.resolve()

  url: unknown
  options: unknown

  constructor(url: unknown, options?: unknown) {
    this.url = url
    this.options = options
    FakeWorker.instances.push(this)
    events.push('worker-created')
    if (FakeWorker.mode === 'never') return
    this.chain = this.boot()
  }

  private async boot(): Promise<void> {
    if (FakeWorker.mode === 'fails') {
      await new Promise((settle) => setTimeout(settle, 0))
      this.reply({ type: 'failed', message: 'decoder could not start' })
      return
    }
    const { createDecodeHandler } = await currentVite().ssrLoadModule(`${CORE}/barcodeDecodeHandler.ts`) as typeof import('../src/components/products/scanning/barcodeDecodeHandler.ts')
    const { createLumaDecoder } = await currentVite().ssrLoadModule(`${CORE}/barcodeZxing.ts`) as typeof import('../src/components/products/scanning/barcodeZxing.ts')
    this.handle = createDecodeHandler(createLumaDecoder()).handle
    this.reply({ type: 'ready' })
  }

  private reply(message: DecodeReply): void {
    setTimeout(() => {
      if (message.type === 'read' || (message.type === 'failed' && message.id !== undefined)) this.outstanding -= 1
      if (!this.terminateCalls) this.onmessage?.({ data: message })
    }, message.type === 'ready' ? 0 : FakeWorker.replyDelayMs)
  }

  postMessage(message: DecodeRequest, transfer: Transferable[] = []): void {
    // A real postMessage clones the message and detaches what is transferred.
    const delivered = structuredClone(message, { transfer })
    this.received.push(delivered)
    this.outstanding += 1
    this.maxOutstanding = Math.max(this.maxOutstanding, this.outstanding)
    events.push('worker-request')
    if (FakeWorker.mode === 'never') return
    this.chain = this.chain.then(() => {
      if (!this.handle || this.terminateCalls) return
      this.reply(this.handle(delivered))
    })
  }

  terminate(): void {
    this.terminateCalls += 1
    events.push('worker-terminated')
  }

  /** The worker script dying on its own (a crash, a load failure). */
  crash(message = 'worker crashed'): void {
    this.onerror?.({ message })
  }
}
Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker })

let server: ViteDevServer | null = null
function currentVite(): ViteDevServer {
  if (!server) throw new Error('startStage() has not run')
  return server
}

/** Starts the Vite SSR loader, with the lucide icons and Modal stubbed and ZXing
 * replaced by the stand-ins above. */
export async function startStage(): Promise<void> {
  server = await createServer({
    root: frontendRoot,
    configFile: false,
    appType: 'custom',
    // Not the shared node_modules/.vite: this stage must not write into the
    // junction every worktree reads. SSR loading only, so no dependency scan.
    cacheDir: join(tmpdir(), 'business-os-scanner-stage-vite'),
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
    // Without this the decoder is externalised to Node's own resolver and the
    // stub below is never consulted -- the import would load (and fail on) the
    // real browser package instead of recording its evaluation order.
    ssr: { noExternal: ['@zxing/library'] },
    plugins: [
      {
        name: 'barcode-scanner-mocks',
        enforce: 'pre',
        resolveId(id) {
          if (id.includes('lucide-react')) return '\0scanner-icon'
          if (/shared\/Modal$/.test(id)) return '\0scanner-modal'
          // The decoder imports the retail readers by deep path (never the package root).
          if (id.startsWith(ZXING_DEEP_PREFIX)) return `\0scanner-zxing:${id.slice(ZXING_DEEP_PREFIX.length)}`
          return null
        },
        load(id) {
          if (id === '\0scanner-icon') return 'export default function Icon() { return null }'
          if (id === '\0scanner-modal') {
            // onClose is what the dialog's close button calls.
            return `import React from 'react'
              export default function Modal({ children, onClose }) {
                globalThis.__scannerModalClose = onClose
                return React.createElement('div', { role: 'dialog' }, children)
              }`
          }
          if (id.startsWith('\0scanner-zxing:')) return ZXING_STUBS[id.slice('\0scanner-zxing:'.length)]
          return null
        },
      },
      react(),
    ],
  })
}

export async function stopStage(): Promise<void> {
  await server?.close()
  server = null
  for (const timer of frameTimers.values()) clearTimeout(timer)
  frameTimers.clear()
}

/** What the page asked the dialog's close button to do. */
export function pressDialogClose(): void {
  const close = (globalThis as { __scannerModalClose?: () => void }).__scannerModalClose
  if (!close) throw new Error('no dialog is mounted')
  close()
}

export interface Mounted {
  container: MemoryNode
  text: string
  unmount: () => Promise<void>
}

/** Mounts the default export of `modulePath` (a path under frontend/) with a
 * fresh module graph, and lets the permission read, the video commit and the
 * camera start settle. No click happens anywhere in here. */
export async function mountComponent(modulePath: string, props: Record<string, unknown>, settleMs = 50): Promise<Mounted> {
  // The warm-up and the decoder keep per-module caches: a fresh graph per mount
  // keeps scenarios independent and re-records the stub's evaluation event.
  currentVite().moduleGraph.invalidateAll()
  const module = await currentVite().ssrLoadModule(modulePath) as { default: React.ComponentType<Record<string, unknown>> }
  const container = memoryDocument.createElement('div')
  memoryDocument.body.appendChild(container)
  const root = createRoot(container as unknown as Element)
  await act(async () => {
    root.render(React.createElement(module.default, props))
    await Promise.resolve()
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, settleMs)) })
  const text = container.textContent
  let unmounted = false
  return {
    container,
    text,
    unmount: async () => {
      if (unmounted) return
      unmounted = true
      await act(async () => root.unmount())
      memoryDocument.body.removeChild(container)
    },
  }
}

/** Lets timers and promises run for `ms` inside act(). */
export async function settle(ms: number): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
}

export async function waitFor(condition: () => boolean, attempts = 40, stepMs = 25): Promise<void> {
  for (let wait = 0; wait < attempts && !condition(); wait += 1) await settle(stepMs)
}

export { act }
export type { MemoryNode }
