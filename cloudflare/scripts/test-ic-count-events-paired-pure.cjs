'use strict'
// Gate for the count list as a view of Products (spec SPEC-ic-as-products-view, I1 to I3): a device that holds count marks follows the event feed, so every writer of count state must
// leave an event in the batch it commits. A source walk, no database.
//   I1  an INSERT or UPDATE of inventory_check_items (state change, take-back, updated_at) sits in a unit that also inserts an inventory_check_events row naming the product;
//       an INSERT of unstarted items (no state column) needs any event of the session.
//   I2  an INSERT or UPDATE of inventory_check_approvals sits in a unit that also inserts an event of the session (product or NULL).
//   I3  a migration or ops script that writes the three count tables rotates the data epoch (holds ROTATE_DATA_EPOCH_SQL's text) or bumps MARKS_FORMAT.
// A "unit" is one top-level declaration. A builder of ONE statement (no list, no batch) hands the duty to every place that uses it; a unit that builds a list of statements or runs a batch must hold the event itself.
// Run: node scripts/test-ic-count-events-paired-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const repo = path.join(root, '..')

const ALLOWED = new Map([
  ['cloudflare/migrations/0259_inventory_check_sessions.sql', 'before 0320: no device held a count map'],
  ['cloudflare/migrations/0268_restore_history_trigger_carveout.sql', 'before 0320: no device held a count map'],
  ['cloudflare/migrations/0285_inventory_check_items_latest.sql', 'before 0320: no device held a count map'],
  ['cloudflare/migrations/0286_inventory_check_approvals.sql', 'before 0320: no device held a count map'],
  ['cloudflare/migrations/0294_inventory_check_lot_lines.sql', 'before 0320: no device held a count map'],
  ['cloudflare/migrations/0316_inventory_check_line_decisions.sql', 'in-place repair before any device map existed (design review knows it)'],
  ['cloudflare/migrations/0318_inventory_check_task_index.sql', 'before 0320: no device held a count map'],
  ['cloudflare/migrations/0319_inventory_check_open_task_index.sql', 'before 0320: no device held a count map'],
])
const LAST_ALLOWED_MIGRATION = 319

// Real writers of today's tree that break the rule, reported to the lead and left unchanged. An entry that stops matching fails the test, so it leaves this list when the writer is fixed.
const KNOWN_DEFECTS = [
  { file: 'cloudflare/src/lib/inventoryCheckApprovals.ts', unit: 'releaseUntouched', reason: 'releases an approval claim in a batch with no event; it changes neither the marks nor the waiting set, so the lead decides: pair it, or exempt claim-only updates' },
]

