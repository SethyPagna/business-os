'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {
  BACKUP_VERSION,
  BACKUP_TABLES,
  BACKUP_CLEAR_ORDER,
  NON_BACKUP_TABLES,
  buildBackupSummary,
  buildBackupSummaryFromCounts,
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
  assert.equal(BACKUP_TABLES.includes('action_history'), true)
  assert.equal(BACKUP_TABLES.includes('verification_codes'), false)
  assert.deepEqual(NON_BACKUP_TABLES, ['verification_codes'])
})

runTest('backup clear order contains the same tables as backup tables', () => {
  const backupSet = new Set(BACKUP_TABLES)
  const clearSet = new Set(BACKUP_CLEAR_ORDER)
  assert.deepEqual([...clearSet].sort(), [...backupSet].sort())
  assert.equal(BACKUP_CLEAR_ORDER[0], 'return_items')
  assert.equal(BACKUP_CLEAR_ORDER.includes('file_assets'), true)
  assert.equal(BACKUP_CLEAR_ORDER.includes('action_history'), true)
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

runTest('streaming backup summary accepts counts without materializing table rows', () => {
  const summary = buildBackupSummaryFromCounts({
    tableCounts: {
      products: 5000,
      sales: 250,
      file_assets: 12,
    },
    uploads: Array.from({ length: 12 }, (_, index) => ({ path: `/uploads/${index}.webp` })),
  })

  assert.equal(summary.tables.products, 5000)
  assert.equal(summary.tables.sales, 250)
  assert.equal(summary.tables.file_assets, 12)
  assert.equal(summary.totals.tableRowCount >= 5262, true)
  assert.equal(summary.totals.uploadCount, 12)
})

runTest('Docker backup API queues real final-package jobs instead of host action handoff', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '../src/routes/system/index.js'), 'utf8')
  const packageSource = fs.readFileSync(path.join(__dirname, '../src/services/backupPackages.js'), 'utf8')
  assert.match(routeSource, /createFinalBackupPackage/)
  assert.match(routeSource, /backup_export/)
  assert.match(packageSource, /streamBackupDataFile/)
  assert.match(packageSource, /LIMIT \? OFFSET \?/)
  assert.doesNotMatch(packageSource, /JSON\.stringify\(\{\s*tables\s*\}/)
  assert.doesNotMatch(routeSource, /requiresHostAction:\s*true/)
  assert.doesNotMatch(routeSource, /minio\.tgz/)
})

if (failed > 0) {
  process.exitCode = 1
}
