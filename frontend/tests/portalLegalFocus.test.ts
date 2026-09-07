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
assert.match(legal, /setAttribute\('inert', ''\)/, 'background landmarks remain interactive while the legal modal is open')
assert.match(legal, /removeAttribute\('inert'\)/, 'temporary inert state is not restored on close')
assert.match(legal, /event\.key !== 'Tab'[\s\S]{0,900}last\.focus\(\)[\s\S]{0,400}first\.focus\(\)/, 'Tab and Shift+Tab do not cycle within the dialog')
assert.match(legal, /event\.key === 'Escape'[\s\S]{0,100}event\.preventDefault\(\)[\s\S]{0,100}onClose\(\)/, 'Escape does not use the same close lifecycle')
assert.match(legal, /ref=\{dialogRef\}[\s\S]{0,160}aria-modal="true"[\s\S]{0,100}tabIndex=\{-1\}/, 'the modal itself cannot be focused when it has no controls')

console.log('PASS legal reader traps modal focus, locks background interaction, and restores focus after close')
