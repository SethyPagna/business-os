// Review M2 (12 Nov 2026): when the status check answers expired/missing, or the automatic wait stops, the ticket (10 minutes) is
// already dead. The screen must drop it so "Check again" re-submits the sign-in (password) or leaves the wait (Google) instead of
// asking a dead ticket again for ever.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const login = fs.readFileSync(path.join(here, '..', 'src', 'components', 'auth', 'Login.tsx'), 'utf8')
const check = login.slice(login.indexOf('const checkDeviceNow'), login.indexOf('useEffect(() => {', login.indexOf('const checkDeviceNow')))
assert.match(check, /else \{ setDeviceTicket\(''\); setDeviceWaitStopped\(true\) \}/, 'an expired or missing answer clears the ticket')
assert.match(check, /if \(deviceTicket && authApi\.getDeviceApprovalStatus\)[\s\S]*?if \(passwordRef\.current\) \{\s*await handleLoginRef\.current/, 'with no ticket Check again re-submits the password')
assert.match(check, /leaveDeviceWait\(\)\s*\}\s*$/, 'and leaves the wait when there is no password (Google)')
const stopped = login.slice(login.indexOf('onStopped:'), login.indexOf('onStopped:') + 400)
assert.match(stopped, /else \{ setDeviceTicket\(''\); setDeviceWaitStopped\(true\) \}/, 'the automatic wait stopping clears the ticket too')
console.log('PASS waiting screen drops a dead device ticket so Check again continues')
