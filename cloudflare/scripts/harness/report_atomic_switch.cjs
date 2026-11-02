'use strict'
// Harness helper for tests that transpile lib/salesAnalytics.ts on its own (tmp dir + tsc) and want the atomic report reader.
// salesAnalytics imports lib/reportAtomicSwitch on demand; without the modules beside it every reader runs the legacy path.
const fs = require('node:fs')
const path = require('node:path')

const LIB = path.join(__dirname, '..', '..', 'src', 'lib')
const SIBLINGS = ['reportAtomicSwitch.ts', 'readSwitches.ts', 'analytics.ts', 'planTier.ts']

const switchRowSql = (state) => `INSERT OR REPLACE INTO system_flags(key,value) VALUES('read_switches','${JSON.stringify({ epoch: 1, switches: { report_atomic: state } })}')`

// Copies the switch modules into tmpDir, with getDb answered from env.__db like the kernel copy; returns the files to compile.
function installSwitchSiblings(tmpDir) {
  for (const file of SIBLINGS) {
    const text = fs.readFileSync(path.join(LIB, file), 'utf8').replace(/^import type \{ Env \} from '\.\.\/index'\r?\n/m, '').replace(/env: Env/g, 'env: any')
    fs.writeFileSync(path.join(tmpDir, file), '// @ts-nocheck\n' + text)
  }
  fs.writeFileSync(path.join(tmpDir, 'db.ts'), '// @ts-nocheck\nexport const getDb = (env: any) => env.__db\n')
  return [...SIBLINGS, 'db.ts']
}

module.exports = { installSwitchSiblings, switchRowSql, SWITCH_SIBLINGS: SIBLINGS }
