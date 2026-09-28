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
import { parseProductDescription, resolveOfficialProductName } from '../src/components/catalog/productDetailSections.ts'

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

// 4. The flyout renders the row only from the resolver, and every
//    optional row is gated on having a value.
const flyout = read('src/components/catalog/ProductDetailFlyout.tsx')
assert.match(flyout, /const officialName = resolveOfficialProductName\(parsed\.officialName, product\.name\)/)
assert.match(flyout, /\{officialName \? \(\s*<DetailField label=\{copy\('productOfficialName'/)
assert.doesNotMatch(flyout, /parsed\.officialName \|\||officialName \|\| product\.name|product\.name \|\| parsed\.officialName/, 'no fallback path to the shop name')
assert.match(flyout, /\{parsed\.intro \? \(\s*<DetailField label=\{copy\('productIntroduction'/)
assert.match(flyout, /\{categoryValues\.length \? \(\s*<DetailField label=\{copy\('productCategory'/)
assert.match(flyout, /\{brandValues\.length \? \(\s*<DetailField label=\{copy\('productBrand'/)
const block = flyout.slice(flyout.indexOf('function DetailSectionBlock'), flyout.indexOf('const FOCUSABLE_SELECTOR'))
assert.match(block, /if \(!items\.length\) return null/, 'an empty Features / Who-for / Ingredients section renders nothing')
assert.doesNotMatch(flyout, /productDetailNotProvided|Not provided yet/, 'no "Not provided yet" text left on the storefront detail')

console.log('PASS official name never repeats the shop name and empty detail rows are hidden')
