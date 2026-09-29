// SCAN2 RT-4: a scheduled backup that fails every tick left the Backup page
// listing nothing new, so the owner only learned of it when a restore was
// needed. The page now shows the newest FINISHED backup's age and flags it
// overdue once a scheduled backup has been missed.
//
// Run: node tests/backupFreshness.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (relative: string) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8')

const HOUR_MS = 60 * 60 * 1000
const NOW = Date.parse('2026-09-30T12:00:00.000Z')
const hoursAgo = (hours: number) => new Date(NOW - hours * HOUR_MS).toISOString()
const paidSchedule = { intervalHours: 6, automatic: true }

let failed = 0
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed++
    console.error(`FAIL ${name}\n  ${(error as Error)?.message}`)
  }
}

await check('the Backup page shows the newest finished backup from GET /api/backups', () => {
  const api = read('../src/api/systemJobs.ts')
  assert.match(api, /export async function listBackups\(\)[\s\S]{0,200}apiFetch\('GET', '\/api\/backups'\)/,
    'systemJobs.ts has no GET /api/backups reader')
  const page = read('../src/components/utils-settings/Backup.tsx')
  assert.match(page, /<BackupFreshnessNote\b/, 'Backup.tsx never renders the backup age')
  assert.match(page, /describeBackupFreshness\(/, 'Backup.tsx does not derive the age from the listing')
  assert.match(page, /data-testid="backup-freshness"/)
})

await check('the listing says whether this plan runs automatic backups', () => {
  const route = read('../../cloudflare/src/routes/backups.ts')
  assert.match(route, /automatic: getPlanLimits\(c\.env\)\.scheduledBackupEnabled/,
    'GET /api/backups must say whether scheduled backups run, or a free-plan page is always overdue')
})

const freshness = await import('../src/utils/backupFreshness.ts').catch((error: Error) => {
  failed++
  console.error(`FAIL backupFreshness.ts is missing\n  ${error.message}`)
  return null
})

if (freshness) {
  const { describeBackupFreshness } = freshness

  await check('a newer backup that is still copying is not counted as finished', () => {
    const result = describeBackupFreshness({
      items: [
        { uploaded: hoursAgo(0.5), finalized: false, status: 'copying' },
        { uploaded: hoursAgo(20), finalized: true, status: 'finalized' },
        { uploaded: hoursAgo(3), finalized: false, status: 'partial' },
      ],
      schedule: paidSchedule,
    }, NOW)
    assert.equal(result.takenAt, hoursAgo(20))
    assert.equal(Math.round(result.ageHours ?? -1), 20)
    assert.equal(result.overdue, true)
  })

  await check('the newest finished backup wins whatever order the list arrives in', () => {
    const result = describeBackupFreshness({
      items: [
        { uploaded: hoursAgo(9), finalized: true },
        { uploaded: 'not a date', finalized: true },
        { uploaded: hoursAgo(2), finalized: true },
        { uploaded: null, finalized: true },
      ],
      schedule: paidSchedule,
    }, NOW)
    assert.equal(result.takenAt, hoursAgo(2))
    assert.equal(result.overdue, false)
  })

  await check('a normal cycle is not overdue; a missed scheduled backup is', () => {
    const at = (hours: number) => describeBackupFreshness({
      items: [{ uploaded: hoursAgo(hours), finalized: true }],
      schedule: paidSchedule,
    }, NOW).overdue
    assert.equal(at(7), false, 'one interval plus the asset copy is the normal peak')
    assert.equal(at(12.9), false)
    assert.equal(at(13.1), true)
    const slowerSchedule = describeBackupFreshness({
      items: [{ uploaded: hoursAgo(20), finalized: true }],
      schedule: { intervalHours: 12, automatic: true },
    }, NOW)
    assert.equal(slowerSchedule.overdue, false, 'the threshold follows the server interval')
    assert.equal(slowerSchedule.overdueAfterHours, 25)
  })

  await check('no finished backup at all is overdue while backups are automatic', () => {
    const result = describeBackupFreshness({ items: [{ uploaded: hoursAgo(1), finalized: false }], schedule: paidSchedule }, NOW)
    assert.equal(result.takenAt, null)
    assert.equal(result.ageHours, null)
    assert.equal(result.overdue, true)
  })

  await check('a plan without automatic backups is never flagged overdue', () => {
    for (const items of [[], [{ uploaded: hoursAgo(200), finalized: true }]]) {
      const result = describeBackupFreshness({ items, schedule: { intervalHours: 6, automatic: false } }, NOW)
      assert.equal(result.overdue, false)
    }
  })

  await check('a clock ahead of the server never shows a negative age', () => {
    const result = describeBackupFreshness({ items: [{ uploaded: hoursAgo(-0.2), finalized: true }], schedule: paidSchedule }, NOW)
    assert.equal(result.ageHours, 0)
  })
}

await check('both language packs carry the age copy with the same placeholders', () => {
  const en = JSON.parse(read('../src/lang/en.json')) as Record<string, unknown>
  const km = JSON.parse(read('../src/lang/km.json')) as Record<string, unknown>
  for (const key of ['backup_newest', 'backup_none_finished', 'backup_age_hours', 'backup_overdue', 'backup_overdue_hint']) {
    assert.equal(typeof en[key], 'string', `en.json lacks ${key}`)
    assert.equal(typeof km[key], 'string', `km.json lacks ${key}`)
    const placeholders = (value: unknown) => String(value).match(/\{\w+\}/g)?.sort().join() ?? ''
    assert.equal(placeholders(km[key]), placeholders(en[key]), `${key} placeholders differ`)
  }
  assert.match(String(en.backup_age_hours), /\{hours\}/)
  assert.match(String(en.backup_overdue_hint), /\{interval\}[\s\S]*\{hours\}/)
})

console.log(failed ? `${failed} check(s) failed` : 'all checks passed')
if (failed) process.exitCode = 1
