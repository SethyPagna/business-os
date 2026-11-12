// The Worker settles on a device id (the signed cookie's id wins when it differs
// from the browser's) and answers with it. Every sign-in path must store that
// id, or the browser keeps sending a stale one and the pair drifts apart.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => fs.readFileSync(path.join(here, '..', 'src', relative), 'utf8').replace(/\r\n/g, '\n')
const transport = read('api/authTransport.ts')
const login = read('components/auth/Login.tsx')
const worker = fs.readFileSync(path.join(here, '..', '..', 'cloudflare', 'src', 'routes', 'auth.ts'), 'utf8').replace(/\r\n/g, '\n')

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  assert.ok(from > -1, `missing ${start}`)
  const to = source.indexOf(end, from + start.length)
  assert.ok(to > from, `missing ${end}`)
  return source.slice(from, to)
}

const passwordSignIn = between(transport, 'export async function login(', 'export function logout')
assert.match(passwordSignIn, /await deviceIdentityReady\(\)[\s\S]*apiFetch\('POST', '\/api\/auth\/login'[\s\S]*adoptDeviceIdFromResponse\(result\)/, '/login waits for the restore, then adopts the answer')
const otp = between(transport, 'export async function otpVerify(', 'export function otpStatus')
assert.match(otp, /await deviceIdentityReady\(\)[\s\S]*adoptDeviceIdFromResponse\(result\)/, '/otp/verify adopts the answer too')
assert.match(between(transport, 'export async function startGoogleOauth(', 'export function completeGoogleOauth'), /await deviceIdentityReady\(\)/, 'Google start waits for the restore before it signs the id into state')
assert.match(login, /adoptDeviceIdFromResponse\(callbackResult\)\s*if \(callbackResult\.deviceApprovalRequired\)/, 'the Google callback result is adopted before any branch')

// The Worker half: each employee sign-in answer names the id it used.
for (const [start, end] of [["app.post('/login'", "app.post('/logout'"], ["app.post('/otp/verify'", '// POST /api/auth/session-duration']] as const) {
  const block = between(worker, start, end)
  assert.ok((block.match(/echoedDeviceId \? \{ deviceId: echoedDeviceId \}/g) || []).length >= 2, `${start} answers pending and success with deviceId`)
}
assert.ok((between(worker, "app.get('/oauth/callback'", "app.post('/oauth/complete'").match(/deviceId: oauthDeviceId/g) || []).length >= 4, 'the Google callback answers every employee outcome with deviceId')

console.log('PASS every sign-in path adopts the device id the Worker returns')
