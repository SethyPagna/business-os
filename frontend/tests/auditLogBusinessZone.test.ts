// TZ-1: every Audit Log time is converted to the business zone
// (Asia/Phnom_Penh), and the zone label printed beside it (table cell, detail
// row, export column) names that same zone -- not the device zone the entry
// was captured on, "UTC" or "Server time". Runs on a device in Los Angeles so
// a device-zone formatter and a device-zone label would both disagree.
process.env.TZ = 'America/Los_Angeles'

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { BUSINESS_TIME_ZONE } from '../src/constants.ts'
import { fmtDayFirst, fmtTimezoneLabel } from '../src/utils/formatters.ts'

const source = readFileSync(new URL('../src/components/utils-settings/AuditLog.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('AuditLog.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function fn(name: string): string {
  let found: ts.FunctionDeclaration | undefined
  ast.forEachChild((node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node })
  assert.ok(found, `AuditLog.tsx declares ${name}`)
  return ts.transpileModule(found!.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
}
const HISTORY_EMPTY = '—'
const names = ['toIso', 'formatDateTime', 'formatCompactDateTime', 'formatLogTime', 'formatLogTableTime', 'auditTimezoneLabel']
const api = new Function('fmtDayFirst', 'fmtTimezoneLabel', 'BUSINESS_TIME_ZONE', 'HISTORY_EMPTY',
  `${names.map(fn).join('\n')}; return { ${names.join(', ')} }`,
)(fmtDayFirst, fmtTimezoneLabel, BUSINESS_TIME_ZONE, HISTORY_EMPTY)

// 2026-09-24 18:30:05 UTC = 25/09 01:30:05 Phnom Penh = 24/09 11:30:05 Los Angeles.
const serverRow = { created_at: '2026-09-24 18:30:05', device_tz: null }
const deviceRow = { client_time: '2026-09-24T18:30:05Z', device_tz: 'America/Los_Angeles' }
const bangkokRow = { client_time: '2026-09-24T18:30:05+00:00', device_tz: 'Asia/Bangkok' }

for (const row of [serverRow, deviceRow, bangkokRow]) {
  assert.equal(api.formatLogTime(row), '25/09/2026, 01:30:05', 'full time is Phnom Penh wall clock')
  assert.equal(api.formatLogTableTime(row), '25/09, 01:30', 'table time is Phnom Penh wall clock')
  assert.equal(api.auditTimezoneLabel(row), 'Asia/Phnom_Penh', `label names the business zone (device_tz=${row.device_tz})`)
}
assert.equal(api.auditTimezoneLabel(null), 'Asia/Phnom_Penh')
for (const wrong of ['UTC', 'Server time', 'America/Los_Angeles', 'Asia/Bangkok']) {
  assert.notEqual(api.auditTimezoneLabel(deviceRow), wrong)
}

// Every surface that shows the zone uses the one label.
assert.equal((source.match(/auditTimezoneLabel\(/g) || []).length, 4, 'declaration + table cell + detail row + export column')
assert.doesNotMatch(source, /'Server time'/, 'no Server time label left in the audit log')

console.log('PASS audit log times and their zone label are Phnom Penh business time under TZ=America/Los_Angeles')
