import assert from 'node:assert/strict'
import fs from 'node:fs'
import { transformSync } from 'esbuild'
import { passwordPersistenceNotice, persistChangedPassword } from '../src/utils/passwordManager.ts'
import { newPasswordProblem, passwordProblemMessage } from '../src/utils/passwordRules.ts'
import { isAdminControlUser } from '../src/utils/permissions.ts'

type TestCallback = () => void | Promise<void>
let failed = 0
async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const loginSource = fs.readFileSync(new URL('../src/components/auth/Login.tsx', import.meta.url), 'utf8')
const profileSource = fs.readFileSync(new URL('../src/components/users/UserProfileModal.tsx', import.meta.url), 'utf8')
const otpSource = fs.readFileSync(new URL('../src/components/utils-settings/OtpModal.tsx', import.meta.url), 'utf8')
const usersSource = fs.readFileSync(new URL('../src/components/users/Users.tsx', import.meta.url), 'utf8')
const transportSource = fs.readFileSync(new URL('../src/api/userAdminTransport.ts', import.meta.url), 'utf8')

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
function installBrowserMocks({ storeOk = true, copyOk = true } = {}) {
  let storeCalls = 0
  let copyCalls = 0
  class FakePasswordCredential {
    id: string
    password: string
    name?: string
    constructor(data: { id: string; password: string; name?: string }) {
      this.id = data.id
      this.password = data.password
      this.name = data.name
    }
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { PasswordCredential: FakePasswordCredential },
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      credentials: {
        store: async () => {
          storeCalls += 1
          if (!storeOk) throw new Error('store blocked')
        },
      },
      clipboard: {
        writeText: async () => {
          copyCalls += 1
          if (!copyOk) throw new Error('clipboard blocked')
        },
      },
    },
  })
  return { getStoreCalls: () => storeCalls, getCopyCalls: () => copyCalls }
}
function restoreGlobals() {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
  else Reflect.deleteProperty(globalThis, 'window')
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
  else Reflect.deleteProperty(globalThis, 'navigator')
}

await runTest('successful credential-store request does not overwrite clipboard', async () => {
  const calls = installBrowserMocks({ storeOk: true, copyOk: true })
  try {
    const result = await persistChangedPassword({ username: 'admin2', password: 'new-secret', copyFallback: true })
    assert.equal(result.credentialStoreRequested, true)
    assert.equal(result.credentialStoreSucceeded, true)
    assert.equal(result.copiedToClipboard, false)
    assert.equal(calls.getStoreCalls(), 1)
    assert.equal(calls.getCopyCalls(), 0)
    assert.match(passwordPersistenceNotice(result), /password manager/i)
  } finally {
    restoreGlobals()
  }
})

await runTest('clipboard becomes the automatic backup when password-manager storage fails', async () => {
  const calls = installBrowserMocks({ storeOk: false, copyOk: true })
  try {
    const result = await persistChangedPassword({ username: 'worker1', password: 'replacement', copyFallback: true })
    assert.equal(result.credentialStoreSucceeded, false)
    assert.equal(result.copiedToClipboard, true)
    assert.equal(calls.getStoreCalls(), 1)
    assert.equal(calls.getCopyCalls(), 1)
    assert.match(passwordPersistenceNotice(result), /copied to your clipboard/i)
  } finally {
    restoreGlobals()
  }
})

await runTest('admin reset never stores another user credential in the admin password manager', async () => {
  const calls = installBrowserMocks({ storeOk: true, copyOk: true })
  try {
    const result = await persistChangedPassword({ username: 'other-admin', password: 'temporary-pass', allowCredentialStore: false, copyFallback: true })
    assert.equal(result.credentialStoreRequested, false)
    assert.equal(result.copiedToClipboard, true)
    assert.equal(calls.getStoreCalls(), 0)
    assert.equal(calls.getCopyCalls(), 1)
    assert.match(passwordPersistenceNotice(result, { adminReset: true }), /give it to this user/i)
  } finally {
    restoreGlobals()
  }
})

