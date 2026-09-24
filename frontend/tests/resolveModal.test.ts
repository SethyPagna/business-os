// T17b (board R7): the one conflict resolver's flow shell, ResolveModal, driven
// in a real browser under React StrictMode through a fake adapter that plays
// the server.
//
// What it pins, each against the failure it exists for:
//   - loading shows a busy skeleton; a failed read says so with Retry;
//   - the header X is the one close, with Minimize beside it; picks make the
//     modal dirty, so X asks Discard changes / Back and Back keeps everything;
//   - an unanswered required row disables Resolve and says why, wired through
//     aria-describedby -- never an error after the click; a Remove without a
//     reason does the same, Remove reads the records again and typing the
//     reason does not;
//   - a stale answer re-reads by itself, keeps the operator's choices, marks
//     the changed cells and says so in one banner;
//   - the confirm shows before -> after for every changed field (an empty
//     before reads as Empty), lists every required row -- one the server
//     answered included (council D1), and only once when its answer also
//     changes a value -- the warnings and the undo note, and Back returns
//     to the grid;
//   - applying locks the X, reports progress, stops at a partial result or a
//     dropped connection with Continue re-sending the same frozen token, and
//     done shows the server's after values with the undo hint and no footer;
//   - offline disables Resolve with a notice and keeps the choices;
//   - Minimize hands the choices to the host and they come back on reopen;
//   - Khmer: labels from the pack, Khmer line boxes; phone and desktop: the
//     Resolve button stays on screen and nothing overflows the page.
//
// Run: node tests/resolveModal.test.ts
import assert from 'node:assert/strict'
import { launchResolveFixture } from './resolveBrowserFixture.ts'

