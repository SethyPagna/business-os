// Google Translate vs React (refuter follow-up to P-public-1): once a visitor
// opts into a Google-translated language, removeChild/insertBefore on a node
// Google has moved must not throw (React's NotFoundError crash). The guard is
// installed only by the translate widget setup, never on the Khmer default.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// A DOM-less fake Node whose native methods throw exactly like the browser's.
class FakeNode {
  parentNode: FakeNode | null = null
  children: FakeNode[] = []
  removeChild(child: FakeNode) {
    const at = this.children.indexOf(child)
    if (at < 0) throw new Error("Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.")
    this.children.splice(at, 1)
    child.parentNode = null
    return child
  }
  insertBefore(node: FakeNode, ref: FakeNode | null) {
    if (ref === null) return this.appendChild(node)
    const at = this.children.indexOf(ref)
    if (at < 0) throw new Error("Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node.")
    this.children.splice(at, 0, node)
    node.parentNode = this
    return node
  }
  appendChild(node: FakeNode) {
    this.children.push(node)
    node.parentNode = this
    return node
  }
}
;(globalThis as { Node?: unknown }).Node = FakeNode
const nativeRemove = FakeNode.prototype.removeChild

const guard = await import('../src/components/catalog/portalTranslateDomGuard.ts')
const controller = await import('../src/components/catalog/portalTranslateController.ts')
const languages = await import('../src/components/catalog/portalLanguageOptions.ts')

// 1. Positive control: unguarded, the fake throws the way React sees it.
{
  const parent = new FakeNode()
  assert.throws(() => parent.removeChild(new FakeNode()), /not a child of this node/)
}

// 2. Khmer default: loading the modules and resolving the default language
//    installs nothing, and the Khmer route has no Google target (so the
//    PublicCatalogPage effect that calls the widget setup never runs).
assert.equal(guard.isPortalTranslateDomGuardInstalled(), false, 'importing the translate modules must not patch Node')
const khmerRoute = languages.resolvePublicStorefrontLanguage(languages.PUBLIC_STOREFRONT_DEFAULT_LANGUAGE, 'km')
assert.equal(languages.PUBLIC_STOREFRONT_DEFAULT_LANGUAGE, 'km')
assert.ok(!khmerRoute.googleTarget, 'the Khmer default must not route to Google Translate')
assert.ok(!languages.resolvePublicStorefrontLanguage('', 'km').googleTarget, 'no choice = Khmer, no Google')
assert.equal(languages.resolvePublicStorefrontLanguage('fr', 'km').googleTarget, 'fr', 'control: a real opt-in does route to Google')
assert.equal(FakeNode.prototype.removeChild, nativeRemove, 'Khmer load keeps the native removeChild')
const page = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'components', 'catalog', 'PublicCatalogPage.tsx'), 'utf8')
assert.match(page, /if \(!translateWidgetEnabled \|\| !externalTranslateTarget [\s\S]{0,200}return undefined\s*\}\s*let cancelled = false\s*const cleanupWidget = setupPortalExternalTranslateWidget\(/, 'the widget (and so the guard) is set up only for an external translate target')
assert.doesNotMatch(page, /installPortalTranslateDomGuard/, 'the page must not install the guard on its own')

// 3. Opting into translate: the widget setup installs the guard.
const combo = {}
const host = { id: '', className: '', style: {}, parentNode: null as unknown, innerHTML: '', setAttribute() {}, querySelector: () => combo }
const fakeDocument = {
  querySelectorAll: () => [],
  createElement: () => host,
  body: { appendChild: (node: typeof host) => { node.parentNode = fakeDocument.body; return node } },
}
const TranslateElement = Object.assign(() => ({}), { InlineLayout: { SIMPLE: 0 } })
;(globalThis as Record<string, unknown>).document = fakeDocument
;(globalThis as Record<string, unknown>).window = { google: { translate: { TranslateElement } }, setTimeout }
let ready = false
controller.setupPortalExternalTranslateWidget({ sourceLanguage: 'km', includedLanguages: ['fr'], onReady: () => { ready = true } })
assert.ok(ready, 'fixture sanity: the widget reached ready')
assert.equal(guard.isPortalTranslateDomGuardInstalled(), true, 'opting into translate installs the guard')

// 4. Guarded behaviour.
{
  const parent = new FakeNode()
  const stray = new FakeNode()
  const other = new FakeNode()
  other.appendChild(stray)
  assert.equal(parent.removeChild(stray), stray, 'removing a node Google moved returns it instead of throwing')
  assert.equal(stray.parentNode, other, 'and leaves it where it is')

  const own = parent.appendChild(new FakeNode())
  assert.equal(parent.removeChild(own), own)
  assert.equal(parent.children.length, 0, 'a real child is still removed')

  const node = new FakeNode()
  const foreignRef = other.appendChild(new FakeNode())
  assert.equal(parent.insertBefore(node, foreignRef), node, 'a foreign reference appends instead of throwing')
  assert.equal(node.parentNode, parent)
  assert.equal(parent.children.at(-1), node)

  const first = new FakeNode()
  parent.insertBefore(first, node)
  assert.equal(parent.children[0], first, 'a genuine reference still inserts before it')
}

// 5. Idempotent: a second setup does not wrap the wrapper.
const patched = FakeNode.prototype.removeChild
assert.equal(guard.installPortalTranslateDomGuard(), true)
controller.setupPortalExternalTranslateWidget({ sourceLanguage: 'km', includedLanguages: ['fr'] })
assert.equal(FakeNode.prototype.removeChild, patched, 'installing twice must not double-wrap')

// 6. The reload recovery stays as the last resort.
const recovery = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app', 'publicErrorRecovery.ts'), 'utf8')
assert.match(recovery, /removeChild\|insertBefore/)

console.log('PASS translate DOM guard: absent on Khmer load, installed on opt-in, idempotent, non-throwing')
