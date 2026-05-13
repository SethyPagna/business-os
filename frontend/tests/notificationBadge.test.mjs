import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/components/shared/NotificationCenter.jsx', import.meta.url), 'utf8')

assert.match(source, /const badgeCount = open \? 0 : activeAlertCount/)
assert.doesNotMatch(source, /badgeSuppressed/)
assert.doesNotMatch(source, /NOTIFICATION_SEEN_KEY/)

console.log('PASS notification badge stays visible until the panel is opened')
