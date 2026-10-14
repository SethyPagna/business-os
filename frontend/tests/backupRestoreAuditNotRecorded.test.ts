// A restore whose audit row could not be written: the data IS restored, but the Worker answers
// 503 restore_audit_not_recorded and leaves maintenance ON until an administrator clears it and runs the same restore
// again. The REAL Backup page is mounted over a transport whose answers the test controls, in both language packs.
//
//   the answer      one message in the pack's language, never "Import failed: <the Worker's English>" (the data was
//                   restored), telling the operator to clear maintenance and run the same restore again
//   the way out     the maintenance banner appears at once (not after its 15 s poll) and says the same thing instead
//                   of "the restore CRASHED and the database is half-restored"; its Clear button shows the before and
//                   after, clears, and the Restore button is usable again with the same backup still chosen
//   after a reload  the persisted maintenance state (no code, only the Worker's sentence) gets the same banner
//   controls        an ordinary crashed restore keeps the old banner and its old wording; any other failed restore
//                   keeps "Import failed: <message>"
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, accessibleText, type MountedSurface, type MemoryNode } from './mountedComponentHarness.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const packs = Object.fromEntries(['en', 'km'].map((lang) => [lang, JSON.parse(read(`../src/lang/${lang}.json`))])) as Record<string, Record<string, string>>
const WORKER_SENTENCE = 'Backup data was restored, but the restore could not be recorded in the audit log. Maintenance stays on: clear maintenance, then retry the same restore.'
const BACKUP = 'business-os-cloudflare-20261013-020000Z.json'
const PASSWORD = 'correct horse battery staple'
const user = { id: 1, username: 'admin', role_code: 'admin', role_permissions: { all: true } }

const harness = await createHarness({ observe: ['api/systemJobs.ts'] })
let failed = 0

const auditError = () => Object.assign(new Error(WORKER_SENTENCE), { status: 503, code: 'restore_audit_not_recorded', outcome: 'unknown' })
const auditState = () => ({ mode: 'restore', phase: 'failed', error: WORKER_SENTENCE, backupKey: BACKUP, startedBy: 'owner' })

type Script = { restore?: (call: number) => Promise<unknown>; maintenance?: Record<string, unknown> | null; onRestoreFailed?: (state: { maintenance: Record<string, unknown> | null }) => void }

async function mount(lang: 'en' | 'km', script: Script) {
  const words = packs[lang]
  const notices: Array<{ message: string; type?: string }> = []
  const state = { maintenance: script.maintenance ?? null, restoreCalls: [] as string[], maintenanceReads: 0, clears: 0 }
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    queueBackupFolderRestore: async (path: string) => {
      state.restoreCalls.push(path)
      try { return await (script.restore ? script.restore(state.restoreCalls.length) : { job_id: 'job-ok', item: { id: 'job-ok', status: 'completed', progress: 100, result: {} } }) } catch (error) { script.onRestoreFailed?.(state); throw error }
    },
    getSystemJob: async () => ({ item: { id: 'job-ok', status: 'completed', progress: 100, result: {} } }),
  }
  const surface = await harness.mount({
    component: 'components/utils-settings/Backup.tsx', props: {},
    app: { page: 'settings', t: (key: string) => words[key] || '', notify: (message: string, type?: string) => { notices.push({ message, type }) }, hasPermission: () => true, user },
    doubles: {
      'api/systemJobs.ts': {
        getBackupMaintenance: async () => { state.maintenanceReads += 1; return { maintenance: state.maintenance } },
        clearBackupMaintenance: async (currentPassword: string) => { assert.equal(currentPassword, PASSWORD, 'the typed password is sent'); state.clears += 1; state.maintenance = null; return { cleared: true, wasSet: true } },
      },
    },
  })
  return { surface, words, notices, state }
}

