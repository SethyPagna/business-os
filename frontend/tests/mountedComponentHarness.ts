import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import react from '@vitejs/plugin-react'
import { createServer, type Plugin, type ViteDevServer } from 'vite'
import ts from 'typescript'

type Listener = (...args: unknown[]) => unknown
export type Double = (...args: never[]) => unknown
export type ModuleDoubles = Record<string, Record<string, Double>>
export type NodePredicate = (node: MemoryNode) => boolean

const frontendRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const srcRoot = resolve(frontendRoot, 'src')
const srcFrameMarker = `${srcRoot.replace(/\\/g, '/')}/`.toLowerCase()
const APP_CONTEXT_PROVIDER = 'AppContext.tsx'
const APP_CONTEXT_CORE = 'app/AppContextCore.tsx'
const DOUBLE_PREFIX = '\0mounted-double:'
const TRANSPORT_MODULE = /^api\/[^/]+Transport\.ts$/
const DISPATCH = Symbol.for('mountedComponentHarness.dispatch')
const LONG_TIMER_MS = 1_000
const FLUSH_MS = 4
const QUIET_MS = 120
// Only a stuck surface reaches it; 10 s was hit once by a healthy surface on a loaded machine.
const SETTLE_DEADLINE_MS = 30_000

let domVersion = 0
let bundlerActivity = 0
let transformsInFlight = 0

class MemoryStyle {
  [property: string]: unknown
  setProperty(name: string, value: string): void { this[name] = value; domVersion += 1 }
  removeProperty(name: string): void { delete this[name]; domVersion += 1 }
  getPropertyValue(name: string): string { return String(this[name] ?? '') }
}

export class MemoryNode {
  nodeType: number
  nodeName: string
  tagName: string
  ownerDocument: MemoryDocument
  namespaceURI: string
  parentNode: MemoryNode | null = null
  childNodes: MemoryNode[] = []
  style = new MemoryStyle()
  private ownValue = ''
  private attributes = new Map<string, string>()
  private listeners = new Map<string, Set<Listener>>()

  constructor(nodeType: number, nodeName: string, ownerDocument: MemoryDocument, namespaceURI = 'http://www.w3.org/1999/xhtml') {
    this.nodeType = nodeType
    this.nodeName = nodeName
    this.tagName = nodeName
    this.ownerDocument = ownerDocument
    this.namespaceURI = namespaceURI
  }

  get nodeValue(): string { return this.ownValue }
  set nodeValue(value: string) { this.ownValue = String(value); domVersion += 1 }
  get data(): string { return this.ownValue }
  set data(value: string) { this.nodeValue = value }
  get textContent(): string {
    if (this.nodeType === 3) return this.ownValue
    return this.childNodes.map((child) => child.textContent).join('')
  }
  set textContent(value: string) {
    for (const child of this.childNodes) child.parentNode = null
    this.childNodes = []
    if (value !== '' && value != null) this.appendChild(this.ownerDocument.createTextNode(String(value)))
    domVersion += 1
  }
  get firstChild(): MemoryNode | null { return this.childNodes[0] ?? null }
  get lastChild(): MemoryNode | null { return this.childNodes[this.childNodes.length - 1] ?? null }
  get parentElement(): MemoryNode | null { return this.parentNode?.nodeType === 1 ? this.parentNode : null }
  get children(): MemoryNode[] { return this.childNodes.filter((child) => child.nodeType === 1) }
  get nextSibling(): MemoryNode | null { return this.sibling(1) }
  get previousSibling(): MemoryNode | null { return this.sibling(-1) }
  get id(): string { return this.getAttribute('id') ?? '' }
  set id(value: string) { this.setAttribute('id', value) }
  get className(): string { return this.getAttribute('class') ?? '' }
  set className(value: string) { this.setAttribute('class', value) }
  get isConnected(): boolean { return this.ownerDocument.documentElement.contains(this) }

  private sibling(step: number): MemoryNode | null {
    if (!this.parentNode) return null
    const siblings = this.parentNode.childNodes
    return siblings[siblings.indexOf(this) + step] ?? null
  }

  appendChild(child: MemoryNode): MemoryNode {
    child.parentNode?.removeChild(child)
    child.parentNode = this
    this.childNodes.push(child)
    domVersion += 1
    return child
  }

