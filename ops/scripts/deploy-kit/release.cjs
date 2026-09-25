#!/usr/bin/env node
'use strict'
// Business OS release kit: the owner runs a whole release alone, from a menu,
// with plain-English prompts, and Claude reads the transcript afterwards.
// Started by run\release.bat. Every menu item is also a command:
//
//   run\release.bat                      menu
//   run\release.bat release              the whole release, in order
//   run\release.bat network | prepare | gates | login | snapshot |
//                   migrations | deploy | live | rollback |
//                   export-names | r2-steps | verify-local | full-automation
//
// Options (PowerShell or GNU spelling):
//   -DryRun / --dry-run   print every command instead of running it
//   -Ref <branch|sha>     what to release (default claude/urgent-20260925)
//   -Plan paid|free       Cloudflare plan config (default paid)
//   -UseCert              skip the tests when a Claude certificate for the
//                         exact commit exists (see DEPLOY.md)
//   -Records <dir>        where deploy records go (default <home>\Records)
//   -Worktree <dir>       the release folder (default <home>\Worktrees\release)
//   -AuthFrom <checkout>  the checkout whose saved Cloudflare token to use
//   -Site <url>           default https://admin.leangbeauty.com
//   -Jobs <n>             test files run in parallel (default 3)
//   -Retries <n>          extra tries for a red test file (default 2)
//   rollback: -Target worker|database  -VersionId <id>  -Db <name>  -Bookmark <b>
//   CI only: -CI -ReleaseDir <checkout> -NoApply
//
// <home> is BUSINESS_OS_HOME, else the folder holding the main git checkout.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const lib = require('./lib.cjs')
const ex = require('./exec.cjs')

const { log } = ex
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const R2_PLAN_REL = path.join('Performance', '2026-09-25', 'claude', 'R2-apac-plan.md')
const R2_SCRIPTS_REL = path.join('Performance', '2026-09-25', 'claude', 'r2-apac')
const WINDOW_ADVICE = 'This window is going through the VPN. Open Windows Terminal from the Start menu (not from Claude) and run run\\release.bat again.'
const VPN_ADVICE = `${WINDOW_ADVICE} If it still happens, turn the VPN off (or exclude cloudflare.com and leangbeauty.com from it) and try again.`

// ------------------------------------------------------------------ setup

function worktreeList(cwd) {
  const text = ex.gitRead(['worktree', 'list', '--porcelain'], cwd)
  const out = []
  let cur = null
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) { cur = { path: path.resolve(line.slice(9)), branch: '' }; out.push(cur) }
    else if (cur && line.startsWith('branch ')) cur.branch = line.slice(7)
  }
  return out
}

function buildContext(args) {
  const worktrees = worktreeList(REPO_ROOT)
  const mainWorktree = worktrees[0] ? worktrees[0].path : REPO_ROOT
  const home = process.env.BUSINESS_OS_HOME ? path.resolve(process.env.BUSINESS_OS_HOME) : path.dirname(mainWorktree)
  const ctx = {
    args,
    repoRoot: REPO_ROOT,
    mainWorktree,
    worktrees,
    home,
    dryRun: !!args.dryRun,
    ci: !!args.ci,
    ciConfirmWord: 'DEPLOY',
    plan: args.plan || '',
    ref: args.ref || '',
    site: String(args.site || lib.DEFAULT_SITE).replace(/\/+$/, ''),
    jobs: Math.max(1, Number(args.jobs) || 3),
    retries: Math.max(0, args.retries == null ? 2 : Number(args.retries) || 0),
    records: path.resolve(args.records || process.env.BUSINESS_OS_RECORDS || path.join(home, 'Records')),
    ownerRecords: path.join(home, 'Records'),
    fixedRelease: !!args.releaseDir,
    releaseDir: path.resolve(args.releaseDir || args.worktree || path.join(home, 'Worktrees', 'release')),
    sha: '',
    subject: '',
    recordDir: '',
    state: {},
  }
  if (ctx.ci && !ctx.fixedRelease) throw new Error('-CI needs -ReleaseDir <checkout>')
  // Which with-wrangler-auth.cjs to go through. The kit only checks that a
  // saved-token file EXISTS; the wrapper is what reads it.
  const candidates = ctx.ci ? [ctx.releaseDir] : [args.authFrom, REPO_ROOT, mainWorktree].filter(Boolean).map((p) => path.resolve(p))
  const withToken = candidates.find((c) => fs.existsSync(path.join(c, 'cloudflare', '.wrangler-auth.local')))
  const wrapperHome = withToken || candidates.find((c) => fs.existsSync(path.join(c, 'cloudflare', 'scripts', 'with-wrangler-auth.cjs'))) || ''
  ctx.authWrapper = wrapperHome ? path.join(wrapperHome, 'cloudflare', 'scripts', 'with-wrangler-auth.cjs') : ''
  ctx.authNote = withToken
    ? `saved Cloudflare token found in ${withToken}\\cloudflare (the kit does not open it)`
    : (ctx.ci ? 'CLOUDFLARE_API_TOKEN from the GitHub secret' : 'no saved token file found; wrangler will use its own login')
  return ctx
}

function summary(ctx, markdown) {
  if (ctx.ci && process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`)
}

function heading(text) {
  log.say('')
  log.say('='.repeat(72))
  log.say(`  ${text}`)
  log.say('='.repeat(72))
}

// A success line; in a dry run nothing happened, so say so.
function done(ctx, message) {
  log.say(ctx.dryRun ? `[dry-run] (a real run would now say) ${message}` : message)
}

function stateFile(ctx) { return path.join(ctx.recordDir, 'state.json') }
function saveState(ctx) {
  if (!ctx.recordDir) return
  fs.mkdirSync(ctx.recordDir, { recursive: true })
  fs.writeFileSync(stateFile(ctx), `${JSON.stringify(ctx.state, null, 2)}\n`)
}
function writeRecord(ctx, name, data) {
  if (!ctx.recordDir) return ''
  const file = path.join(ctx.recordDir, name)
  fs.writeFileSync(file, typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`)
  return file
}

const RUN_STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