type Ctx = Awaited<ReturnType<typeof mount>>
const buttonsNamed = (surface: MountedSurface, name: string): MemoryNode[] => surface.findAll((node) => node.tagName === 'BUTTON' && accessibleText(node) === name)
const hasText = (ctx: Ctx, text: string): boolean => ctx.surface.text().includes(text)
// The banner's Clear is icon + one word, its full name in the tooltip; the confirmation's button carries the full name as text.
const bannerClear = (ctx: Ctx): MemoryNode[] => ctx.surface.findAll((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === ctx.words.restore_audit_pending_clear && node.getAttribute('title') === ctx.words.restore_audit_pending_clear)
const confirmClear = (ctx: Ctx): MemoryNode[] => ctx.surface.findAll((node) => node.tagName === 'BUTTON' && node.textContent === ctx.words.restore_audit_pending_clear)

async function startRestore(ctx: Ctx): Promise<void> {
  const { surface, words } = ctx
  if (!surface.findAll((node) => node.getAttribute('data-testid') === 'backup-restore-start').length) {
    await surface.click(surface.findAll((node) => node.tagName === 'BUTTON' && accessibleText(node).includes(words.import_backup_title))[0])
    await surface.type(surface.field('backup-folder-import-path'), BACKUP)
  }
  await surface.type(surface.field('backup-restore-password'), PASSWORD)
  await surface.click(surface.find((node) => node.getAttribute('data-testid') === 'backup-restore-start', 'Restore button'))
  await surface.click(buttonsNamed(surface, words.continue)[0])
}

async function check(name: string, run: () => Promise<void>): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

try {
  for (const lang of ['en', 'km'] as const) {
    const words = packs[lang]
    await check(`${lang} pack carries the restore-audit texts, km translated rather than an English placeholder`, async () => {
      for (const key of ['restore_audit_not_recorded', 'restore_audit_pending_title', 'restore_audit_pending_hint', 'restore_audit_pending_clear',
        'restore_audit_pending_clear_confirm', 'restore_audit_pending_writes', 'restore_audit_pending_writes_change', 'restore_audit_pending_audit_change', 'restore_audit_pending_cleared']) {
        assert.ok(words[key] && words[key].trim(), `${lang} pack carries ${key}`)
        if (lang === 'km') assert.notEqual(words[key], packs.en[key], `km ${key} is translated`)
      }
    })

    await check(`${lang} 503 restore_audit_not_recorded: the answer, the banner at once, the way out, the retry`, async () => {
      const ctx = await mount(lang, {
        restore: async (call) => { if (call === 1) throw auditError(); return { job_id: 'job-ok', item: { id: 'job-ok', status: 'completed', progress: 100, result: {} } } },
        onRestoreFailed: (state) => { state.maintenance = auditState() },
      })
      try {
        assert.equal(bannerClear(ctx).length, 0, 'no maintenance, no banner')
        const readsBefore = ctx.state.maintenanceReads
        await startRestore(ctx)
        // The answer: one message, in the pack's language, that is not the "Import failed" error of an ordinary failure.
        assert.deepEqual(ctx.notices, [{ message: words.restore_audit_not_recorded, type: 'error' }])
        assert.ok(!ctx.notices.some((notice) => notice.message.includes(WORKER_SENTENCE) || notice.message.startsWith(words.import_failed)), "not the Worker's English and not 'Import failed'")
        // The banner: at once (the 15 s poll has not run), saying what happened, not "crashed / half-restored".
        assert.ok(ctx.state.maintenanceReads > readsBefore, 'the banner re-read the maintenance state straight away')
        assert.ok(hasText(ctx, words.restore_audit_pending_title), 'the banner says the data was restored but not recorded')
        assert.ok(hasText(ctx, words.restore_audit_pending_hint), 'and says what to do: clear maintenance, run the same restore again')
        assert.ok(!hasText(ctx, words.restore_maintenance_failed), 'it does not claim the restore crashed or is half-restored')
        assert.ok(!hasText(ctx, words.restore_maintenance_clear), 'nor offer "accept half-state"')
        // The way out: Clear shows what changes before it does.
        const clear = bannerClear(ctx)
        assert.equal(clear.length, 1, 'one Clear button, with its translated tooltip')
        assert.equal(clear[0].textContent, words.clear, 'icon plus the one word')
        await ctx.surface.type(ctx.surface.field('backup-maintenance-clear-password'), PASSWORD)
        await ctx.surface.click(clear[0])
        const confirm = confirmClear(ctx)
        assert.equal(confirm.length, 1, 'the confirmation opened over the banner')
        assert.ok(hasText(ctx, words.restore_audit_pending_clear_confirm), 'it says what clearing does')
        // The decision point, not only the banner hint, says the second restore replaces what is saved in between.
        const replaces = lang === 'en' ? /replaced/ : /ជំនួស/
        assert.match(words.restore_audit_pending_clear_confirm, replaces, 'the confirmation warns that anything saved before the second restore is replaced')
        assert.match(words.restore_audit_pending_hint, lang === 'en' ? /replaces/ : /ជំនួស/, 'as the banner hint does')
        assert.ok(hasText(ctx, words.restore_audit_pending_writes) && hasText(ctx, words.restore_audit_pending_writes_change), 'it shows the writes before and after')
        assert.ok(hasText(ctx, words.restore_audit_pending_audit_change), 'and the audit record before and after')
        assert.equal(ctx.state.clears, 0, 'nothing is cleared until confirmed')
        await ctx.surface.click(confirm[0])
        assert.equal(ctx.state.clears, 1)
        assert.equal(bannerClear(ctx).length, 0, 'the banner is gone')
        assert.equal(ctx.notices.at(-1)?.message, words.restore_audit_pending_cleared, 'and says to run the same restore again now')
        // The retry: the Restore button is usable again, the same backup is still chosen, and it goes through.
        await startRestore(ctx)
        assert.deepEqual(ctx.state.restoreCalls, [BACKUP, BACKUP], 'the same restore, sent again')
      } finally { await ctx.surface.unmount() }
    })

    await check(`${lang} after a reload the persisted state (only the Worker's sentence, no code) gets the same banner and way out`, async () => {
      const ctx = await mount(lang, { maintenance: auditState() })
      try {
        assert.ok(hasText(ctx, words.restore_audit_pending_title))
        assert.ok(!hasText(ctx, words.restore_maintenance_failed))
        assert.equal(bannerClear(ctx).length, 1)
        await ctx.surface.type(ctx.surface.field('backup-maintenance-clear-password'), PASSWORD)
        await ctx.surface.click(bannerClear(ctx)[0])
        await ctx.surface.click(confirmClear(ctx)[0])
        assert.equal(ctx.state.clears, 1)
        assert.equal(bannerClear(ctx).length, 0)
      } finally { await ctx.surface.unmount() }
    })

    await check(`${lang} control: an ordinary crashed restore keeps the old banner and its old wording`, async () => {
      const ctx = await mount(lang, { maintenance: { mode: 'restore', phase: 'failed', error: 'Restore failed: D1 timeout', backupKey: BACKUP } })
      try {
        assert.ok(hasText(ctx, words.restore_maintenance_failed))
        assert.ok(!hasText(ctx, words.restore_audit_pending_title))
        assert.equal(buttonsNamed(ctx.surface, words.restore_maintenance_clear).length, 1, 'its own Clear button')
        assert.equal(bannerClear(ctx).length, 0)
      } finally { await ctx.surface.unmount() }
    })

    await check(`${lang} control: any other failed restore keeps "Import failed: <message>"`, async () => {
      const ctx = await mount(lang, { restore: async () => { throw Object.assign(new Error('Internal error'), { status: 500 }) } })
      try {
        await startRestore(ctx)
        assert.deepEqual(ctx.notices, [{ message: `${words.import_failed}: Internal error`, type: 'error' }])
        assert.ok(!hasText(ctx, words.restore_audit_pending_title))
      } finally { await ctx.surface.unmount() }
    })
  }
} finally {
  await harness.close()
}

await check("the code and the maintenance sentence are the Worker's", async () => {
  const worker = read('../../cloudflare/src/routes/backups.ts')
  assert.ok(worker.includes("code: 'restore_audit_not_recorded'"), 'the Worker sends this code with the 503')
  assert.ok(worker.includes(`const message = '${WORKER_SENTENCE}'`), "and stores this sentence in the maintenance state, the only thing a reload can read")
  const transport = read('../src/api/systemJobs.ts')
  assert.ok(transport.includes("'restore_audit_not_recorded'"))
  assert.ok(transport.includes(WORKER_SENTENCE.slice(0, WORKER_SENTENCE.indexOf(' Maintenance stays on'))), "the banner matches the sentence's own leading words")
})

if (failed) process.exit(1)
