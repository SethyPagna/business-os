#!/usr/bin/env node
// Fixture checks for ops/queries/forensics-tg-shift-code-bare-coeng.sql, run after the read-only guard
// canonicalises it, against the real migration chain in an in-memory SQLite.
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const { pathToFileURL } = require('url')
const { DatabaseSync } = require('node:sqlite')
const { loadAll } = require('./harness/load_migrations.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

function loadTelegramLang() {
  const js = ts.transpileModule(fs.readFileSync(path.join(ROOT, 'cloudflare', 'src', 'lib', 'telegramLang.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const m = { exports: {} }
  new Function('require', 'module', 'exports', js)(require, m, m.exports)
  return m.exports
}

const COENG = String.fromCodePoint(0x17d2)
const PREFIX = 'S-20260923-0807-'
const SHIFT_CODE_CASHIER_MAX = 24

;(async () => {
  const guard = await load('ops/scripts/ops-sql-guard.mjs')
  const query = guard.loadQuery('forensics-tg-shift-code-bare-coeng')
  assert.deepStrictEqual(query.rules, { minRows: 0, maxRows: 500, expectZero: null })

  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = OFF;')
  for (const sql of loadAll()) db.exec(sql)
  const insert = db.prepare(`INSERT INTO shift_sessions (id, revision, shift_code, scope_mode, user_id, user_name, branch_id, business_date,
    opened_at, opening_float_usd, opening_float_khr) VALUES (?, 1, ?, 'per_account', ?, ?, 1, '2026-09-23', '2026-09-23T01:07:00.000Z', 0, 0)`)
  const cutAfterCoeng = `${'ក'.repeat(22)}ស${COENG}`
  const { firstCharacters } = loadTelegramLang()
  const longKhmerNames = [`${'ក'.repeat(22)}ស្រី`, `${'ក'.repeat(21)}ស្ត្រី`, `សុខ-${'ស្រី'.repeat(6)}`, `${'ច'.repeat(23)}ន្ទ`]
  const rows = [
    [1, `${PREFIX}${cutAfterCoeng}`],
    [2, `${PREFIX}${cutAfterCoeng}-2`],
    [3, `${PREFIX}ស្រីពៅ`],
    [4, `${PREFIX}Za`],
    [5, `${PREFIX}ស្រី-2`],
    [6, `${PREFIX}U42`],
    ...longKhmerNames.map((name, index) => [7 + index, `${PREFIX}${firstCharacters(name, SHIFT_CODE_CASHIER_MAX)}`]),
  ]
  for (const [id, code] of rows) insert.run(id, code, id, 'Synthetic cashier')

  const found = db.prepare(query.sql).all()
  assert.deepStrictEqual(found.map((row) => [row.shift_id, row.suffixed]), [[1, 0], [2, 1]],
    `only the codes cut after a coeng are listed:\n${JSON.stringify(found, null, 2)}`)
  assert.ok(longKhmerNames.every((name) => [...name].length > SHIFT_CODE_CASHIER_MAX), 'every long name really crosses the cap')
  assert.deepStrictEqual(Object.keys(found[0]).sort(), ['branch_id', 'business_date', 'opened_at', 'shift_code', 'shift_id', 'suffixed', 'user_id', 'user_name'])
  console.log('PASS the query lists exactly the shift codes cut after a coeng, and none cut by today\'s firstCharacters')
})().catch((error) => { console.error(error); process.exit(1) })
