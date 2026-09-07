// Minimal DOM stub for the ONE delegated text-affordance controller
// (src/components/shared/textAffordances.ts).
//
// Not a test file (no `.test.ts` suffix, so tests/runTestChain.ts does not
// execute it): it is the harness shared by copyFloat.test.ts and
// truncatedText.test.ts, both of which have to drive the controller for
// real. A regex over the source cannot see the bugs these two files pin --
// "the parked `title` makes the cell stop matching its own selector" and
// "the copy field swallows the row's click" are both properties of the live
// event path, and both looked fine in the source.
//
// It implements exactly what the controller touches: createElement,
// document-level capture listeners, body.appendChild, closest/matches over
// the four selector shapes this module uses ([attr], [attr="value"],
// tag, .class), contains(), getBoundingClientRect(), and the scroll/client
// widths `isClipped` reads.

export interface StubEventInit {
  target?: StubElement | null
  relatedTarget?: StubElement | null
  key?: string
  clientX?: number
  clientY?: number
  touches?: Array<{ clientX: number; clientY: number }>
}

export interface StubEvent {
  type: string
  target: StubElement | null
  relatedTarget: StubElement | null
  key: string
  // utils/longPress.ts reads these off the press it is handed, so the
  // harness has to carry them or the press half cannot be driven at all.
  clientX: number
  clientY: number
  // longPress.ts reads the first entry of this on every touch event it is
  // handed; without it the whole touch half of the gesture throws before it
  // can be asserted on at all.
  touches: Array<{ clientX: number; clientY: number }>
  stopped: boolean
  defaulted: boolean
  stopPropagation: () => void
  preventDefault: () => void
}

// One compound selector part: an optional tag, then any number of `.class`
// and `[attr]` / `[attr="value"]` tokens.
function matchesOne(el: StubElement, selector: string): boolean {
  let rest = selector
  const tag = /^[A-Za-z][\w-]*/.exec(rest)
  if (tag) {
    if (el.tagName !== tag[0].toUpperCase()) return false
    rest = rest.slice(tag[0].length)
  }
  const classes = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean)
  const token = /\.([-\w]+)|\[([-\w]+)(?:="([^"]*)")?\]/g
  let match: RegExpExecArray | null
  while ((match = token.exec(rest)) !== null) {
    if (match[1] != null) {
      if (!classes.includes(match[1])) return false
      continue
    }
    const value = el.getAttribute(match[2] as string)
    if (value == null) return false
    if (match[3] != null && value !== match[3]) return false
  }
  return true
}

export class StubNode {}

export class StubElement extends StubNode {
  tagName: string
  hidden = false
  textContent = ''
  scrollWidth = 0
  clientWidth = 0
  type = ''
  parentElement: StubElement | null = null
  childNodes: StubElement[] = []
  style: Record<string, string> = {}
  dataset: Record<string, string> = {}
  rect = { left: 0, top: 0, bottom: 0 }
  private attrs = new Map<string, string>()

  constructor(tag: string) {
    super()
    this.tagName = tag.toUpperCase()
  }

  get className(): string { return this.attrs.get('class') || '' }
  set className(value: string) { this.attrs.set('class', String(value)) }

  setAttribute(name: string, value: string): void { this.attrs.set(name, String(value)) }
  getAttribute(name: string): string | null { return this.attrs.has(name) ? (this.attrs.get(name) as string) : null }
  removeAttribute(name: string): void { this.attrs.delete(name) }
  hasAttribute(name: string): boolean { return this.attrs.has(name) }

  append(...kids: StubElement[]): void {
    for (const kid of kids) {
      kid.parentElement = this
      this.childNodes.push(kid)
    }
  }

  appendChild(kid: StubElement): StubElement {
    this.append(kid)
    return kid
  }

  addEventListener(): void { /* the controller only listens on document/window */ }

  contains(node: unknown): boolean {
    if (node === this) return true
    return this.childNodes.some((child) => child.contains(node))
  }

