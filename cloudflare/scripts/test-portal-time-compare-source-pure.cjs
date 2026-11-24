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
  // A "=" in a SET list is an assignment, not a comparison: the nearest clause keyword before it is SET. A CASE ... END
  // that closes before it is one value, so its WHEN / THEN / ELSE do not count (S3d's S-P1 assigns
  // "attempts = CASE ... END, window_started_at = CASE ..."); a CASE still open keeps its WHEN as the nearest keyword.
  const closedCase = /\bCASE\b(?:(?!\bCASE\b|\bEND\b)[\s\S])*\bEND\b/gi
  const assignment = (index) => {
    let before = sql.slice(0, index)
    for (let prev = null; prev !== before;) { prev = before; before = before.replace(closedCase, ' ') }
    const kw = [...before.matchAll(/\b(SET|WHERE|AND|OR|ON|HAVING|WHEN|VALUES|SELECT|THEN|ELSE)\b/gi)].pop()
    return Boolean(kw) && kw[1].toUpperCase() === 'SET'
  }
  const OPS = '<=|>=|<>|!=|<|>|='
  // A column reference not directly inside a function call: not preceded by "name(" (datetime(col), MAX(col) are apart).
  // A bracket group is not a call: "(col < @x OR ...)" and "AND (col < @x" open with a raw comparison and are reported, so an
  // open parenthesis after a keyword (AND, OR, NOT, WHERE, ON, WHEN, THEN, ELSE, IN, ...) does not hide the column.
  const KEYWORD = '(?:AND|OR|NOT|WHERE|ON|WHEN|THEN|ELSE|IN|BETWEEN|SELECT|HAVING|EXISTS|CASE|END)'
  const left = new RegExp(`(?<![\\w.])(?<!\\b(?!${KEYWORD}\\b)\\w+\\(\\s*)(?:(\\w+)\\.)?(${COL})\\b\\s*(${OPS})(?!=)`, 'gi')
  const right = new RegExp(`(${OPS})\\s*(?:(\\w+)\\.)?(${COL})\\b(?!\\s*\\()`, 'gi')
  // The column cut by substr() still compares as text: substr(col, 1, 19) > @now is raw.
  const substrLeft = new RegExp(`\\b(?:substr|substring)\\(\\s*(?:(\\w+)\\.)?(${COL})\\s*,[^()]*\\)\\s*(${OPS})(?!=)`, 'gi')
  const substrRight = new RegExp(`(${OPS})\\s*(?:substr|substring)\\(\\s*(?:(\\w+)\\.)?(${COL})\\s*,[^()]*\\)`, 'gi')
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
  while ((m = substrLeft.exec(sql))) {
    if (!owns(m[1], m.index)) continue
    hits.push(`raw comparison of substr(${m[2]})`)
  }
  while ((m = substrRight.exec(sql))) {
    if (!owns(m[2], m.index)) continue
    if (m[1] === '=' && assignment(m.index)) continue
    hits.push(`raw comparison against substr(${m[3]})`)
  }
  // R2-4 (review F6): the operand of a comparison, found by walking out from the operator, whose outermost form is not
  // datetime() / julianday(): a bracketed column, coalesce(), ifnull(), trim(), CAST(), a `||` chain, a nested substr().
  // A bare column and the plain substr(col, ...) form are the passes above and are not counted twice.
  // Only datetime() and julianday() make a stored time format-proof (design 1.3). date(), strftime() and unixepoch() over a
  // column are judged like any other wrapper: reported (F5).
  const SAFE_CALL = /^(?:datetime|julianday)\s*\(/i
  const CALL_KEYWORD = /^(?:AND|OR|NOT|WHERE|ON|WHEN|THEN|ELSE|IN|BETWEEN|SELECT|HAVING|EXISTS|CASE|END)$/i
  const closeOf = (s, open) => {
    for (let d = 0, i = open; i < s.length; i += 1) {
      if (s[i] === '(') d += 1
      else if (s[i] === ')' && (d -= 1) === 0) return i
    }
    return -1
  }
  const openOf = (s, close) => {
    for (let d = 0, i = close; i >= 0; i -= 1) {
      if (s[i] === ')') d += 1
      else if (s[i] === '(' && (d -= 1) === 0) return i
    }
    return -1
  }
  const nameBefore = (s, open) => {
    let m = open
    while (m > 0 && /\w/.test(s[m - 1])) m -= 1
    const name = s.slice(m, open)
    return name && !CALL_KEYWORD.test(name) ? m : open
  }
  // Terms of the operand to the left of index `at` (a `||` chain gives several), each { text, start }.
  function operandLeft(at) {
    const terms = []
    let i = at - 1
    for (;;) {
      while (i >= 0 && /\s/.test(sql[i])) i -= 1
      let start
      if (sql[i] === ')') {
        const open = openOf(sql, i)
        if (open < 0) break
        start = nameBefore(sql, open)
        terms.push({ text: sql.slice(start, i + 1), start })
      } else if (sql[i] === "'") {
        start = sql.lastIndexOf("'", i - 1)
        if (start < 0) break
        terms.push({ text: sql.slice(start, i + 1), start })
      } else if (i >= 0 && /[\w.@:?]/.test(sql[i])) {
        const end = i
        while (i >= 0 && /[\w.@:?]/.test(sql[i])) i -= 1
        start = i + 1
        terms.push({ text: sql.slice(start, end + 1), start })
      } else break
      i = start - 1
      while (i >= 0 && /\s/.test(sql[i])) i -= 1
      if (sql.slice(i - 1, i + 1) !== '||') break
      i -= 2
    }
    return terms
  }
  function operandRight(at) {
    const terms = []
    let i = at
    for (;;) {
      while (i < sql.length && /\s/.test(sql[i])) i += 1
      const start = i
      let end
      if (sql[i] === '(') {
        end = closeOf(sql, i)
        if (end < 0) break
      } else if (sql[i] === "'") {
        end = sql.indexOf("'", i + 1)
        if (end < 0) break
      } else if (/[\w.@:?]/.test(sql[i] || '')) {
        end = i
        while (end + 1 < sql.length && /[\w.@:?]/.test(sql[end + 1])) end += 1
        if (sql[end + 1] === '(' && !CALL_KEYWORD.test(sql.slice(start, end + 1))) end = closeOf(sql, end + 1)
        if (end < 0) break
      } else break
      terms.push({ text: sql.slice(start, end + 1), start })
      i = end + 1
      while (i < sql.length && /\s/.test(sql[i])) i += 1
      if (sql.slice(i, i + 2) !== '||') break
      i += 2
    }
    return terms
  }
  const bareColumn = new RegExp(`^(?:(\\w+)\\.)?(${COL})$`, 'i')
  const plainSubstr = new RegExp(`^(?:substr|substring)\\(\\s*(?:(\\w+)\\.)?(${COL})\\s*,[^()]*\\)$`, 'i')
  const columnIn = new RegExp(`(?<![\\w.])(?:(\\w+)\\.)?(${COL})\\b(?!\\s*\\()`, 'i')
  function wrappedColumnHit(term, chained, bareIsRaw = false) {
    let text = term.text.trim()
    let wrapped = false
    for (;;) {
      if (text.startsWith('(') && closeOf(text, 0) === text.length - 1) { text = text.slice(1, -1).trim(); wrapped = true } else break
    }
    if (/^SELECT\b/i.test(text)) return null
    if (SAFE_CALL.test(text) && closeOf(text, text.indexOf('(')) === text.length - 1) return null
    const bare = bareColumn.exec(text)
    if (bare) return wrapped || chained || bareIsRaw ? { alias: bare[1], column: bare[2] } : null
    if (plainSubstr.test(text)) return null
    const found = columnIn.exec(text)
    return found ? { alias: found[1], column: found[2] } : null
  }
  const anyOp = /<=|>=|<>|!=|<|>|=/g
  while ((m = anyOp.exec(sql))) {
    if (m[0] === '=' && assignment(m.index)) continue
    const sides = [operandLeft(m.index), operandRight(m.index + m[0].length)]
    for (const terms of sides) {
      for (const term of terms) {
        const hit = wrappedColumnHit(term, terms.length > 1)
        if (hit && owns(hit.alias, term.start)) hits.push(`raw comparison of wrapped ${hit.column}`)
      }
    }
  }
  // F5: BETWEEN (the tested value and both bounds) and IS / IS NOT [DISTINCT FROM] <value> compare text too. A bare column is
  // raw here (the passes above only know < > <= >= <> != =). IS [NOT] NULL tests presence, not an instant, and is not a comparison.
  const termEnd = (terms) => terms[terms.length - 1].start + terms[terms.length - 1].text.length
  const judge = (groups) => {
    for (const terms of groups) {
      for (const term of terms) {
        const hit = wrappedColumnHit(term, terms.length > 1, true)
        if (hit && owns(hit.alias, term.start)) hits.push(`raw comparison of ${hit.column} (BETWEEN / IS)`)
      }
    }
  }
  const betweenOp = /\b(?:NOT\s+)?BETWEEN\b/gi
  while ((m = betweenOp.exec(sql))) {
    const low = operandRight(m.index + m[0].length)
    const groups = [operandLeft(m.index), low]
    const and = low.length ? /^\s*AND\b/i.exec(sql.slice(termEnd(low))) : null
    if (and) groups.push(operandRight(termEnd(low) + and[0].length))
    judge(groups)
  }
  const isOp = /\bIS(?:\s+NOT)?(?:\s+DISTINCT\s+FROM)?(?=\s)/gi
  while ((m = isOp.exec(sql))) {
    const right = operandRight(m.index + m[0].length)
    if (right.length && /^NULL$/i.test(right[0].text)) continue
    judge([operandLeft(m.index), right])
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
    // a closed CASE in a SET list must not hide a raw "=" inside an open CASE after it, or in the WHERE after it
    "UPDATE portal_telegram_pending SET attempts = CASE WHEN window_started_at = @x THEN 1 END WHERE id = @id",
    "UPDATE portal_telegram_pending SET attempts = CASE WHEN 1 THEN 1 END, flags = CASE WHEN window_started_at = @x THEN 1 END WHERE id = @id",
    "UPDATE portal_telegram_pending SET attempts = CASE WHEN 1 THEN 1 END WHERE window_started_at = @x",
    // B4: a raw comparison that opens a bracket group, or is wrapped in substr(), is still a raw text comparison
    "SELECT 1 FROM portal_sessions WHERE revoked_at IS NULL AND (expires_at < @now OR revoked_at IS NOT NULL)",
    "SELECT 1 FROM portal_sessions WHERE (expires_at < @now OR 1)",
    "SELECT 1 FROM portal_sessions WHERE revoked_at IS NULL AND(expires_at < @now)",
    "SELECT 1 FROM portal_sessions WHERE revoked_at IS NULL OR ((expires_at < @now) AND 1)",
    "SELECT COUNT(*) FROM portal_sessions WHERE account_id = @a AND (last_seen_at > datetime(created_at, '+60 seconds') OR 1)",
    "SELECT 1 FROM portal_sessions s WHERE s.token_hash = @h AND substr(s.expires_at, 1, 19) > @now",
    "SELECT 1 FROM portal_sessions WHERE @now < substr(expires_at, 1, 19)",
    // R2-4: a column wrapped in a bracket, coalesce(), ifnull(), trim(), CAST(), a || chain or a nested substr() is still raw text
    "SELECT 1 FROM portal_sessions WHERE substring(expires_at, 1, 19) <= datetime(@now)",
    "SELECT 1 FROM portal_sessions WHERE (expires_at) < @now",
    "SELECT 1 FROM portal_sessions WHERE @now > (expires_at)",
    "SELECT 1 FROM portal_sessions WHERE coalesce(expires_at, '') < @now",
    "SELECT 1 FROM portal_sessions s WHERE ifnull(s.expires_at, @x) > @now",
    "SELECT 1 FROM portal_sessions WHERE trim(expires_at) < @now",
    "SELECT 1 FROM portal_sessions WHERE CAST(expires_at AS TEXT) < @now",
    "SELECT 1 FROM portal_sessions WHERE expires_at || '' < @now",
    "SELECT 1 FROM portal_sessions WHERE @now > '' || expires_at",
    "SELECT 1 FROM portal_sessions WHERE substr(expires_at, 1, length(@now)) < @now",
    "SELECT 1 FROM portal_sessions WHERE @now >= coalesce(last_seen_at, created_at)",
    "SELECT 1 FROM portal_sessions WHERE revoked_at IS NULL AND ((expires_at)) <= datetime(@now)",
    // F5 (carried to S3e): BETWEEN, IS / IS NOT against a value, and strftime() / date() / unixepoch() around a column
    "SELECT 1 FROM portal_sessions WHERE @now BETWEEN created_at AND expires_at",
    "SELECT 1 FROM portal_sessions WHERE expires_at BETWEEN @a AND @b",
    "SELECT 1 FROM portal_sessions s WHERE s.created_at NOT BETWEEN @a AND @b",
    "SELECT 1 FROM portal_sessions WHERE @a BETWEEN @b AND expires_at",
    "SELECT 1 FROM portal_sessions WHERE expires_at IS NOT @now",
    "SELECT 1 FROM portal_sessions WHERE expires_at IS @now",
    "SELECT 1 FROM portal_sessions WHERE @now IS NOT expires_at",
    "SELECT 1 FROM portal_accounts WHERE last_seen_at IS NOT DISTINCT FROM @now",
    "SELECT 1 FROM portal_sessions WHERE strftime('%s', expires_at) > @now",
    "SELECT 1 FROM portal_sessions WHERE @now < date(expires_at)",
    "SELECT 1 FROM portal_sessions WHERE unixepoch(expires_at) < @n",
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
    // S3d's S-P1 shape: a time column assigned after a closed CASE in the SET list
    "INSERT INTO portal_telegram_pending (id, attempts, window_started_at) VALUES (@id, 1, @now) ON CONFLICT(id) DO UPDATE SET attempts = CASE WHEN datetime(portal_telegram_pending.window_started_at) <= datetime(@now, @w) THEN 1 ELSE portal_telegram_pending.attempts + 1 END, window_started_at = CASE WHEN datetime(portal_telegram_pending.window_started_at) <= datetime(@now, @w) THEN @now ELSE portal_telegram_pending.window_started_at END WHERE datetime(portal_telegram_pending.window_started_at) <= datetime(@now, @w)",
    "UPDATE portal_telegram_pending SET attempts = CASE WHEN 1 THEN CASE WHEN 2 THEN 1 END ELSE 0 END, window_started_at = @now WHERE id = @id",
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
    // B4 look-alikes: a bracket group whose comparison is wrapped in datetime(), a substr() of a column outside the list, a
    // substr() that is not compared, and a nested select
    "SELECT 1 FROM portal_sessions WHERE revoked_at IS NULL AND (datetime(expires_at) < datetime(@now) OR revoked_at IS NOT NULL)",
    "SELECT 1 FROM portal_sessions WHERE (datetime(last_seen_at) > datetime(created_at, '+60 seconds') OR 1)",
    "SELECT 1 FROM portal_sessions WHERE substr(token_hash, 1, 4) <> 'tg1:' AND (revoked_at IS NULL OR id > 0)",
    "SELECT substr(expires_at, 1, 10) AS day FROM portal_sessions WHERE id = @id",
    // R2-4 look-alikes: the outermost call is datetime() or julianday(); another table's column; no column at all
    "SELECT 1 FROM portal_accounts WHERE id IN (SELECT account_id FROM portal_sessions WHERE datetime(expires_at) > datetime(@now))",
    "SELECT 1 FROM portal_sessions WHERE datetime(coalesce(expires_at, '')) < datetime(@now)",
    "SELECT 1 FROM portal_sessions WHERE datetime(ifnull(expires_at, @x)) > datetime(@now)",
    "SELECT 1 FROM portal_sessions WHERE julianday(trim(expires_at)) < julianday(@now)",
    "SELECT 1 FROM portal_sessions WHERE (datetime(expires_at)) < (datetime(@now))",
    "SELECT 1 FROM portal_sessions WHERE datetime(substr(expires_at, 1, 19)) < datetime(@now)",
    "SELECT 1 FROM portal_accounts a JOIN customers c ON c.id = a.contact_id WHERE coalesce(c.created_at, '') < @x",
    "SELECT 1 FROM portal_sessions WHERE length(@now) < 5 AND trim(token_hash) = @h",
    // F5 look-alikes: BETWEEN or IS over datetime(), IS NULL checks, another table's column, a column outside the list
    "SELECT 1 FROM portal_sessions WHERE datetime(@now) BETWEEN datetime(created_at) AND datetime(expires_at)",
    "SELECT 1 FROM portal_sessions WHERE datetime(expires_at) NOT BETWEEN datetime(@a) AND datetime(@b)",
    "SELECT 1 FROM portal_sessions WHERE datetime(expires_at) IS NOT datetime(@now)",
    "SELECT 1 FROM portal_sessions WHERE expires_at IS NULL OR last_seen_at IS NOT NULL",
    "SELECT 1 FROM portal_accounts a JOIN customers c ON c.id = a.contact_id WHERE c.created_at BETWEEN @a AND @b AND c.created_at IS NOT @x",
    "SELECT 1 FROM portal_sessions WHERE id BETWEEN @a AND @b AND revoked_at IS NOT @r",
  ]
  for (const sql of clean) assert.deepEqual(hitsOf(sql), [], `wrongly reported: ${sql}`)
})

