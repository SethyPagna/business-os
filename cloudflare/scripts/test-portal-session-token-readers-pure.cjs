// G38 S3f (T-F1, T-F2): every reader of portal_sessions by token refuses a Telegram ticket.
//
// A ticket is the 68-character value "tg1:" + hex(HMAC) that sits in portal_sessions.token_hash until the browser
// claims it. No cookie can ever hash to it (hashToken yields exactly 64 hex characters), and every reader also refuses
// the "tg1:" prefix explicitly, so a change to hashToken could never turn a ticket into a session.
//
//   T-F1  with a ticket row present, every value derivable from the link plus the keys fails at the session lookup;
//         and each reader bound DIRECTLY to the raw ticket value (bypassing hashToken) finds or changes nothing.
//         mutants: drop the substr predicate from the session read, from the stamp, from the slide, from the sign-out.
//   T-F2  every SQL text in cloudflare/src that names portal_sessions and token_hash carries the predicate, or is one
//         of the allowed statements by exported name (S-C1, S-C2, S-K2, S-C3, S-C4, S-J2, S-J3, S-D2), which the
//         pieces that own them export under those names (S_C1 ... S_D2; PORTAL_ prefix and _SQL suffix tolerated).
//         S3d names S-J2 and S-J3 MEMBER_INSERT_SQL and TICKET_INSERT_SQL; those two names count in its file only.
//         mutants: a reader without the predicate; a statement outside the list that names token_hash.
//
// Run (from cloudflare/): node scripts/test-portal-session-token-readers-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { loadRealPasswordHash, loadRealFailedSignInCost } = require('./harness/password_hash_stub.cjs')
const { openDb } = require('./harness/d1compat.cjs')

const SRC = path.join(__dirname, '..', 'src')
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')

function loadSource(text, relPath, requireOverrides = {}) {
  const sourcePath = path.join(SRC, relPath)
  const { outputText } = ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: sourcePath,
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const moduleObj = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
    )
    return moduleObj.exports
  } finally {
    Module._load = originalLoad
  }
}
const readSrc = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n')
const loadReal = (rel, overrides) => loadSource(readSrc(rel), rel, overrides)

const migrations = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))

const phone = loadReal('lib/phone.ts')
const anonymousCustomer = loadReal('lib/anonymousCustomer.ts')
const planTier = loadReal('lib/planTier.ts')
const lib = loadReal('lib/portalTelegramToken.ts', { './phone': phone, './planTier': planTier })

const jar = { value: null }
const cookieStub = {
  getCookie: () => jar.value,
  setCookie: (_c, _n, value) => { jar.value = value },
  deleteCookie: () => { jar.value = null },
}

// `rewrite(sql, params)` may replace the bound token hash, so a reader is driven with the raw ticket value.
function world(rewrite) {
  const raw = openDb(migrations)
  const bind = (sql, p) => (rewrite ? rewrite(sql, p) : p)
  const db = {
    prepare(sql) {
      const stmt = raw.prepare(sql)
      return {
        get: async (p) => stmt.get(bind(sql, p)),
        all: async (p) => stmt.all(bind(sql, p)) || [],
        run: async (p) => { const r = stmt.run(bind(sql, p)); return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) } },
      }
    },
    batch: (items) => raw.batch(items),
  }
  return { raw, db }
}
function sessionModule(db, source = readSrc('lib/portalSession.ts')) {
  const accounts = loadReal('lib/portalAccounts.ts', {
    './db': { getDb: () => db },
    './cache': { bumpVersions: async () => {} },
    './membershipNumber': {},
    './phone': phone,
    './passwordPolicy': {},
    './contactDuplicates': {},
    './anonymousCustomer': anonymousCustomer,
    './passwordHash': loadRealPasswordHash(),
    './failedSignInCost': loadRealFailedSignInCost(),
    './memberCode': loadReal('lib/memberCode.ts'),
  })
  return loadSource(source, 'lib/portalSession.ts', {
    './db': { getDb: () => db },
    './portalAccounts': accounts,
    './anonymousCustomer': anonymousCustomer,
    './planTier': planTier,
    './portalTelegramToken': lib,
    'hono/cookie': cookieStub,
  })
}

const T0 = Date.parse('2026-11-24T10:00:00.000Z')
const realNow = Date.now
Date.now = () => T0
const iso = (ms) => new Date(ms).toISOString()
const DAY = 86400000
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
const unhex = (text) => Uint8Array.from(text.match(/../g).map((h) => parseInt(h, 16)))

