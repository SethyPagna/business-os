// Announcement bar, owner ask 2 Nov 2026: one line above the storefront header, English and Khmer, an optional link, an on/off
// switch, optional first/last day; closable per visitor per message version; edited in the Website Editor.
//
// Behaviour inventory (kept): the Announcement STRIP cards (small scrolling promo cards, a different feature), the install notice,
// the section nav, the footer, the Website Editor preview and Save round trip, the cookie policy storage table.
// Plausible wrong implementations this file catches:
//   - the day taken from the device clock or from UTC (a visitor at 01:30 in Phnom Penh is still on yesterday in UTC);
//   - an end day that hides the message ON its last day, or a start day that shows it a day early;
//   - a stored or crafted link (javascript:, data:, //host, /path, credentials) becoming a clickable link;
//   - the text read as HTML;
//   - the dismissal tied to the dates or not tied to the text, or stored without telling the visitor in the cookie policy;
//   - the Khmer page showing an empty bar because only English was written.
//
// Run: node tests/portalAnnouncement.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { mock } from 'node:test'
import { transformSync } from 'esbuild'
import {
  PORTAL_ANNOUNCEMENT_MAX_LENGTH,
  PORTAL_ANNOUNCEMENT_STORAGE_KEY,
  dismissPortalAnnouncement,
  portalAnnouncementInWindow,
  portalAnnouncementIssues,
  portalAnnouncementLink,
  readDismissedPortalAnnouncement,
  resolvePortalAnnouncement,
} from '../src/components/catalog/portalAnnouncement.ts'
import { LEGAL_STORAGE_ROWS } from '../src/components/catalog/legal/legalContent.ts'
import { todayStr } from '../src/utils/dateHelpers.ts'
import * as scriptTypography from '../src/utils/scriptTypography.ts'

const require = createRequire(import.meta.url)
const React = require('react')
const render = require('react-dom/server').renderToStaticMarkup as (node: unknown) => string
const read = (rel: string) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const readJson = (rel: string) => JSON.parse(read(rel)) as Record<string, any>

