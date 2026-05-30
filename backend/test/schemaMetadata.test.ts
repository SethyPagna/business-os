'use strict'

const assert = require('node:assert/strict')

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

function loadSchemaMetadataWithColumns(columnsByTable, options = {}) {
  const databasePath = require.resolve('../src/database')
  const schemaMetadataPath = require.resolve('../src/schemaMetadata.ts')
  const originalDatabaseModule = require.cache[databasePath]
  delete require.cache[schemaMetadataPath]

  const calls = []
  const db = {
    prepare(sql) {
      assert.match(sql, /information_schema\.columns/)
      return {
        all(tableName) {
          calls.push(String(tableName || ''))
          if (options.throwFor?.has?.(tableName)) throw new Error('metadata probe failed')
          return (columnsByTable[tableName] || []).map((name) => ({ name }))
        },
      }
    },
  }

  require.cache[databasePath] = {
    id: databasePath,
    filename: databasePath,
    loaded: true,
    exports: { db },
  }

  const helper = require('../src/schemaMetadata.ts')
  const cleanup = () => {
    delete require.cache[schemaMetadataPath]
    if (originalDatabaseModule) require.cache[databasePath] = originalDatabaseModule
    else delete require.cache[databasePath]
  }
  return { helper, calls, cleanup }
}

runTest('hasColumn caches positive and negative column probes', () => {
  const fixture = loadSchemaMetadataWithColumns({
    settings: ['key', 'value', 'updated_at'],
  })
  try {
    assert.equal(fixture.helper.hasColumn('settings', 'updated_at'), true)
    assert.equal(fixture.helper.hasColumn('settings', 'updated_at'), true)
    assert.equal(fixture.helper.hasColumn('settings', 'missing_column'), false)
    assert.equal(fixture.helper.hasColumn('settings', 'missing_column'), false)
    assert.deepEqual(fixture.calls, ['settings', 'settings'])
  } finally {
    fixture.cleanup()
  }
})

runTest('firstExistingColumn preserves candidate order and seeds presence cache', () => {
  const fixture = loadSchemaMetadataWithColumns({
    stock_transfers: ['id', 'notes', 'reason', 'note'],
  })
  try {
    assert.equal(fixture.helper.firstExistingColumn('stock_transfers', ['note', 'notes', 'reason']), 'note')
    assert.equal(fixture.helper.firstExistingColumn('stock_transfers', ['note', 'notes', 'reason']), 'note')
    assert.equal(fixture.helper.hasColumn('stock_transfers', 'notes'), true)
    assert.deepEqual(fixture.calls, ['stock_transfers'])
  } finally {
    fixture.cleanup()
  }
})

runTest('markColumnPresent refreshes cached custom-table column state', () => {
  const columnsByTable = {
    ct_test: ['id', 'created_at'],
  }
  const fixture = loadSchemaMetadataWithColumns(columnsByTable)
  try {
    assert.equal(fixture.helper.hasColumn('ct_test', 'updated_at'), false)
    fixture.helper.markColumnPresent('ct_test', 'updated_at')
    assert.equal(fixture.helper.hasColumn('ct_test', 'updated_at'), true)

    assert.equal(fixture.helper.firstExistingColumn('ct_test', ['updated_at']), null)
    columnsByTable.ct_test.push('updated_at')
    fixture.helper.markColumnPresent('ct_test', 'updated_at')
    assert.equal(fixture.helper.firstExistingColumn('ct_test', ['updated_at']), 'updated_at')
  } finally {
    fixture.cleanup()
  }
})

runTest('metadata probe failures cache safe fallbacks', () => {
  const fixture = loadSchemaMetadataWithColumns({}, { throwFor: new Set(['missing_table']) })
  try {
    assert.equal(fixture.helper.hasColumn('missing_table', 'updated_at'), false)
    assert.equal(fixture.helper.firstExistingColumn('missing_table', ['note']), null)
    assert.equal(fixture.helper.hasColumn('missing_table', 'updated_at'), false)
    assert.deepEqual(fixture.calls, ['missing_table', 'missing_table'])
  } finally {
    fixture.cleanup()
  }
})

if (failed > 0) {
  process.exitCode = 1
}
