// Floating contact buttons, owner ask 2 Nov 2026: Instagram (a direct message, ig.me/m/<name>) joins Telegram and
// Messenger. Its Website Editor switch (customer_portal_show_contact_instagram) used to default OFF; a button that
// shows "only when configured" must not need a second step, so an unset switch now publishes ON and an explicit
// stored "false" still hides it. The accounts themselves are the existing contact settings and ride the one cached
// public config; nothing here adds a read or a permission.
//
// Run: node scripts/test-portal-contact-instagram-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const portal = require('./harness/load_portal_route.cjs')

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

check('an unset Instagram switch publishes ON (the button appears as soon as the account is typed)', () => {
  assert.equal(publish({}).showContactInstagram, true)
  assert.equal(publish({ customer_portal_contact_instagram: 'sample_shop' }).showContactInstagram, true)
})

check('an explicit stored off still hides it, and the other switches keep their own defaults', () => {
  for (const stored of ['false', '0', 'off']) assert.equal(publish({ customer_portal_show_contact_instagram: stored }).showContactInstagram, false, `stored ${stored}`)
  for (const stored of ['true', '1', 'on']) assert.equal(publish({ customer_portal_show_contact_instagram: stored }).showContactInstagram, true, `stored ${stored}`)
  const config = publish({})
  assert.equal(config.showContactMessenger, true)
  assert.equal(config.showContactTelegram, true)
  assert.equal(config.showContactWhatsapp, false, 'WhatsApp stays opt-in')
  assert.equal(config.showContactPhone, false, 'Call stays opt-in')
})

check('the Instagram account is published through the same public config as the other contact accounts', () => {
  const config = publish({ customer_portal_contact_instagram: 'sample_shop', customer_portal_contact_telegram: 'sample_tg' })
  assert.equal(config.contactLinks.instagram, 'sample_shop')
  assert.equal(config.contactLinks.telegram, 'sample_tg')
})

check('the switch is a plain portal setting: it falls under the existing "Manage portal config" bucket', () => {
  const settings = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'settings.ts'), 'utf8')
  const bucket = settings.slice(settings.indexOf('export function settingsBucketPermissionFor'), settings.indexOf('const SETTINGS_BUCKET_LABELS'))
  assert.match(bucket, /if \(key\.startsWith\('customer_portal_'\)\) return 'customer_portal'/)
  for (const named of ['PORTAL_POSTS_KEYS', 'PORTAL_FAQ_KEYS', 'PORTAL_ABOUT_KEYS']) {
    const set = settings.slice(settings.indexOf(`const ${named} = new Set(`), settings.indexOf('])', settings.indexOf(`const ${named} = new Set(`)))
    assert.ok(!set.includes('customer_portal_show_contact_instagram'), `${named} does not claim it`)
    assert.ok(!set.includes('customer_portal_contact_instagram'), `${named} does not claim the account either`)
  }
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