// Three records: p3 starts as Keep separate (the adapter's suggestion), the
// stock-in session row is required and unanswered, the membership row is
// required and answered by the server. `window.__ctl` steers the fake server;
// `window.__log` records what the modal asked of it.
const fixtureSource = String.raw`
  import React, { StrictMode, useState } from 'react'
  import { createRoot } from 'react-dom/client'
  import ResolveModal from '/src/components/shared/ResolveModal.tsx'
  import { AppContext, FALLBACK_APP_CONTEXT } from '/src/app/AppContextCore.tsx'
  import en from '/src/lang/en.json'
  import km from '/src/lang/km.json'
  import '@fontsource/noto-sans-khmer/400.css'
  import '@fontsource/noto-sans-khmer/500.css'
  import '@fontsource/noto-sans-khmer/600.css'
  import '/src/styles/main.css'

  const params = new URLSearchParams(location.search)
  const lang = params.get('lang') || 'en'
  const pack = window.__pack = lang === 'km' ? km : en
  const t = (key) => pack[key] || key
  document.body.className = lang === 'km' ? 'lang-km' : ''
  if (params.get('theme') === 'dark') document.documentElement.classList.add('dark')

  const ctl = window.__ctl = { holdLoad: params.has('holdLoad'), failLoad: Number(params.get('failLoad') || 0), staleReview: 0, failReview: 0, noChanges: false, requiredChanges: false, holdApply: false, failApply: 0 }
  const log = window.__log = { loads: [], reviews: 0, applies: [], applied: [], minimized: null, closed: 0 }
  const waiters = { load: [], apply: [] }
  const gate = (name) => new Promise((resolve) => waiters[name].push(resolve))
  window.__release = (name) => waiters[name].splice(0).map((resolve) => resolve()).length
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const clone = (value) => JSON.parse(JSON.stringify(value))
  const aborted = () => Object.assign(new Error('aborted'), { name: 'AbortError' })

  const RECORDS = [
    { id: 'p1', title: 'Fit Me Matte 30ml', subtitle: '#101 · 12' },
    { id: 'p2', title: 'Fit Me 30ml', subtitle: '#102 · 3' },
    { id: 'p3', title: 'FIT ME', subtitle: '#103 · 0', warning: 'Tagged: damaged' },
  ]
  const TALL = params.has('tall') ? Array.from({ length: 10 }, (_, index) => 'note' + index) : []
  const server = { version: 1, values: {
    name: ['Fit Me Matte 30ml', 'Fit Me 30ml', 'FIT ME'],
    brand: ['MAC', 'Mac', 'MaC'],
    selling: [12, 11.5, 12],
    unit: ['pcs', 'pcs', 'pcs'],
    ...Object.fromEntries(TALL.map((key, index) => [key, ['Shelf ' + index + 'A', 'Shelf ' + index + 'B', 'Shelf ' + index + 'C']])),
  } }
  const SESSION = [
    { id: 'finalize', label: 'Finalize stock-in #12 and merge' },
    { id: 'keep', label: 'Keep this product separate', disposition: { column: 'p2', value: 'separate' } },
  ]
  const MEMBERSHIP = [{ id: 'keep_member', label: 'Keep Gold membership' }, { id: 'drop_member', label: 'Drop membership' }]
  const money = (value) => '$' + Number(value).toFixed(2)
  const dispositionOf = (draft, id) => (draft.columns[id] && draft.columns[id].disposition) || 'include'
  const optionLabel = (options, choice) => (choice && 'option' in choice ? (options.find((option) => option.id === choice.option) || { label: '' }).label : '')

  const adapter = {
    async load(signal, edits) {
      const asked = clone(edits)
      if (ctl.holdLoad) await gate('load'); else await pause(20)
      if (signal.aborted) throw aborted()
      if (ctl.failLoad > 0) { ctl.failLoad -= 1; throw new Error('Worker unreachable') }
      log.loads.push(asked)
      return { version: server.version, values: clone(server.values) }
    },
    initialSelection: () => ({ selection: { membership: { option: 'keep_member' } }, columns: { p3: { disposition: 'separate' } } }),
    columns: (data, draft) => RECORDS.map((record) => ({
      ...record,
      disposition: dispositionOf(draft, record.id),
      dispositions: ['include', 'separate', 'remove'],
      removeReason: draft.columns[record.id] && draft.columns[record.id].reason,
    })),
    rows(data, draft) {
      const included = RECORDS.filter((record) => dispositionOf(draft, record.id) === 'include')
      const valueRow = (key, label, extra) => {
        const format = extra.format || String
        const cells = {}
        RECORDS.forEach((record, index) => { cells[record.id] = { text: format(data.values[key][index]) } })
        const pick = draft.selection[key]
        const usable = pick && (!('source' in pick) || included.some((record) => record.id === pick.source))
        const choice = usable ? pick : included[0] ? { source: included[0].id } : undefined
        const text = !choice ? '' : 'source' in choice ? cells[choice.source].text : 'custom' in choice ? format(choice.custom) : ''
        return { key, label, kind: 'choice', cells, choice, final: { text }, identical: new Set(included.map((record) => cells[record.id].text)).size <= 1, copyable: extra.copyable, custom: extra.custom }
      }
      const session = dispositionOf(draft, 'p2') !== 'include' ? { option: 'keep' } : draft.selection.session
      const membership = draft.selection.membership
      return [
        valueRow('name', 'Name', { copyable: true, custom: { kind: 'text' } }),
        valueRow('brand', 'Brand', { copyable: true }),
        valueRow('selling', 'Selling', { format: money }),
        valueRow('unit', 'Unit', {}),
        ...TALL.map((key, index) => valueRow(key, 'Shelf ' + index, {})),
        {
          key: 'session', label: 'Stock-in session', kind: 'required', optionsOnly: true, identical: false,
          cells: { p1: { text: '' }, p2: { text: 'Stock-in #12 · 24/09/2026 14:05' }, p3: { text: '' } },
          options: SESSION, choice: session, final: { text: optionLabel(SESSION, session) },
        },
        {
          key: 'membership', label: 'Membership', kind: 'required', optionsOnly: true, identical: false,
          cells: { p1: { text: 'Gold · 0101' }, p2: { text: '' }, p3: { text: '' } },
          options: MEMBERSHIP, choice: membership, final: { text: optionLabel(MEMBERSHIP, membership) },
        },
      ]
    },
    blockers: (data, draft) => (RECORDS.filter((record) => dispositionOf(draft, record.id) === 'include').length < 2 ? ['Pick at least two records to merge'] : []),
    reloadWhen: (before, after) => RECORDS.some((record) => (dispositionOf(before, record.id) === 'remove') !== (dispositionOf(after, record.id) === 'remove')),
    async review(data, draft, signal) {
      log.reviews += 1
      await pause(20)
      if (signal.aborted) throw aborted()
      if (ctl.staleReview > 0) {
        ctl.staleReview -= 1
        server.version += 1
        server.values.brand[1] = 'M·A·C'
        throw Object.assign(new Error('The records changed'), { stale: true })
      }
      if (ctl.failReview > 0) { ctl.failReview -= 1; throw new Error('Preview refused') }
      const changes = ctl.noChanges ? [] : adapter.rows(data, draft)
        .filter((row) => (row.kind === 'choice' || (ctl.requiredChanges && row.kind === 'required')) && row.final.text !== row.cells.p1.text)
        .map((row) => ({ label: row.label, before: row.cells.p1.text, after: row.final.text }))
        .concat([{ label: 'Barcode', before: '', after: '8850000000011' }])
      const merged = RECORDS.filter((record) => dispositionOf(draft, record.id) === 'include').length
      return { message: 'Merge ' + merged + ' products into #101', changes, warnings: ['Stock-in #12 is finalized first'], token: { done: 0, total: 3, version: data.version }, undoable: true }
    },
    async apply(token, signal, onProgress) {
      log.applies.push(token.done)
      onProgress(token.done + 1, token.total)
      if (ctl.holdApply) await gate('apply'); else await pause(20)
      if (signal.aborted) throw aborted()
      if (ctl.failApply > 0) { ctl.failApply -= 1; throw new Error('Connection dropped') }
      if (token.done === 0) return { after: [], done: 2, total: token.total, next: { ...token, done: 2 } }
      return {
        after: [{ label: 'Name', value: 'Fit Me Matte 30ml' }, { label: 'Brand', value: 'M·A·C' }, { label: 'Barcode', value: '' }],
        done: token.total, total: token.total, notes: ['Removing FIT ME waits for approval'],
      }
    },
    isStale: (error) => Boolean(error && error.stale),
  }

  // Page-side lookups the test reads through.
  const text = (node) => (node ? node.textContent.replace(/\s+/g, ' ').trim() : null)
  const ui = window.__ui = {
    text,
    dialogs: () => [...document.querySelectorAll('[role=dialog]')],
    main: () => ui.dialogs().find((node) => text(node.querySelector('h2')) === 'Resolve duplicates') || null,
    confirm: () => ui.dialogs().find((node) => text(node.querySelector('h2')) === pack.resolve_confirm_title) || null,
    prompt: () => ui.dialogs().find((node) => [...node.querySelectorAll('button')].some((button) => text(button) === pack.discard_changes)) || null,
    primary: () => { const all = ui.main() ? [...ui.main().querySelectorAll('.btn-primary')] : []; return all[all.length - 1] || null },
    closeX: () => (ui.main() ? ui.main().querySelector('button[aria-label="' + pack.close + '"]') : null),
    minimize: () => (ui.main() ? ui.main().querySelector('button[aria-label="' + pack.minimize + '"]') : null),
    button: (scope, label) => (scope ? [...scope.querySelectorAll('button')].find((button) => text(button) === label) || null : null),
    statuses: () => (ui.main() ? [...ui.main().querySelectorAll('[role=status]')].filter((node) => !node.classList.contains('sr-only')).map(text) : []),
    alerts: () => (ui.main() ? [...ui.main().querySelectorAll('[role=alert]')].map(text) : []),
    cell: (key) => document.querySelector('[data-rg-key="' + key + '"]'),
  }

  function Host() {
    const [open, setOpen] = useState(true)
    const [parked, setParked] = useState(null)
    const [generation, setGeneration] = useState(0)
    if (!open) {
      return parked
        ? <button type="button" id="chip" onClick={() => { setOpen(true); setGeneration((value) => value + 1) }}>Resolve duplicates (parked)</button>
        : <p id="closed">closed</p>
    }
    return (
      <ResolveModal
        key={generation}
        title="Resolve duplicates"
        adapter={adapter}
        initialDraft={parked || undefined}
        onClose={() => { log.closed += 1; setParked(null); setOpen(false) }}
        onApplied={(result) => { log.applied.push([result.done, result.total]) }}
        onMinimize={(draft) => { log.minimized = clone(draft); setParked(draft); setOpen(false) }}
      />
    )
  }

  createRoot(document.getElementById('root')).render(
    <StrictMode><AppContext.Provider value={{ ...FALLBACK_APP_CONTEXT, t }}><Host /></AppContext.Provider></StrictMode>,
  )
`

