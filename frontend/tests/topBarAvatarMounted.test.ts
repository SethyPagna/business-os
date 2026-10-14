// The top bar and the profile menu show the signed-in account's uploaded photo.
//
// The Worker's /bootstrap and /me used to omit users.avatar_path, so the app user
// carried no photo after a reload and both spots drew the initial. They now
// carry avatar_path and updated_at; this mounts the real Sidebar with a user
// shaped exactly like that payload and checks what the person sees:
//   - every account button (desktop row, mobile top bar) draws the photo, with
//     updated_at as the cache-bust version and the configured server authority
//   - a photo that fails to load falls back to the initial, never a broken icon
//   - no photo at all (avatar_path null) shows the initial
//   - the profile modal's avatar event carries the new revision
import assert from 'node:assert/strict'
import { createHarness, propsOf, type MemoryNode } from './mountedComponentHarness.ts'
import { profileAvatarEventDetail } from '../src/components/users/avatarFlow.ts'

const harness = await createHarness()
const bootstrapUser = { id: 1, username: 'admin', name: 'Admin', role_name: 'Administrator', avatar_path: '/uploads/admin-photo.png', updated_at: '2026-10-14 08:00:00' }
const app: Record<string, unknown> = {
  page: 'products', user: bootstrapUser, settings: { language: 'en' },
  t: (key: string) => ({ account: 'Account', profile: 'Profile', no_role: 'No role' } as Record<string, string>)[key] || key,
  navigateTo: () => {}, logout: () => {}, notify: () => {}, hasPermission: () => false, getPermissionTier: () => 'none', can: () => false, canAccessPage: () => false,
  syncUrl: window.location.origin,
}
;(window as unknown as { api: unknown }).api = { getSyncServerUrl: () => window.location.origin, getUserProfile: async () => app.user, otpStatus: async () => ({ otpEnabled: false }), getVerificationCapabilities: async () => ({}), getUserAuthMethods: async () => ({ methods: [] }), debugLog: () => {} }
const sidebar = await harness.mount({ component: 'components/navigation/Sidebar.tsx', props: { showQuickPreferences: false }, app, doubles: {} })

const accountButtons = (): MemoryNode[] => sidebar.findAll((node) => node.tagName === 'BUTTON' && propsOf(node)['aria-label'] === 'Account')
const photos = (): MemoryNode[] => sidebar.findAll((node) => node.tagName === 'IMG' && propsOf(node).alt === 'Admin')
const within = (root: MemoryNode, predicate: (node: MemoryNode) => boolean): MemoryNode[] => {
  const found: MemoryNode[] = []
  const walk = (node: MemoryNode): void => { if (predicate(node)) found.push(node); node.childNodes.forEach(walk) }
  walk(root)
  return found
}

try {
  assert.ok(accountButtons().length >= 2, 'desktop account row and mobile top-bar button are both present')
  for (const button of accountButtons()) {
    const images = within(button, (node) => node.tagName === 'IMG')
    assert.equal(images.length, 1, 'each account button draws the photo')
    const src = String(propsOf(images[0]).src)
    console.log('MEASURE account button photo src=' + src)
    assert.equal(new URL(src, window.location.origin).pathname, '/uploads/admin-photo.png')
    assert.equal(new URL(src, window.location.origin).searchParams.get('v'), '2026-10-14 08:00:00', 'updated_at busts the cache')
  }

  await sidebar.click(accountButtons()[accountButtons().length - 1])
  const menuHeader = sidebar.findAll((node) => propsOf(node)['data-bos-profile-action'] === 'true')
  assert.ok(menuHeader.length > 0, 'profile menu header is open')
  assert.ok(menuHeader.every((node) => within(node, (inner) => inner.tagName === 'IMG').length === 1), 'profile menu header draws the photo')

  for (const image of photos()) await sidebar.call(image, 'onError', [])
  assert.equal(photos().length, 0, 'a photo that fails to load leaves no broken image')
  for (const button of accountButtons()) assert.ok(button.textContent.trim().startsWith('A'), 'the initial shows instead')
  assert.ok(menuHeader.every((node) => node.textContent.includes('A')))

  app.user = { ...bootstrapUser, id: 2, name: 'Bora', avatar_path: null }
  await sidebar.render({ showQuickPreferences: false })
  assert.equal(sidebar.findAll((node) => node.tagName === 'IMG' && propsOf(node).alt === 'Bora').length, 0, 'no avatar_path draws no image')
  for (const button of accountButtons()) assert.ok(button.textContent.trim().startsWith('B'))

  const detail = profileAvatarEventDetail(1, { avatar_path: '/uploads/new.png', updated_at: '2026-10-14 09:00:00' })
  assert.deepEqual(detail, { id: 1, avatar_path: '/uploads/new.png', updated_at: '2026-10-14 09:00:00' })
  assert.deepEqual(profileAvatarEventDetail(1, { avatar_path: null, updated_at: null }), { id: 1, avatar_path: null, updated_at: null })
  console.log('PASS mounted top bar and profile menu show the bootstrap avatar, fall back to the initial, and the profile event carries the revision')
} finally { await harness.close() }
