// Regression lock: a stored timestamp/date column wrapped in date()/
// datetime()/strftime() inside a WHERE/ON/ORDER BY defeats a B-tree index
// whose LEADING column is that same column -- SQLite cannot seek into an
// index by the output of a function applied to the column, so the planner
// falls back to a full scan of the indexed table on every request.
//
// History: an Aug-30 sweep found 36 such sites; session 77 fixed them across
// Aug 31 (9dfc7235, 3c36bfba, 60df8ba0, bd2f0680, 9736de07, ca3828e7) and
// Sep 1 (67b8e3b9). The class then REGRESSED FORWARD: routes shipped Aug 31
// (b480d8a8, fc1e4e4c) and Sep 1 (4341acf1) reintroduced the identical
// anti-pattern in brand-new code, because nothing stopped it. This file is
// that stop. It is a STATIC lock, not a fix: fixing a call site is out of
// scope for this file, and the escape hatch for a legitimate wrap is an
// ALLOWLIST entry carrying the reasoning.
//
// STATUS: GREEN as of Sep 4 2026 -- 0 confirmed offenders. It shipped RED on
// purpose against sales.ts, contacts.ts and compat.ts; all three are resolved:
//   - contacts.ts and compat.ts were fixed at the CALL SITES by their owning
//     lanes. contacts.ts now contains no date()/datetime()/strftime() wrap at
//     all, and compat.ts's two surviving "date(created_at)" mentions are both
//     inside comments describing the pattern that was removed.
//   - sales.ts is an ALLOWLIST entry below, not a code change: its wrap is
//     required for CORRECTNESS (two timestamp shapes coexist on one day) and
//     the call site is already floored on the raw column, so the index seek
//     survives. See that entry for the full reasoning and its caveat.
//
// So a RED run is now a REAL finding, not the documented baseline. Do not
// dismiss one on the strength of this header.
//
// WHAT IT DOES (and does not do):
//   1. Parses every migrations/*.sql for CREATE INDEX ... ON table(col, ...)
//      and CREATE TABLE, building table -> {leading column -> index name}.
//      Only a BARE leading column counts (e.g. `lower(name)` as a leading
//      term does not, because date()/datetime()/strftime() wrapping a
//      column can never use a functional index on a *different* function
//      of that column anyway -- the defect class this file locks is
//      specifically "a plain-column B-tree index, defeated by a wrap").
//   2. Walks cloudflare/src/**/*.ts as TEXT (no TypeScript parser, no SQL
//      parser) looking for date(/datetime(/strftime( applied to a bare
//      column or an alias.column, immediately followed by `,` or `)`,
//      optionally after a leading string-literal format argument (the
//      strftime('%Y-%m-%d', col) shape). This is deliberately a regex over
//      source text, not an AST -- see LIMITATIONS below.
//   3. For each match it tries to resolve alias -> table by scanning the
//      enclosing "scope" (the nearest top-level route handler / exported
//      function, found by splitting the file on `app.<verb>(` and
//      `export (async )?function` boundaries), then within that scope the
//      tightest enclosing statement "chunk" (bounded by `.prepare(` calls),
//      for FROM/JOIN/UPDATE/DELETE FROM table [alias] occurrences. A bare
//      column with no alias resolves only when exactly one distinct table
//      is in play. See resolveTable()'s doc comment for the two-tier order.
//   4. Only flags a match when (a) it resolved to a table+column with
//      confidence, (b) that table has an index whose LEADING column is
//      that column, (c) it is not on the explicit allowlist below, and
//      (d) the same source line also shows filter/order context (a
//      comparison operator, BETWEEN, or ORDER BY) -- so a harmless
//      computed SELECT-list expression is not flagged.
//   5. Everything it could not resolve to a table with confidence is
//      printed under UNRESOLVED and does NOT fail the run and is NOT
//      silently treated as fine either -- it is a third bucket, on purpose.
//
// LIMITATIONS (read before trusting a green run):
//   - No real SQL parser: a wrap split across multiple template-literal
//     interpolations, or written through a helper function (e.g.
//     businessDateWindow.ts's localDateExpr/localDateAtOrAfter), is
//     INVISIBLE to this scan, because the literal text "date(" never
//     appears at the call site. That is by design for the *helper*
//     call sites (they are the correct, sargable pattern -- see
//     businessDateWindow.ts's own comment for why), but it also means a
//     brand-new bespoke helper that reintroduces the anti-pattern behind a
//     function call would not be caught. Only literal, in-line SQL text is
//     covered.
//   - Alias resolution is scope-heuristic (nearest enclosing route/
//     function, then nearest enclosing `.prepare(` chunk), not a real
//     block-scope parse. A file that nests two statements in one handler
//     using the same alias for two different tables will falsely mark that
//     alias AMBIGUOUS and skip it (safe direction: undercounts, never
//     silently claims resolved).
//   - Cross-file alias resolution is out of scope entirely: a SQL fragment
//     builder (e.g. lib/promotionRulesSql.ts) that emits `p.column`
//     without ever writing `FROM ... p` itself (the FROM lives in the
//     caller, in a different file) is reported UNRESOLVED, not guessed.
//   - DROP INDEX is not modeled beyond a flat "index name no longer
//     exists" removal; if a migration ever drops one of the indexes this
//     file relies on, the lock will keep citing it by name until this file
//     is updated.
//   - It cannot see dynamic SQL built outside the string/template-literal
//     text it scans (e.g. a column name assembled from a variable and
//     never appearing as a literal identifier).
//   - It cannot tell "a wrap with no sargable escape hatch" apart from "a
//     wrap deliberately ANDed with a redundant same-column raw-value floor"
//     (the businessDateWindow.ts idiom: `date(col,'+7h') >= @p AND col >=
//     date(@p,'-1 day')`, which keeps the index usable). It flags BOTH,
//     because the fix this repo actually uses for that idiom (calling
//     localDateAtOrAfter/localDateAtOrBefore) makes the literal "date("
//     text vanish from the call site entirely, sidestepping the ambiguity.
//     If a future fix instead hand-writes the redundant floor next to a
//     literal date()/datetime() wrap without going through the helper, this
//     lock WILL still flag it as a false positive, and will need a new
//     allowlist entry (with that reasoning) rather than a rule change --
//     distinguishing "wrapped, unescaped" from "wrapped, but redundantly
//     floored" by text pattern alone is a materially harder parse this
//     file does not attempt.
//
// Run (from cloudflare/ or cloudflare/scripts/):
//   node scripts/test-sargable-date-filters-pure.cjs
//   node test-sargable-date-filters-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const CLOUDFLARE_DIR = path.join(__dirname, '..')
const SRC_DIR = path.join(CLOUDFLARE_DIR, 'src')
const { loadAll: loadAllMigrations } = require('./harness/load_migrations.cjs')

