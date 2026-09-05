import assert from 'node:assert/strict'
import fs from 'node:fs'
import './legacySubtotalRepair.test.ts'

const barrel = fs.readFileSync(new URL('../src/components/utils-settings/index.ts', import.meta.url), 'utf8')
const jsxModulesPath = new URL('../src/types/jsx-modules.d.ts', import.meta.url)

assert.match(barrel, /export \{ default as AuditLog \} from '\.\/AuditLog'/)
assert.match(barrel, /export \{ default as Backup \} from '\.\/Backup'/)
assert.match(barrel, /export \{ default as Settings \} from '\.\/Settings'/)
assert.match(barrel, /export \{ ResetData, FactoryReset \} from '\.\/ResetData'/)
assert.match(barrel, /export \{ default as FontFamilyPicker \} from '\.\/FontFamilyPicker'/)
assert.match(barrel, /export \{ default as OtpModal \} from '\.\/OtpModal'/)
assert.equal(fs.existsSync(jsxModulesPath), false)

console.log('PASS utils-settings TypeScript barrel')
