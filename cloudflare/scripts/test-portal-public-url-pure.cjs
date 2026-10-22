// Regression test for portalPublicUrl / buildPortalConfig's `publicUrl`
// resolution (routes/portal.ts).
//
// Bug this pins (found by the Aug-29 post-deploy audit): the live storefront
// advertised the OLD domain (leangcosmetics.dpdns.org) after the rebrand to
// leangbeauty.com, because a stored `customer_portal_public_url` setting
// shadowed `BUSINESS_OS_PUBLIC_URL`. That stored value was almost always
// FROZEN there by the portal editor round-tripping the resolved url back into
// the setting (CatalogPage.tsx prefills the override input with the already-
// resolved config.publicUrl), not a deliberate external-domain choice.
//
// The fix: portalPublicUrl now DROPS a stored override whose host is one of
// this shop's own DEPRECATED hosts (a permanent denylist: leangcosmetics.dpdns.org
// was retired completely on Sep 26 2026, which is exactly why a stored override
// naming it must keep being REJECTED, not honored) and falls back to the live env url -- while still honoring a
// GENUINE external funnel domain (any host not on the deprecated list), so the
// documented override feature is preserved.
//
// Same "transpile the REAL route file and call the REAL exported function"
// approach as the other portal pure tests; buildPortalConfig is pure over
// (settings, env), so no DB is needed here.
//
// Run (from cloudflare/): node scripts/test-portal-public-url-pure.cjs

const assert = require('assert')
// The real portal.ts, transpiled with its platform imports stubbed (the
// list lives in the harness so the other portal config tests share it).
const portalRoute = require('./harness/load_portal_route.cjs')

const buildPortalConfig = portalRoute.buildPortalConfig
assert.strictEqual(typeof buildPortalConfig, 'function', 'buildPortalConfig should be exported')

const ENV = { BUSINESS_OS_PUBLIC_URL: 'https://leangbeauty.com' }
const publicUrlFor = (override) =>
  buildPortalConfig(override === undefined ? {} : { customer_portal_public_url: override }, ENV).publicUrl

