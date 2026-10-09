import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { build, type PluginBuild } from 'esbuild'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import { chromium, webkit, expect, type Page } from '@playwright/test'
import config from '../tailwind.config.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const component = 'src/components/products/TaggedStockRows.tsx'
const packs = Object.fromEntries(['en', 'km'].map(language => [language, JSON.parse(readFileSync(resolve(root, `src/lang/${language}.json`), 'utf8'))]))
const baseline = process.env.TAGGED_UI_BASE
const before = baseline ? execFileSync('git', ['show', `${baseline}:frontend/${component}`], { cwd: root, encoding: 'utf8' }) : null
const modules = {
  app: `const p=${JSON.stringify(packs)}[new URLSearchParams(location.search).get('lang')||'en'];export const useApp=()=>({t:k=>p[k]||k});`,
  scope: `export const captureActorReadScope=()=>({authority:window.actor});export const isActorReadScopeCurrent=s=>s.authority===window.actor;export const assertActorSessionDispatchAllowed=s=>{if(!isActorReadScopeCurrent(s))throw {code:'actor_session_quarantined',outcome:'not_dispatched'}};`,
  transport: `const send=body=>{window.calls.push(structuredClone(body));return new Promise((resolve,reject)=>{window.accept=()=>resolve({success:true,productId:body.productId,branchId:body.branchId,conditionTag:body.conditionTag,quantity:body.quantity});window.reject=reject;window.malformed=()=>resolve({success:true});})};export const restoreTaggedLot=send;export const disposeTaggedLot=send;`,
}
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {TaggedStockActionModal,TaggedStockMobileCard} from './${component}';
const params=new URLSearchParams(location.search),p=${JSON.stringify(packs)}[params.get('lang')||'en'];window.actor=1;window.calls=[];window.events=[];window.notices=[];
const row={product_id:7,branch_id:1,product_name:'Synthetic very long product name for compact mobile stock controls',branch_name:'LC Store',condition_tag:'damaged',quantity:0.3,lot_count:1};
function App(){const[open,setOpen]=React.useState(true);const tr=(k,f)=>p[k]||f||k;return <><TaggedStockMobileCard row={row} tr={tr} canWrite onAction={()=>{}}/>{open&&<TaggedStockActionModal action={{row,kind:params.get('kind')||'restore'}} tr={tr} notify={(...args)=>window.notices.push(args)} onClose={()=>{window.events.push('close');setOpen(false)}} onDone={()=>{window.events.push('refresh');if(params.has('refreshFail'))return Promise.reject(Error('refresh failed'));}}/>}</>};createRoot(document.getElementById('root')).render(<App/>);`
const js = (await build({ stdin: { contents: entry, loader: 'tsx', resolveDir: root }, bundle: true, write: false, platform: 'browser', format: 'iife', plugins: [{ name: 'tagged-action-seams', setup(b: PluginBuild) {
  for (const [filter, key] of [[/\/AppContextCore\.tsx$/, 'app'], [/\/actorReadScope\.ts$/, 'scope'], [/\/damagedLotsTransport\.ts$/, 'transport']] as const) {
    b.onResolve({ filter }, () => ({ path: key, namespace: 'fixture' }))
  }
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: modules[args.path as keyof typeof modules], loader: 'tsx', resolveDir: root }))
  if (before) b.onLoad({ filter: /TaggedStockRows\.tsx$/ }, () => ({ contents: before, loader: 'tsx', resolveDir: resolve(root, 'src/components/products') }))
} }] })).outputFiles[0].text
const cssFiles = [component, 'src/components/shared/Modal.tsx', 'src/components/shared/UnsavedChangesPrompt.tsx', 'src/components/shared/kit/IconButton.tsx', 'src/components/shared/toolbarButtonStyles.ts']
const css = (await postcss([tailwindcss({ ...config, content: cssFiles.map(file => ({ raw: readFileSync(resolve(root, file), 'utf8'), extension: 'tsx' })) })]).process(readFileSync(resolve(root, 'src/styles/main.css'), 'utf8'), { from: resolve(root, 'src/styles/main.css') })).css
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/app.js' ? 'application/javascript' : 'text/html; charset=utf-8')
  res.end(req.url === '/app.js' ? js : `<html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body><div id="root"></div><script src="/app.js"></script></body></html>`)
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert.ok(address && typeof address !== 'string')
const origin = `http://127.0.0.1:${address.port}`
type State = { actor: number; calls: Array<Record<string, unknown>>; events: string[]; notices: Array<[string, string?]>; accept: () => void; reject: (error: unknown) => void; malformed: () => void }
const state = (page: Page) => page.evaluate(() => ({ calls: (window as unknown as State).calls, events: (window as unknown as State).events, notices: (window as unknown as State).notices }))
async function fill(page: Page) {
  await page.locator('input[type=number]').fill('0.2')
  await page.locator('input[type=text]').fill('Synthetic reason')
}
async function dispatch(page: Page) {
  await page.locator('form').evaluate(form => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  await page.waitForFunction(() => (window as unknown as State).calls.length > 0)
}
try {
  for (const engine of [chromium, webkit]) {
    const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    const browser = await engine.launch({ headless: true, ...(engine === chromium && existsSync(chromePath) ? { executablePath: chromePath } : {}) })
    try {
      for (const language of ['en', 'km']) for (const width of [375, 1280]) for (const kind of ['restore', 'dispose']) {
        const page = await browser.newPage({ viewport: { width, height: 800 } })
        page.setDefaultTimeout(6000)
        const errors: string[] = []
        page.on('pageerror', error => errors.push(error.message))
        const url = `${origin}/?lang=${language}&kind=${kind}`
        const pack = packs[language]
        await page.goto(url)
        if (before) {
          assert.equal(await page.locator('input[type=number]').getAttribute('step'), '1', 'old UI rejects fractional native input')
          await fill(page)
          const buttons = page.getByRole('dialog').getByRole('button')
          await buttons.last().click()
          await page.waitForFunction(() => (window as unknown as State).calls.length === 1)
          assert.equal(await page.locator('input[type=text]').isDisabled(), false, 'old UI permits pending edits')
          assert.equal(await buttons.first().isDisabled(), false, 'old UI permits pending header Close')
          await page.evaluate(() => (window as unknown as State).malformed())
          await expect(page.getByRole('dialog')).toHaveCount(0)
          console.log(`NEGATIVE CONTROL ${engine.name()} ${language} ${width} ${kind}: fractional input, pending edits/close, malformed acknowledgement all reproduce`)
          await page.close()
          continue
        }
        await expect(page.locator('[data-tagged-stock-row]')).toContainText('LC Store')
        await expect(page.locator('[data-tagged-stock-row]')).toContainText('damaged')
        await expect(page.locator('[data-tagged-stock-row]')).toContainText(pack.stock_tagged_sellable)
        await expect(page.locator('input[type=number]')).toHaveAttribute('step', 'any')
        await page.locator('input[type=number]').fill('0.2')
        await page.locator('input[type=number]').press('Enter')
        await expect(page.locator('input[type=text]')).toBeFocused()
        assert.equal((await state(page)).calls.length, 0)
        await page.getByRole('button', { name: pack.cancel, exact: true }).click()
        await expect(page.getByRole('dialog')).toHaveCount(2)
        assert.equal((await state(page)).events.length, 0, 'quantity-only draft cannot be silently discarded')
        await page.goto(url)
        await fill(page)
        await dispatch(page)
        assert.equal((await state(page)).calls.length, 1, 'two synchronous submits send one request')
        await expect(page.locator('input[type=text]')).toBeDisabled()
        await expect(page.getByRole('dialog').getByRole('button').first()).toBeDisabled()
        await page.keyboard.press('Escape')
        assert.equal((await state(page)).events.length, 0)
        await page.evaluate(() => (window as unknown as State).reject({ status: 503, code: 'stock_request_outcome_unknown' }))
        await expect(page.getByRole('status')).toContainText(pack.stock_tagged_pending)
        await expect(page.locator('input[type=number]')).toBeDisabled()
        await page.getByRole('button', { name: pack.retry, exact: true }).click()
        await page.waitForFunction(() => (window as unknown as State).calls.length === 2)
        const calls = (await state(page)).calls
        assert.deepEqual(calls[0], calls[1], 'lost reply retries exact quantity/reason/identity/request ID')
        await page.evaluate(() => (window as unknown as State).accept())
        await expect(page.getByRole('dialog')).toHaveCount(0)
        assert.deepEqual((await state(page)).events, ['close', 'refresh'])

        await page.goto(`${url}&refreshFail=1`)
        await fill(page); await dispatch(page)
        await page.evaluate(() => (window as unknown as State).accept())
        await expect(page.getByRole('dialog')).toHaveCount(0)
        await page.waitForFunction(() => (window as unknown as State).notices.length === 2)
        assert.equal((await state(page)).notices[0][0], kind === 'restore' ? pack.stock_tagged_restore_done : pack.stock_tagged_dispose_done)
        assert.equal((await state(page)).notices[1][0], pack.stock_tagged_refresh_failed)

        await page.goto(url); await fill(page); await dispatch(page)
        await page.evaluate(() => (window as unknown as State).malformed())
        await expect(page.getByRole('status')).toBeVisible()
        assert.equal((await state(page)).events.length, 0, 'malformed success never closes or refreshes')
        await page.goto(url); await fill(page); await dispatch(page)
        await page.evaluate(() => (window as unknown as State).reject({ status: 409, code: 'tagged_lot_conflict' }))
        await expect(page.locator('input[type=number]')).toBeEnabled()
        await expect(page.getByRole('status')).toHaveCount(0)
        assert.equal((await state(page)).calls.length, 1, 'a confirmed first conflict permits correction without automatic retry')
        await page.goto(url); await fill(page); await dispatch(page)
        await page.evaluate(() => (window as unknown as State).reject({ status: 409, code: 'idempotency_conflict' }))
        await expect(page.getByRole('status')).toContainText(pack.stock_tagged_check_history)
        await expect(page.getByRole('button', { name: pack.retry, exact: true })).toBeDisabled()
        await page.goto(url); await fill(page); await dispatch(page)
        await page.evaluate(() => { const s = window as unknown as State; s.actor++; s.accept() })
        await expect(page.locator('input[type=text]')).toBeDisabled()
        assert.equal((await state(page)).events.length, 0, 'retired actor response stays silent')
        assert.equal((await state(page)).notices.length, 0)
        await page.goto(url); await fill(page)
        await page.evaluate(() => { (window as unknown as State).actor++ })
        await page.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
        assert.equal((await state(page)).calls.length, 0, 'retired actor cannot dispatch')

        await page.goto(url)
        await page.setViewportSize({ width, height: 390 })
        await page.locator('input[type=text]').fill('Keyboard-sized viewport')
        await page.getByRole('dialog').getByRole('button').last().scrollIntoViewIfNeeded()
        const bounds = await page.getByRole('dialog').getByRole('button').last().boundingBox()
        assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 390, 'action reachable in reduced viewport')
        assert.ok(bounds.height >= 40 && bounds.width >= 40, 'cold Products launch has full touch targets without lazy Reports CSS')
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        if (width < 768) assert.ok(await page.locator('input[type=text]').evaluate(input => parseFloat(getComputedStyle(input).fontSize) >= 16))
        if (process.env.REVIEW_OUT && width === 375 && kind === 'restore') await page.screenshot({ path: resolve(process.env.REVIEW_OUT, `tagged-${engine.name()}-${language}.png`) })
        assert.deepEqual(errors, [])
        console.log(`PASS ${engine.name()} ${language} ${width} ${kind}: keyboard, discard, duplicate, lost reply, response, actor, refresh, layout`)
        await page.close()
      }
    } finally { await browser.close() }
  }
} finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
