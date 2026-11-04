// P11-1 (18 Sep): "The x button just keep the icon instead of filling it and bocking the contact us button" --
// the minimize control used to overlap the main round button's hit box. 2 Nov (owner): the Contact us float is now a
// column of brand-colour chat links shown from the first paint, with no minimize control at all. What this still
// guards: the floating buttons never share a pixel (flex siblings with a gap), none is hidden until hover, and
// the old minimize / expand stub does not come back.
//
// Run: node tests/p11-1-contactFabOverlap.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const catalog = (file: string) => fs.readFileSync(path.join(here, '..', 'src', 'components', 'catalog', file), 'utf8').replace(/\r\n/g, '\n')
const row = catalog('PortalSocialRow.tsx')
const publicPage = catalog('PublicCatalogPage.tsx')

const floatBlock = /export function PortalContactFloat[\s\S]*?\n}\n/.exec(row)
assert.ok(floatBlock, 'PortalContactFloat must exist')
const block = floatBlock[0]
assert.doesNotMatch(block, /-right-1\.5 -top-1\.5/, 'no control may be absolutely overlaid on a button corner')
assert.doesNotMatch(block, /opacity-0/, 'no button may be invisible by default (hover-gated)')
assert.match(block, /flex flex-col items-center gap-2/, 'the buttons are non-overlapping flex siblings with a gap')
assert.doesNotMatch(block, /minimi[sz]e|setContactMinimized/i, 'no minimize control')
assert.doesNotMatch(publicPage, /contactMinimized|contactUsMinimize/, 'the page keeps no minimized state')

console.log('P11-1: contact buttons are non-overlapping, always visible, and not minimizable -- PASS')
