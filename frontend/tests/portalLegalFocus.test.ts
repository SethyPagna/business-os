import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const legal = fs.readFileSync(path.join(here, '..', 'src', 'components', 'catalog', 'legal', 'LegalPages.tsx'), 'utf8')
const surface = fs.readFileSync(path.join(here, '..', 'src', 'components', 'catalog', 'CatalogPreviewSurface.tsx'), 'utf8')

assert.match(legal, /ref=\{policiesTriggerRef\}/, 'the Policies opener is not a stable focus target')
assert.match(legal, /focused\?\.getAttribute\('role'\) === 'menuitem'[\s\S]{0,120}policiesTriggerRef\.current/, 'a menu item is still recorded even though opening the reader unmounts it')
assert.match(legal, /requested\?\.isConnected \? requested : fallback/, 'focus does not reject an unmounted opener')
assert.match(legal, /document\.getElementById\('portal-main-content'\)/, 'direct ?legal links have no meaningful close fallback')
assert.match(legal, /window\.requestAnimationFrame\(\(\) => \{[\s\S]{0,180}target\?\.focus\(\)/, 'focus runs before the reader unmounts')
assert.match(surface, /<main id="portal-main-content" tabIndex=\{-1\}>/, 'the direct-link fallback cannot receive programmatic focus')
assert.match(legal, /document\.body\.style\.overflow = 'hidden'/, 'opening the modal does not lock background document scroll')
assert.match(legal, /document\.body\.style\.overflow = previousOverflow/, 'closing the modal does not restore the exact prior overflow style')
assert.match(legal, /document\.documentElement\.style\.overflow = 'hidden'/, 'the document scroll owner remains scrollable behind the modal')
assert.match(legal, /document\.documentElement\.style\.overflow = previousDocumentOverflow/, 'closing the modal does not restore the document scroll owner')
assert.match(legal, /setAttribute\('inert', ''\)/, 'background landmarks remain interactive while the legal modal is open')
assert.match(legal, /removeAttribute\('inert'\)/, 'temporary inert state is not restored on close')
assert.match(legal, /event\.key !== 'Tab'[\s\S]{0,900}last\.focus\(\)[\s\S]{0,400}first\.focus\(\)/, 'Tab and Shift+Tab do not cycle within the dialog')
assert.match(legal, /event\.key === 'Escape'[\s\S]{0,100}event\.preventDefault\(\)[\s\S]{0,100}onClose\(\)/, 'Escape does not use the same close lifecycle')
assert.match(legal, /ref=\{dialogRef\}[\s\S]{0,160}aria-modal="true"[\s\S]{0,100}tabIndex=\{-1\}/, 'the modal itself cannot be focused when it has no controls')
assert.match(legal, /if \(activePage\)[\s\S]{0,180}history\.replaceState[\s\S]{0,180}else[\s\S]{0,180}history\.pushState/, 'switching policy pages adds history entries that keep the reader open after Close')
assert.match(legal, /baseDocumentTitleRef = useRef\(typeof document[\s\S]{0,160}document\.title\)/, 'direct legal links do not capture the catalogue title before the reader effect')
assert.match(legal, /return \(\) => \{ document\.title = baseDocumentTitleRef\.current \}/, 'closing a direct legal link can leave the policy title behind')

console.log('PASS legal reader traps modal focus, locks background interaction, and restores focus after close')