let checks = 0
const check = (label, actual, expected) => {
  assert.strictEqual(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  checks++
  console.log(`PASS ${label}`)
}

// 1. The exact production repro: a stale deprecated-host override is dropped,
//    so publicUrl follows the live env instead of advertising the dead domain.
check('stale dpdns override -> env', publicUrlFor('https://leangcosmetics.dpdns.org'), 'https://leangbeauty.com')

// 2. Every hostname in the deprecated set is treated the same way.
for (const stale of [
  'https://admin.leangcosmetics.dpdns.org',
  'https://leangcosmetics.com',
  'https://www.leangcosmetics.com',
  'https://admin.leangcosmetics.com',
]) {
  check(`stale ${stale} -> env`, publicUrlFor(stale), 'https://leangbeauty.com')
}

// 3. A GENUINE external funnel domain (not one of our own deprecated hosts) is
//    still honored -- the override feature is preserved, not removed.
check('genuine external override honored', publicUrlFor('https://customers.example.com'), 'https://customers.example.com')

// 4. No override -> env fallback.
check('blank override -> env', publicUrlFor(''), 'https://leangbeauty.com')
check('unset override -> env', publicUrlFor(undefined), 'https://leangbeauty.com')

// 5. An override equal to the current live host is honored (harmless; equals env).
check('current-host override honored', publicUrlFor('https://leangbeauty.com'), 'https://leangbeauty.com')

// 6. The pre-existing `/public` suffix trim still applies to an honored override.
check('/public trimmed on honored override', publicUrlFor('https://customers.example.com/public'), 'https://customers.example.com')

// 7. Host match is case-insensitive (a deprecated host in caps is still dropped).
check('deprecated host is case-insensitive', publicUrlFor('https://LeangCosmetics.DPDNS.org'), 'https://leangbeauty.com')

// 8. Regression: the fix touches ONLY publicUrl -- an unrelated field still
//    reads from its own setting and is not disturbed.
const cfg = buildPortalConfig({ customer_portal_public_url: 'https://leangcosmetics.dpdns.org', business_name: 'Some Shop' }, ENV)
check('unrelated businessName unaffected', cfg.businessName, 'Some Shop')

// 9. publicUrlOverride: the RAW stored override the portal editor prefills its
//    input from -- exposed separately from the RESOLVED publicUrl so a blank
//    override stays blank on save instead of freezing the env fallback. It shows
//    the actual stored value (even a stale deprecated one, so the merchant can
//    see and clear it), and is empty when no override is set.
const overrideFor = (override) =>
  buildPortalConfig(override === undefined ? {} : { customer_portal_public_url: override }, ENV).publicUrlOverride
check('override exposed raw (stale value visible to editor, not resolved)', overrideFor('https://leangcosmetics.dpdns.org'), 'https://leangcosmetics.dpdns.org')
check('override exposed raw (genuine external)', overrideFor('https://customers.example.com'), 'https://customers.example.com')
check('blank override -> empty publicUrlOverride (stays blank, no freeze)', overrideFor(''), '')
check('unset override -> empty publicUrlOverride', overrideFor(undefined), '')
// And the resolved publicUrl on that same stale-override config is STILL the env
// (the deprecated-host guard), so the editor shows the stale override in its input
// while the live/resolved url is already correct.
check('resolved publicUrl stays env even while override input shows the stale value', cfg.publicUrl, 'https://leangbeauty.com')

// Public FAQ settings must survive the editor -> settings -> bootstrap path.
// Malformed or incomplete rows fail closed instead of breaking the portal.
const faqConfig = buildPortalConfig({
  customer_portal_show_membership: '1',
  customer_portal_faq_title: 'Delivery & products',
  customer_portal_faq_items: JSON.stringify([
    { id: 'delivery', question: 'Do you deliver?', answer: 'Yes.' },
    { id: 'incomplete', question: 'Missing answer', answer: '' },
  ]),
}, ENV)
check('guest membership navigation remains disabled', faqConfig.showMembership, false)
check('FAQ title round-trips through public config', faqConfig.faqTitle, 'Delivery & products')
assert.deepStrictEqual(faqConfig.faqItems, [{ id: 'delivery', question: 'Do you deliver?', answer: 'Yes.' }])
checks++
console.log('PASS FAQ rows round-trip and incomplete rows are removed')
assert.deepStrictEqual(buildPortalConfig({ customer_portal_faq_items: '{broken' }, ENV).faqItems, [])
checks++
console.log('PASS malformed FAQ JSON fails closed')

// Section 8a regression: buildPortalConfig previously never read back
// customer_portal_product_caution_default / _need_more_details_default even
// though CatalogPage.tsx (the admin portal editor) already saved them and
// ProductDetailFlyout.tsx already consumed them as the portal-wide
// Caution/Need-More-Details fallback for every product -- so the merchant's
// saved copy silently never reached the real public storefront (only the
// editor's own live preview, which builds its display config straight from
// draft state rather than round-tripping through this endpoint, showed it).
const productDefaultsConfig = buildPortalConfig({
  customer_portal_product_caution_default: 'Patch test 24h before first use.',
  customer_portal_product_need_more_details_default: 'Message us on Telegram for a full ingredient list.',
}, ENV)
check('saved caution default reaches the public config', productDefaultsConfig.productCautionDefault, 'Patch test 24h before first use.')
check('saved need-more-details default reaches the public config', productDefaultsConfig.productNeedMoreDetailsDefault, 'Message us on Telegram for a full ingredient list.')
check('caution default is empty (not undefined) when never configured', buildPortalConfig({}, ENV).productCautionDefault, '')
check('need-more-details default is empty (not undefined) when never configured', buildPortalConfig({}, ENV).productNeedMoreDetailsDefault, '')

// Oct 22 2026: with no business name saved, the portal's name and title are the
// deployment's configured shop name. They were the literal 'Leang Cosmetics'
// for every client, so a second shop's storefront opened under Leang's name.
const LEANG_ENV = require('./harness/wrangler_vars.cjs').wranglerVars('wrangler.toml')
const BM_ENV = { BUSINESS_OS_SHOP_NAME: 'BM Shop', BUSINESS_OS_PUBLIC_URL: 'https://bmshop.khshop.workers.dev' }
check('Leang: no saved name still opens as Leang Cosmetics', buildPortalConfig({}, LEANG_ENV).businessName, 'Leang Cosmetics')
check('Leang: and the portal title is the same', buildPortalConfig({}, LEANG_ENV).title, 'Leang Cosmetics')
check('BM Shop: no saved name opens as BM Shop', buildPortalConfig({}, BM_ENV).businessName, 'BM Shop')
check('BM Shop: and the portal title is the same', buildPortalConfig({}, BM_ENV).title, 'BM Shop')
check('no vars at all: the neutral Business OS, never a client', buildPortalConfig({}, ENV).businessName, 'Business OS')
check('a saved business name wins over the configured one', buildPortalConfig({ business_name: 'Saved Name' }, BM_ENV).businessName, 'Saved Name')
check('a saved business name is also the title', buildPortalConfig({ business_name: 'Saved Name' }, BM_ENV).title, 'Saved Name')
check('a saved portal title wins over the name', buildPortalConfig({ customer_portal_title: 'Saved Title', business_name: 'Saved Name' }, BM_ENV).title, 'Saved Title')

console.log(`\nALL ${checks} CHECKS PASSED`)
