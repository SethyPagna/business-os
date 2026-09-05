// Drives the real settings route against the full in-memory schema. The
// acceptance target is the payment-method rename transaction, including its
// malformed-allocation refusal, split-summary rewrite, exact tender values,
// same-second settings behavior, and raw-setting race guard.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const db = openDb(loadAll())
const cache = new Map()
const USER = { id: 91, username: 'payments', name: 'Payment Admin', permissions: JSON.stringify({ settings: true, sales_policy: true }) }

const overrides = {
  '../lib/db': { getDb: (env) => env.DB },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', USER); return next() } },
  '../lib/audit': { audit: async () => {} },
  '../lib/permissions': { hasPermission: () => true },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {} },
}

function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const sourcePath = path.join(__dirname, '..', 'src', rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  }).outputText
  const mod = { exports: {} }
  cache.set(rel, mod)
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}

const app = load('routes/settings.ts').default
const executionCtx = { waitUntil(promise) { promise?.catch?.(() => {}) }, passThroughOnException() {} }

async function request(pathname, method = 'GET', body, env = { DB: db }) {
  const response = await app.request(pathname, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env, executionCtx)
  return { status: response.status, body: await response.json() }
}

function run(sql, params = {}) { return db.prepare(sql).run(params) }
function get(sql, params = {}) { return db.prepare(sql).get(params) }

const INITIAL_STAMP = '2026-09-05T08:00:00.000Z'
run("DELETE FROM settings WHERE key='pos_payment_methods'")
run("INSERT INTO settings(key,value,updated_at) VALUES('pos_payment_methods',@value,@stamp)", {
  value: JSON.stringify(['Cash', 'Fcb', 'ABA']), stamp: INITIAL_STAMP,
})
run("INSERT INTO audit_logs(id,action,entity,entity_id,details) VALUES(700,'old','sale','1','immutable-history')")

run(`INSERT INTO sales(id,receipt_number,cashier_name,customer_name,customer_phone,branch_name,payment_method,payment_details,search_normalized,updated_at)
     VALUES(101,'R-101','José','Dara','010','Shop','Cash + Fcb',@details,'r 101 jose dara shop cash fcb',@stamp)`, {
  details: JSON.stringify([
    { method: 'Cash', amount_usd: 2, amount_khr: 0 },
    { method: 'Fcb', amount_usd: '1.234500', amount_khr: 4200, bank_reference: 'bank-7' },
  ]),
  stamp: INITIAL_STAMP,
})
run(`INSERT INTO sales(id,receipt_number,payment_method,payment_details,search_normalized,updated_at)
     VALUES(102,'R-102','Cash + Fcb',NULL,'r 102 cash fcb',@stamp)`, { stamp: INITIAL_STAMP })
run(`INSERT INTO sales(id,receipt_number,payment_method,payment_details,search_normalized,updated_at)
     VALUES(103,'R-103','Other',@details,'r 103 other fcb',@stamp)`, {
  details: '[{"method":"Fcb","amount_usd":1},7]', stamp: INITIAL_STAMP,
})
run(`INSERT INTO sales(id,receipt_number,payment_method,payment_details,search_normalized,updated_at)
     VALUES(104,'R-104','Fcb','7','r 104 fcb',@stamp)`, { stamp: INITIAL_STAMP })