check('positive control: the file-level scan reports a seeded raw string and a seeded ORDER BY', () => {
  const seeded = (body) => [{ file: path.join(SRC, 'seed.ts'), text: `export const q = \`${body}\`` }]
  assert.equal(scanFiles(seeded('SELECT 1 FROM portal_sessions WHERE expires_at < CURRENT_TIMESTAMP')).length, 1)
  assert.equal(scanFiles(seeded('SELECT id FROM portal_sessions ORDER BY last_seen_at')).length, 1)
  assert.equal(scanFiles(seeded('SELECT 1 FROM portal_sessions WHERE datetime(expires_at) < datetime(@now)')).length, 0)
  // B4: the reviewer's seeded bracket-group comparison and its substr() form
  assert.equal(scanFiles(seeded('SELECT 1 FROM portal_sessions WHERE revoked_at IS NULL AND (expires_at < @now OR revoked_at IS NOT NULL)')).length, 1)
  assert.equal(scanFiles(seeded("SELECT 1 FROM portal_sessions s WHERE s.token_hash = @h AND substr(s.expires_at, 1, 19) > @now")).length, 1)
})

check('B4 mutant: S-D1 with a raw comparison at the start of its bracket group is reported', () => {
  const session = fs.readFileSync(path.join(SRC, 'lib', 'portalSession.ts'), 'utf8').replace(/\r\n/g, '\n')
  const mutated = session.replace("(datetime(last_seen_at) > datetime(created_at, '+60 seconds')", "(last_seen_at > datetime(created_at, '+60 seconds')")
  assert.notEqual(mutated, session, 'mutant applied: S-D1 holds the datetime() form')
  const files = realFiles().map((f) => (/lib[\\/]portalSession\.ts$/.test(f.file) ? { ...f, text: mutated } : f))
  assert.ok(scanFiles(files).some((h) => /portalSession\.ts: raw comparison of last_seen_at/.test(h)), 'the raw bracket-group comparison goes red')
})

