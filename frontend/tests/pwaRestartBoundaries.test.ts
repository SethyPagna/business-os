import assert from 'node:assert/strict'
import nodeTest from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { build, buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium, webkit, expect } from '@playwright/test'

const test = (name: string, body: () => Promise<void>) => nodeTest(name, { timeout: 1000 }, body)

const frontend = fileURLToPath(new URL('../', import.meta.url))
const bundle = buildSync({ stdin: { contents: "export { optionalAppOperation, restartIntoLatestApp, setAppUpdateUnsavedWorkNotice } from './src/utils/appUpdate.ts'; export { registerDirtyWork } from './src/utils/dirtyWork.ts'", resolveDir: frontend }, bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
function deferred() {
  let resolve!: (value?: any) => void
  const promise = new Promise<any>(done => { resolve = done })
  return { promise, resolve }
}
class Events {
  listeners = new Map<string, Map<() => void, () => void>>()
  addEventListener(type: string, fn: () => void, options?: { once?: boolean }) {
    const group = this.listeners.get(type) || new Map()
    group.set(fn, options?.once ? () => { group.delete(fn); fn() } : fn)
    this.listeners.set(type, group)
  }
  removeEventListener(type: string, fn: () => void) { this.listeners.get(type)?.delete(fn) }
  emit(type: string) { for (const fn of [...this.listeners.get(type)?.values() || []]) fn() }
  count() { return [...this.listeners.values()].reduce((n, group) => n + group.size, 0) }
}
function fixture(registration: any = undefined) {
  const timers = new Map<number, () => void>()
  const deadlines: number[] = []
  let sequence = 0, reloads = 0, notices = 0
  const serviceWorker: any = new Events()
  serviceWorker.getRegistration = () => Promise.resolve(registration)
  const window = { location: { reload() { reloads++ } }, setTimeout(fn: () => void, ms: number) { deadlines.push(ms); timers.set(++sequence, fn); return sequence }, clearTimeout(id: number) { timers.delete(id) }, addEventListener() {} }
  const module = { exports: {} as any }
  vm.runInNewContext(bundle, { module, exports: module.exports, require() { throw new Error('unexpected dependency') }, window, document: { addEventListener() {} }, navigator: { serviceWorker }, console, URL, setTimeout: window.setTimeout, clearTimeout: window.clearTimeout })
  const api = module.exports
  api.setAppUpdateUnsavedWorkNotice(() => { notices++ })
  let dirty = false
  api.registerDirtyWork({ key: 'draft', pageId: 'products', label: 'draft', isDirty: () => dirty })
  return { api, timers, deadlines, serviceWorker, setDirty(value: boolean) { dirty = value }, get reloads() { return reloads }, get notices() { return notices }, async expire() { const pending = [...timers]; for (const [id, fn] of pending) { timers.delete(id); fn() }; await tick() } }
}

for (const operation of ['registration', 'update']) test(`stalled ${operation} settles once and late completion cannot navigate again`, async () => {
  const pending = deferred()
  const registration = { update: () => operation === 'update' ? pending.promise : Promise.resolve() }
  const f = fixture(registration)
  if (operation === 'registration') f.serviceWorker.getRegistration = () => pending.promise
  let result: string | undefined
  f.api.restartIntoLatestApp().then((value: string) => { result = value })
  await tick()
  await f.expire()
  assert.equal(result, 'reloading')
  assert.equal(f.reloads, 1)
  assert.equal(f.timers.size, 0)
  assert.ok(f.deadlines.every(ms => ms > 0 && ms <= 5000))
  pending.resolve(registration)
  await tick()
  assert.equal(f.reloads, 1)
  assert.equal(f.timers.size, 0)
})

for (const boundary of ['registration', 'installing']) test(`dirty during ${boundary} refuses the actual activation/navigation boundary`, async () => {
  const pending = deferred()
  const installing: any = new Events()
  installing.state = 'installing'
  let activations = 0
  const registration: any = { update: async () => {}, installing: boundary === 'installing' ? installing : null, waiting: null }
  const f = fixture(registration)
  if (boundary === 'registration') f.serviceWorker.getRegistration = () => pending.promise
  const result = f.api.restartIntoLatestApp()
  await tick()
  f.setDirty(true)
  if (boundary === 'registration') pending.resolve(registration)
  else {
    installing.state = 'installed'
    registration.waiting = { postMessage() { activations++ } }
    installing.emit('statechange')
  }
  assert.equal(await result, 'blocked')
  assert.equal(activations, 0)
  assert.equal(f.reloads, 0)
  assert.equal(f.notices, 1)
  assert.equal(f.timers.size, 0)
  assert.equal(installing.count(), 0)
})

test('already waiting worker activates after a stalled update deadline, once', async () => {
  let activations = 0
  const pending = deferred()
  const f = fixture({ update: () => pending.promise, waiting: { postMessage() { activations++; f.serviceWorker.emit('controllerchange') } } })
  const result = f.api.restartIntoLatestApp()
  await tick()
  await f.expire()
  assert.equal(await result, 'reloading')
  assert.equal(activations, 1)
  assert.equal(f.reloads, 1)
  pending.resolve()
  await tick()
  assert.equal(activations, 1)
  assert.equal(f.serviceWorker.count(), 0)
  assert.equal(f.timers.size, 0)
})

test('already-dirty refuses; clean retry and concurrent callers choose one reload', async () => {
  const f = fixture()
  f.setDirty(true)
  assert.equal(await f.api.restartIntoLatestApp(), 'blocked')
  assert.equal(f.notices, 1)
  assert.equal(f.reloads, 0)
  f.setDirty(false)
  await Promise.all([f.api.restartIntoLatestApp(), f.api.restartIntoLatestApp()])
  assert.equal(f.reloads, 1)
  assert.equal(await f.api.restartIntoLatestApp(), 'reloading')
  assert.equal(f.reloads, 1)
  assert.equal(f.timers.size, 0)
})

test('dirty during update prevents worker activation and reload, then allows clean retry', async () => {
  const pending = deferred()
  let activations = 0
  const f = fixture({ update: () => pending.promise, waiting: { postMessage() { activations++ } } })
  const result = f.api.restartIntoLatestApp()
  await tick()
  f.setDirty(true)
  pending.resolve()
  assert.equal(await result, 'blocked')
  assert.equal(activations, 0)
  assert.equal(f.reloads, 0)
  assert.equal(f.notices, 1)
  assert.equal(f.timers.size, 0)
  f.setDirty(false)
  const retry = f.api.restartIntoLatestApp()
  await tick()
  f.serviceWorker.emit('controllerchange')
  assert.equal(await retry, 'reloading')
  assert.equal(activations, 1)
  assert.equal(f.reloads, 1)
  assert.equal(f.serviceWorker.count(), 0)
})

for (const state of ['installed', 'timeout', 'redundant']) test(`installing ${state} and intermediate state changes release listeners`, async () => {
  const installing: any = new Events()
  installing.state = 'installing'
  let activations = 0
  const registration: any = { update: async () => {}, installing, waiting: null }
  const f = fixture(registration)
  const result = f.api.restartIntoLatestApp()
  await tick()
  installing.emit('statechange')
  if (state === 'timeout') await f.expire()
  else {
    installing.state = state
    if (state === 'installed') registration.waiting = { postMessage() { activations++ } }
    installing.emit('statechange')
    await tick()
    f.serviceWorker.emit('controllerchange')
  }
  assert.equal(await result, 'reloading')
  assert.equal(activations, state === 'installed' ? 1 : 0)
  assert.equal(installing.count(), 0)
  assert.equal(f.serviceWorker.count(), 0)
  assert.equal(f.timers.size, 0)
})

for (const mode of ['event', 'timeout', 'post-error', 'dirty']) test(`waiting worker ${mode} cleanup and navigation boundary`, async () => {
  const f = fixture({ update: async () => {}, waiting: { postMessage() { if (mode === 'post-error') throw new Error('unavailable') } } })
  const result = f.api.restartIntoLatestApp()
  await tick()
  if (mode === 'dirty') f.setDirty(true)
  if (mode === 'timeout') await f.expire()
  else f.serviceWorker.emit('controllerchange')
  assert.equal(await result, mode === 'dirty' ? 'blocked' : 'reloading')
  assert.equal(f.reloads, mode === 'dirty' ? 0 : 1)
  assert.equal(f.serviceWorker.count(), 0)
  assert.equal(f.timers.size, 0)
})

for (const mode of ['absent', 'discovery-error', 'update-error']) test(`optional APIs ${mode} preserve clean reload`, async () => {
  const f = fixture(mode === 'update-error' ? { update: () => Promise.reject(new Error('offline')) } : undefined)
  if (mode === 'absent') f.serviceWorker.getRegistration = undefined
  if (mode === 'discovery-error') f.serviceWorker.getRegistration = () => { throw new Error('denied') }
  assert.equal(await f.api.restartIntoLatestApp(), 'reloading')
  assert.equal(f.reloads, 1)
  assert.equal(f.timers.size, 0)
})

const app = ts.createSourceFile('App.tsx', fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const recovery = app.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'triggerChunkRecoveryReload')!
test('actual recovery bounds a stalled cache clear and ignores its late settlement', async () => {
  const f = fixture()
  const cache = deferred()
  let reloads = 0
  const context = vm.createContext({ optionalAppOperation: f.api.optionalAppOperation, hasDirtyWork: () => false, flushPendingWorkDrafts() {}, claimChunkReload: async () => ({ allow: true, reason: 'test', marker: {} }), clearChunkReloadMarker() {}, buildChunkRecoveryUrl: () => null, clearStaleShellCaches: () => cache.promise, window: { location: { reload() { reloads++ } } }, navigator: { onLine: true } })
  vm.runInContext(ts.transpile(recovery.getText(app), { target: ts.ScriptTarget.ES2022 }), context)
  const pending = vm.runInContext("triggerChunkRecoveryReload('fixture')", context)
  await tick()
  await f.expire()
  assert.equal(await pending, true)
  assert.equal(reloads, 1)
  assert.equal(f.timers.size, 0)
  cache.resolve()
  await tick()
  assert.equal(reloads, 1)
})
for (const boundary of ['clean', 'already-dirty', 'claim', 'cache']) test(`actual top-level recovery ${boundary} keeps marker retry semantics`, async () => {
  let dirty = boundary === 'already-dirty', navigations = 0, claims = 0, clears = 0, cacheCalls = 0
  const claim = deferred(), cache = deferred()
  const context = vm.createContext({ optionalAppOperation: (operation: () => any) => operation(), hasDirtyWork: () => dirty, flushPendingWorkDrafts() {}, claimChunkReload() { claims++; return claim.promise }, clearChunkReloadMarker() { clears++ }, buildChunkRecoveryUrl: () => null, clearStaleShellCaches() { cacheCalls++; return cache.promise }, window: { location: { reload() { navigations++ } } }, navigator: { onLine: true } })
  vm.runInContext(ts.transpile(recovery.getText(app), { target: ts.ScriptTarget.ES2022 }), context)
  const pending = vm.runInContext("triggerChunkRecoveryReload('fixture')", context)
  if (boundary === 'claim') dirty = true
  claim.resolve({ allow: true, reason: 'fixture', marker: { live: 'new-build' } })
  await tick()
  if (boundary === 'cache') dirty = true
  cache.resolve()
  assert.equal(await pending, boundary === 'clean')
  await tick()
  assert.equal(navigations, boundary === 'clean' ? 1 : 0)
  assert.equal(claims, boundary === 'already-dirty' ? 0 : 1)
  assert.equal(clears, boundary === 'claim' || boundary === 'cache' ? 1 : 0)
  assert.equal(cacheCalls, boundary === 'clean' || boundary === 'cache' ? 1 : 0)
  if (boundary !== 'clean') {
    dirty = false
    assert.equal(await vm.runInContext("triggerChunkRecoveryReload('fixture')", context), true)
    assert.equal(navigations, 1)
  }
})

const banner = app.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'AppUpdateBanner')!
const sidebar = ts.createSourceFile('Sidebar.tsx', fs.readFileSync(new URL('../src/components/navigation/Sidebar.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let manualUpdate = ''
function findManual(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(sidebar) === 'runAppUpdate') manualUpdate = node.getText(sidebar)
  ts.forEachChild(node, findManual)
}
findManual(sidebar)
assert.ok(manualUpdate)
const mounted = (await build({ stdin: { contents: `
import React, {useState} from 'react'; import {createRoot} from 'react-dom/client'; import {createPortal} from 'react-dom';
import {restartIntoLatestApp, setAppUpdateUnsavedWorkNotice} from './src/utils/appUpdate.ts';
import {registerDirtyWork} from './src/utils/dirtyWork.ts';
const t = key => globalThis.dictionary[key]; const useApp = () => ({t});
${banner.getText(app)}
const ${manualUpdate};
globalThis.runManualUpdate = runAppUpdate;
globalThis.dirty = false; globalThis.reloads = 0;
registerDirtyWork({key:'mounted-draft',pageId:'products',label:'draft',isDirty:()=>globalThis.dirty});
setAppUpdateUnsavedWorkNotice(message => {document.querySelector('#notice').textContent=message});
createRoot(document.querySelector('#root')).render(<AppUpdateBanner update={{version:'new'}} onDismiss={()=>{}}/>);
`, resolveDir: frontend, loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', plugins: [{ name: 'browser-optional-api-adapter', setup(build) {
  build.onLoad({ filter: /[\\/]utils[\\/]appUpdate\.ts$/ }, args => ({ contents: `const window = globalThis.fixtureWindow; const navigator = globalThis.fixtureNavigator;\n${fs.readFileSync(args.path, 'utf8')}`, loader: 'ts' }))
} }] })).outputFiles![0].text

for (const [engine, browserType] of [['chromium', chromium], ['webkit', webkit]] as const) for (const lang of ['en', 'km']) nodeTest(`mounted actual banner and sidebar callback ${engine}/${lang}`, { timeout: 30000 }, async () => {
  const browser = await browserType.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const dictionary = JSON.parse(fs.readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8'))
    for (const mode of ['dirty-update', 'stalled-registration', 'stalled-update']) {
      await page.setContent('<div id="root"></div><output id="notice"></output>')
      await page.evaluate(({ dictionary, mode }) => {
        const scope = globalThis as any
        scope.dictionary = dictionary
        scope.fixtureWindow = { location: { reload() { scope.reloads++ } }, setTimeout: (fn: () => void, ms: number) => setTimeout(fn, mode === 'dirty-update' ? ms : Math.min(ms, 150)), clearTimeout: (id: number) => clearTimeout(id) }
        let resolveUpdate: () => void
        const update = new Promise<void>(resolve => { resolveUpdate = resolve })
        scope.resolveUpdate = () => resolveUpdate()
        scope.updateStarted = false
        scope.fixtureNavigator = { serviceWorker: { getRegistration: () => mode === 'stalled-registration' ? new Promise(() => {}) : Promise.resolve({ update: () => { scope.updateStarted = true; return update } }) } }
      }, { dictionary, mode })
      await page.addScriptTag({ content: mounted })
      const button = page.getByRole('button', { name: dictionary.restart_now, exact: true })
      await button.click()
      if (mode === 'dirty-update') {
        await expect.poll(() => page.evaluate(() => (globalThis as any).updateStarted)).toBe(true)
        await page.evaluate(() => { const scope = globalThis as any; scope.dirty = true; scope.runManualUpdate(); scope.resolveUpdate() })
        await expect(button).toBeEnabled()
        assert.equal(await page.locator('#notice').textContent(), dictionary.save_or_discard_before_update)
        assert.equal(await page.evaluate(() => (globalThis as any).reloads), 0)
        await page.evaluate(() => { (globalThis as any).dirty = false })
        await button.click()
      }
      await expect.poll(() => page.evaluate(() => (globalThis as any).reloads)).toBe(1)
      await page.evaluate(() => { (globalThis as any).runManualUpdate(); (globalThis as any).resolveUpdate() })
      await page.waitForTimeout(200)
      assert.equal(await page.evaluate(() => (globalThis as any).reloads), 1)
    }
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
