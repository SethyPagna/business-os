// P2-9 finding 3: a new app version reached the user through exactly one
// surface -- Sidebar's account panel -> "Update" -- which a cashier has no
// reason to open. The service worker's BUSINESS_OS_APP_UPDATE_AVAILABLE
// broadcast did reach App.tsx, which stored it in an `appUpdate` state field
// that the consumer never destructured, so it rendered nothing at all. A
// client could therefore run a stale bundle indefinitely.
//
// The fix has three properties this test exists to keep true:
//   1. the prompt is NON-BLOCKING (a toast, never a modal over a checkout);
//   2. it can never reload past unsaved work or an in-flight online sale;
//   3. it never re-asks about a version already applied or explicitly
//      deferred, and never fires at all on a browser's first ever load.
//
// Behaviour (2) and (3) are exercised for real against the module rather than
// pattern-matched: both are pure logic over localStorage plus the dirty-work
// registry, and both are exactly where a regression would hide.
//
// Run: node tests/pwaUpdateToast.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const src = path.join(root, 'src')

// Minimal browser surface. appUpdate.ts only ever reaches for localStorage,
// window.location.reload and an optional navigator.serviceWorker -- Node 24
// already supplies a `navigator` with no serviceWorker, which is exactly the
// "no service worker registered" branch.
const store = new Map<string, string>()
let reloads = 0
const g = globalThis as unknown as Record<string, unknown>
g.localStorage = {
  getItem: (key: string) => (store.has(key) ? store.get(key) as string : null),
  setItem: (key: string, value: string) => { store.set(key, String(value)) },
  removeItem: (key: string) => { store.delete(key) },
  clear: () => { store.clear() },
}
g.sessionStorage = g.localStorage
g.window = {
  location: { reload: () => { reloads += 1 } },
  addEventListener: () => {},
  removeEventListener: () => {},
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (id: unknown) => clearTimeout(id as never),
  setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
  clearInterval: (id: unknown) => clearInterval(id as never),
}

const appUpdate = await import('../src/utils/appUpdate.ts')
const dirtyWork = await import('../src/utils/dirtyWork.ts')
const {
  APP_UPDATE_STORAGE_KEYS, applyAppUpdate, dismissAppUpdate, getAppUpdateBlocker, shouldPromptForAppUpdate,
} = appUpdate

const toastSource = fs.readFileSync(path.join(src, 'components', 'shared', 'AppUpdateToast.tsx'), 'utf8')
const updateSource = fs.readFileSync(path.join(src, 'utils', 'appUpdate.ts'), 'utf8')
const appSource = fs.readFileSync(path.join(src, 'App.tsx'), 'utf8')

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log('PASS ' + name)
  } catch (error) {
    failed += 1
    console.error('FAIL ' + name)
    console.error(error)
  }
}

async function runAsyncTest(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
    console.log('PASS ' + name)
  } catch (error) {
    failed += 1
    console.error('FAIL ' + name)
    console.error(error)
  }
}

function reset(): void {
  store.clear()
  reloads = 0
}

