import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, propsOf } from './mountedComponentHarness.ts'

const english = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const users = [
  { id: 1, name: 'Owner', username: 'owner', role_code: 'admin', is_active: 1 },
  { id: 2, name: 'Cashier A', username: 'cashier-a', role_name: 'Cashier', is_active: 1 },
  { id: 3, name: 'Cashier B', username: 'cashier-b', role_name: 'Cashier', is_active: 1 },
]
const harness = await createHarness({ observe: ['utils/passwordManager.ts'] })
const resets: Array<{ id: unknown; password: unknown }> = []
const copied: string[] = []
const saved: unknown[] = []
const notices: unknown[] = []
let finish: (result: { success: boolean; error?: string }) => void = () => { throw new Error('no pending reset') }
let reject: (error: Error) => void = () => { throw new Error('no pending reset') }
let finishCopy: (copied: boolean) => void = () => { throw new Error('no pending copy') }
let deferCopy = false
let copyResult = true
let finishStore: (stored: boolean) => void = () => { throw new Error('no pending store') }
let deferStore = false
const reset = async (id: unknown, payload: { newPassword: string }) => {
  resets.push({ id, password: payload.newPassword })
  return new Promise<{ success: boolean; error?: string }>((resolve, fail) => { finish = resolve; reject = fail })
}