const SECRET = 'portal-test-secret-that-is-at-least-32-chars'
const env = { PORTAL_ABUSE_HMAC_SECRET: SECRET, PORTAL_TELEGRAM_BOT_TOKEN: '123456:TEST' }

async function derived() {
  const S = crypto.getRandomValues(new Uint8Array(32))
  const b = await lib.startBinding(S)
  const token = await lib.mintStartToken(env, { locale: 0, code: 42, termsAccepted: true, ageConfirmed: true, binding: b }, T0)
  assert.ok(token && token.length === 51, 'a 51-character start token')
  const verified = await lib.verifyStartToken(env, token, T0 + 1000)
  assert.ok(verified, 'the token verifies')
  const ticket = await lib.ticketValue(env, verified)
  assert.ok(lib.isTicketValue(ticket), 'a 68-character ticket')
  const macHex = ticket.slice(4)
  return {
    ticket,
    values: {
      'token text': token,
      'b64url of the 38 token bytes': lib.b64url(verified.bytes),
      'hex of the ticket HMAC': macHex,
      'b64url of the ticket HMAC': lib.b64url(unhex(macHex)),
      'the ticket itself': ticket,
      'S (hex)': hex(S),
      'b64url(S)': lib.b64url(S),
      'hex(b)': hex(b),
    },
  }
}

let seq = 0
function seedAccount(raw) {
  seq += 1
  const r = raw.prepare(
    `INSERT INTO portal_accounts (membership_id, name, phone, password_hash, consent_version, consent_at, consent_locale, age_confirmed_at)
     VALUES (@m, 'Readers Test', @p, 'x', 'portal-legal-2026-10-20', CURRENT_TIMESTAMP, 'en', CURRENT_TIMESTAMP)`,
  ).run({ m: `LC-6${String(seq).padStart(4, '0')}`, p: `0706665${String(seq).padStart(2, '0')}` })
  return Number(r.meta?.last_row_id ?? 0)
}
function seedTicket(raw, accountId, ticket, fields = {}) {
  raw.prepare(
    'INSERT INTO portal_sessions (account_id, token_hash, expires_at, created_at, last_seen_at) VALUES (@a, @t, @e, @c, @l)',
  ).run({ a: accountId, t: ticket, e: iso(T0 + 100 * DAY), c: iso(T0 - 200 * DAY), l: null, ...fields })
}
const ctxFor = () => {
  const pending = []
  return { ctx: { env: {}, executionCtx: { waitUntil: (p) => { pending.push(p) } } }, settle: async () => { while (pending.length) await pending.shift() } }
}
async function hashOf(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return hex(new Uint8Array(digest))
}

let passed = 0
const failures = []
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.log(`FAIL ${name}\n  ${error && error.message}`) }
}
async function mutant(label, from, to, catches) {
  const source = readSrc('lib/portalSession.ts')
  const changedSource = source.replace(from, to)
  assert.notEqual(changedSource, source, `mutant "${label}" did not apply: the source no longer holds the text it replaces`)
  let red = false
  try { await catches(changedSource) } catch (e) { red = true; if (process.env.SHOW_MUTANT_REASON) console.log('   ->', String(e.message).split('\n')[0]) }
  assert.ok(red, `mutant "${label}" stayed green`)
}

// ---- T-F1 -------------------------------------------------------------------------------
async function everyDerivedValueFails(source) {
  const { raw, db } = world()
  const mod = sessionModule(db, source)
  const { ticket, values } = await derived()
  const accountId = seedAccount(raw)
  seedTicket(raw, accountId, ticket)
  for (const [label, value] of Object.entries(values)) {
    jar.value = value
    const { ctx, settle } = ctxFor()
    const state = await mod.getPortalAccountState(ctx)
    await settle()
    assert.deepStrictEqual({ ...state }, { status: 'unauthenticated', account: null }, `${label} must not authenticate`)
  }
  const row = raw.prepare('SELECT * FROM portal_sessions WHERE token_hash = ?').get([ticket])
  assert.equal(row.last_seen_at, null, 'no probe touched the ticket row')
  assert.equal(row.revoked_at, null)
}

