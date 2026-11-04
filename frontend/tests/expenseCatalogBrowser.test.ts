// Lane 6.0.1053, in a real browser: the Expenses label and type manager mounted with its real transport over a stubbed network.
// Pins what an operator can do (add a label, archive and restore it, add a type, see which types are fixed), that nothing deletes,
// and that it fits a phone in English and Khmer.
//
// Run: node tests/expenseCatalogBrowser.test.ts
import assert from 'node:assert/strict'
import { launchResolveFixture } from './resolveBrowserFixture.ts'

const fixtureSource = String.raw`
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import { AppContext, FALLBACK_APP_CONTEXT } from '/src/app/AppContextCore.tsx'
  import { setSyncServerUrl } from '/src/api/http.ts'
  import ExpenseLabelManagerModal from '/src/components/fees/ExpenseLabelManagerModal.tsx'
  import en from '/src/lang/en.json'
  import km from '/src/lang/km.json'
  import '@fontsource/noto-sans-khmer/400.css'
  import '/src/styles/main.css'

  const params = new URLSearchParams(location.search)
  const lang = params.get('lang') || 'en'
  const pack = lang === 'km' ? km : en
  document.body.className = lang === 'km' ? 'lang-km' : ''
  const t = (key) => pack[key] || key
  const log = window.__log = { calls: [], notes: [], changed: 0, audit: [] }
  const builtin = ['tax', 'delivery', 'change', 'expense', 'other'].map((value) => ({ value, name: value, builtin: true, id: null, registered: true, archived: false }))
  const labels = [
    { label: 'Packing tape', uses: 3, fee_type: 'other', registered: true, archived: false, id: 1, type_counts: [{ fee_type: 'other', uses: 3 }] },
    { label: 'Landlord', uses: 5, fee_type: 'Rent', registered: true, archived: false, id: 2, type_counts: [{ fee_type: 'Rent', uses: 5 }] },
    { label: 'Old courier', uses: 1, fee_type: 'delivery', registered: true, archived: true, id: 3, type_counts: [{ fee_type: 'delivery', uses: 1 }] },
  ]
  const customTypes = [{ value: 'Rent', name: 'Rent', builtin: false, id: 7, registered: true, archived: false, uses: 5 }]
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  setSyncServerUrl('https://sync.example.test')
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, 'https://sync.example.test')
    const method = String(init.method || 'GET').toUpperCase()
    let body = null
    try { body = init.body ? JSON.parse(init.body) : null } catch { body = null }
    if (url.pathname.startsWith('/api/fees')) log.calls.push({ method, path: url.pathname + url.search, body })
    if (url.pathname === '/api/system/audit-logs') { log.audit.push(url.search); return json({ logs: [], total: 0, page: 1, pageSize: 100 }) }
    if (method === 'GET' && url.pathname === '/api/fees/labels') return json({ labels })
    if (method === 'GET' && url.pathname === '/api/fees/types') return json({ types: [...builtin, ...customTypes] })
    if (method === 'GET' && url.pathname === '/api/fees/labels/impact') return json({ linked_records: 3, target_exists: false })
    if (method === 'GET' && url.pathname === '/api/fees/types/impact') return json({ name: 'Rent', linked_records: 5, registered: true, archived: false })
    if (method === 'POST' && url.pathname.startsWith('/api/fees/')) return json({ success: true, changed: 1 })
    return json({})
  }
  createRoot(document.getElementById('root')).render(
    <AppContext.Provider value={{ ...FALLBACK_APP_CONTEXT, t, language: lang }}>
      <ExpenseLabelManagerModal canEdit={() => true} canViewRecords={params.get('records') === '1'} onClose={() => {}} onChanged={() => { log.changed += 1 }} notify={(message, type) => log.notes.push([message, type])} t={t} />
    </AppContext.Provider>,
  )
`

const browser = await launchResolveFixture('expense-catalog-browser', fixtureSource)
const { evaluate, pause, open, press, khmerRoom } = browser
const typeInto = async (selector: string, text: string) => {
  await evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); input.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, ${JSON.stringify(text)}); input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await pause(40)
}
const clickButton = async (label: string, scope = 'document') => {
  const found = await evaluate<boolean>(`(() => { const button = [...${scope}.querySelectorAll('button')].find((node) => (node.getAttribute('aria-label') || node.textContent.trim()) === ${JSON.stringify(label)}); if (!button || button.disabled) return false; button.click(); return true })()`)
  assert.ok(found, 'button "' + label + '" is on the page and enabled')
  await pause(80)
}
// A page error stops the wait at once and is reported, instead of timing out.
const READY = `Boolean(document.body.dataset.fixtureError) || document.querySelectorAll('[data-reason-row]').length === 3`
const opened = async (width: number, query: string) => {
  await open(width, query, READY)
  assert.equal(await evaluate<string>(`document.body.dataset.fixtureError || ''`), '', 'the page rendered without an error')
}
const lastDialog = `[...document.querySelectorAll('[role=dialog]')].pop()`

