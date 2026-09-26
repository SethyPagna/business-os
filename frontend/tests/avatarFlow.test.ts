// My Profile's avatar flows, driven as behaviour (U-profile3, refuter X9,
// 27 Sep 2026). The refuter's mutants M16 (the upload never attaches the
// photo to the account) and M17 (Remove deletes without asking) survived the
// source-shape locks in profileAccountWiring.test.ts. The logic now lives in
// components/users/avatarFlow.ts, which this test runs with fake APIs; the
// last two cases pin that UserProfileModal delegates to it and adds nothing.
//
// Run: node tests/avatarFlow.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

let failed = 0
const runTest = async (name: string, fn: () => void | Promise<void>): Promise<void> => {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

type Flow = typeof import('../src/components/users/avatarFlow.ts')
let flow: Flow | null = null
try {
  flow = await import('../src/components/users/avatarFlow.ts')
} catch (error) {
  console.error('avatarFlow.ts could not be loaded:', (error as Error).message)
}
const need = (): Flow => { assert.ok(flow, 'components/users/avatarFlow.ts exists'); return flow! }

const MESSAGES = { noPath: 'no path', attachFailed: 'attach failed' }

function fakeApi(overrides: { upload?: unknown; attach?: unknown } = {}) {
  const calls: string[] = []
  const account: { avatar_path: string | null } = { avatar_path: null }
  const api = {
    async uploadUserAvatar(payload: { filePath: string; fileName: string }) {
      calls.push(`upload ${payload.fileName} ${payload.filePath.slice(0, 10)}`)
      return 'upload' in overrides ? overrides.upload as { path?: string } : { path: '/uploads/avatar-1-0a1b2c3d.png' }
    },
    async setUserAvatar(userId: number | string, path: string) {
      calls.push(`attach ${userId} ${path}`)
      if ('attach' in overrides) return overrides.attach as { success?: boolean }
      account.avatar_path = path
      return { success: true, avatar_path: path, updated_at: '2026-09-27 10:00:00' }
    },
  }
  return { api, calls, account }
}

await runTest('M16: an uploaded photo is attached to the account before the flow resolves', async () => {
  const { api, calls, account } = fakeApi()
  const result = await need().uploadAndAttachAvatar(api, 7, 'data:image/png;base64,AAAA', MESSAGES)
  assert.deepEqual(calls, ['upload avatar.png data:image', 'attach 7 /uploads/avatar-1-0a1b2c3d.png'])
  assert.equal(account.avatar_path, '/uploads/avatar-1-0a1b2c3d.png', 'the account holds the photo')
  assert.deepEqual(result, { avatar_path: '/uploads/avatar-1-0a1b2c3d.png', updated_at: '2026-09-27 10:00:00' })
})

await runTest('an attach refusal fails the flow (no false "Avatar uploaded")', async () => {
  const { api } = fakeApi({ attach: { success: false, error: 'That image is not in the file library.' } })
  await assert.rejects(need().uploadAndAttachAvatar(api, 7, 'data:x', MESSAGES), /not in the file library/)
  const silent = fakeApi({ attach: null })
  await assert.rejects(need().uploadAndAttachAvatar(silent.api, 7, 'data:x', MESSAGES), /attach failed/)
})

await runTest('an upload with no path never attaches', async () => {
  const { api, calls } = fakeApi({ upload: {} })
  await assert.rejects(need().uploadAndAttachAvatar(api, 7, 'data:x', MESSAGES), /no path/)
  assert.equal(calls.some((c) => c.startsWith('attach')), false)
})

await runTest('each step goes through the caller\'s runner, upload then attach', async () => {
  const { api } = fakeApi()
  const steps: string[] = []
  await need().uploadAndAttachAvatar(api, 7, 'data:x', MESSAGES, (step, fn) => { steps.push(step); return fn() })
  assert.deepEqual(steps, ['upload', 'attach'])
})

function removeHarness(working = false) {
  const log: string[] = []
  let open = false
  const remove = async () => { log.push('remove') }
  const f = need().createAvatarRemoveFlow({
    closeViewer: () => log.push('closeViewer'),
    setConfirmOpen: (next: boolean) => { open = next; log.push(`confirm ${next ? 'open' : 'closed'}`) },
    isWorking: () => working,
    remove,
  })
  return { f, log, isOpen: () => open }
}

await runTest('M17: Remove only opens the confirm dialog; nothing is removed until confirmed', async () => {
  const { f, log, isOpen } = removeHarness()
  f.request()
  await Promise.resolve()
  assert.deepEqual(log, ['closeViewer', 'confirm open'])
  assert.equal(isOpen(), true)
  await f.confirm()
  assert.deepEqual(log, ['closeViewer', 'confirm open', 'remove'])
})

await runTest('dismissing the dialog removes nothing; dismissing mid-removal is ignored', async () => {
  const idle = removeHarness(false)
  idle.f.request()
  idle.f.dismiss()
  assert.equal(idle.isOpen(), false)
  assert.equal(idle.log.includes('remove'), false)
  const busy = removeHarness(true)
  busy.f.request()
  busy.f.dismiss()
  assert.equal(busy.isOpen(), true, 'the dialog stays while the removal runs')
})

// --- the modal delegates and adds nothing -----------------------------------
const profile = readFileSync(new URL('../src/components/users/UserProfileModal.tsx', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')

await runTest('the modal uploads only through uploadAndAttachAvatar, and announces success after it', () => {
  assert.doesNotMatch(profile, /getProfileApi\(\)\.(?:uploadUserAvatar|setUserAvatar)\(/, 'no direct upload/attach call bypasses the flow')
  const save = profile.slice(profile.indexOf('const saveAvatarFromEditor = async'), profile.indexOf('const removeAvatar = async'))
  const flowAt = save.indexOf('await uploadAndAttachAvatar(')
  assert.ok(flowAt > -1, 'saveAvatarFromEditor awaits uploadAndAttachAvatar')
  assert.ok(flowAt < save.indexOf("tr('avatar_uploaded'"), 'success is announced after the account holds the photo')
})

await runTest('the modal wires Remove to the flow exactly: request opens, confirm removes, close dismisses', () => {
  assert.match(profile, /onRemove=\{avatarRemoveFlow\.request\}/)
  assert.match(profile, /onConfirm=\{\(\) => \{ void avatarRemoveFlow\.confirm\(\) \}\}\n\s*onClose=\{avatarRemoveFlow\.dismiss\}/)
  const removeCalls = profile.match(/\bremoveAvatar\b/g) || []
  // Its definition and the one hand-off to the flow; nothing else calls it.
  assert.equal(removeCalls.length, 2, `removeAvatar is referenced ${removeCalls.length} times`)
  assert.match(profile, /remove: removeAvatar,/)
})

if (failed) {
  console.error(`${failed} failed`)
  process.exitCode = 1
}
