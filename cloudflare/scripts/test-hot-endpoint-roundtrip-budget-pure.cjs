#!/usr/bin/env node
// Pins a ceiling on sequential D1 round trips per hot mutating endpoint.
//
// Owner report / fix commit: Program 4 wave 1 (progress.md, "Program 4
// checkpoint LIVE ... performance wave 1", 2026-09-15) found the iOS/PWA lag
// was 8-18 SEQUENTIAL D1 round trips per mutating action, each a cross-region
// hop -- not CPU (the Worker runs on the paid plan). Program 4 folded several
// of these (audit() to one round trip at 135 sites: e18f46ed/ce8e4d4e;
// receive-batch movement folded into one batch: 66cffaed) but explicitly
// left Program 4 "wave 2" open (progress.md "Not yet"): inventory.ts /adjust
// round trips, contacts.ts create inline audit, returns.ts N+1 reads, and
// the remaining awaited audits in batches.ts. There was no test pinning a
// NUMERIC ceiling for any hot endpoint, so a future change could silently
// re-introduce a sequential round trip per line/loop without any red.
//
// This is a static source count, not a live D1 measurement: it counts
// `await db.prepare(...)` / `await db.batch(...)` / `await c.env.DB...`
// occurrences textually inside each named handler's body (brace-balanced
// extraction from the `app.<verb>('<path>', async (c) => { ... })` call).
// A `db.batch([...])` call -- however many statements it holds -- counts as
// ONE round trip, matching the fix pattern used across Program 4.
//
// Ceilings below are the CURRENT counts on the Program 4 tip (38a3eb5e) plus
// a small margin for legitimate future single-statement additions. If this
// goes red because a handler now issues MORE round trips, that is either a
// real regression (fix it) or a deliberate widening (raise the ceiling here
// and say why in the commit message -- never silently).
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const ROUTES = path.join(__dirname, '..', 'src', 'routes')
const read = (file) => fs.readFileSync(path.join(ROUTES, file), 'utf8').replace(/\r\n/g, '\n')

let checks = 0
const check = (label, fn) => { fn(); checks++; process.stdout.write(`  ok  ${label}\n`) }

// Extract the handler body registered as app.<verb>('<routePath>', async (c) => { ... })
// by brace-balancing from the first `{` after the signature to its match.
function extractHandler(source, verb, routePath) {
  const needle = `app.${verb}('${routePath}', async (c) => {`
  const start = source.indexOf(needle)
  assert.ok(start >= 0, `route signature not found: ${needle}`)
  return extractFrom(source, start, needle.length)
}

// Same brace-balanced extraction, but for a signature given verbatim (used
// where the route path is a variable, e.g. `app.post(config.path, ...)`).
function extractHandlerLiteral(source, needle) {
  const start = source.indexOf(needle)
  assert.ok(start >= 0, `route signature not found: ${needle}`)
  return extractFrom(source, start, needle.length)
}

function extractFrom(source, start, needleLength) {
  const bodyStart = start + needleLength - 1 // index of the opening '{'
  let depth = 0
  for (let i = bodyStart; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return source.slice(bodyStart, i + 1)
    }
  }
  throw new Error(`unbalanced braces extracting handler starting at ${start}`)
}

// Count D1 round trips: await db.prepare(...).{run|all|get|first}(...) and
// await db.batch([...]) each count once. Nested .bind() chains before the
// terminal call do not add a round trip (still one network hop).
function countRoundTrips(body) {
  const prepareCalls = (body.match(/await\s+(?:db|c\.env\.DB)\.prepare\(/g) || []).length
  const batchCalls = (body.match(/await\s+(?:db|c\.env\.DB)\.batch\(/g) || []).length
  return prepareCalls + batchCalls
}

check('POST /sales (sale create) stays at or below its round-trip ceiling', () => {
  const body = extractHandler(read('sales.ts'), 'post', '/')
  const n = countRoundTrips(body)
  assert.ok(n <= 15, `POST /sales issues ${n} sequential D1 round trips (ceiling 15, current 13) -- Program 4 folded audit() to one hop; a new per-line query would regress iOS lag`)
})

check('POST /inventory/adjust (stock add/remove/set) stays at or below its round-trip ceiling', () => {
  const body = extractHandler(read('inventory.ts'), 'post', '/adjust')
  const n = countRoundTrips(body)
  // Program 4 "wave 2 not yet" names this handler explicitly as unfolded;
  // ceiling records today's count so the next lane that touches it proves
  // it did not make things worse while it is still open.
  assert.ok(n <= 18, `POST /inventory/adjust issues ${n} sequential D1 round trips (ceiling 18, current 16; wave-2 target is lower) -- see progress.md Program 4 "Not yet"`)
})

check('POST /batches (receive stock into a batch) stays at or below its round-trip ceiling', () => {
  const body = extractHandler(read('batches.ts'), 'post', '/')
  const n = countRoundTrips(body)
  assert.ok(n <= 4, `POST /batches issues ${n} sequential D1 round trips (ceiling 4, current 2) -- 66cffaed folded the movement insert into one batch; per-lot loops must not reopen it`)
})

check('POST /returns (return create) stays at or below its round-trip ceiling', () => {
  const body = extractHandler(read('returns.ts'), 'post', '/')
  const n = countRoundTrips(body)
  assert.ok(n <= 14, `POST /returns issues ${n} sequential D1 round trips (ceiling 14, current 12) -- Program 4 wave 2 names returns.ts N+1 reads as still open`)
})

check('POST /contacts (customer/supplier/delivery create) stays at or below its round-trip ceiling', () => {
  // The route path is the shared `config.path` variable, not a literal, so
  // this one is extracted by verbatim signature rather than extractHandler.
  const body = extractHandlerLiteral(read('contacts.ts'), "app.post(config.path, async (c) => {")
  const n = countRoundTrips(body)
  assert.ok(n <= 7, `POST /contacts issues ${n} sequential D1 round trips (ceiling 7, current 5) -- Program 4 wave 2 names contacts.ts create's inline audit as still unfolded`)
})

console.log(`\n${checks} checks passed`)
