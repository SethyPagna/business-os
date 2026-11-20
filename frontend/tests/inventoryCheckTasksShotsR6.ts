import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { launchResolveFixture } from './resolveBrowserFixture.ts'
import { tasksFixtureSource } from './inventoryCheckTasksBrowserFixture.ts'

// Round 6 screenshots (not a test: the chain runs *.test.ts only): a closed task's board row and view bar, and the open-task limit refusal line.
// Usage: node tests/inventoryCheckTasksShotsR6.ts <output folder>
const out = path.resolve(process.argv[2] || '')
assert.ok(process.argv[2], 'an output folder is required')
mkdirSync(out, { recursive: true })
const browser = await launchResolveFixture('inventory-check-tasks-shots-r6', tasksFixtureSource)
const shot = async (name: string) => {
  await browser.pause(250)
  const reply = await browser.send('Page.captureScreenshot', { format: 'png' }) as { data: string }
  writeFileSync(path.join(out, `${name}.png`), Buffer.from(reply.data, 'base64'))
  console.log('saved', name)
}
const text = (selector: string) => browser.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`)

await browser.run('r6 shots done', async () => {
  for (const [width, lang] of [[375, 'km'], [1280, 'en'], [1280, 'km']] as const) {
    const height = width === 375 ? 812 : 800
    const suffix = `${width}-${lang}`
    const q = (extra: string) => `lang=${lang}&role=admin&${extra}`
    const board = `document.querySelector('[data-inventory-check-task]')`
    await browser.open(width, q('section=tasks&board=closed'), board, height)
    console.log('closed row:', await text('[data-inventory-check-task="t4"] [data-task-progress]'))
    await shot(`closed-row-${suffix}`)
    await browser.mouseClick('[data-inventory-check-task="t4"] [data-task-open]')
    await browser.waitFor('task view', async () => await browser.evaluate(`document.querySelector('[data-inventory-check-task-bar]') && document.querySelector('[data-inventory-check-row]') ? true : null`))
    console.log('closed bar:', await text('[data-inventory-check-task-bar] [data-task-progress-text]'))
    await shot(`closed-view-bar-${suffix}`)

    await browser.open(width, q('section=tasks&refuse=limit'), board, height)
    await browser.mouseClick('[data-task-issue]')
    await browser.waitFor('issue mode', async () => await browser.evaluate(`document.querySelector('[data-inventory-check-issue-bar]') && document.querySelector('[data-check-pick]') ? true : null`))
    await browser.mouseClick('[data-inventory-check-row="1"] [data-check-pick]')
    await browser.waitFor('one pick', async () => await browser.evaluate(`document.querySelector('[data-picked-pill]')?.textContent === '1' ? true : null`))
    await browser.mouseClick('[data-issue-action="issue"]')
    await browser.waitFor('issue review', async () => await browser.evaluate(`document.querySelector('[role="dialog"] dl') ? true : null`))
    const confirm = await browser.evaluate(`(() => { const buttons = [...document.querySelectorAll('[role="dialog"] button')]; const b = buttons[buttons.length - 1]; b.setAttribute('data-r6-confirm', ''); return b.textContent })()`)
    console.log('confirm button:', confirm)
    await browser.mouseClick('[data-r6-confirm]')
    await browser.waitFor('refusal line', async () => await browser.evaluate(`window.__notices.length || document.querySelector('[role="alert"]') ? true : null`))
    console.log('notices:', JSON.stringify(await browser.evaluate('window.__notices')))
    await shot(`limit-refusal-${suffix}`)

    await browser.open(width, q('section=tasks&cap=3'), board, height)
    await shot(`limit-header-${suffix}`)
  }
})
