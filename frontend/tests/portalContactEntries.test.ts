// Public-web overhaul, lane SHELL, spec section 3, split by the storefront dock lane (owner A57, 21 Nov 2026: "the contact don't merge the chat
// with the account"): chat entries (Phone, Messenger, Telegram, WhatsApp) are the Contact panel and the inline rows; account entries (Facebook,
// Instagram, TikTok, Telegram channel, Website) are information for About and the footer.
// - no "@" in any visible account text (the old builder prefixed one to every username);
// - an owner-typed label keeps its words but loses a leading "@" at display;
// - a Facebook link with no readable name (the live shop's facebook.com/share/ link) takes the owner's label, then the
//   Messenger account name, then the shop name, and its accessible name is "Facebook: <name>";
// - chat rows come out as Phone, Messenger, Telegram, WhatsApp; account rows as Facebook, Instagram, TikTok, Telegram, Website;
// - an account never sits in the chat list and a chat channel never in the account list (Instagram is an account, its chat link only a fallback);
// - the one Telegram account that is both is in both lists, and a screen shows it once (portalAccountsNotShown, portalFooterAccounts);
// - two accounts of one platform are two rows.
//
// Run: node tests/portalContactEntries.test.ts
import assert from 'node:assert/strict'
import { PORTAL_CONTACT_TRIGGER_SELECTOR, buildPortalContactEntries, buildPortalSocialFromConfig, buildPortalSocialLinks, portalAccountsNotShown, portalContactFooterLinks, portalFooterAccounts, resolveContactFocusTarget } from '../src/components/catalog/portalSocialLinks.ts'
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

function splitFor(config: Record<string, unknown>, extra: Record<string, unknown> = {}, language = 'en') {
  const built = buildPortalSocialFromConfig(config, language)
  return buildPortalContactEntries({ social: built.social, contact: built.contact, shopName: 'Leang Cosmetics', language, ...extra })
}
const entriesFor = (config: Record<string, unknown>, extra: Record<string, unknown> = {}, language = 'en') => {
  const { chat, accounts } = splitFor(config, extra, language)
  return [...chat, ...accounts]
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
  const labelled = buildPortalContactEntries({ social: withLabel.social, contact: withLabel.contact, shopName: 'Leang Cosmetics' }).accounts.find((entry) => entry.platform === 'facebook')
  assert.equal(labelled?.label, 'Leang on Facebook', 'the owner label comes first')
  const noMessenger = entriesFor({ ...LIVE_CONFIG, contactLinks: { ...LIVE_CONFIG.contactLinks, messenger: '' }, showContactMessenger: false }).find((entry) => entry.platform === 'facebook')
  assert.equal(noMessenger?.label, 'Leang Cosmetics', 'with no Messenger account the shop name is shown')
  assert.equal(noMessenger?.accessibleName, 'Facebook: Leang Cosmetics')
  const bare = buildPortalContactEntries({ social: buildPortalSocialLinks({ links: { facebook: 'https://www.facebook.com/share/1EuXg47WiG' } }), language: 'en' }).accounts.find((entry) => entry.platform === 'facebook')
  assert.equal(bare?.label, 'Facebook', 'with no name anywhere the platform word is the last resort, not an empty row')
})

runCase('a Facebook link that names a page keeps that name (no fallback needed)', () => {
  const entries = entriesFor({ ...LIVE_CONFIG, links: { ...LIVE_CONFIG.links, facebook: 'https://facebook.com/leangcosmetics' } })
  assert.equal(entries.find((entry) => entry.platform === 'facebook')?.label, 'leangcosmetics')
})

runCase('chat rows are Phone, Messenger, Telegram, WhatsApp; account rows are Facebook, Instagram, TikTok, Telegram, Website; only those that exist', () => {
  const { chat, accounts } = splitFor(
    { ...LIVE_CONFIG, links: { ...LIVE_CONFIG.links, website: 'https://leang.example/shop' }, contactLinks: { ...LIVE_CONFIG.contactLinks, whatsapp: '+85512345678', phone: '012 345 678' }, showContactPhone: true },
    { email: 'hello@leang.example' },
  )
  assert.deepEqual(chat.map((entry) => entry.platform), ['phone', 'messenger', 'telegram', 'whatsapp'])
  assert.deepEqual(accounts.map((entry) => entry.platform), ['facebook', 'instagram', 'telegram', 'website'])
  // the portal config has no TikTok switch, so TikTok is checked through the page-link builder directly
  const tiktok = buildPortalContactEntries({ social: buildPortalSocialLinks({ links: { website: 'https://leang.example', tiktok: 'https://www.tiktok.com/@leang_shop', facebook: 'https://facebook.com/leang' } }), language: 'en' })
  assert.deepEqual(tiktok.accounts.map((entry) => entry.platform), ['facebook', 'tiktok', 'website'])
  assert.equal([...chat, ...accounts].some((entry) => (entry.platform as string) === 'email' || (entry.platform as string) === 'map'), false, 'e-mail and the map are not contact entries any more')
  const none = splitFor({ ...LIVE_CONFIG, links: { website: '', facebook: '', instagram: '', telegram: '' }, contactLinks: { messenger: '', telegram: '', whatsapp: '', phone: '', instagram: '' } })
  assert.deepEqual([none.chat, none.accounts], [[], []], 'nothing configured: no rows')
})

