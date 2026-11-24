// G38 S3f (T-F8): the time-comparison source test, design 1.3 and rr 5a.
//
// The portal tables hold two text shapes of one instant: the column default (`YYYY-MM-DD HH:MM:SS`) and the Worker's ISO
// form (`YYYY-MM-DDTHH:MM:SS.sssZ`). A raw text comparison is wrong on the mix (a space sorts before `T`, so a same-day
// default-format row compares as older than an ISO bound), so every comparison, ORDER BY, MAX( and MIN( over one of
// these columns wraps it in datetime(). This test fails on a raw one anywhere in cloudflare/src.
//
// Scope, by statement: a SQL text that names portal_sessions, portal_accounts or portal_telegram_pending, and a column of
// the list below that is not qualified by an alias bound to another table. So `customer_share_submissions.created_at >=
// @cutoff` (routes/portal.ts) is not flagged: that statement names none of the three tables.
//
//   created_at, last_seen_at, expires_at, window_started_at, telegram_verified_at
//
// A raw comparison is the column (bare or alias-qualified, not inside a function call) next to < > <= >= <> != = in a
// condition position (an assignment in a SET list is a write, not a comparison), or a bare ORDER BY term, or MAX( / MIN(
// over the column. The scanner is proven on a positive control (one of every forbidden pattern) and a look-alike sample.
//
// Green on a tree only with S-R1 (retention's datetime() form, C3). Run (from cloudflare/):
//   node scripts/test-portal-time-compare-source-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

const SRC = path.join(__dirname, '..', 'src')
const TABLES = ['portal_sessions', 'portal_accounts', 'portal_telegram_pending']
const COLUMNS = ['created_at', 'last_seen_at', 'expires_at', 'window_started_at', 'telegram_verified_at']
const COL = COLUMNS.join('|')
const SQLISH = /\b(SELECT|UPDATE|INSERT|DELETE)\b/i

function listSourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listSourceFiles(full, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

// Every string or template literal in a file that looks like SQL and names one of the three tables. The retention
// sweep passes its table and its WHERE as two arguments (batchDeleteById / directDelete); those calls are joined into
// one statement so the WHERE is judged with its table.
const DELETE_CALLS = { batchDeleteById: [2, 3], directDelete: [1, 2] }
function sqlTexts(fileName, text) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true)
  const found = []
  const literal = (node) => (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) ? node.getText(sf) : null)
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && Object.hasOwn(DELETE_CALLS, node.expression.text)) {
      const [tableAt, whereAt] = DELETE_CALLS[node.expression.text]
      const table = node.arguments[tableAt] && ts.isStringLiteral(node.arguments[tableAt]) ? node.arguments[tableAt].text : null
      const where = literal(node.arguments[whereAt])
      if (table && TABLES.includes(table) && where) found.push(`DELETE FROM ${table} WHERE ${where}`)
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const body = node.getText(sf)
      if (SQLISH.test(body) && TABLES.some((t) => body.includes(t))) found.push(body)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

// alias -> table, from FROM / JOIN / UPDATE / INTO clauses.
const NOT_ALIAS = '(?!(?:WHERE|SET|ON|JOIN|LEFT|INNER|CROSS|ORDER|GROUP|LIMIT|VALUES|USING|RETURNING|SELECT|DO|ON)\\b)'
function aliases(sql) {
  const map = new Map()
  const re = new RegExp(`\\b(?:FROM|JOIN|UPDATE|INTO)\\s+(\\w+)(?:\\s+(?:AS\\s+)?${NOT_ALIAS}(\\w+))?`, 'gi')
  let m
  while ((m = re.exec(sql))) {
    map.set(m[1], m[1])
    if (m[2]) map.set(m[2], m[1])
  }
  return map
}

// The tables of the scope an index sits in: the innermost enclosing "(SELECT ...)" group, or the statement itself,
// with any nested "(SELECT ...)" group blanked out. An unqualified column belongs to one of those tables.
function scopeTables(sql, index) {
  let start = 0
  let end = sql.length
  const stack = []
  const groups = []
  for (let i = 0; i < sql.length; i += 1) {
    if (sql[i] === '(') stack.push(i)
    else if (sql[i] === ')' && stack.length) {
      const open = stack.pop()
      if (/^\(\s*SELECT\b/i.test(sql.slice(open, open + 12))) groups.push([open, i])
    }
  }
  const enclosing = groups.filter(([a, b]) => a < index && index < b).sort((x, y) => (y[0] - x[0]))[0]
  if (enclosing) { start = enclosing[0] + 1; end = enclosing[1] }
  let own = sql.slice(start, end)
  for (const [a, b] of groups.filter(([a, b]) => a >= start && b <= end && !(a === start - 1))) {
    const ra = a - start
    const rb = b - start
    if (ra >= 0 && rb <= own.length) own = own.slice(0, ra) + ' '.repeat(rb - ra + 1) + own.slice(rb + 1)
  }
  return new Set([...aliases(own).values()])
}

// Raw comparisons and orderings in one SQL text. Returns short descriptions.
function rawHits(sql) {
  const map = aliases(sql)
  const hits = []
  const owns = (alias, index) => {
    if (alias) return !map.has(alias) || TABLES.includes(map.get(alias))
    const scope = scopeTables(sql, index)
    return [...scope].some((t) => TABLES.includes(t))
  }
  // A "=" in a SET list is an assignment, not a comparison: the nearest clause keyword before it is SET.
  const assignment = (index) => {
    const kw = [...sql.slice(0, index).matchAll(/\b(SET|WHERE|AND|OR|ON|HAVING|WHEN|VALUES|SELECT|THEN|ELSE)\b/gi)].pop()
    return Boolean(kw) && kw[1].toUpperCase() === 'SET'
  }
  const OPS = '<=|>=|<>|!=|<|>|='
  // a column reference not directly inside a function call: not preceded by "(" (datetime(col), MAX(col) are apart)
  const left = new RegExp(`(?<![\\w.(])(?:(\\w+)\\.)?(${COL})\\b\\s*(${OPS})(?!=)`, 'g')
  const right = new RegExp(`(${OPS})\\s*(?:(\\w+)\\.)?(${COL})\\b(?!\\s*\\()`, 'g')
  let m
  while ((m = left.exec(sql))) {
    if (!owns(m[1], m.index)) continue
    if (m[3] === '=' && assignment(m.index)) continue
    hits.push(`raw comparison of ${m[2]}`)
  }
  while ((m = right.exec(sql))) {
    if (!owns(m[2], m.index)) continue
    if (m[1] === '=' && assignment(m.index)) continue
    hits.push(`raw comparison against ${m[3]}`)
  }
  const orderBy = /\bORDER\s+BY\b([^;]*?)(?=\bLIMIT\b|\bOFFSET\b|\)|$)/gi
  while ((m = orderBy.exec(sql))) {
    for (const term of m[1].split(',')) {
      const t = term.trim().replace(/[`'"]+$/, '').trim().replace(/\s+(ASC|DESC)\b.*$/i, '')
      const mm = t.match(new RegExp(`^(?:(\\w+)\\.)?(${COL})$`))
      if (mm && owns(mm[1], m.index)) hits.push(`raw ORDER BY ${mm[2]}`)
    }
  }
  const agg = new RegExp(`\\b(MAX|MIN)\\(\\s*(?:(\\w+)\\.)?(${COL})\\s*\\)`, 'gi')
  while ((m = agg.exec(sql))) {
    if (owns(m[2], m.index)) hits.push(`raw ${m[1].toUpperCase()}( over ${m[3]}`)
  }
  return hits
}

function scanFiles(files) {
  const out = []
  for (const { file, text } of files) {
    for (const sql of sqlTexts(file, text)) {
      for (const hit of rawHits(sql)) out.push(`${path.relative(SRC, file)}: ${hit}: ${sql.replace(/\s+/g, ' ').slice(0, 120)}`)
    }
  }
  return out
}
const realFiles = () => listSourceFiles(SRC).map((file) => ({ file, text: fs.readFileSync(file, 'utf8') }))

let passed = 0
const failures = []
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.log(`FAIL ${name}\n  ${error && error.message}`) }
}
const hitsOf = (sql) => rawHits(sql)

check('the scanner sees the tree and finds portal statements to judge (a wrong root must not look clean)', () => {
  const files = realFiles()
  assert.ok(files.length > 100, `only ${files.length} source files scanned`)
  const statements = files.flatMap((f) => sqlTexts(f.file, f.text))
  assert.ok(statements.length >= 20, `only ${statements.length} statements name a portal table`)
  assert.ok(files.some((f) => /ephemeralRetention\.ts$/.test(f.file) && sqlTexts(f.file, f.text).length > 0), 'the retention sweep is in scope')
})

check('no raw text comparison, ORDER BY, MAX( or MIN( over a portal time column anywhere in cloudflare/src', () => {
  assert.deepEqual(scanFiles(realFiles()), [])
})

check('positive control: the scanner reports one of every forbidden pattern', () => {
  const forbidden = [
    "SELECT 1 FROM portal_sessions WHERE expires_at < CURRENT_TIMESTAMP",
    "SELECT 1 FROM portal_sessions WHERE expires_at < @now",
    "SELECT 1 FROM portal_sessions WHERE expires_at <= datetime('now')",
    "SELECT 1 FROM portal_accounts a WHERE a.last_seen_at > @since",
    "SELECT 1 FROM portal_accounts WHERE created_at >= @since AND status = 'active'",
    "SELECT 1 FROM portal_telegram_pending WHERE expires_at < @now",
    "SELECT 1 FROM portal_telegram_pending WHERE window_started_at > @x",
    "SELECT 1 FROM portal_accounts WHERE telegram_verified_at < @x",
    "SELECT 1 FROM portal_sessions WHERE @now > expires_at",
    "SELECT 1 FROM portal_sessions WHERE CURRENT_TIMESTAMP > expires_at",
    "SELECT 1 FROM portal_sessions WHERE last_seen_at = @x",
    "UPDATE portal_sessions SET revoked_at = @n WHERE expires_at < datetime(@now)",
    "SELECT id FROM portal_sessions ORDER BY last_seen_at DESC LIMIT 1",
    "SELECT id FROM portal_accounts a ORDER BY a.created_at",
    "SELECT id FROM portal_accounts ORDER BY status, last_seen_at DESC",
    "SELECT MAX(last_seen_at) FROM portal_accounts",
    "SELECT MIN(a.created_at) FROM portal_accounts a",
  ]
  for (const sql of forbidden) assert.ok(hitsOf(sql).length >= 1, `not reported: ${sql}`)
})

check('positive control: look-alikes report nothing', () => {
  const clean = [
    "SELECT 1 FROM portal_sessions WHERE datetime(expires_at) > datetime(@now)",
    "SELECT 1 FROM portal_sessions WHERE datetime(last_seen_at) < datetime(@now, @touch_window)",
    "SELECT 1 FROM portal_accounts a WHERE datetime(a.created_at) > datetime(@since)",
    "SELECT 1 FROM portal_accounts WHERE julianday(created_at) > julianday(@since)",
    "UPDATE portal_sessions SET last_seen_at = @now, expires_at = @e WHERE id = @id",
    "UPDATE portal_accounts SET updated_at = @now, last_seen_at = @now WHERE id = @id",
    "INSERT INTO portal_telegram_pending (id, window_started_at, created_at, expires_at) VALUES (@id, @now, @now, @e) ON CONFLICT(id) DO UPDATE SET window_started_at = excluded.window_started_at, expires_at = excluded.expires_at",
    "SELECT 1 FROM portal_sessions WHERE revoked_at IS NULL AND expires_at IS NOT NULL",
    "SELECT id FROM portal_sessions ORDER BY id DESC LIMIT 5",
    "SELECT id FROM portal_accounts ORDER BY datetime(last_seen_at) DESC",
    "SELECT MAX(datetime(last_seen_at)) FROM portal_accounts",
    // another table's column in a statement that also names a portal table
    "SELECT 1 FROM portal_accounts a JOIN customers c ON c.id = a.contact_id WHERE c.created_at > @x",
    // a statement that names no portal table at all (routes/portal.ts customer_share_submissions)
    "SELECT 1 FROM customer_share_submissions WHERE created_at >= @cutoff",
    // columns outside the list
    "SELECT 1 FROM portal_accounts WHERE updated_at < @x AND consent_at < @y AND age_confirmed_at < @z AND revoked_at < @w",
  ]
  for (const sql of clean) assert.deepEqual(hitsOf(sql), [], `wrongly reported: ${sql}`)
})

check('positive control: the file-level scan reports a seeded raw string and a seeded ORDER BY', () => {
  const seeded = (body) => [{ file: path.join(SRC, 'seed.ts'), text: `export const q = \`${body}\`` }]
  assert.equal(scanFiles(seeded('SELECT 1 FROM portal_sessions WHERE expires_at < CURRENT_TIMESTAMP')).length, 1)
  assert.equal(scanFiles(seeded('SELECT id FROM portal_sessions ORDER BY last_seen_at')).length, 1)
  assert.equal(scanFiles(seeded('SELECT 1 FROM portal_sessions WHERE datetime(expires_at) < datetime(@now)')).length, 0)
})

check('mutant: the retention sweep with the raw predicate it had before S-R1 is reported', () => {
  const retention = fs.readFileSync(path.join(SRC, 'lib', 'ephemeralRetention.ts'), 'utf8')
  const mutated = retention.replace("datetime(expires_at) < datetime(@now)", 'expires_at < CURRENT_TIMESTAMP')
  assert.notEqual(mutated, retention, 'mutant applied: the sweep holds the datetime() form')
  const files = realFiles().map((f) => (/ephemeralRetention\.ts$/.test(f.file) ? { ...f, text: mutated } : f))
  assert.ok(scanFiles(files).length >= 1, 'the raw sweep predicate goes red')
})

console.log(`\n${passed} passed${failures.length ? `, ${failures.length} FAILED: ${failures.join(' | ')}` : ''}`)
if (failures.length) process.exit(1)