let failed = 0
function run(name: string, body: () => void): void {
  try {
    body()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const ON = { announcementEnabled: true, announcementTextEn: 'Sample sale this week', announcementTextKm: 'ការលក់ពិសេសសប្តាហ៍នេះ', announcementVersion: 'v1' }

run('switched off, or on with no text, there is no bar', () => {
  assert.equal(resolvePortalAnnouncement({}, 'en', '2026-11-10'), null)
  assert.equal(resolvePortalAnnouncement({ ...ON, announcementEnabled: false }, 'en', '2026-11-10'), null)
  assert.equal(resolvePortalAnnouncement({ ...ON, announcementEnabled: 'true' }, 'en', '2026-11-10'), null, 'only a real boolean true turns it on')
  assert.equal(resolvePortalAnnouncement({ ...ON, announcementTextEn: '  ', announcementTextKm: '' }, 'en', '2026-11-10'), null)
})

run('each language shows its own message and falls back to the other one, never an empty bar', () => {
  assert.deepEqual(resolvePortalAnnouncement(ON, 'en', '2026-11-10'), { text: 'Sample sale this week', textLanguage: 'en', link: '', version: 'v1' })
  assert.deepEqual(resolvePortalAnnouncement(ON, 'km', '2026-11-10'), { text: 'ការលក់ពិសេសសប្តាហ៍នេះ', textLanguage: 'km', link: '', version: 'v1' })
  assert.equal(resolvePortalAnnouncement({ ...ON, announcementTextKm: '' }, 'km', '2026-11-10')?.text, 'Sample sale this week', 'Khmer page, only English written')
  assert.equal(resolvePortalAnnouncement({ ...ON, announcementTextKm: '' }, 'km', '2026-11-10')?.textLanguage, 'en')
  assert.equal(resolvePortalAnnouncement({ ...ON, announcementTextEn: '' }, 'en', '2026-11-10')?.text, 'ការលក់ពិសេសសប្តាហ៍នេះ', 'English page, only Khmer written')
  assert.equal(resolvePortalAnnouncement({ ...ON, announcementTextEn: '' }, 'en', '2026-11-10')?.textLanguage, 'km')
})

run('the first and last day are both included, and an open end means no end', () => {
  const windowed = (today: string, start = '2026-11-10', end = '2026-11-12') => resolvePortalAnnouncement({ ...ON, announcementStart: start, announcementEnd: end }, 'en', today) !== null
  assert.equal(windowed('2026-11-09'), false, 'the day before the start')
  assert.equal(windowed('2026-11-10'), true, 'the start day itself')
  assert.equal(windowed('2026-11-11'), true)
  assert.equal(windowed('2026-11-12'), true, 'the last day itself')
  assert.equal(windowed('2026-11-13'), false, 'the day after the end')
  assert.equal(windowed('2026-11-13', '', ''), true, 'no days at all')
  assert.equal(windowed('2026-11-01', '2026-11-10', ''), false, 'only a start')
  assert.equal(windowed('2030-01-01', '2026-11-10', ''), true, 'only a start, any later day')
  assert.equal(windowed('2030-01-01', '', '2026-11-12'), false, 'only an end')
  assert.equal(portalAnnouncementInWindow('not a day', 'also not', '2026-11-10'), true, 'an unreadable day is no limit rather than a hidden message')
})

run('the preview ignores the days so the owner sees the message while typing', () => {
  const future = { ...ON, announcementStart: '2099-01-01' }
  assert.equal(resolvePortalAnnouncement(future, 'en', '2026-11-10'), null)
  assert.equal(resolvePortalAnnouncement(future, 'en', '2026-11-10', { ignoreDays: true })?.text, 'Sample sale this week')
})

run("the shop's day is the Cambodia day, not the UTC day", () => {
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-09T18:30:00Z') })
  try {
    assert.equal(new Date().toISOString().slice(0, 10), '2026-11-09', 'the UTC day is still the 9th')
    assert.equal(todayStr(), '2026-11-10', 'it is already the 10th in Phnom Penh')
    assert.equal(resolvePortalAnnouncement({ ...ON, announcementStart: '2026-11-10' }, 'en', todayStr())?.text, 'Sample sale this week')
    assert.equal(resolvePortalAnnouncement({ ...ON, announcementEnd: '2026-11-09' }, 'en', todayStr()), null, 'the 9th has already ended there')
  } finally {
    mock.timers.reset()
  }
  const page = read('src/components/catalog/PublicCatalogPage.tsx')
  assert.match(page, /useState\(todayStr\)/, 'the live page takes the day from todayStr')
  assert.doesNotMatch(page, /toISOString\(\)\.slice\(0, 10\)/, 'and never from the UTC date')
})

run('loophole check: only an absolute http(s) link ever becomes a link', () => {
  const bad = [
    'javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x', 'file:///etc/passwd', 'ftp://example.test/x', 'mailto:a@example.test', 'tel:+85512345678',
    '//evil.example/x', '/\\evil.example', '/relative/path', 'relative/path', 'https:example.test', 'http://', 'https://', 'https://user:pass@example.test/', 'https://exa mple.test/',
    `https://example.test/${'a'.repeat(600)}`, null, undefined, 7, ['https://example.test'], { href: 'https://example.test' },
  ]
  for (const link of bad) assert.equal(portalAnnouncementLink(link), '', JSON.stringify(link))
  for (const link of ['https://example.test/a?x=1#top', 'http://example.test', 'https://t.me/sample_shop']) assert.equal(portalAnnouncementLink(link), link, link)
  assert.equal(resolvePortalAnnouncement({ ...ON, announcementLink: 'javascript:alert(1)' }, 'en', '2026-11-10')?.link, '', 'a published bad link still draws no link')
  assert.equal(resolvePortalAnnouncement({ ...ON, announcementLink: 'https://example.test/news' }, 'en', '2026-11-10')?.link, 'https://example.test/news')
})

run('the Website Editor flags the same bad link and a reversed range', () => {
  assert.deepEqual(portalAnnouncementIssues({ link: 'javascript:alert(1)', start: '2026-11-10', end: '2026-11-09' }), { link: true, range: true })
  assert.deepEqual(portalAnnouncementIssues({ link: '/relative', start: '', end: '2026-11-09' }), { link: true, range: false })
  assert.deepEqual(portalAnnouncementIssues({ link: 'https://example.test', start: '2026-11-10', end: '2026-11-10' }), { link: false, range: false })
  assert.deepEqual(portalAnnouncementIssues({ link: '', start: '', end: '' }), { link: false, range: false })
})

run('closing the bar is remembered per message version, in this browser only', () => {
  const store = new Map<string, string>()
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) }
  assert.equal(readDismissedPortalAnnouncement(storage), '')
  dismissPortalAnnouncement('abc', storage)
  assert.equal(store.get(PORTAL_ANNOUNCEMENT_STORAGE_KEY), 'abc')
  assert.equal(readDismissedPortalAnnouncement(storage), 'abc')
  const shown = (version: string) => resolvePortalAnnouncement({ ...ON, announcementVersion: version }, 'en', '2026-11-10')?.version !== readDismissedPortalAnnouncement(storage)
  assert.equal(shown('abc'), false, 'the same message stays closed')
  assert.equal(shown('abd'), true, 'an edited message comes back')
  const page = read('src/components/catalog/PublicCatalogPage.tsx')
  assert.match(page, /found && found\.version !== dismissedAnnouncement \? found : null/)
  const throwing = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  assert.equal(readDismissedPortalAnnouncement(throwing), '')
  assert.doesNotThrow(() => dismissPortalAnnouncement('abc', throwing), 'a blocked storage must not break the page')
  assert.equal(readDismissedPortalAnnouncement(null), '')
})

