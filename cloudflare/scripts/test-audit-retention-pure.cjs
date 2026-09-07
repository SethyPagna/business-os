// Audit retention must preserve the only actor/time evidence for Return bulk
// undo/redo while continuing to delete every unrelated old audit row. Both the
// scheduled path and the legacy/manual clear route use the same SQL builder.
//
// Run (from cloudflare/): node scripts/test-audit-retention-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert/strict')
const Database = require('better-sqlite3')

const auditPath = path.join(__dirname, '..', 'src', 'lib', 'audit.ts')
const auditSource = fs.readFileSync(auditPath, 'utf8')
const output = ts.transpileModule(auditSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const moduleObj = { exports: {} }
const localRequire = (request) => {
  if (request === './db') return { getDb: () => { throw new Error('not used') } }
  if (request === './actorSnapshot') return { ACTOR_USERNAME_SQL: '', resolveActorUsername: () => null }
  return require(request)
}
new Function('exports', 'require', 'module', output)(moduleObj.exports, localRequire, moduleObj)
const { buildAuditLogRetentionDeleteSql } = moduleObj.exports

assert.equal(typeof buildAuditLogRetentionDeleteSql, 'function')
const sql = buildAuditLogRetentionDeleteSql()

const sqlite = new Database(':memory:')
sqlite.exec(`
  CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY,
    action TEXT,
    entity TEXT,
    details TEXT,
    created_at TEXT
  );
`)
const insert = sqlite.prepare('INSERT INTO audit_logs(id,action,entity,details,created_at) VALUES(?,?,?,?,?)')
const old = '2026-01-01 00:00:00'
insert.run(1, 'update', 'sale', '{}', old)
insert.run(2, 'action_undo', 'return', '{"kind":"something.else"}', old)
insert.run(3, 'return_fields_bulk', 'return', '{"kind":"return.fields.bulk"}', old)
insert.run(4, 'action_undo', 'return', '{"kind":"return.fields.bulk"}', old)
insert.run(5, 'action_redo', 'return', '{"kind":"return.fields.bulk"}', old)
insert.run(6, 'action_redo', 'product', '{"kind":"return.fields.bulk"}', old)
insert.run(7, 'update', 'sale', '{}', '2026-09-07 00:00:00')

const result = sqlite.prepare(sql).run({ cutoff: '2026-09-01 00:00:00' })
assert.equal(result.changes, 4, 'only unrelated old audit rows are deleted')
assert.deepEqual(
  sqlite.prepare('SELECT id FROM audit_logs ORDER BY id').all().map((row) => row.id),
  [4, 5, 7],
  'only Return bulk undo/redo actor/time evidence bypasses age retention',
)
sqlite.close()

const compatSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'compat.ts'), 'utf8')
assert.match(auditSource, /prepare\(buildAuditLogRetentionDeleteSql\(\)\)/,
  'scheduled retention must use the shared narrow deletion SQL')
assert.match(compatSource, /import \{ audit, buildAuditLogRetentionDeleteSql \} from '\.\.\/lib\/audit'/,
  'manual retention must import the same policy')
assert.match(compatSource, /prepare\(buildAuditLogRetentionDeleteSql\(\)\)/,
  'manual retention must use the same narrow deletion SQL')
assert.doesNotMatch(compatSource, /DELETE FROM audit_logs WHERE id IN \(SELECT id FROM audit_logs WHERE created_at < @cutoff LIMIT 5000\)/,
  'manual retention must not retain its old blanket deletion path')

console.log('audit retention: Return bulk replay provenance preserved narrowly')