const WRITE = /\b(INSERT\s+(?:OR\s+\w+\s+)?INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+(inventory_check_items|inventory_check_approvals|inventory_check_sessions)\b/gi
const EVENT_INSERT = /INSERT\s+INTO\s+inventory_check_events\s*\(([^)]*)\)\s*(?:VALUES\s*\(([\s\S]*?)\)\s*$|VALUES\s*\(([\s\S]*?)\)|SELECT\s+([\s\S]*))/i
const EXECUTES = /\b(batch|batchOnce|commit|record|exec|run)\s*\(/
const UNIT_START = new Set(['export', 'const', 'let', 'var', 'function', 'async', 'type', 'interface', 'class', 'enum', 'declare'])

function lex(text) {
  const tokens = []
  let i = 0, line = 0, col = 0
  const last = () => tokens[tokens.length - 1]
  const regexAllowed = () => { const t = last(); return !t || (t.k === 'p' && '(,=:[!&|?{};+-*%<>~^'.includes(t.v)) || (t.k === 'id' && /^(return|typeof|case|in|of)$/.test(t.v)) }
  const skipTemplate = (start) => {
    let j = start + 1
    while (j < text.length) {
      if (text[j] === '\\') j += 2
      else if (text[j] === '`') return j + 1
      else if (text[j] === '$' && text[j + 1] === '{') j = skipBraces(j + 2)
      else j++
    }
    return j
  }
  const skipString = (start) => { const q = text[start]; let j = start + 1; while (j < text.length && text[j] !== q) j += text[j] === '\\' ? 2 : 1; return j + 1 }
  function skipBraces(start) {
    let j = start, depth = 1
    while (j < text.length && depth) {
      const c = text[j]
      if (c === '`') j = skipTemplate(j)
      else if (c === '"' || c === "'") j = skipString(j)
      else if (c === '/' && text[j + 1] === '/') { while (j < text.length && text[j] !== '\n') j++ }
      else if (c === '/' && text[j + 1] === '*') { j = text.indexOf('*/', j + 2); j = j < 0 ? text.length : j + 2 }
      else { if (c === '{') depth++; else if (c === '}') depth--; j++ }
    }
    return j
  }
  const lineStarts = [0]
  for (let k = 0; k < text.length; k++) if (text[k] === '\n') lineStarts.push(k + 1)
  const colOf = (pos) => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1 } return pos - lineStarts[lo] }
  while (i < text.length) {
    const c = text[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue }
    if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 2; continue }
    const start = i, startCol = colOf(i)
    if (c === '`') { i = skipTemplate(i); tokens.push({ k: 's', v: text.slice(start + 1, i - 1), s: start, e: i, col: startCol }); continue }
    if (c === '"' || c === "'") { i = skipString(i); tokens.push({ k: 's', v: text.slice(start + 1, i - 1), s: start, e: i, col: startCol }); continue }
    if (c === '/' && regexAllowed()) {
      i++
      let inClass = false
      while (i < text.length && (text[i] !== '/' || inClass) && text[i] !== '\n') { if (text[i] === '\\') i++; else if (text[i] === '[') inClass = true; else if (text[i] === ']') inClass = false; i++ }
      i++
      while (/[a-z]/i.test(text[i] || '')) i++
      tokens.push({ k: 'r', v: '', s: start, e: i, col: startCol })
      continue
    }
    if (/[A-Za-z_$]/.test(c)) { while (/[\w$]/.test(text[i] || '')) i++; tokens.push({ k: 'id', v: text.slice(start, i), s: start, e: i, col: startCol }); continue }
    if (/\d/.test(c)) { while (/[\w.]/.test(text[i] || '')) i++; tokens.push({ k: 'n', v: '', s: start, e: i, col: startCol }); continue }
    i++
    tokens.push({ k: 'p', v: c, s: start, e: i, col: startCol })
  }
  void line; void col
  return tokens
}

function units(tokens) {
  const out = []
  let depth = 0, current = null
  for (let n = 0; n < tokens.length; n++) {
    const t = tokens[n]
    if (depth === 0 && t.k === 'id' && t.col === 0 && UNIT_START.has(t.v)) {
      if (current) current.end = n
      let m = n
      while (tokens[m] && tokens[m].k === 'id' && /^(export|default|async|declare)$/.test(tokens[m].v)) m++
      const kw = tokens[m]
      const nameToken = kw && kw.k === 'id' && /^(function|const|let|var|type|interface|class|enum)$/.test(kw.v) ? tokens[m + 1 + (tokens[m + 1] && tokens[m + 1].v === '*' ? 1 : 0)] : null
      current = { start: n, end: tokens.length, name: nameToken && nameToken.k === 'id' ? nameToken.v : null }
      out.push(current)
    }
    if (t.k === 'p') { if ('{(['.includes(t.v)) depth++; else if ('})]'.includes(t.v)) depth = Math.max(0, depth - 1) }
  }
  return out
}

function constValues(tokens, from, to) {
  const map = new Map()
  for (let n = from; n < to - 3; n++) {
    if (tokens[n].k === 'id' && tokens[n].v === 'const' && tokens[n + 1].k === 'id' && tokens[n + 2].v === '=' && tokens[n + 3].k === 's') {
      const after = tokens[n + 4]
      if (!after || !(after.k === 'p' && '+.'.includes(after.v))) map.set(tokens[n + 1].v, tokens[n + 3].v)
    }
  }
  return map
}

function resolve(text, ...scopes) {
  let out = text
  for (let pass = 0; pass < 3; pass++) {
    out = out.replace(/\$\{([A-Za-z_$][\w$]*)\}/g, (whole, name) => { for (const scope of scopes) if (scope.has(name)) return scope.get(name); return whole })
  }
  return out
}

function splitTop(text) {
  const parts = []
  let depth = 0, quote = '', cur = ''
  for (const ch of text) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue }
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  parts.push(cur.trim())
  return parts
}

