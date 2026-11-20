// P11-9, replaced by the public-web overhaul (spec section 2, owner asks A27/A28): the header is ONE row at every
// width, the shop name first on the left and the actions on the right. The old rule put the name above two button
// rows on a phone (a grid with row-start-2 rows) and a social chip row under it; both are gone.
//
// Run: node tests/p11-9-headerNameFirst.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const previewSurface = fs.readFileSync(path.join(here, '..', 'src', 'components', 'catalog', 'CatalogPreviewSurface.tsx'), 'utf8')

const headerAt = previewSurface.indexOf('<header className="portal-header-shell')
const navAt = previewSurface.indexOf('<nav', headerAt)
assert.ok(headerAt > 0 && navAt > headerAt, 'the header and the tab nav still exist')
const header = previewSurface.slice(headerAt, navAt)

const nameAt = header.indexOf('<h1')
const iconsAt = header.indexOf('data-portal-header-icons')
assert.ok(nameAt > 0 && iconsAt > nameAt, 'the shop name comes before the action buttons')
assert.match(header, /<div className="flex items-center gap-2 px-1 py-2 sm:py-3">/, 'name and actions share one flex row at every width')
assert.match(header, /<div className="min-w-0 flex-1">/, 'the name block takes the space and may shrink')
assert.doesNotMatch(header, /row-start-|grid-cols-|col-span-/, 'no grid rows: nothing is pushed to a second row on a phone')
assert.doesNotMatch(header, /PortalSocialRow|data-portal-social-row/, 'the social chip row under the header is gone')
assert.doesNotMatch(header, /text-center/, 'the name sits at the left, not centred')
assert.match(header, /flex shrink-0 flex-nowrap items-center justify-end/, 'the actions stay on the one line')

console.log('P11-9: the header is one row, name first, actions on the right -- PASS')
