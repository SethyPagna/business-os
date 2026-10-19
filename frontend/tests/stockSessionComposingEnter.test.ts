import assert from 'node:assert/strict'
import { createHarness, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'

// A phone keyboard (Khmer, Chinese, Japanese...) confirms a composition candidate with Enter. That Enter is
// the IME's, not the cashier's: it must never Add a stock line. The reason box and the numeric fields both
// turned an Enter into Add without asking whether a composition was in progress.

const harness = await createHarness()
let adds = 0
let picked: string | null = null
const reasons: string[] = []

type Key = { key: string; nativeEvent?: { isComposing?: boolean; keyCode?: number } }
type Probe = Key & { target: unknown; defaultPrevented: boolean; preventDefault(): void; stopPropagation(): void }
const keyEvent = (target: MemoryNode, spec: Key): Probe => ({
  ...spec, target, defaultPrevented: false,
  preventDefault(this: Probe) { this.defaultPrevented = true },
  stopPropagation() {},
})

async function mountEntry(): Promise<MountedSurface> {
  adds = 0
  picked = null
  reasons.length = 0
  return harness.mount({
    component: 'components/stock-session/StockSessionLineEntry.tsx',
    props: {
      tr: (key: string, fallback?: string) => fallback ?? key, packLookup: () => undefined, mode: 'add', busy: false,
      searchInputRef: { current: null }, query: '', onQuery() {}, groups: [], onOpenGroup() {}, createText: null, onCreate() {}, onScan() {},
      picked: { id: 1, name: 'Synthetic serum' }, pickedStock: 3, pickedIsNew: false, onClearPick() {},
      quantity: '2', onQuantity() {}, unitCost: '1', onUnitCost() {}, canViewCosts: true, canEditCosts: true, canReceive: true,
      sellingPrice: '3', onSellingPrice() {}, canEditPrice: true, expiryDate: '', onExpiryDate() {}, lotOptions: [], lotValue: '', onLot() {},
      conditionTag: '', onConditionTag() {}, tagDisabled: false,
      reason: '', onReason: (next: string) => { reasons.push(next); picked = next },
      savedReasons: [{ id: 'r1', label: 'Counted again' }], onAdd: () => { adds += 1 }, editing: false, refusal: null, invalidField: null,
    },
    app: { t: (key: string) => key, notify() {}, user: { id: 1, username: 'fixture', role_code: 'admin' }, can: () => true },
    doubles: {},
  })
}
const input = (surface: MountedSurface, label: string): MemoryNode => surface.find((node) => node.tagName === 'INPUT' && node.getAttribute('aria-label') === label, `the ${label} field`)

// The wrapper's onKeyDown lives on an ancestor div; React bubbles to it, so run each ancestor handler in order.
async function press(surface: MountedSurface, target: MemoryNode, spec: Key): Promise<Probe> {
  const event = keyEvent(target, spec)
  for (let node: MemoryNode | null = target; node; node = node.parentNode) {
    const handler = Object.entries(node).find(([name]) => name.startsWith('__reactProps$'))?.[1] as { onKeyDown?: (event: unknown) => void } | undefined
    if (handler?.onKeyDown) await surface.call(node, 'onKeyDown', [event])
  }
  return event
}

try {
  for (const [name, label] of [['reason box', 'Reason'], ['quantity field', 'Qty'], ['cost field', 'Cost']] as const) {
    const surface = await mountEntry()
    const box = input(surface, label)

    for (const composing of [
      { isComposing: true, keyCode: 13 },
      { isComposing: false, keyCode: 229 },
    ]) {
      const event = await press(surface, box, { key: 'Enter', nativeEvent: composing })
      assert.equal(adds, 0, `${name}: Enter while composing (${JSON.stringify(composing)}) must not Add`)
      assert.equal(event.defaultPrevented, false, `${name}: the IME's Enter is left alone, never preventDefault-ed`)
    }

    const ordinary = await press(surface, box, { key: 'Enter', nativeEvent: { isComposing: false, keyCode: 13 } })
    assert.equal(adds, 1, `${name}: an ordinary Enter after composition ends adds exactly once`)
    assert.equal(ordinary.defaultPrevented, true, `${name}: and still stops the native Enter`)

    await press(surface, box, { key: 'a' })
    assert.equal(adds, 1, `${name}: other keys never Add`)
    await surface.unmount()
  }
  console.log('PASS composing Enter never Adds from the reason box or the numeric fields; ordinary Enter adds once')

  {
    const surface = await mountEntry()
    const box = input(surface, 'Reason')
    await surface.call(box, 'onFocus', [{}])
    await press(surface, box, { key: 'ArrowDown' })
    const choose = await press(surface, box, { key: 'Enter', nativeEvent: { isComposing: false, keyCode: 13 } })
    assert.equal(choose.defaultPrevented, true, 'Enter on a highlighted suggestion is taken by the suggestion list')
    assert.deepEqual(reasons, ['Counted again'], 'the highlighted suggestion is chosen once')
    assert.equal(adds, 0, 'choosing a suggestion does not also Add')
    await surface.unmount()
  }
  console.log('PASS Enter that picks a highlighted suggestion selects once and does not Add')
} finally {
  await harness.close()
}
