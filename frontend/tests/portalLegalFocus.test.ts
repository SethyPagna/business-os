import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const legal = fs.readFileSync(path.join(here, '..', 'src', 'components', 'catalog', 'legal', 'LegalPages.tsx'), 'utf8')
const surface = fs.readFileSync(path.join(here, '..', 'src', 'components', 'catalog', 'CatalogPreviewSurface.tsx'), 'utf8')

// P-public-7 (owner, 2026-09-25): the Policies dropdown is gone; the three
// policies are always-visible footer links. The opener therefore stays
// mounted while the reader is open (only made inert), so the focused link is
// itself the stable return target -- no menuitem -> trigger redirection.
assert.doesNotMatch(legal, /role="menu"|role="menuitem"|policiesTriggerRef/, 'the policies are a dropdown again')
assert.match(legal, /data-portal-footer-policies="true"[\s\S]{0,800}LEGAL_PAGE_ORDER\.map\(\(page\) => \(\s*<a/, 'the three policies are visible links in the footer')
assert.match(legal, /returnFocusRef\.current = document\.activeElement instanceof HTMLElement \? document\.activeElement : null/, 'the opening link is recorded as the focus return target')
assert.match(legal, /requested\?\.isConnected \? requested : fallback/, 'focus does not reject an unmounted opener')
assert.match(legal, /document\.getElementById\('portal-main-content'\)/, 'direct ?legal links have no meaningful close fallback')
assert.match(legal, /window\.requestAnimationFrame\(\(\) => \{[\s\S]{0,180}target\?\.focus\(\)/, 'focus runs before the reader unmounts')
assert.match(surface, /<main id="portal-main-content" tabIndex=\{-1\}>/, 'the direct-link fallback cannot receive programmatic focus')
// The reader locks the page through the shared counted helper: a plain inline
// overflow write loses to html overflow-y: auto !important (main.css), and a
// counted lock survives nesting with the product sheet / photo viewer.
assert.match(legal, /import \{ lockDocumentScroll \} from '\.\.\/\.\.\/shared\/documentScrollLock\.ts'/, 'the reader does not use the shared scroll lock')
assert.match(legal, /const releaseScroll = lockDocumentScroll\(\)[\s\S]{0,2600}return \(\) => \{[\s\S]{0,200}releaseScroll\(\)/, 'opening the reader does not lock document scroll, or the effect cleanup does not release it')
assert.doesNotMatch(legal, /\.style\.overflow\s*=/, 'a direct overflow write bypasses the counted lock and loses to the !important scroll root')
assert.match(legal, /setAttribute\('inert', ''\)/, 'background landmarks remain interactive while the legal modal is open')
assert.match(legal, /removeAttribute\('inert'\)/, 'temporary inert state is not restored on close')
assert.match(legal, /event\.key !== 'Tab'[\s\S]{0,900}last\.focus\(\)[\s\S]{0,400}first\.focus\(\)/, 'Tab and Shift+Tab do not cycle within the dialog')
assert.match(legal, /event\.key === 'Escape'[\s\S]{0,100}event\.preventDefault\(\)[\s\S]{0,100}onClose\(\)/, 'Escape does not use the same close lifecycle')
assert.match(legal, /ref=\{dialogRef\}[\s\S]{0,160}aria-modal="true"[\s\S]{0,100}tabIndex=\{-1\}/, 'the modal itself cannot be focused when it has no controls')
assert.match(legal, /if \(activePage\)[\s\S]{0,180}history\.replaceState[\s\S]{0,180}else[\s\S]{0,180}history\.pushState/, 'switching policy pages adds history entries that keep the reader open after Close')
assert.match(legal, /baseDocumentTitleRef = useRef\(typeof document[\s\S]{0,160}document\.title\)/, 'direct legal links do not capture the catalogue title before the reader effect')
assert.match(legal, /return \(\) => \{ document\.title = baseDocumentTitleRef\.current \}/, 'closing a direct legal link can leave the policy title behind')

console.log('PASS legal reader traps modal focus, locks background interaction, and restores focus after close')