run('the storage the bar writes is listed in the cookie policy, in both languages', () => {
  const row = LEGAL_STORAGE_ROWS.find((entry) => entry.id === 'announcement')
  assert.ok(row, 'a row for the announcement storage')
  assert.equal(row.name, PORTAL_ANNOUNCEMENT_STORAGE_KEY)
  const legal = read('src/components/catalog/legal/legalContent.ts')
  assert.equal((legal.match(/portal_legal_store_announcement_p:/g) || []).length, 2, 'purpose text in the English and Khmer tables')
  assert.match(legal, /portal_legal_store_announcement_p: '[^']*[\u1780-\u17ff]/, 'and the Khmer one is Khmer')
})

const stripSource = read('src/components/catalog/PortalAnnouncementStrip.tsx')
const strip = (() => {
  const code = transformSync(stripSource, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  const mod = { exports: {} as Record<string, any> }
  new Function('require', 'module', 'exports', code)((id: string) => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id)
    if (id.startsWith('lucide-react/')) return { __esModule: true, default: () => null }
    if (id.endsWith('/scriptTypography.ts')) return scriptTypography
    throw new Error(`PortalAnnouncementStrip.tsx imports ${id}, which this harness does not provide`)
  }, mod, mod.exports)
  return mod.exports.default as (props: Record<string, unknown>) => unknown
})()
const copy = (_key: string, fallback = '', fallbackKm = '') => fallback || fallbackKm
const draw = (announcement: Record<string, unknown>, extra: Record<string, unknown> = {}) => render(React.createElement(strip, { announcement, copy, ...extra }))

run('the message is a text node: markup in it is shown as typed and never runs', () => {
  const hostile = '<img src=x onerror="window.__xss=1"> <b>bold</b> & "quotes"'
  const markup = draw({ text: hostile, textLanguage: 'en', link: '', version: 'v1' })
  assert.ok(!markup.includes('<img'), 'no image element was created')
  assert.ok(!markup.includes('<b>'), 'no bold element was created')
  assert.ok(markup.includes('&lt;img src=x onerror=&quot;window.__xss=1&quot;&gt;'), 'the characters are escaped text')
})

run('a link wraps the message only when there is one, opens a new tab, and is never the dismiss control', () => {
  const plain = draw({ text: 'Sample', textLanguage: 'en', link: '', version: 'v1' })
  assert.ok(!plain.includes('<a '), 'no link without a URL')
  const linked = draw({ text: 'Sample', textLanguage: 'en', link: 'https://example.test/news', version: 'v1' })
  assert.match(linked, /<a href="https:\/\/example\.test\/news" target="_blank" rel="noopener noreferrer"/)
  assert.equal((linked.match(/<a /g) || []).length, 1)
})

run('the dismiss control exists only on the live page, is a button with a translated name, and is a 44px target', () => {
  const live = draw({ text: 'Sample', textLanguage: 'en', link: '', version: 'v1' }, { onDismiss: () => {} })
  assert.match(live, /<button type="button" aria-label="Close announcement" title="Close announcement"[^>]*data-portal-announcement-dismiss="true"[^>]*class="[^"]*h-11 w-11/)
  const preview = draw({ text: 'Sample', textLanguage: 'en', link: '', version: 'v1' })
  assert.ok(!preview.includes('<button'), 'the Website Editor preview has no close button')
  assert.match(preview, /role="region" aria-label="Announcement"/)
  assert.match(preview, /data-portal-announcement="true"/)
})

run('a Khmer message is typeset as Khmer even on an English page, and is not machine-translated', () => {
  const markup = draw({ text: 'ការលក់ពិសេស', textLanguage: 'km', link: '', version: 'v1' })
  assert.match(markup, /lang="km"/)
  assert.match(markup, /translate="no"/)
  assert.match(markup, /khmer-text/)
})

