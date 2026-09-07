// Explicit duplicate decisions must acknowledge the complete current candidate
// set. The guard and the contact write execute in one D1 batch, so any unseen,
// removed, or edited candidate rolls the whole write back.
//
// Run (from cloudflare/): node scripts/test-contact-duplicate-decision-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

function loadTs(file, stubs = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', file)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
    mod.exports,
    (request) => Object.prototype.hasOwnProperty.call(stubs, request) ? stubs[request] : require(request),
    mod,
    sourcePath,
    path.dirname(sourcePath),
  )
  return mod.exports
}

const contactOptions = loadTs('contactOptions.ts')
const phone = loadTs('phone.ts')
const subject = loadTs('contactDuplicates.ts', { './contactOptions': contactOptions, './phone': phone })

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

function createDecision(review) {
  return { action: 'create_separate', ...review }
}

async function exactReview(db, table, name, phones, id = null, mode = 'address') {
  return subject.findContactDuplicateState(db, table, { id, name, phones }, mode)
}

async function main() {
  await check('secondary option phones participate in exact and conflicting candidate sets', async () => {
    const db = openDb(loadAll())
    const address = JSON.stringify([{ label: 'Other', name: '', phone: '+855 77 123 456', address: 'Street 1' }])
    db.prepare("INSERT INTO customers(id,name,phone,address,membership_number) VALUES(1,'Sok Dara',NULL,@address,'LC-00001')").run({ address })
    const exact = await subject.findContactDuplicates(db, 'customers', { name: 'Sok Dara', phones: ['077123456'] })
    assert.equal(exact.length, 1)
    assert.equal(exact[0].severity, 'exact_match')
    assert.match(exact[0].version, /^sha256:[0-9a-f]{64}$/)
    assert.doesNotMatch(exact[0].version, /Street|077|LC-00001/)
    const conflict = await subject.findContactDuplicates(db, 'customers', { name: 'Someone Else', phones: ['077123456'] })
    assert.equal(conflict.length, 1)
    assert.equal(conflict[0].severity, 'phone_conflict')
  })

  await check('stable complete candidate review permits one atomic create', async () => {
    const db = openDb(loadAll())
    db.prepare("INSERT INTO suppliers(id,name,phone) VALUES(1,'Shared Name','066 111 222'),(2,'Shared Name','099 333 444')").run()
    const { matches, review, snapshots } = await exactReview(db, 'suppliers', 'Shared Name', ['066111222'])
    assert.deepEqual(matches.map((row) => row.id), [1, 2])
    const decision = createDecision(review)
    assert.deepEqual(subject.parseContactDuplicateCreateSeparateDecision(decision), decision)
    const guard = subject.contactDuplicateWriteGuardStatement('suppliers', { name: 'Shared Name', phones: ['066111222'] }, decision, snapshots)
    await db.batch([
      guard,
      { sql: "INSERT INTO suppliers(id,name,phone) VALUES(3,'Shared Name','066111222')", params: {} },
    ])
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM suppliers').get().count, 3)
  })

  await check('unseen candidate aborts the same batch before contact creation', async () => {
    const db = openDb(loadAll())
    db.prepare("INSERT INTO delivery_contacts(id,name,phone) VALUES(1,'Same Rider','088 111 222')").run()
    const { review, snapshots } = await exactReview(db, 'delivery_contacts', 'Same Rider', ['088111222'])
    const decision = createDecision(review)
    db.prepare("INSERT INTO delivery_contacts(id,name,phone) VALUES(2,'Same Rider','077 333 444')").run()
    const guard = subject.contactDuplicateWriteGuardStatement('delivery_contacts', { name: 'Same Rider', phones: ['088111222'] }, decision, snapshots)
    await assert.rejects(db.batch([
      guard,
      { sql: "INSERT INTO delivery_contacts(id,name,phone) VALUES(3,'Same Rider','088111222')", params: {} },
    ]), /malformed JSON/)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM delivery_contacts').get().count, 2)
  })

  await check('candidate edit or deletion invalidates a reviewed identity without relying on updated_at precision', async () => {
    for (const mutation of [
      "UPDATE customers SET address='New' WHERE id=1",
      'DELETE FROM customers WHERE id=1',
    ]) {
      const db = openDb(loadAll())
      db.prepare("INSERT INTO customers(id,name,phone,address,membership_number,updated_at) VALUES(1,'Exact Person','012 111 222','Old','LC-00001','2026-09-08 00:00:00')").run()
      const { review, snapshots } = await exactReview(db, 'customers', 'Exact Person', ['012111222'])
      const guard = subject.contactDuplicateWriteGuardStatement('customers', { name: 'Exact Person', phones: ['012111222'] }, createDecision(review), snapshots)
      db.prepare(mutation).run()
      await assert.rejects(db.batch([
        guard,
        { sql: "INSERT INTO customers(id,name,phone,membership_number) VALUES(2,'Exact Person','012111222','LC-00002')", params: {} },
      ]), /malformed JSON/)
      assert.equal(db.prepare('SELECT id FROM customers WHERE id=2').get(), undefined)
    }
  })

  await check('bounded name suggestions still include and authorize a phone owner beyond row 50', async () => {
    const db = openDb(loadAll())
    for (let id = 1; id <= 51; id += 1) {
      db.prepare("INSERT INTO suppliers(id,name,phone) VALUES(@id,'Crowded Name',@phone)").run({ id, phone: `088${String(id).padStart(6, '0')}` })
    }
    const { matches, review, snapshots } = await exactReview(db, 'suppliers', 'Crowded Name', ['088000051'])
    assert.equal(matches.length, 51, 'first 50 name candidates plus the hard phone owner')
    assert.ok(matches.some((candidate) => candidate.id === 51 && candidate.severity === 'exact_match'))
    const guard = subject.contactDuplicateWriteGuardStatement('suppliers', { name: 'Crowded Name', phones: ['088000051'] }, createDecision(review), snapshots)
    await db.batch([
      guard,
      { sql: "INSERT INTO suppliers(id,name,phone) VALUES(52,'Crowded Name','088000051')", params: {} },
    ])
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM suppliers').get().count, 52)
  })

  await check('bare boolean and malformed or reordered acknowledgements are rejected', async () => {
    assert.equal(subject.parseContactDuplicateCreateSeparateDecision(true), null)
    assert.equal(subject.parseContactDuplicateCreateSeparateDecision({ action: 'create_separate' }), null)
    const review = {
      candidateIds: [1, 2],
      candidateVersions: [{ id: 1, version: 'A' }, { id: 2, version: 'B' }],
      fingerprint: 'v1|1@A|2@B',
    }
    assert.equal(subject.parseContactDuplicateCreateSeparateDecision({ action: 'create_separate', ...review, candidateIds: [2, 1] }), null)
  })

  await check('route keeps phone conflicts non-overridable and records explicit reviewed candidates', async () => {
    const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'contacts.ts'), 'utf8')
    assert.match(route, /if \(phoneConflict\) return \{ block: duplicateErrorResponse/)
    assert.match(route, /parseContactDuplicateCreateSeparateDecision\(decisionInput\)/)
    assert.match(route, /contactDuplicateWriteGuardStatement\(config\.table, \{ name, phones: duplicateDecision\.phones \}, duplicateDecision\.decision, duplicateDecision\.snapshots\)/)
    assert.match(route, /duplicate_decision: 'create_separate'/)
    assert.match(route, /duplicate_candidate_ids: duplicateDecision\.decision\.candidateIds/)
    assert.match(route, /duplicate_candidate_fingerprint: duplicateDecision\.decision\.fingerprint/)
    assert.doesNotMatch(route, /body\.confirmDuplicate/)
    assert.match(route, /const duplicate = \{ \.\.\.match, matches, duplicateReview: review, allowedActions \}/)
    assert.match(route, /code: 'contact_duplicate_decision_required'/)
    assert.doesNotMatch(route, /code: 'possible_duplicate'/)
    assert.doesNotMatch(route, /code: 'phone_conflict'/)
  })

  console.log(`\n${passed} check(s) passed.`)
}

main().catch((error) => { console.error(error); process.exit(1) })
