import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Pins the "a new build is ready" prompt end to end.
//
// The bar itself already existed, but it could never appear on the one client
// that matters most: a shop tab left open all day. index.tsx registered the
// service worker and called registration.update() exactly ONCE per page load,
// so a tab that never navigates never refetched sw.js, the incoming worker
// never reached 'install', BUSINESS_OS_APP_UPDATE_AVAILABLE was never
// broadcast, and the till kept running a stale bundle across deploys with no
// signal to the user at all. The fix is delivery, not chrome: re-ask the
// browser to look, on the cheap signals plus a slow interval.
//
// The invariants below are the ones whose loss brings the silent stale till
// back, or turns a passive prompt into a reload that eats an unfinished sale.

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string => fs.readFileSync(path.join(here, '..', rel), 'utf8')

const index = read('src/index.tsx')
const appUpdate = read('src/utils/appUpdate.ts')
const app = read('src/App.tsx')
const sidebar = read('src/components/navigation/Sidebar.tsx')

// 1. The live registration must be handed to a watcher, not checked once and
//    dropped on the floor.
assert.match(
  index,
  /watchForNewAppShell\(registration\)/,
  'index.tsx must hand the live registration to watchForNewAppShell',
)
assert.ok(
  index.indexOf('watchForNewAppShell(registration)') > index.indexOf("register('/sw.js'"),
  'the watcher must be armed with the registration returned by register()',
)

// 2. All three re-check triggers must survive. Dropping any one reintroduces a
//    class of client that never learns about a deploy: the interval covers a
//    tab nobody touches, visibilitychange covers a tab returned to after
//    hours, online covers a deploy that shipped while the till was offline.
assert.match(index, /window\.setInterval\(/, 'a periodic re-check must exist for an untouched tab')
assert.match(index, /SERVICE_WORKER_UPDATE_POLL_MS/, 'the poll interval must stay a named constant')
assert.match(index, /addEventListener\('visibilitychange'/, 'returning to the tab must re-check')
assert.match(index, /addEventListener\('online'/, 'reconnecting must re-check')

// 3. The interval must skip a hidden tab, and no check may run while offline --
//    an offline till would otherwise burn a failing fetch on every tick.
assert.match(index, /visibilityState === 'hidden'\) return/, 'the interval must skip a hidden tab')
assert.match(index, /navigator\.onLine === false\) return/, 'no update check may run while offline')

// 4. Rapid tab-switching must not hammer the network.
assert.match(index, /SERVICE_WORKER_UPDATE_MIN_GAP_MS/, 'event-driven checks must respect a minimum gap')

// 5. THE SAFETY INVARIANT: noticing an update must never reload the page or
//    activate the waiting worker. Only the user pressing Restart now may do
//    that, and only through the guarded shared path.
const watcherStart = index.indexOf('function watchForNewAppShell')
const watcherEnd = index.indexOf('function registerOfflineAppShell')
assert.ok(watcherStart >= 0 && watcherEnd > watcherStart, 'watchForNewAppShell must precede registerOfflineAppShell')
const watcher = index.slice(watcherStart, watcherEnd)
assert.doesNotMatch(
  watcher,
  /location\.reload|location\.href\s*=|skipWaiting|SKIP_WAITING/,
  'the update watcher must never reload or activate a worker on its own',
)

// 6. One restart path, shared by the top bar and the manual menu item, so the
//    unsaved-work guard cannot drift apart between them.
assert.match(app, /restartIntoLatestApp/, 'the top-bar prompt must restart through the shared path')
assert.match(sidebar, /restartIntoLatestApp/, 'the manual menu item must use the same shared path')
assert.match(app, /function AppUpdateBanner\(/, 'the top-bar update prompt must exist')

// 7. The shared restart must keep guarding unfinished work before it reloads.
assert.match(appUpdate, /hasDirtyWork\(\)/, 'restart must refuse to discard unfinished work')
assert.match(appUpdate, /flushPendingWorkDrafts\(\)/, 'restart must persist drafts first')
assert.match(appUpdate, /BUSINESS_OS_SKIP_WAITING/, 'restart must activate the waiting worker')

// 8. The signal the bar depends on must keep being broadcast by the worker and
//    re-dispatched to the window, buffered so a consumer that mounts later
//    still sees an update that already fired.
assert.match(
  read('src/public-runtime/service-worker.ts'),
  /BUSINESS_OS_APP_UPDATE_AVAILABLE/,
  'the service worker must keep broadcasting the update event',
)
assert.match(read('src/web-api.ts'), /sync:app-update-available/, 'the client must re-dispatch the update event to the window')
assert.match(read('src/web-api.ts'), /pendingAppUpdateDetail/, 'a fired update must stay buffered for a later consumer')

// 9. The PUBLIC CATALOG must not offer the admin app-update prompt. A
//    storefront visitor is not running the till: "Restart now", and a guard
//    message about saving unfinished work, mean nothing to them. Pins the
//    isPublicCatalogRoute early-return specifically, not the whole file --
//    the banner is still correct on every admin branch below it.
{
  const at = app.indexOf('if (isPublicCatalogRoute) {')
  assert.ok(at > 0, 'the public-catalog early return moved or was renamed')
  const nextBranch = app.indexOf('storedAuthSessionPending', at)
  assert.ok(nextBranch > at, 'could not find the end of the public-catalog branch')
  const branch = app.slice(at, nextBranch)
  assert.ok(
    !/<AppUpdateBanner/.test(branch),
    'the public catalog route renders the admin app-update banner',
  )
  assert.ok(branch.includes('<PublicCatalogView />'), 'the public catalog must still render')
}
console.log('appUpdatePrompt.test.ts OK')
