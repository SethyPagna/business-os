// KNOWN-136 / UI-STOCK S7: minimized work must be reachable on a phone in
// portrait. The phone header mounts of the tray hide in pages mode and scroll
// away, so the always-mounted desktop instance portals one floating "Draft"
// chip instead. Part 1 drives the pure clamp and storage helpers; part 2 drives
// the real component in headless Chromium at 360 px: default spot, tap to
// restore, the count and popover with 3 drafts, drag limits under the header
// (also while it is scrolled away) and above the bottom nav, the remembered
// position after a reload, arrow-key nudges, blocked storage, and md+ widths.
//
// Run: node tests/draftChipFloat.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { launchResolveFixture } from './resolveBrowserFixture.ts'

const traySource = readFileSync(new URL('../src/components/shared/MinimizedWorkTray.tsx', import.meta.url), 'utf8')

// ------------------------------------------------------------ 1. pure helpers
const compiled = ts.transpileModule(traySource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const tray: any = { exports: {} }
new Function('require', 'module', 'exports', compiled)((name: string) => {
  if (name.includes('AppContextCore')) return { useApp: () => ({}) }
  return {}
}, tray, tray.exports)
const { draftChipBounds, clampDraftChipPosition, draftChipMovedPastThreshold, readDraftChipPosition, writeDraftChipPosition, DRAFT_CHIP_POSITION_KEY } = tray.exports

const phone = { viewport: { width: 360, height: 740 }, chip: { width: 96, height: 44 }, insets: { top: 0, right: 0, bottom: 0, left: 0 } }
assert.deepEqual(draftChipBounds({ ...phone, headerBottom: 64, navTop: 684 }), { minX: 8, maxX: 256, minY: 72, maxY: 632 })
assert.deepEqual(draftChipBounds({ ...phone, headerBottom: 112, navTop: 684 }).minY, 120, 'the update bar pushes the header down, and the chip with it')
assert.deepEqual(draftChipBounds({ ...phone, headerBottom: null, navTop: null, insets: { top: 20, right: 0, bottom: 34, left: 0 } }), { minX: 8, maxX: 256, minY: 92, maxY: 598 }, 'no header or nav on the page: 4rem + inset and 3.5rem + inset')
const tiny = draftChipBounds({ viewport: { width: 60, height: 100 }, chip: { width: 96, height: 44 }, insets: phone.insets, headerBottom: 64, navTop: 90 })
assert.ok(tiny.maxX >= tiny.minX && tiny.maxY >= tiny.minY, 'a viewport smaller than the chip still yields a valid box')
assert.deepEqual(clampDraftChipPosition({ x: -500, y: 9999 }, { minX: 8, maxX: 256, minY: 72, maxY: 632 }), { x: 8, y: 632 })
assert.equal(draftChipMovedPastThreshold(6, 0), false, 'a 6 px wobble is still a tap')
assert.equal(draftChipMovedPastThreshold(5, 5), true, 'a diagonal drag past 6 px is a drag')
const throwing = () => ({ getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
assert.equal(readDraftChipPosition(throwing), null, 'blocked storage reads as no saved position')
assert.doesNotThrow(() => writeDraftChipPosition({ x: 1, y: 2 }, throwing), 'blocked storage never breaks the chip')
const memory = new Map<string, string>()
const store = () => ({ getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value) } })
writeDraftChipPosition({ x: 40, y: 300 }, store)
assert.equal(DRAFT_CHIP_POSITION_KEY, 'bos.draftChipPos')
assert.deepEqual(readDraftChipPosition(store), { x: 40, y: 300 })
memory.set(DRAFT_CHIP_POSITION_KEY, '{"x":"left"}')
assert.equal(readDraftChipPosition(store), null, 'a malformed saved value is ignored')
console.log('PASS the Draft chip clamp and storage helpers')

// ------------------------------------------------------------ 2. source pins
assert.match(traySource, /if \(variant === 'mobile'\) return null/, 'the phone header mounts render nothing; the floating chip replaces them')
assert.match(traySource, /createPortal\(floating, document\.body\)/, 'the chip is portalled out of the CSS-hidden sidebar')
assert.match(traySource, /data-draft-chip-float="" className="md:hidden"/, 'the chip exists below md only')
assert.match(traySource, /className="fixed z-\[60\] flex h-11/, 'fixed, above the top bar (z-50) and bottom nav (z-40), below modals')
assert.match(traySource, /touchAction: 'none'/, 'dragging must not scroll the page')
assert.doesNotMatch(traySource, /localStorage\.(?:get|set)Item/, 'storage goes only through the try/catch helpers')
console.log('PASS the Draft chip source contract')

// ------------------------------------------------------------ 3. real browser
const fixtureSource = String.raw`
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import MinimizedWorkTray from '/src/components/shared/MinimizedWorkTray.tsx'
  import { AppContext, FALLBACK_APP_CONTEXT } from '/src/app/AppContextCore.tsx'
  import { minimizeWork, getMinimizedWork, removeMinimizedWork, RESTORE_WORK_EVENT } from '/src/utils/minimizedWork.ts'
  import en from '/src/lang/en.json'
  import km from '/src/lang/km.json'
  import '@fontsource/noto-sans-khmer/400.css'
  import '@fontsource/noto-sans-khmer/600.css'
  import '/src/styles/main.css'

  const params = new URLSearchParams(location.search)
  const lang = params.get('lang') || 'en'
  const pack = lang === 'km' ? km : en
  document.body.className = lang === 'km' ? 'lang-km' : ''
  if (params.has('blockStorage')) {
    const getItem = Storage.prototype.getItem
    const setItem = Storage.prototype.setItem
    Storage.prototype.getItem = function (key) { if (key === 'bos.draftChipPos') throw new Error('blocked'); return getItem.call(this, key) }
    Storage.prototype.setItem = function (key, value) { if (key === 'bos.draftChipPos') throw new Error('blocked'); return setItem.call(this, key, value) }
  }
  const log = window.__log = { navigations: [], restores: [] }
  window.addEventListener(RESTORE_WORK_EVENT, (event) => log.restores.push(event.detail.entry.key))
  const labels = ['Adjust stock — Head & Shoulders សាប៊ូកក់សក់ទឹកក្រូច 400ml', 'Add product — Dior 999', 'Expense — Electricity September']
  const count = Number(params.get('n') || 1)
  for (const entry of getMinimizedWork()) removeMinimizedWork(entry.key)
  labels.slice(0, count).forEach((label, index) => minimizeWork({ key: 'draft-' + index, kind: 'fee_form', pageId: 'sales', anchor: 'hub:sales:fees', label, draftKey: 'fee-draft-' + index }))
  const headerTop = Number(params.get('headerTop') || 0)
  const value = {
    ...FALLBACK_APP_CONTEXT, language: lang, t: (key) => pack[key] || key, user: { id: 7, username: 'owner' },
    can: () => true, notify: () => {}, navigateTo: (pageId, anchor) => log.navigations.push([pageId, anchor]),
  }
  function Page() {
    return (
      <AppContext.Provider value={value}>
        <header data-bos-mobile-header="inline" id="hdr" style={{ position: 'fixed', left: 0, right: 0, top: headerTop, height: 64, background: '#eee', zIndex: 50, transform: params.has('headerHidden') ? 'translateY(-100%)' : 'none' }}>
          <div id="mobile-slot"><MinimizedWorkTray variant="mobile" /></div>
        </header>
        <aside id="aside" className="hidden md:flex"><MinimizedWorkTray variant="desktop" /></aside>
        <main style={{ height: 2000 }} />
        <nav className="safe-area-inset-bottom fixed bottom-0 left-0 right-0 z-40 h-14 md:hidden" style={{ background: '#ddd' }} />
      </AppContext.Provider>
    )
  }
  createRoot(document.getElementById('root')).render(<Page />)
`

const browser = await launchResolveFixture('draft-chip-float', fixtureSource)
const { evaluate, send, pause, open, press, khmerRoom } = browser

type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number }
const chipBox = () => evaluate<Box | null>(`(() => { const c = document.querySelector('[data-draft-chip]'); if (!c) return null; const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } })()`)
const chipText = () => evaluate<string>(`[...document.querySelectorAll('[data-draft-chip] span')].map((span) => span.textContent.trim()).join(' ')`)
const navTop = () => evaluate<number>(`document.querySelector('nav.safe-area-inset-bottom').getBoundingClientRect().top`)
const ready = `(() => { const c = document.querySelector('[data-draft-chip]'); return c && getComputedStyle(c).visibility === 'visible' })()`
const drag = async (dx: number, dy: number) => {
  const box = await chipBox(); assert.ok(box)
  const x = box.left + box.width / 2
  const y = box.top + box.height / 2
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  for (let step = 1; step <= 8; step += 1) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + (dx * step) / 8, y: y + (dy * step) / 8, button: 'left', buttons: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y: y + dy, button: 'left', clickCount: 1 })
  await pause(80)
}
const tap = async (dx = 0) => {
  const box = await chipBox(); assert.ok(box)
  const x = box.left + box.width / 2
  const y = box.top + box.height / 2
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  if (dx) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + dx, y, button: 'left', buttons: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y, button: 'left', clickCount: 1 })
  await pause(80)
}

