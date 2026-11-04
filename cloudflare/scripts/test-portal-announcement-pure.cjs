// Announcement bar, owner ask 2 Nov 2026: one short message at the top of the storefront, in English and Khmer, with an
// optional link, an on/off switch and optional start/end dates; edited in the Website Editor with its existing
// permission; stored with the storefront settings and published in the SAME cached public payload.
//
// Behaviour inventory (kept): every other customer_portal_* setting, the cached public config (aiPrompt and
// aiProviderId stay out), the "Manage portal config" write grant, the settings version that keys the edge body cache.
// Plausible wrong implementations this file catches:
//   - the link stored as typed, so `javascript:` / `data:` / `//host` / `/path` / `https://user:pw@host` reach a visitor;
//   - the text HTML-encoded (double escaping on screen) or left with control characters / bidi overrides;
//   - an unset or poisoned stored value published as is (stored Website Editor values are untrusted);
//   - the dismissal version tied to the dates (extending a message would show it again to everyone who closed it)
//     or NOT tied to the text (editing a message would stay hidden for everyone who closed the old one);
//   - a new permission, a new D1 read or a time-keyed cache for the bar.
//
// Run: node scripts/test-portal-announcement-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const portal = require('./harness/load_portal_route.cjs')
const ts = require('typescript')

function loadPortalText() {
  const file = path.join(__dirname, '..', 'src', 'lib', 'portalText.ts')
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } })
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', outputText)(mod.exports, require, mod)
  return mod.exports
}
const text = loadPortalText()

let passed = 0
let failed = 0
const check = (name, fn) => {
  try {
    fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL ${name}: ${String(error && error.message).split(/\r?\n/)[0]}`)
  }
}

const env = { BUSINESS_OS_PUBLIC_URL: 'https://shop.example' }
const publish = (settings) => portal.buildPublicPortalConfig(settings, env)
const ON = { customer_portal_announcement_enabled: 'true', customer_portal_announcement_text_en: 'Sample sale this week', customer_portal_announcement_text_km: 'ការលក់ពិសេសសប្តាហ៍នេះ' }

check('nothing set: the bar is off and every field is empty', () => {
  const config = publish({})
  assert.equal(config.announcementEnabled, false)
  for (const key of ['announcementTextEn', 'announcementTextKm', 'announcementLink', 'announcementStart', 'announcementEnd']) assert.equal(config[key], '', key)
})

check('a configured bar is published in both languages with its link and dates', () => {
  const config = publish({ ...ON, customer_portal_announcement_link: 'https://shop.example/news', customer_portal_announcement_start: '2026-11-05', customer_portal_announcement_end: '2026-11-12' })
  assert.equal(config.announcementEnabled, true)
  assert.equal(config.announcementTextEn, 'Sample sale this week')
  assert.equal(config.announcementTextKm, 'ការលក់ពិសេសសប្តាហ៍នេះ')
  assert.equal(config.announcementLink, 'https://shop.example/news')
  assert.equal(config.announcementStart, '2026-11-05')
  assert.equal(config.announcementEnd, '2026-11-12')
})

check('the switch reads like every other portal switch', () => {
  for (const [stored, expected] of [['true', true], ['1', true], ['on', true], ['false', false], ['0', false], ['off', false]]) {
    assert.equal(publish({ ...ON, customer_portal_announcement_enabled: stored }).announcementEnabled, expected, `stored ${stored}`)
  }
})

check('link: only http(s) is published; every other scheme, relative form and credential is dropped', () => {
  const dropped = [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)',
    'file:///etc/passwd', 'ftp://example.test/x', 'mailto:a@example.test', 'tel:+85512345678', 'blob:https://shop.example/x',
    '//evil.example/x', '/\\evil.example', '/relative/path', 'relative/path', 'https:example.test', 'https:/example.test', 'http://', 'https://',
    'https://user:pass@example.test/', 'https://user@example.test/', 'https://exa mple.test/', 'https://example.test/a b', 'https://example.test/\\x',
    `https://example.test/${'a'.repeat(600)}`, 'https://example.test/\u0000', 'https://example.test/\nx',
  ]
  for (const link of dropped) assert.equal(publish({ ...ON, customer_portal_announcement_link: link }).announcementLink, '', JSON.stringify(link))
  for (const link of ['https://example.test/a?x=1#top', 'http://example.test', 'HTTPS://EXAMPLE.TEST/News', 'https://t.me/sample_shop']) {
    assert.equal(publish({ ...ON, customer_portal_announcement_link: link }).announcementLink, link, link)
  }
  for (const link of [null, 12, true, ['https://example.test'], { href: 'https://example.test' }]) {
    assert.equal(publish({ ...ON, customer_portal_announcement_link: link }).announcementLink, '', `non-string ${JSON.stringify(link)}`)
  }
})

