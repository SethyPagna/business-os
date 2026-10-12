import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import ts from 'typescript'
import { hasFinePointer } from '../src/utils/pointerFocus.ts'
import { createHarness, propsOf, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'

// Daily-use A item 2. A phone or tablet raises the on-screen keyboard whenever
// script focuses a text field. The Stock Session float gated its OPENING focus
// on (pointer: fine) but refocused the product search UNCONDITIONALLY after
// every Add and after closing the option sheet, so on a touch device the
// keyboard rose again after each line. This runs the real float under a touch
// pointer and a mouse pointer and asserts where focus ends up. It also pins
// what the float already did for the keyboard (visual-viewport inset, numeric
// keypad on quantity fields) so a refactor cannot lose it quietly; those two
// pass on the base by design, and were proven discriminating by mutation.

const read = (relative: string): string => readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8')

const harness = await createHarness({ observe: ['api/methods.ts', 'api/productSearchIndex.ts'] })
const memoryWindow = window as unknown as { matchMedia?: unknown; visualViewport: unknown; innerHeight: number }
const realMatchMedia = memoryWindow.matchMedia

{
  const holder = globalThis as unknown as { window?: unknown }
  const saved = holder.window
  holder.window = undefined
  assert.equal(hasFinePointer(), false, 'no window: not a fine pointer')
  holder.window = { matchMedia: (query: string) => ({ matches: query === '(pointer: fine)' }) }
  assert.equal(hasFinePointer(), true, 'mouse or trackpad primary pointer')
  holder.window = { matchMedia: () => ({ matches: false }) }
  assert.equal(hasFinePointer(), false, 'touch primary pointer')
  holder.window = {}
  assert.equal(hasFinePointer(), false, 'a browser without matchMedia is treated as touch, never throws')
  holder.window = saved
  console.log('PASS hasFinePointer reads (pointer: fine) and fails closed')
}

const product = { id: 41, name: 'Synthetic serum', barcode: 'TEST-41', brand: 'Probe', selling_price_usd: 5, stock_quantity: 9, branch_stock: [{ branch_id: 1, branch_name: 'Synthetic branch', quantity: 9 }] }
const doubles = {
  'api/batchesTransport.ts': { getProductBatches: async () => ({ batches: [] }) },
  'api/methods.ts': { getProductFilters: async () => ({ brands: [] }), searchProducts: async () => ({ items: [product], total: 1 }) },
  'api/productSearchIndex.ts': { useProductSearchIndex: () => 0 },
  'api/inventoryWriteTransport.ts': { getInventoryReasons: async () => ({}) },
}
const pointer = (kind: 'fine' | 'coarse'): void => {
  memoryWindow.matchMedia = (query: string) => ({ matches: kind === 'fine' && query === '(pointer: fine)', media: query, addEventListener() {}, removeEventListener() {} })
}
async function mountFloat(kind: 'fine' | 'coarse', props: Record<string, unknown> = {}): Promise<MountedSurface> {
  localStorage.clear()
  pointer(kind)
  const app = { t: (key: string) => key, page: 'inventory', user: { id: 1, username: 'fixture-admin', role_code: 'admin', role_permissions: { all: true } }, can: () => true, notify() {}, exchangeRate: 4100, usdSymbol: '$', khrSymbol: '៛' }
  return harness.mount({
    component: 'components/inventory/FastStockInModal.tsx',
    props: { branchOptions: [{ value: '1', label: 'Synthetic branch' }], defaultBranchId: 1, tr: (key: string, fallback?: string) => fallback ?? key, notify() {}, onClose() {}, onDone() {}, initialMode: 'set', ...props },
    app, doubles,
  })
}
const field = (surface: MountedSurface, label: string): MemoryNode => surface.find((node) => node.tagName === 'INPUT' && node.getAttribute('aria-label') === label, `the ${label} field`)
const searchBox = (surface: MountedSurface): MemoryNode => field(surface, 'Product or barcode')
const focusedIn = (surface: MountedSurface): boolean => document.activeElement === (searchBox(surface) as unknown)

try {
  for (const kind of ['fine', 'coarse'] as const) {
    const wantFocus = kind === 'fine'

    const opening = await mountFloat(kind)
    assert.equal(focusedIn(opening), wantFocus, `${kind}: the search box ${wantFocus ? 'takes' : 'does not take'} focus when the float opens`)
    await opening.unmount()

    const afterAdd = await mountFloat(kind, { initialProduct: product })
    await afterAdd.type(field(afterAdd, 'Set to'), '5')
    await afterAdd.click(afterAdd.find((node) => node.tagName === 'BUTTON' && node.textContent === 'Add' && node.className.includes('btn-primary'), 'the Add button'))
    assert.ok(afterAdd.text().includes('Items 1'), `${kind}: the line was added`)
    assert.equal(focusedIn(afterAdd), wantFocus, `${kind}: after Add the search box ${wantFocus ? 'is refocused for the next product' : 'is NOT refocused, so the keyboard stays down'}`)
    await afterAdd.unmount()

    const afterSheet = await mountFloat(kind)
    await afterSheet.type(searchBox(afterSheet), 'Synthetic')
    await afterSheet.click(afterSheet.find((node) => node.getAttribute('role') === 'option', 'a search result'))
    ;(document as unknown as { activeElement: unknown }).activeElement = document.body
    await afterSheet.click(afterSheet.find((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'close', 'the option sheet close button'))
    assert.equal(focusedIn(afterSheet), wantFocus, `${kind}: after the option sheet closes the search box ${wantFocus ? 'is refocused' : 'is NOT refocused'}`)
    await afterSheet.unmount()
  }
  console.log('PASS the Stock Session float refocuses the search box only on a fine pointer: opening, after Add, after the option sheet')

  const numberFields: Record<string, Array<[string, string]>> = {
    add: [['Qty', 'numeric'], ['Cost', 'decimal'], ['Price', 'decimal']],
    remove: [['Qty', 'numeric']],
    set: [['Set to', 'numeric']],
  }
  for (const [mode, expected] of Object.entries(numberFields)) {
    const surface = await mountFloat('coarse', { initialMode: mode })
    for (const [label, inputMode] of expected) {
      const input = field(surface, label)
      assert.equal(propsOf(input).inputMode, inputMode, `${mode}: the ${label} field asks for the ${inputMode} keypad`)
      assert.equal(propsOf(input).type, 'number')
    }
    await surface.unmount()
  }
  console.log('PASS the Add, Remove and Set quantity, cost and price fields keep their numeric or decimal keypad')

  memoryWindow.innerHeight = 800
  memoryWindow.visualViewport = { height: 480, offsetTop: 0, addEventListener() {}, removeEventListener() {} }
  const keyboardUp = await mountFloat('coarse')
  const rootStyle = document.documentElement.style as unknown as { getPropertyValue(name: string): string }
  assert.equal(rootStyle.getPropertyValue('--kb-inset'), '320px', 'the float publishes the keyboard height so its footer stays above it')
  await keyboardUp.unmount()
  assert.equal(rootStyle.getPropertyValue('--kb-inset'), '', 'closing the float releases the inset')
  memoryWindow.visualViewport = null
  console.log('PASS the Stock Session float publishes and releases --kb-inset through useVisualViewportInset')
} finally {
  memoryWindow.matchMedia = realMatchMedia
  await harness.close()
}

const modalSource = read('components/inventory/FastStockInModal.tsx')
{
  const file = ts.createSourceFile('FastStockInModal.tsx', modalSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let focusCalls = 0
  let ungatedFocusTimers = 0
  let gatedFocusTimers = 0
  let calledInComponent = false
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useVisualViewportInset') calledInComponent = true
    if (ts.isCallExpression(node) && ts.isPropertyAccessChain(node.expression) && node.expression.name.text === 'focus' && node.expression.expression.getText(file) === 'searchInputRef.current') focusCalls += 1
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'window.setTimeout' && node.arguments[0]) {
      const callback = node.arguments[0].getText(file)
      if (callback === 'focusSearch') gatedFocusTimers += 1
      else if (/\.focus\(/.test(callback)) ungatedFocusTimers += 1
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(calledInComponent, 'FastStockInModal calls useVisualViewportInset (it renders its own portal, not the shared Modal)')
  assert.equal(ungatedFocusTimers, 0, 'no timer focuses the search box without the pointer gate')
  assert.equal(gatedFocusTimers, 3, 'opening, after Add and after the option sheet all go through focusSearch')
  assert.equal(focusCalls, 1, 'the search box is focused in exactly one place')
  assert.match(modalSource, /const focusSearch = \(\) => \{ if \(hasFinePointer\(\)\) searchInputRef\.current\?\.focus\(\) \}/)
}

{
  const dir = new URL('../src/components/stock-session/', import.meta.url)
  const checked: string[] = []
  for (const name of readdirSync(dir).filter((entry) => entry.endsWith('.tsx'))) {
    const text = readFileSync(new URL(name, dir), 'utf8')
    const file = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = (node: ts.Node): void => {
      if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(file) === 'input') {
        const attributes = new Map(node.attributes.properties.filter(ts.isJsxAttribute).map((attribute) => [attribute.name.getText(file), attribute.initializer]))
        const literal = (name: string): string | null => {
          const initializer = attributes.get(name)
          return initializer && ts.isStringLiteral(initializer) ? initializer.text : null
        }
        if (literal('type') === 'number') {
          const mode = attributes.get('inputMode')
          assert.ok(mode, `${name}: a number input without inputMode shows a full keyboard on a phone`)
          if (ts.isStringLiteral(mode)) assert.equal(mode.text, literal('step') === '1' ? 'numeric' : 'decimal', `${name}: inputMode must match step`)
          else assert.ok(/'numeric'/.test(mode.getText(file)) && /'decimal'/.test(mode.getText(file)), `${name}: a computed inputMode must choose between numeric and decimal`)
          checked.push(name)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
  }
  assert.deepEqual([...new Set(checked)].sort(), ['StockSessionItems.tsx', 'StockSessionPaymentStep.tsx', 'StockSessionSharedDetails.tsx'], 'the scan found the free-quantity, cost and shared number inputs')
}
console.log('PASS FastStockInModal gates every focus on the pointer and keeps useVisualViewportInset; every stock-session number input declares its keypad')
