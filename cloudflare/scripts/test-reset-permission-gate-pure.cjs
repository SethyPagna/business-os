// Source-locks the Part-77 CRITICAL fix (auth audit): every destructive
// system route (reset-data, reset-section, finalize-migration, factory-reset,
// forced orphan cleanup) must gate on 'backup_restore' (restore/reset,
// sensitivity: critical), never on 'backup' (the EXPORT permission,
// deliberately safe to hand to more people -- see lib/permissions.ts's
// backup/backup_restore note). Gating on 'backup' let an export-only account
// wipe the database, and factory-reset's response hands back the reseeded
// admin password, so that account also got full takeover.
//
// Run: node scripts/test-reset-permission-gate-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

const systemSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'system.ts'), 'utf8')
const backupsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'backups.ts'), 'utf8')
const resetDataSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'utils-settings', 'ResetData.tsx'), 'utf8')

check("system.ts's destructive-route helper demands backup_restore", () => {
  const helperAt = systemSrc.indexOf('function denyUnlessRestorePermission')
  assert.ok(helperAt > -1, 'the denyUnlessRestorePermission helper must exist')
  const helperBody = systemSrc.slice(helperAt, systemSrc.indexOf('}', helperAt) + 1)
  assert.ok(/hasPermission\(user, 'backup_restore'\)/.test(helperBody), 'the helper must check backup_restore')
})

check('every destructive system route calls the restore-permission helper', () => {
  for (const route of ['/reset-data', '/reset-section', '/finalize-migration', '/factory-reset', '/import-retention/orphans']) {
    const routeAt = systemSrc.indexOf(`app.post('${route}'`)
    assert.ok(routeAt > -1, `expected route ${route}`)
    const window = systemSrc.slice(routeAt, routeAt + 400)
    assert.ok(/denyUnlessRestorePermission\(c\)/.test(window), `${route} must gate through denyUnlessRestorePermission`)
  }
})

check("the only plain-'backup' gates left in system.ts are the integrity pair (read + guided repair)", () => {
  // verify-integrity is a pure read and repair-integrity a guided repair --
  // neither wipes data, so they deliberately keep their backup-OR-settings
  // gate (repair's tier is flagged in progress.md's Part-77 findings, not
  // silently changed here). Nothing DESTRUCTIVE may use plain 'backup'.
  const plainBackupGates = (systemSrc.match(/hasPermission\(user, 'backup'\)/g) || []).length
  assert.strictEqual(plainBackupGates, 2, `expected exactly the two integrity gates on plain 'backup' (found ${plainBackupGates})`)
  for (const route of ['/verify-integrity', '/repair-integrity']) {
    const routeAt = systemSrc.indexOf(`'${route}'`)
    assert.ok(routeAt > -1 && /hasPermission\(user, 'backup'\)/.test(systemSrc.slice(routeAt, routeAt + 300)), `${route} keeps its compound gate`)
  }
})

check("backups.ts's restore branch keeps its own backup_restore check (the precedent this mirrors)", () => {
  assert.ok(/hasPermission\(user, 'backup_restore'\)/.test(backupsSrc), 'backups.ts restore must require backup_restore')
})

check('the frontend reset flows mirror the gate (no button that only 403s)', () => {
  assert.ok(!/hasPermission\('backup'\)/.test(resetDataSrc), "ResetData.tsx must not pre-flight on plain 'backup'")
  const count = (resetDataSrc.match(/hasPermission\('backup_restore'\)/g) || []).length
  assert.ok(count >= 4, `all four reset flows must pre-flight on backup_restore (found ${count})`)
})

console.log(`\n${passed} check(s) passed.`)
