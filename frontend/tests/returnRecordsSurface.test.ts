// A return's Records affordance: where it is, what it costs, and who may see it.
//
// The owner, Sep 22 2026, named returns first among the records that were
// missing. The rendered contract (rows, who, before/after, press-to-open) is
// pinned in recordsFloatRendered.test.ts against the real component; what is
// pinned HERE is the wiring that a rendered test cannot see -- the endpoint the
// transport calls, the permission tier the affordance sits behind, and that
// opening a return's records does not fetch the same thing twice.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

let failed = 0
const test = (name: string, fn: () => void): void => {
  try { fn(); console.log(`PASS ${name}`) }
  catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

test('the transport reads the returns records endpoint, per id, without a fabricated fallback', () => {
  const transport = read('../src/api/returnsReadTransport.ts')
  assert.match(transport, /\/api\/returns\/\$\{encodeId\(id\)\}\/records/)
  assert.match(transport, /`returns:records:\$\{encodeId\(id\)\}`/, 'a shared cache key would show return A history on return B')
  // Same rule the sale's records transport follows: there is no honest offline
  // version of "who edited this return".
  assert.match(transport, /getReturnRecords[\s\S]*raceLocalFallback: false/)
})

test('Records is a READ on the return detail, not gated on the edit permission', () => {
  const modal = read('../src/components/returns/ReturnDetailModal.tsx')
  assert.match(modal, /data-return-records-action=""/)
  assert.match(modal, /onClick=\{onOpenRecords\}/)
  // The count is the owner's "total records", not a bare link.
  assert.match(modal, /\{recordsCount \?\? '—'\}/)
  assert.doesNotMatch(modal, /onEdit && onOpenRecords|canEdit[\s\S]{0,40}onOpenRecords/, 'the trail must not hide behind the write permission')

  const page = read('../src/components/returns/Returns.tsx')
  assert.match(page, /onOpenRecords=\{\(\) => setRecordsRet\(detailRet\)\}/)
  // POSITIVE CONTROL: the same file DOES gate a write on a permission, so the
  // assertion above is capable of failing rather than always passing.
  assert.match(page, /onEdit=\{canEditReturn &&/)
})

test('the float is the shared one, keyed on this return', () => {
  const page = read('../src/components/returns/Returns.tsx')
  assert.match(page, /import\('\.\.\/shared\/RecordsFloat'\)/, 'returns must not carry their own float')
  assert.match(page, /adapter=\{RETURN_RECORDS_ADAPTER\}/)
  assert.match(page, /recordKey=\{`return:\$\{recordsRet\.id\}`\}/)
  assert.doesNotMatch(page, /ReturnRecordsFloat/, 'a second float is the thing this lane exists to avoid')
})

test('the count and the float share one read', () => {
  const modal = read('../src/components/returns/ReturnDetailModal.tsx')
  const page = read('../src/components/returns/Returns.tsx')
  // Both go through getReturnRecords, so the cached route answers the float
  // from the same response that produced the count on the line.
  assert.match(modal, /getReturnRecords as fetchReturnRecords/)
  assert.match(page, /getReturnRecords as fetchReturnRecords/)
  assert.doesNotMatch(modal, /setRecordsCount\(0\)/, 'a failed count must not claim zero records')
})

test('every kind the Worker emits has a label in both packs', () => {
  const worker = read('../../cloudflare/src/lib/returnRecords.ts')
  const kinds = worker
    .slice(worker.indexOf('export const RETURN_RECORD_KINDS'), worker.indexOf('] as const', worker.indexOf('export const RETURN_RECORD_KINDS')))
    .match(/'([a-z_]+)'/g)!
    .map((raw) => raw.replace(/'/g, ''))
  assert.ok(kinds.length >= 7, `expected the closed kind set, got ${kinds.join(',')}`)
  const model = read('../src/utils/entityRecords.ts')
  const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
  const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
  for (const kind of kinds) {
    const entry = new RegExp(`\\n  ${kind}: \\['([a-z_]+)'`).exec(model)
    assert.ok(entry, `the browser has no label for the Worker kind ${kind}`)
    const key = entry![1]
    assert.equal(typeof en[key], 'string', `English is missing ${key}`)
    assert.equal(typeof km[key], 'string', `Khmer is missing ${key}`)
    assert.notEqual(km[key], en[key], `Khmer ${key} is still the English string`)
  }
})

if (failed) { console.error(`${failed} return records surface case(s) failed`); process.exit(1) }
console.log('return records surface: all cases pass')