function useRecord(ctx, sha) {
  const deploys = path.join(ctx.records, 'Deploys')
  const suffix = `-${sha.slice(0, 12)}${ctx.dryRun ? '-dryrun' : ''}`
  let dir = ''
  if (fs.existsSync(deploys)) {
    const hit = fs.readdirSync(deploys).filter((n) => n.endsWith(suffix)).sort().pop()
    if (hit) dir = path.join(deploys, hit)
  }
  if (!dir) dir = path.join(deploys, `${lib.recordDirName(lib.todayStamp(), sha)}${ctx.dryRun ? '-dryrun' : ''}`)
  ctx.recordDir = dir
  const file = log.attach(dir, `release-${RUN_STAMP}.log`)
  ctx.state = fs.existsSync(stateFile(ctx)) ? JSON.parse(fs.readFileSync(stateFile(ctx), 'utf8')) : {}
  ctx.state.sha = sha
  return file
}

function resolveRef(ref) {
  for (const candidate of [ref, `origin/${ref}`]) {
    const sha = ex.gitRead(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], REPO_ROOT)
    if (/^[0-9a-f]{40}$/.test(sha)) return sha
  }
  return ''
}

function releaseExists(ctx) { return fs.existsSync(path.join(ctx.releaseDir, '.git')) }

function treeState(ctx) {
  const head = ex.gitRead(['rev-parse', 'HEAD'], ctx.releaseDir)
  const dirty = ex.gitRead(['status', '--porcelain', '--untracked-files=no'], ctx.releaseDir)
  return { head, dirty }
}

// Establishes ctx.sha for steps run on their own: the release folder's HEAD.
function needSha(ctx) {
  if (ctx.sha) return true
  if (releaseExists(ctx)) {
    const { head } = treeState(ctx)
    if (head) {
      ctx.sha = head
      ctx.subject = ex.gitRead(['log', '-1', '--format=%s', head], ctx.releaseDir)
      useRecord(ctx, head)
      return true
    }
  }
  if (ctx.dryRun) {
    const sha = resolveRef(ctx.ref || lib.DEFAULT_REF) || '0'.repeat(40)
    ctx.sha = sha
    ctx.subject = ex.gitRead(['log', '-1', '--format=%s', sha], REPO_ROOT)
    useRecord(ctx, sha)
    log.say(`[dry-run] no release folder yet; pretending it holds ${sha.slice(0, 12)}`)
    return true
  }
  log.say('There is no prepared release yet. Choose "Choose version" in the menu first.')
  return false
}

async function checkClean(ctx) {
  if (ctx.dryRun && !releaseExists(ctx)) {
    log.say(`[dry-run] would check that ${ctx.releaseDir} is clean and at ${ctx.sha.slice(0, 12)}`)
    return true
  }
  const { head, dirty } = treeState(ctx)
  if (head !== ctx.sha) {
    log.say(`STOP: the release folder is at ${head.slice(0, 12) || '(nothing)'}, not ${ctx.sha.slice(0, 12)}.`)
    return false
  }
  if (dirty) {
    // The frontend build rewrites frontend/public/*.js with LF endings; with
    // core.autocrlf=true git then lists them as modified although the content
    // is the commit's. Only line-ending-only files are put back (this is the
    // dedicated release folder); a real content change still stops.
    const files = dirty.split(/\r?\n/).map((l) => l.replace(/^\s*\S+\s+/, '').trim()).filter(Boolean)
    const real = new Set(ex.gitRead(['-c', 'core.autocrlf=false', 'diff', '--ignore-cr-at-eol', '--name-only', 'HEAD', '--', ...files], ctx.releaseDir).split(/\r?\n/).filter(Boolean))
    const eolOnly = files.filter((f) => !real.has(f))
    if (eolOnly.length && real.size === 0) {
      log.say(`Only line endings differ in: ${eolOnly.join(', ')}; restoring them from the commit.`)
      const r = await ex.runLocal('git', ['checkout', '--', ...eolOnly], ctx.releaseDir, ctx)
      const again = r.dry ? '' : treeState(ctx).dirty
      if (r.code === 0 && !again) {
        log.say(`Release folder is clean and exactly at ${ctx.sha.slice(0, 12)}.`)
        return true
      }
    }
    log.say('STOP: the release folder has changed files, so it would not match the commit:')
    log.say(dirty)
    return false
  }
  log.say(`Release folder is clean and exactly at ${ctx.sha.slice(0, 12)}.`)
  return true
}

// ------------------------------------------------------------------ steps

async function stepNetwork(ctx) {
  heading('Network check: does Cloudflare let this computer through?')
  const probes = [
    { label: 'Cloudflare API', url: 'https://api.cloudflare.com/client/v4/ips' },
    { label: 'Business OS site', url: `${ctx.site}/health` },
  ]
  let challenged = false
  let failed = false
  const results = []
  for (const p of probes) {
    const res = await ex.httpGet(p.url, ctx)
    if (!res) { results.push({ ...p, verdict: 'dry-run' }); continue }
    const verdict = res.error ? 'error' : lib.classifyResponse(res)
    results.push({ ...p, status: res.status, verdict, error: res.error || '' })
    if (verdict === 'challenge') challenged = true
    if (verdict === 'error') failed = true
    log.say(`  ${p.label.padEnd(18)} ${verdict === 'ok' ? 'OK' : verdict === 'challenge' ? 'BLOCKED by a bot challenge' : `could not check (${res.error || `HTTP ${res.status}`})`}`)
  }
  ctx.state.network = { at: new Date().toISOString(), results }
  if (ctx.dryRun) return true
  if (challenged) {
    log.say('')
    log.say('Cloudflare is showing this computer an "are you a robot?" check.')
    log.say(VPN_ADVICE)
    return false
  }
  if (failed) {
    log.say('Could not reach one of the sites. Check the internet connection and try again.')
    return false
  }
  log.say('Network is fine for a release.')
  return true
}

