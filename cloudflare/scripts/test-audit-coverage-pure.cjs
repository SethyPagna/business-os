// Audit-trail coverage across route files (I1).
//
// The measured gap: audit(...) was called in 22 of 30 route files. Sweeping
// the other 8 found two different situations, and this test pins BOTH so the
// distinction survives future edits:
//
//   1. Four files carried real, unaudited mutations -- backups (create +
//      restore, the single most consequential action in the app), files
//      (upload / rename / force-delete), notes (create / delete), sync
//      (chunked offline upload -> file_assets via a Durable Object that has
//      no session context, so the route audits it).
//   2. Four files are read-only by design -- catalog, organizations, runtime,
//      notifications. Their lack of audit calls is legitimate, but only for
//      as long as they stay read-only; the file-level rule below turns into a
//      real failure the moment someone adds a mutation handler without one.
//
// Two DELIBERATE non-audits are pinned as hard as the audits themselves:
//   - sync's /outbox replays each queued operation through the real route
//     handler (same cookie, same user), so the target route audits it --
//     auditing the outbox too would double-log every offline mutation.
//   - notes' autosave PUT fires per debounced keystroke; auditing it would
//     write hundreds of rows per editing session, and note content is
//     private to the user while audit_logs is admin-readable.
//
// Run: node scripts/test-audit-coverage-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const routesDir = path.join(__dirname, '..', 'src', 'routes')
let checks = 0
function ok(cond, label) {
  assert.ok(cond, label)
  checks += 1
  console.log(`PASS ${label}`)
}

const files = fs.readdirSync(routesDir).filter((f) => f.endsWith('.ts'))
// Floor was 30 until 0efd04bc deliberately DELETED routes/catalog.ts (the
// dead, ungated storefront endpoint) -- 29 is the real count since. The
// floor exists to catch "dir moved / enumeration silently empty", so it
// follows deliberate deletions down rather than pinning a stale census.
ok(files.length >= 29, `route directory enumerates (${files.length} files)`)

