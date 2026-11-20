// One page for the count-task browser tests and the screenshot script: the REAL Inventory page, its real transport and styles, in a real Chromium, with `window.fetch`
// answering the way docs/contracts/inventory-check-tasks-20261119.md says. Query: lang=en|km, section=products|sessions|tasks, role=admin|employee, board=three|empty|closed|closedboth (closed adds a closed task counted 5 of 10 with frozen figures, `at_close`; closedboth adds also a legacy closed task counted 5 of 10 with no flag), cap=N (open-task limit, default 30), refuse=limit (an issue answers 409 inventory_check_task_limit with open 10 and limit 10).
// Every request the page makes is kept in `window.__calls` ("METHOD path?query"), so a test can count what a screen costs. Not a test file itself.
export const tasksFixtureSource = String.raw`
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import { AppContext, FALLBACK_APP_CONTEXT } from '/src/app/AppContextCore.tsx'
  import InventoryChecksPage from '/src/components/inventory/InventoryChecksPage.tsx'
  import { APP_NAVIGATION_EVENT } from '/src/app/pathRouting.ts'
  import en from '/src/lang/en.json'
  import km from '/src/lang/km.json'
  import '/src/styles/main.css'
  import '@fontsource/noto-sans-khmer/400.css'
  const params = new URLSearchParams(location.search)
  const language = params.get('lang') || 'en'
  const section = params.get('section') || 'tasks'
  const role = params.get('role') || 'admin'
  const boardKind = params.get('board') || 'three'
  const pack = language === 'km' ? km : en
  const t = key => pack[key] || key
  document.body.className = language === 'km' ? 'lang-km' : ''
  window.__calls = []
  const km1 = language === 'km'
  const branchName = km1 ? 'សាខាសាកល្បងឈ្មោះវែងបំផុតមួយ' : 'Synthetic long branch name'
  const longTitle = km1 ? 'រាប់ទឹកអប់ធ្នើទីមួយ ផលិតផលសាកល្បងឈ្មោះវែងបំផុត' : 'Shelf one perfumes with a really long task title'
  const names = ['ទឹកអប់ក្លិនផ្កាម្លិះធម្មជាតិ ១០០មីលីលីត្រ ផលិតផលសាកល្បងឈ្មោះវែង', 'Synthetic long product name for the narrow phone layout check 100ml']
  const rowOf = id => ({ id, name: (km1 ? names[0] : names[1]) + ' ' + id, unit: 'pcs', barcode: '88500011' + String(10000 + id), brand: km1 ? 'ម៉ាកសាកល្បង' : 'Synthetic brand', category: km1 ? 'ប្រភេទសាកល្បង' : 'Synthetic category', stock_quantity: 8,
    branch_stock: [{ branch_id: 1, branch_name: branchName, quantity: 8 }] })
  const taskIds = { t1: [1, 3, 5, 7], t2: [9, 10, 11, 12], t3: [2, 4, 6, 8], t4: [13, 14, 15, 16, 17, 18, 19, 20, 21, 22], t5: [13, 14, 15, 16, 17, 18, 19, 20, 21, 22] }
  const admin = role === 'admin'
  const row = (id, over) => ({ id, branch_id: 1, title: '', status: 'open', revision: 0, issued_at: '2026-11-18T03:00:00.000Z', ...(admin ? { issued_by: 'boss' } : {}), closed_at: null, total: 4, done: 0, removed: 0,
    selection: { kind: 'ids' }, picked_up_by: null, picked_up_at: null, mine: false, can_pickup: true, can_release: false, can_close: admin, ...over })
  const closedTask = row('t4', { status: 'closed', total: 10, done: 5, closed_at: '2026-11-19T05:00:00.000Z', at_close: true, can_pickup: false, can_close: false, revision: 5 })
  const legacyTask = row('t5', { status: 'closed', total: 10, done: 5, closed_at: '2026-11-19T04:00:00.000Z', can_pickup: false, can_close: false, revision: 5 })
  const board = boardKind === 'empty' ? [] : [
    row('t1', { title: longTitle }),
    row('t2', { picked_up_by: 'dara', picked_up_at: '2026-11-19T01:00:00.000Z', can_pickup: false, can_release: admin, revision: 2 }),
    row('t3', { done: 1, picked_up_by: role === 'admin' ? 'boss' : 'sok', picked_up_at: '2026-11-19T02:00:00.000Z', mine: true, can_pickup: false, can_release: true, revision: 3, pickup_session_id: 'pickup-1' }),
    ...(boardKind === 'closed' || boardKind === 'closedboth' ? [closedTask] : []),
    ...(boardKind === 'closedboth' ? [legacyTask] : []),
  ]
  const respond = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const nativeFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = new URL(String(input && input.url || input), location.href)
    if (!url.pathname.startsWith('/api/')) return nativeFetch(input, init)
    window.__calls.push(((init && init.method) || 'GET') + ' ' + url.pathname + url.search)
    const p = url.pathname
    if (p === '/api/branches') return respond([{ id: 1, name: branchName, is_active: 1 }])
    if (p === '/api/inventory/reasons') return respond({ items: [{ id: 1, type: 'adjust', label: 'Shelf mismatch' }] })
    if (p === '/api/inventory-checks/tasks' && init && init.method === 'POST' && params.get('refuse') === 'limit') return respond({ open: 10, limit: 10, error: 'inventory_check_task_limit', code: 'inventory_check_task_limit' }, 409)
    if (p === '/api/inventory-checks/tasks') return respond({ branchId: 1, version: 'k1', items: board, capabilities: { issue: admin, work: true, maxProducts: 300, maxOpenTasks: Number(params.get('cap')) || 30 } })
    if (p === '/api/inventory-checks/list') {
      const task = url.searchParams.get('taskId')
      const ids = task ? taskIds[task] || [] : Array.from({ length: 25 }, (_v, index) => index + 1)
      const page = Number(url.searchParams.get('page')) || 1, size = Number(url.searchParams.get('pageSize')) || 20
      return respond({ wired: true, projected: false, items: ids.slice((page - 1) * size, page * size).map(rowOf), total: ids.length, page, pageSize: size, totalPages: Math.max(1, Math.ceil(ids.length / size)), overlay_ids: 150,
        ...(url.searchParams.get('summary') === '0' ? {} : { summary: { ok: 0, issue: 0, not_checked: ids.length, total: ids.length } }), facets: { brands: ['Synthetic brand'], categories: [] }, capabilities: { productsPerSubmission: 40 } })
    }
    if (p === '/api/inventory-checks/overlay') return respond({ items: String(url.searchParams.get('ids') || '').split(',').filter(Boolean).map(id => ({ product_id: Number(id), last_change_at: null })), summary: { ok: 0, issue: 0, not_checked: 1, total: 1 } })
    if (p === '/api/inventory-checks/sessions') return respond({ items: [
      { id: 'pickup-1', branch_id: 1, created_by: 7, title: '', status: 'open', revision: 0, started_at: '2026-11-19T02:00:00.000Z', updated_at: '2026-11-19T02:00:00.000Z', scope: { membership: 'pickup', task: 't3' }, branch_name: branchName, creator_name: 'sok',
        task: { id: 't3', title: '', status: 'open', total: 4, done: 1 }, progress: { total: 0, done: 0, issue: 0, unstarted: 0 } },
      { id: 'pickup-2', branch_id: 1, created_by: 7, title: '', status: 'closed', revision: 1, started_at: '2026-11-18T02:00:00.000Z', updated_at: '2026-11-18T05:00:00.000Z', closed_at: '2026-11-18T05:00:00.000Z', scope: { membership: 'pickup', task: 'old' }, branch_name: branchName, creator_name: 'sok',
        task: { id: 'old', title: '', status: 'closed', total: 3, done: 3 }, progress: { total: 0, done: 0, issue: 0, unstarted: 0 } },
    ], total: 2, page: 1, pageSize: 20 })
    return respond({})
  }
  window.history.replaceState(null, '', '/inventory#hub:inventory:' + section)
  const FIELDS = { inventory_check_show_price: true, inventory_check_show_barcode: true, inventory_check_show_category: true, inventory_check_show_brand: true, inventory_check_show_stock: true, inventory_check_show_received: true }
  const user = admin ? { id: 1, username: 'boss', role_code: 'admin', permissions: { inventory: true, inventory_checks: true, ...FIELDS } } : { id: 7, username: 'sok', role_code: 'employee', permissions: { inventory: true, inventory_checks: true, ...FIELDS } }
  // The App's unsaved-work guard, copied from src/App.tsx (the page itself is not mounted here): the same markup, so its layout and words are the real ones.
  function Guard() {
    const [entries, setEntries] = React.useState(null)
    window.__raiseGuard = () => import('/src/utils/dirtyWork.ts').then(module => setEntries(module.getDirtyWork()))
    if (!entries) return null
    return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" data-leave-guard>
      <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-2xl dark:bg-gray-800">
        <h2 className="font-bold text-gray-900 dark:text-white">{t('unsaved_work_title')}</h2>
        <ul className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-300">{entries.map(entry => <li key={entry.key} className="flex items-center gap-2"><span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" /><span className="min-w-0 truncate">{entry.label}</span></li>)}</ul>
        <p className="mt-2 text-xs text-gray-400">{t('unsaved_work_hint')}</p>
        <div className="mt-3 flex flex-col gap-2">
          {entries.every(entry => typeof entry.save === 'function') ? <button type="button" className="btn-primary w-full text-sm">{t('save_and_leave')}</button> : null}
          <button type="button" className="w-full rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-900/20">{t('discard_and_leave')}</button>
          <button type="button" className="btn-secondary w-full text-sm">{t('stay_here')}</button>
        </div>
      </div>
    </div>
  }
  // The App's toast, copied from src/App.tsx (Notification): the same classes, so a screenshot shows the real one.
  function Toast() {
    const [last, setLast] = React.useState(null)
    window.__toast = setLast
    if (!last) return null
    return <div data-toast className={'fixed right-3 top-[4.75rem] md:right-5 md:top-5 z-[1100] text-white pl-4 pr-2.5 py-3 rounded-xl shadow-2xl text-sm font-medium fade-in max-w-[min(20rem,calc(100vw-1.5rem))] flex items-start gap-2 ' + (last.tone === 'success' ? 'bg-green-600' : last.tone === 'warning' ? 'bg-amber-600' : 'bg-blue-600')}><span className="flex-1 min-w-0 break-words">{last.text}</span></div>
  }
  const notices = []
  window.__notices = notices
  const app = { ...FALLBACK_APP_CONTEXT, t, language, page: 'inventory', authReady: true, canWriteToServer: true, settings: { navigation_mode: 'sections' }, AccessDenied: () => null, user,
    notify: (text, tone) => { notices.push({ text, tone }); if (window.__toast) window.__toast({ text, tone }) },
    navigateTo: (page, anchor) => { window.history.pushState(null, '', '/inventory#' + (anchor || '')); window.dispatchEvent(new CustomEvent(APP_NAVIGATION_EVENT, { detail: { page, path: '/inventory', anchor } })) } }
  createRoot(document.getElementById('root')).render(<AppContext.Provider value={app}><div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}><InventoryChecksPage /></div><Guard /><Toast /></AppContext.Provider>)
`