async function npmCi(ctx, dir, label) {
  const lock = path.join(dir, 'package-lock.json')
  const marker = path.join(dir, 'node_modules', '.release-kit-lock-hash')
  const want = fs.existsSync(lock) ? crypto.createHash('sha256').update(fs.readFileSync(lock)).digest('hex') : ''
  const have = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim() : ''
  if (!ctx.dryRun && want && have === want) {
    log.say(`${label}: packages already installed for this lockfile.`)
    return true
  }
  const [cmd, args] = ex.npmInvocation(['ci', '--no-audit', '--no-fund'])
  const r = await ex.runLocal(cmd, args, dir, ctx)
  if (r.code !== 0) { log.say(`STOP: installing ${label} packages failed.`); return false }
  if (!ctx.dryRun && want) fs.writeFileSync(marker, want)
  return true
}

async function stepPrepare(ctx) {
  heading('Choose what to release')
  if (ctx.fixedRelease) {
    const { head } = treeState(ctx)
    if (!head) { log.say(`STOP: ${ctx.releaseDir} is not a git checkout.`); return false }
    ctx.sha = head
    ctx.subject = ex.gitRead(['log', '-1', '--format=%s', head], ctx.releaseDir)
    const logFile = useRecord(ctx, head)
    log.say(`Release commit: ${head}`)
    log.say(`Subject:        ${ctx.subject}`)
    log.say(`Log:            ${logFile}`)
    summary(ctx, `## Release ${head.slice(0, 12)}\n\n- Subject: ${ctx.subject}\n- Commit: \`${head}\``)
    ctx.state.ref = ctx.ref || '(checked out by the workflow)'
    ctx.state.subject = ctx.subject
    saveState(ctx)
    return await checkClean(ctx)
  }
  const ref = await ex.askDefault(ctx, 'Which branch or commit do you want to release? ', ctx.ref || lib.DEFAULT_REF)
  const sha = resolveRef(ref)
  if (!sha) {
    log.say(`STOP: "${ref}" is not a branch or commit this computer knows.`)
    return false
  }
  ctx.sha = sha
  ctx.ref = ref
  ctx.subject = ex.gitRead(['log', '-1', '--format=%s', sha], REPO_ROOT)
  const logFile = useRecord(ctx, sha)
  log.say(`  Branch/commit: ${ref}`)
  log.say(`  Commit:        ${sha}`)
  log.say(`  Subject:       ${ctx.subject}`)
  log.say(`  Date:          ${ex.gitRead(['log', '-1', '--format=%ci', sha], REPO_ROOT)}`)
  log.say(`  Release folder ${ctx.releaseDir}`)
  log.say(`  Deploy record  ${ctx.recordDir}`)
  log.say(`  Log file       ${logFile}`)
  const ok = await ex.confirm(ctx, 'confirm', `Release commit ${sha.slice(0, 12)} "${ctx.subject}"?`)
  if (!ok.ok) { log.say('Stopped. Nothing was changed.'); return false }

  const why = lib.forbiddenReleasePath(ctx.releaseDir, {
    protectedPaths: [ctx.mainWorktree, REPO_ROOT],
    branchWorktrees: ctx.worktrees.filter((w) => w.branch).map((w) => w.path),
  })
  if (why) { log.say(`STOP: ${ctx.releaseDir} cannot be the release folder: ${why}.`); return false }

  const registered = ctx.worktrees.some((w) => lib.samePath(w.path, ctx.releaseDir))
  if (fs.existsSync(ctx.releaseDir) && !registered) {
    log.say(`STOP: ${ctx.releaseDir} exists but is not a worktree of this repository. Move it away or pass -Worktree <another folder>.`)
    return false
  }
  const steps = registered
    ? [['checkout', '--detach', '--force', sha], ['reset', '--hard', sha], ['clean', '-fd']]
    : [['worktree', 'add', '--detach', ctx.releaseDir, sha]]
  for (const args of steps) {
    const cwd = registered ? ctx.releaseDir : REPO_ROOT
    const r = await ex.runLocal('git', args, cwd, ctx)
    if (r.code !== 0) { log.say('STOP: preparing the release folder failed.'); return false }
  }
  if (!(await npmCi(ctx, path.join(ctx.releaseDir, 'cloudflare'), 'cloudflare'))) return false
  if (!(await npmCi(ctx, path.join(ctx.releaseDir, 'frontend'), 'frontend'))) return false
  ctx.state.ref = ref
  ctx.state.subject = ctx.subject
  ctx.state.preparedAt = new Date().toISOString()
  saveState(ctx)
  return await checkClean(ctx)
}

function listAtCommit(ctx, dir, re) {
  const cwd = releaseExists(ctx) ? ctx.releaseDir : REPO_ROOT
  return ex.gitRead(['ls-tree', '-r', '--name-only', ctx.sha, '--', dir], cwd)
    .split(/\r?\n/).filter((f) => re.test(f)).sort()
}

async function runFiles(ctx, label, files, cwd, prefix) {
  const rels = files.map((f) => f.slice(prefix.length))
  if (ctx.dryRun) {
    log.say(`[dry-run] (in ${cwd}) node <file>  for each of ${rels.length} ${label} files, one file per process, ${ctx.jobs} at a time, a red file retried up to ${ctx.retries} more times`)
    for (const r of rels.slice(0, 3)) log.say(`[dry-run]     node ${r}`)
    if (rels.length > 3) log.say(`[dry-run]     ... ${rels.length - 3} more (full list in the log)`)
    for (const r of rels.slice(3)) log.quiet(`[dry-run]     node ${r}`)
    return { ok: true, red: [] }
  }
  log.say(`Running ${rels.length} ${label} files (${ctx.jobs} at a time)...`)
  const failed = []
  let next = 0
  let done = 0
  const worker = async () => {
    while (next < rels.length) {
      const rel = rels[next]
      next += 1
      const r = await ex.runLocal(process.execPath, [rel], cwd, ctx, { capture: true, quiet: true, timeoutMs: 10 * 60 * 1000 })
      done += 1
      if (r.code !== 0) { failed.push(rel); log.quiet(`RED (first try${r.timedOut ? ', timed out' : ''}) ${rel}\n${r.out}`) }
      if (done % 50 === 0 || done === rels.length) log.say(`  ${done}/${rels.length} done, ${failed.length} red so far`)
    }
  }
  await Promise.all(Array.from({ length: ctx.jobs }, worker))
  const red = []
  for (const rel of failed.sort()) {
    let passed = false
    for (let attempt = 1; attempt <= ctx.retries && !passed; attempt += 1) {
      log.say(`  retrying ${rel} alone (try ${attempt + 1})`)
      const r = await ex.runLocal(process.execPath, [rel], cwd, ctx, { capture: true, quiet: true, timeoutMs: 15 * 60 * 1000 })
      passed = r.code === 0
      if (!passed) log.quiet(`RED (retry ${attempt}${r.timedOut ? ', timed out' : ''}) ${rel}\n${r.out}`)
    }
    if (!passed) red.push(rel)
  }
  log.say(`  ${label}: ${rels.length - red.length}/${rels.length} green${red.length ? `, RED: ${red.join(', ')}` : ''}`)
  return { ok: red.length === 0, red }
}