try {
  const surface = await harness.mount({
    component: 'components/users/Users.tsx',
    app: { page: 'settings', user: users[0], t: (key: string) => english[key] || key, notify: (...args: unknown[]) => notices.push(args), hasPermission: () => true },
    doubles: {
      'api/userAdminTransport.ts': {
        getUsers: async () => users,
        getRoles: async () => [],
        getPasswordResetRequests: async () => ({ requests: users.map((user) => ({ id: user.id, user_id: user.id, name: user.name, username: user.username })) }),
        resetPassword: reset,
        changeUserPassword: reset,
      },
      'api/actionHistoryTransport.ts': { getActionHistory: async () => ({ items: [] }), getActionHistoryUsers: async () => [] },
      'utils/passwordManager.ts': {
        copyPasswordToClipboard: async (password: string) => { copied.push(password); return deferCopy ? new Promise<boolean>((resolve) => { finishCopy = resolve }) : copyResult },
        requestPasswordSave: async (value: unknown) => { saved.push(value); return deferStore ? new Promise<boolean>((resolve) => { finishStore = resolve }) : true },
      },
    },
  })
  const open = async (name: string) => {
    const button = surface.find((node) => node.tagName === 'BUTTON' && node.textContent === english.reset_password && !!node.parentNode?.textContent.includes(name), `reset request for ${name}`)
    await surface.click(button)
  }
  const enter = async (password: string) => {
    await surface.type(surface.field('reset-password-new'), password)
    await surface.type(surface.field('reset-password-confirm'), password)
  }
  const close = async () => {
    await surface.click(surface.button(english.close))
    await surface.click(surface.button(english.discard))
  }

  await open('Cashier A')
  await enter('Fixture-Secret-A-42!')
  await surface.click(surface.button(english.save))
  assert.deepEqual(resets, [{ id: 2, password: 'Fixture-Secret-A-42!' }])
  await close()
  finish({ success: true })
  await surface.settle()
  await open('Cashier B')
  assert.ok(!surface.text().includes('Fixture-Secret-A-42!'), 'a closed reset must not reveal A\'s password inside B\'s dialog')
  assert.equal(propsOf(surface.field('reset-password-new')).value, '')
  assert.deepEqual(copied, [], 'accepted reset never copies without the Copy action')
  assert.deepEqual(saved, [], 'another user\'s password never enters the administrator\'s vault')

  await enter('Fixture-Secret-B-73!')
  await surface.click(surface.button(english.save))
  finish({ success: true })
  await surface.settle()
  assert.ok(surface.text().includes(english.password_admin_handover_title.replace('{name}', 'Cashier B')))
  assert.ok(surface.text().includes('Fixture-Secret-B-73!'))
  assert.deepEqual(copied, [], 'rendering a current handover does not copy')
  assert.equal(surface.findAll((node) => node.tagName === 'INPUT' && propsOf(node).type === 'password').length, 0, 'handover offers no browser password field')
  await surface.click(surface.button(english.copy_new_password))
  assert.deepEqual(copied, ['Fixture-Secret-B-73!'])
  await surface.click(surface.button(english.done))
  assert.ok(!surface.text().includes('Fixture-Secret-B-73!'), 'Done closes and clears the secret')
  assert.equal(surface.findAll((node) => node.getAttribute('name') === 'reset-password-new' || node.getAttribute('id') === 'reset-password-new').length, 0, 'Done closes the dialog instead of returning to its password form')

  await open('Cashier A')
  await enter('Fixture-Old-A-85!')
  await surface.click(surface.button(english.save))
  await close()
  await open('Cashier A')
  await enter('Fixture-New-A-96!')
  finish({ success: true })
  await surface.settle()
  assert.ok(!surface.text().includes('Fixture-Old-A-85!'), 'reopening the same user is a new reset dialog')
  assert.equal(propsOf(surface.field('reset-password-new')).value, 'Fixture-New-A-96!', 'old completion does not erase the new draft')
  assert.deepEqual(saved, [])
  assert.deepEqual(notices, [])
  await close()

  for (const refusal of ['returned', 'thrown']) {
    await open('Cashier A')
    await enter('Fixture-Refused-A-42!')
    await surface.click(surface.button(english.save))
    await close()
    await open('Cashier B')
    await enter('Fixture-Draft-B-73!')
    if (refusal === 'returned') finish({ success: false, error: 'Old reset refused' })
    else reject(new Error('Old reset unavailable'))
    await surface.settle()
    assert.deepEqual(notices, [], 'a late refusal must not report against a new dialog')
    assert.equal(propsOf(surface.field('reset-password-new')).value, 'Fixture-Draft-B-73!')
    await close()
  }

  await open('Cashier A')
  await enter('Fixture-Copy-A-42!')
  await surface.click(surface.button(english.save))
  finish({ success: true })
  await surface.settle()
  deferCopy = true
  await surface.click(surface.button(english.copy_new_password))
  await surface.click(surface.button(english.done))
  await open('Cashier B')
  await enter('Fixture-Copy-B-73!')
  await surface.click(surface.button(english.save))
  finish({ success: true })
  await surface.settle()
  finishCopy(false)
  await surface.settle()
  assert.ok(!surface.text().includes(english.new_password_copy_failed), 'A\'s late clipboard failure is not B\'s copy result')
  assert.ok(surface.text().includes('Fixture-Copy-B-73!'))
  assert.deepEqual(copied, ['Fixture-Secret-B-73!', 'Fixture-Copy-A-42!'], 'a new handover never copies automatically')
  deferCopy = false
  copyResult = false
  await surface.click(surface.button(english.copy_new_password))
  assert.ok(surface.text().includes(english.new_password_copy_failed), 'the current clipboard refusal is shown without losing the handover')
  await surface.click(surface.button(english.done))

  await open('Owner')
  await enter('Fixture-Owner-New-84!')
  await surface.type(surface.field('reset-password-current'), 'Fixture-Owner-Old-95!')
  const ownForm = surface.find((node) => node.tagName === 'FORM', 'own-password form')
  await surface.call(ownForm, 'onSubmit', [{ preventDefault() {} }])
  deferStore = true
  finish({ success: true })
  await surface.settle()
  assert.equal(saved.length, 1, 'only an accepted own-password change reaches the password manager')
  await close()
  await open('Cashier B')
  await enter('Fixture-Next-B-73!')
  finishStore(true)
  await surface.settle()
  assert.equal(propsOf(surface.field('reset-password-new')).value, 'Fixture-Next-B-73!', 'a late own-password store cannot close or clear another dialog')
  assert.deepEqual(notices, [])
  console.log('PASS actual Users: late success/refusal/clipboard/store results stay scoped; new drafts survive; Copy/Done and own-password vault boundary hold')
} finally {
  await harness.close()
}
