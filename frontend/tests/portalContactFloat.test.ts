// Floating contact buttons, owner ask 2 Nov 2026: brand-colour icons on the right that open the CHAT directly
// (Telegram t.me/<name>, Messenger m.me/<page>, Instagram DM ig.me/m/<name>). The accounts come from the Website
// Editor's own contact and social settings, never from code; a button exists only when its account is configured.
//
// Behaviour inventory (kept): Messenger, Telegram, WhatsApp and Call channels, the per-channel Website Editor
// toggles, the social-link fallbacks (Messenger from the Facebook page, Telegram and Instagram from their own link),
// the Contact us list (FAQ button, My List drawer), the owner's custom labels (still in that list).
// Plausible wrong implementations: a button per social PROFILE link (a profile page, not a chat); hard-coded
// handles; a button shown for an account that is not configured; trusting a stored link blindly (javascript:,
// another host, credentials in the URL); a white glyph on a pale brand colour.
//
// Run: node tests/portalContactFloat.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { contrastRatio } from '../src/components/catalog/portalContrast.ts'
import {
  PORTAL_CONTACT_BRAND,
  PORTAL_CONTACT_FLOAT,
  buildPortalContactFloat,
  buildPortalSocialFromConfig,
  flattenPortalSocialGroups,
  isDirectContactHref,
  portalFloatClearanceRem,
} from '../src/components/catalog/portalSocialLinks.ts'

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const code = (source: string): string => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

