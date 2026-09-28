import assert from 'node:assert/strict'
import { requestPasswordSave } from '../src/utils/passwordManager.ts'

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

if (failed > 0) process.exitCode = 1
