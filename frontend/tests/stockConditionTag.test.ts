import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  DEFAULT_STOCK_CONDITION_TAG,
  STOCK_CONDITION_SOURCES,
  STOCK_CONDITION_TAGS,
  isStockConditionTag,
  stockConditionLabel,
} from '../src/utils/stockCondition.ts'

// P3-L6. Three contracts that live in two places each and would drift
// silently:
//
//   1. The tag/source lists in cloudflare/src/lib/stockCondition.ts and
//      frontend/src/utils/stockCondition.ts. A frontend that offers a tag the
//      Worker rejects produces a 400 the operator cannot act on; a Worker tag
//      the frontend does not know renders as the wrong label.
//   2. The tag is ENGLISH in every language ("the tag remains english even in
//      khmer"). The regression that would break it is someone wrapping the
//      label in tr(), so that is what is asserted -- at the source level,
//      because a unit test of stockConditionLabel() cannot see a tr() added in
//      a component.
//   3. The keep-or-destroy choice is ONE compact row on small and large
//      screens, in both modals that offer it.

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..')
const readSource = (relativePath: string): string => readFileSync(resolve(repo, relativePath), 'utf8')
/** Assertions about what the CODE does must not be satisfied -- or defeated --
  * by a comment that spells the forbidden shape out, which the comments in
  * these very files deliberately do. */
const stripComments = (source: string): string => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')

let failed = 0

function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

