// Products page, owner ask 2 Nov 2026: the storefront grid follows the screen (2 / 3 / 4 / 5 / 6 columns).
// "Automatic columns" (customer_portal_grid_columns_auto) is the new Website Editor switch behind it:
//   - unset means automatic, so a shop whose stored desktop count is 2 gets the new grid without any data change;
//   - an explicit "false" keeps the fixed counts the shop chose (still published, still clamped as before);
//   - the switch rides the one cached public config, and the key is a plain `customer_portal_*` setting, so it needs
//     the existing "Manage portal config" grant and nothing new.
//
// Run: node scripts/test-portal-grid-columns-auto-pure.cjs
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

check('an unset switch publishes automatic (a stored 2 desktop columns must not hold the new grid back)', () => {
  const config = publish({ customer_portal_grid_columns_desktop: '2', customer_portal_grid_columns_mobile: '1' })
  assert.equal(config.gridColumnsAuto, true)
  assert.equal(config.gridColumnsDesktop, 2, 'the stored count is still published, for a shop that turns automatic off')
})

check('the switch reads like every other portal switch', () => {
  for (const [stored, expected] of [['true', true], ['1', true], ['on', true], ['false', false], ['0', false], ['off', false]]) {
    assert.equal(publish({ customer_portal_grid_columns_auto: stored }).gridColumnsAuto, expected, `stored ${stored}`)
  }
})

check('turned off, the fixed counts publish exactly as before (clamped 2-8 and 1-3)', () => {
  const config = publish({ customer_portal_grid_columns_auto: 'false', customer_portal_grid_columns_desktop: '12', customer_portal_grid_columns_mobile: '9' })
  assert.equal(config.gridColumnsAuto, false)
  assert.equal(config.gridColumnsDesktop, 8)
  assert.equal(config.gridColumnsMobile, 3)
  const defaults = publish({ customer_portal_grid_columns_auto: 'false' })
  assert.equal(defaults.gridColumnsDesktop, 4)
  assert.equal(defaults.gridColumnsMobile, 1)
})

check('the key is a plain portal setting: it falls under the existing "Manage portal config" bucket', () => {
  const settings = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'settings.ts'), 'utf8')
  const bucket = settings.slice(settings.indexOf('export function settingsBucketPermissionFor'), settings.indexOf('const SETTINGS_BUCKET_LABELS'))
  assert.match(bucket, /if \(key\.startsWith\('customer_portal_'\)\) return 'customer_portal'/)
  for (const named of ['PORTAL_POSTS_KEYS', 'PORTAL_FAQ_KEYS', 'PORTAL_ABOUT_KEYS']) {
    const set = settings.slice(settings.indexOf(`const ${named} = new Set(`), settings.indexOf('])', settings.indexOf(`const ${named} = new Set(`)))
    assert.ok(!set.includes('customer_portal_grid_columns_auto'), `${named} does not claim it`)
  }
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
