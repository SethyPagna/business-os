// "Default login duration" in My Profile, mounted: the REAL UserProfileModal with the Worker's answers played by
// changeSessionDuration. The Worker refuses a longer duration without the current password (400
// session_duration_password_required); the modal then asks for it in the shared compact dialog and retries.
//
//   longer         first sent without a password; the dialog opens; a wrong password keeps it open with the reason in the
//                  pack and an empty field; the right one closes it and saves once
//   cancel         Cancel, X and Escape make no second request and put the picker back on the saved value
//   shorter        saves at once, no dialog
//   429            says why in the pack, no dialog, picker back on the saved value
//   the dialog     masked input, translated, Khmer text is not clipped (leading-relaxed, wrapping buttons)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, propsOf, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>

let failed = 0
const mounted: MountedSurface[] = []
async function check(name: string, run: () => Promise<void>): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) } finally {
    for (const page of mounted.splice(0)) await page.unmount()
  }
}

type Refusal = { success: false; code: string; error: string; status: number; retryAfterSeconds: number | null }
const refusal = (code: string, status = 400): Refusal => ({ success: false, code, error: 'English from the Worker', status, retryAfterSeconds: null })

const harness = await createHarness({ localStorage: { businessos_session_duration: 'session' } })
const account = { id: 7, username: 'cashier', name: 'Cashier', organization_id: 1 }
;(globalThis.window as unknown as { api: Record<string, unknown> }).api = {
  getUserProfile: async () => ({ success: true, ...account, phone: '', email: '', avatar_path: null }),
  otpStatus: async () => ({ otpEnabled: false }),
}

type Call = { duration: unknown; password: string }
async function mountProfile(pack: Record<string, string>, answers: Array<(call: Call) => unknown>) {
  const calls: Call[] = []
  const toasts: Array<{ message: string; type: string }> = []
  const page = await harness.mount({
    component: 'components/users/UserProfileModal.tsx',
    props: { onClose: () => {} },
    app: {
      user: account,
      language: pack === km ? 'km' : 'en',
      t: (key: string) => pack[key] ?? key,
      notify: (message: unknown, type?: string) => { toasts.push({ message: String(message), type: type || 'success' }) },
      hasPermission: () => false,
      settings: { login_session_duration: 'session' },
      changeSessionDuration: async (duration: unknown, password = '') => {
        const call = { duration, password }
        calls.push(call)
        const answer = answers[Math.min(calls.length, answers.length) - 1]
        return answer(call)
      },
    },
    doubles: {},
  })
  mounted.push(page)
  await page.waitFor(() => page.findAll((node) => node.tagName === 'BUTTON' && node.textContent.includes(pack.security)).length > 0, 'the profile sections')
  await page.click(page.button(pack.security))
  return { page, calls, toasts }
}

const picker = (page: MountedSurface): MemoryNode => page.find((node) => node.getAttribute('id') === 'session-duration-profile', 'the login duration picker')
const pickerText = (page: MountedSurface): string => picker(page).textContent
async function choose(page: MountedSurface, label: string): Promise<void> {
  await page.click(picker(page))
  await page.click(page.find((node) => node.getAttribute('role') === 'option' && node.textContent.includes(label), `the option ${label}`))
}
const dialog = (page: MountedSurface): MemoryNode | null => page.findAll((node) => node.getAttribute('role') === 'dialog' && node.textContent.includes(en.session_duration_password_title ?? '')).at(0) ?? null
const dialogFor = (page: MountedSurface, title: string): MemoryNode | null => page.findAll((node) => node.getAttribute('role') === 'dialog' && node.textContent.includes(title)).at(0) ?? null
const passwordInput = (page: MountedSurface): MemoryNode => page.field('session_duration_current_password')

