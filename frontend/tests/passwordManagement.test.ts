import assert from 'node:assert/strict'
import fs from 'node:fs'
import { passwordPersistenceNotice, persistChangedPassword } from '../src/utils/passwordManager.ts'

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

await runTest('login and recovery forms expose password-manager autocomplete semantics', () => {
  assert.match(loginSource, /name="username"[\s\S]*?autoComplete="username"/)
  assert.match(loginSource, /name="password"[\s\S]*?autoComplete="current-password"/)
  assert.match(loginSource, /id="reset-identifier" name="username" autoComplete="username"/)
  assert.match(loginSource, /reset-password-new[\s\S]*?autoComplete="new-password"/)
  assert.match(loginSource, /recovery-password-new[\s\S]*?autoComplete="new-password"/)
  assert.ok((loginSource.match(/copyPasswordToClipboard\(resetNewPassword\)/g) || []).length >= 2)
})

await runTest('self password change always requires current password and offers explicit copy backup', () => {
  assert.match(profileSource, /if \(!currentPassword\.trim\(\)\) return notify\(tr\('current_password_required_change'/)
  assert.match(profileSource, /name="current_password"[\s\S]*?autoComplete="current-password"/)
  assert.match(profileSource, /name="new_password"[\s\S]*?autoComplete="new-password"/)
  assert.match(profileSource, /copyPasswordToClipboard\(newPassword\)/)
  assert.doesNotMatch(profileSource, /changeUserPassword\(userId, \{[\s\S]{0,220}adminOverride:/)
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
  assert.match(profileSource, /grid gap-2 lg:grid-cols-3[\s\S]{0,1800}name="current_password"[\s\S]{0,1200}name="new_password"[\s\S]{0,800}name="confirm_password"/)
  assert.match(profileSource, /sm:grid-cols-\[auto_minmax\(0,1fr\)_auto\][\s\S]{0,500}setOtpMode\(otpEnabled \? 'disable' : 'setup'\)/)
  assert.match(profileSource, /<InfoHint label=\{tr\('current_password'/)
  assert.match(loginSource, /id="reset-identifier"[\s\S]{0,700}id="reset-otp"/)
  assert.match(loginSource, /grid gap-2 sm:grid-cols-2[\s\S]{0,700}id="reset-password-new"[\s\S]{0,700}id="reset-password-confirm"/)
  assert.match(loginSource, /id="recovery-password-new"[\s\S]{0,700}id="recovery-password-confirm"/)
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
  assert.match(usersSource, /String\(currentUser\?\.role_code \|\| ''\)\.trim\(\)\.toLowerCase\(\) === 'admin'/)
  assert.match(usersSource, /return canManage && !!targetUser/)
  assert.doesNotMatch(usersSource, /return !targetUser\.is_primary_admin/)
  assert.doesNotMatch(usersSource, /return !targetUser\.has_admin_access/)
  assert.match(usersSource, /administrator resets another account, including another admin account/i)
  assert.match(usersSource, /copyPasswordToClipboard\(passwordForm\.newPassword\)/)
})

if (failed > 0) process.exitCode = 1
