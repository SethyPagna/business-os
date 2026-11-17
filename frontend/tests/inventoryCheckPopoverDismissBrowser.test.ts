import assert from 'node:assert/strict'
import { launchResolveFixture } from './resolveBrowserFixture.ts'

// Inventory redesign, slice C1 review M3 (17 Nov 2026): the count popover closes on an outside press, and the click that completes that press used to fall through to the row under the finger,
// so closing the popover by tapping another row also opened that row's detail. In a real browser, with a real mouse and a real touch tap (Chrome synthesizes the click):
//   - the dismissing press opens nothing and does not toggle anything underneath;
//   - the very next tap on a row opens its detail (the swallow is one click, not a lingering block);
//   - a press that becomes a scroll leaves no stale swallow behind;
//   - a PortalMenu that did NOT opt in keeps its one-tap behaviour (a plain menu closed by pressing a button elsewhere still presses that button).
const fixture = String.raw`
  import React, { useState } from 'react'
  import { createRoot } from 'react-dom/client'
  import * as ListModule from '/src/components/inventory/InventoryCheckListRows.tsx'
  import PortalMenu from '/src/components/shared/PortalMenu.tsx'
  import en from '/src/lang/en.json'
  import '/src/styles/main.css'
  const t = key => en[key] || key
  const product = (id, name) => ({ id, name, barcode: '88500011122' + String(id).padStart(2, '0'), quantity: 10 + id, unit: 'pcs', check_status: 'not_checked' })
  const products = [product(1, 'Alpha serum'), product(2, 'Beta cream'), product(3, 'Gamma toner'), product(4, 'Delta mist')]
  window.__opened = []
  window.__plain = 0
  window.__submit = 0
  function Fixture() {
    const [drafts, setDrafts] = useState({})
    const patch = (item, change) => setDrafts(previous => {
      const current = previous[String(item.id)] ?? { selected: false, count: '', checked: false, note: '' }
      return { ...previous, [String(item.id)]: { ...current, ...change(current) } }
    })
    return <>
      <div style={{ padding: 8 }}>
        <PortalMenu trigger={<button type="button" data-plain-trigger>Plain menu</button>} content={<div data-plain-content style={{ padding: 8 }}>plain content</div>} />
        <button type="button" data-plain-target onClick={() => { window.__plain += 1 }}>Elsewhere</button>
        <button type="button" data-submit-target onClick={() => { window.__submit += 1 }}>Submit</button>
      </div>
      <ListModule.default products={products} drafts={drafts} selecting canViewStock canViewCounts focusRequest={undefined} t={t} onOpenProduct={item => { window.__opened.push(item.id) }}
        priceText={usd => '$' + Number(usd).toFixed(2)} promotionRules={[]} exchangeRate={4100}
        onCount={(item, value) => patch(item, current => ({ count: value, checked: false, selected: value.trim() !== '' ? true : current.selected }))}
        onMatches={item => patch(item, () => ({ count: String(item.quantity), checked: true, selected: true }))}
        onDiffers={item => patch(item, () => ({ count: '', checked: false, selected: true }))}
        onClear={item => patch(item, () => ({ count: '', checked: false, selected: false, note: '' }))}
        onNote={(item, value) => patch(item, () => ({ note: value }))} />
    </>
  }
  createRoot(document.getElementById('root')).render(<div className="page-scroll min-w-0 p-3" data-fixture-scroller><Fixture /></div>)
`

const browser = await launchResolveFixture('inventory-popover-dismiss', fixture)
const row = (id: number) => `[data-inventory-check-row="${id}"]`
const status = (id: number) => `${row(id)} [data-check-action="status"]`
const popover = `document.querySelector('[data-inventory-check-popover]')`
const opened = () => browser.evaluate<number[]>('window.__opened.slice()')
const waitFor = async (label: string, expression: string) => { await browser.waitFor(label, async () => (await browser.evaluate<boolean>(expression)) ? true : null, 8000) }
// A point on the row that is not a control or a copy target: the left edge padding of the li, so it takes the row's own click.
const blankPoint = (id: number) => browser.evaluate<{ x: number; y: number }>(`(() => { const box = document.querySelector('${row(id)}').getBoundingClientRect(); return { x: box.left + 3, y: box.top + box.height / 2 } })()`)
const centre = (selector: string) => browser.evaluate<{ x: number; y: number }>(`(() => { const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 } })()`)
const mouseAt = async (point: { x: number; y: number }) => {
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
  await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
}
const tapAt = async (point: { x: number; y: number }) => {
  await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y }] })
  await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}
const swipeFrom = async (point: { x: number; y: number }) => {
  await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y }] })
  for (const dy of [-10, -30, -60]) await browser.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y + dy }] })
  await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}
