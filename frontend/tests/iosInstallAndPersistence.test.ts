import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Locks the four iOS-PWA foolproofing gaps C5 / G5 / B9 / G10.
//
// The owner's rule (2026-09-14) is "for iOS PWA, I just want to make it more
// foolproof as iOS seems to be very bad for PWA". Every assertion below names
// the WRONG implementation it catches, because each of these regressions is
// invisible on the desktop browser this repo is developed in: they only show
// up on a real iPhone, days later, as a missing sale.

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string => fs.readFileSync(path.join(here, '..', rel), 'utf8')
const readJson = (rel: string): Record<string, string> => JSON.parse(read(rel)) as Record<string, string>

// Some assertions below say "this token must NOT appear". Those must read the
// CODE, not the prose: this repo documents what a file used to do and why it
// stopped, so `window.alert(` and the word "collapsed" both legitimately live
// in comments explaining the very defect being asserted against. Stripping
// block comments and whole-line `//` comments (never a trailing one, which
// could sit inside a URL) is enough for that, and leaves string literals and
// every line of real code untouched.
const stripComments = (source: string): string => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('//'))
  .join('\n')

const app = read('src/App.tsx')
const appContext = read('src/AppContext.tsx')
const appUpdate = read('src/utils/appUpdate.ts')
const standaloneNavigation = read('src/utils/standaloneNavigation.ts')
const standaloneDisplay = read('src/utils/standaloneDisplay.ts')
const installHint = read('src/components/shared/IosInstallHint.tsx')
const en = readJson('src/lang/en.json')
const km = readJson('src/lang/km.json')

let failed = 0
function check(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// --- C5: persistent storage is requested at BOOT, once, and never before login

check('C5 persistent storage is requested from the AppContext boot path', () => {
  // CATCHES: the shipped-before implementation, where the ONLY caller was
  // api/saleWriteTransport.ts at the moment a sale was already being queued
  // offline. By then iOS may already have evicted the store the sale is
  // about to be written into.
  assert.match(
    appContext,
    /import \{ requestPersistentAppStorage \} from '\.\/api\/syncRuntime\.ts'/,
    'AppContext must call requestPersistentAppStorage itself, not leave it to the sale path',
  )
  assert.match(appContext, /void requestPersistentAppStorage\(\)\.then\(/, 'the boot path must actually invoke it')
})

check('C5 the request is gated on an authenticated actor, not on mount', () => {
  // CATCHES: calling persist() from a bare useEffect(..., []) or from module
  // scope, which fires it on the LOGIN screen and on the public storefront --
  // a permission-shaped prompt to somebody with no offline vault to protect.
  const at = appContext.indexOf('void requestPersistentAppStorage()')
  assert.ok(at > 0, 'the persistent-storage request moved or was renamed')
  const effect = appContext.slice(appContext.lastIndexOf('useEffect(', at), at)
  assert.match(effect, /user\?\.id == null \? null : Number\(user\.id\)/, 'the effect must read the signed-in actor id')
  assert.match(effect, /if \(actorId == null \|\| !Number\.isFinite\(actorId\)\)/, 'no actor must mean no request')
})

check('C5 the request happens once per session and is cleared on sign-out', () => {
  // CATCHES (a) dropping the ref guard, which re-asks on every render of a
  // signed-in shell; (b) leaving `storagePersisted` behind at sign-out, which
  // on a device shared by several staff shows the PREVIOUS cashier's answer
  // to the next one before their own session has been measured.
  assert.match(appContext, /persistentStorageAskedForRef\.current === actorId\) return undefined/, 'once per session')
  assert.match(appContext, /persistentStorageAskedForRef\.current = null\s*\n\s*setStoragePersisted\(null\)/, 'sign-out must clear both the ref and the answer')
})

check('C5 the eviction band needs persisted === false AND a non-empty outbox', () => {
  // CATCHES the two independently wrong bands: one that fires on
  // `!storagePersisted` (so `null`, meaning "not asked yet", flashes a
  // warning on every single boot), and one that ignores the outbox (so a
  // till with nothing queued carries a permanent scare it cannot act on).
  const at = app.indexOf('function StorageEvictionBand(')
  assert.ok(at > 0, 'StorageEvictionBand moved or was renamed')
  const body = app.slice(at, app.indexOf('\n}', at))
  assert.match(
    body,
    /if \(storagePersisted !== false \|\| pending <= 0 \|\| dismissed\) return null/,
    'both conditions must gate the band, and `null` must stay silent',
  )
  assert.match(body, /Number\(pendingSync\?\.total \|\| 0\)/, 'the outbox count must be the shared pendingSync total')
})

check('C5 the band explains the fix behind an InfoHint, not as inline prose', () => {
  // CATCHES growing a fixed band into a paragraph the user must read past to
  // get back to work -- the project's density rule.
  const at = app.indexOf('function StorageEvictionBand(')
  const body = app.slice(at, app.indexOf('\n}', at))
  assert.match(body, /<InfoHint/, 'the how-to-fix belongs behind an InfoHint')
  assert.match(body, /storage_eviction_detail/, 'the InfoHint must carry the detail key')
})

check('C5 the bottom advisory stack clears the mobile bottom nav', () => {
  // CATCHES the exact defect measured on rc/p2-9-pwa (394919ba) at 375x812:
  // a band pinned at bottom-0 covered the 57px bottom nav and made every nav
  // destination untappable. The stack's offset must be the SAME measurement
  // <main> already carries as its bottom padding -- not a second guess.
  const stackOffset = /bottom-\[calc\(([^\]]+?)\+env\(safe-area-inset-bottom\)\)\]/.exec(app)
  const mainPadding = /pb-\[calc\(([^\]]+?)\+env\(safe-area-inset-bottom\)\)\]/.exec(app)
  assert.ok(stackOffset, 'the bottom stack must declare a calc() clearance')
  assert.ok(mainPadding, "<main>'s bottom padding moved or was renamed")
  assert.equal(
    stackOffset[1],
    mainPadding[1],
    'the advisory stack and <main> must reserve the same height for the bottom nav',
  )
})

