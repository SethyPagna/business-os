// Field history on a product and on a contact: where the affordance is, what
// it reads, and who may see it.
//
// The owner, Sep 22 2026: "having records in sales, returns, stock changes,
// products, invoices, etc... make sure these records are having them there as
// well as in the actual audit log".
//
// The rendered contract (rows, who, before/after, press-to-open, both packs)
// is pinned in recordsFloatRendered.test.ts against the real component, and
// the per-entity before/after fixtures in auditLogEntityLabels.test.ts. What
// is pinned HERE is the wiring no rendered test can see: the endpoint, the
// cache key, the permission tier, and the sibling surfaces that must carry the
// same affordance -- a product has TWO detail panes and contacts have THREE
// tabs, and a capability on one of them only is a capability nobody finds.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

let failed = 0
const test = (name: string, fn: () => void): void => {
  try { fn(); console.log(`PASS ${name}`) }
  catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

test('one record\'s trail is read from the audit endpoint, scoped and per record', () => {
  const transport = read('../src/api/auditLogTransport.ts')
  assert.match(transport, /export function getEntityAuditRecords\(entity: string, entityId: string \| number/)
  assert.match(transport, /entityId: String\(entityId\)/, 'without the id filter this is the whole audit log')
  assert.match(transport, /`audit_log:entity:\$\{entity\}:\$\{entityId\}`/, 'a shared cache key would show product A history on product B')
  // There is no honest offline version of "who edited this product": the
  // generic fallback answers with the newest rows the device holds, whatever
  // record they belong to.
  const entityRead = transport.slice(transport.indexOf('export function getEntityAuditRecords'))
  assert.match(entityRead, /raceLocalFallback: false/)
  assert.match(entityRead, /\n {4}null,\n/, 'the entity-scoped read must pass NO local fallback at all')
  // POSITIVE CONTROL: the page-level read in the same file DOES keep its local
  // mirror fallback, so the assertion above is capable of failing.
  const pageRead = transport.slice(transport.indexOf('export function getAuditLogs'), transport.indexOf('export function getEntityAuditRecords'))
  assert.match(pageRead, /getLocalDbModule\(\)/)
})

test('the float is the shared one, keyed on the record it shows', () => {
  const float = read('../src/components/shared/EntityRecordsFloat.tsx')
  assert.match(float, /import RecordsFloat from '\.\/RecordsFloat\.tsx'/)
  assert.match(float, /recordKey=\{`\$\{entity\}:\$\{entityId\}`\}/)
  assert.match(float, /adapter=\{ENTITY_RECORDS_ADAPTER\}/)
  assert.match(float, /getEntityAuditRecords\(entity, entityId\)\.then\(auditPayloadToRecords\)/)
  // A second copy of the chrome or of the change table is the thing this
  // wrapper exists to prevent.
  assert.doesNotMatch(float, /<Modal |<FilterMenu |<thead/)
})

test('BOTH product detail panes carry Field history, on the same terms', () => {
  const panes = [
    read('../src/components/inventory/ProductDetailModal.tsx'),
    read('../src/components/products/surfaces/ProductDetailModal.tsx'),
  ]
  for (const pane of panes) {
    assert.match(pane, /data-product-field-history=""/)
    assert.match(pane, /getPermissionTier\('audit_log'\) === 'full'/)
    assert.match(pane, /entity="product"/)
    assert.match(pane, /field_history/)
    // Khmer subscripts clip in a Latin line box.
    assert.match(pane, /leading-relaxed[^]{0,80}field_history/)
    // It sits with the other per-product history affordance, not in a corner
    // of its own.
    assert.match(pane, /stock_history|batches|view_batches/i)
  }
})

test('the phone gets it too: the product pane renders it in both responsive slots', () => {
  // The products-side pane builds its rows once and places them in a desktop
  // column and a phone block; a capability added to one of the two is
  // invisible on the device the owner actually uses.
  const pane = read('../src/components/products/surfaces/ProductDetailModal.tsx')
  const slots = pane.split('{fieldHistoryButton}').length - 1
  assert.equal(slots, 2, `field history is rendered in ${slots} of the 2 responsive slots`)
  assert.match(pane, /const fieldHistoryButton = canReadFieldHistory && Number\(p\.id\) > 0 \? \(/)
})

test('Field history is named in BOTH packs', () => {
  const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
  const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
  assert.equal(typeof en.field_history, 'string')
  assert.equal(typeof km.field_history, 'string')
  assert.notEqual(km.field_history, en.field_history, 'the Khmer pack still holds the English words')
})

if (failed) { console.error(`${failed} entity records surface case(s) failed`); process.exit(1) }
console.log('entity records surface: all cases pass')
