// G38 S3f (T-F1, T-F2): every reader of portal_sessions by token refuses a Telegram ticket.
//
// A ticket is the 68-character value "tg1:" + hex(HMAC) that sits in portal_sessions.token_hash until the browser
// claims it. No cookie can ever hash to it (hashToken yields exactly 64 hex characters), and every reader also refuses
// the "tg1:" prefix explicitly, so a change to hashToken could never turn a ticket into a session.
//
//   T-F1  with a ticket row present, every value derivable from the link plus the keys fails at the session lookup;
//         and each reader bound DIRECTLY to the raw ticket value (bypassing hashToken) finds or changes nothing.
//         mutants: drop the substr predicate from the session read, from the stamp, from the slide, from the sign-out.
//   T-F2  every SQL text in cloudflare/src that names portal_sessions and token_hash carries the predicate (on the alias it
//         compares), or is an allowed statement: the exported const of that name, holding the statement itself, in the file that
//         owns it (OWNERS below: S_C1, S_C2, S_D2, S_K2, S_C3, S_C4, MEMBER_INSERT_SQL = S-J2, TICKET_INSERT_SQL = S-J3).
//         Concatenated literals read as one text. A plain INSERT ... VALUES is exempt; ON CONFLICT and any SELECT are not.
//         mutants: a reader without the predicate; a statement outside the list that names token_hash; the owner check off.
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
// B3: each allowed statement is accepted only under its own name, in the file that owns it, and only as an exported const
// whose initializer is the statement itself (not a function, a property, a concatenation or an unexported const).
const S3E_FILE = 'routes/portalTelegram.ts' // S3e's file, once it exists
const OWNERS = {
  S_C1: ['lib/portalSession.ts', S3E_FILE],
  S_C2: ['lib/portalSession.ts', S3E_FILE],
  S_D2: ['lib/portalSession.ts', S3E_FILE],
  S_K2: ['lib/portalTelegramSignIn.ts'],
  S_C3: ['lib/portalTelegramSignIn.ts'],
  S_C4: ['lib/portalTelegramSignIn.ts'],
  MEMBER_INSERT_SQL: ['lib/portalTelegramJoin.ts'], // S-J2
  TICKET_INSERT_SQL: ['lib/portalTelegramJoin.ts'], // S-J3
}
const srcPath = (file) => path.relative(SRC, file).split(path.sep).join('/')
const allowedStatement = (file, stmt) => stmt.exportedConst !== null
  && Object.hasOwn(OWNERS, stmt.exportedConst) && OWNERS[stmt.exportedConst].includes(srcPath(file))
