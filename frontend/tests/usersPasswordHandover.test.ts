import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Harness, MemoryDocument, MemoryNode, MountedSurface } from './mountedComponentHarness.ts'

// Every React commit is recorded as a painted frame, so a staff password that
// shows for a single frame under the wrong name fails.

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>

let failed = 0
async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

type StaffMember = { id: number; name: string; username: string; role_id: number; role_name: string; is_active: number }
type Frame = { title: string; shown: string }

const admin = { id: 1, name: 'Owner Admin', username: 'owner', role_code: 'admin' }
const cashierA: StaffMember = { id: 11, name: 'Cashier A', username: 'cashier_a', role_id: 2, role_name: 'Cashier', is_active: 1 }
const cashierB: StaffMember = { id: 12, name: 'Cashier B', username: 'cashier_b', role_id: 2, role_name: 'Cashier', is_active: 1 }
const STAFF = [{ ...admin, role_id: 1, role_name: 'Admin', is_active: 1 }, cashierA, cashierB]
const ROLES = [{ id: 1, name: 'Admin', permissions: '{"all":true}', is_system: 1 }, { id: 2, name: 'Cashier', permissions: '{}', is_system: 0 }]
const RESET_TITLE_PREFIX = `${en.change_password}:`

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const frames: Frame[] = []
// React reports each commit to a devtools hook, so the hook has to exist before react-dom loads.
Object.defineProperty(globalThis, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
  configurable: true,
  value: {
    supportsFiber: true,
    inject: () => 1,
    onCommitFiberRoot: () => { frames.push(...resetDialogFrames()) },
    onCommitFiberUnmount: () => {},
  },
})
const { accessibleText, createHarness, propsOf } = await import('./mountedComponentHarness.ts')

const isResetDialog = (node: MemoryNode): boolean => node.getAttribute('role') === 'dialog'
  && node.querySelectorAll('h2').some((heading) => heading.textContent.startsWith(RESET_TITLE_PREFIX))

function everythingShownIn(node: MemoryNode): string {
  const values = node.querySelectorAll('input').map((input) => String(propsOf(input).value ?? (input as unknown as { value?: string }).value ?? ''))
  return [node.textContent, ...values].join(' ')
}

function resetDialogFrames(): Frame[] {
  const document = globalThis.document as unknown as MemoryDocument | undefined
  if (!document?.querySelectorAll) return []
  return document.querySelectorAll('[role=dialog]').filter(isResetDialog).map((dialog) => ({
    title: dialog.querySelector('h2')?.textContent ?? '',
    shown: everythingShownIn(dialog),
  }))
}

const clipboardWrites: string[] = []
const harness: Harness = await createHarness({ localStorage: { businessos_user: JSON.stringify(admin) } })
Object.defineProperty(globalThis.navigator, 'clipboard', {
  configurable: true,
  value: { writeText: async (text: string) => { clipboardWrites.push(String(text)) } },
})

type ResetAnswer = () => Promise<unknown>

async function mountUsers(resetAnswer: ResetAnswer): Promise<{ page: MountedSurface; resets: unknown[][] }> {
  const resets: unknown[][] = []
  const page = await harness.mount({
    component: 'components/users/Users.tsx',
    app: {
      page: 'settings',
      language: 'en',
      t: (key: string) => en[key] ?? key,
      user: admin,
      notify: () => {},
      hasPermission: () => true,
      can: () => true,
    },
    doubles: {
      'api/userAdminTransport.ts': {
        getUsers: async () => STAFF,
        getRoles: async () => ROLES,
        getPasswordResetRequests: async () => ({ requests: [] }),
        resetPassword: (...args: unknown[]) => { resets.push(args); return resetAnswer() },
      },
      'api/actionHistoryTransport.ts': {
        getActionHistory: async () => ({ items: [] }),
        getActionHistoryUsers: async () => [],
      },
    },
  })
  await page.waitFor(() => page.findAll((node) => node.tagName === 'TD' && node.textContent === cashierB.username).length > 0, 'the staff list')
  return { page, resets }
}

function resetDialog(page: MountedSurface): MemoryNode | null {
  return page.findAll(isResetDialog)[0] ?? null
}

const resetDialogTitle = (page: MountedSurface): string | null => resetDialog(page)?.querySelector('h2')?.textContent ?? null

function openDialog(page: MountedSurface, member: StaffMember): MemoryNode {
  const dialog = resetDialog(page)
  assert.ok(dialog, `the reset dialog for ${member.name} is open`)
  assert.equal(dialog.querySelector('h2')?.textContent, `${RESET_TITLE_PREFIX} ${member.name}`)
  return dialog
}

