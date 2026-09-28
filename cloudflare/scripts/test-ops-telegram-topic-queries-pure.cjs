#!/usr/bin/env node
// Fixture checks for ops/queries/telegram-topic-status.sql and telegram-topic-audit.sql, run after the
// read-only guard canonicalises them, against the real migration chain in an in-memory SQLite.
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const { pathToFileURL } = require('url')
const { DatabaseSync } = require('node:sqlite')
const { loadAll } = require('./harness/load_migrations.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const LIB = path.join(ROOT, 'cloudflare', 'src', 'lib')
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

// The Worker's own rules, cut out of its source and transpiled, so the query is compared with the code
// that actually decides, not with a copy of it.
function declarationsFrom(file, names) {
  const text = fs.readFileSync(path.join(LIB, file), 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true)
  const found = new Map()
  for (const statement of source.statements) {
    const declared = ts.isFunctionDeclaration(statement) && statement.name ? [statement.name.text]
      : ts.isVariableStatement(statement) ? statement.declarationList.declarations.map((d) => d.name.getText(source))
        : []
    for (const name of declared) if (names.includes(name)) found.set(name, statement.getText(source).replace(/^export\s+/, ''))
  }
  for (const name of names) assert.ok(found.has(name), `${file} no longer declares ${name}`)
  const js = ts.transpileModule(names.map((name) => found.get(name)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return (inputs = {}) => new Function(...Object.keys(inputs), `${js}\nreturn { ${names.join(', ')} }`)(...Object.values(inputs))
}

const { firstCharacters } = declarationsFrom('telegramLang.ts', ['graphemeSegmenter', 'graphemes', 'codePoints', 'firstCharacters'])()
const worker = declarationsFrom('telegram.ts', ['TELEGRAM_TOPIC_KEYS', 'parseTelegramTopicId', 'cleanLine', 'parseChatIds'])({ firstCharacters })

const JS_TRIMMED = [...Array(0x10000).keys()].map((code) => String.fromCharCode(code)).filter((c) => c.trim() === '')

const TOPIC_FIXTURES = [
  '', '0', '00', '12', ' 12 ', '\t12\n', '012', 'abc', '1.5', '-5', '12a', '+12', '1e3', '0x1F', 12, null,
  '9007199254740991', '9007199254740992', '9007199254740993', '99999999999999999999', '00000000000000000000012',
  ' 12', '12 ', '\v12', '\f12', '﻿12', '12 ', '１２',
  '​12', '\u008512', '᠎12',
  ...JS_TRIMMED.map((w) => `${w}34${w}`),
]

const CHAT_FIXTURES = [
  '', ' ', null, '@shopgroup', 'abc', ',', '-', '--1', '1-2', '-100', '100', ' -100 ', '<-100>', ' -100',
  '-100,-200', '7,-100', '@name,-100', 'x;-5;7', 'abc def 55', '-1001234567890 ; 42',
  '12345678901234567890123456789012345678901234567', '1234567890123456789012345678901234567890x',
  ...JS_TRIMMED.map((w) => `-100${w}200`),
]

// The audit columns are built by the same changedFields/auditChangeColumns every settings door uses.
function loadAuditModule() {
  const js = ts.transpileModule(fs.readFileSync(path.join(LIB, 'audit.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const m = { exports: {} }
  const noDb = { getDb: () => { throw new Error('the audit columns are built without a database') } }
  new Function('require', 'module', 'exports', js)((name) => (name === './db' ? noDb : require(name)), m, m.exports)
  return m.exports
}

function freshDb() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = OFF;')
  for (const sql of loadAll()) db.exec(sql)
  db.exec("DELETE FROM settings WHERE key LIKE 'telegram%'")
  return db
}

;(async () => {
  const guard = await load('ops/scripts/ops-sql-guard.mjs')
  const status = guard.loadQuery('telegram-topic-status')
  const auditQuery = guard.loadQuery('telegram-topic-audit')
  assert.deepStrictEqual(status.rules, { minRows: 1, maxRows: 1, expectZero: null })
  assert.deepStrictEqual(auditQuery.rules, { minRows: 0, maxRows: 50, expectZero: null })

  const db = freshDb()
  const put = (key, value) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value)
  const stored = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value
  const clear = () => db.exec("DELETE FROM settings WHERE key LIKE 'telegram%'")
  const statusRow = () => {
    const rows = db.prepare(status.sql).all()
    assert.strictEqual(rows.length, 1, 'the status query always returns exactly one row')
    return { ...rows[0] }
  }

  const empty = statusRow()
  const topicColumns = worker.TELEGRAM_TOPIC_KEYS.map((key) => key.replace(/^telegram_/, ''))
  assert.deepStrictEqual(Object.keys(empty), ['chat_configured', 'alerts_chat_is_group', 'approved_chats', ...topicColumns],
    'one column per TELEGRAM_TOPIC_KEYS entry, in its order, and nothing else')
  assert.ok(Object.values(empty).every((value) => value === 0), `an empty settings table reads all zero: ${JSON.stringify(empty)}`)
  console.log('PASS empty settings: one all-zero row; the topic columns are TELEGRAM_TOPIC_KEYS in order')

  for (const key of worker.TELEGRAM_TOPIC_KEYS) {
    clear()
    put(key, '9001')
    const row = statusRow()
    for (const other of worker.TELEGRAM_TOPIC_KEYS) {
      assert.strictEqual(row[other.replace(/^telegram_/, '')], other === key ? 1 : 0, `${key} set: column for ${other}`)
    }
  }
  console.log('PASS each topic column reads its own settings key only')

  const topicMismatches = []
  TOPIC_FIXTURES.forEach((fixture, index) => {
    const key = worker.TELEGRAM_TOPIC_KEYS[index % worker.TELEGRAM_TOPIC_KEYS.length]
    clear()
    put(key, fixture)
    const want = worker.parseTelegramTopicId(stored(key)) === undefined ? 0 : 1
    const got = statusRow()[key.replace(/^telegram_/, '')]
    if (got !== want) topicMismatches.push(`${JSON.stringify(fixture)} sql=${got} worker=${want}`)
  })
  assert.deepStrictEqual(topicMismatches, [], 'topic flags must equal parseTelegramTopicId on the stored value')
  console.log(`PASS ${TOPIC_FIXTURES.length} topic fixtures (${JS_TRIMMED.length} JS trim characters among them): 0 mismatches with parseTelegramTopicId`)

  const chatMismatches = []
  for (const fixture of CHAT_FIXTURES) {
    clear()
    put('telegram_chat_id', fixture)
    const ids = worker.parseChatIds(stored('telegram_chat_id') ?? undefined)
    const want = { chat_configured: ids.length ? 1 : 0, alerts_chat_is_group: ids.length && ids[0].startsWith('-') ? 1 : 0, approved_chats: ids.length }
    const row = statusRow()
    const got = { chat_configured: row.chat_configured, alerts_chat_is_group: row.alerts_chat_is_group, approved_chats: row.approved_chats }
    if (JSON.stringify(got) !== JSON.stringify(want)) chatMismatches.push(`${JSON.stringify(fixture)} sql=${JSON.stringify(got)} worker=${JSON.stringify(want)}`)
  }
  assert.deepStrictEqual(chatMismatches, [], 'chat flags must equal parseChatIds on the stored value')
  console.log(`PASS ${CHAT_FIXTURES.length} chat fixtures: 0 mismatches with parseChatIds (configured, first entry a group, approved count)`)

  const { changedFields, auditChangeColumns } = loadAuditModule()
  const auditRow = (userName, entity, details, before, after, keys) => {
    const columns = auditChangeColumns(changedFields(before, after, keys ? { keys } : {}))
    return db.prepare('INSERT INTO audit_logs (user_name, action, entity, details, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userName, 'update', entity, JSON.stringify(details), columns.old_value, columns.new_value).lastInsertRowid
  }
  db.exec('DELETE FROM audit_logs')
  const saved = auditRow('owner', 'settings', { keys: ['telegram_topic_sales', 'theme'] }, { telegram_topic_sales: '', theme: 'light' }, { telegram_topic_sales: '9002', theme: 'light' }, ['telegram_topic_sales', 'theme'])
  const resent = auditRow('owner', 'settings', { keys: ['telegram_topic_sales', 'theme'] }, { telegram_topic_sales: '9002', theme: 'light' }, { telegram_topic_sales: '9002', theme: 'dark' }, ['telegram_topic_sales', 'theme'])
  const settopic = auditRow('telegram:@owner', 'settings', { keys: ['telegram_topic_stock'], source: 'telegram', command: '/settopic' }, {}, { telegram_topic_stock: '9006' }, ['telegram_topic_stock'])
  const settopicSame = auditRow('telegram:@owner', 'settings', { keys: ['telegram_topic_stock'], source: 'telegram', command: '/settopic' }, { telegram_topic_stock: '9006' }, { telegram_topic_stock: '9006' }, ['telegram_topic_stock'])
  const ops = auditRow('ops:settings-upsert', 'settings', { keys: ['telegram_topic_shift'], source: 'ops' }, {}, { telegram_topic_shift: '9001' }, ['telegram_topic_shift'])
  const cleared = auditRow('manager', 'settings', { keys: ['theme', 'telegram_topic_alerts'] }, { theme: 'light', telegram_topic_alerts: '9008' }, { theme: 'dark', telegram_topic_alerts: '' }, ['theme', 'telegram_topic_alerts'])
  const staffNamedTelegram = auditRow('Telegram desk', 'settings', { keys: ['telegram_topic_reports'] }, { telegram_topic_reports: '' }, { telegram_topic_reports: '9007' }, ['telegram_topic_reports'])
  auditRow('owner', 'products', {}, { telegram_topic_sales: '1' }, { telegram_topic_sales: '2' })
  auditRow('owner', 'settings', {}, { telegramXtopicYsales: '1' }, { telegramXtopicYsales: '2' })
  auditRow('owner', 'settings', { keys: ['portal_about_text'] }, { portal_about_text: 'a' }, { portal_about_text: 'set "telegram_topic_sales" in Settings' }, ['portal_about_text'])
  const rows = db.prepare(auditQuery.sql).all().map((row) => ({ ...row }))
  assert.deepStrictEqual(rows.map((row) => [Number(row.id), row.door]), [
    [Number(staffNamedTelegram), 'settings-save'],
    [Number(cleared), 'settings-save'],
    [Number(ops), 'ops-task'],
    [Number(settopic), 'telegram-settopic'],
    [Number(saved), 'settings-save'],
  ], `the three doors, newest first; not an unchanged resend (${resent}, ${settopicSame}), another entity, a look-alike key or a quoted key inside a value`)
  assert.deepStrictEqual(Object.keys(rows[0]), ['id', 'created_at', 'user_name', 'door'], 'no value, diff or details column is selected')
  console.log('PASS audit query: settings-save, telegram-settopic and ops-task rows only, newest first, and no value selected')

  console.log('test-ops-telegram-topic-queries-pure: ok')
})().catch((error) => { console.error(error); process.exit(1) })
