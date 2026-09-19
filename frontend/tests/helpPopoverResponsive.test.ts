import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { helpPopoverGeometry } from '../src/utils/helpPopoverGeometry.ts'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createServer, transformWithEsbuild } from 'vite'
import { chromium, expect } from '@playwright/test'

for (const width of [160, 240, 320, 375, 768, 1440]) {
  for (const height of [80, 160, 320, 800]) {
    for (const left of [0, 120]) for (const top of [0, 80]) {
      const viewport = { left, top, width, height }
      for (const x of [-20, width / 2, width - 20, width + 50]) {
        for (const y of [-50, height / 2, height - 20, height + 50]) {
          const trigger = { left: left + x, right: left + x + 20, top: top + y, bottom: top + y + 20 }
          for (const align of ['left', 'right', 'auto'] as const) {
            const result = helpPopoverGeometry(trigger, viewport, align)
            const panelTop = result.placement === 'above' ? result.top - result.maxHeight : result.top
            assert.ok(result.left >= left && result.left + result.width <= left + width)
            assert.ok(panelTop >= top && panelTop + result.maxHeight <= top + height)
            assert.ok(result.width <= 288 && result.maxHeight <= 288)
          }
        }
      }
    }
  }
}

const hint = readFileSync(new URL('../src/components/shared/InfoHint.tsx', import.meta.url), 'utf8')
const guide = readFileSync(new URL('../src/components/shared/ButtonGuidePopover.tsx', import.meta.url), 'utf8')
assert.match(hint, /overflowWrap: 'anywhere'/)
assert.match(hint, /overflow-y-auto overflow-x-hidden overscroll-contain/)
assert.match(hint, /visualViewport\?\.addEventListener\('resize'/)
assert.match(hint, /panelRef\.current\?\.contains\(target\)/, 'touch scrolling inside the portal is not an outside dismissal')
assert.match(hint, /onMouseEnter=\{cancelClose\}/, 'pointer transfer to the portaled panel cancels delayed close')
assert.match(hint, /tabIndex=\{0\}/, 'overflow help can receive keyboard focus and scroll')
assert.match(hint, /aria-controls=\{open \? panelId : undefined\}/)
assert.match(guide, /<ul[\s\S]*<li/, 'caller-provided guide entries use semantic bullets')
assert.doesNotMatch(guide, /LazyPortalMenu|title=\{title\}/, 'explanations neither impersonate action menus nor duplicate native tooltips')
assert.match(guide, /entry\.description/, 'full descriptions remain readable without truncation')
console.log('PASS help popover geometry across viewport sizes/offsets/edges and shared accessibility contracts')

const root = path.resolve(import.meta.dirname, '..')
const fixtureId = '\0help-popover-fixture'
const fixture = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import InfoHint from '/src/components/shared/InfoHint.tsx';
import ButtonGuidePopover from '/src/components/shared/ButtonGuidePopover.tsx';
import '/src/styles/main.css';
const words = 'ព័ត៌មានជំនួយ សូមពិនិត្យទិន្នន័យមុនពេលរក្សាទុក។ '.repeat(25);
createRoot(document.getElementById('root')).render(<div style={{position:'fixed',right:8,bottom:8}}>
 <InfoHint label="Long hint" text={words + ' https://example.com/' + 'x'.repeat(300)} />
 <ButtonGuidePopover title="Guide" entries={Array.from({length:12},(_,i)=>({label:'Action '+i,description:words}))}/>
</div>);`
const server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'help-fixture',
  resolveId(id) { if (id === 'virtual:help-fixture') return fixtureId },
  load(id) { if (id === fixtureId) return fixture },
  async transform(code, id) {
    if (id !== fixtureId) return null
    const result = await transformWithEsbuild(code, 'help-fixture.tsx', { loader: 'tsx', jsx: 'automatic' })
    return { code: result.code, map: null }
  },
  configureServer(vite) { vite.middlewares.use('/help-fixture', async (_req, res) => {
    res.setHeader('content-type', 'text/html'); res.end(await vite.transformIndexHtml('/help-fixture', '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/virtual:help-fixture"></script></body></html>'))
  }) },
}] })
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
try {
  await server.listen()
  const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(existsSync)
  browser = await chromium.launch({ executablePath, headless: true })
  const page = await browser.newPage()
  await page.goto(`${server.resolvedUrls!.local[0]}help-fixture`)
  for (const width of [240, 320, 390, 1024]) for (const height of [160, 640]) {
    await page.setViewportSize({ width, height })
    for (const label of ['Long hint', 'Guide']) {
      const trigger = page.getByRole('button', { name: label, exact: true })
      await trigger.click()
      const panel = page.getByRole(label === 'Guide' ? 'dialog' : 'tooltip')
      await panel.waitFor()
      const rect = await panel.boundingBox()
      assert.ok(rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width + 1 && rect.y + rect.height <= height + 1)
      assert.ok(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'long Khmer text and URL wrap without horizontal overflow')
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'help never widens the document')
      await trigger.press('ArrowDown')
      assert.equal(await panel.evaluate(el => el === document.activeElement), true)
      await panel.press('End')
      await expect.poll(() => panel.evaluate(el => el.scrollTop), { message: 'keyboard can reach long content' }).toBeGreaterThan(0)
      if (label === 'Guide') assert.equal(await panel.locator('li').count(), 12)
      await page.keyboard.press('Escape')
      await panel.waitFor({ state: 'detached' })
      assert.equal(await trigger.evaluate(el => el === document.activeElement), true)
    }
  }
  await page.setViewportSize({ width: 390, height: 640 })
  await page.getByRole('button', { name: 'Long hint', exact: true }).blur()
  await page.mouse.move(0, 0)
  await page.getByRole('button', { name: 'Long hint', exact: true }).hover()
  const hoverPanel = page.getByRole('tooltip')
  await hoverPanel.hover()
  await page.waitForTimeout(250)
  assert.equal(await hoverPanel.count(), 1, 'moving onto the portaled panel keeps hover help open')
  await page.mouse.wheel(0, 180)
  await expect.poll(() => hoverPanel.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
  await page.mouse.click(0, 0)
  await hoverPanel.waitFor({ state: 'detached' })
  console.log('PASS browser help popovers: narrow/short viewports, Khmer/URL wrapping, list semantics, keyboard scroll and Escape focus return')
} finally {
  await browser?.close()
  await server.close()
}
