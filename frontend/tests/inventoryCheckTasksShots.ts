import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { launchResolveFixture } from './resolveBrowserFixture.ts'
import { tasksFixtureSource } from './inventoryCheckTasksBrowserFixture.ts'

// Screenshots of the count-task screens for the lead (not a test: the chain runs *.test.ts only). Usage: node tests/inventoryCheckTasksShots.ts <output folder>
// Each screen: <screen>-<width>-<lang>-<role>.png at 375 x 812 and 1280 x 800, English and Khmer, admin and employee (Issue mode is the admin's).
const out = path.resolve(process.argv[2] || '')
assert.ok(process.argv[2], 'an output folder is required')
mkdirSync(out, { recursive: true })
const browser = await launchResolveFixture('inventory-check-tasks-shots', tasksFixtureSource)
const shot = async (name: string) => {
  await browser.pause(250)
  const reply = await browser.send('Page.captureScreenshot', { format: 'png' }) as { data: string }
  writeFileSync(path.join(out, `${name}.png`), Buffer.from(reply.data, 'base64'))
  console.log('saved', name)
}
const INSET = { top: 47, bottom: 34, left: 0, right: 0 }
const insets = (on: boolean) => browser.send('Emulation.setSafeAreaInsetsOverride', { insets: on ? INSET : { top: 0, bottom: 0, left: 0, right: 0 } })
const visibility = (state: 'hidden' | 'visible') => browser.evaluate(`(Object.defineProperty(document, 'visibilityState', { configurable: true, value: ${JSON.stringify(state)} }), document.dispatchEvent(new Event('visibilitychange')), true)`)
const typeCount = async (id: number, value: string) => {
  await browser.evaluate(`document.querySelector('[data-inventory-check-row="${id}"] [data-check-count]').focus()`)
  await browser.send('Input.insertText', { text: value })
}

await browser.run('shots done', async () => {
  for (const width of [375, 1280]) for (const lang of ['en', 'km']) for (const role of ['admin', 'employee']) {
    const height = width === 375 ? 812 : 800
    const suffix = `${width}-${lang}-${role}`
    const q = (extra: string) => `lang=${lang}&role=${role}&${extra}`
    const board = `document.querySelector('[data-inventory-check-task]')`
    const openTask = async () => {
      await browser.open(width, q('section=tasks'), board, height)
      await browser.mouseClick('[data-inventory-check-task="t3"] [data-task-open]')
      await browser.waitFor('task view', async () => await browser.evaluate(`document.querySelector('[data-inventory-check-task-bar]') && document.querySelector('[data-inventory-check-row]') ? true : null`))
    }
    // a clean device for this combination
    await browser.open(width, q('section=tasks'), board, height); await browser.evaluate('localStorage.clear()')

    await browser.open(width, q('section=tasks&board=empty'), `document.querySelector('[data-inventory-check-empty="tasks"]')`, height); await shot(`tasks-board-empty-${suffix}`)
    await browser.open(width, q('section=tasks'), board, height); await shot(`tasks-board-three-${suffix}`)

    if (role === 'admin') {
      await browser.mouseClick('[data-task-issue]')
      await browser.waitFor('issue mode', async () => await browser.evaluate(`document.querySelector('[data-inventory-check-issue-bar]') && document.querySelector('[data-check-pick]') ? true : null`))
      await browser.mouseClick('[data-inventory-check-row="1"] [data-check-pick]'); await browser.mouseClick('[data-inventory-check-row="2"] [data-check-pick]')
      await browser.waitFor('two picks', async () => await browser.evaluate(`document.querySelector('[data-picked-pill]')?.textContent === '2' ? true : null`))
      await shot(`issue-mode-${suffix}`)
      if (width === 375) await insets(true)
      await browser.mouseClick('[data-issue-action="issue"]')
      await browser.waitFor('issue review', async () => await browser.evaluate(`document.querySelector('[role="dialog"] dl') ? true : null`))
      await shot(`issue-review-${suffix}`); await insets(false)
    }

    await browser.open(width, q('section=tasks'), board, height)
    if (width === 375) await insets(true)
    await browser.mouseClick('[data-inventory-check-task="t1"] [data-task-action="pickup"]')
    await browser.waitFor('pickup review', async () => await browser.evaluate(`document.querySelector('[role="dialog"] dl') ? true : null`))
    await shot(`pickup-review-${suffix}`); await insets(false)

    await openTask(); await shot(`task-view-${suffix}`)
    // typed counts, kept on the device, then a reload: the restored notice
    await typeCount(2, '5'); await typeCount(4, '6'); await browser.pause(1000); await visibility('hidden'); await visibility('visible')
    await openTask()
    await browser.waitFor('restored notice', async () => await browser.evaluate(`window.__notices.some(item => item.text === ${JSON.stringify(lang === 'km' ? 'បានស្ដារការរាប់ពីឧបករណ៍នេះ។' : 'Counts restored from this device.')}) ? true : null`))
    await shot(`counts-restored-${suffix}`)
    await browser.evaluate(`window.__toast(null)`)
    if (width === 375) await insets(true)
    await browser.mouseClick('[data-inventory-check-task-bar] [data-task-action="release"]')
    await browser.waitFor('hand-back review', async () => await browser.evaluate(`document.querySelector('[role="dialog"] dl') ? true : null`))
    await shot(`handback-review-${suffix}`); await insets(false)
    await browser.press('Escape')
    await browser.waitFor('dialog closed', async () => await browser.evaluate(`document.querySelector('[role="dialog"]') ? null : true`))
    await browser.evaluate('window.__raiseGuard()')
    await browser.waitFor('leave guard', async () => await browser.evaluate(`document.querySelector('[data-leave-guard] button') ? true : null`))
    await shot(`leave-guard-${suffix}`)
    await browser.evaluate('localStorage.clear()')

    await browser.open(width, q('section=sessions'), `document.querySelector('[data-inventory-check-session]')`, height); await shot(`sessions-pickup-${suffix}`)
  }
})