async function stepGates(ctx) {
  heading('Safety tests at the exact commit')
  if (!needSha(ctx)) return false
  if (!(await checkClean(ctx))) return false
  const certFile = path.join(ctx.records, 'Deploys', lib.CERT_DIR_NAME, lib.certFileName(ctx.sha))
  const certOk = fs.existsSync(certFile) && lib.certMatches(fs.readFileSync(certFile, 'utf8'), ctx.sha)
  if (certOk) {
    log.say(`Claude has certified this exact commit: ${certFile}`)
    let skip = !!ctx.args.useCert
    if (!skip && !ctx.ci && !ctx.dryRun) {
      skip = (await ex.ask('Skip the tests (already certified by Claude)? Type y to skip, Enter to run them: ')).toLowerCase() === 'y'
    }
    if (skip) {
      log.say('Tests skipped: certificate matches the exact commit.')
      ctx.state.gates = { skippedWithCert: certFile, at: new Date().toISOString() }
      saveState(ctx)
      return true
    }
  } else {
    log.say(`No Claude certificate for this commit (looked for ${certFile}); running every test.`)
  }
  const cf = path.join(ctx.releaseDir, 'cloudflare')
  const fe = path.join(ctx.releaseDir, 'frontend')
  const red = []
  const step = async (label, fn) => {
    log.say(`- ${label}`)
    const r = await fn()
    if (!r) red.push(label)
    return r
  }
  await step('cloudflare: typecheck (tsc --noEmit)', async () => (await ex.npmLocal('typecheck', cf, ctx)).code === 0)
  const cfRun = await runFiles(ctx, 'cloudflare scripts/test-*.cjs', listAtCommit(ctx, 'cloudflare/scripts', /^cloudflare\/scripts\/test-[^/]+\.cjs$/), cf, 'cloudflare/')
  red.push(...cfRun.red.map((f) => `cloudflare/${f}`))
  await step('frontend: typecheck', async () => (await ex.npmLocal('typecheck', fe, ctx)).code === 0)
  await step('frontend: verify:i18n', async () => (await ex.npmLocal('verify:i18n', fe, ctx)).code === 0)
  const built = await step('frontend: build', async () => (await ex.npmLocal('build', fe, ctx)).code === 0)
  const feRun = await runFiles(ctx, 'frontend tests/*.test.ts', listAtCommit(ctx, 'frontend/tests', /^frontend\/tests\/[^/]+\.test\.ts$/), fe, 'frontend/')
  red.push(...feRun.red.map((f) => `frontend/${f}`))
  if (!(await checkClean(ctx))) red.push('release folder changed while testing')
  ctx.state.gates = { at: new Date().toISOString(), red, dryRun: ctx.dryRun }
  if (built && !ctx.dryRun) ctx.state.frontendBuiltFor = ctx.sha
  saveState(ctx)
  summary(ctx, red.length ? `### Tests: RED\n\n${red.map((r) => `- ${r}`).join('\n')}` : '### Tests: all green')
  if (red.length) {
    log.say('')
    log.say('STOP: these checks are red, so nothing will be released:')
    for (const r of red) log.say(`  - ${r}`)
    log.say('Send the log file to Claude.')
    return false
  }
  done(ctx, 'All tests are green.')
  return true
}

async function stepLogin(ctx) {
  heading('Cloudflare login check')
  if (!needSha(ctx)) return false
  log.say(`Credentials: ${ctx.authNote}`)
  const r = await ex.runSpec(lib.commandCatalog.whoami(), ctx, null, { capture: true })
  if (r.dry) return true
  const loggedIn = r.code === 0 && !/not authenticated|not logged in|You are not logged/i.test(r.out)
  if (loggedIn) {
    const who = /associated with the email ([^\s.]+@[^\s]+?)\.?\s/i.exec(r.out)
    log.say(`Logged in to Cloudflare${who && !ctx.ci ? ` as ${who[1]}` : ''}.`)
    return true
  }
  if (lib.classifyResponse({ status: 403, headers: {}, body: r.out }) === 'challenge' || /challenge|403/i.test(r.out)) {
    log.say(`Cloudflare refused the check. ${VPN_ADVICE}`)
  }
  log.say('Not logged in to Cloudflare. Run this yourself in a new Command Prompt window, then choose this step again:')
  log.say(`    cd /d "${path.join(ctx.releaseDir, 'cloudflare')}" && npx wrangler login`)
  return false
}

async function readProduction(ctx, spec, approval) {
  const r = await ex.runSpec(spec, ctx, approval, { capture: true })
  if (r.dry) return { ok: true, dry: true, json: null }
  const json = lib.parseWranglerJson(r.out)
  return { ok: r.code === 0, json, out: r.out }
}

async function readCounts(ctx, approval) {
  const r = await readProduction(ctx, lib.commandCatalog.counts(), approval)
  if (r.dry) return { ok: true, counts: null }
  const counts = lib.parseCounts(r.json)
  return { ok: r.ok && !!counts, counts }
}

function countsTable(rows) {
  return rows.map((r) => `  ${r.table.padEnd(20)} ${String(r.pre ?? '-').padStart(9)} ${String(r.post ?? '').padStart(9)}  ${r.verdict || ''}`).join('\n')
}