  getBoundingClientRect(): { left: number; top: number; bottom: number; right: number; width: number; height: number } {
    return { ...this.rect, right: 0, width: 0, height: 0 }
  }

  matches(selector: string): boolean {
    return selector.split(',').some((part) => {
      const trimmed = part.trim()
      return trimmed ? matchesOne(this, trimmed) : false
    })
  }

  closest(selector: string): StubElement | null {
    let node: StubElement | null = this
    while (node) {
      if (node.matches(selector)) return node
      node = node.parentElement
    }
    return null
  }
}

export interface AffordanceDomHarness {
  body: StubElement
  /** The controller's own body-level panel, once ensureTextAffordances() has run. */
  host: () => StubElement | null
  /** Build an element: `el('span', { class: 'dense-cell-truncate', title: 'x' }, { scrollWidth: 200, clientWidth: 80 })`. */
  el: (tag: string, attributes?: Record<string, string>, size?: { scrollWidth?: number; clientWidth?: number }) => StubElement
  /** Dispatch one event to every capture listener the controller registered. */
  fire: (type: string, init?: StubEventInit) => StubEvent
  restore: () => void
}

export function installAffordanceDom(): AffordanceDomHarness {
  const previous = {
    document: (globalThis as Record<string, unknown>).document,
    window: (globalThis as Record<string, unknown>).window,
    Node: (globalThis as Record<string, unknown>).Node,
  }
  const listeners = new Map<string, Array<(event: StubEvent) => void>>()
  const body = new StubElement('body')
  const documentStub = {
    body,
    createElement: (tag: string) => new StubElement(tag),
    addEventListener: (type: string, handler: (event: StubEvent) => void) => {
      const bucket = listeners.get(type) || []
      bucket.push(handler)
      listeners.set(type, bucket)
    },
    removeEventListener: () => { /* nothing under test removes one */ },
  }
  const windowStub = {
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener: () => { /* resize/scroll reposition only */ },
    removeEventListener: () => { /* noop */ },
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>),
  }
  const globals = globalThis as Record<string, unknown>
  globals.document = documentStub
  globals.window = windowStub
  globals.Node = StubNode

  return {
    body,
    host: () => body.childNodes[0] || null,
    el: (tag, attributes = {}, size = {}) => {
      const node = new StubElement(tag)
      for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value)
      if (size.scrollWidth != null) node.scrollWidth = size.scrollWidth
      if (size.clientWidth != null) node.clientWidth = size.clientWidth
      return node
    },
    fire: (type, init = {}) => {
      const event: StubEvent = {
        type,
        target: init.target || null,
        relatedTarget: init.relatedTarget || null,
        key: init.key || '',
        clientX: init.clientX ?? 0,
        clientY: init.clientY ?? 0,
        touches: init.touches || [{ clientX: init.clientX ?? 0, clientY: init.clientY ?? 0 }],
        stopped: false,
        defaulted: false,
        stopPropagation() { event.stopped = true },
        preventDefault() { event.defaulted = true },
      }
      for (const handler of listeners.get(type) || []) handler(event)
      return event
    },
    restore: () => {
      globals.document = previous.document
      globals.window = previous.window
      globals.Node = previous.Node
    },
  }
}

/** `<tr data-clickable="true"><td><span …></span></td></tr>` — the shape every dense surface renders. */
export function buildClickableRow(harness: AffordanceDomHarness, cell: StubElement): StubElement {
  const row = harness.el('tr', { 'data-clickable': 'true' })
  const td = harness.el('td')
  td.append(cell)
  row.append(td)
  harness.body.append(row)
  return row
}

/** The same cell with nothing underneath that wants a click. */
export function buildPlainBlock(harness: AffordanceDomHarness, cell: StubElement): StubElement {
  const block = harness.el('div')
  block.append(cell)
  harness.body.append(block)
  return block
}

export const wait = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })
