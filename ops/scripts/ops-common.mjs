// Shared plumbing for the production ops scripts run by .github/workflows/ops.yml.
//
// THE PUBLIC-LOG RULE. This repository is public, so the Actions log and the
// job summary are public. They may carry only counts, sizes, pass/fail and
// commit ids -- never product names, customer data, money, object keys,
// bucket object names, query rows or error text that could echo any of those.
// Every public line therefore goes through say()/summary() below, which take
// a string-literal template and accept as values only finite numbers,
// booleans, commit shas, words from PUBLIC_WORDS, OpsError codes, and names
// explicitly vetted with publicToken(). Everything else (keys, rows, messages,
// wrangler output) goes only into the encrypted report.
// test-ops-workflow-pure.cjs enforces that the ops scripts print nothing else.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { encryptEnvelope } from './ops-crypto.mjs'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const CLOUDFLARE_DIR = path.join(REPO_ROOT, 'cloudflare')
export const WRANGLER_JS = path.join(CLOUDFLARE_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
export const PUBLIC_KEY_PATH = path.join(REPO_ROOT, 'ops', 'keys', 'ops-export-public.pem')
export const API_BASE = 'https://api.cloudflare.com/client/v4'

// ------------------------------------------------------------ public log

export const PUBLIC_WORDS = new Set([
  'PASS', 'FAIL', 'SKIPPED', 'withheld', 'yes', 'no', 'none',
  'copy', 'verify-only', 'source', 'destination', 'unknown', 'mixed',
  'present', 'absent', 'created', 'deleted', 'already-absent', 'still-present',
  'apac', 'eeur', 'weur', 'wnam', 'enam', 'oc', 'default',
  'secret', 'plain-text', 'other-type',
])

const TOKEN = Symbol('public-token')
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const SHA = /^[0-9a-f]{7,40}$/

// Marks a value that the caller has vetted as public (a query FILE name from
// this public repository, for example). Never pass data through this.
export function publicToken(value) {
  const s = String(value)
  if (!SAFE.test(s)) throw new OpsError('unsafe-public-token', 'A public token must be a short plain name.')
  return { [TOKEN]: s }
}

function publicValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (value && typeof value === 'object' && typeof value[TOKEN] === 'string') return value[TOKEN]
  if (value instanceof OpsError) return value.code
  if (typeof value === 'string' && (PUBLIC_WORDS.has(value) || SHA.test(value))) return value
  throw new Error('A value was refused by the public log.')
}

export function formatPublic(template, values = {}) {
  if (typeof template !== 'string' || template.length > 200 || /[\r\n]/.test(template)) {
    throw new Error('A public log template must be a short single line.')
  }
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (_, name) => {
    if (!Object.prototype.hasOwnProperty.call(values, name)) throw new Error(`The public log line is missing {${name}}.`)
    return publicValue(values[name])
  })
}

export function say(template, values) {
  process.stdout.write(`${formatPublic(template, values)}\n`)
}

// One bullet per line, so the job summary renders as a list.
export function summary(template, values) {
  const line = formatPublic(template, values)
  const file = process.env.GITHUB_STEP_SUMMARY
  if (file) fs.appendFileSync(file, `- ${line}\n`)
}

// ---------------------------------------------------------------- errors

// code: a fixed kebab-case literal that is safe to print. message: detail
// for the encrypted report only.
export class OpsError extends Error {
  constructor(code, message, detail) {
    super(message || code)
    if (!/^[a-z][a-z0-9-]{2,63}$/.test(code)) throw new Error('OpsError codes are short kebab-case literals.')
    this.code = code
    this.detail = detail
  }
}

export function errorRecord(err) {
  if (!err) return null
  return {
    code: err instanceof OpsError ? err.code : 'internal-error',
    message: String(err.message || err),
    stack: typeof err.stack === 'string' ? err.stack.split('\n').slice(0, 12).join('\n') : undefined,
    detail: err.detail,
  }
}

// Runs a script's main(). A crash prints only the error CODE (a literal) --
// never its message, which might name a key or echo a row.
export function runMain(fn) {
  const onFatal = (err) => {
    try {
      say('::error::stopped: {code} (details, when a report was written, are in the encrypted artifact)', {
        code: err instanceof OpsError ? err : 'unknown',
      })
    } catch {
      process.stdout.write('::error::stopped (details withheld from the public log)\n')
    }
    process.exitCode = 1
    // Do not let an in-flight request keep a failed step alive.
    setTimeout(() => process.exit(1), 250).unref()
  }
  process.on('uncaughtException', onFatal)
  process.on('unhandledRejection', onFatal)
  Promise.resolve()
    .then(fn)
    .then((code) => {
      if (typeof code === 'number' && code !== 0) process.exitCode = code
    })
    .catch(onFatal)
}

export function isMain(metaUrl) {
  if (!process.argv[1]) return false
  const here = path.resolve(fileURLToPath(metaUrl))
  const invoked = path.resolve(process.argv[1])
  return process.platform === 'win32' ? here.toLowerCase() === invoked.toLowerCase() : here === invoked
}

export function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new OpsError('missing-environment', `Environment variable ${name} is not set.`)
  return value
}

export function commitId() {
  const sha = String(process.env.GITHUB_SHA || '').toLowerCase()
  return SHA.test(sha) ? sha : 'unknown'
}

export function runId() {
  const id = String(process.env.GITHUB_RUN_ID || '')
  return /^\d{1,20}$/.test(id) ? id : 'local'
}

