// P11-1: "The x button just keep the icon instead of filling it and bocking
// the contact us button" -- the contact-us minimize control used to be an
// `absolute -right-1.5 -top-1.5` badge overlapping the main round button's
// own square hit box, invisible until a hover that the main button's own
// area could trigger. Now it is a sibling in a flex row (no shared pixels)
// and always painted with a solid fill.
//
// Run: node tests/p11-1-contactFabOverlap.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const publicPage = fs.readFileSync(path.join(here, '..', 'src', 'components', 'catalog', 'PublicCatalogPage.tsx'), 'utf8')

const fabBlock = /const contactFab = contactChannels\.length > 0 \?[\s\S]{0,2200}\bcontactPopover\b/.exec(publicPage)
assert.ok(fabBlock, 'the contactFab block must still exist')
const block = fabBlock[0]
assert.doesNotMatch(block, /-right-1\.5 -top-1\.5/, 'the minimize control must not be absolutely overlaid on the main button corner')
assert.doesNotMatch(block, /opacity-0/, 'the minimize control must not be invisible by default (hover-gated fill)')
assert.match(block, /flex items-center gap-1\.5/, 'the two controls must be laid out as non-overlapping flex siblings')
assert.match(block, /bg-slate-700 text-white/, 'the minimize control must be a solid filled pill, not an outline')

console.log('P11-1: contact-us minimize control no longer overlaps the main button -- PASS')
