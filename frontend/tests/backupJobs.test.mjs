import assert from 'node:assert/strict'
import fs from 'node:fs'

await (async function backupJobApiShouldExposeQueuedFlows() {
  const source = fs.readFileSync(new URL('../src/api/methods.js', import.meta.url), 'utf8')
  assert.match(source, /export\s+async\s+function\s+queueBackupFolderExport/)
  assert.match(source, /export\s+async\s+function\s+queueBackupFolderRestore/)
  assert.match(source, /export\s+const\s+queueGoogleDriveSyncNow/)
  console.log('PASS backup API exposes queued job flows')
})()

await (async function backupUiShouldPollJobsInsteadOfWaitingSilently() {
  const source = fs.readFileSync(new URL('../src/components/utils-settings/Backup.jsx', import.meta.url), 'utf8')
  assert.match(source, /JobProgressCard/)
  assert.match(source, /pollSystemJob/)
  assert.match(source, /queueGoogleDriveSyncNow/)
  assert.match(source, /queueBackupFolderExport/)
  assert.match(source, /queueBackupFolderRestore/)
  assert.match(source, /backup_default_path_note/)
  assert.match(source, /normalizeFolderBrowserResult/)
  assert.match(source, /advancedMaintenanceOpen/)
  assert.match(source, /<details[^>]+className=/)
  assert.doesNotMatch(source, /await\s+window\.api\.exportBackupFolder/)
  assert.doesNotMatch(source, /await\s+window\.api\.importBackupFolder/)
  console.log('PASS backup UI polls queued jobs with visible progress')
})()

await (async function legacyJsonDownloadShouldNotBufferBlobOnMainThread() {
  const source = fs.readFileSync(new URL('../src/api/methods.js', import.meta.url), 'utf8')
  const exportBackupBody = source.match(/export async function exportBackup\(\) \{[\s\S]*?\n\}/)?.[0] || ''
  assert.match(exportBackupBody, /new URL/)
  assert.match(exportBackupBody, /searchParams\.set\('token'/)
  assert.doesNotMatch(exportBackupBody, /\.blob\(/)
  assert.doesNotMatch(exportBackupBody, /URL\.createObjectURL/)
  console.log('PASS legacy JSON download avoids buffering the backup blob in React')
})()

await (async function notificationsShouldRenderThroughPortal() {
  const source = fs.readFileSync(new URL('../src/components/shared/NotificationCenter.jsx', import.meta.url), 'utf8')
  assert.match(source, /createPortal/)
  assert.match(source, /z-\[1000\]/)
  console.log('PASS notifications render above page controls')
})()
