// P11-9, replaced twice: first by the public-web overhaul (the header is ONE row, the shop name first), then by the storefront dock
// (owner asks A57-A60, A65, 21 Nov 2026): the header is the shop name and the section tabs only. Contact, List, Saved, Account,
// Language and Theme live in the bottom-right dock (tests/portalDock.test.ts), and nothing at the top is sticky.
//
// Run: node tests/p11-9-headerNameFirst.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const previewSurface = fs.readFileSync(path.join(here, '..', 'src', 'components', 'catalog', 'CatalogPreviewSurface.tsx'), 'utf8').replace(/\r\n/g, '\n')

const headerAt = previewSurface.indexOf('<header className="portal-header-shell')
const navAt = previewSurface.indexOf('<nav', headerAt)
assert.ok(headerAt > 0 && navAt > headerAt, 'the header and the tab nav still exist')
const header = previewSurface.slice(headerAt, navAt)

assert.ok(header.indexOf('<h1') > 0, 'the shop name is in the header')
assert.match(header, /<div className="flex items-center gap-2 px-1 py-2 sm:py-3">/, 'the name sits in one flex row at every width')
assert.match(header, /<div className="flex min-h-\[3\.25rem\] min-w-0 flex-1 flex-col justify-center sm:block sm:min-h-0">/, 'the name block takes the space, may shrink, and keeps room for two name lines on a phone so the tabs do not move when the name arrives')
assert.doesNotMatch(header, /row-start-|grid-cols-|col-span-/, 'no grid rows: nothing is pushed to a second row on a phone')
assert.doesNotMatch(header, /PortalSocialRow|data-portal-social-row/, 'the social chip row under the header is gone')
assert.doesNotMatch(header, /text-center/, 'the name sits at the left, not centred')

// The six controls that used to sit in the header row are gone from it (CONTROL: the same scan finds them in the dock file).
const GONE = [/<button\b/, /data-portal-header-icons/, /data-portal-contact-trigger/, /lucide-react\/dist\/esm\/icons\/(?:heart|clipboard-list|user|globe|moon|sun)\.js/, /<(?:Heart|ClipboardList|User|Globe|Moon|Sun|MessageCircle)\b/, /LazyPortalMenu/, /PortalContactMenu/]
for (const pattern of GONE) {
  assert.doesNotMatch(header, pattern, `the header must not hold ${pattern}`)
  assert.doesNotMatch(previewSurface, /<(?:Heart|ClipboardList|User|Globe|Moon|Sun|MessageCircle)\b/, 'the surface no longer draws these icons at all (the dock owns them)')
}
const dock = fs.readFileSync(path.join(here, '..', 'src', 'components', 'catalog', 'PortalDock.tsx'), 'utf8')
assert.match(dock, /icons\/heart\.js/, 'control: the dock file does hold the Heart icon, so the scan above can fail')
assert.match(dock, /<Globe\b/, 'control: and the Globe')

console.log('P11-9: the header is the shop name only; the controls moved to the dock -- PASS')
