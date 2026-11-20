// 6.0.875 public wiring, reworked for the public-web overhaul (lane SHELL): the one Contact menu replaces the header's social chip
// row and the floating chat buttons; plus the offers banner rendered once, the FAQ/AI props, the footer and the Khmer FAQ text.
// Run: node tests/publicWiringSocialOffersFaq.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildPortalContactEntries, buildPortalSocialFromConfig, portalContactFooterLinks } from '../src/components/catalog/portalSocialLinks.ts'
import { FAQ_STARTER_TEXT } from '../src/components/catalog/faqStarterText.ts'
import { localizePortalFaqText } from '../src/components/catalog/portalContentI18n.ts'
import { getPortalLanguageText } from '../src/components/catalog/portalLanguagePacks.ts'

const read = (rel: string) => fs.readFileSync(new URL(`../src/components/catalog/${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const failures: string[] = []
function runCase(name: string, body: () => void): void {
  try {
    body()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}\n  ${String((error as Error)?.message || error).split('\n').join('\n  ')}`)
  }
}

const BASE_CONFIG = {
  showWebsite: true, showFacebook: true, showInstagram: true, showTelegram: true,
  // The Worker fills these default names into linkLabels; they must count as "no label".
  linkLabels: { website: 'Website', facebook: 'Facebook', instagram: 'Instagram', telegram: 'Telegram' },
  links: { website: '', facebook: 'https://www.facebook.com/leangcosmetics', instagram: 'https://instagram.com/leang.cosmetics', telegram: '@leangshop' },
}

runCase('the header has no chip row and the page has no floating chat buttons: Contact is one menu', () => {
  const row = read('PortalSocialRow.tsx')
  assert.doesNotMatch(row, /export default|PortalContactFloat|data-portal-social-row|data-portal-contact-float/, 'the chip row and the float component are gone')
  assert.match(row, /export const PORTAL_SOCIAL_ICONS/)
  assert.match(row, /export function PortalSocialText/)
  for (const file of ['CatalogPreviewSurface.tsx', 'PublicCatalogPage.tsx', 'CatalogPage.tsx']) {
    assert.doesNotMatch(read(file), /PortalSocialRow|PortalContactFloat|contactFab|contactPopover|data-portal-social|data-portal-contact-float/, `${file} still mounts a chip row or a float`)
  }
  const surface = read('CatalogPreviewSurface.tsx')
  assert.match(surface, /<PortalContactMenu[\s\S]*?entries=\{contactEntries\}/, 'the header Contact button opens the menu')
  assert.match(surface, /data-portal-contact-trigger=""/)
})