async function stepSnapshot(ctx) {
  heading('Safety snapshot (restore point + row counts)')
  if (!needSha(ctx)) return false
  const approval = await ex.confirm(ctx, 'confirm', 'Read production to save a restore point and row counts? (This changes nothing.)')
  if (!approval.ok) { log.say('Stopped.'); return false }
  const bookmarks = {}
  for (const db of lib.DATABASES) {
    const r = await readProduction(ctx, lib.commandCatalog.timeTravelInfo(db.name), approval)
    if (r.dry) continue
    const bm = lib.findKey(r.json, 'bookmark')
    if (!r.ok || !bm) { log.say(`STOP: could not read the restore point of ${db.name}.`); if (!ctx.ci) log.say(r.out); return false }
    bookmarks[db.name] = bm
    log.say(`  restore point ${db.name}: ${bm}`)
  }
  const dep = await readProduction(ctx, lib.commandCatalog.deploymentStatus(), approval)
  let previousVersionId = ''
  if (!dep.dry) {
    const ids = JSON.stringify(dep.json || dep.out || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || []
    previousVersionId = ids[0] || ''
    log.say(`  live Worker version now: ${previousVersionId || '(could not read)'}`)
    if (!ctx.ci) writeRecord(ctx, 'deployment-before.json', dep.json || dep.out || '')
  }
  const c = await readCounts(ctx, approval)
  if (!c.ok) { log.say('STOP: could not read the row counts.'); return false }
  if (c.counts) log.say(countsTable(lib.KEY_TABLES.map((t) => ({ table: t, pre: c.counts[t] }))))
  ctx.state.snapshot = { at: new Date().toISOString(), bookmarks, previousVersionId, preCounts: c.counts }
  saveState(ctx)
  writeRecord(ctx, 'snapshot.json', ctx.state.snapshot)
  log.say('')
  log.say('If the release goes wrong, the database can be put back to this moment with (menu: Undo a release):')
  for (const db of lib.DATABASES) {
    const spec = lib.commandCatalog.restoreDatabase(db.name, bookmarks[db.name] || '<bookmark>')
    const inv = ex.specInvocation(spec, ctx)
    log.say(`    ${ex.displayCommand(inv.cmd, inv.args)}`)
  }
  log.say('  WARNING: a restore also removes every sale and change made after this moment.')
  summary(ctx, [
    '### Safety snapshot', '',
    ...lib.DATABASES.map((d) => `- Restore point \`${d.name}\`: \`${bookmarks[d.name] || '-'}\``),
    `- Worker version before: \`${previousVersionId || '-'}\``, '',
    '| table | rows before |', '| --- | ---: |',
    ...lib.KEY_TABLES.map((t) => `| ${t} | ${c.counts ? c.counts[t] : '-'} |`),
  ].join('\n'))
  return true
}

async function stepMigrations(ctx) {
  heading('Database updates (migrations)')
  if (!needSha(ctx)) return false
  const approval = await ex.confirm(ctx, 'confirm', 'Read the list of database updates that production has not had yet? (This changes nothing.)')
  if (!approval.ok) { log.say('Stopped.'); return false }
  const pending = {}
  const touched = new Set()
  for (const db of lib.DATABASES) {
    const r = await ex.runSpec(lib.commandCatalog.migrationsList(db.name), ctx, approval, { capture: true })
    if (r.dry) { pending[db.name] = null; continue }
    if (r.code !== 0) { log.say(`STOP: could not list the updates for ${db.name}.`); if (!ctx.ci) log.say(r.out); return false }
    pending[db.name] = lib.parseMigrationNames(r.out)
    log.say(`${db.name}: ${pending[db.name].length ? `${pending[db.name].length} update(s) waiting` : 'nothing waiting'}`)
    for (const name of pending[db.name]) {
      const file = path.join(ctx.releaseDir, 'cloudflare', db.migrationsDir, name)
      const sql = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
      for (const t of lib.tablesTouched(sql)) touched.add(t)
      log.say(`   - ${name}${sql ? `  -- ${lib.firstCommentLine(sql) || '(no comment)'}` : '  (FILE NOT IN THIS COMMIT)'}`)
    }
  }
  ctx.state.migrations = { pending, touchedTables: [...touched] }
  saveState(ctx)
  const total = Object.values(pending).reduce((n, list) => n + (list ? list.length : 0), 0)
  summary(ctx, `### Database updates waiting\n\n${lib.DATABASES.map((d) => `- ${d.name}: ${pending[d.name] ? (pending[d.name].join(', ') || 'none') : 'not read'}`).join('\n')}`)
  if (!ctx.dryRun && total === 0) { log.say('Production already has every database update.'); return true }
  if (ctx.args.noApply) {
    log.say(`NOT applying ${total} waiting update(s) (-NoApply). The new code may need them.`)
    summary(ctx, '**Migrations were NOT applied (run_migrations = false).**')
    return true
  }
  const write = await ex.confirm(ctx, 'typeYES', `Apply ${ctx.dryRun ? 'the waiting' : total} database update(s) to PRODUCTION now?`)
  if (!write.ok) { log.say('Stopped. No database update was applied.'); return false }
  for (const db of lib.DATABASES) {
    if (pending[db.name] && pending[db.name].length === 0) continue
    const r = await ex.runSpec(lib.commandCatalog.migrationsApply(db.name), ctx, write)
    if (r.code !== 0) {
      const note = [
        `Database update FAILED on ${db.name} at ${new Date().toISOString()}.`,
        'What this means: updates listed before the failing one are applied; the failing one and the ones after it are not.',
        'Do NOT run it again and do NOT deploy. Send this log to Claude.',
        `If the shop cannot work, the database can be put back to the restore point saved in snapshot.json (menu: Undo a release -> database).`,
      ].join('\n')
      writeRecord(ctx, 'migration-error.txt', `${note}\n\n${r.out || ''}`)
      log.say(note)
      ctx.state.migrations.failed = db.name
      saveState(ctx)
      summary(ctx, `**Migration FAILED on ${db.name}.** Nothing was deployed.`)
      return false
    }
  }
  ctx.state.migrations.appliedAt = new Date().toISOString()
  saveState(ctx)
  done(ctx, 'Database updates applied.')
  return true
}

async function stepDeploy(ctx) {
  heading('Publish the new version (deploy)')
  if (!needSha(ctx)) return false
  if (!(await checkClean(ctx))) return false
  const fe = path.join(ctx.releaseDir, 'frontend')
  if (ctx.state.frontendBuiltFor !== ctx.sha || !fs.existsSync(path.join(fe, 'dist'))) {
    log.say('Building the app pages for this commit...')
    const b = await ex.npmLocal('build', fe, ctx)
    if (b.code !== 0) { log.say('STOP: the build failed.'); return false }
    if (!ctx.dryRun) ctx.state.frontendBuiltFor = ctx.sha
  }
  if (!(await checkClean(ctx))) return false
  const plan = ctx.plan || await ex.askDefault(ctx, 'Cloudflare plan, paid or free? ', lib.DEFAULT_PLAN)
  if (!['paid', 'free'].includes(plan)) { log.say('STOP: type paid or free.'); return false }
  const approval = await ex.confirm(ctx, 'typeYES', `Publish ${ctx.sha.slice(0, 12)} "${ctx.subject}" to PRODUCTION on the ${plan} plan?`)
  if (!approval.ok) { log.say('Stopped. Nothing was published.'); return false }
  const r = await ex.runSpec(lib.commandCatalog.deploy(plan), ctx, approval)
  ctx.state.deploy = { at: new Date().toISOString(), plan, exitCode: r.code, dryRun: ctx.dryRun }
  const version = /Current Version ID:\s*([0-9a-f-]{36})/i.exec(r.out || '')
  if (version) ctx.state.deploy.versionId = version[1]
  saveState(ctx)
  if (r.code !== 0) { log.say('STOP: publishing failed. Send the log to Claude.'); return false }
  done(ctx, 'Published.')
  return true
}

async function stepLive(ctx) {
  heading('Live checks')
  if (!needSha(ctx)) return false
  const plan = ctx.plan || (ctx.state.deploy && ctx.state.deploy.plan) || lib.DEFAULT_PLAN
  const problems = []
  const warnings = []
  let version = null
  const deadline = Date.now() + (ctx.dryRun ? 0 : 180000)
  do {
    const res = await ex.httpGet(`${ctx.site}/api/runtime/version`, ctx)
    if (!res) break
    if (lib.classifyResponse(res) === 'challenge') { version = { challenged: true }; break }
    try { version = JSON.parse(res.body) } catch { version = null }
    if (version && lib.checkVersion(version, ctx.sha, plan).ok) break
    await new Promise((r) => setTimeout(r, 10000))
  } while (Date.now() < deadline)
  const health = await ex.httpGet(`${ctx.site}/health`, ctx)
  const admin = await ex.httpGet(`${ctx.site}/`, ctx)
  if (!ctx.dryRun) {
    if (version && version.challenged) {
      warnings.push(`the site showed this computer a bot challenge, so the live version could not be read. ${VPN_ADVICE}`)
    } else {
      const v = lib.checkVersion(version, ctx.sha, plan)
      if (!v.ok) problems.push(`/api/runtime/version: ${v.problems.join('; ')}`)
      else log.say(`  /api/runtime/version reports ${v.revision} (${version.tier}) - matches`)
    }
    let healthJson = null
    try { healthJson = JSON.parse(health.body) } catch { /* not json */ }
    if (lib.classifyResponse(health) === 'challenge') warnings.push('/health answered with a bot challenge')
    else if (!healthJson || healthJson.status !== 'ok') problems.push(`/health is not ok (HTTP ${health.status})`)
    else log.say(`  /health status ok (it reports app version ${healthJson.version}; the commit is checked on /api/runtime/version)`)
    const adminClass = lib.classifyResponse(admin)
    if (adminClass === 'challenge') warnings.push('the admin page answered with a bot challenge')
    else if (admin.status !== 200 || !/id="root"/.test(admin.body)) problems.push(`the admin page did not load (HTTP ${admin.status})`)
    else log.say('  admin page loads')
  }
  const approval = await ex.confirm(ctx, 'confirm', 'Read the production row counts again to compare? (This changes nothing.)')
  let comparison = null
  if (approval.ok) {
    const c = await readCounts(ctx, approval)
    if (!c.ok) problems.push('could not read the row counts after the release')
    else if (c.counts) {
      const pre = ctx.state.snapshot && ctx.state.snapshot.preCounts
      const touched = new Set((ctx.state.migrations && ctx.state.migrations.touchedTables) || [])
      comparison = lib.compareCounts(pre, c.counts, touched)
      log.say(countsTable(comparison.rows))
      for (const w of comparison.warnings) warnings.push(`${w.table}: ${w.pre} -> ${w.post} (${w.verdict === 'changed-by-migration' ? 'a database update in this release changes this table' : 'the shop kept working during the release'})`)
      for (const f of comparison.failed) problems.push(`${f.table}: ${f.pre} -> ${f.post} (${f.verdict})`)
      summary(ctx, ['### Row counts', '', '| table | before | after | verdict |', '| --- | ---: | ---: | --- |',
        ...comparison.rows.map((r) => `| ${r.table} | ${r.pre ?? '-'} | ${r.post ?? '-'} | ${r.verdict} |`)].join('\n'))
    }
  } else {
    warnings.push('row counts were not compared')
  }
  ctx.state.live = { at: new Date().toISOString(), problems, warnings, version, comparison }
  saveState(ctx)
  writeRecord(ctx, 'live-check.json', ctx.state.live)
  for (const w of warnings) log.say(`  WARNING: ${w}`)
  for (const p of problems) log.say(`  PROBLEM: ${p}`)
  summary(ctx, `### Live checks: ${problems.length ? 'PROBLEMS' : 'OK'}\n\n${[...problems.map((p) => `- PROBLEM: ${p}`), ...warnings.map((w) => `- warning: ${w}`)].join('\n')}`)
  if (problems.length) {
    log.say('The release has problems. Send the log to Claude. To undo it, choose "Undo a release" in the menu.')
    return false
  }
  log.say(ctx.dryRun ? '[dry-run] live checks printed.' : 'Live checks passed.')
  return true
}

async function stepRollback(ctx) {
  heading('Undo a release')
  ctx.ciConfirmWord = 'ROLLBACK'
  if (!releaseExists(ctx) && !ctx.fixedRelease) ctx.releaseDir = REPO_ROOT
  if (releaseExists(ctx) || ctx.dryRun) needSha(ctx)
  const snap = ctx.state.snapshot || {}
  let target = ctx.args.target
  if (!target && !ctx.dryRun && !ctx.ci) {
    log.say('  1  Put the website back to the version before the release (Worker rollback)')
    log.say('  2  Put the DATABASE back to the restore point saved before the release')
    log.say('  0  Back')
    const a = await ex.ask('Choose 1, 2 or 0: ')
    target = a === '1' ? 'worker' : a === '2' ? 'database' : ''
  }
  const targets = target ? [target] : (ctx.dryRun ? ['worker', 'database'] : [])
  let ok = true
  for (const t of targets) {
    if (t === 'worker') {
      const versionId = ctx.args.versionId || snap.previousVersionId || ''
      if (versionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(versionId)) { log.say(`STOP: ${versionId} is not a Worker version id.`); ok = false; continue }
      log.say(versionId ? `The version that was live before the release: ${versionId}` : 'No saved version; Cloudflare will go back to the previous version.')
      const approval = await ex.confirm(ctx, 'double', 'Put the website back to the version before this release?', 'ROLLBACK')
      if (!approval.ok) { log.say('Stopped. Nothing was changed.'); ok = false; continue }
      const r = await ex.runSpec(lib.commandCatalog.rollbackWorker(versionId, ctx.ci), ctx, approval)
      ok = ok && r.code === 0
      if (r.code === 0) done(ctx, 'Website rolled back.'); else log.say('Rollback FAILED. Send the log to Claude.')
    } else if (t === 'database') {
      const db = ctx.args.db || (ctx.dryRun || ctx.ci ? 'business-os' : await ex.askDefault(ctx, 'Which database (business-os or business-os-import)? ', 'business-os'))
      const bookmark = ctx.args.bookmark || (snap.bookmarks && snap.bookmarks[db]) || (ctx.dryRun ? '<bookmark from snapshot.json>' : '')
      if (!bookmark) { log.say(`STOP: no saved restore point for ${db}. Give one with -Bookmark.`); ok = false; continue }
      if (!lib.DATABASES.some((d) => d.name === db)) { log.say(`STOP: unknown database ${db}.`); ok = false; continue }
      if (!ctx.dryRun && !/^[0-9a-f-]{16,}$/i.test(bookmark)) { log.say(`STOP: ${bookmark} does not look like a restore point.`); ok = false; continue }
      log.say(`Restore point: ${bookmark}${snap.at ? ` (saved ${snap.at})` : ''}`)
      log.say('WARNING: every sale, stock change and edit made after that moment will be LOST.')
      const approval = await ex.confirm(ctx, 'double', `Put the ${db} database back to the restore point?`, db)
      if (!approval.ok) { log.say('Stopped. Nothing was changed.'); ok = false; continue }
      const r = await ex.runSpec(lib.commandCatalog.restoreDatabase(db, bookmark), ctx, approval)
      ok = ok && r.code === 0
      if (r.code === 0) done(ctx, 'Database restored.'); else log.say('Restore FAILED. Send the log to Claude.')
    } else if (t) {
      log.say(`Unknown target ${t}; use worker or database.`)
      ok = false
    }
  }
  ctx.ciConfirmWord = 'DEPLOY'
  return ok
}

async function stepExportNames(ctx) {
  heading('Export product list for official names')
  if (!ctx.recordDir) log.attach(path.join(ctx.records, 'Deploys', `${lib.todayStamp()}-session${ctx.dryRun ? '-dryrun' : ''}`), `release-${RUN_STAMP}.log`)
  const approval = await ex.confirm(ctx, 'confirm', `Download the public product list from ${ctx.site}? (Read-only; saved on this computer only.)`)
  if (!approval.ok) return false
  const items = []
  let page = 1
  let totalPages = 1
  do {
    const res = await ex.httpGet(`${ctx.site}/api/portal/catalog/products/search?page=${page}&pageSize=100`, ctx, { timeoutMs: 60000 })
    if (!res) break
    if (lib.classifyResponse(res) === 'challenge') { log.say(`Blocked by a bot challenge. ${VPN_ADVICE}`); return false }
    let json = null
    try { json = JSON.parse(res.body) } catch { /* handled below */ }
    if (!json || !Array.isArray(json.items)) { log.say(`STOP: page ${page} did not return a product list (HTTP ${res.status}).`); return false }
    items.push(...json.items)
    totalPages = Number(json.totalPages) || 1
    log.say(`  page ${page}/${totalPages}: ${json.items.length} products`)
    page += 1
  } while (page <= totalPages)
  if (ctx.dryRun) { log.say(`[dry-run] would save to ${path.join(ctx.records, 'OfficialNames', lib.todayStamp(), 'products.json')}`); return true }
  const dir = path.join(ctx.records, 'OfficialNames', lib.todayStamp())
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'products.json')
  fs.writeFileSync(file, `${JSON.stringify({ exportedAt: new Date().toISOString(), source: `${ctx.site}/api/portal/catalog/products/search`, count: items.length, items }, null, 2)}\n`)
  log.say(`Saved ${items.length} products to ${file}`)
  log.say('Note: this is the public catalogue, so products the shop hides from customers (for example out of stock, if that setting is off) are not in it.')
  return true
}

