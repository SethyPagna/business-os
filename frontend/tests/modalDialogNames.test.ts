import assert from 'node:assert/strict'
import { existsSync, realpathSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { chromium, expect } from '@playwright/test'
import { createServer, transformWithEsbuild } from 'vite'
import { closeBrowserFixture } from './browserProfileTeardown.ts'

const root = path.resolve(import.meta.dirname, '..')
const fixtureId = '\0modal-dialog-names'
const fixture = String.raw`
import React, { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Modal from '/src/components/shared/Modal.tsx'
import UnsavedChangesPrompt from '/src/components/shared/UnsavedChangesPrompt.tsx'
import { AppContext, FALLBACK_APP_CONTEXT } from '/src/app/AppContextCore.tsx'
import en from '/src/lang/en.json'
import km from '/src/lang/km.json'
import '/src/styles/main.css'
import '@fontsource/noto-sans-khmer/400.css'

const params = new URLSearchParams(location.search)
const language = params.get('lang') || 'en'
const pack = language === 'km' ? km : en
const t = key => pack[key] || key
window.__words = { outer: t('resolve'), nested: t('field_history'), prompt: t('unsaved_changes_title') }
document.documentElement.lang = language
document.body.className = language === 'km' ? 'lang-km' : ''
window.__closed = 0
window.__minimized = 0
const staticGuard = {
  requestClose() {}, promptOpen: true, options: ['discard', 'back'], dismissPrompt() {},
  discardAndClose() {}, saveAndClose() {}, saving: false, workLabel: null,
}
function Flow() {
  const [open, setOpen] = useState(true)
  const [draft, setDraft] = useState('')
  return open ? <Modal title={<span>{t('resolve')}</span>} unsavedChanges={{ dirty: Boolean(draft) }}
    onClose={() => { window.__closed += 1; setOpen(false) }}
    onMinimize={() => { window.__minimized += 1; setOpen(false) }}>
    <input aria-label={t('reason')} value={draft} onChange={event => setDraft(event.target.value)} />
  </Modal> : <p data-fixture-closed>{t('close')}</p>
}
function Concurrent() {
  return <Modal title={<span>{t('resolve')}</span>} unsavedChanges="read-only" onClose={() => {}}>
    <Modal title={t('field_history')} layer="nested" unsavedChanges="read-only" onClose={() => {}}>
      <p>{t('items')}</p>
      <UnsavedChangesPrompt guard={staticGuard} />
      <UnsavedChangesPrompt guard={staticGuard} />
    </Modal>
  </Modal>
}
createRoot(document.getElementById('root')).render(<StrictMode>
  <AppContext.Provider value={{ ...FALLBACK_APP_CONTEXT, t, language }}>
    {params.get('kind') === 'concurrent' ? <Concurrent /> : <Flow />}
  </AppContext.Provider>
</StrictMode>)
`

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      assert.ok(address && typeof address !== 'string')
      probe.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

const server = await createServer({
  root,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: await freePort(), fs: { allow: [root, realpathSync(path.join(root, 'node_modules'))] } },
  plugins: [{
    name: 'modal-dialog-names',
    resolveId(id) { if (id === 'virtual:modal-dialog-names') return fixtureId },
    load(id) { if (id === fixtureId) return fixture },
    async transform(code, id) {
      if (id !== fixtureId) return null
      const result = await transformWithEsbuild(code, 'modal-dialog-names.tsx', { loader: 'tsx', jsx: 'automatic' })
      return { code: result.code, map: null }
    },
    configureServer(vite) {
      vite.middlewares.use('/modal-dialog-names', async (_req, res) => {
        res.setHeader('content-type', 'text/html; charset=utf-8')
        res.end(await vite.transformIndexHtml('/modal-dialog-names', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/virtual:modal-dialog-names"></script></body></html>'))
      })
    },
  }],
})

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
let exitCode = 0
try {
  await server.listen()
  const base = server.resolvedUrls!.local[0]
  const executablePath = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].find(existsSync)
  assert.ok(executablePath, 'A local Chromium browser is required')
  browser = await chromium.launch({ executablePath, headless: true })
  const context = await browser.newContext()
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== new URL(base).origin || url.pathname.startsWith('/api/')) return await route.abort()
    await route.continue()
  })
  const page = await context.newPage()
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  for (const width of [360, 1280]) for (const language of ['en', 'km']) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto(`${base}modal-dialog-names?lang=${language}&kind=concurrent`, { timeout: 60_000 })
    await page.getByRole('heading').first().waitFor({ timeout: 60_000 })
    const words = await page.evaluate(() => ({ lang: document.documentElement.lang, ...(window as any).__words }))
    assert.equal(words.lang, language)
    await expect(page.getByRole('dialog', { name: words.outer, exact: true })).toHaveCount(1)
    await expect(page.getByRole('dialog', { name: words.nested, exact: true })).toHaveCount(1)
    await expect(page.getByRole('dialog', { name: words.prompt, exact: true })).toHaveCount(2)
    const bindings = await page.getByRole('dialog').evaluateAll((dialogs) => dialogs.map((dialog) => {
      const id = dialog.getAttribute('aria-labelledby')
      const heading = id ? document.getElementById(id) : null
      return { id, tag: heading?.tagName, ownsHeading: heading?.closest('[role=dialog]') === dialog }
    }))
    assert.equal(bindings.length, 4)
    assert.equal(new Set(bindings.map((binding) => binding.id)).size, 4, 'concurrent nested instances have distinct title IDs')
    assert.ok(bindings.every((binding) => binding.id && binding.tag === 'H2' && binding.ownsHeading), 'each dialog names its own visible heading')
    assert.equal(await page.evaluate(() => document.querySelectorAll('[id]').length === new Set(Array.from(document.querySelectorAll('[id]')).map((node) => node.id)).size), true, 'no duplicate IDs')

    await page.goto(`${base}modal-dialog-names?lang=${language}&kind=flow`)
    const outer = page.getByRole('dialog', { name: words.outer, exact: true })
    await outer.waitFor()
    const outerId = await outer.getAttribute('aria-labelledby')
    const draft = outer.getByRole('textbox')
    await draft.fill(language === 'km' ? 'កែតម្រូវស្តុក' : 'Count correction')
    const retained = await draft.inputValue()
    const close = outer.getByRole('button')
    await close.click()
    const prompt = page.getByRole('dialog', { name: words.prompt, exact: true })
    await prompt.waitFor()
    const promptId = await prompt.getAttribute('aria-labelledby')
    assert.notEqual(promptId, outerId)
    assert.equal(await page.evaluate(() => (window as any).__closed), 0)
    const actions = prompt.locator('[data-unsaved-actions] button')
    await actions.nth(1).click()
    await prompt.waitFor({ state: 'detached' })
    assert.equal(await draft.inputValue(), retained, 'Back preserves the edited value')
    assert.equal(await outer.getAttribute('aria-labelledby'), outerId, 'outer title ID is stable after rerenders')
    await close.click()
    await prompt.waitFor()
    assert.equal(await prompt.getAttribute('aria-labelledby'), promptId, 'prompt title ID survives closed/open transitions')
    await prompt.locator('[data-unsaved-actions] button').first().click()
    await page.locator('[data-fixture-closed]').waitFor()
    assert.equal(await page.getByRole('dialog').count(), 0)
    assert.equal(await page.evaluate(() => (window as any).__closed), 1, 'Discard closes exactly once')
    assert.equal(await page.evaluate(() => (window as any).__minimized), 0, 'Discard does not minimize')
    assert.deepEqual(runtimeErrors, [], 'opening and closing prompts preserves hook order')
    console.log(`PASS ${width}x800 ${language}: nested names, unique/stable IDs, Close -> Back -> Discard`)
  }
} catch (error) {
  exitCode = 1
  console.error(error)
} finally {
  await closeBrowserFixture(exitCode, () => browser?.close(), () => server.close())
}
