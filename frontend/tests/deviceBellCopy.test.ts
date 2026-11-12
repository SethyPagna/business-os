// Review L1 (12 Nov 2026): the bell's device rows carry metaKey / summaryKey, so a Khmer operator reads them in Khmer
// instead of the Worker's English fallback. Every key the Worker names must have an English and a Khmer entry in NotificationCenter.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const worker = fs.readFileSync(path.join(here, '..', '..', 'cloudflare', 'src', 'routes', 'notifications.ts'), 'utf8')
const center = fs.readFileSync(path.join(here, '..', 'src', 'components', 'shared', 'NotificationCenter.tsx'), 'utf8')
const section = worker.slice(worker.indexOf('async function buildDeviceApprovalSection'), worker.indexOf("app.get('/summary'"))

for (const key of ['notification_device_pending', 'notification_device_new_country']) {
  assert.ok(section.includes(`metaKey: '${key}'`), `the Worker row names ${key}`)
  const entry = center.slice(center.indexOf(`  ${key}: {`), center.indexOf(`  ${key}: {`) + 600)
  assert.match(entry, /en: \(/, `${key} has English copy`)
  assert.match(entry, /km: \([\s\S]*?[ក-៿]/, `${key} has Khmer copy`)
}
assert.ok(section.includes("summaryKey: 'notification_security_summary'"), 'the section names its summary copy')
const summary = center.slice(center.indexOf('  notification_security_summary: {'), center.indexOf('  notification_system_drive_sync_summary: {'))
assert.match(summary, /en: /)
assert.match(summary, /km: [\s\S]*?[ក-៿]/)
assert.ok(section.includes('metaParams: { username: entry.username }'), 'params match what the copy reads')

console.log('PASS bell device rows carry keys with English and Khmer copy')
