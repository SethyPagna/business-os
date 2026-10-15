const assert = require('node:assert/strict')

function seedStockFixture(raw, seed) {
  assert.equal(seed.constructor.name === 'AsyncFunction', false)
  const permitCount = () => raw.prepare("SELECT COUNT(*) AS n FROM system_flags WHERE key='stock_transaction_permit'").get().n
  assert.equal(permitCount(), 0)
  raw.exec('BEGIN IMMEDIATE')
  try {
    raw.exec("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
    assert.equal(permitCount(), 1)
    const value = seed()
    assert.equal(typeof value?.then === 'function', false)
    raw.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'")
    raw.exec('COMMIT')
    assert.equal(permitCount(), 0)
    return value
  } catch (error) {
    raw.exec('ROLLBACK')
    assert.equal(permitCount(), 0)
    throw error
  }
}

module.exports = { seedStockFixture }
