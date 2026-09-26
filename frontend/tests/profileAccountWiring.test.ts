// My Profile account wiring (u-profile, 26 Sep 2026). Each lock names the bug
// it closes; every one fails on ab156302.
//
// The Worker halves are exercised for real in
// cloudflare/scripts/test-user-avatar-set-remove-pure.cjs,
// test-google-link-profile-pure.cjs and
// test-password-change-keeps-own-session-pure.cjs. These pin the client side
// that decides whether those routes are reached at all.
import assert from 'node:assert/strict'
import fs from 'node:fs'

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const profile = read('../src/components/users/UserProfileModal.tsx')
const transport = read('../src/api/userAdminTransport.ts')
const methods = read('../src/api/methods.ts')

function block(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  assert.ok(from > -1, `missing ${start}`)
  const to = source.indexOf(end, from + start.length)
  assert.ok(to > from, `missing ${end} after ${start}`)
  return source.slice(from, to)
}

await runTest('avatar upload goes to /users/avatar-upload (data URL), not the Library-gated file upload', () => {
  const save = block(profile, 'const saveAvatarFromEditor = async', 'const removeAvatar = async')
  // A File object is routed by uploadUserAvatar to /api/files/upload, which
  // refuses anyone without Library/Products access -- e.g. a cashier.
  assert.doesNotMatch(save, /uploadUserAvatar\(\{\s*file\s*\}\)/)
  assert.match(save, /uploadUserAvatar\(\{ filePath: dataUrl, fileName: 'avatar\.png' \}\)/)
})

await runTest('an uploaded avatar is attached to the account before "Avatar uploaded" is announced', () => {
  const save = block(profile, 'const saveAvatarFromEditor = async', 'const removeAvatar = async')
  const attachAt = save.indexOf('getProfileApi().setUserAvatar(')
  const notifyAt = save.indexOf("tr('avatar_uploaded'")
  assert.ok(attachAt > -1, 'setUserAvatar must be called')
  assert.ok(attachAt < notifyAt, 'success is only announced after the account holds the photo')
  assert.match(save, /updated_at: saved\?\.updated_at/, 'the fresh updated_at is carried so a later Save profile is not a stale write')
})

await runTest('the photo can be removed, behind the shared confirm dialog', () => {
  assert.match(profile, /getProfileApi\(\)\.removeUserAvatar\(requireCurrentUserId\(\)\)/)
  assert.match(profile, /<ConfirmDialog[\s\S]*?onConfirm=\{\(\) => \{ void removeAvatar\(\) \}\}/)
  assert.match(profile, /onRemove=\{\(\) => \{\s*setAvatarViewerOpen\(false\)\s*setAvatarRemoveConfirmOpen\(true\)/)
})

await runTest('avatar transport: PUT and DELETE /api/users/:id/avatar, exposed through methods', () => {
  assert.match(transport, /apiFetch\('PUT', `\/api\/users\/\$\{encodeId\(id\)\}\/avatar`, \{ avatar_path: avatarPath \}\)/)
  assert.match(transport, /apiFetch\('DELETE', `\/api\/users\/\$\{encodeId\(id\)\}\/avatar`\)/)
  assert.match(methods, /export const setUserAvatar = async/)
  assert.match(methods, /export const removeUserAvatar = async/)
})

await runTest('Disconnect Google is offered whenever Google is linked, not only when the setup is ready', () => {
  const card = block(profile, "{authMethods?.google_linked ? (\n                    <button", "connect_google")
  assert.match(card, /handleDisconnectOauthProvider\('google'\)/)
  assert.match(profile, /google_link_unavailable_note/, 'an unready deployment says so instead of silently hiding Connect')
})

await runTest('the close guard compares against the last SAVED profile, so a save leaves nothing to discard', () => {
  assert.doesNotMatch(profile, /useFormDirty\(profile\)/)
  assert.match(profile, /isDirtySince\(stableSnapshot\(editableProfileFields\(savedProfile\)\), editableProfileFields\(profile\)\)/)
  const save = block(profile, 'const handleProfileSave = async', 'const handlePasswordSave = async')
  assert.match(save, /setProfile\(nextUser\)\s*setSavedProfile\(nextUser\)/)
})

if (failed) {
  console.error(`${failed} profile wiring test(s) failed`)
  process.exit(1)
}