run('structure: the surface draws the bar above the padded page, drops the duplicate safe-area padding, and the live page owns the state', () => {
  const surface = read('src/components/catalog/CatalogPreviewSurface.tsx')
  const barAt = surface.indexOf('<PortalAnnouncementStrip announcement={announcement}')
  const pageAt = surface.indexOf('className={`mx-auto max-w-[1680px]')
  const headerAt = surface.indexOf('<header className="portal-header-shell')
  assert.ok(barAt > 0 && barAt < pageAt && pageAt < headerAt, 'bar, then the padded page, then the header')
  assert.match(surface, /data-\[portal-announcement-shown=true\]:pt-3 sm:data-\[portal-announcement-shown=true\]:pt-4/, 'the bar already clears the notch, so the page below does not pad for it again')
  assert.match(surface, /onHeight=\{publicView \? onAnnouncementHeight : undefined\}/, 'the admin preview never reports a height')
  const page = read('src/components/catalog/PublicCatalogPage.tsx')
  assert.match(page, /announcement=\{announcement\}\s+onDismissAnnouncement=\{dismissAnnouncement\}\s+onAnnouncementHeight=\{setAnnouncementHeight\}/)
  assert.match(page, /style=\{announcementHeight \? \{ top: `calc\(0\.75rem \+ \$\{announcementHeight\}px \+ env\(safe-area-inset-top\)\)` \} : undefined\}/, 'the install notice sits below the bar')
  const editorPage = read('src/components/catalog/CatalogPage.tsx')
  assert.match(editorPage, /announcement=\{resolvePortalAnnouncement\(displayConfig, language, '', \{ ignoreDays: true \}\)\}/)
  assert.doesNotMatch(editorPage, /onDismissAnnouncement/, 'the preview is not closable')
})

run('structure: the six settings round-trip through the draft, the preview config and the Save payload', () => {
  const editorPage = read('src/components/catalog/CatalogPage.tsx')
  for (const [setting, field] of [['enabled', 'Enabled'], ['text_en', 'TextEn'], ['text_km', 'TextKm'], ['link', 'Link'], ['start', 'Start'], ['end', 'End']] as const) {
    assert.match(editorPage, new RegExp(`customer_portal_announcement_${setting}: [^\\n]*config\\.announcement${field}`), `draft ${setting}`)
    assert.match(editorPage, new RegExp(`announcement${field}: [^\\n]*draft\\.customer_portal_announcement_${setting}`), `preview ${setting}`)
    assert.match(editorPage, new RegExp(`customer_portal_announcement_${setting}: [^\\n]*editorDraft\\.customer_portal_announcement_${setting}`), `save ${setting}`)
  }
  assert.match(editorPage, /announcementTextEn: typeof draft\.customer_portal_announcement_text_en === 'string'/, 'clearing a field clears the preview (not `||`)')
})

run('structure: the editor card is behind the portal-config grant, with a typed date field and flagged issues', () => {
  const editor = read('src/components/catalog/CatalogEditorSurface.tsx')
  const card = editor.slice(editor.indexOf('data-testid="portal-announcement-card"') - 40, editor.indexOf('data-testid="portal-range-issue"') > 0 ? undefined : editor.indexOf('portal-announcement-range-issue') + 400)
  assert.match(editor, /\{canEditConfig \? \(\s*<div data-testid="portal-announcement-card"/, 'only holders of the portal-config grant see it')
  assert.match(card, /<DateEntryInput id="portal-announcement-start"/)
  assert.match(card, /<DateEntryInput id="portal-announcement-end"/)
  assert.doesNotMatch(card, /type="date"/, 'the app has one typed date field')
  assert.match(card, new RegExp(`maxLength=\\{PORTAL_ANNOUNCEMENT_MAX_LENGTH\\}`))
  assert.equal(PORTAL_ANNOUNCEMENT_MAX_LENGTH, 200, 'the Worker refuses more than 200 characters')
  assert.match(editor, /role="alert" data-testid="portal-announcement-link-issue"/)
  assert.match(editor, /role="alert" data-testid="portal-announcement-range-issue"/)
})

run('the words exist in both language packs, Khmer is not the English text, and the copy is not the existing promo-strip wording', () => {
  const en = readJson('src/lang/en.json')
  const km = readJson('src/lang/km.json')
  const keys = [
    'announcementBar', 'announcementBarDaysHint', 'announcementBarEnd', 'announcementBarHint', 'announcementBarLink', 'announcementBarLinkInvalid', 'announcementBarRangeInvalid',
    'announcementBarShow', 'announcementBarStart', 'announcementBarTextEn', 'announcementBarTextKm', 'portal_a11y_announcement', 'portal_a11y_announcement_dismiss',
  ]
  for (const key of keys) {
    assert.ok(typeof en[key] === 'string' && en[key].trim(), `en ${key}`)
    assert.ok(typeof km[key] === 'string' && /[\u1780-\u17ff]/.test(km[key]), `km ${key} is Khmer`)
    assert.notEqual(km[key], en[key], key)
  }
  assert.notEqual(en.announcementBar, en.announcementStrip, 'the new bar is named apart from the promo "Announcement strip" cards')
})

run('chunk placement: the two new files sit with the other shared storefront pieces', () => {
  const vite = read('vite.config.ts')
  assert.match(vite, /normalized\.includes\('\/src\/components\/catalog\/portalAnnouncement\.ts'\)/)
  assert.match(vite, /normalized\.includes\('\/src\/components\/catalog\/PortalAnnouncementStrip\.tsx'\)/)
})

if (failed) process.exitCode = 1
else console.log('All announcement bar checks passed')
