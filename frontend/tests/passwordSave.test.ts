import assert from 'node:assert/strict'
import fs from 'node:fs'
import { passwordNoticeKey, requestPasswordSave, requestPasswordSaveAfterSignIn } from '../src/utils/passwordManager.ts'

// AUTH-P1: after a successful sign-in or own password change the app asks the
// browser's password manager to save the credential (Chromium's
// navigator.credentials.store shows "Save password?" / "Update password?").
// The app never writes a password to the clipboard on its own: a copy happens
// only when the person presses a Copy button. So requestPasswordSave must
// leave the clipboard alone whatever the browser does -- store refused, store
// missing, no PasswordCredential at all.

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

type StoredCredential = { id: string; password: string; name?: string }
type BrowserSetup = {
  passwordCredential?: boolean
  store?: (credential: StoredCredential) => Promise<unknown>
}

async function withBrowser(setup: BrowserSetup, fn: (clipboardWrites: string[], stored: StoredCredential[]) => Promise<void>) {
  const clipboardWrites: string[] = []
  const stored: StoredCredential[] = []
  const originalWindow = (globalThis as { window?: unknown }).window
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  class FakePasswordCredential {
    id: string
    password: string
    name?: string
    constructor(data: StoredCredential) {
      this.id = data.id
      this.password = data.password
      if (data.name) this.name = data.name
    }
  }
  ;(globalThis as { window?: unknown }).window = setup.passwordCredential === false ? {} : { PasswordCredential: FakePasswordCredential }
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      clipboard: { writeText: async (text: string) => { clipboardWrites.push(text) } },
      credentials: setup.store
        ? { store: async (credential: StoredCredential) => { await setup.store?.(credential); stored.push({ ...credential }) } }
        : undefined,
    },
  })
  try {
    await fn(clipboardWrites, stored)
  } finally {
    ;(globalThis as { window?: unknown }).window = originalWindow
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
  }
}

await runTest('a browser that accepts: stores the canonical username with the new password, clipboard untouched', async () => {
  await withBrowser({ store: async () => undefined }, async (clipboardWrites, stored) => {
    const ok = await requestPasswordSave({ username: ' sokha ', password: 'New pass-1', displayName: 'Sokha' })
    assert.equal(ok, true)
    assert.deepEqual(stored, [{ id: 'sokha', password: 'New pass-1', name: 'Sokha' }], 'the password is saved exactly as typed')
    assert.deepEqual(clipboardWrites, [])
  })
})

await runTest('store() throws: returns false and the clipboard stays untouched', async () => {
  await withBrowser({ store: async () => { throw new Error('NotAllowedError') } }, async (clipboardWrites) => {
    const ok = await requestPasswordSave({ username: 'sokha', password: 'New pass-1' })
    assert.equal(ok, false)
    assert.deepEqual(clipboardWrites, [], 'no automatic copy when the browser refuses')
  })
})

await runTest('no PasswordCredential (Safari, Firefox): returns false, never copies', async () => {
  await withBrowser({ passwordCredential: false, store: async () => undefined }, async (clipboardWrites, stored) => {
    assert.equal(await requestPasswordSave({ username: 'sokha', password: 'New pass-1' }), false)
    assert.deepEqual(stored, [])
    assert.deepEqual(clipboardWrites, [])
  })
})

await runTest('no credentials API at all: returns false, never copies', async () => {
  await withBrowser({}, async (clipboardWrites) => {
    assert.equal(await requestPasswordSave({ username: 'sokha', password: 'New pass-1' }), false)
    assert.deepEqual(clipboardWrites, [])
  })
})

await runTest('nothing to save without a username or a password', async () => {
  await withBrowser({ store: async () => undefined }, async (clipboardWrites, stored) => {
    assert.equal(await requestPasswordSave({ username: '  ', password: 'New pass-1' }), false)
    assert.equal(await requestPasswordSave({ username: 'sokha', password: '' }), false)
    assert.deepEqual(stored, [])
    assert.deepEqual(clipboardWrites, [])
  })
})

