const assert = require('assert')
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

function transpile(relPath) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  return {
    sourcePath,
    outputText: ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      fileName: sourcePath,
    }).outputText,
  }
}

function loadReal(relPath, overrides = {}) {
  const { sourcePath, outputText } = transpile(relPath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in overrides) return overrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const module = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      module.exports, require, module, sourcePath, path.dirname(sourcePath),
    )
    return module.exports
  } finally {
    Module._load = originalLoad
  }
}

function wrapDb(raw) {
  return {
    prepare(sql) {
      const statement = raw.prepare(sql)
      return {
        get: (params) => statement.get(params),
        all: (params) => statement.all(params) || [],
        run: (params) => {
          const result = statement.run(params)
          return {
            changes: Number(result.meta?.changes || 0),
            lastInsertRowid: Number(result.meta?.last_row_id || 0),
          }
        },
      }
    },
  }
}

let currentDb = null
const sqlBinding = loadReal('lib/sqlBinding.ts')
const core = loadReal('lib/coreDataInvariants.ts', {
  './db': { getDb: () => currentDb },
  './sqlBinding': sqlBinding,
  '../index': {},
  bcryptjs: { __esModule: true, default: { hashSync: () => 'focused-test-hash' } },
})

const env = {
  BUSINESS_OS_ORGANIZATION_NAME: 'Test OS',
  BUSINESS_OS_ORGANIZATION_SLUG: 'test-os',
  BUSINESS_OS_ADMIN_PASSWORD: 'FocusedTest123!',
}

function fixture() {
  const raw = openDb(loadAll())
  return { raw, db: wrapDb(raw) }
}

function rows(db) {
  return db.prepare('SELECT name,notes,is_default,is_active FROM branches ORDER BY id').all()
    .map((row) => ({ ...row }))
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  await check('a fresh database receives exactly Shop default and Warehouse', async () => {
    const { db } = fixture()
    currentDb = db
    const result = await core.ensureCoreDataInvariants(env)
    const seeded = rows(db)
    assert.deepStrictEqual(seeded.map(({ name, is_default, is_active }) => ({ name, is_default, is_active })), [
      { name: 'Shop', is_default: 1, is_active: 1 },
      { name: 'Warehouse', is_default: 0, is_active: 1 },
    ])
    assert.equal(db.prepare('SELECT name FROM branches WHERE id=@id').get({ id: result.branchId }).name, 'Shop')
  })

  await check('repeat and concurrent ensure calls cannot duplicate the canonical pair', async () => {
    const { db } = fixture()
    currentDb = db
    await Promise.all([core.ensureCoreDataInvariants(env), core.ensureCoreDataInvariants(env)])
    await core.ensureCoreDataInvariants(env)
    assert.deepStrictEqual(rows(db).map((row) => row.name), ['Shop', 'Warehouse'])
  })

  await check('a true reset to an empty branch table recreates only the canonical pair', async () => {
    const { db } = fixture()
    currentDb = db
    await core.ensureCoreDataInvariants(env)
    db.prepare('DELETE FROM branch_stock').run()
    db.prepare('DELETE FROM branches').run()
    await core.ensureCoreDataInvariants(env)
    assert.deepStrictEqual(rows(db).map(({ name, is_default }) => ({ name, is_default })), [
      { name: 'Shop', is_default: 1 },
      { name: 'Warehouse', is_default: 0 },
    ])
  })

  await check('any legacy branch row prevents seeding or automatic promotion', async () => {
    const { db } = fixture()
    db.prepare(`INSERT INTO branches(name,notes,is_default,is_active) VALUES('Legacy Depot','preserve',0,0)`).run()
    currentDb = db
    await core.ensureCoreDataInvariants(env)
    assert.deepStrictEqual(rows(db), [
      { name: 'Legacy Depot', notes: 'preserve', is_default: 0, is_active: 0 },
    ])
  })

  console.log(`\n${passed} core branch seed checks passed.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