// The session read bound to the raw ticket: the statement's own predicate is the only thing between it and a session.
async function directRead(source) {
  const { raw, db } = world((sql, p) => (/FROM portal_sessions s/.test(sql) && p && 'token_hash' in p ? { ...p, token_hash: TICKET_HOLDER.ticket } : p))
  const mod = sessionModule(db, source)
  const { ticket } = await derived()
  TICKET_HOLDER.ticket = ticket
  const accountId = seedAccount(raw)
  seedTicket(raw, accountId, ticket)
  jar.value = 'any cookie: the reader is rebound to the ticket below'
  const { ctx, settle } = ctxFor()
  const state = await mod.getPortalAccountState(ctx)
  await settle()
  assert.equal(state.status, 'unauthenticated', 'the reader bound to the raw ticket finds no row')
}
const TICKET_HOLDER = { ticket: null }

// The three writers bound to the raw ticket while a REAL session drives the request: none may change the ticket row.
async function directWrites(source) {
  const { raw, db } = world((sql, p) => (/^\s*UPDATE portal_sessions/.test(sql) && p && 'token_hash' in p ? { ...p, token_hash: TICKET_HOLDER.ticket } : p))
  const mod = sessionModule(db, source)
  const { ticket } = await derived()
  TICKET_HOLDER.ticket = ticket
  const accountId = seedAccount(raw)
  // the real session: due for the stamp (never stamped) and due for the slide (100 days left)
  const { token } = await mod.createPortalSession({}, accountId)
  const realHash = await hashOf(token)
  raw.prepare('UPDATE portal_sessions SET last_seen_at = NULL, expires_at = ? WHERE token_hash = ?').run([iso(T0 + 100 * DAY), realHash])
  seedTicket(raw, accountId, ticket, { last_seen_at: null, expires_at: iso(T0 + 100 * DAY) })
  jar.value = token
  const first = ctxFor()
  assert.equal((await mod.getPortalAccountState(first.ctx)).status, 'authenticated')
  await first.settle()
  const after = raw.prepare('SELECT * FROM portal_sessions WHERE token_hash = ?').get([ticket])
  assert.equal(after.last_seen_at, null, 'the stamp never writes a ticket row')
  assert.equal(after.expires_at, iso(T0 + 100 * DAY), 'the slide never extends a ticket row')
  await mod.revokePortalSession(first.ctx)
  assert.equal(raw.prepare('SELECT revoked_at FROM portal_sessions WHERE token_hash = ?').get([ticket]).revoked_at, null, 'the sign-out never revokes a ticket row by token')
}
const dropPredicate = (followedBy) => new RegExp(`\\n\\s+AND substr\\((?:s\\.)?token_hash, 1, 4\\) <> 'tg1:'(?=${followedBy})`)

// ---- T-F2 -------------------------------------------------------------------------------
const PREDICATE = /substr\(\s*(?:\w+\.)?token_hash\s*,\s*1\s*,\s*4\s*\)\s*<>\s*'tg1:'/
const ALLOWED_NAME = /^(?:PORTAL_)?S_(?:C1|C2|K2|C3|C4|J2|J3|D2)(?:_SQL)?$/
// S3d (lib/portalTelegramJoin.ts) names S-J2 and S-J3 by what they do, the design id in the comment above each. Those two
// exact names are accepted in that one file only, so a statement in any other file cannot borrow them.
const ALLOWED_IN_FILE = [{ file: 'lib/portalTelegramJoin.ts', names: ['MEMBER_INSERT_SQL', 'TICKET_INSERT_SQL'] }]
const srcPath = (file) => path.relative(SRC, file).split(path.sep).join('/')
const allowedName = (file, name) => ALLOWED_NAME.test(name) || ALLOWED_IN_FILE.some((a) => a.file === srcPath(file) && a.names.includes(name))
const SQLISH = /\b(SELECT|UPDATE|INSERT|DELETE)\b/i

function listSourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listSourceFiles(full, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}
// Every string literal or template that is SQL and names both portal_sessions and token_hash, with the names of the
// declarations and properties around it.
function sqlTexts(fileName, text) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true)
  const found = []
  const nameOf = (node) => (node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) ? node.name.text : null)
  function visit(node, names) {
    const own = (ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node) || ts.isFunctionDeclaration(node)) ? nameOf(node) : null
    const next = own ? [...names, own] : names
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const body = node.getText(sf)
      if (/portal_sessions/.test(body) && /token_hash/.test(body) && SQLISH.test(body)) found.push({ file: fileName, names: next, text: body })
      return // the outermost literal is the statement
    }
    ts.forEachChild(node, (child) => visit(child, next))
  }
  visit(sf, [])
  return found
}
function violations(files) {
  const out = []
  for (const { file, text } of files) {
    for (const stmt of sqlTexts(file, text)) {
      if (PREDICATE.test(stmt.text)) continue
      // A plain INSERT ... VALUES (S-S6, createPortalSession) binds a new row's value; it neither reads nor compares
      // a stored token_hash, so it cannot authenticate anything. An INSERT ... SELECT (the ticket inserts) does read.
      if (/^\W*INSERT\b/i.test(stmt.text) && !/\bSELECT\b/i.test(stmt.text)) continue
      if (stmt.names.some((n) => allowedName(stmt.file, n))) continue
      out.push(`${path.relative(SRC, stmt.file)}: ${stmt.text.replace(/\s+/g, ' ').slice(0, 110)}`)
    }
  }
  return out
}
const realFiles = () => listSourceFiles(SRC).map((file) => ({ file, text: fs.readFileSync(file, 'utf8') }))

