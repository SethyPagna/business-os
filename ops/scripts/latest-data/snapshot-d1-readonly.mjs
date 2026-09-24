#!/usr/bin/env node
// Read-only production D1 snapshot tool (P2-3b, step 0).
//
// RUN IT ONLY WITH THE OWNER'S EXPLICIT AUTHORIZATION: it reads production.
//
// Dumps every non-FTS table in the `business-os` D1 database to
// <table>.jsonl files under an output directory OUTSIDE the repository, plus
// a manifest.json, a rebuilt snapshot.sqlite, and a SHA256SUMS file.
//
// Guardrails (each one is exported and unit-tested by
// snapshot-d1-readonly.test.mjs, which imports this module):
//   - assertSelect(): every remote statement goes through d1(), and d1()
//     calls assertSelect() before its runner ever sees the SQL. Anything that
//     is not a single plain SELECT throws first. No PRAGMA, no --file, no
//     migrations, no --local writes to shared state.
//   - assertOutsideRepo(): the output directory must resolve outside the
//     repository (and outside the main checkout when run from a linked
//     worktree). It runs before the directory is created and before any
//     remote call.
//   - PII redaction is ON by default. Personal columns are replaced with a
//     salted HMAC token, so equal values stay equal across tables within one
//     snapshot and joins still line up. The salt is random per run and is
//     never written to the output. Secrets (password/OTP/token/code hashes,
//     API keys, OAuth tokens) are ALWAYS dropped, even with --include-pii.
//
// Usage (from cloudflare/, so the wrangler auth wrapper resolves):
//   node ../ops/scripts/latest-data/snapshot-d1-readonly.mjs [--include-pii] <output-dir>
//
// See README.md in this folder for details.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const CLOUDFLARE_DIR = path.join(REPO_ROOT, 'cloudflare')
// Must equal the [[d1_databases]] binding "DB" database_name in
// cloudflare/wrangler.toml (pinned by the test).
export const DATABASE_NAME = 'business-os'
const PAGE_SIZE = 1000
const MIN_DELAY_MS = 260 // keeps us well under the "<=4 requests/second" gentleness rule

// The app's single fixed business timezone (decision 20 / cloudflare/src/lib/businessDateWindow.ts):
// Asia/Phnom_Penh, UTC+07:00, no DST. Named "Phnom Penh", never "Bangkok".
const BUSINESS_UTC_OFFSET_MINUTES = 420

/** UTC ISO instant -> 'YYYY-MM-DD HH:MM:SS ICT' wall-clock string in Asia/Phnom_Penh. */
function toIctString(utcIso) {
  const ms = new Date(utcIso).getTime() + BUSINESS_UTC_OFFSET_MINUTES * 60 * 1000
  return `${new Date(ms).toISOString().slice(0, 19).replace('T', ' ')} ICT`
}

function sleep(ms) {
  // Synchronous sleep (Node allows Atomics.wait on the main thread; browsers do not).
  const sab = new SharedArrayBuffer(4)
  const ia = new Int32Array(sab)
  Atomics.wait(ia, 0, 0, ms)
}

// ---------------------------------------------------------------------------
// Guard 1: SELECT-only
// ---------------------------------------------------------------------------

export function assertSelect(sql) {
  const trimmed = String(sql).trim()
  if (!/^SELECT\b/i.test(trimmed)) {
    throw new Error(`Refused non-SELECT statement: ${trimmed.slice(0, 120)}`)
  }
  // Defense in depth: reject statement-separator smuggling and obvious write keywords.
  if (/;\s*\S/.test(trimmed)) {
    throw new Error(`Refused multi-statement SQL (contains ';' followed by more content): ${trimmed.slice(0, 120)}`)
  }
  if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|LOAD_EXTENSION)\b/i.test(trimmed)) {
    throw new Error(`Refused statement containing a write/DDL keyword: ${trimmed.slice(0, 120)}`)
  }
  return trimmed
}

