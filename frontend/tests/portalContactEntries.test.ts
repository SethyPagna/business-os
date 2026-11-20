// Public-web overhaul, lane SHELL, spec section 3: the one Contact list.
// - no "@" in any visible account text (the old builder prefixed one to every username);
// - an owner-typed label keeps its words but loses a leading "@" at display;
// - a Facebook link with no readable name (the live shop's facebook.com/share/ link) takes the owner's label, then the
//   Messenger account name, then the shop name, and its accessible name is "Facebook: <name>";
// - rows come out as Phone, Messenger, Telegram, Instagram, Facebook, TikTok, WhatsApp, Website, Email, Map;
// - the same Telegram or Instagram account listed as chat channel and page link is one row; two accounts are two rows.
//
// Run: node tests/portalContactEntries.test.ts
import assert from 'node:assert/strict'
import { PORTAL_CONTACT_TRIGGER_SELECTOR, buildPortalContactEntries, buildPortalSocialFromConfig, buildPortalSocialLinks, portalContactFooterLinks, resolveContactFocusTarget } from '../src/components/catalog/portalSocialLinks.ts'
import { deriveSocialHandle, resolveSocialDisplay } from '../src/utils/socialHandles.ts'

let failed = 0
function runCase(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// The live shop's settings, as far as the audit could read them: a Facebook share link, a Messenger link and a Telegram chat link.
const LIVE_CONFIG = {
  links: { website: '', facebook: 'https://www.facebook.com/share/1EuXg47WiG', instagram: 'https://instagram.com/leanggirlactik', telegram: 'https://t.me/Leangcosmetic?direct' },
  linkLabels: { website: 'Website', facebook: 'Facebook', instagram: 'Instagram', telegram: 'Telegram' },
  contactLinks: { messenger: 'https://m.me/leanggirlactik', telegram: 'https://t.me/Leangcosmetic?direct', whatsapp: '', phone: '', instagram: '' },
  contactLinkLabels: { messenger: 'Messenger', telegram: 'Telegram', whatsapp: 'WhatsApp', phone: '', instagram: 'Instagram' },
  showWebsite: true, showFacebook: true, showInstagram: true, showTelegram: true,
  showContactMessenger: true, showContactTelegram: true, showContactWhatsapp: true, showContactPhone: false, showContactInstagram: true,
}

function entriesFor(config: Record<string, unknown>, extra: Record<string, unknown> = {}, language = 'en') {
  const built = buildPortalSocialFromConfig(config, language)
  return buildPortalContactEntries({ social: built.social, contact: built.contact, shopName: 'Leang Cosmetics', language, ...extra })
}

runCase('no visible account text starts with "@", for any platform spelling', () => {
  const hrefs: Array<[Parameters<typeof deriveSocialHandle>[0], string]> = [
    ['facebook', 'https://facebook.com/LeangCosmetics'],
    ['instagram', 'https://instagram.com/leang.cosmetics'],
    ['telegram', 'https://t.me/Leangcosmetic?direct'],
    ['tiktok', 'https://www.tiktok.com/@leang_shop'],
    ['messenger', 'https://m.me/leangcosmetics'],
    ['messenger', 'https://facebook.com/leangcosmetics'],
  ]
  for (const [platform, href] of hrefs) {
    const text = deriveSocialHandle(platform, href)?.text ?? ''
    assert.ok(text.length > 0, `${platform} ${href} still yields a name`)
    assert.ok(!text.includes('@'), `${platform} ${href} -> ${text}`)
    const display = resolveSocialDisplay({ platform, href })
    assert.ok(!display.visibleText.includes('@') && !display.accessibleName.includes('@'), `${platform} ${href} -> ${display.visibleText} / ${display.accessibleName}`)
  }
  for (const entry of entriesFor({ ...LIVE_CONFIG, links: { ...LIVE_CONFIG.links, tiktok: 'https://www.tiktok.com/@leang_shop' } })) {
    assert.ok(!entry.label.includes('@'), entry.label)
    assert.ok(!entry.accessibleName.includes('@'), entry.accessibleName)
  }
})

runCase('a leading "@" the owner typed in a label is dropped at display; the words stay', () => {
  assert.equal(resolveSocialDisplay({ platform: 'instagram', customLabel: '@leang.official', href: 'https://instagram.com/x' }).visibleText, 'leang.official')
  assert.equal(resolveSocialDisplay({ platform: 'telegram', customLabel: '@@Support', href: 'https://t.me/support' }).visibleText, 'Support')
  assert.equal(resolveSocialDisplay({ platform: 'facebook', customLabel: 'Leang @ Wholesale', href: 'https://facebook.com/x' }).visibleText, 'Leang @ Wholesale', 'only a LEADING @ goes')
  assert.equal(resolveSocialDisplay({ platform: 'facebook', customLabel: '@', href: 'https://facebook.com/leang' }).visibleText, 'leang', 'a label that was only "@" counts as unset')
})

runCase('the live Facebook share link shows the Messenger account name, not the word Facebook', () => {
  const facebook = entriesFor(LIVE_CONFIG).find((entry) => entry.platform === 'facebook')
  assert.ok(facebook, 'the Facebook row exists')
  assert.equal(facebook.label, 'leanggirlactik')
  assert.equal(facebook.accessibleName, 'Facebook: leanggirlactik')
  assert.equal(facebook.href, 'https://www.facebook.com/share/1EuXg47WiG', 'only the display changes, never the href')
})

runCase('Facebook fallback order: owner label, then Messenger name, then the shop name', () => {
  const withLabel = buildPortalSocialFromConfig({ ...LIVE_CONFIG, linkLabels: { ...LIVE_CONFIG.linkLabels, facebook: 'Leang on Facebook' } }, 'en')
  const labelled = buildPortalContactEntries({ social: withLabel.social, contact: withLabel.contact, shopName: 'Leang Cosmetics' }).find((entry) => entry.platform === 'facebook')
  assert.equal(labelled?.label, 'Leang on Facebook', 'the owner label comes first')
  const noMessenger = entriesFor({ ...LIVE_CONFIG, contactLinks: { ...LIVE_CONFIG.contactLinks, messenger: '' }, showContactMessenger: false }).find((entry) => entry.platform === 'facebook')
  assert.equal(noMessenger?.label, 'Leang Cosmetics', 'with no Messenger account the shop name is shown')
  assert.equal(noMessenger?.accessibleName, 'Facebook: Leang Cosmetics')
  const bare = buildPortalContactEntries({ social: buildPortalSocialLinks({ links: { facebook: 'https://www.facebook.com/share/1EuXg47WiG' } }), language: 'en' }).find((entry) => entry.platform === 'facebook')
  assert.equal(bare?.label, 'Facebook', 'with no name anywhere the platform word is the last resort, not an empty row')
})

runCase('a Facebook link that names a page keeps that name (no fallback needed)', () => {
  const entries = entriesFor({ ...LIVE_CONFIG, links: { ...LIVE_CONFIG.links, facebook: 'https://facebook.com/leangcosmetics' } })
  assert.equal(entries.find((entry) => entry.platform === 'facebook')?.label, 'leangcosmetics')
})

runCase('rows come out in the spec order, only those that exist', () => {
  const entries = entriesFor(
    { ...LIVE_CONFIG, links: { ...LIVE_CONFIG.links, website: 'https://leang.example/shop', tiktok: '' }, contactLinks: { ...LIVE_CONFIG.contactLinks, whatsapp: '+85512345678', phone: '012 345 678' }, showContactPhone: true },
    { email: 'hello@leang.example', mapHref: 'https://maps.app.goo.gl/abc', address: '12 Street 271, Phnom Penh' },
  )
  assert.deepEqual(entries.map((entry) => entry.platform), ['phone', 'messenger', 'telegram', 'instagram', 'facebook', 'whatsapp', 'website', 'email', 'map'])
  assert.equal(entries.at(-1)?.label, '12 Street 271, Phnom Penh', 'the Map row shows the address')
  assert.equal(entries.find((entry) => entry.platform === 'email')?.href, 'mailto:hello@leang.example')
  assert.deepEqual(entriesFor({ ...LIVE_CONFIG, links: { website: '', facebook: '', instagram: '', telegram: '' }, contactLinks: { messenger: '', telegram: '', whatsapp: '', phone: '', instagram: '' } }), [], 'nothing configured: no rows')
})

runCase('the same Telegram and Instagram account as chat channel and page link is one row; the chat link wins', () => {
  const entries = entriesFor({ ...LIVE_CONFIG, contactLinks: { ...LIVE_CONFIG.contactLinks, instagram: 'https://ig.me/m/leanggirlactik' } })
  assert.equal(entries.filter((entry) => entry.platform === 'telegram').length, 1)
  const instagram = entries.filter((entry) => entry.platform === 'instagram')
  assert.equal(instagram.length, 1)
  assert.equal(instagram[0].href, 'https://ig.me/m/leanggirlactik', 'the direct chat link is the one kept')
})

runCase('a platform with two accounts gets two rows; a phone typed twice is one row', () => {
  const entries = entriesFor(
    { ...LIVE_CONFIG, links: { ...LIVE_CONFIG.links, instagram: ['https://instagram.com/leang.one', 'https://instagram.com/leang.two'] }, contactLinks: { ...LIVE_CONFIG.contactLinks, instagram: '', phone: '012 345 678' }, showContactPhone: true },
    { phone: '+855 12 345 678' },
  )
  assert.deepEqual(entries.filter((entry) => entry.platform === 'instagram').map((entry) => entry.label), ['leang.one', 'leang.two'])
  assert.equal(entries.filter((entry) => entry.platform === 'phone').length, 1, '+855 12 345 678 and 012 345 678 are the same line')
  const two = entriesFor({ ...LIVE_CONFIG, contactLinks: { ...LIVE_CONFIG.contactLinks, phone: '012 345 678' }, showContactPhone: true }, { phone: '097 111 2222' })
  assert.equal(two.filter((entry) => entry.platform === 'phone').length, 2, 'two different numbers are two rows')
})

runCase('the same phone number from the Call channel and the business facts is one row', () => {
  const entries = entriesFor({ ...LIVE_CONFIG, contactLinks: { ...LIVE_CONFIG.contactLinks, phone: '+855 12 345 678' }, showContactPhone: true }, { phone: '+85512345678' })
  assert.equal(entries.filter((entry) => entry.platform === 'phone').length, 1)
})

runCase('the footer column lists the same names, without the rows it prints itself', () => {
  const entries = entriesFor(LIVE_CONFIG, { phone: '+85512345678', email: 'a@b.co', mapHref: 'https://maps.app.goo.gl/x', address: 'Street 1' })
  const footer = portalContactFooterLinks(entries)
  assert.ok(footer.every((link) => !['phone', 'email', 'map'].includes(link.platform)))
  for (const link of footer) {
    const entry = entries.find((candidate) => candidate.key === link.key)
    assert.equal(link.label, entry?.label, 'one name per account on every surface')
    assert.equal(link.value, entry?.href)
  }
  assert.equal(footer.find((link) => link.platform === 'facebook')?.label, 'leanggirlactik')
})

runCase('Khmer pages get the Khmer words for the accessible name of rows that have none of their own', () => {
  const entries = entriesFor({ ...LIVE_CONFIG, links: { ...LIVE_CONFIG.links, facebook: '' } }, { email: 'a@b.co', mapHref: 'https://maps.app.goo.gl/x', address: '' }, 'km')
  assert.equal(entries.find((entry) => entry.platform === 'map')?.label, 'ផែនទី')
  assert.ok(entries.find((entry) => entry.platform === 'email')?.accessibleName.startsWith('អ៊ីមែល'))
})

runCase('closing the Contact menu returns focus to a trigger that is on the page, and never steals focus the visitor moved', () => {
  // The lazy menu swaps the trigger node on open and on close, so the button that was clicked is detached by the time the menu closes
  // (gate run 44757696399, desktop: focus was left on the page body after Escape).
  const node = (isConnected: boolean) => ({ isConnected, focus: () => undefined })
  const body = node(true)
  const liveTrigger = node(true)
  const host = { querySelector: (selector: string) => (selector === PORTAL_CONTACT_TRIGGER_SELECTOR ? liveTrigger : null) }
  const detachedOpener = node(false)
  assert.equal(resolveContactFocusTarget(detachedOpener, host, body, body), liveTrigger, 'a detached opener falls back to the live trigger')
  assert.equal(resolveContactFocusTarget(null, host, null, body), liveTrigger, 'no opener recorded: the live trigger')
  assert.equal(resolveContactFocusTarget(detachedOpener, host, node(false), body), liveTrigger, 'focus left on a removed menu row counts as free')
  const anchorOpener = node(true)
  assert.equal(resolveContactFocusTarget(anchorOpener, null, body, body), anchorOpener, 'an opener still on the page wins (the FAQ and About buttons)')
  const searchField = node(true)
  assert.equal(resolveContactFocusTarget(detachedOpener, host, searchField, body), null, 'a click into another control keeps its focus')
  assert.equal(resolveContactFocusTarget(detachedOpener, null, body, body), null, 'nothing to focus is not an error')
  assert.match(PORTAL_CONTACT_TRIGGER_SELECTOR, /button:not\(\[disabled\]\)/)
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('portalContactEntries: all green')
