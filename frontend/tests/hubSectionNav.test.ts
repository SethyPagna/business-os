import assert from 'node:assert/strict'
import fs from 'node:fs'
import './hubResponsiveRemount.test.ts'
import {
  DEFAULT_MOBILE_SECTION_NAV_MODE,
  MOBILE_SECTION_NAV_SETTINGS_KEY,
  MOBILE_SECTION_NAV_STORAGE_KEY,
  readMobileSectionNavMode,
  writeMobileSectionNavMode,
  subscribeMobileSectionNavMode,
} from '../src/utils/sectionNavPreference.ts'

// Gate 1 audit, Area 5: five "hub" pages (Branches, Sales, Settings,
// Contacts, Promotions) each used to hand-roll their own near-identical
// chip-row tab UI. This source-scan test verifies every one of them was
// actually migrated onto the shared HubSectionNav switcher -- not just
// that HubSectionNav exists -- and that the old per-page markup it
// replaces is really gone (a page could import HubSectionNav for one
// section while leaving a second, hand-rolled row behind).

type HubPageCheck = {
  label: string
  path: string
  // A string that appears ONLY in the old hand-rolled chip row this page
  // used before migrating -- confirmed absent from the post-migration
  // source via `git show <migration commit>` for the removed lines, then
  // re-confirmed absent from the current file. Different per page because
  // each one hand-rolled its own markup/variable names.
  staleMarker: string
  staleLabel: string
}

const HUB_PAGES: HubPageCheck[] = [
  {
    label: 'BranchesHubPage',
    path: '../src/components/branches/BranchesHubPage.tsx',
    staleMarker: 'visibleTabs.map',
    staleLabel: 'the old hand-rolled visibleTabs.map(...) chip row',
  },
  {
    label: 'SalesHubPage',
    path: '../src/components/sales/SalesHubPage.tsx',
    staleMarker: 'visibleTabs.map',
    staleLabel: 'the old hand-rolled visibleTabs.map(...) chip row',
  },
  {
    label: 'SettingsHubPage',
    path: '../src/components/utils-settings/SettingsHubPage.tsx',
    staleMarker: 'visibleTabs.map',
    staleLabel: 'the old hand-rolled visibleTabs.map(...) chip row',
  },
  {
    label: 'Contacts',
    path: '../src/components/contacts/Contacts.tsx',
    staleMarker: 'border-b-2',
    staleLabel: "the old underline-style tab row (border-b-2 active state)",
  },
  {
    label: 'PromotionsPage',
    path: '../src/components/promotions/PromotionsPage.tsx',
    staleMarker: 'sectionChips',
    staleLabel: 'the old sectionChips/SectionChip chip-row array',
  },
]

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

