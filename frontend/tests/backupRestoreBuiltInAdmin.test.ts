// The Backup page offers a restore only to the one account the Worker lets restore (the built-in default admin),
// asks that account for its password, and speaks the Worker's coded refusals in the operator's language.
// The REAL Backup page is mounted over a transport whose answers the test controls, in both language packs.
//
//   other accounts   a backup_restore holder who is not the built-in admin sees one translated sentence, no password
//                    field and no Restore button
//   cancel           cancelling the confirmation empties the password field
//   the copy         the confirmation says the data is replaced (it does not say the package is only validated)
//   refusals         incorrect_password / current_password_rate_limited / restore_builtin_admin_only reach the notice in
//                    the pack's language, not the Worker's English
//   force clear      the banner's force clear needs the password too; a wrong one is translated
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, accessibleText, type MountedSurface, type MemoryNode } from './mountedComponentHarness.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const packs = Object.fromEntries(['en', 'km'].map((lang) => [lang, JSON.parse(read(`../src/lang/${lang}.json`))])) as Record<string, Record<string, string>>
const BACKUP = 'business-os-cloudflare-20261014-020000Z.json'
const builtInAdmin = { id: 1, username: 'admin', role_code: 'admin', role_permissions: { all: true } }
const operator = { id: 2, username: 'owner', role_code: 'admin', role_permissions: { all: true } }
const PASSWORD = 'correct horse'

const harness = await createHarness({ observe: ['api/systemJobs.ts'] })
let failed = 0

type Script = { user: Record<string, unknown>; restore?: () => Promise<unknown>; clear?: (password: string) => Promise<unknown>; maintenance?: Record<string, unknown> | null }

async function mount(lang: 'en' | 'km', script: Script) {
  const words = packs[lang]
  const notices: Array<{ message: string; type?: string }> = []
  const state = { restoreCalls: [] as Array<{ path: string; password: string }>, clearCalls: [] as string[], maintenance: script.maintenance ?? null }
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    queueBackupFolderRestore: async (path: string, confirmation: { currentPassword: string }) => {
      state.restoreCalls.push({ path, password: confirmation.currentPassword })
      return script.restore ? script.restore() : { job_id: 'job-ok', item: { id: 'job-ok', status: 'completed', progress: 100, result: {} } }
    },
    getSystemJob: async () => ({ item: { id: 'job-ok', status: 'completed', progress: 100, result: {} } }),
  }
  const surface = await harness.mount({
    component: 'components/utils-settings/Backup.tsx', props: {},
    app: { page: 'settings', t: (key: string) => words[key] || '', notify: (message: string, type?: string) => { notices.push({ message, type }) }, hasPermission: () => true, user: script.user },
    doubles: {
      'api/systemJobs.ts': {
        getBackupMaintenance: async () => ({ maintenance: state.maintenance }),
        clearBackupMaintenance: async (password: string) => {
          state.clearCalls.push(password)
          const result = await (script.clear ? script.clear(password) : { cleared: true, wasSet: true })
          state.maintenance = null
          return result
        },
      },
    },
  })
  return { surface, words, notices, state }
}

type Ctx = Awaited<ReturnType<typeof mount>>
const buttonsNamed = (surface: MountedSurface, name: string): MemoryNode[] => surface.findAll((node) => node.tagName === 'BUTTON' && accessibleText(node) === name)
const byTestId = (surface: MountedSurface, id: string): MemoryNode[] => surface.findAll((node) => node.getAttribute('data-testid') === id)
const valueOf = (node: MemoryNode): string => String((node as unknown as { value?: unknown }).value ?? '')
const refusal = (message: string, code: string, status = 403) => Object.assign(new Error(message), { status, code })

async function showRestoreSection(ctx: Ctx): Promise<void> {
  const { surface, words } = ctx
  if (!byTestId(surface, 'backup-restore-section').length) {
    await surface.click(surface.findAll((node) => node.tagName === 'BUTTON' && accessibleText(node).includes(words.import_backup_title))[0])
  }
}

async function openRestore(ctx: Ctx): Promise<void> {
  await showRestoreSection(ctx)
  await ctx.surface.type(ctx.surface.field('backup-folder-import-path'), BACKUP)
}

async function check(name: string, run: () => Promise<void>): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

