import assert from 'node:assert/strict'
import fs from 'node:fs'

const backup = fs.readFileSync(new URL('../src/components/utils-settings/Backup.tsx', import.meta.url), 'utf8')
const compat = fs.readFileSync(new URL('../../cloudflare/src/routes/compat.ts', import.meta.url), 'utf8')
const drive = fs.readFileSync(new URL('../../cloudflare/src/lib/googleDrive.ts', import.meta.url), 'utf8')

assert.match(backup, /window\.open\(pendingAuthUrl, 'business-os-drive-oauth', 'popup,width=560,height=720'\)/)
assert.match(backup, /event\?\.data\?\.type !== 'business-os-drive-sync'/)
assert.match(backup, /event\.origin !== window\.location\.origin/)
assert.match(backup, /event\.source !== driveOauthPopupRef\.current/)
assert.match(backup, /driveOauthPopupRef\.current = null/)
assert.match(backup, /window\.location\.assign\(pendingAuthUrl\)/)
assert.doesNotMatch(backup, /target="_blank"/)
assert.match(backup, /queueGoogleDriveRestoreStage/)
assert.match(backup, /data-testid="backup-drive-stage-restore"/)
assert.match(backup, /canRestore=\{hasPermission\('backup_restore'\)\}/)
assert.match(backup, /setFolderImportPath\(backupKey\)[\s\S]*setBackupSection\('restore'\)/)

assert.match(compat, /type: 'business-os-drive-sync'/)
assert.match(compat, /window\.opener\.postMessage\(payload,targetOrigin\)/)
assert.match(compat, /const targetOrigin = safeJson\(parsedTarget\.origin\)/)
assert.doesNotMatch(compat, /postMessage\([^\n]*,'\*'\)/)
assert.match(compat, /\/system\/drive-sync\/restore-stage\/jobs/)
assert.match(drive, /DRIVE_OAUTH_STATE_TTL_SECONDS = 10 \* 60/)
assert.match(drive, /url\.searchParams\.set\('code_challenge_method', 'S256'\)/)
assert.match(drive, /await env\.CACHE\.delete\(driveOauthStateKey\(payload\.nonce\)\)/)

console.log('PASS Drive OAuth popup handshake uses exact origins plus expiring one-time PKCE state')
