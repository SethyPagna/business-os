import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import ts from 'typescript'
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import tailwindConfig from '../tailwind.config.ts'
import { chromium } from '@playwright/test'

const root = path.resolve(import.meta.dirname, '..')
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n')
const products = read('src/components/products/Products.tsx')
const header = read('src/components/products/surfaces/HeaderActions.tsx')
const parsed = ts.createSourceFile('Products.tsx', products, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let openingExpression = ''
function visit(node: ts.Node): void {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(parsed) === 'ProductsHeaderActions') {
    const add = node.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(parsed) === 'onAdd')
    assert.ok(add && ts.isJsxAttribute(add) && add.initializer && ts.isJsxExpression(add.initializer) && add.initializer.expression)
    openingExpression = add.initializer.expression.getText(parsed)
  }
  ts.forEachChild(node, visit)
}
visit(parsed)
assert.ok(openingExpression, 'execute the actual Products header opener, not a copied permission predicate')
assert.equal((products.match(/<FastStockInModal\b/g) || []).length, 1, 'both entry points share the existing session host')
assert.match(products, /initialMode=\{stockSession\.mode\}/)
assert.match(products, /legacyDraft=\{stockSession\.legacyDraft \?\? null\}/)
assert.match(products, /onPrepareProduct=\{canAddProduct \? prepareProductForSession : undefined\}/)
assert.match(products, /canCreateProducts=\{canAddProduct\}/)
assert.match(products, /const canAddProduct = can\('products', 'add'\)/)
assert.match(products, /const canAdjustInventoryStock = can\('inventory', 'adjust'\)/)

// Mount the real shared header and execute its actual Products onAdd expression.
// The output observes the parent session state; existing sibling tests cover the
// unchanged full session, draft, confirmation and Worker permission machinery.
const fixture = `
import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
import Header from './src/components/products/surfaces/HeaderActions.tsx';
const packs = ${JSON.stringify({ en: JSON.parse(read('src/lang/en.json')), km: JSON.parse(read('src/lang/km.json')) })};
const query = new URLSearchParams(location.search);
const t = key => packs[query.get('lang') || 'en'][key] || key;
const activeProductSection = query.get('section') || 'products';
const canAddProduct = query.get('create') === '1';
const canAdjustInventoryStock = query.get('receive') === '1';
function Host() {
 const [stockSession, setStockSession] = useState(null);
 const onAdd = ${openingExpression};
 return <main style={{padding:12,maxWidth:640}}>
  <h1>{t(activeProductSection === 'stock_in_sessions' ? 'stock_in_sessions' : 'products')}</h1>
  <Header t={t} onAdd={onAdd} onManageReasons={()=>{}} historySlot={<button type="button" className="btn-secondary h-10 min-w-0 flex-1 sm:flex-none sm:min-w-[6.5rem]">{t('action_history')}</button>} />
  <output data-session>{JSON.stringify(stockSession)}</output>
 </main>;
}
createRoot(document.getElementById('root')).render(<Host/>);
`
const built = await build({ stdin: { contents: fixture, loader: 'tsx', resolveDir: root, sourcefile: 'owner-stock-entrypoints-fixture.tsx' }, bundle: true, format: 'iife', platform: 'browser', write: false })
const bundle = built.outputFiles[0].text
const css = (await postcss([tailwindcss({ ...tailwindConfig, content: [{ raw: header + fixture + read('src/components/shared/toolbarButtonStyles.ts'), extension: 'tsx' }] })]).process(read('src/styles/main.css'), { from: path.join(root, 'src/styles/main.css') })).css
const server = http.createServer((request, response) => {
  response.setHeader('cache-control', 'no-store')
  if (request.url === '/fixture.js') { response.setHeader('content-type', 'text/javascript'); response.end(bundle); return }
  response.setHeader('content-type', 'text/html; charset=utf-8')
  const language = new URL(request.url || '/', 'http://fixture').searchParams.get('lang') || 'en'
  response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body class="lang-${language}"><div id="root"></div><script src="/fixture.js"></script></body></html>`)
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert.ok(address && typeof address !== 'string')
const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(fs.existsSync)
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
let failed = 0
try {
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
  for (const language of ['en', 'km']) for (const width of [375, 1280]) for (const section of ['products', 'stock_in_sessions']) {
    const context = await browser.newContext({ viewport: { width, height: 812 } })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    try {
      await page.goto(`http://127.0.0.1:${address.port}/?lang=${language}&section=${section}&receive=1`)
      await page.locator('[data-session]').waitFor()
      const label = JSON.parse(read(`src/lang/${language}.json`)).adjust_stock
      const button = page.getByRole('button', { name: label, exact: true })
      await button.waitFor({ timeout: 2000 })
      assert.equal(await button.locator('svg.lucide-boxes').count(), 1, 'use the existing Products box icon without plus')
      assert.equal(await button.locator('svg.lucide-package-plus').count(), 0)
      const geometry = await button.evaluate((element) => {
        const r = element.getBoundingClientRect()
        const label = element.querySelector('span')!
        return { left: r.left, right: r.right, height: r.height, clipped: label.scrollWidth > label.clientWidth, overflow: document.documentElement.scrollWidth > innerWidth }
      })
      assert.ok(geometry.left >= 0 && geometry.right <= width && geometry.height >= 40)
      assert.equal(geometry.clipped, false, 'the complete EN/KM action remains readable')
      assert.equal(geometry.overflow, false)
      await button.focus()
      assert.equal(await button.evaluate((element) => document.activeElement === element), true)
      await page.keyboard.press('Enter')
      assert.deepEqual(JSON.parse(await page.locator('[data-session]').innerText()), { mode: 'add' }, 'keyboard opens the original Stock Session state in Add')
      console.log(`PASS mounted ${language} ${width}px ${section}: label, icon, focus and original session opener; ${JSON.stringify(geometry)}`)
    } catch (error) { failed++; console.error(`FAIL mounted ${language} ${width}px ${section}`, error) }
    assert.deepEqual(errors, [], 'no mounted header runtime errors')
    await context.close()
  }
  for (const section of ['products', 'stock_in_sessions', 'stock_changes']) for (const grants of [{ create: 0, receive: 0 }, { create: 1, receive: 0 }, { create: 0, receive: 1 }]) {
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${address.port}/?section=${section}&create=${grants.create}&receive=${grants.receive}`)
    await page.locator('[data-session]').waitFor()
    const primary = page.locator('button.btn-primary')
    try {
      const permitted = section !== 'stock_changes' && Boolean(grants.create || grants.receive)
      assert.equal(await primary.count(), permitted ? 1 : 0, 'no grant means no entry; Stock Changes keeps its separate ledger opener')
      if (permitted) { await primary.click(); assert.deepEqual(JSON.parse(await page.locator('[data-session]').innerText()), { mode: 'add' }) }
      else assert.equal(await page.locator('[data-session]').innerText(), 'null', 'denied user leaves parent session closed')
      console.log(`PASS actual opener ${section} create=${grants.create} receive=${grants.receive}`)
    } catch (error) { failed++; console.error(`FAIL actual opener ${section}`, error) }
    await page.close()
  }
} finally {
  await browser?.close()
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}
if (failed) process.exitCode = 1