try {
  await check('longer: sent without a password first, then asked for it; a wrong one keeps the dialog open with the reason and an empty field; the right one saves once', async () => {
    const { page, calls, toasts } = await mountProfile(en, [
      () => refusal('session_duration_password_required'),
      () => refusal('incorrect_password'),
      (call) => ({ success: true, sessionDuration: String(call.duration), sessionExpiresAt: '' }),
    ])
    await choose(page, en.for_30_days)
    assert.match(pickerText(page), new RegExp(en.for_30_days))
    await page.click(page.button(en.save_login_duration))
    assert.deepEqual(calls, [{ duration: '30d', password: '' }], 'the first try carries no password')
    assert.ok(dialog(page), 'the dialog opens on the Worker asking for it')
    const input = passwordInput(page)
    assert.equal(input.getAttribute('type'), 'password', 'the field is masked')
    assert.equal(propsOf(input).autoComplete, 'current-password')
    assert.ok(propsOf(page.button(en.save, dialog(page)!)).disabled, 'Save waits for a password')

    await page.type(passwordInput(page), 'wrong-password')
    await page.click(page.button(en.save, dialog(page)!))
    assert.deepEqual(calls.at(-1), { duration: '30d', password: 'wrong-password' })
    assert.ok(dialog(page), 'a wrong password keeps the dialog open: a way through')
    assert.equal(dialog(page)!.querySelector('[role=alert]')?.textContent, en.current_password_incorrect)
    assert.equal(String(propsOf(passwordInput(page)).value ?? ''), '', 'and empties the field')
    assert.equal(toasts.length, 0, 'the reason is in the dialog, not also a toast')

    await page.type(passwordInput(page), 'right-password')
    await page.click(page.button(en.save, dialog(page)!))
    assert.deepEqual(calls.at(-1), { duration: '30d', password: 'right-password' })
    assert.equal(calls.length, 3)
    assert.equal(dialog(page), null, 'the dialog closes once it is saved')
    assert.deepEqual(toasts, [{ message: en.settings_saved, type: 'success' }])
    assert.match(pickerText(page), new RegExp(en.for_30_days), 'the picker keeps the saved choice')
  })

  await check('cancel: no second request and the picker returns to the saved value', async () => {
    const { page, calls } = await mountProfile(en, [() => refusal('session_duration_password_required')])
    await choose(page, en.for_14_days)
    await page.click(page.button(en.save_login_duration))
    assert.ok(dialog(page))
    await page.click(page.button(en.cancel, dialog(page)!))
    assert.equal(dialog(page), null)
    assert.equal(calls.length, 1, 'cancelling asks nothing more')
    assert.match(pickerText(page), new RegExp(en.until_browser_closes), 'back on the value that is saved')
  })

  await check('shorter or equal: saved at once, no dialog', async () => {
    const { page, calls, toasts } = await mountProfile(en, [(call) => ({ success: true, sessionDuration: String(call.duration), sessionExpiresAt: '' })])
    await choose(page, en.for_1_day)
    await page.click(page.button(en.save_login_duration))
    assert.deepEqual(calls, [{ duration: '1d', password: '' }])
    assert.equal(dialog(page), null)
    assert.deepEqual(toasts, [{ message: en.settings_saved, type: 'success' }])
  })

  await check('429 on the first try: the reason in the pack, no dialog, picker back on the saved value', async () => {
    const { page, calls, toasts } = await mountProfile(en, [() => refusal('session_duration_rate_limited', 429)])
    await choose(page, en.for_7_days)
    await page.click(page.button(en.save_login_duration))
    assert.equal(calls.length, 1)
    assert.equal(dialog(page), null)
    assert.deepEqual(toasts, [{ message: en.session_duration_rate_limited, type: 'error' }])
    assert.match(pickerText(page), new RegExp(en.until_browser_closes))
  })

  await check('429 on the password try: the dialog stays with the wait in the pack and a Cancel', async () => {
    const { page, calls } = await mountProfile(en, [() => refusal('session_duration_password_required'), () => refusal('current_password_rate_limited', 429)])
    await choose(page, en.for_3_days)
    await page.click(page.button(en.save_login_duration))
    await page.type(passwordInput(page), 'whatever')
    await page.click(page.button(en.save, dialog(page)!))
    assert.equal(dialog(page)!.querySelector('[role=alert]')?.textContent, en.current_password_rate_limited)
    await page.click(page.button(en.cancel, dialog(page)!))
    assert.equal(dialog(page), null)
    assert.equal(calls.length, 2)
  })

  await check('Khmer: the dialog, the reason and the buttons are in the pack, wrap and are not clipped', async () => {
    const { page } = await mountProfile(km, [() => refusal('session_duration_password_required'), () => refusal('incorrect_password')])
    await choose(page, km.for_7_days)
    await page.click(page.button(km.save_login_duration))
    const open = dialogFor(page, km.session_duration_password_title)
    assert.ok(open, 'the Khmer title')
    assert.ok(open.textContent.includes(km.session_duration_password_required))
    assert.equal(passwordInput(page).getAttribute('placeholder'), km.your_current_password)
    await page.type(passwordInput(page), 'wrong')
    await page.click(page.button(km.save, open))
    const alert = dialogFor(page, km.session_duration_password_title)!.querySelector('[role=alert]')
    assert.equal(alert?.textContent, km.current_password_incorrect)
    assert.match(alert!.className, /leading-relaxed/, 'Khmer needs the relaxed line height')
    for (const label of [km.save, km.cancel]) assert.match(page.button(label, dialogFor(page, km.session_duration_password_title)!).className, /break-words/, `${label} wraps instead of clipping`)
    await page.click(page.button(km.cancel, dialogFor(page, km.session_duration_password_title)!))
  })
} finally {
  await harness.close()
}

if (failed) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nsessionDurationPrompt: all checks passed')