function eventInserts(sql) {
  const found = []
  for (const piece of sql.split(/(?=INSERT\s+INTO\s+inventory_check_events)/i)) {
    const m = EVENT_INSERT.exec(piece)
    if (!m) continue
    const cols = m[1].split(',').map(s => s.trim())
    const at = cols.indexOf('product_id')
    let list
    if (m[2] !== undefined || m[3] !== undefined) list = splitTop(m[2] !== undefined ? m[2] : m[3])
    else { const select = m[4].split(/\s+FROM\s+|\s+WHERE\s+/i)[0]; list = splitTop(select) }
    const value = at >= 0 ? list[at] : undefined
    found.push({ value, names: value !== undefined && !/^NULL$/i.test(value) })
  }
  return found
}

function sqlTokens(tokens, from, to, scopes) {
  const out = []
  for (let n = from; n < to; n++) if (tokens[n].k === 's') out.push({ n, sql: resolve(tokens[n].v, ...scopes) })
  return out
}

function analyzeCode(files) {
  const parsed = []
  for (const [file, text] of files) {
    if (!/inventory_check_(items|approvals|events|sessions)|ROTATE_DATA_EPOCH|MARKS_FORMAT/.test(text) && !/inventory_check/.test(text)) continue
    const tokens = lex(text)
    const fileConsts = constValues(tokens, 0, tokens.length)
    const list = units(tokens)
    for (const unit of list) {
      unit.file = file; unit.tokens = tokens; unit.text = text
      unit.consts = constValues(tokens, unit.start, unit.end)
      unit.sql = sqlTokens(tokens, unit.start, unit.end, [unit.consts, fileConsts])
      unit.events = unit.sql.flatMap(({ sql }) => eventInserts(sql))
      const body = tokens.slice(unit.start, unit.end)
      unit.buildsList = body.some(t => t.k === 'p' && t.v === '[')
      unit.ids = new Set(body.filter(t => t.k === 'id').map(t => t.v))
      unit.executes = EXECUTES.test(text.slice(tokens[unit.start].s, tokens[unit.end - 1] ? tokens[unit.end - 1].e : text.length))
      parsed.push(unit)
    }
  }
  const helpers = new Map()
  for (const unit of parsed) {
    if (!unit.name || !unit.events.length) continue
    const firstEvent = unit.sql.find(({ sql }) => /INSERT\s+INTO\s+inventory_check_events/i.test(sql))
    const head = unit.text.slice(unit.tokens[unit.start].s, unit.tokens[firstEvent.n].s)
    const first = unit.events[0]
    const param = first.value && /^@(\w+)$/.exec(first.value)
    const isFn = /\bfunction\b|=>/.test(head) && /\(/.test(head)
    helpers.set(unit.name, { unit, names: unit.events.some(e => e.names), param: isFn && param && new RegExp(`\\b${param[1]}\\b`).test(head) ? param[1] : null, isFn })
  }

  const hasTopKey = (args, key) => {
    let depth = 0
    for (let n = 0; n < args.length; n++) {
      const t = args[n]
      if (t.k === 'p') { if ('([{'.includes(t.v)) depth++; else if (')]}'.includes(t.v)) depth--; continue }
      if (t.k === 'id' && t.v === key && depth === 1 && args[n - 1] && (args[n - 1].v === '{' || args[n - 1].v === ',') && args[n + 1] && (args[n + 1].v === ':' || args[n + 1].v === ',' || args[n + 1].v === '}')) return true
    }
    return false
  }
  const callArgs = (unit, name) => {
    const out = []
    const toks = unit.tokens
    for (let n = unit.start; n < unit.end - 1; n++) {
      if (toks[n].k === 'id' && toks[n].v === name && toks[n + 1].v === '(') {
        let depth = 0, m = n + 1
        for (; m < unit.end; m++) { if (toks[m].k === 'p') { if ('([{'.includes(toks[m].v)) depth++; else if (')]}'.includes(toks[m].v)) { depth--; if (!depth) break } } }
        out.push(toks.slice(n + 2, m))
      }
    }
    return out
  }

  const evidence = (unit) => {
    let any = unit.events.length > 0, product = unit.events.some(e => e.names)
    for (const [name, h] of helpers) {
      if (h.unit === unit || !unit.ids.has(name)) continue
      any = true
      if (h.param) { if (callArgs(unit, name).some(args => hasTopKey(args, h.param))) product = true }
      else if (h.names) product = true
    }
    return { any, product }
  }

  const usesOf = (name, self) => parsed.filter(u => u !== self && u.ids.has(name))
  const covered = (unit, needProduct, depth, seen) => {
    const ev = evidence(unit)
    if (needProduct ? ev.product : ev.any) return true
    if (unit.executes || unit.buildsList || !unit.name || depth > 3 || seen.has(unit.name)) return false
    seen.add(unit.name)
    const users = usesOf(unit.name, unit)
    return users.length > 0 && users.every(user => covered(user, needProduct, depth + 1, seen))
  }

  const violations = []
  for (const unit of parsed) {
    for (const { sql } of unit.sql) {
      WRITE.lastIndex = 0
      let m
      while ((m = WRITE.exec(sql))) {
        const table = m[2].toLowerCase(), verb = m[1].toUpperCase()
        if (table === 'inventory_check_sessions') continue
        const rest = sql.slice(m.index + m[0].length)
        let needProduct = table === 'inventory_check_items'
        if (needProduct && /^INSERT|^REPLACE/.test(verb)) { const cols = /^\s*\(([^)]*)\)/.exec(rest); if (cols && !/\bstate\b/.test(cols[1])) needProduct = false }
        if (needProduct && /^UPDATE/.test(verb)) { const set = /\bSET\b([\s\S]*?)(?:\bWHERE\b|\bFROM\b|\bRETURNING\b|$)/i.exec(rest); if (set && !/\bstate\b|\bupdated_at\b/.test(set[1])) needProduct = false }
        if (!covered(unit, needProduct, 0, new Set())) violations.push({ file: unit.file, unit: unit.name, table, verb: verb.split(/\s/)[0], needs: needProduct ? 'an event naming the product' : 'an event of the session' })
      }
    }
  }
  return violations
}