/** Quote an SQLite identifier (table name) for use in the tool's SELECTs. */
function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`
}

// Every SQL string the tool can send remotely is built here, so the test can
// run each real shape through assertSelect().
export const SQL = {
  probe: () => 'SELECT 1 AS ok',
  listTables: () => "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  count: (table) => `SELECT COUNT(*) AS c FROM ${quoteIdent(table)}`,
  page: (table, orderBy, offset) =>
    `SELECT * FROM ${quoteIdent(table)}${orderBy ? ` ORDER BY ${orderBy}` : ''} LIMIT ${PAGE_SIZE} OFFSET ${Number(offset) | 0}`,
}

const MAX_D1_ATTEMPTS = 4

/**
 * Default runner: `wrangler d1 execute <db> --remote --json --command <sql>`
 * through the repo's auth wrapper. Only ever reached through d1() below,
 * which has already applied assertSelect().
 */
function wranglerRemoteRunner(sql, attempt = 1) {
  const result = spawnSync(
    process.execPath,
    ['scripts/with-wrangler-auth.cjs', 'wrangler', 'd1', 'execute', DATABASE_NAME, '--remote', '--json', '--command', sql],
    { cwd: CLOUDFLARE_DIR, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  )
  sleep(MIN_DELAY_MS)
  if (result.status !== 0) {
    // Observed intermittently: status 3221226505 (0xC0000409, a Windows
    // child-process crash signature) with empty stderr/stdout -- a flaky
    // subprocess spawn, not a SQL or auth problem (the identical query
    // succeeds on retry). Retry with backoff before giving up; a genuinely
    // persistent failure (e.g. _cf_KV's SQLITE_AUTH) still fails every
    // attempt and is surfaced to the caller after MAX_D1_ATTEMPTS.
    if (attempt < MAX_D1_ATTEMPTS) {
      const backoffMs = 500 * attempt
      console.warn(
        `[snapshot] transient D1 call failure (status ${result.status}) on attempt ${attempt}/${MAX_D1_ATTEMPTS}, retrying in ${backoffMs}ms: ${sql.slice(0, 100)}`,
      )
      sleep(backoffMs)
      return wranglerRemoteRunner(sql, attempt + 1)
    }
    throw new Error(`D1 query failed after ${MAX_D1_ATTEMPTS} attempts (${result.status}): ${(result.stderr || result.stdout || '').slice(0, 2000)}`)
  }
  let parsed
  try {
    parsed = JSON.parse(result.stdout)
  } catch (err) {
    throw new Error(`Failed to parse wrangler JSON output: ${err.message}\n${result.stdout.slice(0, 2000)}`)
  }
  return parsed.flatMap((entry) => entry.results || [])
}

/**
 * The ONLY path to the remote database. assertSelect() runs before the
 * runner is invoked, so a refused statement never reaches wrangler.
 */
export function createD1(runner = wranglerRemoteRunner) {
  const d1 = (sql) => {
    const safe = assertSelect(sql)
    d1.requestCount += 1
    return runner(safe)
  }
  d1.requestCount = 0
  return d1
}

// ---------------------------------------------------------------------------
// Guard 2: output outside the repository
// ---------------------------------------------------------------------------

/** realpath of the deepest existing ancestor + the not-yet-existing tail. */
function realpathLoose(p) {
  let current = path.resolve(p)
  const tail = []
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) break
    tail.unshift(path.basename(current))
    current = parent
  }
  let real = current
  try {
    real = fs.realpathSync.native(current)
  } catch {
    // keep the resolved path
  }
  return path.join(real, ...tail)
}

/**
 * The repo root plus, when repoRoot is a linked worktree (its `.git` is a
 * `gitdir: <main>/.git/worktrees/<name>` file), the main checkout root, so
 * an output path inside the main checkout is refused from a worktree too.
 */
export function protectedRoots(repoRoot = REPO_ROOT) {
  const roots = [path.resolve(repoRoot)]
  const dotGit = path.join(repoRoot, '.git')
  try {
    if (fs.statSync(dotGit).isFile()) {
      const match = fs.readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+)\s*$/m)
      if (match) {
        const gitdir = path.resolve(repoRoot, match[1].trim())
        const marker = `${path.sep}.git${path.sep}worktrees${path.sep}`
        const idx = gitdir.lastIndexOf(marker)
        if (idx !== -1) roots.push(gitdir.slice(0, idx))
      }
    }
  } catch {
    // no .git entry: only repoRoot itself is protected
  }
  return roots
}

function isInside(child, parent) {
  const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p)
  const rel = path.relative(norm(parent), norm(child))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Throws unless outDir resolves outside every protected root. Returns the resolved path. */
export function assertOutsideRepo(outDir, repoRoot = REPO_ROOT) {
  if (!outDir || !String(outDir).trim()) throw new Error('Refused: an output directory is required.')
  const resolved = path.resolve(String(outDir))
  const real = realpathLoose(resolved)
  for (const root of protectedRoots(repoRoot)) {
    const rootReal = realpathLoose(root)
    if (isInside(resolved, root) || isInside(real, rootReal)) {
      throw new Error(
        `Refused: output directory ${resolved} is inside the repository (${root}). ` +
          'Snapshots hold production data and must live outside the repo.',
      )
    }
  }
  return resolved
}

// ---------------------------------------------------------------------------
// Guard 3: PII redaction (default ON) and secret dropping (ALWAYS)
// ---------------------------------------------------------------------------
//
// PII_COLUMNS is the explicit, reviewed column map. It came from applying
// every cloudflare/migrations/*.sql file to an empty SQLite database and
// sweeping every table's final column list (CREATE TABLE and later
// ALTER TABLE ADD COLUMN) for person names, phones, emails, addresses,
// free-text notes on person records, IPs, device names/ids and user agents.
// The test re-derives the schema the same way and fails if a column the
// name-based classifier flags is neither mapped here, in SECRET_COLUMNS, nor
// in REVIEWED_NOT_PII with a reason.
//
// Masked in the default (redacted) mode; kept with --include-pii.
export const PII_COLUMNS = Object.freeze({
  // person / contact records
  customers: ['name', 'phone', 'phone_normalized', 'email', 'address', 'company', 'notes'],
  delivery_contacts: ['name', 'phone', 'address', 'notes'],
  suppliers: ['phone', 'email', 'address', 'contact_person', 'notes'],
  users: ['username', 'name', 'phone', 'phone_lookup', 'email', 'google_email', 'google_subject'],
  portal_accounts: ['name', 'phone', 'email'],
  branches: ['manager'],
  // auth ephemera: destinations, IPs, device names/ids, user agents, lockout keys
  verification_codes: ['target', 'requester_ip'],
  user_sessions: ['device_name', 'device_id', 'user_agent', 'last_ip'],
  portal_sessions: ['user_agent', 'last_ip'],
  trusted_devices: ['device_id', 'device_name', 'user_agent', 'first_ip', 'last_ip', 'decided_by_name'],
  login_lockouts: ['username'],
  portal_auth_lockouts: ['key'], // canonical phone for signin
  rate_limit_events: ['client_key'], // client IP-derived key
  // denormalized person columns on business records
  sales: [
    'customer_name', 'customer_phone', 'customer_address',
    'delivery_contact_name', 'delivery_contact_phone', 'delivery_contact_address',
    'cashier_name', 'cancelled_by_name', 'stock_skipped_by_name', 'device_name', 'notes',
  ],
  returns: ['customer_name', 'cashier_name', 'device_name', 'notes'],
  customer_receivables: ['customer_name'],
  customer_share_submissions: ['customer_name', 'note', 'reviewed_by_name'],
  contact_duplicate_dismissals: ['cluster_value', 'dismissed_by_name'], // cluster_value is a phone or a name
  legacy_deleted_sale_items: ['cashier_name', 'deleted_by'], // deleted_by is a legacy free-text name
  audit_logs: ['user_name', 'device_name'],
  action_history: ['created_by_name'],
  ai_provider_configs: ['account_email', 'created_by_name'],
  ai_response_logs: ['actor_user_name', 'actor_label'],
  bulk_delete_jobs: ['created_by_name'],
  damaged_stock_lots: ['created_by_user_name'],
  fees: ['created_by_name'],
  file_assets: ['created_by_name'],
  import_jobs: ['created_by_name'],
  inventory_movements: ['user_name'],
  loyalty_point_adjustments: ['created_by_name'],
  pending_actions: ['requested_by_name', 'reviewed_by_name'],
  product_cost_entries: ['user_name'],
  product_duplicate_dismissals: ['dismissed_by_name'],
  rfid_scan_sessions: ['created_by_name'],
  sale_amendments: ['user_name'],
  sale_incident_recovery_receipts: ['actor_name'],
  sale_not_paid_stock_recovery_receipts: ['actor_name'],
  sale_record_events: ['actor_username'],
  shift_session_amendments: ['actor_name'],
  shift_sessions: [
    'user_name', 'opened_device_name', 'closed_device_name',
    'closed_by_user_name', 'reopened_by_user_name', 'cancelled_by_user_name',
  ],
  stock_row_moves: ['user_name'],
  stock_transfers: ['user_name'],
  undo_snapshots: ['created_by_name'],
})

// ALWAYS dropped, in every mode.
export const SECRET_COLUMNS = Object.freeze({
  users: ['password', 'otp_secret', 'otp_pending_secret'],
  portal_accounts: ['password_hash'],
  verification_codes: ['code_hash'],
  user_sessions: ['token_hash'],
  portal_sessions: ['token_hash'],
  portal_password_resets: ['token_hash'],
  ai_provider_configs: ['api_key_encrypted'],
  google_drive_sync_entries: ['upload_session_url'], // resumable-upload URL is a bearer capability
})

// Columns the name-based classifier flags that were reviewed and deliberately
// kept. (Not flagged, so not listed, but also deliberately kept: branches.name,
// suppliers.name and suppliers.company -- business names; customers.gender,
// trusted_devices.*_country -- coarse; membership numbers -- the business's
// own pseudonymous card id, needed to verify loyalty joins.)
export const REVIEWED_NOT_PII = Object.freeze({
  'branches.phone': 'business phone of a shop branch, not a person',
})

// settings rows are key/value; the Worker's own rule
// (cloudflare/src/lib/settingsSensitive.ts) treats these key suffixes as
// secrets that never leave the Worker. Mirrored here plus a broader net.
const SECRET_SETTING_KEY_RE = /(_refresh_token|_access_token|_secret|_api_key|_password|token|secret|password|api_key|private_key|credential)/i
const PII_SETTING_KEYS = new Set(['pos_address_presets_v1'])

// Name-based classifier, applied (a) to top-level columns of tables or
// columns the explicit map does not know about (production-only tables,
// future migrations), and (b) to every key inside JSON-valued columns
// (audit_logs.old_value/new_value, *_json payloads, undo/redo payloads...).
function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '')
}
const SECRET_KEY_RE = /(password|passwd|secret|tokenhash|codehash|codesalt|apikey|privatekey|refreshtoken|accesstoken|authtoken|sessiontoken|bearertoken|uploadsessionurl)/
const PII_KEY_EXACT = new Set([
  'ip', 'ipaddress', 'lastip', 'firstip', 'requesterip', 'clientip', 'remoteip',
  'deviceid', 'destination', 'manager', 'contactperson', 'googlesubject',
])
const PII_KEY_SUFFIX_RE = /(phones?|phonenormalized|phonelookup|emails?|address|addresses|devicename|useragent|byname|username|actorname|actorlabel|cashiername|customername|contactname|recipientname|ownername|managername)$/
// Inside a JSON object, a bare `name`/`company`/`notes` is personal only when
// the same object also carries a person marker (a product object has no phone).
const PERSON_MARKER_RE = /^(phone|phonenormalized|email|address|contactperson|username|membershipnumber|googleemail)$/
const PERSON_CONTEXT_KEYS = new Set(['name', 'company', 'notes', 'note'])

/** 'secret' | 'pii' | null for a column or JSON key name. */
export function classifyKey(key) {
  const k = normalizeKey(key)
  if (!k) return null
  if (SECRET_KEY_RE.test(k)) return 'secret'
  if (PII_KEY_EXACT.has(k) || PII_KEY_SUFFIX_RE.test(k)) return 'pii'
  return null
}

const DROPPED = '[dropped]'

/**
 * Build a redactor for one run. `salt` defaults to 32 random bytes and is
 * kept only in memory; nothing in the output can reproduce it.
 */
export function createRedactor({ includePii = false, salt = crypto.randomBytes(32) } = {}) {
  const key = Buffer.isBuffer(salt) ? salt : Buffer.from(String(salt))
  const stats = { masked: {}, dropped: {}, fallback: {} }
  const bump = (bucket, table, column) => {
    const k = `${table}.${column}`
    bucket[k] = (bucket[k] || 0) + 1
  }

  /** Stable salted token: equal inputs -> equal tokens within this run. */
  function mask(value) {
    if (value === null || value === undefined || value === '') return value
    const digest = crypto.createHmac('sha256', key).update(String(value)).digest('hex').slice(0, 20)
    return `pii_${digest}`
  }

  function redactJson(value, table, column) {
    let changed = false
    // Value under a personal key: mask primitives (also inside arrays, e.g.
    // `phones: [...]`); nested objects are walked so their own keys decide.
    const maskDeep = (node, k) => {
      if (Array.isArray(node)) return node.map((entry) => maskDeep(entry, k))
      if (node !== null && typeof node === 'object') return walk(node)
      const masked = mask(node)
      if (masked !== node) {
        changed = true
        bump(stats.masked, table, `${column}{${k}}`)
      }
      return masked
    }
    const walk = (node) => {
      if (Array.isArray(node)) return node.map(walk)
      if (!node || typeof node !== 'object') return node
      const isPerson = Object.keys(node).some((k) => PERSON_MARKER_RE.test(normalizeKey(k)))
      const out = {}
      for (const [k, v] of Object.entries(node)) {
        const cls = classifyKey(k)
        if (cls === 'secret') {
          out[k] = v === null || v === undefined ? v : DROPPED
          if (out[k] !== v) {
            changed = true
            bump(stats.dropped, table, `${column}{${k}}`)
          }
        } else if (!includePii && (cls === 'pii' || (isPerson && PERSON_CONTEXT_KEYS.has(normalizeKey(k))))) {
          out[k] = maskDeep(v, k)
        } else {
          out[k] = walk(v)
        }
      }
      return out
    }
    const next = walk(value)
    return changed ? next : undefined
  }

  /**
   * Redact one row of `table`. A dropped secret becomes null when it was
   * null, otherwise "[dropped]#<ordinal>": no bit of the secret survives,
   * NOT NULL columns still accept the row, and the per-row ordinal keeps
   * UNIQUE constraints (e.g. token_hash) satisfied in the rebuilt SQLite.
   */
  function redactRow(table, row, { ordinal = 0 } = {}) {
    const piiCols = new Set(PII_COLUMNS[table] || [])
    const secretCols = new Set(SECRET_COLUMNS[table] || [])
    const out = {}
    for (const [column, value] of Object.entries(row)) {
      const fallback = classifyKey(column)
      const isSecret = secretCols.has(column) || fallback === 'secret' ||
        (table === 'settings' && column === 'value' && SECRET_SETTING_KEY_RE.test(String(row.key ?? '')))
      const present = value !== null && value !== undefined && value !== ''
      if (isSecret) {
        out[column] = value === null || value === undefined ? null : `${DROPPED}#${ordinal}`
        if (present) bump(stats.dropped, table, column)
        if (!secretCols.has(column) && fallback === 'secret') bump(stats.fallback, table, column)
        continue
      }
      const isPii = piiCols.has(column) ||
        (fallback === 'pii' && !REVIEWED_NOT_PII[`${table}.${column}`]) ||
        (table === 'settings' && column === 'value' && PII_SETTING_KEYS.has(String(row.key ?? '')))
      if (isPii && !includePii) {
        out[column] = mask(value)
        if (present) bump(stats.masked, table, column)
        if (!piiCols.has(column) && fallback === 'pii') bump(stats.fallback, table, column)
        continue
      }
      // JSON payloads (audit old/new values, undo/redo, receipts, import rows)
      // are walked key-by-key; re-serialized only when something changed.
      if (typeof value === 'string' && /^\s*[[{]/.test(value)) {
        let parsed
        try {
          parsed = JSON.parse(value)
        } catch {
          parsed = undefined
        }
        if (parsed !== undefined) {
          const next = redactJson(parsed, table, column)
          if (next !== undefined) {
            out[column] = JSON.stringify(next)
            continue
          }
        }
      }
      out[column] = value
    }
    return out
  }

  function redactRows(table, rows) {
    return rows.map((row, i) => redactRow(table, row, { ordinal: i + 1 }))
  }

  return { mode: includePii ? 'included' : 'redacted', mask, redactRow, redactRows, stats }
}

