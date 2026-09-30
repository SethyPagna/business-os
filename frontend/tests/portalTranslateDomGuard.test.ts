// Page translation vs React (refuter follow-up to P-public-1): a node that a
// translator (Chrome's own, an extension) has moved must not make React's
// removeChild/insertBefore throw. The guard is installed on every
// storefront load and never by the admin app.
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
const languages = await import('../src/components/catalog/portalLanguageOptions.ts')

// 1. Positive control: unguarded, the fake throws the way React sees it.
{
  const parent = new FakeNode()
  assert.throws(() => parent.removeChild(new FakeNode()), /not a child of this node/)
}

// 2. Admin: the admin app never installs it. Importing the guard and the
//    storefront language module leaves the native methods alone.
assert.equal(guard.isPortalTranslateDomGuardInstalled(), false, 'importing the modules must not patch Node')
assert.equal(FakeNode.prototype.removeChild, nativeRemove)
const read = (relative: string) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', relative), 'utf8').replace(/\r\n/g, '\n')
for (const adminFile of ['src/AdminRoot.tsx', 'src/App.tsx', 'src/index.tsx', 'src/components/catalog/CatalogPage.tsx', 'src/components/catalog/CatalogPreviewSurface.tsx']) {
  assert.doesNotMatch(read(adminFile), /installPortalTranslateDomGuard/, `${adminFile} must not install the guard (admin path)`)
}
assert.match(read('src/index.tsx'), /const RootComponent = publicCatalogMode \? PublicCatalogRoot : AdminRoot/, 'PublicCatalogRoot is the storefront-only entry')

// 3. Storefront: installed at PublicCatalogRoot module scope, i.e. on every
//    storefront page load before the first render -- Khmer default included,
//    no language menu needed (Chrome's own translator causes the same crash).
const root = read('src/PublicCatalogRoot.tsx')
assert.match(root, /import \{ installPortalTranslateDomGuard \} from '\.\/components\/catalog\/portalTranslateDomGuard\.ts'/)
assert.match(root, /^installPortalTranslateDomGuard\(\)$/m, 'called once at module scope, not inside a component or effect')
assert.equal(languages.PUBLIC_STOREFRONT_DEFAULT_LANGUAGE, 'km')
assert.equal(guard.installPortalTranslateDomGuard(), true, 'the storefront entry call installs it')
assert.equal(guard.isPortalTranslateDomGuardInstalled(), true)

// 4. Guarded behaviour.
{
  const parent = new FakeNode()
  const stray = new FakeNode()
  const other = new FakeNode()
  other.appendChild(stray)
  assert.equal(parent.removeChild(stray), stray, 'removing a node a translator moved returns it instead of throwing')
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

// 5. Installed only once: a second call does not wrap the wrapper.
const patched = FakeNode.prototype.removeChild
assert.equal(guard.installPortalTranslateDomGuard(), true)
assert.equal(guard.installPortalTranslateDomGuard(), true)
assert.equal(FakeNode.prototype.removeChild, patched, 'installing twice must not double-wrap')
assert.equal(FakeNode.prototype.insertBefore.name, 'guardedInsertBefore')

// 6. The reload recovery stays as the last resort.
const recovery = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app', 'publicErrorRecovery.ts'), 'utf8')
assert.match(recovery, /removeChild\|insertBefore/)

console.log('PASS translate DOM guard: installed on every storefront load, never by the admin app, once, non-throwing')