const { send, evaluate, waitFor, pause, open, khmerRoom, run } = await launchResolveFixture('resolve-modal-fixture', fixtureSource)

type Footer = { label: string | null; disabled: boolean | null; described: Array<string | null> }
const footer = () => evaluate<Footer>(`(() => {
  const button = __ui.primary()
  const ids = button ? (button.getAttribute('aria-describedby') || '').split(' ').filter(Boolean) : []
  return { label: __ui.text(button), disabled: button ? button.disabled : null, described: ids.map((id) => __ui.text(document.getElementById(id))) }
})()`)
const until = (label: string, expression: string, timeoutMs?: number) => waitFor(label, async () => ((await evaluate<boolean>(`Boolean(${expression})`)) ? true : null), timeoutMs)
const click = (expression: string) => evaluate(`(${expression}).click()`)
const cell = (key: string) => `__ui.cell(${JSON.stringify(key)})`
const pressed = (key: string) => evaluate<string | null>(`${cell(key)}.getAttribute('aria-pressed')`)
const selected = (key: string) => evaluate<string | null>(`${cell(key)}.getAttribute('aria-selected')`)
const closeLike = () => evaluate<string[]>(`[...__ui.main().querySelectorAll('button, [role=button]')].map((node) => node.getAttribute('aria-label') || node.textContent.trim()).filter((label) => /close|cancel|dismiss|back/i.test(label))`)
const loadsSoFar = () => evaluate<number>('__log.loads.length')
const gridReady = '__ui.main() && __ui.main().querySelector(".resolve-grid tbody [role=rowheader]") && __ui.primary() && __ui.text(__ui.primary()) !== __pack.processing'
const answerSession = async (): Promise<void> => {
  await click(cell('session|#final|finalize'))
  await until('session answered', `${cell('session|#final|finalize')}.getAttribute('aria-pressed') === 'true'`)
}
const setOnline = (online: boolean) => evaluate(online
  ? `delete navigator.onLine; window.dispatchEvent(new Event('online'))`
  : `Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); window.dispatchEvent(new Event('offline'))`)

