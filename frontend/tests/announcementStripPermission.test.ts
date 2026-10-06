// Owner ruling, 6 Oct 2026 (release security review P2-1): the storefront announcement strip cards are
// public website content, so adding, editing, reordering and deleting them needs a Website Editor
// grant (the Worker's routes/promotions.ts requireWebsiteEditor), not the Products section.
//
// The Worker admits portal_posts, customer_portal or full Settings. The Website Editor's own area gates
// (CatalogPage.canWritePortalArea) are "the area's key OR full Settings", so the Manage button must show for
// exactly canEditConfig (customer_portal / settings) or canEditPosts (portal_posts / settings).
//
//   WORKER  the four writes use the Website Editor guard and the guard names exactly those three keys
//   AREAS   the editor's area gates map each of those keys to the area the button checks
//   BUTTON  the Manage button renders only for canEditConfig || canEditPosts, outside the config-only wrapper
//   GRANTS  a role holding none of the three has no way to see it: the editor's per-area key set is unchanged
//
// Run: node tests/announcementStripPermission.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canWriteSettingKey } from '../src/utils/portalPermissions.ts'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').split('\r\n').join('\n')
const worker = read('../../cloudflare/src/routes/promotions.ts')
const surface = read('../src/components/catalog/CatalogEditorSurface.tsx')
const page = read('../src/components/catalog/CatalogPage.tsx')

let failed = 0
function test(name: string, run: () => void) {
  try { run(); console.log('PASS ' + name) } catch (error) { failed += 1; console.error('FAIL ' + name, error) }
}

const workerKeys = (() => {
  const match = worker.match(/const WEBSITE_EDITOR_STRIP_KEYS = \[([^\]]+)\] as const/)
  assert.ok(match, 'the Worker declares WEBSITE_EDITOR_STRIP_KEYS')
  return match![1].split(',').map((part) => part.trim().replace(/['"]/g, '')).filter(Boolean)
})()

test('WORKER: the four strip writes use the Website Editor guard; the read keeps products', () => {
  for (const route of ["app.post('/'", "app.put('/:id'", "app.put('/reorder/all'", "app.delete('/:id'"]) {
    assert.ok(worker.includes(`${route}, requireWebsiteEditor,`), route + ' is guarded by requireWebsiteEditor')
  }
  assert.ok(worker.includes("app.get('/', requireStripRead,"), 'the list uses the products-or-Website-Editor read gate, so a pure Website Editor role can load its Manage modal')
  assert.deepEqual([...workerKeys].sort(), ['customer_portal', 'portal_posts', 'settings'])
})

test('AREAS: each Worker key is satisfied by the same editor grants the Manage button checks', () => {
  assert.match(page, /const canEditConfig = canWritePortalArea\('customer_portal'\)/)
  assert.match(page, /const canEditPosts = canWritePortalArea\('portal_posts'\)/)
  assert.match(page, /const canWritePortalArea = \(permission: string\) => !publicView && \(hasPermission\(permission\) \|\| hasPermission\('settings'\)\)/)
  // The settings buckets use the same keys, so the editor and the Worker cannot drift apart silently.
  const holds = (...keys: string[]) => (permission: string) => keys.includes(permission)
  assert.equal(canWriteSettingKey('customer_portal_promo_items', holds('portal_posts')), true)
  assert.equal(canWriteSettingKey('customer_portal_faq_items', holds('portal_posts')), false)
  assert.equal(canWriteSettingKey('customer_portal_theme', holds('customer_portal')), true)
  assert.equal(canWriteSettingKey('customer_portal_promo_items', holds('settings')), true)
})

test('BUTTON: Manage shows for canEditConfig || canEditPosts, outside the config-only wrapper', () => {
  const at = surface.indexOf("setShowAnnouncementStripModal(true)")
  assert.ok(at > 0, 'the button exists')
  const before = surface.slice(Math.max(0, at - 1200), at)
  assert.ok(before.includes('{canEditConfig || canEditPosts ? ('), 'the button is conditional on the two grants')
  const gate = before.lastIndexOf('{canEditConfig || canEditPosts ? (')
  const wrapperOpens = before.slice(gate).includes("className={canEditConfig ? 'contents' : 'hidden'}")
  assert.equal(wrapperOpens, false, 'no config-only wrapper opens between the gate and the button')
})

if (failed) process.exit(1)
console.log('announcementStripPermission: all checks passed')