// Login block (AUTH-P1-login). The sign-in form pairs for password managers
// and the browser is asked to save only after the Worker accepted the password
// (sign-in, or sign-in + authenticator code), under the account username. A
// finished reset never keeps a spent link or code: it ends on the real sign-in
// form with the new password filled in, and signing in there is what every
// browser's save logic understands (AUTH-UX-FINAL C1, C2).
function sliceConst(source: string, name: string): string {
  const start = source.indexOf(`  const ${name} = `)
  assert.ok(start >= 0, `${name} exists`)
  const next = source.slice(start + 1).search(/\n  (?:const |return \()/)
  return source.slice(start, next < 0 ? undefined : start + 1 + next)
}

await runTest('sign-in and recovery forms pair for password managers; the reveal is reachable by keyboard', () => {
  assert.match(loginSource, /id="login-username"\s+name="username"[\s\S]*?autoComplete="username"/)
  assert.match(loginSource, /name="password"[\s\S]*?autoComplete="current-password"/)
  assert.match(loginSource, /id="reset-identifier" name="username" autoComplete="username"/)
  const reveal = /<button\b[^>]*?onClick=\{\(\) => setShowPassword\(\(visible\) => !visible\)\}[\s\S]*?<\/button>/.exec(loginSource)?.[0] || ''
  assert.ok(reveal, 'the reveal toggle exists')
  assert.doesNotMatch(reveal, /tabIndex=\{-1\}/)
  assert.match(loginSource, /<NewPasswordFields\s[^>]*idPrefix="reset-password"/)
  assert.match(loginSource, /<NewPasswordFields\s[^>]*idPrefix="recovery-password"/)
  assert.doesNotMatch(loginSource, /placeholder="(?:username \/ name \/ phone \/ email|6-digit code)"/, 'no English placeholders')
})

await runTest('the e-mail reset request is a real form: Enter sends it', () => {
  const panel = loginSource.slice(loginSource.indexOf("{tr('email_recovery', 'Email recovery')}") - 600, loginSource.indexOf("tr('send_reset_email'"))
  assert.match(panel, /<form\b[^>]*onSubmit=\{[^}]*handleResetWithEmail\(\)/)
  assert.match(panel, /type="submit"/)
})

await runTest('the browser is asked to save only after a verified password, never with an automatic copy', () => {
  assert.match(sliceConst(loginSource, 'handleLogin'), /requestPasswordSaveAfterSignIn\(result, password\)/)
  assert.match(sliceConst(loginSource, 'handleLogin'), /passwordForSecondFactorRef\.current = password/)
  assert.match(sliceConst(loginSource, 'handleOtp'), /requestPasswordSaveAfterSignIn\(verifyResult, passwordForSecondFactorRef\.current\)/)
  assert.doesNotMatch(loginSource, /persistChangedPassword|copyPasswordToClipboard|passwordPersistenceNotice/)
})

await runTest('a finished reset ends on the pre-filled sign-in form: link and code cleared whatever the browser does (F-SPENT)', () => {
  for (const handler of ['handleResetWithOtp', 'handleCompleteEmailReset']) {
    const body = sliceConst(loginSource, handler)
    assert.match(body, /showSignInWithNewPassword\(String\(result\?\.username/, `${handler} uses the account username the Worker answered`)
    assert.match(body, /newPasswordProblem\(resetNewPassword\)/, `${handler} checks the shared rule`)
    assert.doesNotMatch(body, /passwordSecured|credentialStoreSucceeded|copiedToClipboard|length < 6/)
  }
  const finish = sliceConst(loginSource, 'showSignInWithNewPassword')
  assert.match(finish, /closeAuxMode\(\)/)
  assert.match(finish, /setUsername\(canonicalUsername\)/)
  assert.match(finish, /setPassword\(newPassword\)/)
  assert.match(finish, /setSignInNotice\(tr\('password_changed_sign_in_to_save'/)
  const close = sliceConst(loginSource, 'closeAuxMode')
  assert.match(close, /setRecoveryAccessToken\(''\)/)
  assert.match(close, /setResetOtp\(''\)/)
})

function inputBefore(source: string, id: string): string {
  const own = source.lastIndexOf('<input', source.indexOf(`id="${id}"`))
  const previous = source.lastIndexOf('<input', own - 1)
  return previous < 0 ? '' : source.slice(previous, source.indexOf('/>', previous) + 2)
}

function assertAccountUsername(input: string, value: RegExp, surface: string) {
  for (const attribute of [/type="text"/, /name="username"/, /autoComplete="username"/, /readOnly/, /className="sr-only"/, /tabIndex=\{-1\}/, /aria-hidden="true"/]) {
    assert.match(input, attribute, `${surface}: the input just before the password is the account username (${attribute})`)
  }
  assert.match(input, value, `${surface}: the username is the signed-in account's`)
}

await runTest('My Profile password change: shared fields, a save request under the account username, all three fields cleared, never an automatic copy', () => {
  // The last SAVED username: the Personal section edits `profile` in place, and an
  // unsaved rename must never become the username the password is saved under.
  assert.match(profileSource, /const accountUsername = String\(savedProfile\?\.username \|\| user\?\.username \|\| ''\)/)
  assert.doesNotMatch(profileSource, /value=\{profile\?\.username/)
  const save = sliceConst(profileSource, 'handlePasswordSave')
  assert.match(save, /changeOwnPassword\(\{[\s\S]*username: accountUsername,/)
  assert.match(save, /changeUserPassword\(userId, \{ \.\.\.passwords, userId, userName: user\?\.name \}\)/, 'sends exactly what changeOwnPassword checked')
  assert.match(
    save,
    /if \(!outcome\.changed\) \{\s+notify\(outcome\.message, 'error'\)\s+return\s+\}\s+setCurrentPassword\(''\)\s+setNewPassword\(''\)\s+setConfirmPassword\(''\)\s+notify\(outcome\.message, outcome\.tone\)/,
    'every change clears all three fields, whether or not the browser saved it',
  )
  assert.doesNotMatch(profileSource, /persistChangedPassword|copyPasswordToClipboard|copyFallback|passwordPersistenceNotice|passwordSecured/)
  assert.doesNotMatch(profileSource, /tr\('copy_new_password'/, 'the text Copy button is now the Copy icon inside NewPasswordFields')
  assert.doesNotMatch(profileSource, /changeUserPassword\(userId, \{[\s\S]{0,220}adminOverride:/)

  const form = profileSource.slice(profileSource.indexOf('void handlePasswordSave()'), profileSource.indexOf('</form>', profileSource.indexOf('void handlePasswordSave()')))
  assertAccountUsername(inputBefore(form, 'security-current-password'), /value=\{accountUsername\}/, 'Security form')
  assert.match(form, /id="security-current-password"\s+name="current_password"\s+type="password"\s+autoComplete="current-password"/)
  const fields = /<NewPasswordFields\b[\s\S]*?\/>/.exec(form)?.[0] || ''
  assert.match(fields, /idPrefix="security-password"/)
  assert.doesNotMatch(fields, /mode=/, 'the default self mode: the person\'s own password is offered to their manager')
  assert.ok(form.indexOf('id="security-current-password"') < form.indexOf('<NewPasswordFields'), 'current password before the new ones')
  assert.equal((form.match(/<button\b/g) || []).length, 1, 'only the main action is a text button')
  const submit = /<button type="submit"[\s\S]*?<\/button>/.exec(form)?.[0] || ''
  assert.match(submit, /title=\{tr\('change_password', 'Change password'\)\}/)
  assert.match(submit, /<KeyRound\b[\s\S]*?tr\('save', 'Save'\)/, 'main action: icon + one word ("change" is the change-money word in Khmer)')
})

await runTest('re-auth passwords pair with the signed-in account: Google disconnect and both authenticator steps', () => {
  assertAccountUsername(inputBefore(profileSource, 'disconnect-google-password'), /value=\{accountUsername\}/, 'Google connect/disconnect')
  assert.match(otpSource, /const signedInUsername = String\(app\.user\?\.username \|\| ''\)/)
  for (const id of ['otp-setup-password', 'otp-disable-password']) {
    const username = inputBefore(otpSource, id)
    assertAccountUsername(username, /value=\{signedInUsername\}/, id)
    assert.doesNotMatch(username, /targetUsername|targetName/, `${id}: recovery re-enters the ADMINISTRATOR's password, never the target's`)
  }
  const disable = otpSource.slice(otpSource.indexOf("step === 'confirm_disable'"), otpSource.indexOf('id="otp-disable-password"'))
  assert.doesNotMatch(disable, /<form\b/, 'not a form: Enter must never disable or reset 2FA')
})

await runTest('profile photo opens view-first actions and keeps every picker reachable', () => {
  assert.match(profileSource, /onClick=\{\(\) => setAvatarViewerOpen\(true\)\}/)
  assert.match(profileSource, /function AvatarViewerModal\([\s\S]*object-contain/)
  assert.match(profileSource, /grid-cols-3[\s\S]*onUpload[\s\S]*onEdit[\s\S]*onOpenFiles/)
  assert.match(profileSource, /pb-\[calc\(0\.75rem\+env\(safe-area-inset-bottom\)\)\]/)
  assert.match(profileSource, /onUpload=\{\(\) => \{[\s\S]*handleAvatarPick\(\)/)
  assert.match(profileSource, /onOpenFiles=\{\(\) => \{[\s\S]*setFilePickerOpen\(true\)/)
  assert.match(profileSource, /ref=\{avatarFileInputRef\}[\s\S]*type="file"[\s\S]*onChange=\{handleAvatarSelected\}/)
  assert.doesNotMatch(profileSource, /onClick=\{\(\) => profile\.avatar_path \? openAvatarEditor/)
})

await runTest('profile and recovery security surfaces remain compact without weakening gates', () => {
  assert.match(profileSource, /h-12 w-12 rounded-xl/)
  assert.match(profileSource, /flex min-w-0 items-center gap-1\.5 whitespace-nowrap[\s\S]{0,1400}2FA \{otpEnabled/)
  assert.match(profileSource, /grid gap-2 lg:grid-cols-3[\s\S]{0,1800}name="current_password"[\s\S]{0,600}lg:col-span-2[\s\S]{0,200}<NewPasswordFields[\s\S]{0,600}layout="columns"/)
  assert.match(profileSource, /sm:grid-cols-\[auto_minmax\(0,1fr\)_auto\][\s\S]{0,500}setOtpMode\(otpEnabled \? 'disable' : 'setup'\)/)
  assert.match(profileSource, /<InfoHint label=\{tr\('current_password'/)
  assert.match(loginSource, /id="reset-identifier"[\s\S]{0,700}id="reset-otp"/)
  assert.doesNotMatch(profileSource, /onClick=\{[^}]*logout|onClick=\{[^}]*refresh/i)
})

await runTest('OTP enrollment renders only validated QR images and always retains manual fallback', () => {
  assert.match(otpSource, /function normalizeOtpQrDataUrl/)
  assert.match(otpSource, /\^data:image\\\/\(\?:png\|jpeg\|webp\|svg\\\+xml\)/)
  assert.match(otpSource, /import\('qrcode'\)[\s\S]*toDataURL\(otpAuthUrl/)
  assert.match(otpSource, /onError=\{\(\) => \{[\s\S]*setQrDataUrl\(null\)[\s\S]*setQrGenerationFailed\(true\)/)
  assert.match(otpSource, /secret \|\| \(tr\('loading'\)/)
  assert.match(otpSource, /select-all break-all font-mono/)
  assert.match(otpSource, /if \(!password\.trim\(\)\)[\s\S]*current_password_required_change/)
  assert.match(otpSource, /disabled=\{loading \|\| !password(?: \|\| \(mode === 'recover' && recoveryConfirmation\.trim\(\)\.toUpperCase\(\) !== 'RESET 2FA'\))?\}/)
  assert.match(otpSource, /modal-viewport-safe[\s\S]*modal-panel-safe[\s\S]*modal-scroll/)
})

await runTest('profile permission override is limited to profile metadata, never password or 2FA bypass', () => {
  assert.match(profileSource, /const canAdminOverride = hasPermission\('all'\)/)
  assert.match(profileSource, /updateUserProfile[\s\S]*adminOverride: canAdminOverride/)
  assert.doesNotMatch(profileSource, /changeUserPassword\([\s\S]{0,300}adminOverride/)
  assert.doesNotMatch(otpSource, /adminOverride|hasPermission\('all'\)/)
})

await runTest('profile OTP dialog is a fixed overlay above the profile dialog', () => {
  const otpSource = fs.readFileSync(new URL('../src/components/utils-settings/OtpModal.tsx', import.meta.url), 'utf8')
  assert.match(otpSource, /createPortal\(/)
  assert.match(otpSource, /fixed inset-0 z-\[1060\]/)
  assert.match(otpSource, /sm:items-center/)
})

await runTest('peer-admin reset uses dedicated admin endpoint and permits managing any admin, including the primary admin (explicit user decision Sep 1 2026)', () => {
  assert.match(transportSource, /\/api\/users\/\$\{encodeId\(id\)\}\/reset-password/)
  assert.match(usersSource, /getUsersApi\(\)\.resetPassword\(selectedUser\.id/)
  assert.match(usersSource, /import \{ isAdminControlUser,[\s\S]*?\} from '\.\.\/\.\.\/utils\/permissions\.ts'/, 'Users must consume the shared frontend/backend-parity admin authority')
  assert.match(usersSource, /const canManage = isAdminControlUser\(currentUser\)/, 'peer-admin management must use the effective shared admin decision')
  assert.equal(isAdminControlUser({ role_code: 'admin' }), true, 'the admin role remains an administrator')
  // FX-sec (27 Sep 2026): the name alone no longer grants control -- the
  // seeded admin keeps it through its admin role_code.
  assert.equal(isAdminControlUser({ username: 'admin', role_code: 'admin' }), true, 'the seeded admin identity remains an administrator')
  assert.equal(isAdminControlUser({ username: 'admin' }), false, 'the username alone does not grant administrator control')
  assert.equal(isAdminControlUser({ role_code: 'employee', role_permissions: { all: true } }), true, 'effective role-level all access remains administrative')
  assert.equal(isAdminControlUser({ role_code: 'employee', role_permissions: { all: true }, permissions: { all: false } }), false, 'an explicit user override must narrow a role-level all grant')
  assert.match(usersSource, /return canManage && !!targetUser/)
  assert.doesNotMatch(usersSource, /return !targetUser\.is_primary_admin/)
  assert.doesNotMatch(usersSource, /return !targetUser\.has_admin_access/)
})

// Creating a user and resetting someone else's password set ANOTHER person's password:
// never the administrator's own vault, never the clipboard unless Copy is pressed.
const usersCode = usersSource.replace(/\r\n/g, '\n')
function sliceFunction(source: string, name: string): string {
  const start = source.indexOf(`\nfunction ${name}(`)
  assert.ok(start >= 0, `function ${name} exists`)
  return source.slice(start, source.indexOf('\n}\n', start) + 3)
}
function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  assert.ok(from >= 0, `missing ${start}`)
  const to = source.indexOf(end, from + start.length)
  assert.ok(to > from, `missing ${end} after ${start}`)
  return source.slice(from, to)
}
const firstNewPasswordFields = (source: string) => /<NewPasswordFields\b[\s\S]*?\/>/.exec(source)?.[0] || ''

await runTest('admin create and reset never store another person\'s password and never copy it unasked', () => {
  assert.doesNotMatch(usersCode, /copyFallback|persistChangedPassword|passwordPersistenceNotice/)
  const reset = sliceConst(usersCode, 'handleResetPassword')
  assert.doesNotMatch(reset, /copyPasswordToClipboard/)
  assert.equal((usersCode.match(/requestPasswordSave\(/g) || []).length, 1, 'one save request on the page')
  assert.match(reset, /if \(ownAccount\) \{\s+const stored = await requestPasswordSave\(\{ username: String\(selectedUser\.username \|\| ''\),/, 'only the administrator\'s own password is offered to their manager')
  const handover = sliceFunction(usersCode, 'PasswordHandover')
  assert.equal((usersCode.match(/copyPasswordToClipboard\(/g) || []).length, (handover.match(/copyPasswordToClipboard\(/g) || []).length, 'the page copies only from the hand-over panel')
  assert.match(handover, /onClick=\{\(\) => \{ void copy\(\) \}\}/)
  assert.doesNotMatch(handover, /useEffect|requestPasswordSave/)
})

await runTest('create user stays a button, and neither field looks like the administrator\'s own sign-up (C18)', () => {
  const modal = between(usersCode, "{modal === 'editUser' ? (", '{roleDeleteTarget ? (')
  assert.doesNotMatch(modal, /<form\b/, 'a real submit makes Chrome likelier to offer saving the staff credential')
  assert.match(modal, /<input id="user-username" name="new_user_username" autoComplete="off" data-1p-ignore="true" data-lpignore="true" data-bwignore="true"/)
  assert.doesNotMatch(modal, /name="(?:username|password)"|autoComplete="(?:username|new-password|current-password)"|type="password"/)
  const fields = firstNewPasswordFields(modal)
  assert.match(fields, /idPrefix="new-user-password"/)
  assert.match(fields, /mode="other-user"/)
  assert.match(fields, /password=\{userForm\.password\}/)
  assert.match(fields, /confirm=\{userForm\.passwordConfirm\}/)
  assert.match(modal, /<button type="button" className=\{MAIN_ACTION_BUTTON_CLASS\} onClick=\{handleSaveUser\} disabled=\{saving\}>\s*<Save className="h-4 w-4" aria-hidden="true" \/>/)
})

await runTest('create and reset check the Worker\'s new-password rule on the client, and show its refusals translated', () => {
  const compiled = transformSync(sliceFunction(usersCode, 'passwordEntryError'), { loader: 'ts' }).code
  const passwordEntryError = new Function('newPasswordProblem', 'passwordProblemMessage', `${compiled}\nreturn passwordEntryError`)(newPasswordProblem, passwordProblemMessage) as
    (password: string, confirm: string, missing: string, tr: (key: string, fallback: string) => string) => string
  const tr = (key: string, fallback: string) => `${key}: ${fallback}`
  const khmer = (letters: number) => 'ក'.repeat(letters)
  assert.equal(passwordEntryError('', '', 'missing', tr), 'missing')
  assert.match(passwordEntryError('abcde', 'abcde', 'missing', tr), /^password_too_short: /)
  assert.match(passwordEntryError(' abcdef', ' abcdef', 'missing', tr), /^password_edge_whitespace: /)
  assert.match(passwordEntryError(khmer(25), khmer(25), 'missing', tr), /^password_too_long: /, '25 Khmer letters are 75 bytes')
  assert.equal(passwordEntryError(khmer(24), khmer(24), 'missing', tr), '')
  assert.match(passwordEntryError('abcdef', 'abcdeg', 'missing', tr), /^new_password_confirm_mismatch: /)
  assert.equal(passwordEntryError('abcdef', 'abcdef', 'missing', tr), '')

  const save = sliceConst(usersCode, 'handleSaveUser')
  assert.match(save, /passwordEntryError\(userForm\.password, userForm\.passwordConfirm, tr\('password_required_new_user'/)
  assert.ok(save.indexOf('passwordEntryError(') < save.indexOf('setUserConfirmOpen(true)'), 'checked before the review dialog opens')
  const reset = sliceConst(usersCode, 'handleResetPassword')
  assert.match(reset, /passwordEntryError\(newPassword, confirmPassword, tr\('enter_new_password'/)
  assert.doesNotMatch(usersCode, /length < 6/)
  for (const [name, body] of [['create', sliceConst(usersCode, 'commitSaveUser')], ['reset', reset]]) {
    assert.match(body, /newPasswordRefusalMessage\(result, tr\) \|\|/, `${name}: a { success: false } answer`)
    assert.match(body, /newPasswordRefusalMessage\(error, tr\) \|\|/, `${name}: a thrown ApiError`)
  }
})

await runTest('resetting another person\'s password: no current password, no username, other-user fields, then the hand-over panel (C19)', () => {
  const modal = between(usersCode, "{modal === 'resetPw' && selectedUser ? (", "{modal === 'editRole' ? (")
  assert.match(modal, /passwordHandover && sameUserId\(passwordHandover\.userId, selectedUser\.id\) \? \(\s*<PasswordHandover\b[\s\S]*?\) : isCurrentAccount\(selectedUser\) \? \(\s*<OwnPasswordChangeForm\b[\s\S]*?\) : \(\s*<AdminPasswordResetForm\b/)
  const admin = sliceFunction(usersCode, 'AdminPasswordResetForm')
  assert.doesNotMatch(admin, /<form\b|<input\b|autoFocus|current_password|name="username"/)
  assert.match(firstNewPasswordFields(admin), /mode="other-user"/)
  assert.equal((admin.match(/<button\b/g) || []).length, 1, 'one main action')
  assert.match(admin, /<button type="button" className=\{MAIN_ACTION_BUTTON_CLASS\} title=\{tr\('change_password', 'Change password'\)\} disabled=\{passwordSaving\} onClick=\{onSave\}>\s*<KeyRound\b/)
  assert.match(sliceConst(usersCode, 'handleResetPassword'), /setPasswordHandover\(\{ userId: targetId, name: [^}]*, password: newPassword \}\)/)

  const handover = sliceFunction(usersCode, 'PasswordHandover')
  assert.match(handover, /tr\('password_admin_handover_title', 'New password for \{name\}'\)\.replace\('\{name\}', name\)/)
  assert.match(handover, /<div className="[^"]*\bselect-all\b[^"]*">\{password\}<\/div>/, 'shown once in a read-only line')
  assert.match(handover, /<button type="button" className="[^"]*" aria-label=\{copyLabel\} title=\{copyLabel\} onClick=\{\(\) => \{ void copy\(\) \}\}>\s*<Copy\b[^>]*\/>\s*<\/button>/, 'Copy is icon-only with its name as tooltip')
  assert.match(handover, /<button type="button" className=\{MAIN_ACTION_BUTTON_CLASS\} onClick=\{onDone\}>\s*<Check\b[\s\S]*?tr\('done', 'Done'\)/)
})

await runTest('an administrator changing their own password here keeps the paired form and the browser save request', () => {
  const own = sliceFunction(usersCode, 'OwnPasswordChangeForm')
  assert.match(own, /<form\b[^>]*onSubmit=\{\(event\) => \{ event\.preventDefault\(\); onSave\(\) \}\}/)
  assertAccountUsername(inputBefore(own, 'reset-password-current'), /value=\{target\.username \|\| ''\}/, 'Users page own change')
  assert.match(own, /id="reset-password-current"\s+name="current_password"\s+type="password"\s+autoComplete="current-password"[\s\S]*?autoFocus/)
  const fields = firstNewPasswordFields(own)
  assert.match(fields, /idPrefix="reset-password"/)
  assert.doesNotMatch(fields, /mode=/, 'self mode: offered to the administrator\'s own manager')
  assert.equal((own.match(/<button\b/g) || []).length, 1, 'one main action')
  assert.match(own, /<button type="submit" className=\{MAIN_ACTION_BUTTON_CLASS\} title=\{tr\('change_password', 'Change password'\)\} disabled=\{passwordSaving\}>\s*<KeyRound\b[\s\S]*?tr\('save', 'Save'\)/)
})

if (failed > 0) process.exitCode = 1