await browser.run('PASS the Draft chip floats, restores, lists, drags within limits and remembers its place on a phone', async () => {
  await evaluate(`localStorage.clear(), true`)

  // One draft, default spot: right edge, just above the bottom nav.
  await open(360, 'n=1', ready)
  const nav = await navTop()
  let box = await chipBox(); assert.ok(box)
  assert.equal(await chipText(), 'Draft', 'one draft reads "Draft", no count')
  assert.ok(Math.abs(box.right - 352) <= 1, `hugs the right edge (right ${box.right})`)
  assert.ok(Math.abs(box.bottom - (nav - 8)) <= 1, `sits just above the bottom nav (bottom ${box.bottom}, nav ${nav})`)
  assert.equal(box.height, 44, 'a 44 px touch target')
  assert.equal(await evaluate<number>(`document.querySelectorAll('#mobile-slot button').length`), 0, 'the phone header mount renders nothing')
  await tap()
  assert.deepEqual(await evaluate(`__log.navigations`), [['sales', 'hub:sales:fees']], 'one draft: a tap restores it straight away')
  assert.deepEqual(await evaluate(`__log.restores`), ['draft-0'])

  // Three drafts: the count, then a popover listing every label in full.
  await open(360, 'n=3', ready)
  assert.equal(await chipText(), 'Draft 3')
  await tap(3)
  assert.equal(await evaluate<number>(`document.querySelectorAll('[data-draft-chip-popover] .detail-scroll-text').length`), 3, 'a 3 px wobble is a tap: the popover lists all three')
  assert.equal(await evaluate<string>(`document.querySelector('[data-draft-chip-popover] .detail-scroll-text').textContent`), 'Adjust stock — Head & Shoulders សាប៊ូកក់សក់ទឹកក្រូច 400ml', 'the label is shown in full')
  const popover = await evaluate<Box>(`(() => { const r = document.querySelector('[data-draft-chip-popover]').getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } })()`)
  assert.ok(popover.left >= 0 && popover.right <= 360 && popover.top >= 0, 'the popover stays on screen')
  await evaluate(`document.querySelectorAll('[data-draft-chip-popover] button[aria-label="${'Dismiss and discard this draft'}"]')[1].click(), true`)
  await pause(80)
  assert.equal(await chipText(), 'Draft 2', 'dismissing one row leaves two')
  await press('Escape')
  await pause(50)
  assert.equal(await evaluate<boolean>(`!document.querySelector('[data-draft-chip-popover]')`), true, 'Escape closes the popover')

  // Drag to the top-left: clamped under the header, not under the status bar.
  await drag(-400, -900)
  box = await chipBox(); assert.ok(box)
  assert.deepEqual([Math.round(box.left), Math.round(box.top)], [8, 72], 'dragged to the top-left corner, clamped under the 64 px header')
  assert.equal(await evaluate<boolean>(`!document.querySelector('[data-draft-chip-popover]')`), true, 'a drag is not a tap')
  assert.deepEqual(await evaluate(`JSON.parse(localStorage.getItem('bos.draftChipPos'))`), { x: 8, y: 72 }, 'the new spot is remembered')

  // Arrow keys nudge by 8 px and stay inside the box.
  await evaluate(`document.querySelector('[data-draft-chip]').focus(), true`)
  await press('ArrowRight'); await press('ArrowDown'); await press('ArrowUp'); await press('ArrowUp')
  box = await chipBox(); assert.ok(box)
  assert.deepEqual([Math.round(box.left), Math.round(box.top)], [16, 72], 'right 8, and up is held at the header')

  // Drag far down: clamped above the bottom nav.
  await drag(0, 2000)
  box = await chipBox(); assert.ok(box)
  assert.ok(Math.abs(box.bottom - (nav - 8)) <= 1, `held above the bottom nav (bottom ${box.bottom})`)
  const saved = await evaluate<{ x: number; y: number }>(`JSON.parse(localStorage.getItem('bos.draftChipPos'))`)

  // Reload: the same spot.
  await open(360, 'n=2', ready)
  box = await chipBox(); assert.ok(box)
  assert.deepEqual([Math.round(box.left), Math.round(box.top)], [saved.x, saved.y], 'the position survives a reload')

  // The header (under the update bar) scrolled away with translateY(-100%):
  // the top limit is where it comes back to, not its translated bottom (48).
  await open(360, 'n=2&headerHidden=1&headerTop=48', ready)
  await drag(0, -2000)
  box = await chipBox(); assert.ok(box)
  assert.equal(Math.round(box.top), 120, 'a scrolled-away header still reserves its space')

  // The update bar pushes the header down 48 px.
  await open(360, 'n=2&headerTop=48', ready)
  await drag(0, -2000)
  box = await chipBox(); assert.ok(box)
  assert.equal(Math.round(box.top), 120, 'clamped under the header that sits below the update bar')

  // Rotating to a shorter viewport re-clamps a saved spot that is now off screen.
  await open(360, 'n=2', ready)
  await drag(0, 2000)
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 420, deviceScaleFactor: 1, mobile: true })
  await pause(200)
  box = await chipBox(); assert.ok(box)
  const shortNav = await navTop()
  assert.ok(box.bottom <= shortNav - 7, `re-clamped after the resize (bottom ${box.bottom}, nav ${shortNav})`)

  // Blocked storage: the chip still renders at its default spot.
  await open(360, 'n=1&blockStorage=1', ready)
  box = await chipBox(); assert.ok(box)
  assert.ok(Math.abs(box.right - 352) <= 1, 'blocked storage falls back to the default spot')

  // Khmer: the Khmer word, with a Khmer line box.
  await open(360, 'n=1&lang=km', ready)
  assert.equal(await chipText(), 'សេចក្ដីព្រាង')
  await khmerRoom('Draft chip', '[data-draft-chip-float]', 1)

  // md and up: the chip is gone and the sidebar pills show every draft.
  await open(1024, 'n=3', `document.querySelectorAll('#aside .detail-scroll-text').length === 3`, 760)
  assert.equal(await evaluate<string>(`getComputedStyle(document.querySelector('[data-draft-chip-float]')).display`), 'none', 'no floating chip on md+')
})
