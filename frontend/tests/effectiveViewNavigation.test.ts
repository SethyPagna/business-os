import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { transformSync } from 'esbuild'
import ts from 'typescript'
import { effectivePermissions } from '../src/utils/permissions.ts'
import * as navigation from '../src/components/shared/hubNavigation.ts'
import { NAV_ITEMS } from '../src/components/shared/navigationConfig.ts'

// Execute the production page callback, with the actual effective authority.
const appSource = readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('AppContext.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let pageMap = '', pageCallback = ''
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'PAGE_PERMISSIONS') pageMap = node.initializer!.getText(ast)
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'canAccessPage') pageCallback = (node.initializer as ts.CallExpression).arguments[0].getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)
const callbackJs = transformSync(`const callback = ${pageCallback}`, { loader: 'ts' }).code
const pageAccess = (user: any) => {
  const authority = effectivePermissions(user)
  return new Function('user', 'can', 'getPermissionTier', 'PAGE_PERMISSIONS', `${callbackJs}; return callback`)(user, authority.can, authority.getPermissionTier, new Function(`return (${pageMap})`)())
}
for (const item of NAV_ITEMS) assert.ok(Object.hasOwn(new Function(`return (${pageMap})`)(), item.id), `current page ${item.id} must be modeled`)
assert.equal(pageAccess({ permissions: {} })('unknown-page'), false)
assert.equal(pageAccess(null)('notes'), false)
assert.equal(pageAccess({ permissions: {} })('files'), true, 'authenticated library read remains unconditional')
for (const [page, keys] of Object.entries({ sales: ['sales', 'returns', 'fees'], branches: ['branches', 'inventory'], review: ['review', 'audit_log'], promotions: ['promotions', 'products', 'customer_portal'], settings: ['settings', 'backup', 'business_identity', 'sales_policy', 'drive_credentials'] })) {
  for (const key of keys) {
    assert.equal(pageAccess({ permissions: { [key]: true } })(page), true)
    assert.equal(pageAccess({ permissions: { [key]: true, [`${key}:view`]: false } })(page), false)
  }
}
for (const key of ['dashboard', 'pos', 'products', 'contacts']) {
  assert.equal(pageAccess({ permissions: { [key]: true, [`${key}:view`]: false } })(key), false)
}
const downgraded = { role_permissions: { all: true }, permissions: { all: false, products: 'review', products_image_only: true } }
assert.equal(pageAccess(downgraded)('products'), true)
assert.equal(pageAccess({ ...downgraded, permissions: { ...downgraded.permissions, 'products:view': false } })('products'), false)
for (const identity of [{ username: ' ADMIN ' }, { role_code: ' admin ' }]) {
  assert.equal(pageAccess({ ...identity, permissions: { sales: false, 'sales:view': false } })('sales'), true)
}

// A real React root and production Sales hub/hook: replace data-heavy child
// pages only, so navigation state survives a permission refresh on this mount.
class MemoryNode {
  nodeType: number; nodeName: string; tagName: string; ownerDocument: any
  namespaceURI = 'http://www.w3.org/1999/xhtml'; parentNode: MemoryNode | null = null
  childNodes: MemoryNode[] = []; style = {}; nodeValue = ''; ownText = ''
  constructor(type: number, name: string, doc: any) { this.nodeType = type; this.nodeName = name; this.tagName = name; this.ownerDocument = doc }
  appendChild(child: MemoryNode) { child.parentNode = this; this.ownText = ''; this.childNodes.push(child); return child }
  insertBefore(child: MemoryNode, before: MemoryNode) { child.parentNode = this; this.childNodes.splice(this.childNodes.indexOf(before), 0, child); return child }
  removeChild(child: MemoryNode) { this.childNodes.splice(this.childNodes.indexOf(child), 1); child.parentNode = null; return child }
  addEventListener() {} removeEventListener() {} setAttribute() {} removeAttribute() {}
  get firstChild() { return this.childNodes[0] || null }
  set textContent(text: string) { this.ownText = text; this.childNodes = [] }
  get textContent(): string { return this.nodeType === 3 ? this.nodeValue : this.childNodes.length ? this.childNodes.map(node => node.textContent).join('') : this.ownText }
}
const doc: any = { nodeType: 9, addEventListener() {}, removeEventListener() {} }
doc.createElement = (name: string) => new MemoryNode(1, name.toUpperCase(), doc)
doc.createElementNS = (_ns: string, name: string) => doc.createElement(name)
doc.createTextNode = (text: string) => { const node = new MemoryNode(3, '#text', doc); node.nodeValue = text; return node }
doc.documentElement = doc.createElement('html'); doc.body = doc.createElement('body'); doc.activeElement = doc.body
const events = new EventTarget()
const location = { pathname: '/sales', hash: '#hub:sales:sales', search: '' }
const win: any = { document: doc, HTMLElement: MemoryNode, HTMLIFrameElement: class {}, location,
  addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events),
  history: { state: null, replaceState(_state: unknown, _title: string, url: string) { location.hash = new URL(url, 'http://localhost').hash } },
}
doc.defaultView = win
Object.defineProperty(globalThis, 'window', { configurable: true, value: win })
Object.defineProperty(globalThis, 'document', { configurable: true, value: doc })
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
let user: any = { permissions: { sales: true, returns: true } }
const context = () => ({ ...effectivePermissions(user), t: (key: string) => key, navigateTo() {} })
const require = createRequire(import.meta.url)
let lazyIndex = 0
const mounted = new Set<string>()
const labels = ['Sales body', 'Returns body', 'Fees body', 'Reports body']
const compiled = transformSync(readFileSync(new URL('../src/components/sales/SalesHubPage.tsx', import.meta.url), 'utf8'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
const module = { exports: {} as any }
new Function('require', 'module', 'exports', compiled)((id: string) => {
  if (id === 'react') return { ...React, lazy: () => {
    const label = labels[lazyIndex++]
    return () => { React.useEffect(() => { mounted.add(label); return () => { mounted.delete(label) } }, []); return React.createElement('p', null, label) }
  } }
  if (id === 'react/jsx-runtime') return require(id)
  if (id.includes('AppContext')) return { useApp: context }
  if (id.includes('hubNavigation')) return navigation
  if (id.includes('HubSectionNav')) return { __esModule: true, default: (props: any) => React.createElement('section', null, props.sections.filter((row: any) => !row.hidden).map((row: any) => row.label).join('|'), props.children), readStoredHubSection: () => null }
  if (id.startsWith('lucide-react/')) return { __esModule: true, default: () => null }
  throw new Error(`Unexpected dependency ${id}`)
}, module, module.exports)
const container = doc.createElement('div')
const root = createRoot(container as Element)
try {
  await act(async () => root.render(React.createElement(module.exports.default)))
  assert.deepEqual([...mounted], ['Sales body'])
  user = { permissions: { sales: true, 'sales:view': false, returns: true } }
  await act(async () => root.render(React.createElement(module.exports.default)))
  assert.deepEqual([...mounted], ['Returns body'], 'refresh must unmount denied current destination')
  assert.equal(location.hash, '#hub:sales:returns')
  assert.doesNotMatch(container.textContent, /Sales/)
  user = { permissions: { sales: true, 'sales:view': false, returns: true, 'returns:view': false } }
  await act(async () => root.render(React.createElement(module.exports.default)))
  assert.deepEqual([...mounted], [], 'all denied must not fall back to an unauthorized Fees body')
} finally { await act(async () => root.unmount()) }
console.log('PASS current page matrix and real mounted Sales hub permission refresh')
