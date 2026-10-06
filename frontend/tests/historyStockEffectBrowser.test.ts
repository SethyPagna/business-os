import assert from 'node:assert/strict'
import { launchResolveFixture } from './resolveBrowserFixture.ts'

// REVERT-SET (lead, 6 Oct 2026: "the Revert confirmation must always say
// exactly what it will add/remove, by lot/branch, on every surface that offers
// Revert or Undo"). The shared History panel, rendered for real in Chromium:
// pressing Undo on the screenshot Set (SK-II Gentle Cleanser 20g, Shop) asks
// first and states "−27 · received 02/09/2026 · Shop" and "Shop 60 → 33",
// read fresh from GET /api/action-history/:id/effect. Cancel runs nothing;
// Undo runs the server replay once. A record that moves no stock is not asked
// about, and an unreadable effect runs nothing. EN and KM, 360 and 1280.

const fixture = String.raw`
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import { AppContext, FALLBACK_APP_CONTEXT } from '/src/app/AppContextCore.tsx'
  import ActionHistoryBar from '/src/components/shared/ActionHistoryBar.tsx'
  import en from '/src/lang/en.json'
  import km from '/src/lang/km.json'
  import '@fontsource/noto-sans-khmer/400.css'
  import '/src/styles/main.css'
  const params = new URLSearchParams(location.search)
  const language = params.get('lang') || 'en'
  const t = (key) => (language === 'km' ? km : en)[key] || key
  document.body.className = language === 'km' ? 'lang-km' : ''
  window.__effectReads = []
  window.__runs = []
  const effect = { applier: 'stock.quantity_set', direction: 'undo', more: 0,
    lines: [{ productId: 5357, productName: 'SK-II Gentle Cleanser 20g', branchId: 2, branchName: 'Shop', batchId: 56725, receivedAt: '2026-09-02', lotCode: '09022026', change: -27 }],
    branches: [{ productId: 5357, productName: 'SK-II Gentle Cleanser 20g', branchId: 2, branchName: 'Shop', before: 60, after: 33 }] }
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = String(input && input.url || input)
    const match = url.match(/\/api\/action-history\/(\d+)\/effect\?direction=(undo|redo)/)
    if (!match) return realFetch(input, init)
    window.__effectReads.push(match[1] + ':' + match[2])
    if (match[1] === '9') return new Response('{"error":"down"}', { status: 503, headers: { 'content-type': 'application/json' } })
    return new Response(JSON.stringify({ success: true, effect: match[1] === '1318' ? effect : null }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const serverItems = [
    { id: 1318, label: 'Set stock SK-II Gentle Cleanser 20g', status: 'undoable', server_replayable: true, undo_payload: { applier: 'stock.quantity_set', generation: 0 } },
    { id: 7, label: 'Customer gender', status: 'undoable', server_replayable: true, undo_payload: { applier: 'customer.gender_restore', generation: 0 } },
    { id: 9, label: 'Stock-in session 9', status: 'undoable', server_replayable: true, undo_payload: { applier: 'stock.session', generation: 0 } },
  ]
  const history = { undoItems: [], redoItems: [], serverItems, canUndo: false, canRedo: false, busy: false,
    undo() {}, redo() {}, undoServer: (id) => window.__runs.push('undo:' + id), redoServer: (id) => window.__runs.push('redo:' + id) }
  const value = { ...FALLBACK_APP_CONTEXT, t, language }
  createRoot(document.getElementById('root')).render(React.createElement(AppContext.Provider, { value },
    React.createElement('div', { style: { padding: 8 } }, React.createElement(ActionHistoryBar, { history, t, showLabel: true }))))
`

const browser = await launchResolveFixture('history-stock-effect-browser', fixture)
const pick = async (selectorScope: string, text: string): Promise<void> => {
  await browser.waitFor(`"${text}" in ${selectorScope}`, async () => await browser.evaluate<boolean>(`(() => {
    document.querySelectorAll('[data-pick]').forEach((el) => el.removeAttribute('data-pick'))
    const el = [...document.querySelectorAll(${JSON.stringify(selectorScope)})].find((node) => node.textContent.includes(${JSON.stringify(text)}))
    if (!el) return false
    el.setAttribute('data-pick', '1'); return true
  })()`) || null)
  await browser.mouseClick('[data-pick]')
}
const openRow = async (label: string): Promise<void> => {
  await browser.mouseClick('button[aria-label]')
  // The menu mounts through a portal after its trigger; let it settle before picking a row in it.
  await browser.waitFor('the History menu opens', async () => await browser.evaluate<boolean>(`[...document.querySelectorAll('button')].some((node) => node.textContent.includes(${JSON.stringify(label)}))`) || null)
  await browser.pause(300)
  await pick('button', label)
}
const dialogText = () => browser.evaluate<string>(`(document.querySelector('[role="dialog"]') || {}).textContent || ''`)

await browser.run('PASS History Undo of a stock record states the recorded change by lot and branch first (EN/KM, 360/1280)', async () => {
  for (const width of [360, 1280]) {
    for (const language of ['en', 'km']) {
      const tr = (en: string, km: string) => language === 'km' ? km : en
      await browser.open(width, 'lang=' + language, `document.querySelector('button[aria-label]')`)
      await openRow('Set stock SK-II')
      await browser.waitFor('the confirm opens', async () => (await dialogText()).includes('60 → 33') ? true : null)
      const text = await dialogText()
      assert.ok(text.includes('−27'), `${language} ${width}: the change is signed: ${text}`)
      assert.ok(text.includes(tr('received 02/09/2026', 'ថ្ងៃចូល 02/09/2026')), `${language} ${width}: the lot by received date: ${text}`)
      assert.ok(text.includes('Shop'), 'the branch')
      assert.ok(text.includes(tr('Undo this stock change?', 'ត្រឡប់វិញនូវការប្ដូរស្តុកនេះ?')), `${language}: the title: ${text}`)
      assert.equal(await browser.evaluate('document.scrollingElement.scrollWidth > innerWidth + 1'), false, 'no sideways scroll')
      await browser.press('Escape')
      await browser.waitFor('the confirm closes', async () => (await dialogText()) === '' ? true : null)
      assert.deepEqual(await browser.evaluate('window.__runs'), [], 'Cancel runs nothing')

      await openRow('Set stock SK-II')
      await browser.waitFor('the confirm reopens', async () => (await dialogText()).includes('60 → 33') ? true : null)
      await pick('[role="dialog"] button', tr('Undo', 'ត្រឡប់វិញ'))
      await browser.waitFor('the replay runs', async () => (await browser.evaluate<string[]>('window.__runs')).length ? true : null)
      assert.deepEqual(await browser.evaluate('window.__runs'), ['undo:1318'], 'Undo runs the server replay exactly once')

      // A record that moves no stock: no effect read, no question, it runs.
      await openRow('Customer gender')
      await browser.waitFor('the gender undo runs', async () => (await browser.evaluate<string[]>('window.__runs')).length === 2 ? true : null)
      assert.equal(await dialogText(), '')

      // The effect cannot be read: nothing runs, and the operator is told so.
      await openRow('Stock-in session 9')
      await browser.waitFor('the read failure shows', async () => await browser.evaluate<boolean>(`Boolean(document.querySelector('[role="alert"]'))`) || null)
      assert.deepEqual(await browser.evaluate('window.__runs'), ['undo:1318', 'undo:7'], 'an unreadable effect runs nothing')
      assert.deepEqual(await browser.evaluate('window.__effectReads'), ['1318:undo', '1318:undo', '9:undo'], 'read fresh on every press; never for a non-stock record')
    }
  }
})
