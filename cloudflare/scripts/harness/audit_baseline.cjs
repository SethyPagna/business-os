const assert = require('node:assert/strict')

function captureAuditBaseline(db) {
  const read = () => db.prepare('SELECT * FROM audit_logs ORDER BY id').all()
  const baseline = read()
  const ids = new Set(baseline.map(row => row.id))
  return () => {
    const rows = read()
    assert.deepEqual(rows.filter(row => ids.has(row.id)), baseline, 'pre-existing audit rows must remain unchanged')
    return rows.filter(row => !ids.has(row.id))
  }
}

module.exports = { captureAuditBaseline }