const collapse = (text) => text.replace(/\s+/g, ' ').trim().toLowerCase()
function rotationText() {
  const source = fs.readFileSync(path.join(root, 'src/lib/dataEpochSql.ts'), 'utf8')
  const m = /ROTATE_DATA_EPOCH_SQL = `([\s\S]*?)`/.exec(source)
  assert.ok(m, 'dataEpochSql.ts no longer holds ROTATE_DATA_EPOCH_SQL as a template literal')
  return collapse(m[1])
}
const rotates = (text, rotation) => collapse(text).includes(rotation) || /\bROTATE_DATA_EPOCH_SQL\b|\bMARKS_FORMAT\b/.test(text)

function stripSqlComments(text) { return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ') }

function analyzeSqlFile(file, text, rotation) {
  const body = stripSqlComments(text)
  const out = []
  const tables = new Set()
  WRITE.lastIndex = 0
  let m
  while ((m = WRITE.exec(body))) {
    const table = m[2].toLowerCase()
    tables.add(table)
    const rest = body.slice(m.index + m[0].length)
    const events = eventInserts(body)
    if (table === 'inventory_check_approvals' && !events.length) out.push({ file, table, rule: 'I2', needs: 'an event of the session' })
    if (table === 'inventory_check_items') {
      let needProduct = true
      const verb = m[1].toUpperCase()
      if (/^INSERT|^REPLACE/.test(verb)) { const cols = /^\s*\(([^)]*)\)/.exec(rest); if (cols && !/\bstate\b/.test(cols[1])) needProduct = false }
      if (/^UPDATE/.test(verb)) { const set = /\bSET\b([\s\S]*?)(?:\bWHERE\b|\bFROM\b|\bRETURNING\b|;|$)/i.exec(rest); if (set && !/\bstate\b|\bupdated_at\b/.test(set[1])) needProduct = false }
      if (needProduct ? !events.some(e => e.names) : !events.length) out.push({ file, table, rule: 'I1', needs: needProduct ? 'an event naming the product' : 'an event of the session' })
    }
  }
  if (tables.size && !rotates(text, rotation)) out.push({ file, table: [...tables].join(','), rule: 'I3', needs: 'ROTATE_DATA_EPOCH_SQL or a MARKS_FORMAT bump' })
  return out
}

