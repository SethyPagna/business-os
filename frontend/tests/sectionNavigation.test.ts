import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as routing from '../src/app/pathRouting.ts'

const sectionSwitcher = fs.readFileSync(new URL('../src/components/shared/SectionSwitcher.tsx', import.meta.url), 'utf8')
const inventory = fs.readFileSync(new URL('../src/components/inventory/Inventory.tsx', import.meta.url), 'utf8')
const settings = fs.readFileSync(new URL('../src/components/utils-settings/Settings.tsx', import.meta.url), 'utf8')
const backup = fs.readFileSync(new URL('../src/components/utils-settings/Backup.tsx', import.meta.url), 'utf8')
const loyalty = fs.readFileSync(new URL('../src/components/loyalty-points/LoyaltyPointsPage.tsx', import.meta.url), 'utf8')
const loadingWatchdog = fs.readFileSync(new URL('../src/components/shared/LoadingWatchdog.tsx', import.meta.url), 'utf8')

assert.match(sectionSwitcher, /export default function SectionSwitcher/)
assert.match(sectionSwitcher, /value = 'all'/)
assert.match(sectionSwitcher, /localStorage/)
assert.match(sectionSwitcher, /All/)
assert.match(sectionSwitcher, /section-switcher max-w-full min-w-0/, 'the switcher should stay viewport bounded')
assert.match(sectionSwitcher, /flex min-w-0 flex-wrap/, 'section buttons should wrap instead of scrolling sideways')
assert.doesNotMatch(sectionSwitcher, /overflow-x-auto|whitespace-nowrap rounded-lg|min-w-max/, 'compact section navigation should not require horizontal scrolling')
assert.match(sectionSwitcher, /min-h-11/, 'section buttons should meet the 44px compact touch-target minimum')
assert.match(sectionSwitcher, /break-words/, 'long and Khmer labels should wrap')

for (const [name, source] of [
  ['Inventory', inventory],
  ['Settings', settings],
  ['Loyalty', loyalty],
]) {
  assert.match(source, /SectionSwitcher/, `${name} should use the shared section switcher`)
  assert.match(source, /sectionStorageKey|storageKey/, `${name} should persist focused section state`)
  assert.match(source, /LoadingWatchdog/, `${name} should use the loading watchdog`)
}

assert.match(backup, /SectionSwitcher/, 'Backup should use the shared section switcher')
assert.doesNotMatch(backup, /sectionStorageKey|storageKey/, 'Backup should not auto-restore heavy sections on page entry')
assert.match(backup, /LoadingWatchdog/, 'Backup should use the loading watchdog')

assert.match(inventory, /label: 'All'/)
assert.doesNotMatch(inventory, /Stats \+ sections/)
assert.match(inventory, /showInventorySections/)
assert.match(inventory, /showInventoryTabs/)
assert.match(inventory, /showProductsSection/)
assert.match(inventory, /inventorySection === 'stats'/)
assert.match(inventory, /shouldRestoreStoredValue=\{\(storedValue\) => storedValue !== 'all'\}/, 'Inventory should not restore the heavy All section on page entry')
assert.match(inventory, /RFID_SECTION_OPTIONS/)
assert.match(inventory, /Overview/)
assert.match(inventory, /Tagging/)
assert.match(inventory, /Stock Count/)
assert.match(inventory, /Exceptions/)
assert.match(inventory, /Sessions/)

assert.match(loadingWatchdog, /Still loading/)
assert.match(loadingWatchdog, /onRetry/)
assert.match(loadingWatchdog, /timeoutMs/)

console.log('PASS focused section navigation and loading watchdog are wired')