  insertBefore(child: MemoryNode, before: MemoryNode | null): MemoryNode {
    child.parentNode?.removeChild(child)
    child.parentNode = this
    const index = before ? this.childNodes.indexOf(before) : -1
    if (index < 0) this.childNodes.push(child)
    else this.childNodes.splice(index, 0, child)
    domVersion += 1
    return child
  }

  removeChild(child: MemoryNode): MemoryNode {
    const index = this.childNodes.indexOf(child)
    if (index >= 0) this.childNodes.splice(index, 1)
    child.parentNode = null
    domVersion += 1
    return child
  }

  remove(): void { this.parentNode?.removeChild(this) }
  append(...nodes: Array<MemoryNode | string>): void {
    for (const node of nodes) this.appendChild(typeof node === 'string' ? this.ownerDocument.createTextNode(node) : node)
  }
  prepend(...nodes: Array<MemoryNode | string>): void {
    const first = this.firstChild
    for (const node of nodes) this.insertBefore(typeof node === 'string' ? this.ownerDocument.createTextNode(node) : node, first)
  }
  replaceChildren(...nodes: Array<MemoryNode | string>): void {
    this.textContent = ''
    this.append(...nodes)
  }
  get classList() {
    const classes = (): string[] => this.className.split(/\s+/).filter(Boolean)
    const write = (next: string[]): void => this.setAttribute('class', next.join(' '))
    return {
      contains: (name: string) => classes().includes(name),
      add: (...names: string[]) => write([...new Set([...classes(), ...names])]),
      remove: (...names: string[]) => write(classes().filter((name) => !names.includes(name))),
      toggle: (name: string, force?: boolean) => {
        const on = force ?? !classes().includes(name)
        write(on ? [...new Set([...classes(), name])] : classes().filter((existing) => existing !== name))
        return on
      },
    }
  }
  setAttribute(name: string, value: unknown): void { this.attributes.set(name, String(value)); domVersion += 1 }
  removeAttribute(name: string): void { this.attributes.delete(name); domVersion += 1 }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null }
  hasAttribute(name: string): boolean { return this.attributes.has(name) }
  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(type, set)
  }
  removeEventListener(type: string, listener: Listener): void { this.listeners.get(type)?.delete(listener) }
  dispatchEvent(): boolean { return true }
  focus(): void { this.ownerDocument.activeElement = this }
  blur(): void { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body }
  click(): void {}
  select(): void {}
  scrollIntoView(): void {}
  scrollTo(): void {}
  setSelectionRange(): void {}
  getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } }
  getClientRects(): unknown[] { return [] }
  contains(target: MemoryNode | null): boolean { return !!target && (target === this || this.childNodes.some((child) => child.contains(target))) }
  closest(selector: string): MemoryNode | null {
    for (let node: MemoryNode | null = this; node; node = node.parentNode) if (node.nodeType === 1 && matchesSelector(node, selector)) return node
    return null
  }
  matches(selector: string): boolean { return matchesSelector(this, selector) }
  querySelectorAll(selector: string): MemoryNode[] { return descendantsOf(this).filter((node) => node.nodeType === 1 && matchesSelector(node, selector)) }
  querySelector(selector: string): MemoryNode | null { return this.querySelectorAll(selector)[0] ?? null }
  getElementsByTagName(tag: string): MemoryNode[] { return this.querySelectorAll(tag) }
}

function descendantsOf(root: MemoryNode): MemoryNode[] {
  const found: MemoryNode[] = []
  const visit = (node: MemoryNode): void => {
    for (const child of node.childNodes) {
      found.push(child)
      visit(child)
    }
  }
  visit(root)
  return found
}

