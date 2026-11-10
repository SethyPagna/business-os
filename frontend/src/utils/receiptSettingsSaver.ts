import { withLoaderTimeout } from './loaders.ts'
import { manualSaveNotice, settingsSaveOutcome, type ManualSaveNotice } from './settingsSave.ts'

export type WriteOutcome = 'saved' | 'unchanged' | 'failed'
export interface WriteResult {
  outcome: WriteOutcome
  message?: string
}
export type PrintFlusher = () => Promise<WriteOutcome | 'idle'>

type SaveFn = (settings: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown> | unknown
type Translate = (key: string, fallback?: string) => string

export interface ReceiptSettingsSaverDeps<T> {
  saveSettings: SaveFn
  notify: (message: string, type?: string) => void
  t: Translate
  getTemplate: () => T
  getFooter: () => string
  serializeTemplate: (template: T) => string
  parseTemplate: (input: unknown) => T
  setSaving: (saving: boolean) => void
}

export interface SaverTimers {
  set: (run: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
}

export const RECEIPT_AUTOSAVE_MS = 900
export const RECEIPT_SETTINGS_SAVE_TIMEOUT_MS = 12000
const REFRESH_CHANNELS = ['settings', 'sales', 'pos', 'dashboard']

const browserTimers: SaverTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

// Owns every write on the Receipt settings page: the template autosave, the
// default-footer autosave and the Save button, plus the Print section's pending
// write through a flusher it registers. The React components only feed it
// edits and apply what it hands back, so what the tests drive is what ships.
export function createReceiptSettingsSaver<T>(
  getDeps: () => ReceiptSettingsSaverDeps<T>,
  timers: SaverTimers = browserTimers,
  saveTimeoutMs: number = RECEIPT_SETTINGS_SAVE_TIMEOUT_MS,
) {
  let persistedTemplate = ''
  let persistedFooter = ''
  let templateHydrated = false
  let footerHydrated = false
  let templateTimer: unknown = null
  let footerTimer: unknown = null
  let templateChain: Promise<unknown> = Promise.resolve()
  let footerChain: Promise<unknown> = Promise.resolve()
  let templateBusy = 0
  let footerBusy = 0
  let silentSaves = false
  let autosaveFailureShown = false
  let alive = true
  let printFlusher: PrintFlusher | null = null

  const timed = <R>(run: () => Promise<R> | R, label: string): Promise<R> => withLoaderTimeout(run, label, saveTimeoutMs)

  async function writeTemplate(force: boolean): Promise<WriteResult> {
    const deps = getDeps()
    const serialized = deps.serializeTemplate(deps.getTemplate())
    if (!force && serialized === persistedTemplate) return { outcome: 'unchanged' }
    const options = {
      silentToast: true,
      refreshChannels: REFRESH_CHANNELS,
      reason: 'receipt-template-saved',
      source: force ? 'receipt-settings:manual-save' : 'receipt-settings:auto-save',
    }
    type Answer = { conflict?: boolean; actualUpdatedAt?: string | null } | undefined | void
    try {
      let result = await timed(() => deps.saveSettings({ receipt_template: serialized }, options), 'Receipt settings save') as Answer
      for (let attempt = 0; result?.conflict && result?.actualUpdatedAt && attempt < 3; attempt += 1) {
        const expectedUpdatedAt = result.actualUpdatedAt
        result = await timed(() => deps.saveSettings({ receipt_template: serialized, expectedUpdatedAt }, options), 'Receipt settings conflict retry') as Answer
      }
      if (result?.conflict) {
        result = await timed(() => deps.saveSettings({ receipt_template: serialized }, { ...options, skipExpectedUpdatedAt: true }), 'Receipt settings conflict fallback') as Answer
      }
      if (result?.conflict) {
        return { outcome: 'failed', message: deps.t('settings_conflict') || 'Settings changed on another device. Reload and try again.' }
      }
      const outcome = settingsSaveOutcome(result)
      if (outcome === 'failed' || outcome === 'conflict') return { outcome: 'failed' }
      persistedTemplate = serialized
      return { outcome }
    } catch (error) {
      return { outcome: 'failed', message: errorText(error, 'Save failed - check server connection') }
    }
  }

  async function writeFooter(force: boolean): Promise<WriteResult> {
    const deps = getDeps()
    const value = deps.getFooter()
    if (!force && value === persistedFooter) return { outcome: 'unchanged' }
    try {
      const result = await timed(() => deps.saveSettings(
        { receipt_footer: value },
        { silentToast: true, refreshChannels: REFRESH_CHANNELS, reason: 'receipt-default-footer-saved', source: force ? 'receipt-settings:manual-save' : 'receipt-settings:auto-save' },
      ), 'Receipt default footer save')
      const outcome = settingsSaveOutcome(result)
      if (outcome === 'failed' || outcome === 'conflict') return { outcome: 'failed' }
      persistedFooter = value
      return { outcome }
    } catch (error) {
      return { outcome: 'failed', message: errorText(error, 'Save failed - check server connection') }
    }
  }

  function enqueueTemplate(force: boolean): Promise<WriteResult> {
    templateBusy += 1
    const run = templateChain.then(() => writeTemplate(force))
    templateChain = run
    return run.finally(() => { templateBusy -= 1 })
  }

  function enqueueFooter(force: boolean): Promise<WriteResult> {
    footerBusy += 1
    const run = footerChain.then(() => writeFooter(force))
    footerChain = run
    return run.finally(() => { footerBusy -= 1 })
  }

  function failureNotice(message: string | undefined): void {
    const deps = getDeps()
    deps.notify(message || deps.t('settings_save_failed_kept') || 'Settings were not saved. Your changes are still here.', 'error')
  }

  function afterAutosave(result: WriteResult): void {
    if (result.outcome === 'saved') {
      silentSaves = true
      autosaveFailureShown = false
    } else if (result.outcome === 'failed' && !autosaveFailureShown) {
      autosaveFailureShown = true
      failureNotice(result.message)
    }
  }

  function clearTemplateTimer(): void {
    if (templateTimer !== null) timers.clear(templateTimer)
    templateTimer = null
  }

  function clearFooterTimer(): void {
    if (footerTimer !== null) timers.clear(footerTimer)
    footerTimer = null
  }

  function autosaveTemplate(): void {
    void enqueueTemplate(false).then(afterAutosave)
  }

  function autosaveFooter(): void {
    void enqueueFooter(false).then(afterAutosave)
  }

  return {
    activate(): void { alive = true },

    dispose(): void {
      alive = false
      if (templateTimer !== null) { clearTemplateTimer(); autosaveTemplate() }
      if (footerTimer !== null) { clearFooterTimer(); autosaveFooter() }
    },

    // The template the app now holds. Returns what the form should show, or
    // null when the form keeps what it has: an edit still pending or in flight
    // must not be reverted by the echo of an earlier save.
    hydrateTemplate(incoming: unknown): T | null {
      if (!incoming) return null
      const deps = getDeps()
      const parsed = deps.parseTemplate(incoming)
      const incomingSerialized = deps.serializeTemplate(parsed)
      const latestSerialized = deps.serializeTemplate(deps.getTemplate())
      const dirty = templateHydrated && (templateTimer !== null || templateBusy > 0 || latestSerialized !== persistedTemplate)
      templateHydrated = true
      persistedTemplate = incomingSerialized
      return dirty || latestSerialized === incomingSerialized ? null : parsed
    },

    hydrateFooter(incoming: string): string | null {
      const latest = getDeps().getFooter()
      const dirty = footerHydrated && (footerTimer !== null || footerBusy > 0 || latest !== persistedFooter)
      footerHydrated = true
      persistedFooter = incoming
      return dirty || latest === incoming ? null : incoming
    },

    templateEdited(): void {
      clearTemplateTimer()
      const deps = getDeps()
      if (deps.serializeTemplate(deps.getTemplate()) === persistedTemplate) return
      templateTimer = timers.set(() => { templateTimer = null; autosaveTemplate() }, RECEIPT_AUTOSAVE_MS)
    },

    footerEdited(): void {
      clearFooterTimer()
      if (getDeps().getFooter() === persistedFooter) return
      footerTimer = timers.set(() => { footerTimer = null; autosaveFooter() }, RECEIPT_AUTOSAVE_MS)
    },

    registerPrintFlusher(flusher: PrintFlusher): () => void {
      printFlusher = flusher
      return () => { if (printFlusher === flusher) printFlusher = null }
    },

    markSilentSaved(): void {
      silentSaves = true
      autosaveFailureShown = false
    },

    // The Save button: flush every pending autosave on the page, write the
    // template, and say one thing about all of it.
    async manualSave(): Promise<ManualSaveNotice | 'failed'> {
      const deps = getDeps()
      clearTemplateTimer()
      clearFooterTimer()
      if (alive) deps.setSaving(true)
      try {
        const [template, footer, print] = await Promise.all([
          enqueueTemplate(true),
          enqueueFooter(false),
          printFlusher ? printFlusher().catch((): WriteOutcome => 'failed') : Promise.resolve('idle' as const),
        ])
        const failed = [template, footer].find((result) => result.outcome === 'failed')
        if (failed || print === 'failed') {
          failureNotice(failed?.message)
          return 'failed'
        }
        const wrote = template.outcome === 'saved' || footer.outcome === 'saved' || print === 'saved'
        const notice = manualSaveNotice(wrote ? 'saved' : 'unchanged', silentSaves)
        silentSaves = false
        autosaveFailureShown = false
        deps.notify(notice === 'saved' ? deps.t('settings_saved') : deps.t('settings_no_changes'), notice === 'saved' ? 'success' : 'info')
        return notice
      } finally {
        if (alive) deps.setSaving(false)
      }
    },
  }
}

export type ReceiptSettingsSaver<T> = ReturnType<typeof createReceiptSettingsSaver<T>>
