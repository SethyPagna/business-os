// A just-enough document and window for src/utils/filePicker.ts: tests create inputs through it, fire the
// events a browser would (cancel, change, window focus), and read back what the picker did to the DOM.
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
  const windowListeners = new Set<Listener>()
  Object.assign(globalThis, {
    document: { createElement: () => { const input = new FakeInput(); inputs.push(input); return input }, body: { appendChild: () => undefined } },
    window: {
      addEventListener: (type: string, fn: Listener) => { if (type === 'focus') windowListeners.add(fn) },
      removeEventListener: (type: string, fn: Listener) => { if (type === 'focus') windowListeners.delete(fn) },
    },
  })
  return {
    inputs,
    windowListeners,
    focusWindow: (): void => { for (const fn of [...windowListeners]) fn() },
  }
}

export const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
export const imageFile = (name: string): File => new File(['pixels'], name, { type: 'image/png' })