// The primary action is on screen, and the sticky footer it sits in is never
// painted over by the grid's pinned cells when the modal body scrolls.
async function assertResolveReachable(label: string): Promise<void> {
  const reach = await evaluate<{ inView: boolean; hit: string; edge: string[]; overflow: number }>(`(() => {
    const button = __ui.primary(); const rect = button.getBoundingClientRect()
    const footer = button.closest('.sticky'); const band = footer.getBoundingClientRect()
    // What is painted at a point: the footer, or whatever covers it.
    const top = (x, y) => {
      const node = document.elementFromPoint(x, y)
      if (!node) return 'nothing'
      return footer.contains(node) ? 'footer' : node.tagName.toLowerCase() + '.' + String(node.className).trim().split(/\\s+/).slice(0, 2).join('.')
    }
    return {
      inView: rect.top >= 0 && rect.bottom <= window.innerHeight && rect.left >= 0 && rect.right <= window.innerWidth,
      hit: top(rect.left + rect.width / 2, rect.top + rect.height / 2),
      edge: [band.left + 6, band.left + band.width / 2, band.right - 6].map((x) => top(x, band.top + 2)),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })()`)
  assert.deepEqual(reach, { inView: true, hit: 'footer', edge: ['footer', 'footer', 'footer'], overflow: 0 }, `${label}: Resolve stays on screen, uncovered, and nothing overflows the page`)
}