// Mutation-handler detection. Matches app.post( / app.patch( / app.put( /
// app.delete( registrations, not R2/KV method names like ASSETS.put(...) --
// those are always called on an UPPER_CASE binding or c.env, never on `app`.
const MUTATION_RE = /\bapp\.(post|patch|put|delete)\(/

const withMutations = []
const readOnly = []
for (const file of files) {
  const src = fs.readFileSync(path.join(routesDir, file), 'utf8')
  if (MUTATION_RE.test(src)) withMutations.push({ file, src })
  else readOnly.push(file)
}

// Rule 1 -- the general law: every route file that registers a mutation
// handler must contain at least one audit( call. Shifts is the one stronger
// contract: its mutation and guarded audit INSERT share the same D1 batch, so
// it is checked path-by-path below instead of being weakened to an async call.
for (const { file, src } of withMutations) {
  if (file === 'shifts.ts') continue
  ok(src.includes('audit('), `${file} registers mutations and calls audit(`)
}

// Shifts deliberately does not call the generic async audit helper. Every
// lifecycle write and its `WHERE changes()=1` audit INSERT must commit or roll
// back together. These checks name every registered mutation route so adding
// a generic exemption cannot silently leave a new shift write unaudited. The
// executable route rollback/concurrency assertions remain in the focused
// shift suites; this file pins the cross-route coverage census.
const shifts = fs.readFileSync(path.join(routesDir, 'shifts.ts'), 'utf8')
const section = (start, end) => {
  const from = shifts.indexOf(start)
  const to = end ? shifts.indexOf(end, from + start.length) : shifts.length
  return from >= 0 && to > from ? shifts.slice(from, to) : ''
}
const continuationWriter = section('async function writeContinuation', 'function currentResponse')
const openRoute = section("app.post('/open'", 'async function writeClose')
const closeWriter = section('async function writeClose', "app.post('/close'")
const currentCloseRoute = section("app.post('/close'", "app.post('/:id/close'")
const historicCloseRoute = section("app.post('/:id/close'", "app.post('/:id/cancel'")
const cancelRoute = section("app.post('/:id/cancel'", "app.post('/:id/reopen'")
const reopenRoute = section("app.post('/:id/reopen'", "app.patch('/:id'")
const amendRoute = section("app.patch('/:id'", 'export default app')

ok(/INSERT INTO audit_logs[\s\S]*WHERE changes\(\)=1/.test(section('function transitionAuditSql', 'function openAuditSql')),
  'shifts.ts transition audit is guarded by the winning mutation')
ok(/db\.batch\(\[[\s\S]*continuationAuditSql\(\)/.test(continuationWriter),
  'shifts.ts continuation/reopen writes audit in the same batch')
ok(/writeContinuation\([\s\S]*auditAction: 'shift\.open_after_cancel'/.test(openRoute)
  && /db\.batch\(\[[\s\S]*openAuditSql\(\)/.test(openRoute),
  'shifts.ts opening paths use same-batch root and continuation audits')
ok(/db\.batch\(\[[\s\S]*transitionAuditSql\(\)/.test(closeWriter)
  && currentCloseRoute.includes('writeClose(db') && historicCloseRoute.includes('writeClose(db'),
  'shifts.ts current and historic close share the atomic audited writer')
ok(/db\.batch\(\[[\s\S]*transitionAuditSql\(\)/.test(cancelRoute),
  'shifts.ts cancellation writes audit in the same batch')
ok(/writeContinuation\([\s\S]*auditAction: 'shift\.reopen'/.test(reopenRoute),
  'shifts.ts reopen uses the atomic audited continuation writer')
ok(/db\.batch\(\[[\s\S]*transitionAuditSql\(\)/.test(amendRoute),
  'shifts.ts amendment writes audit in the same batch')

// Rule 2 -- the read-only four are actually read-only (no mutation handlers
// AND no direct writes). If one of these grows a write path, this fails and
// forces the audit decision to be made rather than silently skipped.
// catalog.ts left this list when 0efd04bc deleted the route file outright
// (the dead, ungated storefront endpoint) -- the strongest form of staying
// read-only.
const EXPECTED_READ_ONLY = ['notifications.ts', 'organizations.ts', 'runtime.ts']
for (const file of EXPECTED_READ_ONLY) {
  const src = fs.readFileSync(path.join(routesDir, file), 'utf8')
  ok(!MUTATION_RE.test(src), `${file} stays read-only (no mutation handlers)`)
  ok(!/\b(INSERT INTO|DELETE FROM)\b/.test(src), `${file} contains no direct writes`)
}

// Rule 3 -- the specific new coverage, pinned by shape so a refactor that
// drops the call (or its key detail) fails loudly.
const backups = fs.readFileSync(path.join(routesDir, 'backups.ts'), 'utf8')
ok(/audit\([^)]*'create',\s*'backup'/.test(backups), 'backups.ts audits backup creation')
ok(/audit\([^)]*'restore',\s*'backup'/.test(backups), 'backups.ts audits the destructive restore')
// The call gained a progress callback (slice C, Part 543) -- match the
// call-site prefix, and assert it was actually FOUND so a future rename
// can't turn this into a vacuous indexOf(-1) comparison.
const restoreCallAt = backups.indexOf('restoreCloudflareBackup(c.env, sourceDir')
ok(restoreCallAt >= 0, 'backups.ts calls restoreCloudflareBackup at the restore branch')
ok(backups.indexOf("'restore', 'backup'") > restoreCallAt,
  'backups.ts restore audit sits after the restore actually ran')

const filesRoute = fs.readFileSync(path.join(routesDir, 'files.ts'), 'utf8')
ok(/audit\([^)]*'upload',\s*'file'/.test(filesRoute), 'files.ts audits uploads')
ok(/audit\([^)]*'rename',\s*'file'/.test(filesRoute), 'files.ts audits renames with from/to')
ok(/from:\s*existing\.original_name/.test(filesRoute), 'files.ts rename audit carries the before value')
ok(/audit\([^)]*'delete',\s*'file'/.test(filesRoute), 'files.ts audits deletes')
ok(/forced:\s*usageCount > 0/.test(filesRoute), 'files.ts delete audit records the CONFIRM DELETE override')

const notes = fs.readFileSync(path.join(routesDir, 'notes.ts'), 'utf8')
ok(/audit\([^)]*'create',\s*'note',[^)]*,\s*null\)/.test(notes), 'notes.ts audits create with NO content in details')

const telegram = fs.readFileSync(path.join(routesDir, 'telegram.ts'), 'utf8')
ok(/audit\([^)]*'test',\s*'telegram'/.test(telegram), 'telegram.ts audits the test message')
ok(/audit\([^)]*'send',\s*'telegram_summary'/.test(telegram), 'telegram.ts audits manual daily summaries')
ok(/audit\([^)]*'connect',\s*'telegram_webhook'/.test(telegram), 'telegram.ts audits command webhook setup')
ok(/audit\([^)]*'delete',\s*'note',[^)]*,\s*null\)/.test(notes), 'notes.ts audits delete with NO content in details')
const notesPutBody = notes.slice(notes.indexOf("app.put('/:id'"), notes.indexOf("app.patch('/reorder'"))
ok(notesPutBody.length > 0 && !notesPutBody.includes('audit('),
  'notes.ts autosave PUT is deliberately unaudited (per-keystroke flood guard)')

const sync = fs.readFileSync(path.join(routesDir, 'sync.ts'), 'utf8')
const outboxBody = sync.slice(sync.indexOf("app.post('/outbox'"), sync.indexOf("app.post('/files/chunks/init'"))
ok(outboxBody.length > 0 && !outboxBody.includes('audit('),
  'sync.ts outbox is deliberately unaudited (replayed routes audit; no double-log)')
ok(/audit\([^)]*'upload',\s*'file'/.test(sync), 'sync.ts audits the chunked-upload complete')
ok(/via:\s*'offline_sync'/.test(sync), 'sync.ts chunked-upload audit is marked offline_sync')

console.log(`\nAll ${checks} audit-coverage checks passed.`)