function walkSource(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkSource(full, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

function relative(file: string): string {
  return path.relative(root, file).replace(/\\/g, '/')
}

const sourceFiles = walkSource(src)

runTest('a brand-new browser is never told its first version is stale', () => {
  reset()
  // service-worker.ts broadcasts from activate unconditionally, including the
  // very first install where there was no incumbent worker to be stale
  // against. That first version is recorded silently instead of announced.
  assert.equal(shouldPromptForAppUpdate('2026-09-02a'), false, 'the first observed version must not raise a prompt')
  assert.equal(
    store.get(APP_UPDATE_STORAGE_KEYS.observedVersion), '2026-09-02a',
    'it must still be recorded, or every later load looks like a first load and nothing ever prompts',
  )
})

runTest('the same version never asks twice', () => {
  reset()
  shouldPromptForAppUpdate('v1')
  assert.equal(shouldPromptForAppUpdate('v2'), true, 'a genuinely newer version must ask')
  // Each update is broadcast twice: once from install with waiting:true, once
  // from activate. The second must be silent once the first was answered.
  store.set(APP_UPDATE_STORAGE_KEYS.observedVersion, 'v2')
  assert.equal(shouldPromptForAppUpdate('v2'), false, 'the paired broadcast of an applied version must be silent')
})

runTest('Later silences that version and only that version', () => {
  reset()
  shouldPromptForAppUpdate('v1')
  assert.equal(shouldPromptForAppUpdate('v2'), true)
  dismissAppUpdate('v2')
  assert.equal(shouldPromptForAppUpdate('v2'), false, 'a deferred version must not re-prompt in a loop')
  assert.equal(shouldPromptForAppUpdate('v3'), true, 'a later version must still be offered after a dismissal')
})

runTest('a versionless broadcast still prompts', () => {
  reset()
  shouldPromptForAppUpdate('v1')
  // App.tsx has a synthetic no-detail fallback. It cannot be de-duplicated,
  // and silently running stale code is the worse of the two failures.
  assert.equal(shouldPromptForAppUpdate(''), true)
})

runTest('the guard checks an in-flight sale before dirty work, and covers both', () => {
  // Ordering is load-bearing: a mid-checkout POS page deliberately never
  // registers as dirty work (multi-order carts persist by design), so a
  // dirty-work-first guard would never reach the one case that loses money.
  const saleAt = updateSource.indexOf('hasInFlightOnlineSaleSubmission()')
  const dirtyAt = updateSource.indexOf('hasDirtyWork()')
  assert.notEqual(saleAt, -1, 'the guard must consult the in-flight online sale registry')
  assert.notEqual(dirtyAt, -1, 'the guard must consult the dirty-work registry')
  assert.ok(saleAt < dirtyAt, 'the in-flight sale must be checked first')
})

await runAsyncTest('unsaved work refuses the reload instead of performing it', async () => {
  reset()
  let dirty = true
  const unregister = dirtyWork.registerDirtyWork({
    key: 'pwa-update-test',
    pageId: 'products',
    label: 'Product form',
    isDirty: () => dirty,
  })
  try {
    assert.equal(getAppUpdateBlocker(), 'unsaved-work', 'registered dirty work must block the reload')
    const refused = await applyAppUpdate('v9')
    assert.equal(refused, 'unsaved-work', 'applyAppUpdate must return the reason so the caller can explain it')
    assert.equal(reloads, 0, 'it must NOT have reloaded past unsaved work')
    assert.equal(
      store.get(APP_UPDATE_STORAGE_KEYS.observedVersion), undefined,
      'a refused update must not record the version as observed, or the user is never re-asked about an update that never happened',
    )
    dirty = false
    assert.equal(getAppUpdateBlocker(), null, 'saving the work must unblock it, with no reload of its own')
  } finally {
    unregister()
  }
})

await runAsyncTest('a clean app reloads and records the version it applied', async () => {
  reset()
  assert.equal(getAppUpdateBlocker(), null)
  const refused = await applyAppUpdate('v9')
  assert.equal(refused, null, 'nothing should refuse a clean update')
  assert.equal(reloads, 1, 'the update must actually reload -- a prompt that does nothing is worse than none')
  assert.equal(
    store.get(APP_UPDATE_STORAGE_KEYS.observedVersion), 'v9',
    'the applied version must be recorded so the paired activate broadcast does not re-ask after the reload',
  )
})

runTest('only appUpdate.ts may activate the waiting worker', () => {
  // Posting BUSINESS_OS_SKIP_WAITING is the act of taking the update. A
  // second sender would bypass the guard entirely.
  const senders = sourceFiles
    .filter((file) => /postMessage\([^)]*BUSINESS_OS_SKIP_WAITING/.test(fs.readFileSync(file, 'utf8')))
    .map(relative)
  assert.deepEqual(senders, ['src/utils/appUpdate.ts'])
})

runTest('no new reload site appears outside the known non-update ones', () => {
  // Crash recovery, chunk recovery, the storefront language switch and the
  // theme bootstrap reload for reasons unrelated to a service worker
  // generation, so they must NOT be routed through the update guard. Any
  // OTHER file reloading is either a second update path (which must call
  // applyAppUpdate) or needs its reason recorded here.
  const known = [
    'src/utils/appUpdate.ts',
    'src/App.tsx',
    'src/public-runtime/theme-bootstrap.ts',
    'src/components/catalog/portalTranslateController.ts',
  ]
  const offenders = sourceFiles
    .filter((file) => /location\.reload/.test(fs.readFileSync(file, 'utf8')))
    .map(relative)
    .filter((rel) => !known.includes(rel))
  assert.deepEqual(offenders, [])
})

runTest('the toast is non-blocking and does not trap the user', () => {
  assert.equal(/inset-0/.test(toastSource), false, 'a full-screen overlay would cover the POS total mid-checkout')
  assert.equal(/role="dialog"|aria-modal/.test(toastSource), false, 'the update prompt must never be a modal')
  assert.match(toastSource, /role="status"/, 'it is an announcement, so screen readers should receive it politely')
  assert.match(toastSource, /aria-live="polite"/, 'assertive would interrupt whatever the cashier is doing')
  // Both actions dismiss it, so there is no way to be stuck with it on screen.
  assert.ok(toastSource.includes("t('later')"), 'a Later action is required')
  assert.ok(toastSource.includes("t('update_now')"), 'an Update now action is required')
})

runTest('the toast is mounted exactly once, inside the shared bottom stack', () => {
  const mounts = appSource.match(/<AppUpdateToast\s*\/>/g) || []
  assert.equal(mounts.length, 1, 'two mounts would race for the same broadcast and could double-prompt')
  assert.match(appSource, /import AppUpdateToast from/, 'App.tsx owns the mount')
  const stackAt = appSource.indexOf('<AppUpdateToast />')
  const wrapperAt = appSource.lastIndexOf('pointer-events-none', stackAt)
  assert.ok(
    wrapperAt !== -1 && stackAt - wrapperAt < 400,
    'the toast must sit inside the pointer-events-none stack so the shell behind it stays clickable',
  )
  // The dead state it replaces must be gone, not merely bypassed.
  assert.equal(
    /setAppUpdate/.test(appSource), false,
    'App.tsx must no longer keep the never-rendered appUpdate state that this component replaced',
  )
})

runTest('every string the toast can show exists in BOTH language packs', () => {
  const en = JSON.parse(fs.readFileSync(path.join(src, 'lang', 'en.json'), 'utf8')) as Record<string, string>
  const km = JSON.parse(fs.readFileSync(path.join(src, 'lang', 'km.json'), 'utf8')) as Record<string, string>
  const keys = ['update_available', 'update_now', 'later', 'wait_for_sale_before_update', 'save_or_discard_before_update']
  for (const key of keys) {
    assert.ok(en[key] && String(en[key]).trim(), 'en.json is missing ' + key)
    assert.ok(km[key] && String(km[key]).trim(), 'km.json is missing ' + key)
    assert.match(String(km[key]), /[ក-៿]/, 'km.json still holds the English string for ' + key)
  }
  // The blocker lines are shared with Sidebar's account-panel action, so a
  // rename in one place must not leave the other silently untranslated.
  const sidebar = fs.readFileSync(path.join(src, 'components', 'navigation', 'Sidebar.tsx'), 'utf8')
  for (const key of ['wait_for_sale_before_update', 'save_or_discard_before_update']) {
    assert.ok(sidebar.includes(key), 'Sidebar must use the shared key ' + key)
    assert.ok(toastSource.includes(key), 'the toast must use the shared key ' + key)
  }
})

if (failed > 0) process.exitCode = 1
else console.log('PASS pwaUpdateToast')
