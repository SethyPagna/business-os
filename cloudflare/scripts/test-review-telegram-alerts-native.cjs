'use strict'
// ============================================================================================
// REVIEW QUEUE -- ONE TELEGRAM ALERT PER REVIEW EVENT (slice C of the review-queue completion plan, 13 Oct 2026).
//
// Owner ruling (13 Oct 2026, OPUS-PLAN-REVIEW-QUEUE-COMPLETION.md section 3): a request created, approved, rejected or
// resubmitted is announced ONCE in the Alerts topic, in Khmer and English, naming accounts by USERNAME, never an amount,
// a cost, a phone, an email or the request's own summary. This file proves it against the REAL Worker.
//
// What it runs: the real cloudflare/src/index.ts (every middleware, route and lib) bundled with esbuild and executed in
// workerd under Miniflare, on a D1 migrated with every file in cloudflare/migrations, with a real session cookie per user.
// Only authentication credential entry is shortcut (the session row is inserted directly, as test-al-stock-*-native does).
// A thin wrapper entry sits in FRONT of the Worker (never inside it) that
//   (a) replaces globalThis.fetch: a call to api.telegram.org is RECORDED (method, body, whether it carried a timeout signal,
//       never the URL: the URL holds the bot token) and answered from a script (200, 429, 5xx, a thrown error, a delay);
//       any other fetch is refused. Miniflare's outboundService also refuses every outbound request, so NOTHING can leave
//       this machine, the bot token is a placeholder and the chat id is made up;
//   (b) counts D1 statements per invocation (foreground + waitUntil), the number compared with the Free 50 / Paid 1000 limits;
//   (c) holds N requests at a matching statement until all have arrived (`barrier`), so two approvals really race.
// Mutation controls (`--wrong=<name>`) rewrite SOURCE TEXT IN MEMORY at bundle time; they never touch a file on disk and fail
// loudly if their anchor text is missing. Every mutant in the list below must turn at least one case RED.
//
// Run (from cloudflare/):  node scripts/test-review-telegram-alerts-native.cjs
//   --wrong=alert-before-commit   approve announces BEFORE the write (and not after): a refused or racing approval still sends
//   --wrong=ignore-switch         telegram_reviews_enabled is never read: the alerts cannot be turned off
//   --wrong=retry-ambiguous       a thrown network error / timeout is retried too (a second copy of a maybe-delivered message)
//   --wrong=fixed-topic           the reviews topic is a number in the code, not the deployment's telegram_topic_alerts
//   --wrong=full-name-actor       the actor is the account's full name, not its username
//   --wrong=alert-on-replay       a replayed (already approved) answer announces again
//   --wrong=not-deferred          the send is awaited inside the request instead of deferred through waitUntil
//   --wrong=reject-announce-first reject announces before it knows the row was still open
//   --wrong=summary-leak          the request's raw summary (it holds amounts) is printed in the message
//   --wrong=reason-uncut          a rejection reason is not cut at 120 characters
//   --wrong=confirm-not-passed    the approve body's confirm_merge_into never reaches the applier
//   --wrong=coded-refusal-500     a ReviewCodedRefusal falls through to the generic 500
//   --wrong=refusal-any-status    any status is accepted as a coded refusal (a 418 would be sent as such)
//   --wrong=created-before-insertcreated announces before the pending row is inserted (a failed insert still sends)
//   --wrong=bidi-kept            a typed name keeps its direction-control characters
//   --wrong=targets-ignored      ?fields=targets is ignored: the full rows (payloads included) come back
//   --wrong=details-last          the refusal's details are spread after success / error / code and can overwrite them
//   --wrong=merged-ignored        outcome.mergedInto is never read: the Merged row is missing
//   --only=<ids>                  run only these case ids
// ============================================================================================
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const root = path.resolve(__dirname, '..')
const ARGS = process.argv.slice(2)
const OPTIONS = Object.fromEntries(ARGS.filter(a => a.startsWith('--') && a.includes('=')).map(a => [a.slice(2, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]))
const sha256 = text => createHash('sha256').update(text).digest('hex')

const WRAPPER = `
import worker from './src/index'
export { SyncUploadSession, BroadcastHub } from './src/index'

const control = { barrier: null, lastLog: [], lastRespondedAt: 0 }
const telegram = { calls: [], script: [] }

// Every outbound call a request makes. Telegram is recorded and scripted; anything else is refused.
globalThis.fetch = async (input, init) => {
  const url = String(typeof input === 'string' ? input : input.url)
  if (!url.startsWith('https://api.telegram.org/')) return new Response('blocked by test', { status: 599 })
  let body = null
  try { body = JSON.parse((init && init.body) || 'null') } catch (e) { /* not json */ }
  const call = { method: url.split('/').pop(), body, signal: Boolean(init && init.signal), startedAt: Date.now(), doneAt: 0 }
  telegram.calls.push(call)
  const step = telegram.script.length ? telegram.script.shift() : null
  if (step && step.delay) await new Promise(resolve => setTimeout(resolve, step.delay))
  call.doneAt = Date.now()
  if (step && step.throw) { const error = new Error(step.throw); error.name = step.name || 'TypeError'; throw error }
  if (step && step.status) return new Response(step.body || '', { status: step.status })
  return new Response(JSON.stringify({ ok: true, result: { message_id: telegram.calls.length } }), { status: 200 })
}

const rawFetch = (request, env, ctx) => worker.fetch(request, env, ctx)
function matches(pattern, sqls) { const re = new RegExp(pattern, 'i'); return sqls.some(sql => re.test(sql)) }

function wrapDb(db, counter) {
  const statement = (inner, sql) => ({
    sql, inner,
    bind: (...args) => statement(inner.bind(...args), sql),
    first: async (...a) => { await before([sql]); counter.n++; counter.log.push(sql); return inner.first(...a) },
    all: async (...a) => { await before([sql]); counter.n++; counter.log.push(sql); return inner.all(...a) },
    run: async (...a) => { await before([sql]); counter.n++; counter.log.push(sql); return inner.run(...a) },
    raw: async (...a) => { await before([sql]); counter.n++; counter.log.push(sql); return inner.raw(...a) },
  })
  return {
    prepare: (sql) => statement(db.prepare(sql), sql),
    batch: async (statements) => {
      const sqls = statements.map(s => s.sql)
      await before(sqls)
      counter.n += statements.length
      for (const sql of sqls) counter.log.push(sql)
      return db.batch(statements.map(s => s.inner))
    },
    exec: (q) => db.exec(q),
  }
}

async function before(sqls) {
  if (control.barrier && matches(control.barrier.pattern, sqls)) {
    const barrier = control.barrier
    barrier.arrived++
    if (barrier.arrived >= barrier.count) barrier.release()
    await Promise.race([barrier.promise, new Promise(resolve => setTimeout(resolve, 20000))])
  }
}

function instrument(rawEnv, ctx, counter) {
  const pending = []
  const env = { ...rawEnv, DB: wrapDb(rawEnv.DB, counter) }
  const ctx2 = { waitUntil(p) { pending.push(Promise.resolve(p).catch(() => {})); try { ctx.waitUntil(p) } catch (e) {} }, passThroughOnException() {} }
  return { env, ctx2, pending }
}

async function drain(pending) {
  for (let i = 0; i < 20; i++) { const n = pending.length; await Promise.allSettled(pending.slice()); if (pending.length === n) break }
}

async function handle(request, rawEnv, ctx) {
  const url = new URL(request.url)
  if (url.pathname.startsWith('/__al/')) return control_(url, request)
  const counter = { n: 0, log: [] }
  const { env, ctx2, pending } = instrument(rawEnv, ctx, counter)
  const response = await rawFetch(request, env, ctx2)
  // The instant the Worker's own answer was ready: a deferred alert must still be running after this.
  const respondedAt = Date.now()
  if (response.webSocket) return response
  await drain(pending)
  control.lastLog = counter.log.slice()
  const headers = new Headers(response.headers)
  headers.set('x-al-d1', String(counter.n))
  headers.set('x-rt-responded-at', String(respondedAt))
  return new Response(response.body, { status: response.status, headers })
}

async function control_(url, request) {
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {}
  switch (url.pathname) {
    case '/__al/barrier': {
      if (!body.pattern) { control.barrier = null; return Response.json({ ok: true }) }
      let release; const promise = new Promise(r => { release = r })
      control.barrier = { pattern: body.pattern, count: body.count || 2, arrived: 0, release, promise }
      return Response.json({ ok: true })
    }
    case '/__al/barrier/result': return Response.json({ arrived: control.barrier ? control.barrier.arrived : null })
    case '/__al/tg/script': telegram.script = body.steps || []; return Response.json({ ok: true })
    case '/__al/tg/reset': telegram.calls = []; telegram.script = []; return Response.json({ ok: true })
    case '/__al/tg/calls': return Response.json(telegram.calls)
    case '/__al/lastlog': return Response.json(control.lastLog)
    default: return new Response('unknown', { status: 404 })
  }
}

export default { fetch: (request, env, ctx) => handle(request, env, ctx) }
`

// In-memory source rewrites. `patches` = [{ name, file: 'src/...ts', from, to }]. Line endings are normalised first
// (the working tree may be CRLF), and a missing anchor is a hard error, never a silent no-op.
async function bundle(patches) {
  const { build } = require('esbuild')
  const applied = new Set()
  const result = await build({
    stdin: { contents: WRAPPER, resolveDir: root, loader: 'ts', sourcefile: 'rt-wrapper.ts' },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], logLevel: 'error',
    plugins: [{ name: 'rt-source-patches', setup(b) {
      b.onLoad({ filter: /[\\/]cloudflare[\\/]src[\\/].*\.ts$/ }, args => {
        const here = args.path.replaceAll('\\', '/')
        const mine = patches.filter(p => here.endsWith('/cloudflare/' + p.file))
        if (!mine.length) return undefined
        let text = fs.readFileSync(args.path, 'utf8').replace(/\r\n/g, '\n')
        for (const p of mine) {
          assert.equal(text.split(p.from).length - 1, 1, 'patch anchor must occur exactly once in ' + p.file + ': ' + p.from.slice(0, 80))
          text = text.replace(p.from, () => p.to)
          applied.add(p.name)
        }
        return { contents: text, loader: 'ts' }
      })
    } }],
  })
  for (const p of patches) assert.ok(applied.has(p.name), 'patch ' + p.name + ' was not applied')
  return result.outputFiles[0].text
}

async function migrate(db) {
  const { unstable_splitSqlQuery: split } = require('wrangler')
  const dir = path.join(root, 'migrations')
  const statements = []
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) {
    for (const statement of split(fs.readFileSync(path.join(dir, name), 'utf8')).filter(s => s.trim())) {
      // Miniflare's test D1 caps compound SELECT terms lower than the deployed runner; this one seed statement is a
      // no-op on an empty users table (same exemption test-al-stock-*-native.cjs makes).
      if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(statement.trim())) continue
      statements.push({ name, statement })
    }
  }
  for (let i = 0; i < statements.length; i += 100) {
    const chunk = statements.slice(i, i + 100)
    try { await db.batch(chunk.map(x => db.prepare(x.statement))) } catch (error) { error.message = chunk[0].name + '+: ' + error.message; throw error }
  }
}

