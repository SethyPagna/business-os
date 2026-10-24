import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { transformSync } from 'esbuild'
import ts from 'typescript'
import * as routing from '../src/app/pathRouting.ts'
import * as hubs from '../src/components/shared/hubNavigation.ts'
import { NAV_ITEMS, DEFAULT_MOBILE_PINNED, orderNavItems } from '../src/components/shared/navigationConfig.ts'
import { effectivePermissions } from '../src/utils/permissions.ts'
import { getInventoryCheckAccess } from '../src/utils/inventoryCheckAccess.ts'

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const require = createRequire(import.meta.url)
const React = require('react')
const branchSource = read('components/branches/BranchesHubPage.tsx')

function variable(source: string, name: string): ts.VariableDeclaration {
  const ast = ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found: ts.VariableDeclaration | undefined
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(found, `${name} must be found in actual source`)
  return found
}

function actualCallback(source: string, name: string, env: Record<string, unknown>) {
  const initializer = variable(source, name).initializer!
  const callback = ts.isCallExpression(initializer) ? initializer.arguments[0] : initializer
  const compiled = transformSync(`const callback = ${callback.getText()}`, { loader: 'tsx' }).code
  const context = { getInventoryCheckAccess, ...env }
  return new Function(...Object.keys(context), `${compiled}; return callback`)(...Object.values(context))
}

test('Inventory is a canonical route and configurable navigation item after Products', () => {
  for (const path of ['/inventory', '/Inventory/', '/inventory/products']) {
    assert.equal(routing.getAdminPageFromPath(path), 'inventory')
    assert.equal(routing.isAdminAppPath(path), true)
  }
  assert.equal(routing.getAdminPathForPage('inventory'), '/inventory')
  assert.equal(routing.resolveAdminLandingPage('inventory'), 'inventory')
  const index = NAV_ITEMS.findIndex(item => item.id === 'products')
  assert.deepEqual(NAV_ITEMS[index + 1], { id: 'inventory', key: 'inventory', permission: 'inventory' })
  const saved = ['sales', 'products', 'dashboard']
  assert.deepEqual(orderNavItems(NAV_ITEMS, saved).slice(0, 3).map(item => item.id), saved)
  assert.ok(orderNavItems(NAV_ITEMS, saved).some(item => item.id === 'inventory'))
  assert.deepEqual(DEFAULT_MOBILE_PINNED, ['dashboard', 'pos', 'products', 'sales'])
})