;(async () => {
  run("UPDATE settings SET value='[\"Cash\",\"Fcb\",\"fcb\"]' WHERE key='pos_payment_methods'")
  const duplicateConfig = await request('/payment-methods/impact?from=Fcb&to=FCB')
  assert.equal(duplicateConfig.status, 409)
  assert.equal(duplicateConfig.body.code, 'invalid_payment_methods_setting')
  run("UPDATE settings SET value=@value WHERE key='pos_payment_methods'", { value: JSON.stringify(['Cash', 'Fcb', 'ABA']) })

  const blockedPreview = await request('/payment-methods/impact?from=Fcb&to=FCB')
  assert.equal(blockedPreview.status, 200)
  assert.deepEqual(blockedPreview.body.configured_methods, ['Cash', 'Fcb', 'ABA'])
  assert.equal(blockedPreview.body.live_snapshots.malformed_sales, 2)
  assert.deepEqual(blockedPreview.body.malformed_sale_ids, [103, 104])

  const blocked = await request('/payment-methods/replace', 'POST', {
    from: 'Fcb', to: 'FCB', scope: 'linked', expected_updated_at: INITIAL_STAMP,
  })
  assert.equal(blocked.status, 409)
  assert.equal(blocked.body.code, 'malformed_payment_details')
  assert.equal(get("SELECT value FROM settings WHERE key='pos_payment_methods'").value, JSON.stringify(['Cash', 'Fcb', 'ABA']))
  assert.equal(get('SELECT payment_method FROM sales WHERE id=101').payment_method, 'Cash + Fcb')
  assert.equal(get('SELECT COUNT(*) AS count FROM audit_logs').count, 1)
  assert.equal(get('SELECT details FROM audit_logs WHERE id=700').details, 'immutable-history')

  // A malformed but unrelated historical allocation remains untouched and
  // does not prevent a precise rename of the pertinent rows.
  run("UPDATE sales SET payment_method='Other',payment_details='[{\"method\":\"Other\",\"amount_usd\":1},7]' WHERE id=103")
  run("UPDATE sales SET payment_method='Other',payment_details='7' WHERE id=104")
  const preview = await request('/payment-methods/impact?from=Fcb&to=FCB')
  assert.equal(preview.status, 200)
  assert.equal(preview.body.linked_records, 3)
  assert.deepEqual(preview.body.live_snapshots, {
    sales: 2,
    payment_detail_lines: 1,
    summary_matches: 2,
    split_summary_sales: 2,
    malformed_sales: 0,
  })

  const renamed = await request('/payment-methods/replace', 'POST', {
    from: 'Fcb', to: 'FCB', scope: 'linked', expected_updated_at: preview.body.settings_updated_at,
  })
  assert.equal(renamed.status, 200)
  assert.deepEqual(renamed.body.methods, ['Cash', 'FCB', 'ABA'])
  assert.equal(renamed.body.linkedSales, 2)
  assert.equal(renamed.body.linkedDetails, 1)
  const split = get('SELECT payment_method,payment_details,search_normalized FROM sales WHERE id=101')
  assert.equal(split.payment_method, 'Cash + FCB')
  assert.deepEqual(JSON.parse(split.payment_details), [
    { method: 'Cash', amount_usd: 2, amount_khr: 0 },
    { method: 'FCB', amount_usd: '1.234500', amount_khr: 4200, bank_reference: 'bank-7' },
  ])
  assert.equal(Number(JSON.parse(split.payment_details)[1].amount_usd), 1.2345)
  assert.match(split.search_normalized, /fcb/)
  assert.match(split.search_normalized, /jose/)
  assert.equal(get('SELECT payment_method,payment_details FROM sales WHERE id=102').payment_method, 'Cash + FCB')
  assert.equal(get('SELECT payment_method,payment_details FROM sales WHERE id=102').payment_details, null)
  assert.equal(get('SELECT details FROM audit_logs WHERE id=700').details, 'immutable-history')
  const renameAudit = JSON.parse(get("SELECT details FROM audit_logs WHERE entity='payment_method' ORDER BY id DESC LIMIT 1").details)
  assert.equal(renameAudit.linkedSales, 2)
  assert.equal(renameAudit.linkedDetails, 1)

  // updated_at is not a sufficient same-second value token. The route reads
  // the latest raw list and therefore preserves an unrelated method added at
  // the same timestamp instead of rebuilding from the stale preview list.
  const secondPreview = await request('/payment-methods/impact?from=FCB&to=FCB%20Bank')
  const sameSecondRaw = JSON.stringify(['Cash', 'FCB', 'ABA', 'Card'])
  run("UPDATE settings SET value=@value,updated_at=@stamp WHERE key='pos_payment_methods'", {
    value: sameSecondRaw, stamp: secondPreview.body.settings_updated_at,
  })
  const secondRename = await request('/payment-methods/replace', 'POST', {
    from: 'FCB', to: 'FCB Bank', scope: 'linked', expected_updated_at: secondPreview.body.settings_updated_at,
  })
  assert.equal(secondRename.status, 200)
  assert.deepEqual(secondRename.body.methods, ['Cash', 'FCB Bank', 'ABA', 'Card'])
  const internalSpaceIdentity = await request('/payment-methods/impact?from=FCBBank&to=Never')
  assert.equal(internalSpaceIdentity.status, 200)
  assert.equal(internalSpaceIdentity.body.linked_records, 0)

  // Generic saves collapse duplicate identities but refuse a spelling-only
  // edit, which must use the reviewed linked path above.
  const duplicateSave = await request('/', 'POST', {
    pos_payment_methods: ['Cash', 'FCB Bank', 'FCB Bank', 'ABA', 'Card'],
  })
  assert.equal(duplicateSave.status, 200)
  assert.deepEqual(JSON.parse(get("SELECT value FROM settings WHERE key='pos_payment_methods'").value), ['Cash', 'FCB Bank', 'ABA', 'Card'])
  const bypass = await request('/', 'POST', {
    pos_payment_methods: ['Cash', 'fcb bank', 'ABA', 'Card'],
  })
  assert.equal(bypass.status, 409)
  assert.equal(bypass.body.code, 'linked_rename_required')

  // The generic save's spelling check and its write are one guarded act.
  // Without the exact raw-value guard, a same-second writer can introduce a
  // case variant after the check and this request silently overwrites it.
  let genericRaced = false
  const genericRacingDb = {
    prepare: (sql) => db.prepare(sql),
    exec: (sql) => db.exec(sql),
    get staging() { return this },
    async batch(statements) {
      if (!genericRaced) {
        genericRaced = true
        run("UPDATE settings SET value=@value WHERE key='pos_payment_methods'", {
          value: JSON.stringify(['Cash', 'fcb bank', 'ABA', 'Card']),
        })
      }
      return db.batch(statements)
    },
  }
  const genericRace = await request('/', 'POST', {
    pos_payment_methods: ['Cash', 'FCB Bank', 'ABA', 'Card', 'Wing'],
  }, { DB: genericRacingDb })
  assert.equal(genericRace.status, 409)
  assert.equal(genericRace.body.code, 'write_conflict')
  assert.deepEqual(JSON.parse(get("SELECT value FROM settings WHERE key='pos_payment_methods'").value), ['Cash', 'fcb bank', 'ABA', 'Card'])
  run("UPDATE settings SET value=@value WHERE key='pos_payment_methods'", {
    value: JSON.stringify(['Cash', 'FCB Bank', 'ABA', 'Card']),
  })

  // Mutate the raw setting after replace has read it but immediately before
  // its D1 batch. The transaction guard must roll back audit/sale/config work.
  const racePreview = await request('/payment-methods/impact?from=FCB%20Bank&to=Bank%20Transfer')
  let raced = false
  const racingDb = {
    prepare: (sql) => db.prepare(sql),
    exec: (sql) => db.exec(sql),
    get staging() { return this },
    async batch(statements) {
      if (!raced) {
        raced = true
        run("UPDATE settings SET value=@value WHERE key='pos_payment_methods'", {
          value: JSON.stringify(['Cash', 'FCB Bank', 'ABA', 'Card', 'Wing']),
        })
      }
      return db.batch(statements)
    },
  }
  const auditCountBeforeRace = get('SELECT COUNT(*) AS count FROM audit_logs').count
  const racedResult = await request('/payment-methods/replace', 'POST', {
    from: 'FCB Bank', to: 'Bank Transfer', scope: 'linked', expected_updated_at: racePreview.body.settings_updated_at,
  }, { DB: racingDb })
  assert.equal(racedResult.status, 409)
  assert.equal(racedResult.body.code, 'write_conflict')
  assert.equal(get('SELECT COUNT(*) AS count FROM audit_logs').count, auditCountBeforeRace)
  assert.equal(get('SELECT payment_method FROM sales WHERE id=101').payment_method, 'Cash + FCB Bank')
  assert.deepEqual(JSON.parse(get("SELECT value FROM settings WHERE key='pos_payment_methods'").value), ['Cash', 'FCB Bank', 'ABA', 'Card', 'Wing'])

  const revisionPreview = await request('/payment-methods/impact?from=FCB%20Bank&to=Bank%20Transfer')
  let revisionRaced = false
  const revisionRacingDb = {
    prepare: (sql) => db.prepare(sql),
    exec: (sql) => db.exec(sql),
    get staging() { return this },
    async batch(statements) {
      if (!revisionRaced) {
        revisionRaced = true
        run("UPDATE sales SET notes='concurrent edit' WHERE id=103")
      }
      return db.batch(statements)
    },
  }
  const auditCountBeforeRevisionRace = get('SELECT COUNT(*) AS count FROM audit_logs').count
  const revisionRaceResult = await request('/payment-methods/replace', 'POST', {
    from: 'FCB Bank', to: 'Bank Transfer', scope: 'linked', expected_updated_at: revisionPreview.body.settings_updated_at,
  }, { DB: revisionRacingDb })
  assert.equal(revisionRaceResult.status, 409)
  assert.equal(revisionRaceResult.body.code, 'write_conflict')
  assert.equal(get('SELECT COUNT(*) AS count FROM audit_logs').count, auditCountBeforeRevisionRace)
  assert.equal(get('SELECT payment_method FROM sales WHERE id=101').payment_method, 'Cash + FCB Bank')

  const configuredBeforeSettingsOnly = JSON.parse(get("SELECT value FROM settings WHERE key='pos_payment_methods'").value)
  run("UPDATE settings SET value=@value,updated_at='2026-09-05T08:30:00.000Z' WHERE key='pos_payment_methods'", {
    value: JSON.stringify([...configuredBeforeSettingsOnly, 'Legacy']),
  })
  run("INSERT INTO sales(id,receipt_number,payment_method,payment_details,updated_at) VALUES(200,'R-200','Legacy',NULL,'2026-09-05T08:30:00.000Z')")
  const settingsOnlyPreview = await request('/payment-methods/impact?from=Legacy&to=Modern')
  const settingsOnly = await request('/payment-methods/replace', 'POST', {
    from: 'Legacy', to: 'Modern', scope: 'settings_only', expected_updated_at: settingsOnlyPreview.body.settings_updated_at,
  })
  assert.equal(settingsOnly.status, 200)
  assert.equal(settingsOnly.body.linkedSales, 0)
  assert.equal(get('SELECT payment_method FROM sales WHERE id=200').payment_method, 'Legacy')

  // Execution is one SQL-native set update, so a common method is not capped
  // at the preview page size or the old proposed 250-row boundary.
  const configuredBeforeBulk = JSON.parse(get("SELECT value FROM settings WHERE key='pos_payment_methods'").value)
  run("UPDATE settings SET value=@value,updated_at='2026-09-05T08:40:00.000Z' WHERE key='pos_payment_methods'", {
    value: JSON.stringify([...configuredBeforeBulk, 'Bulk']),
  })
  for (let id = 1000; id < 1300; id += 1) {
    run('INSERT INTO sales(id,receipt_number,payment_method,payment_details,updated_at) VALUES(@id,@receipt,\'Bulk\',NULL,@stamp)', {
      id, receipt: `R-${id}`, stamp: '2026-09-05T08:40:00.000Z',
    })
  }
  const bulkPreview = await request('/payment-methods/impact?from=Bulk&to=BULK')
  assert.equal(bulkPreview.body.live_snapshots.sales, 300)
  const bulkRename = await request('/payment-methods/replace', 'POST', {
    from: 'Bulk', to: 'BULK', scope: 'linked', expected_updated_at: bulkPreview.body.settings_updated_at,
  })
  assert.equal(bulkRename.status, 200)
  assert.equal(bulkRename.body.linkedSales, 300)
  assert.equal(get("SELECT COUNT(*) AS count FROM sales WHERE payment_method='BULK'").count, 300)

  // SQLite lower() only folds ASCII. The route therefore discovers exact
  // spellings with the shared JS identity rule and supplies those bounded
  // variants to the SQL transaction, including accented case variants.
  const configuredBeforeUnicode = JSON.parse(get("SELECT value FROM settings WHERE key='pos_payment_methods'").value)
  run("UPDATE settings SET value=@value,updated_at='2026-09-05T08:50:00.000Z' WHERE key='pos_payment_methods'", {
    value: JSON.stringify([...configuredBeforeUnicode, 'Épay']),
  })
  run(`INSERT INTO sales(id,receipt_number,payment_method,payment_details,updated_at)
       VALUES(301,'R-301','ÉPAY + Cash',@details,'2026-09-05T08:50:00.000Z')`, {
    details: JSON.stringify([{ method: 'épay', amount_usd: '1.234500', amount_khr: 0 }, { method: 'Cash', amount_usd: 2, amount_khr: 0 }]),
  })
  run("INSERT INTO sales(id,receipt_number,payment_method,payment_details,updated_at) VALUES(302,'R-302','Épay + éPAY',NULL,'2026-09-05T08:50:00.000Z')")
  run("INSERT INTO sales(id,receipt_number,payment_method,payment_details,updated_at) VALUES(303,'R-303','éPAY',NULL,'target-unchanged')")
  const unicodePreview = await request('/payment-methods/impact?from=%C3%89pay&to=%C3%A9PAY')
  assert.equal(unicodePreview.status, 200)
  assert.equal(unicodePreview.body.live_snapshots.sales, 2)
  const unicodeRename = await request('/payment-methods/replace', 'POST', {
    from: 'Épay', to: 'éPAY', scope: 'linked', expected_updated_at: unicodePreview.body.settings_updated_at,
  })
  assert.equal(unicodeRename.status, 200)
  assert.equal(get('SELECT payment_method FROM sales WHERE id=301').payment_method, 'éPAY + Cash')
  assert.deepEqual(JSON.parse(get('SELECT payment_details FROM sales WHERE id=301').payment_details), [
    { method: 'éPAY', amount_usd: '1.234500', amount_khr: 0 },
    { method: 'Cash', amount_usd: 2, amount_khr: 0 },
  ])
  assert.equal(get('SELECT payment_method FROM sales WHERE id=302').payment_method, 'éPAY')
  assert.equal(get('SELECT updated_at FROM sales WHERE id=303').updated_at, 'target-unchanged')

  console.log('PASS payment-method route canonical rename, malformed refusal, same-second preservation, atomic guard, and generic-save parity')
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