// The row menu sits behind the open dialog: a keyboard reaches it, the pointer does not.
async function openReset(page: MountedSurface, member: StaffMember, beforeChoosing: () => void = () => {}): Promise<void> {
  const cell = page.find((node) => node.tagName === 'TD' && node.textContent === member.username, `the row of ${member.username}`)
  const row = cell.closest('tr')
  assert.ok(row)
  await page.click(page.find((node) => node.tagName === 'BUTTON' && node.className.includes('three-dot-btn') && row.contains(node), `the row menu of ${member.username}`))
  const menu = page.find((node) => node.hasAttribute('data-portal-menu-content'), 'the row menu')
  beforeChoosing()
  await page.click(page.button(en.change_password, menu))
  openDialog(page, member)
}

async function typeNewPassword(page: MountedSurface, password: string): Promise<void> {
  await page.type(page.field('reset-password-new'), password)
  await page.type(page.field('reset-password-confirm'), password)
}

const saveButton = (page: MountedSurface, dialog: MemoryNode) => page.button(new RegExp(`^${en.save}\\b|^${en.updating}`), dialog)
const closeButton = (page: MountedSurface, dialog: MemoryNode) => page.button(new RegExp(`^${en.close}$`), dialog)
const resetFormCount = (page: MountedSurface) => page.findAll((node) => node.getAttribute('id') === 'reset-password-new').length
const framesShowing = (since: number, text: string) => frames.slice(since).filter((frame) => frame.shown.includes(text))

await runTest('while a staff reset is saving, the dialog cannot be closed', async () => {
  const answer = deferred<unknown>()
  const { page, resets } = await mountUsers(() => answer.promise)
  try {
    await openReset(page, cashierA)
    await typeNewPassword(page, 'Held-Secret-41x')
    await page.click(saveButton(page, openDialog(page, cashierA)), { until: () => resets.length === 1, waitingFor: 'the reset request' })
    assert.equal(propsOf(closeButton(page, openDialog(page, cashierA))).disabled, true, 'the header close is disabled until the Worker answers')
    answer.resolve({ success: true })
    await page.waitFor(() => openDialog(page, cashierA).textContent.includes('Held-Secret-41x'), 'the hand-over')
    assert.equal(propsOf(closeButton(page, openDialog(page, cashierA))).disabled, false, 'the hand-over can be closed')
  } finally {
    await page.unmount()
  }
})

await runTest('a reset answer that arrives after the dialog left that staff member is dropped: never painted, never kept', async () => {
  const answer = deferred<unknown>()
  const { page, resets } = await mountUsers(() => answer.promise)
  const secret = 'Late-Secret-66x'
  let switchedAt = 0
  const assertBNeverShowsA = (moment: string) => {
    const shown = everythingShownIn(openDialog(page, cashierB))
    assert.doesNotMatch(shown, new RegExp(secret), `${moment}: Cashier B's dialog never shows Cashier A's new password`)
    assert.doesNotMatch(shown, new RegExp(cashierA.name), `${moment}: Cashier B's dialog never names Cashier A`)
    assert.equal(resetFormCount(page), 1, `${moment}: Cashier B's dialog shows B's own reset form`)
  }
  try {
    await openReset(page, cashierA)
    await typeNewPassword(page, secret)
    await page.click(saveButton(page, openDialog(page, cashierA)), { until: () => resets.length === 1, waitingFor: 'the reset request' })
    const close = closeButton(page, openDialog(page, cashierA))
    if (!propsOf(close).disabled) {
      await page.click(close)
      const discard = page.findAll((node) => node.tagName === 'BUTTON' && accessibleText(node).includes(en.discard_changes))[0]
      if (discard) await page.click(discard)
      assert.equal(resetDialogTitle(page), null, 'the admin closed Cashier A\'s dialog mid-flight')
    }
    await openReset(page, cashierB, () => { switchedAt = frames.length })
    assertBNeverShowsA('before the late answer')
    answer.resolve({ success: true })
    await page.settle()
    assertBNeverShowsA('after the late answer')
    await openReset(page, cashierA)
    assert.equal(resetFormCount(page), 1, 'Cashier A\'s dialog opens on the reset form')
    assert.deepEqual(framesShowing(switchedAt, secret), [], 'from the switch to Cashier B on, no painted frame shows the dropped password, in B\'s dialog or in A\'s reopened one')
    assert.deepEqual(frames.slice(switchedAt).filter((frame) => frame.title.endsWith(cashierB.name) && frame.shown.includes(cashierA.name)), [], 'no frame of Cashier B\'s dialog names Cashier A')
    assert.equal(clipboardWrites.includes(secret), false, 'the late answer copies nothing')
  } finally {
    await page.unmount()
  }
})