test('Inventory access is independent of Branches while legacy RFID grants survive', () => {
  const source = read('AppContext.tsx')
  const permissions = new Function(`return (${variable(source, 'PAGE_PERMISSIONS').initializer!.getText()})`)()
  for (const allowed of [true, false]) {
    const user = { permissions: { inventory: true, inventory_checks: allowed } }
    const authority = effectivePermissions(user)
    const canAccess = actualCallback(source, 'canAccessPage', { user, ...authority, PAGE_PERMISSIONS: permissions })
    assert.equal(canAccess('inventory'), allowed, 'explicit metadata denial cannot fall back to physical stock access')
    assert.equal(hubs.getHubDestinations('inventory', { ...authority, canAccessPage: canAccess }).length, allowed ? 3 : 0)
  }
  const checker = { permissions: { inventory_checks: true } }
  const checkerAuthority = effectivePermissions(checker)
  const checkerAccess = actualCallback(source, 'canAccessPage', { user: checker, ...checkerAuthority, PAGE_PERMISSIONS: permissions })
  assert.equal(checkerAccess('inventory'), true)
  assert.equal(checkerAccess('branches'), false, 'a count-only grant never opens the physical stock host')
  for (const grant of [true, 'review']) {
    // Physical Inventory (any tier) opens the RFID doorway on Branches but NOT the count pages: counting is its own grant
    // (owner, 21 Oct 2026: Full = main access only; migration 0270 wrote inventory_checks for every role that counted).
    const user = { permissions: { inventory: grant } }
    const authority = effectivePermissions(user)
    const canAccess = actualCallback(source, 'canAccessPage', { user, ...authority, PAGE_PERMISSIONS: permissions })
    assert.equal(canAccess('inventory'), false, 'Inventory alone no longer implies the count pages')
    assert.equal(canAccess('branches'), true, 'existing RFID doorway stays open')
    assert.deepEqual(hubs.getHubDestinations('branches', authority).map(item => item.id), ['rfid'])
    assert.deepEqual(hubs.getHubDestinations('inventory', authority).map(item => item.id), [])
    const both = { permissions: { inventory: grant, inventory_checks: true } }
    const bothAuthority = effectivePermissions(both)
    const bothAccess = actualCallback(source, 'canAccessPage', { user: both, ...bothAuthority, PAGE_PERMISSIONS: permissions })
    assert.equal(bothAccess('inventory'), true)
    assert.equal(bothAccess('branches'), true)
    assert.deepEqual(hubs.getHubDestinations('inventory', bothAuthority).map(item => item.id), ['products', 'sessions', 'issues'])
  }
  for (const user of [null, { permissions: {} }, { permissions: { branches: true } }, { permissions: { inventory: true, 'inventory:view': false } }]) {
    const authority = effectivePermissions(user)
    const canAccess = actualCallback(source, 'canAccessPage', { user, ...authority, PAGE_PERMISSIONS: permissions })
    assert.equal(canAccess('inventory'), false)
    assert.deepEqual(hubs.getHubDestinations('inventory', authority), [])
  }
})

test('Inventory sections belong to Inventory URLs and root landing anchors', () => {
  assert.equal(hubs.getHubPageFromLocation('/', '#hub:inventory:issues'), 'inventory')
  assert.equal(hubs.getHubPageFromLocation('/inventory', ''), 'inventory')
  assert.equal(hubs.resolveChromeSection('branches', '/inventory', '', ['products', 'rfid']), '')
  assert.equal(hubs.resolveHubSection('inventory', '/inventory', '#hub:inventory:sessions', ['products', 'sessions', 'issues'], 'products'), 'sessions')
  assert.equal(hubs.resolveHubSection('inventory', '/inventory', '#hub:branches:products', ['products', 'sessions', 'issues'], 'products'), 'products')
  assert.equal(hubs.navigationHash('branches', 'inventory', '#hub:branches:products', 'hub:inventory:products'), '#hub:inventory:products')
  assert.equal(hubs.needsNavigationGuard('branches', 'inventory', '#hub:branches:products', '#hub:inventory:products'), true)
})

