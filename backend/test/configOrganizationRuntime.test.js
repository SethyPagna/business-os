'use strict'

const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const Database = require('better-sqlite3')

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

function makeTempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

runTest('config promotes legacy shared runtime data into organization runtime root', () => {
  const runtimeDir = makeTempRoot('bos-config-runtime-')
  const storageRoot = path.join(runtimeDir, 'business-os-data')
  const legacyDbDir = path.join(storageRoot, 'db')
  const legacyUploadsDir = path.join(storageRoot, 'uploads')
  fs.mkdirSync(legacyDbDir, { recursive: true })
  fs.mkdirSync(legacyUploadsDir, { recursive: true })

  const legacyDbPath = path.join(legacyDbDir, 'business.db')
  const sqlite = new Database(legacyDbPath)
  sqlite.exec(`
    CREATE TABLE organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      slug TEXT,
      public_id TEXT
    );
    INSERT INTO organizations (name, slug, public_id)
    VALUES ('LeangCosmetics', 'leangcosmetics', 'org_runtime_test');
  `)
  sqlite.close()

  fs.writeFileSync(path.join(legacyUploadsDir, 'demo.txt'), 'demo-upload')

  const probe = spawnSync(process.execPath, ['-e', `
    const config = require('./src/config')
    process.stdout.write(JSON.stringify({
      storageRoot: config.STORAGE_ROOT,
      dataRoot: config.DATA_ROOT,
      dbPath: config.DB_PATH,
      uploadsPath: config.UPLOADS_PATH,
      organizationPublicId: config.ORGANIZATION_PUBLIC_ID,
      migratedDbExists: require('fs').existsSync(config.DB_PATH),
      migratedUploadExists: require('fs').existsSync(require('path').join(config.UPLOADS_PATH, 'demo.txt')),
    }))
  `], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      BUSINESS_OS_RUNTIME_DIR: runtimeDir,
      _BOS_CONFIG_LOGGED: '1',
    },
    encoding: 'utf8',
  })

  assert.equal(probe.status, 0, probe.stderr || probe.stdout)
  const output = JSON.parse(String(probe.stdout || '{}'))

  assert.equal(output.storageRoot, storageRoot)
  assert.equal(output.organizationPublicId, 'org_runtime_test')
  assert.equal(output.dataRoot, path.join(storageRoot, 'organizations', 'org_runtime_test'))
  assert.equal(output.dbPath, path.join(storageRoot, 'organizations', 'org_runtime_test', 'db', 'business.db'))
  assert.equal(output.uploadsPath, path.join(storageRoot, 'organizations', 'org_runtime_test', 'uploads'))
  assert.equal(output.migratedDbExists, true)
  assert.equal(output.migratedUploadExists, true)
  assert.equal(fs.existsSync(legacyDbPath), true)
  assert.equal(fs.existsSync(path.join(legacyUploadsDir, 'demo.txt')), true)
})

if (failed > 0) {
  process.exitCode = 1
}
