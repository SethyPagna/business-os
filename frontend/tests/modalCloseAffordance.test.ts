// One close affordance per modal: the header ✕, and nothing else.
//
// The shared Modal (src/components/shared/Modal.tsx) renders an accessible
// aria-label="Close" ✕ by default, wired to the same guarded close path the
// panel was given. A mandatory workflow may explicitly omit that affordance;
// it must not render an enabled button whose action is a no-op. A modal that
// then draws its own Close button has two of them, and on a read-only
// report -- where there is no save, no submit, nothing else a footer could
// hold -- the second one arrives full-width and styled `btn-primary`, so the
// panel's most prominent control is "dismiss this". SupplierPurchasesModal had
// exactly that; its sibling CustomerPurchasesReportModal never did.
//
// The rule is about the SHAPE, not about the word Close. A Close that sits in
// a real action row -- `flex gap-2` with an Import beside it, as the contact/
// inventory/sales import wizards have -- is the cancel half of that action and
// is left alone. What is rejected is a Close with no action beside it: one
// that fills the row (`w-full`) or claims the panel's primary styling. Both
// mean nothing else shares the row, which means it exists only to repeat the ✕.
//
// Run: node tests/modalCloseAffordance.test.ts
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import ts from 'typescript'

const CLOSE_LABEL = /(?:t|tr)\(\s*'close'|>\s*Close\s*</
const CLOSES_THE_PANEL = /onClick=\{\s*onClose\s*\}/
const STANDS_ALONE = /\bw-full\b|\bbtn-primary\b/

/** The duplicate-✕ buttons in one component's source. */
function lonesomeCloseButtons(source: string): string[] {
  if (!/<Modal[\s>]/.test(source)) return [] // no shared header ✕ to duplicate
  const found: string[] = []
  for (const button of source.matchAll(/<button\b[\s\S]*?<\/button>/g)) {
    const markup = button[0]
    if (!CLOSE_LABEL.test(markup)) continue
    if (!CLOSES_THE_PANEL.test(markup)) continue
    const classes = /className="([^"]*)"/.exec(markup)?.[1] ?? ''
    if (STANDS_ALONE.test(classes)) found.push(classes)
  }
  return found
}

