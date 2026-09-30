// P-public-9 (owner, 2026-09-25): About overhaul + a real storefront footer
// with contact, quick links, social links and policies.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORTAL_LEGAL_EN, PORTAL_LEGAL_KM } from '../src/components/catalog/legal/legalContent.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => fs.readFileSync(path.join(here, '..', relative), 'utf8').replace(/\r\n/g, '\n')
const footer = read('src/components/catalog/legal/LegalPages.tsx')
const surface = read('src/components/catalog/CatalogPreviewSurface.tsx')
const publicPage = read('src/components/catalog/PublicCatalogPage.tsx')
const tabs = read('src/components/catalog/CatalogSecondaryTabs.tsx')

// 1. Footer columns: each renders only with content; all targets >= 40px.
assert.match(footer, /quickLinks = \[\],\s*socialLinks = \[\],/, 'both new props are optional (CatalogPage mounts the footer without them)')
assert.match(footer, /\{quickLinks\.length \? \(\s*<nav aria-label=\{text\('portal_legal_footer_quick_links'\)\}/)
assert.match(footer, /\{socialLinks\.length \? \(\s*<div className="min-w-0" data-portal-footer-social="true">/)
assert.match(footer, /href=\{link\.value\} target="_blank" rel="noreferrer"/, 'social links open outside and drop the referrer')
assert.match(footer, /data-portal-footer-policies="true"/, 'policies stay in the footer')
assert.match(footer, /FOOTER_LINK_CLASS = 'inline-flex min-h-10/, 'footer links are 40px touch targets')
assert.match(footer, /grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-4/, 'columns stack on a phone')

// 2. Quick links come from the surface's own tabs, for every footer caller.
assert.match(surface, /isValidElement<PortalFooterProps>\(footer\)\s*\? cloneElement\(footer, \{ quickLinks: portalTabs\.map/)
assert.match(surface, /\{footerWithQuickLinks\}/)
assert.doesNotMatch(surface, /^\s*\{footer\}\s*$/m, 'the raw footer node is no longer mounted')
assert.match(publicPage, /<PortalFooter [^>]*socialLinks=\{socialLinks\}/, 'the storefront hands the footer its configured social links')

// 3. Headings exist in both languages, and km is not English.
for (const key of ['portal_legal_footer_contact', 'portal_legal_footer_quick_links', 'portal_legal_footer_follow'] as const) {
  assert.ok(PORTAL_LEGAL_EN[key], `en ${key}`)
  assert.ok(PORTAL_LEGAL_KM[key], `km ${key}`)
  assert.notEqual(PORTAL_LEGAL_EN[key], PORTAL_LEGAL_KM[key], `km ${key} is untranslated`)
}

// 4. About: the story no longer prints twice (hero intro used to fall back
//    to it), and on a phone the story comes before the contact tray.
assert.doesNotMatch(tabs, /previewConfig\.intro \|\| storyText/, 'the hero intro falls back to the story again')
assert.match(tabs, /const introText = configuredIntro && configuredIntro !== storyText \? configuredIntro : ''/)
const about = tabs.slice(tabs.indexOf('function CatalogAboutSection'), tabs.indexOf('function CatalogFaqSection'))
assert.ok(about.indexOf('<OwnerText text={storyText} />') < about.indexOf('data-portal-contact-tray="true"'), 'story card precedes the contact tray in DOM order')
assert.doesNotMatch(about, /h-9 min-w-9/, 'social buttons are 40px targets')

console.log('PASS storefront footer columns and About story order')