function analyzeOpsCode(file, text, rotation) {
  const out = analyzeCode(new Map([[file, text]])).map(v => ({ ...v, rule: 'I1/I2' }))
  const tokens = lex(text)
  const writes = tokens.some(t => t.k === 's' && (WRITE.lastIndex = 0, WRITE.test(t.v)))
  if (writes && !rotates(text, rotation)) out.push({ file, rule: 'I3', needs: 'ROTATE_DATA_EPOCH_SQL or a MARKS_FORMAT bump' })
  return out
}

function walk(dir, accept, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, accept, out)
    else if (accept(entry.name)) out.push(full)
  }
  return out
}
const rel = (full) => path.relative(repo, full).split(path.sep).join('/')

function analyzeTree() {
  const rotation = rotationText()
  const violations = []
  const srcFiles = new Map(walk(path.join(root, 'src'), n => n.endsWith('.ts')).map(f => [rel(f), fs.readFileSync(f, 'utf8')]))
  violations.push(...analyzeCode(srcFiles).map(v => ({ ...v, rule: 'I1/I2' })))
  const migrations = walk(path.join(root, 'migrations'), n => n.endsWith('.sql')).map(f => [rel(f), fs.readFileSync(f, 'utf8')])
  const scanned = []
  for (const [file, text] of migrations) {
    const number = Number(/(\d{4})_/.exec(path.basename(file))[1])
    if (number <= LAST_ALLOWED_MIGRATION) continue
    scanned.push(file)
    violations.push(...analyzeSqlFile(file, text, rotation))
  }
  const opsFiles = walk(path.join(repo, 'ops'), n => /\.(sql|cjs|mjs|js|ts)$/.test(n))
  for (const full of opsFiles) {
    const file = rel(full)
    const text = fs.readFileSync(full, 'utf8')
    scanned.push(file)
    violations.push(...(file.endsWith('.sql') ? analyzeSqlFile(file, text, rotation) : analyzeOpsCode(file, text, rotation)))
  }
  const open = violations.filter(v => !ALLOWED.has(v.file))
  const known = open.filter(v => KNOWN_DEFECTS.some(d => d.file === v.file && d.unit === v.unit))
  return { violations: open.filter(v => !known.includes(v)), known, srcFiles, scanned, rotation }
}

const show = (violations) => violations.map(v => `${v.file}${v.unit ? ' ' + v.unit : ''} ${v.rule || ''} ${v.verb || ''} ${v.table || ''}: needs ${v.needs}`).join('\n')
let step = 0
const check = (name, fn) => { fn(); step++; console.log(`ok ${step} ${name}`) }

const rotation = rotationText()

