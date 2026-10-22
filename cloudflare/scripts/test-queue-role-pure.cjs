#!/usr/bin/env node
// Which consumer does a queue batch belong to? src/index.ts's queue() used to
// compare batch.queue with four literal names (business-os-import, ...), so a
// second deployment whose queues are named bmshop-import, bmshop-media, ...
// would have had every batch silently dropped. src/lib/queueRole.ts now reads
// the role from the name's suffix. Runs the REAL module, then holds both
// wrangler configs to it: every consumer queue they declare must resolve to
// exactly one role, and all four roles must be covered.
//
// Run (from cloudflare/): node scripts/test-queue-role-pure.cjs
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const { readConfig } = require('./harness/wrangler_vars.cjs')

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'queueRole.ts')
const moduleObj = { exports: {} }
new Function('exports', 'require', 'module', ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: sourcePath,
}).outputText)(moduleObj.exports, require, moduleObj)
const { queueRole } = moduleObj.exports

let checks = 0
const check = (label, fn) => { fn(); checks += 1; process.stdout.write('  ok  ' + label + '\n') }

check('every deployment\'s queue names resolve to the role in their suffix', () => {
  const cases = [
    ['business-os-import', 'import'],
    ['bmshop-import', 'import'],
    ['business-os-import-dlq', 'import-dlq'],
    ['bmshop-import-dlq', 'import-dlq'],
    ['business-os-media', 'media'],
    ['bmshop-media', 'media'],
    ['business-os-backup-assets', 'backup-assets'],
    ['bmshop-backup-assets', 'backup-assets'],
  ]
  for (const [name, role] of cases) assert.strictEqual(queueRole(name), role, name)
})

check('the dead-letter queue is never mistaken for the import queue it belongs to', () => {
  // "...-import-dlq" does not end in "-import", but the pair is the pair most
  // likely to be swapped: an import batch sent to the dead-letter handler (or
  // the reverse) would fail jobs or retry forever.
  assert.notStrictEqual(queueRole('bmshop-import-dlq'), queueRole('bmshop-import'))
  assert.strictEqual(queueRole('x-import-dlq'), 'import-dlq')
  assert.strictEqual(queueRole('x-import'), 'import')
})

check('a bare role name is the role (a deployment may name its queue just "import")', () => {
  for (const role of ['import', 'import-dlq', 'media', 'backup-assets']) assert.strictEqual(queueRole(role), role, role)
})

check('a name that only contains or resembles a role is not a role', () => {
  for (const name of [
    'importer', 'business-os-imports', 'business-os-importer', 'myimport', 'reimport', 'xmedia', 'media-x',
    'import-x', 'import_dlq', 'business-os-import_dlq', 'business-os-import-', 'business-os-backup', 'backup', 'assets',
    'business-os', 'dlq', 'business-os-media-backup', 'IMPORTED',
  ]) {
    assert.strictEqual(queueRole(name), null, name)
  }
})

check('an absent or non-string name has no role', () => {
  for (const name of ['', '   ', undefined, null, 0, false, {}, [], NaN]) assert.strictEqual(queueRole(name), null, String(name))
})

check('the last segment decides: a role earlier in the name does not', () => {
  assert.strictEqual(queueRole('media-import'), 'import')
  assert.strictEqual(queueRole('import-media'), 'media')
  assert.strictEqual(queueRole('backup-assets-import'), 'import')
  assert.strictEqual(queueRole('import-backup-assets'), 'backup-assets')
})

check('each wrangler config declares four consumer queues, one per role, and every producer queue has its consumer', () => {
  for (const file of ['wrangler.toml', 'wrangler.free.toml']) {
    const text = readConfig(file)
    // `queue = "..."` directly under a [[queues.consumers]] / [[queues.producers]] header.
    const named = (kind) => [...text.matchAll(new RegExp('\\[\\[queues\\.' + kind + '\\]\\]\\n(?:[^\\[\\n][^\\n]*\\n)*?queue = "([^"]+)"', 'g'))].map((match) => match[1])
    const consumers = named('consumers')
    const producers = named('producers')
    assert.strictEqual(consumers.length, 4, file + ': four consumers (import, dead-letter, media, backup-assets)')
    const roles = consumers.map(queueRole)
    assert.ok(!roles.includes(null), file + ': a consumer queue has no role, so its batches would be dropped: ' + consumers.join(', '))
    assert.deepStrictEqual([...roles].sort(), ['backup-assets', 'import', 'import-dlq', 'media'], file + ': each role exactly once')
    assert.ok(producers.length >= 3, file + ': the producers were read, not missed (' + producers.length + ')')
    for (const queue of producers) {
      assert.ok(consumers.includes(queue), file + ': producer queue ' + queue + ' has no consumer')
    }
    const deadLetter = /dead_letter_queue = "([^"]+)"/.exec(text)
    assert.ok(deadLetter && queueRole(deadLetter[1]) === 'import-dlq', file + ': the dead_letter_queue resolves to the dead-letter handler')
    assert.ok(consumers.includes(deadLetter[1]), file + ': the dead-letter queue has a consumer')
  }
})

process.stdout.write('\nqueue role: ' + checks + ' checks passed\n')
