'use strict'
// Side-effect layer of the release kit: the transcript log, prompts,
// child processes and HTTP. Every child process the kit starts goes through
// this file. Production commands go through runSpec(), which refuses to run
// without an approval of the right strength (lib.assertApproved).
//
// Credentials: this file never opens cloudflare/.wrangler-auth.local or
// cloudflare/.dev.vars. Wrangler commands run through the repository's own
// cloudflare/scripts/with-wrangler-auth.cjs, which loads the token itself.

const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { spawn, execFileSync } = require('child_process')
const lib = require('./lib.cjs')

// ------------------------------------------------------------------- log

class Transcript {
  constructor() {
    this.buffer = []
    this.file = ''
  }
  attach(dir, name) {
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, name)
    if (this.file === file) return file
    const pending = this.buffer.join('')
    this.buffer = []
    if (this.file && fs.existsSync(this.file)) {
      fs.appendFileSync(file, fs.readFileSync(this.file, 'utf8'))
    }
    fs.appendFileSync(file, pending)
    this.file = file
    return file
  }
  raw(text) {
    const s = String(text)
    if (this.file) fs.appendFileSync(this.file, s)
    else this.buffer.push(s)
  }
  // Writes to screen and log.
  say(text = '') {
    const line = `${text}\n`
    process.stdout.write(line)
    this.raw(line)
  }
  // Log only (long test output).
  quiet(text = '') { this.raw(`${text}\n`) }
}

const log = new Transcript()

// ---------------------------------------------------------------- prompts

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    let answered = false
    rl.question(question, (answer) => {
      answered = true
      rl.close()
      log.quiet(`${question}${answer}`)
      resolve(String(answer).trim())
    })
    rl.on('close', () => { if (!answered) resolve('') })
  })
}

async function askDefault(ctx, question, fallback) {
  if (ctx.dryRun || ctx.ci) {
    log.say(`${question}[${fallback}]  (${ctx.ci ? 'ci' : 'dry-run'}: using ${fallback})`)
    return fallback
  }
  const a = await ask(`${question}[${fallback}] `)
  return a || fallback
}

// Returns an approval object for lib.assertApproved.
//   confirm  - type y
//   typeYES  - type YES in capitals
//   double   - type YES, then type `secondWord`
// In CI, the approval is the workflow's own confirm input (checked before
// this runs) passed as RELEASE_CONFIRM, plus the GitHub environment review.
async function confirm(ctx, gate, message, secondWord = 'ROLLBACK') {
  log.say('')
  log.say(`>>> ${message}`)
  if (ctx.dryRun) {
    log.say(`[dry-run] would ask for a "${gate}" confirmation here; answering yes`)
    return { ok: true, gate, dry: true }
  }
  if (ctx.ci) {
    const expected = ctx.ciConfirmWord || 'DEPLOY'
    const ok = process.env.RELEASE_CONFIRM === expected
    log.say(ok ? `[ci] confirmed by the workflow input (${expected}) and the environment review` : `[ci] NOT confirmed: the confirm input is not ${expected}`)
    return { ok, gate: ok ? 'double' : 'none' }
  }
  if (gate === 'confirm') {
    const a = (await ask('Type y and press Enter to continue (anything else stops): ')).toLowerCase()
    return { ok: a === 'y' || a === 'yes', gate }
  }
  const first = await ask('Type YES (in capitals) and press Enter to continue (anything else stops): ')
  if (first !== 'YES') return { ok: false, gate }
  if (gate === 'typeYES') return { ok: true, gate }
  const second = await ask(`Are you sure? This cannot be undone by the kit. Type ${secondWord} to go ahead: `)
  return { ok: second === secondWord, gate }
}

// --------------------------------------------------------- child processes

function npmCli() {
  const candidates = [
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
  return candidates.find((p) => fs.existsSync(p)) || ''
}

// [cmd, args] for `npm <args>` without needing a shell.
function npmInvocation(args) {
  const cli = npmCli()
  if (cli) return [process.execPath, [cli, ...args]]
  return [process.platform === 'win32' ? 'npm.cmd' : 'npm', args]
}

function displayCommand(cmd, args) {
  const short = (a) => {
    const s = String(a)
    if (s === process.execPath) return 'node'
    if (/npm-cli\.js$/.test(s)) return 'npm'
    if (/wrangler[\\/]bin[\\/]wrangler\.js$/.test(s)) return 'wrangler'
    return /\s/.test(s) ? `"${s}"` : s
  }
  return [cmd, ...args].map(short).join(' ')
}

function spawnTee(cmd, args, opts = {}) {
  const { cwd, env, capture = false, quiet = false, timeoutMs = 0, interactive = false } = opts
  return new Promise((resolve) => {
    let out = ''
    let timedOut = false
    const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd)
    const child = spawn(cmd, args, {
      cwd,
      env: env || process.env,
      stdio: [interactive ? 'inherit' : 'ignore', 'pipe', 'pipe'],
      shell: needsShell,
      windowsHide: true,
    })
    let timer = null
    if (timeoutMs > 0) {
      timer = setTimeout(() => { timedOut = true; try { child.kill() } catch { /* gone */ } }, timeoutMs)
    }
    const onData = (chunk) => {
      const s = chunk.toString()
      if (capture) out += s
      if (quiet) return
      if (!capture || opts.echo) process.stdout.write(s)
      log.raw(s)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      out += `\n${err.message}`
      resolve({ code: 1, out, timedOut, error: err.message })
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code: code == null ? 1 : code, out, timedOut })
    })
  })
}

