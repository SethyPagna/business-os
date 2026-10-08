// Guards the 25 Sep 2026 location fix: the broadcast hub Durable Object is
// pinned to APAC (next to D1 and the Worker's placement), and no response
// waits on a hub round trip -- neither in a route handler nor in a lib
// function a route awaits.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const src = path.join(__dirname, '..', 'src')
const hub = fs.readFileSync(path.join(src, 'durable-objects', 'broadcastHub.ts'), 'utf8')
const index = fs.readFileSync(path.join(src, 'index.ts'), 'utf8')

assert.match(hub, /get\(env\.BROADCAST_HUB\.idFromName\(HUB_NAME\), \{ locationHint: 'apac' \}\)/, 'hub stub carries the APAC location hint')
assert.match(hub, /const HUB_NAME = 'global-apac'/, 'a fresh hub name, because a hint cannot move an existing instance')
assert.match(index, /broadcastHubStub\(c\.env\)\.fetch\(c\.req\.raw\)/, 'sockets connect to the APAC hub')
assert.doesNotMatch(index, /BROADCAST_HUB\.idFromName\('global'\)/, 'no socket attaches to the legacy hub')

function tsFiles(dir) {
  return fs.readdirSync(dir).filter((file) => file.endsWith('.ts')).sort()
    .map((file) => ({ file, lines: fs.readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/) }))
}