function matchesSelector(node: MemoryNode, selector: string): boolean {
  const simple = selector.trim()
  if (/[\s>+~,:]/.test(simple)) return false
  const parts = simple.match(/^([a-zA-Z][\w-]*)?((?:[#.][\w-]+|\[[^\]]+\])*)$/)
  if (!parts) return false
  if (parts[1] && parts[1].toUpperCase() !== node.tagName.toUpperCase()) return false
  for (const part of parts[2].match(/[#.][\w-]+|\[[^\]]+\]/g) ?? []) {
    if (part.startsWith('#') && node.getAttribute('id') !== part.slice(1)) return false
    if (part.startsWith('.') && !node.className.split(/\s+/).includes(part.slice(1))) return false
    if (part.startsWith('[')) {
      const [, name, value] = part.match(/^\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]$/) ?? []
      if (!name || !node.hasAttribute(name)) return false
      if (value !== undefined && node.getAttribute(name) !== value) return false
    }
  }
  return true
}

export class MemoryDocument {
  nodeType = 9
  nodeName = '#document'
  defaultView: Record<string, unknown> | null = null
  documentElement: MemoryNode
  head: MemoryNode
  body: MemoryNode
  activeElement: MemoryNode | null
  visibilityState = 'visible'
  hidden = false
  readyState = 'complete'
  cookie = ''

  constructor() {
    this.documentElement = this.createElement('html')
    this.head = this.createElement('head')
    this.body = this.createElement('body')
    this.documentElement.appendChild(this.head)
    this.documentElement.appendChild(this.body)
    this.activeElement = this.body
  }

  createElement(name: string): MemoryNode { return new MemoryNode(1, name.toUpperCase(), this) }
  createElementNS(namespaceURI: string, name: string): MemoryNode { return new MemoryNode(1, name, this, namespaceURI) }
  createTextNode(text: string): MemoryNode {
    const node = new MemoryNode(3, '#text', this)
    node.nodeValue = String(text)
    return node
  }
  createComment(text: string): MemoryNode {
    const node = new MemoryNode(8, '#comment', this)
    node.nodeValue = String(text)
    return node
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean { return true }
  getElementById(id: string): MemoryNode | null { return this.documentElement.querySelector(`#${id}`) }
  querySelector(selector: string): MemoryNode | null { return this.documentElement.querySelector(selector) }
  querySelectorAll(selector: string): MemoryNode[] { return this.documentElement.querySelectorAll(selector) }
  getSelection(): null { return null }
  hasFocus(): boolean { return true }
}

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)) },
    removeItem: (key: string) => { values.delete(key) },
    clear: () => { values.clear() },
  }
}

class InertObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): unknown[] { return [] }
}

type TimerHandle = NodeJS.Timeout
interface SourceTimer { sequence: number; delay: number; handle: TimerHandle; run(): void }