// A PortalMenu is drawn at the page corner for one frame and then moved beside its trigger (reposition). A press before that lands on the menu itself, which is not what a person can do, so every
// open waits until the menu has stopped moving.
const settleMenu = async (selector: string) => {
  let previous = ''
  await browser.waitFor(`${selector} is positioned`, async () => {
    const rect = await browser.evaluate<string>(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return ""; const box = node.closest("[data-portal-menu-content]").getBoundingClientRect(); return [box.left, box.top, box.width, box.height].join(",") })()`)
    const settled = rect !== '' && rect === previous && !rect.startsWith('0,0,')
    previous = rect
    return settled ? true : null
  }, 8000)
}
const openPopover = async (id: number) => { await browser.mouseClick(status(id)); await waitFor(`popover of ${id} open`, `${popover} !== null`); await settleMenu('[data-inventory-check-popover]') }

await browser.run('PASS count popover: the click that dismisses it is swallowed (mouse and touch), once, and plain PortalMenus keep their one-tap behaviour', async () => {
  await browser.open(1024, '', `document.querySelector('${row(4)}')`, 900)

  // ---- mouse -------------------------------------------------------------------------------------------------------------------
  await openPopover(1)
  await mouseAt(await blankPoint(2))
  await waitFor('popover closed by the outside press', `${popover} === null`)
  await browser.pause(450)
  assert.deepEqual(await opened(), [], 'mouse: tapping another row to dismiss the popover does not open that row')
  // The swallow was one click: the next press on the same row opens it.
  await mouseAt(await blankPoint(2))
  await waitFor('row 2 opens on the next click', `window.__opened.length === 1`)
  assert.deepEqual(await opened(), [2])
  // Control: with no popover open a press on a row opens it, so the zero above was the swallow and not a dead row.
  await mouseAt(await blankPoint(3))
  await waitFor('row 3 opens', `window.__opened.length === 2`)

  // ---- touch (Chrome turns a tap into the synthesized mouse events and a click) ----------------------------------------------------
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await browser.evaluate('window.__opened.length = 0')
  await openPopover(1)
  await tapAt(await blankPoint(2))
  await waitFor('popover closed by the outside tap', `${popover} === null`)
  await browser.pause(450)
  assert.deepEqual(await opened(), [], 'touch: tapping another row to dismiss the popover does not open that row')
  await tapAt(await blankPoint(2))
  await waitFor('row 2 opens on the next tap', `window.__opened.length === 1`)
  assert.deepEqual(await opened(), [2], 'touch: the next tap opens it')

  // A press that becomes a scroll dismisses the popover but makes no click, and must leave nothing waiting to eat the next tap.
  await browser.evaluate('window.__opened.length = 0')
  await openPopover(1)
  await swipeFrom(await blankPoint(3))
  await waitFor('popover closed by the outside swipe', `${popover} === null`)
  await browser.pause(450)
  await tapAt(await blankPoint(4))
  await waitFor('row 4 opens after a swipe dismissal', `window.__opened.length >= 1`)
  assert.deepEqual(await opened(), [4], 'a swipe that closed the popover leaves no stale swallow: the next tap opens its row')

  // ---- M2 (r2): the swallow is for the row's own open handler only. A real control pressed while the popover is open acts on its FIRST tap ----------------------------------
  await browser.evaluate('window.__opened.length = 0; window.__submit = 0')
  await openPopover(1)
  await tapAt(await centre('[data-submit-target]'))
  await waitFor('popover closed by the Submit tap', `${popover} === null`)
  await browser.pause(450)
  assert.equal(await browser.evaluate('window.__submit'), 1, 'touch: Submit acts on the first tap while the popover is open (it also closes the popover)')
  assert.deepEqual(await opened(), [], 'touch: and nothing under the finger opened')
  // ...and the swallow is over: the next row tap opens straight away.
  await tapAt(await blankPoint(2))
  await waitFor('row 2 opens right after the control tap', `window.__opened.length === 1`)
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: false })
  await browser.evaluate('window.__opened.length = 0; window.__submit = 0')
  await openPopover(1)
  await mouseAt(await centre('[data-submit-target]'))
  await waitFor('popover closed by the Submit click', `${popover} === null`)
  await browser.pause(450)
  assert.equal(await browser.evaluate('window.__submit'), 1, 'mouse: Submit acts on the first click while the popover is open')
  assert.deepEqual(await opened(), [], 'mouse: and no row opened')
  // Another row's own control (its status button) also acts on the first press: it closes this popover and opens its own.
  await openPopover(1)
  await mouseAt(await centre(status(3)))
  await waitFor('row 3 popover open on the first press', `document.querySelector('${row(3)} [data-inventory-check-popover], [data-inventory-check-popover]') !== null`)
  await browser.pause(450)
  assert.equal(await browser.evaluate(`document.querySelectorAll('[data-inventory-check-popover]').length`), 1, 'exactly one popover is open after the first press on another row control')
  await mouseAt(await blankPoint(4))
  await waitFor('popover closed by blank row space', `${popover} === null`)
  await browser.pause(450)
  assert.deepEqual(await opened(), [], 'blank row space is still swallowed: the row did not open')
  // The row's picture button is a pointer-only duplicate of the row's open handler (data-row-open): it is swallowed like blank space, not treated as a control.
  await openPopover(1)
  await mouseAt(await centre(`${row(4)} [data-check-image]`))
  await waitFor('popover closed by the picture press', `${popover} === null`)
  await browser.pause(450)
  assert.deepEqual(await opened(), [], 'the picture button of another row does not open it on the dismissing press')

  // ---- a PortalMenu that did not opt in is unchanged: the press that closes it also presses the button under it ---------------------------------
  await browser.mouseClick('[data-plain-trigger]')
  await waitFor('plain menu open', `document.querySelector('[data-plain-content]') !== null`)
  await settleMenu('[data-plain-content]')
  await mouseAt(await centre('[data-plain-target]'))
  await waitFor('plain menu closed', `document.querySelector('[data-plain-content]') === null`)
  await browser.pause(450)
  assert.equal(await browser.evaluate('window.__plain'), 1, 'a plain PortalMenu closed by pressing a button elsewhere still presses that button (one tap)')
})