check('dates: only a real calendar day is published', () => {
  const dropped = ['2026-02-30', '2026-13-01', '2026-00-10', '2026-11-00', '2026-1-1', '26-11-02', '2026/11/02', '2026-11-02T00:00', '2026-11-02 ', 'tomorrow', '0000-00-00', '1999-12-31', '2101-01-01', null, 20261102, ['2026-11-02']]
  for (const value of dropped) {
    const config = publish({ ...ON, customer_portal_announcement_start: value, customer_portal_announcement_end: value })
    const expected = value === '2026-11-02 ' ? '2026-11-02' : ''
    assert.equal(config.announcementStart, expected, JSON.stringify(value))
    assert.equal(config.announcementEnd, expected, JSON.stringify(value))
  }
  assert.equal(publish({ ...ON, customer_portal_announcement_start: '2028-02-29' }).announcementStart, '2028-02-29', 'a leap day')
  assert.equal(publish({ ...ON, customer_portal_announcement_start: '2026-02-29' }).announcementStart, '', 'not a leap year')
})

check('text: plain text only, control characters and bidi overrides removed, HTML left as literal characters', () => {
  const cleaned = publish({ ...ON, customer_portal_announcement_text_en: '  Sale\n\tnow\u0000 ‮evil‬  ' }).announcementTextEn
  assert.equal(cleaned, 'Sale now evil')
  const html = '<img src=x onerror=alert(1)> & "quotes" <b>bold</b>'
  assert.equal(publish({ ...ON, customer_portal_announcement_text_en: html }).announcementTextEn, html, 'not HTML-encoded here: the page renders text nodes, so encoding would show &lt; on screen')
  assert.equal(publish({ ...ON, customer_portal_announcement_text_en: 'ក​ខ' }).announcementTextEn, 'ក​ខ', 'a Khmer zero-width space stays')
  for (const value of [null, 5, true, ['a'], { a: 1 }]) assert.equal(publish({ ...ON, customer_portal_announcement_text_en: value }).announcementTextEn, '', JSON.stringify(value))
})

check('text: an over-long stored value is cut on a character boundary, never mid-cluster', () => {
  const long = 'ស្រី'.repeat(200)
  const out = publish({ ...ON, customer_portal_announcement_text_km: long }).announcementTextKm
  assert.ok(Array.from(out).length <= 200)
  assert.ok(!out.endsWith('្'), 'does not end on a bare coeng')
})

check('version: changes with the text or the link, not with the dates or the switch', () => {
  const base = publish({ ...ON, customer_portal_announcement_link: 'https://shop.example/a' })
  assert.ok(base.announcementVersion && /^[0-9a-z]+$/.test(base.announcementVersion), base.announcementVersion)
  const same = publish({ ...ON, customer_portal_announcement_link: 'https://shop.example/a', customer_portal_announcement_start: '2026-11-05', customer_portal_announcement_end: '2026-12-01' })
  assert.equal(same.announcementVersion, base.announcementVersion, 'extending the dates must not bring the bar back for people who closed it')
  assert.equal(publish({ ...ON, customer_portal_announcement_enabled: 'false', customer_portal_announcement_link: 'https://shop.example/a' }).announcementVersion, base.announcementVersion, 'switching off and on again is the same message')
  assert.notEqual(publish({ ...ON, customer_portal_announcement_text_en: 'Sample sale next week', customer_portal_announcement_link: 'https://shop.example/a' }).announcementVersion, base.announcementVersion, 'English text')
  assert.notEqual(publish({ ...ON, customer_portal_announcement_text_km: 'សាកល្បង', customer_portal_announcement_link: 'https://shop.example/a' }).announcementVersion, base.announcementVersion, 'Khmer text')
  assert.notEqual(publish({ ...ON, customer_portal_announcement_link: 'https://shop.example/b' }).announcementVersion, base.announcementVersion, 'link')
  assert.equal(publish({}).announcementVersion, '', 'no message, no version')
})

