'use strict'
// Companion for ops/queries/branch-identity-precheck.sql (cutover lane LA).
//
// 1. The file passes the Ops read-only guard (one SELECT, nothing written), the
//    same canonical SQL for LF and CRLF, and runs on the full migrated chain
//    at D1's expression depth.
// 2. Prediction = outcome: on every scenario (live shape, duplicate active
//    name, half-set identity, foreign identity, successor, unknown is_active,
//    unfinished cutover, Worker-only whitespace, inactive legacy namesake,
//    already backfilled, terminal cutover after rename) the query's blocks_0229
//    is empty exactly when the real 0229 applies, and would_set is exactly the
//    canonical_key 0229 leaves on each row.
// 3. The live shape reads exactly what the 0229 header expects.
// 4. Discriminating control: the same query with SQLite's default trim
//    disagrees with 0229 on the whitespace scenario, so the cross-check bites.
//
// Run (from cloudflare/): node scripts/test-branch-identity-precheck-query-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { DatabaseSync } = require('node:sqlite')

const root = path.resolve(__dirname, '../..')
const migrationsDir = path.join(root, 'cloudflare/migrations')
const chain = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
const MIGRATION = '0229_branch_identity_backfill.sql'
const backfillSql = fs.readFileSync(path.join(migrationsDir, MIGRATION), 'utf8')
const source = fs.readFileSync(path.join(root, 'ops/queries/branch-identity-precheck.sql'), 'utf8')

function open(through) {
  const raw = new DatabaseSync(':memory:')
  raw.limits.exprDepth = 100
  raw.limits.variableNumber = 100
  for (const file of chain.filter(through)) raw.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
  return raw
}
function applyAtomic(raw, sql) {
  raw.exec('BEGIN')
  try { raw.exec(sql); raw.exec('COMMIT') } catch (error) { raw.exec('ROLLBACK'); throw error }
}
const LIVE = "INSERT INTO branches(id,name,location,is_default,is_active,created_at) VALUES(1,'Warehouse','Toul Kork',0,1,'2025-11-02 09:15:00'),(2,'Shop','Street 271',1,1,'2025-11-02 09:15:00');"
function cutover(raw, aborted) {
  const hex = 'a'.repeat(64)
  raw.prepare(`INSERT INTO branch_cutovers(operation_id,begin_request_id,actor_id,organization_id,control_incarnation,maintenance_token,
    source_branch_id,target_branch_id,intent_json,intent_digest,source_preimage_json,target_preimage_json,maintenance_flag_json,
    capture_digest,snapshot_digest,verification_digest,created_at,updated_at)
    VALUES('00000000-0000-4000-8000-0000000000c1','cutover_request_01',7,'1','00000000-0000-4000-8000-000000000099',
    '00000000-0000-4000-8000-0000000000aa',2,1,'{}',?,'{"id":2}','{"id":1}','{}',?,?,?,'2026-10-06 21:00:00','2026-10-06 21:00:00')`).run(hex, hex, hex, hex)
  if (aborted) raw.exec("UPDATE branch_cutovers SET phase='aborted', revision=1, terminal_json=json_object('version',1,'operationId',operation_id,'kind','aborted')")
}
const SCENARIOS = {
  live: (raw) => raw.exec(LIVE),
  duplicate_active_shop: (raw) => raw.exec(`${LIVE} INSERT INTO branches(id,name,is_active) VALUES(3,' SHOP ',1);`),
  half_set: (raw) => raw.exec(`${LIVE} UPDATE branches SET role='shop' WHERE id=2;`),
  half_set_inactive: (raw) => raw.exec(`${LIVE} INSERT INTO branches(id,name,is_active,is_default,role) VALUES(3,'Kiosk',0,0,'warehouse');`),
  foreign_identity: (raw) => raw.exec(`${LIVE} INSERT INTO branches(id,name,is_active,is_default,role,canonical_key) VALUES(3,'Legacy',0,0,'warehouse','warehouse');`),
  successor_before_cutover: (raw) => raw.exec(`${LIVE} INSERT INTO branches(id,name,is_active,is_default,successor_branch_id) VALUES(3,'Kiosk',0,0,2);`),
  unknown_active: (raw) => raw.exec(`${LIVE} UPDATE branches SET is_active=NULL WHERE id=2;`),
  unfinished_cutover: (raw) => { raw.exec(LIVE); cutover(raw, false) },
  worker_whitespace: (raw) => raw.exec("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,char(160)||'WAREHOUSE'||char(9),0,1),(2,'Shop'||char(12288),1,1);"),
  inactive_namesake: (raw) => raw.exec(`${LIVE} INSERT INTO branches(id,name,is_active,is_default) VALUES(3,'Shop',0,0);`),
  already_backfilled: (raw) => { raw.exec(LIVE); applyAtomic(raw, backfillSql) },
  terminal_renamed: (raw) => {
    raw.exec(LIVE); applyAtomic(raw, backfillSql); cutover(raw, true)
    raw.exec(`UPDATE branches SET is_default=0 WHERE id=2;
      UPDATE branches SET name='Old Shop', is_active=0, successor_branch_id=1 WHERE id=2;
      UPDATE branches SET name='LC Store', role='shop', is_default=1 WHERE id=1;
      INSERT INTO branches(id,name,is_active,is_default) VALUES(3,'Shop',1,0);`)
  },
}