// The top-level declaration a line belongs to: the last column-0 line above
// it that opens a function, a const, a registerApplier(...) or an app route.
function unitOf(lines, index) {
  for (let i = index; i >= 0; i--) {
    const line = lines[i]
    if (!/^[A-Za-z]/.test(line)) continue
    const fn = /^(?:export )?(?:async )?function (\w+)/.exec(line)
    if (fn) return fn[1]
    const constant = /^(?:export )?const (\w+)/.exec(line)
    if (constant) return constant[1]
    const applier = /^registerApplier\(([^)]*?), async/.exec(line)
    if (applier) return `registerApplier(${applier[1]})`
    if (/^(?:import|export \{|type |interface |export (?:type|interface) )/.test(line)) continue
    return line.slice(0, 60)
  }
  return '<top>'
}

function unitText(lines, name) {
  const start = lines.findIndex((line, i) => /^[A-Za-z]/.test(line) && unitOf(lines, i) === name)
  if (start < 0) return null
  let end = start + 1
  while (end < lines.length && !(/^[A-Za-z]/.test(lines[end]) && unitOf(lines, end) !== name)) end++
  return lines.slice(start, end).join('\n')
}

const CALL = /\bbroadcast\((?:c\.env|ctx\.env|env)\b/
const isComment = (line) => /^\s*(?:\/\/|\*|\/\*)/.test(line)

// ---- Routes: nothing awaits a broadcast directly. -------------------------
// Named, not fixed here: products.ts is owned by another lane (U-broadcast
// lane report, 26 Sep 2026). A stale entry is reported, not failed, so that
// lane's fix does not turn this test red.
const ROUTE_PENDING = { 'products.ts': ['foldCreateIntoExisting'] }
const routes = tsFiles(path.join(src, 'routes'))
const blocking = []
const routeSeen = new Set()
for (const { file, lines } of routes) {
  lines.forEach((line, i) => {
    if (isComment(line) || !/await broadcast\(/.test(line)) return
    const unit = unitOf(lines, i)
    if ((ROUTE_PENDING[file] || []).includes(unit)) { routeSeen.add(`${file}:${unit}`); return }
    blocking.push(`routes/${file}:${i + 1} (${unit})`)
  })
}
assert.deepEqual(blocking, [], `route handlers must use c.executionCtx.waitUntil(broadcast(...)): ${blocking.join(', ')}`)
for (const [file, units] of Object.entries(ROUTE_PENDING)) for (const unit of units) {
  if (!routeSeen.has(`${file}:${unit}`)) console.log(`note: ROUTE_PENDING ${file}:${unit} no longer awaits a broadcast -- drop the entry`)
}

// ---- Lib: every function that broadcasts is classified. -------------------
// QUEUE_ONLY: reached only from queue.ts's consumer (or its no-binding inline
//   fallback in lib/queueDispatch.ts, which runs the whole job in the caller
//   anyway). No request context exists; awaiting is correct.
// NOTIFIERS: the whole function is the deferred work; every route caller hands
//   it to c.executionCtx.waitUntil.
// THREADED: takes an optional waitUntil from the route and awaits only when
//   none is given (tests, non-request callers).
// PENDING: request-path awaits outside this lane's scope, named so they are
//   not forgotten. Remove an entry once its function is fixed.
const QUEUE_ONLY = {
  'bulkDeleteEngine.ts': ['runBulkDeleteJob', 'runProductDeleteChunk'],
  'importEngine.ts': ['applyStockActionsContinuation', 'runImportApply'],
}
const NOTIFIERS = {
  'customerGenderRestoration.ts': ['notifyCustomerGenderRestoration'],
  'returnBulkAction.ts': ['notifyReturnBulkAction'],
  'saleBulkStatus.ts': ['notifyBulkStatus'],
  'saleBulkUpdate.ts': ['notifySaleBulkUpdate'],
  'saleSettlementAction.ts': ['notifySaleSettlementAction'],
  'stockInLineEdit.ts': ['notifyStockInLineEdit'],
  'stockLotAdjustment.ts': ['notifyStockLotSet'],
  'stockSession.ts': ['notifyStockSession'],
  'transferOperation.ts': ['notifyTransferOperation'],
}
const THREADED = {
  'generalCustomerMembershipRepair.ts': ['refreshGeneralCustomerMembershipRepair'],
  'generalCustomerRepair.ts': ['refreshGeneralCustomerRepair'],
  'reviewApply.ts': ['notify'],
  'telegramTopicSetting.ts': ['saveTelegramTopicSetting'],
}
const PENDING = {
  // Undo/redo replays run inside POST /api/action-history/:id/{undo,redo};
  // UndoApplierContext carries no waitUntil yet.
  'undoAppliers.ts': ['replayProductMergeGroup', 'replayProductRemove', 'APPLIERS'],
}
const classes = { QUEUE_ONLY, NOTIFIERS, THREADED, PENDING }
const classOf = (file, unit) => Object.keys(classes).find((name) => (classes[name][file] || []).includes(unit))

const libDir = path.join(src, 'lib')
const libs = tsFiles(libDir)
const unclassified = []
const found = new Set()
for (const { file, lines } of libs) {
  lines.forEach((line, i) => {
    if (isComment(line) || !CALL.test(line)) return
    const unit = unitOf(lines, i)
    found.add(`${file}:${unit}`)
    if (!classOf(file, unit)) unclassified.push(`lib/${file}:${i + 1} (${unit})`)
  })
}
assert.deepEqual(unclassified, [],
  `lib functions that broadcast must take a waitUntil or be classified in this test: ${unclassified.join(', ')}`)

for (const [name, table] of Object.entries(classes)) for (const [file, units] of Object.entries(table)) for (const unit of units) {
  if (found.has(`${file}:${unit}`)) continue
  // A fixed PENDING entry is reported, not failed, so the owning lane's fix
  // does not turn this test red; every other stale entry would re-permit a
  // future blocking broadcast, so it fails.
  if (name === 'PENDING') console.log(`note: PENDING lib/${file}:${unit} no longer broadcasts -- drop the entry`)
  else assert.fail(`${name} entry lib/${file}:${unit} no longer broadcasts -- drop the entry`)
}

// Code only: comments name these functions in prose ("see runImportApply(...)").
const codeOnly = (lines) => lines.filter((line) => !isComment(line)).map((line) => line.replace(/\s\/\/ .*$/, '')).join('\n')
const routeText = routes.map(({ file, lines }) => ({ file, text: codeOnly(lines) }))
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

for (const [file, units] of Object.entries(QUEUE_ONLY)) for (const unit of units) {
  for (const route of routeText) {
    assert.ok(!new RegExp(`\\b${escape(unit)}\\(`).test(route.text), `queue-only ${file}:${unit} must not be called from routes/${route.file}`)
  }
}

for (const [file, units] of Object.entries(NOTIFIERS)) for (const unit of units) {
  let callers = 0
  for (const route of routeText) {
    assert.ok(!new RegExp(`await\\s+(?:\\w+\\.)?${escape(unit)}\\(`).test(route.text), `routes/${route.file} awaits notifier ${file}:${unit}; hand it to waitUntil`)
    callers += (route.text.match(new RegExp(`\\b${escape(unit)}\\(`, 'g')) || []).length
  }
  assert.ok(callers > 0, `notifier ${file}:${unit} has no route caller -- reclassify it`)
}

for (const [file, units] of Object.entries(THREADED)) {
  const lines = libs.find((lib) => lib.file === file).lines
  for (const unit of units) {
    const body = unitText(lines, unit)
    assert.match(body, /if \(waitUntil\) waitUntil\(\w+\)\s*\n?\s*else await \w+/, `${file}:${unit} defers to waitUntil when one is given`)
  }
}

// The routes that own a threaded function must actually pass the request's
// waitUntil, or the threading is dead code.
const THREADED_ENTRY_POINTS = [
  ['reviewQueue.ts', 'applyApprovedPendingAction'],
  ['system.ts', 'refreshGeneralCustomerMembershipRepair'],
  ['system.ts', 'refreshGeneralCustomerRepair'],
  // saveTelegramTopicSetting reaches the route as the webhook's writer, with the request's waitUntil beside it.
  ['telegram.ts', 'handleTelegramWebhook'],
]
for (const [file, fn] of THREADED_ENTRY_POINTS) {
  const lines = routes.find((route) => route.file === file).lines
  const calls = lines.map((line, i) => ({ line, i })).filter(({ line }) => new RegExp(`\\b${escape(fn)}\\(`).test(line) && !/^import /.test(line))
  assert.ok(calls.length > 0, `routes/${file} calls ${fn}`)
  for (const { i } of calls) {
    assert.match(lines.slice(i, i + 2).join('\n'), /c\.executionCtx\.waitUntil\(/, `routes/${file}:${i + 1} passes the request's waitUntil to ${fn}`)
  }
}

console.log('broadcast hub APAC guard: PASS')