// --- G5: the install affordance -------------------------------------------

check('G5 the install hint is excluded from the public storefront', () => {
  // CATCHES mounting IosInstallHint above the isPublicCatalogRoute early
  // return, which would push an admin-app install nudge at every shopper.
  const at = app.indexOf('if (isPublicCatalogRoute) {')
  assert.ok(at > 0, 'the public-catalog early return moved or was renamed')
  const branch = app.slice(at, app.indexOf('storedAuthSessionPending', at))
  assert.ok(!branch.includes('<IosInstallHint'), 'the public catalog must not render the install hint')
  assert.ok(app.indexOf('<IosInstallHint />') > at, 'the hint must be mounted below the storefront branch')
})

check('G5 the install hint is excluded from standalone mode and from desktop', () => {
  // CATCHES (a) offering "Add to Home Screen" to somebody already running the
  // home-screen app; (b) showing an Install button on desktop Chrome, which
  // fires beforeinstallprompt too but is not what the owner's iOS rule is
  // about.
  assert.match(standaloneNavigation, /if \(isStandaloneDisplayMode\(\)\) return false/, 'the iOS hint must bail in standalone')
  assert.match(installHint, /if \(!isHandheldInstallTarget\(\)\) return undefined/, 'neither half may run on desktop')
})

check('G5 only Mobile Safari on a real iOS device gets the Share hint', () => {
  // CATCHES telling a Chrome-for-iOS user to tap Share -> Add to Home Screen,
  // which that browser cannot do, and catches showing it on a real Mac after
  // iPadOS 13+ started reporting itself as "Macintosh".
  assert.match(standaloneNavigation, /CriOS\|FxiOS\|EdgiOS\|OPiOS/, 'other iOS browsers must be excluded')
  assert.match(standaloneNavigation, /Macintosh\/\.test\(userAgent\) && maxTouchPoints > 1/, 'iPadOS must be separated from a real Mac by touch points')
})

check('G5 the install hint renders its real content from first paint', () => {
  // CATCHES the forbidden "minimized stub that expands once a prerequisite is
  // answered" shape. The component has exactly two real renders plus null.
  assert.ok(!/collapsed|minimi[sz]ed/i.test(stripComments(installHint)), 'the band must not have a collapsed stub state')
  assert.match(installHint, /t\('ios_install_hint'\)/, 'the visible line must be the real hint text')
})

