import assert from 'node:assert/strict'
import { changeOwnPassword, type OwnPasswordChangeInput } from '../src/components/auth/password/ownPasswordChange.ts'

// AUTH-P1-profile: My Profile's own password change. After the Worker accepts
// it the browser is asked to save the password under the canonical account
// username, the notice says whether that request was accepted, and nothing
// is ever written to the clipboard (a copy happens only from the Copy icon).

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
type Browser = { stored: StoredCredential[]; clipboardWrites: string[] }
type StoreAnswer = 'accepts' | 'refuses' | 'never answers'

async function withBrowser(storeAnswer: StoreAnswer, fn: (browser: Browser) => Promise<void>) {
  const browser: Browser = { stored: [], clipboardWrites: [] }
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
  ;(globalThis as { window?: unknown }).window = { PasswordCredential: FakePasswordCredential }
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      clipboard: { writeText: async (text: string) => { browser.clipboardWrites.push(text) } },
      credentials: {
        store: async (credential: StoredCredential) => {
          if (storeAnswer === 'never answers') await new Promise(() => {})
          if (storeAnswer === 'refuses') throw new Error('NotAllowedError')
          browser.stored.push({ ...credential })
        },
      },
    },
  })
  try {
    await fn(browser)
  } finally {
    ;(globalThis as { window?: unknown }).window = originalWindow
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
  }
}

const tr = (key: string, fallback: string) => `${key}: ${fallback}`
type Sent = { currentPassword: string; newPassword: string }

function input(overrides: Partial<OwnPasswordChangeInput> = {}, sent: Sent[] = []): OwnPasswordChangeInput {
  return {
    username: 'sokha',
    displayName: 'Sokha',
    currentPassword: 'Old pass-1',
    newPassword: 'New pass-1',
    confirmPassword: 'New pass-1',
    tr,
    change: async (passwords) => { sent.push(passwords); return { success: true } },
    ...overrides,
  }
}

const HUNG_SAVE_LIMIT_MS = 4000

async function settlesWithin<T>(ms: number, promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`still waiting after ${ms} ms`)), ms) })
  try {
    return await Promise.race([promise, limit])
  } finally {
    clearTimeout(timer)
  }
}

function refusedWith(code: string) {
  return async () => ({ success: false, error: 'English server text', code })
}

function thrownWith(code: string) {
  return async () => { throw Object.assign(new Error('English server text'), { code }) }
}

await runTest('accepted and saved: exact passwords sent, canonical username saved, success notice, clipboard untouched', async () => {
  await withBrowser('accepts', async ({ stored, clipboardWrites }) => {
    const sent: Sent[] = []
    const outcome = await changeOwnPassword(input({ username: ' sokha ' }, sent))
    assert.deepEqual(sent, [{ currentPassword: 'Old pass-1', newPassword: 'New pass-1' }])
    assert.deepEqual(stored, [{ id: 'sokha', password: 'New pass-1', name: 'Sokha' }])
    assert.deepEqual(outcome, { changed: true, tone: 'success', message: tr('password_saved_to_manager', 'Password updated. Your browser was asked to save it.') })
    assert.deepEqual(clipboardWrites, [])
  })
})

await runTest('accepted but the browser refuses to save: a warning notice and still no automatic copy', async () => {
  await withBrowser('refuses', async ({ stored, clipboardWrites }) => {
    const outcome = await changeOwnPassword(input())
    assert.equal(outcome.changed, true)
    assert.equal(outcome.changed && outcome.tone, 'warning')
    assert.match(outcome.message, /^password_updated_save_it: /)
    assert.deepEqual(stored, [])
    assert.deepEqual(clipboardWrites, [], 'the old copy fallback put the password on the clipboard here')
  })
})

await runTest('a browser whose save never answers: the change still finishes with the warning notice', async () => {
  await withBrowser('never answers', async ({ clipboardWrites }) => {
    const outcome = await settlesWithin(HUNG_SAVE_LIMIT_MS, changeOwnPassword(input()))
    assert.equal(outcome.changed, true)
    assert.equal(outcome.changed && outcome.tone, 'warning')
    assert.match(outcome.message, /^password_updated_save_it: /)
    assert.deepEqual(clipboardWrites, [])
  })
})

await runTest('the Worker refuses: nothing is saved and the refusal is in the operator language', async () => {
  await withBrowser('accepts', async ({ stored, clipboardWrites }) => {
    const cases: Array<[OwnPasswordChangeInput['change'], RegExp]> = [
      [refusedWith('password_too_long'), /^password_too_long: Too long: at most 72 characters \(24 in Khmer\)\.$/],
      [refusedWith('password_edge_whitespace'), /^password_edge_whitespace: /],
      [refusedWith('password_known_leaked'), /^password_known_leaked: /],
      [refusedWith('incorrect_password'), /^current_password_incorrect: /],
      [thrownWith('current_password_rate_limited'), /^current_password_rate_limited: /],
      [refusedWith('current_password_rate_limited'), /^current_password_rate_limited: /],
      [thrownWith('password_too_short'), /^password_too_short: Use at least 6 characters\.$/],
      [async () => ({ success: false, error: 'Server busy' }), /^Server busy$/],
      [async () => { throw new Error('Change password timed out') }, /^Change password timed out$/],
    ]
    for (const [change, expected] of cases) {
      const outcome = await changeOwnPassword(input({ change }))
      assert.equal(outcome.changed, false)
      assert.match(outcome.message, expected)
    }
    assert.deepEqual(stored, [], 'a refused change must never be offered to the password manager')
    assert.deepEqual(clipboardWrites, [])
  })
})

await runTest('checked before the Worker: the shared new-password rule, confirmation and the current password', async () => {
  await withBrowser('accepts', async ({ stored }) => {
    const sent: Sent[] = []
    const cases: Array<[Partial<OwnPasswordChangeInput>, RegExp]> = [
      [{ newPassword: ' New pass-1', confirmPassword: ' New pass-1' }, /^password_edge_whitespace: /],
      [{ newPassword: 'short', confirmPassword: 'short' }, /^password_too_short: /],
      [{ newPassword: 'ក'.repeat(25), confirmPassword: 'ក'.repeat(25) }, /^password_too_long: /],
      [{ confirmPassword: 'New pass-2' }, /^new_password_confirm_mismatch: /],
      [{ currentPassword: '   ' }, /^current_password_required_change: /],
    ]
    for (const [overrides, expected] of cases) {
      const outcome = await changeOwnPassword(input(overrides, sent))
      assert.equal(outcome.changed, false)
      assert.match(outcome.message, expected)
    }
    assert.deepEqual(sent, [], 'nothing reaches the Worker')
    assert.deepEqual(stored, [])
    const khmer = await changeOwnPassword(input({ newPassword: 'ក'.repeat(24), confirmPassword: 'ក'.repeat(24) }, sent))
    assert.equal(khmer.changed, true, '24 Khmer letters are exactly 72 bytes')
  })
})

if (failed > 0) process.exitCode = 1