let passed = 0
const check = (label, cond) => { assert.ok(cond, label); passed++; console.log(`PASS ${label}`) }

// ---------------------------------------------------------------------------
// 1. Parse migrations -> table -> Map<leadingColumn(lowercase), indexName[]>
// ---------------------------------------------------------------------------

/** Splits a CREATE INDEX column list on top-level commas (ignores commas inside parens). */
function splitTopLevel(s) {
  const parts = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { parts.push(cur); cur = '' } else { cur += ch }
  }
  if (cur.trim()) parts.push(cur)
  return parts
}

function parseMigrations() {
  const sqlFiles = loadAllMigrations() // array of full file text, in migration order
  const tableIndexLeadingCols = new Map() // table -> Map<col_lower, Set<indexName>>
  const knownTables = new Set()
  const droppedIndexes = new Set()

  const createTableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi
  const createIndexRe = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?\s+ON\s+"?(\w+)"?\s*\(([\s\S]*?)\)/gi
  const dropIndexRe = /DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/gi

  for (const text of sqlFiles) {
    let m
    createTableRe.lastIndex = 0
    while ((m = createTableRe.exec(text))) knownTables.add(m[1])

    dropIndexRe.lastIndex = 0
    while ((m = dropIndexRe.exec(text))) droppedIndexes.add(m[1])

    createIndexRe.lastIndex = 0
    while ((m = createIndexRe.exec(text))) {
      const [, indexName, table, colsRaw] = m
      const cols = splitTopLevel(colsRaw)
      if (!cols.length) continue
      const first = cols[0].trim().replace(/\s+(ASC|DESC)$/i, '').replace(/^"|"$/g, '')
      // Only a bare identifier counts as a plain leading column. Anything
      // with '(' (a functional index like lower(name)) is a different
      // index shape than the one date()/datetime()/strftime() defeats.
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(first)) continue
      if (!tableIndexLeadingCols.has(table)) tableIndexLeadingCols.set(table, new Map())
      const colMap = tableIndexLeadingCols.get(table)
      const key = first.toLowerCase()
      if (!colMap.has(key)) colMap.set(key, new Set())
      colMap.get(key).add(indexName)
    }
  }

  // Honesty check: if a migration ever drops one of the indexes we just
  // recorded, remove it so the lock does not cite a dead index name.
  if (droppedIndexes.size) {
    for (const [, colMap] of tableIndexLeadingCols) {
      for (const [col, names] of colMap) {
        for (const dropped of droppedIndexes) names.delete(dropped)
        if (!names.size) colMap.delete(col)
      }
    }
  }

  return { tableIndexLeadingCols, knownTables }
}

