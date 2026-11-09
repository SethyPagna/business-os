import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { transformSync } from 'esbuild'
import ts from 'typescript'

// CACHE-LIFECYCLE T-CL2 unit (lane 6.0.1048, R5/R6). The Worker names the frontend build it serves in X-BOS-Build on every /api response.
// A till tab that makes ANY API call learns about a deploy within that round trip, even though its hub socket survives the deploy (Durable
// Objects defer code updates and hibernating sockets stay connected since 30 Oct 2026, so `sync:reconnected` no longer fires).
//
// This file runs the REAL api/serverSignals.ts and the REAL watchForNewAppShell extracted from index.tsx against one fake window:
//   a build that is not the running one, seen for the first time  -> exactly one registration.update()
//   the running build, no header, a malformed header, the same new build again -> none
//   it only ASKS for the check; nothing reloads, and the worker's own byte comparison stays the only thing that raises the bar.
// Each MUTANT is the same source with one defect and the same assertions must fail on it.

const read = (relative: string) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8').split('\r\n').join('\n')

function topLevelFunction(text: string, name: string): string {
  const parsed = ts.createSourceFile('index.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found = parsed.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert.ok(found, `${name} must stay a top-level function of index.tsx`)
  return found.getText(parsed)
}

function constValue(text: string, name: string): number {
  const match = text.match(new RegExp(`^const ${name} = ([0-9_* ]+)$`, 'm'))
  assert.ok(match, `${name} must stay a named numeric constant`)
  return Number(Function(`return (${match[1].replace(/_/g, '')})`)())
}

const transpile = (code: string) => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText

type Counters = { updates: number; reloads: number; replaces: number }

function world(runningBuild: string) {
  const counters: Counters = { updates: 0, reloads: 0, replaces: 0 }
  const target = new EventTarget() as EventTarget & Record<string, unknown>
  const documentTarget = new EventTarget() as EventTarget & Record<string, unknown>
  documentTarget.visibilityState = 'visible'
  Object.assign(target, {
    setInterval: () => 1,
    setTimeout: () => 1,
    clearTimeout: () => {},
    location: { reload: () => { counters.reloads += 1 }, replace: () => { counters.replaces += 1 }, assign: () => { counters.replaces += 1 } },
  })
  const saved = { window: (globalThis as any).window, build: (globalThis as any).__FRONTEND_BUILD_HASH__ }
  ;(globalThis as any).window = target
  ;(globalThis as any).__FRONTEND_BUILD_HASH__ = runningBuild
  const registration = { update: () => { counters.updates += 1; return Promise.resolve() } }
  return {
    window: target, document: documentTarget, registration, counters,
    restore() { (globalThis as any).window = saved.window; (globalThis as any).__FRONTEND_BUILD_HASH__ = saved.build },
  }
}

const watcherSource = () => {
  const index = read('src/index.tsx')
  return {
    code: topLevelFunction(index, 'watchForNewAppShell'),
    POLL: constValue(index, 'SERVICE_WORKER_UPDATE_POLL_MS'),
    MIN_GAP: constValue(index, 'SERVICE_WORKER_UPDATE_MIN_GAP_MS'),
    TIMEOUT: constValue(index, 'SERVICE_WORKER_UPDATE_TIMEOUT_MS'),
  }
}

function startWatcher(w: ReturnType<typeof world>, rewrite: (code: string) => string = (code) => code) {
  const source = watcherSource()
  const code = rewrite(source.code)
  assert.ok(code.length > 0)
  const dependencies: Record<string, unknown> = {
    window: w.window, document: w.document, navigator: { onLine: true }, Date,
    SERVICE_WORKER_UPDATE_POLL_MS: source.POLL, SERVICE_WORKER_UPDATE_MIN_GAP_MS: source.MIN_GAP, SERVICE_WORKER_UPDATE_TIMEOUT_MS: source.TIMEOUT,
  }
  const compiled = transpile(`${code}\nreturn { watchForNewAppShell };`)
  const runtime = new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies))
  return runtime.watchForNewAppShell(w.registration)
}

const settle = () => new Promise((resolve) => setImmediate(resolve))
const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null })

// The real module, or a copy of it with one defect (written next to a copy of dataEpoch.ts in a temp folder).
async function load(mutate?: (source: string) => string) {
  if (!mutate) return await import(`../src/api/serverSignals.ts?case=${Math.random()}`) as typeof import('../src/api/serverSignals.ts')
  const compile = (source: string) => transformSync(source, { loader: 'ts', format: 'esm', target: 'es2022' }).code
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-server-signals-'))
  const original = read('src/api/serverSignals.ts')
  const mutated = mutate(original)
  assert.notEqual(mutated, original, 'mutation anchor missing')
  fs.writeFileSync(path.join(directory, 'serverSignals.mjs'), compile(mutated.replace("from './dataEpoch.ts'", "from './dataEpoch.mjs'")))
  fs.writeFileSync(path.join(directory, 'dataEpoch.mjs'), compile(read('src/api/dataEpoch.ts')))
  return await import(`${pathToFileURL(path.join(directory, 'serverSignals.mjs')).href}?case=${Math.random()}`) as typeof import('../src/api/serverSignals.ts')
}