let failed = 0
function run(name: string, test: () => void): void {
  try {
    test()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const SHOW_ALL = { showWebsite: true, showFacebook: true, showInstagram: true, showTelegram: true, showContactMessenger: true, showContactTelegram: true, showContactWhatsapp: true, showContactPhone: true, showContactInstagram: true }
const floatFor = (config: Record<string, unknown>) => buildPortalContactFloat(flattenPortalSocialGroups(buildPortalSocialFromConfig({ ...SHOW_ALL, ...config } as never, 'en').contact))
const hrefs = (config: Record<string, unknown>) => Object.fromEntries(floatFor(config).map((button) => [button.platform, button.value]))

run('each configured account opens its chat directly, from the existing contact settings', () => {
  assert.deepEqual(hrefs({ contactLinks: { telegram: '@sample_shop', messenger: 'sample.shop', instagram: 'sample_shop' } }), {
    messenger: 'https://m.me/sample.shop',
    telegram: 'https://t.me/sample_shop',
    instagram: 'https://ig.me/m/sample_shop',
  })
  assert.deepEqual(hrefs({ contactLinks: { whatsapp: '+855 12 345 678', phone: '+855 12 345 678' } }), {
    whatsapp: 'https://wa.me/85512345678',
    phone: 'tel:+85512345678',
  })
})

run('the social links are the fallback: a profile URL becomes the chat link, never the profile page', () => {
  assert.deepEqual(hrefs({
    links: { facebook: 'https://facebook.com/sample.shop', instagram: 'https://instagram.com/sample_shop', telegram: 'https://t.me/sample_shop' },
  }), {
    messenger: 'https://m.me/sample.shop',
    telegram: 'https://t.me/sample_shop',
    instagram: 'https://ig.me/m/sample_shop',
  })
  for (const platform of ['facebook', 'website', 'tiktok'] as const) {
    assert.equal(floatFor({ links: { [platform]: 'https://example.test/x' } }).some((button) => button.platform === (platform as string)), false, `${platform} profile links get no floating button`)
  }
})

run('a button shows only when its account is configured and its toggle is not off', () => {
  assert.deepEqual(floatFor({}), [], 'nothing configured: no buttons')
  assert.deepEqual(floatFor({ contactLinks: { telegram: 'sample_shop' } }).map((button) => button.platform), ['telegram'])
  assert.deepEqual(floatFor({ contactLinks: { telegram: 'sample_shop', instagram: 'sample_shop' }, showContactTelegram: false }).map((button) => button.platform), ['instagram'], 'the Website Editor toggle still hides one')
  assert.deepEqual(floatFor({ links: { instagram: 'https://instagram.com/sample_shop' }, showInstagram: false }), [], 'a hidden social link is not a fallback account either')
})

run('the order is the Contact us order, and a second account of a platform stays in the list', () => {
  const order = floatFor({ contactLinks: { instagram: 'a_shop', phone: '012345678', telegram: 'a_shop', messenger: 'a.shop', whatsapp: '012345678' } }).map((button) => button.platform)
  assert.deepEqual(order, ['messenger', 'telegram', 'instagram', 'whatsapp', 'phone'])
  const two = floatFor({ contactLinks: { telegram: [{ href: 'first_shop' }, { href: 'second_shop' }] } })
  assert.equal(two.length, 1)
  assert.equal(two[0].value, 'https://t.me/first_shop')
})

run('loophole check: a crafted stored value never becomes a button', () => {
  const crafted = [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'https://evil.example/sample_shop',
    '//evil.example/sample_shop', 'https://t.me.evil.example/x', 'https://evil.example/t.me/x', 'https://t.me/',
    'ftp://t.me/sample_shop', '   ', '<img src=x onerror=alert(1)>', 'sample shop with spaces',
  ]
  for (const value of crafted) {
    for (const platform of ['telegram', 'messenger', 'instagram', 'whatsapp'] as const) {
      assert.equal(isDirectContactHref(platform, value), false, `${platform}: ${value}`)
    }
    assert.deepEqual(floatFor({ contactLinks: { telegram: value, messenger: value, instagram: value, whatsapp: value } }).filter((button) => button.platform !== 'whatsapp'), [], `built from ${value}`)
  }
  // The derive helpers rebuild the link from the path, so credentials in a pasted URL never reach the button.
  assert.equal(isDirectContactHref('telegram', 'http://t.me/sample_shop'), false, 'the tap-time check wants https')
  assert.deepEqual(hrefs({ contactLinks: { telegram: 'http://t.me/sample_shop' } }), { telegram: 'https://t.me/sample_shop' }, 'a pasted http link is rebuilt as https')
  assert.equal(isDirectContactHref('telegram', 'https://user:pw@t.me/x'), false)
  assert.deepEqual(hrefs({ contactLinks: { telegram: 'https://user:pw@t.me/x' } }), { telegram: 'https://t.me/x' })
  assert.equal(isDirectContactHref('phone', 'javascript:alert(1)'), false)
  assert.equal(isDirectContactHref('phone', 'tel:+85512345678'), true)
  assert.equal(isDirectContactHref('phone', 'tel:abc'), false)
  assert.equal(isDirectContactHref('telegram', 'https://m.me/sample'), false, 'another platform\'s host')
  assert.equal(isDirectContactHref('messenger', 'https://m.me/sample.shop'), true)
  assert.equal(isDirectContactHref('instagram', 'https://ig.me/m/sample_shop'), true)
  assert.equal(isDirectContactHref('website', 'https://example.test/'), false, 'only chat platforms')
})

run('every brand fill carries a white glyph at 3:1 or better (every gradient stop)', () => {
  for (const [platform, brand] of Object.entries(PORTAL_CONTACT_BRAND)) {
    for (const stop of brand.stops) assert.ok(contrastRatio('#ffffff', stop) >= 3, `${platform} ${stop} is ${contrastRatio('#ffffff', stop).toFixed(2)}:1`)
    assert.ok(brand.stops.every((stop) => brand.background.includes(stop)), `${platform} lists the stops its background uses`)
  }
})

run('the page ends clear of the stack: the reserve grows with the number of buttons', () => {
  const { bottomRem, buttonRem, gapRem, endRem, minReserveRem } = PORTAL_CONTACT_FLOAT
  assert.equal(portalFloatClearanceRem(0), minReserveRem, 'no contact buttons: the old reserve')
  for (let count = 1; count <= 5; count += 1) {
    const top = bottomRem + count * buttonRem + (count - 1) * gapRem
    assert.ok(portalFloatClearanceRem(count) >= top + endRem - 1e-9, `${count} buttons reach ${top}rem`)
    assert.ok(portalFloatClearanceRem(count) >= portalFloatClearanceRem(count - 1))
  }
})

run('the component matches the numbers, links directly, and has no hard-coded account', () => {
  const row = code(read('../src/components/catalog/PortalSocialRow.tsx'))
  const floatSource = row.slice(row.indexOf('export function PortalContactFloat'), row.indexOf('/** Handles, numbers and domains stay Latin'))
  assert.match(floatSource, /fixed bottom-\[calc\(4\.5rem\+env\(safe-area-inset-bottom\)\)\] right-\[calc\(1\.25rem\+env\(safe-area-inset-right\)\)\] z-50 flex flex-col items-center gap-2/, 'the stack sits above My List, 0.5rem apart')
  assert.equal(PORTAL_CONTACT_FLOAT.bottomRem, 4.5)
  assert.equal(PORTAL_CONTACT_FLOAT.gapRem, 0.5, 'gap-2')
  assert.match(floatSource, /h-11 w-11/, '44px targets')
  assert.equal(PORTAL_CONTACT_FLOAT.buttonRem, 2.75, 'h-11')
  assert.match(floatSource, /href=\{button\.value\}/, 'the chat link itself')
  assert.match(floatSource, /rel=\{isCall \? undefined : 'noreferrer noopener'\}/)
  assert.match(floatSource, /aria-label=\{name\}\s+title=\{name\}/, 'a translated accessible name and tooltip')
  assert.match(floatSource, /role="group"/)
  assert.doesNotMatch(floatSource, /minimiz|opacity-0|-right-1\.5/, 'no minimized stub, no hover-gated control')
  for (const file of ['PortalSocialRow.tsx', 'PublicCatalogPage.tsx']) {
    assert.doesNotMatch(code(read(`../src/components/catalog/${file}`)), /\b(?:t|m|ig|wa)\.me\/|leanggirlactik|Leang_Cosmetic/i, `${file} hard-codes no account or chat host`)
  }
  const page = code(read('../src/components/catalog/PublicCatalogPage.tsx'))
  assert.match(page, /const contactFab = <PortalContactFloat channels=\{contactChannels\} copy=\{copy\} \/>/)
  assert.doesNotMatch(page, /contactMinimized|setContactMinimized/, 'the minimize stub is gone')
  assert.match(page, /floatingStackClearanceRem=\{portalFloatClearanceRem\(buildPortalContactFloat\(contactChannels\)\.length\)\}/)
})

run('labels exist in both language packs and Khmer is not the English text', () => {
  const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
  const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
  for (const key of ['messenger', 'telegram', 'instagram', 'whatsapp', 'phone']) {
    const name = `portal_a11y_contact_${key}`
    assert.ok(en[name], `en ${name}`)
    assert.ok(km[name], `km ${name}`)
    assert.notEqual(km[name], en[name])
  }
})

run('Instagram is part of the set: an unset toggle shows it, a stored false still hides it', () => {
  const worker = read('../../cloudflare/src/routes/portal.ts')
  assert.match(worker, /showContactInstagram: normalizeBoolean\(settings\.customer_portal_show_contact_instagram, true\)/)
  const page = code(read('../src/components/catalog/PublicCatalogPage.tsx'))
  assert.match(page, /showContactInstagram: true,\s*showContactMessenger: true,/, 'the first-paint default')
  const editor = code(read('../src/components/catalog/CatalogPage.tsx'))
  assert.match(editor, /customer_portal_show_contact_instagram: config\.showContactInstagram !== false,/)
  assert.match(editor, /customer_portal_show_contact_instagram: editorDraft\.customer_portal_show_contact_instagram === false \? 'false' : 'true',/, 'the Save keeps an explicit off')
})

if (failed) {
  console.error(`\n${failed} contact float check(s) failed`)
  process.exit(1)
}
console.log('\nAll contact float checks passed')