// Builds the argv for a catalogue command run from `releaseDir/cloudflare`.
function specInvocation(spec, ctx) {
  const cfDir = path.join(ctx.releaseDir, 'cloudflare')
  let inner
  if (spec.kind === 'wrangler') {
    const wranglerJs = path.join(cfDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
    inner = [process.execPath, [wranglerJs, ...spec.args]]
  } else if (spec.kind === 'npm') {
    inner = npmInvocation(spec.args)
  } else if (spec.kind === 'bat') {
    return { cmd: 'cmd.exe', args: ['/d', '/c', path.join(ctx.repoRoot, 'run', spec.args[0])], cwd: ctx.repoRoot }
  } else {
    throw new Error(`Unknown command kind ${spec.kind}`)
  }
  // with-wrangler-auth.cjs loads the saved API token (if any) into the
  // environment and runs the command; with no saved token it passes the
  // environment through (CLOUDFLARE_API_TOKEN in CI, or wrangler's login).
  if (ctx.authWrapper) {
    return { cmd: process.execPath, args: [ctx.authWrapper, inner[0], ...inner[1]], cwd: cfDir }
  }
  return { cmd: inner[0], args: inner[1], cwd: cfDir }
}

async function runSpec(spec, ctx, approval, opts = {}) {
  lib.assertApproved(spec, approval)
  const inv = specInvocation(spec, ctx)
  const shown = `(in ${inv.cwd}) ${displayCommand(inv.cmd, inv.args)}`
  if (ctx.dryRun) {
    log.say(`[dry-run] ${shown}`)
    return { code: 0, out: '', dry: true }
  }
  log.say(`$ ${ctx.ci && opts.capture ? `(in ${inv.cwd}) ${spec.kind} ${spec.args[0]} ... (output kept out of the public log)` : shown}`)
  return spawnTee(inv.cmd, inv.args, { cwd: inv.cwd, capture: !!opts.capture, quiet: !!opts.quiet, interactive: !ctx.ci && !opts.capture, timeoutMs: opts.timeoutMs || 0 })
}

// Local, non-production commands (git, npm scripts that only build/test,
// node test files). Refuses anything production-shaped.
async function runLocal(cmd, args, cwd, ctx, opts = {}) {
  const spec = { id: 'local', args: [cmd, ...args].map(String) }
  if (lib.isProductionSpec(spec)) throw new Error(`runLocal refused a production-shaped command: ${args.join(' ')}`)
  const shown = `(in ${cwd}) ${displayCommand(cmd, args)}`
  if (ctx.dryRun && !opts.readOnly) {
    if (!opts.silentDry) log.say(`[dry-run] ${shown}`)
    return { code: 0, out: '', dry: true }
  }
  if (!opts.quiet) log.say(`$ ${shown}`)
  else log.quiet(`$ ${shown}`)
  return spawnTee(cmd, args, { cwd, capture: !!opts.capture, quiet: !!opts.quiet, timeoutMs: opts.timeoutMs || 0, interactive: !!opts.interactive })
}

function npmLocal(script, cwd, ctx, opts = {}) {
  const [cmd, args] = npmInvocation(['run', script])
  return runLocal(cmd, args, cwd, ctx, opts)
}

// Read-only git query, runs even in dry-run.
function gitRead(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

// ------------------------------------------------------------------ HTTP

async function httpGet(url, ctx, { timeoutMs = 20000 } = {}) {
  if (ctx.dryRun) {
    log.say(`[dry-run] GET ${url}`)
    return null
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'manual',
      headers: { 'user-agent': 'business-os-release-kit', accept: 'application/json, text/html;q=0.9' },
    })
    const body = await res.text()
    return { status: res.status, headers: lib.lowerHeaders(res.headers), body }
  } catch (err) {
    return { status: 0, headers: {}, body: '', error: err.name === 'AbortError' ? 'timed out' : err.message }
  } finally {
    clearTimeout(timer)
  }
}

module.exports = {
  log, ask, askDefault, confirm, runSpec, runLocal, npmLocal, npmInvocation, gitRead, httpGet,
  specInvocation, displayCommand, spawnTee,
}