function branchHarness(path: string, hash: string, grants: Record<string, unknown> = { branches: true, inventory: true }) {
  const browser = new EventTarget() as EventTarget & Record<string, any>
  const location = { pathname: path, hash, search: '' }
  const stored = new Map<string, string>()
  let page = 'branches', cursor = 0
  const cells: any[] = [], effects: any[] = [], pending: Array<() => void> = []
  const navigations: Array<[string, string | undefined]> = []
  Object.assign(browser, {
    location,
    sessionStorage: { getItem: (key: string) => stored.get(key) || null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) },
    history: { state: {}, replaceState(_state: unknown, _title: string, href: string) { const url = new URL(href, 'https://admin.example.test'); Object.assign(location, { pathname: url.pathname, hash: url.hash, search: url.search }) } },
  })
  Object.assign(globalThis, { window: browser })
  const hooks = {
    useState(initial: any) { const index = cursor++; if (!(index in cells)) cells[index] = typeof initial === 'function' ? initial() : initial; return [cells[index], (value: any) => { cells[index] = typeof value === 'function' ? value(cells[index]) : value }] },
    useRef(initial: any) { return hooks.useState(() => ({ current: initial }))[0] },
    useCallback(callback: any) { return callback },
    useEffect(callback: () => void, deps: any[]) {
      const index = cursor++, previous = effects[index]
      if (previous && deps.every((value, i) => Object.is(value, previous.deps[i])) && deps.length === previous.deps.length) return
      pending.push(() => { previous?.cleanup?.(); effects[index] = { deps, cleanup: callback() } })
    },
  }
  const authority = effectivePermissions({ permissions: grants })
  const navigateTo = (next: string, anchor?: string) => actualCallback(read('AppContext.tsx'), 'navigateTo', {
    canAccessPage: () => true, pendingTraversalRef: { current: null }, pageRef: { current: page },
    needsNavigationGuard: hubs.needsNavigationGuard, navigationHash: hubs.navigationHash,
    getDirtyWork: () => [], setNavGuard: () => assert.fail('clean navigation must not open a guard'),
    navigateNow: (next: string, anchor?: string) => {
      navigations.push([next, anchor])
      location.pathname = routing.getAdminPathForPage(next); location.hash = anchor ? `#${anchor}` : ''
      browser.dispatchEvent(new CustomEvent(routing.APP_NAVIGATION_EVENT, { detail: { page: next, path: location.pathname, anchor } }))
      page = next
    },
  })(next, anchor)
  const hubModule = { exports: {} as typeof hubs }
  new Function('require', 'module', 'exports', transformSync(read('components/shared/hubNavigation.ts'), { loader: 'ts', format: 'cjs' }).code)(
    (id: string) => id === 'react' ? hooks : routing, hubModule, hubModule.exports)
  const module = { exports: {} as { default: () => any } }
  let lazyIndex = 0
  new Function('require', 'module', 'exports', transformSync(branchSource, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code)((id: string) => {
    if (id === 'react') return { ...React, ...hooks, lazy: () => lazyIndex++ ? 'legacy-inventory-body' : 'branch-body' }
    if (id === 'react/jsx-runtime') return require(id)
    if (id.includes('hubNavigation')) return hubModule.exports
    if (id.includes('pathRouting')) return routing
    if (id.includes('AppContext')) return { useApp: () => ({ ...authority, t: (key: string) => key, navigateTo }) }
    if (id.includes('pageActivity')) return { useIsPageActive: () => page === 'branches' }
    if (id.includes('HubSectionNav')) return { default: 'hub-nav', __esModule: true }
    if (id.includes('DateTimeRangePicker')) return { todayDateTimeRange: () => ({ startDate: '2026-10-19', endDate: '2026-10-19' }) }
    if (id.startsWith('lucide-react/')) return { default: 'icon', __esModule: true }
    throw new Error(`Unexpected dependency ${id}`)
  }, module, module.exports)
  return {
    browser, location, stored, navigations,
    render() { cursor = 0; const tree = module.exports.default(); for (const effect of pending.splice(0)) effect(); return tree },
    navigateTo,
    close() { for (const effect of effects) effect?.cleanup?.() },
  }
}

function findElements(tree: any, type: string): any[] {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(child => findElements(child, type))
  return [...(tree.type === type ? [tree] : []), ...findElements(tree.props?.children, type)]
}

test('old branch-products entries redirect on cold entry and retained-host navigation', () => {
  for (const path of ['/branches', '/']) {
    const harness = branchHarness(path, '#hub:branches:products')
    try {
      const tree = harness.render()
      assert.deepEqual(harness.navigations.at(-1), ['inventory', 'hub:inventory:products'])
      assert.equal(findElements(tree, 'legacy-inventory-body').length, 0)
      assert.equal(findElements(tree, 'hub-nav')[0].props.sections.some((section: any) => section.id === 'products'), false)
    } finally { harness.close() }
  }
  const harness = branchHarness('/branches', '#hub:branches:overview')
  try {
    harness.render()
    harness.navigateTo('sales')
    harness.render()
    harness.navigateTo('branches', 'hub:branches:products')
    harness.render()
    assert.deepEqual(harness.navigations.at(-1), ['inventory', 'hub:inventory:products'])
  } finally { harness.close() }
})

