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

// u-profile2: a username rename was decided by native window.confirm() --
// English-only, and its Cancel meant "rename only" instead of "abort". Both
// behaviours are now explicit buttons in the shared ConfirmDialog, and every
// dismissal saves nothing.
const users = read('../src/components/users/Users.tsx')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, unknown>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, unknown>
const RENAME_KEYS = [
  'rename_user_choice_title', 'rename_user_from', 'rename_user_to', 'rename_user_carry', 'rename_user_carry_desc',
  'rename_user_record_only', 'rename_user_record_only_desc', 'rename_user_history_note',
]
const nativeConfirm = /(?:\b(?:window|globalThis|self)\.confirm|(?<![\w.$])confirm)\s*\(/g
// Comments may mention confirm(); code may not. (noNativeConfirm.test.ts
// holds the AST-exact version of this lock for the whole of frontend/src.)
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')

await runTest('no native confirm() in the profile modal or the users page', () => {
  for (const [name, source] of [['UserProfileModal.tsx', profile], ['Users.tsx', users]] as const) {
    const calls = withoutComments(source).match(nativeConfirm) || []
    assert.deepEqual(calls, [], `${name} calls native confirm()`)
  }
})

await runTest('profile rename: validated save opens the rename dialog instead of sending a rename', () => {
  const save = block(profile, 'const handleProfileSave = async', 'const commitProfileSave = async')
  assert.match(save, /if \(profileUsernameChanged\) \{\s*setRenameChoiceOpen\(true\)\s*return\s*\}/)
  const commit = block(profile, 'const commitProfileSave = async', 'const handlePasswordSave = async')
  assert.match(commit, /if \(usernameChanged && !renameScope\) \{\s*setRenameChoiceOpen\(true\)\s*return\s*\}/, 'no rename is sent without an explicit choice')
  assert.match(commit, /__rename_cascade: renameScope/)
})

await runTest('profile rename dialog: both choices are explicit buttons, and dismissal/Escape only closes it', () => {
  const dialog = block(profile, '{renameChoiceOpen && profile ? (', '</ConfirmDialog>')
  assert.match(dialog, /<ConfirmDialog/)
  assert.match(dialog, /onConfirm=\{\(\) => \{ void commitProfileSave\('carry'\) \}\}/)
  assert.match(dialog, /onClick=\{\(\) => \{ void commitProfileSave\('record_only'\) \}\}/)
  assert.match(dialog, /onClose=\{\(\) => \{ if \(!savingProfile\) setRenameChoiceOpen\(false\) \}\}/, 'X / Cancel abort without saving')
  for (const key of RENAME_KEYS) assert.ok(dialog.includes(`'${key}'`), `dialog uses ${key}`)
  assert.match(profile, /event\.key === 'Escape' && !saveProfileInFlightRef\.current\) setRenameChoiceOpen\(false\)/, 'Escape aborts')
})

await runTest('users page rename: the review dialog carries both choices; commit refuses a rename without one', () => {
  assert.match(users, /const commitSaveUser = async \(renameScope\?: 'carry' \| 'record_only'\) => \{\s*const usernameChanged = userFormRenamesUser\s*if \(usernameChanged && !renameScope\) return/)
  assert.match(users, /__rename_cascade: renameScope/)
  const dialog = block(users, 'userFormRenamesUser ? (', '</ConfirmDialog>')
  assert.match(dialog, /onConfirm=\{\(\) => \{ void commitSaveUser\('carry'\) \}\}/)
  assert.match(dialog, /onClick=\{\(\) => \{ void commitSaveUser\('record_only'\) \}\}/)
  assert.match(dialog, /onClose=\{\(\) => \{ if \(!saving\) setUserConfirmOpen\(false\) \}\}/)
  for (const key of RENAME_KEYS) assert.ok(dialog.includes(`'${key}'`) || users.includes(`'${key}'`), `users page uses ${key}`)
  assert.match(users, /if \(userConfirmOpen && !saveUserInFlightRef\.current\) setUserConfirmOpen\(false\)/, 'Escape aborts')
})

await runTest('role delete goes through the shared dialog; dismissal deletes nothing', () => {
  const handle = block(users, 'const handleDeleteRole = async', 'const commitDeleteRole = async')
  assert.doesNotMatch(handle, /deleteRole\(/, 'opening the dialog must not delete')
  assert.match(handle, /setRoleDeleteTarget\(role\)/)
  assert.match(users, /onConfirm=\{\(\) => \{ void commitDeleteRole\(roleDeleteTarget\) \}\}/)
  assert.match(users, /onClose=\{\(\) => \{ if \(deletingRoleId == null\) setRoleDeleteTarget\(null\) \}\}/)
})

await runTest('every new dialog key exists in BOTH packs, with real Khmer', () => {
  for (const key of [...RENAME_KEYS, 'delete_role_title']) {
    assert.equal(typeof en[key], 'string', `en.json ${key}`)
    assert.equal(typeof km[key], 'string', `km.json ${key}`)
    assert.match(String(km[key]), /[ក-៿]/, `km.json ${key} is Khmer`)
    assert.notEqual(km[key], en[key])
  }
})

if (failed) {
  console.error(`${failed} profile wiring test(s) failed`)
  process.exit(1)
}
