#!/usr/bin/env node
// A route that takes an item out of a bell section must move the data version that section is stamped with BEFORE it responds (awaited, not in waitUntil),
// or the acting admin's section-scoped fresh read (?fresh=sales, routes/notifications.ts) re-serves the cached entry and the resolved alert stays listed.
// Source-shape check, one case per resolving route: the handler awaits a bump naming the right version, no bump hides in waitUntil, and the last awaited bump comes
// before the handler's last `return` (a bump moved after the response is dead code).
// Run: node scripts/test-bell-resolving-routes-bump-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.join(__dirname, '..', 'src')
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n')

function handlerText(file, startMarker, endRe = /\napp\./) {
  const text = read(file)
  const start = text.indexOf(startMarker)
  assert.ok(start >= 0, `${file}: ${startMarker} not found`)
  const rest = text.slice(start + startMarker.length)
  const end = rest.search(endRe)
  return startMarker + (end < 0 ? rest : rest.slice(0, end))
}

const BUMP = /await\s+(bumpVersions?|bumpBulkStatus|bumpSaleBulkUpdate)\(([^)]*)\)/g

function check(label, file, startMarker, versionPattern) {
  const body = handlerText(file, startMarker)
  const bumps = [...body.matchAll(BUMP)]
  assert.ok(bumps.length > 0, `${label}: no awaited version bump`)
  assert.ok(bumps.some((m) => versionPattern.test(m[0])), `${label}: no awaited bump of ${versionPattern}`)
  assert.ok(!/waitUntil\(.*\bbump/.test(body), `${label}: a bump runs in waitUntil, after the response`)
  const lastBump = Math.max(...bumps.map((m) => m.index))
  const lastReturn = body.lastIndexOf('return ')
  assert.ok(lastBump < lastReturn, `${label}: the last awaited bump comes after the handler's last return`)
  console.log(`PASS ${label}`)
}

check('portal review bumps customers before responding', 'routes/portal.ts', "app.patch('/submissions/:id/review'", /customers/)
check('import cancel bumps products before responding', 'routes/importJobs.ts', "app.post('/:id/cancel'", /products/)
check('import delete bumps products before responding', 'routes/importJobs.ts', 'async function handleDelete(', /products/)
check('import retry bumps products before responding', 'routes/importJobs.ts', "app.post('/:id/retry'", /products/)
check('sale status change bumps sales before responding', 'routes/sales.ts', "app.patch('/:id/status'", /sales/)
check('sale customer change bumps sales before responding', 'routes/sales.ts', "app.patch('/:id/customer'", /sales/)
check('sale lines added bump sales before responding', 'routes/sales.ts', "app.post('/:id/items'", /sales/)
check('sale amendments bump sales before responding', 'routes/sales.ts', "app.post('/:id/amendments'", /sales/)
check('bulk status bumps sales before responding', 'routes/sales.ts', "app.post('/bulk-status'", /bumpBulkStatus/)
check('bulk update bumps sales before responding', 'routes/sales.ts', "app.post('/bulk-update'", /bumpSaleBulkUpdate/)

assert.match(handlerText('lib/saleBulkStatus.ts', 'export async function bumpBulkStatus(', /\nexport /), /'sales'/, 'bumpBulkStatus moves the sales version')
assert.match(handlerText('lib/saleBulkUpdate.ts', 'export async function bumpSaleBulkUpdate(', /\nexport /), /\['sales'/, 'bumpSaleBulkUpdate moves the sales version')
console.log('PASS the bulk helpers move the sales version')
console.log('all green')