const CHAT = '-1001111111111'   // made up
const TOPIC = 777

async function world({ patches = [] } = {}) {
  const { Miniflare, Log, LogLevel } = require('miniflare')
  const script = await bundle(patches)
  const mf = new Miniflare({
    modules: true, script, compatibilityDate: '2026-07-01', compatibilityFlags: ['nodejs_compat', 'no_handle_cross_request_promise_resolution'],
    d1Databases: ['DB'], kvNamespaces: ['CACHE'], r2Buckets: ['ASSETS'],
    durableObjects: { BROADCAST_HUB: 'BroadcastHub', SYNC_UPLOADS: 'SyncUploadSession' },
    bindings: { PLAN_TIER: 'paid', BUSINESS_OS_PUBLIC_URL: 'https://leangbeauty.com', BUSINESS_OS_ADMIN_URL: 'https://admin.leangbeauty.com',
      BUSINESS_OS_ADMIN_PASSWORD: 'rt-repro-admin-password-1', BUSINESS_OS_ORGANIZATION_SLUG: 'leangbeauty',
      TELEGRAM_BOT_TOKEN: 'test-token-not-a-real-one' },
    // A second wall: even if the fetch replacement above were bypassed, nothing leaves this machine.
    outboundService: () => new Response('External network refused by local fixture', { status: 503 }),
    log: new Log(LogLevel.ERROR),
  })
  const db = await mf.getD1Database('DB')
  await migrate(db)
  // First request: the Worker seeds its default organization / branches / roles / admin (once per isolate).
  await mf.dispatchFetch('http://localhost/api/settings')
  await db.batch([
    db.prepare("UPDATE branches SET is_active=0,is_default=0,name='Old Shop',role='shop',canonical_key='shop',successor_branch_id=1 WHERE id=2"),
    db.prepare("UPDATE branches SET name='LC Store',role='warehouse',canonical_key='warehouse',is_default=1,is_active=1 WHERE id=1"),
  ])
  const H = { mf, db, tokens: {} }

  H.addUser = async (id, username, permissions, extra = {}) => {
    await db.prepare(`INSERT INTO users(id,username,name,password,role_id,permissions,is_active,organization_id,organization_group_id)
      VALUES(?,?,?,?,?,?,1,2,2)`).bind(id, username, extra.name || username, 'x', extra.role_id ?? null, JSON.stringify(permissions)).run()
    const token = 'tok-' + username + '-' + sha256(username + id).slice(0, 8)
    H.tokens[username] = token
    await db.prepare(`INSERT INTO user_sessions(user_id,token_hash,device_name,device_tz,expires_at,last_seen_at)
      VALUES(?,?,?,?,'2099-01-01T00:00:00.000Z',datetime('now'))`).bind(id, sha256(token), 'Test Device', 'Asia/Phnom_Penh').run()
  }
  const adminToken = 'tok-admin-' + sha256('admin1').slice(0, 8)
  H.tokens.admin = adminToken
  await db.prepare(`INSERT INTO user_sessions(user_id,token_hash,device_name,device_tz,expires_at,last_seen_at)
    VALUES(1,?,?,?,'2099-01-01T00:00:00.000Z',datetime('now'))`).bind(sha256(adminToken), 'Owner Laptop', 'Asia/Phnom_Penh').run()

  H.api = async (method, route, body, { as = 'admin', headers = {} } = {}) => {
    const response = await mf.dispatchFetch('http://localhost' + route, {
      method, headers: { 'content-type': 'application/json', cookie: 'bos_session=' + H.tokens[as], ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    let json; try { json = JSON.parse(text) } catch { json = text }
    return { status: response.status, body: json, d1: Number(response.headers.get('x-al-d1') || 0), respondedAt: Number(response.headers.get('x-rt-responded-at') || 0) }
  }
  H.control = async (route, body) => (await mf.dispatchFetch('http://localhost/__al/' + route, { method: 'POST', body: JSON.stringify(body || {}) })).json()
  H.controlGet = async route => (await mf.dispatchFetch('http://localhost/__al/' + route)).json()
  H.q = async (sql, ...bind) => (await db.prepare(sql).bind(...bind).all()).results
  H.q1 = async (sql, ...bind) => (await db.prepare(sql).bind(...bind).first())
  H.setting = async (key, value) => {
    if (value === null) await db.prepare('DELETE FROM settings WHERE key = ?').bind(key).run()
    else await db.prepare("INSERT INTO settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key, value).run()
  }
  // The Telegram fake.
  H.tg = {
    reset: () => H.control('tg/reset'),
    script: steps => H.control('tg/script', { steps }),
    calls: () => H.controlGet('tg/calls'),
    texts: async () => (await H.controlGet('tg/calls')).map(call => call.body && call.body.text),
  }
  H.lastLog = () => H.controlGet('lastlog')
  H.dispose = async () => { await mf.dispose() }
  return H
}

// ------------------------------------------------------------------------------------------------
// Reporting: a case collects every violated invariant (soft assertions) and is RED if there is any.
// ------------------------------------------------------------------------------------------------
const results = []
function caseRun(id, title, severity) {
  const misses = []
  const notes = []
  const t = {
    eq(label, actual, expected) {
      const a = JSON.stringify(actual), e = JSON.stringify(expected)
      if (a !== e) misses.push(label + ': expected ' + e + ' but actual ' + a)
    },
    ok(label, condition, detail) { if (!condition) misses.push(label + (detail === undefined ? '' : ': ' + JSON.stringify(detail))) },
    note(text) { notes.push(text) },
  }
  return { t, misses, notes, id, title, severity }
}
async function check(id, title, severity, fn) {
  if (OPTIONS.only && !OPTIONS.only.split(',').includes(id)) return
  const c = caseRun(id, title, severity)
  try { await fn(c.t) } catch (error) { c.misses.push('THREW ' + (error && error.stack ? error.stack.split('\n').slice(0, 4).join(' | ') : String(error))) }
  const red = c.misses.length > 0
  results.push({ id, title, severity, red, misses: c.misses, notes: c.notes })
  console.log((red ? 'RED   ' : 'GREEN ') + id + '  [' + severity + ']  ' + title)
  for (const m of c.misses) console.log('        - ' + m)
  for (const n of c.notes) console.log('        . ' + n)
}
function finish(subject) {
  const red = results.filter(r => r.red)
  console.log('\nSUMMARY ' + subject + ': ' + (results.length - red.length) + ' GREEN, ' + red.length + ' RED' + (red.length ? ' -> ' + red.map(r => r.id).join(', ') : ''))
  if (red.length) process.exitCode = 1
}

// ------------------------------------------------------------------------------------------------
// The mutants: plausible WRONG implementations, each a source rewrite that must turn a case RED.
// ------------------------------------------------------------------------------------------------
const QUEUE = 'src/routes/reviewQueue.ts'
const GATE = 'src/lib/reviewGate.ts'
const TELEGRAM = 'src/lib/telegram.ts'
const ALERT = 'src/lib/reviewAlert.ts'
const APPROVED_ANNOUNCE = "  await announceReview(c.env, {\n    kind: 'approved', row: updatedRow ?? row, by: actorSnapshot(user), recordName: recordNameBefore,\n    merged: mergedInto ? { retired: mergedInto.mergedName, kept: mergedInto.survivorName } : null,\n  })\n"
const APPLY_CALL = '    const outcome = await applyApprovedPendingAction('
const PATCHES = {
  'alert-before-commit': [
    { name: 'announce-first', file: QUEUE, from: APPLY_CALL,
      to: "    await announceReview(c.env, { kind: 'approved', row, by: actorSnapshot(user), recordName: recordNameBefore })\n" + APPLY_CALL },
    { name: 'drop-the-late-one', file: QUEUE, from: APPROVED_ANNOUNCE, to: '' },
  ],
  'ignore-switch': [
    { name: 'ignore-switch', file: TELEGRAM, from: 'reviews: isEnabled(values.telegram_reviews_enabled, true),', to: 'reviews: true,' },
  ],
  'retry-ambiguous': [
    { name: 'retry-ambiguous', file: TELEGRAM,
      from: '      const answered = await sendTelegramApi(config, chatId, part, thread, timeoutMs)',
      to: '      const answered = await sendTelegramApi(config, chatId, part, thread, timeoutMs).catch(() => sendTelegramApi(config, chatId, part, thread, timeoutMs))' },
  ],
  'fixed-topic': [
    { name: 'fixed-topic', file: TELEGRAM, from: 'config.chatId, config.topics[eventTopic[event.type]], eventTopic[event.type], options)',
      to: "config.chatId, (event.type === 'reviews' ? 4242 : config.topics[eventTopic[event.type]]), eventTopic[event.type], options)" },
  ],
  'full-name-actor': [
    { name: 'created-name', file: GATE, from: '  const requestedByName = actorSnapshot(user)\n', to: '  const requestedByName = (user as { name?: string | null })?.name ?? actorSnapshot(user)\n' },
    { name: 'approved-by', file: QUEUE, from: "kind: 'approved', row: updatedRow ?? row, by: actorSnapshot(user)", to: "kind: 'approved', row: updatedRow ?? row, by: (user as { name?: string }).name" },
    { name: 'rejected-by', file: QUEUE, from: "kind: 'rejected', row, by: actorSnapshot(user), reason", to: "kind: 'rejected', row, by: (user as { name?: string }).name, reason" },
  ],
  'alert-on-replay': [
    { name: 'branch-replay', file: QUEUE, from: "          if (receipt) return c.json({ success: true, data: receipt, replayed: true })",
      to: "          if (receipt) { await announceReview(c.env, { kind: 'approved', row, by: actorSnapshot(user) }); return c.json({ success: true, data: receipt, replayed: true }) }" },
    { name: 'already-reviewed', file: QUEUE, from: "      return c.json({ error: 'Already reviewed' }, 409)",
      to: "      await announceReview(c.env, { kind: 'approved', row, by: actorSnapshot(user) })\n      return c.json({ error: 'Already reviewed' }, 409)" },
    { name: 'removal-replay', file: QUEUE, from: "        return c.json({ success: true, data: row, replayed: true })",
      to: "        await announceReview(c.env, { kind: 'approved', row, by: actorSnapshot(user) })\n        return c.json({ success: true, data: row, replayed: true })" },
  ],
  'not-deferred': [
    { name: 'not-deferred', file: ALERT, from: '  return deferRequestWork(() => runBackground(env, \'review-alert\', () => sendReviewAlert(env, event)))',
      to: '  await runBackground(env, \'review-alert\', () => sendReviewAlert(env, event))' },
    { name: 'async', file: ALERT, from: 'export function announceReviewEvent(env: Env, event: ReviewAlertEvent): Promise<void> {', to: 'export async function announceReviewEvent(env: Env, event: ReviewAlertEvent): Promise<void> {' },
  ],
  'reject-announce-first': [
    { name: 'reject-announce-first', file: QUEUE,
      from: "  const ok = await markPendingActionRejected(c.env, id, {",
      to: "  { const early = await getPendingAction(c.env, id); if (early) await announceReview(c.env, { kind: 'rejected', row: early, by: actorSnapshot(user), reason }) }\n  const ok = await markPendingActionRejected(c.env, id, {" },
    { name: 'reject-drop-late', file: QUEUE, from: "  if (row) await announceReview(c.env, { kind: 'rejected', row, by: actorSnapshot(user), reason })\n", to: '' },
  ],
  'summary-leak': [
    { name: 'summary-leak', file: ALERT, from: "  const lines = [`Request: ${phrase}${recordName ? `${REVIEW_REQUEST_SEPARATOR}${recordName}` : ''}`]",
      to: "  const lines = [`Request: ${phrase}${recordName ? `${REVIEW_REQUEST_SEPARATOR}${recordName}` : ''}`, `Note: ${(event.row as { summary?: string }).summary ?? ''}`]" },
    { name: 'summary-in-row', file: ALERT, from: "export type ReviewAlertRow = Pick<PendingActionRow, 'section'", to: "export type ReviewAlertRow = Pick<PendingActionRow, 'summary' | 'section'" },
    { name: 'summary-created', file: GATE, from: "payload_json: JSON.stringify(input.payload ?? {}), requested_by_name: requestedByName,", to: "payload_json: JSON.stringify(input.payload ?? {}), requested_by_name: requestedByName, summary: input.summary ?? null," },
  ],
  'reason-uncut': [
    { name: 'reason-uncut', file: ALERT, from: 'return characters.length <= REVIEW_REASON_ALERT_MAX ? text :', to: 'return characters.length <= 100000 ? text :' },
  ],
  // The contracts slice A relies on this route for.
  'confirm-not-passed': [
    { name: 'confirm-not-passed', file: QUEUE, from: '      ...(confirmMergeInto !== undefined ? { confirmMergeInto } : {}),\n', to: '' },
  ],
  'coded-refusal-500': [
    { name: 'coded-refusal-500', file: QUEUE, from: '    const coded = reviewCodedRefusal(err)\n    if (coded) return c.json(coded.body, coded.status)\n', to: '' },
  ],
  'merged-ignored': [
    { name: 'merged-ignored', file: QUEUE, from: '    merged: mergedInto ? { retired: mergedInto.mergedName, kept: mergedInto.survivorName } : null,\n', to: '    merged: null,\n' },
  ],
  'details-last': [
    { name: 'details-last', file: QUEUE, from: '  return { body: { ...extra, success: false, error: err.message, code }, status }', to: '  return { body: { success: false, error: err.message, code, ...extra }, status }' },
  ],
  'created-before-insert': [
    { name: 'created-announce-first', file: GATE, from: '  const pendingId = await createPendingAction(env, {\n',
      to: '  try { await reviewAlertHook()?.announce(env, { kind: \'created\', row: { section, action_type: input.actionType, entity_type: input.entityType, entity_id: input.entityId ?? null, payload_json: JSON.stringify(input.payload ?? {}), requested_by_name: requestedByName } }) } catch {}\n  const pendingId = await createPendingAction(env, {\n' },
    { name: 'created-drop-late', file: GATE, from: '  try {\n    await reviewAlertHook()?.announce(env, {\n      kind: \'created\',\n',
      to: '  try {\n    if (false) await reviewAlertHook()?.announce(env, {\n      kind: \'created\',\n' },
  ],
  'bidi-kept': [
    { name: 'bidi-kept', file: ALERT, from: "return String(value ?? '').replace(BIDI_CONTROLS, '').replace(", to: "return String(value ?? '').replace(" },
  ],
  'targets-ignored': [
    { name: 'targets-all', file: QUEUE, from: '  const options = { status, section }\n  const rows = fields === \'targets\' ? await listPendingActionTargets(c.env, options) : await listPendingActions(c.env, options)',
      to: '  const options = { status, section }\n  const rows = await listPendingActions(c.env, options)' },
    { name: 'targets-mine', file: QUEUE, from: '  const options = { status, requestedBy: Number(user.id) }\n  const rows = fields === \'targets\' ? await listPendingActionTargets(c.env, options) : await listPendingActions(c.env, options)',
      to: '  const options = { status, requestedBy: Number(user.id) }\n  const rows = await listPendingActions(c.env, options)' },
  ],
  'refusal-any-status': [
    { name: 'refusal-any-status', file: QUEUE, from: '  if (status !== 403 && status !== 409 && status !== 503) return null\n', to: '' },
  ],
}
const WRONG = OPTIONS.wrong || ''
if (WRONG && !PATCHES[WRONG]) { console.error('unknown --wrong=' + WRONG + '; known: ' + Object.keys(PATCHES).join(', ')); process.exit(2) }

// Test-only fixtures (NOT mutants; applied in every run). Slice A's approval will (1) report the merge it performed as
// `outcome.mergedInto`, (2) read the survivor the reviewer confirmed as `reviewer.confirmMergeInto` and (3) raise
// 'ReviewCodedRefusal' errors. None of that exists in today's appliers, so two fixtures stand in for it:
//   * a product edit whose name carries the marker [merged-fixture] reports a merge into "Rice 5kg" (retired "Rice 1kg");
//   * the stock-reasons applier records the confirmMergeInto it was handed (settings key rt_confirm_seen) and, for a reason
//     labelled [refuse:<status>:<code>[:variant]], throws an error shaped like slice A's refusal.
const FIXTURE_PATCHES = [
  { name: 'merged-fixture', file: 'src/lib/reviewApply.ts',
    from: "  await notify(env, waitUntil, 'products', { action: 'update', id })\n})",
    to: "  await notify(env, waitUntil, 'products', { action: 'update', id })\n  if (String(body.name || '').includes('[merged-fixture]')) return { pendingActionMarkedAtomically: false, mergedInto: { survivorId: 9, survivorName: 'Rice 5kg', mergedName: 'Rice 1kg' } } as never\n})" },
  { name: 'contract-fixture', file: 'src/lib/reviewApply.ts',
    from: '  const items = Array.isArray(payload.items) ? payload.items : []\n',
    to: [
      '  const items = Array.isArray(payload.items) ? payload.items : []',
      '  {',
      '    const seen = (reviewer as { confirmMergeInto?: number }).confirmMergeInto',
      `    await getDb(env).prepare("INSERT INTO settings(key,value,updated_at) VALUES('rt_confirm_seen',@v,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run({ v: String(seen) })`,
      "    const refuse = items.map((item) => String((item as { label?: unknown })?.label ?? '')).find((label) => label.startsWith('[refuse:'))",
      '    if (refuse) {',
      "      const [, status, code, variant] = refuse.replace(']', '').split(':')",
      "      throw Object.assign(new Error('Fixture refusal ' + code), {",
      "        name: variant === 'othername' ? 'SomethingElse' : 'ReviewCodedRefusal', code: variant === 'nocode' ? '' : code, status: Number(status),",
      "        details: variant === 'clash'",
      "          ? { success: true, error: 'forged', code: 'forged', permission: 'products:merge_duplicates', preview: { survivorId: 9, survivorName: 'Rice 5kg' } }",
      "          : { permission: 'products:merge_duplicates', preview: { survivorId: 9, survivorName: 'Rice 5kg' } },",
      '      })',
      '    }',
      '  }',
      ''].join('\n') },
]

// ------------------------------------------------------------------------------------------------
// The pure half: the composed rows, the deferral primitive and the static guarantees (no Worker needed).
// ------------------------------------------------------------------------------------------------
async function pureModules() {
  const { build } = require('esbuild')
  const bundleResult = await build({
    stdin: { contents: "export * from './src/lib/reviewAlert'; export * from './src/lib/requestDefer'; export { TELEGRAM_HEADINGS, TELEGRAM_REVIEW_REQUEST_PHRASES } from './src/lib/telegramLang'", resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022', logLevel: 'error',
  })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', bundleResult.outputFiles[0].text)(mod, mod.exports, require)
  return mod.exports
}
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n')

// ------------------------------------------------------------------------------------------------
const FULL_REVIEWER = { review: true, products: true, fees: true, branches: true, inventory: true }
let seq = 0
const alertSql = sql => /FROM settings WHERE key IN \((\?,){25,}/.test(sql) || /^\s*SELECT (name FROM (products|branches) WHERE id|COALESCE\(NULLIF\(trim\(label\))/.test(sql)
const statementsOf = async H => { const log = await H.lastLog(); return { total: log.length, alert: log.filter(alertSql).length } }

// The database assigns the ids: a product the Worker creates (an approved create) takes the next id after the highest, so a
// hand-picked id would collide with it later.
async function seedFee(H, label, { amount = 12.35 } = {}) {
  const r = await H.db.prepare("INSERT INTO fees(fee_type,label,amount_usd,amount_khr,fee_date,updated_at) VALUES(?,?,?,0,'2026-10-09','2026-10-09 08:00:00')").bind('rent', label, amount).run()
  return r.meta.last_row_id
}
async function seedProduct(H, name, { barcode } = {}) {
  const code = barcode || '88500' + String(900000000 + (++seq))
  const r = await H.db.prepare('INSERT INTO products(name,barcode,cost_price_usd,cost_price_khr,stock_quantity,is_active,created_at,updated_at) VALUES(?,?,2.5,0,0,1,?,?)')
    .bind(name, code, '2026-01-01 00:00:00', '2026-01-01 00:00:00').run()
  return r.meta.last_row_id
}
const pendingOf = (H, id) => H.q1('SELECT * FROM pending_actions WHERE id = ?', id)
const only = (calls, t, label) => {
  t.eq(label + ': exactly one Telegram call', calls.length, 1)
  t.ok(label + ': plain text, no parse_mode', !(calls[0] && 'parse_mode' in calls[0].body), calls[0] && Object.keys(calls[0].body))
  return calls[0]
}
const lines = call => String(call && call.body && call.body.text || '').split('\n')

async function main() {
  // ---- pure checks ------------------------------------------------------------------------
  const lib = await pureModules()

  await check('P1', 'the message: heading and at most four rows, in order, usernames only, reason cut at 120', 'high', async t => {
    const row = (extra = {}) => ({ section: 'products', action_type: 'update', entity_type: 'product', entity_id: 5, payload_json: '{}', requested_by_name: 'sokha', ...extra })
    const approvedMerge = lib.formatReviewAlert({ kind: 'approved', row: row(), by: 'dara', merged: { retired: 'Rice 1kg', kept: 'Rice 5kg' } }, 'Rice 5kg')
    t.eq('approved merge', approvedMerge, { heading: '✅ Review approved', lines: ['Request: Edit product · Rice 5kg', 'Merged: Rice 1kg → Rice 5kg', 'Requested by: sokha', 'By: dara'] })
    const rejected = lib.formatReviewAlert({ kind: 'rejected', row: row({ section: 'fees', action_type: 'delete', entity_type: 'fee' }), by: 'dara', reason: 'duplicate of the 9 Oct entry' }, 'Rent')
    t.eq('rejected', rejected, { heading: '❌ Review rejected', lines: ['Request: Delete expense · Rent', 'Reason: duplicate of the 9 Oct entry', 'Requested by: sokha', 'By: dara'] })
    t.eq('created', lib.formatReviewAlert({ kind: 'created', row: row({ section: 'products', action_type: 'create', entity_type: 'product' }) }, 'Lip Tint 05'),
      { heading: '🕒 Review requested', lines: ['Request: New product · Lip Tint 05', 'Requested by: sokha'] })
    t.eq('resubmitted', lib.formatReviewAlert({ kind: 'resubmitted', row: row({ section: 'branches', action_type: 'update', entity_type: 'branch' }) }, 'LC Store'),
      { heading: '🔁 Review resubmitted', lines: ['Request: Edit branch · LC Store', 'Requested by: sokha'] })
    t.eq('a stock-reasons request has no record name', lib.formatReviewAlert({ kind: 'created', row: row({ section: 'inventory', action_type: 'update', entity_type: 'inventory_reason' }) }, null).lines[0], 'Request: Edit stock reasons')
    // No more than four rows under any heading, whatever the event carries.
    for (const kind of ['created', 'approved', 'rejected', 'resubmitted']) {
      const m = lib.formatReviewAlert({ kind, row: row(), by: 'dara', reason: 'x', merged: { retired: 'a', kept: 'b' } }, 'n')
      t.ok(kind + ': at most four rows', m.lines.length <= 4, m.lines)
      t.ok(kind + ': the heading is a bilingual heading', Object.prototype.hasOwnProperty.call(lib.TELEGRAM_HEADINGS, m.heading), m.heading)
    }
    t.eq('a Merged row only on an approval', lib.formatReviewAlert({ kind: 'rejected', row: row(), by: 'd', merged: { retired: 'a', kept: 'b' } }, 'n').lines.some(l => l.startsWith('Merged')), false)
    t.eq('a Reason row only on a rejection', lib.formatReviewAlert({ kind: 'approved', row: row(), by: 'd', reason: 'why' }, 'n').lines.some(l => l.startsWith('Reason')), false)
    t.eq('"By" only on a decision', lib.formatReviewAlert({ kind: 'created', row: row() }, 'n').lines.some(l => l.startsWith('By')), false)
    t.eq('an unknown request kind is skipped', lib.formatReviewAlert({ kind: 'created', row: row({ section: 'contacts', action_type: 'update', entity_type: 'contact' }) }, 'n'), null)
    // A missing name is a missing row, never a blank one.
    t.eq('no requester name: no row', lib.formatReviewAlert({ kind: 'created', row: row({ requested_by_name: null }) }, 'n').lines, ['Request: Edit product · n'])
    // The reason: 120 characters at most, one line, an ellipsis in the last place when cut; Khmer is cut on a character.
    const long = 'x'.repeat(300)
    t.eq('a long reason is cut at 120', Array.from(lib.reviewAlertReason(long)).length, 120)
    t.ok('and says so', lib.reviewAlertReason(long).endsWith('…'))
    t.eq('exactly 120 is whole', lib.reviewAlertReason('y'.repeat(120)), 'y'.repeat(120))
    t.eq('newlines and control characters become single spaces', lib.reviewAlertReason('line one\n\nline\ttwo\u0001'), 'line one line two')
    const khmer = lib.reviewAlertReason('ស្រី'.repeat(80))
    t.ok('a Khmer reason is cut at 120 characters', Array.from(khmer).length <= 120, Array.from(khmer).length)
    t.ok('and never ends on a bare coeng', !/្…?$/.test(khmer))
    t.eq('a blank reason is no row', lib.reviewAlertReason('   '), null)
    t.eq('a name is one line of at most 80', Array.from(lib.reviewAlertName('n'.repeat(200) + '\nsecond')).length, 80)
    // Direction controls would let a typed name reorder the row around it; all of them go, other text (Khmer, a zero-width space) stays.
    const bidi = ['\u061c', '\u200e', '\u200f', '\u202a', '\u202b', '\u202c', '\u202d', '\u202e', '\u2066', '\u2067', '\u2068', '\u2069']
    for (const mark of bidi) {
      t.eq('name: U+' + mark.charCodeAt(0).toString(16) + ' is dropped', lib.reviewAlertName('Lip' + mark + 'Tint'), 'LipTint')
      t.eq('reason: U+' + mark.charCodeAt(0).toString(16) + ' is dropped', lib.reviewAlertReason('dup' + mark + 'licate'), 'duplicate')
    }
    t.eq('a name made only of direction controls is no name', lib.reviewAlertName('\u202e\u2066'), null)
    t.eq('Khmer with a zero-width space is kept whole', lib.reviewAlertName('ស្រី\u200bស្អាត'), 'ស្រី\u200bស្អាត')
    const flipped = lib.formatReviewAlert({ kind: 'created', row: row({ requested_by_name: 'so\u202ekha' }) }, lib.reviewAlertName('Tint\u202e'))
    t.eq('no direction control reaches any row', flipped.lines.filter(line => /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(line)), [])
  })

  await check('P2', 'requestDefer: deferred inside a request scope, awaited outside one, never rejects', 'high', async t => {
    const order = []
    const waiting = []
    // No scope: the work has finished when the call returns.
    await lib.deferRequestWork(async () => { await new Promise(r => setTimeout(r, 10)); order.push('no-scope work') })
    t.eq('no scope: awaited', order, ['no-scope work'])
    t.eq('no scope reported', lib.hasRequestDefer(), false)
    // A scope: the call returns before the work, and the work was handed to waitUntil.
    order.length = 0
    await lib.runWithRequestDefer(p => waiting.push(p), async () => {
      t.eq('scope reported', lib.hasRequestDefer(), true)
      await lib.deferRequestWork(async () => { await new Promise(r => setTimeout(r, 30)); order.push('deferred work') })
      order.push('returned')
    })
    t.eq('scope: returned first', order, ['returned'])
    t.eq('scope: one promise handed to waitUntil', waiting.length, 1)
    await waiting[0]
    t.eq('scope: the work ran', order, ['returned', 'deferred work'])
    // The scope follows the promise chain.
    waiting.length = 0
    await lib.runWithRequestDefer(p => waiting.push(p), async () => { await Promise.resolve(); await new Promise(r => setTimeout(r, 5)); await lib.deferRequestWork(async () => {}) })
    t.eq('scope survives awaits', waiting.length, 1)
    // A failing job never rejects and never throws out of waitUntil.
    const realWarn = console.warn; console.warn = () => {}
    try {
      await lib.deferRequestWork(async () => { throw new Error('boom') })
      waiting.length = 0
      await lib.runWithRequestDefer(p => waiting.push(p), async () => { await lib.deferRequestWork(async () => { throw new Error('boom') }) })
      await waiting[0]
      await lib.runWithRequestDefer(() => { throw new Error('waitUntil refused') }, async () => { await lib.deferRequestWork(async () => { order.push('fallback awaited') }) })
    } finally { console.warn = realWarn }
    t.ok('a refusing waitUntil falls back to awaiting', order.includes('fallback awaited'))
  })

  await check('P3', 'static: hook wiring, no ids in the alert code, every applier is mapped or listed as never approvable', 'high', async t => {
    const key = "Symbol.for('business-os.review-alert.v1')"
    t.ok('reviewGate reads the hook key', read(GATE).includes(key))
    t.ok('reviewQueue reads the hook key', read(QUEUE).includes(key))
    t.ok('reviewAlert defines the same key', read(ALERT).includes("export const REVIEW_ALERT_HOOK_KEY = 'business-os.review-alert.v1'"))
    t.ok('index.ts installs the alerts', /^installReviewAlerts\(\)$/m.test(read('src/index.ts')))
    t.ok('index.ts registers the request scope', read('src/index.ts').includes('runWithRequestDefer(waitUntil'))
    // The two route files must not import the alert module (they are loaded in isolation by many tests); a type import is erased.
    for (const rel of [GATE, QUEUE]) {
      t.ok(rel + ' has no value import of reviewAlert', !/^import (?!type )[^\n]*['"][./]+\/?(lib\/)?reviewAlert['"]/m.test(read(rel)), rel)
      t.ok(rel + ' has no value import of requestDefer', !/^import (?!type )[^\n]*requestDefer['"]/m.test(read(rel)), rel)
    }
    // No chat id, topic number or token in the alert code: they come from this deployment's own settings.
    const alertSource = read(ALERT).replace(/\/\/[^\n]*/g, '')
    t.ok('no numeric id literal in reviewAlert.ts', !/(?<![\w.])-?\d{5,}(?![\w.])/.test(alertSource.replace(/'business-os\.review-alert\.v1'/g, '')), alertSource.match(/-?\d{5,}/g))
    t.ok('no chat_id / message_thread_id / token in reviewAlert.ts', !/chat_id|message_thread_id|TELEGRAM_BOT_TOKEN|api\.telegram\.org/.test(alertSource))
    // Every registered applier is a phrase we send, or one that approval refuses outright.
    const appliers = [...read('src/lib/reviewApply.ts').matchAll(/registerApplier\('([a-z_]+)', '([a-z_]+)', '([a-z_]+)'/g)].map(m => m.slice(1, 4).join(':'))
    const NEVER_APPROVABLE = ['branches:create:branch', 'branches:delete:branch']
    t.ok('found the appliers', appliers.length >= 8, appliers)
    for (const applier of appliers) t.ok('applier ' + applier + ' has a request phrase or is never approvable', lib.REVIEW_ALERT_REQUEST_KEYS.includes(applier) || NEVER_APPROVABLE.includes(applier), applier)
    for (const mapped of lib.REVIEW_ALERT_REQUEST_KEYS) t.ok('phrase key ' + mapped + ' is a real applier', appliers.includes(mapped), mapped)
    t.eq('six phrases, as the plan lists them', lib.REVIEW_ALERT_REQUEST_KEYS.length, 6)
  })

  // ---- the Worker --------------------------------------------------------------------------
  const H = await world({ patches: [...FIXTURE_PATCHES, ...(WRONG ? PATCHES[WRONG] : [])] })
  try {
    await H.addUser(21, 'sokha', { fees: 'review', products: 'review', branches: 'review', inventory: 'review' }, { name: 'Sok Dara Longname' })
    await H.addUser(22, 'dara', FULL_REVIEWER, { name: 'Dara Reviewer Fullname' })
    await H.addUser(23, 'vanna', FULL_REVIEWER, { name: 'Vanna Second Reviewer' })
    await H.addUser(24, 'viewer', { review: 'view', fees: true }, { name: 'View Only Person' })
    await H.addUser(25, 'selfie', { review: true, fees: 'review' }, { name: 'Self Approver Person' })
    await H.addUser(26, 'plain', { fees: true }, { name: 'Plain Employee' })
    await H.setting('telegram_chat_id', CHAT)
    await H.setting('telegram_topic_alerts', String(TOPIC))
    await H.tg.reset()

    const queueFeeDelete = async (label, { as = 'sokha' } = {}) => {
      const fee = await seedFee(H, label)
      const r = await H.api('DELETE', '/api/fees/' + fee, {}, { as })
      return { fee, ...r, pendingId: r.body && r.body.pendingActionId }
    }
    const reset = () => H.tg.reset()

    // ---------------------------------------------------------------------------------------
    await check('C1', 'created: each kind of request sends exactly one message to the Alerts topic, in both languages, naming the username', 'high', async t => {
      await reset()
      // an expense delete
      const fee = await queueFeeDelete('Shop rent Oct')
      t.eq('fee delete queued', fee.status, 202)
      let call = only(await H.tg.calls(), t, 'fee delete')
      t.eq('chat is this deployment\'s', call && call.body.chat_id, CHAT)
      t.eq('topic is this deployment\'s telegram_topic_alerts', call && call.body.message_thread_id, TOPIC)
      t.eq('fee delete text', lines(call), [
        '🕒 Review requested/សំណើរង់ចាំការត្រួតពិនិត្យ',
        '· Request/សំណើ: Delete expense/លុបចំណាយ · Shop rent Oct',
        '· Requested by/បានស្នើសុំដោយ: sokha',
      ])
      // a new product
      await reset()
      const created = await H.api('POST', '/api/products', { name: 'Lip_Tint *05* [new]', barcode: '8850000000905', selling_price_usd: 4.5 }, { as: 'sokha' })
      t.eq('product create queued', created.status, 202)
      call = only(await H.tg.calls(), t, 'product create')
      t.eq('product create text', lines(call), [
        '🕒 Review requested/សំណើរង់ចាំការត្រួតពិនិត្យ',
        '· Request/សំណើ: New product/ផលិតផលថ្មី · Lip_Tint *05* [new]',   // markup characters in a name arrive as typed: plain text, no parse_mode
        '· Requested by/បានស្នើសុំដោយ: sokha',
      ])
      // a product edit: the name is the product's CURRENT name, not the new one
      await reset()
      const product = await seedProduct(H, 'Cleanser 100ml')
      const edited = await H.api('PUT', '/api/products/' + product, { name: 'Cleanser 100ml', selling_price_usd: 6 }, { as: 'sokha' })
      t.eq('product edit queued', edited.status, 202)
      call = only(await H.tg.calls(), t, 'product edit')
      t.eq('product edit text', lines(call).slice(1), ['· Request/សំណើ: Edit product/កែប្រែផលិតផល · Cleanser 100ml', '· Requested by/បានស្នើសុំដោយ: sokha'])
      // the saved stock-reasons list
      await reset()
      const reasons = await H.api('PUT', '/api/inventory/reasons', { items: [{ type: 'adjust', label: 'Damaged' }, { type: 'adjust', label: 'Expired' }] }, { as: 'sokha' })
      t.eq('stock reasons queued', reasons.status, 202)
      call = only(await H.tg.calls(), t, 'stock reasons')
      t.eq('stock reasons text', lines(call).slice(1), ['· Request/សំណើ: Edit stock reasons/កែប្រែមូលហេតុស្តុក', '· Requested by/បានស្នើសុំដោយ: sokha'])
      // a branch edit
      await reset()
      const branches = (await H.api('GET', '/api/branches')).body
      const branch = branches.find(b => Number(b.id) === 1)
      const branchEdit = await H.api('PUT', '/api/branches/1', { address: 'Street 271, Phnom Penh', expectedEditEtag: branch.edit_etag }, { as: 'sokha' })
      t.eq('branch edit queued', branchEdit.status, 202)
      call = only(await H.tg.calls(), t, 'branch edit')
      t.eq('branch edit text', lines(call).slice(1), ['· Request/សំណើ: Edit branch/កែប្រែសាខា · LC Store', '· Requested by/បានស្នើសុំដោយ: sokha'])
      // never the full name, and never a parse mode (so `_`, `*` and `[` in a name cannot swallow text)
      for (const text of await H.tg.texts()) t.ok('no full name', !/Longname|Sok Dara/.test(text), text)
    })

    await check('C2', 'created: a write that was not queued sends nothing (a Full-tier user, a refusal)', 'high', async t => {
      await reset()
      const fee = await seedFee(H, 'Direct delete')
      t.eq('admin deletes directly', (await H.api('DELETE', '/api/fees/' + fee, {})).status, 200)
      t.eq('a Full-tier delete sends nothing', (await H.tg.calls()).length, 0)
      const refused = await H.api('DELETE', '/api/fees/' + (await seedFee(H, 'Nobody may')), {}, { as: 'plain' })
      t.ok('plain employee with fees:true deletes directly (Full) or is refused, either way no alert', [200, 403].includes(refused.status), refused.status)
      await reset()
      t.eq('a missing expense 404s', (await H.api('DELETE', '/api/fees/999999', {}, { as: 'sokha' })).status, 404)
      t.eq('a refusal sends nothing', (await H.tg.calls()).length, 0)
    })

    await check('C2b', 'created: the alert follows the insert; a pending row that could not be written sends nothing', 'high', async t => {
      await reset()
      const fee = await seedFee(H, 'Insert fails')
      const rows = async () => (await H.q1('SELECT COUNT(*) AS n FROM pending_actions')).n
      const before = await rows()
      await H.db.prepare("CREATE TRIGGER rt_fail_pending_insert BEFORE INSERT ON pending_actions BEGIN SELECT RAISE(ABORT, 'rt insert refused'); END").run()
      try {
        const failed = await H.api('DELETE', '/api/fees/' + fee, {}, { as: 'sokha' })
        t.ok('the request failed', failed.status >= 500, failed.status)
        t.eq('no pending row was written', await rows(), before)
        t.eq('nothing was announced for a row that does not exist', (await H.tg.calls()).length, 0)
      } finally {
        await H.db.prepare('DROP TRIGGER rt_fail_pending_insert').run()
      }
      await reset()
      const retried = await H.api('DELETE', '/api/fees/' + fee, {}, { as: 'sokha' })
      t.eq('the same request queues once the insert works', retried.status, 202)
      t.eq('and announces exactly once', (await H.tg.calls()).length, 1)
    })

    await check('C3', 'approved: one message naming the request, who asked and who decided (usernames), an expense\'s name read before it is removed', 'high', async t => {
      const queued = await queueFeeDelete('Courier tips')
      await reset()
      const approved = await H.api('POST', `/api/review/${queued.pendingId}/approve`, undefined, { as: 'dara' })
      t.eq('approved', approved.status, 200)
      t.eq('the expense is gone', await H.q1('SELECT id FROM fees WHERE id = ?', queued.fee), null)
      const call = only(await H.tg.calls(), t, 'approval')
      t.eq('approval text', lines(call), [
        '✅ Review approved/បានអនុម័តសំណើ',
        '· Request/សំណើ: Delete expense/លុបចំណាយ · Courier tips',
        '· Requested by/បានស្នើសុំដោយ: sokha',
        '· By/ដោយ: dara',
      ])
      t.eq('topic', call && call.body.message_thread_id, TOPIC)
      // a product edit: the record is read after the change, so it shows its new name
      const product = await seedProduct(H, 'Toner 200ml')
      const edit = await H.api('PUT', '/api/products/' + product, { name: 'Toner 200ml New', selling_price_usd: 7 }, { as: 'sokha' })
      t.eq('edit queued', edit.status, 202)
      await reset()
      const approvedEdit = await H.api('POST', `/api/review/${edit.body.pendingActionId}/approve`, undefined, { as: 'dara' })
      t.eq('edit approved', approvedEdit.status, 200)
      const editCall = only(await H.tg.calls(), t, 'edit approval')
      t.eq('edit approval text', lines(editCall).slice(1), ['· Request/សំណើ: Edit product/កែប្រែផលិតផល · Toner 200ml New', '· Requested by/បានស្នើសុំដោយ: sokha', '· By/ដោយ: dara'])
      // a created product
      const create = await H.api('POST', '/api/products', { name: 'Lip Tint 06', barcode: '8850000000906', selling_price_usd: 4.5 }, { as: 'sokha' })
      await reset()
      const approvedCreate = await H.api('POST', `/api/review/${create.body.pendingActionId}/approve`, undefined, { as: 'dara' })
      t.eq('create approved', approvedCreate.status, 200)
      const createCall = only(await H.tg.calls(), t, 'create approval')
      t.eq('create approval text', lines(createCall).slice(1), ['· Request/សំណើ: New product/ផលិតផលថ្មី · Lip Tint 06', '· Requested by/បានស្នើសុំដោយ: sokha', '· By/ដោយ: dara'])
      // a stock-reasons approval
      const reasons = await H.api('PUT', '/api/inventory/reasons', { items: [{ type: 'adjust', label: 'Damaged' }] }, { as: 'sokha' })
      await reset()
      t.eq('reasons approved', (await H.api('POST', `/api/review/${reasons.body.pendingActionId}/approve`, undefined, { as: 'dara' })).status, 200)
      t.eq('reasons approval text', lines((await H.tg.calls())[0]).slice(1), ['· Request/សំណើ: Edit stock reasons/កែប្រែមូលហេតុស្តុក', '· Requested by/បានស្នើសុំដោយ: sokha', '· By/ដោយ: dara'])
      // the actors are usernames, never the account's full name
      for (const text of [call, editCall, createCall].map(c => c.body.text)) t.ok('no full name', !/Fullname|Longname|Reviewer/.test(text), text)
    })

    await check('C3b', 'approved: an approval that merged two products prints the Merged row (outcome.mergedInto, optional)', 'high', async t => {
      const product = await seedProduct(H, 'Rice 1kg')
      const edit = await H.api('PUT', '/api/products/' + product, { name: 'Rice 1kg [merged-fixture]', selling_price_usd: 3 }, { as: 'sokha' })
      t.eq('queued', edit.status, 202)
      await reset()
      t.eq('approved', (await H.api('POST', `/api/review/${edit.body.pendingActionId}/approve`, undefined, { as: 'dara' })).status, 200)
      const call = only(await H.tg.calls(), t, 'merge approval')
      t.eq('merge approval text', lines(call), [
        '✅ Review approved/បានអនុម័តសំណើ',
        '· Request/សំណើ: Edit product/កែប្រែផលិតផល · Rice 5kg',
        '· Merged/បញ្ចូលគ្នា: Rice 1kg → Rice 5kg',
        '· Requested by/បានស្នើសុំដោយ: sokha',
        '· By/ដោយ: dara',
      ])
      t.ok('four rows under the heading, no more', lines(call).length === 5)
      // and an approval that did not merge has no Merged row
      const plain = await seedProduct(H, 'Plain Edit')
      const plainEdit = await H.api('PUT', '/api/products/' + plain, { name: 'Plain Edit', selling_price_usd: 3 }, { as: 'sokha' })
      await reset()
      await H.api('POST', `/api/review/${plainEdit.body.pendingActionId}/approve`, undefined, { as: 'dara' })
      t.ok('no merge, no Merged row', !lines((await H.tg.calls())[0]).some(l => l.includes('Merged')))
    })

    await check('C4', 'approved: two approvals racing send exactly one message (atomic path: an expense delete)', 'high', async t => {
      const queued = await queueFeeDelete('Race: courier')
      await reset()
      await H.control('barrier', { pattern: 'DELETE FROM fees WHERE id', count: 2 })
      const [a, b] = await Promise.all([
        H.api('POST', `/api/review/${queued.pendingId}/approve`, undefined, { as: 'dara' }),
        H.api('POST', `/api/review/${queued.pendingId}/approve`, undefined, { as: 'vanna' }),
      ])
      t.ok('both approvals were held at the write and released together (a real race)', (await H.controlGet('barrier/result')).arrived >= 2, await H.controlGet('barrier/result'))
      await H.control('barrier', {})
      t.eq('one 200 and one 409', [a.status, b.status].sort(), [200, 409])
      t.eq('exactly one message', (await H.tg.calls()).length, 1)
      const winner = [a, b].find(r => r.status === 200)
      const by = lines((await H.tg.calls())[0]).find(l => l.startsWith('· By'))
      t.ok('the message names the account that won', winner === a ? /dara$/.test(by) : /vanna$/.test(by), by)
    })

    await check('C4b', 'approved: two approvals racing send exactly one message (non-atomic path: the decision is a separate write)', 'high', async t => {
      // A plan-less queue row (one queued before price plans existed): both applies succeed, both reach the separate
      // markPendingActionApproved write, and only the first of them changes the row.
      const product = await seedProduct(H, 'Race Serum 30ml')
      const pending = await H.db.prepare(`INSERT INTO pending_actions(section,action_type,entity_type,entity_id,payload_json,summary,status,requested_by,requested_by_name)
        VALUES('products','update','product',?,?,?,'open',21,'sokha')`).bind(product, JSON.stringify({ description: 'updated by the race test' }), 'Update product #' + product).run()
      const pendingId = pending.meta.last_row_id
      await reset()
      await H.control('barrier', { pattern: "UPDATE pending_actions\\s+SET status = 'approved'", count: 2 })
      const [a, b] = await Promise.all([
        H.api('POST', `/api/review/${pendingId}/approve`, undefined, { as: 'dara' }),
        H.api('POST', `/api/review/${pendingId}/approve`, undefined, { as: 'vanna' }),
      ])
      const held = await H.controlGet('barrier/result')
      await H.control('barrier', {})
      t.ok('both approvals were held at the decision write and released together (a real race)', held.arrived >= 2, held)
      t.eq('one 200 and one 409', [a.status, b.status].sort(), [200, 409])
      t.eq('the loser says the request was already decided', [a, b].find(r => r.status === 409).body.error, 'Already reviewed or not found')
      t.eq('exactly one message', (await H.tg.calls()).length, 1)
      t.eq('the description was applied', (await H.q1('SELECT description FROM products WHERE id = ?', product)).description, 'updated by the race test')
    })

    await check('C5', 'refusals and 409s send nothing: self-approval, view-only reviewer, no section access, a stale expense, an unknown id', 'high', async t => {
      // self approval
      const own = await seedFee(H, 'Own request')
      const ownQueued = await H.api('DELETE', '/api/fees/' + own, {}, { as: 'selfie' })
      t.eq('selfie queued', ownQueued.status, 202)
      await reset()
      const self = await H.api('POST', `/api/review/${ownQueued.body.pendingActionId}/approve`, undefined, { as: 'selfie' })
      t.eq('self approval refused', self.status, 403)
      // a view-only reviewer, and an account with no review permission at all
      const queued = await queueFeeDelete('Refusal practice')
      await reset()   // the request above announced itself (C1); from here on every answer is a refusal
      t.eq('view-only reviewer refused', (await H.api('POST', `/api/review/${queued.pendingId}/approve`, undefined, { as: 'viewer' })).status, 403)
      t.eq('a plain employee refused', (await H.api('POST', `/api/review/${queued.pendingId}/approve`, undefined, { as: 'plain' })).status, 403)
      t.eq('an unknown id 404s', (await H.api('POST', '/api/review/987654/approve', undefined, { as: 'dara' })).status, 404)
      // the expense changed after the request: nothing is applied, the request stays open
      await H.db.prepare("UPDATE fees SET label = 'Edited since', updated_at = '2026-10-12 09:00:00' WHERE id = ?").bind(queued.fee).run()
      const stale = await H.api('POST', `/api/review/${queued.pendingId}/approve`, undefined, { as: 'dara' })
      t.eq('stale approval refused', stale.status, 409)
      t.eq('the request is still open', (await pendingOf(H, queued.pendingId)).status, 'open')
      t.eq('and the expense is still there', Boolean(await H.q1('SELECT id FROM fees WHERE id = ?', queued.fee)), true)
      // a reviewer who lacks the section
      t.eq('nothing was sent for any of them', (await H.tg.calls()).length, 0)
    })

    await check('C6', 'replays send nothing: an approved request approved again, a branch approval replayed', 'high', async t => {
      const queued = await queueFeeDelete('Replay practice')
      t.eq('first approval', (await H.api('POST', `/api/review/${queued.pendingId}/approve`, undefined, { as: 'dara' })).status, 200)
      await reset()
      const again = await H.api('POST', `/api/review/${queued.pendingId}/approve`, undefined, { as: 'dara' })
      t.eq('an approved request cannot be approved again', again.status, 409)
      t.eq('the second answer announced nothing', (await H.tg.calls()).length, 0)
      // a branch edit approved twice by the same reviewer: the second answer is the stored receipt, replayed:true
      const branch = (await H.api('GET', '/api/branches')).body.find(b => Number(b.id) === 1)
      const edit = await H.api('PUT', '/api/branches/1', { address: 'Street 51, Phnom Penh', expectedEditEtag: branch.edit_etag }, { as: 'sokha' })
      t.eq('branch edit queued', edit.status, 202)
      await reset()
      const first = await H.api('POST', `/api/review/${edit.body.pendingActionId}/approve`, undefined, { as: 'dara' })
      t.eq('branch approval', first.status, 200)
      t.eq('branch approval announced once', (await H.tg.calls()).length, 1)
      await reset()
      const replay = await H.api('POST', `/api/review/${edit.body.pendingActionId}/approve`, undefined, { as: 'dara' })
      t.eq('the replay answers 200', replay.status, 200)
      t.eq('and says it is a replay', replay.body && replay.body.replayed, true)
      t.eq('the replay announced nothing', (await H.tg.calls()).length, 0)
    })

    await check('C7', 'rejected: one message with the reason (cut at 120), the username of who rejected; a second rejection and a missing id send nothing', 'high', async t => {
      const queued = await queueFeeDelete('Reject me')
      await reset()
      const rejected = await H.api('POST', `/api/review/${queued.pendingId}/reject`, { reason: 'duplicate of the 9 Oct entry' }, { as: 'dara' })
      t.eq('rejected', rejected.status, 200)
      const call = only(await H.tg.calls(), t, 'rejection')
      t.eq('rejection text', lines(call), [
        '❌ Review rejected/បានបដិសេធសំណើ',
        '· Request/សំណើ: Delete expense/លុបចំណាយ · Reject me',
        '· Reason/មូលហេតុ: duplicate of the 9 Oct entry',
        '· Requested by/បានស្នើសុំដោយ: sokha',
        '· By/ដោយ: dara',
      ])
      await reset()
      t.eq('a second rejection is a 409', (await H.api('POST', `/api/review/${queued.pendingId}/reject`, { reason: 'again' }, { as: 'vanna' })).status, 409)
      t.eq('and approving a rejected request is a 409', (await H.api('POST', `/api/review/${queued.pendingId}/approve`, undefined, { as: 'vanna' })).status, 409)
      t.eq('an unknown id is a 409 (nothing to reject)', (await H.api('POST', '/api/review/987655/reject', { reason: 'x' }, { as: 'dara' })).status, 409)
      t.eq('none of them announced', (await H.tg.calls()).length, 0)
      // a long reason, ASCII and Khmer
      const long = await queueFeeDelete('Long reason')
      await reset()
      t.eq('long reason rejected', (await H.api('POST', `/api/review/${long.pendingId}/reject`, { reason: 'because '.repeat(40) }, { as: 'dara' })).status, 200)
      const longReason = lines((await H.tg.calls())[0]).find(l => l.includes('Reason'))
      const reasonValue = longReason.slice(longReason.indexOf(': ') + 2)
      t.ok('the reason is at most 120 characters', Array.from(reasonValue).length <= 120, Array.from(reasonValue).length)
      t.ok('and shows it was cut', reasonValue.endsWith('…'), reasonValue)
      const khmerQueued = await queueFeeDelete('Khmer reason')
      await reset()
      t.eq('khmer reason rejected', (await H.api('POST', `/api/review/${khmerQueued.pendingId}/reject`, { reason: 'ស្រី'.repeat(80) }, { as: 'dara' })).status, 200)
      const khmerLine = lines((await H.tg.calls())[0]).find(l => l.includes('Reason'))
      const khmerValue = khmerLine.slice(khmerLine.indexOf(': ') + 2)
      t.ok('the Khmer reason is at most 120 characters', Array.from(khmerValue).length <= 120, Array.from(khmerValue).length)
      t.ok('and does not end on a bare coeng', !/្…?$/.test(khmerValue))
      // no reason: no Reason row
      const bare = await queueFeeDelete('No reason')
      await reset()
      await H.api('POST', `/api/review/${bare.pendingId}/reject`, {}, { as: 'dara' })
      t.ok('no reason, no Reason row', !lines((await H.tg.calls())[0]).some(l => l.includes('Reason')))
    })

    await check('C8', 'resubmitted: one message when the requester sends a rejected request back; refusals and repeats send nothing', 'high', async t => {
      const queued = await queueFeeDelete('Resubmit me')
      t.eq('rejected', (await H.api('POST', `/api/review/${queued.pendingId}/reject`, { reason: 'wrong date' }, { as: 'dara' })).status, 200)
      await reset()
      const other = await H.api('POST', `/api/review/${queued.pendingId}/resubmit`, {}, { as: 'plain' })
      t.eq('another account cannot resubmit it', other.status, 404)
      t.eq('and nothing was announced', (await H.tg.calls()).length, 0)
      const back = await H.api('POST', `/api/review/${queued.pendingId}/resubmit`, {}, { as: 'sokha' })
      t.eq('resubmitted', back.status, 200)
      const call = only(await H.tg.calls(), t, 'resubmission')
      t.eq('resubmission text', lines(call), [
        '🔁 Review resubmitted/បានដាក់ស្នើឡើងវិញ',
        '· Request/សំណើ: Delete expense/លុបចំណាយ · Resubmit me',
        '· Requested by/បានស្នើសុំដោយ: sokha',
      ])
      await reset()
      t.eq('resubmitting an open request is a 404', (await H.api('POST', `/api/review/${queued.pendingId}/resubmit`, {}, { as: 'sokha' })).status, 404)
      t.eq('resubmitting a request that never existed is a 404', (await H.api('POST', '/api/review/987656/resubmit', {}, { as: 'sokha' })).status, 404)
      t.eq('neither announced', (await H.tg.calls()).length, 0)
    })

    await check('C8b', 'product removal: approval says "Remove product" with the name (the row survives, retired); a replay sends nothing; a rejection carries its reason', 'high', async t => {
      const product = await seedProduct(H, 'Old Lip Balm')
      const queued = await H.api('DELETE', '/api/products/' + product, { reason: 'Discontinued line', client_request_id: 'rt-remove-' + (++seq) + '-abcdef' }, { as: 'sokha' })
      t.eq('removal queued', queued.status, 202)
      const pendingId = queued.body && queued.body.pendingActionId
      await reset()
      const approved = await H.api('POST', `/api/review/${pendingId}/approve`, undefined, { as: 'dara' })
      t.eq('removal approved', approved.status, 200)
      const call = only(await H.tg.calls(), t, 'removal approval')
      t.eq('removal approval text', lines(call), [
        '✅ Review approved/បានអនុម័តសំណើ',
        '· Request/សំណើ: Remove product/លុបផលិតផល · Old Lip Balm',
        '· Requested by/បានស្នើសុំដោយ: sokha',
        '· By/ដោយ: dara',
      ])
      t.eq('the product is retired', (await H.q1('SELECT is_active FROM products WHERE id = ?', product)).is_active, 0)
      await reset()
      const replay = await H.api('POST', `/api/review/${pendingId}/approve`, undefined, { as: 'dara' })
      t.eq('the replay answers 200', replay.status, 200)
      t.eq('and says it is a replay', replay.body && replay.body.replayed, true)
      t.eq('the replay announced nothing', (await H.tg.calls()).length, 0)
      // a rejected removal
      const other = await seedProduct(H, 'Old Lip Gloss')
      const second = await H.api('DELETE', '/api/products/' + other, { reason: 'Slow seller', client_request_id: 'rt-remove-' + (++seq) + '-abcdef' }, { as: 'sokha' })
      await reset()
      t.eq('removal rejected', (await H.api('POST', `/api/review/${second.body.pendingActionId}/reject`, { reason: 'still on the shelf' }, { as: 'dara' })).status, 200)
      t.eq('removal rejection text', lines((await H.tg.calls())[0]), [
        '❌ Review rejected/បានបដិសេធសំណើ',
        '· Request/សំណើ: Remove product/លុបផលិតផល · Old Lip Gloss',
        '· Reason/មូលហេតុ: still on the shelf',
        '· Requested by/បានស្នើសុំដោយ: sokha',
        '· By/ដោយ: dara',
      ])
    })

    await check('C9', 'switches: telegram_reviews_enabled (on when unset), automation, the chat id', 'high', async t => {
      const run = async (label, expectedCalls) => {
        await reset()
        const r = await queueFeeDelete('Switch ' + label)
        t.eq(label + ': the request itself is unaffected', r.status, 202)
        t.eq(label + ': messages sent', (await H.tg.calls()).length, expectedCalls)
        return r
      }
      await H.setting('telegram_reviews_enabled', null); await run('unset', 1)
      await H.setting('telegram_reviews_enabled', 'true'); await run('true', 1)
      await H.setting('telegram_reviews_enabled', 'false')
      const off = await run('false', 0)
      // while off, every event is silent
      await reset()
      t.eq('approve while off', (await H.api('POST', `/api/review/${off.pendingId}/approve`, undefined, { as: 'dara' })).status, 200)
      const off2 = await queueFeeDelete('Switch off 2')
      t.eq('reject while off', (await H.api('POST', `/api/review/${off2.pendingId}/reject`, { reason: 'no' }, { as: 'dara' })).status, 200)
      t.eq('resubmit while off', (await H.api('POST', `/api/review/${off2.pendingId}/resubmit`, {}, { as: 'sokha' })).status, 200)
      t.eq('no message while the switch is off', (await H.tg.calls()).length, 0)
      await H.setting('telegram_reviews_enabled', null)
      // other switches do not govern it, and it governs nothing else
      await H.setting('telegram_products_enabled', 'false'); await H.setting('telegram_fees_enabled', 'false')
      await run('other switches off', 1)
      await H.setting('telegram_products_enabled', null); await H.setting('telegram_fees_enabled', null)
      await H.setting('telegram_automation_enabled', 'false'); await run('automation off', 0)
      await H.setting('telegram_automation_enabled', null)
      await H.setting('telegram_chat_id', null); await run('no chat id', 0)
      await H.setting('telegram_chat_id', CHAT)
      await run('restored', 1)
    })

    await check('C10', 'isolation: the chat and topic are this deployment\'s settings, whatever they are; General when no topic is set', 'high', async t => {
      await reset()
      await H.setting('telegram_topic_alerts', '4343'); await H.setting('telegram_chat_id', '-1002222222222')
      await queueFeeDelete('Moved chat')
      let call = only(await H.tg.calls(), t, 'moved')
      t.eq('the moved topic', call && call.body.message_thread_id, 4343)
      t.eq('the moved chat', call && call.body.chat_id, '-1002222222222')
      await reset()
      await H.setting('telegram_topic_alerts', null)
      await queueFeeDelete('No topic')
      call = only(await H.tg.calls(), t, 'no topic')
      t.ok('no Alerts topic: no thread key at all', call && !('message_thread_id' in call.body), call && call.body)
      await H.setting('telegram_topic_alerts', String(TOPIC)); await H.setting('telegram_chat_id', CHAT)
    })

    await check('C11', 'delivery: one retry after 429 or 5xx; none after a network error or a timeout; the request still succeeds', 'high', async t => {
      const send = async (steps) => {
        await reset(); await H.tg.script(steps)
        const r = await queueFeeDelete('Delivery ' + (++seq))
        return { r, calls: await H.tg.calls() }
      }
      let out = await send([{ status: 429, body: JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 0 } }) }])
      t.eq('429: request ok', out.r.status, 202); t.eq('429: retried once', out.calls.length, 2)
      t.eq('429: same message', out.calls[1] && out.calls[1].body, out.calls[0] && out.calls[0].body)
      t.ok('a retrying send carries a timeout signal', out.calls.every(c => c.signal))
      out = await send([{ status: 500 }])
      t.eq('500: request ok', out.r.status, 202); t.eq('500: retried once', out.calls.length, 2)
      out = await send([{ status: 502 }, { status: 502 }, {}])
      t.eq('502 twice: request ok', out.r.status, 202); t.eq('502 twice: only one retry', out.calls.length, 2)
      out = await send([{ throw: 'Network connection lost' }, {}])
      t.eq('network error: request ok', out.r.status, 202); t.eq('network error: NOT retried', out.calls.length, 1)
      out = await send([{ throw: 'The operation was aborted due to timeout', name: 'TimeoutError' }, {}])
      t.eq('timeout: request ok', out.r.status, 202); t.eq('timeout: NOT retried', out.calls.length, 1)
      out = await send([{ status: 400, body: JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }) }, {}])
      t.eq('400: request ok', out.r.status, 202); t.eq('400: not retried', out.calls.length, 1)
      // the wait is Telegram's retry_after
      out = await send([{ status: 429, body: JSON.stringify({ parameters: { retry_after: 1 } }) }])
      const waited = out.calls[1] ? out.calls[1].startedAt - out.calls[0].doneAt : -1
      t.ok('retry_after 1 s is waited', waited >= 900, waited)
      // a deleted topic still falls back to General
      out = await send([{ status: 400, body: JSON.stringify({ description: 'Bad Request: message thread not found' }) }])
      t.eq('deleted topic: request ok', out.r.status, 202)
      t.eq('deleted topic: retried in General', out.calls.length, 2)
      t.ok('General has no thread', out.calls[1] && !('message_thread_id' in out.calls[1].body))
    })

    await check('C12', 'a Telegram failure never fails the request: approve, reject and resubmit stay 200', 'high', async t => {
      const failing = [{ status: 500 }, { status: 500 }]
      const queued = await queueFeeDelete('Failing telegram')
      await reset(); await H.tg.script([{ throw: 'Network connection lost' }])
      const approved = await H.api('POST', `/api/review/${queued.pendingId}/approve`, undefined, { as: 'dara' })
      t.eq('approve survives a network error', approved.status, 200)
      const q2 = await queueFeeDelete('Failing telegram 2')
      await reset(); await H.tg.script(failing)
      t.eq('reject survives two 500s', (await H.api('POST', `/api/review/${q2.pendingId}/reject`, { reason: 'x' }, { as: 'dara' })).status, 200)
      await reset(); await H.tg.script(failing)
      const resub = await H.api('POST', `/api/review/${q2.pendingId}/resubmit`, {}, { as: 'sokha' })
      t.eq('resubmit survives two 500s', resub.status, 200)
      t.eq('and the row really is open again', (await pendingOf(H, q2.pendingId)).status, 'open')
      // an unconfigured bot token: nothing is sent and nothing fails (the chat id alone is not enough)
    })

    await check('C13', 'deferral: the answer is ready before a slow Telegram call finishes', 'high', async t => {
      await reset(); await H.tg.script([{ delay: 700 }])
      const r = await queueFeeDelete('Slow telegram')
      const calls = await H.tg.calls()
      t.eq('request ok', r.status, 202)
      t.eq('one call', calls.length, 1)
      if (calls[0]) t.ok('the answer was ready while Telegram was still working (' + (calls[0].doneAt - r.respondedAt) + ' ms to spare)', calls[0].doneAt - r.respondedAt >= 400, { answer: r.respondedAt, telegram: calls[0].doneAt })
    })

    await check('C14', 'privacy: no amount, cost, phone, email or raw summary in any message; account usernames only', 'high', async t => {
      await reset()
      const fee = await seedFee(H, 'Rent secret', { amount: 4321.98 })
      const queued = await H.api('DELETE', '/api/fees/' + fee, {}, { as: 'sokha' })
      const product = await seedProduct(H, 'Secret Cream')
      const edit = await H.api('PUT', '/api/products/' + product, { name: 'Secret Cream', selling_price_usd: 999.99, description: 'call 012345678 or mail me@example.com' }, { as: 'sokha' })
      t.eq('edit queued', edit.status, 202)
      await H.api('POST', `/api/review/${queued.body.pendingActionId}/approve`, undefined, { as: 'dara' })
      await H.api('POST', `/api/review/${edit.body.pendingActionId}/reject`, { reason: 'price too high' }, { as: 'dara' })
      const texts = await H.tg.texts()
      t.ok('messages were sent', texts.length >= 4, texts.length)
      for (const text of texts) {
        t.ok('no money amount', !/4321|999\.99|888\.88|\$|USD|KHR|៛/.test(text), text)
        t.ok('no phone or email', !/012345678|@example\.com/.test(text), text)
        t.ok('no summary text', !/Delete fee #|Update product #|Create product/.test(text), text)
        t.ok('no full name', !/Longname|Fullname|Sok Dara|Dara Reviewer/.test(text), text)
      }
      // A direction control typed into a name or a reason is dropped before it reaches the group.
      await reset()
      const bidiFee = await queueFeeDelete('Pay\u202e Rent')
      await H.api('POST', `/api/review/${bidiFee.pendingId}/reject`, { reason: 'dup\u2067licate' }, { as: 'dara' })
      const bidiTexts = await H.tg.texts()
      t.eq('a created and a rejected message', bidiTexts.length, 2)
      for (const text of bidiTexts) t.ok('no direction control in the message', !/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(text), text)
      t.ok('the name survives without the control', bidiTexts.every(text => text.includes('Pay Rent')), bidiTexts)
      t.ok('the reason survives without the control', bidiTexts[1] && bidiTexts[1].includes('duplicate'), bidiTexts[1])
    })

    await check('C15', 'D1 statements: what each alert costs a request (printed; asserted at most 2)', 'high', async t => {
      const measure = async (label, run) => {
        await reset(); const r = await run(); const s = await statementsOf(H)
        t.note(`STATEMENTS ${label}: request ${s.total} total, ${s.alert} for the alert (${r.status})`)
        t.ok(label + ': at most two statements for the alert', s.alert <= 2, s)
        return s
      }
      const on = {}
      on.created = await measure('created (expense delete)', () => queueFeeDelete('Count created'))
      const q = await queueFeeDelete('Count approve')
      on.approved = await measure('approved (expense delete)', () => H.api('POST', `/api/review/${q.pendingId}/approve`, undefined, { as: 'dara' }))
      const p = await seedProduct(H, 'Count Product')
      const pe = await H.api('PUT', '/api/products/' + p, { name: 'Count Product', selling_price_usd: 5 }, { as: 'sokha' })
      on.approvedProduct = await measure('approved (product edit)', () => H.api('POST', `/api/review/${pe.body.pendingActionId}/approve`, undefined, { as: 'dara' }))
      const q2 = await queueFeeDelete('Count reject')
      on.rejected = await measure('rejected (expense delete)', () => H.api('POST', `/api/review/${q2.pendingId}/reject`, { reason: 'no' }, { as: 'dara' }))
      on.resubmitted = await measure('resubmitted (expense delete)', () => H.api('POST', `/api/review/${q2.pendingId}/resubmit`, {}, { as: 'sokha' }))
      // the same requests with the alerts off cost the settings read (and an expense delete's name read) only
      await H.setting('telegram_reviews_enabled', 'false')
      const off = await measure('created, alerts off', () => queueFeeDelete('Count created off'))
      t.ok('alerts off: the compose step (the name read) does not run', off.alert <= 1, off)
      await H.setting('telegram_reviews_enabled', null)
    })

    await check('C16', 'the Worker\'s own answers are unchanged: approve with no body, an invalid id, the review list', 'high', async t => {
      t.eq('list answers', (await H.api('GET', '/api/review?status=open', undefined, { as: 'dara' })).status, 200)
      t.eq('an invalid id', (await H.api('POST', '/api/review/abc/approve', undefined, { as: 'dara' })).status, 400)
      t.eq('mine answers', (await H.api('GET', '/api/review/mine', undefined, { as: 'sokha' })).status, 200)
    })

    const queueReason = async label => {
      const r = await H.api('PUT', '/api/inventory/reasons', { items: [{ type: 'adjust', label }] }, { as: 'sokha' })
      return r.body && r.body.pendingActionId
    }

    await check('C17', 'contract: a ReviewCodedRefusal becomes {success:false, error, code, ...details} with its 403/409/503; nothing else does', 'high', async t => {
      const byKey = (object) => Object.fromEntries(Object.entries(object).sort(([a], [b]) => (a < b ? -1 : 1)))
      // [thrown status, code, variant, expected HTTP status, expected to be mapped]
      const cases = [
        [403, 'review_action_full_required', '', 403, true],
        [409, 'review_merge_confirm_required', '', 409, true],
        [503, 'review_merge_unavailable', '', 503, true],
        [409, 'review_details_clash', 'clash', 409, true], // details that carry success / error / code must not overwrite the real ones
        [418, 'review_teapot', '', 500, false],         // a status outside 403/409/503 is not a coded refusal
        [409, 'review_wrong_name', 'othername', 500, false], // another error class with the same shape is not one either
        [409, 'review_no_code', 'nocode', 500, false],  // no code, no refusal
      ]
      for (const [status, code, variant, expected, mapped] of cases) {
        const pendingId = await queueReason(`[refuse:${status}:${code}${variant ? ':' + variant : ''}]`)
        await reset()
        const r = await H.api('POST', `/api/review/${pendingId}/approve`, undefined, { as: 'dara' })
        t.eq(`${code}: HTTP status`, r.status, expected)
        if (mapped) {
          t.eq(`${code}: body`, byKey(r.body), byKey({ success: false, error: 'Fixture refusal ' + code, code, permission: 'products:merge_duplicates', preview: { survivorId: 9, survivorName: 'Rice 5kg' } }))
        } else {
          t.ok(`${code}: the generic 500 body, no code`, r.body && r.body.code === undefined && typeof r.body.error === 'string', r.body)
        }
        t.eq(`${code}: the request is still open`, (await pendingOf(H, pendingId)).status, 'open')
        t.eq(`${code}: nothing announced`, (await H.tg.calls()).length, 0)
      }
    })

    await check('C18', 'contract: confirm_merge_into is read from the approve body and handed to the applier as confirmMergeInto', 'high', async t => {
      const seenBy = async (body, { raw } = {}) => {
        const pendingId = await queueReason('Confirm ' + (++seq))
        await H.setting('rt_confirm_seen', null)
        const r = raw !== undefined
          ? await H.mf.dispatchFetch(`http://localhost/api/review/${pendingId}/approve`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'bos_session=' + H.tokens.dara }, body: raw })
          : await H.api('POST', `/api/review/${pendingId}/approve`, body, { as: 'dara' })
        t.eq('approval answered 200 for ' + JSON.stringify(raw ?? body), r.status, 200)
        return (await H.q1("SELECT value FROM settings WHERE key = 'rt_confirm_seen'")).value
      }
      t.eq('a positive integer', await seenBy({ confirm_merge_into: 9 }), '9')
      t.eq('a numeric string', await seenBy({ confirm_merge_into: '9' }), '9')
      for (const unusable of [{}, { confirm_merge_into: 0 }, { confirm_merge_into: -3 }, { confirm_merge_into: 1.5 }, { confirm_merge_into: 'abc' }, { confirm_merge_into: null }, { confirm_merge_into: [9] }, { confirm_merge_into: true }, { confirm_merge_into: '9.5' }, { confirm_merge_into: '-9' }, { other: 9 }]) {
        t.eq('not confirmed: ' + JSON.stringify(unusable), await seenBy(unusable), 'undefined')
      }
      t.eq('no body at all (what the Review page sends today)', await seenBy(undefined), 'undefined')
      t.eq('a body that is not JSON', await seenBy(undefined, { raw: 'not json at all' }), 'undefined')
    })

    await check('C19', 'review list: ?fields=targets returns only what the pending tag needs (both lists); the default answer is unchanged', 'high', async t => {
      await reset()
      const feeA = await queueFeeDelete('Tag fee A')
      const feeB = await queueFeeDelete('Tag fee B')
      const product = await H.api('POST', '/api/products', { name: 'Tag product', barcode: '8850000' + String(100000 + (++seq)), selling_price_usd: 4.5 }, { as: 'sokha' })
      t.eq('three requests queued', [feeA.status, feeB.status, product.status], [202, 202, 202])
      const TARGET_KEYS = ['action_type', 'created_at', 'entity_id', 'entity_type', 'id', 'requested_by', 'requested_by_name', 'section', 'status']
      const keysOf = row => Object.keys(row).sort()

      const full = await H.api('GET', '/api/review', undefined, { as: 'dara' })
      const slim = await H.api('GET', '/api/review?fields=targets', undefined, { as: 'dara' })
      t.eq('default list: 200', full.status, 200)
      t.eq('targets list: 200', slim.status, 200)
      const fullRows = (full.body && full.body.data) || [], slimRows = (slim.body && slim.body.data) || []
      t.ok('default list still carries the payload and the summary (the queue screen reads them)', fullRows.length >= 3 && fullRows.every(r => 'payload_json' in r && 'summary' in r && 'expected_entity_state_json' in r), fullRows[0] && keysOf(fullRows[0]))
      t.eq('targets rows hold exactly the target columns', slimRows.map(keysOf), slimRows.map(() => TARGET_KEYS))
      t.eq('same rows in the same order as the default list', slimRows.map(r => r.id), fullRows.map(r => r.id))
      t.eq('every target field equals the value in the default list', slimRows.map(r => TARGET_KEYS.map(k => r[k])), fullRows.map(r => TARGET_KEYS.map(k => r[k])))
      t.ok('the targets answer is the smaller one', JSON.stringify(slim.body).length < JSON.stringify(full.body).length)

      const feesOnly = await H.api('GET', '/api/review?fields=targets&section=fees', undefined, { as: 'dara' })
      const feeIds = fullRows.filter(r => r.section === 'fees').map(r => r.id)
      t.ok('section filter still applies: the fee rows only, all of them', feeIds.length >= 2 && fullRows.some(r => r.section !== 'fees'), feeIds)
      t.eq('section filter result', (feesOnly.body.data || []).map(r => r.id), feeIds)
      const approved = await H.api('GET', '/api/review?fields=targets&status=approved', undefined, { as: 'dara' })
      t.eq('status filter still applies', (approved.body.data || []).length, 0)

      const viewer = await H.api('GET', '/api/review?fields=targets', undefined, { as: 'viewer' })
      t.eq('a view-only reviewer may read it', viewer.status, 200)
      const plain = await H.api('GET', '/api/review?fields=targets', undefined, { as: 'plain' })
      t.eq('a user without review is still refused', plain.status, 403)

      const mine = await H.api('GET', '/api/review/mine?fields=targets', undefined, { as: 'sokha' })
      const mineFull = await H.api('GET', '/api/review/mine', undefined, { as: 'sokha' })
      t.eq('mine: 200', mine.status, 200)
      t.eq('mine: target columns only', ((mine.body && mine.body.data) || []).map(keysOf), ((mine.body && mine.body.data) || []).map(() => TARGET_KEYS))
      t.eq('mine: same rows as the default', ((mine.body && mine.body.data) || []).map(r => r.id), ((mineFull.body && mineFull.body.data) || []).map(r => r.id))
      t.ok('mine: only the requester own rows', ((mine.body && mine.body.data) || []).length >= 3 && mine.body.data.every(r => r.requested_by_name === 'sokha'))

      for (const url of ['/api/review?fields=all', '/api/review/mine?fields=payload_json,id']) {
        const bad = await H.api('GET', url, undefined, { as: url.includes('mine') ? 'sokha' : 'dara' })
        t.eq(url + ': refused 400 invalid_fields', [bad.status, bad.body && bad.body.code], [400, 'invalid_fields'])
      }
      t.eq('listing sends nothing to Telegram beyond the three created alerts', (await H.tg.calls()).length, 3)
    })
  } finally {
    await H.dispose()
  }
  finish('review Telegram alerts' + (WRONG ? ' [--wrong=' + WRONG + ']' : ''))
}

main().catch(error => { console.error(error); process.exitCode = 1 })