check('fixture: an item update with no event is reported (I1)', () => {
  const v = analyzeCode(new Map([['fixture.ts', "export async function bad(db) { await db.batch([{ sql: `UPDATE inventory_check_items SET updated_at = @now WHERE session_id = @id`, params: {} }]) }\n"]]))
  assert.equal(v.length, 1)
  assert.equal(v[0].table, 'inventory_check_items')
})
check('fixture: an approval update with no event is reported (I2)', () => {
  const v = analyzeCode(new Map([['fixture.ts', "export async function bad(db) { await db.batch([{ sql: `UPDATE inventory_check_approvals SET status='rejected' WHERE session_id=@id`, params: {} }]) }\n"]]))
  assert.equal(v.length, 1)
})
check('fixture: an event that names no product does not pair an item update', () => {
  const v = analyzeCode(new Map([['fixture.ts', "export async function bad(db) { await db.batch([{ sql: `UPDATE inventory_check_items SET state='done' WHERE session_id=@id`, params: {} },\n  { sql: `INSERT INTO inventory_check_events(session_id,product_id,actor_id,created_at) VALUES(@id,NULL,@a,@now)`, params: {} }]) }\n"]]))
  assert.equal(v.length, 1)
})
check('fixture: an event naming the product pairs an item update; an item insert without state needs only a session event', () => {
  const ok = analyzeCode(new Map([['fixture.ts', "export async function good(db) { await db.batch([{ sql: `UPDATE inventory_check_items SET state='done' WHERE session_id=@id`, params: {} },\n  { sql: `INSERT INTO inventory_check_events(session_id,product_id,actor_id,created_at) VALUES(@id,@product,@a,@now)`, params: {} }]) }\n" +
    "export async function open(db) { await db.batch([{ sql: `INSERT INTO inventory_check_items(session_id,product_id,branch_id) SELECT @id,1,2`, params: {} },\n  { sql: `INSERT INTO inventory_check_events(session_id,product_id,actor_id,created_at) VALUES(@id,NULL,@a,@now)`, params: {} }]) }\n"]]))
  assert.deepEqual(ok, [])
})
check('fixture: a statement builder is judged at every place that uses it', () => {
  const builder = "const decided = () => ({ sql: `UPDATE inventory_check_approvals SET status='approved' WHERE session_id=@id` })\nconst ev = () => ({ sql: `INSERT INTO inventory_check_events(session_id,product_id,actor_id,created_at) VALUES(@id,NULL,@a,@now)` })\n"
  assert.deepEqual(analyzeCode(new Map([['a.ts', builder + 'export async function go(db) { await db.batch([decided(), ev()]) }\n']])), [])
  assert.equal(analyzeCode(new Map([['a.ts', builder + 'export async function go(db) { await db.batch([decided()]) }\n']])).length, 1)
  assert.equal(analyzeCode(new Map([['a.ts', builder]])).length, 1)
})
check('fixture: a unit that runs its own batch must hold the event itself', () => {
  const v = analyzeCode(new Map([['a.ts', "async function release(db) { await record(db, [{ sql: `UPDATE inventory_check_approvals SET applying_by=NULL WHERE session_id=@id` }]) }\nexport async function other(db) { await db.batch([{ sql: `INSERT INTO inventory_check_events(session_id,product_id,actor_id,created_at) VALUES(@id,NULL,@a,@now)` }, release]) }\n"]]))
  assert.equal(v.length, 1)
})
check('fixture: an event helper that takes the product as an argument counts only when the call passes it', () => {
  const helper = "export function eventStatement(actor, args: { sessionId: string; productId?: number }) { return { sql: `INSERT INTO inventory_check_events(session_id,product_id,actor_id,created_at) VALUES(@sessionId,@productId,@a,@now)`, params: args } }\n"
  const writer = (call) => `export async function w(db) { await db.batch([{ sql: \`UPDATE inventory_check_items SET state='done' WHERE session_id=@id\` }, ${call}]) }\n`
  assert.deepEqual(analyzeCode(new Map([['a.ts', helper + writer("eventStatement(actor, { sessionId, productId, action: 'observe' })")]])), [])
  assert.equal(analyzeCode(new Map([['a.ts', helper + writer("eventStatement(actor, { sessionId, action: 'observe' })")]])).length, 1)
})
check('fixture: a migration 9999 that updates the items in place without rotating the epoch is reported (I3)', () => {
  const v = analyzeSqlFile('cloudflare/migrations/9999_x.sql', "UPDATE inventory_check_items SET updated_at = '2026-01-01' WHERE state = 'done';\n", rotation)
  assert.ok(v.some(x => x.rule === 'I3'))
  assert.ok(v.some(x => x.rule === 'I1'))
})
check('fixture: a migration that pairs its writes and rotates the epoch is clean', () => {
  const sql = "INSERT INTO inventory_check_events(session_id,product_id,actor_id,created_at) SELECT session_id,product_id,1,CURRENT_TIMESTAMP FROM inventory_check_items;\nUPDATE inventory_check_items SET state='done';\n" + fs.readFileSync(path.join(root, 'src/lib/dataEpochSql.ts'), 'utf8').match(/`([\s\S]*?)`/)[1] + ';\n'
  assert.deepEqual(analyzeSqlFile('cloudflare/migrations/9999_x.sql', sql, rotation), [])
  const bump = analyzeSqlFile('cloudflare/migrations/9999_y.sql', '-- MARKS_FORMAT bump to 2\nINSERT INTO inventory_check_events(session_id,product_id,actor_id,created_at) SELECT session_id,product_id,1,CURRENT_TIMESTAMP FROM inventory_check_items;\nUPDATE inventory_check_items SET state=\'done\';\n', rotation)
  assert.deepEqual(bump, [])
})
check('fixture: an ops script that writes the tables without rotating is reported (I3)', () => {
  const v = analyzeOpsCode('ops/scripts/x.cjs', "const sql = `UPDATE inventory_check_sessions SET status='closed' WHERE id=@id`\n", rotation)
  assert.ok(v.some(x => x.rule === 'I3'))
})

