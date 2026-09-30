// UI-CONFLICTS 3.1 (owner, 30 Sep 2026): "the conflict should use the ! and
// triangle icon, make it consistent icon for other conflicts page as well".
// Every conflict surface draws the one ConflictIcon; none imports the old
// copy or git-merge icons; the Khmer section name is one word everywhere.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { ConflictIcon, CONFLICT_ICON_CLASS } from '../src/components/shared/ConflictIcon.ts'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import { getMobileSectionIcon } from '../src/components/navigation/mobileSectionIcons.ts'

const read = (rel: string) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8')
const km = JSON.parse(read('lang/km.json')) as Record<string, string>
const en = JSON.parse(read('lang/en.json')) as Record<string, string>

let failures = 0
function runTest(name: string, fn: () => void) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures++
    console.error(`FAIL ${name}`)
    console.error(String((error as Error).message))
  }
}

// Surfaces that draw the icon in JSX, and the two that hand it on as a component.
const DRAWN = [
  'components/products/ProductDuplicatesTab.tsx',
  'components/contacts/DuplicatesTab.tsx',
  'components/contacts/SaleLinkConflictsSection.tsx',
  'components/contacts/ContactImportConflictsModal.tsx',
  'components/shared/WriteConflictModal.tsx',
  'components/products/SelectedConflictMergeReviewModal.tsx',
  'components/shared/ResolveModal.tsx',
]
const PASSED_ON = ['components/navigation/mobileSectionIcons.ts', 'components/contacts/Contacts.tsx']

const OLD_ICON = /lucide-react\/dist\/esm\/icons\/(?:copy|git-merge)\.js/
const importsConflictIcon = (source: string): boolean => /import \{[^}]*\bConflictIcon\b[^}]*\} from '(?:\.\.\/shared|\.)\/ConflictIcon\.ts'/.test(source)
const drawsConflictIcon = (source: string): boolean => /<ConflictIcon aria-hidden="true" className=\{`h-(?:3\.5 w-3\.5|4 w-4) shrink-0 \$\{CONFLICT_ICON_CLASS\}`\} \/>/.test(source)

runTest('ConflictIcon is the lucide triangle with ! and one amber tone', () => {
  assert.equal(ConflictIcon, AlertTriangle)
  assert.equal(CONFLICT_ICON_CLASS, 'text-amber-600 dark:text-amber-400')
})

runTest('every conflict surface draws ConflictIcon and none imports copy or git-merge', () => {
  for (const rel of DRAWN) {
    const source = read(rel)
    assert.ok(importsConflictIcon(source), `${rel} imports ConflictIcon`)
    assert.ok(drawsConflictIcon(source), `${rel} draws ConflictIcon in the conflict amber`)
    assert.doesNotMatch(source, OLD_ICON, `${rel} still imports the copy/git-merge icon`)
  }
  for (const rel of PASSED_ON) {
    const source = read(rel)
    assert.ok(importsConflictIcon(source), `${rel} imports ConflictIcon`)
    assert.doesNotMatch(source, OLD_ICON, `${rel} still imports the copy/git-merge icon`)
    assert.doesNotMatch(source, /alert-triangle\.js/, `${rel} imports the triangle directly instead of ConflictIcon`)
  }
  // Negative controls: the shipped Conflicts tile and import modal fail the judges.
  assert.match("import Copy from 'lucide-react/dist/esm/icons/copy.js'", OLD_ICON)
  assert.match("import GitMerge from 'lucide-react/dist/esm/icons/git-merge.js'", OLD_ICON)
  assert.equal(importsConflictIcon("import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'"), false)
  assert.equal(drawsConflictIcon('<AlertTriangle className="h-4 w-4" />'), false)
})

runTest('the mobile Conflicts tiles use ConflictIcon', () => {
  assert.equal(getMobileSectionIcon('products', 'duplicates'), ConflictIcon)
  assert.equal(getMobileSectionIcon('contacts', 'duplicates'), ConflictIcon)
})

runTest('the Conflicts section reads one Khmer word everywhere', () => {
  const keys = ['conflicts', 'possible_duplicates', 'product_duplicates_section']
  for (const key of keys) {
    assert.equal(km[key], 'ទំនាស់ទិន្នន័យ', `km ${key}`)
    assert.equal(en[key], 'Conflicts', `en ${key}`)
  }
})

if (failures) {
  console.error(`conflictIconParity: ${failures} failing case(s)`)
  process.exit(1)
}
