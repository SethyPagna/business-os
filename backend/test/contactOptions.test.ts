'use strict'

const assert = require('node:assert/strict')
const {
  CONTACT_OPTION_LIMIT,
  buildImportedContactState,
  parseImportContactOptions,
  parseStoredContactOptions,
  serializeContactOptions,
} = require('../src/contactOptions')

let failed = 0

async function runTest(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

runTest('parseImportContactOptions caps imported contacts at three entries', () => {
  const options = parseImportContactOptions({
    contact_label_1: 'Primary',
    contact_name_1: 'A',
    contact_phone_1: '1',
    contact_label_2: 'Backup',
    contact_name_2: 'B',
    contact_phone_2: '2',
    contact_label_3: 'Warehouse',
    contact_name_3: 'C',
    contact_phone_3: '3',
    contact_label_4: 'Overflow',
    contact_name_4: 'D',
    contact_phone_4: '4',
  })

  assert.equal(options.length, CONTACT_OPTION_LIMIT)
  assert.deepEqual(options.map((option) => option.label), ['Primary', 'Backup', 'Warehouse'])
})

runTest('parseStoredContactOptions migrates legacy plain strings into structured contacts', () => {
  const options = parseStoredContactOptions('Main pickup office')
  assert.equal(options.length, 1)
  assert.equal(options[0].label, 'Default')
  assert.equal(options[0].address, 'Main pickup office')
})

runTest('buildImportedContactState prefers imported structured options for supplier-style records', () => {
  const result = buildImportedContactState({
    name: 'Supplier One',
    contact_label_1: 'Sales',
    contact_name_1: 'Jane',
    contact_phone_1: '010',
    contact_email_1: 'jane@example.com',
    contact_address_1: 'Street 1',
  })

  assert.equal(result.options.length, 1)
  assert.equal(result.primary.name, 'Jane')
  assert.equal(result.primary.email, 'jane@example.com')
  assert.match(String(result.serialized || ''), /jane@example\.com/)
})

runTest('serializeContactOptions keeps delivery area-only contacts compact', () => {
  const encoded = serializeContactOptions([
    { label: 'Zone A', name: 'Driver A', phone: '011', area: 'North' },
  ], { mode: 'area' })

  const decoded = parseStoredContactOptions(encoded, { mode: 'area' })
  assert.equal(decoded.length, 1)
  assert.equal(decoded[0].area, 'North')
  assert.equal(decoded[0].email, null)
})

if (failed > 0) {
  process.exitCode = 1
}