const realSetTimeout = globalThis.setTimeout as unknown as (callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => TimerHandle
const realClearTimeout = globalThis.clearTimeout as unknown as (handle: unknown) => void
const realSetInterval = globalThis.setInterval as unknown as (callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => TimerHandle
const realClearInterval = globalThis.clearInterval as unknown as (handle: unknown) => void
const sourceTimers = new Map<unknown, SourceTimer>()
const sourceIntervals = new Set<unknown>()
let timerSequence = 0

function calledFromSource(): boolean {
  const frames = (new Error().stack ?? '').split('\n').slice(3)
  return frames.some((frame) => {
    const normalized = frame.replace(/\\/g, '/').toLowerCase()
    return normalized.includes(srcFrameMarker) && !normalized.includes('/node_modules/')
  })
}

function trackedSetTimeout(callback: unknown, delay?: number, ...args: unknown[]): TimerHandle {
  if (typeof callback !== 'function' || !calledFromSource()) return realSetTimeout(callback as Listener, delay, ...args)
  const timer = { sequence: ++timerSequence, delay: Number(delay) || 0 } as SourceTimer
  timer.run = () => {
    sourceTimers.delete(timer.handle)
    ;(callback as Listener)(...args)
  }
  timer.handle = realSetTimeout(timer.run, timer.delay)
  if (timer.delay >= LONG_TIMER_MS) timer.handle.unref?.()
  sourceTimers.set(timer.handle, timer)
  return timer.handle
}

function trackedClearTimeout(handle: unknown): void {
  sourceTimers.delete(handle)
  realClearTimeout(handle)
}

function trackedSetInterval(callback: unknown, delay?: number, ...args: unknown[]): TimerHandle {
  const handle = realSetInterval(callback as Listener, delay, ...args)
  if (calledFromSource()) sourceIntervals.add(handle)
  return handle
}

function trackedClearInterval(handle: unknown): void {
  sourceIntervals.delete(handle)
  realClearInterval(handle)
}

function disposeSourceTimers(): void {
  for (const timer of sourceTimers.values()) realClearTimeout(timer.handle)
  sourceTimers.clear()
  for (const handle of sourceIntervals) realClearInterval(handle)
  sourceIntervals.clear()
}

export function timerMark(): number { return timerSequence }

export function expireWaitsSince(mark: number): number {
  const due = [...sourceTimers.values()].filter((timer) => timer.sequence > mark && timer.delay >= LONG_TIMER_MS)
  for (const timer of due) {
    realClearTimeout(timer.handle)
    timer.run()
  }
  return due.length
}

function pendingShortTimers(): number {
  let count = 0
  for (const timer of sourceTimers.values()) if (timer.delay < LONG_TIMER_MS) count += 1
  return count
}

export function installSteppedClock(): { advance(ms: number): void; restore(): void } {
  const RealDate = globalThis.Date
  let offsetMs = 0
  const now = (): number => RealDate.now() + offsetMs
  globalThis.Date = new Proxy(RealDate, {
    construct: (target, args, newTarget) => Reflect.construct(target, args.length ? args : [now()], newTarget),
    apply: () => new RealDate(now()).toString(),
    get: (target, property, receiver) => (property === 'now' ? now : Reflect.get(target, property, receiver)),
  })
  return {
    advance: (ms: number) => { offsetMs += ms },
    restore: () => { globalThis.Date = RealDate },
  }
}

const memoryDocument = new MemoryDocument()
const memoryWindow: Record<string, unknown> = {
  document: memoryDocument,
  navigator: { userAgent: 'node', language: 'en', languages: ['en'], onLine: true, maxTouchPoints: 0 },
  location: { href: 'https://admin.example.test/', origin: 'https://admin.example.test', protocol: 'https:', host: 'admin.example.test', hostname: 'admin.example.test', pathname: '/', search: '', hash: '' },
  history: { state: null, pushState() {}, replaceState() {}, back() {} },
  localStorage: memoryStorage(),
  sessionStorage: memoryStorage(),
  innerWidth: 1280,
  innerHeight: 800,
  devicePixelRatio: 1,
  visualViewport: null,
  HTMLElement: MemoryNode,
  HTMLInputElement: MemoryNode,
  HTMLIFrameElement: class {},
  Node: MemoryNode,
  CustomEvent: globalThis.CustomEvent,
  Event: globalThis.Event,
  ResizeObserver: InertObserver,
  IntersectionObserver: InertObserver,
  MutationObserver: InertObserver,
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() { return true },
  matchMedia: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false } }),
  getComputedStyle: () => new MemoryStyle(),
  getSelection: () => null,
  scrollTo() {},
  scrollBy() {},
  focus() {},
  confirm: () => { throw new Error('a mounted surface opened a native confirm()') },
  alert: () => { throw new Error('a mounted surface opened a native alert()') },
  requestAnimationFrame: (callback: (time: number) => void) => globalThis.setTimeout(() => callback(performance.now()), 0),
  cancelAnimationFrame: (handle: unknown) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  setTimeout: (...args: Parameters<typeof setTimeout>) => globalThis.setTimeout(...args),
  clearTimeout: (handle: unknown) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (...args: Parameters<typeof setInterval>) => globalThis.setInterval(...args),
  clearInterval: (handle: unknown) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
}
memoryWindow.window = memoryWindow
memoryWindow.self = memoryWindow
memoryDocument.defaultView = memoryWindow

const BROWSER_GLOBALS = ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement', 'HTMLInputElement', 'Node', 'ResizeObserver', 'IntersectionObserver', 'MutationObserver', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame']

function installGlobals(): () => void {
  const installed: Record<string, unknown> = {
    ...Object.fromEntries(BROWSER_GLOBALS.map((name) => [name, memoryWindow[name]])),
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (input: unknown) => { throw new TypeError(`the mounted surface fetched ${String(input)}; give that transport a double`) },
    setTimeout: trackedSetTimeout,
    clearTimeout: trackedClearTimeout,
    setInterval: trackedSetInterval,
    clearInterval: trackedClearInterval,
  }
  const saved = new Map(Object.keys(installed).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  for (const [name, value] of Object.entries(installed)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  return () => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
}

function sourceKey(file: string): string | null {
  const path = relative(srcRoot, file.split('?')[0])
  if (path.startsWith('..') || path.includes(':')) return null
  return path.replace(/\\/g, '/')
}

function exportedNames(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const names: string[] = []
  const exported = (node: ts.Node): boolean => ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  const isDefault = (node: ts.Node): boolean => ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement)) names.push('default')
    else if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue
      if (!statement.exportClause) throw new Error(`${file} re-exports with export *: a double cannot enumerate it`)
      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) if (!element.isTypeOnly) names.push(element.name.text)
      }
    } else if (exported(statement)) {
      if (isDefault(statement)) names.push('default')
      else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text)
      } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) {
        names.push(statement.name.text)
      }
    }
  }
  return [...new Set(names)]
}