// Returns the mismatches between the query's prediction and the real 0229.
function crossCheck(sql) {
  const mismatches = []
  for (const [name, seed] of Object.entries(SCENARIOS)) {
    const raw = open((f) => f < MIGRATION)
    seed(raw)
    const rows = raw.prepare(sql).all().map((r) => ({ ...r }))
    const blocked = new Set(rows.map((r) => r.blocks_0229)).size === 1 ? rows[0].blocks_0229 : 'inconsistent'
    let applied = true
    try { applyAtomic(raw, backfillSql) } catch (error) { assert.match(error.message, /CHECK constraint failed/); applied = false }
    if ((blocked === '') !== applied) mismatches.push(`${name}: blocks_0229='${blocked}' but 0229 ${applied ? 'applied' : 'aborted'}`)
    if (applied) {
      const after = new Map(raw.prepare('SELECT id, canonical_key FROM branches').all().map((r) => [r.id, r.canonical_key]))
      for (const row of rows) {
        const expected = row.would_set ?? row.canonical_key
        if (after.get(row.id) !== expected) mismatches.push(`${name}: branch ${row.id} would_set=${row.would_set} but 0229 left ${after.get(row.id)}`)
      }
    }
    raw.close()
  }
  return mismatches
}

async function main() {
  const { guardSql } = await import(pathToFileURL(path.join(root, 'ops/scripts/ops-sql-guard.mjs')))
  const { sql, rules } = guardSql(source)
  const lf = source.replace(/\r\n/g, '\n')
  assert.deepEqual(guardSql(lf), guardSql(lf.replace(/\n/g, '\r\n')))
  assert.equal(rules.minRows, 1)
  console.log('PASS the Ops read-only guard accepts it (one SELECT), LF and CRLF give the same canonical SQL')

  const full = open(() => true)
  full.exec(LIVE)
  const before = full.prepare('SELECT total_changes() AS n').get().n
  assert.equal(full.prepare(sql).all().length, 2)
  assert.equal(full.prepare('SELECT total_changes() AS n').get().n, before, 'reads only')
  full.close()
  console.log('PASS runs on the full migrated chain at expression depth 100 and writes nothing')

  const raw = open((f) => f < MIGRATION)
  raw.exec(LIVE)
  assert.deepEqual(raw.prepare(sql).all().map((r) => ({ ...r })), [
    { id: 1, name: 'Warehouse', is_active: 1, is_default: 0, role: null, canonical_key: null, successor_branch_id: null, name_key: 'warehouse', would_set: 'warehouse', unfinished_cutovers: 0, cutover_rows: 0, blocks_0229: '' },
    { id: 2, name: 'Shop', is_active: 1, is_default: 1, role: null, canonical_key: null, successor_branch_id: null, name_key: 'shop', would_set: 'shop', unfinished_cutovers: 0, cutover_rows: 0, blocks_0229: '' },
  ])
  raw.close()
  console.log('PASS the live shape reads exactly what the 0229 header expects')

  const mismatches = crossCheck(sql)
  assert.deepEqual(mismatches, [])
  console.log(`PASS prediction equals the real 0229 outcome on all ${Object.keys(SCENARIOS).length} scenarios`)

  const charList = /trim\(b\.name, char\([^)]*\)\)/.exec(sql)
  assert.ok(charList, 'control rewrite anchor')
  const wrong = crossCheck(sql.replace(charList[0], 'trim(b.name)'))
  assert.ok(wrong.some((m) => m.startsWith('worker_whitespace:')), `control: a default-trim query disagrees with 0229 (${wrong.join('; ')})`)
  console.log('PASS discriminating control: a default-trim precheck is caught disagreeing with 0229')
}

main().catch((error) => { console.error(error); process.exit(1) })
