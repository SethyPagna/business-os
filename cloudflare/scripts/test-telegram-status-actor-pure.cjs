// S4-6: the receipt-status Telegram message must name the user who made the
// update.
//
// The status-change lines are composed INLINE in routes/sales.ts's
// `app.patch('/:id/status', ...)` handler (see the comment in
// lib/telegramLang.ts's `by` entry) -- unlike the sale-recorded message,
// there is no formatXTelegramLines() to unit-test directly. So this test:
//
//   1. Extracts the REAL composition block out of the actual source text
//      (not a hand-copied re-implementation) and evaluates it for three
//      actors -- full name, username-only, and none -- to prove the route
//      wires `actorName` in and degrades sanely when there is none.
//   2. Runs the resulting lines through the REAL localizeTelegramLine (the
//      one function that makes every Telegram line bilingual, per
//      lib/telegram.ts's sendTelegramEvent) to prove the composed message
//      actually carries the Khmer line, not just an English one.
//
// Run (from cloudflare/): node scripts/test-telegram-status-actor-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')

function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath,
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath))
  } finally { Module._load = originalLoad }
  return moduleObj.exports
}

const telegramLang = loadReal('lib/telegramLang.ts')
const actorSnapshot = loadReal('lib/actorSnapshot.ts')

// ---- 1. extract the ACTUAL composition block out of routes/sales.ts -------
const salesSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'sales.ts'), 'utf8')
const START = "const actorName = actorSnapshot(user)"
const END = "}).catch((error) => console.error('[telegram] sale status notification failed', error)))"
const startIdx = salesSrc.indexOf(START)
const endIdx = salesSrc.indexOf(END, startIdx)
assert.ok(startIdx > 0 && endIdx > startIdx, 'the sale-status Telegram composition block must be findable in routes/sales.ts -- has it moved?')
let block = salesSrc.slice(startIdx, endIdx + END.length)

// Turn the real "fire the notification" call into "hand back the composed
// event object" -- the only two textual substitutions needed to run the
// exact array-literal / conditional logic the route ships outside a Worker
// request. If either anchor stops matching, the route changed shape and this
// test should fail loudly rather than silently test stale text.
const CALL_START = "c.executionCtx.waitUntil(sendTelegramEvent(c.env, {"
const CALL_END = "}).catch((error) => console.error('[telegram] sale status notification failed', error)))"
assert.ok(block.includes(CALL_START), 'expected the sendTelegramEvent call shape to still be present')
block = block.replace(CALL_START, 'return ({').replace(CALL_END, '})')

function buildEvent(input) {
  const fn = new Function(
    'sale', 'id', 'oldStatus', 'saleStatus', 'cancelReason', 'skipStock', 'totalSkippedUnits',
    'cancelFeeUsd', 'cancelFeeKhr', 'user', 'cancelReasonLabel', 'telegramMoney', 'actorSnapshot',
    block,
  )
  return fn(
    input.sale, input.id, input.oldStatus, input.saleStatus, input.cancelReason ?? null,
    input.skipStock ?? false, input.totalSkippedUnits ?? 0, input.cancelFeeUsd ?? 0, input.cancelFeeKhr ?? 0,
    input.user ?? null, input.cancelReasonLabel ?? (() => ''), input.telegramMoney ?? (() => ''),
    // N13: the REAL kernel, not a local re-implementation -- if the Telegram
    // line and the stored cashier_name ever disagreed, that is the bug.
    actorSnapshot.actorSnapshot,
  )
}

const baseInput = (user) => ({
  sale: { receipt_number: '20260904-100405', customer_name: 'Sok Dara' },
  id: '42', oldStatus: 'completed', saleStatus: 'cancelled', user,
})

// -- non-vacuous proof: WITHOUT the actor line, none of these would hold. --

// N13: the account USERNAME wins -- the shop channel must name the same
// identity the sale row stores as cashier_name, and the fixture session
// carries a display name that differs so the two are distinguishable.
{
  const event = buildEvent(baseInput({ name: 'Za', username: 'za01' }))
  assert.equal(event.type, 'status')
  assert.deepEqual(event.lines.filter(Boolean).filter((line) => line.startsWith('By')), ['By: za01'])
  assert.equal(event.lines[event.lines.length - 1], 'By: za01', 'the actor line is last, matching the existing `by` idiom in formatStockChangeTelegramLines/formatTransferTelegramLines/formatReturnTelegramLines')
  console.log('PASS 1: a named actor produces the trailing "By: za01" line -- the username, never the display name')
}

// A session with no display name at all changes nothing: the username was
// always the value being reported.
{
  const event = buildEvent(baseInput({ name: '', username: 'za01' }))
  assert.ok(event.lines.includes('By: za01'), 'the username is reported whether or not a display name exists')
  const withName = buildEvent(baseInput({ name: 'Za Sethy', username: 'za01' }))
  assert.deepEqual(
    withName.lines.filter((line) => line.startsWith('By')), event.lines.filter((line) => line.startsWith('By')),
    'the display name has no influence on the actor line',
  )
  console.log('PASS 2: the actor line is identical with and without a display name')
}

// No actor at all (defensive: requireAuth should always set one, but the
// line must still degrade sanely if it somehow does not) -- no dangling
// "By: undefined" / "By: null", and no bare "By:" line either.
{
  const event = buildEvent(baseInput(null))
  assert.ok(!event.lines.some((line) => line.startsWith('By')), 'with no known actor, the whole line is omitted -- never "By: undefined"')
  const noAccount = buildEvent(baseInput({ id: 7, name: 'Za Sethy' }))
  assert.ok(!noAccount.lines.some((line) => line.startsWith('By')), 'a session with a display name but NO account username still prints no actor line')
  assert.ok(!event.lines.some((line) => /undefined|null/.test(line)), 'no line anywhere prints the literal "undefined"/"null"')
  console.log('PASS 3: a missing actor omits the line entirely, the same degrade-gracefully idiom `by` already uses elsewhere')
}

// ---- 2. the REAL bilingual pipeline actually carries the Khmer line -------
// Mirrors sendTelegramEvent's own composition (lib/telegram.ts) without
// needing the DB-backed config lookup: heading + lines, each cleaned and
// localized, blanks dropped.
function cleanLine(value, max = 400) {
  return String(value ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max)
}
function composeMessage(event) {
  return [
    telegramLang.localizeTelegramHeading('🧾 Receipt status updated'),
    ...event.lines.map((line) => telegramLang.localizeTelegramLine(cleanLine(line))),
  ].filter(Boolean).join('\n')
}

{
  const withActor = buildEvent(baseInput({ name: 'Za', username: 'za01' }))
  const text = composeMessage(withActor)
  assert.ok(text.includes('By / ដោយ: za01'), `composed message must carry the bilingual actor line, got:\n${text}`)
  assert.ok(/[ក-៿]/.test(text), 'the composed message must contain Khmer script somewhere')
  console.log('PASS 4: the composed message carries "By / ដោយ: za01" -- English label, Khmer label, one value')
}

{
  const noActor = buildEvent(baseInput(null))
  const text = composeMessage(noActor)
  assert.ok(!text.includes('By'), `with no actor, no "By" line (bilingual or not) should appear, got:\n${text}`)
  console.log('PASS 5: with no actor, the composed message has no "By" line at all (bilingual or not)')
}

console.log('All Telegram status-actor tests passed')