function doubleModuleSource(key: string): string {
  const file = resolve(srcRoot, key)
  const actualUrl = `${file.replace(/\\/g, '/')}?actual`
  const lines = [`import * as actual from ${JSON.stringify(actualUrl)}`, `const dispatch = globalThis[Symbol.for('mountedComponentHarness.dispatch')]`]
  for (const name of exportedNames(file)) {
    const binding = name === 'default' ? '__default' : name
    lines.push(`const ${binding} = typeof actual.${name} === 'function' && !/^class\\b/.test(Function.prototype.toString.call(actual.${name})) ? (...args) => dispatch(${JSON.stringify(key)}, ${JSON.stringify(name)}, actual.${name}, args) : actual.${name}`)
    lines.push(name === 'default' ? 'export default __default' : `export { ${binding} }`)
  }
  return lines.join('\n')
}

function harnessPlugin(observed: ReadonlySet<string>): Plugin {
  return {
    name: 'mounted-component-harness',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      bundlerActivity += 1
      if (source.startsWith('\0')) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (!resolved || resolved.external) return null
      const [file, query] = resolved.id.split('?')
      const key = sourceKey(file)
      // The provider module boots sync, websockets and the session; a mounted surface only needs the context it reads.
      if (key === APP_CONTEXT_PROVIDER) return resolve(srcRoot, APP_CONTEXT_CORE)
      if (key && (TRANSPORT_MODULE.test(key) || observed.has(key)) && query !== 'actual') return `${DOUBLE_PREFIX}${key}`
      return null
    },
    load(id) {
      bundlerActivity += 1
      return id.startsWith(DOUBLE_PREFIX) ? doubleModuleSource(id.slice(DOUBLE_PREFIX.length)) : null
    },
    transform() {
      bundlerActivity += 1
      transformsInFlight += 1
      return null
    },
  }
}

function transformDonePlugin(): Plugin {
  return {
    name: 'mounted-component-harness-transform-done',
    enforce: 'post',
    transform() {
      bundlerActivity += 1
      transformsInFlight -= 1
      return null
    },
  }
}

export function propsOf(node: MemoryNode): Record<string, unknown> {
  const key = Object.keys(node).find((name) => name.startsWith('__reactProps$'))
  return key ? (node as unknown as Record<string, Record<string, unknown>>)[key] : {}
}