// ---------------------------------------------------------------------------
// Dump helpers
// ---------------------------------------------------------------------------

function fetchAllPaged(d1, table, orderBy) {
  const rows = []
  let offset = 0
  while (true) {
    const page = d1(SQL.page(table, orderBy, offset))
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return rows
}

function countTable(d1, table) {
  const rows = d1(SQL.count(table))
  return Number(rows[0]?.c ?? 0)
}

// Best-effort column-name extraction from a `CREATE TABLE ...` DDL string,
// used only as a fallback label in the manifest (never used to build SQL).
export function columnsFromDdl(ddl) {
  const open = ddl.indexOf('(')
  const close = ddl.lastIndexOf(')')
  if (open === -1 || close === -1 || close <= open) return []
  const body = ddl.slice(open + 1, close)
  const parts = []
  let depth = 0
  let current = ''
  for (const ch of body) {
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) parts.push(current)
  const cols = []
  for (const raw of parts) {
    const t = raw.trim()
    if (!t) continue
    const upper = t.toUpperCase()
    if (/^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT)\b/.test(upper)) continue
    const nameMatch = t.match(/^("[^"]+"|`[^`]+`|\[[^\]]+\]|\S+)/)
    if (!nameMatch) continue
    const name = nameMatch[1].replace(/^["`[]|["`\]]$/g, '')
    cols.push(name)
  }
  return cols
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function writeShaSums(outDir) {
  // SHA256SUMS covers every file already written into the output dir
  // (jsonl dumps, manifest.json, snapshot.sqlite) so the snapshot can be
  // verified untouched after the fact. Excludes SQLite WAL/SHM sidecars
  // (transient journal files, not part of the committed snapshot) and any
  // pre-existing SHA256SUMS from a prior attempt in the same dir.
  const entries = fs
    .readdirSync(outDir)
    .filter((name) => name !== 'SHA256SUMS' && !name.endsWith('-wal') && !name.endsWith('-shm'))
    .filter((name) => fs.statSync(path.join(outDir, name)).isFile())
    .sort()
  const lines = entries.map((name) => `${sha256File(path.join(outDir, name))}  ${name}`)
  fs.writeFileSync(path.join(outDir, 'SHA256SUMS'), `${lines.join('\n')}\n`)
}

export function parseArgs(argv) {
  const opts = { includePii: false, outDir: null, help: false }
  for (const arg of argv) {
    if (arg === '--include-pii') opts.includePii = true
    else if (arg === '--help' || arg === '-h') opts.help = true
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`)
    else if (opts.outDir) throw new Error(`Unexpected extra argument: ${arg}`)
    else opts.outDir = arg
  }
  return opts
}

const USAGE = 'Usage: node snapshot-d1-readonly.mjs [--include-pii] <output-dir outside the repo>'

function warnIncludePii(log) {
  const bar = '!'.repeat(78)
  log.warn(bar)
  log.warn('!!  --include-pii: REAL customer/staff names, phones, emails and addresses')
  log.warn('!!  will be written to this snapshot. Secrets are still dropped.')
  log.warn('!!  Keep the output off shared drives, never commit it, delete it when done.')
  log.warn(bar)
}

/**
 * Runs the snapshot. `deps` exists so the test can drive the real flow with
 * a local fake runner; the CLI passes none, so production uses wrangler.
 * Returns a process exit code.
 */
export function main(argv = process.argv.slice(2), deps = {}) {
  const log = deps.log || console
  let opts
  try {
    opts = parseArgs(argv)
  } catch (err) {
    log.error(`${err.message}\n${USAGE}`)
    return 1
  }
  if (opts.help) {
    log.log(USAGE)
    return 0
  }
  if (!opts.outDir) {
    log.error(USAGE)
    return 1
  }
  let outDir
  try {
    outDir = assertOutsideRepo(opts.outDir, deps.repoRoot || REPO_ROOT)
  } catch (err) {
    log.error(`[snapshot] ${err.message}`)
    return 2
  }
  if (opts.includePii) warnIncludePii(log)

  const d1 = createD1(deps.runner)
  const redactor = createRedactor({ includePii: opts.includePii, salt: deps.salt })
  fs.mkdirSync(outDir, { recursive: true })

  log.log(`[snapshot] database=${DATABASE_NAME} outDir=${outDir} pii=${redactor.mode}`)
  log.log('[snapshot] harmless probe: SELECT 1')
  const probe = d1(SQL.probe())
  if (probe[0]?.ok !== 1) throw new Error('Probe query did not return expected result')

  log.log('[snapshot] enumerating tables from sqlite_master')
  const allTables = d1(SQL.listTables())

  const ftsFamily = allTables.filter((t) => t.name.includes('_fts'))
  const dumpTables = allTables.filter((t) => !t.name.includes('_fts'))

  let wranglerVersion = deps.wranglerVersion
  if (wranglerVersion === undefined) {
    const wranglerVersionResult = spawnSync(
      process.execPath,
      ['scripts/with-wrangler-auth.cjs', 'wrangler', '--version'],
      { cwd: CLOUDFLARE_DIR, encoding: 'utf8' },
    )
    wranglerVersion = (wranglerVersionResult.stdout || '').trim() || 'unknown'
  }

  const manifest = {
    captured_at_utc: new Date().toISOString(),
    captured_at_ict: null, // filled in below once captured_at_utc is fixed, in Asia/Phnom_Penh (UTC+7, no DST)
    wrangler_version: wranglerVersion,
    database_name: DATABASE_NAME,
    pii: redactor.mode,
    redaction: {
      method: 'HMAC-SHA256 with a random per-run salt (not stored), first 80 bits, prefix "pii_"',
      secrets: 'always dropped: value -> "[dropped]#<row ordinal>" (null stays null)',
      masked_columns: null,
      dropped_columns: null,
      fallback_classified_columns: null,
    },
    tables: [],
    fts_family_tables: [],
    inaccessible_tables: [],
    totals: { rows_dumped: 0, tables_dumped: 0, tables_drifted: 0 },
    drift: [],
  }
  manifest.captured_at_ict = toIctString(manifest.captured_at_utc)
  manifest.business_timezone = 'Asia/Phnom_Penh (ICT, UTC+07:00, no DST)'

  // Record FTS-family tables: name + row count only, never dumped.
  for (const t of ftsFamily) {
    let count = null
    let error = null
    try {
      count = countTable(d1, t.name)
    } catch (err) {
      error = err.message
    }
    manifest.fts_family_tables.push({ name: t.name, row_count: count, error })
    log.log(`[snapshot] fts-family (not dumped): ${t.name} rows=${count ?? 'ERROR: ' + error}`)
  }

  const accessibleDumpTables = []
  for (const t of dumpTables) {
    let countBefore
    try {
      countBefore = countTable(d1, t.name)
    } catch (err) {
      // Some tables enumerated in sqlite_master are Cloudflare/D1-internal
      // and reject even read access at the API layer (observed for
      // `_cf_KV`: "not authorized: SQLITE_AUTH [code: 7500]"). Record and
      // skip rather than aborting the whole snapshot.
      log.warn(`[snapshot] SKIP ${t.name}: inaccessible (${err.message.split('\n')[0]})`)
      manifest.inaccessible_tables.push({ name: t.name, error: err.message })
      continue
    }
    accessibleDumpTables.push(t)
    let orderBy = 'rowid'
    let rows
    try {
      rows = fetchAllPaged(d1, t.name, orderBy)
    } catch (err) {
      // WITHOUT ROWID tables (or any other reason rowid ordering fails):
      // fall back to no explicit order (still a plain unqualified SELECT *).
      log.warn(`[snapshot] rowid ordering failed for ${t.name}, retrying without ORDER BY: ${err.message}`)
      orderBy = null
      rows = fetchAllPaged(d1, t.name, null)
    }
    const countAfter = countTable(d1, t.name)

    // Redaction happens HERE, before anything touches disk; snapshot.sqlite
    // is rebuilt only from these .jsonl files, so it inherits the redaction.
    const safeRows = redactor.redactRows(t.name, rows)

    const fileName = `${t.name}.jsonl`
    const filePath = path.join(outDir, fileName)
    const lines = safeRows.map((r) => JSON.stringify(r)).join('\n')
    fs.writeFileSync(filePath, safeRows.length ? `${lines}\n` : '')
    const sha256 = sha256File(filePath)

    const columns = safeRows.length ? Object.keys(safeRows[0]) : columnsFromDdl(t.sql || '')

    const drifted = countBefore !== countAfter
    manifest.tables.push({
      name: t.name,
      columns,
      count_before: countBefore,
      count_after: countAfter,
      rows_dumped: safeRows.length,
      file: fileName,
      sha256,
      order_by: orderBy,
    })
    manifest.totals.rows_dumped += safeRows.length
    manifest.totals.tables_dumped += 1
    if (drifted) {
      manifest.totals.tables_drifted += 1
      manifest.drift.push({
        table: t.name,
        count_before: countBefore,
        count_after: countAfter,
        rows_dumped: safeRows.length,
        note: 'row count changed between the pre-dump and post-dump COUNT(*); table was still fully paged, but may include a torn read',
      })
    }
    log.log(
      `[snapshot] ${t.name}: before=${countBefore} after=${countAfter} dumped=${safeRows.length}${drifted ? ' DRIFT' : ''}`,
    )
  }

  manifest.redaction.masked_columns = redactor.stats.masked
  manifest.redaction.dropped_columns = redactor.stats.dropped
  manifest.redaction.fallback_classified_columns = redactor.stats.fallback
  manifest.request_count = d1.requestCount
  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  log.log('[snapshot] building snapshot.sqlite from captured DDL + jsonl rows')
  buildSqlite(outDir, accessibleDumpTables, manifest, { log, openDatabase: deps.openDatabase })

  // buildSqlite() adds manifest.fk_violations after the first manifest.json
  // write above; persist the final version (SHA256SUMS below hashes this
  // final copy, not the checkpoint written before the sqlite rebuild).
  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  log.log('[snapshot] writing SHA256SUMS')
  writeShaSums(outDir)

  log.log('[snapshot] done')
  log.log(
    JSON.stringify(
      {
        outDir,
        pii: manifest.pii,
        capturedAt: manifest.captured_at_utc,
        capturedAtIct: manifest.captured_at_ict,
        tablesDumped: manifest.totals.tables_dumped,
        rowsDumped: manifest.totals.rows_dumped,
        ftsFamilyCount: manifest.fts_family_tables.length,
        inaccessibleCount: manifest.inaccessible_tables.length,
        driftCount: manifest.drift.length,
        requestCount: d1.requestCount,
      },
      null,
      2,
    ),
  )
  return 0
}

/**
 * Opens the LOCAL output SQLite file. Prefers better-sqlite3 from
 * cloudflare/node_modules (the main checkout's install); falls back to the
 * built-in node:sqlite (Node >= 22.5) so a linked worktree without the
 * node_modules junction still works. Both expose exec/prepare/close with
 * spread bind parameters, which is all buildSqlite uses.
 */
function defaultOpenDatabase(sqlitePath) {
  try {
    const requireFromCloudflare = createRequire(path.join(CLOUDFLARE_DIR, 'package.json'))
    const Database = requireFromCloudflare('better-sqlite3')
    return new Database(sqlitePath)
  } catch {
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')
    return new DatabaseSync(sqlitePath)
  }
}

export function buildSqlite(outDir, dumpTables, manifest, { log = console, openDatabase = defaultOpenDatabase } = {}) {
  // Local output file only -- never touches any shared DB file. The PRAGMAs
  // below run against this local file, not through d1().
  const sqlitePath = path.join(outDir, 'snapshot.sqlite')
  if (fs.existsSync(sqlitePath)) {
    fs.chmodSync(sqlitePath, 0o644)
    fs.rmSync(sqlitePath)
  }
  const db = openDatabase(sqlitePath)
  db.exec('PRAGMA journal_mode = WAL')
  // This is a raw reconstruction of a production snapshot, not a fresh
  // relational write path: legacy/migrated rows can reference a parent that
  // no longer exists, and insertion here follows sqlite_master's alphabetical
  // table order rather than FK-dependency order. Enforcing FKs during rebuild
  // would abort the whole snapshot on exactly the kind of orphan this
  // verification effort exists to find. Disable enforcement for the rebuild,
  // then check (informationally) after all rows are in.
  db.exec('PRAGMA foreign_keys = OFF')

  for (const t of dumpTables) {
    if (!t.sql) continue
    db.exec(t.sql)
  }

  const manifestByName = new Map(manifest.tables.map((m) => [m.name, m]))
  for (const t of dumpTables) {
    const m = manifestByName.get(t.name)
    if (!m || !t.sql) continue
    const filePath = path.join(outDir, m.file)
    const content = fs.readFileSync(filePath, 'utf8')
    const lines = content.split('\n').filter((l) => l.trim())
    if (lines.length === 0) continue
    const firstRow = JSON.parse(lines[0])
    const cols = Object.keys(firstRow)
    const placeholders = cols.map(() => '?').join(', ')
    const colList = cols.map((c) => quoteIdent(c)).join(', ')
    const insert = db.prepare(`INSERT INTO ${quoteIdent(t.name)} (${colList}) VALUES (${placeholders})`)
    db.exec('BEGIN')
    try {
      for (const line of lines) {
        const row = JSON.parse(line)
        insert.run(...cols.map((c) => normalizeForSqlite(row[c])))
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
    const dbCount = Number(db.prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(t.name)}`).get().c)
    if (dbCount !== m.rows_dumped) {
      throw new Error(`snapshot.sqlite row count mismatch for ${t.name}: db=${dbCount} manifest=${m.rows_dumped}`)
    }
  }

  // Informational only (FK enforcement stays OFF for this raw snapshot):
  // record any orphaned foreign keys so the coordinator/verification plan
  // can see them, without letting them abort the rebuild.
  const fkViolations = db.prepare('PRAGMA foreign_key_check').all()
  manifest.fk_violations = fkViolations.map((v) => ({
    table: v.table,
    rowid: v.rowid,
    parent: v.parent,
    fkid: v.fkid,
  }))
  if (fkViolations.length > 0) {
    log.warn(`[snapshot] foreign_key_check found ${fkViolations.length} orphaned reference(s) in production data (recorded in manifest.fk_violations, not fatal)`)
  }

  db.close()

  if (process.platform === 'win32') {
    const attrib = spawnSync('attrib', ['+R', sqlitePath], { encoding: 'utf8' })
    if (attrib.status !== 0) {
      log.warn(`[snapshot] warning: failed to set snapshot.sqlite read-only via attrib: ${attrib.stderr}`)
    }
  } else {
    fs.chmodSync(sqlitePath, 0o444)
  }
}

function normalizeForSqlite(value) {
  if (value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value !== null && typeof value === 'object') return JSON.stringify(value)
  return value
}

// Run only when executed directly, so the test can import the real helpers.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main()
}
