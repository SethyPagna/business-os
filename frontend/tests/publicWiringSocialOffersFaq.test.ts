// 6.0.875 public wiring: the social row (handles, own scrolling row, account picker),
// the offers banner rendered once, the FAQ/AI props, the footer and the Khmer FAQ text.
// Run: node tests/publicWiringSocialOffersFaq.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import { buildPortalSocialFromConfig, flattenPortalSocialGroups } from '../src/components/catalog/portalSocialLinks.ts'
import { FAQ_STARTER_TEXT } from '../src/components/catalog/faqStarterText.ts'
import { localizePortalFaqText } from '../src/components/catalog/portalContentI18n.ts'
import { getPortalLanguageText } from '../src/components/catalog/portalLanguagePacks.ts'
import { withShopName } from '../src/app/clientIdentity.ts'
import { LEANG_CLIENT_IDENTITY } from './leangClientIdentity.ts'

const read = (rel: string) => fs.readFileSync(new URL(`../src/components/catalog/${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const require = createRequire(import.meta.url)
const React = require('react')
const render = require('react-dom/server').renderToStaticMarkup as (node: unknown) => string

function compile(rel: string, resolve: (id: string) => unknown): Record<string, any> {
  const code = transformSync(read(rel), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  const mod = { exports: {} as Record<string, any> }
  new Function('require', 'module', 'exports', code)(resolve, mod, mod.exports)
  return mod.exports
}

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

const Icon = () => null
const brand = (() => {
  const code = transformSync(fs.readFileSync(new URL('../src/components/shared/BrandIcons.tsx', import.meta.url), 'utf8'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  const mod = { exports: {} as Record<string, any> }
  new Function('require', 'module', 'exports', code)((id: string) => require(id), mod, mod.exports)
  return mod.exports
})()
const socialHandles = await import('../src/utils/socialHandles.ts') as Record<string, any>
const scriptTypography = await import('../src/utils/scriptTypography.ts') as Record<string, any>
const row = compile('PortalSocialRow.tsx', (id) => {
  if (id === 'react' || id === 'react/jsx-runtime') return require(id)
  if (id.startsWith('lucide-react/')) return { __esModule: true, default: Icon }
  // The real menu opens on tap; the markup test only needs its trigger.
  if (id.endsWith('/LazyPortalMenu')) return { __esModule: true, default: (props: { trigger: unknown }) => props.trigger }
  if (id.endsWith('/BrandIcons.tsx')) return brand
  if (id.endsWith('/scriptTypography.ts')) return scriptTypography
  if (id.endsWith('/socialHandles.ts')) return socialHandles
  throw new Error(`PortalSocialRow.tsx imports ${id}, which this harness does not provide`)
})
const copy = (_key: string, fallback = '') => fallback
const renderRow = (groups: unknown, language = 'en', mapLink = '') => render(React.createElement(row.default, { groups, pageLanguage: language, copy, mapLink }))

const BASE_CONFIG = {
  showWebsite: true, showFacebook: true, showInstagram: true, showTelegram: true,
  // The Worker fills these default names into linkLabels; they must count as "no label".
  linkLabels: { website: 'Website', facebook: 'Facebook', instagram: 'Instagram', telegram: 'Telegram' },
  links: { website: '', facebook: 'https://www.facebook.com/leangcosmetics', instagram: 'https://instagram.com/leang.cosmetics', telegram: '@leangshop' },
}

runCase('the header row shows each account handle, never the platform name', () => {
  const { social } = buildPortalSocialFromConfig(BASE_CONFIG, 'en')
  const markup = renderRow(social)
  for (const handle of ['@leangcosmetics', '@leang.cosmetics', '@leangshop']) assert.ok(markup.includes(`>${handle}</span>`), `${handle} is not the visible text`)
  for (const name of ['Facebook', 'Instagram', 'Telegram']) assert.ok(!markup.includes(`>${name}</span>`), `${name} is rendered as visible text`)
  // The platform is still named for assistive technology.
  assert.ok(markup.includes('aria-label="Facebook: @leangcosmetics"'))
})

runCase('an owner-typed label replaces the handle, and handles stay Latin and untranslated', () => {
  const { social } = buildPortalSocialFromConfig({ ...BASE_CONFIG, linkLabels: { ...BASE_CONFIG.linkLabels, facebook: 'Leang Official' } }, 'en')
  const markup = renderRow(social)
  assert.ok(markup.includes('>Leang Official</span>'))
  assert.match(markup, /translate="no" lang="en" dir="ltr" class="notranslate [^"]*">@leang\.cosmetics</)
})

runCase('the social links are their own row that scrolls sideways, with 44px targets', () => {
  const markup = renderRow(buildPortalSocialFromConfig(BASE_CONFIG, 'en').social)
  const nav = /<nav [^>]*data-portal-social-row="true"[^>]*>/.exec(markup)?.[0] || ''
  assert.ok(nav, 'no dedicated social row')
  assert.match(nav, /overflow-x-auto/)
  assert.match(nav, /flex-nowrap/)
  assert.match(nav, /min-h-11/)
  const anchors = markup.match(/<a [^>]*>/g) || []
  assert.equal(anchors.length, 3)
  for (const anchor of anchors) assert.match(anchor, /min-h-11/, anchor)
  const surface = read('CatalogPreviewSurface.tsx')
  // Outside the three-cell header grid, so the row never competes with the title and the account icons.
  assert.ok(surface.indexOf('<PortalSocialRow') > surface.indexOf('</header>') - 400 && surface.indexOf('<PortalSocialRow') < surface.indexOf('</header>'))
  assert.doesNotMatch(surface, /headerLinks/)
})

runCase('a platform with several accounts becomes one picker button; a single account stays a plain link', () => {
  const { social } = buildPortalSocialFromConfig({
    ...BASE_CONFIG,
    links: { ...BASE_CONFIG.links, facebook: ['https://facebook.com/leangcosmetics', 'https://facebook.com/leangbeauty'] },
  }, 'en')
  const markup = renderRow(social)
  assert.equal((markup.match(/data-portal-social-picker="facebook"/g) || []).length, 1)
  assert.match(markup, /<button [^>]*aria-label="Choose account: Facebook"/)
  assert.ok(markup.includes('>+1</span>'), 'the picker shows how many more accounts it holds')
  assert.equal((markup.match(/data-portal-social-picker/g) || []).length, 1, 'Instagram and Telegram have one account each and stay links')
  assert.ok(markup.includes('href="https://instagram.com/leang.cosmetics"'))
})

runCase('Khmer storefront: the picker and row names are Khmer-aware while handles stay Latin', () => {
  const { social } = buildPortalSocialFromConfig({ ...BASE_CONFIG, links: { ...BASE_CONFIG.links, facebook: ['https://facebook.com/a1b2', 'https://facebook.com/c3d4'] } }, 'km')
  const markup = renderRow(social, 'km')
  assert.ok(markup.includes('ហ្វេសប៊ុក') || markup.includes('Facebook'), 'platform name present for assistive technology')
  assert.ok(markup.includes('>@a1b2</span>'))
})

runCase('every page and sheet builds its social data through the one builder', () => {
  for (const file of ['PublicCatalogPage.tsx', 'CatalogPage.tsx']) {
    const source = read(file)
    assert.match(source, /buildPortalSocialFromConfig\(/, file)
    assert.doesNotMatch(source, /socialIconByKey|contactIconByKey|socialAccentByKey|const headerLinks/, `${file} still builds its own icon/header lists`)
    assert.doesNotMatch(source, /deriveMessengerLink|deriveWhatsappLink|resolveMessengerLink/, `${file} still normalises contact links itself`)
  }
  const page = read('PublicCatalogPage.tsx')
  assert.match(page, /socialGroups=\{socialGroups\}/)
  assert.match(page, /<PortalSocialText text=\{item\.label\} latin=\{item\.latin\} \/>/, 'contact sheets show the handle')
  assert.equal((page.match(/<PortalSocialText /g) || []).length, 2, 'both contact lists (My List and the Contact button) render handles')
})

runCase('the footer and About list handles with an accessible platform name', () => {
  const { social } = buildPortalSocialFromConfig(BASE_CONFIG, 'en')
  const flat = flattenPortalSocialGroups(social)
  assert.deepEqual(flat.map((link) => link.label), ['@leangcosmetics', '@leang.cosmetics', '@leangshop'])
  assert.deepEqual(flat.map((link) => link.key), ['facebook-0', 'instagram-0', 'telegram-0'])
  const legal = read('legal/LegalPages.tsx')
  assert.match(legal, /aria-label=\{link\.accessibleName\}/)
  assert.match(legal, /<PortalSocialText text=\{link\.label\}/)
  assert.doesNotMatch(read('CatalogSecondaryTabs.tsx'), /sr-only sm:not-sr-only">\{item\.label\}/)
})

runCase('the footer states the independent-retailer line', () => {
  const legal = read('legal/LegalPages.tsx')
  assert.match(legal, /data-portal-footer-independent="true">\{text\('portal_legal_footer_independent'\)\}/)
  const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8'))
  assert.equal(LEANG_CLIENT_IDENTITY.shopCategory, 'beauty', 'Leang keeps the beauty-retailer line')
  assert.equal(withShopName(en.portal_legal_footer_independent, LEANG_CLIENT_IDENTITY), 'Leang Cosmetics is an independent beauty retailer in Cambodia.')
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
  assert.match(page, /onOpenContact=\{contactChannels\.length > 0 \? openContactSheet : undefined\}/)
  assert.match(page, /faqLoading=\{!realConfigInHand\}/)
  assert.match(page, /<CatalogSecondaryTabs[\s\S]*?openProductById=\{openProductById\}/)
  assert.match(page, /const openContactSheet = \(\) => \{\s*setContactMinimized\(false\)\s*setContactOpen\(true\)/)
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
console.log('PASS public wiring: social row, offers banner, FAQ props, footer and Khmer FAQ text')
