// Owner, 10 Nov 2026: Save in Receipt settings said "No changes" after an edit
// the autosave had already stored, and a Show Delivery Address switch once did
// not stick. ReceiptSettings.tsx hands every write to createReceiptSettingsSaver,
// so these tests drive that same module: the timers, the echo of a finished
// save, leaving the page, a failed write, and the Footer and Print sections.
//
// Run: node tests/receiptSettingsSaver.test.ts
import assert from 'node:assert/strict'
import { createReceiptSettingsSaver, type PrintFlusher, type SaverTimers, type WriteOutcome } from '../src/utils/receiptSettingsSaver.ts'
import { parseReceiptTemplate, serializeReceiptTemplate } from '../src/components/receipt-settings/template.ts'

type Template = ReturnType<typeof parseReceiptTemplate>
type Deferred = { release: () => void }

function makePage(options: { failWith?: 'answer' | 'throw' | null } = {}) {
  let fail = options.failWith ?? null
  const state = { tpl: parseReceiptTemplate({}) as Template, footer: '' }
  const stored: Record<string, string> = {
    receipt_template: serializeReceiptTemplate(state.tpl),
    receipt_footer: '',
  }
  const notices: Array<[string, string | undefined]> = []
  const writes: Array<Record<string, unknown>> = []
  const gates: Array<Promise<void>> = []
  let holdNext: Deferred | null = null
  const queue: Array<{ id: number; run: () => void; at: number }> = []
  let nextId = 1
  let now = 0
  const timers: SaverTimers = {
    set: (run, ms) => { const id = nextId++; queue.push({ id, run, at: now + ms }); return id },
    clear: (handle) => { const i = queue.findIndex((entry) => entry.id === handle); if (i >= 0) queue.splice(i, 1) },
  }
  const settle = async () => { for (let i = 0; i < 25; i += 1) await new Promise((resolve) => setImmediate(resolve)) }
  const saveSettings = async (settings: Record<string, unknown>) => {
    writes.push({ ...settings })
    if (holdNext) {
      const gate = new Promise<void>((resolve) => { holdNext!.release = resolve })
      gates.push(gate)
      holdNext = null
      await gate
    }
    if (fail === 'throw') throw new Error('network down')
    if (fail === 'answer') return { success: false, error: new Error('403') }
    const key = Object.keys(settings).find((k) => k in stored) as string
    const value = String(settings[key])
    if (stored[key] === value) return { success: true, unchanged: true }
    stored[key] = value
    return { success: true }
  }
  const saver = createReceiptSettingsSaver<Template>(() => ({
    saveSettings,
    notify: (message, type) => { notices.push([message, type]) },
    t: (key) => key,
    getTemplate: () => state.tpl,
    getFooter: () => state.footer,
    serializeTemplate: serializeReceiptTemplate,
    parseTemplate: parseReceiptTemplate,
    setSaving: () => {},
  }), timers, 2000)
  const page = {
    state, stored, notices, writes, saver, queue,
    setFail: (mode: 'answer' | 'throw' | null) => { fail = mode },
    hold: () => { const d: Deferred = { release: () => {} }; holdNext = d; return d },
    edit: (key: string, value: unknown) => { state.tpl = { ...state.tpl, [key]: value } as Template; saver.templateEdited() },
    editFooter: (value: string) => { state.footer = value; saver.footerEdited() },
    elapse: async () => { now += 1000; const due = queue.splice(0).filter((entry) => entry.at <= now); for (const entry of due) entry.run(); await settle() },
    echo: () => { const next = saver.hydrateTemplate(stored.receipt_template); if (next) state.tpl = next; return next },
    echoFooter: () => { const next = saver.hydrateFooter(stored.receipt_footer); if (next !== null) state.footer = next; return next },
    settle,
  }
  page.echo()
  page.echoFooter()
  return page
}
const lastNotice = (page: ReturnType<typeof makePage>) => page.notices[page.notices.length - 1]

// 1. The owner's case: an autosaved edit, then Save.
{
  const page = makePage()
  page.edit('delivery_show_address', false)
  await page.elapse()
  assert.equal(JSON.parse(page.stored.receipt_template).delivery_show_address, false, 'the autosave stored the edit')
  assert.equal(await page.saver.manualSave(), 'saved')
  assert.deepEqual(lastNotice(page), ['settings_saved', 'success'], 'Save after an autosave says Saved')
  assert.equal(await page.saver.manualSave(), 'unchanged')
  assert.deepEqual(lastNotice(page), ['settings_no_changes', 'info'], 'a second press with nothing new says no change')
}

// 2. Save before the autosave fires; and an untouched page.
{
  const page = makePage()
  assert.equal(await page.saver.manualSave(), 'unchanged', 'an untouched page says no change')
  page.edit('show_tax', false)
  assert.equal(await page.saver.manualSave(), 'saved')
  assert.equal(page.queue.length, 0, 'Save cancelled the pending template timer')
  assert.equal(JSON.parse(page.stored.receipt_template).show_tax, false)
}