check('G5 the dismissal is a versioned, device-scoped, snoozed key', () => {
  // CATCHES (a) an unversioned key that cannot be migrated later; (b) a
  // permanent "never show again", which leaves a till that is still not
  // installed two weeks later with no nudge at all.
  assert.match(standaloneNavigation, /ios-install-hint-dismissed-at-v1/, 'the storage key must be versioned')
  // Catches: a logout wiping the device-scoped snooze. clearStorage() deletes
  // every businessos_* key it does not explicitly preserve, so the key has to
  // be on the preserve list or the hint returns at the next cashier's sign-in.
  const clientRuntime = read('src/platform/runtime/clientRuntime.ts')
  assert.match(clientRuntime, /localPreserveKeys\.add\(`\$\{STORAGE_KEYS\.DEVICE_SETTINGS\}:ios-install-hint-dismissed-at-v1`\)/, 'the snooze key must survive logout')
  assert.match(standaloneNavigation, /IOS_INSTALL_HINT_SNOOZE_MS = 14 \* 24 \* 60 \* 60 \* 1000/, 'the snooze must be 14 days')
  assert.match(standaloneNavigation, /if \(!stored \|\| !Number\.isFinite\(raw\) \|\| raw <= 0\) return 0/, 'a malformed or old value must fall back silently')
})

// --- B9: the standalone external-link guard -------------------------------

check('B9 the link guard is installed exactly once, and torn down', () => {
  // CATCHES (a) attaching a second document listener on every render, which
  // would double-handle every click in the app; (b) calling it from inside a
  // component body instead of an effect, which leaks a listener per render.
  assert.match(standaloneNavigation, /if \(externalLinkGuardInstalled\) return \(\) => \{\}/, 'a second call must not attach a second listener')
  assert.match(standaloneNavigation, /document\.removeEventListener\('click', handleStandaloneAnchorClick, true\)/, 'the guard must be removable')
  assert.match(app, /const stopExternalLinkGuard = installStandaloneExternalLinkGuard\(\)/, 'App must keep the teardown')
  assert.match(app, /stopExternalLinkGuard\(\)/, 'App must run the teardown on unmount')
  assert.equal(
    (app.match(/installStandaloneExternalLinkGuard\(\)/g) || []).length,
    1,
    'the guard must be called from exactly one place',
  )
})

check('B9 the beforeinstallprompt capture is installed once and torn down', () => {
  // CATCHES the same leak on the other listener pair: a re-registration per
  // render means N preventDefault handlers racing for one single-use event.
  assert.match(standaloneNavigation, /if \(typeof window === 'undefined' \|\| installCaptureInstalled\) return \(\) => \{\}/, 'idempotent capture')
  assert.match(standaloneNavigation, /window\.removeEventListener\('beforeinstallprompt', handleBeforeInstallPrompt\)/, 'the capture must be removable')
  assert.match(app, /const stopInstallPromptCapture = installBeforeInstallPromptCapture\(\)/, 'App must keep the teardown')
})

const { isSameOriginNewTabLink } = await import('../src/utils/standaloneNavigation.ts')

check('B9 only a same-origin _blank link is rewritten', () => {
  // A REAL behavioural check, not a grep: these are inputs on which the right
  // and wrong implementations disagree.
  //
  // CATCHES (a) rewriting cross-origin links, which would replace the
  // installed window with somebody else's page and remove the only way back;
  // (b) rewriting every same-origin link rather than only _blank ones, which
  // would break ordinary in-app navigation; (c) following a javascript: or
  // mailto: href into window.location.assign.
  const base = 'https://shop.example.com/admin'
  assert.equal(isSameOriginNewTabLink('https://shop.example.com/portal', '_blank', base), true, 'same-origin _blank is the case to rewrite')
  assert.equal(isSameOriginNewTabLink('/portal', '_blank', base), true, 'a relative _blank href is same-origin')
  assert.equal(isSameOriginNewTabLink('https://maps.google.com/x', '_blank', base), false, 'cross-origin must be left to the browser')
  assert.equal(isSameOriginNewTabLink('https://shop.example.com/portal', '', base), false, 'an ordinary same-origin link must not be touched')
  assert.equal(isSameOriginNewTabLink('mailto:a@b.c', '_blank', base), false, 'non-http(s) schemes must be left alone')
  assert.equal(isSameOriginNewTabLink('javascript:alert(1)', '_blank', base), false, 'javascript: must never reach location.assign')
  assert.equal(isSameOriginNewTabLink('http://[bad', '_blank', base), false, 'an unparseable href must not throw')
})

