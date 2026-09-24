import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { compactPager, hydrationScript, language, markup, oldCompactLayout, pagerSource } from './support/compactPagerFixture'

const require = createRequire(import.meta.url)
const postcss = require('postcss'), tailwind = require('tailwindcss')
// Same viewport meta as index.html. Without it an isMobile project (the main
// config's android-chromium) lays the page out at Chromium's 980px default, so
// every "320px" check silently measured a ~916px-wide fixture.
const viewportMeta = '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">'
let css = ''
test.beforeAll(async () => {
  const config = require('tailwindcss/loadConfig')(path.resolve('tailwind.config.ts'))
  css = (await postcss([tailwind({ ...config, content: [{ raw: pagerSource + oldCompactLayout(), extension: 'tsx' }] })]).process(fs.readFileSync('src/styles/main.css', 'utf8'), { from: undefined })).css
  const font = fs.readFileSync(require.resolve('@fontsource/noto-sans-khmer/files/noto-sans-khmer-khmer-400-normal.woff2')).toString('base64')
  css += `@font-face{font-family:'Noto Sans Khmer';font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,${font}) format('woff2');}`
})

async function show(page: any, lang: string, current: number, width: number, source = pagerSource, input = false) {
  await page.setViewportSize({ width, height: 900 })
  const pack = language(lang)
  const html = markup(compactPager({ page: current, totalItems: current === 13 ? 245 : current * 20, compactPageInput: input, t: (key: string) => pack[key] }, source))
  await page.setContent(`<html><head>${viewportMeta}<style>${css}</style></head><body class="lang-${lang}"><main style="width:calc(100% - 48px);margin:24px" data-fixture>${html}</main></body></html>`)
  await page.evaluate(() => document.fonts.ready)
  expect(await page.evaluate(() => window.innerWidth), 'layout viewport must be the width under test').toBe(width)
}

async function clipped(page: any) {
  return page.locator('[data-fixture]').evaluate((root: HTMLElement) => {
    const failures: string[] = []
    for (const el of Array.from(root.querySelectorAll('span,button,input'))) {
      if (el.classList.contains('sr-only') || el.closest('.sr-only')) continue
      const box = el.getBoundingClientRect()
      if (el instanceof HTMLInputElement && el.scrollWidth > el.clientWidth + 1) failures.push('input digits clipped')
      if (['hidden', 'clip'].includes(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1) failures.push('hidden content')
      if (box.right > window.innerWidth + 1 || box.left < -1) failures.push('viewport overflow')
      if (el.children.length || !el.textContent?.trim()) continue
      const range = document.createRange(); range.selectNodeContents(el)
      const text = range.getBoundingClientRect()
      const ancestor = el.parentElement!
      const available = ancestor.getBoundingClientRect()
      if (text.width > box.width + 1 || (['hidden', 'clip'].includes(getComputedStyle(ancestor).overflowX) && text.right > available.right + 1)) failures.push(el.textContent)
    }
    if (document.documentElement.scrollWidth > window.innerWidth + 1) failures.push('document overflow')
    return failures
  })
}

for (const lang of ['en', 'km']) for (const width of [320, 375, 1280]) {
  test(`${lang} ${width}px full compact numbers including large counts`, async ({ page }, testInfo) => {
    for (const current of [13, 123456]) {
      await show(page, lang, current, width)
      await expect(page.locator('span[aria-hidden=true]')).toHaveText(`${current} / ${current}`)
      expect(await clipped(page)).toEqual([])
      if (width === 320) await page.screenshot({ path: testInfo.outputPath(`compact-${lang}-${current}.png`) })
      if (current === 13) {
        const groupsShareRow = await page.locator('[data-fixture] > div > div').evaluate(row => {
          const [range, navigation] = Array.from(row.children).map(el => el.getBoundingClientRect())
          return Math.abs((range.top + range.bottom) / 2 - (navigation.top + navigation.bottom) / 2) < 1
        })
        expect(groupsShareRow).toBe(true)
        const oneRow = await page.locator('[data-fixture] button').evaluateAll((buttons) => buttons.every((button) => Math.abs(button.getBoundingClientRect().top - buttons[0].getBoundingClientRect().top) < 1))
        expect(oneRow).toBe(true)
      }
    }
    await show(page, lang, 123456, width, pagerSource, true)
    expect(await clipped(page)).toEqual([])
    await expect(page.getByRole('textbox')).toHaveValue('123456')
  })
}

test('negative old compact tracks/ellipsis conceal Khmer total page at320', async ({ page }, testInfo) => {
  await show(page, 'km', 13, 320, oldCompactLayout())
  await page.screenshot({ path: testInfo.outputPath('negative.png') })
  expect((await clipped(page)).length).toBeGreaterThan(0)
})

async function hydrateInput(page: any, lang: string, source = pagerSource) {
  await show(page, lang, 123456, 320, source, true)
  await page.addScriptTag({ content: hydrationScript({ compact: true, compactPageInput: true, page: 123456, pageSize: 20, totalItems: 2469120 }, language(lang), source) })
  await expect(page.locator('body')).toHaveAttribute('data-hydrated', 'true')
}

for (const lang of ['en', 'km']) test(`${lang} hydrated compact input bounds oversized paste and preserves edits`, async ({ page }) => {
  await hydrateInput(page, lang)
  const input = page.getByRole('textbox')
  for (const [pasted, expected] of [['9'.repeat(100), '123456'], ['0'.repeat(100), '0'], ['000123456', '123456'], ['', ''], ['123456', '123456']]) {
    await input.fill(pasted)
    await expect(input).toHaveValue(expected)
    expect(await clipped(page)).toEqual([])
  }
  await input.fill('123455')
  await input.press('Enter')
  await expect(input).toHaveValue('123455')
  await expect(page.getByRole('button', { name: language(lang).next, exact: true })).toBeEnabled()
  await input.fill('')
  await input.press('Tab')
  await expect(input).toHaveValue('123455')
})

test('negative unbounded hydrated draft reproduces100digit overflow', async ({ page }) => {
  const unbounded = pagerSource.replace('const compactDraft = boundedDraft(pageDraft)', 'const compactDraft = pageDraft').replace('setPageDraft(boundedDraft(event.target.value))', "setPageDraft(event.target.value.replace(/[^\\d]/g, '') || '')")
  await hydrateInput(page, 'km', unbounded)
  await page.getByRole('textbox').fill('9'.repeat(100))
  await expect(page.getByRole('textbox')).toHaveValue('9'.repeat(100))
  expect((await clipped(page)).length).toBeGreaterThan(0)
})