await run('PASS resolve modal: loading, one close, dirty guard, blockers, remove + reason, stale re-read, confirm before/after + D1, progress, partial, retry, done, offline, minimize/restore, load failure, Khmer, 375/1280/landscape', async () => {
  // ------------------------------------------------ first paint and loading
  await open(375, 'lang=en&holdLoad=1', '__ui && __ui.main()')
  const loading = await evaluate<any>(`(() => {
    const main = __ui.main()
    return {
      busy: Boolean(main.querySelector('[aria-busy=true]')),
      status: __ui.text(main.querySelector('[aria-busy=true] [role=status]')),
      grid: Boolean(main.querySelector('.resolve-grid')),
      primary: [__ui.text(__ui.primary()), __ui.primary().disabled],
    }
  })()`)
  assert.deepEqual(loading, { busy: true, status: 'Loading...', grid: false, primary: ['Resolve', true] }, 'loading shows a busy skeleton and a disabled Resolve')
  assert.deepEqual(await closeLike(), ['Close'], 'the header X is the one close while loading')
  await evaluate(`__ctl.holdLoad = false; __release('load')`)
  await until('grid after load', gridReady)
  assert.equal(await evaluate<number>('__log.loads.length'), 1, 'StrictMode\'s aborted first read is dropped: one load reaches the grid')
  assert.deepEqual(await evaluate<string[]>('__ui.alerts()'), [], 'an aborted read leaves no failure behind')

  // ------------------------------------------------------ ready, blockers
  assert.deepEqual(await closeLike(), ['Close'], 'the modal adds no Cancel or Close of its own: the header X is the one close')
  assert.equal(await evaluate<boolean>('Boolean(__ui.minimize())'), true, 'Minimize sits beside the X')
  assert.equal(await pressed('membership|#final|keep_member'), 'true', 'a required row the server answered arrives answered (D1)')
  assert.deepEqual(await footer(), { label: 'Resolve', disabled: true, described: ['Choose one for: Stock-in session'] }, 'an unanswered required row disables Resolve and says why')
  await answerSession()
  assert.deepEqual(await footer(), { label: 'Resolve', disabled: false, described: [] }, 'answering the required row enables Resolve')

  // ------------------------------------------------ dirty guard on the X
  await click('__ui.closeX()')
  await until('discard prompt', '__ui.prompt()')
  assert.deepEqual(
    await evaluate<string[]>(`[...__ui.prompt().querySelectorAll('button')].map((button) => button.getAttribute('aria-label') || __ui.text(button))`),
    ['Minimize', 'Discard changes', 'Back'],
    'X with choices made asks Discard changes / Back (and can park the draft instead)',
  )
  await click(`__ui.button(__ui.prompt(), 'Back')`)
  await until('prompt dismissed', '!__ui.prompt()')
  assert.equal(await evaluate<boolean>('Boolean(__ui.main()) && __log.closed === 0'), true, 'Back keeps the modal open')
  assert.equal(await pressed('session|#final|finalize'), 'true', 'Back keeps the choices')

  // ------------------------------------------- a pick, then Remove + reason
  await click(cell('brand|p2'))
  await until('brand pick', `${cell('brand|p2')}.getAttribute('aria-selected') === 'true'`)
  const loadsBeforeRemove = await loadsSoFar()
  await click(`document.querySelector('[aria-label="What to do with FIT ME"]')`)
  await until('disposition menu', 'document.querySelector("[data-app-select-option=remove]")')
  await click('document.querySelector("[data-app-select-option=remove]")')
  await until('remove re-reads the records', `__log.loads.length === ${loadsBeforeRemove + 1} && ${gridReady}`)
  assert.deepEqual(await evaluate<any>('__log.loads.at(-1).columns.p3'), { disposition: 'remove' }, 'the re-read is handed the Remove it has to preview')
  const reason = `document.querySelector('[aria-label="Reason to remove FIT ME"]')`
  await until('reason input', `${reason} && !${reason}.disabled`)
  assert.deepEqual(await footer(), { label: 'Resolve', disabled: true, described: ['Give a reason to remove FIT ME'] }, 'a Remove without a reason blocks Resolve and says why')
  await evaluate(`${reason}.focus()`)
  await send('Input.insertText', { text: 'Damaged duplicate' })
  await until('reason accepted', '!__ui.primary().disabled')
  await pause(120)
  assert.equal(await loadsSoFar(), loadsBeforeRemove + 1, 'typing the reason does not read the records again')
  assert.equal(await selected('brand|p2'), 'true', 'the pick survives the Remove re-read')

  // ------------------------------------------------- stale answer re-reads
  await evaluate('__ctl.staleReview = 1')
  await click('__ui.primary()')
  await until('stale banner', `__ui.statuses().includes(__pack.resolve_stale_banner) && ${gridReady}`)
  const stale = await evaluate<any>(`(() => {
    const changed = ${cell('brand|p2')}
    return {
      marked: [changed.textContent.includes('M·A·C'), [...changed.querySelectorAll('.sr-only')].map(__ui.text).includes('Changed')],
      kept: [changed.getAttribute('aria-selected'), ${cell('session|#final|finalize')}.getAttribute('aria-pressed'), ${reason}.value],
      final: ${cell('brand|#final')}.textContent.startsWith('M·A·C'),
      finalMarked: ${cell('brand|#final')}.classList.contains('rg-changed'),
      asked: __log.loads.at(-1).selection.brand,
    }
  })()`)
  assert.deepEqual(stale, {
    marked: [true, true], kept: ['true', 'true', 'Damaged duplicate'], final: true, finalMarked: true, asked: { source: 'p2' },
  }, 'a stale answer re-reads, keeps every choice and marks what moved')
  assert.deepEqual(await footer(), { label: 'Resolve', disabled: false, described: [] })

  // ----------------------------------------------------- confirm: before/after
  await click('__ui.primary()')
  await until('confirm', '__ui.confirm()')
  const confirm = await evaluate<any>(`(() => {
    const dialog = __ui.confirm()
    return {
      layer: dialog.className.includes('z-[1070]'),
      message: __ui.text(dialog.querySelector('p.font-medium')),
      items: [...dialog.querySelectorAll('dl > div')].map((row) => [__ui.text(row.querySelector('dt')), __ui.text(row.querySelector('dd'))]),
      srOnly: [...dialog.querySelectorAll('dd .sr-only')].map(__ui.text),
      warnings: [...dialog.querySelectorAll('ul li')].map(__ui.text),
      note: [...dialog.querySelectorAll('p')].map(__ui.text).includes('You can undo this from History.'),
      buttons: [...dialog.querySelectorAll('button')].map((button) => button.getAttribute('aria-label') || __ui.text(button)),
    }
  })()`)
  assert.deepEqual(confirm, {
    layer: true,
    message: 'Merge 2 products into #101',
    items: [
      ['Brand', 'Before:MAC→After:M·A·C'],
      ['Barcode', 'Before:—Empty→After:8850000000011'],
      ['Stock-in session', 'Finalize stock-in #12 and merge'],
      ['Membership', 'Keep Gold membership'],
    ],
    srOnly: ['Before:', 'After:', 'Before:', 'Empty', 'After:'],
    warnings: ['Stock-in #12 is finalized first'],
    note: true,
    buttons: ['Close', 'Resolve', 'Back'],
  }, 'the confirm shows before -> after, every required row (D1), the warnings and the undo note')
  await click(`__ui.button(__ui.confirm(), 'Back')`)
  await until('back to the grid', `!__ui.confirm() && !__ui.primary().disabled`)
  assert.equal(await selected('brand|p2'), 'true', 'Back from the confirm keeps the choices')

  // -------------------------------------------- apply: progress and partial
  await click('__ui.primary()')
  await until('confirm again', '__ui.confirm()')
  await evaluate('__ctl.holdApply = true')
  await click(`__ui.button(__ui.confirm(), 'Resolve')`)
  await until('applying', `__ui.statuses().includes('Resolving 1 of 3…')`)
  const applying = await evaluate<any>(`(() => ({
    confirm: Boolean(__ui.confirm()),
    x: __ui.closeX().disabled,
    minimize: __ui.minimize().disabled,
    primary: [__ui.text(__ui.primary()), __ui.primary().disabled],
    inert: document.querySelector('.resolve-grid-scroll').parentElement.inert,
  }))()`)
  assert.deepEqual(applying, { confirm: false, x: true, minimize: true, primary: ['Processing…', true], inert: true }, 'while writing, nothing can dismiss or change the resolve')
  await click('__ui.closeX()')
  await pause(120)
  assert.equal(await evaluate<boolean>('!__ui.prompt() && __log.closed === 0 && Boolean(__ui.main())'), true, 'a disabled X does nothing mid-write')
  await evaluate(`__ctl.holdApply = false; __release('apply')`)
  await until('partial', `__ui.statuses().includes('Resolved 2 of 3. Continue to finish the rest.')`)
  assert.deepEqual(await footer(), { label: 'Continue', disabled: false, described: [] }, 'a partial result offers Continue')
  assert.equal(await evaluate<boolean>('__ui.closeX().disabled'), false, 'the X works again once the write stopped')
  assert.deepEqual(await evaluate<number[][]>('__log.applied'), [[2, 3]], 'the host hears about the partial write')

  // ----------------------------------------- a dropped write keeps Continue
  await evaluate('__ctl.failApply = 1')
  await click('__ui.primary()')
  await until('apply failure', `__ui.alerts().some((text) => text.startsWith('Stopped before finishing. Continue picks up where it stopped.'))`)
  assert.equal(await evaluate<boolean>(`__ui.alerts().some((text) => text.includes('Connection dropped'))`), true, 'the failure carries the reason')
  assert.deepEqual(await footer(), { label: 'Continue', disabled: false, described: [] }, 'a dropped write keeps Continue')

  // ------------------------------------------------------------------ done
  await click('__ui.primary()')
  await until('done', `__ui.statuses().includes('Resolved')`)
  const done = await evaluate<any>(`(() => {
    const main = __ui.main()
    return {
      after: [...main.querySelectorAll('dl > div')].map((row) => [__ui.text(row.querySelector('dt')), __ui.text(row.querySelector('dd'))]),
      notes: [...main.querySelectorAll('.modal-scroll p')].map(__ui.text).includes('Removing FIT ME waits for approval'),
      undoHint: Boolean(main.querySelector('[aria-label="About undo"]')),
      footer: main.querySelectorAll('.btn-primary').length,
      grid: Boolean(main.querySelector('.resolve-grid')),
      minimize: Boolean(__ui.minimize()),
    }
  })()`)
  assert.deepEqual(done, {
    after: [['Name', 'Fit Me Matte 30ml'], ['Brand', 'M·A·C'], ['Barcode', '—Empty']],
    notes: true, undoHint: true, footer: 0, grid: false, minimize: false,
  }, 'done shows the server\'s after values and the undo hint, with no footer and nothing to park')
  assert.deepEqual(await evaluate<number[]>('__log.applies'), [0, 2, 2], 'Continue re-sends the same frozen token after a dropped write')
  assert.deepEqual(await evaluate<number[][]>('__log.applied'), [[2, 3], [3, 3]])
  assert.deepEqual(await closeLike(), ['Close'], 'done still has one close')
  await click('__ui.closeX()')
  await until('closed after done', `document.getElementById('closed') && __log.closed === 1`)
  assert.equal(await evaluate<boolean>('!__ui.prompt()'), true, 'a finished resolve closes without asking')

  // ----------------------------------------- offline, minimize and restore
  await open(375, 'lang=en', '__ui && __ui.main()')
  await until('grid (offline run)', gridReady)
  await answerSession()
  await click(cell('brand|p2'))
  await until('brand pick (offline run)', `${cell('brand|p2')}.getAttribute('aria-selected') === 'true'`)
  await setOnline(false)
  await until('offline notice', `__ui.statuses().includes(__pack.resolve_online_only)`)
  assert.deepEqual(await footer(), { label: 'Resolve', disabled: true, described: ['Resolving needs a connection. Your choices stay here.'] }, 'offline disables Resolve and says why')
  assert.equal(await selected('brand|p2'), 'true', 'offline keeps the choices')
  await setOnline(true)
  await until('back online', `!__ui.statuses().includes(__pack.resolve_online_only) && !__ui.primary().disabled`)

  await click('__ui.minimize()')
  await until('parked', `document.getElementById('chip')`)
  assert.deepEqual(await evaluate<any>('__log.minimized'), { selection: { session: { option: 'finalize' }, brand: { source: 'p2' } }, columns: {} }, 'Minimize hands the operator\'s own choices to the host')
  assert.equal(await evaluate<number>('__log.closed'), 0, 'Minimize is not a close')
  await click(`document.getElementById('chip')`)
  await until('restored', gridReady)
  assert.deepEqual(await evaluate<any>('__log.loads.at(-1)'), { selection: { session: { option: 'finalize' }, brand: { source: 'p2' } }, columns: {} }, 'the first read of a restored flow gets the parked choices')
  assert.deepEqual([await pressed('session|#final|finalize'), await selected('brand|p2')], ['true', 'true'], 'reopening restores the choices')
  assert.deepEqual(await footer(), { label: 'Resolve', disabled: false, described: [] })
  await click('__ui.closeX()')
  await until('restored flow is dirty', '__ui.prompt()')
  await click(`__ui.button(__ui.prompt(), 'Discard changes')`)
  await until('discarded', `document.getElementById('closed') && __log.closed === 1`)

  // ------------------------------------------------ review failure (not stale)
  await open(1280, 'lang=en&theme=dark', '__ui && __ui.main()')
  await until('grid 1280', gridReady)
  await answerSession()
  await evaluate('__ctl.failReview = 1')
  await click('__ui.primary()')
  await until('review failure', `__ui.alerts().some((text) => text.startsWith('Could not check the changes. Nothing was saved.'))`)
  assert.deepEqual(await footer(), { label: 'Resolve', disabled: false, described: [] }, 'a refused preview leaves Resolve ready to try again')
  assert.equal(await pressed('session|#final|finalize'), 'true', 'a refused preview keeps the choices')
  await evaluate('__ctl.noChanges = true')
  await click('__ui.primary()')
  await until('confirm with no changes', '__ui.confirm()')
  const quiet = await evaluate<any>(`(() => {
    const dialog = __ui.confirm()
    return {
      items: [...dialog.querySelectorAll('dl > div')].map((row) => __ui.text(row.querySelector('dt'))),
      said: [...dialog.querySelectorAll('p')].map(__ui.text).includes(__pack.resolve_no_changes),
    }
  })()`)
  assert.deepEqual(quiet, { items: ['Stock-in session', 'Membership'], said: true }, 'nothing changing is said, and the required answers are still listed')
  await click(`__ui.button(__ui.confirm(), 'Back')`)
  await until('back (1280)', '!__ui.confirm()')
  await evaluate('__ctl.noChanges = false; __ctl.requiredChanges = true')
  await click('__ui.primary()')
  await until('confirm with required changes', '__ui.confirm()')
  const once = await evaluate<any>(`[...__ui.confirm().querySelectorAll('dl > div')].map((row) => [__ui.text(row.querySelector('dt')), __ui.text(row.querySelector('dd'))])`)
  assert.deepEqual(once, [
    ['Stock-in session', 'Before:—Empty→After:Finalize stock-in #12 and merge'],
    ['Membership', 'Before:Gold · 0101→After:Keep Gold membership'],
    ['Barcode', 'Before:—Empty→After:8850000000011'],
  ], 'a required answer that changes a value is listed once, with its before and after')
  await click(`__ui.button(__ui.confirm(), 'Back')`)
  await until('back again (1280)', '!__ui.confirm()')
  await assertResolveReachable('1280 en dark')

  // --------------------------------------------------------- load failure
  await open(375, 'lang=en&failLoad=1', '__ui && __ui.main()')
  await until('load failure', `__ui.alerts().some((text) => text.startsWith('Could not load the records.'))`)
  const failed = await evaluate<any>(`(() => ({
    detail: __ui.alerts()[0].includes('Worker unreachable'),
    retry: Boolean(__ui.button(__ui.main(), 'Retry')),
    primary: Boolean(__ui.primary()),
  }))()`)
  assert.deepEqual(failed, { detail: true, retry: true, primary: false }, 'a failed read says so with Retry and no Resolve')
  assert.deepEqual(await closeLike(), ['Close'], 'a failed read still has one close')
  await click(`__ui.button(__ui.main(), 'Retry')`)
  await until('retry loads', gridReady)
  assert.deepEqual(await footer(), { label: 'Resolve', disabled: true, described: ['Choose one for: Stock-in session'] })

  // ---------------------------------------- Khmer, dark, a grid taller than the phone
  await open(375, 'lang=km&theme=dark&tall=1', '__ui && __ui.main()')
  await until('grid km', gridReady)
  assert.deepEqual(
    await evaluate<any>(`[__ui.text(__ui.primary()), __ui.closeX() && __ui.closeX().getAttribute('aria-label'), Boolean(__ui.minimize())]`),
    ['ដោះស្រាយ', 'បិទ', true],
    'Khmer labels come from the pack',
  )
  assert.deepEqual((await footer()).described, ['សូមជ្រើសរើសមួយសម្រាប់៖ Stock-in session'], 'the Khmer blocker')
  await assertResolveReachable('375 km dark tall')
  await khmerRoom('375 km dark', '[role=dialog]', 5)
  await click('__ui.closeX()')
  await until('closed at once when nothing was chosen', `document.getElementById('closed') && __log.closed === 1 && !__ui.prompt()`)

  // ------------------- a landscape phone: the modal body itself has to scroll
  await open(740, 'lang=en&tall=1', '__ui && __ui.main()', 360)
  await until('grid landscape', gridReady)
  assert.equal(await evaluate<boolean>(`(() => { const body = __ui.main().querySelector('.modal-scroll'); return body.scrollHeight > body.clientHeight })()`), true, 'landscape: the modal body scrolls, so the footer sits over the grid')
  await assertResolveReachable('740x360 landscape')
  await evaluate(`__ui.main().querySelector('.modal-scroll').scrollTop = 99999`)
  await pause(100)
  await assertResolveReachable('740x360 landscape, scrolled')
})
