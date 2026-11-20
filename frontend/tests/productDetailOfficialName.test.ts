// Owner, 2026-09-25 (P-public-3): "Official Product Name" shows ONLY a
// dedicated official name and is hidden when there is none -- never the
// shop's own product name. And no "Not provided yet" rows for Introduction,
// Features & Benefits, Who is it for, Ingredients.
//
// The official name is the "Official Product Name:" section of
// products.description (no column of its own). The migration copied the shop
// name into it on 6030 of 6031 products, so the fixtures below are that real
// shape: a description whose official-name line repeats the product name.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseProductDescription, resolveOfficialProductName, resolveProductNames } from '../src/components/catalog/productDetailSections.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => fs.readFileSync(path.join(here, '..', relative), 'utf8').replace(/\r\n/g, '\n')

// 1. The migrated shape: official line == shop name -> no row. The plain
//    "show parsed.officialName when present" implementation shows the shop
//    name here, which is the bug.
const migrated = parseProductDescription('Official Product Name:\nAbercrombie & Fitch Authentic EDT 100ml')
assert.equal(migrated.officialName, 'Abercrombie & Fitch Authentic EDT 100ml', 'the parser still reads the line')
assert.equal(resolveOfficialProductName(migrated.officialName, 'Abercrombie & Fitch Authentic EDT 100ml'), '')
// Case, spacing and punctuation differences are still "the same name".
assert.equal(resolveOfficialProductName('ABERCROMBIE & FITCH  authentic edt 100ML.', 'Abercrombie & Fitch Authentic EDT 100ml'), '')
assert.equal(resolveOfficialProductName('សេរ៉ូម  ភ្លឺ', 'សេរ៉ូម ភ្លឺ'), '', 'Khmer: same name with different spacing')

// 2. A real official name is shown exactly as written.
const researched = parseProductDescription('Official Product Name:\nAbercrombie & Fitch Authentic Man Eau de Toilette 100 ml\n\nIntroduction:\nA woody fragrance.')
assert.equal(resolveOfficialProductName(researched.officialName, 'A&F Authentic EDT 100ml'), 'Abercrombie & Fitch Authentic Man Eau de Toilette 100 ml')
// Khmer marks are part of the name: two different Khmer words must not
// collapse into one comparable string.
assert.equal(resolveOfficialProductName('សេរ៉ូមភ្លឺ', 'សារ៉ាមភ្លឺ'), 'សេរ៉ូមភ្លឺ')

// 3. No official line at all -> nothing, and never a fallback to the name.
assert.equal(resolveOfficialProductName(parseProductDescription('Just a paragraph.').officialName, 'Night Cream'), '')
assert.equal(resolveOfficialProductName('', 'Night Cream'), '')
assert.equal(resolveOfficialProductName('   ', 'Night Cream'), '')
assert.equal(resolveOfficialProductName('---', 'Night Cream'), '', 'punctuation alone is not a name')

// 4. The heading: the official name when it differs, the shop name otherwise (the helper above
//    never falls back; this is where the fallback lives). The shop name is the second line only
//    when it is not the heading.
const differs = resolveProductNames({ name: 'A&F Authentic EDT 100ml', description: 'Official Product Name:\nAbercrombie & Fitch Authentic Man Eau de Toilette 100 ml' })
assert.deepEqual(differs, { heading: 'Abercrombie & Fitch Authentic Man Eau de Toilette 100 ml', shopLine: 'A&F Authentic EDT 100ml' })
const equal = resolveProductNames({ name: 'Night Cream', description: 'Official Product Name:\nNIGHT  cream.' })
assert.deepEqual(equal, { heading: 'Night Cream', shopLine: '' }, 'a copy of the shop name is no official name')
assert.deepEqual(resolveProductNames({ name: 'Night Cream', description: 'Official Product Name:\n' }), { heading: 'Night Cream', shopLine: '' }, 'empty official line')
assert.deepEqual(resolveProductNames({ name: 'Night Cream', description: 'Introduction:\nA rich cream.' }), { heading: 'Night Cream', shopLine: '' }, 'no official label')
assert.deepEqual(resolveProductNames({ name: 'Night Cream' }), { heading: 'Night Cream', shopLine: '' }, 'no description')
assert.deepEqual(resolveProductNames({ name: '  Night Cream ', description: null }), { heading: 'Night Cream', shopLine: '' })
assert.deepEqual(resolveProductNames({ name: 'សេរ៉ូម', description: 'official product name: សេរ៉ូមភ្លឺ' }), { heading: 'សេរ៉ូមភ្លឺ', shopLine: 'សេរ៉ូម' }, 'case-insensitive label, Khmer name')

// 5. The flyout renders the heading from the one function, the shop line only when it exists, and every
//    optional row is gated on having a value.
const flyout = read('src/components/catalog/ProductDetailFlyout.tsx')
assert.match(flyout, /const \{ heading: productHeading, shopLine \} = resolveProductNames\(product\)/)
assert.match(flyout, /\{shopLine \? \(\s*<div className=\{`mt-0\.5[^\n]*\n\s*<span>\{copy\('productInStore', 'In store', 'ក្នុងហាង'\)\}/)
assert.doesNotMatch(flyout, /officialName/, 'the sheet no longer prints an "Official name" row')