await runTest('after sign-in: saves the verified password under the account username, never the typed phone or e-mail', async () => {
  await withBrowser({ store: async () => undefined }, async (clipboardWrites, stored) => {
    const answer = { success: true, sharedDevice: false, user: { username: 'sokha', name: 'Sokha' } }
    assert.equal(await requestPasswordSaveAfterSignIn(answer, 'Typed-Pass-1'), true)
    assert.deepEqual(stored, [{ id: 'sokha', password: 'Typed-Pass-1', name: 'Sokha' }])
    assert.equal(await requestPasswordSaveAfterSignIn({ success: true, user: { username: 'sokha' } }, 'Typed-Pass-1'), true, 'an older Worker without the flag still saves')
    assert.deepEqual(clipboardWrites, [])
  })
})

await runTest('after sign-in: nothing is saved on a shared device, a refusal, a pending device or a password-less sign-in', async () => {
  await withBrowser({ store: async () => undefined }, async (clipboardWrites, stored) => {
    const user = { username: 'sokha', name: 'Sokha' }
    const devicePending: { success?: boolean; deviceApprovalRequired: boolean; deviceStatus: string } = { deviceApprovalRequired: true, deviceStatus: 'pending' }
    assert.equal(await requestPasswordSaveAfterSignIn({ success: true, sharedDevice: true, user }, 'Typed-Pass-1'), false)
    assert.equal(await requestPasswordSaveAfterSignIn({ success: false, user }, 'Typed-Pass-1'), false)
    assert.equal(await requestPasswordSaveAfterSignIn(devicePending, 'Typed-Pass-1'), false)
    assert.equal(await requestPasswordSaveAfterSignIn({ success: true, sharedDevice: false, user }, ''), false, 'Google, then the authenticator code: no password to save')
    assert.equal(await requestPasswordSaveAfterSignIn(null, 'Typed-Pass-1'), false)
    assert.deepEqual(stored, [])
    assert.deepEqual(clipboardWrites, [])
  })
})

await runTest('the notice after an own password change says whether the browser was asked to save it, in both languages', () => {
  const saved = passwordNoticeKey({ stored: true })
  const unsaved = passwordNoticeKey({ stored: false })
  assert.equal(saved.key, 'password_saved_to_manager')
  assert.equal(unsaved.key, 'password_updated_save_it')
  for (const lang of ['en', 'km']) {
    const pack = JSON.parse(fs.readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8')) as Record<string, string>
    for (const notice of [saved, unsaved]) assert.ok(String(pack[notice.key] || '').trim(), `${lang}.json has ${notice.key}`)
  }
  const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
  assert.equal(en[saved.key], saved.fallback)
  assert.equal(en[unsaved.key], unsaved.fallback)
})

await runTest('factory reset: the password pairs with the signed-in username, the confirm word is never offered as one, and Enter cannot submit', () => {
  const source = fs.readFileSync(new URL('../src/components/utils-settings/ResetData.tsx', import.meta.url), 'utf8')
  const start = source.indexOf('function FactoryReset(')
  const factory = source.slice(start, source.indexOf('\nfunction ', start + 1))
  assert.ok(start > 0 && factory.length > 0)
  assert.doesNotMatch(factory, /<form\b/, 'not a form: Enter must never start a factory reset')
  const confirmWord = factory.split('\n').find((line) => line.includes('placeholder={CONFIRM_WORD}')) || ''
  assert.match(confirmWord, /name="reset_confirm_word"/)
  assert.match(confirmWord, /autoComplete="off"/)
  const username = /<input\b[^>]*name="username"[^>]*\/>/.exec(factory)
  assert.ok(username, 'a username input for the password manager')
  assert.match(username[0], /type="text"[\s\S]*autoComplete="username"[\s\S]*className="sr-only"/)
  assert.ok(username.index < factory.indexOf('type="password"'), 'the username comes before the password')
})

if (failed > 0) process.exitCode = 1