const SQLISH = /\b(SELECT|UPDATE|INSERT|DELETE)\b/i
// R2-4 (review F5): every mention of token_hash outside the predicate itself, whatever the operator or function around it
// (=, IS, IN, LIKE, GLOB, BETWEEN, instr(), the column on either side), needs the ticket predicate on the SAME alias in
// the same SELECT scope: the predicate must sit in the mention's own parenthesis group or in a group that encloses it.
// A predicate in a nested sub-select, even one that reuses the alias, does not cover a mention outside that sub-select.
const PREDICATE_ANY = /substr\(\s*((?:\w+\.)?)token_hash\s*,\s*1\s*,\s*4\s*\)\s*<>\s*'tg1:'/gi
const TOKEN_MENTION = /(?<![@:\w])((?:\w+\.)?)token_hash\b/gi // a bound parameter (@token_hash) is a value, not the column
// paths[i]: the bracket groups around character i. scopes[i] (F4): the innermost enclosing group that opens with SELECT,
// '' at the top of the statement. A nested SELECT is its own scope: a predicate outside it covers nothing inside it.
function groupPaths(text) {
  const paths = []
  const scopes = []
  const stack = []
  let next = 0
  const opensSelect = (at) => { const re = /\(\s*SELECT\b/iy; re.lastIndex = at; return re.test(text) }
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === ')' && stack.length) stack.pop()
    paths.push(stack.map((g) => g.id).join('/'))
    const select = [...stack].reverse().find((g) => g.select)
    scopes.push(select ? String(select.id) : '')
    if (text[i] === '(') stack.push({ id: ++next, select: opensSelect(i) })
  }
  return { paths, scopes }
}
const encloses = (outer, inner) => outer === '' || inner === outer || inner.startsWith(`${outer}/`)
function lookupsCarryPredicate(text) {
  const { paths, scopes } = groupPaths(text)
  const predicates = [...text.matchAll(PREDICATE_ANY)].map((m) => ({ alias: m[1].toLowerCase(), start: m.index, end: m.index + m[0].length }))
  const mentions = [...text.matchAll(TOKEN_MENTION)].filter((m) => !predicates.some((p) => m.index >= p.start && m.index < p.end))
  return mentions.every((m) => predicates.some((p) => p.alias === m[1].toLowerCase() && scopes[p.start] === scopes[m.index] && encloses(paths[p.start], paths[m.index])))
}

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
// A statement is a string literal, a template, or a `+` concatenation of them (the pieces read as one text).
// exportedConst is the name when the statement is the direct initializer of a top-level `export const`, else null.
function sqlTexts(fileName, text) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true)
  const found = []
  const isLiteral = (node) => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)
  const isPlus = (node) => ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken
  // The pieces of a concatenation made only of literals, or null when any piece is something else.
  function pieces(node) {
    if (isLiteral(node)) return [node]
    if (ts.isParenthesizedExpression(node)) return pieces(node.expression)
    if (isPlus(node)) {
      const left = pieces(node.left)
      const right = left && pieces(node.right)
      return left && right ? [...left, ...right] : null
    }
    return null
  }
  function exportedConstName(node) {
    const declaration = node.parent
    if (!declaration || !ts.isVariableDeclaration(declaration) || declaration.initializer !== node || !ts.isIdentifier(declaration.name)) return null
    const list = declaration.parent
    const statement = list && list.parent
    if (!statement || !ts.isVariableStatement(statement) || !ts.isSourceFile(statement.parent)) return null
    if (!(list.flags & ts.NodeFlags.Const)) return null
    return (ts.getModifiers(statement) || []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ? declaration.name.text : null
  }
  function visit(node) {
    const parts = isLiteral(node) || isPlus(node) ? pieces(node) : null
    if (parts) {
      const body = parts.map((p) => p.getText(sf)).join(' ')
      if (/portal_sessions/.test(body) && /token_hash/.test(body) && SQLISH.test(body)) {
        found.push({ file: fileName, exportedConst: parts.length === 1 ? exportedConstName(node) : null, text: body })
      }
      return // the outermost literal or concatenation is the statement
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}
function violations(files) {
  const out = []
  for (const { file, text } of files) {
    for (const stmt of sqlTexts(file, text)) {
      if (allowedStatement(stmt.file, stmt)) continue
      // A plain INSERT ... VALUES (S-S6, createPortalSession) binds a new row's value; it neither reads nor compares
      // a stored token_hash, so it cannot authenticate anything. An INSERT ... SELECT (the ticket inserts) does read,
      // and ON CONFLICT ... DO UPDATE ... WHERE can compare without a SELECT.
      const plainInsert = /^\W*INSERT\b/i.test(stmt.text) && !/\bSELECT\b/i.test(stmt.text) && !/\bON\s+CONFLICT\b/i.test(stmt.text)
      if (plainInsert) continue
      if (PREDICATE.test(stmt.text) && lookupsCarryPredicate(stmt.text)) continue
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
    dropPredicate("\\n\\s+AND revoked_at IS NULL\\n\\s+AND datetime\\(expires_at\\) > datetime\\(@now\\)\\n\\s+AND \\(last_seen_at IS NULL"),
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
    assert.equal(d2[0].exportedConst, 'S_D2')
    assert.match(readSrc('lib/portalSession.ts'), /export const S_D2 = /)
  })
  await check('T-F2 each allowed statement that exists is found exactly once, in its owning file, as an exported const', async () => {
    const found = {}
    for (const { file, text } of realFiles()) {
      for (const stmt of sqlTexts(file, text)) {
        if (stmt.exportedConst !== null && Object.hasOwn(OWNERS, stmt.exportedConst)) (found[stmt.exportedConst] ||= []).push(srcPath(file))
      }
    }
    for (const name of ['S_D2', 'S_K2', 'S_C3', 'S_C4', 'MEMBER_INSERT_SQL', 'TICKET_INSERT_SQL']) {
      assert.equal((found[name] || []).length, 1, `${name} found ${(found[name] || []).length} times`)
      assert.ok(OWNERS[name].includes(found[name][0]), `${name} lives in ${found[name][0]}`)
    }
    for (const name of Object.keys(found)) assert.equal(found[name].length, 1, `${name} appears once`)
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
    // B3: each allowed name counts in its owning files only, and only as an exported const holding the statement itself
    const reader = 'SELECT a.id FROM portal_sessions s JOIN portal_accounts a ON a.id = s.account_id WHERE s.token_hash = @token_hash AND s.revoked_at IS NULL'
    const sql = 'UPDATE portal_sessions SET revoked_at = @n WHERE token_hash = @h'
    const at = (rel, body) => violations([{ file: path.join(SRC, ...rel.split('/')), text: body }]).length
    for (const [name, owners] of Object.entries(OWNERS)) {
      for (const rel of owners) assert.equal(at(rel, `export const ${name} = \`${sql}\``), 0, `${name} in ${rel}`)
      const wrong = ['lib/portalTelegramSignIn.ts', 'lib/portalTelegramJoin.ts', 'lib/portalSession.ts', 'routes/portal.ts', 'lib/anyNewFile.ts', 'routes/portalTelegramJoin.ts'].find((rel) => !owners.includes(rel))
      assert.equal(at(wrong, `export const ${name} = \`${sql}\``), 1, `${name} outside its owner (${wrong})`)
      assert.equal(at(owners[0], `const ${name} = \`${sql}\``), 1, `${name} not exported`)
      assert.equal(at(owners[0], `export function ${name}() { return db.prepare(\`${sql}\`) }`), 1, `${name} as a function name`)
      assert.equal(at(owners[0], `export const q = { ${name}: \`${sql}\` }`), 1, `${name} as a property`)
      assert.equal(at(owners[0], `export const ${name} = db.prepare(\`${sql}\`)`), 1, `${name} wrapping the statement in a call`)
    }
    // the reviewer's six disguises, each a session reader without the ticket predicate that borrows an allowed name or hides it
    assert.equal(at('routes/portal.ts', `const S_C1 = \`${reader}\``), 1, 'disguise 1: S_C1 in routes/portal.ts')
    assert.equal(at('lib/anyNewFile.ts', `const S_K2 = \`${reader}\``), 1, 'disguise 2: S_K2 in a new lib file, not exported')
    assert.equal(at('routes/portal.ts', `function S_D2() { return db.prepare(\`${reader}\`) }`), 1, 'disguise 3: inside a function named S_D2')
    assert.equal(at('routes/portal.ts', `const q = { S_C4: \`${reader}\` }`), 1, 'disguise 4: under a property S_C4')
    assert.equal(at('routes/portal.ts', `const q = \`${reader} AND EXISTS (SELECT 1 FROM portal_sessions x WHERE substr(x.token_hash, 1, 4) <> 'tg1:')\``), 1, 'disguise 5: the predicate on an unrelated sub-select only')
    assert.equal(at('routes/portal.ts', "const q = 'SELECT a.id FROM portal_sessions s ' + 'WHERE s.token_hash = @token_hash'"), 1, 'disguise 6: SQL split across two concatenated literals')
    assert.equal(at('routes/portal.ts', `const q = \`${reader}\``), 1, 'control: the same reader under a neutral name')
    assert.equal(at('routes/portal.ts', `const q = \`${reader} AND substr(s.token_hash, 1, 4) <> 'tg1:'\``), 0, 'the predicate on the alias that is compared passes')
    assert.equal(at('routes/portal.ts', "const q = 'UPDATE portal_sessions SET revoked_at = @n WHERE token_hash = @h ' + \"AND substr(token_hash, 1, 4) <> 'tg1:'\""), 0, 'a concatenation that carries the predicate passes')
    // R2-4: whatever the operator, the column on either side, a function around it, or an alias reused in a nested sub-select
    const wrapSql = (body) => 'const q = `' + body + '`'
    const head = 'SELECT a.id FROM portal_sessions s JOIN portal_accounts a ON a.id = s.account_id WHERE '
    const unrelated = " AND EXISTS (SELECT 1 FROM portal_sessions x WHERE substr(x.token_hash, 1, 4) <> 'tg1:')"
    const own = " AND substr(s.token_hash, 1, 4) <> 'tg1:'"
    const forms = {
      'IS': 's.token_hash IS @h',
      'reversed operands': '@h = s.token_hash',
      'GLOB': 's.token_hash GLOB @h',
      'BETWEEN': 's.token_hash BETWEEN @h AND @h',
      'instr()': 'instr(s.token_hash, @h) > 0',
      'IN': 's.token_hash IN (@h)',
      'LIKE': 's.token_hash LIKE @h',
    }
    for (const [label, cond] of Object.entries(forms)) {
      assert.equal(at('routes/portal.ts', wrapSql(head + cond + unrelated)), 1, `${label}, predicate on an unrelated sub-select`)
      assert.equal(at('routes/portal.ts', wrapSql(head + cond + own)), 0, `${label}, predicate on its own alias`)
      assert.equal(at('routes/portal.ts', wrapSql(`${head}(${cond})${own}`)), 0, `${label}, in a bracket group, predicate in the enclosing scope`)
      assert.equal(at('routes/portal.ts', wrapSql(head + cond)), 1, `${label}, no predicate at all`)
    }
    const nestedOwn = " AND a.id IN (SELECT account_id FROM portal_sessions s2 WHERE s2.token_hash = @h AND substr(s2.token_hash, 1, 4) <> 'tg1:')"
    assert.equal(at('routes/portal.ts', wrapSql(head + "s.token_hash = @h AND EXISTS (SELECT 1 FROM portal_sessions s WHERE substr(s.token_hash, 1, 4) <> 'tg1:')")), 1, 'a nested sub-select that reuses the alias for the predicate')
    assert.equal(at('routes/portal.ts', wrapSql(head + 's.token_hash = @h' + nestedOwn)), 1, 'the outer lookup of a mixed statement has no predicate of its own')
    assert.equal(at('routes/portal.ts', wrapSql(head + 's.token_hash = @h' + own + nestedOwn)), 0, 'each scope carries its own predicate')
    // F4 (carried to S3e): a predicate in an outer scope does not cover a lookup in a nested SELECT over portal_sessions
    assert.equal(at('routes/portal.ts', wrapSql("SELECT a.id FROM portal_accounts a JOIN portal_sessions s ON s.account_id = a.id WHERE substr(s.token_hash, 1, 4) <> 'tg1:' AND a.id IN (SELECT s.account_id FROM portal_sessions s WHERE s.token_hash = @h)")), 1, 'F4: outer predicate, nested lookup on a reused alias')
    assert.equal(at('routes/portal.ts', wrapSql("SELECT 1 FROM portal_sessions WHERE substr(token_hash, 1, 4) <> 'tg1:' AND account_id IN (SELECT account_id FROM portal_sessions WHERE token_hash = @h)")), 1, 'F4: outer predicate, unaliased nested lookup')
    assert.equal(at('routes/portal.ts', wrapSql("SELECT 1 FROM portal_sessions WHERE token_hash = @h AND account_id IN (SELECT account_id FROM portal_sessions WHERE substr(token_hash, 1, 4) <> 'tg1:' AND token_hash = @g)")), 1, 'F4: nested predicate only, outer lookup bare')
    assert.equal(at('routes/portal.ts', wrapSql("SELECT 1 FROM portal_sessions WHERE token_hash = @h AND substr(token_hash, 1, 4) <> 'tg1:' AND account_id IN (SELECT account_id FROM portal_sessions WHERE token_hash = @g AND substr(token_hash, 1, 4) <> 'tg1:')")), 0, 'F4: each nested SELECT carries its own predicate')
    assert.equal(at('routes/portal.ts', wrapSql("SELECT 1 FROM portal_sessions WHERE token_hash = @h AND substr(token_hash, 1, 4) <> 'tg1:' AND (revoked_at IS NULL OR (id > 0 AND token_hash <> @g))")), 0, 'F4: a bracket group that is not a SELECT stays in its scope')
    // the INSERT ... VALUES exemption refuses ON CONFLICT and any SELECT
    assert.equal(at('lib/anyNewFile.ts', 'const q = `INSERT INTO portal_sessions (account_id, token_hash) VALUES (@a, @h) ON CONFLICT(id) DO UPDATE SET revoked_at = NULL WHERE token_hash = @h`'), 1, 'ON CONFLICT is not a plain insert')
    assert.equal(at('lib/anyNewFile.ts', 'const q = `INSERT INTO portal_sessions (account_id, token_hash) VALUES (@a, (SELECT token_hash FROM portal_sessions LIMIT 1))`'), 1, 'a SELECT inside the VALUES is not a plain insert')
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