function everyComponentFile(): string[] {
  const root = new URL('../src/components/', import.meta.url)
  const found: string[] = []
  const walk = (dir: URL, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) { walk(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`); continue }
      if (entry.name.endsWith('.tsx')) found.push(`${prefix}${entry.name}`)
    }
  }
  walk(root, '')
  return found.sort()
}

const files = everyComponentFile()
assert.ok(files.length > 200, `the sweep must actually walk the app (found ${files.length})`)

const offenders: string[] = []
for (const file of files) {
  const source = readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8')
  for (const classes of lonesomeCloseButtons(source)) offenders.push(`${file} ("${classes}")`)
}
assert.deepEqual(
  offenders,
  [],
  'a Close button with no action beside it repeats the header ✕ -- the modal already closes from there',
)

// Positive control. Every file above answers "clean", which is also what a
// broken detector answers, so the detector is handed a case it must catch:
// the exact markup removed from SupplierPurchasesModal.
const removed = `
  <Modal title="Purchases" onClose={onClose} wide>
    <div className="space-y-3">
      <button type="button" className="btn-primary w-full" onClick={onClose}>{t('close') || 'Close'}</button>
    </div>
  </Modal>`
assert.deepEqual(
  lonesomeCloseButtons(removed),
  ['btn-primary w-full'],
  'the detector must still catch the shape this test exists to keep out',
)

// Negative control, the other way round: an import wizard's Close is the
// cancel half of a two-button action row, and must NOT be flagged.
const wizard = `
  <Modal title="Import" onClose={onClose}>
    <div className="flex gap-2">
      <button type="button" className="btn-secondary flex-1" onClick={onClose}>{t('close') || 'Close'}</button>
      <button type="button" className="btn-primary flex-1" onClick={handleImport}>Import</button>
    </div>
  </Modal>`
assert.deepEqual(lonesomeCloseButtons(wizard), [], 'a Close paired with a real action is a cancel, not a duplicate ✕')

// The sibling the defect was measured against: the two per-contact purchase
// reports are the same surface for suppliers and for customers, and must offer
// the same single way out.
for (const sibling of ['contacts/SupplierPurchasesModal.tsx', 'contacts/CustomerPurchasesReportModal.tsx']) {
  const source = readFileSync(new URL(`../src/components/${sibling}`, import.meta.url), 'utf8')
  assert.match(source, /<Modal[\s\S]*?onClose=\{onClose\}/, `${sibling} must close through the shared Modal header`)
  assert.deepEqual(lonesomeCloseButtons(source), [], `${sibling} must offer one way out, not two`)
}

// Execute the actual shared Modal so this test proves its accessible tree,
// rather than only matching the spelling of the new prop. Ordinary callers
// keep one named Close control; mandatory callers omit it entirely; and a
// temporary busy guard retains the same visible-but-disabled control.
type RenderNode = { type: unknown; props: Record<string, any> }
const modalSource = readFileSync(new URL('../src/components/shared/Modal.tsx', import.meta.url), 'utf8')
const jsx = (type: unknown, props: Record<string, any>) => ({ type, props: props || {} })
const hooks = {
  useRef: (initial: unknown) => ({ current: initial }),
  useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => {}],
}
let guardedCloseRequests = 0
const requestClose = () => { guardedCloseRequests += 1 }
const compiled = ts.transpileModule(modalSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const modalModule: any = { exports: {} }
new Function('require', 'module', 'exports', compiled)((name: string) => {
  if (name === 'react') return hooks
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' }
  if (name === 'react-dom') return { createPortal: (node: unknown) => node }
  if (name.includes('lucide-react')) return { default: () => null }
  if (name.includes('AppContextCore')) return { useApp: () => ({ t: (key: string) => key }) }
  if (name.includes('useCloseGuard')) return { useCloseGuard: () => ({ requestClose }) }
  if (name.includes('modalCloseContext')) return { ModalCloseContext: { Provider: 'close-context-provider' } }
  if (name.includes('UnsavedChangesPrompt')) return { default: () => null }
  return {}
}, modalModule, modalModule.exports)

function nodes(tree: any): RenderNode[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...nodes(tree.props?.children)]
}

const SharedModal = modalModule.exports.default
const renderModal = (props: Record<string, unknown>) => SharedModal({
  title: 'Test modal',
  onClose: () => {},
  children: 'Body',
  unsavedChanges: 'read-only',
  ...props,
})

const ordinaryClose = nodes(renderModal({})).find((node) => node.type === 'button' && node.props['aria-label'] === 'Close')
assert.ok(ordinaryClose, 'an ordinary modal exposes its named Close control by default')
assert.equal(ordinaryClose.props.disabled, false, 'ordinary Close remains enabled')
ordinaryClose.props.onClick()
assert.equal(guardedCloseRequests, 1, 'ordinary Close retains the shared guarded close path')

const busyClose = nodes(renderModal({ closeDisabled: true })).find((node) => node.type === 'button' && node.props['aria-label'] === 'Close')
assert.ok(busyClose, 'busy state keeps the familiar Close control visible')
assert.equal(busyClose.props.disabled, true, 'busy state still disables Close')
busyClose.props.onClick()
assert.equal(guardedCloseRequests, 1, 'disabled/busy Close remains inert without bypassing the guard')

const minimize = jsx('button', { type: 'button', 'aria-label': 'Minimize' })
const mandatoryButtons = nodes(renderModal({ closeAffordance: 'omitted', headerExtra: minimize }))
  .filter((node) => node.type === 'button')
assert.deepEqual(
  mandatoryButtons.map((node) => node.props['aria-label']),
  ['Minimize'],
  'omitting Close removes it from the accessible tree without removing independent header controls',
)

console.log(`PASS ${files.length} components: no modal repeats its header ✕ with a lone Close button`)