// ------------------------------------------------------ child processes

// Runs wrangler from the repository's own install with every byte of output
// captured, never inherited: wrangler prints URLs, ids and SQL errors that do
// not belong in a public log.
export function runWrangler(args, { cwd, input, timeoutMs = 10 * 60 * 1000, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [WRANGLER_JS, ...args], {
      cwd,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1', FORCE_COLOR: '0', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill() } catch { /* already gone */ }
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ code: 1, stdout, stderr: `${stderr}\n${err.message}`, timedOut })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code == null ? 1 : code, stdout, stderr, timedOut })
    })
    child.stdin.on('error', () => { /* child exited before reading stdin */ })
    child.stdin.end(input === undefined ? '' : input)
  })
}

// Cloudflare API error codes are plain numbers and safe to print.
export function cloudflareErrorCodes(text) {
  const codes = new Set()
  for (const m of String(text || '').matchAll(/\[code: (\d{3,6})\]/g)) codes.add(Number(m[1]))
  for (const m of String(text || '').matchAll(/"code"\s*:\s*(\d{3,6})\b/g)) codes.add(Number(m[1]))
  return [...codes].slice(0, 5)
}

export function codesText(codes) {
  return codes.length ? codes.join('-') : 'none'
}

// ------------------------------------------------------ Cloudflare REST

export async function cfApi(method, pathname, { body, token = process.env.CLOUDFLARE_API_TOKEN, timeoutMs = 30000, attempts = 3 } = {}) {
  if (!token) throw new OpsError('missing-environment', 'CLOUDFLARE_API_TOKEN is not set.')
  let last = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(`${API_BASE}${pathname}`, {
        method,
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'user-agent': 'business-os-ops',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const text = await res.text()
      let json = null
      try { json = JSON.parse(text) } catch { /* not JSON */ }
      last = { status: res.status, ok: res.ok && (!json || json.success !== false), json }
      if (res.status !== 429 && res.status < 500) return last
    } catch (err) {
      last = { status: 0, ok: false, json: null, error: err.name === 'AbortError' ? 'timed out' : err.message }
    } finally {
      clearTimeout(timer)
    }
    await sleep(1000 * attempt * attempt)
  }
  return last
}

export function apiErrorCodes(response) {
  const errors = response && response.json && Array.isArray(response.json.errors) ? response.json.errors : []
  return errors.map((e) => Number(e && e.code)).filter((n) => Number.isFinite(n)).slice(0, 5)
}

// ------------------------------------------------- the production Worker

export const PRODUCTION_WORKER = 'business-os'

// The bindings of every version carrying traffic in a Worker's newest
// deployment, as the API reports them (it never returns a secret's value).
// api(method, path) -> { ok, status, json } (cfApi, or a test fake).
//   { ok: true, versions: [{ versionId, percentage, bindings }] }
//   { ok: false, reason, detail }   reason: a fixed kebab-case code
export async function liveVersionBindings(api, accountId, script) {
  const fail = (reason, detail) => ({ ok: false, reason, detail })
  const base = `/accounts/${accountId}/workers/scripts/${script}`
  const dep = await api('GET', `${base}/deployments`)
  if (!dep || !dep.ok) return fail('deployments-unreadable', { status: dep && dep.status })
  const deployments = dep.json && dep.json.result && dep.json.result.deployments
  if (!Array.isArray(deployments) || !deployments.length) return fail('no-deployments')
  // The API lists newest first (wrangler reads .at(0)); sort defensively.
  const latest = [...deployments].sort((a, b) => String(b && b.created_on || '').localeCompare(String(a && a.created_on || '')))[0]
  const live = (latest && Array.isArray(latest.versions) ? latest.versions : []).filter((v) => v && Number(v.percentage) > 0)
  if (!live.length) return fail('no-live-versions')
  const versions = []
  for (const v of live) {
    if (typeof v.version_id !== 'string' || !/^[0-9a-f-]{8,64}$/i.test(v.version_id)) return fail('bad-version-id')
    const r = await api('GET', `${base}/versions/${v.version_id}`)
    const bindings = r && r.ok && r.json && r.json.result && r.json.result.resources ? r.json.result.resources.bindings : null
    if (!Array.isArray(bindings)) return fail('bindings-unreadable', { status: r && r.status })
    versions.push({ versionId: v.version_id, percentage: Number(v.percentage), bindings })
  }
  return { ok: true, versions }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------- the report

// Encrypts `payload` for the owner and writes <outDir>/<baseName>.enc.json.
// Only this file is uploaded (ops.yml uploads *.enc.json and nothing else).
export function writeEncryptedReport(outDir, baseName, payload, meta) {
  if (!/^[a-z0-9][a-z0-9.-]{0,120}$/.test(baseName)) throw new OpsError('bad-report-name', 'Report names are plain kebab-case.')
  const pem = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8')
  const envelope = encryptEnvelope(JSON.stringify(payload, null, 1), pem, meta)
  fs.mkdirSync(outDir, { recursive: true })
  const file = path.join(outDir, `${baseName}.enc.json`)
  fs.writeFileSync(file, `${JSON.stringify(envelope)}\n`)
  return { file, bytes: fs.statSync(file).size }
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url')
}

export function truncate(text, max = 200000) {
  const s = String(text || '')
  return s.length > max ? `${s.slice(0, max)}\n[truncated ${s.length - max} chars]` : s
}
