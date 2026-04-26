'use strict'

const assert = require('node:assert/strict')
const {
  BACKUP_VERSION,
  BACKUP_TABLES,
  BACKUP_CLEAR_ORDER,
  NON_BACKUP_TABLES,
  buildBackupSummary,
} = require('../src/backupSchema')

let failed = 0

function runTest(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

runTest('backup schema covers file assets and excludes ephemeral verification codes', () => {
  assert.equal(BACKUP_VERSION >= 10, true)
  assert.equal(BACKUP_TABLES.includes('file_assets'), true)
  assert.equal(BACKUP_TABLES.includes('verification_codes'), false)
  assert.deepEqual(NON_BACKUP_TABLES, ['verification_codes'])
})

runTest('backup clear order contains the same tables as backup tables', () => {
  const backupSet = new Set(BACKUP_TABLES)
  const clearSet = new Set(BACKUP_CLEAR_ORDER)
  assert.deepEqual([...clearSet].sort(), [...backupSet].sort())
  assert.equal(BACKUP_CLEAR_ORDER[0], 'return_items')
  assert.equal(BACKUP_CLEAR_ORDER.includes('file_assets'), true)
})

runTest('buildBackupSummary returns row counts and totals', () => {
  const summary = buildBackupSummary({
    tables: {
      products: [{ id: 1 }, { id: 2 }],
      sales: [{ id: 8 }],
      file_assets: [{ id: 11 }],
    },
    uploads: [{ path: '/uploads/a.png' }, { path: '/uploads/b.png' }],
    customTableRows: {
      ct_demo: [{ id: 1 }, { id: 2 }, { id: 3 }],
    },
  })

  assert.equal(summary.version, BACKUP_VERSION)
  assert.equal(summary.tables.products, 2)
  assert.equal(summary.tables.sales, 1)
  assert.equal(summary.tables.file_assets, 1)
  assert.equal(summary.tables.audit_logs, 0)
  assert.equal(summary.totals.tableRowCount, 4)
  assert.equal(summary.totals.customTableCount, 1)
  assert.equal(summary.totals.customTableRowCount, 3)
  assert.equal(summary.totals.uploadCount, 2)
})

if (failed > 0) {
  process.exitCode = 1
}
