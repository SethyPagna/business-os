'use strict'
// Re-review of 6.0.1045 (not blocking): every submission with ic_fix_stock on records the audit events of the older counts it replaced. That statement read every approval of the
// organization and branch (decided or not) and unpacked each one's superseded_json, so it got dearer as history grew. It now reads only the approvals still waiting and the ones the same
// commit just rejected, through their indexes. Measured on D1 itself (local workerd, rows_read from D1's own meta) with a large history; the "before" statement is the one at f7955f2de.
//
// Run: node scripts/test-inventory-check-supersede-events-read-cost-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { openWorld } = require('./harness/read-cost-world.cjs')

const HISTORY = 4000
const source = fs.readFileSync(path.join(__dirname, '../src/lib/inventoryCheckSessions.ts'), 'utf8')
const start = source.indexOf('export const SUPERSEDE_EVENTS_SQL = `') + 'export const SUPERSEDE_EVENTS_SQL = `'.length
const AFTER = source.slice(start, source.indexOf('`', start))
assert.equal(AFTER.includes('${'), false)
// f7955f2de: the same insert over every approval of the organization and branch.
const BEFORE = `INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at)
  SELECT a.session_id,CAST(j.key AS INTEGER),@actorId,@actorName,'observe',@key||'-superseded-'||a.session_id||'-'||j.key,@hash,
    json_object('approval','pending'),json_object('approval',a.status,'superseded_by',@id),json_object('sessionRevision',s.revision),@now
  FROM inventory_check_approvals a JOIN inventory_check_sessions s ON s.id=a.session_id, json_each(a.superseded_json) j
  WHERE a.organization_id IS @organization AND a.branch_id=@branchId AND j.value=@id`
const literal = (sql, values) => sql.replace(/@(\w+)/g, (_, name) => {
  const value = values[name]
  if (value === undefined) throw new Error('unbound ' + name)
  return typeof value === 'number' ? String(value) : `'${String(value).replace(/'/g, "''")}'`
})

async function main() {
  const session = (id, status = 'closed') => `('${id}',1,1,7,'','${status}',0,'{}','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z')`
  const columns = 'id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at'
  const fixture = [
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${HISTORY}) INSERT INTO inventory_check_sessions(${columns})
       SELECT 'h'||i,1,1,7,'','closed',0,'{}','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z' FROM n`,
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${HISTORY}) INSERT INTO inventory_check_approvals(session_id,organization_id,branch_id,status,lines,submitted_by,submitted_at,decided_by,decided_by_name,decided_at,decision_request_id,applied_json,superseded_json)
       SELECT 'h'||i,1,1,CASE WHEN i%3=0 THEN 'rejected' ELSE 'approved' END,1,7,'2026-10-01T00:00:00Z',9,'admin','2026-10-02T00:00:00Z','req-'||i,'{}',CASE WHEN i%5=0 THEN '{"5":"old"}' ELSE '{}' END FROM n`,
    `INSERT INTO inventory_check_sessions(${columns}) VALUES ${session('waiting')}, ${session('newer')}`,
    `INSERT INTO inventory_check_approvals(session_id,organization_id,branch_id,status,lines,submitted_by,submitted_at,superseded_json) VALUES ('waiting',1,1,'pending',2,7,'2026-11-03T00:00:00Z','{"5":"newer"}')`,
  ]
  const world = await openWorld(fixture)
  try {
    const values = { actorId: 7, actorName: 'counter', key: 'k-12345678', hash: 'h', id: 'newer', now: '2026-11-03T00:00:00.000Z', organization: 1, branchId: 1 }
    const before = await world.probeSql(literal(BEFORE, { ...values, key: 'k-before-1234' }))
    // The statement the submission sends, on the same history (events are append-only, so it records its own: another request key).
    const after = await world.probeSql(literal(AFTER, { ...values, key: 'k-after-12345' }))
    const events = (await world.probeSql('SELECT COUNT(*) AS n FROM inventory_check_events')).results[0].n
    console.log(`rows read by the replacement events with ${HISTORY} decided approvals in history: before ${before.rows}, after ${after.rows}`)
    assert.ok(before.rows >= HISTORY, `the old statement reads the history (${before.rows})`)
    assert.ok(after.rows <= 40, `the new statement reads the queue and nothing else (${after.rows})`)
    assert.equal(events, 2, 'the waiting approval whose line was replaced gets its event from either statement, and nothing else does')
  } finally { await world.dispose() }
  console.log('PASS the supersede events no longer read the branch history')
}
main().catch(error => { console.error(error); process.exit(1) })