runCase('the panel holds only chat and the account list holds no chat-only channel (control: a chat-only config still has no account rows)', () => {
  const { chat, accounts } = splitFor(LIVE_CONFIG)
  assert.equal(chat.some((entry) => ['facebook', 'instagram', 'tiktok', 'website'].includes(entry.platform)), false, 'no account in the panel')
  assert.equal(accounts.some((entry) => ['phone', 'messenger', 'whatsapp'].includes(entry.platform)), false, 'no chat-only channel among the accounts')
  const chatOnly = splitFor({ ...LIVE_CONFIG, links: { website: '', facebook: '', instagram: '', telegram: '' }, showWebsite: false, showFacebook: false, showInstagram: false, showTelegram: false })
  assert.deepEqual(chatOnly.accounts, [], 'with no page links there are no account rows')
  assert.ok(chatOnly.chat.length > 0, 'and the chat rows stay')
})

runCase('Instagram is an account; its chat link is used only when no page link names the account', () => {
  const both = splitFor({ ...LIVE_CONFIG, contactLinks: { ...LIVE_CONFIG.contactLinks, instagram: 'https://ig.me/m/leanggirlactik' } })
  assert.equal(both.chat.some((entry) => entry.platform === 'instagram'), false)
  const instagram = both.accounts.filter((entry) => entry.platform === 'instagram')
  assert.equal(instagram.length, 1)
  assert.equal(instagram[0].href, 'https://instagram.com/leanggirlactik', 'the page link is the one kept')
  const chatOnly = splitFor({ ...LIVE_CONFIG, links: { ...LIVE_CONFIG.links, instagram: '' }, contactLinks: { ...LIVE_CONFIG.contactLinks, instagram: 'https://ig.me/m/leanggirlactik' } })
  assert.equal(chatOnly.accounts.find((entry) => entry.platform === 'instagram')?.href, 'https://ig.me/m/leanggirlactik')
})

runCase('the one Telegram account is in both lists, and a screen shows it once', () => {
  const { chat, accounts } = splitFor(LIVE_CONFIG)
  assert.equal(chat.filter((entry) => entry.platform === 'telegram').length, 1)
  assert.equal(accounts.filter((entry) => entry.platform === 'telegram').length, 1)
  assert.equal(portalAccountsNotShown(accounts, chat).some((entry) => entry.platform === 'telegram'), false, 'chat rows on screen: the account row is dropped')
  assert.equal(portalAccountsNotShown(accounts, []).some((entry) => entry.platform === 'telegram'), true, 'control: with no chat rows on screen it stays')
  // a different channel account is a different row
  const other = splitFor({ ...LIVE_CONFIG, links: { ...LIVE_CONFIG.links, telegram: 'https://t.me/LeangChannel' } })
  assert.equal(portalAccountsNotShown(other.accounts, other.chat).some((entry) => entry.platform === 'telegram'), true, 'a channel that is not the chat account stays')
})

runCase('footer accounts: About prints them in its card, FAQ and List print chat inline (the footer drops the same account), other tabs all; Telegram stays for the legal takedown sentence', () => {
  const { chat, accounts } = splitFor(LIVE_CONFIG)
  const names = (screen: { tab: string; listOpen: boolean }) => portalFooterAccounts(accounts, chat, screen).map((entry) => entry.platform)
  assert.deepEqual(names({ tab: 'about', listOpen: false }), ['telegram'], 'About prints the rest in its card; Telegram stays for the footer sentence')
  assert.deepEqual(names({ tab: 'faq', listOpen: false }), ['facebook', 'instagram', 'telegram'])
  assert.deepEqual(names({ tab: 'products', listOpen: true }), ['facebook', 'instagram', 'telegram'])
  assert.deepEqual(names({ tab: 'products', listOpen: false }), ['facebook', 'instagram', 'telegram'])
  // control: with no Telegram anywhere there is nothing to keep, and a chat-only Telegram is kept too
  assert.deepEqual(portalFooterAccounts([], [], { tab: 'about', listOpen: false }), [])
  assert.deepEqual(portalFooterAccounts([], chat, { tab: 'faq', listOpen: false }).map((entry) => entry.platform), ['telegram'])
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

runCase('the footer column lists the account names, one per account', () => {
  const { accounts } = splitFor(LIVE_CONFIG, { phone: '+85512345678' })
  const footer = portalContactFooterLinks(accounts)
  assert.ok(footer.every((link) => !['phone', 'messenger', 'whatsapp'].includes(link.platform)))
  for (const link of footer) {
    const entry = accounts.find((candidate) => candidate.key === link.key)
    assert.equal(link.label, entry?.label, 'one name per account on every surface')
    assert.equal(link.value, entry?.href)
  }
  assert.equal(footer.find((link) => link.platform === 'facebook')?.label, 'leanggirlactik')
})

runCase('Khmer pages keep the shop name in the accessible name of a Facebook link that has no name of its own', () => {
  const { accounts } = splitFor({ ...LIVE_CONFIG, links: { ...LIVE_CONFIG.links, facebook: 'https://www.facebook.com/share/1EuXg47WiG' }, contactLinks: { ...LIVE_CONFIG.contactLinks, messenger: '' }, showContactMessenger: false }, {}, 'km')
  const facebook = accounts.find((entry) => entry.platform === 'facebook')
  assert.equal(facebook?.label, 'Leang Cosmetics')
  assert.ok(facebook?.accessibleName.endsWith(': Leang Cosmetics'))
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
  assert.equal(resolveContactFocusTarget(anchorOpener, null, body, body), anchorOpener, 'an opener still on the page wins')
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