check('B9 standaloneDisplay checks BOTH signals', () => {
  // CATCHES checking only the display-mode media query (iOS never implemented
  // it for home-screen apps, so every iPhone reports "browser tab") or only
  // navigator.standalone (which Android and desktop never implemented).
  assert.match(standaloneDisplay, /\.standalone === true/, 'the iOS signal must be checked')
  assert.match(standaloneDisplay, /'\(display-mode: standalone\)'/, 'the Android/desktop signal must be checked')
  assert.match(standaloneDisplay, /typeof window === 'undefined'\) return false/, 'it must be safe outside a browser')
})

// --- G10: no blocking alert on the restart guard --------------------------

check('G10 appUpdate no longer uses window.alert', () => {
  // CATCHES the blocking native dialog: on an installed iOS PWA it is a
  // system sheet over a chromeless window that freezes the render loop, and
  // it is the inconsistent native popup this project replaced everywhere
  // else with its own notice surfaces.
  assert.ok(!stripComments(appUpdate).includes('window.alert('), 'window.alert must not come back to appUpdate.ts')
})

check('G10 the restart still REFUSES while there is unfinished work', () => {
  // CATCHES "fixing" the alert by deleting the guard with it, which would let
  // a restart discard an in-progress sale.
  assert.match(appUpdate, /if \(hasDirtyWork\(\)\) \{/, 'the dirty-work guard must survive')
  assert.match(appUpdate, /flushPendingWorkDrafts\(\)/, 'drafts must still be flushed before refusing')
  const at = appUpdate.indexOf('if (hasDirtyWork()) {')
  const branch = appUpdate.slice(at, appUpdate.indexOf('\n  }', at))
  assert.match(branch, /return 'blocked'/, 'the guarded branch must still return blocked')
})

check('G10 the refusal reaches the user through the shell notice, never silently', () => {
  // CATCHES removing the alert and replacing it with nothing, which turns
  // "Restart now" into a dead button, and catches wiring the notice at only
  // ONE of the two call sites (the sidebar's manual update action is not
  // edited by this lane and must get the same treatment).
  assert.match(appUpdate, /unsavedWorkNotice\(message\)/, 'the message must be handed to the registered notice')
  assert.match(appUpdate, /console\.warn\(`\[app-update\] restart blocked/, 'an unregistered notice must still leave a trace')
  assert.match(app, /setAppUpdateUnsavedWorkNotice\(\(message\) => notify\(message, 'warning', 6000\)\)/, 'the shell must register its own notice')
  assert.match(app, /return \(\) => setAppUpdateUnsavedWorkNotice\(null\)/, 'and unregister it on unmount')
  assert.match(read('src/components/navigation/Sidebar.tsx'), /restartIntoLatestApp/, 'the sidebar must still share the one restart path')
})

// --- both language packs --------------------------------------------------

check('both packs carry every new key, with real Khmer', () => {
  // CATCHES the recurring half-translation: an English placeholder parked in
  // km.json, or a key added to one pack only.
  const keys = [
    'storage_eviction_title',
    'storage_eviction_detail',
    'install_app',
    'ios_install_hint',
    'ios_install_hint_detail',
  ]
  for (const key of keys) {
    assert.equal(typeof en[key], 'string', `en.json is missing ${key}`)
    assert.equal(typeof km[key], 'string', `km.json is missing ${key}`)
    assert.ok(String(en[key]).trim().length > 0, `en.json has a blank ${key}`)
    assert.ok(String(km[key]).trim().length > 0, `km.json has a blank ${key}`)
    assert.notEqual(km[key], en[key], `km.json falls back to the English string for ${key}`)
    assert.match(String(km[key]), /[ក-៿]/, `km.json has no Khmer script in ${key}`)
  }
})

check('each new key is defined exactly once in each pack', () => {
  // CATCHES the duplicate-top-level-key merge shape: two lanes add the same
  // key at different offsets, git merges both cleanly and JSON.parse silently
  // keeps only the last one.
  const rawEn = read('src/lang/en.json')
  const rawKm = read('src/lang/km.json')
  for (const key of ['storage_eviction_title', 'storage_eviction_detail', 'install_app', 'ios_install_hint', 'ios_install_hint_detail']) {
    const pattern = new RegExp(`"${key}":`, 'g')
    assert.equal((rawEn.match(pattern) || []).length, 1, `en.json defines ${key} more than once`)
    assert.equal((rawKm.match(pattern) || []).length, 1, `km.json defines ${key} more than once`)
  }
})

if (failed > 0) {
  console.error(`iosInstallAndPersistence.test.ts: ${failed} failing check(s)`)
  process.exit(1)
}
console.log('iosInstallAndPersistence.test.ts OK')
