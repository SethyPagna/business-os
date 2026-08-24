import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DEFAULT_MOBILE_PINNED, NAV_ITEMS, orderNavItems, parseNavSetting } from '../src/components/shared/navigationConfig.ts'

const appContextSource = fs.readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8')
const settingsSource = fs.readFileSync(new URL('../src/components/utils-settings/Settings.tsx', import.meta.url), 'utf8')

let failed = 0

type TestCallback = () => void | Promise<void>

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('parseNavSetting keeps only non-empty string ids', () => {
  assert.deepEqual(parseNavSetting('["sales", "", 4, "pos", "  "]'), ['sales', 'pos'])
  assert.deepEqual(parseNavSetting('not json', DEFAULT_MOBILE_PINNED), DEFAULT_MOBILE_PINNED)
  assert.deepEqual(parseNavSetting({ invalid: true }, ['dashboard']), ['dashboard'])
})

await runTest('orderNavItems applies saved order while preserving unknown items', () => {
  const items = [
    { id: 'dashboard' },
    { id: 'sales' },
    { id: 'pos' },
    { id: 'files' },
  ]
  assert.deepEqual(orderNavItems(items, ['pos', 'sales']).map((item) => item.id), ['pos', 'sales', 'dashboard', 'files'])
})

await runTest('navigation config keeps dashboard and mobile defaults available', () => {
  assert.equal(NAV_ITEMS[0].id, 'dashboard')
  assert.deepEqual(DEFAULT_MOBILE_PINNED, ['dashboard', 'pos', 'products', 'sales'])
})

await runTest('Customer Portal stays configurable in navigation and the editor supports drag reordering', () => {
  const customerPortalItem = NAV_ITEMS.find((item) => item.id === 'catalog')
  assert.ok(customerPortalItem, 'Customer Portal navigation item should remain available')
  assert.equal(customerPortalItem?.permission, 'customer_portal')
  assert.match(settingsSource, /const \[dragNavId, setDragNavId\] = useState<string \| null>\(null\)/)
  assert.match(settingsSource, /const moveNavBefore = \(dragId: string \| null, targetId: string\) =>/)
  assert.match(settingsSource, /\sdraggable(?:\s|\n|$)/)
  assert.match(settingsSource, /onDragOver=\{\(event\) => event\.preventDefault\(\)\}[\s\S]{0,240}onDrop=\{\(\) => \{[\s\S]{0,240}moveNavBefore\(dragNavId, item\.id\)/)
  assert.doesNotMatch(settingsSource, /\.filter\(item => item\.id !== 'catalog'\)/)
})

await runTest('every nav item has an explicit, matching route-access entry in AppContext PAGE_PERMISSIONS', () => {
  // navigationConfig.ts's `permission` field only controls whether the
  // sidebar *link* is shown -- the actual page-load guard is a separate
  // map (PAGE_PERMISSIONS) in AppContext.tsx's canAccessPage(). Two ways
  // that can go wrong, both checked here:
  //  1. A page id missing from PAGE_PERMISSIONS entirely -- canAccessPage
  //     treats a missing entry the same as `null` (always accessible).
  //     This was the 'files' page's bug.
  //  2. A page id present in both places but with DIFFERENT required
  //     permissions -- the sidebar shows/hides the link based on one
  //     permission while the page-load guard checks another, so a user can
  //     see a link they can't actually use (or vice versa). This was
  //     'receipt_settings': nav said 'settings', the guard said 'all'.
  const permissionsBlockMatch = appContextSource.match(/const PAGE_PERMISSIONS: Record<string, string \| null> = \{([\s\S]*?)\n\}/)
  assert.ok(permissionsBlockMatch, 'PAGE_PERMISSIONS map should be present in AppContext.tsx')
  const permissionsBlock = permissionsBlockMatch?.[1] || ''
  const declaredPermissions = new Map(
    [...permissionsBlock.matchAll(/^\s*([a-zA-Z_]+):\s*(?:'([^']*)'|(null)),/gm)].map((match) => [match[1], match[2] ?? null]),
  )
  const missing = NAV_ITEMS.map((item) => item.id).filter((id) => !declaredPermissions.has(id))
  assert.deepEqual(missing, [], `PAGE_PERMISSIONS is missing an explicit entry for: ${missing.join(', ')}`)

  const mismatched = NAV_ITEMS
    .filter((item) => declaredPermissions.has(item.id) && declaredPermissions.get(item.id) !== item.permission)
    .map((item) => `${item.id} (nav: ${item.permission}, guard: ${declaredPermissions.get(item.id)})`)
  assert.deepEqual(mismatched, [], `nav link visibility and page-load guard disagree for: ${mismatched.join(', ')}`)
})

if (failed > 0) {
  process.exitCode = 1
}