// Execute the actual navigation closures and host hook with an addressable
// history stack and independent hook state for each retained page.
const contextSource = fs.readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8')
const navigationSource = contextSource.slice(contextSource.indexOf('  const committedLocationRef ='), contextSource.indexOf('  // Currency helpers.'))
assert.ok(navigationSource.includes('resolveNavGuard'))
const hubSource = fs.readFileSync(new URL('../src/components/shared/hubNavigation.ts', import.meta.url), 'utf8')
const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const headerSource = [...appSource.matchAll(/^const MOBILE_HEADER_(?:TOP_ZONE|SCROLL_DELTA)_PX = .+$/gm)].map((match) => match[0]).join('\n')
  + '\n' + appSource.slice(appSource.indexOf('function useMobileHeaderAutoHide('), appSource.indexOf('function GlobalScrollControls()'))
const shellSource = appSource.slice(appSource.indexOf('  const [shellLocation,'), appSource.indexOf('  useEffect(() => {\n    if (!user || !requestedAdminPage'))
assert.ok(headerSource.includes('function useMobileHeaderAutoHide'))
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const sandbox = vm.createContext({ assert, routing, console, URL, EventTarget, Event, CustomEvent, compile, hubSource, navigationSource, headerSource, shellSource })
await vm.runInContext(`
  (async () => {
  let runner
  function scheduler() {
    const cells = [], effects = []
    return {
      cursor: 0, pending: [],
      run(fn) {
        runner = this; this.cursor = 0
        const value = fn()
        for (const effect of this.pending.splice(0)) effect()
        return value
      },
      state(initial) {
        const index = this.cursor++
        if (!(index in cells)) cells[index] = typeof initial === 'function' ? initial() : initial
        return [cells[index], (next) => { cells[index] = typeof next === 'function' ? next(cells[index]) : next }]
      },
      ref(initial) { return this.state(() => ({ current: initial }))[0] },
      effect(fn, deps) {
        const index = this.cursor++
        const previous = effects[index]
        if (previous && deps && previous.deps && deps.every((value, i) => Object.is(value, previous.deps[i])) && deps.length === previous.deps.length) return
        this.pending.push(() => {
          previous?.cleanup?.()
          effects[index] = { deps, cleanup: fn() }
        })
      },
      close() { for (const effect of effects) effect?.cleanup?.() },
    }
  }
  const useState = (initial) => runner.state(initial)
  const useRef = (initial) => runner.ref(initial)
  const useCallback = (fn) => fn
  const useEffect = (fn, deps) => runner.effect(fn, deps)
  const hooks = { useState, useRef, useCallback, useEffect }
  const module = { exports: {} }
  const require = (name) => name === 'react' ? hooks : routing
  new Function('require', 'module', 'exports', compile(hubSource))(require, module, module.exports)
  const { useHubSection, getHubPageFromLocation, navigationHash, needsNavigationGuard } = module.exports
  const { APP_NAVIGATION_EVENT, getAdminPageFromPath, getAdminPathForPage, resolveAdminLandingPage } = routing
  const settingsRef = { current: { default_landing_page: 'sales' } }
  const window = new EventTarget()
  const stack = [{ href: 'https://admin.example.test/sales', state: {} }]
  let index = 0
  let deferTraversals = false
  const traversals = []
  Object.defineProperty(window, 'location', { get: () => new URL(stack[index].href) })
  window.history = {
    get state() { return stack[index].state },
    get length() { return stack.length },
    pushState(state, title, href) {
      stack.splice(index + 1)
      stack.push({ state, href: new URL(href || window.location.href, window.location.href).href }); index++
    },
    replaceState(state, title, href) {
      stack[index] = { state, href: new URL(href || window.location.href, window.location.href).href }
    },
    go(delta) {
      const traverse = () => {
        if (index + delta < 0 || index + delta >= stack.length) return
        index += delta
        window.dispatchEvent(new Event('popstate'))
      }
      if (deferTraversals) traversals.push(traverse)
      else traverse()
    },
    back() { this.go(-1) },
    forward() { this.go(1) },
  }
  globalThis.window = window
  let page = 'sales', dirty = [], denied = []
  const canAccessPage = (id) => !denied.includes(id)
  const getDirtyWork = () => dirty.filter((item) => item.isDirty())
  const hasDirtyWork = () => getDirtyWork().length > 0
  const startTransition = (fn) => fn()
  const setPage = (id) => { page = id }
  const makeNavigation = new Function('env', compile(
    'const { useRef, useState, useEffect, useCallback, window, page, canAccessPage, getDirtyWork, hasDirtyWork, startTransition, setPage, navigationHash, needsNavigationGuard, APP_NAVIGATION_EVENT, getAdminPageFromPath, getAdminPathForPage, getHubPageFromLocation, settingsRef, resolveAdminLandingPage } = env;'
    + navigationSource + '; return { navigateTo, resolveNavGuard, navGuard };'
  ))
  const appRunner = scheduler(), salesRunner = scheduler(), settingsRunner = scheduler()
  const renderApp = () => appRunner.run(() => makeNavigation({
    ...hooks, window, page, canAccessPage, getDirtyWork, hasDirtyWork, startTransition, setPage,
    navigationHash, needsNavigationGuard, APP_NAVIGATION_EVENT, getAdminPageFromPath, getAdminPathForPage,
    getHubPageFromLocation, settingsRef, resolveAdminLandingPage,
  }))
  let app = renderApp()
  const sales = () => salesRunner.run(() => useHubSection('sales', 'fees', ['sales', 'returns', 'fees', 'reports'], app.navigateTo))
  const settings = () => settingsRunner.run(() => useHubSection('settings', 'settings', ['settings', 'backup'], app.navigateTo))
  assert.equal(sales()[0], 'fees')
  assert.equal(window.location.hash, '#hub:sales:fees', 'initial remembered body seals title/URL parity')
  assert.equal(stack.length, 1, 'initial entry must not add a hidden hub layer')
  assert.equal(settings()[0], 'settings', 'hidden retained host ignores current URL')
  sales()[1]('returns')
  app = renderApp()
  assert.equal(sales()[0], 'returns')
  assert.equal(settings()[0], 'settings')
  assert.equal(stack.length, 2, 'one URL entry per section tap')
  window.history.back()
  app = renderApp()
  assert.equal(sales()[0], 'fees', 'same-page Back restores the body')
  window.history.forward()
  app = renderApp()
  assert.equal(sales()[0], 'returns', 'same-page Forward restores the body')
  const reloadRunner = scheduler()
  assert.equal(reloadRunner.run(() => useHubSection('sales', 'sales', ['sales', 'fees', 'returns'], app.navigateTo))[0], 'returns', 'reload honors URL before defaults')
  reloadRunner.close()
  dirty = [{ isDirty: () => true, discard: () => { dirty = [] } }]
  window.history.back()
  app = renderApp()
  assert.equal(window.location.hash, '#hub:sales:returns', 'dirty Back restores committed URL')
  assert.equal(sales()[0], 'returns', 'dirty Back must not notify the host prematurely')
  assert.equal(app.navGuard.anchor, 'hub:sales:fees')
  await app.resolveNavGuard('stay')
  app = renderApp()
  dirty = []
  window.history.back()
  app = renderApp()
  assert.equal(sales()[0], 'fees')
  assert.equal(stack.length, 2, 'Stay preserves both indexed entries')
  dirty = [{ isDirty: () => true }]
  window.history.forward()
  app = renderApp()
  assert.equal(window.location.hash, '#hub:sales:fees', 'dirty Forward restores the committed URL too')
  assert.equal(sales()[0], 'fees')
  await app.resolveNavGuard('stay')
  app = renderApp()
  dirty = []
  window.history.forward()
  app = renderApp()
  assert.equal(sales()[0], 'returns')
  dirty = [{ isDirty: () => true, discard: () => { dirty = [] } }]
  sales()[1]('reports')
  app = renderApp()
  assert.equal(sales()[0], 'returns', 'dirty section tap waits for resolution')
  assert.equal(app.navGuard.anchor, 'hub:sales:reports')
  await app.resolveNavGuard('discard')
  app = renderApp()
  assert.equal(sales()[0], 'reports')
  dirty = [{ isDirty: () => true, save: () => false }]
  sales()[1]('fees')
  app = renderApp()
  await app.resolveNavGuard('save')
  app = renderApp()
  assert.equal(sales()[0], 'reports', 'failed save keeps current body')
  dirty = []
  window.history.pushState({ bosFoldOpen: true }, '', window.location.href)
  const modalHref = window.location.href
  window.history.back()
  app = renderApp()
  assert.equal(window.location.href, modalHref)
  assert.equal(sales()[0], 'reports', 'same-URL modal Back cannot switch sections')
  app.navigateTo('settings', 'hub:settings:backup')
  app = renderApp()
  assert.equal(settings()[0], 'backup')
  assert.equal(sales()[0], 'reports', 'retained sales host remains unchanged')
  denied = ['sales']
  app.navigateTo('sales', 'hub:sales:fees')
  assert.equal(page, 'settings', 'permission denial precedes navigation')
  denied = []
  app.navigateTo('sales', 'hub:sales:fees')
  app = renderApp()
  assert.equal(sales()[0], 'fees', 're-entering retained host accepts destination')
  sales()[1]('unknown')
  assert.equal(window.location.hash, '#hub:sales:fees', 'unknown section is not navigable')
  app.navigateTo('sales', 'hub:sales:reports'); app = renderApp(); sales()
  const lengthBeforeGuardedBack = stack.length
  const reportsIndex = index
  dirty = [{ isDirty: () => true, discard: () => { dirty = [] } }]
  window.history.back(); app = renderApp()
  assert.equal(app.navGuard.anchor, 'hub:sales:fees')
  await app.resolveNavGuard('discard'); app = renderApp()
  assert.equal(sales()[0], 'fees')
  assert.equal(index, reportsIndex - 1, 'approved Back resumes the original traversal')
  assert.equal(stack.length, lengthBeforeGuardedBack, 'approved Back must not push duplicate Fees')
  window.history.forward(); app = renderApp()
  assert.equal(sales()[0], 'reports', 'Reports stays in Forward after approved Back')
  dirty = [{ isDirty: () => true, save: () => { dirty = []; return true } }]
  window.history.back(); app = renderApp()
  await app.resolveNavGuard('save'); app = renderApp()
  assert.equal(index, reportsIndex - 1, 'successful Save resumes Back')
  assert.equal(stack.length, lengthBeforeGuardedBack)
  dirty = [{ isDirty: () => true, discard: () => { dirty = [] } }]
  window.history.forward(); app = renderApp()
  await app.resolveNavGuard('discard'); app = renderApp()
  assert.equal(index, reportsIndex, 'approved Forward also resumes its original traversal')
  assert.equal(stack.length, lengthBeforeGuardedBack)
  deferTraversals = true
  dirty = [{ isDirty: () => true, discard: () => { dirty = [] } }]
  window.history.back()
  traversals.shift()(); app = renderApp() // the Back arrives; rollback is still queued
  assert.equal(traversals.length, 1)
  await app.resolveNavGuard('discard'); app = renderApp()
  assert.equal(traversals.length, 1, 'approval before rollback must wait, not queue another relative traversal')
  traversals.shift()(); app = renderApp() // rollback arrives and resumes the approved Back
  assert.equal(traversals.length, 1)
  traversals.shift()(); app = renderApp()
  assert.equal(index, reportsIndex - 1)
  assert.equal(sales()[0], 'fees')
  assert.equal(stack.length, lengthBeforeGuardedBack)
  window.history.forward(); traversals.shift()(); app = renderApp()
  let finishSave
  dirty = [{ isDirty: () => true, save: () => new Promise((resolve) => { finishSave = () => { dirty = []; resolve(true) } }) }]
  window.history.back(); traversals.shift()(); app = renderApp()
  const savedTraversal = app.resolveNavGuard('save')
  traversals.shift()(); app = renderApp() // rollback finishes while Save is pending
  assert.equal(traversals.length, 0)
  finishSave(); await savedTraversal
  assert.equal(traversals.length, 1)
  traversals.shift()(); app = renderApp()
  assert.equal(sales()[0], 'fees')
  assert.equal(index, reportsIndex - 1)
  assert.equal(stack.length, lengthBeforeGuardedBack)
  deferTraversals = false
  const beforeRoot = window.location.href
  window.history.replaceState(window.history.state, '', '/#hub:sales:reports')
  const rootRunner = scheduler()
  assert.equal(rootRunner.run(() => useHubSection('sales', 'sales', ['sales', 'reports'], app.navigateTo))[0], 'reports', 'configured root hub honors section before fallback')
  assert.equal(getHubPageFromLocation(window.location.pathname, window.location.hash), 'sales', 'shell and host agree on root anchor page')
  rootRunner.close()
  window.history.replaceState(window.history.state, '', beforeRoot)
  const frames = []
  let scrollTop = 0
  window.requestAnimationFrame = (callback) => frames.push(callback)
  const makeHeader = new Function('env', compile('const {useState,useRef,useEffect,window,APP_NAVIGATION_EVENT,getScrollTarget,page}=env;' + headerSource + '; return useMobileHeaderAutoHide(page)'))
  const headerRunner = scheduler()
  const header = () => headerRunner.run(() => makeHeader({ ...hooks, window, APP_NAVIGATION_EVENT, getScrollTarget: () => ({scrollTop}), page }))
  assert.equal(header(), true)
  scrollTop = 400; window.dispatchEvent(new Event('scroll')); frames.shift()()
  assert.equal(header(), false, 'scrolling down hides header')
  app.navigateTo('sales', 'hub:sales:reports'); app = renderApp()
  assert.equal(header(), true, 'committed same-page section navigation reveals header')
  scrollTop = 600; window.dispatchEvent(new Event('scroll'))
  app.navigateTo('sales', 'hub:sales:fees'); app = renderApp()
  frames.shift()()
  assert.equal(header(), true, 'a stale scroll frame cannot re-hide newly revealed header')
  headerRunner.close()
  const makeShell = new Function('env', compile('const {useState,useEffect,window,APP_NAVIGATION_EVENT,isPublicCatalogPath,getHubPageFromLocation,getAdminPageFromPath,resolveAdminLandingPage,normalizePageId,settings}=env;' + shellSource + '; return {shellLocation, requestedAdminPage}'))
  const shellRunner = scheduler()
  const shell = () => shellRunner.run(() => makeShell({ ...hooks, window, APP_NAVIGATION_EVENT, isPublicCatalogPath: routing.isPublicCatalogPath, getHubPageFromLocation, getAdminPageFromPath, resolveAdminLandingPage, normalizePageId: (id, fallback) => id || fallback, settings: settingsRef.current }))
  assert.equal(shell().requestedAdminPage, 'sales')
  app.navigateTo('settings', 'hub:settings:backup'); app = renderApp()
  assert.equal(shell().requestedAdminPage, 'settings')
  deferTraversals = true
  dirty = [{ isDirty: () => true, discard: () => { dirty = [] } }]
  window.history.back(); traversals.shift()(); app = renderApp()
  assert.equal(window.location.pathname, '/sales', 'raw target is temporarily visible during async rollback')
  assert.equal(shell().requestedAdminPage, 'settings', 'shell cannot bypass a pending cross-page guard through the raw URL')
  await app.resolveNavGuard('discard'); app = renderApp()
  traversals.shift()(); app = renderApp()
  traversals.shift()(); app = renderApp()
  assert.equal(shell().requestedAdminPage, 'sales', 'shell follows the approved traversal commit')
  shellRunner.close()
  salesRunner.close(); settingsRunner.close(); appRunner.close()
  console.log('PASS actual navigation + host hooks: initial/reload, Back/Forward, retained hosts, permission/dirty/save/discard guards and modal history')
  })()
`, sandbox)
