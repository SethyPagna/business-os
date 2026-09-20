import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { compactPager, language, markup, oldCompactLayout, pagerSource } from './support/compactPagerFixture'

const require = createRequire(import.meta.url)
const postcss = require('postcss'), tailwind = require('tailwindcss')
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
  await page.setContent(`<html><head><style>${css}</style></head><body class="lang-${lang}"><main style="width:calc(100% - 48px);margin:24px" data-fixture>${html}</main></body></html>`)
  await page.evaluate(() => document.fonts.ready)
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