async function stepR2Steps(ctx) {
  heading('R2 image move to Asia (steps only; the kit does not run them)')
  const plan = path.join(ctx.ownerRecords, R2_PLAN_REL)
  const scripts = path.join(ctx.ownerRecords, R2_SCRIPTS_REL)
  if (!fs.existsSync(plan)) { log.say(`The plan is not on this computer (${plan}). Ask Claude for it.`); return false }
  log.say(`Plan: ${plan}`)
  for (const line of fs.readFileSync(plan, 'utf8').split(/\r?\n/)) {
    if (/^#{1,3}\s/.test(line) || /^\s*\d+\.\s/.test(line) || /^\s*-\s*\*\*Step/i.test(line)) log.say(`  ${line}`)
  }
  if (fs.existsSync(scripts)) log.say(`Scripts: ${scripts}  (${fs.readdirSync(scripts).join(', ')})`)
  log.say('Each remote step needs its own go-ahead. Do them with Claude, not from this menu.')
  return true
}

async function stepBat(ctx, name) {
  const bat = path.join(REPO_ROOT, 'run', name)
  if (name === 'verify-local.bat') {
    heading('Local check only (verify-local.bat): installs, typechecks, tests, builds; never deploys')
    const r = await ex.runLocal('cmd.exe', ['/d', '/c', bat], REPO_ROOT, ctx, { interactive: true })
    return r.code === 0
  }
  heading('Old one-click release (full-automation.bat)')
  log.say(`WARNING: this publishes whatever is in ${REPO_ROOT} right now (not the clean release folder),`)
  log.say('also pushes secrets, and takes no restore point. Prefer "FULL RELEASE" in this menu.')
  const approval = await ex.confirm(ctx, 'typeYES', 'Run the old one-click release anyway?')
  if (!approval.ok) { log.say('Stopped.'); return false }
  const saved = ctx.releaseDir
  ctx.releaseDir = REPO_ROOT
  const r = await ex.runSpec(lib.commandCatalog.fullAutomationBat(), ctx, approval)
  ctx.releaseDir = saved
  return r.code === 0
}

async function fullRelease(ctx) {
  const order = [stepNetwork, stepPrepare, stepGates, stepLogin, stepSnapshot, stepMigrations, stepDeploy, stepLive]
  for (const step of order) {
    const ok = await step(ctx)
    if (!ok) {
      log.say('')
      log.say(`The release STOPPED at "${step.name.replace(/^step/, '')}". Nothing after it was done.`)
      return false
    }
  }
  log.say('')
  done(ctx, `RELEASE DONE: ${ctx.sha.slice(0, 12)} "${ctx.subject}" is live.`)
  return true
}

const MENU = [
  ['1', 'Network check (is the VPN blocking Cloudflare?)', stepNetwork],
  ['2', 'FULL RELEASE (steps 3 to 9 in order; stops at the first problem)', fullRelease],
  ['3', 'Choose version and prepare the clean release folder', stepPrepare],
  ['4', 'Run the safety tests', stepGates],
  ['5', 'Check the Cloudflare login', stepLogin],
  ['6', 'Safety snapshot (restore point + row counts)', stepSnapshot],
  ['7', 'Database updates (migrations)', stepMigrations],
  ['8', 'Publish (deploy)', stepDeploy],
  ['9', 'Live checks', stepLive],
  ['10', 'Undo a release (rollback)', stepRollback],
  ['11', 'Export product list for official names', stepExportNames],
  ['12', 'R2 image move to Asia (show the steps)', stepR2Steps],
  ['13', 'Local check only (verify-local.bat)', (ctx) => stepBat(ctx, 'verify-local.bat')],
  ['14', 'Old one-click release (full-automation.bat, not recommended)', (ctx) => stepBat(ctx, 'full-automation.bat')],
]

const COMMANDS = {
  network: stepNetwork, release: fullRelease, prepare: stepPrepare, gates: stepGates, login: stepLogin,
  snapshot: stepSnapshot, migrations: stepMigrations, deploy: stepDeploy, live: stepLive,
  rollback: stepRollback, 'export-names': stepExportNames, 'r2-steps': stepR2Steps,
  'verify-local': (ctx) => stepBat(ctx, 'verify-local.bat'), 'full-automation': (ctx) => stepBat(ctx, 'full-automation.bat'),
}

function printMenu() {
  log.say('')
  log.say('Business OS release menu')
  for (const [key, label] of MENU) log.say(`  ${key.padStart(2)}  ${label}`)
  log.say('   0  Exit')
}

async function menu(ctx) {
  if (ctx.dryRun) {
    log.say('[dry-run] walking every menu item in order, answering every question with its default/yes')
    printMenu()
    for (const [key, label, fn] of MENU) {
      log.say('')
      log.say(`[dry-run] ----- menu item ${key}: ${label}`)
      await fn(ctx)
    }
    return true
  }
  for (;;) {
    printMenu()
    const choice = await ex.ask('Choose a number and press Enter: ')
    if (choice === '0' || choice === '') return true
    const item = MENU.find(([key]) => key === choice)
    if (!item) { log.say('Please type one of the numbers above.'); continue }
    try {
      await item[2](ctx)
    } catch (err) {
      log.say(`ERROR: ${err.message}`)
    }
    await ex.ask('\nPress Enter to go back to the menu...')
  }
}

function checkNode() {
  const major = Number(process.versions.node.split('.')[0])
  if (major < 24) {
    log.say(`WARNING: Node ${process.versions.node} is too old for the frontend (needs 24 or newer). Install Node 24 LTS.`)
    return false
  }
  return true
}

async function main() {
  const args = lib.parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 29).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
    return 0
  }
  const ctx = buildContext(args)
  log.say(`Business OS release kit  ${new Date().toISOString()}${ctx.dryRun ? '  [DRY RUN: nothing is run, every command is printed]' : ''}${ctx.ci ? '  [CI]' : ''}`)
  log.say(`Kit checkout:   ${REPO_ROOT}`)
  log.say(`Release folder: ${ctx.releaseDir}`)
  log.say(`Records:        ${ctx.records}`)
  log.say(`Credentials:    ${ctx.authNote}`)
  checkNode()
  const command = args.command || 'menu'
  let ok
  try {
    if (command === 'menu') ok = await menu(ctx)
    else if (COMMANDS[command]) ok = await COMMANDS[command](ctx)
    else throw new Error(`Unknown command "${command}". Try: ${Object.keys(COMMANDS).join(', ')}`)
  } catch (err) {
    log.say(`ERROR: ${err.message}`)
    ok = false
  }
  if (!log.file) log.attach(path.join(ctx.records, 'Deploys', `${lib.todayStamp()}-session${ctx.dryRun ? '-dryrun' : ''}`), `release-${RUN_STAMP}.log`)
  if (ctx.recordDir) saveState(ctx)
  log.say('')
  log.say(`Full log: ${log.file}`)
  log.say('Claude can read this log later; you do not need to copy anything.')
  return ok ? 0 : 1
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code })
}

module.exports = { buildContext, MENU, COMMANDS }