export function accessibleText(node: MemoryNode): string {
  return [node.textContent, node.getAttribute('aria-label'), node.getAttribute('title')].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

export interface MountOptions {
  component: string
  props?: Record<string, unknown>
  app: Record<string, unknown>
  doubles: ModuleDoubles
}

export interface SettleOptions {
  until?: () => boolean
  waitingFor?: string
  expireWaitsWhen?: () => boolean
}

export interface MountedSurface {
  body: MemoryNode
  text(): string
  find(predicate: NodePredicate, what: string): MemoryNode
  findAll(predicate: NodePredicate): MemoryNode[]
  button(label: string | RegExp, scope?: MemoryNode): MemoryNode
  field(name: string): MemoryNode
  click(node: MemoryNode, options?: SettleOptions): Promise<void>
  type(node: MemoryNode, value: string): Promise<void>
  call(node: MemoryNode, handler: string, args: unknown[], options?: SettleOptions): Promise<void>
  settle(options?: SettleOptions): Promise<void>
  waitFor(condition: () => boolean, what: string): Promise<void>
  render(props: Record<string, unknown>): Promise<void>
  unmount(): Promise<void>
}

export interface Harness {
  mount(options: MountOptions): Promise<MountedSurface>
  callersOf(module: string, exportName: string): string[]
  close(): Promise<void>
}

export interface HarnessOptions {
  localStorage?: Record<string, string>
  observe?: readonly string[]
}

function callingSourceModule(): string | null {
  for (const frame of (new Error().stack ?? '').split('\n').slice(2)) {
    const normalized = frame.replace(/\\/g, '/')
    const start = normalized.toLowerCase().indexOf(srcFrameMarker)
    if (start < 0 || normalized.includes('?actual') || normalized.includes('/node_modules/')) continue
    const path = normalized.slice(start + srcFrameMarker.length).match(/^[^:?)]+\.tsx?/)
    if (path) return path[0]
  }
  return null
}

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const restoreGlobals = installGlobals()
  const storage = memoryWindow.localStorage as Storage
  for (const [key, value] of Object.entries(options.localStorage ?? {})) storage.setItem(key, value)
  const observed = new Set(options.observe ?? [])
  const callers = new Map<string, Set<string>>()
  let doubles: ModuleDoubles = {}
  let doubleCalls = 0
  ;(globalThis as Record<symbol, unknown>)[DISPATCH] = (key: string, name: string, actual: Listener, args: unknown[]) => {
    doubleCalls += 1
    if (observed.has(key)) {
      const caller = callingSourceModule()
      if (caller) callers.set(`${key}#${name}`, (callers.get(`${key}#${name}`) ?? new Set()).add(caller))
    }
    const double = doubles[key]?.[name]
    return double ? (double as Listener)(...args) : actual(...args)
  }
  let server: ViteDevServer
  try {
    server = await createServer({
      root: frontendRoot,
      configFile: false,
      appType: 'custom',
      logLevel: 'error',
      server: { middlewareMode: true, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
      plugins: [harnessPlugin(observed), react(), transformDonePlugin()],
    })
  } catch (error) {
    restoreGlobals()
    throw error
  }
  const activityMark = (): string => `${domVersion}:${doubleCalls}:${bundlerActivity}:${pendingShortTimers()}`

  const handlerFailures: unknown[] = []

  async function settle(options: SettleOptions = {}, pressMark = timerMark()): Promise<void> {
    const deadline = performance.now() + SETTLE_DEADLINE_MS
    let mark = activityMark()
    let quietSince = performance.now()
    for (;;) {
      await act(async () => { await new Promise((done) => realSetTimeout(done, FLUSH_MS)) })
      if (options.expireWaitsWhen?.()) expireWaitsSince(pressMark)
      const next = activityMark()
      const busy = pendingShortTimers() > 0 || transformsInFlight > 0 || (options.until ? !options.until() : false)
      if (next !== mark || busy) {
        mark = next
        quietSince = performance.now()
      } else if (performance.now() - quietSince >= QUIET_MS) {
        if (handlerFailures.length) throw new Error(`a handler rejected instead of handling its failure: ${String(handlerFailures.splice(0)[0])}`)
        return
      }
      if (performance.now() > deadline) throw new Error(`the mounted surface ${options.waitingFor ? `never showed ${options.waitingFor}` : 'never went quiet'} within ${SETTLE_DEADLINE_MS} ms; it reads: ${memoryDocument.body.textContent.replace(/\s+/g, ' ').slice(0, 400)}`)
    }
  }

  const mountedSurfaces = new Set<() => Promise<void>>()

  async function mount(options: MountOptions): Promise<MountedSurface> {
    doubles = options.doubles
    const core = await server.ssrLoadModule(`/src/${APP_CONTEXT_CORE}`) as { AppContext: React.Context<unknown> }
    const module = await server.ssrLoadModule(`/src/${options.component}`) as { default: React.ComponentType<Record<string, unknown>> }
    const container = memoryDocument.createElement('div')
    memoryDocument.body.appendChild(container)
    const root = createRoot(container as unknown as Element)
    const unmount = async (): Promise<void> => {
      if (!mountedSurfaces.delete(unmount)) return
      await act(async () => root.unmount())
      container.remove()
    }
    mountedSurfaces.add(unmount)
    const render = async (props: Record<string, unknown>): Promise<void> => {
      await act(async () => {
        root.render(React.createElement(core.AppContext.Provider, { value: options.app }, React.createElement(module.default, props)))
      })
      await settle()
    }
    await render(options.props ?? {})
    const findAll = (predicate: NodePredicate): MemoryNode[] => descendantsOf(memoryDocument.body).filter((node) => node.nodeType === 1 && predicate(node))
    const find = (predicate: NodePredicate, what: string): MemoryNode => {
      const [node] = findAll(predicate)
      if (!node) throw new Error(`the mounted surface shows no ${what}; it reads: ${memoryDocument.body.textContent.replace(/\s+/g, ' ').slice(0, 600)}`)
      return node
    }
    const run = async (callbacks: () => unknown[], settleOptions: SettleOptions): Promise<void> => {
      const pressMark = timerMark()
      await act(async () => {
        for (const result of callbacks()) {
          if (result instanceof Promise) result.catch((error: unknown) => { handlerFailures.push(error) })
        }
      })
      await settle(settleOptions, pressMark)
    }
    const invoke = async (node: MemoryNode, handler: string, args: unknown[], settleOptions: SettleOptions = {}): Promise<void> => {
      const callback = propsOf(node)[handler]
      if (typeof callback !== 'function') throw new Error(`${node.tagName} ${accessibleText(node).slice(0, 80)} has no ${handler}`)
      await run(() => [(callback as Listener)(...args)], settleOptions)
    }
    const event = (node: MemoryNode) => ({ target: node, currentTarget: node, preventDefault() {}, stopPropagation() {}, nativeEvent: {} })
    const dispatchClick = (node: MemoryNode): unknown[] => {
      const path: MemoryNode[] = []
      for (let current: MemoryNode | null = node; current && current !== memoryDocument.documentElement; current = current.parentNode) path.push(current)
      let stopped = false
      const click = {
        type: 'click', target: node, currentTarget: node, button: 0, detail: 1, defaultPrevented: false, nativeEvent: {},
        preventDefault() { click.defaultPrevented = true },
        stopPropagation() { stopped = true },
        isPropagationStopped: () => stopped,
      }
      const results: unknown[] = []
      const phases: Array<[MemoryNode[], string]> = [[[...path].reverse(), 'onClickCapture'], [path, 'onClick']]
      for (const [nodes, handler] of phases) {
        for (const current of nodes) {
          if (stopped) return results
          const callback = propsOf(current)[handler]
          if (typeof callback !== 'function') continue
          click.currentTarget = current
          results.push((callback as Listener)(click))
        }
      }
      if (!results.length) throw new Error(`nothing handles a click on ${node.tagName} ${accessibleText(node).slice(0, 80)}`)
      return results
    }
    return {
      body: memoryDocument.body,
      text: () => memoryDocument.body.textContent,
      find,
      findAll,
      button: (label, scope = memoryDocument.body) => {
        const matches = (node: MemoryNode): boolean => node.tagName === 'BUTTON' && (typeof label === 'string' ? accessibleText(node).includes(label) : label.test(accessibleText(node)))
        const [node] = descendantsOf(scope).filter((candidate) => candidate.nodeType === 1 && matches(candidate))
        if (!node) throw new Error(`the mounted surface shows no button labelled ${String(label)}; it reads: ${memoryDocument.body.textContent.replace(/\s+/g, ' ').slice(0, 600)}`)
        return node
      },
      field: (name) => find((node) => node.getAttribute('name') === name || node.getAttribute('id') === name, `field ${name}`),
      click: async (node, settleOptions = {}) => {
        if (propsOf(node).disabled) throw new Error(`${accessibleText(node).slice(0, 80)} is disabled`)
        await run(() => dispatchClick(node), settleOptions)
      },
      type: async (node, value) => {
        ;(node as unknown as { value: string }).value = value
        await invoke(node, 'onChange', [event(node)])
      },
      call: (node, handler, args, settleOptions) => invoke(node, handler, args, settleOptions),
      settle: (settleOptions) => settle(settleOptions),
      waitFor: (condition, what) => settle({ until: condition, waitingFor: what }),
      render,
      unmount,
    }
  }

  return {
    mount,
    callersOf: (module, exportName) => [...(callers.get(`${module}#${exportName}`) ?? [])].sort(),
    close: async () => {
      try {
        for (const unmount of [...mountedSurfaces]) await unmount()
        disposeSourceTimers()
        await server.close()
      } finally {
        restoreGlobals()
        Reflect.deleteProperty(globalThis, DISPATCH)
      }
    },
  }
}