check('the bar rides the one public config: no AI keys come with it and no private field name appears', () => {
  const config = publish({ ...ON, customer_portal_announcement_link: 'https://shop.example/news' })
  assert.equal('aiPrompt' in config, false)
  assert.equal('aiProviderId' in config, false)
  assert.equal(portal.findForbiddenPublicKey(config), null)
})

check('building the config needs only the settings map already in hand (no database, no clock)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'portal.ts'), 'utf8')
  const start = source.indexOf('export function buildPortalConfig(settings: SettingsMap, env: Env)')
  const body = source.slice(start, source.indexOf('\n}\n', start))
  assert.match(body, /\.\.\.portalAnnouncementConfig\(\{/)
  const announcementCall = body.slice(body.indexOf('...portalAnnouncementConfig({'), body.indexOf('})', body.indexOf('...portalAnnouncementConfig({')))
  assert.doesNotMatch(announcementCall, /\bDB\b|getDb|await |Date\.now|new Date/, 'the bar adds no read and no time-keyed value to the cached body')
})

const settingsBody = (values) => ({ ...values })
const validate = (body, stored = {}) => text.validatePortalAnnouncementWrite(body, (key) => stored[key])

check('write: valid values are accepted and normalised', () => {
  const result = validate(settingsBody({
    customer_portal_announcement_enabled: true,
    customer_portal_announcement_text_en: '  Sample\nsale ',
    customer_portal_announcement_text_km: 'ការលក់',
    customer_portal_announcement_link: ' https://shop.example/news ',
    customer_portal_announcement_start: '2026-11-05',
    customer_portal_announcement_end: '2026-11-12',
  }))
  assert.equal(result.ok, true)
  assert.deepEqual(result.values, {
    customer_portal_announcement_enabled: 'true',
    customer_portal_announcement_text_en: 'Sample sale',
    customer_portal_announcement_text_km: 'ការលក់',
    customer_portal_announcement_link: 'https://shop.example/news',
    customer_portal_announcement_start: '2026-11-05',
    customer_portal_announcement_end: '2026-11-12',
  })
})

check('write: nothing about the bar in the request means nothing is validated or changed', () => {
  const result = validate({ customer_portal_title: 'Sample', customer_portal_announcement_end: undefined })
  assert.equal(result.ok, true)
  assert.deepEqual(result.values, {})
})

check('write: crafted values are refused with a code, never stored', () => {
  const refuse = (key, value, code, stored) => {
    const result = validate({ [key]: value }, stored)
    assert.equal(result.ok, false, `${key}=${JSON.stringify(value)}`)
    assert.equal(result.code, code, `${key}=${JSON.stringify(value)}`)
    assert.ok(result.error && result.error.length > 10)
  }
  for (const link of ['javascript:alert(1)', 'data:text/html,x', '//evil.example', '/relative', 'ftp://example.test', 'https://user:pass@example.test', 'https://example.test/\nx', 7, ['https://example.test'], null, { a: 1 }]) {
    refuse('customer_portal_announcement_link', link, 'invalid_announcement_link')
  }
  for (const date of ['2026-02-30', '2026-13-01', 'soon', 20261102, ['2026-11-02'], null]) {
    refuse('customer_portal_announcement_start', date, 'invalid_announcement_date')
    refuse('customer_portal_announcement_end', date, 'invalid_announcement_date')
  }
  for (const value of ['yes please', 2, {}, [], null]) refuse('customer_portal_announcement_enabled', value, 'invalid_announcement_enabled')
  for (const key of ['customer_portal_announcement_text_en', 'customer_portal_announcement_text_km']) {
    refuse(key, 'x'.repeat(201), 'invalid_announcement_text')
    refuse(key, 'ស្'.repeat(101), 'invalid_announcement_text')
    refuse(key, 12, 'invalid_announcement_text')
    refuse(key, ['a'], 'invalid_announcement_text')
    assert.equal(validate({ [key]: 'x'.repeat(200) }).ok, true, 'exactly 200 is allowed')
  }
})

check('write: the end day cannot be before the start day, whichever one this save changes', () => {
  assert.equal(validate({ customer_portal_announcement_start: '2026-11-10', customer_portal_announcement_end: '2026-11-09' }).code, 'invalid_announcement_range')
  assert.equal(validate({ customer_portal_announcement_end: '2026-11-09' }, { customer_portal_announcement_start: '2026-11-10' }).code, 'invalid_announcement_range', 'only the end is sent; the stored start counts')
  assert.equal(validate({ customer_portal_announcement_start: '2026-11-10' }, { customer_portal_announcement_end: '2026-11-09' }).code, 'invalid_announcement_range', 'only the start is sent; the stored end counts')
  assert.equal(validate({ customer_portal_announcement_start: '2026-11-10', customer_portal_announcement_end: '2026-11-10' }).ok, true, 'one day long')
  assert.equal(validate({ customer_portal_announcement_start: '', customer_portal_announcement_end: '2026-11-01' }, { customer_portal_announcement_start: '2026-11-10' }).ok, true, 'clearing the start in the same save')
})

check('permission: the keys stay under the existing "Manage portal config" grant and no special set claims them', () => {
  const settings = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'settings.ts'), 'utf8')
  const bucket = settings.slice(settings.indexOf('export function settingsBucketPermissionFor'), settings.indexOf('const SETTINGS_BUCKET_LABELS'))
  assert.match(bucket, /if \(key\.startsWith\('customer_portal_'\)\) return 'customer_portal'/)
  for (const named of ['PORTAL_POSTS_KEYS', 'PORTAL_FAQ_KEYS', 'PORTAL_ABOUT_KEYS']) {
    const set = settings.slice(settings.indexOf(`const ${named} = new Set(`), settings.indexOf('])', settings.indexOf(`const ${named} = new Set(`)))
    assert.ok(!/customer_portal_announcement/.test(set), `${named} does not claim the bar`)
  }
})