// 3. The Footer section autosaves on its own and still counts.
{
  const page = makePage()
  page.editFooter('Thanks')
  await page.elapse()
  assert.equal(page.stored.receipt_footer, 'Thanks')
  assert.equal(await page.saver.manualSave(), 'saved', 'a footer the autosave stored is reported as Saved, not no change')
  const fast = makePage()
  fast.editFooter('Thanks again')
  assert.equal(await fast.saver.manualSave(), 'saved', 'Save inside the debounce window flushes the footer')
  assert.equal(fast.stored.receipt_footer, 'Thanks again')
  assert.equal(fast.queue.length, 0)
}

// 4. The Print section: its pending write is flushed, its silent write counts.
{
  const page = makePage()
  let pending: WriteOutcome | 'idle' = 'saved'
  const flusher: PrintFlusher = async () => { const out = pending; pending = 'idle'; return out }
  page.saver.registerPrintFlusher(flusher)
  assert.equal(await page.saver.manualSave(), 'saved', 'a print edit flushed by Save is reported as Saved')
  assert.equal(await page.saver.manualSave(), 'unchanged')
  page.saver.markSilentSaved()
  assert.equal(await page.saver.manualSave(), 'saved', 'a print autosave that already stored the edit is reported as Saved')
  pending = 'failed'
  assert.equal(await page.saver.manualSave(), 'failed')
  assert.deepEqual(lastNotice(page), ['settings_save_failed_kept', 'error'], 'a failed print write is an error, never Saved')
}

// 5. A failed write is told on both paths.
for (const mode of ['answer', 'throw'] as const) {
  const manual = makePage({ failWith: mode })
  manual.edit('show_tax', false)
  assert.equal(await manual.saver.manualSave(), 'failed')
  const [message, type] = lastNotice(manual)
  assert.equal(type, 'error', `manual save failure (${mode}) is an error`)
  assert.equal(message, mode === 'throw' ? 'network down' : 'settings_save_failed_kept')
  assert.equal(manual.notices.some(([text]) => text === 'settings_saved' || text === 'settings_no_changes'), false, 'no success notice after a failure')

  const auto = makePage({ failWith: mode })
  auto.edit('show_tax', false)
  await auto.elapse()
  assert.equal(auto.notices.length, 1, `an autosave failure (${mode}) is told`)
  assert.equal(auto.notices[0][1], 'error')
  auto.edit('show_tax', true)
  await auto.elapse()
  assert.equal(auto.notices.length, 1, 'repeated autosave failures are told once')
  auto.setFail(null)
  auto.edit('show_tax', false)
  await auto.elapse()
  assert.equal(await auto.saver.manualSave(), 'saved', 'the retry after a failure still saves and says Saved')

  const footer = makePage({ failWith: mode })
  footer.editFooter('x')
  await footer.elapse()
  assert.equal(lastNotice(footer)[1], 'error', `a footer autosave failure (${mode}) is no longer swallowed`)
}

// 6. Leaving the page saves what is waiting instead of dropping it.
{
  const page = makePage()
  page.edit('delivery_show_address', false)
  page.editFooter('Bye')
  assert.equal(page.queue.length, 2)
  page.saver.dispose()
  await page.settle()
  assert.equal(JSON.parse(page.stored.receipt_template).delivery_show_address, false, 'a toggle made just before leaving is stored')
  assert.equal(page.stored.receipt_footer, 'Bye', 'a footer typed just before leaving is stored')
  assert.equal(page.queue.length, 0)
}

// 7. A finished save's echo must not undo an edit made while it was in flight.
{
  const page = makePage()
  page.edit('delivery_show_address', false)
  const gate = page.hold()
  await page.elapse()
  assert.equal(page.writes.length, 1)
  page.edit('delivery_show_fee', false)
  gate.release()
  await page.settle()
  assert.equal(page.echo(), null, 'the echo of the first save leaves the newer toggle alone')
  assert.equal(page.state.tpl.delivery_show_fee, false, 'the second toggle is still off in the form')
  await page.elapse()
  const stored = JSON.parse(page.stored.receipt_template)
  assert.equal(stored.delivery_show_address, false)
  assert.equal(stored.delivery_show_fee, false, 'the second toggle was saved, not reverted')

  const footer = makePage()
  footer.editFooter('one')
  const footerGate = footer.hold()
  await footer.elapse()
  footer.editFooter('one two')
  footerGate.release()
  await footer.settle()
  assert.equal(footer.echoFooter(), null)
  assert.equal(footer.state.footer, 'one two')
  await footer.elapse()
  assert.equal(footer.stored.receipt_footer, 'one two')
}

// 8. Positive control: a change made elsewhere reaches a form with no edits.
{
  const page = makePage()
  page.stored.receipt_template = serializeReceiptTemplate({ ...page.state.tpl, delivery_show_address: false })
  const applied = page.echo()
  assert.ok(applied, 'an untouched form adopts the stored template')
  assert.equal(page.state.tpl.delivery_show_address, false)
  page.saver.templateEdited()
  assert.equal(page.queue.length, 0, 'adopting it does not schedule a save of its own')
  await page.settle()
  assert.equal(page.writes.length, 0)
}

// 9. Toggling a switch back before the debounce fires saves nothing.
{
  const page = makePage()
  page.edit('show_tax', false)
  page.edit('show_tax', true)
  assert.equal(page.queue.length, 0)
}

console.log('receiptSettingsSaver.test.ts OK')