try {
  for (const lang of ['en', 'km'] as const) {
    const words = packs[lang]
    await check(`${lang} pack carries the new refusal texts, km translated rather than an English placeholder`, async () => {
      for (const key of ['restore_builtin_admin_only', 'admin_control_setting_required', 'dedicated_setting_endpoint_required', 'step_up_refused',
        'incorrect_password', 'current_password_rate_limited', 'current_password_required']) {
        assert.ok(words[key] && words[key].trim(), `${lang} pack carries ${key}`)
        if (lang === 'km') assert.notEqual(words[key], packs.en[key], `km ${key} is translated`)
      }
      assert.doesNotMatch(words.backup_restore_validated, lang === 'en' ? /validated/i : /ផ្ទៀងផ្ទាត់/, 'the completion message does not say the restore was only validated')
    })

    await check(`${lang} a backup_restore holder who is not the built-in admin sees one sentence and no restore controls`, async () => {
      const ctx = await mount(lang, { user: operator })
      try {
        await showRestoreSection(ctx)
        const note = byTestId(ctx.surface, 'backup-restore-builtin-admin-only')
        assert.equal(note.length, 1)
        assert.equal(note[0].textContent, words.restore_builtin_admin_only)
        assert.equal(byTestId(ctx.surface, 'backup-restore-start').length, 0, 'no Restore button')
        assert.equal(ctx.surface.findAll((node) => node.id === 'backup-restore-password').length, 0, 'no password field')
      } finally { await ctx.surface.unmount() }
    })

    await check(`${lang} the built-in admin: cancelling the confirmation empties the password, the copy says data is replaced`, async () => {
      const ctx = await mount(lang, { user: builtInAdmin })
      try {
        assert.equal(byTestId(ctx.surface, 'backup-restore-builtin-admin-only').length, 0)
        await openRestore(ctx)
        await ctx.surface.type(ctx.surface.field('backup-restore-password'), PASSWORD)
        assert.equal(valueOf(ctx.surface.field('backup-restore-password')), PASSWORD)
        await ctx.surface.click(ctx.surface.find((node) => node.getAttribute('data-testid') === 'backup-restore-start', 'Restore button'))
        assert.ok(ctx.surface.text().includes(words.import_backup_warning), 'the confirmation asks with the replace-existing-data warning')
        assert.doesNotMatch(ctx.surface.text(), /validates a backup package/i, 'and does not claim the package is only validated')
        await ctx.surface.click(buttonsNamed(ctx.surface, words.cancel)[0])
        assert.equal(ctx.state.restoreCalls.length, 0, 'nothing was sent')
        assert.equal(valueOf(ctx.surface.field('backup-restore-password')), '', 'the password is gone from the field')
      } finally { await ctx.surface.unmount() }
    })

    for (const [code, english] of [
      ['incorrect_password', 'Current password is incorrect. No data was changed.'],
      ['current_password_rate_limited', 'Too many wrong current-password attempts.'],
      ['restore_builtin_admin_only', 'Only the active built-in default admin account can restore a backup. No data was changed.'],
    ] as const) {
      await check(`${lang} a ${code} refusal is shown in the pack's language, not the Worker's English`, async () => {
        const ctx = await mount(lang, { user: builtInAdmin, restore: async () => { throw refusal(english, code, code === 'current_password_rate_limited' ? 429 : 403) } })
        try {
          await openRestore(ctx)
          await ctx.surface.type(ctx.surface.field('backup-restore-password'), PASSWORD)
          await ctx.surface.click(ctx.surface.find((node) => node.getAttribute('data-testid') === 'backup-restore-start', 'Restore button'))
          await ctx.surface.click(buttonsNamed(ctx.surface, words.continue)[0])
          assert.deepEqual(ctx.state.restoreCalls, [{ path: BACKUP, password: PASSWORD }])
          assert.deepEqual(ctx.notices, [{ message: `${words.import_failed}: ${words[code]}`, type: 'error' }])
          assert.equal(valueOf(ctx.surface.field('backup-restore-password')), '', 'the password is emptied after the request')
        } finally { await ctx.surface.unmount() }
      })
    }

    const crashed = { mode: 'restore', phase: 'failed', error: 'Restore failed: D1 timeout', backupKey: BACKUP, startedBy: 'admin' }
    await check(`${lang} the banner's force clear needs the password, sends it, and empties the field`, async () => {
      const ctx = await mount(lang, { user: builtInAdmin, maintenance: crashed })
      try {
        const clear = buttonsNamed(ctx.surface, words.restore_maintenance_clear)
        assert.equal(clear.length, 1)
        await ctx.surface.click(clear[0])
        assert.deepEqual(ctx.notices, [{ message: words.current_password_required, type: 'error' }], 'no password: refused on the page, nothing sent')
        assert.deepEqual(ctx.state.clearCalls, [])
        await ctx.surface.type(ctx.surface.field('backup-maintenance-clear-password'), PASSWORD)
        await ctx.surface.click(buttonsNamed(ctx.surface, words.restore_maintenance_clear)[0])
        await ctx.surface.click(buttonsNamed(ctx.surface, words.restore_maintenance_clear)[1] ?? buttonsNamed(ctx.surface, words.restore_maintenance_clear)[0])
        assert.deepEqual(ctx.state.clearCalls, [PASSWORD])
      } finally { await ctx.surface.unmount() }
    })

    await check(`${lang} a wrong password on the force clear is shown in the pack's language and the password is emptied`, async () => {
      const ctx = await mount(lang, { user: builtInAdmin, maintenance: crashed, clear: async () => { throw refusal('Current password is incorrect. No data was changed.', 'incorrect_password') } })
      try {
        await ctx.surface.type(ctx.surface.field('backup-maintenance-clear-password'), 'wrong')
        await ctx.surface.click(buttonsNamed(ctx.surface, words.restore_maintenance_clear)[0])
        const confirms = buttonsNamed(ctx.surface, words.restore_maintenance_clear)
        await ctx.surface.click(confirms[confirms.length - 1])
        assert.deepEqual(ctx.state.clearCalls, ['wrong'])
        assert.deepEqual(ctx.notices.at(-1), { message: words.incorrect_password, type: 'error' })
        assert.equal(valueOf(ctx.surface.field('backup-maintenance-clear-password')), '')
      } finally { await ctx.surface.unmount() }
    })
  }
} finally {
  await harness.close()
}

await check('the Worker sends the codes this page translates', async () => {
  const stepUp = read('../../cloudflare/src/lib/destructiveStepUp.ts')
  for (const code of ['restore_builtin_admin_only', 'current_password_required', 'incorrect_password', 'current_password_rate_limited']) {
    assert.ok(stepUp.includes(`'${code}'`), `the Worker sends ${code}`)
  }
  const page = read('../src/components/utils-settings/Backup.tsx')
  assert.match(page, /STEP_UP_REFUSAL_CODES = \['restore_builtin_admin_only', 'current_password_required', 'incorrect_password', 'current_password_rate_limited'\]/)
  const labels = read('../src/utils/auditVocabulary.ts')
  assert.ok(labels.includes("step_up_refused: ['step_up_refused', 'Protected action refused']"), 'the Audit Log labels the refusal row')
})

if (failed) process.exit(1)
