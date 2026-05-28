import assert from 'node:assert/strict'
import fs from 'node:fs'

const barrel = fs.readFileSync(new URL('../src/components/utils-settings/index.ts', import.meta.url), 'utf8')
const jsxModules = fs.readFileSync(new URL('../src/types/jsx-modules.d.ts', import.meta.url), 'utf8')

assert.match(barrel, /export \{ default as AuditLog \} from '\.\/AuditLog\.jsx'/)
assert.match(barrel, /export \{ default as Backup \} from '\.\/Backup\.jsx'/)
assert.match(barrel, /export \{ default as Settings \} from '\.\/Settings\.jsx'/)
assert.match(barrel, /export \{ ResetData, FactoryReset \} from '\.\/ResetData\.jsx'/)
assert.match(barrel, /export \{ default as FontFamilyPicker \} from '\.\/FontFamilyPicker\.jsx'/)
assert.match(barrel, /export \{ default as OtpModal \} from '\.\/OtpModal\.jsx'/)
assert.match(jsxModules, /export const ResetData: unknown/)
assert.match(jsxModules, /export const FactoryReset: unknown/)

console.log('PASS utils-settings TypeScript barrel')
