// A just-enough document and window for src/utils/filePicker.ts: tests fire the events a browser would
// (cancel, change, focus, page shown, a tap) and read back what the picker did to the DOM.
export type Listener = (event?: unknown) => void

export class FakeInput {
  type = ''
  accept = ''
  multiple = false
  files: File[] | null = null
  attributes = new Map<string, string>()
  style: Record<string, string> = {}
  listeners = new Map<string, Set<Listener>>()
  attached = true
  clicked = 0
  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
  addEventListener(type: string, fn: Listener): void { this.listeners.set(type, (this.listeners.get(type) ?? new Set()).add(fn)) }
  removeEventListener(type: string, fn: Listener): void { this.listeners.get(type)?.delete(fn) }
  remove(): void { this.attached = false }
  click(): void { this.clicked += 1 }
  fire(type: 'change' | 'cancel'): void { for (const fn of [...(this.listeners.get(type) ?? [])]) fn({ type }) }
  listenerCount(): number { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0) }
}

export function installFakeFilePickerDom() {
  const inputs: FakeInput[] = []
  const windowEvents = new Map<string, Set<Listener>>()
  const documentEvents = new Map<string, Set<Listener>>()
  const listenersFor = (events: Map<string, Set<Listener>>, type: string): Set<Listener> => {
    const set = events.get(type) ?? new Set<Listener>()
    events.set(type, set)
    return set
  }
  const total = (events: Map<string, Set<Listener>>): number => [...events.values()].reduce((sum, set) => sum + set.size, 0)
  const fireAll = (events: Map<string, Set<Listener>>, type: string, event?: unknown): void => { for (const fn of [...(events.get(type) ?? [])]) fn(event) }
  const doc = {
    visibilityState: 'visible',
    createElement: () => { const input = new FakeInput(); inputs.push(input); return input },
    body: { appendChild: () => undefined },
    addEventListener: (type: string, fn: Listener) => { listenersFor(documentEvents, type).add(fn) },
    removeEventListener: (type: string, fn: Listener) => { listenersFor(documentEvents, type).delete(fn) },
  }
  Object.assign(globalThis, {
    document: doc,
    window: {
      addEventListener: (type: string, fn: Listener) => { listenersFor(windowEvents, type).add(fn) },
      removeEventListener: (type: string, fn: Listener) => { listenersFor(windowEvents, type).delete(fn) },
    },
  })
  return {
    inputs,
    /** The window `focus` listeners alone (what the picker's focus fallback registers). */
    windowListeners: listenersFor(windowEvents, 'focus'),
    /** Every listener the picker still holds on the window and the document: zero once it has let go. */
    heldListeners: (): number => total(windowEvents) + total(documentEvents),
    focusWindow: (): void => fireAll(windowEvents, 'focus'),
    /** The page being shown again, as a browser reports it after a camera app or a bfcache restore. */
    showPage: (): void => { doc.visibilityState = 'visible'; fireAll(documentEvents, 'visibilitychange'); fireAll(windowEvents, 'pageshow') },
    hidePage: (): void => { doc.visibilityState = 'hidden'; fireAll(documentEvents, 'visibilitychange') },
    /** The first touch or click anywhere on the page: proof no picker is covering it any more. */
    tapPage: (): void => { fireAll(windowEvents, 'pointerdown', { type: 'pointerdown' }); fireAll(windowEvents, 'touchstart', { type: 'touchstart' }) },
  }
}

export const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
export const imageFile = (name: string): File => new File(['pixels'], name, { type: 'image/png' })