test('Branches retains overview, transfers, RFID and catalogue dashboard focus semantics', () => {
  const cases = [
    { anchor: 'overview', view: 'branches' },
    { anchor: 'transfers', view: 'transfers' },
    { anchor: 'rfid', view: 'rfid' },
  ]
  for (const entry of cases) {
    const harness = branchHarness('/branches', `#hub:branches:${entry.anchor}`)
    try {
      const tree = harness.render()
      const nodes = findElements(tree, entry.anchor === 'rfid' ? 'legacy-inventory-body' : 'branch-body')
      assert.equal(nodes.length, 1)
      assert.equal(nodes[0].props[entry.anchor === 'rfid' ? 'hostSection' : 'view'], entry.view)
      if (entry.anchor !== 'rfid') assert.equal(nodes[0].props.showDateRange, true)
    } finally { harness.close() }
  }
  for (const section of ['products', 'movements']) {
    const harness = branchHarness('/branches', '', { branches: true, inventory: true, products: true })
    try {
      harness.stored.set('bos:dashboard:inventory-focus', JSON.stringify({ section, stockFilter: 'low' }))
      harness.render()
      assert.deepEqual(harness.navigations.at(-1), ['products', undefined])
      if (section === 'products') assert.deepEqual(JSON.parse(harness.stored.get('bos:dashboard:products-focus')!), { stockFilter: 'low' })
    } finally { harness.close() }
  }
  const inventoryOnly = branchHarness('/branches', '', { inventory: true })
  try { assert.equal(findElements(inventoryOnly.render(), 'legacy-inventory-body')[0].props.hostSection, 'rfid') }
  finally { inventoryOnly.close() }
})

test('actual Back handling canonicalizes old branch-products without adding a history layer', () => {
  const cases = ['/branches', '/'].flatMap(path => ['/sales', '/inventory?keep=1#hub:inventory:products'].map(previousPath => ({ path, previousPath })))
  for (const { path, previousPath } of cases) {
    let href = `https://admin.example.test${path}?keep=1#hub:branches:products`
    let replacements = 0, committedPage = '', published: any
    const browser = new EventTarget() as EventTarget & Record<string, any>
    Object.defineProperty(browser, 'location', { get: () => new URL(href) })
    browser.history = {
      state: { bosNavigationIndex: 1 },
      replaceState(_state: unknown, _title: string, value: string) { replacements++; href = value },
      pushState() { assert.fail('Back must replace the obsolete entry, never add a layer') },
    }
    browser.addEventListener(routing.APP_NAVIGATION_EVENT, (event: Event) => { published = (event as CustomEvent).detail })
    Object.assign(globalThis, { window: browser })
    const committedLocationRef = { current: { href: `https://admin.example.test${previousPath}`, state: { bosNavigationIndex: 2 } } }
    const onPopState = actualCallback(read('AppContext.tsx'), 'onPopState', {
      ...routing, getHubPageFromLocation: hubs.getHubPageFromLocation,
      settingsRef: { current: {} }, committedLocationRef, pendingTraversalRef: { current: null },
      pageRef: { current: 'sales' }, needsNavigationGuard: hubs.needsNavigationGuard,
      getDirtyWork: () => [], canAccessPage: (page: string) => page === 'inventory',
      startTransition: (callback: () => void) => callback(), setPage: (page: string) => { committedPage = page },
      resumeHistoryNavigation: () => assert.fail('no pending traversal'), setNavGuard: () => assert.fail('no dirty work'),
    })
    onPopState()
    assert.equal(href, 'https://admin.example.test/inventory?keep=1#hub:inventory:products')
    assert.equal(replacements, 1)
    assert.equal(committedPage, 'inventory')
    assert.deepEqual(published, { page: 'inventory', path: '/inventory', anchor: 'hub:inventory:products' })
    assert.equal(committedLocationRef.current.href, href)
    assert.equal(committedLocationRef.current.state.bosNavigationIndex, 1)
  }
})