runCase('every page and sheet builds its contact data through the one builder', () => {
  for (const file of ['PublicCatalogPage.tsx', 'CatalogPage.tsx']) {
    const source = read(file)
    assert.match(source, /buildPortalSocialFromConfig\(/, file)
    assert.match(source, /buildPortalContactEntries\(/, `${file} builds the Contact entries`)
    assert.match(source, /const socialLinks = portalContactFooterLinks\(contactEntries\)/, `${file}: the footer takes its names from the same entries`)
    assert.doesNotMatch(source, /socialIconByKey|contactIconByKey|socialAccentByKey|const headerLinks/, `${file} still builds its own icon/header lists`)
    assert.doesNotMatch(source, /deriveMessengerLink|deriveWhatsappLink|resolveMessengerLink/, `${file} still normalises contact links itself`)
    assert.match(source, /contactEntries=\{contactEntries\}/, `${file} hands the entries to the surface`)
  }
  const page = read('PublicCatalogPage.tsx')
  assert.doesNotMatch(page, /socialGroups=\{socialGroups\}/, 'the surface takes no social groups')
  assert.doesNotMatch(page, /<PortalSocialText /, 'no second hand-built contact list: every list is the menu')
})

runCase('the footer and About list the same account names as the menu, with an accessible platform name', () => {
  const built = buildPortalSocialFromConfig(BASE_CONFIG, 'en')
  const entries = buildPortalContactEntries({ social: built.social, contact: built.contact, shopName: 'Leang Cosmetics', language: 'en' })
  const footer = portalContactFooterLinks(entries)
  assert.deepEqual(footer.map((link) => link.label), entries.map((entry) => entry.label), 'one name per account on every surface')
  assert.ok(footer.every((link) => !link.label.includes('@')), 'no "@" anywhere')
  assert.deepEqual(footer.map((link) => link.label).sort(), ['leang.cosmetics', 'leangcosmetics', 'leangshop'])
  const legal = read('legal/LegalPages.tsx')
  assert.match(legal, /aria-label=\{link\.accessibleName\}/)
  assert.match(legal, /<PortalSocialText text=\{link\.label\}/)
  assert.doesNotMatch(read('CatalogSecondaryTabs.tsx'), /sr-only sm:not-sr-only">\{item\.label\}/)
})

runCase('the footer states the independent-retailer line', () => {
  const legal = read('legal/LegalPages.tsx')
  assert.match(legal, /data-portal-footer-independent="true">\{text\('portal_legal_footer_independent'\)\}/)
  const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8'))
  assert.equal(en.portal_legal_footer_independent, 'Leang Cosmetics is an independent beauty retailer in Cambodia.')
})

runCase('the offers banner renders once, inside the products section, with a retry', () => {
  for (const file of ['PublicCatalogPage.tsx', 'CatalogPage.tsx']) {
    const source = read(file)
    assert.equal((source.match(/<PortalPromotionsBanner /g) || []).length, 1, `${file}: the banner is rendered in more than one place`)
    assert.equal((source.match(/promotionsBanner=\{promotionsSection\}/g) || []).length, 1, `${file}: the banner is not handed to the products section`)
    assert.doesNotMatch(source, /\bpromotionsSection=\{/, `${file}: still renders the banner a second time above the products`)
    assert.match(source, /onRetry[=:]/, `${file}: no retry on the products section`)
  }
  assert.match(read('PublicCatalogPage.tsx'), /onRetry=\{retryLoad\}/)
  const surface = read('CatalogPreviewSurface.tsx')
  assert.doesNotMatch(surface, /promotionsSection/, 'the shared surface keeps a second banner slot')
})

runCase('the stale contrast pair names the real colour of the promotions link', () => {
  const contrast = read('portalContrast.ts')
  assert.match(contrast, /name: 'promotions card link \(amber-800\)', foreground: '#92400e'/)
  assert.doesNotMatch(contrast, /sky-700/)
  assert.match(read('PortalPromotionsBanner.tsx'), /text-xs font-medium text-amber-800/)
})

runCase('FAQ and AI props are wired from the storefront page, and the dead values are gone', () => {
  const page = read('PublicCatalogPage.tsx')
  // The FAQ and About buttons keep calling the same prop (openContactSheet); it now opens the Contact menu beside the button pressed.
  assert.match(page, /onOpenContact=\{contactEntries\.length > 0 \? openContactSheet : undefined\}/)
  assert.match(page, /faqLoading=\{!realConfigInHand\}/)
  assert.match(page, /<CatalogSecondaryTabs[\s\S]*?openProductById=\{openProductById\}/)
  assert.match(page, /const openContactSheet = \(\) => \{[\s\S]*?setContactAnchor\(/, 'openContactSheet opens the menu')
  assert.match(page, /<PortalContactMenu entries=\{contactEntries\} copy=\{copy\} anchor=\{contactAnchor\} onClose=\{closeContactSheet\} \/>/)
  assert.doesNotMatch(page, /aiUsageSummary|assistantRequestPolicy|assistantExpandedProductId|AssistantExpandedProductId/)
  const tabs = read('CatalogSecondaryTabs.tsx')
  for (const prop of ['aiUsageSummary', 'assistantRequestPolicy', 'assistantExpandedProductId']) assert.ok(!tabs.includes(prop), `${prop} is read by the tabs after all`)
  const editor = read('CatalogPage.tsx')
  assert.doesNotMatch(editor, /aiUsageSummary|assistantExpandedProductId|AssistantExpandedProductId|setAssistantUsage/)
})

runCase('the editor preview decides the detail sheet stock line like the live page', () => {
  assert.match(read('CatalogPage.tsx'), /setProductDetailView\(\{[^}]*showStockStatus: shouldShowStockStatus\(\{ showStockStatus: displayConfig\.showStockStatus \}\)/)
  assert.match(read('PublicCatalogPage.tsx'), /setProductDetailView\(\{[^}]*showStockStatus: shouldShowStockStatus\(displayConfig\)/)
})

runCase('starter FAQ items 2 and 10 have their Khmer text for the current English', () => {
  for (const id of ['2', '10']) {
    const item = FAQ_STARTER_TEXT.find((entry) => entry[0] === id)
    assert.ok(item, `starter item ${id} is missing`)
    const khmer = String(localizePortalFaqText(item[2], 'km'))
    assert.ok(/[ក-៿]/.test(khmer), `item ${id} answer has no Khmer`)
    assert.ok(!/[A-Za-z]/.test(khmer), `item ${id} answer is only partly translated: ${khmer}`)
  }
})

runCase('the Khmer assistant notes name no channels', () => {
  for (const key of ['aiDisclaimer', 'assistantContactNote']) {
    const text = getPortalLanguageText('km', key)
    assert.ok(text, `${key} missing`)
    assert.doesNotMatch(text, /Instagram|Facebook|Telegram|WhatsApp/, key)
  }
})

if (failures.length) {
  console.log(`\n${failures.length} case(s) failed`)
  process.exit(1)
}
console.log('PASS public wiring: Contact menu, offers banner, FAQ props, footer and Khmer FAQ text')
