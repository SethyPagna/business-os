// P7-c: manual contact creates/edits store the P8 phone DISPLAY shape --
// the exact contract the migration pack's validator pins
// (PHONE_FORMATTED_RE /^0\d{2} \d{3} \d{3,4}$/, bare-valid /^0\d{8,9}$/,
// everything else preserved untouched). The REAL formatter is loaded from
// lib/contactDuplicates.ts; the route wiring (POST + PUT both passing
// payload.phone through it) is pinned by source.
//
// Run (from cloudflare/): node scripts/test-phone-format-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')

function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
  )
  Module._load = originalLoad
  return moduleObj.exports
}

const contactOptions = loadReal('lib/contactOptions.ts')
const { formatPhoneP8 } = loadReal('lib/contactDuplicates.ts', { './contactOptions': contactOptions })

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

// The migration validator's own regexes, verbatim -- the formatter must
// produce ONLY strings the pack validator counts as formatted.
const PHONE_FORMATTED_RE = /^0\d{2} \d{3} \d{3,4}$/

check('9-digit local numbers format as 0XX XXX XXX', () => {
  assert.strictEqual(formatPhoneP8('012345678'), '012 345 678')
  assert.strictEqual(formatPhoneP8('012-345-678'), '012 345 678')
  assert.strictEqual(formatPhoneP8(' 012 345678 '), '012 345 678')
  assert.ok(PHONE_FORMATTED_RE.test(formatPhoneP8('012345678')))
})

check('10-digit local numbers format as 0XX XXX XXXX', () => {
  assert.strictEqual(formatPhoneP8('0123456789'), '012 345 6789')
  assert.ok(PHONE_FORMATTED_RE.test(formatPhoneP8('0123456789')))
})

check('a manually typed +855 prefix converts to the 0-leading local form', () => {
  assert.strictEqual(formatPhoneP8('+855 12 345 678'), '012 345 678')
  assert.strictEqual(formatPhoneP8('85512345678'), '012 345 678')
  assert.strictEqual(formatPhoneP8('+855123456789'), '012 345 6789')
})

check('already-formatted values pass through byte-identical', () => {
  assert.strictEqual(formatPhoneP8('012 345 678'), '012 345 678')
  assert.strictEqual(formatPhoneP8('012 345 6789'), '012 345 6789')
})

check("garbage/partials/foreign/dual numbers are preserved untouched (the migration's own rule)", () => {
  for (const raw of [
    '12345',             // partial, no leading zero to trust
    '12345678',          // 8 digits, missing zero -- the MIGRATION restored these from Excel damage; manual entry is not Excel damage
    '012345678 / 098765432', // dual number
    '+66 81 234 5678',   // foreign
    'no phone',          // words
    '012A345678',        // mixed content
  ]) {
    assert.strictEqual(formatPhoneP8(raw), raw, `preserved: ${raw}`)
  }
})

check('empty stays empty (no null-to-string coercion surprises)', () => {
  assert.strictEqual(formatPhoneP8(''), '')
  assert.strictEqual(formatPhoneP8(null), '')
  assert.strictEqual(formatPhoneP8(undefined), '')
})

check('route wiring pin: contacts POST and PUT both pass payload.phone through formatPhoneP8', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'contacts.ts'), 'utf8')
  const calls = src.match(/payload\.phone = formatPhoneP8\(payload\.phone\)/g) || []
  assert.strictEqual(calls.length, 2, 'exactly the create AND update handlers format the stored phone')
  assert.ok(/formatPhoneP8,/.test(src), 'imported from lib/contactDuplicates')
})

// --- Regression: the duplicate-check SQL must run against ALL THREE real
// contact tables. It used to SELECT membership_number unconditionally, a
// column only customers have (0001's schema, production-verified) -- so
// every manual supplier/delivery-contact create or update 500'd at the
// duplicate check, and the DuplicatesTab sweep for those tables with it.
// Real migrations, real SQL: a column regression here fails loudly.
async function realDbChecks() {
  const { openDb } = require('./harness/d1compat.cjs')
  const { loadAll } = require('./harness/load_migrations.cjs')
  const rawDb = openDb(loadAll())
  const db = {
    prepare(sql) {
      const stmt = rawDb.prepare(sql)
      return {
        get: (params) => stmt.get(params),
        all: (params) => stmt.all(params) ?? [],
        run: (params) => { const r = stmt.run(params); return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) } },
      }
    },
  }
  const lib = loadReal('lib/contactDuplicates.ts', { './contactOptions': contactOptions })
  rawDb.prepare("INSERT INTO customers (name, phone) VALUES ('Dara', '012 111 222')").run()
  rawDb.prepare("INSERT INTO suppliers (name, phone) VALUES ('Acme Co', '012 333 444')").run()
  rawDb.prepare("INSERT INTO delivery_contacts (name, phone) VALUES ('VET Express', '012 555 666')").run()

  for (const [table, name] of [['customers', 'Dara'], ['suppliers', 'Acme Co'], ['delivery_contacts', 'VET Express']]) {
    const matches = await lib.findContactDuplicates(db, table, { name, phones: [] })
    assert.strictEqual(matches.length, 1, `${table}: the same-name candidate is found (query ran, no unknown-column error)`)
    assert.strictEqual(matches[0].severity, 'name_only')
  }
  passed += 1
  console.log('PASS findContactDuplicates runs real SQL against all three contact tables (membership_number regression)')

  for (const table of ['customers', 'suppliers', 'delivery_contacts']) {
    const clusters = await lib.findDuplicateContactClusters(db, table)
    assert.ok(Array.isArray(clusters), `${table}: whole-table sweep runs`)
  }
  passed += 1
  console.log('PASS findDuplicateContactClusters sweeps all three real tables without column errors')
}

realDbChecks()
  .then(() => console.log(`\n${passed} check(s) passed.`))
  .catch((err) => { console.error(err); process.exit(1) })