// Records: a registered label or custom type offers its own history to a viewer of the audit trail, and to nobody else.
async function recordsScenario() {
  await opened(420, 'lang=en')
  assert.equal(await evaluate<number>(`document.querySelectorAll('[data-expense-records]').length`), 0, 'no Records entry without the audit_log tier')
  await opened(420, 'lang=en&records=1')
  assert.deepEqual(await evaluate<string[]>(`[...document.querySelectorAll('[data-expense-records="label"]')].map((b) => b.getAttribute('aria-label'))`), ['Records Packing tape', 'Records Landlord', 'Records Old courier'])
  await clickButton('Records Landlord')
  await pause(200)
  assert.deepEqual(await evaluate<string[]>('__log.audit'), ['?entity=fee_label&entityId=2&page=1&pageSize=100'], 'the history asked for is that label\'s own catalog row')
  assert.equal(await evaluate<string>(`document.body.dataset.fixtureError || ''`), '', 'the float opened without an error')
  await evaluate(`document.querySelector('[data-expense-catalog-tab="types"]').click()`)
  await pause(200)
  assert.deepEqual(await evaluate<string[]>(`[...document.querySelectorAll('[data-expense-records="type"]')].map((b) => b.getAttribute('aria-label'))`), ['Records Rent'], 'only the registered custom type; the built-in ones have no catalog row')
}

await browser.run('PASS the manager adds, archives and restores labels, adds types, fixes the built-in ones, offers Records only to an audit viewer and never deletes', async () => {
  await opened(420, 'lang=en')
  assert.deepEqual(await evaluate<string[]>(`[...document.querySelectorAll('[data-reason-row]')].map((row) => row.querySelector('.detail-scroll-text').textContent)`), ['Packing tape', 'Landlord', 'Old courier'])
  assert.equal(await evaluate<boolean>(`document.querySelectorAll('[data-reason-row]')[2].className.includes('opacity-60')`), true, 'the archived label is faded')
  assert.equal(await evaluate<number>(`document.querySelectorAll('[aria-label^="Delete"], [aria-label^="Remove"]').length`), 0, 'no delete control')

  // Add a label with Enter.
  await typeInto('[data-reason-list-editor] input', '  Packing   box ')
  await press('Enter')
  await pause(120)
  const calls = () => evaluate<Array<{ method: string; path: string; body: unknown }>>(`__log.calls`)
  assert.deepEqual((await calls()).filter((c) => c.method === 'POST').map((c) => [c.path, c.body]), [['/api/fees/labels', { label: 'Packing box' }]])

  // Archive asks first; Cancel changes nothing; the confirmed archive is one POST.
  await clickButton('Archive Landlord')
  const dialog = await evaluate<string | null>(`(() => { const node = ${lastDialog}; return node ? node.textContent : null })()`)
  assert.ok(dialog && dialog.includes('Archive expense label?') && dialog.includes('Landlord') && dialog.includes('restore it any time'), 'the confirm names the label and says it can be restored')
  await clickButton('Cancel', lastDialog)
  assert.equal((await calls()).filter((c) => c.path === '/api/fees/labels/archive').length, 0, 'Cancel archives nothing')
  await clickButton('Archive Landlord')
  await clickButton('Archive', lastDialog)
  await pause(120)
  assert.deepEqual((await calls()).filter((c) => c.path === '/api/fees/labels/archive').map((c) => c.body), [{ label: 'Landlord' }])
  // Restore is direct.
  await clickButton('Restore Old courier')
  await pause(120)
  assert.deepEqual((await calls()).filter((c) => c.path === '/api/fees/labels/restore').map((c) => c.body), [{ label: 'Old courier' }])
  assert.ok((await evaluate<number>('__log.changed')) >= 3, 'the page behind is told after each change')

  // Types: five built-in rows are fixed, the custom one can be renamed and archived.
  assert.equal(await evaluate<number>(`document.querySelectorAll('[data-expense-catalog-tab]').length`), 2)
  await evaluate(`document.querySelector('[data-expense-catalog-tab="types"]').click()`)
  await pause(200)
  const typesScope = `document.querySelectorAll('[data-reason-list-editor]')[1]`
  assert.equal(await evaluate<number>(`${typesScope}.querySelectorAll('[data-reason-row]').length`), 6, 'five built-in types and one custom')
  assert.deepEqual(await evaluate<string[]>(`[...${typesScope}.querySelectorAll('button[aria-label^="Rename "]')].map((b) => b.getAttribute('aria-label'))`), ['Rename Rent'], 'only the custom type can be renamed')
  assert.deepEqual(await evaluate<string[]>(`[...${typesScope}.querySelectorAll('button[aria-label^="Archive "]')].map((b) => b.getAttribute('aria-label'))`), ['Archive Rent'], 'only the custom type can be archived')
  await evaluate(`(() => { const input = ${typesScope}.querySelector('input'); input.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, ' Packaging '); input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await pause(40)
  await press('Enter')
  await pause(150)
  assert.deepEqual((await calls()).filter((c) => c.path === '/api/fees/types').map((c) => [c.method, c.body]).filter(([m]) => m === 'POST'), [['POST', { name: 'Packaging' }]])
  assert.equal(await evaluate<number>(`document.querySelectorAll('[aria-label^="Delete"], [aria-label^="Remove"]').length`), 0, 'no delete control on the Types section either')

  // A phone: nothing overflows, in English and in Khmer.
  await opened(360, 'lang=en')
  assert.equal(await evaluate<boolean>(`document.documentElement.scrollWidth <= 360`), true, 'no horizontal overflow at 360 px')
  await opened(360, 'lang=km')
  assert.equal(await evaluate<boolean>(`document.documentElement.scrollWidth <= 360`), true, 'no horizontal overflow at 360 px in Khmer')
  assert.equal(await evaluate<string>(`document.querySelector('[data-expense-catalog-tab="types"]').textContent`), 'ប្រភេទ', 'the Types tab reads in Khmer')
  await khmerRoom('expense catalog', '[role=dialog]', 3)
  await recordsScenario()
})