test('a build that is not the running one fires exactly one update check; the running build, no header, a malformed header and a repeat do not', async () => {
  const w = world('build-running')
  try {
    const signals = await load()
    startWatcher(w)
    signals.recordServerSignals(headers({}))
    signals.recordServerSignals(headers({ 'X-BOS-Build': 'build-running' }))
    signals.recordServerSignals(headers({ 'X-BOS-Build': 'bad value with spaces' }))
    signals.recordServerSignals(headers({ 'X-BOS-Build': 'x'.repeat(65) }))
    await settle()
    assert.equal(w.counters.updates, 0, 'nothing to learn from the running build, silence or garbage')
    signals.recordServerSignals(headers({ 'X-BOS-Build': 'build-next' }))
    await settle()
    assert.equal(w.counters.updates, 1, 'a new build is exactly one check')
    for (let response = 0; response < 20; response += 1) { signals.recordServerSignals(headers({ 'X-BOS-Build': 'build-next' })); await settle() }
    assert.equal(w.counters.updates, 1, 'the same new build on every later response is still one check')
    assert.equal(signals.serverBuild(), 'build-next')
    assert.equal(w.counters.reloads + w.counters.replaces, 0, 'a build signal never navigates or reloads: the bar is the only update path')
  } finally { w.restore() }
})

test('a second new build asks again; a return to the running build and a later deploy of the same new build asks again too', async () => {
  const w = world('build-running')
  try {
    const signals = await load()
    startWatcher(w)
    signals.recordServerSignals(headers({ 'X-BOS-Build': 'build-b' }))
    await settle()
    signals.recordServerSignals(headers({ 'X-BOS-Build': 'build-c' }))
    await settle()
    assert.equal(w.counters.updates, 2, 'build-b then build-c is two checks')
    signals.recordServerSignals(headers({ 'X-BOS-Build': 'build-running' }))
    signals.recordServerSignals(headers({ 'X-BOS-Build': 'build-c' }))
    await settle()
    assert.equal(w.counters.updates, 3, 'a rollback to the running build and a new deploy of build-c is a new announcement')
  } finally { w.restore() }
})

test('a development build (no hash) never asks', async () => {
  const w = world('dev')
  try {
    const signals = await load()
    startWatcher(w)
    signals.recordServerSignals(headers({ 'X-BOS-Build': 'build-next' }))
    await settle()
    assert.equal(w.counters.updates, 0)
  } finally { w.restore() }
})

test('the signal is one event; the watcher listens exactly once and a repeat of the listener is not a second check', async () => {
  const w = world('build-running')
  try {
    const signals = await load()
    startWatcher(w)
    let events = 0
    w.window.addEventListener(signals.SERVER_BUILD_EVENT, () => { events += 1 })
    signals.recordServerSignals(headers({ 'X-BOS-Build': 'build-next' }))
    signals.recordServerSignals(headers({ 'X-BOS-Build': 'build-next' }))
    await settle()
    assert.equal(events, 1)
    assert.equal(w.counters.updates, 1)
  } finally { w.restore() }
})

test('MUTANT: the watcher without its build listener asks nothing (the case-1 assertion fails on it)', async () => {
  const w = world('build-running')
  try {
    const signals = await load()
    startWatcher(w, (code) => {
      const listener = "window.addEventListener('sync:server-build', () => { check() })"
      assert.ok(code.includes(listener), 'mutation anchor missing')
      return code.replace(listener, '')
    })
    signals.recordServerSignals(headers({ 'X-BOS-Build': 'build-next' }))
    await settle()
    assert.equal(w.counters.updates, 0, 'with the listener removed no check happens, so the real assertion (updates === 1) is red on this mutant')
  } finally { w.restore() }
})

test('MUTANT: a signal that fires again for a build it already announced makes the same scenario ask more than once', async () => {
  const w = world('build-running')
  try {
    const signals = await load((source) => source.replace('next === announcedBuild', 'false'))
    startWatcher(w)
    for (let response = 0; response < 5; response += 1) { signals.recordServerSignals(headers({ 'X-BOS-Build': 'build-next' })); await settle() }
    assert.ok(w.counters.updates > 1, 'on this mutant the repeated build asks every time, so the real assertion (updates === 1) is red on it')
  } finally { w.restore() }
})

test('MUTANT: a signal that also fires for the running build asks for nothing it should', async () => {
  const w = world('build-running')
  try {
    const signals = await load((source) => source.replace('if (next === running) { announcedBuild = null; return }', ''))
    startWatcher(w)
    signals.recordServerSignals(headers({ 'X-BOS-Build': 'build-running' }))
    await settle()
    assert.equal(w.counters.updates, 1, 'on this mutant the running build asks, so the real assertion (updates === 0) is red on it')
  } finally { w.restore() }
})

test('index.tsx: the watcher answers the build signal without reloading and keeps its other triggers', () => {
  const index = read('src/index.tsx')
  const watcher = topLevelFunction(index, 'watchForNewAppShell')
  assert.match(watcher, /window\.addEventListener\('sync:server-build', \(\) => \{ check\(\) \}\)/)
  for (const trigger of ["'sync:reconnected'", "'focus'", "'pageshow'", "'online'", "'visibilitychange'", 'SERVICE_WORKER_UPDATE_POLL_MS']) assert.ok(watcher.includes(trigger), `${trigger} must stay a trigger`)
  assert.doesNotMatch(watcher, /location\.(reload|replace|assign)/, 'the watcher never navigates')
  assert.doesNotMatch(read('src/api/serverSignals.ts'), /location\.(reload|replace|assign)/, 'the signal module never navigates')
})