check('B4 mutant: S-S1 with expires_at cut by substr() is reported', () => {
  const session = fs.readFileSync(path.join(SRC, 'lib', 'portalSession.ts'), 'utf8').replace(/\r\n/g, '\n')
  const mutated = session.replace('AND datetime(s.expires_at) > datetime(@now)', 'AND substr(s.expires_at, 1, 19) > @now')
  assert.notEqual(mutated, session, 'mutant applied: S-S1 holds the datetime() form')
  const files = realFiles().map((f) => (/lib[\\/]portalSession\.ts$/.test(f.file) ? { ...f, text: mutated } : f))
  assert.ok(scanFiles(files).some((h) => /portalSession\.ts: raw comparison of substr\(expires_at\)/.test(h)), 'the substr() comparison goes red')
})

check('mutant: the retention sweep with the raw predicate it had before S-R1 is reported', () => {
  const retention = fs.readFileSync(path.join(SRC, 'lib', 'ephemeralRetention.ts'), 'utf8')
  const mutated = retention.replace("datetime(expires_at) < datetime(@now)", 'expires_at < CURRENT_TIMESTAMP')
  assert.notEqual(mutated, retention, 'mutant applied: the sweep holds the datetime() form')
  const files = realFiles().map((f) => (/ephemeralRetention\.ts$/.test(f.file) ? { ...f, text: mutated } : f))
  assert.ok(scanFiles(files).length >= 1, 'the raw sweep predicate goes red')
})

check('mutant: a raw "=" inside the window CASE of S3d\'s S-P1, after its closed attempts CASE, is reported', () => {
  const join = fs.readFileSync(path.join(SRC, 'lib', 'portalTelegramJoin.ts'), 'utf8')
  const mutated = join.replace(
    'WHEN datetime(portal_telegram_pending.window_started_at) <= datetime(@now, @attempt_window) THEN @now',
    'WHEN portal_telegram_pending.window_started_at = @now THEN @now',
  )
  assert.notEqual(mutated, join, 'mutant applied: S-P1 holds the datetime() form')
  const files = realFiles().map((f) => (/lib[\\/]portalTelegramJoin\.ts$/.test(f.file) ? { ...f, text: mutated } : f))
  assert.ok(scanFiles(files).some((h) => /portalTelegramJoin\.ts: raw comparison of window_started_at/.test(h)), 'the raw window comparison goes red')
})

console.log(`\n${passed} passed${failures.length ? `, ${failures.length} FAILED: ${failures.join(' | ')}` : ''}`)
if (failures.length) process.exit(1)
