import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { launchResolveFixture, type ResolveBrowser } from './resolveBrowserFixture.ts'
import { tasksFixtureSource } from './inventoryCheckTasksBrowserFixture.ts'

// T2 layout, in a real browser (spec 10.9): the Tasks board, Issue mode, the task view's bar and the three review dialogs, at 360 / 375 / 1280 px in English and Khmer.
//   board rows   2 lines on a phone, 1 line from lg; no text wraps inside its own cell
//   overflow     none, on the document and on the page scroller
//   tap targets  at least 44 px on a phone (40 from lg, the app's desktop size) for every button, pick box and row of the new screens
//   bars         the Issue bar and the task bar each stay ONE row (also at 360)
//   Khmer        a Khmer line box and no vertical clipping
//   dialogs      the issue, pickup and hand-back reviews sit inside the safe area at 375 with the notch and home bar present
//   idle         ten minutes of browser time on the board: no request
const packs = Object.fromEntries(['en', 'km'].map(lang => [lang, JSON.parse(readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8')) as Record<string, string>]))
const INSET = { top: 47, bottom: 34 }
const browser = await launchResolveFixture('inventory-check-tasks-layout', tasksFixtureSource)

const overflow = `(() => { const page = document.querySelector('[data-inventory-check-page]'); return { document: document.documentElement.scrollWidth - innerWidth, page: page.scrollWidth - page.clientWidth } })()`
const noOverflow = async (label: string) => {
  const measured = await browser.evaluate<{ document: number; page: number }>(overflow)
  assert.ok(measured.document <= 0 && measured.page <= 0, `${label}: no horizontal scroll (${JSON.stringify(measured)})`)
}
/** Every button, pick box and row of the new screens inside `scope` is at least `min` px tall and wide (a labelled button may be wider). */
const tapTargets = async (label: string, scope: string, min: number) => {
  const small = await browser.evaluate<string[]>(`(() => {
    const out = []
    for (const node of document.querySelectorAll(${JSON.stringify(scope)})) {
      const targets = node.matches('button, [data-task-open], [data-issue-action]') ? [node] : []
      for (const target of [...targets, ...node.querySelectorAll('button, [data-check-pick]')]) {
        const box = (target.matches('[data-check-pick]') ? target.closest('label') : target).getBoundingClientRect()
        if (box.width === 0 && box.height === 0) continue
        if (box.height < ${min} - 0.5 || box.width < ${min} - 0.5) out.push((target.getAttribute('aria-label') || target.getAttribute('data-task-action') || target.getAttribute('data-issue-action') || target.tagName) + ' ' + Math.round(box.width) + 'x' + Math.round(box.height))
      }
    }
    return out
  })()`)
  assert.deepEqual(small, [], `${label}: every tap target is at least ${min}px`)
}
/** The visual lines of one element's cells: the leaf boxes grouped by vertical overlap, and any text cell that wraps inside itself. */
const linesOf = `(scope) => {
  const leaves = []; const wraps = []
  for (const node of scope.querySelectorAll('*')) {
    const box = node.getBoundingClientRect()
    if (box.width === 0 || box.height === 0 || getComputedStyle(node).display === 'contents') continue
    if ((node.closest('svg') && node.tagName !== 'svg') || (node.closest('button') && node.tagName !== 'BUTTON')) continue
    if (node.getAttribute('aria-hidden') === 'true' && !node.textContent) continue
    if (!(node.tagName === 'svg' || node.tagName === 'BUTTON' || (node.children.length === 0 && node.textContent.trim()))) continue
    leaves.push(box)
    const style = getComputedStyle(node), size = parseFloat(style.fontSize)
    const line = style.lineHeight === 'normal' ? size * 1.6 : parseFloat(style.lineHeight)
    if (node.textContent.trim() && node.tagName !== 'BUTTON' && style.display !== 'flex' && box.height > line * 1.6 && !node.closest('button')) wraps.push(node.textContent.trim().slice(0, 30) + ' ' + Math.round(box.height) + '/' + Math.round(line))
  }
  leaves.sort((a, b) => a.top - b.top)
  const lines = []
  for (const box of leaves) { const last = lines[lines.length - 1]; if (last && box.top < last.bottom - 2 && box.bottom > last.top + 2 && Math.abs((box.top + box.bottom) / 2 - (last.top + last.bottom) / 2) < 8) { last.top = Math.min(last.top, box.top); last.bottom = Math.max(last.bottom, box.bottom) } else lines.push({ top: box.top, bottom: box.bottom }) }
  return { lines: lines.length, wraps }
}`
/** One row of a bar: every visible part's vertical centre is within 3px of the others. The bar's middle may scroll sideways (as the session bar's does for a long name), but what `inView` names must be fully visible without scrolling. */
const oneRow = async (label: string, selector: string, inView = '') => {
  const bar = await browser.evaluate<{ height: number; spread: number; hidden: string[]; count: number }>(`(() => {
    const bar = document.querySelector(${JSON.stringify(selector)}); const parts = [...bar.children].filter(child => child.getBoundingClientRect().height > 0)
    const centres = parts.map(child => { const box = child.getBoundingClientRect(); return box.top + box.height / 2 })
    const room = bar.querySelector('.scroll-x-clean')?.getBoundingClientRect()
    const hidden = ${JSON.stringify(inView)} && room ? [...bar.querySelectorAll(${JSON.stringify(inView)})].filter(node => node.getBoundingClientRect().right > room.right + 1 || node.getBoundingClientRect().left < room.left - 1).map(node => node.textContent) : []
    return { height: bar.getBoundingClientRect().height, spread: Math.max(...centres) - Math.min(...centres), hidden, count: parts.length }
  })()`)
  assert.ok(bar.count >= 2, `${label}: the bar has its parts (${bar.count})`)
  assert.ok(bar.spread < 3 && bar.height <= 56, `${label}: one row, at most 56px tall (spread ${bar.spread}, height ${bar.height})`)
  assert.deepEqual(bar.hidden, [], `${label}: ${inView} is in view without scrolling`)
}
const safeInsets = async (on: boolean) => { await browser.send('Emulation.setSafeAreaInsetsOverride', { insets: on ? { top: INSET.top, bottom: INSET.bottom, left: 0, right: 0 } : { top: 0, bottom: 0, left: 0, right: 0 } }) }
/** A review dialog drawn from its first paint: title, items, both buttons, all inside the safe area. */
const dialogFits = async (label: string, width: number, height: number, title: string) => {
  await browser.waitFor(`${label} dialog`, async () => await browser.evaluate(`document.querySelector('[role="dialog"]') ? true : null`))
  const dialog = await browser.evaluate<{ title: string; items: number; panel: { top: number; bottom: number; left: number; right: number }; buttons: Array<{ text: string; top: number; bottom: number; left: number; right: number }>; padTop: number; padBottom: number }>(`(() => {
    const root = document.querySelector('[role="dialog"]'), panel = root.children[0]; const box = node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right } }
    const pad = getComputedStyle(root)
    return { title: root.querySelector('h2').textContent, items: root.querySelectorAll('dl > div').length, panel: box(panel), padTop: parseFloat(pad.paddingTop), padBottom: parseFloat(pad.paddingBottom),
      buttons: [...root.querySelectorAll('button')].filter(node => node.textContent.trim() && node.getBoundingClientRect().height > 0).map(node => ({ text: node.textContent.trim(), ...box(node) })) }
  })()`)
  assert.equal(dialog.title, title, `${label}: the title`)
  assert.ok(dialog.items >= 1, `${label}: its items are drawn on the first frame (${dialog.items})`)
  assert.ok(dialog.padTop >= 12 + INSET.top - 1 && dialog.padBottom >= 12 + INSET.bottom - 1, `${label}: the safe-area insets reach the dialog (${dialog.padTop}/${dialog.padBottom})`)
  assert.ok(dialog.panel.top >= INSET.top - 0.5 && dialog.panel.bottom <= height - INSET.bottom + 0.5 && dialog.panel.left >= 0 && dialog.panel.right <= width, `${label}: the panel sits inside the safe area ${JSON.stringify(dialog.panel)}`)
  assert.ok(dialog.buttons.length >= 2, `${label}: Confirm and Cancel are both there (${dialog.buttons.map(button => button.text).join('|')})`)
  assert.ok(dialog.buttons.every(button => button.top >= INSET.top && button.bottom <= height - INSET.bottom + 0.5 && button.left >= 0 && button.right <= width && button.bottom - button.top >= 36), `${label}: both buttons are fully visible and tall enough ${JSON.stringify(dialog.buttons)}`)
}
const typeCount = async (id: number, value: string) => {
  await browser.evaluate(`document.querySelector('[data-inventory-check-row="${id}"] [data-check-count]').focus()`)
  await browser.send('Input.insertText', { text: value })
}
const openTask = async (width: number, lang: string, role: string, task: string, height = 760) => {
  await browser.open(width, `lang=${lang}&role=${role}&section=tasks`, `document.querySelector('[data-inventory-check-task]')`, height)
  await browser.mouseClick(`[data-inventory-check-task="${task}"] [data-task-open]`)
  await browser.waitFor('task view', async () => await browser.evaluate(`document.querySelector('[data-inventory-check-task-bar]') && document.querySelector('[data-inventory-check-row]') ? true : null`))
}

await browser.run('PASS count tasks layout: board rows 2 lines on a phone / 1 from lg, no overflow, 44px targets, one-row bars, Khmer room, review dialogs in the safe area, nothing polls', async () => {
  // A failing combination is recorded and the rest still run, so one pass shows every defect.
  const failures: string[] = []
  const combos = [360, 375, 1280].flatMap(width => ['en', 'km'].flatMap(lang => ['admin', 'employee'].map(role => ({ width, lang, role }))))
  for (const { width, lang, role } of combos) try {
    const pack = packs[lang]; const phone = width < 1024; const min = phone ? 44 : 40; const where = `${lang} ${width} ${role}`
    // ---- the Tasks board: three tasks (open, held by someone else, mine) ----
    await browser.open(width, `lang=${lang}&role=${role}&section=tasks`, `document.querySelector('[data-inventory-check-task]')`, 700)
    await noOverflow(`${where} board`)
    assert.equal(await browser.evaluate<number>(`document.querySelectorAll('[data-inventory-check-task]').length`), 3, `${where}: three tasks`)
    const rows = await browser.evaluate<Array<{ id: string; lines: number; wraps: string[]; height: number }>>(`(() => { const lines = ${linesOf}; return [...document.querySelectorAll('[data-inventory-check-task] [data-task-open]')].map(row => ({ id: row.parentElement.getAttribute('data-inventory-check-task'), ...lines(row), height: row.getBoundingClientRect().height })) })()`)
    for (const row of rows) {
      assert.equal(row.lines, phone ? 2 : 1, `${where}: task ${row.id} is ${phone ? 2 : 1} line(s) (${JSON.stringify(row)})`)
      assert.deepEqual(row.wraps, [], `${where}: task ${row.id}: no cell wraps inside itself`)
      assert.ok(row.height >= min - 0.5, `${where}: task ${row.id} is a ${min}px target (${row.height})`)
    }
    await tapTargets(`${where} board`, '[data-inventory-check-tasks] button, [data-inventory-check-tasks-header] button', min)
    assert.ok(await browser.evaluate<boolean>(`document.querySelector('[data-inventory-check-task="t1"] [data-task-action="pickup"]') !== null`), `${where}: Pick up on the free task`)
    assert.equal(await browser.evaluate<boolean>(`!!document.querySelector('[data-inventory-check-task] [data-task-issuer]')`), role === 'admin', `${where}: the issuer shows for the admin only`)
    if (lang === 'km') await browser.khmerRoom(`${where} board`, '[data-inventory-check-page]', 4)
    // From xl the board is a table: the progress, picker, date and issuer columns start at the same x on every row, whatever buttons a row carries (Pick up, Hand back + Close, or none).
    if (width >= 1280) {
      const columns = await browser.evaluate<Record<string, number[]>>(`(() => { const left = selector => [...document.querySelectorAll('[data-inventory-check-task]')].map(row => { const node = row.querySelector(selector); return node ? Math.round(node.getBoundingClientRect().left * 10) / 10 : null }).filter(value => value !== null); return { progress: left('[data-task-progress]'), picker: left('[data-task-picker]'), date: left('[data-task-issued]'), issuer: left('[data-task-issuer]') } })()`)
      assert.equal(columns.progress.length, 3, `${where}: every row has a progress column`)
      assert.equal(columns.date.length, 3, `${where}: every row has a date column`)
      assert.equal(columns.picker.length, 2, `${where}: the two held rows have a picker column`)
      assert.equal(columns.issuer.length, role === 'admin' ? 3 : 0, `${where}: the issuer column is the admin's`)
      for (const [name, xs] of Object.entries(columns)) assert.ok(xs.every(x => Math.abs(x - xs[0]) <= 1), `${where}: the ${name} column starts at the same x on every row (${JSON.stringify(xs)})`)
      if (role === 'admin') {
        const issuer = await browser.evaluate<{ text: string; clipped: boolean }[]>(`[...document.querySelectorAll('[data-task-issuer]')].map(node => ({ text: node.textContent, clipped: node.scrollWidth > node.clientWidth + 1 }))`)
        for (const one of issuer) assert.equal(one.text, `${pack.inventory_check_created_by} @boss`, `${where}: the issuer is labelled`)
        assert.ok(issuer.every(one => !one.clipped), `${where}: the labelled issuer fits its column (${JSON.stringify(issuer)})`)
      }
    }
    // ---- the empty board ----
    await browser.open(width, `lang=${lang}&role=${role}&section=tasks&board=empty`, `document.querySelector('[data-inventory-check-empty="tasks"]')`, 700)
    await noOverflow(`${where} empty board`)
    if (lang === 'km') await browser.khmerRoom(`${where} empty board`, '[data-inventory-check-page]', 1)

    // ---- a closed task with frozen figures ("300/300 counted at close", the longest progress cell): one line from lg, no cell wraps inside itself ----
    await browser.open(width, `lang=${lang}&role=${role}&section=tasks&board=closed`, `document.querySelector('[data-inventory-check-task="t4"]')`, 700)
    await noOverflow(`${where} closed board`)
    assert.equal(await browser.evaluate<number>(`document.querySelectorAll('[data-inventory-check-task]').length`), 4, `${where}: three tasks and the closed one`)
    const closedRows = await browser.evaluate<Array<{ id: string; lines: number; wraps: string[]; text: string }>>(`(() => { const lines = ${linesOf}; return [...document.querySelectorAll('[data-inventory-check-task] [data-task-open]')].map(row => ({ id: row.parentElement.getAttribute('data-inventory-check-task'), ...lines(row), text: row.querySelector('[data-task-progress]').textContent })) })()`)
    for (const row of closedRows) {
      assert.equal(row.lines, phone ? 2 : 1, `${where}: task ${row.id} is ${phone ? 2 : 1} line(s) (${JSON.stringify(row)})`)
      assert.deepEqual(row.wraps, [], `${where}: task ${row.id}: no cell wraps inside itself`)
    }
    assert.equal(closedRows.find(row => row.id === 't4')?.text, pack.inventory_check_task_progress_closed.replace('{done}', '300').replace('{total}', '300'), `${where}: the closed row reads its frozen figures`)

    // ---- Issue mode (admin only): the Issue bar, the pick boxes and the name beside them ----
    if (role === 'admin') {
      await browser.open(width, `lang=${lang}&role=${role}&section=tasks`, `document.querySelector('[data-task-issue]')`, 700)
      await browser.mouseClick('[data-task-issue]')
      await browser.waitFor('issue bar', async () => await browser.evaluate(`document.querySelector('[data-inventory-check-issue-bar]') && document.querySelector('[data-check-pick]') ? true : null`))
      await noOverflow(`${where} issue mode`)
      await oneRow(`${where} issue bar (none picked)`, '[data-inventory-check-issue-bar]')
      await browser.mouseClick('[data-inventory-check-row="1"] [data-check-pick]'); await browser.mouseClick('[data-inventory-check-row="2"] [data-check-pick]')
      await browser.waitFor('two picks', async () => await browser.evaluate(`document.querySelector('[data-picked-pill]')?.textContent === '2' ? true : null`))
      await oneRow(`${where} issue bar (two picked)`, '[data-inventory-check-issue-bar]')
      await tapTargets(`${where} issue mode`, '[data-inventory-check-issue-bar], [data-inventory-check-row]', min)
      const names = await browser.evaluate<Array<{ id: string; boxRight: number; rowRight: number; nameLeft: number; nameWidth: number; pickRight: number }>>(`[...document.querySelectorAll('[data-inventory-check-row]')].slice(0, 5).map(row => { const name = row.querySelector('[data-inventory-check-main] > div > span.block') || row.querySelector('[data-inventory-check-main]'); const box = name.getBoundingClientRect(), pick = row.querySelector('[data-check-pick]').getBoundingClientRect(), r = row.getBoundingClientRect(); return { id: row.getAttribute('data-inventory-check-row'), boxRight: box.right, rowRight: r.right, nameLeft: box.left, nameWidth: box.width, pickRight: pick.right } })`)
      for (const name of names) assert.ok(name.nameWidth >= 60 && name.nameLeft >= name.pickRight - 1 && name.boxRight <= name.rowRight + 1, `${where}: the name stays on its row beside the pick box ${JSON.stringify(name)}`)
      if (lang === 'km') await browser.khmerRoom(`${where} issue mode`, '[data-inventory-check-page]', 3)
      if (width === 375) {
        await safeInsets(true)
        await browser.mouseClick('[data-issue-action="issue"]')
        await dialogFits(`${where} issue review`, width, 700, pack.inventory_check_task_issue_review_title)
        await safeInsets(false)
      }
    }

    // ---- the task view and its bar (mine: Hand back and, for the admin, Close) ----
    await openTask(width, lang, role, 't3', 700)
    await noOverflow(`${where} task view`)
    await oneRow(`${where} task bar`, '[data-inventory-check-task-bar]', '[data-task-progress-text], [data-session-progress]')
    await tapTargets(`${where} task bar`, '[data-inventory-check-task-bar]', min)
    assert.equal(await browser.evaluate<number>(`document.querySelectorAll('[data-inventory-check-row]').length`), 4, `${where}: the task view holds the task's four products`)
    if (lang === 'km') await browser.khmerRoom(`${where} task view`, '[data-inventory-check-page]', 3)
    // The hand-back danger review, with counts typed (they are named in the review).
    if (width === 375) {
      await typeCount(2, '5'); await typeCount(4, '6')
      // Counts typed on an earlier visit are restored from this device, and the fixture's toast (it never times out, unlike the App's) then sits over the task bar: the toast is dismissed, and a press is only made once nothing covers the button.
      await browser.evaluate(`window.__toast && window.__toast(null)`)
      await browser.waitFor(`${where} hand-back button uncovered`, async () => await browser.evaluate(`(() => { const button = document.querySelector('[data-inventory-check-task-bar] [data-task-action="release"]'); if (!button) return null; const box = button.getBoundingClientRect(); const top = document.elementFromPoint(box.left + box.width / 2, box.top + Math.min(box.height / 2, 10)); return top && button.contains(top) ? true : null })()`), 12000)
      await safeInsets(true)
      await browser.mouseClick('[data-inventory-check-task-bar] [data-task-action="release"]')
      await dialogFits(`${where} hand-back review`, width, 700, pack.inventory_check_task_release_review_title)
      await safeInsets(false)
    }
  } catch (error) { failures.push(`${lang} ${width} ${role}: ${(error as Error).message.split(String.fromCharCode(10))[0]}`); await safeInsets(false) }
  // ---- the pickup review (employee, 375), both languages ----
  for (const lang of ['en', 'km']) try {
    await browser.open(375, `lang=${lang}&role=employee&section=tasks`, `document.querySelector('[data-inventory-check-task]')`, 700)
    await safeInsets(true)
    await browser.mouseClick('[data-inventory-check-task="t1"] [data-task-action="pickup"]')
    await dialogFits(`${lang} 375 pickup review`, 375, 700, packs[lang].inventory_check_task_pickup_review_title)
    await safeInsets(false)
  } catch (error) { failures.push(`${lang} 375 pickup review: ${(error as Error).message.split(String.fromCharCode(10))[0]}`); await safeInsets(false) }
  // ---- nothing polls: the board shown for ten minutes of browser time asks for nothing ----
  await browser.open(1280, 'lang=en&role=admin&section=tasks', `document.querySelector('[data-inventory-check-task]')`, 700)
  try { await idleTenMinutes(browser) } catch (error) { failures.push(`idle: ${(error as Error).message.split(String.fromCharCode(10))[0]}`) }
  assert.deepEqual(failures, [], 'every layout check held')
})

/** Ten minutes of virtual browser time (the timers really run) with the board shown: the request log must not grow. */
async function idleTenMinutes(page: ResolveBrowser) {
  const before = await page.evaluate<string[]>(`window.__calls.slice()`)
  assert.ok(before.some(call => call.includes('/api/inventory-checks/tasks')), 'the board was read once when it opened')
  const started = await page.evaluate<number>(`Date.now()`)
  await page.send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: 600_000 })
  const waited = await page.waitFor('ten virtual minutes', async () => (await page.evaluate<number>(`Date.now()`)) - started >= 600_000 ? true : null, 120_000)
  assert.ok(waited)
  await page.send('Emulation.setVirtualTimePolicy', { policy: 'advance' })
  const after = await page.evaluate<string[]>(`window.__calls.slice()`)
  assert.deepEqual(after, before, 'ten minutes idle on the board: zero requests')
}