const tree = analyzeTree()

check('the tree: every count-state writer is paired with an event in its batch (src, migrations above 0319, ops)', () => {
  assert.equal(tree.violations.length, 0, `unpaired count-state writers:\n${show(tree.violations)}`)
})
check('each known defect still exists (a fixed writer leaves KNOWN_DEFECTS)', () => {
  for (const d of KNOWN_DEFECTS) assert.ok(tree.known.some(v => v.file === d.file && v.unit === d.unit), `no longer a defect, remove it: ${d.unit}`)
})
check('the walk reads the real writers (positive control: units found, files scanned, rotation text read)', () => {
  assert.ok(tree.srcFiles.has('cloudflare/src/lib/inventoryCheckSessions.ts'))
  assert.ok(tree.srcFiles.has('cloudflare/src/lib/inventoryCheckApprovals.ts'))
  assert.ok(tree.srcFiles.has('cloudflare/src/lib/stockSetClosesIssue.ts'))
  assert.ok(tree.rotation.includes('data_epoch'))
  const writers = [...tree.srcFiles].filter(([, text]) => /(?:INSERT\s+INTO|UPDATE)\s+inventory_check_(?:items|approvals)\b/i.test(text)).map(([file]) => file)
  assert.ok(writers.length >= 3, `expected at least 3 writer files, found ${writers.length}`)
})
check('the allowlist names only files that exist and each carries a reason', () => {
  for (const [file, reason] of ALLOWED) {
    assert.ok(fs.existsSync(path.join(repo, file)), `allowlisted file is gone: ${file}`)
    assert.ok(reason.length > 0)
  }
})
check('every migration above 0319 and every ops file is scanned', () => {
  const migrationsAbove = walk(path.join(root, 'migrations'), n => n.endsWith('.sql')).map(rel).filter(f => Number(/(\d{4})_/.exec(path.basename(f))[1]) > LAST_ALLOWED_MIGRATION)
  for (const file of migrationsAbove) assert.ok(tree.scanned.includes(file), `not scanned: ${file}`)
  const ops = walk(path.join(repo, 'ops'), n => /\.(sql|cjs|mjs|js|ts)$/.test(n)).map(rel)
  for (const file of ops) assert.ok(tree.scanned.includes(file), `not scanned: ${file}`)
})

const baseline = analyzeCode(tree.srcFiles).length
const mutate = (file, from, to) => {
  const text = tree.srcFiles.get(file).split('\r\n').join('\n')
  assert.ok(text.includes(from), `mutant anchor is gone in ${file}: ${from}`)
  const files = new Map(tree.srcFiles)
  files.set(file, text.replace(from, to))
  return analyzeCode(files).length - baseline
}
const SESSIONS = 'cloudflare/src/lib/inventoryCheckSessions.ts'
const APPROVALS = 'cloudflare/src/lib/inventoryCheckApprovals.ts'
const SET_CLOSE = 'cloudflare/src/lib/stockSetClosesIssue.ts'
check('mutant: the observe event dropped from the single-item update batch is caught', () => {
  assert.ok(mutate(SESSIONS, "eventStatement(actor, { sessionId: id, productId, action: 'observe', key, hash, before: { state: item.state", "eventStatement(actor, { sessionId: id, action: 'observe', key, hash, before: { state: item.state") > 0)
})
check('mutant: the per-line approve event loses its product (item flip)', () => {
  assert.ok(mutate(APPROVALS, "statements.push(eventStatement(actor, { sessionId, productId, action: 'observe', key: `${stockKey}-${productId}`", "statements.push(eventStatement(actor, { sessionId, action: 'observe', key: `${stockKey}-${productId}`") > 0)
})
check('mutant: the supersede event statement dropped from its batch is caught', () => {
  assert.ok(mutate(SESSIONS, '    { sql: SUPERSEDE_EVENTS_SQL, params },\n', '') > 0)
})
check('mutant: the Undo take-back event of a Set (EV insert) dropped is caught', () => {
  assert.ok(mutate(SET_CLOSE, "{ sql: `${EV} SELECT i.session_id,i.product_id,@actorId,@actorName,'observe',@key||'-count-taken-back'", "{ sql: `SELECT i.session_id,i.product_id,@actorId,@actorName,'observe',@key||'-count-taken-back'") > 0)
})
