import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SALES_IMPORT_COLUMNS } from '../src/utils/salesImportContract.ts'
import {
  classifyImportContent,
  classifyImportHeader,
  readHeaderCells,
  describeJobPolicy,
} from '../src/components/products/import/importTemplateRouter.ts'

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

const here = dirname(fileURLToPath(import.meta.url))

runTest('the REAL sales template header routes to sales (contract import, not a copy)', () => {
  const detection = classifyImportHeader([...SALES_IMPORT_COLUMNS])
  assert.equal(detection.type, 'sales')
  assert.ok(detection.signals.includes('receipt_number'))
})

runTest('the §12 unified stock header routes to stock_actions', () => {
  const detection = classifyImportContent('name,barcode,shop,warehouse,date,action,selling_price,vip_price,cost_price,batch,supplier\nRouge,123,1,,08/28/2026,add,5,,2,B1,ACME\n')
  assert.equal(detection.type, 'stock_actions')
  assert.deepEqual(detection.signals.slice(0, 2), ['action', 'shop'])
})

runTest('the products template header routes to products', () => {
  const detection = classifyImportContent('name,sku,barcode,category,selling_price_usd,stock_quantity,batch(mm/dd/yyyy),branch,image_filename_1\n')
  assert.equal(detection.type, 'products')
  assert.ok(detection.signals.includes('selling_price_usd'))
})

runTest('the three contact templates route by their distinguishing columns', () => {
  assert.equal(classifyImportHeader(['name', 'membership_number', 'contact_options', 'phone', 'email', 'address', 'gender', 'created_date', 'notes']).type, 'customers')
  assert.equal(classifyImportHeader(['name', 'contact_options', 'phone', 'email', 'address', 'company', 'contact_person', 'gender', 'created_date', 'notes']).type, 'suppliers')
  assert.equal(classifyImportHeader(['name', 'contact_options', 'phone', 'area', 'address', 'gender', 'created_date', 'notes']).type, 'delivery_contacts')
})

runTest('an ambiguous or empty header stays unknown -- never a silent misroute', () => {
  assert.equal(classifyImportHeader(['name', 'phone']).type, 'unknown')
  assert.equal(classifyImportHeader([]).type, 'unknown')
  assert.equal(classifyImportContent('col_a;col_b\n1;2\n').type, 'unknown')
})

runTest('readHeaderCells tolerates BOM, quoted commas and the delimiter family', () => {
  assert.deepEqual(readHeaderCells('﻿name,barcode\nrow'), ['name', 'barcode'])
  assert.deepEqual(readHeaderCells('"name, official",barcode\n'), ['name, official', 'barcode'])
  assert.deepEqual(readHeaderCells('a;b;c\n'), ['a', 'b', 'c'])
  assert.deepEqual(readHeaderCells('a\tb\tc\n'), ['a', 'b', 'c'])
})

runTest('describeJobPolicy renders the real recorded options and hides machinery', () => {
  const lines = describeJobPolicy({
    source: 'import_hub',
    accrue_loyalty: false,
    stock_action_mode: 'direct',
    conflictMode: 'merge',
    fieldRules: { name: 'update' },
    some_new_flag: 'on',
  })
  const byKey = Object.fromEntries(lines.map((line) => [line.key, line.value]))
  assert.equal(byKey.source, 'import_hub')
  assert.equal(byKey.accrue_loyalty, 'not counted (historical)')
  assert.equal(byKey.stock_action_mode, 'direct add/sale')
  assert.equal(byKey.conflictMode, 'merge')
  assert.equal(byKey.some_new_flag, 'on', 'unknown scalar keys pass through -- a recorded option must never vanish')
  assert.ok(!('fieldRules' in byKey), 'structured machinery stays hidden')
  assert.equal(describeJobPolicy(null).length, 0)
})

runTest('wiring: the wizard opens on the hub, the hub dispatches through the ONE shared job pipeline', () => {
  const wizard = readFileSync(join(here, '..', 'src', 'components', 'products', 'import', 'ImportModeWizard.tsx'), 'utf8')
  assert.match(wizard, /useState<'hub' \| 'classic'>\('hub'\)/, 'the hub is the first screen')
  assert.match(wizard, /onUseClassic=\{\(\) => setScreen\('classic'\)\}/, 'the classic screens stay one click away')
  const hub = readFileSync(join(here, '..', 'src', 'components', 'products', 'import', 'ImportHub.tsx'), 'utf8')
  for (const call of ['createImportJob', 'uploadImportJobCsv', 'startImportJob']) {
    assert.match(hub, new RegExp(call), `hub must use the shared pipeline (${call}) -- no new commit paths`)
  }
  assert.match(hub, /parseImportFile/, 'xlsx files ride the same spreadsheet bridge as every importer')
  const tracker = readFileSync(join(here, '..', 'src', 'components', 'shared', 'BackgroundImportTracker.tsx'), 'utf8')
  assert.match(tracker, /describeJobPolicy\(job\.policy\)/, "N1b: each job's recorded options render on its tracker row")
})

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nAll importTemplateRouter tests passed')