check('settings route: the validation runs before anything is stored and a refusal is a 400', () => {
  const settings = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'settings.ts'), 'utf8')
  const at = settings.indexOf('validatePortalAnnouncementWrite(')
  assert.ok(at > 0, 'settings.ts calls the validator')
  const call = settings.slice(at - 200, at + 700)
  assert.match(call, /c\.json\(\{ error: [^}]*code: [^}]*\}, 400\)|c\.json\(\{[\s\S]*?\}, 400\)/, 'a refusal answers 400')
  assert.match(call, /Object\.assign\(body, /, 'the normalised values replace what was sent')
  const firstWrite = settings.indexOf('INSERT INTO settings', at)
  assert.ok(firstWrite === -1 || firstWrite > at, 'validated before the write')
})

check('cache: the public body is keyed by the settings version, so a save shows on the next fetch and nothing is keyed by time', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'portal.ts'), 'utf8')
  assert.match(source, /body: \['portal-body-v2', deploy, version\('products'\), version\('settings'\), version\('promotions'\)\]/, 'the body key carries the settings version')
  const settingsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'settings.ts'), 'utf8')
  const save = settingsSource.slice(settingsSource.indexOf('validatePortalAnnouncementWrite('))
  assert.match(save, /waitUntil\(bumpVersion\(c\.env, 'settings'\)\)/, 'a save bumps the settings version that keys the body')
  const lib = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'portalText.ts'), 'utf8').replace(/\r\n/g, '\n')
  const fn = lib.slice(lib.indexOf('export function portalAnnouncementConfig'), lib.indexOf('\n}\n', lib.indexOf('export function portalAnnouncementConfig')))
  assert.ok(fn.length > 50)
  assert.doesNotMatch(fn, /Date\.now|new Date\(|getTime|toISOString/, 'dates are compared by the visitor, never against the server clock')
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