for (const page of HUB_PAGES) {
  const source = fs.readFileSync(new URL(page.path, import.meta.url), 'utf8')

  await runTest(`${page.label} imports and renders HubSectionNav`, () => {
    assert.match(
      source,
      /import\s+HubSectionNav[,\s]/,
      `${page.label} should import HubSectionNav from the shared component`,
    )
    assert.match(
      source,
      /<HubSectionNav\b/,
      `${page.label} should render <HubSectionNav ... />`,
    )
  })

  await runTest(`${page.label} no longer contains ${page.staleLabel}`, () => {
    assert.doesNotMatch(
      source,
      new RegExp(page.staleMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `${page.label} should not still contain ${page.staleLabel} (${page.staleMarker})`,
    )
  })
}

await runTest('mobile section-nav preference defaults to "pages" with no stored/account value', () => {
  // No `window` in this Node test environment, so readMobileSectionNavMode
  // falls straight through the localStorage branch to the account-value /
  // hardcoded-default branch -- exactly the "brand new device, no
  // preference saved anywhere yet" case this default exists for.
  assert.equal(DEFAULT_MOBILE_SECTION_NAV_MODE, 'pages')
  assert.equal(readMobileSectionNavMode(), 'pages')
  assert.equal(readMobileSectionNavMode(undefined), 'pages')
  assert.equal(readMobileSectionNavMode('not-a-real-mode'), 'pages')
})

await runTest('mobile section-nav preference recognizes an explicit "sections" account value', () => {
  assert.equal(readMobileSectionNavMode('sections'), 'sections')
})

await runTest('mobile section-nav preference constants are stable (host pages / Settings.tsx key off these)', () => {
  assert.equal(MOBILE_SECTION_NAV_STORAGE_KEY, 'bos:ui:mobile-section-nav')
  assert.equal(MOBILE_SECTION_NAV_SETTINGS_KEY, 'ui_mobile_section_nav')
})

await runTest('mobile body has no intermediate picker or extra history, legacy pills remain touch-safe', () => {
  const navSource = fs.readFileSync(new URL('../src/components/shared/HubSectionNav.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(navSource, /pushState|history.back|hub-section-grid|HUB_HISTORY_MARKER/)
  assert.match(navSource, /if \(layered \|\| visible.length <= 1\) return <>{content}<\/>/)
  assert.match(navSource, /hub-section-pills[^"']*flex-wrap/)
  assert.match(navSource, /hub-section-pill[^"']*min-h-11/)
  assert.match(navSource, /aria-pressed=\{isActive\}/)
  const sidebar = fs.readFileSync(new URL('../src/components/navigation/Sidebar.tsx', import.meta.url), 'utf8')
  assert.match(sidebar, /mobileGroupAction/)
  assert.match(sidebar, /navigateTo\(entry.ownerId, hubAnchor\(entry.ownerId, section.id\)\)/)
  assert.match(sidebar, /col-span-2 grid min-w-0 grid-cols-2/)
})

await runTest('pages mode uses one compact header and its inline group drawer without legacy bottom chrome', () => {
  const sidebar = fs.readFileSync(new URL('../src/components/navigation/Sidebar.tsx', import.meta.url), 'utf8')
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const imports = fs.readFileSync(new URL('../src/components/shared/BackgroundImportTracker.tsx', import.meta.url), 'utf8')
  const notes = fs.readFileSync(new URL('../src/components/shared/NotesWidget.tsx', import.meta.url), 'utf8')

  assert.match(sidebar, /\{!inline \? \(\s*<nav className="safe-area-inset-bottom fixed bottom-0/, 'legacy bottom navigation should render only outside pages mode')
  assert.match(sidebar, /inline \? 'bottom-0 pb-\[env\(safe-area-inset-bottom\)\]' : 'bottom-\[calc\(3\.55rem\+env\(safe-area-inset-bottom\)\)\]'/, 'pages drawer should reclaim the bottom safe area while legacy keeps its nav offset')
  assert.doesNotMatch(sidebar, /h-28|7rem|flex-wrap content-center gap-y-1/, 'pages mode should not force a second header row')
  assert.match(sidebar, /mobileTitle[\s\S]*?truncate text-sm font-semibold/, 'one-row pages title should stay readable without overflowing')
  assert.match(sidebar, /inline \? null : \([\s\S]*?<MinimizedWorkTray variant="mobile"/, 'wide minimized-work chips should leave the one-row pages header')
  assert.match(sidebar, /\{notificationSlot\}\s*\{showQuickPreferences \? \([\s\S]*?<QuickPreferenceToggles \/>[\s\S]*?<div className="relative z-50/, 'theme and language controls should stay directly in the one-row header between notification and account')
  assert.match(sidebar, /\{inline \? \(\s*<div className="[^"]*\[&>div\]:flex-wrap[^"]*">[\s\S]*?<MinimizedWorkTray variant="mobile"/, 'pages-mode minimized work should remain reachable in the account panel and wrap without horizontal overflow')
  assert.doesNotMatch(sidebar, /\{inline \? \(\s*<div className="mb-1[\s\S]*?<MinimizedWorkTray variant="mobile"[\s\S]*?<QuickPreferenceToggles/, 'pages-mode account panel should not hide duplicate theme or language controls')

  assert.match(app, /inlineMobileNavigation \? 'pb-\[env\(safe-area-inset-bottom\)\]' : 'pb-\[calc\(3\.55rem\+env\(safe-area-inset-bottom\)\)\]'/, 'pages mode should not reserve phantom bottom-nav space')
  assert.doesNotMatch(app, /pt-28|7rem/, 'main content should reserve only the one-row header height')
  assert.match(app, /<GlobalScrollControls mobileBottomNavVisible=\{!inlineMobileNavigation\} \/>/, 'global floating scroll controls should share the existing mode decision')

  for (const [name, source] of [['import tracker', imports], ['notes widget', notes]] as const) {
    assert.match(source, /useMobileSectionNavMode\(settings\?\.ui_mobile_section_nav\)/, `${name} should consume the shared mode provider`)
    assert.match(source, /pagesNavigation \? 'bottom-\[calc\(0\.75rem\+env\(safe-area-inset-bottom\)\)\]' : 'bottom-\[calc\(4\.5rem\+env\(safe-area-inset-bottom\)\)\]'/, `${name} should clear only the pages-mode bottom-nav offset`)
  }
})

await runTest('Review & Logs participates in shared section navigation', () => {
  const source = fs.readFileSync(new URL('../src/components/review/ReviewLogsPage.tsx', import.meta.url), 'utf8')
  assert.match(source, /<HubSectionNav/)
  assert.match(source, /useHubSection<ReviewLogsSection>/)
  assert.match(source, /desktopNavigation=/, 'its original desktop switcher remains available only on desktop')
})

await runTest('preference immediately notifies every consumer and survives blocked storage', () => {
  const events = new EventTarget()
  const values = new Map<string, string>()
  let blocked = false
  let quotaExceeded = false
  const fakeWindow = Object.assign(events, {
    localStorage: {
      getItem: (key: string) => { if (blocked) throw new Error('storage blocked'); return values.get(key) ?? null },
      setItem: (key: string, value: string) => { if (blocked || quotaExceeded) throw new Error('storage blocked'); values.set(key, value) },
    },
  })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow })
  let first = 0, second = 0
  const offFirst = subscribeMobileSectionNavMode(() => first++)
  const offSecond = subscribeMobileSectionNavMode(() => second++)
  try {
    writeMobileSectionNavMode('sections')
    assert.equal(readMobileSectionNavMode('pages'), 'sections')
    assert.deepEqual([first, second], [1, 1])
    blocked = true
    writeMobileSectionNavMode('pages')
    assert.equal(readMobileSectionNavMode('sections'), 'pages')
    assert.deepEqual([first, second], [2, 2])
    blocked = false
    values.set(MOBILE_SECTION_NAV_STORAGE_KEY, 'sections')
    fakeWindow.dispatchEvent(Object.assign(new Event('storage'), { key: MOBILE_SECTION_NAV_STORAGE_KEY }))
    assert.equal(readMobileSectionNavMode(), 'sections')
    assert.deepEqual([first, second], [3, 3])
    values.clear()
    fakeWindow.dispatchEvent(Object.assign(new Event('storage'), { key: null }))
    assert.equal(readMobileSectionNavMode('pages'), 'pages')
    offFirst()
    quotaExceeded = true
    writeMobileSectionNavMode('sections')
    assert.equal(readMobileSectionNavMode('pages'), 'sections', 'a failed write must override successful but stale reads in memory')
    assert.deepEqual([first, second], [4, 5])
  } finally {
    offFirst(); offSecond()
    Reflect.deleteProperty(globalThis, 'window')
  }
})

// i18n coverage: every hub-section description key (fed to HubSectionNav's
// `description` field) and every Settings -> Appearance "Mobile navigation"
// control key must exist in BOTH lang packs, or verify:i18n's own
// unresolved-key check would already fail this on the affected page --
// this test instead pins the exact key LIST this feature owns, so a future
// edit that silently drops one from a pack (without also removing every
// t('key') call) is caught here even if some other unrelated fallback
// happens to mask it from verify:i18n.
const HUB_DESC_KEYS = [
  'hub_desc_branches_overview',
  'hub_desc_branches_inventory',
  'hub_desc_branches_transfers',
  'hub_desc_branches_rfid',
  'hub_desc_sales_sales',
  'hub_desc_sales_returns',
  'hub_desc_sales_fees',
  'hub_desc_sales_reports',
  'hub_desc_settings_settings',
  'hub_desc_settings_users',
  'hub_desc_settings_backup',
  'hub_desc_contacts_customers',
  'hub_desc_contacts_suppliers',
  'hub_desc_contacts_delivery',
  'hub_desc_contacts_duplicates',
  'hub_desc_promotions_rules',
  'hub_desc_promotions_discounts',
  'hub_desc_promotions_loyalty',
]

const MOBILE_NAV_PREFERENCE_KEYS = [
  'mobile_section_nav_title',
  'mobile_section_nav_hint',
  'mobile_section_nav_mode_pages',
]

const enPack = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, unknown>
const kmPack = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, unknown>

await runTest('every hub-section description key exists in both lang packs', () => {
  for (const key of HUB_DESC_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(enPack, key), `en.json is missing "${key}"`)
    assert.ok(Object.prototype.hasOwnProperty.call(kmPack, key), `km.json is missing "${key}"`)
    assert.equal(typeof enPack[key], 'string', `en.json "${key}" should be a string`)
    assert.equal(typeof kmPack[key], 'string', `km.json "${key}" should be a string`)
  }
})

await runTest('every mobile-navigation preference key exists in both lang packs', () => {
  for (const key of MOBILE_NAV_PREFERENCE_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(enPack, key), `en.json is missing "${key}"`)
    assert.ok(Object.prototype.hasOwnProperty.call(kmPack, key), `km.json is missing "${key}"`)
    assert.equal(typeof enPack[key], 'string', `en.json "${key}" should be a string`)
    assert.equal(typeof kmPack[key], 'string', `km.json "${key}" should be a string`)
  }
  // The "Sections" toggle option reuses the pre-existing shared `sections`
  // key (chip-row caption) rather than adding a duplicate -- confirm that
  // key is still there for both packs to actually resolve against.
  assert.ok(Object.prototype.hasOwnProperty.call(enPack, 'sections'), 'en.json is missing "sections"')
  assert.ok(Object.prototype.hasOwnProperty.call(kmPack, 'sections'), 'km.json is missing "sections"')
})

await runTest('Settings.tsx wires the Mobile navigation control to both the instant and persisted paths', () => {
  const settingsSource = fs.readFileSync(new URL('../src/components/utils-settings/Settings.tsx', import.meta.url), 'utf8')
  assert.match(settingsSource, /writeMobileSectionNavMode\(modeValue\)/, 'Settings.tsx should call writeMobileSectionNavMode for the instant, per-device effect')
  assert.match(settingsSource, /setValue\(MOBILE_SECTION_NAV_SETTINGS_KEY,\s*modeValue\)/, 'Settings.tsx should call setValue(...) to persist the choice via the existing save flow')
  assert.match(settingsSource, /<InfoHint\b/, 'Settings.tsx should explain the Mobile navigation control via InfoHint, not inline prose')
})

if (failed > 0) {
  process.exitCode = 1
}