/** Pull an `export const NAME = [...] as const` list out of a TS source. */
function parseConstList(source: string, name: string): string[] {
  const match = new RegExp(`export const ${name} = \\[([^\\]]*)\\]`).exec(source)
  assert.ok(match, `${name} not found`)
  return (match[1].match(/'[^']*'/g) || []).map((token) => token.slice(1, -1))
}

const workerSource = readSource('cloudflare/src/lib/stockCondition.ts')

runTest('tag list and order are identical in the Worker and the frontend', () => {
  assert.deepEqual(parseConstList(workerSource, 'STOCK_CONDITION_TAGS'), [...STOCK_CONDITION_TAGS])
  // Order is part of the contract, not an accident: it is the order of the
  // dropdown, so a reordered Worker list would silently reorder the UI.
  assert.deepEqual([...STOCK_CONDITION_TAGS], ['broken', 'damaged', 'expired', 'opened', 'other'])
})

runTest('source list and default tag are identical in the Worker and the frontend', () => {
  assert.deepEqual(parseConstList(workerSource, 'STOCK_CONDITION_SOURCES'), [...STOCK_CONDITION_SOURCES])
  const workerDefault = /DEFAULT_STOCK_CONDITION_TAG: StockConditionTag = '([a-z]+)'/.exec(workerSource)
  assert.ok(workerDefault, 'Worker default tag not found')
  assert.equal(workerDefault[1], DEFAULT_STOCK_CONDITION_TAG)
  // Migration 0162 backfills 0074's existing rows with exactly this pair.
  assert.equal(DEFAULT_STOCK_CONDITION_TAG, 'damaged')
  assert.ok((STOCK_CONDITION_SOURCES as readonly string[]).includes('return'))
})

runTest('every tag validates, and nothing else does', () => {
  for (const tag of STOCK_CONDITION_TAGS) assert.equal(isStockConditionTag(tag), true)
  for (const value of ['', ' ', 'Damaged', 'lost', 'បាក់បែក', null, undefined, 0, {}]) {
    assert.equal(isStockConditionTag(value), false)
  }
})

runTest('the rendered label is the raw English token in any language', () => {
  for (const tag of STOCK_CONDITION_TAGS) {
    assert.equal(stockConditionLabel(tag), tag)
    // Case and padding are normalised, never translated or prettified.
    assert.equal(stockConditionLabel(` ${tag.toUpperCase()} `), tag)
    assert.match(stockConditionLabel(tag), /^[a-z]+$/)
  }
  // An unknown value falls back to the default tag rather than rendering an
  // empty cell -- a held row with a blank name is unactionable.
  assert.equal(stockConditionLabel('nonsense'), DEFAULT_STOCK_CONDITION_TAG)
})

runTest('no pack entry exists for translating a condition tag', () => {
  // The packs do carry unrelated generic words ("Damaged", "Expired",
  // "Other") that older surfaces use, so the bare token being present proves
  // nothing either way. What must never exist is a key SHAPED like a tag
  // translation -- the artefact a future "let us localise the tags" change
  // would leave behind, which is exactly what the owner ruled out.
  for (const pack of ['frontend/src/lang/en.json', 'frontend/src/lang/km.json']) {
    const keys = Object.keys(JSON.parse(readSource(pack)) as Record<string, unknown>)
    for (const tag of STOCK_CONDITION_TAGS) {
      for (const shape of [`stock_condition_${tag}`, `condition_tag_${tag}`, `stock_tag_${tag}`]) {
        assert.equal(keys.includes(shape), false, `${pack} translates the tag "${tag}" as ${shape}`)
      }
    }
  }
})

runTest('the tag option label never goes through the translator', () => {
  const control = readSource('frontend/src/components/inventory/StockConditionTagRow.tsx')
  // Each option's label IS the constant. A translator call wrapped around it
  // is the regression this guards -- checked against the CODE, with comments
  // stripped, because the comments in that file deliberately name the very
  // shape being forbidden.
  assert.match(control, /STOCK_CONDITION_TAGS\.map\(\(tag\) => \(\{ value: tag, label: tag \}\)\)/)
  assert.doesNotMatch(stripComments(control), /\bt?r?\(\s*tag\s*[,)]/)
  assert.doesNotMatch(stripComments(control), /label:\s*t?r?\(/)
  const rows = readSource('frontend/src/components/products/TaggedStockRows.tsx')
  assert.match(rows, /stockConditionLabel\(row\.condition_tag\)/)
  assert.doesNotMatch(stripComments(rows), /tr\([^)]*stockConditionLabel/)
})

runTest('the choice is one compact row, in both modals that offer it', () => {
  const control = readSource('frontend/src/components/inventory/StockConditionTagRow.tsx')
  // One flex row holding both segments AND the tag dropdown -- not a stacked
  // block that grows the modal on a phone. min-w-0 is what keeps the select
  // from pushing the segments off a 320px screen.
  assert.match(control, /flex w-full min-w-0 items-center/)
  assert.match(control, /data-stock-condition-row=\{mode\}/)
  // No responsive stacking: the row is the same row on every screen size.
  assert.doesNotMatch(control, /(sm|md|lg):flex-col/)
  assert.doesNotMatch(control, /flex-col[^"]*(sm|md|lg):flex-row/)

  for (const host of [
    'frontend/src/components/inventory/InventoryStockModals.tsx',
    'frontend/src/components/inventory/FastStockInModal.tsx',
  ]) {
    const source = readSource(host)
    assert.match(source, /import StockConditionTagRow from '\.\/StockConditionTagRow'/, `${host} does not import the control`)
    assert.match(source, /<StockConditionTagRow/, `${host} does not render the control`)
    // Exactly one control per surface: two would mean two competing values.
    assert.equal((source.match(/<StockConditionTagRow/g) || []).length, 1, `${host} renders the control more than once`)
  }
})

runTest('a set never offers a tag, on either surface', () => {
  // A "set" is a target figure whose direction the server decides, so it has
  // no quantity of its own to tag; POST /inventory/adjust refuses a tag on a
  // set, and neither modal may offer one.
  const modals = readSource('frontend/src/components/inventory/InventoryStockModals.tsx')
  assert.match(modals, /adjustForm\.type === 'remove' \|\| adjustForm\.type === 'add' \? \(/)
  const fast = readSource('frontend/src/components/inventory/FastStockInModal.tsx')
  assert.match(fast, /\{mode !== 'set' \? \(/)
  assert.match(fast, /conditionTag: mode === 'set' \? '' : conditionTag/)
})

runTest('held units are excluded from sellable stock, structurally', () => {
  // The held rows arrive on their own wire and are never merged into the
  // product records that build group totals, pickers and POS lists.
  const grouping = readSource('frontend/src/utils/productGrouping.ts')
  assert.doesNotMatch(grouping, /condition_tag|damaged_stock_lots|taggedLots/)
  const products = readSource('frontend/src/components/products/Products.tsx')
  assert.match(products, /getTaggedLots\(ids\)/)
  // The held rows feed the render slots only -- never the product arrays the
  // totals are computed from.
  assert.doesNotMatch(products, /setProducts\([^)]*tagged/i)
})

runTest('a tagged movement is not offered a ledger revert', () => {
  // 'in' is on the revert allowlist, so a restore-to-sellable would otherwise
  // be revertible from the Stock Change ledger -- taking the units out of
  // sellable stock without putting them back on the held row.
  const detail = readSource('frontend/src/utils/stockMovementDetail.ts')
  assert.match(detail, /DAMAGED_LOT_REFERENCE_PREFIX = 'damaged_lot:'/)
  assert.match(detail, /startsWith\(DAMAGED_LOT_REFERENCE_PREFIX\)\) return false/)
  const section = readSource('frontend/src/components/products/StockChangeSection.tsx')
  assert.match(section, /isRevertibleStockMovement\(detail\.movement_type, detail\.reference_id\)/)
  // And the same refusal exists server-side, where it is enforced.
  assert.match(workerSource, /export const DAMAGED_LOT_REFERENCE_PREFIX = 'damaged_lot:'/)
  assert.match(readSource('cloudflare/src/lib/stockRevert.ts'), /isDamagedLotReference\(m\.reference_id\)/)
})

runTest('holding and disposing are different movement types', () => {
  // The double-count guard: keeping units as tagged is NOT a loss, disposing
  // of them is, and a keep-then-dispose of the same unit must be charged once.
  assert.match(workerSource, /TAGGED_HOLD_MOVEMENT_TYPE = 'damage_out'/)
  assert.match(workerSource, /TAGGED_DISPOSAL_MOVEMENT_TYPE = 'write_off'/)
  assert.match(workerSource, /TAGGED_RESTORE_MOVEMENT_TYPE = 'in'/)
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('stockConditionTag tests passed')