async function main() {
  await check('T-F1 every value derivable from the link plus the keys fails at the session lookup', () => everyDerivedValueFails(readSrc('lib/portalSession.ts')))
  await check('T-F1 the session read bound directly to the raw ticket finds no row', () => directRead(readSrc('lib/portalSession.ts')))
  await check('T-F1 mutant: drop the substr predicate from the session read -> the direct read authenticates', () => mutant(
    'session read without the predicate',
    dropPredicate("\\n\\s+AND s\\.revoked_at IS NULL"),
    '',
    directRead,
  ))
  await check('T-F1 the stamp, the slide and the sign-out bound to the raw ticket change nothing', () => directWrites(readSrc('lib/portalSession.ts')))
  await check('T-F1 mutant: drop the predicate from the stamp -> a ticket row is stamped', () => mutant(
    'stamp without the predicate',
    dropPredicate("\\n\\s+AND revoked_at IS NULL\\n\\s+AND datetime\\(expires_at\\) > datetime\\(@now\\)"),
    '',
    directWrites,
  ))
  await check('T-F1 mutant: drop the predicate from the slide -> a ticket row is extended', () => mutant(
    'slide without the predicate',
    dropPredicate("\\n\\s+AND revoked_at IS NULL\\n\\s+AND datetime\\(expires_at\\) < datetime\\(@next_expires_at\\)"),
    '',
    directWrites,
  ))
  await check('T-F1 mutant: drop the predicate from the sign-out -> a ticket row is revoked', () => mutant(
    'sign-out without the predicate',
    dropPredicate("\\n\\s+AND revoked_at IS NULL\\n\\s+`\\)\\.run\\(\\{ now: portalNowIso\\(\\), token_hash"),
    '',
    directWrites,
  ))

  await check('T-F2 the scanner sees the tree (a wrong root must not look like a clean tree)', async () => {
    const files = realFiles()
    assert.ok(files.length > 100, `only ${files.length} source files scanned`)
    const own = files.filter((f) => /lib[\\/]portalSession\.ts$/.test(f.file))
    assert.equal(own.length, 1)
    assert.ok(sqlTexts(own[0].file, own[0].text).length >= 7, 'the scanner finds the session statements in portalSession.ts')
  })
  await check('T-F2 every SQL text naming portal_sessions and token_hash carries the predicate or is an allowed statement by name', async () => {
    assert.deepEqual(violations(realFiles()), [])
  })
  await check('T-F2 S-D2 is exported under its allowed name (it names token_hash without the predicate)', async () => {
    const stmts = sqlTexts('portalSession.ts', fs.readFileSync(path.join(SRC, 'lib', 'portalSession.ts'), 'utf8'))
    const d2 = stmts.filter((s) => !PREDICATE.test(s.text) && !/^\W*INSERT\b/i.test(s.text))
    assert.equal(d2.length, 1)
    assert.ok(d2[0].names.includes('S_D2'))
    assert.match(readSrc('lib/portalSession.ts'), /export const S_D2 = /)
  })
  await check('T-F2 positive control: the scanner reports what it must and nothing else', async () => {
    const fixture = (body, names = '') => ({ file: path.join(SRC, 'fixture.ts'), text: `${names}const x = \`${body}\`` })
    // a reader without the predicate, a statement outside the list that names token_hash, a quoted string form
    assert.equal(violations([fixture('SELECT 1 FROM portal_sessions WHERE token_hash = @h')]).length, 1)
    assert.equal(violations([{ file: path.join(SRC, 'fixture.ts'), text: "export const S_X9 = `UPDATE portal_sessions SET revoked_at = @n WHERE token_hash = @h`" }]).length, 1)
    assert.equal(violations([{ file: path.join(SRC, 'fixture.ts'), text: "const q = 'UPDATE portal_sessions SET revoked_at = 1 WHERE token_hash = ?'" }]).length, 1)
    // allowed: the predicate (with or without an alias), and each allowed name
    assert.equal(violations([fixture("SELECT 1 FROM portal_sessions s WHERE s.token_hash = @h AND substr(s.token_hash, 1, 4) <> 'tg1:'")]).length, 0)
    assert.equal(violations([fixture("UPDATE portal_sessions SET revoked_at = @n WHERE token_hash = @h AND substr(token_hash, 1, 4) <> 'tg1:'")]).length, 0)
    for (const name of ['S_C1', 'S_C2', 'S_K2', 'S_C3', 'S_C4', 'S_J2', 'S_J3', 'S_D2']) {
      assert.equal(violations([{ file: path.join(SRC, 'fixture.ts'), text: `export const ${name} = \`UPDATE portal_sessions SET revoked_at = @n WHERE token_hash = @h\`` }]).length, 0, name)
    }
    // S3d's two names count in lib/portalTelegramJoin.ts only; the same statement under them anywhere else is reported
    for (const name of ['MEMBER_INSERT_SQL', 'TICKET_INSERT_SQL']) {
      const text = `const ${name} = \`UPDATE portal_sessions SET revoked_at = @n WHERE token_hash = @h\``
      assert.equal(violations([{ file: path.join(SRC, 'lib', 'portalTelegramJoin.ts'), text }]).length, 0, name)
      assert.equal(violations([{ file: path.join(SRC, 'lib', 'portalTelegramSignIn.ts'), text }]).length, 1, `${name} outside S3d's file`)
      assert.equal(violations([{ file: path.join(SRC, 'routes', 'portalTelegramJoin.ts'), text }]).length, 1, `${name} in a routes file of the same name`)
    }
    // a plain INSERT ... VALUES reads nothing; an INSERT ... SELECT does and must be listed by name
    assert.equal(violations([fixture('INSERT INTO portal_sessions (account_id, token_hash) VALUES (@a, @h)')]).length, 0)
    assert.equal(violations([fixture('INSERT INTO portal_sessions (account_id, token_hash) SELECT @a, @h WHERE NOT EXISTS (SELECT 1 FROM portal_sessions WHERE token_hash = @h)')]).length, 1)
    // look-alikes that are not statements
    assert.equal(violations([{ file: path.join(SRC, 'fixture.ts'), text: "// UPDATE portal_sessions WHERE token_hash\nconst note = 'portal_sessions token_hash'" }]).length, 0)
    assert.equal(violations([fixture('SELECT 1 FROM user_sessions WHERE token_hash = @h')]).length, 0)
  })
  await check('T-F2 mutant: a reader without the predicate in portalSession.ts -> reported', async () => {
    const files = realFiles().map((f) => (/lib[\\/]portalSession\.ts$/.test(f.file)
      ? { ...f, text: f.text.replace(/\r\n/g, '\n').replace(/\n\s+AND substr\(token_hash, 1, 4\) <> 'tg1:'(?=\n\s+AND revoked_at IS NULL\n\s+`\)\.run\(\{ now: portalNowIso\(\), token_hash)/, '') }
      : f))
    const own = files.find((f) => /lib[\\/]portalSession\.ts$/.test(f.file))
    assert.notEqual(own.text, fs.readFileSync(own.file, 'utf8').replace(/\r\n/g, '\n'), 'mutant applied')
    assert.equal(violations(files).length, 1)
  })
  await check('T-F2 mutant: a statement outside the list that names token_hash -> reported', async () => {
    const files = realFiles()
    files.push({ file: path.join(SRC, 'lib', 'portalSeeded.ts'), text: "export const S_ZZ = `UPDATE portal_sessions SET revoked_at = @n WHERE token_hash = @h`" })
    assert.equal(violations(files).length, 1)
  })

  Date.now = realNow
  console.log(`\n${passed} passed${failures.length ? `, ${failures.length} FAILED: ${failures.join(' | ')}` : ''}`)
  if (failures.length) process.exit(1)
}
main().catch((error) => { Date.now = realNow; console.error(error); process.exit(1) })