// ---------------------------------------------------------------------------
// 2. Walk src/**/*.ts
// ---------------------------------------------------------------------------

function walkTsFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkTsFiles(full))
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

// ---------------------------------------------------------------------------
// 3. Scope splitting + alias resolution
// ---------------------------------------------------------------------------

const ALIAS_KEYWORD_BLACKLIST = new Set([
  'WHERE', 'ON', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'JOIN', 'GROUP', 'ORDER',
  'LIMIT', 'SET', 'VALUES', 'AS', 'UNION', 'HAVING', 'USING', 'CROSS',
  'NATURAL', 'FULL', 'AND', 'OR', 'SELECT', 'FROM',
])

const SCOPE_BOUNDARY_RE = /\bapp\.(?:get|post|put|delete|patch)\s*\(|\bexport\s+(?:default\s+)?(?:async\s+)?function\b|\bexport\s+const\s+\w+\s*=\s*(?:async\s*)?\(/g

function splitIntoScopes(text) {
  const boundaries = [0]
  let m
  SCOPE_BOUNDARY_RE.lastIndex = 0
  while ((m = SCOPE_BOUNDARY_RE.exec(text))) {
    if (m.index > 0) boundaries.push(m.index)
  }
  boundaries.push(text.length)
  const uniq = [...new Set(boundaries)].sort((a, b) => a - b)
  const scopes = []
  for (let i = 0; i < uniq.length - 1; i++) {
    scopes.push({ start: uniq[i], text: text.slice(uniq[i], uniq[i + 1]) })
  }
  return scopes
}

const FROM_JOIN_RE = /\b(?:FROM|JOIN)\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*)?/g
const UPDATE_RE = /\bUPDATE\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/g
const DELETE_FROM_RE = /\bDELETE\s+FROM\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/g

/** Builds { aliasToTable: Map<alias, table|'AMBIGUOUS'>, noAliasTables: Set<table> } for one scope. */
function buildAliasMap(scopeText, knownTables) {
  const aliasToTable = new Map()
  const noAliasTables = new Set()

  let m
  FROM_JOIN_RE.lastIndex = 0
  while ((m = FROM_JOIN_RE.exec(scopeText))) {
    const table = m[1]
    if (!knownTables.has(table)) continue // e.g. a CTE name, not a real table
    const aliasRaw = m[2]
    if (!aliasRaw || ALIAS_KEYWORD_BLACKLIST.has(aliasRaw.toUpperCase())) {
      noAliasTables.add(table)
      continue
    }
    const existing = aliasToTable.get(aliasRaw)
    if (existing && existing !== table) aliasToTable.set(aliasRaw, 'AMBIGUOUS')
    else if (!existing) aliasToTable.set(aliasRaw, table)
  }
  UPDATE_RE.lastIndex = 0
  while ((m = UPDATE_RE.exec(scopeText))) { if (knownTables.has(m[1])) noAliasTables.add(m[1]) }
  DELETE_FROM_RE.lastIndex = 0
  while ((m = DELETE_FROM_RE.exec(scopeText))) { if (knownTables.has(m[1])) noAliasTables.add(m[1]) }

  return { aliasToTable, noAliasTables }
}

/** The set of distinct tables actually in play in a scope, alias or not. */
function unionTables({ aliasToTable, noAliasTables }) {
  const set = new Set(noAliasTables)
  for (const t of aliasToTable.values()) if (t !== 'AMBIGUOUS') set.add(t)
  return set
}

// A finer boundary than the route/function scope: each `.prepare(` call
// starts a new statement chunk that runs to the next `.prepare(` (or the
// end of its enclosing scope). This disambiguates a route that builds
// several independent single-table queries in one handler (e.g. the
// dashboard's Promise.all of unrelated SELECTs) -- each query's own FROM
// then resolves a bare column inside THAT query without being confused by
// an unrelated bare FROM in a sibling query in the same handler.
const PREPARE_BOUNDARY_RE = /\.prepare\s*\(/g

function splitIntoChunks(scopeText) {
  const boundaries = [0]
  let m
  PREPARE_BOUNDARY_RE.lastIndex = 0
  while ((m = PREPARE_BOUNDARY_RE.exec(scopeText))) {
    if (m.index > 0) boundaries.push(m.index)
  }
  boundaries.push(scopeText.length)
  const uniq = [...new Set(boundaries)].sort((a, b) => a - b)
  const chunks = []
  for (let i = 0; i < uniq.length - 1; i++) {
    chunks.push({ start: uniq[i], text: scopeText.slice(uniq[i], uniq[i + 1]) })
  }
  return chunks
}

/**
 * Resolves alias/bare column -> table, trying the tightest scope first
 * (the statement chunk containing the match) and falling back to the whole
 * route/function scope only when the chunk itself carries no FROM/JOIN
 * information at all (the `conditions.push(...)` pattern, where the alias
 * is defined in one chunk but its FROM lives in a sibling chunk of the
 * same route -- both contacts.ts AP/AR filters and compat.ts's legacy
 * deleted-items filter build conditions this way).
 */
function resolveTable(alias, column, chunkInfo, scopeInfo) {
  for (const info of [chunkInfo, scopeInfo]) {
    if (alias) {
      const t = info.aliasToTable.get(alias)
      if (t === 'AMBIGUOUS') return { table: null, reason: `alias "${alias}" maps to more than one table in scope` }
      if (t) return { table: t, reason: '' }
      continue // alias not mentioned in this tier at all -- try the wider tier
    }
    const union = unionTables(info)
    if (union.size === 1) return { table: [...union][0], reason: '' }
    if (union.size > 1) return { table: null, reason: `bare column and ${union.size} distinct tables in scope (ambiguous)` }
    // union.size === 0: this tier has no FROM/JOIN/UPDATE/DELETE FROM at all -- try the wider tier
  }
  return { table: null, reason: alias ? `alias "${alias}" not found via FROM/JOIN in this scope` : 'no FROM/UPDATE/DELETE FROM table found for this bare column' }
}

// ---------------------------------------------------------------------------
// 4. date()/datetime()/strftime() column-wrap matches
// ---------------------------------------------------------------------------

// Matches: date(  [optional 'format string', ]  [alias.]column  followed by , or )
// The optional leading quoted arg covers strftime('%Y-%m-%d', col) and
// date('now', ...): a leading quote is consumed WITHOUT being mistaken for
// the column, so date('now', ...) never matches on 'now' as if it were a
// column (it isn't an identifier, and the second position after it is not
// an identifier either in that case, so the whole match correctly fails).
const WRAP_RE = /(?<![A-Za-z0-9_])(date|datetime|strftime)\(\s*(?:'[^']*'\s*,\s*)?(?:([A-Za-z_][A-Za-z0-9_]*)\.)?([A-Za-z_][A-Za-z0-9_]*)\s*[,)]/g

const FILTER_CONTEXT_RE = /(>=|<=|!=|<>|=|<|>|\bBETWEEN\b|\bORDER\s+BY\b)/i

function lineAt(text, offset) {
  let line = 1
  for (let i = 0; i < offset; i++) if (text[i] === '\n') line++
  return line
}

function lineTextAt(text, offset) {
  const start = text.lastIndexOf('\n', offset) + 1
  let end = text.indexOf('\n', offset)
  if (end === -1) end = text.length
  return text.slice(start, end)
}

/**
 * Blanks out `//` and block comments (replacing their characters with
 * spaces, never removing a character, so every offset/line number computed
 * against the ORIGINAL text still lines up). Without this, a doc comment
 * that quotes SQL as an example -- e.g. businessDateWindow.ts's own
 * date(param, '-1 day') explanation of the pattern it implements -- reads
 * as a false candidate. String/template literals are left untouched (a
 * small state machine, not a full lexer: it tracks quote/backtick/escape
 * state and only strips comments while NOT inside one of those).
 */
function blankComments(text) {
  const out = text.split('')
  let state = 'code' // code | single | double | template | line | block
  for (let i = 0; i < out.length; i++) {
    const ch = out[i]
    const next = out[i + 1]
    if (state === 'line') {
      if (ch === '\n') state = 'code'
      else out[i] = ' '
      continue
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') { out[i] = ' '; out[i + 1] = ' '; i++; state = 'code' }
      else if (ch !== '\n') out[i] = ' '
      continue
    }
    if (state === 'single' || state === 'double' || state === 'template') {
      if (ch === '\\') { i++; continue } // skip escaped char
      if ((state === 'single' && ch === "'") || (state === 'double' && ch === '"') || (state === 'template' && ch === '`')) state = 'code'
      continue
    }
    // state === 'code'
    if (ch === "'") { state = 'single'; continue }
    if (ch === '"') { state = 'double'; continue }
    if (ch === '`') { state = 'template'; continue }
    if (ch === '/' && next === '/') { out[i] = ' '; out[i + 1] = ' '; i++; state = 'line'; continue }
    if (ch === '/' && next === '*') { out[i] = ' '; out[i + 1] = ' '; i++; state = 'block'; continue }
  }
  return out.join('')
}

// ---------------------------------------------------------------------------
// 5. Allowlist -- deliberate non-offenders, each with a REASON.
//    Keyed by (relative file path, resolved table, resolved column, alias).
//    alias: null means "bare column, no alias prefix in the source text".
// ---------------------------------------------------------------------------

const ALLOWLIST = [
  {
    file: 'src/lib/salesAnalytics.ts', table: 'sales', column: 'created_at', alias: null,
    reason: "getSalesDayReport's per-sale drill ORDER BY datetime(created_at) DESC, id DESC "
      + "wraps the idx_sales_created_pg leading column, but the WHERE (whereActiveSales) is "
      + "already sargable and scoped to a single business day via the same helper, and the "
      + "query carries LIMIT 1000 -- a single shop-day never approaches that, so the planner's "
      + "sargable WHERE seek plus a bounded in-memory sort costs nothing extra. Recorded as a "
      + "deliberate decision, not an oversight.",
  },
  {
    file: 'src/lib/auth.ts', table: 'user_sessions', column: 'last_seen_at', alias: null,
    reason: 'sessions.last_seen_at has no index at all (see migrations) -- wrapping it in '
      + 'datetime() defeats nothing, because there is nothing sargable to defeat. Kept as an '
      + 'explicit entry so a future reader sees the reasoning instead of re-deriving it.',
  },
  {
    file: 'src/lib/promotionRulesSql.ts', table: 'promotions', column: 'discount_starts_at', alias: 'p',
    reason: 'promotion window bounds have no index on discount_starts_at/discount_ends_at -- '
      + 'promotions is a small, is_active-filtered table (idx_promotions_active_sort), so '
      + 'this predicate never drives a scan of a large table. NOTE: this entry is currently '
      + "unreachable in practice -- the scan reports it UNRESOLVED instead, because the FROM "
      + "for alias 'p' lives in the CALLER (products.ts), a different file, and cross-file "
      + 'alias resolution is out of scope (see LIMITATIONS). Kept anyway so the reasoning is '
      + 'on record if resolution is ever extended across files.',
  },
  {
    file: 'src/lib/promotionRulesSql.ts', table: 'promotions', column: 'discount_ends_at', alias: 'p',
    reason: 'see discount_starts_at above -- same table, same no-index rationale, same '
      + 'currently-unreachable note.',
  },
  {
    file: 'src/routes/sales.ts', table: 'sales', column: 'created_at', alias: 's',
    reason: "the details-export keyset cursor and its ORDER BY. This is the exact false "
      + "positive LIMITATIONS predicts: a datetime() wrap deliberately ANDed with a "
      + "redundant same-column RAW floor. sales.created_at genuinely carries two shapes on "
      + "the same calendar days -- live inserts are YYYY-MM-DD HH:MM:SS, legacy-import rows "
      + "are ISO YYYY-MM-DDTHH:MM:SS.sssZ -- and a raw compare misorders them, because T "
      + "(0x54) sorts after the space (0x20) at position 10. The wrap is therefore required "
      + "for CORRECTNESS, not inherited caution; removing it reintroduces a real same-day "
      + "pagination bug. The index is not lost: the call site hand-writes a bare "
      + "s.created_at >= @afterCreatedAtFloor on the first 10 chars (identical in both "
      + "shapes, so it can never exclude a row the exact clause would keep), which gives the "
      + "planner its seek into idx_sales_created_pg. The wrap then only breaks ties inside "
      + "that seeked range, and the ORDER BY sorts one LIMITed page. Because that floor is "
      + "hand-written rather than routed through localDateAtOrAfter, the literal datetime( "
      + "text stays visible and this lock still flags it -- which LIMITATIONS says to resolve "
      + "with an allowlist entry, not a rule change. CAVEAT: the key is file+table+column+"
      + "alias with no line number, so this also silences any FUTURE datetime(s.created_at) "
      + "added anywhere in sales.ts. Re-read the call sites before trusting this entry to "
      + "still describe them.",
  },
  {
    file: 'src/lib/legacySubtotalRepair.ts', table: 'sales', column: 'created_at', alias: 's',
    reason: "the one-off Sep 2-3 repair uses this expression only to verify each captured "
      + "row's business date after stateCount joins a canonical expected manifest row to "
      + "sales by s.id=e.id. That manifest is hard-limited to the exact 22 IDs 16842-16863, "
      + "so created_at never selects or orders the sales table. EXPLAIN QUERY PLAN for the "
      + "generated entry guard reports SCAN json_each followed by SEARCH s USING INTEGER "
      + "PRIMARY KEY (rowid=?) for both the before and retry branches; it does not scan sales "
      + "or use idx_sales_created_pg. The structural regression assertion below pins the "
      + "single wrapped check, exact cohort bound, and primary-key join that justify this "
      + "exception; revisit the allowlist if any of those conditions changes.",
  },
  {
    file: 'src/routes/compat.ts', table: 'products', column: 'expiry_date', alias: null,
    reason: 'the low-stock/expiry alert has no index on products.expiry_date -- the recorded '
      + 'deliberate decision (see compat.ts) is that this alert query is bounded by is_active '
      + 'and runs over the whole product catalog regardless, so date()-wrapping the expiry '
      + 'bound costs nothing beyond what the query already does.',
  },
]

function allowlistKey(file, table, column, alias) {
  return `${file} ${table} ${column} ${alias || ''}`
}
const ALLOWLIST_SET = new Set(ALLOWLIST.map((e) => allowlistKey(e.file, e.table, e.column, e.alias)))

// ---------------------------------------------------------------------------
// 6. Run the scan
// ---------------------------------------------------------------------------

function scanFile(absPath, relPath, tableIndexLeadingCols, knownTables) {
  const text = fs.readFileSync(absPath, 'utf8')
  // Comments blanked (same length/offsets as `text`) so a doc comment that
  // quotes SQL as an example is never mistaken for live SQL. Display
  // snippets still come from the original `text`.
  const codeText = blankComments(text)
  const scopes = splitIntoScopes(codeText)
  const confirmed = []
  const unresolved = []

  for (const scope of scopes) {
    const scopeInfo = buildAliasMap(scope.text, knownTables)
    const chunks = splitIntoChunks(scope.text)

    let m
    WRAP_RE.lastIndex = 0
    while ((m = WRAP_RE.exec(scope.text))) {
      const fn = m[1]
      const alias = m[2] || null
      const column = m[3]
      const matchOffset = scope.start + m.index
      const line = lineAt(text, matchOffset)
      const lineText = lineTextAt(text, matchOffset)

      if (!FILTER_CONTEXT_RE.test(lineText)) continue // SELECT-list/GROUP-BY-only expression, not our defect class

      // Tightest-scope-first resolution: the statement chunk (bounded by
      // `.prepare(` calls) containing this match, falling back to the
      // whole route/function scope. See resolveTable's doc comment.
      const chunk = chunks.find((c) => m.index >= c.start && m.index < c.start + c.text.length) || { text: '' }
      const chunkInfo = buildAliasMap(chunk.text, knownTables)
      const { table, reason: resolution } = resolveTable(alias, column, chunkInfo, scopeInfo)

      if (!table) {
        unresolved.push({ file: relPath, line, fn, alias, column, reason: resolution, snippet: lineText.trim() })
        continue
      }

      const key = allowlistKey(relPath, table, column, alias)
      if (ALLOWLIST_SET.has(key)) continue

      const colMap = tableIndexLeadingCols.get(table)
      const indexNames = colMap ? colMap.get(column.toLowerCase()) : undefined
      if (!indexNames || !indexNames.size) continue // no leading index on this column -- not this defect class

      confirmed.push({
        file: relPath, line, fn, alias, column, table,
        indexNames: [...indexNames],
        snippet: lineText.trim(),
      })
    }
  }

  return { confirmed, unresolved }
}

function main() {
  const { tableIndexLeadingCols, knownTables } = parseMigrations()
  check('parsed at least one table with a leading-column index from migrations', tableIndexLeadingCols.size > 0)
  check(
    'idx_sales_created_pg parsed with leading column created_at on table sales',
    !!(tableIndexLeadingCols.get('sales') && tableIndexLeadingCols.get('sales').get('created_at') && tableIndexLeadingCols.get('sales').get('created_at').has('idx_sales_created_pg')),
  )
  check(
    'idx_supplier_invoices_date parsed with leading column invoice_date on table supplier_invoices',
    !!(tableIndexLeadingCols.get('supplier_invoices') && tableIndexLeadingCols.get('supplier_invoices').get('invoice_date') && tableIndexLeadingCols.get('supplier_invoices').get('invoice_date').has('idx_supplier_invoices_date')),
  )
  check(
    'idx_customer_receivables_date parsed with leading column invoice_date on table customer_receivables',
    !!(tableIndexLeadingCols.get('customer_receivables') && tableIndexLeadingCols.get('customer_receivables').get('invoice_date') && tableIndexLeadingCols.get('customer_receivables').get('invoice_date').has('idx_customer_receivables_date')),
  )
  check(
    'idx_legacy_deleted_items_deleted_at parsed with leading column deleted_at on table legacy_deleted_sale_items',
    !!(tableIndexLeadingCols.get('legacy_deleted_sale_items') && tableIndexLeadingCols.get('legacy_deleted_sale_items').get('deleted_at') && tableIndexLeadingCols.get('legacy_deleted_sale_items').get('deleted_at').has('idx_legacy_deleted_items_deleted_at')),
  )
  check(
    'a functional leading index (e.g. lower(name)) is NOT recorded as a plain leading column',
    !(tableIndexLeadingCols.get('products') && tableIndexLeadingCols.get('products').has('name')),
  )

  const legacySubtotalRepairSource = fs.readFileSync(path.join(SRC_DIR, 'lib', 'legacySubtotalRepair.ts'), 'utf8')
  check(
    'legacy subtotal date validation remains one exact-22 primary-key-bounded check',
    (legacySubtotalRepairSource.match(/date\(datetime\(s\.created_at\s*,\s*'\+7 hours'\)\)/g) || []).length === 1
      && /EXPECTED_IDS\s*=\s*Object\.freeze\(Array\.from\(\{\s*length:\s*22\s*\},\s*\(_\s*,\s*index\)\s*=>\s*16842\s*\+\s*index\)\)/.test(legacySubtotalRepairSource)
      && /FROM json_each\(@rows\)/.test(legacySubtotalRepairSource)
      && /FROM expected e JOIN sales s ON s\.id=e\.id WHERE/.test(legacySubtotalRepairSource),
  )

  const files = walkTsFiles(SRC_DIR)
  check('walked at least 50 source files under src/', files.length >= 50)

  let allConfirmed = []
  let allUnresolved = []
  for (const abs of files) {
    const rel = 'src' + abs.slice(SRC_DIR.length).split(path.sep).join('/')
    const { confirmed, unresolved } = scanFile(abs, rel, tableIndexLeadingCols, knownTables)
    allConfirmed.push(...confirmed)
    allUnresolved.push(...unresolved)
  }

  check('allowlist is non-empty', ALLOWLIST.length > 0)

  console.log('')
  if (allConfirmed.length) {
    console.log(`--- ${allConfirmed.length} CONFIRMED sargable-date-filter offender(s) ---`)
    for (const o of allConfirmed) {
      console.log(
        `${o.file}:${o.line} -- ${o.fn}(${o.alias ? o.alias + '.' : ''}${o.column}) wraps `
        + `${o.table}.${o.column}, defeating ${o.indexNames.join(', ')} (leading column ${o.column})\n`
        + `    ${o.snippet}`,
      )
    }
  } else {
    console.log('--- 0 CONFIRMED sargable-date-filter offenders ---')
  }

  console.log('')
  console.log(`--- ${allUnresolved.length} UNRESOLVED candidate(s) (could not confirm a table with confidence) ---`)
  for (const u of allUnresolved) {
    console.log(`${u.file}:${u.line} -- ${u.fn}(${u.alias ? u.alias + '.' : ''}${u.column}) UNRESOLVED: ${u.reason}\n    ${u.snippet}`)
  }
  console.log('')

  if (allConfirmed.length > 0) {
    console.log(`FAIL ${allConfirmed.length} confirmed sargable-date-filter regression(s) -- see list above. This lock is GREEN at baseline, so this is a REAL regression, not the documented starting state: either fix the call site, or add an ALLOWLIST entry with the reasoning if the wrap is required for correctness and the query is floored some other way.`)
    process.exitCode = 1
  } else {
    console.log(`PASS no confirmed sargable-date-filter regressions (checked ${files.length} files, ${passed} assertions)`)
  }
}

main()