await runTest('a hand-over on screen is never painted under another staff member\'s name, and is gone once the dialog moves on', async () => {
  const { page, resets } = await mountUsers(async () => ({ success: true }))
  const secret = 'Shown-Secret-73x'
  let switchedAt = 0
  try {
    await openReset(page, cashierA)
    await typeNewPassword(page, secret)
    await page.click(saveButton(page, openDialog(page, cashierA)), { until: () => resets.length === 1, waitingFor: 'the reset request' })
    await page.waitFor(() => openDialog(page, cashierA).textContent.includes(secret), 'Cashier A\'s hand-over')
    assert.ok(framesShowing(0, secret).some((frame) => frame.title.endsWith(cashierA.name)), 'the recorder sees the hand-over where it belongs')
    await openReset(page, cashierB, () => { switchedAt = frames.length })
    assert.equal(resetFormCount(page), 1, 'Cashier B\'s dialog shows B\'s own reset form')
    const bFrames = frames.slice(switchedAt).filter((frame) => frame.title.endsWith(cashierB.name))
    assert.ok(bFrames.length > 0, 'Cashier B\'s dialog was painted')
    assert.deepEqual(bFrames.filter((frame) => frame.shown.includes(secret) || frame.shown.includes(cashierA.name)), [], 'no frame of Cashier B\'s dialog shows Cashier A\'s hand-over')
    await openReset(page, cashierA)
    assert.equal(resetFormCount(page), 1, 'back on Cashier A the dialog opens on the reset form')
    assert.deepEqual(framesShowing(switchedAt, secret), [], 'once the dialog moved to another staff member the hand-over is cleared, not kept for a later frame')
  } finally {
    await page.unmount()
  }
})

await runTest('the hand-over copies only on Copy, is never a password input, keeps nothing typed behind it, and Done closes it', async () => {
  const secret = 'Handed-Secret-52x'
  const writesBefore = clipboardWrites.length
  const { page, resets } = await mountUsers(async () => ({ success: true }))
  const saveAndWaitForHandover = async (resetCount: number) => {
    await page.click(saveButton(page, openDialog(page, cashierA)), { until: () => resets.length === resetCount, waitingFor: 'the reset request' })
    await page.waitFor(() => openDialog(page, cashierA).textContent.includes(secret), 'the hand-over')
  }
  const discardPromptOpen = () => page.findAll((node) => node.getAttribute('role') === 'dialog' && node.textContent.includes(en.unsaved_changes_title)).length > 0
  try {
    await openReset(page, cashierA)
    await typeNewPassword(page, secret)
    await page.click(closeButton(page, openDialog(page, cashierA)))
    assert.equal(discardPromptOpen(), true, 'a typed password is unsaved work: closing asks first')
    await page.click(page.button(new RegExp(`^${en.back}$`)))
    await saveAndWaitForHandover(1)
    const dialog = openDialog(page, cashierA)
    assert.ok(dialog.textContent.includes(en.password_admin_handover_title.replace('{name}', cashierA.name)))
    assert.deepEqual(dialog.querySelectorAll('input').filter((input) => input.getAttribute('type') === 'password').map((input) => input.getAttribute('name')), [], 'the hand-over has no type=password input')
    assert.equal(everythingShownIn(dialog).split(secret).length - 1, 1, 'the password is shown once, in text or in any input')
    assert.deepEqual(clipboardWrites.slice(writesBefore), [], 'typing, saving and showing the hand-over copy nothing')

    await page.click(page.button(en.copy_new_password, dialog))
    assert.deepEqual(clipboardWrites.slice(writesBefore), [secret], 'Copy writes the clipboard exactly once')

    await page.click(closeButton(page, dialog))
    assert.equal(discardPromptOpen(), false, 'nothing typed is left in the form behind the hand-over, so closing it asks nothing')
    assert.equal(resetDialogTitle(page), null, 'the header close closes the hand-over')

    await openReset(page, cashierA)
    await typeNewPassword(page, secret)
    await saveAndWaitForHandover(2)
    await page.click(page.button(new RegExp(`^${en.done}$`), openDialog(page, cashierA)))
    assert.equal(resetDialogTitle(page), null, 'Done closes the dialog')
    assert.doesNotMatch(everythingShownIn(page.body), new RegExp(secret), 'after Done the password is shown nowhere')
    await openReset(page, cashierA)
    assert.equal(resetFormCount(page), 1, 'reopening starts on the reset form')
    assert.doesNotMatch(everythingShownIn(openDialog(page, cashierA)), new RegExp(secret), 'reopening shows no old hand-over')
    assert.deepEqual(clipboardWrites.slice(writesBefore), [secret], 'no further clipboard write happened')
  } finally {
    await page.unmount()
  }
})

await harness.close()
if (failed) {
  console.error(`${failed} users password hand-over test(s) failed`)
  process.exit(1)
}
console.log('users password hand-over: all cases pass')
