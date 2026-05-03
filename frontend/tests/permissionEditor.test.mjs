import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/components/users/PermissionEditor.jsx', import.meta.url), 'utf8')
const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8'))
const km = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8'))

assert.match(source, /PERMISSION_SECTIONS/)
assert.match(source, /backup_restore/)
assert.match(source, /drive_credentials/)
assert.match(source, /business_identity/)
assert.match(source, /permission_sensitive_critical/)
assert.match(source, /section\.permissions\.map/)

const requiredKeys = [
  'perm_section_admin',
  'perm_section_operations',
  'perm_section_sensitive',
  'perm_backup_restore',
  'perm_business_identity',
  'perm_sales_policy',
  'perm_security_settings',
  'perm_drive_credentials',
  'perm_destructive_delete',
  'permission_sensitive_critical',
  'permission_sensitive_high',
  'permission_sensitive_normal',
]

for (const key of requiredKeys) {
  assert.ok(en[key], `English permission label missing: ${key}`)
  assert.ok(km[key], `Khmer permission label missing: ${key}`)
}

console.log('PASS PermissionEditor exposes page/action-sensitive permission groups with English/Khmer labels')
