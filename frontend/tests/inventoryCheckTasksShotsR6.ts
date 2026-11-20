import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { launchResolveFixture } from './resolveBrowserFixture.ts'
import { tasksFixtureSource } from './inventoryCheckTasksBrowserFixture.ts'

// Round 6 screenshots (not a test: the chain runs *.test.ts only): a closed task's board row and view bar, and the open-task limit line (the page's own line, opened from its info button; the fixture cannot send a write, so the 409 path is proved by the mounted test).
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

    await browser.open(width, q('section=tasks&cap=3'), board, height)
    const hint = await browser.evaluate(`(() => { const b = [...document.querySelectorAll('[data-inventory-check-tasks-header] button, button[aria-label]')].find(item => /3/.test(item.getAttribute('aria-label') || '') && item.getAttribute('aria-label').length > 12); if (!b) return null; b.setAttribute('data-r6-hint', ''); return b.getAttribute('aria-label') })()`)
    assert.ok(hint, 'the info button carries the limit sentence')
    console.log('limit line:', hint)
    await browser.mouseClick('[data-r6-hint]')
    await shot(`limit-line-${suffix}`)
  }
})
